/**
 * Default Tree Parameters
 *
 * The default values for all tree generation parameters.
 * These serve as the base which presets override.
 */

import type { TreeParams } from "../types.js";
import { TreeShape, LeafShape, BlossomShape } from "../types.js";

/**
 * Default tree parameters (based on Quaking Aspen).
 * All presets override these defaults.
 */
export const DEFAULT_PARAMS: TreeParams = {
  // Tree Shape
  shape: TreeShape.TendFlame,
  gScale: 13,
  gScaleV: 3,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.2,
  flare: 0.6,

  // Base/Trunk
  baseSplits: 0,
  baseSize: [0.3, 0.02, 0.02, 0.02] as const,

  // Branching Angles
  downAngle: [0, 60, 45, 45] as const,
  downAngleV: [0, -50, 10, 10] as const,
  rotate: [0, 140, 140, 77] as const,
  rotateV: [0, 0, 0, 0] as const,

  // Branch Count and Length
  branches: [1, 50, 30, 10] as const,
  length: [1, 0.3, 0.6, 0] as const,
  lengthV: [0, 0, 0, 0] as const,
  branchDist: [0, 0, 0, 0] as const,

  // Branch Shape
  taper: [1, 1, 1, 1] as const,
  radiusMod: [1, 1, 1, 1] as const,

  // Curves
  curveRes: [5, 5, 3, 1] as const,
  bevelRes: [10, 10, 10, 10] as const,
  curve: [0, -40, -40, 0] as const,
  curveV: [20, 50, 75, 0] as const,
  curveBack: [0, 0, 0, 0] as const,
  bendV: [0, 50, 0, 0] as const,

  // Splits
  segSplits: [0, 0, 0, 0] as const,
  splitAngle: [40, 0, 0, 0] as const,
  splitAngleV: [5, 0, 0, 0] as const,

  // Tropism
  tropism: [0, 0, 0.5] as const,

  // Pruning
  pruneRatio: 0,
  pruneWidth: 0.5,
  pruneWidthPeak: 0.5,
  prunePowerLow: 0.5,
  prunePowerHigh: 0.5,

  // Leaves
  leafBlosNum: 40,
  leafShape: LeafShape.Default,
  leafScale: 0.17,
  leafScaleX: 1,
  leafBend: 0.6,
  leafDistributionLevels: 1, // Default: only deepest level (original behavior)
  leafSecondaryScale: 0.5, // Secondary levels get 50% leaf density

  // Blossoms
  blossomShape: BlossomShape.Cherry,
  blossomScale: 0,
  blossomRate: 0,
};

/**
 * Create a TreeParams object by merging a partial preset with defaults.
 *
 * @param overrides - Partial parameter overrides
 * @returns Complete TreeParams object
 */
export function createTreeParams(overrides: Partial<TreeParams>): TreeParams {
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    // Ensure arrays are properly merged (don't use partial arrays)
    baseSize: overrides.baseSize ?? DEFAULT_PARAMS.baseSize,
    downAngle: overrides.downAngle ?? DEFAULT_PARAMS.downAngle,
    downAngleV: overrides.downAngleV ?? DEFAULT_PARAMS.downAngleV,
    rotate: overrides.rotate ?? DEFAULT_PARAMS.rotate,
    rotateV: overrides.rotateV ?? DEFAULT_PARAMS.rotateV,
    branches: overrides.branches ?? DEFAULT_PARAMS.branches,
    length: overrides.length ?? DEFAULT_PARAMS.length,
    lengthV: overrides.lengthV ?? DEFAULT_PARAMS.lengthV,
    branchDist: overrides.branchDist ?? DEFAULT_PARAMS.branchDist,
    taper: overrides.taper ?? DEFAULT_PARAMS.taper,
    radiusMod: overrides.radiusMod ?? DEFAULT_PARAMS.radiusMod,
    curveRes: overrides.curveRes ?? DEFAULT_PARAMS.curveRes,
    bevelRes: overrides.bevelRes ?? DEFAULT_PARAMS.bevelRes,
    curve: overrides.curve ?? DEFAULT_PARAMS.curve,
    curveV: overrides.curveV ?? DEFAULT_PARAMS.curveV,
    curveBack: overrides.curveBack ?? DEFAULT_PARAMS.curveBack,
    bendV: overrides.bendV ?? DEFAULT_PARAMS.bendV,
    segSplits: overrides.segSplits ?? DEFAULT_PARAMS.segSplits,
    splitAngle: overrides.splitAngle ?? DEFAULT_PARAMS.splitAngle,
    splitAngleV: overrides.splitAngleV ?? DEFAULT_PARAMS.splitAngleV,
    tropism: overrides.tropism ?? DEFAULT_PARAMS.tropism,
  };
}
