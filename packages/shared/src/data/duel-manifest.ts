/**
 * Duel Manifest - Data-Driven Rule and Equipment Definitions
 *
 * Single source of truth for duel rules and equipment slot labels/metadata.
 * This eliminates hardcoded duplications across RulesScreen.tsx, ConfirmScreen.tsx,
 * and server handlers.
 *
 * @see packages/shared/src/types/game/duel-types.ts for type definitions
 */

import type { DuelRules } from "../types/game/duel-types";

// ============================================================================
// Rule Definitions
// ============================================================================

/**
 * Definition for a single duel rule
 */
export interface DuelRuleDefinition {
  /** Display label for the rule */
  label: string;
  /** Description shown on hover/tooltip */
  description: string;
  /** Rules that cannot be combined with this one */
  incompatibleWith: Array<keyof DuelRules>;
}

/**
 * Duel rules manifest - single source of truth
 */
export const DUEL_RULE_DEFINITIONS: Record<
  keyof DuelRules,
  DuelRuleDefinition
> = {
  noRanged: {
    label: "No Ranged",
    description: "Cannot use ranged attacks",
    incompatibleWith: [],
  },
  noMelee: {
    label: "No Melee",
    description: "Cannot use melee attacks",
    incompatibleWith: [],
  },
  noMagic: {
    label: "No Magic",
    description: "Cannot use magic attacks",
    incompatibleWith: [],
  },
  noSpecialAttack: {
    label: "No Special Attack",
    description: "Cannot use special attacks",
    incompatibleWith: [],
  },
  noPrayer: {
    label: "No Prayer",
    description: "Prayer points drained",
    incompatibleWith: [],
  },
  noPotions: {
    label: "No Potions",
    description: "Cannot drink potions",
    incompatibleWith: [],
  },
  noFood: {
    label: "No Food",
    description: "Cannot eat food",
    incompatibleWith: [],
  },
  noForfeit: {
    label: "No Forfeit",
    description: "Fight to the death",
    incompatibleWith: ["funWeapons"],
  },
  noMovement: {
    label: "No Movement",
    description: "Frozen in place",
    incompatibleWith: [],
  },
  funWeapons: {
    label: "Fun Weapons",
    description: "Boxing gloves only",
    incompatibleWith: ["noForfeit"],
  },
};

/**
 * Get just the labels for simple display (e.g., ConfirmScreen)
 */
export const DUEL_RULE_LABELS: Record<keyof DuelRules, string> =
  Object.fromEntries(
    Object.entries(DUEL_RULE_DEFINITIONS).map(([key, def]) => [key, def.label]),
  ) as Record<keyof DuelRules, string>;

// ============================================================================
// Equipment Slot Definitions
// ============================================================================

/**
 * Equipment slots that can be restricted in duels
 */
export type DuelEquipmentSlot =
  | "head"
  | "cape"
  | "amulet"
  | "weapon"
  | "body"
  | "shield"
  | "legs"
  | "gloves"
  | "boots"
  | "ring"
  | "ammo";

/**
 * Definition for a single equipment slot
 */
export interface EquipmentSlotDefinition {
  /** Display label for the slot */
  label: string;
  /** Order for display (0 = first) */
  order: number;
}

/**
 * Equipment slots manifest - single source of truth
 */
export const EQUIPMENT_SLOT_DEFINITIONS: Record<
  DuelEquipmentSlot,
  EquipmentSlotDefinition
> = {
  head: { label: "Head", order: 0 },
  cape: { label: "Cape", order: 1 },
  amulet: { label: "Amulet", order: 2 },
  weapon: { label: "Weapon", order: 3 },
  body: { label: "Body", order: 4 },
  shield: { label: "Shield", order: 5 },
  legs: { label: "Legs", order: 6 },
  gloves: { label: "Gloves", order: 7 },
  boots: { label: "Boots", order: 8 },
  ring: { label: "Ring", order: 9 },
  ammo: { label: "Ammo", order: 10 },
};

/**
 * Get just the labels for simple display
 */
export const EQUIPMENT_SLOT_LABELS: Record<DuelEquipmentSlot, string> =
  Object.fromEntries(
    Object.entries(EQUIPMENT_SLOT_DEFINITIONS).map(([key, def]) => [
      key,
      def.label,
    ]),
  ) as Record<DuelEquipmentSlot, string>;

/**
 * Ordered list of equipment slots for iteration
 */
export const EQUIPMENT_SLOTS_ORDERED: DuelEquipmentSlot[] = (
  Object.entries(EQUIPMENT_SLOT_DEFINITIONS) as [
    DuelEquipmentSlot,
    EquipmentSlotDefinition,
  ][]
)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key]) => key);

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * All valid rule keys
 */
export const VALID_DUEL_RULE_KEYS = Object.keys(DUEL_RULE_DEFINITIONS) as Array<
  keyof DuelRules
>;

/**
 * All valid duel equipment slot keys
 */
export const DUEL_EQUIPMENT_SLOT_KEYS = Object.keys(
  EQUIPMENT_SLOT_DEFINITIONS,
) as DuelEquipmentSlot[];

/**
 * Type guard for valid rule key
 */
