/**
 * Navigation Visualizer for Building/Town Viewer
 *
 * Provides visual debugging for building navigation:
 * - Walkable tiles (per floor)
 * - Door openings (entry/exit points)
 * - Stair tiles (floor transitions)
 * - Wall blocking visualization
 * - A→B pathfinding with BFS
 * - Demo paths showing outside→inside navigation
 *
 * Uses standalone implementations (no @hyperscape/shared dependency)
 * to keep the viewer self-contained.
 */

import * as THREE from "three";
import type {
  BuildingLayout,
  FloorPlan,
  StairPlacement,
} from "../src/building/generator/types.js";
import type {
  GeneratedTown,
  TownBuilding,
} from "../src/building/town/types.js";
import {
  CELL_SIZE,
  TILES_PER_CELL,
  FLOOR_HEIGHT,
  FOUNDATION_HEIGHT,
  getSideVector,
  getOppositeSide,
} from "../src/building/generator/constants.js";

// ============================================================================
// TYPES
// ============================================================================

/** Cardinal direction for walls */
type WallDirection = "north" | "south" | "east" | "west";

/** Wall segment data */
interface WallSegment {
  tileX: number;
  tileZ: number;
  side: WallDirection;
  hasOpening: boolean;
  openingType?: "door" | "arch" | "window";
}

/** Stair tile data */
interface StairTile {
  tileX: number;
  tileZ: number;
  fromFloor: number;
  toFloor: number;
  direction: WallDirection;
  isLanding: boolean;
}

/** Floor collision data */
interface FloorCollisionData {
  floorIndex: number;
  elevation: number;
  walkableTiles: Set<string>;
  exteriorTiles: Set<string>; // Ground tiles outside the building
  wallSegments: WallSegment[];
  stairTiles: StairTile[];
}

/** Building collision data */
interface BuildingCollisionData {
  buildingId: string;
  worldPosition: { x: number; y: number; z: number };
  rotation: number;
  cellWidth: number;
  cellDepth: number;
  floors: FloorCollisionData[];
  boundingBox: {
    minTileX: number;
    maxTileX: number;
    minTileZ: number;
    maxTileZ: number;
  };
}

/** Tile coordinate */
interface TileCoord {
  x: number;
  z: number;
}

/** Visualization options */
export interface NavigationVisualizerOptions {
  showWalkableTiles: boolean;
  showDoors: boolean;
  showStairs: boolean;
  showWalls: boolean;
  showEntryPoints: boolean;
  showDemoPaths: boolean;
}

/** Click state for A→B pathfinding */
interface ClickState {
  pointA: TileCoord | null;
  pointB: TileCoord | null;
}

/** Tile coordinate with floor information */
interface MultiFloorTile extends TileCoord {
  floor: number;
}

/** A segment of a multi-floor path on a single floor */
interface MultiFloorPathSegment {
  floorIndex: number;
  elevation: number;
  tiles: TileCoord[];
  endsAtStair: boolean;
  stairDirection?: WallDirection;
}

/** Complete multi-floor path */
interface MultiFloorPath {
  segments: MultiFloorPathSegment[];
  totalTiles: number;
}

// ============================================================================
// COLORS
// ============================================================================

const COLORS = {
  WALKABLE_FLOOR_0: 0x00ff00, // Green - ground floor interior
  WALKABLE_FLOOR_1: 0x00cc00, // Lighter green - upper floors
  EXTERIOR_TILE: 0x336633, // Gray-green - ground outside building
  NON_WALKABLE: 0xff0000, // Red - blocked
  DOOR: 0x00ffff, // Cyan - door openings
  STAIR: 0xff00ff, // Magenta - stairs
  WALL_NORTH: 0xff8800,
  WALL_SOUTH: 0xff6600,
  WALL_EAST: 0xff4400,
  WALL_WEST: 0xff2200,
  ENTRY_POINT: 0xffff00, // Yellow - entry markers
  PATH_LINE: 0x0088ff, // Blue - path line
  PATH_TILE: 0xffaa00, // Orange - path tiles
  POINT_A: 0x00ffff, // Cyan - start point
  POINT_B: 0xff00ff, // Magenta - end point
  OUTSIDE_TILE: 0x004400, // Dark green - outside building
};

// ============================================================================
// COORDINATE HELPERS
// ============================================================================

function tileKey(x: number, z: number): string {
  return `${x},${z}`;
}

function parseTileKey(key: string): TileCoord {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
}

/**
 * Convert building cell to world tile coordinate
 */
function cellToWorldTile(
  col: number,
  row: number,
  buildingCenterX: number,
  buildingCenterZ: number,
  buildingWidth: number,
  buildingDepth: number,
  rotation: number,
): TileCoord {
  // Cell (0,0) is at the SW corner of the building
  // Building center is at (width/2, depth/2) in cell space
  const localX = (col - buildingWidth / 2 + 0.5) * CELL_SIZE;
  const localZ = (row - buildingDepth / 2 + 0.5) * CELL_SIZE;

  // Apply rotation around building center
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;

  // Convert to world coordinates and then to tile
  return {
    x: Math.floor(buildingCenterX + rotatedX),
    z: Math.floor(buildingCenterZ + rotatedZ),
  };
}

/**
 * Rotate a wall direction based on building rotation
 */
function rotateWallDirection(
  direction: WallDirection,
  rotation: number,
): WallDirection {
  const normalized = ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const quadrant = Math.round(normalized / (Math.PI / 2)) % 4;
  const directions: WallDirection[] = ["north", "east", "south", "west"];
  const dirIndex = directions.indexOf(direction);
  return directions[(dirIndex + quadrant) % 4];
}

/**
 * Get opposite wall direction
 */
function getOppositeWallDirection(dir: WallDirection): WallDirection {
  const map: Record<WallDirection, WallDirection> = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
  };
  return map[dir];
}

/**
 * Convert direction string to WallDirection
 */
function toWallDirection(dir: string): WallDirection {
  const normalized = dir.toLowerCase();
  if (normalized === "north" || normalized === "n") return "north";
  if (normalized === "south" || normalized === "s") return "south";
  if (normalized === "east" || normalized === "e") return "east";
  if (normalized === "west" || normalized === "w") return "west";
  return "south";
}

// ============================================================================
// COLLISION DATA GENERATION
// ============================================================================

/**
 * Check if rotation is a valid 90-degree increment (0, π/2, π, 3π/2)
 * Wall positioning assumes axis-aligned cells - arbitrary rotations are NOT supported.
 */
function isValidRotation(rotation: number): boolean {
  const normalized = ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const tolerance = 0.01; // Allow small floating point errors
  const validAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  return validAngles.some((angle) => Math.abs(normalized - angle) < tolerance);
}

/**
 * Generate collision data from a building layout
 * (Standalone implementation - no BuildingCollisionService dependency)
 *
 * NOTE: Only 0/90/180/270 degree rotations are supported.
 * Arbitrary rotations will produce incorrect wall positions.
 */
function generateCollisionData(
  buildingId: string,
  layout: BuildingLayout,
  worldPosition: { x: number; y: number; z: number },
  rotation: number,
): BuildingCollisionData {
  // Validate rotation is a 90-degree increment
  if (!isValidRotation(rotation)) {
    console.warn(
      `[NavigationVisualizer] Building "${buildingId}" has non-90-degree rotation (${(rotation * 180) / Math.PI}°). ` +
        `Wall collision data may be incorrect. Only 0°, 90°, 180°, 270° rotations are supported.`,
    );
  }

  const floors: FloorCollisionData[] = [];
  let minTileX = Infinity;
  let maxTileX = -Infinity;
  let minTileZ = Infinity;
  let maxTileZ = -Infinity;

  for (let floorIndex = 0; floorIndex < layout.floors; floorIndex++) {
    const floorPlan = layout.floorPlans[floorIndex];
    if (!floorPlan) continue;

    const floorData = generateFloorCollisionData(
      floorIndex,
      floorPlan,
      layout,
      worldPosition,
      rotation,
    );

    floors.push(floorData);

    // Update bounding box
    for (const key of floorData.walkableTiles) {
      const { x, z } = parseTileKey(key);
      minTileX = Math.min(minTileX, x);
      maxTileX = Math.max(maxTileX, x);
      minTileZ = Math.min(minTileZ, z);
      maxTileZ = Math.max(maxTileZ, z);
    }
  }

  // Add exterior walkable tiles around the building (ground floor only)
  // This allows pathfinding from outside to inside
  const floor0 = floors[0];
  if (floor0) {
    const padding = 8; // tiles around building that are walkable
    for (let x = minTileX - padding; x <= maxTileX + padding; x++) {
      for (let z = minTileZ - padding; z <= maxTileZ + padding; z++) {
        const key = tileKey(x, z);
        // Only add if not already an interior tile
        if (!floor0.walkableTiles.has(key)) {
          floor0.exteriorTiles.add(key);
        }
      }
    }
  }

  return {
    buildingId,
    worldPosition,
    rotation,
    cellWidth: layout.width,
    cellDepth: layout.depth,
    floors,
    boundingBox: { minTileX, maxTileX, minTileZ, maxTileZ },
  };
}

