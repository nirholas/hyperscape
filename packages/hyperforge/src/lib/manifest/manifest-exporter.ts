/**
 * Manifest Exporter
 * Exports generated assets to game manifest format
 *
 * Supports texture variants following RuneScape's pattern:
 * - Base model: shared mesh used across variants
 * - Variants: different textures on same base (e.g., Bronze, Steel, Mithril)
 */

import type { AssetCategory } from "@/types/categories";
import { validateAssetForExport } from "./schema-validators";
import { generateAssetId } from "../generation/category-schemas";
import type { Item } from "@/types/game/item-types";
import type { NPCDataInput } from "@/types/game/npc-types";
import type { ResourceManifest } from "@/lib/cdn/types";

/**
 * Texture variant manifest entry
 */
export interface ManifestVariant {
  id: string;
  name: string;
  tier?: number;
  materialId?: string;
  modelPath: string;
  thumbnailPath?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Asset with variant support
 */
export interface AssetWithVariants {
  id: string;
  name: string;
  baseModelPath: string; // Untextured base mesh
  texturedModelPath?: string; // Default textured model
  variants?: ManifestVariant[];
  // Standard asset fields
  [key: string]: unknown;
}

export interface ExportOptions {
  manifestPath?: string; // Path to manifest file (e.g., "items.json", "npcs.json")
  validate?: boolean; // Validate before export
  generateId?: boolean; // Auto-generate ID if missing
  includeVariants?: boolean; // Include texture variants in export
}

export interface ExportResult {
  success: boolean;
  manifestType: "items" | "npcs" | "resources";
  asset: Item | NPCDataInput | ResourceManifest | AssetWithVariants;
  errors: string[];
  warnings: string[];
}

/**
 * Prepare asset for manifest export
 */
export function prepareAssetForExport(
  category: AssetCategory,
  metadata: Record<string, unknown>,
  modelPath?: string,
  options: ExportOptions = {},
): ExportResult {
  const { validate = true, generateId = true } = options;

  // Determine manifest type
  const manifestTypeMap: Partial<
    Record<AssetCategory, "items" | "npcs" | "resources">
  > = {
    weapon: "items",
    armor: "items",
    tool: "items",
    item: "items",
    currency: "items",
    prop: "items",
    building: "items",
    emote: "items",
    audio: "items",
    npc: "npcs",
    mob: "npcs",
    character: "npcs",
    avatar: "npcs",
    resource: "resources",
    environment: "resources",
    biome: "resources",
    music: "items", // Music tracks stored with items
  };

  const manifestType = manifestTypeMap[category] || "items";

  // Ensure ID exists
  const assetData = { ...metadata };
  if (generateId && !assetData.id) {
    assetData.id = generateAssetId(
      (assetData.name as string) || "asset",
      category,
    );
  }

  // Add model path if provided
  if (modelPath) {
    assetData.modelPath = modelPath;
  }

  // Validate
  let validation: { valid: boolean; errors: string[]; warnings: string[] } = {
    valid: true,
    errors: [],
    warnings: [],
  };
  if (validate) {
    validation = validateAssetForExport(category, assetData);
  }

  return {
    success: validation.valid,
    manifestType,
    asset: assetData as unknown as Item | NPCDataInput | ResourceManifest,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

/**
 * Format asset path for game manifest
 * Converts local paths to asset:// protocol
 */
export function formatAssetPath(localPath: string, assetId: string): string {
  // If already using asset:// protocol, return as-is
  if (localPath.startsWith("asset://")) {
    return localPath;
  }

  // Extract filename from path
  const filename = localPath.split("/").pop() || `${assetId}.glb`;

  // Format as asset:// path
  // Example: asset://models/sword-bronze/sword-bronze.glb
  return `asset://models/${assetId}/${filename}`;
}

/**
 * Generate manifest entry
 */
export function generateManifestEntry(
  category: AssetCategory,
  metadata: Record<string, unknown>,
  modelPath?: string,
): Item | NPCDataInput | ResourceManifest {
  const prepared = prepareAssetForExport(category, metadata, modelPath);

  if (!prepared.success) {
    throw new Error(`Validation failed: ${prepared.errors.join(", ")}`);
  }

  // Format model path if provided
  if (modelPath && prepared.asset) {
    const formattedPath = formatAssetPath(
      modelPath,
      (prepared.asset as { id: string }).id,
    );
    (prepared.asset as { modelPath?: string }).modelPath = formattedPath;
  }

  return prepared.asset as Item | NPCDataInput | ResourceManifest;
}

/**
 * Format variant path for game manifest
 */
export function formatVariantPath(
  baseAssetId: string,
  variantId: string,
  filename: string = "model.glb",
): string {
  // Example: asset://models/sword/variants/bronze/model.glb
  return `asset://models/${baseAssetId}/variants/${variantId}/${filename}`;
}

/**
 * Create a manifest variant entry
 */
export function createManifestVariant(
  baseAssetId: string,
  variant: {
    id: string;
    name: string;
    materialPresetId?: string;
    tier?: number;
    modelPath?: string;
    thumbnailPath?: string;
    metadata?: Record<string, unknown>;
  },
): ManifestVariant {
  return {
    id: variant.id,
    name: variant.name,
    tier: variant.tier,
    materialId: variant.materialPresetId,
    modelPath:
      variant.modelPath ||
      formatVariantPath(baseAssetId, variant.id, "model.glb"),
    thumbnailPath:
      variant.thumbnailPath ||
      formatVariantPath(baseAssetId, variant.id, "thumbnail.png"),
    metadata: variant.metadata,
  };
}

/**
 * Generate manifest entry with variants
 */
export function generateManifestEntryWithVariants(
  category: AssetCategory,
  metadata: Record<string, unknown>,
  options: {
    baseModelPath?: string;
    texturedModelPath?: string;
    variants?: Array<{
      id: string;
      name: string;
      materialPresetId?: string;
      tier?: number;
      modelPath?: string;
      thumbnailPath?: string;
    }>;
  },
): AssetWithVariants {
  const assetId =
    (metadata.id as string) ||
    generateAssetId((metadata.name as string) || "asset", category);

  // Format paths
  const baseModelPath = options.baseModelPath
    ? formatAssetPath(options.baseModelPath, assetId)
    : `asset://models/${assetId}/base.glb`;

  const texturedModelPath = options.texturedModelPath
    ? formatAssetPath(options.texturedModelPath, assetId)
    : undefined;

  // Create variant entries
  const variants = options.variants?.map((v) =>
    createManifestVariant(assetId, v),
  );

  return {
    id: assetId,
    name: (metadata.name as string) || assetId,
    baseModelPath,
    texturedModelPath,
    variants,
    ...metadata,
  };
}

/**
 * Export asset with variants to manifest format
 * This is the main entry point for variant-aware export
 */
export function exportAssetWithVariants(
  category: AssetCategory,
  metadata: Record<string, unknown>,
  paths: {
    baseModelPath?: string;
    texturedModelPath?: string;
  },
  variants?: Array<{
    id: string;
    name: string;
    materialPresetId?: string;
    tier?: number;
    modelPath?: string;
    thumbnailPath?: string;
  }>,
): ExportResult {
  try {
    const asset = generateManifestEntryWithVariants(category, metadata, {
      baseModelPath: paths.baseModelPath,
      texturedModelPath: paths.texturedModelPath,
      variants,
    });

    // Determine manifest type
    const manifestTypeMap: Partial<
      Record<AssetCategory, "items" | "npcs" | "resources">
    > = {
      weapon: "items",
      armor: "items",
      tool: "items",
      item: "items",
      currency: "items",
      prop: "items",
      building: "items",
      emote: "items",
      audio: "items",
      npc: "npcs",
      mob: "npcs",
      character: "npcs",
      avatar: "npcs",
      resource: "resources",
      environment: "resources",
      biome: "resources",
      music: "items",
    };

    const warnings: string[] = [];

    // Add warning if no variants but category typically has them
    if (
      !variants?.length &&
      (category === "weapon" || category === "resource")
    ) {
      warnings.push(
        `No texture variants provided for ${category}. Consider adding material variants (e.g., Bronze, Steel, Mithril).`,
      );
    }

    return {
      success: true,
      manifestType: manifestTypeMap[category] || "items",
      asset,
      errors: [],
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      manifestType: "items",
      asset: {} as AssetWithVariants,
      errors: [error instanceof Error ? error.message : "Export failed"],
      warnings: [],
    };
  }
}
