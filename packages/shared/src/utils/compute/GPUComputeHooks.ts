/**
 * GPU Compute Hooks
 *
 * Integration hooks for connecting GPU compute infrastructure to
 * the World and rendering systems.
 *
 * ## Usage
 *
 * In ClientGraphics.init():
 * ```typescript
 * import { setupGPUCompute } from '../utils/compute/GPUComputeHooks';
 *
 * async init() {
 *   // After renderer is created...
 *   const gpuCompute = setupGPUCompute(this.renderer, this.world);
 *   if (gpuCompute) {
 *     console.log('GPU compute initialized');
 *   }
 * }
 * ```
 *
 * In system update loops:
 * ```typescript
 * import { getGPUComputeManager, isGPUComputeAvailable } from '../utils/compute';
 *
 * update(delta: number) {
 *   if (isGPUComputeAvailable()) {
 *     const gpuCompute = getGPUComputeManager();
 *     gpuCompute.grass?.updateFrustum(camera);
 *   }
 * }
 * ```
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import {
  GPUComputeManager,
  getGPUComputeManager,
  isGPUComputeAvailable,
} from "./GPUComputeIntegration";
import {
  isWebGPURenderer,
  getGlobalComputeContext,
} from "./RuntimeComputeContext";
import { updateSharedDissolveUniforms } from "../rendering/DistanceFade";

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Set up GPU compute infrastructure for a world.
 *
 * @param renderer - Three.js renderer (WebGPU or WebGL)
 * @param world - The game world instance
 * @returns The GPU compute manager if initialized, null otherwise
 */
export function setupGPUCompute(
  renderer: THREE.Renderer,
  world: World,
): GPUComputeManager | null {
  const manager = getGPUComputeManager();

  // Get world seed for deterministic terrain generation
  const seed = getWorldSeed(world);

  // Initialize GPU compute
  const success = manager.initialize(renderer, seed);

  if (success) {
    console.log("[GPUComputeHooks] GPU compute initialized successfully", {
      capabilities: manager.capabilities,
      grass: !!manager.grass?.isReady(),
      particles: !!manager.particles?.isReady(),
      terrain: !!manager.terrain?.isReady(),
    });
    return manager;
  }

  if (isWebGPURenderer(renderer)) {
    console.warn(
      "[GPUComputeHooks] WebGPU renderer detected but GPU compute failed to initialize",
    );
  } else {
    console.log(
      "[GPUComputeHooks] WebGL renderer detected, GPU compute not available",
    );
  }

  return null;
}

/**
 * Get the world seed for deterministic generation.
 */
