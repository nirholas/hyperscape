/**
 * Octahedral Impostor Library
 *
 * A Three.js library for creating and rendering octahedral impostors -
 * billboard-based LOD representations that blend between pre-rendered views.
 *
 * @packageDocumentation
 */

// Main class
export {
  OctahedralImpostor,
  OctahedronType,
  DEFAULT_BAKE_CONFIG,
} from "./OctahedralImpostor";

// Baker
export { ImpostorBaker, type CompatibleRenderer } from "./ImpostorBaker";

// Materials (GLSL - WebGL only)
export {
  createImpostorMaterial,
  updateImpostorMaterial,
  updateImpostorLighting,
  updateImpostorAAALighting,
  syncImpostorLightingFromScene,
  createSimpleImpostorMaterial,
  ImpostorShaders,
  // Debug mode controls
  setImpostorDebugMode,
  getImpostorDebugMode,
  cycleImpostorDebugMode,
  // Alpha threshold controls
  setImpostorAlphaThreshold,
  getImpostorAlphaThreshold,
  unregisterMaterial,
  // Runtime diagnostics
  validateImpostorMaterial,
  debugImpostorMaterial,
  type ImpostorDebugMode,
  type DissolveConfig,
  type ImpostorMaterialConfigExtended,
  type AAALightingConfig,
  type ImpostorDiagnosticResult,
} from "./ImpostorMaterial";

// Materials (TSL - WebGPU compatible)
export {
  createTSLImpostorMaterial,
  isTSLImpostorMaterial,
  type TSLImpostorMaterial,
  type TSLImpostorMaterialOptions,
} from "./ImpostorMaterialTSL";

// Geometry utilities
export {
  buildOctahedronMesh,
  lerpOctahedronGeometry,
  getViewDirection,
} from "./OctahedronGeometry";

// Utility functions
export {
  createColoredCube,
  generateHSLGradientColors,
  centerGeometryToBoundingSphere,
  computeCombinedBoundingSphere,
  createTestTorusKnot,
  lerp,
  mapLinear,
} from "./utils";

// Types
export type {
  OctahedronTypeValue,
  PBRBakeModeValue,
  VerticalPackingRatio,
  ImpostorBakeConfig,
  ImpostorBakeResult,
  OctahedronMeshData,
  ImpostorMaterialConfig,
  ImpostorInstance,
  ImpostorViewData,
  OctahedralImpostorOptions,
  DebugVisualizationOptions,
  GeometryBufferProps,
  ImpostorDirectionalLight,
  ImpostorPointLight,
  ImpostorLightingConfig,
  ImpostorSpecularConfig,
} from "./types";

// Re-export the type constant for convenience
export { OctahedronType as OCT, PBRBakeMode } from "./types";
