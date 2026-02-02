/**
 * ProcgenPresetService
 *
 * Manages procedural generation presets - saving seeds + settings combinations
 * that users like, batch generation, and integration with LOD/impostor systems.
 */

import fs from "fs";
import path from "path";
import type {
  ProcgenPreset,
  ProcgenCategory,
  TreePreset,
  RockPreset,
  PlantPreset,
  BuildingPreset,
  TerrainPreset,
  ProcgenPresetManifest,
  GeneratedProcgenAsset,
} from "../../src/types/ProcgenPresets";

// Manifest file path
const MANIFEST_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "assets",
  "manifests",
  "procgen-presets.json",
);
const GENERATED_ASSETS_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "assets",
  "procgen",
);

// Default empty manifest
const DEFAULT_MANIFEST: ProcgenPresetManifest = {
  version: 1,
  presets: {
    trees: [],
    rocks: [],
    plants: [],
    buildings: [],
    terrain: [],
    roads: [],
  },
  generatedAssets: [],
};

// Map category names to their manifest keys
const CATEGORY_TO_KEY: Record<
  ProcgenCategory,
  keyof ProcgenPresetManifest["presets"]
> = {
  tree: "trees",
  rock: "rocks",
  plant: "plants",
  building: "buildings",
  terrain: "terrain",
  roads: "roads",
};

export class ProcgenPresetService {
  private manifest: ProcgenPresetManifest;
  private manifestPath: string;
  private assetsPath: string;

  constructor(manifestPath?: string, assetsPath?: string) {
    this.manifestPath = manifestPath ?? MANIFEST_PATH;
    this.assetsPath = assetsPath ?? GENERATED_ASSETS_PATH;
    this.manifest = this.loadManifest();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    // Ensure assets directory exists
    if (!fs.existsSync(this.assetsPath)) {
      fs.mkdirSync(this.assetsPath, { recursive: true });
    }
    // Ensure category subdirectories exist
    const categories: ProcgenCategory[] = [
      "tree",
      "rock",
      "plant",
      "building",
      "terrain",
      "roads",
    ];
    for (const category of categories) {
      const categoryPath = path.join(this.assetsPath, category);
      if (!fs.existsSync(categoryPath)) {
        fs.mkdirSync(categoryPath, { recursive: true });
      }
    }
  }

