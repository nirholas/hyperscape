/**
 * Event Store for Game Replay and Investigation
 *
 * Records game events in a memory-bounded ring buffer with periodic snapshots.
 * Enables:
 * - Combat replay for anti-cheat investigation
 * - Desync detection via state checksums
 * - Debugging production issues
 *
 */

import type { SeededRandomState } from "../../utils/SeededRandom";

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * Categories of game events
 */
export enum GameEventType {
  // Combat events
  COMBAT_START = "COMBAT_START",
  COMBAT_ATTACK = "COMBAT_ATTACK",
  COMBAT_DAMAGE = "COMBAT_DAMAGE",
  COMBAT_MISS = "COMBAT_MISS",
  COMBAT_END = "COMBAT_END",

  // Death events
  DEATH_PLAYER = "DEATH_PLAYER",
  DEATH_MOB = "DEATH_MOB",

  // Movement events
  MOVEMENT_START = "MOVEMENT_START",
  MOVEMENT_TICK = "MOVEMENT_TICK",

  // State changes
  STATE_HEALTH = "STATE_HEALTH",
  STATE_SKILL_XP = "STATE_SKILL_XP",

  // Anti-cheat events
  ANTICHEAT_VIOLATION = "ANTICHEAT_VIOLATION",
  ANTICHEAT_BAN = "ANTICHEAT_BAN",
  ANTICHEAT_KICK = "ANTICHEAT_KICK",
}

/**
 * Single game event record
 */
export interface GameEvent {
  /** Game tick when event occurred */
  tick: number;
  /** Wall-clock timestamp */
  timestamp: number;
  /** Type of event */
  type: GameEventType | string;
  /** Entity that caused the event */
  entityId: string;
  /** Event-specific data */
  payload: unknown;
  /** FNV-1a checksum of critical game state */
  stateChecksum: number;
}

/**
 * Lightweight entity state for snapshots
 */
export interface EntitySnapshot {
  id: string;
  type: string;
  position?: { x: number; y: number; z: number };
  health?: number;
  maxHealth?: number;
}

/**
 * Combat state snapshot
 */
export interface CombatSnapshot {
  attackerId: string;
  targetId: string;
  startTick: number;
  lastAttackTick: number;
}

/**
 * Full game state snapshot for fast replay
 */
export interface GameSnapshot {
  /** Tick when snapshot was taken */
  tick: number;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Entity states at this tick */
  entities: Map<string, EntitySnapshot>;
  /** Active combat sessions */
  combatStates: Map<string, CombatSnapshot>;
  /** RNG state for deterministic replay */
  rngState: SeededRandomState;
}

/**
 * Minimal state info for checksum calculation
 */
export interface GameStateInfo {
  currentTick: number;
  playerCount: number;
  activeCombats: number;
}

// =============================================================================
// EVENT STORE
// =============================================================================

/**
 * Configuration for EventStore
 */
export interface EventStoreConfig {
  /** How often to take snapshots (in ticks) */
  snapshotInterval: number;
  /** Maximum events to keep in ring buffer */
  maxEvents: number;
  /** Maximum snapshots to keep */
  maxSnapshots: number;
}

const DEFAULT_CONFIG: EventStoreConfig = {
  snapshotInterval: 100, // Every 100 ticks (~1 minute at 600ms/tick)
  maxEvents: 100000, // Ring buffer limit
  maxSnapshots: 10, // Keep last 10 snapshots
};

/**
 * Event Store for Game Replay and Investigation
 *
 * Uses a ring buffer for events and periodic snapshots for efficient replay.
 *
 * @example
 * ```typescript
 * const store = new EventStore();
 *
 * // Record events during gameplay
 * store.record(
 *   { tick: 100, type: GameEventType.COMBAT_DAMAGE, entityId: 'player1', payload: { damage: 10 } },
 *   { currentTick: 100, playerCount: 5, activeCombats: 2 }
 * );
 *
 * // Investigate a player's actions
 * const events = store.getEntityEvents('player1', 50, 150);
 *
 * // Verify state consistency
 * const matches = store.verifyChecksum(100, expectedChecksum);
 * ```
 */
export class EventStore {
  private events: GameEvent[] = [];
  private snapshots: Map<number, GameSnapshot> = new Map();
  private readonly config: EventStoreConfig;

