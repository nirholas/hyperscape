// @ts-nocheck -- TSL type definitions are incomplete for compute shaders and Fn() callbacks
/**
 * TypeScript checking disabled due to fundamental @types/three TSL limitations:
 *
 * 1. **Fn() callback signatures**: TSL's Fn() uses array destructuring `([a, b]) => {}`
 *    which @types/three interprets as NodeBuilder iterator access
 *
 * 2. **Fn() call arity**: Fn() returns ShaderNodeFn<[ProxiedObject<...>]> expecting 1 arg,
 *    but runtime API uses spread args: `this.setScale(data, value)` vs `this.setScale([data, value])`
 *
 * 3. **Node type narrowing**: Reassigning variables changes types (ConstNode → MathNode)
 *    which TS incorrectly flags: `let x = float(0); x = x.add(1);` // MathNode not assignable to ConstNode
 *
 * 4. **Compute shader API**: `.compute()` method exists at runtime but not in @types/three
 *
 * 5. **Loop() callback types**: Loop expects `(inputs: { i: number })` but TSL passes `{ i: Node }`
 *
 * These are upstream @types/three issues. Fixes require either:
 * - Upstream type definition improvements
 * - A TSL type wrapper library
 * - Runtime-accurate type overrides
 *
 * The code is correct and tested - only the static types are incompatible.
 */

/**
 * ProceduralGrass.ts - GPU Grass System
 *
 * Key architecture:
 * - SpriteNodeMaterial for billboard grass
 * - Two-buffer SSBO (vec4 + float) with bit-packed data
 * - Visibility NOT used for opacity/scale (only for offscreen culling)
 * - Wind stored as vec2 displacement
 * - Heightmap Y offset integration with terrain system
 *
 * **PERFORMANCE OPTIMIZATIONS:**
 * - Heightmap generation uses chunked async processing (no main thread blocking)
 * - Compute shaders pre-initialized during load (no first-frame spike)
 * - All heavy work done before gameplay starts
 *
 * **RELATED MODULES:**
 * - For standalone grass generation (Asset Forge, viewers), see @hyperscape/procgen GrassGen module
 * - GrassGen provides simpler grass geometry/materials without SSBO compute integration
 *
 * @module ProceduralGrass
 */

import THREE, {
  uniform,
  Fn,
  float,
  vec3,
  vec4,
  vec2,
  sin,
  mix,
  uv,
  floor,
  instanceIndex,
  hash,
  smoothstep,
  clamp,
  remap,
  instancedArray,
  texture,
  fract,
  time,
  max,
  min,
  step,
  normalize,
  dot,
  sqrt,
  viewportCoordinate,
  mod,
  abs,
  add,
  sub,
  mul,
  Loop,
} from "../../../extras/three/three";
import { SpriteNodeMaterial } from "three/webgpu";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { tslUtils } from "../../../utils/TSLUtils";
import { windManager } from "./Wind";
import { VegetationSsboUtils } from "./VegetationSsboUtils";
import { getNoiseTexture, generateNoiseTexture } from "./TerrainShader";
import {
  GrassExclusionGrid,
  getGrassExclusionGrid,
  disposeGrassExclusionGrid,
} from "./GrassExclusionGrid";
import {
  CharacterInfluenceManager,
  getCharacterInfluenceManager,
  disposeCharacterInfluenceManager,
} from "./CharacterInfluenceManager";

// ============================================================================
// ASYNC UTILITIES - Non-blocking main thread helpers
// ============================================================================

/**
 * Yield to browser event loop - allows rendering and input processing
 * Uses requestIdleCallback when available for better scheduling
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 16 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Check if we should yield based on elapsed time
 * @param startTime - Performance.now() timestamp when work started
 * @param budgetMs - Maximum milliseconds before yielding (default 8ms for 60fps)
 */
