/**
 * Type Definitions for Tree Generation
 *
 * All types used by the Weber & Penn tree generation algorithm.
 * Based on the original parametric tree generation paper and Blender implementation.
 */

import type * as THREE from "three";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Tree shape types that control the overall silhouette.
 * These determine how branch length varies with height.
 */
export const TreeShape = {
  /** Conical shape - branches longer at bottom */
  Conical: 0,
  /** Spherical shape - branches longest in middle */
  Spherical: 1,
  /** Hemispherical shape - half sphere */
  Hemispherical: 2,
  /** Cylindrical shape - uniform branch length */
  Cylindrical: 3,
  /** Tapered cylindrical - slight taper */
  TaperedCylindrical: 4,
  /** Flame shape - branches longest near top */
  Flame: 5,
  /** Inverse conical - branches longer at top */
  InverseConical: 6,
  /** Tend flame - modified flame shape */
  TendFlame: 7,
  /** Envelope/Custom - uses pruning parameters */
  Envelope: 8,
} as const;

export type TreeShapeType = (typeof TreeShape)[keyof typeof TreeShape];

/**
 * Leaf shape types (1-10).
 */
export const LeafShape = {
  /** Default - uses Elliptic */
  Default: 0,
  /** Ovate leaf shape */
  Ovate: 1,
  /** Linear/narrow leaf */
  Linear: 2,
  /** Cordate (heart-shaped) */
  Cordate: 3,
  /** Maple leaf shape */
  Maple: 4,
  /** Palmate (palm-like) */
  Palmate: 5,
  /** Spiky oak */
  SpikyOak: 6,
  /** Rounded oak */
  RoundedOak: 7,
  /** Elliptic (default) */
  Elliptic: 8,
  /** Rectangle (good for textures) */
  Rectangle: 9,
  /** Triangle */
  Triangle: 10,
} as const;

export type LeafShapeType = (typeof LeafShape)[keyof typeof LeafShape];

/**
 * Blossom shape types (1-3).
 */
export const BlossomShape = {
  /** Cherry blossom */
  Cherry: 1,
  /** Orange blossom */
  Orange: 2,
  /** Magnolia blossom */
  Magnolia: 3,
} as const;

export type BlossomShapeType = (typeof BlossomShape)[keyof typeof BlossomShape];

/**
 * Branching mode types.
 */
export const BranchMode = {
  /** Alternating or opposite branching */
  AltOpp: 1,
  /** Whorled branching (like fir trees) */
  Whorled: 2,
  /** Fan branching */
  Fan: 3,
} as const;

export type BranchModeType = (typeof BranchMode)[keyof typeof BranchMode];

// ============================================================================
// PARAMETERS
// ============================================================================

/**
 * 4-element array for per-level parameters.
 * Index 0 = trunk, 1-3 = branch levels.
 */
export type LevelArray = readonly [number, number, number, number];

/**
 * 3-element array for tropism vector.
 */
export type TropismVector = readonly [number, number, number];

/**
 * Complete tree generation parameters.
 * All parameters that control tree shape, branching, leaves, etc.
 */