  constructor(config?: Partial<EventStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a game event
   *
   * @param event - Event data (without timestamp/checksum)
   * @param stateInfo - Current game state for checksum
   * @param snapshot - Optional full snapshot data for periodic saves
   */
  record(
    event: Omit<GameEvent, "timestamp" | "stateChecksum">,
    stateInfo: GameStateInfo,
    snapshot?: Omit<GameSnapshot, "tick" | "timestamp">,
  ): void {
    // Ring buffer - remove oldest if at limit
    if (this.events.length >= this.config.maxEvents) {
      this.events.shift();
    }

    this.events.push({
      ...event,
      timestamp: Date.now(),
      stateChecksum: this.computeChecksum(stateInfo),
    });

    // Take periodic snapshots for fast replay
    if (snapshot && event.tick % this.config.snapshotInterval === 0) {
      this.snapshots.set(event.tick, {
        tick: event.tick,
        timestamp: Date.now(),
        ...snapshot,
      });

      // Clean old snapshots (keep last N)
      this.pruneSnapshots();
    }
  }

  /**
   * Get events for a specific entity (for investigation)
   *
   * @param entityId - Entity to get events for
   * @param startTick - Optional start tick (inclusive)
   * @param endTick - Optional end tick (inclusive)
   * @returns Array of events for this entity
   */
  getEntityEvents(
    entityId: string,
    startTick?: number,
    endTick?: number,
  ): GameEvent[] {
    return this.events.filter(
      (e) =>
        e.entityId === entityId &&
        (startTick === undefined || e.tick >= startTick) &&
        (endTick === undefined || e.tick <= endTick),
    );
  }

  /**
   * Get combat events for replay/investigation
   *
   * @param startTick - Start tick (inclusive)
   * @param endTick - End tick (inclusive)
   * @returns Array of combat-related events
   */
  getCombatEvents(startTick: number, endTick: number): GameEvent[] {
    return this.events.filter(
      (e) =>
        e.tick >= startTick &&
        e.tick <= endTick &&
        (e.type.includes("COMBAT") ||
          e.type.includes("DAMAGE") ||
          e.type.includes("DEATH")),
    );
  }

  /**
   * Get all events in a tick range
   *
   * @param startTick - Start tick (inclusive)
   * @param endTick - End tick (inclusive)
   * @returns Array of events in range
   */
  getEventsInRange(startTick: number, endTick: number): GameEvent[] {
    return this.events.filter((e) => e.tick >= startTick && e.tick <= endTick);
  }

  /**
   * Get events by type
   *
   * @param type - Event type to filter by
   * @param startTick - Optional start tick
   * @param endTick - Optional end tick
   * @returns Array of events of this type
   */
  getEventsByType(
    type: GameEventType | string,
    startTick?: number,
    endTick?: number,
  ): GameEvent[] {
    return this.events.filter(
      (e) =>
        e.type === type &&
        (startTick === undefined || e.tick >= startTick) &&
        (endTick === undefined || e.tick <= endTick),
    );
  }

  /**
   * Verify checksum matches (desync detection)
   *
   * @param tick - Tick to verify
   * @param expectedChecksum - Expected checksum value
   * @returns true if checksum matches
   */
  verifyChecksum(tick: number, expectedChecksum: number): boolean {
    const event = this.events.find((e) => e.tick === tick);
    return event?.stateChecksum === expectedChecksum;
  }

  /**
   * Get nearest snapshot before a tick (for replay start point)
   *
   * @param tick - Target tick
   * @returns Nearest snapshot before tick, or undefined
   */
  getNearestSnapshot(tick: number): GameSnapshot | undefined {
    const snapshotTicks = [...this.snapshots.keys()]
      .filter((t) => t <= tick)
      .sort((a, b) => b - a);

    if (snapshotTicks.length > 0) {
      return this.snapshots.get(snapshotTicks[0]);
    }
    return undefined;
  }

  /**
   * Get a specific snapshot
   *
   * @param tick - Tick of snapshot
   * @returns Snapshot or undefined
   */
  getSnapshot(tick: number): GameSnapshot | undefined {
    return this.snapshots.get(tick);
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get snapshot count
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Get oldest event tick
   */
  getOldestEventTick(): number | undefined {
    return this.events.length > 0 ? this.events[0].tick : undefined;
  }

  /**
   * Get newest event tick
   */
  getNewestEventTick(): number | undefined {
    return this.events.length > 0
      ? this.events[this.events.length - 1].tick
      : undefined;
  }

  /**
   * Clear all events and snapshots
   */
  clear(): void {
    this.events = [];
    this.snapshots.clear();
  }

  /**
   * Destroy the event store and release all resources
   *
   * Call this when the store is no longer needed (e.g., during system shutdown).
   * For consistency with other services that have destroy() methods.
   */
  destroy(): void {
    this.clear();
    // Future: Close any open resources, cancel timers, flush to disk, etc.
  }

  /**
   * Compute FNV-1a checksum of critical state
   * Fast hash for desync detection
   */
  private computeChecksum(stateInfo: GameStateInfo): number {
    const str = JSON.stringify({
      tick: stateInfo.currentTick,
      playerCount: stateInfo.playerCount,
      combatCount: stateInfo.activeCombats,
    });

    // FNV-1a hash
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0; // FNV prime
    }
    return hash;
  }

  /**
   * Remove old snapshots beyond the limit
   */
  private pruneSnapshots(): void {
    const snapshotTicks = [...this.snapshots.keys()].sort((a, b) => a - b);
    while (snapshotTicks.length > this.config.maxSnapshots) {
      const oldestTick = snapshotTicks.shift();
      if (oldestTick !== undefined) {
        this.snapshots.delete(oldestTick);
      }
    }
  }
}
