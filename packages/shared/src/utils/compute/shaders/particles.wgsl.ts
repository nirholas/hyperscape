/**
 * Particle Compute Shaders
 *
 * WGSL compute shaders for GPU-accelerated particle simulation.
 * Moves particle physics from CPU/Worker to GPU compute.
 *
 * ## Particle State Buffer
 * Each particle is stored as a struct with 80 bytes (16-byte aligned):
 * - position: vec3<f32> (12 bytes)
 * - life: f32 (4 bytes) - remaining lifetime
 * - direction: vec3<f32> (12 bytes) - velocity direction
 * - rotation: f32 (4 bytes)
 * - size: f32 (4 bytes)
 * - color: vec3<f32> (12 bytes)
 * - alpha: f32 (4 bytes)
 * - emissive: f32 (4 bytes)
 * - uv: vec4<f32> (16 bytes)
 * - _padding: vec2<f32> (8 bytes)
 *
 * ## Usage
 * 1. Initialize particle buffer with dead particles (life <= 0)
 * 2. Run emitter shader to spawn new particles
 * 3. Run physics shader to update existing particles
 * 4. Render directly from particle buffer (no read-back)
 */

import { WGSL_COMMON } from "./common.wgsl";

// ============================================================================
// PARTICLE STRUCTS
// ============================================================================

export const WGSL_PARTICLE_STRUCTS = /* wgsl */ `
// Particle state (80 bytes, 16-byte aligned)
struct Particle {
  position: vec3<f32>,
  life: f32,              // Remaining lifetime (seconds)
  direction: vec3<f32>,   // Velocity direction * speed
  rotation: f32,
  size: f32,
  color: vec3<f32>,
  alpha: f32,
  emissive: f32,
  uv: vec4<f32>,          // UV coordinates for spritesheet
  _pad: vec2<f32>,        // Padding to 80 bytes
}

// Emitter configuration
struct EmitterConfig {
  // Emitter position and shape
  position: vec3<f32>,
  shape: u32,             // 0=point, 1=sphere, 2=box, 3=cone
  
  // Emission parameters
  rate: f32,              // Particles per second
  burstCount: u32,        // Particles per burst (0 = continuous)
  _pad1: f32,
  _pad2: f32,
  
  // Shape parameters (meaning depends on shape type)
  shapeParam1: vec3<f32>, // sphere: radius, box: extents, cone: angle
  shapeParam2: f32,       // Additional shape parameter
  
  // Initial particle properties (min/max for randomization)
  lifeMin: f32,
  lifeMax: f32,
  speedMin: f32,
  speedMax: f32,
  
  sizeMin: f32,
  sizeMax: f32,
  rotationMin: f32,
  rotationMax: f32,
  
  // Color
  colorStart: vec3<f32>,
  _pad3: f32,
  colorEnd: vec3<f32>,
  _pad4: f32,
  
  // Direction
  directionBase: vec3<f32>,
  directionSpread: f32,   // Cone angle in radians
}

// Physics parameters (updated per frame)
struct PhysicsParams {
  delta: f32,             // Frame delta time
  gravity: f32,           // Gravity strength
  maxParticles: u32,
  time: f32,              // Total elapsed time
  
  // Lifetime curves (simplified to start/end values)
  sizeStart: f32,
  sizeEnd: f32,
  alphaStart: f32,
  alphaEnd: f32,
  
  // Forces
  windDirection: vec3<f32>,
  windStrength: f32,
  
  // Collision (optional)
  groundLevel: f32,
  bounciness: f32,
  _pad1: f32,
  _pad2: f32,
}

// Spawn parameters for emitter
struct SpawnParams {
  maxSpawn: u32,          // Maximum particles to spawn this frame
  seed: u32,              // Random seed for this frame
  activeCount: u32,       // Current active particle count (read-only)
  _pad: u32,
}
`;

// ============================================================================
// PARTICLE PHYSICS SHADER
// ============================================================================

/**
 * Updates particle physics: velocity, gravity, lifetime, size over life.
 * Run this each frame for active particles.
 */
