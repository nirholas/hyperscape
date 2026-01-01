/**
 * Tile System
 *
 * Core constants and utilities for RuneScape-style tile-based movement.
 * The game world is divided into discrete tiles, and entities move
 * one tile at a time in sync with server ticks.
 *
 * Key concepts:
 * - TILE_SIZE: World units per tile (1.0 = 1 meter per tile)
 * - TICK_DURATION_MS: Server tick interval (600ms like RuneScape)
 * - Movement happens discretely: 1 tile/tick (walk) or 2 tiles/tick (run)
 * - Client interpolates visually between tile positions
 */

import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import type { IEntityOccupancy } from "./EntityOccupancyMap";
import type { EntityID } from "../../../types/core/identifiers";

/**
 * Core tile system constants
 *
 * OSRS uses 600ms ticks with 1 tile/tick walk, 2 tiles/tick run.
 * We use 2x speed (2/4 tiles per tick) for a snappier modern feel
 * while keeping the tick-based movement system.
 */
export const TILE_SIZE = 1.0; // 1 world unit = 1 tile
export const TICK_DURATION_MS = 600; // 0.6 seconds per server tick
export const TILES_PER_TICK_WALK = 2; // Walking: 2 tiles per tick (2x OSRS)
export const TILES_PER_TICK_RUN = 4; // Running: 4 tiles per tick (2x OSRS)
export const MAX_PATH_LENGTH = 25; // Maximum checkpoint tiles in a path
export const PATHFIND_RADIUS = 128; // BFS search radius in tiles

/**
 * Tile coordinate (always integers)
 * Y is intentionally omitted - tiles are 2D, height comes from terrain
 */
export interface TileCoord {
  x: number; // Integer tile X
  z: number; // Integer tile Z
}

/**
 * Movement state for a single entity
 */
export interface TileMovementState {
  currentTile: TileCoord; // Current tile position
  path: TileCoord[]; // Queue of tiles to walk through
  pathIndex: number; // Current position in path
  isRunning: boolean; // Walk (1 tile/tick) vs Run (2 tiles/tick)
  moveSeq: number; // Movement sequence number (incremented on each new path)
  /**
   * Tile player was on at START of current tick (captured before movement)
   *
   * OSRS-ACCURATE: Used by FollowManager for follow mechanic.
   * Following a player means walking to their PREVIOUS tile,
   * creating the characteristic 1-tick trailing effect.
   *
   * @see https://rune-server.org/threads/help-with-player-dancing-spinning-when-following-each-other.706121/
   */
  previousTile: TileCoord | null;
}

/**
 * Tile flags for collision/walkability
 */
export interface TileFlags {
  walkable: boolean; // Can entities stand on this tile?
  blockedNorth: boolean; // Is north edge blocked?
  blockedEast: boolean; // Is east edge blocked?
  blockedSouth: boolean; // Is south edge blocked?
  blockedWest: boolean; // Is west edge blocked?
}

/**
 * Convert world coordinates to tile coordinates
 * Uses floor to ensure consistent tile boundaries
 *
 * NOTE: This allocates a new object. For hot paths, use worldToTileInto().
 */
export function worldToTile(worldX: number, worldZ: number): TileCoord {
  return {
    x: Math.floor(worldX / TILE_SIZE),
    z: Math.floor(worldZ / TILE_SIZE),
  };
}

/**
 * Convert world coordinates to tile coordinates (zero-allocation)
 *
 * Writes to an existing TileCoord object to avoid GC pressure in hot paths.
 *
 * @param worldX - World X coordinate
 * @param worldZ - World Z coordinate
 * @param out - Pre-allocated TileCoord to write to
 */
export function worldToTileInto(
  worldX: number,
  worldZ: number,
  out: TileCoord,
): void {
  out.x = Math.floor(worldX / TILE_SIZE);
  out.z = Math.floor(worldZ / TILE_SIZE);
}

/**
 * Convert tile coordinates to world coordinates (tile center)
 * Returns the center of the tile, not the corner
 */
export function tileToWorld(tile: TileCoord): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: (tile.x + 0.5) * TILE_SIZE,
    y: 0, // Y will be set from terrain height
    z: (tile.z + 0.5) * TILE_SIZE,
  };
}

