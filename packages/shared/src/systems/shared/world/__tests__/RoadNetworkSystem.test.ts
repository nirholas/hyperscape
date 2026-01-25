/**
 * Tests for RoadNetworkSystem procedural road generation algorithms.
 * Tests MST construction, A* pathfinding, path smoothing, and spatial indexing.
 */

import { describe, it, expect } from "vitest";

// ============== Constants (must match RoadNetworkSystem.ts) ==============
const ROAD_WIDTH = 4;
const PATH_STEP_SIZE = 20;
const _MAX_PATH_ITERATIONS = 10000;
const EXTRA_CONNECTIONS_RATIO = 0.25;

const COST_BASE = 1.0;
const COST_SLOPE_MULTIPLIER = 5.0;
const COST_WATER_PENALTY = 1000;
const COST_BIOME_MULTIPLIER: Record<string, number> = {
  plains: 1.0,
  valley: 1.0,
  forest: 1.3,
  tundra: 1.5,
  desert: 2.0,
  swamp: 2.5,
  mountains: 3.0,
  lakes: 100,
};

const SMOOTHING_ITERATIONS = 2;
const _NOISE_DISPLACEMENT_SCALE = 0.01;
const _NOISE_DISPLACEMENT_STRENGTH = 3;
const _MIN_POINT_SPACING = 4;
const TILE_SIZE = 100;
const WATER_THRESHOLD = 5.4;
const HEURISTIC_WEIGHT = 2.5;

// A* neighbor directions
const DIRECTIONS = [
  { dx: PATH_STEP_SIZE, dz: 0 },
  { dx: -PATH_STEP_SIZE, dz: 0 },
  { dx: 0, dz: PATH_STEP_SIZE },
  { dx: 0, dz: -PATH_STEP_SIZE },
  { dx: PATH_STEP_SIZE, dz: PATH_STEP_SIZE },
  { dx: PATH_STEP_SIZE, dz: -PATH_STEP_SIZE },
  { dx: -PATH_STEP_SIZE, dz: PATH_STEP_SIZE },
  { dx: -PATH_STEP_SIZE, dz: -PATH_STEP_SIZE },
];

// ============== Helper Functions ==============

const dist2D = (x1: number, z1: number, x2: number, z2: number): number =>
  Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);

interface Edge {
  fromId: string;
  toId: string;
  distance: number;
}

interface Town {
  id: string;
  position: { x: number; z: number };
}

interface _PathNode {
  x: number;
  z: number;
  g: number;
  h: number;
  f: number;
  parent: _PathNode | null;
}

interface RoadPathPoint {
  x: number;
  z: number;
  y: number;
}

interface RoadTileSegment {
  start: { x: number; z: number };
  end: { x: number; z: number };
  width: number;
  roadId: string;
}

/** Calculate all possible edges between towns */
function calculateAllEdges(towns: Town[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < towns.length; i++) {
    for (let j = i + 1; j < towns.length; j++) {
      edges.push({
        fromId: towns[i].id,
        toId: towns[j].id,
        distance: dist2D(
          towns[i].position.x,
          towns[i].position.z,
          towns[j].position.x,
          towns[j].position.z,
        ),
      });
    }
  }
  return edges;
}

/** Build MST using Prim's algorithm */
function buildMST(towns: Town[], edges: Edge[]): Edge[] {
  const mstEdges: Edge[] = [];
  const inMST = new Set<string>();

  if (towns.length === 0) return mstEdges;

  inMST.add(towns[0].id);

  while (inMST.size < towns.length) {
    let minEdge: Edge | null = null;
    let minDistance = Infinity;

    for (const edge of edges) {
      const fromInMST = inMST.has(edge.fromId);
      const toInMST = inMST.has(edge.toId);

      if (fromInMST !== toInMST) {
        if (edge.distance < minDistance) {
          minDistance = edge.distance;
          minEdge = edge;
        }
      }
    }

    if (minEdge) {
      mstEdges.push(minEdge);
      inMST.add(minEdge.fromId);
      inMST.add(minEdge.toId);
    } else {
      break;
    }
  }

  return mstEdges;
}

/** A* heuristic (Euclidean) */
function heuristic(x1: number, z1: number, x2: number, z2: number): number {
  return dist2D(x1, z1, x2, z2) * COST_BASE;
}

/** Calculate movement cost */
function calculateMovementCost(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  getHeight: (x: number, z: number) => number,
  getBiome?: (x: number, z: number) => string,
): number {
  const fromHeight = getHeight(fromX, fromZ);
  const toHeight = getHeight(toX, toZ);

  if (toHeight < WATER_THRESHOLD) return COST_WATER_PENALTY;

  const horizontalDistance = dist2D(fromX, fromZ, toX, toZ);
  const slope = Math.abs(toHeight - fromHeight) / horizontalDistance;

  const biome = getBiome?.(toX, toZ);
  const biomeCost = biome ? (COST_BIOME_MULTIPLIER[biome] ?? 1.0) : 1.0;

  const baseCost = horizontalDistance * COST_BASE;
  const slopeCost = slope * COST_SLOPE_MULTIPLIER * horizontalDistance;

  return (baseCost + slopeCost) * biomeCost;
}

/** Distance from point to line segment */
function distanceToSegment(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq === 0) return dist2D(px, pz, x1, z1);

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lengthSq),
  );
  return dist2D(px, pz, x1 + t * dx, z1 + t * dz);
}

