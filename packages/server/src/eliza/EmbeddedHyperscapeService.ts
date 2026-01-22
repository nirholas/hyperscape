/**
 * EmbeddedHyperscapeService - Direct world integration for embedded agents
 *
 * Unlike the plugin-hyperscape WebSocket service, this service runs in the same
 * process as the server and has direct access to the World instance.
 *
 * This eliminates network latency and simplifies the architecture for
 * agents that run on the server itself.
 */

import { EventType, type World, type Entity } from "@hyperscape/shared";
import type {
  IEmbeddedHyperscapeService,
  EmbeddedGameState,
  NearbyEntityData,
} from "./types.js";

// Distance threshold for "nearby" entities (in world units)
const NEARBY_DISTANCE = 50;

// Event handler type
type EventHandler = (data: unknown) => void;

/**
 * EmbeddedHyperscapeService provides direct World access for embedded agents
 *
 * Key differences from WebSocket-based HyperscapeService:
 * - No network connection needed (same process)
 * - Direct entity manipulation through World
 * - Direct event subscription through World events
 * - No packet encoding/decoding overhead
 */
export class EmbeddedHyperscapeService implements IEmbeddedHyperscapeService {
  private world: World;
  private characterId: string;
  private accountId: string;
  private name: string;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private playerEntityId: string | null = null;
  private isActive: boolean = false;

  constructor(
    world: World,
    characterId: string,
    accountId: string,
    name: string,
  ) {
    this.world = world;
    this.characterId = characterId;
    this.accountId = accountId;
    this.name = name;
  }

  /**
   * Initialize the service and spawn the agent's player entity
   */
  async initialize(): Promise<void> {
    console.log(
      `[EmbeddedHyperscapeService] Initializing agent ${this.name} (${this.characterId})`,
    );

    // Check if player entity already exists
    const existingEntity = this.world.entities.get(this.characterId);
    if (existingEntity) {
      console.log(
        `[EmbeddedHyperscapeService] Player entity already exists: ${this.characterId}`,
      );
      this.playerEntityId = this.characterId;
      this.isActive = true;
      return;
    }

    // Load character data from database
    const databaseSystem = this.world.getSystem("database") as
      | {
          getCharactersAsync: (
            accountId: string,
          ) => Promise<
            Array<{
              id: string;
              name: string;
              avatar?: string | null;
              wallet?: string | null;
            }>
          >;
          getPlayerAsync: (
            characterId: string,
          ) => Promise<{
            positionX?: number;
            positionY?: number;
            positionZ?: number;
            attackLevel?: number;
            attackXp?: number;
            strengthLevel?: number;
            strengthXp?: number;
            defenseLevel?: number;
            defenseXp?: number;
            constitutionLevel?: number;
            constitutionXp?: number;
            rangedLevel?: number;
            rangedXp?: number;
            woodcuttingLevel?: number;
            woodcuttingXp?: number;
            miningLevel?: number;
            miningXp?: number;
            fishingLevel?: number;
            fishingXp?: number;
            firemakingLevel?: number;
            firemakingXp?: number;
            cookingLevel?: number;
            cookingXp?: number;
            smithingLevel?: number;
            smithingXp?: number;
            coins?: number;
          } | null>;
        }
      | undefined;

    if (!databaseSystem) {
      throw new Error("DatabaseSystem not available");
    }

    // Get character info
    const characters = await databaseSystem.getCharactersAsync(this.accountId);
    const characterData = characters.find((c) => c.id === this.characterId);

    if (!characterData) {
      throw new Error(
        `Character ${this.characterId} not found for account ${this.accountId}`,
      );
    }

    // Get saved player data (position, skills)
    const savedData = await databaseSystem.getPlayerAsync(this.characterId);

    // Determine spawn position
    let position: [number, number, number] = [0, 10, 0];
    if (savedData?.positionX !== undefined) {
      position = [
        savedData.positionX || 0,
        savedData.positionY || 10,
        savedData.positionZ || 0,
      ];
    }

    // Load skills from saved data
    const skills = {
      attack: { level: savedData?.attackLevel || 1, xp: savedData?.attackXp || 0 },
      strength: { level: savedData?.strengthLevel || 1, xp: savedData?.strengthXp || 0 },
      defense: { level: savedData?.defenseLevel || 1, xp: savedData?.defenseXp || 0 },
      constitution: { level: savedData?.constitutionLevel || 10, xp: savedData?.constitutionXp || 0 },
      ranged: { level: savedData?.rangedLevel || 1, xp: savedData?.rangedXp || 0 },
      woodcutting: { level: savedData?.woodcuttingLevel || 1, xp: savedData?.woodcuttingXp || 0 },
      mining: { level: savedData?.miningLevel || 1, xp: savedData?.miningXp || 0 },
      fishing: { level: savedData?.fishingLevel || 1, xp: savedData?.fishingXp || 0 },
      firemaking: { level: savedData?.firemakingLevel || 1, xp: savedData?.firemakingXp || 0 },
      cooking: { level: savedData?.cookingLevel || 1, xp: savedData?.cookingXp || 0 },
      smithing: { level: savedData?.smithingLevel || 1, xp: savedData?.smithingXp || 0 },
    };

    // Calculate health from constitution
    const health = skills.constitution.level;

    // Spawn the player entity
    console.log(
      `[EmbeddedHyperscapeService] Spawning agent at position [${position.join(", ")}]`,
    );

    const addedEntity = this.world.entities.add
      ? this.world.entities.add({
          id: this.characterId,
          type: "player",
          position,
          quaternion: [0, 0, 0, 1],
          owner: `embedded-agent:${this.characterId}`,
          userId: this.accountId,
          name: characterData.name,
          health,
          maxHealth: health,
          avatar:
            characterData.avatar ||
            this.world.settings?.avatar?.url ||
            "asset://avatars/avatar-male-01.vrm",
          wallet: characterData.wallet || undefined,
          roles: [],
          skills,
          autoRetaliate: true,
          isLoading: false, // Embedded agents start ready
          isAgent: true, // Mark as AI agent
        })
      : undefined;

    if (!addedEntity) {
      throw new Error("Failed to spawn player entity");
    }

    this.playerEntityId = this.characterId;
    this.isActive = true;

    // Emit player joined event
    this.world.emit(EventType.PLAYER_JOINED, {
      playerId: this.characterId,
      player: addedEntity as unknown as import("@hyperscape/shared").PlayerLocal,
      isEmbeddedAgent: true,
    });

    console.log(
      `[EmbeddedHyperscapeService] ✅ Agent ${this.name} spawned successfully`,
    );

    // Subscribe to world events
    this.subscribeToWorldEvents();
  }

