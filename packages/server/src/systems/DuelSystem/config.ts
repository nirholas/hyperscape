/**
 * Duel System Configuration
 *
 * Centralized configuration constants for the duel system.
 * Eliminates magic numbers throughout the codebase.
 *
 * All timing values are in game ticks (600ms each, OSRS-accurate).
 * Use ticksToMs() helper or multiply by TICK_DURATION_MS for setTimeout/setInterval.
 * All distance values are in tiles/units.
 */

import { TICK_DURATION_MS } from "@hyperscape/shared";

// ============================================================================
// TIMING CONFIGURATION (in game ticks, 600ms each)
// ============================================================================

/**
 * How long a challenge remains valid before expiring
 * OSRS-accurate: 50 ticks = 30 seconds
 */
export const CHALLENGE_TIMEOUT_TICKS = 50;

/**
 * How long a disconnected player has to reconnect before auto-forfeit
 * 50 ticks = 30 seconds
 */
export const DISCONNECT_TIMEOUT_TICKS = 50;

/**
 * Maximum age for a duel session before automatic cleanup
 * 3000 ticks = 30 minutes
 */
export const SESSION_MAX_AGE_TICKS = 3000;

/**
 * Delay before resolving duel after death to allow animation
 * OSRS-accurate: 8 ticks ≈ 4.8 seconds (close to 5s, aligned to tick boundary)
 */
export const DEATH_RESOLUTION_DELAY_TICKS = 8;

/**
 * Interval for cleanup checks
 * 17 ticks ≈ 10.2 seconds
 */
export const CLEANUP_INTERVAL_TICKS = 17;

/**
 * Interval for distance checks on pending challenges
 * 8 ticks ≈ 4.8 seconds
 */
export const CHALLENGE_CLEANUP_INTERVAL_TICKS = 8;

// ============================================================================
// TIMING HELPERS
// ============================================================================

/**
 * Convert ticks to milliseconds for use with setTimeout/setInterval
 */
export const ticksToMs = (ticks: number): number => ticks * TICK_DURATION_MS;

// Re-export for convenience
export { TICK_DURATION_MS };

// ============================================================================
// DISTANCE CONFIGURATION
// ============================================================================

/**
 * Maximum distance (in tiles) between players to create/maintain a challenge
 * OSRS-accurate: 15 tiles
 */
export const CHALLENGE_DISTANCE_TILES = 15;

// ============================================================================
// ARENA CONFIGURATION
// ============================================================================

/**
 * Total number of duel arenas available
 */
export const ARENA_COUNT = 6;

/**
 * Arena grid layout (2 columns x 3 rows)
 */
export const ARENA_GRID_COLS = 2;
export const ARENA_GRID_ROWS = 3;

/**
 * Base coordinates for the arena grid (top-left arena center)
 */
export const ARENA_BASE_X = 70;
export const ARENA_BASE_Z = 90;
export const ARENA_Y = 0;

/**
 * Arena dimensions
 */
export const ARENA_WIDTH = 20; // X dimension
export const ARENA_LENGTH = 24; // Z dimension (includes spawn separation)

/**
 * Gap between arenas in the grid
 */
export const ARENA_GAP_X = 4;
export const ARENA_GAP_Z = 4;

/**
 * Spawn point offset from arena center (north/south spawns)
 */
export const SPAWN_OFFSET_Z = 8;

// ============================================================================
// SPAWN LOCATIONS
// ============================================================================

/**
 * Lobby spawn position for the duel winner
 */
export const LOBBY_SPAWN_WINNER = { x: 102, y: 0, z: 60 } as const;

/**
 * Lobby spawn position for the duel loser
 */
export const LOBBY_SPAWN_LOSER = { x: 108, y: 0, z: 60 } as const;

/**
 * General lobby spawn position (center)
 */
export const LOBBY_SPAWN_CENTER = { x: 105, y: 0, z: 60 } as const;

/**
 * Hospital spawn position (for deaths outside of duels)
 */
export const HOSPITAL_SPAWN = { x: 60, y: 0, z: 60 } as const;

// ============================================================================
// LIMITS
// ============================================================================

/**
 * Maximum number of staked items per player (matches inventory size)
 */
export const MAX_STAKES_PER_PLAYER = 28;

/**
 * Tolerance for position checking (in units)
 */
export const POSITION_TOLERANCE = 0.5;

/**
 * Cooldown (in ms) before a challenger can re-challenge the same target
 * after a decline or expiry. Prevents harassment spam.
 * 10 seconds.
 */
export const CHALLENGE_COOLDOWN_MS = 10_000;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default equipment restrictions (all slots enabled by default)
 */
export const DEFAULT_EQUIPMENT_RESTRICTIONS = {
  head: false,
  cape: false,
  amulet: false,
  weapon: false,
  body: false,
  shield: false,
  legs: false,
  gloves: false,
  boots: false,
  ring: false,
  ammo: false,
} as const;

/**
 * Equipment slot type for type safety
 */
export type EquipmentSlot = keyof typeof DEFAULT_EQUIPMENT_RESTRICTIONS;

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generate a unique duel-related ID (shared between DuelSessionManager and PendingDuelManager)
 */
export function generateDuelId(): string {
  return `duel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// DUEL STATES
// ============================================================================

/**
 * All possible duel session states
 */
export const DUEL_STATES = [
  "RULES",
  "STAKES",
  "CONFIRMING",
  "COUNTDOWN",
  "FIGHTING",
  "FINISHED",
] as const;

export type DuelState = (typeof DUEL_STATES)[number];