/**
 * Generate collision data for a single floor
 */
function generateFloorCollisionData(
  floorIndex: number,
  floorPlan: FloorPlan,
  layout: BuildingLayout,
  worldPosition: { x: number; y: number; z: number },
  rotation: number,
): FloorCollisionData {
  const walkableTiles = new Set<string>();
  const exteriorTiles = new Set<string>(); // Will be populated later for floor 0
  const wallSegments: WallSegment[] = [];
  const stairTiles: StairTile[] = [];

  const elevation =
    worldPosition.y + FOUNDATION_HEIGHT + floorIndex * FLOOR_HEIGHT;
  const tilesPerCell = TILES_PER_CELL;

  // Process each cell in the footprint
  for (let row = 0; row < floorPlan.footprint.length; row++) {
    for (let col = 0; col < floorPlan.footprint[row].length; col++) {
      if (!floorPlan.footprint[row][col]) continue;

      // Get center tile of this cell
      const centerTile = cellToWorldTile(
        col,
        row,
        worldPosition.x,
        worldPosition.z,
        layout.width,
        layout.depth,
        rotation,
      );

      // Register all tiles within this cell as walkable
      const halfTiles = Math.floor(tilesPerCell / 2);
      for (let dtx = -halfTiles; dtx < tilesPerCell - halfTiles; dtx++) {
        for (let dtz = -halfTiles; dtz < tilesPerCell - halfTiles; dtz++) {
          walkableTiles.add(tileKey(centerTile.x + dtx, centerTile.z + dtz));
        }
      }

      // Generate walls for this cell
      const cellWalls = generateCellWalls(
        col,
        row,
        floorPlan,
        worldPosition,
        rotation,
        layout.width,
        layout.depth,
      );
      wallSegments.push(...cellWalls);
    }
  }

  // Process stairs on this floor
  if (layout.stairs && floorIndex < layout.floors - 1) {
    const stairData = generateStairTiles(
      layout.stairs,
      floorIndex,
      worldPosition,
      rotation,
      layout.width,
      layout.depth,
    );
    stairTiles.push(...stairData);
  }

  return {
    floorIndex,
    elevation,
    walkableTiles,
    exteriorTiles,
    wallSegments,
    stairTiles,
  };
}

/**
 * Generate wall segments for a cell
 *
 * IMPORTANT: Each cell is TILES_PER_CELL x TILES_PER_CELL tiles (typically 4x4).
 * Walls must be registered for ALL tiles along the cell edge, not just the center.
 * Otherwise paths can slip through tiles that don't have wall data.
 */
function generateCellWalls(
  col: number,
  row: number,
  floorPlan: FloorPlan,
  worldPosition: { x: number; y: number; z: number },
  rotation: number,
  buildingWidth: number,
  buildingDepth: number,
): WallSegment[] {
  const walls: WallSegment[] = [];
  const directions: Array<{ dir: WallDirection; dc: number; dr: number }> = [
    { dir: "north", dc: 0, dr: -1 },
    { dir: "south", dc: 0, dr: 1 },
    { dir: "east", dc: 1, dr: 0 },
    { dir: "west", dc: -1, dr: 0 },
  ];

  // Get center tile of this cell
  const centerTile = cellToWorldTile(
    col,
    row,
    worldPosition.x,
    worldPosition.z,
    buildingWidth,
    buildingDepth,
    rotation,
  );

  // Calculate tile offsets for the cell (cell is TILES_PER_CELL x TILES_PER_CELL)
  const halfTiles = Math.floor(TILES_PER_CELL / 2);

  for (const { dir, dc, dr } of directions) {
    const neighborCol = col + dc;
    const neighborRow = row + dr;

    // Check if there's a cell on this side
    const hasNeighbor =
      neighborRow >= 0 &&
      neighborRow < floorPlan.footprint.length &&
      neighborCol >= 0 &&
      neighborCol < (floorPlan.footprint[neighborRow]?.length ?? 0) &&
      floorPlan.footprint[neighborRow]?.[neighborCol];

    // Determine wall properties
    let hasWall = false;
    let hasOpening = false;
    let openingType: "door" | "arch" | "window" | undefined;

    if (hasNeighbor) {
      // Internal wall - check for openings
      const openingKey = `${col},${row},${dir}`;
      const opening = floorPlan.internalOpenings.get(openingKey);

      if (!opening) {
        // Solid internal wall - check room boundaries
        const currentRoom = floorPlan.roomMap[row]?.[col] ?? -1;
        const neighborRoom =
          floorPlan.roomMap[neighborRow]?.[neighborCol] ?? -1;

        if (currentRoom !== neighborRoom) {
          hasWall = true;
        }
      } else {
        hasWall = true;
        hasOpening = true;
        openingType = opening === "door" ? "door" : "arch";
      }
    } else {
      // External wall - always has a wall
      hasWall = true;
      const openingKey = `${col},${row},${dir}`;
      const opening = floorPlan.externalOpenings.get(openingKey);
      if (opening && (opening === "door" || opening === "arch")) {
        hasOpening = true;
        openingType = opening === "door" ? "door" : "arch";
      } else if (opening === "window") {
        // Windows are walls (not openings for walking)
        openingType = "window";
      }
    }

    if (!hasWall) continue;

    // Get the rotated wall direction
    const worldDir = rotateWallDirection(dir, rotation);

    // Register wall for ALL tiles along this edge of the cell
    // For north/south walls: iterate along X axis
    // For east/west walls: iterate along Z axis
    // IMPORTANT: Doors/openings should only be on CENTER tiles, not all edge tiles!
    for (
      let offset = -halfTiles;
      offset < TILES_PER_CELL - halfTiles;
      offset++
    ) {
      let tileX = centerTile.x;
      let tileZ = centerTile.z;

      // Determine which tiles are on this edge based on direction
      // After rotation, we need to apply the offset along the appropriate axis
      if (worldDir === "north" || worldDir === "south") {
        // North/south walls span the X axis
        tileX = centerTile.x + offset;
        // Position the wall on the correct edge
        if (worldDir === "north") {
          tileZ = centerTile.z - halfTiles; // North edge
        } else {
          tileZ = centerTile.z + (TILES_PER_CELL - halfTiles - 1); // South edge
        }
      } else {
        // East/west walls span the Z axis
        tileZ = centerTile.z + offset;
        // Position the wall on the correct edge
        if (worldDir === "west") {
          tileX = centerTile.x - halfTiles; // West edge
        } else {
          tileX = centerTile.x + (TILES_PER_CELL - halfTiles - 1); // East edge
        }
      }

      // Doors/arches should only be on the CENTER tiles (middle tiles of the edge)
      // For a cell with TILES_PER_CELL tiles, the center tiles are around offset 0
      // Calculate dynamically: center tiles are the middle 2 tiles (or 1 if odd)
      const centerStart = -Math.floor(TILES_PER_CELL / 4); // -1 for TILES_PER_CELL=4
      const centerEnd = Math.ceil(TILES_PER_CELL / 4) - 1; // 0 for TILES_PER_CELL=4
      const isCenterTile = offset >= centerStart && offset <= centerEnd;
      const tileHasOpening = hasOpening && isCenterTile;

      walls.push({
        tileX,
        tileZ,
        side: worldDir,
        hasOpening: tileHasOpening,
        openingType: tileHasOpening ? openingType : undefined,
      });
    }
  }

  return walls;
}

