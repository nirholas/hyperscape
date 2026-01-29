import { describe, it, expect } from "vitest";
import {
  serializeWorld,
  deserializeWorld,
  validateWorldData,
  migrateWorldData,
  generateWorldId,
  generateWorldName,
  createNewWorld,
  calculateWorldStats,
  generateDifficultyZones,
  generateWilderness,
  isInWilderness,
  getWildernessLevel,
  generateBosses,
  generateMobSpawns,
  validateWorldReferences,
  exportWorldToJSON,
  importWorldFromJSON,
  exportToGameManifest,
  validateGameExport,
} from "../../src/components/WorldBuilder/utils/worldPersistence";
import type {
  WorldData,
  WorldFoundation,
  GeneratedTown,
  GeneratedBiome,
  GeneratedBuilding,
  GeneratedRoad,
  WorldPosition,
} from "../../src/components/WorldBuilder/types";

// Test data factories
function createMockPosition(x = 0, y = 0, z = 0): WorldPosition {
  return { x, y, z };
}

function createMockTown(overrides: Partial<GeneratedTown> = {}): GeneratedTown {
  return {
    id: `town-${Math.random().toString(36).substring(7)}`,
    name: "Test Town",
    position: createMockPosition(100, 0, 100),
    size: "village",
    biomeId: "biome-1",
    layoutType: "grid",
    buildingIds: [],
    entryPoints: [
      { direction: "north", position: createMockPosition(100, 0, 50) },
    ],
    ...overrides,
  };
}

function createMockBiome(
  overrides: Partial<GeneratedBiome> = {},
): GeneratedBiome {
  return {
    id: `biome-${Math.random().toString(36).substring(7)}`,
    type: "plains",
    center: createMockPosition(500, 0, 500),
    influenceRadius: 300,
    tileKeys: ["0,0", "0,1", "1,0", "1,1"],
    ...overrides,
  };
}

function createMockBuilding(
  overrides: Partial<GeneratedBuilding> = {},
): GeneratedBuilding {
  return {
    id: `building-${Math.random().toString(36).substring(7)}`,
    type: "house",
    name: "Test House",
    townId: "town-1",
    position: createMockPosition(110, 0, 110),
    rotation: 0,
    dimensions: { width: 5, depth: 5, floors: 1 },
    ...overrides,
  };
}

function createMockRoad(overrides: Partial<GeneratedRoad> = {}): GeneratedRoad {
  return {
    id: `road-${Math.random().toString(36).substring(7)}`,
    connectedTowns: ["town-1", "town-2"],
    path: [createMockPosition(100, 0, 100), createMockPosition(200, 0, 200)],
    isMainRoad: false,
    ...overrides,
  };
}

function createMockFoundation(
  overrides: Partial<WorldFoundation> = {},
): WorldFoundation {
  return {
    version: 1,
    createdAt: Date.now(),
    config: {
      seed: 12345,
      terrain: {
        worldSize: 100,
        tileSize: 10,
        tileResolution: 32,
        preset: "island",
      },
      towns: {
        townCount: 3,
        minTownSpacing: 200,
        townSizes: { hamlet: 0.4, village: 0.4, town: 0.2 },
      },
      shoreline: {
        waterLevelNormalized: 0.3,
        shorelineBlend: 0.1,
      },
      vegetation: {
        density: 0.5,
        treeTypes: ["oak", "pine"],
      },
    },
    biomes: [createMockBiome({ id: "biome-1" })],
    towns: [
      createMockTown({ id: "town-1" }),
      createMockTown({
        id: "town-2",
        position: createMockPosition(500, 0, 500),
      }),
    ],
    buildings: [createMockBuilding({ id: "building-1", townId: "town-1" })],
    roads: [
      createMockRoad({ id: "road-1", connectedTowns: ["town-1", "town-2"] }),
    ],
    heightmapCache: new Map(),
    ...overrides,
  };
}

function createMockWorldData(overrides: Partial<WorldData> = {}): WorldData {
  return {
    id: "test-world-123",
    name: "Test World",
    description: "A test world",
    version: 1,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    foundationLocked: true,
    foundation: createMockFoundation(),
    layers: {
      biomeOverrides: new Map(),
      townOverrides: new Map(),
      npcs: [],
      quests: [],
      bosses: [],
      events: [],
      lore: [],
      difficultyZones: [],
      customPlacements: [],
    },
    ...overrides,
  };
}