function shouldYield(startTime: number, budgetMs = 8): boolean {
  return performance.now() - startTime > budgetMs;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// LOD0: Individual grass blades (near player)
const getConfig = () => {
  const BLADE_WIDTH = 0.04;
  const BLADE_HEIGHT = 0.5;
  const TILE_SIZE = 80; // 40m radius
  const BLADES_PER_SIDE = 1024; // ~1M blades

  return {
    BLADE_WIDTH,
    BLADE_HEIGHT,
    BLADE_BOUNDING_SPHERE_RADIUS: BLADE_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    BLADES_PER_SIDE,
    COUNT: BLADES_PER_SIDE * BLADES_PER_SIDE,
    SPACING: TILE_SIZE / BLADES_PER_SIDE,
    WORKGROUP_SIZE: 256,
    SEGMENTS: 4,
  };
};

// LOD1: Grass cards (billboard grass at distance for smooth blend)
const getLOD1Config = () => {
  const CARD_WIDTH = 0.8;
  const CARD_HEIGHT = 0.5;
  const TILE_SIZE = 250; // 125m radius - covers 100m fade
  const CARDS_PER_SIDE = 317; // ~100k cards (2x density)

  return {
    CARD_WIDTH,
    CARD_HEIGHT,
    CARD_BOUNDING_SPHERE_RADIUS: CARD_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    CARDS_PER_SIDE,
    COUNT: CARDS_PER_SIDE * CARDS_PER_SIDE,
    SPACING: TILE_SIZE / CARDS_PER_SIDE,
    WORKGROUP_SIZE: 64,
    // LOD transition
    FADE_IN_START: 5, // Start fading in at 5m
    FADE_IN_END: 10, // Fully visible by 10m
    FADE_OUT_START: 35, // Start fade at 35m
    FADE_OUT_END: 100, // Fade to 0 at 100m (long smooth fade)
  };
};

const config = getConfig();
const lod1Config = getLOD1Config();

// ============================================================================
// UNIFORMS
// ============================================================================

const uniforms = {
  uPlayerPosition: uniform(new THREE.Vector3(0, 0, 0)), // For trail effect only
  uCameraPosition: uniform(new THREE.Vector3(0, 0, 0)), // For distance culling
  uCameraMatrix: uniform(new THREE.Matrix4()),
  uPlayerDeltaXZ: uniform(new THREE.Vector2(0, 0)),
  uCameraForward: uniform(new THREE.Vector3(0, 0, 1)),
  // Scale
  uBladeMinScale: uniform(0.3),
  uBladeMaxScale: uniform(0.8),
  // Trail - Player grass distortion (highly visible)
  uTrailGrowthRate: uniform(0.1), // How fast grass recovers (slower = longer trails)
  uTrailMinScale: uniform(0.1), // Grass flattens to 5% when stepped (very flat)
  uTrailRadius: uniform(0.4), // Trail radius around player
  uTrailRadiusSquared: uniform(0.4 * 0.4),
  uKDown: uniform(0.6), // Crushing speed (higher = instant flatten)
  // Wind - noise-based natural movement
  uWindStrength: uniform(0.3), // Increased for visible wind effect
  uWindSpeed: uniform(0.4), // Increased for more dynamic motion
  uvWindScale: uniform(1.75),
  // Color - MATCHES TERRAIN SHADER EXACTLY
  // TerrainShader.ts: grassGreen = vec3(0.3, 0.55, 0.15), grassDark = vec3(0.22, 0.42, 0.1)
  // Use blend of these for base, tips are 10% lighter
  uBaseColor: uniform(new THREE.Color().setRGB(0.26, 0.48, 0.12)), // Matches terrain grass
  uTipColor: uniform(new THREE.Color().setRGB(0.29, 0.53, 0.14)), // 10% lighter tips
  uAoScale: uniform(0.5), // Subtle AO
  uAoRimSmoothness: uniform(5),
  uAoRadius: uniform(25),
  uAoRadiusSquared: uniform(25 * 25),
  uColorMixFactor: uniform(0.85), // Strong base-to-tip gradient
  uColorVariationStrength: uniform(1.5), // Moderate variation
  uWindColorStrength: uniform(0.6),
  uBaseWindShade: uniform(0.5), // Wind darkening
  uBaseShadeHeight: uniform(1.0),
  // Stochastic distance culling - high density near, faster falloff
  uR0: uniform(23), // Full density within 23m (+15m)
  uR1: uniform(29), // Thin to minimum by 29m (+15m, where Bayer dither starts)
  uPMin: uniform(0.05), // Keep 5% at outer edge for Bayer to work with
  // Distance fade - tight Bayer dither at edge
  uFadeStart: uniform(29), // Start Bayer dither at 29m (+15m)
  uFadeEnd: uniform(33), // Fully faded by 33m (+15m, 4m dither zone)
  // Camera forward bias - extends grass in view direction
  uForwardBias: uniform(15), // More grass in front of camera
  // Rotation
  uBaseBending: uniform(2.0),
  // Bottom fade - dither grass base into ground (0.3 UV = 0.15m on 0.5m blade)
  uBottomFadeHeight: uniform(0.3),
  // Day/Night colors - direct control, lerped by uDayNightMix
  // Day/night tint colors (#DBD1D1 day, #303B45 night)
  uDayColor: uniform(new THREE.Color().setRGB(0.859, 0.82, 0.82)), // #DBD1D1
  uNightColor: uniform(new THREE.Color().setRGB(0.188, 0.231, 0.271)), // #303B45
  uDayNightMix: uniform(1.0), // 1.0 = day, 0.0 = night (set by Environment)
  // Sun direction for terrain-based lighting (normalized, from Environment)
  uSunDirection: uniform(new THREE.Vector3(0.5, 0.7, 0.5).normalize()),
  // Terrain-based lighting parameters
  uTerrainLightAmbient: uniform(0.4), // Minimum ambient light
  uTerrainLightDiffuse: uniform(0.6), // Diffuse contribution
  // Light intensity (shared with LOD1)
  uLightIntensity: uniform(1.0),
  uAmbientIntensity: uniform(0.4),
};

// LOD1 uniforms (grass cards at distance)
const lod1Uniforms = {
  uPlayerPosition: uniforms.uPlayerPosition, // For trail effect
  uCameraPosition: uniforms.uCameraPosition, // For world position/culling (mesh is camera-centered)
  uCameraMatrix: uniforms.uCameraMatrix,
  uCameraForward: uniforms.uCameraForward,
  // LOD1 colors - same as LOD0 for seamless transition
  uBaseColor: uniform(new THREE.Color().setRGB(0.26, 0.48, 0.12)), // Matches LOD0 base
  uTipColor: uniform(new THREE.Color().setRGB(0.29, 0.53, 0.14)), // Matches LOD0 tips
  // Wind (reduced for stability at distance)
  uWindStrength: uniform(0.2),
  uWindSpeed: uniform(0.08),
  // Lighting - shares day/night with LOD0
  uLightIntensity: uniforms.uLightIntensity,
  uAmbientIntensity: uniforms.uAmbientIntensity,
  // LOD1 fade distances (dithered transitions)
  uFadeInStart: uniform(lod1Config.FADE_IN_START),
  uFadeInEnd: uniform(lod1Config.FADE_IN_END),
  uFadeOutStart: uniform(lod1Config.FADE_OUT_START),
  uFadeOutEnd: uniform(lod1Config.FADE_OUT_END),
};

// Noise texture for wind and position variation
let noiseAtlasTexture: THREE.Texture | null = null;

// Heightmap texture for terrain Y offset
let heightmapTexture: THREE.DataTexture | null = null;
let _heightmapMax = 100;

// ============================================================================
// STREAMING HEIGHTMAP CONFIG
// ============================================================================

/**
 * Streaming heightmap configuration.
 * The heightmap follows the player and updates incrementally as terrain loads.
 */
const HEIGHTMAP_CONFIG = {
  /** Texture resolution (power of 2) */
  SIZE: 512,
  /** World size covered by heightmap in meters */
  WORLD_SIZE: 400, // 400m coverage (200m radius around player)
  /** Maximum terrain height for normalization */
  MAX_HEIGHT: 100,
  /** Distance player must move before re-centering heightmap */
  RECENTER_THRESHOLD: 50, // Re-center when player moves 50m from center
  /** Meters per pixel */
  get METERS_PER_PIXEL() {
    return this.WORLD_SIZE / this.SIZE;
  },
} as const;

// ============================================================================
// GRASS SSBO - Three-buffer structure
// ============================================================================
// Buffer1 (vec4):
//   x -> offsetX (local to player)
//   y -> offsetZ (local to player)
//   z -> 0/12 windX - 12/12 windZ
//   w -> 0/8 current scale - 8/8 original scale - 16/1 shadow - 17/1 visibility - 18/6 wind noise factor
//
// Buffer2 (float):
//   0/4 position based noise
//
// Buffer3 (float): HYPERSCAPE ADDITION
//   heightmapY - terrain height at this blade's world position

type InstancedArrayBuffer = ReturnType<typeof instancedArray>;

// Heightmap texture node for compute shader
let heightmapTextureNode: ReturnType<typeof texture> | null = null;
const uHeightmapMax = uniform(100);
const uHeightmapWorldSize = uniform(HEIGHTMAP_CONFIG.WORLD_SIZE);
// Heightmap center position (for streaming heightmap that follows player)
const uHeightmapCenterX = uniform(0);
const uHeightmapCenterZ = uniform(0);

// ============================================================================
// HEIGHTMAP EXPORTS - For flowers and other vegetation systems
// ============================================================================

/**
 * Get the grass heightmap texture node.
 * Flowers and other vegetation should use this instead of VegetationSsboUtils.
 */
export function getGrassHeightmapTextureNode(): ReturnType<
  typeof texture
> | null {
  return heightmapTextureNode;
}

/**
 * Get the grass heightmap uniforms for UV calculation.
 * Use these with the same UV formula as grass for consistent terrain placement.
 */
export function getGrassHeightmapUniforms() {
  return {
    uHeightmapMax,
    uHeightmapWorldSize,
    uHeightmapCenterX,
    uHeightmapCenterZ,
  };
}

// ============================================================================
// EXCLUSION EXPORTS - For flowers and other vegetation systems
// ============================================================================

/**
 * Get the legacy exclusion texture node and uniforms.
 * Used for building/duel arena exclusion.
 */
export function getGrassExclusionTexture() {
  return {
    textureNode: exclusionTextureNode,
    uWorldSize: uExclusionWorldSize,
    uCenterX: uExclusionCenterX,
    uCenterZ: uExclusionCenterZ,
  };
}

/**
 * Get the grid-based exclusion texture node and uniforms.
 * Used for CollisionMatrix-based exclusion (buildings, blocked tiles).
 */
export function getGrassGridExclusionTexture() {
  return {
    textureNode: gridExclusionTextureNode,
    uWorldSize: uGridExclusionWorldSize,
    uCenterX: uGridExclusionCenterX,
    uCenterZ: uGridExclusionCenterZ,
    isEnabled: useGridBasedExclusion,
  };
}

// Road influence texture for grass culling on roads
// IMPORTANT: Initialize with dummy 1x1 texture so shader includes road sampling code at build time
const dummyRoadData = new Float32Array([0]); // 0 = no road influence
const roadInfluenceTexture: THREE.DataTexture = new THREE.DataTexture(
  dummyRoadData,
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType,
);
roadInfluenceTexture.wrapS = THREE.ClampToEdgeWrapping;
roadInfluenceTexture.wrapT = THREE.ClampToEdgeWrapping;
roadInfluenceTexture.minFilter = THREE.LinearFilter;
roadInfluenceTexture.magFilter = THREE.LinearFilter;
roadInfluenceTexture.needsUpdate = true;

const roadInfluenceTextureNode: ReturnType<typeof texture> =
  texture(roadInfluenceTexture);
const uRoadInfluenceWorldSize = uniform(1000); // World size covered by road texture
const uRoadInfluenceCenterX = uniform(0); // World center X (usually 0)
const uRoadInfluenceCenterZ = uniform(0); // World center Z (usually 0)
const uRoadInfluenceThreshold = uniform(0.1); // Grass culling threshold (0.1 = cull at 10% road influence)

/**
 * Get road influence texture and uniforms for use by other vegetation systems (flowers).
 * Allows consistent road exclusion across all vegetation types.
 */
export function getGrassRoadInfluenceTexture() {
  return {
    textureNode: roadInfluenceTextureNode,
    uWorldSize: uRoadInfluenceWorldSize,
    uCenterX: uRoadInfluenceCenterX,
    uCenterZ: uRoadInfluenceCenterZ,
    uThreshold: uRoadInfluenceThreshold,
  };
}

/**
 * Get grass culling/fade uniforms for use by other vegetation systems (flowers).
 * Using the SAME uniforms ensures flowers fade identically with grass.
 */
export function getGrassCullingUniforms() {
  return {
    uR0: uniforms.uR0, // Full density radius (23m)
    uR1: uniforms.uR1, // Thin to minimum radius (29m)
    uPMin: uniforms.uPMin, // Minimum density at outer edge
    uFadeStart: uniforms.uFadeStart, // Bayer dither start (29m)
    uFadeEnd: uniforms.uFadeEnd, // Bayer dither end (33m)
  };
}

// ============================================================================
// EXCLUSION TEXTURE - GPU-computed from blocker positions
// ============================================================================
// A compute shader stamps circles into this texture for all trees/rocks/resources.
// Grass samples this texture - one read per blade, unlimited blockers.
// Updated once after vegetation loads, not per-blocker.

const EXCLUSION_TEXTURE_SIZE = 512; // 512x512 covers world with ~1m resolution
const EXCLUSION_WORLD_SIZE = 500; // World units covered by texture

/** GPU exclusion texture (R8, 0=grass, 1=excluded) */
// IMPORTANT: Initialize with dummy 1x1 texture so shader includes exclusion sampling code at build time
const dummyExclusionData = new Float32Array([0]); // 0 = not excluded (grass ok)
const exclusionTexture: THREE.DataTexture = new THREE.DataTexture(
  dummyExclusionData,
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType,
);
exclusionTexture.wrapS = THREE.ClampToEdgeWrapping;
exclusionTexture.wrapT = THREE.ClampToEdgeWrapping;
exclusionTexture.minFilter = THREE.LinearFilter;
exclusionTexture.magFilter = THREE.LinearFilter;
exclusionTexture.needsUpdate = true;

const exclusionTextureNode: ReturnType<typeof texture> =
  texture(exclusionTexture);
const uExclusionWorldSize = uniform(EXCLUSION_WORLD_SIZE);
const uExclusionCenterX = uniform(0);
const uExclusionCenterZ = uniform(0);

// ============================================================================
// GRID-BASED EXCLUSION - Uses texture from GrassExclusionGrid
// ============================================================================
// GrassExclusionGrid queries CollisionMatrix/TerrainSystem for blocked tiles.
// ProceduralGrass samples this texture for O(1) per-blade exclusion check.

/** Flag to use grid-based exclusion instead of legacy vegetation exclusion */
let useGridBasedExclusion = true;

/** Grid exclusion texture node (set by GrassExclusionGrid) */
let gridExclusionTextureNode: ReturnType<typeof texture> | null = null;
/** Grid exclusion uniforms */
const uGridExclusionCenterX = uniform(0);
const uGridExclusionCenterZ = uniform(0);
const uGridExclusionWorldSize = uniform(256);

/**
 * Set grid-based exclusion texture for the shader.
 * Called by GrassExclusionGrid when texture is updated.
 */
export function setGridExclusionTexture(
  textureNode: ReturnType<typeof texture> | null,
  centerX: number,
  centerZ: number,
  worldSize: number,
): void {
  gridExclusionTextureNode = textureNode;
  uGridExclusionCenterX.value = centerX;
  uGridExclusionCenterZ.value = centerZ;
  uGridExclusionWorldSize.value = worldSize;
}

/**
 * Enable or disable grid-based exclusion.
 */
export function setUseGridExclusion(use: boolean): void {
  useGridBasedExclusion = use;
}

// ============================================================================
// WATER/SHORELINE CULLING - Gradual fade near water
// ============================================================================

/**
 * Water threshold configuration with gradual fade zone.
 * Grass fades out gradually as it approaches the shoreline.
 */
const WATER_CONFIG = {
  /** Water level in world Y units (from TERRAIN_CONSTANTS) */
  WATER_LEVEL: 9.0, // TERRAIN_CONSTANTS.WATER_THRESHOLD
  /** Hard cutoff - no grass below this height (right at water's edge) */
  HARD_CUTOFF: 1.0, // 1m above water level
  /** Fade zone start - full density above this */
  FADE_START: 4.0, // Full grass 4m above water
  /** Computed thresholds */
  get WATER_HARD_CUTOFF() {
    return this.WATER_LEVEL + this.HARD_CUTOFF; // 10m - absolute minimum
  },
  get WATER_FADE_START() {
    return this.WATER_LEVEL + this.FADE_START; // 13m - full density above this
  },
} as const;

// Uniforms for water culling (gradual fade)
const uWaterHardCutoff = uniform(WATER_CONFIG.WATER_HARD_CUTOFF);
const uWaterFadeStart = uniform(WATER_CONFIG.WATER_FADE_START);

// ============================================================================
// MULTI-CHARACTER BENDING - Uses texture from CharacterInfluenceManager
// ============================================================================
// Characters (players, NPCs, mobs) bend grass as they walk through it.
// CharacterInfluenceManager packs character data into a 64x2 RGBA Float texture.

/** Flag to use multi-character bending instead of single-player trail */
let useMultiCharacterBending = true;

/** Character data texture (64x2: row 0 = pos+radius, row 1 = vel+speed) */
let characterBendingTextureNode: ReturnType<typeof texture> | null = null;
/** Number of active characters */
const uCharacterCount = uniform(0);
/** Texture width (max characters) */
const CHARACTER_TEXTURE_WIDTH = 64;

/**
 * Set multi-character bending texture for the shader.
 * Called by CharacterInfluenceManager when texture is updated.
 */
export function setCharacterBendingTexture(
  textureNode: ReturnType<typeof texture> | null,
  count: number,
): void {
  characterBendingTextureNode = textureNode;
  uCharacterCount.value = count;
}

/**
 * Enable or disable multi-character bending.
 */
export function setUseMultiCharacterBending(use: boolean): void {
  useMultiCharacterBending = use;
}

// Legacy export for backwards compatibility (now a no-op)
export function setCharacterBendingData(
  _posBuffer: ReturnType<typeof instancedArray>,
  _velBuffer: ReturnType<typeof instancedArray>,
  _count: number,
): void {
  console.warn(
    "[ProceduralGrass] setCharacterBendingData is deprecated - use setCharacterBendingTexture instead",
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class GrassSsbo {
  private buffer1: InstancedArrayBuffer;
  private buffer2: InstancedArrayBuffer;
  private buffer3: InstancedArrayBuffer; // heightmapY

  // Compute shaders - initialized in constructor after buffers
  computeInit: any;
  computeUpdate: any;

  // Track initialization state
  private _initialized = false;

  constructor() {
    // Create buffers FIRST
    this.buffer1 = instancedArray(config.COUNT, "vec4");
    this.buffer2 = instancedArray(config.COUNT, "float");
    this.buffer3 = instancedArray(config.COUNT, "float");

    // Then create compute shaders that reference the buffers
    this.computeInit = this.createComputeInit();
    this.computeUpdate = this.createComputeUpdate();

    // NOTE: We DO NOT use onInit callback here anymore!
    // This caused first-frame spikes because computeInit ran during gameplay.
    // Instead, call runInitialization() explicitly during loading.
  }

  /**
   * Run compute initialization explicitly during loading phase.
   * This avoids first-frame spikes by pre-running heavy compute work.
   * @returns Promise that resolves when initialization is complete
   */
  async runInitialization(renderer: THREE.WebGPURenderer): Promise<void> {
    if (this._initialized) return;

    console.log("[ProceduralGrass] Running SSBO compute initialization...");
    const startTime = performance.now();

    // Run compute init - this populates all grass blade positions
    await renderer.computeAsync(this.computeInit);

    this._initialized = true;
    console.log(
      `[ProceduralGrass] SSBO init complete: ${(performance.now() - startTime).toFixed(1)}ms`,
    );
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get computeBuffer1(): InstancedArrayBuffer {
    return this.buffer1;
  }

  get computeBuffer2(): InstancedArrayBuffer {
    return this.buffer2;
  }

  get computeBuffer3(): InstancedArrayBuffer {
    return this.buffer3;
  }

  // Unpacking functions
  getWind = Fn(([data = vec4(0)]) => {
    const x = tslUtils.unpackUnits(data.z, 0, 12, -2, 2);
    const z = tslUtils.unpackUnits(data.z, 12, 12, -2, 2);
    return vec2(x, z);
  });

  getScale = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnits(
      data.w,
      0,
      8,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  getOriginalScale = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnits(
      data.w,
      8,
      8,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  getVisibility = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackFlag(data.w, 17);
  });

  getWindNoise = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnit(data.w, 18, 6);
  });

  getPositionNoise = Fn(([data = float(0)]) => {
    return tslUtils.unpackUnit(data, 0, 4);
  });

  // Packing functions
  private setWind = Fn(([data = vec4(0), value = vec2(0)]) => {
    data.z = tslUtils.packUnits(data.z, 0, 12, value.x, -2, 2);
    data.z = tslUtils.packUnits(data.z, 12, 12, value.y, -2, 2);
    return data;
  });

  private setScale = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnits(
      data.w,
      0,
      8,
      value,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  private setOriginalScale = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnits(
      data.w,
      8,
      8,
      value,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  private setVisibility = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packFlag(data.w, 17, value);
    return data;
  });

  private setWindNoise = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnit(data.w, 18, 6, value);
    return data;
  });

  private setPositionNoise = Fn(([data = float(0), value = float(0)]) => {
    return tslUtils.packUnit(data, 0, 4, value);
  });

  // Compute Init
  private createComputeInit() {
    return Fn(() => {
      const data1 = this.buffer1.element(instanceIndex);
      const data2 = this.buffer2.element(instanceIndex);
      const data3 = this.buffer3.element(instanceIndex);

      // Position XZ in grid
      const row = floor(float(instanceIndex).div(config.BLADES_PER_SIDE));
      const col = float(instanceIndex).mod(config.BLADES_PER_SIDE);
      const randX = hash(instanceIndex.add(4321));
      const randZ = hash(instanceIndex.add(1234));
      const offsetX = col
        .mul(config.SPACING)
        .sub(config.TILE_HALF_SIZE)
        .add(randX.mul(config.SPACING * 0.5));
      const offsetZ = row
        .mul(config.SPACING)
        .sub(config.TILE_HALF_SIZE)
        .add(randZ.mul(config.SPACING * 0.5));

      // ========== MEGA SIMPLIFIED - use per-instance hash instead of tile-scale noise ==========
      // Use instanceIndex-based hash for jitter to avoid 80m tile patterns
      const noiseR = hash(instanceIndex.mul(0.73));
      const noiseB = hash(instanceIndex.mul(0.91));

      // Small per-instance jitter to break up grid pattern
      const jitterX = noiseR.sub(0.5).mul(config.SPACING * 0.8);
      const jitterZ = noiseB.sub(0.5).mul(config.SPACING * 0.8);
      data1.x = offsetX.add(jitterX);
      data1.y = offsetZ.add(jitterZ);

      data2.assign(this.setPositionNoise(data2, noiseR));

      // Scale - random within range (shaped distribution)
      const n = noiseB;
      const shaped = n.mul(n);
      const randomScale = remap(
        shaped,
        0,
        1,
        uniforms.uBladeMinScale,
        uniforms.uBladeMaxScale,
      );
      data1.assign(this.setScale(data1, randomScale));
      data1.assign(this.setOriginalScale(data1, randomScale));

      // Set visibility to 1 initially (visible)
      data1.assign(this.setVisibility(data1, float(1)));

      // Initialize heightmapY to 0 (will be updated in computeUpdate)
      data3.assign(float(0));
    })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
  }

  // Compute Wind
  private computeWind = Fn(
    ([prevWindXZ = vec2(0), worldPos = vec3(0), positionNoise = float(0)]) => {
      const intensity = smoothstep(0.2, 0.5, windManager.uIntensity);
      const dir = windManager.uDirection.negate();
      const strength = uniforms.uWindStrength.add(intensity);

      // Gentle per-instance speed jitter (±10%)
      const speed = uniforms.uWindSpeed.mul(
        positionNoise.remap(0, 1, 0.95, 2.05),
      );

      // Base UV + scroll
      const uvBase = worldPos.xz.mul(0.01).mul(uniforms.uvWindScale);
      const scroll = dir.mul(speed).mul(time);

      // Sample noise textures for wind
      const uvA = uvBase.add(scroll);
      const uvB = uvBase.mul(1.37).add(scroll.mul(1.11));

      // Use texture if available, otherwise hash fallback
      const sampleNoise = (uvCoord: ReturnType<typeof vec2>) => {
        if (noiseAtlasTexture) {
          return texture(noiseAtlasTexture, uvCoord).mul(2.0).sub(1.0);
        }
        return vec3(hash(uvCoord.x.add(uvCoord.y.mul(100))))
          .mul(2.0)
          .sub(1.0);
      };

      const nA = sampleNoise(uvA);
      const nB = sampleNoise(uvB);

      // Mix noises
      const mixRand = fract(sin(positionNoise.mul(12.9898)).mul(78.233));
      const mixTime = sin(time.mul(0.4).add(positionNoise.mul(0.1))).mul(0.25);
      const w = clamp(mixRand.add(mixTime), 0.2, 0.8);
      const n = mix(nA, nB, w);

      const baseMag = n.x.mul(strength);
      const gustMag = n.y.mul(strength).mul(0.35);
      const windFactor = baseMag.add(gustMag);

      const target = dir.mul(windFactor);
      const k = mix(0.08, 0.25, n.z.abs());
      const newWind = prevWindXZ.add(target.sub(prevWindXZ).mul(k));

      return vec3(newWind, windFactor);
    },
  );

  // Compute Trail Scale - grass bends when player walks through
  private computeTrailScale = Fn(
    ([
      originalScale = float(0),
      currentScale = float(0),
      isStepped = float(0),
    ]) => {
      const up = currentScale.add(
        originalScale.sub(currentScale).mul(uniforms.uTrailGrowthRate),
      );
      const down = currentScale.add(
        uniforms.uTrailMinScale.sub(currentScale).mul(uniforms.uKDown),
      );
      const blended = mix(up, down, isStepped);
      return clamp(blended, uniforms.uTrailMinScale, originalScale);
    },
  );

  // Compute Stochastic Keep - Distance-based dithered thinning
  private computeStochasticKeep = Fn(([distSq = float(0)]) => {
    const R0 = uniforms.uR0;
    const R1 = uniforms.uR1;
    const pMin = uniforms.uPMin;
    const R0Sq = R0.mul(R0);
    const R1Sq = R1.mul(R1);

    // t: 0 inside R0, 1 at/after R1
    const t = clamp(
      distSq.sub(R0Sq).div(max(R1Sq.sub(R0Sq), float(0.00001))),
      0.0,
      1.0,
    );

    // Keep probability: 1 at center → pMin at edge
    const p = mix(float(1.0), pMin, t);

    // Deterministic RNG per blade (stable across frames)
    const rnd = hash(float(instanceIndex).mul(0.73));

    // Keep if random < probability
    return step(rnd, p);
  });

  // Compute Distance Fade - OLD SCHOOL BAYER DITHER
  // Creates retro ordered dithering pattern that fades grass into terrain
  // @ts-expect-error TSL array destructuring
  private computeDistanceFade: ReturnType<typeof Fn> = Fn(
    ([distSq = float(0)]) => {
      const fadeStartSq = uniforms.uFadeStart.mul(uniforms.uFadeStart);
      const fadeEndSq = uniforms.uFadeEnd.mul(uniforms.uFadeEnd);

      // Linear fade: 1.0 at fadeStart, 0.0 at fadeEnd
      const linearFade = float(1.0).sub(
        clamp(
          distSq
            .sub(fadeStartSq)
            .div(max(fadeEndSq.sub(fadeStartSq), float(0.001))),
          0.0,
          1.0,
        ),
      );

      // OLD SCHOOL BAYER 8x8 ORDERED DITHERING
      // Use instance index to create screen-like pattern (stable per-blade)
      // This creates the classic retro dither look
      const bayerX = float(instanceIndex).mod(8.0);
      const bayerY = floor(float(instanceIndex).div(8.0)).mod(8.0);

      // Bayer 8x8 matrix threshold calculation (normalized 0-1)
      // Uses bit interleaving pattern for proper Bayer sequence
      const _x = bayerX.toInt();
      const _y = bayerY.toInt();

      // Reconstruct Bayer pattern using bit operations
      // bayer(x,y) = (bit_reverse(x XOR y) / 64)
      // Simplified: use hash of position for deterministic per-pixel threshold
      const bayerPattern = hash(bayerX.add(bayerY.mul(8.0)).add(0.123));

      // Quantize to 8 levels for chunky retro look
      const quantizedThreshold = floor(bayerPattern.mul(8.0)).div(8.0);

      // Compare fade against Bayer threshold
      // This creates the ordered dither pattern - grass either fully visible or culled
      return step(quantizedThreshold, linearFade);
    },
  );

  // Compute Frustum Visibility for a single point
  // Uses generous padding to prevent popping at frustum edges
  private computeVisibility = Fn(([worldPos = vec3(0)]) => {
    const clipPos = uniforms.uCameraMatrix.mul(vec4(worldPos, 1.0));
    const ndc = clipPos.xyz.div(clipPos.w);
    // More generous padding - at least 0.15 NDC units + scaled radius
    const baseRadius = float(config.BLADE_BOUNDING_SPHERE_RADIUS).div(
      max(clipPos.w, float(0.1)),
    );
    const paddingX = max(baseRadius, float(0.15)); // Generous horizontal padding
    const paddingY = max(baseRadius, float(0.2)); // Extra vertical padding (camera tilt)
    const one = float(1);
    const visible = step(one.negate().sub(paddingX), ndc.x)
      .mul(step(ndc.x, one.add(paddingX)))
      .mul(step(one.negate().sub(paddingY), ndc.y))
      .mul(step(ndc.y, one.add(paddingY)))
      .mul(step(float(-0.1), ndc.z)) // Allow slightly behind near plane
      .mul(step(ndc.z, float(1.1))); // Allow slightly beyond far plane
    return visible;
  });

  // Compute Update - with position wrapping
  private createComputeUpdate() {
    return Fn(() => {
      const data1 = this.buffer1.element(instanceIndex);
      const data2 = this.buffer2.element(instanceIndex);
      const data3 = this.buffer3.element(instanceIndex);

      // Position wrapping FIRST - maintains world position as player moves
      // This creates toroidal wrapping so grass appears fixed in world space
      const wrappedPos = VegetationSsboUtils.wrapPosition(
        vec2(data1.x, data1.y),
        uniforms.uPlayerDeltaXZ,
        float(config.TILE_SIZE),
      );

      // Update stored position with wrapped values
      data1.x = wrappedPos.x;
      data1.y = wrappedPos.z;

      const offsetX = wrappedPos.x;
      const offsetZ = wrappedPos.z;

      // World position = local offset + camera position
      const worldX = offsetX.add(uniforms.uCameraPosition.x);
      const worldZ = offsetZ.add(uniforms.uCameraPosition.z);

      // Sample heightmap for Y position (needed even for culled blades for next frame)
      const halfWorld = uHeightmapWorldSize.mul(0.5);
      const hmUvX = worldX
        .sub(uHeightmapCenterX)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUvZ = worldZ
        .sub(uHeightmapCenterZ)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUV = vec2(
        hmUvX.clamp(float(0.001), float(0.999)),
        hmUvZ.clamp(float(0.001), float(0.999)),
      );

      let heightmapY: ReturnType<typeof float>;
      if (heightmapTextureNode) {
        const hmSample = heightmapTextureNode.sample(hmUV);
        heightmapY = hmSample.r.mul(uHeightmapMax);
      } else {
        heightmapY = uniforms.uCameraPosition.y;
      }
      data3.assign(heightmapY);

      // World position with height
      const worldPos = vec3(worldX, heightmapY, worldZ);

      // === CAMERA-BASED DISTANCE CULLING ===
      const toGrassFromCam = vec2(offsetX, offsetZ); // Already relative to camera
      const camForwardXZ = uniforms.uCameraForward.xz;
      const forwardDot = toGrassFromCam.dot(camForwardXZ);

      // Bias for view direction (more grass in front)
      const forwardFactor = smoothstep(float(-0.5), float(1.0), forwardDot);
      const biasAmount = uniforms.uForwardBias.mul(forwardFactor);

      // Distance from camera
      const camDist = toGrassFromCam.length();
      const effectiveDist = max(camDist.sub(biasAmount), float(0.0));
      const effectiveDistSq = effectiveDist.mul(effectiveDist);

      // 1. Per-instance frustum culling
      const _frustumVisible = this.computeVisibility(worldPos);

      // 2. Stochastic distance culling (dithered thinning)
      const _stochasticKeep = this.computeStochasticKeep(effectiveDistSq);

      // 3. Distance fade (dithered)
      const distanceFade = this.computeDistanceFade(effectiveDistSq);
      const ditherRand = hash(float(instanceIndex).mul(1.31));
      const _ditherVisible = step(ditherRand, distanceFade);

      // 4. Water/shoreline culling - gradual fade near water
      // smoothstep creates a gradual density reduction as grass approaches water
      // At FADE_START (13m): full density (1.0)
      // At HARD_CUTOFF (10m): zero density (0.0)
      // Between: gradual stochastic thinning
      const waterFade = smoothstep(
        uWaterHardCutoff,
        uWaterFadeStart,
        heightmapY,
      );
      // Use dithering for stochastic shoreline - each blade has random threshold
      const waterDitherRand = hash(float(instanceIndex).mul(3.71));
      const _aboveWater = step(waterDitherRand, waterFade);

      // 5. Dirt/terrain culling - matches TerrainShader.ts exactly
      // Terrain constants
      const TERRAIN_NOISE_SCALE = 0.0008;
      const DIRT_THRESHOLD = 0.5;

      // Sample noise at world position
      const noiseUV = vec2(worldX, worldZ).mul(TERRAIN_NOISE_SCALE);
      let terrainNoiseValue: ReturnType<typeof float>;
      if (noiseAtlasTexture) {
        terrainNoiseValue = texture(noiseAtlasTexture, noiseUV).r;
      } else {
        terrainNoiseValue = hash(
          worldX
            .mul(TERRAIN_NOISE_SCALE * 1000)
            .add(worldZ.mul(TERRAIN_NOISE_SCALE * 1000)),
        );
      }

      // Dirt patch factor - smoothstep(0.45, 0.65, noiseValue)
      const dirtPatchFactor = smoothstep(
        float(DIRT_THRESHOLD - 0.05),
        float(DIRT_THRESHOLD + 0.15),
        terrainNoiseValue,
      );

      // Calculate slope from heightmap for slope-based culling
      const slopeEpsilon = float(1.0);
      const hmUvRight = vec2(
        hmUvX.add(slopeEpsilon.div(uHeightmapWorldSize)).clamp(0.001, 0.999),
        hmUvZ.clamp(0.001, 0.999),
      );
      const hmUvForward = vec2(
        hmUvX.clamp(0.001, 0.999),
        hmUvZ.add(slopeEpsilon.div(uHeightmapWorldSize)).clamp(0.001, 0.999),
      );

      let heightRight: ReturnType<typeof float>;
      let heightForward: ReturnType<typeof float>;
      if (heightmapTextureNode) {
        heightRight = heightmapTextureNode
          .sample(hmUvRight)
          .r.mul(uHeightmapMax);
        heightForward = heightmapTextureNode
          .sample(hmUvForward)
          .r.mul(uHeightmapMax);
      } else {
        heightRight = heightmapY;
        heightForward = heightmapY;
      }

      const dx = heightRight.sub(heightmapY).div(slopeEpsilon);
      const dz = heightForward.sub(heightmapY).div(slopeEpsilon);

      // Compute slope the SAME WAY as terrain shader: 1 - |normal.y|
      // Normal = normalize(-dx, 1, -dz), so normal.y = 1 / sqrt(1 + dx^2 + dz^2)
      const gradientSq = dx.mul(dx).add(dz.mul(dz));
      const normalY = float(1.0).div(sqrt(float(1.0).add(gradientSq)));
      const slope = float(1.0).sub(normalY.abs());

      // Flatness for dirt patches (dirt patches only on flat ground) - matches terrain
      const flatnessFactor = smoothstep(float(0.3), float(0.05), slope);

      // Slope-based grass suppression - matches terrain (more lenient)
      const slopeFactor = smoothstep(float(0.25), float(0.6), slope);

      // Combined dirt factor - grass grows closer to dirt edges
      const _combinedDirtFactor = max(
        dirtPatchFactor.mul(flatnessFactor).mul(0.7), // Reduce dirt patch impact
        slopeFactor.mul(0.6), // Reduce slope impact
      );

      // Dithered culling on dirt - wider range for smoother grass-to-dirt transition
      const dirtDitherRand = hash(float(instanceIndex).mul(5.67));
      const _notOnDirt = step(_combinedDirtFactor, dirtDitherRand.mul(0.5)); // 0-0.5 dither range (wider)

      // Sand zone (6-10m height on flat ground) - no grass on beaches
      const sandZone = smoothstep(float(10.0), float(6.0), heightmapY).mul(
        flatnessFactor,
      );
      const sandDitherRand = hash(float(instanceIndex).mul(6.78));
      const _notOnSand = step(sandZone.mul(0.8), sandDitherRand.mul(0.4));

      // Road influence culling - sample road texture directly
      let _notOnRoad2: ReturnType<typeof float>;
      {
        const roadHalfWorld = uRoadInfluenceWorldSize.mul(0.5);
        const roadUvX = worldX
          .sub(uRoadInfluenceCenterX)
          .add(roadHalfWorld)
          .div(uRoadInfluenceWorldSize);
        const roadUvZ = worldZ
          .sub(uRoadInfluenceCenterZ)
          .add(roadHalfWorld)
          .div(uRoadInfluenceWorldSize);
        const roadUV = vec2(
          roadUvX.clamp(0.001, 0.999),
          roadUvZ.clamp(0.001, 0.999),
        );
        const roadInfluence = roadInfluenceTextureNode.sample(roadUV).r;
        const roadDitherRand = hash(float(instanceIndex).mul(9.12));
        _notOnRoad2 = step(
          roadInfluence,
          uRoadInfluenceThreshold.add(roadDitherRand.mul(0.15)),
        );
      }

      // Exclusion zone culling - HYBRID: grid + legacy
      let _notExcluded2: ReturnType<typeof float>;
      {
        // Grid-based exclusion (CollisionMatrix blocked tiles)
        const gridNotExcluded = float(1.0).toVar();
        if (useGridBasedExclusion && gridExclusionTextureNode) {
          const gridHalfWorld = uGridExclusionWorldSize.mul(0.5);
          const gridUvX = worldX
            .sub(uGridExclusionCenterX)
            .add(gridHalfWorld)
            .div(uGridExclusionWorldSize);
          const gridUvZ = worldZ
            .sub(uGridExclusionCenterZ)
            .add(gridHalfWorld)
            .div(uGridExclusionWorldSize);
          const gridUV = vec2(
            gridUvX.clamp(0.001, 0.999),
            gridUvZ.clamp(0.001, 0.999),
          );
          const gridExclusionValue = gridExclusionTextureNode.sample(gridUV).r;

          // Soft edge dithering at tile boundaries with nice dissolve effect
          const exclDitherRand = hash(float(instanceIndex).mul(10.34));
          const exclDitherRand2 = hash(float(instanceIndex).mul(17.89));
          const tileEdgeDist = min(
            min(fract(worldX), float(1).sub(fract(worldX))),
            min(fract(worldZ), float(1).sub(fract(worldZ))),
          );
          // Wider soft edge zone (0.4m instead of 0.15m) for smoother fade
          const edgeSoftness = smoothstep(float(0), float(0.4), tileEdgeDist);
          const baseNotExcluded = float(1).sub(gridExclusionValue);
          // More aggressive soft edge bonus with dithering for dissolve effect
          const softEdgeBonus = gridExclusionValue
            .mul(float(1).sub(edgeSoftness))
            .mul(exclDitherRand.lessThan(0.35).select(1, 0))
            .mul(exclDitherRand2.mul(0.5).add(0.5));
          gridNotExcluded.assign(
            baseNotExcluded.add(softEdgeBonus).clamp(0, 1),
          );
        }

        // Legacy texture exclusion (buildings, duel arenas)
        // Use smooth fade: grass starts fading at exclusion 0.3, fully gone at 0.8
        const legacyHalfWorld = uExclusionWorldSize.mul(0.5);
        const legacyUvX = worldX
          .sub(uExclusionCenterX)
          .add(legacyHalfWorld)
          .div(uExclusionWorldSize);
        const legacyUvZ = worldZ
          .sub(uExclusionCenterZ)
          .add(legacyHalfWorld)
          .div(uExclusionWorldSize);
        const legacyUV = vec2(
          legacyUvX.clamp(0.001, 0.999),
          legacyUvZ.clamp(0.001, 0.999),
        );
        const legacyExclusionValue = exclusionTextureNode.sample(legacyUV).r;

        // Smooth scale fade: 1.0 at exclusion 0, fading to 0 at exclusion 0.6
        // Grass within 0.1m of building footprint (exclusion > 0.6) has 0 scale
        // Hard cutoff with dithering for final cull (exclusion > 0.7 = always hidden)
        const legacyDitherRand = hash(float(instanceIndex).mul(11.45));
        const legacyNotExcluded = step(
          legacyExclusionValue,
          float(0.6).add(legacyDitherRand.mul(0.2)),
        );

        // Combine: both must allow grass
        _notExcluded2 = gridNotExcluded.mul(legacyNotExcluded);
      }

      // Combine all visibility checks
      const isVisible = _frustumVisible
        .mul(_stochasticKeep)
        .mul(_ditherVisible)
        .mul(_aboveWater)
        .mul(_notOnDirt)
        .mul(_notOnSand)
        .mul(_notOnRoad2)
        .mul(_notExcluded2);
      data1.assign(this.setVisibility(data1, isVisible));

      // === BENDING/TRAIL EFFECT ===
      // Either multi-character bending (texture-based) or legacy single-player trail
      let contact: ReturnType<typeof float>;

      if (useMultiCharacterBending && characterBendingTextureNode) {
        // MULTI-CHARACTER BENDING - Sample texture for each character
        // Texture format: 64x2, row 0 = pos+radius, row 1 = vel+speed
        const maxContact = float(0).toVar();
        const texWidth = float(CHARACTER_TEXTURE_WIDTH);
        // Store texture reference for use inside Loop (TypeScript narrowing workaround)
        const bendingTexture = characterBendingTextureNode;

        // Loop through active characters via texture sampling
        // Use Loop with character count uniform
        Loop(uCharacterCount, ({ i }) => {
          // Calculate UV for this character (column i, row 0 for position, row 1 for velocity)
          const charU = float(i).add(0.5).div(texWidth);

          // Sample position + radius (row 0, y = 0.25 for row center)
          const posUV = vec2(charU, float(0.25));
          const posData = bendingTexture.sample(posUV);
          const charX = posData.x;
          const charY = posData.y;
          const charZ = posData.z;
          const charRadius = posData.w;

          // Sample velocity + speed (row 1, y = 0.75 for row center)
          const velUV = vec2(charU, float(0.75));
          const velData = bendingTexture.sample(velUV);
          const charSpeed = velData.w;

          // Skip if radius is 0 (unused slot)
          const hasRadius = charRadius.greaterThan(0.01);

          // Distance from grass blade to character (XZ plane)
          const dx = worldX.sub(charX);
          const dz = worldZ.sub(charZ);
          const distSq = dx.mul(dx).add(dz.mul(dz));
          const radiusSq = charRadius.mul(charRadius);

          // Check if character is grounded near the grass
          const charHeightDiff = charY.sub(heightmapY).abs();
          const isCharGrounded = smoothstep(
            float(5.0),
            float(0.0),
            charHeightDiff,
          );

          // Inner radius = instant full crush, Outer radius = edge of effect
          const innerRadiusSq = radiusSq.mul(0.2);
          const outerRadiusSq = radiusSq;

          // Contact intensity: 1 at center, fades to 0 at edge
          const charContact = float(1.0)
            .sub(smoothstep(innerRadiusSq, outerRadiusSq, distSq))
            .mul(isCharGrounded)
            .mul(hasRadius.select(1, 0)); // Zero if no radius

          // Speed boost: faster characters have stronger effect
          const speedFactor = charSpeed.mul(0.5).add(0.5).clamp(0.5, 2.0);
          const boostedContact = charContact.mul(speedFactor);

          // Keep maximum contact from all characters
          maxContact.assign(max(maxContact, boostedContact));
        });

        contact = maxContact.clamp(0, 1);
      } else {
        // LEGACY: SINGLE-PLAYER TRAIL EFFECT
        const playerWorldX = offsetX.add(uniforms.uCameraPosition.x);
        const playerWorldZ = offsetZ.add(uniforms.uCameraPosition.z);
        const diff = vec2(playerWorldX, playerWorldZ).sub(
          uniforms.uPlayerPosition.xz,
        );
        const distSqPlayer = diff.dot(diff);

        // Check if player is at ground level (allow 5m tolerance for jumping/terrain variation)
        const heightDiff = uniforms.uPlayerPosition.y.sub(heightmapY).abs();
        const isPlayerGrounded = smoothstep(float(5.0), float(0.0), heightDiff);

        // Inner radius = instant full crush, Outer radius = edge of effect
        const innerRadiusSq = uniforms.uTrailRadiusSquared.mul(0.2);
        const outerRadiusSq = uniforms.uTrailRadiusSquared;

        // Contact intensity: 1 at center, fades to 0 at edge
        contact = float(1.0)
          .sub(smoothstep(innerRadiusSq, outerRadiusSq, distSqPlayer))
          .mul(isPlayerGrounded);
      }

      // Trail scale - flatten grass based on contact
      const currentTrailScale = this.getScale(data1);
      const originalScale = this.getOriginalScale(data1);
      const newScale = this.computeTrailScale(
        originalScale,
        currentTrailScale,
        contact,
      );
      data1.assign(this.setScale(data1, newScale));

      // Wind
      const positionNoise = this.getPositionNoise(data2);
      const prevWind = this.getWind(data1);
      const newWind = this.computeWind(prevWind, worldPos, positionNoise);
      data1.assign(this.setWind(data1, newWind.xy));
      data1.assign(this.setWindNoise(data1, newWind.z));
    })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
  }
}

