/**
 * Structure Baking API
 *
 * Marks a structure as "baked" and saves it.
 *
 * Future implementation would merge all pieces into a single GLB model.
 * For now, it just saves the structure with a baked flag so it appears
 * in the "Completed Buildings" section.
 *
 * POST /api/structures/bake
 * Body: { structureId, structure, options }
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import {
  upsertStructure,
  loadPieceLibrary,
} from "@/lib/structures/structure-service";
import {
  saveBakedBuilding,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import type {
  StructureDefinition,
  BakeRequest,
  BakeResult,
  BuildingPiece,
} from "@/types/structures";

const log = logger.child("API:bake");

// =============================================================================
// BAKING LOGIC
// =============================================================================

/**
 * Bake a structure - marks it as complete and saves it
 *
 * Full GLB merging implementation would:
 * 1. Load all piece GLBs from their URLs
 * 2. Apply transforms (position, rotation, scale) to each piece
 * 3. Merge geometries using Three.js BufferGeometryUtils
 * 4. Combine materials where possible
 * 5. Export as single GLB using GLTFExporter
 * 6. Upload to CDN and return URL
 *
 * For now, we just mark the structure as baked and use the first piece's
 * thumbnail as the structure thumbnail.
 */
async function bakeStructure(
  structure: StructureDefinition,
  options?: BakeRequest["options"],
): Promise<BakeResult> {
  log.info("Baking structure", {
    id: structure.id,
    pieceCount: structure.pieces.length,
    options,
  });

  // Validate structure has pieces
  if (structure.pieces.length === 0) {
    return {
      status: "error",
      error: "Structure has no pieces to bake",
    };
  }

  try {
    // Load piece library to get thumbnail from first piece
    const pieceLibrary = await loadPieceLibrary();
    const pieceMap = new Map<string, BuildingPiece>();
    for (const p of pieceLibrary.pieces) {
      pieceMap.set(p.id, p);
    }

    // Get thumbnail from first piece that has one
    let thumbnailUrl = "";
    let thumbnailBuffer: Buffer | undefined;
    for (const placed of structure.pieces) {
      const piece = pieceMap.get(placed.pieceId);
      if (piece?.thumbnailUrl) {
        thumbnailUrl = piece.thumbnailUrl;
        // Download thumbnail for re-upload to baked-structures bucket
        try {
          const res = await fetch(piece.thumbnailUrl);
          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            thumbnailBuffer = Buffer.from(arrayBuffer);
          }
        } catch {
          log.warn("Failed to download piece thumbnail for baking", {
            pieceId: piece.id,
          });
        }
        break;
      }
    }

    const bakedAt = new Date().toISOString();
    let bakedModelUrl = `baked:${structure.id}`;
    let finalThumbnailUrl = thumbnailUrl;

    // Save to Supabase baked-structures bucket if configured
    if (isSupabaseConfigured()) {
      try {
        const savedFiles = await saveBakedBuilding({
          buildingId: structure.id,
          definition: {
            ...structure,
            bakedAt,
          },
          thumbnailBuffer,
        });

        // Use Supabase URLs
        bakedModelUrl = savedFiles.definitionUrl;
        if (savedFiles.thumbnailUrl) {
          finalThumbnailUrl = savedFiles.thumbnailUrl;
        }

        log.info("Saved baked building to Supabase", {
          id: structure.id,
          definitionUrl: savedFiles.definitionUrl,
        });
      } catch (uploadError) {
        log.warn("Failed to save to Supabase, using local storage", {
          error:
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError),
        });
      }
    }

    // Update structure with baked info
    const bakedStructure: StructureDefinition = {
      ...structure,
      bakedModelUrl,
      bakedAt,
      thumbnailUrl: finalThumbnailUrl || structure.thumbnailUrl,
      updatedAt: bakedAt,
    };

    // Save the baked structure to local storage as well
    await upsertStructure(bakedStructure);

    log.info("Structure baked successfully", {
      id: structure.id,
      pieceCount: structure.pieces.length,
      savedToSupabase: isSupabaseConfigured(),
    });

    return {
      status: "complete",
      modelUrl: bakedModelUrl,
      thumbnailUrl: finalThumbnailUrl,
      originalPieceCount: structure.pieces.length,
      mergedMeshCount: 1,
      fileSizeBytes: 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Baking failed", { error: errorMsg, structureId: structure.id });
    return {
      status: "error",
      error: errorMsg || "Unknown baking error",
    };
  }
}

// =============================================================================
// API HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      structureId: _structureId,
      structure,
      options,
    } = body as BakeRequest;

    if (!structure) {
      return NextResponse.json(
        { error: "Structure required for baking" },
        { status: 400 },
      );
    }

    const result = await bakeStructure(structure, options);

    if (result.status === "error") {
      return NextResponse.json(
        { error: result.error, result },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    log.error("Baking API error", { error });
    return NextResponse.json(
      { error: "Failed to bake structure" },
      { status: 500 },
    );
  }
}

/**
 * GET - Check baking status (for async baking jobs)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Job ID required" }, { status: 400 });
  }

  // For now, return completed status
  // Would check actual job status from queue/database
  return NextResponse.json({
    jobId,
    status: "complete",
    progress: 100,
  });
}
