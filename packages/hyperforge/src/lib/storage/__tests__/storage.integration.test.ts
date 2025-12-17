/**
 * Storage Integration Tests
 *
 * Integration tests for asset-storage and supabase-storage services.
 * Tests actual service functions with mocked external dependencies.
 *
 * Coverage targets:
 * - asset-storage.ts: File operations, path building, validation
 * - supabase-storage.ts: Bucket operations, upload/download logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mock Setup - vi.mock is hoisted, so use inline object definitions
// ============================================================================

// Mock fs/promises - must use factory that returns static object
vi.mock("fs", () => {
  return {
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
      stat: vi.fn(),
      rm: vi.fn(),
      readdir: vi.fn(),
      copyFile: vi.fn(),
    },
  };
});

// Mock Supabase
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn(() => ({
      storage: {
        from: vi.fn(() => ({
          list: vi.fn(),
          upload: vi.fn(),
          download: vi.fn(),
          remove: vi.fn(),
          getPublicUrl: vi.fn(),
        })),
      },
    })),
  };
});

// Mock logger to avoid noise
vi.mock("@/lib/utils", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Stub global fetch
vi.stubGlobal("fetch", vi.fn());

// Import mocked fs module - vi.mock hoists before this import
import * as fsModule from "fs";

// Get mocked functions with proper typing using vi.mocked
const fsMock = vi.mocked(fsModule.promises);

// Get fetch mock
const fetchMock = vi.mocked(global.fetch);

/**
 * Helper to reset all mocks with default successful behavior
 */
function resetMocks(): void {
  vi.clearAllMocks();

  // Reset fs mocks with default successful behavior
  fsMock.mkdir.mockReset().mockResolvedValue(undefined);
  fsMock.writeFile.mockReset().mockResolvedValue(undefined);
  fsMock.readFile.mockReset().mockResolvedValue(Buffer.from("") as never);
  fsMock.access.mockReset().mockResolvedValue(undefined);
  fsMock.stat.mockReset().mockResolvedValue({ size: 0 } as never);
  fsMock.rm.mockReset().mockResolvedValue(undefined);
  fsMock.readdir.mockReset().mockResolvedValue([] as never);
  fsMock.copyFile.mockReset().mockResolvedValue(undefined);

  // Reset fetch mock
  fetchMock.mockReset();
}

/**
 * Clear all Supabase environment variables
 */