/** Cohen-Sutherland line clipping */
function clipSegmentToTile(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { x1: number; z1: number; x2: number; z2: number } | null {
  const INSIDE = 0,
    LEFT = 1,
    RIGHT = 2,
    BOTTOM = 4,
    TOP = 8;

  const computeCode = (x: number, z: number): number => {
    let code = INSIDE;
    if (x < minX) code |= LEFT;
    else if (x > maxX) code |= RIGHT;
    if (z < minZ) code |= BOTTOM;
    else if (z > maxZ) code |= TOP;
    return code;
  };

  let code1 = computeCode(x1, z1);
  let code2 = computeCode(x2, z2);
  let accept = false;

  while (true) {
    if ((code1 | code2) === 0) {
      accept = true;
      break;
    } else if ((code1 & code2) !== 0) {
      break;
    } else {
      const codeOut = code1 !== 0 ? code1 : code2;
      let x: number, z: number;

      if (codeOut & TOP) {
        x = x1 + ((x2 - x1) * (maxZ - z1)) / (z2 - z1);
        z = maxZ;
      } else if (codeOut & BOTTOM) {
        x = x1 + ((x2 - x1) * (minZ - z1)) / (z2 - z1);
        z = minZ;
      } else if (codeOut & RIGHT) {
        z = z1 + ((z2 - z1) * (maxX - x1)) / (x2 - x1);
        x = maxX;
      } else {
        z = z1 + ((z2 - z1) * (minX - x1)) / (x2 - x1);
        x = minX;
      }

      if (codeOut === code1) {
        x1 = x;
        z1 = z;
        code1 = computeCode(x1, z1);
      } else {
        x2 = x;
        z2 = z;
        code2 = computeCode(x2, z2);
      }
    }
  }

  return accept ? { x1, z1, x2, z2 } : null;
}

/** Chaikin smoothing iteration */
function chaikinSmooth(path: RoadPathPoint[]): RoadPathPoint[] {
  if (path.length < 2) return path;

  const newPath: RoadPathPoint[] = [path[0]];

  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[i];
    const p1 = path[i + 1];

    newPath.push({
      x: p0.x * 0.75 + p1.x * 0.25,
      z: p0.z * 0.75 + p1.z * 0.25,
      y: p0.y * 0.75 + p1.y * 0.25,
    });
    newPath.push({
      x: p0.x * 0.25 + p1.x * 0.75,
      z: p0.z * 0.25 + p1.z * 0.75,
      y: p0.y * 0.25 + p1.y * 0.75,
    });
  }

  newPath.push(path[path.length - 1]);
  return newPath;
}

// ============== Tests ==============

