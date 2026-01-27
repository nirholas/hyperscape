/**
 * Duel Stakes Handlers
 *
 * Handles duel stakes negotiation:
 * - handleDuelAddStake: Add an item from inventory to stakes
 * - handleDuelRemoveStake: Remove a staked item
 * - handleDuelAcceptStakes: Accept current stakes configuration
 */

import { type World, getItem, isValidSlotNumber } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import { InventoryRepository } from "../../../../database/repositories/InventoryRepository";
import type { DatabaseConnection } from "../trade/types";
import {
  getDuelSystem,
  sendDuelError,
  sendToSocket,
  getPlayerId,
  getSocketByPlayerId,
} from "./helpers";

// ============================================================================
// Add Stake Handler
// ============================================================================

/**
 * Handle adding an item to stakes
 */
export async function handleDuelAddStake(
  socket: ServerSocket,
  data: { duelId: string; inventorySlot: number; quantity: number },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const duelSystem = getDuelSystem(world);
  if (!duelSystem) {
    sendDuelError(socket, "Duel system unavailable", "SYSTEM_ERROR");
    return;
  }

  const { duelId, inventorySlot, quantity } = data;

  // Validate slot
  if (
    !isValidSlotNumber(inventorySlot) ||
    inventorySlot < 0 ||
    inventorySlot > 27
  ) {
    sendDuelError(socket, "Invalid inventory slot", "INVALID_SLOT");
    return;
  }

  // Get item from database inventory (same pattern as trade system)
  const inventoryRepo = new InventoryRepository(db.drizzle, db.pool);
  const inventoryItems = await inventoryRepo.getPlayerInventoryAsync(playerId);
  const inventoryItem = inventoryItems.find(
    (item) => item.slotIndex === inventorySlot,
  );

  if (!inventoryItem) {
    sendDuelError(socket, "No item in that slot", "ITEM_NOT_FOUND");
    return;
  }

  // Validate item exists in item database
  const itemData = getItem(inventoryItem.itemId);
  if (!itemData) {
    sendDuelError(socket, "Invalid item", "INVALID_ITEM");
    return;
  }

  // Check if item is tradeable (stakeable items must be tradeable)
  if (itemData.tradeable === false) {
    sendDuelError(socket, "This item cannot be staked", "ITEM_NOT_TRADEABLE");
    return;
  }

  // Determine quantity (for stackable items, use provided quantity or all)
  let qty = quantity;
  if (qty <= 0 || qty > inventoryItem.quantity) {
    qty = inventoryItem.quantity;
  }

  // Calculate value
  const value = (itemData.value || 0) * qty;

  // Add to stakes
  const result = duelSystem.addStake(
    duelId,
    playerId,
    inventorySlot,
    inventoryItem.itemId,
    qty,
    value,
  );

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Remove item from inventory (OSRS-accurate: staked items leave inventory)
  try {
    if (qty >= inventoryItem.quantity) {
      // Remove entire item
      await db.pool.query(
        `DELETE FROM inventory WHERE "playerId" = $1 AND "slotIndex" = $2`,
        [playerId, inventorySlot],
      );
    } else {
      // Reduce quantity
      await db.pool.query(
        `UPDATE inventory SET quantity = quantity - $1 WHERE "playerId" = $2 AND "slotIndex" = $3`,
        [qty, playerId, inventorySlot],
      );
    }

    // Reload inventory and sync to client
    const inventorySystem = world.getSystem("inventory") as
      | { reloadFromDatabase?: (id: string) => Promise<void> }
      | undefined;
    if (inventorySystem?.reloadFromDatabase) {
      await inventorySystem.reloadFromDatabase(playerId);
    }
  } catch (error) {
    console.error(`[Duel] Failed to remove staked item from inventory:`, error);
    // Don't fail the stake operation - item is already in stakes
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Notify both players of the stake change
  const updatePayload = {
    duelId,
    challengerStakes: session.challengerStakes,
    targetStakes: session.targetStakes,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    modifiedBy: playerId,
  };

  sendToSocket(socket, "duelStakesUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelStakesUpdated", updatePayload);
  }
}

// ============================================================================
// Remove Stake Handler
// ============================================================================

/**
 * Handle removing a staked item
 */
