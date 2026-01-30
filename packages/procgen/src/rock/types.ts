/**
 * Type Definitions for Rock Generation
 *
 * All types used by the procedural rock generation algorithm.
 */

import type * as THREE from "three";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Base shape types for rock geometry
 */
export const BaseShape = {
  Icosahedron: "icosahedron",
  Sphere: "sphere",
  Box: "box",
  Dodecahedron: "dodecahedron",
  Octahedron: "octahedron",
} as const;

export type BaseShapeType = (typeof BaseShape)[keyof typeof BaseShape];

/**
 * Rock preset categories
 */
export const RockCategory = {
  Boulder: "boulder",
  Pebble: "pebble",
  Crystal: "crystal",
  Asteroid: "asteroid",
  Cliff: "cliff",
  LowPoly: "lowpoly",
} as const;

export type RockCategoryType = (typeof RockCategory)[keyof typeof RockCategory];

/**
 * Rock material/geology types
 */
export const RockType = {
  Sandstone: "sandstone",
  Limestone: "limestone",
  Granite: "granite",
  Marble: "marble",
  Basalt: "basalt",
  Slate: "slate",
  Obsidian: "obsidian",
  Quartzite: "quartzite",
} as const;

export type RockTypeType = (typeof RockType)[keyof typeof RockType];

// ============================================================================
// PARAMETERS
// ============================================================================

/**
 * RGB color as hex string (e.g., "#5a524a")
 */
export type HexColor = string;

/**
 * 3D scale vector
 */
export type Scale3D = {
  x: number;
  y: number;
  z: number;
};

/**
 * Noise displacement parameters
 */
export type NoiseParams = {
  /** Noise frequency scale */
  scale: number;
  /** Displacement amplitude (0-1) */
  amplitude: number;
  /** Number of octaves for FBM */
  octaves: number;
  /** Frequency multiplier between octaves */
  lacunarity: number;
  /** Amplitude multiplier between octaves */
  persistence: number;
};

/**
 * Edge cracking parameters
 */
export type CrackParams = {
  /** Crack indentation depth (0-0.5) */
  depth: number;
  /** Crack noise frequency */
  frequency: number;
};

/**
 * Smoothing parameters
 */
export type SmoothParams = {
  /** Number of Laplacian smoothing iterations */
  iterations: number;
  /** Smoothing blend strength (0-1) */
  strength: number;
};

/**
 * Vertex color parameters
 */
export type ColorParams = {
  /** Primary base color */
  baseColor: HexColor;
  /** Secondary color for height blending */
  secondaryColor: HexColor;
  /** Accent color for crevices/slopes */
  accentColor: HexColor;
  /** Random color variation amount (0-0.5) */
  variation: number;
  /** Height-based color blend factor (0-1) */
  heightBlend: number;
  /** Slope-based accent blend factor (0-1) */
  slopeBlend: number;
  /** Ambient occlusion intensity (0-1) */
  aoIntensity: number;
};

/**
 * Material parameters for PBR rendering
 */
export type MaterialParams = {
  /** Base roughness value (0-1) */
  roughness: number;
  /** Roughness variation amount (0-0.5) */
  roughnessVariation: number;
  /** Metalness value (0-1) */
  metalness: number;
};

/**
 * Color/texture mode
 */
export const ColorMode = {
  Vertex: "vertex",
  Texture: "texture",
  Blend: "blend",
} as const;

export type ColorModeType = (typeof ColorMode)[keyof typeof ColorMode];

/**
 * UV mapping method
 */
export const UVMethod = {
  Box: "box",
  Spherical: "spherical",
  Unwrap: "unwrap",
} as const;

export type UVMethodType = (typeof UVMethod)[keyof typeof UVMethod];

/**
 * Texture pattern type
 */
export const TexturePattern = {
  Noise: "noise",
  Layered: "layered",
  Speckled: "speckled",
  Veined: "veined",
  Cellular: "cellular",
  Flow: "flow",
} as const;

export type TexturePatternType =
  (typeof TexturePattern)[keyof typeof TexturePattern];

/**
 * Procedural texture parameters
 */
export type TextureParams = {
  /** Texture pattern type */
  pattern: TexturePatternType;
  /** Texture coordinate scale */
  scale: number;
  /** Pattern detail/octaves */
  detail: number;
  /** Contrast adjustment */
  contrast: number;
};

/**
 * Complete rock generation parameters
 */
export type RockParams = {
  /** Base geometry shape */
  baseShape: BaseShapeType;
  /** Subdivision level (1-7) */
  subdivisions: number;
  /** Non-uniform scale factors */
  scale: Scale3D;
  /** Main noise displacement settings */
  noise: NoiseParams;
  /** Edge cracking settings */
  cracks: CrackParams;
  /** Surface smoothing settings */
  smooth: SmoothParams;
  /** Vertex color settings */
  colors: ColorParams;
  /** Material/PBR settings */
  material: MaterialParams;
  /** Use flat shading (faceted look) */
  flatShading: boolean;
  /** Color/texture mode */
  colorMode: ColorModeType;
  /** Texture blend factor (for blend mode) */
  textureBlend: number;
  /** Procedural texture settings */
  texture: TextureParams;
  /** UV mapping method */
  uvMethod: UVMethodType;
};

/**
 * Partial rock parameters for presets/overrides
 */
export type PartialRockParams = {
  baseShape?: BaseShapeType;
  subdivisions?: number;
  scale?: Partial<Scale3D>;
  noise?: Partial<NoiseParams>;
  cracks?: Partial<CrackParams>;
  smooth?: Partial<SmoothParams>;
  colors?: Partial<ColorParams>;
  material?: Partial<MaterialParams>;
  flatShading?: boolean;
  colorMode?: ColorModeType;
  textureBlend?: number;
  texture?: Partial<TextureParams>;
  uvMethod?: UVMethodType;
};

// ============================================================================
// OUTPUT TYPES
// ============================================================================

/**
 * Statistics about the generated rock
 */
export type RockStats = {
  /** Total vertex count */
  vertices: number;
  /** Total triangle count */
  triangles: number;
  /** Unique vertex count (after merging) */
  uniqueVertices: number;
  /** Generation time in milliseconds */
  generationTime: number;
};

/**
 * Result of rock generation
 */
export type GeneratedRock = {
  /** The generated Three.js mesh */
  mesh: THREE.Mesh;
  /** The geometry (for baking) */
  geometry: THREE.BufferGeometry;
  /** Generation statistics */
  stats: RockStats;
  /** Parameters used for generation */
  params: RockParams;
  /** Seed used for generation */
  seed: string | number;
};

// ============================================================================
// GENERATION OPTIONS
// ============================================================================

/**
 * Options for rock generation
 */
export type RockGenerationOptions = {
  /** Random seed (string or number) */
  seed?: string | number;
  /** Override any rock parameters */
  params?: PartialRockParams;
};

// RNG interface is imported from consolidated math/Random.ts
export type { RNG } from "../math/Random.js";
