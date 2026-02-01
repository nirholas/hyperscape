/**
 * GPU Compute Integration
 *
 * Provides integration between the WebGPU compute infrastructure and
 * existing game systems (ProceduralGrassSystem, Particles, TerrainSystem, etc.)
 *
 * This module creates managers that can be used alongside existing systems
 * to provide GPU acceleration when WebGPU is available.
 */

import THREE from "../../extras/three/three";
import {
  RuntimeComputeContext,
  isWebGPUAvailable,
  isWebGPURenderer,
} from "./RuntimeComputeContext";
import { ComputeBufferPool } from "./ComputeBufferPool";
import {
  GRASS_PLACEMENT_SHADER,
  GRASS_CULLING_SHADER,
} from "./shaders/grass.wgsl";
import {
  PARTICLE_PHYSICS_SHADER,
  PARTICLE_PHYSICS_SUBGROUP_SHADER,
  PARTICLE_EMITTER_SHADER,
  PARTICLE_COMPACT_SHADER,
  PARTICLE_COMPACT_SUBGROUP_SHADER,
  supportsSubgroups,
} from "./shaders/particles.wgsl";
import { HEIGHTMAP_GENERATION_SHADER } from "./shaders/heightmap.wgsl";
import { generatePermutationTable } from "./shaders/noise.wgsl";

// ============================================================================
// TYPES
// ============================================================================

export interface GPUComputeCapabilities {
  available: boolean;
  webgpuRenderer: boolean;
  maxStorageBufferSize: number;
  maxComputeWorkgroupSize: number;
}

// ============================================================================
// GPU GRASS MANAGER
// ============================================================================

export interface GrassChunkGPU {
  key: string;
  originX: number;
  originZ: number;
  instanceBuffer: GPUBuffer | null;
  visibleBuffer: GPUBuffer | null;
  indirectBuffer: GPUBuffer | null;
  instanceCount: number;
  dirty: boolean;
}

export interface GrassPlacementConfig {
  originX: number;
  originZ: number;
  chunkSize: number;
  cellSize: number;
  baseDensity: number;
  maxInstances: number;
  seed: number;
  waterLevel: number;
  maxSlope: number;
  heightScaleMin: number;
  heightScaleMax: number;
  widthScaleMin: number;
  widthScaleMax: number;
  colorVarMin: number;
  colorVarMax: number;
}

export interface GrassCullConfig {
  cameraPos: THREE.Vector3;
  cullDistance: number;
  lodHalfDensity: number;
  lodQuarterDensity: number;
  lodEighthDensity: number;
}

/**
 * GPU-accelerated grass placement and culling.
 */
export class GPUGrassManager {
  private context: RuntimeComputeContext;
  private bufferPool: ComputeBufferPool;
  private placementPipeline: GPUComputePipeline | null = null;
  private cullingPipeline: GPUComputePipeline | null = null;
  private chunks: Map<string, GrassChunkGPU> = new Map();
  private frustumBuffer: GPUBuffer | null = null;
  private initialized = false;

  private _frustum = new THREE.Frustum();
  private _projMatrix = new THREE.Matrix4();
  private frustumData = new Float32Array(24);

  constructor() {
    this.context = new RuntimeComputeContext();
    this.bufferPool = new ComputeBufferPool(this.context);
  }

