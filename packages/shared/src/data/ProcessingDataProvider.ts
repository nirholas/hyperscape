/**
 * ProcessingDataProvider - Runtime Data from Recipe Manifests
 *
 * Builds cooking, firemaking, smelting, and smithing lookup tables from
 * dedicated recipe manifest files. This is the data-driven approach where
 * each skill's recipes are in separate JSON files:
 *
 *   - recipes/cooking.json
 *   - recipes/firemaking.json
 *   - recipes/smelting.json
 *   - recipes/smithing.json
 *
 * Usage:
 *   const provider = ProcessingDataProvider.getInstance();
 *   await provider.initialize(); // Called after DataManager loads manifests
 *   const cookingData = provider.getCookingData("raw_shrimp");
 *   const smeltingData = provider.getSmeltingData("bronze_bar");
 *
 * @see packages/server/world/assets/manifests/recipes/ for source data
 */

import { ITEMS } from "./items";
import type { SmithingCategory } from "./smithing-recipes";
import { SMITHING_CONSTANTS } from "../constants/SmithingConstants";

// ============================================================================
// RECIPE MANIFEST TYPES - Structures matching the JSON files
// ============================================================================

/**
 * Cooking recipe from recipes/cooking.json
 */
export interface CookingRecipeManifest {
  raw: string;
  cooked: string;
  burnt: string;
  level: number;
  xp: number;
  ticks: number;
  stopBurnLevel: { fire: number; range: number };
}

/**
 * Firemaking recipe from recipes/firemaking.json
 */
export interface FiremakingRecipeManifest {
  log: string;
  level: number;
  xp: number;
  ticks: number;
}

/**
 * Smelting recipe from recipes/smelting.json
 */
export interface SmeltingRecipeManifest {
  output: string;
  inputs: Array<{ item: string; amount: number }>;
  level: number;
  xp: number;
  ticks: number;
  successRate: number;
}

/**
 * Crafting recipe input from recipes/crafting.json
 */
export interface CraftingRecipeInput {
  item: string;
  amount: number;
}

/**
 * Crafting consumable from recipes/crafting.json
 */
export interface CraftingConsumable {
  item: string;
  uses: number;
}

/**
 * Crafting recipe from recipes/crafting.json
 */
export interface CraftingRecipeManifest {
  output: string;
  category: string;
  inputs: CraftingRecipeInput[];
  tools: string[];
  consumables: CraftingConsumable[];
  level: number;
  xp: number;
  ticks: number;
  station: string;
}

/**
 * Full manifest structure for recipes/crafting.json
 */
export interface CraftingManifest {
  recipes: CraftingRecipeManifest[];
}

/**
 * Crafting recipe data for runtime use
 */
export interface CraftingRecipeData {
  /** Output item ID */
  output: string;
  /** Display name for the item */
  name: string;
  /** Category for UI grouping (leather, studded, dragonhide, jewelry, gem_cutting) */
  category: string;
  /** Input materials required */
  inputs: CraftingRecipeInput[];
  /** Tool item IDs required in inventory (not consumed) */
  tools: string[];
  /** Consumable items with limited uses (e.g., thread with 5 uses) */
  consumables: CraftingConsumable[];
  /** Crafting level required */
  level: number;
  /** XP granted per item made */
  xp: number;
  /** Time in game ticks (600ms per tick) */
  ticks: number;
  /** Station required ("none" or "furnace") */
  station: string;
}

/**
 * Smithing recipe from recipes/smithing.json
 */
export interface SmithingRecipeManifest {
  output: string;
  bar: string;
  barsRequired: number;
  level: number;
  xp: number;
  ticks: number;
  category: string;
}

/**
 * Full manifest structure for recipes/cooking.json
 */
export interface CookingManifest {
  recipes: CookingRecipeManifest[];
}

/**
 * Full manifest structure for recipes/firemaking.json
 */
export interface FiremakingManifest {
  recipes: FiremakingRecipeManifest[];
}

/**
 * Full manifest structure for recipes/smelting.json
 */
export interface SmeltingManifest {
  recipes: SmeltingRecipeManifest[];
}

/**
 * Full manifest structure for recipes/smithing.json
 */
