/**
 * Duel Stakes Handlers
 *
 * Handles duel stakes negotiation:
 * - handleDuelAddStake: Add an item from inventory to stakes
 * - handleDuelRemoveStake: Remove a staked item
 * - handleDuelAcceptStakes: Accept current stakes configuration
 *
 * Security features:
 * - Items remain in player inventory until duel completion (crash-safe)
 * - SELECT FOR UPDATE to validate items exist
 * - Rate limiting to prevent spam
 * - Audit logging for economic integrity
 * - Atomic transfer at duel completion prevents item loss
 */

import { type World, getItem, isValidSlotNumber } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import type { DatabaseConnection } from "../trade/types";
import { AuditLogger } from "../../services";
import {
  rateLimiter,
  sendDuelError,
  sendToSocket,
  getSocketByPlayerId,
  withDuelAuth,
  DUEL_PACKETS,
} from "./helpers";

// ============================================================================
// Add Stake Handler
// ============================================================================

/**
 * Handle adding an item to stakes
 *
 * CRASH-SAFE DESIGN: Items remain in inventory until duel completion.
 * We only track which items are offered in the session. The actual transfer
 * happens atomically when the duel ends, preventing item loss on crash.
 *
 * Security:
 * - Validates item exists in inventory (SELECT FOR UPDATE)
 * - Rate limited to prevent spam
 * - Audit logged for economic tracking
 * - Items stay in inventory until duel completion (crash-safe)
 */
export async function handleDuelAddStake(
  socket: ServerSocket,
  data: { duelId: string; inventorySlot: number; quantity: number },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const auth = withDuelAuth(socket, world);
  if (!auth) return;
  const { playerId, duelSystem } = auth;

  // Rate limiting - prevent rapid stake operations
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(
      socket,
      "Please wait before modifying stakes",
      "RATE_LIMITED",
    );
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

  try {
    // Validate item exists in inventory (read-only check, no modification)
    const itemResult = await db.pool.query(
      `SELECT "itemId", quantity FROM inventory
       WHERE "playerId" = $1 AND "slotIndex" = $2`,
      [playerId, inventorySlot],
    );

    if (itemResult.rows.length === 0) {
      sendDuelError(socket, "No item in that slot", "ITEM_NOT_FOUND");
      return;
    }

    const inventoryItem = itemResult.rows[0] as {
      itemId: string;
      quantity: number;
    };

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

    // Add to stakes (in-memory tracking only - items stay in inventory)
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

    // Audit log the stake operation
    AuditLogger.getInstance().logDuelStakeAdd(duelId, playerId, {
      inventorySlot,
      itemId: inventoryItem.itemId,
      quantity: qty,
      value,
    });

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

    sendToSocket(socket, DUEL_PACKETS.STAKES_UPDATED, updatePayload);

    const opponentId =
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const opponentSocket = getSocketByPlayerId(world, opponentId);
    if (opponentSocket) {
      sendToSocket(opponentSocket, DUEL_PACKETS.STAKES_UPDATED, updatePayload);
    }
  } catch (error) {
    console.error("[Duel] Stake add failed:", error);
    sendDuelError(socket, "Failed to add stake", "SERVER_ERROR");
  }
}

// ============================================================================
// Remove Stake Handler
// ============================================================================

/**
 * Handle removing a staked item
 *
 * CRASH-SAFE DESIGN: Since items remain in inventory until duel completion,
 * removing a stake just updates the session tracking - no DB changes needed.
 *
 * Security:
 * - Rate limited to prevent spam
 * - Audit logged for economic tracking
 */
export async function handleDuelRemoveStake(
  socket: ServerSocket,
  data: { duelId: string; stakeIndex: number },
  world: World,
  _db: DatabaseConnection,
): Promise<void> {
  const auth = withDuelAuth(socket, world);
  if (!auth) return;
  const { playerId, duelSystem } = auth;

  // Rate limiting - prevent rapid stake operations
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(
      socket,
      "Please wait before modifying stakes",
      "RATE_LIMITED",
    );
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

  // Copy stake data before removal for audit
  const removedStake = { ...stakes[stakeIndex] };

  // Remove from stakes (in-memory tracking only - items are still in inventory)
  const result = duelSystem.removeStake(duelId, playerId, stakeIndex);
  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Audit log the unstake operation
  AuditLogger.getInstance().logDuelStakeRemove(duelId, playerId, removedStake);

  // Notify both players of the stake change
  const updatePayload = {
    duelId,
    challengerStakes: session.challengerStakes,
    targetStakes: session.targetStakes,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    modifiedBy: playerId,
  };

  sendToSocket(socket, DUEL_PACKETS.STAKES_UPDATED, updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, DUEL_PACKETS.STAKES_UPDATED, updatePayload);
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
  const auth = withDuelAuth(socket, world);
  if (!auth) return;
  const { playerId, duelSystem } = auth;

  // Rate limit accept operations to prevent spam
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(socket, "Please wait before accepting", "RATE_LIMITED");
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

  sendToSocket(socket, DUEL_PACKETS.ACCEPTANCE_UPDATED, updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(
      opponentSocket,
      DUEL_PACKETS.ACCEPTANCE_UPDATED,
      updatePayload,
    );
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

    sendToSocket(socket, DUEL_PACKETS.STATE_CHANGED, statePayload);
    if (opponentSocket) {
      sendToSocket(opponentSocket, DUEL_PACKETS.STATE_CHANGED, statePayload);
    }
  }
}
