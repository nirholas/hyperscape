/**
 * Generation Config Builder Tests
 *
 * Tests for the asset generation configuration builder.
 * Validates that configs are built correctly for different asset types and styles.
 */

import { describe, it, expect } from "vitest";
import {
  buildGenerationConfig,
  type BuildConfigOptions,
  type MaterialPreset,
  type GenerationConfig,
} from "@/lib/utils/generation-config-builder";

/**
 * Create a base config options object with required fields
 */
function createBaseOptions(
  overrides: Partial<BuildConfigOptions> = {},
): BuildConfigOptions {
  return {
    assetName: "Test Asset",
    assetType: "weapon",
    description: "A test asset for testing",
    gameStyle: "runescape",
    enableRetexturing: true,
    enableSprites: false,
    enableRigging: false,
    selectedMaterials: ["bronze", "iron", "steel"],
    materialPresets: [
      {
        id: "bronze",
        displayName: "Bronze",
        category: "metal",
        color: "#CD7F32",
      },
      { id: "iron", displayName: "Iron", category: "metal", color: "#A19D94" },
      {
        id: "steel",
        displayName: "Steel",
        category: "metal",
        color: "#71797E",
      },
      {
        id: "mithril",
        displayName: "Mithril",
        category: "metal",
        color: "#4169E1",
      },
      {
        id: "leather",
        displayName: "Leather",
        category: "leather",
        color: "#8B4513",
      },
    ],
    materialPromptOverrides: {},
    ...overrides,
  };
}

