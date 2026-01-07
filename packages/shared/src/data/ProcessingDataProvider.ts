/**
 * ProcessingDataProvider - Runtime Data from Item Manifest
 *
 * Builds cooking and firemaking lookup tables dynamically from the ITEMS map.
 * This is the proper data-driven approach where items.json is the source of truth.
 *
 * Usage:
 *   const provider = ProcessingDataProvider.getInstance();
 *   await provider.initialize(); // Called after DataManager loads manifests
 *   const cookingData = provider.getCookingData("raw_shrimp");
 *
 * @see packages/server/world/assets/manifests/items.json for source data
 */

import { ITEMS } from "./items";
import type { Item } from "../types/game/item-types";

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
 * Runtime data provider for cooking and firemaking systems.
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
   * Initialize the data provider by scanning ITEMS for cooking/firemaking data.
   * Must be called AFTER DataManager.initialize() has loaded the manifest.
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    this.buildCookingData();
    this.buildFiremakingData();
    this.isInitialized = true;

    console.log(
      `[ProcessingDataProvider] Initialized: ${this.cookableItemIds.size} cookable items, ${this.burneableLogIds.size} burnable logs`,
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
    isInitialized: boolean;
  } {
    return {
      cookableItems: this.cookableItemIds.size,
      burnableLogs: this.burneableLogIds.size,
      isInitialized: this.isInitialized,
    };
  }
}

// Export singleton instance
export const processingDataProvider = ProcessingDataProvider.getInstance();
