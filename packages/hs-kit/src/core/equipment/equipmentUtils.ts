/**
 * Equipment System Utilities
 *
 * Slot validation, stat calculation, and set bonus logic
 * for RPG-style equipment/paper doll systems.
 *
 * @packageDocumentation
 */

import type { ItemData } from "../../styled/ItemSlot";

// ============================================================================
// Equipment Slot Types
// ============================================================================

/** All possible equipment slot types */
export type EquipmentSlotType =
  | "head"
  | "shoulders"
  | "chest"
  | "hands"
  | "legs"
  | "feet"
  | "mainHand"
  | "offHand"
  | "twoHand"
  | "neck"
  | "ring1"
  | "ring2"
  | "back"
  | "belt"
  | "ammo";

/** Equipment slot configuration */
export interface EquipmentSlotConfig {
  /** Slot identifier */
  type: EquipmentSlotType;
  /** Display name */
  label: string;
  /** Accepted item types for this slot */
  acceptsTypes: string[];
  /** Position in paper doll layout (for UI) */
  position: {
    row: number;
    col: number;
  };
  /** Whether this slot conflicts with another (e.g., twoHand vs offHand) */
  conflictsWith?: EquipmentSlotType[];
}

/** Item rarity levels */
export type ItemRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

/** Base item stat types */
export type StatType =
  | "strength"
  | "agility"
  | "intelligence"
  | "stamina"
  | "armor"
  | "attackPower"
  | "spellPower"
  | "critChance"
  | "critDamage"
  | "haste"
  | "accuracy"
  | "evasion"
  | "healthRegen"
  | "manaRegen"
  | "movementSpeed";

/** Item stats mapping */
export interface ItemStats {
  [key: string]: number;
}

/** Extended item data for equipment */
export interface EquipmentItemData extends ItemData {
  /** Item level */
  itemLevel: number;
  /** Item rarity */
  rarity: ItemRarity;
  /** Equipment slot this item fits */
  equipSlot: EquipmentSlotType | EquipmentSlotType[];
  /** Item stats */
  stats: ItemStats;
  /** Current durability (0-100) */
  durability?: number;
  /** Maximum durability */
  maxDurability?: number;
  /** Required level to equip */
  requiredLevel?: number;
  /** Set ID if part of a set */
  setId?: string;
  /** Soulbound status */
  soulbound?: boolean;
  /** Enchantments */
  enchantments?: Array<{
    name: string;
    stat: string;
    value: number;
  }>;
}

/** Equipment set definition */
export interface EquipmentSet {
  /** Set identifier */
  id: string;
  /** Set display name */
  name: string;
  /** Item IDs in this set */
  itemIds: string[];
  /** Bonuses granted at piece thresholds */
  bonuses: Array<{
    /** Number of pieces required */
    pieces: number;
    /** Stats granted */
    stats: ItemStats;
    /** Special effect description */
    effect?: string;
  }>;
}

/** Equipment state for all slots */
export type EquipmentState = {
  [K in EquipmentSlotType]: EquipmentItemData | null;
};

// ============================================================================
// Slot Configuration
// ============================================================================

/** Default slot configuration for paper doll layout */
export const EQUIPMENT_SLOT_CONFIGS: Record<
  EquipmentSlotType,
  EquipmentSlotConfig
