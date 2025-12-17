/**
 * Game Item Types
 *
 * Extended item types for game content generation.
 * Re-exports core types for convenience.
 */

import type {
  Rarity,
  WeaponType,
  AttackType,
  ItemType,
  EquipSlot,
  CombatBonuses,
  Requirements,
} from "../core";

// Re-export core types for backwards compatibility
export type { Rarity as ItemRarity } from "../core";
export type { WeaponType, AttackType, ItemType, EquipSlot } from "../core";
export type { CombatBonuses, Requirements as ItemRequirements } from "../core";

// =============================================================================
// ITEM EFFECTS
// =============================================================================

/**
 * Effect that can be applied by consumable items
 */
export interface ItemEffect {
  type: "heal" | "buff" | "debuff" | "teleport" | "unlock";
  value?: number;
  duration?: number; // In seconds
  target?: string; // For teleport/unlock
}

// =============================================================================
// FULL ITEM TYPE
// =============================================================================

/**
 * Complete item definition for game content
 */
export interface Item {
  id: string;
  name: string;
  type: ItemType;
  subtype?: string;
  description: string;
  examine: string;
  rarity: Rarity;
  value?: number;
  weight?: number;
  stackable?: boolean;
  tradeable: boolean;

  // Equipment properties
  equipSlot?: EquipSlot;
  weaponType?: WeaponType | null;
  attackType?: AttackType | null;
  attackSpeed?: number;
  attackRange?: number;
  twoHanded?: boolean;
  is2h?: boolean;

  // Stats
  bonuses?: CombatBonuses;
  requirements?: Requirements;

  // Consumable effects
  effects?: ItemEffect[];
  healAmount?: number;

  // Model paths
  modelPath?: string | null;
  iconPath?: string;
  equippedModelPath?: string | null;
}

/**
 * Generated item content with metadata
 */
export interface GeneratedItemContent {
  item: Item;
  generatedAt: string;
  prompt: string;
}
