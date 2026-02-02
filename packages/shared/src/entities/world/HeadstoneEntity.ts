/**
 * HeadstoneEntity - Corpse/Grave Entity
 *
 * Represents corpses and gravestones that contain loot items.
 * Created when players or mobs die, holds their dropped items.
 *
 * **Extends**: InteractableEntity (players can loot corpses)
 *
 * **Key Features**:
 *
 * **Corpse Types**:
 * - **Player Death**: Contains all items from player inventory (if not protected)
 * - **Mob Death**: Contains loot table drops
 * - **PvP Death**: Protected loot for killer only
 *
 * **Loot System**:
 * - Inventory of lootable items
 * - Item quantities
 * - Loot protection (owner-only for first period)
 * - Multi-player looting (items removed as looted)
 *
 * **Interaction**:
 * - "Loot" prompt when player is nearby
 * - Opens loot interface showing available items
 * - Items transferred to player inventory
 * - Empty corpses despawn automatically
 *
 * **Visual Representation**:
 * - Gravestone model (for players)
 * - Corpse model (for mobs)
 * - Name label showing who died
 * - Item count indicator
 * - Glow if valuable loot inside
 *
 * **Loot Protection**:
 * - Player corpses: Protected for owner only (unsafe PvP zones)
 * - Mob corpses: Protected for attacker for 60 seconds
 * - Shared loot after protection expires
 * - Ironman players: Only they can loot their own corpse
 *
 * **Despawning**:
 * - Empty corpses despawn immediately
 * - Player graves persist for 15 minutes
 * - Mob corpses despawn after 2 minutes
 * - Valuable loot extends despawn time
 *
 * **Network Sync**:
 * - Corpse creation broadcast to all
 * - Loot changes sync to all clients
 * - Despawn events trigger removal
 *
 * **Runs on**: Server (authoritative), Client (visual + UI)
 * **Referenced by**: DeathSystem, LootSystem, InteractionSystem
 *
 * @public
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import type {
  HeadstoneEntityConfig,
  EntityInteractionData,
} from "../../types/entities";
import type { InventoryItem, EntityData } from "../../types/core/core";
import {
  InteractableEntity,
  type InteractableConfig,
} from "../InteractableEntity";
import { EventType } from "../../types/events";
import type { LootResult, LootFailureReason } from "../../types/death";
import { generateTransactionId } from "../../utils/IdGenerator";
import { DeathState } from "../../types/entities";
import { modelCache } from "../../utils/rendering/ModelCache";

/**
 * Type guard to validate HeadstoneEntityConfig has required properties
 */
function _isValidHeadstoneConfig(
  config: unknown,
): config is HeadstoneEntityConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  if (!c.headstoneData || typeof c.headstoneData !== "object") return false;
  const hd = c.headstoneData as Record<string, unknown>;
  return (
    typeof hd.playerId === "string" &&
    typeof hd.deathTime === "number" &&
    Array.isArray(hd.items)
  );
}

export class HeadstoneEntity extends InteractableEntity {
  protected config: HeadstoneEntityConfig;
  private lootItems: InventoryItem[] = [];
  private lootRequestHandler?: (data: unknown) => void;
  private lootAllRequestHandler?: (data: unknown) => void;

  private get headstoneData() {
    return this.config.headstoneData;
  }

  // Atomic loot operations (prevents concurrent duplication)
  private lootQueue: Promise<void> = Promise.resolve();
  private lootProtectionUntil: number = 0; // Timestamp when loot protection expires
  private protectedFor?: string; // Player ID who has loot protection (killer in PvP)

  // Rate limiting to prevent loot spam
  private lootRateLimiter = new Map<string, number>();
  private readonly LOOT_RATE_LIMIT_MS = 100;

