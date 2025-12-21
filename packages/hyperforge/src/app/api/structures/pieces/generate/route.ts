/**
 * Building Piece Generation API
 *
 * Generates a building piece via Meshy and saves it to Supabase storage.
 *
 * POST /api/structures/pieces/generate
 * Body: { type, style, prompt?, name? }
 *
 * This is a long-running operation that:
 * 1. Starts Meshy text-to-3d preview task
 * 2. Polls until complete
 * 3. Starts Meshy refine task for texturing
 * 4. Polls until complete
 * 5. Downloads GLB and thumbnail from Meshy
 * 6. Uploads to Supabase storage
 * 7. Saves piece to library with Supabase URLs
 *
 * Uses streaming to prevent timeout (Next.js default is 60s)
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import { addPiece } from "@/lib/structures/structure-service";
import {
  saveForgeAsset,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import type { BuildingPiece, BuildingPieceType } from "@/types/structures";

const log = logger.child("API:pieces:generate");

// Increase timeout for this route (5 minutes for long generation)
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Meshy API configuration
const MESHY_API_KEY = process.env.MESHY_API_KEY;
const MESHY_BASE_URL = "https://api.meshy.ai/v2";

// Prompt templates for each piece type - designed for modular assembly
// Each piece should be a discrete building block that connects with others
const PIECE_PROMPTS: Record<BuildingPieceType, string> = {
  // Solid wall segment - flat rectangle for stacking and tiling
  wall: "solid rectangular wall segment, flat sides, no holes, vertical slab shape, modular building block, seamless edges on all sides, game asset, low poly, isolated object on empty background",

  // Door is a wall section with door opening - replaces a wall segment
  door: "wall segment with door opening and frame, wooden door installed in stone wall section, same size as wall segment, modular piece, game asset, low poly, isolated object on empty background",

  // Window is a wall section with window opening - replaces a wall segment
  window:
    "wall segment with window opening and frame, window hole cut into wall section, same size as wall segment, modular piece that replaces wall, game asset, low poly, isolated object on empty background",

  // Roof is ONLY a flat roof tile/section - no walls, just the angled roof piece
  roof: "single flat roof tile section only, angled shingle panel, no walls, no building, just the roof piece, modular roof segment for placing on top of walls, game asset, low poly, isolated object on empty background",

  // Floor is ONLY a flat floor tile - no walls, just the ground piece
  floor:
    "single flat floor tile only, horizontal ground panel, no walls, no building, just the floor piece, modular floor segment, flat square shape, game asset, low poly, isolated object on empty background",
};

// Style variations for each piece type
const STYLE_VARIANTS: Record<BuildingPieceType, string[]> = {
  wall: ["stone", "brick", "wood plank", "cobblestone", "marble"],
  door: ["wooden", "iron reinforced", "double wooden", "ornate carved"],
  window: [
    "arched stone",
    "square wooden",
    "circular stained glass",
    "iron barred",
  ],
  roof: ["clay tile", "thatch straw", "slate stone", "wooden shingle"],
  floor: ["stone tile", "wood plank", "marble", "cobblestone"],
};

// Negative prompts to avoid unwanted elements
const NEGATIVE_PROMPTS: Record<BuildingPieceType, string> = {
  wall: "window, door, hole, opening, full building, house, multiple walls",
  door: "full building, house, multiple walls, interior, furniture",
  window: "full building, house, multiple walls, interior, furniture",
  roof: "walls, floor, full building, house, room, interior, door, window",
  floor:
    "walls, roof, full building, house, room, interior, door, window, furniture",
};

// Default dimensions
const DEFAULT_DIMENSIONS: Record<
  BuildingPieceType,
  { width: number; height: number; depth: number }
> = {
  wall: { width: 2, height: 3, depth: 0.3 },
  door: { width: 1, height: 2.5, depth: 0.15 },
  window: { width: 1, height: 1.5, depth: 0.1 },
  roof: { width: 2, height: 0.5, depth: 2 },
  floor: { width: 2, height: 0.1, depth: 2 },
};

// Polycount targets per type
const POLYCOUNT_TARGETS: Record<BuildingPieceType, number> = {
  wall: 500,
  door: 800,
  window: 400,
  roof: 600,
  floor: 200,
};

interface GenerateRequest {
  type: BuildingPieceType;
  style?: string;
  prompt?: string;
  name?: string;
  targetPolycount?: number;
  materialPresetId?: string;
  materialPrompt?: string;
}

// Helper to call Meshy API
async function meshyRequest(endpoint: string, body: Record<string, unknown>) {
  if (!MESHY_API_KEY) {
    throw new Error("MESHY_API_KEY not configured");
  }

  const res = await fetch(`${MESHY_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Meshy API error: ${error}`);
  }

  return res.json();
}

// Helper to get task status
async function getTaskStatus(taskId: string) {
  if (!MESHY_API_KEY) {
    throw new Error("MESHY_API_KEY not configured");
  }

  const res = await fetch(`${MESHY_BASE_URL}/text-to-3d/${taskId}`, {
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Meshy API error: ${error}`);
  }

  return res.json();
}

// Poll until task completes
async function pollTask(
  taskId: string,
  taskType: string,
  maxAttempts = 60,
): Promise<{
  status: string;
  model_urls?: Record<string, string>;
  thumbnail_url?: string;
}> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const task = await getTaskStatus(taskId);
      log.debug(`Poll ${taskType} attempt ${i + 1}/${maxAttempts}`, {
        status: task.status,
      });

      if (task.status === "SUCCEEDED") {
        return task;
      }

      if (task.status === "FAILED") {
        const errorMsg =
          task.task_error?.message || task.error || "Unknown error";
        throw new Error(`${taskType} task failed: ${errorMsg}`);
      }

      // Wait 5 seconds between polls
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (pollError) {
      // If it's a network error during polling, log and retry
      if (
        pollError instanceof Error &&
        !pollError.message.includes("task failed")
      ) {
        log.warn(`Poll error for ${taskType}, attempt ${i + 1}`, {
          error: pollError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      throw pollError;
    }
  }

  throw new Error(`${taskType} task timed out after ${maxAttempts} attempts`);
}

// Download file from URL as buffer
async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const {
      type,
      style,
      prompt: customPrompt,
      name,
      targetPolycount,
      materialPresetId,
      materialPrompt,
    } = body;

    if (!type || !["wall", "door", "window", "roof", "floor"].includes(type)) {
      return NextResponse.json(
        {
          error: "Valid piece type required (wall, door, window, roof, floor)",
        },
        { status: 400 },
      );
    }

    // Check Supabase is configured
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        {
          error:
            "Supabase storage not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
        },
        { status: 500 },
      );
    }

    // Use provided polycount or default for this piece type
    const polycount = targetPolycount || POLYCOUNT_TARGETS[type];

    log.info("Starting piece generation", {
      type,
      style,
      polycount,
      materialPresetId,
    });

    // Build prompt with style variation
    const basePrompt = PIECE_PROMPTS[type];
    const styleText = style || STYLE_VARIANTS[type][0];
    const negativePrompt = NEGATIVE_PROMPTS[type];

    // Build the final prompt - incorporate style and material into the base prompt
    let prompt: string;
    if (customPrompt) {
      prompt = customPrompt;
    } else {
      // Insert style at the beginning of the prompt
      prompt = `${styleText} ${basePrompt}`;

      // If a material preset is provided, append its style prompt
      if (materialPrompt) {
        prompt = `${prompt}, ${materialPrompt}`;
      }
    }

    // Step 1: Create preview task
    log.info("Creating preview task", { prompt, negativePrompt, polycount });
    const previewResponse = await meshyRequest("/text-to-3d", {
      mode: "preview",
      prompt,
      negative_prompt: negativePrompt,
      art_style: "realistic",
      ai_model: "meshy-4",
      topology: "triangle",
      target_polycount: polycount,
    });

    const previewTaskId = previewResponse.result;
    log.info("Preview task created", { taskId: previewTaskId });

    // Step 2: Poll preview task
    await pollTask(previewTaskId, "preview");
    log.info("Preview completed", { taskId: previewTaskId });

    // Step 3: Create refine task with appropriate texture
    log.info("Starting refine task", { previewTaskId });

    // Build texture prompt based on piece type
    const texturePrompts: Record<BuildingPieceType, string> = {
      wall: `${styleText} wall texture, seamless tiling, weathered, medieval, game asset`,
      door: `${styleText} door with ${styleText} frame, medieval wood grain, iron hardware, game asset`,
      window: `${styleText} window frame texture, glass panes, medieval style, game asset`,
      roof: `${styleText} roof tiles texture, overlapping pattern, weathered, game asset`,
      floor: `${styleText} floor texture, seamless tiling, worn surface, game asset`,
    };

    // If material preset provided, use its style prompt for texturing
    let texturePrompt = texturePrompts[type];
    if (materialPrompt) {
      texturePrompt = `${texturePrompt}, ${materialPrompt}`;
    }

    const refineResponse = await meshyRequest("/text-to-3d", {
      mode: "refine",
      preview_task_id: previewTaskId,
      enable_pbr: true,
      texture_prompt: texturePrompt,
    });

    const refineTaskId = refineResponse.result;
    log.info("Refine task created", { taskId: refineTaskId });

    // Step 4: Poll refine task
    const refineResult = await pollTask(refineTaskId, "refine");
    log.info("Refine completed", { taskId: refineTaskId });

    // Step 5: Download model and thumbnail from Meshy
    const meshyModelUrl = refineResult.model_urls?.glb;
    const meshyThumbnailUrl = refineResult.thumbnail_url;

    if (!meshyModelUrl) {
      throw new Error("No model URL returned from Meshy");
    }

    log.info("Downloading model from Meshy", { url: meshyModelUrl });
    const modelBuffer = await downloadFile(meshyModelUrl);

    let thumbnailBuffer: Buffer | undefined;
    if (meshyThumbnailUrl) {
      log.info("Downloading thumbnail from Meshy", { url: meshyThumbnailUrl });
      thumbnailBuffer = await downloadFile(meshyThumbnailUrl);
    }

    // Step 6: Generate piece ID and upload to Supabase
    const pieceId = `piece_${type}_${styleText.replace(/\s+/g, "_")}_${Date.now()}`;
    const pieceName =
      name ||
      `${styleText.charAt(0).toUpperCase() + styleText.slice(1)} ${type.charAt(0).toUpperCase() + type.slice(1)}`;

    log.info("Uploading to Supabase storage", { pieceId });

    // Upload model to meshy-models bucket
    const savedAsset = await saveForgeAsset({
      assetId: pieceId,
      modelBuffer,
      modelFormat: "glb",
      thumbnailBuffer,
      metadata: {
        type: "building-piece",
        pieceType: type,
        style: styleText,
        prompt,
        meshyTaskId: refineTaskId,
        name: pieceName,
      },
    });

    log.info("Uploaded to Supabase", {
      modelUrl: savedAsset.modelUrl,
      thumbnailUrl: savedAsset.thumbnailUrl,
    });

    // Step 7: Create piece and save to library
    const piece: BuildingPiece = {
      id: pieceId,
      name: pieceName,
      type: type as BuildingPieceType,
      modelUrl: savedAsset.modelUrl, // Supabase URL, not Meshy URL
      thumbnailUrl: savedAsset.thumbnailUrl || "",
      dimensions: DEFAULT_DIMENSIONS[type],
      snapPoints: [],
      generatedAt: new Date().toISOString(),
      meshyTaskId: refineTaskId,
      prompt,
    };

    await addPiece(piece);
    log.info("Piece saved to library", { pieceId });

    return NextResponse.json({
      success: true,
      piece,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error("Piece generation failed", {
      message: errorMessage,
      stack: errorStack,
      name: error instanceof Error ? error.name : "Unknown",
    });
    return NextResponse.json(
      { error: errorMessage || "Generation failed" },
      { status: 500 },
    );
  }
}

// GET - Get available styles for a type
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as BuildingPieceType | null;

  if (!type || !STYLE_VARIANTS[type]) {
    return NextResponse.json({
      types: Object.keys(PIECE_PROMPTS),
      styles: STYLE_VARIANTS,
    });
  }

  return NextResponse.json({
    type,
    styles: STYLE_VARIANTS[type],
    defaultPrompt: PIECE_PROMPTS[type],
    dimensions: DEFAULT_DIMENSIONS[type],
  });
}
