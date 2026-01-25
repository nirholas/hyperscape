/**
 * TradingSystem - Server-authoritative player-to-player trading
 *
 * Manages trade sessions between players with full validation,
 * atomic item swaps, and proper cleanup on disconnection.
 *
 * Trade Flow:
 * 1. Player A requests trade with Player B
 * 2. Player B receives request notification
 * 3. Player B accepts/declines
 * 4. If accepted, trade window opens for both
 * 5. Players add/remove items from their offers
 * 6. Both players must accept the final offer
 * 7. Server atomically swaps items between inventories
 *
 * Security:
 * - All operations are server-authoritative
 * - Inventory locks prevent race conditions
 * - Items are validated at every step
 * - Atomic database transactions prevent item duplication
 *
 * @see packages/shared/src/types/game/trade-types.ts for type definitions
 */

import { v4 as uuidv4 } from "uuid";
import type { World } from "@hyperscape/shared";
import {
  EventType,
  TRADE_CONSTANTS,
  type TradeSession,
  type TradeParticipant,
  type TradeOfferItem,
  type TradeCancelReason,
  type PlayerID,
  createPlayerID,
  createItemID,
  createSlotNumber,
  isValidPlayerID,
  isValidSlotNumber,
} from "@hyperscape/shared";

// ============================================================================
// Types
// ============================================================================

/**
 * Active trade lookup - maps playerId to their current trade session ID
 */
type PlayerTradeMap = Map<PlayerID, string>;

/**
 * All active trade sessions
 */
type TradeSessionMap = Map<string, TradeSession>;

/**
 * Rate limiting for trade requests per player
 */
type RequestCooldowns = Map<string, number>; // `${fromPlayerId}:${toPlayerId}` -> lastRequestTime

/**
 * Result of a trade operation
 */
type TradeOperationResult = {
  success: boolean;
  error?: string;
  errorCode?: string;
};

// ============================================================================
// TradingSystem Class
// ============================================================================

export class TradingSystem {
  private readonly world: World;

  /** All active trade sessions by ID */
  private tradeSessions: TradeSessionMap = new Map();

  /** Player ID to their active trade session ID */
  private playerTrades: PlayerTradeMap = new Map();

