/**
 * Combat Anti-Cheat Monitor
 *
 * Detects and logs suspicious combat patterns for admin review.
 * This is a MONITORING system, not a blocking system - it logs
 * violations but does not prevent gameplay.
 *
 * The actual blocking is done by input validators and CombatSystem checks.
 * This system tracks patterns over time to identify potential bad actors.
 *
 * @see COMBAT_SYSTEM_HARDENING_PLAN.md Phase 6: Game Studio Hardening
 */

import type { EntityID } from "../../../types/core/identifiers";

/**
 * Combat violation severity levels
 * Higher severity = more points toward threshold
 */
export enum CombatViolationSeverity {
  /** Minor issues (e.g., timing slightly off) - 1 point */
  MINOR = 0,
  /** Moderate issues (e.g., slight range violations) - 5 points */
  MODERATE = 1,
  /** Major issues (e.g., attacking dead targets) - 15 points */
  MAJOR = 2,
  /** Critical issues (e.g., impossible attack rates) - 50 points */
  CRITICAL = 3,
}

/**
 * Types of combat violations we track
 */
export enum CombatViolationType {
  /** Attacking entities beyond valid melee range */
  OUT_OF_RANGE_ATTACK = "out_of_range_attack",
  /** Attacking already dead entities */
  DEAD_TARGET_ATTACK = "dead_target_attack",
  /** Attacking invalid entity types */
  INVALID_TARGET_TYPE = "invalid_target_type",
  /** Attacking faster than weapon speed allows */
  ATTACK_RATE_EXCEEDED = "attack_rate_exceeded",
  /** Attacking during loading/protection periods */
  ATTACK_DURING_PROTECTION = "attack_during_protection",
  /** Attempting to attack self */
  SELF_ATTACK = "self_attack",
  /** Attacking entities that don't exist */
  NONEXISTENT_TARGET = "nonexistent_target",
  /** Invalid entity ID format (injection attempt) */
  INVALID_ENTITY_ID = "invalid_entity_id",
  /** Combat action during invalid state */
  INVALID_COMBAT_STATE = "invalid_combat_state",
  /** XP gain exceeds theoretical maximum */
  EXCESSIVE_XP_GAIN = "excessive_xp_gain",
  /** Damage exceeds calculated maximum for attacker stats */
  IMPOSSIBLE_DAMAGE = "impossible_damage",
}

/**
 * Record of a single combat violation
 */
interface CombatViolationRecord {
  /** Player who committed the violation */
  playerId: string;
  /** Type of violation */
  type: CombatViolationType;
  /** Severity level */
  severity: CombatViolationSeverity;
  /** Human-readable details */
  details: string;
  /** When the violation occurred */
  timestamp: number;
  /** Target entity ID (if applicable) */
  targetId?: string;
  /** Current game tick when violation occurred */
  gameTick?: number;
}

/**
 * Per-player violation tracking state
 */
interface PlayerViolationState {
  /** Recent violations for this player */
  violations: CombatViolationRecord[];
  /** Weighted violation score (decays over time) */
  score: number;
  /** Last time we warned admins about this player */
  lastWarningTime: number;
  /** Count of attacks this tick (for rate limiting detection) */
  attacksThisTick: number;
  /** Last tick we counted attacks on */
  lastAttackCountTick: number;
}

/**
 * Weights for different severity levels
 * Higher severity = more points toward threshold
 */
const VIOLATION_WEIGHTS: Record<CombatViolationSeverity, number> = {
  [CombatViolationSeverity.MINOR]: 1,
  [CombatViolationSeverity.MODERATE]: 5,
  [CombatViolationSeverity.MAJOR]: 15,
  [CombatViolationSeverity.CRITICAL]: 50,
};

/**
 * Configuration for anti-cheat thresholds
 * All values can be tuned at runtime without code changes
 *
 * @see COMBAT_SYSTEM_IMPROVEMENTS.md Section 4.2
 * @see OSRS-IMPLEMENTATION-PLAN.md Phase 5.2
 */
