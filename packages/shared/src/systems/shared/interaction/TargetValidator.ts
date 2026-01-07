/**
 * Target Validator
 *
 * Validates item + target combinations for processing skills.
 * Determines valid targets for firemaking (tinderbox → logs)
 * and cooking (raw food → fire/range).
 */

import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import type { TargetType, SourceItem } from "./ItemTargetingSystem";

/**
 * Validation result for an item use action.
 */
export interface TargetValidationResult {
  /** Whether the item can be used on targets */
  canUse: boolean;
  /** Valid target types for this item */
  validTargetTypes: TargetType[];
  /** Valid target IDs (item IDs or entity IDs) */
  validTargetIds: Set<string>;
  /** Action type this will trigger */
  actionType: "firemaking" | "cooking" | "smelting" | "none";
  /** Error message if canUse is false */
  error?: string;
}

/**
 * Active fire registry interface.
 * Used to get current fire entity IDs.
 */
export interface FireRegistry {
  getActiveFireIds(): string[];
}

/**
 * Range registry interface.
 * Used to get current range entity IDs.
 */
export interface RangeRegistry {
  getRangeIds(): string[];
}

/**
 * Furnace registry interface.
 * Used to get current furnace entity IDs.
 */
export interface FurnaceRegistry {
  getFurnaceIds(): string[];
}

/**
 * Inventory interface for checking items.
 */
export interface InventoryChecker {
  /** Get all item IDs in player's inventory */
  getItemIds(playerId: string): string[];
  /** Check if player has item */
  hasItem(playerId: string, itemId: string): boolean;
}

/**
 * Target Validator
 *
 * Determines valid targets when player clicks "Use" on an item.
 */
export class TargetValidator {
  private fireRegistry: FireRegistry | null = null;
  private rangeRegistry: RangeRegistry | null = null;
  private furnaceRegistry: FurnaceRegistry | null = null;
  private inventoryChecker: InventoryChecker | null = null;

  /**
   * Set the fire registry for validating fire targets.
   */
  setFireRegistry(registry: FireRegistry): void {
    this.fireRegistry = registry;
  }

  /**
   * Set the range registry for validating range targets.
   */
  setRangeRegistry(registry: RangeRegistry): void {
    this.rangeRegistry = registry;
  }

  /**
   * Set the furnace registry for validating furnace targets.
   */
  setFurnaceRegistry(registry: FurnaceRegistry): void {
    this.furnaceRegistry = registry;
  }

  /**
   * Set the inventory checker for validating inventory targets.
   */
  setInventoryChecker(checker: InventoryChecker): void {
    this.inventoryChecker = checker;
  }

  /**
   * Validate what targets are valid for using an item.
   *
   * @param sourceItem - Item being used
   * @param playerId - Player using the item (for inventory checks)
   * @returns Validation result with valid targets
   */
  validateUse(
    sourceItem: SourceItem,
    playerId: string,
  ): TargetValidationResult {
    const itemId = sourceItem.id;

    // Check if tinderbox - targets logs in inventory
    if (itemId === "tinderbox") {
      return this.validateTinderboxUse(playerId);
    }

    // Check if raw food - targets fire/range in world
    if (processingDataProvider.isCookable(itemId)) {
      return this.validateRawFoodUse(itemId);
    }

    // Check if logs - can use tinderbox on logs too (reverse direction)
    if (processingDataProvider.isBurnableLog(itemId)) {
      return this.validateLogUse(playerId);
    }

    // Check if ore - targets furnace in world
    if (processingDataProvider.isSmeltableOre(itemId)) {
      return this.validateOreUse(itemId);
    }

    // No valid targets for this item
    return {
      canUse: false,
      validTargetTypes: [],
      validTargetIds: new Set(),
      actionType: "none",
      error: "Nothing interesting happens.",
    };
  }

  /**
   * Validate tinderbox use - targets logs in inventory.
   */
  private validateTinderboxUse(playerId: string): TargetValidationResult {
    const validIds = new Set<string>();

    // Find all logs in player's inventory
    if (this.inventoryChecker) {
      const inventoryItems = this.inventoryChecker.getItemIds(playerId);
      for (const itemId of inventoryItems) {
        if (processingDataProvider.isBurnableLog(itemId)) {
          validIds.add(itemId);
        }
      }
    } else {
      // Fallback: all log types are potentially valid
      for (const logId of processingDataProvider.getBurnableLogIds()) {
        validIds.add(logId);
      }
    }

    if (validIds.size === 0) {
      return {
        canUse: false,
        validTargetTypes: [],
        validTargetIds: new Set(),
        actionType: "none",
        error: "You need some logs to light.",
      };
    }

    return {
      canUse: true,
      validTargetTypes: ["inventory_item"],
      validTargetIds: validIds,
      actionType: "firemaking",
    };
  }

  /**
   * Validate log use - targets tinderbox in inventory.
   */
  private validateLogUse(playerId: string): TargetValidationResult {
    const validIds = new Set<string>();

    // Check if player has tinderbox
    if (this.inventoryChecker) {
      if (this.inventoryChecker.hasItem(playerId, "tinderbox")) {
        validIds.add("tinderbox");
      }
    } else {
      // Fallback: tinderbox is potentially valid
      validIds.add("tinderbox");
    }

    if (validIds.size === 0) {
      return {
        canUse: false,
        validTargetTypes: [],
        validTargetIds: new Set(),
        actionType: "none",
        error: "You need a tinderbox to light logs.",
      };
    }

    return {
      canUse: true,
      validTargetTypes: ["inventory_item"],
      validTargetIds: validIds,
      actionType: "firemaking",
    };
  }

