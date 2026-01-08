/**
 * ProcessingDataProvider - Runtime Data from Item Manifest
 *
 * Builds cooking, firemaking, and smelting lookup tables dynamically from the ITEMS map.
 * This is the proper data-driven approach where items.json is the source of truth.
 *
 * Usage:
 *   const provider = ProcessingDataProvider.getInstance();
 *   await provider.initialize(); // Called after DataManager loads manifests
 *   const cookingData = provider.getCookingData("raw_shrimp");
 *   const smeltingData = provider.getSmeltingData("bronze_bar");
 *
 * @see packages/server/world/assets/manifests/items.json for source data
 */

import { ITEMS } from "./items";
import type { Item } from "../types/game/item-types";
import type { SmithingCategory } from "./smithing-recipes";
import { SMITHING_CONSTANTS } from "../constants/SmithingConstants";

/**
 * Smithing recipe data extracted from item manifest
 * Note: This replaces the hardcoded SMITHING_RECIPES from smithing-recipes.ts
 */
export interface SmithingRecipeData {
  /** Output item ID */
  itemId: string;
  /** Display name for the item */
  name: string;
  /** Bar type required (e.g., "bronze_bar") */
  barType: string;
  /** Number of bars needed */
  barsRequired: number;
  /** Smithing level required */
  levelRequired: number;
  /** XP granted per item made */
  xp: number;
  /** Category for UI grouping */
  category: SmithingCategory;
  /** Time in game ticks (600ms per tick). Default: 4 */
  ticks: number;
}

/**
 * Cooking data extracted from item manifest
 */
export interface CookingItemData {
  rawItemId: string;
  cookedItemId: string;
  burntItemId: string;
  levelRequired: number;
  xp: number;
  stopBurnLevel: {
    fire: number;
    range: number;
  };
}

/**
 * Firemaking data extracted from item manifest
 */
export interface FiremakingItemData {
  logId: string;
  levelRequired: number;
  xp: number;
}

/**
 * Smelting data extracted from item manifest (defined on bars)
 */
export interface SmeltingItemData {
  barItemId: string;
  primaryOre: string;
  secondaryOre: string | null;
  coalRequired: number;
  levelRequired: number;
  xp: number;
  successRate: number;
  /** Time in game ticks (600ms per tick). Default: 4 */
  ticks: number;
}

/**
 * Runtime data provider for cooking, firemaking, and smelting systems.
 * Builds lookup tables from the ITEMS manifest after DataManager loads.
 */
export class ProcessingDataProvider {
  private static instance: ProcessingDataProvider;
  private isInitialized = false;

  // Cooking lookup tables (built from manifest)
  private cookingDataMap = new Map<string, CookingItemData>();
  private cookableItemIds = new Set<string>();

  // Firemaking lookup tables (built from manifest)
  private firemakingDataMap = new Map<string, FiremakingItemData>();
  private burneableLogIds = new Set<string>();

  // Smelting lookup tables (built from manifest)
  private smeltingDataMap = new Map<string, SmeltingItemData>();
  private smeltableBarIds = new Set<string>();

  // Smithing lookup tables (built from manifest)
  private smithingRecipeMap = new Map<string, SmithingRecipeData>();
  private smithableItemIds = new Set<string>();
  private smithingRecipesByBar = new Map<string, SmithingRecipeData[]>();

  private constructor() {
    // Singleton
  }

  public static getInstance(): ProcessingDataProvider {
    if (!ProcessingDataProvider.instance) {
      ProcessingDataProvider.instance = new ProcessingDataProvider();
    }
    return ProcessingDataProvider.instance;
  }