  constructor(world: World, config: HeadstoneEntityConfig) {
    // Convert HeadstoneEntityConfig to InteractableConfig format
    const interactableConfig: InteractableConfig = {
      ...config,
      interaction: {
        prompt: "Loot",
        description: config.headstoneData.deathMessage || "A corpse",
        range: 2.0,
        cooldown: 0,
        usesRemaining: -1, // Can be looted multiple times until empty
        maxUses: -1,
        effect: "loot",
      },
    };

    super(world, interactableConfig);
    this.config = config;
    this.lootItems = [...(config.headstoneData.items || [])];

    // Initialize loot protection from config
    this.lootProtectionUntil = config.headstoneData.lootProtectionUntil || 0;
    this.protectedFor = config.headstoneData.protectedFor;

    // Listen for loot requests on this specific corpse
    this.lootRequestHandler = (data: unknown) => {
      const lootData = data as {
        corpseId: string;
        playerId: string;
        itemId: string;
        quantity: number;
        slot?: number;
        transactionId?: string;
      };
      if (lootData.corpseId === this.id) {
        this.handleLootRequest(lootData);
      }
    };
    this.world.on(EventType.CORPSE_LOOT_REQUEST, this.lootRequestHandler);

    // Listen for "loot all" requests on this specific corpse
    this.lootAllRequestHandler = (data: unknown) => {
      const lootData = data as {
        corpseId: string;
        playerId: string;
        transactionId?: string;
      };
      if (lootData.corpseId === this.id) {
        this.handleLootAllRequest(lootData);
      }
    };
    this.world.on(
      EventType.CORPSE_LOOT_ALL_REQUEST,
      this.lootAllRequestHandler,
    );
  }

  /**
   * Check if player can loot this gravestone
   * Enforces time-based and owner-based loot protection
   */
  private canPlayerLoot(playerId: string): boolean {
    const now = Date.now();

    // Check if loot protection is active
    if (this.lootProtectionUntil && now < this.lootProtectionUntil) {
      // Loot is protected
      if (this.protectedFor && this.protectedFor !== playerId) {
        return false;
      }
    }

    // Player can loot
    return true;
  }

