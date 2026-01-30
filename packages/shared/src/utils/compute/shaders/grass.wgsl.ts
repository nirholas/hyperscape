/**
 * Grass Compute Shaders
 *
 * WGSL compute shaders for GPU-accelerated grass placement and culling.
 *
 * ## Features
 * - Jittered grid placement with deterministic RNG
 * - Density-based filtering with noise
 * - Slope and water level culling
 * - Frustum and distance culling
 * - LOD density reduction at distance
 *
 * ## Instance Data
 * Each grass instance stores:
 * - position: vec4 (xyz + heightScale)
 * - variation: vec4 (rotation, widthScale, colorVar, phaseOffset)
 */

import { WGSL_COMMON_EXTENDED } from "./common.wgsl";
import { WGSL_NOISE_FUNCTIONS } from "./noise.wgsl";

// ============================================================================
// GRASS STRUCTS
// ============================================================================

export const WGSL_GRASS_STRUCTS = /* wgsl */ `
// Grass instance data (32 bytes, 16-byte aligned)
struct GrassInstance {
  position: vec4<f32>,   // xyz + heightScale
  variation: vec4<f32>,  // rotation, widthScale, colorVar, phaseOffset
}

// Grass placement parameters
struct GrassPlacementParams {
  // Chunk origin
  originX: f32,
  originZ: f32,
  chunkSize: f32,
  cellSize: f32,
  
  // Placement parameters
  baseDensity: f32,
  maxInstances: u32,
  baseSeed: u32,
  _padding1: u32,
  
  // Height constraints
  waterLevel: f32,
  maxSlope: f32,
  minHeight: f32,
  maxHeight: f32,
  
  // Variation ranges
  heightScaleMin: f32,
  heightScaleMax: f32,
  widthScaleMin: f32,
  widthScaleMax: f32,
  
  // Color variation
  colorVarMin: f32,
  colorVarMax: f32,
  _padding2: f32,
  _padding3: f32,
}

// Grass culling parameters
struct GrassCullParams {
  cameraPos: vec4<f32>,
  
  cullDistanceSq: f32,
  fadeStartSq: f32,
  fadeEndSq: f32,
  instanceCount: u32,
  
  // LOD density thresholds (squared distances)
  lodHalfDensitySq: f32,
  lodQuarterDensitySq: f32,
  lodEighthDensitySq: f32,
  _padding: f32,
}
`;

// ============================================================================
// GRASS PLACEMENT SHADER
// ============================================================================

/**
 * Generates grass placements for a chunk using jittered grid sampling.
 *
 * Bindings:
 * - 0: instances (storage, read_write) - Output grass instances
 * - 1: heightmap (storage, read) - Terrain heightmap for height lookup
 * - 2: params (uniform) - Placement parameters
 * - 3: instanceCount (storage, read_write) - Atomic counter
 */
