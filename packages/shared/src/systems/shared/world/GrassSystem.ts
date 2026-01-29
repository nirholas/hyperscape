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
} from "../../../extras/three/three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { EventType } from "../../../types/events";
import { NoiseGenerator } from "../../../utils/NoiseGenerator";
import type { Wind } from "./Wind";
import { GPU_VEG_CONFIG } from "./GPUVegetation";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Grass rendering configuration.
 */
export const GRASS_CONFIG = {
  /** Grass blade height in meters (base, varies per instance) */
  BLADE_HEIGHT: 0.4,

  /** Grass blade width at base in meters */
  BLADE_WIDTH: 0.04,

  /** Number of segments per blade (more = smoother bend) */
  BLADE_SEGMENTS: 4,

  /** Maximum instances per chunk */
  MAX_INSTANCES_PER_CHUNK: 65536,

  /** Chunk size in meters (should match or subdivide terrain tile) */
  CHUNK_SIZE: 25,

  /** Terrain tile size in meters (must match TerrainSystem.CONFIG.TILE_SIZE) */
  TILE_SIZE: 100,

  /** Base density: instances per square meter */
  BASE_DENSITY: 8,

  /** Distance where grass starts fading (meters from player) */
  FADE_START: 45,

  /** Distance where grass is fully invisible */
  FADE_END: 60,

  /** Water level - grass doesn't grow below this */
  WATER_LEVEL: GPU_VEG_CONFIG.WATER_LEVEL,

  /** Buffer above water for shoreline avoidance */
  WATER_BUFFER: 1.0,

  // Wind animation parameters
  /** Primary wind oscillation speed (lower = gentler sway) */
  WIND_SPEED: 0.5,

  /** Secondary gust wave speed */
  GUST_SPEED: 0.2,

  /** Maximum wind bend angle (radians) */
  MAX_BEND: 0.5,

  /** Flutter intensity for blade tips */
  FLUTTER_INTENSITY: 0.15,

  // Color variation - matches TerrainShader.ts grass colors
  /** Base grass color (matches terrain grassGreen) */
  BASE_COLOR: new THREE.Color(0.3, 0.55, 0.15),

  /** Tip color (lighter version of base, not yellow) */
  TIP_COLOR: new THREE.Color(0.38, 0.62, 0.22),

  /** Dark grass color for variation (matches terrain grassDark) */
  DARK_COLOR: new THREE.Color(0.22, 0.42, 0.1),

  // LOD
  /** Near distance for full density */
  LOD_NEAR: 15,

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
 */
export const BIOME_GRASS_DEFAULTS: Record<string, BiomeGrassConfig> = {
  plains: { enabled: true, densityMultiplier: 1.2, heightMultiplier: 1.0 },
  forest: { enabled: true, densityMultiplier: 0.6, heightMultiplier: 0.9 },
  valley: { enabled: true, densityMultiplier: 1.0, heightMultiplier: 1.1 },
  hills: { enabled: true, densityMultiplier: 0.8, heightMultiplier: 0.85 },
  mountains: { enabled: false, densityMultiplier: 0.2, heightMultiplier: 0.6 },
  desert: { enabled: false, densityMultiplier: 0.1, heightMultiplier: 0.5 },
  swamp: { enabled: true, densityMultiplier: 0.7, heightMultiplier: 1.3 },
  lakes: { enabled: false, densityMultiplier: 0.0 },
};

// ============================================================================
// GRASS GEOMETRY GENERATION
// ============================================================================

/**
 * Creates the base grass blade geometry (single blade, triangle strip).
 * The geometry is a flat quad that bends in the vertex shader.
 *
 * Blade structure (5 segments = 10 vertices, 8 triangles):
 *   4---5
 *   |\  |
 *   | \ |
 *   2---3
 *   |\  |
 *   | \ |
 *   0---1  (base at y=0)
 *
 * UV mapping: u = 0 (left edge) to 1 (right edge), v = 0 (base) to 1 (tip)
 */
function createGrassBladeGeometry(
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
 * Implements vertex-based wind animation and distance fade.
 */
function createGrassMaterial(): GrassMaterial {
  const material = new MeshStandardNodeMaterial();

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
  const waterLevel = float(
    GRASS_CONFIG.WATER_LEVEL + GRASS_CONFIG.WATER_BUFFER,
  );
  const maxBend = float(GRASS_CONFIG.MAX_BEND);
  const flutterIntensity = float(GRASS_CONFIG.FLUTTER_INTENSITY);

  // Colors
  const baseColor = vec3(
    GRASS_CONFIG.BASE_COLOR.r,
    GRASS_CONFIG.BASE_COLOR.g,
    GRASS_CONFIG.BASE_COLOR.b,
  );
  const tipColor = vec3(
    GRASS_CONFIG.TIP_COLOR.r,
    GRASS_CONFIG.TIP_COLOR.g,
    GRASS_CONFIG.TIP_COLOR.b,
  );
  const darkColor = vec3(
    GRASS_CONFIG.DARK_COLOR.r,
    GRASS_CONFIG.DARK_COLOR.g,
    GRASS_CONFIG.DARK_COLOR.b,
  );

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
  // Use UV.y for height (0 at base, 1 at tip - set in geometry)
  // Use instanceIndex with golden ratio hash for color variation
  material.colorNode = Fn(() => {
    // UV.y is 0 at base, 1 at tip (from blade geometry)
    const heightT = uv().y;

    // Create pseudo-random color variation from instance index
    // Golden ratio fractional hash gives good distribution
    const colorVar = fract(mul(float(instanceIndex), float(0.61803398875)));

    // Subtle base to tip gradient (darker at base, slightly lighter at tip)
    const gradientColor = mix(baseColor, tipColor, mul(heightT, float(0.6)));

    // Mix in darker color based on variation for natural variety
    // This creates patches of lighter/darker grass like the terrain
    const finalColor = mix(gradientColor, darkColor, mul(colorVar, float(0.4)));

    return finalColor;
  })();

  // ========== OPACITY NODE (SMOOTH DISTANCE FADE) ==========
  material.opacityNode = Fn(() => {
    const worldPos = positionWorld;

    // Distance to player (horizontal only)
    const toPlayer = sub(worldPos, uPlayerPos);
    const distSq = add(
      mul(toPlayer.x, toPlayer.x),
      mul(toPlayer.z, toPlayer.z),
    );

    // Smooth fade based on distance (1.0 = fully visible, 0.0 = invisible)
    const distanceFade = sub(
      float(1.0),
      smoothstep(fadeStartSq, fadeEndSq, distSq),
    );

    // Water culling - grass below water is invisible
    const aboveWater = sub(float(1.0), step(worldPos.y, waterLevel));

    // Combine distance fade with water culling
    const opacity = mul(distanceFade, aboveWater);

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

  // Terrain system reference for height queries
  private terrainSystem: {
    getHeightAt: (x: number, z: number) => number;
  } | null = null;
  private terrainWarningLogged = false;

  // Biome grass configs (loaded from terrain system)
  private biomeGrassConfigs = new Map<string, BiomeGrassConfig>();

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

    // Initialize noise from world seed
    const seed = this.getWorldSeed();
    this.noise = new NoiseGenerator(seed);

    // Get wind system reference
    this.windSystem =
      (this.world.getSystem("wind") as Wind | undefined) ?? null;

    // Get terrain system reference for height queries
    const terrain = this.world.getSystem("terrain");
    if (terrain && "getHeightAt" in terrain) {
      this.terrainSystem = terrain as {
        getHeightAt: (x: number, z: number) => number;
      };
    } else {
      console.warn(
        "[GrassSystem] TerrainSystem not available or missing getHeightAt - grass will be placed at y=0",
      );
    }

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

    console.log(
      `[GrassSystem] Initialized with seed ${seed}, chunk size ${GRASS_CONFIG.CHUNK_SIZE}m, terrain=${this.terrainSystem ? "available" : "unavailable"}`,
    );
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
    const { position, biome } = event;

    // Check if biome supports grass
    const grassConfig =
      this.biomeGrassConfigs.get(biome) ?? BIOME_GRASS_DEFAULTS.plains;
    if (!grassConfig.enabled || grassConfig.densityMultiplier <= 0) {
      return;
    }

    // Generate grass chunks for this tile
    this.generateGrassForTile(
      position.x,
      position.z,
      GRASS_CONFIG.TILE_SIZE,
      grassConfig,
    );
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
   * Generate grass for a terrain tile area
   */
  private generateGrassForTile(
    originX: number,
    originZ: number,
    tileSize: number,
    grassConfig: BiomeGrassConfig,
  ): void {
    if (!this.noise || !this.bladeGeometry || !this.grassMaterial) {
      console.warn(
        `[GrassSystem] Cannot generate grass at (${originX}, ${originZ}) - system not fully initialized: ` +
          `noise=${!!this.noise}, geometry=${!!this.bladeGeometry}, material=${!!this.grassMaterial}`,
      );
      return;
    }

    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
    const chunksPerTile = Math.ceil(tileSize / chunkSize);

    for (let cx = 0; cx < chunksPerTile; cx++) {
      for (let cz = 0; cz < chunksPerTile; cz++) {
        const chunkOriginX = originX + cx * chunkSize;
        const chunkOriginZ = originZ + cz * chunkSize;
        const chunkX = Math.floor(chunkOriginX / chunkSize);
        const chunkZ = Math.floor(chunkOriginZ / chunkSize);
        const key = `${chunkX}_${chunkZ}`;

        // Skip if chunk already exists
        if (this.chunks.has(key)) continue;

        // Generate grass instances for this chunk
        this.generateChunk(
          key,
          chunkOriginX,
          chunkOriginZ,
          chunkSize,
          grassConfig,
        );
      }
    }
  }

  /**
   * Generate a single grass chunk with instances
   */
  private generateChunk(
    key: string,
    originX: number,
    originZ: number,
    size: number,
    grassConfig: BiomeGrassConfig,
  ): void {
    if (!this.noise || !this.bladeGeometry || !this.grassMaterial) {
      // This should never happen if generateGrassForTile checked, but be safe
      console.error(
        `[GrassSystem] generateChunk called with uninitialized dependencies for chunk ${key}`,
      );
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

    // Get or create chunk from pool
    let chunk = this.chunkPool.pop();
    if (!chunk) {
      chunk = this.createChunk(key, originX, originZ, instanceCount);
    } else {
      // Reuse chunk
      chunk.key = key;
      chunk.originX = originX;
      chunk.originZ = originZ;
      chunk.count = 0;
    }

    // Get terrain height function - uses cached terrain system reference
    const getHeight = (x: number, z: number): number => {
      if (this.terrainSystem) {
        return this.terrainSystem.getHeightAt(x, z);
      }
      // Log warning only once per session
      if (!this.terrainWarningLogged) {
        console.warn(
          `[GrassSystem] Terrain height unavailable for chunk at (${originX}, ${originZ}) - using y=0`,
        );
        this.terrainWarningLogged = true;
      }
      return 0;
    };

    // Generate instance positions
    const positionArray = chunk.mesh.geometry.getAttribute(
      "instancePosition",
    ) as THREE.InstancedBufferAttribute;
    const variationArray = chunk.mesh.geometry.getAttribute(
      "instanceVariation",
    ) as THREE.InstancedBufferAttribute;

    // Deterministic RNG for this chunk
    const chunkSeed = this.hashPosition(originX, originZ);
    let rngState = chunkSeed;
    const nextRandom = (): number => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };

    let count = 0;
    const spacing = Math.sqrt(1 / baseDensity);

    // Grid-jittered placement for even distribution
    for (let gx = 0; gx < size && count < instanceCount; gx += spacing) {
      for (let gz = 0; gz < size && count < instanceCount; gz += spacing) {
        // Jitter position within grid cell
        const jitterX = (nextRandom() - 0.5) * spacing * 0.8;
        const jitterZ = (nextRandom() - 0.5) * spacing * 0.8;

        const worldX = originX + gx + jitterX;
        const worldZ = originZ + gz + jitterZ;

        // Noise-based density variation
        const noiseVal = this.noise.perlin2D(worldX * 0.05, worldZ * 0.05);
        if (noiseVal < -0.3) continue; // Sparse areas

        // Get terrain height
        const worldY = getHeight(worldX, worldZ);

        // Skip underwater
        if (worldY < GRASS_CONFIG.WATER_LEVEL + GRASS_CONFIG.WATER_BUFFER) {
          continue;
        }

        // Instance variation
        // Apply biome height multiplier (default 1.0) as a scale factor
        const biomeHeightMult = grassConfig.heightMultiplier ?? 1.0;
        const heightScale = (0.7 + nextRandom() * 0.6) * biomeHeightMult;
        const rotation = nextRandom() * Math.PI * 2;
        const widthScale = 0.8 + nextRandom() * 0.4;
        const colorVar = nextRandom();
        const phaseOffset = nextRandom() * Math.PI * 2;

        // Set instance attributes
        const idx = count;
        positionArray.setXYZW(idx, worldX, worldY, worldZ, heightScale);
        variationArray.setXYZW(
          idx,
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

    // Add to scene and tracking
    if (this.grassContainer && count > 0) {
      this.grassContainer.add(chunk.mesh);
      chunk.visible = true;
    }

    this.chunks.set(key, chunk);
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
   * Update chunk visibility based on frustum and distance
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

    for (const chunk of this.chunks.values()) {
      // Distance check
      const dx = chunk.boundingSphere.center.x - this.playerPosition.x;
      const dz = chunk.boundingSphere.center.z - this.playerPosition.z;
      const distSq = dx * dx + dz * dz;

      if (distSq > maxDistSq) {
        chunk.mesh.visible = false;
        continue;
      }

      // Frustum check
      const inFrustum = this.frustum.intersectsSphere(chunk.boundingSphere);
      chunk.mesh.visible = inFrustum;
    }
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
