/**
 * Cooking Calculator
 *
 * OSRS-accurate cooking burn rate calculations.
 * Uses lookup tables for stop-burn levels per food type.
 *
 * @see https://oldschool.runescape.wiki/w/Cooking
 * @see https://oldschool.runescape.wiki/w/Cooking/Burn_level
 */

import {
  PROCESSING_CONSTANTS,
  type RawFoodId,
  type CookingSourceType,
} from "../../../../constants/ProcessingConstants";

/**
 * Get stop-burn level for a food type and cooking source.
 *
 * @param rawFoodId - Raw food item ID (e.g., "raw_shrimp")
 * @param sourceType - Cooking source type ("fire" or "range")
 * @returns Level at which burning stops, or 99 if invalid food
 */
export function getStopBurnLevel(
  rawFoodId: string,
  sourceType: CookingSourceType,
): number {
  const burnLevels =
    PROCESSING_CONSTANTS.COOKING_BURN_LEVELS[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_BURN_LEVELS
    ];

  if (!burnLevels) {
    return 99; // Unknown food - assume never stops burning
  }

  return burnLevels[sourceType];
}

/**
 * Calculate burn chance for cooking.
 *
 * Uses linear interpolation between levelRequired and stopBurnLevel:
 * - At levelRequired: ~100% burn chance (actually depends on food)
 * - At stopBurnLevel: 0% burn chance
 *
 * @param cookingLevel - Player's cooking level
 * @param rawFoodId - Raw food item ID
 * @param sourceType - Cooking source type ("fire" or "range")
 * @returns Burn probability (0-1)
 */
export function calculateBurnChance(
  cookingLevel: number,
  rawFoodId: string,
  sourceType: CookingSourceType,
): number {
  const levelRequired = getCookingLevelRequired(rawFoodId);
  const stopBurnLevel = getStopBurnLevel(rawFoodId, sourceType);

  // Already past stop-burn level
  if (cookingLevel >= stopBurnLevel) {
    return 0;
  }

  // Below level requirement (shouldn't happen, but handle gracefully)
  if (cookingLevel < levelRequired) {
    return 1;
  }

  // Linear interpolation between levelRequired and stopBurnLevel
  const range = stopBurnLevel - levelRequired;
  if (range <= 0) {
    return 0; // Edge case: stopBurn <= levelRequired
  }

  const progress = cookingLevel - levelRequired;
  return Math.max(0, 1 - progress / range);
}

/**
 * Roll whether food burns based on burn chance.
 *
 * @param cookingLevel - Player's cooking level
 * @param rawFoodId - Raw food item ID
 * @param sourceType - Cooking source type
 * @returns True if food burns, false if successfully cooked
 */
export function rollBurn(
  cookingLevel: number,
  rawFoodId: string,
  sourceType: CookingSourceType,
): boolean {
  const burnChance = calculateBurnChance(cookingLevel, rawFoodId, sourceType);
  return Math.random() < burnChance;
}

/**
 * Get cooking XP for a food type.
 *
 * @param rawFoodId - Raw food item ID
 * @returns XP amount, or 0 if invalid food
 */
export function getCookingXP(rawFoodId: string): number {
  const xp =
    PROCESSING_CONSTANTS.COOKING_XP[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_XP
    ];
  return xp ?? 0;
}

/**
 * Get required cooking level for a food type.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Required level, or 1 if invalid food
 */
export function getCookingLevelRequired(rawFoodId: string): number {
  const level =
    PROCESSING_CONSTANTS.COOKING_LEVELS[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.COOKING_LEVELS
    ];
  return level ?? 1;
}

/**
 * Check if player meets cooking level requirement for a food type.
 *
 * @param playerLevel - Player's cooking level
 * @param rawFoodId - Raw food item ID
 * @returns True if player can cook this food type
 */
export function meetsCookingLevel(
  playerLevel: number,
  rawFoodId: string,
): boolean {
  const required = getCookingLevelRequired(rawFoodId);
  return playerLevel >= required;
}

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
 * Get cooked item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Cooked item ID, or null if invalid
 */
export function getCookedItemId(rawFoodId: string): string | null {
  const cooked =
    PROCESSING_CONSTANTS.RAW_TO_COOKED[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.RAW_TO_COOKED
    ];
  return cooked ?? null;
}

/**
 * Get burnt item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Burnt item ID, or null if invalid
 */
export function getBurntItemId(rawFoodId: string): string | null {
  const burnt =
    PROCESSING_CONSTANTS.RAW_TO_BURNT[
      rawFoodId as keyof typeof PROCESSING_CONSTANTS.RAW_TO_BURNT
    ];
  return burnt ?? null;
}

/**
 * Get all valid raw food IDs.
 *
 * @returns Set of valid raw food item IDs
 */
export function getValidRawFoodIds(): ReadonlySet<string> {
  return PROCESSING_CONSTANTS.VALID_RAW_FOOD_IDS;
}