/**
 * Convert tile coordinates to world coordinates (zero-allocation)
 * Writes to an existing object to avoid GC pressure in hot paths.
 *
 * @param tile - Tile coordinates to convert
 * @param out - Pre-allocated object to write to (must have x, y, z properties)
 */
export function tileToWorldInto(
  tile: TileCoord,
  out: { x: number; y: number; z: number },
): void {
  out.x = (tile.x + 0.5) * TILE_SIZE;
  out.y = 0; // Y will be set from terrain height
  out.z = (tile.z + 0.5) * TILE_SIZE;
}

/**
 * Calculate Manhattan distance between two tiles
 * Used for simple distance checks (not pathfinding)
 */
export function tileManhattanDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/**
 * Calculate Chebyshev distance (max of dx, dz)
 * This is the actual "tile distance" for diagonal movement
 */
export function tileChebyshevDistance(a: TileCoord, b: TileCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/**
 * Check if two tile coordinates are equal
 */
export function tilesEqual(a: TileCoord, b: TileCoord): boolean {
  return a.x === b.x && a.z === b.z;
}

/**
 * Check if two tiles are adjacent (Chebyshev distance = 1)
 * This includes diagonal adjacency (8 directions).
 * Used for general "next to each other" checks.
 *
 * OSRS Reference: Entities are considered "in melee range" when adjacent.
 */
export function tilesAdjacent(a: TileCoord, b: TileCoord): boolean {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  // Adjacent if max distance is 1 and not the same tile
  return dx <= 1 && dz <= 1 && (dx > 0 || dz > 0);
}

/**
 * Check if two tiles are within a given range (Chebyshev distance)
 * Used for ranged/magic combat and general distance checks.
 * NOTE: For melee combat, use tilesWithinMeleeRange() instead!
 *
 * @param a - First tile
 * @param b - Second tile
 * @param rangeTiles - Maximum range in tiles (minimum 1)
 * @returns true if tiles are within range but NOT the same tile
 */
export function tilesWithinRange(
  a: TileCoord,
  b: TileCoord,
  rangeTiles: number,
): boolean {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const chebyshevDistance = Math.max(dx, dz);
  // Combat requires being on different tiles (adjacent, not overlapping)
  const effectiveRange = Math.max(1, Math.floor(rangeTiles));
  return chebyshevDistance <= effectiveRange && chebyshevDistance > 0;
}

/**
 * OSRS-accurate melee range check
 *
 * OSRS melee attack rules (from wiki):
 * - Range 1 (standard melee): CARDINAL ONLY (N/S/E/W) - cannot attack diagonally
 * - Range 2+ (halberd, spear): Can attack diagonally (uses Chebyshev distance)
 * - Salamanders are special: range 1 but CAN attack diagonally (not implemented here)
 *
 * @param attacker - Attacker's tile position
 * @param target - Target's tile position
 * @param meleeRange - Weapon's melee range (1 = standard, 2 = halberd)
 * @returns true if target is within melee attack range
 *
 * @see https://oldschool.runescape.wiki/w/Attack_range
 */
export function tilesWithinMeleeRange(
  attacker: TileCoord,
  target: TileCoord,
  meleeRange: number,
): boolean {
  const dx = Math.abs(attacker.x - target.x);
  const dz = Math.abs(attacker.z - target.z);

  // Range 1 (standard melee): CARDINAL ONLY - no diagonal attacks
  // This is the core OSRS melee mechanic that makes positioning matter
  if (meleeRange === COMBAT_CONSTANTS.MELEE_RANGE_STANDARD) {
    return (dx === 1 && dz === 0) || (dx === 0 && dz === 1);
  }

  // Range 2+ (halberd, spear): Allow diagonal attacks
  // Uses Chebyshev distance, must be within range but not on same tile
  const chebyshevDistance = Math.max(dx, dz);
  const effectiveRange = Math.max(1, Math.floor(meleeRange));
  return chebyshevDistance <= effectiveRange && chebyshevDistance > 0;
}

/**
 * Check if two tiles are cardinally adjacent (Manhattan distance = 1)
 * This is N/S/E/W only, no diagonals.
 * In OSRS, melee attacks are cardinal-only (except salamanders).
 *
 * OSRS Reference: Standard melee can only attack N/S/E/W, not diagonally.
 */
export function tilesCardinallyAdjacent(a: TileCoord, b: TileCoord): boolean {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  // Cardinal if exactly 1 step in only one axis
  return (dx === 1 && dz === 0) || (dx === 0 && dz === 1);
}

/**
 * Get the best adjacent tile to stand on when attacking a target.
 * Returns the adjacent tile to `target` that is closest to `attacker`.
 * This is used for melee combat positioning - stand next to target, not on it.
 *
 * OSRS Reference: NPCs path to an adjacent tile when chasing for melee combat.
 *
 * @param target - The tile the target is standing on
 * @param attacker - The tile the attacker is currently on
 * @param cardinalOnly - If true, only consider N/S/E/W tiles (OSRS melee behavior)
 * @param isWalkable - Optional function to check if a tile is walkable
 * @returns The best adjacent tile to stand on, or null if none available
 */
export function getBestAdjacentTile(
  target: TileCoord,
  attacker: TileCoord,
  cardinalOnly: boolean = false,
  isWalkable?: (tile: TileCoord) => boolean,
): TileCoord | null {
  // Get candidate tiles (cardinal or all 8 directions)
  const candidates = cardinalOnly
    ? [
        { x: target.x - 1, z: target.z }, // West
        { x: target.x + 1, z: target.z }, // East
        { x: target.x, z: target.z - 1 }, // South
        { x: target.x, z: target.z + 1 }, // North
      ]
    : getAdjacentTiles(target);

  // Filter out unwalkable tiles if isWalkable function provided
  const walkableCandidates = isWalkable
    ? candidates.filter(isWalkable)
    : candidates;

  if (walkableCandidates.length === 0) {
    return null;
  }

  // If attacker is already on one of these tiles, return that tile
  for (const candidate of walkableCandidates) {
    if (tilesEqual(candidate, attacker)) {
      return candidate;
    }
  }

  // Find the candidate closest to the attacker using Chebyshev distance
  let best = walkableCandidates[0];
  let bestDist = tileChebyshevDistance(best, attacker);

  for (let i = 1; i < walkableCandidates.length; i++) {
    const dist = tileChebyshevDistance(walkableCandidates[i], attacker);
    if (dist < bestDist) {
      best = walkableCandidates[i];
      bestDist = dist;
    }
  }

  return best;
}

/**
 * Get the best tile to stand on when attacking a target, respecting combat range.
 * Used for ranged/magic combat. For melee, use getBestMeleeTile() instead!
 *
 * @param target - The tile the target is standing on
 * @param attacker - The tile the attacker is currently on
 * @param combatRange - Maximum combat range in tiles (1 = melee, 2+ = extended)
 * @param isWalkable - Optional function to check if a tile is walkable
 * @returns The best tile to stand on for combat, or null if none available
 */
export function getBestCombatRangeTile(
  target: TileCoord,
  attacker: TileCoord,
  combatRange: number = 1,
  isWalkable?: (tile: TileCoord) => boolean,
): TileCoord | null {
  const effectiveRange = Math.max(1, Math.floor(combatRange));

  // If already in range, stay where we are
  if (tilesWithinRange(attacker, target, effectiveRange)) {
    return attacker;
  }

  // Generate all valid combat tiles around the target
  const validCombatTiles: Array<{
    tile: TileCoord;
    distToTarget: number;
    distToAttacker: number;
  }> = [];

  for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
    for (let dz = -effectiveRange; dz <= effectiveRange; dz++) {
      const candidateTile: TileCoord = {
        x: target.x + dx,
        z: target.z + dz,
      };

      // Distance from candidate to target (Chebyshev)
      const distToTarget = Math.max(Math.abs(dx), Math.abs(dz));

      // Must be within range AND not on same tile
      if (distToTarget >= 1 && distToTarget <= effectiveRange) {
        if (isWalkable && !isWalkable(candidateTile)) {
          continue;
        }

        const attackerDx = candidateTile.x - attacker.x;
        const attackerDz = candidateTile.z - attacker.z;
        const distToAttacker = Math.max(
          Math.abs(attackerDx),
          Math.abs(attackerDz),
        );

        validCombatTiles.push({
          tile: candidateTile,
          distToTarget,
          distToAttacker,
        });
      }
    }
  }

  if (validCombatTiles.length === 0) {
    return null;
  }

  validCombatTiles.sort((a, b) => a.distToAttacker - b.distToAttacker);
  return validCombatTiles[0].tile;
}

