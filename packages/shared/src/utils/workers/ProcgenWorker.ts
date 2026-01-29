/**
 * ProcgenWorker - Web Worker for CPU-intensive procedural generation
 *
 * Offloads heavy computation to worker threads:
 * - A* pathfinding for road generation
 * - Road influence calculation for terrain vertices
 * - Building layout generation
 *
 * Communication:
 * - Input: { type: 'findPath' | 'calculateRoadInfluence' | ... }
 * - Output: { type: 'result', ... }
 */

import { WorkerPool } from "./WorkerPool";

// ============================================================================
// Types
// ============================================================================

export interface PathNode {
  x: number;
  z: number;
  g: number; // Cost from start
  h: number; // Heuristic to goal
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

export interface PathfindInput {
  type: "findPath";
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  stepSize: number;
  maxIterations: number;
  heuristicWeight: number;
  /** Height data for slope calculation */
  heightData?: {
    getHeight: "terrain"; // Marker for using terrain height lookup
    tileSize: number;
    resolution: number;
  };
  /** Cost configuration */
  costs: {
    base: number;
    slopeMultiplier: number;
    waterPenalty: number;
    waterLevel: number;
  };
}

export interface PathfindOutput {
  type: "pathResult";
  path: Array<{ x: number; z: number }>;
  success: boolean;
  iterations: number;
  nodesExplored: number;
}

export interface RoadInfluenceInput {
  type: "calculateRoadInfluence";
  /** Vertex positions (x, z pairs) */
  vertices: Float32Array;
  /** Road segments as [x1, z1, x2, z2, width] */
  roadSegments: Float32Array;
  roadWidth: number;
}

export interface RoadInfluenceOutput {
  type: "roadInfluenceResult";
  /** Influence value per vertex (0-1) */
  influences: Float32Array;
}

export interface SmoothPathInput {
  type: "smoothPath";
  path: Array<{ x: number; z: number }>;
  iterations: number;
  noiseScale: number;
  noiseStrength: number;
  seed: number;
}

export interface SmoothPathOutput {
  type: "smoothPathResult";
  path: Array<{ x: number; z: number }>;
}

export type ProcgenWorkerInput =
  | PathfindInput
  | RoadInfluenceInput
  | SmoothPathInput;
export type ProcgenWorkerOutput =
  | PathfindOutput
  | RoadInfluenceOutput
  | SmoothPathOutput;

// ============================================================================
// Worker Code
// ============================================================================

const PROCGEN_WORKER_CODE = `
// A* pathfinding with terrain cost
function findPath(input) {
  const { startX, startZ, endX, endZ, stepSize, maxIterations, heuristicWeight, costs } = input;
  
  // Direction vectors for 8-directional movement
  const directions = [
    { dx: stepSize, dz: 0 },
    { dx: -stepSize, dz: 0 },
    { dx: 0, dz: stepSize },
    { dx: 0, dz: -stepSize },
    { dx: stepSize, dz: stepSize },
    { dx: stepSize, dz: -stepSize },
    { dx: -stepSize, dz: stepSize },
    { dx: -stepSize, dz: -stepSize },
  ];
  
  // Priority queue (min-heap) for open set
  class MinHeap {
    constructor() {
      this.data = [];
      this.indices = new Map(); // key -> index for O(1) lookup
    }
    
    key(node) { return node.x + "_" + node.z; }
    
    push(node) {
      const k = this.key(node);
      if (this.indices.has(k)) {
        // Update existing node if better
        const idx = this.indices.get(k);
        if (node.f < this.data[idx].f) {
          this.data[idx] = node;
          this.bubbleUp(idx);
        }
        return;
      }
      this.data.push(node);
      this.indices.set(k, this.data.length - 1);
      this.bubbleUp(this.data.length - 1);
    }
    
    pop() {
      if (this.data.length === 0) return null;
      const min = this.data[0];
      const end = this.data.pop();
      this.indices.delete(this.key(min));
      if (this.data.length > 0 && end) {
        this.data[0] = end;
        this.indices.set(this.key(end), 0);
        this.bubbleDown(0);
      }
      return min;
    }
    
    isEmpty() { return this.data.length === 0; }
    
    has(x, z) { return this.indices.has(x + "_" + z); }
    
    bubbleUp(idx) {
      while (idx > 0) {
        const parent = Math.floor((idx - 1) / 2);
        if (this.data[parent].f <= this.data[idx].f) break;
        this.swap(parent, idx);
        idx = parent;
      }
    }
    
    bubbleDown(idx) {
      const length = this.data.length;
      while (true) {
        const left = 2 * idx + 1;
        const right = 2 * idx + 2;
        let smallest = idx;
        if (left < length && this.data[left].f < this.data[smallest].f) smallest = left;
        if (right < length && this.data[right].f < this.data[smallest].f) smallest = right;
        if (smallest === idx) break;
        this.swap(smallest, idx);
        idx = smallest;
      }
    }
    
    swap(i, j) {
      const ki = this.key(this.data[i]);
      const kj = this.key(this.data[j]);
      [this.data[i], this.data[j]] = [this.data[j], this.data[i]];
      this.indices.set(ki, j);
      this.indices.set(kj, i);
    }
  }
  
  // Heuristic: Euclidean distance
  function heuristic(x, z) {
    const dx = endX - x;
    const dz = endZ - z;
    return Math.sqrt(dx * dx + dz * dz) * heuristicWeight;
  }
  
  // Movement cost (simplified - no terrain height lookup in worker)
  function movementCost(fromX, fromZ, toX, toZ) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist * costs.base;
  }
  
  const openSet = new MinHeap();
  const closedSet = new Set();
  
  const startNode = {
    x: startX,
    z: startZ,
    g: 0,
    h: heuristic(startX, startZ),
    f: heuristic(startX, startZ),
    parent: null,
  };
  openSet.push(startNode);
  
  let iterations = 0;
  let nodesExplored = 0;
  
  while (!openSet.isEmpty() && iterations < maxIterations) {
    iterations++;
    const current = openSet.pop();
    if (!current) break;
    
    const key = current.x + "_" + current.z;
    if (closedSet.has(key)) continue;
    closedSet.add(key);
    nodesExplored++;
    
    // Check if reached goal (within step size)
    const goalDx = current.x - endX;
    const goalDz = current.z - endZ;
    if (goalDx * goalDx + goalDz * goalDz < stepSize * stepSize) {
      // Reconstruct path
      const path = [];
      let node = current;
      while (node) {
        path.unshift({ x: node.x, z: node.z });
        node = node.parent;
      }
      return { type: "pathResult", path, success: true, iterations, nodesExplored };
    }
    
    // Explore neighbors
    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const nz = current.z + dir.dz;
      const nkey = nx + "_" + nz;
      
      if (closedSet.has(nkey)) continue;
      
      const g = current.g + movementCost(current.x, current.z, nx, nz);
      const h = heuristic(nx, nz);
      
      openSet.push({
        x: nx,
        z: nz,
        g,
        h,
        f: g + h,
        parent: current,
      });
    }
  }
  
  // No path found
  return { type: "pathResult", path: [], success: false, iterations, nodesExplored };
}

// Calculate road influence for terrain vertices
function calculateRoadInfluence(input) {
  const { vertices, roadSegments, roadWidth } = input;
  const vertexCount = vertices.length / 2;
  const segmentCount = roadSegments.length / 5;
  const influences = new Float32Array(vertexCount);
  
  const halfWidth = roadWidth / 2;
  const edgeWidth = roadWidth * 0.3;
  const totalWidth = halfWidth + edgeWidth;
  const totalWidthSq = totalWidth * totalWidth;
  
  for (let vi = 0; vi < vertexCount; vi++) {
    const vx = vertices[vi * 2];
    const vz = vertices[vi * 2 + 1];
    
    let maxInfluence = 0;
    
    for (let si = 0; si < segmentCount; si++) {
      const x1 = roadSegments[si * 5];
      const z1 = roadSegments[si * 5 + 1];
      const x2 = roadSegments[si * 5 + 2];
      const z2 = roadSegments[si * 5 + 3];
      const segWidth = roadSegments[si * 5 + 4] || roadWidth;
      
      // Point to line segment distance
      const dx = x2 - x1;
      const dz = z2 - z1;
      const lenSq = dx * dx + dz * dz;
      
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((vx - x1) * dx + (vz - z1) * dz) / lenSq));
      }
      
      const closestX = x1 + t * dx;
      const closestZ = z1 + t * dz;
      const distSq = (vx - closestX) * (vx - closestX) + (vz - closestZ) * (vz - closestZ);
      
      if (distSq > totalWidthSq) continue;
      
      const dist = Math.sqrt(distSq);
      const segHalfWidth = segWidth / 2;
      
      let influence = 0;
      if (dist < segHalfWidth) {
        influence = 1.0;
      } else if (dist < segHalfWidth + edgeWidth) {
        influence = 1.0 - (dist - segHalfWidth) / edgeWidth;
      }
      
      maxInfluence = Math.max(maxInfluence, influence);
    }
    
    influences[vi] = maxInfluence;
  }
  
  return { type: "roadInfluenceResult", influences };
}

// Chaikin curve smoothing with noise
function smoothPath(input) {
  const { path, iterations, noiseScale, noiseStrength, seed } = input;
  
  if (path.length < 3) {
    return { type: "smoothPathResult", path };
  }
  
  // Simple noise function
  function noise(x, z, s) {
    const n = Math.sin(x * noiseScale + s) * Math.cos(z * noiseScale + s * 0.7);
    return n * noiseStrength;
  }
  
  let result = path.slice();
  
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed = [result[0]]; // Keep start point
    
    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];
      
      // Chaikin's algorithm: 25% and 75% points
      const q = {
        x: 0.75 * p0.x + 0.25 * p1.x + noise(p0.x, p0.z, seed + iter),
        z: 0.75 * p0.z + 0.25 * p1.z + noise(p0.z, p0.x, seed + iter + 100),
      };
      const r = {
        x: 0.25 * p0.x + 0.75 * p1.x + noise(p1.x, p1.z, seed + iter + 200),
        z: 0.25 * p0.z + 0.75 * p1.z + noise(p1.z, p1.x, seed + iter + 300),
      };
      
      smoothed.push(q, r);
    }
    
    smoothed.push(result[result.length - 1]); // Keep end point
    result = smoothed;
  }
  
  return { type: "smoothPathResult", path: result };
}

// Worker message handler
self.onmessage = function(e) {
  const input = e.data;
  
  try {
    let result;
    switch (input.type) {
      case "findPath":
        result = findPath(input);
        break;
      case "calculateRoadInfluence":
        result = calculateRoadInfluence(input);
        // Transfer ownership of typed arrays
        self.postMessage({ result }, [result.influences.buffer]);
        return;
      case "smoothPath":
        result = smoothPath(input);
        break;
      default:
        result = { error: "Unknown input type: " + input.type };
    }
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err.message || "Worker error" });
  }
};
`;

// ============================================================================
// Worker Pool Management
// ============================================================================

let procgenWorkerPool: WorkerPool<
  ProcgenWorkerInput,
  ProcgenWorkerOutput
> | null = null;
let workersChecked = false;
let workersAvailable = false;

/**
 * Check if procgen workers are available (client-side with Worker + Blob URL support)
 * Bun provides Worker and Blob but doesn't support blob URLs for workers
 */
export function isProcgenWorkerAvailable(): boolean {
  if (!workersChecked) {
    workersChecked = true;
    // Check basic Worker/Blob availability
    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      workersAvailable = false;
      return workersAvailable;
    }
    // Detect Bun runtime - Bun has Worker/Blob but blob URLs don't work for workers
    if (
      typeof process !== "undefined" &&
      process.versions &&
      "bun" in process.versions
    ) {
      workersAvailable = false;
      return workersAvailable;
    }
    // Detect Node.js runtime (no browser globals like window)
    if (typeof window === "undefined") {
      workersAvailable = false;
      return workersAvailable;
    }
    workersAvailable = true;
  }
  return workersAvailable;
}