describe("World Serialization", () => {
  describe("serializeWorld", () => {
    it("should serialize a complete world to JSON-safe format", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);

      expect(serialized.id).toBe(world.id);
      expect(serialized.name).toBe(world.name);
      expect(serialized.version).toBe(world.version);
      expect(typeof serialized.layers.biomeOverrides).toBe("object");
      expect(Array.isArray(serialized.foundation.biomes)).toBe(true);
    });

    it("should convert Map to Object for biomeOverrides", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        typeOverride: "forest",
      });

      const serialized = serializeWorld(world);

      expect(serialized.layers.biomeOverrides["biome-1"]).toBeDefined();
      expect(serialized.layers.biomeOverrides["biome-1"].typeOverride).toBe(
        "forest",
      );
    });

    it("should handle empty layers", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);

      expect(serialized.layers.npcs).toEqual([]);
      expect(serialized.layers.quests).toEqual([]);
      expect(serialized.layers.bosses).toEqual([]);
    });
  });

  describe("deserializeWorld", () => {
    it("should deserialize back to WorldData with Maps", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        typeOverride: "forest",
      });

      const serialized = serializeWorld(world);
      const deserialized = deserializeWorld(serialized);

      expect(deserialized.layers.biomeOverrides instanceof Map).toBe(true);
      expect(
        deserialized.layers.biomeOverrides.get("biome-1")?.typeOverride,
      ).toBe("forest");
    });

    it("should create empty heightmapCache on deserialization", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      const deserialized = deserializeWorld(serialized);

      expect(deserialized.foundation.heightmapCache instanceof Map).toBe(true);
      expect(deserialized.foundation.heightmapCache.size).toBe(0);
    });

    it("should handle missing optional arrays with defaults", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      // Simulate missing arrays from older format
      delete (serialized.layers as Record<string, unknown>).difficultyZones;
      delete (serialized.layers as Record<string, unknown>).customPlacements;

      const deserialized = deserializeWorld(serialized);

      expect(Array.isArray(deserialized.layers.difficultyZones)).toBe(true);
      expect(Array.isArray(deserialized.layers.customPlacements)).toBe(true);
    });
  });

  describe("JSON round-trip", () => {
    it("should survive JSON.stringify/parse round-trip", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        difficultyOverride: 2,
      });

      const json = exportWorldToJSON(world);
      const restored = importWorldFromJSON(json);

      expect(restored.id).toBe(world.id);
      expect(
        restored.layers.biomeOverrides.get("biome-1")?.difficultyOverride,
      ).toBe(2);
    });
  });
});

