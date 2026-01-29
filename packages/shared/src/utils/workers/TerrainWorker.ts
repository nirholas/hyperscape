/**
 * TerrainWorker - Offloads terrain heightmap generation to Web Worker
 *
 * Heavy terrain calculations (noise, biome blending) run in parallel,
 * freeing the main thread for rendering.
 *
 * Message Protocol:
 * - Input: { type: 'generateHeightmap', tileX, tileZ, config, seed }
 * - Output: { type: 'heightmapResult', tileKey, heightData, colorData, biomeData }
 */

import { WorkerPool } from "./WorkerPool";

// Types for terrain generation
// MUST match TerrainSystem.CONFIG exactly for height and biome calculation
export interface TerrainWorkerConfig {
  TILE_SIZE: number;
  TILE_RESOLUTION: number;
  MAX_HEIGHT: number;
  // Biome calculation - MUST match TerrainSystem.getBiomeInfluencesAtPosition()
  BIOME_GAUSSIAN_COEFF: number;
  BIOME_BOUNDARY_NOISE_SCALE: number;
  BIOME_BOUNDARY_NOISE_AMOUNT: number;
  MOUNTAIN_HEIGHT_THRESHOLD: number;
  MOUNTAIN_WEIGHT_BOOST: number;
  VALLEY_HEIGHT_THRESHOLD: number;
  VALLEY_WEIGHT_BOOST: number;
  // Mountain height boost - MUST match TerrainSystem.getHeightAtWithoutShore()
  MOUNTAIN_HEIGHT_BOOST: number;
  // Shoreline config - MUST match TerrainSystem.getHeightAt() and createTileGeometry()
  WATER_THRESHOLD: number;
  WATER_LEVEL_NORMALIZED: number;
  SHORELINE_THRESHOLD: number;
  SHORELINE_STRENGTH: number;
}

export interface TerrainWorkerInput {
  type: "generateHeightmap";
  tileX: number;
  tileZ: number;
  config: TerrainWorkerConfig;
  seed: number;
  biomeCenters: Array<{
    x: number;
    z: number;
    type: string;
    influence: number;
  }>;
  biomes: Record<
    string,
    {
      heightModifier: number;
      color: { r: number; g: number; b: number };
    }
  >;
}

export interface TerrainWorkerOutput {
  type: "heightmapResult";
  tileKey: string;
  tileX: number;
  tileZ: number;
  /** Height values as Float32Array (resolution * resolution) */
  heightData: Float32Array;
  /** RGB color values as Float32Array (resolution * resolution * 3) */
  colorData: Float32Array;
  /** Biome IDs as Uint8Array (resolution * resolution) */
  biomeData: Uint8Array;
}

/**
 * Inline worker code for terrain generation
 *
 * CRITICAL: This code MUST exactly match TerrainSystem.getBaseHeightAt()
 * Any differences will produce visibly different terrain!
 *
 * Copied from: packages/shared/src/systems/shared/world/TerrainSystem.ts
 */