/**
 * Get or create the procgen worker pool
 */
export function getProcgenWorkerPool(
  poolSize?: number,
): WorkerPool<ProcgenWorkerInput, ProcgenWorkerOutput> | null {
  if (!isProcgenWorkerAvailable()) {
    return null;
  }

  if (!procgenWorkerPool) {
    procgenWorkerPool = new WorkerPool<ProcgenWorkerInput, ProcgenWorkerOutput>(
      PROCGEN_WORKER_CODE,
      poolSize,
    );
  }
  return procgenWorkerPool;
}

/**
 * Find a path using A* in a worker (for PROCGEN/road generation only).
 *
 * NOTE: This is NOT used for game entity pathfinding (mobs, players).
 * Game pathfinding uses BFSPathfinder.findPath() synchronously because:
 * 1. Game paths are short (tiles, not km)
 * 2. Tile-based BFS is fast enough without worker overhead
 * 3. Game paths need immediate response (no async delay)
 *
 * This A* pathfinder is designed for procgen roads which:
 * - Span kilometers with 20m step size
 * - Consider terrain slopes and water penalties
 * - Can run async during world generation
 */
export async function findPathAsync(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  options: {
    stepSize?: number;
    maxIterations?: number;
    heuristicWeight?: number;
    costs?: {
      base?: number;
      slopeMultiplier?: number;
      waterPenalty?: number;
      waterLevel?: number;
    };
  } = {},
): Promise<PathfindOutput | null> {
  const pool = getProcgenWorkerPool();
  if (!pool) {
    return null;
  }

  return pool.execute({
    type: "findPath",
    startX,
    startZ,
    endX,
    endZ,
    stepSize: options.stepSize ?? 20,
    maxIterations: options.maxIterations ?? 10000,
    heuristicWeight: options.heuristicWeight ?? 2.5,
    costs: {
      base: options.costs?.base ?? 1.0,
      slopeMultiplier: options.costs?.slopeMultiplier ?? 5.0,
      waterPenalty: options.costs?.waterPenalty ?? 1000,
      waterLevel: options.costs?.waterLevel ?? 0,
    },
  }) as Promise<PathfindOutput>;
}