  /**
   * Check if player is currently dying or dead.
   * Blocks looting during death animation to prevent item loss from race conditions.
   */
  private isPlayerInDeathState(playerId: string): boolean {
    // Check player entity's death state (single source of truth)
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity && "data" in playerEntity) {
      const data = playerEntity.data as { deathState?: DeathState };
      if (data?.deathState) {
        return (
          data.deathState === DeathState.DYING ||
          data.deathState === DeathState.DEAD
        );
      }
    }
    return false;
  }

  /**
   * Check if player has inventory space for item
   * CRITICAL: Must check BEFORE removing from gravestone to prevent item deletion
   */
  private checkInventorySpace(
    playerId: string,
    itemId: string,
    _quantity: number,
  ): boolean {
    const inventorySystem = this.world.getSystem("inventory") as unknown as {
      getInventory?: (
        playerId: string,
      ) => { items: Array<{ itemId: string }> } | null;
    };
    if (!inventorySystem) {
      console.error("[HeadstoneEntity] InventorySystem not available");
      return false;
    }

    const inventory = inventorySystem.getInventory?.(playerId);
    if (!inventory) {
      console.error(`[HeadstoneEntity] No inventory for ${playerId}`);
      return false;
    }

    // Check if inventory is full (28 max slots - standard RuneScape inventory)
    const isFull = inventory.items.length >= 28;

    if (isFull) {
      // Check if item is stackable and already exists
      const existingItem = inventory.items.find(
        (item: { itemId: string }) => item.itemId === itemId,
      );

      // If item exists and is stackable, we can add to existing stack
      if (existingItem) {
        return true;
      }

      // Emit UI message to player
      this.world.emit(EventType.UI_MESSAGE, {
        playerId,
        message: "Your inventory is full!",
        type: "error",
      });

      return false;
    }

    // Has space
    return true;
  }

  /**
   * Handle a loot request from a player. Rate-limited and queued for atomicity.
   */
  private handleLootRequest(data: {
    playerId: string;
    itemId: string;
    quantity: number;
    slot?: number;
    transactionId?: string;
  }): void {
    // CRITICAL: Server authority check - prevent client from looting
    if (!this.world.isServer) {
      console.error(
        `[HeadstoneEntity] ⚠️  Client attempted server-only loot operation for ${this.id} - BLOCKED`,
      );
      return;
    }

    const transactionId = data.transactionId || generateTransactionId();

    // Rate limiting
    const now = Date.now();
    const lastRequest = this.lootRateLimiter.get(data.playerId) || 0;
    if (now - lastRequest < this.LOOT_RATE_LIMIT_MS) {
      console.log(
        `[HeadstoneEntity] Rate limited loot request from ${data.playerId}`,
      );
      this.emitLootResult(data.playerId, transactionId, false, "RATE_LIMITED");
      return;
    }
    this.lootRateLimiter.set(data.playerId, now);

    // Queue loot operation to ensure atomicity
    // Only ONE loot operation can execute at a time (prevents duplication)
    this.lootQueue = this.lootQueue
      .then(() => this.processLootRequest({ ...data, transactionId }))
      .catch((error) => {
        console.error(`[HeadstoneEntity] Loot request failed:`, error);
        this.emitLootResult(
          data.playerId,
          transactionId,
          false,
          "INVALID_REQUEST",
        );
      });
  }

  /**
   * Process a loot request atomically. Queued to prevent concurrent access.
   */
  private async processLootRequest(data: {
    playerId: string;
    itemId: string;
    quantity: number;
    slot?: number;
    transactionId: string;
  }): Promise<void> {
    const { playerId, itemId, quantity, transactionId } = data;

    // Step 1: Check loot protection
    if (!this.canPlayerLoot(playerId)) {
      this.emitLootResult(playerId, transactionId, false, "PROTECTED");
      return;
    }

    // Step 2: Check if item exists in gravestone
    const itemIndex = this.lootItems.findIndex(
      (item) => item.itemId === itemId,
    );

    if (itemIndex === -1) {
      this.emitLootResult(playerId, transactionId, false, "ITEM_NOT_FOUND");
      return;
    }

    const item = this.lootItems[itemIndex];

    // Validate quantity
    const quantityToLoot = Math.min(quantity, item.quantity);
    if (quantityToLoot <= 0) {
      console.warn(`[HeadstoneEntity] Invalid quantity: ${quantity}`);
      this.emitLootResult(playerId, transactionId, false, "INVALID_REQUEST");
      return;
    }

    // Step 3: CRITICAL - Check inventory space BEFORE removing item
    // This prevents item deletion if inventory is full
    const hasSpace = this.checkInventorySpace(playerId, itemId, quantityToLoot);

    if (!hasSpace) {
      // Inventory full - item NOT removed from gravestone
      this.emitLootResult(playerId, transactionId, false, "INVENTORY_FULL");
      return;
    }

    // Block looting during death animation to prevent item loss
    if (this.isPlayerInDeathState(playerId)) {
      this.emitLootResult(playerId, transactionId, false, "PLAYER_DYING");
      return;
    }

    // Step 4: Atomic remove from gravestone (compare-and-swap pattern)
    const removed = this.removeItem(itemId, quantityToLoot);

    if (!removed) {
      // Race condition: item removed between find and remove
      this.emitLootResult(playerId, transactionId, false, "ITEM_NOT_FOUND");
      return;
    }

    // Step 4.5: DEFENSIVE re-check inventory space (closes race window)
    // Between initial check and now, player may have picked up other items
    const stillHasSpace = this.checkInventorySpace(
      playerId,
      itemId,
      quantityToLoot,
    );
    if (!stillHasSpace) {
      // Rollback: put item back in gravestone
      this.lootItems.push({
        id: item.id,
        itemId: item.itemId,
        quantity: quantityToLoot,
        slot: item.slot,
        metadata: item.metadata,
      });
      this.emitLootResult(playerId, transactionId, false, "INVENTORY_FULL");
      console.log(
        `[HeadstoneEntity] Race condition detected: inventory full after remove, rolled back ${itemId}`,
      );
      return;
    }

    // Step 5: Add to player inventory (safe now, space double-checked)
    this.world.emit(EventType.INVENTORY_ITEM_ADDED, {
      playerId,
      item: {
        id: `loot_${playerId}_${Date.now()}`,
        itemId,
        quantity: quantityToLoot,
        slot: -1, // Auto-assign slot
        metadata: null,
      },
    });

    this.emitLootResult(
      playerId,
      transactionId,
      true,
      undefined,
      itemId,
      quantityToLoot,
    );

    this.world.emit(EventType.AUDIT_LOG, {
      action: "LOOT_SUCCESS",
      playerId: this.headstoneData.playerId, // Owner of gravestone
      actorId: playerId, // Who looted
      entityId: this.id,
      items: [{ itemId, quantity: quantityToLoot }],
      zoneType: "safe_area",
      position: this.getPosition(),
      success: true,
      transactionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle "loot all" request - takes all items from gravestone at once
   * Bypasses per-item rate limiting since it's a single batch operation
   */
  private handleLootAllRequest(data: {
    playerId: string;
    transactionId?: string;
  }): void {
    // CRITICAL: Server authority check
    if (!this.world.isServer) {
      console.error(
        `[HeadstoneEntity] Client attempted server-only loot all operation for ${this.id} - BLOCKED`,
      );
      return;
    }

    const { playerId } = data;
    const transactionId = data.transactionId || generateTransactionId();

    // Rate limit the batch operation itself (not per-item)
    const now = Date.now();
    const lastRequest = this.lootRateLimiter.get(playerId) || 0;
    if (now - lastRequest < this.LOOT_RATE_LIMIT_MS) {
      console.log(
        `[HeadstoneEntity] Rate limited loot all request from ${playerId}`,
      );
      this.emitLootResult(playerId, transactionId, false, "RATE_LIMITED");
      return;
    }
    this.lootRateLimiter.set(playerId, now);

    // Queue the batch loot operation
    this.lootQueue = this.lootQueue
      .then(() => this.processLootAllRequest({ playerId, transactionId }))
      .catch((error) => {
        console.error(`[HeadstoneEntity] Loot all request failed:`, error);
        this.emitLootResult(playerId, transactionId, false, "INVALID_REQUEST");
      });
  }

  /**
   * Process "loot all" request atomically
   * Takes all items that fit in inventory
   */
  private async processLootAllRequest(data: {
    playerId: string;
    transactionId: string;
  }): Promise<void> {
    const { playerId, transactionId } = data;

    // Check loot protection
    if (!this.canPlayerLoot(playerId)) {
      this.emitLootResult(playerId, transactionId, false, "PROTECTED");
      return;
    }

    // Block looting during death animation
    if (this.isPlayerInDeathState(playerId)) {
      this.emitLootResult(playerId, transactionId, false, "PLAYER_DYING");
      return;
    }

    // Nothing to loot
    if (this.lootItems.length === 0) {
      this.emitLootResult(playerId, transactionId, true);
      return;
    }

    // Get inventory system for space checking
    const inventorySystem = this.world.getSystem("inventory") as unknown as {
      getInventory?: (
        playerId: string,
      ) => { items: Array<{ itemId: string }> } | null;
    };

    if (!inventorySystem?.getInventory) {
      console.error(
        "[HeadstoneEntity] InventorySystem not available for loot all",
      );
      this.emitLootResult(playerId, transactionId, false, "INVALID_REQUEST");
      return;
    }

    const inventory = inventorySystem.getInventory(playerId);
    if (!inventory) {
      console.error(`[HeadstoneEntity] No inventory for ${playerId}`);
      this.emitLootResult(playerId, transactionId, false, "INVALID_REQUEST");
      return;
    }

    // Calculate available space
    const maxSlots = 28;
    let usedSlots = inventory.items.length;
    const existingItemIds = new Set(inventory.items.map((i) => i.itemId));

    // Process each item
    const itemsLooted: Array<{ itemId: string; quantity: number }> = [];
    const itemsToRemove: Array<{ itemId: string; quantity: number }> = [];

    for (const item of [...this.lootItems]) {
      // Check if we can add this item
      const canStack = existingItemIds.has(item.itemId);
      const hasSpace = usedSlots < maxSlots || canStack;

      if (!hasSpace) {
        // Inventory full, stop looting
        break;
      }

      // Track for removal and inventory add
      itemsToRemove.push({ itemId: item.itemId, quantity: item.quantity });
      itemsLooted.push({ itemId: item.itemId, quantity: item.quantity });

      // Update space tracking
      if (!canStack) {
        usedSlots++;
        existingItemIds.add(item.itemId);
      }
    }

    // Actually remove items and add to inventory
    // Track successfully looted items for accurate reporting
    const successfullyLooted: Array<{ itemId: string; quantity: number }> = [];

    for (const item of itemsToRemove) {
      // Defensive: re-check space before each item (closes race window)
      const stillHasSpace = this.checkInventorySpace(
        playerId,
        item.itemId,
        item.quantity,
      );
      if (!stillHasSpace) {
        console.log(
          `[HeadstoneEntity] Loot all stopped: inventory full at ${item.itemId}`,
        );
        break; // Stop looting, remaining items stay in gravestone
      }

      const removed = this.removeItem(item.itemId, item.quantity);
      if (removed) {
        this.world.emit(EventType.INVENTORY_ITEM_ADDED, {
          playerId,
          item: {
            id: `loot_${playerId}_${Date.now()}_${item.itemId}`,
            itemId: item.itemId,
            quantity: item.quantity,
            slot: -1,
            metadata: null,
          },
        });
        successfullyLooted.push(item);
      }
    }

    // Update itemsLooted to reflect what was actually looted
    itemsLooted.length = 0;
    itemsLooted.push(...successfullyLooted);

    // Emit success with count of items looted
    this.emitLootResult(
      playerId,
      transactionId,
      true,
      undefined,
      undefined,
      itemsLooted.length,
    );

    // Audit log
    if (itemsLooted.length > 0) {
      this.world.emit(EventType.AUDIT_LOG, {
        action: "LOOT_ALL_SUCCESS",
        playerId: this.headstoneData.playerId,
        actorId: playerId,
        entityId: this.id,
        items: itemsLooted,
        zoneType: "safe_area",
        position: this.getPosition(),
        success: true,
        transactionId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send loot result to client for UI feedback and state resolution
   */
  private emitLootResult(
    playerId: string,
    transactionId: string,
    success: boolean,
    reason?: LootFailureReason,
    itemId?: string,
    quantity?: number,
  ): void {
    const result: LootResult = {
      transactionId,
      success,
      itemId,
      quantity,
      reason,
      timestamp: Date.now(),
    };

    // Send directly to the requesting player via network
    if (this.world.network && "sendTo" in this.world.network) {
      (
        this.world.network as {
          sendTo: (id: string, event: string, data: unknown) => void;
        }
      ).sendTo(playerId, "lootResult", result);
    }

    // Also emit event for any listeners
    this.world.emit(EventType.LOOT_RESULT, { playerId, ...result });

    if (!success) {
      this.world.emit(EventType.AUDIT_LOG, {
        action: "LOOT_FAILED",
        playerId: this.headstoneData.playerId,
        actorId: playerId,
        entityId: this.id,
        items: itemId ? [{ itemId, quantity: quantity || 1 }] : undefined,
        zoneType: "safe_area",
        position: this.getPosition(),
        success: false,
        failureReason: reason,
        transactionId,
        timestamp: Date.now(),
      });
    }
  }

  protected async createMesh(): Promise<void> {
    // Don't create mesh on server
    if (this.world.isServer) {
      return;
    }

    const hd = this.headstoneData;
    const modelPath = "asset://models/headstone/headstone.glb";

    // Try to load the headstone 3D model
    if (this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(modelPath, this.world);
        this.mesh = scene;
        this.mesh.name = `Corpse_${this.id}`;
        this.mesh.scale.set(1.0, 1.0, 1.0);

        this.mesh.layers.set(1);
        this.mesh.traverse((child) => {
          child.layers.set(1);
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      } catch (error) {
        console.warn(
          `[HeadstoneEntity] Failed to load headstone model, using placeholder:`,
          error,
        );
        this.createPlaceholderMesh();
      }
    } else {
      this.createPlaceholderMesh();
    }

    if (!this.mesh) return;

    this.mesh.userData = {
      type: "corpse",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      corpseData: {
        id: this.id,
        playerName: hd.playerName,
        deathMessage: hd.deathMessage,
        itemCount: this.lootItems.length,
      },
    };

    // Add mesh to the entity's node
    if (this.node) {
      this.node.add(this.mesh);

      // Also set userData on node for easier detection
      this.node.userData.type = "corpse";
      this.node.userData.entityId = this.id;
      this.node.userData.interactable = true;

      // Add text label above corpse
      this.createNameLabel();
    }
  }

  /** Fallback placeholder if model fails to load */
  private createPlaceholderMesh(): void {
    const geometry = new THREE.BoxGeometry(1.5, 0.5, 1.0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Corpse_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(1);
    this.mesh = mesh;
  }

  private createNameLabel(): void {
    if (!this.mesh || this.world.isServer) return;

    if (this.mesh.userData) {
      const playerName = this.headstoneData.playerName;
      this.mesh.userData.showLabel = true;
      this.mesh.userData.labelText = playerName
        ? `${playerName}'s corpse`
        : "Corpse";
    }
  }

  /**
   * Handle corpse interaction - shows loot interface
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    const lootData = {
      corpseId: this.id,
      playerId: data.playerId,
      lootItems: this.lootItems,
      position: this.getPosition(),
    };

    // Emit local event for server-side systems
    // NOTE: No loot protection needed - gravestone spawns AFTER respawn (RuneScape-style)
    this.world.emit(EventType.CORPSE_CLICK, lootData);

    // Send to specific client over network (opens loot UI immediately)
    if (this.world.isServer && this.world.network) {
      const network = this.world.network as unknown as {
        sendTo?: (playerId: string, type: string, data: unknown) => void;
      };
      if (network.sendTo) {
        network.sendTo(data.playerId, "corpseLoot", lootData);
      }
    }
  }

  /**
   * Remove an item from the corpse loot
   */
  public removeItem(itemId: string, quantity: number): boolean {
    const itemIndex = this.lootItems.findIndex(
      (item) => item.itemId === itemId,
    );
    if (itemIndex === -1) {
      return false;
    }

    const item = this.lootItems[itemIndex];

    if (item.quantity > quantity) {
      item.quantity -= quantity;
    } else {
      this.lootItems.splice(itemIndex, 1);
    }

    // Update userData
    if (this.mesh?.userData?.corpseData) {
      this.mesh.userData.corpseData.itemCount = this.lootItems.length;
    }

    // If no items left, mark for despawn
    if (this.lootItems.length === 0) {
      this.world.emit(EventType.CORPSE_EMPTY, {
        corpseId: this.id,
        playerId: this.headstoneData.playerId,
      });

      // Despawn almost immediately after all items taken (RuneScape-style)
      setTimeout(() => {
        // Use EntityManager to properly remove entity (sends entityRemoved packet to clients)
        const entityManager = this.world.getSystem(
          "entity-manager",
        ) as unknown as { destroyEntity?: (id: string) => void };
        if (entityManager?.destroyEntity) {
          entityManager.destroyEntity(this.id);
        } else {
          this.world.entities.remove(this.id);
        }
      }, 500);
    }

    this.markNetworkDirty();
    return true;
  }

  /**
   * Get all loot items
   */
  public getLootItems(): InventoryItem[] {
    return [...this.lootItems];
  }

  /**
   * Check if corpse has loot
   */
  public hasLoot(): boolean {
    return this.lootItems.length > 0;
  }

  /**
   * Network data override - MUST include lootItems for client LootWindow
   */
  getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();
    const hd = this.headstoneData;
    return {
      ...baseData,
      lootItemCount: this.lootItems.length,
      lootItems: this.lootItems,
      despawnTime: hd.despawnTime,
      playerId: hd.playerId,
      deathMessage: hd.deathMessage,
      lootProtectionUntil: this.lootProtectionUntil,
      protectedFor: this.protectedFor,
    };
  }

  /**
   * Override serialize() to include lootItems in network packet
   * CRITICAL: Base Entity.serialize() only copies this.data, but lootItems is a private field
   */
  serialize(): EntityData {
    const baseData = super.serialize();
    const hd = this.headstoneData;
    return {
      ...baseData,
      headstoneData: {
        playerId: hd.playerId,
        playerName: hd.playerName,
        deathTime: hd.deathTime,
        deathMessage: hd.deathMessage,
        position: hd.position,
        items: this.lootItems,
        itemCount: this.lootItems.length,
        despawnTime: hd.despawnTime,
        lootProtectionUntil: this.lootProtectionUntil,
        protectedFor: this.protectedFor,
      },
      lootItems: this.lootItems,
      lootItemCount: this.lootItems.length,
      lootProtectionUntil: this.lootProtectionUntil,
      protectedFor: this.protectedFor,
    } as unknown as EntityData;
  }

  protected serverUpdate(deltaTime: number): void {
    super.serverUpdate(deltaTime);

    if (Date.now() > this.headstoneData.despawnTime) {
      this.world.entities.remove(this.id);
    }
  }

  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);

    // Slight floating animation
    if (this.mesh) {
      const time = this.world.getTime() * 0.001;
      this.mesh.position.y = 0.25 + Math.sin(time * 1) * 0.05;
    }
  }

  public destroy(): void {
    if (this.lootRequestHandler) {
      this.world.off(EventType.CORPSE_LOOT_REQUEST, this.lootRequestHandler);
      this.lootRequestHandler = undefined;
    }
    if (this.lootAllRequestHandler) {
      this.world.off(
        EventType.CORPSE_LOOT_ALL_REQUEST,
        this.lootAllRequestHandler,
      );
      this.lootAllRequestHandler = undefined;
    }
    this.lootRateLimiter.clear();
    super.destroy();
  }
}