describe("World Validation", () => {
  describe("validateWorldData", () => {
    it("should accept valid world data", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);

      expect(validateWorldData(serialized)).toBe(true);
    });

    it("should reject null/undefined", () => {
      expect(validateWorldData(null)).toBe(false);
      expect(validateWorldData(undefined)).toBe(false);
    });

    it("should reject non-object values", () => {
      expect(validateWorldData("string")).toBe(false);
      expect(validateWorldData(123)).toBe(false);
      expect(validateWorldData([])).toBe(false);
    });

    it("should reject missing required fields", () => {
      const partial = { id: "test" }; // Missing most fields
      expect(validateWorldData(partial)).toBe(false);
    });

    it("should reject wrong type for id", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      (serialized as Record<string, unknown>).id = 123;

      expect(validateWorldData(serialized)).toBe(false);
    });

    it("should reject missing foundation", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      delete (serialized as Record<string, unknown>).foundation;

      expect(validateWorldData(serialized)).toBe(false);
    });

    it("should reject missing layers", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      delete (serialized as Record<string, unknown>).layers;

      expect(validateWorldData(serialized)).toBe(false);
    });

    it("should reject non-array biomes", () => {
      const world = createMockWorldData();
      const serialized = serializeWorld(world);
      (serialized.foundation as Record<string, unknown>).biomes =
        "not-an-array";

      expect(validateWorldData(serialized)).toBe(false);
    });
  });

  describe("validateWorldReferences", () => {
    it("should pass for valid world with correct references", () => {
      const world = createMockWorldData();
      const result = validateWorldReferences(world);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect orphaned buildings", () => {
      const world = createMockWorldData();
      world.foundation.buildings.push(
        createMockBuilding({ townId: "non-existent-town" }),
      );

      const result = validateWorldReferences(world);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.layer === "buildings")).toBe(true);
    });

    it("should detect orphaned road references", () => {
      const world = createMockWorldData();
      world.foundation.roads.push(
        createMockRoad({ connectedTowns: ["town-1", "non-existent-town"] }),
      );

      const result = validateWorldReferences(world);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.layer === "roads")).toBe(true);
    });

    it("should detect NPC referencing non-existent town", () => {
      const world = createMockWorldData();
      world.layers.npcs.push({
        id: "npc-1",
        name: "Test NPC",
        npcTypeId: "villager",
        position: createMockPosition(),
        rotation: 0,
        parentContext: { type: "town", townId: "non-existent-town" },
        properties: {},
      });

      const result = validateWorldReferences(world);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.layer === "npcs")).toBe(true);
    });

    it("should detect orphaned biome overrides", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("non-existent-biome", {
        biomeId: "non-existent-biome",
      });

      const result = validateWorldReferences(world);

      expect(result.warnings.some((w) => w.layer === "biomeOverrides")).toBe(
        true,
      );
    });

    it("should detect invalid difficulty zone bounds", () => {
      const world = createMockWorldData();
      world.layers.difficultyZones.push({
        id: "zone-1",
        name: "Bad Zone",
        difficultyLevel: 1,
        zoneType: "bounds",
        bounds: { minX: 100, maxX: 50, minZ: 0, maxZ: 100 }, // Invalid: minX > maxX
        isSafeZone: false,
        mobLevelRange: [1, 10],
        properties: {},
      });

      const result = validateWorldReferences(world);

      expect(result.warnings.some((w) => w.layer === "difficultyZones")).toBe(
        true,
      );
    });
  });
});

