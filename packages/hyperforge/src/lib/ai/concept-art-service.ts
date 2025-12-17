/**
 * Concept Art Generation Service
 * Uses Vercel AI Gateway with Google Gemini for 2D concept art generation
 *
 * Generates concept art images that can be used:
 * 1. As visual reference for the asset
 * 2. As texture_image_url in Meshy refine stage for better texturing
 * 3. As input for Image-to-3D pipeline
 *
 * NOTE: Meshy requires HTTP/HTTPS URLs for texture_image_url, not data URLs.
 * This service saves generated images to Supabase Storage (preferred) or local filesystem.
 */

import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { promises as fs } from "fs";
import path from "path";
import {
  isSupabaseConfigured,
  uploadConceptArt,
} from "@/lib/storage/supabase-storage";
import { TASK_MODELS } from "./providers";
import { logger } from "@/lib/utils";

const log = logger.child("Concept Art");

/**
 * System prompt for concept art generation
 * Instructs the model to ONLY generate a concept art image
 */
export const CONCEPT_ART_SYSTEM_PROMPT = `You are a professional concept artist for video games. Your ONLY task is to generate high-quality concept art images.

CRITICAL INSTRUCTIONS:
- Generate EXACTLY ONE concept art image based on the description
- Do NOT include any text, labels, annotations, or watermarks
- Do NOT include any explanations or descriptions in your response
- Do NOT ask clarifying questions
- Focus on clear material definition, lighting, and form
- The image should be suitable as a reference for 3D modeling

Your response must contain ONLY the generated concept art image.`;

export interface ConceptArtResult {
  imageUrl: string; // HTTP URL for Meshy (preferred) or data URL (fallback)
  dataUrl: string; // Data URL for preview
  base64: string;
  mediaType: string;
}

export interface ConceptArtOptions {
  style?: "realistic" | "stylized" | "pixel" | "painterly";
  viewAngle?: "front" | "side" | "isometric" | "three-quarter";
  background?: "transparent" | "simple" | "contextual";
  assetType?: string;
}

/**
 * Build a detailed prompt for concept art generation
 */
export function buildConceptArtPrompt(
  assetDescription: string,
  options: ConceptArtOptions = {},
): string {
  const {
    style = "realistic",
    viewAngle = "isometric",
    background = "simple",
    assetType = "object",
  } = options;

  const styleDescriptions: Record<string, string> = {
    realistic:
      "photorealistic rendering with accurate lighting, materials, and textures",
    stylized:
      "stylized 3D game art style with vibrant colors and clean shapes, similar to Fortnite or Overwatch",
    pixel: "high-quality pixel art style with clean edges and retro aesthetic",
    painterly:
      "hand-painted digital art style with visible brushstrokes and rich colors",
  };

  const viewDescriptions: Record<string, string> = {
    front: "front-facing view, centered and symmetrical",
    side: "side profile view showing the full silhouette",
    isometric:
      "isometric 3/4 view from slightly above, typical for game assets",
    "three-quarter":
      "three-quarter view showing depth and multiple sides of the object",
  };

  const backgroundDescriptions: Record<string, string> = {
    transparent: "on a transparent or solid neutral background",
    simple: "on a clean, simple gradient background that doesn't distract",
    contextual: "in an appropriate environmental context",
  };

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

  const typeHint = assetTypeHints[assetType] || "";

  return `Create a high-quality concept art image for a 3D game asset:

"${assetDescription}"

STYLE: ${styleDescriptions[style]}
VIEW: ${viewDescriptions[viewAngle]}
BACKGROUND: ${backgroundDescriptions[background]}

REQUIREMENTS:
- Clear, well-defined silhouette suitable for 3D modeling
- Visible material properties (metal should look metallic, wood should look wooden, etc.)
- Good lighting that reveals form and surface details
- Colors that are vibrant but not oversaturated
- High detail level appropriate for a AAA game asset
${typeHint}

This image will be used as a reference for 3D texturing, so ensure colors and materials are clearly visible.

Generate ONLY the concept art image, no text, labels, or annotations.`;
}

