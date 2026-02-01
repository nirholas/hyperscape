/**
 * ProceduralGrass.ts - GPU Grass with Heightmap Texture Sampling
 *
 * Architecture:
 * 1. TerrainSystem provides heightmap texture (baked from noise)
 * 2. Compute shader samples heightmap for grass Y positions
 * 3. Grass rendered as instanced billboards with wind animation
 *
 * @module ProceduralGrass
 */

import THREE, {
  uniform,
  Fn,
  If,
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
  div,
  max,
  sqrt,
  smoothstep,
  mix,
  uv,
  abs,
  floor,
  fract,
  instanceIndex,
  atan,
} from "../../../extras/three/three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { EventType } from "../../../types/events";
import { TERRAIN_CONSTANTS } from "../../../constants/GameConstants";
import {
  TERRAIN_CONSTANTS as TERRAIN_SHADER_CONSTANTS,
  generateNoiseTexture,
  sampleNoiseAtPosition,
} from "./TerrainShader";
import type { FlatZone } from "../../../types/world/terrain";

const { storage } = THREE.TSL;

// ============================================================================
// INTERFACES
// ============================================================================

interface TerrainSystemInterface {
  getHeightAt?(worldX: number, worldZ: number): number;
  getHeightmapTexture?(): THREE.DataTexture | null;
  getSlopeAt?(worldX: number, worldZ: number): number;
  isInFlatZone?(worldX: number, worldZ: number): boolean;
  getFlatZoneAt?(worldX: number, worldZ: number): FlatZone | null;
}

interface RoadNetworkSystemInterface {
  getDistanceToNearestRoad?(worldX: number, worldZ: number): number;
  config?: { roadWidth: number };
}

interface BuildingCollisionService {
  queryCollision: (
    tileX: number,
    tileZ: number,
    floorIndex: number,
  ) => { isInsideBuilding: boolean };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// ============================================================================
// GRASS CONFIGURATION - Dense near, extends to 150m
// ============================================================================
// Smaller cells for denser near-camera coverage
const SUB_CELLS_PER_AXIS = 8; // 8×8 = 64 blades per cell
const SUB_CELLS_TOTAL = SUB_CELLS_PER_AXIS * SUB_CELLS_PER_AXIS; // 64
const MAX_INSTANCES = 3000000; // 3M instances
const GRID_CELLS = Math.floor(Math.sqrt(MAX_INSTANCES / SUB_CELLS_TOTAL)); // ~216 cells
const CELL_SIZE = 0.7; // 0.7m cells = tighter packing near camera
// Coverage: 216 * 0.7 = ~151m total, ~75m radius
const GRID_RADIUS = (GRID_CELLS * CELL_SIZE) / 2;

// Jitter amount: 200% of cell size for natural overlap
const JITTER_AMOUNT = 2.0;

// Moderate falloff - very dense near, gradual thin at distance
// At 0.08: 100% at 0m, 45% at 10m, 20% at 20m, 4% at 40m
const DENSITY_FALLOFF_RATE = 0.08;

const GRASS_CONFIG = {
  MAX_INSTANCES: GRID_CELLS * GRID_CELLS * SUB_CELLS_TOTAL,
  GRID_CELLS,
  GRID_RADIUS,
  CELL_SIZE,
  SUB_CELLS_PER_AXIS,
  SUB_CELLS_TOTAL,
  DENSITY_FALLOFF_RATE,
  BLADE_HEIGHT: 0.6,
  BLADE_WIDTH: 0.15,
  FADE_START: 50,
  FADE_END: 150,
  WATER_LEVEL: TERRAIN_CONSTANTS.WATER_CUTOFF,
  COMPUTE_UPDATE_THRESHOLD: 2,
  HEIGHTMAP_SIZE: 1024,
  HEIGHTMAP_WORLD_SIZE: 800,
  MAX_HEIGHT: 50,
  WIND_SPEED: 0.3,
  WIND_STRENGTH: 0.15,
  WIND_FREQUENCY: 0.06,
  GUST_SPEED: 0.08,
  FLUTTER_INTENSITY: 0.04,
  MAX_DISPLACERS: 8,
  ROAD_FADE_WIDTH: 2.0, // Grass fade distance beyond road edge (meters)
} as const;

// ============================================================================
// GRASS BLADE GEOMETRY
// ============================================================================

function createGrassTuftGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const segments = 4; // More segments for smooth curve

  // Single blade: (segments + 1) * 2 vertices
  const verticesPerBlade = (segments + 1) * 2;
  const trianglesPerBlade = segments * 2;

  const positions = new Float32Array(verticesPerBlade * 3);
  const uvs = new Float32Array(verticesPerBlade * 2);
  const normals = new Float32Array(verticesPerBlade * 3);
  const indices = new Uint16Array(trianglesPerBlade * 3);

  // Generate single blade vertices (tapered from base to tip)
  // Blade lies flat in XY plane - shader rotates it to face camera
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; // 0 at base, 1 at tip
    const y = t;

    // Blade tapers toward tip - organic quadratic taper
    const taper = 1.0 - t * t; // Quadratic taper for natural look
    const width = taper * 0.5;

    // Left vertex (negative X)
    const leftIdx = i * 2;
    positions[leftIdx * 3 + 0] = -width; // x
    positions[leftIdx * 3 + 1] = y; // y (height)
    positions[leftIdx * 3 + 2] = 0; // z

    uvs[leftIdx * 2 + 0] = 0; // u = 0 at left edge
    uvs[leftIdx * 2 + 1] = t; // v = height

    normals[leftIdx * 3 + 0] = 0;
    normals[leftIdx * 3 + 1] = 0;
    normals[leftIdx * 3 + 2] = 1; // Face forward (will be rotated by shader)

    // Right vertex (positive X)
    const rightIdx = i * 2 + 1;
    positions[rightIdx * 3 + 0] = width; // x
    positions[rightIdx * 3 + 1] = y; // y (height)
    positions[rightIdx * 3 + 2] = 0; // z

    uvs[rightIdx * 2 + 0] = 1; // u = 1 at right edge
    uvs[rightIdx * 2 + 1] = t;

    normals[rightIdx * 3 + 0] = 0;
    normals[rightIdx * 3 + 1] = 0;
    normals[rightIdx * 3 + 2] = 1;
  }

  // Generate indices
  let idx = 0;
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    // First triangle (CCW)
    indices[idx++] = base;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    // Second triangle (CCW)
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 3;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  return geometry;
}

// ============================================================================
// GPU GRASS SYSTEM
// ============================================================================

// Storage buffer type from TSL
type TSLStorageBuffer = ReturnType<typeof storage>;
type TSLTextureNode = ReturnType<typeof THREE.TSL.texture>;

export class ProceduralGrassSystem extends System {
  private mesh: THREE.InstancedMesh | null = null;
  private renderer: THREE.WebGPURenderer | null = null;

  // GPU storage buffers
  private positionsBuffer: TSLStorageBuffer | null = null;
  private variationsBuffer: TSLStorageBuffer | null = null;

  // Textures
  private heightmapTexture: THREE.DataTexture | null = null;
  private heightmapTextureNode: TSLTextureNode | null = null;
  private noiseTexture: THREE.DataTexture | null = null;
  private noiseTextureNode: TSLTextureNode | null = null;

  private computeNode: THREE.ComputeNode | null = null;

  // Core uniforms
  private uCameraPos = uniform(new THREE.Vector3());
  private uTime = uniform(0);
  private uGridOrigin = uniform(new THREE.Vector2());

  // Controllable uniforms
  private uWindStrength = uniform(GRASS_CONFIG.WIND_STRENGTH as number);
  private uWindSpeed = uniform(GRASS_CONFIG.WIND_SPEED as number);
  private uBladeHeight = uniform(GRASS_CONFIG.BLADE_HEIGHT as number);
  private uBladeWidth = uniform(GRASS_CONFIG.BLADE_WIDTH as number);
  private uFadeStart = uniform(GRASS_CONFIG.FADE_START as number);
  private uFadeEnd = uniform(GRASS_CONFIG.FADE_END as number);

