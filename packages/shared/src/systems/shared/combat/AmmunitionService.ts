/**
 * AmmunitionService - Handles arrow consumption for ranged combat
 *
 * F2P Scope: Standard arrows only (no bolts, no thrown weapons, no Ava's device)
 * Consumption rate: 100% (1 arrow per shot)
 *
 * Responsibilities:
 * - Validate player has compatible arrows equipped
 * - Consume arrows on attack
 * - Get ranged strength bonus from equipped arrows
 */

import type { Item, EquipmentSlot } from "../../../types/game/item-types";
import { WeaponType } from "../../../types/game/item-types";

/**
 * Arrow data from the ammunition manifest
 */
export interface ArrowData {
  id: string;
  name: string;
  rangedStrength: number;
  requiredRangedLevel: number;
  requiredBowTier: number;
}

/**
 * Result of arrow validation
 */
export interface ArrowValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: "NO_ARROWS" | "INCOMPATIBLE_ARROWS" | "LEVEL_TOO_LOW";
}

/**
 * Result of arrow consumption
 */
export interface ArrowConsumeResult {
  success: boolean;
  error?: string;
  rangedStrengthBonus: number;
  remainingQuantity: number;
  consumedArrowId: string;
}

/**
 * Bow tier requirements for arrows
 * Maps bow ID to minimum tier level
 */
const BOW_TIERS: Record<string, number> = {
  shortbow: 1,
  oak_shortbow: 5,
  willow_shortbow: 20,
  maple_shortbow: 30,
};

/**
 * Arrow strength bonuses (from ammunition.json manifest)
 */
const ARROW_DATA: Record<string, ArrowData> = {
  bronze_arrow: {
    id: "bronze_arrow",
    name: "Bronze arrow",
    rangedStrength: 7,
    requiredRangedLevel: 1,
    requiredBowTier: 1,
  },
  iron_arrow: {
    id: "iron_arrow",
    name: "Iron arrow",
    rangedStrength: 10,
    requiredRangedLevel: 1,
    requiredBowTier: 1,
  },
  steel_arrow: {
    id: "steel_arrow",
    name: "Steel arrow",
    rangedStrength: 16,
    requiredRangedLevel: 5,
    requiredBowTier: 5,
  },
  mithril_arrow: {
    id: "mithril_arrow",
    name: "Mithril arrow",
    rangedStrength: 22,
    requiredRangedLevel: 20,
    requiredBowTier: 20,
  },
  adamant_arrow: {
    id: "adamant_arrow",
    name: "Adamant arrow",
    rangedStrength: 31,
    requiredRangedLevel: 30,
    requiredBowTier: 30,
  },
};

/**
 * AmmunitionService class for managing arrow consumption
 */
export class AmmunitionService {
  /**
   * Validate that the player has compatible arrows equipped
   *
   * @param bow - The equipped bow item
   * @param arrowSlot - The equipment slot containing arrows (or null if empty)
   * @param rangedLevel - Player's ranged level
   * @returns Validation result
   */
  validateArrows(
    bow: Item | null,
    arrowSlot: EquipmentSlot | null,
    rangedLevel: number = 1,
  ): ArrowValidationResult {
    // Must have a bow equipped
    // Normalize to lowercase for comparison (JSON may have uppercase values like "BOW")
    const weaponType = bow?.weaponType?.toLowerCase?.() ?? bow?.weaponType;
    if (!bow || weaponType !== "bow") {
      return {
        valid: false,
        error: "No bow equipped",
        errorCode: "NO_ARROWS",
      };
    }

    // Must have arrows equipped
    if (!arrowSlot || !arrowSlot.itemId) {
      return {
        valid: false,
        error: "You need arrows to use a bow",
        errorCode: "NO_ARROWS",
      };
    }

    const arrowId = String(arrowSlot.itemId);
    const arrowData = ARROW_DATA[arrowId];

    if (!arrowData) {
      return {
        valid: false,
        error: "Invalid arrow type",
        errorCode: "INCOMPATIBLE_ARROWS",
      };
    }

    // Check ranged level requirement
    if (rangedLevel < arrowData.requiredRangedLevel) {
      return {
        valid: false,
        error: `You need level ${arrowData.requiredRangedLevel} Ranged to use ${arrowData.name}`,
        errorCode: "LEVEL_TOO_LOW",
      };
    }

    // Check bow tier compatibility
    const bowTier = BOW_TIERS[bow.id] ?? 1;
    if (bowTier < arrowData.requiredBowTier) {
      return {
        valid: false,
        error: `Your bow cannot fire ${arrowData.name}`,
        errorCode: "INCOMPATIBLE_ARROWS",
      };
    }

    return { valid: true };
  }

  /**
   * Get arrow data by ID
   */
  getArrowData(arrowId: string): ArrowData | undefined {
    return ARROW_DATA[arrowId];
  }

  /**
   * Get ranged strength bonus from equipped arrows
   *
   * @param arrowSlot - The equipment slot containing arrows
   * @returns Ranged strength bonus (0 if no valid arrows)
   */
  getArrowStrengthBonus(arrowSlot: EquipmentSlot | null): number {
    if (!arrowSlot || !arrowSlot.itemId) {
      return 0;
    }

    const arrowData = ARROW_DATA[String(arrowSlot.itemId)];
    return arrowData?.rangedStrength ?? 0;
  }

  /**
   * Check if player has arrows equipped
   */
  hasArrows(arrowSlot: EquipmentSlot | null): boolean {
    if (!arrowSlot || !arrowSlot.itemId) {
      return false;
    }

    const arrowId = String(arrowSlot.itemId);
    return arrowId in ARROW_DATA;
  }

  /**
   * Get the bow tier for arrow compatibility checking
   */
  getBowTier(bowId: string): number {
    return BOW_TIERS[bowId] ?? 1;
  }

  /**
   * Check if arrows are compatible with bow
   */
  areArrowsCompatible(bowId: string, arrowId: string): boolean {
    const bowTier = BOW_TIERS[bowId] ?? 1;
    const arrowData = ARROW_DATA[arrowId];

    if (!arrowData) {
      return false;
    }

    return bowTier >= arrowData.requiredBowTier;
  }
}

// Export singleton instance
export const ammunitionService = new AmmunitionService();
