/**
 * createEditorWorld.ts - Editor World Factory
 *
 * Creates and configures a World instance for editor mode (Asset Forge).
 * This factory registers systems needed for world building and editing
 * WITHOUT gameplay systems like combat, inventory, NPCs, or networking.
 *
 * Key Differences from Client World:
 * - NO network system (no multiplayer, server connection)
 * - NO audio system (no sound effects, music)
 * - NO RPG systems (no combat, inventory, skills, NPCs)
 * - NO physics (simplified, or optional stub)
 * - ADDED: Editor-specific camera, selection, gizmo systems
 *
 * Systems Included:
 * - Stage: Three.js scene graph
 * - ClientGraphics: WebGPU renderer (shared, reusable)
 * - Environment: Lighting, shadows, sky
 * - TerrainSystem: Heightmap terrain
 * - TownSystem: Town generation
 * - RoadNetworkSystem: Road generation
 * - VegetationSystem: Trees, plants, rocks
 * - ProceduralGrassSystem: GPU grass
 * - ProceduralFlowerSystem: GPU flowers
 * - BuildingRenderingSystem: Procedural buildings
 * - Wind: Environmental wind effects
 * - EditorCameraSystem: Orbit/pan/fly camera controls
 * - EditorSelectionSystem: Object selection
 * - EditorGizmoSystem: Transform gizmos
 *
 * Usage:
 * ```typescript
 * const world = createEditorWorld({
 *   viewport: canvasContainer,
 *   editorMode: true,
 * });
 * await world.init({
 *   assetsUrl: '/assets/',
 * });
 * // World is ready for editing
 *
 * // Animation loop
 * function animate(time: number) {
 *   world.tick(time);
 *   requestAnimationFrame(animate);
 * }
 * requestAnimationFrame(animate);
 * ```
 *
 * Used by: Asset Forge (packages/asset-forge)
 */

import * as THREE from "three";
import { World } from "../core/World";
import type { WorldOptions } from "../types";

// Core rendering systems
import { Stage } from "../systems/shared/presentation/Stage";
import { ClientGraphics } from "../systems/client/ClientGraphics";
import { Environment } from "../systems/shared/world/Environment";
import { Wind } from "../systems/shared/world/Wind";

// World generation systems
import { TerrainSystem } from "../systems/shared/world/TerrainSystem";
import { TownSystem } from "../systems/shared/world/TownSystem";
import { POISystem } from "../systems/shared/world/POISystem";
import { RoadNetworkSystem } from "../systems/shared/world/RoadNetworkSystem";
import { VegetationSystem } from "../systems/shared/world/VegetationSystem";
import { ProceduralGrassSystem } from "../systems/shared/world/ProceduralGrass";
import { ProceduralFlowerSystem } from "../systems/shared/world/ProceduralFlowers";
import { BuildingRenderingSystem } from "../systems/shared/world/BuildingRenderingSystem";

// Editor-specific systems
import { EditorCameraSystem } from "../systems/editor/EditorCameraSystem";
import { EditorSelectionSystem } from "../systems/editor/EditorSelectionSystem";
import { EditorGizmoSystem } from "../systems/editor/EditorGizmoSystem";

// Infrastructure
import { Settings } from "../systems/shared/infrastructure/Settings";
import { LODs } from "../systems/shared/presentation/LODs";

/**
 * Configuration options for creating an editor world
 */
export interface EditorWorldOptions {
  /** DOM element to render into (required) */
  viewport: HTMLElement;

  /** Enable terrain system (default: true) */
  enableTerrain?: boolean;

  /** Enable vegetation system (default: true) */
  enableVegetation?: boolean;

  /** Enable grass system (default: true) */
  enableGrass?: boolean;

  /** Enable flower system (default: true) */
  enableFlowers?: boolean;

  /** Enable town system (default: true) */
  enableTowns?: boolean;

  /** Enable road system (default: true) */
  enableRoads?: boolean;

  /** Enable building rendering (default: true) */
  enableBuildings?: boolean;

  /** Enable water system (default: false - heavy) */
  enableWater?: boolean;

  /** Initial camera position */
  cameraPosition?: { x: number; y: number; z: number };

  /** Initial camera target */
  cameraTarget?: { x: number; y: number; z: number };
}

/**
 * Extended World class with editor-specific properties
 */
export class EditorWorld extends World {
  /** Flag indicating this is an editor world */
  readonly isEditor = true;

  /** Editor-specific viewport element */
  editorViewport: HTMLElement | null = null;

  /** Reference to editor camera system */
  editorCamera: EditorCameraSystem | null = null;

  /** Reference to editor selection system */
  editorSelection: EditorSelectionSystem | null = null;

  /** Reference to editor gizmo system */
  editorGizmo: EditorGizmoSystem | null = null;

  /** Options used to create this world */
  editorOptions: EditorWorldOptions | null = null;

  /** Internal: initial camera target (set during init) */
  _initialCameraTarget?: { x: number; y: number; z: number };
}

/**
 * Creates an editor world for Asset Forge and other editing tools.
 *
 * The editor world uses the same systems as the game client but without
 * networking, audio, physics, or gameplay systems. This provides
 * WYSIWYG editing with the exact same rendering as in-game.
 *
 * @param options - Editor world configuration
 * @returns A configured EditorWorld instance ready for initialization
 */