  initialize(renderer: THREE.WebGPURenderer): boolean {
    if (!this.context.initializeFromRenderer(renderer)) {
      console.warn("[GPUGrassManager] WebGPU not available");
      return false;
    }

    // Pre-warm buffer pool to avoid allocation spikes during gameplay
    this.bufferPool.warmup({
      storageSizes: [65536, 262144, 1048576], // 64KB, 256KB, 1MB for grass instances
      uniformSizes: [64, 256], // Params buffers
      indirectCount: 4,
    });

    this.placementPipeline = this.context.createPipeline({
      label: "GrassPlacement",
      code: GRASS_PLACEMENT_SHADER,
      entryPoint: "main",
    });

    this.cullingPipeline = this.context.createPipeline({
      label: "GrassCulling",
      code: GRASS_CULLING_SHADER,
      entryPoint: "main",
    });

    this.frustumBuffer = this.context.createBuffer({
      label: "GrassFrustum",
      size: 24 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.initialized =
      this.placementPipeline !== null && this.cullingPipeline !== null;
    return this.initialized;
  }

  isReady(): boolean {
    return this.initialized;
  }

  registerChunk(
    key: string,
    originX: number,
    originZ: number,
    maxInstances: number,
  ): void {
    if (this.chunks.has(key)) return;

    const chunk: GrassChunkGPU = {
      key,
      originX,
      originZ,
      instanceBuffer: this.context.createBuffer({
        label: `grass_instances_${key}`,
        size: maxInstances * 32, // GrassInstance = 32 bytes
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      visibleBuffer: this.context.createBuffer({
        label: `grass_visible_${key}`,
        size: maxInstances * 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      indirectBuffer: this.context.createBuffer({
        label: `grass_indirect_${key}`,
        size: 16,
        usage:
          GPUBufferUsage.INDIRECT |
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST,
      }),
      instanceCount: 0,
      dirty: true,
    };

    this.chunks.set(key, chunk);
  }

  unregisterChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.instanceBuffer?.destroy();
      chunk.visibleBuffer?.destroy();
      chunk.indirectBuffer?.destroy();
      this.chunks.delete(key);
    }
  }

  updateFrustum(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix?.();

    this._projMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projMatrix);

    for (let i = 0; i < 6; i++) {
      const plane = this._frustum.planes[i];
      this.frustumData[i * 4 + 0] = plane.normal.x;
      this.frustumData[i * 4 + 1] = plane.normal.y;
      this.frustumData[i * 4 + 2] = plane.normal.z;
      this.frustumData[i * 4 + 3] = plane.constant;
    }

    if (this.frustumBuffer) {
      this.context.uploadToBuffer(this.frustumBuffer, this.frustumData);
    }
  }

  getChunkInstanceBuffer(key: string): GPUBuffer | null {
    return this.chunks.get(key)?.instanceBuffer ?? null;
  }

  getChunkVisibleBuffer(key: string): GPUBuffer | null {
    return this.chunks.get(key)?.visibleBuffer ?? null;
  }

  getChunkIndirectBuffer(key: string): GPUBuffer | null {
    return this.chunks.get(key)?.indirectBuffer ?? null;
  }

  destroy(): void {
    for (const key of this.chunks.keys()) {
      this.unregisterChunk(key);
    }
    this.frustumBuffer?.destroy();
    this.bufferPool.destroy();
    this.context.destroy();
    this.initialized = false;
  }
}

// ============================================================================
// GPU PARTICLE MANAGER
// ============================================================================

export interface ParticleSystemGPU {
  id: string;
  maxParticles: number;
  particleBuffer: GPUBuffer | null;
  liveCountBuffer: GPUBuffer | null;
  paramsBuffer: GPUBuffer | null;
  emitterBuffer: GPUBuffer | null;
}

export interface ParticlePhysicsConfig {
  delta: number;
  gravity: number;
  maxLife: number;
  sizeStart: number;
  sizeEnd: number;
  alphaStart: number;
  alphaEnd: number;
  windDirection: THREE.Vector3;
  windStrength: number;
  groundLevel: number;
  bounciness: number;
}

export interface ParticleEmitterConfig {
  position: THREE.Vector3;
  shape: number;
  rate: number;
  burstCount: number;
  shapeParam1: THREE.Vector3;
  shapeParam2: number;
  lifeMin: number;
  lifeMax: number;
  speedMin: number;
  speedMax: number;
  sizeMin: number;
  sizeMax: number;
  rotationMin: number;
  rotationMax: number;
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
  directionBase: THREE.Vector3;
  directionSpread: number;
}

/**
 * GPU-accelerated particle physics and emission.
 */
export class GPUParticleManager {
  private context: RuntimeComputeContext;
  private bufferPool: ComputeBufferPool;
  private physicsPipeline: GPUComputePipeline | null = null;
  private emitterPipeline: GPUComputePipeline | null = null;
  private compactPipeline: GPUComputePipeline | null = null;
  private systems: Map<string, ParticleSystemGPU> = new Map();
  private initialized = false;
  private frameCount = 0;
  private useSubgroups = false;

  constructor() {
    this.context = new RuntimeComputeContext();
    this.bufferPool = new ComputeBufferPool(this.context);
  }

  initialize(renderer: THREE.WebGPURenderer): boolean {
    if (!this.context.initializeFromRenderer(renderer)) {
      console.warn("[GPUParticleManager] WebGPU not available");
      return false;
    }

    // Pre-warm buffer pool for particle systems
    this.bufferPool.warmup({
      storageSizes: [65536, 262144, 1048576, 4194304], // For particle buffers (80 bytes each)
      uniformSizes: [64, 256], // Params and emitter configs
      stagingSizes: [1024, 16384], // For live count read-backs
    });

    const device = this.context.getDevice();

    // Check for subgroup support and use optimized shaders if available
    this.useSubgroups = device ? supportsSubgroups(device) : false;

    if (this.useSubgroups) {
      console.log(
        "[GPUParticleManager] Subgroup operations supported, using optimized shaders",
      );

      this.physicsPipeline = this.context.createPipeline({
        label: "ParticlePhysicsSubgroup",
        code: PARTICLE_PHYSICS_SUBGROUP_SHADER,
        entryPoint: "main",
      });

      this.compactPipeline = this.context.createPipeline({
        label: "ParticleCompactSubgroup",
        code: PARTICLE_COMPACT_SUBGROUP_SHADER,
        entryPoint: "main",
      });
    } else {
      this.physicsPipeline = this.context.createPipeline({
        label: "ParticlePhysics",
        code: PARTICLE_PHYSICS_SHADER,
        entryPoint: "main",
      });

      this.compactPipeline = this.context.createPipeline({
        label: "ParticleCompact",
        code: PARTICLE_COMPACT_SHADER,
        entryPoint: "main",
      });
    }

    this.emitterPipeline = this.context.createPipeline({
      label: "ParticleEmitter",
      code: PARTICLE_EMITTER_SHADER,
      entryPoint: "main",
    });

    this.initialized =
      this.physicsPipeline !== null &&
      this.emitterPipeline !== null &&
      this.compactPipeline !== null;

    return this.initialized;
  }

  /**
   * Check if subgroup operations are being used.
   */
  isUsingSubgroups(): boolean {
    return this.useSubgroups;
  }

  isReady(): boolean {
    return this.initialized;
  }

  createSystem(id: string, maxParticles: number): void {
    if (this.systems.has(id)) return;

    const particleSize = 80; // Particle struct size
    const system: ParticleSystemGPU = {
      id,
      maxParticles,
      particleBuffer: this.context.createBuffer({
        label: `particles_${id}`,
        size: maxParticles * particleSize,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      }),
      liveCountBuffer: this.context.createBuffer({
        label: `particles_live_${id}`,
        size: 4,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      }),
      paramsBuffer: this.context.createBuffer({
        label: `particles_params_${id}`,
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      emitterBuffer: this.context.createBuffer({
        label: `particles_emitter_${id}`,
        size: 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };

    // Initialize particle buffer with zeros (all particles dead)
    if (system.particleBuffer) {
      const zeros = new Float32Array(maxParticles * (particleSize / 4));
      this.context.uploadToBuffer(system.particleBuffer, zeros);
    }

    this.systems.set(id, system);
  }

  destroySystem(id: string): void {
    const system = this.systems.get(id);
    if (system) {
      system.particleBuffer?.destroy();
      system.liveCountBuffer?.destroy();
      system.paramsBuffer?.destroy();
      system.emitterBuffer?.destroy();
      this.systems.delete(id);
    }
  }

  updatePhysics(id: string, config: ParticlePhysicsConfig): void {
    const system = this.systems.get(id);
    if (
      !system ||
      !this.physicsPipeline ||
      !system.particleBuffer ||
      !system.paramsBuffer
    ) {
      return;
    }

    // Pack physics params
    const params = new Float32Array(16);
    params[0] = config.delta;
    params[1] = config.gravity;
    const paramsView = new DataView(params.buffer);
    paramsView.setUint32(2 * 4, system.maxParticles, true);
    params[3] = this.frameCount * config.delta;
    params[4] = config.sizeStart;
    params[5] = config.sizeEnd;
    params[6] = config.alphaStart;
    params[7] = config.alphaEnd;
    params[8] = config.windDirection.x;
    params[9] = config.windDirection.y;
    params[10] = config.windDirection.z;
    params[11] = config.windStrength;
    params[12] = config.groundLevel;
    params[13] = config.bounciness;

    this.context.uploadToBuffer(system.paramsBuffer, params);

    // Reset live count
    if (system.liveCountBuffer) {
      const zero = new Uint32Array([0]);
      this.context.uploadToBuffer(system.liveCountBuffer, zero);
    }

    // Create bind group and dispatch
    const bindGroup = this.context.createBindGroup(this.physicsPipeline, [
      { binding: 0, resource: { buffer: system.particleBuffer } },
      { binding: 1, resource: { buffer: system.paramsBuffer } },
      { binding: 2, resource: { buffer: system.liveCountBuffer! } },
    ]);

    if (bindGroup) {
      this.context.dispatch({
        pipeline: this.physicsPipeline,
        bindGroup,
        workgroupCount: this.context.calculateWorkgroupCount(
          system.maxParticles,
          64,
        ),
      });
    }

    this.frameCount++;
  }

  getParticleBuffer(id: string): GPUBuffer | null {
    return this.systems.get(id)?.particleBuffer ?? null;
  }

  async getLiveCount(id: string): Promise<number> {
    const system = this.systems.get(id);
    if (!system?.liveCountBuffer) return 0;

    const data = await this.context.readUint32Buffer(system.liveCountBuffer, 1);
    return data[0];
  }

  destroy(): void {
    for (const id of this.systems.keys()) {
      this.destroySystem(id);
    }
    this.bufferPool.destroy();
    this.context.destroy();
    this.initialized = false;
  }
}

// ============================================================================
// GPU TERRAIN MANAGER
// ============================================================================

export interface TerrainTileGPU {
  key: string;
  originX: number;
  originZ: number;
  resolution: number;
  spacing: number;
  heightmapBuffer: GPUBuffer | null;
  colormapBuffer: GPUBuffer | null;
}

export interface TerrainGenerationConfig {
  originX: number;
  originZ: number;
  resolution: number;
  spacing: number;
  maxHeight: number;
  waterLevel: number;
  baseElevation: number;
  islandRadius: number;
  islandFalloff: number;
  islandCenterX: number;
  islandCenterZ: number;
}

/**
 * GPU-accelerated terrain heightmap generation.
 */
export class GPUTerrainManager {
  private context: RuntimeComputeContext;
  private bufferPool: ComputeBufferPool;
  private heightmapPipeline: GPUComputePipeline | null = null;
  private permutationBuffer: GPUBuffer | null = null;
  private tiles: Map<string, TerrainTileGPU> = new Map();
  private initialized = false;

  constructor() {
    this.context = new RuntimeComputeContext();
    this.bufferPool = new ComputeBufferPool(this.context);
  }

  initialize(renderer: THREE.WebGPURenderer, seed: number = 0): boolean {
    if (!this.context.initializeFromRenderer(renderer)) {
      console.warn("[GPUTerrainManager] WebGPU not available");
      return false;
    }

    // Pre-warm buffer pool for terrain heightmaps
    this.bufferPool.warmup({
      storageSizes: [16384, 65536, 262144], // For heightmap data (64x64, 128x128, 256x256)
      uniformSizes: [64, 256, 2048], // Params and permutation tables
      stagingSizes: [16384, 65536], // For heightmap read-backs
    });

    this.heightmapPipeline = this.context.createPipeline({
      label: "HeightmapGeneration",
      code: HEIGHTMAP_GENERATION_SHADER,
      entryPoint: "main",
    });

    // Create and upload permutation table
    const permTable = generatePermutationTable(seed);
    this.permutationBuffer = this.context.createBuffer({
      label: "PermutationTable",
      size: 512 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    if (this.permutationBuffer) {
      this.context.uploadToBuffer(this.permutationBuffer, permTable);
    }

    this.initialized = this.heightmapPipeline !== null;
    return this.initialized;
  }

  isReady(): boolean {
    return this.initialized;
  }

  createTile(
    key: string,
    originX: number,
    originZ: number,
    resolution: number,
    spacing: number,
  ): void {
    if (this.tiles.has(key)) return;

    const vertexCount = resolution * resolution;
    const tile: TerrainTileGPU = {
      key,
      originX,
      originZ,
      resolution,
      spacing,
      heightmapBuffer: this.context.createBuffer({
        label: `terrain_heightmap_${key}`,
        size: vertexCount * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      colormapBuffer: this.context.createBuffer({
        label: `terrain_colormap_${key}`,
        size: vertexCount * 16, // vec4
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
    };

    this.tiles.set(key, tile);
  }

  destroyTile(key: string): void {
    const tile = this.tiles.get(key);
    if (tile) {
      tile.heightmapBuffer?.destroy();
      tile.colormapBuffer?.destroy();
      this.tiles.delete(key);
    }
  }

  async readHeightmap(key: string): Promise<Float32Array | null> {
    const tile = this.tiles.get(key);
    if (!tile?.heightmapBuffer) return null;

    const size = tile.resolution * tile.resolution;
    return this.context.readFloat32Buffer(tile.heightmapBuffer, size);
  }

  getHeightmapBuffer(key: string): GPUBuffer | null {
    return this.tiles.get(key)?.heightmapBuffer ?? null;
  }

  destroy(): void {
    for (const key of this.tiles.keys()) {
      this.destroyTile(key);
    }
    this.permutationBuffer?.destroy();
    this.bufferPool.destroy();
    this.context.destroy();
    this.initialized = false;
  }
}

// ============================================================================
// GLOBAL COMPUTE MANAGER
// ============================================================================

/**
 * Central manager for all GPU compute systems.
 * Provides a single entry point for initializing and accessing
 * GPU acceleration features.
 *
 * Uses lazy initialization - sub-managers are only created when first accessed.
 * This reduces initial load time and memory usage for features not being used.
 */
export class GPUComputeManager {
  private renderer: THREE.WebGPURenderer | null = null;
  private _seed: number = 0;
  private _capabilities: GPUComputeCapabilities | null = null;

  // Lazy-initialized managers
  private _grass: GPUGrassManager | null = null;
  private _grassInitialized = false;
  private _particles: GPUParticleManager | null = null;
  private _particlesInitialized = false;
  private _terrain: GPUTerrainManager | null = null;
  private _terrainInitialized = false;

  /**
   * Initialize GPU compute from a Three.js renderer.
   * Returns true if WebGPU is available and renderer supports it.
   *
   * Note: Sub-managers are lazily initialized on first access,
   * not during this call. This improves initial load time.
   */
  initialize(renderer: THREE.Renderer, seed: number = 0): boolean {
    if (!isWebGPUAvailable()) {
      this._capabilities = {
        available: false,
        webgpuRenderer: false,
        maxStorageBufferSize: 0,
        maxComputeWorkgroupSize: 0,
      };
      return false;
    }

    if (!isWebGPURenderer(renderer)) {
      this._capabilities = {
        available: true,
        webgpuRenderer: false,
        maxStorageBufferSize: 0,
        maxComputeWorkgroupSize: 0,
      };
      return false;
    }

    this.renderer = renderer as THREE.WebGPURenderer;
    this._seed = seed;

    this._capabilities = {
      available: true,
      webgpuRenderer: true,
      maxStorageBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupSize: 256,
    };

    return true;
  }

  /**
   * Eagerly initialize all sub-managers.
   * Call this during a loading screen to avoid first-access latency.
   */
  preloadAll(): { grass: boolean; particles: boolean; terrain: boolean } {
    return {
      grass: this.initializeGrass(),
      particles: this.initializeParticles(),
      terrain: this.initializeTerrain(),
    };
  }

  /**
   * Get GPU compute capabilities.
   */
  get capabilities(): GPUComputeCapabilities {
    return (
      this._capabilities ?? {
        available: false,
        webgpuRenderer: false,
        maxStorageBufferSize: 0,
        maxComputeWorkgroupSize: 0,
      }
    );
  }

  /**
   * Check if GPU compute is available.
   */
  isAvailable(): boolean {
    return (
      this._capabilities?.available === true &&
      this._capabilities?.webgpuRenderer === true
    );
  }

  // ==========================================================================
  // LAZY INITIALIZATION METHODS
  // ==========================================================================

  private initializeGrass(): boolean {
    if (this._grassInitialized) return this._grass?.isReady() ?? false;
    this._grassInitialized = true;

    if (!this.renderer) return false;

    this._grass = new GPUGrassManager();
    const ready = this._grass.initialize(this.renderer);
    if (!ready) {
      console.warn("[GPUComputeManager] Grass manager failed to initialize");
    }
    return ready;
  }

  private initializeParticles(): boolean {
    if (this._particlesInitialized) return this._particles?.isReady() ?? false;
    this._particlesInitialized = true;

    if (!this.renderer) return false;

    this._particles = new GPUParticleManager();
    const ready = this._particles.initialize(this.renderer);
    if (!ready) {
      console.warn("[GPUComputeManager] Particle manager failed to initialize");
    }
    return ready;
  }

  private initializeTerrain(): boolean {
    if (this._terrainInitialized) return this._terrain?.isReady() ?? false;
    this._terrainInitialized = true;

    if (!this.renderer) return false;

    this._terrain = new GPUTerrainManager();
    const ready = this._terrain.initialize(this.renderer, this._seed);
    if (!ready) {
      console.warn("[GPUComputeManager] Terrain manager failed to initialize");
    }
    return ready;
  }

  // ==========================================================================
  // MANAGER ACCESSORS (lazy initialization)
  // ==========================================================================

  /**
   * Get the grass manager (GPU-accelerated grass placement and culling).
   * Lazily initialized on first access.
   */
  get grass(): GPUGrassManager | null {
    if (!this.isAvailable()) return null;
    if (!this._grassInitialized) {
      this.initializeGrass();
    }
    return this._grass;
  }

  /**
   * Get the particle manager (GPU-accelerated particle physics).
   * Lazily initialized on first access.
   */
  get particles(): GPUParticleManager | null {
    if (!this.isAvailable()) return null;
    if (!this._particlesInitialized) {
      this.initializeParticles();
    }
    return this._particles;
  }

  /**
   * Get the terrain manager (GPU-accelerated heightmap generation).
   * Lazily initialized on first access.
   */
  get terrain(): GPUTerrainManager | null {
    if (!this.isAvailable()) return null;
    if (!this._terrainInitialized) {
      this.initializeTerrain();
    }
    return this._terrain;
  }

  /**
   * Check which managers have been initialized.
   */
  getInitializationStatus(): {
    grass: boolean;
    particles: boolean;
    terrain: boolean;
  } {
    return {
      grass: this._grassInitialized,
      particles: this._particlesInitialized,
      terrain: this._terrainInitialized,
    };
  }

  /**
   * Clean up all GPU resources.
   */
  destroy(): void {
    this._grass?.destroy();
    this._particles?.destroy();
    this._terrain?.destroy();
    this._grass = null;
    this._particles = null;
    this._terrain = null;
    this._grassInitialized = false;
    this._particlesInitialized = false;
    this._terrainInitialized = false;
    this.renderer = null;
    this._capabilities = null;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalComputeManager: GPUComputeManager | null = null;

/**
 * Get the global GPU compute manager instance.
 */
export function getGPUComputeManager(): GPUComputeManager {
  if (!globalComputeManager) {
    globalComputeManager = new GPUComputeManager();
  }
  return globalComputeManager;
}

/**
 * Initialize the global GPU compute manager.
 */
export function initializeGPUCompute(
  renderer: THREE.Renderer,
  seed: number = 0,
): boolean {
  return getGPUComputeManager().initialize(renderer, seed);
}

/**
 * Check if GPU compute is available globally.
 */
export function isGPUComputeAvailable(): boolean {
  return globalComputeManager?.isAvailable() ?? false;
}
