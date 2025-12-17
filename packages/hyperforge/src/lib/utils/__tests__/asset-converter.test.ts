/**
 * Asset Converter Tests
 *
 * Tests for converting between different asset formats.
 */

import { describe, it, expect } from "vitest";
import {
  cdnAssetToAssetData,
  type CDNAssetInput,
} from "@/lib/utils/asset-converter";

describe("Asset Converter", () => {
  describe("cdnAssetToAssetData", () => {
    it("converts minimal CDN asset to AssetData", () => {
      const cdnAsset: CDNAssetInput = {
        id: "test-asset-001",
        name: "Bronze Sword",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/swords/bronze-sword.glb",
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.id).toBe("test-asset-001");
      expect(result.name).toBe("Bronze Sword");
      expect(result.source).toBe("CDN");
      expect(result.category).toBe("weapon");
    });

    it("preserves category from CDN asset", () => {
      const weaponAsset: CDNAssetInput = {
        id: "weapon-1",
        name: "Steel Axe",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/axes/steel-axe.glb",
      };

      const armorAsset: CDNAssetInput = {
        id: "armor-1",
        name: "Iron Helmet",
        source: "meshy",
        category: "armor",
        modelPath: "armor/helmets/iron-helmet.glb",
      };

      const characterAsset: CDNAssetInput = {
        id: "char-1",
        name: "Goblin",
        source: "meshy",
        category: "character",
        modelPath: "characters/goblin.glb",
      };

      expect(cdnAssetToAssetData(weaponAsset).category).toBe("weapon");
      expect(cdnAssetToAssetData(armorAsset).category).toBe("armor");
      expect(cdnAssetToAssetData(characterAsset).category).toBe("character");
    });

    it("converts asset with description", () => {
      const cdnAsset: CDNAssetInput = {
        id: "test-002",
        name: "Mithril Sword",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/swords/mithril-sword.glb",
        description: "A legendary mithril blade",
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.description).toBe("A legendary mithril blade");
    });

    it("converts asset with rarity", () => {
      const commonAsset: CDNAssetInput = {
        id: "common-1",
        name: "Wooden Shield",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/shields/wooden-shield.glb",
        rarity: "common",
      };

      const rareAsset: CDNAssetInput = {
        id: "rare-1",
        name: "Dragon Dagger",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/daggers/dragon-dagger.glb",
        rarity: "rare",
      };

      expect(cdnAssetToAssetData(commonAsset).rarity).toBe("common");
      expect(cdnAssetToAssetData(rareAsset).rarity).toBe("rare");
    });

    it("converts asset with model path", () => {
      const cdnAsset: CDNAssetInput = {
        id: "test-003",
        name: "Oak Bow",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/bows/oak-bow.glb",
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.modelPath).toBe("weapons/bows/oak-bow.glb");
    });

    it("converts asset with VRM data", () => {
      const cdnAsset: CDNAssetInput = {
        id: "vrm-asset",
        name: "Hero Character",
        source: "meshy",
        category: "character",
        modelPath: "characters/hero/hero.glb",
        hasVRM: true,
        vrmPath: "characters/hero/hero.vrm",
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.hasVRM).toBe(true);
      expect(result.vrmPath).toBe("characters/hero/hero.vrm");
      expect(result.vrmUrl).toBeDefined();
    });

    it("handles asset without VRM data", () => {
      const cdnAsset: CDNAssetInput = {
        id: "no-vrm",
        name: "Simple Prop",
        source: "meshy",
        category: "prop",
        modelPath: "props/simple-prop.glb",
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.hasVRM).toBeUndefined();
      expect(result.vrmPath).toBeUndefined();
      expect(result.vrmUrl).toBeUndefined();
    });

    it("converts asset with hand rigging", () => {
      const cdnAsset: CDNAssetInput = {
        id: "rigged-weapon",
        name: "Rigged Sword",
        source: "meshy",
        category: "weapon",
        modelPath: "weapons/swords/rigged-sword.glb",
        hasHandRigging: true,
      };

      const result = cdnAssetToAssetData(cdnAsset);

      expect(result.hasHandRigging).toBe(true);
    });

    it("always sets source to CDN", () => {
      const meshyAsset: CDNAssetInput = {
        id: "meshy-asset",
        name: "Meshy Item",
        source: "meshy",
        category: "prop",
        modelPath: "props/meshy-item.glb",
      };

      const localAsset: CDNAssetInput = {
        id: "local-asset",
        name: "Local Item",
        source: "local",
        category: "prop",
        modelPath: "props/local-item.glb",
      };

      expect(cdnAssetToAssetData(meshyAsset).source).toBe("CDN");
      expect(cdnAssetToAssetData(localAsset).source).toBe("CDN");
    });

    it("handles all standard categories", () => {
      const categories = [
        "weapon",
        "armor",
        "character",
        "prop",
        "building",
        "consumable",
      ] as const;

      for (const category of categories) {
        const asset: CDNAssetInput = {
          id: `${category}-test`,
          name: `Test ${category}`,
          source: "meshy",
          category: category as CDNAssetInput["category"],
          modelPath: `${category}/test-${category}.glb`,
        };

        const result = cdnAssetToAssetData(asset);
        expect(result.category).toBe(category);
      }
    });
  });
});
