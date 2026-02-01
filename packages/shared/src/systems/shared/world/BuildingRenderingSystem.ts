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

import THREE, {
  uniform,
  sub,
  add,
  mul,
  div,
  Fn,
  MeshStandardNodeMaterial,
  float,
  smoothstep,
  positionWorld,
  step,
  max,
  clamp,
  sqrt,
  mod,
  floor,
  abs,
  viewportCoordinate,
} from "../../../extras/three/three";
import { MeshBasicNodeMaterial } from "three/webgpu";
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
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  FLOOR_HEIGHT,
  FOUNDATION_HEIGHT,
  snapToBuildingGrid,
} from "@hyperscape/procgen/building";
import { getLODDistances, type LODDistancesWithSq } from "./GPUVegetation";
import { ImpostorManager, BakePriority, ImpostorBakeMode } from "../rendering";
import {
  createTSLImpostorMaterial,
  isTSLImpostorMaterial,
  type ImpostorBakeResult,
  type TSLImpostorMaterial,
} from "@hyperscape/impostor";
import { getPhysX } from "../../../physics/PhysXManager";
import { Layers } from "../../../physics/Layers";
import type { PhysicsHandle } from "../../../types/systems/physics";

// ============================================================================
// BUILDING OCCLUSION CONFIG
// ============================================================================

/**
 * Building occlusion shader configuration.
 * Uses dithered/stippled effect like RuneScape for seeing character through walls.
 * Values are intentionally smaller than vegetation for subtle visibility.
 */
export const BUILDING_OCCLUSION_CONFIG = {
  /** Radius at camera end of the cone (meters) */
  CAMERA_RADIUS: 0.15,

  /** Radius at player end of the cone (meters) - smaller bubble around player */
  PLAYER_RADIUS: 0.8,

  /** Extra radius added based on camera distance */
  DISTANCE_SCALE: 0.02,

  /** Minimum distance from camera before occlusion kicks in */
  NEAR_MARGIN: 0.2,

  /** Distance from player where occlusion stops */
  FAR_MARGIN: 0.2,

  /** Sharpness of the cutoff edge (higher = sharper stipple pattern) */
  EDGE_SHARPNESS: 0.7,

  /** Occlusion strength (0 = disabled, only near-camera dissolve active) */
  STRENGTH: 0.0,

  // ========== NEAR-CAMERA DISSOLVE (RuneScape-style depth fade) ==========
  // Prevents hard geometry clipping when camera clips through objects

  /** Distance from camera where near-fade begins (meters) - fully opaque beyond this */
  NEAR_FADE_START: 1.5,

  /** Distance from camera where geometry is fully dissolved (meters) - at near clip */
  NEAR_FADE_END: 0.05,
} as const;

// ============================================================================
// BUILDING OCCLUSION MATERIAL
// ============================================================================

/**
 * Uniforms for building occlusion material.
 */
export type BuildingOcclusionUniforms = {
  playerPos: { value: THREE.Vector3 };
  cameraPos: { value: THREE.Vector3 };
};

/**
 * Building material with occlusion uniforms attached.
 */
export type BuildingOcclusionMaterial = MeshStandardNodeMaterial & {
  occlusionUniforms: BuildingOcclusionUniforms;
};

/**
 * Creates a building material with dithered occlusion dissolve.
 * Uses TSL (Three Shading Language) for GPU-accelerated occlusion.
 *
 * The shader creates a cone-shaped dissolve from camera to player,
 * using a dithered/stippled pattern like classic RuneScape.
 *
 * @returns Material with occlusion shader
 */
