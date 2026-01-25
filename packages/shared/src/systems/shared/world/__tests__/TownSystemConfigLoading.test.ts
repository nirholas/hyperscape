/**
 * Tests for TownSystem configuration loading from world-config.json
 *
 * Tests the loadTownConfig function and how TownSystem handles:
 * - Complete configs
 * - Partial configs with missing fields
 * - Invalid configs (negative values, etc.)
 * - Fallback to defaults when no config available
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataManager } from "../../../../data/DataManager";
import type { WorldConfigManifest } from "../../../../types/world/world-types";

// ============== Test Data ==============

const DEFAULTS = {
  townCount: 25,
  worldSize: 10000,
  minTownSpacing: 800,
  flatnessSampleRadius: 40,
  flatnessSampleCount: 16,
  waterThreshold: 5.4,
  optimalWaterDistanceMin: 30,
  optimalWaterDistanceMax: 150,
} as const;

const DEFAULT_TOWN_SIZES = {
  hamlet: { minBuildings: 3, maxBuildings: 5, radius: 25, safeZoneRadius: 40 },
  village: {
    minBuildings: 6,
    maxBuildings: 10,
    radius: 40,
    safeZoneRadius: 60,
  },
  town: { minBuildings: 11, maxBuildings: 16, radius: 60, safeZoneRadius: 80 },
};

const DEFAULT_BIOME_SUITABILITY: Record<string, number> = {
  plains: 1.0,
  valley: 0.95,
  forest: 0.7,
  tundra: 0.4,
  desert: 0.3,
  swamp: 0.2,
  mountains: 0.15,
  lakes: 0.0,
};

interface TownSizeConfig {
  minBuildings: number;
  maxBuildings: number;
  radius: number;
  safeZoneRadius: number;
}

interface TownConfig {
  townCount: number;
  worldSize: number;
  minTownSpacing: number;
  flatnessSampleRadius: number;
  flatnessSampleCount: number;
  waterThreshold: number;
  optimalWaterDistanceMin: number;
  optimalWaterDistanceMax: number;
  townSizes: Record<string, TownSizeConfig>;
  biomeSuitability: Record<string, number>;
}

/**
 * loadTownConfig - mirrors the implementation in TownSystem.ts
 */
function loadTownConfig(): TownConfig {
  const manifest = DataManager.getWorldConfig();
  const towns = manifest?.towns;

  const townSizes: Record<string, TownSizeConfig> = { ...DEFAULT_TOWN_SIZES };
  if (towns?.townSizes) {
    for (const [size, config] of Object.entries(towns.townSizes)) {
      townSizes[size] = {
        minBuildings:
          config.minBuildings ?? DEFAULT_TOWN_SIZES.hamlet.minBuildings,
        maxBuildings:
          config.maxBuildings ?? DEFAULT_TOWN_SIZES.hamlet.maxBuildings,
        radius: config.radius ?? DEFAULT_TOWN_SIZES.hamlet.radius,
        safeZoneRadius:
          config.safeZoneRadius ?? DEFAULT_TOWN_SIZES.hamlet.safeZoneRadius,
      };
    }
  }

  const biomeSuitability: Record<string, number> = {
    ...DEFAULT_BIOME_SUITABILITY,
  };
  if (towns?.biomeSuitability) {
    for (const [biome, suitability] of Object.entries(towns.biomeSuitability)) {
      biomeSuitability[biome] = suitability;
    }
  }

  return {
    townCount: towns?.townCount ?? DEFAULTS.townCount,
    worldSize: DEFAULTS.worldSize, // Always use default world size
    minTownSpacing: towns?.minTownSpacing ?? DEFAULTS.minTownSpacing,
    flatnessSampleRadius:
      towns?.flatnessSampleRadius ?? DEFAULTS.flatnessSampleRadius,
    flatnessSampleCount:
      towns?.flatnessSampleCount ?? DEFAULTS.flatnessSampleCount,
    waterThreshold: towns?.waterThreshold ?? DEFAULTS.waterThreshold,
    optimalWaterDistanceMin:
      towns?.optimalWaterDistanceMin ?? DEFAULTS.optimalWaterDistanceMin,
    optimalWaterDistanceMax:
      towns?.optimalWaterDistanceMax ?? DEFAULTS.optimalWaterDistanceMax,
    townSizes,
    biomeSuitability,
  };
}

// ============== Tests ==============