> = {
  head: {
    type: "head",
    label: "Head",
    acceptsTypes: ["head", "helmet", "hat", "hood", "crown"],
    position: { row: 0, col: 1 },
  },
  shoulders: {
    type: "shoulders",
    label: "Shoulders",
    acceptsTypes: ["shoulders", "pauldrons", "mantle"],
    position: { row: 1, col: 0 },
  },
  chest: {
    type: "chest",
    label: "Chest",
    acceptsTypes: ["chest", "body", "robe", "platebody", "chestplate"],
    position: { row: 1, col: 1 },
  },
  hands: {
    type: "hands",
    label: "Hands",
    acceptsTypes: ["hands", "gloves", "gauntlets"],
    position: { row: 2, col: 0 },
  },
  legs: {
    type: "legs",
    label: "Legs",
    acceptsTypes: ["legs", "platelegs", "pants", "skirt"],
    position: { row: 2, col: 1 },
  },
  feet: {
    type: "feet",
    label: "Feet",
    acceptsTypes: ["feet", "boots", "shoes"],
    position: { row: 3, col: 1 },
  },
  mainHand: {
    type: "mainHand",
    label: "Main Hand",
    acceptsTypes: ["weapon", "sword", "axe", "mace", "dagger", "staff", "wand"],
    position: { row: 1, col: 3 },
    conflictsWith: ["twoHand"],
  },
  offHand: {
    type: "offHand",
    label: "Off Hand",
    acceptsTypes: ["shield", "offhand", "tome", "orb", "defender"],
    position: { row: 2, col: 3 },
    conflictsWith: ["twoHand"],
  },
  twoHand: {
    type: "twoHand",
    label: "Two Hand",
    acceptsTypes: [
      "twohand",
      "bow",
      "crossbow",
      "2h_sword",
      "2h_axe",
      "2h_mace",
    ],
    position: { row: 1, col: 3 }, // Same as mainHand in UI
    conflictsWith: ["mainHand", "offHand"],
  },
  neck: {
    type: "neck",
    label: "Neck",
    acceptsTypes: ["neck", "amulet", "necklace", "pendant"],
    position: { row: 0, col: 3 },
  },
  ring1: {
    type: "ring1",
    label: "Ring",
    acceptsTypes: ["ring"],
    position: { row: 3, col: 0 },
  },
  ring2: {
    type: "ring2",
    label: "Ring",
    acceptsTypes: ["ring"],
    position: { row: 3, col: 2 },
  },
  back: {
    type: "back",
    label: "Back",
    acceptsTypes: ["back", "cape", "cloak"],
    position: { row: 1, col: 2 },
  },
  belt: {
    type: "belt",
    label: "Belt",
    acceptsTypes: ["belt", "sash"],
    position: { row: 2, col: 2 },
  },
  ammo: {
    type: "ammo",
    label: "Ammo",
    acceptsTypes: ["ammo", "arrow", "bolt", "thrown", "rune"],
    position: { row: 0, col: 0 },
  },
};

/** All slot types in display order */
export const EQUIPMENT_SLOTS: EquipmentSlotType[] = [
  "head",
  "shoulders",
  "chest",
  "hands",
  "legs",
  "feet",
  "mainHand",
  "offHand",
  "twoHand",
  "neck",
  "ring1",
  "ring2",
  "back",
  "belt",
  "ammo",
];

// ============================================================================
// Rarity Configuration
// ============================================================================

/** Rarity colors for item display */
export const RARITY_COLORS: Record<ItemRarity, string> = {
  common: "#9d9d9d",
  uncommon: "#1eff00",
  rare: "#0070dd",
  epic: "#a335ee",
  legendary: "#ff8000",
  mythic: "#e6cc80",
};

/** Rarity display names */
export const RARITY_NAMES: Record<ItemRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
};

/** Rarity sort order (higher = better) */
export const RARITY_ORDER: Record<ItemRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if an item can be equipped in a specific slot
 */
export function canEquipInSlot(
  item: EquipmentItemData,
  slotType: EquipmentSlotType,
): boolean {
  const slotConfig = EQUIPMENT_SLOT_CONFIGS[slotType];
  if (!slotConfig) return false;

  // Check if item's equipSlot matches
  const itemSlots = Array.isArray(item.equipSlot)
    ? item.equipSlot
    : [item.equipSlot];
  if (!itemSlots.includes(slotType)) {
    // Also check if item type is accepted by slot
    const itemType = item.equipSlot as string;
    if (!slotConfig.acceptsTypes.includes(itemType)) {
      return false;
    }
  }

  return true;
}