function createBuildingOcclusionMaterial(): BuildingOcclusionMaterial {
  const material = new MeshStandardNodeMaterial();

  // Create uniforms
  const uPlayerPos = uniform(new THREE.Vector3(0, 0, 0));
  const uCameraPos = uniform(new THREE.Vector3(0, 0, 0));

  // Config as shader constants - Player occlusion cone
  const occlusionCameraRadius = float(BUILDING_OCCLUSION_CONFIG.CAMERA_RADIUS);
  const occlusionPlayerRadius = float(BUILDING_OCCLUSION_CONFIG.PLAYER_RADIUS);
  const occlusionDistanceScale = float(
    BUILDING_OCCLUSION_CONFIG.DISTANCE_SCALE,
  );
  const occlusionNearMargin = float(BUILDING_OCCLUSION_CONFIG.NEAR_MARGIN);
  const occlusionFarMargin = float(BUILDING_OCCLUSION_CONFIG.FAR_MARGIN);
  const occlusionEdgeSharpness = float(
    BUILDING_OCCLUSION_CONFIG.EDGE_SHARPNESS,
  );
  const occlusionStrength = float(BUILDING_OCCLUSION_CONFIG.STRENGTH);

  // Config as shader constants - Near-camera dissolve (prevents hard geometry clipping)
  const nearFadeStart = float(BUILDING_OCCLUSION_CONFIG.NEAR_FADE_START);
  const nearFadeEnd = float(BUILDING_OCCLUSION_CONFIG.NEAR_FADE_END);

  // Create alphaTest node for dithered occlusion + near-camera dissolve
  material.alphaTestNode = Fn(() => {
    const worldPos = positionWorld;

    // ========== CAMERA-TO-FRAGMENT DISTANCE ==========
    // Used for both near-camera dissolve and player occlusion
    const cfX = sub(worldPos.x, uCameraPos.x);
    const cfY = sub(worldPos.y, uCameraPos.y);
    const cfZ = sub(worldPos.z, uCameraPos.z);
    const camDistSq = add(add(mul(cfX, cfX), mul(cfY, cfY)), mul(cfZ, cfZ));
    const camDist = sqrt(camDistSq);

    // ========== NEAR-CAMERA DISSOLVE (RuneScape-style depth fade) ==========
    // Prevents hard geometry clipping when camera clips through objects
    // smoothstep returns 0→1 as distance goes from end→start, we invert for fade
    const nearCameraFade = sub(
      float(1.0),
      smoothstep(nearFadeEnd, nearFadeStart, camDist),
    );

    // ========== PLAYER OCCLUSION CONE ==========
    // Camera-to-player vector
    const ctX = sub(uPlayerPos.x, uCameraPos.x);
    const ctY = sub(uPlayerPos.y, uCameraPos.y);
    const ctZ = sub(uPlayerPos.z, uCameraPos.z);
    const ctLengthSq = add(add(mul(ctX, ctX), mul(ctY, ctY)), mul(ctZ, ctZ));
    const ctLength = sqrt(ctLengthSq);

    // Project fragment onto camera-player line
    // projDist = dot(cf, ct) / length(ct)
    const dotCfCt = add(add(mul(cfX, ctX), mul(cfY, ctY)), mul(cfZ, ctZ));
    const projDist = div(dotCfCt, max(ctLength, float(0.001)));

    // Check if fragment is in the valid range (between camera and player)
    const minDist = occlusionNearMargin;
    const maxDist = sub(ctLength, occlusionFarMargin);
    const afterNear = step(minDist, projDist);
    const beforeFar = step(projDist, maxDist);
    const inRange = mul(afterNear, beforeFar);

    // Projection point on the camera-player line
    const projT = div(projDist, max(ctLength, float(0.001)));
    const projX = add(uCameraPos.x, mul(ctX, projT));
    const projY = add(uCameraPos.y, mul(ctY, projT));
    const projZ = add(uCameraPos.z, mul(ctZ, projT));

    // Perpendicular distance from fragment to line
    const perpX = sub(worldPos.x, projX);
    const perpY = sub(worldPos.y, projY);
    const perpZ = sub(worldPos.z, projZ);
    const perpDistSq = add(
      add(mul(perpX, perpX), mul(perpY, perpY)),
      mul(perpZ, perpZ),
    );
    const perpDist = sqrt(perpDistSq);

    // Cone radius calculation (expands from camera to player)
    const t = clamp(
      div(projDist, max(ctLength, float(0.001))),
      float(0.0),
      float(1.0),
    );
    const coneRadius = add(
      add(
        occlusionCameraRadius,
        mul(t, sub(occlusionPlayerRadius, occlusionCameraRadius)),
      ),
      mul(ctLength, occlusionDistanceScale),
    );

    // Sharp edge falloff with stipple effect
    const edgeStart = mul(coneRadius, sub(float(1.0), occlusionEdgeSharpness));
    const rawOcclusionFade = sub(
      float(1.0),
      smoothstep(edgeStart, coneRadius, perpDist),
    );

    // Apply occlusion strength and range check
    const occlusionFade = mul(
      mul(rawOcclusionFade, occlusionStrength),
      inRange,
    );

    // ========== COMBINE FADE EFFECTS ==========
    // Take maximum of near-camera fade and player occlusion fade
    const combinedFade = max(nearCameraFade, occlusionFade);

    // ========== SCREEN-SPACE 4x4 BAYER DITHERING (RuneScape 3 style) ==========
    // 4x4 Bayer matrix: [ 0, 8, 2,10; 12, 4,14, 6; 3,11, 1, 9; 15, 7,13, 5]/16
    const ix = mod(floor(viewportCoordinate.x), float(4.0));
    const iy = mod(floor(viewportCoordinate.y), float(4.0));

    // Extract bits (0 or 1)
    const bit0_x = mod(ix, float(2.0));
    const bit1_x = floor(mul(ix, float(0.5)));
    const bit0_y = mod(iy, float(2.0));
    const bit1_y = floor(mul(iy, float(0.5)));

    // XOR for floats: |a - b| gives 0 when equal, 1 when different
    const xor0 = abs(sub(bit0_x, bit0_y)); // (x^y) bit 0
    const xor1 = abs(sub(bit1_x, bit1_y)); // (x^y) bit 1

    // Bayer = ((x^y)&1)*8 + (y&1)*4 + ((x^y)&2) + ((y&2)>>1)
    const bayerInt = add(
      add(
        add(
          mul(xor0, float(8.0)), // ((x^y)&1) << 3
          mul(bit0_y, float(4.0)),
        ), // (y&1) << 2
        mul(xor1, float(2.0)),
      ), // ((x^y)&2)
      bit1_y, // (y&2) >> 1
    );
    const ditherValue = mul(bayerInt, float(0.0625)); // /16

    // RS3-style: discard when fade >= dither
    // step returns 0 or 1, multiply by 2 so threshold > 1.0 causes discard
    // (alphaTest discards when material.alpha (1.0) < threshold)
    // IMPORTANT: Only apply dithering when combinedFade > 0, otherwise step(0,0)=1 causes holes
    const hasAnyFade = step(float(0.001), combinedFade); // 1 if fade > 0.001
    const rawThreshold = step(ditherValue, combinedFade);
    const threshold = mul(mul(rawThreshold, hasAnyFade), float(2.0));

    return threshold;
  })();

  // Material settings
  material.vertexColors = true;
  material.roughness = 0.85;
  material.metalness = 0.05;
  material.transparent = false;
  material.opacity = 1.0;
  material.alphaTest = 0.5;
  material.side = THREE.FrontSide;
  material.depthWrite = true;

  // Attach uniforms for external updates
  const occlusionMaterial = material as BuildingOcclusionMaterial;
  occlusionMaterial.occlusionUniforms = {
    playerPos: uPlayerPos,
    cameraPos: uCameraPos,
  };

  return occlusionMaterial;
}

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
 * Separated into floors (walkable), walls (non-walkable), and roof for:
 * - Click-to-move raycasting (only floors are raycastable)
 * - Occlusion shader (walls get see-through effect)
 */