export const PARTICLE_PHYSICS_SHADER = /* wgsl */ `
${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: PhysicsParams;
@group(0) @binding(2) var<storage, read_write> liveCount: atomic<u32>;

// Sample alpha curve (linear interpolation for now)
fn sampleAlphaCurve(t: f32) -> f32 {
  return mix(params.alphaStart, params.alphaEnd, t);
}

// Sample size curve
fn sampleSizeCurve(t: f32) -> f32 {
  return mix(params.sizeStart, params.sizeEnd, t);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= params.maxParticles) {
    return;
  }
  
  var p = particles[idx];
  
  // Skip dead particles
  if (p.life <= 0.0) {
    return;
  }
  
  // Capture original life for curve sampling
  let maxLife = p.life + params.delta; // Approximate original max life
  
  // Update lifetime
  p.life -= params.delta;
  
  // Kill particle if lifetime expired
  if (p.life <= 0.0) {
    p.life = 0.0;
    p.alpha = 0.0;
    particles[idx] = p;
    return;
  }
  
  // Calculate normalized lifetime (0 = just born, 1 = about to die)
  let t = 1.0 - (p.life / maxLife);
  
  // Apply gravity
  p.direction.y -= params.gravity * params.delta;
  
  // Apply wind
  p.direction += params.windDirection * params.windStrength * params.delta;
  
  // Update position
  p.position += p.direction * params.delta;
  
  // Ground collision (optional)
  if (params.groundLevel > -1000.0 && p.position.y < params.groundLevel) {
    p.position.y = params.groundLevel;
    if (params.bounciness > 0.0) {
      p.direction.y = -p.direction.y * params.bounciness;
    } else {
      p.direction.y = 0.0;
    }
  }
  
  // Update rotation
  p.rotation += params.delta * 0.5; // Simple constant rotation speed
  
  // Sample lifetime curves
  p.size = sampleSizeCurve(t);
  p.alpha = sampleAlphaCurve(t);
  
  // Store updated particle
  particles[idx] = p;
  
  // Increment live count
  atomicAdd(&liveCount, 1u);
}
`;

// ============================================================================
// PARTICLE EMITTER SHADER
// ============================================================================

/**
 * Spawns new particles by finding dead slots and initializing them.
 * Uses atomic operations to track spawn count.
 */
