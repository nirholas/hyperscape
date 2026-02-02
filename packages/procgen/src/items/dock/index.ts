/**
 * Dock Generation Module - Procedural dock generator
 */

// Types
export type {
  DockRecipe,
  PartialDockRecipe,
  DockStyleValue,
  DockLayout,
  PlankData,
  PostData,
  RailingData,
  MooringData,
  GeneratedDock,
  DockGeometryArrays,
  DockGenerationOptions,
} from "./types";
export { DockStyle } from "./types";

// Presets
export {
  DEFAULT_DOCK_PARAMS,
  DOCK_PRESETS,
  getDockPreset,
  getDockPresetNames,
  mergeDockParams,
} from "./presets";

// Generator
export { DockGenerator, dockGenerator } from "./DockGenerator";

// Geometry
export {
  createPlankGeometries,
  createPostGeometries,
  createRailingGeometries,
  createMooringGeometries,
  computeFlatNormals,
} from "./DockGeometry";

// Material
export {
  createDockMaterial,
  createSimpleDockMaterial,
  updateDockMaterialWaterLevel,
  type DockMaterialUniforms,
  type DockMaterialResult,
} from "./DockMaterialTSL";
