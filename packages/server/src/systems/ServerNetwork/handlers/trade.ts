/**
 * Trade Packet Handlers
 *
 * Handles all player-to-player trade network packets:
 * - tradeRequest: Player A requests trade with Player B
 * - tradeRequestRespond: Player B accepts/declines trade request
 * - tradeAddItem: Player adds item from inventory to trade offer
 * - tradeRemoveItem: Player removes item from trade offer
 * - tradeSetItemQuantity: Player changes quantity of item in trade
 * - tradeAccept: Player accepts current trade state
 * - tradeCancelAccept: Player cancels acceptance
 * - tradeCancel: Player cancels/closes trade
 *
 * SECURITY MEASURES:
 * - All operations are server-authoritative
 * - TradingSystem validates all state transitions
 * - Inventory items are validated at add time and completion time
 * - Atomic database transactions for item swap prevent duplication
 * - Inventory locks prevent race conditions during swap
 * - Disconnection handling prevents orphaned trades
 *
 * @see packages/server/src/systems/TradingSystem for trade state management
 * @see packages/shared/src/types/game/trade-types.ts for type definitions
 */

import {
  type World,
  EventType,
  getItem,
  type TradeOfferView,
  isValidSlotNumber,
  isValidPlayerID,
} from "@hyperscape/shared";
import type { ServerSocket } from "../../../shared/types";
import { InventoryRepository } from "../../../database/repositories/InventoryRepository";
import { sql } from "drizzle-orm";

import { RateLimitService } from "../services";
import {
  executeSecureTransaction,
  sendToSocket,
  sendSuccessToast,
  getPlayerId,
} from "./common";
import type { DatabaseConnection } from "./common/types";
import type { TradingSystem } from "../../TradingSystem";

// Rate limiter for trade operations (more lenient than combat/store)
const rateLimiter = new RateLimitService();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get TradingSystem from world
 */
function getTradingSystem(world: World): TradingSystem | undefined {
  // TradingSystem is stored on world object
  const worldWithTrading = world as { tradingSystem?: TradingSystem };
  return worldWithTrading.tradingSystem;
}

/**
 * Get player name from world entities
 *
 * Returns player's display name, or "Unknown" if entity not found.
 * This can happen during race conditions (player disconnecting during trade).
 */
function getPlayerName(world: World, playerId: string): string {
  const player = world.entities?.players?.get(playerId);
  if (!player) {
    // Player entity not found - could be disconnected
    // Log at debug level since this can happen during normal disconnect flows
    console.debug(
      "[TradeHandler] Player entity not found for name lookup:",
      playerId,
    );
    return "Unknown";
  }
  // Access name through the player entity - try multiple locations
  const entity = player as {
    name?: string;
    data?: { name?: string };
    playerName?: string;
  };
  const name = entity.name || entity.data?.name || entity.playerName;
  if (!name) {
    console.warn(
      "[TradeHandler] Player entity found but no name property:",
      playerId,
    );
    return "Unknown";
  }
  return name;
}

/**
 * Get player combat level from world entities
 *
 * Returns player's combat level, or 3 (minimum) if not found.
 * Level 3 is the base combat level in OSRS.
 */
function getPlayerCombatLevel(world: World, playerId: string): number {
  const player = world.entities?.players?.get(playerId);
  if (!player) {
    // Player entity not found - return base combat level
    return 3;
  }
  const entity = player as unknown as {
    combatLevel?: number;
    data?: { combatLevel?: number };
    level?: number;
  };
  const level = entity.combatLevel || entity.data?.combatLevel || entity.level;
  // Ensure valid range (3-126 in OSRS)
  if (typeof level !== "number" || level < 3) {
    return 3;
  }
  return Math.min(level, 126);
}

/**
 * Get socket by player ID from ServerNetwork's socket map
 */
