/**
 * FaceDirectionManager - OSRS-Accurate Face Direction System
 *
 * Implements the OSRS face direction mask behavior:
 * 1. When player interacts with object/NPC, faceTarget is SET (not applied)
 * 2. At END of each tick, if player did NOT move, rotation is applied
 * 3. If player moved, rotation is skipped but faceTarget PERSISTS
 * 4. Player will face the target when they eventually stop moving
 *
 * This creates the authentic OSRS behavior where clicking a tree then
 * walking away will still cause you to face the tree once you stop.
 *
 * @see https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/
 */

import type { World } from "@hyperscape/shared";
import { quaternionPool } from "@hyperscape/shared";

/**
 * Entity interface for face direction operations
 */
interface FaceableEntity {
  id: string;
  position?: { x: number; y: number; z: number };
  faceTarget?: { x: number; z: number };
  movedThisTick?: boolean;
  // Server-side rotation storage
  rotation?: { x: number; y: number; z: number; w: number };
  // Client-side transforms
  base?: {
    quaternion?: {
      set(x: number, y: number, z: number, w: number): void;
    };
  };
  node?: {
    quaternion?: {
      copy(source: { x: number; y: number; z: number; w: number }): void;
    };
  };
  markNetworkDirty?: () => void;
}

/**
 * OSRS 8-direction constants
 * Players/NPCs can only face these 8 directions
 */
const DIRECTION_COUNT = 8;
const DIRECTION_STEP = (Math.PI * 2) / DIRECTION_COUNT; // 45 degrees = PI/4

/**
 * FaceDirectionManager handles OSRS-accurate deferred face direction
 */
export class FaceDirectionManager {
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Set a face target for a player
   * Called when player interacts with objects, NPCs, resources, etc.
   *
   * OSRS: The target is stored but NOT applied until end of tick
   *
   * @param playerId - Player to set face target for
   * @param targetX - X coordinate to face
   * @param targetZ - Z coordinate to face
   */
  setFaceTarget(playerId: string, targetX: number, targetZ: number): void {
    const player = this.world.getPlayer?.(playerId) as FaceableEntity | null;
    if (!player) return;

    // Set the face target - will be processed at end of tick
    player.faceTarget = { x: targetX, z: targetZ };

    console.log(
      `[FaceDirection] Set face target for ${playerId}: target=(${targetX.toFixed(1)}, ${targetZ.toFixed(1)}), ` +
        `player=(${player.position?.x.toFixed(1)}, ${player.position?.z.toFixed(1)})`,
    );
  }

  /**
   * Clear face target for a player
   * Called in rare cases where we explicitly want to cancel facing
   *
   * @param playerId - Player to clear face target for
   */
  clearFaceTarget(playerId: string): void {
    const player = this.world.getPlayer?.(playerId) as FaceableEntity | null;
    if (!player) return;

    player.faceTarget = undefined;
  }

  /**
   * Mark a player as having moved this tick
   * Called by TileMovementManager when player moves
   *
   * OSRS: If entity moved, face direction is NOT applied this tick
   *
   * @param playerId - Player who moved
   */
  markPlayerMoved(playerId: string): void {
    const player = this.world.getPlayer?.(playerId) as FaceableEntity | null;
    if (!player) return;

    player.movedThisTick = true;
  }

  /**
   * Reset movement flags for all players
   * Called at START of each tick by GameTickProcessor
   */
  resetMovementFlags(): void {
    // Get all player entities
    for (const entity of this.world.entities.values()) {
      const player = entity as unknown as FaceableEntity;
      if (player.movedThisTick !== undefined) {
        player.movedThisTick = false;
      }
    }
  }

  /**
   * Process face direction for all players
   * Called at END of tick by GameTickProcessor, AFTER all movement
   *
   * OSRS behavior:
   * - Only applies rotation if player has faceTarget AND did NOT move
   * - faceTarget persists even if not applied (player will face when they stop)
   * - Rotation snapped to 8 directions (N, NE, E, SE, S, SW, W, NW)
   *
   * @param playerIds - List of player IDs to process (in PID order)
   */
  processFaceDirection(playerIds: readonly string[]): void {
    for (const playerId of playerIds) {
      const player = this.world.getPlayer?.(playerId) as FaceableEntity | null;
      if (!player) continue;

      // Skip if no face target set
      if (!player.faceTarget) continue;

      // OSRS: Skip if player moved this tick (but keep faceTarget for later)
      if (player.movedThisTick) {
        console.log(
          `[FaceDirection] Skipping ${playerId}: movedThisTick=true, faceTarget persists`,
        );
        continue;
      }

      // Skip if player has no position
      if (!player.position) continue;

      // Calculate direction to target
      const dx = player.faceTarget.x - player.position.x;
      const dz = player.faceTarget.z - player.position.z;

      // Skip if already at target (avoid divide by zero / weird angles)
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) {
        // Clear face target since we're at the destination
        player.faceTarget = undefined;
        continue;
      }

      // Calculate raw angle
      const rawAngle = Math.atan2(dx, dz);

      // OSRS: Snap to nearest 45 degrees (8 directions)
      const snappedAngle =
        Math.round(rawAngle / DIRECTION_STEP) * DIRECTION_STEP;

      // VRM 1.0+ models have 180 degree base rotation
      const finalAngle = snappedAngle + Math.PI;

      // Apply rotation using pooled quaternion
      this.applyRotation(player, finalAngle);

      // Convert angle to compass direction for logging
      const directions = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
      const dirIndex = Math.round(
        ((snappedAngle + Math.PI) / (Math.PI / 4)) % 8,
      );
      const compassDir = directions[dirIndex] || "?";

      console.log(
        `[FaceDirection] Applied rotation for ${playerId}: ` +
          `angle=${((snappedAngle * 180) / Math.PI).toFixed(0)}° (${compassDir}), ` +
          `dx=${dx.toFixed(1)}, dz=${dz.toFixed(1)}`,
      );

      // OSRS: Clear face target after successfully applying
      // (the variable is "never reset outside when it actually sends the info")
      player.faceTarget = undefined;
    }
  }

  /**
   * Apply Y-axis rotation to player entity
   * Uses quaternion pool to avoid allocations
   */
  private applyRotation(player: FaceableEntity, angle: number): void {
    const tempQuat = quaternionPool.acquire();
    quaternionPool.setYRotation(tempQuat, angle);

    try {
      // Set server-side rotation (for network sync)
      if (player.rotation) {
        player.rotation.x = tempQuat.x;
        player.rotation.y = tempQuat.y;
        player.rotation.z = tempQuat.z;
        player.rotation.w = tempQuat.w;
      }

      // Set client-side transforms if present
      if (player.base?.quaternion) {
        player.base.quaternion.set(
          tempQuat.x,
          tempQuat.y,
          tempQuat.z,
          tempQuat.w,
        );
      }
      if (player.node?.quaternion) {
        player.node.quaternion.copy(tempQuat);
      }
    } finally {
      quaternionPool.release(tempQuat);
    }

    // Mark for network broadcast
    player.markNetworkDirty?.();
  }
}
