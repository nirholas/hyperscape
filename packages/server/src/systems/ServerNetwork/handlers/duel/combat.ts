/**
 * Duel Combat Handlers
 *
 * Handles combat-related duel actions:
 * - handleDuelForfeit: Player forfeits the duel (loses, opponent wins)
 */

import type { World } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import {
  getDuelSystem,
  sendDuelError,
  sendToSocket,
  getPlayerId,
  getSocketByPlayerId,
} from "./helpers";

// ============================================================================
// Forfeit Handler
// ============================================================================

/**
 * Handle a player forfeiting the duel
 *
 * Validation:
 * - Player must be in an active duel (FIGHTING state)
 * - noForfeit rule must NOT be active
 *
 * On success:
 * - Forfeiting player loses
 * - Opponent wins and receives all stakes
 * - Forfeit is NOT recorded on scoreboard (only deaths count)
 */
export function handleDuelForfeit(
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

  const result = duelSystem.forfeitDuel(playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // The duel resolution is handled by DuelSystem.resolveDuel()
  // which emits duel:completed event - no additional action needed here
}