function clearSupabaseEnv(): void {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

// ============================================================================
// Import modules AFTER mock setup
// ============================================================================

import {
  ensureAssetsDir,
  ensureAssetDir,
  saveAssetFiles,
  readAssetModel,
  readAssetThumbnail,
  readAssetMetadata,
  assetExists,
  getAssetFileSize,
  deleteAssetFiles,
  copyAssetFiles,
  downloadFile,
  downloadAndSaveModel,
  listAssetIds,
  getAssetDir,
} from "../asset-storage";

import { isSupabaseConfigured, BUCKET_NAMES } from "../supabase-storage";

// ============================================================================
// Asset Storage Tests
// ============================================================================

describe("Asset Storage Integration", () => {
  beforeEach(() => {
    delete process.env.HYPERFORGE_ASSETS_DIR;
    clearSupabaseEnv();
    resetMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureAssetsDir", () => {
    it("creates the assets directory", async () => {
      await ensureAssetsDir();

      expect(fsMock.mkdir).toHaveBeenCalledWith(
        expect.stringContaining("assets"),
        { recursive: true },
      );
    });

    it("handles existing directory", async () => {
      fsMock.mkdir.mockResolvedValueOnce(undefined);

      await ensureAssetsDir();

      expect(fsMock.mkdir).toHaveBeenCalled();
    });
  });

  describe("ensureAssetDir", () => {
    it("creates asset-specific directory", async () => {
      const assetId = "test-asset-123";

      const dir = await ensureAssetDir(assetId);

      expect(fsMock.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(assetId),
        { recursive: true },
      );
      expect(dir).toContain(assetId);
    });

    it("returns the directory path", async () => {
      const assetId = "unique-asset-id";

      const dir = await ensureAssetDir(assetId);
      const expectedDir = getAssetDir(assetId);

      expect(dir).toBe(expectedDir);
    });
  });

  describe("saveAssetFiles (local filesystem)", () => {
    it("saves model file to local filesystem", async () => {
      const assetId = "local-model-asset";
      const modelBuffer = Buffer.from("mock GLB data");

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        modelFormat: "glb",
      });

      expect(fsMock.mkdir).toHaveBeenCalled();
      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${assetId}.glb`),
        expect.any(Buffer),
      );
      expect(result.modelPath).toContain(assetId);
      expect(result.modelUrl).toContain(`/api/assets/${assetId}/model.glb`);
    });

    it("saves thumbnail when provided", async () => {
      const assetId = "thumbnail-asset";
      const modelBuffer = Buffer.from("mock GLB");
      const thumbnailBuffer = Buffer.from("mock PNG thumbnail");

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        thumbnailBuffer,
      });

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("thumbnail.png"),
        expect.any(Buffer),
      );
      expect(result.thumbnailPath).toContain("thumbnail.png");
      expect(result.thumbnailUrl).toContain(
        `/api/assets/${assetId}/thumbnail.png`,
      );
    });

    it("saves VRM file when provided", async () => {
      const assetId = "vrm-asset";
      const modelBuffer = Buffer.from("mock GLB");
      const vrmBuffer = Buffer.from("mock VRM data");

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        vrmBuffer,
      });

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${assetId}.vrm`),
        expect.any(Buffer),
      );
      expect(result.vrmPath).toContain(".vrm");
      expect(result.vrmUrl).toContain(`/api/assets/${assetId}/model.vrm`);
    });

    it("saves preview model when provided", async () => {
      const assetId = "preview-asset";
      const modelBuffer = Buffer.from("mock GLB");
      const previewBuffer = Buffer.from("mock preview GLB");

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        previewBuffer,
      });

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("_preview.glb"),
        expect.any(Buffer),
      );
      expect(result.previewPath).toContain("_preview.glb");
      expect(result.previewUrl).toContain(`/api/assets/${assetId}/preview.glb`);
    });

    it("saves metadata JSON when provided", async () => {
      const assetId = "metadata-asset";
      const modelBuffer = Buffer.from("mock GLB");
      const metadata = { name: "Test Asset", type: "weapon" };

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        metadata,
      });

      // Find the metadata.json write call
      const metadataCall = fsMock.writeFile.mock.calls.find(
        (call: [string, unknown]) => call[0].includes("metadata.json"),
      );
      expect(metadataCall).toBeDefined();
      // Check for pretty-printed JSON (with spaces)
      expect(metadataCall![1]).toContain('"name": "Test Asset"');
      expect(result.metadataPath).toContain("metadata.json");
    });

    it("handles ArrayBuffer input", async () => {
      const assetId = "arraybuffer-asset";
      const modelArrayBuffer = new ArrayBuffer(16);

      const result = await saveAssetFiles({
        assetId,
        modelBuffer: modelArrayBuffer,
      });

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${assetId}.glb`),
        expect.any(Buffer),
      );
      expect(result.modelPath).toBeDefined();
    });

    it("uses VRM format when specified", async () => {
      const assetId = "vrm-format-asset";
      const modelBuffer = Buffer.from("mock VRM data");

      const result = await saveAssetFiles({
        assetId,
        modelBuffer,
        modelFormat: "vrm",
      });

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${assetId}.vrm`),
        expect.any(Buffer),
      );
      expect(result.modelUrl).toContain("model.vrm");
    });
  });

  describe("readAssetModel", () => {
    it("reads model file from filesystem", async () => {
      const mockModelData = Buffer.from("mock GLB content");
      fsMock.readFile.mockResolvedValueOnce(mockModelData);

      const result = await readAssetModel("test-asset", "glb");

      expect(fsMock.readFile).toHaveBeenCalledWith(
        expect.stringContaining("test-asset.glb"),
      );
      expect(result).toEqual(mockModelData);
    });

    it("reads VRM format", async () => {
      fsMock.readFile.mockResolvedValueOnce(Buffer.from("VRM data"));

      await readAssetModel("avatar-model", "vrm");

      expect(fsMock.readFile).toHaveBeenCalledWith(
        expect.stringContaining("avatar-model.vrm"),
      );
    });

    it("throws error when file not found", async () => {
      fsMock.readFile.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(readAssetModel("missing-asset")).rejects.toThrow("ENOENT");
    });
  });

  describe("readAssetThumbnail", () => {
    it("reads thumbnail file", async () => {
      const mockThumbnail = Buffer.from("mock PNG data");
      fsMock.readFile.mockResolvedValueOnce(mockThumbnail);

      const result = await readAssetThumbnail("test-asset");

      expect(fsMock.readFile).toHaveBeenCalledWith(
        expect.stringContaining("thumbnail.png"),
      );
      expect(result).toEqual(mockThumbnail);
    });
  });

  describe("readAssetMetadata", () => {
    it("reads metadata from local filesystem", async () => {
      const metadataContent = JSON.stringify({ name: "Test", type: "weapon" });
      fsMock.readFile.mockResolvedValueOnce(metadataContent);

      const result = await readAssetMetadata("test-asset");

      expect(fsMock.readFile).toHaveBeenCalledWith(
        expect.stringContaining("metadata.json"),
        "utf-8",
      );
      expect(result).toEqual({ name: "Test", type: "weapon" });
    });

    it("returns null when metadata file not found", async () => {
      fsMock.readFile.mockRejectedValueOnce(new Error("ENOENT"));

      const result = await readAssetMetadata("missing-asset");

      expect(result).toBeNull();
    });
  });

  describe("assetExists", () => {
    it("returns true when asset directory exists", async () => {
      fsMock.access.mockResolvedValueOnce(undefined);

      const result = await assetExists("existing-asset");

      expect(result).toBe(true);
      expect(fsMock.access).toHaveBeenCalledWith(
        expect.stringContaining("existing-asset"),
      );
    });

    it("returns false when asset directory does not exist", async () => {
      fsMock.access.mockRejectedValueOnce(new Error("ENOENT"));

      const result = await assetExists("nonexistent-asset");

      expect(result).toBe(false);
    });
  });

  describe("getAssetFileSize", () => {
    it("returns file size in bytes", async () => {
      fsMock.stat.mockResolvedValueOnce({ size: 1024000 });

      const result = await getAssetFileSize("test-asset", "glb");

      expect(result).toBe(1024000);
      expect(fsMock.stat).toHaveBeenCalledWith(
        expect.stringContaining("test-asset.glb"),
      );
    });

    it("throws error when file not found", async () => {
      fsMock.stat.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(getAssetFileSize("missing-asset")).rejects.toThrow("ENOENT");
    });
  });

  describe("deleteAssetFiles", () => {
    it("handles non-existent directory gracefully", async () => {
      fsMock.rm.mockReset().mockRejectedValue(new Error("ENOENT"));

      // Should not throw
      await expect(deleteAssetFiles("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("downloadFile", () => {
    it("downloads file from URL and returns Buffer", async () => {
      const mockData = new ArrayBuffer(100);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockData),
      });

      const result = await downloadFile("https://example.com/model.glb");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/model.glb",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(100);
    });

    it("throws error on failed download", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      });

      await expect(
        downloadFile("https://example.com/missing.glb"),
      ).rejects.toThrow("Failed to download file: Not Found");
    });

    it("respects timeout parameter", async () => {
      // Mock fetch that never resolves
      fetchMock.mockImplementationOnce(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );

      await expect(
        downloadFile("https://slow.com/file.glb", 100),
      ).rejects.toThrow();
    });
  });

  describe("downloadAndSaveModel", () => {
    it("handles VRM URLs correctly", async () => {
      // Reset all mocks before test
      resetMocks();

      const mockVRMData = new ArrayBuffer(600);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockVRMData),
      });

      const result = await downloadAndSaveModel(
        "vrm-download",
        "https://example.com/model.vrm",
      );

      expect(result.modelPath).toContain(".vrm");
    });

    it("continues when thumbnail download fails", async () => {
      // Reset all mocks before test
      resetMocks();

      const mockModelData = new ArrayBuffer(500);

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockModelData),
        })
        .mockRejectedValueOnce(new Error("Thumbnail failed"));

      const result = await downloadAndSaveModel(
        "no-thumb",
        "https://example.com/model.glb",
        "https://example.com/thumb.png",
      );

      expect(result.modelPath).toBeDefined();
      expect(result.thumbnailPath).toBeUndefined();
    });
  });

  describe("listAssetIds", () => {
    it("returns array of asset IDs from directory", async () => {
      const mockEntries = [
        { name: "asset-1", isDirectory: () => true },
        { name: "asset-2", isDirectory: () => true },
        { name: "file.txt", isDirectory: () => false },
      ];
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.readdir.mockResolvedValueOnce(mockEntries);

      const result = await listAssetIds();

      expect(result).toContain("asset-1");
      expect(result).toContain("asset-2");
      expect(result).not.toContain("file.txt");
    });

    it("excludes special directories", async () => {
      const mockEntries = [
        { name: "asset-1", isDirectory: () => true },
        { name: "audio", isDirectory: () => true },
        { name: "sprites", isDirectory: () => true },
        { name: "temp", isDirectory: () => true },
        { name: ".DS_Store", isDirectory: () => true },
      ];
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.readdir.mockResolvedValueOnce(mockEntries);

      const result = await listAssetIds();

      expect(result).toContain("asset-1");
      expect(result).not.toContain("audio");
      expect(result).not.toContain("sprites");
      expect(result).not.toContain("temp");
      expect(result).not.toContain(".DS_Store");
    });

    it("returns empty array on error", async () => {
      fsMock.mkdir.mockRejectedValueOnce(new Error("Permission denied"));

      const result = await listAssetIds();

      expect(result).toEqual([]);
    });
  });
});