interface BatchedTownMesh {
  /** Combined floor geometry (walkable surfaces - stairs, floor tiles) */
  floorMesh: THREE.Mesh;
  /** Combined wall geometry (non-walkable - walls, ceilings, props) */
  wallMesh: THREE.Mesh;
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

  /** Shared uber-material for all batched buildings (with occlusion shader) */
  private batchedMaterial: BuildingOcclusionMaterial;

  /** Temporary matrix for impostor transforms */
  private _tempMatrix = new THREE.Matrix4();
  private _tempQuat = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

  /** Cached physics material for collision shapes (avoid recreating for every building) */
  private _cachedPhysicsMaterial:
    | import("../../../types/systems/physics").PxMaterial
    | null = null;

  // ============================================
  // ROOF AUTO-HIDE FEATURE
  // ============================================

  /** Setting: Whether to auto-hide roofs when player is inside a building */
  private _autoHideRoofsEnabled = true;

  /** Setting: Whether roofs are always hidden (default true for better visibility) */
  private _roofsAlwaysHidden = true;

  /**
   * Current floor the local player is on.
   * Used for: UI display, sound effects, gameplay logic.
   * NOTE: Per-floor VISIBILITY is not implemented because buildings are batched
   * by town (all floors in one mesh). Would require per-building-floor batching.
   */
  private _playerCurrentFloor = 0;

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

    // Create shared material for batched buildings (with occlusion shader)
    this.batchedMaterial = createBuildingOcclusionMaterial();
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
   * Update occlusion shader uniforms with player and camera positions.
   * This enables the dithered see-through effect when character is behind walls.
   */
  private updateOcclusionUniforms(cameraPos: THREE.Vector3): void {
    // Get actual player position (not camera position for third-person)
    const players = this.world.getPlayers?.();
    let playerPos: THREE.Vector3;

    if (players && players.length > 0) {
      const player = players[0];
      const nodePos = (player as { node?: { position?: THREE.Vector3 } }).node
        ?.position;
      playerPos = nodePos ?? cameraPos;
    } else {
      playerPos = cameraPos;
    }

    // Update material uniforms
    this.batchedMaterial.occlusionUniforms.playerPos.value.copy(playerPos);
    this.batchedMaterial.occlusionUniforms.cameraPos.value.copy(cameraPos);
  }

