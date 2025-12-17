/**
 * Meshy API Constants & Configuration
 *
 * This file contains all API endpoints, presets, and best practices
 * for Meshy 3D generation in the HyperForge pipeline.
 *
 * @see https://www.meshy.ai/api - API Overview
 * @see https://docs.meshy.ai/en/api/image-to-3d - Image-to-3D API
 * @see https://docs.meshy.ai/api/text-to-3d - Text-to-3D API
 * @see https://docs.meshy.ai/en/api/quick-start - Quickstart & Authentication
 * @see https://docs.meshy.ai/en/api/changelog - API Changelog
 */

import type {
  AssetClass,
  PolycountPreset,
  MeshTopology,
  MeshyAIModel,
  MeshyGenerationConfig,
} from "./types";

// ============================================================================
// API Endpoints
// ============================================================================

/** Meshy API v1 base URL (Image-to-3D, Retexture, Rigging) */
export const MESHY_API_V1 = "https://api.meshy.ai/openapi/v1";

/** Meshy API v2 base URL (Text-to-3D with two-stage workflow) */
export const MESHY_API_V2 = "https://api.meshy.ai/openapi/v2";

/**
 * API Endpoints by feature
 */
export const MESHY_ENDPOINTS = {
  // v1 API endpoints
  imageTo3d: "/image-to-3d",
  retexture: "/retexture",
  rigging: "/rigging",

  // v2 API endpoints
  textTo3d: "/text-to-3d",
  tasks: "/tasks",
} as const;

// ============================================================================
// Documentation URLs
// ============================================================================

/**
 * Reference documentation URLs for the Meshy API
 */
export const MESHY_DOCS = {
  overview: "https://www.meshy.ai/api",
  imageTo3d: "https://docs.meshy.ai/en/api/image-to-3d",
  textTo3d: "https://docs.meshy.ai/api/text-to-3d",
  quickstart: "https://docs.meshy.ai/en/api/quick-start",
  changelog: "https://docs.meshy.ai/en/api/changelog",
  multiImage: "https://fal.ai/models/fal-ai/meshy/v5/multi-image-to-3d/api",
} as const;

// ============================================================================
// Polycount Presets for Web MMO Assets
// ============================================================================

/**
 * Polycount presets based on Three.js web MMO performance budgets
 *
 * These values are community-recommended ranges for different asset types.
 * Performance tip: Keep individual meshes < 100,000 triangles for web performance.
 */
export const POLYCOUNT_PRESETS: Record<AssetClass, PolycountPreset> = {
  small_prop: {
    assetClass: "small_prop",
    name: "Small Props",
    description:
      "Coins, potions, keys, small tools - frequently instanced items",
    minPolycount: 500,
    maxPolycount: 2000,
    defaultPolycount: 1000,
    recommendedTopology: "triangle",
    recommendPBR: false, // Save bandwidth for small items
  },

  medium_prop: {
    assetClass: "medium_prop",
    name: "Medium Props",
    description: "Weapons, shields, barrels, crates, furniture",
    minPolycount: 2000,
    maxPolycount: 5000,
    defaultPolycount: 3000,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },

  large_prop: {
    assetClass: "large_prop",
    name: "Large Props",
    description: "Vehicles, large furniture, decorative statues, trees",
    minPolycount: 5000,
    maxPolycount: 10000,
    defaultPolycount: 7500,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },

  npc_character: {
    assetClass: "npc_character",
    name: "NPC Characters",
    description: "Players, NPCs, monsters - uses normal maps for detail",
    minPolycount: 2000,
    maxPolycount: 10000,
    defaultPolycount: 5000,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },

  small_building: {
    assetClass: "small_building",
    name: "Small Buildings",
    description: "Houses, shops, small structures - consider LOD",
    minPolycount: 5000,
    maxPolycount: 15000,
    defaultPolycount: 10000,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },

  large_structure: {
    assetClass: "large_structure",
    name: "Large Structures",
    description: "Castles, temples, dungeons - break into components with LODs",
    minPolycount: 15000,
    maxPolycount: 50000,
    defaultPolycount: 30000,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },

  custom: {
    assetClass: "custom",
    name: "Custom",
    description: "User-specified polycount",
    minPolycount: 500,
    maxPolycount: 100000,
    defaultPolycount: 10000,
    recommendedTopology: "triangle",
    recommendPBR: true,
  },
} as const;

// ============================================================================
// Default Generation Config
// ============================================================================

/**
 * Default generation configuration
 * Optimized for Three.js web MMO performance
 */