  /**
   * Subscribe to world events and forward to registered handlers
   */
  private subscribeToWorldEvents(): void {
    // Subscribe to entity events
    this.world.on(EventType.ENTITY_CREATED, (data) => {
      this.broadcastEvent("ENTITY_JOINED", data);
    });

    this.world.on(EventType.ENTITY_MODIFIED, (data) => {
      this.broadcastEvent("ENTITY_UPDATED", data);
    });

    this.world.on(EventType.ENTITY_REMOVE, (data) => {
      this.broadcastEvent("ENTITY_LEFT", data);
    });

    // Subscribe to inventory events
    this.world.on(EventType.INVENTORY_UPDATED, (data) => {
      const eventData = data as { playerId?: string };
      if (eventData.playerId === this.characterId) {
        this.broadcastEvent("INVENTORY_UPDATED", data);
      }
    });

    // Subscribe to skills events
    this.world.on(EventType.SKILLS_UPDATED, (data) => {
      const eventData = data as { playerId?: string };
      if (eventData.playerId === this.characterId) {
        this.broadcastEvent("SKILLS_UPDATED", data);
      }
    });

    // Subscribe to chat events
    this.world.on(EventType.CHAT_MESSAGE, (data) => {
      this.broadcastEvent("CHAT_MESSAGE", data);
    });
  }