export interface SmithingManifest {
  recipes: SmithingRecipeManifest[];
}

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
 * Smithing recipe with availability info for UI display.
 * Includes flags to show whether player can actually make the item.
 */
export interface SmithingRecipeWithAvailability extends SmithingRecipeData {
  /** True if player meets the level requirement */
  meetsLevel: boolean;
  /** True if player has enough bars */
  hasBars: boolean;
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
 * Runtime data provider for cooking, firemaking, smelting, and smithing systems.
 * Builds lookup tables from recipe manifest files loaded by DataManager.
 */
export class ProcessingDataProvider {
  private static instance: ProcessingDataProvider;
  private isInitialized = false;

  // Cooking lookup tables (built from recipes/cooking.json)
  private cookingDataMap = new Map<string, CookingItemData>();
  private cookableItemIds = new Set<string>();

  // Firemaking lookup tables (built from recipes/firemaking.json)
  private firemakingDataMap = new Map<string, FiremakingItemData>();
  private burneableLogIds = new Set<string>();

  // Smelting lookup tables (built from recipes/smelting.json)
  private smeltingDataMap = new Map<string, SmeltingItemData>();
  private smeltableBarIds = new Set<string>();

  // Smithing lookup tables (built from recipes/smithing.json)
  private smithingRecipeMap = new Map<string, SmithingRecipeData>();
  private smithableItemIds = new Set<string>();
  private smithingRecipesByBar = new Map<string, SmithingRecipeData[]>();

  // Crafting lookup tables (built from recipes/crafting.json)
  private craftingRecipeMap = new Map<string, CraftingRecipeData>();
  private craftableItemIds = new Set<string>();
  private craftingRecipesByCategory = new Map<string, CraftingRecipeData[]>();

  // Loaded recipe manifests (set by DataManager)
  private cookingManifest: CookingManifest | null = null;
  private firemakingManifest: FiremakingManifest | null = null;
  private smeltingManifest: SmeltingManifest | null = null;
  private smithingManifest: SmithingManifest | null = null;
  private craftingManifest: CraftingManifest | null = null;

  // ============================================================================
  // PRE-ALLOCATED BUFFERS (Memory optimization - avoid allocation in hot paths)
  // ============================================================================

  /**
   * Pre-allocated Map for inventory counting operations.
   * Reused across getSmithableItemsFromInventory and getSmeltableBarsFromInventory
   * to avoid creating new Map instances on every call.
   */
  private readonly inventoryCountBuffer = new Map<string, number>();

  private constructor() {
    // Singleton
  }

  public static getInstance(): ProcessingDataProvider {
    if (!ProcessingDataProvider.instance) {
      ProcessingDataProvider.instance = new ProcessingDataProvider();
    }
    return ProcessingDataProvider.instance;
  }

  // ==========================================================================
  // RECIPE MANIFEST LOADING (called by DataManager)
  // ==========================================================================

  /**
   * Load cooking recipes from manifest
   */
  public loadCookingRecipes(manifest: CookingManifest): void {
    this.cookingManifest = manifest;
  }

  /**
   * Load firemaking recipes from manifest
   */
  public loadFiremakingRecipes(manifest: FiremakingManifest): void {
    this.firemakingManifest = manifest;
  }

  /**
   * Load smelting recipes from manifest
   */
  public loadSmeltingRecipes(manifest: SmeltingManifest): void {
    this.smeltingManifest = manifest;
  }

  /**
   * Load smithing recipes from manifest
   */
  public loadSmithingRecipes(manifest: SmithingManifest): void {
    this.smithingManifest = manifest;
  }

  /**
   * Load crafting recipes from manifest
   */
  public loadCraftingRecipes(manifest: CraftingManifest): void {
    this.craftingManifest = manifest;
  }

  /**
   * Check if recipe manifests are loaded
   */
  public hasRecipeManifests(): boolean {
    return !!(
      this.cookingManifest ||
      this.firemakingManifest ||
      this.smeltingManifest ||
      this.smithingManifest ||
      this.craftingManifest
    );
  }

