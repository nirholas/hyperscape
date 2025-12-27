/**
 * PIDManager - OSRS-Accurate Player ID System
 *
 * In OSRS, Player ID (PID) determines processing order within each tick.
 * Lower PID = processed first = slight combat advantage.
 *
 * Key mechanics:
 * - PID range: 0 to 2047
 * - PID reshuffles every 100-150 ticks (60-90 seconds)
 * - Lower PID processes first in tick cycle
 * - Affects who "wins" simultaneous actions
 *
 * This creates the subtle combat dynamics OSRS players know:
 * - PID advantage in 1v1 (your hit registers first)
 * - PID rotation ensures fairness over time
 *
 * @see https://oldschool.runescape.wiki/w/Player_identification_number
 * @see OSRS-IMPLEMENTATION-PLAN.md Phase 1
 */

import { SeededRandom, getGameRng } from "@hyperscape/shared";

/**
 * PID assignment for a player
 */
export interface PlayerPID {
  /** Player entity ID */
  playerId: string;
  /** Current PID value (0-2047) */
  pid: number;
  /** Tick when PID was assigned */
  assignedTick: number;
}

/**
 * PID reshuffle event data
 */
export interface PIDReshuffleEvent {
  /** Tick when reshuffle occurred */
  tick: number;
  /** Old PID assignments */
  oldAssignments: Map<string, number>;
  /** New PID assignments */
  newAssignments: Map<string, number>;
}

/** Maximum PID value (OSRS uses 0-2047) */
const MAX_PID = 2047;

/** Minimum ticks between reshuffles */
const MIN_RESHUFFLE_TICKS = 100;

/** Maximum ticks between reshuffles */
const MAX_RESHUFFLE_TICKS = 150;

/**
 * PIDManager - Manages player processing order
 *
 * Features:
 * - OSRS-accurate PID range (0-2047)
 * - Random reshuffle every 100-150 ticks
 * - Deterministic shuffling using SeededRandom
 * - Efficient player ordering for tick processing
 */
export class PIDManager {
  /** Current PID assignments (playerId -> pid) */
  private pidAssignments: Map<string, number> = new Map();

  /** Reverse lookup (pid -> playerId) for collision detection */
  private pidToPlayer: Map<number, string> = new Map();

  /** Next PID to assign (increments for new players) */
  private nextPid = 0;

  /** Tick when next reshuffle should occur */
  private nextReshuffleTick = 0;

  /** Current tick (updated by processTick) */
  private currentTick = 0;

  /** RNG for shuffling (uses game RNG for determinism) */
  private rng: SeededRandom;

  /** Callback for reshuffle events */
  private onReshuffle?: (event: PIDReshuffleEvent) => void;

  // ============================================================================
  // PRE-ALLOCATED BUFFERS (Zero-allocation hot path support)
  // ============================================================================

  /** Cached processing order array - recomputed only when dirty */
  private _processingOrderCache: string[] = [];

  /** Flag to track if processing order needs recomputation */
  private _processingOrderDirty = true;

  /** Pre-allocated buffer for sorting entries */
  private readonly _sortBuffer: Array<[string, number]> = [];

  constructor() {
    this.rng = getGameRng();
    this.scheduleNextReshuffle(0);
  }

  /**
   * Set callback for PID reshuffle events
   * Useful for logging/debugging
   */
  setReshuffleCallback(callback: (event: PIDReshuffleEvent) => void): void {
    this.onReshuffle = callback;
  }

  /**
   * Assign a PID to a new player
   *
   * @param playerId - Player's entity ID
   * @returns Assigned PID
   */
  assignPID(playerId: string): number {
    // Check if already assigned
    const existing = this.pidAssignments.get(playerId);
    if (existing !== undefined) {
      return existing;
    }

    // Find next available PID
    let pid = this.nextPid;
    while (this.pidToPlayer.has(pid)) {
      pid = (pid + 1) % (MAX_PID + 1);
      // Safety check to prevent infinite loop
      if (pid === this.nextPid) {
        // All PIDs taken, use overflow
        pid = MAX_PID + this.pidAssignments.size;
        break;
      }
    }

    this.pidAssignments.set(playerId, pid);
    this.pidToPlayer.set(pid, playerId);
    this.nextPid = (pid + 1) % (MAX_PID + 1);
    this._processingOrderDirty = true; // Invalidate cache

    return pid;
  }

  /**
   * Remove a player's PID (on disconnect)
   *
   * @param playerId - Player's entity ID
   */
  removePID(playerId: string): void {
    const pid = this.pidAssignments.get(playerId);
    if (pid !== undefined) {
      this.pidAssignments.delete(playerId);
      this.pidToPlayer.delete(pid);
      this._processingOrderDirty = true; // Invalidate cache
    }
  }

