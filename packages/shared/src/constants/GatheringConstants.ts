/**
 * Gathering Constants
 *
 * Centralized constants for the resource gathering system.
 * OSRS-accurate timing and gathering values.
 *
 * @see https://oldschool.runescape.wiki/w/Woodcutting
 * @see https://oldschool.runescape.wiki/w/Mining
 * @see https://oldschool.runescape.wiki/w/Fishing
 */

export const GATHERING_CONSTANTS = {
  // === Proximity and Range (tiles) ===
  /** Maximum distance to search for nearby resources when exact match fails */
  PROXIMITY_SEARCH_RADIUS: 15,
  /** Default interaction range for gathering */
  DEFAULT_INTERACTION_RANGE: 4.0,
  /** Floating point tolerance for position comparison (OSRS: any movement cancels) */
  POSITION_EPSILON: 0.01,

  // === Timing (ticks/ms) ===
  /** Minimum ticks between gather attempts (prevents instant gathering) */
  MINIMUM_CYCLE_TICKS: 2,
  /** Rate limit cooldown in milliseconds (matches 1 tick) */
  RATE_LIMIT_MS: 600,
  /** Stale rate limit threshold for cleanup (10 seconds) */
  STALE_RATE_LIMIT_MS: 10000,
  /** Rate limit cleanup interval (60 seconds) */
  RATE_LIMIT_CLEANUP_INTERVAL_MS: 60000,

  // === Success Rate Formula ===
  /** Base success rate at exactly required level */
  BASE_SUCCESS_RATE: 0.35,
  /** Additional success rate per level above requirement */
  PER_LEVEL_SUCCESS_BONUS: 0.01,
  /** Minimum possible success rate */
  MIN_SUCCESS_RATE: 0.25,
  /** Maximum possible success rate */
  MAX_SUCCESS_RATE: 0.85,

  // === Cycle Time Formula ===
  /** Maximum level factor for cycle reduction */
  MAX_LEVEL_FACTOR: 0.3,
  /** Level factor per level above requirement */
  LEVEL_FACTOR_PER_LEVEL: 0.005,

  // === Resource ID Validation ===
  /** Maximum allowed length for resource IDs */
  MAX_RESOURCE_ID_LENGTH: 100,
  /** Pattern for valid resource IDs (alphanumeric, underscore, hyphen, dot) */
  VALID_RESOURCE_ID_PATTERN: /^[a-zA-Z0-9_.-]+$/,
} as const;

export type GatheringConstants = typeof GATHERING_CONSTANTS;