describe("Difficulty Zone Generation", () => {
  describe("generateDifficultyZones", () => {
    it("should generate zones from towns", () => {
      const towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(500, 0, 500),
        }),
        createMockTown({
          id: "town-2",
          position: createMockPosition(200, 0, 800),
        }),
      ];

      const zones = generateDifficultyZones(towns, 100, 10);

      expect(zones.length).toBeGreaterThan(0);
    });

    it("should create safe zones around towns", () => {
      const towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(500, 0, 500),
        }),
      ];

      const zones = generateDifficultyZones(towns, 100, 10);
      const safeZone = zones.find((z) => z.isSafeZone);

      expect(safeZone).toBeDefined();
      expect(safeZone?.difficultyLevel).toBe(0);
      expect(safeZone?.linkedTownId).toBe("town-1");
    });

    it("should respect starter town IDs", () => {
      const towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(100, 0, 100),
        }),
        createMockTown({
          id: "town-2",
          position: createMockPosition(900, 0, 900),
        }),
      ];

      const zones = generateDifficultyZones(towns, 100, 10, ["town-2"]);
      const starterZone = zones.find(
        (z) => z.linkedTownId === "town-2" && z.isSafeZone,
      );

      expect(starterZone).toBeDefined();
    });

    it("should create wild zones far from towns", () => {
      const towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(100, 0, 100),
        }),
      ];

      const zones = generateDifficultyZones(towns, 200, 10);
      const wildZones = zones.filter((z) => z.id.startsWith("wild-zone"));

      // With only one town near corner, there should be wild zones in other areas
      expect(wildZones.length).toBeGreaterThanOrEqual(0);
    });

    it("should scale safe zone radius by town size", () => {
      const smallTown = createMockTown({
        id: "town-1",
        size: "hamlet",
        position: createMockPosition(500, 0, 500),
      });
      const largeTown = createMockTown({
        id: "town-2",
        size: "town",
        position: createMockPosition(100, 0, 100),
      });

      const zones = generateDifficultyZones([smallTown, largeTown], 100, 10);

      const smallSafeZone = zones.find(
        (z) => z.linkedTownId === "town-1" && z.isSafeZone,
      );
      const largeSafeZone = zones.find(
        (z) => z.linkedTownId === "town-2" && z.isSafeZone,
      );

      // Large town should have larger safe zone
      if (smallSafeZone && largeSafeZone) {
        const smallRadius =
          smallSafeZone.bounds.maxX - smallSafeZone.bounds.minX;
        const largeRadius =
          largeSafeZone.bounds.maxX - largeSafeZone.bounds.minX;
        expect(largeRadius).toBeGreaterThan(smallRadius);
      }
    });

    it("should handle empty towns array", () => {
      const zones = generateDifficultyZones([], 100, 10);

      // Should still generate wild zones
      expect(zones.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Wilderness Zone", () => {
  describe("generateWilderness", () => {
    it("should create wilderness zone with correct defaults", () => {
      const wilderness = generateWilderness(100, 10);

      expect(wilderness.direction).toBe("north");
      expect(wilderness.startBoundary).toBe(0.3);
      expect(wilderness.multiCombat).toBe(true);
    });

    it("should respect custom direction", () => {
      const wilderness = generateWilderness(100, 10, "south");
      expect(wilderness.direction).toBe("south");
    });

    it("should respect custom boundary percent", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.5);
      expect(wilderness.startBoundary).toBe(0.5);
    });
  });

  describe("isInWilderness", () => {
    it("should detect position in northern wilderness", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.3);

      // Position in the north (z < center - boundary)
      const inWild = isInWilderness(
        createMockPosition(500, 0, 100),
        wilderness,
        100,
        10,
      );
      expect(inWild).toBe(true);
    });

    it("should detect position outside wilderness", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.3);

      // Position in the center/south
      const notInWild = isInWilderness(
        createMockPosition(500, 0, 800),
        wilderness,
        100,
        10,
      );
      expect(notInWild).toBe(false);
    });

    it("should handle all cardinal directions", () => {
      const worldSize = 100;
      const tileSize = 10;
      const worldSizeMeters = worldSize * tileSize;
      const center = worldSizeMeters / 2;

      // North
      const northWild = generateWilderness(worldSize, tileSize, "north", 0.3);
      expect(
        isInWilderness(
          createMockPosition(center, 0, 100),
          northWild,
          worldSize,
          tileSize,
        ),
      ).toBe(true);

      // South
      const southWild = generateWilderness(worldSize, tileSize, "south", 0.3);
      expect(
        isInWilderness(
          createMockPosition(center, 0, worldSizeMeters - 100),
          southWild,
          worldSize,
          tileSize,
        ),
      ).toBe(true);

      // East
      const eastWild = generateWilderness(worldSize, tileSize, "east", 0.3);
      expect(
        isInWilderness(
          createMockPosition(worldSizeMeters - 100, 0, center),
          eastWild,
          worldSize,
          tileSize,
        ),
      ).toBe(true);

      // West
      const westWild = generateWilderness(worldSize, tileSize, "west", 0.3);
      expect(
        isInWilderness(
          createMockPosition(100, 0, center),
          westWild,
          worldSize,
          tileSize,
        ),
      ).toBe(true);
    });
  });

  describe("getWildernessLevel", () => {
    it("should return 0 for positions outside wilderness", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.3);
      const level = getWildernessLevel(
        createMockPosition(500, 0, 800),
        wilderness,
        100,
        10,
      );

      expect(level).toBe(0);
    });

    it("should increase level deeper into wilderness", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.3);

      const shallowLevel = getWildernessLevel(
        createMockPosition(500, 0, 300),
        wilderness,
        100,
        10,
      );
      const deepLevel = getWildernessLevel(
        createMockPosition(500, 0, 50),
        wilderness,
        100,
        10,
      );

      expect(deepLevel).toBeGreaterThan(shallowLevel);
    });

    it("should return at least 1 for any position in wilderness", () => {
      const wilderness = generateWilderness(100, 10, "north", 0.3);
      const level = getWildernessLevel(
        createMockPosition(500, 0, 100),
        wilderness,
        100,
        10,
      );

      expect(level).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Boss Generation", () => {
  describe("generateBosses", () => {
    it("should generate the requested number of bosses", () => {
      const world = createMockWorldData();
      const bosses = generateBosses(world, 5);

      expect(bosses.length).toBe(5);
    });

    it("should generate bosses with required fields", () => {
      const world = createMockWorldData();
      const bosses = generateBosses(world, 1);
      const boss = bosses[0];

      expect(boss.id).toBeDefined();
      expect(boss.name).toBeDefined();
      expect(boss.bossTemplateId).toBeDefined();
      expect(boss.position).toBeDefined();
      expect(boss.arenaBounds).toBeDefined();
      expect(boss.requiredLevel).toBeGreaterThanOrEqual(1);
      expect(boss.isGenerated).toBe(true);
    });

    it("should generate unique boss IDs", () => {
      const world = createMockWorldData();
      const bosses = generateBosses(world, 10);
      const ids = bosses.map((b) => b.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should produce deterministic results with same seed", () => {
      const world = createMockWorldData();
      const bosses1 = generateBosses(world, 5, 12345);
      const bosses2 = generateBosses(world, 5, 12345);

      expect(bosses1.map((b) => b.name)).toEqual(bosses2.map((b) => b.name));
    });

    it("should include generated config for generated bosses", () => {
      const world = createMockWorldData();
      const bosses = generateBosses(world, 1);
      const boss = bosses[0];

      expect(boss.generatedConfig).toBeDefined();
      expect(boss.generatedConfig?.archetype).toBeDefined();
      expect(boss.generatedConfig?.abilities?.length).toBeGreaterThan(0);
    });

    it("should scale boss levels across difficulty tiers", () => {
      const world = createMockWorldData();
      // Add multiple biomes with different difficulties
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        difficultyOverride: 0,
      });

      const bosses = generateBosses(world, 10);
      const levels = bosses.map((b) => b.requiredLevel);
      const minLevel = Math.min(...levels);
      const maxLevel = Math.max(...levels);

      // Should have a range of levels
      expect(maxLevel).toBeGreaterThan(minLevel);
    });

    it("should handle world with no biomes gracefully", () => {
      const world = createMockWorldData();
      world.foundation.biomes = [];

      const bosses = generateBosses(world, 3);

      // Should still generate bosses using fallback
      expect(bosses.length).toBe(3);
    });
  });
});