  /**
   * Get a player's current PID
   *
   * @param playerId - Player's entity ID
   * @returns PID or undefined if not assigned
   */
  getPID(playerId: string): number | undefined {
    return this.pidAssignments.get(playerId);
  }

  /**
   * Get all player IDs sorted by PID (processing order)
   * Uses cached array to avoid allocations on hot path
   *
   * @returns Array of player IDs in PID order (lowest first)
   */
  getProcessingOrder(): string[] {
    if (this._processingOrderDirty) {
      // Recompute processing order
      this._sortBuffer.length = 0;
      for (const entry of this.pidAssignments.entries()) {
        this._sortBuffer.push(entry);
      }
      this._sortBuffer.sort((a, b) => a[1] - b[1]);

      // Update cache
      this._processingOrderCache.length = 0;
      for (const [playerId] of this._sortBuffer) {
        this._processingOrderCache.push(playerId);
      }

      this._processingOrderDirty = false;
    }
    return this._processingOrderCache;
  }

  /**
   * Process a tick - may trigger reshuffle
   *
   * @param tickNumber - Current game tick
   */
  processTick(tickNumber: number): void {
    this.currentTick = tickNumber;

    if (tickNumber >= this.nextReshuffleTick) {
      this.reshufflePIDs(tickNumber);
    }
  }

  /**
   * Reshuffle all PIDs randomly
   * Called automatically based on timer, or manually for testing
   *
   * @param tickNumber - Current tick
   */
  reshufflePIDs(tickNumber: number): void {
    if (this.pidAssignments.size === 0) {
      this.scheduleNextReshuffle(tickNumber);
      return;
    }

    // Save old assignments for event
    const oldAssignments = new Map(this.pidAssignments);

    // Get all player IDs
    const playerIds = Array.from(this.pidAssignments.keys());

    // Fisher-Yates shuffle using seeded RNG
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    // Generate new PIDs (spread across range for better distribution)
    this.pidAssignments.clear();
    this.pidToPlayer.clear();

    const step = Math.floor((MAX_PID + 1) / Math.max(playerIds.length, 1));

    for (let i = 0; i < playerIds.length; i++) {
      // Spread PIDs with some randomness
      const basePid = (i * step) % (MAX_PID + 1);
      const jitter = this.rng.nextInt(Math.min(step, 50));
      const pid = (basePid + jitter) % (MAX_PID + 1);

      this.pidAssignments.set(playerIds[i], pid);
      this.pidToPlayer.set(pid, playerIds[i]);
    }

    this._processingOrderDirty = true; // Invalidate cache after reshuffle

    // Emit event
    if (this.onReshuffle) {
      this.onReshuffle({
        tick: tickNumber,
        oldAssignments,
        newAssignments: new Map(this.pidAssignments),
      });
    }

    this.scheduleNextReshuffle(tickNumber);
  }

  /**
   * Schedule the next reshuffle
   *
   * @param currentTick - Current tick number
   */
  private scheduleNextReshuffle(currentTick: number): void {
    const delay = this.rng.nextIntRange(
      MIN_RESHUFFLE_TICKS,
      MAX_RESHUFFLE_TICKS,
    );
    this.nextReshuffleTick = currentTick + delay;
  }

  /**
   * Get the tick when next reshuffle will occur
   */
  getNextReshuffleTick(): number {
    return this.nextReshuffleTick;
  }

  /**
   * Get current number of assigned PIDs
   */
  getPlayerCount(): number {
    return this.pidAssignments.size;
  }

  /**
   * Get all PID assignments (for debugging/admin tools)
   */
  getAllAssignments(): Map<string, number> {
    return new Map(this.pidAssignments);
  }

  /**
   * Compare two players by PID (for sorting)
   * Lower PID = higher priority (processed first)
   *
   * @returns negative if a < b, 0 if equal, positive if a > b
   */
  comparePID(playerIdA: string, playerIdB: string): number {
    const pidA = this.pidAssignments.get(playerIdA) ?? MAX_PID + 1;
    const pidB = this.pidAssignments.get(playerIdB) ?? MAX_PID + 1;
    return pidA - pidB;
  }

  /**
   * Reset all PID assignments (for testing or server restart)
   */
  reset(): void {
    this.pidAssignments.clear();
    this.pidToPlayer.clear();
    this.nextPid = 0;
    this.nextReshuffleTick = 0;
    this._processingOrderDirty = true; // Invalidate cache
    this._processingOrderCache.length = 0;
    this._sortBuffer.length = 0;
  }
}

// Singleton instance for global use
let globalPIDManager: PIDManager | null = null;

/**
 * Get or create the global PID manager
 */
export function getPIDManager(): PIDManager {
  if (!globalPIDManager) {
    globalPIDManager = new PIDManager();
  }
  return globalPIDManager;
}

/**
 * Reset the global PID manager (for testing)
 */
export function resetPIDManager(): void {
  globalPIDManager?.reset();
  globalPIDManager = null;
}