/**
 * OSRS-accurate melee destination tile selection
 *
 * When clicking an NPC for melee combat, OSRS:
 * 1. Finds all tiles within melee range of the target
 * 2. For range 1: only cardinal tiles (N/S/E/W) - NO diagonal
 * 3. For range 2+: all tiles within Chebyshev distance
 * 4. Paths to the CLOSEST valid tile using BFS
 *
 * @param target - The tile the target is standing on
 * @param attacker - The tile the attacker is currently on
 * @param meleeRange - Weapon's melee range (1 = standard, 2 = halberd)
 * @param isWalkable - Optional function to check if a tile is walkable
 * @returns The best tile to path to for melee combat, or null if none available
 *
 * @see https://oldschool.runescape.wiki/w/Pathfinding
 */
export function getBestMeleeTile(
  target: TileCoord,
  attacker: TileCoord,
  meleeRange: number = 1,
  isWalkable?: (tile: TileCoord) => boolean,
): TileCoord | null {
  const effectiveRange = Math.max(1, Math.floor(meleeRange));

  // Check if already in valid melee range
  if (tilesWithinMeleeRange(attacker, target, effectiveRange)) {
    return attacker;
  }

  // For range 1: CARDINAL ONLY (OSRS melee behavior)
  if (effectiveRange === COMBAT_CONSTANTS.MELEE_RANGE_STANDARD) {
    const cardinalTiles = [
      { x: target.x - 1, z: target.z }, // West
      { x: target.x + 1, z: target.z }, // East
      { x: target.x, z: target.z - 1 }, // South
      { x: target.x, z: target.z + 1 }, // North
    ];

    // Filter walkable and find closest to attacker
    const validTiles = cardinalTiles
      .filter((tile) => !isWalkable || isWalkable(tile))
      .map((tile) => ({
        tile,
        dist: tileChebyshevDistance(tile, attacker),
      }))
      .sort((a, b) => a.dist - b.dist);

    return validTiles.length > 0 ? validTiles[0].tile : null;
  }

  // For range 2+ (halberd): Allow diagonal positions
  const validTiles: Array<{ tile: TileCoord; dist: number }> = [];

  for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
    for (let dz = -effectiveRange; dz <= effectiveRange; dz++) {
      const candidateTile: TileCoord = {
        x: target.x + dx,
        z: target.z + dz,
      };

      // Chebyshev distance to target
      const distToTarget = Math.max(Math.abs(dx), Math.abs(dz));

      // Must be within range but not on same tile
      if (distToTarget >= 1 && distToTarget <= effectiveRange) {
        if (isWalkable && !isWalkable(candidateTile)) {
          continue;
        }

        validTiles.push({
          tile: candidateTile,
          dist: tileChebyshevDistance(candidateTile, attacker),
        });
      }
    }
  }

  if (validTiles.length === 0) {
    return null;
  }

  // Sort by distance to attacker (closest first)
  validTiles.sort((a, b) => a.dist - b.dist);
  return validTiles[0].tile;
}

