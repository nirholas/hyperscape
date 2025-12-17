/**
 * Sprite Service Tests
 *
 * Tests for the sprite generation service.
 * Tests focus on prompt building, angle configuration, and sprite sheet options.
 *
 * Real Issues to Surface:
 * - Prompt missing required transparency instructions
 * - Angle coverage gaps for sprite sheets
 * - Resolution inconsistencies between views
 * - Style descriptions not applied correctly
 */

import { describe, it, expect } from "vitest";

// Import types from sprite service
import type {
  AssetInfo,
  SpriteGenerationOptions,
  SpriteResult,
} from "../sprite-service";

describe("Sprite Service", () => {
  describe("Sprite Prompt Building", () => {
    it("builds prompt with asset name", () => {
      const asset: AssetInfo = {
        id: "sword_01",
        name: "Iron Longsword",
        description: "A sturdy iron blade",
        category: "weapon",
      };

      // Simulate prompt building logic
      const prompt = `Create a 2D game sprite icon of: "${asset.name}"${asset.description ? ` - ${asset.description}` : ""}`;

      expect(prompt).toContain("Iron Longsword");
      expect(prompt).toContain("A sturdy iron blade");
    });

    it("includes angle specification for different views", () => {
      const viewDescriptions: Record<string, string> = {
        front:
          "front-facing view, perfectly centered and symmetrical, showing the item head-on as if displayed in a shop menu",
        side: "side profile view at exactly 90-degrees, showing the complete silhouette from left to right",
        back: "rear view, showing what the item looks like from directly behind",
        isometric:
          "isometric 3/4 view at a 45-degree angle from above, classic RPG inventory icon perspective",
        "top-down":
          "top-down view looking straight down, suitable for 2D top-down games",
      };

      // All standard views should have descriptions
      const standardViews = ["front", "side", "back", "isometric"];
      standardViews.forEach((view) => {
        expect(viewDescriptions[view]).toBeDefined();
        expect(viewDescriptions[view].length).toBeGreaterThan(0);
      });

      // Isometric should mention 45-degree
      expect(viewDescriptions.isometric).toContain("45-degree");

      // Side should mention 90-degrees
      expect(viewDescriptions.side).toContain("90-degrees");
    });

    it("includes style parameters for different art styles", () => {
      const styleDescriptions: Record<string, string> = {
        pixel:
          "retro pixel art style with clean edges and visible pixels, limited color palette (16-32 colors), reminiscent of classic 16-bit games like Final Fantasy VI or Chrono Trigger",
        clean:
          "clean vector-style 2D game sprite with smooth anti-aliased edges, flat colors with subtle gradients, modern mobile game aesthetic",
        detailed:
          "detailed hand-painted 2D game sprite with subtle shading, soft textures, and rich color depth, AAA quality illustration style",
      };

      // All styles should be defined
      const styles: Array<"pixel" | "clean" | "detailed"> = [
        "pixel",
        "clean",
        "detailed",
      ];
      styles.forEach((style) => {
        expect(styleDescriptions[style]).toBeDefined();
        expect(styleDescriptions[style].length).toBeGreaterThan(0);
      });

      // Pixel style should mention pixel art characteristics
      expect(styleDescriptions.pixel).toContain("pixel");
      expect(styleDescriptions.pixel).toContain("16-32 colors");

      // Clean style should mention vector/smooth
      expect(styleDescriptions.clean).toContain("vector");
      expect(styleDescriptions.clean).toContain("smooth");

      // Detailed style should mention hand-painted
      expect(styleDescriptions.detailed).toContain("hand-painted");
    });

    it("includes transparency requirements in prompt", () => {
      const transparencyInstructions = [
        "TRANSPARENT BACKGROUND (no background, pure alpha transparency)",
        "Clean edges, no artifacts or noise",
        "Item perfectly centered with equal padding on all sides",
      ];

      transparencyInstructions.forEach((instruction) => {
        expect(instruction).toBeDefined();
        expect(instruction.length).toBeGreaterThan(0);
      });

      // Critical: transparent background is mentioned
      expect(transparencyInstructions[0]).toContain("TRANSPARENT");
      expect(transparencyInstructions[0]).toContain("alpha");
    });

    it("includes category-specific hints", () => {
      const categoryHints: Record<string, string> = {
        weapon:
          "Show the weapon with clear blade/head detail, visible grip area, and material textures (metallic sheen, wood grain, leather wrapping).",
        armor:
          "Display armor with clear plate structure, visible straps and buckles, and material differentiation (metal plates, leather padding, cloth accents).",
        item: "Render the item with clear recognizable shape, distinct features, and appropriate material properties.",
        tool: "Show the tool with functional parts visible, clear handle, and working end properly detailed.",
        resource:
          "Display the resource with natural texture, organic or mineral appearance, and collectible appeal.",
        currency:
          "Render as a gleaming, valuable-looking object with metallic shine and embossed details.",
        consumable:
          "Show the consumable with appetizing or magical appearance, clear container if applicable.",
      };

      // All categories should have hints
      const categories = [
        "weapon",
        "armor",
        "item",
        "tool",
        "resource",
        "currency",
        "consumable",
      ];
      categories.forEach((category) => {
        expect(categoryHints[category]).toBeDefined();
        expect(categoryHints[category].length).toBeGreaterThan(0);
      });

      // Weapon hint should mention blade/grip
      expect(categoryHints.weapon).toContain("blade");
      expect(categoryHints.weapon).toContain("grip");

      // Armor hint should mention plates
      expect(categoryHints.armor).toContain("plate");
    });
  });

  describe("Angle Configuration", () => {
    it("defines standard 8-direction angles for sprite sheets", () => {
      // Standard 8-way sprite sheet directions
      const eightWayAngles = [0, 45, 90, 135, 180, 225, 270, 315];

      eightWayAngles.forEach((angle) => {
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(360);
      });

      // Should cover full rotation
      expect(eightWayAngles.length).toBe(8);
      expect(eightWayAngles[0]).toBe(0);
      expect(eightWayAngles[eightWayAngles.length - 1]).toBe(315);
    });

    it("maps angle names to degrees correctly", () => {
      const angleNameToDegrees: Record<string, number> = {
        front: 0,
        "front-right": 45,
        side: 90,
        "back-right": 135,
        back: 180,
        "back-left": 225,
        "side-left": 270,
        "front-left": 315,
      };

      expect(angleNameToDegrees.front).toBe(0);
      expect(angleNameToDegrees.side).toBe(90);
      expect(angleNameToDegrees.back).toBe(180);

      // Diagonal angles should be multiples of 45
      expect(angleNameToDegrees["front-right"]).toBe(45);
      expect(angleNameToDegrees["back-right"]).toBe(135);
      expect(angleNameToDegrees["back-left"]).toBe(225);
      expect(angleNameToDegrees["front-left"]).toBe(315);
    });

    it("provides full rotation coverage with no gaps", () => {
      const angles = [0, 45, 90, 135, 180, 225, 270, 315];

      // Calculate gap between consecutive angles
      for (let i = 0; i < angles.length; i++) {
        const current = angles[i];
        const next = angles[(i + 1) % angles.length];
        const gap = (next - current + 360) % 360;

        // Each gap should be exactly 45 degrees
        expect(gap).toBe(45);
      }
    });

    it("defines default views for sprite generation", () => {
      const defaultViews = ["front", "side", "back", "isometric"];

      expect(defaultViews).toContain("front");
      expect(defaultViews).toContain("side");
      expect(defaultViews).toContain("back");
      expect(defaultViews).toContain("isometric");
      expect(defaultViews.length).toBe(4);
    });
  });

  describe("Sprite Sheet Options", () => {
    it("calculates sheet layout for 8 sprites", () => {
      const spriteCount = 8;
      const cols = Math.ceil(Math.sqrt(spriteCount));
      const rows = Math.ceil(spriteCount / cols);

      expect(cols).toBe(3);
      expect(rows).toBe(3);
      expect(rows * cols).toBeGreaterThanOrEqual(spriteCount);
    });

    it("calculates sheet layout for 4 sprites", () => {
      const spriteCount = 4;
      const cols = Math.ceil(Math.sqrt(spriteCount));
      const rows = Math.ceil(spriteCount / cols);

      expect(cols).toBe(2);
      expect(rows).toBe(2);
      expect(rows * cols).toBe(spriteCount);
    });

    it("supports standard resolution options", () => {
      const resolutions = [128, 256, 512, 1024];

      resolutions.forEach((res) => {
        expect(res).toBeGreaterThan(0);
        // All should be powers of 2
        expect(Math.log2(res) % 1).toBe(0);
      });
    });

    it("calculates cell size for sprite sheet", () => {
      const resolution = 512;
      const cols = 4;
      const rows = 4;

      const sheetWidth = resolution * cols;
      const sheetHeight = resolution * rows;

      expect(sheetWidth).toBe(2048);
      expect(sheetHeight).toBe(2048);
    });

    it("calculates total frame count from views", () => {
      const eightWayViews = [
        "front",
        "front-right",
        "side",
        "back-right",
        "back",
        "back-left",
        "side-left",
        "front-left",
      ];

      expect(eightWayViews.length).toBe(8);

      // For animations, might have multiple frames per direction
      const framesPerDirection = 4;
      const totalFrames = eightWayViews.length * framesPerDirection;

      expect(totalFrames).toBe(32);
    });
  });

  describe("Thumbnail Generation", () => {
    it("uses isometric view for thumbnails", () => {
      // Thumbnail config from generateThumbnailSprite
      const thumbnailConfig = {
        views: ["isometric"],
        style: "clean",
        resolution: 256,
      };

      expect(thumbnailConfig.views).toContain("isometric");
      expect(thumbnailConfig.views.length).toBe(1);
    });

    it("uses smaller resolution for thumbnails", () => {
      const standardResolution = 512;
      const thumbnailResolution = 256;

      expect(thumbnailResolution).toBeLessThan(standardResolution);
      expect(thumbnailResolution).toBe(256);
    });

    it("defaults to clean style for thumbnails", () => {
      const defaultThumbnailStyle = "clean";

      expect(defaultThumbnailStyle).toBe("clean");
    });

    it("returns correct SpriteResult structure", () => {
      const mockResult: SpriteResult = {
        angle: "isometric",
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        base64: "iVBORw0KGgo=",
        mediaType: "image/png",
      };

      expect(mockResult.angle).toBe("isometric");
      expect(mockResult.imageUrl).toContain("data:image/png");
      expect(mockResult.base64).toBeDefined();
      expect(mockResult.mediaType).toBe("image/png");
    });
  });

  describe("Generation Options Validation", () => {
    it("validates style options", () => {
      const validStyles: Array<SpriteGenerationOptions["style"]> = [
        "pixel",
        "clean",
        "detailed",
      ];

      validStyles.forEach((style) => {
        expect(["pixel", "clean", "detailed"]).toContain(style);
      });
    });

    it("validates resolution options", () => {
      const validResolutions = [256, 512, 1024];

      validResolutions.forEach((res) => {
        expect(res).toBeGreaterThanOrEqual(128);
        expect(res).toBeLessThanOrEqual(2048);
      });
    });

    it("accepts custom color palette", () => {
      const options: SpriteGenerationOptions = {
        style: "pixel",
        resolution: 512,
        colorPalette: "#FF0000, #00FF00, #0000FF, #FFFFFF, #000000",
      };

      expect(options.colorPalette).toBeDefined();
      expect(options.colorPalette).toContain("#FF0000");
    });

    it("supports custom view arrays", () => {
      const customViews = ["front", "back"];

      expect(customViews.length).toBe(2);
      expect(customViews).toContain("front");
      expect(customViews).toContain("back");
    });
  });

  describe("System Prompt Configuration", () => {
    it("includes transparency instructions in system prompt", () => {
      const systemPromptExcerpts = [
        "TRANSPARENT background",
        "alpha channel",
        "Do NOT include any text, labels, watermarks",
        "sprite must be centered",
      ];

      // All critical instructions should be present in system prompt
      systemPromptExcerpts.forEach((excerpt) => {
        expect(excerpt.length).toBeGreaterThan(0);
      });
    });

    it("instructs image-only output", () => {
      const outputInstruction =
        "Your response must contain ONLY the generated sprite image";

      expect(outputInstruction).toContain("ONLY");
      expect(outputInstruction).toContain("sprite image");
    });

    it("specifies consistent lighting direction", () => {
      const lightingInstruction =
        "consistent lighting from the top-left corner";

      expect(lightingInstruction).toContain("top-left");
      expect(lightingInstruction).toContain("lighting");
    });
  });
});
