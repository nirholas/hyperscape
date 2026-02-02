/**
 * Shore Discovery Utilities
 *
 * Provides functions for detecting valid shore positions where fishing spots
 * can spawn. Uses terrain height sampling to find water edges.
 *
 * A valid shore point is:
 * - On land (height >= water threshold)
 * - Near water level (height <= shore max height)
 * - Adjacent to water (at least one neighbor below water threshold)
 *
 * @see https://oldschool.runescape.wiki/w/Fishing - OSRS fishing spots appear at water edges
 */

/**
 * Represents a valid shore point where a fishing spot can spawn
 */
export interface ShorePoint {
  x: number;
  y: number; // Actual ground height
  z: number;
  waterDirection: "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";
}

export interface FindShorePointsOptions {
  /** Grid sampling distance in meters (default: 1m to match tile size) */
  sampleInterval?: number;
  /** Height below which is considered water (default: 5.4m from TerrainSystem) */
  waterThreshold?: number;
  /** Maximum height for valid shore positions (default: 20.0m for elevated terrain) */
  shoreMaxHeight?: number;
  /** Minimum distance between shore points in meters (default: 6m) */
  minSpacing?: number;
}

/**
 * Direction offsets for checking adjacent tiles.
 * Uses 1m offset (1 tile) for tile-accurate adjacency checks.
 * This ensures fishing spots are exactly 1 tile from walkable land,
 * matching the cardinal adjacency requirement for interaction.
 */
const DIRECTIONS = [
  { dx: 0, dz: -1, name: "N" as const },
  { dx: 0, dz: 1, name: "S" as const },
  { dx: 1, dz: 0, name: "E" as const },
  { dx: -1, dz: 0, name: "W" as const },
  { dx: 1, dz: -1, name: "NE" as const },
  { dx: -1, dz: -1, name: "NW" as const },
  { dx: 1, dz: 1, name: "SE" as const },
  { dx: -1, dz: 1, name: "SW" as const },
];

/**
 * Scans an area and returns valid shore points where fishing spots can spawn.
 *
 * Shore = on land, adjacent to water. The algorithm:
 * 1. Samples terrain in a grid pattern within bounds
 * 2. For each point, checks if it's on land (above water threshold)
 * 3. Checks if it's near water level (below shore max height)
 * 4. Checks if any adjacent tile is underwater
 * 5. Ensures minimum spacing between returned points
 *
 * @param bounds - Rectangle to search within (world coordinates)
 * @param getHeightAt - Function to sample terrain height at (x, z)
 * @param options - Configuration options
 * @returns Array of valid shore points, not guaranteed to be in any order
 */
export function findShorePoints(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  getHeightAt: (x: number, z: number) => number,
  options: FindShorePointsOptions = {},
): ShorePoint[] {
  const {
    sampleInterval = 1, // 1m = 1 tile for tile-accurate sampling
    waterThreshold = 9.0,
    shoreMaxHeight = 20.0,
    minSpacing = 6,
  } = options;

  const results: ShorePoint[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x += sampleInterval) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += sampleInterval) {
      const height = getHeightAt(x, z);

      // Must be on land (not underwater)
      if (height < waterThreshold) continue;

      // Must be near water level (shore zone)
      if (height > shoreMaxHeight) continue;

      // Must have adjacent water - check all directions
      let waterDir: ShorePoint["waterDirection"] | null = null;
      for (const dir of DIRECTIONS) {
        const neighborHeight = getHeightAt(x + dir.dx, z + dir.dz);
        if (neighborHeight < waterThreshold) {
          waterDir = dir.name;
          break;
        }
      }
      if (!waterDir) continue;

      // Snap to tile center for proper tile alignment (tile center = floor + 0.5)
      const tileX = Math.floor(x) + 0.5;
      const tileZ = Math.floor(z) + 0.5;

      // Check minimum spacing from existing points (using snapped positions)
      const tooClose = results.some((p) => {
        const dist = Math.sqrt((p.x - tileX) ** 2 + (p.z - tileZ) ** 2);
        return dist < minSpacing;
      });
      if (tooClose) continue;

      results.push({
        x: tileX,
        y: height,
        z: tileZ,
        waterDirection: waterDir,
      });
    }
  }

  return results;
}

/**
 * Finds points IN the water that are adjacent to walkable land.
 * This is the OSRS-accurate placement - fishing spots appear as ripples
 * in the water near the shore where players can reach them.
 *
 * @param bounds - Rectangle to search within (world coordinates)
 * @param getHeightAt - Function to sample terrain height at (x, z)
 * @param options - Configuration options
 * @returns Array of valid water edge points
 */
export function findWaterEdgePoints(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  getHeightAt: (x: number, z: number) => number,
  options: FindShorePointsOptions = {},
): ShorePoint[] {
  const {
    sampleInterval = 1, // 1m = 1 tile for tile-accurate sampling
    waterThreshold = 9.0,
    shoreMaxHeight = 20.0,
    minSpacing = 6,
  } = options;

  const results: ShorePoint[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x += sampleInterval) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += sampleInterval) {
      const height = getHeightAt(x, z);

      // Must be IN water (underwater)
      if (height >= waterThreshold) continue;

      // Must not be too deep (within 2m of water surface for visibility)
      if (height < waterThreshold - 2) continue;

      // Must have adjacent LAND - check all directions
      let landDir: ShorePoint["waterDirection"] | null = null;
      for (const dir of DIRECTIONS) {
        const neighborHeight = getHeightAt(x + dir.dx, z + dir.dz);
        // Adjacent land should be walkable (above water but not too steep)
        if (
          neighborHeight >= waterThreshold &&
          neighborHeight <= shoreMaxHeight
        ) {
          landDir = dir.name;
          break;
        }
      }
      if (!landDir) continue;

      // Snap to tile center for proper tile alignment (tile center = floor + 0.5)
      // Use water threshold as the Y position (water surface level)
      const tileX = Math.floor(x) + 0.5;
      const tileZ = Math.floor(z) + 0.5;

      // Check minimum spacing from existing points (using snapped positions)
      const tooClose = results.some((p) => {
        const dist = Math.sqrt((p.x - tileX) ** 2 + (p.z - tileZ) ** 2);
        return dist < minSpacing;
      });
      if (tooClose) continue;

      results.push({
        x: tileX,
        y: waterThreshold,
        z: tileZ,
        waterDirection: landDir,
      });
    }
  }

  return results;
}

/**
 * Shuffle array in place using Fisher-Yates algorithm.
 * Used to randomize shore point selection for variety.
 *
 * @param array - Array to shuffle (modified in place)
 * @returns The same array, now shuffled
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
