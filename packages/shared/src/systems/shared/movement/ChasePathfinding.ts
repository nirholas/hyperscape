/**
 * Chase Pathfinding
 *
 * Simple greedy pathfinding algorithm for NPC chasing behavior.
 * Unlike BFS which searches for optimal paths around obstacles,
 * this algorithm moves directly toward the target.
 *
 * This is intentionally simple - NPCs don't navigate around obstacles,
 * which enables "safespotting" gameplay where players can hide behind objects.
 *
 * Algorithm:
 * 1. Calculate direction to target (normalized to -1, 0, or 1)
 * 2. Try diagonal step if moving on both axes
 * 3. Try cardinal steps (prioritize axis with greater distance)
 * 4. Return first walkable tile, or null if blocked
 */

import type { TileCoord } from "./TileSystem";

// Reusable candidate tiles to avoid allocations in hot path
const _candidate0: TileCoord = { x: 0, z: 0 };
const _candidate1: TileCoord = { x: 0, z: 0 };
const _candidate2: TileCoord = { x: 0, z: 0 };

/**
 * Calculate the next tile when chasing a target.
 *
 * This is a greedy/direct pathfinding step - it always tries to move
 * toward the target in the most direct way possible. It does NOT search
 * for paths around obstacles.
 *
 * @param current - The chaser's current tile
 * @param target - The target tile to move toward
 * @param isWalkable - Function to check if a tile is walkable
 * @returns The next tile to move to, or null if blocked/at target
 */
export function chaseStep(
  current: TileCoord,
  target: TileCoord,
  isWalkable: (tile: TileCoord) => boolean,
): TileCoord | null {
  // Calculate direction to target (-1, 0, or 1 for each axis)
  const dx = Math.sign(target.x - current.x);
  const dz = Math.sign(target.z - current.z);

  // If already at target, no movement needed
  if (dx === 0 && dz === 0) {
    return null;
  }

  // Use reusable candidate tiles instead of allocating new arrays
  // Priority 1: Diagonal (if moving on both axes)
  if (dx !== 0 && dz !== 0) {
    _candidate0.x = current.x + dx;
    _candidate0.z = current.z + dz;
    if (isWalkable(_candidate0)) {
      return { x: _candidate0.x, z: _candidate0.z };
    }
  }

  // Priority 2: Cardinal directions (prioritize greater distance axis)
  const absDx = Math.abs(target.x - current.x);
  const absDz = Math.abs(target.z - current.z);

  if (absDx >= absDz) {
    // X axis has greater or equal distance, try it first
    if (dx !== 0) {
      _candidate1.x = current.x + dx;
      _candidate1.z = current.z;
      if (isWalkable(_candidate1)) {
        return { x: _candidate1.x, z: _candidate1.z };
      }
    }
    if (dz !== 0) {
      _candidate2.x = current.x;
      _candidate2.z = current.z + dz;
      if (isWalkable(_candidate2)) {
        return { x: _candidate2.x, z: _candidate2.z };
      }
    }
  } else {
    // Z axis has greater distance, try it first
    if (dz !== 0) {
      _candidate1.x = current.x;
      _candidate1.z = current.z + dz;
      if (isWalkable(_candidate1)) {
        return { x: _candidate1.x, z: _candidate1.z };
      }
    }
    if (dx !== 0) {
      _candidate2.x = current.x + dx;
      _candidate2.z = current.z;
      if (isWalkable(_candidate2)) {
        return { x: _candidate2.x, z: _candidate2.z };
      }
    }
  }

  // All directions blocked - chaser is stuck
  return null;
}