export type TreeParams = {
  // ===== TREE SHAPE =====

  /** Tree shape type (0-8) - controls overall silhouette */
  shape: TreeShapeType;

  /** Overall tree scale (height in units) */
  gScale: number;

  /** Maximum variation in tree scale */
  gScaleV: number;

  /** Number of branching levels (1-4) */
  levels: number;

  /** Ratio of stem length to radius */
  ratio: number;

  /** How drastically branch radius reduces between levels */
  ratioPower: number;

  /** Flare at base of trunk (0 = none) */
  flare: number;

  // ===== BASE/TRUNK =====

  /** Number of trunk splits at base height */
  baseSplits: number;

  /** Proportion of branch with no children [per level] */
  baseSize: LevelArray;

  // ===== BRANCHING ANGLES =====

  /** Down angle of child branches from parent [per level] */
  downAngle: LevelArray;

  /** Variation in down angle [per level] */
  downAngleV: LevelArray;

  /** Rotation angle between branches [per level] */
  rotate: LevelArray;

  /** Variation in rotation angle [per level] */
  rotateV: LevelArray;

  // ===== BRANCH COUNT AND LENGTH =====

  /** Maximum child branches per parent [per level] */
  branches: LevelArray;

  /** Branch length as fraction of parent [per level] */
  length: LevelArray;

  /** Variation in branch length [per level] */
  lengthV: LevelArray;

  /** Branch distribution along parent (0=alternate, 1=opposite, >1=whorled) [per level] */
  branchDist: LevelArray;

  // ===== BRANCH SHAPE =====

  /** Tapering of branch radius (0-3) [per level] */
  taper: LevelArray;

  /** Radius modifier [per level] */
  radiusMod: LevelArray;

  // ===== CURVES =====

  /** Curve resolution (segments per branch) [per level] */
  curveRes: LevelArray;

  /** Bevel resolution for rendering [per level] */
  bevelRes: LevelArray;

  /** Curve angle (x-axis rotation) [per level] */
  curve: LevelArray;

  /** Curve variation (negative = helix) [per level] */
  curveV: LevelArray;

  /** Curve back angle (S-shaped branches) [per level] */
  curveBack: LevelArray;

  /** Bend variation (y-axis rotation) [per level] */
  bendV: LevelArray;

  // ===== SPLITS =====

  /** Segment splits (dichotomous branching) [per level] */
  segSplits: LevelArray;

  /** Angle between split branches [per level] */
  splitAngle: LevelArray;

  /** Variation in split angle [per level] */
  splitAngleV: LevelArray;

  // ===== TROPISM =====

  /** Growth direction influence [x, y, z] */
  tropism: TropismVector;

  // ===== PRUNING =====

  /** Pruning envelope strength (0-1) */
  pruneRatio: number;

  /** Pruning envelope width (fraction of height) */
  pruneWidth: number;

  /** Height fraction where max width occurs */
  pruneWidthPeak: number;

  /** Lower envelope curvature */
  prunePowerLow: number;

  /** Upper envelope curvature */
  prunePowerHigh: number;

  // ===== LEAVES =====

  /** Number of leaves per deepest branch (negative = fan) */
  leafBlosNum: number;

  /** Leaf shape type (1-10) */
  leafShape: LeafShapeType;

  /** Overall leaf scale */
  leafScale: number;

  /** Leaf width scale */
  leafScaleX: number;

  /** Leaf bend toward light (0-1) */
  leafBend: number;

  /**
   * Number of branch levels that get leaves (default: 1 = deepest only).
   * Set to 2 to place leaves at levels-1 AND levels-2.
   * Higher values fill canopy more densely but increase leaf count.
   */
  leafDistributionLevels: number;

  /**
   * Scale factor for leaves on non-deepest levels (default: 0.5).
   * Leaves on levels-2 get scaled by this factor (fewer, smaller leaves).
   */
  leafSecondaryScale: number;

  // ===== BLOSSOMS =====

  /** Blossom shape type (1-3) */
  blossomShape: BlossomShapeType;

  /** Blossom scale */
  blossomScale: number;

  /** Rate of blossoms vs leaves (0-1) */
  blossomRate: number;
};

/**
 * Partial tree parameters for creating presets or overrides.
 */
export type PartialTreeParams = Partial<TreeParams>;

// ============================================================================
// STEM/BRANCH DATA
// ============================================================================

/**
 * A point on a stem's Bezier curve.
 */
export type StemPoint = {
  /** Position in world space */
  position: THREE.Vector3;
  /** Left Bezier handle */
  handleLeft: THREE.Vector3;
  /** Right Bezier handle */
  handleRight: THREE.Vector3;
  /** Radius at this point */
  radius: number;
};

/**
 * Data for a single stem (trunk or branch).
 */
export type StemData = {
  /** Branching depth (0 = trunk) */
  depth: number;
  /** Bezier curve points defining the stem */
  points: StemPoint[];
  /** Reference to parent stem (null for trunk) */
  parentIndex: number | null;
  /** Position along parent where this stem originates (0-1) */
  offset: number;
  /** Maximum radius allowed (from parent) */
  radiusLimit: number;
  /** Indices of child stems */
  childIndices: number[];
  /** Total length of this stem */
  length: number;
  /** Base radius of this stem */
  radius: number;
  /** Maximum child branch length */
  lengthChildMax: number;
};

// ============================================================================
// LEAF DATA
// ============================================================================

/**
 * Data for a single leaf.
 */
export type LeafData = {
  /** Position in world space */
  position: THREE.Vector3;
  /** Direction the leaf faces */
  direction: THREE.Vector3;
  /** Right vector (for orientation) */
  right: THREE.Vector3;
  /** Whether this is a blossom instead of a leaf */
  isBlossom: boolean;
};

// ============================================================================
// TREE DATA (OUTPUT)
// ============================================================================

/**
 * Complete generated tree data.
 * This is the output of the tree generation algorithm.
 */
export type TreeData = {
  /** All stems (trunk + branches) */
  stems: StemData[];
  /** All leaves and blossoms */
  leaves: LeafData[];
  /** The parameters used to generate this tree */
  params: TreeParams;
  /** The seed used for generation */
  seed: number;
  /** Overall tree scale that was applied */
  treeScale: number;
  /** Trunk length */
  trunkLength: number;
  /** Base length (trunk portion with no branches) */
  baseLength: number;
};

