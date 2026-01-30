/**
 * Biome Resource Generator
 *
 * Extracted algorithms for generating harvestable resources (trees, ores)
 * based on biome configuration. Used by TerrainSystem and directly testable.
 *
 * Design principles:
 * - Pure functions for testability
 * - No side effects - returns resource arrays
 * - Deterministic via seeded RNG
 * - Real terrain height lookups via callback
 */

import type {
  BiomeTreeConfig,
  BiomeOreConfig,
} from "../../../types/world/world-types";
import type {
  ResourceNode,
  ResourceSubType,
} from "../../../types/world/terrain";

/**
 * Context provided by TerrainSystem for resource generation.
 */
export interface ResourceGenerationContext {
  /** Tile X coordinate */
  tileX: number;
  /** Tile Z coordinate */
  tileZ: number;
  /** Tile key for resource IDs */
  tileKey: string;
  /** Tile size in meters */
  tileSize: number;
  /** Water height threshold */
  waterThreshold: number;
  /** Get terrain height at world coordinates */
  getHeightAt: (worldX: number, worldZ: number) => number;
  /** Check if position is on a road */
  isOnRoad?: (worldX: number, worldZ: number) => boolean;
  /** Deterministic RNG seeded for this tile */
  createRng: (salt: string) => () => number;
}

/**
 * Level requirements for tree types (OSRS woodcutting levels).
 * Single source of truth - used by both generation and tests.
 */
export const TREE_LEVEL_REQUIREMENTS: Record<string, number> = {
  normal: 1,
  oak: 15,
  willow: 30,
  teak: 35,
  maple: 45,
  mahogany: 50,
  yew: 60,
  magic: 75,
};

/**
 * Mapping from game tree subtypes to @hyperscape/procgen presets.
 * Used for runtime procedural tree generation (visual variety).
 *
 * These presets define the visual characteristics of each tree type:
 * - normal: Common deciduous tree (Quaking Aspen)
 * - oak: Classic oak with spreading branches
 * - willow: Distinctive drooping branches
 * - teak: Tall tropical deciduous
 * - maple: Multi-trunk with palmate leaves
 * - mahogany: Large deciduous with dark wood
 * - yew: Ancient coniferous tree
 * - magic: Mystical tree with blossoms
 */
export const TREE_PROCGEN_PRESETS: Record<string, string> = {
  normal: "quakingAspen",
  oak: "blackOak",
  willow: "weepingWillow",
  teak: "blackTupelo",
  maple: "acer",
  mahogany: "sassafras",
  yew: "europeanLarch",
  magic: "hillCherry",
};

/**
 * Get the procgen preset name for a tree subtype.
 * Falls back to quakingAspen for unknown types.
 */
export function getTreeProcgenPreset(subType: string): string {
  return TREE_PROCGEN_PRESETS[subType] ?? "quakingAspen";
}

/**
 * Level requirements for ore types (OSRS mining levels).
 * Single source of truth - used by both generation and tests.
 */
export const ORE_LEVEL_REQUIREMENTS: Record<string, number> = {
  copper: 1,
  tin: 1,
  iron: 15,
  coal: 30,
  mithril: 55,
  adamant: 70,
  runite: 85,
};

/**
 * Get the level requirement for a tree type.
 */
export function getTreeLevelRequirement(subType: string): number {
  return TREE_LEVEL_REQUIREMENTS[subType] ?? 1;
}

/**
 * Get the level requirement for an ore type.
 */
export function getOreLevelRequirement(subType: string): number {
  return ORE_LEVEL_REQUIREMENTS[subType] ?? 1;
}

/**
 * Generate harvestable trees for a tile based on biome configuration.
 *
 * @param ctx - Resource generation context from TerrainSystem
 * @param treeConfig - Biome tree configuration
 * @returns Array of ResourceNode objects for trees
 */
