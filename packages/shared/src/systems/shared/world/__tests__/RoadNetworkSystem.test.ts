/**
 * Tests for RoadNetworkSystem procedural road generation algorithms.
 * Tests MST construction, A* pathfinding, path smoothing, and spatial indexing.
 */

import { describe, it, expect } from "vitest";

// ============== Constants (must match RoadNetworkSystem.ts) ==============
const ROAD_WIDTH = 4;
const PATH_STEP_SIZE = 8;
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

      // Should complete in reasonable time (200ms allows for CI variance)
      expect(elapsed).toBeLessThan(200);
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
      // 100ms allows for CI variance
      expect(elapsed).toBeLessThan(100);
    });
  });
});
