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
import {
  EntityType,
  InteractionType,
  DeathState,
} from "../../../types/entities";
import type { HeadstoneEntityConfig } from "../../../types/entities";
import type { EntityManager } from "..";
import { ZoneDetectionSystem } from "../death/ZoneDetectionSystem";
import type { GroundItemSystem } from "../economy/GroundItemSystem";
import { DeathStateManager } from "../death/DeathStateManager";
import { SafeAreaDeathHandler } from "../death/SafeAreaDeathHandler";
import { WildernessDeathHandler } from "../death/WildernessDeathHandler";
import { ZoneType, type TransactionContext } from "../../../types/death";
import type { InventorySystem } from "../character/InventorySystem";
import { getEntityPosition } from "../../../utils/game/EntityPositionUtils";
import { STARTER_TOWNS } from "../../../data/world-areas";

/**
 * Sanitize killedBy string to prevent injection attacks
 * - Normalizes Unicode to prevent homograph attacks (Cyrillic 'а' vs Latin 'a')
 * - Removes zero-width characters and BiDi overrides that could manipulate display
 * - Removes control characters and dangerous HTML characters
 * - Limits length to prevent buffer overflow attacks
 * - Defaults to "unknown" for invalid inputs
 */
function sanitizeKilledBy(killedBy: unknown): string {
  if (typeof killedBy !== "string" || !killedBy) {
    return "unknown";
  }

  // Normalize Unicode to NFKC form to prevent homograph attacks
  const normalized = killedBy.normalize("NFKC");

  // Build sanitized string character by character
  let sanitized = "";
  for (const char of normalized) {
    const code = char.charCodeAt(0);

    // Skip zero-width characters (U+200B-U+200D, U+FEFF)
    if (code >= 0x200b && code <= 0x200d) continue;
    if (code === 0xfeff) continue;

    // Skip BiDi override characters (U+202A-U+202E)
    if (code >= 0x202a && code <= 0x202e) continue;

    // Skip control characters (0x00-0x1F and 0x7F)
    if (code < 32 || code === 127) continue;

    // Skip dangerous HTML characters
    if ("<>'\"&".includes(char)) continue;

    sanitized += char;
  }

  sanitized = sanitized.trim().substring(0, 64); // Limit to 64 characters
  return sanitized || "unknown";
}

/**
 * Position validation constants
 */
const POSITION_VALIDATION = {
  WORLD_BOUNDS: 10000, // Max 10km from origin
  MAX_HEIGHT: 500, // Max height
  MIN_HEIGHT: -50, // Allow some underground (caves)
} as const;

/**
 * Check if a number is valid for position use
 */
function isValidPositionNumber(n: number): boolean {
  return Number.isFinite(n) && !Number.isNaN(n);
}

/**
 * Validate and clamp a position to world bounds
 * @param position - Position to validate
 * @returns Validated and clamped position, or null if completely invalid
 */
function validatePosition(position: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number } | null {
  const { x, y, z } = position;

  // Check for invalid numbers (NaN, Infinity)
  if (
    !isValidPositionNumber(x) ||
    !isValidPositionNumber(y) ||
    !isValidPositionNumber(z)
  ) {
    return null;
  }

  // Clamp to world bounds
  return {
    x: Math.max(
      -POSITION_VALIDATION.WORLD_BOUNDS,
      Math.min(POSITION_VALIDATION.WORLD_BOUNDS, x),
    ),
    y: Math.max(
      POSITION_VALIDATION.MIN_HEIGHT,
      Math.min(POSITION_VALIDATION.MAX_HEIGHT, y),
    ),
    z: Math.max(
      -POSITION_VALIDATION.WORLD_BOUNDS,
      Math.min(POSITION_VALIDATION.WORLD_BOUNDS, z),
    ),
  };
}

/**
 * Check if position is within world bounds without clamping
 */
function isPositionInBounds(position: {
  x: number;
  y: number;
  z: number;
}): boolean {
  return (
    Math.abs(position.x) <= POSITION_VALIDATION.WORLD_BOUNDS &&
    Math.abs(position.z) <= POSITION_VALIDATION.WORLD_BOUNDS &&
    position.y >= POSITION_VALIDATION.MIN_HEIGHT &&
    position.y <= POSITION_VALIDATION.MAX_HEIGHT
  );
}

interface PlayerSystemLike {
  players?: Map<string, { position?: { x: number; y: number; z: number } }>;
}

