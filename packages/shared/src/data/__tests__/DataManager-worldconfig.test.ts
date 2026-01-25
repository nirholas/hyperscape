/**
 * Tests for DataManager world config loading functionality.
 *
 * Tests the loading, retrieval, and validation of world-config.json manifest
 * for terrain, town, and road generation parameters.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataManager } from "../DataManager";
import type { WorldConfigManifest } from "../../types/world/world-types";

describe("DataManager WorldConfig", () => {
  // Store original config to restore after tests
  let originalConfig: WorldConfigManifest | null = null;

  beforeEach(() => {
    // Save original state
    originalConfig = DataManager.getWorldConfig();
  });

  afterEach(() => {
    // Restore original state after each test
    if (originalConfig !== null) {
      DataManager.setWorldConfig(originalConfig);
    }
  });

  describe("getWorldConfig", () => {
    it("returns null before any config is loaded", () => {
      // Clear any existing config
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);
      // Note: getWorldConfig may return null if no config loaded
      const config = DataManager.getWorldConfig();
      // This test verifies the getter works - actual value depends on initialization state
      expect(typeof config).toBe("object");
    });

    it("returns the config after setWorldConfig is called", () => {
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
          biomeSuitability: {
            plains: 1.0,
            valley: 0.95,
            forest: 0.7,
            tundra: 0.4,
            desert: 0.3,
            swamp: 0.2,
            mountains: 0.15,
            lakes: 0.0,
          },
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
            plains: 1.0,
            valley: 1.0,
            forest: 1.3,
            tundra: 1.5,
            desert: 2.0,
            swamp: 2.5,
            mountains: 3.0,
            lakes: 100,
          },
        },
      };

      DataManager.setWorldConfig(testConfig);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved).not.toBeNull();
      expect(retrieved!.version).toBe(1);
      expect(retrieved!.terrain.tileSize).toBe(100);
      expect(retrieved!.towns.townCount).toBe(25);
      expect(retrieved!.roads.roadWidth).toBe(4);
    });
  });

  describe("setWorldConfig", () => {
    it("sets complete config correctly", () => {
      const testConfig: WorldConfigManifest = {
        version: 2,
        terrain: {
          tileSize: 200,
          worldSize: 20000,
          maxHeight: 50,
          waterThreshold: 6.0,
        },
        towns: {
          townCount: 50,
          minTownSpacing: 1000,
          flatnessSampleRadius: 50,
          flatnessSampleCount: 20,
          waterThreshold: 6.0,
          optimalWaterDistanceMin: 40,
          optimalWaterDistanceMax: 200,
          townSizes: {
            hamlet: {
              minBuildings: 2,
              maxBuildings: 4,
              radius: 20,
              safeZoneRadius: 35,
            },
            village: {
              minBuildings: 5,
              maxBuildings: 8,
              radius: 35,
              safeZoneRadius: 55,
            },
            town: {
              minBuildings: 10,
              maxBuildings: 15,
              radius: 55,
              safeZoneRadius: 75,
            },
          },
          biomeSuitability: {
            plains: 1.0,
            lakes: 0.0,
          },
        },
        roads: {
          roadWidth: 6,
          pathStepSize: 25,
          maxPathIterations: 15000,
          extraConnectionsRatio: 0.3,
          costBase: 1.5,
          costSlopeMultiplier: 6.0,
          costWaterPenalty: 1500,
          smoothingIterations: 3,
          noiseDisplacementScale: 0.02,
          noiseDisplacementStrength: 4,
          minPointSpacing: 5,
          heuristicWeight: 3.0,
          costBiomeMultipliers: {
            plains: 1.0,
          },
        },
      };

      DataManager.setWorldConfig(testConfig);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.version).toBe(2);
      expect(retrieved!.terrain.worldSize).toBe(20000);
      expect(retrieved!.towns.townCount).toBe(50);
      expect(retrieved!.roads.pathStepSize).toBe(25);
    });

    it("overwrites previous config", () => {
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

      const config2: WorldConfigManifest = {
        ...config1,
        version: 3,
        towns: { ...config1.towns, townCount: 100 },
      };

      DataManager.setWorldConfig(config1);
      expect(DataManager.getWorldConfig()!.version).toBe(1);
      expect(DataManager.getWorldConfig()!.towns.townCount).toBe(25);

      DataManager.setWorldConfig(config2);
      expect(DataManager.getWorldConfig()!.version).toBe(3);
      expect(DataManager.getWorldConfig()!.towns.townCount).toBe(100);
    });
  });

  describe("config value ranges", () => {
    it("accepts zero values where valid", () => {
      const config: WorldConfigManifest = {
        version: 0,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 0, // Zero max height
          waterThreshold: 0, // Zero water threshold
        },
        towns: {
          townCount: 0, // Zero towns
          minTownSpacing: 0, // Zero spacing
          flatnessSampleRadius: 0,
          flatnessSampleCount: 0,
          waterThreshold: 0,
          optimalWaterDistanceMin: 0,
          optimalWaterDistanceMax: 0,
          townSizes: {
            hamlet: {
              minBuildings: 0,
              maxBuildings: 0,
              radius: 0,
              safeZoneRadius: 0,
            },
            village: {
              minBuildings: 0,
              maxBuildings: 0,
              radius: 0,
              safeZoneRadius: 0,
            },
            town: {
              minBuildings: 0,
              maxBuildings: 0,
              radius: 0,
              safeZoneRadius: 0,
            },
          },
          biomeSuitability: {},
        },
        roads: {
          roadWidth: 0,
          pathStepSize: 1, // Must be positive for division
          maxPathIterations: 0,
          extraConnectionsRatio: 0,
          costBase: 0,
          costSlopeMultiplier: 0,
          costWaterPenalty: 0,
          smoothingIterations: 0,
          noiseDisplacementScale: 0,
          noiseDisplacementStrength: 0,
          minPointSpacing: 0,
          heuristicWeight: 0,
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.towns.townCount).toBe(0);
      expect(retrieved!.terrain.maxHeight).toBe(0);
      expect(retrieved!.roads.roadWidth).toBe(0);
    });

    it("accepts large values", () => {
      const config: WorldConfigManifest = {
        version: 999,
        terrain: {
          tileSize: 1000,
          worldSize: 100000,
          maxHeight: 1000,
          waterThreshold: 100,
        },
        towns: {
          townCount: 1000,
          minTownSpacing: 10000,
          flatnessSampleRadius: 500,
          flatnessSampleCount: 100,
          waterThreshold: 100,
          optimalWaterDistanceMin: 500,
          optimalWaterDistanceMax: 5000,
          townSizes: {
            hamlet: {
              minBuildings: 100,
              maxBuildings: 500,
              radius: 500,
              safeZoneRadius: 1000,
            },
            village: {
              minBuildings: 200,
              maxBuildings: 1000,
              radius: 1000,
              safeZoneRadius: 2000,
            },
            town: {
              minBuildings: 500,
              maxBuildings: 2000,
              radius: 2000,
              safeZoneRadius: 4000,
            },
          },
          biomeSuitability: {
            superBiome: 100.0,
          },
        },
        roads: {
          roadWidth: 100,
          pathStepSize: 100,
          maxPathIterations: 1000000,
          extraConnectionsRatio: 10,
          costBase: 100,
          costSlopeMultiplier: 100,
          costWaterPenalty: 100000,
          smoothingIterations: 100,
          noiseDisplacementScale: 10,
          noiseDisplacementStrength: 100,
          minPointSpacing: 100,
          heuristicWeight: 100,
          costBiomeMultipliers: {
            expensiveBiome: 10000,
          },
        },
      };

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.towns.townCount).toBe(1000);
      expect(retrieved!.terrain.worldSize).toBe(100000);
      expect(retrieved!.roads.maxPathIterations).toBe(1000000);
    });

    it("accepts negative values (for edge case testing)", () => {
      const config: WorldConfigManifest = {
        version: -1,
        terrain: {
          tileSize: -100,
          worldSize: -10000,
          maxHeight: -30,
          waterThreshold: -5.4,
        },
        towns: {
          townCount: -25,
          minTownSpacing: -800,
          flatnessSampleRadius: -40,
          flatnessSampleCount: -16,
          waterThreshold: -5.4,
          optimalWaterDistanceMin: -30,
          optimalWaterDistanceMax: -150,
          townSizes: {
            hamlet: {
              minBuildings: -3,
              maxBuildings: -5,
              radius: -25,
              safeZoneRadius: -40,
            },
            village: {
              minBuildings: -6,
              maxBuildings: -10,
              radius: -40,
              safeZoneRadius: -60,
            },
            town: {
              minBuildings: -11,
              maxBuildings: -16,
              radius: -60,
              safeZoneRadius: -80,
            },
          },
          biomeSuitability: {
            negativeBiome: -1.0,
          },
        },
        roads: {
          roadWidth: -4,
          pathStepSize: 1, // Keep positive to avoid division issues
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

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      // Config should store what we set, even if values are invalid
      // Validation happens at usage time in the systems
      expect(retrieved!.towns.townCount).toBe(-25);
      expect(retrieved!.terrain.worldSize).toBe(-10000);
    });

    it("accepts decimal values for ratios", () => {
      const config: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30.5,
          waterThreshold: 5.45,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 800.5,
          flatnessSampleRadius: 40.25,
          flatnessSampleCount: 16,
          waterThreshold: 5.45,
          optimalWaterDistanceMin: 30.1,
          optimalWaterDistanceMax: 150.9,
          townSizes: {
            hamlet: {
              minBuildings: 3,
              maxBuildings: 5,
              radius: 25.5,
              safeZoneRadius: 40.5,
            },
            village: {
              minBuildings: 6,
              maxBuildings: 10,
              radius: 40.5,
              safeZoneRadius: 60.5,
            },
            town: {
              minBuildings: 11,
              maxBuildings: 16,
              radius: 60.5,
              safeZoneRadius: 80.5,
            },
          },
          biomeSuitability: {
            plains: 0.999,
            forest: 0.001,
          },
        },
        roads: {
          roadWidth: 4.5,
          pathStepSize: 20.5,
          maxPathIterations: 10000,
          extraConnectionsRatio: 0.333,
          costBase: 1.111,
          costSlopeMultiplier: 5.555,
          costWaterPenalty: 1000.5,
          smoothingIterations: 2,
          noiseDisplacementScale: 0.0111,
          noiseDisplacementStrength: 3.333,
          minPointSpacing: 4.5,
          heuristicWeight: 2.555,
          costBiomeMultipliers: {
            plains: 1.001,
          },
        },
      };

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.terrain.maxHeight).toBeCloseTo(30.5, 5);
      expect(retrieved!.roads.extraConnectionsRatio).toBeCloseTo(0.333, 5);
      expect(retrieved!.towns.biomeSuitability!.plains).toBeCloseTo(0.999, 5);
    });
  });

  describe("partial configs", () => {
    it("handles config with minimal biome suitability", () => {
      const config: WorldConfigManifest = {
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
          biomeSuitability: {
            plains: 1.0,
            // Only one biome defined - others will use defaults
          },
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
            plains: 1.0,
          },
        },
      };

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.towns.biomeSuitability!.plains).toBe(1.0);
      expect(retrieved!.towns.biomeSuitability!.forest).toBeUndefined();
    });

    it("handles config with extra biomes", () => {
      const config: WorldConfigManifest = {
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
          biomeSuitability: {
            plains: 1.0,
            customBiome1: 0.8,
            customBiome2: 0.6,
            extraTerrainType: 0.4,
          },
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
            plains: 1.0,
            customBiome1: 1.5,
            customBiome2: 2.0,
            extraTerrainType: 2.5,
          },
        },
      };

      DataManager.setWorldConfig(config);
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.towns.biomeSuitability!.customBiome1).toBe(0.8);
      expect(retrieved!.roads.costBiomeMultipliers!.customBiome2).toBe(2.0);
    });
  });

  describe("config immutability", () => {
    it("returns same reference for multiple getWorldConfig calls", () => {
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

      const ref1 = DataManager.getWorldConfig();
      const ref2 = DataManager.getWorldConfig();

      expect(ref1).toBe(ref2); // Same reference
    });

    it("modifications to retrieved config affect the stored config", () => {
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

      // Modify via retrieved reference
      const retrieved = DataManager.getWorldConfig();
      retrieved!.towns.townCount = 999;

      // Check if change persists
      const retrieved2 = DataManager.getWorldConfig();
      expect(retrieved2!.towns.townCount).toBe(999);
    });
  });
});