/**
 * Generate stair tiles
 */
function generateStairTiles(
  stairs: StairPlacement,
  floorIndex: number,
  worldPosition: { x: number; y: number; z: number },
  rotation: number,
  buildingWidth: number,
  buildingDepth: number,
): StairTile[] {
  const tiles: StairTile[] = [];
  const direction = toWallDirection(stairs.direction);

  // Bottom of stairs (departure tile)
  const bottomTile = cellToWorldTile(
    stairs.col,
    stairs.row,
    worldPosition.x,
    worldPosition.z,
    buildingWidth,
    buildingDepth,
    rotation,
  );

  tiles.push({
    tileX: bottomTile.x,
    tileZ: bottomTile.z,
    fromFloor: floorIndex,
    toFloor: floorIndex + 1,
    direction: rotateWallDirection(direction, rotation),
    isLanding: false,
  });

  // Top of stairs (landing tile)
  const landingTile = cellToWorldTile(
    stairs.landing.col,
    stairs.landing.row,
    worldPosition.x,
    worldPosition.z,
    buildingWidth,
    buildingDepth,
    rotation,
  );

  tiles.push({
    tileX: landingTile.x,
    tileZ: landingTile.z,
    fromFloor: floorIndex,
    toFloor: floorIndex + 1,
    direction: rotateWallDirection(direction, rotation),
    isLanding: true,
  });

  return tiles;
}

// ============================================================================
// BFS PATHFINDING (Standalone implementation)
// ============================================================================

/** Direction offsets for 8-directional movement */
const TILE_DIRECTIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -1, z: 0 }, // West
  { x: 1, z: 0 }, // East
  { x: 0, z: -1 }, // South
  { x: 0, z: 1 }, // North
  { x: -1, z: -1 }, // SW
  { x: 1, z: -1 }, // SE
  { x: -1, z: 1 }, // NW
  { x: 1, z: 1 }, // NE
];

type WalkabilityChecker = (tile: TileCoord, fromTile?: TileCoord) => boolean;

/** Result of creating a walkability checker - includes both the function and wall data for validation */
interface WalkabilityCheckerResult {
  isWalkable: WalkabilityChecker;
  wallLookup: Map<string, Set<WallDirection>>;
}

/**
 * BFS Pathfinding with naive diagonal approach
 */
function findPath(
  start: TileCoord,
  end: TileCoord,
  isWalkable: WalkabilityChecker,
  maxIterations = 2000,
): TileCoord[] {
  // Already at destination
  if (start.x === end.x && start.z === end.z) {
    return [];
  }

  // Try naive diagonal path first
  const naivePath = findNaiveDiagonalPath(start, end, isWalkable);
  if (naivePath.length > 0) {
    return naivePath;
  }

  // Fall back to BFS
  return findBFSPath(start, end, isWalkable, maxIterations);
}

/**
 * Naive diagonal pathing (OSRS follow-mode style)
 */
function findNaiveDiagonalPath(
  start: TileCoord,
  end: TileCoord,
  isWalkable: WalkabilityChecker,
): TileCoord[] {
  const path: TileCoord[] = [];
  let current = { ...start };
  let iterations = 0;

  while ((current.x !== end.x || current.z !== end.z) && iterations < 500) {
    iterations++;

    const dx = Math.sign(end.x - current.x);
    const dz = Math.sign(end.z - current.z);
    let nextTile: TileCoord | null = null;

    if (dx !== 0 && dz !== 0) {
      // Diagonal movement
      const diagonal: TileCoord = { x: current.x + dx, z: current.z + dz };
      if (canMoveTo(current, diagonal, isWalkable)) {
        nextTile = diagonal;
      } else {
        // Try cardinals
        const xDist = Math.abs(end.x - current.x);
        const zDist = Math.abs(end.z - current.z);

        if (xDist >= zDist) {
          const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
          const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
          if (canMoveTo(current, cardinalX, isWalkable)) nextTile = cardinalX;
          else if (canMoveTo(current, cardinalZ, isWalkable))
            nextTile = cardinalZ;
        } else {
          const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
          const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
          if (canMoveTo(current, cardinalZ, isWalkable)) nextTile = cardinalZ;
          else if (canMoveTo(current, cardinalX, isWalkable))
            nextTile = cardinalX;
        }
      }
    } else if (dx !== 0) {
      const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
      if (canMoveTo(current, cardinalX, isWalkable)) nextTile = cardinalX;
    } else if (dz !== 0) {
      const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
      if (canMoveTo(current, cardinalZ, isWalkable)) nextTile = cardinalZ;
    }

    if (!nextTile) return []; // Blocked - use BFS
    path.push(nextTile);
    current = nextTile;

    if (path.length > 200) return path;
  }

  return path;
}

/**
 * BFS pathfinding
 */
function findBFSPath(
  start: TileCoord,
  end: TileCoord,
  isWalkable: WalkabilityChecker,
  maxIterations: number,
): TileCoord[] {
  const visited = new Set<string>();
  const parent = new Map<string, TileCoord>();
  const queue: TileCoord[] = [start];
  visited.add(tileKey(start.x, start.z));

  let iterations = 0;
  let queueIndex = 0;

  while (queueIndex < queue.length && iterations < maxIterations) {
    iterations++;
    const current = queue[queueIndex++];

    if (current.x === end.x && current.z === end.z) {
      return reconstructPath(start, end, parent);
    }

    for (const dir of TILE_DIRECTIONS) {
      const neighbor: TileCoord = {
        x: current.x + dir.x,
        z: current.z + dir.z,
      };
      const neighborKey = tileKey(neighbor.x, neighbor.z);

      if (visited.has(neighborKey)) continue;
      if (!canMoveTo(current, neighbor, isWalkable)) continue;

      visited.add(neighborKey);
      parent.set(neighborKey, current);
      queue.push(neighbor);
    }
  }

  // Return partial path to closest tile
  return findPartialPath(start, end, visited, parent);
}

/**
 * Check if movement between tiles is valid
 */
function canMoveTo(
  from: TileCoord,
  to: TileCoord,
  isWalkable: WalkabilityChecker,
): boolean {
  if (!isWalkable(to, from)) return false;

  const dx = to.x - from.x;
  const dz = to.z - from.z;

  // Diagonal corner clipping check
  if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
    const cardinalX: TileCoord = { x: from.x + dx, z: from.z };
    const cardinalZ: TileCoord = { x: from.x, z: from.z + dz };
    if (!isWalkable(cardinalX, from) || !isWalkable(cardinalZ, from)) {
      return false;
    }
  }

  return true;
}

/**
 * Reconstruct path from parent map
 */
function reconstructPath(
  start: TileCoord,
  end: TileCoord,
  parent: Map<string, TileCoord>,
): TileCoord[] {
  const path: TileCoord[] = [];
  let current = end;

  while (current.x !== start.x || current.z !== start.z) {
    path.push(current);
    const p = parent.get(tileKey(current.x, current.z));
    if (!p) break;
    current = p;
  }

  path.reverse();
  return path.slice(0, 200);
}

/**
 * Find partial path to closest visited tile
 */
function findPartialPath(
  start: TileCoord,
  end: TileCoord,
  visited: Set<string>,
  parent: Map<string, TileCoord>,
): TileCoord[] {
  let closest: TileCoord | null = null;
  let closestDist = Infinity;

  for (const key of visited) {
    const tile = parseTileKey(key);
    const dist = Math.abs(tile.x - end.x) + Math.abs(tile.z - end.z);
    if (dist < closestDist) {
      closestDist = dist;
      closest = tile;
    }
  }

  if (!closest || (closest.x === start.x && closest.z === start.z)) {
    return [];
  }

  return reconstructPath(start, closest, parent);
}

/**
 * Validate a path doesn't go through any walls
 * @throws Error if any step in the path goes through a wall
 */
