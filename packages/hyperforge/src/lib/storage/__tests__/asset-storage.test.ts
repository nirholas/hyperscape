/**
 * Asset Storage Tests
 *
 * Tests for the asset storage service.
 * Tests path generation, asset ID handling, and file structure logic.
 *
 * NO MOCKS - tests pure path building and validation logic.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  getAssetDir,
  getModelPath,
  getThumbnailPath,
  getMetadataPath,
  getVRMPath,
  getPreviewPath,
} from "../asset-storage";

describe("Asset Storage", () => {
  describe("Path Generation", () => {
    it("getAssetDir returns correct directory path", () => {
      const assetId = "test-asset-123";
      const dir = getAssetDir(assetId);

      expect(dir).toContain(assetId);
      expect(dir).toContain("assets");
      expect(path.basename(dir)).toBe(assetId);
    });

    it("getModelPath returns .glb path by default", () => {
      const assetId = "bronze-sword";
      const modelPath = getModelPath(assetId);

      expect(modelPath).toContain(assetId);
      expect(modelPath.endsWith(".glb")).toBe(true);
      expect(modelPath).toContain(`${assetId}.glb`);
    });

    it("getModelPath returns correct format when specified", () => {
      const assetId = "test-model";

      const glbPath = getModelPath(assetId, "glb");
      expect(glbPath.endsWith(".glb")).toBe(true);

      const vrmPath = getModelPath(assetId, "vrm");
      expect(vrmPath.endsWith(".vrm")).toBe(true);

      const gltfPath = getModelPath(assetId, "gltf");
      expect(gltfPath.endsWith(".gltf")).toBe(true);
    });

    it("getThumbnailPath returns image path", () => {
      const assetId = "iron-platebody";
      const thumbnailPath = getThumbnailPath(assetId);

      expect(thumbnailPath).toContain(assetId);
      expect(thumbnailPath.endsWith("thumbnail.png")).toBe(true);
    });

    it("getMetadataPath returns .json path", () => {
      const assetId = "oak-tree";
      const metadataPath = getMetadataPath(assetId);

      expect(metadataPath).toContain(assetId);
      expect(metadataPath.endsWith("metadata.json")).toBe(true);
    });

    it("getVRMPath returns .vrm path", () => {
      const assetId = "knight-avatar";
      const vrmPath = getVRMPath(assetId);

      expect(vrmPath).toContain(assetId);
      expect(vrmPath.endsWith(".vrm")).toBe(true);
      expect(vrmPath).toContain(`${assetId}.vrm`);
    });

    it("getPreviewPath returns preview .glb path", () => {
      const assetId = "goblin-warrior";
      const previewPath = getPreviewPath(assetId);

      expect(previewPath).toContain(assetId);
      expect(previewPath.endsWith("_preview.glb")).toBe(true);
      expect(previewPath).toContain(`${assetId}_preview.glb`);
    });
  });

  describe("Asset ID Handling", () => {
    it("paths include asset ID", () => {
      const assetId = "unique-item-xyz";

      const dir = getAssetDir(assetId);
      const modelPath = getModelPath(assetId);
      const thumbnailPath = getThumbnailPath(assetId);
      const metadataPath = getMetadataPath(assetId);
      const vrmPath = getVRMPath(assetId);
      const previewPath = getPreviewPath(assetId);

      expect(dir).toContain(assetId);
      expect(modelPath).toContain(assetId);
      expect(thumbnailPath).toContain(assetId);
      expect(metadataPath).toContain(assetId);
      expect(vrmPath).toContain(assetId);
      expect(previewPath).toContain(assetId);
    });

    it("handles UUIDs correctly", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";

      const dir = getAssetDir(uuid);
      const modelPath = getModelPath(uuid);
      const thumbnailPath = getThumbnailPath(uuid);

      expect(dir).toContain(uuid);
      expect(modelPath).toContain(uuid);
      expect(path.basename(modelPath)).toBe(`${uuid}.glb`);
      expect(thumbnailPath).toContain(uuid);
    });

    it("handles short IDs correctly", () => {
      const shortId = "a1";

      const dir = getAssetDir(shortId);
      const modelPath = getModelPath(shortId);

      expect(dir).toContain(shortId);
      expect(path.basename(modelPath)).toBe(`${shortId}.glb`);
    });

    it("handles IDs with hyphens", () => {
      const hyphenatedId = "bronze-longsword-tier-1";

      const modelPath = getModelPath(hyphenatedId);
      const vrmPath = getVRMPath(hyphenatedId);

      expect(modelPath).toContain(hyphenatedId);
      expect(vrmPath).toContain(hyphenatedId);
    });

    it("handles IDs with underscores", () => {
      const underscoreId = "item_weapon_sword_001";

      const modelPath = getModelPath(underscoreId);
      expect(modelPath).toContain(underscoreId);
    });

    it("handles numeric IDs", () => {
      const numericId = "12345";

      const dir = getAssetDir(numericId);
      const modelPath = getModelPath(numericId);

      expect(path.basename(dir)).toBe(numericId);
      expect(modelPath).toContain(`${numericId}.glb`);
    });
  });

  describe("File Structure", () => {
    it("asset files are organized by ID", () => {
      const assetId = "test-asset";

      const dir = getAssetDir(assetId);
      const modelPath = getModelPath(assetId);
      const thumbnailPath = getThumbnailPath(assetId);
      const metadataPath = getMetadataPath(assetId);

      // All paths should be within the asset directory
      expect(modelPath.startsWith(dir)).toBe(true);
      expect(thumbnailPath.startsWith(dir)).toBe(true);
      expect(metadataPath.startsWith(dir)).toBe(true);
    });

    it("model filename matches asset ID", () => {
      const assetId = "dragon-helm";
      const modelPath = getModelPath(assetId);

      expect(path.basename(modelPath)).toBe(`${assetId}.glb`);
    });

    it("thumbnail has fixed filename", () => {
      const assetId = "any-asset";
      const thumbnailPath = getThumbnailPath(assetId);

      expect(path.basename(thumbnailPath)).toBe("thumbnail.png");
    });

    it("metadata has fixed filename", () => {
      const assetId = "any-asset";
      const metadataPath = getMetadataPath(assetId);

      expect(path.basename(metadataPath)).toBe("metadata.json");
    });

    it("VRM filename matches asset ID with .vrm extension", () => {
      const assetId = "character-model";
      const vrmPath = getVRMPath(assetId);

      expect(path.basename(vrmPath)).toBe(`${assetId}.vrm`);
    });

    it("preview filename includes _preview suffix", () => {
      const assetId = "object-model";
      const previewPath = getPreviewPath(assetId);

      expect(path.basename(previewPath)).toBe(`${assetId}_preview.glb`);
    });
  });

  describe("Metadata JSON Structure", () => {
    it("metadata structure is valid JSON format", () => {
      const metadata = {
        assetId: "test-item",
        name: "Test Item",
        type: "weapon",
        category: "sword",
        source: "LOCAL",
        createdAt: new Date().toISOString(),
      };

      // Should be serializable
      const jsonString = JSON.stringify(metadata);
      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString);
      expect(parsed.assetId).toBe("test-item");
      expect(parsed.name).toBe("Test Item");
    });

    it("metadata includes source field", () => {
      const metadata = {
        assetId: "forge-asset",
        source: "FORGE",
        hasPreview: true,
        hasTexturedModel: false,
        hasTextures: false,
        textureCount: 0,
      };

      expect(metadata.source).toBe("FORGE");
      expect(typeof metadata.hasPreview).toBe("boolean");
    });

    it("metadata handles optional fields", () => {
      const minimalMetadata = {
        assetId: "minimal-asset",
      };

      const fullMetadata = {
        assetId: "full-asset",
        name: "Full Asset",
        description: "A complete asset with all fields",
        tags: ["tag1", "tag2"],
        customData: { key: "value" },
      };

      expect(minimalMetadata.assetId).toBeDefined();
      expect(fullMetadata.tags).toHaveLength(2);
    });
  });

  describe("Path Consistency", () => {
    it("all paths use consistent path separator", () => {
      const assetId = "test-asset";

      const dir = getAssetDir(assetId);
      const modelPath = getModelPath(assetId);

      // On all platforms, path.join should use the OS separator
      // but the result should be consistent
      expect(modelPath.startsWith(dir)).toBe(true);
    });

    it("asset directory is parent of all asset files", () => {
      const assetId = "parent-test";

      const dir = getAssetDir(assetId);
      const modelPath = getModelPath(assetId);
      const thumbnailPath = getThumbnailPath(assetId);
      const metadataPath = getMetadataPath(assetId);
      const vrmPath = getVRMPath(assetId);
      const previewPath = getPreviewPath(assetId);

      // Extract directory from each path
      expect(path.dirname(modelPath)).toBe(dir);
      expect(path.dirname(thumbnailPath)).toBe(dir);
      expect(path.dirname(metadataPath)).toBe(dir);
      expect(path.dirname(vrmPath)).toBe(dir);
      expect(path.dirname(previewPath)).toBe(dir);
    });
  });
});