  /**
   * Initialize the data provider by scanning ITEMS for cooking/firemaking/smelting data.
   * Must be called AFTER DataManager.initialize() has loaded the manifest.
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    this.buildCookingData();
    this.buildFiremakingData();
    this.buildSmeltingData();
    this.buildSmithingData();
    this.isInitialized = true;

    console.log(
      `[ProcessingDataProvider] Initialized: ${this.cookableItemIds.size} cookable items, ${this.burneableLogIds.size} burnable logs, ${this.smeltableBarIds.size} smeltable bars, ${this.smithableItemIds.size} smithable items`,
    );
  }

  /**
   * Rebuild data (for hot-reload scenarios)
   */
  public rebuild(): void {
    this.cookingDataMap.clear();
    this.cookableItemIds.clear();
    this.firemakingDataMap.clear();
    this.burneableLogIds.clear();
    this.smeltingDataMap.clear();
    this.smeltableBarIds.clear();
    this.smithingRecipeMap.clear();
    this.smithableItemIds.clear();
    this.smithingRecipesByBar.clear();
    this.isInitialized = false;
    this.initialize();
  }

  /**
   * Scan ITEMS for items with `cooking` property
   */
  private buildCookingData(): void {
    for (const [itemId, item] of ITEMS) {
      if (item.cooking) {
        const cookingData: CookingItemData = {
          rawItemId: itemId,
          cookedItemId: item.cooking.cookedItemId,
          burntItemId: item.cooking.burntItemId,
          levelRequired: item.cooking.levelRequired,
          xp: item.cooking.xp,
          stopBurnLevel: {
            fire: item.cooking.stopBurnLevel.fire,
            range: item.cooking.stopBurnLevel.range,
          },
        };
        this.cookingDataMap.set(itemId, cookingData);
        this.cookableItemIds.add(itemId);
      }
    }
  }

  /**
   * Scan ITEMS for items with `firemaking` property
   */
  private buildFiremakingData(): void {
    for (const [itemId, item] of ITEMS) {
      if (item.firemaking) {
        const firemakingData: FiremakingItemData = {
          logId: itemId,
          levelRequired: item.firemaking.levelRequired,
          xp: item.firemaking.xp,
        };
        this.firemakingDataMap.set(itemId, firemakingData);
        this.burneableLogIds.add(itemId);
      }
    }
  }

  /**
   * Scan ITEMS for items with `smelting` property (bars define their recipes)
   */
  private buildSmeltingData(): void {
    for (const [itemId, item] of ITEMS) {
      if (item.smelting) {
        const smeltingData: SmeltingItemData = {
          barItemId: itemId,
          primaryOre: item.smelting.primaryOre,
          secondaryOre: item.smelting.secondaryOre || null,
          coalRequired: item.smelting.coalRequired,
          levelRequired: item.smelting.levelRequired,
          xp: item.smelting.xp,
          successRate: item.smelting.successRate,
          ticks:
            item.smelting.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMELTING_TICKS,
        };
        this.smeltingDataMap.set(itemId, smeltingData);
        this.smeltableBarIds.add(itemId);
      }
    }
  }

  /**
   * Scan ITEMS for items with `smithing` property (output items define their recipes)
   */
  private buildSmithingData(): void {
    for (const [itemId, item] of ITEMS) {
      if (item.smithing) {
        const recipeData: SmithingRecipeData = {
          itemId,
          name: item.name,
          barType: item.smithing.barType,
          barsRequired: item.smithing.barsRequired,
          levelRequired: item.smithing.levelRequired,
          xp: item.smithing.xp,
          category: item.smithing.category as SmithingCategory,
          ticks:
            item.smithing.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMITHING_TICKS,
        };

        // Add to main map (keyed by output item ID)
        this.smithingRecipeMap.set(itemId, recipeData);
        this.smithableItemIds.add(itemId);

        // Add to bar-grouped map for UI lookups
        const barRecipes =
          this.smithingRecipesByBar.get(item.smithing.barType) || [];
        barRecipes.push(recipeData);
        this.smithingRecipesByBar.set(item.smithing.barType, barRecipes);
      }
    }
  }

  // ==========================================================================
  // COOKING ACCESSORS
  // ==========================================================================