function validatePath(
  path: TileCoord[],
  start: TileCoord,
  isWalkable: WalkabilityChecker,
  wallLookup: Map<string, Set<WallDirection>>,
): void {
  if (path.length === 0) return;

  const fullPath = [start, ...path];

  for (let i = 0; i < fullPath.length - 1; i++) {
    const from = fullPath[i];
    const to = fullPath[i + 1];

    // Check if movement is walkable
    if (!isWalkable(to, from)) {
      // Get wall info for better error message
      const toKey = tileKey(to.x, to.z);
      const fromKey = tileKey(from.x, from.z);
      const toWalls = wallLookup.get(toKey);
      const fromWalls = wallLookup.get(fromKey);

      const dx = to.x - from.x;
      const dz = to.z - from.z;

      // Determine which direction we were trying to move
      let moveDesc = "";
      if (dx === 0 && dz === 1) moveDesc = "south (dz=+1)";
      else if (dx === 0 && dz === -1) moveDesc = "north (dz=-1)";
      else if (dx === 1 && dz === 0) moveDesc = "east (dx=+1)";
      else if (dx === -1 && dz === 0) moveDesc = "west (dx=-1)";
      else moveDesc = `diagonal (dx=${dx}, dz=${dz})`;

      throw new Error(
        `PATH VALIDATION ERROR: Path step ${i} goes through wall!\n` +
          `  From: (${from.x}, ${from.z}) walls: [${fromWalls ? [...fromWalls].join(", ") : "none"}]\n` +
          `  To: (${to.x}, ${to.z}) walls: [${toWalls ? [...toWalls].join(", ") : "none"}]\n` +
          `  Direction: ${moveDesc}\n` +
          `  This is a bug in the pathfinding or wall detection logic.`,
      );
    }

    // Also validate diagonal corner clipping
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
      const cardinalX: TileCoord = { x: from.x + dx, z: from.z };
      const cardinalZ: TileCoord = { x: from.x, z: from.z + dz };

      // Both cardinal paths must be walkable for diagonal to be valid
      if (!isWalkable(cardinalX, from) || !isWalkable(cardinalZ, from)) {
        throw new Error(
          `PATH VALIDATION ERROR: Diagonal step ${i} clips through corner!\n` +
            `  From: (${from.x}, ${from.z})\n` +
            `  To: (${to.x}, ${to.z})\n` +
            `  Cardinal X (${cardinalX.x}, ${cardinalX.z}) walkable: ${isWalkable(cardinalX, from)}\n` +
            `  Cardinal Z (${cardinalZ.x}, ${cardinalZ.z}) walkable: ${isWalkable(cardinalZ, from)}\n` +
            `  Diagonal movement requires both cardinal adjacent tiles to be walkable.`,
        );
      }
    }
  }
}

// ============================================================================
// MULTI-FLOOR PATHFINDING
// ============================================================================

/**
 * Find a path that can span multiple floors using stairs
 *
 * The algorithm:
 * 1. Start on the source floor
 * 2. If destination is on same floor, find direct path
 * 3. If destination is on different floor, find path to appropriate stair
 * 4. Transition through stair to next floor
 * 5. Repeat until destination floor is reached
 * 6. Find final path to destination on that floor
 *
 * @param start - Starting tile and floor
 * @param end - Destination tile and floor
 * @param floors - All floor collision data
 * @param createChecker - Function to create walkability checker for a floor
 * @returns MultiFloorPath with segments for each floor, or null if no path found
 */
function findMultiFloorPath(
  start: MultiFloorTile,
  end: MultiFloorTile,
  floors: FloorCollisionData[],
  createChecker: (floorIndex: number) => WalkabilityCheckerResult,
): MultiFloorPath | null {
  const segments: MultiFloorPathSegment[] = [];
  let currentTile: TileCoord = { x: start.x, z: start.z };
  let currentFloor = start.floor;

  // Maximum iterations to prevent infinite loops
  const maxFloorTransitions = floors.length * 2;
  let transitions = 0;

  while (transitions < maxFloorTransitions) {
    transitions++;

    const floor = floors[currentFloor];
    if (!floor) {
      console.error(`[MultiFloorPath] Floor ${currentFloor} not found`);
      return null;
    }

    const checker = createChecker(currentFloor);

    // Are we on the destination floor?
    if (currentFloor === end.floor) {
      // Find path to destination
      const path = findPath(
        currentTile,
        { x: end.x, z: end.z },
        checker.isWalkable,
      );

      if (
        path.length === 0 &&
        (currentTile.x !== end.x || currentTile.z !== end.z)
      ) {
        // Can't reach destination on this floor
        console.warn(
          `[MultiFloorPath] Can't reach destination on floor ${currentFloor}`,
        );
        return null;
      }

      segments.push({
        floorIndex: currentFloor,
        elevation: floor.elevation,
        tiles: [currentTile, ...path],
        endsAtStair: false,
      });

      const totalTiles = segments.reduce(
        (sum, seg) => sum + seg.tiles.length,
        0,
      );
      return { segments, totalTiles };
    }

    // Need to change floors - find stairs
    const targetFloorHigher = end.floor > currentFloor;
    const stairTiles = floor.stairTiles;

    // Find a stair that goes in the right direction
    // Stair data structure:
    // - fromFloor: lower floor index
    // - toFloor: higher floor index (always fromFloor + 1)
    // - isLanding: false = bottom of stairs (on fromFloor), true = top of stairs (on toFloor)
    let targetStair: StairTile | null = null;
    for (const stair of stairTiles) {
      if (targetFloorHigher) {
        // Going UP - need the bottom of stairs (isLanding=false) that leads to a higher floor
        // We're on currentFloor, so we need fromFloor === currentFloor
        if (
          !stair.isLanding &&
          stair.fromFloor === currentFloor &&
          stair.toFloor > currentFloor
        ) {
          targetStair = stair;
          break;
        }
      } else {
        // Going DOWN - need the landing/top of stairs (isLanding=true) on current floor
        // The landing is on toFloor, so we need toFloor === currentFloor
        if (
          stair.isLanding &&
          stair.toFloor === currentFloor &&
          stair.fromFloor < currentFloor
        ) {
          targetStair = stair;
          break;
        }
      }
    }

    // If no direct stair found, check for any stair that gets us closer
    if (!targetStair) {
      for (const stair of stairTiles) {
        if (targetFloorHigher) {
          // Any stair bottom on this floor that goes up
          if (!stair.isLanding && stair.fromFloor === currentFloor) {
            targetStair = stair;
            break;
          }
        } else {
          // Any stair top/landing on this floor that goes down
          if (stair.isLanding && stair.toFloor === currentFloor) {
            targetStair = stair;
            break;
          }
        }
      }
    }

    if (!targetStair) {
      console.warn(
        `[MultiFloorPath] No stair found on floor ${currentFloor} to reach floor ${end.floor}`,
      );
      return null;
    }

    // Find path to stair
    const stairTile: TileCoord = { x: targetStair.tileX, z: targetStair.tileZ };
    const pathToStair = findPath(currentTile, stairTile, checker.isWalkable);

    if (
      pathToStair.length === 0 &&
      (currentTile.x !== stairTile.x || currentTile.z !== stairTile.z)
    ) {
      console.warn(
        `[MultiFloorPath] Can't reach stair at (${stairTile.x}, ${stairTile.z}) from (${currentTile.x}, ${currentTile.z})`,
      );
      return null;
    }

    segments.push({
      floorIndex: currentFloor,
      elevation: floor.elevation,
      tiles: [currentTile, ...pathToStair],
      endsAtStair: true,
      stairDirection: targetStair.direction,
    });

    // Transition to next floor
    // Going UP: we arrive at toFloor (the landing)
    // Going DOWN: we arrive at fromFloor (the bottom)
    const nextFloorIndex = targetFloorHigher
      ? targetStair.toFloor
      : targetStair.fromFloor;
    const nextFloor = floors[nextFloorIndex];
    if (!nextFloor) {
      console.warn(`[MultiFloorPath] Next floor ${nextFloorIndex} not found`);
      return null;
    }

    // Find matching stair tile on next floor
    // The stair connects the same two floors, so both floors have stair tiles
    const matchingStair = nextFloor.stairTiles.find((s) => {
      // Match by direction (same staircase)
      if (s.direction !== targetStair!.direction) return false;
      // Match by connected floors
      if (
        s.fromFloor !== targetStair!.fromFloor ||
        s.toFloor !== targetStair!.toFloor
      )
        return false;

      // If going up, we arrive at the landing (top); if going down, we arrive at bottom
      if (targetFloorHigher) {
        return s.isLanding; // We arrive at the landing
      } else {
        return !s.isLanding; // We arrive at the bottom
      }
    });

    if (matchingStair) {
      currentTile = { x: matchingStair.tileX, z: matchingStair.tileZ };
    } else {
      // Fallback: estimate position based on stair direction
      // The landing is offset from the bottom by the stair direction
      const dirVec = getSideVector(targetStair.direction);
      if (targetFloorHigher) {
        // Going up - landing is in the direction of stair
        currentTile = {
          x: targetStair.tileX + dirVec.x * TILES_PER_CELL,
          z: targetStair.tileZ + dirVec.z * TILES_PER_CELL,
        };
      } else {
        // Going down - bottom is opposite of stair direction from landing
        currentTile = {
          x: targetStair.tileX - dirVec.x * TILES_PER_CELL,
          z: targetStair.tileZ - dirVec.z * TILES_PER_CELL,
        };
      }
    }
    currentFloor = nextFloorIndex;
  }

  console.error(
    "[MultiFloorPath] Too many floor transitions - possible infinite loop",
  );
  return null;
}

