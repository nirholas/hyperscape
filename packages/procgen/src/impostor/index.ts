/**
 * Tree Impostor Module
 *
 * Re-exports impostor utilities from @hyperscape/impostor
 * and provides tree-specific wrappers.
 */

// Tree-specific impostor API
export {
  TreeImpostor,
  bakeTreeImpostor,
  type TreeImpostorOptions,
} from "./TreeImpostor.js";

// Re-export commonly used types from the impostor library
export {
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
} from "@hyperscape/impostor";
