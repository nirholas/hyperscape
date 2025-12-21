/**
 * Building Pieces API
 *
 * CRUD operations for building piece definitions.
 *
 * GET /api/structures/pieces - List all pieces
 * GET /api/structures/pieces?id=xxx - Get single piece
 * POST /api/structures/pieces - Add new piece
 * DELETE /api/structures/pieces?id=xxx - Delete piece
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import {
  loadPieceLibrary,
  getPiece,
  addPiece,
  deletePiece,
} from "@/lib/structures/structure-service";
import type { BuildingPiece } from "@/types/structures";

const log = logger.child("API:pieces");

// =============================================================================
// GET - List or get single piece
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type");

    if (id) {
      // Get single piece
      const piece = await getPiece(id);
      if (!piece) {
        return NextResponse.json({ error: "Piece not found" }, { status: 404 });
      }
      return NextResponse.json(piece);
    }

    // List all pieces, optionally filtered by type
    const library = await loadPieceLibrary();
    let pieces = library.pieces;

    if (type) {
      pieces = pieces.filter((p) => p.type === type);
    }

    return NextResponse.json({
      pieces,
      categories: library.categories,
      lastUpdated: library.lastUpdated,
    });
  } catch (error) {
    log.error("Failed to get pieces", { error });
    return NextResponse.json(
      { error: "Failed to get pieces" },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST - Add new piece
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const piece = body as BuildingPiece;

    if (!piece.id || !piece.name || !piece.type) {
      return NextResponse.json(
        { error: "Piece must have id, name, and type" },
        { status: 400 },
      );
    }

    const saved = await addPiece(piece);
    log.info("Added piece", { id: saved.id, type: saved.type });

    return NextResponse.json({ success: true, piece: saved });
  } catch (error) {
    log.error("Failed to add piece", { error });

    if ((error as Error).message?.includes("already exists")) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Failed to add piece" }, { status: 500 });
  }
}

// =============================================================================
// DELETE - Delete piece
// =============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Piece ID required" }, { status: 400 });
    }

    const deleted = await deletePiece(id);
    if (!deleted) {
      return NextResponse.json({ error: "Piece not found" }, { status: 404 });
    }

    log.info("Deleted piece", { id });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete piece", { error });
    return NextResponse.json(
      { error: "Failed to delete piece" },
      { status: 500 },
    );
  }
}
