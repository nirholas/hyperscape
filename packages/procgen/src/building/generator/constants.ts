/**
 * Building Generation Constants
 * Dimensions, colors, and default values
 *
 * **Grid Alignment:**
 * Buildings are designed on a cell grid where each cell is CELL_SIZE (4m) square.
 * This aligns with the game's movement tile system where TILE_SIZE = 1m.
 * - 1 building cell = 4 x 4 = 16 movement tiles
 * - Building positions must be grid-aligned to ensure collision works correctly
 *
 * @see TileSystem.TILE_SIZE for movement tile size (1m)
 */

import * as THREE from "three";

// ============================================================
// GRID ALIGNMENT CONSTANTS
// ============================================================

/**
 * Size of one building cell in meters.
 * Each cell represents one "room" unit in the building grid.
 * This is 4x the movement TILE_SIZE (1m), so 1 cell = 4x4 = 16 tiles.
 */
export const CELL_SIZE = 4;

/**
 * Movement tile size in meters (must match TileSystem.TILE_SIZE).
 * Defined here for reference and grid calculation.
 */
export const MOVEMENT_TILE_SIZE = 1;

/**
 * Number of movement tiles per building cell edge.
 * CELL_SIZE / MOVEMENT_TILE_SIZE = 4 tiles per cell side.
 */
export const TILES_PER_CELL = CELL_SIZE / MOVEMENT_TILE_SIZE;

/**
 * Grid snap unit for building placement.
 * Buildings should snap to CELL_SIZE/2 = 2m intervals.
 * This ensures cell centers align with even-numbered tile boundaries.
 *
 * Example: A building at position (12, 0, 8) has cells centered at
 * (10, 8), (14, 8), etc. - all at tile boundaries divisible by CELL_SIZE/2.
 */
export const BUILDING_GRID_SNAP = CELL_SIZE / 2;

/**
 * Snap a world position to the building grid.
 * Ensures building positions align with the tile grid for proper collision.
 *
 * @param x - World X coordinate
 * @param z - World Z coordinate (optional, only x returned if not provided)
 * @returns Snapped coordinates { x, z }
 */
export function snapToBuildingGrid(
  x: number,
  z: number,
): { x: number; z: number } {
  // Validate inputs
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`[snapToBuildingGrid] Invalid coords: (${x}, ${z})`);
  }

  return {
    x: Math.round(x / BUILDING_GRID_SNAP) * BUILDING_GRID_SNAP,
    z: Math.round(z / BUILDING_GRID_SNAP) * BUILDING_GRID_SNAP,
  };
}

/**
 * Check if a position is grid-aligned.
 * @param x - World X coordinate
 * @param z - World Z coordinate
 * @returns True if position is on the building grid
 */
export function isGridAligned(x: number, z: number): boolean {
  const epsilon = 0.001;
  const xMod = Math.abs(
    ((x % BUILDING_GRID_SNAP) + BUILDING_GRID_SNAP) % BUILDING_GRID_SNAP,
  );
  const zMod = Math.abs(
    ((z % BUILDING_GRID_SNAP) + BUILDING_GRID_SNAP) % BUILDING_GRID_SNAP,
  );
  return (
    (xMod < epsilon || xMod > BUILDING_GRID_SNAP - epsilon) &&
    (zMod < epsilon || zMod > BUILDING_GRID_SNAP - epsilon)
  );
}

// ============================================================
// DIMENSIONS
// ============================================================

export const WALL_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.22;
export const FLOOR_THICKNESS = 0.2;
export const ROOF_THICKNESS = 0.22;
export const FLOOR_HEIGHT = WALL_HEIGHT + FLOOR_THICKNESS;

// Foundation - elevates building off ground for terrain robustness
export const FOUNDATION_HEIGHT = 0.5;
export const FOUNDATION_OVERHANG = 0.15; // How much foundation extends past walls

// Terrain base - extends foundation below ground to handle uneven terrain
export const TERRAIN_DEPTH = 1.0; // How far foundation extends below ground level

// Entrance steps
export const ENTRANCE_STEP_HEIGHT = 0.25; // Height of each step
export const ENTRANCE_STEP_DEPTH = 0.4; // Depth (horizontal) of each step
export const ENTRANCE_STEP_COUNT = 2; // Steps going UP to foundation
export const TERRAIN_STEP_COUNT = 4; // Additional steps going DOWN into terrain

// Terrace/balcony railings
export const RAILING_HEIGHT = 1.0;
export const RAILING_THICKNESS = 0.08;

export const DOOR_WIDTH = CELL_SIZE * 0.4;
export const DOOR_HEIGHT = WALL_HEIGHT * 0.7;
export const ARCH_WIDTH = CELL_SIZE * 0.5;
export const WINDOW_WIDTH = CELL_SIZE * 0.35;
export const WINDOW_HEIGHT = WALL_HEIGHT * 0.35;
export const WINDOW_SILL_HEIGHT = WALL_HEIGHT * 0.35;

export const COUNTER_HEIGHT = 1.05;
export const COUNTER_DEPTH = CELL_SIZE * 0.35;
export const COUNTER_LENGTH = CELL_SIZE * 1.1;
export const NPC_HEIGHT = 1.6;
export const NPC_WIDTH = 0.7;
export const FORGE_SIZE = 1.5;
export const ANVIL_SIZE = 0.75;

// ============================================================
// COLORS
// ============================================================

export const palette = {
  // Walls
  wallOuter: new THREE.Color(0x8f8376), // Exterior wall - lighter stone
  wallInner: new THREE.Color(0x7a6f68), // Interior wall - slightly darker
  wallCorner: new THREE.Color(0x8f8376), // Corner posts - match exterior

  // Surfaces
  floor: new THREE.Color(0x5e534a), // Floor tiles - dark wood/stone
  ceiling: new THREE.Color(0x6e6358), // Ceiling tiles - slightly lighter
  roof: new THREE.Color(0x523c33), // Roof pieces - dark shingles
  patio: new THREE.Color(0x3f444c), // Terrace/patio - slate gray
  foundation: new THREE.Color(0x5a524a), // Foundation - darker stone

  // Trim and details
  trim: new THREE.Color(0x6e5d52), // Railings, skirts - darker accent
  stairs: new THREE.Color(0x6e6258), // Stair treads

  // Furniture
  counter: new THREE.Color(0x4b3a2f), // Bank counter - dark wood
  bar: new THREE.Color(0x3a2b22), // Bar counter - darker wood

  // NPCs (placeholder colors)
  banker: new THREE.Color(0xff3b30), // Banker NPC
  innkeeper: new THREE.Color(0x4cc9f0), // Innkeeper NPC

  // Forge props
  forge: new THREE.Color(0x7f1d1d), // Forge - dark red/brick
  anvil: new THREE.Color(0x4b5563), // Anvil - gray metal
};

// ============================================================
// DIRECTION UTILITIES
// ============================================================

export function getSideVector(side: string): { x: number; z: number } {
  switch (side) {
    case "north":
      return { x: 0, z: -1 };
    case "south":
      return { x: 0, z: 1 };
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    default:
      return { x: 0, z: 1 };
  }
}

export function getOppositeSide(side: string): string {
  switch (side) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "east":
      return "west";
    case "west":
      return "east";
    default:
      return "north";
  }
}