const TERRAIN_WORKER_CODE = `
// NoiseGenerator - exact copy from packages/shared/src/utils/NoiseGenerator.ts
class NoiseGenerator {
  constructor(seed = 12345) {
    this.permutation = [];
    this.p = [];
    this.initializePermutation(seed);
  }

  initializePermutation(seed) {
    const perm = Array.from({ length: 256 }, (_, i) => i);
    let random = seed;
    for (let i = perm.length - 1; i > 0; i--) {
      random = (random * 1664525 + 1013904223) % 4294967296;
      const j = Math.floor((random / 4294967296) * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    this.permutation = perm;
    this.p = [...perm, ...perm];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(t, a, b) { return a + t * (b - a); }
  grad2D(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  perlin2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const A = this.p[X] + Y;
    const AA = this.p[A];
    const AB = this.p[A + 1];
    const B = this.p[X + 1] + Y;
    const BA = this.p[B];
    const BB = this.p[B + 1];
    const result = this.lerp(v,
      this.lerp(u, this.grad2D(this.p[AA], x, y), this.grad2D(this.p[BA], x - 1, y)),
      this.lerp(u, this.grad2D(this.p[AB], x, y - 1), this.grad2D(this.p[BB], x - 1, y - 1))
    );
    return Math.max(-1, Math.min(1, result));
  }

  gradSimplex2D(hash, x, y) {
    const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    return grad3[hash % 12][0] * x + grad3[hash % 12][1] * y;
  }

  simplex2D(x, y) {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.p[ii + this.p[jj]] % 12;
    const gi1 = this.p[ii + i1 + this.p[jj + j1]] % 12;
    const gi2 = this.p[ii + 1 + this.p[jj + 1]] % 12;
    let n0, n1, n2;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else { t0 *= t0; n0 = t0 * t0 * this.gradSimplex2D(gi0, x0, y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else { t1 *= t1; n1 = t1 * t1 * this.gradSimplex2D(gi1, x1, y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else { t2 *= t2; n2 = t2 * t2 * this.gradSimplex2D(gi2, x2, y2); }
    return 70.0 * (n0 + n1 + n2);
  }

  ridgeNoise2D(x, y) {
    const perlinValue = this.perlin2D(x, y);
    return 1.0 - Math.abs(Math.max(-1, Math.min(1, perlinValue)));
  }

  fractal2D(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.perlin2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxValue;
  }

  erosionNoise2D(x, y, iterations = 3) {
    let height = this.fractal2D(x, y, 6);
    for (let i = 0; i < iterations; i++) {
      const delta = 0.01;
      const hC = this.perlin2D(x, y);
      const hX = this.perlin2D(x + delta, y);
      const hY = this.perlin2D(x, y + delta);
      const gradX = (hX - hC) / delta;
      const gradY = (hY - hC) / delta;
      const magnitude = Math.sqrt(gradX * gradX + gradY * gradY);
      const erosionFactor = Math.min(1.0, magnitude * 2.0);
      height *= 1.0 - erosionFactor * 0.1;
    }
    return height;
  }
}

// Biome ID mapping
const BIOME_IDS = { plains: 0, forest: 1, valley: 2, mountains: 3, tundra: 4, desert: 5, lakes: 6, swamp: 7 };

// ============================================
// ISLAND CONFIGURATION - MUST match TerrainSystem.ts exactly!
// From TerrainSystem.getBaseHeightAt() lines 2069-2072
// ============================================
const ISLAND_RADIUS = 350;    // Base radius: ~220m (~440m diameter)
const ISLAND_FALLOFF = 100;   // Transition zone width (beach/shore)
const POND_RADIUS = 50;       // Pond radius
const POND_DEPTH = 0.55;      // Pond depth (normalized)
const POND_CENTER_X = -80;    // Pond west of spawn
const POND_CENTER_Z = 60;     // Pond south
const BASE_ELEVATION = 0.42;  // Normalized base elevation

// Generate terrain heightmap for a tile
// EXACT COPY of TerrainSystem logic - height and biome calculation
function generateHeightmap(input) {
  const { tileX, tileZ, config, seed, biomeCenters, biomes } = input;
  const { 
    TILE_SIZE, 
    TILE_RESOLUTION, 
    MAX_HEIGHT,
    BIOME_GAUSSIAN_COEFF,
    BIOME_BOUNDARY_NOISE_SCALE,
    BIOME_BOUNDARY_NOISE_AMOUNT,
    MOUNTAIN_HEIGHT_THRESHOLD,
    MOUNTAIN_WEIGHT_BOOST,
    VALLEY_HEIGHT_THRESHOLD,
    VALLEY_WEIGHT_BOOST,
    MOUNTAIN_HEIGHT_BOOST,
    WATER_LEVEL_NORMALIZED,
    SHORELINE_THRESHOLD,
    SHORELINE_STRENGTH
  } = config;

  const noise = new NoiseGenerator(seed);
  const resolution = TILE_RESOLUTION;
  const vertexCount = resolution * resolution;

  const heightData = new Float32Array(vertexCount);
  const colorData = new Float32Array(vertexCount * 3);
  const biomeData = new Uint8Array(vertexCount);

  // Get biome influences at position - EXACT MATCH to TerrainSystem.getBiomeInfluencesAtPosition()
  function getBiomeInfluences(worldX, worldZ, normalizedHeight) {
    if (!biomeCenters || biomeCenters.length === 0) {
      return [{ type: 'plains', weight: 1.0 }];
    }
    
    // Add boundary noise for organic edges (matches TerrainSystem)
    const boundaryNoise = noise.simplex2D(
      worldX * BIOME_BOUNDARY_NOISE_SCALE,
      worldZ * BIOME_BOUNDARY_NOISE_SCALE
    );
    
    // Map to collect and merge same-type biomes
    const biomeWeightMap = {};
    
    // Calculate influence from ALL biome centers (no hard cutoff!)
    for (const center of biomeCenters) {
      const dx = worldX - center.x;
      const dz = worldZ - center.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      // Add subtle noise to distance for organic boundaries
      const noisyDistance = distance * (1 + boundaryNoise * BIOME_BOUNDARY_NOISE_AMOUNT);
      
      // Pure gaussian falloff - NO hard distance cutoff
      const normalizedDistance = noisyDistance / center.influence;
      let weight = Math.exp(-normalizedDistance * normalizedDistance * BIOME_GAUSSIAN_COEFF);
      
      // Height-based weight adjustments (using BASE height, not boosted)
      if (center.type === 'mountains' && normalizedHeight > MOUNTAIN_HEIGHT_THRESHOLD) {
        const heightFactor = normalizedHeight - MOUNTAIN_HEIGHT_THRESHOLD;
        weight *= 1.0 + heightFactor * MOUNTAIN_WEIGHT_BOOST;
      }
      
      if ((center.type === 'valley' || center.type === 'plains') && normalizedHeight < VALLEY_HEIGHT_THRESHOLD) {
        const heightFactor = VALLEY_HEIGHT_THRESHOLD - normalizedHeight;
        weight *= 1.0 + heightFactor * VALLEY_WEIGHT_BOOST;
      }
      
      // Merge same-type biomes
      biomeWeightMap[center.type] = (biomeWeightMap[center.type] || 0) + weight;
    }
    
    // Convert map to array
    const biomeInfluences = [];
    for (const type in biomeWeightMap) {
      biomeInfluences.push({ type, weight: biomeWeightMap[type] });
    }
    
    // Normalize weights
    const totalWeight = biomeInfluences.reduce((sum, b) => sum + b.weight, 0);
    if (totalWeight > 0) {
      for (const inf of biomeInfluences) {
        inf.weight /= totalWeight;
      }
    } else {
      biomeInfluences.push({ type: 'plains', weight: 1.0 });
    }
    
    // Sort by weight descending and return top 3 for color blending
    biomeInfluences.sort((a, b) => b.weight - a.weight);
    return biomeInfluences.slice(0, 3);
  }

  // Get base height - EXACT match to TerrainSystem.getBaseHeightAt()
  function getBaseHeightAt(worldX, worldZ) {
    // Multi-layered noise for realistic terrain
    const continentScale = 0.0008;
    const continentNoise = noise.fractal2D(worldX * continentScale, worldZ * continentScale, 5, 0.7, 2.0);
    const ridgeScale = 0.003;
    const ridgeNoise = noise.ridgeNoise2D(worldX * ridgeScale, worldZ * ridgeScale);
    const hillScale = 0.012;
    const hillNoise = noise.fractal2D(worldX * hillScale, worldZ * hillScale, 4, 0.5, 2.2);
    const erosionScale = 0.005;
    const erosionNoise = noise.erosionNoise2D(worldX * erosionScale, worldZ * erosionScale, 3);
    const detailScale = 0.04;
    const detailNoise = noise.fractal2D(worldX * detailScale, worldZ * detailScale, 2, 0.3, 2.5);

    let height = 0;
    height += continentNoise * 0.4;
    height += ridgeNoise * 0.1;
    height += hillNoise * 0.12;
    height += erosionNoise * 0.08;
    height += detailNoise * 0.03;
    height = (height + 1) * 0.5;
    height = Math.max(0, Math.min(1, height));
    height = Math.pow(height, 1.1);

    // ============================================
    // NATURAL COASTLINE - Use noise to vary radius
    // ============================================
    const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);
    const angle = Math.atan2(worldZ, worldX);

    // Multi-octave noise based on angle creates irregular coastline
    const coastlineNoiseX = Math.cos(angle) * 2;
    const coastlineNoiseZ = Math.sin(angle) * 2;

    // Large-scale bays and peninsulas
    const coastNoise1 = noise.fractal2D(coastlineNoiseX, coastlineNoiseZ, 3, 0.5, 2.0);
    // Medium features
    const coastNoise2 = noise.fractal2D(coastlineNoiseX * 3, coastlineNoiseZ * 3, 2, 0.5, 2.0);
    // Small coves and points
    const coastNoise3 = noise.simplex2D(coastlineNoiseX * 8, coastlineNoiseZ * 8);

    // Combine for natural variation (±30% of radius)
    const coastlineVariation = coastNoise1 * 0.2 + coastNoise2 * 0.08 + coastNoise3 * 0.02;
    const effectiveRadius = ISLAND_RADIUS * (1 + coastlineVariation);

    // ============================================
    // ISLAND MASK - Smooth falloff at edges
    // ============================================
    let islandMask = 1.0;
    if (distFromCenter > effectiveRadius - ISLAND_FALLOFF) {
      const edgeDist = distFromCenter - (effectiveRadius - ISLAND_FALLOFF);
      const t = Math.min(1.0, edgeDist / ISLAND_FALLOFF);
      const smoothstep = t * t * (3 - 2 * t);
      islandMask = 1.0 - smoothstep;
    }

    // Outside island = deep ocean
    if (distFromCenter > effectiveRadius + 50) {
      islandMask = 0;
    }

    // ============================================
    // POND - Offset from center but near spawn
    // ============================================
    const distFromPond = Math.sqrt(
      (worldX - POND_CENTER_X) * (worldX - POND_CENTER_X) +
      (worldZ - POND_CENTER_Z) * (worldZ - POND_CENTER_Z)
    );

    let pondDepression = 0;
    if (distFromPond < POND_RADIUS * 2) {
      const pondFactor = 1.0 - distFromPond / (POND_RADIUS * 2);
      pondDepression = pondFactor * pondFactor * POND_DEPTH;
    }

    // ============================================
    // APPLY TO HEIGHT - exact match to TerrainSystem
    // ============================================
    height = height * islandMask;
    height = height * 0.2 + BASE_ELEVATION * islandMask;
    height -= pondDepression;

    // Ocean floor outside island
    if (islandMask === 0) {
      height = 0.05;
    }

    return height * MAX_HEIGHT;
  }

  // ============================================
  // MOUNTAIN BOOST - matches TerrainSystem.getHeightAtWithoutShore()
  // ============================================
  function applyMountainBoost(baseHeight, worldX, worldZ) {
    let height = baseHeight / MAX_HEIGHT; // Normalize for boost calc
    
    // Apply mountain biome height boost
    let mountainBoost = 0;
    for (const center of biomeCenters) {
      if (center.type === 'mountains') {
        const dx = worldX - center.x;
        const dz = worldZ - center.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const normalizedDist = distance / center.influence;
        
        if (normalizedDist < 2.5) {
          // Smooth boost that peaks at center and fades out
          const boost = Math.exp(-normalizedDist * normalizedDist * 0.3);
          mountainBoost = Math.max(mountainBoost, boost);
        }
      }
    }
    
    // Apply mountain height boost from CONFIG
    height = height * (1 + mountainBoost * MOUNTAIN_HEIGHT_BOOST);
    height = Math.min(1, height); // Cap at max
    
    return height * MAX_HEIGHT;
  }

  // Generate heightmap data
  const stepSize = TILE_SIZE / (resolution - 1);

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const idx = iz * resolution + ix;
      const localX = ix * stepSize - TILE_SIZE / 2;
      const localZ = iz * stepSize - TILE_SIZE / 2;
      const worldX = localX + tileX * TILE_SIZE;
      const worldZ = localZ + tileZ * TILE_SIZE;

      // Get base height using exact TerrainSystem.getBaseHeightAt() algorithm
      const baseHeight = getBaseHeightAt(worldX, worldZ);
      
      // Apply mountain boost (matches TerrainSystem.getHeightAtWithoutShore())
      const height = applyMountainBoost(baseHeight, worldX, worldZ);
      heightData[idx] = height;

      // Normalized height for biome calculation (matches TerrainSystem)
      const normalizedHeight = height / MAX_HEIGHT;

      // Get biome influences for color blending (up to 3 biomes)
      // Pass normalizedHeight to match TerrainSystem.getBiomeInfluencesAtPosition()
      const biomeInfluences = getBiomeInfluences(worldX, worldZ, normalizedHeight);
      const dominantBiome = biomeInfluences[0].type;
      biomeData[idx] = BIOME_IDS[dominantBiome] || 0;

      // Blend colors from multiple biomes (matches TerrainSystem.createTileGeometry)
      let colorR = 0, colorG = 0, colorB = 0;
      for (const influence of biomeInfluences) {
        const biomeConfig = biomes[influence.type] || { color: { r: 0.4, g: 0.6, b: 0.3 } };
        const color = biomeConfig.color || { r: 0.4, g: 0.6, b: 0.3 };
        colorR += color.r * influence.weight;
        colorG += color.g * influence.weight;
        colorB += color.b * influence.weight;
      }

      // ============================================
      // SHORELINE TINT - matches TerrainSystem.createTileGeometry()
      // Apply brownish shoreline tint near water level
      // ============================================
      if (normalizedHeight > WATER_LEVEL_NORMALIZED && normalizedHeight < SHORELINE_THRESHOLD) {
        // Sandy brown (0x8b7355) pre-computed: r=0.545, g=0.451, b=0.333
        const shoreFactor = (1.0 - (normalizedHeight - WATER_LEVEL_NORMALIZED) / 
                           (SHORELINE_THRESHOLD - WATER_LEVEL_NORMALIZED)) * SHORELINE_STRENGTH;
        colorR = colorR + (0.545 - colorR) * shoreFactor;
        colorG = colorG + (0.451 - colorG) * shoreFactor;
        colorB = colorB + (0.333 - colorB) * shoreFactor;
      }

      colorData[idx * 3] = colorR;
      colorData[idx * 3 + 1] = colorG;
      colorData[idx * 3 + 2] = colorB;
    }
  }

  return {
    type: 'heightmapResult',
    tileKey: tileX + '_' + tileZ,
    tileX,
    tileZ,
    heightData,
    colorData,
    biomeData
  };
}

// Worker message handler
self.onmessage = function(e) {
  const input = e.data;
  if (input.type === 'generateHeightmap') {
    try {
      const result = generateHeightmap(input);
      // Transfer ownership of TypedArrays for zero-copy
      self.postMessage({ result }, [
        result.heightData.buffer,
        result.colorData.buffer,
        result.biomeData.buffer
      ]);
    } catch (error) {
      self.postMessage({ error: error.message || 'Unknown error' });
    }
  }
};
`;

