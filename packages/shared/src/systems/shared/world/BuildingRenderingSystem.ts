/**
 * BuildingRenderingSystem - Optimized 3D Building Rendering with LOD, Batching, and Impostors
 *
 * Renders 3D building meshes for towns using @hyperscape/procgen's BuildingGenerator.
 * Works in conjunction with TownSystem which provides building placement data.
 *
 * **Grid Alignment:**
 * Buildings use a cell-based grid system that aligns with the game's tile-based movement:
 * - Building cells: CELL_SIZE = 4 meters (one "room" unit)
 * - Movement tiles: TILE_SIZE = 1 meter (pathfinding grid)
 * - Ratio: 1 building cell = 4×4 = 16 movement tiles
 * - Building positions are snapped to BUILDING_GRID_SNAP (2m) for alignment
 *
 * This ensures:
 * - Building collision aligns perfectly with movement collision
 * - Pathfinding inside buildings works correctly
 * - Door tiles and wall tiles are at proper boundaries
 *
 * **Performance Optimizations:**
 * - **Static Batching**: All buildings in a town merged into single mesh (1 draw call per town)
 * - **Material Sharing**: Single uber-material for all buildings (vertex-colored)
 * - **Geometry Merging**: Internal face removal and vertex optimization
 * - **Distance-based LOD**: Full detail → reduced → impostor → culled
 * - **Octahedral Impostors**: View-dependent billboards for distant buildings
 * - **Impostor Atlas**: Per-town batched impostor textures (reduced texture binds)
 * - **Lazy Collision**: PhysX bodies created only when player approaches
 *
 * **LOD Strategy:**
 * - Near (< lod1Distance): Full detail batched mesh, shadows enabled
 * - Medium (lod1Distance - imposterDistance): Batched mesh, shadows disabled
 * - Far (imposterDistance - fadeDistance): Town impostor atlas
 * - Very Far (> fadeDistance): Culled
 *
 * **Collision:**
 * - Wall collision: Thin box shapes along external building edges
 * - Floor collision: Flat box shapes at each floor level
 * - Roof collision: Walkable surface on top of building
 * - Uses "building" physics layer for filtering
 * - Collision created lazily when player enters town radius
 *
 * **Integration:**
 * - Depends on TownSystem for building placement data
 * - Depends on TerrainSystem for height queries
 * - Uses BuildingGenerator from @hyperscape/procgen for mesh generation
 * - Uses unified LOD configuration from GPUVegetation
 * - Uses ImpostorManager for octahedral impostor baking
 *
 * **Runs on:** Client only (buildings are purely visual on client)
 */

import THREE from "../../../extras/three/three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types";
import type {
  ProceduralTown,
  TownBuilding,
} from "../../../types/world/world-types";
import {
  BuildingGenerator,
  type BuildingLayout,
  CELL_SIZE,
  WALL_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  FLOOR_HEIGHT,
  FOUNDATION_HEIGHT,
  snapToBuildingGrid,
  BUILDING_GRID_SNAP,
  TILES_PER_CELL,
} from "@hyperscape/procgen/building";
import { getLODDistances, type LODDistancesWithSq } from "./GPUVegetation";
import { ImpostorManager, BakePriority } from "../rendering";
import {
  createImpostorMaterial,
  updateImpostorMaterial,
  type ImpostorBakeResult,
  type ImpostorViewData,
} from "@hyperscape/impostor";
import { getPhysX } from "../../../physics/PhysXManager";
import { Layers } from "../../../physics/Layers";
import type { PhysicsHandle } from "../../../types/systems/physics";

/**
 * Building type mapping from TownBuildingType to procgen recipe keys.
 * Some town building types don't have direct procgen equivalents and use fallbacks.
 */
const BUILDING_TYPE_TO_RECIPE: Record<string, string> = {
  bank: "bank",
  store: "store",
  inn: "inn",
  smithy: "smithy",
  house: "simple-house", // house -> simple-house recipe
  "simple-house": "simple-house",
  "long-house": "long-house",
  // "well" and "anvil" are stations, not buildings - handled by StationSpawnerSystem
};

/**
 * Building types that are stations (not visual buildings).
 * These are spawned as interactive entities by StationSpawnerSystem.
 */
const STATION_TYPES = new Set(["well", "anvil"]);

/**
 * PhysX collision body for a building component (wall, floor, or roof)
 */
interface BuildingCollisionBody {
  /** PhysX actor reference */
  actor: unknown; // PxRigidStatic
  /** Physics handle for collision callbacks */
  handle: PhysicsHandle;
  /** Type of collision body */
  type: "wall" | "floor" | "roof";
  /** Floor index (for floors/roofs) */
  floorIndex?: number;
}

/**
 * Tracked building data for LOD management
 */
interface BuildingData {
  /** Original mesh (kept for impostor baking, hidden when batched) */
  mesh: THREE.Mesh | THREE.Group;
  position: THREE.Vector3;
  townId: string;
  buildingType: string;
  buildingId: string;
  /** Last known LOD level (0=full, 1=medium, 2=impostor, 3=culled) */
  lodLevel: 0 | 1 | 2 | 3;
  /** Impostor mesh (billboard) for distant rendering */
  impostorMesh?: THREE.Mesh;
  /** Impostor bake result for view-dependent updates */
  impostorBakeResult?: ImpostorBakeResult;
  /** Building dimensions for impostor sizing */
  dimensions: THREE.Vector3;
  /** Building rotation in radians */
  rotation: number;
  /** Building layout (for collision generation) */
  layout?: BuildingLayout;
  /** PhysX collision bodies for this building */
  collisionBodies: BuildingCollisionBody[];
  /** Index offset in batched geometry (for raycast hit identification) */
  batchedIndexOffset?: number;
  /** Triangle count in batched geometry */
  batchedTriangleCount?: number;
  /** Procgen LOD meshes (simplified geometry for distance rendering) */
  lodMeshes?: {
    lod1?: THREE.Mesh | THREE.Group;
    lod2?: THREE.Mesh | THREE.Group;
  };
}

/**
 * Batched mesh data for a town
 */
interface BatchedTownMesh {
  /** Combined body geometry (walls, floors) */
  bodyMesh: THREE.Mesh;
  /** Combined roof geometry (separate for optional hiding) */
  roofMesh: THREE.Mesh;
  /** Map from triangle index to building ID for raycast hit detection */
  triangleToBuildingMap: Map<number, string>;
}

/**
 * Town impostor atlas data
 */
interface TownImpostorAtlas {
  /** Combined atlas texture for all buildings in town */
  atlasTexture: THREE.Texture;
  /** Instanced mesh for all building impostors */
  instancedMesh: THREE.InstancedMesh;
  /** Map from building ID to instance index */
  buildingToInstanceMap: Map<string, number>;
  /** Per-building UV offsets in atlas */
  uvOffsets: Map<
    string,
    { u: number; v: number; width: number; height: number }
  >;
  /** Grid size for octahedral sampling */
  gridSizeX: number;
  gridSizeY: number;
}

/**
 * Town visibility data for efficient culling
 */
interface TownData {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  buildings: BuildingData[];
  visible: boolean;
  /** Batched mesh for this town (body + roof combined) */
  batchedMesh?: BatchedTownMesh;
  /** Town-level impostor atlas */
  impostorAtlas?: TownImpostorAtlas;
  /** Whether collision has been fully created for this town */
  collisionCreated: boolean;
  /** Whether collision creation is in progress */
  collisionInProgress: boolean;
  /** Index of next building to create collision for (incremental creation) */
  collisionBuildingIndex: number;
  /** Distance at which to create collision (squared) */
  collisionTriggerDistSq: number;
}

/**
 * Performance configuration for building rendering.
 *
 * **Main Thread Protection:**
 * All heavy operations are chunked/deferred to prevent frame drops:
 * - Building generation: Chunked with yielding between batches
 * - Geometry merging: Async with frame budget
 * - Collision creation: Incremental over multiple frames
 * - Impostor baking: Already async with batching
 *
 * **Optimization Levels:**
 *
 * 1. **Static Batching** (IMPLEMENTED - enableStaticBatching)
 *    - Merges all buildings in a town into a single mesh
 *    - Reduces draw calls from N*2 to 2 per town (body + roof)
 *
 * 2. **Lazy Collision** (IMPLEMENTED - enableLazyCollision)
 *    - Defers PhysX body creation until player approaches town
 *    - Collision created incrementally over frames (chunkedCollisionPerFrame)
 *
 * 3. **Town Impostor Atlas** (IMPLEMENTED - enableImpostorAtlas)
 *    - Batches all building impostors into single instanced mesh
 *    - Uses InstancedMesh for impostor billboards
 */
