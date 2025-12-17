/**
 * Asset Storage Service
 * Handles file operations for forge assets
 *
 * Storage Priority:
 * 1. Supabase Storage (recommended for production) - "FORGE" assets
 * 2. Local filesystem (fallback for development) - "LOCAL" assets
 *
 * Set SUPABASE_URL and SUPABASE_SECRET_KEY to enable Supabase storage.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  isSupabaseConfigured,
  saveForgeAsset,
  listForgeAssets,
  readForgeAssetMetadata,
  deleteForgeAsset,
  forgeAssetExists,
  type ForgeAsset,
  type ForgeAssetFiles,
} from "./supabase-storage";

// Base directory for local asset storage (fallback)
const ASSETS_BASE_DIR =
  process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");

// Re-export Supabase types
export type { ForgeAsset, ForgeAssetFiles };

export interface TextureFile {
  name: string;
  buffer: Buffer | ArrayBuffer;
}

export interface SaveAssetOptions {
  assetId: string;
  modelBuffer: Buffer | ArrayBuffer;
  modelFormat?: "glb" | "vrm" | "gltf";
  thumbnailBuffer?: Buffer | ArrayBuffer;
  metadata?: Record<string, unknown>;
  /** Optional VRM buffer to save alongside the primary model */
  vrmBuffer?: Buffer | ArrayBuffer;
  /** Optional preview buffer (untextured model for fast loading) */
  previewBuffer?: Buffer | ArrayBuffer;
  /** Optional textured model buffer (before rigging, if rigging strips textures) */
  texturedModelBuffer?: Buffer | ArrayBuffer;
  /** Optional separate texture files (base_color, metallic, roughness, normal) */
  textureFiles?: TextureFile[];
}

export interface AssetFiles {
  modelPath: string;
  thumbnailPath?: string;
  metadataPath?: string;
  modelUrl: string;
  thumbnailUrl?: string;
  /** VRM path if VRM was saved alongside the model */
  vrmPath?: string;
  vrmUrl?: string;
  /** Preview model path (untextured, fast-loading) */
  previewPath?: string;
  previewUrl?: string;
  /** Textured model path (before rigging, if rigging strips textures) */
  texturedModelPath?: string;
  texturedModelUrl?: string;
  /** Texture file paths */
  texturePaths?: string[];
  textureUrls?: string[];
}

/**
 * Get the directory path for an asset
 */
export function getAssetDir(assetId: string): string {
  return path.join(ASSETS_BASE_DIR, assetId);
}

/**
 * Get the model file path for an asset
 */
export function getModelPath(assetId: string, format: string = "glb"): string {
  return path.join(getAssetDir(assetId), `${assetId}.${format}`);
}

/**
 * Get the thumbnail path for an asset
 */
export function getThumbnailPath(assetId: string): string {
  return path.join(getAssetDir(assetId), "thumbnail.png");
}

/**
 * Get the metadata JSON path for an asset
 */
export function getMetadataPath(assetId: string): string {
  return path.join(getAssetDir(assetId), "metadata.json");
}

/**
 * Get the VRM file path for an asset (alongside GLB)
 */
export function getVRMPath(assetId: string): string {
  return path.join(getAssetDir(assetId), `${assetId}.vrm`);
}

/**
 * Get the preview model path (untextured, fast-loading version)
 */
export function getPreviewPath(assetId: string): string {
  return path.join(getAssetDir(assetId), `${assetId}_preview.glb`);
}

/**
 * Ensure the assets directory exists
 */
export async function ensureAssetsDir(): Promise<void> {
  await fs.mkdir(ASSETS_BASE_DIR, { recursive: true });
}

/**
 * Ensure an asset's directory exists
 */