/**
 * Get adjacent tiles (8 directions - RuneScape order)
 * Order: W, E, S, N, SW, SE, NW, NE
 */
export function getAdjacentTiles(tile: TileCoord): TileCoord[] {
  return [
    { x: tile.x - 1, z: tile.z }, // West
    { x: tile.x + 1, z: tile.z }, // East
    { x: tile.x, z: tile.z - 1 }, // South
    { x: tile.x, z: tile.z + 1 }, // North
    { x: tile.x - 1, z: tile.z - 1 }, // Southwest
    { x: tile.x + 1, z: tile.z - 1 }, // Southeast
    { x: tile.x - 1, z: tile.z + 1 }, // Northwest
    { x: tile.x + 1, z: tile.z + 1 }, // Northeast
  ];
}

/**
 * Direction vectors matching RuneScape's neighbor check order
 */
export const TILE_DIRECTIONS = [
  { x: -1, z: 0 }, // West
  { x: 1, z: 0 }, // East
  { x: 0, z: -1 }, // South
  { x: 0, z: 1 }, // North
  { x: -1, z: -1 }, // Southwest
  { x: 1, z: -1 }, // Southeast
  { x: -1, z: 1 }, // Northwest
  { x: 1, z: 1 }, // Northeast
] as const;

/**
 * Cardinal directions only (N/E/S/W, no diagonals)
 * OSRS uses all 4 cardinal directions for NPC step-out when on same tile
 *
 * @see https://osrs-docs.com/docs/mechanics/entity-collision/
 */