  /**
   * Check if an item is cookable
   */
  public isCookable(itemId: string): boolean {
    this.ensureInitialized();
    return this.cookableItemIds.has(itemId);
  }

  /**
   * Get cooking data for a raw food item
   */
  public getCookingData(rawItemId: string): CookingItemData | null {
    this.ensureInitialized();
    return this.cookingDataMap.get(rawItemId) || null;
  }

  /**
   * Get all cookable item IDs (replaces VALID_RAW_FOOD_IDS)
   */
  public getCookableItemIds(): Set<string> {
    this.ensureInitialized();
    return this.cookableItemIds;
  }

  /**
   * Get cooked item ID for a raw food
   */
  public getCookedItemId(rawItemId: string): string | null {
    const data = this.getCookingData(rawItemId);
    return data?.cookedItemId || null;
  }

  /**
   * Get burnt item ID for a raw food
   */
  public getBurntItemId(rawItemId: string): string | null {
    const data = this.getCookingData(rawItemId);
    return data?.burntItemId || null;
  }

  /**
   * Get cooking level requirement
   */
  public getCookingLevel(rawItemId: string): number {
    const data = this.getCookingData(rawItemId);
    return data?.levelRequired ?? 1;
  }

  /**
   * Get cooking XP
   */
  public getCookingXP(rawItemId: string): number {
    const data = this.getCookingData(rawItemId);
    return data?.xp ?? 0;
  }

  /**
   * Get stop burn level for a cooking source
   */
  public getStopBurnLevel(rawItemId: string, source: "fire" | "range"): number {
    const data = this.getCookingData(rawItemId);
    return data?.stopBurnLevel[source] ?? 99;
  }

  // ==========================================================================
  // FIREMAKING ACCESSORS
  // ==========================================================================

  /**
   * Check if an item is a burnable log
   */
  public isBurnableLog(itemId: string): boolean {
    this.ensureInitialized();
    return this.burneableLogIds.has(itemId);
  }

  /**
   * Get firemaking data for a log
   */
  public getFiremakingData(logId: string): FiremakingItemData | null {
    this.ensureInitialized();
    return this.firemakingDataMap.get(logId) || null;
  }

  /**
   * Get all burnable log IDs (replaces VALID_LOG_IDS)
   */
  public getBurnableLogIds(): Set<string> {
    this.ensureInitialized();
    return this.burneableLogIds;
  }

  /**
   * Get firemaking level requirement
   */
  public getFiremakingLevel(logId: string): number {
    const data = this.getFiremakingData(logId);
    return data?.levelRequired ?? 1;
  }

  /**
   * Get firemaking XP
   */
  public getFiremakingXP(logId: string): number {
    const data = this.getFiremakingData(logId);
    return data?.xp ?? 0;
  }

  // ==========================================================================
  // SMELTING ACCESSORS
  // ==========================================================================

  /**
   * Check if an item is a smeltable bar
   */
  public isSmeltableBar(itemId: string): boolean {
    this.ensureInitialized();
    return this.smeltableBarIds.has(itemId);
  }

  /**
   * Get smelting data for a bar
   */
  public getSmeltingData(barItemId: string): SmeltingItemData | null {
    this.ensureInitialized();
    return this.smeltingDataMap.get(barItemId) || null;
  }

  /**
   * Get all smeltable bar IDs
   */
  public getSmeltableBarIds(): Set<string> {
    this.ensureInitialized();
    return this.smeltableBarIds;
  }

  /**
   * Get smelting level requirement for a bar
   */
  public getSmeltingLevel(barItemId: string): number {
    const data = this.getSmeltingData(barItemId);
    return data?.levelRequired ?? 1;
  }

  /**
   * Get smelting XP for a bar
   */
  public getSmeltingXP(barItemId: string): number {
    const data = this.getSmeltingData(barItemId);
    return data?.xp ?? 0;
  }

