import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { promises as fs } from "fs";
import path from "path";
import {
  isSupabaseConfigured,
  uploadConceptArt,
} from "@/lib/storage/supabase-storage";
import { logger } from "@/lib/utils";

const log = logger.child("API:images/generate");

interface GenerateRequest {
  type: "concept-art" | "sprite" | "texture";
  prompt: string;
  options?: {
    style?: string;
    viewAngle?: string;
    assetType?: string;
    background?: string;
    spriteType?: string;
    transparent?: boolean;
    textureType?: string;
    resolution?: string;
    seamless?: boolean;
  };
}

/**
 * Build prompt based on image type
 */
function buildPrompt(
  type: string,
  userPrompt: string,
  options: GenerateRequest["options"] = {},
): string {
  switch (type) {
    case "concept-art":
      return buildConceptArtPrompt(userPrompt, options);
    case "sprite":
      return buildSpritePrompt(userPrompt, options);
    case "texture":
      return buildTexturePrompt(userPrompt, options);
    default:
      return userPrompt;
  }
}

function buildConceptArtPrompt(
  description: string,
  options: GenerateRequest["options"] = {},
): string {
  const {
    style = "stylized",
    viewAngle = "isometric",
    background: _background = "simple",
    assetType = "item",
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
    "three-quarter": "three-quarter view showing depth and multiple sides",
  };

  // Asset type specific guidelines - critical for 3D model texturing and rigging
  const assetTypeGuidelines: Record<string, string> = {
    character: `
CHARACTER-SPECIFIC REQUIREMENTS (Critical for 3D rigging):
- T-pose or A-pose with visible limbs, hands, and feet
- EMPTY HANDS - absolutely no weapons, items, or objects being held
- NO bulky or oversized armor - keep silhouette clean
- NO flowing capes, long robes, or loose fabric
- Form-fitting or simple clothing that shows body shape
- Clear separation between body parts for rigging`,
    npc: `
NPC-SPECIFIC REQUIREMENTS (Critical for 3D rigging):
- T-pose or A-pose with visible limbs, hands, and feet
- EMPTY HANDS - absolutely no weapons, tools, or items being held
- NO bulky armor or oversized shoulder pads
- NO flowing capes, long robes, or billowing fabric
- Form-fitting clothing that doesn't obscure body silhouette
- Simple accessories only - nothing that dangles or flows`,
    mob: `
MOB/CREATURE REQUIREMENTS (Critical for 3D rigging):
- T-pose or neutral stance with visible limbs
- EMPTY hands/claws - no weapons or items held
- NO excessive spikes, horns, or protrusions that complicate rigging
- NO flowing elements like long tails, capes, or tentacles
- Clearly defined body shape and muscle structure
- Keep silhouette clean and readable`,
    enemy: `
ENEMY CHARACTER REQUIREMENTS (Critical for 3D rigging):
- T-pose or A-pose with visible limbs
- EMPTY HANDS - no weapons being held (weapons are separate assets)
- NO bulky oversized armor
- NO flowing capes, robes, or loose clothing
- Form-fitting design that shows body structure
- Clean silhouette for easy texturing`,
    weapon: `
WEAPON REQUIREMENTS:
- Clear grip/handle area for character attachment
- Detailed blade/head with visible materials
- Appropriate scale reference`,
    armor: `
ARMOR REQUIREMENTS:
- Form-fitting design, not overly bulky
- Clear structure with visible plates and straps
- Material details (metal, leather, cloth) clearly visible`,
    item: "",
    prop: "",
  };

  const typeGuideline = assetTypeGuidelines[assetType] || "";

  return `Create a high-quality concept art image for a 3D game asset:

"${description}"

STYLE: ${styleDescriptions[style] || styleDescriptions.stylized}
VIEW: ${viewDescriptions[viewAngle] || viewDescriptions.isometric}
BACKGROUND: Clean, simple gradient background

REQUIREMENTS:
- Clear, well-defined silhouette suitable for 3D modeling
- Visible material properties (metal should look metallic, wood should look wooden, etc.)
- Good lighting that reveals form and surface details
- Colors that are vibrant but not oversaturated
- High detail level appropriate for a AAA game asset
${typeGuideline}

Generate ONLY the concept art image, no text, labels, or annotations.`;
}

