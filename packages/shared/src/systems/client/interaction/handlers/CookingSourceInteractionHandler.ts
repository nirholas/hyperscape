/**
 * CookingSourceInteractionHandler
 *
 * Handles interactions with cooking sources (fires and ranges).
 *
 * Actions:
 * - Cook (left-click primary, context menu) - opens cooking interface
 * - Walk here
 * - Examine
 *
 * When player is in targeting mode with raw food, clicking a fire/range
 * will trigger the cooking request.
 */

import { BaseInteractionHandler } from "./BaseInteractionHandler";
import type { RaycastTarget, ContextMenuAction } from "../types";
import { INTERACTION_RANGE } from "../constants";
import { EventType } from "../../../../types/events/event-types";

/**
 * Cooking source entity interface for type safety
 */
interface CookingSourceEntity {
  entityType?: string;
  displayName?: string;
  burnReduction?: number;
  isActive?: boolean;
}

export class CookingSourceInteractionHandler extends BaseInteractionHandler {
  /**
   * Left-click: Open cooking interface or trigger cooking if in targeting mode
   */
  onLeftClick(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    // Check if fire is still active (fires expire)
    // For ProcessingSystem fires, target.entity is null, so use entityType from target
    const isFire = target.entityType === "fire";
    const entity = target.entity as unknown as CookingSourceEntity | null;
    const isActive = entity?.isActive !== false; // Default to true for ProcessingSystem fires

    if (isFire && !isActive) {
      this.showExamineMessage("The fire has gone out.");
      return;
    }

    // Queue the cooking interaction (walk to fire/range then cook)
    this.queueInteraction({
      target,
      actionId: "cook",
      range: this.getActionRange("cook"),
      onExecute: () => this.executeCook(target),
    });
  }

  /**
   * Right-click: Show Cook action and other options
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    // For ProcessingSystem fires, target.entity is null - use target.entityType instead
    const entity = target.entity as unknown as CookingSourceEntity | null;
    const sourceType = target.entityType === "range" ? "range" : "fire";
    const isActive = entity?.isActive !== false; // Default to true for ProcessingSystem fires

    // Cook action (primary)
    actions.push({
      id: "cook",
      label: "Cook",
      enabled: isActive,
      priority: 1,
      handler: () => {
        this.queueInteraction({
          target,
          actionId: "cook",
          range: this.getActionRange("cook"),
          onExecute: () => this.executeCook(target),
        });
      },
    });

    // Walk here
    actions.push(this.createWalkHereAction(target));

    // Examine
    const examineText = this.getExamineText(entity, sourceType, isActive);
    actions.push(this.createExamineAction(target, examineText));

    return actions.sort((a, b) => a.priority - b.priority);
  }

  getActionRange(_actionId: string): number {
    return INTERACTION_RANGE.RESOURCE; // 1 tile, like other interactables
  }

  // === Private Methods ===

  /**
   * Execute the cooking interaction.
   *
   * If player is in targeting mode with raw food, triggers cooking request.
   * Otherwise, opens the cooking interface for the player to select food.
   */
  private executeCook(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    // For ProcessingSystem fires, target.entity is null - use target.entityType instead
    const entity = target.entity as unknown as CookingSourceEntity | null;
    const sourceType = target.entityType === "range" ? "range" : "fire";
    const burnReduction = entity?.burnReduction ?? 0;

    console.log(
      `[CookingSourceInteraction] Player clicked ${sourceType} at ${target.position.x}, ${target.position.z}`,
    );

    // Emit COOKING_INTERACT event to open cooking interface
    // The ProcessingSystem or CookingUI will handle this
    this.world.emit(EventType.COOKING_INTERACT, {
      playerId: player.id,
      fireId: sourceType === "fire" ? target.entityId : undefined,
      rangeId: sourceType === "range" ? target.entityId : undefined,
      sourceType,
      position: target.position,
      burnReduction,
    });

    // Also send to server
    this.send("cookingSourceInteract", {
      sourceId: target.entityId,
      sourceType,
      position: [target.position.x, target.position.y, target.position.z],
    });
  }

  /**
   * Get examine text for the cooking source.
   */
  private getExamineText(
    entity: CookingSourceEntity | null,
    sourceType: "fire" | "range",
    isActive: boolean,
  ): string {
    if (sourceType === "fire") {
      if (!isActive) {
        return "The remains of a fire.";
      }
      return "A fire for cooking food.";
    }

    // Range
    const burnReduction = entity?.burnReduction ?? 0;
    if (burnReduction > 0) {
      return `A well-maintained range. Cooking here reduces burn chance by ${(burnReduction * 100).toFixed(0)}%.`;
    }
    return "A range for cooking food.";
  }
}
