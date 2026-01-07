/**
 * Food Utilities
 *
 * Validation and lookup utilities for cookable food items.
 * Uses data from items.json manifest via ProcessingDataProvider.
 */

import { processingDataProvider } from "../../../../data/ProcessingDataProvider";
import type { CookingSourceType } from "../../../../constants/ProcessingConstants";

/**
 * Check if an item ID is a valid raw food type.
 *
 * @param itemId - Item ID to check
 * @returns True if valid raw food
 */
export function isValidRawFood(itemId: string): boolean {
  return processingDataProvider.isCookable(itemId);
}

/**
 * Get all valid raw food IDs.
 *
 * @returns Set of valid raw food item IDs
 */
export function getValidRawFoodIds(): Set<string> {
  return processingDataProvider.getCookableItemIds();
}

/**
 * Get cooked item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Cooked item ID, or null if invalid
 */
export function getCookedItemId(rawFoodId: string): string | null {
  return processingDataProvider.getCookedItemId(rawFoodId);
}

/**
 * Get burnt item ID from raw food ID.
 *
 * @param rawFoodId - Raw food item ID
 * @returns Burnt item ID, or null if invalid
 */
export function getBurntItemId(rawFoodId: string): string | null {
  return processingDataProvider.getBurntItemId(rawFoodId);
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
  const cookingData = processingDataProvider.getCookingData(rawFoodId);

  if (!cookingData) {
    return null;
  }

  return {
    rawId: rawFoodId,
    cookedId: cookingData.cookedItemId,
    burntId: cookingData.burntItemId,
    levelRequired: cookingData.levelRequired,
    xp: cookingData.xp,
    stopBurnFire: cookingData.stopBurnLevel.fire,
    stopBurnRange: cookingData.stopBurnLevel.range,
  };
}

/**
 * Get all food types sorted by level requirement.
 *
 * @returns Array of food data sorted by level
 */
export function getAllFoodsSortedByLevel(): FoodDisplayData[] {
  const foods: FoodDisplayData[] = [];

  for (const rawId of processingDataProvider.getCookableItemIds()) {
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
  const cookingData = processingDataProvider.getCookingData(rawFoodId);

  if (!cookingData) {
    return false;
  }

  return cookingData.stopBurnLevel.range < cookingData.stopBurnLevel.fire;
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
  const cookingData = processingDataProvider.getCookingData(rawFoodId);

  if (!cookingData) {
    return "fire"; // Default
  }

  const { stopBurnLevel } = cookingData;

  // If player can't burn on fire, doesn't matter
  if (playerLevel >= stopBurnLevel.fire) {
    return "fire";
  }

  // If range has lower stop-burn, recommend range
  if (stopBurnLevel.range < stopBurnLevel.fire) {
    return "range";
  }

  return "fire";
}
