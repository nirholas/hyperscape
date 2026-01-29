/**
 * Procgen Asset Preset Types
 *
 * Types for saving and managing procedural generation presets.
 * These allow users to save their favorite seeds + settings combinations
 * and generate batches of assets with LOD/impostor support.
 */

// Generator categories
export type ProcgenCategory =
  | "tree"
  | "rock"
  | "plant"
  | "building"
  | "terrain"
  | "roads";

// Base preset interface
export interface BaseProcgenPreset {
  id: string;
  name: string;
  description?: string;
  category: ProcgenCategory;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  thumbnail?: string;
}

// Tree-specific preset
export interface TreePreset extends BaseProcgenPreset {
  category: "tree";
  settings: {
    basePreset: string; // e.g., "quakingAspen", "douglasFir"
    seed: number;
    showLeaves: boolean;
    // Optional overrides for tree params
    overrides?: {
      scale?: number;
      trunkGirth?: number;
      branchLength?: number;
      leafDensity?: number;
    };
  };
}

// Rock-specific preset
export interface RockPreset extends BaseProcgenPreset {
  category: "rock";
  settings: {
    shapePreset: string; // e.g., "boulder", "crystal"
    rockTypePreset?: string; // e.g., "granite", "sandstone"
    seed: number;
    subdivisions: number;
    flatShading: boolean;
    // Optional overrides
    overrides?: {
      scale?: number;
      roughness?: number;
      noiseScale?: number;
      noiseStrength?: number;
    };
  };
}

// Plant-specific preset
export interface PlantPreset extends BaseProcgenPreset {
  category: "plant";
  settings: {
    basePreset: string; // e.g., "monstera", "philodendron"
    seed: number;
    // Optional overrides
    overrides?: {
      scale?: number;
      leafCount?: number;
      leafSize?: number;
      stemLength?: number;
    };
  };
}

// Building-specific preset
export interface BuildingPreset extends BaseProcgenPreset {
  category: "building";
  settings: {
    buildingType: string; // e.g., "bank", "store", "inn", or "town" for town mode
    seed: string;
    showRoof: boolean;
    // Optional overrides
    overrides?: {
      floors?: number;
      width?: number;
      depth?: number;
      townSize?: string; // "hamlet" | "village" | "town" for town mode
    };
  };
}

// Terrain-specific preset
export interface TerrainPreset extends BaseProcgenPreset {
  category: "terrain";
  settings: {
    basePreset: string; // e.g., "small-island", "mountain-range"
    seed: number;
    // Terrain config overrides
    overrides?: {
      worldSize?: number;
      tileSize?: number;
      maxHeight?: number;
      waterThreshold?: number;
    };
  };
}

// Roads-specific preset (town road networks)
export interface RoadsPreset extends BaseProcgenPreset {
  category: "roads";
  settings: {
    townSize: "hamlet" | "village" | "town";
    seed: number;
  };
}

// Union type for all presets
export type ProcgenPreset =
  | TreePreset
  | RockPreset
  | PlantPreset
  | BuildingPreset
  | TerrainPreset
  | RoadsPreset;

// Batch generation request
export interface BatchGenerationRequest {
  presetId: string;
  count: number;
  seedOffset?: number; // Start seed offset for variation
  seedStep?: number; // Increment between variations
  includeLOD?: boolean;
  includeImpostor?: boolean;
  outputFormat?: "glb" | "gltf";
}

// Generated asset with metadata
export interface GeneratedProcgenAsset {
  id: string;
  presetId: string;
  presetName: string;
  category: ProcgenCategory;
  seed: number;
  generatedAt: string;
  // File paths
  modelPath?: string;
  thumbnailPath?: string;
  // LOD data
  lod?: {
    lod0Path?: string;
    lod1Path?: string;
    lod2Path?: string;
    impostorPath?: string;
  };
  // Stats
  stats?: {
    vertices: number;
    triangles: number;
    generationTime: number;
  };
}

// Batch generation result
export interface BatchGenerationResult {
  presetId: string;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  assets: GeneratedProcgenAsset[];
  errors?: Array<{ seed: number; error: string }>;
  totalTime: number;
}

// Preset library manifest
export interface ProcgenPresetManifest {
  version: number;
  presets: {
    trees: TreePreset[];
    rocks: RockPreset[];
    plants: PlantPreset[];
    buildings: BuildingPreset[];
    terrain: TerrainPreset[];
    roads: RoadsPreset[];
  };
  generatedAssets: GeneratedProcgenAsset[];
}

// LOD settings per category (matches LODBundle.ts)
export interface ProcgenLODSettings {
  lod1: { vertexPercent: number; distance: number } | null;
  lod2: { vertexPercent: number; distance: number } | null;
  impostor: {
    type: "billboard" | "octahedral";
    atlasSize: number;
    distance: number;
  } | null;
}

// Default LOD settings per category
export const DEFAULT_PROCGEN_LOD_SETTINGS: Record<
  ProcgenCategory,
  ProcgenLODSettings
> = {
  tree: {
    lod1: { vertexPercent: 30, distance: 80 },
    lod2: { vertexPercent: 10, distance: 150 },
    impostor: { type: "octahedral", atlasSize: 512, distance: 250 },
  },
  rock: {
    lod1: { vertexPercent: 40, distance: 60 },
    lod2: { vertexPercent: 15, distance: 120 },
    impostor: { type: "octahedral", atlasSize: 256, distance: 200 },
  },
  plant: {
    lod1: { vertexPercent: 35, distance: 40 },
    lod2: { vertexPercent: 12, distance: 80 },
    impostor: { type: "billboard", atlasSize: 256, distance: 120 },
  },
  building: {
    lod1: { vertexPercent: 25, distance: 100 },
    lod2: { vertexPercent: 8, distance: 200 },
    impostor: { type: "octahedral", atlasSize: 1024, distance: 400 },
  },
  terrain: {
    lod1: null, // Terrain uses tile-based LOD
    lod2: null,
    impostor: null,
  },
  roads: {
    lod1: null, // Roads are part of town generation
    lod2: null,
    impostor: null,
  },
};

// Export helper functions
export function createPresetId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAssetId(): string {
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
