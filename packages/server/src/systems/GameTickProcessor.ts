/**
 * GameTickProcessor - OSRS-Accurate Tick Processing
 *
 * Implements Henke's Model for deterministic game tick processing:
 * 1. Client inputs processed (from previous tick)
 * 2. NPCs processed (in spawn order): timers → queues → movement → combat
 * 3. Players processed (in PID order): queues → timers → movement → combat
 * 4. Queued damage applied (OSRS damage asymmetry)
 * 5. State broadcast (batched)
 *
 * CRITICAL: NPCs process BEFORE players. This creates the asymmetric
 * damage timing that defines OSRS combat feel:
 * - NPC → Player damage: Same tick (NPC queues, Player processes same tick)
 * - Player → NPC damage: Next tick (Player queues, NPC processes next tick)
 *
 * @see https://oldschool.runescape.wiki/w/Game_tick
 * @see COMBAT_SYSTEM_AUDIT.md for full OSRS research
 */

import type { World } from "@hyperscape/shared";
import { EventType, TICK_DURATION_MS } from "@hyperscape/shared";
import type { ActionQueue } from "./ServerNetwork/action-queue";
import type { TileMovementManager } from "./ServerNetwork/tile-movement";
import type { MobTileMovementManager } from "./ServerNetwork/mob-tile-movement";
import type { PendingAttackManager } from "./ServerNetwork/PendingAttackManager";
import type { BroadcastManager } from "./ServerNetwork/broadcast";

/**
 * Combat system interface for tick processing
 */
interface CombatSystemInterface {
  processNPCCombatTick(mobId: string, tickNumber: number): void;
  processPlayerCombatTick(playerId: string, tickNumber: number): void;
  stateService: {
    getCombatData(entityId: string): { inCombat: boolean } | null;
  };
}

/**
 * Loot system interface for tick processing
 */
interface LootSystemInterface {
  processTick(tickNumber: number): void;
}

/**
 * Death system interface for tick processing
 */
interface DeathSystemInterface {
  processTick(tickNumber: number): void;
}

/**
 * Resource system interface for tick processing
 */
interface ResourceSystemInterface {
  processGatheringTick(tickNumber: number): void;
}

/**
 * Mob entity interface for AI processing
 */
interface MobEntityInterface {
  id: string;
  data?: {
    type?: string;
    alive?: boolean;
  };
  config?: {
    currentHealth?: number;
  };
  aiStateMachine?: {
    update(context: unknown, deltaTime: number): void;
  };
  createAIContext?: () => unknown;
  position?: { x: number; y: number; z: number };
}

/**
 * Player entity interface for tick processing
 */
interface PlayerEntityInterface {
  id: string;
  data?: {
    type?: string;
    alive?: boolean;
    owner?: string;
    isLoading?: boolean;
  };
  connectionTime?: number;
}

/**
 * Queued damage for OSRS-style tick scheduling
 *
 * Player → NPC damage is queued for next tick (OSRS asymmetry)
 * NPC → Player damage applies same tick
 */
export interface QueuedDamage {
  attackerId: string;
  targetId: string;
  damage: number;
  applyAtTick: number;
  attackerType: "player" | "mob";
  targetType: "player" | "mob";
}

/**
 * Queued broadcast for end-of-tick batching
 */
interface QueuedBroadcast {
  event: string;
  data: unknown;
  excludeSocketId?: string;
}

/**
 * GameTickProcessor - Unified OSRS-accurate tick processor
 *
 * Processes all game logic in deterministic order each tick:
 * 1. Inputs → 2. NPCs → 3. Players → 4. Damage → 5. Broadcast
 */
export class GameTickProcessor {
  private world: World;
  private actionQueue: ActionQueue;
  private tileMovement: TileMovementManager;
  private mobMovement: MobTileMovementManager;
  private pendingAttacks: PendingAttackManager;
  private broadcastManager: BroadcastManager;

  // Feature flag to enable/disable new tick processing
  // When false, falls back to legacy per-system tick processing
  private enabled = true;

