/**
 * Town Generation Constants
 * Default values and configuration for town generation
 */

import type {
  TownGeneratorConfig,
  TownSizeConfig,
  TownSize,
  BuildingConfig,
  TownBuildingType,
} from "./types";

// ============================================================
// DEFAULT CONFIGURATION VALUES
// ============================================================

export const DEFAULT_TOWN_COUNT = 25;
export const DEFAULT_WORLD_SIZE = 10000;
export const DEFAULT_MIN_TOWN_SPACING = 800;
export const DEFAULT_FLATNESS_SAMPLE_RADIUS = 40;
export const DEFAULT_FLATNESS_SAMPLE_COUNT = 16;
export const DEFAULT_WATER_THRESHOLD = 5.4;
export const DEFAULT_OPTIMAL_WATER_DISTANCE_MIN = 30;
export const DEFAULT_OPTIMAL_WATER_DISTANCE_MAX = 150;

// ============================================================
// TOWN SIZE CONFIGURATIONS
// ============================================================

export const DEFAULT_TOWN_SIZES: Record<TownSize, TownSizeConfig> = {
  hamlet: {
    buildingCount: { min: 3, max: 5 },
    radius: 25,
    safeZoneRadius: 40,
  },
  village: {
    buildingCount: { min: 6, max: 10 },
    radius: 40,
    safeZoneRadius: 60,
  },
  town: {
    buildingCount: { min: 11, max: 16 },
    radius: 60,
    safeZoneRadius: 80,
  },
};

// ============================================================
// BIOME SUITABILITY SCORES
// ============================================================

export const DEFAULT_BIOME_SUITABILITY: Record<string, number> = {
  plains: 1.0,
  valley: 0.95,
  forest: 0.7,
  tundra: 0.4,
  desert: 0.3,
  swamp: 0.2,
  mountains: 0.15,
  lakes: 0.0,
};

// ============================================================
// BUILDING TYPE CONFIGURATIONS
// ============================================================

/**
 * Building dimensions in meters, aligned to CELL_SIZE (4m) grid.
 * Each building cell is 4m x 4m, so dimensions should be multiples of 4.
 * This ensures buildings align with the movement tile grid (1m tiles).
 *
 * Example: A 3x3 cell bank = 12m x 12m
 */
const CELL_SIZE = 4; // Must match procgen/building/generator/constants.ts

export const DEFAULT_BUILDING_CONFIGS: Record<
  TownBuildingType,
  BuildingConfig
> = {
  // Bank: 3x3 cells (12x12m) - matches recipe widthRange [3,4], depthRange [3,4]
  bank: { width: 3 * CELL_SIZE, depth: 3 * CELL_SIZE, priority: 1 },
  // Store: 2x3 cells (8x12m) - matches recipe widthRange [2,3], depthRange [2,4]
  store: { width: 2 * CELL_SIZE, depth: 3 * CELL_SIZE, priority: 2 },
  // Anvil: 2x2 cells (8x8m) - standalone forge/anvil station
  anvil: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 3 },
  // Well: 1x1 cell (4x4m) - small structure
  well: { width: 1 * CELL_SIZE, depth: 1 * CELL_SIZE, priority: 4 },
  // House: 2x2 cells (8x8m) - generic house placeholder
  house: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 5 },
  // Inn: 3x4 cells (12x16m) - matches recipe widthRange [3,4], depthRange [3,5]
  inn: { width: 3 * CELL_SIZE, depth: 4 * CELL_SIZE, priority: 2 },
  // Smithy: 2x2 cells (8x8m) - matches recipe widthRange [2,3], depthRange [2,3]
  smithy: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 3 },
  // Simple House: 2x2 cells (8x8m) - matches recipe widthRange [2,3], depthRange [2,3]
  "simple-house": { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 6 },
  // Long House: 2x5 cells (8x20m) - matches recipe widthRange [1,2], depthRange [4,6]
  "long-house": { width: 2 * CELL_SIZE, depth: 5 * CELL_SIZE, priority: 6 },
};

// ============================================================
// NAME GENERATION
// ============================================================

export const NAME_PREFIXES = [
  "Oak",
  "River",
  "Stone",
  "Green",
  "High",
  "Low",
  "North",
  "South",
  "East",
  "West",
  "Iron",
  "Gold",
  "Silver",
  "Crystal",
  "Shadow",
  "Sun",
  "Moon",
  "Star",
  "Thunder",
  "Frost",
  "Fire",
  "Wind",
  "Storm",
  "Cloud",
  "Lake",
];

export const NAME_SUFFIXES = [
  "haven",
  "ford",
  "wick",
  "ton",
  "bridge",
  "vale",
  "hollow",
  "reach",
  "fall",
  "watch",
  "keep",
  "stead",
  "dale",
  "brook",
  "field",
  "grove",
  "hill",
  "cliff",
  "port",
  "gate",
  "marsh",
  "moor",
  "wood",
  "mere",
  "crest",
];

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

export function createDefaultConfig(): TownGeneratorConfig {
  return {
    townCount: DEFAULT_TOWN_COUNT,
    worldSize: DEFAULT_WORLD_SIZE,
    minTownSpacing: DEFAULT_MIN_TOWN_SPACING,
    flatnessSampleRadius: DEFAULT_FLATNESS_SAMPLE_RADIUS,
    flatnessSampleCount: DEFAULT_FLATNESS_SAMPLE_COUNT,
    waterThreshold: DEFAULT_WATER_THRESHOLD,
    optimalWaterDistanceMin: DEFAULT_OPTIMAL_WATER_DISTANCE_MIN,
    optimalWaterDistanceMax: DEFAULT_OPTIMAL_WATER_DISTANCE_MAX,
    townSizes: { ...DEFAULT_TOWN_SIZES },
    biomeSuitability: { ...DEFAULT_BIOME_SUITABILITY },
    buildingTypes: { ...DEFAULT_BUILDING_CONFIGS },
  };
}

// ============================================================
// GRID CONFIGURATION
// ============================================================

export const PLACEMENT_GRID_SIZE = 15;
export const BUILDING_PLACEMENT_BUFFER = 2;
export const MAX_BUILDING_PLACEMENT_ATTEMPTS = 50;
export const WATER_CHECK_DIRECTIONS = 8;
export const WATER_CHECK_MAX_DISTANCE = 300;
export const WATER_CHECK_STEP = 20;
