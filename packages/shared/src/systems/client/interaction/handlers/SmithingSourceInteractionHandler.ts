/**
 * SmithingSourceInteractionHandler
 *
 * Handles interactions with anvils for smithing bars into items.
 *
 * Actions:
 * - Smith (left-click primary, context menu) - opens smithing interface
 * - Walk here
 * - Examine
 *
 * Note: Player needs a hammer in inventory to smith.
 */

import { BaseInteractionHandler } from "./BaseInteractionHandler";
import type { RaycastTarget, ContextMenuAction } from "../types";
import { INTERACTION_RANGE } from "../constants";
import { EventType } from "../../../../types/events/event-types";

/**
 * Anvil entity interface for type safety
 */
interface AnvilEntity {
  entityType?: string;
  displayName?: string;
}

export class SmithingSourceInteractionHandler extends BaseInteractionHandler {
  /**
   * Left-click: Open smithing interface
   */
  onLeftClick(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    // Queue the smithing interaction (walk to anvil then smith)
    this.queueInteraction({
      target,
      actionId: "smith",
      range: this.getActionRange("smith"),
      onExecute: () => this.executeSmith(target),
    });
  }

  /**
   * Right-click: Show Smith action and other options
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];

    // Smith action (primary)
    actions.push({
      id: "smith",
      label: "Smith",
      enabled: true,
      priority: 1,
      handler: () => {
        this.queueInteraction({
          target,
          actionId: "smith",
          range: this.getActionRange("smith"),
          onExecute: () => this.executeSmith(target),
        });
      },
    });

    // Walk here
    actions.push(this.createWalkHereAction(target));

    // Examine
    actions.push(
      this.createExamineAction(
        target,
        "An anvil for smithing metal bars into weapons and tools.",
      ),
    );

    return actions.sort((a, b) => a.priority - b.priority);
  }

  getActionRange(_actionId: string): number {
    return INTERACTION_RANGE.RESOURCE; // 1 tile, like other interactables
  }

  // === Private Methods ===

  /**
   * Execute the smithing interaction.
   * Emits SMITHING_INTERACT event to open smithing interface.
   */
  private executeSmith(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    console.log(
      `[SmithingSourceInteraction] Player clicked anvil at ${target.position.x}, ${target.position.z}`,
    );

    // Emit SMITHING_INTERACT event to open smithing interface
    this.world.emit(EventType.SMITHING_INTERACT, {
      playerId: player.id,
      anvilId: target.entityId,
      position: target.position,
    });

    // Also send to server
    this.send("smithingSourceInteract", {
      anvilId: target.entityId,
      position: [target.position.x, target.position.y, target.position.z],
    });
  }
}