// ============================================================================
// GRASS MATERIAL - SpriteNodeMaterial
// ============================================================================

class GrassMaterial extends SpriteNodeMaterial {
  private ssbo: GrassSsbo;

  constructor(ssbo: GrassSsbo) {
    super();
    this.ssbo = ssbo;
    this.createGrassMaterial();
  }

  private createGrassMaterial(): void {
    // Material settings - transparent for bottom dither dissolve
    this.precision = "lowp";
    this.transparent = true;
    this.alphaTest = 0.1;

    // Get data from SSBO
    const data1 = this.ssbo.computeBuffer1.element(instanceIndex);
    const data2 = this.ssbo.computeBuffer2.element(instanceIndex);
    const data3 = this.ssbo.computeBuffer3.element(instanceIndex);
    const offsetX = data1.x;
    const offsetZ = data1.y;
    const _windXZ = this.ssbo.getWind(data1);
    const _scaleY = this.ssbo.getScale(data1);
    const isVisible = this.ssbo.getVisibility(data1);
    const _windNoiseFactor = this.ssbo.getWindNoise(data1);
    const _positionNoise = this.ssbo.getPositionNoise(data2);

    // Get heightmapY from compute shader
    const heightmapY = data3;

    // Height gradient for blade
    const h = uv().y;

    // BOTTOM DITHER DISSOLVE - fade grass base into ground, 100% above fade zone
    const bottomFade = smoothstep(float(0), uniforms.uBottomFadeHeight, h);
    // Only apply dither noise within the fade zone, full opacity above
    const inFadeZone = float(1.0).sub(step(uniforms.uBottomFadeHeight, h));
    const ditherNoise = hash(instanceIndex.add(h.mul(1000)))
      .mul(0.4)
      .mul(inFadeZone);
    const bottomOpacity = clamp(
      bottomFade.add(ditherNoise.sub(0.2).mul(inFadeZone)),
      0,
      1,
    );

    // OLD SCHOOL 8x8 BAYER SCREEN-SPACE DITHERING
    // Creates retro ordered dithering pattern for distance fade
    const fragCoord = viewportCoordinate;
    const ix = mod(floor(fragCoord.x), float(8.0));
    const iy = mod(floor(fragCoord.y), float(8.0));

    // 8x8 Bayer matrix calculation using bit interleaving
    const bit0_x = mod(ix, float(2.0));
    const bit1_x = mod(floor(mul(ix, float(0.5))), float(2.0));
    const bit2_x = floor(mul(ix, float(0.25)));
    const bit0_y = mod(iy, float(2.0));
    const bit1_y = mod(floor(mul(iy, float(0.5))), float(2.0));
    const bit2_y = floor(mul(iy, float(0.25)));

    const xor0 = abs(sub(bit0_x, bit0_y));
    const xor1 = abs(sub(bit1_x, bit1_y));
    const xor2 = abs(sub(bit2_x, bit2_y));

    // Build 8x8 Bayer value (0-63, normalized to 0-1)
    const bayerInt = add(
      add(
        add(mul(xor0, float(32.0)), mul(bit0_y, float(16.0))),
        add(mul(xor1, float(8.0)), mul(bit1_y, float(4.0))),
      ),
      add(mul(xor2, float(2.0)), bit2_y),
    );
    const bayerThreshold = mul(bayerInt, float(0.015625)); // 1/64

    // Distance-based opacity fade with Bayer dithering
    const distFromCamSq = data1.x.mul(data1.x).add(data1.y.mul(data1.y));
    const fadeStartSq = uniforms.uFadeStart.mul(uniforms.uFadeStart);
    const fadeEndSq = uniforms.uFadeEnd.mul(uniforms.uFadeEnd);
    const distFade = float(1.0).sub(
      clamp(
        distFromCamSq
          .sub(fadeStartSq)
          .div(max(fadeEndSq.sub(fadeStartSq), float(0.001))),
        0.0,
        1.0,
      ),
    );

    // Apply Bayer dither to distance fade - creates chunky retro dissolve
    const bayerFadeVisible = step(bayerThreshold, distFade);

    this.opacityNode = isVisible.mul(bottomOpacity).mul(bayerFadeVisible);

    // SCALE - use computed scale from SSBO
    this.scaleNode = vec3(0.5, _scaleY, 1);

    // ROTATION - wind-based bending at blade tips
    // Wind causes grass to lean in wind direction, more at top
    const windBendStrength = h.mul(h).mul(0.3); // Quadratic falloff from tip
    const windRotX = _windXZ.x.mul(windBendStrength);
    const windRotZ = _windXZ.y.mul(windBendStrength);
    this.rotationNode = vec3(windRotZ, 0, windRotX.negate());

    // POSITION - heightmap Y + wind sway offset
    const offsetY = heightmapY;

    // Wind sway - apply wind offset to position, more at blade top
    const windSwayStrength = h.mul(0.15).mul(_windNoiseFactor.add(0.5));
    const windSwayX = _windXZ.x.mul(windSwayStrength);
    const windSwayZ = _windXZ.y.mul(windSwayStrength);

    const bladePosition = vec3(
      offsetX.add(windSwayX),
      offsetY,
      offsetZ.add(windSwayZ),
    );

    this.positionNode = bladePosition;

    // COLOR - SAMPLE TERRAIN COLOR AT WORLD POSITION
    // Calculate world position for this blade (mesh position + local offset)
    const worldX = uniforms.uCameraPosition.x.add(offsetX);
    const worldZ = uniforms.uCameraPosition.z.add(offsetZ);

    // ========== COMPUTE TERRAIN NORMAL FROM HEIGHTMAP ==========
    // Sample heights at neighboring points to compute gradient
    const normalEpsilon = float(1.0); // 1 world unit sample distance
    const halfWorld = uHeightmapWorldSize.mul(0.5);

    // Helper function to sample heightmap at a world position
    const sampleTerrainHeight = (
      wx: ReturnType<typeof float>,
      wz: ReturnType<typeof float>,
    ) => {
      const uvX = wx
        .sub(uHeightmapCenterX)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const uvZ = wz
        .sub(uHeightmapCenterZ)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const sampleUV = vec2(uvX.clamp(0.001, 0.999), uvZ.clamp(0.001, 0.999));
      if (heightmapTextureNode) {
        return heightmapTextureNode.sample(sampleUV).r.mul(uHeightmapMax);
      }
      return float(0);
    };

    // Sample heights at center and neighboring points
    const hCenter = sampleTerrainHeight(worldX, worldZ);
    const hRight = sampleTerrainHeight(worldX.add(normalEpsilon), worldZ);
    const hForward = sampleTerrainHeight(worldX, worldZ.add(normalEpsilon));

    // Compute terrain normal from height gradient
    // Normal = normalize(-dh/dx, 1, -dh/dz)
    const dx = hRight.sub(hCenter);
    const dz = hForward.sub(hCenter);
    const terrainNormal = normalize(
      vec3(dx.negate(), normalEpsilon, dz.negate()),
    );

    // ========== TERRAIN-BASED DIFFUSE LIGHTING ==========
    // Compute diffuse lighting using terrain normal and sun direction
    const NdotL = max(dot(terrainNormal, uniforms.uSunDirection), float(0));
    const _terrainDiffuse = uniforms.uTerrainLightAmbient.add(
      uniforms.uTerrainLightDiffuse.mul(NdotL),
    );

    // ========== TERRAIN COLOR MATCHING - EXACT MATCH TO TerrainShader.ts ==========
    // Sample terrain noise at WORLD coordinates (0.0008 scale = 1250m tile)
    const TERRAIN_NOISE_SCALE = 0.0008;
    const DIRT_THRESHOLD = 0.5;

    const noiseUV = vec2(worldX, worldZ).mul(TERRAIN_NOISE_SCALE);
    let terrainNoiseValue: ReturnType<typeof float>;
    if (noiseAtlasTexture) {
      terrainNoiseValue = texture(noiseAtlasTexture, noiseUV).r;
    } else {
      // Hash fallback at world scale
      terrainNoiseValue = hash(worldX.mul(0.8).add(worldZ.mul(1.3)));
    }

    // Secondary noise derived from base - MATCHES TerrainShader.ts exactly
    // const noiseValue2 = add(mul(sin(mul(noiseValue, float(6.28))), float(0.3)), float(0.5));
    const noiseValue2 = sin(terrainNoiseValue.mul(6.28)).mul(0.3).add(0.5);

    // Terrain colors - EXACTLY matching TerrainShader.ts
    const grassGreen = vec3(0.3, 0.55, 0.15); // Rich green grass
    const grassDark = vec3(0.22, 0.42, 0.1); // Darker grass variation
    const dirtBrown = vec3(0.45, 0.32, 0.18); // Light brown dirt (FIXED to match terrain)
    const dirtDark = vec3(0.32, 0.22, 0.12); // Dark brown dirt (FIXED to match terrain)

    // Grass color variation - EXACT MATCH TerrainShader.ts: smoothstep(0.4, 0.6, noiseValue2)
    const grassVariation = smoothstep(float(0.4), float(0.6), noiseValue2);
    let grassColor = mix(grassGreen, grassDark, grassVariation);

    // Dirt patch factor - EXACT MATCH TerrainShader.ts
    const dirtPatchFactor = smoothstep(
      float(DIRT_THRESHOLD - 0.05),
      float(DIRT_THRESHOLD + 0.15),
      terrainNoiseValue,
    );

    // Slope from terrain normal (already computed above)
    const slope = float(1.0).sub(terrainNormal.y.abs());
    const flatnessFactor = smoothstep(float(0.3), float(0.05), slope);

    // Dirt color variation - EXACT MATCH TerrainShader.ts: smoothstep(0.3, 0.7, noiseValue2)
    const dirtVariation = smoothstep(float(0.3), float(0.7), noiseValue2);
    const dirtColor = mix(dirtBrown, dirtDark, dirtVariation);

    // DIRT PATCHES - EXACT MATCH TerrainShader.ts (line 505)
    // baseColor = mix(baseColor, dirtColor, mul(dirtPatchFactor, flatnessFactor));
    grassColor = mix(
      grassColor,
      dirtColor,
      dirtPatchFactor.mul(flatnessFactor),
    );

    // SLOPE-BASED DIRT - EXACT MATCH TerrainShader.ts (lines 507-513)
    // baseColor = mix(baseColor, dirtColor, mul(smoothstep(0.15, 0.5, slope), 0.6));
    grassColor = mix(
      grassColor,
      dirtColor,
      smoothstep(float(0.15), float(0.5), slope).mul(0.6),
    );

    // ROCK ON STEEP SLOPES - EXACT MATCH TerrainShader.ts (lines 515-522)
    const rockGray = vec3(0.45, 0.42, 0.38);
    const rockDark = vec3(0.3, 0.28, 0.25);
    const rockVariation = smoothstep(float(0.3), float(0.7), terrainNoiseValue);
    const rockColor = mix(rockGray, rockDark, rockVariation);
    grassColor = mix(
      grassColor,
      rockColor,
      smoothstep(float(0.45), float(0.75), slope),
    );

    // Simple height gradient: base to tip
    const tipColor = grassColor.mul(1.1);
    const colorProfile = h.mul(uniforms.uColorMixFactor).clamp();
    const baseToTip = mix(grassColor, tipColor, colorProfile);

    // Simple ambient occlusion near camera center
    const r2 = offsetX.mul(offsetX).add(offsetZ.mul(offsetZ));
    const near = float(1).sub(smoothstep(0, uniforms.uAoRadiusSquared, r2));
    const hWeight = float(1).sub(smoothstep(0.1, 0.85, h));
    const ao = float(1).sub(uniforms.uAoScale.mul(0.15).mul(near.mul(hWeight)));

    // Day/night tinting
    const dayNightTint = mix(
      uniforms.uNightColor,
      uniforms.uDayColor,
      uniforms.uDayNightMix,
    );

    this.colorNode = baseToTip.mul(ao).mul(dayNightTint);
  }
}