export const GRASS_PLACEMENT_SHADER = /* wgsl */ `
${WGSL_COMMON_EXTENDED}
${WGSL_GRASS_STRUCTS}

@group(0) @binding(0) var<storage, read_write> instances: array<GrassInstance>;
@group(0) @binding(1) var<storage, read> heightmap: array<f32>;
@group(0) @binding(2) var<uniform> params: GrassPlacementParams;
@group(0) @binding(3) var<storage, read_write> instanceCount: atomic<u32>;

// Heightmap parameters (for sampling)
struct HeightmapInfo {
  originX: f32,
  originZ: f32,
  resolution: u32,
  spacing: f32,
}
@group(0) @binding(4) var<uniform> heightmapInfo: HeightmapInfo;

// Sample height from heightmap
fn sampleHeight(worldX: f32, worldZ: f32) -> f32 {
  let localX = (worldX - heightmapInfo.originX) / heightmapInfo.spacing;
  let localZ = (worldZ - heightmapInfo.originZ) / heightmapInfo.spacing;
  
  let x0 = u32(floor(localX));
  let z0 = u32(floor(localZ));
  let x1 = min(x0 + 1u, heightmapInfo.resolution - 1u);
  let z1 = min(z0 + 1u, heightmapInfo.resolution - 1u);
  
  let fx = fract(localX);
  let fz = fract(localZ);
  
  let h00 = heightmap[z0 * heightmapInfo.resolution + x0];
  let h10 = heightmap[z0 * heightmapInfo.resolution + x1];
  let h01 = heightmap[z1 * heightmapInfo.resolution + x0];
  let h11 = heightmap[z1 * heightmapInfo.resolution + x1];
  
  let h0 = mix(h00, h10, fx);
  let h1 = mix(h01, h11, fx);
  
  return mix(h0, h1, fz);
}

// Calculate slope at position
fn calculateSlope(worldX: f32, worldZ: f32) -> f32 {
  let delta = params.cellSize * 0.5;
  
  let hCenter = sampleHeight(worldX, worldZ);
  let hPosX = sampleHeight(worldX + delta, worldZ);
  let hNegX = sampleHeight(worldX - delta, worldZ);
  let hPosZ = sampleHeight(worldX, worldZ + delta);
  let hNegZ = sampleHeight(worldX, worldZ - delta);
  
  let gradX = (hPosX - hNegX) / (delta * 2.0);
  let gradZ = (hPosZ - hNegZ) / (delta * 2.0);
  
  return sqrt(gradX * gradX + gradZ * gradZ);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= params.maxInstances) {
    return;
  }
  
  // Calculate cell position from index
  let cellsPerSide = u32(ceil(params.chunkSize / params.cellSize));
  let cellX = idx % cellsPerSide;
  let cellZ = idx / cellsPerSide;
  
  if (cellZ >= cellsPerSide) {
    return;
  }
  
  // Deterministic seed for this cell
  let seed = params.baseSeed + idx;
  
  // Jittered position within cell
  let jitterX = hashU32(seed) * params.cellSize;
  let jitterZ = hashU32(seed + 1u) * params.cellSize;
  let worldX = params.originX + f32(cellX) * params.cellSize + jitterX;
  let worldZ = params.originZ + f32(cellZ) * params.cellSize + jitterZ;
  
  // Density check
  if (hashU32(seed + 2u) > params.baseDensity) {
    return;
  }
  
  // Sample terrain height
  let height = sampleHeight(worldX, worldZ);
  
  // Water check
  if (height < params.waterLevel) {
    return;
  }
  
  // Height range check
  if (height < params.minHeight || height > params.maxHeight) {
    return;
  }
  
  // Slope check
  let slope = calculateSlope(worldX, worldZ);
  if (slope > params.maxSlope) {
    return;
  }
  
  // Create grass instance
  var instance: GrassInstance;
  
  // Position with height scale
  let heightScale = mix(params.heightScaleMin, params.heightScaleMax, hashU32(seed + 3u));
  instance.position = vec4<f32>(worldX, height, worldZ, heightScale);
  
  // Variation
  let rotation = hashU32(seed + 4u) * TWO_PI;
  let widthScale = mix(params.widthScaleMin, params.widthScaleMax, hashU32(seed + 5u));
  let colorVar = mix(params.colorVarMin, params.colorVarMax, hashU32(seed + 6u));
  let phaseOffset = hashU32(seed + 7u) * TWO_PI;
  instance.variation = vec4<f32>(rotation, widthScale, colorVar, phaseOffset);
  
  // Atomically add to output
  let outIdx = atomicAdd(&instanceCount, 1u);
  if (outIdx < params.maxInstances) {
    instances[outIdx] = instance;
  }
}
`;

// ============================================================================
// GRASS CULLING SHADER
// ============================================================================

/**
 * Culls grass instances based on frustum, distance, and LOD density.
 * Uses golden ratio hash for deterministic LOD density reduction.
 */
