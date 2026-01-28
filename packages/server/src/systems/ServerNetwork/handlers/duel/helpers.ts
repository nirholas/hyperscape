/**
 * Duel Handler Helpers
 *
 * Shared utilities for duel packet handlers.
 * IMPORTANT: This module imports common utilities from ../common to ensure
 * consistent socket handling patterns across all handlers.
 */

import {
  type World,
  ALL_WORLD_AREAS,
  isPositionInsideCombatArena,
  getDuelArenaConfig,
} from "@hyperscape/shared";
import type { ServerSocket } from "../../../../shared/types";
import type { DuelSystem } from "../../../DuelSystem";
import type { PendingDuelChallengeManager } from "../../PendingDuelChallengeManager";
import { Logger, RateLimitService } from "../../services";
import { sendToSocket, getPlayerId } from "../common";

// ============================================================================
// Rate Limiter
// ============================================================================

/** Single rate limiter instance shared across all duel modules */
export const rateLimiter = new RateLimitService();

// ============================================================================
// System Getters
// ============================================================================

/**
 * Get DuelSystem from world
 */
export function getDuelSystem(world: World): DuelSystem | undefined {
  const worldWithDuel = world as { duelSystem?: DuelSystem };
  return worldWithDuel.duelSystem;
}

/**
 * Get PendingDuelChallengeManager from world
 */
export function getPendingDuelChallengeManager(
  world: World,
): PendingDuelChallengeManager | undefined {
  const worldWithPending = world as {
    pendingDuelChallengeManager?: PendingDuelChallengeManager;
  };
  return worldWithPending.pendingDuelChallengeManager;
}

// ============================================================================
// Player Utilities
// ============================================================================

/**
 * Get player name from world
 * Delegates to World.getPlayerDisplayName (Law of Demeter)
 */
export function getPlayerName(world: World, playerId: string): string {
  return world.getPlayerDisplayName(playerId);
}

/**
 * Get player combat level from world
 * Delegates to World.getPlayerCombatLevel (Law of Demeter)
 */
export function getPlayerCombatLevel(world: World, playerId: string): number {
  return world.getPlayerCombatLevel(playerId);
}

/**
 * Check if player is online
 */
export function isPlayerOnline(world: World, playerId: string): boolean {
  return world.entities.players?.has(playerId) ?? false;
}

/**
 * Get socket by player ID
 * Delegates to World.getPlayerSocket (Law of Demeter)
 */
export function getSocketByPlayerId(
  world: World,
  playerId: string,
): ServerSocket | undefined {
  return world.getPlayerSocket(playerId) as ServerSocket | undefined;
}

// ============================================================================
// Response Utilities
// ============================================================================

/**
 * Send duel error to socket
 */
export function sendDuelError(
  socket: ServerSocket,
  message: string,
  code: string,
): void {
  sendToSocket(socket, "duelError", { message, code });
}

/**
 * Send success toast to socket
 */
export function sendSuccessToast(socket: ServerSocket, message: string): void {
  sendToSocket(socket, "showToast", { type: "success", message });
}

// Re-export common utilities for convenience
export { sendToSocket, getPlayerId } from "../common";

// ============================================================================
// Zone Utilities
// ============================================================================

/**
 * Check if player is in Duel Arena zone
 * Uses ALL_WORLD_AREAS directly since zone detection system may not be available on server
 */
export function isInDuelArenaZone(world: World, playerId: string): boolean {
  const player = world.entities.players?.get(playerId);
  if (!player?.position) {
    Logger.debug("DuelZone", "No player or position found", { playerId });
    return false;
  }

  const { x, z } = player.position;

  // Get duel_arena bounds from ALL_WORLD_AREAS
  const duelArena = ALL_WORLD_AREAS["duel_arena"];
  if (!duelArena?.bounds) {
    Logger.warn("DuelZone", "duel_arena not found in ALL_WORLD_AREAS");
    return false;
  }

  const { minX, maxX, minZ, maxZ } = duelArena.bounds;
  const inBounds = x >= minX && x <= maxX && z >= minZ && z <= maxZ;

  Logger.debug("DuelZone", "Zone check result", {
    playerId,
    position: { x, z },
    bounds: { minX, maxX, minZ, maxZ },
    inBounds,
  });

  return inBounds;
}

/**
 * Check if player is inside a combat arena (not the lobby)
 * Uses manifest-driven config via isPositionInsideCombatArena()
 */
export function isInsideCombatArena(world: World, playerId: string): boolean {
  const player = world.entities.players?.get(playerId);
  if (!player?.position) return false;

  return isPositionInsideCombatArena(player.position.x, player.position.z);
}

/**
 * Check if player is in the Duel Arena lobby (can challenge)
 * Must be in duel arena zone but NOT inside a combat arena
 */
export function isInDuelArenaLobby(world: World, playerId: string): boolean {
  return (
    isInDuelArenaZone(world, playerId) && !isInsideCombatArena(world, playerId)
  );
}

/**
 * Check if two players are within challenge range (15 tiles)
 * Used for visibility/clickability range
 */
export function arePlayersInChallengeRange(
  world: World,
  player1Id: string,
  player2Id: string,
): boolean {
  const player1 = world.entities.players?.get(player1Id);
  const player2 = world.entities.players?.get(player2Id);

  if (!player1?.position || !player2?.position) return false;

  const dx = Math.abs(player1.position.x - player2.position.x);
  const dz = Math.abs(player1.position.z - player2.position.z);
  const distance = Math.max(dx, dz); // Chebyshev distance

  return distance <= 15;
}

/**
 * Check if two players are adjacent (1 tile range)
 * Used for actual challenge delivery (after walking to player)
 */
export function arePlayersAdjacent(
  world: World,
  player1Id: string,
  player2Id: string,
): boolean {
  const player1 = world.entities.players?.get(player1Id);
  const player2 = world.entities.players?.get(player2Id);

  if (!player1?.position || !player2?.position) return false;

  const dx = Math.abs(player1.position.x - player2.position.x);
  const dz = Math.abs(player1.position.z - player2.position.z);
  const distance = Math.max(dx, dz); // Chebyshev distance

  return distance <= 1;
}
