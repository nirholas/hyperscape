/**
 * Item Targeting System
 *
 * State machine for "Use [item] on [target]" interactions.
 * Enables firemaking (tinderbox → logs) and cooking (raw food → fire/range).
 *
 * Flow:
 * 1. Player clicks "Use" on item in inventory
 * 2. System enters SELECTING_TARGET state
 * 3. Valid targets are highlighted (inventory items or world entities)
 * 4. Player clicks valid target
 * 5. System executes callback and returns to IDLE
 *
 * Cancellation:
 * - ESC key
 * - Right-click
 * - Movement
 * - Clicking invalid target
 */

import { EventType } from "../../../types/events";
import type { World } from "../../../types/index";
import { SystemBase } from "../infrastructure/SystemBase";

/**
 * Targeting state machine states.
 */
export type TargetingState = "idle" | "selecting_target" | "executing";

/**
 * Type of target that can be selected.
 */
export type TargetType = "inventory_item" | "world_entity" | "ground_tile";

/**
 * Information about a selected target.
 */
export interface TargetInfo {
  type: TargetType;
  /** Entity ID (for world entities) or item ID (for inventory items) */
  id: string;
  /** Inventory slot (for inventory items) */
  slot?: number;
  /** World position (for world entities and ground tiles) */
  position?: { x: number; y: number; z: number };
  /** Entity type (for world entities) */
  entityType?: string;
}

/**
 * Source item information.
 */
export interface SourceItem {
  id: string;
  slot: number;
  name?: string;
}

/**
 * Targeting context - current state of the targeting system.
 */
export interface TargetingContext {
  state: TargetingState;
  sourceItem: SourceItem | null;
  validTargetTypes: TargetType[];
  validTargetIds: Set<string>;
  onTargetSelected: ((target: TargetInfo) => void) | null;
  startedAt: number;
}

/**
 * Options for starting targeting mode.
 */
export interface StartTargetingOptions {
  sourceItem: SourceItem;
  validTargetTypes: TargetType[];
  validTargetIds: Set<string>;
  onTargetSelected: (target: TargetInfo) => void;
}

/**
 * Click information for target selection.
 */
export interface TargetClickInfo {
  /** Type of target clicked */
  targetType: TargetType;
  /** Target ID (entity ID or item ID) */
  targetId: string;
  /** Inventory slot if clicking inventory item */
  slot?: number;
  /** World position if clicking world entity or ground */
  position?: { x: number; y: number; z: number };
  /** Entity type if clicking world entity */
  entityType?: string;
}

/**
 * Item Targeting System
 *
 * Manages the "Use X on Y" targeting state machine.
 * Coordinates with InventoryInteractionSystem and world entity interactions.
 */
export class ItemTargetingSystem extends SystemBase {
  private context: TargetingContext = {
    state: "idle",
    sourceItem: null,
    validTargetTypes: [],
    validTargetIds: new Set(),
    onTargetSelected: null,
    startedAt: 0,
  };

  /** Timeout for auto-cancel (30 seconds) */
  private static readonly TARGETING_TIMEOUT_MS = 30000;