export function generateTrees(
  ctx: ResourceGenerationContext,
  treeConfig: BiomeTreeConfig,
): ResourceNode[] {
  if (!treeConfig.enabled) {
    return [];
  }

  const resources: ResourceNode[] = [];

  // Calculate tree count based on density and tile size
  const tileArea = (ctx.tileSize / 100) * (ctx.tileSize / 100);
  const baseCount = Math.floor(treeConfig.density * tileArea);

  if (baseCount === 0) {
    return [];
  }

  // Use deterministic RNG for reproducible placement
  const rng = ctx.createRng("trees");

  // Get distribution weights
  const distribution = treeConfig.distribution;
  const treeTypes = Object.keys(distribution);
  if (treeTypes.length === 0) {
    return [];
  }

  const totalWeight = Object.values(distribution).reduce(
    (sum, w) => sum + w,
    0,
  );
  if (totalWeight === 0) {
    return [];
  }

  // Generate tree positions
  const placedPositions: Array<{ x: number; z: number }> = [];
  const minSpacing = treeConfig.minSpacing;
  const minSpacingSq = minSpacing * minSpacing;

  // If clustering is enabled, generate cluster centers first
  const clusterCenters: Array<{ x: number; z: number }> = [];
  if (treeConfig.clustering && treeConfig.clusterSize) {
    const numClusters = Math.max(
      1,
      Math.ceil(baseCount / treeConfig.clusterSize),
    );
    for (let i = 0; i < numClusters; i++) {
      clusterCenters.push({
        x: rng() * ctx.tileSize,
        z: rng() * ctx.tileSize,
      });
    }
  }

  let treesPlaced = 0;
  const maxAttempts = baseCount * 10;
  let attempts = 0;

  while (treesPlaced < baseCount && attempts < maxAttempts) {
    attempts++;

    // Generate position (clustered or uniform)
    let localX: number;
    let localZ: number;

    if (treeConfig.clustering && clusterCenters.length > 0) {
      // Pick a random cluster center and scatter around it
      const cluster = clusterCenters[Math.floor(rng() * clusterCenters.length)];
      const scatterRadius = treeConfig.clusterSize! * 3;
      const angle = rng() * Math.PI * 2;
      const distance = rng() * scatterRadius;
      localX = cluster.x + Math.cos(angle) * distance;
      localZ = cluster.z + Math.sin(angle) * distance;
    } else {
      // Uniform random placement
      localX = rng() * ctx.tileSize;
      localZ = rng() * ctx.tileSize;
    }

    // Clamp to tile bounds
    localX = Math.max(0, Math.min(ctx.tileSize, localX));
    localZ = Math.max(0, Math.min(ctx.tileSize, localZ));

    // Convert to world coordinates for height lookup
    const worldX = ctx.tileX * ctx.tileSize + localX;
    const worldZ = ctx.tileZ * ctx.tileSize + localZ;
    const height = ctx.getHeightAt(worldX, worldZ);

    // Skip if underwater
    if (height < ctx.waterThreshold) {
      continue;
    }

    // Check minimum spacing
    let tooClose = false;
    for (const pos of placedPositions) {
      const dx = localX - pos.x;
      const dz = localZ - pos.z;
      if (dx * dx + dz * dz < minSpacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Check if on road
    if (ctx.isOnRoad?.(worldX, worldZ)) {
      continue;
    }

    // Select tree type based on weighted distribution
    let selectedType = "normal";
    const roll = rng() * totalWeight;
    let cumulative = 0;
    for (const treeType of treeTypes) {
      cumulative += distribution[treeType];
      if (roll < cumulative) {
        // Extract subtype: "tree_oak" -> "oak", "tree_normal" -> "normal"
        selectedType = treeType.replace("tree_", "");
        break;
      }
    }

    // Generate random scale within variation range
    const [minScale, maxScale] = treeConfig.scaleVariation ?? [0.8, 1.2];
    const scale = minScale + rng() * (maxScale - minScale);

    // Generate random Y-axis rotation
    const rotation = rng() * Math.PI * 2;

    // Create resource node
    const resource: ResourceNode = {
      id: `${ctx.tileKey}_tree_${treesPlaced}`,
      type: "tree",
      subType: selectedType as ResourceSubType,
      position: { x: localX, y: height, z: localZ },
      mesh: null,
      health: 100,
      maxHealth: 100,
      respawnTime: 300000, // 5 minutes
      harvestable: true,
      requiredLevel: getTreeLevelRequirement(selectedType),
      scale,
      rotation,
    };

    resources.push(resource);
    placedPositions.push({ x: localX, z: localZ });
    treesPlaced++;
  }

  return resources;
}

/**
 * Generate ore nodes for a tile based on biome configuration.
 * Supports ore veins (clusters) for more natural distribution.
 *
 * @param ctx - Resource generation context from TerrainSystem
 * @param oreConfig - Biome ore configuration
 * @returns Array of ResourceNode objects for ores
 */
export function generateOres(
  ctx: ResourceGenerationContext,
  oreConfig: BiomeOreConfig,
): ResourceNode[] {
  if (!oreConfig.enabled) {
    return [];
  }

  const resources: ResourceNode[] = [];

  // Calculate ore count based on density
  const tileArea = (ctx.tileSize / 100) * (ctx.tileSize / 100);
  const baseCount = Math.floor(oreConfig.density * tileArea);

  if (baseCount === 0) {
    return [];
  }

  // Use deterministic RNG
  const rng = ctx.createRng("ores");

  // Get distribution weights
  const distribution = oreConfig.distribution;
  const oreTypes = Object.keys(distribution);
  if (oreTypes.length === 0) {
    return [];
  }

  const totalWeight = Object.values(distribution).reduce(
    (sum, w) => sum + w,
    0,
  );
  if (totalWeight === 0) {
    return [];
  }

  // Track placed positions for spacing
  const placedPositions: Array<{ x: number; z: number }> = [];
  const minSpacing = oreConfig.minSpacing;
  const minSpacingSq = minSpacing * minSpacing;

  // If veins enabled, generate vein centers
  const veinCenters: Array<{ x: number; z: number; oreType: string }> = [];
  if (oreConfig.veins && oreConfig.veinSize) {
    const numVeins = Math.max(1, Math.ceil(baseCount / oreConfig.veinSize));
    for (let i = 0; i < numVeins; i++) {
      // Select ore type for this vein
      let selectedType = oreTypes[0];
      const roll = rng() * totalWeight;
      let cumulative = 0;
      for (const oreType of oreTypes) {
        cumulative += distribution[oreType];
        if (roll < cumulative) {
          selectedType = oreType;
          break;
        }
      }

      veinCenters.push({
        x: rng() * ctx.tileSize,
        z: rng() * ctx.tileSize,
        oreType: selectedType,
      });
    }
  }

  let oresPlaced = 0;
  const maxAttempts = baseCount * 10;
  let attempts = 0;

  while (oresPlaced < baseCount && attempts < maxAttempts) {
    attempts++;

    let localX: number;
    let localZ: number;
    let selectedType: string;

    if (oreConfig.veins && veinCenters.length > 0) {
      // Pick a random vein center and scatter around it
      const vein = veinCenters[Math.floor(rng() * veinCenters.length)];
      const scatterRadius = oreConfig.veinSize! * 2;
      const angle = rng() * Math.PI * 2;
      const distance = rng() * scatterRadius;
      localX = vein.x + Math.cos(angle) * distance;
      localZ = vein.z + Math.sin(angle) * distance;
      selectedType = vein.oreType;
    } else {
      // Uniform random placement with weighted ore selection
      localX = rng() * ctx.tileSize;
      localZ = rng() * ctx.tileSize;

      // Select ore type based on distribution
      selectedType = oreTypes[0];
      const roll = rng() * totalWeight;
      let cumulative = 0;
      for (const oreType of oreTypes) {
        cumulative += distribution[oreType];
        if (roll < cumulative) {
          selectedType = oreType;
          break;
        }
      }
    }

    // Clamp to tile bounds
    localX = Math.max(0, Math.min(ctx.tileSize, localX));
    localZ = Math.max(0, Math.min(ctx.tileSize, localZ));

    // Convert to world coordinates for height lookup
    const worldX = ctx.tileX * ctx.tileSize + localX;
    const worldZ = ctx.tileZ * ctx.tileSize + localZ;
    const height = ctx.getHeightAt(worldX, worldZ);

    // Skip if underwater
    if (height < ctx.waterThreshold) {
      continue;
    }

    // Check minimum spacing
    let tooClose = false;
    for (const pos of placedPositions) {
      const dx = localX - pos.x;
      const dz = localZ - pos.z;
      if (dx * dx + dz * dz < minSpacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Check if on road
    if (ctx.isOnRoad?.(worldX, worldZ)) {
      continue;
    }

    // Extract ore subtype: "ore_copper" -> "copper"
    const oreSubType = selectedType.replace("ore_", "");

    // Generate random scale within variation range
    const [minScale, maxScale] = oreConfig.scaleVariation ?? [0.9, 1.1];
    const scale = minScale + rng() * (maxScale - minScale);

    // Generate random Y-axis rotation
    const rotation = rng() * Math.PI * 2;

    // Create resource node
    const resource: ResourceNode = {
      id: `${ctx.tileKey}_ore_${oresPlaced}`,
      type: "ore",
      subType: oreSubType as ResourceSubType,
      position: { x: localX, y: height, z: localZ },
      mesh: null,
      health: 100,
      maxHealth: 100,
      respawnTime: 300000, // 5 minutes
      harvestable: true,
      requiredLevel: getOreLevelRequirement(oreSubType),
      scale,
      rotation,
    };

    resources.push(resource);
    placedPositions.push({ x: localX, z: localZ });
    oresPlaced++;
  }

  return resources;
}
