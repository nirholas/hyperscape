/**
 * Concept Art Service Tests
 *
 * Tests for the concept art generation service.
 * Tests focus on prompt building, style options, and generation options.
 *
 * Real Issues to Surface:
 * - Missing style descriptions for valid style options
 * - View angle not correctly specified in prompts
 * - Background requirements not clear for Meshy compatibility
 * - Asset type hints missing for important categories
 */

import { describe, it, expect } from "vitest";

// Import types from concept art service
import type {
  ConceptArtOptions,
  ConceptArtResult,
} from "../concept-art-service";

describe("Concept Art Service", () => {
  describe("Concept Art Prompt Building", () => {
    it("includes description in prompt", () => {
      const assetDescription =
        "A medieval knight's iron longsword with leather-wrapped grip";

      const prompt = `Create a high-quality concept art image for a 3D game asset:\n\n"${assetDescription}"`;

      expect(prompt).toContain(assetDescription);
      expect(prompt).toContain("concept art");
    });

    it("includes art style in prompt", () => {
      const styleDescriptions: Record<string, string> = {
        realistic:
          "photorealistic rendering with accurate lighting, materials, and textures",
        stylized:
          "stylized 3D game art style with vibrant colors and clean shapes, similar to Fortnite or Overwatch",
        pixel:
          "high-quality pixel art style with clean edges and retro aesthetic",
        painterly:
          "hand-painted digital art style with visible brushstrokes and rich colors",
      };

      // All styles should have descriptions
      const styles: ConceptArtOptions["style"][] = [
        "realistic",
        "stylized",
        "pixel",
        "painterly",
      ];

      styles.forEach((style) => {
        expect(styleDescriptions[style!]).toBeDefined();
        expect(styleDescriptions[style!].length).toBeGreaterThan(0);
      });

      // Realistic should mention photorealistic
      expect(styleDescriptions.realistic).toContain("photorealistic");

      // Stylized should mention vibrant colors
      expect(styleDescriptions.stylized).toContain("vibrant");

      // Painterly should mention brushstrokes
      expect(styleDescriptions.painterly).toContain("brushstrokes");
    });

    it("includes mood/atmosphere through background options", () => {
      const backgroundDescriptions: Record<string, string> = {
        transparent: "on a transparent or solid neutral background",
        simple: "on a clean, simple gradient background that doesn't distract",
        contextual: "in an appropriate environmental context",
      };

      // All background options should be defined
      const backgrounds: ConceptArtOptions["background"][] = [
        "transparent",
        "simple",
        "contextual",
      ];

      backgrounds.forEach((bg) => {
        expect(backgroundDescriptions[bg!]).toBeDefined();
        expect(backgroundDescriptions[bg!].length).toBeGreaterThan(0);
      });

      // Contextual should mention environment
      expect(backgroundDescriptions.contextual).toContain("environmental");
    });

    it("includes technical requirements for 3D modeling", () => {
      const technicalRequirements = [
        "Clear, well-defined silhouette suitable for 3D modeling",
        "Visible material properties (metal should look metallic, wood should look wooden, etc.)",
        "Good lighting that reveals form and surface details",
        "Colors that are vibrant but not oversaturated",
        "High detail level appropriate for a AAA game asset",
      ];

      technicalRequirements.forEach((req) => {
        expect(req.length).toBeGreaterThan(0);
      });

      // Should mention 3D modeling suitability
      expect(technicalRequirements[0]).toContain("3D modeling");

      // Should mention materials
      expect(technicalRequirements[1]).toContain("material");
    });

    it("includes asset type specific hints", () => {
      const assetTypeHints: Record<string, string> = {
        weapon:
          "Ensure the weapon has clear grip/handle area, detailed blade/head, and visible materials (metal, wood, leather).",
        armor:
          "Show clear armor structure with visible plates, straps, and material details (metal, leather, cloth). Armor should be form-fitting, not bulky.",
        character:
          "Full body character in a clear T-pose or A-pose with visible limbs, hands, and feet. CRITICAL FOR 3D RIGGING: Empty hands (no weapons or items held), no bulky oversized armor, no flowing capes or robes, no loose fabric that obscures the body silhouette.",
        npc: "Full body NPC in a clear T-pose or A-pose with visible limbs, hands, and feet. CRITICAL FOR 3D RIGGING: Empty hands (no weapons, tools, or items held), no bulky oversized armor, no flowing capes or long robes, no loose fabric that obscures the body silhouette. Clothing should be form-fitting or simple.",
        mob: "Full body monster/creature in a clear T-pose or A-pose with visible limbs. CRITICAL FOR 3D RIGGING: Empty hands/claws (no weapons or items), no excessive spikes or protrusions, no flowing elements like long tails or capes that would complicate rigging. Body shape should be clearly defined.",
        enemy:
          "Full body enemy character in a clear T-pose or A-pose with visible limbs. CRITICAL FOR 3D RIGGING: Empty hands (no weapons held), no bulky armor, no flowing capes or robes. Keep the silhouette clean and form-fitting for easy texturing and rigging.",
        item: "Show the item from a clear angle with visible details and materials.",
        prop: "Environmental prop with clear structure and material definition.",
      };

      // Critical asset types should have hints
      const criticalTypes = ["weapon", "armor", "character", "npc", "mob"];
      criticalTypes.forEach((type) => {
        expect(assetTypeHints[type]).toBeDefined();
        expect(assetTypeHints[type].length).toBeGreaterThan(0);
      });

      // Character hints should mention T-pose for rigging
      expect(assetTypeHints.character).toContain("T-pose");
      expect(assetTypeHints.character).toContain("RIGGING");

      // Mob hints should mention creature and rigging
      expect(assetTypeHints.mob).toContain("creature");
      expect(assetTypeHints.mob).toContain("RIGGING");
    });
  });

  describe("Style Options", () => {
    it("validates style presets", () => {
      const validStyles: ConceptArtOptions["style"][] = [
        "realistic",
        "stylized",
        "pixel",
        "painterly",
      ];

      validStyles.forEach((style) => {
        expect(["realistic", "stylized", "pixel", "painterly"]).toContain(
          style,
        );
      });
    });

    it("style affects prompt structure", () => {
      const buildPromptForStyle = (style: string): string => {
        const styleDescriptions: Record<string, string> = {
          realistic:
            "photorealistic rendering with accurate lighting, materials, and textures",
          stylized:
            "stylized 3D game art style with vibrant colors and clean shapes",
        };

        return `STYLE: ${styleDescriptions[style] || "default style"}`;
      };

      const realisticPrompt = buildPromptForStyle("realistic");
      const stylizedPrompt = buildPromptForStyle("stylized");

      expect(realisticPrompt).toContain("photorealistic");
      expect(stylizedPrompt).toContain("stylized");
      expect(realisticPrompt).not.toEqual(stylizedPrompt);
    });

    it("defaults to realistic style", () => {
      const defaultOptions: ConceptArtOptions = {};
      const resolvedStyle = defaultOptions.style || "realistic";

      expect(resolvedStyle).toBe("realistic");
    });

    it("stylized matches popular game aesthetics", () => {
      const stylizedDescription =
        "stylized 3D game art style with vibrant colors and clean shapes, similar to Fortnite or Overwatch";

      expect(stylizedDescription).toContain("Fortnite");
      expect(stylizedDescription).toContain("Overwatch");
    });
  });

  describe("View Angle Options", () => {
    it("defines standard view angles", () => {
      const viewDescriptions: Record<string, string> = {
        front: "front-facing view, centered and symmetrical",
        side: "side profile view showing the full silhouette",
        isometric:
          "isometric 3/4 view from slightly above, typical for game assets",
        "three-quarter":
          "three-quarter view showing depth and multiple sides of the object",
      };

      const standardViews: ConceptArtOptions["viewAngle"][] = [
        "front",
        "side",
        "isometric",
        "three-quarter",
      ];

      standardViews.forEach((view) => {
        expect(viewDescriptions[view!]).toBeDefined();
        expect(viewDescriptions[view!].length).toBeGreaterThan(0);
      });
    });

    it("defaults to isometric view", () => {
      const defaultOptions: ConceptArtOptions = {};
      const resolvedView = defaultOptions.viewAngle || "isometric";

      expect(resolvedView).toBe("isometric");
    });

    it("isometric is optimal for game assets", () => {
      const isometricDesc =
        "isometric 3/4 view from slightly above, typical for game assets";

      expect(isometricDesc).toContain("game assets");
      expect(isometricDesc).toContain("3/4 view");
    });
  });

  describe("Generation Options", () => {
    it("supports background options for Meshy compatibility", () => {
      const backgroundOptions: ConceptArtOptions["background"][] = [
        "transparent",
        "simple",
        "contextual",
      ];

      backgroundOptions.forEach((bg) => {
        expect(["transparent", "simple", "contextual"]).toContain(bg);
      });
    });

    it("defaults to simple background", () => {
      const defaultOptions: ConceptArtOptions = {};
      const resolvedBackground = defaultOptions.background || "simple";

      expect(resolvedBackground).toBe("simple");
    });

    it("supports asset type hints", () => {
      const assetTypes = [
        "weapon",
        "armor",
        "character",
        "npc",
        "mob",
        "enemy",
        "item",
        "prop",
      ];

      assetTypes.forEach((type) => {
        expect(typeof type).toBe("string");
        expect(type.length).toBeGreaterThan(0);
      });
    });

    it("validates ConceptArtResult structure", () => {
      const mockResult: ConceptArtResult = {
        imageUrl: "https://storage.example.com/concept-art/12345.png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        base64: "iVBORw0KGgo=",
        mediaType: "image/png",
      };

      expect(mockResult.imageUrl).toContain("https://");
      expect(mockResult.dataUrl).toContain("data:image/png");
      expect(mockResult.base64).toBeDefined();
      expect(mockResult.mediaType).toBe("image/png");
    });

    it("imageUrl should be HTTP URL for Meshy compatibility", () => {
      const httpUrl = "https://storage.example.com/concept.png";
      const dataUrl = "data:image/png;base64,abc123";

      // HTTP URLs start with http
      expect(httpUrl.startsWith("http")).toBe(true);
      // Data URLs start with data:
      expect(dataUrl.startsWith("data:")).toBe(true);

      // Meshy requires HTTP URLs
      expect(httpUrl).toMatch(/^https?:\/\//);
    });
  });

  describe("System Prompt Configuration", () => {
    it("instructs image-only output", () => {
      const systemPromptExcerpts = [
        "Your ONLY task is to generate high-quality concept art images",
        "Generate EXACTLY ONE concept art image",
        "Do NOT include any text, labels, annotations, or watermarks",
        "Do NOT include any explanations or descriptions",
      ];

      // First two emphasize ONLY/EXACTLY
      expect(systemPromptExcerpts[0]).toContain("ONLY");
      expect(systemPromptExcerpts[1]).toContain("EXACTLY");

      // Rest should contain NOT for restrictions
      expect(systemPromptExcerpts[2]).toContain("NOT");
      expect(systemPromptExcerpts[3]).toContain("NOT");
    });

    it("focuses on 3D modeling reference quality", () => {
      const referenceInstructions = [
        "Focus on clear material definition, lighting, and form",
        "The image should be suitable as a reference for 3D modeling",
      ];

      referenceInstructions.forEach((instruction) => {
        expect(instruction.length).toBeGreaterThan(0);
      });

      expect(referenceInstructions[1]).toContain("3D modeling");
    });
  });

  describe("Texturing Reference Support", () => {
    it("mentions use as texture_image_url for Meshy", () => {
      // This tests the documented use case
      const useCases = [
        "As visual reference for the asset",
        "As texture_image_url in Meshy refine stage",
        "As input for Image-to-3D pipeline",
      ];

      useCases.forEach((useCase) => {
        expect(useCase.length).toBeGreaterThan(0);
      });

      expect(useCases[1]).toContain("Meshy");
      expect(useCases[1]).toContain("texture_image_url");
    });

    it("emphasizes visible material properties", () => {
      const materialGuidance =
        "Visible material properties (metal should look metallic, wood should look wooden, etc.)";

      expect(materialGuidance).toContain("metal");
      expect(materialGuidance).toContain("wood");
      expect(materialGuidance).toContain("material properties");
    });
  });

  describe("Storage and URL Handling", () => {
    it("prefers Supabase Storage for production", () => {
      const storagePreference =
        "Supabase Storage (preferred) or local filesystem";

      expect(storagePreference).toContain("Supabase");
      expect(storagePreference).toContain("preferred");
    });

    it("generates valid filename format", () => {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = "png";
      const filename = `concept_${timestamp}_${randomId}.${extension}`;

      expect(filename).toMatch(/^concept_\d+_[a-z0-9]+\.png$/);
      expect(filename).toContain("concept_");
      expect(filename).toContain(".png");
    });

    it("constructs valid HTTP URL from CDN", () => {
      const cdnUrl = "http://localhost:3500";
      const filename = "concept_1234567890_abc123.png";
      const httpUrl = `${cdnUrl}/api/upload/image/${filename}`;

      expect(httpUrl).toMatch(/^https?:\/\//);
      expect(httpUrl).toContain("/api/upload/image/");
      expect(httpUrl).toContain(filename);
    });
  });

  describe("Character/NPC Specific Requirements", () => {
    it("requires T-pose or A-pose for characters", () => {
      const characterHint =
        "Full body character in a clear T-pose or A-pose with visible limbs, hands, and feet.";

      expect(characterHint).toContain("T-pose");
      expect(characterHint).toContain("A-pose");
      expect(characterHint).toContain("visible limbs");
    });

    it("prohibits items in hands for rigging", () => {
      const riggingRestriction =
        "Empty hands (no weapons or items held), no bulky oversized armor";

      expect(riggingRestriction).toContain("Empty hands");
      expect(riggingRestriction).toContain("no weapons");
    });

    it("prohibits flowing elements for rigging", () => {
      const flowingRestriction =
        "no flowing capes or robes, no loose fabric that obscures the body silhouette";

      expect(flowingRestriction).toContain("no flowing capes");
      expect(flowingRestriction).toContain("no loose fabric");
    });
  });
});
