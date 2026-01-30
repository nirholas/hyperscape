/**
 * WebGPU Compute Module
 *
 * Provides GPU compute shader infrastructure for real-time operations.
 */

// Core compute context
export {
  RuntimeComputeContext,
  isWebGPUAvailable,
  isWebGPURenderer,
  getGlobalComputeContext,
  initializeGlobalComputeContext,
  type ComputePipelineConfig,
  type ComputeBufferConfig,
  type DispatchConfig,
  type BufferReadBackResult,
  type IndirectDrawParams,
  type IndexedIndirectDrawParams,
} from "./RuntimeComputeContext";

// Buffer pool management
export {
  ComputeBufferPool,
  TypedBufferHelper,
  BUFFER_SIZE_TIERS,
  type PooledBuffer,
  type BufferPoolConfig,
  type DoubleBuffer,
} from "./ComputeBufferPool";

// WGSL shader utilities
export {
  WGSL_CONSTANTS,
  WGSL_FRUSTUM,
  WGSL_DISTANCE,
  WGSL_DITHERING,
  WGSL_INTERPOLATION,
  WGSL_HASH,
  WGSL_REDUCTION,
  WGSL_MATRIX,
  WGSL_ATOMICS,
  WGSL_COMMON,
  WGSL_COMMON_EXTENDED,
  WGSL_ALL_UTILITIES,
} from "./shaders/common.wgsl";

// Culling shaders
export {
  WGSL_CULLING_STRUCTS,
  CULLING_SHADER,
  CULLING_SIMD_SHADER,
  CULLING_WITH_LOD_SHADER,
  CULLING_COMPACT_MATRICES_SHADER,
  RESET_DRAW_PARAMS_SHADER,
  VEGETATION_CULLING_SHADER,
  TEMPORAL_CULLING_SHADER,
  INIT_VISIBILITY_HINTS_SHADER,
  CULLING_SHADERS,
} from "./shaders/culling.wgsl";

// Particle shaders
export {
  WGSL_PARTICLE_STRUCTS,
  PARTICLE_PHYSICS_SHADER,
  PARTICLE_PHYSICS_SUBGROUP_SHADER,
  PARTICLE_EMITTER_SHADER,
  PARTICLE_COMPACT_SHADER,
  PARTICLE_COMPACT_SUBGROUP_SHADER,
  PARTICLE_SORT_SHADER,
  PARTICLE_SHADERS,
  supportsSubgroups,
} from "./shaders/particles.wgsl";

// Noise shaders
export {
  WGSL_NOISE_FUNCTIONS,
  WGSL_TERRAIN_NOISE,
  NOISE_SHADERS,
  generatePermutationTable,
} from "./shaders/noise.wgsl";

// Terrain shaders
export {
  WGSL_TERRAIN_STRUCTS,
  TERRAIN_HEIGHTMAP_SHADER,
  TERRAIN_HEIGHTMAP_COLOR_SHADER,
  ROAD_INFLUENCE_SHADER,
  TERRAIN_VERTEX_COLOR_SHADER,
  INSTANCE_MATRIX_SHADER,
  BATCH_DISTANCE_SHADER,
  TERRAIN_SHADERS,
} from "./shaders/terrain.wgsl";

// Heightmap generation shaders
export {
  WGSL_HEIGHTMAP_STRUCTS,
  HEIGHTMAP_GENERATION_SHADER,
  HEIGHTMAP_COLOR_GENERATION_SHADER,
  HEIGHTMAP_SHADERS,
} from "./shaders/heightmap.wgsl";

// Grass shaders
export {
  WGSL_GRASS_STRUCTS,
  GRASS_PLACEMENT_SHADER,
  GRASS_CULLING_SHADER,
  GRASS_COMBINED_SHADER,
  GRASS_SHADERS,
} from "./shaders/grass.wgsl";

// GPU Culling Manager
export {
  GPUCullingManager,
  shouldUseGPUCulling,
  matricesToFloat32Array,
  getGlobalCullingManager,
  type CullingGroupConfig,
  type CullingGroup,
  type FrustumData,
} from "./GPUCullingManager";

// GPU Compute Integration (unified manager for all GPU compute systems)
export {
  GPUComputeManager,
  GPUGrassManager,
  GPUParticleManager,
  GPUTerrainManager,
  getGPUComputeManager,
  initializeGPUCompute,
  isGPUComputeAvailable,
  type GPUComputeCapabilities,
  type GrassChunkGPU,
  type GrassPlacementConfig,
  type GrassCullConfig,
  type ParticleSystemGPU,
  type ParticlePhysicsConfig,
  type ParticleEmitterConfig,
  type TerrainTileGPU,
  type TerrainGenerationConfig,
} from "./GPUComputeIntegration";

// GPU Compute Hooks (integration with World and rendering systems)
export {
  setupGPUCompute,
  updateGPUCompute,
  updateGPUParticles,
  registerGPUGrassChunk,
  unregisterGPUGrassChunk,
  createGPUParticleSystem,
  destroyGPUParticleSystem,
  createGPUTerrainTile,
  destroyGPUTerrainTile,
  readGPUHeightmap,
  cleanupGPUCompute,
} from "./GPUComputeHooks";

// Terrain Compute Context
export {
  TerrainComputeContext,
  getGlobalTerrainComputeContext,
  initializeGlobalTerrainComputeContext,
  isTerrainComputeAvailable,
  type GPURoadSegment,
  type GPUBiomeData,
  type GPUInstanceTRS,
  type TerrainComputeConfig,
} from "./TerrainComputeContext";

// Networking Compute Context
export {
  NetworkingComputeContext,
  getGlobalNetworkingComputeContext,
  isNetworkingComputeAvailable,
  type GPUEntityInterest,
  type GPUPlayerPosition,
  type GPUSpatialQuery,
  type GPUSpatialCandidate,
  type GPUSpatialResult,
  type GPUMobData,
  type GPUAggroResult,
  type GPUAABB,
  type GPUOverlapPair,
  type GPUSoundSource,
  type GPUListener,
  type GPUSpawnCandidate,
  type GPUOccupiedPosition,
  type GPUSpawnResult,
  type GPULootDrop,
  type GPULootPlayer,
  type GPULootResult,
  type NetworkingComputeConfig,
} from "./NetworkingComputeContext";

// Networking shaders
export {
  INTEREST_MANAGEMENT_SHADER,
  INTEREST_MANAGEMENT_PER_ENTITY_SHADER,
  SPATIAL_RANGE_QUERY_SHADER,
  BATCH_AGGRO_CHECK_SHADER,
  NEAREST_ENTITY_SHADER,
  PHYSICS_BROADPHASE_SHADER,
  SOUND_OCCLUSION_SHADER,
  SPAWN_VALIDATION_SHADER,
  LOOT_DISTRIBUTION_SHADER,
  NETWORKING_SHADERS,
} from "./shaders/networking.wgsl";