/**
 * Get slots that would conflict with equipping an item
 */
export function getConflictingSlots(
  slotType: EquipmentSlotType,
  currentEquipment: EquipmentState,
): EquipmentSlotType[] {
  const slotConfig = EQUIPMENT_SLOT_CONFIGS[slotType];
  if (!slotConfig?.conflictsWith) return [];

  return slotConfig.conflictsWith.filter(
    (slot) => currentEquipment[slot] !== null,
  );
}

/**
 * Find valid slots for an item
 */
export function findValidSlots(item: EquipmentItemData): EquipmentSlotType[] {
  const itemSlots = Array.isArray(item.equipSlot)
    ? item.equipSlot
    : [item.equipSlot];
  return itemSlots.filter((slot) => EQUIPMENT_SLOT_CONFIGS[slot]);
}

/**
 * Check if player meets requirements to equip an item
 */
export function meetsRequirements(
  item: EquipmentItemData,
  playerLevel: number,
): { canEquip: boolean; reason?: string } {
  if (item.requiredLevel && playerLevel < item.requiredLevel) {
    return {
      canEquip: false,
      reason: `Requires level ${item.requiredLevel}`,
    };
  }

  return { canEquip: true };
}

// ============================================================================
// Stat Calculation Functions
// ============================================================================

/**
 * Calculate total stats from all equipped items
 */
export function calculateTotalStats(equipment: EquipmentState): ItemStats {
  const totalStats: ItemStats = {};

  for (const slotType of EQUIPMENT_SLOTS) {
    const item = equipment[slotType];
    if (!item) continue;

    // Add base stats
    for (const [stat, value] of Object.entries(item.stats)) {
      totalStats[stat] = (totalStats[stat] || 0) + value;
    }

    // Add enchantment stats
    if (item.enchantments) {
      for (const enchant of item.enchantments) {
        totalStats[enchant.stat] =
          (totalStats[enchant.stat] || 0) + enchant.value;
      }
    }
  }

  return totalStats;
}

/**
 * Calculate set bonuses for currently equipped items
 */
export function calculateSetBonuses(
  equipment: EquipmentState,
  sets: EquipmentSet[],
): Array<{
  set: EquipmentSet;
  equippedCount: number;
  activeBonus: EquipmentSet["bonuses"][number] | null;
  nextBonus: EquipmentSet["bonuses"][number] | null;
}> {
  const equippedItemIds = new Set<string>();

  for (const slotType of EQUIPMENT_SLOTS) {
    const item = equipment[slotType];
    if (item) {
      equippedItemIds.add(item.id);
    }
  }

  return sets.map((set) => {
    const equippedCount = set.itemIds.filter((id) =>
      equippedItemIds.has(id),
    ).length;

    // Find highest active bonus
    const sortedBonuses = [...set.bonuses].sort((a, b) => b.pieces - a.pieces);
    const activeBonus =
      sortedBonuses.find((b) => b.pieces <= equippedCount) || null;

    // Find next bonus threshold
    const nextBonus =
      sortedBonuses.reverse().find((b) => b.pieces > equippedCount) || null;

    return {
      set,
      equippedCount,
      activeBonus,
      nextBonus,
    };
  });
}

/**
 * Compare stats between two items
 */
export function compareItemStats(
  equipped: EquipmentItemData | null,
  comparing: EquipmentItemData,
): Array<{
  stat: string;
  current: number;
  new: number;
  diff: number;
  isImprovement: boolean;
}> {
  const equippedStats = equipped?.stats || {};
  const comparingStats = comparing.stats;

  // Get all unique stats
  const allStats = new Set([
    ...Object.keys(equippedStats),
    ...Object.keys(comparingStats),
  ]);

  return Array.from(allStats).map((stat) => {
    const current = equippedStats[stat] || 0;
    const newValue = comparingStats[stat] || 0;
    const diff = newValue - current;

    return {
      stat,
      current,
      new: newValue,
      diff,
      isImprovement: diff > 0,
    };
  });
}

