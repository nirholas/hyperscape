/**
 * GrassWorker.ts - Web Worker for Grass Placement Computation
 *
 * Offloads CPU-intensive grass placement calculations to a worker thread:
 * - Grid-jittered placement for even distribution
 * - Noise-based density filtering
 * - Position candidate generation with deterministic RNG
 *
 * The main thread remains responsible for:
 * - Terrain height lookups (requires TerrainSystem)
 * - Building collision checks
 * - Slope/grassiness validation
 * - InstancedMesh attribute updates
 * - GPU operations
 *
 * Communication:
 * - Input: { type: 'generatePlacements', chunkKey, originX, originZ, size, baseDensity, seed }
 * - Output: { type: 'placementResult', chunkKey, placements: GrassPlacementData[] }
 */

import { WorkerPool } from "./WorkerPool";

// ============================================================================
// TYPES
// ============================================================================

export interface GrassPlacementData {
  /** World X position */
  x: number;
  /** World Z position */
  z: number;
  /** Height scale (0.7-1.3) */
  heightScale: number;
  /** Rotation in radians (0-2π) */
  rotation: number;
  /** Width scale (0.8-1.2) */
  widthScale: number;
  /** Color variation (0-1) */
  colorVar: number;
  /** Phase offset for wind animation (0-2π) */
  phaseOffset: number;
}

export interface GrassWorkerInput {
  type: "generatePlacements";
  /** Chunk key "x_z" */
  chunkKey: string;
  /** World X origin of chunk */
  originX: number;
  /** World Z origin of chunk */
  originZ: number;
  /** Chunk size in meters */
  size: number;
  /** Base density (instances per square meter) */
  baseDensity: number;
  /** Seed for deterministic generation */
  seed: number;
  /** Biome height multiplier (default 1.0) */
  heightMultiplier?: number;
  /** Maximum instances for this chunk */
  maxInstances?: number;
}

export interface GrassWorkerOutput {
  type: "placementResult";
  /** Chunk key matching input */
  chunkKey: string;
  /** Generated placements (position + variation data) */
  placements: GrassPlacementData[];
  /** Stats for debugging */
  stats: {
    candidatesGenerated: number;
    placementsCreated: number;
    timeMs: number;
  };
}

// ============================================================================
// WORKER CODE
// ============================================================================

/**
 * Inline worker code for grass placement generation
 * This code runs in a separate thread, isolated from the main thread.
 *
 * The worker generates candidate positions with variation data.
 * Height lookups, building checks, and grassiness validation happen on main thread.
 */
const GRASS_WORKER_CODE = `
// Deterministic PRNG for reproducible grass placement
function createRng(seed) {
  let state = seed >>> 0;
  return function() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

// Hash function for position-based seed derivation
function hashPosition(x, z) {
  const h1 = Math.imul(Math.floor(x * 100) ^ 0x85ebca6b, 0x85ebca6b);
  const h2 = Math.imul(Math.floor(z * 100) ^ 0xc2b2ae35, 0xc2b2ae35);
  return Math.abs((h1 ^ h2) | 0);
}

// Simple 2D value noise for density variation
function noise2D(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  
  // Smooth interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  
  // Hash corners using simple PRNG
  function hash(a, b) {
    let h = a * 374761393 + b * 668265263 + seed;
    h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
    return (h & 0xFFFFFF) / 0xFFFFFF;
  }
  
  const h00 = hash(ix, iz);
  const h10 = hash(ix + 1, iz);
  const h01 = hash(ix, iz + 1);
  const h11 = hash(ix + 1, iz + 1);
  
  // Bilinear interpolation
  const v0 = h00 + sx * (h10 - h00);
  const v1 = h01 + sx * (h11 - h01);
  return v0 + sz * (v1 - v0);
}

/**
 * Main placement generation function
 * Generates grid-jittered positions with instance variation data
 */
function generatePlacements(input) {
  const startTime = performance.now();
  const { chunkKey, originX, originZ, size, baseDensity, seed, heightMultiplier = 1.0, maxInstances = 131072 } = input;
  
  const placements = [];
  let candidatesGenerated = 0;
  
  // Calculate instance count
  const instanceCount = Math.min(
    Math.floor(size * size * baseDensity),
    maxInstances
  );
  
  if (instanceCount === 0) {
    return {
      type: "placementResult",
      chunkKey,
      placements: [],
      stats: { candidatesGenerated: 0, placementsCreated: 0, timeMs: performance.now() - startTime }
    };
  }
  
  // Deterministic RNG for this chunk
  const chunkSeed = hashPosition(originX, originZ) ^ seed;
  let rngState = chunkSeed;
  const nextRandom = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  
  const spacing = Math.sqrt(1 / baseDensity);
  
  // Grid-jittered placement for even distribution
  for (let gx = 0; gx < size && placements.length < instanceCount; gx += spacing) {
    for (let gz = 0; gz < size && placements.length < instanceCount; gz += spacing) {
      candidatesGenerated++;
      
      // Jitter position within grid cell
      const jitterX = (nextRandom() - 0.5) * spacing * 0.8;
      const jitterZ = (nextRandom() - 0.5) * spacing * 0.8;
      
      const worldX = originX + gx + jitterX;
      const worldZ = originZ + gz + jitterZ;
      
      // Basic noise-based density variation (coarse filtering)
      const noiseVal = noise2D(worldX * 0.1, worldZ * 0.1, chunkSeed);
      if (noiseVal < 0.15) continue; // Skip sparse areas
      
      // Instance variation
      const heightScale = (0.7 + nextRandom() * 0.6) * heightMultiplier;
      const rotation = nextRandom() * Math.PI * 2;
      const widthScale = 0.8 + nextRandom() * 0.4;
      const colorVar = nextRandom();
      const phaseOffset = nextRandom() * Math.PI * 2;
      
      placements.push({
        x: worldX,
        z: worldZ,
        heightScale,
        rotation,
        widthScale,
        colorVar,
        phaseOffset
      });
    }
  }
  
  return {
    type: "placementResult",
    chunkKey,
    placements,
    stats: {
      candidatesGenerated,
      placementsCreated: placements.length,
      timeMs: performance.now() - startTime
    }
  };
}

// Worker message handler
// CRITICAL: Must match WorkerPool's expected message format:
// - Success: { result: <data> }
// - Error: { error: <message> }
self.onmessage = function(e) {
  const input = e.data;
  
  try {
    if (input.type === "generatePlacements") {
      const result = generatePlacements(input);
      self.postMessage({ result });
    } else {
      self.postMessage({ error: "Unknown message type: " + input.type });
    }
  } catch (err) {
    self.postMessage({ error: err.message || "Grass worker error" });
  }
};
`;

