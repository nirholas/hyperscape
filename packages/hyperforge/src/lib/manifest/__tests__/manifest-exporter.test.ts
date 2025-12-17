/**
 * Manifest Exporter Tests
 *
 * Tests for the manifest exporter service.
 * Tests manifest entry generation, path formatting, and variant handling.
 *
 * NO MOCKS - tests pure logic for manifest creation and formatting.
 */

import { describe, it, expect } from "vitest";
import {
  formatAssetPath,
  formatVariantPath,
  createManifestVariant,
  prepareAssetForExport,
  generateManifestEntry,
  generateManifestEntryWithVariants,
  exportAssetWithVariants,
} from "../manifest-exporter";

describe("Manifest Exporter", () => {
  describe("Manifest Entry Generation", () => {
    it("creates valid manifest entry structure", () => {
      const entry = generateManifestEntry(
        "weapon",
        {
          id: "bronze_sword",
          name: "Bronze Sword",
          type: "melee",
          rarity: "common",
          value: 100,
          description: "A bronze sword.",
          examine: "A sturdy bronze sword.",
          tradeable: true,
        },
        "models/bronze-sword.glb",
      );

      expect(entry).toBeDefined();
      expect(entry.id).toBe("bronze_sword");
      expect(entry.name).toBe("Bronze Sword");
    });

    it("includes all required fields", () => {
      // Skip validation to test structure - validation tested separately
      const entry = prepareAssetForExport(
        "armor",
        {
          id: "iron_platebody",
          name: "Iron Platebody",
          type: "chest",
        },
        "models/iron-platebody.glb",
        { validate: false },
      );

      expect(entry.success).toBe(true);
      expect(entry.asset).toBeDefined();
      expect(entry.manifestType).toBe("items");
    });

    it("determines correct manifest type for weapons", () => {
      const result = prepareAssetForExport("weapon", { name: "Test Sword" });
      expect(result.manifestType).toBe("items");
    });

    it("determines correct manifest type for armor", () => {
      const result = prepareAssetForExport("armor", { name: "Test Armor" });
      expect(result.manifestType).toBe("items");
    });

    it("determines correct manifest type for NPCs", () => {
      const result = prepareAssetForExport("npc", { name: "Test NPC" });
      expect(result.manifestType).toBe("npcs");
    });

    it("determines correct manifest type for mobs", () => {
      const result = prepareAssetForExport("mob", { name: "Goblin" });
      expect(result.manifestType).toBe("npcs");
    });

    it("determines correct manifest type for resources", () => {
      const result = prepareAssetForExport("resource", { name: "Oak Tree" });
      expect(result.manifestType).toBe("resources");
    });

    it("auto-generates ID if missing", () => {
      const result = prepareAssetForExport(
        "weapon",
        { name: "Diamond Scimitar" },
        undefined,
        { generateId: true },
      );

      expect(result.asset.id).toBeDefined();
      expect(typeof result.asset.id).toBe("string");
    });

    it("preserves existing ID", () => {
      const result = prepareAssetForExport("weapon", {
        id: "custom-id-123",
        name: "Custom Weapon",
      });

      expect(result.asset.id).toBe("custom-id-123");
    });
  });

  describe("Asset Path Formatting", () => {
    it("uses asset:// protocol formatting", () => {
      const formattedPath = formatAssetPath(
        "local/path/sword.glb",
        "bronze-sword",
      );

      expect(formattedPath.startsWith("asset://")).toBe(true);
      expect(formattedPath).toContain("bronze-sword");
    });

    it("preserves existing asset:// paths", () => {
      const existingPath = "asset://models/sword/sword.glb";
      const formattedPath = formatAssetPath(existingPath, "sword");

      expect(formattedPath).toBe(existingPath);
    });

    it("extracts filename from local path", () => {
      const formattedPath = formatAssetPath(
        "/Users/assets/models/iron-helm.glb",
        "iron-helm",
      );

      expect(formattedPath).toContain("iron-helm.glb");
      expect(formattedPath.startsWith("asset://")).toBe(true);
    });

    it("creates default filename if path has no filename", () => {
      const formattedPath = formatAssetPath("", "test-asset");

      expect(formattedPath).toContain("test-asset");
      expect(formattedPath).toContain(".glb");
    });

    it("formats path with models prefix", () => {
      const formattedPath = formatAssetPath("sword.glb", "bronze-sword");

      expect(formattedPath).toContain("asset://models/");
      expect(formattedPath).toBe("asset://models/bronze-sword/sword.glb");
    });
  });

  describe("Variant Paths", () => {
    it("formats variant paths correctly", () => {
      const variantPath = formatVariantPath("sword", "bronze", "model.glb");

      expect(variantPath.startsWith("asset://")).toBe(true);
      expect(variantPath).toContain("variants");
      expect(variantPath).toContain("bronze");
    });

    it("includes base asset ID in variant path", () => {
      const variantPath = formatVariantPath("longsword", "steel", "model.glb");

      expect(variantPath).toContain("longsword");
      expect(variantPath).toBe(
        "asset://models/longsword/variants/steel/model.glb",
      );
    });

    it("includes variant ID in path", () => {
      const variantPath = formatVariantPath("axe", "mithril", "model.glb");

      expect(variantPath).toContain("mithril");
    });

    it("uses default filename if not provided", () => {
      const variantPath = formatVariantPath("dagger", "rune");

      expect(variantPath).toContain("model.glb");
    });

    it("handles different file types", () => {
      const thumbnailPath = formatVariantPath(
        "sword",
        "bronze",
        "thumbnail.png",
      );

      expect(thumbnailPath).toContain("thumbnail.png");
      expect(thumbnailPath).toBe(
        "asset://models/sword/variants/bronze/thumbnail.png",
      );
    });
  });

  describe("Manifest Variant Creation", () => {
    it("creates manifest variant with required fields", () => {
      const variant = createManifestVariant("sword", {
        id: "bronze",
        name: "Bronze Sword",
      });

      expect(variant.id).toBe("bronze");
      expect(variant.name).toBe("Bronze Sword");
      expect(variant.modelPath).toBeDefined();
    });

    it("includes tier if provided", () => {
      const variant = createManifestVariant("sword", {
        id: "steel",
        name: "Steel Sword",
        tier: 2,
      });

      expect(variant.tier).toBe(2);
    });

    it("includes material ID if provided", () => {
      const variant = createManifestVariant("armor", {
        id: "iron",
        name: "Iron Armor",
        materialPresetId: "mat_iron_001",
      });

      expect(variant.materialId).toBe("mat_iron_001");
    });

    it("generates model path if not provided", () => {
      const variant = createManifestVariant("weapon", {
        id: "adamant",
        name: "Adamant Weapon",
      });

      expect(variant.modelPath).toContain("asset://");
      expect(variant.modelPath).toContain("adamant");
      expect(variant.modelPath).toContain("variants");
    });

    it("uses provided model path", () => {
      const customPath = "asset://custom/path/model.glb";
      const variant = createManifestVariant("sword", {
        id: "custom",
        name: "Custom Sword",
        modelPath: customPath,
      });

      expect(variant.modelPath).toBe(customPath);
    });

    it("generates thumbnail path if not provided", () => {
      const variant = createManifestVariant("sword", {
        id: "rune",
        name: "Rune Sword",
      });

      expect(variant.thumbnailPath).toContain("thumbnail.png");
      expect(variant.thumbnailPath).toContain("rune");
    });

    it("includes metadata if provided", () => {
      const variant = createManifestVariant("sword", {
        id: "dragon",
        name: "Dragon Sword",
        metadata: { bonus: 50, special: "fire" },
      });

      expect(variant.metadata).toBeDefined();
      expect(variant.metadata?.bonus).toBe(50);
      expect(variant.metadata?.special).toBe("fire");
    });
  });

  describe("Entry With Variants", () => {
    it("generates entry with base model path", () => {
      const entry = generateManifestEntryWithVariants(
        "weapon",
        { name: "Sword" },
        { baseModelPath: "base/sword.glb" },
      );

      expect(entry.baseModelPath).toBeDefined();
      expect(entry.baseModelPath).toContain("asset://");
    });

    it("generates entry with textured model path", () => {
      const entry = generateManifestEntryWithVariants(
        "weapon",
        { name: "Sword" },
        {
          baseModelPath: "base/sword.glb",
          texturedModelPath: "textured/sword.glb",
        },
      );

      expect(entry.texturedModelPath).toBeDefined();
      expect(entry.texturedModelPath).toContain("asset://");
    });

    it("generates entry with variants array", () => {
      const entry = generateManifestEntryWithVariants(
        "weapon",
        { name: "Sword" },
        {
          variants: [
            { id: "bronze", name: "Bronze Sword", tier: 1 },
            { id: "iron", name: "Iron Sword", tier: 2 },
            { id: "steel", name: "Steel Sword", tier: 3 },
          ],
        },
      );

      expect(entry.variants).toHaveLength(3);
      expect(entry.variants?.[0].id).toBe("bronze");
      expect(entry.variants?.[1].id).toBe("iron");
      expect(entry.variants?.[2].id).toBe("steel");
    });

    it("generates default base model path if not provided", () => {
      const entry = generateManifestEntryWithVariants(
        "weapon",
        { name: "Axe" },
        {},
      );

      expect(entry.baseModelPath).toContain("base.glb");
    });
  });

  describe("Export With Variants", () => {
    it("returns success for valid export", () => {
      const result = exportAssetWithVariants(
        "weapon",
        { name: "Sword" },
        { baseModelPath: "base.glb" },
        [{ id: "bronze", name: "Bronze" }],
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns correct manifest type", () => {
      const result = exportAssetWithVariants(
        "armor",
        { name: "Platebody" },
        {},
        [],
      );

      expect(result.manifestType).toBe("items");
    });

    it("adds warning for weapon without variants", () => {
      const result = exportAssetWithVariants(
        "weapon",
        { name: "Sword" },
        {},
        [], // No variants
      );

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("No texture variants");
    });

    it("adds warning for resource without variants", () => {
      const result = exportAssetWithVariants(
        "resource",
        { name: "Ore Rock" },
        {},
        [],
      );

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("no warning for NPC without variants", () => {
      const result = exportAssetWithVariants(
        "npc",
        { name: "Shopkeeper" },
        {},
        [],
      );

      expect(result.warnings).toHaveLength(0);
    });

    it("includes asset in result", () => {
      const result = exportAssetWithVariants(
        "weapon",
        { name: "Test Weapon" },
        { baseModelPath: "test.glb" },
        [{ id: "var1", name: "Variant 1" }],
      );

      expect(result.asset).toBeDefined();
      expect(result.asset.name).toBe("Test Weapon");
    });
  });

  describe("Category to Manifest Type Mapping", () => {
    const categoryMappings: Array<{ category: string; expectedType: string }> =
      [
        { category: "weapon", expectedType: "items" },
        { category: "armor", expectedType: "items" },
        { category: "tool", expectedType: "items" },
        { category: "item", expectedType: "items" },
        { category: "currency", expectedType: "items" },
        { category: "prop", expectedType: "items" },
        { category: "building", expectedType: "items" },
        { category: "emote", expectedType: "items" },
        { category: "audio", expectedType: "items" },
        { category: "music", expectedType: "items" },
        { category: "npc", expectedType: "npcs" },
        { category: "mob", expectedType: "npcs" },
        { category: "character", expectedType: "npcs" },
        { category: "avatar", expectedType: "npcs" },
        { category: "resource", expectedType: "resources" },
        { category: "environment", expectedType: "resources" },
        { category: "biome", expectedType: "resources" },
      ];

    categoryMappings.forEach(({ category, expectedType }) => {
      it(`maps ${category} to ${expectedType}`, () => {
        const result = prepareAssetForExport(
          category as Parameters<typeof prepareAssetForExport>[0],
          { name: `Test ${category}` },
        );

        expect(result.manifestType).toBe(expectedType);
      });
    });
  });

  describe("Validation", () => {
    it("returns errors array for invalid assets", () => {
      const result = prepareAssetForExport("weapon", {}, undefined, {
        validate: true,
        generateId: false,
      });

      // Even without ID, prepareAssetForExport should handle gracefully
      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("returns warnings array", () => {
      const result = prepareAssetForExport("weapon", { name: "Test" });

      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("skips validation when disabled", () => {
      const result = prepareAssetForExport(
        "weapon",
        { name: "Test" },
        undefined,
        { validate: false },
      );

      // Should succeed without validation
      expect(result.success).toBe(true);
    });
  });
});