  // Damage queue for next-tick application (OSRS asymmetry)
  private damageQueue: QueuedDamage[] = [];

  // Broadcast queue for end-of-tick batching
  private broadcastQueue: QueuedBroadcast[] = [];

  // Entity processing order (stable across ticks unless spawns/disconnects)
  private npcProcessingOrder: string[] = [];
  private playerProcessingOrder: string[] = [];

  // Cache invalidation flags
  private npcOrderDirty = true;
  private playerOrderDirty = true;

  constructor(deps: {
    world: World;
    actionQueue: ActionQueue;
    tileMovement: TileMovementManager;
    mobMovement: MobTileMovementManager;
    pendingAttacks: PendingAttackManager;
    broadcastManager: BroadcastManager;
  }) {
    this.world = deps.world;
    this.actionQueue = deps.actionQueue;
    this.tileMovement = deps.tileMovement;
    this.mobMovement = deps.mobMovement;
    this.pendingAttacks = deps.pendingAttacks;
    this.broadcastManager = deps.broadcastManager;

    // Listen for entity changes to invalidate processing order cache
    this.setupCacheInvalidation();
  }

  /**
   * Set up event listeners to invalidate processing order cache
   */
  private setupCacheInvalidation(): void {
    // NPCs
    this.world.on(EventType.MOB_NPC_SPAWNED, () => {
      this.npcOrderDirty = true;
    });
    this.world.on(EventType.MOB_NPC_DESPAWNED, () => {
      this.npcOrderDirty = true;
    });
    this.world.on(EventType.NPC_DIED, () => {
      this.npcOrderDirty = true;
    });
    this.world.on(EventType.MOB_NPC_RESPAWNED, () => {
      this.npcOrderDirty = true;
    });

    // Players
    this.world.on(EventType.PLAYER_JOINED, () => {
      this.playerOrderDirty = true;
    });
    this.world.on(EventType.PLAYER_LEFT, () => {
      this.playerOrderDirty = true;
    });
    this.world.on(EventType.PLAYER_RESPAWNED, () => {
      this.playerOrderDirty = true;
    });
  }

  /**
   * Enable or disable the new tick processing
   * When disabled, falls back to legacy per-system processing
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(
      `[GameTickProcessor] ${enabled ? "Enabled" : "Disabled"} OSRS-accurate tick processing`,
    );
  }

  /**
   * Check if new tick processing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Process a single game tick - OSRS accurate order
   *
   * This is the main entry point called by TickSystem.
   * Processes all game logic in deterministic order.
   */
  processTick(tickNumber: number): void {
    if (!this.enabled) {
      return; // Legacy processing handles this
    }

    // Update processing order if entities changed
    this.updateProcessingOrder();

    // PHASE 1: Process player inputs (from previous tick's clicks)
    this.processInputs(tickNumber);

    // PHASE 2: Process all NPCs (in spawn order)
    // OSRS: NPCs process BEFORE players
    this.processNPCs(tickNumber);

    // PHASE 3: Process all Players (in PID/connection order)
    this.processPlayers(tickNumber);

    // PHASE 4: Apply queued damage from previous tick
    // This is where Player→NPC damage actually applies (next tick)
    this.applyQueuedDamage(tickNumber);

    // PHASE 5: Process death/loot systems
    this.processDeathAndLoot(tickNumber);

    // PHASE 6: Process resource gathering
    this.processResources(tickNumber);

    // PHASE 7: Batch broadcast all changes
    this.flushBroadcastQueue();
  }