  /**
   * Initialize the data provider by building lookup tables.
   * Uses recipe manifests if loaded, otherwise falls back to embedded item data.
   * Must be called AFTER DataManager.initialize() has loaded the manifests.
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Build from recipe manifests if available, else fall back to items
    if (this.cookingManifest) {
      this.buildCookingDataFromManifest();
    } else {
      this.buildCookingDataFromItems();
    }

    if (this.firemakingManifest) {
      this.buildFiremakingDataFromManifest();
    } else {
      this.buildFiremakingDataFromItems();
    }

    if (this.smeltingManifest) {
      this.buildSmeltingDataFromManifest();
    } else {
      this.buildSmeltingDataFromItems();
    }

    if (this.smithingManifest) {
      this.buildSmithingDataFromManifest();
    } else {
      this.buildSmithingDataFromItems();
    }

    if (this.craftingManifest) {
      this.buildCraftingDataFromManifest();
    }

    this.isInitialized = true;

    console.log(
      `[ProcessingDataProvider] Initialized: ${this.cookableItemIds.size} cookable items, ${this.burneableLogIds.size} burnable logs, ${this.smeltableBarIds.size} smeltable bars, ${this.smithableItemIds.size} smithable items, ${this.craftableItemIds.size} craftable items`,
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
    this.craftingRecipeMap.clear();
    this.craftableItemIds.clear();
    this.craftingRecipesByCategory.clear();
    this.isInitialized = false;
    this.initialize();
  }

  // ==========================================================================
  // BUILD FROM RECIPE MANIFESTS (Primary - uses recipe JSON files)
  // ==========================================================================

  /**
   * Build cooking lookup tables from recipes/cooking.json
   */
  private buildCookingDataFromManifest(): void {
    if (!this.cookingManifest) return;

    for (const recipe of this.cookingManifest.recipes) {
      const cookingData: CookingItemData = {
        rawItemId: recipe.raw,
        cookedItemId: recipe.cooked,
        burntItemId: recipe.burnt,
        levelRequired: recipe.level,
        xp: recipe.xp,
        stopBurnLevel: {
          fire: recipe.stopBurnLevel.fire,
          range: recipe.stopBurnLevel.range,
        },
      };
      this.cookingDataMap.set(recipe.raw, cookingData);
      this.cookableItemIds.add(recipe.raw);
    }
  }

  /**
   * Build firemaking lookup tables from recipes/firemaking.json
   */
  private buildFiremakingDataFromManifest(): void {
    if (!this.firemakingManifest) return;

    for (const recipe of this.firemakingManifest.recipes) {
      const firemakingData: FiremakingItemData = {
        logId: recipe.log,
        levelRequired: recipe.level,
        xp: recipe.xp,
      };
      this.firemakingDataMap.set(recipe.log, firemakingData);
      this.burneableLogIds.add(recipe.log);
    }
  }

  /**
   * Build smelting lookup tables from recipes/smelting.json
   */
  private buildSmeltingDataFromManifest(): void {
    if (!this.smeltingManifest) return;

    for (const recipe of this.smeltingManifest.recipes) {
      // Parse inputs to extract primary ore, secondary ore, and coal count
      let primaryOre = "";
      let secondaryOre: string | null = null;
      let coalRequired = 0;

      for (const input of recipe.inputs) {
        if (input.item === "coal") {
          coalRequired = input.amount;
        } else if (!primaryOre) {
          primaryOre = input.item;
        } else {
          secondaryOre = input.item;
        }
      }

      const smeltingData: SmeltingItemData = {
        barItemId: recipe.output,
        primaryOre,
        secondaryOre,
        coalRequired,
        levelRequired: recipe.level,
        xp: recipe.xp,
        successRate: recipe.successRate,
        ticks: recipe.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMELTING_TICKS,
      };
      this.smeltingDataMap.set(recipe.output, smeltingData);
      this.smeltableBarIds.add(recipe.output);
    }
  }