// ============================================================================
// NAVIGATION VISUALIZER CLASS
// ============================================================================

export class NavigationVisualizer {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private raycaster: THREE.Raycaster;
  private groundPlane: THREE.Plane;

  // Visualization groups
  private visualizationGroup: THREE.Group;
  private pathGroup: THREE.Group;
  private markerGroup: THREE.Group;

  // Shared geometries
  private tileGeometry: THREE.PlaneGeometry;
  private wallGeometry: THREE.BoxGeometry;
  private markerGeometry: THREE.SphereGeometry;

  // Materials cache
  private materials: Map<number, THREE.MeshBasicMaterial> = new Map();

  // State
  private collisionData: BuildingCollisionData | null = null;
  private options: NavigationVisualizerOptions;
  private clickState: ClickState = { pointA: null, pointB: null };
  private enabled = false;

  // Town mode
  private townData: GeneratedTown | null = null;
  private selectedBuildingIndex = -1;
  private buildingCollisionDataCache: Map<number, BuildingCollisionData> =
    new Map();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.visualizationGroup = new THREE.Group();
    this.visualizationGroup.name = "NavigationVisualization";

    this.pathGroup = new THREE.Group();
    this.pathGroup.name = "NavigationPaths";

    this.markerGroup = new THREE.Group();
    this.markerGroup.name = "NavigationMarkers";

    this.tileGeometry = new THREE.PlaneGeometry(0.9, 0.9);
    this.wallGeometry = new THREE.BoxGeometry(0.1, 0.5, 1.0);
    this.markerGeometry = new THREE.SphereGeometry(0.3, 16, 16);

    this.options = {
      showWalkableTiles: true,
      showDoors: true,
      showStairs: true,
      showWalls: true,
      showEntryPoints: true,
      showDemoPaths: true,
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Set building layout for visualization
   */
  setBuilding(
    layout: BuildingLayout,
    worldPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    rotation: number = 0,
  ): void {
    this.townData = null;
    this.selectedBuildingIndex = -1;
    this.buildingCollisionDataCache.clear();

    this.collisionData = generateCollisionData(
      "viewer-building",
      layout,
      worldPosition,
      rotation,
    );

    if (this.enabled) {
      this.updateVisualization();
    }
  }

  /**
   * Set town for visualization (with building selection)
   */
  setTown(
    town: GeneratedTown,
    buildingGenerator: {
      generate: (
        type: string,
        opts: { seed: string },
      ) => { layout: BuildingLayout } | null;
    },
  ): void {
    this.townData = town;
    this.collisionData = null;
    this.selectedBuildingIndex = -1;
    this.buildingCollisionDataCache.clear();

    // Pre-generate collision data for all buildings
    for (let i = 0; i < town.buildings.length; i++) {
      const building = town.buildings[i];
      const seed = `nav_${town.id}_${building.id}`;
      const result = buildingGenerator.generate(building.type, { seed });

      if (result) {
        const collisionData = generateCollisionData(
          building.id,
          result.layout,
          { x: building.position.x, y: 0, z: building.position.z },
          building.rotation,
        );
        this.buildingCollisionDataCache.set(i, collisionData);
      }
    }

    if (this.enabled) {
      this.updateVisualization();
    }
  }

  /**
   * Select a building in town mode
   */
  selectBuilding(index: number): void {
    if (!this.townData) return;

    this.selectedBuildingIndex = index;
    this.collisionData = this.buildingCollisionDataCache.get(index) ?? null;

    if (this.enabled) {
      this.updateVisualization();
    }
  }

  /**
   * Enable/disable visualization
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (enabled) {
      this.scene.add(this.visualizationGroup);
      this.scene.add(this.pathGroup);
      this.scene.add(this.markerGroup);
      this.updateVisualization();
    } else {
      this.scene.remove(this.visualizationGroup);
      this.scene.remove(this.pathGroup);
      this.scene.remove(this.markerGroup);
      this.clearVisualization();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update visualization options
   */
  setOptions(options: Partial<NavigationVisualizerOptions>): void {
    this.options = { ...this.options, ...options };
    if (this.enabled) {
      this.updateVisualization();
    }
  }

  getOptions(): NavigationVisualizerOptions {
    return { ...this.options };
  }

  /**
   * Handle mouse click for A→B pathfinding
   * @param event Mouse event
   * @param canvas Canvas element
   * @param button 0 = left (set A), 2 = right (set B)
   */
  handleClick(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    button: number,
  ): void {
    if (!this.enabled || !this.collisionData) return;

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(mouse, this.camera);
    const target = new THREE.Vector3();

    // Update ground plane to match building elevation
    const elevation = this.collisionData.floors[0]?.elevation ?? 0;
    this.groundPlane.constant = -elevation;

    const ray = this.raycaster.ray;
    const hit = ray.intersectPlane(this.groundPlane, target);

    if (!hit) return;

    const tile: TileCoord = {
      x: Math.floor(target.x),
      z: Math.floor(target.z),
    };

    if (button === 0) {
      // Left click - set point A
      this.clickState.pointA = tile;
    } else if (button === 2) {
      // Right click - set point B
      this.clickState.pointB = tile;
    }

    this.updateMarkers();
    this.updateUserPath();
  }

  /**
   * Clear A→B path
   */
  clearUserPath(): void {
    this.clickState = { pointA: null, pointB: null };
    this.clearMarkers();
    this.clearPath("user-path");
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearVisualization();
    this.tileGeometry.dispose();
    this.wallGeometry.dispose();
    this.markerGeometry.dispose();

    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();

    this.scene.remove(this.visualizationGroup);
    this.scene.remove(this.pathGroup);
    this.scene.remove(this.markerGroup);
  }

  // ===========================================================================
  // VISUALIZATION
  // ===========================================================================

  private updateVisualization(): void {
    this.clearVisualization();

    if (!this.collisionData) {
      // Town mode - show all buildings as outlines
      if (this.townData) {
        this.visualizeTownOverview();
      }
      return;
    }

    // Visualize building collision data
    for (const floor of this.collisionData.floors) {
      if (this.options.showWalkableTiles) {
        this.visualizeWalkableTiles(floor);
      }

      if (this.options.showWalls) {
        this.visualizeWalls(floor);
      }

      if (this.options.showDoors) {
        this.visualizeDoors(floor);
      }

      if (this.options.showStairs) {
        this.visualizeStairs(floor);
      }
    }

    if (this.options.showEntryPoints) {
      this.visualizeEntryPoints();
    }

    if (this.options.showDemoPaths) {
      this.visualizeDemoPaths();
    }
  }

  private clearVisualization(): void {
    // Clear visualization group
    while (this.visualizationGroup.children.length > 0) {
      const child = this.visualizationGroup.children[0];
      this.visualizationGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }

    // Clear path group
    while (this.pathGroup.children.length > 0) {
      const child = this.pathGroup.children[0];
      this.pathGroup.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
      }
    }
  }