/**
 * Generate concept art using AI Gateway
 * Saves the image to Supabase Storage (preferred) or local filesystem
 * Returns an HTTP URL for Meshy API compatibility
 */
export async function generateConceptArt(
  assetDescription: string,
  options: ConceptArtOptions = {},
): Promise<ConceptArtResult | null> {
  log.debug(
    `Generating concept art for: ${assetDescription.substring(0, 100)}...`,
  );

  try {
    const prompt = buildConceptArtPrompt(assetDescription, options);
    const model = TASK_MODELS.imageGeneration;

    // Use AI Gateway with system prompt for consistent image-only output
    const result = await generateText({
      model: gateway(model),
      system: CONCEPT_ART_SYSTEM_PROMPT,
      prompt,
    });

    // Extract images from result.files (Gemini image models return files)
    const imageFiles = result.files?.filter((f) =>
      f.mediaType?.startsWith("image/"),
    );

    if (imageFiles && imageFiles.length > 0) {
      const file = imageFiles[0];

      // Convert uint8Array to base64 and buffer
      const buffer = Buffer.from(file.uint8Array);
      const base64 = buffer.toString("base64");
      const mediaType = file.mediaType || "image/png";
      const dataUrl = `data:${mediaType};base64,${base64}`;

      // Try Supabase Storage first (recommended for production)
      if (isSupabaseConfigured()) {
        log.debug("Uploading to Supabase Storage...");

        const uploadResult = await uploadConceptArt(buffer, mediaType);

        if (uploadResult.success) {
          log.info(`Uploaded to Supabase: ${uploadResult.url}`);

          return {
            imageUrl: uploadResult.url, // Supabase public URL
            dataUrl, // Data URL for preview
            base64,
            mediaType,
          };
        } else {
          log.warn(
            "Supabase upload failed, falling back to local:",
            uploadResult.error,
          );
          // Fall through to local storage
        }
      }

      // Fallback: Save to local filesystem
      log.debug("Saving to local filesystem...");
      const assetsDir =
        process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
      const uploadsDir = path.join(assetsDir, "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = mediaType.includes("png") ? "png" : "jpg";
      const filename = `concept_${timestamp}_${randomId}.${extension}`;
      const filepath = path.join(uploadsDir, filename);

      // Save the file
      await fs.writeFile(filepath, buffer);

      // Generate HTTP URL
      const cdnUrl =
        process.env.CDN_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        "http://localhost:3500";
      const httpUrl = `${cdnUrl}/api/upload/image/${filename}`;

      log.info(`Saved locally: ${httpUrl}`);

      return {
        imageUrl: httpUrl, // HTTP URL for Meshy
        dataUrl, // Data URL for preview
        base64,
        mediaType,
      };
    } else {
      log.warn(
        `No image generated, text response:`,
        result.text?.substring(0, 100),
      );
      return null;
    }
  } catch (error) {
    log.error(`Generation failed:`, error);
    return null;
  }
}

/**
 * Generate concept art and save to asset storage
 */
export async function generateAndSaveConceptArt(
  assetId: string,
  assetDescription: string,
  options: ConceptArtOptions = {},
): Promise<string | null> {
  const result = await generateConceptArt(assetDescription, options);

  if (!result) {
    return null;
  }

  // Import fs dynamically to avoid issues in browser context
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const assetsDir =
    process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
  const assetDir = path.join(assetsDir, assetId);

  // Ensure directory exists
  await fs.mkdir(assetDir, { recursive: true });

  // Save concept art
  const filename = "concept-art.png";
  const filepath = path.join(assetDir, filename);
  const buffer = Buffer.from(result.base64, "base64");
  await fs.writeFile(filepath, buffer);

  log.info(`Saved to: ${filepath}`);

  return `/api/assets/${assetId}/${filename}`;
}