  /**
   * Build smithing lookup tables from recipes/smithing.json
   */
  private buildSmithingDataFromManifest(): void {
    if (!this.smithingManifest) return;

    for (const recipe of this.smithingManifest.recipes) {
      // Get item name from ITEMS map
      const item = ITEMS.get(recipe.output);
      const name = item?.name || recipe.output;

      const recipeData: SmithingRecipeData = {
        itemId: recipe.output,
        name,
        barType: recipe.bar,
        barsRequired: recipe.barsRequired,
        levelRequired: recipe.level,
        xp: recipe.xp,
        category: recipe.category as SmithingCategory,
        ticks: recipe.ticks ?? SMITHING_CONSTANTS.DEFAULT_SMITHING_TICKS,
      };

      // Add to main map (keyed by output item ID)
      this.smithingRecipeMap.set(recipe.output, recipeData);
      this.smithableItemIds.add(recipe.output);

      // Add to bar-grouped map for UI lookups
      const barRecipes = this.smithingRecipesByBar.get(recipe.bar) || [];
      barRecipes.push(recipeData);
      this.smithingRecipesByBar.set(recipe.bar, barRecipes);
    }
  }

  // ==========================================================================
  // BUILD FROM EMBEDDED ITEM DATA (Fallback - for backwards compatibility)
  // ==========================================================================

