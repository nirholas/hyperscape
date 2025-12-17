/**
 * Sprite Generation Service
 * Uses Vercel AI Gateway with Google Gemini for 2D sprite generation
 *
 * Generates multiple sprite views from asset metadata:
 * - Front view (becomes the asset thumbnail)
 * - Side view (45-degree angle)
 * - Back view
 * - Isometric view (for inventory/UI)
 *
 * Best Practices Applied:
 * - Detailed, specific prompts for consistent output
 * - Consistent color palette guidance
 * - Higher resolution generation (512x512)
 * - Explicit transparent background instructions
 * - System prompt for image-only output
 *
 * @see https://vercel.com/docs/ai-gateway/image-generation
 */

import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { TASK_MODELS, isMultimodalImageModel } from "./providers";
import { logger } from "@/lib/utils";

const log = logger.child("Sprite Service");

export interface SpriteResult {
  angle: string;
  imageUrl: string;
  base64?: string;
  mediaType: string;
}

export interface AssetInfo {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

export interface SpriteGenerationOptions {
  views?: string[];
  resolution?: number;
  style?: "pixel" | "clean" | "detailed";
  /** Color palette for consistency across sprites */
  colorPalette?: string;
  /** Model override (defaults to TASK_MODELS.imageGeneration) */
  model?: string;
}

// Default sprite views to generate
export const DEFAULT_VIEWS = ["front", "side", "back", "isometric"];

/**
 * System prompt for sprite generation
 * Instructs the model to ONLY generate a sprite image
 */
export const SPRITE_SYSTEM_PROMPT = `You are a professional 2D game sprite artist. Your ONLY task is to generate game-ready sprite images.

CRITICAL INSTRUCTIONS:
- Generate EXACTLY ONE high-quality sprite image
- The sprite MUST have a TRANSPARENT background (alpha channel)
- Do NOT include any text, labels, watermarks, or UI elements
- Do NOT include any explanations or descriptions in your response
- Do NOT ask clarifying questions
- The sprite must be centered in the frame with consistent padding
- Use consistent lighting from the top-left corner
- Maintain clean, crisp edges suitable for game use

Your response must contain ONLY the generated sprite image with transparent background.`;

/**
 * Build a detailed prompt for sprite generation based on asset and view
 */
export function buildSpritePrompt(
  asset: AssetInfo,
  view: string,
  options: {
    style?: string;
    colorPalette?: string;
    resolution?: number;
  } = {},
): string {
  const { style = "clean", colorPalette, resolution = 512 } = options;

  const styleDescriptions: Record<string, string> = {
    pixel:
      "retro pixel art style with clean edges and visible pixels, limited color palette (16-32 colors), reminiscent of classic 16-bit games like Final Fantasy VI or Chrono Trigger",
    clean:
      "clean vector-style 2D game sprite with smooth anti-aliased edges, flat colors with subtle gradients, modern mobile game aesthetic",
    detailed:
      "detailed hand-painted 2D game sprite with subtle shading, soft textures, and rich color depth, AAA quality illustration style",
  };

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

  const viewDesc = viewDescriptions[view] || viewDescriptions.front;
  const styleDesc = styleDescriptions[style] || styleDescriptions.clean;
  const categoryHint = categoryHints[asset.category || "item"] || "";

  // Build color palette instruction
  const paletteInstruction = colorPalette
    ? `\nCOLOR PALETTE: Use these colors for consistency: ${colorPalette}`
    : "\nCOLOR PALETTE: Use a cohesive, game-appropriate color palette with good contrast.";

  return `Create a 2D game sprite icon of: "${asset.name}"${asset.description ? ` - ${asset.description}` : ""}

STYLE: ${styleDesc}
VIEW: ${viewDesc}
CATEGORY: ${asset.category || "item"}
RESOLUTION: ${resolution}x${resolution} pixels, square aspect ratio
${paletteInstruction}

REQUIREMENTS:
- TRANSPARENT BACKGROUND (no background, pure alpha transparency)
- Item perfectly centered with equal padding on all sides
- Clear, instantly recognizable silhouette
- Consistent top-left lighting with subtle shadow
- Game-ready asset quality suitable for inventory/UI display
- Clean edges, no artifacts or noise
- ${categoryHint}

Generate ONLY the sprite image. No text, no labels, no watermarks.`;
}

/**
 * Generate sprites for an asset using AI Gateway
 *
 * Uses multimodal models (Gemini) with a specialized system prompt
 * to ensure consistent, game-ready sprite output.
 */
export async function generateSpritesForAsset(
  asset: AssetInfo,
  options: SpriteGenerationOptions = {},
): Promise<SpriteResult[]> {
  const views = options.views || DEFAULT_VIEWS;
  const style = options.style || "clean";
  const resolution = options.resolution || 512;
  const model = options.model || TASK_MODELS.imageGeneration;
  const sprites: SpriteResult[] = [];

  log.info(`Generating ${views.length} sprites for asset: ${asset.name}`, {
    views,
    style,
    resolution,
    model,
  });

  // Validate model is multimodal (sprites need the system prompt approach)
  if (!isMultimodalImageModel(model)) {
    log.warn(
      `Model ${model} is not multimodal, sprite generation may not work correctly`,
    );
  }

  for (const view of views) {
    try {
      const prompt = buildSpritePrompt(asset, view, {
        style,
        colorPalette: options.colorPalette,
        resolution,
      });

      log.debug(`Generating ${view} view...`);

      // Use generateText with system prompt for consistent sprite output
      const result = await generateText({
        model: gateway(model),
        system: SPRITE_SYSTEM_PROMPT,
        prompt,
      });

      // Extract images from result.files (Gemini returns images as files)
      const imageFiles = result.files?.filter((f) =>
        f.mediaType?.startsWith("image/"),
      );

      if (imageFiles && imageFiles.length > 0) {
        const file = imageFiles[0];

        // Convert uint8Array to base64
        const base64 = Buffer.from(file.uint8Array).toString("base64");
        const mediaType = file.mediaType || "image/png";
        const dataUrl = `data:${mediaType};base64,${base64}`;

        sprites.push({
          angle: view,
          imageUrl: dataUrl,
          base64,
          mediaType,
        });

        log.debug(
          `Generated ${view} view: ${mediaType}, ${(file.uint8Array.length / 1024).toFixed(1)} KB`,
        );
      } else {
        log.warn(`No image generated for ${view} view`, {
          textResponse: result.text?.substring(0, 100),
        });
      }
    } catch (error) {
      log.error(`Failed to generate ${view} view:`, error);
      // Continue with other views even if one fails
    }
  }

  log.info(`Completed: ${sprites.length}/${views.length} sprites generated`);

  return sprites;
}

/**
 * Generate a single sprite for thumbnail use
 *
 * Uses isometric view by default as it's best for inventory/UI display
 */
export async function generateThumbnailSprite(
  asset: AssetInfo,
  options: {
    style?: SpriteGenerationOptions["style"];
    resolution?: number;
    colorPalette?: string;
  } = {},
): Promise<SpriteResult | null> {
  const sprites = await generateSpritesForAsset(asset, {
    views: ["isometric"], // Isometric is best for thumbnails
    style: options.style || "clean",
    resolution: options.resolution || 256, // Thumbnails can be smaller
    colorPalette: options.colorPalette,
  });

  return sprites.length > 0 ? sprites[0] : null;
}

/**
 * Generate a sprite sheet with all views for animation
 *
 * Useful for top-down or isometric games that need directional sprites
 */
export async function generateSpriteSheet(
  asset: AssetInfo,
  options: SpriteGenerationOptions = {},
): Promise<{
  sprites: SpriteResult[];
  sheetLayout: { rows: number; cols: number };
}> {
  // Generate all 4 cardinal directions + diagonals for 8-way movement
  const views = options.views || [
    "front",
    "front-right",
    "side",
    "back-right",
    "back",
    "back-left",
    "side-left",
    "front-left",
  ];

  const sprites = await generateSpritesForAsset(asset, {
    ...options,
    views,
  });

  // Calculate sheet layout (prefer square-ish layout)
  const count = sprites.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  return {
    sprites,
    sheetLayout: { rows, cols },
  };
}
