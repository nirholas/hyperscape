/**
 * VegetationWorker.ts - Web Worker for Vegetation Placement Computation
 *
 * Offloads CPU-intensive vegetation placement calculations to a worker thread:
 * - Noise-based density filtering
 * - Clustering algorithms
 * - Minimum spacing validation
 * - Position candidate generation
 *
 * The main thread remains responsible for:
 * - GLB loading (requires three.js context)
 * - InstancedMesh creation and management
 * - GPU operations
 *
 * Communication:
 * - Input: { type: 'generatePlacements', tileKey, tileWorldX, tileWorldZ, tileSize, layers, seed }
 * - Output: { type: 'placementResult', tileKey, placements: PlacementData[] }
 */

import { WorkerPool } from "./WorkerPool";

// Types for vegetation placement
export interface VegetationLayerInput {
  category: string;
  assets: Array<{
    id: string;
    weight: number;
    scaleMin: number;
    scaleMax: number;
    randomRotation: boolean;
    alignToNormal: boolean;
    yOffset: number;
  }>;
  density: number;
  minSpacing: number;
  noiseScale?: number;
  noiseThreshold?: number;
  clustering?: boolean;
  clusterSize?: number;
  minHeight?: number;
  maxHeight?: number;
  maxSlope?: number;
  avoidWater?: boolean;
}

export interface PlacementData {
  assetId: string;
  category: string;
  x: number;
  z: number;
  scale: number;
  rotationY: number;
}

export interface VegetationWorkerInput {
  type: "generatePlacements";
  tileKey: string;
  tileWorldX: number;
  tileWorldZ: number;
  tileSize: number;
  layers: VegetationLayerInput[];
  seed: number;
  /** Optional height data for terrain validation (Float32Array transferred) */
  heightData?: Float32Array;
  heightDataSize?: number;
}

export interface VegetationWorkerOutput {
  type: "placementResult";
  tileKey: string;
  placements: PlacementData[];
  /** Stats for debugging */
  stats: {
    candidatesGenerated: number;
    candidatesRejected: number;
    placementsCreated: number;
    layersProcessed: number;
  };
}

/**
 * Inline worker code for vegetation placement
 * This code runs in a separate thread, isolated from the main thread.
 */