export const CARDINAL_DIRECTIONS = [
  { x: 0, z: 1 }, // North
  { x: 1, z: 0 }, // East
  { x: 0, z: -1 }, // South
  { x: -1, z: 0 }, // West
] as const;

/**
 * Get cardinal-adjacent tiles (N/E/S/W only, no diagonals)
 *
 * @param tile - Center tile
 * @returns Array of 4 cardinal-adjacent tiles
 */
export function getCardinalTiles(tile: TileCoord): TileCoord[] {
  return CARDINAL_DIRECTIONS.map((dir) => ({
    x: tile.x + dir.x,
    z: tile.z + dir.z,
  }));
}

/**
 * Get a random cardinal-adjacent tile
 * Used for OSRS-accurate NPC step-out when on same tile as target.
 *
 * OSRS behavior: "In RS, they pick a random cardinal direction (north, east,
 * west, south) and try to move the NPC towards that by 1 tile."
 *
 * @param tile - Center tile
 * @param rng - Random number generator (for deterministic behavior)
 * @returns Random cardinal tile (N, E, S, or W)
 *
 * @see https://osrs-docs.com/docs/mechanics/entity-collision/
 */
export function getRandomCardinalTile(
  tile: TileCoord,
  rng: { nextInt: (max: number) => number },
): TileCoord {
  const direction = CARDINAL_DIRECTIONS[rng.nextInt(4)];
  return {
    x: tile.x + direction.x,
    z: tile.z + direction.z,
  };
}

// ============================================================================
// PRE-ALLOCATED BUFFER FOR STEP-OUT (Zero-allocation)
// ============================================================================

/**
 * Pre-allocated buffer for step-out tile selection.
 * Avoids creating new arrays on each call.
 */
const _stepOutBuffer: TileCoord[] = [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];

/**
 * Find the best cardinal tile to step out to when on same tile as target.
 *
 * OSRS-accurate: When an NPC is on the same tile as its target, it must
 * step out to a cardinal tile before it can attack. This function finds
 * the first valid tile by:
 * 1. Shuffling all 4 cardinal directions (maintains OSRS randomness)
 * 2. Checking each for terrain walkability AND entity occupancy
 * 3. Returning the first valid tile found
 *
 * This prevents the "thrashing" bug where random single-direction picking
 * could repeatedly select blocked tiles while valid tiles exist.
 *
 * Memory: Uses pre-allocated buffer to avoid GC pressure in hot paths.
 *
 * @param currentTile - Mob's current tile (same as target)
 * @param occupancy - Entity occupancy map for collision checking
 * @param entityId - Mob's entity ID (excluded from occupancy check)
 * @param isWalkable - Terrain walkability check function
 * @param rng - RNG for shuffling directions (deterministic)
 * @returns Best tile to step to, or null if all 4 cardinal tiles are blocked
 *
 * @see https://osrs-docs.com/docs/mechanics/entity-collision/
 */
