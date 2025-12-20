/**
 * Terrain Preview - Procedural terrain generation for World Editor
 *
 * This mirrors the game's TerrainSystem to provide accurate terrain preview.
 * Uses the same noise algorithms and parameters as packages/shared/src/systems/shared/world/TerrainSystem.ts
 */

// ============================================================================
// NOISE GENERATOR (simplified version of packages/shared/src/utils/NoiseGenerator.ts)
// ============================================================================

class NoiseGenerator {
  private permutation: number[] = [];
  private p: number[] = [];

  constructor(seed: number = 12345) {
    this.initializePermutation(seed);
  }

  private initializePermutation(seed: number): void {
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

  perlin2D(x: number, y: number): number {
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

    const result = this.lerp(
      v,
      this.lerp(
        u,
        this.grad2D(this.p[AA], x, y),
        this.grad2D(this.p[BA], x - 1, y),
      ),
      this.lerp(
        u,
        this.grad2D(this.p[AB], x, y - 1),
        this.grad2D(this.p[BB], x - 1, y - 1),
      ),
    );

    return Math.max(-1, Math.min(1, result));
  }

  ridgeNoise2D(x: number, y: number): number {
    const perlinValue = this.perlin2D(x, y);
    return 1.0 - Math.abs(perlinValue);
  }

  fractal2D(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
  ): number {
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

  /**
   * 2D Simplex Noise - Used for ocean mask
   */
  simplex2D(x: number, y: number): number {
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

    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.p[ii + this.p[jj]] % 12;
    const gi1 = this.p[ii + i1 + this.p[jj + j1]] % 12;
    const gi2 = this.p[ii + 1 + this.p[jj + 1]] % 12;

    let n0: number, n1: number, n2: number;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * this.gradSimplex2D(gi0, x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * this.gradSimplex2D(gi1, x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * this.gradSimplex2D(gi2, x2, y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }

  /**
   * Erosion Noise - For valley and riverbed effects
   */
  erosionNoise2D(x: number, y: number, iterations: number = 3): number {
    let height = this.fractal2D(x, y, 6);

    for (let i = 0; i < iterations; i++) {
      const gradient = this.calculateGradient(x, y);
      const erosionFactor = Math.min(1.0, gradient.magnitude * 2.0);
      height *= 1.0 - erosionFactor * 0.1;
    }

    return height;
  }

  private calculateGradient(
    x: number,
    y: number,
    delta: number = 0.01,
  ): { x: number; y: number; magnitude: number } {
    const heightCenter = this.perlin2D(x, y);
    const heightX = this.perlin2D(x + delta, y);
    const heightY = this.perlin2D(x, y + delta);

    const gradX = (heightX - heightCenter) / delta;
    const gradY = (heightY - heightCenter) / delta;
    const magnitude = Math.sqrt(gradX * gradX + gradY * gradY);

    return { x: gradX, y: gradY, magnitude };
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad2D(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  private gradSimplex2D(hash: number, x: number, y: number): number {
    const grad3 = [
      [1, 1, 0],
      [-1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
      [1, 0, 1],
      [-1, 0, 1],
      [1, 0, -1],
      [-1, 0, -1],
      [0, 1, 1],
      [0, -1, 1],
      [0, 1, -1],
      [0, -1, -1],
    ];
    return grad3[hash % 12][0] * x + grad3[hash % 12][1] * y;
  }
}

// ============================================================================
// TERRAIN PREVIEW CONFIG (matches TerrainSystem.CONFIG)
// ============================================================================

const TERRAIN_CONFIG = {
  TILE_SIZE: 100, // 100m x 100m tiles
  WORLD_SIZE: 100, // 100x100 grid = 10km x 10km world
  MAX_HEIGHT: 30, // 30m max height
  WATER_THRESHOLD: 5.4, // Water appears below 5.4m (0.18 * MAX_HEIGHT)
} as const;

// Biome colors from biomes.json
const BIOME_COLORS: Record<string, string> = {
  plains: "#4CAF50",
  forest: "#2E7D32",
  valley: "#689F38",
  mountains: "#78909C",
  tundra: "#0D47A1",
  desert: "#8D6E63",
  lakes: "#0288D1",
  swamp: "#558B2F",
};

// Starter towns (safe zones) - tile coordinates
const STARTER_TOWNS = [
  { x: 0, z: 0, name: "Brookhaven" },
  { x: 10, z: 0, name: "Eastport" },
  { x: -10, z: 0, name: "Westfall" },
  { x: 0, z: 10, name: "Northridge" },
  { x: 0, z: -10, name: "Southmere" },
];

// ============================================================================
// BIOME CENTERS (deterministic from seed)
// ============================================================================

interface BiomeCenter {
  x: number;
  z: number;
  type: string;
  influence: number;
}

function initializeBiomeCenters(seed: number): BiomeCenter[] {
  const centers: BiomeCenter[] = [];
  const worldSize = TERRAIN_CONFIG.WORLD_SIZE * TERRAIN_CONFIG.TILE_SIZE;
  const numCenters = Math.floor((worldSize * worldSize) / 1000000);

  // Seeded random
  let random = seed;
  const nextRandom = () => {
    random = (random * 1664525 + 1013904223) % 4294967296;
    return random / 4294967296;
  };

  const biomeTypes = Object.keys(BIOME_COLORS);

  for (let i = 0; i < numCenters; i++) {
    const x = (nextRandom() - 0.5) * worldSize;
    const z = (nextRandom() - 0.5) * worldSize;
    const type = biomeTypes[Math.floor(nextRandom() * biomeTypes.length)];
    const influence = 500 + nextRandom() * 1500;

    centers.push({ x, z, type, influence });
  }

  return centers;
}

// ============================================================================
// HEIGHT CALCULATION (matches TerrainSystem.getHeightAt exactly)
// ============================================================================

function getHeightAt(
  noise: NoiseGenerator,
  worldX: number,
  worldZ: number,
): number {
  // Multi-layered noise for realistic terrain (matches game's TerrainSystem)

  // Layer 1: Continental shelf - very large scale features
  const continentScale = 0.0008;
  const continentNoise = noise.fractal2D(
    worldX * continentScale,
    worldZ * continentScale,
    5,
    0.7,
    2.0,
  );

  // Layer 2: Mountain ridges - creates dramatic peaks and valleys
  const ridgeScale = 0.003;
  const ridgeNoise = noise.ridgeNoise2D(
    worldX * ridgeScale,
    worldZ * ridgeScale,
  );

  // Layer 3: Hills and valleys - medium scale variation
  const hillScale = 0.012;
  const hillNoise = noise.fractal2D(
    worldX * hillScale,
    worldZ * hillScale,
    4,
    0.5,
    2.2,
  );

  // Layer 4: Erosion - smooths valleys and creates river beds
  const erosionScale = 0.005;
  const erosionNoise = noise.erosionNoise2D(
    worldX * erosionScale,
    worldZ * erosionScale,
    3,
  );

  // Layer 5: Fine detail - small bumps and texture
  const detailScale = 0.04;
  const detailNoise = noise.fractal2D(
    worldX * detailScale,
    worldZ * detailScale,
    2,
    0.3,
    2.5,
  );

  // Combine layers with OSRS-style tuning (gentle, not dramatic)
  let height = 0;

  // Base continental elevation (40% weight)
  height += continentNoise * 0.4;

  // Add mountain ridges - LINEAR, not squared (10% weight)
  // OSRS-style: gentle ridges, not sharp peaks
  height += ridgeNoise * 0.1;

  // Add rolling hills (12% weight) - reduced for flatter terrain
  height += hillNoise * 0.12;

  // Apply erosion to create valleys (8% weight, subtractive)
  height += erosionNoise * 0.08;

  // Add fine detail (3% weight) - subtle texture
  height += detailNoise * 0.03;

  // Normalize to [0, 1] range
  height = (height + 1) * 0.5;
  height = Math.max(0, Math.min(1, height));

  // Apply gentle power curve (OSRS-style: mostly flat with gentle variation)
  // 1.1 instead of 1.4 = much less dramatic peaks
  height = Math.pow(height, 1.1);

  // Create ocean depressions
  const oceanScale = 0.0015;
  const oceanMask = noise.simplex2D(worldX * oceanScale, worldZ * oceanScale);

  // If in ocean zone, depress the terrain
  if (oceanMask < -0.3) {
    const oceanDepth = (-0.3 - oceanMask) * 2; // How deep into ocean
    height *= Math.max(0.1, 1 - oceanDepth);
  }

  // Scale to actual world height (OSRS-style: gentle terrain)
  const MAX_HEIGHT = 30; // Maximum terrain height in meters
  const finalHeight = height * MAX_HEIGHT;

  return finalHeight;
}

// ============================================================================
// BIOME CALCULATION
// ============================================================================

function getBiomeAt(
  noise: NoiseGenerator,
  biomeCenters: BiomeCenter[],
  tileX: number,
  tileZ: number,
): { biome: string; color: string; isWater: boolean } {
  const worldX =
    tileX * TERRAIN_CONFIG.TILE_SIZE + TERRAIN_CONFIG.TILE_SIZE / 2;
  const worldZ =
    tileZ * TERRAIN_CONFIG.TILE_SIZE + TERRAIN_CONFIG.TILE_SIZE / 2;

  // Check if near starter town
  for (const town of STARTER_TOWNS) {
    const distance = Math.sqrt((tileX - town.x) ** 2 + (tileZ - town.z) ** 2);
    if (distance < 3) {
      return { biome: "plains", color: BIOME_COLORS.plains, isWater: false };
    }
  }

  // Get height for water check
  const height = getHeightAt(noise, worldX, worldZ);
  const isWater = height < TERRAIN_CONFIG.WATER_THRESHOLD;

  if (isWater) {
    return { biome: "lakes", color: BIOME_COLORS.lakes, isWater: true };
  }

  // Find dominant biome from centers
  let totalWeight = 0;
  const colorComponents = { r: 0, g: 0, b: 0 };
  let dominantBiome = "plains";
  let maxWeight = 0;

  for (const center of biomeCenters) {
    const distance = Math.sqrt(
      (worldX - center.x) ** 2 + (worldZ - center.z) ** 2,
    );

    if (distance < center.influence * 3) {
      const normalizedDistance = distance / center.influence;
      const weight = Math.exp(-normalizedDistance * normalizedDistance * 0.5);

      if (weight > maxWeight) {
        maxWeight = weight;
        dominantBiome = center.type;
      }

      // Blend colors
      const hexColor = BIOME_COLORS[center.type] || BIOME_COLORS.plains;
      const r = parseInt(hexColor.slice(1, 3), 16) / 255;
      const g = parseInt(hexColor.slice(3, 5), 16) / 255;
      const b = parseInt(hexColor.slice(5, 7), 16) / 255;

      colorComponents.r += r * weight;
      colorComponents.g += g * weight;
      colorComponents.b += b * weight;
      totalWeight += weight;
    }
  }

  // Fallback to plains
  if (totalWeight === 0) {
    return { biome: "plains", color: BIOME_COLORS.plains, isWater: false };
  }

  // Normalize blended color
  const r = Math.round((colorComponents.r / totalWeight) * 255);
  const g = Math.round((colorComponents.g / totalWeight) * 255);
  const b = Math.round((colorComponents.b / totalWeight) * 255);
  const blendedColor = `rgb(${r}, ${g}, ${b})`;

  return { biome: dominantBiome, color: blendedColor, isWater };
}

// ============================================================================
// TERRAIN PREVIEW CLASS
// ============================================================================

export interface TileTerrainData {
  biome: string;
  color: string;
  isWater: boolean;
  height: number;
  isTown: boolean;
  townName?: string;
}

export class TerrainPreview {
  private noise: NoiseGenerator;
  private biomeCenters: BiomeCenter[];
  private cache = new Map<string, TileTerrainData>();

  constructor(seed: number = 12345) {
    this.noise = new NoiseGenerator(seed);
    this.biomeCenters = initializeBiomeCenters(seed);
  }

  /**
   * Get terrain data for a tile
   */
  getTileData(tileX: number, tileZ: number): TileTerrainData {
    const key = `${tileX}_${tileZ}`;

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const worldX =
      tileX * TERRAIN_CONFIG.TILE_SIZE + TERRAIN_CONFIG.TILE_SIZE / 2;
    const worldZ =
      tileZ * TERRAIN_CONFIG.TILE_SIZE + TERRAIN_CONFIG.TILE_SIZE / 2;
    const height = getHeightAt(this.noise, worldX, worldZ);
    const { biome, color, isWater } = getBiomeAt(
      this.noise,
      this.biomeCenters,
      tileX,
      tileZ,
    );

    // Check if this is a town tile
    let isTown = false;
    let townName: string | undefined;
    for (const town of STARTER_TOWNS) {
      const distance = Math.sqrt((tileX - town.x) ** 2 + (tileZ - town.z) ** 2);
      if (distance < 2) {
        isTown = true;
        townName = town.name;
        break;
      }
    }

    const data: TileTerrainData = {
      biome,
      color,
      isWater,
      height,
      isTown,
      townName,
    };

    this.cache.set(key, data);
    return data;
  }

  /**
   * Get the world configuration
   */
  static getConfig() {
    return { ...TERRAIN_CONFIG };
  }

  /**
   * Get starter towns
   */
  static getStarterTowns() {
    return [...STARTER_TOWNS];
  }

  /**
   * Clear cache (call when regenerating or changing seed)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton with default seed
let defaultPreview: TerrainPreview | null = null;

export function getTerrainPreview(seed?: number): TerrainPreview {
  if (seed !== undefined) {
    return new TerrainPreview(seed);
  }

  if (!defaultPreview) {
    defaultPreview = new TerrainPreview(12345);
  }

  return defaultPreview;
}

// Export constants directly for easy access without needing class
export const TERRAIN_WORLD_CONFIG = { ...TERRAIN_CONFIG };
export const STARTER_TOWN_LOCATIONS = [...STARTER_TOWNS];
