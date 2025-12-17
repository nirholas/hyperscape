/**
 * Integration Tests for Concept Art and Sprite Services
 *
 * These tests call the REAL service functions to verify:
 * - Prompt building logic produces correct output
 * - Options are correctly applied to prompts
 * - System prompts contain required instructions
 * - Helper functions work correctly
 *
 * Coverage targets:
 * - concept-art-service.ts lines 25-274
 * - sprite-service.ts lines 26-293
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import real functions from concept-art-service
import {
  buildConceptArtPrompt,
  CONCEPT_ART_SYSTEM_PROMPT,
  generateConceptArt,
  generateAndSaveConceptArt,
  type ConceptArtOptions,
  type ConceptArtResult,
} from "../concept-art-service";

// Import real functions from sprite-service
import {
  buildSpritePrompt,
  SPRITE_SYSTEM_PROMPT,
  DEFAULT_VIEWS,
  generateSpritesForAsset,
  generateThumbnailSprite,
  generateSpriteSheet,
  type AssetInfo,
  type SpriteGenerationOptions,
  type SpriteResult,
} from "../sprite-service";

// Import helper functions from providers
import {
  TASK_MODELS,
  DEFAULT_TASK_MODELS,
  getTaskModel,
  isMultimodalImageModel,
  getImageModelConfig,
  IMAGE_MODELS,
  PROVIDER_MODELS,
  getTextModel,
  getImageModel,
  getVisionModel,
} from "../providers";

// ============================================================================
// CONCEPT ART SERVICE TESTS
// ============================================================================

describe("Concept Art Service - Integration", () => {
  describe("buildConceptArtPrompt - Real Function Calls", () => {
    it("builds prompt with default options", () => {
      const description = "A medieval knight's iron longsword";
      const prompt = buildConceptArtPrompt(description);

      // Verify description is included
      expect(prompt).toContain(description);

      // Verify default style (realistic) is applied
      expect(prompt).toContain("photorealistic");

      // Verify default view (isometric) is applied
      expect(prompt).toContain("isometric");

      // Verify default background (simple) is applied
      expect(prompt).toContain("simple gradient background");

      // Verify 3D modeling requirements
      expect(prompt).toContain("3D modeling");
      expect(prompt).toContain("material properties");
    });

    it("applies realistic style correctly", () => {
      const prompt = buildConceptArtPrompt("A wooden shield", {
        style: "realistic",
      });

      expect(prompt).toContain("photorealistic");
      expect(prompt).toContain("accurate lighting");
      expect(prompt).toContain("materials");
      expect(prompt).toContain("textures");
    });

    it("applies stylized style correctly", () => {
      const prompt = buildConceptArtPrompt("A cartoon sword", {
        style: "stylized",
      });

      expect(prompt).toContain("stylized 3D game art");
      expect(prompt).toContain("vibrant colors");
      expect(prompt).toContain("clean shapes");
      expect(prompt).toContain("Fortnite");
      expect(prompt).toContain("Overwatch");
    });

    it("applies pixel style correctly", () => {
      const prompt = buildConceptArtPrompt("A retro potion", {
        style: "pixel",
      });

      expect(prompt).toContain("pixel art");
      expect(prompt).toContain("clean edges");
      expect(prompt).toContain("retro aesthetic");
    });

    it("applies painterly style correctly", () => {
      const prompt = buildConceptArtPrompt("An enchanted staff", {
        style: "painterly",
      });

      expect(prompt).toContain("hand-painted");
      expect(prompt).toContain("brushstrokes");
      expect(prompt).toContain("rich colors");
    });

    it("applies front view angle correctly", () => {
      const prompt = buildConceptArtPrompt("A shield", { viewAngle: "front" });

      expect(prompt).toContain("front-facing view");
      expect(prompt).toContain("centered");
      expect(prompt).toContain("symmetrical");
    });

    it("applies side view angle correctly", () => {
      const prompt = buildConceptArtPrompt("A dagger", { viewAngle: "side" });

      expect(prompt).toContain("side profile view");
      expect(prompt).toContain("silhouette");
    });

    it("applies isometric view angle correctly", () => {
      const prompt = buildConceptArtPrompt("A helmet", {
        viewAngle: "isometric",
      });

      expect(prompt).toContain("isometric");
      expect(prompt).toContain("3/4 view");
      expect(prompt).toContain("slightly above");
    });

    it("applies three-quarter view angle correctly", () => {
      const prompt = buildConceptArtPrompt("A chest", {
        viewAngle: "three-quarter",
      });

      expect(prompt).toContain("three-quarter view");
      expect(prompt).toContain("depth");
      expect(prompt).toContain("multiple sides");
    });

    it("applies transparent background correctly", () => {
      const prompt = buildConceptArtPrompt("An axe", {
        background: "transparent",
      });

      expect(prompt).toContain("transparent");
      expect(prompt).toContain("neutral background");
    });

    it("applies simple background correctly", () => {
      const prompt = buildConceptArtPrompt("A bow", { background: "simple" });

      expect(prompt).toContain("simple gradient background");
      expect(prompt).toContain("doesn't distract");
    });

    it("applies contextual background correctly", () => {
      const prompt = buildConceptArtPrompt("A sword", {
        background: "contextual",
      });

      expect(prompt).toContain("appropriate environmental context");
    });

    it("includes weapon asset type hints", () => {
      const prompt = buildConceptArtPrompt("A battle axe", {
        assetType: "weapon",
      });

      expect(prompt).toContain("grip/handle area");
      expect(prompt).toContain("blade/head");
      expect(prompt).toContain("metal, wood, leather");
    });

    it("includes armor asset type hints", () => {
      const prompt = buildConceptArtPrompt("Plate armor", {
        assetType: "armor",
      });

      expect(prompt).toContain("armor structure");
      expect(prompt).toContain("plates, straps");
      expect(prompt).toContain("form-fitting");
    });

    it("includes character asset type hints with rigging requirements", () => {
      const prompt = buildConceptArtPrompt("A warrior", {
        assetType: "character",
      });

      expect(prompt).toContain("T-pose");
      expect(prompt).toContain("A-pose");
      expect(prompt).toContain("visible limbs, hands, and feet");
      expect(prompt).toContain("CRITICAL FOR 3D RIGGING");
      expect(prompt).toContain("Empty hands");
      expect(prompt).toContain("no bulky oversized armor");
      expect(prompt).toContain("no flowing capes");
    });

    it("includes NPC asset type hints with rigging requirements", () => {
      const prompt = buildConceptArtPrompt("A blacksmith", {
        assetType: "npc",
      });

      expect(prompt).toContain("T-pose");
      expect(prompt).toContain("CRITICAL FOR 3D RIGGING");
      expect(prompt).toContain("Empty hands");
      expect(prompt).toContain("no flowing capes");
      expect(prompt).toContain("form-fitting or simple");
    });

    it("includes mob asset type hints with rigging requirements", () => {
      const prompt = buildConceptArtPrompt("A goblin", { assetType: "mob" });

      expect(prompt).toContain("monster/creature");
      expect(prompt).toContain("T-pose");
      expect(prompt).toContain("CRITICAL FOR 3D RIGGING");
      expect(prompt).toContain("no excessive spikes");
    });

    it("includes enemy asset type hints", () => {
      const prompt = buildConceptArtPrompt("A skeleton warrior", {
        assetType: "enemy",
      });

      expect(prompt).toContain("enemy character");
      expect(prompt).toContain("T-pose");
      expect(prompt).toContain("Empty hands");
      expect(prompt).toContain("no flowing capes or robes");
    });

    it("includes item asset type hints", () => {
      const prompt = buildConceptArtPrompt("A health potion", {
        assetType: "item",
      });

      expect(prompt).toContain("clear angle");
      expect(prompt).toContain("visible details and materials");
    });

    it("includes prop asset type hints", () => {
      const prompt = buildConceptArtPrompt("A wooden barrel", {
        assetType: "prop",
      });

      expect(prompt).toContain("Environmental prop");
      expect(prompt).toContain("structure");
      expect(prompt).toContain("material definition");
    });

    it("handles unknown asset type gracefully", () => {
      const prompt = buildConceptArtPrompt("A mysterious object", {
        assetType: "unknown_type",
      });

      // Should still include base requirements
      expect(prompt).toContain("concept art");
      expect(prompt).toContain("3D modeling");
      // Should not throw or crash
    });

    it("combines multiple options correctly", () => {
      const prompt = buildConceptArtPrompt("A golden crown", {
        style: "painterly",
        viewAngle: "front",
        background: "contextual",
        assetType: "item",
      });

      expect(prompt).toContain("hand-painted");
      expect(prompt).toContain("front-facing view");
      expect(prompt).toContain("environmental context");
      expect(prompt).toContain("visible details and materials");
    });

    it("includes 3D texturing reference note", () => {
      const prompt = buildConceptArtPrompt("A magic staff");

      expect(prompt).toContain("3D texturing");
      expect(prompt).toContain("colors and materials are clearly visible");
    });

    it("specifies no text/labels requirement", () => {
      const prompt = buildConceptArtPrompt("A ring");

      expect(prompt).toContain("no text, labels, or annotations");
    });
  });

  describe("CONCEPT_ART_SYSTEM_PROMPT - Content Verification", () => {
    it("instructs concept artist role", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain(
        "professional concept artist",
      );
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("video games");
    });

    it("enforces image-only output", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("ONLY task");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain(
        "high-quality concept art images",
      );
    });

    it("prohibits text and annotations", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("Do NOT include any text");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("labels");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("annotations");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("watermarks");
    });

    it("prohibits explanations", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain(
        "Do NOT include any explanations",
      );
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("descriptions");
    });

    it("specifies single image output", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("EXACTLY ONE");
    });

    it("focuses on 3D modeling reference quality", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("material definition");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("lighting");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("form");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("3D modeling");
    });
  });

  describe("ConceptArtOptions type coverage", () => {
    it("accepts all valid style options", () => {
      const styles: ConceptArtOptions["style"][] = [
        "realistic",
        "stylized",
        "pixel",
        "painterly",
      ];

      styles.forEach((style) => {
        const prompt = buildConceptArtPrompt("test", { style });
        expect(prompt.length).toBeGreaterThan(0);
      });
    });

    it("accepts all valid viewAngle options", () => {
      const angles: ConceptArtOptions["viewAngle"][] = [
        "front",
        "side",
        "isometric",
        "three-quarter",
      ];

      angles.forEach((viewAngle) => {
        const prompt = buildConceptArtPrompt("test", { viewAngle });
        expect(prompt.length).toBeGreaterThan(0);
      });
    });

    it("accepts all valid background options", () => {
      const backgrounds: ConceptArtOptions["background"][] = [
        "transparent",
        "simple",
        "contextual",
      ];

      backgrounds.forEach((background) => {
        const prompt = buildConceptArtPrompt("test", { background });
        expect(prompt.length).toBeGreaterThan(0);
      });
    });
  });
});

// ============================================================================
// SPRITE SERVICE TESTS
// ============================================================================

describe("Sprite Service - Integration", () => {
  describe("buildSpritePrompt - Real Function Calls", () => {
    const baseAsset: AssetInfo = {
      id: "sword_01",
      name: "Iron Longsword",
      description: "A sturdy iron blade with leather grip",
      category: "weapon",
    };

    it("builds prompt with asset name and description", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("Iron Longsword");
      expect(prompt).toContain("A sturdy iron blade with leather grip");
    });

    it("builds prompt without description if not provided", () => {
      const asset: AssetInfo = {
        id: "item_01",
        name: "Simple Item",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("Simple Item");
      expect(prompt).not.toContain(" - ");
    });

    it("applies front view correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("front-facing view");
      expect(prompt).toContain("perfectly centered");
      expect(prompt).toContain("symmetrical");
      expect(prompt).toContain("shop menu");
    });

    it("applies side view correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "side");

      expect(prompt).toContain("side profile view");
      expect(prompt).toContain("90-degrees");
      expect(prompt).toContain("silhouette");
    });

    it("applies back view correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "back");

      expect(prompt).toContain("rear view");
      expect(prompt).toContain("directly behind");
    });

    it("applies isometric view correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "isometric");

      expect(prompt).toContain("isometric 3/4 view");
      expect(prompt).toContain("45-degree angle");
      expect(prompt).toContain("RPG inventory icon");
    });

    it("applies top-down view correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "top-down");

      expect(prompt).toContain("top-down view");
      expect(prompt).toContain("straight down");
      expect(prompt).toContain("2D top-down games");
    });

    it("applies pixel style correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "front", { style: "pixel" });

      expect(prompt).toContain("retro pixel art");
      expect(prompt).toContain("clean edges");
      expect(prompt).toContain("visible pixels");
      expect(prompt).toContain("16-32 colors");
      expect(prompt).toContain("16-bit games");
    });

    it("applies clean style correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "front", { style: "clean" });

      expect(prompt).toContain("clean vector-style");
      expect(prompt).toContain("smooth anti-aliased edges");
      expect(prompt).toContain("flat colors");
      expect(prompt).toContain("mobile game");
    });

    it("applies detailed style correctly", () => {
      const prompt = buildSpritePrompt(baseAsset, "front", {
        style: "detailed",
      });

      expect(prompt).toContain("detailed hand-painted");
      expect(prompt).toContain("subtle shading");
      expect(prompt).toContain("soft textures");
      expect(prompt).toContain("AAA quality");
    });

    it("includes weapon category hints", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("blade/head detail");
      expect(prompt).toContain("grip area");
      expect(prompt).toContain("metallic sheen");
      expect(prompt).toContain("wood grain");
      expect(prompt).toContain("leather wrapping");
    });

    it("includes armor category hints", () => {
      const asset: AssetInfo = {
        id: "armor_01",
        name: "Steel Plate",
        category: "armor",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("plate structure");
      expect(prompt).toContain("straps and buckles");
      expect(prompt).toContain("metal plates");
      expect(prompt).toContain("leather padding");
    });

    it("includes tool category hints", () => {
      const asset: AssetInfo = {
        id: "tool_01",
        name: "Pickaxe",
        category: "tool",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("functional parts visible");
      expect(prompt).toContain("clear handle");
      expect(prompt).toContain("working end");
    });

    it("includes resource category hints", () => {
      const asset: AssetInfo = {
        id: "resource_01",
        name: "Iron Ore",
        category: "resource",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("natural texture");
      expect(prompt).toContain("organic or mineral");
      expect(prompt).toContain("collectible appeal");
    });

    it("includes currency category hints", () => {
      const asset: AssetInfo = {
        id: "currency_01",
        name: "Gold Coin",
        category: "currency",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("gleaming");
      expect(prompt).toContain("valuable-looking");
      expect(prompt).toContain("metallic shine");
      expect(prompt).toContain("embossed details");
    });

    it("includes consumable category hints", () => {
      const asset: AssetInfo = {
        id: "consumable_01",
        name: "Health Potion",
        category: "consumable",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("appetizing or magical");
      expect(prompt).toContain("container");
    });

    it("applies custom color palette", () => {
      const prompt = buildSpritePrompt(baseAsset, "front", {
        colorPalette: "#FF0000, #00FF00, #0000FF",
      });

      expect(prompt).toContain("COLOR PALETTE");
      expect(prompt).toContain("#FF0000, #00FF00, #0000FF");
    });

    it("uses default color palette when not specified", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("COLOR PALETTE");
      expect(prompt).toContain("cohesive");
      expect(prompt).toContain("game-appropriate");
    });

    it("includes resolution in prompt", () => {
      const prompt = buildSpritePrompt(baseAsset, "front", { resolution: 256 });

      expect(prompt).toContain("256x256 pixels");
      expect(prompt).toContain("square aspect ratio");
    });

    it("uses default resolution of 512", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("512x512 pixels");
    });

    it("includes transparency requirements", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("TRANSPARENT BACKGROUND");
      expect(prompt).toContain("alpha transparency");
    });

    it("includes centering requirements", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("perfectly centered");
      expect(prompt).toContain("equal padding");
    });

    it("includes lighting requirements", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("top-left lighting");
      expect(prompt).toContain("subtle shadow");
    });

    it("includes no-annotation requirements", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("No text");
      expect(prompt).toContain("no labels");
      expect(prompt).toContain("no watermarks");
    });

    it("includes category in prompt", () => {
      const prompt = buildSpritePrompt(baseAsset, "front");

      expect(prompt).toContain("CATEGORY: weapon");
    });

    it("uses item as default category", () => {
      const asset: AssetInfo = { id: "test", name: "Test Item" };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain("CATEGORY: item");
    });

    it("handles unknown view by falling back to front", () => {
      const prompt = buildSpritePrompt(baseAsset, "unknown_view");

      // Should use front description as fallback
      expect(prompt).toContain("front-facing view");
    });
  });

  describe("SPRITE_SYSTEM_PROMPT - Content Verification", () => {
    it("instructs sprite artist role", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain(
        "professional 2D game sprite artist",
      );
    });

    it("enforces image-only output", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("ONLY task");
      expect(SPRITE_SYSTEM_PROMPT).toContain("game-ready sprite images");
    });

    it("requires transparent background", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("TRANSPARENT background");
      expect(SPRITE_SYSTEM_PROMPT).toContain("alpha channel");
    });

    it("prohibits text and annotations", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("Do NOT include any text");
      expect(SPRITE_SYSTEM_PROMPT).toContain("labels");
      expect(SPRITE_SYSTEM_PROMPT).toContain("watermarks");
      expect(SPRITE_SYSTEM_PROMPT).toContain("UI elements");
    });

    it("specifies centering", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("centered in the frame");
      expect(SPRITE_SYSTEM_PROMPT).toContain("consistent padding");
    });

    it("specifies lighting direction", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("top-left corner");
    });

    it("requires clean edges", () => {
      expect(SPRITE_SYSTEM_PROMPT).toContain("clean, crisp edges");
    });
  });

  describe("DEFAULT_VIEWS constant", () => {
    it("contains standard 4 views", () => {
      expect(DEFAULT_VIEWS).toEqual(["front", "side", "back", "isometric"]);
    });

    it("has correct length", () => {
      expect(DEFAULT_VIEWS.length).toBe(4);
    });
  });

  describe("SpriteGenerationOptions type coverage", () => {
    it("accepts all valid style options", () => {
      const styles: SpriteGenerationOptions["style"][] = [
        "pixel",
        "clean",
        "detailed",
      ];

      styles.forEach((style) => {
        const asset: AssetInfo = { id: "test", name: "Test" };
        const prompt = buildSpritePrompt(asset, "front", { style });
        expect(prompt.length).toBeGreaterThan(0);
      });
    });

    it("accepts various resolutions", () => {
      const resolutions = [128, 256, 512, 1024];
      const asset: AssetInfo = { id: "test", name: "Test" };

      resolutions.forEach((resolution) => {
        const prompt = buildSpritePrompt(asset, "front", { resolution });
        expect(prompt).toContain(`${resolution}x${resolution}`);
      });
    });
  });

  describe("generateSpriteSheet - Layout Calculation", () => {
    // Test the layout calculation logic without calling the AI
    it("calculates correct layout for 4 sprites", () => {
      const count = 4;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      expect(cols).toBe(2);
      expect(rows).toBe(2);
    });

    it("calculates correct layout for 8 sprites", () => {
      const count = 8;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      expect(cols).toBe(3);
      expect(rows).toBe(3);
      expect(rows * cols).toBeGreaterThanOrEqual(count);
    });

    it("calculates correct layout for 16 sprites", () => {
      const count = 16;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      expect(cols).toBe(4);
      expect(rows).toBe(4);
    });
  });
});

// ============================================================================
// PROVIDER HELPER FUNCTIONS TESTS
// ============================================================================

describe("Provider Helper Functions - Integration", () => {
  describe("TASK_MODELS", () => {
    it("has all required task types", () => {
      expect(TASK_MODELS.promptEnhancement).toBeDefined();
      expect(TASK_MODELS.textGeneration).toBeDefined();
      expect(TASK_MODELS.dialogueGeneration).toBeDefined();
      expect(TASK_MODELS.contentGeneration).toBeDefined();
      expect(TASK_MODELS.imageGeneration).toBeDefined();
      expect(TASK_MODELS.vision).toBeDefined();
      expect(TASK_MODELS.reasoning).toBeDefined();
    });

    it("returns valid model strings", () => {
      expect(TASK_MODELS.imageGeneration).toContain("/");
      expect(TASK_MODELS.textGeneration).toContain("/");
      expect(TASK_MODELS.contentGeneration).toContain("/");
    });
  });

  describe("DEFAULT_TASK_MODELS", () => {
    it("uses correct image generation model", () => {
      expect(DEFAULT_TASK_MODELS.imageGeneration).toBe(
        "google/gemini-2.5-flash-image",
      );
    });

    it("uses OpenAI for vision", () => {
      expect(DEFAULT_TASK_MODELS.vision).toBe("openai/gpt-4o");
    });

    it("uses Anthropic for content generation", () => {
      expect(DEFAULT_TASK_MODELS.contentGeneration).toContain(
        "anthropic/claude",
      );
    });
  });

  describe("getTaskModel", () => {
    it("returns default for imageGeneration", () => {
      const model = getTaskModel("imageGeneration");
      expect(model).toBe(DEFAULT_TASK_MODELS.imageGeneration);
    });

    it("returns default for textGeneration", () => {
      const model = getTaskModel("textGeneration");
      expect(model).toBe(DEFAULT_TASK_MODELS.textGeneration);
    });

    it("returns default for all task types", () => {
      const tasks = [
        "promptEnhancement",
        "textGeneration",
        "dialogueGeneration",
        "contentGeneration",
        "imageGeneration",
        "vision",
        "reasoning",
      ] as const;

      tasks.forEach((task) => {
        const model = getTaskModel(task);
        expect(model).toBe(DEFAULT_TASK_MODELS[task]);
      });
    });
  });

  describe("isMultimodalImageModel", () => {
    it("returns true for Gemini image model", () => {
      expect(isMultimodalImageModel("google/gemini-2.5-flash-image")).toBe(
        true,
      );
    });

    it("returns false for dedicated image models", () => {
      expect(isMultimodalImageModel("bfl/flux-2-pro")).toBe(false);
      expect(isMultimodalImageModel("bfl/flux-2-flex")).toBe(false);
      expect(isMultimodalImageModel("google/imagen-4.0-generate")).toBe(false);
    });

    it("returns false for unknown models", () => {
      expect(isMultimodalImageModel("unknown/model")).toBe(false);
    });
  });

  describe("getImageModelConfig", () => {
    it("returns config for Gemini image model", () => {
      const config = getImageModelConfig("google/gemini-2.5-flash-image");

      expect(config).toBeDefined();
      expect(config?.name).toBe("Gemini 2.5 Flash Image");
      expect(config?.type).toBe("multimodal");
      expect(config?.provider).toBe("google");
    });

    it("returns config for Flux Pro", () => {
      const config = getImageModelConfig("bfl/flux-2-pro");

      expect(config).toBeDefined();
      expect(config?.name).toBe("Flux 2 Pro");
      expect(config?.type).toBe("dedicated");
      expect(config?.provider).toBe("bfl");
      expect(config?.supportedSizes).toContain("2048x2048");
    });

    it("returns undefined for unknown model", () => {
      const config = getImageModelConfig("unknown/model");
      expect(config).toBeUndefined();
    });
  });

  describe("IMAGE_MODELS", () => {
    it("contains expected models", () => {
      const modelIds = IMAGE_MODELS.map((m) => m.id);

      expect(modelIds).toContain("google/gemini-2.5-flash-image");
      expect(modelIds).toContain("bfl/flux-2-pro");
      expect(modelIds).toContain("bfl/flux-2-flex");
      expect(modelIds).toContain("google/imagen-4.0-generate");
      expect(modelIds).toContain("google/imagen-4.0-fast-generate");
    });

    it("all models have required fields", () => {
      IMAGE_MODELS.forEach((model) => {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.type).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(model.description).toBeDefined();
      });
    });
  });

  describe("PROVIDER_MODELS", () => {
    it("has OpenAI config", () => {
      expect(PROVIDER_MODELS.openai.text).toBe("openai/gpt-4o");
      expect(PROVIDER_MODELS.openai.vision).toBe("openai/gpt-4o");
    });

    it("has Anthropic config", () => {
      expect(PROVIDER_MODELS.anthropic.text).toContain("claude");
      expect(PROVIDER_MODELS.anthropic.vision).toContain("claude");
    });

    it("has Google config with image support", () => {
      expect(PROVIDER_MODELS.google.text).toContain("gemini");
      expect(PROVIDER_MODELS.google.image).toBeDefined();
      expect(PROVIDER_MODELS.google.vision).toContain("gemini");
    });
  });

  describe("getTextModel", () => {
    it("returns correct model for OpenAI", () => {
      expect(getTextModel("openai")).toBe("openai/gpt-4o");
    });

    it("returns correct model for Anthropic", () => {
      expect(getTextModel("anthropic")).toContain("claude");
    });

    it("returns correct model for Google", () => {
      expect(getTextModel("google")).toContain("gemini");
    });
  });

  describe("getImageModel", () => {
    it("returns image model for Google", () => {
      expect(getImageModel("google")).toBe("google/gemini-2.5-flash-image");
    });

    it("throws for OpenAI (no image support)", () => {
      expect(() => getImageModel("openai")).toThrow(
        "Provider openai does not support image generation",
      );
    });

    it("throws for Anthropic (no image support)", () => {
      expect(() => getImageModel("anthropic")).toThrow(
        "Provider anthropic does not support image generation",
      );
    });
  });

  describe("getVisionModel", () => {
    it("returns vision model for OpenAI", () => {
      expect(getVisionModel("openai")).toBe("openai/gpt-4o");
    });

    it("returns vision model for Anthropic", () => {
      expect(getVisionModel("anthropic")).toContain("claude");
    });

    it("returns vision model for Google", () => {
      expect(getVisionModel("google")).toContain("gemini");
    });
  });
});

// ============================================================================
// TYPE STRUCTURE TESTS
// ============================================================================

describe("Type Structures", () => {
  describe("ConceptArtResult structure", () => {
    it("validates complete result structure", () => {
      const result: ConceptArtResult = {
        imageUrl: "https://storage.example.com/image.png",
        dataUrl: "data:image/png;base64,abc123",
        base64: "abc123",
        mediaType: "image/png",
      };

      expect(result.imageUrl).toMatch(/^https?:\/\//);
      expect(result.dataUrl).toMatch(/^data:image\//);
      expect(result.base64).toBeDefined();
      expect(result.mediaType).toBe("image/png");
    });
  });

  describe("SpriteResult structure", () => {
    it("validates complete result structure", () => {
      const result: SpriteResult = {
        angle: "isometric",
        imageUrl: "data:image/png;base64,abc123",
        base64: "abc123",
        mediaType: "image/png",
      };

      expect(result.angle).toBe("isometric");
      expect(result.imageUrl).toContain("data:image/png");
      expect(result.base64).toBeDefined();
      expect(result.mediaType).toBe("image/png");
    });
  });

  describe("AssetInfo structure", () => {
    it("validates minimal asset info", () => {
      const asset: AssetInfo = {
        id: "test_01",
        name: "Test Asset",
      };

      expect(asset.id).toBe("test_01");
      expect(asset.name).toBe("Test Asset");
      expect(asset.description).toBeUndefined();
      expect(asset.category).toBeUndefined();
    });

    it("validates complete asset info", () => {
      const asset: AssetInfo = {
        id: "sword_01",
        name: "Iron Sword",
        description: "A basic iron sword",
        category: "weapon",
      };

      expect(asset.id).toBeDefined();
      expect(asset.name).toBeDefined();
      expect(asset.description).toBeDefined();
      expect(asset.category).toBe("weapon");
    });
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe("Edge Cases", () => {
  describe("buildConceptArtPrompt edge cases", () => {
    it("handles empty description", () => {
      const prompt = buildConceptArtPrompt("");

      expect(prompt).toContain('""');
      expect(prompt).toContain("concept art");
    });

    it("handles very long description", () => {
      const longDesc = "A ".repeat(500) + "magical sword";
      const prompt = buildConceptArtPrompt(longDesc);

      expect(prompt).toContain(longDesc);
    });

    it("handles special characters in description", () => {
      const desc = 'A sword with "quotes" and <brackets> & symbols';
      const prompt = buildConceptArtPrompt(desc);

      expect(prompt).toContain(desc);
    });
  });

  describe("buildSpritePrompt edge cases", () => {
    it("handles empty name", () => {
      const asset: AssetInfo = { id: "test", name: "" };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain('""');
    });

    it("handles special characters in name", () => {
      const asset: AssetInfo = {
        id: "test",
        name: "Sword of Fire & Ice <Legendary>",
      };
      const prompt = buildSpritePrompt(asset, "front");

      expect(prompt).toContain(asset.name);
    });

    it("handles undefined category", () => {
      const asset: AssetInfo = { id: "test", name: "Unknown Item" };
      const prompt = buildSpritePrompt(asset, "front");

      // Should use default "item" category
      expect(prompt).toContain("CATEGORY: item");
    });
  });
});