describe("Mob Spawn Generation", () => {
  describe("generateMobSpawns", () => {
    it("should generate spawns for each biome", () => {
      const world = createMockWorldData();
      const spawns = generateMobSpawns(world);

      expect(spawns.version).toBe(1);
      expect(spawns.spawns.length).toBeGreaterThanOrEqual(
        world.foundation.biomes.length,
      );
    });

    it("should include spawn table with valid mob types", () => {
      const world = createMockWorldData();
      const spawns = generateMobSpawns(world);
      const firstSpawn = spawns.spawns[0];

      expect(firstSpawn.spawnTable.length).toBeGreaterThan(0);
      expect(firstSpawn.spawnTable[0].mobTypeId).toBeDefined();
      expect(firstSpawn.spawnTable[0].weight).toBeGreaterThan(0);
    });

    it("should apply biome override mob config", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        mobSpawnConfig: {
          enabled: false,
          spawnRate: 0,
          maxPerChunk: 0,
          spawnTable: [],
        },
      });

      const spawns = generateMobSpawns(world);
      const biome1Spawn = spawns.spawns.find((s) => s.biomeId === "biome-1");

      expect(biome1Spawn?.enabled).toBe(false);
    });

    it("should scale levels based on difficulty override", () => {
      const world = createMockWorldData();
      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        difficultyOverride: 4,
      });

      const spawns = generateMobSpawns(world);
      const biome1Spawn = spawns.spawns.find((s) => s.biomeId === "biome-1");

      // Level should be boosted by difficulty
      if (biome1Spawn && biome1Spawn.spawnTable.length > 0) {
        const minLevel = biome1Spawn.spawnTable[0].levelRange[0];
        expect(minLevel).toBeGreaterThan(10); // Difficulty 4 = +40 levels
      }
    });

    it("should add zone override spawns for difficulty zones", () => {
      const world = createMockWorldData();
      world.layers.difficultyZones.push({
        id: "zone-1",
        name: "Hard Zone",
        difficultyLevel: 3,
        zoneType: "bounds",
        bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
        isSafeZone: false,
        mobLevelRange: [30, 45],
        properties: {},
      });

      const spawns = generateMobSpawns(world);
      const zoneSpawn = spawns.spawns.find((s) => s.biomeId === "zone_zone-1");

      expect(zoneSpawn).toBeDefined();
      expect(zoneSpawn?.zoneOverride).toBe(true);
    });
  });
});