export function createEditorWorld(options: EditorWorldOptions): EditorWorld {
  const world = new EditorWorld();
  world.editorOptions = options;
  world.editorViewport = options.viewport;

  // Apply sensible defaults
  const config = {
    enableTerrain: options.enableTerrain ?? true,
    enableVegetation: options.enableVegetation ?? true,
    enableGrass: options.enableGrass ?? true,
    enableFlowers: options.enableFlowers ?? true,
    enableTowns: options.enableTowns ?? true,
    enableRoads: options.enableRoads ?? true,
    enableBuildings: options.enableBuildings ?? true,
    enableWater: options.enableWater ?? false,
  };

  // ============================================================================
  // CORE INFRASTRUCTURE
  // ============================================================================

  // Settings system for configuration
  world.register("settings", Settings);

  // Stage - Three.js scene graph (required by everything)
  world.register("stage", Stage);

  // Graphics - WebGPU renderer
  world.register("graphics", ClientGraphics);

  // Environment - Lighting, shadows, sky
  world.register("environment", Environment);

  // Wind - Environmental wind for vegetation
  world.register("wind", Wind);

  // LODs - Level of detail management
  world.register("lods", LODs);

  // ============================================================================
  // WORLD GENERATION SYSTEMS (Conditional)
  // ============================================================================

  // Terrain - Heightmap terrain with biomes
  if (config.enableTerrain) {
    world.register("terrain", TerrainSystem);
  }

  // Vegetation - Trees, plants, rocks
  if (config.enableVegetation) {
    world.register("vegetation", VegetationSystem);
  }

  // Towns - Town generation and placement
  if (config.enableTowns) {
    world.register("towns", TownSystem);
  }

  // POIs - Points of Interest
  if (config.enableTowns) {
    world.register("pois", POISystem);
  }

  // Roads - Road network connecting towns
  if (config.enableRoads) {
    world.register("roads", RoadNetworkSystem);
  }

  // Buildings - Procedural building meshes
  if (config.enableBuildings) {
    world.register("building-rendering", BuildingRenderingSystem);
  }

  // Grass - GPU procedural grass
  if (config.enableGrass) {
    world.register("grass", ProceduralGrassSystem);
  }

  // Flowers - GPU procedural flowers
  if (config.enableFlowers) {
    world.register("flowers", ProceduralFlowerSystem);
  }

  // ============================================================================
  // EDITOR SYSTEMS
  // ============================================================================

  // Editor camera - Orbit/pan/fly controls
  world.register("editor-camera", EditorCameraSystem);

  // Editor selection - Click to select objects
  world.register("editor-selection", EditorSelectionSystem);

  // Editor gizmos - Transform handles
  world.register("editor-gizmo", EditorGizmoSystem);

  // ============================================================================
  // INITIAL CAMERA SETUP
  // ============================================================================

  // Set initial camera position if provided
  if (options.cameraPosition) {
    world.camera.position.set(
      options.cameraPosition.x,
      options.cameraPosition.y,
      options.cameraPosition.z,
    );
  } else {
    // Default to a nice overview position
    world.camera.position.set(100, 100, 100);
  }

  // Camera target will be set by EditorCameraSystem after init
  if (options.cameraTarget) {
    world._initialCameraTarget = options.cameraTarget;
  }

  return world;
}

/**
 * Initialize an editor world with the provided options.
 *
 * This is a convenience function that creates and initializes in one call.
 *
 * @param options - Editor world configuration
 * @param initOptions - World initialization options (assets URL, etc.)
 * @returns Promise resolving to the initialized editor world
 */
export async function initEditorWorld(
  options: EditorWorldOptions,
  initOptions: Partial<WorldOptions> = {},
): Promise<EditorWorld> {
  const world = createEditorWorld(options);

  await world.init({ ...initOptions, viewport: options.viewport });

  // Store references to editor systems for easy access
  world.editorCamera =
    (world.getSystem("editor-camera") as EditorCameraSystem) ?? null;
  world.editorSelection =
    (world.getSystem("editor-selection") as EditorSelectionSystem) ?? null;
  world.editorGizmo =
    (world.getSystem("editor-gizmo") as EditorGizmoSystem) ?? null;

  // Apply initial camera target if set
  if (world._initialCameraTarget && world.editorCamera) {
    const t = world._initialCameraTarget;
    world.editorCamera.setTarget(new THREE.Vector3(t.x, t.y, t.z));
    world._initialCameraTarget = undefined;
  }

  return world;
}

// Re-export editor systems for direct access
export { EditorCameraSystem } from "../systems/editor/EditorCameraSystem";
export { EditorSelectionSystem } from "../systems/editor/EditorSelectionSystem";
export { EditorGizmoSystem } from "../systems/editor/EditorGizmoSystem";
export type {
  EditorCameraMode,
  EditorCameraConfig,
  CameraBookmark,
} from "../systems/editor/EditorCameraSystem";
export type {
  Selectable,
  SelectionChangeEvent,
  EditorSelectionConfig,
} from "../systems/editor/EditorSelectionSystem";
export type {
  TransformMode,
  TransformSpace,
  TransformEvent,
  EditorGizmoConfig,
} from "../systems/editor/EditorGizmoSystem";
