/**
 * Octahedral Impostor Library - Type Definitions
 *
 * Core types for the octahedral impostor system.
 * Supports AAA-quality impostor rendering with:
 * - Per-pixel depth maps for parallax and depth-based blending
 * - PBR material channels (roughness, metallic, AO)
 * - Dynamic multi-light support
 */

import type * as THREE from "three";

/**
 * Octahedron mapping type
 * - HEMI (0): Hemisphere mapping - captures top half of sphere (good for ground-based objects)
 * - FULL (1): Full sphere mapping - captures all angles (good for objects viewed from any direction)
 */
export const OctahedronType = {
  HEMI: 0,
  FULL: 1,
} as const;

export type OctahedronTypeValue =
  (typeof OctahedronType)[keyof typeof OctahedronType];

/**
 * PBR baking mode - controls which channels are baked
 */
export const PBRBakeMode = {
  /** Basic: albedo only (fastest, smallest) */
  BASIC: 0,
  /** Standard: albedo + normals (enables dynamic lighting) */
  STANDARD: 1,
  /** Full: albedo + normals + depth (enables parallax, depth blending, shadows) */
  FULL: 2,
  /** Complete: all channels including roughness/metallic/AO */
  COMPLETE: 3,
} as const;

export type PBRBakeModeValue = (typeof PBRBakeMode)[keyof typeof PBRBakeMode];

/**
 * Configuration for impostor baking
 *
 * Grid Size Convention:
 * - gridSizeX/Y represents the number of points/cells per axis
 * - buildOctahedronMesh(gridSize) creates gridSize points per axis
 * - Atlas has gridSize x gridSize cells
 * - Shader divides by gridSize
 *
 * Example with gridSizeX=31 (default):
 * - buildOctahedronMesh(31) → 31x31 = 961 points
 * - Atlas has 31x31 cells
 * - Each cell occupies 1/31 of atlas width/height
 */
/**
 * Vertical packing ratio for atlas
 * Controls the ratio of vertical to horizontal cells:
 * - 0.25: 1/4 as many vertical cells (wide atlas)
 * - 0.5: 1/2 as many vertical cells
 * - 1: Square (same horizontal and vertical)
 * - 2: 2x as many vertical cells
 * - 4: 4x as many vertical cells (tall atlas)
 */
export type VerticalPackingRatio = 0.25 | 0.5 | 1 | 2 | 4;

export interface ImpostorBakeConfig {
  /** Atlas texture width in pixels */
  atlasWidth: number;
  /** Atlas texture height in pixels */
  atlasHeight: number;
  /** Number of points/cells per row (default: 31) - more = finer horizontal angle resolution */
  gridSizeX: number;
  /** Number of points/cells per column (default: 31) - more = finer vertical angle resolution */
  gridSizeY: number;
  /** Octahedron mapping type (HEMI or FULL) */
  octType: OctahedronTypeValue;
  /** Optional background color for atlas cells (default: transparent) */
  backgroundColor?: number;
  /** Optional background alpha (default: 0) */
  backgroundAlpha?: number;
  /** PBR baking mode (default: STANDARD for normal maps) */
  pbrMode?: PBRBakeModeValue;
  /** Near plane for depth baking (default: 0.001) */
  depthNear?: number;
  /** Far plane for depth baking (default: 10) */
  depthFar?: number;
  /** Vertical packing ratio (default: 1 = square).
   * 0.5 = half as many vertical views, 2 = twice as many vertical views.
   * Cells are stretched to fill the atlas. */
  verticalPacking?: VerticalPackingRatio;
}

/**
 * Result of impostor baking process
 * Contains all baked atlas textures and metadata for runtime rendering
 */