/**
 * Calculate item power score (for quick comparison)
 */
export function calculateItemPower(item: EquipmentItemData): number {
  let power = item.itemLevel;

  // Add rarity bonus
  power += RARITY_ORDER[item.rarity] * 10;

  // Add stat total (weighted)
  const statTotal = Object.values(item.stats).reduce(
    (sum, val) => sum + val,
    0,
  );
  power += statTotal;

  // Add enchantment bonus
  if (item.enchantments) {
    power += item.enchantments.length * 5;
  }

  return Math.round(power);
}

/**
 * Calculate average item level of equipped gear
 */
export function calculateAverageItemLevel(equipment: EquipmentState): number {
  let totalLevel = 0;
  let count = 0;

  for (const slotType of EQUIPMENT_SLOTS) {
    // Skip twoHand if mainHand/offHand are used
    if (slotType === "twoHand" && (equipment.mainHand || equipment.offHand)) {
      continue;
    }
    // Skip mainHand/offHand if twoHand is used
    if (
      (slotType === "mainHand" || slotType === "offHand") &&
      equipment.twoHand
    ) {
      continue;
    }

    const item = equipment[slotType];
    if (item) {
      totalLevel += item.itemLevel;
    }
    count++;
  }

  return count > 0 ? Math.round(totalLevel / count) : 0;
}

// ============================================================================
// Durability Functions
// ============================================================================

/**
 * Get durability status
 */
export function getDurabilityStatus(item: EquipmentItemData): {
  percent: number;
  status: "good" | "worn" | "damaged" | "broken";
  color: string;
} {
  if (item.durability === undefined || item.maxDurability === undefined) {
    return { percent: 100, status: "good", color: "#22c55e" };
  }

  const percent = Math.round((item.durability / item.maxDurability) * 100);

  if (percent <= 0) {
    return { percent: 0, status: "broken", color: "#6b7280" };
  }
  if (percent <= 25) {
    return { percent, status: "damaged", color: "#ef4444" };
  }
  if (percent <= 50) {
    return { percent, status: "worn", color: "#f59e0b" };
  }

  return { percent, status: "good", color: "#22c55e" };
}

/**
 * Check if any equipped items need repair
 */
export function getItemsNeedingRepair(
  equipment: EquipmentState,
  threshold: number = 25,
): EquipmentItemData[] {
  const needsRepair: EquipmentItemData[] = [];

  for (const slotType of EQUIPMENT_SLOTS) {
    const item = equipment[slotType];
    if (!item) continue;

    const { percent } = getDurabilityStatus(item);
    if (percent <= threshold) {
      needsRepair.push(item);
    }
  }

  return needsRepair;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create empty equipment state
 */
export function createEmptyEquipment(): EquipmentState {
  return {
    head: null,
    shoulders: null,
    chest: null,
    hands: null,
    legs: null,
    feet: null,
    mainHand: null,
    offHand: null,
    twoHand: null,
    neck: null,
    ring1: null,
    ring2: null,
    back: null,
    belt: null,
    ammo: null,
  };
}

/**
 * Format stat name for display
 */
export function formatStatName(stat: string): string {
  return stat
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Format stat value for display
 */
export function formatStatValue(stat: string, value: number): string {
  // Percentage stats
  if (
    [
      "critChance",
      "critDamage",
      "haste",
      "accuracy",
      "evasion",
      "movementSpeed",
    ].includes(stat)
  ) {
    return `${value.toFixed(1)}%`;
  }

  // Integer stats
  return value.toLocaleString();
}

/**
 * Get slot display name
 */
export function getSlotDisplayName(slotType: EquipmentSlotType): string {
  return EQUIPMENT_SLOT_CONFIGS[slotType]?.label || slotType;
}
