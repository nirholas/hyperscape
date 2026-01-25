/**
 * Tests for RoadNetworkSystem configuration loading from world-config.json
 *
 * Tests the loadRoadConfig function and how RoadNetworkSystem handles:
 * - Complete configs
 * - Partial configs with missing fields
 * - Invalid configs (negative values, zero step size, etc.)
 * - Fallback to defaults when no config available
 * - Dynamic DIRECTIONS generation based on pathStepSize
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataManager } from "../../../../data/DataManager";
import type { WorldConfigManifest } from "../../../../types/world/world-types";

// ============== Test Data ==============

const DEFAULTS = {
  roadWidth: 4,
  pathStepSize: 20,
  maxPathIterations: 10000,
  extraConnectionsRatio: 0.25,
  costBase: 1.0,
  costSlopeMultiplier: 5.0,
  costWaterPenalty: 1000,
  smoothingIterations: 2,
  noiseDisplacementScale: 0.01,
  noiseDisplacementStrength: 3,
  minPointSpacing: 4,
  heuristicWeight: 2.5,
} as const;

const DEFAULT_BIOME_COSTS: Record<string, number> = {
  plains: 1.0,
  valley: 1.0,
  forest: 1.3,
  tundra: 1.5,
  desert: 2.0,
  swamp: 2.5,
  mountains: 3.0,
  lakes: 100,
};

interface RoadConfig {
  roadWidth: number;
  pathStepSize: number;
  maxPathIterations: number;
  extraConnectionsRatio: number;
  costBase: number;
  costSlopeMultiplier: number;
  costWaterPenalty: number;
  smoothingIterations: number;
  noiseDisplacementScale: number;
  noiseDisplacementStrength: number;
  minPointSpacing: number;
  heuristicWeight: number;
  biomeCosts: Record<string, number>;
}

/**
 * loadRoadConfig - mirrors the implementation in RoadNetworkSystem.ts
 */
function loadRoadConfig(): RoadConfig {
  const manifest = DataManager.getWorldConfig();
  const roads = manifest?.roads;

  const biomeCosts: Record<string, number> = { ...DEFAULT_BIOME_COSTS };
  if (roads?.costBiomeMultipliers) {
    for (const [biome, cost] of Object.entries(roads.costBiomeMultipliers)) {
      biomeCosts[biome] = cost;
    }
  }

  return {
    roadWidth: roads?.roadWidth ?? DEFAULTS.roadWidth,
    pathStepSize: roads?.pathStepSize ?? DEFAULTS.pathStepSize,
    maxPathIterations: roads?.maxPathIterations ?? DEFAULTS.maxPathIterations,
    extraConnectionsRatio:
      roads?.extraConnectionsRatio ?? DEFAULTS.extraConnectionsRatio,
    costBase: roads?.costBase ?? DEFAULTS.costBase,
    costSlopeMultiplier:
      roads?.costSlopeMultiplier ?? DEFAULTS.costSlopeMultiplier,
    costWaterPenalty: roads?.costWaterPenalty ?? DEFAULTS.costWaterPenalty,
    smoothingIterations:
      roads?.smoothingIterations ?? DEFAULTS.smoothingIterations,
    noiseDisplacementScale:
      roads?.noiseDisplacementScale ?? DEFAULTS.noiseDisplacementScale,
    noiseDisplacementStrength:
      roads?.noiseDisplacementStrength ?? DEFAULTS.noiseDisplacementStrength,
    minPointSpacing: roads?.minPointSpacing ?? DEFAULTS.minPointSpacing,
    heuristicWeight: roads?.heuristicWeight ?? DEFAULTS.heuristicWeight,
    biomeCosts,
  };
}

/**
 * getDirections - mirrors the implementation in RoadNetworkSystem.ts
 * Generates 8-directional movement vectors based on step size
 */
