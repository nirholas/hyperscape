/**
 * Duel Stakes Handlers
 *
 * Handles duel stakes negotiation:
 * - handleDuelAddStake: Add an item from inventory to stakes
 * - handleDuelRemoveStake: Remove a staked item
 * - handleDuelAcceptStakes: Accept current stakes configuration
 *
 * Security features:
 * - Database transactions for atomicity (BEGIN/COMMIT/ROLLBACK)
 * - SELECT FOR UPDATE to prevent race conditions
 * - Rate limiting to prevent spam
 * - Audit logging for economic integrity
 */

import { type World, getItem, isValidSlotNumber } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import { InventoryRepository } from "../../../../database/repositories/InventoryRepository";
import type { DatabaseConnection } from "../trade/types";
import { AuditLogger } from "../../services";
import {
  rateLimiter,
  getDuelSystem,
  sendDuelError,
  sendToSocket,
  getPlayerId,
  getSocketByPlayerId,
} from "./helpers";

// ============================================================================
// Transaction Helper
// ============================================================================

/**
 * Execute a function within a database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 *
 * @param db - Database connection
 * @param fn - Async function to execute within transaction
 * @returns Result of the function
 * @throws Rethrows any error after rolling back
 */
async function withTransaction<T>(
  db: DatabaseConnection,
  fn: () => Promise<T>,
): Promise<T> {
  await db.pool.query("BEGIN");
  try {
    const result = await fn();
    await db.pool.query("COMMIT");
    return result;
  } catch (error) {
    await db.pool.query("ROLLBACK");
    throw error;
  }
}

// ============================================================================
// Add Stake Handler
// ============================================================================