  /**
   * Scan ITEMS for items with `cooking` property (fallback)
   */
  private buildCookingDataFromItems(): void {
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
   * Scan ITEMS for items with `firemaking` property (fallback)
   */
  private buildFiremakingDataFromItems(): void {
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
   * Scan ITEMS for items with `smelting` property (fallback)
   */
  private buildSmeltingDataFromItems(): void {
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
   * Scan ITEMS for items with `smithing` property (fallback)
   */
  private buildSmithingDataFromItems(): void {
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
   * Build inventory item counts using pre-allocated buffer.
   * Clears and reuses the buffer to avoid allocations.
   *
   * @param inventory - Array of items with itemId and quantity
   * @returns Reference to the internal count buffer (do not store long-term)
   */
  private buildInventoryCounts(
    inventory: Array<{ itemId: string; quantity?: number }>,
  ): Map<string, number> {
    // Clear and reuse pre-allocated buffer
    this.inventoryCountBuffer.clear();

    for (const item of inventory) {
      const current = this.inventoryCountBuffer.get(item.itemId) || 0;
      this.inventoryCountBuffer.set(
        item.itemId,
        current + (item.quantity || 1),
      );
    }

    return this.inventoryCountBuffer;
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

    // Build inventory counts using pre-allocated buffer
    const itemCounts = this.buildInventoryCounts(inventory);

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
   * Returns recipes where player has required bars AND meets level requirement.
   *
   * @param inventory - Array of items with itemId and quantity
   * @param smithingLevel - Player's smithing level
   * @deprecated Use getSmithableItemsWithAvailability for UI display
   */
  public getSmithableItemsFromInventory(
    inventory: Array<{ itemId: string; quantity?: number }>,
    smithingLevel: number,
  ): SmithingRecipeData[] {
    this.ensureInitialized();

    // Build inventory counts using pre-allocated buffer
    const itemCounts = this.buildInventoryCounts(inventory);

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

  /**
   * Get all smithable items with availability info for UI display.
   * Returns ALL recipes for bar types the player has, with flags indicating:
   * - meetsLevel: whether player has sufficient smithing level
   * - hasBars: whether player has enough bars for this specific recipe
   *
   * Items that don't meet level requirements should be shown greyed out in UI.
   *
   * @param inventory - Array of items with itemId and quantity
   * @param smithingLevel - Player's smithing level
   */
  public getSmithableItemsWithAvailability(
    inventory: Array<{ itemId: string; quantity?: number }>,
    smithingLevel: number,
  ): SmithingRecipeWithAvailability[] {
    this.ensureInitialized();

    // Build inventory counts using pre-allocated buffer
    const itemCounts = this.buildInventoryCounts(inventory);

    // Find all bar types the player has at least 1 of
    const availableBarTypes = new Set<string>();
    for (const [itemId, count] of itemCounts) {
      if (count >= 1 && this.smithingRecipesByBar.has(itemId)) {
        availableBarTypes.add(itemId);
      }
    }

    const result: SmithingRecipeWithAvailability[] = [];

    // Get all recipes for available bar types
    for (const barType of availableBarTypes) {
      const recipes = this.smithingRecipesByBar.get(barType) || [];
      const barCount = itemCounts.get(barType) || 0;

      for (const recipe of recipes) {
        result.push({
          ...recipe,
          meetsLevel: smithingLevel >= recipe.levelRequired,
          hasBars: barCount >= recipe.barsRequired,
        });
      }
    }

    return result;
  }

  // ==========================================================================
  // BUILD CRAFTING DATA FROM MANIFEST
  // ==========================================================================

  /**
   * Build crafting lookup tables from recipes/crafting.json
   */
  private buildCraftingDataFromManifest(): void {
    if (!this.craftingManifest) return;

    for (const recipe of this.craftingManifest.recipes) {
      const item = ITEMS.get(recipe.output);
      const name = item?.name || recipe.output;

      const recipeData: CraftingRecipeData = {
        output: recipe.output,
        name,
        category: recipe.category,
        inputs: recipe.inputs,
        tools: recipe.tools,
        consumables: recipe.consumables || [],
        level: recipe.level,
        xp: recipe.xp,
        ticks: recipe.ticks,
        station: recipe.station,
      };

      this.craftingRecipeMap.set(recipe.output, recipeData);
      this.craftableItemIds.add(recipe.output);

      const categoryRecipes =
        this.craftingRecipesByCategory.get(recipe.category) || [];
      categoryRecipes.push(recipeData);
      this.craftingRecipesByCategory.set(recipe.category, categoryRecipes);
    }
  }

  // ==========================================================================
  // CRAFTING ACCESSORS
  // ==========================================================================

  /**
   * Check if an item is craftable
   */
  public isCraftableItem(itemId: string): boolean {
    this.ensureInitialized();
    return this.craftableItemIds.has(itemId);
  }

  /**
   * Get crafting recipe data for an output item
   */
  public getCraftingRecipe(outputItemId: string): CraftingRecipeData | null {
    this.ensureInitialized();
    return this.craftingRecipeMap.get(outputItemId) || null;
  }

  /**
   * Get all craftable item IDs
   */
  public getCraftableItemIds(): Set<string> {
    this.ensureInitialized();
    return this.craftableItemIds;
  }

  /**
   * Get all crafting recipes
   */
  public getAllCraftingRecipes(): CraftingRecipeData[] {
    this.ensureInitialized();
    return Array.from(this.craftingRecipeMap.values());
  }

  /**
   * Get crafting recipes for a specific category
   */
  public getCraftingRecipesByCategory(category: string): CraftingRecipeData[] {
    this.ensureInitialized();
    return this.craftingRecipesByCategory.get(category) || [];
  }

  /**
   * Get all crafting category names
   */
  public getCraftingCategories(): string[] {
    this.ensureInitialized();
    return Array.from(this.craftingRecipesByCategory.keys());
  }

  /**
   * Get crafting level requirement for an item
   */
  public getCraftingLevel(outputItemId: string): number {
    const recipe = this.getCraftingRecipe(outputItemId);
    return recipe?.level ?? 1;
  }

  /**
   * Get crafting XP for an item
   */
  public getCraftingXP(outputItemId: string): number {
    const recipe = this.getCraftingRecipe(outputItemId);
    return recipe?.xp ?? 0;
  }

  /**
   * Get crafting ticks for an item
   */
  public getCraftingTicks(outputItemId: string): number {
    const recipe = this.getCraftingRecipe(outputItemId);
    return recipe?.ticks ?? 3;
  }

  /**
   * Get all recipes the player can make with their crafting level
   */
  public getAvailableCraftingRecipes(
    craftingLevel: number,
  ): CraftingRecipeData[] {
    this.ensureInitialized();
    return Array.from(this.craftingRecipeMap.values()).filter(
      (recipe) => recipe.level <= craftingLevel,
    );
  }

  /**
   * Get crafting recipes that require a specific station
   */
  public getCraftingRecipesByStation(station: string): CraftingRecipeData[] {
    this.ensureInitialized();
    return Array.from(this.craftingRecipeMap.values()).filter(
      (recipe) => recipe.station === station,
    );
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
    craftingRecipes: number;
    isInitialized: boolean;
  } {
    this.ensureInitialized();
    return {
      cookableItems: this.cookableItemIds.size,
      burnableLogs: this.burneableLogIds.size,
      smeltableBars: this.smeltableBarIds.size,
      smithingRecipes: this.smithingRecipeMap.size,
      craftingRecipes: this.craftingRecipeMap.size,
      isInitialized: this.isInitialized,
    };
  }
}

// Export singleton instance
export const processingDataProvider = ProcessingDataProvider.getInstance();
