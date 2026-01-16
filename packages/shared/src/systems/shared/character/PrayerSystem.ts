/**
 * PrayerSystem - Manages player prayer state and mechanics
 *
 * Server-authoritative system that handles all prayer operations:
 * - Activating/deactivating prayers
 * - Prayer point drain mechanics (OSRS-accurate formula)
 * - Conflict resolution (auto-deactivate conflicting prayers)
 * - Level requirement validation
 * - Combat bonus calculations
 * - Database persistence
 *
 * OSRS Prayer Drain Formula:
 * drain_resistance = 2 * prayer_bonus + 60
 * drain_per_tick = drain_effect / drain_resistance (per 0.6s game tick)
 *
 * @see {@link PrayerDataProvider} for prayer definitions
 * @see {@link SkillsSystem} for prayer XP and leveling
 */

import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../core/World";
import { EventType } from "../../../types/events";
import { Logger } from "../../../utils/Logger";
import {
  createPlayerID,
  isValidPlayerID,
  toPlayerID,
} from "../../../utils/IdentifierUtils";
import type { PlayerID } from "../../../types/core/identifiers";
import type { DatabaseSystem } from "../../../types/systems/system-interfaces";
import {
  prayerDataProvider,
  type PrayerDefinition,
  type PrayerBonuses,
} from "../../../data/PrayerDataProvider";
import {
  type PrayerState,
  isValidPrayerId,
  MAX_ACTIVE_PRAYERS,
  PRAYER_TOGGLE_COOLDOWN_MS,
  PRAYER_TOGGLE_RATE_LIMIT,
  getPlayerPrayerLevel,
  getPlayerPrayerBonus,
  type PlayerWithPrayerStats,
} from "../../../types/game/prayer-types";

/**
 * Mutable prayer bonuses buffer for hot-path calculations
 * (PrayerBonuses from types has readonly properties)
 */
interface MutablePrayerBonuses {
  attackMultiplier?: number;
  strengthMultiplier?: number;
  defenseMultiplier?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Game tick duration in ms (OSRS uses 600ms ticks) */
const GAME_TICK_MS = 600;

/** How often to process prayer drain (in ms) */
const DRAIN_INTERVAL_MS = GAME_TICK_MS;

/** Default starting prayer points */
const DEFAULT_PRAYER_POINTS = 1;

/** Maximum prayer points a player can have at level 99 */
const MAX_PRAYER_POINTS = 99;

/** Base drain resistance constant (OSRS formula) */
const BASE_DRAIN_RESISTANCE = 60;

/** Prayer bonus multiplier for drain resistance (OSRS formula) */
const PRAYER_BONUS_MULTIPLIER = 2;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Per-player prayer state (in-memory)
 */
interface PlayerPrayerState {
  /** Current prayer points (fractional for precise drain) */
  points: number;
  /** Maximum prayer points (based on prayer level) */
  maxPoints: number;
  /** Currently active prayer IDs */
  active: Set<string>;
  /** Last toggle timestamp for rate limiting */
  lastToggleTime: number;
  /** Toggle count in current rate limit window */
  toggleCount: number;
  /** Rate limit window start time */
  rateLimitWindowStart: number;
  /** Whether state has been modified and needs persistence */
  dirty: boolean;
}

/**
 * Prayer toggle result
 */
interface PrayerToggleResult {
  success: boolean;
  reason?: string;
  deactivated?: string[];
}

// ============================================================================
// PRAYER SYSTEM
// ============================================================================

/**
 * PrayerSystem - Manages prayer state and mechanics
 *
 * Single Responsibility: Only handles prayer state and operations.
 * Does NOT handle prayer XP/leveling (that's SkillsSystem).
 */
export class PrayerSystem extends SystemBase {
  /** Prayer state per player */
  private playerStates = new Map<PlayerID, PlayerPrayerState>();

  /** Players currently loading from database */
  private loadingPlayers = new Set<string>();

  /** Players whose prayer state has been initialized */
  private initializedPlayers = new Set<string>();

  /** Pending persist timers (debounced saves) */
  private persistTimers = new Map<string, NodeJS.Timeout>();

  /** Drain processing interval handle */
  private drainInterval?: NodeJS.Timeout;

