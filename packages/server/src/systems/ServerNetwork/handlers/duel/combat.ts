/**
 * Duel Combat Handlers
 *
 * Handles combat-related duel actions:
 * - handleDuelForfeit: Player forfeits the duel (loses, opponent wins)
 */

import type { World } from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import { sendDuelError, withDuelAuth } from "./helpers";

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
  const auth = withDuelAuth(socket, world);
  if (!auth) return;
  const { duelSystem } = auth;

  const result = duelSystem.forfeitDuel(auth.playerId);

  if (!result.success) {
    sendDuelError(socket, result.error!, result.errorCode || "UNKNOWN");
    return;
  }

  // The duel resolution is handled by DuelSystem.resolveDuel()
  // which emits duel:completed event - no additional action needed here
}
