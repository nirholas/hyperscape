/**
 * Food Utilities
 *
 * Validation and lookup utilities for cookable food items.
 * Used by cooking system for item validation.
 */

import {
  PROCESSING_CONSTANTS,
  type RawFoodId,
  type CookedFoodId,
  type BurntFoodId,
  type CookingSourceType,
} from "../../../../constants/ProcessingConstants";

/**
 * Check if an item ID is a valid raw food type.
 *
 * @param itemId - Item ID to check
 * @returns True if valid raw food
 */
export function isValidRawFood(itemId: string): itemId is RawFoodId {
  return PROCESSING_CONSTANTS.VALID_RAW_FOOD_IDS.has(itemId);
}

/**
 * Get all valid raw food IDs.
 *
 * @returns Set of valid raw food item IDs
 */
export function getValidRawFoodIds(): ReadonlySet<string> {
  return PROCESSING_CONSTANTS.VALID_RAW_FOOD_IDS;
}

/**
 * Get cooked item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Cooked item ID, or null if invalid
 */
export function getCookedItemId(rawFoodId: string): CookedFoodId | null {
  if (!isValidRawFood(rawFoodId)) {
    return null;
  }
  return PROCESSING_CONSTANTS.RAW_TO_COOKED[rawFoodId];
}

/**
 * Get burnt item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Burnt item ID, or null if invalid
 */
export function getBurntItemId(rawFoodId: string): BurntFoodId | null {
  if (!isValidRawFood(rawFoodId)) {
    return null;
  }
  return PROCESSING_CONSTANTS.RAW_TO_BURNT[rawFoodId];
}

/**
 * Food display data for UI purposes.
 */
export interface FoodDisplayData {
  rawId: string;
  cookedId: string;
  burntId: string;
  levelRequired: number;
  xp: number;
  stopBurnFire: number;
  stopBurnRange: number;
}

/**
 * Get display data for a food type.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Food display data, or null if invalid
 */
export function getFoodDisplayData(rawFoodId: string): FoodDisplayData | null {
  if (!isValidRawFood(rawFoodId)) {
    return null;
  }

  const burnLevels =
    PROCESSING_CONSTANTS.COOKING_BURN_LEVELS[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_BURN_LEVELS
    ];

  return {
    rawId: rawFoodId,
    cookedId: PROCESSING_CONSTANTS.RAW_TO_COOKED[rawFoodId],
    burntId: PROCESSING_CONSTANTS.RAW_TO_BURNT[rawFoodId],
    levelRequired:
      PROCESSING_CONSTANTS.COOKING_LEVELS[
        rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_LEVELS
      ],
    xp: PROCESSING_CONSTANTS.COOKING_XP[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_XP
    ],
    stopBurnFire: burnLevels.fire,
    stopBurnRange: burnLevels.range,
  };
}

/**
 * Get all food types sorted by level requirement.
 *
 * @returns Array of food data sorted by level
 */
export function getAllFoodsSortedByLevel(): FoodDisplayData[] {
  const foods: FoodDisplayData[] = [];

  for (const rawId of PROCESSING_CONSTANTS.VALID_RAW_FOOD_IDS) {
    const data = getFoodDisplayData(rawId);
    if (data) {
      foods.push(data);
    }
  }

  return foods.sort((a, b) => a.levelRequired - b.levelRequired);
}

/**
 * Check if cooking on range is better than fire for a food type.
 *
 * @param rawFoodId - Raw food item ID
 * @returns True if range has lower stop-burn level
 */
export function isRangeBetter(rawFoodId: string): boolean {
  const burnLevels =
    PROCESSING_CONSTANTS.COOKING_BURN_LEVELS[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_BURN_LEVELS
    ];

  if (!burnLevels) {
    return false;
  }

  return burnLevels.range < burnLevels.fire;
}

/**
 * Get recommended cooking source for player level and food.
 *
 * @param playerLevel - Player's cooking level
 * @param rawFoodId - Raw food item ID
 * @returns Recommended source type
 */
export function getRecommendedCookingSource(
  playerLevel: number,
  rawFoodId: string,
): CookingSourceType {
  const burnLevels =
    PROCESSING_CONSTANTS.COOKING_BURN_LEVELS[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_BURN_LEVELS
    ];

  if (!burnLevels) {
    return "fire"; // Default
  }

  // If player can't burn on fire, doesn't matter
  if (playerLevel >= burnLevels.fire) {
    return "fire";
  }

  // If range has lower stop-burn, recommend range
  if (burnLevels.range < burnLevels.fire) {
    return "range";
  }

  return "fire";
}
