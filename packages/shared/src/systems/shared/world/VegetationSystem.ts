/**
 * VegetationSystem.ts - GPU Instanced Vegetation Rendering
 *
 * Provides efficient rendering of vegetation (trees, bushes, grass, flowers, rocks)
 * using Three.js InstancedMesh for batched GPU rendering.
 *
 * **Features:**
 * - GPU-instanced rendering for thousands of vegetation objects in few draw calls
 * - Procedural placement based on biome vegetation configuration
 * - Automatic LOD culling based on player distance
 * - Deterministic placement using seeded PRNG (same vegetation on client/server)
 * - Per-tile vegetation generation synced with terrain system
 * - Noise-based distribution for natural-looking placement
 * - Clustering support for natural groupings of vegetation
 *
 * **Performance:**
 * - Each vegetation type renders in a single draw call via InstancedMesh
 * - Dynamic visibility culling shows closest N instances
 * - Tile-based generation/unloading tied to terrain system
 *
 * **Integration:**
 * - Listens to TerrainSystem tile events for generation triggers
 * - Uses biome vegetation config from biomes.json
 * - Loads asset definitions from vegetation.json manifest
 *
 * **Runs on:** Client only (vegetation is purely visual)
 */

import THREE from "../../../extras/three/three";
import { System } from "..";
import type { World, WorldOptions } from "../../../types";
import type {
  VegetationAsset,
  VegetationLayer,
  VegetationInstance,
  BiomeVegetationConfig,
} from "../../../types/world/world-types";
import { EventType } from "../../../types/events";
import { modelCache } from "../../../utils/rendering/ModelCache";
import { NoiseGenerator } from "../../../utils/NoiseGenerator";
import {
  createGPUVegetationMaterial,
  type GPUVegetationMaterial,
} from "./GPUVegetation";

/**
 * Instanced asset data - tracks one InstancedMesh per loaded GLB
 */
interface InstancedAssetData {
  /** The GLB model scene (cloned for instancing) */
  geometry: THREE.BufferGeometry;
  /** Material(s) from the model */
  material: THREE.Material | THREE.Material[];
  /** The InstancedMesh for GPU batching */
  instancedMesh: THREE.InstancedMesh;
  /** Map from instance ID to matrix index */
  instanceMap: Map<string, number>;
  /** Reverse map: matrix index to instance data */
  instances: VegetationInstance[];
  /** Maximum instances this mesh can hold */
  maxInstances: number;
  /** Current active instance count */
  activeCount: number;
  /** Asset definition */
  asset: VegetationAsset;
  /** Y offset to lift model so its base sits on terrain (computed from bounding box) */
  modelBaseOffset: number;

  /** GPU instance attributes (shader handles all transforms) */
  gpuMaterial?: GPUVegetationMaterial;
  positionAttr?: THREE.InstancedBufferAttribute;
  scaleAttr?: THREE.InstancedBufferAttribute;
  rotationAttr?: THREE.InstancedBufferAttribute;
}

/**
 * Tile vegetation data - tracks all instances for a terrain tile
 */
interface TileVegetationData {
  /** Tile key (format: "tileX_tileZ") */
  key: string;
  /** All instances in this tile, keyed by instance ID */
  instances: Map<string, VegetationInstance>;
  /** Whether this tile's vegetation has been generated */
  generated: boolean;
  /** Biome this tile belongs to */
  biome: string;
}

/**
 * Configuration for the vegetation system
 */
interface VegetationConfig {
  /** Maximum visible instances per asset type */
  maxInstancesPerAsset: number;
  /** Distance beyond which vegetation is culled */
  cullDistance: number;
  /** Distance at which to switch to imposters (billboards) */
  imposterDistance: number;
  /** How often to update visibility (ms) */
  updateInterval: number;
  /** Minimum player movement to trigger visibility update */
  movementThreshold: number;
}

const DEFAULT_CONFIG: VegetationConfig = {
  maxInstancesPerAsset: 4096, // Power of 2 for GPU efficiency
  cullDistance: 280, // Used for tile loading - must be > fadeEnd (250m) so vegetation loads before visible
  imposterDistance: 120, // Not used in GPU mode (shader handles LOD)
  updateInterval: 100, // Not used in GPU mode
  movementThreshold: 2, // Not used in GPU mode
};

// LOD distances per category
// fadeStart = fully opaque, fadeEnd = fully invisible
// Tile spawn radius is 3 tiles = 300m, so fadeStart must be > 300m to prevent pop-in
const LOD_CONFIG = {
  tree: { fadeStart: 180, fadeEnd: 250, imposterStart: 120 },
  bush: { fadeStart: 140, fadeEnd: 200, imposterStart: 90 },
  flower: { fadeStart: 100, fadeEnd: 150, imposterStart: 60 },
  fern: { fadeStart: 100, fadeEnd: 150, imposterStart: 60 },
  rock: { fadeStart: 180, fadeEnd: 250, imposterStart: 120 },
  fallen_tree: { fadeStart: 160, fadeEnd: 220, imposterStart: 100 },
} as const;

/** Max tile distance from player to generate vegetation (in tiles, not world units) */
// 3 tiles = 300m diagonal (~212m per axis), must be > fadeEnd to load before visible
const MAX_VEGETATION_TILE_RADIUS = 3;

/** Water level in world units - MUST match TerrainSystem.CONFIG.WATER_THRESHOLD */
const WATER_LEVEL = 5.4;

/** Buffer distance from water edge where vegetation shouldn't spawn - generous buffer */
const WATER_EDGE_BUFFER = 6.0; // Min spawn height = 11.4 - well above any shoreline

/** Grass only spawns on terrain above this height (relative, for grass texture) */
const _GRASS_MIN_TERRAIN_HEIGHT = 0.2; // Normalized height - grass areas are higher

// ============================================================================
// TSL GRASS - WebGPU compatible using MeshStandardNodeMaterial
// ============================================================================

import {
  createGrassBladeGeometry,
  createGrassMaterial,
  GRASS_CONFIG,
  type GrassUniforms,
} from "./GrassShader";
import { getNoiseTexture, generateNoiseTexture } from "./TerrainShader";

/** GPU Grass - total instances = GRID_SIZE^2 * BLADES_PER_CELL */
const GPU_GRASS_INSTANCES =
  GRASS_CONFIG.GRID_SIZE *
  GRASS_CONFIG.GRID_SIZE *
  GRASS_CONFIG.BLADES_PER_CELL;

/**
 * Data structure for a grass chunk - holds geometry for one area of grass (legacy, unused)
 */
interface _GrassChunkData {
  key: string;
  mesh: THREE.Mesh;
  tileX: number;
  tileZ: number;
}

/**
 * Imposter data for billboard rendering of distant vegetation
 */
interface ImposterData {
  /** Billboard mesh for this asset type */
  billboardMesh: THREE.InstancedMesh;
  /** Maximum billboard instances */
  maxBillboards: number;
  /** Current billboard count */
  activeCount: number;
}

/**
 * VegetationSystem - GPU Instanced Vegetation Rendering
 */
export class VegetationSystem extends System {
  private scene: THREE.Scene | null = null;
  private vegetationGroup: THREE.Group | null = null;

  // Asset management
  private assetDefinitions = new Map<string, VegetationAsset>();
  private loadedAssets = new Map<string, InstancedAssetData>();
  private pendingAssetLoads = new Set<string>();

  // Imposter (billboard) management
  private imposters = new Map<string, ImposterData>();
  private billboardGeometry: THREE.PlaneGeometry | null = null;

  // Pre-rendered imposter textures (cached per asset)
  private imposterTextures = new Map<string, THREE.Texture>();
  private imposterRenderTarget: THREE.WebGLRenderTarget | null = null;
  private imposterCamera: THREE.OrthographicCamera | null = null;
  private imposterScene: THREE.Scene | null = null;

  // Tile vegetation tracking
  private tileVegetation = new Map<string, TileVegetationData>();