interface DatabaseSystemLike {
  executeInTransaction: (
    fn: (tx: TransactionContext) => Promise<void>,
  ) => Promise<void>;
}

interface EquipmentSystemLike {
  getPlayerEquipment: (playerId: string) => EquipmentData | null;
  clearEquipmentImmediate?: (playerId: string) => Promise<void>;
  // Atomic clear-and-return for death system
  clearEquipmentAndReturn?: (
    playerId: string,
    tx?: TransactionContext,
  ) => Promise<Array<{ itemId: string; slot: string; quantity: number }>>;
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

interface TickSystemLike {
  getCurrentTick: () => number;
  onTick: (
    callback: (tickNumber: number, deltaMs: number) => void,
    priority?: number,
  ) => () => void;
}

interface PlayerEntityLike {
  emote?: string;
  data?: {
    e?: string;
    visible?: boolean;
    name?: string;
    position?: number[];
    // Death state fields (single source of truth)
    deathState?: DeathState;
    deathPosition?: [number, number, number];
    respawnTick?: number;
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

  // Tick-based respawn system (AAA quality - deterministic timing)
  private tickSystem: TickSystemLike | null = null;
  private tickUnsubscribe: (() => void) | null = null;

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
        optional: ["inventory", "entity-manager", "database"], // database for death persistence (server only)
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

    // Register for tick-based respawn processing (AAA quality - deterministic timing)
    // TickSystem is only available on server
    if (this.world.isServer) {
      const tickSystemRaw = this.world.getSystem("tick");
      if (
        tickSystemRaw &&
        "getCurrentTick" in tickSystemRaw &&
        "onTick" in tickSystemRaw
      ) {
        this.tickSystem = tickSystemRaw as unknown as TickSystemLike;
        // Priority 3 = AI priority, runs after combat
        this.tickUnsubscribe = this.tickSystem.onTick(
          (tickNumber) => this.processPendingRespawns(tickNumber),
          3,
        );
      }
    }

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

  /**
   * Start - called after all systems are initialized
   * Delegates to DeathStateManager to recover unfinished deaths
   */
  async start(): Promise<void> {
    await this.deathStateManager.start();
  }

  destroy(): void {
    // Unsubscribe from tick system
    if (this.tickUnsubscribe) {
      this.tickUnsubscribe();
      this.tickUnsubscribe = null;
    }

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

    // Clean up all Maps to prevent memory leaks
    this.respawnTimers.clear();
    this.deathLocations.clear();
    this.playerPositions.clear();
    this.playerInventories.clear();
    this.pendingGravestones.clear();
    this.lastDeathTime.clear();
  }

  private handlePlayerDeath(data: {
    entityId: string;
    killedBy: string;
    entityType: "player" | "mob";
    deathPosition?: { x: number; y: number; z: number };
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

    // CRITICAL: Use position from event first (captured at exact moment of death)
    // Fall back to cache only if event doesn't include position
    let deathPosition = data.deathPosition;
    if (!deathPosition) {
      deathPosition = this.playerPositions.get(playerId);
    }
    if (!deathPosition) {
      const playerEntity = this.world.entities?.get?.(playerId);
      if (playerEntity) {
        const entityPos = getEntityPosition(playerEntity);
        if (entityPos) {
          deathPosition = { x: entityPos.x, y: entityPos.y, z: entityPos.z };
        }
      }
    }

    // Check if player is in an active duel - DuelSystem handles duel deaths
    // No gravestone or item drops should occur during duels (OSRS-accurate)
    const duelSystem = this.world.getSystem?.("duel") as {
      isPlayerInActiveDuel?: (playerId: string) => boolean;
    } | null;

    if (duelSystem?.isPlayerInActiveDuel?.(playerId)) {
      console.log(
        `[PlayerDeathSystem] Player ${playerId} died in duel - playing death animation only (no item drops)`,
      );

      // CRITICAL: Cancel any scheduled emote resets BEFORE emitting death event
      // This prevents race conditions where a scheduled "idle" reset overwrites death animation
      const combatSystem = this.world.getSystem?.("combat") as {
        animationManager?: { cancelEmoteReset?: (entityId: string) => void };
      } | null;
      if (combatSystem?.animationManager?.cancelEmoteReset) {
        combatSystem.animationManager.cancelEmoteReset(playerId);
        console.log(
          `[PlayerDeathSystem] Cancelled scheduled emote reset for duel death: ${playerId}`,
        );
      }

      // Still emit death state and play animation for duel deaths
      // DuelSystem handles stakes/respawn, but we need the visual feedback
      // CRITICAL: Include deathPosition so clients can properly position the death animation
      this.emitTypedEvent(EventType.PLAYER_SET_DEAD, {
        playerId,
        isDead: true,
        deathPosition: deathPosition
          ? [deathPosition.x, deathPosition.y, deathPosition.z]
          : undefined,
      });

      // Set death animation on entity
      const playerEntity = this.world.entities?.get?.(playerId);
      if (playerEntity && "data" in playerEntity) {
        const typedPlayerEntity = playerEntity as PlayerEntityLike;
        if (typedPlayerEntity.emote !== undefined) {
          typedPlayerEntity.emote = "death";
        }
        if (typedPlayerEntity.data) {
          typedPlayerEntity.data.e = "death";
          typedPlayerEntity.data.deathState = DeathState.DYING;
          console.log(
            `[PlayerDeathSystem] Set death animation for duel death: ${playerId}, e=${typedPlayerEntity.data.e}`,
          );
        }
        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }
      } else {
        console.warn(
          `[PlayerDeathSystem] Could not find entity to set death animation: ${playerId}`,
        );
      }

      return;
    }

    // Use the deathPosition already captured at the top of this function
    // (from event data first, then fallbacks)
    let position = deathPosition;

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
    killedByRaw: string,
  ): Promise<void> {
    // Sanitize killedBy input to prevent injection attacks
    const killedBy = sanitizeKilledBy(killedByRaw);
    // Server-only - prevent client from triggering death events
    if (!this.world.isServer) {
      console.error(
        `[PlayerDeathSystem] Client attempted server-only death processing for ${playerId}`,
      );
      return;
    }

    // Validate death position using extracted helper
    let validatedPosition = validatePosition(deathPosition);

    if (!validatedPosition) {
      console.error(
        `[PlayerDeathSystem] Invalid death position for ${playerId}: (${deathPosition.x}, ${deathPosition.y}, ${deathPosition.z}) - using player entity position`,
      );
      // Try to get player's actual position as fallback
      const playerEntity = this.world.entities.get(playerId);
      if (playerEntity?.position) {
        validatedPosition = validatePosition(playerEntity.position);
      }
      if (!validatedPosition) {
        console.error(
          `[PlayerDeathSystem] Cannot determine valid death position for ${playerId} - aborting`,
        );
        return;
      }
    }

    // Check bounds and log warning if clamped
    if (!isPositionInBounds(deathPosition)) {
      console.warn(
        `[PlayerDeathSystem] Death position out of bounds for ${playerId}: (${deathPosition.x}, ${deathPosition.y}, ${deathPosition.z}) - clamped`,
      );
    }

    // Use validated position from here on
    deathPosition = validatedPosition;

    // Cache Date.now() to avoid multiple system calls
    const now = Date.now();

    const lastDeath = this.lastDeathTime.get(playerId) || 0;
    if (now - lastDeath < this.DEATH_COOLDOWN) {
      console.warn(`[PlayerDeathSystem] Death spam: ${playerId}`);
      return;
    }

    // Check for existing death lock - if player dies again before looting, clear old one
    // This matches OSRS behavior where dying again replaces your old gravestone
    const existingDeathLock =
      await this.deathStateManager.getDeathLock(playerId);
    if (existingDeathLock) {
      console.log(
        `[PlayerDeathSystem] Player ${playerId} dying again with existing death lock - clearing old gravestone (items lost)`,
      );
      await this.deathStateManager.clearDeathLock(playerId);
    }

    // Update last death time (use cached timestamp)
    this.lastDeathTime.set(playerId, now);

    // Set death state IMMEDIATELY to block any incoming loot/pickup requests
    // This must happen BEFORE the transaction to prevent race conditions where
    // items are looted between inventory snapshot and clear
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity && "data" in playerEntity) {
      const typedPlayerEntity = playerEntity as PlayerEntityLike;
      if (typedPlayerEntity.data) {
        typedPlayerEntity.data.deathState = DeathState.DYING;
        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }
      }
    }