export function getBestStepOutTile(
  currentTile: TileCoord,
  occupancy: IEntityOccupancy,
  entityId: EntityID,
  isWalkable: (tile: TileCoord) => boolean,
  rng: { nextInt: (max: number) => number },
): TileCoord | null {
  // Populate buffer with cardinal tiles
  // South
  _stepOutBuffer[0].x = currentTile.x;
  _stepOutBuffer[0].z = currentTile.z - 1;
  // North
  _stepOutBuffer[1].x = currentTile.x;
  _stepOutBuffer[1].z = currentTile.z + 1;
  // West
  _stepOutBuffer[2].x = currentTile.x - 1;
  _stepOutBuffer[2].z = currentTile.z;
  // East
  _stepOutBuffer[3].x = currentTile.x + 1;
  _stepOutBuffer[3].z = currentTile.z;

  // Fisher-Yates shuffle for random order (OSRS-style randomness)
  for (let i = 3; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    // Swap values (not references, to keep buffer intact)
    const tempX = _stepOutBuffer[i].x;
    const tempZ = _stepOutBuffer[i].z;
    _stepOutBuffer[i].x = _stepOutBuffer[j].x;
    _stepOutBuffer[i].z = _stepOutBuffer[j].z;
    _stepOutBuffer[j].x = tempX;
    _stepOutBuffer[j].z = tempZ;
  }

  // Find first valid tile
  for (let i = 0; i < 4; i++) {
    const tile = _stepOutBuffer[i];

    // Check terrain walkability first (cheaper check)
    if (!isWalkable(tile)) continue;

    // Check entity occupancy (exclude self)
    if (occupancy.isBlocked(tile, entityId)) continue;

    // Found a valid tile - return a copy (buffer will be reused)
    return { x: tile.x, z: tile.z };
  }

  // All tiles blocked
  return null;
}

/**
 * Check if a direction is diagonal
 */
export function isDiagonal(dx: number, dz: number): boolean {
  return dx !== 0 && dz !== 0;
}

/**
 * Create a unique key for a tile (for Map/Set storage)
 */
export function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
}

/**
 * Parse a tile key back into a TileCoord
 */
export function parseTileKey(key: string): TileCoord {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
}

/**
 * Clamp a tile coordinate within bounds
 */
export function clampTile(
  tile: TileCoord,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): TileCoord {
  return {
    x: Math.max(minX, Math.min(maxX, tile.x)),
    z: Math.max(minZ, Math.min(maxZ, tile.z)),
  };
}

/**
 * Create an empty tile movement state
 */
export function createTileMovementState(
  startTile: TileCoord,
): TileMovementState {
  return {
    currentTile: { ...startTile },
    path: [],
    pathIndex: 0,
    isRunning: false,
    moveSeq: 0,
    previousTile: null, // Set on first tick
  };
}

// ============================================================================
// OCCUPANCY-AWARE TILE FUNCTIONS (Zero-Allocation)
// ============================================================================

/** Pre-allocated buffer for cardinal melee tiles (range 1) */
const _cardinalMeleeTiles: TileCoord[] = [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];

/** Pre-allocated buffer for extended melee tiles (range 2+, max 5x5 = 24 tiles) */
const _extendedMeleeTiles: TileCoord[] = Array.from({ length: 24 }, () => ({
  x: 0,
  z: 0,
}));

/**
 * Get cardinal melee tiles (range 1) into pre-allocated buffer
 *
 * OSRS melee range 1: Cardinal only (N/S/E/W) - no diagonal attacks
 * Uses zero-allocation by writing to provided buffer.
 *
 * @param targetTile - Target's tile position
 * @param buffer - Pre-allocated buffer to fill (must have length >= 4)
 * @returns 4 (always 4 cardinal tiles)
 */
export function getCardinalMeleeTilesInto(
  targetTile: TileCoord,
  buffer: TileCoord[],
): number {
  buffer[0].x = targetTile.x;
  buffer[0].z = targetTile.z - 1; // South
  buffer[1].x = targetTile.x;
  buffer[1].z = targetTile.z + 1; // North
  buffer[2].x = targetTile.x - 1;
  buffer[2].z = targetTile.z; // West
  buffer[3].x = targetTile.x + 1;
  buffer[3].z = targetTile.z; // East
  return 4;
}