  // Pending tiles that are too far from player (lazy loading queue)
  private pendingTiles = new Map<
    string,
    { tileX: number; tileZ: number; biome: string }
  >();

  // TSL GRASS - Single InstancedMesh follows player
  private grassBladeGeometry: THREE.BufferGeometry | null = null;
  private grassMaterial:
    | (THREE.Material & { grassUniforms: GrassUniforms })
    | null = null;
  private grassMesh: THREE.InstancedMesh | null = null;
  private grassGroup: THREE.Group | null = null;
  // GPU grass - no CPU matrix buffer needed
  private grassTime = 0;

  // Configuration
  private config: VegetationConfig = DEFAULT_CONFIG;

  // Noise generator for procedural placement
  private noise: NoiseGenerator | null = null;

  // Temp objects to avoid allocations
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();
  private _tempEuler = new THREE.Euler();
  private _dummy = new THREE.Object3D();
  private _billboardQuat = new THREE.Quaternion();
  // Pre-allocated vectors for hot loops to avoid GC pressure
  private _yAxis = new THREE.Vector3(0, 1, 0);
  private _origin = new THREE.Vector3(0, 0, 0);
  private _lookAtMatrix = new THREE.Matrix4();
  private _lastGrassLog = 0;
  // Spatial hash for O(1) nearby instance lookup
  private _spatialHash = new Map<string, number[]>();
  private readonly SPATIAL_CELL_SIZE = 50; // 50 unit cells

  constructor(world: World) {
    super(world);
  }

  override getDependencies() {
    return { required: ["stage", "terrain"] };
  }

  async init(_options?: WorldOptions): Promise<void> {
    // Client-only system
    if (!this.world.isClient || typeof window === "undefined") {
      return;
    }

    // Initialize noise generator with world seed
    const seed = this.computeSeedFromWorldId();
    this.noise = new NoiseGenerator(seed);

    // Create shared billboard geometry for imposters (1x1 plane)
    this.billboardGeometry = new THREE.PlaneGeometry(1, 1);

    // Create grass blade geometry using the shader module
    this.grassBladeGeometry = createGrassBladeGeometry();

    // Grass material will be created in start() after terrain textures are loaded

    // Note: Asset definitions are loaded in start() after world.assetsUrl is set
  }

  /**
   * Initialize the imposter rendering system
   * Creates a render target and camera for pre-rendering models to textures
   */
  private initImposterRenderer(): void {
    if (this.imposterRenderTarget) return; // Already initialized

    // Create render target for imposter textures (256x256 with alpha)
    this.imposterRenderTarget = new THREE.WebGLRenderTarget(256, 256, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    // Create orthographic camera for rendering (will be adjusted per model)
    this.imposterCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    // Create isolated scene for rendering imposters
    this.imposterScene = new THREE.Scene();
    this.imposterScene.background = null; // Transparent background

    // Add ambient light for consistent rendering
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.imposterScene.add(ambient);

    // Add directional light matching sun direction
    const dirLight = new THREE.DirectionalLight(0xfff8f0, 0.6);
    dirLight.position.set(1, 2, 1);
    this.imposterScene.add(dirLight);
  }

  /**
   * Pre-render a model to a texture for use as an imposter billboard
   */
  private preRenderImposterTexture(
    assetId: string,
    modelScene: THREE.Object3D,
  ): THREE.Texture | null {
    // Check cache first
    if (this.imposterTextures.has(assetId)) {
      return this.imposterTextures.get(assetId)!;
    }

    // Initialize renderer if needed
    this.initImposterRenderer();

    // Get the renderer from world graphics system
    const graphics = this.world.graphics as
      | { renderer?: THREE.WebGPURenderer }
      | undefined;
    const renderer = graphics?.renderer;
    if (
      !renderer ||
      !this.imposterRenderTarget ||
      !this.imposterCamera ||
      !this.imposterScene
    ) {
      return null;
    }

    // Clone the model to avoid modifying the original
    const modelClone = modelScene.clone();

    // Compute bounding box to fit camera
    const bbox = new THREE.Box3().setFromObject(modelClone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    // Position model at origin (centered)
    modelClone.position.sub(center);
    modelClone.position.y += size.y / 2; // Lift so base is at y=0

    // Add model to imposter scene
    this.imposterScene.add(modelClone);

    // Configure orthographic camera to fit the model
    const maxDim = Math.max(size.x, size.y) * 1.2; // Add 20% margin
    this.imposterCamera.left = -maxDim / 2;
    this.imposterCamera.right = maxDim / 2;
    this.imposterCamera.top = size.y * 0.6;
    this.imposterCamera.bottom = -size.y * 0.6;
    this.imposterCamera.near = 0.1;
    this.imposterCamera.far = maxDim * 4;
    this.imposterCamera.updateProjectionMatrix();

    // Position camera looking at model from front-side angle
    const cameraDistance = maxDim * 2;
    this.imposterCamera.position.set(
      cameraDistance * 0.7,
      size.y * 0.4,
      cameraDistance * 0.7,
    );
    this.imposterCamera.lookAt(0, size.y * 0.3, 0);

    // Store current renderer state
    const currentRenderTarget = renderer.getRenderTarget();
    const currentClearAlpha = renderer.getClearAlpha();
    const currentAutoClear = renderer.autoClear;

    // Render to texture
    renderer.autoClear = true;
    renderer.setClearAlpha(0); // Transparent background
    renderer.setRenderTarget(this.imposterRenderTarget);
    renderer.clear();
    renderer.render(this.imposterScene, this.imposterCamera);

    // Restore renderer state
    renderer.setRenderTarget(currentRenderTarget);
    renderer.setClearAlpha(currentClearAlpha);
    renderer.autoClear = currentAutoClear;

    // Remove model from imposter scene
    this.imposterScene.remove(modelClone);

    // Clone the texture from render target (so it persists after target is reused)
    const texture = this.imposterRenderTarget.texture.clone();
    texture.needsUpdate = true;

    // Cache the texture
    this.imposterTextures.set(assetId, texture);

    console.log(
      `[VegetationSystem] 📸 Pre-rendered imposter texture for: ${assetId}`,
    );

    return texture;
  }

  /**
   * Create imposter (billboard) mesh for an asset type
   * Uses pre-rendered textures for realistic appearance
   */
  private createImposter(
    assetId: string,
    asset: VegetationAsset,
    _material: THREE.Material | THREE.Material[],
  ): ImposterData {
    const maxBillboards = Math.floor(this.config.maxInstancesPerAsset * 0.3);

    // Try to get pre-rendered texture
    const imposterTexture = this.imposterTextures.get(assetId);

    // Create billboard material with texture or fallback to silhouette
    let billboardMaterial: THREE.Material;

    if (imposterTexture) {
      // Use pre-rendered texture - looks like the actual model
      billboardMaterial = new THREE.MeshBasicMaterial({
        map: imposterTexture,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
        vertexColors: true, // For per-instance fading
      });
    } else {
      // Fallback: subtle silhouette (shouldn't happen if prerender succeeds)
      billboardMaterial = new THREE.MeshBasicMaterial({
        color: 0x2a4a1a,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
        vertexColors: true,
      });

      // Adjust color based on asset category
      const mat = billboardMaterial as THREE.MeshBasicMaterial;
      if (
        asset.category === "bush" ||
        asset.category === "grass" ||
        asset.category === "fern"
      ) {
        mat.color.setHex(0x1a3a1a);
        mat.opacity = 0.25;
      } else if (asset.category === "rock") {
        mat.color.setHex(0x4a4a4a);
        mat.opacity = 0.35;
      } else if (asset.category === "flower") {
        mat.color.setHex(0x2a4a2a);
        mat.opacity = 0.2;
      } else if (asset.category === "fallen_tree") {
        mat.color.setHex(0x3a2a1a);
        mat.opacity = 0.3;
      } else {
        mat.opacity = 0.3;
      }
    }

    const billboardMesh = new THREE.InstancedMesh(
      this.billboardGeometry!,
      billboardMaterial,
      maxBillboards,
    );

    billboardMesh.frustumCulled = false; // Disable to prevent popping
    billboardMesh.count = 0;
    billboardMesh.name = `Imposter_${assetId}`;

    // Enable instance colors for per-instance opacity/fade
    billboardMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxBillboards * 3),
      3,
    );

    // Initialize all colors to white (full opacity)
    for (let i = 0; i < maxBillboards; i++) {
      billboardMesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }

    return {
      billboardMesh,
      maxBillboards,
      activeCount: 0,
    };
  }