    // Emit PLAYER_SET_DEAD immediately so client can block loot window
    // This must happen BEFORE the transaction so the client knows to reject clicks
    this.emitTypedEvent(EventType.PLAYER_SET_DEAD, {
      playerId,
      isDead: true,
    });

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
      await databaseSystem.executeInTransaction(
        async (tx: TransactionContext) => {
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

          // Use atomic clearEquipmentAndReturn to prevent race condition
          // This atomically reads AND clears equipment in one operation,
          // preventing item duplication if server crashes between read and clear.
          let equipmentItems: InventoryItem[] = [];
          if (equipmentSystem) {
            if (equipmentSystem.clearEquipmentAndReturn) {
              // NEW: Atomic read-and-clear operation
              const clearedEquipment =
                await equipmentSystem.clearEquipmentAndReturn(playerId, tx);
              equipmentItems = clearedEquipment.map((item, index) => ({
                id: `death_equip_${playerId}_${Date.now()}_${index}`,
                itemId: item.itemId,
                quantity: item.quantity,
                slot: -1, // Equipment items don't have inventory slots
                metadata: null,
              }));
            } else {
              // Fallback to old method if clearEquipmentAndReturn not available
              const equipment = equipmentSystem.getPlayerEquipment(playerId);
              if (equipment) {
                equipmentItems = this.convertEquipmentToInventoryItems(
                  equipment,
                  playerId,
                );
              }
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

            // Include items and killedBy for crash recovery
            await this.deathStateManager.createDeathLock(
              playerId,
              {
                gravestoneId: "",
                position: deathPosition,
                zoneType: ZoneType.SAFE_AREA,
                itemCount: itemsToDrop.length,
                items: itemsToDrop.map((item) => ({
                  itemId: item.itemId,
                  quantity: item.quantity,
                })),
                killedBy,
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

          // Clear inventory (equipment already cleared atomically above)
          await inventorySystem.clearInventoryImmediate(playerId);

          // Only call old clearEquipmentImmediate if atomic method wasn't used
          if (
            equipmentSystem &&
            !equipmentSystem.clearEquipmentAndReturn &&
            equipmentSystem.clearEquipmentImmediate
          ) {
            await equipmentSystem.clearEquipmentImmediate(playerId);
          }
        },
      );

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

    // PVP XP: Emit COMBAT_KILL event if killed by another player
    // This allows SkillsSystem to award XP for PvP kills
    this.emitCombatKillForPvP(playerId);

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

        // AAA QUALITY: Set entity death state (single source of truth)
        typedPlayerEntity.data.deathState = DeathState.DYING;
        typedPlayerEntity.data.deathPosition = [
          deathPosition.x,
          deathPosition.y,
          deathPosition.z,
        ];

        // Calculate respawn tick using tick system
        // Use safe addition to prevent integer overflow
        const currentTick = this.tickSystem?.getCurrentTick() ?? 0;
        const animationTicks = COMBAT_CONSTANTS.DEATH.ANIMATION_TICKS;
        // Cap at 32-bit max to prevent overflow during serialization (MessagePack, etc.)
        const MAX_TICK = 2147483647; // 2^31-1, safe for 32-bit serialization
        const MAX_SAFE_TICK = MAX_TICK - animationTicks;
        typedPlayerEntity.data.respawnTick =
          currentTick > MAX_SAFE_TICK ? MAX_TICK : currentTick + animationTicks;
      }

      if ("markNetworkDirty" in playerEntity) {
        (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
      }
    }

    // Fallback: Use setTimeout if tick system is not available (e.g., client-side)
    // This maintains backward compatibility while preferring tick-based timing
    if (!this.tickSystem) {
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
            (
              playerEntity as { markNetworkDirty: () => void }
            ).markNetworkDirty();
          }
        }

        this.initiateRespawn(playerId).catch((err) => {
          console.error(
            `[PlayerDeathSystem] Respawn failed for ${playerId}:`,
            err,
          );
        });
      }, DEATH_ANIMATION_DURATION);