function getWorldSeed(world: World): number {
  const worldOptions = world as unknown as { options?: { id?: string } };
  const worldId = worldOptions.options?.id || "default";
  let hash = 0;
  for (let i = 0; i < worldId.length; i++) {
    const char = worldId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ============================================================================
// PER-FRAME UPDATE HOOKS
// ============================================================================

/**
 * Update GPU compute state each frame.
 * Call this in the main render loop.
 *
 * @param camera - The main camera
 * @param delta - Time delta since last frame
 * @param playerPosition - Optional player position for occlusion dissolve
 */
export function updateGPUCompute(
  camera: THREE.Camera,
  delta: number,
  playerPosition?: THREE.Vector3,
): void {
  // Advance staging buffer pool frame counter for cleanup
  const context = getGlobalComputeContext();
  if (context.isReady()) {
    context.advanceFrame();
  }

  // Update shared dissolve uniforms (for materials using shared uniforms)
  const camPos = camera.position;
  const playerPos = playerPosition ?? camPos;
  updateSharedDissolveUniforms(
    camPos.x,
    camPos.y,
    camPos.z,
    playerPos.x,
    playerPos.y,
    playerPos.z,
  );

  if (!isGPUComputeAvailable()) return;

  const manager = getGPUComputeManager();

  // Update grass frustum for culling
  manager.grass?.updateFrustum(camera);
}

/**
 * Update particle systems on GPU.
 *
 * @param systemId - The particle system ID
 * @param config - Physics configuration
 */
export function updateGPUParticles(
  systemId: string,
  config: {
    delta: number;
    gravity: number;
    windDirection: THREE.Vector3;
    windStrength: number;
  },
): void {
  if (!isGPUComputeAvailable()) return;

  const manager = getGPUComputeManager();
  if (!manager.particles) return;

  manager.particles.updatePhysics(systemId, {
    delta: config.delta,
    gravity: config.gravity,
    maxLife: 5.0,
    sizeStart: 1.0,
    sizeEnd: 0.1,
    alphaStart: 1.0,
    alphaEnd: 0.0,
    windDirection: config.windDirection,
    windStrength: config.windStrength,
    groundLevel: -1000,
    bounciness: 0,
  });
}

// ============================================================================
// GRASS INTEGRATION HOOKS
// ============================================================================

/**
 * Register a grass chunk for GPU processing.
 *
 * @param key - Chunk key "x_z"
 * @param originX - Chunk world X origin
 * @param originZ - Chunk world Z origin
 * @param maxInstances - Maximum grass instances in chunk
 */
export function registerGPUGrassChunk(
  key: string,
  originX: number,
  originZ: number,
  maxInstances: number,
): boolean {
  if (!isGPUComputeAvailable()) return false;

  const manager = getGPUComputeManager();
  if (!manager.grass?.isReady()) return false;

  manager.grass.registerChunk(key, originX, originZ, maxInstances);
  return true;
}

/**
 * Unregister a grass chunk from GPU processing.
 *
 * @param key - Chunk key "x_z"
 */
export function unregisterGPUGrassChunk(key: string): void {
  if (!isGPUComputeAvailable()) return;

  const manager = getGPUComputeManager();
  manager.grass?.unregisterChunk(key);
}

// ============================================================================
// PARTICLE INTEGRATION HOOKS
// ============================================================================

/**
 * Create a particle system on GPU.
 *
 * @param id - Unique system ID
 * @param maxParticles - Maximum particle count
 */
export function createGPUParticleSystem(
  id: string,
  maxParticles: number,
): boolean {
  if (!isGPUComputeAvailable()) return false;

  const manager = getGPUComputeManager();
  if (!manager.particles?.isReady()) return false;

  manager.particles.createSystem(id, maxParticles);
  return true;
}

/**
 * Destroy a particle system on GPU.
 *
 * @param id - System ID to destroy
 */
export function destroyGPUParticleSystem(id: string): void {
  if (!isGPUComputeAvailable()) return;

  const manager = getGPUComputeManager();
  manager.particles?.destroySystem(id);
}

// ============================================================================
// TERRAIN INTEGRATION HOOKS
// ============================================================================

/**
 * Create a terrain tile for GPU heightmap generation.
 *
 * @param key - Tile key "x_z"
 * @param originX - Tile world X origin
 * @param originZ - Tile world Z origin
 * @param resolution - Heightmap resolution (e.g., 64)
 * @param spacing - Distance between vertices
 */
export function createGPUTerrainTile(
  key: string,
  originX: number,
  originZ: number,
  resolution: number,
  spacing: number,
): boolean {
  if (!isGPUComputeAvailable()) return false;

  const manager = getGPUComputeManager();
  if (!manager.terrain?.isReady()) return false;

  manager.terrain.createTile(key, originX, originZ, resolution, spacing);
  return true;
}

/**
 * Destroy a terrain tile on GPU.
 *
 * @param key - Tile key to destroy
 */
export function destroyGPUTerrainTile(key: string): void {
  if (!isGPUComputeAvailable()) return;

  const manager = getGPUComputeManager();
  manager.terrain?.destroyTile(key);
}

/**
 * Read back the heightmap data from GPU (async).
 *
 * @param key - Tile key
 * @returns Float32Array of heights or null
 */
export async function readGPUHeightmap(
  key: string,
): Promise<Float32Array | null> {
  if (!isGPUComputeAvailable()) return null;

  const manager = getGPUComputeManager();
  return manager.terrain?.readHeightmap(key) ?? null;
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clean up all GPU compute resources.
 * Call this when the world is destroyed.
 */
export function cleanupGPUCompute(): void {
  const manager = getGPUComputeManager();
  manager.destroy();
}