  /**
   * Compute a deterministic seed from world configuration
   */
  private computeSeedFromWorldId(): number {
    const worldConfig = (this.world as { config?: { terrainSeed?: number } })
      .config;
    if (worldConfig?.terrainSeed !== undefined) {
      return worldConfig.terrainSeed;
    }

    if (typeof process !== "undefined" && process.env?.TERRAIN_SEED) {
      const envSeed = parseInt(process.env.TERRAIN_SEED, 10);
      if (!isNaN(envSeed)) {
        return envSeed;
      }
    }

    return 0; // Fixed seed for deterministic vegetation
  }

  /**
   * Load vegetation asset definitions from manifest
   */
  private async loadAssetDefinitions(): Promise<void> {
    try {
      const assetsUrl = (this.world.assetsUrl || "").replace(/\/$/, "");
      const manifestUrl = `${assetsUrl}/manifests/vegetation.json`;

      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.warn(
          `[VegetationSystem] Failed to load vegetation manifest: ${response.status}`,
        );
        return;
      }

      const manifest = (await response.json()) as {
        version: number;
        assets: VegetationAsset[];
      };

      for (const asset of manifest.assets) {
        this.assetDefinitions.set(asset.id, asset);
      }

      console.log(
        `[VegetationSystem] Loaded ${this.assetDefinitions.size} vegetation asset definitions`,
      );
    } catch (error) {
      console.error(
        "[VegetationSystem] Error loading vegetation manifest:",
        error,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.world.isClient || typeof window === "undefined") return;
    if (!this.world.stage?.scene) return;

    this.scene = this.world.stage.scene as THREE.Scene;

    // Load vegetation asset definitions now that world.assetsUrl is set
    await this.loadAssetDefinitions();

    // Create root group for all vegetation
    this.vegetationGroup = new THREE.Group();
    this.vegetationGroup.name = "VegetationSystem";
    this.vegetationGroup.frustumCulled = false; // Disable culling on group
    this.scene.add(this.vegetationGroup);

    // Create separate group for procedural grass
    this.grassGroup = new THREE.Group();
    this.grassGroup.name = "ProceduralGrass";
    this.grassGroup.frustumCulled = false;
    this.vegetationGroup.add(this.grassGroup);

    // Grass disabled - using OSRS vertex color terrain style
    // if (this.world.camera) {
    //   this.world.camera.layers.enable(1);
    // }
    // await this.initializeGrass();

    // Listen for terrain tile events
    this.world.on(
      EventType.TERRAIN_TILE_GENERATED,
      this.onTileGenerated.bind(this),
    );
    this.world.on(
      EventType.TERRAIN_TILE_UNLOADED,
      this.onTileUnloaded.bind(this),
    );

    console.log(
      `[VegetationSystem] ✅ Started with ${this.assetDefinitions.size} assets, radius=${MAX_VEGETATION_TILE_RADIUS} tiles`,
    );

    // Process existing terrain tiles that were generated before we subscribed
    await this.processExistingTiles();
  }

  /**
   * Process terrain tiles that already exist when VegetationSystem starts
   * Only processes tiles near the player for performance
   */
  private async processExistingTiles(): Promise<void> {
    const terrainSystemRaw = this.world.getSystem("terrain");
    if (!terrainSystemRaw) return;

    // Type assertion for terrain system - use the public getTiles() method
    const terrainSystem = terrainSystemRaw as unknown as {
      getTiles?: () => Map<string, { x: number; z: number; biome: string }>;
      CONFIG?: { TILE_SIZE: number };
    };

    if (!terrainSystem.getTiles) return;

    const tileSize = terrainSystem.CONFIG?.TILE_SIZE || 100;
    const playerPos = this.getPlayerPosition();
    const playerTileX = playerPos ? Math.floor(playerPos.x / tileSize) : 0;
    const playerTileZ = playerPos ? Math.floor(playerPos.z / tileSize) : 0;

    const tiles = terrainSystem.getTiles();
    const allTiles = Array.from(tiles.entries()).map(([_key, tile]) => ({
      tileX: tile.x,
      tileZ: tile.z,
      biome: tile.biome || "plains",
    }));

    // Separate into nearby tiles (generate now) and distant tiles (lazy load later)
    const nearbyTiles: typeof allTiles = [];
    const distantTiles: typeof allTiles = [];

    for (const tile of allTiles) {
      const dx = Math.abs(tile.tileX - playerTileX);
      const dz = Math.abs(tile.tileZ - playerTileZ);
      if (Math.max(dx, dz) <= MAX_VEGETATION_TILE_RADIUS) {
        nearbyTiles.push(tile);
      } else {
        distantTiles.push(tile);
      }
    }

    // Sort nearby by distance (closest first)
    nearbyTiles.sort((a, b) => {
      const distA = Math.max(
        Math.abs(a.tileX - playerTileX),
        Math.abs(a.tileZ - playerTileZ),
      );
      const distB = Math.max(
        Math.abs(b.tileX - playerTileX),
        Math.abs(b.tileZ - playerTileZ),
      );
      return distA - distB;
    });

    // Process nearby tiles immediately
    for (const tile of nearbyTiles) {
      await this.onTileGenerated(tile);
    }

    // Queue distant tiles for lazy loading
    for (const tile of distantTiles) {
      this.pendingTiles.set(`${tile.tileX}_${tile.tileZ}`, tile);
    }

    console.log(
      `[VegetationSystem] 🌲 Processed ${nearbyTiles.length} nearby tiles, ${distantTiles.length} queued for lazy loading`,
    );
  }

  /**
   * Get player's current tile coordinates
   */
  private getPlayerTile(): { x: number; z: number } | null {
    const terrainSystemRaw = this.world.getSystem("terrain");
    const tileSize =
      (terrainSystemRaw as unknown as { CONFIG?: { TILE_SIZE: number } })
        ?.CONFIG?.TILE_SIZE || 100;

    const playerPos = this.getPlayerPosition();
    if (!playerPos) return null;

    return {
      x: Math.floor(playerPos.x / tileSize),
      z: Math.floor(playerPos.z / tileSize),
    };
  }

  /**
   * Check if a tile is within vegetation generation range of the player
   */
  private isTileInRange(tileX: number, tileZ: number): boolean {
    const playerTile = this.getPlayerTile();
    if (!playerTile) return true; // Generate if we can't determine player position

    const dx = Math.abs(tileX - playerTile.x);
    const dz = Math.abs(tileZ - playerTile.z);
    return Math.max(dx, dz) <= MAX_VEGETATION_TILE_RADIUS;
  }

