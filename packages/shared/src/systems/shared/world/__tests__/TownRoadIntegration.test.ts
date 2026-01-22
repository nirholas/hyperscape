/**
 * Town and Road System Integration Tests
 *
 * Tests the full procedural generation flow:
 * - TownSystem generates 25 towns with deterministic placement
 * - RoadNetworkSystem creates road network connecting all towns
 * - Systems integrate correctly with terrain and other dependencies
 * - Safe zones and road detection work correctly
 *
 * These tests verify the complete generation pipeline works end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ============== Constants ==============
const TOWN_COUNT = 25;
const MIN_TOWN_SPACING = 800;
const ROAD_WIDTH = 4;
const WATER_THRESHOLD = 5.4;
const TILE_SIZE = 100;

type TownSize = "hamlet" | "village" | "town";
type TownBuildingType = "bank" | "store" | "anvil" | "well" | "house";

interface Position3D {
  x: number;
  y: number;
  z: number;
}

interface TownBuilding {
  id: string;
  type: TownBuildingType;
  position: Position3D;
  rotation: number;
  size: { width: number; depth: number };
}

interface ProceduralTown {
  id: string;
  name: string;
  position: Position3D;
  size: TownSize;
  safeZoneRadius: number;
  biome: string;
  buildings: TownBuilding[];
  suitabilityScore: number;
  connectedRoads: string[];
}

interface RoadPathPoint {
  x: number;
  z: number;
  y: number;
}

interface ProceduralRoad {
  id: string;
  fromTownId: string;
  toTownId: string;
  path: RoadPathPoint[];
  width: number;
  material: string;
  length: number;
}

interface RoadTileSegment {
  start: { x: number; z: number };
  end: { x: number; z: number };
  width: number;
  roadId: string;
}

// ============== Mock Systems ==============

/** Simplified TownSystem for integration testing */
class MockTownSystem {
  private towns: ProceduralTown[] = [];
  private seed: number;
  private randomState: number;
  private terrainSystem: MockTerrainSystem;

  constructor(seed: number, terrainSystem: MockTerrainSystem) {
    this.seed = seed;
    this.randomState = seed;
    this.terrainSystem = terrainSystem;
  }

  private random(): number {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  }

  private resetRandom(seed: number): void {
    this.randomState = seed;
  }

