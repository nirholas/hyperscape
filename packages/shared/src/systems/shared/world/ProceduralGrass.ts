/**
 * ProceduralGrass.ts - GPU Grass with Heightmap Texture Sampling
 *
 * Architecture:
 * 1. TerrainSystem provides heightmap texture (baked from noise)
 * 2. Compute shader samples heightmap for grass Y positions
 * 3. Grass rendered as instanced cross-billboards
 *
 * Zero CPU height sampling. GPU reads heightmap texture directly.
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
  cameraPosition,
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

// Import TSL functions for GPU compute
const { storage, hash } = THREE.TSL;

// ============================================================================
// CONFIGURATION
// ============================================================================

// ============================================================================
// GRASS CONFIGURATION - Dense near, sparse far, LONG draw distance
// ============================================================================
// 8×8 = 64 blades per cell for good base density
const SUB_CELLS_PER_AXIS = 8; // 8×8 = 64 stratified positions per cell
const SUB_CELLS_TOTAL = SUB_CELLS_PER_AXIS * SUB_CELLS_PER_AXIS; // 64
const MAX_INSTANCES = 2500000; // 2.5M instances for long draw distance
const GRID_CELLS = Math.floor(Math.sqrt(MAX_INSTANCES / SUB_CELLS_TOTAL)); // ~198 cells
const CELL_SIZE = 0.55; // 55cm cells with 64 blades = ~212 blades/m² base
// Coverage: 198 * 0.55 = 109m, ~55m radius
const GRID_RADIUS = (GRID_CELLS * CELL_SIZE) / 2;

// Jitter amount: 250% of cell size for massive overlap to hide grid
const JITTER_AMOUNT = 2.5; // Blades can move ±250% of cell size

// For compatibility
const BLADES_PER_CELL = SUB_CELLS_TOTAL;

// AGGRESSIVE falloff - VERY dense near (100%), sparse far (5% at 50m)
// Creates strong near vs far contrast
const DENSITY_FALLOFF_RATE = 0.1;

const GRASS_CONFIG = {
  MAX_INSTANCES: GRID_CELLS * GRID_CELLS * SUB_CELLS_TOTAL, // ~600k instances
  GRID_CELLS: GRID_CELLS,
  GRID_RADIUS: GRID_RADIUS,
  CELL_SIZE: CELL_SIZE,
  SUB_CELLS_PER_AXIS: SUB_CELLS_PER_AXIS,
  SUB_CELLS_TOTAL: SUB_CELLS_TOTAL,
  DENSITY_FALLOFF_RATE: DENSITY_FALLOFF_RATE,
  BLADE_HEIGHT: 0.5, // Blade height
  BLADE_WIDTH: 0.12, // Blade width
  FADE_START: 45, // Start opacity fade at 45m
  FADE_END: 53, // Fully faded by 53m (within 55m radius)
  WATER_LEVEL: TERRAIN_CONSTANTS.WATER_CUTOFF,
  COMPUTE_UPDATE_THRESHOLD: 2,

  // Heightmap config
  HEIGHTMAP_SIZE: 1024,
  HEIGHTMAP_WORLD_SIZE: 800,
  MAX_HEIGHT: 50,

  // Wind animation - BOTW-style gentle sway
  WIND_SPEED: 0.3, // Primary wind wave speed
  WIND_STRENGTH: 0.15, // Base sway amount (subtle)
  WIND_FREQUENCY: 0.06, // Spatial frequency of wind waves
  GUST_SPEED: 0.08, // How fast gusts travel through
  FLUTTER_INTENSITY: 0.04, // Per-blade micro-movement
} as const;

// Calculate effective density
const baseDensity = SUB_CELLS_TOTAL / (CELL_SIZE * CELL_SIZE);
console.log(
  `[ProceduralGrass] Config: ${GRASS_CONFIG.MAX_INSTANCES.toLocaleString()} instances, ${GRID_RADIUS.toFixed(1)}m radius, ${SUB_CELLS_PER_AXIS}×${SUB_CELLS_PER_AXIS} stratified (~${baseDensity.toFixed(0)} blades/m² base), exp falloff rate=${DENSITY_FALLOFF_RATE}`,
);

// ============================================================================
// GRASS BLADE GEOMETRY - BILLBOARDED
// Single blade that uses GPU cylindrical billboarding to always face camera
// More efficient than cross-billboards and looks better with proper billboarding
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

export class ProceduralGrassSystem extends System {
  private mesh: THREE.InstancedMesh | null = null;
  private renderer: THREE.WebGPURenderer | null = null;

  // GPU storage buffers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private positionsBuffer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private variationsBuffer: any = null;

  // Heightmap texture (received from TerrainSystem)
  private heightmapTexture: THREE.DataTexture | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private heightmapTextureNode: any = null;

  // Shared noise texture from TerrainShader (for grass color matching)
  private noiseTexture: THREE.DataTexture | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private noiseTextureNode: any = null;

  // Compute node
  private computeNode: THREE.ComputeNode | null = null;

  // Uniforms - Core
  private uCameraPos = uniform(new THREE.Vector3());
  private uTime = uniform(0);
  private uGridOrigin = uniform(new THREE.Vector2());

  // Uniforms - Controllable from debug panel (cast to number to avoid literal type inference)
  private uWindStrength = uniform(GRASS_CONFIG.WIND_STRENGTH as number);
  private uWindSpeed = uniform(GRASS_CONFIG.WIND_SPEED as number);
  private uBladeHeight = uniform(GRASS_CONFIG.BLADE_HEIGHT as number); // 0.5m default
  private uBladeWidth = uniform(GRASS_CONFIG.BLADE_WIDTH as number); // 0.06m default
  private uFadeStart = uniform(GRASS_CONFIG.FADE_START as number); // 90m default
  private uFadeEnd = uniform(GRASS_CONFIG.FADE_END as number); // 100m default

  // Multi-displacer system - grass bends away from players/entities
  private static readonly MAX_DISPLACERS = 8;
  // Array of vec3 uniforms for displacer positions
  private uDisplacer0 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer1 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer2 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer3 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer4 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer5 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer6 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacer7 = uniform(new THREE.Vector3(99999, 0, 99999));
  private uDisplacerCount = uniform(0);
  private uDisplacerRadius = uniform(0.9); // Radius of displacement effect
  private uDisplacerStrength = uniform(0.9); // How much grass bends (0-1)

  private lastUpdatePos = new THREE.Vector3(Infinity, 0, Infinity);
  private grassInitialized = false;
  private heightmapRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private terrainSystem: TerrainSystemInterface | null = null;
  private roadNetworkSystem: RoadNetworkSystemInterface | null = null;

  // Building collision service for excluding grass inside buildings
  private buildingCollisionService: {
    queryCollision: (
      tileX: number,
      tileZ: number,
      floorIndex: number,
    ) => { isInsideBuilding: boolean };
  } | null = null;

  constructor(world: World) {
    super(world);
  }

  async start(): Promise<void> {
    console.log("[ProceduralGrass] START - GPU Grass with Heightmap Sampling");

    if (!this.world.isClient || typeof window === "undefined") {
      return;
    }

    const graphics = this.world.getSystem("graphics") as {
      renderer?: THREE.WebGPURenderer;
    } | null;
    if (graphics?.renderer) {
      this.renderer = graphics.renderer;
    }

    // Get terrain system for heightmap
    this.terrainSystem = this.world.getSystem(
      "terrain",
    ) as TerrainSystemInterface | null;
    this.roadNetworkSystem = this.world.getSystem(
      "roadNetwork",
    ) as RoadNetworkSystemInterface | null;

    // Get building collision service from TownSystem
    this.tryAcquireBuildingCollisionService();

    this.world.on(
      EventType.TERRAIN_TILE_REGENERATED,
      (payload: { reason: "flat_zone" | "road" | "other" }) => {
        if (payload.reason !== "flat_zone") return;
        this.scheduleHeightmapRefresh();
      },
    );

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

    if (!this.renderer) {
      const graphics = this.world.getSystem("graphics") as {
        renderer?: THREE.WebGPURenderer;
      } | null;
      if (graphics?.renderer) {
        this.renderer = graphics.renderer;
      }
    }

    if (!this.renderer) {
      console.warn("[ProceduralGrass] No WebGPU renderer available");
      return;
    }

    // Create or get heightmap texture
    await this.setupHeightmapTexture();

    if (!this.heightmapTexture) {
      console.warn("[ProceduralGrass] No heightmap texture, deferring init");
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

    // Create compute shader
    this.createComputeShader();

    // Create material and mesh
    const material = this.createGrassMaterial();
    const geometry = createGrassTuftGeometry(); // Multi-blade tufts visible from all angles

    this.mesh = new THREE.InstancedMesh(
      geometry,
      material,
      GRASS_CONFIG.MAX_INSTANCES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.name = "ProceduralGrass_GPU";

    // Initialize instance matrices (faster than setMatrixAt in a loop)
    const matrixArray = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < GRASS_CONFIG.MAX_INSTANCES; i++) {
      const offset = i * 16;
      matrixArray[offset] = 1;
      matrixArray[offset + 5] = 1;
      matrixArray[offset + 10] = 1;
      matrixArray[offset + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.mesh.position.set(0, 0, 0);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      10000,
    );

    stage.scene.add(this.mesh);
    this.grassInitialized = true;

    console.log(
      `[ProceduralGrass] Initialized with heightmap: ${GRASS_CONFIG.MAX_INSTANCES} instances`,
    );

    // Run compute immediately after init
    const camera = this.world.camera;
    if (camera) {
      console.log(
        `[ProceduralGrass] Initial camera position: ${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
      );
      this.runCompute();
      this.lastUpdatePos.copy(camera.position);
    }
  }

  /**
   * Setup heightmap texture - either get from TerrainSystem or generate
   */
  private async setupHeightmapTexture(): Promise<void> {
    // Get or generate the shared noise texture from TerrainShader
    // This ensures grass color matches terrain exactly
    this.noiseTexture = generateNoiseTexture();
    this.noiseTextureNode = THREE.TSL.texture(this.noiseTexture);
    console.log("[ProceduralGrass] Using shared TerrainShader noise texture");

    // Try to get heightmap from terrain system
    if (
      this.terrainSystem &&
      typeof this.terrainSystem.getHeightmapTexture === "function"
    ) {
      this.heightmapTexture = this.terrainSystem.getHeightmapTexture();
      if (this.heightmapTexture) {
        this.heightmapTextureNode = THREE.TSL.texture(this.heightmapTexture);
        console.log("[ProceduralGrass] Using TerrainSystem heightmap");
        return;
      }
    }

    // Generate our own heightmap by sampling terrain
    console.log("[ProceduralGrass] Generating heightmap from terrain...");
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

    console.log(
      `[ProceduralGrass] Generating ${size}x${size} heightmap + grassiness (world size: ${worldSize}m)...`,
    );

    let minH = Infinity,
      maxH = -Infinity;
    let grassyPixels = 0;
    let dirtExcluded = 0;
    let slopeExcluded = 0;
    let waterExcluded = 0;

    // Sample terrain heights, grassiness into RGBA float texture
    const rgbaHeightData = new Float32Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Convert texture coords to world coords (centered at origin)
        const worldX = (x / size) * worldSize - halfWorld;
        const worldZ = (y / size) * worldSize - halfWorld;

        // Get height from terrain system
        let height = 0;
        let slope = 0;
        try {
          height = this.terrainSystem.getHeightAt(worldX, worldZ);
          // Estimate slope from neighboring heights
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
        } catch {
          height = 0;
          slope = 0;
        }

        // Track min/max for debugging
        if (height < minH) minH = height;
        if (height > maxH) maxH = height;

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
          grassiness -= dirtPatchFactor * flatnessFactor * 0.9; // Strong exclusion on dirt
          if (dirtPatchFactor * flatnessFactor > 0.5) dirtExcluded++;
        }

        // No grass on roads
        if (
          grassiness > 0 &&
          this.roadNetworkSystem &&
          typeof this.roadNetworkSystem.isOnRoad === "function"
        ) {
          if (this.roadNetworkSystem.isOnRoad(worldX, worldZ)) {
            grassiness = 0;
          }
        }

        // No grass in flat zones (buildings, duel areas, stations)
        if (grassiness > 0) {
          const flatZone = this.terrainSystem.getFlatZoneAt?.(worldX, worldZ);
          if (
            flatZone ||
            (this.terrainSystem.isInFlatZone &&
              this.terrainSystem.isInFlatZone(worldX, worldZ))
          ) {
            grassiness = 0;
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
          if (slopeFactor > 0.5) slopeExcluded++;
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
          if (edgeZone > 0.5) waterExcluded++;
        }

        // === SNOW AT HIGH ELEVATION ===
        const snowHeight = TERRAIN_SHADER_CONSTANTS.SNOW_HEIGHT; // 50
        if (grassiness > 0 && height > snowHeight - 5) {
          const snowFactor = smoothstepJS(snowHeight - 5, 60, height);
          grassiness = Math.max(0, grassiness - snowFactor);
        }

        if (grassiness > 0.5) grassyPixels++;

        // Store in RGBA float texture: R = height, G = grassiness, B = slope
        const normalized = Math.max(0, Math.min(1, height / maxHeight));
        const idx = (y * size + x) * 4;
        rgbaHeightData[idx + 0] = normalized; // R = height
        rgbaHeightData[idx + 1] = Math.max(0, Math.min(1, grassiness)); // G = grassiness
        rgbaHeightData[idx + 2] = Math.min(1, slope); // B = slope (for GPU color calc)
        rgbaHeightData[idx + 3] = 1;
      }
    }

    const totalPixels = size * size;
    console.log(
      `[ProceduralGrass] Heights: min=${minH.toFixed(1)}m, max=${maxH.toFixed(1)}m`,
    );
    console.log(
      `[ProceduralGrass] Grassy area: ${((grassyPixels / totalPixels) * 100).toFixed(1)}%`,
    );
    console.log(
      `[ProceduralGrass] Exclusions - dirt: ${((dirtExcluded / totalPixels) * 100).toFixed(1)}%, slope: ${((slopeExcluded / totalPixels) * 100).toFixed(1)}%, water: ${((waterExcluded / totalPixels) * 100).toFixed(1)}%`,
    );

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

    console.log(
      `[ProceduralGrass] Heightmap texture ready (color sampled from shared noise in GPU)`,
    );
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
    const gridRadius = float(GRASS_CONFIG.GRID_RADIUS);
    const waterLevel = float(GRASS_CONFIG.WATER_LEVEL);
    const maxDistSq = float(GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END);
    const hmWorldSize = float(GRASS_CONFIG.HEIGHTMAP_WORLD_SIZE);
    const hmMaxHeight = float(GRASS_CONFIG.MAX_HEIGHT);

    const positionsRef = this.positionsBuffer;
    const variationsRef = this.variationsBuffer;
    const cameraRef = this.uCameraPos;
    const gridOriginRef = this.uGridOrigin;

    // Create texture node for use in compute shader
    const heightmapTexNode = THREE.TSL.texture(this.heightmapTexture);

    // Stratified sampling constants
    const subCellsPerAxis = float(GRASS_CONFIG.SUB_CELLS_PER_AXIS);
    const subCellsTotal = float(GRASS_CONFIG.SUB_CELLS_TOTAL);
    const subCellSize = cellSize.div(subCellsPerAxis);
    const falloffRate = float(GRASS_CONFIG.DENSITY_FALLOFF_RATE);
    const gridCellsFloat = float(GRASS_CONFIG.GRID_CELLS);

    const computeFn = Fn(() => {
      const idx = float(instanceIndex);

      // ================================================================
      // STRATIFIED PLACEMENT WITH MASSIVE JITTER
      // Sub-cells provide even base distribution (no clumping)
      // Massive jitter (±100% cell) makes cells completely intermingle
      // ================================================================

      // Decompose instance into cell + sub-cell
      const bladeIdx = idx.mod(subCellsTotal);
      const cellIdx = floor(idx.div(subCellsTotal));

      // Grid cell coordinates
      const cellX = cellIdx.mod(gridCellsFloat);
      const cellZ = floor(cellIdx.div(gridCellsFloat));

      // Sub-cell position within cell (6×6 grid)
      const subX = bladeIdx.mod(subCellsPerAxis);
      const subZ = floor(bladeIdx.div(subCellsPerAxis));

      // Cell corner in world space
      const cellWorldX = add(gridOriginRef.x, mul(cellX, cellSize));
      const cellWorldZ = add(gridOriginRef.y, mul(cellZ, cellSize));

      // Sub-cell size
      const subCellSize = cellSize.div(subCellsPerAxis);

      // Sub-cell center (stratified base position - evenly distributed)
      const subCellCenterX = add(
        cellWorldX,
        mul(add(subX, float(0.5)), subCellSize),
      );
      const subCellCenterZ = add(
        cellWorldZ,
        mul(add(subZ, float(0.5)), subCellSize),
      );

      // ================================================================
      // WORLD-STABLE RANDOM SEED
      // Based on quantized world position + sub-cell index
      // This ensures the same world location always gets the same random values
      // ================================================================
      const quantX = floor(cellWorldX.div(cellSize));
      const quantZ = floor(cellWorldZ.div(cellSize));

      // Create world-stable seed: cell position + sub-cell index
      // Uses large primes for good hash distribution
      const cellSeed = add(
        mul(quantX, float(73856093)),
        mul(quantZ, float(19349663)),
      );
      const bladeSeed = add(
        cellSeed,
        mul(add(bladeIdx, float(1)), float(83492791)),
      );

      // Generate 6 deterministic random values from the world-stable seed
      // Using golden ratio and irrational multipliers for good distribution
      const phi = float(1.618033988749895);
      const r1 = fract(mul(bladeSeed, float(0.0000001)));
      const r2 = fract(mul(bladeSeed, mul(phi, float(0.0000001))));
      const r3 = fract(
        mul(bladeSeed, mul(float(2.236067977), float(0.0000001))),
      ); // sqrt(5)
      const r4 = fract(
        mul(bladeSeed, mul(float(3.141592654), float(0.0000001))),
      ); // pi
      const r5 = fract(
        mul(bladeSeed, mul(float(2.718281828), float(0.0000001))),
      ); // e
      const r6 = fract(
        mul(bladeSeed, mul(float(1.414213562), float(0.0000001))),
      ); // sqrt(2)

      // ================================================================
      // MASSIVE JITTER - Large random offset to hide grid
      // ================================================================

      // Jitter range: ±(JITTER_AMOUNT * cellSize) = ±2.4m with current settings
      const jitterRange = mul(cellSize, float(JITTER_AMOUNT)); // 0.8 * 3.0 = 2.4m

      // Convert random (0-1) to jitter (-range to +range)
      const jitterX = mul(sub(r1, float(0.5)), mul(jitterRange, float(2.0)));
      const jitterZ = mul(sub(r2, float(0.5)), mul(jitterRange, float(2.0)));

      // Final position: stratified sub-cell center + jitter
      const worldX = add(subCellCenterX, jitterX);
      const worldZ = add(subCellCenterZ, jitterZ);

      // Use remaining hashes for other properties
      const h3 = r5; // For density check
      const h4 = r6; // For size variance

      // Distance from camera
      const dx = sub(worldX, cameraRef.x);
      const dz = sub(worldZ, cameraRef.z);
      const distSq = add(mul(dx, dx), mul(dz, dz));
      const dist = distSq.sqrt();

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
      // EXPONENTIAL DENSITY FALLOFF
      // density = exp(-dist * falloffRate)
      // Smooth, natural gradient - no harsh tier boundaries
      // At falloffRate=0.04: 100% at 0m, 67% at 10m, 45% at 20m, 20% at 40m
      // ================================================================
      const density = THREE.TSL.exp(mul(dist.negate(), falloffRate));
      // Skip threshold: 1 - density (lower density = higher skip chance)
      const skipThreshold = sub(float(1.0), density);
      const passedDensityCheck = h3.greaterThan(skipThreshold);

      // Visibility checks
      const inRange = distSq.lessThan(maxDistSq);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.computeNode = (computeFn as any)().compute(GRASS_CONFIG.MAX_INSTANCES);
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
    const hmMaxHeight = float(GRASS_CONFIG.MAX_HEIGHT);

    // Noise texture for terrain color calculation (shared with TerrainShader)
    const noiseTex = this.noiseTextureNode;
    const noiseScale = float(TERRAIN_SHADER_CONSTANTS.NOISE_SCALE); // 0.0008

    // Heightmap texture node (captured for use in Fn callback)
    const heightmapTexNode = this.heightmapTextureNode;

    const positionsRef = this.positionsBuffer;
    const variationsRef = this.variationsBuffer;
    const cameraPosition = this.uCameraPos;

    // Multi-displacer uniforms (players, mobs, etc)
    const d0Pos = this.uDisplacer0;
    const d1Pos = this.uDisplacer1;
    const d2Pos = this.uDisplacer2;
    const d3Pos = this.uDisplacer3;
    const d4Pos = this.uDisplacer4;
    const d5Pos = this.uDisplacer5;
    const d6Pos = this.uDisplacer6;
    const d7Pos = this.uDisplacer7;
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

      return vec3(
        add(worldX, finalX),
        add(worldY, finalY),
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
    material.transparent = true;
    material.alphaTest = 0.1;
    material.depthWrite = true;
    material.fog = false; // We handle fog in shader

    return material;
  }

  private runCompute(): void {
    if (!this.renderer || !this.computeNode) return;

    const camera = this.world.camera;
    if (!camera) return;

    // SNAP grid origin to cell grid to prevent sub-cell shifting
    // Use ACTUAL grid half-size, not GRID_RADIUS (which may not match!)
    const cellSize = GRASS_CONFIG.CELL_SIZE;
    const gridHalfSize = (GRID_CELLS * cellSize) / 2; // Actual half-width of the grid
    const snappedX =
      Math.floor((camera.position.x - gridHalfSize) / cellSize) * cellSize;
    const snappedZ =
      Math.floor((camera.position.z - gridHalfSize) / cellSize) * cellSize;

    this.uGridOrigin.value.set(snappedX, snappedZ);
    this.uCameraPos.value.copy(camera.position);

    this.renderer.compute(this.computeNode);
  }

  update(deltaTime: number): void {
    if (!this.grassInitialized || !this.mesh) return;

    // Only update time if wind is enabled
    const windEnabled =
      (this as unknown as { _windEnabled?: boolean })._windEnabled ?? true;
    if (windEnabled) {
      this.uTime.value += deltaTime;
    }

    const camera = this.world.camera;
    if (!camera) return;

    this.uCameraPos.value.copy(camera.position);

    // ================================================================
    // UPDATE GRASS DISPLACERS from nearby players/entities
    // ================================================================
    this.updateDisplacersFromEntities(camera.position);

    // Only re-run full compute when camera position changes significantly
    const needsCompute =
      this.lastUpdatePos.x === Infinity ||
      (() => {
        const dx = camera.position.x - this.lastUpdatePos.x;
        const dz = camera.position.z - this.lastUpdatePos.z;
        const distSq = dx * dx + dz * dz;
        const thresholdSq =
          GRASS_CONFIG.COMPUTE_UPDATE_THRESHOLD *
          GRASS_CONFIG.COMPUTE_UPDATE_THRESHOLD;
        return distSq > thresholdSq;
      })();

    if (needsCompute) {
      this.runCompute();
      this.lastUpdatePos.copy(camera.position);
    }
  }

  /** Update displacer positions from nearby players and mobs */
  private updateDisplacersFromEntities(cameraPos: THREE.Vector3): void {
    const maxDistSq = 60 * 60; // Only consider entities within 60m of camera
    let displacerIndex = 0;

    // Get players from world entities
    const entities = this.world.entities;
    if (!entities) return;

    // Iterate over players map if it exists
    const players = (
      entities as { players?: Map<string, { position?: THREE.Vector3 }> }
    ).players;
    if (players) {
      for (const [, player] of players) {
        if (displacerIndex >= ProceduralGrassSystem.MAX_DISPLACERS) break;
        if (!player.position) continue;

        // Check distance from camera
        const dx = player.position.x - cameraPos.x;
        const dz = player.position.z - cameraPos.z;
        if (dx * dx + dz * dz > maxDistSq) continue;

        // Set displacer position
        const u = this.getDisplacerUniform(displacerIndex);
        if (u) {
          u.value.copy(player.position);
          displacerIndex++;
        }
      }
    }

    // Also check mobs/NPCs - items map often contains them
    const items = (
      entities as {
        items?: Map<string, { position?: THREE.Vector3; type?: string }>;
      }
    ).items;
    if (items) {
      for (const [, item] of items) {
        if (displacerIndex >= ProceduralGrassSystem.MAX_DISPLACERS) break;
        if (!item.position) continue;
        // Only include mobs (entities with type containing 'mob' or 'npc')
        const itemType = (item as { type?: string }).type?.toLowerCase() || "";
        if (
          !itemType.includes("mob") &&
          !itemType.includes("npc") &&
          !itemType.includes("player")
        )
          continue;

        // Check distance from camera
        const dx = item.position.x - cameraPos.x;
        const dz = item.position.z - cameraPos.z;
        if (dx * dx + dz * dz > maxDistSq) continue;

        // Set displacer position
        const u = this.getDisplacerUniform(displacerIndex);
        if (u) {
          u.value.copy(item.position);
          displacerIndex++;
        }
      }
    }

    // Clear remaining displacers
    for (
      let i = displacerIndex;
      i < ProceduralGrassSystem.MAX_DISPLACERS;
      i++
    ) {
      const u = this.getDisplacerUniform(i);
      if (u) {
        u.value.set(99999, 0, 99999);
      }
    }

    this.uDisplacerCount.value = displacerIndex;
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

  /**
   * Try to acquire building collision service from TownSystem.
   * Called lazily since TownSystem may not be initialized when this system starts.
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
      console.log("[ProceduralGrass] Acquired building collision service");
    }
  }

  /**
   * Check if a world position is inside a building.
   * Returns true if grass should NOT grow at this position.
   */
  private isInsideBuilding(worldX: number, worldZ: number): boolean {
    if (!this.buildingCollisionService) {
      this.tryAcquireBuildingCollisionService();
    }

    if (!this.buildingCollisionService) {
      return false;
    }

    try {
      const tileX = Math.floor(worldX);
      const tileZ = Math.floor(worldZ);
      const result = this.buildingCollisionService.queryCollision(
        tileX,
        tileZ,
        0,
      );
      return result?.isInsideBuilding ?? false;
    } catch {
      return false;
    }
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

  /** Pause/resume wind animation by stopping time updates */
  setWindEnabled(enabled: boolean): void {
    // Store wind state - when disabled, time stops updating
    (this as unknown as { _windEnabled: boolean })._windEnabled = enabled;
  }

  /** Check if wind is enabled */
  isWindEnabled(): boolean {
    return (this as unknown as { _windEnabled?: boolean })._windEnabled ?? true;
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
  // MULTI-DISPLACER CONTROLS (players, mobs, etc)
  // ================================================================

  /** Get uniform for displacer by index */
  private getDisplacerUniform(index: number) {
    switch (index) {
      case 0:
        return this.uDisplacer0;
      case 1:
        return this.uDisplacer1;
      case 2:
        return this.uDisplacer2;
      case 3:
        return this.uDisplacer3;
      case 4:
        return this.uDisplacer4;
      case 5:
        return this.uDisplacer5;
      case 6:
        return this.uDisplacer6;
      case 7:
        return this.uDisplacer7;
      default:
        return null;
    }
  }

  /**
   * Update all grass displacers at once. Pass an array of positions.
   * Unused slots are automatically set to far away (no effect).
   * Max 8 displacers supported.
   */
  setDisplacers(positions: THREE.Vector3[]): void {
    const count = Math.min(
      positions.length,
      ProceduralGrassSystem.MAX_DISPLACERS,
    );
    this.uDisplacerCount.value = count;

    for (let i = 0; i < ProceduralGrassSystem.MAX_DISPLACERS; i++) {
      const u = this.getDisplacerUniform(i);
      if (u) {
        if (i < count) {
          u.value.copy(positions[i]);
        } else {
          u.value.set(99999, 0, 99999);
        }
      }
    }
  }

  /** Set a single displacer position by index (0-7) */
  setDisplacerPosition(index: number, position: THREE.Vector3): void {
    const u = this.getDisplacerUniform(index);
    if (u) {
      u.value.copy(position);
    }
  }

  /** Convenience: set the first displacer (typically the local player) */
  setPlayerPosition(x: number, y: number, z: number): void {
    this.uDisplacer0.value.set(x, y, z);
    if (this.uDisplacerCount.value < 1) {
      this.uDisplacerCount.value = 1;
    }
  }

  /** Convenience: set the first displacer from Vector3 */
  setPlayerPositionVec3(position: THREE.Vector3): void {
    this.setPlayerPosition(position.x, position.y, position.z);
  }

  /** Clear a displacer by moving it far away */
  clearDisplacer(index: number): void {
    const u = this.getDisplacerUniform(index);
    if (u) {
      u.value.set(99999, 0, 99999);
    }
  }

  /** Clear all displacers */
  clearAllDisplacers(): void {
    for (let i = 0; i < ProceduralGrassSystem.MAX_DISPLACERS; i++) {
      this.clearDisplacer(i);
    }
    this.uDisplacerCount.value = 0;
  }

  /** Set displacement radius (how far the effect extends) */
  setDisplacerRadius(radius: number): void {
    this.uDisplacerRadius.value = radius;
  }

  /** Get current displacement radius */
  getDisplacerRadius(): number {
    return this.uDisplacerRadius.value;
  }

  /** Set displacement strength (0-1, how much grass bends) */
  setDisplacerStrength(strength: number): void {
    this.uDisplacerStrength.value = strength;
  }

  /** Get current displacement strength */
  getDisplacerStrength(): number {
    return this.uDisplacerStrength.value;
  }

  /** Get max number of supported displacers */
  getMaxDisplacers(): number {
    return ProceduralGrassSystem.MAX_DISPLACERS;
  }

  stop(): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (this.heightmapTexture) {
      this.heightmapTexture.dispose();
      this.heightmapTexture = null;
    }
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
// TERRAIN SYSTEM INTERFACE
// ============================================================================

interface TerrainSystemInterface {
  getHeightAt?(worldX: number, worldZ: number): number;
  getHeightmapTexture?(): THREE.DataTexture | null;
  getSlopeAt?(worldX: number, worldZ: number): number;
  isInFlatZone?(worldX: number, worldZ: number): boolean;
  // Returns zone info if in flat zone, null otherwise
  getFlatZoneAt?(worldX: number, worldZ: number): FlatZone | null;
  getTerrainColorAt?(
    worldX: number,
    worldZ: number,
  ): { r: number; g: number; b: number } | null;
}

interface RoadNetworkSystemInterface {
  isOnRoad?(worldX: number, worldZ: number): boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Smoothstep helper (matches GLSL smoothstep) - used in generateHeightmapTexture
function smoothstepJS(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