  /** Rate limiting for trade requests */
  private requestCooldowns: RequestCooldowns = new Map();

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Initialize the trading system
   */
  init(): void {
    // Start periodic cleanup of expired trades
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTrades();
    }, 10_000); // Check every 10 seconds

    // Subscribe to player disconnect events to clean up trades
    this.world.on(EventType.PLAYER_LEFT, (payload: unknown) => {
      const data = payload as { playerId: string };
      this.handlePlayerDisconnect(data.playerId);
    });

    this.world.on(EventType.PLAYER_LOGOUT, (payload: unknown) => {
      const data = payload as { playerId: string };
      this.handlePlayerDisconnect(data.playerId);
    });

    // Subscribe to player death to cancel active trades
    this.world.on(EventType.PLAYER_DIED, (payload: unknown) => {
      const data = payload as { playerId: string };
      const tradeId = this.getPlayerTradeId(data.playerId);
      if (tradeId) {
        this.cancelTrade(tradeId, "player_died");
      }
    });
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Cancel all active trades
    for (const [tradeId] of this.tradeSessions) {
      this.cancelTrade(tradeId, "server_error");
    }

    this.tradeSessions.clear();
    this.playerTrades.clear();
    this.requestCooldowns.clear();
  }

  // ============================================================================
  // Public API - Trade Lifecycle
  // ============================================================================

  /**
   * Create a new trade request from initiator to recipient
   */
  createTradeRequest(
    initiatorId: string,
    initiatorName: string,
    initiatorSocketId: string,
    recipientId: string,
  ): TradeOperationResult & { tradeId?: string } {
    // Validate player IDs
    if (!isValidPlayerID(initiatorId) || !isValidPlayerID(recipientId)) {
      return {
        success: false,
        error: "Invalid player ID",
        errorCode: "INVALID_PLAYER",
      };
    }

    // Check for self-trade
    if (initiatorId === recipientId) {
      return {
        success: false,
        error: "You can't trade with yourself",
        errorCode: "SELF_TRADE",
      };
    }

    // Check if initiator is already in a trade
    if (this.isPlayerInTrade(initiatorId)) {
      return {
        success: false,
        error: "You're already in a trade",
        errorCode: "ALREADY_IN_TRADE",
      };
    }

    // Check if recipient is already in a trade
    if (this.isPlayerInTrade(recipientId)) {
      return {
        success: false,
        error: "That player is busy",
        errorCode: "PLAYER_BUSY",
      };
    }

    // Check cooldown for requests to this specific player
    const cooldownKey = `${initiatorId}:${recipientId}`;
    const lastRequest = this.requestCooldowns.get(cooldownKey);
    const now = Date.now();
    if (
      lastRequest &&
      now - lastRequest < TRADE_CONSTANTS.REQUEST_COOLDOWN_MS
    ) {
      return {
        success: false,
        error: "Please wait before requesting again",
        errorCode: "RATE_LIMITED",
      };
    }

    // Create the trade session
    const tradeId = uuidv4();
    const session: TradeSession = {
      id: tradeId,
      status: "pending",
      initiator: {
        playerId: createPlayerID(initiatorId),
        playerName: initiatorName,
        socketId: initiatorSocketId,
        offeredItems: [],
        accepted: false,
      },
      recipient: {
        playerId: createPlayerID(recipientId),
        playerName: "", // Will be filled when recipient responds
        socketId: "", // Will be filled when recipient responds
        offeredItems: [],
        accepted: false,
      },
      createdAt: now,
      expiresAt: now + TRADE_CONSTANTS.REQUEST_TIMEOUT_MS,
      lastActivityAt: now,
    };

    // Store the session
    this.tradeSessions.set(tradeId, session);
    this.playerTrades.set(createPlayerID(initiatorId), tradeId);

    // Update cooldown
    this.requestCooldowns.set(cooldownKey, now);

    return { success: true, tradeId };
  }

  /**
   * Respond to an incoming trade request
   */
  respondToTradeRequest(
    tradeId: string,
    recipientId: string,
    recipientName: string,
    recipientSocketId: string,
    accept: boolean,
  ): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    // Validate session exists and is pending
    if (!session) {
      return {
        success: false,
        error: "Trade request expired",
        errorCode: "INVALID_TRADE",
      };
    }

    if (session.status !== "pending") {
      return {
        success: false,
        error: "Trade is no longer available",
        errorCode: "INVALID_TRADE",
      };
    }

    // Verify this is the correct recipient
    if (session.recipient.playerId !== recipientId) {
      return {
        success: false,
        error: "Trade request not for you",
        errorCode: "INVALID_TRADE",
      };
    }

    // Check if trade expired
    if (Date.now() > session.expiresAt) {
      this.cancelTrade(tradeId, "timeout");
      return {
        success: false,
        error: "Trade request expired",
        errorCode: "INVALID_TRADE",
      };
    }

    if (!accept) {
      // Recipient declined
      this.cancelTrade(tradeId, "declined");
      return { success: true };
    }

    // Check if recipient is now in another trade
    if (this.isPlayerInTrade(recipientId)) {
      this.cancelTrade(tradeId, "cancelled");
      return {
        success: false,
        error: "You're already in a trade",
        errorCode: "ALREADY_IN_TRADE",
      };
    }

    // Accept the trade - update session
    session.status = "active";
    session.recipient.playerName = recipientName;
    session.recipient.socketId = recipientSocketId;
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    // Map recipient to this trade
    this.playerTrades.set(createPlayerID(recipientId), tradeId);

    // Emit trade started event for activity logging
    this.world.emit(EventType.TRADE_STARTED, {
      tradeId,
      initiatorId: session.initiator.playerId,
      recipientId: session.recipient.playerId,
    });

    return { success: true };
  }

  /**
   * Add an item to a player's trade offer
   */
  addItemToTrade(
    tradeId: string,
    playerId: string,
    inventorySlot: number,
    itemId: string,
    quantity: number,
  ): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    if (!session || session.status !== "active") {
      return {
        success: false,
        error: "Not in an active trade",
        errorCode: "NOT_IN_TRADE",
      };
    }

    const participant = this.getParticipant(session, playerId);
    if (!participant) {
      return {
        success: false,
        error: "Not a participant in this trade",
        errorCode: "INVALID_TRADE",
      };
    }

    // Validate slot number
    if (
      !isValidSlotNumber(inventorySlot) ||
      inventorySlot < 0 ||
      inventorySlot > 27
    ) {
      return {
        success: false,
        error: "Invalid inventory slot",
        errorCode: "INVALID_SLOT",
      };
    }

    // Validate quantity
    if (quantity <= 0) {
      return {
        success: false,
        error: "Invalid quantity",
        errorCode: "INVALID_QUANTITY",
      };
    }

    // Note: Item existence validation is done in the network handler layer
    // which checks the player's actual inventory. TradingSystem trusts
    // that handlers have validated items before adding them.

    // Check if this slot is already in the trade offer
    const existingIndex = participant.offeredItems.findIndex(
      (item) => item.inventorySlot === inventorySlot,
    );

    if (existingIndex >= 0) {
      // Update quantity for existing slot
      participant.offeredItems[existingIndex].quantity = quantity;
    } else {
      // Check trade slot limit
      if (participant.offeredItems.length >= TRADE_CONSTANTS.MAX_TRADE_SLOTS) {
        return {
          success: false,
          error: "Trade offer is full",
          errorCode: "INVENTORY_FULL",
        };
      }

      // Find next available trade slot
      const usedSlots = new Set(
        participant.offeredItems.map((i) => i.tradeSlot),
      );
      let tradeSlot = 0;
      while (
        usedSlots.has(tradeSlot) &&
        tradeSlot < TRADE_CONSTANTS.MAX_TRADE_SLOTS
      ) {
        tradeSlot++;
      }

      // Add new item
      participant.offeredItems.push({
        inventorySlot: createSlotNumber(inventorySlot),
        itemId: createItemID(itemId),
        quantity,
        tradeSlot,
      });
    }

    // Reset acceptance flags when offer changes
    this.resetAcceptance(session);

    // Update activity timestamp
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    return { success: true };
  }

  /**
   * Remove an item from a player's trade offer
   */
  removeItemFromTrade(
    tradeId: string,
    playerId: string,
    tradeSlot: number,
  ): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    if (!session || session.status !== "active") {
      return {
        success: false,
        error: "Not in an active trade",
        errorCode: "NOT_IN_TRADE",
      };
    }

    const participant = this.getParticipant(session, playerId);
    if (!participant) {
      return {
        success: false,
        error: "Not a participant in this trade",
        errorCode: "INVALID_TRADE",
      };
    }

    // Find and remove the item
    const itemIndex = participant.offeredItems.findIndex(
      (item) => item.tradeSlot === tradeSlot,
    );

    if (itemIndex < 0) {
      return {
        success: false,
        error: "Item not found in trade",
        errorCode: "INVALID_SLOT",
      };
    }

    participant.offeredItems.splice(itemIndex, 1);

    // Reset acceptance flags when offer changes
    this.resetAcceptance(session);

    // Update activity timestamp
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    return { success: true };
  }

  /**
   * Set acceptance state for a player
   *
   * Two-screen confirmation flow (OSRS-style):
   * 1. On "active" (offer screen): both accept → moveToConfirming: true
   * 2. On "confirming" (confirmation screen): both accept → bothAccepted: true
   */
  setAcceptance(
    tradeId: string,
    playerId: string,
    accepted: boolean,
  ): TradeOperationResult & {
    bothAccepted?: boolean;
    moveToConfirming?: boolean;
  } {
    const session = this.tradeSessions.get(tradeId);

    // Allow acceptance on both "active" and "confirming" screens
    if (
      !session ||
      (session.status !== "active" && session.status !== "confirming")
    ) {
      return {
        success: false,
        error: "Not in an active trade",
        errorCode: "NOT_IN_TRADE",
      };
    }

    const participant = this.getParticipant(session, playerId);
    if (!participant) {
      return {
        success: false,
        error: "Not a participant in this trade",
        errorCode: "INVALID_TRADE",
      };
    }

    participant.accepted = accepted;

    // Update activity timestamp
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    // Check if both players have accepted
    const bothAccepted =
      session.initiator.accepted && session.recipient.accepted;

    // Two-screen flow:
    // - On offer screen (active): both accept → transition to confirmation screen
    // - On confirmation screen (confirming): both accept → complete trade
    if (bothAccepted && session.status === "active") {
      return { success: true, moveToConfirming: true };
    }

    if (bothAccepted && session.status === "confirming") {
      return { success: true, bothAccepted: true };
    }

    return { success: true };
  }

  /**
   * Move trade to confirmation screen (OSRS two-screen flow)
   * Resets acceptance for both players
   */
  moveToConfirmation(tradeId: string): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    if (!session || session.status !== "active") {
      return {
        success: false,
        error: "Trade is not active",
        errorCode: "INVALID_TRADE",
      };
    }

    // Transition to confirming status
    session.status = "confirming";

    // Reset acceptance for both players - they must accept again on confirmation screen
    session.initiator.accepted = false;
    session.recipient.accepted = false;

    // Update activity timestamp
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    return { success: true };
  }

  /**
   * Return to offer screen from confirmation screen (if player wants to modify)
   * Resets acceptance for both players
   */
  returnToOfferScreen(tradeId: string): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    if (!session || session.status !== "confirming") {
      return {
        success: false,
        error: "Trade is not in confirmation",
        errorCode: "INVALID_TRADE",
      };
    }

    // Transition back to active status
    session.status = "active";

    // Reset acceptance for both players
    session.initiator.accepted = false;
    session.recipient.accepted = false;

    // Update activity timestamp
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + TRADE_CONSTANTS.ACTIVITY_TIMEOUT_MS;

    return { success: true };
  }

  /**
   * Complete a trade - swap items between players
   * Returns the items each player receives (for database operations)
   *
   * Note: Trade must be in "confirming" status (OSRS two-screen flow)
   */
  completeTrade(tradeId: string): TradeOperationResult & {
    initiatorReceives?: TradeOfferItem[];
    recipientReceives?: TradeOfferItem[];
    initiatorId?: string;
    recipientId?: string;
  } {
    const session = this.tradeSessions.get(tradeId);

    if (!session || session.status !== "confirming") {
      return {
        success: false,
        error: "Trade is not in confirmation",
        errorCode: "INVALID_TRADE",
      };
    }

    // Verify both players have accepted
    if (!session.initiator.accepted || !session.recipient.accepted) {
      return {
        success: false,
        error: "Both players must accept",
        errorCode: "NOT_ACCEPTED",
      };
    }

    // Mark as completed
    session.status = "completed";

    // Extract what each player receives (the other's offer)
    const initiatorReceives = [...session.recipient.offeredItems];
    const recipientReceives = [...session.initiator.offeredItems];

    // Emit trade completed event for activity logging (before cleanup)
    this.world.emit(EventType.TRADE_COMPLETED, {
      tradeId,
      initiatorId: session.initiator.playerId,
      recipientId: session.recipient.playerId,
      // What each player gave (for audit trail)
      initiatorItems: recipientReceives.map((i) => ({
        itemId: i.itemId,
        quantity: i.quantity,
      })),
      recipientItems: initiatorReceives.map((i) => ({
        itemId: i.itemId,
        quantity: i.quantity,
      })),
    });

    // Clean up
    this.cleanupTrade(tradeId);

    return {
      success: true,
      initiatorReceives,
      recipientReceives,
      initiatorId: session.initiator.playerId,
      recipientId: session.recipient.playerId,
    };
  }

  /**
   * Cancel a trade session
   * @param cancelledBy - Optional playerId of who initiated the cancellation (for audit)
   */
  cancelTrade(
    tradeId: string,
    reason: TradeCancelReason,
    cancelledBy?: string,
  ): TradeOperationResult {
    const session = this.tradeSessions.get(tradeId);

    if (!session) {
      return {
        success: false,
        error: "Trade not found",
        errorCode: "INVALID_TRADE",
      };
    }

    // Mark as cancelled
    session.status = "cancelled";

    // Emit cancellation event
    this.world.emit(EventType.TRADE_CANCELLED, {
      tradeId,
      reason,
      initiatorId: session.initiator.playerId,
      recipientId: session.recipient.playerId,
      initiatorSocketId: session.initiator.socketId,
      recipientSocketId: session.recipient.socketId,
      cancelledBy,
    });

    // Clean up
    this.cleanupTrade(tradeId);

    return { success: true };
  }

  // ============================================================================
  // Public API - Queries
  // ============================================================================

  /**
   * Get a trade session by ID
   */
  getTradeSession(tradeId: string): TradeSession | undefined {
    return this.tradeSessions.get(tradeId);
  }

  /**
   * Get a player's current trade session
   */
  getPlayerTrade(playerId: string): TradeSession | undefined {
    const tradeId = this.playerTrades.get(createPlayerID(playerId));
    if (!tradeId) return undefined;
    return this.tradeSessions.get(tradeId);
  }

  /**
   * Get a player's current trade session ID
   */
  getPlayerTradeId(playerId: string): string | undefined {
    return this.playerTrades.get(createPlayerID(playerId));
  }

  /**
   * Check if a player is currently in a trade
   */
  isPlayerInTrade(playerId: string): boolean {
    return this.playerTrades.has(createPlayerID(playerId));
  }

  /**
   * Get the partner in a trade for a given player
   */
  getTradePartner(playerId: string): TradeParticipant | undefined {
    const session = this.getPlayerTrade(playerId);
    if (!session) return undefined;

    if (session.initiator.playerId === playerId) {
      return session.recipient;
    }
    return session.initiator;
  }

  /**
   * Check if a player is online (has an active socket)
   * This is used to validate trade requests
   */
  isPlayerOnline(playerId: string): boolean {
    // We'll check if the player has any active entities
    const player = this.world.entities?.players?.get(playerId);
    return player !== undefined;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get the participant object for a player in a session
   */
  private getParticipant(
    session: TradeSession,
    playerId: string,
  ): TradeParticipant | undefined {
    if (session.initiator.playerId === playerId) {
      return session.initiator;
    }
    if (session.recipient.playerId === playerId) {
      return session.recipient;
    }
    return undefined;
  }

  /**
   * Reset acceptance flags for both participants
   */
  private resetAcceptance(session: TradeSession): void {
    session.initiator.accepted = false;
    session.recipient.accepted = false;
  }

  /**
   * Clean up a trade session
   */
  private cleanupTrade(tradeId: string): void {
    const session = this.tradeSessions.get(tradeId);
    if (!session) return;

    // Remove player mappings
    this.playerTrades.delete(session.initiator.playerId);
    if (session.recipient.playerId) {
      this.playerTrades.delete(session.recipient.playerId);
    }

    // Remove session
    this.tradeSessions.delete(tradeId);
  }

  /**
   * Handle player disconnect - cancel their active trade
   */
  private handlePlayerDisconnect(playerId: string): void {
    const tradeId = this.getPlayerTradeId(playerId);
    if (tradeId) {
      this.cancelTrade(tradeId, "disconnected");
    }
  }

  /**
   * Clean up expired trades
   */
  private cleanupExpiredTrades(): void {
    const now = Date.now();

    for (const [tradeId, session] of this.tradeSessions) {
      if (now > session.expiresAt) {
        const reason: TradeCancelReason =
          session.status === "pending" ? "timeout" : "cancelled";
        this.cancelTrade(tradeId, reason);
      }
    }

    // Clean up old cooldown entries (older than 1 minute)
    const cooldownCutoff = now - 60_000;
    for (const [key, timestamp] of this.requestCooldowns) {
      if (timestamp < cooldownCutoff) {
        this.requestCooldowns.delete(key);
      }
    }
  }
}