function getSocketByPlayerId(
  world: World,
  playerId: string,
): ServerSocket | undefined {
  // ServerNetwork is registered as "network" in world.register()
  const serverNetwork = world.getSystem("network") as
    | {
        broadcastManager?: {
          getPlayerSocket: (id: string) => ServerSocket | undefined;
        };
        sockets?: Map<string, ServerSocket>;
      }
    | undefined;

  if (!serverNetwork) return undefined;

  // Use broadcastManager's getPlayerSocket if available (preferred)
  if (serverNetwork.broadcastManager?.getPlayerSocket) {
    return serverNetwork.broadcastManager.getPlayerSocket(playerId);
  }

  // Fallback: search through sockets directly
  if (serverNetwork.sockets) {
    for (const [, socket] of serverNetwork.sockets) {
      if (getPlayerId(socket) === playerId) {
        return socket;
      }
    }
  }

  return undefined;
}

/**
 * Send trade state update to both participants
 */
function sendTradeUpdate(
  world: World,
  tradingSystem: TradingSystem,
  tradeId: string,
): void {
  const session = tradingSystem.getTradeSession(tradeId);
  if (!session || session.status !== "active") return;

  // Build offers for initiator's perspective
  const initiatorOffer: TradeOfferView = {
    items: session.initiator.offeredItems,
    accepted: session.initiator.accepted,
  };
  const recipientOffer: TradeOfferView = {
    items: session.recipient.offeredItems,
    accepted: session.recipient.accepted,
  };

  // Send to initiator (their offer = initiatorOffer, partner's offer = recipientOffer)
  const initiatorSocket = getSocketByPlayerId(
    world,
    session.initiator.playerId,
  );
  if (initiatorSocket) {
    sendToSocket(initiatorSocket, "tradeUpdated", {
      tradeId,
      myOffer: initiatorOffer,
      theirOffer: recipientOffer,
    });
  }

  // Send to recipient (their offer = recipientOffer, partner's offer = initiatorOffer)
  const recipientSocket = getSocketByPlayerId(
    world,
    session.recipient.playerId,
  );
  if (recipientSocket) {
    sendToSocket(recipientSocket, "tradeUpdated", {
      tradeId,
      myOffer: recipientOffer,
      theirOffer: initiatorOffer,
    });
  }
}

/**
 * Send trade error to socket
 */
function sendTradeError(
  socket: ServerSocket,
  message: string,
  code: string,
): void {
  sendToSocket(socket, "tradeError", { message, code });
}

// ============================================================================
// Packet Handlers
// ============================================================================

/**
 * Handle trade request from Player A to Player B
 */