function buildSpritePrompt(
  description: string,
  options: GenerateRequest["options"] = {},
): string {
  const {
    style = "pixel-32",
    spriteType = "item",
    transparent = true,
  } = options;

  const styleGuide: Record<string, string> = {
    "pixel-16":
      "16x16 pixel art with limited color palette, clean pixels, no anti-aliasing",
    "pixel-32": "32x32 pixel art with clear shapes and limited color palette",
    "pixel-64": "64x64 detailed pixel art with clean pixel edges",
    "hand-drawn": "hand-drawn illustration style with clean lines",
    flat: "flat vector art style with solid colors and minimal shading",
  };

  return `Create a 2D game sprite:

"${description}"

STYLE: ${styleGuide[style] || styleGuide["pixel-32"]}
TYPE: ${spriteType} sprite for a 2D/isometric RPG game
BACKGROUND: ${transparent ? "Completely transparent background (alpha channel)" : "Simple solid color background"}

REQUIREMENTS:
- Single centered sprite, game-ready
- Clear silhouette and readable at small sizes
- Consistent pixel sizing (no sub-pixels)
- ${style.startsWith("pixel") ? "Clean pixel art edges, no blur or anti-aliasing" : "Clean vector-like edges"}

Generate ONLY the sprite, no text or annotations.`;
}

function buildTexturePrompt(
  description: string,
  options: GenerateRequest["options"] = {},
): string {
  const {
    style = "stylized",
    textureType = "ground",
    resolution = "1024",
    seamless = true,
  } = options;

  const styleGuide: Record<string, string> = {
    realistic: "photorealistic texture with accurate material properties",
    stylized:
      "hand-painted stylized texture for a 3D game (similar to WoW or Fortnite)",
    painted: "artistic hand-painted texture with visible brush strokes",
    procedural: "clean procedural-style pattern with geometric regularity",
  };

  return `Create a ${seamless ? "seamless tileable" : "standard"} texture:

"${description}"

STYLE: ${styleGuide[style] || styleGuide.stylized}
TYPE: ${textureType} material texture
RESOLUTION: ${resolution}x${resolution} pixels

REQUIREMENTS:
- ${seamless ? "Edges must tile perfectly when repeated (seamless)" : "Standard texture format"}
- Clear material definition (${textureType})
- Appropriate surface detail and normal-mappable features
- Good color distribution without obvious repetition artifacts
- Suitable for 3D game environments

Generate ONLY the texture, no text or annotations.`;
}

/**
 * POST /api/images/generate
 * Generate images using Vercel AI Gateway
 */
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { type, prompt, options } = body;

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    log.info({ type, prompt: prompt.substring(0, 100) }, "Generating image");

    // Build the full prompt
    const fullPrompt = buildPrompt(type, prompt, options);

    // Generate using Vercel AI Gateway with Gemini
    const result = await generateText({
      model: gateway("google/gemini-2.5-flash-image"),
      prompt: fullPrompt,
    });

    // Extract image from result
    const imageFiles = result.files?.filter((f) =>
      f.mediaType?.startsWith("image/"),
    );

    if (!imageFiles || imageFiles.length === 0) {
      log.warn(
        { textResponse: result.text?.substring(0, 100) },
        "No image generated",
      );
      return NextResponse.json(
        { error: "Failed to generate image - no image in response" },
        { status: 500 },
      );
    }

    const file = imageFiles[0];
    const buffer = Buffer.from(file.uint8Array);
    const base64 = buffer.toString("base64");
    const mediaType = file.mediaType || "image/png";
    const dataUrl = `data:${mediaType};base64,${base64}`;

    // Generate unique ID
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const id = `${type}_${timestamp}_${randomId}`;
    const extension = mediaType.includes("png") ? "png" : "jpg";
    const filename = `${id}.${extension}`;

    let imageUrl = dataUrl;

    // Try to upload to Supabase for persistent storage
    if (isSupabaseConfigured()) {
      log.info("Uploading to Supabase Storage...");
      const uploadResult = await uploadConceptArt(buffer, mediaType);

      if (uploadResult.success) {
        imageUrl = uploadResult.url;
        log.info({ imageUrl }, "Uploaded to Supabase");
      } else {
        log.warn("Supabase upload failed, using local storage");
      }
    }

    // Fallback to local storage
    if (imageUrl === dataUrl) {
      const assetsDir =
        process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
      const imagesDir = path.join(assetsDir, "images", type);
      await fs.mkdir(imagesDir, { recursive: true });

      const filepath = path.join(imagesDir, filename);
      await fs.writeFile(filepath, buffer);

      const cdnUrl =
        process.env.CDN_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        "http://localhost:3500";
      imageUrl = `${cdnUrl}/api/images/file/${type}/${filename}`;

      log.info({ imageUrl }, "Saved locally");
    }

    return NextResponse.json({
      success: true,
      image: {
        id,
        filename,
        url: imageUrl,
        thumbnailUrl: imageUrl,
        type,
        prompt,
        mediaType,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error({ error }, "Image generation failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 },
    );
  }
}