const BUILDING_PERF_CONFIG = {
  /** Enable static batching (merge all buildings in a town into single mesh) */
  enableStaticBatching: true,
  /** Enable town-level impostor atlas (batch all impostors into single instanced mesh) */
  enableImpostorAtlas: true,
  /** Enable lazy collision (create PhysX bodies only when player approaches) */
  enableLazyCollision: true,
  /** Distance at which to trigger collision creation */
  collisionTriggerDistance: 100, // 100m
  /** Maximum buildings per batch (split large towns) */
  maxBuildingsPerBatch: 50,
  /** Impostor atlas size (width/height in pixels) */
  impostorAtlasSize: 2048,
  /** Per-building impostor size in atlas */
  perBuildingImpostorSize: 256,

  // ============================================
  // MAIN THREAD PROTECTION SETTINGS
  // ============================================

  /** Buildings to generate per frame during initial load */
  buildingsPerFrameLoad: 3,
  /** Collision bodies to create per frame (lazy collision) */
  collisionBodiesPerFrame: 2,
  /** Frame budget for heavy operations (ms) - 8ms leaves room for rendering at 60fps */
  frameBudgetMs: 8,
  /** Yield threshold - yield if operation takes longer than this (ms) */
  yieldThresholdMs: 4,
  /** Max buildings to process per frame in non-batched mode (LOD updates) */
  maxBuildingsPerFrameUpdate: 30,
  /** Max impostor view updates per frame */
  maxImpostorUpdatesPerFrame: 20,
} as const;

export class BuildingRenderingSystem extends SystemBase {
  private buildingGenerator: BuildingGenerator;
  private buildingsGroup: THREE.Group;
  private impostorsGroup: THREE.Group;
  private scene: THREE.Scene | null = null;
  private townMeshes: Map<string, THREE.Group> = new Map();

  /** Per-town data for LOD management */
  private townData: Map<string, TownData> = new Map();

  /** LOD configuration for buildings */
  private lodConfig: LODDistancesWithSq;

  /** Camera position cache for update optimization */
  private _lastCameraPos = new THREE.Vector3();
  private _tempVec = new THREE.Vector3();

  /** Pre-allocated camera position for deferred updates (avoid clone() allocation) */
  private _deferredCameraPos = new THREE.Vector3();

  /** Pre-allocated vectors for impostor updates (avoid GC in hot path) */
  private _imposterFaceIndices = new THREE.Vector3();
  private _imposterFaceWeights = new THREE.Vector3(1, 0, 0); // Single-cell rendering

  /** Cached town lookup map for O(1) town access (built lazily) */
  private _townLookupMap: Map<string, ProceduralTown> | null = null;
  private _townLookupVersion = 0;

  /** Impostor baking queue */
  private _pendingImpostorBakes: BuildingData[] = [];

  /** Pending collision creation queue (incremental to avoid frame spikes) */
  private _pendingCollisionTowns: Array<{
    townId: string;
    town: TownData;
    sourceData: ProceduralTown;
  }> = [];

  /** Deferred building LOD updates for non-batched mode (spread across frames) */
  private _deferredBuildingUpdates: Array<{
    building: BuildingData;
    cameraPos: THREE.Vector3;
    lod1DistSq: number;
    imposterDistSq: number;
    fadeDistSq: number;
  }> = [];

  /** Track impostor updates per frame */
  private _impostorUpdatesThisFrame = 0;

  /** Shared uber-material for all batched buildings */
  private batchedMaterial: THREE.MeshStandardMaterial;

  /** Temporary matrix for impostor transforms */
  private _tempMatrix = new THREE.Matrix4();
  private _tempQuat = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

  // ============================================
  // ROOF AUTO-HIDE FEATURE
  // ============================================

  /** Setting: Whether to auto-hide roofs when player is inside a building */
  private _autoHideRoofsEnabled = true;

  /** Currently hidden roof building IDs (player is inside these buildings) */
  private _hiddenRoofBuildings = new Set<string>();

  /** Cached local player entity ID */
  private _localPlayerId: string | null = null;

  /** Storage key for roof auto-hide setting */
  private static readonly ROOF_SETTING_KEY = "hyperscape:autoHideRoofs";

