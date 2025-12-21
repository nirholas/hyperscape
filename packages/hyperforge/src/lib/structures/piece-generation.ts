/**
 * Piece Generation Service
 *
 * Generates building pieces using Meshy API with pre-configured prompts
 * optimized for modular building construction.
 */

import { logger } from "@/lib/utils";
import {
  startTextTo3DPreview,
  startTextTo3DRefine,
} from "@/lib/meshy/text-to-3d";
import { pollTaskUntilComplete } from "@/lib/meshy/poll-task";
import type {
  BuildingPiece,
  BuildingPieceType,
  PieceDimensions,
} from "@/types/structures";
import type { TextTo3DOptions } from "@/lib/meshy/types";

const log = logger.child("PieceGeneration");

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

/**
 * Base prompts for each piece type, designed for seamless tiling
 */
const PIECE_PROMPTS: Record<BuildingPieceType, string> = {
  wall: "medieval stone wall segment, flat rectangular shape, seamless edges, simple geometry, game asset, low poly, side view",
  door: "wooden door with stone frame, medieval style, simple rectangular shape, game asset, low poly, centered, isolated",
  window:
    "arched window frame, stone material, simple geometry, game asset, low poly, centered, isolated on white",
  roof: "clay tile roof section, rectangular flat base, simple geometry, game asset, low poly, top-down view",
  floor:
    "stone floor tile, flat square, seamless edges, simple geometry, game asset, low poly, top-down view",
};

/**
 * Style variations for each piece type
 */
const STYLE_VARIANTS: Record<BuildingPieceType, string[]> = {
  wall: ["stone", "brick", "wood plank", "cobblestone", "marble"],
  door: ["wooden", "iron", "reinforced", "ornate", "simple"],
  window: ["arched", "square", "circular", "stained glass", "barred"],
  roof: ["clay tile", "thatch", "slate", "wooden shingle", "copper"],
  floor: ["stone", "wood plank", "marble", "cobblestone", "dirt"],
};

/**
 * Default dimensions for each piece type (in meters)
 */
const DEFAULT_DIMENSIONS: Record<BuildingPieceType, PieceDimensions> = {
  wall: { width: 2, height: 3, depth: 0.3 },
  door: { width: 1, height: 2.5, depth: 0.15 },
  window: { width: 1, height: 1.5, depth: 0.1 },
  roof: { width: 2, height: 0.5, depth: 2 },
  floor: { width: 2, height: 0.1, depth: 2 },
};

/**
 * Polycount targets for each piece type
 */
const POLYCOUNT_TARGETS: Record<BuildingPieceType, number> = {
  wall: 500,
  door: 800,
  window: 400,
  roof: 600,
  floor: 200,
};

// =============================================================================
// GENERATION OPTIONS
// =============================================================================

export interface PieceGenerationOptions {
  type: BuildingPieceType;
  style?: string;
  customPrompt?: string;
  dimensions?: PieceDimensions;
}

export interface PieceGenerationResult {
  piece: BuildingPiece;
  previewTaskId: string;
  refineTaskId?: string;
}

// =============================================================================
// GENERATION FUNCTIONS
// =============================================================================

/**
 * Build the generation prompt for a piece
 */
export function buildPiecePrompt(options: PieceGenerationOptions): string {
  if (options.customPrompt) {
    return options.customPrompt;
  }

  const basePrompt = PIECE_PROMPTS[options.type];
  const style = options.style || STYLE_VARIANTS[options.type][0];

  // Replace generic material with specific style
  return basePrompt.replace(/stone|wooden|clay tile/i, style);
}

/**
 * Generate a building piece using Meshy API
 *
 * @param options Generation options
 * @returns The generated piece with model URL
 */
export async function generatePiece(
  options: PieceGenerationOptions,
): Promise<PieceGenerationResult> {
  const prompt = buildPiecePrompt(options);
  const polycount = POLYCOUNT_TARGETS[options.type];
  const dimensions = options.dimensions || DEFAULT_DIMENSIONS[options.type];

  log.info("Starting piece generation", {
    type: options.type,
    style: options.style,
    polycount,
  });

  // Start preview generation
  const meshyOptions: Partial<TextTo3DOptions> = {
    target_polycount: polycount,
    art_style: "realistic",
    should_remesh: true,
    symmetry_mode: "auto",
  };

  const { previewTaskId } = await startTextTo3DPreview(prompt, meshyOptions);
  log.info("Preview task started", { taskId: previewTaskId });

  // Wait for preview to complete
  const previewResult = await pollTaskUntilComplete(previewTaskId, {
    maxAttempts: 60, // 5 minutes
    delayMs: 5000,
  });

  if (previewResult.status !== "SUCCEEDED") {
    throw new Error(`Preview generation failed: ${previewResult.status}`);
  }

  // Start refine stage for texturing
  const { refineTaskId } = await startTextTo3DRefine(previewTaskId, {
    enable_pbr: true,
    texture_prompt:
      `${options.style || ""} texture, game asset, seamless`.trim(),
  });
  log.info("Refine task started", { taskId: refineTaskId });

  // Wait for refine to complete
  const refineResult = await pollTaskUntilComplete(refineTaskId, {
    maxAttempts: 60,
    delayMs: 5000,
  });

  if (refineResult.status !== "SUCCEEDED") {
    throw new Error(`Refine generation failed: ${refineResult.status}`);
  }

  // Build the piece object
  const pieceId = `${options.type}_${options.style || "default"}_${Date.now()}`;
  const piece: BuildingPiece = {
    id: pieceId,
    name: `${options.style || "Default"} ${options.type.charAt(0).toUpperCase() + options.type.slice(1)}`,
    type: options.type,
    modelUrl: refineResult.model_urls?.glb || "",
    thumbnailUrl: refineResult.thumbnail_url || "",
    dimensions,
    snapPoints: [],
    generatedAt: new Date().toISOString(),
    meshyTaskId: refineTaskId,
    prompt,
  };

  log.info("Piece generation complete", {
    pieceId,
    modelUrl: piece.modelUrl,
  });

  return {
    piece,
    previewTaskId,
    refineTaskId,
  };
}

/**
 * Get available style variants for a piece type
 */
export function getStyleVariants(type: BuildingPieceType): string[] {
  return STYLE_VARIANTS[type] || [];
}

/**
 * Get default prompt for a piece type
 */
export function getDefaultPrompt(type: BuildingPieceType): string {
  return PIECE_PROMPTS[type] || "";
}

/**
 * Get default dimensions for a piece type
 */
export function getDefaultDimensions(type: BuildingPieceType): PieceDimensions {
  return DEFAULT_DIMENSIONS[type] || { width: 1, height: 1, depth: 1 };
}
