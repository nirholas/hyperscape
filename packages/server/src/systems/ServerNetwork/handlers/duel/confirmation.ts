/**
 * Duel Confirmation Handlers
 *
 * Handles the final confirmation screen before duel combat begins:
 * - handleDuelAcceptFinal: Accept final confirmation and start duel
 *
 * When both players accept, an arena is reserved and countdown begins.
 */

import type { World } from "@hyperscape/shared";
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
// Accept Final Handler
// ============================================================================

/**
 * Handle final confirmation acceptance
 *
 * When both players accept:
 * 1. Reserve an arena from the pool
 * 2. Transition to COUNTDOWN state
 * 3. Notify both players to begin teleportation/countdown
 */
export function handleDuelAcceptFinal(
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

  const result = duelSystem.acceptFinal(duelId, playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // Get session to send updates to both players
  const session = duelSystem.getDuelSession(duelId);
  if (!session) return;

  // Check if we moved to countdown (both accepted)
  const startedCountdown = session.state === "COUNTDOWN";

  if (startedCountdown) {
    // Both players confirmed - send countdown start to both
    const countdownPayload = {
      duelId,
      state: "COUNTDOWN",
      arenaId: session.arenaId,
      challengerId: session.challengerId,
      targetId: session.targetId,
    };

    sendToSocket(socket, "duelCountdownStart", countdownPayload);

    const opponentId =
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const opponentSocket = getSocketByPlayerId(world, opponentId);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelCountdownStart", countdownPayload);
    }
  } else {
    // Just one player accepted - send acceptance update
    const updatePayload = {
      duelId,
      challengerAccepted: session.challengerAccepted,
      targetAccepted: session.targetAccepted,
    };

    sendToSocket(socket, "duelAcceptanceUpdated", updatePayload);

    const opponentId =
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const opponentSocket = getSocketByPlayerId(world, opponentId);
    if (opponentSocket) {
      sendToSocket(opponentSocket, "duelAcceptanceUpdated", updatePayload);
    }
  }
}