export async function handleDuelRemoveStake(
  socket: ServerSocket,
  data: { duelId: string; stakeIndex: number },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const duelSystem = getDuelSystem(world);
  if (!duelSystem) {
    sendDuelError(socket, "Duel system unavailable", "SYSTEM_ERROR");
    return;
  }

  const { duelId, stakeIndex } = data;

  // Get session to find the stake data BEFORE removal
  const session = duelSystem.getDuelSession(duelId);
  if (!session) {
    sendDuelError(socket, "Duel not found", "DUEL_NOT_FOUND");
    return;
  }

  // Get the stake that's about to be removed
  const isChallenger = playerId === session.challengerId;
  const stakes = isChallenger ? session.challengerStakes : session.targetStakes;

  if (stakeIndex < 0 || stakeIndex >= stakes.length) {
    sendDuelError(socket, "Invalid stake index", "INVALID_INDEX");
    return;
  }

  const removedStake = stakes[stakeIndex];

  const result = duelSystem.removeStake(duelId, playerId, stakeIndex);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Return item to inventory
  try {
    // Find a free slot
    const inventoryRepo = new InventoryRepository(db.drizzle, db.pool);
    const currentInventory =
      await inventoryRepo.getPlayerInventoryAsync(playerId);
    const usedSlots = new Set(currentInventory.map((item) => item.slotIndex));

    // Check if same item exists and is stackable
    const existingItem = currentInventory.find(
      (item) => item.itemId === removedStake.itemId,
    );
    const itemData = getItem(removedStake.itemId);
    const isStackable = itemData?.stackable ?? false;

    if (isStackable && existingItem) {
      // Add to existing stack
      await db.pool.query(
        `UPDATE inventory SET quantity = quantity + $1 WHERE "playerId" = $2 AND "slotIndex" = $3`,
        [removedStake.quantity, playerId, existingItem.slotIndex],
      );
    } else {
      // Find free slot
      let freeSlot = -1;
      for (let i = 0; i < 28; i++) {
        if (!usedSlots.has(i)) {
          freeSlot = i;
          break;
        }
      }

      if (freeSlot === -1) {
        // No space - this shouldn't happen since item came from inventory
        console.warn(
          `[Duel] No free slot for returned stake ${removedStake.itemId} for ${playerId}`,
        );
      } else {
        // Insert into free slot
        await db.pool.query(
          `INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
           VALUES ($1, $2, $3, $4, NULL)`,
          [playerId, removedStake.itemId, removedStake.quantity, freeSlot],
        );
      }
    }

    // Reload inventory and sync to client
    const inventorySystem = world.getSystem("inventory") as
      | { reloadFromDatabase?: (id: string) => Promise<void> }
      | undefined;
    if (inventorySystem?.reloadFromDatabase) {
      await inventorySystem.reloadFromDatabase(playerId);
    }
  } catch (error) {
    console.error(`[Duel] Failed to return unstaked item to inventory:`, error);
  }

  // Notify both players of the stake change
  const updatePayload = {
    duelId,
    challengerStakes: session.challengerStakes,
    targetStakes: session.targetStakes,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    modifiedBy: playerId,
  };

  sendToSocket(socket, "duelStakesUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelStakesUpdated", updatePayload);
  }
}

// ============================================================================
// Accept Stakes Handler
// ============================================================================

/**
 * Handle accepting current stakes configuration
 */
export function handleDuelAcceptStakes(
  socket: ServerSocket,
  data: { duelId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const duelSystem = getDuelSystem(world);
  if (!duelSystem) {
    sendDuelError(socket, "Duel system unavailable", "SYSTEM_ERROR");
    return;
  }

  const { duelId } = data;

  const result = duelSystem.acceptStakes(duelId, playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Check if both players accepted and we moved to CONFIRMING
  const movedToConfirm = session.state === "CONFIRMING";

  // Notify both players
  const updatePayload = {
    duelId,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    state: session.state,
    movedToConfirm,
  };

  sendToSocket(socket, "duelAcceptanceUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelAcceptanceUpdated", updatePayload);
  }

  // If moved to confirm screen, send state change notification
  if (movedToConfirm) {
    const statePayload = {
      duelId,
      state: "CONFIRMING",
      rules: session.rules,
      equipmentRestrictions: session.equipmentRestrictions,
      challengerStakes: session.challengerStakes,
      targetStakes: session.targetStakes,
    };

    sendToSocket(socket, "duelStateChanged", statePayload);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelStateChanged", statePayload);
    }
  }
}
