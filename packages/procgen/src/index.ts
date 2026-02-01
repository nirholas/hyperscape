/**
 * @hyperscape/procgen
 *
 * Procedural generation toolkit for trees, plants, rocks, and buildings.
 * Tree generation is based on the Weber & Penn algorithm.
 *
 * @packageDocumentation
 */

// Types and LOD Presets
export * from "./types.js";
export { TREE_LOD_PRESETS } from "./types.js";

// Math utilities
export {
  SeededRandom,
  randInRange,
  declination,
  randomVector,
  rotatedVector,
  radians,
  degrees,
  toTrackQuat,
  vec3FromArray,
  lerpVec3,
  type BezierSplinePoint,
  calcPointOnBezier,
  calcTangentToBezier,
  createBezierPoint,
  evaluateBezierSpline,
  bezierArcLength,
  sampleBezierByArcLength,
  type HelixPoints,
  calcHelixPoints,
  calcHelixPitch,
  calcHelixRadius,
} from "./math/index.js";

// Core classes
export {
  Tree,
  Turtle,
  applyTropism,
  makeBranchPosTurtle,
  makeBranchDirTurtle,
  Stem,
  scaleBezierHandlesForFlare,
  createStemPoint,
  type StemPointWithRadius,
  Leaf,
  shapeRatio,
  pointInsideEnvelope,
  calcBranchLengthModifier,
} from "./core/index.js";

// Geometry
export {
  generateLeafGeometry,
  generateSeparateLeafGeometry,
  generateBranchGeometry,
  generateBranchGeometryByDepth,
  getLeafShape,
  getBlossomShape,
  ALL_LEAF_SHAPES,
  ALL_BLOSSOM_SHAPES,
  // Vertex AO computation
  computeVertexAO,
  computeQuickVertexAO,
  enableVertexColorMaterials,
  type VertexAOOptions,
  // TSL (WebGPU) instanced leaf material - GLSL version removed
  createInstancedLeafMaterialTSL,
  type TSLInstancedLeafMaterial,
  type TSLInstancedLeafMaterialOptions,
  type TSLLeafShape,
} from "./geometry/index.js";

// Parameters and presets
export {
  DEFAULT_PARAMS,
  createTreeParams,
  PRESETS,
  getPreset,
  getPresetNames,
  ACER,
  APPLE,
  BALSAM_FIR,
  BAMBOO,
  BLACK_OAK,
  BLACK_TUPELO,
  CAMBRIDGE_OAK,
  DOUGLAS_FIR,
  EUROPEAN_LARCH,
  FAN_PALM,
  HILL_CHERRY,
  LOMBARDY_POPLAR,
  PALM,
  QUAKING_ASPEN,
  SASSAFRAS,
  SILVER_BIRCH,
  SMALL_PINE,
  SPHERE_TREE,
  WEEPING_WILLOW,
} from "./params/index.js";

// Rendering
export {
  generateTreeMesh,
  createDefaultBranchMaterial,
  createDefaultLeafMaterial,
  createDefaultBlossomMaterial,
  disposeTreeMesh,
  type TreeMeshOptions,
  type TreeMeshResult,
  TreeGenerator,
  generateTree,
  generateTreeVariations,
  addTreeToScene,
  exportTreeToGLB,
  exportTreeToGLBFile,
  generateAndExportTree,
  type TreeGeneratorOptions,
  type GLBExportOptions,
  type GLBExportResult,
} from "./rendering/index.js";

// Export utilities
export { exportToGLB, exportToGLBFile } from "./export/index.js";

// Impostor System (LOD) - re-exports from @hyperscape/impostor
export {
  // Tree-specific API
  TreeImpostor,
  bakeTreeImpostor,
  type TreeImpostorOptions,
  // Re-exported from @hyperscape/impostor for convenience
  OctahedralImpostor,
  OctahedronType,
  type OctahedronTypeValue,
  ImpostorBaker,
  type CompatibleRenderer,
  type ImpostorBakeConfig,
  type ImpostorBakeResult,
  type ImpostorInstance,
  type ImpostorViewData,
  createTSLImpostorMaterial,
  type TSLImpostorMaterial,
} from "./impostor/index.js";

// Additional generators (namespaced to avoid export collisions)
export * as PlantGen from "./plant/index.js";
export * as RockGen from "./rock/index.js";
export * as BuildingGen from "./building/index.js";
export * as TerrainGen from "./terrain/index.js";
export * as VegetationGen from "./vegetation/index.js";
