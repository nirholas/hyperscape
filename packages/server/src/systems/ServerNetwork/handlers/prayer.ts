/**
 * Prayer Handler
 *
 * Handles prayer-related actions from clients.
 * Uses shared security infrastructure:
 * - SlidingWindowRateLimiter for rate limiting
 * - Type guards from prayer-types for validation
 * - Timestamp validation for replay attack prevention
 *
 * Security measures:
 * - Input validation (prayer ID format, length)
 * - Rate limiting (5 requests/sec - matches PRAYER_TOGGLE_RATE_LIMIT)
 * - Timestamp validation (prevents replay attacks)
 * - Server-side prayer existence verification via PrayerDataProvider
 */

import type { ServerSocket } from "../../../shared/types";
import {
  EventType,
  World,
  isValidPrayerId,
  isValidPrayerTogglePayload,
} from "@hyperscape/shared";
import { validateRequestTimestamp } from "../services/InputValidation";
import { getPrayerRateLimiter } from "../services/SlidingWindowRateLimiter";

/**
 * Send error feedback to client
 */
function sendPrayerError(socket: ServerSocket, reason: string): void {
  if (socket.send) {
    socket.send("showToast", {
      message: reason,
      type: "error",
    });
  }
}

/**
 * Handle prayer toggle request from client
 * Validates input before forwarding to PrayerSystem
 *
 * @param socket - Client socket with player entity
 * @param data - Toggle request payload { prayerId: string }
 * @param world - Game world instance
 */
export function handlePrayerToggle(
  socket: ServerSocket,
  data: unknown,
  world: World,
): void {
  const playerEntity = socket.player;
  if (!playerEntity) {
    return;
  }

  const playerId = playerEntity.id;

  // Rate limiting using shared infrastructure
  const rateLimiter = getPrayerRateLimiter();
  if (!rateLimiter.check(playerId)) {
    // Silently drop rate-limited requests (no error spam to client)
    return;
  }

  // Validate request structure using type guard
  if (!isValidPrayerTogglePayload(data)) {
    console.warn(`[Prayer] Invalid toggle request format from ${playerId}`);
    return;
  }

  const { prayerId } = data;

  // Validate timestamp to prevent replay attacks (if provided)
  const payload = data as Record<string, unknown>;
  if (payload.timestamp !== undefined) {
    const timestampValidation = validateRequestTimestamp(payload.timestamp);
    if (!timestampValidation.valid) {
      console.warn(
        `[Prayer] Replay attack blocked from ${playerId}: ${timestampValidation.reason}`,
      );
      return;
    }
  }

  // Additional prayer ID format validation (defense in depth)
  if (!isValidPrayerId(prayerId)) {
    console.warn(
      `[Prayer] Invalid prayer ID format "${prayerId}" from ${playerId}`,
    );
    sendPrayerError(socket, "Invalid prayer");
    return;
  }

  // Forward validated request to PrayerSystem
  // PrayerSystem handles:
  // - Prayer existence check via PrayerDataProvider
  // - Level requirements
  // - Prayer point check
  // - Conflict resolution
  // - State updates and persistence
  world.emit(EventType.PRAYER_TOGGLE, {
    playerId,
    prayerId,
  });
}

/**
 * Handle prayer deactivate all request from client
 * Turns off all active prayers at once (useful for "quick prayers off" button)
 *
 * @param socket - Client socket with player entity
 * @param data - Request payload (may contain timestamp)
 * @param world - Game world instance
 */
export function handlePrayerDeactivateAll(
  socket: ServerSocket,
  data: unknown,
  world: World,
): void {
  const playerEntity = socket.player;
  if (!playerEntity) {
    return;
  }

  const playerId = playerEntity.id;

  // Rate limiting
  const rateLimiter = getPrayerRateLimiter();
  if (!rateLimiter.check(playerId)) {
    return;
  }

  // Validate timestamp if provided
  if (data && typeof data === "object") {
    const payload = data as Record<string, unknown>;
    if (payload.timestamp !== undefined) {
      const timestampValidation = validateRequestTimestamp(payload.timestamp);
      if (!timestampValidation.valid) {
        console.warn(
          `[Prayer] Replay attack blocked from ${playerId}: ${timestampValidation.reason}`,
        );
        return;
      }
    }
  }

  // Forward to PrayerSystem - it will deactivate all active prayers
  world.emit(EventType.PRAYER_DEACTIVATED, {
    playerId,
    prayerId: "*", // Special marker for "all prayers"
    reason: "manual",
  });
}