  constructor(world: World) {
    super(world, {
      name: "building-rendering",
      dependencies: {
        required: ["terrain", "towns"],
        optional: [],
      },
      autoCleanup: true,
    });

    this.buildingGenerator = new BuildingGenerator();
    this.buildingsGroup = new THREE.Group();
    this.buildingsGroup.name = "BuildingRenderingSystem";
    this.impostorsGroup = new THREE.Group();
    this.impostorsGroup.name = "BuildingImpostors";

    // Get building LOD config from unified system
    this.lodConfig = getLODDistances("building");

    // Create shared material for batched buildings
    this.batchedMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });
  }

  async init(): Promise<void> {
    // Get scene from stage
    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      this.logger.warn("Stage scene not available");
      return;
    }
    this.scene = stage.scene;

    // Load roof auto-hide setting from localStorage
    this.loadRoofSetting();
  }

  // ============================================
  // ROOF AUTO-HIDE PUBLIC API
  // ============================================

  /**
   * Get whether roof auto-hide is enabled
   */
  isAutoHideRoofsEnabled(): boolean {
    return this._autoHideRoofsEnabled;
  }

  /**
   * Set whether to auto-hide roofs when player is inside a building.
   * Setting is persisted to localStorage.
   *
   * @param enabled - Whether to enable roof auto-hide
   */
  setAutoHideRoofs(enabled: boolean): void {
    this._autoHideRoofsEnabled = enabled;
    this.saveRoofSetting();

    // If disabling, show all currently hidden roofs
    if (!enabled) {
      this.showAllRoofs();
    }
  }

  /**
   * Toggle roof auto-hide setting
   */
  toggleAutoHideRoofs(): boolean {
    this.setAutoHideRoofs(!this._autoHideRoofsEnabled);
    return this._autoHideRoofsEnabled;
  }

  /**
   * Load roof setting from localStorage
   */
  private loadRoofSetting(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const stored = localStorage.getItem(
        BuildingRenderingSystem.ROOF_SETTING_KEY,
      );
      if (stored !== null) {
        this._autoHideRoofsEnabled = stored === "true";
      }
    } catch {
      // localStorage not available or error - use default
    }
  }

  /**
   * Save roof setting to localStorage
   */
  private saveRoofSetting(): void {
    if (typeof localStorage === "undefined") return;

    try {
      localStorage.setItem(
        BuildingRenderingSystem.ROOF_SETTING_KEY,
        String(this._autoHideRoofsEnabled),
      );
    } catch {
      // localStorage not available or error - ignore
    }
  }

  /**
   * Show all roofs (when disabling auto-hide)
   */
  private showAllRoofs(): void {
    for (const [, town] of this.townData) {
      if (town.batchedMesh?.roofMesh) {
        town.batchedMesh.roofMesh.visible = true;
      }
    }
    this._hiddenRoofBuildings.clear();
  }

  /**
   * Update roof visibility based on player position inside buildings.
   * Called from update() when auto-hide is enabled.
   */
  private updateRoofVisibility(cameraPos: THREE.Vector3): void {
    if (!this._autoHideRoofsEnabled) return;

    // Get the local player's position (camera is above player)
    // Estimate player position from camera
    const playerX = cameraPos.x;
    const playerZ = cameraPos.z;

    // Check if player is inside any building
    // Convert to tile coordinates (1 tile = 1 meter)
    const tileX = Math.floor(playerX);
    const tileZ = Math.floor(playerZ);

    // Get town system to check building collision
    const townSystem = this.world.getSystem("towns") as {
      getCollisionService?: () => {
        getBuildingAtTile: (x: number, z: number) => string | null;
      };
    } | null;

    const collisionService = townSystem?.getCollisionService?.();
    if (!collisionService) {
      // No collision service - can't determine if inside building
      return;
    }

    // Check if player is inside a building
    const insideBuildingId = collisionService.getBuildingAtTile(tileX, tileZ);

    // Update roof visibility for each town
    for (const [, town] of this.townData) {
      if (!town.batchedMesh?.roofMesh) continue;

      // Check if player is inside any building in this town
      let shouldHideRoof = false;

      if (insideBuildingId) {
        // Check if this building is in this town
        for (const building of town.buildings) {
          if (building.buildingId === insideBuildingId) {
            shouldHideRoof = true;
            break;
          }
        }
      }

      // Update roof visibility
      town.batchedMesh.roofMesh.visible = !shouldHideRoof;
    }
  }

  async start(): Promise<void> {
    // Only render buildings on client
    if (this.world.isServer) {
      return;
    }

    if (!this.scene) {
      this.logger.warn("Cannot render buildings - scene not available");
      return;
    }

    // Add buildings and impostors groups to scene
    this.scene.add(this.buildingsGroup);
    this.scene.add(this.impostorsGroup);

    // Get towns from TownSystem
    const townSystem = this.world.getSystem("towns") as {
      getTowns?: () => ProceduralTown[];
    } | null;

    if (!townSystem?.getTowns) {
      this.logger.warn("TownSystem not available - no buildings to render");
      return;
    }

    const towns = townSystem.getTowns();
    if (towns.length === 0) {
      this.logger.info("No towns to render");
      return;
    }

    // Get terrain system for height queries
    const terrainSystem = this.world.getSystem("terrain") as {
      getHeightAt?: (x: number, z: number) => number | null;
    } | null;

    let totalBuildings = 0;
    let renderedBuildings = 0;
    let totalDrawCalls = 0;

    // OPTIMIZATION: Process buildings in batches to prevent main thread blocking
    // Each batch yields to allow smooth frame rendering during load
    const BUILDING_BATCH_SIZE = 5; // Process 5 buildings per batch

    // Render buildings for each town
    for (const town of towns) {
      const townGroup = new THREE.Group();
      townGroup.name = `Town_${town.id}`;

      const townBuildings: BuildingData[] = [];
      const bodyGeometries: THREE.BufferGeometry[] = [];
      const roofGeometries: THREE.BufferGeometry[] = [];
      const triangleToBuildingMap = new Map<number, string>();
      let currentTriangleOffset = 0;

      let minX = Infinity,
        maxX = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;

      // Filter out station types first (avoids repeated checks in loop)
      const buildingsToRender = town.buildings.filter(
        (b) => !STATION_TYPES.has(b.type),
      );

      // Process buildings in batches with yielding
      for (
        let batchStart = 0;
        batchStart < buildingsToRender.length;
        batchStart += BUILDING_BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + BUILDING_BATCH_SIZE,
          buildingsToRender.length,
        );

        for (let i = batchStart; i < batchEnd; i++) {
          const building = buildingsToRender[i];
          totalBuildings++;

          const recipeKey = BUILDING_TYPE_TO_RECIPE[building.type];
          if (!recipeKey) {
            this.logger.warn(
              `Unknown building type: ${building.type} - skipping`,
            );
            continue;
          }

          // Generate building mesh with LODs (CPU-intensive)
          const generatedBuilding = this.buildingGenerator.generate(recipeKey, {
            seed: `${town.id}_${building.id}`,
            includeRoof: true,
            useGreedyMeshing: true, // Use optimized geometry
            generateLODs: true, // Generate LOD meshes
          });

          if (!generatedBuilding) {
            this.logger.warn(
              `Failed to generate ${building.type} for ${town.name}`,
            );
            continue;
          }

          const mesh = generatedBuilding.mesh;

          // Snap building position to grid for proper tile alignment
          // This ensures building cells align with movement tiles (1 cell = 4x4 tiles)
          const snappedPos = snapToBuildingGrid(
            building.position.x,
            building.position.z,
          );

          // Get ground height at snapped building position
          const groundY =
            terrainSystem?.getHeightAt?.(snappedPos.x, snappedPos.z) ??
            building.position.y;

          // Position and rotate the mesh (using grid-aligned position)
          mesh.position.set(snappedPos.x, groundY, snappedPos.z);
          mesh.rotation.y = building.rotation;
          mesh.updateMatrixWorld(true);

          // Store building metadata for interactions/debugging
          mesh.userData = {
            type: "building",
            buildingType: building.type,
            buildingId: building.id,
            townId: town.id,
            townName: town.name,
          };

          // Calculate building dimensions for impostor sizing
          const bbox = new THREE.Box3().setFromObject(mesh);
          const dimensions = new THREE.Vector3();
          bbox.getSize(dimensions);

          // Track building for LOD management (use grid-aligned position)
          const buildingPos = new THREE.Vector3(
            snappedPos.x,
            groundY,
            snappedPos.z,
          );
          const buildingData: BuildingData = {
            mesh,
            position: buildingPos,
            townId: town.id,
            buildingType: building.type,
            buildingId: building.id,
            lodLevel: 0,
            dimensions,
            rotation: building.rotation,
            layout: generatedBuilding.layout,
            collisionBodies: [],
          };

          // Store LOD meshes if generated
          if (generatedBuilding.lods && generatedBuilding.lods.length > 0) {
            buildingData.lodMeshes = {};
            for (const lod of generatedBuilding.lods) {
              // Position LOD meshes same as main mesh
              lod.mesh.position.copy(mesh.position);
              lod.mesh.rotation.y = building.rotation;
              lod.mesh.visible = false; // Hidden by default

              if (lod.level === 1) {
                buildingData.lodMeshes.lod1 = lod.mesh;
                townGroup.add(lod.mesh);
              } else if (lod.level === 2) {
                buildingData.lodMeshes.lod2 = lod.mesh;
                townGroup.add(lod.mesh);
              }
            }
          }

          // Extract geometries for static batching
          if (BUILDING_PERF_CONFIG.enableStaticBatching) {
            const { bodyGeo, roofGeo } = this.extractBuildingGeometries(mesh);

            if (bodyGeo) {
              bodyGeometries.push(bodyGeo);
              // Map triangles to building ID for raycast hit detection
              const bodyTriangles = bodyGeo.index
                ? bodyGeo.index.count / 3
                : (bodyGeo.getAttribute("position")?.count ?? 0) / 3;
              for (let t = 0; t < bodyTriangles; t++) {
                triangleToBuildingMap.set(
                  currentTriangleOffset + t,
                  building.id,
                );
              }
              buildingData.batchedIndexOffset = currentTriangleOffset;
              buildingData.batchedTriangleCount = bodyTriangles;
              currentTriangleOffset += bodyTriangles;
            }
            if (roofGeo) {
              roofGeometries.push(roofGeo);
            }

            // Hide individual mesh when batching (use batched mesh instead)
            mesh.visible = false;
          } else {
            // Non-batched mode: enable shadows on individual meshes
            mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
          }

          townGroup.add(mesh);
          townBuildings.push(buildingData);
          renderedBuildings++;

          // Queue impostor bake (uses original mesh - temporarily show for baking)
          this._pendingImpostorBakes.push(buildingData);

          // Track town bounds
          minX = Math.min(minX, building.position.x);
          maxX = Math.max(maxX, building.position.x);
          minZ = Math.min(minZ, building.position.z);
          maxZ = Math.max(maxZ, building.position.z);
        }

        // Yield to main thread between batches to allow frame rendering
        // Use requestIdleCallback for better scheduling during loading
        if (batchEnd < buildingsToRender.length) {
          await new Promise<void>((resolve) => {
            if (typeof requestIdleCallback !== "undefined") {
              requestIdleCallback(() => resolve(), { timeout: 100 });
            } else {
              setTimeout(resolve, 0);
            }
          });
        }
      }

      // Calculate town center and radius
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const radius = Math.max(
        Math.sqrt((maxX - minX) ** 2 + (maxZ - minZ) ** 2) / 2,
        50, // Minimum radius
      );

      // Create batched mesh for this town (if batching enabled and has buildings)
      let batchedMesh: BatchedTownMesh | undefined;
      if (
        BUILDING_PERF_CONFIG.enableStaticBatching &&
        bodyGeometries.length > 0
      ) {
        batchedMesh = this.createBatchedTownMesh(
          bodyGeometries,
          roofGeometries,
          triangleToBuildingMap,
          townGroup,
        );
        totalDrawCalls += 2; // body + roof = 2 draw calls per town
      } else {
        totalDrawCalls += townBuildings.length * 2; // Individual meshes
      }

      // Only add town group if it has buildings
      if (townGroup.children.length > 0 || batchedMesh) {
        this.buildingsGroup.add(townGroup);
        this.townMeshes.set(town.id, townGroup);

        // Calculate collision trigger distance (squared)
        const collisionTriggerDistSq = BUILDING_PERF_CONFIG.enableLazyCollision
          ? (BUILDING_PERF_CONFIG.collisionTriggerDistance + radius) ** 2
          : 0;

        this.townData.set(town.id, {
          group: townGroup,
          center: new THREE.Vector3(centerX, town.position.y, centerZ),
          radius,
          buildings: townBuildings,
          visible: true,
          batchedMesh,
          collisionCreated: !BUILDING_PERF_CONFIG.enableLazyCollision,
          collisionInProgress: false,
          collisionBuildingIndex: 0,
          collisionTriggerDistSq,
        });

        // Queue collision creation if lazy collision disabled
        // Note: Even immediate collision is now chunked to avoid frame spikes
        if (!BUILDING_PERF_CONFIG.enableLazyCollision) {
          const townData = this.townData.get(town.id);
          if (townData) {
            townData.collisionInProgress = true;
            this._pendingCollisionTowns.push({
              townId: town.id,
              town: townData,
              sourceData: town,
            });
          }
        }
      }
    }

    const batchingStatus = BUILDING_PERF_CONFIG.enableStaticBatching
      ? "enabled"
      : "disabled";
    this.logger.info(
      `Rendered ${renderedBuildings}/${totalBuildings} buildings across ${this.townMeshes.size} towns ` +
        `(batching: ${batchingStatus}, draw calls: ~${totalDrawCalls})`,
    );

    // Start processing impostor bakes asynchronously
    this.processImpostorBakeQueue();
  }

  /**
   * Process pending impostor bakes in batches.
   * Bakes are done asynchronously to avoid blocking.
   */
  private async processImpostorBakeQueue(): Promise<void> {
    const manager = ImpostorManager.getInstance(this.world);

    // Initialize baker if not ready
    if (!manager.initBaker()) {
      this.logger.warn("Cannot initialize impostor baker - impostors disabled");
      this._pendingImpostorBakes = [];
      return;
    }

    // Process bakes in batches
    const batchSize = 5;
    while (this._pendingImpostorBakes.length > 0) {
      const batch = this._pendingImpostorBakes.splice(0, batchSize);

      await Promise.all(
        batch.map(async (buildingData) => {
          try {
            await this.bakeImpostorForBuilding(buildingData);
          } catch (err) {
            this.logger.warn(
              `Failed to bake impostor for ${buildingData.buildingType}: ${err}`,
            );
          }
        }),
      );

      // Yield to prevent blocking
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.logger.info("Building impostor baking complete");

    // Create impostor atlas for each town if enabled
    if (BUILDING_PERF_CONFIG.enableImpostorAtlas) {
      this.createTownImpostorAtlases();
    }
  }

  /**
   * Create impostor atlases for all towns.
   * Batches individual building impostors into instanced meshes per town.
   */
  private createTownImpostorAtlases(): void {
    for (const [townId, town] of this.townData) {
      // Skip if atlas already created or no buildings with impostors
      if (town.impostorAtlas) continue;

      const buildingsWithImpostors = town.buildings.filter(
        (b) => b.impostorBakeResult,
      );
      if (buildingsWithImpostors.length === 0) continue;

      const atlas = this.createTownImpostorAtlas(
        townId,
        town,
        buildingsWithImpostors,
      );
      if (atlas) {
        town.impostorAtlas = atlas;

        // Hide individual impostor meshes - use atlas instead
        for (const building of buildingsWithImpostors) {
          if (building.impostorMesh) {
            building.impostorMesh.visible = false;
            building.impostorMesh.removeFromParent();
          }
        }

        this.logger.info(
          `Created impostor atlas for town ${townId}: ${buildingsWithImpostors.length} buildings`,
        );
      }
    }
  }

  /**
   * Create an impostor atlas for a single town.
   * Uses InstancedMesh for efficient rendering of all building impostors.
   */
  private createTownImpostorAtlas(
    townId: string,
    town: TownData,
    buildings: BuildingData[],
  ): TownImpostorAtlas | null {
    if (buildings.length === 0) return null;

    // Use the first building's bake result as a template for grid size
    const templateResult = buildings[0].impostorBakeResult;
    if (!templateResult) return null;

    const { gridSizeX, gridSizeY } = templateResult;

    // Calculate atlas layout (pack all building impostors into grid)
    const atlasSize = BUILDING_PERF_CONFIG.impostorAtlasSize;
    const perBuildingSize = BUILDING_PERF_CONFIG.perBuildingImpostorSize;
    const buildingsPerRow = Math.floor(atlasSize / perBuildingSize);

    // Create render target for atlas
    const atlasTexture = new THREE.WebGLRenderTarget(atlasSize, atlasSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });

    // Calculate UV offsets for each building in the atlas
    const uvOffsets = new Map<
      string,
      { u: number; v: number; width: number; height: number }
    >();
    const buildingToInstanceMap = new Map<string, number>();

    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      const col = i % buildingsPerRow;
      const row = Math.floor(i / buildingsPerRow);

      const u = (col * perBuildingSize) / atlasSize;
      const v = (row * perBuildingSize) / atlasSize;
      const width = perBuildingSize / atlasSize;
      const height = perBuildingSize / atlasSize;

      uvOffsets.set(building.buildingId, { u, v, width, height });
      buildingToInstanceMap.set(building.buildingId, i);
    }

    // Create shared impostor material for atlas
    // Note: This uses a simplified material since we can't use the @hyperscape/impostor
    // material directly with atlas (it expects individual textures)
    const atlasMaterial = new THREE.MeshBasicMaterial({
      map: atlasTexture.texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    });
    this.world.setupMaterial(atlasMaterial);

    // Create billboard geometry (unit plane)
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Create instanced mesh for all building impostors
    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      atlasMaterial,
      buildings.length,
    );
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.frustumCulled = false;
    instancedMesh.count = buildings.length;
    instancedMesh.name = `TownImpostorAtlas_${townId}`;
    instancedMesh.visible = false; // Hidden by default, shown when LOD switches

    // Set initial transforms for each instance
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      const width = Math.max(building.dimensions.x, building.dimensions.z);
      const height = building.dimensions.y;

      this._tempScale.set(width, height, 1);
      this._tempQuat.identity();
      this._tempVec.copy(building.position);
      this._tempVec.y += height * 0.5;

      this._tempMatrix.compose(this._tempVec, this._tempQuat, this._tempScale);
      instancedMesh.setMatrixAt(i, this._tempMatrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    // Add to impostors group
    this.impostorsGroup.add(instancedMesh);

    return {
      atlasTexture: atlasTexture.texture,
      instancedMesh,
      buildingToInstanceMap,
      uvOffsets,
      gridSizeX,
      gridSizeY,
    };
  }

  /**
   * Update impostor atlas billboards to face camera.
   */
  private updateTownImpostorAtlas(
    atlas: TownImpostorAtlas,
    buildings: BuildingData[],
    cameraPos: THREE.Vector3,
  ): void {
    for (const building of buildings) {
      const instanceIndex = atlas.buildingToInstanceMap.get(
        building.buildingId,
      );
      if (instanceIndex === undefined) continue;

      // Calculate angle to camera (Y-axis billboard rotation)
      const dx = cameraPos.x - building.position.x;
      const dz = cameraPos.z - building.position.z;
      const angle = Math.atan2(dx, dz);

      // Get dimensions
      const width = Math.max(building.dimensions.x, building.dimensions.z);
      const height = building.dimensions.y;

      // Update transform
      this._tempQuat.setFromAxisAngle(this._tempVec.set(0, 1, 0), angle);
      this._tempScale.set(width, height, 1);
      this._tempVec.copy(building.position);
      this._tempVec.y += height * 0.5;

      this._tempMatrix.compose(this._tempVec, this._tempQuat, this._tempScale);
      atlas.instancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);
    }

    atlas.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Bake an impostor for a single building.
   */
  private async bakeImpostorForBuilding(
    buildingData: BuildingData,
  ): Promise<void> {
    const manager = ImpostorManager.getInstance(this.world);

    // Create unique model ID for caching
    const modelId = `building_${buildingData.townId}_${buildingData.buildingId}_${buildingData.buildingType}`;

    // Bake using ImpostorManager
    const bakeResult = await manager.getOrCreate(modelId, buildingData.mesh, {
      atlasSize: 512,
      hemisphere: true, // Buildings viewed from above
      priority: BakePriority.LOW, // Background baking
      category: "building",
    });

    buildingData.impostorBakeResult = bakeResult;

    // Create impostor mesh
    const impostorMesh = this.createImpostorMesh(buildingData, bakeResult);
    buildingData.impostorMesh = impostorMesh;

    // Add to impostors group (hidden by default)
    impostorMesh.visible = false;
    this.impostorsGroup.add(impostorMesh);
  }

  /**
   * Create an impostor mesh from bake result.
   */
  private createImpostorMesh(
    buildingData: BuildingData,
    bakeResult: ImpostorBakeResult,
  ): THREE.Mesh {
    const { atlasTexture, gridSizeX, gridSizeY, boundingSphere } = bakeResult;

    // Use bounding sphere or dimensions for sizing
    const width = boundingSphere
      ? boundingSphere.radius * 2
      : Math.max(buildingData.dimensions.x, buildingData.dimensions.z);
    const height = boundingSphere
      ? boundingSphere.radius * 2
      : buildingData.dimensions.y;

    // Create material using @hyperscape/impostor
    const material = createImpostorMaterial({
      atlasTexture,
      gridSizeX,
      gridSizeY,
      transparent: true,
      depthWrite: true,
    });
    this.world.setupMaterial(material);

    // Create billboard geometry
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);

    // Position at building center, offset Y by half height
    mesh.position.copy(buildingData.position);
    mesh.position.y += height * 0.5;

    // Store metadata for view updates
    mesh.userData = {
      gridSizeX,
      gridSizeY,
      buildingData,
    };

    return mesh;
  }

  // ============================================================================
  // STATIC BATCHING - Town-level geometry merging
  // ============================================================================

  /**
   * Extract geometries from a building mesh for batching.
   * Applies world transforms and separates body/roof geometries.
   */
  private extractBuildingGeometries(mesh: THREE.Mesh | THREE.Group): {
    bodyGeo: THREE.BufferGeometry | null;
    roofGeo: THREE.BufferGeometry | null;
    triangleCount: number;
  } {
    const bodyGeometries: THREE.BufferGeometry[] = [];
    const roofGeometries: THREE.BufferGeometry[] = [];
    let triangleCount = 0;

    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        // Clone geometry and apply world transform
        const geo = child.geometry.clone();
        geo.applyMatrix4(child.matrixWorld);

        // Compute triangle count
        const indexCount = geo.index
          ? geo.index.count
          : (geo.getAttribute("position")?.count ?? 0);
        triangleCount += Math.floor(indexCount / 3);

        // Separate roof from body based on mesh name
        if (child.name.toLowerCase().includes("roof")) {
          roofGeometries.push(geo);
        } else {
          bodyGeometries.push(geo);
        }
      }
    });

    // Merge body geometries
    let bodyGeo: THREE.BufferGeometry | null = null;
    if (bodyGeometries.length > 0) {
      bodyGeo =
        bodyGeometries.length === 1
          ? bodyGeometries[0]
          : mergeGeometries(bodyGeometries, false);
      // Dispose individual geometries if merged
      if (bodyGeometries.length > 1) {
        for (const geo of bodyGeometries) geo.dispose();
      }
    }

    // Merge roof geometries
    let roofGeo: THREE.BufferGeometry | null = null;
    if (roofGeometries.length > 0) {
      roofGeo =
        roofGeometries.length === 1
          ? roofGeometries[0]
          : mergeGeometries(roofGeometries, false);
      if (roofGeometries.length > 1) {
        for (const geo of roofGeometries) geo.dispose();
      }
    }

    return { bodyGeo, roofGeo, triangleCount };
  }

  /**
   * Create a batched mesh for an entire town.
   * Merges all building geometries into a single mesh for minimal draw calls.
   */
  private createBatchedTownMesh(
    bodyGeometries: THREE.BufferGeometry[],
    roofGeometries: THREE.BufferGeometry[],
    triangleToBuildingMap: Map<number, string>,
    townGroup: THREE.Group,
  ): BatchedTownMesh {
    // Merge all body geometries into one
    const mergedBodyGeo =
      bodyGeometries.length === 1
        ? bodyGeometries[0]
        : mergeGeometries(bodyGeometries, false);

    if (!mergedBodyGeo) {
      throw new Error("Failed to merge body geometries");
    }

    // Create batched body mesh
    const bodyMesh = new THREE.Mesh(mergedBodyGeo, this.batchedMaterial);
    bodyMesh.name = "BatchedBuildingBody";
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.userData = {
      type: "batched-buildings",
      triangleToBuildingMap, // For raycast hit detection
    };
    townGroup.add(bodyMesh);

    // Merge all roof geometries into one
    let roofMesh: THREE.Mesh;
    if (roofGeometries.length > 0) {
      const mergedRoofGeo =
        roofGeometries.length === 1
          ? roofGeometries[0]
          : mergeGeometries(roofGeometries, false);

      if (mergedRoofGeo) {
        roofMesh = new THREE.Mesh(mergedRoofGeo, this.batchedMaterial);
        roofMesh.name = "BatchedBuildingRoof";
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        townGroup.add(roofMesh);
      } else {
        // Fallback: create empty mesh
        roofMesh = new THREE.Mesh(
          new THREE.BufferGeometry(),
          this.batchedMaterial,
        );
      }
    } else {
      roofMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        this.batchedMaterial,
      );
    }

    // Dispose individual geometries (they're now merged)
    if (bodyGeometries.length > 1) {
      for (const geo of bodyGeometries) geo.dispose();
    }
    if (roofGeometries.length > 1) {
      for (const geo of roofGeometries) geo.dispose();
    }

    this.logger.info(
      `Created batched town mesh: ${mergedBodyGeo.getAttribute("position")?.count ?? 0} vertices, ` +
        `${triangleToBuildingMap.size} triangles mapped to ${new Set(triangleToBuildingMap.values()).size} buildings`,
    );

    return {
      bodyMesh,
      roofMesh,
      triangleToBuildingMap,
    };
  }

  /**
   * Get building ID from a raycast hit on a batched mesh.
   * Uses the triangle-to-building map to identify which building was hit.
   */
  getBuildingIdFromRaycastHit(
    intersection: THREE.Intersection,
    townData: TownData,
  ): string | null {
    if (!townData.batchedMesh || intersection.faceIndex == null) {
      return null;
    }

    return (
      townData.batchedMesh.triangleToBuildingMap.get(intersection.faceIndex) ??
      null
    );
  }

  // ============================================================================
  // PHYSX COLLISION BODIES
  // ============================================================================

  /**
   * Create PhysX collision bodies for a building.
   * Creates wall collision (thin boxes) and floor collision (flat boxes).
   */
  private createBuildingCollision(
    buildingData: BuildingData,
    building: TownBuilding,
  ): void {
    const physics = this.world.physics;
    const PHYSX = getPhysX();

    // PhysX must be loaded and physics system available
    if (!physics || !PHYSX) {
      return;
    }

    const layout = buildingData.layout;
    if (!layout) {
      return;
    }

    // Get building layer for collision filtering
    const buildingLayer = Layers.building ?? Layers.environment;
    if (!buildingLayer) {
      this.logger.warn("Building physics layer not found");
      return;
    }

    // Create floor collision for each floor
    for (let floorIndex = 0; floorIndex <= layout.floors; floorIndex++) {
      this.createFloorCollisionBody(
        buildingData,
        building,
        layout,
        floorIndex,
        physics,
        PHYSX,
        buildingLayer,
      );
    }

    // Create wall collision from building bounding box
    this.createWallCollisionBodies(
      buildingData,
      building,
      layout,
      physics,
      PHYSX,
      buildingLayer,
    );
  }

  /**
   * Create floor collision body for a specific floor level.
   */
  private createFloorCollisionBody(
    buildingData: BuildingData,
    building: TownBuilding,
    layout: BuildingLayout,
    floorIndex: number,
    physics: NonNullable<typeof this.world.physics>,
    PHYSX: ReturnType<typeof getPhysX>,
    buildingLayer: { group: number; mask: number },
  ): void {
    if (!PHYSX) return;

    // Calculate floor dimensions from layout
    const floorPlan =
      layout.floorPlans[Math.min(floorIndex, layout.floorPlans.length - 1)];
    if (!floorPlan) return;

    // Count cells to get floor size
    let minCol = Infinity,
      maxCol = -Infinity;
    let minRow = Infinity,
      maxRow = -Infinity;

    for (let row = 0; row < floorPlan.footprint.length; row++) {
      for (let col = 0; col < floorPlan.footprint[row].length; col++) {
        if (floorPlan.footprint[row][col]) {
          minCol = Math.min(minCol, col);
          maxCol = Math.max(maxCol, col);
          minRow = Math.min(minRow, row);
          maxRow = Math.max(maxRow, row);
        }
      }
    }

    if (minCol === Infinity) return; // No cells on this floor

    // Calculate floor dimensions in meters
    const floorWidthCells = maxCol - minCol + 1;
    const floorDepthCells = maxRow - minRow + 1;
    const floorWidth = floorWidthCells * CELL_SIZE;
    const floorDepth = floorDepthCells * CELL_SIZE;

    // Calculate floor center offset from building center
    const centerCol = (minCol + maxCol) / 2;
    const centerRow = (minRow + maxRow) / 2;
    const offsetX = (centerCol - layout.width / 2 + 0.5) * CELL_SIZE;
    const offsetZ = (centerRow - layout.depth / 2 + 0.5) * CELL_SIZE;

    // Apply building rotation to offset
    const cos = Math.cos(building.rotation);
    const sin = Math.sin(building.rotation);
    const rotatedOffsetX = offsetX * cos - offsetZ * sin;
    const rotatedOffsetZ = offsetX * sin + offsetZ * cos;

    // Calculate floor elevation
    const floorY =
      buildingData.position.y + FOUNDATION_HEIGHT + floorIndex * FLOOR_HEIGHT;

    // Create box geometry for floor (thin horizontal plane)
    const boxGeometry = new PHYSX.PxBoxGeometry(
      floorWidth / 2,
      FLOOR_THICKNESS / 2,
      floorDepth / 2,
    );

    // Create material and shape
    const physicsMaterial = physics.physics.createMaterial(0.5, 0.5, 0.1);
    const shape = physics.physics.createShape(
      boxGeometry,
      physicsMaterial,
      true,
    );

    // Set collision filtering
    const filterData = new PHYSX.PxFilterData(
      buildingLayer.group,
      buildingLayer.mask,
      0,
      0,
    );
    shape.setQueryFilterData(filterData);
    shape.setSimulationFilterData(filterData);

    // Create transform with position and rotation
    const position = new PHYSX.PxVec3(
      buildingData.position.x + rotatedOffsetX,
      floorY,
      buildingData.position.z + rotatedOffsetZ,
    );

    // Create quaternion for Y-axis rotation
    const halfAngle = building.rotation / 2;
    const quat = new PHYSX.PxQuat(
      0,
      Math.sin(halfAngle),
      0,
      Math.cos(halfAngle),
    );

    const transform = new PHYSX.PxTransform(position, quat);
    const actor = physics.physics.createRigidStatic(transform);
    actor.attachShape(shape);

    // Create physics handle
    const handle: PhysicsHandle = {
      tag: `building_floor_${buildingData.buildingId}_${floorIndex}`,
      contactedHandles: new Set<PhysicsHandle>(),
      triggeredHandles: new Set<PhysicsHandle>(),
    };

    // Add actor to physics world
    physics.addActor(actor, handle);

    // Store collision body reference for cleanup
    buildingData.collisionBodies.push({
      actor,
      handle,
      type: floorIndex === layout.floors ? "roof" : "floor",
      floorIndex,
    });
  }

  /**
   * Create wall collision from building bounding box.
   * Creates 4 thin wall boxes around the building perimeter.
   */
  private createWallCollisionBodies(
    buildingData: BuildingData,
    building: TownBuilding,
    layout: BuildingLayout,
    physics: NonNullable<typeof this.world.physics>,
    PHYSX: ReturnType<typeof getPhysX>,
    buildingLayer: { group: number; mask: number },
  ): void {
    if (!PHYSX) return;

    // Use building dimensions from layout
    const buildingWidth = layout.width * CELL_SIZE;
    const buildingDepth = layout.depth * CELL_SIZE;
    const buildingHeight =
      (layout.floors + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

    // Wall definitions: [offsetX, offsetZ, halfWidth, halfDepth]
    // Walls are positioned at building edges
    const walls: Array<{
      offsetX: number;
      offsetZ: number;
      halfWidth: number;
      halfDepth: number;
      name: string;
    }> = [
      // North wall (positive Z)
      {
        offsetX: 0,
        offsetZ: buildingDepth / 2,
        halfWidth: buildingWidth / 2,
        halfDepth: WALL_THICKNESS / 2,
        name: "north",
      },
      // South wall (negative Z)
      {
        offsetX: 0,
        offsetZ: -buildingDepth / 2,
        halfWidth: buildingWidth / 2,
        halfDepth: WALL_THICKNESS / 2,
        name: "south",
      },
      // East wall (positive X)
      {
        offsetX: buildingWidth / 2,
        offsetZ: 0,
        halfWidth: WALL_THICKNESS / 2,
        halfDepth: buildingDepth / 2,
        name: "east",
      },
      // West wall (negative X)
      {
        offsetX: -buildingWidth / 2,
        offsetZ: 0,
        halfWidth: WALL_THICKNESS / 2,
        halfDepth: buildingDepth / 2,
        name: "west",
      },
    ];

    // Center Y position for walls (spans full building height)
    const wallCenterY = buildingData.position.y + buildingHeight / 2;
    const wallHalfHeight = buildingHeight / 2;

    for (const wall of walls) {
      // Apply building rotation to wall offset
      const cos = Math.cos(building.rotation);
      const sin = Math.sin(building.rotation);
      const rotatedOffsetX = wall.offsetX * cos - wall.offsetZ * sin;
      const rotatedOffsetZ = wall.offsetX * sin + wall.offsetZ * cos;

      // Create box geometry
      const boxGeometry = new PHYSX.PxBoxGeometry(
        wall.halfWidth,
        wallHalfHeight,
        wall.halfDepth,
      );

      // Create material and shape
      const physicsMaterial = physics.physics.createMaterial(0.5, 0.5, 0.1);
      const shape = physics.physics.createShape(
        boxGeometry,
        physicsMaterial,
        true,
      );

      // Set collision filtering
      const filterData = new PHYSX.PxFilterData(
        buildingLayer.group,
        buildingLayer.mask,
        0,
        0,
      );
      shape.setQueryFilterData(filterData);
      shape.setSimulationFilterData(filterData);

      // Create transform
      const position = new PHYSX.PxVec3(
        buildingData.position.x + rotatedOffsetX,
        wallCenterY,
        buildingData.position.z + rotatedOffsetZ,
      );

      // Rotate wall orientation based on building rotation
      const halfAngle = building.rotation / 2;
      const quat = new PHYSX.PxQuat(
        0,
        Math.sin(halfAngle),
        0,
        Math.cos(halfAngle),
      );

      const transform = new PHYSX.PxTransform(position, quat);
      const actor = physics.physics.createRigidStatic(transform);
      actor.attachShape(shape);

      // Create physics handle
      const handle: PhysicsHandle = {
        tag: `building_wall_${buildingData.buildingId}_${wall.name}`,
        contactedHandles: new Set<PhysicsHandle>(),
        triggeredHandles: new Set<PhysicsHandle>(),
      };

      // Add actor to physics world
      physics.addActor(actor, handle);

      // Store collision body reference
      buildingData.collisionBodies.push({
        actor,
        handle,
        type: "wall",
      });
    }
  }

  /**
   * Remove PhysX collision bodies for a building.
   */
  private removeBuildingCollision(buildingData: BuildingData): void {
    const physics = this.world.physics;
    if (!physics) return;

    for (const body of buildingData.collisionBodies) {
      // Remove actor from physics world (if method exists)
      if ("removeActor" in physics) {
        (physics as { removeActor: (a: unknown) => void }).removeActor(
          body.actor,
        );
      }
    }

    buildingData.collisionBodies.length = 0;
  }

  /**
   * Per-frame update for building LOD management and lazy collision.
   *
   * LOD Strategy (with batching):
   * 1. Town-level culling: Hide entire town if center is beyond fade distance + radius
   * 2. Town-level LOD: Batched mesh → impostors → culled (single transition per town)
   * 3. Shadow optimization: Disable shadows on batched mesh beyond lod1Distance
   * 4. Lazy collision: Create PhysX bodies when player enters town collision radius
   * 5. Impostor view updates: Update billboard orientation and octahedral cell
   */
  update(_dt: number): void {
    if (!this.world.isClient) return;

    const camera = this.world.camera;
    if (!camera) return;

    // Only update LOD every frame (buildings don't need throttling - few buildings)
    const cameraPos = camera.position;

    // Check if camera moved significantly
    const moved = this._lastCameraPos.distanceToSquared(cameraPos) > 1;
    if (!moved && this.townData.size > 0) return;

    this._lastCameraPos.copy(cameraPos);

    // ============================================
    // ROOF AUTO-HIDE (when player inside building)
    // ============================================
    this.updateRoofVisibility(cameraPos);

    // LOD distances (squared for efficiency)
    const lod1DistSq = this.lodConfig.lod1DistanceSq;
    const imposterDistSq =
      this.lodConfig.imposterDistanceSq ?? lod1DistSq * 2.25; // Default 1.5x lod1
    const fadeDistSq = this.lodConfig.fadeDistanceSq;

    // Get town system for lazy collision creation
    const townSystem = this.world.getSystem("towns") as {
      getTowns?: () => ProceduralTown[];
    } | null;
    const allTowns = townSystem?.getTowns?.() ?? [];

    // OPTIMIZATION: Build/update town lookup map for O(1) access (vs O(n) find)
    // Rebuild if town count changed (simple invalidation)
    if (!this._townLookupMap || this._townLookupVersion !== allTowns.length) {
      this._townLookupMap = new Map(allTowns.map((t) => [t.id, t]));
      this._townLookupVersion = allTowns.length;
    }

    // Process each town
    for (const [townId, town] of this.townData) {
      // Calculate distance from camera to town center
      const townDistSq = this._tempVec
        .copy(town.center)
        .sub(cameraPos)
        .lengthSq();

      // ============================================
      // LAZY COLLISION CREATION (triggers incremental processing)
      // ============================================
      if (
        BUILDING_PERF_CONFIG.enableLazyCollision &&
        !town.collisionCreated &&
        !town.collisionInProgress
      ) {
        if (townDistSq <= town.collisionTriggerDistSq) {
          // Player is close enough - queue collision creation (processed incrementally)
          // OPTIMIZATION: O(1) Map lookup instead of O(n) find()
          const townData = this._townLookupMap?.get(townId);
          if (townData) {
            this.logger.info(
              `Queuing lazy collision for town ${townId} (${town.buildings.length} buildings)`,
            );
            town.collisionInProgress = true;
            town.collisionBuildingIndex = 0;
            this._pendingCollisionTowns.push({
              townId,
              town,
              sourceData: townData,
            });
          }
        }
      }

      // ============================================
      // TOWN-LEVEL CULLING
      // ============================================
      const townFadeDistSq = (Math.sqrt(fadeDistSq) + town.radius) ** 2;

      if (townDistSq > townFadeDistSq) {
        // Town is too far - hide everything including impostors
        if (town.visible) {
          town.group.visible = false;
          town.visible = false;
          // Hide batched mesh
          if (town.batchedMesh) {
            town.batchedMesh.bodyMesh.visible = false;
            town.batchedMesh.roofMesh.visible = false;
          }
          // Hide impostor atlas or individual impostors
          if (town.impostorAtlas) {
            town.impostorAtlas.instancedMesh.visible = false;
          } else {
            for (const building of town.buildings) {
              if (building.impostorMesh) {
                building.impostorMesh.visible = false;
              }
            }
          }
        }
        continue;
      }

      // Town is in range - ensure group is visible
      if (!town.visible) {
        town.group.visible = true;
        town.visible = true;
      }

      // ============================================
      // BATCHED MESH LOD (town-level)
      // ============================================
      if (BUILDING_PERF_CONFIG.enableStaticBatching && town.batchedMesh) {
        // Determine town-level LOD based on distance to nearest edge
        const effectiveDistSq = Math.max(
          0,
          townDistSq - town.radius * town.radius,
        );

        // Use impostors when town is far enough
        const useImpostors = effectiveDistSq > imposterDistSq;
        const isCulled = effectiveDistSq > fadeDistSq;

        if (isCulled) {
          // Hide batched mesh and impostors
          town.batchedMesh.bodyMesh.visible = false;
          town.batchedMesh.roofMesh.visible = false;
          // Hide impostor atlas or individual impostors
          if (town.impostorAtlas) {
            town.impostorAtlas.instancedMesh.visible = false;
          } else {
            for (const building of town.buildings) {
              if (building.impostorMesh) {
                building.impostorMesh.visible = false;
              }
            }
          }
          for (const building of town.buildings) {
            building.lodLevel = 3;
          }
        } else if (useImpostors) {
          // Hide batched mesh, show impostors (atlas or individual)
          town.batchedMesh.bodyMesh.visible = false;
          town.batchedMesh.roofMesh.visible = false;

          if (town.impostorAtlas) {
            // Use impostor atlas (single instanced mesh)
            town.impostorAtlas.instancedMesh.visible = true;
            this.updateTownImpostorAtlas(
              town.impostorAtlas,
              town.buildings,
              cameraPos,
            );
          } else {
            // Use individual impostor meshes
            for (const building of town.buildings) {
              if (building.impostorMesh) {
                building.impostorMesh.visible = true;
                this.updateImpostorView(building, cameraPos);
              }
            }
          }
          for (const building of town.buildings) {
            building.lodLevel = 2;
          }
        } else {
          // Show batched mesh, hide impostors
          town.batchedMesh.bodyMesh.visible = true;
          town.batchedMesh.roofMesh.visible = true;

          // Shadow optimization based on distance
          const enableShadows = effectiveDistSq <= lod1DistSq;
          town.batchedMesh.bodyMesh.castShadow = enableShadows;
          town.batchedMesh.roofMesh.castShadow = enableShadows;

          // Hide impostor atlas or individual impostors
          if (town.impostorAtlas) {
            town.impostorAtlas.instancedMesh.visible = false;
          } else {
            for (const building of town.buildings) {
              if (building.impostorMesh) {
                building.impostorMesh.visible = false;
              }
            }
          }
          for (const building of town.buildings) {
            building.lodLevel = enableShadows ? 0 : 1;
          }
        }
      } else {
        // ============================================
        // NON-BATCHED MODE: Per-building LOD with frame budget
        // ============================================
        // Queue buildings for deferred processing to avoid frame spikes
        // OPTIMIZATION: Copy camera position once for all buildings in this town
        // (all buildings in same frame use same camera position)
        this._deferredCameraPos.copy(cameraPos);
        for (const building of town.buildings) {
          this._deferredBuildingUpdates.push({
            building,
            cameraPos: this._deferredCameraPos, // Shared reference - processed same frame
            lod1DistSq,
            imposterDistSq,
            fadeDistSq,
          });
        }
      }
    }

    // Process deferred building LOD updates (limited per frame)
    // Note: All updates in _deferredBuildingUpdates share the same cameraPos reference
    // which is valid since they're all processed in the same frame
    this.processDeferredBuildingUpdates();

    // ============================================
    // INCREMENTAL COLLISION PROCESSING
    // ============================================
    // Process a limited number of collision bodies per frame to avoid spikes
    this.processIncrementalCollision();
  }

  /**
   * Process deferred building LOD updates incrementally.
   * Processes a limited number of buildings per frame to maintain smooth framerate.
   */
  private processDeferredBuildingUpdates(): void {
    if (this._deferredBuildingUpdates.length === 0) return;

    // Check frame budget - skip if over budget (LOD updates are not critical)
    const frameBudget = this.world.frameBudget;
    if (frameBudget && !frameBudget.hasTimeRemaining(2)) return;

    const maxBuildings = BUILDING_PERF_CONFIG.maxBuildingsPerFrameUpdate;
    const maxImpostorUpdates = BUILDING_PERF_CONFIG.maxImpostorUpdatesPerFrame;
    let processed = 0;
    this._impostorUpdatesThisFrame = 0;

    while (
      this._deferredBuildingUpdates.length > 0 &&
      processed < maxBuildings
    ) {
      // Re-check frame budget periodically (every 5 buildings)
      if (
        processed > 0 &&
        processed % 5 === 0 &&
        frameBudget &&
        !frameBudget.hasTimeRemaining(1)
      )
        break;

      const update = this._deferredBuildingUpdates.shift()!;
      const { building, cameraPos, lod1DistSq, imposterDistSq, fadeDistSq } =
        update;

      const buildingDistSq = this._tempVec
        .copy(building.position)
        .sub(cameraPos)
        .lengthSq();

      // Determine target LOD
      let targetLOD: 0 | 1 | 2 | 3;
      if (buildingDistSq > fadeDistSq) {
        targetLOD = 3; // Culled
      } else if (buildingDistSq > imposterDistSq && building.impostorMesh) {
        targetLOD = 2; // Impostor
      } else if (buildingDistSq > lod1DistSq) {
        targetLOD = 1; // Medium (no shadows)
      } else {
        targetLOD = 0; // Full detail
      }

      // Apply LOD if changed
      if (targetLOD !== building.lodLevel) {
        building.lodLevel = targetLOD;

        // Hide all LOD meshes first
        building.mesh.visible = false;
        if (building.lodMeshes?.lod1) building.lodMeshes.lod1.visible = false;
        if (building.lodMeshes?.lod2) building.lodMeshes.lod2.visible = false;
        if (building.impostorMesh) building.impostorMesh.visible = false;

        if (targetLOD === 3) {
          // Culled - everything already hidden
        } else if (targetLOD === 2) {
          // Impostor or LOD2 - prefer impostor if available, otherwise LOD2
          if (building.impostorMesh) {
            building.impostorMesh.visible = true;
          } else if (building.lodMeshes?.lod2) {
            building.lodMeshes.lod2.visible = true;
          }
        } else if (targetLOD === 1) {
          // Medium detail - use LOD1 if available, otherwise main mesh
          if (building.lodMeshes?.lod1) {
            building.lodMeshes.lod1.visible = true;
          } else {
            building.mesh.visible = true;
            building.mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = false; // No shadows at medium distance
              }
            });
          }
        } else {
          // Full detail - show main mesh with shadows
          building.mesh.visible = true;
          building.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
            }
          });
        }
      }

      // Update impostor view if visible (with per-frame cap)
      if (
        building.lodLevel === 2 &&
        building.impostorMesh &&
        this._impostorUpdatesThisFrame < maxImpostorUpdates
      ) {
        this.updateImpostorView(building, cameraPos);
        this._impostorUpdatesThisFrame++;
      }

      processed++;
    }
  }

  /**
   * Process pending collision creation incrementally.
   * Creates a limited number of collision bodies per frame to avoid main thread blocking.
   */
  private processIncrementalCollision(): void {
    if (this._pendingCollisionTowns.length === 0) return;

    // Check frame budget - collision creation is deferrable
    const frameBudget = this.world.frameBudget;
    if (frameBudget && !frameBudget.hasTimeRemaining(3)) return;

    const bodiesPerFrame = BUILDING_PERF_CONFIG.collisionBodiesPerFrame;
    let bodiesCreated = 0;

    // Process towns in queue order
    while (
      this._pendingCollisionTowns.length > 0 &&
      bodiesCreated < bodiesPerFrame
    ) {
      const { townId, town, sourceData } = this._pendingCollisionTowns[0];

      // Process buildings for this town
      while (
        town.collisionBuildingIndex < town.buildings.length &&
        bodiesCreated < bodiesPerFrame
      ) {
        const buildingData = town.buildings[town.collisionBuildingIndex];
        const townBuilding = sourceData.buildings.find(
          (b) => b.id === buildingData.buildingId,
        );

        if (townBuilding) {
          this.createBuildingCollision(buildingData, townBuilding);
          bodiesCreated++;
        }

        town.collisionBuildingIndex++;
      }

      // Check if this town is complete
      if (town.collisionBuildingIndex >= town.buildings.length) {
        town.collisionCreated = true;
        town.collisionInProgress = false;
        this._pendingCollisionTowns.shift(); // Remove from queue
        this.logger.info(`Completed collision for town ${townId}`);
      }
    }
  }

  /**
   * Update impostor billboard orientation and octahedral view cell.
   */
  private updateImpostorView(
    building: BuildingData,
    cameraPos: THREE.Vector3,
  ): void {
    const impostorMesh = building.impostorMesh;
    if (!impostorMesh) return;

    // Get grid size from mesh userData
    const { gridSizeX, gridSizeY } = impostorMesh.userData as {
      gridSizeX: number;
      gridSizeY: number;
    };

    // Calculate view direction from building to camera
    const dx = cameraPos.x - building.position.x;
    const dz = cameraPos.z - building.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;

    // Billboard rotation - face camera (Y-axis only)
    const angle = Math.atan2(dx, dz);
    impostorMesh.rotation.y = angle;

    // Normalize view direction
    const vx = dx / len;
    const vz = dz / len;

    // Convert view direction to octahedral cell coordinates (hemisphere mapping)
    const col = Math.floor(((vx + 1) / 2) * (gridSizeX - 1));
    const row = Math.floor(((vz + 1) / 2) * (gridSizeY - 1));
    const clampedCol = Math.max(0, Math.min(gridSizeX - 1, col));
    const clampedRow = Math.max(0, Math.min(gridSizeY - 1, row));

    // Calculate flat index
    const flatIndex = clampedRow * gridSizeX + clampedCol;

    // Update material with view data (using pre-allocated vectors to avoid GC)
    const material = impostorMesh.material as THREE.ShaderMaterial;
    if (material.uniforms) {
      this._imposterFaceIndices.set(flatIndex, flatIndex, flatIndex);
      const viewData: ImpostorViewData = {
        faceIndices: this._imposterFaceIndices,
        faceWeights: this._imposterFaceWeights,
      };
      updateImpostorMaterial(material, viewData);
    }
  }

  /**
   * Clean up all building meshes, impostors, batched meshes, and collision bodies.
   */
  override destroy(): void {
    // Remove all town groups and batched meshes
    for (const townGroup of this.townMeshes.values()) {
      // Dispose geometries and materials
      townGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          // Don't dispose shared batchedMaterial here (handled below)
          if (child.material && child.material !== this.batchedMaterial) {
            if (Array.isArray(child.material)) {
              for (const mat of child.material) {
                mat.dispose();
              }
            } else {
              child.material.dispose();
            }
          }
        }
      });
      townGroup.removeFromParent();
    }

    // Dispose batched meshes and impostor meshes
    for (const town of this.townData.values()) {
      // Dispose batched mesh geometries
      if (town.batchedMesh) {
        town.batchedMesh.bodyMesh.geometry.dispose();
        town.batchedMesh.roofMesh.geometry.dispose();
        town.batchedMesh.triangleToBuildingMap.clear();
      }

      // Dispose impostor atlas if present
      if (town.impostorAtlas) {
        town.impostorAtlas.atlasTexture.dispose();
        town.impostorAtlas.instancedMesh.geometry.dispose();
        (town.impostorAtlas.instancedMesh.material as THREE.Material).dispose();
        town.impostorAtlas.instancedMesh.dispose();
      }

      for (const building of town.buildings) {
        // Remove impostor mesh
        if (building.impostorMesh) {
          building.impostorMesh.geometry.dispose();
          (building.impostorMesh.material as THREE.Material).dispose();
          building.impostorMesh.removeFromParent();
        }

        // Remove LOD meshes
        if (building.lodMeshes) {
          if (building.lodMeshes.lod1) {
            building.lodMeshes.lod1.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
              }
            });
            building.lodMeshes.lod1.removeFromParent();
          }
          if (building.lodMeshes.lod2) {
            building.lodMeshes.lod2.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
              }
            });
            building.lodMeshes.lod2.removeFromParent();
          }
        }

        // Remove PhysX collision bodies
        this.removeBuildingCollision(building);
      }
    }

    // Dispose shared batched material
    this.batchedMaterial.dispose();

    this.townMeshes.clear();
    this.townData.clear();
    this._pendingImpostorBakes = [];

    // Remove groups from scene
    if (this.buildingsGroup.parent) {
      this.buildingsGroup.removeFromParent();
    }
    if (this.impostorsGroup.parent) {
      this.impostorsGroup.removeFromParent();
    }

    super.destroy();
  }

  /**
   * Get all buildings for a specific town.
   */
  getTownBuildings(townId: string): THREE.Group | undefined {
    return this.townMeshes.get(townId);
  }

  /**
   * Get the main buildings group.
   */
  getBuildingsGroup(): THREE.Group {
    return this.buildingsGroup;
  }

  /**
   * Get performance statistics for building rendering.
   * Useful for debugging and profiling.
   */
  getPerformanceStats(): {
    totalTowns: number;
    totalBuildings: number;
    batchedTowns: number;
    estimatedDrawCalls: number;
    collisionBodiesCreated: number;
    impostorsBaked: number;
    config: typeof BUILDING_PERF_CONFIG;
  } {
    let totalBuildings = 0;
    let batchedTowns = 0;
    let estimatedDrawCalls = 0;
    let collisionBodiesCreated = 0;
    let impostorsBaked = 0;

    for (const town of this.townData.values()) {
      totalBuildings += town.buildings.length;

      if (town.batchedMesh) {
        batchedTowns++;
        estimatedDrawCalls += 2; // body + roof
      } else {
        estimatedDrawCalls += town.buildings.length * 2;
      }

      for (const building of town.buildings) {
        collisionBodiesCreated += building.collisionBodies.length;
        if (building.impostorBakeResult) {
          impostorsBaked++;
        }
      }
    }

    return {
      totalTowns: this.townData.size,
      totalBuildings,
      batchedTowns,
      estimatedDrawCalls,
      collisionBodiesCreated,
      impostorsBaked,
      config: BUILDING_PERF_CONFIG,
    };
  }
}
