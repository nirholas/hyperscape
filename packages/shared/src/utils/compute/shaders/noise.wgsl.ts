/**
 * Noise Functions WGSL
 *
 * GPU-accelerated noise functions ported from NoiseGenerator.ts.
 * Includes Perlin, Simplex, Ridge, Fractal, and Erosion noise.
 *
 * ## Usage
 * Include WGSL_NOISE_FUNCTIONS in your compute shader, then call:
 * - perlin2D(x, y) - Classic Perlin noise
 * - simplex2D(x, y) - Simplex noise (faster, less directional artifacts)
 * - ridgeNoise2D(x, y) - Ridge/turbulence noise
 * - fractal2D(x, y, octaves, persistence, lacunarity) - Fractal Brownian motion
 * - erosionNoise2D(x, y, iterations) - Erosion-like noise
 *
 * ## Permutation Table
 * The permutation table must be uploaded as a uniform buffer before use.
 * Call initializePermutationTable() to generate a seeded table.
 */

// Re-export common for consumers that need both common and noise shaders
export { WGSL_COMMON } from "./common.wgsl";

// ============================================================================
// PERMUTATION TABLE SETUP
// ============================================================================

/**
 * Generate a seeded permutation table for noise functions.
 * Returns a 512-element Uint32Array (256 values repeated twice).
 */
export function generatePermutationTable(seed: number = 0): Uint32Array {
  const perm = new Uint32Array(512);

  // Initialize with values 0-255
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
  }

  // Fisher-Yates shuffle with seeded random
  let rng = seed;
  for (let i = 255; i > 0; i--) {
    // Simple LCG random
    rng = ((rng * 1103515245 + 12345) >>> 0) % 2147483648;
    const j = rng % (i + 1);
    const temp = perm[i];
    perm[i] = perm[j];
    perm[j] = temp;
  }

  // Duplicate for wrap-around
  for (let i = 0; i < 256; i++) {
    perm[i + 256] = perm[i];
  }

  return perm;
}

// ============================================================================
// NOISE FUNCTIONS WGSL
// ============================================================================