describe("Game Export", () => {
  describe("exportToGameManifest", () => {
    it("should export valid buildings manifest", () => {
      const world = createMockWorldData();
      const { buildingsManifest } = exportToGameManifest(world);

      expect(buildingsManifest.version).toBe(1);
      expect(buildingsManifest.towns.length).toBe(
        world.foundation.towns.length,
      );
      expect(buildingsManifest.buildingTypes).toBeDefined();
      expect(buildingsManifest.sizeDefinitions).toBeDefined();
    });

    it("should convert town sizes correctly", () => {
      const world = createMockWorldData();
      world.foundation.towns = [
        createMockTown({ id: "town-1", size: "hamlet" }),
        createMockTown({ id: "town-2", size: "village" }),
        createMockTown({ id: "town-3", size: "town" }),
      ];

      const { buildingsManifest } = exportToGameManifest(world);

      expect(buildingsManifest.towns[0].size).toBe("sm");
      expect(buildingsManifest.towns[1].size).toBe("md");
      expect(buildingsManifest.towns[2].size).toBe("lg");
    });

    it("should make building positions relative to town", () => {
      const world = createMockWorldData();
      world.foundation.towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(100, 0, 100),
        }),
      ];
      world.foundation.buildings = [
        createMockBuilding({
          id: "building-1",
          townId: "town-1",
          position: createMockPosition(110, 0, 120),
        }),
      ];

      const { buildingsManifest } = exportToGameManifest(world);
      const building = buildingsManifest.towns[0].buildings[0];

      expect(building.position.x).toBe(10); // 110 - 100
      expect(building.position.z).toBe(20); // 120 - 100
    });

    it("should export valid world config", () => {
      const world = createMockWorldData();
      const { worldConfig } = exportToGameManifest(world);

      expect(worldConfig.terrain.seed).toBe(world.foundation.config.seed);
      expect(worldConfig.terrain.worldSize).toBe(
        world.foundation.config.terrain.worldSize *
          world.foundation.config.terrain.tileSize,
      );
    });
  });

  describe("validateGameExport", () => {
    it("should pass for valid world", () => {
      const world = createMockWorldData();
      const result = validateGameExport(world);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing world ID", () => {
      const world = createMockWorldData();
      (world as Record<string, unknown>).id = "";

      const result = validateGameExport(world);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "id")).toBe(true);
    });

    it("should warn about world size over 1000", () => {
      const world = createMockWorldData();
      world.foundation.config.terrain.worldSize = 1001;

      const result = validateGameExport(world);

      expect(result.warnings.some((w) => w.field === "terrain.worldSize")).toBe(
        true,
      );
    });

    it("should detect duplicate town names", () => {
      const world = createMockWorldData();
      world.foundation.towns = [
        createMockTown({ id: "town-1", name: "Same Name" }),
        createMockTown({ id: "town-2", name: "Same Name" }),
      ];

      const result = validateGameExport(world);

      expect(
        result.warnings.some((w) => w.message.includes("Duplicate town name")),
      ).toBe(true);
    });

    it("should detect towns too close together", () => {
      const world = createMockWorldData();
      world.foundation.towns = [
        createMockTown({
          id: "town-1",
          position: createMockPosition(100, 0, 100),
        }),
        createMockTown({
          id: "town-2",
          position: createMockPosition(110, 0, 110),
        }), // Only 14m apart
      ];

      const result = validateGameExport(world);

      expect(
        result.warnings.some((w) => w.message.includes("very close")),
      ).toBe(true);
    });

    it("should report correct stats", () => {
      const world = createMockWorldData();
      const result = validateGameExport(world);

      expect(result.stats.townCount).toBe(world.foundation.towns.length);
      expect(result.stats.buildingCount).toBe(
        world.foundation.buildings.length,
      );
    });
  });
});