  // Frustum culling - camera forward direction for skipping grass behind camera
  private uCameraForward = uniform(new THREE.Vector3(0, 0, -1));
  private uFrustumCullAngle = uniform(0.3); // cos(~72°) - cull grass more than 72° from view center

  // Displacer uniforms (grass bends away from players/entities)
  private readonly displacerUniforms = Array.from(
    { length: GRASS_CONFIG.MAX_DISPLACERS },
    () => uniform(new THREE.Vector3(99999, 0, 99999)),
  );
  private uDisplacerRadius = uniform(0.6);
  private uDisplacerStrength = uniform(0.7);

  // State
  private lastUpdatePos = new THREE.Vector3(Infinity, 0, Infinity);
  private grassInitialized = false;
  private windEnabled = true;
  private heightmapRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  // External systems
  private terrainSystem: TerrainSystemInterface | null = null;
  private roadNetworkSystem: RoadNetworkSystemInterface | null = null;
  private buildingCollisionService: BuildingCollisionService | null = null;

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: ["terrain"], optional: ["roads", "graphics"] };
  }

  async start(): Promise<void> {
    if (!this.world.isClient || typeof window === "undefined") return;

    this.renderer =
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    this.terrainSystem = this.world.getSystem(
      "terrain",
    ) as TerrainSystemInterface | null;
    this.roadNetworkSystem = this.world.getSystem(
      "roads",
    ) as RoadNetworkSystemInterface | null;
    this.tryAcquireBuildingCollisionService();

    this.world.on(
      EventType.TERRAIN_TILE_REGENERATED,
      (payload: { reason: "flat_zone" | "road" | "other" }) => {
        if (payload.reason === "flat_zone") this.scheduleHeightmapRefresh();
      },
    );

    // Refresh grass heightmap when roads are generated to exclude grass on roads
    this.world.on(EventType.ROADS_GENERATED, () => {
      this.roadNetworkSystem = this.world.getSystem(
        "roads",
      ) as RoadNetworkSystemInterface | null;
      this.scheduleHeightmapRefresh();
    });

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    await this.initializeGrass();
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

    await this.setupHeightmapTexture();
    if (!this.heightmapTexture) {
      setTimeout(() => this.initializeGrass(), 500);
      return;
    }

    // Create GPU storage buffers
    const posAttr = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(GRASS_CONFIG.MAX_INSTANCES * 4),
      4,
    );
    const varAttr = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(GRASS_CONFIG.MAX_INSTANCES * 4),
      4,
    );
    this.positionsBuffer = storage(posAttr, "vec4", GRASS_CONFIG.MAX_INSTANCES);
    this.variationsBuffer = storage(
      varAttr,
      "vec4",
      GRASS_CONFIG.MAX_INSTANCES,
    );

    this.createComputeShader();

    const geometry = createGrassTuftGeometry();
    const material = this.createGrassMaterial();
    this.mesh = new THREE.InstancedMesh(
      geometry,
      material,
      GRASS_CONFIG.MAX_INSTANCES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.name = "ProceduralGrass_GPU";

    // Shadow configuration:
    // - Don't cast shadows: grass shadows are too noisy and expensive
    // - Do receive shadows: grass should be shaded by trees, buildings, etc.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;

    // Initialize identity matrices
    const matrixArray = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < GRASS_CONFIG.MAX_INSTANCES; i++) {
      const offset = i * 16;
      matrixArray[offset] = 1;
      matrixArray[offset + 5] = 1;
      matrixArray[offset + 10] = 1;
      matrixArray[offset + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      10000,
    );

    stage.scene.add(this.mesh);
    this.grassInitialized = true;

    const camera = this.world.camera;
    if (camera) {
      this.runCompute();
      this.lastUpdatePos.copy(camera.position);
    }
  }

  /** Setup heightmap texture - get from TerrainSystem or generate */
  private async setupHeightmapTexture(): Promise<void> {
    this.noiseTexture = generateNoiseTexture();
    this.noiseTextureNode = THREE.TSL.texture(this.noiseTexture);

    // Try TerrainSystem first
    const terrainHeightmap = this.terrainSystem?.getHeightmapTexture?.();
    if (terrainHeightmap) {
      this.heightmapTexture = terrainHeightmap;
      this.heightmapTextureNode = THREE.TSL.texture(this.heightmapTexture);
      return;
    }

    // Generate our own heightmap
    await this.generateHeightmapTexture();
  }

  /**
   * Generate heightmap texture by sampling terrain
   * R = normalized height, G = grassiness (0-1), B = slope, A = 1
   *
   * Grassiness matches TerrainShader exactly:
   * - No grass on dirt patches (noise > DIRT_THRESHOLD)
   * - No grass on steep slopes (rock)
   * - No grass near water (sand/mud)
   * - No grass at high elevation (snow)
   * - No grass on roads, flat zones, inside buildings
   */
  private async generateHeightmapTexture(): Promise<void> {
    if (!this.terrainSystem) {
      console.warn(
        "[ProceduralGrass] No terrain system for heightmap generation",
      );
      return;
    }

    // Check if getHeightAt exists
    if (typeof this.terrainSystem.getHeightAt !== "function") {
      console.warn("[ProceduralGrass] TerrainSystem.getHeightAt not available");
      return;
    }

    const size = GRASS_CONFIG.HEIGHTMAP_SIZE;
    const worldSize = GRASS_CONFIG.HEIGHTMAP_WORLD_SIZE;
    const maxHeight = GRASS_CONFIG.MAX_HEIGHT;
    const halfWorld = worldSize / 2;

    // Sample terrain heights, grassiness into RGBA float texture
    const rgbaHeightData = new Float32Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Convert texture coords to world coords (centered at origin)
        const worldX = (x / size) * worldSize - halfWorld;
        const worldZ = (y / size) * worldSize - halfWorld;

        // Get height from terrain system (we verified getHeightAt exists above)
        const height = this.terrainSystem.getHeightAt(worldX, worldZ);

        // Estimate slope from neighboring heights
        let slope: number;
        if (typeof this.terrainSystem.getSlopeAt === "function") {
          slope = this.terrainSystem.getSlopeAt(worldX, worldZ);
        } else {
          // Approximate slope from height differences
          const h1 = this.terrainSystem.getHeightAt(worldX + 1, worldZ);
          const h2 = this.terrainSystem.getHeightAt(worldX, worldZ + 1);
          const dx = h1 - height;
          const dz = h2 - height;
          slope = Math.sqrt(dx * dx + dz * dz) / 2;
        }

        // Calculate grassiness (0 = no grass, 1 = full grass)
        // Matches TerrainShader.ts logic EXACTLY
        let grassiness = 1.0;

        // Sample noise at this position (same as terrain shader)
        const noiseValue = sampleNoiseAtPosition(worldX, worldZ);

        // === DIRT PATCHES (noise-based) ===
        // TerrainShader shows dirt where noise > DIRT_THRESHOLD
        // Grass should NOT grow on brown dirt patches
        const dirtThreshold = TERRAIN_SHADER_CONSTANTS.DIRT_THRESHOLD; // 0.5
        if (noiseValue > dirtThreshold - 0.05) {
          const dirtPatchFactor = smoothstepJS(
            dirtThreshold - 0.05,
            dirtThreshold + 0.15,
            noiseValue,
          );
          // Only apply dirt on relatively flat ground (same as terrain shader)
          const flatnessFactor = smoothstepJS(0.3, 0.05, slope);
          grassiness -= dirtPatchFactor * flatnessFactor * 0.9;
        }

        // Smooth grass-to-road transition with fade at edges
        if (
          grassiness > 0 &&
          this.roadNetworkSystem?.getDistanceToNearestRoad
        ) {
          const distance = this.roadNetworkSystem.getDistanceToNearestRoad(
            worldX,
            worldZ,
          );
          const halfWidth = (this.roadNetworkSystem.config?.roadWidth ?? 4) / 2;
          const fadeWidth = GRASS_CONFIG.ROAD_FADE_WIDTH;

          if (distance <= halfWidth) {
            grassiness = 0;
          } else if (distance < halfWidth + fadeWidth) {
            grassiness *= smoothstepJS(
              0,
              1,
              (distance - halfWidth) / fadeWidth,
            );
          }
        }

        // No grass in flat zones - use TIGHT bounds (no padding)
        // Flat zones have padding for terrain blending, but grass should only avoid
        // the actual station/building footprint, not the blend area
        if (grassiness > 0) {
          const flatZone = (
            this.terrainSystem as {
              getFlatZoneAt?: (x: number, z: number) => FlatZone | null;
            }
          ).getFlatZoneAt?.(worldX, worldZ);
          if (flatZone) {
            // Check against TIGHT bounds (subtract padding estimate of ~1m from each side)
            const tightHalfWidth = Math.max(0.5, flatZone.width / 2 - 1.0);
            const tightHalfDepth = Math.max(0.5, flatZone.depth / 2 - 1.0);
            const dx = Math.abs(worldX - flatZone.centerX);
            const dz = Math.abs(worldZ - flatZone.centerZ);
            if (dx <= tightHalfWidth && dz <= tightHalfDepth) {
              grassiness = 0;
            }
          }
        }

        // No grass inside buildings (tile-accurate check)
        if (grassiness > 0 && this.isInsideBuilding(worldX, worldZ)) {
          grassiness = 0;
        }

        // === STEEP SLOPES (dirt/rock) ===
        // Matches terrain shader: slope > 0.15 starts showing dirt, > 0.45 shows rock
        if (grassiness > 0 && slope > 0.15) {
          const slopeFactor = smoothstepJS(0.15, 0.5, slope);
          grassiness = Math.max(0, grassiness - slopeFactor * 0.8);
        }

        // === VERY STEEP = ROCK (no grass at all) ===
        if (grassiness > 0 && slope > 0.45) {
          const rockFactor = smoothstepJS(0.45, 0.75, slope);
          grassiness = Math.max(0, grassiness - rockFactor);
        }

        // === SHORELINE (sand/mud near water) ===
        // Matches terrain shader shoreline logic
        if (grassiness > 0 && height < 14) {
          // Wet dirt zone (8-14m) - reduce grass
          const wetDirtZone = smoothstepJS(14, 8, height);
          grassiness = Math.max(0, grassiness - wetDirtZone * 0.4);
        }
        if (grassiness > 0 && height < 9) {
          // Mud zone (6-9m) - strong reduction
          const mudZone = smoothstepJS(9, 6, height);
          grassiness = Math.max(0, grassiness - mudZone * 0.7);
        }
        if (grassiness > 0 && height < 6.5) {
          // Water's edge (5-6.5m) - no grass
          const edgeZone = smoothstepJS(6.5, 5, height);
          grassiness = Math.max(0, grassiness - edgeZone * 0.9);
        }

        // === SNOW AT HIGH ELEVATION ===
        const snowHeight = TERRAIN_SHADER_CONSTANTS.SNOW_HEIGHT; // 50
        if (grassiness > 0 && height > snowHeight - 5) {
          const snowFactor = smoothstepJS(snowHeight - 5, 60, height);
          grassiness = Math.max(0, grassiness - snowFactor);
        }

        // Store in RGBA float texture: R = height, G = grassiness, B = slope
        const normalized = Math.max(0, Math.min(1, height / maxHeight));
        const idx = (y * size + x) * 4;
        rgbaHeightData[idx + 0] = normalized; // R = height
        rgbaHeightData[idx + 1] = Math.max(0, Math.min(1, grassiness)); // G = grassiness
        rgbaHeightData[idx + 2] = Math.min(1, slope); // B = slope (for GPU color calc)
        rgbaHeightData[idx + 3] = 1;
      }
    }

    this.heightmapTexture = new THREE.DataTexture(
      rgbaHeightData,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightmapTexture.magFilter = THREE.LinearFilter;
    this.heightmapTexture.minFilter = THREE.LinearFilter;
    this.heightmapTexture.needsUpdate = true;
    this.heightmapTextureNode = THREE.TSL.texture(this.heightmapTexture);
  }

  /**
   * GPU Compute Shader - samples heightmap + grassiness and writes instance data
   */
  private createComputeShader(): void {
    if (
      !this.positionsBuffer ||
      !this.variationsBuffer ||
      !this.heightmapTexture
    )
      return;

    const cellSize = float(GRASS_CONFIG.CELL_SIZE);
    const waterLevel = float(GRASS_CONFIG.WATER_LEVEL);
    const maxDistSq = float(GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END);
    const hmWorldSize = float(GRASS_CONFIG.HEIGHTMAP_WORLD_SIZE);
    const hmMaxHeight = float(GRASS_CONFIG.MAX_HEIGHT);

    const positionsRef = this.positionsBuffer;
    const variationsRef = this.variationsBuffer;
    const gridOriginRef = this.uGridOrigin;
    // Note: Camera position NOT used in compute - ensures grass is stable during rotation
    // Frustum culling and fade are handled in vertex shader

    // Create texture node for use in compute shader
    const heightmapTexNode = THREE.TSL.texture(this.heightmapTexture);

    // Stratified sampling constants
    const subCellsPerAxis = float(GRASS_CONFIG.SUB_CELLS_PER_AXIS);
    const subCellsTotal = float(GRASS_CONFIG.SUB_CELLS_TOTAL);
    const falloffRate = float(GRASS_CONFIG.DENSITY_FALLOFF_RATE);
    const gridCellsFloat = float(GRASS_CONFIG.GRID_CELLS);
    const gridHalfSizeRef = float(
      (GRASS_CONFIG.GRID_CELLS * GRASS_CONFIG.CELL_SIZE) / 2,
    );

    const computeFn = Fn(() => {
      const idx = float(instanceIndex);

      // ================================================================
      // WORLD-STABLE GRASS PLACEMENT
      // Seeds based on WORLD cell coordinates (quantized), not grid-relative
      // This ensures grass doesn't shift when camera moves
      // ================================================================

      // Decompose instance into cell + blade within cell
      const bladeIdx = idx.mod(subCellsTotal);
      const cellIdx = floor(idx.div(subCellsTotal));

      // Grid cell coordinates (relative to moving grid origin)
      const gridCellX = cellIdx.mod(gridCellsFloat);
      const gridCellZ = floor(cellIdx.div(gridCellsFloat));

      // Cell corner in world space
      const cellWorldX = add(gridOriginRef.x, mul(gridCellX, cellSize));
      const cellWorldZ = add(gridOriginRef.y, mul(gridCellZ, cellSize));

      // ================================================================
      // WORLD-QUANTIZED CELL COORDINATES FOR SEEDING
      // These are absolute world cell indices, not relative to grid origin
      // Grass at world position (10.5, 20.3) with cellSize=0.7 is always in cell (15, 29)
      // ================================================================
      const worldCellX = floor(div(cellWorldX, cellSize));
      const worldCellZ = floor(div(cellWorldZ, cellSize));

      // ================================================================
      // DECORRELATED RANDOM GENERATION using world-stable seeds
      // X offset uses ONLY worldCellX, Z uses ONLY worldCellZ
      // bladeIdx scrambled differently for each axis
      // ================================================================

      // Create unique blade identifier that's different for X and Z
      const bladeIdxScrambledX = fract(mul(bladeIdx, float(0.618033988749895))); // golden ratio
      const bladeIdxScrambledZ = fract(mul(bladeIdx, float(0.414213562373095))); // sqrt(2)-1

      // X RANDOM: Based on worldCellX and scrambled bladeIdx only (NO Z!)
      const xSeed1 = fract(
        mul(add(worldCellX, bladeIdxScrambledX), float(0.7548776662)),
      );
      const xSeed2 = fract(
        mul(
          add(worldCellX, mul(bladeIdxScrambledX, float(2.3))),
          float(0.5765683227),
        ),
      );
      const xSeed3 = fract(
        mul(mul(worldCellX, add(bladeIdx, float(1))), float(0.00001)),
      );

      // Z RANDOM: Based on worldCellZ and differently scrambled bladeIdx only (NO X!)
      const zSeed1 = fract(
        mul(add(worldCellZ, bladeIdxScrambledZ), float(0.8437284728)),
      );
      const zSeed2 = fract(
        mul(
          add(worldCellZ, mul(bladeIdxScrambledZ, float(3.7))),
          float(0.3928474782),
        ),
      );
      const zSeed3 = fract(
        mul(mul(worldCellZ, add(bladeIdx, float(7))), float(0.00001)),
      );

      // Combine multiple sources for each axis (still independent)
      const randX = fract(
        add(add(xSeed1, mul(xSeed2, float(0.5))), mul(xSeed3, float(0.25))),
      );
      const randZ = fract(
        add(add(zSeed1, mul(zSeed2, float(0.5))), mul(zSeed3, float(0.25))),
      );

      // Property seeds (can use both X and Z since not for position)
      const propSeed = add(
        add(mul(worldCellX, float(73856093)), mul(worldCellZ, float(19349663))),
        mul(bladeIdx, float(83492791)),
      );
      const r3 = fract(mul(propSeed, float(0.00000001)));
      const r4 = fract(mul(propSeed, float(0.000000017)));
      const r5 = fract(mul(propSeed, float(0.000000023)));
      const r6 = fract(mul(propSeed, float(0.000000031)));

      // ================================================================
      // RANDOM POSITION within extended cell area
      // ================================================================

      // Coverage area: cell + overflow into neighbors
      const coverageRange = mul(cellSize, float(JITTER_AMOUNT));

      // Position: anywhere within coverage area centered on cell
      const offsetX = mul(
        sub(randX, float(0.5)),
        mul(coverageRange, float(2.0)),
      );
      const offsetZ = mul(
        sub(randZ, float(0.5)),
        mul(coverageRange, float(2.0)),
      );

      // Final world position (cell corner + half cell + random offset)
      const worldX = add(add(cellWorldX, mul(cellSize, float(0.5))), offsetX);
      const worldZ = add(add(cellWorldZ, mul(cellSize, float(0.5))), offsetZ);

      // Use r5 for density check (independent from position)
      const h3 = r5;

      // ================================================================
      // GRID-CENTER BASED DENSITY (not camera-based!)
      // Using distance from GRID CENTER ensures density is stable
      // regardless of camera position/rotation within the grid
      // ================================================================
      const gridCenterX = add(gridOriginRef.x, gridHalfSizeRef);
      const gridCenterZ = add(gridOriginRef.y, gridHalfSizeRef);
      const dxGrid = sub(worldX, gridCenterX);
      const dzGrid = sub(worldZ, gridCenterZ);
      const distFromCenterSq = add(mul(dxGrid, dxGrid), mul(dzGrid, dzGrid));
      const distFromCenter = distFromCenterSq.sqrt();

      // Sample heightmap for Y position and grassiness
      const halfWorld = mul(hmWorldSize, float(0.5));
      const uvX = add(worldX, halfWorld).div(hmWorldSize);
      const uvZ = add(worldZ, halfWorld).div(hmWorldSize);
      const clampedUvX = uvX.clamp(float(0.001), float(0.999));
      const clampedUvZ = uvZ.clamp(float(0.001), float(0.999));
      const hmUV = vec2(clampedUvX, clampedUvZ);
      const hmSample = heightmapTexNode.uv(hmUV);
      const normalizedHeight = hmSample.r;
      const grassiness = hmSample.g;
      const worldY = mul(normalizedHeight, hmMaxHeight);

      // ================================================================
      // EXPONENTIAL DENSITY FALLOFF from grid center
      // This is STABLE - only changes when grid scrolls, not on camera rotation
      // ================================================================
      const density = THREE.TSL.exp(mul(distFromCenter.negate(), falloffRate));
      // Skip threshold: 1 - density (lower density = higher skip chance)
      const skipThreshold = sub(float(1.0), density);
      const passedDensityCheck = h3.greaterThan(skipThreshold);

      // Visibility checks - all stable, no camera dependency
      const inRange = distFromCenterSq.lessThan(maxDistSq);
      const aboveWater = worldY.greaterThan(waterLevel);
      const isGrassy = grassiness.greaterThan(float(0.1));

      const visible = inRange
        .and(aboveWater)
        .and(isGrassy)
        .and(passedDensityCheck);

      const position = positionsRef.element(instanceIndex);
      const variation = variationsRef.element(instanceIndex);

      If(visible, () => {
        // SIZE VARIANCE using our random values
        // Height: 0.6-1.2x, Width: 0.7-1.3x
        const baseHeightVar = add(float(0.6), mul(r3, float(0.6)));
        const baseWidthVar = add(float(0.7), mul(r4, float(0.6)));

        // EDGE FALLOFF: Scale down blades where grassiness is lower
        const grassinessScale = grassiness.clamp(float(0.3), float(1.0));
        const heightVariance = mul(baseHeightVar, grassinessScale);
        const widthVariance = mul(baseWidthVar, grassinessScale);

        position.assign(vec4(worldX, worldY, worldZ, heightVariance));

        // Full 360 degree rotation for variety (unique per blade)
        const rotation = mul(r5, float(Math.PI * 2));
        const phase = mul(r6, float(Math.PI * 2));
        // variation: x=rotation, y=widthVariance, z=grassiness (for color), w=phase
        variation.assign(vec4(rotation, widthVariance, grassiness, phase));
      }).Else(() => {
        position.assign(vec4(0, -1000, 0, 0));
        variation.assign(vec4(0, 0, 0, 0));
      });
    });

    // TSL Fn returns a callable that produces a ShaderNodeObject with compute()
    type ComputeCallable = {
      (): { compute: (count: number) => THREE.ComputeNode };
    };
    this.computeNode = (computeFn as ComputeCallable)().compute(
      GRASS_CONFIG.MAX_INSTANCES,
    );
  }

  private createGrassMaterial(): THREE.MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    if (!this.positionsBuffer || !this.variationsBuffer) {
      return material;
    }

    // Blade dimensions - use uniforms for runtime control from debug panel
    const bladeHeight = this.uBladeHeight;
    const bladeWidth = this.uBladeWidth;
    const fadeStartSq = mul(this.uFadeStart, this.uFadeStart);
    const fadeEndSq = mul(this.uFadeEnd, this.uFadeEnd);

    // Wind parameters - use uniforms for runtime control
    const windSpeed = this.uWindSpeed;
    const windStrength = this.uWindStrength;
    const windFreq = float(GRASS_CONFIG.WIND_FREQUENCY);
    const gustSpeed = float(GRASS_CONFIG.GUST_SPEED);
    const flutterIntensity = float(GRASS_CONFIG.FLUTTER_INTENSITY);
    const bladeCurve = float(0.15); // Natural blade curve
    const timeRef = this.uTime;

    // Heightmap sampling params
    const hmWorldSize = float(GRASS_CONFIG.HEIGHTMAP_WORLD_SIZE);

    // Noise texture for terrain color calculation (shared with TerrainShader)
    const noiseTex = this.noiseTextureNode;
    const noiseScale = float(TERRAIN_SHADER_CONSTANTS.NOISE_SCALE); // 0.0008

    // Heightmap texture node (captured for use in Fn callback)
    const heightmapTexNode = this.heightmapTextureNode;

    const positionsRef = this.positionsBuffer;
    const variationsRef = this.variationsBuffer;
    const cameraPosition = this.uCameraPos;
    const cameraForwardRef = this.uCameraForward; // For vertex shader frustum culling

    // Displacer uniforms array
    const [d0Pos, d1Pos, d2Pos, d3Pos, d4Pos, d5Pos, d6Pos, d7Pos] =
      this.displacerUniforms;
    const displacerRadius = this.uDisplacerRadius;
    const displacerStrength = this.uDisplacerStrength;

    const positionLocal = THREE.TSL.positionLocal;

    // VERTEX SHADER with wind animation, blade curve, and cylindrical billboarding
    material.positionNode = Fn(() => {
      const localPos = positionLocal;

      const instancePos = positionsRef.element(instanceIndex);
      const instanceVar = variationsRef.element(instanceIndex);

      const worldX = instancePos.x;
      const worldY = instancePos.y;
      const worldZ = instancePos.z;
      const heightScale = instancePos.w;

      const baseRotation = instanceVar.x; // Random rotation for variation
      const widthScale = instanceVar.y;
      const phase = instanceVar.w; // Per-blade phase offset for wind variation

      // Height along blade (0 at base, 1 at tip)
      const t = localPos.y;
      const tSquared = mul(t, t);

      // Scale blade
      const scaledHeight = mul(bladeHeight, heightScale);
      const scaledWidth = mul(bladeWidth, widthScale);

      // ================================================================
      // CYLINDRICAL BILLBOARDING (Y-axis only)
      // Blade WIDTH faces camera, but BEND is in a fixed world direction
      // This gives each blade 3D volume - never looks flat/thin
      // ================================================================
      const toCameraX = sub(cameraPosition.x, worldX);
      const toCameraZ = sub(cameraPosition.z, worldZ);
      // Billboard angle: blade width perpendicular to camera view
      const billboardAngle = atan(toCameraZ, toCameraX);

      // Small random variation in billboard (±15 degrees) for natural look
      const billboardVariation = mul(
        sub(baseRotation, float(3.14159)),
        float(0.08),
      );
      const facingRotation = add(billboardAngle, billboardVariation);

      // BEND DIRECTION: Fixed per-blade, based on random seed
      // This is independent of camera - gives blade depth/thickness
      const bendDirection = baseRotation; // Use full random rotation for bend

      // ================================================================
      // BLADE CURVE - bends in fixed world direction (not toward camera)
      // This creates 3D volume - blade has thickness from any angle
      // ================================================================
      const curveAmount = mul(bladeCurve, tSquared);

      // ================================================================
      // WIND ANIMATION - Bending from base, not translation
      // Wind causes blade to ROTATE/BEND, not slide sideways
      // ================================================================

      // Wind wave across the field (spatial variation)
      const windWave = mul(add(worldX, mul(worldZ, float(0.7))), windFreq);
      const windTime = add(mul(timeRef, windSpeed), phase);

      // Primary wind bend - smooth sine wave
      const primaryBend = sin(add(windWave, windTime));

      // Secondary harmonic for more organic movement
      const secondaryBend = mul(
        sin(add(mul(windWave, float(2.1)), mul(windTime, float(1.3)))),
        float(0.3),
      );

      // Gusts - slower, stronger pulses
      const gustWave = mul(add(worldX, mul(worldZ, float(0.5))), float(0.015));
      const gustTime = mul(timeRef, gustSpeed);
      const gustPulse = mul(
        add(float(1.0), sin(add(gustWave, gustTime))),
        float(0.5),
      ); // 0-1

      // Per-blade flutter (subtle high-freq)
      const flutterTime = mul(timeRef, float(4.0));
      const flutter = mul(
        sin(add(mul(phase, float(12.0)), flutterTime)),
        flutterIntensity,
      );

      // Combined wind bend amount (radians) - affects blade rotation angle
      // Base strength + gust boost, scaled by windStrength uniform
      const windBendAmount = mul(
        add(primaryBend, add(secondaryBend, flutter)),
        mul(windStrength, add(float(1.0), mul(gustPulse, float(0.5)))),
      );

      // Wind direction - fixed world direction with slight variation
      const windDirectionAngle = add(float(0.5), mul(primaryBend, float(0.15))); // ~30° with variation

      // ================================================================
      // MULTI-DISPLACER SYSTEM - Grass bends away from players/entities
      // Unrolled for 8 displacers (far-away positions = no effect)
      // ================================================================

      // Displacer 0
      const toD0X = sub(worldX, d0Pos.x);
      const toD0Z = sub(worldZ, d0Pos.z);
      const d0Dist = sqrt(add(mul(toD0X, toD0X), mul(toD0Z, toD0Z)));
      const d0Inf = mul(
        smoothstep(displacerRadius, float(0.0), d0Dist),
        displacerStrength,
      );
      const d0PushX = mul(div(toD0X, max(d0Dist, float(0.01))), d0Inf);
      const d0PushZ = mul(div(toD0Z, max(d0Dist, float(0.01))), d0Inf);

      // Displacer 1
      const toD1X = sub(worldX, d1Pos.x);
      const toD1Z = sub(worldZ, d1Pos.z);
      const d1Dist = sqrt(add(mul(toD1X, toD1X), mul(toD1Z, toD1Z)));
      const d1Inf = mul(
        smoothstep(displacerRadius, float(0.0), d1Dist),
        displacerStrength,
      );
      const d1PushX = mul(div(toD1X, max(d1Dist, float(0.01))), d1Inf);
      const d1PushZ = mul(div(toD1Z, max(d1Dist, float(0.01))), d1Inf);

      // Displacer 2
      const toD2X = sub(worldX, d2Pos.x);
      const toD2Z = sub(worldZ, d2Pos.z);
      const d2Dist = sqrt(add(mul(toD2X, toD2X), mul(toD2Z, toD2Z)));
      const d2Inf = mul(
        smoothstep(displacerRadius, float(0.0), d2Dist),
        displacerStrength,
      );
      const d2PushX = mul(div(toD2X, max(d2Dist, float(0.01))), d2Inf);
      const d2PushZ = mul(div(toD2Z, max(d2Dist, float(0.01))), d2Inf);

      // Displacer 3
      const toD3X = sub(worldX, d3Pos.x);
      const toD3Z = sub(worldZ, d3Pos.z);
      const d3Dist = sqrt(add(mul(toD3X, toD3X), mul(toD3Z, toD3Z)));
      const d3Inf = mul(
        smoothstep(displacerRadius, float(0.0), d3Dist),
        displacerStrength,
      );
      const d3PushX = mul(div(toD3X, max(d3Dist, float(0.01))), d3Inf);
      const d3PushZ = mul(div(toD3Z, max(d3Dist, float(0.01))), d3Inf);

      // Displacer 4
      const toD4X = sub(worldX, d4Pos.x);
      const toD4Z = sub(worldZ, d4Pos.z);
      const d4Dist = sqrt(add(mul(toD4X, toD4X), mul(toD4Z, toD4Z)));
      const d4Inf = mul(
        smoothstep(displacerRadius, float(0.0), d4Dist),
        displacerStrength,
      );
      const d4PushX = mul(div(toD4X, max(d4Dist, float(0.01))), d4Inf);
      const d4PushZ = mul(div(toD4Z, max(d4Dist, float(0.01))), d4Inf);

      // Displacer 5
      const toD5X = sub(worldX, d5Pos.x);
      const toD5Z = sub(worldZ, d5Pos.z);
      const d5Dist = sqrt(add(mul(toD5X, toD5X), mul(toD5Z, toD5Z)));
      const d5Inf = mul(
        smoothstep(displacerRadius, float(0.0), d5Dist),
        displacerStrength,
      );
      const d5PushX = mul(div(toD5X, max(d5Dist, float(0.01))), d5Inf);
      const d5PushZ = mul(div(toD5Z, max(d5Dist, float(0.01))), d5Inf);

      // Displacer 6
      const toD6X = sub(worldX, d6Pos.x);
      const toD6Z = sub(worldZ, d6Pos.z);
      const d6Dist = sqrt(add(mul(toD6X, toD6X), mul(toD6Z, toD6Z)));
      const d6Inf = mul(
        smoothstep(displacerRadius, float(0.0), d6Dist),
        displacerStrength,
      );
      const d6PushX = mul(div(toD6X, max(d6Dist, float(0.01))), d6Inf);
      const d6PushZ = mul(div(toD6Z, max(d6Dist, float(0.01))), d6Inf);

      // Displacer 7
      const toD7X = sub(worldX, d7Pos.x);
      const toD7Z = sub(worldZ, d7Pos.z);
      const d7Dist = sqrt(add(mul(toD7X, toD7X), mul(toD7Z, toD7Z)));
      const d7Inf = mul(
        smoothstep(displacerRadius, float(0.0), d7Dist),
        displacerStrength,
      );
      const d7PushX = mul(div(toD7X, max(d7Dist, float(0.01))), d7Inf);
      const d7PushZ = mul(div(toD7Z, max(d7Dist, float(0.01))), d7Inf);

      // Sum all displacer contributions
      const totalPushX = add(
        add(add(d0PushX, d1PushX), add(d2PushX, d3PushX)),
        add(add(d4PushX, d5PushX), add(d6PushX, d7PushX)),
      );
      const totalPushZ = add(
        add(add(d0PushZ, d1PushZ), add(d2PushZ, d3PushZ)),
        add(add(d4PushZ, d5PushZ), add(d6PushZ, d7PushZ)),
      );

      // Scale by height (tips move most)
      const displacerPushX = mul(totalPushX, tSquared);
      const displacerPushZ = mul(totalPushZ, tSquared);

      // ================================================================
      // FINAL POSITION CALCULATION
      // Wind causes blade to BEND from base, tips move most
      // ================================================================

      // Rotation for blade WIDTH (faces camera - billboard)
      const cosFacing = cos(facingRotation);
      const sinFacing = sin(facingRotation);

      // COMBINED BEND: Static curve + wind-induced bend
      // Wind adds to the base bend direction, scaled by height (tips bend more)
      const windBendX = mul(windBendAmount, cos(windDirectionAngle));
      const windBendZ = mul(windBendAmount, sin(windDirectionAngle));

      // Total bend = static curve + wind bend + displacer push
      // Apply more bend higher up the blade (tSquared gives natural arc)
      const totalBendX = add(
        add(mul(curveAmount, cos(bendDirection)), mul(windBendX, tSquared)),
        displacerPushX,
      );
      const totalBendZ = add(
        add(mul(curveAmount, sin(bendDirection)), mul(windBendZ, tSquared)),
        displacerPushZ,
      );

      // Local X offset (blade width) - rotated to face camera
      const rotatedLocalX = mul(localPos.x, cosFacing);
      const rotatedLocalZ = mul(localPos.x, sinFacing);

      // Blade height with bend-induced shortening (when bent, blade appears shorter)
      // This is subtle but makes the bending look more natural
      const bendMagnitude = add(
        mul(totalBendX, totalBendX),
        mul(totalBendZ, totalBendZ),
      );
      const heightReduction = mul(bendMagnitude, float(0.1)); // Slight shortening when bent
      const effectiveHeight = mul(
        scaledHeight,
        sub(float(1.0), heightReduction),
      );

      // Final position: base + width (billboard) + bend offset
      const finalX = add(
        mul(rotatedLocalX, scaledWidth),
        mul(totalBendX, effectiveHeight),
      );
      const finalZ = add(
        mul(rotatedLocalZ, scaledWidth),
        mul(totalBendZ, effectiveHeight),
      );
      const finalY = mul(t, effectiveHeight);

      // ================================================================
      // VERTEX SHADER FRUSTUM CULLING
      // Check if grass is behind camera, if so move off-screen
      // This is done per-frame without recompute, keeping grass stable on rotation
      // ================================================================
      const toCamX = sub(cameraPosition.x, worldX);
      const toCamZ = sub(cameraPosition.z, worldZ);
      const toCamDist = sqrt(add(mul(toCamX, toCamX), mul(toCamZ, toCamZ)));
      const safeDist = max(toCamDist, float(0.1));

      // Direction from grass to camera (normalized XZ)
      const dirToCamX = div(toCamX, safeDist);
      const dirToCamZ = div(toCamZ, safeDist);

      // Camera forward direction (updated every frame via uniform)
      const camFwdX = cameraForwardRef.x;
      const camFwdZ = cameraForwardRef.z;

      // Dot product: negative when grass is in front of camera
      // (grass-to-camera dot camera-forward = negative when camera looks at grass)
      const dotFwd = add(mul(dirToCamX, camFwdX), mul(dirToCamZ, camFwdZ));

      // Grass is visible if:
      // - dot < 0.4 (in front or to the side, within ~113° total cone)
      // - OR distance < 10m (always show nearby grass)
      const inFrustum = dotFwd
        .lessThan(float(0.4))
        .or(toCamDist.lessThan(float(10.0)));

      // If behind camera, move way below ground (efficient GPU cull)
      const cullOffsetY = inFrustum.select(float(0.0), float(-2000.0));

      return vec3(
        add(worldX, finalX),
        add(add(worldY, finalY), cullOffsetY),
        add(worldZ, finalZ),
      );
    })();

    // Fog uniforms - IDENTICAL to TerrainShader.ts
    const fogNearSq = float(
      TERRAIN_SHADER_CONSTANTS.FOG_NEAR * TERRAIN_SHADER_CONSTANTS.FOG_NEAR,
    );
    const fogFarSq = float(
      TERRAIN_SHADER_CONSTANTS.FOG_FAR * TERRAIN_SHADER_CONSTANTS.FOG_FAR,
    );
    const fogColor = vec3(
      TERRAIN_SHADER_CONSTANTS.FOG_COLOR.r,
      TERRAIN_SHADER_CONSTANTS.FOG_COLOR.g,
      TERRAIN_SHADER_CONSTANTS.FOG_COLOR.b,
    );

    // COLOR NODE - Terrain-matched color using SAME algorithm as TerrainShader
    // Samples the shared noise texture and applies identical color calculations
    material.colorNode = Fn(() => {
      const instancePos = positionsRef.element(instanceIndex);
      const uvCoord = uv();
      const heightT = uvCoord.y; // 0 at base, 1 at tip

      const worldX = instancePos.x;
      const worldY = instancePos.y;
      const worldZ = instancePos.z;

      // Sample heightmap for slope data
      const halfWorld = mul(hmWorldSize, float(0.5));
      const hmUvX = add(worldX, halfWorld).div(hmWorldSize);
      const hmUvZ = add(worldZ, halfWorld).div(hmWorldSize);
      const hmUV = vec2(
        hmUvX.clamp(float(0.001), float(0.999)),
        hmUvZ.clamp(float(0.001), float(0.999)),
      );
      const hmSample = heightmapTexNode
        ? heightmapTexNode.uv(hmUV)
        : vec4(0, 1, 0, 1);
      const slope = hmSample.b; // Slope stored in B channel

      // Get actual height from instance position (more accurate)
      const height = worldY;

      // ================================================================
      // TERRAIN COLOR CALCULATION - IDENTICAL TO TerrainShader.ts
      // ================================================================

      // Sample noise texture - SAME as terrain shader
      const noiseUV = mul(vec2(worldX, worldZ), noiseScale);
      const noiseValue = noiseTex ? noiseTex.uv(noiseUV).r : float(0.5);

      // Derived secondary noise (same as terrain: sin(noise * 6.28) * 0.3 + 0.5)
      const noiseValue2 = add(
        mul(sin(mul(noiseValue, float(6.28))), float(0.3)),
        float(0.5),
      );

      // === OSRS-STYLE TERRAIN COLORS (exact match to TerrainShader.ts) ===
      const grassGreen = vec3(0.3, 0.55, 0.15); // Rich green grass
      const grassDark = vec3(0.22, 0.42, 0.1); // Darker grass variation
      const dirtBrown = vec3(0.45, 0.32, 0.18); // Light brown dirt
      const dirtDark = vec3(0.32, 0.22, 0.12); // Dark brown dirt
      const sandYellow = vec3(0.7, 0.6, 0.38); // Sandy beach
      const mudBrown = vec3(0.18, 0.12, 0.08); // Wet mud near water

      // === BASE: GRASS with light/dark variation ===
      const grassVariation = smoothstep(float(0.4), float(0.6), noiseValue2);
      const baseGrassColor = mix(grassGreen, grassDark, grassVariation);

      // === DIRT PATCHES (noise-based, flat ground only) ===
      const dirtThreshold = float(TERRAIN_SHADER_CONSTANTS.DIRT_THRESHOLD); // 0.5
      const dirtPatchFactor = smoothstep(
        sub(dirtThreshold, float(0.05)),
        add(dirtThreshold, float(0.15)),
        noiseValue,
      );
      const flatnessFactor = smoothstep(float(0.3), float(0.05), slope);
      const dirtVariation = smoothstep(float(0.3), float(0.7), noiseValue2);
      const dirtColor = mix(dirtBrown, dirtDark, dirtVariation);
      const withDirtPatches = mix(
        baseGrassColor,
        dirtColor,
        mul(dirtPatchFactor, flatnessFactor),
      );

      // === SLOPE-BASED DIRT (steeper = more dirt) ===
      const withSlopeDirt = mix(
        withDirtPatches,
        dirtColor,
        mul(smoothstep(float(0.15), float(0.5), slope), float(0.6)),
      );

      // === SAND NEAR WATER (flat areas only) ===
      const sandBlend = mul(
        smoothstep(float(10.0), float(6.0), height),
        smoothstep(float(0.25), float(0.0), slope),
      );
      const withSand = mix(
        withSlopeDirt,
        sandYellow,
        mul(sandBlend, float(0.6)),
      );

      // === SHORELINE TRANSITIONS ===
      // Wet dirt zone (8-14m)
      const wetDirtZone = smoothstep(float(14.0), float(8.0), height);
      const withWetDirt = mix(withSand, dirtDark, mul(wetDirtZone, float(0.4)));

      // Mud zone (6-9m)
      const mudZone = smoothstep(float(9.0), float(6.0), height);
      const terrainColor = mix(withWetDirt, mudBrown, mul(mudZone, float(0.7)));

      // ================================================================
      // GRASS-SPECIFIC MODIFICATIONS
      // ================================================================

      // BRIGHTNESS BOOST - lighten the grass compared to terrain
      const brightnessBoost = float(1.5); // 50% brighter than terrain
      const brightenedColor = vec3(
        mul(terrainColor.x, brightnessBoost),
        mul(terrainColor.y, brightnessBoost),
        mul(terrainColor.z, brightnessBoost),
      );

      // Slight brightening toward blade tips (natural grass coloration)
      const tipBrighten = mul(
        smoothstep(float(0.3), float(1.0), heightT),
        float(0.08),
      );

      // Final grass color = brightened terrain color + subtle tip brightening
      const grassColor = vec3(
        add(brightenedColor.x, tipBrighten),
        add(brightenedColor.y, mul(tipBrighten, float(1.1))), // slightly more green at tips
        add(brightenedColor.z, mul(tipBrighten, float(0.3))),
      );

      // Distance calculation for fog
      const dx = sub(worldX, cameraPosition.x);
      const dz = sub(worldZ, cameraPosition.z);
      const distSq = add(mul(dx, dx), mul(dz, dz));

      // === FOG ===
      const fogFactor = smoothstep(fogNearSq, fogFarSq, distSq);

      return mix(grassColor, fogColor, fogFactor);
    })();

    // OPACITY NODE - BOTW-style organic blade shape
    material.opacityNode = Fn(() => {
      const instancePos = positionsRef.element(instanceIndex);
      const uvCoord = uv();
      const u = uvCoord.x;
      const v = uvCoord.y;

      // ORGANIC BLADE SHAPE - wider at base, graceful taper to pointed tip
      // Use smoothstep for natural curve instead of linear taper
      const taperCurve = smoothstep(float(0), float(1.0), v);
      // Width: 0.48 at base, tapering to 0.05 at tip with acceleration
      const bladeHalfWidth = mix(
        float(0.48),
        float(0.05),
        mul(taperCurve, taperCurve),
      );

      // Slight center-offset for asymmetry (more natural)
      const centerOffset = mul(sin(mul(v, float(3.14))), float(0.02));
      const distFromCenter = abs(sub(u, add(float(0.5), centerOffset)));

      // Soft edge falloff for anti-aliasing
      const edgeSoftness = float(0.08);
      const inBlade = sub(
        float(1),
        smoothstep(
          sub(bladeHalfWidth, edgeSoftness),
          bladeHalfWidth,
          distFromCenter,
        ),
      );

      // Very soft bottom fade (grass emerges from ground)
      const bottomFade = smoothstep(float(0), float(0.08), v);

      // Slight tip fade for softness
      const tipFade = sub(float(1), smoothstep(float(0.92), float(1.0), v));

      // Distance fade (smooth falloff at render distance)
      const dx = sub(instancePos.x, cameraPosition.x);
      const dz = sub(instancePos.z, cameraPosition.z);
      const distSq = add(mul(dx, dx), mul(dz, dz));
      const distanceFade = sub(
        float(1.0),
        smoothstep(fadeStartSq, fadeEndSq, distSq),
      );

      return mul(mul(mul(inBlade, bottomFade), tipFade), distanceFade);
    })();

    // Material properties - MATCH TERRAIN EXACTLY
    // TerrainShader uses: roughness = 1.0, metalness = 0.0
    material.roughness = 1.0; // Fully matte - no specular (same as terrain)
    material.metalness = 0.0; // Non-metallic (same as terrain)
    material.side = THREE.DoubleSide;
    material.shadowSide = THREE.DoubleSide; // Ensure proper shadow reception on both sides
    material.transparent = true;
    material.alphaTest = 0.1;
    material.depthWrite = true;
    material.fog = false; // We handle fog in shader

    return material;
  }

  // Track last grid cell indices (integers) for stable comparison
  private lastGridCellX = -999999;
  private lastGridCellZ = -999999;
  // Track the position used for last compute to ensure significant movement
  private lastComputePos = new THREE.Vector3(Infinity, Infinity, Infinity);

  // Minimum camera movement (in meters) before allowing grid scroll
  // This prevents grid updates during orbit camera rotation
  private static readonly GRID_SCROLL_THRESHOLD = 2.0;

  private runCompute(): void {
    if (!this.renderer || !this.computeNode) return;

    const camera = this.world.camera;
    if (!camera) return;

    // SNAP grid origin to cell boundaries using INTEGER cell indices
    const cellSize = GRASS_CONFIG.CELL_SIZE;
    const gridHalfSize = (GRID_CELLS * cellSize) / 2;

    // Calculate integer cell index for grid origin
    const gridCellX = Math.floor((camera.position.x - gridHalfSize) / cellSize);
    const gridCellZ = Math.floor((camera.position.z - gridHalfSize) / cellSize);

    // Convert back to world position
    const snappedX = gridCellX * cellSize;
    const snappedZ = gridCellZ * cellSize;

    this.uGridOrigin.value.set(snappedX, snappedZ);
    this.uCameraPos.value.copy(camera.position);

    // Update camera forward direction for frustum culling
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    this.uCameraForward.value.set(forward.x, 0, forward.z).normalize();

    this.renderer.compute(this.computeNode);

    // Store integer cell indices for stable comparison
    this.lastGridCellX = gridCellX;
    this.lastGridCellZ = gridCellZ;
    this.lastComputePos.copy(camera.position);
  }

  private needsGridScroll(camera: THREE.Camera): boolean {
    // First check: has camera moved significantly since last compute?
    // This prevents grid updates during orbit rotation
    const dx = camera.position.x - this.lastComputePos.x;
    const dz = camera.position.z - this.lastComputePos.z;
    const distSq = dx * dx + dz * dz;
    const thresholdSq = ProceduralGrassSystem.GRID_SCROLL_THRESHOLD ** 2;

    if (distSq < thresholdSq) {
      return false; // Camera hasn't moved enough - don't scroll
    }

    // Calculate current integer cell index
    const cellSize = GRASS_CONFIG.CELL_SIZE;
    const gridHalfSize = (GRID_CELLS * cellSize) / 2;
    const gridCellX = Math.floor((camera.position.x - gridHalfSize) / cellSize);
    const gridCellZ = Math.floor((camera.position.z - gridHalfSize) / cellSize);

    // Compare INTEGER cell indices (no floating point issues)
    return gridCellX !== this.lastGridCellX || gridCellZ !== this.lastGridCellZ;
  }

  private tempForward = new THREE.Vector3();

  update(deltaTime: number): void {
    if (!this.grassInitialized || !this.mesh) return;

    if (this.windEnabled) {
      this.uTime.value += deltaTime;
    }

    const camera = this.world.camera;
    if (!camera) return;

    this.uCameraPos.value.copy(camera.position);

    // Update camera forward for frustum culling
    this.tempForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const forwardXZ = this.tempForward
      .set(this.tempForward.x, 0, this.tempForward.z)
      .normalize();
    this.uCameraForward.value.copy(forwardXZ);

    this.updateDisplacersFromEntities(camera.position);

    // Re-run compute ONLY when grid scrolls (snapped origin changed)
    // Frustum culling is done in vertex shader, so rotation doesn't need recompute
    // This keeps grass positions stable during camera rotation
    if (this.needsGridScroll(camera)) {
      this.runCompute();
    }
  }

  /** Update displacer positions from nearby players and mobs */
  private updateDisplacersFromEntities(cameraPos: THREE.Vector3): void {
    const maxDistSq = 3600; // 60m radius
    let idx = 0;

    const entities = this.world.entities as {
      players?: Map<string, { position?: THREE.Vector3 }>;
      items?: Map<string, { position?: THREE.Vector3; type?: string }>;
    } | null;
    if (!entities) return;

    // Helper to check and add displacer
    const tryAddDisplacer = (position: THREE.Vector3 | undefined) => {
      if (idx >= GRASS_CONFIG.MAX_DISPLACERS || !position) return;
      const dx = position.x - cameraPos.x;
      const dz = position.z - cameraPos.z;
      if (dx * dx + dz * dz <= maxDistSq) {
        this.displacerUniforms[idx++].value.copy(position);
      }
    };

    // Players
    entities.players?.forEach((p) => tryAddDisplacer(p.position));

    // Mobs/NPCs
    entities.items?.forEach((item) => {
      const type = item.type?.toLowerCase() ?? "";
      if (
        type.includes("mob") ||
        type.includes("npc") ||
        type.includes("player")
      ) {
        tryAddDisplacer(item.position);
      }
    });

    // Clear unused displacers
    for (let i = idx; i < GRASS_CONFIG.MAX_DISPLACERS; i++) {
      this.displacerUniforms[i].value.set(99999, 0, 99999);
    }
  }

  private scheduleHeightmapRefresh(): void {
    if (!this.grassInitialized) return;
    if (this.heightmapRefreshTimeout !== null) return;

    this.heightmapRefreshTimeout = setTimeout(() => {
      this.heightmapRefreshTimeout = null;
      this.updateHeightmap()
        .then(() => {
          this.createComputeShader();
          this.runCompute();
        })
        .catch(() => {
          console.warn("[ProceduralGrass] Heightmap refresh failed");
        });
    }, 200);
  }

  /**
   * Update heightmap texture (call when terrain changes)
   */
  async updateHeightmap(): Promise<void> {
    await this.generateHeightmapTexture();
  }

  /** Lazily acquire building collision service from TownSystem */
  private tryAcquireBuildingCollisionService(): void {
    if (this.buildingCollisionService) return;
    const townSystem = this.world.getSystem("towns") as {
      getCollisionService?: () => BuildingCollisionService;
    } | null;
    this.buildingCollisionService = townSystem?.getCollisionService?.() ?? null;
  }

  /** Check if a world position is inside a building */
  private isInsideBuilding(worldX: number, worldZ: number): boolean {
    this.tryAcquireBuildingCollisionService();
    if (!this.buildingCollisionService) return false;
    const result = this.buildingCollisionService.queryCollision(
      Math.floor(worldX),
      Math.floor(worldZ),
      0,
    );
    return result.isInsideBuilding;
  }

  getActiveInstanceCount(): number {
    return GRASS_CONFIG.MAX_INSTANCES;
  }

  static getConfig(): typeof GRASS_CONFIG {
    return GRASS_CONFIG;
  }

  // ============================================================================
  // DEBUG CONTROLS - For GrassDebugPanel
  // ============================================================================

  /** Get the grass mesh for visibility control */
  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }

  /** Set grass visibility */
  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.visible = visible;
    }
  }

  /** Check if grass is visible */
  isVisible(): boolean {
    return this.mesh?.visible ?? false;
  }

  /** Get current time uniform (for wind animation) */
  getTime(): number {
    return this.uTime.value;
  }

  /** Pause/resume wind animation */
  setWindEnabled(enabled: boolean): void {
    this.windEnabled = enabled;
  }

  /** Check if wind is enabled */
  isWindEnabled(): boolean {
    return this.windEnabled;
  }

  // ============================================================================
  // SHADER PARAMETER SETTERS - Real-time control from debug panel
  // ============================================================================

  /** Set wind strength (0-0.5 typical) */
  setWindStrength(value: number): void {
    this.uWindStrength.value = value;
  }

  /** Get current wind strength */
  getWindStrength(): number {
    return this.uWindStrength.value;
  }

  /** Set wind speed (0-1 typical) */
  setWindSpeed(value: number): void {
    this.uWindSpeed.value = value;
  }

  /** Get current wind speed */
  getWindSpeed(): number {
    return this.uWindSpeed.value;
  }

  /** Set blade height in meters (0.1-0.6 typical) */
  setBladeHeight(value: number): void {
    this.uBladeHeight.value = value;
  }

  /** Get current blade height */
  getBladeHeight(): number {
    return this.uBladeHeight.value;
  }

  /** Set blade width in meters (0.01-0.05 typical) */
  setBladeWidth(value: number): void {
    this.uBladeWidth.value = value;
  }

  /** Get current blade width */
  getBladeWidth(): number {
    return this.uBladeWidth.value;
  }

  /** Set fade start distance in meters */
  setFadeStart(value: number): void {
    this.uFadeStart.value = value;
  }

  /** Get current fade start distance */
  getFadeStart(): number {
    return this.uFadeStart.value;
  }

  /** Set fade end distance in meters */
  setFadeEnd(value: number): void {
    this.uFadeEnd.value = value;
  }

  /** Get current fade end distance */
  getFadeEnd(): number {
    return this.uFadeEnd.value;
  }

  // ================================================================
  // DISPLACER CONTROLS (grass bends away from players/entities)
  // ================================================================

  /** Update all displacers at once. Unused slots are set to infinity. */
  setDisplacers(positions: THREE.Vector3[]): void {
    const count = Math.min(positions.length, GRASS_CONFIG.MAX_DISPLACERS);
    for (let i = 0; i < GRASS_CONFIG.MAX_DISPLACERS; i++) {
      if (i < count) {
        this.displacerUniforms[i].value.copy(positions[i]);
      } else {
        this.displacerUniforms[i].value.set(99999, 0, 99999);
      }
    }
  }

  /** Set a single displacer position by index (0-7) */
  setDisplacerPosition(index: number, position: THREE.Vector3): void {
    if (index >= 0 && index < GRASS_CONFIG.MAX_DISPLACERS) {
      this.displacerUniforms[index].value.copy(position);
    }
  }

  /** Set the first displacer (typically the local player) */
  setPlayerPosition(x: number, y: number, z: number): void {
    this.displacerUniforms[0].value.set(x, y, z);
  }

  /** Set the first displacer from Vector3 */
  setPlayerPositionVec3(position: THREE.Vector3): void {
    this.displacerUniforms[0].value.copy(position);
  }

  /** Clear a displacer by moving it far away */
  clearDisplacer(index: number): void {
    if (index >= 0 && index < GRASS_CONFIG.MAX_DISPLACERS) {
      this.displacerUniforms[index].value.set(99999, 0, 99999);
    }
  }

  /** Clear all displacers */
  clearAllDisplacers(): void {
    this.displacerUniforms.forEach((u) => u.value.set(99999, 0, 99999));
  }

  setDisplacerRadius(radius: number): void {
    this.uDisplacerRadius.value = radius;
  }

  getDisplacerRadius(): number {
    return this.uDisplacerRadius.value;
  }

  setDisplacerStrength(strength: number): void {
    this.uDisplacerStrength.value = strength;
  }

  getDisplacerStrength(): number {
    return this.uDisplacerStrength.value;
  }

  getMaxDisplacers(): number {
    return GRASS_CONFIG.MAX_DISPLACERS;
  }

  stop(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh = null;
    this.heightmapTexture?.dispose();
    this.heightmapTexture = null;
    this.heightmapTextureNode = null;
    // Note: noiseTexture is shared with TerrainShader, don't dispose
    this.noiseTexture = null;
    this.noiseTextureNode = null;
    if (this.heightmapRefreshTimeout !== null) {
      clearTimeout(this.heightmapRefreshTimeout);
      this.heightmapRefreshTimeout = null;
    }
    this.grassInitialized = false;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Smoothstep helper matching GLSL smoothstep */
function smoothstepJS(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