export interface AntiCheatConfig {
  /** Score threshold for logging a warning (default: 25) */
  warningThreshold: number;
  /** Score threshold for logging an alert requiring admin review (default: 75) */
  alertThreshold: number;
  /** Score threshold for auto-kick (default: 50) */
  kickThreshold: number;
  /** Score threshold for auto-ban (default: 150) */
  banThreshold: number;
  /** Points to decay from score per minute (default: 10) */
  scoreDecayPerMinute: number;
  /** Maximum attacks allowed per tick before flagging (default: 3) */
  maxAttacksPerTick: number;
  /** Maximum violations to keep in history per player (default: 100) */
  maxViolationsPerPlayer: number;
  /** Minimum time between warnings for same player in ms (default: 60000) */
  warningCooldownMs: number;
  /** Maximum XP gain per tick (99 max hit × 4 = 396, use 400 with buffer) */
  maxXPPerTick: number;
  /** Window in ticks for XP rate monitoring (default: 10) */
  xpRateWindowTicks: number;
}

/**
 * Metrics data emitted by anti-cheat system
 */
export interface AntiCheatMetric {
  /** Metric name (e.g., "anticheat.violation", "anticheat.alert") */
  name: string;
  /** Metric value (count, score, etc.) */
  value: number;
  /** Additional context */
  tags: Record<string, string | number>;
  /** Timestamp when metric was recorded */
  timestamp: number;
}

/**
 * Callback type for metrics emission
 * Can be connected to monitoring systems like Prometheus, Datadog, etc.
 */
export type MetricsCallback = (metric: AntiCheatMetric) => void;

/**
 * Default anti-cheat configuration
 * Can be overridden per-instance for different environments
 *
 * @see OSRS-IMPLEMENTATION-PLAN.md Phase 5.2
 */
const DEFAULT_CONFIG: AntiCheatConfig = {
  warningThreshold: 25,
  alertThreshold: 75,
  kickThreshold: 50,
  banThreshold: 150,
  scoreDecayPerMinute: 10,
  maxAttacksPerTick: 3,
  maxViolationsPerPlayer: 100,
  warningCooldownMs: 60000,
  maxXPPerTick: 400, // 99 max hit × 4 XP = 396, plus buffer
  xpRateWindowTicks: 10,
};

/**
 * Combat Anti-Cheat Monitor
 *
 * Tracks player combat violations over time and logs patterns for admin review.
 *
 * @example
 * ```typescript
 * // Default configuration
 * const antiCheat = new CombatAntiCheat();
 *
 * // Custom thresholds for development (more lenient)
 * const devAntiCheat = new CombatAntiCheat({
 *   warningThreshold: 50,
 *   alertThreshold: 150,
 * });
 *
 * // Stricter thresholds for production
 * const prodAntiCheat = new CombatAntiCheat({
 *   warningThreshold: 15,
 *   alertThreshold: 50,
 *   maxAttacksPerTick: 2,
 * });
 * ```
 */
/**
 * Callback for auto-kick/ban actions
 */
export type AutoActionCallback = (action: {
  type: "kick" | "ban";
  playerId: string;
  score: number;
  reason: string;
}) => void;

/**
 * XP history entry for rate tracking
 */
interface XPHistoryEntry {
  tick: number;
  xp: number;
}

export class CombatAntiCheat {
  private playerStates: Map<string, PlayerViolationState> = new Map();
  private readonly config: AntiCheatConfig;
  private metricsCallback: MetricsCallback | null = null;
  private autoActionCallback: AutoActionCallback | null = null;
  private playerXPHistory: Map<string, XPHistoryEntry[]> = new Map();
  private playersKicked: Set<string> = new Set();
  private playersBanned: Set<string> = new Set();