  /**
   * Update roof visibility based on player position inside buildings.
   * Called from update() when auto-hide is enabled.
   */
  private updateRoofVisibility(cameraPos: THREE.Vector3): void {
    // If roofs are always hidden, keep them hidden
    if (this._roofsAlwaysHidden) {
      for (const [, town] of this.townData) {
        if (town.batchedMesh?.roofMesh) {
          town.batchedMesh.roofMesh.visible = false;
        }
      }
      return;
    }

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

  /**
   * Get whether roofs are always hidden
   */
  isRoofsAlwaysHidden(): boolean {
    return this._roofsAlwaysHidden;
  }

  /**
   * Set whether roofs should always be hidden
   */
  setRoofsAlwaysHidden(hidden: boolean): void {
    this._roofsAlwaysHidden = hidden;
    if (!hidden) {
      // If un-hiding, show all roofs immediately
      this.showAllRoofs();
    }
  }

  /**
   * Get the player's current floor (for UI display)
   */
  getPlayerCurrentFloor(): number {
    return this._playerCurrentFloor;
  }

  /**
   * Set the player's current floor (called when floor changes via stairs)
   */
  setPlayerCurrentFloor(floor: number): void {
    this._playerCurrentFloor = floor;
    // Update floor visibility when floor changes
    this.updateFloorVisibility();
  }

  /**
   * Update floor visibility based on player's current floor.
   *
   * ARCHITECTURE LIMITATION: Per-floor visibility is NOT possible with current
   * batching strategy. Buildings are batched per-TOWN (one mesh for all buildings
   * in a town), not per-floor. To hide upper floors when player is on ground floor
   * would require:
   * 1. Batching per-building-per-floor (significant performance impact)
   * 2. Or using shader-based floor masking (complex)
   *
   * For now, all floors are always visible. Roofs can be hidden separately
   * since they're in a dedicated roofMesh.
   *
   * The _playerCurrentFloor value IS tracked and can be used for:
   * - UI indicators (showing current floor)
   * - Sound effects (different footsteps per floor material)
   * - Gameplay logic (floor-specific NPCs, etc.)
   */
  private updateFloorVisibility(): void {
    // No-op: See architecture limitation above.
    // Floor visibility requires per-building-per-floor mesh batching.
  }

  /**
   * Update the player's current floor based on their Y position.
   *
   * Uses BuildingCollisionService to query building floor elevations
   * and determine which floor the player is currently on.
   *
   * This enables:
   * - UI indicators (showing "Floor 1", "Floor 2", etc.)
   * - Different footstep sounds per floor material
   * - Floor-specific gameplay (NPCs, interactions)
   */
  private updatePlayerFloorTracking(): void {
    // Get local player
    const player = this.world.getPlayer?.();
    if (!player) return;

    // Get collision service from town system
    const townSystem = this.world.getSystem("towns") as {
      getCollisionService?: () => {
        queryCollision: (
          x: number,
          z: number,
          floorIndex: number,
        ) => {
          isInsideBuilding: boolean;
          buildingId: string | null;
          floorIndex: number | null;
        };
        getBuilding: (id: string) =>
          | {
              floors: Array<{ floorIndex: number; elevation: number }>;
            }
          | undefined;
      };
    } | null;

    const collisionService = townSystem?.getCollisionService?.();
    if (!collisionService) return;

    // Convert player position to tile
    const tileX = Math.floor(player.position.x);
    const tileZ = Math.floor(player.position.z);
    const playerY = player.position.y;

    // Query collision to see if player is in a building
    const result = collisionService.queryCollision(
      tileX,
      tileZ,
      this._playerCurrentFloor,
    );

    if (!result.isInsideBuilding || !result.buildingId) {
      // Player is outside - floor is 0 (ground level)
      if (this._playerCurrentFloor !== 0) {
        this._playerCurrentFloor = 0;
        this.updateFloorVisibility();
      }
      return;
    }

    // Player is inside - find the floor that matches their Y position
    const building = collisionService.getBuilding(result.buildingId);
    if (!building) return;

    // Find floor closest to player's Y position
    let closestFloor = 0;
    let closestDiff = Infinity;

    for (const floor of building.floors) {
      const diff = Math.abs(playerY - floor.elevation);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestFloor = floor.floorIndex;
      }
    }

    // Update floor if changed
    if (this._playerCurrentFloor !== closestFloor) {
      this._playerCurrentFloor = closestFloor;
      this.updateFloorVisibility();

      // Emit event for UI components
      this.world.emit("player:floor:changed", {
        floor: closestFloor,
        buildingId: result.buildingId,
      });
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
      this.logger.info("No towns to render - TownSystem returned empty array");
      return;
    }

    // DEBUG: Log town and building counts to verify data is loaded
    const totalBuildingCount = towns.reduce(
      (sum, t) => sum + t.buildings.length,
      0,
    );
    this.logger.info(
      `[BuildingRenderingSystem] Starting render: ${towns.length} towns, ${totalBuildingCount} total buildings`,
    );

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
      const floorGeometries: THREE.BufferGeometry[] = [];
      const wallGeometries: THREE.BufferGeometry[] = [];
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

          // OPTIMIZATION: Reuse layout cached by TownSystem to avoid duplicate computation
          // TownSystem generates layouts for collision, we reuse them for rendering
          const townSystem = this.world.getSystem("towns") as {
            getBuildingLayout?: (
              id: string,
            ) =>
              | import("@hyperscape/procgen/building").BuildingLayout
              | undefined;
          } | null;
          const cachedLayout = townSystem?.getBuildingLayout?.(building.id);

          // Generate building mesh with LODs (CPU-intensive)
          const generatedBuilding = this.buildingGenerator.generate(recipeKey, {
            seed: `${town.id}_${building.id}`,
            includeRoof: true,
            useGreedyMeshing: true, // Use optimized geometry
            generateLODs: true, // Generate LOD meshes
            cachedLayout, // Skip layout generation if TownSystem already computed it
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

          // Use the building's stored Y position, NOT terrain getHeightAt()
          // The building position was set BEFORE flat zones were registered,
          // so it contains the original terrain height. Using getHeightAt() here
          // would return the flat zone height (terrain + FOUNDATION_HEIGHT),
          // causing buildings to be positioned 0.5m too high.
          const groundY = building.position.y;

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
            const { floorGeo, wallGeo, roofGeo } =
              this.extractBuildingGeometries(mesh);

            // Floor geometry (walkable surfaces)
            if (floorGeo) {
              floorGeometries.push(floorGeo);
              // Map floor triangles to building ID for raycast hit detection
              const floorTriangles = floorGeo.index
                ? floorGeo.index.count / 3
                : (floorGeo.getAttribute("position")?.count ?? 0) / 3;
              for (let t = 0; t < floorTriangles; t++) {
                triangleToBuildingMap.set(
                  currentTriangleOffset + t,
                  building.id,
                );
              }
              buildingData.batchedIndexOffset = currentTriangleOffset;
              buildingData.batchedTriangleCount = floorTriangles;
              currentTriangleOffset += floorTriangles;
            }
            // Wall geometry (non-walkable)
            if (wallGeo) {
              wallGeometries.push(wallGeo);
            }
            // Roof geometry
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
        (floorGeometries.length > 0 || wallGeometries.length > 0)
      ) {
        batchedMesh = this.createBatchedTownMesh(
          floorGeometries,
          wallGeometries,
          roofGeometries,
          triangleToBuildingMap,
          townGroup,
        );
        totalDrawCalls += 3; // floors + walls + roof = 3 draw calls per town
      } else {
        totalDrawCalls += townBuildings.length * 3; // Individual meshes
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

    // === CRITICAL VALIDATION ===
    // Verify buildings were actually rendered if we expected them
    if (totalBuildings > 0 && renderedBuildings === 0) {
      throw new Error(
        `[BuildingRendering] CRITICAL: ${totalBuildings} buildings to render but ZERO were rendered! ` +
          `Building click detection will NOT work.`,
      );
    }

    // Verify floor meshes exist in scene for click detection
    if (renderedBuildings > 0 && BUILDING_PERF_CONFIG.enableStaticBatching) {
      let floorMeshCount = 0;
      for (const townGroup of this.townMeshes.values()) {
        townGroup.traverse((child) => {
          if (
            child instanceof THREE.Mesh &&
            child.userData?.type === "batched-building-floors"
          ) {
            floorMeshCount++;
          }
        });
      }

      if (floorMeshCount === 0) {
        throw new Error(
          `[BuildingRendering] CRITICAL: ${renderedBuildings} buildings rendered but NO floor meshes found! ` +
            `Click-to-move on buildings will NOT work.`,
        );
      }

      this.logger.info(
        `Verified ${floorMeshCount} floor meshes in scene for click detection`,
      );
    }

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
    // Use MeshBasicNodeMaterial for WebGPU compatibility
    const atlasMaterial = new MeshBasicNodeMaterial();
    atlasMaterial.map = atlasTexture.texture;
    atlasMaterial.transparent = true;
    atlasMaterial.alphaTest = 0.1;
    atlasMaterial.side = THREE.DoubleSide;
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
    // NOTE: Double the size because impostor baker renders object at ~50% of atlas cell
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      const width = Math.max(building.dimensions.x, building.dimensions.z) * 2;
      const height = building.dimensions.y * 2;

      this._tempScale.set(width, height, 1);
      this._tempQuat.identity();
      this._tempVec.copy(building.position);
      this._tempVec.y += height * 0.25; // Quarter height since we doubled

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

      // Get dimensions (doubled for impostor sizing)
      const width = Math.max(building.dimensions.x, building.dimensions.z) * 2;
      const height = building.dimensions.y * 2;

      // Update transform
      this._tempQuat.setFromAxisAngle(this._tempVec.set(0, 1, 0), angle);
      this._tempScale.set(width, height, 1);
      this._tempVec.copy(building.position);
      this._tempVec.y += height * 0.25; // Quarter height since we doubled

      this._tempMatrix.compose(this._tempVec, this._tempQuat, this._tempScale);
      atlas.instancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);
    }

    atlas.instancedMesh.instanceMatrix.needsUpdate = true;

    // Sync lighting with scene (atlas material is shared across all buildings)
    const material = atlas.instancedMesh.material as TSLImpostorMaterial;
    if (isTSLImpostorMaterial(material) && material.updateLighting) {
      this.syncImpostorLighting(material);
    }
  }