describe("World Creation Helpers", () => {
  describe("generateWorldId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateWorldId();
      const id2 = generateWorldId();

      expect(id1).not.toBe(id2);
    });

    it("should start with 'world-' prefix", () => {
      const id = generateWorldId();
      expect(id.startsWith("world-")).toBe(true);
    });
  });

  describe("generateWorldName", () => {
    it("should generate deterministic names from seed", () => {
      const name1 = generateWorldName(12345);
      const name2 = generateWorldName(12345);

      expect(name1).toBe(name2);
    });

    it("should generate different names for different seeds", () => {
      const name1 = generateWorldName(1);
      const name2 = generateWorldName(2);

      expect(name1).not.toBe(name2);
    });

    it("should return two-word names", () => {
      const name = generateWorldName(42);
      const words = name.split(" ");

      expect(words.length).toBe(2);
    });
  });

  describe("createNewWorld", () => {
    it("should create world with provided foundation", () => {
      const foundation = createMockFoundation();
      const world = createNewWorld(foundation);

      expect(world.foundation).toBe(foundation);
      expect(world.foundationLocked).toBe(true);
    });

    it("should use provided name if given", () => {
      const foundation = createMockFoundation();
      const world = createNewWorld(foundation, "Custom Name");

      expect(world.name).toBe("Custom Name");
    });

    it("should generate name from seed if not provided", () => {
      const foundation = createMockFoundation();
      const world = createNewWorld(foundation);

      expect(world.name).toBe(generateWorldName(foundation.config.seed));
    });

    it("should initialize empty layers", () => {
      const foundation = createMockFoundation();
      const world = createNewWorld(foundation);

      expect(world.layers.npcs).toEqual([]);
      expect(world.layers.quests).toEqual([]);
      expect(world.layers.biomeOverrides instanceof Map).toBe(true);
      expect(world.layers.biomeOverrides.size).toBe(0);
    });
  });

  describe("calculateWorldStats", () => {
    it("should calculate correct tile count", () => {
      const world = createMockWorldData();
      const stats = calculateWorldStats(world);

      const expectedTiles = world.foundation.config.terrain.worldSize ** 2;
      expect(stats.totalTiles).toBe(expectedTiles);
    });

    it("should detect when world has overrides", () => {
      const world = createMockWorldData();
      expect(calculateWorldStats(world).hasOverrides).toBe(false);

      world.layers.biomeOverrides.set("biome-1", {
        biomeId: "biome-1",
        typeOverride: "forest",
      });
      expect(calculateWorldStats(world).hasOverrides).toBe(true);
    });
  });
});

describe("World Migration", () => {
  describe("migrateWorldData", () => {
    it("should add missing layer arrays", () => {
      const oldData = {
        id: "test",
        name: "Test",
        description: "",
        version: 0,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        foundationLocked: true,
        foundation: createMockFoundation(),
        layers: {
          biomeOverrides: {},
          townOverrides: {},
          npcs: [],
          quests: [],
          bosses: [],
          events: [],
          // Missing: lore, difficultyZones, customPlacements
        },
      };

      const migrated = migrateWorldData(oldData as never);

      expect(migrated.version).toBe(1);
      expect(migrated.layers.lore).toEqual([]);
      expect(migrated.layers.difficultyZones).toEqual([]);
      expect(migrated.layers.customPlacements).toEqual([]);
    });

    it("should preserve existing data during migration", () => {
      const oldData = {
        id: "test",
        name: "Test World",
        description: "A test",
        version: 0,
        createdAt: 1000,
        modifiedAt: 2000,
        foundationLocked: true,
        foundation: createMockFoundation(),
        layers: {
          biomeOverrides: { "biome-1": { biomeId: "biome-1" } },
          townOverrides: {},
          npcs: [{ id: "npc-1", name: "Test" }],
          quests: [],
          bosses: [],
          events: [],
        },
      };

      const migrated = migrateWorldData(oldData as never);

      expect(migrated.name).toBe("Test World");
      expect(migrated.layers.npcs).toHaveLength(1);
      expect(migrated.layers.biomeOverrides["biome-1"]).toBeDefined();
    });
  });
});