/**
 * Handle adding an item to stakes
 *
 * Security:
 * - Wrapped in database transaction
 * - Uses SELECT FOR UPDATE to lock inventory row
 * - Rate limited to prevent spam
 * - Audit logged for economic tracking
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

  // Rate limiting - prevent rapid stake operations
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(
      socket,
      "Please wait before modifying stakes",
      "RATE_LIMITED",
    );
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

  // Get inventory system for memory sync
  const inventorySystem = world.getSystem("inventory") as
    | {
        lockForTransaction?: (id: string) => boolean;
        unlockTransaction?: (id: string) => void;
        reloadFromDatabase?: (id: string) => Promise<void>;
      }
    | undefined;

  // Lock in-memory inventory to prevent concurrent operations
  const locked = inventorySystem?.lockForTransaction?.(playerId) ?? true;
  if (!locked) {
    sendDuelError(socket, "Inventory busy, try again", "SERVER_ERROR");
    return;
  }

  try {
    // Execute within database transaction for atomicity
    await withTransaction(db, async () => {
      // SECURITY: Lock the inventory row to prevent race conditions (TOCTOU)
      const lockResult = await db.pool.query(
        `SELECT "itemId", quantity FROM inventory
         WHERE "playerId" = $1 AND "slotIndex" = $2
         FOR UPDATE`,
        [playerId, inventorySlot],
      );

      if (lockResult.rows.length === 0) {
        throw new StakeError("No item in that slot", "ITEM_NOT_FOUND");
      }

      const inventoryItem = lockResult.rows[0] as {
        itemId: string;
        quantity: number;
      };

      // Validate item exists in item database
      const itemData = getItem(inventoryItem.itemId);
      if (!itemData) {
        throw new StakeError("Invalid item", "INVALID_ITEM");
      }

      // Check if item is tradeable (stakeable items must be tradeable)
      if (itemData.tradeable === false) {
        throw new StakeError(
          "This item cannot be staked",
          "ITEM_NOT_TRADEABLE",
        );
      }

      // Determine quantity (for stackable items, use provided quantity or all)
      let qty = quantity;
      if (qty <= 0 || qty > inventoryItem.quantity) {
        qty = inventoryItem.quantity;
      }

      // Calculate value
      const value = (itemData.value || 0) * qty;

      // Add to stakes (in-memory)
      const result = duelSystem.addStake(
        duelId,
        playerId,
        inventorySlot,
        inventoryItem.itemId,
        qty,
        value,
      );

      if (!result.success) {
        throw new StakeError(result.error!, result.errorCode || "UNKNOWN");
      }

      // Remove item from inventory (database)
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

      // Audit log the stake operation
      AuditLogger.getInstance().logDuelStakeAdd(duelId, playerId, {
        inventorySlot,
        itemId: inventoryItem.itemId,
        quantity: qty,
        value,
      });
    });

    // Sync in-memory inventory with database
    if (inventorySystem?.reloadFromDatabase) {
      await inventorySystem.reloadFromDatabase(playerId);
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
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const opponentSocket = getSocketByPlayerId(world, opponentId);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelStakesUpdated", updatePayload);
    }
  } catch (error) {
    if (error instanceof StakeError) {
      sendDuelError(socket, error.message, error.code);
    } else {
      console.error("[Duel] Stake add transaction failed:", error);
      sendDuelError(socket, "Failed to add stake", "SERVER_ERROR");
    }
  } finally {
    // SECURITY: Always unlock inventory
    inventorySystem?.unlockTransaction?.(playerId);
  }
}

// ============================================================================
// Remove Stake Handler
// ============================================================================

/**
 * Handle removing a staked item
 *
 * Security:
 * - Wrapped in database transaction
 * - Uses SELECT FOR UPDATE when adding back to inventory
 * - Rate limited to prevent spam
 * - Audit logged for economic tracking
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

  // Rate limiting - prevent rapid stake operations
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(
      socket,
      "Please wait before modifying stakes",
      "RATE_LIMITED",
    );
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

  // Copy stake data before removal
  const removedStake = { ...stakes[stakeIndex] };

  // Get inventory system for memory sync
  const inventorySystem = world.getSystem("inventory") as
    | {
        lockForTransaction?: (id: string) => boolean;
        unlockTransaction?: (id: string) => void;
        reloadFromDatabase?: (id: string) => Promise<void>;
      }
    | undefined;

  // Lock in-memory inventory
  const locked = inventorySystem?.lockForTransaction?.(playerId) ?? true;
  if (!locked) {
    sendDuelError(socket, "Inventory busy, try again", "SERVER_ERROR");
    return;
  }

  try {
    // Execute within database transaction for atomicity
    await withTransaction(db, async () => {
      // Remove from stakes (in-memory) first
      const result = duelSystem.removeStake(duelId, playerId, stakeIndex);
      if (!result.success) {
        throw new StakeError(result.error!, result.errorCode || "UNKNOWN");
      }

      // Return item to inventory
      const itemData = getItem(removedStake.itemId);
      const isStackable = itemData?.stackable ?? false;

      if (isStackable) {
        // Check if item already exists in inventory (need to stack)
        const existingResult = await db.pool.query(
          `SELECT "slotIndex", quantity FROM inventory
           WHERE "playerId" = $1 AND "itemId" = $2
           FOR UPDATE`,
          [playerId, removedStake.itemId],
        );

        if (existingResult.rows.length > 0) {
          // Add to existing stack
          const existing = existingResult.rows[0] as {
            slotIndex: number;
            quantity: number;
          };
          await db.pool.query(
            `UPDATE inventory SET quantity = quantity + $1
             WHERE "playerId" = $2 AND "slotIndex" = $3`,
            [removedStake.quantity, playerId, existing.slotIndex],
          );
        } else {
          // Find free slot and insert
          await insertIntoFreeSlot(db, playerId, removedStake);
        }
      } else {
        // Non-stackable - find free slot and insert
        await insertIntoFreeSlot(db, playerId, removedStake);
      }

      // Audit log the unstake operation
      AuditLogger.getInstance().logDuelStakeRemove(
        duelId,
        playerId,
        removedStake,
      );
    });

    // Sync in-memory inventory with database
    if (inventorySystem?.reloadFromDatabase) {
      await inventorySystem.reloadFromDatabase(playerId);
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
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const opponentSocket = getSocketByPlayerId(world, opponentId);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelStakesUpdated", updatePayload);
    }
  } catch (error) {
    if (error instanceof StakeError) {
      sendDuelError(socket, error.message, error.code);
    } else {
      console.error("[Duel] Stake remove transaction failed:", error);
      sendDuelError(socket, "Failed to remove stake", "SERVER_ERROR");
    }
  } finally {
    // SECURITY: Always unlock inventory
    inventorySystem?.unlockTransaction?.(playerId);
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

  // Rate limit accept operations to prevent spam
  if (!rateLimiter.tryOperation(playerId)) {
    sendDuelError(socket, "Please wait before accepting", "RATE_LIMITED");
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Custom error class for stake operations
 */
class StakeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "StakeError";
  }
}

/**
 * Find a free inventory slot and insert item
 */
async function insertIntoFreeSlot(
  db: DatabaseConnection,
  playerId: string,
  stake: { itemId: string; quantity: number },
): Promise<void> {
  // Get all used slots
  const slotsResult = await db.pool.query(
    `SELECT "slotIndex" FROM inventory WHERE "playerId" = $1`,
    [playerId],
  );

  const usedSlots = new Set(
    slotsResult.rows.map((r: { slotIndex: number }) => r.slotIndex),
  );

  // Find first free slot (0-27)
  let freeSlot = -1;
  for (let i = 0; i < 28; i++) {
    if (!usedSlots.has(i)) {
      freeSlot = i;
      break;
    }
  }

  if (freeSlot === -1) {
    // This shouldn't happen since item came from inventory
    throw new StakeError("No free inventory slot", "INVENTORY_FULL");
  }

  // Insert into free slot
  await db.pool.query(
    `INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
     VALUES ($1, $2, $3, $4, NULL)`,
    [playerId, stake.itemId, stake.quantity, freeSlot],
  );
}