  /**
   * Validate raw food use - targets fire/range in world.
   */
  private validateRawFoodUse(_rawFoodId: string): TargetValidationResult {
    const validIds = new Set<string>();

    // Get active fires
    if (this.fireRegistry) {
      const fireIds = this.fireRegistry.getActiveFireIds();
      for (const fireId of fireIds) {
        validIds.add(fireId);
      }
    }

    // Get ranges
    if (this.rangeRegistry) {
      const rangeIds = this.rangeRegistry.getRangeIds();
      for (const rangeId of rangeIds) {
        validIds.add(rangeId);
      }
    }

    if (validIds.size === 0) {
      return {
        canUse: false,
        validTargetTypes: [],
        validTargetIds: new Set(),
        actionType: "none",
        error: "You need a fire or range to cook on.",
      };
    }

    return {
      canUse: true,
      validTargetTypes: ["world_entity"],
      validTargetIds: validIds,
      actionType: "cooking",
    };
  }

  /**
   * Validate ore use - targets furnace in world.
   */
  private validateOreUse(_oreId: string): TargetValidationResult {
    const validIds = new Set<string>();

    // Get furnaces
    if (this.furnaceRegistry) {
      const furnaceIds = this.furnaceRegistry.getFurnaceIds();
      for (const furnaceId of furnaceIds) {
        validIds.add(furnaceId);
      }
    }

    // Even without registry, allow furnace_ prefix entities
    // This is a fallback for when registry isn't set up
    if (validIds.size === 0) {
      // Always allow targeting furnaces (they'll be validated by ID pattern)
      return {
        canUse: true,
        validTargetTypes: ["world_entity"],
        validTargetIds: new Set(["furnace_spawn_1"]), // Known furnace ID
        actionType: "smelting",
      };
    }

    return {
      canUse: true,
      validTargetTypes: ["world_entity"],
      validTargetIds: validIds,
      actionType: "smelting",
    };
  }

  /**
   * Check if a specific target is valid for a source item.
   *
   * @param sourceItemId - Source item ID
   * @param targetId - Target item/entity ID
   * @returns True if target is valid
   */
  isValidTarget(sourceItemId: string, targetId: string): boolean {
    // Tinderbox → logs
    if (sourceItemId === "tinderbox") {
      return processingDataProvider.isBurnableLog(targetId);
    }

    // Logs → tinderbox
    if (processingDataProvider.isBurnableLog(sourceItemId)) {
      return targetId === "tinderbox";
    }

    // Raw food → fire/range
    if (processingDataProvider.isCookable(sourceItemId)) {
      // Check if it's a fire or range ID
      // Fire IDs start with "fire_", range IDs vary
      return (
        targetId.startsWith("fire_") ||
        targetId.includes("range") ||
        // Also accept direct entity type check
        this.isFireOrRangeEntity(targetId)
      );
    }

    // Ore → furnace
    if (processingDataProvider.isSmeltableOre(sourceItemId)) {
      return (
        targetId.startsWith("furnace_") ||
        targetId.includes("furnace") ||
        this.isFurnaceEntity(targetId)
      );
    }

    return false;
  }

  /**
   * Check if an entity ID is a furnace.
   */
  private isFurnaceEntity(entityId: string): boolean {
    if (this.furnaceRegistry) {
      const furnaceIds = this.furnaceRegistry.getFurnaceIds();
      if (furnaceIds.includes(entityId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if an entity ID is a fire or range.
   */
  private isFireOrRangeEntity(entityId: string): boolean {
    if (this.fireRegistry) {
      const fireIds = this.fireRegistry.getActiveFireIds();
      if (fireIds.includes(entityId)) {
        return true;
      }
    }

    if (this.rangeRegistry) {
      const rangeIds = this.rangeRegistry.getRangeIds();
      if (rangeIds.includes(entityId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the action type for a source item.
   *
   * @param sourceItemId - Source item ID
   * @returns Action type or "none"
   */
  getActionType(
    sourceItemId: string,
  ): "firemaking" | "cooking" | "smelting" | "none" {
    if (sourceItemId === "tinderbox") {
      return "firemaking";
    }

    if (processingDataProvider.isBurnableLog(sourceItemId)) {
      return "firemaking";
    }

    if (processingDataProvider.isCookable(sourceItemId)) {
      return "cooking";
    }

    if (processingDataProvider.isSmeltableOre(sourceItemId)) {
      return "smelting";
    }

    return "none";
  }
}

/**
 * Singleton instance for convenience.
 */
let _targetValidatorInstance: TargetValidator | null = null;

/**
 * Get or create the target validator singleton.
 */
export function getTargetValidator(): TargetValidator {
  if (!_targetValidatorInstance) {
    _targetValidatorInstance = new TargetValidator();
  }
  return _targetValidatorInstance;
}

/**
 * Reset the target validator singleton (for testing).
 */
export function resetTargetValidator(): void {
  _targetValidatorInstance = null;
}