describe("RoadNetworkSystem Algorithms", () => {
  describe("Edge Calculation", () => {
    it("calculates correct number of edges", () => {
      const towns: Town[] = [
        { id: "t0", position: { x: 0, z: 0 } },
        { id: "t1", position: { x: 100, z: 0 } },
        { id: "t2", position: { x: 0, z: 100 } },
      ];

      const edges = calculateAllEdges(towns);

      // n*(n-1)/2 edges for n towns
      expect(edges.length).toBe(3);
    });

    it("calculates correct distances", () => {
      const towns: Town[] = [
        { id: "t0", position: { x: 0, z: 0 } },
        { id: "t1", position: { x: 100, z: 0 } },
        { id: "t2", position: { x: 0, z: 100 } },
      ];

      const edges = calculateAllEdges(towns);

      const edge01 = edges.find((e) => e.fromId === "t0" && e.toId === "t1");
      const edge02 = edges.find((e) => e.fromId === "t0" && e.toId === "t2");
      const edge12 = edges.find((e) => e.fromId === "t1" && e.toId === "t2");

      expect(edge01?.distance).toBeCloseTo(100, 5);
      expect(edge02?.distance).toBeCloseTo(100, 5);
      expect(edge12?.distance).toBeCloseTo(Math.sqrt(2) * 100, 5);
    });

    it("handles empty town list", () => {
      const edges = calculateAllEdges([]);
      expect(edges.length).toBe(0);
    });

    it("handles single town", () => {
      const edges = calculateAllEdges([{ id: "t0", position: { x: 0, z: 0 } }]);
      expect(edges.length).toBe(0);
    });
  });

  describe("MST Construction (Prim's Algorithm)", () => {
    it("connects all towns", () => {
      const towns: Town[] = [
        { id: "t0", position: { x: 0, z: 0 } },
        { id: "t1", position: { x: 100, z: 0 } },
        { id: "t2", position: { x: 0, z: 100 } },
        { id: "t3", position: { x: 100, z: 100 } },
      ];

      const edges = calculateAllEdges(towns);
      const mst = buildMST(towns, edges);

      // MST has n-1 edges for n nodes
      expect(mst.length).toBe(3);

      // Verify all towns are connected
      const connectedTowns = new Set<string>();
      connectedTowns.add(towns[0].id);

      for (const edge of mst) {
        connectedTowns.add(edge.fromId);
        connectedTowns.add(edge.toId);
      }

      expect(connectedTowns.size).toBe(4);
    });

    it("selects minimum weight edges", () => {
      const towns: Town[] = [
        { id: "t0", position: { x: 0, z: 0 } },
        { id: "t1", position: { x: 10, z: 0 } }, // Close to t0
        { id: "t2", position: { x: 1000, z: 0 } }, // Far away
      ];

      const edges = calculateAllEdges(towns);
      const mst = buildMST(towns, edges);

      // Should include the short edge (t0-t1) and connect t2
      const totalLength = mst.reduce((sum, e) => sum + e.distance, 0);

      // Minimum total would be: 10 + 990 = 1000 (not 10 + 1000 = 1010)
      expect(totalLength).toBeCloseTo(1000, 0);
    });

    it("handles empty input", () => {
      const mst = buildMST([], []);
      expect(mst.length).toBe(0);
    });

    it("handles single town", () => {
      const towns: Town[] = [{ id: "t0", position: { x: 0, z: 0 } }];
      const mst = buildMST(towns, []);
      expect(mst.length).toBe(0);
    });

    it("produces tree structure (no cycles)", () => {
      const towns: Town[] = [];
      for (let i = 0; i < 10; i++) {
        towns.push({ id: `t${i}`, position: { x: i * 100, z: (i % 3) * 100 } });
      }

      const edges = calculateAllEdges(towns);
      const mst = buildMST(towns, edges);

      // Tree has exactly n-1 edges for n nodes
      expect(mst.length).toBe(towns.length - 1);

      // Each town should appear at most (n-1) times total in edges
      const degrees = new Map<string, number>();
      for (const edge of mst) {
        degrees.set(edge.fromId, (degrees.get(edge.fromId) ?? 0) + 1);
        degrees.set(edge.toId, (degrees.get(edge.toId) ?? 0) + 1);
      }

      // In a tree, sum of degrees = 2*(n-1)
      const totalDegree = Array.from(degrees.values()).reduce(
        (a, b) => a + b,
        0,
      );
      expect(totalDegree).toBe(2 * (towns.length - 1));
    });
  });

  describe("A* Pathfinding Costs", () => {
    it("heuristic returns Euclidean distance", () => {
      expect(heuristic(0, 0, 100, 0)).toBeCloseTo(100, 5);
      expect(heuristic(0, 0, 0, 100)).toBeCloseTo(100, 5);
      expect(heuristic(0, 0, 100, 100)).toBeCloseTo(Math.sqrt(2) * 100, 5);
    });

    it("water has extreme penalty", () => {
      const underwaterHeight = () => WATER_THRESHOLD - 1;
      const cost = calculateMovementCost(0, 0, 10, 0, underwaterHeight);
      expect(cost).toBe(COST_WATER_PENALTY);
    });

    it("flat terrain has base cost", () => {
      const flatHeight = () => 10;
      const cost = calculateMovementCost(0, 0, PATH_STEP_SIZE, 0, flatHeight);
      expect(cost).toBeCloseTo(PATH_STEP_SIZE * COST_BASE, 2);
    });

    it("slope increases cost", () => {
      const flatHeight = () => 10;
      const slopedHeight = (x: number) => 10 + x * 0.5; // 50% grade

      const flatCost = calculateMovementCost(
        0,
        0,
        PATH_STEP_SIZE,
        0,
        flatHeight,
      );
      const slopedCost = calculateMovementCost(
        0,
        0,
        PATH_STEP_SIZE,
        0,
        slopedHeight,
      );

      expect(slopedCost).toBeGreaterThan(flatCost);
    });

    it("biome affects cost", () => {
      const flatHeight = () => 10;

      const plainsCost = calculateMovementCost(
        0,
        0,
        10,
        0,
        flatHeight,
        () => "plains",
      );
      const swampCost = calculateMovementCost(
        0,
        0,
        10,
        0,
        flatHeight,
        () => "swamp",
      );
      const mountainsCost = calculateMovementCost(
        0,
        0,
        10,
        0,
        flatHeight,
        () => "mountains",
      );

      expect(swampCost).toBeGreaterThan(plainsCost);
      expect(mountainsCost).toBeGreaterThan(swampCost);
    });

    it("diagonal movement costs more than cardinal", () => {
      const flatHeight = () => 10;

      const cardinalCost = calculateMovementCost(
        0,
        0,
        PATH_STEP_SIZE,
        0,
        flatHeight,
      );
      const diagonalCost = calculateMovementCost(
        0,
        0,
        PATH_STEP_SIZE,
        PATH_STEP_SIZE,
        flatHeight,
      );

      // Diagonal is sqrt(2) times longer
      expect(diagonalCost).toBeCloseTo(cardinalCost * Math.sqrt(2), 2);
    });
  });

  describe("Distance to Segment", () => {
    it("returns 0 for point on segment", () => {
      expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 5);
    });

    it("returns correct distance for point perpendicular to segment", () => {
      expect(distanceToSegment(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 5);
    });

    it("returns distance to nearest endpoint when beyond segment", () => {
      // Point is beyond segment end
      expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBeCloseTo(5, 5);
      // Point is before segment start
      expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5, 5);
    });

    it("handles zero-length segment", () => {
      expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 5);
    });

    it("handles diagonal segments", () => {
      // Segment from (0,0) to (10,10), point at (10, 0)
      // Distance should be to midpoint perpendicular
      const d = distanceToSegment(10, 0, 0, 0, 10, 10);
      expect(d).toBeCloseTo(Math.sqrt(2) * 5, 2);
    });
  });

  describe("Cohen-Sutherland Line Clipping", () => {
    it("returns null for completely outside segment", () => {
      const result = clipSegmentToTile(200, 200, 300, 300, 0, 100, 0, 100);
      expect(result).toBeNull();
    });

    it("returns unchanged segment for completely inside", () => {
      const result = clipSegmentToTile(25, 25, 75, 75, 0, 100, 0, 100);
      expect(result).not.toBeNull();
      expect(result!.x1).toBe(25);
      expect(result!.z1).toBe(25);
      expect(result!.x2).toBe(75);
      expect(result!.z2).toBe(75);
    });

    it("clips segment crossing left boundary", () => {
      const result = clipSegmentToTile(-50, 50, 50, 50, 0, 100, 0, 100);
      expect(result).not.toBeNull();
      expect(result!.x1).toBeCloseTo(0, 5);
      expect(result!.x2).toBe(50);
    });

    it("clips segment crossing right boundary", () => {
      const result = clipSegmentToTile(50, 50, 150, 50, 0, 100, 0, 100);
      expect(result).not.toBeNull();
      expect(result!.x1).toBe(50);
      expect(result!.x2).toBeCloseTo(100, 5);
    });

    it("clips segment crossing both boundaries", () => {
      const result = clipSegmentToTile(-50, 50, 150, 50, 0, 100, 0, 100);
      expect(result).not.toBeNull();
      expect(result!.x1).toBeCloseTo(0, 5);
      expect(result!.x2).toBeCloseTo(100, 5);
    });

    it("clips diagonal segments correctly", () => {
      const result = clipSegmentToTile(-50, -50, 150, 150, 0, 100, 0, 100);
      expect(result).not.toBeNull();
      expect(result!.x1).toBeCloseTo(0, 5);
      expect(result!.z1).toBeCloseTo(0, 5);
      expect(result!.x2).toBeCloseTo(100, 5);
      expect(result!.z2).toBeCloseTo(100, 5);
    });

    it("handles segment at exact boundary", () => {
      const result = clipSegmentToTile(0, 50, 100, 50, 0, 100, 0, 100);
      expect(result).not.toBeNull();
    });
  });

  describe("Chaikin Path Smoothing", () => {
    it("preserves endpoints", () => {
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      const smoothed = chaikinSmooth(path);

      expect(smoothed[0]).toEqual(path[0]);
      expect(smoothed[smoothed.length - 1]).toEqual(path[path.length - 1]);
    });

    it("increases point count", () => {
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      const smoothed = chaikinSmooth(path);

      // Each segment becomes 2 points, plus original endpoints
      // n segments = n-1, so 2*(n-1) new points + 2 endpoints = 2n
      expect(smoothed.length).toBeGreaterThan(path.length);
    });

    it("places new points at 25% and 75% along segments", () => {
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      const smoothed = chaikinSmooth(path);

      // First new point at 25%: x = 0*0.75 + 100*0.25 = 25
      expect(smoothed[1].x).toBeCloseTo(25, 5);
      // Second new point at 75%: x = 0*0.25 + 100*0.75 = 75
      expect(smoothed[2].x).toBeCloseTo(75, 5);
    });

    it("handles short paths", () => {
      const singlePoint: RoadPathPoint[] = [{ x: 0, z: 0, y: 0 }];
      expect(chaikinSmooth(singlePoint)).toEqual(singlePoint);

      const twoPoints: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];
      const smoothed = chaikinSmooth(twoPoints);
      expect(smoothed.length).toBe(4); // start + 2 new + end
    });

    it("multiple iterations increase smoothness", () => {
      let path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 50, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      const lengths: number[] = [path.length];

      for (let i = 0; i < SMOOTHING_ITERATIONS; i++) {
        path = chaikinSmooth(path);
        lengths.push(path.length);
      }

      // Each iteration increases point count
      for (let i = 1; i < lengths.length; i++) {
        expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
      }
    });
  });

  describe("Road Width and isOnRoad", () => {
    function isOnRoad(
      x: number,
      z: number,
      roads: Array<{ path: RoadPathPoint[]; width: number }>,
    ): boolean {
      for (const road of roads) {
        for (let i = 0; i < road.path.length - 1; i++) {
          const p1 = road.path[i];
          const p2 = road.path[i + 1];
          const distance = distanceToSegment(x, z, p1.x, p1.z, p2.x, p2.z);
          if (distance <= road.width / 2) {
            return true;
          }
        }
      }
      return false;
    }

    it("returns true for point on road center", () => {
      const roads = [
        {
          path: [
            { x: 0, z: 0, y: 0 },
            { x: 100, z: 0, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      expect(isOnRoad(50, 0, roads)).toBe(true);
    });

    it("returns true for point within road width", () => {
      const roads = [
        {
          path: [
            { x: 0, z: 0, y: 0 },
            { x: 100, z: 0, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      // Point at half width from center
      expect(isOnRoad(50, ROAD_WIDTH / 2 - 0.1, roads)).toBe(true);
    });

    it("returns false for point outside road width", () => {
      const roads = [
        {
          path: [
            { x: 0, z: 0, y: 0 },
            { x: 100, z: 0, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      expect(isOnRoad(50, ROAD_WIDTH, roads)).toBe(false);
    });

    it("handles multiple road segments", () => {
      const roads = [
        {
          path: [
            { x: 0, z: 0, y: 0 },
            { x: 100, z: 0, y: 0 },
            { x: 100, z: 100, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      expect(isOnRoad(50, 0, roads)).toBe(true); // On first segment
      expect(isOnRoad(100, 50, roads)).toBe(true); // On second segment
      expect(isOnRoad(50, 50, roads)).toBe(false); // Not on any segment
    });
  });

  describe("Spatial Index (Tile Cache)", () => {
    function buildTileCache(
      roads: Array<{ id: string; path: RoadPathPoint[]; width: number }>,
    ): Map<string, RoadTileSegment[]> {
      const cache = new Map<string, RoadTileSegment[]>();

      for (const road of roads) {
        for (let i = 0; i < road.path.length - 1; i++) {
          const p1 = road.path[i];
          const p2 = road.path[i + 1];

          const minTileX = Math.floor(Math.min(p1.x, p2.x) / TILE_SIZE);
          const maxTileX = Math.floor(Math.max(p1.x, p2.x) / TILE_SIZE);
          const minTileZ = Math.floor(Math.min(p1.z, p2.z) / TILE_SIZE);
          const maxTileZ = Math.floor(Math.max(p1.z, p2.z) / TILE_SIZE);

          for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
              const tileKey = `${tileX}_${tileZ}`;
              const tileMinX = tileX * TILE_SIZE;
              const tileMaxX = (tileX + 1) * TILE_SIZE;
              const tileMinZ = tileZ * TILE_SIZE;
              const tileMaxZ = (tileZ + 1) * TILE_SIZE;

              const clipped = clipSegmentToTile(
                p1.x,
                p1.z,
                p2.x,
                p2.z,
                tileMinX,
                tileMaxX,
                tileMinZ,
                tileMaxZ,
              );

              if (clipped) {
                const segment: RoadTileSegment = {
                  start: { x: clipped.x1 - tileMinX, z: clipped.z1 - tileMinZ },
                  end: { x: clipped.x2 - tileMinX, z: clipped.z2 - tileMinZ },
                  width: road.width,
                  roadId: road.id,
                };

                if (!cache.has(tileKey)) {
                  cache.set(tileKey, []);
                }
                cache.get(tileKey)!.push(segment);
              }
            }
          }
        }
      }

      return cache;
    }

    it("indexes road segments by tile", () => {
      const roads = [
        {
          id: "road_0",
          path: [
            { x: 50, z: 50, y: 0 },
            { x: 150, z: 50, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      const cache = buildTileCache(roads);

      // Road crosses tiles 0_0 and 1_0
      expect(cache.has("0_0")).toBe(true);
      expect(cache.has("1_0")).toBe(true);
      expect(cache.has("2_0")).toBe(false);
    });

    it("clips segments to tile bounds", () => {
      const roads = [
        {
          id: "road_0",
          path: [
            { x: 50, z: 50, y: 0 },
            { x: 150, z: 50, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      const cache = buildTileCache(roads);
      const tile0 = cache.get("0_0")!;
      const tile1 = cache.get("1_0")!;

      // In tile 0_0: segment ends at tile boundary (100)
      expect(tile0[0].end.x).toBeCloseTo(100, 2); // Local coords: 100 - 0 = 100
      // In tile 1_0: segment starts at tile boundary (0 local)
      expect(tile1[0].start.x).toBeCloseTo(0, 2);
    });

    it("uses local tile coordinates", () => {
      const roads = [
        {
          id: "road_0",
          path: [
            { x: 250, z: 250, y: 0 },
            { x: 275, z: 275, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      const cache = buildTileCache(roads);
      const tile = cache.get("2_2")!;

      // World coords (250, 250) -> local (50, 50) in tile 2_2
      expect(tile[0].start.x).toBeCloseTo(50, 2);
      expect(tile[0].start.z).toBeCloseTo(50, 2);
    });

    it("handles road spanning multiple tiles", () => {
      const roads = [
        {
          id: "road_0",
          path: [
            { x: 0, z: 50, y: 0 },
            { x: 500, z: 50, y: 0 },
          ],
          width: ROAD_WIDTH,
        },
      ];

      const cache = buildTileCache(roads);

      // Should have entries in tiles 0-4 (0, 100, 200, 300, 400)
      expect(cache.has("0_0")).toBe(true);
      expect(cache.has("1_0")).toBe(true);
      expect(cache.has("2_0")).toBe(true);
      expect(cache.has("3_0")).toBe(true);
      expect(cache.has("4_0")).toBe(true);
    });
  });

  describe("Extra Connections", () => {
    function selectExtraEdges(
      allEdges: Edge[],
      mstEdges: Edge[],
      townCount: number,
    ): Edge[] {
      const mstEdgeSet = new Set<string>();
      for (const edge of mstEdges) {
        mstEdgeSet.add(`${edge.fromId}-${edge.toId}`);
        mstEdgeSet.add(`${edge.toId}-${edge.fromId}`);
      }

      const nonMstEdges = allEdges
        .filter(
          (edge) =>
            !mstEdgeSet.has(`${edge.fromId}-${edge.toId}`) &&
            !mstEdgeSet.has(`${edge.toId}-${edge.fromId}`),
        )
        .sort((a, b) => a.distance - b.distance);

      const extraCount = Math.floor(townCount * EXTRA_CONNECTIONS_RATIO);
      return nonMstEdges.slice(0, extraCount);
    }

    it("selects correct number of extra edges", () => {
      const towns: Town[] = [];
      for (let i = 0; i < 20; i++) {
        towns.push({ id: `t${i}`, position: { x: i * 100, z: 0 } });
      }

      const allEdges = calculateAllEdges(towns);
      const mstEdges = buildMST(towns, allEdges);
      const extraEdges = selectExtraEdges(allEdges, mstEdges, towns.length);

      expect(extraEdges.length).toBe(Math.floor(20 * EXTRA_CONNECTIONS_RATIO));
    });

    it("selects shortest non-MST edges", () => {
      const towns: Town[] = [
        { id: "t0", position: { x: 0, z: 0 } },
        { id: "t1", position: { x: 100, z: 0 } },
        { id: "t2", position: { x: 200, z: 0 } },
        { id: "t3", position: { x: 300, z: 0 } },
      ];

      const allEdges = calculateAllEdges(towns);
      const mstEdges = buildMST(towns, allEdges);
      const extraEdges = selectExtraEdges(allEdges, mstEdges, towns.length);

      // Extra edges should be sorted by distance
      for (let i = 1; i < extraEdges.length; i++) {
        expect(extraEdges[i].distance).toBeGreaterThanOrEqual(
          extraEdges[i - 1].distance,
        );
      }
    });

    it("does not duplicate MST edges", () => {
      const towns: Town[] = [];
      for (let i = 0; i < 10; i++) {
        towns.push({ id: `t${i}`, position: { x: i * 100, z: (i % 2) * 50 } });
      }

      const allEdges = calculateAllEdges(towns);
      const mstEdges = buildMST(towns, allEdges);
      const extraEdges = selectExtraEdges(allEdges, mstEdges, towns.length);

      const mstSet = new Set<string>();
      for (const edge of mstEdges) {
        mstSet.add(`${edge.fromId}-${edge.toId}`);
        mstSet.add(`${edge.toId}-${edge.fromId}`);
      }

      for (const edge of extraEdges) {
        expect(mstSet.has(`${edge.fromId}-${edge.toId}`)).toBe(false);
        expect(mstSet.has(`${edge.toId}-${edge.fromId}`)).toBe(false);
      }
    });
  });

  describe("Road Length Calculation", () => {
    it("calculates correct length for straight path", () => {
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      let totalLength = 0;
      for (let i = 1; i < path.length; i++) {
        totalLength += dist2D(
          path[i - 1].x,
          path[i - 1].z,
          path[i].x,
          path[i].z,
        );
      }

      expect(totalLength).toBeCloseTo(100, 5);
    });

    it("calculates correct length for multi-segment path", () => {
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 0 },
        { x: 100, z: 100, y: 0 },
      ];

      let totalLength = 0;
      for (let i = 1; i < path.length; i++) {
        totalLength += dist2D(
          path[i - 1].x,
          path[i - 1].z,
          path[i].x,
          path[i].z,
        );
      }

      expect(totalLength).toBeCloseTo(200, 5);
    });

    it("diagonal path is longer than Euclidean distance", () => {
      // A path that zigzags will be longer than direct distance
      const path: RoadPathPoint[] = [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 25, y: 0 },
        { x: 100, z: 0, y: 0 },
      ];

      let totalLength = 0;
      for (let i = 1; i < path.length; i++) {
        totalLength += dist2D(
          path[i - 1].x,
          path[i - 1].z,
          path[i].x,
          path[i].z,
        );
      }

      const directDistance = dist2D(0, 0, 100, 0);
      expect(totalLength).toBeGreaterThan(directDistance);
    });
  });

  describe("A* Direction Constants", () => {
    it("has 8 directions", () => {
      expect(DIRECTIONS.length).toBe(8);
    });

    it("includes all cardinal directions", () => {
      const hasRight = DIRECTIONS.some((d) => d.dx > 0 && d.dz === 0);
      const hasLeft = DIRECTIONS.some((d) => d.dx < 0 && d.dz === 0);
      const hasUp = DIRECTIONS.some((d) => d.dx === 0 && d.dz > 0);
      const hasDown = DIRECTIONS.some((d) => d.dx === 0 && d.dz < 0);

      expect(hasRight && hasLeft && hasUp && hasDown).toBe(true);
    });

    it("includes all diagonal directions", () => {
      const diagonals = DIRECTIONS.filter((d) => d.dx !== 0 && d.dz !== 0);
      expect(diagonals.length).toBe(4);
    });

    it("all movements use PATH_STEP_SIZE", () => {
      for (const dir of DIRECTIONS) {
        expect(Math.abs(dir.dx)).toBeLessThanOrEqual(PATH_STEP_SIZE);
        expect(Math.abs(dir.dz)).toBeLessThanOrEqual(PATH_STEP_SIZE);
      }
    });
  });

  describe("Performance Characteristics", () => {
    it("MST construction scales well", () => {
      const towns: Town[] = [];
      for (let i = 0; i < 100; i++) {
        towns.push({
          id: `t${i}`,
          position: { x: Math.random() * 10000, z: Math.random() * 10000 },
        });
      }

      const edges = calculateAllEdges(towns);

      const start = performance.now();
      buildMST(towns, edges);
      const elapsed = performance.now() - start;

      // Should complete in reasonable time
      expect(elapsed).toBeLessThan(100);
    });

    it("tile cache lookup is O(1)", () => {
      const cache = new Map<string, RoadTileSegment[]>();

      // Populate with many entries
      for (let x = 0; x < 100; x++) {
        for (let z = 0; z < 100; z++) {
          cache.set(`${x}_${z}`, [
            {
              start: { x: 0, z: 0 },
              end: { x: 50, z: 50 },
              width: 4,
              roadId: "test",
            },
          ]);
        }
      }

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        cache.get("50_50");
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });

    it("distance to segment is fast", () => {
      const start = performance.now();

      for (let i = 0; i < 100000; i++) {
        distanceToSegment(
          Math.random() * 100,
          Math.random() * 100,
          0,
          0,
          100,
          100,
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("A* Pathfinding with Binary Heap (Optimized)", () => {
    const MAX_PATH_ITERATIONS = _MAX_PATH_ITERATIONS;

    interface HeapPathNode {
      x: number;
      z: number;
      g: number;
      h: number;
      f: number;
      parent: HeapPathNode | null;
      heapIndex: number;
    }

    /**
     * Binary min-heap implementation matching the production code
     */
    class PathNodeHeap {
      private nodes: HeapPathNode[] = [];

      get length(): number {
        return this.nodes.length;
      }

      push(node: HeapPathNode): void {
        node.heapIndex = this.nodes.length;
        this.nodes.push(node);
        this.bubbleUp(this.nodes.length - 1);
      }

      pop(): HeapPathNode | undefined {
        if (this.nodes.length === 0) return undefined;
        const result = this.nodes[0];
        const last = this.nodes.pop()!;
        if (this.nodes.length > 0) {
          this.nodes[0] = last;
          last.heapIndex = 0;
          this.bubbleDown(0);
        }
        return result;
      }

      updateNode(node: HeapPathNode): void {
        this.bubbleUp(node.heapIndex);
        this.bubbleDown(node.heapIndex);
      }

      private bubbleUp(index: number): void {
        const node = this.nodes[index];
        while (index > 0) {
          const parentIndex = (index - 1) >> 1;
          const parent = this.nodes[parentIndex];
          if (node.f >= parent.f) break;
          this.nodes[index] = parent;
          parent.heapIndex = index;
          index = parentIndex;
        }
        this.nodes[index] = node;
        node.heapIndex = index;
      }

      private bubbleDown(index: number): void {
        const node = this.nodes[index];
        const length = this.nodes.length;
        const halfLength = length >> 1;

        while (index < halfLength) {
          const leftIndex = (index << 1) + 1;
          const rightIndex = leftIndex + 1;
          let bestIndex = leftIndex;
          let best = this.nodes[leftIndex];

          if (rightIndex < length && this.nodes[rightIndex].f < best.f) {
            bestIndex = rightIndex;
            best = this.nodes[rightIndex];
          }

          if (node.f <= best.f) break;

          this.nodes[index] = best;
          best.heapIndex = index;
          index = bestIndex;
        }
        this.nodes[index] = node;
        node.heapIndex = index;
      }
    }

    /**
     * Optimized A* pathfinding using binary heap - matches production implementation
     */
    function findPathOptimized(
      startX: number,
      startZ: number,
      endX: number,
      endZ: number,
      getHeight: (x: number, z: number) => number,
      getBiome?: (x: number, z: number) => string,
    ): { path: RoadPathPoint[]; iterations: number; hitFallback: boolean } {
      const gridStartX = Math.round(startX / PATH_STEP_SIZE) * PATH_STEP_SIZE;
      const gridStartZ = Math.round(startZ / PATH_STEP_SIZE) * PATH_STEP_SIZE;
      const gridEndX = Math.round(endX / PATH_STEP_SIZE) * PATH_STEP_SIZE;
      const gridEndZ = Math.round(endZ / PATH_STEP_SIZE) * PATH_STEP_SIZE;

      const openHeap = new PathNodeHeap();
      const openMap = new Map<string, HeapPathNode>();
      const closedSet = new Set<string>();

      const startH =
        dist2D(gridStartX, gridStartZ, gridEndX, gridEndZ) *
        COST_BASE *
        HEURISTIC_WEIGHT;
      const startNode: HeapPathNode = {
        x: gridStartX,
        z: gridStartZ,
        g: 0,
        h: startH,
        f: startH,
        parent: null,
        heapIndex: 0,
      };
      openHeap.push(startNode);
      openMap.set(`${gridStartX},${gridStartZ}`, startNode);

      let iterations = 0;
      while (openHeap.length > 0 && iterations < MAX_PATH_ITERATIONS) {
        iterations++;

        const current = openHeap.pop()!;
        const currentKey = `${current.x},${current.z}`;
        openMap.delete(currentKey);

        if (
          Math.abs(current.x - gridEndX) <= PATH_STEP_SIZE &&
          Math.abs(current.z - gridEndZ) <= PATH_STEP_SIZE
        ) {
          // Reconstruct path
          const path: RoadPathPoint[] = [];
          let node: HeapPathNode | null = current;
          while (node) {
            path.unshift({
              x: node.x,
              z: node.z,
              y: getHeight(node.x, node.z),
            });
            node = node.parent;
          }
          path.push({ x: endX, z: endZ, y: getHeight(endX, endZ) });
          return { path, iterations, hitFallback: false };
        }

        closedSet.add(currentKey);

        for (const dir of DIRECTIONS) {
          const neighborX = current.x + dir.dx;
          const neighborZ = current.z + dir.dz;
          const neighborKey = `${neighborX},${neighborZ}`;
          if (closedSet.has(neighborKey)) continue;

          const moveCost = calculateMovementCost(
            current.x,
            current.z,
            neighborX,
            neighborZ,
            getHeight,
            getBiome,
          );
          if (moveCost >= COST_WATER_PENALTY) continue;

          const tentativeG = current.g + moveCost;
          const existing = openMap.get(neighborKey);

          if (!existing) {
            const h =
              dist2D(neighborX, neighborZ, gridEndX, gridEndZ) *
              COST_BASE *
              HEURISTIC_WEIGHT;
            const neighbor: HeapPathNode = {
              x: neighborX,
              z: neighborZ,
              g: tentativeG,
              h,
              f: tentativeG + h,
              parent: current,
              heapIndex: 0,
            };
            openHeap.push(neighbor);
            openMap.set(neighborKey, neighbor);
          } else if (tentativeG < existing.g) {
            existing.g = tentativeG;
            existing.f = tentativeG + existing.h;
            existing.parent = current;
            openHeap.updateNode(existing);
          }
        }
      }

      // Fallback to direct path
      const path: RoadPathPoint[] = [];
      const dx = endX - startX;
      const dz = endZ - startZ;
      const steps = Math.ceil(Math.sqrt(dx * dx + dz * dz) / PATH_STEP_SIZE);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = startX + dx * t;
        const z = startZ + dz * t;
        path.push({ x, z, y: getHeight(x, z) });
      }
      return { path, iterations, hitFallback: true };
    }

    it("finds path for short distances without fallback", () => {
      const flatHeight = () => 10;
      const result = findPathOptimized(0, 0, 200, 200, flatHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.path.length).toBeGreaterThan(2);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("finds path for medium distances (500 units) without fallback", () => {
      const flatHeight = () => 10;
      const result = findPathOptimized(0, 0, 500, 0, flatHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("finds path for long distances (1000 units) without fallback", () => {
      const flatHeight = () => 10;
      const result = findPathOptimized(0, 0, 1000, 0, flatHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("finds path for very long distances (2000 units) without fallback", () => {
      const flatHeight = () => 10;
      const result = findPathOptimized(0, 0, 2000, 0, flatHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("finds diagonal path (1500 units) without fallback", () => {
      const flatHeight = () => 10;
      const result = findPathOptimized(0, 0, 1000, 1000, flatHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("handles varied terrain biomes efficiently", () => {
      const flatHeight = () => 10;
      // Checkerboard of different biomes
      const biome = (x: number, z: number) => {
        const tx = Math.floor(x / 50);
        const tz = Math.floor(z / 50);
        const biomes = ["plains", "forest", "desert", "mountains"];
        return biomes[(tx + tz) % biomes.length];
      };

      const result = findPathOptimized(0, 0, 800, 800, flatHeight, biome);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("handles sloped terrain efficiently", () => {
      // Terrain with gentle hills
      const hillyHeight = (x: number, z: number) =>
        10 + Math.sin(x / 100) * 5 + Math.cos(z / 100) * 5;

      const result = findPathOptimized(0, 0, 1000, 500, hillyHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
    });

    it("avoids water obstacles efficiently", () => {
      // Water in the middle, forcing path around
      const waterHeight = (x: number, z: number) => {
        const inWaterZone = x > 200 && x < 300 && z > -100 && z < 500;
        return inWaterZone ? WATER_THRESHOLD - 1 : 10;
      };

      const result = findPathOptimized(0, 200, 500, 200, waterHeight);

      expect(result.hitFallback).toBe(false);
      expect(result.iterations).toBeLessThan(MAX_PATH_ITERATIONS);
      // Path should go around water, making it longer than direct
      expect(result.path.length).toBeGreaterThan(500 / PATH_STEP_SIZE);
    });

    it("completes 20 paths quickly (simulates connecting towns)", () => {
      const flatHeight = () => 10;

      // Generate random town positions
      const towns: Array<{ x: number; z: number }> = [];
      let seed = 12345;
      for (let i = 0; i < 10; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const x = (seed % 3000) - 1500;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const z = (seed % 3000) - 1500;
        towns.push({ x, z });
      }

      const results: Array<{ iterations: number; hitFallback: boolean }> = [];
      const startTime = performance.now();

      // Connect each town to closest 2 neighbors (simulates MST + extras)
      for (let i = 0; i < towns.length; i++) {
        for (let j = i + 1; j < Math.min(i + 3, towns.length); j++) {
          const result = findPathOptimized(
            towns[i].x,
            towns[i].z,
            towns[j].x,
            towns[j].z,
            flatHeight,
          );
          results.push({
            iterations: result.iterations,
            hitFallback: result.hitFallback,
          });
        }
      }

      const elapsed = performance.now() - startTime;

      // No paths should hit fallback
      const fallbackCount = results.filter((r) => r.hitFallback).length;
      expect(fallbackCount).toBe(0);

      // Total time should be reasonable (< 500ms for 20 paths)
      expect(elapsed).toBeLessThan(500);

      // Average iterations should be well below max
      const avgIterations =
        results.reduce((sum, r) => sum + r.iterations, 0) / results.length;
      expect(avgIterations).toBeLessThan(MAX_PATH_ITERATIONS / 2);
    });

    it("binary heap maintains correct ordering", () => {
      const heap = new PathNodeHeap();

      // Add nodes in random order
      const values = [50, 20, 80, 10, 60, 30, 90, 40, 70];
      for (let i = 0; i < values.length; i++) {
        heap.push({
          x: i,
          z: 0,
          g: 0,
          h: values[i],
          f: values[i],
          parent: null,
          heapIndex: 0,
        });
      }

      // Extract should give sorted order
      const extracted: number[] = [];
      while (heap.length > 0) {
        extracted.push(heap.pop()!.f);
      }

      // Should be in ascending order
      for (let i = 1; i < extracted.length; i++) {
        expect(extracted[i]).toBeGreaterThanOrEqual(extracted[i - 1]);
      }
    });

    it("heap update correctly reorders nodes", () => {
      const heap = new PathNodeHeap();

      const nodes: HeapPathNode[] = [];
      for (let i = 0; i < 5; i++) {
        const node: HeapPathNode = {
          x: i,
          z: 0,
          g: 0,
          h: (i + 1) * 10,
          f: (i + 1) * 10,
          parent: null,
          heapIndex: 0,
        };
        nodes.push(node);
        heap.push(node);
      }

      // Update middle node to be smallest
      nodes[2].f = 5;
      heap.updateNode(nodes[2]);

      // Should now be first
      const first = heap.pop()!;
      expect(first.x).toBe(2);
      expect(first.f).toBe(5);
    });
  });
});