  /**
   * Broadcast event to registered handlers
   */
  private broadcastEvent(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error(
            `[EmbeddedHyperscapeService] Event handler error for ${event}:`,
            err,
          );
        }
      });
    }
  }

  /**
   * Stop the service and remove the player entity
   */
  async stop(): Promise<void> {
    console.log(
      `[EmbeddedHyperscapeService] Stopping agent ${this.name}`,
    );

    this.isActive = false;

    // Remove player entity
    if (this.playerEntityId && this.world.entities?.remove) {
      this.world.entities.remove(this.playerEntityId);
      this.world.emit(EventType.PLAYER_LEFT, {
        playerId: this.playerEntityId,
      });
    }

    this.playerEntityId = null;
    this.eventHandlers.clear();

    console.log(
      `[EmbeddedHyperscapeService] ✅ Agent ${this.name} stopped`,
    );
  }

  // ============================================================================
  // IEmbeddedHyperscapeService Implementation
  // ============================================================================

  getWorld(): World {
    return this.world;
  }

  getGameState(): EmbeddedGameState | null {
    if (!this.playerEntityId || !this.isActive) {
      return null;
    }

    const player = this.world.entities.get(this.playerEntityId);
    if (!player) {
      return null;
    }

    const data = player.data as Record<string, unknown>;
    const position = this.normalizePosition(data.position);
    const skills = (data.skills || {}) as Record<
      string,
      { level: number; xp: number }
    >;
    const inventory = (data.inventory || []) as Array<{
      slot: number;
      itemId: string;
      quantity: number;
    }>;
    const equipment = (data.equipment || {}) as Record<
      string,
      { itemId: string }
    >;

    return {
      playerId: this.playerEntityId,
      position,
      health: (data.health as number) || 10,
      maxHealth: (data.maxHealth as number) || 10,
      alive: data.alive !== false,
      skills,
      inventory,
      equipment,
      nearbyEntities: this.getNearbyEntities(),
      inCombat: !!(data.inCombat || data.combatTarget),
      currentTarget: (data.combatTarget as string) || null,
    };
  }

  getNearbyEntities(): NearbyEntityData[] {
    if (!this.playerEntityId || !this.isActive) {
      return [];
    }

    const player = this.world.entities.get(this.playerEntityId);
    if (!player) {
      return [];
    }

    const playerPos = this.normalizePosition(player.data.position);
    if (!playerPos) {
      return [];
    }

    const nearby: NearbyEntityData[] = [];

    // Iterate through all entities
    for (const [id, entity] of this.world.entities.items.entries()) {
      if (id === this.playerEntityId) continue; // Skip self

      const entityData = entity.data as Record<string, unknown>;
      const entityPos = this.normalizePosition(entityData.position);
      if (!entityPos) continue;

      // Calculate distance
      const dx = entityPos[0] - playerPos[0];
      const dy = entityPos[1] - playerPos[1];
      const dz = entityPos[2] - playerPos[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance > NEARBY_DISTANCE) continue;

      // Determine entity type
      const entityType = this.categorizeEntity(entityData);

      nearby.push({
        id,
        name: (entityData.name as string) || id,
        type: entityType,
        position: entityPos,
        distance,
        health: entityData.health as number | undefined,
        maxHealth: entityData.maxHealth as number | undefined,
        level: entityData.level as number | undefined,
        mobType: entityData.mobType as string | undefined,
        itemId: entityData.itemId as string | undefined,
        resourceType: entityData.resourceType as string | undefined,
      });
    }

    // Sort by distance
    nearby.sort((a, b) => a.distance - b.distance);

    return nearby;
  }

  async executeMove(
    target: [number, number, number],
    runMode: boolean = false,
  ): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    // Use the movement system directly
    const movementSystem = this.world.getSystem("movement") as
      | {
          requestMovement?: (
            entityId: string,
            target: [number, number, number],
            options?: { runMode?: boolean },
          ) => void;
        }
      | undefined;

    if (movementSystem?.requestMovement) {
      movementSystem.requestMovement(this.playerEntityId, target, { runMode });
    } else {
      // Fallback: update position directly (less ideal)
      const player = this.world.entities.get(this.playerEntityId);
      if (player) {
        player.data.position = target;
        this.world.emit(EventType.ENTITY_MODIFIED, {
          id: this.playerEntityId,
          changes: { position: target },
        });
      }
    }
  }

  async executeAttack(targetId: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    // Use the combat system directly
    const combatSystem = this.world.getSystem("combat") as
      | {
          initiateAttack?: (
            attackerId: string,
            targetId: string,
            attackType?: string,
          ) => void;
        }
      | undefined;

    if (combatSystem?.initiateAttack) {
      combatSystem.initiateAttack(this.playerEntityId, targetId, "melee");
    } else {
      console.warn("[EmbeddedHyperscapeService] Combat system not available");
    }
  }

  async executeGather(resourceId: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    // Use the resource system directly
    const resourceSystem = this.world.getSystem("resource") as
      | {
          startGathering?: (
            playerId: string,
            resourceId: string,
          ) => void;
        }
      | undefined;

    if (resourceSystem?.startGathering) {
      resourceSystem.startGathering(this.playerEntityId, resourceId);
    } else {
      console.warn("[EmbeddedHyperscapeService] Resource system not available");
    }
  }

  async executePickup(itemId: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    // Use the inventory system directly
    const inventorySystem = this.world.getSystem("inventory") as
      | {
          pickupItem?: (playerId: string, itemId: string) => Promise<boolean>;
        }
      | undefined;

    if (inventorySystem?.pickupItem) {
      await inventorySystem.pickupItem(this.playerEntityId, itemId);
    } else {
      console.warn("[EmbeddedHyperscapeService] Inventory system not available");
    }
  }

  async executeDrop(itemId: string, quantity: number = 1): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    const inventorySystem = this.world.getSystem("inventory") as
      | {
          dropItem?: (
            playerId: string,
            itemId: string,
            quantity: number,
          ) => Promise<boolean>;
        }
      | undefined;

    if (inventorySystem?.dropItem) {
      await inventorySystem.dropItem(this.playerEntityId, itemId, quantity);
    } else {
      console.warn("[EmbeddedHyperscapeService] Inventory system not available");
    }
  }

  async executeEquip(itemId: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    const equipmentSystem = this.world.getSystem("equipment") as
      | {
          equipItem?: (playerId: string, itemId: string) => Promise<boolean>;
        }
      | undefined;

    if (equipmentSystem?.equipItem) {
      await equipmentSystem.equipItem(this.playerEntityId, itemId);
    } else {
      console.warn("[EmbeddedHyperscapeService] Equipment system not available");
    }
  }

  async executeUse(itemId: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    const inventorySystem = this.world.getSystem("inventory") as
      | {
          useItem?: (playerId: string, itemId: string) => Promise<boolean>;
        }
      | undefined;

    if (inventorySystem?.useItem) {
      await inventorySystem.useItem(this.playerEntityId, itemId);
    } else {
      console.warn("[EmbeddedHyperscapeService] Inventory system not available");
    }
  }

  async executeChat(message: string): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      throw new Error("Agent not spawned");
    }

    const chatSystem = this.world.getSystem("chat") as
      | {
          add?: (
            message: {
              id: string;
              from: string;
              fromId: string;
              body: string;
              text: string;
              timestamp: number;
              createdAt: string;
            },
            broadcast?: boolean,
          ) => void;
        }
      | undefined;

    if (chatSystem?.add) {
      chatSystem.add(
        {
          id: crypto.randomUUID(),
          from: this.name,
          fromId: this.playerEntityId,
          body: message,
          text: message,
          timestamp: Date.now(),
          createdAt: new Date().toISOString(),
        },
        true,
      );
    } else {
      console.warn("[EmbeddedHyperscapeService] Chat system not available");
    }
  }

  async executeStop(): Promise<void> {
    if (!this.playerEntityId || !this.isActive) {
      return;
    }

    // Stop current movement
    const movementSystem = this.world.getSystem("movement") as
      | {
          cancelMovement?: (entityId: string) => void;
        }
      | undefined;

    if (movementSystem?.cancelMovement) {
      movementSystem.cancelMovement(this.playerEntityId);
    }

    // Cancel combat
    const player = this.world.entities.get(this.playerEntityId);
    if (player) {
      player.data.combatTarget = null;
      player.data.inCombat = false;
    }
  }

  isSpawned(): boolean {
    return this.isActive && this.playerEntityId !== null;
  }

  getPlayerId(): string | null {
    return this.playerEntityId;
  }

  onGameEvent(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  offGameEvent(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Normalize position to [x, y, z] array format
   */
  private normalizePosition(
    pos: unknown,
  ): [number, number, number] | null {
    if (Array.isArray(pos) && pos.length >= 3) {
      return [pos[0], pos[1], pos[2]];
    }
    if (pos && typeof pos === "object" && "x" in pos) {
      const objPos = pos as { x: number; y?: number; z?: number };
      return [objPos.x, objPos.y ?? 0, objPos.z ?? 0];
    }
    return null;
  }

  /**
   * Categorize an entity by its data
   */
  private categorizeEntity(
    data: Record<string, unknown>,
  ): "player" | "mob" | "npc" | "item" | "resource" | "object" {
    if (data.type === "player") return "player";
    if (data.mobType || data.type === "mob") return "mob";
    if (data.npcType || data.type === "npc") return "npc";
    if (data.itemId || data.type === "item" || data.isItem) return "item";
    if (data.resourceType || data.type === "resource") return "resource";
    return "object";
  }
}
