import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../core/World";
import { EventType } from "../../../types/events";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import { ticksToMs } from "../../../utils/game/CombatCalculations";
import type {
  InventoryItem,
  DeathLocationData,
} from "../../../types/core/core";
import {
  calculateDistance,
  groundToTerrain,
} from "../../../utils/game/EntityUtils";
import { EntityType, InteractionType } from "../../../types/entities";
import type { HeadstoneEntityConfig } from "../../../types/entities";
import type { EntityManager } from "..";
import { ZoneDetectionSystem } from "../death/ZoneDetectionSystem";
import type { GroundItemSystem } from "../economy/GroundItemSystem";
import { DeathStateManager } from "../death/DeathStateManager";
import { SafeAreaDeathHandler } from "../death/SafeAreaDeathHandler";
import { WildernessDeathHandler } from "../death/WildernessDeathHandler";
import { ZoneType } from "../../../types/death";
import type { InventorySystem } from "../character/InventorySystem";
import { getEntityPosition } from "../../../utils/game/EntityPositionUtils";

interface PlayerSystemLike {
  players?: Map<string, { position?: { x: number; y: number; z: number } }>;
}

interface DatabaseSystemLike {
  executeInTransaction: (fn: (tx: unknown) => Promise<void>) => Promise<void>;
}

interface EquipmentSystemLike {
  getPlayerEquipment: (playerId: string) => EquipmentData | null;
  clearEquipmentImmediate?: (playerId: string) => Promise<void>;
}

interface EquipmentData {
  weapon?: { item?: { id: string; quantity?: number } };
  shield?: { item?: { id: string; quantity?: number } };
  helmet?: { item?: { id: string; quantity?: number } };
  body?: { item?: { id: string; quantity?: number } };
  legs?: { item?: { id: string; quantity?: number } };
  arrows?: { item?: { id: string; quantity?: number } };
  [key: string]: { item?: { id: string; quantity?: number } } | undefined;
}

interface TerrainSystemLike {
  isReady: () => boolean;
  getHeightAt: (x: number, z: number) => number;
}

interface NetworkLike {
  sendTo: (
    playerId: string,
    eventName: string,
    data: Record<string, unknown>,
  ) => void;
}

interface PlayerEntityLike {
  emote?: string;
  data?: {
    e?: string;
    visible?: boolean;
    name?: string;
    position?: number[];
  };
  node?: {
    position: { set: (x: number, y: number, z: number) => void };
  };
  position?: { x: number; y: number; z: number };
  setHealth?: (health: number) => void;
  getMaxHealth?: () => number;
  markNetworkDirty?: () => void;
}

/** Extended death location data with headstone tracking */
interface DeathLocationDataWithHeadstone extends DeathLocationData {
  headstoneId?: string;
}

/**
 * Orchestrates player death via modular handlers (zone detection, safe area, wilderness).
 * Safe zones: gravestone (5min) → ground (2min). Wilderness: ground immediately (2min).
 * @see https://oldschool.runescape.wiki/w/Death
 */
export class PlayerDeathSystem extends SystemBase {
  private deathLocations = new Map<string, DeathLocationData>();
  private respawnTimers = new Map<string, NodeJS.Timeout>();
  private playerPositions = new Map<
    string,
    { x: number; y: number; z: number }
  >();
  private playerInventories = new Map<
    string,
    { items: InventoryItem[]; coins: number }
  >();
  private pendingGravestones = new Map<
    string,
    {
      position: { x: number; y: number; z: number };
      items: InventoryItem[];
      killedBy: string;
      zoneType: ZoneType;
    }
  >();

  private lastDeathTime = new Map<string, number>();
  private readonly DEATH_COOLDOWN = ticksToMs(
    COMBAT_CONSTANTS.DEATH.COOLDOWN_TICKS,
  );

  private zoneDetection!: ZoneDetectionSystem;
  private groundItemSystem!: GroundItemSystem;
  private deathStateManager!: DeathStateManager;
  private safeAreaHandler!: SafeAreaDeathHandler;
  private wildernessHandler!: WildernessDeathHandler;