// ============================================================================
// LOD1 GRASS CARDS - Chunky clusters at distance
// ============================================================================

type LOD1InstancedArrayBuffer = ReturnType<typeof instancedArray>;

class GrassCardsSsbo {
  private buffer: LOD1InstancedArrayBuffer;
  computeInit: any;
  computeUpdate: any;

  // Track initialization state
  private _initialized = false;

  constructor() {
    this.buffer = instancedArray(lod1Config.COUNT, "vec4");
    this.computeInit = this.createComputeInit();
    this.computeUpdate = this.createComputeUpdate();

    // NOTE: We DO NOT use onInit callback here anymore!
    // Instead, call runInitialization() explicitly during loading.
  }

  /**
   * Run compute initialization explicitly during loading phase.
   * @returns Promise that resolves when initialization is complete
   */
  async runInitialization(renderer: THREE.WebGPURenderer): Promise<void> {
    if (this._initialized) return;

    console.log(
      "[ProceduralGrass] Running LOD1 SSBO compute initialization...",
    );
    const startTime = performance.now();

    await renderer.computeAsync(this.computeInit);

    this._initialized = true;
    console.log(
      `[ProceduralGrass] LOD1 SSBO init complete: ${(performance.now() - startTime).toFixed(1)}ms`,
    );
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get computeBuffer(): LOD1InstancedArrayBuffer {
    return this.buffer;
  }

  // Unpack visibility (bit 0)
  // @ts-expect-error TSL array destructuring
  getVisibility: ReturnType<typeof Fn> = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackFlag(data.w, 0);
  });

  // @ts-expect-error TSL array destructuring
  private setVisibility: ReturnType<typeof Fn> = Fn(
    ([data = vec4(0), value = float(0)]) => {
      data.w = tslUtils.packFlag(data.w, 0, value);
      return data;
    },
  );

  private createComputeInit() {
    return Fn(() => {
      const data = this.buffer.element(instanceIndex);

      // Position in larger grid
      const row = floor(float(instanceIndex).div(lod1Config.CARDS_PER_SIDE));
      const col = float(instanceIndex).mod(lod1Config.CARDS_PER_SIDE);
      const randX = hash(instanceIndex.add(7654));
      const randZ = hash(instanceIndex.add(3456));
      const offsetX = col
        .mul(lod1Config.SPACING)
        .sub(lod1Config.TILE_HALF_SIZE)
        .add(randX.mul(lod1Config.SPACING * 0.4));
      const offsetZ = row
        .mul(lod1Config.SPACING)
        .sub(lod1Config.TILE_HALF_SIZE)
        .add(randZ.mul(lod1Config.SPACING * 0.4));

      data.x = offsetX;
      data.y = offsetZ;
      data.z = float(0); // heightmapY (updated in computeUpdate)
      data.assign(this.setVisibility(data, float(1)));
    })().compute(lod1Config.COUNT, [lod1Config.WORKGROUP_SIZE]);
  }

  private createComputeUpdate() {
    // Terrain constants - MUST match TerrainShader.ts exactly
    const TERRAIN_NOISE_SCALE = 0.0008;
    const DIRT_THRESHOLD = 0.5;

    return Fn(() => {
      const data = this.buffer.element(instanceIndex);

      // Position wrapping FIRST - for world-stable grass cards
      const wrappedPos = VegetationSsboUtils.wrapPosition(
        vec2(data.x, data.y),
        uniforms.uPlayerDeltaXZ,
        float(lod1Config.TILE_SIZE),
      );
      data.x = wrappedPos.x;
      data.y = wrappedPos.z;

      const offsetX = wrappedPos.x;
      const offsetZ = wrappedPos.z;

      // World position (mesh is camera-centered, so use camera position)
      const worldX = offsetX.add(lod1Uniforms.uCameraPosition.x);
      const worldZ = offsetZ.add(lod1Uniforms.uCameraPosition.z);

      // Sample heightmap (camera-centered, offset by heightmap center)
      const halfWorld = uHeightmapWorldSize.mul(0.5);
      const hmUvX = worldX
        .sub(uHeightmapCenterX)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUvZ = worldZ
        .sub(uHeightmapCenterZ)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUV = vec2(
        hmUvX.clamp(float(0.001), float(0.999)),
        hmUvZ.clamp(float(0.001), float(0.999)),
      );

      let heightmapY: ReturnType<typeof float>;
      if (heightmapTextureNode) {
        const hmSample = heightmapTextureNode.sample(hmUV);
        heightmapY = hmSample.r.mul(uHeightmapMax);
      } else {
        heightmapY = lod1Uniforms.uPlayerPosition.y;
      }
      data.z = heightmapY;

      // ========== DIRT DETECTION - Match TerrainShader.ts exactly ==========
      // Sample noise at world position (same UV calculation as terrain)
      const noiseUV = vec2(worldX, worldZ).mul(TERRAIN_NOISE_SCALE);
      let terrainNoiseValue: ReturnType<typeof float>;
      if (noiseAtlasTexture) {
        terrainNoiseValue = texture(noiseAtlasTexture, noiseUV).r;
      } else {
        // Hash fallback
        terrainNoiseValue = hash(
          worldX
            .mul(TERRAIN_NOISE_SCALE * 1000)
            .add(worldZ.mul(TERRAIN_NOISE_SCALE * 1000)),
        );
      }

      // Dirt patch factor - EXACTLY like TerrainShader.ts (lines 488-492)
      // smoothstep(DIRT_THRESHOLD - 0.05, DIRT_THRESHOLD + 0.15, noiseValue)
      const dirtPatchFactor = smoothstep(
        float(DIRT_THRESHOLD - 0.05), // 0.45
        float(DIRT_THRESHOLD + 0.15), // 0.65
        terrainNoiseValue,
      );

      // Calculate terrain slope for slope-based dirt
      // Sample neighboring heights for slope calculation
      const slopeEpsilon = float(2.0); // 2m sample distance
      const hmUvRight = vec2(
        hmUvX.add(slopeEpsilon.div(uHeightmapWorldSize)).clamp(0.001, 0.999),
        hmUvZ.clamp(0.001, 0.999),
      );
      const hmUvForward = vec2(
        hmUvX.clamp(0.001, 0.999),
        hmUvZ.add(slopeEpsilon.div(uHeightmapWorldSize)).clamp(0.001, 0.999),
      );

      let heightRight: ReturnType<typeof float>;
      let heightForward: ReturnType<typeof float>;
      if (heightmapTextureNode) {
        heightRight = heightmapTextureNode
          .sample(hmUvRight)
          .r.mul(uHeightmapMax);
        heightForward = heightmapTextureNode
          .sample(hmUvForward)
          .r.mul(uHeightmapMax);
      } else {
        heightRight = heightmapY;
        heightForward = heightmapY;
      }

      const dx = heightRight.sub(heightmapY).div(slopeEpsilon);
      const dz = heightForward.sub(heightmapY).div(slopeEpsilon);
      const slope = sqrt(dx.mul(dx).add(dz.mul(dz)));

      // Slope-based grass suppression (steeper = less grass) - more lenient
      const slopeFactor = smoothstep(float(0.25), float(0.6), slope);

      // Combined dirt factor: noise-based patches + slope-based
      // On flat ground: use noise patches
      // On slopes: additional dirt - grass grows closer to dirt edges
      const flatnessFactor = smoothstep(float(0.3), float(0.05), slope);
      const _combinedDirtFactor = max(
        dirtPatchFactor.mul(flatnessFactor).mul(0.7), // Reduce dirt patch impact
        slopeFactor.mul(0.6), // Reduce slope impact
      );

      // Dithered culling on dirt - wider range for smoother grass-to-dirt transition
      const dirtDitherRand = hash(float(instanceIndex).mul(5.67));
      const _notOnDirt = step(_combinedDirtFactor, dirtDitherRand.mul(0.5)); // 0-0.5 dither range (wider)

      // Sand zone (6-10m height on flat ground) - no grass on beaches
      const sandZone = smoothstep(float(10.0), float(6.0), heightmapY).mul(
        flatnessFactor,
      );
      const sandDitherRand = hash(float(instanceIndex).mul(6.78));
      const _notOnSand = step(sandZone.mul(0.8), sandDitherRand.mul(0.4));

      // Distance-based visibility - basic culling only
      // (The actual fade/dither is done in fragment shader for smooth visual effect)
      const diff = vec2(worldX, worldZ).sub(lod1Uniforms.uCameraPosition.xz);
      const dist = diff.length();

      // Hard cull beyond fade out end + buffer (no need to render at all)
      const withinRange = step(dist, lod1Uniforms.uFadeOutEnd.add(float(10.0)));

      // Water/shoreline culling - gradual fade near water
      const waterFade = smoothstep(
        uWaterHardCutoff,
        uWaterFadeStart,
        heightmapY,
      );
      const waterDitherRand = hash(float(instanceIndex).mul(4.19));
      const _aboveWater = step(waterDitherRand, waterFade);

      // Road influence culling - sample road texture directly
      let _notOnRoad: ReturnType<typeof float>;
      {
        const roadHalfWorld = uRoadInfluenceWorldSize.mul(0.5);
        const roadUvX = worldX
          .sub(uRoadInfluenceCenterX)
          .add(roadHalfWorld)
          .div(uRoadInfluenceWorldSize);
        const roadUvZ = worldZ
          .sub(uRoadInfluenceCenterZ)
          .add(roadHalfWorld)
          .div(uRoadInfluenceWorldSize);
        const roadUV = vec2(
          roadUvX.clamp(0.001, 0.999),
          roadUvZ.clamp(0.001, 0.999),
        );
        const roadInfluence = roadInfluenceTextureNode.sample(roadUV).r;
        const roadDitherRand = hash(float(instanceIndex).mul(9.12));
        _notOnRoad = step(
          roadInfluence,
          uRoadInfluenceThreshold.add(roadDitherRand.mul(0.15)),
        );
      }

      // Exclusion zone culling - HYBRID: grid + legacy
      let _notExcluded: ReturnType<typeof float>;
      {
        // Grid-based exclusion (CollisionMatrix blocked tiles) - with dithered soft edges for LOD1
        const gridNotExcluded = float(1.0).toVar();
        if (useGridBasedExclusion && gridExclusionTextureNode) {
          const gridHalfWorld = uGridExclusionWorldSize.mul(0.5);
          const gridUvX = worldX
            .sub(uGridExclusionCenterX)
            .add(gridHalfWorld)
            .div(uGridExclusionWorldSize);
          const gridUvZ = worldZ
            .sub(uGridExclusionCenterZ)
            .add(gridHalfWorld)
            .div(uGridExclusionWorldSize);
          const gridUV = vec2(
            gridUvX.clamp(0.001, 0.999),
            gridUvZ.clamp(0.001, 0.999),
          );
          const gridExclusionValue = gridExclusionTextureNode.sample(gridUV).r;
          // Add soft edge dithering for smoother LOD1 transitions
          const exclDitherRand = hash(float(instanceIndex).mul(10.34));
          const tileEdgeDist = min(
            min(fract(worldX), float(1).sub(fract(worldX))),
            min(fract(worldZ), float(1).sub(fract(worldZ))),
          );
          const edgeSoftness = smoothstep(float(0), float(0.3), tileEdgeDist);
          const baseNotExcluded = float(1).sub(gridExclusionValue);
          const softEdgeBonus = gridExclusionValue
            .mul(float(1).sub(edgeSoftness))
            .mul(exclDitherRand.lessThan(0.25).select(1, 0));
          gridNotExcluded.assign(
            baseNotExcluded.add(softEdgeBonus).clamp(0, 1),
          );
        }

        // Legacy texture exclusion (buildings, duel arenas)
        // Use same smooth fade as LOD0 for consistency
        const legacyNotExcluded = float(1.0).toVar();
        {
          const legacyHalfWorld = uExclusionWorldSize.mul(0.5);
          const legacyUvX = worldX
            .sub(uExclusionCenterX)
            .add(legacyHalfWorld)
            .div(uExclusionWorldSize);
          const legacyUvZ = worldZ
            .sub(uExclusionCenterZ)
            .add(legacyHalfWorld)
            .div(uExclusionWorldSize);
          const legacyUV = vec2(
            legacyUvX.clamp(0.001, 0.999),
            legacyUvZ.clamp(0.001, 0.999),
          );
          const legacyExclusionValue = exclusionTextureNode.sample(legacyUV).r;

          // Hard cutoff with dithering (exclusion > 0.7 = always hidden)
          const legacyDitherRand = hash(float(instanceIndex).mul(11.45));
          legacyNotExcluded.assign(
            step(
              legacyExclusionValue,
              float(0.6).add(legacyDitherRand.mul(0.2)),
            ),
          );
        }

        // Combine: both must allow grass
        _notExcluded = gridNotExcluded.mul(legacyNotExcluded);
      }

      // Visibility: within range AND above water AND not on dirt/sand/road/excluded
      const isVisible = withinRange
        .mul(_aboveWater)
        .mul(_notOnDirt)
        .mul(_notOnSand)
        .mul(_notOnRoad)
        .mul(_notExcluded);

      data.assign(this.setVisibility(data, isVisible));
    })().compute(lod1Config.COUNT, [lod1Config.WORKGROUP_SIZE]);
  }
}

