/**
 * Supabase Storage Service
 * Handles file uploads to Supabase S3-compatible storage
 *
 * Storage Architecture (6 buckets):
 *
 * 1. image-generation (AI-generated images)
 *    - /reference-images/              → User-uploaded texture references
 *    - /concept-art/                   → AI-generated concept art
 *    - /sprites/                       → Generated sprite sheets
 *
 * 2. audio-generations (AI-generated audio)
 *    - /generated/                     → Voice, SFX, music files
 *
 * 3. content-generations (AI-generated text content)
 *    - /generated/                     → General content
 *    - /game/quests/                   → Quest definitions
 *    - /game/npcs/                     → NPC definitions
 *    - /game/dialogues/                → Dialogue trees
 *    - /game/items/                    → Item definitions
 *    - /game/areas/                    → World area definitions
 *
 * 4. meshy-models (3D models from Meshy API)
 *    - /{assetId}/model.glb            → Textured/rigged GLB from Meshy
 *    - /{assetId}/preview.glb          → Untextured preview model
 *
 * 5. vrm-conversion (VRM converted models)
 *    - /{assetId}/model.vrm            → VRM 1.0 converted models
 *
 * 6. concept-art-pipeline (legacy/metadata)
 *    - /forge/models/{assetId}/        → Thumbnails, metadata
 *
 * "Forge" assets are generated/uploaded in HyperForge and stored in Supabase.
 * "Game" assets live in the GitHub repo and are served by Cloudflare S3 CDN.
 *
 * Required environment variables:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY: Supabase API key
 *
 * Storage URL format: https://<project-id>.supabase.co/storage/v1/object/public/<bucket>/<path>
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Storage buckets for HyperForge assets (6 buckets)
const IMAGE_GENERATION_BUCKET = "image-generation"; // AI-generated images (concept art, sprites)
const AUDIO_GENERATIONS_BUCKET = "audio-generations"; // Audio files (voice, sfx, music)
const CONTENT_GENERATIONS_BUCKET = "content-generations"; // Text content (JSON, quests, dialogue, code)
const MESHY_MODELS_BUCKET = "meshy-models"; // Meshy GLB models (preview, textured, rigged)
const VRM_CONVERSION_BUCKET = "vrm-conversion"; // VRM converted models
const CONCEPT_ART_BUCKET = "concept-art-pipeline"; // Legacy: metadata, thumbnails, misc

// Folder structure within buckets
const FORGE_MODELS_FOLDER = "forge/models"; // Legacy: 3D assets in concept-art-pipeline
const REFERENCE_IMAGES_FOLDER = "reference-images"; // User-uploaded reference images
const CONCEPT_ART_FOLDER = "concept-art"; // AI-generated concept art

// Legacy bucket name for backwards compatibility
const BUCKET_NAME = CONCEPT_ART_BUCKET;

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 * Supports both old and new Supabase key formats:
 * - Old: SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 * - New: SUPABASE_PUBLISHABLE_KEY (sb_publishable_*), SUPABASE_SECRET_KEY (sb_secret_*)
 */
function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Support both old and new key naming conventions
  // Priority: secret key > service key > publishable key > anon key
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY || // New format: sb_secret_*
    process.env.SUPABASE_SERVICE_KEY || // Old format
    process.env.SUPABASE_PUBLISHABLE_KEY || // New format: sb_publishable_*
    process.env.SUPABASE_ANON_KEY || // Old format
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_PUBLISHABLE_KEY) environment variables.",
    );
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
    },
  });

  return supabaseClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(supabaseUrl && supabaseKey);
}

/**
 * Ensure all storage buckets exist
 * Buckets:
 * - image-generation: AI-generated images
 * - audio-generations: Audio files
 * - content-generations: Text content (JSON, quests, code)
 * - meshy-models: GLB models from Meshy
 * - vrm-conversion: VRM converted models
 * - concept-art-pipeline: Legacy/metadata
 */
async function ensureBucket(): Promise<void> {
  const supabase = getSupabaseClient();
  const buckets = [
    IMAGE_GENERATION_BUCKET,
    AUDIO_GENERATIONS_BUCKET,
    CONTENT_GENERATIONS_BUCKET,
    MESHY_MODELS_BUCKET,
    VRM_CONVERSION_BUCKET,
    CONCEPT_ART_BUCKET,
  ];

  for (const bucketName of buckets) {
    try {
      // Quick check to see if we can list the bucket
      const { error } = await supabase.storage
        .from(bucketName)
        .list("", { limit: 1 });

      if (error) {
        if (
          error.message.includes("not found") ||
          error.message.includes("does not exist")
        ) {
          // Bucket doesn't exist - it should be created via Supabase dashboard
          console.warn(
            `[Supabase Storage] Bucket '${bucketName}' not accessible. Please create it in Supabase dashboard.`,
          );
        } else {
          console.warn(
            `[Supabase Storage] Bucket '${bucketName}' access warning:`,
            error.message,
          );
        }
      }
    } catch (error) {
      console.warn(
        `[Supabase Storage] Bucket '${bucketName}' check failed:`,
        error,
      );
    }
  }
}