  /**
   * Handle terrain tile generation - spawn vegetation for the tile
   * Only generates vegetation if the tile is within range of the player
   */
  private async onTileGenerated(data: {
    tileX: number;
    tileZ: number;
    biome: string;
  }): Promise<void> {
    const key = `${data.tileX}_${data.tileZ}`;

    // Skip if already generated
    if (this.tileVegetation.has(key)) {
      return;
    }

    // Skip if tile is too far from player (lazy loading)
    if (!this.isTileInRange(data.tileX, data.tileZ)) {
      // Store as pending for later generation when player gets closer
      this.pendingTiles.set(key, data);
      return;
    }

    // NOTE: Grass is handled globally via updateGrassAroundPlayer(), not per-tile

    // Get biome vegetation configuration for trees/bushes/etc
    const biomeConfig = await this.getBiomeVegetationConfig(data.biome);

    if (!biomeConfig || !biomeConfig.enabled) {
      // Still remove from pending even if no other vegetation
      this.pendingTiles.delete(key);
      return;
    }

    // Create tile vegetation data
    const tileData: TileVegetationData = {
      key,
      instances: new Map(),
      generated: false,
      biome: data.biome,
    };
    this.tileVegetation.set(key, tileData);

    // Generate vegetation instances for this tile (trees, bushes, etc)
    await this.generateTileVegetation(data.tileX, data.tileZ, biomeConfig);
    tileData.generated = true;

    console.log(
      `[VegetationSystem] 🌲 Tile ${key} vegetation: ${tileData.instances.size} instances`,
    );

    // Remove from pending if it was there
    this.pendingTiles.delete(key);
  }

  /**
   * Handle terrain tile unload - remove vegetation instances
   */
  private onTileUnloaded(data: { tileX: number; tileZ: number }): void {
    const key = `${data.tileX}_${data.tileZ}`;
    const tileData = this.tileVegetation.get(key);

    if (tileData) {
      // Remove all instances for this tile
      for (const instance of tileData.instances.values()) {
        this.removeInstance(instance);
      }
      this.tileVegetation.delete(key);
    }

    // NOTE: Grass is handled globally, not per-tile
  }