// ============================================================================
// Supabase Storage Tests
// ============================================================================

describe("Supabase Storage Integration", () => {
  beforeEach(() => {
    clearSupabaseEnv();
    resetMocks();
  });

  afterEach(() => {
    clearSupabaseEnv();
    vi.clearAllMocks();
  });

  describe("isSupabaseConfigured", () => {
    it("returns true when SUPABASE_URL and SUPABASE_SECRET_KEY are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SECRET_KEY = "sb_secret_test123";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns true when NEXT_PUBLIC_SUPABASE_URL is set", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "anon_key_test";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("returns false when no credentials configured", () => {
      clearSupabaseEnv();

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("returns false when only URL is configured", () => {
      clearSupabaseEnv();
      process.env.SUPABASE_URL = "https://test.supabase.co";

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("returns false when only key is configured", () => {
      clearSupabaseEnv();
      process.env.SUPABASE_SECRET_KEY = "sb_secret_test123";

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("supports legacy SUPABASE_ANON_KEY", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "legacy_anon_key";

      expect(isSupabaseConfigured()).toBe(true);
    });

    it("supports SUPABASE_SERVICE_KEY", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_KEY = "service_key_test";

      expect(isSupabaseConfigured()).toBe(true);
    });
  });

  describe("Bucket Configuration", () => {
    it("defines all 6 required buckets", () => {
      expect(Object.keys(BUCKET_NAMES)).toHaveLength(6);
    });

    it("includes image generation bucket", () => {
      expect(BUCKET_NAMES.IMAGE_GENERATION).toBe("image-generation");
    });

    it("includes audio generations bucket", () => {
      expect(BUCKET_NAMES.AUDIO_GENERATIONS).toBe("audio-generations");
    });

    it("includes content generations bucket", () => {
      expect(BUCKET_NAMES.CONTENT_GENERATIONS).toBe("content-generations");
    });

    it("includes meshy models bucket", () => {
      expect(BUCKET_NAMES.MESHY_MODELS).toBe("meshy-models");
    });

    it("includes VRM conversion bucket", () => {
      expect(BUCKET_NAMES.VRM_CONVERSION).toBe("vrm-conversion");
    });

    it("includes concept art bucket", () => {
      expect(BUCKET_NAMES.CONCEPT_ART).toBe("concept-art-pipeline");
    });

    it("bucket names are valid identifiers (lowercase with hyphens)", () => {
      const validBucketPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;

      Object.values(BUCKET_NAMES).forEach((bucketName) => {
        expect(bucketName).toMatch(validBucketPattern);
      });
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  beforeEach(() => {
    clearSupabaseEnv();
    resetMocks();
  });

  afterEach(() => {
    clearSupabaseEnv();
    vi.clearAllMocks();
  });

  describe("Asset Storage Error Handling", () => {
    it("handles mkdir permission error", async () => {
      resetMocks();
      fsMock.mkdir.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(ensureAssetDir("error-test-asset")).rejects.toThrow(
        "permission denied",
      );
    });

    it("handles write file error", async () => {
      resetMocks();
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.writeFile.mockRejectedValue(new Error("ENOSPC: no space left"));

      await expect(
        saveAssetFiles({
          assetId: "write-error-test",
          modelBuffer: Buffer.from("data"),
        }),
      ).rejects.toThrow("no space left");
    });
  });

  describe("File operation error handling", () => {
    it("handles readFile error", async () => {
      fsMock.readFile.mockRejectedValueOnce(
        new Error("EPERM: permission denied"),
      );

      await expect(readAssetModel("permission-error-asset")).rejects.toThrow(
        "EPERM",
      );
    });

    it("handles stat error", async () => {
      fsMock.stat.mockRejectedValueOnce(new Error("ENOENT: file not found"));

      await expect(getAssetFileSize("missing-file-asset")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("handles readdir error gracefully", async () => {
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.readdir.mockRejectedValueOnce(new Error("EACCES"));

      const result = await listAssetIds();

      expect(result).toEqual([]);
    });
  });
});