describe("Generation Config Builder", () => {
  describe("Config Building", () => {
    it("builds valid generation config with required fields", () => {
      const options = createBaseOptions();

      const config = buildGenerationConfig(options);

      expect(config.name).toBe("Test Asset");
      expect(config.type).toBe("weapon");
      expect(config.description).toBe("A test asset for testing");
      expect(config.assetId).toBe("test-asset");
      expect(config.generationType).toBe("item");
    });

    it("includes all required fields in output config", () => {
      const options = createBaseOptions();

      const config = buildGenerationConfig(options);

      // Check all required fields exist
      expect(config).toHaveProperty("name");
      expect(config).toHaveProperty("type");
      expect(config).toHaveProperty("subtype");
      expect(config).toHaveProperty("description");
      expect(config).toHaveProperty("assetId");
      expect(config).toHaveProperty("generationType");
      expect(config).toHaveProperty("metadata");
      expect(config).toHaveProperty("materialPresets");
      expect(config).toHaveProperty("enableGeneration");
      expect(config).toHaveProperty("enableRetexturing");
      expect(config).toHaveProperty("enableSprites");
      expect(config).toHaveProperty("enableRigging");
      expect(config).toHaveProperty("customPrompts");
    });

    it("applies category defaults correctly", () => {
      const options = createBaseOptions({
        assetType: "armor",
        description: "A protective chestplate",
      });

      const config = buildGenerationConfig(options);

      expect(config.type).toBe("armor");
      expect(config.subtype).toBe("armor");
      expect(config.enableGeneration).toBe(true);
    });

    it("generates correct assetId from name", () => {
      const options = createBaseOptions({
        assetName: "Bronze Long Sword",
      });

      const config = buildGenerationConfig(options);

      expect(config.assetId).toBe("bronze-long-sword");
    });

    it("handles special characters in asset name", () => {
      const options = createBaseOptions({
        assetName: "Dragon's   Flame    Sword",
      });

      const config = buildGenerationConfig(options);

      // Multiple spaces get replaced with single hyphens
      expect(config.assetId).toBe("dragon's-flame-sword");
    });

    it("sets enableGeneration to true", () => {
      const options = createBaseOptions();

      const config = buildGenerationConfig(options);

      expect(config.enableGeneration).toBe(true);
    });

    it("respects enableRetexturing flag", () => {
      const enabledConfig = buildGenerationConfig(
        createBaseOptions({ enableRetexturing: true }),
      );
      const disabledConfig = buildGenerationConfig(
        createBaseOptions({ enableRetexturing: false }),
      );

      expect(enabledConfig.enableRetexturing).toBe(true);
      expect(disabledConfig.enableRetexturing).toBe(false);
    });

    it("respects enableSprites flag and creates spriteConfig", () => {
      const config = buildGenerationConfig(
        createBaseOptions({
          enableSprites: true,
        }),
      );

      expect(config.enableSprites).toBe(true);
      expect(config.spriteConfig).toBeDefined();
      expect(config.spriteConfig!.angles).toBe(8);
      expect(config.spriteConfig!.resolution).toBe(512);
      expect(config.spriteConfig!.backgroundColor).toBe("transparent");
    });

    it("does not create spriteConfig when sprites disabled", () => {
      const config = buildGenerationConfig(
        createBaseOptions({
          enableSprites: false,
        }),
      );

      expect(config.enableSprites).toBe(false);
      expect(config.spriteConfig).toBeUndefined();
    });
  });

  describe("Avatar Generation", () => {
    it("handles avatar generation type correctly", () => {
      const options = createBaseOptions({
        generationType: "avatar",
        enableRigging: true,
        characterHeight: 1.8,
      });

      const config = buildGenerationConfig(options);

      expect(config.generationType).toBe("avatar");
      expect(config.type).toBe("character");
      expect(config.subtype).toBe("humanoid");
      expect(config.enableRigging).toBe(true);
      expect(config.enableRetexturing).toBe(false); // Always false for avatars
    });

    it("includes riggingOptions for avatars", () => {
      const options = createBaseOptions({
        generationType: "avatar",
        enableRigging: true,
        characterHeight: 2.0,
      });

      const config = buildGenerationConfig(options);

      expect(config.riggingOptions).toBeDefined();
      expect(config.riggingOptions!.heightMeters).toBe(2.0);
    });

    it("excludes materialPresets for avatars", () => {
      const options = createBaseOptions({
        generationType: "avatar",
        selectedMaterials: ["bronze", "iron"],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets).toEqual([]);
    });
  });

  describe("Material Presets", () => {
    it("creates material variants from selected materials", () => {
      const options = createBaseOptions({
        selectedMaterials: ["bronze", "iron", "steel"],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets).toHaveLength(3);
      expect(config.materialPresets[0].id).toBe("bronze");
      expect(config.materialPresets[1].id).toBe("iron");
      expect(config.materialPresets[2].id).toBe("steel");
    });

    it("assigns correct tier based on material order", () => {
      const options = createBaseOptions({
        selectedMaterials: ["bronze", "iron", "steel", "mithril"],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].tier).toBe(1);
      expect(config.materialPresets[1].tier).toBe(2);
      expect(config.materialPresets[2].tier).toBe(3);
      expect(config.materialPresets[3].tier).toBe(4);
    });

    it("uses preset displayName when available", () => {
      const options = createBaseOptions({
        selectedMaterials: ["bronze"],
        materialPresets: [
          { id: "bronze", displayName: "Shiny Bronze", category: "metal" },
        ],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].displayName).toBe("Shiny Bronze");
    });

    it("generates displayName from id when preset not found", () => {
      const options = createBaseOptions({
        selectedMaterials: ["unknown-material"],
        materialPresets: [],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].displayName).toBe("Unknown material");
    });

    it("uses preset category when available", () => {
      const options = createBaseOptions({
        selectedMaterials: ["leather"],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].category).toBe("leather");
    });

    it("applies material prompt overrides", () => {
      const options = createBaseOptions({
        selectedMaterials: ["bronze"],
        materialPromptOverrides: {
          bronze: "custom bronze texture with patina",
        },
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].stylePrompt).toBe(
        "custom bronze texture with patina",
      );
    });

    it("uses preset color when available", () => {
      const options = createBaseOptions({
        selectedMaterials: ["bronze"],
      });

      const config = buildGenerationConfig(options);

      expect(config.materialPresets[0].color).toBe("#CD7F32");
    });
  });

  describe("Game Style Configuration", () => {
    it("uses runescape style for RuneScape game style", () => {
      const options = createBaseOptions({
        gameStyle: "runescape",
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.gameStyle).toBe("runescape");
      expect(config.style).toBe("runescape2007");
    });

    it("uses custom style for custom game style", () => {
      const options = createBaseOptions({
        gameStyle: "custom",
        customStyle: "cyberpunk-fantasy",
        customGamePrompt: "Neon-lit futuristic fantasy",
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.gameStyle).toBe("custom");
      expect(config.style).toBe("cyberpunk-fantasy");
      expect(config.metadata.customGamePrompt).toBe(
        "Neon-lit futuristic fantasy",
      );
    });

    it("applies gameStyleConfig generation prompt when provided", () => {
      const options = createBaseOptions({
        gameStyle: "runescape",
        gameStyleConfig: {
          name: "RuneScape",
          base: "low-poly medieval fantasy",
          generation: "osrs-stylized",
          enhanced: "detailed low-poly",
        },
      });

      const config = buildGenerationConfig(options);

      expect(config.style).toBe("osrs-stylized");
    });

    it("sets customGamePrompt in metadata for custom style", () => {
      const options = createBaseOptions({
        gameStyle: "custom",
        customGamePrompt: "Anime style with cel shading",
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.customGamePrompt).toBe(
        "Anime style with cel shading",
      );
    });

    it("excludes customGamePrompt for non-custom styles", () => {
      const options = createBaseOptions({
        gameStyle: "runescape",
        customGamePrompt: "This should be ignored",
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.customGamePrompt).toBeUndefined();
    });
  });

  describe("Category Presets", () => {
    it("handles weapon preset values", () => {
      const options = createBaseOptions({
        assetType: "weapon",
        assetName: "Iron Dagger",
        description: "A small iron dagger",
      });

      const config = buildGenerationConfig(options);

      expect(config.type).toBe("weapon");
      expect(config.subtype).toBe("weapon");
      expect(config.generationType).toBe("item");
      expect(config.enableRetexturing).toBe(true);
    });

    it("handles NPC preset values", () => {
      const options = createBaseOptions({
        generationType: "avatar",
        assetType: "npc",
        assetName: "Goblin Warrior",
        description: "A fierce goblin warrior",
        enableRigging: true,
      });

      const config = buildGenerationConfig(options);

      expect(config.type).toBe("character");
      expect(config.subtype).toBe("humanoid");
      expect(config.generationType).toBe("avatar");
      expect(config.enableRigging).toBe(true);
      expect(config.enableRetexturing).toBe(false);
    });

    it("handles prop preset values", () => {
      const options = createBaseOptions({
        assetType: "prop",
        assetName: "Wooden Crate",
        description: "A sturdy wooden crate",
        enableRetexturing: false,
        enableSprites: true,
      });

      const config = buildGenerationConfig(options);

      expect(config.type).toBe("prop");
      expect(config.subtype).toBe("prop");
      expect(config.enableRetexturing).toBe(false);
      expect(config.enableSprites).toBe(true);
    });

    it("handles armor preset values", () => {
      const options = createBaseOptions({
        assetType: "armor",
        assetName: "Steel Platebody",
        description: "Heavy steel armor",
        selectedMaterials: ["steel", "mithril"],
      });

      const config = buildGenerationConfig(options);

      expect(config.type).toBe("armor");
      expect(config.materialPresets).toHaveLength(2);
    });
  });

  describe("Reference Image Configuration", () => {
    it("includes reference image from URL", () => {
      const options = createBaseOptions({
        referenceImageMode: "custom",
        referenceImageSource: "url",
        referenceImageUrl: "https://example.com/reference.png",
      });

      const config = buildGenerationConfig(options);

      expect(config.referenceImage).toBeDefined();
      expect(config.referenceImage!.source).toBe("url");
      expect(config.referenceImage!.url).toBe(
        "https://example.com/reference.png",
      );
    });

    it("includes reference image from data URL (upload)", () => {
      const options = createBaseOptions({
        referenceImageMode: "custom",
        referenceImageSource: "upload",
        referenceImageDataUrl: "data:image/png;base64,abc123",
      });

      const config = buildGenerationConfig(options);

      expect(config.referenceImage).toBeDefined();
      expect(config.referenceImage!.source).toBe("data");
      expect(config.referenceImage!.dataUrl).toBe(
        "data:image/png;base64,abc123",
      );
    });

    it("excludes reference image in auto mode", () => {
      const options = createBaseOptions({
        referenceImageMode: "auto",
        referenceImageUrl: "https://example.com/reference.png",
      });

      const config = buildGenerationConfig(options);

      expect(config.referenceImage).toBeUndefined();
    });

    it("excludes reference image when no source data provided", () => {
      const options = createBaseOptions({
        referenceImageMode: "custom",
        referenceImageSource: "url",
        referenceImageUrl: null,
      });

      const config = buildGenerationConfig(options);

      expect(config.referenceImage).toBeUndefined();
    });
  });

  describe("Quality Configuration", () => {
    it("includes quality setting when provided", () => {
      const config = buildGenerationConfig(
        createBaseOptions({
          quality: "high",
        }),
      );

      expect(config.quality).toBe("high");
    });

    it("supports all quality levels", () => {
      const standardConfig = buildGenerationConfig(
        createBaseOptions({ quality: "standard" }),
      );
      const highConfig = buildGenerationConfig(
        createBaseOptions({ quality: "high" }),
      );
      const ultraConfig = buildGenerationConfig(
        createBaseOptions({ quality: "ultra" }),
      );

      expect(standardConfig.quality).toBe("standard");
      expect(highConfig.quality).toBe("high");
      expect(ultraConfig.quality).toBe("ultra");
    });
  });

  describe("GPT-4 Enhancement", () => {
    it("enables GPT-4 enhancement by default", () => {
      const options = createBaseOptions();

      const config = buildGenerationConfig(options);

      expect(config.metadata.useGPT4Enhancement).toBe(true);
    });

    it("respects explicit GPT-4 enhancement disable", () => {
      const options = createBaseOptions({
        useGPT4Enhancement: false,
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.useGPT4Enhancement).toBe(false);
    });

    it("enables GPT-4 enhancement when explicitly set", () => {
      const options = createBaseOptions({
        useGPT4Enhancement: true,
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.useGPT4Enhancement).toBe(true);
    });
  });

  describe("Custom Prompts", () => {
    it("includes customAssetTypePrompt in config", () => {
      const options = createBaseOptions({
        customAssetTypePrompt: "A sharp blade with ornate handle",
      });

      const config = buildGenerationConfig(options);

      expect(config.metadata.customAssetTypePrompt).toBe(
        "A sharp blade with ornate handle",
      );
      expect(config.customPrompts.assetType).toBe(
        "A sharp blade with ornate handle",
      );
    });

    it("includes gameStyleConfig base in customPrompts.gameStyle", () => {
      const options = createBaseOptions({
        gameStyleConfig: {
          name: "OSRS",
          base: "low-poly medieval fantasy style",
          generation: "osrs",
        },
      });

      const config = buildGenerationConfig(options);

      expect(config.customPrompts.gameStyle).toBe(
        "low-poly medieval fantasy style",
      );
    });
  });
});