  private clearMarkers(): void {
    while (this.markerGroup.children.length > 0) {
      const child = this.markerGroup.children[0];
      this.markerGroup.remove(child);
    }
  }

  private clearPath(name: string): void {
    const toRemove: THREE.Object3D[] = [];
    this.pathGroup.traverse((child) => {
      if (child.name === name) {
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      this.pathGroup.remove(obj);
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
      }
      // Meshes share geometry/material from pool, no need to dispose
    }
  }

  // ===========================================================================
  // VISUALIZATION HELPERS
  // ===========================================================================

  private visualizeTownOverview(): void {
    if (!this.townData) return;

    // Show building footprints as colored outlines
    for (let i = 0; i < this.townData.buildings.length; i++) {
      const building = this.townData.buildings[i];
      const collisionData = this.buildingCollisionDataCache.get(i);

      if (!collisionData) continue;

      const isSelected = i === this.selectedBuildingIndex;
      const color = isSelected ? 0xffff00 : 0x888888;

      // Draw bounding box outline
      const { minTileX, maxTileX, minTileZ, maxTileZ } =
        collisionData.boundingBox;
      const width = maxTileX - minTileX + 1;
      const depth = maxTileZ - minTileZ + 1;

      const outlineGeo = new THREE.PlaneGeometry(width, depth);
      const outlineMat = this.getMaterial(color);
      outlineMat.opacity = isSelected ? 0.5 : 0.2;
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      outline.rotation.x = -Math.PI / 2;
      outline.position.set(
        (minTileX + maxTileX) / 2 + 0.5,
        0.02,
        (minTileZ + maxTileZ) / 2 + 0.5,
      );
      outline.name = `building-outline-${i}`;
      this.visualizationGroup.add(outline);

      // Draw entrance marker
      if (building.entrance) {
        const entranceGeo = new THREE.CircleGeometry(0.5, 16);
        const entranceMat = this.getMaterial(COLORS.DOOR);
        const entrance = new THREE.Mesh(entranceGeo, entranceMat);
        entrance.rotation.x = -Math.PI / 2;
        entrance.position.set(
          building.entrance.x - this.townData.position.x,
          0.05,
          building.entrance.z - this.townData.position.z,
        );
        this.visualizationGroup.add(entrance);
      }
    }
  }

  private visualizeWalkableTiles(floor: FloorCollisionData): void {
    const interiorColor =
      floor.floorIndex === 0
        ? COLORS.WALKABLE_FLOOR_0
        : COLORS.WALKABLE_FLOOR_1;
    const y = floor.elevation + 0.02;

    // Interior tiles
    for (const key of floor.walkableTiles) {
      const { x, z } = parseTileKey(key);
      this.addTileMesh(x, y, z, interiorColor);
    }

    // Exterior tiles (ground floor only)
    if (floor.floorIndex === 0 && floor.exteriorTiles.size > 0) {
      for (const key of floor.exteriorTiles) {
        const { x, z } = parseTileKey(key);
        this.addTileMesh(x, y - 0.01, z, COLORS.EXTERIOR_TILE);
      }
    }
  }

  private visualizeWalls(floor: FloorCollisionData): void {
    const y = floor.elevation + 0.25;

    for (const wall of floor.wallSegments) {
      if (wall.hasOpening) continue; // Skip doors/arches

      const colorMap: Record<WallDirection, number> = {
        north: COLORS.WALL_NORTH,
        south: COLORS.WALL_SOUTH,
        east: COLORS.WALL_EAST,
        west: COLORS.WALL_WEST,
      };

      this.addWallIndicator(
        wall.tileX,
        wall.tileZ,
        y,
        wall.side,
        colorMap[wall.side],
      );
    }
  }

  private visualizeDoors(floor: FloorCollisionData): void {
    const y = floor.elevation + 0.25;

    for (const wall of floor.wallSegments) {
      if (!wall.hasOpening || wall.openingType === "window") continue;

      this.addWallIndicator(wall.tileX, wall.tileZ, y, wall.side, COLORS.DOOR);
    }
  }

  private visualizeStairs(floor: FloorCollisionData): void {
    const y = floor.elevation + 0.02;

    for (const stair of floor.stairTiles) {
      // Create stepped visualization
      const stepGeo = new THREE.BoxGeometry(0.8, 0.3, 0.8);
      const stepMat = this.getMaterial(COLORS.STAIR);
      const stepMesh = new THREE.Mesh(stepGeo, stepMat);
      stepMesh.position.set(stair.tileX + 0.5, y + 0.15, stair.tileZ + 0.5);
      this.visualizationGroup.add(stepMesh);

      // Add direction arrow
      const arrowDir = getSideVector(stair.direction);
      const arrowGeo = new THREE.ConeGeometry(0.2, 0.4, 8);
      const arrowMat = this.getMaterial(COLORS.STAIR);
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(
        stair.tileX + 0.5 + arrowDir.x * 0.3,
        y + 0.5,
        stair.tileZ + 0.5 + arrowDir.z * 0.3,
      );
      arrow.rotation.x = Math.PI / 2;
      arrow.rotation.z = Math.atan2(-arrowDir.x, arrowDir.z);
      this.visualizationGroup.add(arrow);
    }
  }

  private visualizeEntryPoints(): void {
    if (!this.collisionData) return;

    const floor0 = this.collisionData.floors[0];
    if (!floor0) return;

    // Find external doors
    const doorWalls = floor0.wallSegments.filter(
      (w) =>
        w.hasOpening && (w.openingType === "door" || w.openingType === "arch"),
    );

    for (const door of doorWalls) {
      // Place entry marker outside the door
      const dirVec = getSideVector(door.side);
      const entryX = door.tileX + dirVec.x * 2;
      const entryZ = door.tileZ + dirVec.z * 2;

      const markerGeo = new THREE.CircleGeometry(0.6, 16);
      const markerMat = this.getMaterial(COLORS.ENTRY_POINT);
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(entryX + 0.5, floor0.elevation + 0.03, entryZ + 0.5);
      this.visualizationGroup.add(marker);
    }
  }

  private visualizeDemoPaths(): void {
    if (!this.collisionData) return;

    const floor0 = this.collisionData.floors[0];
    if (!floor0) return;

    // Find an external door
    const doorWall = floor0.wallSegments.find(
      (w) =>
        w.hasOpening && (w.openingType === "door" || w.openingType === "arch"),
    );

    if (!doorWall) return;

    // Calculate entry point (outside) and floor center
    const dirVec = getSideVector(doorWall.side);
    const entryTile: TileCoord = {
      x: doorWall.tileX + dirVec.x * 5,
      z: doorWall.tileZ + dirVec.z * 5,
    };

    // Find floor center
    const tiles = Array.from(floor0.walkableTiles).map(parseTileKey);
    const centerX = Math.floor(
      tiles.reduce((s, t) => s + t.x, 0) / tiles.length,
    );
    const centerZ = Math.floor(
      tiles.reduce((s, t) => s + t.z, 0) / tiles.length,
    );
    const centerTile: TileCoord = { x: centerX, z: centerZ };

    // Create walkability checker factory for multi-floor path
    const createChecker = (floorIndex: number) =>
      this.createWalkabilityChecker(floorIndex);
    const floor0Checker = createChecker(0);

    // Find path from outside to center (with validation)
    try {
      const path = this.findPathAndValidate(
        entryTile,
        centerTile,
        floor0Checker,
      );

      if (path.length > 0) {
        this.renderPath(
          [entryTile, ...path],
          floor0.elevation + 0.1,
          COLORS.PATH_LINE,
          "demo-path-floor0",
        );
      }

      // If multi-floor building with stairs, show multi-floor path demonstrations
      if (
        this.collisionData.floors.length > 1 &&
        floor0.stairTiles.length > 0
      ) {
        const floor1 = this.collisionData.floors[1];
        if (!floor1) return;

        const stairBottom = floor0.stairTiles.find((s) => !s.isLanding);
        const stairTop = floor0.stairTiles.find((s) => s.isLanding);

        if (stairBottom && stairTop) {
          const stairBottomTile: TileCoord = {
            x: stairBottom.tileX,
            z: stairBottom.tileZ,
          };
          const stairTopTile: TileCoord = {
            x: stairTop.tileX,
            z: stairTop.tileZ,
          };

          // Path from center to stair bottom
          const pathToStair = this.findPathAndValidate(
            centerTile,
            stairBottomTile,
            floor0Checker,
          );
          if (pathToStair.length > 0) {
            this.renderPath(
              [centerTile, ...pathToStair],
              floor0.elevation + 0.1,
              0x00aaff,
              "demo-path-to-stair",
            );
          }

          // Path from stair top to upper floor center
          const floor1Tiles = Array.from(floor1.walkableTiles).map(
            parseTileKey,
          );
          const floor1CenterX = Math.floor(
            floor1Tiles.reduce((s, t) => s + t.x, 0) / floor1Tiles.length,
          );
          const floor1CenterZ = Math.floor(
            floor1Tiles.reduce((s, t) => s + t.z, 0) / floor1Tiles.length,
          );
          const floor1Center: TileCoord = {
            x: floor1CenterX,
            z: floor1CenterZ,
          };

          const floor1Checker = this.createWalkabilityChecker(1);
          const pathOnFloor1 = this.findPathAndValidate(
            stairTopTile,
            floor1Center,
            floor1Checker,
          );

          if (pathOnFloor1.length > 0) {
            this.renderPath(
              [stairTopTile, ...pathOnFloor1],
              floor1.elevation + 0.1,
              0xaa00ff,
              "demo-path-floor1",
            );
          }

          // ===== NEW: Multi-floor path from upper floor to outside =====
          // This demonstrates the ability to navigate DOWN stairs and out of the building
          const multiFloorPath = findMultiFloorPath(
            { x: floor1CenterX, z: floor1CenterZ, floor: 1 },
            { x: entryTile.x, z: entryTile.z, floor: 0 },
            this.collisionData.floors,
            createChecker,
          );

          if (multiFloorPath) {
            this.renderMultiFloorPath(
              multiFloorPath,
              "demo-multifloor-descent",
            );
          }
          // Note: If no multi-floor path found, it's not necessarily an error -
          // the building may only have one floor or no accessible stairs
        }
      }
    } catch (error) {
      // Path validation failed - this is a bug! Make it VERY visible.
      console.error(
        "[NavigationVisualizer] Demo path validation failed - BUG DETECTED:",
        error,
      );

      // Render a big red X at the building center to indicate failure
      const errorMarkerGeo = new THREE.BoxGeometry(2, 2, 2);
      const errorMarkerMat = this.getMaterial(0xff0000);
      const errorMarker = new THREE.Mesh(errorMarkerGeo, errorMarkerMat);
      errorMarker.position.set(
        centerX + 0.5,
        floor0.elevation + 1,
        centerZ + 0.5,
      );
      errorMarker.name = "demo-path-error";
      this.pathGroup.add(errorMarker);

      // Also throw in development to make bugs unmissable
      if (
        typeof process !== "undefined" &&
        process.env?.NODE_ENV === "development"
      ) {
        throw error;
      }
    }
  }

  private updateMarkers(): void {
    this.clearMarkers();

    if (!this.collisionData) return;

    const elevation = this.collisionData.floors[0]?.elevation ?? 0;

    if (this.clickState.pointA) {
      const markerA = new THREE.Mesh(
        this.markerGeometry,
        this.getMaterial(COLORS.POINT_A),
      );
      markerA.position.set(
        this.clickState.pointA.x + 0.5,
        elevation + 0.5,
        this.clickState.pointA.z + 0.5,
      );
      markerA.name = "point-a";
      this.markerGroup.add(markerA);
    }

    if (this.clickState.pointB) {
      const markerB = new THREE.Mesh(
        this.markerGeometry,
        this.getMaterial(COLORS.POINT_B),
      );
      markerB.position.set(
        this.clickState.pointB.x + 0.5,
        elevation + 0.5,
        this.clickState.pointB.z + 0.5,
      );
      markerB.name = "point-b";
      this.markerGroup.add(markerB);
    }
  }

  private updateUserPath(): void {
    this.clearPath("user-path");

    if (
      !this.clickState.pointA ||
      !this.clickState.pointB ||
      !this.collisionData
    )
      return;

    const floor0Checker = this.createWalkabilityChecker(0);
    const elevation = this.collisionData.floors[0]?.elevation ?? 0;

    try {
      const path = this.findPathAndValidate(
        this.clickState.pointA,
        this.clickState.pointB,
        floor0Checker,
      );

      if (path.length > 0) {
        this.renderPath(
          [this.clickState.pointA, ...path],
          elevation + 0.15,
          0x00ff00,
          "user-path",
        );
      } else {
        // No path found - show direct line in red
        this.renderPath(
          [this.clickState.pointA, this.clickState.pointB],
          elevation + 0.15,
          0xff0000,
          "user-path",
        );
      }
    } catch (error) {
      // Path validation failed - show error path in red and log
      console.error(
        "[NavigationVisualizer] User path validation failed - BUG DETECTED:",
        error,
      );
      this.renderPath(
        [this.clickState.pointA, this.clickState.pointB],
        elevation + 0.15,
        0xff0000,
        "user-path",
      );
    }
  }

  // ===========================================================================
  // MESH HELPERS
  // ===========================================================================

  private addTileMesh(x: number, y: number, z: number, color: number): void {
    const material = this.getMaterial(color);
    const mesh = new THREE.Mesh(this.tileGeometry, material);
    mesh.position.set(x + 0.5, y, z + 0.5);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 100;
    this.visualizationGroup.add(mesh);
  }

  private addWallIndicator(
    tileX: number,
    tileZ: number,
    y: number,
    direction: WallDirection,
    color: number,
  ): void {
    const material = this.getMaterial(color);
    const mesh = new THREE.Mesh(this.wallGeometry, material);

    const offset = 0.45;
    let x = tileX + 0.5;
    let z = tileZ + 0.5;

    switch (direction) {
      case "north":
        z += offset;
        mesh.rotation.y = 0;
        break;
      case "south":
        z -= offset;
        mesh.rotation.y = 0;
        break;
      case "east":
        x += offset;
        mesh.rotation.y = Math.PI / 2;
        break;
      case "west":
        x -= offset;
        mesh.rotation.y = Math.PI / 2;
        break;
    }

    mesh.position.set(x, y, z);
    mesh.renderOrder = 101;
    this.visualizationGroup.add(mesh);
  }

  private renderPath(
    tiles: TileCoord[],
    y: number,
    color: number,
    name: string,
  ): void {
    if (tiles.length < 2) return;

    // Draw connecting line
    const points: THREE.Vector3[] = tiles.map(
      (t) => new THREE.Vector3(t.x + 0.5, y + 0.05, t.z + 0.5),
    );

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: 3 });
    const line = new THREE.Line(geometry, material);
    line.name = name;
    line.renderOrder = 200;
    this.pathGroup.add(line);