export function isValidDuelRuleKey(key: string): key is keyof DuelRules {
  return key in DUEL_RULE_DEFINITIONS;
}

/**
 * Type guard for valid equipment slot
 */
export function isValidEquipmentSlot(slot: string): slot is DuelEquipmentSlot {
  return slot in EQUIPMENT_SLOT_DEFINITIONS;
}

/**
 * Get incompatible rules for a given rule
 */
export function getIncompatibleRules(
  rule: keyof DuelRules,
): Array<keyof DuelRules> {
  return DUEL_RULE_DEFINITIONS[rule].incompatibleWith;
}

/**
 * Check if two rules are compatible
 */
export function areRulesCompatible(
  rule1: keyof DuelRules,
  rule2: keyof DuelRules,
): boolean {
  const incompatible1 = DUEL_RULE_DEFINITIONS[rule1].incompatibleWith;
  const incompatible2 = DUEL_RULE_DEFINITIONS[rule2].incompatibleWith;
  return !incompatible1.includes(rule2) && !incompatible2.includes(rule1);
}

// ============================================================================
// Arena Configuration (Manifest-Driven)
// ============================================================================

import { ALL_WORLD_AREAS } from "./world-areas";

/**
 * Arena layout configuration derived from world-areas.json manifest.
 * Single source of truth for arena positioning and dimensions.
 */
export interface DuelArenaConfig {
  /** Base X coordinate for arena grid */
  baseX: number;
  /** Base Z coordinate for arena grid */
  baseZ: number;
  /** Ground level Y coordinate */
  baseY: number;
  /** Width of each arena (x-axis) */
  arenaWidth: number;
  /** Length of each arena (z-axis) */
  arenaLength: number;
  /** Gap between arenas */
  arenaGap: number;
  /** Number of columns in arena grid */
  columns: number;
  /** Number of rows in arena grid */
  rows: number;
  /** Total number of arenas */
  arenaCount: number;
  /** Distance from center to spawn point */
  spawnOffset: number;
  /** Lobby spawn point */
  lobbySpawnPoint: { x: number; y: number; z: number };
}

/**
 * Default arena config (fallback if manifest not loaded)
 */
const DEFAULT_ARENA_CONFIG: DuelArenaConfig = {
  baseX: 60,
  baseZ: 80,
  baseY: 0,
  arenaWidth: 20,
  arenaLength: 24,
  arenaGap: 4,
  columns: 2,
  rows: 3,
  arenaCount: 6,
  spawnOffset: 8,
  lobbySpawnPoint: { x: 105, y: 0, z: 60 },
};

/**
 * Get duel arena configuration from manifest.
 * Reads from ALL_WORLD_AREAS["duel_arena"].subZones.arenas
 * Falls back to default values if manifest not loaded.
 */
export function getDuelArenaConfig(): DuelArenaConfig {
  const duelArena = ALL_WORLD_AREAS["duel_arena"];
  if (!duelArena?.subZones?.arenas) {
    return DEFAULT_ARENA_CONFIG;
  }

  const arenas = duelArena.subZones.arenas;
  const lobby = duelArena.subZones.lobby;

  // Parse layout (e.g., "2x3" -> columns=2, rows=3)
  let columns = 2;
  let rows = 3;
  if (arenas.arenaLayout) {
    const match = arenas.arenaLayout.match(/(\d+)x(\d+)/);
    if (match) {
      columns = parseInt(match[1], 10);
      rows = parseInt(match[2], 10);
    }
  }

  return {
    baseX: arenas.bounds.minX,
    baseZ: arenas.bounds.minZ,
    baseY: 0,
    arenaWidth: arenas.arenaSize?.width ?? DEFAULT_ARENA_CONFIG.arenaWidth,
    arenaLength: arenas.arenaSize?.length ?? DEFAULT_ARENA_CONFIG.arenaLength,
    arenaGap: arenas.arenaGap ?? DEFAULT_ARENA_CONFIG.arenaGap,
    columns,
    rows,
    arenaCount: arenas.arenaCount ?? columns * rows,
    spawnOffset: DEFAULT_ARENA_CONFIG.spawnOffset,
    lobbySpawnPoint: lobby?.spawnPoint ?? DEFAULT_ARENA_CONFIG.lobbySpawnPoint,
  };
}

/**
 * Check if a position is inside any combat arena.
 * Used for zone validation (e.g., preventing challenges inside arenas).
 *
 * @param x - World X coordinate
 * @param z - World Z coordinate
 * @returns true if position is inside a combat arena
 */
export function isPositionInsideCombatArena(x: number, z: number): boolean {
  const config = getDuelArenaConfig();

  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.columns; col++) {
      const arenaMinX =
        config.baseX + col * (config.arenaWidth + config.arenaGap);
      const arenaMaxX = arenaMinX + config.arenaWidth;
      const arenaMinZ =
        config.baseZ + row * (config.arenaLength + config.arenaGap);
      const arenaMaxZ = arenaMinZ + config.arenaLength;

      if (
        x >= arenaMinX &&
        x <= arenaMaxX &&
        z >= arenaMinZ &&
        z <= arenaMaxZ
      ) {
        return true;
      }
    }
  }

  return false;
}