// ============================================================================
// MAIN GRASS SYSTEM
// ============================================================================

export class ProceduralGrassSystem extends System {
  // LOD0 - Individual blades
  private mesh: THREE.InstancedMesh | null = null;
  private ssbo: GrassSsbo | null = null;
  // LOD1 - Grass cards (simplified geometry at distance)
  private lod1Mesh: THREE.InstancedMesh | null = null;
  private lod1Ssbo: GrassCardsSsbo | null = null;

  private renderer: THREE.WebGPURenderer | null = null;
  private grassInitialized = false;
  private noiseTexture: THREE.Texture | null = null;

  // Position tracking for world-stable grass
  private lastCameraX = 0;
  private lastCameraZ = 0;

  // ========== STREAMING HEIGHTMAP STATE ==========
  /** Center of the heightmap in world coordinates */
  private heightmapCenterX = 0;
  private heightmapCenterZ = 0;
  /** Raw heightmap data (RGBA float, R=height) */
  private heightmapData: Float32Array | null = null;
  /** Terrain system reference for height queries */
  private terrainSystem: TerrainSystemInterface | null = null;
  /** Bound event handlers for cleanup */
  private onTileGeneratedBound:
    | ((data: { tileX: number; tileZ: number }) => void)
    | null = null;
  private onRoadsGeneratedBound: (() => void) | null = null;
  /** Track if initial heightmap has been generated */
  private heightmapInitialized = false;

  // ========== STREAMING EXCLUSION TEXTURE STATE (DEPRECATED) ==========
  // NOTE: Texture-based exclusion is being replaced by grid-based exclusion (GrassExclusionGrid)
  // These fields are kept for backwards compatibility during transition
  /** Center of the exclusion texture in world coordinates (follows player) */
  private exclusionCenterX = 0;
  private exclusionCenterZ = 0;
  /** Track if exclusion texture has been generated at least once */
  private exclusionInitialized = false;
  /** Threshold for re-centering (meters from center) */
  private static readonly EXCLUSION_RECENTER_THRESHOLD = 100; // Re-center when player moves 100m from texture center

  // ========== NEW GRID-BASED EXCLUSION SYSTEM ==========
  /** Grid-based exclusion manager (replaces texture-based exclusion) */
  private exclusionGrid: GrassExclusionGrid | null = null;
  /** Whether to use the new grid-based exclusion (true) or legacy texture (false) */
  private useGridExclusion = true;

