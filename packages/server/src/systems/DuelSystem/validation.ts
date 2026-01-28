/**
 * DuelSystem Event Payload Validation
 *
 * Runtime type guards for event payloads to ensure type safety
 * at system boundaries. Prevents crashes from malformed payloads.
 */

// ============================================================================
// Payload Interfaces
// ============================================================================

/**
 * Payload for PLAYER_LEFT and PLAYER_LOGOUT events
 */
export interface PlayerDisconnectPayload {
  playerId: string;
}

/**
 * Payload for ENTITY_DEATH events
 */
export interface EntityDeathPayload {
  entityId: string;
  entityType?: "player" | "mob";
  killedBy?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Validates a payload is a valid PlayerDisconnectPayload
 */
export function isPlayerDisconnectPayload(
  data: unknown,
): data is PlayerDisconnectPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "playerId" in data &&
    typeof (data as PlayerDisconnectPayload).playerId === "string"
  );
}

/**
 * Validates a payload is a valid EntityDeathPayload
 */
export function isEntityDeathPayload(
  data: unknown,
): data is EntityDeathPayload {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const payload = data as EntityDeathPayload;

  // entityId is required and must be a string
  if (!("entityId" in data) || typeof payload.entityId !== "string") {
    return false;
  }

  // entityType is optional but must be 'player' or 'mob' if present
  if (
    payload.entityType !== undefined &&
    payload.entityType !== "player" &&
    payload.entityType !== "mob"
  ) {
    return false;
  }

  // killedBy is optional but must be a string if present
  if (payload.killedBy !== undefined && typeof payload.killedBy !== "string") {
    return false;
  }

  return true;
}

/**
 * Check if an entity death payload is for a player
 */
export function isPlayerDeath(payload: EntityDeathPayload): boolean {
  return (
    payload.entityType === "player" || payload.entityId?.includes("player")
  );
}