const VEGETATION_WORKER_CODE = `
// Deterministic PRNG for reproducible vegetation placement
function createRng(seed) {
  let state = seed >>> 0;
  return function() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

// Hash function for tile/layer seed derivation
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

// Simple 2D noise for density variation (Perlin-like)
function noise2D(x, z, seed) {
  // Simple value noise implementation
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  
  // Smooth interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  
  // Hash corners
  const h00 = hashString(ix + "_" + iz + "_" + seed) / 0xFFFFFFFF;
  const h10 = hashString((ix + 1) + "_" + iz + "_" + seed) / 0xFFFFFFFF;
  const h01 = hashString(ix + "_" + (iz + 1) + "_" + seed) / 0xFFFFFFFF;
  const h11 = hashString((ix + 1) + "_" + (iz + 1) + "_" + seed) / 0xFFFFFFFF;
  
  // Bilinear interpolation
  const v0 = h00 + sx * (h10 - h00);
  const v1 = h01 + sx * (h11 - h01);
  return v0 + sz * (v1 - v0);
}

// Select weighted asset from array
function selectWeightedAsset(assets, totalWeight, rng) {
  let random = rng() * totalWeight;
  for (const asset of assets) {
    random -= asset.weight;
    if (random <= 0) return asset;
  }
  return assets[assets.length - 1];
}

/**
 * SpatialHashGrid - O(1) average case spatial queries instead of O(n²)
 * Uses a grid of cells where each cell contains positions within that cell.
 * Only checks 9 neighboring cells for spacing validation.
 */
class SpatialHashGrid {
  constructor(cellSize, minX, minZ, maxX, maxZ) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.minX = minX;
    this.minZ = minZ;
    // Pre-compute grid dimensions
    this.gridWidth = Math.ceil((maxX - minX) * this.invCellSize) + 1;
    this.gridHeight = Math.ceil((maxZ - minZ) * this.invCellSize) + 1;
    // Use Map for sparse storage (most cells will be empty)
    this.cells = new Map();
  }
  
  // Convert world position to cell key (single integer for fast Map lookup)
  getCellKey(x, z) {
    const cellX = Math.floor((x - this.minX) * this.invCellSize);
    const cellZ = Math.floor((z - this.minZ) * this.invCellSize);
    return cellX + cellZ * this.gridWidth;
  }
  
  // Insert a position into the grid
  insert(x, z) {
    const key = this.getCellKey(x, z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push({ x, z });
  }
  
  // Check if any position in the grid is within minSpacing of (x, z)
  // Only checks 9 neighboring cells - O(k) where k is average items per 9 cells
  hasNearby(x, z, minSpacingSq) {
    const cellX = Math.floor((x - this.minX) * this.invCellSize);
    const cellZ = Math.floor((z - this.minZ) * this.invCellSize);
    
    // Check 3x3 neighborhood of cells
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = (cellX + dx) + (cellZ + dz) * this.gridWidth;
        const cell = this.cells.get(key);
        if (!cell) continue;
        
        // Check all positions in this cell
        for (let i = 0; i < cell.length; i++) {
          const pos = cell[i];
          const ddx = pos.x - x;
          const ddz = pos.z - z;
          if (ddx * ddx + ddz * ddz < minSpacingSq) {
            return true;
          }
        }
      }
    }
    return false;
  }
  
  // Clear the grid for reuse
  clear() {
    this.cells.clear();
  }
}

// Main placement generation
function generatePlacements(input) {
  const { tileKey, tileWorldX, tileWorldZ, tileSize, layers, seed } = input;
  const placements = [];
  const stats = {
    candidatesGenerated: 0,
    candidatesRejected: 0,
    placementsCreated: 0,
    layersProcessed: 0
  };

  for (const layer of layers) {
    stats.layersProcessed++;
    
    // Create deterministic RNG for this tile/layer
    const layerSeed = hashString(tileKey + "_" + layer.category) ^ seed;
    const rng = createRng(layerSeed);
    
    // Calculate target count based on density
    const targetCount = Math.floor(layer.density * (tileSize / 100) ** 2);
    const noiseScale = layer.noiseScale || 0.05;
    const noiseThreshold = layer.noiseThreshold || 0.3;
    const minSpacing = layer.minSpacing;
    const minSpacingSq = minSpacing * minSpacing;
    
    // Calculate total weight for weighted selection
    const totalWeight = layer.assets.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight === 0) continue;
    
    // Create spatial hash grid for O(1) average spacing checks
    // Cell size = minSpacing ensures we only need to check 3x3 neighborhood
    const grid = new SpatialHashGrid(
      minSpacing,
      tileWorldX,
      tileWorldZ,
      tileWorldX + tileSize,
      tileWorldZ + tileSize
    );
    
    // Generate more candidates than needed, then filter
    const maxCandidates = targetCount * 3;
    let placedCount = 0;
    
    for (let i = 0; i < maxCandidates && placedCount < targetCount; i++) {
      stats.candidatesGenerated++;
      
      let x, z;
      
      if (layer.clustering && layer.clusterSize) {
        // Clustering: generate cluster centers, then scatter around them
        const clusterCount = Math.max(1, Math.floor(targetCount / layer.clusterSize));
        const clusterIndex = Math.floor(rng() * clusterCount);
        
        // Deterministic cluster center
        const clusterRng = createRng(hashString(tileKey + "_cluster_" + clusterIndex + "_" + layer.category) ^ seed);
        const clusterCenterX = tileWorldX + tileSize * 0.1 + clusterRng() * tileSize * 0.8;
        const clusterCenterZ = tileWorldZ + tileSize * 0.1 + clusterRng() * tileSize * 0.8;
        
        // Scatter around cluster center
        const angle = rng() * Math.PI * 2;
        const radius = rng() * rng() * minSpacing * layer.clusterSize;
        x = clusterCenterX + Math.cos(angle) * radius;
        z = clusterCenterZ + Math.sin(angle) * radius;
      } else {
        // Uniform random distribution
        x = tileWorldX + rng() * tileSize;
        z = tileWorldZ + rng() * tileSize;
      }
      
      // Ensure within tile bounds
      if (x < tileWorldX || x >= tileWorldX + tileSize ||
          z < tileWorldZ || z >= tileWorldZ + tileSize) {
        stats.candidatesRejected++;
        continue;
      }
      
      // Noise-based filtering
      const noiseValue = noise2D(x * noiseScale, z * noiseScale, layerSeed);
      if (noiseValue < noiseThreshold) {
        stats.candidatesRejected++;
        continue;
      }
      
      // Minimum spacing check using spatial hash grid - O(1) average case
      if (grid.hasNearby(x, z, minSpacingSq)) {
        stats.candidatesRejected++;
        continue;
      }
      
      // Select asset using weighted random
      const asset = selectWeightedAsset(layer.assets, totalWeight, rng);
      
      // Generate scale
      const scale = asset.scaleMin + rng() * (asset.scaleMax - asset.scaleMin);
      
      // Generate rotation
      const rotationY = asset.randomRotation ? rng() * Math.PI * 2 : 0;
      
      // Create placement
      placements.push({
        assetId: asset.id,
        category: layer.category,
        x,
        z,
        scale,
        rotationY
      });
      
      // Insert into spatial grid for future spacing checks
      grid.insert(x, z);
      placedCount++;
      stats.placementsCreated++;
    }
  }
  
  return {
    type: "placementResult",
    tileKey,
    placements,
    stats
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
      // Wrap in WorkerPool-expected format
      self.postMessage({ result });
    } else {
      self.postMessage({ error: "Unknown message type: " + input.type });
    }
  } catch (err) {
    self.postMessage({ error: err.message || "Vegetation worker error" });
  }
};
`;

