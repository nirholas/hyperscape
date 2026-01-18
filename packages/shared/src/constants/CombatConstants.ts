/**
 * Combat Constants
 *
 * OSRS-accurate timing and combat values.
 * All tick-based values assume 600ms per tick.
 *
 * @see https://oldschool.runescape.wiki/w/Game_tick
 */

export const COMBAT_CONSTANTS = {
  // === Ranges (tiles) ===
  MELEE_RANGE: 2,
  RANGED_RANGE: 10,
  MELEE_RANGE_STANDARD: 1,
  MELEE_RANGE_HALBERD: 2,
  PICKUP_RANGE: 2.5,

  // === Tick System ===
  TICK_DURATION_MS: 600,

  // === Combat Timing (ticks) ===
  DEFAULT_ATTACK_SPEED_TICKS: 4,
  COMBAT_TIMEOUT_TICKS: 17, // OSRS-accurate: 10.2 seconds (17 ticks * 600ms)
  LOGOUT_PREVENTION_TICKS: 16,
  HEALTH_REGEN_COOLDOWN_TICKS: 17,
  HEALTH_REGEN_INTERVAL_TICKS: 100,
  AFK_DISABLE_RETALIATE_TICKS: 2000,

  // === Food Consumption (OSRS-accurate) ===
  /** Ticks before player can eat again after eating (3 ticks = 1.8s) */
  EAT_DELAY_TICKS: 3,
  /** Ticks added to attack cooldown when eating during combat */
  EAT_ATTACK_DELAY_TICKS: 3,
  /** Maximum heal amount per food item (prevents exploit with modified manifests) */
  MAX_HEAL_AMOUNT: 99,

  // === Hit Delay ===
  // Formula: MELEE=0, RANGED=1+floor((3+dist)/6), MAGIC=1+floor((1+dist)/3)
  HIT_DELAY: {
    MELEE_BASE: 0,
    RANGED_BASE: 1,
    RANGED_DISTANCE_OFFSET: 3,
    RANGED_DISTANCE_DIVISOR: 6,
    MAGIC_BASE: 1,
    MAGIC_DISTANCE_OFFSET: 1,
    MAGIC_DISTANCE_DIVISOR: 3,
    MAX_HIT_DELAY: 10,
  },

  // === Animation ===
  ANIMATION: {
    HIT_FRAME_RATIO: 0.5,
    MIN_ANIMATION_TICKS: 2,
    HITSPLAT_DELAY_TICKS: 0,
    HITSPLAT_DURATION_TICKS: 2,
    EMOTE_COMBAT: "combat",
    EMOTE_SWORD_SWING: "sword_swing",
    EMOTE_RANGED: "ranged",
    EMOTE_MAGIC: "magic",
    EMOTE_IDLE: "idle",
  },

  // === Death & Loot (ticks) ===
  RESPAWN_TICKS_RANDOMNESS: 8,
  GRAVESTONE_TICKS: 1500,
  GROUND_ITEM_DESPAWN_TICKS: 6000, // OSRS-accurate: 60 minutes (was 300 = 3 min)
  UNTRADEABLE_DESPAWN_TICKS: 6000, // OSRS-accurate: 60 minutes (was 300 = 3 min)
  LOOT_PROTECTION_TICKS: 100,
  CORPSE_DESPAWN_TICKS: 200,

  DEATH: {
    ANIMATION_TICKS: 7,
    COOLDOWN_TICKS: 17,
    RECONNECT_RESPAWN_DELAY_TICKS: 1,
    STALE_LOCK_AGE_TICKS: 3000, // 30 minutes (was 6000 = 1 hour)
    DEFAULT_RESPAWN_POSITION: { x: 0, y: 0, z: 0 } as const,
    DEFAULT_RESPAWN_TOWN: "Central Haven",
  } as const,

  // === Damage Formulas ===
  BASE_CONSTANT: 64,
  EFFECTIVE_LEVEL_CONSTANT: 8,
  DAMAGE_DIVISOR: 640,
  MIN_DAMAGE: 0,
  MAX_DAMAGE: 200,

  // === XP per Damage ===
  XP: {
    COMBAT_XP_PER_DAMAGE: 4,
    HITPOINTS_XP_PER_DAMAGE: 1.33,
    CONTROLLED_XP_PER_DAMAGE: 1.33,
  },

  COMBAT_STATES: {
    IDLE: "idle",
    IN_COMBAT: "in_combat",
    FLEEING: "fleeing",
  } as const,

  // === Manifest Defaults (fallback when not specified) ===
  DEFAULTS: {
    NPC: {
      ATTACK_SPEED_TICKS: 4,
      AGGRO_RANGE: 4,
      COMBAT_RANGE: 1,
      LEASH_RANGE: 7,
      RESPAWN_TICKS: 25,
      WANDER_RADIUS: 5,
    },
    ITEM: {
      ATTACK_SPEED: 4,
      ATTACK_RANGE: 1,
    },
  } as const,
} as const;

export const AGGRO_CONSTANTS = {
  DEFAULT_BEHAVIOR: "passive" as const,
  AGGRO_UPDATE_INTERVAL_MS: 100,
  ALWAYS_AGGRESSIVE_LEVEL: 999,
} as const;

export const LEVEL_CONSTANTS = {
  DEFAULT_COMBAT_LEVEL: 3,
  MIN_COMBAT_LEVEL: 3,
  MAX_LEVEL: 99,

  XP_BASE: 50,
  XP_GROWTH_FACTOR: 8,

  COMBAT_LEVEL_WEIGHTS: {
    DEFENSE_WEIGHT: 0.25,
    OFFENSE_WEIGHT: 0.325,
    RANGED_MULTIPLIER: 1.5,
  },
} as const;

export type CombatState =
  (typeof COMBAT_CONSTANTS.COMBAT_STATES)[keyof typeof COMBAT_CONSTANTS.COMBAT_STATES];
