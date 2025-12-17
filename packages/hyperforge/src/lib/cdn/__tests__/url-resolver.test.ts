/**
 * URL Resolver Tests
 *
 * Tests for the CDN URL resolver utilities.
 * Tests URL building, protocol resolution, and path handling.
 *
 * Real Issues to Surface:
 * - asset:// protocol not resolving correctly
 * - CDN URL misconfiguration
 * - Path building errors
 * - Query parameter loss
 */

import { describe, it, expect } from "vitest";
import {
  getAssetModelUrl,
  getAssetThumbnailUrl,
  getCDNBaseUrl,
} from "../url-resolver";
import type {
  HyperForgeAsset,
  CDNAsset,
  LocalAsset,
  BaseTemplateAsset,
} from "@/types";

describe("URL Resolver", () => {
  describe("URL Resolution - asset:// Protocol", () => {
    const CDN_BASE = getCDNBaseUrl();

    it("resolves asset:// URLs to CDN paths for CDN assets", () => {
      const asset: CDNAsset = {
        id: "bronze-sword",
        name: "Bronze Sword",
        source: "CDN",
        category: "weapon",
        modelPath: "asset://items/weapons/bronze-sword.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe(`${CDN_BASE}/items/weapons/bronze-sword.glb`);
      expect(url).not.toContain("asset://");
    });

    it("resolves relative paths for CDN assets", () => {
      const asset: CDNAsset = {
        id: "iron-helm",
        name: "Iron Helm",
        source: "CDN",
        category: "armor",
        modelPath: "items/armor/iron-helm.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe(`${CDN_BASE}/items/armor/iron-helm.glb`);
      expect(url).toMatch(/^https?:\/\//);
    });

    it("resolves asset:// URLs in base assets", () => {
      const asset: BaseTemplateAsset = {
        id: "forest-biome",
        name: "Forest Biome",
        source: "BASE",
        category: "environment",
        modelPath: "asset://biomes/forest.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe(`${CDN_BASE}/biomes/forest.glb`);
    });

    it("preserves external URLs in base assets", () => {
      const asset: BaseTemplateAsset = {
        id: "external-model",
        name: "External Model",
        source: "BASE",
        category: "prop",
        modelPath: "models/external/prop.glb",
      };

      const url = getAssetModelUrl(asset);

      // Non-asset:// paths are returned as-is for BASE assets
      expect(url).toBe("models/external/prop.glb");
    });
  });

  describe("Path Building", () => {
    const CDN_BASE = getCDNBaseUrl();

    it("builds correct CDN paths for weapons", () => {
      const asset: CDNAsset = {
        id: "dragon-scimitar",
        name: "Dragon Scimitar",
        source: "CDN",
        category: "weapon",
        modelPath: "items/weapons/dragon-scimitar.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("dragon-scimitar.glb");
      expect(url).toBe(`${CDN_BASE}/items/weapons/dragon-scimitar.glb`);
    });

    it("builds correct CDN paths for NPCs", () => {
      const asset: CDNAsset = {
        id: "goblin-warrior",
        name: "Goblin Warrior",
        source: "CDN",
        category: "npc",
        modelPath: "npcs/monsters/goblin-warrior.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("goblin-warrior.glb");
      expect(url).toBe(`${CDN_BASE}/npcs/monsters/goblin-warrior.glb`);
    });

    it("builds correct CDN paths for resources", () => {
      const asset: CDNAsset = {
        id: "oak-tree",
        name: "Oak Tree",
        source: "CDN",
        category: "resource",
        modelPath: "resources/trees/oak.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("oak.glb");
      expect(url).toBe(`${CDN_BASE}/resources/trees/oak.glb`);
    });

    it("handles paths with special characters", () => {
      const asset: CDNAsset = {
        id: "sword-of-fire",
        name: "Sword of Fire",
        source: "CDN",
        category: "weapon",
        modelPath: "items/weapons/sword%20of%20fire.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("%20");
      expect(url).toBe(`${CDN_BASE}/items/weapons/sword%20of%20fire.glb`);
    });

    it("handles nested folder paths", () => {
      const asset: CDNAsset = {
        id: "ancient-rune",
        name: "Ancient Rune",
        source: "CDN",
        category: "prop",
        modelPath: "items/props/magic/runes/ancient-rune.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe(`${CDN_BASE}/items/props/magic/runes/ancient-rune.glb`);
    });
  });

  describe("Environment Handling - Dev vs Production", () => {
    it("returns CDN base URL", () => {
      const cdnUrl = getCDNBaseUrl();

      expect(cdnUrl).toBeDefined();
      expect(typeof cdnUrl).toBe("string");
      expect(cdnUrl.length).toBeGreaterThan(0);
    });

    it("CDN base URL is valid URL format", () => {
      const cdnUrl = getCDNBaseUrl();

      // Should be http:// or https://
      expect(cdnUrl).toMatch(/^https?:\/\//);
    });

    it("uses local API paths for LOCAL assets", () => {
      const asset: LocalAsset = {
        id: "custom-sword-123",
        name: "Custom Sword",
        source: "LOCAL",
        category: "weapon",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe("/api/assets/custom-sword-123/model.glb");
      expect(url).toContain("/api/assets/");
      expect(url).toContain(asset.id);
    });

    it("API paths include .glb extension", () => {
      const asset: LocalAsset = {
        id: "test-model-456",
        name: "Test Model",
        source: "LOCAL",
        category: "prop",
      };

      const url = getAssetModelUrl(asset);

      expect(url.endsWith(".glb")).toBe(true);
    });

    it("differentiates CDN from LOCAL asset paths", () => {
      const cdnAsset: CDNAsset = {
        id: "cdn-sword",
        name: "CDN Sword",
        source: "CDN",
        category: "weapon",
        modelPath: "items/sword.glb",
      };

      const localAsset: LocalAsset = {
        id: "local-sword",
        name: "Local Sword",
        source: "LOCAL",
        category: "weapon",
      };

      const cdnUrl = getAssetModelUrl(cdnAsset);
      const localUrl = getAssetModelUrl(localAsset);

      expect(cdnUrl).toMatch(/^https?:\/\//);
      expect(localUrl).toMatch(/^\/api\//);
      expect(cdnUrl).not.toBe(localUrl);
    });
  });

  describe("Query Parameters", () => {
    const CDN_BASE = getCDNBaseUrl();

    it("preserves query parameters in CDN paths", () => {
      const asset: CDNAsset = {
        id: "versioned-sword",
        name: "Versioned Sword",
        source: "CDN",
        category: "weapon",
        modelPath: "items/sword.glb?v=1.0&cache=false",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("?v=1.0");
      expect(url).toContain("&cache=false");
      expect(url).toBe(`${CDN_BASE}/items/sword.glb?v=1.0&cache=false`);
    });

    it("preserves hash fragments", () => {
      const asset: CDNAsset = {
        id: "anchored-model",
        name: "Anchored Model",
        source: "CDN",
        category: "prop",
        modelPath: "items/model.glb#section",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("#section");
    });

    it("handles complex query strings", () => {
      const asset: CDNAsset = {
        id: "complex-params",
        name: "Complex Params",
        source: "CDN",
        category: "prop",
        modelPath: "items/model.glb?version=2.0&format=glb&quality=high",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("version=2.0");
      expect(url).toContain("format=glb");
      expect(url).toContain("quality=high");
    });
  });

  describe("Thumbnail URL Resolution", () => {
    const CDN_BASE = getCDNBaseUrl();

    it("resolves asset:// protocol in thumbnails", () => {
      const asset: CDNAsset = {
        id: "sword",
        name: "Sword",
        source: "CDN",
        category: "weapon",
        modelPath: "items/sword.glb",
        thumbnailPath: "asset://thumbnails/sword.png",
      };

      const url = getAssetThumbnailUrl(asset);

      expect(url).toBe(`${CDN_BASE}/thumbnails/sword.png`);
      expect(url).not.toContain("asset://");
    });

    it("returns undefined for missing thumbnails", () => {
      const asset: CDNAsset = {
        id: "no-thumb",
        name: "No Thumbnail",
        source: "CDN",
        category: "prop",
        modelPath: "items/prop.glb",
      };

      const url = getAssetThumbnailUrl(asset);

      expect(url).toBeUndefined();
    });

    it("preserves http/https URLs", () => {
      const asset: CDNAsset = {
        id: "external-thumb",
        name: "External Thumbnail",
        source: "CDN",
        category: "weapon",
        modelPath: "items/sword.glb",
        thumbnailPath: "https://example.com/thumb.png",
      };

      const url = getAssetThumbnailUrl(asset);

      expect(url).toBe("https://example.com/thumb.png");
    });

    it("resolves relative thumbnail paths", () => {
      const asset: CDNAsset = {
        id: "relative-thumb",
        name: "Relative Thumbnail",
        source: "CDN",
        category: "weapon",
        modelPath: "items/sword.glb",
        thumbnailPath: "thumbnails/items/sword.png",
      };

      const url = getAssetThumbnailUrl(asset);

      expect(url).toBe(`${CDN_BASE}/thumbnails/items/sword.png`);
    });
  });

  describe("Edge Cases", () => {
    const CDN_BASE = getCDNBaseUrl();

    it("handles empty model path gracefully", () => {
      const asset: CDNAsset = {
        id: "empty-path",
        name: "Empty Path",
        source: "CDN",
        category: "prop",
        modelPath: "",
      };

      const url = getAssetModelUrl(asset);

      // Should still prepend CDN URL
      expect(url).toBe(`${CDN_BASE}/`);
    });

    it("handles model path with leading slash", () => {
      const asset: CDNAsset = {
        id: "leading-slash",
        name: "Leading Slash",
        source: "CDN",
        category: "prop",
        modelPath: "/items/prop.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toBe(`${CDN_BASE}//items/prop.glb`);
    });

    it("handles double slashes in path", () => {
      const asset: CDNAsset = {
        id: "double-slash",
        name: "Double Slash",
        source: "CDN",
        category: "prop",
        modelPath: "items//nested/prop.glb",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain("items//nested");
    });

    it("handles VRM file extension", () => {
      const asset: CDNAsset = {
        id: "avatar",
        name: "Knight Avatar",
        source: "CDN",
        category: "character",
        modelPath: "avatars/knight.vrm",
      };

      const url = getAssetModelUrl(asset);

      expect(url).toContain(".vrm");
      expect(url).toBe(`${CDN_BASE}/avatars/knight.vrm`);
    });

    it("handles multiple asset:// replacements correctly", () => {
      // Only first asset:// should be replaced
      const asset: CDNAsset = {
        id: "weird-path",
        name: "Weird Path",
        source: "CDN",
        category: "prop",
        modelPath: "asset://folder/asset://file.glb",
      };

      const url = getAssetModelUrl(asset);

      // The replace only replaces first occurrence
      expect(url).toBe(`${CDN_BASE}/folder/asset://file.glb`);
    });
  });
});
