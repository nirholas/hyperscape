/**
 * GrassSystem.ts - Procedural WebGPU Grass Rendering
 *
 * High-performance grass rendering using WebGPU with TSL (Three Shading Language).
 * Generates dense grass fields with realistic wind animation.
 *
 * **Features:**
 * - Procedural triangle strip grass blades (5-7 vertices per blade)
 * - GPU-instanced rendering for millions of blades
 * - Realistic multi-layer wind animation (gust + sway + flutter)
 * - Biome-based density and color variation
 * - Distance-based LOD and smooth dissolve fade
 * - Chunked rendering tied to terrain tiles
 * - Frustum culling per chunk
 *
 * **Performance:**
 * - Single draw call per chunk (~50k-100k instances)
 * - Vertex shader wind animation (no CPU overhead)
 * - Aggressive distance culling (grass fades by 60m)
 * - Chunk pooling for memory efficiency
 *
 * **Integration:**
 * - Listens to TerrainSystem tile events for generation
 * - Uses Wind system uniforms for animation
 * - Respects biome grass density from biomes.json
 *
 * **Runs on:** Client only (grass is purely visual)
 */

import THREE, {
  uniform,
  attribute,
  Fn,
  MeshStandardNodeMaterial,
  float,
  vec3,
  vec4,
  vec2,
  sin,
  cos,
  mul,
  add,
  sub,
  fract,
  smoothstep,
  positionLocal,
  positionWorld,
  mix,
  step,
  uv,
  instanceIndex,
  texture,
} from "../../../extras/three/three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { EventType } from "../../../types/events";
import { NoiseGenerator } from "../../../utils/NoiseGenerator";
import type { Wind } from "./Wind";
import { generateNoiseTexture, TERRAIN_CONSTANTS } from "./TerrainShader";
import {
  isGPUComputeAvailable,
  getGPUComputeManager,
} from "../../../utils/compute";
import {
  isGrassWorkerAvailable,
  generateGrassPlacementsAsync,
  type GrassPlacementData,
} from "../../../utils/workers/GrassWorker";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Grass rendering configuration.
 */
export const GRASS_CONFIG = {
  /** Grass blade height in meters (base, varies per instance) */
  BLADE_HEIGHT: 0.35,

  /** Grass blade width at base in meters */
  BLADE_WIDTH: 0.035,

  /** Number of segments per blade (more = smoother bend) */
  BLADE_SEGMENTS: 3,

  /** Number of blades per tuft (grouped for efficiency) */
  BLADES_PER_TUFT: 4,

  /** Maximum instances per chunk (power of 2 for GPU memory alignment) */
  MAX_INSTANCES_PER_CHUNK: 65536,

  /** Chunk size in meters (should match or subdivide terrain tile) */
  CHUNK_SIZE: 25,

  /** Terrain tile size in meters (must match TerrainSystem.CONFIG.TILE_SIZE) */
  TILE_SIZE: 100,

  /** Base density: tufts per square meter (each tuft has BLADES_PER_TUFT blades) */
  BASE_DENSITY: 12,

  /** Distance where grass starts fading (meters from player) */
  FADE_START: 80,

  /** Distance where grass is fully invisible */
  FADE_END: 120,

  /**
   * Shoreline grass cutoff - matches terrain shader's visual zones:
   * - Green terrain: above 14m
   * - Wet dirt zone: 8-14m (grass fades)
   * - Mud zone: 6-9m (no grass)
   * - Water's edge: 5-6.5m (no grass)
   * - Water: below 5m (no grass)
   */
  SHORELINE_FADE_START: 14.0, // Full grass above this
  SHORELINE_FADE_END: 9.0, // No grass below this (matches mud zone start)

  // Wind animation parameters - GENTLE AND REALISTIC
  /** Primary wind oscillation speed (lower = gentler sway) */
  WIND_SPEED: 0.3,

  /** Secondary gust wave speed */
  GUST_SPEED: 0.12,

  /** Maximum wind bend angle (radians) - subtle sway */
  MAX_BEND: 0.25,

  /** Flutter intensity for blade tips - very subtle */
  FLUTTER_INTENSITY: 0.08,

  // Color variation - slightly lighter than terrain to catch light
  /** Base grass color (slightly lighter than terrain grassGreen for better visibility) */
  BASE_COLOR: new THREE.Color(0.38, 0.62, 0.22),

  /** Tip color (lighter, catches sunlight) */
  TIP_COLOR: new THREE.Color(0.48, 0.72, 0.32),

  /** Dark grass color for variation (matches terrain grassDark) */
  DARK_COLOR: new THREE.Color(0.28, 0.48, 0.15),

  // LOD - Dense close, sparse far
  /** Near distance for full density */
  LOD_NEAR: 20,

  /** Far distance for reduced density */
  LOD_FAR: 40,

  /** Density reduction at far distance (0.5 = 50%) */
  LOD_FAR_DENSITY: 0.3,
} as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Grass chunk data - manages instances for a spatial region
 */
interface GrassChunk {
  /** Chunk key "x_z" */
  key: string;
  /** World X origin */
  originX: number;
  /** World Z origin */
  originZ: number;
  /** Instanced mesh for this chunk */
  mesh: THREE.InstancedMesh;
  /** Instance count */
  count: number;
  /** Whether chunk is currently visible */
  visible: boolean;
  /** Bounding sphere for frustum culling */
  boundingSphere: THREE.Sphere;
}

/**
 * Grass material with custom uniforms
 */
type GrassMaterial = THREE.MeshStandardNodeMaterial & {
  grassUniforms: {
    time: { value: number };
    windStrength: { value: number };
    windDirection: { value: THREE.Vector3 };
    playerPos: { value: THREE.Vector3 };
    cameraPos: { value: THREE.Vector3 };
  };
};

/**
 * Biome grass configuration
 */
export interface BiomeGrassConfig {
  /** Whether grass is enabled for this biome */
  enabled: boolean;
  /** Density multiplier (1.0 = normal, 0.5 = half density) */
  densityMultiplier: number;
  /** Color tint applied to grass */
  colorTint?: THREE.Color;
  /** Height multiplier (1.0 = normal) */
  heightMultiplier?: number;
}

/**
 * Default biome grass configurations
 * Most biomes have some grass - only truly hostile terrain (lakes underwater) has none
 */
export const BIOME_GRASS_DEFAULTS: Record<string, BiomeGrassConfig> = {
  plains: { enabled: true, densityMultiplier: 1.2, heightMultiplier: 1.0 },
  forest: { enabled: true, densityMultiplier: 0.8, heightMultiplier: 0.9 },
  valley: { enabled: true, densityMultiplier: 1.1, heightMultiplier: 1.1 },
  hills: { enabled: true, densityMultiplier: 0.9, heightMultiplier: 0.85 },
  mountains: { enabled: true, densityMultiplier: 0.4, heightMultiplier: 0.7 },
  desert: { enabled: true, densityMultiplier: 0.3, heightMultiplier: 0.6 },
  tundra: { enabled: true, densityMultiplier: 0.2, heightMultiplier: 0.5 },
  swamp: { enabled: true, densityMultiplier: 0.8, heightMultiplier: 1.3 },
  lakes: { enabled: true, densityMultiplier: 0.3, heightMultiplier: 0.8 },
};

// ============================================================================
// GRASS GEOMETRY GENERATION
// ============================================================================

/**
 * Creates a grass tuft geometry with multiple blades for efficiency.
 * Each tuft contains BLADES_PER_TUFT blades arranged in a small cluster.
 * This reduces instance count while maintaining visual density.
 *
 * Blade structure (per blade):
 *   Segments from base to tip, tapering width
 *
 * UV mapping: u = blade index (for variation), v = height (0=base, 1=tip)
 */