  /**
   * Bake an impostor for a single building.
   */
  private async bakeImpostorForBuilding(
    buildingData: BuildingData,
  ): Promise<void> {
    const manager = ImpostorManager.getInstance(this.world);

    // Create unique model ID for caching (v2 = with normal atlas)
    const modelId = `building_${buildingData.townId}_${buildingData.buildingId}_${buildingData.buildingType}_v2`;

    // Bake using ImpostorManager with normals for dynamic lighting
    const bakeResult = await manager.getOrCreate(modelId, buildingData.mesh, {
      atlasSize: 512,
      hemisphere: true, // Buildings viewed from above
      priority: BakePriority.LOW, // Background baking
      category: "building",
      bakeMode: ImpostorBakeMode.STANDARD, // Bake with normals for dynamic lighting
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
    const {
      atlasTexture,
      normalAtlasTexture,
      gridSizeX,
      gridSizeY,
      boundingSphere,
    } = bakeResult;

    // Use bounding sphere or dimensions for sizing
    // NOTE: Multiply by 2 because the impostor baker renders the object at ~50% of the atlas cell
    // to allow room for different view angles and prevent clipping at edges
    const width = boundingSphere
      ? boundingSphere.radius * 4 // 2x diameter
      : Math.max(buildingData.dimensions.x, buildingData.dimensions.z) * 2;
    const height = boundingSphere
      ? boundingSphere.radius * 4 // 2x diameter
      : buildingData.dimensions.y * 2;

    // Create TSL material for WebGPU (no WebGL fallback)
    // Pass normal atlas for dynamic lighting support
    const material = createTSLImpostorMaterial({
      atlasTexture,
      normalAtlasTexture, // Enable dynamic lighting
      gridSizeX,
      gridSizeY,
      transparent: true,
      depthWrite: true,
    });
    this.world.setupMaterial(material);

    // Create billboard geometry
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);

    // Position at building center, offset Y by quarter height (since we doubled the quad size)
    // The object is rendered at ~50% of the atlas cell, so actual content center is at 1/4 of quad height
    mesh.position.copy(buildingData.position);
    mesh.position.y += height * 0.25;

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
   * Applies world transforms and separates floors/walls/roof geometries.
   *
   * Separation is based on mesh names from BuildingGenerator:
   * - "floors" → walkable surfaces (for click-to-move raycast)
   * - "walls" → non-walkable (excluded from click raycast, gets occlusion shader)
   * - "roof" → roof pieces (can be hidden when inside building)
   */
  private extractBuildingGeometries(mesh: THREE.Mesh | THREE.Group): {
    floorGeo: THREE.BufferGeometry | null;
    wallGeo: THREE.BufferGeometry | null;
    roofGeo: THREE.BufferGeometry | null;
    triangleCount: number;
  } {
    const floorGeometries: THREE.BufferGeometry[] = [];
    const wallGeometries: THREE.BufferGeometry[] = [];
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

        // Separate based on mesh name from BuildingGenerator
        const name = child.name.toLowerCase();
        if (name.includes("roof")) {
          roofGeometries.push(geo);
        } else if (name.includes("floor")) {
          floorGeometries.push(geo);
        } else if (name.includes("wall") || name === "body") {
          // "walls" or legacy "body" mesh → walls
          wallGeometries.push(geo);
        } else {
          // Default to walls for any unrecognized meshes
          wallGeometries.push(geo);
        }
      }
    });

