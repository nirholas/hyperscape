/**
 * Editor World factory for Asset Forge. Creates a World with rendering/world-gen
 * systems but no gameplay (combat, inventory, NPCs, networking).
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
import { ProceduralTownLandmarksSystem } from "../systems/shared/world/ProceduralTownLandmarks";

// Editor-specific systems
import { EditorCameraSystem } from "../systems/editor/EditorCameraSystem";
import { EditorSelectionSystem } from "../systems/editor/EditorSelectionSystem";
import { EditorGizmoSystem } from "../systems/editor/EditorGizmoSystem";

// Infrastructure
import { Settings } from "../systems/shared/infrastructure/Settings";
import { LODs } from "../systems/shared/presentation/LODs";

export interface EditorWorldOptions {
  viewport: HTMLElement;
  enableTerrain?: boolean;
  enableVegetation?: boolean;
  enableGrass?: boolean;
  enableFlowers?: boolean;
  enableTowns?: boolean;
  enableRoads?: boolean;
  enableBuildings?: boolean;
  enableTownLandmarks?: boolean;
  enableWater?: boolean;
  cameraPosition?: { x: number; y: number; z: number };
  cameraTarget?: { x: number; y: number; z: number };
}

export class EditorWorld extends World {
  readonly isEditor = true;
  editorViewport: HTMLElement | null = null;
  editorCamera: EditorCameraSystem | null = null;
  editorSelection: EditorSelectionSystem | null = null;
  editorGizmo: EditorGizmoSystem | null = null;
  editorOptions: EditorWorldOptions | null = null;
  _initialCameraTarget?: { x: number; y: number; z: number };
}

export function createEditorWorld(options: EditorWorldOptions): EditorWorld {
  const world = new EditorWorld();
  world.editorOptions = options;
  world.editorViewport = options.viewport;

  const cfg = {
    enableTerrain: options.enableTerrain ?? true,
    enableVegetation: options.enableVegetation ?? true,
    enableGrass: options.enableGrass ?? true,
    enableFlowers: options.enableFlowers ?? true,
    enableTowns: options.enableTowns ?? true,
    enableRoads: options.enableRoads ?? true,
    enableBuildings: options.enableBuildings ?? true,
    enableTownLandmarks: options.enableTownLandmarks ?? true,
    enableWater: options.enableWater ?? false,
  };

  // Core
  world.register("settings", Settings);
  world.register("stage", Stage);
  world.register("graphics", ClientGraphics);
  world.register("environment", Environment);
  world.register("wind", Wind);
  world.register("lods", LODs);

  // World gen (conditional)
  if (cfg.enableTerrain) world.register("terrain", TerrainSystem);
  if (cfg.enableVegetation) world.register("vegetation", VegetationSystem);
  if (cfg.enableTowns) {
    world.register("towns", TownSystem);
    world.register("pois", POISystem);
  }
  if (cfg.enableRoads) world.register("roads", RoadNetworkSystem);
  if (cfg.enableBuildings)
    world.register("building-rendering", BuildingRenderingSystem);
  if (cfg.enableTownLandmarks)
    world.register("town-landmarks", ProceduralTownLandmarksSystem);
  if (cfg.enableGrass) world.register("grass", ProceduralGrassSystem);
  if (cfg.enableFlowers) world.register("flowers", ProceduralFlowerSystem);

  // Editor
  world.register("editor-camera", EditorCameraSystem);
  world.register("editor-selection", EditorSelectionSystem);
  world.register("editor-gizmo", EditorGizmoSystem);

  // Camera
  const cp = options.cameraPosition;
  world.camera.position.set(cp?.x ?? 100, cp?.y ?? 100, cp?.z ?? 100);
  if (options.cameraTarget) world._initialCameraTarget = options.cameraTarget;

  return world;
}

export async function initEditorWorld(
  options: EditorWorldOptions,
  initOptions: Partial<WorldOptions> = {},
): Promise<EditorWorld> {
  const world = createEditorWorld(options);
  await world.init({ ...initOptions, viewport: options.viewport });

  world.editorCamera =
    (world.getSystem("editor-camera") as EditorCameraSystem) ?? null;
  world.editorSelection =
    (world.getSystem("editor-selection") as EditorSelectionSystem) ?? null;
  world.editorGizmo =
    (world.getSystem("editor-gizmo") as EditorGizmoSystem) ?? null;

  if (world._initialCameraTarget && world.editorCamera) {
    const t = world._initialCameraTarget;
    world.editorCamera.setTarget(new THREE.Vector3(t.x, t.y, t.z));
    world._initialCameraTarget = undefined;
  }
  return world;
}

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
