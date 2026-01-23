/**
 * Terrain Island Mask E2E Test
 *
 * Verifies that the optional island mask pushes terrain below water
 * outside the configured max world size.
 *
 * Prerequisites: Server must be running on localhost:5555
 * (Playwright webServer does this automatically).
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SERVER_URL =
  process.env.PUBLIC_API_URL ||
  process.env.SERVER_URL ||
  "http://localhost:5555";
const LOG_DIR = path.resolve(
  process.env.HOME || "/Users/home",
  "logs/procedural-world-stats",
);

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function saveTestLog(testName: string, content: string) {
  const logFile = path.join(LOG_DIR, `${testName}.log`);
  fs.writeFileSync(logFile, content);
  console.log(`[${testName}] Logs saved to: ${logFile}`);
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type TerrainInfo = {
  height: number;
  biome: string;
  walkable: boolean;
  slope: number;
  underwater: boolean;
};

type TerrainStats = {
  chunkSize: number;
  tilesLoaded: number;
  biomeCount: number;
  activeBiomes: string[];
  totalRoads: number;
  worldBounds: {
    min: { x: number; z: number };
    max: { x: number; z: number };
  };
};

type TerrainSystemHandle = {
  getTerrainInfoAt: (x: number, z: number) => TerrainInfo;
  getTerrainStats: () => TerrainStats;
};

type ShoreSample = {
  x: number;
  z: number;
  height: number;
  underwater: boolean;
};

type ShorelineEdgeResult = {
  found: boolean;
  step: number;
  start: {
    water: ShoreSample;
    land: ShoreSample;
    landRise: number;
    waterDepth: number;
  };
  end: {
    water: ShoreSample;
    land: ShoreSample;
    landRise: number;
    waterDepth: number;
  };
};

type TownSize = "hamlet" | "village" | "town";
type TownBuildingType =
  | "bank"
  | "store"
  | "furnace"
  | "anvil"
  | "well"
  | "house";

type Position3D = {
  x: number;
  y: number;
  z: number;
};

type TownBuilding = {
  id: string;
  type: TownBuildingType;
  position: Position3D;
  rotation: number;
  size: { width: number; depth: number };
};

type ProceduralTown = {
  id: string;
  name: string;
  position: Position3D;
  size: TownSize;
  safeZoneRadius: number;
  biome: string;
  buildings: TownBuilding[];
  suitabilityScore: number;
  connectedRoads: string[];
};

type RoadPathPoint = {
  x: number;
  y: number;
  z: number;
};

type ProceduralRoad = {
  id: string;
  fromTownId: string;
  toTownId: string;
  path: RoadPathPoint[];
  width: number;
  material: string;
  length: number;
};

type TownSystemHandle = {
  getTowns: () => ProceduralTown[];
};

type RoadSystemHandle = {
  getRoads: () => ProceduralRoad[];
};

type MobSpawnStats = {
  totalMobs: number;
  level1Mobs: number;
  level2Mobs: number;
  level3Mobs: number;
  byType: Record<string, number>;
  spawnedMobs: number;
};

type MobSpawnerHandle = {
  getMobStats: () => MobSpawnStats;
};

type EntitySummary = {
  id: string;
  type: string;
  name: string;
};

type EntitiesHandle = {
  getAll: () => EntitySummary[];
};

type WorldHandle = {
  getSystem: (
    name: string,
  ) =>
    | TerrainSystemHandle
    | TownSystemHandle
    | RoadSystemHandle
    | MobSpawnerHandle;
  entities: EntitiesHandle;
};

type TerrainWindow = Window & {
  world?: WorldHandle;
};

type MinimapDebugWindow = Window & {
  __HYPERSCAPE_MINIMAP_SET_EXTENT__?: (value: number) => void;
  __HYPERSCAPE_MINIMAP_SET_TARGET__?: (value: { x: number; z: number }) => void;
};

type ProceduralWorldStats = {
  terrain: TerrainStats;
  biomeSamples: {
    totalSamples: number;
    counts: Record<string, number>;
  };
  towns: {
    total: number;
    bySize: Record<TownSize, number>;
    byBiome: Record<string, number>;
    buildingsByType: Record<TownBuildingType, number>;
    missingEssentialBuildings: string[];
    withoutRoadConnections: string[];
  };
  roads: {
    total: number;
    connected: boolean;
    unreachableTowns: string[];
    averageLength: number;
  };
  mobs: MobSpawnStats;
  entitiesByType: Record<string, number>;
};

type RoadValidationStats = {
  totalRoads: number;
  totalPathPoints: number;
  underwaterPathPoints: number;
  roadsWithUnderwater: string[];
  roadsWithShortPaths: string[];
  roadsWithMissingTowns: string[];
};

function saveJsonLog(testName: string, data: ProceduralWorldStats) {
  const logFile = path.join(LOG_DIR, `${testName}.json`);
  fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
  console.log(`[${testName}] JSON saved to: ${logFile}`);
}

test("terrain island mask makes edges underwater", async ({ page }) => {
  await page.goto(SERVER_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world;
    if (!world) return false;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle;
    return Boolean(terrain.getTerrainInfoAt && terrain.getTerrainStats);
  });

  const maxWorldSizeTiles =
    parseOptionalNumber(
      process.env.PUBLIC_TERRAIN_ISLAND_MAX_WORLD_SIZE_TILES,
    ) ?? 100;

  const sample = await page.evaluate<
    {
      center: TerrainInfo;
      outside: TerrainInfo;
      tileSize: number;
    },
    number
  >((maxTiles) => {
    const terrainWindow = window as TerrainWindow;
    const terrain = terrainWindow.world!.getSystem(
      "terrain",
    ) as TerrainSystemHandle;
    const tileSize = terrain.getTerrainStats().chunkSize;
    const radiusMeters = (maxTiles * tileSize) / 2;
    const outsideX = radiusMeters + tileSize * 2;

    return {
      center: terrain.getTerrainInfoAt(0, 0),
      outside: terrain.getTerrainInfoAt(outsideX, 0),
      tileSize,
    };
  }, maxWorldSizeTiles);

  expect(sample.center.underwater).toBe(false);
  expect(sample.outside.underwater).toBe(true);
  expect(sample.outside.walkable).toBe(false);

  const screenshot = await page.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(0);
});

test("shoreline edges have water and slope definition", async ({ page }) => {
  await page.goto(SERVER_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world;
    if (!world) return false;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle;
    return Boolean(terrain.getTerrainInfoAt && terrain.getTerrainStats);
  });

  const result = await page.evaluate<ShorelineEdgeResult>(() => {
    const terrainWindow = window as TerrainWindow;
    const terrain = terrainWindow.world!.getSystem(
      "terrain",
    ) as TerrainSystemHandle;
    const tileSize = terrain.getTerrainStats().chunkSize;

    const step = 1;
    const scanRange = tileSize * 6;
    const zOffsets = [
      0,
      tileSize * 1.5,
      -tileSize * 1.5,
      tileSize * 3,
      -tileSize * 3,
    ];

    for (const z of zOffsets) {
      const samples: ShoreSample[] = [];
      for (let x = -scanRange; x <= scanRange; x += step) {
        const info = terrain.getTerrainInfoAt(x, z);
        samples.push({
          x,
          z,
          height: info.height,
          underwater: info.underwater,
        });
      }

      let segmentStart = -1;
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        if (sample.underwater && segmentStart < 0) {
          segmentStart = i;
        }
        if (
          (!sample.underwater || i === samples.length - 1) &&
          segmentStart >= 0
        ) {
          const segmentEnd =
            sample.underwater && i === samples.length - 1 ? i : i - 1;

          const hasLandBefore = segmentStart > 0;
          const hasLandAfter = segmentEnd < samples.length - 1;
          const hasInterior = segmentEnd - segmentStart >= 1;

          if (hasLandBefore && hasLandAfter && hasInterior) {
            const waterStart = samples[segmentStart];
            const waterEnd = samples[segmentEnd];
            const landBefore = samples[segmentStart - 1];
            const landAfter = samples[segmentEnd + 1];
            const innerStart = samples[segmentStart + 1];
            const innerEnd = samples[segmentEnd - 1];

            return {
              found: true,
              step,
              start: {
                water: waterStart,
                land: landBefore,
                landRise: landBefore.height - waterStart.height,
                waterDepth: waterStart.height - innerStart.height,
              },
              end: {
                water: waterEnd,
                land: landAfter,
                landRise: landAfter.height - waterEnd.height,
                waterDepth: waterEnd.height - innerEnd.height,
              },
            };
          }

          segmentStart = -1;
        }
      }
    }

    return {
      found: false,
      step: 0,
      start: {
        water: { x: 0, z: 0, height: 0, underwater: false },
        land: { x: 0, z: 0, height: 0, underwater: false },
        landRise: 0,
        waterDepth: 0,
      },
      end: {
        water: { x: 0, z: 0, height: 0, underwater: false },
        land: { x: 0, z: 0, height: 0, underwater: false },
        landRise: 0,
        waterDepth: 0,
      },
    };
  });

  expect(result.found).toBe(true);
  expect(result.start.water.underwater).toBe(true);
  expect(result.end.water.underwater).toBe(true);
  expect(result.start.land.underwater).toBe(false);
  expect(result.end.land.underwater).toBe(false);

  const minRise = 0.03;
  expect(result.start.landRise).toBeGreaterThan(minRise);
  expect(result.end.landRise).toBeGreaterThan(minRise);
  expect(result.start.waterDepth).toBeGreaterThan(minRise);
  expect(result.end.waterDepth).toBeGreaterThan(minRise);
});

test("procedural world stats snapshot", async ({ page }) => {
  await page.goto(SERVER_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world;
    if (!world) return false;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle | null;
    const towns = world.getSystem("towns") as TownSystemHandle | null;
    const roads = world.getSystem("roads") as RoadSystemHandle | null;
    const mobs = world.getSystem("mob-npc-spawner") as MobSpawnerHandle | null;
    if (!terrain || !towns || !roads || !mobs) return false;
    const stats = terrain.getTerrainStats();
    return Boolean(
      stats.tilesLoaded > 0 &&
        towns.getTowns().length > 0 &&
        roads.getRoads().length > 0 &&
        mobs.getMobStats().totalMobs >= 0,
    );
  });

  const stats = await page.evaluate<ProceduralWorldStats>(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world!;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle;
    const townsSystem = world.getSystem("towns") as TownSystemHandle;
    const roadsSystem = world.getSystem("roads") as RoadSystemHandle;
    const mobSpawner = world.getSystem("mob-npc-spawner") as MobSpawnerHandle;

    const terrainStats = terrain.getTerrainStats();
    const towns = townsSystem.getTowns();
    const roads = roadsSystem.getRoads();
    const mobStats = mobSpawner.getMobStats();

    const townsBySize: Record<TownSize, number> = {
      hamlet: 0,
      village: 0,
      town: 0,
    };
    const townsByBiome: Record<string, number> = {};
    const buildingsByType: Record<TownBuildingType, number> = {
      bank: 0,
      store: 0,
      furnace: 0,
      anvil: 0,
      well: 0,
      house: 0,
    };
    const missingEssentialBuildings: string[] = [];
    const townsWithoutRoads: string[] = [];
    const essentialTypes: TownBuildingType[] = [
      "bank",
      "store",
      "furnace",
      "anvil",
    ];

    for (const town of towns) {
      townsBySize[town.size] += 1;
      townsByBiome[town.biome] = (townsByBiome[town.biome] || 0) + 1;
      if (town.connectedRoads.length === 0) {
        townsWithoutRoads.push(town.id);
      }

      const typeSet = new Set<TownBuildingType>();
      for (const building of town.buildings) {
        buildingsByType[building.type] += 1;
        typeSet.add(building.type);
      }

      const missing = essentialTypes.filter((type) => !typeSet.has(type));
      if (missing.length > 0) {
        missingEssentialBuildings.push(`${town.id}:${missing.join(",")}`);
      }
    }

    const adjacency: Record<string, string[]> = {};
    for (const town of towns) {
      adjacency[town.id] = [];
    }
    for (const road of roads) {
      adjacency[road.fromTownId].push(road.toTownId);
      adjacency[road.toTownId].push(road.fromTownId);
    }

    const visited: Record<string, boolean> = {};
    const queue: string[] = [];
    if (towns.length > 0) {
      queue.push(towns[0].id);
      visited[towns[0].id] = true;
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency[current] || [];
      for (const neighbor of neighbors) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          queue.push(neighbor);
        }
      }
    }

    const unreachableTowns = towns
      .filter((town) => !visited[town.id])
      .map((town) => town.id);
    const connected = unreachableTowns.length === 0;

    let totalRoadLength = 0;
    for (const road of roads) {
      totalRoadLength += road.length;
    }
    const averageRoadLength =
      roads.length > 0 ? totalRoadLength / roads.length : 0;

    const biomeCounts: Record<string, number> = {};
    const bounds = terrainStats.worldBounds;
    const tileSize = terrainStats.chunkSize;
    const tilesX = Math.floor((bounds.max.x - bounds.min.x) / tileSize);
    const tilesZ = Math.floor((bounds.max.z - bounds.min.z) / tileSize);
    let sampleCount = 0;

    for (let tx = 0; tx < tilesX; tx++) {
      const x = bounds.min.x + (tx + 0.5) * tileSize;
      for (let tz = 0; tz < tilesZ; tz++) {
        const z = bounds.min.z + (tz + 0.5) * tileSize;
        const info = terrain.getTerrainInfoAt(x, z);
        biomeCounts[info.biome] = (biomeCounts[info.biome] || 0) + 1;
        sampleCount += 1;
      }
    }

    const entities = world.entities.getAll();
    const entitiesByType: Record<string, number> = {};
    for (const entity of entities) {
      entitiesByType[entity.type] = (entitiesByType[entity.type] || 0) + 1;
    }

    return {
      terrain: terrainStats,
      biomeSamples: {
        totalSamples: sampleCount,
        counts: biomeCounts,
      },
      towns: {
        total: towns.length,
        bySize: townsBySize,
        byBiome: townsByBiome,
        buildingsByType: buildingsByType,
        missingEssentialBuildings,
        withoutRoadConnections: townsWithoutRoads,
      },
      roads: {
        total: roads.length,
        connected,
        unreachableTowns,
        averageLength: averageRoadLength,
      },
      mobs: mobStats,
      entitiesByType,
    };
  });

  const fullWorldExtent =
    Math.max(
      stats.terrain.worldBounds.max.x - stats.terrain.worldBounds.min.x,
      stats.terrain.worldBounds.max.z - stats.terrain.worldBounds.min.z,
    ) / 2;

  await page.evaluate((extent) => {
    const debugWindow = window as MinimapDebugWindow;
    debugWindow.__HYPERSCAPE_MINIMAP_SET_TARGET__?.({ x: 0, z: 0 });
    debugWindow.__HYPERSCAPE_MINIMAP_SET_EXTENT__?.(extent);
  }, fullWorldExtent);

  await page.waitForSelector(".minimap canvas");
  await page.waitForTimeout(1500);
  const minimapShot = await page.locator(".minimap").screenshot();
  const minimapPath = path.join(LOG_DIR, "procedural-world-minimap.png");
  fs.writeFileSync(minimapPath, minimapShot);

  const logLines = [
    `[procedural-world-stats] tilesLoaded=${stats.terrain.tilesLoaded}`,
    `[procedural-world-stats] biomeCount=${stats.terrain.biomeCount}`,
    `[procedural-world-stats] activeBiomes=${stats.terrain.activeBiomes.join(",")}`,
    `[procedural-world-stats] towns=${stats.towns.total}`,
    `[procedural-world-stats] townsBySize=${JSON.stringify(stats.towns.bySize)}`,
    `[procedural-world-stats] townsByBiome=${JSON.stringify(stats.towns.byBiome)}`,
    `[procedural-world-stats] buildingsByType=${JSON.stringify(
      stats.towns.buildingsByType,
    )}`,
    `[procedural-world-stats] missingEssentialBuildings=${stats.towns.missingEssentialBuildings.join(
      ";",
    )}`,
    `[procedural-world-stats] roads=${stats.roads.total}`,
    `[procedural-world-stats] roadsConnected=${stats.roads.connected}`,
    `[procedural-world-stats] unreachableTowns=${stats.roads.unreachableTowns.join(",")}`,
    `[procedural-world-stats] averageRoadLength=${stats.roads.averageLength.toFixed(2)}`,
    `[procedural-world-stats] biomeSamples=${stats.biomeSamples.totalSamples}`,
    `[procedural-world-stats] biomeSampleCounts=${JSON.stringify(
      stats.biomeSamples.counts,
    )}`,
    `[procedural-world-stats] mobs=${stats.mobs.totalMobs}`,
    `[procedural-world-stats] mobsByType=${JSON.stringify(stats.mobs.byType)}`,
    `[procedural-world-stats] entitiesByType=${JSON.stringify(
      stats.entitiesByType,
    )}`,
    `[procedural-world-stats] minimapScreenshot=${minimapPath}`,
  ];

  saveTestLog("procedural-world-stats", logLines.join("\n"));
  saveJsonLog("procedural-world-stats", stats);

  expect(stats.terrain.tilesLoaded).toBeGreaterThan(0);
  expect(stats.terrain.activeBiomes.length).toBeGreaterThan(0);
  expect(stats.towns.total).toBeGreaterThan(0);
  expect(stats.roads.total).toBeGreaterThan(0);
  expect(stats.roads.connected).toBe(true);
  expect(stats.biomeSamples.totalSamples).toBeGreaterThan(0);
});

test("road network avoids water and has no A* fallback warnings", async ({
  page,
}) => {
  const fallbackWarnings: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[RoadNetworkSystem] A* fallback")) {
      fallbackWarnings.push(text);
    }
  });

  await page.goto(SERVER_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world;
    if (!world) return false;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle | null;
    const towns = world.getSystem("towns") as TownSystemHandle | null;
    const roads = world.getSystem("roads") as RoadSystemHandle | null;
    return Boolean(
      terrain &&
        towns &&
        roads &&
        towns.getTowns().length > 0 &&
        roads.getRoads().length > 0,
    );
  });

  const validation = await page.evaluate<RoadValidationStats>(() => {
    const terrainWindow = window as TerrainWindow;
    const world = terrainWindow.world!;
    const terrain = world.getSystem("terrain") as TerrainSystemHandle;
    const townsSystem = world.getSystem("towns") as TownSystemHandle;
    const roadsSystem = world.getSystem("roads") as RoadSystemHandle;

    const towns = townsSystem.getTowns();
    const roads = roadsSystem.getRoads();
    const townIds = new Set(towns.map((town) => town.id));

    const roadsWithMissingTowns: string[] = [];
    const roadsWithShortPaths: string[] = [];
    const roadsWithUnderwater: string[] = [];
    let totalPathPoints = 0;
    let underwaterPathPoints = 0;

    for (const road of roads) {
      if (!townIds.has(road.fromTownId) || !townIds.has(road.toTownId)) {
        roadsWithMissingTowns.push(road.id);
      }

      if (road.path.length < 2) {
        roadsWithShortPaths.push(road.id);
      }

      let roadHasUnderwater = false;
      for (const point of road.path) {
        const info = terrain.getTerrainInfoAt(point.x, point.z);
        totalPathPoints += 1;
        if (info.underwater) {
          underwaterPathPoints += 1;
          roadHasUnderwater = true;
        }
      }

      if (roadHasUnderwater) {
        roadsWithUnderwater.push(road.id);
      }
    }

    return {
      totalRoads: roads.length,
      totalPathPoints,
      underwaterPathPoints,
      roadsWithUnderwater,
      roadsWithShortPaths,
      roadsWithMissingTowns,
    };
  });

  const logLines = [
    `[road-network-validation] totalRoads=${validation.totalRoads}`,
    `[road-network-validation] totalPathPoints=${validation.totalPathPoints}`,
    `[road-network-validation] underwaterPathPoints=${validation.underwaterPathPoints}`,
    `[road-network-validation] roadsWithUnderwater=${validation.roadsWithUnderwater.join(",")}`,
    `[road-network-validation] roadsWithShortPaths=${validation.roadsWithShortPaths.join(",")}`,
    `[road-network-validation] roadsWithMissingTowns=${validation.roadsWithMissingTowns.join(",")}`,
    `[road-network-validation] fallbackWarnings=${fallbackWarnings.length}`,
  ];

  saveTestLog("road-network-validation", logLines.join("\n"));

  expect(validation.totalRoads).toBeGreaterThan(0);
  expect(validation.roadsWithMissingTowns.length).toBe(0);
  expect(validation.roadsWithShortPaths.length).toBe(0);
  expect(validation.underwaterPathPoints).toBe(0);
  expect(validation.roadsWithUnderwater.length).toBe(0);
  expect(fallbackWarnings.length).toBe(0);
});