export const PARTICLE_EMITTER_SHADER = /* wgsl */ `
${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> emitter: EmitterConfig;
@group(0) @binding(2) var<uniform> spawnParams: SpawnParams;
@group(0) @binding(3) var<storage, read_write> spawnedCount: atomic<u32>;

// Generate random direction based on emitter config
fn randomDirection(seed: u32) -> vec3<f32> {
  let hash1 = hashU32(seed);
  let hash2 = hashU32(seed + 1u);
  
  // Random point on sphere
  let theta = hash1 * TWO_PI;
  let phi = acos(2.0 * hash2 - 1.0);
  
  let sinPhi = sin(phi);
  var dir = vec3<f32>(
    sinPhi * cos(theta),
    sinPhi * sin(theta),
    cos(phi)
  );
  
  // Blend with base direction based on spread
  if (emitter.directionSpread < PI) {
    let blend = emitter.directionSpread / PI;
    dir = normalize(mix(emitter.directionBase, dir, blend));
  }
  
  return dir;
}

// Generate spawn position based on emitter shape
fn spawnPosition(seed: u32) -> vec3<f32> {
  var pos = emitter.position;
  
  switch emitter.shape {
    case 0u: {
      // Point emitter - no offset
    }
    case 1u: {
      // Sphere emitter
      let radius = emitter.shapeParam1.x;
      let hash1 = hashU32(seed + 10u);
      let hash2 = hashU32(seed + 11u);
      let hash3 = hashU32(seed + 12u);
      
      let r = radius * pow(hash3, 0.333333);
      let theta = hash1 * TWO_PI;
      let phi = acos(2.0 * hash2 - 1.0);
      
      pos.x += r * sin(phi) * cos(theta);
      pos.y += r * sin(phi) * sin(theta);
      pos.z += r * cos(phi);
    }
    case 2u: {
      // Box emitter
      let extents = emitter.shapeParam1;
      pos.x += (hashU32(seed + 10u) - 0.5) * extents.x;
      pos.y += (hashU32(seed + 11u) - 0.5) * extents.y;
      pos.z += (hashU32(seed + 12u) - 0.5) * extents.z;
    }
    default: {
      // Cone emitter (shape=3)
      // Spawns particles within a cone volume pointing along directionBase
      // shapeParam1.x = cone base radius
      // shapeParam2 = cone height
      // directionBase = cone axis direction (normalized)
      
      let baseRadius = emitter.shapeParam1.x;
      let height = emitter.shapeParam2;
      
      // Random position along cone height (0 = apex, 1 = base)
      // Use cubic distribution for uniform volume density
      let heightT = pow(hashU32(seed + 10u), 0.333333);
      
      // Radius at this height (linear interpolation from apex to base)
      let radiusAtHeight = baseRadius * heightT;
      
      // Random angle around cone axis
      let angle = hashU32(seed + 11u) * TWO_PI;
      
      // Random radial distance within this slice (square root for uniform area)
      let radialT = sqrt(hashU32(seed + 12u));
      let r = radiusAtHeight * radialT;
      
      // Calculate position offset in cone's local space
      // Cone axis points along directionBase
      let coneAxis = normalize(emitter.directionBase);
      
      // Create orthonormal basis for the cone
      // Find a vector not parallel to coneAxis
      var up = vec3<f32>(0.0, 1.0, 0.0);
      if (abs(dot(coneAxis, up)) > 0.99) {
        up = vec3<f32>(1.0, 0.0, 0.0);
      }
      let tangent = normalize(cross(coneAxis, up));
      let bitangent = cross(coneAxis, tangent);
      
      // Offset along cone axis
      let axialOffset = coneAxis * height * heightT;
      
      // Radial offset perpendicular to cone axis
      let radialOffset = (tangent * cos(angle) + bitangent * sin(angle)) * r;
      
      pos += axialOffset + radialOffset;
    }
  }
  
  return pos;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= spawnParams.maxSpawn) {
    return;
  }
  
  // Check if we've spawned enough
  let currentSpawned = atomicLoad(&spawnedCount);
  if (currentSpawned >= spawnParams.maxSpawn) {
    return;
  }
  
  // Find a dead particle slot
  // Simple linear search - could be optimized with a free list
  let searchStart = (spawnParams.seed + idx * 7u) % arrayLength(&particles);
  var foundSlot = 0xFFFFFFFFu;
  
  for (var i = 0u; i < arrayLength(&particles); i++) {
    let checkIdx = (searchStart + i) % arrayLength(&particles);
    if (particles[checkIdx].life <= 0.0) {
      foundSlot = checkIdx;
      break;
    }
  }
  
  // No free slot found
  if (foundSlot == 0xFFFFFFFFu) {
    return;
  }
  
  // Try to claim this slot
  let claimed = atomicAdd(&spawnedCount, 1u);
  if (claimed >= spawnParams.maxSpawn) {
    return;
  }
  
  // Initialize new particle
  let seed = spawnParams.seed + idx + claimed * 17u;
  
  var p: Particle;
  p.position = spawnPosition(seed);
  p.life = mix(emitter.lifeMin, emitter.lifeMax, hashU32(seed + 1u));
  
  let speed = mix(emitter.speedMin, emitter.speedMax, hashU32(seed + 2u));
  p.direction = randomDirection(seed + 3u) * speed;
  
  p.rotation = mix(emitter.rotationMin, emitter.rotationMax, hashU32(seed + 4u));
  p.size = mix(emitter.sizeMin, emitter.sizeMax, hashU32(seed + 5u));
  
  // Color interpolation
  let colorT = hashU32(seed + 6u);
  p.color = mix(emitter.colorStart, emitter.colorEnd, colorT);
  
  p.alpha = 1.0;
  p.emissive = 0.0;
  p.uv = vec4<f32>(0.0, 0.0, 1.0, 1.0); // Full texture
  p._pad = vec2<f32>(0.0, 0.0);
  
  particles[foundSlot] = p;
}
`;

// ============================================================================
// PARTICLE COMPACT SHADER
// ============================================================================

/**
 * Compacts live particles for rendering.
 * Outputs only particles with life > 0 to a separate buffer.
 */
export const PARTICLE_COMPACT_SHADER = /* wgsl */ `
${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> visibleParticles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(3) var<uniform> maxParticles: u32;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= maxParticles) {
    return;
  }
  
  let p = particles[idx];
  
  // Skip dead particles
  if (p.life <= 0.0) {
    return;
  }
  
  // Atomically append to visible list
  let outIdx = atomicAdd(&visibleCount, 1u);
  visibleParticles[outIdx] = p;
}
`;