export const DEFAULT_GENERATION_CONFIG: MeshyGenerationConfig = {
  assetClass: "medium_prop",
  targetPolycount: 3000,
  topology: "triangle", // GPU-ready for Three.js
  enablePBR: true,
  aiModel: "latest",
  textureResolution: 2048,
  shouldRemesh: true,
  shouldTexture: true,
};

/**
 * Default AI model version
 * "latest" maps to newest available (currently Meshy-6)
 */
export const DEFAULT_AI_MODEL: MeshyAIModel = "latest";

/**
 * Default topology for runtime assets
 * Triangle meshes are GPU-compatible and recommended for Three.js
 */
export const DEFAULT_TOPOLOGY: MeshTopology = "triangle";

/**
 * Default texture resolution
 */
export const DEFAULT_TEXTURE_RESOLUTION = 2048;

/**
 * Default character height in meters for rigging
 * Standard adult human height used for skeleton scaling
 */
export const DEFAULT_CHARACTER_HEIGHT = 1.7;

// ============================================================================
// Best Practices for Three.js Web MMO
// ============================================================================

/**
 * Performance recommendations for Three.js web MMO assets
 */
export const THREE_JS_BEST_PRACTICES = {
  /**
   * Maximum recommended triangles per individual mesh
   * Test on lowest target hardware for actual limits
   */
  maxTrianglesPerMesh: 100000,

  /**
   * LOD (Level of Detail) distance thresholds
   * Provide multiple LOD meshes for distant objects
   */
  lodDistances: {
    high: 0, // Full detail at close range
    medium: 50, // Medium detail at 50 units
    low: 150, // Low detail at 150 units
    billboard: 300, // Sprite/billboard at 300+ units
  },

  /**
   * Instancing recommendations
   * Frequently repeated objects should be instanced
   */
  instancedObjects: [
    "trees",
    "rocks",
    "barrels",
    "crates",
    "coins",
    "foliage",
    "grass",
  ],

  /**
   * Baking recommendations
   * Use normal/roughness/ao maps to reduce polycount
   */
  bakingRecommendations: {
    normalMaps: "Encode high-frequency detail in normal maps",
    aoMaps: "Bake ambient occlusion for better lighting",
    roughnessMaps: "Use roughness maps for material variation",
  },

  /**
   * Export format recommendations
   * Always export final GLB/GLTF with triangulated meshes
   */
  exportFormat: "glb",
  triangulateOnExport: true,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get polycount preset for an asset class
 */
export function getPolycountPreset(assetClass: AssetClass): PolycountPreset {
  return POLYCOUNT_PRESETS[assetClass];
}

/**
 * Get recommended polycount for an asset class
 */
export function getRecommendedPolycount(assetClass: AssetClass): number {
  return POLYCOUNT_PRESETS[assetClass].defaultPolycount;
}

/**
 * Create generation config from asset class preset
 */
export function createGenerationConfig(
  assetClass: AssetClass,
  overrides?: Partial<MeshyGenerationConfig>,
): MeshyGenerationConfig {
  const preset = POLYCOUNT_PRESETS[assetClass];

  return {
    assetClass,
    targetPolycount: preset.defaultPolycount,
    topology: preset.recommendedTopology,
    enablePBR: preset.recommendPBR,
    aiModel: DEFAULT_AI_MODEL,
    textureResolution: DEFAULT_TEXTURE_RESOLUTION,
    shouldRemesh: true,
    shouldTexture: true,
    ...overrides,
  };
}

/**
 * Validate polycount is within recommended range for asset class
 */
export function validatePolycount(
  assetClass: AssetClass,
  polycount: number,
): { valid: boolean; warning?: string } {
  const preset = POLYCOUNT_PRESETS[assetClass];

  if (polycount < preset.minPolycount) {
    return {
      valid: true,
      warning: `Polycount ${polycount} is below recommended minimum (${preset.minPolycount}) for ${preset.name}. Model may lack detail.`,
    };
  }

  if (polycount > preset.maxPolycount) {
    return {
      valid: true,
      warning: `Polycount ${polycount} exceeds recommended maximum (${preset.maxPolycount}) for ${preset.name}. Consider using LOD or optimization.`,
    };
  }

  if (polycount > THREE_JS_BEST_PRACTICES.maxTrianglesPerMesh) {
    return {
      valid: false,
      warning: `Polycount ${polycount} exceeds Three.js recommended maximum (${THREE_JS_BEST_PRACTICES.maxTrianglesPerMesh}). May cause performance issues.`,
    };
  }

  return { valid: true };
}