/** Singleton worker pool for vegetation placement */
let vegetationWorkerPool: WorkerPool<
  VegetationWorkerInput,
  VegetationWorkerOutput
> | null = null;

/** Track if workers are available */
let workersChecked = false;
let workersAvailable = false;

/**
 * Check if vegetation workers are available (client-side with Worker + Blob URL support)
 * Bun provides Worker and Blob but doesn't support blob URLs for workers
 */
export function isVegetationWorkerAvailable(): boolean {
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
 * Get or create the vegetation worker pool
 * @param poolSize - Number of workers (defaults to CPU cores - 1)
 * @returns Worker pool, or null if workers unavailable (server-side)
 */
export function getVegetationWorkerPool(
  poolSize?: number,
): WorkerPool<VegetationWorkerInput, VegetationWorkerOutput> | null {
  if (!isVegetationWorkerAvailable()) {
    return null;
  }

  if (!vegetationWorkerPool) {
    vegetationWorkerPool = new WorkerPool<
      VegetationWorkerInput,
      VegetationWorkerOutput
    >(VEGETATION_WORKER_CODE, poolSize);
  }
  return vegetationWorkerPool;
}

/**
 * Generate vegetation placements using web worker
 * Returns immediately with a promise that resolves when the worker completes
 * Returns null if workers are not available
 */
export async function generateVegetationPlacementsAsync(
  tileKey: string,
  tileWorldX: number,
  tileWorldZ: number,
  tileSize: number,
  layers: VegetationLayerInput[],
  seed: number,
): Promise<VegetationWorkerOutput | null> {
  const pool = getVegetationWorkerPool();
  if (!pool) {
    return null;
  }
  return pool.execute({
    type: "generatePlacements",
    tileKey,
    tileWorldX,
    tileWorldZ,
    tileSize,
    layers,
    seed,
  });
}

/**
 * Result of batch vegetation generation
 */
export interface VegetationBatchResult {
  /** Successfully generated tiles */
  results: VegetationWorkerOutput[];
  /** Whether workers were available */
  workersAvailable: boolean;
  /** Number of tiles that failed to generate */
  failedCount: number;
}

/**
 * Generate multiple tiles in parallel using worker pool
 */
export async function generateVegetationTilesBatch(
  tiles: Array<{
    tileKey: string;
    tileWorldX: number;
    tileWorldZ: number;
    tileSize: number;
  }>,
  layers: VegetationLayerInput[],
  seed: number,
): Promise<VegetationBatchResult> {
  const pool = getVegetationWorkerPool();
  if (!pool) {
    return { results: [], workersAvailable: false, failedCount: tiles.length };
  }

  const results: VegetationWorkerOutput[] = [];
  let failedCount = 0;

  // Execute all tiles in parallel using the worker pool
  const promises = tiles.map((tile) =>
    pool
      .execute({
        type: "generatePlacements",
        tileKey: tile.tileKey,
        tileWorldX: tile.tileWorldX,
        tileWorldZ: tile.tileWorldZ,
        tileSize: tile.tileSize,
        layers,
        seed,
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
 * Terminate the vegetation worker pool
 */
export function terminateVegetationWorkerPool(): void {
  if (vegetationWorkerPool) {
    vegetationWorkerPool.terminate();
    vegetationWorkerPool = null;
  }
}