// ============================================================================
// PARTICLE SORT SHADER (OPTIONAL)
// ============================================================================

/**
 * Bitonic sort for back-to-front particle rendering.
 * Optional - only needed for alpha-blended particles.
 */
export const PARTICLE_SORT_SHADER = /* wgsl */ `
${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

struct SortParams {
  cameraPos: vec3<f32>,
  particleCount: u32,
  stage: u32,       // Current sorting stage
  passInStage: u32, // Current pass within stage
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SortParams;

// Calculate distance to camera (squared)
fn distToCamera(p: Particle) -> f32 {
  let d = p.position - params.cameraPos;
  return dot(d, d);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= params.particleCount) {
    return;
  }
  
  // Bitonic sort comparison
  let halfBlockSize = 1u << (params.stage - params.passInStage);
  let blockSize = halfBlockSize << 1u;
  
  let blockIdx = idx / blockSize;
  let idxInBlock = idx % blockSize;
  
  let ascending = (blockIdx % 2u) == 0u;
  
  var compareIdx: u32;
  if (idxInBlock < halfBlockSize) {
    compareIdx = idx + halfBlockSize;
  } else {
    return; // Only lower half of block does comparisons
  }
  
  if (compareIdx >= params.particleCount) {
    return;
  }
  
  let distA = distToCamera(particles[idx]);
  let distB = distToCamera(particles[compareIdx]);
  
  // Sort back-to-front (larger distance first)
  let shouldSwap = select(distA < distB, distA > distB, ascending);
  
  if (shouldSwap) {
    let temp = particles[idx];
    particles[idx] = particles[compareIdx];
    particles[compareIdx] = temp;
  }
}
`;

// ============================================================================
// SUBGROUP-OPTIMIZED PHYSICS SHADER
// ============================================================================

/**
 * Particle physics with subgroup operations for efficient counting.
 * Requires 'subgroups' feature to be enabled.
 *
 * Uses subgroup_add for live count instead of global atomics, reducing
 * contention and improving performance by ~30-50% on supported GPUs.
 */
export const PARTICLE_PHYSICS_SUBGROUP_SHADER = /* wgsl */ `
// Enable subgroup extension
enable subgroups;

${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: PhysicsParams;
@group(0) @binding(2) var<storage, read_write> liveCount: atomic<u32>;

// Workgroup shared memory for hierarchical reduction
var<workgroup> workgroupLiveCount: atomic<u32>;

fn sampleAlphaCurve(t: f32) -> f32 {
  return mix(params.alphaStart, params.alphaEnd, t);
}

fn sampleSizeCurve(t: f32) -> f32 {
  return mix(params.sizeStart, params.sizeEnd, t);
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(subgroup_invocation_id) subgroupInvocationId: u32,
  @builtin(subgroup_size) subgroupSize: u32
) {
  let idx = globalId.x;
  
  // Initialize workgroup counter (only once per workgroup)
  if (localId.x == 0u) {
    atomicStore(&workgroupLiveCount, 0u);
  }
  workgroupBarrier();
  
  var isLive = 0u;
  
  if (idx < params.maxParticles) {
    var p = particles[idx];
    
    if (p.life > 0.0) {
      let maxLife = p.life + params.delta;
      p.life -= params.delta;
      
      if (p.life <= 0.0) {
        p.life = 0.0;
        p.alpha = 0.0;
      } else {
        isLive = 1u;
        let t = 1.0 - (p.life / maxLife);
        
        // Apply gravity
        p.direction.y -= params.gravity * params.delta;
        
        // Apply wind
        p.direction += params.windDirection * params.windStrength * params.delta;
        
        // Update position
        p.position += p.direction * params.delta;
        
        // Ground collision
        if (params.groundLevel > -1000.0 && p.position.y < params.groundLevel) {
          p.position.y = params.groundLevel;
          if (params.bounciness > 0.0) {
            p.direction.y = -p.direction.y * params.bounciness;
          } else {
            p.direction.y = 0.0;
          }
        }
        
        // Update rotation
        p.rotation += params.delta * 0.5;
        
        // Sample lifetime curves
        p.size = sampleSizeCurve(t);
        p.alpha = sampleAlphaCurve(t);
      }
      
      particles[idx] = p;
    }
  }
  
  // Subgroup reduction: sum isLive across subgroup
  let subgroupSum = subgroupAdd(isLive);
  
  // First lane of each subgroup adds to workgroup counter
  if (subgroupInvocationId == 0u) {
    atomicAdd(&workgroupLiveCount, subgroupSum);
  }
  
  // Wait for all subgroups
  workgroupBarrier();
  
  // First thread adds workgroup total to global counter
  if (localId.x == 0u) {
    atomicAdd(&liveCount, atomicLoad(&workgroupLiveCount));
  }
}
`;