// ============================================================================
// GEOMETRY DATA
// ============================================================================

/**
 * Leaf shape geometry definition.
 */
export type LeafShapeGeometry = {
  /** Vertex positions [x, y, z] for each vertex */
  vertices: readonly (readonly [number, number, number])[];
  /** Face indices (triangles or quads) */
  faces: readonly (readonly number[])[];
  /** Optional UV coordinates */
  uvs?: readonly (readonly [number, number])[];
};

/**
 * Generated mesh geometry data.
 */
export type MeshGeometryData = {
  /** Vertex positions (flat array: x, y, z, x, y, z, ...) */
  positions: Float32Array;
  /** Vertex normals (flat array: nx, ny, nz, ...) */
  normals: Float32Array;
  /** UV coordinates (flat array: u, v, u, v, ...) */
  uvs: Float32Array;
  /** Triangle indices */
  indices: Uint32Array;
  /** Vertex colors if present (flat array: r, g, b, r, g, b, ...) */
  colors?: Float32Array;
};

// ============================================================================
// GENERATION OPTIONS
// ============================================================================

/**
 * Options for tree generation.
 */
export type TreeGenerationOptions = {
  /** Random seed (0 = random) */
  seed?: number;
  /** Whether to generate leaves */
  generateLeaves?: boolean;
  /** Maximum branch depth to generate */
  maxDepth?: number;
};

/**
 * Leaf sampling mode for LOD reduction.
 * - 'sequential': Take first N leaves (fastest, but removes from end of generation order)
 * - 'random': Seeded random shuffle then take first N (uniform random distribution)
 * - 'spatial': Spatially-stratified sampling to maintain canopy coverage (best visual quality)
 */
export type LeafSamplingMode = "sequential" | "random" | "spatial";

/**
 * Options for geometry generation.
 */
export type GeometryOptions = {
  /** Radial segments for branch tubes */
  radialSegments?: number;
  /** Generate end caps for branches */
  branchCaps?: boolean;
  /** Generate vertex colors for AO/variation */
  vertexColors?: boolean;
  /** UV scale for bark texture */
  uvScale?: number;
  /** Maximum leaves to render (for performance, default 50000) */
  maxLeaves?: number;
  /** Maximum depth level for branches (0=trunk only, 1=trunk+main branches, etc.) */
  maxBranchDepth?: number;
  /** Maximum total stems to render (prevents memory explosion for complex trees, default 2000) */
  maxStems?: number;
  /** Leaf sampling mode for LOD reduction (default: 'spatial') */
  leafSamplingMode?: LeafSamplingMode;
  /** Seed for random/spatial sampling (default: 0 = use generation seed) */
  leafSamplingSeed?: number;
  /** Leaf scale multiplier for LOD (larger leaves at lower LODs maintain coverage) */
  leafScaleMultiplier?: number;
};

/**
 * Pre-defined LOD level presets for tree geometry.
 * LOD0 = Full quality, LOD1 = Medium (~30% verts), LOD2 = Low (~10% verts)
 */
export const TREE_LOD_PRESETS = {
  /** Full quality - all detail */
  lod0: {
    radialSegments: 8,
    branchCaps: true,
    vertexColors: true,
    maxLeaves: 50000,
    maxBranchDepth: undefined, // Use tree params
    maxStems: 2000,
    leafSamplingMode: "spatial",
    leafScaleMultiplier: 1.0,
  } as GeometryOptions,

  /** Medium quality - reduced geometry (~30% verts) */
  lod1: {
    radialSegments: 5,
    branchCaps: false,
    vertexColors: true,
    maxLeaves: 15000,
    maxBranchDepth: 2,
    maxStems: 600,
    leafSamplingMode: "spatial",
    leafScaleMultiplier: 1.3, // Slightly larger leaves to compensate for fewer
  } as GeometryOptions,

  /** Low quality - minimal geometry (~10% verts) */
  lod2: {
    radialSegments: 4,
    branchCaps: false,
    vertexColors: false,
    maxLeaves: 5000,
    maxBranchDepth: 1,
    maxStems: 200,
    leafSamplingMode: "spatial",
    leafScaleMultiplier: 1.6, // Larger leaves for sparse coverage
  } as GeometryOptions,
} as const;

/**
 * Options for instanced tree rendering.
 */
export type InstancedTreeOptions = {
  /** Maximum number of instances */
  maxInstances: number;
  /** Enable distance-based LOD */
  enableLOD?: boolean;
  /** Enable wind animation */
  enableWind?: boolean;
  /** Enable dissolve effect */
  enableDissolve?: boolean;
  /** Dissolve start distance */
  fadeStart?: number;
  /** Dissolve end distance */
  fadeEnd?: number;
};