    // Merge floor geometries (walkable)
    let floorGeo: THREE.BufferGeometry | null = null;
    if (floorGeometries.length > 0) {
      floorGeo =
        floorGeometries.length === 1
          ? floorGeometries[0]
          : mergeGeometries(floorGeometries, false);
      if (floorGeometries.length > 1) {
        for (const geo of floorGeometries) geo.dispose();
      }
    }

    // Merge wall geometries (non-walkable)
    let wallGeo: THREE.BufferGeometry | null = null;
    if (wallGeometries.length > 0) {
      wallGeo =
        wallGeometries.length === 1
          ? wallGeometries[0]
          : mergeGeometries(wallGeometries, false);
      if (wallGeometries.length > 1) {
        for (const geo of wallGeometries) geo.dispose();
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

    return { floorGeo, wallGeo, roofGeo, triangleCount };
  }

  /**
   * Create batched meshes for an entire town.
   * Creates three separate meshes:
   * - floorMesh: walkable surfaces (Layer 2 - for click-to-move raycast)
   * - wallMesh: non-walkable (Layer 1 - gets occlusion shader)
   * - roofMesh: roof pieces (can be hidden when inside)
   */
  private createBatchedTownMesh(
    floorGeometries: THREE.BufferGeometry[],
    wallGeometries: THREE.BufferGeometry[],
    roofGeometries: THREE.BufferGeometry[],
    triangleToBuildingMap: Map<number, string>,
    townGroup: THREE.Group,
  ): BatchedTownMesh {
    // === FLOOR MESH (walkable - raycastable for click-to-move) ===
    let floorMesh: THREE.Mesh;
    if (floorGeometries.length > 0) {
      const mergedFloorGeo =
        floorGeometries.length === 1
          ? floorGeometries[0]
          : mergeGeometries(floorGeometries, false);

      if (mergedFloorGeo) {
        // Floors use a simple material (no occlusion needed - they're walkable)
        const floorMaterial = new MeshStandardNodeMaterial({
          vertexColors: true,
          roughness: 0.85,
          metalness: 0.05,
        });
        floorMesh = new THREE.Mesh(mergedFloorGeo, floorMaterial);
        floorMesh.name = "BatchedBuildingFloors";
        floorMesh.castShadow = true;
        floorMesh.receiveShadow = true;
        // Layer 2 for click-to-move raycasting (terrain is layer 0, entities layer 1)
        floorMesh.layers.set(2);
        floorMesh.userData = {
          type: "batched-building-floors",
          walkable: true,
          triangleToBuildingMap,
        };
        townGroup.add(floorMesh);

        // CRITICAL VALIDATION: Ensure floor mesh is on correct layer for raycasting
        if (!floorMesh.layers.isEnabled(2)) {
          throw new Error(
            `[BuildingRendering] CRITICAL: Floor mesh not on layer 2! Click-to-move will not work.`,
          );
        }

        // Log floor mesh creation for debugging
        const vertexCount = mergedFloorGeo.getAttribute("position")?.count ?? 0;
        console.log(
          `[BuildingRendering] Created floor mesh: ${vertexCount} vertices, layer=${floorMesh.layers.mask}`,
        );
      } else {
        // mergeGeometries returned null - this shouldn't happen with valid geometries
        console.warn(
          `[BuildingRendering] WARNING: mergeGeometries returned null for ${floorGeometries.length} floor geometries`,
        );
        floorMesh = new THREE.Mesh(
          new THREE.BufferGeometry(),
          this.batchedMaterial,
        );
      }
    } else {
      // No floor geometries - this is a problem if we expected buildings
      console.warn(
        `[BuildingRendering] WARNING: No floor geometries provided to createBatchedTownMesh`,
      );
      floorMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        this.batchedMaterial,
      );
    }

    // === WALL MESH (non-walkable - gets occlusion shader) ===
    let wallMesh: THREE.Mesh;
    if (wallGeometries.length > 0) {
      const mergedWallGeo =
        wallGeometries.length === 1
          ? wallGeometries[0]
          : mergeGeometries(wallGeometries, false);

      if (mergedWallGeo) {
        // Walls use the occlusion material (see-through effect)
        wallMesh = new THREE.Mesh(mergedWallGeo, this.batchedMaterial);
        wallMesh.name = "BatchedBuildingWalls";
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        // Layer 1 (main camera only, excluded from click-to-move raycast)
        wallMesh.layers.set(1);
        wallMesh.userData = {
          type: "batched-building-walls",
          walkable: false,
        };
        townGroup.add(wallMesh);
      } else {
        wallMesh = new THREE.Mesh(
          new THREE.BufferGeometry(),
          this.batchedMaterial,
        );
      }
    } else {
      wallMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        this.batchedMaterial,
      );
    }

