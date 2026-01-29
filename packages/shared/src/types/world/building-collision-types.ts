/**
 * Building Collision Types
 *
 * Type definitions for the multi-level building collision system.
 * Supports tile-based collision for pathfinding and floor tracking
 * for vertical movement through buildings.
 *
 * **Architecture:**
 * - Buildings have multiple floors, each with its own walkable tiles and walls
 * - Players track their current floor level for collision queries
 * - Stairs connect floors and trigger floor transitions
 * - Walls use directional flags to allow/block movement per direction
 *
 * **Coordinate Systems:**
 * - Cell coords: Building-local (col, row) from BuildingGenerator
 * - Tile coords: World tile coordinates (tileX, tileZ)
 * - World coords: 3D world position (x, y, z) in meters
 *
 * @see BuildingCollisionService for implementation
 * @see CollisionFlags for wall flag definitions
 */

import type { TileCoord } from "../../systems/shared/movement/TileSystem";

// ============================================================================
// WALL COLLISION TYPES
// ============================================================================

/**
 * Cardinal direction for wall collision
 */
export type WallDirection = "north" | "south" | "east" | "west";

/**
 * Wall segment representing a single wall edge
 *
 * Walls are edges between tiles, not tile centers.
 * A wall on the "north" side of tile (5, 10) blocks movement
 * from tile (5, 11) into tile (5, 10).
 */
export interface WallSegment {
  /** Tile X coordinate (world tile coords) */
  tileX: number;
  /** Tile Z coordinate (world tile coords) */
  tileZ: number;
  /** Which side of the tile the wall is on */
  side: WallDirection;
  /** True if this wall has an opening (door/arch) */
  hasOpening: boolean;
  /** Opening type if hasOpening is true */
  openingType?: "door" | "arch" | "window";
}

// ============================================================================
// STAIR COLLISION TYPES
// ============================================================================

/**
 * Stair tile that connects two floors
 *
 * Players stepping onto a stair tile from the lower floor
 * will transition to the upper floor when they reach the landing.
 */
export interface StairTile {
  /** Tile X coordinate (world tile coords) */
  tileX: number;
  /** Tile Z coordinate (world tile coords) */
  tileZ: number;
  /** Floor index this stair starts from (0-based) */
  fromFloor: number;
  /** Floor index this stair leads to */
  toFloor: number;
  /** Direction the stairs face (direction of ascent) */
  direction: WallDirection;
  /** Whether this is the top landing tile (arrival) or bottom (departure) */
  isLanding: boolean;
}

// ============================================================================
// FLOOR COLLISION TYPES
// ============================================================================

/**
 * Collision data for a single floor of a building
 *
 * Each floor has its own set of walkable tiles and wall segments.
 * Tiles not in walkableTiles are considered blocked (void/outside).
 */
export interface FloorCollisionData {
  /** Floor index (0 = ground floor, 1 = first floor, etc.) */
  floorIndex: number;
  /** World Y elevation of this floor's walking surface */
  elevation: number;
  /** Set of walkable tile keys ("tileX,tileZ") for O(1) lookup */
  walkableTiles: Set<string>;
  /** Wall segments for this floor (directional blocking) */
  wallSegments: WallSegment[];
  /** Stair tiles on this floor */
  stairTiles: StairTile[];
}

// ============================================================================
// BUILDING COLLISION TYPES
// ============================================================================

/**
 * Complete collision data for a building
 *
 * Contains all floors, walls, stairs, and metadata needed
 * for collision queries.
 */
export interface BuildingCollisionData {
  /** Unique building ID (matches TownBuilding.id) */
  buildingId: string;
  /** Town this building belongs to */
  townId: string;
  /** World position of building center */
  worldPosition: { x: number; y: number; z: number };
  /** Y-axis rotation in radians */
  rotation: number;
  /** Building dimensions in cells */
  cellWidth: number;
  cellDepth: number;
  /** Per-floor collision data */
  floors: FloorCollisionData[];
  /** Bounding box in world tiles (for spatial queries) */
  boundingBox: {
    minTileX: number;
    maxTileX: number;
    minTileZ: number;
    maxTileZ: number;
  };
}

// ============================================================================
// PLAYER BUILDING STATE
// ============================================================================

/**
 * Player's state relative to buildings
 *
 * Tracks which building (if any) the player is inside,
 * and which floor they're on. Used for floor-aware collision.
 */
export interface PlayerBuildingState {
  /** Building ID the player is currently inside, or null if outside */
  insideBuildingId: string | null;
  /** Current floor index (0 = ground floor) */
  currentFloor: number;
  /** Whether player is currently on stairs */
  onStairs: boolean;
  /** If on stairs, the stair tile data */
  stairData: StairTile | null;
}

// ============================================================================
// COLLISION QUERY TYPES
// ============================================================================

/**
 * Result of a building collision query
 */
export interface BuildingCollisionResult {
  /** Whether the tile is inside any building */
  isInsideBuilding: boolean;
  /** Building ID if inside a building */
  buildingId: string | null;
  /** Whether the tile is walkable at the queried floor */
  isWalkable: boolean;
  /** Floor index if inside building */
  floorIndex: number | null;
  /** Elevation of the floor if walkable */
  elevation: number | null;
  /** Whether there's a wall blocking movement in a specific direction */
  wallBlocking: {
    north: boolean;
    south: boolean;
    east: boolean;
    west: boolean;
  };
  /** Stair data if tile is a stair */
  stairTile: StairTile | null;
}

// ============================================================================
// BUILDING LAYOUT INPUT (from BuildingGenerator)
// ============================================================================