export async function ensureAssetDir(assetId: string): Promise<string> {
  const dir = getAssetDir(assetId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Save an asset's files (model, thumbnail, metadata, textures, and optionally VRM)
 * Uses Supabase Storage when configured, falls back to local filesystem
 */
export async function saveAssetFiles(
  options: SaveAssetOptions,
): Promise<AssetFiles> {
  const {
    assetId,
    modelBuffer,
    modelFormat = "glb",
    thumbnailBuffer,
    metadata,
    vrmBuffer,
    previewBuffer,
    texturedModelBuffer,
    textureFiles,
  } = options;

  // Try Supabase Storage first (recommended)
  if (isSupabaseConfigured()) {
    console.log(`[Asset Storage] Using Supabase Storage for asset: ${assetId}`);

    try {
      // Convert texture files to Buffer format
      const convertedTextureFiles = textureFiles?.map((tf) => ({
        name: tf.name,
        buffer:
          tf.buffer instanceof ArrayBuffer ? Buffer.from(tf.buffer) : tf.buffer,
      }));

      const forgeResult = await saveForgeAsset({
        assetId,
        modelBuffer:
          modelBuffer instanceof ArrayBuffer
            ? Buffer.from(modelBuffer)
            : modelBuffer,
        modelFormat,
        thumbnailBuffer:
          thumbnailBuffer instanceof ArrayBuffer
            ? Buffer.from(thumbnailBuffer)
            : thumbnailBuffer,
        vrmBuffer:
          vrmBuffer instanceof ArrayBuffer ? Buffer.from(vrmBuffer) : vrmBuffer,
        previewBuffer:
          previewBuffer instanceof ArrayBuffer
            ? Buffer.from(previewBuffer)
            : previewBuffer,
        texturedModelBuffer:
          texturedModelBuffer instanceof ArrayBuffer
            ? Buffer.from(texturedModelBuffer)
            : texturedModelBuffer,
        textureFiles: convertedTextureFiles,
        metadata: {
          ...metadata,
          source: "FORGE",
          hasPreview: !!previewBuffer,
          hasTexturedModel: !!texturedModelBuffer,
          hasTextures: textureFiles && textureFiles.length > 0,
          textureCount: textureFiles?.length || 0,
        },
      });

      return {
        modelPath: forgeResult.modelPath,
        modelUrl: forgeResult.modelUrl,
        thumbnailPath: forgeResult.thumbnailPath,
        thumbnailUrl: forgeResult.thumbnailUrl,
        vrmPath: forgeResult.vrmPath,
        vrmUrl: forgeResult.vrmUrl,
        previewPath: forgeResult.previewPath,
        previewUrl: forgeResult.previewUrl,
        texturedModelPath: forgeResult.texturedModelPath,
        texturedModelUrl: forgeResult.texturedModelUrl,
        texturePaths: forgeResult.texturePaths,
        textureUrls: forgeResult.textureUrls,
        metadataPath: forgeResult.metadataPath,
      };
    } catch (error) {
      console.error(
        "[Asset Storage] Supabase save failed, falling back to local:",
        error,
      );
      // Fall through to local storage
    }
  }

  // Fallback: Local filesystem storage
  console.log(`[Asset Storage] Using local filesystem for asset: ${assetId}`);

  // Ensure directory exists
  await ensureAssetDir(assetId);

  // Save model file
  const modelPath = getModelPath(assetId, modelFormat);
  const buffer =
    modelBuffer instanceof ArrayBuffer ? Buffer.from(modelBuffer) : modelBuffer;
  await fs.writeFile(modelPath, buffer);

  const result: AssetFiles = {
    modelPath,
    modelUrl: `/api/assets/${assetId}/model.${modelFormat}`,
  };

  // Save thumbnail if provided
  if (thumbnailBuffer) {
    const thumbnailPath = getThumbnailPath(assetId);
    const thumbBuffer =
      thumbnailBuffer instanceof ArrayBuffer
        ? Buffer.from(thumbnailBuffer)
        : thumbnailBuffer;
    await fs.writeFile(thumbnailPath, thumbBuffer);
    result.thumbnailPath = thumbnailPath;
    result.thumbnailUrl = `/api/assets/${assetId}/thumbnail.png`;
  }

  // Save VRM if provided (alongside the GLB)
  if (vrmBuffer) {
    const vrmPath = getVRMPath(assetId);
    const vrmBuf =
      vrmBuffer instanceof ArrayBuffer ? Buffer.from(vrmBuffer) : vrmBuffer;
    await fs.writeFile(vrmPath, vrmBuf);
    result.vrmPath = vrmPath;
    result.vrmUrl = `/api/assets/${assetId}/model.vrm`;
  }

  // Save preview model if provided (untextured, fast-loading version)
  if (previewBuffer) {
    const previewPath = getPreviewPath(assetId);
    const previewBuf =
      previewBuffer instanceof ArrayBuffer
        ? Buffer.from(previewBuffer)
        : previewBuffer;
    await fs.writeFile(previewPath, previewBuf);
    result.previewPath = previewPath;
    result.previewUrl = `/api/assets/${assetId}/preview.glb`;
    console.log(`[Asset Storage] Saved preview model: ${previewPath}`);
  }

  // Save metadata if provided
  if (metadata) {
    const metadataPath = getMetadataPath(assetId);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    result.metadataPath = metadataPath;
  }

  return result;
}

/**
 * Read an asset's model file
 */
export async function readAssetModel(
  assetId: string,
  format: string = "glb",
): Promise<Buffer> {
  const modelPath = getModelPath(assetId, format);
  return fs.readFile(modelPath);
}

/**
 * Read an asset's thumbnail
 */
export async function readAssetThumbnail(assetId: string): Promise<Buffer> {
  const thumbnailPath = getThumbnailPath(assetId);
  return fs.readFile(thumbnailPath);
}

/**
 * Read an asset's metadata (Supabase or local filesystem)
 */
export async function readAssetMetadata(
  assetId: string,
): Promise<Record<string, unknown> | null> {
  // Try Supabase first
  if (isSupabaseConfigured()) {
    const supabaseMetadata = await readForgeAssetMetadata(assetId);
    if (supabaseMetadata) return supabaseMetadata;
  }

  // Fall back to local filesystem
  try {
    const metadataPath = getMetadataPath(assetId);
    const content = await fs.readFile(metadataPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if an asset exists (Supabase or local filesystem)
 */
export async function assetExists(assetId: string): Promise<boolean> {
  // Check Supabase first
  if (isSupabaseConfigured()) {
    const existsInSupabase = await forgeAssetExists(assetId);
    if (existsInSupabase) return true;
  }

  // Check local filesystem
  try {
    const dir = getAssetDir(assetId);
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file size of an asset's model
 */
export async function getAssetFileSize(
  assetId: string,
  format: string = "glb",
): Promise<number> {
  const modelPath = getModelPath(assetId, format);
  const stats = await fs.stat(modelPath);
  return stats.size;
}

/**
 * Delete an asset and all its files
 * Tries Supabase first, then local filesystem
 */
export async function deleteAssetFiles(assetId: string): Promise<void> {
  // Try to delete from Supabase
  if (isSupabaseConfigured()) {
    const supabaseDeleted = await deleteForgeAsset(assetId);
    if (supabaseDeleted) {
      console.log(`[Asset Storage] Deleted from Supabase: ${assetId}`);
    }
  }

  // Also try to delete from local filesystem (in case it exists there too)
  try {
    const dir = getAssetDir(assetId);
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`[Asset Storage] Deleted from local: ${assetId}`);
  } catch {
    // Ignore if doesn't exist locally
  }
}

/**
 * Copy an asset's files to a new asset ID
 */
export async function copyAssetFiles(
  sourceAssetId: string,
  targetAssetId: string,
): Promise<AssetFiles> {
  const sourceDir = getAssetDir(sourceAssetId);
  const targetDir = await ensureAssetDir(targetAssetId);

  // Read source directory
  const files = await fs.readdir(sourceDir);

  // Copy each file
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    // Replace source ID with target ID in filename
    const targetFile = file.replace(sourceAssetId, targetAssetId);
    const targetPath = path.join(targetDir, targetFile);
    await fs.copyFile(sourcePath, targetPath);
  }

  // Determine format from copied files
  const modelFile = files.find(
    (f) => f.endsWith(".glb") || f.endsWith(".vrm") || f.endsWith(".gltf"),
  );
  const format = modelFile?.split(".").pop() || "glb";

  return {
    modelPath: getModelPath(targetAssetId, format),
    modelUrl: `/api/assets/${targetAssetId}/model.${format}`,
    thumbnailPath: files.includes("thumbnail.png")
      ? getThumbnailPath(targetAssetId)
      : undefined,
    thumbnailUrl: files.includes("thumbnail.png")
      ? `/api/assets/${targetAssetId}/thumbnail.png`
      : undefined,
    metadataPath: files.includes("metadata.json")
      ? getMetadataPath(targetAssetId)
      : undefined,
  };
}

/**
 * Download a file from a URL and return as Buffer
 * @param url - URL to download from
 * @param timeoutMs - Timeout in milliseconds (default 60s for large models)
 */
export async function downloadFile(
  url: string,
  timeoutMs = 60000,
): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download a model from Meshy URL and save it
 */
export async function downloadAndSaveModel(
  assetId: string,
  modelUrl: string,
  thumbnailUrl?: string,
  metadata?: Record<string, unknown>,
): Promise<AssetFiles> {
  // Download model
  const modelBuffer = await downloadFile(modelUrl);

  // Determine format from URL
  const format = modelUrl.includes(".vrm") ? "vrm" : "glb";

  // Download thumbnail if provided
  let thumbnailBuffer: Buffer | undefined;
  if (thumbnailUrl) {
    try {
      thumbnailBuffer = await downloadFile(thumbnailUrl);
    } catch (error) {
      console.warn("Failed to download thumbnail:", error);
    }
  }

  // Save files
  return saveAssetFiles({
    assetId,
    modelBuffer,
    modelFormat: format,
    thumbnailBuffer,
    metadata,
  });
}

// Directories that are not 3D asset folders (used for other purposes)
const EXCLUDED_DIRECTORIES = [
  "audio", // Voice, SFX, and music files
  "sprites", // Sprite sheets
  "textures", // Shared textures
  "temp", // Temporary files
  "cache", // Cache files
  ".DS_Store", // macOS system files
];

/**
 * List all asset IDs in storage
 * Filters out special directories that are not 3D assets
 */
export async function listAssetIds(): Promise<string[]> {
  try {
    await ensureAssetsDir();
    const entries = await fs.readdir(ASSETS_BASE_DIR, { withFileTypes: true });

    // Filter to only include actual asset directories
    const assetDirs = entries.filter((entry) => {
      // Must be a directory
      if (!entry.isDirectory()) return false;

      // Exclude special/reserved directories
      if (EXCLUDED_DIRECTORIES.includes(entry.name)) return false;

      // Exclude hidden directories (starting with .)
      if (entry.name.startsWith(".")) return false;

      return true;
    });

    return assetDirs.map((entry) => entry.name);
  } catch {
    return [];
  }
}