      this.respawnTimers.set(playerId, respawnTimer);
    }
    // Note: If tickSystem is available, respawn is handled by processPendingRespawns()
  }

  /**
   * Emit COMBAT_KILL event for PvP kills so SkillsSystem can award XP.
   * Uses CombatStateService to find the attacker who killed the player.
   */
  private emitCombatKillForPvP(deadPlayerId: string): void {
    // Get CombatSystem to access stateService
    const combatSystem = this.world.getSystem("combat") as {
      stateService?: {
        getAttackersTargeting: (
          entityId: string,
        ) => Array<{ toString: () => string }>;
        getCombatData: (entityId: string) => {
          attackerType: "player" | "mob";
        } | null;
      };
    } | null;

    if (!combatSystem?.stateService) {
      return;
    }

    // Get all attackers who were targeting the dead player
    const attackers =
      combatSystem.stateService.getAttackersTargeting(deadPlayerId);
    if (attackers.length === 0) {
      return;
    }

    // Get dead player's max health for damage calculation (same approach as MobEntity)
    const deadPlayerEntity = this.world.entities?.get?.(deadPlayerId);
    let maxHealth = 10; // Default fallback
    if (deadPlayerEntity && "getMaxHealth" in deadPlayerEntity) {
      maxHealth =
        (deadPlayerEntity as { getMaxHealth: () => number }).getMaxHealth() ||
        10;
    }

    // Get PlayerSystem for attack style lookup
    const playerSystem = this.world.getSystem("player") as {
      getPlayerAttackStyle?: (playerId: string) => { id: string } | null;
    } | null;

    // Emit COMBAT_KILL for each player attacker (award XP to all who contributed)
    for (const attackerId of attackers) {
      const attackerIdStr = attackerId.toString();

      // Check if this attacker is a player (not a mob)
      const combatData = combatSystem.stateService.getCombatData(attackerIdStr);
      if (!combatData || combatData.attackerType !== "player") {
        continue;
      }

      // Get attacker's attack style
      const attackStyleData =
        playerSystem?.getPlayerAttackStyle?.(attackerIdStr);
      const attackStyle = attackStyleData?.id || "aggressive"; // Default to aggressive

      // Emit COMBAT_KILL event - SkillsSystem will handle XP distribution
      this.emitTypedEvent(EventType.COMBAT_KILL, {
        attackerId: attackerIdStr,
        targetId: deadPlayerId,
        damageDealt: maxHealth, // Use max health as damage (same as MobEntity)
        attackStyle: attackStyle,
      });
    }
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

  private async initiateRespawn(playerId: string): Promise<void> {
    this.respawnTimers.delete(playerId);
    console.log(`[PlayerDeathSystem] initiateRespawn called for ${playerId}`);

    const deathData = this.deathLocations.get(playerId);
    if (!deathData) {
      console.log(
        `[PlayerDeathSystem] No death data in deathLocations for ${playerId}, checking pendingGravestones...`,
      );
    }

    // Get spawn position from manifest starter town (Central Haven at origin)
    const centralHaven = STARTER_TOWNS["central_haven"];
    const spawnPosition = centralHaven
      ? {
          x: (centralHaven.bounds.minX + centralHaven.bounds.maxX) / 2,
          y: 0,
          z: (centralHaven.bounds.minZ + centralHaven.bounds.maxZ) / 2,
        }
      : COMBAT_CONSTANTS.DEATH.DEFAULT_RESPAWN_POSITION;
    const spawnTownName =
      centralHaven?.name ?? COMBAT_CONSTANTS.DEATH.DEFAULT_RESPAWN_TOWN;

    // CRITICAL: Must await to ensure death lock is cleared before next death
    await this.respawnPlayer(playerId, spawnPosition, spawnTownName);

    const gravestoneData = this.pendingGravestones.get(playerId);
    if (gravestoneData && gravestoneData.items.length > 0) {
      console.log(
        `[PlayerDeathSystem] ✓ Spawning gravestone for ${playerId} with ${gravestoneData.items.length} items at (${gravestoneData.position.x.toFixed(1)}, ${gravestoneData.position.y.toFixed(1)}, ${gravestoneData.position.z.toFixed(1)})`,
      );
      this.spawnGravestoneAfterRespawn(
        playerId,
        gravestoneData.position,
        gravestoneData.items,
        gravestoneData.killedBy,
      );
      this.pendingGravestones.delete(playerId);
    } else {
      console.log(
        `[PlayerDeathSystem] No pending gravestone data for ${playerId}`,
      );
    }
  }

  private async respawnPlayer(
    playerId: string,
    spawnPosition: { x: number; y: number; z: number },
    townName: string,
  ): Promise<void> {
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity) {
      if ("setHealth" in playerEntity && "getMaxHealth" in playerEntity) {
        const typedEntity = playerEntity as PlayerEntityLike;
        const maxHealth = typedEntity.getMaxHealth?.() ?? 100;
        typedEntity.setHealth?.(maxHealth);
      }

      if ("data" in playerEntity) {
        const typedPlayerEntity = playerEntity as PlayerEntityLike;
        const entityData = typedPlayerEntity.data!;

        entityData.e = "idle";
        entityData.visible = true;

        // AAA QUALITY: Clear death state (single source of truth)
        entityData.deathState = DeathState.ALIVE;
        entityData.deathPosition = undefined;
        entityData.respawnTick = undefined;

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
        // Player feet at ground level (no offset)
        groundedY = terrainHeight;
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

    // NOTE: Do NOT clear death lock here - it must persist for crash recovery!
    // Death lock is cleared when:
    // 1. All items are looted from gravestone (CORPSE_EMPTY event)
    // 2. Ground items despawn (timeout)
    // This ensures that if server crashes before items are looted, they can be recovered.

    // Clear death cooldown so player can die again immediately after respawn
    this.lastDeathTime.delete(playerId);
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

    // Get the player's display name from PlayerSystem
    const playerSystem = this.world.getSystem("player") as
      | { getPlayer: (id: string) => { name?: string } | undefined }
      | undefined;
    const playerFromSystem = playerSystem?.getPlayer?.(playerId);
    const playerEntity = this.world.entities?.get?.(playerId) as
      | { playerName?: string; name?: string }
      | undefined;
    const playerName =
      playerFromSystem?.name ||
      playerEntity?.playerName ||
      playerEntity?.name ||
      playerId;

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
      name: `${playerName}'s Gravestone`,
      type: EntityType.HEADSTONE,
      position: groundedPosition,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.LOOT,
      interactionDistance: 2,
      description: `Gravestone of ${playerName} (killed by ${killedBy})`,
      model: "models/environment/gravestone.glb",
      headstoneData: {
        playerId: playerId,
        playerName: playerName,
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
    console.log(
      `[PlayerDeathSystem] Gravestone ${gravestoneId} expired for ${playerId}, transitioning to ground items`,
    );

    // Destroy gravestone entity
    const entityManager = this.world.getSystem(
      "entity-manager",
    ) as EntityManager | null;
    if (entityManager) {
      entityManager.destroyEntity(gravestoneId);
    }

    // Spawn ground items (60 minute despawn timer)
    const GROUND_ITEM_DURATION = ticksToMs(
      COMBAT_CONSTANTS.GROUND_ITEM_DESPAWN_TICKS,
    );
    const groundItemIds = await this.groundItemSystem.spawnGroundItems(
      items,
      position,
      {
        despawnTime: GROUND_ITEM_DURATION,
        droppedBy: playerId,
        lootProtection: 0,
        scatter: true,
        scatterRadius: 2.0,
      },
    );

    // Update death lock to track ground items instead of gravestone
    await this.deathStateManager.onGravestoneExpired(playerId, groundItemIds);

    // Schedule death lock cleanup when ground items despawn
    // This ensures the death lock is cleared even if items aren't looted
    setTimeout(async () => {
      // Only clear if the player still has this death lock (hasn't died again)
      const currentLock = await this.deathStateManager.getDeathLock(playerId);
      if (currentLock && !currentLock.gravestoneId) {
        console.log(
          `[PlayerDeathSystem] Ground items despawned for ${playerId}, clearing death lock`,
        );
        await this.deathStateManager.clearDeathLock(playerId);
      }
    }, GROUND_ITEM_DURATION + 1000); // Add 1 second buffer
  }

  private handleRespawnRequest(data: { playerId: string }): void {
    // Allow immediate respawn if timer is still active (e.g., clicked respawn button)
    const timer = this.respawnTimers.get(data.playerId);
    if (timer) {
      clearTimeout(timer);
      this.respawnTimers.delete(data.playerId);
      this.initiateRespawn(data.playerId).catch((err) => {
        console.error(
          `[PlayerDeathSystem] Respawn request failed for ${data.playerId}:`,
          err,
        );
      });
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
    console.log(`[PlayerDeathSystem] onPlayerReconnect called for ${playerId}`);
    const deathLock = await this.deathStateManager.getDeathLock(playerId);

    if (deathLock) {
      console.log(
        `[PlayerDeathSystem] Found death lock for ${playerId}: ${deathLock.itemCount} items tracked, ${deathLock.items?.length || 0} items in recovery data`,
      );
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

      // Convert death lock items to InventoryItem format for gravestone
      const itemsFromDeathLock: InventoryItem[] = (deathLock.items || []).map(
        (item, index) => ({
          id: `recovery_${playerId}_${Date.now()}_${index}`,
          itemId: item.itemId,
          quantity: item.quantity,
          slot: index,
          metadata: null,
        }),
      );

      // Restore death location to memory WITH items from death lock
      this.deathLocations.set(playerId, {
        playerId,
        deathPosition: deathLock.position,
        timestamp: deathLock.timestamp,
        items: itemsFromDeathLock,
      });

      // Restore pendingGravestones so initiateRespawn will spawn the gravestone
      if (itemsFromDeathLock.length > 0) {
        this.pendingGravestones.set(playerId, {
          position: deathLock.position,
          items: itemsFromDeathLock,
          killedBy: deathLock.killedBy || "unknown",
          zoneType: deathLock.zoneType,
        });
        console.log(
          `[PlayerDeathSystem] ✓ Restored ${itemsFromDeathLock.length} items from death lock for ${playerId} - will spawn gravestone on respawn`,
        );
      } else {
        console.log(
          `[PlayerDeathSystem] No items to restore for ${playerId} - skipping gravestone spawn`,
        );
      }

      // Immediately trigger respawn (RuneScape-style - no waiting, no screen)
      // Very short delay, then auto-respawn (just enough for world to load)
      setTimeout(() => {
        this.initiateRespawn(playerId).catch((err) => {
          console.error(
            `[PlayerDeathSystem] Reconnect respawn failed for ${playerId}:`,
            err,
          );
        });
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
    this.lastDeathTime.delete(playerId);
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
    console.log(
      `[PlayerDeathSystem] All items looted from ${data.corpseId}, clearing death lock for ${data.playerId}`,
    );
    await this.deathStateManager.clearDeathLock(data.playerId);
  }

  getDeathLocation(playerId: string): DeathLocationData | undefined {
    // AAA QUALITY: Check entity deathPosition first (single source of truth)
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity && "data" in playerEntity) {
      const typedEntity = playerEntity as PlayerEntityLike;
      if (
        typedEntity.data?.deathState === DeathState.DYING &&
        typedEntity.data?.deathPosition
      ) {
        const [x, y, z] = typedEntity.data.deathPosition;
        return {
          playerId,
          deathPosition: { x, y, z },
          timestamp: Date.now(), // Not available from entity, use now
          items: this.deathLocations.get(playerId)?.items || [],
        };
      }
    }
    // Fallback to deathLocations Map for backward compatibility
    return this.deathLocations.get(playerId);
  }

  getAllDeathLocations(): DeathLocationData[] {
    return Array.from(this.deathLocations.values());
  }

  isPlayerDead(playerId: string): boolean {
    // AAA QUALITY: Check entity deathState first (single source of truth)
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity && "data" in playerEntity) {
      const typedEntity = playerEntity as PlayerEntityLike;
      if (typedEntity.data?.deathState) {
        return (
          typedEntity.data.deathState === DeathState.DYING ||
          typedEntity.data.deathState === DeathState.DEAD
        );
      }
    }
    // Fallback to deathLocations Map for backward compatibility
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

  /**
   * Tick-based respawn processing (AAA quality - deterministic timing)
   * Called every tick by TickSystem when registered.
   * Checks all players in DYING state and respawns them when respawnTick is reached.
   */
  private processPendingRespawns(currentTick: number): void {
    // Iterate over all player entities and check for pending respawns
    // Use world.entities.players to get the players Map
    const players = this.world.entities?.players;
    if (!players) return;

    for (const [playerId, playerEntity] of players) {
      const typedEntity = playerEntity as PlayerEntityLike;
      if (!typedEntity.data) continue;

      // Check if player is in DYING state and respawn tick has been reached
      if (
        typedEntity.data.deathState === DeathState.DYING &&
        typedEntity.data.respawnTick !== undefined &&
        currentTick >= typedEntity.data.respawnTick
      ) {
        // Hide player briefly before respawn
        typedEntity.data.visible = false;
        if ("markNetworkDirty" in playerEntity) {
          (playerEntity as { markNetworkDirty: () => void }).markNetworkDirty();
        }

        // Initiate respawn for this player
        this.initiateRespawn(playerId).catch((err) => {
          console.error(
            `[PlayerDeathSystem] Tick-based respawn failed for ${playerId}:`,
            err,
          );
        });
      }
    }
  }
}