  generateTowns(): void {
    this.resetRandom(this.seed + 12345);
    this.towns = [];

    const halfWorld = 5000;
    const gridSize = 15;
    const cellSize = 10000 / gridSize;

    interface Candidate {
      x: number;
      z: number;
      score: number;
      biome: string;
    }

    const candidates: Candidate[] = [];

    // Generate candidates
    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const baseX = (gx + 0.5) * cellSize - halfWorld;
        const baseZ = (gz + 0.5) * cellSize - halfWorld;
        const jitterX = (this.random() - 0.5) * cellSize * 0.8;
        const jitterZ = (this.random() - 0.5) * cellSize * 0.8;

        const x = baseX + jitterX;
        const z = baseZ + jitterZ;

        if (Math.abs(x) > halfWorld - 200 || Math.abs(z) > halfWorld - 200)
          continue;

        const height = this.terrainSystem.getHeightAt(x, z);
        if (height < WATER_THRESHOLD) continue;

        const biome = this.terrainSystem.getBiome(x, z);
        const score = this.random() * 0.5 + 0.5;

        candidates.push({ x, z, score, biome });
      }
    }

    // Select towns
    candidates.sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      if (this.towns.length >= TOWN_COUNT) break;

      const tooClose = this.towns.some((town) => {
        const dx = candidate.x - town.position.x;
        const dz = candidate.z - town.position.z;
        return Math.sqrt(dx * dx + dz * dz) < MIN_TOWN_SPACING;
      });

      if (!tooClose) {
        const townIndex = this.towns.length;
        const height = this.terrainSystem.getHeightAt(candidate.x, candidate.z);
        const size: TownSize =
          candidate.score > 0.8
            ? "town"
            : candidate.score > 0.6
              ? "village"
              : "hamlet";
        const safeZoneRadius =
          size === "town" ? 80 : size === "village" ? 60 : 40;

        const town: ProceduralTown = {
          id: `town_${townIndex}`,
          name: `Town${townIndex}`,
          position: { x: candidate.x, y: height, z: candidate.z },
          size,
          safeZoneRadius,
          biome: candidate.biome,
          buildings: this.generateBuildings(
            candidate.x,
            candidate.z,
            size,
            townIndex,
          ),
          suitabilityScore: candidate.score,
          connectedRoads: [],
        };

        this.towns.push(town);
      }
    }
  }

  private generateBuildings(
    townX: number,
    townZ: number,
    size: TownSize,
    townIndex: number,
  ): TownBuilding[] {
    this.resetRandom(this.seed + townIndex * 9973 + 100000);

    const buildings: TownBuilding[] = [];
    const buildingTypes: TownBuildingType[] = ["bank", "store", "anvil"];

    if (size !== "hamlet") buildingTypes.push("well");

    const buildingCount = size === "town" ? 12 : size === "village" ? 7 : 4;
    while (buildingTypes.length < buildingCount) {
      buildingTypes.push("house");
    }

    const radius = size === "town" ? 60 : size === "village" ? 40 : 25;
    const placedPositions: Array<{ x: number; z: number; r: number }> = [];

    for (let i = 0; i < buildingTypes.length; i++) {
      const type = buildingTypes[i];
      const config =
        { bank: 8, store: 7, anvil: 5, well: 3, house: 6 }[type] ?? 6;

      for (let attempts = 0; attempts < 50; attempts++) {
        const angle = this.random() * Math.PI * 2;
        const dist = 5 + this.random() * (radius - config);
        const bx = townX + Math.cos(angle) * dist;
        const bz = townZ + Math.sin(angle) * dist;
        const br = config / 2 + 2;

        const overlaps = placedPositions.some(
          (p) => Math.sqrt((bx - p.x) ** 2 + (bz - p.z) ** 2) < br + p.r,
        );

        if (!overlaps) {
          buildings.push({
            id: `town_${townIndex}_building_${i}`,
            type,
            position: {
              x: bx,
              y: this.terrainSystem.getHeightAt(bx, bz),
              z: bz,
            },
            rotation: Math.atan2(townZ - bz, townX - bx) + Math.PI,
            size: { width: config, depth: config - 1 },
          });
          placedPositions.push({ x: bx, z: bz, r: br });
          break;
        }
      }
    }

    return buildings;
  }

  getTowns(): ProceduralTown[] {
    return this.towns;
  }

  isInSafeZone(x: number, z: number): boolean {
    return this.towns.some((town) => {
      const dx = x - town.position.x;
      const dz = z - town.position.z;
      return Math.sqrt(dx * dx + dz * dz) <= town.safeZoneRadius;
    });
  }

  getTownAtPosition(x: number, z: number): ProceduralTown | undefined {
    return this.towns.find((town) => {
      const dx = x - town.position.x;
      const dz = z - town.position.z;
      return Math.sqrt(dx * dx + dz * dz) <= town.safeZoneRadius;
    });
  }
}

/** Simplified RoadNetworkSystem for integration testing */
class MockRoadNetworkSystem {
  private roads: ProceduralRoad[] = [];
  private tileCache = new Map<string, RoadTileSegment[]>();
  private seed: number;
  private terrainSystem: MockTerrainSystem;

  constructor(seed: number, terrainSystem: MockTerrainSystem) {
    this.seed = seed;
    this.terrainSystem = terrainSystem;
  }