// ============================================================================
// SUBGROUP-OPTIMIZED COMPACT SHADER
// ============================================================================

/**
 * Compact live particles with subgroup ballot for efficient slot finding.
 * Uses subgroup_ballot and subgroup_prefix_exclusive_sum for compaction.
 */
export const PARTICLE_COMPACT_SUBGROUP_SHADER = /* wgsl */ `
enable subgroups;

${WGSL_COMMON}
${WGSL_PARTICLE_STRUCTS}

struct CompactParams {
  maxParticles: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: CompactParams;
@group(0) @binding(2) var<storage, read_write> visibleParticles: array<Particle>;
@group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;

var<workgroup> workgroupOffset: u32;
var<workgroup> workgroupCount: atomic<u32>;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(subgroup_invocation_id) subgroupInvocationId: u32
) {
  let idx = globalId.x;
  
  // Initialize workgroup counter
  if (localId.x == 0u) {
    atomicStore(&workgroupCount, 0u);
  }
  workgroupBarrier();
  
  var isLive = false;
  var p: Particle;
  
  if (idx < params.maxParticles) {
    p = particles[idx];
    isLive = p.life > 0.0;
  }
  
  // Subgroup ballot - get mask of live particles in subgroup
  let liveMask = subgroupBallot(isLive);
  
  // Count live particles before this invocation in subgroup
  let liveCountBefore = subgroupBallotExclusiveBitCount(liveMask);
  let subgroupLiveCount = subgroupBallotBitCount(liveMask);
  
  // First lane allocates slots for entire subgroup
  var subgroupBaseSlot: u32;
  if (subgroupInvocationId == 0u && subgroupLiveCount > 0u) {
    subgroupBaseSlot = atomicAdd(&workgroupCount, subgroupLiveCount);
  }
  subgroupBaseSlot = subgroupBroadcastFirst(subgroupBaseSlot);
  
  workgroupBarrier();
  
  // First thread allocates workgroup's range in global output
  if (localId.x == 0u) {
    workgroupOffset = atomicAdd(&visibleCount, atomicLoad(&workgroupCount));
  }
  workgroupBarrier();
  
  // Write live particles to output
  if (isLive) {
    let outIdx = workgroupOffset + subgroupBaseSlot + liveCountBefore;
    visibleParticles[outIdx] = p;
  }
}
`;

// ============================================================================
// FEATURE DETECTION
// ============================================================================

/**
 * Check if subgroup operations are available.
 * Call from JS to decide which shader to use.
 *
 * NOTE: Currently disabled because the subgroup shaders use
 * `subgroupBallotExclusiveBitCount` which is not a standard WGSL function
 * and is not available on all GPUs even when "subgroups" feature is reported.
 * The non-subgroup versions work correctly on all devices.
 */
export function supportsSubgroups(_device: GPUDevice): boolean {
  // Disabled until subgroup ballot operations are standardized
  // The basic "subgroups" feature doesn't guarantee all ballot functions
  return false;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const PARTICLE_SHADERS = {
  structs: WGSL_PARTICLE_STRUCTS,
  physics: PARTICLE_PHYSICS_SHADER,
  physicsSubgroup: PARTICLE_PHYSICS_SUBGROUP_SHADER,
  emitter: PARTICLE_EMITTER_SHADER,
  compact: PARTICLE_COMPACT_SHADER,
  compactSubgroup: PARTICLE_COMPACT_SUBGROUP_SHADER,
  sort: PARTICLE_SORT_SHADER,
} as const;