  private loadManifest(): ProcgenPresetManifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const content = fs.readFileSync(this.manifestPath, "utf-8");
        return JSON.parse(content) as ProcgenPresetManifest;
      }
    } catch (error) {
      console.error("[ProcgenPresetService] Failed to load manifest:", error);
    }
    return { ...DEFAULT_MANIFEST };
  }

  private saveManifest(): void {
    try {
      // Ensure parent directory exists
      const dir = path.dirname(this.manifestPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.manifestPath,
        JSON.stringify(this.manifest, null, 2),
      );
    } catch (error) {
      console.error("[ProcgenPresetService] Failed to save manifest:", error);
      throw error;
    }
  }

  // === Preset CRUD Operations ===

  /**
   * List all presets, optionally filtered by category
   */
  listPresets(category?: ProcgenCategory): ProcgenPreset[] {
    if (category) {
      const categoryKey = CATEGORY_TO_KEY[category];
      return this.manifest.presets[categoryKey] as ProcgenPreset[];
    }

    return [
      ...this.manifest.presets.trees,
      ...this.manifest.presets.rocks,
      ...this.manifest.presets.plants,
      ...this.manifest.presets.buildings,
      ...this.manifest.presets.terrain,
      ...this.manifest.presets.roads,
    ];
  }

  /**
   * Get a preset by ID
   */
  getPreset(id: string): ProcgenPreset | null {
    const all = this.listPresets();
    return all.find((p) => p.id === id) ?? null;
  }

  /**
   * Create a new preset
   */
  createPreset(
    preset: Omit<ProcgenPreset, "id" | "createdAt" | "updatedAt">,
  ): ProcgenPreset {
    const now = new Date().toISOString();
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const newPreset = {
      ...preset,
      id,
      createdAt: now,
      updatedAt: now,
    } as ProcgenPreset;

    // Add to appropriate category
    const categoryKey = CATEGORY_TO_KEY[preset.category];
    (this.manifest.presets[categoryKey] as ProcgenPreset[]).push(newPreset);

    this.saveManifest();
    return newPreset;
  }

  /**
   * Update an existing preset
   */
  updatePreset(
    id: string,
    updates: Partial<Omit<ProcgenPreset, "id" | "createdAt" | "category">>,
  ): ProcgenPreset | null {
    const preset = this.getPreset(id);
    if (!preset) return null;

    const categoryKey = CATEGORY_TO_KEY[preset.category];
    const presets = this.manifest.presets[categoryKey] as ProcgenPreset[];
    const index = presets.findIndex((p) => p.id === id);

    if (index === -1) return null;

    const updated = {
      ...presets[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    presets[index] = updated;
    this.saveManifest();
    return updated;
  }

  /**
   * Delete a preset
   */
  deletePreset(id: string): boolean {
    const preset = this.getPreset(id);
    if (!preset) return false;

    const categoryKey = CATEGORY_TO_KEY[preset.category];
    const presets = this.manifest.presets[categoryKey] as ProcgenPreset[];
    const index = presets.findIndex((p) => p.id === id);

    if (index === -1) return false;

    presets.splice(index, 1);
    this.saveManifest();
    return true;
  }

  /**
   * Duplicate a preset with a new name
   */
  duplicatePreset(id: string, newName: string): ProcgenPreset | null {
    const preset = this.getPreset(id);
    if (!preset) return null;

    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = preset;
    return this.createPreset({
      ...rest,
      name: newName,
    });
  }

  // === Generated Assets ===

  /**
   * List generated assets, optionally filtered by preset or category
   */
  listGeneratedAssets(options?: {
    presetId?: string;
    category?: ProcgenCategory;
  }): GeneratedProcgenAsset[] {
    let assets = this.manifest.generatedAssets;

    if (options?.presetId) {
      assets = assets.filter((a) => a.presetId === options.presetId);
    }
    if (options?.category) {
      assets = assets.filter((a) => a.category === options.category);
    }

    return assets;
  }

  /**
   * Record a generated asset
   */
  recordGeneratedAsset(
    asset: Omit<GeneratedProcgenAsset, "id" | "generatedAt">,
  ): GeneratedProcgenAsset {
    const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newAsset: GeneratedProcgenAsset = {
      ...asset,
      id,
      generatedAt: new Date().toISOString(),
    };

    this.manifest.generatedAssets.push(newAsset);
    this.saveManifest();
    return newAsset;
  }

  /**
   * Delete a generated asset record (and optionally its files)
   */
  deleteGeneratedAsset(id: string, deleteFiles = false): boolean {
    const index = this.manifest.generatedAssets.findIndex((a) => a.id === id);
    if (index === -1) return false;

    const asset = this.manifest.generatedAssets[index];

    if (deleteFiles) {
      // Delete associated files
      const filesToDelete = [
        asset.modelPath,
        asset.thumbnailPath,
        asset.lod?.lod0Path,
        asset.lod?.lod1Path,
        asset.lod?.lod2Path,
        asset.lod?.impostorPath,
      ].filter(Boolean);

      for (const filePath of filesToDelete) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.warn(
              `[ProcgenPresetService] Failed to delete file: ${filePath}`,
            );
          }
        }
      }
    }

    this.manifest.generatedAssets.splice(index, 1);
    this.saveManifest();
    return true;
  }

  // === Batch Generation ===

  /**
   * Generate batch seeds for a preset
   * Returns array of seeds to use for batch generation
   */
  generateBatchSeeds(baseSeed: number, count: number, step = 1000): number[] {
    const seeds: number[] = [];
    for (let i = 0; i < count; i++) {
      seeds.push(baseSeed + i * step);
    }
    return seeds;
  }

  /**
   * Get the output path for a generated asset
   */
  getAssetOutputPath(
    category: ProcgenCategory,
    presetName: string,
    seed: number,
    extension = "glb",
  ): string {
    const sanitizedName = presetName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const filename = `${sanitizedName}_${seed}.${extension}`;
    return path.join(this.assetsPath, category, filename);
  }

  /**
   * Get the thumbnail path for a generated asset
   */
  getThumbnailPath(
    category: ProcgenCategory,
    presetName: string,
    seed: number,
  ): string {
    const sanitizedName = presetName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const filename = `${sanitizedName}_${seed}_thumb.png`;
    return path.join(this.assetsPath, category, "thumbnails", filename);
  }

  // === Export ===

  /**
   * Export the full manifest
   */
  exportManifest(): ProcgenPresetManifest {
    return { ...this.manifest };
  }

  /**
   * Import a manifest (merges with existing)
   */
  importManifest(imported: Partial<ProcgenPresetManifest>, merge = true): void {
    if (!merge) {
      this.manifest = { ...DEFAULT_MANIFEST, ...imported };
    } else {
      // Merge presets
      if (imported.presets) {
        for (const category of [
          "trees",
          "rocks",
          "plants",
          "buildings",
          "terrain",
          "roads",
        ] as const) {
          const importedPresets = imported.presets[category] ?? [];
          const existingIds = new Set(
            this.manifest.presets[category].map((p) => p.id),
          );

          for (const preset of importedPresets) {
            if (!existingIds.has(preset.id)) {
              (this.manifest.presets[category] as ProcgenPreset[]).push(
                preset as ProcgenPreset,
              );
            }
          }
        }
      }

      // Merge generated assets
      if (imported.generatedAssets) {
        const existingIds = new Set(
          this.manifest.generatedAssets.map((a) => a.id),
        );
        for (const asset of imported.generatedAssets) {
          if (!existingIds.has(asset.id)) {
            this.manifest.generatedAssets.push(asset);
          }
        }
      }
    }

    this.saveManifest();
  }

  // === Quick Preset Creators ===

  /**
   * Create a tree preset from current settings
   */
  createTreePreset(
    name: string,
    basePreset: string,
    seed: number,
    showLeaves: boolean,
    description?: string,
  ): TreePreset {
    return this.createPreset({
      name,
      description,
      category: "tree",
      settings: {
        basePreset,
        seed,
        showLeaves,
      },
    }) as TreePreset;
  }

  /**
   * Create a rock preset from current settings
   */
  createRockPreset(
    name: string,
    shapePreset: string,
    seed: number,
    subdivisions: number,
    flatShading: boolean,
    rockTypePreset?: string,
    description?: string,
  ): RockPreset {
    return this.createPreset({
      name,
      description,
      category: "rock",
      settings: {
        shapePreset,
        rockTypePreset,
        seed,
        subdivisions,
        flatShading,
      },
    }) as RockPreset;
  }

  /**
   * Create a plant preset from current settings
   */
  createPlantPreset(
    name: string,
    basePreset: string,
    seed: number,
    description?: string,
  ): PlantPreset {
    return this.createPreset({
      name,
      description,
      category: "plant",
      settings: {
        basePreset,
        seed,
      },
    }) as PlantPreset;
  }

  /**
   * Create a building preset from current settings
   */
  createBuildingPreset(
    name: string,
    buildingType: string,
    seed: string,
    showRoof: boolean,
    description?: string,
  ): BuildingPreset {
    return this.createPreset({
      name,
      description,
      category: "building",
      settings: {
        buildingType,
        seed,
        showRoof,
      },
    }) as BuildingPreset;
  }
}

// Default instance
let defaultService: ProcgenPresetService | null = null;

export function getProcgenPresetService(): ProcgenPresetService {
  if (!defaultService) {
    defaultService = new ProcgenPresetService();
  }
  return defaultService;
}