function createGrassBladeGeometry(
  segments: number = GRASS_CONFIG.BLADE_SEGMENTS,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const bladesPerTuft = GRASS_CONFIG.BLADES_PER_TUFT;

  // Each blade: (segments + 1) * 2 vertices
  const verticesPerBlade = (segments + 1) * 2;
  const trianglesPerBlade = segments * 2;
  const totalVertices = verticesPerBlade * bladesPerTuft;
  const totalTriangles = trianglesPerBlade * bladesPerTuft;

  const positions = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const normals = new Float32Array(totalVertices * 3);
  const indices = new Uint16Array(totalTriangles * 3);

  // Generate each blade in the tuft
  for (let blade = 0; blade < bladesPerTuft; blade++) {
    // Random offset for this blade within the tuft (deterministic)
    const angle = (blade / bladesPerTuft) * Math.PI * 2 + blade * 0.7;
    const radius = 0.03 + blade * 0.02; // Slight spread
    const offsetX = Math.cos(angle) * radius;
    const offsetZ = Math.sin(angle) * radius;
    const bladeRotation = angle + Math.PI * 0.3; // Face outward slightly
    const heightVariation = 0.85 + (blade % 3) * 0.1; // Height varies per blade

    const vertexOffset = blade * verticesPerBlade;
    const indexOffset = blade * trianglesPerBlade * 3;

    // Generate vertices for this blade
    for (let i = 0; i <= segments; i++) {
      const t = i / segments; // 0 at base, 1 at tip
      const y = t * heightVariation; // Height with variation

      // Blade tapers toward tip
      const width = (1.0 - t * 0.7) * 0.8; // Slightly narrower blades

      // Apply rotation and offset
      const cosR = Math.cos(bladeRotation);
      const sinR = Math.sin(bladeRotation);

      // Left vertex
      const leftIdx = vertexOffset + i * 2;
      const leftX = -0.5 * width;
      positions[leftIdx * 3 + 0] = leftX * cosR + offsetX;
      positions[leftIdx * 3 + 1] = y;
      positions[leftIdx * 3 + 2] = leftX * sinR + offsetZ;

      uvs[leftIdx * 2 + 0] = blade / bladesPerTuft; // u = blade index for variation
      uvs[leftIdx * 2 + 1] = t; // v = height

      normals[leftIdx * 3 + 0] = -sinR;
      normals[leftIdx * 3 + 1] = 0;
      normals[leftIdx * 3 + 2] = cosR;

      // Right vertex
      const rightIdx = vertexOffset + i * 2 + 1;
      const rightX = 0.5 * width;
      positions[rightIdx * 3 + 0] = rightX * cosR + offsetX;
      positions[rightIdx * 3 + 1] = y;
      positions[rightIdx * 3 + 2] = rightX * sinR + offsetZ;

      uvs[rightIdx * 2 + 0] = blade / bladesPerTuft;
      uvs[rightIdx * 2 + 1] = t;

      normals[rightIdx * 3 + 0] = -sinR;
      normals[rightIdx * 3 + 1] = 0;
      normals[rightIdx * 3 + 2] = cosR;
    }

    // Generate indices for this blade
    let idx = indexOffset;
    for (let i = 0; i < segments; i++) {
      const base = vertexOffset + i * 2;
      // First triangle (lower-left)
      indices[idx++] = base;
      indices[idx++] = base + 2;
      indices[idx++] = base + 1;
      // Second triangle (upper-right)
      indices[idx++] = base + 1;
      indices[idx++] = base + 2;
      indices[idx++] = base + 3;
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Original single-blade geometry (kept for reference/fallback)
 */
function createSingleBladeGeometry(
  segments: number = GRASS_CONFIG.BLADE_SEGMENTS,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // Each segment has 2 vertices (left and right edge)
  const vertexCount = (segments + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 3);

  // Generate vertices from base to tip
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; // 0 at base, 1 at tip
    const y = t; // Height stored as 0-1, scaled by instance

    // Blade tapers toward tip
    const width = 1.0 - t * 0.7; // Full width at base, 30% at tip

    // Left vertex
    const leftIdx = i * 2;
    positions[leftIdx * 3 + 0] = -0.5 * width; // x
    positions[leftIdx * 3 + 1] = y; // y (normalized, scaled in shader)
    positions[leftIdx * 3 + 2] = 0; // z

    uvs[leftIdx * 2 + 0] = 0; // u
    uvs[leftIdx * 2 + 1] = t; // v

    normals[leftIdx * 3 + 0] = 0;
    normals[leftIdx * 3 + 1] = 0;
    normals[leftIdx * 3 + 2] = 1;

    // Right vertex
    const rightIdx = i * 2 + 1;
    positions[rightIdx * 3 + 0] = 0.5 * width; // x
    positions[rightIdx * 3 + 1] = y; // y
    positions[rightIdx * 3 + 2] = 0; // z

    uvs[rightIdx * 2 + 0] = 1; // u
    uvs[rightIdx * 2 + 1] = t; // v

    normals[rightIdx * 3 + 0] = 0;
    normals[rightIdx * 3 + 1] = 0;
    normals[rightIdx * 3 + 2] = 1;
  }

  // Generate triangle indices
  const triangleCount = segments * 2;
  const indices = new Uint16Array(triangleCount * 3);
  let idx = 0;

  for (let i = 0; i < segments; i++) {
    const base = i * 2;

    // First triangle: bottom-left, bottom-right, top-left
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;

    // Second triangle: bottom-right, top-right, top-left
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  return geometry;
}

// ============================================================================
// GRASS MATERIAL (WebGPU TSL)
// ============================================================================

/**
 * Creates the grass material with WebGPU TSL shaders.
 * Implements vertex-based wind animation, distance fade, and terrain color matching.
 *
 * Performance features:
 * - Distance-based LOD: fewer instances rendered at distance (50m: 1/2, 100m: 1/4, etc.)
 * - Terrain color matching: grass color samples from same noise as terrain
 */
function createGrassMaterial(): GrassMaterial {
  const material = new MeshStandardNodeMaterial();

  // Get noise texture from terrain shader for color matching
  const noiseTex = generateNoiseTexture();

  // ========== UNIFORMS ==========
  const uTime = uniform(0.0);
  const uWindStrength = uniform(1.0);
  const uWindDirection = uniform(new THREE.Vector3(1, 0, 0.3).normalize());
  const uPlayerPos = uniform(new THREE.Vector3(0, 0, 0));
  const uCameraPos = uniform(new THREE.Vector3(0, 0, 0));

  // ========== INSTANCE ATTRIBUTES ==========
  // These are set per-instance on the InstancedMesh
  // position.xyz = world position, w = height scale
  // variation.x = rotation, y = width scale, z = color variation, w = phase offset

  // ========== CONSTANTS ==========
  const fadeStartSq = float(GRASS_CONFIG.FADE_START * GRASS_CONFIG.FADE_START);
  const fadeEndSq = float(GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END);
  // Shoreline fade: grass fades between 14m (full) and 9m (none) to match terrain visual
  const shorelineFadeStart = float(GRASS_CONFIG.SHORELINE_FADE_START); // 14m - full grass
  const shorelineFadeEnd = float(GRASS_CONFIG.SHORELINE_FADE_END); // 9m - no grass
  const maxBend = float(GRASS_CONFIG.MAX_BEND);
  const flutterIntensity = float(GRASS_CONFIG.FLUTTER_INTENSITY);

  // LOD density thresholds (squared distances for performance)
  const lodHalfDensitySq = float(50 * 50); // 50m: 1/2 density
  const lodQuarterDensitySq = float(100 * 100); // 100m: 1/4 density
  const lodEighthDensitySq = float(150 * 150); // 150m: 1/8 density

  // Terrain colors (OSRS palette - same as TerrainShader)
  const terrainGrassGreen = vec3(0.3, 0.55, 0.15);
  const terrainGrassDark = vec3(0.22, 0.42, 0.1);
  const terrainDirtBrown = vec3(0.45, 0.32, 0.18);

  // Noise scale for terrain sampling (must match TerrainShader)
  const noiseScale = float(0.0008);

  // ========== VERTEX SHADER (Position Node) ==========
  material.positionNode = Fn(() => {
    const localPos = positionLocal;

    // Get instance attributes via instancedBufferAttribute
    // Instance data is packed as: vec4(worldX, worldY, worldZ, heightScale)
    // and vec4(rotation, widthScale, colorVar, phaseOffset)
    const instancePosition = attribute("instancePosition", "vec4");
    const instanceVariation = attribute("instanceVariation", "vec4");

    const worldX = instancePosition.x;
    const worldY = instancePosition.y;
    const worldZ = instancePosition.z;
    const heightScale = instancePosition.w;

    const rotation = instanceVariation.x;
    const widthScale = instanceVariation.y;
    const phaseOffset = instanceVariation.w;

    // Scale the blade
    const bladeHeight = mul(float(GRASS_CONFIG.BLADE_HEIGHT), heightScale);
    const bladeWidth = mul(float(GRASS_CONFIG.BLADE_WIDTH), widthScale);

    // Get normalized height along blade (0 = base, 1 = tip)
    const heightT = localPos.y;

    // ========== WIND ANIMATION ==========
    // Multi-layer wind: primary sway + gusts + tip flutter

    // World position for spatial variation
    const spatialPhase = add(mul(worldX, float(0.1)), mul(worldZ, float(0.13)));

    // Primary wind sway (slow, large movement)
    const primaryWave = sin(
      add(
        add(mul(uTime, float(GRASS_CONFIG.WIND_SPEED)), spatialPhase),
        phaseOffset,
      ),
    );

    // Secondary gust wave (slower, different frequency)
    const gustWave = sin(
      add(
        mul(uTime, float(GRASS_CONFIG.GUST_SPEED)),
        mul(spatialPhase, float(0.7)),
      ),
    );

    // Tip flutter (fast, small, random per blade)
    const flutterWave = sin(
      add(mul(uTime, float(2.0)), mul(phaseOffset, float(5.0))),
    );

    // Combine wind influences with height-based intensity
    // More bend at the top, none at the base
    const heightInfluence = mul(heightT, heightT); // Quadratic falloff
    const tipInfluence = mul(heightT, mul(heightT, heightT)); // Cubic for flutter

    const windBend = mul(
      mul(
        add(mul(primaryWave, float(0.7)), mul(gustWave, float(0.3))),
        heightInfluence,
      ),
      mul(uWindStrength, maxBend),
    );

    const flutter = mul(
      mul(flutterWave, tipInfluence),
      mul(flutterIntensity, uWindStrength),
    );

    // ========== APPLY TRANSFORMATIONS ==========
    // Scale local position
    const scaledX = mul(localPos.x, bladeWidth);
    const scaledY = mul(localPos.y, bladeHeight);

    // Apply rotation around Y axis (z starts at 0)
    const cosR = cos(rotation);
    const sinR = sin(rotation);
    const rotatedX = mul(scaledX, cosR); // simplified: z=0 so -sin*z term is 0
    const rotatedZ = mul(scaledX, sinR); // simplified: z=0 so cos*z term is 0

    // Apply wind bend (tilt toward wind direction)
    const windOffsetX = mul(mul(windBend, uWindDirection.x), bladeHeight);
    const windOffsetZ = mul(mul(windBend, uWindDirection.z), bladeHeight);

    // Apply flutter (perpendicular to wind)
    const flutterOffsetX = mul(flutter, mul(float(-1), uWindDirection.z));
    const flutterOffsetZ = mul(flutter, uWindDirection.x);

    // Combine all X transformations and translate to world position
    const finalX = add(worldX, add(rotatedX, add(windOffsetX, flutterOffsetX)));
    const finalY = add(worldY, scaledY);
    const finalZ = add(worldZ, add(rotatedZ, add(windOffsetZ, flutterOffsetZ)));

    return vec3(finalX, finalY, finalZ);
  })();

  // ========== COLOR NODE ==========
  // Sample terrain noise to match grass color to underlying ground
  // This ensures grass blends seamlessly with terrain
  material.colorNode = Fn(() => {
    // Get instance world position for terrain sampling
    const instancePosition = attribute("instancePosition", "vec4");
    const worldX = instancePosition.x;
    const worldZ = instancePosition.z;

    // UV.y is 0 at base, 1 at tip (from blade geometry)
    const heightT = uv().y;

    // Sample terrain noise at this world position (same as terrain shader)
    const noiseUV = mul(vec2(worldX, worldZ), noiseScale);
    const noiseValue = texture(noiseTex, noiseUV).r;

    // Secondary noise for variation (derived mathematically like terrain shader)
    const noiseValue2 = add(
      mul(sin(mul(noiseValue, float(6.28))), float(0.3)),
      float(0.5),
    );

    // Calculate grass color matching terrain shader logic
    // Base: grass with light/dark variation based on noise
    const grassVariation = smoothstep(float(0.4), float(0.6), noiseValue2);
    const baseGrassColor = mix(
      terrainGrassGreen,
      terrainGrassDark,
      grassVariation,
    );

    // Dirt patch influence (same threshold as terrain shader: 0.5)
    const dirtFactor = smoothstep(
      float(TERRAIN_CONSTANTS.DIRT_THRESHOLD - 0.05),
      float(TERRAIN_CONSTANTS.DIRT_THRESHOLD + 0.15),
      noiseValue,
    );
    // Blend grass toward dirt color in dirty areas (but stay more green than terrain)
    // Grass is naturally greener than dirt, so we only partially adopt dirt color
    const groundColor = mix(
      baseGrassColor,
      terrainDirtBrown,
      mul(dirtFactor, float(0.3)),
    );

    // Per-instance variation using golden ratio hash
    const instanceVar = fract(mul(float(instanceIndex), float(0.61803398875)));

    // Height gradient: darker at base, lighter at tip (catches light)
    const tipBrightness = mul(heightT, float(0.15)); // +15% brightness at tip
    const colorWithTip = add(
      groundColor,
      vec3(tipBrightness, tipBrightness, tipBrightness),
    );

    // Add subtle instance variation for natural variety
    const variationAmount = mul(sub(instanceVar, float(0.5)), float(0.1)); // ±5%
    const finalColor = add(
      colorWithTip,
      vec3(variationAmount, variationAmount, variationAmount),
    );

    return finalColor;
  })();

  // ========== OPACITY NODE (BASE FADE + DISTANCE FADE + LOD DENSITY) ==========
  // Performance optimization: reduce density at distance
  // - Near: full density
  // - 50m: 1/2 density (every other instance culled)
  // - 100m: 1/4 density
  // - 150m: 1/8 density
  material.opacityNode = Fn(() => {
    const worldPos = positionWorld;

    // UV.y is 0 at base, 1 at tip (from blade geometry)
    const heightT = uv().y;

    // Distance to player (horizontal only)
    const toPlayer = sub(worldPos, uPlayerPos);
    const distSq = add(
      mul(toPlayer.x, toPlayer.x),
      mul(toPlayer.z, toPlayer.z),
    );

    // ========== DISTANCE-BASED LOD DENSITY CULLING ==========
    // Use instance index hash to deterministically cull instances at distance
    // Golden ratio hash gives good distribution
    const instanceHash = fract(mul(float(instanceIndex), float(0.61803398875)));

    // Determine LOD level based on distance
    // Level 0 (< 50m): show all instances (hash < 1.0)
    // Level 1 (50-100m): show 1/2 instances (hash < 0.5)
    // Level 2 (100-150m): show 1/4 instances (hash < 0.25)
    // Level 3 (150m+): show 1/8 instances (hash < 0.125)

    // Calculate threshold based on distance
    // At distance 0: threshold = 1.0 (all visible)
    // At distance 50m: threshold = 0.5
    // At distance 100m: threshold = 0.25
    // At distance 150m+: threshold = 0.125
    const distanceLevel = smoothstep(float(0), lodEighthDensitySq, distSq);
    // Exponential decay: 1.0 -> 0.5 -> 0.25 -> 0.125
    // threshold = 1.0 * 0.5^(distanceLevel * 3)
    // Since we can't do pow easily, use mix between thresholds
    const threshold1 = mix(
      float(1.0),
      float(0.5),
      smoothstep(float(0), lodHalfDensitySq, distSq),
    );
    const threshold2 = mix(
      threshold1,
      float(0.25),
      smoothstep(lodHalfDensitySq, lodQuarterDensitySq, distSq),
    );
    const lodThreshold = mix(
      threshold2,
      float(0.125),
      smoothstep(lodQuarterDensitySq, lodEighthDensitySq, distSq),
    );

    // Cull instance if hash >= threshold (returns 0 if culled, 1 if visible)
    const lodVisible = step(instanceHash, lodThreshold);

    // ========== BASE TRANSPARENCY ==========
    // Grass is more transparent at the base for soft blending with ground
    const baseFade = smoothstep(float(0.0), float(0.25), heightT);
    const baseOpacity = add(float(0.4), mul(baseFade, float(0.6)));

    // ========== DISTANCE FADE ==========
    // Smooth fade based on distance (1.0 = fully visible, 0.0 = invisible)
    const distanceFade = sub(
      float(1.0),
      smoothstep(fadeStartSq, fadeEndSq, distSq),
    );

    // ========== SHORELINE FADE ==========
    // Smooth fade near water: 1.0 above 14m, fades to 0.0 at 9m (matches terrain visual)
    // smoothstep(9, 14, height) gives 0 at 9m, 1 at 14m
    const shorelineFade = smoothstep(
      shorelineFadeEnd,
      shorelineFadeStart,
      worldPos.y,
    );

    // Combine all factors: base fade, distance fade, shoreline fade, and LOD culling
    const opacity = mul(
      mul(mul(baseOpacity, distanceFade), shorelineFade),
      lodVisible,
    );

    return opacity;
  })();

  // ========== MATERIAL SETTINGS ==========
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.alphaTest = 0.01; // Small threshold to cull fully transparent
  material.depthWrite = true;
  material.roughness = 0.9;
  material.metalness = 0.0;
  material.blending = THREE.NormalBlending;

  // Attach uniforms for external updates
  const grassMat = material as GrassMaterial;
  grassMat.grassUniforms = {
    time: uTime,
    windStrength: uWindStrength,
    windDirection: uWindDirection,
    playerPos: uPlayerPos,
    cameraPos: uCameraPos,
  };

  return grassMat;
}

// ============================================================================
// GRASS SYSTEM
// ============================================================================

/**
 * GrassSystem - High-performance procedural grass rendering
 *
 * Manages grass chunk lifecycle, generation, and rendering.
 * Integrates with TerrainSystem for tile-based loading.
 */
export class GrassSystem extends System {
  // Shared resources
  private bladeGeometry: THREE.BufferGeometry | null = null;
  private grassMaterial: GrassMaterial | null = null;
  private grassContainer: THREE.Group | null = null;

  // Chunk management
  private chunks = new Map<string, GrassChunk>();
  private chunkPool: GrassChunk[] = [];

  // Noise for placement
  private noise: NoiseGenerator | null = null;

  // State
  private playerPosition = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private frustumMatrix = new THREE.Matrix4();

  // Performance
  private lastUpdateTime = 0;
  private updateInterval = 100; // ms between visibility updates

  // Wind reference
  private windSystem: Wind | null = null;

  // Terrain system reference for height and flat zone queries
  private terrainSystem: {
    getHeightAt: (x: number, z: number) => number;
    isInFlatZone?: (x: number, z: number) => boolean;
    getTerrainColorAt?: (
      x: number,
      z: number,
    ) => { r: number; g: number; b: number } | null;
  } | null = null;
  private terrainWarningLogged = false;

  // Worker optimization state
  private worldSeed = 0;
  private pendingChunkGeneration = new Set<string>();

  // Building collision service reference for excluding grass inside buildings
  private buildingCollisionService: {
    queryCollision: (
      tileX: number,
      tileZ: number,
      floorIndex: number,
    ) => { isInsideBuilding: boolean };
  } | null = null;

  // Road network system reference for excluding grass on roads
  private roadNetworkSystem: {
    isOnRoad: (x: number, z: number) => boolean;
  } | null = null;

  // Biome grass configs (loaded from terrain system)
  private biomeGrassConfigs = new Map<string, BiomeGrassConfig>();

  // GPU compute culling state
  private gpuCullingEnabled = false;
  private gpuCullingInitialized = false;

  constructor(world: World) {
    super(world);
  }

  start(): void {
    // Only run on client
    if (!this.world.network?.isClient) {
      console.log("[GrassSystem] Skipping - server-side");
      return;
    }

    // Initialize shared geometry
    this.bladeGeometry = createGrassBladeGeometry();

    // Initialize material
    this.grassMaterial = createGrassMaterial();

    // Create container group
    this.grassContainer = new THREE.Group();
    this.grassContainer.name = "GrassContainer";
    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (stage?.scene) {
      stage.scene.add(this.grassContainer);
    }

    // Initialize noise from world seed and cache for worker
    this.worldSeed = this.getWorldSeed();
    this.noise = new NoiseGenerator(this.worldSeed);

    // Log worker availability for grass generation
    console.log(
      `[GrassSystem] Started - Worker available: ${isGrassWorkerAvailable()}`,
    );

    // Get wind system reference
    this.windSystem =
      (this.world.getSystem("wind") as Wind | undefined) ?? null;

    // Get terrain system reference for height and flat zone queries
    const terrain = this.world.getSystem("terrain");
    if (terrain && "getHeightAt" in terrain) {
      this.terrainSystem = terrain as {
        getHeightAt: (x: number, z: number) => number;
        isInFlatZone?: (x: number, z: number) => boolean;
        getTerrainColorAt?: (
          x: number,
          z: number,
        ) => { r: number; g: number; b: number } | null;
      };
    } else {
      console.warn(
        "[GrassSystem] TerrainSystem not available or missing getHeightAt - grass will be placed at y=0",
      );
    }

    // Get building collision service (via TownSystem) for excluding grass inside buildings
    // Note: This is acquired lazily in generateChunk since TownSystem may not be ready yet
    this.tryAcquireBuildingCollisionService();

    // Initialize default biome configs
    for (const [biome, config] of Object.entries(BIOME_GRASS_DEFAULTS)) {
      this.biomeGrassConfigs.set(biome, config);
    }

    // Listen for terrain tile events
    this.world.on(
      EventType.TERRAIN_TILE_GENERATED,
      this.onTerrainTileGenerated.bind(this),
    );
    this.world.on(
      EventType.TERRAIN_TILE_UNLOADED,
      this.onTerrainTileUnloaded.bind(this),
    );
    this.world.on(
      EventType.TERRAIN_TILE_REGENERATED,
      this.onTerrainTileRegenerated.bind(this),
    );

    // Initialize GPU compute culling if available
    this.initializeGPUCulling();

    console.log(
      `[GrassSystem] Initialized with seed ${this.worldSeed}, chunk size ${GRASS_CONFIG.CHUNK_SIZE}m, terrain=${this.terrainSystem ? "available" : "unavailable"}, gpuCulling=${this.gpuCullingEnabled}`,
    );

    // Generate grass for already-loaded terrain tiles (handles case where terrain
    // loads before GrassSystem subscribes to events)
    this.generateGrassForExistingTiles();
  }

  /**
   * Initialize GPU compute culling if WebGPU is available.
   * Falls back to CPU culling if unavailable.
   */
  private initializeGPUCulling(): void {
    if (this.gpuCullingInitialized) return;
    this.gpuCullingInitialized = true;

    if (!isGPUComputeAvailable()) {
      this.gpuCullingEnabled = false;
      return;
    }

    const gpuCompute = getGPUComputeManager();
    if (!gpuCompute.grass?.isReady()) {
      this.gpuCullingEnabled = false;
      return;
    }

    this.gpuCullingEnabled = true;
    console.log("[GrassSystem] GPU compute culling enabled");
  }

  /**
   * Generate grass for terrain tiles that were already loaded before GrassSystem started.
   * This handles timing issues where terrain events fire before we subscribe.
   * Uses a delayed retry to handle cases where terrain isn't fully ready.
   */
  private generateGrassForExistingTiles(): void {
    this.processExistingTiles();

    // Delayed retry - terrain might not be fully ready immediately
    // This catches cases where tiles exist but terrain height queries aren't ready
    setTimeout(() => {
      this.processExistingTiles();
    }, 500);

    // Second retry for slow connections or complex terrain
    setTimeout(() => {
      this.processExistingTiles();
    }, 2000);
  }

  /**
   * Process existing tiles and generate grass for them.
   * Only generates grass for tiles that don't already have grass chunks.
   */
  private processExistingTiles(): void {
    const terrain = this.world.getSystem("terrain") as {
      getLoadedTiles?: () => Array<{
        tileX: number;
        tileZ: number;
        biome: string;
      }>;
    } | null;

    if (!terrain?.getLoadedTiles) {
      console.log(
        "[GrassSystem] Cannot query existing tiles - terrain system not available",
      );
      return;
    }

    const loadedTiles = terrain.getLoadedTiles();
    let tilesProcessed = 0;
    let tilesSkipped = 0;

    for (const tile of loadedTiles) {
      const position = {
        x: tile.tileX * GRASS_CONFIG.TILE_SIZE,
        z: tile.tileZ * GRASS_CONFIG.TILE_SIZE,
      };

      // Check if we already have grass for this tile's chunks
      const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
      const chunksPerTile = Math.ceil(GRASS_CONFIG.TILE_SIZE / chunkSize);
      let hasAllChunks = true;

      for (let cx = 0; cx < chunksPerTile && hasAllChunks; cx++) {
        for (let cz = 0; cz < chunksPerTile && hasAllChunks; cz++) {
          const chunkX = Math.floor((position.x + cx * chunkSize) / chunkSize);
          const chunkZ = Math.floor((position.z + cz * chunkSize) / chunkSize);
          const key = `${chunkX}_${chunkZ}`;
          if (!this.chunks.has(key) && !this.pendingChunkGeneration.has(key)) {
            hasAllChunks = false;
          }
        }
      }

      if (hasAllChunks) {
        tilesSkipped++;
        continue;
      }

      // Check if biome supports grass
      const grassConfig =
        this.biomeGrassConfigs.get(tile.biome) ?? BIOME_GRASS_DEFAULTS.plains;
      if (!grassConfig.enabled || grassConfig.densityMultiplier <= 0) {
        continue;
      }

      tilesProcessed++;

      // Generate grass chunks for this tile (async, fire-and-forget)
      this.generateGrassForTile(
        position.x,
        position.z,
        GRASS_CONFIG.TILE_SIZE,
        grassConfig,
      ).catch((err) => {
        console.error(
          `[GrassSystem] Error generating grass for tile (${tile.tileX},${tile.tileZ}):`,
          err,
        );
      });
    }

    if (tilesProcessed > 0) {
      console.log(
        `[GrassSystem] processExistingTiles: processed ${tilesProcessed} tiles, skipped ${tilesSkipped} (already have grass)`,
      );
    }
  }

  /**
   * Get world seed for deterministic generation
   */
  private getWorldSeed(): number {
    // Try to get seed from world id
    const worldOptions = this.world as unknown as { options?: { id?: string } };
    const worldId = worldOptions.options?.id || "default";
    let hash = 0;
    for (let i = 0; i < worldId.length; i++) {
      const char = worldId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Try to acquire building collision service from TownSystem.
   * Called lazily since TownSystem may not be initialized when GrassSystem starts.
   */
  private tryAcquireBuildingCollisionService(): void {
    if (this.buildingCollisionService) return;

    const townSystem = this.world.getSystem("towns") as {
      getCollisionService?: () => {
        queryCollision: (
          tileX: number,
          tileZ: number,
          floorIndex: number,
        ) => { isInsideBuilding: boolean };
      };
    } | null;

    if (townSystem?.getCollisionService) {
      this.buildingCollisionService = townSystem.getCollisionService();
    }
  }

  /**
   * Check if a world position is inside a building.
   * Returns true if grass should NOT grow at this position.
   */
  private isInsideBuilding(worldX: number, worldZ: number): boolean {
    // Try to acquire collision service if not already acquired
    if (!this.buildingCollisionService) {
      this.tryAcquireBuildingCollisionService();
    }

    if (!this.buildingCollisionService) {
      return false; // No collision service, allow grass
    }

    try {
      // Convert world position to tile coordinates
      const tileX = Math.floor(worldX);
      const tileZ = Math.floor(worldZ);

      // Query building collision at ground floor
      const result = this.buildingCollisionService.queryCollision(
        tileX,
        tileZ,
        0,
      );
      return result?.isInsideBuilding ?? false;
    } catch {
      // If query fails, allow grass (don't block on collision errors)
      return false;
    }
  }

  /**
   * Try to acquire road network system reference.
   * Called lazily since RoadNetworkSystem may not be initialized when GrassSystem starts.
   */
  private tryAcquireRoadNetworkSystem(): void {
    if (this.roadNetworkSystem) return;

    const roadSystem = this.world.getSystem("roads") as {
      isOnRoad?: (x: number, z: number) => boolean;
    } | null;

    if (roadSystem?.isOnRoad) {
      this.roadNetworkSystem = roadSystem as {
        isOnRoad: (x: number, z: number) => boolean;
      };
    }
  }

  /**
   * Check if a world position is in a flat zone (building pad, arena, etc.).
   * Returns true if grass should NOT grow at this position.
   */
  private isInFlatZone(worldX: number, worldZ: number): boolean {
    if (!this.terrainSystem?.isInFlatZone) {
      return false; // No flat zone detection available
    }

    try {
      return this.terrainSystem.isInFlatZone(worldX, worldZ);
    } catch {
      return false;
    }
  }

  /**
   * Get grass density factor based on terrain color at position.
   * Returns 0.0 for dirt/brown areas, 1.0 for grass areas, with smooth transition.
   *
   * Uses terrain vertex color to detect:
   * - Grass: Green channel > Red channel (greenish)
   * - Dirt: Red channel > Green channel (brownish)
   */
  private getTerrainGrassFactor(worldX: number, worldZ: number): number {
    if (!this.terrainSystem?.getTerrainColorAt) {
      return 1.0; // No color sampling available, assume grass
    }

    try {
      const color = this.terrainSystem.getTerrainColorAt(worldX, worldZ);
      if (!color) {
        return 1.0; // No color data, assume grass
      }

      // Calculate "grassiness" based on color
      // Grass colors: green > red (e.g., 0.55 > 0.3)
      // Dirt colors: red > green (e.g., 0.45 > 0.32)
      const { r, g, b } = color;

      // Skip very dark areas (shadows, deep water)
      const brightness = r + g + b;
      if (brightness < 0.3) {
        return 0.0; // Too dark, no grass
      }

      // Calculate green-to-red ratio
      // High ratio = grassy, Low ratio = dirt/brown
      const greenRatio = g / Math.max(r, 0.01);

      // Thresholds based on terrain colors:
      // - grassGreen: g/r = 0.55/0.3 = 1.83
      // - grassDark: g/r = 0.42/0.22 = 1.9
      // - dirtBrown: g/r = 0.32/0.45 = 0.71
      // - dirtDark: g/r = 0.22/0.32 = 0.69
      // - sandYellow: g/r = 0.6/0.7 = 0.86

      // Use smoothstep for gradual transition
      // Below 0.9: dirt (0%), Above 1.2: grass (100%), between: fade
      const grassFactor = Math.min(
        1.0,
        Math.max(0.0, (greenRatio - 0.9) / 0.3),
      );

      // Also check absolute green level (low green = not grass)
      const greenLevel = Math.min(1.0, g / 0.35); // 0.35 is midpoint between grass and dirt green

      return grassFactor * greenLevel;
    } catch {
      return 1.0; // On error, assume grass
    }
  }

  /**
   * Check if a world position is on a road.
   * Returns true if grass should NOT grow at this position.
   */
  private isOnRoad(worldX: number, worldZ: number): boolean {
    // Try to acquire road system if not already acquired
    if (!this.roadNetworkSystem) {
      this.tryAcquireRoadNetworkSystem();
    }

    if (!this.roadNetworkSystem) {
      return false; // No road system, allow grass
    }

    try {
      return this.roadNetworkSystem.isOnRoad(worldX, worldZ);
    } catch {
      // If query fails, allow grass (don't block on road errors)
      return false;
    }
  }

  /**
   * Simple hash function for deterministic chunk seeds
   */
  private hashPosition(x: number, z: number): number {
    // Simple but effective hash combining two coordinates
    const h1 = Math.imul(Math.floor(x * 100) ^ 0x85ebca6b, 0x85ebca6b);
    const h2 = Math.imul(Math.floor(z * 100) ^ 0xc2b2ae35, 0xc2b2ae35);
    return Math.abs((h1 ^ h2) | 0);
  }

  /**
   * Handle terrain tile generation - create grass for this tile
   */
  private onTerrainTileGenerated(event: {
    tileId: string;
    position: { x: number; z: number };
    tileX: number;
    tileZ: number;
    biome: string;
  }): void {
    const { position, biome, tileX, tileZ } = event;

    // Check if biome supports grass
    const grassConfig =
      this.biomeGrassConfigs.get(biome) ?? BIOME_GRASS_DEFAULTS.plains;
    if (!grassConfig.enabled || grassConfig.densityMultiplier <= 0) {
      return;
    }

    // Log for debugging tile loading issues
    console.log(
      `[GrassSystem] Tile event: (${tileX},${tileZ}) biome=${biome} pos=(${position.x},${position.z})`,
    );

    // Generate grass chunks for this tile (async, fire-and-forget)
    this.generateGrassForTile(
      position.x,
      position.z,
      GRASS_CONFIG.TILE_SIZE,
      grassConfig,
    ).catch((err) => {
      console.error(
        `[GrassSystem] Error generating grass for tile (${tileX},${tileZ}):`,
        err,
      );
    });
  }

  /**
   * Handle terrain tile unload - remove grass chunks
   */
  private onTerrainTileUnloaded(event: {
    tileId: string;
    tileX: number;
    tileZ: number;
  }): void {
    const { tileX, tileZ } = event;
    const tileSize = GRASS_CONFIG.TILE_SIZE;
    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;

    // Calculate which chunks belong to this tile
    const chunksPerTile = Math.ceil(tileSize / chunkSize);
    const tileOriginX = tileX * tileSize;
    const tileOriginZ = tileZ * tileSize;

    for (let cx = 0; cx < chunksPerTile; cx++) {
      for (let cz = 0; cz < chunksPerTile; cz++) {
        const chunkX = Math.floor((tileOriginX + cx * chunkSize) / chunkSize);
        const chunkZ = Math.floor((tileOriginZ + cz * chunkSize) / chunkSize);
        const key = `${chunkX}_${chunkZ}`;
        this.removeChunk(key);
      }
    }
  }

  /**
   * Handle terrain tile regeneration - update grass heights
   * Called when flat zones are registered (e.g., buildings flatten terrain)
   */
  private onTerrainTileRegenerated(event: {
    tileId: string;
    tileX: number;
    tileZ: number;
    biome: string;
    reason: string;
  }): void {
    const { tileX, tileZ, biome } = event;

    // First remove existing grass chunks for this tile
    const tileSize = GRASS_CONFIG.TILE_SIZE;
    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
    const chunksPerTile = Math.ceil(tileSize / chunkSize);
    const tileOriginX = tileX * tileSize;
    const tileOriginZ = tileZ * tileSize;

    for (let cx = 0; cx < chunksPerTile; cx++) {
      for (let cz = 0; cz < chunksPerTile; cz++) {
        const chunkX = Math.floor((tileOriginX + cx * chunkSize) / chunkSize);
        const chunkZ = Math.floor((tileOriginZ + cz * chunkSize) / chunkSize);
        const key = `${chunkX}_${chunkZ}`;
        this.removeChunk(key);
      }
    }

    // Now regenerate with updated terrain heights (async, fire-and-forget)
    const grassConfig =
      this.biomeGrassConfigs.get(biome) ?? BIOME_GRASS_DEFAULTS.plains;
    if (grassConfig.enabled && grassConfig.densityMultiplier > 0) {
      this.generateGrassForTile(
        tileOriginX,
        tileOriginZ,
        tileSize,
        grassConfig,
      ).catch((err) => {
        console.error(`[GrassSystem] Error regenerating grass for tile:`, err);
      });
    }
  }

  /**
   * Generate grass for a terrain tile area
   * Uses worker for placement computation when available, falls back to yielding sync generation
   */
  private async generateGrassForTile(
    originX: number,
    originZ: number,
    tileSize: number,
    grassConfig: BiomeGrassConfig,
  ): Promise<void> {
    if (!this.noise || !this.bladeGeometry || !this.grassMaterial) {
      console.warn(
        `[GrassSystem] Cannot generate grass at (${originX}, ${originZ}) - system not fully initialized: ` +
          `noise=${!!this.noise}, geometry=${!!this.bladeGeometry}, material=${!!this.grassMaterial}`,
      );
      return;
    }

    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
    const chunksPerTile = Math.ceil(tileSize / chunkSize);
    const baseDensity =
      GRASS_CONFIG.BASE_DENSITY * grassConfig.densityMultiplier;
    const heightMultiplier = grassConfig.heightMultiplier ?? 1.0;

    // Collect chunks that need generation
    const chunksToGenerate: Array<{
      key: string;
      originX: number;
      originZ: number;
    }> = [];

    for (let cx = 0; cx < chunksPerTile; cx++) {
      for (let cz = 0; cz < chunksPerTile; cz++) {
        const chunkOriginX = originX + cx * chunkSize;
        const chunkOriginZ = originZ + cz * chunkSize;
        const chunkX = Math.floor(chunkOriginX / chunkSize);
        const chunkZ = Math.floor(chunkOriginZ / chunkSize);
        const key = `${chunkX}_${chunkZ}`;

        // Skip if chunk already exists or is being generated
        if (this.chunks.has(key) || this.pendingChunkGeneration.has(key))
          continue;

        chunksToGenerate.push({
          key,
          originX: chunkOriginX,
          originZ: chunkOriginZ,
        });
        this.pendingChunkGeneration.add(key);
      }
    }

    if (chunksToGenerate.length === 0) return;

    // Try to use worker for placement generation
    if (isGrassWorkerAvailable()) {
      // Generate all chunks in parallel using workers
      const workerPromises = chunksToGenerate.map(async (chunk) => {
        try {
          const result = await generateGrassPlacementsAsync(
            chunk.key,
            chunk.originX,
            chunk.originZ,
            chunkSize,
            baseDensity,
            this.worldSeed,
            heightMultiplier,
            GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
          );
          if (result && result.placements.length > 0) {
            // Process worker placements on main thread (height, collision, etc.)
            await this.processWorkerPlacements(
              chunk.key,
              chunk.originX,
              chunk.originZ,
              chunkSize,
              result.placements,
              grassConfig,
            );
          }
        } catch (err) {
          console.warn(
            `[GrassSystem] Worker failed for chunk ${chunk.key}, falling back to sync`,
            err,
          );
          // Fallback to synchronous generation with yielding
          await this.generateChunkWithYielding(
            chunk.key,
            chunk.originX,
            chunk.originZ,
            chunkSize,
            grassConfig,
          );
        } finally {
          this.pendingChunkGeneration.delete(chunk.key);
        }
      });
      await Promise.all(workerPromises);
    } else {
      // No workers available - use synchronous generation with yielding
      for (const chunk of chunksToGenerate) {
        await this.generateChunkWithYielding(
          chunk.key,
          chunk.originX,
          chunk.originZ,
          chunkSize,
          grassConfig,
        );
        this.pendingChunkGeneration.delete(chunk.key);
      }
    }
  }

  /**
   * Process placements from worker - validates each placement on main thread
   * (height lookup, building collision, slope, grassiness)
   */
  private async processWorkerPlacements(
    key: string,
    originX: number,
    originZ: number,
    size: number,
    placements: GrassPlacementData[],
    grassConfig: BiomeGrassConfig,
  ): Promise<void> {
    if (!this.bladeGeometry || !this.grassMaterial) return;

    // Get terrain height function
    const getHeight = (x: number, z: number): number => {
      if (this.terrainSystem) {
        return this.terrainSystem.getHeightAt(x, z);
      }
      return 0;
    };

    // Get or create chunk - ALWAYS use MAX_INSTANCES_PER_CHUNK for buffer allocation
    // to ensure pooled chunks can be reused for any instance count
    const instanceCount = Math.min(
      placements.length,
      GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
    );
    let chunk = this.chunkPool.pop();
    if (!chunk) {
      // Create with MAX capacity so it can be reused for any chunk
      chunk = this.createChunk(
        key,
        originX,
        originZ,
        GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
      );
    } else {
      chunk.key = key;
      chunk.originX = originX;
      chunk.originZ = originZ;
      chunk.count = 0;
    }

    const positionArray = chunk.mesh.geometry.getAttribute(
      "instancePosition",
    ) as THREE.InstancedBufferAttribute;
    const variationArray = chunk.mesh.geometry.getAttribute(
      "instanceVariation",
    ) as THREE.InstancedBufferAttribute;

    let count = 0;
    const YIELD_BATCH_SIZE = 500; // Yield every 500 placements to prevent blocking

    for (let i = 0; i < placements.length && count < instanceCount; i++) {
      // Yield periodically to prevent blocking
      if (i > 0 && i % YIELD_BATCH_SIZE === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      const placement = placements[i];
      const worldX = placement.x;
      const worldZ = placement.z;

      // Get terrain height (main thread only)
      const worldY = getHeight(worldX, worldZ);

      // Skip grass in excluded areas: buildings, roads, flat zones (arenas, pads)
      if (
        this.isInsideBuilding(worldX, worldZ) ||
        this.isOnRoad(worldX, worldZ) ||
        this.isInFlatZone(worldX, worldZ)
      ) {
        continue;
      }

      // Skip grass below shoreline cutoff (9m = mud zone, no grass)
      if (worldY < GRASS_CONFIG.SHORELINE_FADE_END) {
        continue;
      }

      // Check terrain color - skip grass on dirt/brown areas
      const terrainGrassFactor = this.getTerrainGrassFactor(worldX, worldZ);
      if (terrainGrassFactor < 0.1) {
        continue; // Pure dirt area, no grass
      }

      // Use terrain factor for density thinning at edges
      // On transitions (factor 0.1-1.0), probabilistically skip grass for natural fade
      if (terrainGrassFactor < 1.0) {
        // Use placement position as deterministic random seed
        const hash = Math.abs(
          Math.sin(worldX * 12.9898 + worldZ * 78.233) * 43758.5453,
        );
        const rand = hash - Math.floor(hash);
        if (rand > terrainGrassFactor) {
          continue; // Skip this grass blade based on terrain grass factor
        }
      }

      // Apply shoreline height reduction (grass gets shorter near water)
      // At 14m+: full height. At 9m: 30% height. Shader handles opacity fade.
      const shorelineFactor = Math.min(
        1.0,
        Math.max(
          0.3,
          (worldY - GRASS_CONFIG.SHORELINE_FADE_END) /
            (GRASS_CONFIG.SHORELINE_FADE_START -
              GRASS_CONFIG.SHORELINE_FADE_END),
        ),
      );

      // Combine factors: shoreline affects height, terrain factor also reduces height at edges
      const heightMultiplier =
        shorelineFactor * (0.5 + 0.5 * terrainGrassFactor);

      // Set instance attributes
      positionArray.setXYZW(
        count,
        worldX,
        worldY,
        worldZ,
        placement.heightScale * heightMultiplier,
      );
      variationArray.setXYZW(
        count,
        placement.rotation,
        placement.widthScale,
        placement.colorVar,
        placement.phaseOffset,
      );
      count++;
    }

    // Update instance count
    chunk.count = count;
    chunk.mesh.count = count;

    // Update bounding sphere
    chunk.boundingSphere.center.set(
      originX + size / 2,
      getHeight(originX + size / 2, originZ + size / 2) +
        GRASS_CONFIG.BLADE_HEIGHT / 2,
      originZ + size / 2,
    );
    chunk.boundingSphere.radius =
      (Math.sqrt(2) * size) / 2 + GRASS_CONFIG.BLADE_HEIGHT;

    // Mark attributes for update
    positionArray.needsUpdate = true;
    variationArray.needsUpdate = true;

    // Add to scene and tracking (only if we have instances)
    if (this.grassContainer && count > 0) {
      this.grassContainer.add(chunk.mesh);
      chunk.visible = true;
      this.chunks.set(key, chunk);
    } else {
      // No valid grass placements - return chunk to pool for reuse
      // Don't track empty chunks so they can be retried later if conditions change
      this.chunkPool.push(chunk);
    }
  }

  /**
   * Generate chunk synchronously with yielding (fallback when workers unavailable)
   * Yields every N iterations to prevent blocking the main thread
   */
  private async generateChunkWithYielding(
    key: string,
    originX: number,
    originZ: number,
    size: number,
    grassConfig: BiomeGrassConfig,
  ): Promise<void> {
    if (!this.noise || !this.bladeGeometry || !this.grassMaterial) {
      return;
    }

    // Calculate density
    const baseDensity =
      GRASS_CONFIG.BASE_DENSITY * grassConfig.densityMultiplier;
    const instanceCount = Math.min(
      Math.floor(size * size * baseDensity),
      GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
    );

    if (instanceCount === 0) return;

    // Get or create chunk from pool - ALWAYS use MAX_INSTANCES_PER_CHUNK for buffer allocation
    // to ensure pooled chunks can be reused for any instance count
    let chunk = this.chunkPool.pop();
    if (!chunk) {
      // Create with MAX capacity so it can be reused for any chunk
      chunk = this.createChunk(
        key,
        originX,
        originZ,
        GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
      );
    } else {
      chunk.key = key;
      chunk.originX = originX;
      chunk.originZ = originZ;
      chunk.count = 0;
    }

    // Get terrain height function
    const getHeight = (x: number, z: number): number => {
      if (this.terrainSystem) {
        return this.terrainSystem.getHeightAt(x, z);
      }
      return 0;
    };

    const positionArray = chunk.mesh.geometry.getAttribute(
      "instancePosition",
    ) as THREE.InstancedBufferAttribute;
    const variationArray = chunk.mesh.geometry.getAttribute(
      "instanceVariation",
    ) as THREE.InstancedBufferAttribute;

    // Deterministic RNG for this chunk - MUST match GrassWorker's seed formula
    const chunkSeed = this.hashPosition(originX, originZ) ^ this.worldSeed;
    let rngState = chunkSeed;
    const nextRandom = (): number => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };

    // Simple noise function for density variation (matches GrassWorker)
    const noise2D = (nx: number, nz: number, noiseSeed: number): number => {
      const ix = Math.floor(nx);
      const iz = Math.floor(nz);
      const fx = nx - ix;
      const fz = nz - iz;
      const sx = fx * fx * (3 - 2 * fx);
      const sz = fz * fz * (3 - 2 * fz);
      const hash = (a: number, b: number): number => {
        let h = a * 374761393 + b * 668265263 + noiseSeed;
        h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
        return (h & 0xffffff) / 0xffffff;
      };
      const h00 = hash(ix, iz);
      const h10 = hash(ix + 1, iz);
      const h01 = hash(ix, iz + 1);
      const h11 = hash(ix + 1, iz + 1);
      const v0 = h00 + sx * (h10 - h00);
      const v1 = h01 + sx * (h11 - h01);
      return v0 + sz * (v1 - v0);
    };

    let count = 0;
    let iterations = 0;
    const YIELD_INTERVAL = 200; // Yield every 200 iterations
    const spacing = Math.sqrt(1 / baseDensity);
    const biomeHeightMult = grassConfig.heightMultiplier ?? 1.0;

    // Grid-jittered placement with yielding (matches GrassWorker algorithm)
    for (let gx = 0; gx < size && count < instanceCount; gx += spacing) {
      for (let gz = 0; gz < size && count < instanceCount; gz += spacing) {
        iterations++;

        // Yield periodically to prevent blocking
        if (iterations % YIELD_INTERVAL === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        // Jitter position within grid cell
        const jitterX = (nextRandom() - 0.5) * spacing * 0.8;
        const jitterZ = (nextRandom() - 0.5) * spacing * 0.8;

        const worldX = originX + gx + jitterX;
        const worldZ = originZ + gz + jitterZ;

        // Get terrain height
        const worldY = getHeight(worldX, worldZ);

        // Skip grass in excluded areas: buildings, roads, flat zones (arenas, pads)
        if (
          this.isInsideBuilding(worldX, worldZ) ||
          this.isOnRoad(worldX, worldZ) ||
          this.isInFlatZone(worldX, worldZ)
        ) {
          continue;
        }

        // Skip grass below shoreline cutoff (9m = mud zone, no grass)
        if (worldY < GRASS_CONFIG.SHORELINE_FADE_END) {
          continue;
        }

        // Check terrain color - skip grass on dirt/brown areas
        const terrainGrassFactor = this.getTerrainGrassFactor(worldX, worldZ);
        if (terrainGrassFactor < 0.1) {
          continue; // Pure dirt area, no grass
        }

        // Use terrain factor for density thinning at edges
        if (terrainGrassFactor < 1.0 && nextRandom() > terrainGrassFactor) {
          continue; // Skip this grass blade based on terrain grass factor
        }

        // Apply shoreline height reduction (grass gets shorter near water)
        const shorelineFactor = Math.min(
          1.0,
          Math.max(
            0.3,
            (worldY - GRASS_CONFIG.SHORELINE_FADE_END) /
              (GRASS_CONFIG.SHORELINE_FADE_START -
                GRASS_CONFIG.SHORELINE_FADE_END),
          ),
        );

        // Combine factors: shoreline affects height, terrain factor also reduces height at edges
        const heightMultiplier =
          shorelineFactor * (0.5 + 0.5 * terrainGrassFactor);
        const heightScale =
          (0.7 + nextRandom() * 0.6) * biomeHeightMult * heightMultiplier;
        const rotation = nextRandom() * Math.PI * 2;
        const widthScale = 0.8 + nextRandom() * 0.4;
        const colorVar = nextRandom();
        const phaseOffset = nextRandom() * Math.PI * 2;

        // Set instance attributes
        positionArray.setXYZW(count, worldX, worldY, worldZ, heightScale);
        variationArray.setXYZW(
          count,
          rotation,
          widthScale,
          colorVar,
          phaseOffset,
        );
        count++;
      }
    }

    // Update instance count
    chunk.count = count;
    chunk.mesh.count = count;

    // Update bounding sphere
    chunk.boundingSphere.center.set(
      originX + size / 2,
      getHeight(originX + size / 2, originZ + size / 2) +
        GRASS_CONFIG.BLADE_HEIGHT / 2,
      originZ + size / 2,
    );
    chunk.boundingSphere.radius =
      (Math.sqrt(2) * size) / 2 + GRASS_CONFIG.BLADE_HEIGHT;

    // Mark attributes for update
    positionArray.needsUpdate = true;
    variationArray.needsUpdate = true;

    // Add to scene and tracking (only if we have instances)
    if (this.grassContainer && count > 0) {
      this.grassContainer.add(chunk.mesh);
      chunk.visible = true;
      this.chunks.set(key, chunk);
    } else {
      // No valid grass placements - return chunk to pool for reuse
      // Don't track empty chunks so they can be retried later if conditions change
      this.chunkPool.push(chunk);
    }
  }

  /**
   * Create a new grass chunk with instanced mesh
   */
  private createChunk(
    key: string,
    originX: number,
    originZ: number,
    maxInstances: number,
  ): GrassChunk {
    // Clone geometry and add instance attributes
    const geometry = this.bladeGeometry!.clone();

    // Instance position: vec4(worldX, worldY, worldZ, heightScale)
    const instancePosition = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 4),
      4,
    );
    instancePosition.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("instancePosition", instancePosition);

    // Instance variation: vec4(rotation, widthScale, colorVar, phaseOffset)
    const instanceVariation = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 4),
      4,
    );
    instanceVariation.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("instanceVariation", instanceVariation);

    // Create instanced mesh
    const mesh = new THREE.InstancedMesh(
      geometry,
      this.grassMaterial!,
      maxInstances,
    );
    mesh.frustumCulled = false; // We do manual frustum culling
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `GrassChunk_${key}`;

    return {
      key,
      originX,
      originZ,
      mesh,
      count: 0,
      visible: false,
      boundingSphere: new THREE.Sphere(
        new THREE.Vector3(originX, 0, originZ),
        GRASS_CONFIG.CHUNK_SIZE,
      ),
    };
  }

  /**
   * Remove a chunk and return it to the pool
   */
  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Remove from scene
    if (chunk.mesh.parent) {
      chunk.mesh.parent.remove(chunk.mesh);
    }

    // Return to pool (limit pool size)
    if (this.chunkPool.length < 20) {
      chunk.visible = false;
      chunk.count = 0;
      chunk.mesh.count = 0;
      this.chunkPool.push(chunk);
    } else {
      // Dispose
      chunk.mesh.geometry.dispose();
    }

    this.chunks.delete(key);
  }

  /**
   * Update grass system each frame
   */
  update(deltaTime: number): void {
    if (!this.grassMaterial || !this.grassContainer) return;

    // Update time uniform for wind animation
    this.grassMaterial.grassUniforms.time.value += deltaTime;

    // Update wind from Wind system
    if (this.windSystem) {
      this.grassMaterial.grassUniforms.windStrength.value =
        this.windSystem.uniforms.windStrength.value;
      this.grassMaterial.grassUniforms.windDirection.value.copy(
        this.windSystem.uniforms.windDirection.value,
      );
    }

    // Update player position
    const localPlayer = this.world.entities?.getLocalPlayer?.();
    if (localPlayer?.position) {
      this.playerPosition.copy(localPlayer.position);
      this.grassMaterial.grassUniforms.playerPos.value.copy(
        this.playerPosition,
      );
    }

    // Update camera position
    const camera = this.world.camera;
    if (camera) {
      this.cameraPosition.copy(camera.position);
      this.grassMaterial.grassUniforms.cameraPos.value.copy(
        this.cameraPosition,
      );
    }

    // Throttled visibility update
    const now = performance.now();
    if (now - this.lastUpdateTime > this.updateInterval) {
      this.updateChunkVisibility();
      this.lastUpdateTime = now;
    }
  }

  /**
   * Update chunk visibility based on frustum and distance.
   * Uses GPU culling when available for per-instance culling,
   * with CPU coarse chunk culling as optimization.
   */
  private updateChunkVisibility(): void {
    const camera = this.world.camera;
    if (!camera) return;

    // Update frustum
    this.frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);

    const maxDistSq = GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END * 1.5;

    // Update GPU compute frustum if enabled
    if (this.gpuCullingEnabled && isGPUComputeAvailable()) {
      const gpuCompute = getGPUComputeManager();
      gpuCompute.grass?.updateFrustum(camera);
    }

    for (const chunk of this.chunks.values()) {
      // Coarse distance check (same for CPU and GPU paths)
      const dx = chunk.boundingSphere.center.x - this.playerPosition.x;
      const dz = chunk.boundingSphere.center.z - this.playerPosition.z;
      const distSq = dx * dx + dz * dz;

      if (distSq > maxDistSq) {
        chunk.mesh.visible = false;
        continue;
      }

      // Coarse frustum check for chunk bounds
      const inFrustum = this.frustum.intersectsSphere(chunk.boundingSphere);

      if (!inFrustum) {
        chunk.mesh.visible = false;
        continue;
      }

      // Chunk is coarsely visible
      chunk.mesh.visible = true;

      // If GPU culling is enabled, the GPU handles per-instance culling
      // via indirect draw. The mesh.visible controls coarse culling.
      // The actual instance count is determined by the GPU indirect buffer.
    }
  }

  /**
   * Get indirect draw buffer for a chunk (for GPU-driven rendering).
   * Returns null if GPU culling is not enabled.
   */
  getChunkIndirectBuffer(chunkKey: string): GPUBuffer | null {
    if (!this.gpuCullingEnabled || !isGPUComputeAvailable()) {
      return null;
    }
    const gpuCompute = getGPUComputeManager();
    return gpuCompute.grass?.getChunkIndirectBuffer(chunkKey) ?? null;
  }

  /**
   * Check if GPU indirect draw is available for grass rendering.
   */
  isIndirectDrawAvailable(): boolean {
    return this.gpuCullingEnabled && isGPUComputeAvailable();
  }

  /**
   * Set biome grass configuration
   */
  setBiomeGrassConfig(biome: string, config: BiomeGrassConfig): void {
    this.biomeGrassConfigs.set(biome, config);
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    chunkCount: number;
    visibleChunks: number;
    totalInstances: number;
    poolSize: number;
  } {
    let visibleChunks = 0;
    let totalInstances = 0;

    for (const chunk of this.chunks.values()) {
      if (chunk.mesh.visible) visibleChunks++;
      totalInstances += chunk.count;
    }

    return {
      chunkCount: this.chunks.size,
      visibleChunks,
      totalInstances,
      poolSize: this.chunkPool.length,
    };
  }

  dispose(): void {
    // Remove all chunks
    for (const key of this.chunks.keys()) {
      this.removeChunk(key);
    }

    // Dispose pooled chunks
    for (const chunk of this.chunkPool) {
      chunk.mesh.geometry.dispose();
    }
    this.chunkPool = [];

    // Dispose shared resources
    if (this.bladeGeometry) {
      this.bladeGeometry.dispose();
      this.bladeGeometry = null;
    }

    if (this.grassMaterial) {
      this.grassMaterial.dispose();
      this.grassMaterial = null;
    }

    // Remove container
    if (this.grassContainer) {
      const stage = this.world.stage as { scene?: THREE.Scene } | null;
      if (stage?.scene) {
        stage.scene.remove(this.grassContainer);
      }
      this.grassContainer = null;
    }

    console.log("[GrassSystem] Disposed");
  }
}
