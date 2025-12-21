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
import { logger } from "@/lib/utils";

const log = logger.child("SupabaseStorage");

// Storage buckets for HyperForge assets (7 buckets)
const IMAGE_GENERATION_BUCKET = "image-generation"; // AI-generated images (concept art, sprites)
const AUDIO_GENERATIONS_BUCKET = "audio-generations"; // Audio files (voice, sfx, music)
const CONTENT_GENERATIONS_BUCKET = "content-generations"; // Text content (JSON, quests, dialogue, code)
const MESHY_MODELS_BUCKET = "meshy-models"; // Meshy GLB models (preview, textured, rigged)
const VRM_CONVERSION_BUCKET = "vrm-conversion"; // VRM converted models
const CONCEPT_ART_BUCKET = "concept-art-pipeline"; // Legacy: metadata, thumbnails, misc
const BAKED_STRUCTURES_BUCKET = "baked structures"; // Baked buildings and towns

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
    BAKED_STRUCTURES_BUCKET,
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
          log.warn(
            `Bucket '${bucketName}' not accessible. Please create it in Supabase dashboard.`,
          );
        } else {
          log.warn(`Bucket '${bucketName}' access warning: ${error.message}`);
        }
      }
    } catch (error) {
      log.warn(`Bucket '${bucketName}' check failed`, { error });
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
    const randomId = Math.random().toString(36).substring(2, 6);
    const extension = filename.split(".").pop() || "png";
    const uniqueFilename = `ref-${timestamp.toString(36).slice(-4)}-${randomId}.${extension}`;
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
      log.info(`Uploaded reference image to image-generation: ${result.url}`);
    }

    return result;
  } catch (error) {
    log.error("Upload failed", { error });
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
    const randomId = Math.random().toString(36).substring(2, 6);
    const extension = contentType.includes("png") ? "png" : "jpg";
    const uniqueFilename = `concept-art-${timestamp.toString(36).slice(-4)}-${randomId}.${extension}`;
    const storagePath = `${CONCEPT_ART_FOLDER}/${uniqueFilename}`;

    // Upload to image-generation bucket
    const result = await uploadFileToBucket(
      IMAGE_GENERATION_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (result.success) {
      log.info(`Uploaded concept art to image-generation: ${result.url}`);
    }

    return result;
  } catch (error) {
    log.error("Concept art upload error", { error });
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Image types for proper organization
 */
export type ImageType = "concept-art" | "sprite" | "texture" | "reference";

/**
 * Options for structured image upload
 */
export interface UploadImageOptions {
  buffer: Buffer;
  /** Kebab-case filename without extension (e.g., "bronze-sword-front") */
  filename: string;
  /** Image type for folder organization */
  type: ImageType;
  /** Content type (default: image/png) */
  contentType?: string;
  /** Asset ID this image belongs to */
  assetId?: string;
  /** Additional metadata to store alongside the image */
  metadata?: {
    prompt?: string;
    style?: string;
    view?: string;
    [key: string]: unknown;
  };
}

/**
 * Upload image to Supabase Storage (image-generation bucket)
 * Organizes files by type: concept-art/, sprites/, textures/, reference-images/
 *
 * Storage structure:
 *   image-generation/
 *     ├── concept-art/{asset-id}/{view}.png
 *     ├── sprites/{asset-id}/{view}.png
 *     ├── textures/{asset-id}/{texture-type}.png
 *     └── reference-images/{filename}.png
 */
export async function uploadImage(
  options: UploadImageOptions,
): Promise<UploadResult> {
  try {
    await ensureBucket();

    const {
      buffer,
      filename,
      type,
      contentType = "image/png",
      assetId,
      metadata,
    } = options;

    const extension = contentType.includes("png") ? "png" : "jpg";
    const finalFilename = filename.endsWith(`.${extension}`)
      ? filename
      : `${filename}.${extension}`;

    // Build storage path with proper organization
    let storagePath: string;
    if (assetId) {
      storagePath = `${type}/${assetId}/${finalFilename}`;
    } else {
      storagePath = `${type}/${finalFilename}`;
    }

    // Upload image file
    const result = await uploadFileToBucket(
      IMAGE_GENERATION_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (!result.success) {
      return result;
    }

    // Upload metadata JSON alongside the image if provided
    if (metadata) {
      const metadataPath = storagePath.replace(/\.(png|jpg)$/, ".json");
      const metadataBuffer = Buffer.from(
        JSON.stringify(
          {
            ...metadata,
            type,
            assetId,
            filename: finalFilename,
            storagePath,
            url: result.url,
            uploadedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      await uploadFileToBucket(
        IMAGE_GENERATION_BUCKET,
        metadataPath,
        metadataBuffer,
        "application/json",
      );
    }

    log.info(`Uploaded ${type} image: ${storagePath}`, {
      url: result.url,
      assetId,
    });

    return result;
  } catch (error) {
    log.error("Image upload error", { error });
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload concept art with proper organization
 * Storage: image-generation/concept-art/{asset-id}/{view}.png
 */
export async function uploadConceptArtForAsset(
  buffer: Buffer,
  options: {
    assetId: string;
    view?: string;
    prompt?: string;
    style?: string;
    assetType?: string;
  },
): Promise<UploadResult> {
  const view = options.view || "isometric";
  const filename = `${options.assetId}-${view}`;

  return uploadImage({
    buffer,
    filename,
    type: "concept-art",
    assetId: options.assetId,
    metadata: {
      prompt: options.prompt,
      style: options.style,
      view,
      assetType: options.assetType,
    },
  });
}

/**
 * Upload sprite with proper organization
 * Storage: image-generation/sprites/{asset-id}/{view}.png
 */
export async function uploadSpriteForAsset(
  buffer: Buffer,
  options: {
    assetId: string;
    view?: string;
    style?: string;
    transparent?: boolean;
  },
): Promise<UploadResult> {
  const view = options.view || "front";
  const filename = `${options.assetId}-${view}`;

  return uploadImage({
    buffer,
    filename,
    type: "sprite",
    assetId: options.assetId,
    metadata: {
      view,
      style: options.style,
      transparent: options.transparent,
    },
  });
}

/**
 * Upload texture with proper organization
 * Storage: image-generation/textures/{asset-id}/{texture-type}.png
 */
export async function uploadTextureForAsset(
  buffer: Buffer,
  options: {
    assetId: string;
    textureType: string; // "base-color", "normal", "roughness", etc.
    seamless?: boolean;
    resolution?: string;
  },
): Promise<UploadResult> {
  const filename = `${options.assetId}-${options.textureType}`;

  return uploadImage({
    buffer,
    filename,
    type: "texture",
    assetId: options.assetId,
    metadata: {
      textureType: options.textureType,
      seamless: options.seamless,
      resolution: options.resolution,
    },
  });
}

/**
 * Audio types for proper organization
 */
export type AudioType = "voice" | "sfx" | "music";

/**
 * Options for structured audio upload
 */
export interface UploadAudioOptions {
  buffer: Buffer;
  /** Kebab-case filename without extension (e.g., "goblin-greeting") */
  filename: string;
  /** Audio type for folder organization */
  type: AudioType;
  /** Content type (default: audio/mpeg) */
  contentType?: string;
  /** Additional metadata to store alongside the audio */
  metadata?: {
    npcId?: string;
    dialogueNodeId?: string;
    category?: string;
    prompt?: string;
    duration?: number;
    [key: string]: unknown;
  };
}

/**
 * Upload audio to Supabase Storage (audio-generations bucket)
 * Organizes files by type: voice/, sfx/, music/
 *
 * Storage structure:
 *   audio-generations/
 *     ├── voice/{npc-id}/{filename}.mp3
 *     ├── sfx/{category}/{filename}.mp3
 *     └── music/{category}/{filename}.mp3
 */
export async function uploadAudio(
  bufferOrOptions: Buffer | UploadAudioOptions,
  filename?: string,
  contentType: string = "audio/mpeg",
): Promise<UploadResult> {
  try {
    await ensureBucket();

    // Support both old and new API
    let buffer: Buffer;
    let finalFilename: string;
    let audioType: AudioType = "sfx"; // Default for backwards compatibility
    let subfolder = "";
    let metadata: Record<string, unknown> | undefined;

    if (Buffer.isBuffer(bufferOrOptions)) {
      // Old API: uploadAudio(buffer, filename, contentType)
      buffer = bufferOrOptions;
      finalFilename = filename || `audio-${Date.now()}.mp3`;

      // Try to infer type from filename
      if (
        finalFilename.includes("voice") ||
        finalFilename.includes("dialogue")
      ) {
        audioType = "voice";
      } else if (
        finalFilename.includes("music") ||
        finalFilename.includes("ambient")
      ) {
        audioType = "music";
      }
    } else {
      // New API: uploadAudio(options)
      const options = bufferOrOptions;
      buffer = options.buffer;
      finalFilename = options.filename.endsWith(".mp3")
        ? options.filename
        : `${options.filename}.mp3`;
      audioType = options.type;
      contentType = options.contentType || "audio/mpeg";
      metadata = options.metadata;

      // Determine subfolder based on type and metadata
      if (audioType === "voice" && options.metadata?.npcId) {
        subfolder = options.metadata.npcId as string;
      } else if (
        (audioType === "sfx" || audioType === "music") &&
        options.metadata?.category
      ) {
        subfolder = options.metadata.category as string;
      }
    }

    // Build storage path with proper organization
    // Pattern: {type}/{subfolder?}/{filename}.mp3
    const storagePath = subfolder
      ? `${audioType}/${subfolder}/${finalFilename}`
      : `${audioType}/${finalFilename}`;

    // Upload audio file
    const result = await uploadFileToBucket(
      AUDIO_GENERATIONS_BUCKET,
      storagePath,
      buffer,
      contentType,
    );

    if (!result.success) {
      return result;
    }

    // Upload metadata JSON alongside the audio if provided
    if (metadata) {
      const metadataPath = storagePath.replace(/\.mp3$/, ".json");
      const metadataBuffer = Buffer.from(
        JSON.stringify(
          {
            ...metadata,
            type: audioType,
            filename: finalFilename,
            storagePath,
            url: result.url,
            uploadedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      await uploadFileToBucket(
        AUDIO_GENERATIONS_BUCKET,
        metadataPath,
        metadataBuffer,
        "application/json",
      );
    }

    log.info(`Uploaded ${audioType} audio: ${storagePath}`, {
      url: result.url,
    });

    return result;
  } catch (error) {
    log.error("Audio upload error", { error });
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload voice audio with proper organization
 * Storage: audio-generations/voice/{npc-id}/{dialogue-id}.mp3
 */
export async function uploadVoiceAudio(
  buffer: Buffer,
  options: {
    npcId?: string;
    dialogueNodeId?: string;
    text?: string;
    voiceId?: string;
    voicePreset?: string;
    duration?: number;
  },
): Promise<UploadResult> {
  const filename = options.dialogueNodeId
    ? `${options.npcId || "unknown"}-${options.dialogueNodeId}`
    : `${options.npcId || "voice"}-${Date.now().toString(36).slice(-4)}`;

  return uploadAudio({
    buffer,
    filename,
    type: "voice",
    metadata: {
      npcId: options.npcId,
      dialogueNodeId: options.dialogueNodeId,
      text: options.text,
      voiceId: options.voiceId,
      voicePreset: options.voicePreset,
      duration: options.duration,
    },
  });
}

/**
 * Upload SFX audio with proper organization
 * Storage: audio-generations/sfx/{category}/{description}-{variant}.mp3
 */
export async function uploadSFXAudio(
  buffer: Buffer,
  options: {
    name: string;
    category?: string;
    prompt?: string;
    duration?: number;
    tags?: string[];
  },
): Promise<UploadResult> {
  // Convert name to kebab-case with variant number
  const safeName = options.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const timestamp = Date.now().toString(36).slice(-4);
  const filename = `${safeName}-${timestamp}`;

  return uploadAudio({
    buffer,
    filename,
    type: "sfx",
    metadata: {
      category: options.category || "custom",
      prompt: options.prompt,
      duration: options.duration,
      tags: options.tags,
    },
  });
}

/**
 * Upload music audio with proper organization
 * Storage: audio-generations/music/{category}/{name}.mp3
 */
export async function uploadMusicAudio(
  buffer: Buffer,
  options: {
    name: string;
    category?: string;
    prompt?: string;
    duration?: number;
    loopable?: boolean;
    zones?: string[];
    mood?: string;
    genre?: string;
  },
): Promise<UploadResult> {
  // Convert name to kebab-case
  const safeName = options.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const timestamp = Date.now().toString(36).slice(-4);
  const filename = `${safeName}-${timestamp}`;

  return uploadAudio({
    buffer,
    filename,
    type: "music",
    metadata: {
      category: options.category || "ambient",
      prompt: options.prompt,
      duration: options.duration,
      loopable: options.loopable,
      zones: options.zones,
      mood: options.mood,
      genre: options.genre,
    },
  });
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
    const randomId = Math.random().toString(36).substring(2, 6);
    const extension = filename.split(".").pop() || "json";
    const uniqueFilename = `content-${timestamp.toString(36).slice(-4)}-${randomId}.${extension}`;
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
      log.info(`Uploaded content to content-generations: ${result.url}`);
    }

    return result;
  } catch (error) {
    log.error("Content upload error", { error });
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
  const filename = `${type}-${id}.json`;
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
      log.error("Delete error", { error });
      return false;
    }

    return true;
  } catch (error) {
    log.error("Delete failed", { error });
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
      log.error("List error", { error });
      return [];
    }

    return data?.map((f) => `${folder}/${f.name}`) || [];
  } catch (error) {
    log.error("List failed", { error });
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
 * @deprecated Use uploadFileToBucket directly
 */
async function _uploadFile(
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
    log.info(`Uploaded model to meshy-models: ${result.modelUrl}`);
  } else {
    throw new Error(`Failed to upload model: ${modelUpload.error}`);
  }

  // Upload thumbnail to concept-art-pipeline bucket
  if (thumbnailBuffer) {
    const thumbnailPath = `${FORGE_MODELS_FOLDER}/${assetId}/concept-art.png`;
    const thumbnailUpload = await uploadFileToBucket(
      CONCEPT_ART_BUCKET,
      thumbnailPath,
      thumbnailBuffer,
      "image/png",
    );
    if (thumbnailUpload.success) {
      result.thumbnailUrl = thumbnailUpload.url;
      result.thumbnailPath = thumbnailUpload.path;
      log.info(`Uploaded thumbnail: ${result.thumbnailUrl}`);
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
      log.info(`Uploaded VRM to vrm-conversion: ${result.vrmUrl}`);
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
      log.info(`Uploaded preview to meshy-models: ${result.previewUrl}`);
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
      log.info(
        `Uploaded textured model to meshy-models: ${result.texturedModelUrl}`,
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
      log.info(
        `Uploaded ${result.textureUrls.length} textures to image-generation`,
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
      log.info(`Uploaded metadata: ${result.metadataUrl}`);
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
      log.error("Error listing files", { error: listError });
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
      log.error("Error deleting files", { error: deleteError });
      return false;
    }

    log.info(`Deleted asset: ${assetId}`);
    return true;
  } catch (error) {
    log.error("Delete failed", { error });
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
      log.error("List error", { error });
      return [];
    }

    // Filter to only directories (asset folders)
    // Supabase returns folders with id field set to null
    const assetFolders = data?.filter((item) => item.id === null) || [];
    return assetFolders.map((f) => f.name);
  } catch (error) {
    log.error("List failed", { error });
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
  previewUrl?: string;
  hasModel?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get public URL for a specific bucket
 */
function getBucketPublicUrl(bucketName: string, storagePath: string): string {
  const supabase = getSupabaseClient();
  const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Get a single forge asset with all its info
 *
 * Storage locations:
 * - Models: meshy-models/{assetId}/model.glb
 * - Concept Art: concept-art-pipeline/forge/models/{assetId}/concept-art.png
 * - VRM: vrm-conversion/{assetId}/model.vrm
 * - Preview: meshy-models/{assetId}/preview.glb
 */
export async function getForgeAsset(
  assetId: string,
): Promise<ForgeAsset | null> {
  try {
    const metadata = await readForgeAssetMetadata(assetId);
    if (!metadata) return null;

    const hasVRM = (metadata.hasVRM as boolean) || false;

    // Build correct URLs for each bucket
    // Models are in meshy-models bucket
    const modelUrl = getBucketPublicUrl(
      MESHY_MODELS_BUCKET,
      `${assetId}/model.glb`,
    );

    // Thumbnails are in concept-art-pipeline bucket under forge/models folder
    const thumbnailUrl = getBucketPublicUrl(
      CONCEPT_ART_BUCKET,
      `${FORGE_MODELS_FOLDER}/${assetId}/concept-art.png`,
    );

    // VRM is in vrm-conversion bucket
    const vrmUrl = hasVRM
      ? getBucketPublicUrl(VRM_CONVERSION_BUCKET, `${assetId}/model.vrm`)
      : undefined;

    // Preview is in meshy-models bucket
    const previewUrl = getBucketPublicUrl(
      MESHY_MODELS_BUCKET,
      `${assetId}/preview.glb`,
    );

    return {
      id: assetId,
      name: (metadata.name as string) || assetId,
      source: "FORGE",
      type: (metadata.type as string) || "object",
      category: (metadata.category as string) || "misc",
      thumbnailUrl,
      modelUrl,
      modelPath: `${assetId}/model.glb`,
      hasVRM,
      vrmPath: hasVRM ? `${assetId}/model.vrm` : undefined,
      vrmUrl,
      previewUrl,
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

// ============================================================================
// BUCKET-SPECIFIC LISTING FUNCTIONS
// Each bucket serves a specific purpose in the asset pipeline
// ============================================================================

export interface ImageAsset {
  id: string;
  filename: string;
  url: string;
  folder: string;
  type: "concept-art" | "sprite" | "reference-image" | "texture";
  createdAt?: string;
  size?: number;
}

export interface AudioAsset {
  id: string;
  filename: string;
  url: string;
  folder: string;
  type: "voice" | "sfx" | "music";
  /** Category/subfolder (e.g., "combat" for sfx, "ambient" for music, "goblin" for voice) */
  category?: string;
  createdAt?: string;
  size?: number;
}

export interface ContentAsset {
  id: string;
  filename: string;
  url: string;
  folder: string;
  type: "quest" | "npc" | "dialogue" | "item" | "area" | "general";
  createdAt?: string;
  size?: number;
}

/**
 * List images from image-generation bucket
 * Folders: /concept-art/, /sprites/, /reference-images/, /textures/
 */
export async function listImageAssets(): Promise<ImageAsset[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabaseClient();
  const assets: ImageAsset[] = [];

  const folders = [
    { path: CONCEPT_ART_FOLDER, type: "concept-art" as const },
    { path: "sprites", type: "sprite" as const },
    { path: REFERENCE_IMAGES_FOLDER, type: "reference-image" as const },
    { path: "textures", type: "texture" as const },
  ];

  for (const folder of folders) {
    try {
      const { data, error } = await supabase.storage
        .from(IMAGE_GENERATION_BUCKET)
        .list(folder.path, { limit: 100 });

      if (error) {
        log.warn(`Failed to list ${folder.path}: ${error.message}`);
        continue;
      }

      for (const file of data || []) {
        if (file.id === null) continue; // Skip folders

        const storagePath = `${folder.path}/${file.name}`;
        const url = getBucketPublicUrl(IMAGE_GENERATION_BUCKET, storagePath);

        assets.push({
          id: file.name.replace(/\.[^.]+$/, ""),
          filename: file.name,
          url,
          folder: folder.path,
          type: folder.type,
          createdAt: file.created_at,
          size: file.metadata?.size as number | undefined,
        });
      }
    } catch (error) {
      log.warn(`Error listing ${folder.path}`, { error });
    }
  }

  return assets.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * List audio from audio-generations bucket
 * Organized structure: /voice/, /sfx/, /music/
 * Also supports legacy /generated/ folder for backwards compatibility
 */
export async function listAudioAssets(): Promise<AudioAsset[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabaseClient();
  const assets: AudioAsset[] = [];

  // Audio type folders with their type mapping
  const audioFolders: Array<{ path: string; type: AudioAsset["type"] }> = [
    { path: "voice", type: "voice" },
    { path: "sfx", type: "sfx" },
    { path: "music", type: "music" },
    { path: "generated", type: "sfx" }, // Legacy folder - guess type from filename
  ];

  for (const folder of audioFolders) {
    try {
      // List root folder contents (may include subfolders)
      const { data: rootData, error: rootError } = await supabase.storage
        .from(AUDIO_GENERATIONS_BUCKET)
        .list(folder.path, { limit: 100 });

      if (rootError) {
        log.debug(`Folder ${folder.path} not accessible: ${rootError.message}`);
        continue;
      }

      // Process files and subfolders
      for (const item of rootData || []) {
        if (item.id === null) {
          // This is a subfolder (category/npc folder) - list its contents
          const subfolderPath = `${folder.path}/${item.name}`;
          const { data: subData, error: subError } = await supabase.storage
            .from(AUDIO_GENERATIONS_BUCKET)
            .list(subfolderPath, { limit: 100 });

          if (subError) continue;

          for (const file of subData || []) {
            if (file.id === null || !file.name.endsWith(".mp3")) continue;

            const storagePath = `${subfolderPath}/${file.name}`;
            const url = getBucketPublicUrl(
              AUDIO_GENERATIONS_BUCKET,
              storagePath,
            );

            assets.push({
              id: file.name.replace(/\.[^.]+$/, ""),
              filename: file.name,
              url,
              folder: subfolderPath,
              type: folder.type,
              category: item.name, // Subfolder name is the category/npcId
              createdAt: file.created_at,
              size: file.metadata?.size as number | undefined,
            });
          }
        } else if (item.name.endsWith(".mp3")) {
          // This is a file in the root audio type folder
          const storagePath = `${folder.path}/${item.name}`;
          const url = getBucketPublicUrl(AUDIO_GENERATIONS_BUCKET, storagePath);

          // For legacy "generated" folder, try to infer type from filename
          let audioType = folder.type;
          if (folder.path === "generated") {
            if (item.name.includes("voice") || item.name.includes("speech")) {
              audioType = "voice";
            } else if (
              item.name.includes("music") ||
              item.name.includes("theme")
            ) {
              audioType = "music";
            }
          }

          assets.push({
            id: item.name.replace(/\.[^.]+$/, ""),
            filename: item.name,
            url,
            folder: folder.path,
            type: audioType,
            createdAt: item.created_at,
            size: item.metadata?.size as number | undefined,
          });
        }
      }
    } catch (error) {
      log.warn(`Error listing ${folder.path}`, { error });
    }
  }

  return assets.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * List content from content-generations bucket
 * Folders: /generated/, /game/quests/, /game/npcs/, /game/dialogues/, /game/items/, /game/areas/
 */
export async function listContentAssets(): Promise<ContentAsset[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabaseClient();
  const assets: ContentAsset[] = [];

  const folders = [
    { path: "generated", type: "general" as const },
    { path: "game/quests", type: "quest" as const },
    { path: "game/npcs", type: "npc" as const },
    { path: "game/dialogues", type: "dialogue" as const },
    { path: "game/items", type: "item" as const },
    { path: "game/areas", type: "area" as const },
  ];

  for (const folder of folders) {
    try {
      const { data, error } = await supabase.storage
        .from(CONTENT_GENERATIONS_BUCKET)
        .list(folder.path, { limit: 100 });

      if (error) {
        // Folder might not exist yet
        continue;
      }

      for (const file of data || []) {
        if (file.id === null) continue; // Skip folders

        const storagePath = `${folder.path}/${file.name}`;
        const url = getBucketPublicUrl(CONTENT_GENERATIONS_BUCKET, storagePath);

        assets.push({
          id: file.name.replace(/\.[^.]+$/, ""),
          filename: file.name,
          url,
          folder: folder.path,
          type: folder.type,
          createdAt: file.created_at,
          size: file.metadata?.size as number | undefined,
        });
      }
    } catch (error) {
      log.warn(`Error listing ${folder.path}`, { error });
    }
  }

  return assets.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * List 3D models from both meshy-models and vrm-conversion buckets
 * This is an alternative to listForgeAssets that doesn't require metadata
 *
 * Bucket structure:
 * - meshy-models/{assetId}/model.glb      → Main textured/rigged GLB
 * - meshy-models/{assetId}/preview.glb    → Untextured preview
 * - vrm-conversion/{assetId}/model.vrm    → VRM 1.0 converted model
 * - vrm-conversion/{assetId}/model.glb    → GLB version of VRM (for previewing)
 */
export async function listMeshyModels(): Promise<ForgeAsset[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabaseClient();
  const assetsMap = new Map<string, ForgeAsset>();

  // 1. List assets from meshy-models bucket
  try {
    const { data, error } = await supabase.storage
      .from(MESHY_MODELS_BUCKET)
      .list("", { limit: 100 });

    if (error) {
      log.warn(`Failed to list meshy-models: ${error.message}`);
    } else {
      for (const item of data || []) {
        // Folders have id === null
        if (item.id !== null) continue;

        const assetId = item.name;
        const modelUrl = getBucketPublicUrl(
          MESHY_MODELS_BUCKET,
          `${assetId}/model.glb`,
        );
        const previewUrl = getBucketPublicUrl(
          MESHY_MODELS_BUCKET,
          `${assetId}/preview.glb`,
        );
        const thumbnailUrl = getBucketPublicUrl(
          CONCEPT_ART_BUCKET,
          `${FORGE_MODELS_FOLDER}/${assetId}/concept-art.png`,
        );
        const vrmUrl = getBucketPublicUrl(
          VRM_CONVERSION_BUCKET,
          `${assetId}/model.vrm`,
        );

        assetsMap.set(assetId, {
          id: assetId,
          name: assetId,
          source: "FORGE",
          type: "object",
          category: "item",
          modelUrl,
          modelPath: `${assetId}/model.glb`,
          thumbnailUrl,
          previewUrl,
          vrmUrl,
          hasVRM: false, // Will be updated if found in vrm-conversion
          hasModel: true,
          createdAt: item.created_at,
        });
      }
    }
  } catch (error) {
    log.warn("Error listing meshy-models", { error });
  }

  // 2. List assets from vrm-conversion bucket (may have assets not in meshy-models)
  try {
    const { data, error } = await supabase.storage
      .from(VRM_CONVERSION_BUCKET)
      .list("", { limit: 100 });

    if (error) {
      log.warn(`Failed to list vrm-conversion: ${error.message}`);
    } else {
      for (const item of data || []) {
        // Folders have id === null
        if (item.id !== null) continue;

        const assetId = item.name;
        const vrmUrl = getBucketPublicUrl(
          VRM_CONVERSION_BUCKET,
          `${assetId}/model.vrm`,
        );

        if (assetsMap.has(assetId)) {
          // Update existing asset to mark it has VRM
          const existing = assetsMap.get(assetId)!;
          existing.hasVRM = true;
          existing.vrmUrl = vrmUrl;
          existing.vrmPath = `${assetId}/model.vrm`;
        } else {
          // New asset only in vrm-conversion bucket
          // For VRM-only assets, the VRM IS the primary model (like CDN avatars)
          const thumbnailUrl = getBucketPublicUrl(
            CONCEPT_ART_BUCKET,
            `${FORGE_MODELS_FOLDER}/${assetId}/concept-art.png`,
          );

          assetsMap.set(assetId, {
            id: assetId,
            name: assetId,
            source: "FORGE",
            type: "character", // VRM-only assets are likely characters
            category: "npc",
            // For VRM-only assets, use VRM as the primary model (matches CDN avatar format)
            modelUrl: vrmUrl, // VRM file IS the model
            modelPath: `${assetId}/model.vrm`,
            thumbnailUrl,
            vrmUrl,
            vrmPath: `${assetId}/model.vrm`,
            hasVRM: true,
            hasModel: true,
            createdAt: item.created_at,
          });
        }
      }
    }
  } catch (error) {
    log.warn("Error listing vrm-conversion", { error });
  }

  const assets = Array.from(assetsMap.values());
  return assets.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

// ============================================================================
// Model Preferences Storage
// ============================================================================

/**
 * Model preferences data structure
 */
export interface StoredModelPreferences {
  promptEnhancement: string;
  textGeneration: string;
  dialogueGeneration: string;
  contentGeneration: string;
  imageGeneration: string;
  vision: string;
  reasoning: string;
  updatedAt?: string;
}

/**
 * Save model preferences to Supabase
 * Stores in content-generations bucket under /settings/model-preferences/{userId}.json
 */
export async function saveModelPreferences(
  userId: string,
  preferences: StoredModelPreferences,
): Promise<UploadResult> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      url: "",
      path: "",
      error: "Supabase is not configured",
    };
  }

  try {
    await ensureBucket();

    const data = {
      ...preferences,
      updatedAt: new Date().toISOString(),
    };

    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, "utf-8");
    const storagePath = `settings/model-preferences/${userId}.json`;

    const result = await uploadFileToBucket(
      CONTENT_GENERATIONS_BUCKET,
      storagePath,
      buffer,
      "application/json",
    );

    if (result.success) {
      log.info(`Saved model preferences for user: ${userId}`);
    }

    return result;
  } catch (error) {
    log.error("Error saving model preferences", { error });
    return {
      success: false,
      url: "",
      path: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Load model preferences from Supabase
 */
export async function loadModelPreferences(
  userId: string,
): Promise<StoredModelPreferences | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const supabase = getSupabaseClient();
    const storagePath = `settings/model-preferences/${userId}.json`;

    const { data, error } = await supabase.storage
      .from(CONTENT_GENERATIONS_BUCKET)
      .download(storagePath);

    if (error) {
      // File may not exist yet - not an error
      if (error.message.includes("not found")) {
        return null;
      }
      log.warn(`Failed to load model preferences: ${error.message}`);
      return null;
    }

    const text = await data.text();
    const preferences = JSON.parse(text) as StoredModelPreferences;

    log.info(`Loaded model preferences for user: ${userId}`);

    return preferences;
  } catch (error) {
    log.error("Error loading model preferences", { error });
    return null;
  }
}

/**
 * Delete model preferences from Supabase
 */
export async function deleteModelPreferences(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const storagePath = `settings/model-preferences/${userId}.json`;
    return await deleteFile(storagePath);
  } catch (error) {
    log.error("Error deleting model preferences", { error });
    return false;
  }
}

/**
 * Get bucket names for external use
 */
export const BUCKET_NAMES = {
  IMAGE_GENERATION: IMAGE_GENERATION_BUCKET,
  AUDIO_GENERATIONS: AUDIO_GENERATIONS_BUCKET,
  CONTENT_GENERATIONS: CONTENT_GENERATIONS_BUCKET,
  MESHY_MODELS: MESHY_MODELS_BUCKET,
  VRM_CONVERSION: VRM_CONVERSION_BUCKET,
  CONCEPT_ART: CONCEPT_ART_BUCKET,
  BAKED_STRUCTURES: BAKED_STRUCTURES_BUCKET,
} as const;

/**
 * Get public URL for any bucket/path combination
 */
export function getSupabasePublicUrl(bucket: string, path: string): string {
  return getBucketPublicUrl(bucket, path);
}

// ============================================================================
// BAKED STRUCTURES STORAGE
// For baked buildings and town layouts
// Storage: baked-structures/buildings/{id}/ and baked-structures/towns/{id}/
// ============================================================================

export interface BakedBuildingFiles {
  definitionUrl: string;
  definitionPath: string;
  thumbnailUrl?: string;
  thumbnailPath?: string;
}

export interface SaveBakedBuildingOptions {
  buildingId: string;
  definition: Record<string, unknown>;
  thumbnailBuffer?: Buffer | ArrayBuffer;
}

/**
 * Save a baked building to Supabase Storage
 * Storage: baked-structures/buildings/{buildingId}/
 *   - definition.json (the structure definition)
 *   - thumbnail.png (optional)
 */
export async function saveBakedBuilding(
  options: SaveBakedBuildingOptions,
): Promise<BakedBuildingFiles> {
  const { buildingId, definition, thumbnailBuffer } = options;

  await ensureBucket();

  const result: BakedBuildingFiles = {
    definitionUrl: "",
    definitionPath: "",
  };

  // Save definition JSON
  const definitionPath = `buildings/${buildingId}/definition.json`;
  const definitionBuffer = Buffer.from(JSON.stringify(definition, null, 2));

  const definitionUpload = await uploadFileToBucket(
    BAKED_STRUCTURES_BUCKET,
    definitionPath,
    definitionBuffer,
    "application/json",
  );

  if (definitionUpload.success) {
    result.definitionUrl = definitionUpload.url;
    result.definitionPath = definitionUpload.path;
    log.info(`Saved baked building definition: ${buildingId}`);
  } else {
    throw new Error(
      `Failed to save building definition: ${definitionUpload.error}`,
    );
  }

  // Save thumbnail if provided
  if (thumbnailBuffer) {
    const thumbnailPath = `buildings/${buildingId}/thumbnail.png`;
    const thumbnailUpload = await uploadFileToBucket(
      BAKED_STRUCTURES_BUCKET,
      thumbnailPath,
      thumbnailBuffer,
      "image/png",
    );

    if (thumbnailUpload.success) {
      result.thumbnailUrl = thumbnailUpload.url;
      result.thumbnailPath = thumbnailUpload.path;
      log.info(`Saved baked building thumbnail: ${buildingId}`);
    }
  }

  return result;
}

export interface TownFiles {
  definitionUrl: string;
  definitionPath: string;
  thumbnailUrl?: string;
  thumbnailPath?: string;
}

export interface SaveTownOptions {
  townId: string;
  definition: Record<string, unknown>;
  thumbnailBuffer?: Buffer | ArrayBuffer;
}

/**
 * Save a town layout to Supabase Storage
 * Storage: baked-structures/towns/{townId}/
 *   - definition.json (the town definition with building placements)
 *   - thumbnail.png (optional)
 */
export async function saveTown(options: SaveTownOptions): Promise<TownFiles> {
  const { townId, definition, thumbnailBuffer } = options;

  await ensureBucket();

  const result: TownFiles = {
    definitionUrl: "",
    definitionPath: "",
  };

  // Save definition JSON
  const definitionPath = `towns/${townId}/definition.json`;
  const definitionBuffer = Buffer.from(JSON.stringify(definition, null, 2));

  const definitionUpload = await uploadFileToBucket(
    BAKED_STRUCTURES_BUCKET,
    definitionPath,
    definitionBuffer,
    "application/json",
  );

  if (definitionUpload.success) {
    result.definitionUrl = definitionUpload.url;
    result.definitionPath = definitionUpload.path;
    log.info(`Saved town definition: ${townId}`);
  } else {
    throw new Error(
      `Failed to save town definition: ${definitionUpload.error}`,
    );
  }

  // Save thumbnail if provided
  if (thumbnailBuffer) {
    const thumbnailPath = `towns/${townId}/thumbnail.png`;
    const thumbnailUpload = await uploadFileToBucket(
      BAKED_STRUCTURES_BUCKET,
      thumbnailPath,
      thumbnailBuffer,
      "image/png",
    );

    if (thumbnailUpload.success) {
      result.thumbnailUrl = thumbnailUpload.url;
      result.thumbnailPath = thumbnailUpload.path;
      log.info(`Saved town thumbnail: ${townId}`);
    }
  }

  return result;
}

/**
 * Get public URL for a baked building asset
 */
export function getBakedBuildingUrl(
  buildingId: string,
  filename: string,
): string {
  return getBucketPublicUrl(
    BAKED_STRUCTURES_BUCKET,
    `buildings/${buildingId}/${filename}`,
  );
}

/**
 * Get public URL for a town asset
 */
export function getTownUrl(townId: string, filename: string): string {
  return getBucketPublicUrl(
    BAKED_STRUCTURES_BUCKET,
    `towns/${townId}/${filename}`,
  );
}
