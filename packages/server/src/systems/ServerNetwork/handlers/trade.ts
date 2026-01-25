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
  type TradeOfferItem,
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
  getEntityPosition,
  hasActiveInterfaceSession,
} from "./common";
import { uuid } from "@hyperscape/shared";
import type { DatabaseConnection } from "./common/types";
import type { TradingSystem } from "../../TradingSystem";
import type { PendingTradeManager } from "../PendingTradeManager";

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
 * Get PendingTradeManager from world
 */
function getPendingTradeManager(world: World): PendingTradeManager | undefined {
  // PendingTradeManager is stored on world object
  const worldWithPending = world as {
    pendingTradeManager?: PendingTradeManager;
  };
  return worldWithPending.pendingTradeManager;
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
 * Maximum distance in tiles for players to initiate a trade (OSRS-style)
 * Players must be adjacent (1 tile) to trade
 */
const TRADE_PROXIMITY_TILES = 1;

/**
 * Calculate Chebyshev distance between two positions (tile-based)
 * In OSRS, adjacency is measured using Chebyshev distance (allows diagonals)
 */
function chebyshevDistance(
  pos1: { x: number; z: number },
  pos2: { x: number; z: number },
): number {
  return Math.max(Math.abs(pos1.x - pos2.x), Math.abs(pos1.z - pos2.z));
}

/**
 * Check if two players are within trade range
 * Returns true if players are adjacent (within TRADE_PROXIMITY_TILES)
 */
function arePlayersInTradeRange(
  world: World,
  playerId1: string,
  playerId2: string,
): boolean {
  const player1 = world.entities?.players?.get(playerId1);
  const player2 = world.entities?.players?.get(playerId2);

  if (!player1 || !player2) return false;

  const pos1 = getEntityPosition(player1);
  const pos2 = getEntityPosition(player2);

  if (!pos1 || !pos2) return false;

  // Convert world position to tile position (assuming 1 tile = 1 unit)
  const distance = chebyshevDistance(pos1, pos2);
  return distance <= TRADE_PROXIMITY_TILES;
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
  // Allow updates in both "active" (offer screen) and "confirming" (confirmation screen)
  if (
    !session ||
    (session.status !== "active" && session.status !== "confirming")
  )
    return;

  // Build offers for initiator's perspective
  const initiatorOffer: TradeOfferView = {
    items: session.initiator.offeredItems,
    accepted: session.initiator.accepted,
  };
  const recipientOffer: TradeOfferView = {
    items: session.recipient.offeredItems,
    accepted: session.recipient.accepted,
  };

  // Calculate free slots for each player (OSRS-style indicator)
  const initiatorFreeSlots = calculateFreeSlots(
    world,
    session.initiator.playerId,
    session.initiator.offeredItems,
  );
  const recipientFreeSlots = calculateFreeSlots(
    world,
    session.recipient.playerId,
    session.recipient.offeredItems,
  );

  // Send to initiator (their offer = initiatorOffer, partner's offer = recipientOffer)
  // Partner free slots = recipient's free slots
  const initiatorSocket = getSocketByPlayerId(
    world,
    session.initiator.playerId,
  );
  if (initiatorSocket) {
    sendToSocket(initiatorSocket, "tradeUpdated", {
      tradeId,
      myOffer: initiatorOffer,
      theirOffer: recipientOffer,
      partnerFreeSlots: recipientFreeSlots,
    });
  }

  // Send to recipient (their offer = recipientOffer, partner's offer = initiatorOffer)
  // Partner free slots = initiator's free slots
  const recipientSocket = getSocketByPlayerId(
    world,
    session.recipient.playerId,
  );
  if (recipientSocket) {
    sendToSocket(recipientSocket, "tradeUpdated", {
      tradeId,
      myOffer: recipientOffer,
      theirOffer: initiatorOffer,
      partnerFreeSlots: initiatorFreeSlots,
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

/**
 * Calculate total value of trade offer items
 * Used for wealth transfer indicator
 */
function calculateOfferValue(items: TradeOfferView["items"]): number {
  let total = 0;
  for (const offer of items) {
    const itemDef = getItem(offer.itemId);
    if (itemDef) {
      // Use item's value (from item-types.ts) or default to 1
      const value = itemDef.value ?? 1;
      total += value * offer.quantity;
    }
  }
  return total;
}

/**
 * Calculate the number of free inventory slots for a player
 * Takes into account items currently being offered in trade (which will be freed)
 *
 * @param world - The game world
 * @param playerId - Player whose free slots to calculate
 * @param offeredItems - Items currently offered in trade (these slots will become free)
 * @returns Number of free inventory slots
 */
function calculateFreeSlots(
  world: World,
  playerId: string,
  offeredItems: TradeOfferItem[],
): number {
  // Get player's inventory from InventorySystem
  const inventorySystem = world.getSystem("inventory") as
    | {
        getInventoryData?: (playerId: string) =>
          | {
              items: Array<{ slotIndex: number } | null>;
              coins: number;
              maxSlots: number;
            }
          | undefined;
      }
    | undefined;

  if (!inventorySystem?.getInventoryData) {
    // If no inventory system or method, assume some free slots
    return 10;
  }

  const inventoryData = inventorySystem.getInventoryData(playerId);
  if (!inventoryData) {
    return 28; // No inventory = all slots free
  }

  const maxSlots = inventoryData.maxSlots || 28;

  // Count used slots (non-null entries with valid slotIndex)
  const usedSlots = new Set<number>();
  for (const item of inventoryData.items) {
    if (item !== null && typeof item.slotIndex === "number") {
      usedSlots.add(item.slotIndex);
    }
  }

  // Slots being freed by offered items
  const offeredSlots = new Set<number>();
  for (const offer of offeredItems) {
    offeredSlots.add(offer.inventorySlot);
  }

  // Calculate free slots: empty slots + slots that will be freed
  let freeCount = 0;
  for (let i = 0; i < maxSlots; i++) {
    if (!usedSlots.has(i) || offeredSlots.has(i)) {
      freeCount++;
    }
  }

  return freeCount;
}

/**
 * Send confirmation screen packet to both participants (OSRS two-screen flow)
 * Includes item values for wealth transfer indicator
 */
function sendTradeConfirmScreen(
  world: World,
  tradingSystem: TradingSystem,
  tradeId: string,
): void {
  const session = tradingSystem.getTradeSession(tradeId);
  if (!session || session.status !== "confirming") return;

  // Calculate offer values
  const initiatorValue = calculateOfferValue(session.initiator.offeredItems);
  const recipientValue = calculateOfferValue(session.recipient.offeredItems);

  // Send to initiator
  const initiatorSocket = getSocketByPlayerId(
    world,
    session.initiator.playerId,
  );
  if (initiatorSocket) {
    sendToSocket(initiatorSocket, "tradeConfirmScreen", {
      tradeId,
      myOffer: session.initiator.offeredItems,
      theirOffer: session.recipient.offeredItems,
      myOfferValue: initiatorValue,
      theirOfferValue: recipientValue,
    });
  }

  // Send to recipient
  const recipientSocket = getSocketByPlayerId(
    world,
    session.recipient.playerId,
  );
  if (recipientSocket) {
    sendToSocket(recipientSocket, "tradeConfirmScreen", {
      tradeId,
      myOffer: session.recipient.offeredItems,
      theirOffer: session.initiator.offeredItems,
      myOfferValue: recipientValue,
      theirOfferValue: initiatorValue,
    });
  }
}

// ============================================================================
// Packet Handlers
// ============================================================================

/**
 * Handle trade request from Player A to Player B
 *
 * OSRS-style behavior: If not in range, player walks up to target first
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

  // Interface blocking check - can't trade while using bank/store/dialogue
  if (hasActiveInterfaceSession(world, playerId)) {
    sendTradeError(
      socket,
      "You can't trade while using another interface",
      "INTERFACE_OPEN",
    );
    return;
  }

  if (hasActiveInterfaceSession(world, targetPlayerId)) {
    sendTradeError(socket, "That player is busy", "PLAYER_BUSY");
    return;
  }

  // Function to actually send the trade request (called when in range)
  const sendTradeRequestToTarget = (): void => {
    // Re-validate target is still online and available
    if (!tradingSystem.isPlayerOnline(targetPlayerId)) {
      sendTradeError(socket, "Player is not online", "PLAYER_OFFLINE");
      return;
    }

    if (hasActiveInterfaceSession(world, targetPlayerId)) {
      sendTradeError(socket, "That player is busy", "PLAYER_BUSY");
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

    // Send notification to target player as OSRS-style pink chat message
    const targetSocket = getSocketByPlayerId(world, targetPlayerId);
    if (targetSocket) {
      // Send trade request as a clickable chat message (OSRS-style)
      const chatMessage = {
        id: uuid(),
        from: "", // Empty string - no sender prefix for trade requests
        fromId: playerId,
        body: `${initiatorName} wishes to trade with you.`,
        text: `${initiatorName} wishes to trade with you.`,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        type: "trade_request" as const,
        tradeId: result.tradeId,
      };
      sendToSocket(targetSocket, "chatAdded", chatMessage);

      // Also send the structured trade request data for UI purposes
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
  };

  // Check if players are already in range
  if (arePlayersInTradeRange(world, playerId, targetPlayerId)) {
    // Already in range - send trade request immediately
    sendTradeRequestToTarget();
    return;
  }

  // Not in range - use PendingTradeManager to walk up to target first
  const pendingTradeManager = getPendingTradeManager(world);
  if (!pendingTradeManager) {
    // Fallback: just send error if manager unavailable
    sendTradeError(
      socket,
      "You need to be closer to trade with that player",
      "TOO_FAR",
    );
    return;
  }

  // Queue pending trade - player will walk up to target, then send request
  pendingTradeManager.queuePendingTrade(
    playerId,
    targetPlayerId,
    sendTradeRequestToTarget,
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

  // Calculate initial free slots for each player (OSRS-style indicator)
  // At trade start, no items are offered yet, so pass empty arrays
  const initiatorFreeSlots = calculateFreeSlots(
    world,
    session.initiator.playerId,
    [],
  );
  const recipientFreeSlots = calculateFreeSlots(world, playerId, []);

  // Send to initiator (partner = recipient)
  if (initiatorSocket) {
    sendToSocket(initiatorSocket, "tradeStarted", {
      tradeId: data.tradeId,
      partnerId: playerId,
      partnerName: recipientName,
      partnerLevel: recipientLevel,
      partnerFreeSlots: recipientFreeSlots,
    });
  }

  // Send to recipient (partner = initiator)
  sendToSocket(recipientSocket, "tradeStarted", {
    tradeId: data.tradeId,
    partnerId: session.initiator.playerId,
    partnerName: session.initiator.playerName,
    partnerLevel: initiatorLevel,
    partnerFreeSlots: initiatorFreeSlots,
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

  // Two-screen confirmation flow (OSRS-style):
  // 1. On offer screen: both accept → move to confirmation screen
  // 2. On confirmation screen: both accept → complete trade
  if (result.moveToConfirming) {
    // Move to confirmation screen
    const moveResult = tradingSystem.moveToConfirmation(data.tradeId);
    if (!moveResult.success) {
      sendTradeError(
        socket,
        moveResult.error!,
        moveResult.errorCode || "UNKNOWN",
      );
      return;
    }

    // Send confirmation screen packet to both players
    sendTradeConfirmScreen(world, tradingSystem, data.tradeId);
  } else if (result.bothAccepted) {
    // Both accepted on confirmation screen - complete the trade
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
  // Two-screen flow: status is "confirming" when both accept on confirmation screen
  if (session.status !== "active" && session.status !== "confirming") {
    console.error(
      "[TradeHandler] Session not in valid state for swap:",
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
          // Note: Direct iteration avoids intermediate array allocations from .map()
          const initiatorUsedSlots = new Set<number>();
          for (const item of initiatorInventory) {
            initiatorUsedSlots.add(item.slotIndex);
          }
          const recipientUsedSlots = new Set<number>();
          for (const item of recipientInventory) {
            recipientUsedSlots.add(item.slotIndex);
          }

          // Slots being freed by offered items
          const initiatorOfferSlots = new Set<number>();
          for (const offer of session.initiator.offeredItems) {
            initiatorOfferSlots.add(offer.inventorySlot);
          }
          const recipientOfferSlots = new Set<number>();
          for (const offer of session.recipient.offeredItems) {
            recipientOfferSlots.add(offer.inventorySlot);
          }

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
          // Note: Direct copy avoids spread operator allocation
          const recipientTrackingSlots = new Set<number>();
          for (const slot of recipientUsedSlots) {
            recipientTrackingSlots.add(slot);
          }
          const initiatorTrackingSlots = new Set<number>();
          for (const slot of initiatorUsedSlots) {
            initiatorTrackingSlots.add(slot);
          }

          // ===== PHASE 1: Remove/reduce ALL offered items from BOTH players first =====
          // This must happen before inserts to avoid unique constraint violations

          // Remove initiator's offered items
          for (const offer of session.initiator.offeredItems) {
            const item = initiatorInventory.find(
              (i) => i.slotIndex === offer.inventorySlot,
            )!;
            if (item.quantity === offer.quantity) {
              await tx.execute(
                sql`DELETE FROM inventory
                    WHERE "playerId" = ${initiatorId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
              initiatorTrackingSlots.delete(offer.inventorySlot);
            } else {
              await tx.execute(
                sql`UPDATE inventory
                    SET quantity = ${item.quantity - offer.quantity}
                    WHERE "playerId" = ${initiatorId}
                    AND "slotIndex" = ${offer.inventorySlot}`,
              );
            }
          }

          // Remove recipient's offered items
          for (const offer of session.recipient.offeredItems) {
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
          }

          // ===== PHASE 2: Add traded items to both players =====
          // Now slots are actually free in the database

          // Add initiator's items to recipient
          for (const offer of session.initiator.offeredItems) {
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

          // Add recipient's items to initiator
          for (const offer of session.recipient.offeredItems) {
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

    // Send inventory updates directly to each player (with full data)
    // Use INVENTORY_REQUEST event which properly fetches and sends full inventory
    world.emit(EventType.INVENTORY_REQUEST, { playerId: initiatorId });
    world.emit(EventType.INVENTORY_REQUEST, { playerId: recipientId });
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