  /**
   * Create a new CombatAntiCheat instance
   * @param config - Optional partial configuration to override defaults
   */
  constructor(config?: Partial<AntiCheatConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for metrics emission
   * Connect to monitoring systems like Prometheus, Datadog, etc.
   *
   * @example
   * ```typescript
   * antiCheat.setMetricsCallback((metric) => {
   *   prometheus.counter(metric.name).inc(metric.value, metric.tags);
   * });
   * ```
   */
  setMetricsCallback(callback: MetricsCallback | null): void {
    this.metricsCallback = callback;
  }

  /**
   * Set callback for auto-kick/ban actions
   * Connect to your server's kick/ban system
   *
   * @example
   * ```typescript
   * antiCheat.setAutoActionCallback((action) => {
   *   if (action.type === 'kick') {
   *     server.kickPlayer(action.playerId, action.reason);
   *   } else if (action.type === 'ban') {
   *     server.banPlayer(action.playerId, action.reason);
   *   }
   * });
   * ```
   */
  setAutoActionCallback(callback: AutoActionCallback | null): void {
    this.autoActionCallback = callback;
  }

  /**
   * Check if a player has been kicked
   * @param playerId - Player ID (accepts both EntityID and string)
   */
  isPlayerKicked(playerId: EntityID | string): boolean {
    return this.playersKicked.has(String(playerId));
  }

  /**
   * Check if a player has been banned
   * @param playerId - Player ID (accepts both EntityID and string)
   */
  isPlayerBanned(playerId: EntityID | string): boolean {
    return this.playersBanned.has(String(playerId));
  }

  /**
   * Emit a metric to the configured callback
   */
  private emitMetric(
    name: string,
    value: number,
    tags: Record<string, string | number>,
  ): void {
    if (this.metricsCallback) {
      this.metricsCallback({
        name,
        value,
        tags,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get current configuration (for debugging/monitoring)
   */
  getConfig(): Readonly<AntiCheatConfig> {
    return this.config;
  }

  /**
   * Record a combat violation
   *
   * @param playerId - Player who committed the violation (accepts both EntityID and string)
   * @param type - Type of violation
   * @param severity - Severity level
   * @param details - Human-readable description
   * @param targetId - Target entity ID (optional, accepts both EntityID and string)
   * @param gameTick - Current game tick (optional)
   */
  recordViolation(
    playerId: EntityID | string,
    type: CombatViolationType,
    severity: CombatViolationSeverity,
    details: string,
    targetId?: EntityID | string,
    gameTick?: number,
  ): void {
    const playerIdStr = String(playerId);
    const targetIdStr = targetId ? String(targetId) : undefined;
    const state = this.getOrCreateState(playerIdStr);

    const violation: CombatViolationRecord = {
      playerId: playerIdStr,
      type,
      severity,
      details,
      timestamp: Date.now(),
      targetId: targetIdStr,
      gameTick,
    };

    // Add violation to history
    state.violations.push(violation);

    // Keep only recent violations
    if (state.violations.length > this.config.maxViolationsPerPlayer) {
      state.violations.shift();
    }

    // Update score
    state.score += VIOLATION_WEIGHTS[severity];

    // Emit metric for every violation
    this.emitMetric("anticheat.violation", 1, {
      player_id: playerIdStr,
      violation_type: type,
      severity: CombatViolationSeverity[severity],
      severity_weight: VIOLATION_WEIGHTS[severity],
      current_score: state.score,
    });

    // Log major/critical violations immediately
    if (severity >= CombatViolationSeverity.MAJOR) {
      console.warn(
        `[CombatAntiCheat] ${CombatViolationSeverity[severity]}: player=${playerIdStr} type=${type} "${details}"`,
      );
    }

    // Check thresholds and alert if needed
    this.checkThresholds(playerIdStr, state);
  }

  /**
   * Track attack for rate limiting detection
   *
   * @param playerId - Player attempting attack (accepts both EntityID and string)
   * @param currentTick - Current game tick
   * @returns true if attack rate is suspicious
   */
  trackAttack(playerId: EntityID | string, currentTick: number): boolean {
    const playerIdStr = String(playerId);
    const state = this.getOrCreateState(playerIdStr);

    // Reset count on new tick
    if (state.lastAttackCountTick !== currentTick) {
      state.attacksThisTick = 0;
      state.lastAttackCountTick = currentTick;
    }

    state.attacksThisTick++;

    // Check if exceeding rate
    if (state.attacksThisTick > this.config.maxAttacksPerTick) {
      this.recordViolation(
        playerIdStr,
        CombatViolationType.ATTACK_RATE_EXCEEDED,
        CombatViolationSeverity.MAJOR,
        `${state.attacksThisTick} attacks in tick ${currentTick} (max ${this.config.maxAttacksPerTick})`,
        undefined,
        currentTick,
      );
      return true;
    }

    return false;
  }

  /**
   * Record out-of-range attack attempt
   * @param playerId - Player ID (accepts both EntityID and string)
   * @param targetId - Target ID (accepts both EntityID and string)
   */
  recordOutOfRangeAttack(
    playerId: EntityID | string,
    targetId: EntityID | string,
    distance: number,
    maxRange: number,
    gameTick?: number,
  ): void {
    this.recordViolation(
      playerId,
      CombatViolationType.OUT_OF_RANGE_ATTACK,
      CombatViolationSeverity.MODERATE,
      `Attacked target at distance ${distance.toFixed(1)} tiles (max ${maxRange})`,
      targetId,
      gameTick,
    );
  }

  /**
   * Record attack on dead target
   * @param playerId - Player ID (accepts both EntityID and string)
   * @param targetId - Target ID (accepts both EntityID and string)
   */
  recordDeadTargetAttack(
    playerId: EntityID | string,
    targetId: EntityID | string,
    gameTick?: number,
  ): void {
    this.recordViolation(
      playerId,
      CombatViolationType.DEAD_TARGET_ATTACK,
      CombatViolationSeverity.MAJOR,
      `Attacked dead target ${String(targetId)}`,
      targetId,
      gameTick,
    );
  }

  /**
   * Record attack on nonexistent target
   * @param playerId - Player ID (accepts both EntityID and string)
   * @param targetId - Target ID (accepts both EntityID and string)
   */
  recordNonexistentTargetAttack(
    playerId: EntityID | string,
    targetId: EntityID | string,
    gameTick?: number,
  ): void {
    this.recordViolation(
      playerId,
      CombatViolationType.NONEXISTENT_TARGET,
      CombatViolationSeverity.MAJOR,
      `Attacked nonexistent target ${String(targetId)}`,
      targetId,
      gameTick,
    );
  }

  /**
   * Record invalid entity ID format (potential injection)
   * @param playerId - Player ID (accepts both EntityID and string)
   */
  recordInvalidEntityId(playerId: EntityID | string, invalidId: string): void {
    // Sanitize the ID for logging (truncate, escape)
    const sanitizedId = String(invalidId).slice(0, 64).replace(/[<>&]/g, "_");

    this.recordViolation(
      playerId,
      CombatViolationType.INVALID_ENTITY_ID,
      CombatViolationSeverity.CRITICAL,
      `Invalid entity ID format: "${sanitizedId}"`,
    );
  }

  /**
   * Record self-attack attempt
   * @param playerId - Player ID (accepts both EntityID and string)
   */
  recordSelfAttack(playerId: EntityID | string, gameTick?: number): void {
    this.recordViolation(
      playerId,
      CombatViolationType.SELF_ATTACK,
      CombatViolationSeverity.MODERATE,
      "Attempted to attack self",
      playerId,
      gameTick,
    );
  }

  /**
   * Decay violation scores over time
   * Call this periodically (e.g., every minute)
   *
   * Also cleans up XP history for players whose violation state is removed,
   * preventing memory leaks from disconnected players.
   */
  decayScores(): void {
    for (const [playerId, state] of this.playerStates) {
      state.score = Math.max(0, state.score - this.config.scoreDecayPerMinute);

      // Clean up players with no recent violations and zero score
      if (state.score === 0 && state.violations.length === 0) {
        this.playerStates.delete(playerId);
        // Also clean XP history for this player to prevent memory leak
        this.playerXPHistory.delete(playerId);
      }
    }
  }

  /**
   * Clean up stale XP history entries
   *
   * Call this periodically (e.g., every minute) to prevent memory leaks
   * from players who disconnect without proper cleanup or stop gaining XP.
   *
   * @param currentTick - Current game tick for staleness calculation
   * @param staleThresholdTicks - Ticks before XP history is considered stale (default: 200 = ~2 min)
   */
  cleanupStaleXPHistory(
    currentTick: number,
    staleThresholdTicks: number = 200,
  ): void {
    for (const [playerId, history] of this.playerXPHistory) {
      // Filter to only recent entries
      const recent = history.filter(
        (h) => h.tick >= currentTick - staleThresholdTicks,
      );

      if (recent.length === 0) {
        // No recent XP - remove entry entirely
        this.playerXPHistory.delete(playerId);
      } else if (recent.length !== history.length) {
        // Some old entries removed - update the map
        this.playerXPHistory.set(playerId, recent);
      }
    }
  }

  /**
   * Get violation report for a player (for admin tools)
   *
   * @param playerId - Player to get report for (accepts both EntityID and string)
   * @returns Report with score and recent violations
   */
  getPlayerReport(playerId: EntityID | string): {
    score: number;
    recentViolations: CombatViolationRecord[];
    attacksThisTick: number;
  } {
    const state = this.playerStates.get(String(playerId));
    if (!state) {
      return { score: 0, recentViolations: [], attacksThisTick: 0 };
    }

    // Get violations from last 5 minutes
    const now = Date.now();
    const fiveMinutesAgo = now - 300000;
    const recentViolations = state.violations.filter(
      (v) => v.timestamp > fiveMinutesAgo,
    );

    return {
      score: state.score,
      recentViolations,
      attacksThisTick: state.attacksThisTick,
    };
  }

  /**
   * Get overall stats (for monitoring dashboard)
   */
  getStats(): {
    trackedPlayers: number;
    playersAboveWarning: number;
    playersAboveAlert: number;
    totalViolationsLast5Min: number;
  } {
    let playersAboveWarning = 0;
    let playersAboveAlert = 0;
    let totalViolationsLast5Min = 0;

    const now = Date.now();
    const fiveMinutesAgo = now - 300000;

    for (const state of this.playerStates.values()) {
      if (state.score >= this.config.alertThreshold) {
        playersAboveAlert++;
      } else if (state.score >= this.config.warningThreshold) {
        playersAboveWarning++;
      }

      totalViolationsLast5Min += state.violations.filter(
        (v) => v.timestamp > fiveMinutesAgo,
      ).length;
    }

    return {
      trackedPlayers: this.playerStates.size,
      playersAboveWarning,
      playersAboveAlert,
      totalViolationsLast5Min,
    };
  }

  /**
   * Get players requiring admin attention
   */
  getPlayersRequiringReview(): string[] {
    const players: string[] = [];
    for (const [playerId, state] of this.playerStates) {
      if (state.score >= this.config.alertThreshold) {
        players.push(playerId);
      }
    }
    return players;
  }

  /**
   * Clean up state for a disconnected player
   *
   * Note: Does not clear kicked/banned status - those persist
   * until explicitly cleared via clearPlayerStatus()
   *
   * @param playerId - Player to clean up (accepts both EntityID and string)
   */
  cleanup(playerId: EntityID | string): void {
    const playerIdStr = String(playerId);
    this.playerStates.delete(playerIdStr);
    this.playerXPHistory.delete(playerIdStr);
  }

  /**
   * Clear all tracking data
   */
  destroy(): void {
    this.playerStates.clear();
    this.playerXPHistory.clear();
    this.playersKicked.clear();
    this.playersBanned.clear();
  }

  /**
   * Get or create violation state for a player
   */
  private getOrCreateState(playerId: string): PlayerViolationState {
    let state = this.playerStates.get(playerId);
    if (!state) {
      state = {
        violations: [],
        score: 0,
        lastWarningTime: 0,
        attacksThisTick: 0,
        lastAttackCountTick: 0,
      };
      this.playerStates.set(playerId, state);
    }
    return state;
  }

  /**
   * Check if player has exceeded thresholds and take action
   *
   * Order of checks (highest to lowest):
   * 1. Ban threshold (150) - Emit ban action
   * 2. Alert threshold (75) - Log alert for admin review
   * 3. Kick threshold (50) - Emit kick action
   * 4. Warning threshold (25) - Log warning
   */
  private checkThresholds(playerId: string, state: PlayerViolationState): void {
    const now = Date.now();

    // Check for auto-ban (highest priority)
    if (
      state.score >= this.config.banThreshold &&
      !this.playersBanned.has(playerId)
    ) {
      console.error(
        `[CombatAntiCheat] AUTO-BAN: player=${playerId} score=${state.score} - violation threshold exceeded`,
      );

      this.playersBanned.add(playerId);

      this.emitMetric("anticheat.auto_ban", 1, {
        player_id: playerId,
        score: state.score,
        threshold: this.config.banThreshold,
      });

      if (this.autoActionCallback) {
        this.autoActionCallback({
          type: "ban",
          playerId,
          score: state.score,
          reason: "violation_threshold",
        });
      }

      return; // No need to check lower thresholds
    }

    // Check for alert (admin review required)
    if (state.score >= this.config.alertThreshold) {
      // Throttle alerts to prevent log spam
      if (now - state.lastWarningTime >= this.config.warningCooldownMs) {
        console.error(
          `[CombatAntiCheat] ALERT: player=${playerId} score=${state.score} - requires admin review`,
        );

        this.emitMetric("anticheat.alert", 1, {
          player_id: playerId,
          score: state.score,
          threshold: this.config.alertThreshold,
          level: "alert",
          recent_violation_count: state.violations.length,
        });

        state.lastWarningTime = now;
      }
    }

    // Check for auto-kick
    if (
      state.score >= this.config.kickThreshold &&
      !this.playersKicked.has(playerId)
    ) {
      console.warn(
        `[CombatAntiCheat] AUTO-KICK: player=${playerId} score=${state.score} - warning threshold exceeded`,
      );

      this.playersKicked.add(playerId);

      this.emitMetric("anticheat.auto_kick", 1, {
        player_id: playerId,
        score: state.score,
        threshold: this.config.kickThreshold,
      });

      if (this.autoActionCallback) {
        this.autoActionCallback({
          type: "kick",
          playerId,
          score: state.score,
          reason: "warning_threshold",
        });
      }

      return;
    }

    // Check for warning (logging only)
    if (state.score >= this.config.warningThreshold) {
      // Throttle warnings to prevent log spam
      if (now - state.lastWarningTime >= this.config.warningCooldownMs) {
        console.warn(
          `[CombatAntiCheat] WARNING: player=${playerId} score=${state.score}`,
        );

        this.emitMetric("anticheat.warning", 1, {
          player_id: playerId,
          score: state.score,
          threshold: this.config.warningThreshold,
          level: "warning",
        });

        state.lastWarningTime = now;
      }
    }
  }

  // =========================================================================
  // XP AND DAMAGE VALIDATION (Phase 5.4 & 5.5)
  // =========================================================================

  /**
   * Validate XP gain is within possible bounds
   *
   * OSRS XP per hit: HP XP = damage × 1.33, combat XP = damage × 4
   * Max damage per hit ≈ 99, so max XP per hit ≈ 396
   *
   * @param playerId - Player gaining XP (accepts both EntityID and string)
   * @param xpAmount - Amount of XP gained
   * @param currentTick - Current game tick
   * @returns true if XP gain is valid, false if suspicious
   *
   * @see OSRS-IMPLEMENTATION-PLAN.md Phase 5.4
   */
  validateXPGain(
    playerId: EntityID | string,
    xpAmount: number,
    currentTick: number,
  ): boolean {
    const playerIdStr = String(playerId);

    // Check single-tick max
    if (xpAmount > this.config.maxXPPerTick) {
      this.recordViolation(
        playerIdStr,
        CombatViolationType.EXCESSIVE_XP_GAIN,
        CombatViolationSeverity.CRITICAL,
        `Gained ${xpAmount} XP in one tick (max ${this.config.maxXPPerTick})`,
        undefined,
        currentTick,
      );
      return false;
    }

    // Track and check rate
    let history = this.playerXPHistory.get(playerIdStr);
    if (!history) {
      history = [];
      this.playerXPHistory.set(playerIdStr, history);
    }

    history.push({ tick: currentTick, xp: xpAmount });

    // Clean old entries
    const windowStart = currentTick - this.config.xpRateWindowTicks;
    const recentHistory = history.filter((h) => h.tick >= windowStart);
    this.playerXPHistory.set(playerIdStr, recentHistory);

    // Check rate over window
    const totalXP = recentHistory.reduce((sum, h) => sum + h.xp, 0);
    const maxPossibleRate =
      this.config.maxXPPerTick * this.config.xpRateWindowTicks;

    if (totalXP > maxPossibleRate) {
      this.recordViolation(
        playerIdStr,
        CombatViolationType.EXCESSIVE_XP_GAIN,
        CombatViolationSeverity.CRITICAL,
        `Gained ${totalXP} XP over ${this.config.xpRateWindowTicks} ticks (max ${maxPossibleRate})`,
        undefined,
        currentTick,
      );
      return false;
    }

    return true;
  }

  /**
   * Validate damage is within possible bounds for attacker's stats
   *
   * Uses OSRS max hit formula to calculate theoretical maximum.
   * Adds 10% tolerance for special attacks / future mechanics.
   *
   * @param attackerId - Player/entity dealing damage (accepts both EntityID and string)
   * @param damage - Damage dealt
   * @param attackerStrength - Attacker's strength level
   * @param attackerStrengthBonus - Attacker's equipment strength bonus
   * @param currentTick - Current game tick (optional)
   * @returns true if damage is valid, false if suspicious
   *
   * @see OSRS-IMPLEMENTATION-PLAN.md Phase 5.5
   */
  validateDamage(
    attackerId: EntityID | string,
    damage: number,
    attackerStrength: number,
    attackerStrengthBonus: number,
    currentTick?: number,
  ): boolean {
    const attackerIdStr = String(attackerId);
    // Calculate maximum possible hit for this attacker
    // OSRS formula: Max Hit = floor(0.5 + EffectiveStrength × (StrengthBonus + 64) / 640)
    // EffectiveStrength = StrengthLevel + 8 + 3 (max style bonus)
    const effectiveStrength = attackerStrength + 8 + 3;
    const maxPossibleHit = Math.floor(
      0.5 + (effectiveStrength * (attackerStrengthBonus + 64)) / 640,
    );

    // Add 10% tolerance for special attacks / future mechanics
    const damageLimit = Math.ceil(maxPossibleHit * 1.1);

    if (damage > damageLimit) {
      this.recordViolation(
        attackerIdStr,
        CombatViolationType.IMPOSSIBLE_DAMAGE,
        CombatViolationSeverity.CRITICAL,
        `Dealt ${damage} damage (max possible ${maxPossibleHit}, limit ${damageLimit})`,
        undefined,
        currentTick,
      );
      return false;
    }

    return true;
  }

  /**
   * Clear kicked/banned status for a player (e.g., after appeal)
   * @param playerId - Player ID (accepts both EntityID and string)
   */
  clearPlayerStatus(playerId: EntityID | string): void {
    const playerIdStr = String(playerId);
    this.playersKicked.delete(playerIdStr);
    this.playersBanned.delete(playerIdStr);
    this.playerXPHistory.delete(playerIdStr);
  }
}
