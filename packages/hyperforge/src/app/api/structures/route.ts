/**
 * Structures API
 *
 * CRUD operations for structure definitions.
 *
 * GET /api/structures - List all structures
 * GET /api/structures?id=xxx - Get single structure
 * POST /api/structures - Create/update structure
 * DELETE /api/structures?id=xxx - Delete structure
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import {
  loadStructures,
  getStructure,
  upsertStructure,
  deleteStructure,
} from "@/lib/structures/structure-service";
import type { StructureDefinition } from "@/types/structures";

const log = logger.child("API:structures");

// =============================================================================
// GET - List or get single structure
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      // Get single structure
      const structure = await getStructure(id);
      if (!structure) {
        return NextResponse.json(
          { error: "Structure not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(structure);
    }

    // List all structures
    const structures = await loadStructures();
    return NextResponse.json({ structures });
  } catch (error) {
    log.error("Failed to get structures", { error });
    return NextResponse.json(
      { error: "Failed to get structures" },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST - Create or update structure
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const structure = body as StructureDefinition;

    if (!structure.id || !structure.name) {
      return NextResponse.json(
        { error: "Structure must have id and name" },
        { status: 400 },
      );
    }

    const saved = await upsertStructure(structure);
    log.info("Saved structure", { id: saved.id, pieces: saved.pieces.length });

    return NextResponse.json({ success: true, structure: saved });
  } catch (error) {
    log.error("Failed to save structure", { error });
    return NextResponse.json(
      { error: "Failed to save structure" },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE - Delete structure
// =============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Structure ID required" },
        { status: 400 },
      );
    }

    const deleted = await deleteStructure(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Structure not found" },
        { status: 404 },
      );
    }

    log.info("Deleted structure", { id });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete structure", { error });
    return NextResponse.json(
      { error: "Failed to delete structure" },
      { status: 500 },
    );
  }
}
