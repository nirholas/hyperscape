/**
 * CookingSystem - Handles Cooking Skill
 *
 * OSRS-accurate cooking implementation:
 * - Use raw food on fire object
 * - Converts raw food to cooked food (or burnt)
 * - Grants cooking XP (only if not burnt)
 * - Auto-cooking continues until all items are cooked or fire goes out
 * - Burn chance decreases with level (per-food stop-burn level from manifest)
 * - Player squats during cooking animation
 *
 * @see https://oldschool.runescape.wiki/w/Cooking
 */

import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import { EventType } from "../../../types/events";
import { calculateDistance2D } from "../../../utils/game/EntityUtils";
import { ProcessingSystemBase } from "./ProcessingSystemBase";
import type { World } from "../../../types/index";
import type { ProcessingAction, Fire } from "../../../types/core/core";

export class CookingSystem extends ProcessingSystemBase {
  // Cooking-specific constants
  private readonly COOKING_TIME = 2000; // 2 seconds to cook

  constructor(world: World) {
    super(world, { name: "cooking" });
  }

  async init(): Promise<void> {
    await this.initBase();

    // Listen for cooking requests
    this.subscribe(
      EventType.PROCESSING_COOKING_REQUEST,
      (data: {
        playerId: string;
        fishSlot: number;
        fireId?: string;
        rangeId?: string;
        sourceType?: "fire" | "range";
      }) => {
        this.startCooking(data);
      },
    );

    // Handle legacy item-on-fire events
    this.subscribe(EventType.ITEM_USE_ON_FIRE, (_data) => {
      // Handled by targeting system now
      return;
    });
  }

  // =========================================================================
  // COOKING FLOW
  // =========================================================================