export const WGSL_NOISE_FUNCTIONS = /* wgsl */ `
// Permutation table (512 u32 values, uploaded as uniform)
// Note: This must be bound as @group(X) @binding(Y) var<uniform> perm: array<u32, 512>;

// ============================================================================
// GRADIENT FUNCTIONS
// ============================================================================

// Smoothstep fade function (Perlin's improved curve)
fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// 2D gradient based on hash
fn grad2D(hash: u32, x: f32, y: f32) -> f32 {
  let h = hash & 3u;
  let u = select(y, x, h < 2u);
  let v = select(x, y, h < 2u);
  return select(-u, u, (h & 1u) == 0u) + select(-v, v, (h & 2u) == 0u);
}

// Simplex gradient lookup (12 directions)
fn gradSimplex2D(hash: u32, x: f32, y: f32) -> f32 {
  // 12 gradient directions
  let h = hash % 12u;
  
  // Gradient vectors (simplified)
  var gx: f32;
  var gy: f32;
  
  switch h {
    case 0u:  { gx = 1.0;  gy = 1.0;  }
    case 1u:  { gx = -1.0; gy = 1.0;  }
    case 2u:  { gx = 1.0;  gy = -1.0; }
    case 3u:  { gx = -1.0; gy = -1.0; }
    case 4u:  { gx = 1.0;  gy = 0.0;  }
    case 5u:  { gx = -1.0; gy = 0.0;  }
    case 6u:  { gx = 1.0;  gy = 0.0;  }
    case 7u:  { gx = -1.0; gy = 0.0;  }
    case 8u:  { gx = 0.0;  gy = 1.0;  }
    case 9u:  { gx = 0.0;  gy = -1.0; }
    case 10u: { gx = 0.0;  gy = 1.0;  }
    default:  { gx = 0.0;  gy = -1.0; }
  }
  
  return gx * x + gy * y;
}

// ============================================================================
// PERLIN NOISE 2D
// ============================================================================

fn perlin2D(x: f32, y: f32, perm: ptr<uniform, array<u32, 512>>) -> f32 {
  // Integer coordinates
  let X = u32(floor(x)) & 255u;
  let Y = u32(floor(y)) & 255u;
  
  // Fractional coordinates
  let xf = fract(x);
  let yf = fract(y);
  
  // Fade curves
  let u = fade(xf);
  let v = fade(yf);
  
  // Hash coordinates of the 4 corners
  let A = (*perm)[X] + Y;
  let AA = (*perm)[A];
  let AB = (*perm)[A + 1u];
  let B = (*perm)[X + 1u] + Y;
  let BA = (*perm)[B];
  let BB = (*perm)[B + 1u];
  
  // Blend gradients from 4 corners
  let result = mix(
    mix(
      grad2D((*perm)[AA], xf, yf),
      grad2D((*perm)[BA], xf - 1.0, yf),
      u
    ),
    mix(
      grad2D((*perm)[AB], xf, yf - 1.0),
      grad2D((*perm)[BB], xf - 1.0, yf - 1.0),
      u
    ),
    v
  );
  
  // Clamp to [-1, 1]
  return clamp(result, -1.0, 1.0);
}

// ============================================================================
// SIMPLEX NOISE 2D
// ============================================================================

fn simplex2D(x: f32, y: f32, perm: ptr<uniform, array<u32, 512>>) -> f32 {
  // Skewing factors for 2D
  let F2 = 0.5 * (sqrt(3.0) - 1.0);
  let G2 = (3.0 - sqrt(3.0)) / 6.0;
  
  // Skew input space
  let s = (x + y) * F2;
  let i = floor(x + s);
  let j = floor(y + s);
  
  // Unskew cell origin
  let t = (i + j) * G2;
  let X0 = i - t;
  let Y0 = j - t;
  let x0 = x - X0;
  let y0 = y - Y0;
  
  // Determine which simplex we're in
  var i1: f32;
  var j1: f32;
  if (x0 > y0) {
    i1 = 1.0;
    j1 = 0.0;
  } else {
    i1 = 0.0;
    j1 = 1.0;
  }
  
  // Offsets for corners
  let x1 = x0 - i1 + G2;
  let y1 = y0 - j1 + G2;
  let x2 = x0 - 1.0 + 2.0 * G2;
  let y2 = y0 - 1.0 + 2.0 * G2;
  
  // Hash coordinates
  let ii = u32(i) & 255u;
  let jj = u32(j) & 255u;
  let gi0 = (*perm)[ii + (*perm)[jj]] % 12u;
  let gi1 = (*perm)[ii + u32(i1) + (*perm)[jj + u32(j1)]] % 12u;
  let gi2 = (*perm)[ii + 1u + (*perm)[jj + 1u]] % 12u;
  
  // Calculate contributions from each corner
  var n0: f32;
  var n1: f32;
  var n2: f32;
  
  var t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 < 0.0) {
    n0 = 0.0;
  } else {
    t0 = t0 * t0;
    n0 = t0 * t0 * gradSimplex2D(gi0, x0, y0);
  }
  
  var t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 < 0.0) {
    n1 = 0.0;
  } else {
    t1 = t1 * t1;
    n1 = t1 * t1 * gradSimplex2D(gi1, x1, y1);
  }
  
  var t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 < 0.0) {
    n2 = 0.0;
  } else {
    t2 = t2 * t2;
    n2 = t2 * t2 * gradSimplex2D(gi2, x2, y2);
  }
  
  // Scale to [-1, 1]
  return 70.0 * (n0 + n1 + n2);
}

// ============================================================================
// RIDGE NOISE 2D
// ============================================================================

fn ridgeNoise2D(x: f32, y: f32, perm: ptr<uniform, array<u32, 512>>) -> f32 {
  let perlinValue = perlin2D(x, y, perm);
  let clampedPerlin = clamp(perlinValue, -1.0, 1.0);
  return 1.0 - abs(clampedPerlin);
}

// ============================================================================
// FRACTAL NOISE 2D (FBM)
// ============================================================================

fn fractal2D(
  x: f32,
  y: f32,
  octaves: u32,
  persistence: f32,
  lacunarity: f32,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  
  for (var i = 0u; i < octaves; i++) {
    value += perlin2D(x * frequency, y * frequency, perm) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return value / maxValue;
}

// ============================================================================
// EROSION NOISE 2D
// ============================================================================

// Simple gradient calculation for erosion
fn calculateGradient(x: f32, y: f32, delta: f32, perm: ptr<uniform, array<u32, 512>>) -> vec3<f32> {
  let heightCenter = perlin2D(x, y, perm);
  let heightX = perlin2D(x + delta, y, perm);
  let heightY = perlin2D(x, y + delta, perm);
  
  let gradX = (heightX - heightCenter) / delta;
  let gradY = (heightY - heightCenter) / delta;
  let magnitude = sqrt(gradX * gradX + gradY * gradY);
  
  return vec3<f32>(gradX, gradY, magnitude);
}

fn erosionNoise2D(
  x: f32,
  y: f32,
  iterations: u32,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  // Start with fractal noise
  var height = fractal2D(x, y, 6u, 0.5, 2.0, perm);
  
  // Apply erosion iterations
  for (var i = 0u; i < iterations; i++) {
    let gradient = calculateGradient(x, y, 0.01, perm);
    let erosionFactor = min(1.0, gradient.z * 2.0);
    height *= 1.0 - erosionFactor * 0.1;
  }
  
  return height;
}

// ============================================================================
// DOMAIN WARPING
// ============================================================================

fn warpedNoise2D(
  x: f32,
  y: f32,
  warpStrength: f32,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  // First noise layer for warping
  let warpX = perlin2D(x * 0.5, y * 0.5, perm) * warpStrength;
  let warpY = perlin2D(x * 0.5 + 5.2, y * 0.5 + 1.3, perm) * warpStrength;
  
  // Sample with warped coordinates
  return perlin2D(x + warpX, y + warpY, perm);
}

// ============================================================================
// BILLOWY NOISE (Abs Fractal)
// ============================================================================

fn billowyNoise2D(
  x: f32,
  y: f32,
  octaves: u32,
  persistence: f32,
  lacunarity: f32,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  
  for (var i = 0u; i < octaves; i++) {
    value += abs(perlin2D(x * frequency, y * frequency, perm)) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return value / maxValue;
}

// ============================================================================
// RIDGED MULTIFRACTAL
// ============================================================================

fn ridgedMultifractal2D(
  x: f32,
  y: f32,
  octaves: u32,
  lacunarity: f32,
  gain: f32,
  offset: f32,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  var sum = 0.0;
  var frequency = 1.0;
  var amplitude = 0.5;
  var prev = 1.0;
  
  for (var i = 0u; i < octaves; i++) {
    let n = ridgeNoise2D(x * frequency, y * frequency, perm);
    let signal = offset - abs(n);
    let signal2 = signal * signal;
    sum += signal2 * amplitude * prev;
    prev = signal2;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  
  return sum;
}
`;