export interface UploadResult {
  success: boolean;
  url: string;
  path: string;
  error?: string;
}

/**
 * Upload a reference image to Supabase Storage (image-generation bucket)
 */
export async function uploadReferenceImage(
  file: File | Buffer,
  filename: string,
  contentType: string = "image/png",
): Promise<UploadResult> {
  try {
    await ensureBucket();

    // Generate unique path
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = filename.split(".").pop() || "png";
    const uniqueFilename = `${timestamp}_${randomId}.${extension}`;
    const storagePath = `${REFERENCE_IMAGES_FOLDER}/${uniqueFilename}`;

    // Convert File to ArrayBuffer if needed
    const fileData = file instanceof File ? await file.arrayBuffer() : file;
    const buffer =
      fileData instanceof ArrayBuffer ? Buffer.from(fileData) : fileData;

    // Upload to image-generation bucket
    const result = await uploadFileToBucket(
      IMAGE_GENERATION_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (result.success) {
      console.log(
        `[Supabase Storage] Uploaded reference image to image-generation: ${result.url}`,
      );
    }

    return result;
  } catch (error) {
    console.error("[Supabase Storage] Upload failed:", error);
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload concept art to Supabase Storage (image-generation bucket)
 */
export async function uploadConceptArt(
  buffer: Buffer,
  contentType: string = "image/png",
): Promise<UploadResult> {
  try {
    await ensureBucket();

    // Generate unique path
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = contentType.includes("png") ? "png" : "jpg";
    const uniqueFilename = `concept_${timestamp}_${randomId}.${extension}`;
    const storagePath = `${CONCEPT_ART_FOLDER}/${uniqueFilename}`;

    // Upload to image-generation bucket
    const result = await uploadFileToBucket(
      IMAGE_GENERATION_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (result.success) {
      console.log(
        `[Supabase Storage] Uploaded concept art to image-generation: ${result.url}`,
      );
    }

    return result;
  } catch (error) {
    console.error("[Supabase Storage] Concept art upload error:", error);
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload audio to Supabase Storage (audio-generations bucket)
 */
export async function uploadAudio(
  buffer: Buffer,
  filename: string,
  contentType: string = "audio/mpeg",
): Promise<UploadResult> {
  try {
    await ensureBucket();

    // Generate unique path
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = filename.split(".").pop() || "mp3";
    const uniqueFilename = `audio_${timestamp}_${randomId}.${extension}`;
    const storagePath = `generated/${uniqueFilename}`;

    // Upload to audio-generations bucket
    const result = await uploadFileToBucket(
      AUDIO_GENERATIONS_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (result.success) {
      console.log(
        `[Supabase Storage] Uploaded audio to audio-generations: ${result.url}`,
      );
    }

    return result;
  } catch (error) {
    console.error("[Supabase Storage] Audio upload error:", error);
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload content to Supabase Storage (content-generations bucket)
 * For text-based content: JSON, quests, dialogue, code, etc.
 */
export async function uploadContent(
  content: string | Buffer,
  filename: string,
  contentType: string = "application/json",
  folder: string = "generated",
): Promise<UploadResult> {
  try {
    await ensureBucket();

    // Generate unique path
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = filename.split(".").pop() || "json";
    const uniqueFilename = `content_${timestamp}_${randomId}.${extension}`;
    const storagePath = `${folder}/${uniqueFilename}`;

    // Convert string to buffer if needed
    const buffer =
      typeof content === "string" ? Buffer.from(content, "utf-8") : content;

    // Upload to content-generations bucket
    const result = await uploadFileToBucket(
      CONTENT_GENERATIONS_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (result.success) {
      console.log(
        `[Supabase Storage] Uploaded content to content-generations: ${result.url}`,
      );
    }

    return result;
  } catch (error) {
    console.error("[Supabase Storage] Content upload error:", error);
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload quest/dialogue/NPC data to content-generations bucket
 */
export async function uploadGameContent(
  data: Record<string, unknown>,
  type: "quest" | "npc" | "dialogue" | "item" | "area",
  id: string,
): Promise<UploadResult> {
  const content = JSON.stringify(data, null, 2);
  const filename = `${type}_${id}.json`;
  const folder = `game/${type}s`;

  return uploadContent(content, filename, "application/json", folder);
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(storagePath: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([storagePath]);

    if (error) {
      console.error("[Supabase Storage] Delete error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Supabase Storage] Delete failed:", error);
    return false;
  }
}

/**
 * List files in a folder
 */
export async function listFiles(folder: string): Promise<string[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder);

    if (error) {
      console.error("[Supabase Storage] List error:", error);
      return [];
    }

    return data?.map((f) => `${folder}/${f.name}`) || [];
  } catch (error) {
    console.error("[Supabase Storage] List failed:", error);
    return [];
  }
}

// ============================================================================
// FORGE ASSET STORAGE
// Full 3D asset storage (models, thumbnails, VRM, metadata) for HyperForge
// ============================================================================

export interface TextureFile {
  name: string;
  buffer: Buffer | ArrayBuffer;
}

export interface ForgeAssetFiles {
  modelUrl: string;
  modelPath: string;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  vrmUrl?: string;
  vrmPath?: string;
  previewUrl?: string;
  previewPath?: string;
  texturedModelUrl?: string;
  texturedModelPath?: string;
  textureUrls?: string[];
  texturePaths?: string[];
  metadataUrl?: string;
  metadataPath?: string;
}

export interface SaveForgeAssetOptions {
  assetId: string;
  modelBuffer: Buffer | ArrayBuffer;
  modelFormat?: "glb" | "vrm" | "gltf";
  thumbnailBuffer?: Buffer | ArrayBuffer;
  vrmBuffer?: Buffer | ArrayBuffer;
  previewBuffer?: Buffer | ArrayBuffer;
  /** Original textured model (before rigging, which may strip textures) */
  texturedModelBuffer?: Buffer | ArrayBuffer;
  /** Separate texture files (base_color, metallic, roughness, normal) */
  textureFiles?: TextureFile[];
  metadata?: Record<string, unknown>;
}

/**
 * Get the Supabase storage path for a forge asset
 */
function getForgeAssetPath(assetId: string, filename: string): string {
  return `${FORGE_MODELS_FOLDER}/${assetId}/${filename}`;
}

/**
 * Get public URL for a storage path
 */
function getPublicUrl(storagePath: string): string {
  const supabase = getSupabaseClient();
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Upload a single file to Supabase Storage
 * All forge assets are immutable once uploaded, so we use aggressive caching
 */
async function uploadFileToBucket(
  bucketName: string,
  storagePath: string,
  data: Buffer | ArrayBuffer,
  contentType: string,
  upsert: boolean = true,
  cacheControl: string = "31536000", // 1 year default for immutable assets
): Promise<UploadResult> {
  const supabase = getSupabaseClient();
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;

  const { data: uploadData, error } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType,
      upsert,
      cacheControl,
    });

  if (error) {
    return {
      success: false,
      url: "",
      path: "",
      error: error.message,
    };
  }

  // Get public URL for the specific bucket
  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(storagePath);

  return {
    success: true,
    url: urlData.publicUrl,
    path: uploadData.path,
  };
}

/**
 * Legacy wrapper for backwards compatibility
 */
async function uploadFile(
  storagePath: string,
  data: Buffer | ArrayBuffer,
  contentType: string,
  upsert: boolean = true,
  cacheControl: string = "31536000",
): Promise<UploadResult> {
  return uploadFileToBucket(
    BUCKET_NAME,
    storagePath,
    data,
    contentType,
    upsert,
    cacheControl,
  );
}

/**
 * Save a complete forge asset to Supabase Storage
 *
 * Storage architecture:
 * - meshy-models bucket: GLB models (textured + rigged from Meshy, preview untextured)
 * - vrm-conversion bucket: VRM converted models
 * - concept-art-pipeline bucket: thumbnails, metadata, concept art
 */
export async function saveForgeAsset(
  options: SaveForgeAssetOptions,
): Promise<ForgeAssetFiles> {
  const {
    assetId,
    modelBuffer,
    modelFormat = "glb",
    thumbnailBuffer,
    vrmBuffer,
    previewBuffer,
    texturedModelBuffer,
    textureFiles,
    metadata,
  } = options;

  await ensureBucket();

  const result: ForgeAssetFiles = {
    modelUrl: "",
    modelPath: "",
  };

  // Upload GLB model to meshy-models bucket (textured/rigged model from Meshy)
  // Use application/octet-stream for broader compatibility - Supabase sometimes rejects
  // model/gltf-binary even when configured to accept it
  const modelFilename = `${assetId}/model.${modelFormat}`;
  const modelContentType = "application/octet-stream";

  const modelUpload = await uploadFileToBucket(
    MESHY_MODELS_BUCKET,
    modelFilename,
    modelBuffer,
    modelContentType,
  );
  if (modelUpload.success) {
    result.modelUrl = modelUpload.url;
    result.modelPath = modelUpload.path;
    console.log(
      `[Forge Storage] Uploaded model to meshy-models: ${result.modelUrl}`,
    );
  } else {
    throw new Error(`Failed to upload model: ${modelUpload.error}`);
  }

  // Upload thumbnail to concept-art-pipeline bucket
  if (thumbnailBuffer) {
    const thumbnailPath = `${FORGE_MODELS_FOLDER}/${assetId}/thumbnail.png`;
    const thumbnailUpload = await uploadFileToBucket(
      CONCEPT_ART_BUCKET,
      thumbnailPath,
      thumbnailBuffer,
      "image/png",
    );
    if (thumbnailUpload.success) {
      result.thumbnailUrl = thumbnailUpload.url;
      result.thumbnailPath = thumbnailUpload.path;
      console.log(`[Forge Storage] Uploaded thumbnail: ${result.thumbnailUrl}`);
    }
  }

  // Upload VRM to vrm-conversion bucket
  // Use application/octet-stream for compatibility
  if (vrmBuffer) {
    const vrmPath = `${assetId}/model.vrm`;
    const vrmUpload = await uploadFileToBucket(
      VRM_CONVERSION_BUCKET,
      vrmPath,
      vrmBuffer,
      "application/octet-stream",
    );
    if (vrmUpload.success) {
      result.vrmUrl = vrmUpload.url;
      result.vrmPath = vrmUpload.path;
      console.log(
        `[Forge Storage] Uploaded VRM to vrm-conversion: ${result.vrmUrl}`,
      );
    }
  }

  // Upload preview model to meshy-models bucket (untextured, fast-loading version)
  if (previewBuffer) {
    const previewPath = `${assetId}/preview.glb`;
    const previewUpload = await uploadFileToBucket(
      MESHY_MODELS_BUCKET,
      previewPath,
      previewBuffer,
      "application/octet-stream",
    );
    if (previewUpload.success) {
      result.previewUrl = previewUpload.url;
      result.previewPath = previewUpload.path;
      console.log(
        `[Forge Storage] Uploaded preview to meshy-models: ${result.previewUrl}`,
      );
    }
  }

  // Upload textured model to meshy-models bucket (original before rigging, has textures)
  if (texturedModelBuffer) {
    const texturedPath = `${assetId}/textured.glb`;
    const texturedUpload = await uploadFileToBucket(
      MESHY_MODELS_BUCKET,
      texturedPath,
      texturedModelBuffer,
      "application/octet-stream",
    );
    if (texturedUpload.success) {
      result.texturedModelUrl = texturedUpload.url;
      result.texturedModelPath = texturedUpload.path;
      console.log(
        `[Forge Storage] Uploaded textured model to meshy-models: ${result.texturedModelUrl}`,
      );
    }
  }

  // Upload separate texture files to image-generation bucket (PBR textures)
  if (textureFiles && textureFiles.length > 0) {
    result.textureUrls = [];
    result.texturePaths = [];

    for (const texture of textureFiles) {
      const texturePath = `textures/${assetId}/${texture.name}`;
      const textureUpload = await uploadFileToBucket(
        IMAGE_GENERATION_BUCKET,
        texturePath,
        texture.buffer,
        "image/png",
      );
      if (textureUpload.success) {
        result.textureUrls.push(textureUpload.url);
        result.texturePaths.push(textureUpload.path);
      }
    }

    if (result.textureUrls.length > 0) {
      console.log(
        `[Forge Storage] Uploaded ${result.textureUrls.length} textures to image-generation`,
      );
    }
  }

  // Upload metadata to concept-art-pipeline bucket
  if (metadata) {
    const metadataWithTimestamp = {
      ...metadata,
      assetId,
      source: "FORGE",
      storageType: "supabase",
      buckets: {
        model: MESHY_MODELS_BUCKET,
        vrm: VRM_CONVERSION_BUCKET,
        assets: CONCEPT_ART_BUCKET,
      },
      savedAt: new Date().toISOString(),
    };
    const metadataPath = `${FORGE_MODELS_FOLDER}/${assetId}/metadata.json`;
    const metadataBuffer = Buffer.from(
      JSON.stringify(metadataWithTimestamp, null, 2),
    );
    const metadataUpload = await uploadFileToBucket(
      CONCEPT_ART_BUCKET,
      metadataPath,
      metadataBuffer,
      "application/json",
    );
    if (metadataUpload.success) {
      result.metadataUrl = metadataUpload.url;
      result.metadataPath = metadataUpload.path;
      console.log(`[Forge Storage] Uploaded metadata: ${result.metadataUrl}`);
    }
  }

  return result;
}

/**
 * Read a forge asset's metadata from Supabase Storage
 */
export async function readForgeAssetMetadata(
  assetId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const metadataUrl = getPublicUrl(
      getForgeAssetPath(assetId, "metadata.json"),
    );
    const response = await fetch(metadataUrl);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Check if a forge asset exists in Supabase Storage
 */
export async function forgeAssetExists(assetId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const assetFolder = `${FORGE_MODELS_FOLDER}/${assetId}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(assetFolder, { limit: 1 });

    if (error || !data || data.length === 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a forge asset and all its files from Supabase Storage
 */
export async function deleteForgeAsset(assetId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const assetFolder = `${FORGE_MODELS_FOLDER}/${assetId}`;

    // List all files in the asset folder
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(assetFolder);

    if (listError) {
      console.error("[Forge Storage] Error listing files:", listError);
      return false;
    }

    if (!files || files.length === 0) {
      return true; // Nothing to delete
    }

    // Delete all files
    const filePaths = files.map((f) => `${assetFolder}/${f.name}`);
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filePaths);

    if (deleteError) {
      console.error("[Forge Storage] Error deleting files:", deleteError);
      return false;
    }

    console.log(`[Forge Storage] Deleted asset: ${assetId}`);
    return true;
  } catch (error) {
    console.error("[Forge Storage] Delete failed:", error);
    return false;
  }
}

/**
 * List all forge asset IDs from Supabase Storage
 */
export async function listForgeAssetIds(): Promise<string[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(FORGE_MODELS_FOLDER);

    if (error) {
      console.error("[Forge Storage] List error:", error);
      return [];
    }

    // Filter to only directories (asset folders)
    // Supabase returns folders with id field set to null
    const assetFolders = data?.filter((item) => item.id === null) || [];
    return assetFolders.map((f) => f.name);
  } catch (error) {
    console.error("[Forge Storage] List failed:", error);
    return [];
  }
}

/**
 * Get full forge asset info with URLs
 */
export interface ForgeAsset {
  id: string;
  name: string;
  source: "FORGE";
  type: string;
  category: string;
  thumbnailUrl?: string;
  modelUrl: string;
  modelPath?: string;
  hasVRM?: boolean;
  vrmPath?: string;
  vrmUrl?: string;
  hasModel?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get a single forge asset with all its info
 */
export async function getForgeAsset(
  assetId: string,
): Promise<ForgeAsset | null> {
  try {
    const metadata = await readForgeAssetMetadata(assetId);
    if (!metadata) return null;

    const hasVRM = (metadata.hasVRM as boolean) || false;
    const baseUrl = getPublicUrl(FORGE_MODELS_FOLDER);

    return {
      id: assetId,
      name: (metadata.name as string) || assetId,
      source: "FORGE",
      type: (metadata.type as string) || "object",
      category: (metadata.category as string) || "misc",
      thumbnailUrl: `${baseUrl}/${assetId}/thumbnail.png`,
      modelUrl: `${baseUrl}/${assetId}/model.glb`,
      modelPath: `${FORGE_MODELS_FOLDER}/${assetId}/model.glb`,
      hasVRM,
      vrmPath: hasVRM
        ? `${FORGE_MODELS_FOLDER}/${assetId}/model.vrm`
        : undefined,
      vrmUrl: hasVRM ? `${baseUrl}/${assetId}/model.vrm` : undefined,
      hasModel: true,
      createdAt:
        (metadata.createdAt as string) ||
        (metadata.savedAt as string) ||
        new Date().toISOString(),
      metadata,
    };
  } catch {
    return null;
  }
}

/**
 * List all forge assets with full info
 */
export async function listForgeAssets(): Promise<ForgeAsset[]> {
  const assetIds = await listForgeAssetIds();

  const assets = await Promise.all(
    assetIds.map(async (id) => {
      const asset = await getForgeAsset(id);
      return asset;
    }),
  );

  // Filter out nulls and sort by creation date
  return assets
    .filter((a): a is ForgeAsset => a !== null)
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });
}