// ============================================================================
// WORKER POOL MANAGEMENT
// ============================================================================

/** Singleton worker pool for grass placement */
let grassWorkerPool: WorkerPool<GrassWorkerInput, GrassWorkerOutput> | null =
  null;

/** Track if workers are available */
let workersChecked = false;
let workersAvailable = false;

/**
 * Check if grass workers are available (client-side with Worker + Blob URL support)
 * Bun provides Worker and Blob but doesn't support blob URLs for workers
 */
export function isGrassWorkerAvailable(): boolean {
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
 * Get or create the grass worker pool
 * @param poolSize - Number of workers (defaults to CPU cores - 1)
 * @returns Worker pool, or null if workers unavailable (server-side)
 */
export function getGrassWorkerPool(
  poolSize?: number,
): WorkerPool<GrassWorkerInput, GrassWorkerOutput> | null {
  if (!isGrassWorkerAvailable()) {
    return null;
  }

  if (!grassWorkerPool) {
    grassWorkerPool = new WorkerPool<GrassWorkerInput, GrassWorkerOutput>(
      GRASS_WORKER_CODE,
      poolSize,
    );
  }
  return grassWorkerPool;
}

/**
 * Generate grass placements using web worker
 * Returns immediately with a promise that resolves when the worker completes
 * Returns null if workers are not available
 */
export async function generateGrassPlacementsAsync(
  chunkKey: string,
  originX: number,
  originZ: number,
  size: number,
  baseDensity: number,
  seed: number,
  heightMultiplier?: number,
  maxInstances?: number,
): Promise<GrassWorkerOutput | null> {
  const pool = getGrassWorkerPool();
  if (!pool) {
    return null;
  }
  return pool.execute({
    type: "generatePlacements",
    chunkKey,
    originX,
    originZ,
    size,
    baseDensity,
    seed,
    heightMultiplier,
    maxInstances,
  });
}

/**
 * Result of batch grass generation
 */
export interface GrassBatchResult {
  /** Successfully generated chunks */
  results: GrassWorkerOutput[];
  /** Whether workers were available */
  workersAvailable: boolean;
  /** Number of chunks that failed to generate */
  failedCount: number;
}

/**
 * Generate multiple chunks in parallel using worker pool
 */
export async function generateGrassChunksBatch(
  chunks: Array<{
    chunkKey: string;
    originX: number;
    originZ: number;
    size: number;
  }>,
  baseDensity: number,
  seed: number,
  heightMultiplier?: number,
  maxInstances?: number,
): Promise<GrassBatchResult> {
  const pool = getGrassWorkerPool();
  if (!pool) {
    return { results: [], workersAvailable: false, failedCount: chunks.length };
  }

  const results: GrassWorkerOutput[] = [];
  let failedCount = 0;

  // Execute all chunks in parallel using the worker pool
  const promises = chunks.map((chunk) =>
    pool
      .execute({
        type: "generatePlacements",
        chunkKey: chunk.chunkKey,
        originX: chunk.originX,
        originZ: chunk.originZ,
        size: chunk.size,
        baseDensity,
        seed,
        heightMultiplier,
        maxInstances,
      })
      .then((result) => {
        results.push(result);
      })
      .catch(() => {
        failedCount++;
      }),
  );

  await Promise.all(promises);

  return { results, workersAvailable: true, failedCount };
}

/**
 * Terminate the grass worker pool
 */
export function terminateGrassWorkerPool(): void {
  if (grassWorkerPool) {
    grassWorkerPool.terminate();
    grassWorkerPool = null;
  }
}