    // Draw tile highlights along the path
    const tileHighlightColor = COLORS.PATH_TILE;
    const tileMaterial = this.getMaterial(tileHighlightColor);
    for (const tile of tiles) {
      const mesh = new THREE.Mesh(this.tileGeometry, tileMaterial);
      mesh.position.set(tile.x + 0.5, y + 0.03, tile.z + 0.5);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(0.7, 0.7, 1); // Slightly smaller to show underlying tile
      mesh.name = name;
      mesh.renderOrder = 150;
      this.pathGroup.add(mesh);
    }
  }

  /**
   * Render a multi-floor path with smooth elevation transitions on stairs
   */
  private renderMultiFloorPath(multiPath: MultiFloorPath, name: string): void {
    if (!this.collisionData) return;

    const floors = this.collisionData.floors;
    const segmentColors = [
      0x00ff00, // Green - floor 0
      0x00aaff, // Light blue - floor 1
      0xaa00ff, // Purple - floor 2
      0xffaa00, // Orange - floor 3+
    ];

    // Collect all 3D points for the complete path line
    const allPoints: THREE.Vector3[] = [];

    for (let segIdx = 0; segIdx < multiPath.segments.length; segIdx++) {
      const segment = multiPath.segments[segIdx];
      const nextSegment = multiPath.segments[segIdx + 1];
      const floor = floors[segment.floorIndex];

      if (!floor || segment.tiles.length === 0) continue;

      const color =
        segmentColors[Math.min(segment.floorIndex, segmentColors.length - 1)];
      const tileMaterial = this.getMaterial(color);

      for (let i = 0; i < segment.tiles.length; i++) {
        const tile = segment.tiles[i];
        let y = segment.elevation;

        // If this is the last tile of a segment that ends at stairs,
        // and there's a next segment, interpolate elevation
        if (
          segment.endsAtStair &&
          nextSegment &&
          i === segment.tiles.length - 1
        ) {
          // Find the stair for elevation interpolation
          const stair = floor.stairTiles.find(
            (s) => s.tileX === tile.x && s.tileZ === tile.z,
          );
          if (stair) {
            const nextFloor = floors[nextSegment.floorIndex];
            if (nextFloor) {
              // Start of stair transition - still at current floor elevation
              y = segment.elevation;
            }
          }
        }

        // Add point to complete path
        allPoints.push(new THREE.Vector3(tile.x + 0.5, y + 0.1, tile.z + 0.5));

        // Draw tile highlight
        const mesh = new THREE.Mesh(this.tileGeometry, tileMaterial);
        mesh.position.set(tile.x + 0.5, y + 0.03, tile.z + 0.5);
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.set(0.7, 0.7, 1);
        mesh.name = name;
        mesh.renderOrder = 150;
        this.pathGroup.add(mesh);
      }

      // If this segment ends at stairs, add interpolated points for the stair transition
      if (segment.endsAtStair && nextSegment) {
        const lastTile = segment.tiles[segment.tiles.length - 1];
        const stair = floor.stairTiles.find(
          (s) => s.tileX === lastTile.x && s.tileZ === lastTile.z,
        );

        if (stair) {
          const nextFloor = floors[nextSegment.floorIndex];
          if (nextFloor) {
            // Add intermediate points for smooth stair visualization
            // Use TILES_PER_CELL for consistent stair length
            const stairSteps = TILES_PER_CELL;
            const dirVec = getSideVector(stair.direction);
            for (let step = 1; step <= stairSteps; step++) {
              const t = step / stairSteps;
              const interpX = lastTile.x + dirVec.x * t;
              const interpZ = lastTile.z + dirVec.z * t;
              const interpY =
                segment.elevation +
                t * (nextSegment.elevation - segment.elevation);
              allPoints.push(
                new THREE.Vector3(interpX + 0.5, interpY + 0.1, interpZ + 0.5),
              );
            }
          }
        }
      }
    }

    // Draw the complete connecting line
    if (allPoints.length >= 2) {
      const geometry = new THREE.BufferGeometry().setFromPoints(allPoints);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 2,
      });
      const line = new THREE.Line(geometry, material);
      line.name = name;
      line.renderOrder = 200;
      this.pathGroup.add(line);
    }
  }

  private getMaterial(color: number): THREE.MeshBasicMaterial {
    if (!this.materials.has(color)) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.materials.set(color, material);
    }
    return this.materials.get(color)!;
  }

  // ===========================================================================
  // WALKABILITY CHECKER
  // ===========================================================================

  private createWalkabilityChecker(
    floorIndex: number,
  ): WalkabilityCheckerResult {
    const emptyWallLookup = new Map<string, Set<WallDirection>>();

    if (!this.collisionData) {
      return { isWalkable: () => true, wallLookup: emptyWallLookup };
    }

    const floor = this.collisionData.floors[floorIndex];
    if (!floor) {
      return { isWalkable: () => true, wallLookup: emptyWallLookup };
    }

    const { walkableTiles, exteriorTiles, wallSegments } = floor;

    // Build wall lookup for fast queries
    const wallLookup = new Map<string, Set<WallDirection>>();
    let wallCount = 0;
    let openingCount = 0;
    for (const wall of wallSegments) {
      if (wall.hasOpening) {
        openingCount++;
        continue; // Doors/arches don't block
      }

      wallCount++;
      const key = tileKey(wall.tileX, wall.tileZ);
      if (!wallLookup.has(key)) {
        wallLookup.set(key, new Set());
      }
      wallLookup.get(key)!.add(wall.side);
    }

    // Debug stats available via getStats() method if needed

    const isWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
      const key = tileKey(tile.x, tile.z);

      // Check if tile is walkable (interior OR exterior for ground floor)
      const isInterior = walkableTiles.has(key);
      const isExterior = exteriorTiles.has(key);
      if (!isInterior && !isExterior) {
        return false;
      }

      // Check wall blocking if we have a from tile
      if (fromTile) {
        const dx = tile.x - fromTile.x;
        const dz = tile.z - fromTile.z;

        // Determine the direction of movement and which wall we're entering through
        // Coordinate system: North = -Z, South = +Z, East = +X, West = -X
        // approachDir = which edge of destination tile we're entering through
        let approachDir: WallDirection | null = null;
        if (dx === 0 && dz === 1)
          approachDir = "north"; // Moving south, enter through north edge
        else if (dx === 0 && dz === -1)
          approachDir = "south"; // Moving north, enter through south edge
        else if (dx === 1 && dz === 0)
          approachDir = "west"; // Moving east, enter through west edge
        else if (dx === -1 && dz === 0) approachDir = "east"; // Moving west, enter through east edge

        if (approachDir) {
          // Check if target tile has wall on the edge we're entering through
          const targetWalls = wallLookup.get(key);
          if (targetWalls?.has(approachDir)) {
            return false;
          }

          // Check if source tile has wall blocking exit (opposite direction)
          const exitDir = getOppositeWallDirection(approachDir);
          const fromKey = tileKey(fromTile.x, fromTile.z);
          const fromWalls = wallLookup.get(fromKey);
          if (fromWalls?.has(exitDir)) {
            return false;
          }
        }
      }

      return true;
    };

    return { isWalkable, wallLookup };
  }

  /**
   * Find path and validate it doesn't go through walls
   * @throws Error if path goes through a wall (indicates a bug)
   */
  private findPathAndValidate(
    start: TileCoord,
    end: TileCoord,
    checker: WalkabilityCheckerResult,
  ): TileCoord[] {
    const path = findPath(start, end, checker.isWalkable);

    // Validate the path doesn't go through walls
    if (path.length > 0) {
      try {
        validatePath(path, start, checker.isWalkable, checker.wallLookup);
      } catch (error) {
        console.error("[NavigationVisualizer] Path validation failed:", error);
        // Re-throw to make bugs visible
        throw error;
      }
    }

    return path;
  }

  // ===========================================================================
  // INFO GETTERS
  // ===========================================================================

  /**
   * Get statistics about current collision data
   */
  getStats(): {
    floors: number;
    walkableTiles: number;
    walls: number;
    doors: number;
    stairs: number;
  } | null {
    if (!this.collisionData) return null;

    let walkableTiles = 0;
    let walls = 0;
    let doors = 0;
    let stairs = 0;

    for (const floor of this.collisionData.floors) {
      walkableTiles += floor.walkableTiles.size;
      walls += floor.wallSegments.filter((w) => !w.hasOpening).length;
      doors += floor.wallSegments.filter(
        (w) =>
          w.hasOpening &&
          (w.openingType === "door" || w.openingType === "arch"),
      ).length;
      stairs += floor.stairTiles.length;
    }

    return {
      floors: this.collisionData.floors.length,
      walkableTiles,
      walls,
      doors,
      stairs,
    };
  }

  /**
   * Get click state for UI display
   */
  getClickState(): ClickState {
    return { ...this.clickState };
  }
}