/** Singleton worker pool for terrain generation */
let terrainWorkerPool: WorkerPool<
  TerrainWorkerInput,
  TerrainWorkerOutput
> | null = null;

/** Track if workers are available */
let workersChecked = false;
let workersAvailable = false;

/**
 * Check if terrain workers are available (client-side with Worker + Blob URL support)
 * Bun provides Worker and Blob but doesn't support blob URLs for workers
 */
export function isTerrainWorkerAvailable(): boolean {
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
 * Get or create the terrain worker pool
 * @param poolSize - Number of workers (defaults to CPU cores - 1)
 * @returns Worker pool, or null if workers unavailable (server-side)
 */
export function getTerrainWorkerPool(
  poolSize?: number,
): WorkerPool<TerrainWorkerInput, TerrainWorkerOutput> | null {
  // Return null if workers not available (graceful degradation for server)
  if (!isTerrainWorkerAvailable()) {
    return null;
  }

  if (!terrainWorkerPool) {
    terrainWorkerPool = new WorkerPool<TerrainWorkerInput, TerrainWorkerOutput>(
      TERRAIN_WORKER_CODE,
      poolSize,
    );
  }
  return terrainWorkerPool;
}

/**
 * Generate terrain heightmap data using web worker
 * Returns immediately with a promise that resolves when the worker completes
 * Returns null if workers are not available
 */
export async function generateTerrainHeightmapAsync(
  tileX: number,
  tileZ: number,
  config: TerrainWorkerConfig,
  seed: number,
  biomeCenters: Array<{
    x: number;
    z: number;
    type: string;
    influence: number;
  }>,
  biomes: Record<
    string,
    { heightModifier: number; color: { r: number; g: number; b: number } }
  >,
): Promise<TerrainWorkerOutput | null> {
  const pool = getTerrainWorkerPool();
  if (!pool) {
    return null;
  }
  return pool.execute({
    type: "generateHeightmap",
    tileX,
    tileZ,
    config,
    seed,
    biomeCenters,
    biomes,
  });
}

/**
 * Result of batch terrain generation
 */
export interface TerrainBatchResult {
  /** Successfully generated tiles */
  results: TerrainWorkerOutput[];
  /** Whether workers were available (false = need synchronous fallback) */
  workersAvailable: boolean;
  /** Number of tiles that failed to generate */
  failedCount: number;
}

/**
 * Generate multiple tiles in parallel
 * Returns result object with workersAvailable flag - caller MUST check this!
 */
export async function generateTerrainTilesBatch(
  tiles: Array<{ tileX: number; tileZ: number }>,
  config: TerrainWorkerConfig,
  seed: number,
  biomeCenters: Array<{
    x: number;
    z: number;
    type: string;
    influence: number;
  }>,
  biomes: Record<
    string,
    { heightModifier: number; color: { r: number; g: number; b: number } }
  >,
): Promise<TerrainBatchResult> {
  const pool = getTerrainWorkerPool();
  if (!pool) {
    // Workers not available - caller should fall back to synchronous
    return {
      results: [],
      workersAvailable: false,
      failedCount: 0,
    };
  }

  const tasks = tiles.map((tile) => ({
    data: {
      type: "generateHeightmap" as const,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      config,
      seed,
      biomeCenters,
      biomes,
    },
  }));

  try {
    const results = await pool.executeAll(tasks);
    return {
      results,
      workersAvailable: true,
      failedCount: 0,
    };
  } catch (error) {
    // Some or all tasks failed
    console.error("[TerrainWorker] Batch generation failed:", error);
    return {
      results: [],
      workersAvailable: true,
      failedCount: tiles.length,
    };
  }
}

/**
 * Terminate the terrain worker pool (call on cleanup)
 */
export function terminateTerrainWorkerPool(): void {
  if (terrainWorkerPool) {
    terrainWorkerPool.terminate();
    terrainWorkerPool = null;
  }
}
