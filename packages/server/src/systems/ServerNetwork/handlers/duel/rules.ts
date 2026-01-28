/**
 * Duel Rules Handlers
 *
 * Handles duel rules negotiation:
 * - handleDuelToggleRule: Toggle a rule on/off
 * - handleDuelToggleEquipment: Toggle equipment slot restriction
 * - handleDuelAcceptRules: Accept current rules configuration
 */

import type { World, DuelRules, EquipmentSlot } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import {
  getDuelSystem,
  sendDuelError,
  sendToSocket,
  getPlayerId,
  getSocketByPlayerId,
  rateLimiter,
} from "./helpers";

// ============================================================================
// Toggle Rule Handler
// ============================================================================

/**
 * Handle toggling a duel rule
 */
export function handleDuelToggleRule(
  socket: ServerSocket,
  data: { duelId: string; rule: keyof DuelRules },
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

  const { duelId, rule } = data;

  // Validate rule is a valid DuelRules key
  const validRules: Array<keyof DuelRules> = [
    "noRanged",
    "noMelee",
    "noMagic",
    "noSpecialAttack",
    "noPrayer",
    "noPotions",
    "noFood",
    "noForfeit",
    "noMovement",
    "funWeapons",
  ];

  if (!validRules.includes(rule)) {
    sendDuelError(socket, "Invalid rule", "INVALID_RULE");
    return;
  }

  const result = duelSystem.toggleRule(duelId, playerId, rule);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Notify both players of the rule change
  const updatePayload = {
    duelId,
    rules: session.rules,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    modifiedBy: playerId,
  };

  sendToSocket(socket, "duelRulesUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelRulesUpdated", updatePayload);
  }
}

// ============================================================================
// Toggle Equipment Handler
// ============================================================================

/**
 * Handle toggling equipment slot restriction
 */
export function handleDuelToggleEquipment(
  socket: ServerSocket,
  data: { duelId: string; slot: EquipmentSlot },
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

  const { duelId, slot } = data;

  // Validate slot is a valid equipment slot
  const validSlots: EquipmentSlot[] = [
    "head",
    "cape",
    "amulet",
    "weapon",
    "body",
    "shield",
    "legs",
    "gloves",
    "boots",
    "ring",
    "ammo",
  ];

  if (!validSlots.includes(slot)) {
    sendDuelError(socket, "Invalid equipment slot", "INVALID_SLOT");
    return;
  }

  const result = duelSystem.toggleEquipmentRestriction(duelId, playerId, slot);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Notify both players of the equipment change
  const updatePayload = {
    duelId,
    equipmentRestrictions: session.equipmentRestrictions,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    modifiedBy: playerId,
  };

  sendToSocket(socket, "duelEquipmentUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelEquipmentUpdated", updatePayload);
  }
}

// ============================================================================
// Accept Rules Handler
// ============================================================================

/**
 * Handle accepting current rules configuration
 */
export function handleDuelAcceptRules(
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

  const result = duelSystem.acceptRules(duelId, playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Check if both players accepted and we moved to STAKES
  const movedToStakes = session.state === "STAKES";

  // Notify both players
  const updatePayload = {
    duelId,
    challengerAccepted: session.challengerAccepted,
    targetAccepted: session.targetAccepted,
    state: session.state,
    movedToStakes,
  };

  sendToSocket(socket, "duelAcceptanceUpdated", updatePayload);

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;
  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelAcceptanceUpdated", updatePayload);
  }

  // If moved to stakes screen, send state change notification
  if (movedToStakes) {
    const statePayload = {
      duelId,
      state: "STAKES",
      rules: session.rules,
      equipmentRestrictions: session.equipmentRestrictions,
    };

    sendToSocket(socket, "duelStateChanged", statePayload);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelStateChanged", statePayload);
    }
  }
}

// ============================================================================
// Cancel Duel Handler
// ============================================================================

/**
 * Handle canceling a duel session
 */
export function handleDuelCancel(
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

  // Get session before canceling to notify opponent
  const session = duelSystem.getDuelSession(duelId);
  if (!session) {
    sendDuelError(socket, "Duel not found", "DUEL_NOT_FOUND");
    return;
  }

  // Verify player is in this duel
  if (playerId !== session.challengerId && playerId !== session.targetId) {
    sendDuelError(socket, "You're not in this duel", "NOT_PARTICIPANT");
    return;
  }

  const opponentId =
    playerId === session.challengerId ? session.targetId : session.challengerId;

  const result = duelSystem.cancelDuel(duelId, "player_cancelled", playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Notify both players
  const cancelPayload = {
    duelId,
    reason: "player_cancelled",
    cancelledBy: playerId,
  };

  sendToSocket(socket, "duelCancelled", cancelPayload);

  const opponentSocket = getSocketByPlayerId(world, opponentId);
  if (opponentSocket) {
    sendToSocket(opponentSocket, "duelCancelled", cancelPayload);
  }
}