export interface ImpostorBakeResult {
  /** The baked atlas texture (color/albedo) - sRGB color space */
  atlasTexture: THREE.Texture;
  /** The render target containing the atlas */
  renderTarget: THREE.RenderTarget;
  /** Normal atlas texture for dynamic lighting (view-space normals) - linear color space */
  normalAtlasTexture?: THREE.Texture;
  /** The render target for normals */
  normalRenderTarget?: THREE.RenderTarget;
  /** Depth atlas texture for parallax/depth blending (linear depth 0-1) - linear color space */
  depthAtlasTexture?: THREE.Texture;
  /** The render target for depth */
  depthRenderTarget?: THREE.RenderTarget;
  /** PBR atlas texture containing packed material properties:
   * R = Roughness (0=smooth, 1=rough)
   * G = Metallic (0=dielectric, 1=metal)
   * B = Ambient Occlusion (0=occluded, 1=unoccluded)
   * A = Reserved (emission mask or subsurface)
   */
  pbrAtlasTexture?: THREE.Texture;
  /** The render target for PBR channels */
  pbrRenderTarget?: THREE.RenderTarget;
  /** Horizontal grid size (columns) used for baking */
  gridSizeX: number;
  /** Vertical grid size (rows) used for baking */
  gridSizeY: number;
  /** Octahedron type used */
  octType: OctahedronTypeValue;
  /** Bounding sphere of the source mesh */
  boundingSphere: THREE.Sphere;
  /** Bounding box of the source mesh (for aspect ratio) */
  boundingBox?: THREE.Box3;
  /** Octahedron mesh data used for baking (for raycasting alignment) */
  octMeshData?: OctahedronMeshData;
  /** Near plane used for depth baking */
  depthNear?: number;
  /** Far plane used for depth baking */
  depthFar?: number;
  /** PBR baking mode used */
  pbrMode?: PBRBakeModeValue;
}

/**
 * Octahedron mesh data containing both flat and spherical point mappings
 */
export interface OctahedronMeshData {
  /** Wireframe mesh for visualization */
  wireframeMesh: THREE.Mesh;
  /** Filled mesh with custom shader */
  filledMesh: THREE.Mesh;
  /** Flat plane point positions (UV space) */
  planePoints: number[];
  /** Octahedron-mapped point positions (3D directions) */
  octPoints: number[];
}

/**
 * Configuration for the impostor runtime material
 *
 * Grid Size Convention:
 * - gridSizeX/Y must match the values used during baking
 * - Shader uses gridSize to compute atlas UV coordinates
 * - flatToCoords divides by gridSize to get cell (col, row)
 * - atlasUV = (cellIndex + vUv) / gridSize
 */
export interface ImpostorMaterialConfig {
  /** The baked atlas texture (albedo) */
  atlasTexture: THREE.Texture;
  /** Normal atlas texture for dynamic lighting (optional) */
  normalAtlasTexture?: THREE.Texture;
  /** Depth atlas texture for parallax/depth blending (optional) */
  depthAtlasTexture?: THREE.Texture;
  /** PBR atlas texture with packed R=roughness, G=metallic, B=AO (optional) */
  pbrAtlasTexture?: THREE.Texture;
  /** Number of cells per row in atlas (must match baking config) */
  gridSizeX: number;
  /** Number of cells per column in atlas (must match baking config) */
  gridSizeY: number;
  /** Enable transparency (default: true) */
  transparent?: boolean;
  /** Enable depth testing (default: true) */
  depthTest?: boolean;
  /** Enable depth writing (default: true) */
  depthWrite?: boolean;
  /** Material side (default: DoubleSide) */
  side?: THREE.Side;
  /** Enable dynamic lighting with normals (default: true if normalAtlasTexture provided) */
  enableLighting?: boolean;
  /** Enable depth-based frame blending to reduce ghosting (default: true if depthAtlasTexture provided) */
  enableDepthBlending?: boolean;
  /** Enable specular highlights (default: true if enableLighting is true) */
  enableSpecular?: boolean;
  /** Near plane for depth reconstruction (must match baking) */
  depthNear?: number;
  /** Far plane for depth reconstruction (must match baking) */
  depthFar?: number;
  /** Object scale for depth reconstruction */
  objectScale?: number;
}

