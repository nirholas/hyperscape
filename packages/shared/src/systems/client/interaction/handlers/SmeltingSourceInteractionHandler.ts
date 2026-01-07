/**
 * SmeltingSourceInteractionHandler
 *
 * Handles interactions with furnaces for smelting ores into bars.
 *
 * Actions:
 * - Smelt (left-click primary, context menu) - opens smelting interface
 * - Walk here
 * - Examine
 */

import { BaseInteractionHandler } from "./BaseInteractionHandler";
import type { RaycastTarget, ContextMenuAction } from "../types";
import { INTERACTION_RANGE } from "../constants";
import { EventType } from "../../../../types/events/event-types";

/**
 * Furnace entity interface for type safety
 */
interface FurnaceEntity {
  entityType?: string;
  displayName?: string;
}

export class SmeltingSourceInteractionHandler extends BaseInteractionHandler {
  /**
   * Left-click: Open smelting interface
   */
  onLeftClick(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    // Queue the smelting interaction (walk to furnace then smelt)
    this.queueInteraction({
      target,
      actionId: "smelt",
      range: this.getActionRange("smelt"),
      onExecute: () => this.executeSmelt(target),
    });
  }

  /**
   * Right-click: Show Smelt action and other options
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];

    // Smelt action (primary)
    actions.push({
      id: "smelt",
      label: "Smelt",
      enabled: true,
      priority: 1,
      handler: () => {
        this.queueInteraction({
          target,
          actionId: "smelt",
          range: this.getActionRange("smelt"),
          onExecute: () => this.executeSmelt(target),
        });
      },
    });

    // Walk here
    actions.push(this.createWalkHereAction(target));

    // Examine
    actions.push(
      this.createExamineAction(
        target,
        "A furnace for smelting ores into metal bars.",
      ),
    );

    return actions.sort((a, b) => a.priority - b.priority);
  }

  getActionRange(_actionId: string): number {
    return INTERACTION_RANGE.RESOURCE; // 1 tile, like other interactables
  }

  // === Private Methods ===

  /**
   * Execute the smelting interaction.
   * Emits SMELTING_INTERACT event to open smelting interface.
   */
  private executeSmelt(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    console.log(
      `[SmeltingSourceInteraction] Player clicked furnace at ${target.position.x}, ${target.position.z}`,
    );

    // Emit SMELTING_INTERACT event to open smelting interface
    this.world.emit(EventType.SMELTING_INTERACT, {
      playerId: player.id,
      furnaceId: target.entityId,
      position: target.position,
    });

    // Also send to server
    this.send("smeltingSourceInteract", {
      furnaceId: target.entityId,
      position: [target.position.x, target.position.y, target.position.z],
    });
  }
}