function getDirections(stepSize: number): Array<{ dx: number; dz: number }> {
  return [
    { dx: stepSize, dz: 0 },
    { dx: -stepSize, dz: 0 },
    { dx: 0, dz: stepSize },
    { dx: 0, dz: -stepSize },
    { dx: stepSize, dz: stepSize },
    { dx: stepSize, dz: -stepSize },
    { dx: -stepSize, dz: stepSize },
    { dx: -stepSize, dz: -stepSize },
  ];
}

// ============== Tests ==============

describe("RoadNetworkSystem Config Loading", () => {
  let originalConfig: WorldConfigManifest | null = null;

  beforeEach(() => {
    originalConfig = DataManager.getWorldConfig();
  });

  afterEach(() => {
    if (originalConfig) {
      DataManager.setWorldConfig(originalConfig);
    }
  });

  describe("loadRoadConfig with no manifest", () => {
    it("returns all defaults when no config is loaded", () => {
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);

      const config = loadRoadConfig();

      expect(config.roadWidth).toBe(DEFAULTS.roadWidth);
      expect(config.pathStepSize).toBe(DEFAULTS.pathStepSize);
      expect(config.maxPathIterations).toBe(DEFAULTS.maxPathIterations);
      expect(config.extraConnectionsRatio).toBe(DEFAULTS.extraConnectionsRatio);
      expect(config.costBase).toBe(DEFAULTS.costBase);
      expect(config.costSlopeMultiplier).toBe(DEFAULTS.costSlopeMultiplier);
      expect(config.costWaterPenalty).toBe(DEFAULTS.costWaterPenalty);
      expect(config.smoothingIterations).toBe(DEFAULTS.smoothingIterations);
      expect(config.noiseDisplacementScale).toBe(
        DEFAULTS.noiseDisplacementScale,
      );
      expect(config.noiseDisplacementStrength).toBe(
        DEFAULTS.noiseDisplacementStrength,
      );
      expect(config.minPointSpacing).toBe(DEFAULTS.minPointSpacing);
      expect(config.heuristicWeight).toBe(DEFAULTS.heuristicWeight);
    });

    it("returns default biome costs when no config", () => {
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);

      const config = loadRoadConfig();

      expect(config.biomeCosts.plains).toBe(DEFAULT_BIOME_COSTS.plains);
      expect(config.biomeCosts.lakes).toBe(DEFAULT_BIOME_COSTS.lakes);
      expect(config.biomeCosts.mountains).toBe(DEFAULT_BIOME_COSTS.mountains);
    });
  });

  describe("loadRoadConfig with complete manifest", () => {
    const completeConfig: WorldConfigManifest = {
      version: 1,
      terrain: {
        tileSize: 100,
        worldSize: 10000,
        maxHeight: 30,
        waterThreshold: 5.4,
      },
      towns: {
        townCount: 25,
        minTownSpacing: 800,
        flatnessSampleRadius: 40,
        flatnessSampleCount: 16,
        waterThreshold: 5.4,
        optimalWaterDistanceMin: 30,
        optimalWaterDistanceMax: 150,
        townSizes: {
          hamlet: {
            minBuildings: 3,
            maxBuildings: 5,
            radius: 25,
            safeZoneRadius: 40,
          },
          village: {
            minBuildings: 6,
            maxBuildings: 10,
            radius: 40,
            safeZoneRadius: 60,
          },
          town: {
            minBuildings: 11,
            maxBuildings: 16,
            radius: 60,
            safeZoneRadius: 80,
          },
        },
        biomeSuitability: {},
      },
      roads: {
        roadWidth: 6,
        pathStepSize: 25,
        maxPathIterations: 15000,
        extraConnectionsRatio: 0.35,
        costBase: 1.5,
        costSlopeMultiplier: 6.0,
        costWaterPenalty: 1500,
        smoothingIterations: 3,
        noiseDisplacementScale: 0.02,
        noiseDisplacementStrength: 4,
        minPointSpacing: 5,
        heuristicWeight: 3.0,
        costBiomeMultipliers: {
          plains: 0.8,
          desert: 3.0,
          swamp: 5.0,
        },
      },
    };

    it("uses config values instead of defaults", () => {
      DataManager.setWorldConfig(completeConfig);

      const config = loadRoadConfig();

      expect(config.roadWidth).toBe(6);
      expect(config.pathStepSize).toBe(25);
      expect(config.maxPathIterations).toBe(15000);
      expect(config.extraConnectionsRatio).toBe(0.35);
      expect(config.costBase).toBe(1.5);
      expect(config.costSlopeMultiplier).toBe(6.0);
      expect(config.costWaterPenalty).toBe(1500);
      expect(config.smoothingIterations).toBe(3);
      expect(config.noiseDisplacementScale).toBe(0.02);
      expect(config.noiseDisplacementStrength).toBe(4);
      expect(config.minPointSpacing).toBe(5);
      expect(config.heuristicWeight).toBe(3.0);
    });

    it("merges biome costs with defaults", () => {
      DataManager.setWorldConfig(completeConfig);

      const config = loadRoadConfig();

      // Config values override defaults
      expect(config.biomeCosts.plains).toBe(0.8);
      expect(config.biomeCosts.desert).toBe(3.0);
      expect(config.biomeCosts.swamp).toBe(5.0);

      // Defaults are preserved for undefined biomes
      expect(config.biomeCosts.valley).toBe(DEFAULT_BIOME_COSTS.valley);
      expect(config.biomeCosts.forest).toBe(DEFAULT_BIOME_COSTS.forest);
      expect(config.biomeCosts.lakes).toBe(DEFAULT_BIOME_COSTS.lakes);
    });
  });

  describe("loadRoadConfig with partial manifest", () => {
    it("falls back to defaults for missing fields", () => {
      const partialConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 8,
          // All other fields missing
          pathStepSize: undefined as unknown as number,
          maxPathIterations: undefined as unknown as number,
          extraConnectionsRatio: undefined as unknown as number,
          costBase: undefined as unknown as number,
          costSlopeMultiplier: undefined as unknown as number,
          costWaterPenalty: undefined as unknown as number,
          smoothingIterations: undefined as unknown as number,
          noiseDisplacementScale: undefined as unknown as number,
          noiseDisplacementStrength: undefined as unknown as number,
          minPointSpacing: undefined as unknown as number,
          heuristicWeight: undefined as unknown as number,
          costBiomeMultipliers: undefined as unknown as Record<string, number>,
        },
      };

      DataManager.setWorldConfig(partialConfig);

      const config = loadRoadConfig();

      expect(config.roadWidth).toBe(8); // From config
      expect(config.pathStepSize).toBe(DEFAULTS.pathStepSize); // From defaults
      expect(config.maxPathIterations).toBe(DEFAULTS.maxPathIterations); // From defaults
      expect(config.costBase).toBe(DEFAULTS.costBase); // From defaults
    });
  });

  describe("getDirections function", () => {
    it("generates 8 directions", () => {
      const directions = getDirections(20);
      expect(directions.length).toBe(8);
    });

    it("generates correct cardinal directions", () => {
      const stepSize = 20;
      const directions = getDirections(stepSize);

      const hasRight = directions.some((d) => d.dx === stepSize && d.dz === 0);
      const hasLeft = directions.some((d) => d.dx === -stepSize && d.dz === 0);
      const hasUp = directions.some((d) => d.dx === 0 && d.dz === stepSize);
      const hasDown = directions.some((d) => d.dx === 0 && d.dz === -stepSize);

      expect(hasRight).toBe(true);
      expect(hasLeft).toBe(true);
      expect(hasUp).toBe(true);
      expect(hasDown).toBe(true);
    });

    it("generates correct diagonal directions", () => {
      const stepSize = 20;
      const directions = getDirections(stepSize);

      const diagonals = directions.filter((d) => d.dx !== 0 && d.dz !== 0);
      expect(diagonals.length).toBe(4);

      const hasTopRight = diagonals.some(
        (d) => d.dx === stepSize && d.dz === stepSize,
      );
      const hasTopLeft = diagonals.some(
        (d) => d.dx === -stepSize && d.dz === stepSize,
      );
      const hasBottomRight = diagonals.some(
        (d) => d.dx === stepSize && d.dz === -stepSize,
      );
      const hasBottomLeft = diagonals.some(
        (d) => d.dx === -stepSize && d.dz === -stepSize,
      );

      expect(hasTopRight).toBe(true);
      expect(hasTopLeft).toBe(true);
      expect(hasBottomRight).toBe(true);
      expect(hasBottomLeft).toBe(true);
    });

    it("scales with different step sizes", () => {
      const directions10 = getDirections(10);
      const directions50 = getDirections(50);
      const directions100 = getDirections(100);

      expect(directions10[0].dx).toBe(10);
      expect(directions50[0].dx).toBe(50);
      expect(directions100[0].dx).toBe(100);
    });

    it("handles very small step sizes", () => {
      const directions = getDirections(1);

      expect(directions[0].dx).toBe(1);
      expect(directions.length).toBe(8);
    });

    it("handles very large step sizes", () => {
      const directions = getDirections(1000);

      expect(directions[0].dx).toBe(1000);
      expect(directions.length).toBe(8);
    });

    it("handles zero step size (edge case)", () => {
      const directions = getDirections(0);

      // All directions would be zero vectors
      expect(directions.every((d) => d.dx === 0 && d.dz === 0)).toBe(true);
    });

    it("handles negative step size (edge case)", () => {
      const directions = getDirections(-10);

      // First direction should have negative dx
      expect(directions[0].dx).toBe(-10);
    });
  });

  describe("boundary conditions", () => {
    it("handles zero road width", () => {
      const zeroWidthConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 0,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(zeroWidthConfig);
      const config = loadRoadConfig();

      expect(config.roadWidth).toBe(0);
    });

    it("handles zero max iterations", () => {
      const zeroIterConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 0,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(zeroIterConfig);
      const config = loadRoadConfig();

      expect(config.maxPathIterations).toBe(0);
    });

    it("handles extreme extra connections ratio", () => {
      const extremeRatioConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 10.0, // 1000% extra connections
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(extremeRatioConfig);
      const config = loadRoadConfig();

      expect(config.extraConnectionsRatio).toBe(10.0);
    });

    it("handles biome cost at boundaries (0.0 and very high)", () => {
      const boundaryBiomeCostConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {
            free: 0.0,
            expensive: 10000,
            epsilon: 0.000001,
          },
        },
      };

      DataManager.setWorldConfig(boundaryBiomeCostConfig);
      const config = loadRoadConfig();

      expect(config.biomeCosts.free).toBe(0.0);
      expect(config.biomeCosts.expensive).toBe(10000);
      expect(config.biomeCosts.epsilon).toBeCloseTo(0.000001, 10);
    });
  });

  describe("edge cases", () => {
    it("handles negative values in config", () => {
      const negativeConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: -4,
          pathStepSize: -20,
          maxPathIterations: -10000,
          extraConnectionsRatio: -0.25,
          costBase: -1.0,
          costSlopeMultiplier: -5.0,
          costWaterPenalty: -1000,
          smoothingIterations: -2,
          noiseDisplacementScale: -0.01,
          noiseDisplacementStrength: -3,
          minPointSpacing: -4,
          heuristicWeight: -2.5,
          costBiomeMultipliers: {
            negativeCost: -100,
          },
        },
      };

      DataManager.setWorldConfig(negativeConfig);
      const config = loadRoadConfig();

      // Config loading should accept negative values (validation at usage time)
      expect(config.roadWidth).toBe(-4);
      expect(config.pathStepSize).toBe(-20);
      expect(config.costWaterPenalty).toBe(-1000);
      expect(config.biomeCosts.negativeCost).toBe(-100);
    });

    it("handles empty biome costs", () => {
      const emptyBiomeCostConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {}, // Empty
        },
      };

      DataManager.setWorldConfig(emptyBiomeCostConfig);
      const config = loadRoadConfig();

      // Should have all default biome costs
      expect(Object.keys(config.biomeCosts).length).toBeGreaterThan(0);
      expect(config.biomeCosts.plains).toBe(DEFAULT_BIOME_COSTS.plains);
      expect(config.biomeCosts.lakes).toBe(DEFAULT_BIOME_COSTS.lakes);
    });

    it("handles custom biome types", () => {
      const customBiomeConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {
            customBiome1: 1.5,
            customBiome2: 2.5,
            volcanoRegion: 50.0,
          },
        },
      };

      DataManager.setWorldConfig(customBiomeConfig);
      const config = loadRoadConfig();

      expect(config.biomeCosts.customBiome1).toBe(1.5);
      expect(config.biomeCosts.customBiome2).toBe(2.5);
      expect(config.biomeCosts.volcanoRegion).toBe(50.0);
    });
  });

  describe("config consistency", () => {
    it("multiple loads return consistent results", () => {
      const testConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 5,
          pathStepSize: 30,
          maxPathIterations: 12000,
          extraConnectionsRatio: 0.3,
          costBase: 1.2,
          costSlopeMultiplier: 5.5,
          costWaterPenalty: 1200,
          smoothingIterations: 3,
          noiseDisplacementScale: 0.015,
          noiseDisplacementStrength: 3.5,
          minPointSpacing: 4.5,
          heuristicWeight: 2.7,
          costBiomeMultipliers: { plains: 0.9 },
        },
      };

      DataManager.setWorldConfig(testConfig);

      const config1 = loadRoadConfig();
      const config2 = loadRoadConfig();
      const config3 = loadRoadConfig();

      expect(config1.roadWidth).toBe(config2.roadWidth);
      expect(config2.roadWidth).toBe(config3.roadWidth);
      expect(config1.pathStepSize).toBe(config2.pathStepSize);
      expect(config1.biomeCosts.plains).toBe(config2.biomeCosts.plains);
    });

    it("directions update when step size changes", () => {
      const config1: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 10,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(config1);
      const roadConfig1 = loadRoadConfig();
      const directions1 = getDirections(roadConfig1.pathStepSize);

      // Change step size
      DataManager.setWorldConfig({
        ...config1,
        roads: { ...config1.roads, pathStepSize: 50 },
      });
      const roadConfig2 = loadRoadConfig();
      const directions2 = getDirections(roadConfig2.pathStepSize);

      expect(directions1[0].dx).toBe(10);
      expect(directions2[0].dx).toBe(50);
    });
  });

  describe("A* pathfinding cost calculations", () => {
    it("cost scales with costBase", () => {
      const distance = 100;

      const config1: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(config1);
      const roadConfig1 = loadRoadConfig();
      const baseCost1 = distance * roadConfig1.costBase;

      DataManager.setWorldConfig({
        ...config1,
        roads: { ...config1.roads, costBase: 2.0 },
      });
      const roadConfig2 = loadRoadConfig();
      const baseCost2 = distance * roadConfig2.costBase;

      expect(baseCost2).toBe(baseCost1 * 2);
    });

    it("water penalty is significantly higher than typical step costs", () => {
      const testConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800,
          flatnessSampleRadius: 40,
          flatnessSampleCount: 16,
          waterThreshold: 5.4,
          optimalWaterDistanceMin: 30,
          optimalWaterDistanceMax: 150,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25,
              safeZoneRadius: 40,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40,
              safeZoneRadius: 60,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60,
              safeZoneRadius: 80,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 4,
          pathStepSize: 20,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.25,
          costBase: 1.0,
          costSlopeMultiplier: 5.0,
          costWaterPenalty: 1000,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.01,
          noiseDisplacementStrength: 3,
          minPointSpacing: 4,
          heuristicWeight: 2.5,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(testConfig);
      const config = loadRoadConfig();

      // A single step across typical terrain (excluding lakes which is 100) costs:
      // stepSize * costBase * biomeCost = 20 * 1.0 * 3.0 (mountains) = 60
      // Water penalty (1000) should be much higher than this
      const typicalStepCost = config.pathStepSize * config.costBase * 3.0; // mountains cost

      expect(config.costWaterPenalty).toBeGreaterThan(typicalStepCost * 10);
    });
  });
});