    // === ROOF MESH (can be hidden when inside building) ===
    let roofMesh: THREE.Mesh;
    if (roofGeometries.length > 0) {
      const mergedRoofGeo =
        roofGeometries.length === 1
          ? roofGeometries[0]
          : mergeGeometries(roofGeometries, false);

      if (mergedRoofGeo) {
        // Roofs use the occlusion material too
        roofMesh = new THREE.Mesh(mergedRoofGeo, this.batchedMaterial);
        roofMesh.name = "BatchedBuildingRoof";
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        // Layer 1 (main camera only)
        roofMesh.layers.set(1);
        roofMesh.userData = {
          type: "batched-building-roof",
          walkable: false,
        };
        townGroup.add(roofMesh);
      } else {
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
    if (floorGeometries.length > 1) {
      for (const geo of floorGeometries) geo.dispose();
    }
    if (wallGeometries.length > 1) {
      for (const geo of wallGeometries) geo.dispose();
    }
    if (roofGeometries.length > 1) {
      for (const geo of roofGeometries) geo.dispose();
    }

    const totalVertices =
      (floorMesh.geometry.getAttribute("position")?.count ?? 0) +
      (wallMesh.geometry.getAttribute("position")?.count ?? 0) +
      (roofMesh.geometry.getAttribute("position")?.count ?? 0);

    this.logger.info(
      `Created batched town meshes: ${totalVertices} vertices, ` +
        `${triangleToBuildingMap.size} triangles mapped to ${new Set(triangleToBuildingMap.values()).size} buildings`,
    );

    return {
      floorMesh,
      wallMesh,
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

    // Create material and shape (use cached physics material)
    if (!this._cachedPhysicsMaterial) {
      this._cachedPhysicsMaterial = physics.physics.createMaterial(
        0.5,
        0.5,
        0.1,
      );
    }
    const shape = physics.physics.createShape(
      boxGeometry,
      this._cachedPhysicsMaterial,
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

      // Create material and shape (use cached physics material)
      if (!this._cachedPhysicsMaterial) {
        this._cachedPhysicsMaterial = physics.physics.createMaterial(
          0.5,
          0.5,
          0.1,
        );
      }
      const shape = physics.physics.createShape(
        boxGeometry,
        this._cachedPhysicsMaterial,
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

    // ============================================
    // UPDATE OCCLUSION SHADER UNIFORMS
    // ============================================
    this.updateOcclusionUniforms(cameraPos);

    // Check if camera moved significantly
    const moved = this._lastCameraPos.distanceToSquared(cameraPos) > 1;
    if (!moved && this.townData.size > 0) return;

    this._lastCameraPos.copy(cameraPos);

    // ============================================
    // ROOF AUTO-HIDE (when player inside building)
    // ============================================
    this.updateRoofVisibility(cameraPos);

    // ============================================
    // FLOOR TRACKING (for UI, sounds, gameplay)
    // ============================================
    this.updatePlayerFloorTracking();

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
            town.batchedMesh.floorMesh.visible = false;
            town.batchedMesh.wallMesh.visible = false;
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
          town.batchedMesh.floorMesh.visible = false;
          town.batchedMesh.wallMesh.visible = false;
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
          town.batchedMesh.floorMesh.visible = false;
          town.batchedMesh.wallMesh.visible = false;
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
          town.batchedMesh.floorMesh.visible = true;
          town.batchedMesh.wallMesh.visible = true;
          town.batchedMesh.roofMesh.visible = true;

          // Shadow optimization based on distance
          const enableShadows = effectiveDistSq <= lod1DistSq;
          town.batchedMesh.floorMesh.castShadow = enableShadows;
          town.batchedMesh.wallMesh.castShadow = enableShadows;
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

  /** Cached light direction for impostor lighting */
  private _lightDir = new THREE.Vector3(0.5, 0.8, 0.3);
  private _lightColor = new THREE.Vector3(1, 0.98, 0.95);
  private _ambientColor = new THREE.Vector3(0.6, 0.7, 0.8);
  private _lastLightUpdate = 0;

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
    this._imposterFaceIndices.set(flatIndex, flatIndex, flatIndex);

    // Handle both TSL (WebGPU) and GLSL (WebGL) materials
    const material = impostorMesh.material as
      | THREE.ShaderMaterial
      | TSLImpostorMaterial;
    if (isTSLImpostorMaterial(material)) {
      // TSL material uses updateView method
      material.updateView(this._imposterFaceIndices, this._imposterFaceWeights);

      // Update lighting from scene (throttled to once per frame)
      if (material.updateLighting) {
        this.syncImpostorLighting(material);
      }
    }
  }

  /**
   * Sync impostor lighting with scene's sun light.
   * Throttled to once per frame to avoid redundant updates.
   */
  private syncImpostorLighting(material: TSLImpostorMaterial): void {
    const now = performance.now();
    // Only update lighting once per frame (~16ms)
    if (now - this._lastLightUpdate < 16) return;
    this._lastLightUpdate = now;

    // Get environment system for sun light
    const env = this.world.getSystem("environment") as {
      sunLight?: THREE.DirectionalLight;
      lightDirection?: THREE.Vector3;
    } | null;

    if (env?.sunLight) {
      const sun = env.sunLight;
      // Light direction is negated (light goes FROM direction TO target)
      if (env.lightDirection) {
        this._lightDir.copy(env.lightDirection).negate();
      } else {
        this._lightDir.set(0.5, 0.8, 0.3);
      }
      this._lightColor.set(sun.color.r, sun.color.g, sun.color.b);

      material.updateLighting!({
        ambientColor: this._ambientColor,
        ambientIntensity: 0.35,
        directionalLights: [
          {
            direction: this._lightDir,
            color: this._lightColor,
            intensity: sun.intensity,
          },
        ],
        specular: {
          f0: 0.04,
          shininess: 32,
          intensity: 0.3,
        },
      });
    }
  }

  // ============================================================================
  // DEBUG UTILITIES
  // ============================================================================

  /**
   * Get building rendering statistics for debugging.
   */
  getStats(): {
    totalTowns: number;
    totalBuildings: number;
    buildingsWithImpostors: number;
    buildingsByLOD: {
      lod0: number;
      lod1: number;
      lod2: number;
      culled: number;
    };
    townsWithAtlas: number;
    pendingImpostorBakes: number;
    lodConfig: LODDistancesWithSq;
    batchingEnabled: boolean;
  } {
    let totalBuildings = 0;
    let buildingsWithImpostors = 0;
    let townsWithAtlas = 0;
    const buildingsByLOD = { lod0: 0, lod1: 0, lod2: 0, culled: 0 };

    for (const town of this.townData.values()) {
      totalBuildings += town.buildings.length;
      if (town.impostorAtlas) townsWithAtlas++;

      for (const building of town.buildings) {
        if (building.impostorMesh || building.impostorBakeResult) {
          buildingsWithImpostors++;
        }
        if (building.lodLevel === 0) buildingsByLOD.lod0++;
        else if (building.lodLevel === 1) buildingsByLOD.lod1++;
        else if (building.lodLevel === 2) buildingsByLOD.lod2++;
        else buildingsByLOD.culled++;
      }
    }

    return {
      totalTowns: this.townData.size,
      totalBuildings,
      buildingsWithImpostors,
      buildingsByLOD,
      townsWithAtlas,
      pendingImpostorBakes: this._pendingImpostorBakes.length,
      lodConfig: this.lodConfig,
      batchingEnabled: BUILDING_PERF_CONFIG.enableStaticBatching,
    };
  }

  /**
   * Debug print building statistics to console.
   */
  debugPrintStats(): void {
    const stats = this.getStats();
    console.log("=== Building Rendering Stats ===");
    console.log(`Towns: ${stats.totalTowns}`);
    console.log(`Total Buildings: ${stats.totalBuildings}`);
    console.log(`Buildings with Impostors: ${stats.buildingsWithImpostors}`);
    console.log(`Towns with Impostor Atlas: ${stats.townsWithAtlas}`);
    console.log(`Pending Impostor Bakes: ${stats.pendingImpostorBakes}`);
    console.log(`LOD Distribution:`);
    console.log(`  LOD0 (full detail): ${stats.buildingsByLOD.lod0}`);
    console.log(`  LOD1 (medium): ${stats.buildingsByLOD.lod1}`);
    console.log(`  LOD2 (impostor): ${stats.buildingsByLOD.lod2}`);
    console.log(`  Culled: ${stats.buildingsByLOD.culled}`);
    console.log(`LOD Distances:`);
    console.log(`  LOD1: ${this.lodConfig.lod1Distance}m`);
    console.log(`  LOD2: ${this.lodConfig.lod2Distance}m`);
    console.log(`  Impostor: ${this.lodConfig.imposterDistance}m`);
    console.log(`  Fade: ${this.lodConfig.fadeDistance}m`);
    console.log(`Batching: ${stats.batchingEnabled ? "enabled" : "disabled"}`);
    console.log("================================");
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
        town.batchedMesh.floorMesh.geometry.dispose();
        town.batchedMesh.wallMesh.geometry.dispose();
        town.batchedMesh.roofMesh.geometry.dispose();
        // Dispose floor material (separate from wall/roof material)
        if (town.batchedMesh.floorMesh.material instanceof THREE.Material) {
          town.batchedMesh.floorMesh.material.dispose();
        }
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