/**
 * Impostor instance for runtime rendering
 */
export interface ImpostorInstance {
  /** The impostor mesh */
  mesh: THREE.Mesh;
  /** The impostor material */
  material: THREE.ShaderMaterial;
  /** Update the impostor to face camera */
  update(camera: THREE.Camera): void;
  /** Dispose of the impostor resources */
  dispose(): void;
}

/**
 * View direction data for impostor sampling
 */
export interface ImpostorViewData {
  /** Face indices (a, b, c) in the octahedron grid */
  faceIndices: THREE.Vector3;
  /** Barycentric weights for interpolation */
  faceWeights: THREE.Vector3;
}

/**
 * Options for creating an OctahedralImpostor
 */
export interface OctahedralImpostorOptions {
  /** Source mesh or group to create impostor from */
  source: THREE.Mesh | THREE.Group | THREE.Object3D;
  /** Bake configuration */
  config: ImpostorBakeConfig;
  /** Optional: Pre-computed bounding sphere */
  boundingSphere?: THREE.Sphere;
}

/**
 * Debug visualization options
 */
export interface DebugVisualizationOptions {
  /** Show grid overlay on atlas */
  showAtlasGrid?: boolean;
  /** Show sample point numbers on atlas */
  showAtlasNumbers?: boolean;
  /** Show sample points on atlas */
  showAtlasSamples?: boolean;
  /** Show grid overlay on octahedron mesh */
  showOctahedronGrid?: boolean;
  /** Show sample point numbers on octahedron */
  showOctahedronNumbers?: boolean;
  /** Show sample points on octahedron */
  showOctahedronSamples?: boolean;
  /** Show the original source mesh */
  showSourceMesh?: boolean;
}

/**
 * Geometry buffer creation properties
 */
export interface GeometryBufferProps {
  vertices: number[] | Float32Array;
  indices?: number[] | Uint16Array | null;
  normals?: number[] | Float32Array | null;
  texcoord?: number[] | Float32Array | null;
  joints?: number[] | Float32Array | null;
  weights?: number[] | Float32Array | null;
  skinSize?: number;
}

// ============================================================================
// LIGHTING TYPES
// ============================================================================

/**
 * Directional light configuration for impostor rendering
 */
export interface ImpostorDirectionalLight {
  /** Normalized direction TO the light (world space) */
  direction: THREE.Vector3;
  /** Light color (linear RGB, 0-1) */
  color: THREE.Vector3;
  /** Light intensity multiplier */
  intensity: number;
}

/**
 * Point light configuration for impostor rendering
 */
export interface ImpostorPointLight {
  /** World position of the light */
  position: THREE.Vector3;
  /** Light color (linear RGB, 0-1) */
  color: THREE.Vector3;
  /** Light intensity */
  intensity: number;
  /** Attenuation distance (light reaches zero at this distance) */
  distance: number;
  /** Decay exponent (physically correct = 2) */
  decay: number;
}

/**
 * Complete lighting configuration for impostor rendering
 * Supports up to 4 directional lights and 4 point lights
 */
export interface ImpostorLightingConfig {
  /** Ambient light color (linear RGB) */
  ambientColor: THREE.Vector3;
  /** Ambient light intensity */
  ambientIntensity: number;
  /** Directional lights (up to 4) */
  directionalLights: ImpostorDirectionalLight[];
  /** Point lights (up to 4) */
  pointLights: ImpostorPointLight[];
  /** Environment map intensity for reflections (0 = disabled) */
  envMapIntensity?: number;
}

/**
 * Specular configuration for PBR-like rendering
 */
export interface ImpostorSpecularConfig {
  /** Base reflectivity for dielectrics (default: 0.04 for plastic/non-metals) */
  f0: number;
  /** Shininess exponent for Blinn-Phong (default: 32) */
  shininess: number;
  /** Specular intensity multiplier */
  intensity: number;
}