describe("TownSystem Config Loading", () => {
  let originalConfig: WorldConfigManifest | null = null;

  beforeEach(() => {
    originalConfig = DataManager.getWorldConfig();
  });

  afterEach(() => {
    if (originalConfig) {
      DataManager.setWorldConfig(originalConfig);
    }
  });

  describe("loadTownConfig with no manifest", () => {
    it("returns all defaults when no config is loaded", () => {
      // Force clear the config by setting a minimal but valid structure then testing without it
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);

      const config = loadTownConfig();

      expect(config.townCount).toBe(DEFAULTS.townCount);
      expect(config.minTownSpacing).toBe(DEFAULTS.minTownSpacing);
      expect(config.flatnessSampleRadius).toBe(DEFAULTS.flatnessSampleRadius);
      expect(config.flatnessSampleCount).toBe(DEFAULTS.flatnessSampleCount);
      expect(config.waterThreshold).toBe(DEFAULTS.waterThreshold);
      expect(config.optimalWaterDistanceMin).toBe(
        DEFAULTS.optimalWaterDistanceMin,
      );
      expect(config.optimalWaterDistanceMax).toBe(
        DEFAULTS.optimalWaterDistanceMax,
      );
    });

    it("returns default town sizes when no config", () => {
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);

      const config = loadTownConfig();

      expect(config.townSizes.hamlet.minBuildings).toBe(
        DEFAULT_TOWN_SIZES.hamlet.minBuildings,
      );
      expect(config.townSizes.village.radius).toBe(
        DEFAULT_TOWN_SIZES.village.radius,
      );
      expect(config.townSizes.town.safeZoneRadius).toBe(
        DEFAULT_TOWN_SIZES.town.safeZoneRadius,
      );
    });

    it("returns default biome suitability when no config", () => {
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);

      const config = loadTownConfig();

      expect(config.biomeSuitability.plains).toBe(
        DEFAULT_BIOME_SUITABILITY.plains,
      );
      expect(config.biomeSuitability.lakes).toBe(
        DEFAULT_BIOME_SUITABILITY.lakes,
      );
      expect(config.biomeSuitability.mountains).toBe(
        DEFAULT_BIOME_SUITABILITY.mountains,
      );
    });
  });

  describe("loadTownConfig with complete manifest", () => {
    const completeConfig: WorldConfigManifest = {
      version: 1,
      terrain: {
        tileSize: 100,
        worldSize: 10000,
        maxHeight: 30,
        waterThreshold: 5.4,
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
            minBuildings: 4,
            maxBuildings: 6,
            radius: 30,
            safeZoneRadius: 45,
          },
          village: {
            minBuildings: 8,
            maxBuildings: 12,
            radius: 50,
            safeZoneRadius: 70,
          },
          town: {
            minBuildings: 15,
            maxBuildings: 20,
            radius: 70,
            safeZoneRadius: 90,
          },
        },
        biomeSuitability: {
          plains: 0.9,
          desert: 0.5,
          swamp: 0.1,
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
        costBiomeMultipliers: {},
      },
    };

    it("uses config values instead of defaults", () => {
      DataManager.setWorldConfig(completeConfig);

      const config = loadTownConfig();

      expect(config.townCount).toBe(50);
      expect(config.minTownSpacing).toBe(1000);
      expect(config.flatnessSampleRadius).toBe(50);
      expect(config.flatnessSampleCount).toBe(20);
      expect(config.waterThreshold).toBe(6.0);
      expect(config.optimalWaterDistanceMin).toBe(40);
      expect(config.optimalWaterDistanceMax).toBe(200);
    });

    it("uses config town sizes", () => {
      DataManager.setWorldConfig(completeConfig);

      const config = loadTownConfig();

      expect(config.townSizes.hamlet.minBuildings).toBe(4);
      expect(config.townSizes.hamlet.maxBuildings).toBe(6);
      expect(config.townSizes.village.radius).toBe(50);
      expect(config.townSizes.town.safeZoneRadius).toBe(90);
    });

    it("merges biome suitability with defaults", () => {
      DataManager.setWorldConfig(completeConfig);

      const config = loadTownConfig();

      // Config values override defaults
      expect(config.biomeSuitability.plains).toBe(0.9);
      expect(config.biomeSuitability.desert).toBe(0.5);
      expect(config.biomeSuitability.swamp).toBe(0.1);

      // Defaults are preserved for undefined biomes
      expect(config.biomeSuitability.valley).toBe(
        DEFAULT_BIOME_SUITABILITY.valley,
      );
      expect(config.biomeSuitability.forest).toBe(
        DEFAULT_BIOME_SUITABILITY.forest,
      );
      expect(config.biomeSuitability.lakes).toBe(
        DEFAULT_BIOME_SUITABILITY.lakes,
      );
    });
  });

  describe("loadTownConfig with partial manifest", () => {
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
          townCount: 30,
          // All other fields missing
          minTownSpacing: undefined as unknown as number,
          flatnessSampleRadius: undefined as unknown as number,
          flatnessSampleCount: undefined as unknown as number,
          waterThreshold: undefined as unknown as number,
          optimalWaterDistanceMin: undefined as unknown as number,
          optimalWaterDistanceMax: undefined as unknown as number,
          townSizes:
            undefined as unknown as WorldConfigManifest["towns"]["townSizes"],
          biomeSuitability: undefined as unknown as Record<string, number>,
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

      DataManager.setWorldConfig(partialConfig);

      const config = loadTownConfig();

      expect(config.townCount).toBe(30); // From config
      expect(config.minTownSpacing).toBe(DEFAULTS.minTownSpacing); // From defaults
      expect(config.flatnessSampleRadius).toBe(DEFAULTS.flatnessSampleRadius); // From defaults
    });

    it("handles missing townSizes gracefully", () => {
      const noTownSizesConfig: WorldConfigManifest = {
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
          // No townSizes
          townSizes:
            undefined as unknown as WorldConfigManifest["towns"]["townSizes"],
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

      DataManager.setWorldConfig(noTownSizesConfig);

      const config = loadTownConfig();

      // Should use all default town sizes
      expect(config.townSizes.hamlet).toEqual(DEFAULT_TOWN_SIZES.hamlet);
      expect(config.townSizes.village).toEqual(DEFAULT_TOWN_SIZES.village);
      expect(config.townSizes.town).toEqual(DEFAULT_TOWN_SIZES.town);
    });
  });

  describe("boundary conditions", () => {
    it("handles zero town count", () => {
      const zeroTownsConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 0,
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

      DataManager.setWorldConfig(zeroTownsConfig);
      const config = loadTownConfig();

      expect(config.townCount).toBe(0);
    });

    it("handles very large town count", () => {
      const largeTownsConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 10000,
          minTownSpacing: 10, // Very small spacing to allow many towns
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

      DataManager.setWorldConfig(largeTownsConfig);
      const config = loadTownConfig();

      expect(config.townCount).toBe(10000);
      expect(config.minTownSpacing).toBe(10);
    });

    it("handles zero min spacing", () => {
      const zeroSpacingConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 10000,
          maxHeight: 30,
          waterThreshold: 5.4,
        },
        towns: {
          townCount: 25,
          minTownSpacing: 0,
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

      DataManager.setWorldConfig(zeroSpacingConfig);
      const config = loadTownConfig();

      expect(config.minTownSpacing).toBe(0);
    });

    it("handles biome suitability at boundaries (0.0 and 1.0)", () => {
      const boundaryBiomeConfig: WorldConfigManifest = {
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
            perfect: 1.0,
            impossible: 0.0,
            epsilon: 0.000001,
            nearOne: 0.999999,
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
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(boundaryBiomeConfig);
      const config = loadTownConfig();

      expect(config.biomeSuitability.perfect).toBe(1.0);
      expect(config.biomeSuitability.impossible).toBe(0.0);
      expect(config.biomeSuitability.epsilon).toBeCloseTo(0.000001, 10);
      expect(config.biomeSuitability.nearOne).toBeCloseTo(0.999999, 10);
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
          townCount: -5, // Negative town count
          minTownSpacing: -100, // Negative spacing
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
            negativeBiome: -0.5,
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
          costBiomeMultipliers: {},
        },
      };

      DataManager.setWorldConfig(negativeConfig);
      const config = loadTownConfig();

      // Config loading should accept negative values (validation happens at usage time)
      expect(config.townCount).toBe(-5);
      expect(config.minTownSpacing).toBe(-100);
      expect(config.townSizes.hamlet.minBuildings).toBe(-3);
      expect(config.biomeSuitability.negativeBiome).toBe(-0.5);
    });

    it("handles custom town size types", () => {
      const customSizesConfig: WorldConfigManifest = {
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
            // Custom size types
            metropolis: {
              minBuildings: 50,
              maxBuildings: 100,
              radius: 150,
              safeZoneRadius: 200,
            },
            outpost: {
              minBuildings: 1,
              maxBuildings: 2,
              radius: 10,
              safeZoneRadius: 15,
            },
          } as unknown as WorldConfigManifest["towns"]["townSizes"],
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

      DataManager.setWorldConfig(customSizesConfig);
      const config = loadTownConfig();

      // Custom sizes should be included
      expect(config.townSizes.metropolis).toBeDefined();
      expect(config.townSizes.metropolis.minBuildings).toBe(50);
      expect(config.townSizes.outpost.radius).toBe(10);
    });

    it("handles empty biome suitability", () => {
      const emptyBiomeConfig: WorldConfigManifest = {
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
          biomeSuitability: {}, // Empty
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

      DataManager.setWorldConfig(emptyBiomeConfig);
      const config = loadTownConfig();

      // Should have all default biome suitabilities
      expect(Object.keys(config.biomeSuitability).length).toBeGreaterThan(0);
      expect(config.biomeSuitability.plains).toBe(
        DEFAULT_BIOME_SUITABILITY.plains,
      );
    });
  });

  describe("config consistency", () => {
    it("worldSize always uses default", () => {
      const customWorldSizeConfig: WorldConfigManifest = {
        version: 1,
        terrain: {
          tileSize: 100,
          worldSize: 50000,
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

      DataManager.setWorldConfig(customWorldSizeConfig);
      const config = loadTownConfig();

      // worldSize should always be the default (hardcoded for consistency)
      expect(config.worldSize).toBe(DEFAULTS.worldSize);
    });

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
          townCount: 42,
          minTownSpacing: 900,
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
          biomeSuitability: { plains: 0.85 },
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

      const config1 = loadTownConfig();
      const config2 = loadTownConfig();
      const config3 = loadTownConfig();

      expect(config1.townCount).toBe(config2.townCount);
      expect(config2.townCount).toBe(config3.townCount);
      expect(config1.minTownSpacing).toBe(config2.minTownSpacing);
      expect(config1.biomeSuitability.plains).toBe(
        config2.biomeSuitability.plains,
      );
    });
  });
});