  /** Auto-save interval handle */
  private autoSaveInterval?: NodeJS.Timeout;

  /** Auto-save interval in ms */
  private readonly AUTO_SAVE_INTERVAL = 30000; // 30 seconds

  // ============================================================================
  // PRE-ALLOCATED BUFFERS (Memory optimization)
  // ============================================================================

  /** Reusable array for collecting prayers to deactivate */
  private readonly deactivateBuffer: string[] = [];

  /** Reusable object for combined bonuses calculation */
  private readonly combinedBonusesBuffer: MutablePrayerBonuses = {
    attackMultiplier: undefined,
    strengthMultiplier: undefined,
    defenseMultiplier: undefined,
  };

  constructor(world: World) {
    super(world, {
      name: "prayer",
      dependencies: {
        required: [],
        optional: ["database", "skills"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Ensure prayer data is loaded
    if (!prayerDataProvider.isReady()) {
      prayerDataProvider.initialize();
    }

    // Subscribe to player lifecycle events
    this.subscribe(
      EventType.PLAYER_REGISTERED,
      async (data: { playerId: string }) => {
        await this.initializePlayerPrayer(data.playerId);
      },
    );

    this.subscribe(EventType.PLAYER_CLEANUP, (data: { playerId: string }) => {
      this.cleanupPlayerPrayer(data.playerId);
    });

    // Subscribe to prayer toggle events
    this.subscribe<{ playerId: string; prayerId: string }>(
      EventType.PRAYER_TOGGLE,
      (data) => {
        this.handlePrayerToggle(data.playerId, data.prayerId);
      },
    );

    Logger.system("PrayerSystem", "Initialized");
  }

  start(): void {
    // Start drain processing on server only
    if (this.world.isServer) {
      this.startDrainProcessing();
      this.startAutoSave();
    }
  }

  // ==========================================================================
  // PLAYER INITIALIZATION
  // ==========================================================================

  /**
   * Initialize prayer state for a player (load from DB or set defaults)
   */
  private async initializePlayerPrayer(playerId: string): Promise<void> {
    if (!isValidPlayerID(playerId)) {
      Logger.systemError(
        "PrayerSystem",
        `Invalid player ID: "${playerId}"`,
        new Error(`Invalid player ID: "${playerId}"`),
      );
      return;
    }

    // Prevent race conditions during load
    if (this.loadingPlayers.has(playerId)) {
      return;
    }

    this.loadingPlayers.add(playerId);

    try {
      const db = this.getDatabase();
      let points = DEFAULT_PRAYER_POINTS;
      let maxPoints = DEFAULT_PRAYER_POINTS;
      let activePrayers: string[] = [];

      if (db) {
        const playerRow = await db.getPlayerAsync(playerId);
        if (playerRow) {
          // Load prayer level to calculate max points
          const prayerLevel =
            (playerRow as { prayerLevel?: number }).prayerLevel ?? 1;
          maxPoints = prayerLevel;

          // Load current points (default to max if not set)
          points =
            (playerRow as { prayerPoints?: number }).prayerPoints ?? maxPoints;

          // Load active prayers from JSON
          const activePrayersJson = (playerRow as { activePrayers?: string })
            .activePrayers;
          if (activePrayersJson) {
            try {
              const parsed = JSON.parse(activePrayersJson);
              if (Array.isArray(parsed)) {
                // Validate each prayer ID
                activePrayers = parsed.filter(
                  (id) => typeof id === "string" && isValidPrayerId(id),
                );
              }
            } catch {
              // Invalid JSON, start with no active prayers
              activePrayers = [];
            }
          }
        }
      }

      const playerIdKey = createPlayerID(playerId);
      const state: PlayerPrayerState = {
        points: Math.min(points, maxPoints),
        maxPoints,
        active: new Set(activePrayers),
        lastToggleTime: 0,
        toggleCount: 0,
        rateLimitWindowStart: 0,
        dirty: false,
      };

      this.playerStates.set(playerIdKey, state);
      this.initializedPlayers.add(playerId);

      // Emit state sync event
      this.emitPrayerStateSync(playerId, state);

      Logger.system(
        "PrayerSystem",
        `Initialized prayer for ${playerId}: ${state.points}/${state.maxPoints} points, ${state.active.size} active`,
      );
    } finally {
      this.loadingPlayers.delete(playerId);
    }
  }

  /**
   * Cleanup prayer state when player disconnects
   */
  private cleanupPlayerPrayer(playerId: string): void {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return;

    // Persist before cleanup if on server
    if (this.world.isServer) {
      this.persistPrayerImmediate(playerId);
    }

    this.playerStates.delete(playerIdKey);
    this.loadingPlayers.delete(playerId);
    this.initializedPlayers.delete(playerId);

    // Clear any pending persist timer
    const timer = this.persistTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(playerId);
    }
  }

  // ==========================================================================
  // PRAYER TOGGLING
  // ==========================================================================

  /**
   * Handle prayer toggle request
   */
  private handlePrayerToggle(playerId: string, prayerId: string): void {
    if (!isValidPlayerID(playerId)) {
      return;
    }

    // Validate prayer ID format (security)
    if (!isValidPrayerId(prayerId)) {
      Logger.systemError(
        "PrayerSystem",
        `Invalid prayer ID format: "${prayerId}"`,
        new Error(`Invalid prayer ID: ${prayerId}`),
      );
      return;
    }

    const result = this.togglePrayer(playerId, prayerId);

    if (!result.success) {
      // Emit failure toast
      this.emitTypedEvent(EventType.UI_TOAST, {
        playerId,
        message: result.reason || "Cannot toggle prayer",
        type: "error",
      });
    }
  }

  /**
   * Toggle a prayer on or off
   *
   * @param playerId - Player toggling the prayer
   * @param prayerId - Prayer to toggle
   * @returns Result with success flag and any deactivated prayers
   */
  togglePrayer(playerId: string, prayerId: string): PrayerToggleResult {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) {
      return { success: false, reason: "Invalid player" };
    }

    const state = this.playerStates.get(playerIdKey);
    if (!state) {
      return { success: false, reason: "Prayer not initialized" };
    }

    // Rate limiting check
    const now = Date.now();
    if (!this.checkRateLimit(state, now)) {
      return { success: false, reason: "Too many prayer toggles" };
    }

    // Get prayer definition
    const prayer = prayerDataProvider.getPrayer(prayerId);
    if (!prayer) {
      return { success: false, reason: "Unknown prayer" };
    }

    // Check if deactivating
    if (state.active.has(prayerId)) {
      return this.deactivatePrayer(playerId, state, prayerId);
    }

    // Activating - check requirements
    return this.activatePrayer(playerId, state, prayer);
  }

  /**
   * Activate a prayer
   */
  private activatePrayer(
    playerId: string,
    state: PlayerPrayerState,
    prayer: PrayerDefinition,
  ): PrayerToggleResult {
    // Get player's prayer level
    const player = this.getPlayerEntity(playerId);
    const prayerLevel = getPlayerPrayerLevel(player as PlayerWithPrayerStats);

    // Check level requirement
    if (prayerLevel < prayer.level) {
      return {
        success: false,
        reason: `Requires prayer level ${prayer.level}`,
      };
    }

    // Check prayer points
    if (state.points <= 0) {
      return { success: false, reason: "No prayer points remaining" };
    }

    // Check max active prayers
    if (state.active.size >= MAX_ACTIVE_PRAYERS) {
      return {
        success: false,
        reason: `Cannot have more than ${MAX_ACTIVE_PRAYERS} prayers active`,
      };
    }

    // Handle conflicts - deactivate conflicting prayers
    const deactivated: string[] = [];
    const conflicts = prayerDataProvider.getConflictsWithActive(
      prayer.id,
      Array.from(state.active),
    );

    for (const conflictId of conflicts) {
      state.active.delete(conflictId);
      deactivated.push(conflictId);

      // Emit deactivation event
      this.emitTypedEvent(EventType.PRAYER_DEACTIVATED, {
        playerId,
        prayerId: conflictId,
        reason: "conflict",
      });
    }

    // Activate the prayer
    state.active.add(prayer.id);
    state.dirty = true;

    // Emit toggled event
    this.emitTypedEvent(EventType.PRAYER_TOGGLED, {
      playerId,
      prayerId: prayer.id,
      active: true,
      points: Math.floor(state.points),
    });

    // Emit state sync
    this.emitPrayerStateSync(playerId, state);

    // Schedule persistence
    this.schedulePersist(playerId);

    return { success: true, deactivated };
  }

  /**
   * Deactivate a prayer
   */
  private deactivatePrayer(
    playerId: string,
    state: PlayerPrayerState,
    prayerId: string,
  ): PrayerToggleResult {
    state.active.delete(prayerId);
    state.dirty = true;

    // Emit toggled event
    this.emitTypedEvent(EventType.PRAYER_TOGGLED, {
      playerId,
      prayerId,
      active: false,
      points: Math.floor(state.points),
    });

    // Emit state sync
    this.emitPrayerStateSync(playerId, state);

    // Schedule persistence
    this.schedulePersist(playerId);

    return { success: true };
  }

  /**
   * Deactivate all prayers for a player
   */
  deactivateAllPrayers(playerId: string): void {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return;

    const state = this.playerStates.get(playerIdKey);
    if (!state || state.active.size === 0) return;

    // Collect prayers to deactivate
    this.deactivateBuffer.length = 0;
    for (const prayerId of state.active) {
      this.deactivateBuffer.push(prayerId);
    }

    // Deactivate all
    state.active.clear();
    state.dirty = true;

    // Emit events for each
    for (const prayerId of this.deactivateBuffer) {
      this.emitTypedEvent(EventType.PRAYER_DEACTIVATED, {
        playerId,
        prayerId,
        reason: "deactivate_all",
      });
    }

    // Emit state sync
    this.emitPrayerStateSync(playerId, state);

    // Schedule persistence
    this.schedulePersist(playerId);
  }

  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================

  /**
   * Check if toggle is within rate limits
   */
  private checkRateLimit(state: PlayerPrayerState, now: number): boolean {
    // Check cooldown
    if (now - state.lastToggleTime < PRAYER_TOGGLE_COOLDOWN_MS) {
      return false;
    }

    // Check rate limit window (1 second)
    const windowDuration = 1000;
    if (now - state.rateLimitWindowStart > windowDuration) {
      // Reset window
      state.rateLimitWindowStart = now;
      state.toggleCount = 0;
    }

    if (state.toggleCount >= PRAYER_TOGGLE_RATE_LIMIT) {
      return false;
    }

    // Update state
    state.lastToggleTime = now;
    state.toggleCount++;

    return true;
  }

  // ==========================================================================
  // PRAYER DRAIN
  // ==========================================================================

  /**
   * Start the drain processing interval
   */
  private startDrainProcessing(): void {
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
    }

    this.drainInterval = setInterval(() => {
      this.processDrainTick();
    }, DRAIN_INTERVAL_MS);
  }

  /**
   * Process prayer drain for all players with active prayers
   */
  private processDrainTick(): void {
    for (const [playerIdKey, state] of this.playerStates) {
      if (state.active.size === 0) continue;
      if (state.points <= 0) continue;

      // Get player's prayer bonus
      const playerId = playerIdKey as string;
      const player = this.getPlayerEntity(playerId);
      const prayerBonus = getPlayerPrayerBonus(player as PlayerWithPrayerStats);

      // Calculate total drain
      let totalDrain = 0;
      for (const prayerId of state.active) {
        const drainRate = prayerDataProvider.getPrayerDrainRate(prayerId);
        totalDrain += drainRate;
      }

      if (totalDrain <= 0) continue;

      // OSRS drain formula: drain_resistance = 2 * prayer_bonus + 60
      const drainResistance =
        PRAYER_BONUS_MULTIPLIER * prayerBonus + BASE_DRAIN_RESISTANCE;

      // Points drained this tick
      const pointsDrained = totalDrain / drainResistance;

      // Apply drain
      const oldPoints = state.points;
      state.points = Math.max(0, state.points - pointsDrained);
      state.dirty = true;

      // Check if points depleted
      if (state.points <= 0 && oldPoints > 0) {
        // Deactivate all prayers
        this.deactivateAllPrayers(playerId);

        // Emit points depleted notification
        this.emitTypedEvent(EventType.UI_TOAST, {
          playerId,
          message: "You have run out of prayer points.",
          type: "warning",
        });
      }

      // Emit points changed if whole number changed
      if (Math.floor(oldPoints) !== Math.floor(state.points)) {
        this.emitTypedEvent(EventType.PRAYER_POINTS_CHANGED, {
          playerId,
          points: Math.floor(state.points),
          maxPoints: state.maxPoints,
        });
      }
    }
  }

  // ==========================================================================
  // PRAYER POINTS
  // ==========================================================================

  /**
   * Get current prayer points for a player
   */
  getPrayerPoints(playerId: string): number {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return 0;

    const state = this.playerStates.get(playerIdKey);
    return state ? Math.floor(state.points) : 0;
  }

  /**
   * Get max prayer points for a player
   */
  getMaxPrayerPoints(playerId: string): number {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return 1;

    const state = this.playerStates.get(playerIdKey);
    return state?.maxPoints ?? 1;
  }

  /**
   * Restore prayer points (e.g., from altar, potion)
   */
  restorePrayerPoints(playerId: string, amount: number): void {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return;

    const state = this.playerStates.get(playerIdKey);
    if (!state) return;

    const oldPoints = state.points;
    state.points = Math.min(state.points + amount, state.maxPoints);
    state.dirty = true;

    if (Math.floor(oldPoints) !== Math.floor(state.points)) {
      this.emitTypedEvent(EventType.PRAYER_POINTS_CHANGED, {
        playerId,
        points: Math.floor(state.points),
        maxPoints: state.maxPoints,
      });

      this.emitPrayerStateSync(playerId, state);
      this.schedulePersist(playerId);
    }
  }

  /**
   * Set max prayer points (called when prayer level changes)
   */
  setMaxPrayerPoints(playerId: string, maxPoints: number): void {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return;

    const state = this.playerStates.get(playerIdKey);
    if (!state) return;

    state.maxPoints = Math.max(1, Math.min(maxPoints, MAX_PRAYER_POINTS));
    state.dirty = true;

    this.emitPrayerStateSync(playerId, state);
    this.schedulePersist(playerId);
  }

  // ==========================================================================
  // ACTIVE PRAYERS
  // ==========================================================================

  /**
   * Get active prayer IDs for a player
   */
  getActivePrayers(playerId: string): readonly string[] {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return [];

    const state = this.playerStates.get(playerIdKey);
    return state ? Array.from(state.active) : [];
  }

  /**
   * Check if a specific prayer is active
   */
  isPrayerActive(playerId: string, prayerId: string): boolean {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return false;

    const state = this.playerStates.get(playerIdKey);
    return state?.active.has(prayerId) ?? false;
  }

  // ==========================================================================
  // COMBAT BONUSES
  // ==========================================================================

  /**
   * Get combined bonuses from all active prayers
   * Uses pre-allocated buffer to avoid allocations in combat hot paths.
   *
   * @returns Reference to internal buffer - do not store long-term
   */
  getCombinedBonuses(playerId: string): MutablePrayerBonuses {
    // Reset buffer
    this.combinedBonusesBuffer.attackMultiplier = undefined;
    this.combinedBonusesBuffer.strengthMultiplier = undefined;
    this.combinedBonusesBuffer.defenseMultiplier = undefined;

    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return this.combinedBonusesBuffer;

    const state = this.playerStates.get(playerIdKey);
    if (!state || state.active.size === 0) return this.combinedBonusesBuffer;

    // Combine bonuses from all active prayers
    for (const prayerId of state.active) {
      const bonuses = prayerDataProvider.getPrayerBonuses(prayerId);
      if (!bonuses) continue;

      // Take the highest multiplier for each stat (prayers don't stack additively)
      if (bonuses.attackMultiplier !== undefined) {
        this.combinedBonusesBuffer.attackMultiplier = Math.max(
          this.combinedBonusesBuffer.attackMultiplier ?? 1,
          bonuses.attackMultiplier,
        );
      }
      if (bonuses.strengthMultiplier !== undefined) {
        this.combinedBonusesBuffer.strengthMultiplier = Math.max(
          this.combinedBonusesBuffer.strengthMultiplier ?? 1,
          bonuses.strengthMultiplier,
        );
      }
      if (bonuses.defenseMultiplier !== undefined) {
        this.combinedBonusesBuffer.defenseMultiplier = Math.max(
          this.combinedBonusesBuffer.defenseMultiplier ?? 1,
          bonuses.defenseMultiplier,
        );
      }
    }

    return this.combinedBonusesBuffer;
  }

  /**
   * Get effective attack level with prayer bonuses
   */
  getEffectiveAttackLevel(playerId: string, baseLevel: number): number {
    const bonuses = this.getCombinedBonuses(playerId);
    const multiplier = bonuses.attackMultiplier ?? 1;
    return Math.floor(baseLevel * multiplier);
  }

  /**
   * Get effective strength level with prayer bonuses
   */
  getEffectiveStrengthLevel(playerId: string, baseLevel: number): number {
    const bonuses = this.getCombinedBonuses(playerId);
    const multiplier = bonuses.strengthMultiplier ?? 1;
    return Math.floor(baseLevel * multiplier);
  }

  /**
   * Get effective defense level with prayer bonuses
   */
  getEffectiveDefenseLevel(playerId: string, baseLevel: number): number {
    const bonuses = this.getCombinedBonuses(playerId);
    const multiplier = bonuses.defenseMultiplier ?? 1;
    return Math.floor(baseLevel * multiplier);
  }

  // ==========================================================================
  // STATE SYNC
  // ==========================================================================

  /**
   * Emit prayer state sync event
   */
  private emitPrayerStateSync(
    playerId: string,
    state: PlayerPrayerState,
  ): void {
    this.emitTypedEvent(EventType.PRAYER_STATE_SYNC, {
      playerId,
      level: state.maxPoints, // Prayer level = max points
      xp: 0, // XP managed by SkillsSystem
      points: Math.floor(state.points),
      maxPoints: state.maxPoints,
      active: Array.from(state.active),
    });
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  /**
   * Schedule debounced persistence
   */
  private schedulePersist(playerId: string): void {
    if (!this.world.isServer) return;

    // Clear existing timer
    const existingTimer = this.persistTimers.get(playerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new persist (1 second debounce)
    const timer = setTimeout(() => {
      this.persistPrayerImmediate(playerId);
      this.persistTimers.delete(playerId);
    }, 1000);

    this.persistTimers.set(playerId, timer);
  }

  /**
   * Persist prayer state immediately
   */
  private persistPrayerImmediate(playerId: string): void {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return;

    const state = this.playerStates.get(playerIdKey);
    if (!state || !state.dirty) return;

    const db = this.getDatabase();
    if (!db) return;

    // Persist to database
    db.savePlayer(playerId, {
      prayerPoints: Math.floor(state.points),
      prayerMaxPoints: state.maxPoints,
      activePrayers: JSON.stringify(Array.from(state.active)),
    } as Record<string, unknown>);

    state.dirty = false;
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(() => {
      this.saveAllDirtyStates();
    }, this.AUTO_SAVE_INTERVAL);
  }

  /**
   * Save all dirty player states
   */
  private saveAllDirtyStates(): void {
    for (const [playerIdKey, state] of this.playerStates) {
      if (state.dirty) {
        this.persistPrayerImmediate(playerIdKey as string);
      }
    }
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Get player entity for bonus lookups
   */
  private getPlayerEntity(playerId: string): unknown {
    return this.world.entities.get(playerId);
  }

  /**
   * Get database system
   */
  private getDatabase(): DatabaseSystem | undefined {
    return this.world.getSystem("database") as DatabaseSystem | undefined;
  }

  /**
   * Get prayer state for debugging
   */
  getPrayerState(playerId: string): PrayerState | null {
    const playerIdKey = toPlayerID(playerId);
    if (!playerIdKey) return null;

    const state = this.playerStates.get(playerIdKey);
    if (!state) return null;

    return {
      level: state.maxPoints,
      xp: 0,
      points: Math.floor(state.points),
      maxPoints: state.maxPoints,
      active: Array.from(state.active),
    };
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  override destroy(): void {
    // Clear intervals
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = undefined;
    }

    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }

    // Save all dirty states before shutdown
    this.saveAllDirtyStates();

    // Clear persist timers
    for (const timer of this.persistTimers.values()) {
      clearTimeout(timer);
    }
    this.persistTimers.clear();

    // Clear state
    this.playerStates.clear();
    this.loadingPlayers.clear();
    this.initializedPlayers.clear();

    super.destroy();
  }
}
