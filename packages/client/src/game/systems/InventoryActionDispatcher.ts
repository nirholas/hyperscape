/**
 * Centralized inventory action dispatching.
 * Eliminates duplication between context menu and left-click handlers.
 *
 * This dispatcher is the single source of truth for handling inventory actions.
 * Both context menu selections and left-click primary actions route through here.
 */

import { EventType, uuid, getItem } from "@hyperscape/shared";
import type { ClientWorld } from "../../types";

export interface InventoryActionContext {
  world: ClientWorld;
  itemId: string;
  slot: number;
  quantity?: number;
}

export interface ActionResult {
  success: boolean;
  message?: string;
}

/** Actions that are intentionally no-ops (don't warn) */
const SILENT_ACTIONS = new Set(["cancel"]);

/**
 * Dispatch an inventory action to the appropriate handler.
 * Single source of truth for action handling.
 *
 * @param action - The action ID (e.g., "eat", "wield", "drop")
 * @param ctx - Context containing world, itemId, slot, and optional quantity
 * @returns ActionResult indicating success/failure
 */
export function dispatchInventoryAction(
  action: string,
  ctx: InventoryActionContext,
): ActionResult {
  const { world, itemId, slot, quantity = 1 } = ctx;
  const localPlayer = world.getPlayer();

  if (!localPlayer) {
    return { success: false, message: "No local player" };
  }

  switch (action) {
    case "eat":
    case "drink":
      world.emit(EventType.ITEM_ACTION_SELECTED, {
        playerId: localPlayer.id,
        actionId: action,
        itemId,
        slot,
      });
      return { success: true };

    case "bury":
      world.network?.send("buryBones", { itemId, slot });
      return { success: true };

    case "wield":
    case "wear":
      world.network?.send("equipItem", {
        playerId: localPlayer.id,
        itemId,
        inventorySlot: slot,
      });
      return { success: true };

    case "drop":
      if (world.network?.dropItem) {
        world.network.dropItem(itemId, slot, quantity);
      } else {
        world.network?.send("dropItem", { itemId, slot, quantity });
      }
      return { success: true };

    case "examine": {
      const itemData = getItem(itemId);
      const examineText = itemData?.examine || `It's a ${itemId}.`;

      world.emit(EventType.UI_TOAST, {
        message: examineText,
        type: "info",
      });

      if (world.chat?.add) {
        world.chat.add({
          id: uuid(),
          from: "",
          body: examineText,
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
        });
      }
      return { success: true };
    }

    case "use":
      console.log(
        "[InventoryActionDispatcher] Use action - entering targeting mode:",
        {
          itemId,
          slot,
        },
      );
      world.emit(EventType.ITEM_ACTION_SELECTED, {
        playerId: localPlayer.id,
        actionId: "use",
        itemId,
        slot,
      });
      return { success: true };

    case "cancel":
      // Intentional no-op - menu already closed by EntityContextMenu
      return { success: true };

    default:
      // Only warn for truly unhandled actions, not intentional no-ops
      if (!SILENT_ACTIONS.has(action)) {
        console.warn(
          `[InventoryActionDispatcher] Unhandled action: "${action}" for item "${itemId}". ` +
            `Check inventoryActions in item manifest.`,
        );
      }
      return { success: false, message: `Unhandled action: ${action}` };
  }
}