  constructor(world: World) {
    super(world, {
      name: "item-targeting",
      dependencies: {
        required: [],
        optional: ["inventory-interaction"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Listen for ESC key to cancel targeting
    this.subscribe(EventType.INPUT_KEY_DOWN, (data: { key: string }) => {
      if (data.key === "Escape" && this.isTargeting()) {
        this.cancelTargeting("escape_pressed");
      }
    });

    // Listen for right-click to cancel targeting
    this.subscribe(
      EventType.ITEM_RIGHT_CLICK,
      (_data: { itemId: string; slot: number }) => {
        if (this.isTargeting()) {
          this.cancelTargeting("right_click");
        }
      },
    );

    // Listen for movement to cancel targeting
    this.subscribe(
      EventType.MOVEMENT_CLICK_TO_MOVE,
      (_data: { playerId: string }) => {
        if (this.isTargeting()) {
          this.cancelTargeting("movement");
        }
      },
    );
  }

  async start(): Promise<void> {
    // Periodic check for targeting timeout
    this.createInterval(() => {
      if (this.isTargeting()) {
        const elapsed = Date.now() - this.context.startedAt;
        if (elapsed > ItemTargetingSystem.TARGETING_TIMEOUT_MS) {
          this.cancelTargeting("timeout");
        }
      }
    }, 5000);
  }

  /**
   * Enter targeting mode when player clicks "Use" on an item.
   *
   * @param options - Targeting configuration
   */
  startTargeting(options: StartTargetingOptions): void {
    // Cancel any existing targeting
    if (this.isTargeting()) {
      this.cancelTargeting("started_new");
    }

    this.context = {
      state: "selecting_target",
      sourceItem: options.sourceItem,
      validTargetTypes: options.validTargetTypes,
      validTargetIds: new Set(options.validTargetIds),
      onTargetSelected: options.onTargetSelected,
      startedAt: Date.now(),
    };

    // Emit event for UI to show targeting cursor and highlights
    this.emitTypedEvent(EventType.TARGETING_START, {
      sourceItem: options.sourceItem,
      validTargetTypes: options.validTargetTypes,
      validTargetIds: Array.from(options.validTargetIds),
    });

    console.log(
      `[ItemTargeting] Started targeting with ${options.sourceItem.id}, ` +
        `valid targets: ${options.validTargetIds.size}`,
    );
  }

  /**
   * Handle a click during targeting mode.
   * Validates the target and executes callback if valid.
   *
   * @param clickInfo - Information about what was clicked
   * @returns True if target was valid and callback executed
   */
  handleClick(clickInfo: TargetClickInfo): boolean {
    if (!this.isTargeting()) {
      return false;
    }

    // Validate target type
    if (!this.context.validTargetTypes.includes(clickInfo.targetType)) {
      console.log(
        `[ItemTargeting] Invalid target type: ${clickInfo.targetType}`,
      );
      return false;
    }

    // Validate target ID
    if (!this.context.validTargetIds.has(clickInfo.targetId)) {
      console.log(`[ItemTargeting] Invalid target ID: ${clickInfo.targetId}`);
      return false;
    }

    // Target is valid - execute callback
    this.context.state = "executing";

    const targetInfo: TargetInfo = {
      type: clickInfo.targetType,
      id: clickInfo.targetId,
      slot: clickInfo.slot,
      position: clickInfo.position,
      entityType: clickInfo.entityType,
    };

    // Store callback reference before clearing context
    const callback = this.context.onTargetSelected;

    // Clear targeting state
    this.clearTargeting();

    // Emit completion event
    this.emitTypedEvent(EventType.TARGETING_COMPLETE, {
      sourceItem: this.context.sourceItem,
      target: targetInfo,
    });

    // Execute callback
    if (callback) {
      try {
        callback(targetInfo);
      } catch (error) {
        console.error("[ItemTargeting] Callback error:", error);
      }
    }

    console.log(
      `[ItemTargeting] Target selected: ${clickInfo.targetType} - ${clickInfo.targetId}`,
    );
    return true;
  }

  /**
   * Handle inventory item click during targeting mode.
   * Convenience method for inventory slot clicks.
   *
   * @param itemId - Item ID that was clicked
   * @param slot - Inventory slot number
   * @returns True if target was valid
   */
  handleInventoryClick(itemId: string, slot: number): boolean {
    return this.handleClick({
      targetType: "inventory_item",
      targetId: itemId,
      slot,
    });
  }

  /**
   * Handle world entity click during targeting mode.
   * Convenience method for world entity clicks.
   *
   * @param entityId - Entity ID that was clicked
   * @param entityType - Type of entity (fire, range, etc.)
   * @param position - Entity position
   * @returns True if target was valid
   */
  handleEntityClick(
    entityId: string,
    entityType: string,
    position: { x: number; y: number; z: number },
  ): boolean {
    return this.handleClick({
      targetType: "world_entity",
      targetId: entityId,
      position,
      entityType,
    });
  }

  /**
   * Cancel targeting mode.
   *
   * @param reason - Reason for cancellation
   */
  cancelTargeting(reason: string = "cancelled"): void {
    if (!this.isTargeting()) {
      return;
    }

    console.log(`[ItemTargeting] Cancelled: ${reason}`);

    // Emit cancel event for UI
    this.emitTypedEvent(EventType.TARGETING_CANCEL, {
      sourceItem: this.context.sourceItem,
      reason,
    });

    this.clearTargeting();
  }

  /**
   * Check if a target would be valid for current targeting context.
   * Used by UI for highlighting valid targets.
   *
   * @param targetInfo - Target to check
   * @returns True if target is valid
   */
  isValidTarget(targetInfo: { type: TargetType; id: string }): boolean {
    if (!this.isTargeting()) {
      return false;
    }

    return (
      this.context.validTargetTypes.includes(targetInfo.type) &&
      this.context.validTargetIds.has(targetInfo.id)
    );
  }

  /**
   * Check if targeting mode is active.
   */
  isTargeting(): boolean {
    return this.context.state === "selecting_target";
  }

  /**
   * Get current targeting state.
   */
  getState(): TargetingState {
    return this.context.state;
  }

  /**
   * Get source item if targeting.
   */
  getSourceItem(): SourceItem | null {
    return this.context.sourceItem;
  }

  /**
   * Get valid target IDs (for UI highlighting).
   */
  getValidTargetIds(): Set<string> {
    return new Set(this.context.validTargetIds);
  }

  /**
   * Get valid target types.
   */
  getValidTargetTypes(): TargetType[] {
    return [...this.context.validTargetTypes];
  }

  /**
   * Clear targeting state.
   */
  private clearTargeting(): void {
    this.context = {
      state: "idle",
      sourceItem: null,
      validTargetTypes: [],
      validTargetIds: new Set(),
      onTargetSelected: null,
      startedAt: 0,
    };
  }
}