export const GRASS_CULLING_SHADER = /* wgsl */ `
${WGSL_COMMON_EXTENDED}
${WGSL_GRASS_STRUCTS}

@group(0) @binding(0) var<storage, read> instances: array<GrassInstance>;
@group(0) @binding(1) var<uniform> frustumPlanes: array<vec4<f32>, 6>;
@group(0) @binding(2) var<uniform> params: GrassCullParams;
@group(0) @binding(3) var<storage, read_write> visibleInstances: array<GrassInstance>;
@group(0) @binding(4) var<storage, read_write> visibleCount: atomic<u32>;

// Uses global frustumPlanes uniform (different signature from common.wgsl pointInFrustum)
fn isInFrustum(point: vec3<f32>) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = frustumPlanes[i];
    let distance = dot(plane.xyz, point) + plane.w;
    if (distance < 0.0) {
      return false;
    }
  }
  return true;
}

// Calculate LOD density threshold based on distance
fn calculateLODThreshold(distSq: f32) -> f32 {
  if (distSq < params.lodHalfDensitySq) {
    return 1.0;
  }
  
  let t1 = smoothstep(params.lodHalfDensitySq, params.lodQuarterDensitySq, distSq);
  let threshold1 = mix(1.0, 0.5, t1);
  
  let t2 = smoothstep(params.lodQuarterDensitySq, params.lodEighthDensitySq, distSq);
  let threshold2 = mix(threshold1, 0.25, t2);
  
  let t3 = smoothstep(params.lodEighthDensitySq, params.cullDistanceSq, distSq);
  return mix(threshold2, 0.125, t3);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= params.instanceCount) {
    return;
  }
  
  let instance = instances[idx];
  let position = instance.position.xyz;
  
  // Distance culling (squared)
  let distSq = distanceSquaredXZ(position, params.cameraPos.xyz);
  if (distSq > params.cullDistanceSq) {
    return;
  }
  
  // Frustum culling
  if (!isInFrustum(position)) {
    return;
  }
  
  // LOD density culling using golden ratio hash
  let instanceHash = fract(f32(idx) * GOLDEN_RATIO);
  let lodThreshold = calculateLODThreshold(distSq);
  if (instanceHash > lodThreshold) {
    return;
  }
  
  // Instance passed culling - add to visible list
  let outIdx = atomicAdd(&visibleCount, 1u);
  visibleInstances[outIdx] = instance;
}
`;

// ============================================================================
// GRASS COMBINED SHADER (PLACEMENT + CULLING)
// ============================================================================

/**
 * Combined placement and culling for smaller chunks.
 * More efficient when chunk fits in a single dispatch.
 */