export function handleTradeRequest(
  socket: ServerSocket,
  data: { targetPlayerId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  // Rate limit check
  if (!rateLimiter.tryOperation(playerId)) {
    sendTradeError(
      socket,
      "Please wait before requesting again",
      "RATE_LIMITED",
    );
    return;
  }

  // Validate target player exists and is online
  const targetPlayerId = data.targetPlayerId;
  if (!isValidPlayerID(targetPlayerId)) {
    sendTradeError(socket, "Invalid player", "INVALID_PLAYER");
    return;
  }

  if (!tradingSystem.isPlayerOnline(targetPlayerId)) {
    sendTradeError(socket, "Player is not online", "PLAYER_OFFLINE");
    return;
  }

  // Get initiator info
  const initiatorName = getPlayerName(world, playerId);
  const initiatorLevel = getPlayerCombatLevel(world, playerId);

  // Create trade request
  const result = tradingSystem.createTradeRequest(
    playerId,
    initiatorName,
    socket.id,
    targetPlayerId,
  );

  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Send notification to target player
  const targetSocket = getSocketByPlayerId(world, targetPlayerId);
  if (targetSocket) {
    sendToSocket(targetSocket, "tradeIncoming", {
      tradeId: result.tradeId,
      fromPlayerId: playerId,
      fromPlayerName: initiatorName,
      fromPlayerLevel: initiatorLevel,
    });
  } else {
    // Target socket not found - cancel the trade
    tradingSystem.cancelTrade(result.tradeId!, "disconnected");
    sendTradeError(socket, "Player is not available", "PLAYER_OFFLINE");
    return;
  }

  // Send confirmation to initiator
  sendSuccessToast(
    socket,
    `Trade request sent to ${getPlayerName(world, targetPlayerId)}`,
  );
}

/**
 * Handle trade request response (accept/decline)
 */
export function handleTradeRequestRespond(
  socket: ServerSocket,
  data: { tradeId: string; accept: boolean },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  const session = tradingSystem.getTradeSession(data.tradeId);
  if (!session) {
    sendTradeError(socket, "Trade request expired", "INVALID_TRADE");
    return;
  }

  // Get recipient info
  const recipientName = getPlayerName(world, playerId);

  // Process the response
  const result = tradingSystem.respondToTradeRequest(
    data.tradeId,
    playerId,
    recipientName,
    socket.id,
    data.accept,
  );

  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  if (!data.accept) {
    // Declined - notify initiator
    const initiatorSocket = getSocketByPlayerId(
      world,
      session.initiator.playerId,
    );
    if (initiatorSocket) {
      sendToSocket(initiatorSocket, "tradeCancelled", {
        tradeId: data.tradeId,
        reason: "declined",
        message: `${recipientName} declined your trade request`,
      });
    }
    return;
  }

  // Trade accepted - send tradeStarted to both
  const initiatorSocket = getSocketByPlayerId(
    world,
    session.initiator.playerId,
  );
  const recipientSocket = socket;

  const initiatorLevel = getPlayerCombatLevel(
    world,
    session.initiator.playerId,
  );
  const recipientLevel = getPlayerCombatLevel(world, playerId);

  // Send to initiator
  if (initiatorSocket) {
    sendToSocket(initiatorSocket, "tradeStarted", {
      tradeId: data.tradeId,
      partnerId: playerId,
      partnerName: recipientName,
      partnerLevel: recipientLevel,
    });
  }

  // Send to recipient
  sendToSocket(recipientSocket, "tradeStarted", {
    tradeId: data.tradeId,
    partnerId: session.initiator.playerId,
    partnerName: session.initiator.playerName,
    partnerLevel: initiatorLevel,
  });
}

/**
 * Handle adding item to trade offer
 */
export async function handleTradeAddItem(
  socket: ServerSocket,
  data: { tradeId: string; inventorySlot: number; quantity?: number },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  // Rate limit
  if (!rateLimiter.tryOperation(playerId)) {
    sendTradeError(socket, "Too fast", "RATE_LIMITED");
    return;
  }

  // Validate trade session
  const session = tradingSystem.getTradeSession(data.tradeId);
  if (!session || session.status !== "active") {
    sendTradeError(socket, "Not in an active trade", "NOT_IN_TRADE");
    return;
  }

  // Validate slot
  const slot = data.inventorySlot;
  if (!isValidSlotNumber(slot) || slot < 0 || slot > 27) {
    sendTradeError(socket, "Invalid inventory slot", "INVALID_SLOT");
    return;
  }

  // Get item from database inventory
  const inventoryRepo = new InventoryRepository(db.drizzle, db.pool);
  const inventoryItems = await inventoryRepo.getPlayerInventoryAsync(playerId);
  const inventoryItem = inventoryItems.find((item) => item.slotIndex === slot);

  if (!inventoryItem) {
    sendTradeError(socket, "No item in that slot", "INVALID_ITEM");
    return;
  }

  // Validate item exists in item database
  const itemData = getItem(inventoryItem.itemId);
  if (!itemData) {
    sendTradeError(socket, "Invalid item", "INVALID_ITEM");
    return;
  }

  // Validate item is tradeable
  if (itemData.tradeable === false) {
    sendTradeError(socket, "That item cannot be traded", "UNTRADEABLE_ITEM");
    return;
  }

  // Determine quantity (for stackable items, use provided quantity or all)
  let quantity = data.quantity ?? inventoryItem.quantity;
  if (quantity <= 0 || quantity > inventoryItem.quantity) {
    quantity = inventoryItem.quantity;
  }

  // Check if item is already offered from this slot
  const participant =
    session.initiator.playerId === playerId
      ? session.initiator
      : session.recipient;

  const existingOffer = participant.offeredItems.find(
    (item) => item.inventorySlot === slot,
  );
  if (existingOffer) {
    // Already offered - update quantity if different
    if (existingOffer.quantity === quantity) {
      return; // No change needed
    }
  }

  // Add/update in trading system
  const result = tradingSystem.addItemToTrade(
    data.tradeId,
    playerId,
    slot,
    inventoryItem.itemId,
    quantity,
  );

  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Send updated trade state to both players
  sendTradeUpdate(world, tradingSystem, data.tradeId);
}

/**
 * Handle removing item from trade offer
 */
export function handleTradeRemoveItem(
  socket: ServerSocket,
  data: { tradeId: string; tradeSlot: number },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  // Rate limit
  if (!rateLimiter.tryOperation(playerId)) {
    sendTradeError(socket, "Too fast", "RATE_LIMITED");
    return;
  }

  const result = tradingSystem.removeItemFromTrade(
    data.tradeId,
    playerId,
    data.tradeSlot,
  );

  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Send updated trade state
  sendTradeUpdate(world, tradingSystem, data.tradeId);
}

/**
 * Handle setting quantity for stackable item
 */
export async function handleTradeSetQuantity(
  socket: ServerSocket,
  data: { tradeId: string; tradeSlot: number; quantity: number },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  const session = tradingSystem.getTradeSession(data.tradeId);
  if (!session || session.status !== "active") {
    sendTradeError(socket, "Not in an active trade", "NOT_IN_TRADE");
    return;
  }

  // Find the offered item
  const participant =
    session.initiator.playerId === playerId
      ? session.initiator
      : session.recipient;

  const offeredItem = participant.offeredItems.find(
    (item) => item.tradeSlot === data.tradeSlot,
  );
  if (!offeredItem) {
    sendTradeError(socket, "Item not found in trade", "INVALID_SLOT");
    return;
  }

  // Validate quantity against actual inventory
  const inventoryRepo = new InventoryRepository(db.drizzle, db.pool);
  const inventoryItems = await inventoryRepo.getPlayerInventoryAsync(playerId);
  const inventoryItem = inventoryItems.find(
    (item) => item.slotIndex === offeredItem.inventorySlot,
  );

  if (!inventoryItem || inventoryItem.quantity < data.quantity) {
    sendTradeError(socket, "Not enough items", "INVALID_QUANTITY");
    return;
  }

  // Update in trading system (reuse addItemToTrade which handles updates)
  const result = tradingSystem.addItemToTrade(
    data.tradeId,
    playerId,
    offeredItem.inventorySlot,
    offeredItem.itemId,
    data.quantity,
  );

  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  sendTradeUpdate(world, tradingSystem, data.tradeId);
}

/**
 * Handle trade accept
 */
export async function handleTradeAccept(
  socket: ServerSocket,
  data: { tradeId: string },
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  // Set acceptance
  const result = tradingSystem.setAcceptance(data.tradeId, playerId, true);
  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Send update to both players
  sendTradeUpdate(world, tradingSystem, data.tradeId);

  // Check if both accepted - if so, complete the trade
  if (result.bothAccepted) {
    await executeTradeSwap(tradingSystem, data.tradeId, world, db);
  }
}

/**
 * Handle trade accept cancellation
 */
export function handleTradeCancelAccept(
  socket: ServerSocket,
  data: { tradeId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  const result = tradingSystem.setAcceptance(data.tradeId, playerId, false);
  if (!result.success) {
    sendTradeError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  sendTradeUpdate(world, tradingSystem, data.tradeId);
}

/**
 * Handle trade cancellation
 */
export function handleTradeCancel(
  socket: ServerSocket,
  data: { tradeId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendTradeError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  const tradingSystem = getTradingSystem(world);
  if (!tradingSystem) {
    sendTradeError(socket, "Trading system unavailable", "SYSTEM_ERROR");
    return;
  }

  const session = tradingSystem.getTradeSession(data.tradeId);
  if (!session) {
    return; // Already cancelled
  }

  // Cancel the trade (with audit trail of who cancelled)
  tradingSystem.cancelTrade(data.tradeId, "cancelled", playerId);

  // Send cancellation to both players
  const partnerPlayerId =
    session.initiator.playerId === playerId
      ? session.recipient.playerId
      : session.initiator.playerId;

  const partnerSocket = getSocketByPlayerId(world, partnerPlayerId);
  if (partnerSocket) {
    sendToSocket(partnerSocket, "tradeCancelled", {
      tradeId: data.tradeId,
      reason: "cancelled",
      message: `${getPlayerName(world, playerId)} cancelled the trade`,
    });
  }

  // Also notify the cancelling player
  sendToSocket(socket, "tradeCancelled", {
    tradeId: data.tradeId,
    reason: "cancelled",
    message: "Trade cancelled",
  });
}

// ============================================================================
// Trade Completion - Atomic Item Swap
// ============================================================================

/**
 * Execute the atomic item swap for a completed trade
 *
 * This is the critical section where items are swapped between players.
 * Uses database transactions and inventory locks to prevent duplication.
 */
async function executeTradeSwap(
  tradingSystem: TradingSystem,
  tradeId: string,
  world: World,
  db: DatabaseConnection,
): Promise<void> {
  const session = tradingSystem.getTradeSession(tradeId);
  if (!session) {
    // Session was likely cancelled during the swap process
    // This is a race condition - both players accepted but session was removed
    console.error("[TradeHandler] Session not found for swap:", tradeId);
    // Can't notify players without session data - this indicates a bug
    // Log for monitoring but don't crash
    return;
  }

  // Validate session is still in correct state
  if (session.status !== "active") {
    console.error(
      "[TradeHandler] Session not active for swap:",
      tradeId,
      session.status,
    );
    sendTradeErrorToBoth(world, session, "Trade was cancelled");
    return;
  }

  // Get both players' inventory systems
  const inventorySystem = world.getSystem("inventory") as
    | {
        lockForTransaction: (id: string) => boolean;
        unlockTransaction: (id: string) => void;
        reloadFromDatabase: (id: string) => Promise<void>;
        persistInventoryImmediate: (id: string) => Promise<void>;
      }
    | undefined;

  if (!inventorySystem) {
    console.error("[TradeHandler] InventorySystem not available");
    sendTradeErrorToBoth(world, session, "Trade failed - system error");
    tradingSystem.cancelTrade(tradeId, "server_error");
    return;
  }

  const initiatorId = session.initiator.playerId;
  const recipientId = session.recipient.playerId;

  // Lock both inventories
  const initiatorLocked = inventorySystem.lockForTransaction(initiatorId);
  if (!initiatorLocked) {
    sendTradeErrorToBoth(world, session, "Trade failed - try again");
    tradingSystem.cancelTrade(tradeId, "server_error");
    return;
  }

  const recipientLocked = inventorySystem.lockForTransaction(recipientId);
  if (!recipientLocked) {
    inventorySystem.unlockTransaction(initiatorId);
    sendTradeErrorToBoth(world, session, "Trade failed - try again");
    tradingSystem.cancelTrade(tradeId, "server_error");
    return;
  }

  try {
    // Flush both inventories to DB
    await inventorySystem.persistInventoryImmediate(initiatorId);
    await inventorySystem.persistInventoryImmediate(recipientId);

    // Execute the atomic swap in a transaction
    const swapResult = await executeSecureTransaction(
      {
        playerId: initiatorId,
        socket: { id: "trade-swap" } as ServerSocket,
        world,
        db,
        sessionType: "trade" as import("@hyperscape/shared").SessionType,
      },
      {
        execute: async (tx) => {
          // Get and lock current inventories using raw SQL
          const initiatorResult = await tx.execute(
            sql`SELECT * FROM inventory
                WHERE "playerId" = ${initiatorId}
                ORDER BY "slotIndex"
                FOR UPDATE`,
          );
          const recipientResult = await tx.execute(
            sql`SELECT * FROM inventory
                WHERE "playerId" = ${recipientId}
                ORDER BY "slotIndex"
                FOR UPDATE`,
          );

          type InventoryDBRow = {
            id: number;
            playerId: string;
            itemId: string;
            quantity: number;
            slotIndex: number;
            metadata: string | null;
          };

          const initiatorInventory = initiatorResult.rows as InventoryDBRow[];
          const recipientInventory = recipientResult.rows as InventoryDBRow[];

          // Validate all offered items still exist with correct quantities and are tradeable
          for (const offer of session.initiator.offeredItems) {
            const item = initiatorInventory.find(
              (i) => i.slotIndex === offer.inventorySlot,
            );
            if (
              !item ||
              item.itemId !== offer.itemId ||
              item.quantity < offer.quantity
            ) {
              throw new Error("ITEM_CHANGED");
            }

            // Re-validate tradeable at swap time (item could have been modified)
            const itemDef = getItem(offer.itemId);
            if (!itemDef || itemDef.tradeable === false) {
              throw new Error("UNTRADEABLE_ITEM");
            }
          }

          for (const offer of session.recipient.offeredItems) {
            const item = recipientInventory.find(
              (i) => i.slotIndex === offer.inventorySlot,
            );
            if (
              !item ||
              item.itemId !== offer.itemId ||
              item.quantity < offer.quantity
            ) {
              throw new Error("ITEM_CHANGED");
            }

            // Re-validate tradeable at swap time
            const itemDef = getItem(offer.itemId);
            if (!itemDef || itemDef.tradeable === false) {
              throw new Error("UNTRADEABLE_ITEM");
            }
          }

          // Calculate free slots for each player
          const initiatorUsedSlots = new Set(
            initiatorInventory.map((i) => i.slotIndex),
          );
          const recipientUsedSlots = new Set(
            recipientInventory.map((i) => i.slotIndex),
          );

          // Slots being freed by offered items
          const initiatorOfferSlots = new Set(
            session.initiator.offeredItems.map((i) => i.inventorySlot),
          );
          const recipientOfferSlots = new Set(
            session.recipient.offeredItems.map((i) => i.inventorySlot),
          );

          // After removing offered items, check if there's space for incoming items
          const initiatorFreeSlots = countFreeSlots(
            initiatorUsedSlots,
            initiatorOfferSlots,
          );
          const recipientFreeSlots = countFreeSlots(
            recipientUsedSlots,
            recipientOfferSlots,
          );

          // Check if initiator has space for recipient's items
          const recipientOfferCount = session.recipient.offeredItems.length;
          if (
            initiatorFreeSlots + initiatorOfferSlots.size <
            recipientOfferCount
          ) {
            throw new Error("INVENTORY_FULL_INITIATOR");
          }

          // Check if recipient has space for initiator's items
          const initiatorOfferCount = session.initiator.offeredItems.length;
          if (
            recipientFreeSlots + recipientOfferSlots.size <
            initiatorOfferCount
          ) {
            throw new Error("INVENTORY_FULL_RECIPIENT");
          }

          // ===== EXECUTE THE SWAP =====

          // Track used slots for finding free slots during the swap
          const recipientTrackingSlots = new Set(recipientUsedSlots);
          const initiatorTrackingSlots = new Set(initiatorUsedSlots);

          // 1. Remove items from initiator and add to recipient
          for (const offer of session.initiator.offeredItems) {
            // Reduce/remove from initiator
            const item = initiatorInventory.find(
              (i) => i.slotIndex === offer.inventorySlot,
            )!;
            if (item.quantity === offer.quantity) {
              // Remove entirely
              await tx.execute(
                sql`DELETE FROM inventory
                    WHERE "playerId" = ${initiatorId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
              initiatorTrackingSlots.delete(offer.inventorySlot);
            } else {
              // Reduce quantity
              await tx.execute(
                sql`UPDATE inventory
                    SET quantity = ${item.quantity - offer.quantity}
                    WHERE "playerId" = ${initiatorId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
            }

            // Add to recipient in next free slot
            const recipientSlot = findFreeSlotFromSet(
              recipientTrackingSlots,
              recipientOfferSlots,
            );
            await tx.execute(
              sql`INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
                  VALUES (${recipientId}, ${offer.itemId}, ${offer.quantity}, ${recipientSlot}, NULL)`,
            );
            recipientTrackingSlots.add(recipientSlot);
          }

          // 2. Remove items from recipient and add to initiator
          for (const offer of session.recipient.offeredItems) {
            // Reduce/remove from recipient
            const item = recipientInventory.find(
              (i) => i.slotIndex === offer.inventorySlot,
            )!;
            if (item.quantity === offer.quantity) {
              await tx.execute(
                sql`DELETE FROM inventory
                    WHERE "playerId" = ${recipientId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
              recipientTrackingSlots.delete(offer.inventorySlot);
            } else {
              await tx.execute(
                sql`UPDATE inventory
                    SET quantity = ${item.quantity - offer.quantity}
                    WHERE "playerId" = ${recipientId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
            }

            // Add to initiator
            const initiatorSlot = findFreeSlotFromSet(
              initiatorTrackingSlots,
              initiatorOfferSlots,
            );
            await tx.execute(
              sql`INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
                  VALUES (${initiatorId}, ${offer.itemId}, ${offer.quantity}, ${initiatorSlot}, NULL)`,
            );
            initiatorTrackingSlots.add(initiatorSlot);
          }

          return {
            initiatorReceived: session.recipient.offeredItems.map((i) => ({
              itemId: i.itemId,
              quantity: i.quantity,
            })),
            recipientReceived: session.initiator.offeredItems.map((i) => ({
              itemId: i.itemId,
              quantity: i.quantity,
            })),
          };
        },
        errorMessages: {
          ITEM_CHANGED: "Items changed during trade",
          INVENTORY_FULL_INITIATOR: "Your inventory is full",
          INVENTORY_FULL_RECIPIENT: "Partner's inventory is full",
          UNTRADEABLE_ITEM: "Trade contains untradeable items",
        },
      },
    );

    if (!swapResult) {
      // Transaction failed - already sent error via executeSecureTransaction
      tradingSystem.cancelTrade(tradeId, "invalid_items");
      return;
    }

    // Reload both inventories from DB
    await inventorySystem.reloadFromDatabase(initiatorId);
    await inventorySystem.reloadFromDatabase(recipientId);

    // Complete the trade in trading system
    tradingSystem.completeTrade(tradeId);

    // Send completion packets
    const initiatorSocket = getSocketByPlayerId(world, initiatorId);
    const recipientSocket = getSocketByPlayerId(world, recipientId);

    if (initiatorSocket) {
      sendToSocket(initiatorSocket, "tradeCompleted", {
        tradeId,
        receivedItems: swapResult.initiatorReceived,
      });
    }

    if (recipientSocket) {
      sendToSocket(recipientSocket, "tradeCompleted", {
        tradeId,
        receivedItems: swapResult.recipientReceived,
      });
    }

    // Emit inventory updated events to sync UI
    world.emit(EventType.INVENTORY_UPDATED, { playerId: initiatorId });
    world.emit(EventType.INVENTORY_UPDATED, { playerId: recipientId });
  } catch (error) {
    // Unexpected error during trade - cancel and notify both players
    console.error("[TradeHandler] Unexpected error during trade swap:", error);
    sendTradeErrorToBoth(world, session, "Trade failed - please try again");
    tradingSystem.cancelTrade(tradeId, "server_error");
  } finally {
    // Always unlock inventories
    inventorySystem.unlockTransaction(initiatorId);
    inventorySystem.unlockTransaction(recipientId);
  }
}

/**
 * Send trade error to both participants
 */
function sendTradeErrorToBoth(
  world: World,
  session: ReturnType<TradingSystem["getTradeSession"]>,
  message: string,
): void {
  if (!session) return;

  const initiatorSocket = getSocketByPlayerId(
    world,
    session.initiator.playerId,
  );
  const recipientSocket = getSocketByPlayerId(
    world,
    session.recipient.playerId,
  );

  if (initiatorSocket) {
    sendTradeError(initiatorSocket, message, "TRADE_FAILED");
  }
  if (recipientSocket) {
    sendTradeError(recipientSocket, message, "TRADE_FAILED");
  }
}

/**
 * Count free slots in inventory, accounting for slots being freed
 */
function countFreeSlots(
  usedSlots: Set<number>,
  beingFreed: Set<number>,
): number {
  let freeCount = 0;
  for (let i = 0; i < 28; i++) {
    if (!usedSlots.has(i) || beingFreed.has(i)) {
      freeCount++;
    }
  }
  return freeCount;
}

/**
 * Find the next free slot in inventory
 */
function findFreeSlotFromSet(
  usedSlots: Set<number>,
  beingFreed: Set<number>,
): number {
  for (let i = 0; i < 28; i++) {
    if (!usedSlots.has(i) || beingFreed.has(i)) {
      beingFreed.delete(i); // Mark as used now
      return i;
    }
  }
  throw new Error("No free slot found");
}