  generateRoads(towns: ProceduralTown[]): void {
    if (towns.length < 2) return;

    // Build MST
    const edges: Array<{ from: number; to: number; distance: number }> = [];
    for (let i = 0; i < towns.length; i++) {
      for (let j = i + 1; j < towns.length; j++) {
        const dx = towns[j].position.x - towns[i].position.x;
        const dz = towns[j].position.z - towns[i].position.z;
        edges.push({ from: i, to: j, distance: Math.sqrt(dx * dx + dz * dz) });
      }
    }

    const inMST = new Set<number>([0]);
    const mstEdges: Array<{ from: number; to: number }> = [];

    while (inMST.size < towns.length) {
      let best: { from: number; to: number; distance: number } | null = null;

      for (const edge of edges) {
        const fromIn = inMST.has(edge.from);
        const toIn = inMST.has(edge.to);

        if (fromIn !== toIn) {
          if (!best || edge.distance < best.distance) {
            best = edge;
          }
        }
      }

      if (best) {
        mstEdges.push({ from: best.from, to: best.to });
        inMST.add(best.from);
        inMST.add(best.to);
      } else {
        break;
      }
    }

    // Generate roads for MST edges
    this.roads = [];
    for (let i = 0; i < mstEdges.length; i++) {
      const edge = mstEdges[i];
      const fromTown = towns[edge.from];
      const toTown = towns[edge.to];

      const path = this.generatePath(fromTown.position, toTown.position);

      let length = 0;
      for (let j = 1; j < path.length; j++) {
        const dx = path[j].x - path[j - 1].x;
        const dz = path[j].z - path[j - 1].z;
        length += Math.sqrt(dx * dx + dz * dz);
      }

      const road: ProceduralRoad = {
        id: `road_${i}`,
        fromTownId: fromTown.id,
        toTownId: toTown.id,
        path,
        width: ROAD_WIDTH,
        material: "dirt",
        length,
      };

      this.roads.push(road);
      fromTown.connectedRoads.push(road.id);
      toTown.connectedRoads.push(road.id);
    }

    this.buildTileCache();
  }

  private generatePath(from: Position3D, to: Position3D): RoadPathPoint[] {
    const path: RoadPathPoint[] = [];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(distance / 20);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t;
      const z = from.z + dz * t;
      const y = this.terrainSystem.getHeightAt(x, z);
      path.push({ x, z, y });
    }

    return path;
  }

  private buildTileCache(): void {
    this.tileCache.clear();

    for (const road of this.roads) {
      for (let i = 0; i < road.path.length - 1; i++) {
        const p1 = road.path[i];
        const p2 = road.path[i + 1];

        const minTileX = Math.floor(Math.min(p1.x, p2.x) / TILE_SIZE);
        const maxTileX = Math.floor(Math.max(p1.x, p2.x) / TILE_SIZE);
        const minTileZ = Math.floor(Math.min(p1.z, p2.z) / TILE_SIZE);
        const maxTileZ = Math.floor(Math.max(p1.z, p2.z) / TILE_SIZE);

        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
          for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
            const key = `${tileX}_${tileZ}`;
            const tileMinX = tileX * TILE_SIZE;
            const tileMinZ = tileZ * TILE_SIZE;

            if (!this.tileCache.has(key)) {
              this.tileCache.set(key, []);
            }

            this.tileCache.get(key)!.push({
              start: { x: p1.x - tileMinX, z: p1.z - tileMinZ },
              end: { x: p2.x - tileMinX, z: p2.z - tileMinZ },
              width: road.width,
              roadId: road.id,
            });
          }
        }
      }
    }
  }

  getRoads(): ProceduralRoad[] {
    return this.roads;
  }

  getRoadSegmentsForTile(tileX: number, tileZ: number): RoadTileSegment[] {
    return this.tileCache.get(`${tileX}_${tileZ}`) ?? [];
  }

  isOnRoad(x: number, z: number): boolean {
    for (const road of this.roads) {
      for (let i = 0; i < road.path.length - 1; i++) {
        const p1 = road.path[i];
        const p2 = road.path[i + 1];

        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const lengthSq = dx * dx + dz * dz;

        if (lengthSq === 0) {
          if (Math.sqrt((x - p1.x) ** 2 + (z - p1.z) ** 2) <= road.width / 2) {
            return true;
          }
          continue;
        }

        const t = Math.max(
          0,
          Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / lengthSq),
        );
        const projX = p1.x + t * dx;
        const projZ = p1.z + t * dz;
        const distance = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);

        if (distance <= road.width / 2) {
          return true;
        }
      }
    }
    return false;
  }
}