  // ========== MULTI-CHARACTER BENDING SYSTEM ==========
  /** Character influence manager for multi-character grass bending */
  private characterInfluence: CharacterInfluenceManager | null = null;
  /** Whether to use multi-character bending (true) or legacy single-player trail (false) */
  private useMultiCharacterBending = true;

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: [], optional: ["graphics", "terrain"] };
  }

  async start(): Promise<void> {
    if (!this.world.isClient || typeof window === "undefined") return;

    this.renderer =
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    await this.initializeGrass();
  }

  private async loadTextures(): Promise<void> {
    // Get terrain system for height sampling
    this.terrainSystem =
      (this.world.getSystem("terrain") as unknown as
        | TerrainSystemInterface
        | undefined) ?? null;

    if (
      this.terrainSystem &&
      typeof this.terrainSystem.getHeightAt === "function"
    ) {
      // Initialize streaming heightmap (player-centered, updates as you walk)
      console.log("[ProceduralGrass] Initializing streaming heightmap...");
      await this.initStreamingHeightmap();

      // Listen for terrain tile events to update heightmap incrementally
      this.setupTerrainListeners();
    } else {
      console.log(
        "[ProceduralGrass] No terrain system - grass will be at player Y level",
      );
    }

    // Listen for roads:generated event to set up road influence texture
    this.setupRoadListeners();

    // Setup exclusion manager for buildings, trees, rocks, objects
    // This is async but we don't need to await it - the texture will be generated
    // when buildings are added via the GrassExclusionManager callback
    await this.setupExclusionManager();

    // Use the SAME noise texture as TerrainShader for consistent dirt/grass boundary
    // This ensures grass respects the same dirt patches that the terrain displays
    let terrainNoise = getNoiseTexture();
    if (!terrainNoise) {
      // Generate it if terrain hasn't yet (shouldn't happen normally)
      terrainNoise = generateNoiseTexture();
    }
    if (terrainNoise) {
      this.noiseTexture = terrainNoise;
      noiseAtlasTexture = terrainNoise;
      console.log(
        "[ProceduralGrass] Using terrain's noise texture for consistent dirt patches",
      );
    } else {
      console.log(
        "[ProceduralGrass] Using hash fallback for noise (terrain noise unavailable)",
      );
    }
  }

  // ============================================================================
  // STREAMING HEIGHTMAP - Player-centered, updates as you walk
  // ============================================================================

  /**
   * Initialize the streaming heightmap texture.
   * Creates a player-centered heightmap that updates incrementally.
   */
  private async initStreamingHeightmap(): Promise<void> {
    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;

    // Create heightmap data buffer (RGBA float)
    this.heightmapData = new Float32Array(SIZE * SIZE * 4);

    // Initialize to zero height
    for (let i = 0; i < SIZE * SIZE; i++) {
      const idx = i * 4;
      this.heightmapData[idx + 0] = 0; // R = height (normalized)
      this.heightmapData[idx + 1] = 1.0; // G = grassiness
      this.heightmapData[idx + 2] = 0; // B = unused
      this.heightmapData[idx + 3] = 1.0; // A = 1
    }

    // Get initial player position (or default to origin)
    const camera = this.world.camera;
    const playerX = camera?.position.x ?? 0;
    const playerZ = camera?.position.z ?? 0;

    // Set heightmap center to player position
    this.heightmapCenterX = playerX;
    this.heightmapCenterZ = playerZ;

    // Create THREE.js texture
    const hmTexture = new THREE.DataTexture(
      this.heightmapData,
      SIZE,
      SIZE,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    hmTexture.wrapS = THREE.ClampToEdgeWrapping;
    hmTexture.wrapT = THREE.ClampToEdgeWrapping;
    hmTexture.magFilter = THREE.LinearFilter;
    hmTexture.minFilter = THREE.LinearFilter;
    hmTexture.needsUpdate = true;

    // Set module-level variables
    heightmapTexture = hmTexture;
    heightmapTextureNode = texture(hmTexture);
    _heightmapMax = MAX_HEIGHT;
    uHeightmapMax.value = MAX_HEIGHT;
    uHeightmapWorldSize.value = WORLD_SIZE;
    uHeightmapCenterX.value = playerX;
    uHeightmapCenterZ.value = playerZ;

    // Generate initial heightmap around player (chunked async)
    console.log(
      `[ProceduralGrass] Generating initial heightmap at (${playerX.toFixed(0)}, ${playerZ.toFixed(0)})...`,
    );
    await this.regenerateHeightmapAroundPoint(playerX, playerZ);

    this.heightmapInitialized = true;
    console.log("[ProceduralGrass] Streaming heightmap ready");
  }

  /**
   * Set up listeners for terrain tile events.
   * Updates heightmap when new terrain tiles load.
   */
  private setupTerrainListeners(): void {
    // Listen for terrain tile generation to update heightmap incrementally
    this.onTileGeneratedBound = (data: unknown) => {
      const tileData = data as { tileX: number; tileZ: number };
      this.onTerrainTileGenerated(tileData.tileX, tileData.tileZ);
      // Schedule exclusion texture refresh (debounced)
      this.scheduleExclusionRefresh();
    };

    this.world.on("terrain:tile:generated", this.onTileGeneratedBound);
  }

  /** Timer for debounced exclusion texture refresh */
  private exclusionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Schedule an exclusion texture refresh centered at current camera position.
   * Debounced to 2 seconds - allows batch tile loading to complete first.
   */
  private scheduleExclusionRefresh(): void {
    if (this.exclusionRefreshTimer) {
      clearTimeout(this.exclusionRefreshTimer);
    }
    this.exclusionRefreshTimer = setTimeout(() => {
      this.exclusionRefreshTimer = null;
      // Get current camera position for centering
      const camera = this.world.camera;
      const centerX = camera?.position.x ?? 0;
      const centerZ = camera?.position.z ?? 0;
      this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
    }, 2000); // 2 second debounce
  }

  /**
   * Set up road network listeners to automatically cull grass on roads.
   */
  private setupRoadListeners(): void {
    // Listen for roads:generated event
    this.onRoadsGeneratedBound = () => {
      this.onRoadsGenerated();
    };

    this.world.on("roads:generated", this.onRoadsGeneratedBound);

    // Also check if roads already exist (in case grass system starts after roads)
    this.checkExistingRoads();
  }

  /**
   * Check if roads already exist and set up road influence texture.
   */
  private checkExistingRoads(): void {
    const roadSystem = this.world.getSystem(
      "roads",
    ) as unknown as RoadNetworkSystemInterface | null;
    console.log(
      "[ProceduralGrass] checkExistingRoads - roadSystem:",
      roadSystem ? "found" : "NOT FOUND",
    );

    if (
      roadSystem &&
      typeof roadSystem.generateRoadInfluenceTexture === "function"
    ) {
      const result = roadSystem.generateRoadInfluenceTexture(512);
      console.log(
        "[ProceduralGrass] Road influence texture result:",
        result
          ? `${result.width}x${result.height}, worldSize=${result.worldSize}`
          : "NULL (no roads?)",
      );

      if (result) {
        this.setRoadInfluenceTexture(
          result.data,
          result.width,
          result.height,
          result.worldSize,
        );
        console.log(
          "[ProceduralGrass] ✅ Road influence texture set up successfully",
        );
      }
    } else {
      console.log(
        "[ProceduralGrass] ⚠️ Road system not available or missing generateRoadInfluenceTexture",
      );
    }
  }

  /**
   * Handle roads:generated event - update road influence texture.
   */
  private onRoadsGenerated(): void {
    console.log(
      "[ProceduralGrass] 🛣️ roads:generated event received, updating road influence texture...",
    );
    this.checkExistingRoads();
  }

  /**
   * Unsubscribe function for GrassExclusionManager callback.
   */
  private exclusionManagerUnsubscribe: (() => void) | null = null;

  /**
   * Set up exclusion texture system.
   * Texture is generated via compute shader from tree/rock/resource positions.
   * Also subscribes to GrassExclusionManager for building changes.
   */
  private async setupExclusionManager(): Promise<void> {
    // Update existing exclusion texture to proper size (preserves shader node reference)
    // The dummy 1x1 texture was created at module level for shader compilation
    const emptyData = new Float32Array(
      EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
    );
    exclusionTexture.image = {
      data: emptyData,
      width: EXCLUSION_TEXTURE_SIZE,
      height: EXCLUSION_TEXTURE_SIZE,
    };
    exclusionTexture.needsUpdate = true;
    // NOTE: exclusionTextureNode was created at module level with dummy - keep same reference

    // Subscribe to GrassExclusionManager for building/object changes
    // This ensures grass exclusion is updated when buildings are added
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const exclusionManager = getGrassExclusionManager();

    console.log(
      `[ProceduralGrass] 🔗 setupExclusionManager: Subscribing to GrassExclusionManager`,
    );

    // Check if buildings were already registered before we subscribed
    const existingBlockers = exclusionManager.getRectangularBlockers();
    console.log(
      `[ProceduralGrass] Found ${existingBlockers.length} pre-existing building blockers`,
    );

    if (existingBlockers.length > 0) {
      console.log(`[ProceduralGrass] Will refresh texture in 100ms...`);
      // Schedule initial refresh with current camera position
      setTimeout(() => {
        const camera = this.world.camera;
        const centerX = camera?.position.x ?? 0;
        const centerZ = camera?.position.z ?? 0;
        console.log(
          `[ProceduralGrass] ⏰ Initial exclusion refresh at camera (${centerX.toFixed(0)}, ${centerZ.toFixed(0)})`,
        );
        this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
      }, 100);
    } else {
      console.log(
        `[ProceduralGrass] No pre-existing blockers, will wait for onBlockersChanged callback`,
      );
    }

    // Debounce refresh to avoid excessive updates
    this.exclusionManagerUnsubscribe = exclusionManager.onBlockersChanged(
      () => {
        console.log(
          `[ProceduralGrass] 📣 onBlockersChanged callback fired! Current blockers: ${exclusionManager.getRectangularBlockers().length}`,
        );

        // Clear existing timer
        if (this.exclusionRefreshTimer) {
          clearTimeout(this.exclusionRefreshTimer);
        }

        // Debounce: wait 500ms after last change before refreshing
        this.exclusionRefreshTimer = setTimeout(() => {
          const blockerCount = exclusionManager.getRectangularBlockers().length;
          console.log(
            `[ProceduralGrass] ⏰ Debounced refresh triggered, ${blockerCount} blockers registered`,
          );
          // Get current camera position for centering
          const camera = this.world.camera;
          const centerX = camera?.position.x ?? this.exclusionCenterX;
          const centerZ = camera?.position.z ?? this.exclusionCenterZ;
          this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
        }, 500);
      },
    );

    console.log(
      `[ProceduralGrass] ✅ setupExclusionManager complete, subscribed to changes`,
    );
  }

  // ============================================================================
  // EXCLUSION TEXTURE GENERATION - GPU compute from tree/rock positions
  // ============================================================================

  /** Pending blockers to be rendered to texture */
  private pendingBlockers: Array<{ x: number; z: number; radius: number }> = [];
  /** Dirty flag - true if texture needs regeneration */
  private exclusionTextureDirty = false;
  /** GPU storage buffer for blocker data */
  private exclusionBlockerBuffer: ReturnType<typeof instancedArray> | null =
    null;
  /** GPU storage buffer for output texture data */
  private exclusionOutputBuffer: ReturnType<typeof instancedArray> | null =
    null;
  /** Compiled compute shader for exclusion texture generation */
  private exclusionComputeNode: ReturnType<typeof Fn> | null = null;

  /**
   * Register a blocker (tree trunk, rock, resource).
   * Call refreshExclusionTexture() after all blockers are registered.
   */
  addExclusionBlocker(x: number, z: number, radius: number): void {
    this.pendingBlockers.push({ x, z, radius });
    this.exclusionTextureDirty = true;
  }

  /**
   * Clear all registered blockers.
   */
  clearExclusionBlockers(): void {
    this.pendingBlockers = [];
    this.exclusionTextureDirty = true;
  }

  /**
   * Create the GPU compute shader for exclusion texture generation.
   * One thread per texel, loops through all blockers using TSL Loop.
   */
  private createExclusionComputeShader(
    blockerBuffer: ReturnType<typeof instancedArray>,
    outputBuffer: ReturnType<typeof instancedArray>,
    blockerCountUniform: ReturnType<typeof uniform>,
    centerXUniform: ReturnType<typeof uniform>,
    centerZUniform: ReturnType<typeof uniform>,
  ): ReturnType<typeof Fn> {
    const SIZE = EXCLUSION_TEXTURE_SIZE;
    const WORLD_SIZE = EXCLUSION_WORLD_SIZE;
    const halfWorld = WORLD_SIZE / 2;
    const unitsPerTexel = WORLD_SIZE / SIZE;

    // Per-texel compute: each thread handles one output texel
    return Fn(() => {
      // Each thread handles one texel
      const texelIdx = instanceIndex;
      // CRITICAL: Convert to float BEFORE division to avoid WGSL floor(uint) error
      // WGSL's floor() only accepts float types, not uint
      const texelX = float(texelIdx).mod(float(SIZE));
      const texelY = floor(float(texelIdx).div(float(SIZE)));

      // Convert texel to world position (center of texel)
      // CRITICAL: Add the texture center offset so coordinates match world space
      const worldX = texelX
        .add(float(0.5))
        .mul(float(unitsPerTexel))
        .sub(float(halfWorld))
        .add(centerXUniform);
      const worldZ = texelY
        .add(float(0.5))
        .mul(float(unitsPerTexel))
        .sub(float(halfWorld))
        .add(centerZUniform);

      // Initialize maximum exclusion value
      const maxExclusion = float(0).toVar();

      // Loop through all blockers using TSL Loop
      // @ts-expect-error TSL Loop callback types
      Loop(blockerCountUniform, ({ i }) => {
        // Get blocker data (x, z, radius, _padding)
        const blockerData = blockerBuffer.element(i);
        const bx = blockerData.x;
        const bz = blockerData.y;
        const br = blockerData.z;

        // Distance from texel world position to blocker center
        const dx = worldX.sub(bx);
        const dz = worldZ.sub(bz);
        const distSq = dx.mul(dx).add(dz.mul(dz));
        const radiusSq = br.mul(br);

        // Check if within radius
        const dist = sqrt(distSq);

        // Soft fade (1.0 at center, 0.0 at edge)
        const fade = float(1.0).sub(dist.div(br).clamp(0, 1));

        // Only count if within radius
        const contribution = fade.mul(step(distSq, radiusSq));

        // Keep maximum
        maxExclusion.assign(max(maxExclusion, contribution));
      });

      // Write to output buffer
      outputBuffer.element(texelIdx).assign(maxExclusion);
    });
  }

  /**
   * Regenerate the exclusion texture from all registered blockers.
   * Uses GPU compute shader for maximum performance - no main thread blocking.
   * Call this once after vegetation finishes loading.
   */
  async refreshExclusionTexture(): Promise<void> {
    if (!this.exclusionTextureDirty && this.pendingBlockers.length === 0)
      return;

    const blockerCount = this.pendingBlockers.length;
    if (blockerCount === 0) {
      // Clear texture
      const clearData = new Float32Array(
        EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
      );
      exclusionTexture.image = {
        data: clearData,
        width: EXCLUSION_TEXTURE_SIZE,
        height: EXCLUSION_TEXTURE_SIZE,
      };
      exclusionTexture.needsUpdate = true;
      this.exclusionTextureDirty = false;
      console.log("[ProceduralGrass] Exclusion texture cleared (no blockers)");
      return;
    }

    // Check if we have a renderer for GPU compute
    if (!this.renderer) {
      console.warn("[ProceduralGrass] No renderer - falling back to CPU");
      await this.refreshExclusionTextureCPU();
      return;
    }

    console.log(
      `[ProceduralGrass] GPU: Generating exclusion texture for ${blockerCount} blockers...`,
    );
    const startTime = performance.now();

    // Create blocker data array (vec4: x, z, radius, padding)
    const blockerData = new Float32Array(blockerCount * 4);
    for (let i = 0; i < blockerCount; i++) {
      const b = this.pendingBlockers[i];
      blockerData[i * 4 + 0] = b.x;
      blockerData[i * 4 + 1] = b.z;
      blockerData[i * 4 + 2] = b.radius;
      blockerData[i * 4 + 3] = 0;
    }

    // Create GPU buffer for blockers
    const blockerBuffer = instancedArray(blockerData, "vec4");

    // Create output buffer (one float per texel)
    const totalTexels = EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE;
    const outputData = new Float32Array(totalTexels);
    const outputBuffer = instancedArray(outputData, "float");

    // Create uniforms for compute shader
    const uBlockerCount = uniform(blockerCount);
    const uCenterX = uniform(this.exclusionCenterX);
    const uCenterZ = uniform(this.exclusionCenterZ);

    // Build the compute shader with center position
    const computeShader = this.createExclusionComputeShader(
      blockerBuffer,
      outputBuffer,
      uBlockerCount,
      uCenterX,
      uCenterZ,
    );
    const computeNode = computeShader().compute(totalTexels, [64]);

    try {
      // Run the compute shader
      await this.renderer.computeAsync(computeNode);

      // Read back the output buffer using Three.js WebGPU API
      // instancedArray returns a StorageBufferNode, which extends BufferNode -> UniformNode
      // The 'value' property IS the StorageInstancedBufferAttribute directly
      const storageBufferAttribute = (
        outputBuffer as unknown as { value: THREE.StorageBufferAttribute }
      ).value;

      if (
        !storageBufferAttribute ||
        typeof storageBufferAttribute.array === "undefined"
      ) {
        console.warn(
          "[ProceduralGrass] GPU compute: Cannot access output buffer, falling back to CPU",
        );
        await this.refreshExclusionTextureCPU();
        return;
      }

      const resultArrayBuffer = await this.renderer.getArrayBufferAsync(
        storageBufferAttribute,
      );
      const resultData = new Float32Array(resultArrayBuffer);

      // Update the texture (preserves shader node reference)
      exclusionTexture.image = {
        data: resultData,
        width: EXCLUSION_TEXTURE_SIZE,
        height: EXCLUSION_TEXTURE_SIZE,
      };
      exclusionTexture.needsUpdate = true;

      // Debug stats
      let nonZeroCount = 0;
      let maxVal = 0;
      for (let i = 0; i < resultData.length; i++) {
        if (resultData[i] > 0) nonZeroCount++;
        if (resultData[i] > maxVal) maxVal = resultData[i];
      }

      this.exclusionTextureDirty = false;
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.log(
        `[ProceduralGrass] GPU: ${blockerCount} blockers, ` +
          `${nonZeroCount} texels (${((nonZeroCount / totalTexels) * 100).toFixed(2)}%), ` +
          `max=${maxVal.toFixed(2)}, ${elapsed}ms`,
      );
    } catch (error) {
      console.warn("[ProceduralGrass] GPU compute failed, using CPU:", error);
      await this.refreshExclusionTextureCPU();
    }
  }

  /**
   * CPU fallback for exclusion texture generation.
   * Used when GPU compute is not available or fails.
   */
  private async refreshExclusionTextureCPU(): Promise<void> {
    const blockerCount = this.pendingBlockers.length;
    console.log(
      `[ProceduralGrass] CPU: Generating exclusion texture for ${blockerCount} blockers...`,
    );
    const startTime = performance.now();

    const textureData = new Float32Array(
      EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
    );
    const texelsPerUnit = EXCLUSION_TEXTURE_SIZE / EXCLUSION_WORLD_SIZE;
    const halfWorld = EXCLUSION_WORLD_SIZE / 2;

    // Use the current exclusion center for coordinate transformation
    const centerX = this.exclusionCenterX;
    const centerZ = this.exclusionCenterZ;

    // Debug: Log texture generation parameters
    console.log(
      `[ProceduralGrass] CPU texture params: center=(${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), halfWorld=${halfWorld}, texelsPerUnit=${texelsPerUnit.toFixed(3)}`,
    );

    // Debug: Log first few blockers
    if (blockerCount > 0) {
      console.log(`[ProceduralGrass] First 3 blockers being processed:`);
      for (let i = 0; i < Math.min(3, blockerCount); i++) {
        const b = this.pendingBlockers[i];
        const uvU = (b.x - centerX + halfWorld) * texelsPerUnit;
        const uvV = (b.z - centerZ + halfWorld) * texelsPerUnit;
        console.log(
          `  [${i}] world=(${b.x.toFixed(1)}, ${b.z.toFixed(1)}), r=${b.radius.toFixed(1)}, texel=(${uvU.toFixed(1)}, ${uvV.toFixed(1)})`,
        );
      }
    }

    // Process in chunks to avoid blocking main thread
    const BLOCKERS_PER_CHUNK = 100;

    for (
      let chunkStart = 0;
      chunkStart < blockerCount;
      chunkStart += BLOCKERS_PER_CHUNK
    ) {
      const chunkEnd = Math.min(chunkStart + BLOCKERS_PER_CHUNK, blockerCount);

      for (let i = chunkStart; i < chunkEnd; i++) {
        const blocker = this.pendingBlockers[i];
        // Convert blocker world position to texture UV space (relative to texture center)
        const centerU = (blocker.x - centerX + halfWorld) * texelsPerUnit;
        const centerV = (blocker.z - centerZ + halfWorld) * texelsPerUnit;
        const radiusTexels = blocker.radius * texelsPerUnit;
        const radiusSq = radiusTexels * radiusTexels;

        const minU = Math.max(0, Math.floor(centerU - radiusTexels));
        const maxU = Math.min(
          EXCLUSION_TEXTURE_SIZE - 1,
          Math.ceil(centerU + radiusTexels),
        );
        const minV = Math.max(0, Math.floor(centerV - radiusTexels));
        const maxV = Math.min(
          EXCLUSION_TEXTURE_SIZE - 1,
          Math.ceil(centerV + radiusTexels),
        );

        for (let v = minV; v <= maxV; v++) {
          for (let u = minU; u <= maxU; u++) {
            const dx = u - centerU;
            const dz = v - centerV;
            const distSq = dx * dx + dz * dz;
            if (distSq <= radiusSq) {
              const dist = Math.sqrt(distSq);
              const fade = 1.0 - Math.min(1.0, dist / radiusTexels);
              const idx = v * EXCLUSION_TEXTURE_SIZE + u;
              textureData[idx] = Math.max(textureData[idx], fade);
            }
          }
        }
      }

      // Yield to main thread between chunks
      if (chunkEnd < blockerCount) {
        await yieldToMain();
      }
    }

    // Update the texture image data (preserves shader node reference)
    exclusionTexture.image = {
      data: textureData,
      width: EXCLUSION_TEXTURE_SIZE,
      height: EXCLUSION_TEXTURE_SIZE,
    };
    exclusionTexture.needsUpdate = true;

    // Debug: count non-zero pixels
    let nonZeroCount = 0;
    let maxVal = 0;
    for (let i = 0; i < textureData.length; i++) {
      if (textureData[i] > 0) nonZeroCount++;
      if (textureData[i] > maxVal) maxVal = textureData[i];
    }

    this.exclusionTextureDirty = false;
    const elapsed = (performance.now() - startTime).toFixed(1);

    // Verify texture state
    const texW = exclusionTexture.image.width;
    const texH = exclusionTexture.image.height;
    const texLen = (exclusionTexture.image.data as Float32Array).length;

    console.log(
      `[ProceduralGrass] ✅ Exclusion texture CPU updated: ${blockerCount} blockers, ` +
        `${nonZeroCount}/${texLen} non-zero texels (${((nonZeroCount / texLen) * 100).toFixed(2)}%), ` +
        `max=${maxVal.toFixed(2)}, size=${texW}x${texH}, ` +
        `center=(${this.exclusionCenterX.toFixed(0)}, ${this.exclusionCenterZ.toFixed(0)}), ` +
        `uniformCenter=(${uExclusionCenterX.value.toFixed(0)}, ${uExclusionCenterZ.value.toFixed(0)}), ` +
        `${elapsed}ms`,
    );
  }

  /**
   * Check if exclusion texture needs re-centering based on player movement.
   * Called from update() to keep exclusion texture centered on player.
   */
  private checkExclusionRecenter(playerX: number, playerZ: number): void {
    if (!this.exclusionInitialized) return;

    const dx = playerX - this.exclusionCenterX;
    const dz = playerZ - this.exclusionCenterZ;
    const distSq = dx * dx + dz * dz;
    const threshold = ProceduralGrassSystem.EXCLUSION_RECENTER_THRESHOLD;
    const thresholdSq = threshold * threshold;

    if (distSq > thresholdSq) {
      // Player moved too far from exclusion texture center - regenerate
      console.log(
        `[ProceduralGrass] Re-centering exclusion texture (player moved ${Math.sqrt(distSq).toFixed(0)}m)`,
      );
      this.regenerateExclusionTextureAroundPoint(playerX, playerZ);
    }
  }

  /**
   * Regenerate exclusion texture centered around a point (usually player position).
   * Collects all blockers within range and generates the GPU texture.
   */
  async regenerateExclusionTextureAroundPoint(
    centerX: number,
    centerZ: number,
  ): Promise<void> {
    console.log(
      `[ProceduralGrass] 🔄 regenerateExclusionTextureAroundPoint called: center=(${centerX.toFixed(0)}, ${centerZ.toFixed(0)})`,
    );

    // Update center
    this.exclusionCenterX = centerX;
    this.exclusionCenterZ = centerZ;

    // Update uniforms for GPU shader sampling
    uExclusionCenterX.value = centerX;
    uExclusionCenterZ.value = centerZ;

    console.log(
      `[ProceduralGrass] Updated uniforms: uExclusionCenterX=${uExclusionCenterX.value}, uExclusionCenterZ=${uExclusionCenterZ.value}, uExclusionWorldSize=${uExclusionWorldSize.value}`,
    );

    // Collect and refresh
    await this.collectAndRefreshExclusionTexture();

    this.exclusionInitialized = true;
    console.log(
      `[ProceduralGrass] ✅ Exclusion texture regeneration complete, exclusionInitialized=true`,
    );
  }

  /**
   * Collect blockers from tree and rock instancers, then regenerate texture.
   * Also collects building exclusion zones from GrassExclusionManager.
   * Only includes blockers within EXCLUSION_WORLD_SIZE/2 of the current center.
   */
  async collectAndRefreshExclusionTexture(): Promise<void> {
    this.clearExclusionBlockers();

    const halfWorld = EXCLUSION_WORLD_SIZE / 2;
    const centerX = this.exclusionCenterX;
    const centerZ = this.exclusionCenterZ;

    let treeCount = 0;
    let rockCount = 0;
    let buildingBlockerCount = 0;
    let includedTrees = 0;
    let includedRocks = 0;
    let includedBuildings = 0;

    // Get tree instancer
    const treeInstancer = this.world.getSystem("treeInstancer") as {
      getTreePositions?: () => Array<{ x: number; z: number; radius: number }>;
      instances?: Map<
        string,
        { inst: { position: THREE.Vector3; radius: number } }
      >;
    } | null;

    if (treeInstancer?.instances) {
      for (const [, data] of treeInstancer.instances) {
        const pos = data.inst.position;
        treeCount++;

        // Only include blockers within texture range
        const dx = pos.x - centerX;
        const dz = pos.z - centerZ;
        if (Math.abs(dx) <= halfWorld + 5 && Math.abs(dz) <= halfWorld + 5) {
          const trunkRadius = Math.max(data.inst.radius * 0.15, 0.3);
          this.addExclusionBlocker(pos.x, pos.z, trunkRadius);
          includedTrees++;
        }
      }
    }

    // Get rock instancer
    const rockInstancer = this.world.getSystem("rockInstancer") as {
      instances?: Map<string, { position: THREE.Vector3; radius: number }>;
    } | null;

    if (rockInstancer?.instances) {
      for (const [, data] of rockInstancer.instances) {
        rockCount++;

        // Only include blockers within texture range
        const dx = data.position.x - centerX;
        const dz = data.position.z - centerZ;
        if (Math.abs(dx) <= halfWorld + 5 && Math.abs(dz) <= halfWorld + 5) {
          this.addExclusionBlocker(
            data.position.x,
            data.position.z,
            data.radius,
          );
          includedRocks++;
        }
      }
    }

    // Collect building exclusion zones from GrassExclusionManager
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const exclusionManager = getGrassExclusionManager();
    const rectBlockers = exclusionManager.getRectangularBlockers();

    for (const blocker of rectBlockers) {
      // Check if building is within texture range (rough check using center)
      const dx = blocker.centerX - centerX;
      const dz = blocker.centerZ - centerZ;
      const buildingHalfDiag =
        Math.sqrt(
          blocker.width * blocker.width + blocker.depth * blocker.depth,
        ) / 2;

      if (
        Math.abs(dx) <= halfWorld + buildingHalfDiag &&
        Math.abs(dz) <= halfWorld + buildingHalfDiag
      ) {
        // Convert rectangular blocker to multiple circular blockers
        // Use tighter grid with larger radius to ensure full coverage with fade
        const cos = Math.cos(blocker.rotation);
        const sin = Math.sin(blocker.rotation);
        const halfW = blocker.width / 2;
        const halfD = blocker.depth / 2;

        // Use consistent spacing and radius for reliable coverage across all building sizes
        // The exclusion texture resolution is ~1m/texel, so spacing should be at most 1m
        // to ensure every texel within the building gets strong exclusion
        const spacing = 0.8; // 0.8 meter spacing for denser coverage

        // Radius must ensure overlap zones have exclusion value > 0.9 (strong exclusion)
        // Extra 0.2m padding beyond building edge ensures no grass grows within 0.1m of footprint
        // At midpoint between circles (0.4m): value = 1 - 0.4/radius
        // Want 0.9 = 1 - 0.4/radius => radius = 0.4 / 0.1 = 4.0m
        const circleRadius = 3.0; // Strong overlap + 0.1m padding beyond building edge

        const stepsX = Math.ceil(blocker.width / spacing);
        const stepsZ = Math.ceil(blocker.depth / spacing);

        for (let ix = 0; ix <= stepsX; ix++) {
          for (let iz = 0; iz <= stepsZ; iz++) {
            const localX = -halfW + (blocker.width * ix) / stepsX;
            const localZ = -halfD + (blocker.depth * iz) / stepsZ;

            const worldX = blocker.centerX + localX * cos - localZ * sin;
            const worldZ = blocker.centerZ + localX * sin + localZ * cos;

            this.addExclusionBlocker(worldX, worldZ, circleRadius);
            buildingBlockerCount++;
          }
        }
        includedBuildings++;
      }
    }

    // Log detailed building info for debugging
    if (rectBlockers.length > 0) {
      const sample = rectBlockers.slice(0, 5);
      console.log(
        `[ProceduralGrass] 🏠 Registered buildings (${rectBlockers.length} total):`,
      );
      sample.forEach((b, i) => {
        const dx = b.centerX - centerX;
        const dz = b.centerZ - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const inRange = dist < halfWorld + 50;
        console.log(
          `  [${i}] ${b.id}: center=(${b.centerX.toFixed(0)},${b.centerZ.toFixed(0)}), size=${b.width.toFixed(0)}x${b.depth.toFixed(0)}, dist=${dist.toFixed(0)}m ${inRange ? "✓ IN RANGE" : "✗ OUT OF RANGE"}`,
        );
      });
    } else {
      console.log(
        `[ProceduralGrass] ⚠️ NO BUILDINGS REGISTERED in GrassExclusionManager!`,
      );
    }

    console.log(
      `[ProceduralGrass] 📊 Exclusion centered at (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), ` +
        `texture covers ±${(EXCLUSION_WORLD_SIZE / 2).toFixed(0)}m: ` +
        `${includedTrees}/${treeCount} trees, ${includedRocks}/${rockCount} rocks, ` +
        `${includedBuildings}/${rectBlockers.length} buildings (${buildingBlockerCount} circles). ` +
        `Total blockers: ${this.pendingBlockers.length}`,
    );

    // Regenerate texture
    await this.refreshExclusionTexture();
  }

  /**
   * Handle terrain tile generation - update heightmap for this tile region.
   */
  private onTerrainTileGenerated(tileX: number, tileZ: number): void {
    if (
      !this.heightmapInitialized ||
      !this.terrainSystem ||
      !this.heightmapData
    )
      return;

    // Get terrain tile size
    const tileSize =
      (this.terrainSystem as { getTileSize?: () => number }).getTileSize?.() ??
      100;

    // Calculate tile world bounds
    const tileWorldX = tileX * tileSize;
    const tileWorldZ = tileZ * tileSize;

    // Update the heightmap region that overlaps with this tile
    this.updateHeightmapRegion(tileWorldX, tileWorldZ, tileSize, tileSize);
  }

  /**
   * Update a region of the heightmap by sampling terrain.
   * Called when terrain tiles load or when re-centering.
   */
  private updateHeightmapRegion(
    worldMinX: number,
    worldMinZ: number,
    worldWidth: number,
    worldHeight: number,
  ): void {
    if (!this.terrainSystem || !this.heightmapData) return;

    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;
    const halfWorld = WORLD_SIZE / 2;
    const metersPerPixel = WORLD_SIZE / SIZE;

    // Convert world region to heightmap pixel coordinates
    // Heightmap UV: (worldX - centerX + halfWorld) / WORLD_SIZE
    const pixelMinX = Math.floor(
      ((worldMinX - this.heightmapCenterX + halfWorld) / WORLD_SIZE) * SIZE,
    );
    const pixelMinZ = Math.floor(
      ((worldMinZ - this.heightmapCenterZ + halfWorld) / WORLD_SIZE) * SIZE,
    );
    const pixelMaxX = Math.ceil(
      ((worldMinX + worldWidth - this.heightmapCenterX + halfWorld) /
        WORLD_SIZE) *
        SIZE,
    );
    const pixelMaxZ = Math.ceil(
      ((worldMinZ + worldHeight - this.heightmapCenterZ + halfWorld) /
        WORLD_SIZE) *
        SIZE,
    );

    // Clamp to valid range
    const startX = Math.max(0, pixelMinX);
    const startZ = Math.max(0, pixelMinZ);
    const endX = Math.min(SIZE, pixelMaxX);
    const endZ = Math.min(SIZE, pixelMaxZ);

    // Skip if region is entirely outside heightmap
    if (startX >= SIZE || startZ >= SIZE || endX <= 0 || endZ <= 0) return;

    // Update pixels in this region
    let updated = 0;
    for (let pz = startZ; pz < endZ; pz++) {
      for (let px = startX; px < endX; px++) {
        // Convert pixel to world position
        const worldX =
          this.heightmapCenterX - halfWorld + (px + 0.5) * metersPerPixel;
        const worldZ =
          this.heightmapCenterZ - halfWorld + (pz + 0.5) * metersPerPixel;

        // Sample terrain height
        let height = 0;
        try {
          height = this.terrainSystem.getHeightAt(worldX, worldZ);
        } catch {
          height = 0;
        }

        // Normalize and store
        const normalizedHeight = Math.max(0, Math.min(1, height / MAX_HEIGHT));
        const idx = (pz * SIZE + px) * 4;
        this.heightmapData[idx + 0] = normalizedHeight;
        updated++;
      }
    }

    // Mark texture for GPU upload
    if (heightmapTexture && updated > 0) {
      heightmapTexture.needsUpdate = true;
    }
  }

  /**
   * Regenerate entire heightmap centered on a point.
   * Used for initial generation and when player moves far from center.
   */
  private async regenerateHeightmapAroundPoint(
    centerX: number,
    centerZ: number,
  ): Promise<void> {
    if (!this.terrainSystem || !this.heightmapData) return;

    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;
    const halfWorld = WORLD_SIZE / 2;
    const metersPerPixel = WORLD_SIZE / SIZE;

    // Update center
    this.heightmapCenterX = centerX;
    this.heightmapCenterZ = centerZ;

    // Update uniforms for GPU shader (heightmap is now centered at new position)
    uHeightmapCenterX.value = centerX;
    uHeightmapCenterZ.value = centerZ;

    const startTime = performance.now();
    const ROWS_PER_CHUNK = 32;

    let minH = Infinity;
    let maxH = -Infinity;

    // Process in chunks to avoid blocking
    for (let zStart = 0; zStart < SIZE; zStart += ROWS_PER_CHUNK) {
      const chunkStart = performance.now();
      const zEnd = Math.min(zStart + ROWS_PER_CHUNK, SIZE);

      for (let pz = zStart; pz < zEnd; pz++) {
        for (let px = 0; px < SIZE; px++) {
          // Convert pixel to world position
          const worldX = centerX - halfWorld + (px + 0.5) * metersPerPixel;
          const worldZ = centerZ - halfWorld + (pz + 0.5) * metersPerPixel;

          // Sample terrain height
          let height = 0;
          try {
            height = this.terrainSystem.getHeightAt(worldX, worldZ);
          } catch {
            height = 0;
          }

          if (height < minH) minH = height;
          if (height > maxH) maxH = height;

          // Normalize and store
          const normalizedHeight = Math.max(
            0,
            Math.min(1, height / MAX_HEIGHT),
          );
          const idx = (pz * SIZE + px) * 4;
          this.heightmapData[idx + 0] = normalizedHeight;
        }
      }

      // Yield between chunks
      if (shouldYield(chunkStart, 8) && zStart + ROWS_PER_CHUNK < SIZE) {
        await yieldToMain();
      }
    }

    // Mark texture for GPU upload
    if (heightmapTexture) {
      heightmapTexture.needsUpdate = true;
    }

    const totalTime = performance.now() - startTime;
    console.log(
      `[ProceduralGrass] Heightmap regenerated at (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}): ` +
        `${minH.toFixed(1)} to ${maxH.toFixed(1)} in ${totalTime.toFixed(1)}ms`,
    );
  }

  /**
   * Check if heightmap needs re-centering based on player movement.
   * Called from update() to keep heightmap centered on player.
   */
  private checkHeightmapRecenter(playerX: number, playerZ: number): void {
    if (!this.heightmapInitialized) return;

    const dx = playerX - this.heightmapCenterX;
    const dz = playerZ - this.heightmapCenterZ;
    const distSq = dx * dx + dz * dz;
    const thresholdSq =
      HEIGHTMAP_CONFIG.RECENTER_THRESHOLD * HEIGHTMAP_CONFIG.RECENTER_THRESHOLD;

    if (distSq > thresholdSq) {
      // Player moved too far from heightmap center - regenerate
      // This is async but we don't await - it will update in background
      console.log(
        `[ProceduralGrass] Re-centering heightmap (player moved ${Math.sqrt(distSq).toFixed(0)}m)`,
      );
      this.regenerateHeightmapAroundPoint(playerX, playerZ);
    }
  }

  private async initializeGrass(): Promise<void> {
    if (this.grassInitialized) return;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    this.renderer ??=
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    if (!this.renderer) {
      console.warn("[ProceduralGrass] No WebGPU renderer available");
      return;
    }

    try {
      const initStartTime = performance.now();
      console.log("[ProceduralGrass] Starting async initialization...");

      // STEP 1: Load heightmap texture (chunked async - no blocking)
      await this.loadTextures();

      console.log(
        "[ProceduralGrass] After loadTextures - heightmapTextureNode:",
        heightmapTextureNode ? "SET" : "NULL",
      );

      // STEP 1.5: Initialize new grid-based exclusion system
      if (this.useGridExclusion) {
        this.exclusionGrid = getGrassExclusionGrid(this.world);
        this.exclusionGrid.initialize();
        console.log(
          "[ProceduralGrass] Grid-based exclusion system initialized",
        );
      }

      // STEP 1.6: Initialize multi-character bending system
      if (this.useMultiCharacterBending) {
        this.characterInfluence = getCharacterInfluenceManager(this.world);
        this.characterInfluence.initialize();
        console.log(
          "[ProceduralGrass] Multi-character bending system initialized",
        );
      }

      // STEP 2: Create SSBO and meshes
      this.ssbo = new GrassSsbo();

      // Create geometry
      const geometry = this.createGeometry(config.SEGMENTS);

      // Create material
      const material = new GrassMaterial(this.ssbo);

      // Create instanced mesh
      this.mesh = new THREE.InstancedMesh(geometry, material, config.COUNT);
      this.mesh.frustumCulled = false;
      this.mesh.name = "ProceduralGrass_GPU";

      // CRITICAL: Render order 76 = after silhouette (50), before player (100)
      // This prevents silhouette from showing through grass
      this.mesh.renderOrder = 76;

      // Layer 1 = main camera only (matches other vegetation)
      this.mesh.layers.set(1);

      stage.scene.add(this.mesh);

      // ========== LOD1: DISABLED ==========
      // LOD1 grass cards are disabled - using LOD0 with Bayer dither fade only
      // This gives the old-school retro look where grass dithers into terrain
      this.lod1Ssbo = null;
      this.lod1Mesh = null;

      // STEP 3: Pre-run GPU compute initialization during loading
      // This is the KEY OPTIMIZATION - run heavy compute BEFORE gameplay starts
      // Previously this ran via onInit callback causing first-frame spikes
      console.log(
        "[ProceduralGrass] Pre-running GPU compute initialization...",
      );

      // Run LOD0 SSBO initialization only (LOD1 disabled)
      await this.ssbo.runInitialization(this.renderer);

      // Yield to ensure GPU work is flushed
      await yieldToMain();

      this.grassInitialized = true;

      const totalTime = performance.now() - initStartTime;
      console.log(
        `[ProceduralGrass] Initialization complete: ${totalTime.toFixed(1)}ms total\n` +
          `  LOD0: ${config.COUNT.toLocaleString()} blades with Bayer dither fade\n` +
          `  LOD1: DISABLED (using dither fade to terrain)`,
      );
    } catch (error) {
      console.error("[ProceduralGrass] ERROR:", error);
    }
  }

  private createGeometry(nSegments: number): THREE.BufferGeometry {
    // Geometry creation
    const segments = Math.max(1, Math.floor(nSegments));
    const height = config.BLADE_HEIGHT;
    const halfWidthBase = config.BLADE_WIDTH * 0.5;

    const rowCount = segments;
    const vertexCount = rowCount * 2 + 1;
    const quadCount = Math.max(0, rowCount - 1);
    const indexCount = quadCount * 6 + 3;

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint8Array(indexCount);

    const taper = (t: number) => halfWidthBase * (1.0 - 0.7 * t);

    let idx = 0;
    for (let row = 0; row < rowCount; row++) {
      const v = row / segments;
      const y = v * height;
      const halfWidth = taper(v);

      const left = row * 2;
      const right = left + 1;

      positions[3 * left + 0] = -halfWidth;
      positions[3 * left + 1] = y;
      positions[3 * left + 2] = 0;

      positions[3 * right + 0] = halfWidth;
      positions[3 * right + 1] = y;
      positions[3 * right + 2] = 0;

      uvs[2 * left + 0] = 0.0;
      uvs[2 * left + 1] = v;
      uvs[2 * right + 0] = 1.0;
      uvs[2 * right + 1] = v;

      if (row > 0) {
        const prevLeft = (row - 1) * 2;
        const prevRight = prevLeft + 1;

        indices[idx++] = prevLeft;
        indices[idx++] = prevRight;
        indices[idx++] = right;

        indices[idx++] = prevLeft;
        indices[idx++] = right;
        indices[idx++] = left;
      }
    }

    const tip = rowCount * 2;
    positions[3 * tip + 0] = 0;
    positions[3 * tip + 1] = height;
    positions[3 * tip + 2] = 0;
    uvs[2 * tip + 0] = 0.5;
    uvs[2 * tip + 1] = 1.0;

    const lastLeft = (rowCount - 1) * 2;
    const lastRight = lastLeft + 1;
    indices[idx++] = lastLeft;
    indices[idx++] = lastRight;
    indices[idx++] = tip;

    const geom = new THREE.BufferGeometry();

    const posAttribute = new THREE.BufferAttribute(positions, 3);
    posAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("position", posAttribute);

    const uvAttribute = new THREE.BufferAttribute(uvs, 2);
    uvAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("uv", uvAttribute);

    const indexAttribute = new THREE.BufferAttribute(indices, 1);
    indexAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setIndex(indexAttribute);

    return geom;
  }

  update(_deltaTime: number): void {
    if (!this.grassInitialized || !this.mesh || !this.ssbo || !this.renderer)
      return;

    const camera = this.world.camera;
    if (!camera) return;

    const cameraPos = camera.position;

    // Calculate camera movement delta for position wrapping
    const deltaX = cameraPos.x - this.lastCameraX;
    const deltaZ = cameraPos.z - this.lastCameraZ;
    this.lastCameraX = cameraPos.x;
    this.lastCameraZ = cameraPos.z;

    // Get actual player position for trail effect (may differ from camera in 3rd person)
    // Use player.node.position (the 3D mesh position) not player.position (entity data)
    const players = this.world.getPlayers?.() as
      | { node?: { position?: THREE.Vector3 } }[]
      | undefined;
    const player = players?.[0];
    const playerPos = player?.node?.position ?? cameraPos;

    // ========== STREAMING HEIGHTMAP UPDATE ==========
    // Check if heightmap needs re-centering based on player movement
    this.checkHeightmapRecenter(cameraPos.x, cameraPos.z);

    // ========== GRID-BASED EXCLUSION UPDATE ==========
    // Update grid-based exclusion (for collision-blocked tiles: rocks, trees)
    if (this.useGridExclusion && this.exclusionGrid) {
      this.exclusionGrid.update(cameraPos.x, cameraPos.z);
    }

    // ========== LEGACY EXCLUSION TEXTURE UPDATE ==========
    // ALWAYS update legacy texture (for buildings, duel arenas that don't set collision flags)
    // This runs in ADDITION to grid-based, not instead of
    this.checkExclusionRecenter(cameraPos.x, cameraPos.z);

    // ========== MULTI-CHARACTER BENDING UPDATE ==========
    // Update character influence manager for multi-character grass bending
    if (this.useMultiCharacterBending && this.characterInfluence) {
      this.characterInfluence.updateFromWorld(cameraPos);
    }

    // Update uniforms
    uniforms.uCameraPosition.value.copy(cameraPos); // For distance culling
    uniforms.uPlayerPosition.value.copy(playerPos); // For trail effect only
    uniforms.uPlayerDeltaXZ.value.set(deltaX, deltaZ); // For position wrapping

    // Update heightmap center for GPU shader sampling
    // The shader needs to know where the heightmap is centered to sample correctly
    uHeightmapCenterX.value = this.heightmapCenterX;
    uHeightmapCenterZ.value = this.heightmapCenterZ;

    // NOTE: Lighting is controlled by Environment.updateGrassLighting()
    // via setLightIntensity(). DO NOT override here - let Environment
    // be the authoritative source for day/night cycle.

    // Camera frustum data
    const proj = camera.projectionMatrix;
    uniforms.uCameraMatrix.value.copy(proj).multiply(camera.matrixWorldInverse);
    camera.getWorldDirection(uniforms.uCameraForward.value);

    // Move grass meshes to follow CAMERA (density is camera-based)
    this.mesh.position.set(cameraPos.x, 0, cameraPos.z);

    // Run LOD0 compute shader
    this.renderer.computeAsync(this.ssbo.computeUpdate);

    // LOD1: Update simple triangles
    if (this.lod1Mesh && this.lod1Ssbo) {
      this.lod1Mesh.position.set(cameraPos.x, 0, cameraPos.z);
      this.renderer.computeAsync(this.lod1Ssbo.computeUpdate);
    }
  }

  // Public API
  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }

  getLOD1Mesh(): THREE.InstancedMesh | null {
    return this.lod1Mesh;
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
    if (this.lod1Mesh) this.lod1Mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.mesh?.visible ?? false;
  }

  /**
   * Set road influence texture for grass culling on roads.
   * Call this after roads are generated to prevent grass from growing on roads.
   *
   * @param data - Float32Array of road influence values (0-1)
   * @param width - Texture width
   * @param height - Texture height
   * @param worldSize - World size in meters covered by the texture
   * @param centerX - World center X (default 0)
   * @param centerZ - World center Z (default 0)
   */
  setRoadInfluenceTexture(
    data: Float32Array,
    width: number,
    height: number,
    worldSize: number,
    centerX: number = 0,
    centerZ: number = 0,
  ): void {
    // Update the existing texture's image data directly
    // This preserves the texture node reference that was compiled into the shader
    // We can't dispose/recreate because the shader holds a reference to the original texture object
    roadInfluenceTexture.image = { data, width, height };
    roadInfluenceTexture.needsUpdate = true;

    // Update uniforms
    uRoadInfluenceWorldSize.value = worldSize;
    uRoadInfluenceCenterX.value = centerX;
    uRoadInfluenceCenterZ.value = centerZ;

    console.log(
      `[ProceduralGrass] ✅ Road influence texture updated: ${width}x${height}, ` +
        `${worldSize}m coverage, center (${centerX}, ${centerZ})`,
    );
  }

  /** Clear road influence texture (grass will grow everywhere) */
  clearRoadInfluenceTexture(): void {
    // Reset texture to 1x1 empty (0 = no road influence)
    const emptyData = new Float32Array([0]);
    roadInfluenceTexture.image = { data: emptyData, width: 1, height: 1 };
    roadInfluenceTexture.needsUpdate = true;
    uRoadInfluenceWorldSize.value = 1;
    console.log(
      "[ProceduralGrass] Road influence texture cleared (reset to empty)",
    );
  }

  /** Set road influence culling threshold (0-1). Lower = more aggressive culling */
  setRoadInfluenceThreshold(threshold: number): void {
    uRoadInfluenceThreshold.value = Math.max(0, Math.min(1, threshold));
  }

  /** Get current road influence culling threshold */
  getRoadInfluenceThreshold(): number {
    return uRoadInfluenceThreshold.value;
  }

  static getConfig(): typeof config {
    return config;
  }

  // ============================================================================
  // DEBUG API - Color pickers and parameter controls
  // Call from console: world.getSystem("proceduralGrass").setBaseColor(r, g, b)
  // ============================================================================

  /** Set grass base color (at root). RGB values 0-1 */
  setBaseColor(r: number, g: number, b: number): void {
    uniforms.uBaseColor.value.setRGB(r, g, b);
    lod1Uniforms.uBaseColor.value.setRGB(r, g, b);
  }

  getBaseColor(): { r: number; g: number; b: number } {
    const c = uniforms.uBaseColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set grass tip color (at top). RGB values 0-1 */
  setTipColor(r: number, g: number, b: number): void {
    uniforms.uTipColor.value.setRGB(r, g, b);
    lod1Uniforms.uTipColor.value.setRGB(r, g, b);
  }

  getTipColor(): { r: number; g: number; b: number } {
    const c = uniforms.uTipColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set day/night mix. 0 = night, 1 = day */
  setDayNightMix(mix: number): void {
    uniforms.uDayNightMix.value = mix;
  }

  /** Set sun direction for terrain-based lighting (normalized vector) */
  setSunDirection(x: number, y: number, z: number): void {
    uniforms.uSunDirection.value.set(x, y, z).normalize();
  }

  /** Get sun direction for terrain-based lighting */
  getSunDirection(): { x: number; y: number; z: number } {
    const d = uniforms.uSunDirection.value;
    return { x: d.x, y: d.y, z: d.z };
  }

  /** Set terrain lighting parameters */
  setTerrainLighting(ambient: number, diffuse: number): void {
    uniforms.uTerrainLightAmbient.value = ambient;
    uniforms.uTerrainLightDiffuse.value = diffuse;
  }

  /** Set day color multiplier (RGB 0-1). Default is white (1,1,1) for full brightness */
  setDayColor(r: number, g: number, b: number): void {
    uniforms.uDayColor.value.setRGB(r, g, b);
  }

  /** Get current day color */
  getDayColor(): { r: number; g: number; b: number } {
    const c = uniforms.uDayColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Debug: Print exclusion system state to console */
  async debugExclusionState(): Promise<void> {
    console.group("[ProceduralGrass] 🔍 EXCLUSION DEBUG STATE");

    // Module-level state
    console.log("Module-level textures:");
    console.log(
      `  roadInfluenceTexture: ${roadInfluenceTexture ? `${roadInfluenceTexture.image.width}x${roadInfluenceTexture.image.height}` : "NULL"}`,
    );
    console.log(
      `  roadInfluenceTextureNode: ${roadInfluenceTextureNode ? "SET" : "NULL"}`,
    );
    console.log(
      `  exclusionTexture: ${exclusionTexture ? `${exclusionTexture.image.width}x${exclusionTexture.image.height}` : "NULL"}`,
    );
    console.log(
      `  exclusionTextureNode: ${exclusionTextureNode ? "SET" : "NULL"}`,
    );
    console.log(
      `  gridExclusionTextureNode: ${gridExclusionTextureNode ? "SET" : "NULL"}`,
    );
    console.log(`  useGridBasedExclusion: ${useGridBasedExclusion}`);

    // Uniforms
    console.log("Exclusion uniforms:");
    console.log(`  uExclusionCenterX: ${uExclusionCenterX.value}`);
    console.log(`  uExclusionCenterZ: ${uExclusionCenterZ.value}`);
    console.log(`  uExclusionWorldSize: ${uExclusionWorldSize.value}`);
    console.log(`  uGridExclusionCenterX: ${uGridExclusionCenterX.value}`);
    console.log(`  uGridExclusionCenterZ: ${uGridExclusionCenterZ.value}`);
    console.log(`  uGridExclusionWorldSize: ${uGridExclusionWorldSize.value}`);

    // Instance state
    console.log("Instance state:");
    console.log(`  exclusionCenterX: ${this.exclusionCenterX}`);
    console.log(`  exclusionCenterZ: ${this.exclusionCenterZ}`);
    console.log(`  exclusionInitialized: ${this.exclusionInitialized}`);
    console.log(`  pendingBlockers.length: ${this.pendingBlockers.length}`);
    console.log(`  exclusionTextureDirty: ${this.exclusionTextureDirty}`);

    // Check texture data
    if (exclusionTexture && exclusionTexture.image.data) {
      const data = exclusionTexture.image.data as Float32Array;
      let nonZero = 0;
      let maxVal = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > 0) nonZero++;
        if (data[i] > maxVal) maxVal = data[i];
      }
      console.log(
        `  Exclusion texture stats: ${nonZero}/${data.length} non-zero (${((nonZero / data.length) * 100).toFixed(2)}%), max=${maxVal.toFixed(3)}`,
      );
    }

    // Check GrassExclusionManager
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const manager = getGrassExclusionManager();
    const rectBlockers = manager.getRectangularBlockers();
    const circBlockers = manager.getCircularBlockers();
    console.log("GrassExclusionManager:");
    console.log(`  Rectangular blockers: ${rectBlockers.length}`);
    console.log(`  Circular blockers: ${circBlockers.length}`);
    if (rectBlockers.length > 0) {
      console.log("  First 3 rect blockers:");
      rectBlockers.slice(0, 3).forEach((b) => {
        console.log(
          `    ${b.id}: center=(${b.centerX.toFixed(0)}, ${b.centerZ.toFixed(0)}), size=${b.width.toFixed(0)}x${b.depth.toFixed(0)}`,
        );
      });
    }

    console.groupEnd();
  }

  /** Force refresh exclusion texture now (useful for debugging) */
  async forceRefreshExclusion(): Promise<void> {
    console.log(
      "[ProceduralGrass] 🔃 Force refresh exclusion texture requested",
    );
    const camera = this.world.camera;
    const centerX = camera?.position.x ?? 0;
    const centerZ = camera?.position.z ?? 0;
    await this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
  }

  /** Set night color multiplier (RGB 0-1). Tints grass at night */
  setNightColor(r: number, g: number, b: number): void {
    uniforms.uNightColor.value.setRGB(r, g, b);
  }

  /** Get current night color */
  getNightColor(): { r: number; g: number; b: number } {
    const c = uniforms.uNightColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set wind strength. 0-2 typical range */
  setWindStrength(strength: number): void {
    uniforms.uWindStrength.value = strength;
  }

  /** Get wind strength */
  getWindStrength(): number {
    return uniforms.uWindStrength.value;
  }

  /** Set wind speed. 0-1 typical range */
  setWindSpeed(speed: number): void {
    uniforms.uWindSpeed.value = speed;
  }

  /** Get wind speed */
  getWindSpeed(): number {
    return uniforms.uWindSpeed.value;
  }

  /** Set color mix factor (how much tip color shows). 0-1 */
  setColorMixFactor(factor: number): void {
    uniforms.uColorMixFactor.value = factor;
  }

  /** Set color variation strength. 0-3 typical range */
  setColorVariation(strength: number): void {
    uniforms.uColorVariationStrength.value = strength;
  }

  /** Set AO (ambient occlusion) scale. 0-2 typical range */
  setAoScale(scale: number): void {
    uniforms.uAoScale.value = scale;
  }

  /** Set wind shade strength (darkening when wind bends grass). 0-1 */
  setWindShade(strength: number): void {
    uniforms.uBaseWindShade.value = strength;
  }

  /** Set trail radius for player distortion (meters) */
  setTrailRadius(radius: number): void {
    uniforms.uTrailRadius.value = radius;
    uniforms.uTrailRadiusSquared.value = radius * radius;
  }

  /** Get trail radius. Meters */
  getTrailRadius(): number {
    return uniforms.uTrailRadius.value;
  }

  /** Set wind scale (affects wind pattern size). Higher = larger waves */
  setWindScale(scale: number): void {
    uniforms.uvWindScale.value = scale;
  }

  /** Get wind scale */
  getWindScale(): number {
    return uniforms.uvWindScale.value;
  }

  /** Set stochastic culling inner radius (full density within this). Meters */
  setCullingR0(radius: number): void {
    uniforms.uR0.value = radius;
  }

  /** Get stochastic culling inner radius. Meters */
  getCullingR0(): number {
    return uniforms.uR0.value;
  }

  /** Set stochastic culling outer radius (thin to minimum at this). Meters */
  setCullingR1(radius: number): void {
    uniforms.uR1.value = radius;
  }

  /** Get stochastic culling outer radius. Meters */
  getCullingR1(): number {
    return uniforms.uR1.value;
  }

  /** Set minimum density at outer culling radius. 0-1 (0 = cull all, 1 = keep all) */
  setCullingPMin(pMin: number): void {
    uniforms.uPMin.value = pMin;
  }

  /** Get minimum density at outer culling radius */
  getCullingPMin(): number {
    return uniforms.uPMin.value;
  }

  /** Set distance fade start (begin fading at this distance). Meters */
  setFadeStart(distance: number): void {
    uniforms.uFadeStart.value = distance;
  }

  /** Get distance fade start. Meters */
  getFadeStart(): number {
    return uniforms.uFadeStart.value;
  }

  /** Set distance fade end (fully faded at this distance). Meters */
  setFadeEnd(distance: number): void {
    uniforms.uFadeEnd.value = distance;
  }

  /** Get distance fade end. Meters */
  getFadeEnd(): number {
    return uniforms.uFadeEnd.value;
  }

  // ========== LOD1 FADE CONTROLS ==========

  /** Set LOD1 fade in start (begin appearing at this distance). Meters */
  setLOD1FadeInStart(distance: number): void {
    lod1Uniforms.uFadeInStart.value = distance;
  }

  /** Get LOD1 fade in start. Meters */
  getLOD1FadeInStart(): number {
    return lod1Uniforms.uFadeInStart.value;
  }

  /** Set LOD1 fade in end (fully visible at this distance). Meters */
  setLOD1FadeInEnd(distance: number): void {
    lod1Uniforms.uFadeInEnd.value = distance;
  }

  /** Get LOD1 fade in end. Meters */
  getLOD1FadeInEnd(): number {
    return lod1Uniforms.uFadeInEnd.value;
  }

  /** Set LOD1 fade out start (begin fading at this distance). Meters */
  setLOD1FadeOutStart(distance: number): void {
    lod1Uniforms.uFadeOutStart.value = distance;
  }

  /** Get LOD1 fade out start. Meters */
  getLOD1FadeOutStart(): number {
    return lod1Uniforms.uFadeOutStart.value;
  }

  /** Set LOD1 fade out end (fully invisible at this distance). Meters */
  setLOD1FadeOutEnd(distance: number): void {
    lod1Uniforms.uFadeOutEnd.value = distance;
  }

  /** Get LOD1 fade out end. Meters */
  getLOD1FadeOutEnd(): number {
    return lod1Uniforms.uFadeOutEnd.value;
  }

  /** Get day/night mix value. 0 = night, 1 = day */
  getDayNightMix(): number {
    return uniforms.uDayNightMix.value;
  }

  /** Get all current uniform values for debugging */
  getDebugInfo(): Record<string, number | { r: number; g: number; b: number }> {
    return {
      baseColor: this.getBaseColor(),
      tipColor: this.getTipColor(),
      dayColor: this.getDayColor(),
      nightColor: this.getNightColor(),
      dayNightMix: uniforms.uDayNightMix.value,
      windStrength: uniforms.uWindStrength.value,
      windSpeed: uniforms.uWindSpeed.value,
      colorMixFactor: uniforms.uColorMixFactor.value,
      colorVariation: uniforms.uColorVariationStrength.value,
      aoScale: uniforms.uAoScale.value,
      windShade: uniforms.uBaseWindShade.value,
      trailRadius: uniforms.uTrailRadius.value,
      cullingR0: uniforms.uR0.value,
      cullingR1: uniforms.uR1.value,
      fadeStart: uniforms.uFadeStart.value,
      fadeEnd: uniforms.uFadeEnd.value,
    };
  }

  /** Static access to uniforms for external debug panels */
  static getUniforms() {
    return uniforms;
  }

  static getLOD1Uniforms() {
    return lod1Uniforms;
  }

  stop(): void {
    // Remove terrain event listeners
    if (this.onTileGeneratedBound) {
      // Type cast needed for EventEmitter compatibility
      this.world.off(
        "terrain:tile:generated",
        this.onTileGeneratedBound as (...args: unknown[]) => void,
      );
      this.onTileGeneratedBound = null;
    }

    // Remove road event listeners
    if (this.onRoadsGeneratedBound) {
      this.world.off("roads:generated", this.onRoadsGeneratedBound);
      this.onRoadsGeneratedBound = null;
    }

    // LOD0 cleanup
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh = null;
    this.ssbo = null;

    // LOD1 cleanup (cards)
    this.lod1Mesh?.removeFromParent();
    this.lod1Mesh?.geometry.dispose();
    (this.lod1Mesh?.material as THREE.Material | undefined)?.dispose();
    this.lod1Mesh = null;
    this.lod1Ssbo = null;

    // Streaming heightmap cleanup
    this.heightmapData = null;
    this.terrainSystem = null;
    this.heightmapInitialized = false;

    this.grassInitialized = false;
    this.noiseTexture?.dispose();
    noiseAtlasTexture = null;
    heightmapTexture?.dispose();
    heightmapTexture = null;
    heightmapTextureNode = null;

    // Road influence texture cleanup - reset to dummy but don't nullify (shader holds reference)
    const dummyRoad = new Float32Array([0]);
    roadInfluenceTexture.image = { data: dummyRoad, width: 1, height: 1 };
    roadInfluenceTexture.needsUpdate = true;
    uRoadInfluenceWorldSize.value = 1;
    uRoadInfluenceCenterX.value = 0;
    uRoadInfluenceCenterZ.value = 0;

    // Exclusion texture cleanup - reset to dummy but don't nullify (shader holds reference)
    const dummyExcl = new Float32Array([0]);
    exclusionTexture.image = { data: dummyExcl, width: 1, height: 1 };
    exclusionTexture.needsUpdate = true;
    uExclusionWorldSize.value = 1;
    uExclusionCenterX.value = 0;
    uExclusionCenterZ.value = 0;
    this.pendingBlockers = [];
    this.exclusionTextureDirty = false;
    this.exclusionBlockerBuffer = null;
    this.exclusionOutputBuffer = null;
    this.exclusionComputeNode = null;
    if (this.exclusionRefreshTimer) {
      clearTimeout(this.exclusionRefreshTimer);
      this.exclusionRefreshTimer = null;
    }

    // Unsubscribe from GrassExclusionManager
    if (this.exclusionManagerUnsubscribe) {
      this.exclusionManagerUnsubscribe();
      this.exclusionManagerUnsubscribe = null;
    }

    // Cleanup new grid-based exclusion system
    if (this.exclusionGrid) {
      disposeGrassExclusionGrid();
      this.exclusionGrid = null;
    }

    // Cleanup multi-character bending system
    if (this.characterInfluence) {
      disposeCharacterInfluenceManager();
      this.characterInfluence = null;
    }
  }
}

// ============================================================================
// TERRAIN SYSTEM INTERFACE
// ============================================================================

interface TerrainSystemInterface {
  getHeightAt(worldX: number, worldZ: number): number;
}

// ============================================================================
// ROAD NETWORK SYSTEM INTERFACE
// ============================================================================

interface RoadNetworkSystemInterface {
  generateRoadInfluenceTexture(
    textureSize?: number,
    worldSize?: number,
    extraBlendWidth?: number,
  ): {
    data: Float32Array;
    width: number;
    height: number;
    worldSize: number;
  } | null;
}