  /**
   * Get biome vegetation configuration from BIOMES data
   */
  private async getBiomeVegetationConfig(
    biomeId: string,
  ): Promise<BiomeVegetationConfig | null> {
    // Access BIOMES data through the terrain system or data manager
    const terrainSystem = this.world.getSystem("terrain") as {
      getBiomeData?: (id: string) => { vegetation?: BiomeVegetationConfig };
    };

    if (terrainSystem?.getBiomeData) {
      const biomeData = terrainSystem.getBiomeData(biomeId);
      return biomeData?.vegetation ?? null;
    }

    // Fallback: try to get from global BIOMES using dynamic import
    try {
      const worldStructure = await import("../../../data/world-structure");
      const biome = worldStructure.BIOMES[biomeId];
      return biome?.vegetation ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Generate vegetation instances for a terrain tile
   */
  private async generateTileVegetation(
    tileX: number,
    tileZ: number,
    config: BiomeVegetationConfig,
  ): Promise<void> {
    const tileKey = `${tileX}_${tileZ}`;
    const tileData = this.tileVegetation.get(tileKey);
    if (!tileData) return;

    // Generate vegetation for each layer

    const terrainSystemRaw = this.world.getSystem("terrain");
    if (!terrainSystemRaw) {
      console.warn("[VegetationSystem] TerrainSystem not available");
      return;
    }

    // Type assertion through unknown to satisfy TypeScript
    const terrainSystem = terrainSystemRaw as unknown as {
      getHeightAt: (x: number, z: number) => number;
      getNormalAt?: (x: number, z: number) => THREE.Vector3;
      getTileSize: () => number;
    };

    if (!terrainSystem.getHeightAt) {
      console.warn("[VegetationSystem] TerrainSystem missing getHeightAt");
      return;
    }

    const tileSize = terrainSystem.getTileSize();
    const tileWorldX = tileX * tileSize;
    const tileWorldZ = tileZ * tileSize;

    // Process each vegetation layer
    for (const layer of config.layers) {
      await this.generateLayerVegetation(
        tileKey,
        tileWorldX,
        tileWorldZ,
        tileSize,
        layer,
        terrainSystem,
      );
    }
  }

  /**
   * Generate vegetation for a single layer within a tile
   */
  private async generateLayerVegetation(
    tileKey: string,
    tileWorldX: number,
    tileWorldZ: number,
    tileSize: number,
    layer: VegetationLayer,
    terrainSystem: {
      getHeightAt: (x: number, z: number) => number;
      getNormalAt?: (x: number, z: number) => THREE.Vector3;
    },
  ): Promise<void> {
    const tileData = this.tileVegetation.get(tileKey);
    if (!tileData) return;

    // SHADER-DRIVEN GRASS: Skip tile-based grass - it's handled globally via createShaderGrass()
    if (layer.category === "grass") {
      return; // Grass is rendered as a single mesh that follows the player
    }

    // Compute number of instances to generate based on density
    const targetCount = Math.floor(layer.density * (tileSize / 100) ** 2);

    // Create deterministic RNG for this tile/layer
    const rng = this.createTileLayerRng(tileKey, layer.category);

    // Get valid asset definitions for this layer
    const validAssets = layer.assets
      .map((id) => this.assetDefinitions.get(id))
      .filter((a): a is VegetationAsset => a !== undefined);

    if (validAssets.length === 0) {
      return;
    }

    // Calculate total weight for weighted random selection
    const totalWeight = validAssets.reduce((sum, a) => sum + a.weight, 0);

    // Generate candidate positions with clustering support
    const positions = this.generatePlacementPositions(
      tileWorldX,
      tileWorldZ,
      tileSize,
      targetCount,
      layer,
      rng,
    );

    // Bind getHeightAt to preserve context (needed for internal state access)
    const getHeight = terrainSystem.getHeightAt.bind(terrainSystem);

    // Place instances at valid positions
    let placedCount = 0;
    for (const pos of positions) {
      if (placedCount >= targetCount) break;

      // Get terrain height at position
      const height = getHeight(pos.x, pos.z);

      // Check height constraints
      if (layer.minHeight !== undefined && height < layer.minHeight) continue;
      if (layer.maxHeight !== undefined && height > layer.maxHeight) continue;

      // Check water avoidance - ALWAYS avoid water unless explicitly disabled
      // layer.avoidWater defaults to true if not specified
      const shouldAvoidWater = layer.avoidWater !== false;
      const waterThreshold = WATER_LEVEL + WATER_EDGE_BUFFER;
      if (shouldAvoidWater && height < waterThreshold) {
        continue;
      }

      // Calculate slope once for all checks
      const slope = this.estimateSlope(pos.x, pos.z, getHeight);

      // Check slope constraints
      if (layer.avoidSteepSlopes) {
        if (slope > 0.6) continue; // Skip steep slopes
      }

      // Select asset based on weighted random
      const asset = this.selectWeightedAsset(validAssets, totalWeight, rng);
      if (!asset) continue;

      // Check asset-specific slope constraints
      if (asset.minSlope !== undefined && slope < asset.minSlope) continue;
      if (asset.maxSlope !== undefined && slope > asset.maxSlope) continue;

      // Calculate instance transform
      const scale =
        asset.baseScale *
        (asset.scaleVariation[0] +
          rng() * (asset.scaleVariation[1] - asset.scaleVariation[0]));

      const rotationY = asset.randomRotation ? rng() * Math.PI * 2 : 0;
      let rotationX = 0;
      let rotationZ = 0;

      // Align to terrain normal if requested
      if (asset.alignToNormal && terrainSystem.getNormalAt) {
        const normal = terrainSystem.getNormalAt(pos.x, pos.z);
        // Calculate rotation to align with normal (using pre-allocated objects)
        this._tempEuler.setFromRotationMatrix(
          this._lookAtMatrix.lookAt(this._origin, normal, this._yAxis),
        );
        rotationX = this._tempEuler.x;
        rotationZ = this._tempEuler.z;
      }

      // Create instance
      const instance: VegetationInstance = {
        id: `${tileKey}_${layer.category}_${placedCount}`,
        assetId: asset.id,
        category: layer.category,
        position: {
          x: pos.x,
          y: height + (asset.yOffset ?? 0),
          z: pos.z,
        },
        rotation: { x: rotationX, y: rotationY, z: rotationZ },
        scale,
        tileKey,
      };

      // Add instance to tile data
      tileData.instances.set(instance.id, instance);

      // Add to instanced mesh (will load asset if needed)
      await this.addInstance(instance);

      placedCount++;
    }
  }

  /**
   * Generate placement positions with optional clustering
   */
  private generatePlacementPositions(
    tileWorldX: number,
    tileWorldZ: number,
    tileSize: number,
    targetCount: number,
    layer: VegetationLayer,
    rng: () => number,
  ): Array<{ x: number; z: number }> {
    const positions: Array<{ x: number; z: number }> = [];
    const noiseScale = layer.noiseScale ?? 0.05;
    const noiseThreshold = layer.noiseThreshold ?? 0.3;
    const minSpacing = layer.minSpacing;

    // Generate more candidates than needed, then filter
    const candidateMultiplier = 3;
    const maxCandidates = targetCount * candidateMultiplier;

    for (let i = 0; i < maxCandidates && positions.length < targetCount; i++) {
      let x: number;
      let z: number;

      if (layer.clustering && layer.clusterSize) {
        // Clustering: generate cluster centers, then scatter around them
        const clusterCount = Math.max(
          1,
          Math.floor(targetCount / layer.clusterSize),
        );
        const clusterIndex = Math.floor(rng() * clusterCount);

        // Deterministic cluster center
        const clusterRng = this.createTileLayerRng(
          `${tileWorldX}_${tileWorldZ}_cluster_${clusterIndex}`,
          layer.category,
        );
        const clusterCenterX =
          tileWorldX + tileSize * 0.1 + clusterRng() * tileSize * 0.8;
        const clusterCenterZ =
          tileWorldZ + tileSize * 0.1 + clusterRng() * tileSize * 0.8;

        // Scatter around cluster center with Gaussian-like distribution
        const angle = rng() * Math.PI * 2;
        const radius = rng() * rng() * minSpacing * layer.clusterSize;
        x = clusterCenterX + Math.cos(angle) * radius;
        z = clusterCenterZ + Math.sin(angle) * radius;
      } else {
        // Uniform random distribution
        x = tileWorldX + rng() * tileSize;
        z = tileWorldZ + rng() * tileSize;
      }

      // Ensure within tile bounds
      if (
        x < tileWorldX ||
        x >= tileWorldX + tileSize ||
        z < tileWorldZ ||
        z >= tileWorldZ + tileSize
      ) {
        continue;
      }

      // Noise-based filtering
      if (this.noise) {
        const noiseValue =
          (this.noise.perlin2D(x * noiseScale, z * noiseScale) + 1) / 2;
        if (noiseValue < noiseThreshold) continue;
      }

      // Minimum spacing check
      let tooClose = false;
      for (const existing of positions) {
        const dx = existing.x - x;
        const dz = existing.z - z;
        if (dx * dx + dz * dz < minSpacing * minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      positions.push({ x, z });
    }

    return positions;
  }

  /**
   * Estimate terrain slope at a position
   */
  private estimateSlope(
    x: number,
    z: number,
    getHeight: (x: number, z: number) => number,
  ): number {
    const delta = 1.0;
    const _hCenter = getHeight(x, z); // Not used but called for consistency
    const hN = getHeight(x, z - delta);
    const hS = getHeight(x, z + delta);
    const hE = getHeight(x + delta, z);
    const hW = getHeight(x - delta, z);

    const dhdx = (hE - hW) / (2 * delta);
    const dhdz = (hS - hN) / (2 * delta);

    return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
  }

  // ============================================================================
  // GPU-ONLY GRASS - All computation in shader
  // ============================================================================

  private heightMapTexture: THREE.DataTexture | null = null;
  private heightMapSize = 128; // 128x128 = ~0.27m per pixel at 35m area
  private lastHeightMapCenter = new THREE.Vector2(Infinity, Infinity);

  /**
   * Initialize 100% GPU grass
   * Shader computes all positions from instanceIndex
   */
  private async initializeGrass(): Promise<void> {
    if (!this.grassBladeGeometry || !this.grassGroup) return;

    console.log(
      `[VegetationSystem] 🌿 Initializing GPU grass (${GPU_GRASS_INSTANCES} instances)...`,
    );

    // Create height map texture (required for GPU grass)
    this.heightMapTexture = this.createHeightMapTexture();

    // Get the terrain noise texture (same one used by TerrainShader for grass/dirt blending)
    // This ensures grass placement matches terrain appearance exactly!
    let noiseTexture = getNoiseTexture();
    if (!noiseTexture) {
      console.log(
        `[VegetationSystem] 🌿 Generating noise texture for grass...`,
      );
      noiseTexture = generateNoiseTexture();
    }

    // Create grass material (100% GPU procedural) with height map + noise texture
    this.grassMaterial = createGrassMaterial(
      this.heightMapTexture,
      noiseTexture,
    );

    // Initialize height map with current player position
    const playerPos = this.getPlayerPosition();
    if (playerPos) {
      this.updateHeightMap(playerPos.x, playerPos.z);
    }

    // Create InstancedMesh with identity matrices
    // Shader will compute actual positions from instanceIndex
    this.grassMesh = new THREE.InstancedMesh(
      this.grassBladeGeometry,
      this.grassMaterial,
      GPU_GRASS_INSTANCES,
    );

    // Set identity matrices once (shader overrides position)
    const identity = new THREE.Matrix4();
    for (let i = 0; i < GPU_GRASS_INSTANCES; i++) {
      this.grassMesh.setMatrixAt(i, identity);
    }
    this.grassMesh.instanceMatrix.needsUpdate = true;

    this.grassMesh.frustumCulled = false;
    this.grassMesh.castShadow = false;
    this.grassMesh.receiveShadow = false;
    this.grassMesh.name = "GPU_Grass";
    this.grassMesh.count = GPU_GRASS_INSTANCES;

    // Layer 1 = main camera only (not minimap/reflection which use layer 0)
    this.grassMesh.layers.set(1);

    // Ensure main camera can see layer 1
    if (this.world.camera) {
      this.world.camera.layers.enable(1);
    }

    this.grassGroup.add(this.grassMesh);

    console.log(
      `[VegetationSystem] 🌿 GPU grass ready: ${GPU_GRASS_INSTANCES} instances`,
    );
  }

  /**
   * Create a height map texture for GPU grass
   * Uses Float32 for full height precision
   */
  private createHeightMapTexture(): THREE.DataTexture {
    const size = this.heightMapSize;
    const data = new Float32Array(size * size);

    const tex = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RedFormat,
      THREE.FloatType,
    );
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    return tex;
  }

  /**
   * Update height map texture around player
   */
  private updateHeightMap(playerX: number, playerZ: number): void {
    if (!this.heightMapTexture || !this.grassMaterial) return;

    // Check if we need to regenerate height data
    const dx = playerX - this.lastHeightMapCenter.x;
    const dz = playerZ - this.lastHeightMapCenter.y;
    const needsRegenerate = dx * dx + dz * dz > 1; // 1m threshold - keep data fresh

    if (!needsRegenerate) return;

    // Update center to new position - data and uniform must match!
    this.lastHeightMapCenter.set(playerX, playerZ);
    this.grassMaterial.grassUniforms.heightMapCenter.value.set(
      playerX,
      playerZ,
    );
    this.grassMaterial.grassUniforms.heightMapSize.value =
      GRASS_CONFIG.AREA_SIZE;

    // Get terrain system
    const terrainSystemRaw = this.world.getSystem("terrain");
    if (!terrainSystemRaw) return;
    const terrainSystem = terrainSystemRaw as unknown as {
      getHeightAt: (x: number, z: number) => number;
    };
    if (!terrainSystem.getHeightAt) return;

    const size = this.heightMapSize;
    const areaSize = GRASS_CONFIG.AREA_SIZE;
    const data = this.heightMapTexture.image.data as Float32Array;

    // Sample terrain heights into texture - store RAW height values
    let minH = 999,
      maxH = -999,
      sumH = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size - 0.5) * areaSize + playerX;
        const v = (y / size - 0.5) * areaSize + playerZ;
        const height = terrainSystem.getHeightAt(u, v);
        // Store raw height value (float precision)
        data[y * size + x] = height;

        minH = Math.min(minH, height);
        maxH = Math.max(maxH, height);
        sumH += height;
      }
    }

    console.log(
      `[Grass HeightMap] Regenerated at (${playerX.toFixed(1)}, ${playerZ.toFixed(1)}): height range ${minH.toFixed(1)}-${maxH.toFixed(1)}, avg=${(sumH / (size * size)).toFixed(1)}`,
    );

    this.heightMapTexture.needsUpdate = true;
  }

