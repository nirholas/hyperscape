/**
 * Tree Presets
 *
 * Complete parameter sets for 18 different tree species.
 * Each preset is based on the original Python tree-gen configurations.
 */

import type { TreeParams, PartialTreeParams } from "../types.js";
import { TreeShape, LeafShape, BlossomShape } from "../types.js";
import { createTreeParams } from "./defaults.js";

// =============================================================================
// PRESET PARTIAL DEFINITIONS
// =============================================================================

/** Acer (Japanese Maple) - multi-trunk maple with palmate leaves */
const ACER_PARTIAL: PartialTreeParams = {
  shape: TreeShape.TaperedCylindrical,
  gScale: 10,
  gScaleV: 1,
  levels: 3,
  ratio: 0.025,
  ratioPower: 1.5,
  flare: 0.6,
  baseSplits: -2,
  baseSize: [0.1, 0.4, 0.02, 0.02],
  downAngle: [0, 50, 50, 45],
  downAngleV: [0, 5, 5, 10],
  rotate: [0, 140, 140, 77],
  rotateV: [0, 0, 0, 0],
  branches: [1, 6, 20, 5],
  length: [1, 0.7, 0.3, 0],
  lengthV: [0, 0.05, 0.05, 0],
  taper: [1, 1, 1, 1],
  segSplits: [1.5, 1.5, 0, 0],
  splitAngle: [50, 50, 0, 0],
  splitAngleV: [5, 5, 0, 0],
  curveRes: [6, 5, 3, 0],
  curve: [0, 0, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [200, 100, 100, 0],
  bendV: [0, 50, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 50, // Increased for fuller canopy
  leafShape: LeafShape.Palmate,
  leafScale: 0.2,
  leafBend: 0.3,
  leafDistributionLevels: 2, // Leaves on main branches AND twigs for full canopy
  leafSecondaryScale: 0.4, // Secondary level leaves at 40% density
};

/** Apple tree - fruit tree with blossoms */
const APPLE_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Hemispherical,
  gScale: 9,
  gScaleV: 2,
  levels: 3,
  ratio: 0.02,
  ratioPower: 1.5,
  flare: 0.9,
  baseSplits: 0,
  baseSize: [0.15, 0.02, 0.02, 0.02],
  downAngle: [0, 60, 60, 45],
  downAngleV: [0, -30, 20, 30],
  rotate: [0, 140, 140, 77],
  rotateV: [0, 0, 0, 0],
  branches: [1, 35, 25, 10],
  length: [1, 0.5, 0.4, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0.6, 0, 0],
  splitAngle: [0, 20, 0, 0],
  splitAngleV: [0, 10, 0, 0],
  curveRes: [5, 10, 5, 0],
  curve: [0, -20, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [70, 140, 100, 0],
  bendV: [0, 50, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 50,
  leafShape: LeafShape.Elliptic,
  leafScale: 0.17,
  leafBend: 0.5,
  blossomRate: 0.35,
  blossomScale: 0.08,
  blossomShape: BlossomShape.Cherry,
  tropism: [0, 0, 2],
};

/** Balsam Fir - conical evergreen */
const BALSAM_FIR_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Conical,
  gScale: 12,
  gScaleV: 2,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.7,
  flare: 0.2,
  baseSplits: 0,
  baseSize: [0.05, 0.02, 0.02, 0.02],
  downAngle: [0, 50, 60, 45],
  downAngleV: [0, -45, 20, 30],
  rotate: [0, 140, -125, -90],
  rotateV: [0, 0, 20, 20],
  branches: [1, 100, 75, 10],
  length: [1, 0.5, 0.25, 0],
  lengthV: [0.2, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [5, 5, 2, 0],
  curve: [0, -40, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [20, 10, 40, 0],
  bendV: [0, 10, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 100,
  leafShape: LeafShape.Linear,
  leafScale: 0.13,
  leafScaleX: 0.5,
  leafBend: 0,
};

/** Bamboo - clump of bamboo stalks */
const BAMBOO_PARTIAL: PartialTreeParams = {
  shape: TreeShape.TendFlame,
  gScale: 10,
  gScaleV: 2,
  levels: 2,
  ratio: 0.005,
  ratioPower: 1,
  flare: 0,
  baseSize: [0.4, 0.4, 0, 0],
  downAngle: [0, 30, 30, 30],
  downAngleV: [0, 10, 10, 10],
  rotate: [0, 77, 77, 77],
  rotateV: [0, 30, 0, 0],
  branches: [50, 25, 0, 10],
  length: [1, 0.2, 0, 0],
  lengthV: [0, 0.05, 0, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [10, 5, 0, 1],
  curve: [50, 30, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [70, 0, 0, 0],
  leafBlosNum: 20,
  leafShape: LeafShape.Default,
  leafScale: 0.3,
  leafScaleX: 0.3,
  leafBend: 0.1,
  tropism: [0, 0, 0],
};

/** Black Oak - California black oak */
const BLACK_OAK_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Hemispherical,
  gScale: 10,
  gScaleV: 2,
  levels: 3,
  ratio: 0.018,
  ratioPower: 1.25,
  flare: 1.2,
  baseSize: [0.05, 0.02, 0.02, 0.02],
  downAngle: [0, 30, 45, 45],
  downAngleV: [0, -30, 10, 10],
  rotate: [0, 80, 140, 140],
  rotateV: [0, 20, 20, 20],
  branches: [1, 30, 120, 0],
  length: [1, 0.8, 0.3, 0.4],
  lengthV: [0, 0.1, 0.05, 0],
  taper: [0.95, 1, 1, 1],
  segSplits: [0.1, 0.1, 0.1, 0],
  splitAngle: [10, 10, 10, 0],
  splitAngleV: [0, 10, 10, 0],
  curveRes: [8, 10, 3, 1],
  curve: [0, 40, 0, 0],
  curveBack: [0, -70, 0, 0],
  curveV: [90, 150, -30, 0],
  bendV: [0, 100, 0, 0],
  leafBlosNum: 80, // Increased for fuller canopy
  leafShape: LeafShape.SpikyOak,
  leafScale: 0.2,
  leafScaleX: 0.66,
  leafBend: 0.3,
  leafDistributionLevels: 2, // Full canopy coverage
  leafSecondaryScale: 0.4,
  tropism: [0, 0, 0.8],
};

/** Black Tupelo - large deciduous tree */
const BLACK_TUPELO_PARTIAL: PartialTreeParams = {
  shape: TreeShape.TaperedCylindrical,
  gScale: 23,
  gScaleV: 5,
  levels: 4,
  ratio: 0.015,
  ratioPower: 1.3,
  flare: 1,
  baseSplits: 0,
  baseSize: [0.2, 0.02, 0.02, 0.02],
  downAngle: [0, 60, 40, 45],
  downAngleV: [0, -40, 10, 10],
  rotate: [0, 140, 140, 140],
  rotateV: [0, 60, 50, 0],
  branches: [1, 75, 25, 15],
  length: [1, 0.3, 0.6, 0.2],
  lengthV: [0, 0.05, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [10, 10, 10, 1],
  curve: [0, 0, -10, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [40, 90, 150, 0],
  bendV: [0, 100, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 20,
  leafShape: LeafShape.Default,
  leafScale: 0.2,
  leafScaleX: 1,
  leafBend: 0.3,
};

/** Cambridge Oak - English oak with pruning */
const CAMBRIDGE_OAK_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Cylindrical,
  gScale: 20,
  gScaleV: 4,
  levels: 4,
  ratio: 0.03,
  ratioPower: 2,
  flare: 0.5,
  baseSplits: 1,
  baseSize: [0.2, 0, 0, 0],
  downAngle: [0, 60, 60, 45],
  downAngleV: [0, -30, 30, 10],
  rotate: [0, 110, 110, 110],
  rotateV: [0, 50, 50, 0],
  branches: [1, 15, 10, 50],
  length: [1, 0.4, 0.6, 0.2],
  lengthV: [0, 0.1, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0.5, 0.5, 0.2, 0],
  splitAngle: [50, 50, 50, 0],
  splitAngleV: [20, 10, 10, 0],
  curveRes: [10, 10, 10, 3],
  curve: [0, 20, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [100, 400, 500, 100],
  bendV: [100, 100, 30, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 15,
  leafShape: LeafShape.RoundedOak,
  leafScale: 0.13,
  leafScaleX: 1,
  leafBend: 0,
  tropism: [0, 0, 0.5],
  pruneRatio: 1,
  pruneWidth: 0.6,
  pruneWidthPeak: 0.2,
  prunePowerLow: 0.1,
  prunePowerHigh: 0.5,
};

/** Douglas Fir - tall conical evergreen */
const DOUGLAS_FIR_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Conical,
  gScale: 40,
  gScaleV: 10,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.2,
  flare: 1.0,
  baseSize: [0.2, 0.1, 0.02, 0.02],
  downAngle: [0, 100, 40, 45],
  downAngleV: [0, -40, 10, 10],
  rotate: [0, 140, 140, 140],
  rotateV: [0, 60, 50, 0],
  branches: [1, 250, 30, 0],
  length: [1, 0.13, 0.4, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0.5, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [2, 5, 3, 1],
  curve: [0, -35, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [0, 90, 150, 0],
  bendV: [0, 50, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 100,
  leafShape: LeafShape.Linear,
  leafScale: 0.15,
  leafScaleX: 0.3,
  leafBend: 0,
};

/** European Larch - deciduous conifer */
const EUROPEAN_LARCH_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Conical,
  gScale: 15,
  gScaleV: 7,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.3,
  flare: 0.3,
  baseSize: [0.25, 0.02, 0.02, 0.02],
  downAngle: [0, 60, 70, 30],
  downAngleV: [0, -50, 30, 15],
  rotate: [0, 70, 70, 120],
  rotateV: [0, 30, 30, 30],
  branches: [1, 60, 50, 0],
  length: [1, 0.25, 0.3, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0.15, 0],
  splitAngle: [0, 0, 40, 0],
  splitAngleV: [0, 0, 10, 0],
  curveRes: [20, 17, 7, 1],
  curve: [0, 20, 0, 0],
  curveBack: [0, -100, 0, 0],
  curveV: [60, 120, 0, 0],
  leafBlosNum: 200,
  leafShape: LeafShape.Linear,
  leafScale: 0.07,
  leafScaleX: 0.5,
  leafBend: 0.1,
  tropism: [0, 0, -3.0],
};

/** Fan Palm - palm with fan-shaped fronds */
const FAN_PALM_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Cylindrical,
  gScale: 5,
  gScaleV: 2,
  levels: 2,
  ratio: 0.04,
  ratioPower: 1.3,
  flare: 0,
  baseSize: [0.8, 0, 0, 0],
  downAngle: [0, 20, -10, 0],
  downAngleV: [0, -60, 10, 0],
  rotate: [0, 160, 260, 0],
  rotateV: [0, 40, 5, 0],
  branches: [1, 50, 0, 0],
  length: [1, 0.25, 0, 0],
  lengthV: [0, 0.05, 0, 0],
  taper: [2.1, 1.4, 0, 0],
  segSplits: [0, 0, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [6, 9, 0, 0],
  curve: [10, 50, 0, 0],
  curveBack: [0, -5, 0, 0],
  curveV: [40, 30, 0, 0],
  bendV: [0, 0, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: -90,
  leafShape: LeafShape.Triangle,
  leafScale: 0.8,
  leafScaleX: 0.05,
  leafBend: 0,
  tropism: [0, 0, -1],
};

/** Hill Cherry - flowering cherry with blossoms */
const HILL_CHERRY_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Hemispherical,
  gScale: 13,
  gScaleV: 3,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.3,
  flare: 0.6,
  baseSplits: -2,
  baseSize: [0.15, 0.02, 0.02, 0.02],
  downAngle: [0, 70, 60, 45],
  downAngleV: [0, 10, 20, 30],
  rotate: [0, 140, 140, 77],
  rotateV: [0, 0, 0, 0],
  branches: [1, 25, 18, 10],
  length: [0.8, 0.5, 0.6, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0.5, 0.3, 0, 0],
  splitAngle: [40, 40, 0, 0],
  splitAngleV: [5, 5, 0, 0],
  curveRes: [10, 5, 8, 0],
  curve: [30, -20, -40, 0],
  curveBack: [-40, 40, 0, 0],
  curveV: [150, 150, 150, 0],
  bendV: [150, 150, 250, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 25,
  tropism: [0, 0, -1],
  blossomRate: 1,
  blossomScale: 0.1,
  blossomShape: BlossomShape.Cherry,
  pruneRatio: 1,
  pruneWidth: 0.7,
  pruneWidthPeak: 0.5,
  prunePowerLow: 0.2,
  prunePowerHigh: 0.5,
};

/** Lombardy Poplar - tall narrow tree */
const LOMBARDY_POPLAR_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Hemispherical,
  gScale: 25,
  gScaleV: 5,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.2,
  flare: 0.8,
  baseSize: [0.01, 0.1, 0.02, 0.02],
  downAngle: [0, 30, 30, 30],
  downAngleV: [0, 0, 10, 10],
  rotate: [0, 77, 77, 77],
  rotateV: [0, 15, 15, 15],
  branches: [1, 60, 35, 10],
  length: [1, 0.3, 0.4, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  curveRes: [1, 3, 3, 1],
  curve: [0, -20, -20, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [0, 0, 40, 0],
  leafBlosNum: 30,
  leafShape: LeafShape.Elliptic,
  leafScale: 0.3,
  leafScaleX: 1,
  leafBend: 0.7,
  tropism: [0, 0, 0.5],
};

/** Palm - tropical palm tree */
const PALM_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Cylindrical,
  gScale: 14,
  gScaleV: 3,
  levels: 2,
  ratio: 0.015,
  ratioPower: 2,
  flare: 0.3,
  baseSize: [0.95, 0.02, 0, 0],
  downAngle: [0, 60, 50, 0],
  downAngleV: [0, -80, -75, 0],
  rotate: [0, 120, -120, 0],
  rotateV: [0, 60, 20, 0],
  branches: [1, 25, 0, 0],
  length: [1, 0.3, 0, 0],
  lengthV: [0, 0.02, 0, 0],
  taper: [2.15, 1, 0, 0],
  segSplits: [0, 0, 0, 0],
  splitAngle: [0, 0, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [12, 9, 0, 0],
  curve: [20, 40, 0, 0],
  curveBack: [-10, 0, 0, 0],
  curveV: [10, 20, 0, 0],
  bendV: [0, 0, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 150,
  leafShape: LeafShape.Triangle,
  leafScale: 0.8,
  leafScaleX: 0.12,
  leafBend: 0,
  tropism: [0, 0, -3],
};

/** Quaking Aspen - default tree type */
const QUAKING_ASPEN_PARTIAL: PartialTreeParams = {
  shape: TreeShape.TendFlame,
  gScale: 13,
  gScaleV: 3,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.2,
  flare: 0.6,
  baseSplits: 0,
  baseSize: [0.3, 0.02, 0.02, 0.02],
  downAngle: [0, 60, 60, 45],
  downAngleV: [0, -50, 20, 30],
  rotate: [0, 140, 140, 77],
  rotateV: [0, 0, 0, 0],
  branches: [1, 50, 30, 1],
  length: [1, 0.3, 0.6, 0],
  lengthV: [0, 0, 0.1, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [40, 0, 0, 0],
  splitAngleV: [5, 0, 0, 0],
  curveRes: [5, 5, 5, 0],
  curve: [0, -40, -60, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [20, 100, 100, 0],
  bendV: [0, 50, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 40,
  leafShape: LeafShape.Cordate,
  leafScale: 0.17,
  leafBend: 0.6,
};

/** Sassafras - medium deciduous tree */
const SASSAFRAS_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Hemispherical,
  gScale: 23,
  gScaleV: 7,
  levels: 4,
  ratio: 0.02,
  ratioPower: 1.3,
  flare: 0.5,
  baseSplits: 0,
  baseSize: [0.2, 0.02, 0.02, 0.02],
  downAngle: [0, 90, 50, 45],
  downAngleV: [0, -10, 10, 10],
  rotate: [0, 140, 140, 140],
  rotateV: [0, 0, 0, 0],
  branches: [1, 20, 20, 30],
  length: [1, 0.4, 0.7, 0.4],
  lengthV: [0, 0, 0, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [20, 0, 0, 0],
  splitAngleV: [5, 0, 0, 0],
  curveRes: [16, 15, 8, 3],
  curve: [0, -60, -40, 0],
  curveBack: [0, 30, 0, 0],
  curveV: [60, 100, 150, 100],
  leafBlosNum: 15,
  leafShape: LeafShape.Default,
  leafScale: 0.25,
  leafScaleX: 0.7,
  leafBend: 0.3,
  tropism: [0, 0, 0.5],
};

/** Silver Birch - white-barked deciduous tree */
const SILVER_BIRCH_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Cylindrical,
  gScale: 20,
  gScaleV: 5,
  levels: 3,
  ratio: 0.015,
  ratioPower: 1.5,
  flare: 0.5,
  baseSplits: 0,
  baseSize: [0.3, 0.1, 0.02, 0.02],
  downAngle: [0, 50, 40, 45],
  downAngleV: [0, -20, 10, 10],
  rotate: [0, 140, 140, 140],
  rotateV: [0, 60, 50, 0],
  branches: [1, 30, 60, 0],
  length: [1, 0.3, 0.4, 0],
  lengthV: [0, 0.05, 0.2, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0, 0.3, 0, 0],
  splitAngle: [15, 10, 0, 0],
  splitAngleV: [0, 0, 0, 0],
  curveRes: [10, 10, 10, 0],
  curve: [0, 0, -10, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [50, 150, 200, 0],
  bendV: [0, 100, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 65,
  leafShape: LeafShape.Cordate,
  leafScale: 0.15,
  leafScaleX: 1,
  leafBend: 0.2,
  tropism: [0, 0, -2],
};

/** Small Pine - small conical pine */
const SMALL_PINE_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Conical,
  gScale: 6,
  gScaleV: 0.5,
  levels: 2,
  ratio: 0.02,
  ratioPower: 1.3,
  flare: 0.3,
  baseSize: [0.05, 0.02, 0.02, 0.02],
  downAngle: [0, 30, 30, 0],
  downAngleV: [0, -60, 10, 0],
  rotate: [0, 140, 140, 0],
  rotateV: [0, 30, 20, 0],
  branches: [1, 70, 0, 0],
  length: [1, 0.35, 0, 0],
  lengthV: [0, 0.05, 0, 0],
  taper: [1, 1, 0, 0],
  segSplits: [0, 2, 0, 0],
  splitAngle: [0, -80, 0, 0],
  splitAngleV: [0, -30, 0, 0],
  curveRes: [5, 6, 0, 0],
  curve: [0, -20, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [10, 90, 0, 0],
  bendV: [0, 70, 0, 0],
  branchDist: [0, 3.5, 0, 0],
  leafBlosNum: 400,
  leafShape: LeafShape.Linear,
  leafScale: 0.17,
  leafScaleX: 0.3,
  leafBend: 0,
  tropism: [0, 0, 0],
};

/** Sphere Tree - spherical pruned tree */
const SPHERE_TREE_PARTIAL: PartialTreeParams = {
  shape: TreeShape.Cylindrical,
  gScale: 6,
  gScaleV: 0,
  levels: 3,
  ratio: 0.025,
  ratioPower: 1.5,
  flare: 0.6,
  baseSplits: 0,
  baseSize: [0.5, 0.02, 0.02, 0.02],
  downAngle: [0, 70, 45, 45],
  downAngleV: [0, 20, 10, 10],
  rotate: [0, 100, 140, 77],
  rotateV: [0, 0, 0, 0],
  branches: [1, 70, 75, 10],
  length: [1, 1, 1, 0],
  lengthV: [0, 0, 0, 0],
  taper: [2, 1, 1, 1],
  segSplits: [0, 0, 0, 0],
  splitAngle: [40, 0, 0, 0],
  splitAngleV: [5, 0, 0, 0],
  curveRes: [5, 5, 3, 1],
  curve: [0, 0, 0, 0],
  curveBack: [0, 0, 0, 0],
  curveV: [-40, 75, 75, 0],
  bendV: [0, 50, 0, 0],
  branchDist: [0, 0, 0, 0],
  leafBlosNum: 25,
  leafShape: LeafShape.Default,
  leafScale: 0.17,
  leafScaleX: 1,
  leafBend: 0.3,
  tropism: [0, 0, 0],
  pruneRatio: 1,
  pruneWidth: 0.3,
  pruneWidthPeak: 0.5,
  prunePowerLow: 0.5,
  prunePowerHigh: 0.5,
};

/** Weeping Willow - drooping willow tree */
const WEEPING_WILLOW_PARTIAL: PartialTreeParams = {
  shape: TreeShape.TaperedCylindrical,
  gScale: 15,
  gScaleV: 3,
  levels: 4,
  ratio: 0.03,
  ratioPower: 1.2,
  flare: 0.75,
  baseSplits: 2,
  baseSize: [0.05, 0.3, 0.05, 0.05],
  downAngle: [0, 40, 30, 20],
  downAngleV: [0, 10, 10, 10],
  rotate: [0, -120, -120, 140],
  rotateV: [0, 30, 30, 0],
  branches: [1, 17, 25, 75],
  length: [1, 0.35, 2.0, 0.1],
  lengthV: [0, 0.1, 0, 0],
  taper: [1, 1, 1, 1],
  segSplits: [0.2, 0.2, 0.1, 0],
  splitAngle: [40, 30, 45, 0],
  splitAngleV: [5, 10, 20, 0],
  curveRes: [8, 16, 12, 2],
  curve: [0, 40, 0, 0],
  curveBack: [25, 0, 0, 0],
  curveV: [90, 200, 0, 0],
  bendV: [0, 160, 0, 0],
  branchDist: [0, 0, 0, 0],
  radiusMod: [1, 1, 0.1, 1],
  leafBlosNum: 20,
  leafShape: LeafShape.Default,
  leafScale: 0.13,
  leafScaleX: 0.2,
  leafBend: 0,
  tropism: [0, 0, -3],
  pruneRatio: 1,
  pruneWidth: 0.4,
  pruneWidthPeak: 0.6,
  prunePowerLow: 0.001,
  prunePowerHigh: 0.5,
};

// =============================================================================
// COMPLETE PRESET EXPORTS
// =============================================================================

/** Acer (Japanese Maple) */
export const ACER: TreeParams = createTreeParams(ACER_PARTIAL);

/** Apple tree */
export const APPLE: TreeParams = createTreeParams(APPLE_PARTIAL);

/** Balsam Fir */
export const BALSAM_FIR: TreeParams = createTreeParams(BALSAM_FIR_PARTIAL);

/** Bamboo */
export const BAMBOO: TreeParams = createTreeParams(BAMBOO_PARTIAL);

/** Black Oak */
export const BLACK_OAK: TreeParams = createTreeParams(BLACK_OAK_PARTIAL);

/** Black Tupelo */
export const BLACK_TUPELO: TreeParams = createTreeParams(BLACK_TUPELO_PARTIAL);

/** Cambridge Oak */
export const CAMBRIDGE_OAK: TreeParams = createTreeParams(
  CAMBRIDGE_OAK_PARTIAL,
);

/** Douglas Fir */
export const DOUGLAS_FIR: TreeParams = createTreeParams(DOUGLAS_FIR_PARTIAL);

/** European Larch */
export const EUROPEAN_LARCH: TreeParams = createTreeParams(
  EUROPEAN_LARCH_PARTIAL,
);

/** Fan Palm */
export const FAN_PALM: TreeParams = createTreeParams(FAN_PALM_PARTIAL);

/** Hill Cherry */
export const HILL_CHERRY: TreeParams = createTreeParams(HILL_CHERRY_PARTIAL);

/** Lombardy Poplar */
export const LOMBARDY_POPLAR: TreeParams = createTreeParams(
  LOMBARDY_POPLAR_PARTIAL,
);

/** Palm */
export const PALM: TreeParams = createTreeParams(PALM_PARTIAL);

/** Quaking Aspen (default tree type) */
export const QUAKING_ASPEN: TreeParams = createTreeParams(
  QUAKING_ASPEN_PARTIAL,
);

/** Sassafras */
export const SASSAFRAS: TreeParams = createTreeParams(SASSAFRAS_PARTIAL);

/** Silver Birch */
export const SILVER_BIRCH: TreeParams = createTreeParams(SILVER_BIRCH_PARTIAL);

/** Small Pine */
export const SMALL_PINE: TreeParams = createTreeParams(SMALL_PINE_PARTIAL);

/** Sphere Tree */
export const SPHERE_TREE: TreeParams = createTreeParams(SPHERE_TREE_PARTIAL);

/** Weeping Willow */
export const WEEPING_WILLOW: TreeParams = createTreeParams(
  WEEPING_WILLOW_PARTIAL,
);

// =============================================================================
// PRESET REGISTRY
// =============================================================================

/**
 * All available tree presets by name.
 */
export const PRESETS: Record<string, TreeParams> = {
  acer: ACER,
  apple: APPLE,
  balsamFir: BALSAM_FIR,
  bamboo: BAMBOO,
  blackOak: BLACK_OAK,
  blackTupelo: BLACK_TUPELO,
  cambridgeOak: CAMBRIDGE_OAK,
  douglasFir: DOUGLAS_FIR,
  europeanLarch: EUROPEAN_LARCH,
  fanPalm: FAN_PALM,
  hillCherry: HILL_CHERRY,
  lombardyPoplar: LOMBARDY_POPLAR,
  palm: PALM,
  quakingAspen: QUAKING_ASPEN,
  sassafras: SASSAFRAS,
  silverBirch: SILVER_BIRCH,
  smallPine: SMALL_PINE,
  sphereTree: SPHERE_TREE,
  weepingWillow: WEEPING_WILLOW,
};

/**
 * Get a tree preset by name.
 *
 * @param name - Preset name (case-insensitive, supports various formats)
 * @returns TreeParams for the preset, or default if not found
 */
export function getPreset(name: string): TreeParams {
  // Normalize the name
  const normalized = name
    .toLowerCase()
    .replace(/[_\s-]+/g, "")
    .replace(/tree$/i, "");

  // Try to find an exact match
  for (const [key, params] of Object.entries(PRESETS)) {
    if (key.toLowerCase().replace(/[_\s-]+/g, "") === normalized) {
      return params;
    }
  }

  // Default to quaking aspen
  return QUAKING_ASPEN;
}

/**
 * Get all preset names.
 */
export function getPresetNames(): string[] {
  return Object.keys(PRESETS);
}