/**
 * Calculate road influence for terrain vertices in a worker
 */
export async function calculateRoadInfluenceAsync(
  vertices: Float32Array,
  roadSegments: Float32Array,
  roadWidth: number,
): Promise<RoadInfluenceOutput | null> {
  const pool = getProcgenWorkerPool();
  if (!pool) {
    return null;
  }

  // Copy arrays for transfer
  const verticesCopy = new Float32Array(vertices);
  const segmentsCopy = new Float32Array(roadSegments);

  return pool.execute(
    {
      type: "calculateRoadInfluence",
      vertices: verticesCopy,
      roadSegments: segmentsCopy,
      roadWidth,
    },
    [verticesCopy.buffer, segmentsCopy.buffer],
  ) as Promise<RoadInfluenceOutput>;
}

/**
 * Smooth a path using Chaikin's algorithm in a worker
 */
export async function smoothPathAsync(
  path: Array<{ x: number; z: number }>,
  options: {
    iterations?: number;
    noiseScale?: number;
    noiseStrength?: number;
    seed?: number;
  } = {},
): Promise<SmoothPathOutput | null> {
  const pool = getProcgenWorkerPool();
  if (!pool) {
    return null;
  }

  return pool.execute({
    type: "smoothPath",
    path,
    iterations: options.iterations ?? 2,
    noiseScale: options.noiseScale ?? 0.01,
    noiseStrength: options.noiseStrength ?? 3,
    seed: options.seed ?? 12345,
  }) as Promise<SmoothPathOutput>;
}

/**
 * Find multiple paths in parallel
 */
export async function findPathsBatch(
  routes: Array<{
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
  }>,
  options: {
    stepSize?: number;
    maxIterations?: number;
    heuristicWeight?: number;
  } = {},
): Promise<PathfindOutput[]> {
  const pool = getProcgenWorkerPool();
  if (!pool) {
    return [];
  }

  const tasks = routes.map((route) => ({
    data: {
      type: "findPath" as const,
      startX: route.startX,
      startZ: route.startZ,
      endX: route.endX,
      endZ: route.endZ,
      stepSize: options.stepSize ?? 20,
      maxIterations: options.maxIterations ?? 10000,
      heuristicWeight: options.heuristicWeight ?? 2.5,
      costs: {
        base: 1.0,
        slopeMultiplier: 5.0,
        waterPenalty: 1000,
        waterLevel: 0,
      },
    },
  }));

  return pool.executeAll(tasks) as Promise<PathfindOutput[]>;
}

/**
 * Terminate the procgen worker pool
 */
export function terminateProcgenWorkerPool(): void {
  if (procgenWorkerPool) {
    procgenWorkerPool.terminate();
    procgenWorkerPool = null;
  }
}