  constructor(world: World) {
    super(world, {
      name: "player-death",
      dependencies: {
        required: ["ground-items"], // Depends on shared GroundItemSystem
        optional: ["inventory", "entity-manager"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    this.zoneDetection = new ZoneDetectionSystem(this.world);
    await this.zoneDetection.init();

    this.groundItemSystem =
      this.world.getSystem<GroundItemSystem>("ground-items")!;
    if (!this.groundItemSystem) {
      console.error("[PlayerDeathSystem] GroundItemSystem not found");
    }

    this.deathStateManager = new DeathStateManager(this.world);
    await this.deathStateManager.init();

    this.safeAreaHandler = new SafeAreaDeathHandler(
      this.world,
      this.groundItemSystem,
      this.deathStateManager,
    );

    this.wildernessHandler = new WildernessDeathHandler(
      this.world,
      this.groundItemSystem,
      this.deathStateManager,
    );

    this.subscribe(
      EventType.ENTITY_DEATH,
      (data: {
        entityId: string;
        killedBy: string;
        entityType: "player" | "mob";
      }) => this.handlePlayerDeath(data),
    );
    this.subscribe(
      EventType.PLAYER_RESPAWN_REQUEST,
      (data: { playerId: string }) => this.handleRespawnRequest(data),
    );
    this.subscribe(EventType.DEATH_LOOT_COLLECT, (data: { playerId: string }) =>
      this.handleLootCollection(data),
    );
    this.subscribe(EventType.PLAYER_UNREGISTERED, (data: { id: string }) =>
      this.cleanupPlayerDeath(data),
    );
    this.subscribe(
      EventType.DEATH_HEADSTONE_EXPIRED,
      (data: { headstoneId: string; playerId: string }) =>
        this.handleHeadstoneExpired(data),
    );
    this.subscribe(
      EventType.CORPSE_EMPTY,
      (data: { corpseId: string; playerId: string }) =>
        this.handleCorpseEmpty(data),
    );
    this.subscribe(EventType.PLAYER_JOINED, (data: { playerId: string }) =>
      this.handlePlayerReconnect(data),
    );

    this.subscribe(
      EventType.PLAYER_POSITION_UPDATED,
      (data: {
        playerId: string;
        position: { x: number; y: number; z: number };
      }) => {
        this.playerPositions.set(data.playerId, data.position);
      },
    );

    this.subscribe(
      EventType.INVENTORY_UPDATED,
      (data: { playerId: string; items: InventoryItem[]; coins: number }) => {
        const inventory = this.playerInventories.get(data.playerId) || {
          items: [],
          coins: 0,
        };
        inventory.items = data.items;
        this.playerInventories.set(data.playerId, inventory);
      },
    );

    this.subscribe(
      EventType.INVENTORY_COINS_UPDATED,
      (data: { playerId: string; newAmount: number }) => {
        const inventory = this.playerInventories.get(data.playerId) || {
          items: [],
          coins: 0,
        };
        inventory.coins = data.newAmount;
        this.playerInventories.set(data.playerId, inventory);
      },
    );

    // Clean up inventory cache when player unregisters
    this.subscribe(EventType.PLAYER_UNREGISTERED, (data: { id: string }) => {
      this.playerInventories.delete(data.id);
    });
  }

  destroy(): void {
    // Clean up modular death system components
    if (this.safeAreaHandler) {
      this.safeAreaHandler.destroy();
    }
    if (this.wildernessHandler) {
      this.wildernessHandler.destroy();
    }
    for (const timer of this.respawnTimers.values()) {
      clearTimeout(timer);
    }
    this.respawnTimers.clear();
    this.deathLocations.clear();
  }

  private handlePlayerDeath(data: {
    entityId: string;
    killedBy: string;
    entityType: "player" | "mob";
  }): void {
    // Only handle player deaths - mob deaths are handled by MobDeathSystem
    if (data.entityType !== "player") {
      // Fallback: Check if entityId looks like a player (fixes rare bug if entityType missing)
      const entityId = data.entityId || "";
      if (
        !entityId.includes("player_") &&
        !entityId.includes("user_") &&
        !entityId.startsWith("player-") &&
        !entityId.startsWith("user-")
      ) {
        return; // Definitely not a player
      }
    }

    const playerId = data.entityId;

    // Get player's current position - try multiple sources for robustness
    let position = this.playerPositions.get(playerId);

    if (!position) {
      // Fallback 1: Try to get position from player entity
      const playerEntity = this.world.entities?.get?.(playerId);
      if (playerEntity) {
        const entityPos = getEntityPosition(playerEntity);
        if (entityPos) {
          position = { x: entityPos.x, y: entityPos.y, z: entityPos.z };
        }
      }
    }

    if (!position) {
      // Fallback 2: Try to get from player system
      const playerSystem = this.world.getSystem?.(
        "player",
      ) as PlayerSystemLike | null;
      if (playerSystem) {
        const player = playerSystem.players?.get?.(playerId);
        if (player?.position) {
          position = { ...player.position };
        }
      }
    }

    if (!position) {
      // Ultimate fallback: Use spawn location
      console.warn(
        `[PlayerDeathSystem] Could not find position for player ${playerId}, using default spawn`,
      );
      position = { x: 0, y: 10, z: 0 };
    }

    this.processPlayerDeath(playerId, position, data.killedBy);
  }

  private convertEquipmentToInventoryItems(
    equipment: EquipmentData,
    playerId: string,
  ): InventoryItem[] {
    const items: InventoryItem[] = [];
    const timestamp = Date.now();
    const slots = ["weapon", "shield", "helmet", "body", "legs", "arrows"];

    for (const slotName of slots) {
      const equipSlot = equipment[slotName];
      if (equipSlot && equipSlot.item) {
        items.push({
          id: `death_equipped_${playerId}_${slotName}_${timestamp}`,
          itemId: equipSlot.item.id,
          quantity: equipSlot.item.quantity || 1,
          slot: -1, // Equipment items don't have inventory slots
          metadata: null,
        });
      }
    }

    return items;
  }

  private async processPlayerDeath(
    playerId: string,
    deathPosition: { x: number; y: number; z: number },
    killedBy: string,
  ): Promise<void> {
    // Server-only - prevent client from triggering death events
    if (!this.world.isServer) {
      console.error(
        `[PlayerDeathSystem] Client attempted server-only death processing for ${playerId}`,
      );
      return;
    }

    const lastDeath = this.lastDeathTime.get(playerId) || 0;
    if (Date.now() - lastDeath < this.DEATH_COOLDOWN) {
      console.warn(`[PlayerDeathSystem] Death spam: ${playerId}`);
      return;
    }

    const hasActiveDeathLock =
      await this.deathStateManager.hasActiveDeathLock(playerId);
    if (hasActiveDeathLock) {
      console.warn(
        `[PlayerDeathSystem] Player ${playerId} already has active death lock`,
      );
      return;
    }

    // Update last death time
    this.lastDeathTime.set(playerId, Date.now());

    // Get database system for transaction support
    const databaseSystem = this.world.getSystem(
      "database",
    ) as unknown as DatabaseSystemLike | null;
    if (!databaseSystem || !databaseSystem.executeInTransaction) {
      console.error(
        "[PlayerDeathSystem] DatabaseSystem not available - cannot use transaction!",
      );
      return;
    }

    // Get inventory system
    const inventorySystem = this.world.getSystem<InventorySystem>("inventory");
    if (!inventorySystem) {
      console.error("[PlayerDeathSystem] InventorySystem not available");
      return;
    }

    // Get equipment system
    const equipmentSystem = this.world.getSystem(
      "equipment",
    ) as unknown as EquipmentSystemLike | null;

    let itemsToDrop: InventoryItem[] = [];

    try {
      await databaseSystem.executeInTransaction(async (tx: unknown) => {
        const inventory = inventorySystem.getInventory(playerId);
        if (!inventory) {
          console.warn(`[PlayerDeathSystem] No inventory for ${playerId}`);
        }

        const inventoryItems =
          inventory?.items.map((item, index) => ({
            id: `death_${playerId}_${Date.now()}_${index}`,
            itemId: item.itemId,
            quantity: item.quantity,
            slot: item.slot,
            metadata: null,
          })) || [];

        let equipmentItems: InventoryItem[] = [];
        if (equipmentSystem) {
          const equipment = equipmentSystem.getPlayerEquipment(playerId);
          if (equipment) {
            equipmentItems = this.convertEquipmentToInventoryItems(
              equipment,
              playerId,
            );
          }
        } else {
          console.warn(
            "[PlayerDeathSystem] EquipmentSystem not available, only inventory items will drop",
          );
        }

        itemsToDrop = [...inventoryItems, ...equipmentItems];
        const zoneType = this.zoneDetection.getZoneType(deathPosition);

        if (zoneType === ZoneType.SAFE_AREA) {
          this.pendingGravestones.set(playerId, {
            position: deathPosition,
            items: itemsToDrop,
            killedBy,
            zoneType,
          });

          await this.deathStateManager.createDeathLock(
            playerId,
            {
              gravestoneId: "",
              position: deathPosition,
              zoneType: ZoneType.SAFE_AREA,
              itemCount: itemsToDrop.length,
            },
            tx,
          );
        } else {
          await this.wildernessHandler.handleDeath(
            playerId,
            deathPosition,
            itemsToDrop,
            killedBy,
            zoneType,
            tx,
          );
        }

        await inventorySystem.clearInventoryImmediate(playerId);

        if (equipmentSystem && equipmentSystem.clearEquipmentImmediate) {
          await equipmentSystem.clearEquipmentImmediate(playerId);
        }
      });

      this.postDeathCleanup(playerId, deathPosition, itemsToDrop, killedBy);
    } catch (error) {
      console.error(
        `[PlayerDeathSystem] Death transaction failed for ${playerId}:`,
        error,
      );
      throw error;
    }
  }

  private postDeathCleanup(
    playerId: string,
    deathPosition: { x: number; y: number; z: number },
    itemsToDrop: InventoryItem[],
    _killedBy: string,
  ): void {
    const deathData: DeathLocationData = {
      playerId,
      deathPosition,
      timestamp: Date.now(),
      items: itemsToDrop,
    };
    this.deathLocations.set(playerId, deathData);

    // Set player as dead and disable movement
    this.emitTypedEvent(EventType.PLAYER_SET_DEAD, {
      playerId,
      isDead: true,
      deathPosition,
    });

    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity && "data" in playerEntity) {
      const entityData = playerEntity.data as { e?: string; visible?: boolean };
      entityData.visible = true;

      const typedPlayerEntity = playerEntity as PlayerEntityLike;
      if (typedPlayerEntity.emote !== undefined) {
        typedPlayerEntity.emote = "death";
      }
      if (typedPlayerEntity.data) {
        typedPlayerEntity.data.e = "death";
      }

      if ("markNetworkDirty" in playerEntity) {
        (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
      }
    }

    const DEATH_ANIMATION_DURATION = ticksToMs(
      COMBAT_CONSTANTS.DEATH.ANIMATION_TICKS,
    );
    const respawnTimer = setTimeout(() => {
      if (playerEntity && "data" in playerEntity) {
        const entityData = playerEntity.data as {
          e?: string;
          visible?: boolean;
        };
        entityData.visible = false;
        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }
      }

      this.initiateRespawn(playerId);
    }, DEATH_ANIMATION_DURATION);

    this.respawnTimers.set(playerId, respawnTimer);
  }

  private async createHeadstoneEntity(
    playerId: string,
    position: { x: number; y: number; z: number },
    items: InventoryItem[],
    killedBy: string,
  ): Promise<void> {
    const headstoneId = `headstone_${playerId}_${Date.now()}`;

    // Get player's name from entity or use playerId
    const playerEntity = this.world.entities?.get?.(playerId);
    const typedEntity = playerEntity as PlayerEntityLike | undefined;
    const playerName = typedEntity?.data?.name || playerId;

    // Get EntityManager to spawn headstone
    const entityManager = this.world.getSystem<EntityManager>("entity-manager");
    if (!entityManager) {
      console.error(
        "[PlayerDeathSystem] EntityManager not found, cannot spawn headstone",
      );
      return;
    }

    // Ground headstone to terrain (same as LootSystem does)
    const groundedPosition = groundToTerrain(
      this.world,
      position,
      0.2,
      Infinity,
    );

    // Create headstone entity config (same format as LootSystem uses for mob corpses)
    const headstoneConfig: HeadstoneEntityConfig = {
      id: headstoneId,
      name: `${playerName}'s Grave`,
      type: EntityType.HEADSTONE,
      position: groundedPosition,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.LOOT,
      interactionDistance: 2,
      description: `${playerName}'s grave`,
      model: null,
      headstoneData: {
        playerId,
        playerName,
        deathTime: Date.now(),
        deathMessage: `Killed by ${killedBy}`,
        position: groundedPosition,
        items: [...items],
        itemCount: items.length,
        despawnTime: Date.now() + ticksToMs(COMBAT_CONSTANTS.GRAVESTONE_TICKS), // 5 minutes for player graves
      },
      properties: {
        movementComponent: null,
        combatComponent: null,
        healthComponent: null,
        visualComponent: null,
        health: { current: 1, max: 1 },
        level: 1,
      },
    };

    // Spawn the headstone entity
    const headstoneEntity = await entityManager.spawnEntity(headstoneConfig);
    if (!headstoneEntity) {
      console.error(
        "[PlayerDeathSystem] Failed to spawn headstone entity for player",
        playerId,
      );
      return;
    }

    const deathData = this.deathLocations.get(playerId) as
      | DeathLocationDataWithHeadstone
      | undefined;
    if (deathData) {
      deathData.headstoneId = headstoneId;
    }
  }

  private initiateRespawn(playerId: string): void {
    this.respawnTimers.delete(playerId);

    const deathData = this.deathLocations.get(playerId);
    if (!deathData) {
      throw new Error(
        `[PlayerDeathSystem] No death data found for player ${playerId}`,
      );
    }

    const DEATH_RESPAWN_POSITION =
      COMBAT_CONSTANTS.DEATH.DEFAULT_RESPAWN_POSITION;
    const DEATH_RESPAWN_TOWN = COMBAT_CONSTANTS.DEATH.DEFAULT_RESPAWN_TOWN;

    this.respawnPlayer(playerId, DEATH_RESPAWN_POSITION, DEATH_RESPAWN_TOWN);

    const gravestoneData = this.pendingGravestones.get(playerId);
    if (gravestoneData && gravestoneData.items.length > 0) {
      this.spawnGravestoneAfterRespawn(
        playerId,
        gravestoneData.position,
        gravestoneData.items,
        gravestoneData.killedBy,
      );
      this.pendingGravestones.delete(playerId);
    }
  }

  private respawnPlayer(
    playerId: string,
    spawnPosition: { x: number; y: number; z: number },
    townName: string,
  ): void {
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity) {
      if ("setHealth" in playerEntity && "getMaxHealth" in playerEntity) {
        const typedEntity = playerEntity as PlayerEntityLike;
        const maxHealth = typedEntity.getMaxHealth?.() ?? 100;
        typedEntity.setHealth?.(maxHealth);
      }

      if ("data" in playerEntity) {
        const entityData = playerEntity.data as {
          e?: string;
          visible?: boolean;
        };

        entityData.e = "idle";
        entityData.visible = true;

        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }
      }
    }

    // Ground to terrain (use same logic as initial player spawn)
    const terrainSystem = this.world.getSystem(
      "terrain",
    ) as unknown as TerrainSystemLike | null;
    let groundedY = spawnPosition.y;

    if (terrainSystem && terrainSystem.isReady && terrainSystem.isReady()) {
      // Get terrain height at respawn position
      const terrainHeight = terrainSystem.getHeightAt(
        spawnPosition.x,
        spawnPosition.z,
      );
      if (Number.isFinite(terrainHeight)) {
        // Use +0.1 offset like initial spawn (not +2.0)
        groundedY = terrainHeight + 0.1;
      } else {
        groundedY = 10; // Fallback safe height
      }
    } else {
      // Terrain not ready; use safe height
      groundedY = 10;
    }

    const groundedPosition = {
      x: spawnPosition.x,
      y: groundedY,
      z: spawnPosition.z,
    };

    if (playerEntity) {
      if ("node" in playerEntity && playerEntity.node) {
        const typedEntity = playerEntity as PlayerEntityLike;
        typedEntity.node?.position.set(
          groundedPosition.x,
          groundedPosition.y,
          groundedPosition.z,
        );
      }

      if ("data" in playerEntity) {
        const entityData = playerEntity.data as {
          position?: number[];
        };

        if (Array.isArray(entityData.position)) {
          entityData.position[0] = groundedPosition.x;
          entityData.position[1] = groundedPosition.y;
          entityData.position[2] = groundedPosition.z;
        }

        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }
      }

      if ("position" in playerEntity && playerEntity.position) {
        const pos = playerEntity.position as {
          x: number;
          y: number;
          z: number;
        };
        pos.x = groundedPosition.x;
        pos.y = groundedPosition.y;
        pos.z = groundedPosition.z;
      }
    }

    // Send teleport packet to client
    if (this.world.network && "sendTo" in this.world.network) {
      (this.world.network as NetworkLike).sendTo(playerId, "playerTeleport", {
        playerId,
        position: [groundedPosition.x, groundedPosition.y, groundedPosition.z],
      });
    }

    this.emitTypedEvent(EventType.PLAYER_RESPAWNED, {
      playerId,
      spawnPosition: groundedPosition,
      townName,
      deathLocation: this.deathLocations.get(playerId)?.deathPosition,
    });

    this.emitTypedEvent(EventType.PLAYER_SET_DEAD, {
      playerId,
      isDead: false,
    });

    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: `You have respawned in ${townName}. Your items are where you died.`,
      type: "info",
    });

    // Clear death lock after successful respawn
    this.deathStateManager.clearDeathLock(playerId);
  }

  private async spawnGravestoneAfterRespawn(
    playerId: string,
    position: { x: number; y: number; z: number },
    items: InventoryItem[],
    killedBy: string,
  ): Promise<void> {
    const entityManager = this.world.getSystem(
      "entity-manager",
    ) as EntityManager | null;
    if (!entityManager) {
      console.error(
        "[PlayerDeathSystem] EntityManager not available, cannot spawn gravestone",
      );
      return;
    }

    const gravestoneId = `gravestone_${playerId}_${Date.now()}`;
    const GRAVESTONE_DURATION = ticksToMs(COMBAT_CONSTANTS.GRAVESTONE_TICKS);
    const despawnTime = Date.now() + GRAVESTONE_DURATION;

    // Ground to terrain
    const groundedPosition = groundToTerrain(
      this.world,
      position,
      0.2,
      Infinity,
    );

    // Create gravestone entity config
    const gravestoneConfig: HeadstoneEntityConfig = {
      id: gravestoneId,
      name: `${playerId}'s Gravestone`,
      type: EntityType.HEADSTONE,
      position: groundedPosition,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.LOOT,
      interactionDistance: 2,
      description: `Gravestone of ${playerId} (killed by ${killedBy})`,
      model: "models/environment/gravestone.glb",
      headstoneData: {
        playerId: playerId,
        playerName: playerId,
        deathTime: Date.now(),
        deathMessage: `Slain by ${killedBy}`,
        position: groundedPosition,
        items: items,
        itemCount: items.length,
        despawnTime: despawnTime,
        lootProtectionUntil: 0, // No loot protection (anyone can loot)
        protectedFor: undefined,
      },
      properties: {
        movementComponent: null,
        combatComponent: null,
        healthComponent: null,
        visualComponent: null,
        health: { current: 1, max: 1 },
        level: 1,
      },
    };

    const gravestoneEntity = await entityManager.spawnEntity(gravestoneConfig);

    if (!gravestoneEntity) {
      console.error(
        `[PlayerDeathSystem] Failed to spawn gravestone entity: ${gravestoneId}`,
      );
      return;
    }

    setTimeout(() => {
      this.handleGravestoneExpire(
        playerId,
        gravestoneId,
        groundedPosition,
        items,
      );
    }, GRAVESTONE_DURATION);
  }

  private async handleGravestoneExpire(
    playerId: string,
    gravestoneId: string,
    position: { x: number; y: number; z: number },
    items: InventoryItem[],
  ): Promise<void> {
    // Destroy gravestone entity
    const entityManager = this.world.getSystem(
      "entity-manager",
    ) as EntityManager | null;
    if (entityManager) {
      entityManager.destroyEntity(gravestoneId);
    }

    // Spawn ground items (2 minute despawn timer)
    const GROUND_ITEM_DURATION = ticksToMs(
      COMBAT_CONSTANTS.GROUND_ITEM_DESPAWN_TICKS,
    );
    await this.groundItemSystem.spawnGroundItems(items, position, {
      despawnTime: GROUND_ITEM_DURATION,
      droppedBy: playerId,
      lootProtection: 0,
      scatter: true,
      scatterRadius: 2.0,
    });
  }

  private handleRespawnRequest(data: { playerId: string }): void {
    // Allow immediate respawn if timer is still active (e.g., clicked respawn button)
    const timer = this.respawnTimers.get(data.playerId);
    if (timer) {
      clearTimeout(timer);
      this.respawnTimers.delete(data.playerId);
      this.initiateRespawn(data.playerId);
    }
  }

  private async handlePlayerReconnect(data: {
    playerId: string;
  }): Promise<void> {
    if (!this.world.isServer) {
      return; // Only server validates death state
    }

    await this.onPlayerReconnect(data.playerId);
  }

  /** Validates death state on reconnect - blocks inventory load if death lock exists */
  async onPlayerReconnect(playerId: string): Promise<{
    blockInventoryLoad: boolean;
  }> {
    const deathLock = await this.deathStateManager.getDeathLock(playerId);

    if (deathLock) {
      // Check if death lock is stale (older than 1 hour)
      // Stale death locks should be cleared, not restored
      const MAX_DEATH_LOCK_AGE = ticksToMs(
        COMBAT_CONSTANTS.DEATH.STALE_LOCK_AGE_TICKS,
      );
      const deathAge = Date.now() - deathLock.timestamp;

      if (deathAge > MAX_DEATH_LOCK_AGE) {
        await this.deathStateManager.clearDeathLock(playerId);
        return { blockInventoryLoad: false };
      }

      // Restore death location to memory
      this.deathLocations.set(playerId, {
        playerId,
        deathPosition: deathLock.position,
        timestamp: deathLock.timestamp,
        items: [], // Items are in gravestone/ground, not in memory
      });

      // Immediately trigger respawn (RuneScape-style - no waiting, no screen)
      // Very short delay, then auto-respawn (just enough for world to load)
      setTimeout(() => {
        this.initiateRespawn(playerId);
      }, ticksToMs(COMBAT_CONSTANTS.DEATH.RECONNECT_RESPAWN_DELAY_TICKS));

      // Block inventory load until respawn
      return { blockInventoryLoad: true };
    }

    return { blockInventoryLoad: false };
  }

  private handleLootCollection(data: { playerId: string }): void {
    const deathData = this.deathLocations.get(data.playerId);
    if (!deathData) {
      return;
    }

    // Check if player is near their death location (within 3 meters) - reactive pattern
    const playerPosition = this.playerPositions.get(data.playerId);
    if (!playerPosition) {
      this.logger.error(`Could not get position for player ${data.playerId}`);
      return;
    }

    const distance = calculateDistance(playerPosition, deathData.deathPosition);

    if (distance > 3) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.playerId,
        message: "You need to be closer to your grave to collect your items.",
        type: "error",
      });
      return;
    }

    // Return all items to player
    let returnedItems = 0;
    for (const item of deathData.items) {
      this.emitTypedEvent(EventType.INVENTORY_CAN_ADD, {
        playerId: data.playerId,
        item: item,
        callback: (canAdd: boolean) => {
          if (canAdd) {
            this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
              playerId: data.playerId,
              item: item,
            });
            returnedItems++;
          } else {
            // If inventory full, create ground item
            this.emitTypedEvent(EventType.WORLD_CREATE_GROUND_ITEM, {
              position: playerPosition,
              item: item,
            });
          }
        },
      });
    }

    // Clear death location and timers
    this.clearDeathLocation(data.playerId);

    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId: data.playerId,
      message: `Retrieved ${returnedItems} items from your grave.`,
      type: "success",
    });
  }

  private despawnDeathItems(playerId: string): void {
    const deathData = this.deathLocations.get(playerId) as
      | DeathLocationDataWithHeadstone
      | undefined;
    if (!deathData) return;

    const headstoneId = deathData.headstoneId;
    if (headstoneId) {
      const entityManager =
        this.world.getSystem<EntityManager>("entity-manager");
      if (entityManager) {
        entityManager.destroyEntity(headstoneId);
      }
    }

    this.clearDeathLocation(playerId);

    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "Your death items have despawned due to timeout.",
      type: "warning",
    });
  }

  private clearDeathLocation(playerId: string): void {
    // Clear all data and timers for this player's death
    this.deathLocations.delete(playerId);

    const respawnTimer = this.respawnTimers.get(playerId);
    if (respawnTimer) {
      clearTimeout(respawnTimer);
      this.respawnTimers.delete(playerId);
    }
  }

  private cleanupPlayerDeath(data: { id: string }): void {
    const playerId = data.id;
    this.clearDeathLocation(playerId);
    this.playerPositions.delete(playerId);
  }

  private handleHeadstoneExpired(data: {
    headstoneId: string;
    playerId: string;
  }): void {
    this.despawnDeathItems(data.playerId);
  }

  private async handleCorpseEmpty(data: {
    corpseId: string;
    playerId: string;
  }): Promise<void> {
    await this.deathStateManager.clearDeathLock(data.playerId);
  }

  getDeathLocation(playerId: string): DeathLocationData | undefined {
    return this.deathLocations.get(playerId);
  }

  getAllDeathLocations(): DeathLocationData[] {
    return Array.from(this.deathLocations.values());
  }

  isPlayerDead(playerId: string): boolean {
    return this.deathLocations.has(playerId);
  }

  getRemainingRespawnTime(playerId: string): number {
    const deathData = this.deathLocations.get(playerId);
    if (!deathData) return 0;

    const elapsed = Date.now() - deathData.timestamp;
    return Math.max(
      0,
      ticksToMs(COMBAT_CONSTANTS.DEATH.ANIMATION_TICKS) - elapsed,
    );
  }

  getRemainingDespawnTime(playerId: string): number {
    const deathData = this.deathLocations.get(playerId);
    if (!deathData) return 0;

    const elapsed = Date.now() - deathData.timestamp;
    return Math.max(0, ticksToMs(COMBAT_CONSTANTS.GRAVESTONE_TICKS) - elapsed);
  }

  forceRespawn(playerId: string): void {
    this.handleRespawnRequest({ playerId });
  }

  // Headstone API (now uses EntityManager instead of HeadstoneApp objects)
  getPlayerHeadstoneId(playerId: string): string | undefined {
    const deathData = this.deathLocations.get(playerId) as
      | DeathLocationDataWithHeadstone
      | undefined;
    if (!deathData) return undefined;
    return deathData.headstoneId;
  }

  // Required System lifecycle methods
  preTick(): void {}
  preFixedUpdate(): void {}
  fixedUpdate(_dt: number): void {}
  postFixedUpdate(): void {}
  preUpdate(): void {}
  update(_dt: number): void {
    // HeadstoneEntity handles its own updates via EntityManager
  }

  postUpdate(): void {}
  lateUpdate(): void {}
  postLateUpdate(): void {}
  commit(): void {}
  postTick(): void {}

  processTick(currentTick: number): void {
    if (this.safeAreaHandler) {
      this.safeAreaHandler.processTick(currentTick);
    }
  }
}