  /**
   * Update grass uniforms and height map
   * Shader does all position computation
   */
  private updateGrass(): void {
    if (!this.grassMaterial) return;

    const playerPos = this.getPlayerPosition();
    if (playerPos) {
      this.grassMaterial.grassUniforms.playerPosition.value.copy(playerPos);
      // Update height map if player moved
      this.updateHeightMap(playerPos.x, playerPos.z);

      // Debug log once per second
      if (!this._lastGrassDebug || Date.now() - this._lastGrassDebug > 2000) {
        this._lastGrassDebug = Date.now();
        const uniforms = this.grassMaterial.grassUniforms;
        console.log(
          `[Grass Debug] player=(${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}) heightMapCenter=(${uniforms.heightMapCenter.value.x.toFixed(1)}, ${uniforms.heightMapCenter.value.y.toFixed(1)}) heightMapSize=${uniforms.heightMapSize.value}`,
        );
      }
    }

    this.grassMaterial.grassUniforms.time.value = this.grassTime;

    const skySystem = this.world.getSystem("sky") as unknown as {
      sunDirection?: THREE.Vector3;
    } | null;
    if (skySystem?.sunDirection) {
      this.grassMaterial.grassUniforms.sunDirection.value.copy(
        skySystem.sunDirection,
      );
    }
  }

  private _lastGrassDebug = 0;

