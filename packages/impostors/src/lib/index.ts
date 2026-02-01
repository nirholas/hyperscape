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

// Materials (TSL - WebGPU only)
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
  directionToUV,
  directionToGridCell,
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
  DissolveConfig,
  // Animated impostor types
  AnimatedBakeConfig,
  AnimatedBakeResult,
  MobVariantConfig,
  GlobalMobAtlas,
  AnimatedImpostorInstanceData,
  AnimatedImpostorMaterialConfig,
} from "./types";

// Re-export the type constant for convenience
export {
  OctahedronType as OCT,
  PBRBakeMode,
  DEFAULT_ANIMATED_BAKE_CONFIG,
} from "./types";

// ============================================================================
// ANIMATED IMPOSTORS
// ============================================================================

// Animated impostor baker
export {
  AnimatedImpostorBaker,
  type WebGPUCompatibleRenderer,
} from "./AnimatedImpostorBaker";

// Animated impostor materials (TSL/WebGPU)
export {
  createAnimatedImpostorMaterial,
  type AnimatedImpostorMaterial,
  type AnimatedImpostorUniforms,
  type InstancedAnimatedImpostorMaterial,
  type InstancedAnimatedImpostorUniforms,
  type InstancedAnimatedMaterialConfig,
} from "./AnimatedImpostorMaterialTSL";

// Animated impostor classes
export {
  AnimatedOctahedralImpostor,
  AnimatedImpostorController,
  type AnimatedOctahedralImpostorConfig,
} from "./AnimatedOctahedralImpostor";

// Global mob atlas
export { GlobalMobAtlasBuilder, GlobalMobAtlasManager } from "./GlobalMobAtlas";

// Instanced animated impostor
export {
  InstancedAnimatedImpostor,
  type MobInstanceData,
  type InstancedAnimatedImpostorConfig,
  type InstancedAnimatedUniforms,
} from "./InstancedAnimatedImpostor";