/**
 * Simplified floor plan data from BuildingGenerator
 * Used as input to generate collision data
 */
export interface BuildingLayoutInput {
  /** Building width in cells */
  width: number;
  /** Building depth in cells */
  depth: number;
  /** Number of floors */
  floors: number;
  /** Per-floor data */
  floorPlans: Array<{
    /** Which cells exist on this floor (2D boolean grid) */
    footprint: boolean[][];
    /** Room ID for each cell (for internal wall detection) */
    roomMap: number[][];
    /** Internal openings (between rooms): "col,row,side" -> "door"|"arch" */
    internalOpenings: Map<string, string>;
    /** External openings (to outside): "col,row,side" -> "door"|"arch"|"window" */
    externalOpenings: Map<string, string>;
  }>;
  /** Stair placement (if multi-floor) */
  stairs: {
    col: number;
    row: number;
    direction: string;
    landing: { col: number; row: number };
  } | null;
}

// ============================================================================
// COORDINATE TRANSFORMATION
// ============================================================================

/**
 * Building cell coordinate (local to building)
 */
export interface CellCoord {
  col: number;
  row: number;
}

/**
 * Transform a building cell to a world tile coordinate
 *
 * @param cell - Building-local cell coordinate
 * @param buildingCenterX - Building center world X position
 * @param buildingCenterZ - Building center world Z position
 * @param buildingWidth - Building width in cells
 * @param buildingDepth - Building depth in cells
 * @param rotationRad - Building Y-axis rotation in radians
 * @param cellSize - Size of one cell in world units (meters)
 * @returns World tile coordinate
 */
export function cellToWorldTile(
  cell: CellCoord,
  buildingCenterX: number,
  buildingCenterZ: number,
  buildingWidth: number,
  buildingDepth: number,
  rotationRad: number,
  cellSize: number,
): TileCoord {
  // Validate inputs
  if (!cell || typeof cell.col !== "number" || typeof cell.row !== "number") {
    throw new Error(`[cellToWorldTile] Invalid cell: ${JSON.stringify(cell)}`);
  }
  if (!Number.isFinite(buildingCenterX) || !Number.isFinite(buildingCenterZ)) {
    throw new Error(
      `[cellToWorldTile] Invalid building center: (${buildingCenterX}, ${buildingCenterZ})`,
    );
  }
  if (!Number.isFinite(buildingWidth) || buildingWidth <= 0) {
    throw new Error(
      `[cellToWorldTile] Invalid buildingWidth: ${buildingWidth}`,
    );
  }
  if (!Number.isFinite(buildingDepth) || buildingDepth <= 0) {
    throw new Error(
      `[cellToWorldTile] Invalid buildingDepth: ${buildingDepth}`,
    );
  }
  if (!Number.isFinite(rotationRad)) {
    throw new Error(`[cellToWorldTile] Invalid rotationRad: ${rotationRad}`);
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(`[cellToWorldTile] Invalid cellSize: ${cellSize}`);
  }

  // Cell (0,0) is at the SW corner of the building
  // Building center is at (width/2, depth/2) in cell space

  // Convert cell to building-local meters (centered on building)
  const localX = (cell.col - buildingWidth / 2 + 0.5) * cellSize;
  const localZ = (cell.row - buildingDepth / 2 + 0.5) * cellSize;

  // Apply rotation (rotate around building center)
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;

  // Convert to world coordinates
  const worldX = buildingCenterX + rotatedX;
  const worldZ = buildingCenterZ + rotatedZ;

  // Convert to tile coordinates
  return {
    x: Math.floor(worldX),
    z: Math.floor(worldZ),
  };
}

/**
 * Transform a wall direction based on building rotation
 *
 * @param direction - Local wall direction
 * @param rotationRad - Building Y-axis rotation in radians
 * @returns Rotated wall direction in world space
 */
export function rotateWallDirection(
  direction: WallDirection,
  rotationRad: number,
): WallDirection {
  // Normalize rotation to [0, 2π)
  const normalized =
    ((rotationRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // Determine rotation quadrant (each 90° = one direction shift)
  // 0° = no change, 90° = one CW shift, 180° = two shifts, 270° = three shifts
  const quadrant = Math.round(normalized / (Math.PI / 2)) % 4;

  const directions: WallDirection[] = ["north", "east", "south", "west"];
  const dirIndex = directions.indexOf(direction);

  // Rotate direction clockwise by quadrant
  const newIndex = (dirIndex + quadrant) % 4;
  return directions[newIndex];
}

/** Opposite direction lookup */
const OPPOSITE_DIRECTION: Record<WallDirection, WallDirection> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** Get the opposite wall direction */
export function getOppositeDirection(direction: WallDirection): WallDirection {
  return OPPOSITE_DIRECTION[direction];
}

/**
 * Convert a direction string to WallDirection type
 */
export function toWallDirection(dir: string): WallDirection {
  switch (dir.toLowerCase()) {
    case "north":
    case "n":
      return "north";
    case "south":
    case "s":
      return "south";
    case "east":
    case "e":
      return "east";
    case "west":
    case "w":
      return "west";
    default:
      return "south"; // Default fallback
  }
}

/**
 * Create a tile key string for Set/Map storage
 */
export function tileKey(tileX: number, tileZ: number): string {
  // Validate inputs
  if (!Number.isFinite(tileX) || !Number.isFinite(tileZ)) {
    throw new Error(`[tileKey] Invalid tile coords: (${tileX}, ${tileZ})`);
  }
  return `${tileX},${tileZ}`;
}

// Note: parseTileKey is available from TileSystem.ts - use that instead