/**
 * Get extended melee tiles (range 2+) into pre-allocated buffer
 *
 * For halberd/spear range 2+ weapons that can attack diagonally.
 * Uses Chebyshev distance - all tiles within range.
 *
 * @param targetTile - Target's tile position
 * @param range - Attack range (2+)
 * @param buffer - Pre-allocated buffer to fill
 * @returns Number of tiles filled
 */
export function getExtendedMeleeTilesInto(
  targetTile: TileCoord,
  range: number,
  buffer: TileCoord[],
): number {
  let index = 0;

  for (let dx = -range; dx <= range && index < buffer.length; dx++) {
    for (let dz = -range; dz <= range && index < buffer.length; dz++) {
      // Skip target tile itself
      if (dx === 0 && dz === 0) continue;

      // Check if within Chebyshev distance
      if (Math.max(Math.abs(dx), Math.abs(dz)) <= range) {
        buffer[index].x = targetTile.x + dx;
        buffer[index].z = targetTile.z + dz;
        index++;
      }
    }
  }

  return index;
}

/**
 * Find best unoccupied combat tile for melee attack (zero-allocation)
 *
 * OSRS-accurate: Cardinal tiles only for range 1, diagonal allowed for range 2+.
 * Checks both terrain walkability AND entity occupancy.
 *
 * Uses internal pre-allocated buffers - DO NOT store returned tile reference
 * beyond the current call frame.
 *
 * @param attackerTile - Attacker's current tile
 * @param targetTile - Target's tile
 * @param occupancy - Entity occupancy map
 * @param attackerId - Attacker's ID (excluded from collision check)
 * @param isWalkable - Function to check terrain walkability
 * @param range - Attack range (default 1)
 * @returns Best tile reference (internal buffer) or null if all blocked
 *
 * @see NPC_ENTITY_COLLISION_PLAN.md Phase 4
 */
export function getBestUnoccupiedMeleeTile(
  attackerTile: TileCoord,
  targetTile: TileCoord,
  occupancy: IEntityOccupancy,
  attackerId: EntityID,
  isWalkable: (tile: TileCoord) => boolean,
  range: number = 1,
): TileCoord | null {
  // Get candidate tiles based on range
  const buffer =
    range === COMBAT_CONSTANTS.MELEE_RANGE_STANDARD
      ? _cardinalMeleeTiles
      : _extendedMeleeTiles;
  const tileCount =
    range === COMBAT_CONSTANTS.MELEE_RANGE_STANDARD
      ? getCardinalMeleeTilesInto(targetTile, buffer)
      : getExtendedMeleeTilesInto(targetTile, range, buffer);

  // Calculate distances and find best unoccupied tile
  let bestTile: TileCoord | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i < tileCount; i++) {
    const tile = buffer[i];

    // Skip if blocked by another entity (excludes self)
    if (occupancy.isBlocked(tile, attackerId)) continue;

    // Skip if terrain is unwalkable
    if (!isWalkable(tile)) continue;

    // Calculate Chebyshev distance from attacker to this tile
    const distance = Math.max(
      Math.abs(attackerTile.x - tile.x),
      Math.abs(attackerTile.z - tile.z),
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestTile = tile;
    }
  }

  return bestTile;
}

/**
 * Check if any cardinal tile around target is unoccupied (zero-allocation)
 *
 * Fast check to determine if any melee position is available.
 * Used before committing to path calculation.
 *
 * @param targetTile - Target's tile position
 * @param occupancy - Entity occupancy map
 * @param excludeEntityId - Entity to exclude from collision check
 * @param isWalkable - Function to check terrain walkability
 * @returns true if at least one cardinal tile is available
 */
export function hasUnoccupiedCardinalTile(
  targetTile: TileCoord,
  occupancy: IEntityOccupancy,
  excludeEntityId: EntityID,
  isWalkable: (tile: TileCoord) => boolean,
): boolean {
  getCardinalMeleeTilesInto(targetTile, _cardinalMeleeTiles);

  for (let i = 0; i < 4; i++) {
    const tile = _cardinalMeleeTiles[i];
    if (!occupancy.isBlocked(tile, excludeEntityId) && isWalkable(tile)) {
      return true;
    }
  }

  return false;
}