  /**
   * Update entity processing order
   *
   * NPCs: Order by spawn time (earlier = first, simulates NPC ID order)
   * Players: Order by connection time (earlier = first, simulates PID)
   */
  private updateProcessingOrder(): void {
    if (this.npcOrderDirty) {
      // Get all alive mobs, sort by ID (proxy for spawn order)
      const mobs: MobEntityInterface[] = [];
      for (const entity of this.world.entities.values()) {
        const mob = entity as unknown as MobEntityInterface;
        if (
          mob.data?.type === "mob" &&
          mob.data?.alive !== false &&
          (mob.config?.currentHealth ?? 0) > 0
        ) {
          mobs.push(mob);
        }
      }
      // Sort by ID for deterministic order
      mobs.sort((a, b) => a.id.localeCompare(b.id));
      this.npcProcessingOrder = mobs.map((m) => m.id);
      this.npcOrderDirty = false;
    }

    if (this.playerOrderDirty) {
      // Get all alive players, sort by connection time (PID simulation)
      const players: PlayerEntityInterface[] = [];
      for (const entity of this.world.entities.values()) {
        const player = entity as unknown as PlayerEntityInterface;
        if (
          player.data?.type === "player" &&
          player.data?.alive !== false &&
          !player.data?.isLoading
        ) {
          players.push(player);
        }
      }
      // Sort by connection time, then by ID as tiebreaker
      players.sort((a, b) => {
        const aTime = a.connectionTime ?? 0;
        const bTime = b.connectionTime ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return a.id.localeCompare(b.id);
      });
      this.playerProcessingOrder = players.map((p) => p.id);
      this.playerOrderDirty = false;
    }
  }

  /**
   * PHASE 1: Process queued inputs
   */
  private processInputs(tickNumber: number): void {
    this.actionQueue.processTick(tickNumber);
  }

  /**
   * PHASE 2: Process all NPCs in spawn order
   *
   * OSRS Order per NPC:
   * 1. Timers execute (BEFORE queues for NPCs!)
   * 2. Queue scripts execute (single queue type)
   * 3. Movement processing
   * 4. Combat interactions
   */
  private processNPCs(tickNumber: number): void {
    for (const mobId of this.npcProcessingOrder) {
      const mob = this.world.entities.get(mobId) as MobEntityInterface | null;
      if (!mob) continue;

      // Skip dead mobs
      if ((mob.config?.currentHealth ?? 0) <= 0) continue;

      // 1. Process NPC AI (handles timers, queues internally)
      this.processNPCAI(mob, tickNumber);

      // 2. Process NPC movement (tile-based)
      this.mobMovement.processMobTick(mobId, tickNumber);

      // 3. Process NPC combat (attacks against players)
      this.processNPCCombat(mobId, tickNumber);
    }
  }

  /**
   * Process NPC AI for this tick
   *
   * In OSRS: NPCs run timers BEFORE queues.
   * Our AIStateMachine handles this internally.
   */
  private processNPCAI(mob: MobEntityInterface, _tickNumber: number): void {
    if (mob.aiStateMachine && mob.createAIContext) {
      const context = mob.createAIContext();
      const deltaSeconds = TICK_DURATION_MS / 1000;
      mob.aiStateMachine.update(context, deltaSeconds);
    }
  }

  /**
   * Process NPC combat turn
   *
   * NPC → Player damage applies SAME TICK
   * (Player processes after NPC, so damage is already in player's queue)
   */
  private processNPCCombat(mobId: string, tickNumber: number): void {
    const combatSystem = this.world.getSystem(
      "combat",
    ) as unknown as CombatSystemInterface | null;
    if (!combatSystem) return;

    // Call combat system's NPC processing
    combatSystem.processNPCCombatTick(mobId, tickNumber);
  }

  /**
   * PHASE 3: Process all Players in PID order
   *
   * OSRS Order per Player:
   * 1. Queue scripts execute (Strong → Normal → Weak)
   * 2. Timers execute (AFTER queues for Players!)
   * 3. Movement processing
   * 4. Combat interactions
   */
  private processPlayers(tickNumber: number): void {
    for (const playerId of this.playerProcessingOrder) {
      const player = this.world.entities.get(
        playerId,
      ) as PlayerEntityInterface | null;
      if (!player) continue;

      // Skip dead or loading players
      if (player.data?.alive === false || player.data?.isLoading) continue;

      // 1. Process pending attacks (player walking to target)
      this.pendingAttacks.processPlayerTick(playerId, tickNumber);

      // 2. Process player movement (tile-based)
      this.tileMovement.processPlayerTick(playerId, tickNumber);

      // 3. Process player combat
      this.processPlayerCombat(playerId, tickNumber);
    }
  }