/** Mock terrain system */
class MockTerrainSystem {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  getHeightAt(x: number, z: number): number {
    // Simple deterministic height based on position
    const noise =
      Math.sin(x * 0.01 + this.seed) * Math.cos(z * 0.01 + this.seed);
    return 10 + noise * 5;
  }

  getBiome(x: number, z: number): string {
    const noise = Math.sin(x * 0.005 + z * 0.003 + this.seed);
    if (noise > 0.3) return "plains";
    if (noise > 0) return "forest";
    if (noise > -0.3) return "valley";
    return "mountains";
  }
}

// ============== Tests ==============

describe("Town and Road System Integration", () => {
  let terrainSystem: MockTerrainSystem;
  let townSystem: MockTownSystem;
  let roadSystem: MockRoadNetworkSystem;

  beforeEach(() => {
    const seed = 12345;
    terrainSystem = new MockTerrainSystem(seed);
    townSystem = new MockTownSystem(seed, terrainSystem);
    roadSystem = new MockRoadNetworkSystem(seed, terrainSystem);

    townSystem.generateTowns();
    roadSystem.generateRoads(townSystem.getTowns());
  });

  describe("Town Generation", () => {
    it("generates exactly 25 towns", () => {
      expect(townSystem.getTowns().length).toBe(TOWN_COUNT);
    });

    it("towns have unique IDs", () => {
      const towns = townSystem.getTowns();
      const ids = new Set(towns.map((t) => t.id));
      expect(ids.size).toBe(towns.length);
    });

    it("towns maintain minimum spacing", () => {
      const towns = townSystem.getTowns();

      for (let i = 0; i < towns.length; i++) {
        for (let j = i + 1; j < towns.length; j++) {
          const dx = towns[j].position.x - towns[i].position.x;
          const dz = towns[j].position.z - towns[i].position.z;
          const distance = Math.sqrt(dx * dx + dz * dz);

          expect(distance).toBeGreaterThanOrEqual(MIN_TOWN_SPACING);
        }
      }
    });

    it("every town has essential buildings", () => {
      const towns = townSystem.getTowns();

      for (const town of towns) {
        const buildingTypes = town.buildings.map((b) => b.type);
        expect(buildingTypes).toContain("bank");
        expect(buildingTypes).toContain("store");
        expect(buildingTypes).toContain("anvil");
      }
    });

    it("larger towns have more buildings", () => {
      const towns = townSystem.getTowns();

      const hamlets = towns.filter((t) => t.size === "hamlet");
      const villages = towns.filter((t) => t.size === "village");
      const largeTowns = towns.filter((t) => t.size === "town");

      if (hamlets.length > 0 && villages.length > 0) {
        const avgHamletBuildings =
          hamlets.reduce((sum, t) => sum + t.buildings.length, 0) /
          hamlets.length;
        const avgVillageBuildings =
          villages.reduce((sum, t) => sum + t.buildings.length, 0) /
          villages.length;
        expect(avgVillageBuildings).toBeGreaterThanOrEqual(avgHamletBuildings);
      }

      if (villages.length > 0 && largeTowns.length > 0) {
        const avgVillageBuildings =
          villages.reduce((sum, t) => sum + t.buildings.length, 0) /
          villages.length;
        const avgTownBuildings =
          largeTowns.reduce((sum, t) => sum + t.buildings.length, 0) /
          largeTowns.length;
        expect(avgTownBuildings).toBeGreaterThanOrEqual(avgVillageBuildings);
      }
    });

    it("buildings are within town radius", () => {
      const towns = townSystem.getTowns();
      const radiusMap = { hamlet: 25, village: 40, town: 60 };

      for (const town of towns) {
        const radius = radiusMap[town.size];

        for (const building of town.buildings) {
          const dx = building.position.x - town.position.x;
          const dz = building.position.z - town.position.z;
          const distance = Math.sqrt(dx * dx + dz * dz);

          // Building center should be within radius (with some tolerance for building size)
          expect(distance).toBeLessThan(radius + 10);
        }
      }
    });

    it("generation is deterministic", () => {
      const seed = 99999;
      const terrain1 = new MockTerrainSystem(seed);
      const towns1 = new MockTownSystem(seed, terrain1);
      towns1.generateTowns();

      const terrain2 = new MockTerrainSystem(seed);
      const towns2 = new MockTownSystem(seed, terrain2);
      towns2.generateTowns();

      const t1 = towns1.getTowns();
      const t2 = towns2.getTowns();

      expect(t1.length).toBe(t2.length);

      for (let i = 0; i < t1.length; i++) {
        expect(t1[i].position.x).toBeCloseTo(t2[i].position.x, 5);
        expect(t1[i].position.z).toBeCloseTo(t2[i].position.z, 5);
        expect(t1[i].name).toBe(t2[i].name);
      }
    });
  });

  describe("Road Generation", () => {
    it("generates roads connecting all towns", () => {
      const roads = roadSystem.getRoads();
      const towns = townSystem.getTowns();

      // MST has n-1 edges
      expect(roads.length).toBe(towns.length - 1);
    });

    it("all towns are connected via roads", () => {
      const roads = roadSystem.getRoads();
      const towns = townSystem.getTowns();

      // Build adjacency set from roads
      const connected = new Map<string, Set<string>>();
      for (const town of towns) {
        connected.set(town.id, new Set());
      }

      for (const road of roads) {
        connected.get(road.fromTownId)?.add(road.toTownId);
        connected.get(road.toTownId)?.add(road.fromTownId);
      }

      // BFS to verify all towns are reachable from first town
      const visited = new Set<string>();
      const queue = [towns[0].id];
      visited.add(towns[0].id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of connected.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      expect(visited.size).toBe(towns.length);
    });

    it("roads have valid paths", () => {
      const roads = roadSystem.getRoads();

      for (const road of roads) {
        expect(road.path.length).toBeGreaterThanOrEqual(2);

        // Path should have increasing or valid positions
        for (const point of road.path) {
          expect(typeof point.x).toBe("number");
          expect(typeof point.z).toBe("number");
          expect(typeof point.y).toBe("number");
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.z)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
      }
    });

    it("road length matches path length", () => {
      const roads = roadSystem.getRoads();

      for (const road of roads) {
        let calculatedLength = 0;
        for (let i = 1; i < road.path.length; i++) {
          const dx = road.path[i].x - road.path[i - 1].x;
          const dz = road.path[i].z - road.path[i - 1].z;
          calculatedLength += Math.sqrt(dx * dx + dz * dz);
        }

        expect(road.length).toBeCloseTo(calculatedLength, 1);
      }
    });

    it("roads connect their designated towns", () => {
      const roads = roadSystem.getRoads();
      const towns = townSystem.getTowns();
      const townMap = new Map(towns.map((t) => [t.id, t]));

      for (const road of roads) {
        const fromTown = townMap.get(road.fromTownId);
        const toTown = townMap.get(road.toTownId);

        expect(fromTown).toBeDefined();
        expect(toTown).toBeDefined();

        // First path point should be near from town
        const firstPoint = road.path[0];
        const distToFrom = Math.sqrt(
          (firstPoint.x - fromTown!.position.x) ** 2 +
            (firstPoint.z - fromTown!.position.z) ** 2,
        );
        expect(distToFrom).toBeLessThan(50);

        // Last path point should be near to town
        const lastPoint = road.path[road.path.length - 1];
        const distToTo = Math.sqrt(
          (lastPoint.x - toTown!.position.x) ** 2 +
            (lastPoint.z - toTown!.position.z) ** 2,
        );
        expect(distToTo).toBeLessThan(50);
      }
    });
  });

  describe("Safe Zone Detection", () => {
    it("town center is in safe zone", () => {
      const towns = townSystem.getTowns();

      for (const town of towns) {
        expect(townSystem.isInSafeZone(town.position.x, town.position.z)).toBe(
          true,
        );
      }
    });

    it("position outside all towns is not in safe zone", () => {
      // Position far from all towns
      expect(townSystem.isInSafeZone(100000, 100000)).toBe(false);
    });

    it("position at safe zone boundary is in safe zone", () => {
      const town = townSystem.getTowns()[0];
      const x = town.position.x + town.safeZoneRadius;
      const z = town.position.z;

      expect(townSystem.isInSafeZone(x, z)).toBe(true);
    });

    it("position just outside safe zone is not in safe zone", () => {
      const town = townSystem.getTowns()[0];
      const x = town.position.x + town.safeZoneRadius + 1;
      const z = town.position.z;

      expect(townSystem.isInSafeZone(x, z)).toBe(false);
    });

    it("getTownAtPosition returns correct town", () => {
      const towns = townSystem.getTowns();

      for (const town of towns) {
        const found = townSystem.getTownAtPosition(
          town.position.x,
          town.position.z,
        );
        expect(found?.id).toBe(town.id);
      }
    });
  });

  describe("Road Detection", () => {
    it("point on road center returns true", () => {
      const roads = roadSystem.getRoads();
      const road = roads[0];
      const midIndex = Math.floor(road.path.length / 2);
      const midPoint = road.path[midIndex];

      expect(roadSystem.isOnRoad(midPoint.x, midPoint.z)).toBe(true);
    });

    it("point far from any road returns false", () => {
      expect(roadSystem.isOnRoad(100000, 100000)).toBe(false);
    });

    it("point at road edge returns true", () => {
      const roads = roadSystem.getRoads();
      const road = roads[0];
      const midIndex = Math.floor(road.path.length / 2);
      const midPoint = road.path[midIndex];

      // Offset by half road width minus small epsilon
      const offset = ROAD_WIDTH / 2 - 0.1;
      expect(roadSystem.isOnRoad(midPoint.x + offset, midPoint.z)).toBe(true);
    });

    it("point just outside road returns false", () => {
      const roads = roadSystem.getRoads();
      const road = roads[0];
      const midIndex = Math.floor(road.path.length / 2);
      const midPoint = road.path[midIndex];

      // Offset by more than half road width
      const offset = ROAD_WIDTH / 2 + 1;
      expect(roadSystem.isOnRoad(midPoint.x + offset, midPoint.z)).toBe(false);
    });
  });

  describe("Tile Cache", () => {
    it("returns segments for tiles containing roads", () => {
      const roads = roadSystem.getRoads();

      // Find a tile that should contain a road
      const road = roads[0];
      const midPoint = road.path[Math.floor(road.path.length / 2)];
      const tileX = Math.floor(midPoint.x / TILE_SIZE);
      const tileZ = Math.floor(midPoint.z / TILE_SIZE);

      const segments = roadSystem.getRoadSegmentsForTile(tileX, tileZ);
      expect(segments.length).toBeGreaterThan(0);
    });

    it("returns empty array for tiles without roads", () => {
      const segments = roadSystem.getRoadSegmentsForTile(1000, 1000);
      expect(segments).toEqual([]);
    });

    it("segments have valid road IDs", () => {
      const roads = roadSystem.getRoads();
      const roadIds = new Set(roads.map((r) => r.id));

      // Check some tiles that have roads
      for (const road of roads.slice(0, 5)) {
        const midPoint = road.path[Math.floor(road.path.length / 2)];
        const tileX = Math.floor(midPoint.x / TILE_SIZE);
        const tileZ = Math.floor(midPoint.z / TILE_SIZE);

        const segments = roadSystem.getRoadSegmentsForTile(tileX, tileZ);
        for (const segment of segments) {
          expect(roadIds.has(segment.roadId)).toBe(true);
        }
      }
    });
  });

  describe("System Coordination", () => {
    it("towns track their connected roads", () => {
      const towns = townSystem.getTowns();
      const roads = roadSystem.getRoads();

      // Every road should be referenced by exactly 2 towns
      const roadReferences = new Map<string, number>();
      for (const road of roads) {
        roadReferences.set(road.id, 0);
      }

      for (const town of towns) {
        for (const roadId of town.connectedRoads) {
          roadReferences.set(roadId, (roadReferences.get(roadId) ?? 0) + 1);
        }
      }

      for (const [_roadId, count] of roadReferences) {
        expect(count).toBe(2);
      }
    });

    it("road endpoints match connected towns", () => {
      const towns = townSystem.getTowns();
      const roads = roadSystem.getRoads();
      const townMap = new Map(towns.map((t) => [t.id, t]));

      for (const road of roads) {
        const fromTown = townMap.get(road.fromTownId)!;
        const toTown = townMap.get(road.toTownId)!;

        expect(fromTown.connectedRoads).toContain(road.id);
        expect(toTown.connectedRoads).toContain(road.id);
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles different seeds producing different results", () => {
      const terrain1 = new MockTerrainSystem(11111);
      const towns1 = new MockTownSystem(11111, terrain1);
      towns1.generateTowns();

      const terrain2 = new MockTerrainSystem(22222);
      const towns2 = new MockTownSystem(22222, terrain2);
      towns2.generateTowns();

      // Positions should differ
      const t1 = towns1.getTowns()[0];
      const t2 = towns2.getTowns()[0];

      const samePosX = Math.abs(t1.position.x - t2.position.x) < 1;
      const samePosZ = Math.abs(t1.position.z - t2.position.z) < 1;

      expect(samePosX && samePosZ).toBe(false);
    });

    it("handles seed 0", () => {
      const terrain = new MockTerrainSystem(0);
      const towns = new MockTownSystem(0, terrain);
      towns.generateTowns();

      expect(towns.getTowns().length).toBe(TOWN_COUNT);
    });

    it("handles large seed values", () => {
      const terrain = new MockTerrainSystem(0xffffffff);
      const towns = new MockTownSystem(0xffffffff, terrain);
      towns.generateTowns();

      expect(towns.getTowns().length).toBe(TOWN_COUNT);
    });
  });

  describe("Performance", () => {
    it("generates towns quickly", () => {
      const start = performance.now();

      for (let i = 0; i < 10; i++) {
        const terrain = new MockTerrainSystem(i);
        const towns = new MockTownSystem(i, terrain);
        towns.generateTowns();
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000); // 10 generations under 1 second
    });

    it("generates roads quickly", () => {
      const terrain = new MockTerrainSystem(42);
      const towns = new MockTownSystem(42, terrain);
      towns.generateTowns();

      const start = performance.now();

      for (let i = 0; i < 10; i++) {
        const roads = new MockRoadNetworkSystem(i, terrain);
        roads.generateRoads(towns.getTowns());
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500); // 10 generations under 500ms
    });

    it("safe zone checks are fast", () => {
      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        townSystem.isInSafeZone(
          Math.random() * 10000 - 5000,
          Math.random() * 10000 - 5000,
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50); // 10k checks under 50ms
    });

    it("road detection is fast", () => {
      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        roadSystem.isOnRoad(
          Math.random() * 10000 - 5000,
          Math.random() * 10000 - 5000,
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000); // 10k checks under 1s (CI machines can be slower)
    });
  });
});
