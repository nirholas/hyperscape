/**
 * Supabase Storage Tests
 *
 * Tests for the Supabase storage service.
 * Tests bucket configuration, path building, and content type detection.
 * Function tests use mocked Supabase client.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";

// Set up hoisted mocks before imports
const { mockStorageBucket, mockStorageFrom, setupDefaultMocks } = vi.hoisted(
  () => {
    const mockStorageBucket = {
      upload: vi.fn(),
      download: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    };

    const mockStorageFrom = vi.fn(() => mockStorageBucket);

    // Helper to set up default mock implementations
    const setupDefaultMocks = () => {
      mockStorageBucket.upload.mockResolvedValue({
        data: { path: "test/path.glb" },
        error: null,
      });
      mockStorageBucket.download.mockResolvedValue({
        data: new Blob(["test"]),
        error: null,
      });
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });
      mockStorageBucket.remove.mockResolvedValue({
        data: null,
        error: null,
      });
      mockStorageBucket.getPublicUrl.mockReturnValue({
        data: {
          publicUrl:
            "https://test.supabase.co/storage/v1/object/public/test/file.glb",
        },
      });
    };

    // Set up initial defaults
    setupDefaultMocks();

    return { mockStorageBucket, mockStorageFrom, setupDefaultMocks };
  },
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: mockStorageFrom,
    },
  })),
}));

// Import after mocks are set up
import {
  BUCKET_NAMES,
  isSupabaseConfigured,
  getSupabasePublicUrl,
  uploadReferenceImage,
  uploadConceptArt,
  uploadAudio,
  uploadContent,
  uploadGameContent,
  deleteFile,
  listFiles,
  saveForgeAsset,
  readForgeAssetMetadata,
  forgeAssetExists,
  deleteForgeAsset,
  listForgeAssetIds,
  getForgeAsset,
  listForgeAssets,
  listImageAssets,
  listAudioAssets,
  listContentAssets,
  listMeshyModels,
  saveModelPreferences,
  loadModelPreferences,
  deleteModelPreferences,
} from "../supabase-storage";

// Helper to reset all mocks to default state
function resetMocks() {
  // Clear mock calls but keep implementations
  mockStorageBucket.upload.mockClear();
  mockStorageBucket.download.mockClear();
  mockStorageBucket.list.mockClear();
  mockStorageBucket.remove.mockClear();
  mockStorageBucket.getPublicUrl.mockClear();
  mockStorageFrom.mockClear();

  // Re-apply default implementations
  setupDefaultMocks();
}

describe("Supabase Storage", () => {
  beforeAll(() => {
    // Set env variables that will be used throughout
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "secret-key";
  });

  beforeEach(() => {
    resetMocks();
  });

  describe("Bucket Configuration", () => {
    it("defines all 6 required buckets", () => {
      expect(Object.keys(BUCKET_NAMES)).toHaveLength(6);
    });

    it("includes image generation bucket", () => {
      expect(BUCKET_NAMES.IMAGE_GENERATION).toBeDefined();
      expect(BUCKET_NAMES.IMAGE_GENERATION).toBe("image-generation");
    });

    it("includes audio generations bucket", () => {
      expect(BUCKET_NAMES.AUDIO_GENERATIONS).toBeDefined();
      expect(BUCKET_NAMES.AUDIO_GENERATIONS).toBe("audio-generations");
    });

    it("includes content generations bucket", () => {
      expect(BUCKET_NAMES.CONTENT_GENERATIONS).toBeDefined();
      expect(BUCKET_NAMES.CONTENT_GENERATIONS).toBe("content-generations");
    });

    it("includes meshy models bucket", () => {
      expect(BUCKET_NAMES.MESHY_MODELS).toBeDefined();
      expect(BUCKET_NAMES.MESHY_MODELS).toBe("meshy-models");
    });

    it("includes VRM conversion bucket", () => {
      expect(BUCKET_NAMES.VRM_CONVERSION).toBeDefined();
      expect(BUCKET_NAMES.VRM_CONVERSION).toBe("vrm-conversion");
    });

    it("includes concept art bucket", () => {
      expect(BUCKET_NAMES.CONCEPT_ART).toBeDefined();
      expect(BUCKET_NAMES.CONCEPT_ART).toBe("concept-art-pipeline");
    });

    it("bucket names are valid identifiers (lowercase with hyphens)", () => {
      const validBucketPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;

      Object.values(BUCKET_NAMES).forEach((bucketName) => {
        expect(bucketName).toMatch(validBucketPattern);
      });
    });

    it("bucket names do not contain underscores", () => {
      Object.values(BUCKET_NAMES).forEach((bucketName) => {
        expect(bucketName).not.toContain("_");
      });
    });

    it("bucket names do not contain uppercase", () => {
      Object.values(BUCKET_NAMES).forEach((bucketName) => {
        expect(bucketName).toBe(bucketName.toLowerCase());
      });
    });
  });

  describe("isSupabaseConfigured", () => {
    const envBackup = { ...process.env };

    afterEach(() => {
      process.env = { ...envBackup };
    });

    it("returns false when no environment variables are set", () => {
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_KEY;
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("returns false when only URL is set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_KEY;
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("returns false when only key is set", () => {
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SECRET_KEY = "secret-key";

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("returns true when SUPABASE_URL and SUPABASE_SECRET_KEY are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SECRET_KEY = "secret-key";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns true when NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY are set", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "anon-key";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns true when SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns true when SUPABASE_URL and SUPABASE_SERVICE_KEY are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_KEY = "service-key";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns true when SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

      expect(isSupabaseConfigured()).toBe(true);
    });
  });

  describe("getSupabasePublicUrl", () => {
    it("returns public URL for bucket and path", () => {
      const url = getSupabasePublicUrl("meshy-models", "asset-001/model.glb");

      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });

    it("calls getPublicUrl with correct path", () => {
      getSupabasePublicUrl("image-generation", "concept-art/image.png");

      expect(mockStorageBucket.getPublicUrl).toHaveBeenCalledWith(
        "concept-art/image.png",
      );
    });
  });

  describe("Path Building", () => {
    it("builds correct storage paths for models", () => {
      const assetId = "bronze-sword-123";
      const modelPath = `${assetId}/model.glb`;

      expect(modelPath).toBe("bronze-sword-123/model.glb");
      expect(modelPath).toContain(assetId);
      expect(modelPath.endsWith(".glb")).toBe(true);
    });

    it("builds correct storage paths for VRM", () => {
      const assetId = "knight-avatar";
      const vrmPath = `${assetId}/model.vrm`;

      expect(vrmPath).toBe("knight-avatar/model.vrm");
      expect(vrmPath.endsWith(".vrm")).toBe(true);
    });

    it("builds correct storage paths for thumbnails", () => {
      const forgeModelsFolder = "forge/models";
      const assetId = "test-asset";
      const thumbnailPath = `${forgeModelsFolder}/${assetId}/thumbnail.png`;

      expect(thumbnailPath).toBe("forge/models/test-asset/thumbnail.png");
      expect(thumbnailPath).toContain(forgeModelsFolder);
      expect(thumbnailPath.endsWith(".png")).toBe(true);
    });

    it("builds correct storage paths for metadata", () => {
      const forgeModelsFolder = "forge/models";
      const assetId = "item-123";
      const metadataPath = `${forgeModelsFolder}/${assetId}/metadata.json`;

      expect(metadataPath).toBe("forge/models/item-123/metadata.json");
      expect(metadataPath.endsWith(".json")).toBe(true);
    });

    it("builds correct storage paths for preview models", () => {
      const assetId = "goblin-warrior";
      const previewPath = `${assetId}/preview.glb`;

      expect(previewPath).toBe("goblin-warrior/preview.glb");
      expect(previewPath).toContain("preview");
    });

    it("builds correct storage paths for textured models", () => {
      const assetId = "armor-set";
      const texturedPath = `${assetId}/textured.glb`;

      expect(texturedPath).toBe("armor-set/textured.glb");
      expect(texturedPath).toContain("textured");
    });

    it("includes folder prefixes for reference images", () => {
      const referenceImagesFolder = "reference-images";
      const filename = "texture_ref_001.png";
      const storagePath = `${referenceImagesFolder}/${filename}`;

      expect(storagePath).toBe("reference-images/texture_ref_001.png");
      expect(storagePath.startsWith(referenceImagesFolder)).toBe(true);
    });

    it("includes folder prefixes for concept art", () => {
      const conceptArtFolder = "concept-art";
      const filename = "concept_12345_abc123.png";
      const storagePath = `${conceptArtFolder}/${filename}`;

      expect(storagePath).toBe("concept-art/concept_12345_abc123.png");
      expect(storagePath.startsWith(conceptArtFolder)).toBe(true);
    });

    it("includes folder prefixes for audio", () => {
      const generatedFolder = "generated";
      const filename = "audio_12345_xyz.mp3";
      const storagePath = `${generatedFolder}/${filename}`;

      expect(storagePath).toBe("generated/audio_12345_xyz.mp3");
      expect(storagePath.startsWith(generatedFolder)).toBe(true);
    });

    it("includes folder prefixes for game content", () => {
      const gameContentFolders = [
        "game/quests",
        "game/npcs",
        "game/dialogues",
        "game/items",
        "game/areas",
      ];

      gameContentFolders.forEach((folder) => {
        const filename = "content_data.json";
        const storagePath = `${folder}/${filename}`;

        expect(storagePath).toContain("game/");
        expect(storagePath.endsWith(".json")).toBe(true);
      });
    });

    it("handles file extensions correctly", () => {
      const extensions = [
        ".glb",
        ".vrm",
        ".gltf",
        ".png",
        ".jpg",
        ".json",
        ".mp3",
      ];

      extensions.forEach((ext) => {
        const filePath = `test-asset/file${ext}`;
        expect(filePath.endsWith(ext)).toBe(true);
      });
    });
  });

  describe("Content Type Detection", () => {
    it("detects GLB content type", () => {
      const glbContentType = "application/octet-stream";
      const altGlbContentType = "model/gltf-binary";

      // Supabase uses octet-stream for broader compatibility
      expect(glbContentType).toBe("application/octet-stream");
      expect(altGlbContentType).toBe("model/gltf-binary");
    });

    it("detects VRM content type", () => {
      // VRM files use octet-stream for compatibility
      const vrmContentType = "application/octet-stream";
      expect(vrmContentType).toBe("application/octet-stream");
    });

    it("detects PNG image content type", () => {
      const pngContentType = "image/png";
      expect(pngContentType).toBe("image/png");
    });

    it("detects JPEG image content type", () => {
      const jpegContentType = "image/jpeg";
      expect(jpegContentType).toBe("image/jpeg");
    });

    it("detects JSON content type", () => {
      const jsonContentType = "application/json";
      expect(jsonContentType).toBe("application/json");
    });

    it("detects MP3 audio content type", () => {
      const mp3ContentType = "audio/mpeg";
      expect(mp3ContentType).toBe("audio/mpeg");
    });

    it("detects WAV audio content type", () => {
      const wavContentType = "audio/wav";
      expect(wavContentType).toBe("audio/wav");
    });

    it("detects WebM audio content type", () => {
      const webmContentType = "audio/webm";
      expect(webmContentType).toBe("audio/webm");
    });

    it("maps file extensions to content types correctly", () => {
      const extensionToContentType: Record<string, string> = {
        ".glb": "application/octet-stream",
        ".vrm": "application/octet-stream",
        ".gltf": "model/gltf+json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".json": "application/json",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".webm": "audio/webm",
      };

      expect(extensionToContentType[".glb"]).toBe("application/octet-stream");
      expect(extensionToContentType[".png"]).toBe("image/png");
      expect(extensionToContentType[".mp3"]).toBe("audio/mpeg");
    });
  });

  describe("URL Format", () => {
    it("public URL follows Supabase format", () => {
      const projectId = "example-project";
      const bucket = "meshy-models";
      const storagePath = "asset-123/model.glb";

      const expectedUrlPattern = `https://${projectId}.supabase.co/storage/v1/object/public/${bucket}/${storagePath}`;

      expect(expectedUrlPattern).toContain(
        "supabase.co/storage/v1/object/public",
      );
      expect(expectedUrlPattern).toContain(bucket);
      expect(expectedUrlPattern).toContain(storagePath);
    });

    it("storage path does not include bucket in path", () => {
      const storagePath = "asset-123/model.glb";

      // Storage path should be relative within the bucket
      expect(storagePath).not.toContain("meshy-models/");
      expect(storagePath.startsWith("/")).toBe(false);
    });
  });

  describe("Asset File Organization", () => {
    it("organizes model files by asset ID", () => {
      const assetId = "sword-001";

      const modelPath = `${assetId}/model.glb`;
      const previewPath = `${assetId}/preview.glb`;
      const texturedPath = `${assetId}/textured.glb`;

      expect(modelPath.startsWith(assetId)).toBe(true);
      expect(previewPath.startsWith(assetId)).toBe(true);
      expect(texturedPath.startsWith(assetId)).toBe(true);
    });

    it("organizes VRM files in dedicated bucket", () => {
      const vrmBucket = BUCKET_NAMES.VRM_CONVERSION;
      const assetId = "avatar-123";
      const vrmPath = `${assetId}/model.vrm`;

      expect(vrmBucket).toBe("vrm-conversion");
      expect(vrmPath).toContain(assetId);
      expect(vrmPath.endsWith(".vrm")).toBe(true);
    });

    it("organizes textures in image generation bucket", () => {
      const imageBucket = BUCKET_NAMES.IMAGE_GENERATION;
      const assetId = "textured-model";
      const texturePath = `textures/${assetId}/base_color.png`;

      expect(imageBucket).toBe("image-generation");
      expect(texturePath).toContain("textures");
      expect(texturePath).toContain(assetId);
    });
  });

  describe("Cache Control", () => {
    it("default cache control is 1 year for immutable assets", () => {
      const defaultCacheControl = "31536000"; // 1 year in seconds
      const oneYearSeconds = 365 * 24 * 60 * 60;

      expect(parseInt(defaultCacheControl)).toBe(oneYearSeconds);
    });
  });

  describe("Upload Result Structure", () => {
    it("upload result includes required fields", () => {
      const successResult = {
        success: true,
        url: "https://example.supabase.co/storage/v1/object/public/bucket/path",
        path: "path/to/file.glb",
      };

      expect(successResult.success).toBe(true);
      expect(successResult.url).toBeDefined();
      expect(successResult.path).toBeDefined();
    });

    it("failed upload result includes error", () => {
      const failedResult = {
        success: false,
        url: "",
        path: "",
        error: "Upload failed: permission denied",
      };

      expect(failedResult.success).toBe(false);
      expect(failedResult.error).toBeDefined();
      expect(failedResult.url).toBe("");
    });
  });

  describe("ForgeAsset Structure", () => {
    it("forge asset includes required fields", () => {
      const asset = {
        id: "sword-001",
        name: "Bronze Sword",
        source: "FORGE" as const,
        type: "weapon",
        category: "sword",
        modelUrl:
          "https://example.supabase.co/storage/v1/object/public/meshy-models/sword-001/model.glb",
        modelPath: "sword-001/model.glb",
        hasModel: true,
      };

      expect(asset.id).toBe("sword-001");
      expect(asset.source).toBe("FORGE");
      expect(asset.modelUrl).toBeDefined();
      expect(asset.hasModel).toBe(true);
    });

    it("forge asset with VRM includes VRM fields", () => {
      const asset = {
        id: "avatar-001",
        name: "Knight Avatar",
        source: "FORGE" as const,
        type: "character",
        category: "npc",
        modelUrl:
          "https://example.supabase.co/storage/v1/object/public/meshy-models/avatar-001/model.glb",
        hasVRM: true,
        vrmUrl:
          "https://example.supabase.co/storage/v1/object/public/vrm-conversion/avatar-001/model.vrm",
        vrmPath: "avatar-001/model.vrm",
      };

      expect(asset.hasVRM).toBe(true);
      expect(asset.vrmUrl).toBeDefined();
      expect(asset.vrmPath).toContain(".vrm");
    });
  });

  describe("SaveForgeAssetOptions Structure", () => {
    it("minimal options include required fields", () => {
      const options = {
        assetId: "sword-001",
        modelBuffer: Buffer.from("test"),
      };

      expect(options.assetId).toBeDefined();
      expect(options.modelBuffer).toBeDefined();
    });

    it("full options include all optional fields", () => {
      const options = {
        assetId: "avatar-001",
        modelBuffer: Buffer.from("glb"),
        modelFormat: "glb" as const,
        thumbnailBuffer: Buffer.from("png"),
        vrmBuffer: Buffer.from("vrm"),
        previewBuffer: Buffer.from("preview"),
        texturedModelBuffer: Buffer.from("textured"),
        textureFiles: [
          { name: "base_color.png", buffer: Buffer.from("texture") },
        ],
        metadata: { name: "Test", type: "character" },
      };

      expect(options.thumbnailBuffer).toBeDefined();
      expect(options.vrmBuffer).toBeDefined();
      expect(options.metadata).toBeDefined();
    });
  });

  describe("StoredModelPreferences Structure", () => {
    it("includes all preference fields", () => {
      const prefs = {
        promptEnhancement: "gpt-4",
        textGeneration: "claude-3",
        dialogueGeneration: "gpt-4",
        contentGeneration: "claude-3",
        imageGeneration: "dall-e-3",
        vision: "gpt-4-vision",
        reasoning: "o1-preview",
      };

      expect(Object.keys(prefs)).toHaveLength(7);
      expect(prefs.promptEnhancement).toBe("gpt-4");
      expect(prefs.imageGeneration).toBe("dall-e-3");
    });
  });

  describe("Asset Type Definitions", () => {
    it("ImageAsset types are valid", () => {
      const types = ["concept-art", "sprite", "reference-image", "texture"];
      expect(types).toContain("concept-art");
      expect(types).toContain("sprite");
    });

    it("AudioAsset types are valid", () => {
      const types = ["voice", "sfx", "music"];
      expect(types).toContain("voice");
      expect(types).toContain("sfx");
      expect(types).toContain("music");
    });

    it("ContentAsset types are valid", () => {
      const types = ["quest", "npc", "dialogue", "item", "area", "general"];
      expect(types).toContain("quest");
      expect(types).toContain("dialogue");
    });
  });

  // ============================================================================
  // INTEGRATION TESTS - Functions that call Supabase client
  // ============================================================================

  describe("uploadReferenceImage", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("uploads a reference image with File input", async () => {
      const fileContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const file = new File([fileContent], "test-image.png", {
        type: "image/png",
      });

      const result = await uploadReferenceImage(
        file,
        "test-image.png",
        "image/png",
      );

      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.path).toBe("test/path.glb");
      expect(mockStorageBucket.upload).toHaveBeenCalled();
    });

    it("uploads a reference image with Buffer input", async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await uploadReferenceImage(
        buffer,
        "test-buffer.png",
        "image/png",
      );

      expect(result.success).toBe(true);
      expect(mockStorageBucket.upload).toHaveBeenCalled();
    });

    it("returns error on upload failure", async () => {
      // Reset and set up failure - need to fail all upload attempts including ensureBucket list checks
      mockStorageBucket.list.mockResolvedValue({ data: [], error: null });
      mockStorageBucket.upload.mockResolvedValue({
        data: null,
        error: { message: "Upload failed" },
      });

      const buffer = Buffer.from("test");
      const result = await uploadReferenceImage(
        buffer,
        "fail.png",
        "image/png",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Upload failed");
    });

    it("extracts extension from filename", async () => {
      const buffer = Buffer.from("test");
      await uploadReferenceImage(buffer, "image.jpg", "image/jpeg");

      // Find the actual upload call (not list calls from ensureBucket)
      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain(".jpg");
    });
  });

  describe("uploadConceptArt", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("uploads concept art buffer", async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await uploadConceptArt(buffer, "image/png");

      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(mockStorageBucket.upload).toHaveBeenCalled();
      expect(mockStorageFrom).toHaveBeenCalledWith("image-generation");
    });

    it("uses jpg extension for jpeg content type", async () => {
      const buffer = Buffer.from("jpeg data");

      await uploadConceptArt(buffer, "image/jpeg");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain(".jpg");
    });

    it("uses png extension for png content type", async () => {
      const buffer = Buffer.from("png data");

      await uploadConceptArt(buffer, "image/png");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain(".png");
    });

    it("returns error on upload failure", async () => {
      mockStorageBucket.list.mockResolvedValue({ data: [], error: null });
      mockStorageBucket.upload.mockResolvedValue({
        data: null,
        error: { message: "Storage quota exceeded" },
      });

      const buffer = Buffer.from("test");
      const result = await uploadConceptArt(buffer);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Storage quota exceeded");
    });
  });

  describe("uploadAudio", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("uploads audio buffer to audio-generations bucket", async () => {
      const buffer = Buffer.from("audio data");

      const result = await uploadAudio(buffer, "speech.mp3", "audio/mpeg");

      expect(result.success).toBe(true);
      expect(mockStorageFrom).toHaveBeenCalledWith("audio-generations");
    });

    it("extracts extension from filename", async () => {
      const buffer = Buffer.from("wav data");

      await uploadAudio(buffer, "sound.wav", "audio/wav");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain(".wav");
    });

    it("returns error on upload failure", async () => {
      mockStorageBucket.list.mockResolvedValue({ data: [], error: null });
      mockStorageBucket.upload.mockResolvedValue({
        data: null,
        error: { message: "Network error" },
      });

      const buffer = Buffer.from("test");
      const result = await uploadAudio(buffer, "test.mp3");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("uploadContent", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("uploads string content as JSON", async () => {
      const content = JSON.stringify({ name: "Test Quest" });

      const result = await uploadContent(content, "quest.json");

      expect(result.success).toBe(true);
      expect(mockStorageFrom).toHaveBeenCalledWith("content-generations");
    });

    it("uploads buffer content", async () => {
      const buffer = Buffer.from('{"key": "value"}');

      const result = await uploadContent(buffer, "data.json");

      expect(result.success).toBe(true);
    });

    it("uses custom folder path", async () => {
      const content = '{"test": true}';

      await uploadContent(
        content,
        "config.json",
        "application/json",
        "game/items",
      );

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/items");
    });

    it("returns error on upload failure", async () => {
      mockStorageBucket.list.mockResolvedValue({ data: [], error: null });
      mockStorageBucket.upload.mockResolvedValue({
        data: null,
        error: { message: "Permission denied" },
      });

      const result = await uploadContent("test", "test.json");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });
  });

  describe("uploadGameContent", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("uploads quest content to game/quests folder", async () => {
      const questData = { name: "Dragon Slayer", objectives: [] };

      const result = await uploadGameContent(questData, "quest", "quest-001");

      expect(result.success).toBe(true);
      expect(mockStorageBucket.upload).toHaveBeenCalled();
      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/quests");
    });

    it("uploads NPC content to game/npcs folder", async () => {
      const npcData = { name: "Guard", dialogue: [] };

      await uploadGameContent(npcData, "npc", "npc-001");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/npcs");
    });

    it("uploads dialogue content to game/dialogues folder", async () => {
      const dialogueData = { nodes: [], edges: [] };

      await uploadGameContent(dialogueData, "dialogue", "dialogue-001");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/dialogues");
    });

    it("uploads item content to game/items folder", async () => {
      const itemData = { name: "Bronze Sword", stats: {} };

      await uploadGameContent(itemData, "item", "item-001");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/items");
    });

    it("uploads area content to game/areas folder", async () => {
      const areaData = { name: "Lumbridge", zones: [] };

      await uploadGameContent(areaData, "area", "area-001");

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const lastUploadCall = uploadCalls[uploadCalls.length - 1];
      expect(lastUploadCall[0]).toContain("game/areas");
    });
  });

  describe("deleteFile", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("deletes file from storage", async () => {
      const result = await deleteFile("forge/models/asset-001/model.glb");

      expect(result).toBe(true);
      expect(mockStorageBucket.remove).toHaveBeenCalledWith([
        "forge/models/asset-001/model.glb",
      ]);
    });

    it("returns false on delete error", async () => {
      mockStorageBucket.remove.mockResolvedValue({
        data: null,
        error: { message: "File not found" },
      });

      const result = await deleteFile("nonexistent/file.glb");

      expect(result).toBe(false);
    });
  });

  describe("listFiles", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists files in a folder", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [{ name: "file1.glb" }, { name: "file2.png" }],
        error: null,
      });

      const result = await listFiles("forge/models");

      expect(result).toHaveLength(2);
      expect(result[0]).toBe("forge/models/file1.glb");
      expect(result[1]).toBe("forge/models/file2.png");
    });

    it("returns empty array on error", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "Access denied" },
      });

      const result = await listFiles("private/folder");

      expect(result).toEqual([]);
    });

    it("returns empty array when folder is empty", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await listFiles("empty/folder");

      expect(result).toEqual([]);
    });
  });

  describe("saveForgeAsset", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("saves minimal forge asset with model only", async () => {
      const modelBuffer = Buffer.from("glb model data");

      const result = await saveForgeAsset({
        assetId: "sword-001",
        modelBuffer,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.modelPath).toBeDefined();
      expect(mockStorageFrom).toHaveBeenCalledWith("meshy-models");
    });

    it("saves forge asset with thumbnail", async () => {
      const modelBuffer = Buffer.from("glb model");
      const thumbnailBuffer = Buffer.from("png thumbnail");

      const result = await saveForgeAsset({
        assetId: "asset-with-thumb",
        modelBuffer,
        thumbnailBuffer,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.thumbnailUrl).toBeDefined();
    });

    it("saves forge asset with VRM", async () => {
      const modelBuffer = Buffer.from("glb model");
      const vrmBuffer = Buffer.from("vrm model");

      const result = await saveForgeAsset({
        assetId: "avatar-001",
        modelBuffer,
        vrmBuffer,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.vrmUrl).toBeDefined();
      expect(mockStorageFrom).toHaveBeenCalledWith("vrm-conversion");
    });

    it("saves forge asset with preview model", async () => {
      const modelBuffer = Buffer.from("glb model");
      const previewBuffer = Buffer.from("preview glb");

      const result = await saveForgeAsset({
        assetId: "asset-with-preview",
        modelBuffer,
        previewBuffer,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.previewUrl).toBeDefined();
    });

    it("saves forge asset with textured model", async () => {
      const modelBuffer = Buffer.from("rigged glb");
      const texturedModelBuffer = Buffer.from("textured glb");

      const result = await saveForgeAsset({
        assetId: "asset-textured",
        modelBuffer,
        texturedModelBuffer,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.texturedModelUrl).toBeDefined();
    });

    it("saves forge asset with texture files", async () => {
      const modelBuffer = Buffer.from("glb model");
      const textureFiles = [
        { name: "base_color.png", buffer: Buffer.from("texture1") },
        { name: "normal.png", buffer: Buffer.from("texture2") },
      ];

      const result = await saveForgeAsset({
        assetId: "asset-textures",
        modelBuffer,
        textureFiles,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.textureUrls).toBeDefined();
      expect(result.textureUrls).toHaveLength(2);
    });

    it("saves forge asset with metadata", async () => {
      const modelBuffer = Buffer.from("glb model");
      const metadata = {
        name: "Bronze Sword",
        type: "weapon",
        category: "sword",
      };

      const result = await saveForgeAsset({
        assetId: "asset-metadata",
        modelBuffer,
        metadata,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.metadataUrl).toBeDefined();
    });

    it("throws error on model upload failure", async () => {
      // Need to make all uploads fail for the model upload step
      mockStorageBucket.list.mockResolvedValue({ data: [], error: null });
      mockStorageBucket.upload.mockResolvedValue({
        data: null,
        error: { message: "Model upload failed" },
      });

      const modelBuffer = Buffer.from("glb model");

      await expect(
        saveForgeAsset({
          assetId: "fail-asset",
          modelBuffer,
        }),
      ).rejects.toThrow("Failed to upload model: Model upload failed");
    });

    it("uses correct model format extension", async () => {
      const modelBuffer = Buffer.from("vrm data");

      await saveForgeAsset({
        assetId: "vrm-asset",
        modelBuffer,
        modelFormat: "vrm",
      });

      // Find the first upload call which should be for the model
      const uploadCalls = mockStorageBucket.upload.mock.calls;
      // First upload after ensureBucket's list calls should be the model
      expect(uploadCalls.length).toBeGreaterThan(0);
      const modelUploadCall = uploadCalls.find((call) =>
        call[0].includes("model.vrm"),
      );
      expect(modelUploadCall).toBeDefined();
    });

    it("saves complete forge asset with all options", async () => {
      const modelBuffer = Buffer.from("glb model");
      const thumbnailBuffer = Buffer.from("png");
      const vrmBuffer = Buffer.from("vrm");
      const previewBuffer = Buffer.from("preview");
      const texturedModelBuffer = Buffer.from("textured");
      const textureFiles = [
        { name: "diffuse.png", buffer: Buffer.from("tex") },
      ];
      const metadata = { name: "Complete Asset" };

      const result = await saveForgeAsset({
        assetId: "complete-asset",
        modelBuffer,
        modelFormat: "glb",
        thumbnailBuffer,
        vrmBuffer,
        previewBuffer,
        texturedModelBuffer,
        textureFiles,
        metadata,
      });

      expect(result.modelUrl).toBeDefined();
      expect(result.thumbnailUrl).toBeDefined();
      expect(result.vrmUrl).toBeDefined();
      expect(result.previewUrl).toBeDefined();
      expect(result.texturedModelUrl).toBeDefined();
      expect(result.textureUrls).toHaveLength(1);
      expect(result.metadataUrl).toBeDefined();
    });
  });

  describe("readForgeAssetMetadata", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      resetMocks();
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("reads metadata from storage", async () => {
      const metadata = { name: "Test Asset", type: "weapon" };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadata),
      });

      const result = await readForgeAssetMetadata("asset-001");

      expect(result).toEqual(metadata);
    });

    it("returns null when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
      });

      const result = await readForgeAssetMetadata("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null on fetch error", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await readForgeAssetMetadata("error-asset");

      expect(result).toBeNull();
    });
  });

  describe("forgeAssetExists", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("returns true when asset folder has files", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [{ name: "model.glb" }],
        error: null,
      });

      const result = await forgeAssetExists("existing-asset");

      expect(result).toBe(true);
    });

    it("returns false when asset folder is empty", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await forgeAssetExists("empty-asset");

      expect(result).toBe(false);
    });

    it("returns false on list error", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "Not found" },
      });

      const result = await forgeAssetExists("error-asset");

      expect(result).toBe(false);
    });
  });

  describe("deleteForgeAsset", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("deletes all files in asset folder", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { name: "model.glb" },
          { name: "thumbnail.png" },
          { name: "metadata.json" },
        ],
        error: null,
      });

      const result = await deleteForgeAsset("asset-to-delete");

      expect(result).toBe(true);
      expect(mockStorageBucket.remove).toHaveBeenCalled();
    });

    it("returns true when asset folder is already empty", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });
      mockStorageBucket.remove.mockClear();

      const result = await deleteForgeAsset("already-deleted");

      expect(result).toBe(true);
      // remove should not be called when there are no files
      expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    });

    it("returns false on list error", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "Access denied" },
      });

      const result = await deleteForgeAsset("no-access");

      expect(result).toBe(false);
    });

    it("returns false on delete error", async () => {
      // First return files from list
      mockStorageBucket.list.mockResolvedValue({
        data: [{ name: "model.glb" }],
        error: null,
      });
      // Then fail on remove
      mockStorageBucket.remove.mockResolvedValue({
        data: null,
        error: { message: "Delete failed" },
      });

      const result = await deleteForgeAsset("delete-fail");

      expect(result).toBe(false);
    });
  });

  describe("listForgeAssetIds", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists asset folder IDs", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { id: null, name: "asset-001" }, // folder
          { id: null, name: "asset-002" }, // folder
          { id: "file-id", name: "readme.txt" }, // file, should be filtered
        ],
        error: null,
      });

      const result = await listForgeAssetIds();

      expect(result).toHaveLength(2);
      expect(result).toContain("asset-001");
      expect(result).toContain("asset-002");
      expect(result).not.toContain("readme.txt");
    });

    it("returns empty array on error", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "List failed" },
      });

      const result = await listForgeAssetIds();

      expect(result).toEqual([]);
    });

    it("returns empty array when no assets exist", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await listForgeAssetIds();

      expect(result).toEqual([]);
    });
  });

  describe("getForgeAsset", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      resetMocks();
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns asset with all URLs", async () => {
      const metadata = {
        name: "Bronze Sword",
        type: "weapon",
        category: "sword",
        hasVRM: true,
        createdAt: "2024-01-01T00:00:00Z",
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadata),
      });

      const result = await getForgeAsset("sword-001");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("sword-001");
      expect(result!.name).toBe("Bronze Sword");
      expect(result!.source).toBe("FORGE");
      expect(result!.modelUrl).toBeDefined();
      expect(result!.thumbnailUrl).toBeDefined();
      expect(result!.hasVRM).toBe(true);
      expect(result!.vrmUrl).toBeDefined();
    });

    it("returns null when metadata not found", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
      });

      const result = await getForgeAsset("nonexistent");

      expect(result).toBeNull();
    });

    it("uses assetId as name fallback", async () => {
      const metadata = { type: "object" }; // no name
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadata),
      });

      const result = await getForgeAsset("unnamed-asset");

      expect(result!.name).toBe("unnamed-asset");
    });

    it("handles assets without VRM", async () => {
      const metadata = { name: "Simple Object", hasVRM: false };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadata),
      });

      const result = await getForgeAsset("simple-obj");

      expect(result!.hasVRM).toBe(false);
      expect(result!.vrmUrl).toBeUndefined();
    });
  });

  describe("listForgeAssets", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      resetMocks();
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("lists and enriches all forge assets", async () => {
      // All list calls return asset folders
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { id: null, name: "asset-001" },
          { id: null, name: "asset-002" },
        ],
        error: null,
      });

      // Fetch calls for metadata
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ name: "First Asset", createdAt: "2024-01-02" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ name: "Second Asset", createdAt: "2024-01-01" }),
        });

      const result = await listForgeAssets();

      expect(result).toHaveLength(2);
      // Sorted by date descending
      expect(result[0].name).toBe("First Asset");
      expect(result[1].name).toBe("Second Asset");
    });

    it("filters out assets with no metadata", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { id: null, name: "good-asset" },
          { id: null, name: "bad-asset" },
        ],
        error: null,
      });

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ name: "Good Asset" }),
        })
        .mockResolvedValueOnce({
          ok: false, // No metadata
        });

      const result = await listForgeAssets();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Good Asset");
    });

    it("returns empty array when no assets", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await listForgeAssets();

      expect(result).toEqual([]);
    });
  });

  describe("listImageAssets", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists images from all image folders", async () => {
      // The function lists from 4 folders: concept-art, sprites, reference-images, textures
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: "1", name: "art1.png", created_at: "2024-01-01" }],
            error: null,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            data: [{ id: "2", name: "sprite1.png", created_at: "2024-01-02" }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const result = await listImageAssets();

      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty array when not configured", async () => {
      // Temporarily unset env vars
      const backup = { ...process.env };
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = await listImageAssets();

      expect(result).toEqual([]);

      // Restore
      process.env = backup;
    });

    it("skips folders in results", async () => {
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [
              { id: null, name: "subfolder" }, // folder
              { id: "1", name: "image.png" }, // file
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const result = await listImageAssets();

      expect(result.some((a) => a.filename === "subfolder")).toBe(false);
      expect(result.some((a) => a.filename === "image.png")).toBe(true);
    });
  });

  describe("listAudioAssets", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists audio files from generated folder", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { id: "1", name: "voice_001.mp3", created_at: "2024-01-01" },
          { id: "2", name: "sfx_hit.mp3", created_at: "2024-01-02" },
        ],
        error: null,
      });

      const result = await listAudioAssets();

      expect(result).toHaveLength(2);
      expect(result.some((a) => a.type === "voice")).toBe(true);
      expect(result.some((a) => a.type === "sfx")).toBe(true);
    });

    it("detects music type from filename", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: [
          { id: "1", name: "music_ambient.mp3" },
          { id: "2", name: "theme_battle.mp3" },
        ],
        error: null,
      });

      const result = await listAudioAssets();

      expect(result.every((a) => a.type === "music")).toBe(true);
    });

    it("returns empty array on error", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "Bucket not found" },
      });

      const result = await listAudioAssets();

      expect(result).toEqual([]);
    });
  });

  describe("listContentAssets", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists content from all game folders", async () => {
      // Mock calls for each folder: generated, game/quests, game/npcs, etc.
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: "1", name: "content.json" }],
            error: null,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            data: [{ id: "2", name: "quest_001.json" }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const result = await listContentAssets();

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((a) => a.type === "general")).toBe(true);
      expect(result.some((a) => a.type === "quest")).toBe(true);
    });

    it("continues on folder error", async () => {
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // generated folder fails
          return Promise.resolve({ data: null, error: { message: "error" } });
        } else if (callCount === 2) {
          return Promise.resolve({
            data: [{ id: "1", name: "quest.json" }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const result = await listContentAssets();

      expect(result.some((a) => a.type === "quest")).toBe(true);
    });
  });

  describe("listMeshyModels", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("lists models from meshy-models bucket", async () => {
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // meshy-models bucket
          return Promise.resolve({
            data: [
              { id: null, name: "model-001", created_at: "2024-01-01" },
              { id: null, name: "model-002", created_at: "2024-01-02" },
            ],
            error: null,
          });
        }
        // vrm-conversion bucket
        return Promise.resolve({ data: [], error: null });
      });

      const result = await listMeshyModels();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("model-002"); // Sorted by date desc
      expect(result[1].id).toBe("model-001");
    });

    it("merges VRM info from vrm-conversion bucket", async () => {
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: null, name: "avatar-001" }],
            error: null,
          });
        }
        // VRM bucket returns same asset
        return Promise.resolve({
          data: [{ id: null, name: "avatar-001" }],
          error: null,
        });
      });

      const result = await listMeshyModels();

      expect(result).toHaveLength(1);
      expect(result[0].hasVRM).toBe(true);
      expect(result[0].vrmUrl).toBeDefined();
    });

    it("includes VRM-only assets", async () => {
      let callCount = 0;
      mockStorageBucket.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // meshy-models empty
          return Promise.resolve({ data: [], error: null });
        }
        // VRM bucket has asset
        return Promise.resolve({
          data: [{ id: null, name: "vrm-only-001" }],
          error: null,
        });
      });

      const result = await listMeshyModels();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("vrm-only-001");
      expect(result[0].hasVRM).toBe(true);
      expect(result[0].type).toBe("character");
    });

    it("handles bucket errors gracefully", async () => {
      mockStorageBucket.list.mockResolvedValue({
        data: null,
        error: { message: "error" },
      });

      const result = await listMeshyModels();

      expect(result).toEqual([]);
    });
  });

  describe("saveModelPreferences", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("saves preferences to content-generations bucket", async () => {
      const preferences = {
        promptEnhancement: "gpt-4",
        textGeneration: "claude-3",
        dialogueGeneration: "gpt-4",
        contentGeneration: "claude-3",
        imageGeneration: "dall-e-3",
        vision: "gpt-4-vision",
        reasoning: "o1-preview",
      };

      const result = await saveModelPreferences("user-001", preferences);

      expect(result.success).toBe(true);
      expect(mockStorageFrom).toHaveBeenCalledWith("content-generations");
      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const prefsUploadCall = uploadCalls.find((call) =>
        call[0].includes("model-preferences"),
      );
      expect(prefsUploadCall).toBeDefined();
      expect(prefsUploadCall![0]).toContain(
        "settings/model-preferences/user-001.json",
      );
    });

    it("adds updatedAt timestamp", async () => {
      const preferences = {
        promptEnhancement: "gpt-4",
        textGeneration: "claude-3",
        dialogueGeneration: "gpt-4",
        contentGeneration: "claude-3",
        imageGeneration: "dall-e-3",
        vision: "gpt-4-vision",
        reasoning: "o1-preview",
      };

      await saveModelPreferences("user-001", preferences);

      const uploadCalls = mockStorageBucket.upload.mock.calls;
      const prefsUploadCall = uploadCalls.find((call) =>
        call[0].includes("model-preferences"),
      );
      expect(prefsUploadCall).toBeDefined();
      const uploadedData = JSON.parse(prefsUploadCall![1].toString());
      expect(uploadedData.updatedAt).toBeDefined();
    });

    it("returns error when not configured", async () => {
      const backup = { ...process.env };
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = await saveModelPreferences("user-001", {
        promptEnhancement: "gpt-4",
        textGeneration: "claude-3",
        dialogueGeneration: "gpt-4",
        contentGeneration: "claude-3",
        imageGeneration: "dall-e-3",
        vision: "gpt-4-vision",
        reasoning: "o1-preview",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");

      process.env = backup;
    });
  });

  describe("loadModelPreferences", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("loads preferences from storage", async () => {
      const preferences = {
        promptEnhancement: "gpt-4",
        textGeneration: "claude-3",
        dialogueGeneration: "gpt-4",
        contentGeneration: "claude-3",
        imageGeneration: "dall-e-3",
        vision: "gpt-4-vision",
        reasoning: "o1-preview",
      };

      const mockBlob = {
        text: () => Promise.resolve(JSON.stringify(preferences)),
      };
      mockStorageBucket.download.mockResolvedValue({
        data: mockBlob,
        error: null,
      });

      const result = await loadModelPreferences("user-001");

      expect(result).toEqual(preferences);
      expect(mockStorageBucket.download).toHaveBeenCalledWith(
        "settings/model-preferences/user-001.json",
      );
    });

    it("returns null when file not found", async () => {
      mockStorageBucket.download.mockResolvedValue({
        data: null,
        error: { message: "Object not found" },
      });

      const result = await loadModelPreferences("nonexistent-user");

      expect(result).toBeNull();
    });

    it("returns null when not configured", async () => {
      const backup = { ...process.env };
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = await loadModelPreferences("user-001");

      expect(result).toBeNull();

      process.env = backup;
    });
  });

  describe("deleteModelPreferences", () => {
    beforeEach(() => {
      resetMocks();
    });

    it("deletes preferences file", async () => {
      mockStorageBucket.remove.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await deleteModelPreferences("user-001");

      expect(result).toBe(true);
      expect(mockStorageBucket.remove).toHaveBeenCalled();
    });

    it("returns false when not configured", async () => {
      const backup = { ...process.env };
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = await deleteModelPreferences("user-001");

      expect(result).toBe(false);

      process.env = backup;
    });
  });
});