export const GRASS_COMBINED_SHADER = /* wgsl */ `
${WGSL_COMMON_EXTENDED}
${WGSL_GRASS_STRUCTS}

struct CombinedParams {
  // Placement
  originX: f32,
  originZ: f32,
  chunkSize: f32,
  cellSize: f32,
  
  baseDensity: f32,
  maxInstances: u32,
  baseSeed: u32,
  _padding1: u32,
  
  waterLevel: f32,
  maxSlope: f32,
  heightScaleMin: f32,
  heightScaleMax: f32,
  
  // Culling
  cameraPosX: f32,
  cameraPosY: f32,
  cameraPosZ: f32,
  cullDistanceSq: f32,
  
  lodHalfDensitySq: f32,
  lodQuarterDensitySq: f32,
  lodEighthDensitySq: f32,
  _padding2: f32,
}

@group(0) @binding(0) var<storage, read_write> instances: array<GrassInstance>;
@group(0) @binding(1) var<storage, read> heightmap: array<f32>;
@group(0) @binding(2) var<uniform> params: CombinedParams;
@group(0) @binding(3) var<uniform> frustumPlanes: array<vec4<f32>, 6>;
@group(0) @binding(4) var<storage, read_write> instanceCount: atomic<u32>;

// Heightmap info embedded in params for simplicity
const HEIGHTMAP_RESOLUTION: u32 = 64u;
const HEIGHTMAP_SPACING: f32 = 1.5625; // 100m / 64

fn sampleHeightSimple(worldX: f32, worldZ: f32) -> f32 {
  let localX = (worldX - params.originX) / HEIGHTMAP_SPACING;
  let localZ = (worldZ - params.originZ) / HEIGHTMAP_SPACING;
  
  let x = clamp(u32(localX), 0u, HEIGHTMAP_RESOLUTION - 1u);
  let z = clamp(u32(localZ), 0u, HEIGHTMAP_RESOLUTION - 1u);
  
  return heightmap[z * HEIGHTMAP_RESOLUTION + x];
}

// Uses global frustumPlanes uniform (different signature from common.wgsl pointInFrustum)
fn isInFrustum(point: vec3<f32>) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = frustumPlanes[i];
    if (dot(plane.xyz, point) + plane.w < 0.0) {
      return false;
    }
  }
  return true;
}

fn calculateLODThreshold(distSq: f32) -> f32 {
  if (distSq < params.lodHalfDensitySq) { return 1.0; }
  let t1 = smoothstep(params.lodHalfDensitySq, params.lodQuarterDensitySq, distSq);
  let t2 = smoothstep(params.lodQuarterDensitySq, params.lodEighthDensitySq, distSq);
  let t3 = smoothstep(params.lodEighthDensitySq, params.cullDistanceSq, distSq);
  return mix(mix(mix(1.0, 0.5, t1), 0.25, t2), 0.125, t3);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= params.maxInstances) {
    return;
  }
  
  // Cell position
  let cellsPerSide = u32(ceil(params.chunkSize / params.cellSize));
  let cellX = idx % cellsPerSide;
  let cellZ = idx / cellsPerSide;
  if (cellZ >= cellsPerSide) { return; }
  
  let seed = params.baseSeed + idx;
  
  // Jittered position
  let jitterX = hashU32(seed) * params.cellSize;
  let jitterZ = hashU32(seed + 1u) * params.cellSize;
  let worldX = params.originX + f32(cellX) * params.cellSize + jitterX;
  let worldZ = params.originZ + f32(cellZ) * params.cellSize + jitterZ;
  
  // Density check
  if (hashU32(seed + 2u) > params.baseDensity) { return; }
  
  // Height check
  let height = sampleHeightSimple(worldX, worldZ);
  if (height < params.waterLevel) { return; }
  
  // Early distance cull (before slope calculation)
  let cameraPos = vec3<f32>(params.cameraPosX, params.cameraPosY, params.cameraPosZ);
  let position = vec3<f32>(worldX, height, worldZ);
  let distSq = distanceSquaredXZ(position, cameraPos);
  if (distSq > params.cullDistanceSq) { return; }
  
  // Frustum check
  if (!isInFrustum(position)) { return; }
  
  // LOD density cull
  let instanceHash = fract(f32(idx) * GOLDEN_RATIO);
  if (instanceHash > calculateLODThreshold(distSq)) { return; }
  
  // Create instance
  var instance: GrassInstance;
  let heightScale = mix(params.heightScaleMin, params.heightScaleMax, hashU32(seed + 3u));
  instance.position = vec4<f32>(worldX, height, worldZ, heightScale);
  
  let rotation = hashU32(seed + 4u) * TWO_PI;
  let widthScale = 0.8 + hashU32(seed + 5u) * 0.4;
  let colorVar = -0.15 + hashU32(seed + 6u) * 0.3;
  let phaseOffset = hashU32(seed + 7u) * TWO_PI;
  instance.variation = vec4<f32>(rotation, widthScale, colorVar, phaseOffset);
  
  // Output
  let outIdx = atomicAdd(&instanceCount, 1u);
  if (outIdx < params.maxInstances) {
    instances[outIdx] = instance;
  }
}
`;

// ============================================================================
// EXPORTS
// ============================================================================

export const GRASS_SHADERS = {
  structs: WGSL_GRASS_STRUCTS,
  placement: GRASS_PLACEMENT_SHADER,
  culling: GRASS_CULLING_SHADER,
  combined: GRASS_COMBINED_SHADER,
} as const;