  /**
   * Simple hash function for deterministic randomness
   */
  private hashPosition(x: number, z: number): number {
    const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  /**
   * Setup a vegetation material for proper lighting
   * Converts to MeshStandardMaterial and configures for CSM shadows
   */
  private setupVegetationMaterial(
    material: THREE.Material,
    _asset: VegetationAsset,
  ): THREE.Material {
    // Extract properties from any material type
    const matAny = material as THREE.MeshStandardMaterial;
    const map = matAny.map || null;
    const color = matAny.color || new THREE.Color(0xffffff);
    const alphaMap = matAny.alphaMap || null;

    // Create fresh MeshStandardMaterial for vegetation
    const stdMat = new THREE.MeshStandardMaterial({
      color: color,
      map: map,
      alphaMap: alphaMap,
      // Alpha handling - use alphaTest for hard edges (faster than blending)
      transparent: false,
      alphaTest: 0.5, // Standard alpha cutoff
      // Double-sided for foliage
      side: THREE.DoubleSide,
      // Matte surface - no specular, no reflections
      roughness: 1.0,
      metalness: 0.0,
      envMap: null,
      envMapIntensity: 0,
      // Enable fog
      fog: true,
    });

    // Ensure texture colorspace is correct
    if (stdMat.map) {
      stdMat.map.colorSpace = THREE.SRGBColorSpace;
    }

    // Setup for CSM shadows (realtime lighting)
    if (this.world.setupMaterial) {
      this.world.setupMaterial(stdMat);
    }

    stdMat.needsUpdate = true;
    return stdMat;
  }

  /**
   * Select a vegetation asset based on weighted probability
   */
  private selectWeightedAsset(
    assets: VegetationAsset[],
    totalWeight: number,
    rng: () => number,
  ): VegetationAsset | null {
    let random = rng() * totalWeight;
    for (const asset of assets) {
      random -= asset.weight;
      if (random <= 0) {
        return asset;
      }
    }
    return assets[assets.length - 1] ?? null;
  }

  /**
   * Create a deterministic RNG for a tile and layer
   */
  private createTileLayerRng(tileKey: string, category: string): () => number {
    // Hash the tile key and category into a seed
    let hash = 5381;
    const str = `${tileKey}_${category}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }

    let state = (hash >>> 0) ^ this.computeSeedFromWorldId();

    return () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }

  /**
   * Add a vegetation instance to the scene
   */
  private async addInstance(instance: VegetationInstance): Promise<void> {
    const asset = this.assetDefinitions.get(instance.assetId);
    if (!asset) return;

    // Ensure asset is loaded
    let assetData: InstancedAssetData | undefined = this.loadedAssets.get(
      instance.assetId,
    );
    if (!assetData) {
      const loadedAsset = await this.loadAsset(asset);
      if (!loadedAsset) return;
      assetData = loadedAsset;
    }

    // Check if we have room for more instances
    if (assetData.activeCount >= assetData.maxInstances) {
      return;
    }

    const matrixIndex = assetData.activeCount;
    const worldY =
      instance.position.y + assetData.modelBaseOffset * instance.scale;

    // WATER CHECK: Reject any instance below water level
    const waterCutoff = WATER_LEVEL + WATER_EDGE_BUFFER;
    if (worldY < waterCutoff) {
      console.warn(
        `[VegetationSystem] ⛔ REJECTED tree at Y=${worldY.toFixed(2)} (water cutoff=${waterCutoff.toFixed(2)}), pos=(${instance.position.x.toFixed(1)}, ${instance.position.z.toFixed(1)})`,
      );
      return; // Do not add this instance
    }

    // Write instance attributes for GPU shader (used for distance fade calculations)
    if (
      assetData.positionAttr &&
      assetData.scaleAttr &&
      assetData.rotationAttr
    ) {
      const i3 = matrixIndex * 3;
      assetData.positionAttr.array[i3] = instance.position.x;
      assetData.positionAttr.array[i3 + 1] = worldY;
      assetData.positionAttr.array[i3 + 2] = instance.position.z;
      assetData.positionAttr.needsUpdate = true;

      assetData.scaleAttr.array[matrixIndex] = instance.scale;
      assetData.scaleAttr.needsUpdate = true;

      assetData.rotationAttr.array[matrixIndex] = instance.rotation.y;
      assetData.rotationAttr.needsUpdate = true;
    }

    // Compose proper transform matrix for Three.js InstancedMesh
    this._tempPosition.set(instance.position.x, worldY, instance.position.z);
    this._tempEuler.set(0, instance.rotation.y, 0);
    this._tempQuaternion.setFromEuler(this._tempEuler);
    this._tempScale.setScalar(instance.scale);
    this._tempMatrix.compose(
      this._tempPosition,
      this._tempQuaternion,
      this._tempScale,
    );
    assetData.instancedMesh.setMatrixAt(matrixIndex, this._tempMatrix);
    assetData.instancedMesh.instanceMatrix.needsUpdate = true;

    // Track instance
    assetData.instanceMap.set(instance.id, matrixIndex);
    assetData.instances[matrixIndex] = instance;
    instance.matrixIndex = matrixIndex;
    assetData.activeCount++;

    // Update instance count
    assetData.instancedMesh.count = assetData.activeCount;

    // Debug: Log tree placements near water
    if (instance.category === "tree" && worldY < 15) {
      console.log(
        `[VegetationSystem] 🌲 Tree placed at Y=${worldY.toFixed(2)}, pos=(${instance.position.x.toFixed(1)}, ${instance.position.z.toFixed(1)})`,
      );
    }
  }

  /**
   * Remove a vegetation instance from the scene
   */
  private removeInstance(instance: VegetationInstance): void {
    const assetData = this.loadedAssets.get(instance.assetId);
    if (!assetData) return;

    const matrixIndex = assetData.instanceMap.get(instance.id);
    if (matrixIndex === undefined) return;

    // Swap with last instance to maintain contiguous array
    const lastIndex = assetData.activeCount - 1;
    if (matrixIndex !== lastIndex) {
      // Get last instance's matrix
      assetData.instancedMesh.getMatrixAt(lastIndex, this._tempMatrix);
      assetData.instancedMesh.setMatrixAt(matrixIndex, this._tempMatrix);

      // Update tracking for swapped instance
      const lastInstance = assetData.instances[lastIndex];
      if (lastInstance) {
        assetData.instanceMap.set(lastInstance.id, matrixIndex);
        assetData.instances[matrixIndex] = lastInstance;
        lastInstance.matrixIndex = matrixIndex;
      }
    }

    // Remove from tracking
    assetData.instanceMap.delete(instance.id);
    assetData.instances.pop();
    assetData.activeCount--;

    // Update instance count
    assetData.instancedMesh.count = assetData.activeCount;
    assetData.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Create a grass-specific material with distance fade and terrain blending
   */
  private createGrassMaterial(
    baseMaterial: THREE.Material | THREE.Material[],
  ): THREE.Material | THREE.Material[] {
    // Handle material arrays
    const processOneMaterial = (mat: THREE.Material): THREE.Material => {
      // Clone the material to avoid modifying the original
      const grassMat = mat.clone();

      // Enable transparency and alpha testing for grass cards
      grassMat.transparent = true;
      grassMat.alphaTest = 0.3; // Lower threshold for softer edges
      grassMat.side = THREE.DoubleSide; // Render both sides of grass blades
      grassMat.depthWrite = true;

      // If it's a MeshStandardMaterial, adjust for grass with distance fade
      if (grassMat instanceof THREE.MeshStandardMaterial) {
        // Reduce metalness and roughness for grass
        grassMat.metalness = 0;
        grassMat.roughness = 0.9;
        // Tint towards terrain green
        grassMat.color.lerp(new THREE.Color(0x5a8a5f), 0.3);

        // Add custom shader for distance fade
        grassMat.onBeforeCompile = (shader) => {
          // Add uniforms for camera position and fade distance
          shader.uniforms.grassFadeNear = { value: GRASS_CONFIG.FADE_START };
          shader.uniforms.grassFadeFar = { value: GRASS_CONFIG.FADE_END };

          // Inject distance fade into fragment shader
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            `#include <common>
            uniform float grassFadeNear;
            uniform float grassFadeFar;`,
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `#include <dithering_fragment>
            // Distance-based fade for grass
            float dist = length(vViewPosition);
            float fadeFactor = 1.0 - smoothstep(grassFadeNear, grassFadeFar, dist);
            gl_FragColor.a *= fadeFactor;
            if (gl_FragColor.a < 0.01) discard;`,
          );

          // Update uniforms each frame
          const originalOnBeforeRender = grassMat.onBeforeRender;
          grassMat.onBeforeRender = (
            renderer,
            scene,
            camera,
            geometry,
            object,
            group,
          ) => {
            if (originalOnBeforeRender) {
              originalOnBeforeRender.call(
                grassMat,
                renderer,
                scene,
                camera,
                geometry,
                object,
                group,
              );
            }
            // Update camera-relative uniforms if needed
          };
        };
      }

      return grassMat;
    };

    if (Array.isArray(baseMaterial)) {
      return baseMaterial.map(processOneMaterial);
    }
    return processOneMaterial(baseMaterial);
  }

  /**
   * Load a vegetation asset and create InstancedMesh
   */
  private async loadAsset(
    asset: VegetationAsset,
  ): Promise<InstancedAssetData | null> {
    // Prevent duplicate loads
    if (this.pendingAssetLoads.has(asset.id)) {
      // Wait for existing load to complete
      while (this.pendingAssetLoads.has(asset.id)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return this.loadedAssets.get(asset.id) ?? null;
    }

    this.pendingAssetLoads.add(asset.id);

    try {
      // Use asset:// protocol so URL resolution is consistent with preloader
      const modelPath = `asset://${asset.model}`;

      // Load the GLB model - will use cache if preloaded
      const { scene } = await modelCache.loadModel(modelPath, this.world);

      // Extract geometry and material from the loaded model
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;

      // Find the first mesh in the scene hierarchy
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
        }
      });

      if (!geometry || !material) {
        console.warn(`[VegetationSystem] No mesh found in asset: ${asset.id}`);
        return null;
      }

      // Type assertions after null check (TypeScript can't track traverse callback)
      const validGeometry = geometry as THREE.BufferGeometry;
      const validMaterial = material as THREE.Material | THREE.Material[];

      // Compute bounding box to find model's base (minimum Y)
      // This fixes models that are centered rather than having origin at base
      validGeometry.computeBoundingBox();
      const boundingBox = validGeometry.boundingBox;
      let modelBaseOffset = 0;
      if (boundingBox) {
        // If model's min Y is negative, we need to lift it up by that amount
        modelBaseOffset = -boundingBox.min.y;
        console.log(
          `[VegetationSystem] Asset ${asset.id} base offset: ${modelBaseOffset.toFixed(2)} (bbox.min.y = ${boundingBox.min.y.toFixed(2)})`,
        );
      }

      // Setup materials for proper lighting and CSM shadows
      let finalMaterial: THREE.Material | THREE.Material[] = validMaterial;
      if (Array.isArray(finalMaterial)) {
        finalMaterial = finalMaterial.map((mat) =>
          this.setupVegetationMaterial(mat, asset),
        );
      } else {
        finalMaterial = this.setupVegetationMaterial(finalMaterial, asset);
      }

      // Create InstancedMesh
      const instancedMesh = new THREE.InstancedMesh(
        validGeometry,
        finalMaterial,
        this.config.maxInstancesPerAsset,
      );
      instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instancedMesh.count = 0;

      // DISABLE Three.js frustum culling on the whole mesh!
      // We do per-instance frustum culling manually in updateLOD.
      // If we leave this true, Three.js might cull the entire instanced mesh
      // based on an outdated bounding sphere, causing all vegetation to vanish.
      instancedMesh.frustumCulled = false;

      // Configure shadows based on category
      if (asset.category === "tree") {
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
      } else {
        instancedMesh.castShadow = false;
        instancedMesh.receiveShadow = true;
      }
      instancedMesh.name = `Vegetation_${asset.id}`;

      // Add to scene
      if (this.vegetationGroup) {
        this.vegetationGroup.add(instancedMesh);
      }

      // Set up GPU instance buffer attributes for shader-based transforms
      const maxInst = this.config.maxInstancesPerAsset;
      const positionAttr = new THREE.InstancedBufferAttribute(
        new Float32Array(maxInst * 3),
        3,
      );
      const scaleAttr = new THREE.InstancedBufferAttribute(
        new Float32Array(maxInst),
        1,
      );
      const rotationAttr = new THREE.InstancedBufferAttribute(
        new Float32Array(maxInst),
        1,
      );

      // Dynamic usage for initial population, switches to static after upload
      positionAttr.setUsage(THREE.DynamicDrawUsage);
      scaleAttr.setUsage(THREE.DynamicDrawUsage);
      rotationAttr.setUsage(THREE.DynamicDrawUsage);

      // Attach to geometry for shader access
      instancedMesh.geometry.setAttribute("instancePosition", positionAttr);
      instancedMesh.geometry.setAttribute("instanceScale", scaleAttr);
      instancedMesh.geometry.setAttribute("instanceRotationY", rotationAttr);

      // Check if geometry has vertex colors
      const hasVertexColors = validGeometry.attributes.color !== undefined;

      // Create GPU material with shader-based LOD, wind, and distance fade
      const baseMat = Array.isArray(finalMaterial)
        ? finalMaterial[0]
        : finalMaterial;
      const stdMat = baseMat as THREE.MeshStandardMaterial;
      const gpuMaterial = createGPUVegetationMaterial({
        color: stdMat.color,
        map: stdMat.map,
        alphaTest: hasVertexColors ? 0.1 : 0.5, // Lower alpha test for vertex color models
        fadeStart:
          LOD_CONFIG[asset.category as keyof typeof LOD_CONFIG]?.fadeStart ??
          60,
        fadeEnd:
          LOD_CONFIG[asset.category as keyof typeof LOD_CONFIG]?.fadeEnd ?? 100,
        vertexColors: hasVertexColors,
      }) as GPUVegetationMaterial;

      if (hasVertexColors) {
        console.log(
          `[VegetationSystem] 🎨 Vertex colors enabled for ${asset.id}`,
        );
      }

      instancedMesh.material = gpuMaterial;

      const assetData: InstancedAssetData = {
        geometry: validGeometry,
        material: validMaterial,
        instancedMesh,
        instanceMap: new Map(),
        instances: [],
        maxInstances: this.config.maxInstancesPerAsset,
        activeCount: 0,
        asset,
        modelBaseOffset,
        gpuMaterial,
        positionAttr,
        scaleAttr,
        rotationAttr,
      };

      this.loadedAssets.set(asset.id, assetData);

      // Pre-render imposter texture from the loaded model
      // This captures the actual appearance for use as a billboard at distance
      try {
        this.preRenderImposterTexture(asset.id, scene);
      } catch (err) {
        console.warn(
          `[VegetationSystem] Failed to pre-render imposter for ${asset.id}:`,
          err,
        );
      }

      console.log(`[VegetationSystem] Loaded asset: ${asset.id}`);

      return assetData;
    } catch (error) {
      console.error(
        `[VegetationSystem] Error loading asset ${asset.id}:`,
        error,
      );
      return null;
    } finally {
      this.pendingAssetLoads.delete(asset.id);
    }
  }

  // Visibility is now handled by THREE.js frustum culling on the InstancedMesh
  // We don't need to constantly re-sort and update matrices - that caused stuttering

  /**
   * Get current player position
   */
  private getPlayerPosition(): THREE.Vector3 | null {
    const players = this.world.getPlayers();
    if (!players || players.length === 0) return null;

    const player = players[0];
    if (player.node?.position) {
      return this._tempPosition.set(
        player.node.position.x,
        player.node.position.y,
        player.node.position.z,
      );
    }

    return null;
  }

  // Debug: periodic stats logging
  private lastStatsLog = 0;
  private lastPendingCheck = 0;
  private lastPlayerTileKey = "";

  // Camera layer setup
  private cameraLayerSet = false;

  override update(delta: number): void {
    if (!this.world.isClient) return;

    // Ensure camera can see grass layer (one-time setup)
    if (!this.cameraLayerSet && this.world.camera) {
      this.world.camera.layers.enable(1);
      this.cameraLayerSet = true;
    }

    const now = Date.now();
    const playerPos = this.getPlayerPosition();

    // Update grass (uniforms + regenerate if player moved)
    this.grassTime += delta;
    this.updateGrass();

    // Update GPU uniforms - this is ALL the CPU work per frame!
    // The shader handles LOD, culling, transforms, and wind animation.
    if (playerPos) {
      this.updateGPUUniforms(
        playerPos.x,
        playerPos.y,
        playerPos.z,
        this.grassTime,
      );
    }

    // Lazy load pending tiles as player moves
    if (now - this.lastPendingCheck > 1000) {
      this.lastPendingCheck = now;
      this.processPendingTiles();
    }

    // Periodic stats logging (debug only)
    if (now - this.lastStatsLog > 30000) {
      this.lastStatsLog = now;
      const stats = this.getStats();
      if (stats.loadedAssets > 0 || stats.tilesWithVegetation > 0) {
        const grassCount = this.grassMesh?.count ?? 0;
        console.log(
          `[VegetationSystem] 📊 ${stats.totalInstances} vegetation, ${grassCount} grass`,
        );
      }
    }
  }

  /**
   * Update GPU material uniforms. This is the ONLY CPU work per frame (~16 bytes).
   * All LOD, culling, transforms, and wind happen in the shader.
   */
  private updateGPUUniforms(
    playerX: number,
    playerY: number,
    playerZ: number,
    time: number,
  ): void {
    for (const [, assetData] of this.loadedAssets) {
      if (assetData.gpuMaterial) {
        assetData.gpuMaterial.gpuUniforms.playerPos.value.set(
          playerX,
          playerY,
          playerZ,
        );
        assetData.gpuMaterial.gpuUniforms.time.value = time;
      }
    }
  }

  /**
   * Process pending tiles that are now within range of the player
   */
  private async processPendingTiles(): Promise<void> {
    if (this.pendingTiles.size === 0) return;

    const playerTile = this.getPlayerTile();
    if (!playerTile) return;

    const currentTileKey = `${playerTile.x}_${playerTile.z}`;

    // Only check if player has moved to a new tile
    if (currentTileKey === this.lastPlayerTileKey) return;
    this.lastPlayerTileKey = currentTileKey;

    // Find pending tiles that are now in range
    const tilesToGenerate: Array<{
      tileX: number;
      tileZ: number;
      biome: string;
    }> = [];

    for (const [key, tileData] of this.pendingTiles) {
      if (this.isTileInRange(tileData.tileX, tileData.tileZ)) {
        tilesToGenerate.push(tileData);
        this.pendingTiles.delete(key);
      }
    }

    // Sort by distance (closest first) and generate
    if (tilesToGenerate.length > 0) {
      tilesToGenerate.sort((a, b) => {
        const distA = Math.max(
          Math.abs(a.tileX - playerTile.x),
          Math.abs(a.tileZ - playerTile.z),
        );
        const distB = Math.max(
          Math.abs(b.tileX - playerTile.x),
          Math.abs(b.tileZ - playerTile.z),
        );
        return distA - distB;
      });

      // Generate one tile per frame to avoid hitches
      const tile = tilesToGenerate[0];
      await this.onTileGenerated(tile);

      // Re-add remaining tiles to pending
      for (let i = 1; i < tilesToGenerate.length; i++) {
        const t = tilesToGenerate[i];
        this.pendingTiles.set(`${t.tileX}_${t.tileZ}`, t);
      }
    }
  }

  /**
   * Configure the vegetation system
   */
  setConfig(config: Partial<VegetationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get statistics about vegetation system
   */
  getStats(): {
    totalAssets: number;
    loadedAssets: number;
    totalInstances: number;
    visibleInstances: number;
    tilesWithVegetation: number;
  } {
    let totalInstances = 0;
    let visibleInstances = 0;

    for (const assetData of this.loadedAssets.values()) {
      totalInstances += assetData.instances.length;
      visibleInstances += assetData.instancedMesh.count;
    }

    return {
      totalAssets: this.assetDefinitions.size,
      loadedAssets: this.loadedAssets.size,
      totalInstances,
      visibleInstances,
      tilesWithVegetation: this.tileVegetation.size,
    };
  }

  override destroy(): void {
    // Remove from scene
    if (this.vegetationGroup && this.vegetationGroup.parent) {
      this.vegetationGroup.parent.remove(this.vegetationGroup);
    }

    // Dispose all instanced meshes
    for (const assetData of this.loadedAssets.values()) {
      assetData.instancedMesh.dispose();
    }

    // Dispose any remaining imposters (if any were created)
    for (const imposterData of this.imposters.values()) {
      imposterData.billboardMesh.dispose();
    }
    this.imposters.clear();

    // Dispose grass mesh
    if (this.grassMesh) {
      this.grassMesh.dispose();
      this.grassMesh = null;
    }

    // Dispose grass blade geometry
    if (this.grassBladeGeometry) {
      this.grassBladeGeometry.dispose();
      this.grassBladeGeometry = null;
    }

    // Dispose grass material
    if (this.grassMaterial) {
      this.grassMaterial.dispose();
      this.grassMaterial = null;
    }

    this.loadedAssets.clear();
    this.tileVegetation.clear();
    this.assetDefinitions.clear();
    this.vegetationGroup = null;
    this.grassGroup = null;
    this.scene = null;
  }
}

export default VegetationSystem;