  private startCooking(data: {
    playerId: string;
    fishSlot: number;
    fireId?: string;
    rangeId?: string;
    sourceType?: "fire" | "range";
  }): void {
    const { playerId, fireId, rangeId, sourceType } = data;
    let { fishSlot } = data;

    // Determine cooking source ID
    const cookingSourceId = rangeId || fireId;
    const isRange = sourceType === "range" || !!rangeId;

    if (!cookingSourceId) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "No cooking source specified.",
        type: "error",
      });
      return;
    }

    // Handle fishSlot=-1: find first cookable item slot automatically
    if (fishSlot === -1) {
      fishSlot = this.findCookableSlot(playerId);
      if (fishSlot === -1) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "You have nothing to cook.",
          type: "error",
        });
        return;
      }
    }

    console.log("[CookingSystem] 🍳 startCooking called:", {
      playerId,
      fishSlot,
      sourceId: cookingSourceId,
      isRange,
    });

    // Check if player is already processing
    if (this.activeProcessing.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already doing something.",
        type: "error",
      });
      return;
    }

    // For ranges, they're permanent and always active
    // For fires, check if fire exists and is active
    if (!isRange) {
      const fire = this.activeFires.get(cookingSourceId);
      if (!fire || !fire.isActive) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "That fire is no longer lit.",
          type: "error",
        });
        return;
      }
    }

    this.startCookingProcess(
      playerId,
      fishSlot,
      cookingSourceId,
      true,
      isRange,
    );
  }

  /**
   * Start cooking a single item.
   * @param isFirstCook - If true, show "You begin cooking" message.
   * @param isRange - If true, cooking on a permanent range (always active).
   */
  private startCookingProcess(
    playerId: string,
    fishSlot: number,
    sourceId: string,
    isFirstCook: boolean = false,
    isRange: boolean = false,
  ): void {
    // Get the actual item ID from inventory
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      return;
    }

    const slotItem = inventory.find(
      (item: { slot?: number; itemId?: string }) => item?.slot === fishSlot,
    );

    if (!slotItem?.itemId) {
      return;
    }

    const rawItemId = String(slotItem.itemId);
    const cookingData = processingDataProvider.getCookingData(rawItemId);

    if (!cookingData) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You can't cook that.",
        type: "error",
      });
      return;
    }

    // Check level requirement
    let cookingLevel = 1;
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.cooking?.level) {
      cookingLevel = cachedSkills.cooking.level;
    } else {
      const player = this.world.getPlayer(playerId);
      const playerSkills = (
        player as { skills?: Record<string, { level: number }> }
      )?.skills;
      if (playerSkills?.cooking?.level) {
        cookingLevel = playerSkills.cooking.level;
      }
    }

    if (cookingLevel < cookingData.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${cookingData.levelRequired} Cooking to cook that.`,
        type: "error",
      });
      return;
    }

    // Create processing action from pool
    const processingAction = this.acquireAction();
    processingAction.playerId = playerId;
    processingAction.actionType = "cooking";
    processingAction.primaryItem = { id: rawItemId, slot: fishSlot };
    processingAction.targetFire = sourceId;
    processingAction.startTime = Date.now();
    processingAction.duration = this.COOKING_TIME;
    processingAction.xpReward = cookingData.xp;
    processingAction.skillRequired = "cooking";
    // Store whether this is a range (always active) vs fire (can go out)
    (processingAction as ProcessingAction & { isRange?: boolean }).isRange =
      isRange;

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message only on first cook (OSRS style)
    if (isFirstCook) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You begin cooking...",
        type: "info",
      });
    }

    // OSRS: Player squats for each cook attempt
    this.setProcessingEmote(playerId);

    // Complete after duration
    setTimeout(() => {
      // Verify player is still in activeProcessing (wasn't cancelled/disconnected)
      if (!this.activeProcessing.has(playerId)) {
        console.log(`[CookingSystem] Cooking was cancelled for ${playerId}`);
        return;
      }

      this.completeCooking(playerId, processingAction);
    }, this.COOKING_TIME);
  }

  private completeCooking(playerId: string, action: ProcessingAction): void {
    // Remove from active processing
    this.activeProcessing.delete(playerId);

    if (!action.targetFire) {
      console.error(
        `[CookingSystem] Cooking action missing targetFire for ${playerId}`,
      );
      this.releaseAction(action);
      return;
    }

    // Check if cooking source still exists
    // Ranges are always active, fires can go out
    const isRange = (action as ProcessingAction & { isRange?: boolean })
      .isRange;
    if (!isRange) {
      const fire = this.activeFires.get(action.targetFire);
      if (!fire || !fire.isActive) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "The fire goes out.",
          type: "error",
        });
        this.resetPlayerEmote(playerId);
        this.releaseAction(action);
        return;
      }
    }

    // Complete this cook
    this.completeCookingProcess(playerId, action);

    // Store sourceId and isRange before releasing action
    const sourceId = action.targetFire;
    const isRangeSource =
      (action as ProcessingAction & { isRange?: boolean }).isRange ?? false;

    // Release action back to pool
    this.releaseAction(action);

    // OSRS Auto-cooking: Check if player has more cookable items
    this.tryAutoCookNext(playerId, sourceId, isRangeSource);
  }

  private completeCookingProcess(
    playerId: string,
    action: ProcessingAction,
  ): void {
    const rawItemId = String(action.primaryItem.id);
    const cookingData = processingDataProvider.getCookingData(rawItemId);

    if (!cookingData) {
      console.error(`[CookingSystem] No cooking data found for ${rawItemId}`);
      return;
    }

    // Get cooking level
    let cookingLevel = 1;
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.cooking?.level) {
      cookingLevel = cachedSkills.cooking.level;
    } else {
      const player = this.world.getPlayer(playerId);
      const playerSkills = (
        player as { skills?: Record<string, { level: number }> }
      )?.skills;
      if (playerSkills?.cooking?.level) {
        cookingLevel = playerSkills.cooking.level;
      }
    }

    // Calculate burn chance using manifest data
    const burnChance = this.getBurnChance(
      cookingLevel,
      cookingData.levelRequired,
      cookingData.stopBurnLevel.fire,
    );
    const roll = Math.random();
    const didBurn = roll < burnChance;

    console.log("[CookingSystem] 🍳 completeCookingProcess:", {
      playerId,
      rawItemId,
      cookingLevel,
      burnChance: `${(burnChance * 100).toFixed(1)}%`,
      roll: roll.toFixed(3),
      didBurn,
    });

    // Remove raw item
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: rawItemId,
      quantity: 1,
      slot: action.primaryItem.slot,
    });

    // Add result item
    const resultItemId = didBurn
      ? cookingData.burntItemId
      : cookingData.cookedItemId;

    this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
      playerId,
      item: {
        id: `inv_${playerId}_${Date.now()}`,
        itemId: resultItemId,
        quantity: 1,
        slot: -1, // Let system find empty slot
        metadata: null,
      },
    });

    // Grant XP (only if not burnt)
    if (!didBurn) {
      this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
        playerId,
        skill: "cooking",
        amount: cookingData.xp,
      });
    }

    // Success/failure message (OSRS style)
    const foodName = rawItemId.replace("raw_", "");
    const message = didBurn
      ? `You accidentally burn the ${foodName}.`
      : `You roast a ${foodName}.`;
    const messageType = didBurn ? "warning" : "success";

    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message,
      type: messageType,
    });

    // Emit cooking completion event for quest tracking and observability
    this.emitTypedEvent(EventType.COOKING_COMPLETED, {
      playerId,
      resultItemId: resultItemId,
      wasBurnt: didBurn,
      // Legacy fields for backwards compatibility
      result: didBurn ? "burnt" : "cooked",
      itemCreated: resultItemId,
      xpGained: didBurn ? 0 : cookingData.xp,
    });
  }

  // =========================================================================
  // AUTO-COOKING
  // =========================================================================

  /**
   * Check if player has more cookable items and continue cooking.
   * @param isRange - If true, cooking on a permanent range (always active).
   */
  private tryAutoCookNext(
    playerId: string,
    sourceId: string,
    isRange: boolean = false,
  ): void {
    // Check if cooking source still active
    // Ranges are always active, fires can go out
    if (!isRange) {
      const fire = this.activeFires.get(sourceId);
      if (!fire || !fire.isActive) {
        this.resetPlayerEmote(playerId);
        return;
      }
    }

    // Check if player has more cookable items
    const nextSlot = this.findCookableSlot(playerId);
    if (nextSlot === -1) {
      // No more cookable items - cooking complete
      this.resetPlayerEmote(playerId);
      return;
    }

    // Continue cooking (not first cook, so no message)
    this.startCookingProcess(playerId, nextSlot, sourceId, false, isRange);
  }

  /**
   * Find the first slot containing any cookable item.
   */
  private findCookableSlot(playerId: string): number {
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      return -1;
    }

    for (let i = 0; i < inventory.length; i++) {
      const item = inventory[i] as { itemId?: string; slot?: number };
      if (
        item &&
        item.itemId &&
        processingDataProvider.isCookable(item.itemId)
      ) {
        return item.slot ?? i;
      }
    }

    return -1;
  }

  // =========================================================================
  // BURN CHANCE CALCULATION
  // =========================================================================

  /**
   * Calculate burn chance based on cooking level and food-specific parameters.
   * Uses OSRS-accurate linear interpolation.
   */
  private getBurnChance(
    cookingLevel: number,
    requiredLevel: number,
    stopBurnLevel: number,
    maxBurnChance: number = 0.5,
  ): number {
    // At or above stop level: never burn
    if (cookingLevel >= stopBurnLevel) {
      return 0;
    }

    // Below required level shouldn't happen, but treat as max burn chance
    if (cookingLevel < requiredLevel) {
      return maxBurnChance;
    }

    // Linear interpolation
    const levelRange = stopBurnLevel - requiredLevel;
    if (levelRange <= 0) {
      return 0;
    }

    const levelsUntilStopBurn = stopBurnLevel - cookingLevel;
    const burnChance = (levelsUntilStopBurn / levelRange) * maxBurnChance;

    return Math.max(0, Math.min(maxBurnChance, burnChance));
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Get fires within range of a position.
   */
  getFiresInRange(
    position: { x: number; y: number; z: number },
    range: number,
  ): Fire[] {
    return Array.from(this.activeFires.values()).filter((fire) => {
      if (!fire.isActive) return false;
      const distance = calculateDistance2D(fire.position, position);
      return distance <= range;
    });
  }
}
