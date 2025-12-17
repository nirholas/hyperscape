/**
 * Concept Art Service Integration Tests
 *
 * These tests CALL THE REAL service functions from concept-art-service.ts:
 * - buildConceptArtPrompt() - tested directly with various inputs
 * - generateConceptArt() - mocks AI SDK, tests full workflow
 * - generateAndSaveConceptArt() - mocks AI and fs, tests save workflow
 *
 * Only external services (AI SDK, storage, filesystem) are mocked.
 * All prompt building logic and internal service code runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules - vi.mock is hoisted, so we use vi.hoisted() for mock references
const {
  mockGenerateText,
  mockIsSupabaseConfigured,
  mockUploadConceptArt,
  mockMkdir,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockIsSupabaseConfigured: vi.fn(),
  mockUploadConceptArt: vi.fn(),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("@ai-sdk/gateway", () => ({
  gateway: vi.fn((model: string) => ({ modelId: model })),
}));

vi.mock("@/lib/storage/supabase-storage", () => ({
  isSupabaseConfigured: mockIsSupabaseConfigured,
  uploadConceptArt: mockUploadConceptArt,
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
    },
  };
});

// Import the ACTUAL service functions to test AFTER mocking
import {
  buildConceptArtPrompt,
  generateConceptArt,
  generateAndSaveConceptArt,
  CONCEPT_ART_SYSTEM_PROMPT,
  type ConceptArtOptions,
} from "../concept-art-service";

// Helper to create mock AI response with image files
function createImageResponse(imageData: Uint8Array, mediaType = "image/png") {
  return {
    text: "",
    files: [{ mediaType, uint8Array: imageData }],
    usage: { promptTokens: 100, completionTokens: 0 },
    finishReason: "stop",
    toolCalls: [],
    toolResults: [],
    response: { messages: [] },
    warnings: [],
    steps: [],
    experimental_providerMetadata: {},
  };
}

// Helper to create mock AI response with no image
function createTextOnlyResponse(text: string) {
  return {
    text,
    files: [],
    usage: { promptTokens: 100, completionTokens: 50 },
    finishReason: "stop",
    toolCalls: [],
    toolResults: [],
    response: { messages: [] },
    warnings: [],
    steps: [],
    experimental_providerMetadata: {},
  };
}

// Run tests sequentially to avoid mock state conflicts
describe.sequential("Concept Art Service Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Supabase not configured, use local storage
    mockIsSupabaseConfigured.mockReturnValue(false);
  });

  // ===========================================================================
  // buildConceptArtPrompt - REAL FUNCTION CALLS
  // ===========================================================================
  describe("buildConceptArtPrompt() - Real Function Calls", () => {
    it("builds prompt with description only (default options)", () => {
      const description =
        "A medieval knight's iron longsword with leather-wrapped grip";

      const prompt = buildConceptArtPrompt(description);

      // Verify the prompt contains the description
      expect(prompt).toContain(description);
      // Verify default style is applied (realistic)
      expect(prompt).toContain("photorealistic rendering");
      // Verify default view angle (isometric)
      expect(prompt).toContain("isometric 3/4 view");
      // Verify default background (simple)
      expect(prompt).toContain("clean, simple gradient background");
      // Verify technical requirements are included
      expect(prompt).toContain("3D modeling");
      expect(prompt).toContain("material properties");
    });

    it("builds prompt with realistic style", () => {
      const description = "Ancient dragon scale armor";
      const options: ConceptArtOptions = { style: "realistic" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain(description);
      expect(prompt).toContain("photorealistic rendering");
      expect(prompt).toContain("accurate lighting, materials, and textures");
    });

    it("builds prompt with stylized style", () => {
      const description = "Colorful wizard staff";
      const options: ConceptArtOptions = { style: "stylized" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain(description);
      expect(prompt).toContain("stylized 3D game art style");
      expect(prompt).toContain("vibrant colors");
      expect(prompt).toContain("Fortnite");
      expect(prompt).toContain("Overwatch");
    });

    it("builds prompt with pixel style", () => {
      const description = "Retro 8-bit sword";
      const options: ConceptArtOptions = { style: "pixel" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain(description);
      expect(prompt).toContain("pixel art style");
      expect(prompt).toContain("retro aesthetic");
    });

    it("builds prompt with painterly style", () => {
      const description = "Fantasy castle";
      const options: ConceptArtOptions = { style: "painterly" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain(description);
      expect(prompt).toContain("hand-painted digital art");
      expect(prompt).toContain("brushstrokes");
    });

    it("builds prompt with front view angle", () => {
      const description = "Character portrait";
      const options: ConceptArtOptions = { viewAngle: "front" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("front-facing view");
      expect(prompt).toContain("centered and symmetrical");
    });

    it("builds prompt with side view angle", () => {
      const description = "Profile view of a warrior";
      const options: ConceptArtOptions = { viewAngle: "side" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("side profile view");
      expect(prompt).toContain("full silhouette");
    });

    it("builds prompt with three-quarter view angle", () => {
      const description = "Dynamic character pose";
      const options: ConceptArtOptions = { viewAngle: "three-quarter" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("three-quarter view");
      expect(prompt).toContain("depth and multiple sides");
    });

    it("builds prompt with transparent background", () => {
      const description = "Item icon";
      const options: ConceptArtOptions = { background: "transparent" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("transparent or solid neutral background");
    });

    it("builds prompt with contextual background", () => {
      const description = "Environmental scene";
      const options: ConceptArtOptions = { background: "contextual" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("appropriate environmental context");
    });

    it("builds prompt with weapon asset type hint", () => {
      const description = "Battle axe";
      const options: ConceptArtOptions = { assetType: "weapon" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain(description);
      expect(prompt).toContain("grip/handle area");
      expect(prompt).toContain("blade/head");
      expect(prompt).toContain("metal, wood, leather");
    });

    it("builds prompt with armor asset type hint", () => {
      const description = "Plate mail chest piece";
      const options: ConceptArtOptions = { assetType: "armor" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("armor structure");
      expect(prompt).toContain("plates, straps");
      expect(prompt).toContain("form-fitting");
    });

    it("builds prompt with character asset type hint", () => {
      const description = "Fantasy warrior";
      const options: ConceptArtOptions = { assetType: "character" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("T-pose or A-pose");
      expect(prompt).toContain("visible limbs, hands, and feet");
      expect(prompt).toContain("CRITICAL FOR 3D RIGGING");
      expect(prompt).toContain("Empty hands");
    });

    it("builds prompt with npc asset type hint", () => {
      const description = "Village merchant";
      const options: ConceptArtOptions = { assetType: "npc" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("T-pose or A-pose");
      expect(prompt).toContain("RIGGING");
      expect(prompt).toContain("form-fitting or simple");
    });

    it("builds prompt with mob asset type hint", () => {
      const description = "Cave troll";
      const options: ConceptArtOptions = { assetType: "mob" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("monster/creature");
      expect(prompt).toContain("T-pose or A-pose");
      expect(prompt).toContain("no excessive spikes");
      expect(prompt).toContain("Body shape should be clearly defined");
    });

    it("builds prompt with enemy asset type hint", () => {
      const description = "Dark knight enemy";
      const options: ConceptArtOptions = { assetType: "enemy" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("enemy character");
      expect(prompt).toContain("T-pose or A-pose");
      expect(prompt).toContain("silhouette clean");
    });

    it("builds prompt with item asset type hint", () => {
      const description = "Health potion";
      const options: ConceptArtOptions = { assetType: "item" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("clear angle");
      expect(prompt).toContain("visible details and materials");
    });

    it("builds prompt with prop asset type hint", () => {
      const description = "Wooden barrel";
      const options: ConceptArtOptions = { assetType: "prop" };

      const prompt = buildConceptArtPrompt(description, options);

      expect(prompt).toContain("Environmental prop");
      expect(prompt).toContain("clear structure");
    });

    it("builds prompt with combined options", () => {
      const description = "Enchanted crystal staff";
      const options: ConceptArtOptions = {
        style: "stylized",
        viewAngle: "three-quarter",
        background: "simple",
        assetType: "weapon",
      };

      const prompt = buildConceptArtPrompt(description, options);

      // Verify all options are applied
      expect(prompt).toContain(description);
      expect(prompt).toContain("stylized 3D game art");
      expect(prompt).toContain("three-quarter view");
      expect(prompt).toContain("simple gradient background");
      expect(prompt).toContain("grip/handle area");
    });

    it("handles unknown asset type gracefully", () => {
      const description = "Custom object";
      const options: ConceptArtOptions = { assetType: "unknown-type" };

      const prompt = buildConceptArtPrompt(description, options);

      // Should still build valid prompt without type-specific hint
      expect(prompt).toContain(description);
      expect(prompt).toContain("concept art");
      // No asset type hint should be present for unknown types
    });

    it("includes texture reference instruction", () => {
      const description = "Wooden shield";
      const prompt = buildConceptArtPrompt(description);

      expect(prompt).toContain("3D texturing");
      expect(prompt).toContain("colors and materials are clearly visible");
    });

    it("instructs no text or annotations", () => {
      const description = "Magic ring";
      const prompt = buildConceptArtPrompt(description);

      expect(prompt).toContain("no text, labels, or annotations");
    });
  });

  // ===========================================================================
  // generateConceptArt - REAL FUNCTION WITH MOCKED AI
  // ===========================================================================
  describe("generateConceptArt() - Real Function Calls", () => {
    it("generates concept art and saves to local storage", async () => {
      // Set up mock for this specific test
      mockIsSupabaseConfigured.mockReturnValue(false);
      const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
      mockGenerateText.mockResolvedValueOnce(createImageResponse(imageBytes));

      const result = await generateConceptArt("A medieval sword", {
        style: "realistic",
      });

      // Verify result structure
      expect(result).not.toBeNull();
      expect(result!.dataUrl).toContain("data:image/png;base64,");
      expect(result!.base64).toBeDefined();
      expect(result!.mediaType).toBe("image/png");
      // Local storage URL format
      expect(result!.imageUrl).toContain("/api/upload/image/");
      expect(result!.imageUrl).toContain("concept_");
    });

    it("passes built prompt and system prompt to AI gateway", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      // Set as default return value (not once) so parallel tests can run
      mockGenerateText.mockResolvedValue(
        createImageResponse(new Uint8Array([1, 2, 3, 4])),
      );

      await generateConceptArt("Dragon scale armor XYZ123", {
        style: "stylized",
      });

      // Verify that generateText was called with a prompt containing our unique description
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Dragon scale armor XYZ123"),
          system: CONCEPT_ART_SYSTEM_PROMPT,
        }),
      );

      // Also verify stylized style was included
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("stylized"),
        }),
      );
    });

    it("uses Supabase storage when configured", async () => {
      // Reset and set fresh mocks for this isolated test
      mockIsSupabaseConfigured.mockReset();
      mockUploadConceptArt.mockReset();
      mockGenerateText.mockReset();

      mockIsSupabaseConfigured.mockReturnValue(true);
      mockUploadConceptArt.mockResolvedValue({
        success: true,
        url: "https://supabase.example.com/storage/v1/object/public/image-generation/concept-art/test.png",
        bucket: "image-generation",
        path: "concept-art/test.png",
      });
      mockGenerateText.mockResolvedValue(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      const result = await generateConceptArt("Supabase test asset UNIQUE123");

      expect(result).not.toBeNull();
      expect(result!.imageUrl).toContain("supabase.example.com");
      expect(mockUploadConceptArt).toHaveBeenCalled();
    });

    it("falls back to local storage when Supabase upload fails", async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockUploadConceptArt.mockResolvedValueOnce({
        success: false,
        error: "Upload failed",
        url: "",
        bucket: "",
        path: "",
      });
      mockGenerateText.mockResolvedValueOnce(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      const result = await generateConceptArt("Fallback test");

      expect(result).not.toBeNull();
      // Should fall back to local URL
      expect(result!.imageUrl).toContain("/api/upload/image/");
      expect(result!.imageUrl).toContain("concept_");
    });

    it("returns null when AI generates no image", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce(
        createTextOnlyResponse("I cannot generate images right now."),
      );

      const result = await generateConceptArt("Test");

      expect(result).toBeNull();
    });

    it("returns null when AI response has empty files array", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce({
        text: "",
        files: [],
        usage: { promptTokens: 100, completionTokens: 0 },
        finishReason: "stop",
        toolCalls: [],
        toolResults: [],
        response: { messages: [] },
        warnings: [],
        steps: [],
        experimental_providerMetadata: {},
      });

      const result = await generateConceptArt("Empty response test");

      expect(result).toBeNull();
    });

    it("returns null when AI throws an error", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockRejectedValueOnce(new Error("API rate limit"));

      const result = await generateConceptArt("Error test");

      expect(result).toBeNull();
    });

    it("handles JPEG media type correctly", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      const jpegBytes = new Uint8Array([255, 216, 255, 224]); // JPEG header
      mockGenerateText.mockResolvedValueOnce(
        createImageResponse(jpegBytes, "image/jpeg"),
      );

      const result = await generateConceptArt("JPEG test");

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe("image/jpeg");
      expect(result!.dataUrl).toContain("data:image/jpeg;base64,");
      // Local file should have jpg extension
      expect(result!.imageUrl).toContain(".jpg");
    });

    it("filters non-image files from response", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce({
        text: "",
        files: [
          { mediaType: "application/json", uint8Array: new Uint8Array([123]) },
          {
            mediaType: "image/png",
            uint8Array: new Uint8Array([137, 80, 78, 71]),
          },
        ],
        usage: { promptTokens: 100, completionTokens: 0 },
        finishReason: "stop",
        toolCalls: [],
        toolResults: [],
        response: { messages: [] },
        warnings: [],
        steps: [],
        experimental_providerMetadata: {},
      });

      const result = await generateConceptArt("Mixed files test");

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe("image/png");
    });

    it("applies all options to built prompt", async () => {
      mockIsSupabaseConfigured.mockReset();
      mockGenerateText.mockReset();

      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValue(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      await generateConceptArt("Fantasy helmet ABC789", {
        style: "painterly",
        viewAngle: "front",
        background: "transparent",
        assetType: "armor",
      });

      // Verify all options were included in the prompt
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Fantasy helmet ABC789"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("hand-painted"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("front-facing view"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("transparent"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("armor structure"),
        }),
      );
    });

    it("saves file to local filesystem", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      await generateConceptArt("Local save test");

      // Verify mkdir was called for uploads directory
      expect(mockMkdir).toHaveBeenCalled();
      // Verify writeFile was called
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // generateAndSaveConceptArt - REAL FUNCTION WITH MOCKED AI/FS
  // ===========================================================================
  describe("generateAndSaveConceptArt() - Real Function Calls", () => {
    it("generates and saves concept art to asset directory", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce(
        createImageResponse(new Uint8Array([137, 80, 78, 71, 0, 0, 0, 1])),
      );

      const result = await generateAndSaveConceptArt(
        "asset-12345",
        "A golden crown",
        { style: "realistic" },
      );

      // Verify return value
      expect(result).toBe("/api/assets/asset-12345/concept-art.png");

      // Verify mkdir was called for asset directory
      expect(mockMkdir).toHaveBeenCalled();

      // Verify writeFile was called with correct filename
      const writeFileCall = mockWriteFile.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("concept-art.png"),
      );
      expect(writeFileCall).toBeDefined();
      expect(writeFileCall![0]).toContain("asset-12345");
    });

    it("returns null when generation fails", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValueOnce(
        createTextOnlyResponse("No image"),
      );

      const result = await generateAndSaveConceptArt(
        "asset-failed",
        "Failed generation",
      );

      expect(result).toBeNull();
    });

    it("passes options through to generateConceptArt", async () => {
      mockIsSupabaseConfigured.mockReset();
      mockGenerateText.mockReset();

      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGenerateText.mockResolvedValue(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      await generateAndSaveConceptArt(
        "asset-options-test-DEF456",
        "Stylized sword DEF456",
        { style: "stylized", viewAngle: "side", assetType: "weapon" },
      );

      // Verify all options were passed through to generateConceptArt
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Stylized sword DEF456"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("stylized 3D game art"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("side profile view"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("grip/handle"),
        }),
      );
    });

    it("creates asset directory with recursive option", async () => {
      mockIsSupabaseConfigured.mockReset();
      mockGenerateText.mockReset();
      mockMkdir.mockReset();

      mockIsSupabaseConfigured.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockGenerateText.mockResolvedValue(
        createImageResponse(new Uint8Array([1, 2, 3])),
      );

      await generateAndSaveConceptArt(
        "nested-asset-GHI789",
        "Nested asset GHI789",
      );

      // Verify mkdir was called with our specific asset ID
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining("nested-asset-GHI789"),
        expect.objectContaining({ recursive: true }),
      );
    });

    it("writes PNG buffer to file system", async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      mockGenerateText.mockResolvedValueOnce(createImageResponse(pngBytes));

      await generateAndSaveConceptArt("asset-buffer-test", "Buffer test");

      // Verify writeFile received a Buffer for concept-art.png
      const conceptArtCall = mockWriteFile.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("concept-art.png"),
      );
      expect(conceptArtCall).toBeDefined();
      expect(Buffer.isBuffer(conceptArtCall?.[1])).toBe(true);
    });
  });

  // ===========================================================================
  // System Prompt Verification
  // ===========================================================================
  describe("CONCEPT_ART_SYSTEM_PROMPT Export", () => {
    it("exports system prompt constant", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toBeDefined();
      expect(typeof CONCEPT_ART_SYSTEM_PROMPT).toBe("string");
    });

    it("system prompt instructs image-only output", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("ONLY task is to generate");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain(
        "EXACTLY ONE concept art image",
      );
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("Do NOT include any text");
    });

    it("system prompt mentions 3D modeling reference", () => {
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("3D modeling");
      expect(CONCEPT_ART_SYSTEM_PROMPT).toContain("material definition");
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================
  describe("Edge Cases", () => {
    it("handles empty description", () => {
      const prompt = buildConceptArtPrompt("");

      // Should still build a valid prompt structure
      expect(prompt).toContain("concept art");
      expect(prompt).toContain('""'); // Empty description in quotes
    });

    it("handles very long description", () => {
      const longDescription = "A ".repeat(500) + "very long description";

      const prompt = buildConceptArtPrompt(longDescription);

      expect(prompt).toContain(longDescription);
    });

    it("handles special characters in description", () => {
      const specialDesc = 'A sword with "quoted" text & <special> chars';

      const prompt = buildConceptArtPrompt(specialDesc);

      expect(prompt).toContain(specialDesc);
    });

    it("handles undefined options gracefully", () => {
      const prompt = buildConceptArtPrompt("Test", undefined);

      // Should use all defaults
      expect(prompt).toContain("photorealistic"); // default style
      expect(prompt).toContain("isometric"); // default view
      expect(prompt).toContain("simple gradient"); // default background
    });

    it("handles partial options object", () => {
      const prompt = buildConceptArtPrompt("Test", { style: "pixel" });

      // Custom style
      expect(prompt).toContain("pixel art");
      // Default view
      expect(prompt).toContain("isometric");
      // Default background
      expect(prompt).toContain("simple gradient");
    });
  });
});