// ============================================================================
// TERRAIN NOISE COMPOSITION
// ============================================================================

/**
 * Multi-layer terrain noise composition.
 * Combines continent, ridge, hill, erosion, and detail layers.
 */
export const WGSL_TERRAIN_NOISE = /* wgsl */ `
${WGSL_NOISE_FUNCTIONS}

// Terrain parameters
struct TerrainNoiseParams {
  // Layer weights
  continentWeight: f32,
  ridgeWeight: f32,
  hillWeight: f32,
  erosionWeight: f32,
  detailWeight: f32,
  _padding1: f32,
  _padding2: f32,
  _padding3: f32,
  
  // Layer scales
  continentScale: f32,
  ridgeScale: f32,
  hillScale: f32,
  erosionScale: f32,
  detailScale: f32,
  _padding4: f32,
  _padding5: f32,
  _padding6: f32,
}

// Generate terrain height at a point
fn terrainHeight(
  worldX: f32,
  worldZ: f32,
  params: TerrainNoiseParams,
  perm: ptr<uniform, array<u32, 512>>
) -> f32 {
  var height = 0.0;
  
  // Layer 1: Continent-scale (very large features)
  height += fractal2D(
    worldX * params.continentScale,
    worldZ * params.continentScale,
    5u, 0.7, 2.0, perm
  ) * params.continentWeight;
  
  // Layer 2: Ridge noise (mountain ridges)
  height += ridgeNoise2D(
    worldX * params.ridgeScale,
    worldZ * params.ridgeScale,
    perm
  ) * params.ridgeWeight;
  
  // Layer 3: Hills (medium-scale features)
  height += fractal2D(
    worldX * params.hillScale,
    worldZ * params.hillScale,
    4u, 0.6, 2.2, perm
  ) * params.hillWeight;
  
  // Layer 4: Erosion (terrain smoothing)
  height += erosionNoise2D(
    worldX * params.erosionScale,
    worldZ * params.erosionScale,
    3u, perm
  ) * params.erosionWeight;
  
  // Layer 5: Detail (small bumps)
  height += fractal2D(
    worldX * params.detailScale,
    worldZ * params.detailScale,
    2u, 0.3, 2.5, perm
  ) * params.detailWeight;
  
  // Normalize to [0, 1]
  height = (height + 1.0) * 0.5;
  height = clamp(height, 0.0, 1.0);
  
  // Apply power curve for better elevation distribution
  height = pow(height, 1.1);
  
  return height;
}
`;

// ============================================================================
// EXPORTS
// ============================================================================

export const NOISE_SHADERS = {
  functions: WGSL_NOISE_FUNCTIONS,
  terrain: WGSL_TERRAIN_NOISE,
} as const;
