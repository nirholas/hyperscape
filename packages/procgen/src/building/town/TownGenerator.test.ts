/**
 * TownGenerator Tests
 *
 * Comprehensive tests for procedural town generation including
 * terrain integration, building placement, and town features.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TownGenerator } from "./TownGenerator";
import { createTerrainProviderFromGenerator } from "./types";
import type { TerrainProvider, TownGenerationOptions } from "./types";

// Create a mock terrain generator that implements the interface needed
const createMockTerrainGenerator = (seed: number = 12345) => ({
  getHeightAt: (x: number, z: number): number => {
    // Simple deterministic height function
    const hash = Math.sin(x * 0.01 + seed) * Math.cos(z * 0.01 + seed);
    return 10 + hash * 5; // Heights between 5 and 15
  },
  queryPoint: (x: number, z: number) => {
    // Deterministic biome assignment based on position
    const biomeVal = Math.sin(x * 0.005 + z * 0.007 + seed) * 0.5 + 0.5;
    if (biomeVal > 0.7) return { biome: "plains" };
    if (biomeVal > 0.4) return { biome: "forest" };
    return { biome: "valley" };
  },
  getWaterThreshold: () => 5.4,
  isUnderwater: (x: number, z: number) => {
    const height =
      10 + Math.sin(x * 0.01 + seed) * Math.cos(z * 0.01 + seed) * 5;
    return height < 5.4;
  },
});

describe("TownGenerator", () => {
  let generator: TownGenerator;

  beforeEach(() => {
    generator = new TownGenerator({ seed: 12345 });
  });

  describe("initialization", () => {
    it("should create generator with default options", () => {
      const gen = new TownGenerator();
      const config = gen.getConfig();
      expect(config.townCount).toBe(25);
      expect(config.worldSize).toBe(10000);
    });

    it("should create generator with custom seed", () => {
      const gen = new TownGenerator({ seed: 54321 });
      expect(gen).toBeDefined();
    });

    it("should create generator with custom config", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: {
          townCount: 10,
          minTownSpacing: 500,
        },
      });
      const config = gen.getConfig();
      expect(config.townCount).toBe(10);
      expect(config.minTownSpacing).toBe(500);
    });
  });

  describe("fromTerrainGenerator factory", () => {
    it("should create TownGenerator from mock terrain generator", () => {
      const mockTerrain = createMockTerrainGenerator(12345);
      const townGen = TownGenerator.fromTerrainGenerator(mockTerrain, {
        seed: 12345,
      });
      expect(townGen).toBeInstanceOf(TownGenerator);
    });

    it("should use terrain height provider from generator", () => {
      const mockTerrain = createMockTerrainGenerator(12345);
      const townGen = TownGenerator.fromTerrainGenerator(mockTerrain, {
        seed: 12345,
        config: { townCount: 3 },
      });
      const result = townGen.generate();
      expect(result.towns.length).toBeGreaterThan(0);
      // All towns should have height > 0
      for (const town of result.towns) {
        expect(town.position.y).toBeGreaterThan(0);
      }
    });
  });

  describe("createTerrainProviderFromGenerator helper", () => {
    it("should create valid TerrainProvider from mock", () => {
      const mockTerrain = createMockTerrainGenerator(12345);
      const provider = createTerrainProviderFromGenerator(mockTerrain);

      expect(provider.getHeightAt(0, 0)).toBeTypeOf("number");
      expect(provider.getBiomeAt?.(0, 0)).toBeTypeOf("string");
      expect(provider.getWaterThreshold?.()).toBe(5.4);
    });

    it("should use queryPoint for biome when available", () => {
      const mockTerrain = createMockTerrainGenerator(12345);
      const provider = createTerrainProviderFromGenerator(mockTerrain);

      const biome = provider.getBiomeAt?.(0, 0);
      expect(["plains", "forest", "valley"]).toContain(biome);
    });
  });

  describe("town generation", () => {
    it("should generate deterministic towns", () => {
      const gen1 = new TownGenerator({ seed: 12345 });
      const gen2 = new TownGenerator({ seed: 12345 });

      const result1 = gen1.generate();
      const result2 = gen2.generate();

      expect(result1.towns.length).toBe(result2.towns.length);
      for (let i = 0; i < result1.towns.length; i++) {
        expect(result1.towns[i].position.x).toBe(result2.towns[i].position.x);
        expect(result1.towns[i].position.z).toBe(result2.towns[i].position.z);
        expect(result1.towns[i].name).toBe(result2.towns[i].name);
      }
    });

    it("should produce different towns with different seeds", () => {
      const gen1 = new TownGenerator({ seed: 111 });
      const gen2 = new TownGenerator({ seed: 222 });

      const result1 = gen1.generate();
      const result2 = gen2.generate();

      // Towns should be at different positions
      const positions1 = result1.towns.map(
        (t) => `${t.position.x},${t.position.z}`,
      );
      const positions2 = result2.towns.map(
        (t) => `${t.position.x},${t.position.z}`,
      );

      // At least one position should be different
      const commonPositions = positions1.filter((p) => positions2.includes(p));
      expect(commonPositions.length).toBeLessThan(positions1.length);
    });

    it("should respect minTownSpacing", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { minTownSpacing: 1000 },
      });

      const result = gen.generate();

      // Check all pairs of towns for spacing
      for (let i = 0; i < result.towns.length; i++) {
        for (let j = i + 1; j < result.towns.length; j++) {
          const t1 = result.towns[i];
          const t2 = result.towns[j];
          const dist = Math.sqrt(
            (t2.position.x - t1.position.x) ** 2 +
              (t2.position.z - t1.position.z) ** 2,
          );
          expect(dist).toBeGreaterThanOrEqual(1000);
        }
      }
    });

    it("should generate towns with valid sizes", () => {
      const result = generator.generate();

      for (const town of result.towns) {
        expect(["hamlet", "village", "town"]).toContain(town.size);
        expect(town.safeZoneRadius).toBeGreaterThan(0);
      }
    });
  });

  describe("town features", () => {
    let town: ReturnType<typeof generator.generate>["towns"][0];
    let result: ReturnType<typeof generator.generate>;

    beforeEach(() => {
      result = generator.generate();
      town = result.towns[0];
    });

    it("should generate buildings for some towns", () => {
      // With flat terrain provider, building placement may be limited
      // At minimum, there should be at least some buildings generated overall
      const totalBuildings = result.towns.reduce(
        (sum, t) => sum + t.buildings.length,
        0,
      );
      expect(totalBuildings).toBeGreaterThan(0);
    });

    it("should generate essential building types", () => {
      const result = generator.generate();

      // At least some towns should have essential buildings
      const allBuildingTypes = new Set(
        result.towns.flatMap((t) => t.buildings.map((b) => b.type)),
      );
      expect(allBuildingTypes.has("bank")).toBe(true);
      expect(allBuildingTypes.has("store")).toBe(true);
    });

    it("should generate town layout with internal roads", () => {
      expect(town.internalRoads).toBeDefined();
      expect(town.internalRoads!.length).toBeGreaterThan(0);
    });

    it("should generate entry points for towns", () => {
      expect(town.entryPoints).toBeDefined();
      expect(town.entryPoints!.length).toBeGreaterThan(0);
    });

    it("should generate paths from roads to buildings", () => {
      expect(town.paths).toBeDefined();
      // Some towns should have paths
      const result = generator.generate();
      const townsWithPaths = result.towns.filter(
        (t) => t.paths && t.paths.length > 0,
      );
      expect(townsWithPaths.length).toBeGreaterThan(0);
    });

    it("should generate landmarks for villages and towns", () => {
      const result = generator.generate();
      const villagesAndTowns = result.towns.filter(
        (t) => t.size === "village" || t.size === "town",
      );

      // Villages and towns should have landmarks
      for (const t of villagesAndTowns) {
        expect(t.landmarks).toBeDefined();
        expect(t.landmarks!.length).toBeGreaterThan(0);
      }
    });

    it("should generate plazas for villages and towns", () => {
      const result = generator.generate();
      const villagesAndTowns = result.towns.filter(
        (t) => t.size === "village" || t.size === "town",
      );

      // Villages and towns should have plazas
      for (const t of villagesAndTowns) {
        expect(t.plaza).toBeDefined();
        expect(t.plaza!.radius).toBeGreaterThan(0);
      }
    });
  });

  describe("generateSingleTown", () => {
    it("should generate a single town at specified location", () => {
      const town = generator.generateSingleTown(500, 500, "village");

      expect(town.position.x).toBe(500);
      expect(town.position.z).toBe(500);
      expect(town.size).toBe("village");
    });

    it("should accept custom name and id", () => {
      const town = generator.generateSingleTown(100, 200, "town", {
        id: "custom-town-123",
        name: "Test Town",
      });

      expect(town.id).toBe("custom-town-123");
      expect(town.name).toBe("Test Town");
    });

    it("should generate complete town features", () => {
      const town = generator.generateSingleTown(0, 0, "town");

      expect(town.buildings.length).toBeGreaterThan(0);
      expect(town.internalRoads).toBeDefined();
      expect(town.entryPoints).toBeDefined();
      expect(town.plaza).toBeDefined();
      expect(town.landmarks).toBeDefined();
    });
  });

  describe("statistics", () => {
    it("should return generation statistics", () => {
      const result = generator.generate();

      expect(result.stats).toBeDefined();
      expect(result.stats.totalTowns).toBe(result.towns.length);
      expect(result.stats.candidatesEvaluated).toBeGreaterThan(0);
      expect(result.stats.generationTime).toBeGreaterThan(0);
    });

    it("should count town sizes correctly", () => {
      const result = generator.generate();

      const hamlets = result.towns.filter((t) => t.size === "hamlet").length;
      const villages = result.towns.filter((t) => t.size === "village").length;
      const towns = result.towns.filter((t) => t.size === "town").length;

      expect(result.stats.hamlets).toBe(hamlets);
      expect(result.stats.villages).toBe(villages);
      expect(result.stats.towns).toBe(towns);
    });

    it("should count buildings correctly", () => {
      const result = generator.generate();

      const totalBuildings = result.towns.reduce(
        (sum, t) => sum + t.buildings.length,
        0,
      );
      expect(result.stats.totalBuildings).toBe(totalBuildings);
    });
  });

  describe("configuration updates", () => {
    it("should update terrain provider", () => {
      const mockTerrain: TerrainProvider = {
        getHeightAt: () => 15,
        getBiomeAt: () => "desert",
      };

      generator.setTerrain(mockTerrain);
      const town = generator.generateSingleTown(0, 0, "hamlet");

      expect(town.position.y).toBe(15);
      expect(town.biome).toBe("desert");
    });

    it("should update seed", () => {
      generator.setSeed(99999);
      const result1 = generator.generate();

      generator.setSeed(99999);
      const result2 = generator.generate();

      // Same seed should produce same results
      expect(result1.towns.length).toBe(result2.towns.length);
    });
  });

  describe("avoiding existing towns", () => {
    it("should avoid existing towns when generating", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5, minTownSpacing: 500 },
      });

      // Generate first batch
      const result1 = gen.generate();

      // Generate second batch avoiding first batch
      const result2 = gen.generate(result1.towns);

      // Second batch should not overlap with first
      for (const newTown of result2.towns) {
        for (const existingTown of result1.towns) {
          const dist = Math.sqrt(
            (newTown.position.x - existingTown.position.x) ** 2 +
              (newTown.position.z - existingTown.position.z) ** 2,
          );
          expect(dist).toBeGreaterThanOrEqual(500);
        }
      }
    });
  });

  describe("building entrance placement", () => {
    it("should place building entrances on road-facing side", () => {
      // Generate a town with internal roads
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 1 },
      });
      const result = gen.generate();

      // Find a town with buildings that have entrances
      const townsWithEntrances = result.towns.filter(
        (t) =>
          t.buildings.length > 0 &&
          t.buildings.some((b) => b.entrance !== undefined),
      );

      expect(townsWithEntrances.length).toBeGreaterThan(0);

      for (const town of townsWithEntrances) {
        for (const building of town.buildings) {
          if (!building.entrance) continue;

          // Calculate the direction from building center to entrance
          const toEntranceX = building.entrance.x - building.position.x;
          const toEntranceZ = building.entrance.z - building.position.z;

          // Calculate the building's facing direction
          const facingDirX = Math.sin(building.rotation);
          const facingDirZ = Math.cos(building.rotation);

          // Normalize the entrance direction
          const entranceLen = Math.sqrt(
            toEntranceX * toEntranceX + toEntranceZ * toEntranceZ,
          );
          if (entranceLen < 0.1) continue;

          const normalizedEntranceX = toEntranceX / entranceLen;
          const normalizedEntranceZ = toEntranceZ / entranceLen;

          // Dot product should be positive (entrance in front of building)
          const dotProduct =
            normalizedEntranceX * facingDirX + normalizedEntranceZ * facingDirZ;

          // Entrance should be in front of building (dot product > 0)
          // Allow some tolerance for diagonal entrances
          expect(dotProduct).toBeGreaterThan(-0.3);
        }
      }
    });

    it("should orient buildings to face their assigned road", () => {
      const gen = new TownGenerator({
        seed: 42,
        config: { townCount: 3 },
      });
      const result = gen.generate();

      let buildingsChecked = 0;
      let buildingsFacingRoad = 0;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];
        if (roads.length === 0) continue;

        for (const building of town.buildings) {
          if (building.roadId === undefined || building.roadId < 0) continue;
          if (building.roadId >= roads.length) continue;

          buildingsChecked++;
          const road = roads[building.roadId];

          // Get road direction
          const roadDx = road.end.x - road.start.x;
          const roadDz = road.end.z - road.start.z;
          const roadLen = Math.sqrt(roadDx * roadDx + roadDz * roadDz);
          if (roadLen < 1) continue;

          // Road perpendicular directions
          const perpX = -roadDz / roadLen;
          const perpZ = roadDx / roadLen;

          // Building facing direction (Three.js: rotation.y = θ means +Z points to (sin(θ), cos(θ)))
          const facingX = Math.sin(building.rotation);
          const facingZ = Math.cos(building.rotation);

          // Building should face perpendicular to road (either +perp or -perp)
          // Dot product with perp should be close to +1 or -1
          const dotWithPerp = facingX * perpX + facingZ * perpZ;

          // Allow 45 degree tolerance (|dot| > 0.7)
          if (Math.abs(dotWithPerp) > 0.7) {
            buildingsFacingRoad++;
          }
        }
      }

      // At least 80% of buildings with roadId should face their road
      if (buildingsChecked > 0) {
        const ratio = buildingsFacingRoad / buildingsChecked;
        expect(ratio).toBeGreaterThan(0.8);
        console.log(
          `Buildings facing road: ${buildingsFacingRoad}/${buildingsChecked} (${(ratio * 100).toFixed(0)}%)`,
        );
      }
    });

    it("should place entrances closer to road than building center", () => {
      const gen = new TownGenerator({
        seed: 42,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      let entrancesChecked = 0;
      let entrancesCloserToRoad = 0;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];
        if (roads.length === 0) continue;

        for (const building of town.buildings) {
          if (!building.entrance) continue;
          if (building.roadId === undefined || building.roadId < 0) continue;
          if (building.roadId >= roads.length) continue;

          entrancesChecked++;
          const road = roads[building.roadId];

          // Find closest point on road to building center
          const roadDx = road.end.x - road.start.x;
          const roadDz = road.end.z - road.start.z;
          const roadLenSq = roadDx * roadDx + roadDz * roadDz;
          if (roadLenSq < 1) continue;

          const t = Math.max(
            0,
            Math.min(
              1,
              ((building.position.x - road.start.x) * roadDx +
                (building.position.z - road.start.z) * roadDz) /
                roadLenSq,
            ),
          );
          const closestRoadX = road.start.x + t * roadDx;
          const closestRoadZ = road.start.z + t * roadDz;

          // Distance from building center to road
          const buildingToRoad = Math.sqrt(
            (building.position.x - closestRoadX) ** 2 +
              (building.position.z - closestRoadZ) ** 2,
          );

          // Distance from entrance to road
          const entranceToRoad = Math.sqrt(
            (building.entrance.x - closestRoadX) ** 2 +
              (building.entrance.z - closestRoadZ) ** 2,
          );

          // Entrance should be closer to road than building center
          if (entranceToRoad < buildingToRoad) {
            entrancesCloserToRoad++;
          }
        }
      }

      // All entrances should be closer to road than building center
      if (entrancesChecked > 0) {
        const ratio = entrancesCloserToRoad / entrancesChecked;
        expect(ratio).toBeGreaterThan(0.9);
        console.log(
          `Entrances closer to road: ${entrancesCloserToRoad}/${entrancesChecked} (${(ratio * 100).toFixed(0)}%)`,
        );
      }
    });

    it("should place entrances at appropriate distance from building center", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 1 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        for (const building of town.buildings) {
          if (!building.entrance) continue;

          const distToEntrance = Math.sqrt(
            (building.entrance.x - building.position.x) ** 2 +
              (building.entrance.z - building.position.z) ** 2,
          );

          // Entrance should be within reasonable distance (building half depth + small offset)
          const maxExpectedDist =
            Math.max(building.size.width, building.size.depth) / 2 + 2;
          expect(distToEntrance).toBeLessThan(maxExpectedDist);
          expect(distToEntrance).toBeGreaterThan(0.1); // Entrance shouldn't be at center
        }
      }
    });
  });

  describe("path generation", () => {
    it("should generate paths from roads to building entrances", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 1 },
      });
      const result = gen.generate();

      // Find towns with paths
      const townsWithPaths = result.towns.filter(
        (t) => t.paths && t.paths.length > 0,
      );

      // Villages and towns should have paths (hamlets might not have roads)
      const largerTowns = result.towns.filter(
        (t) => t.size === "village" || t.size === "town",
      );

      // Most larger towns should have paths
      const largerTownsWithPaths = largerTowns.filter(
        (t) => t.paths && t.paths.length > 0,
      );
      expect(largerTownsWithPaths.length).toBeGreaterThanOrEqual(
        Math.floor(largerTowns.length * 0.5),
      );
    });

    it("should connect paths to building entrances", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 3 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        if (!town.paths) continue;

        for (const path of town.paths) {
          // Find the building this path connects to
          const building = town.buildings.find((b) => b.id === path.buildingId);

          if (building && building.entrance) {
            // Path end should be at or near the entrance
            const distToEntrance = Math.sqrt(
              (path.end.x - building.entrance.x) ** 2 +
                (path.end.z - building.entrance.z) ** 2,
            );

            // Path should end very close to entrance
            expect(distToEntrance).toBeLessThan(1);
          }
        }
      }
    });

    it("should have reasonable path lengths", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 3 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        if (!town.paths) continue;

        for (const path of town.paths) {
          const pathLength = Math.sqrt(
            (path.end.x - path.start.x) ** 2 + (path.end.z - path.start.z) ** 2,
          );

          // Paths should be reasonable length (not too short, not too long)
          expect(pathLength).toBeGreaterThan(0.5);
          expect(pathLength).toBeLessThan(30);

          // Path width should be positive
          expect(path.width).toBeGreaterThan(0);
        }
      }
    });

    it("should generate paths perpendicular to roads", () => {
      const gen = new TownGenerator({
        seed: 42,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        if (
          !town.paths ||
          !town.internalRoads ||
          town.internalRoads.length === 0
        )
          continue;

        for (const path of town.paths) {
          // Find the building this path connects to
          const building = town.buildings.find((b) => b.id === path.buildingId);
          if (!building || building.roadId === undefined) continue;

          const road = town.internalRoads[building.roadId];
          if (!road) continue;

          // Calculate road direction
          const roadDx = road.end.x - road.start.x;
          const roadDz = road.end.z - road.start.z;
          const roadLen = Math.sqrt(roadDx * roadDx + roadDz * roadDz);
          if (roadLen < 0.1) continue;

          // Calculate path direction
          const pathDx = path.end.x - path.start.x;
          const pathDz = path.end.z - path.start.z;
          const pathLen = Math.sqrt(pathDx * pathDx + pathDz * pathDz);
          if (pathLen < 0.1) continue;

          // Dot product of perpendicular vectors should be near zero
          const dotProduct =
            (roadDx * pathDx + roadDz * pathDz) / (roadLen * pathLen);

          // Allow some tolerance (paths may not be perfectly perpendicular due to entrance offset)
          expect(Math.abs(dotProduct)).toBeLessThan(0.5);
        }
      }
    });

    it("should handle hamlets without internal roads", () => {
      // Generate multiple times to ensure we get hamlets
      const gen = new TownGenerator({
        seed: 99999,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      const hamlets = result.towns.filter((t) => t.size === "hamlet");

      for (const hamlet of hamlets) {
        // Hamlets may not have internal roads
        if (!hamlet.internalRoads || hamlet.internalRoads.length === 0) {
          // Should still have buildings
          expect(hamlet.buildings.length).toBeGreaterThan(0);
          // Paths array should exist but may be empty
          expect(hamlet.paths).toBeDefined();
        }
      }
    });

    it("should handle buildings without assigned roadId", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      // Count buildings with and without roadId
      let withRoadId = 0;
      let withoutRoadId = 0;

      for (const town of result.towns) {
        for (const building of town.buildings) {
          if (building.roadId !== undefined && building.roadId >= 0) {
            withRoadId++;
          } else {
            withoutRoadId++;
          }
        }
      }

      // Most buildings should have a roadId in towns with roads
      // (hamlets may not have roads, so some buildings won't have roadId)
      expect(withRoadId).toBeGreaterThan(0);
    });

    it("should verify path starts at road edge, not road center", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 3 },
      });
      const result = gen.generate();

      const ROAD_HALF_WIDTH = 4; // From TOWN_CONSTANTS

      for (const town of result.towns) {
        if (!town.paths || !town.internalRoads) continue;

        for (const path of town.paths) {
          const building = town.buildings.find((b) => b.id === path.buildingId);
          if (!building || building.roadId === undefined) continue;

          const road = town.internalRoads[building.roadId];
          if (!road) continue;

          // Find closest point on road to path start
          const roadDx = road.end.x - road.start.x;
          const roadDz = road.end.z - road.start.z;
          const roadLenSq = roadDx * roadDx + roadDz * roadDz;
          if (roadLenSq < 0.01) continue;

          const t = Math.max(
            0,
            Math.min(
              1,
              ((path.start.x - road.start.x) * roadDx +
                (path.start.z - road.start.z) * roadDz) /
                roadLenSq,
            ),
          );
          const closestX = road.start.x + t * roadDx;
          const closestZ = road.start.z + t * roadDz;

          // Distance from path start to road center should be approximately road half width
          const distToRoadCenter = Math.sqrt(
            (path.start.x - closestX) ** 2 + (path.start.z - closestZ) ** 2,
          );

          // Path should start at road edge (within tolerance)
          expect(distToRoadCenter).toBeGreaterThan(ROAD_HALF_WIDTH * 0.5);
          expect(distToRoadCenter).toBeLessThan(ROAD_HALF_WIDTH * 2);
        }
      }
    });

    it("should not create paths for buildings too close to roads", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        if (!town.paths || !town.internalRoads) continue;

        for (const path of town.paths) {
          const pathLength = Math.sqrt(
            (path.end.x - path.start.x) ** 2 + (path.end.z - path.start.z) ** 2,
          );

          // No paths should be shorter than minimum threshold (0.5m)
          expect(pathLength).toBeGreaterThanOrEqual(0.5);
        }
      }
    });

    it("should generate deterministic paths with same seed", () => {
      const gen1 = new TownGenerator({ seed: 77777, config: { townCount: 3 } });
      const gen2 = new TownGenerator({ seed: 77777, config: { townCount: 3 } });

      const result1 = gen1.generate();
      const result2 = gen2.generate();

      expect(result1.towns.length).toBe(result2.towns.length);

      for (let i = 0; i < result1.towns.length; i++) {
        const paths1 = result1.towns[i].paths ?? [];
        const paths2 = result2.towns[i].paths ?? [];

        expect(paths1.length).toBe(paths2.length);

        for (let j = 0; j < paths1.length; j++) {
          expect(paths1[j].start.x).toBeCloseTo(paths2[j].start.x, 5);
          expect(paths1[j].start.z).toBeCloseTo(paths2[j].start.z, 5);
          expect(paths1[j].end.x).toBeCloseTo(paths2[j].end.x, 5);
          expect(paths1[j].end.z).toBeCloseTo(paths2[j].end.z, 5);
        }
      }
    });
  });

  describe("critical assessment: road-building integration", () => {
    it("should have internal roads that buildings are placed along", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      let townsWithRoads = 0;
      let buildingsWithRoadId = 0;
      let totalBuildings = 0;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];
        if (roads.length > 0) townsWithRoads++;

        for (const building of town.buildings) {
          totalBuildings++;
          if (building.roadId !== undefined && building.roadId >= 0) {
            buildingsWithRoadId++;
          }
        }
      }

      console.log(`Towns with roads: ${townsWithRoads}/${result.towns.length}`);
      console.log(
        `Buildings with roadId: ${buildingsWithRoadId}/${totalBuildings}`,
      );

      // Larger towns (villages, towns) should have internal roads
      const largerTowns = result.towns.filter(
        (t) => t.size === "village" || t.size === "town",
      );
      const largerTownsWithRoads = largerTowns.filter(
        (t) => (t.internalRoads?.length ?? 0) > 0,
      );
      expect(largerTownsWithRoads.length).toBe(largerTowns.length);
    });

    it("should have entry points at the ends of internal roads", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      let entryPointsAtRoadEnds = 0;
      let totalEntryPoints = 0;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];
        const entries = town.entryPoints ?? [];
        totalEntryPoints += entries.length;

        for (const entry of entries) {
          // Check if entry is near any road endpoint
          for (const road of roads) {
            const distToStart = Math.sqrt(
              (entry.position.x - road.start.x) ** 2 +
                (entry.position.z - road.start.z) ** 2,
            );
            const distToEnd = Math.sqrt(
              (entry.position.x - road.end.x) ** 2 +
                (entry.position.z - road.end.z) ** 2,
            );
            if (distToStart < 5 || distToEnd < 5) {
              entryPointsAtRoadEnds++;
              break;
            }
          }
        }
      }

      console.log(
        `Entry points at road ends: ${entryPointsAtRoadEnds}/${totalEntryPoints}`,
      );

      // Most entry points should be at road ends
      if (totalEntryPoints > 0) {
        expect(entryPointsAtRoadEnds / totalEntryPoints).toBeGreaterThan(0.8);
      }
    });

    it("should have paths connecting building entrances to roads", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      let pathsToRoad = 0;
      let totalPaths = 0;

      for (const town of result.towns) {
        const paths = town.paths ?? [];
        const roads = town.internalRoads ?? [];
        totalPaths += paths.length;

        for (const path of paths) {
          // Check if path start is near any road
          for (const road of roads) {
            // Project path start onto road
            const roadDx = road.end.x - road.start.x;
            const roadDz = road.end.z - road.start.z;
            const roadLenSq = roadDx * roadDx + roadDz * roadDz;
            if (roadLenSq < 1) continue;

            const t = Math.max(
              0,
              Math.min(
                1,
                ((path.start.x - road.start.x) * roadDx +
                  (path.start.z - road.start.z) * roadDz) /
                  roadLenSq,
              ),
            );
            const closestX = road.start.x + t * roadDx;
            const closestZ = road.start.z + t * roadDz;

            const distToRoad = Math.sqrt(
              (path.start.x - closestX) ** 2 + (path.start.z - closestZ) ** 2,
            );

            // Path start should be near road edge (within road width)
            if (distToRoad < 10) {
              pathsToRoad++;
              break;
            }
          }
        }
      }

      console.log(`Paths starting at road: ${pathsToRoad}/${totalPaths}`);

      // All paths should start at road edge
      if (totalPaths > 0) {
        expect(pathsToRoad / totalPaths).toBeGreaterThan(0.9);
      }
    });

    it("should verify complete road-to-building-entrance chain", () => {
      const gen = new TownGenerator({
        seed: 42,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      let completeChains = 0;
      let totalBuildingsWithEntrances = 0;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];
        const paths = town.paths ?? [];

        for (const building of town.buildings) {
          if (!building.entrance) continue;
          totalBuildingsWithEntrances++;

          // Find path for this building
          const buildingPath = paths.find((p) => p.buildingId === building.id);
          if (!buildingPath) continue;

          // Verify path ends at entrance
          const pathToEntrance = Math.sqrt(
            (buildingPath.end.x - building.entrance.x) ** 2 +
              (buildingPath.end.z - building.entrance.z) ** 2,
          );
          if (pathToEntrance > 2) continue;

          // Verify path starts near a road
          let nearRoad = false;
          for (const road of roads) {
            const roadDx = road.end.x - road.start.x;
            const roadDz = road.end.z - road.start.z;
            const roadLenSq = roadDx * roadDx + roadDz * roadDz;
            if (roadLenSq < 1) continue;

            const t = Math.max(
              0,
              Math.min(
                1,
                ((buildingPath.start.x - road.start.x) * roadDx +
                  (buildingPath.start.z - road.start.z) * roadDz) /
                  roadLenSq,
              ),
            );
            const closestX = road.start.x + t * roadDx;
            const closestZ = road.start.z + t * roadDz;
            const distToRoad = Math.sqrt(
              (buildingPath.start.x - closestX) ** 2 +
                (buildingPath.start.z - closestZ) ** 2,
            );
            if (distToRoad < 10) {
              nearRoad = true;
              break;
            }
          }

          if (nearRoad) {
            completeChains++;
          }
        }
      }

      console.log(
        `Complete road->path->entrance chains: ${completeChains}/${totalBuildingsWithEntrances}`,
      );

      // Most buildings with entrances should have complete chains
      if (totalBuildingsWithEntrances > 0) {
        expect(completeChains / totalBuildingsWithEntrances).toBeGreaterThan(
          0.7,
        );
      }
    });
  });

  describe("edge cases and boundary conditions", () => {
    it("should handle zero building count gracefully", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 0 },
      });
      const result = gen.generate();

      expect(result.towns.length).toBe(0);
      expect(result.stats.totalTowns).toBe(0);
    });

    it("should handle very large world size", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5, worldSize: 100000 },
      });
      const result = gen.generate();

      expect(result.towns.length).toBeGreaterThan(0);

      // All towns should be within world bounds
      for (const town of result.towns) {
        expect(Math.abs(town.position.x)).toBeLessThan(50000);
        expect(Math.abs(town.position.z)).toBeLessThan(50000);
      }
    });

    it("should handle very small min spacing", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 10, minTownSpacing: 10 },
      });
      const result = gen.generate();

      // Should still generate towns
      expect(result.towns.length).toBeGreaterThan(0);
    });

    it("should handle terrain that returns consistent height", () => {
      const flatTerrain: TerrainProvider = {
        getHeightAt: () => 10,
        getBiomeAt: () => "plains",
      };

      const gen = new TownGenerator({
        seed: 12345,
        terrain: flatTerrain,
        config: { townCount: 3 },
      });
      const result = gen.generate();

      // All towns should have same height
      for (const town of result.towns) {
        expect(town.position.y).toBe(10);
      }

      // All buildings should have same height
      for (const town of result.towns) {
        for (const building of town.buildings) {
          expect(building.position.y).toBe(10);
        }
      }
    });

    it("should handle underwater terrain by not placing towns", () => {
      const underwaterTerrain: TerrainProvider = {
        getHeightAt: () => 0, // Below water threshold (5.4)
        getBiomeAt: () => "lakes",
        getWaterThreshold: () => 5.4,
      };

      const gen = new TownGenerator({
        seed: 12345,
        terrain: underwaterTerrain,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      // Should not place any towns underwater
      expect(result.towns.length).toBe(0);
    });

    it("should verify all path buildingIds reference valid buildings", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      for (const town of result.towns) {
        if (!town.paths) continue;

        const buildingIds = new Set(town.buildings.map((b) => b.id));

        for (const path of town.paths) {
          expect(buildingIds.has(path.buildingId)).toBe(true);
        }
      }
    });
  });

  describe("NESW building alignment", () => {
    it("should align all buildings to NESW grid (0°, 90°, 180°, 270°)", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 10 },
      });
      const result = gen.generate();

      // Valid rotations in radians (with small tolerance for floating point)
      const validRotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      // Also handle -π (same as π) and 2π (same as 0)
      const tolerance = 0.001;

      let buildingsChecked = 0;
      let buildingsAligned = 0;

      for (const town of result.towns) {
        for (const building of town.buildings) {
          buildingsChecked++;

          // Normalize rotation to [0, 2π)
          let normalizedRotation =
            ((building.rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

          // Check if rotation is close to any valid NESW rotation
          const isAligned = validRotations.some(
            (valid) =>
              Math.abs(normalizedRotation - valid) < tolerance ||
              Math.abs(normalizedRotation - valid - 2 * Math.PI) < tolerance,
          );

          if (isAligned) {
            buildingsAligned++;
          } else {
            console.log(
              `Building ${building.id} has non-NESW rotation: ${(building.rotation * 180) / Math.PI}°`,
            );
          }
        }
      }

      console.log(
        `NESW aligned buildings: ${buildingsAligned}/${buildingsChecked} (${((buildingsAligned / buildingsChecked) * 100).toFixed(0)}%)`,
      );

      // All buildings must be NESW aligned
      expect(buildingsAligned).toBe(buildingsChecked);
    });

    it("should align hamlet buildings (radial layout) to NESW", () => {
      const gen = new TownGenerator({
        seed: 99999,
        config: { townCount: 20 },
      });
      const result = gen.generate();

      const hamlets = result.towns.filter((t) => t.size === "hamlet");
      const tolerance = 0.001;

      for (const hamlet of hamlets) {
        for (const building of hamlet.buildings) {
          // Normalize rotation to [0, 2π)
          let normalizedRotation =
            ((building.rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

          // Check if rotation is a multiple of π/2 (0°, 90°, 180°, 270°)
          const quarterTurns = normalizedRotation / (Math.PI / 2);
          const isAligned =
            Math.abs(quarterTurns - Math.round(quarterTurns)) < tolerance;

          expect(isAligned).toBe(true);
        }
      }
    });

    it("should generate roads aligned to cardinal directions", () => {
      const gen = new TownGenerator({
        seed: 12345,
        config: { townCount: 5 },
      });
      const result = gen.generate();

      const tolerance = 0.01;

      for (const town of result.towns) {
        const roads = town.internalRoads ?? [];

        for (const road of roads) {
          const dx = road.end.x - road.start.x;
          const dz = road.end.z - road.start.z;
          const length = Math.sqrt(dx * dx + dz * dz);
          if (length < 1) continue;

          // Normalized direction
          const dirX = dx / length;
          const dirZ = dz / length;

          // Road should be aligned to one of: N-S (0,±1), E-W (±1,0), or 45° diagonals
          // For NESW alignment, roads should be cardinal: (0,±1) or (±1,0)
          const isNorthSouth =
            Math.abs(dirX) < tolerance &&
            Math.abs(Math.abs(dirZ) - 1) < tolerance;
          const isEastWest =
            Math.abs(dirZ) < tolerance &&
            Math.abs(Math.abs(dirX) - 1) < tolerance;

          // At minimum, roads should be reasonably aligned (within 45°)
          // Perfect cardinal alignment means one component is 0
          const isCardinal = isNorthSouth || isEastWest;

          expect(isCardinal).toBe(true);
        }
      }
    });
  });
});