  /**
   * Get smelting ticks for a bar (time in game ticks)
   */
  public getSmeltingTicks(barItemId: string): number {
    const data = this.getSmeltingData(barItemId);
    return data?.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMELTING_TICKS;
  }

  /**
   * Check if an item is an ore that can be used for smelting.
   * Returns true for primary ores (copper, tin, iron, mithril) and coal.
   */
  public isSmeltableOre(itemId: string): boolean {
    this.ensureInitialized();

    // Check if this ore is used in any smelting recipe
    for (const smeltingData of this.smeltingDataMap.values()) {
      if (smeltingData.primaryOre === itemId) {
        return true;
      }
      if (smeltingData.secondaryOre === itemId) {
        return true;
      }
      // Coal is always smeltable if any recipe uses it
      if (smeltingData.coalRequired > 0 && itemId === "coal") {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all ore IDs that can be used for smelting.
   */
  public getSmeltableOreIds(): Set<string> {
    this.ensureInitialized();
    const oreIds = new Set<string>();

    for (const smeltingData of this.smeltingDataMap.values()) {
      oreIds.add(smeltingData.primaryOre);
      if (smeltingData.secondaryOre) {
        oreIds.add(smeltingData.secondaryOre);
      }
      if (smeltingData.coalRequired > 0) {
        oreIds.add("coal");
      }
    }
    return oreIds;
  }

  /**
   * Get all bars that can be smelted from the given inventory items.
   * Returns bars where player has all required ores and coal.
   *
   * @param inventory - Array of items with itemId and quantity
   * @param smithingLevel - Player's smithing level
   */
  public getSmeltableBarsFromInventory(
    inventory: Array<{ itemId: string; quantity?: number }>,
    smithingLevel: number,
  ): SmeltingItemData[] {
    this.ensureInitialized();

    // Build inventory counts
    const itemCounts = new Map<string, number>();
    for (const item of inventory) {
      const current = itemCounts.get(item.itemId) || 0;
      itemCounts.set(item.itemId, current + (item.quantity || 1));
    }

    const result: SmeltingItemData[] = [];

    for (const smeltingData of this.smeltingDataMap.values()) {
      // Check level requirement
      if (smeltingData.levelRequired > smithingLevel) {
        continue;
      }

      // Check primary ore
      const primaryCount = itemCounts.get(smeltingData.primaryOre) || 0;
      if (primaryCount < 1) {
        continue;
      }

      // Check secondary ore (for bronze)
      if (smeltingData.secondaryOre) {
        const secondaryCount = itemCounts.get(smeltingData.secondaryOre) || 0;
        if (secondaryCount < 1) {
          continue;
        }
      }

      // Check coal requirement
      if (smeltingData.coalRequired > 0) {
        const coalCount = itemCounts.get("coal") || 0;
        if (coalCount < smeltingData.coalRequired) {
          continue;
        }
      }

      result.push(smeltingData);
    }

    return result;
  }

  // ==========================================================================
  // SMITHING ACCESSORS (built from manifest)
  // ==========================================================================

  /**
   * Check if an item is smithable (can be made at an anvil)
   */
  public isSmithableItem(itemId: string): boolean {
    this.ensureInitialized();
    return this.smithableItemIds.has(itemId);
  }

  /**
   * Get smithing recipe data for an output item
   */
  public getSmithingRecipe(itemId: string): SmithingRecipeData | null {
    this.ensureInitialized();
    return this.smithingRecipeMap.get(itemId) || null;
  }

  /**
   * Get all smithable item IDs
   */
  public getSmithableItemIds(): Set<string> {
    this.ensureInitialized();
    return this.smithableItemIds;
  }

  /**
   * Get smithing recipes for a specific bar type
   */
  public getSmithingRecipesForBar(barType: string): SmithingRecipeData[] {
    this.ensureInitialized();
    return this.smithingRecipesByBar.get(barType) || [];
  }

  /**
   * Get a specific smithing recipe by output item ID
   * @deprecated Use getSmithingRecipe instead
   */
  public getSmithingRecipeByItemId(
    itemId: string,
  ): SmithingRecipeData | undefined {
    this.ensureInitialized();
    return this.smithingRecipeMap.get(itemId);
  }

  /**
   * Get all smithing recipes
   */
  public getAllSmithingRecipes(): SmithingRecipeData[] {
    this.ensureInitialized();
    return Array.from(this.smithingRecipeMap.values());
  }

  /**
   * Get smithing level requirement for an item
   */
  public getSmithingLevel(itemId: string): number {
    const recipe = this.getSmithingRecipe(itemId);
    return recipe?.levelRequired ?? 1;
  }

  /**
   * Get smithing XP for an item
   */
  public getSmithingXP(itemId: string): number {
    const recipe = this.getSmithingRecipe(itemId);
    return recipe?.xp ?? 0;
  }

  /**
   * Get smithing ticks for an item (time in game ticks)
   */
  public getSmithingTicks(itemId: string): number {
    const recipe = this.getSmithingRecipe(itemId);
    return recipe?.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMITHING_TICKS;
  }

  /**
   * Get all recipes the player can make with their smithing level
   */
  public getAvailableSmithingRecipes(
    smithingLevel: number,
  ): SmithingRecipeData[] {
    this.ensureInitialized();
    return Array.from(this.smithingRecipeMap.values()).filter(
      (recipe) => recipe.levelRequired <= smithingLevel,
    );
  }

  /**
   * Get recipes grouped by category for a specific bar type (for UI display)
   */
  public getSmithingRecipesByCategory(
    barType: string,
  ): Map<SmithingCategory, SmithingRecipeData[]> {
    const recipes = this.getSmithingRecipesForBar(barType);
    const grouped = new Map<SmithingCategory, SmithingRecipeData[]>();

    for (const recipe of recipes) {
      const existing = grouped.get(recipe.category) || [];
      existing.push(recipe);
      grouped.set(recipe.category, existing);
    }

    return grouped;
  }

  /**
   * Get all items that can be smithed from the given inventory items.
   * Returns recipes where player has required bars.
   *
   * @param inventory - Array of items with itemId and quantity
   * @param smithingLevel - Player's smithing level
   */
  public getSmithableItemsFromInventory(
    inventory: Array<{ itemId: string; quantity?: number }>,
    smithingLevel: number,
  ): SmithingRecipeData[] {
    this.ensureInitialized();

    // Build inventory counts
    const itemCounts = new Map<string, number>();
    for (const item of inventory) {
      const current = itemCounts.get(item.itemId) || 0;
      itemCounts.set(item.itemId, current + (item.quantity || 1));
    }

    const result: SmithingRecipeData[] = [];

    for (const recipe of this.smithingRecipeMap.values()) {
      // Check level requirement
      if (recipe.levelRequired > smithingLevel) {
        continue;
      }

      // Check bar requirement
      const barCount = itemCounts.get(recipe.barType) || 0;
      if (barCount < recipe.barsRequired) {
        continue;
      }

      result.push(recipe);
    }

    return result;
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  /**
   * Ensure initialization has occurred
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      // Auto-initialize on first access (lazy initialization)
      this.initialize();
    }
  }

  /**
   * Check if provider is ready
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get summary for debugging
   */
  public getSummary(): {
    cookableItems: number;
    burnableLogs: number;
    smeltableBars: number;
    smithingRecipes: number;
    isInitialized: boolean;
  } {
    this.ensureInitialized();
    return {
      cookableItems: this.cookableItemIds.size,
      burnableLogs: this.burneableLogIds.size,
      smeltableBars: this.smeltableBarIds.size,
      smithingRecipes: this.smithingRecipeMap.size,
      isInitialized: this.isInitialized,
    };
  }
}

// Export singleton instance
export const processingDataProvider = ProcessingDataProvider.getInstance();