  /**
   * Process player combat turn
   *
   * Player → NPC damage is QUEUED for next tick (OSRS asymmetry)
   */
  private processPlayerCombat(playerId: string, tickNumber: number): void {
    const combatSystem = this.world.getSystem(
      "combat",
    ) as unknown as CombatSystemInterface | null;
    if (!combatSystem) return;

    // Call combat system's player processing
    combatSystem.processPlayerCombatTick(playerId, tickNumber);
  }

  /**
   * Queue damage for future tick application
   *
   * This implements the OSRS damage asymmetry:
   * - Player → NPC: applyAtTick = currentTick + 1
   * - NPC → Player: applyAtTick = currentTick (same tick)
   */
  queueDamage(damage: QueuedDamage): void {
    this.damageQueue.push(damage);
  }

  /**
   * Apply queued damage from previous ticks
   *
   * This is where Player→NPC damage actually gets applied
   */
  private applyQueuedDamage(tickNumber: number): void {
    // Find damage that should apply this tick
    const toApply = this.damageQueue.filter((d) => d.applyAtTick <= tickNumber);
    this.damageQueue = this.damageQueue.filter(
      (d) => d.applyAtTick > tickNumber,
    );

    for (const damage of toApply) {
      // Emit damage dealt event (queued damage now applied)
      this.world.emit(EventType.COMBAT_DAMAGE_DEALT, {
        attackerId: damage.attackerId,
        targetId: damage.targetId,
        damage: damage.damage,
        targetType: damage.targetType,
        position: null, // Position will be resolved by listener
      });
    }
  }

  /**
   * Process death and loot systems
   */
  private processDeathAndLoot(tickNumber: number): void {
    // Death system
    const deathSystem = this.world.getSystem(
      "player-death",
    ) as unknown as DeathSystemInterface | null;
    if (deathSystem?.processTick) {
      deathSystem.processTick(tickNumber);
    }

    // Loot system
    const lootSystem = this.world.getSystem(
      "loot",
    ) as unknown as LootSystemInterface | null;
    if (lootSystem?.processTick) {
      lootSystem.processTick(tickNumber);
    }
  }

  /**
   * Process resource gathering
   */
  private processResources(tickNumber: number): void {
    const resourceSystem = this.world.getSystem(
      "resource",
    ) as unknown as ResourceSystemInterface | null;
    if (resourceSystem?.processGatheringTick) {
      resourceSystem.processGatheringTick(tickNumber);
    }
  }

  /**
   * Queue a broadcast for end-of-tick batching
   *
   * Instead of sending immediately, broadcasts are queued and
   * sent together at the end of tick processing.
   */
  queueBroadcast(event: string, data: unknown, excludeSocketId?: string): void {
    this.broadcastQueue.push({ event, data, excludeSocketId });
  }

  /**
   * Flush all queued broadcasts
   */
  private flushBroadcastQueue(): void {
    for (const broadcast of this.broadcastQueue) {
      this.broadcastManager.sendToAll(
        broadcast.event,
        broadcast.data,
        broadcast.excludeSocketId,
      );
    }
    this.broadcastQueue = [];
  }

  /**
   * Get current damage queue size (for debugging/metrics)
   */
  getDamageQueueSize(): number {
    return this.damageQueue.length;
  }

  /**
   * Get current broadcast queue size (for debugging/metrics)
   */
  getBroadcastQueueSize(): number {
    return this.broadcastQueue.length;
  }

  /**
   * Get NPC processing order (for debugging/testing)
   */
  getNPCProcessingOrder(): readonly string[] {
    return this.npcProcessingOrder;
  }

  /**
   * Get player processing order (for debugging/testing)
   */
  getPlayerProcessingOrder(): readonly string[] {
    return this.playerProcessingOrder;
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    this.damageQueue = [];
    this.broadcastQueue = [];
    this.npcProcessingOrder = [];
    this.playerProcessingOrder = [];
  }
}
