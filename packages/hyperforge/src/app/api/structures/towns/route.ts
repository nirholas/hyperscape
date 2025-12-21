/**
 * Towns API
 *
 * Manages town layouts - collections of buildings arranged together.
 *
 * GET /api/structures/towns - List all towns
 * POST /api/structures/towns - Create/update a town
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import { saveTown, isSupabaseConfigured } from "@/lib/storage/supabase-storage";
import type { TownDefinition } from "@/types/structures";
import { promises as fs } from "fs";
import path from "path";

const log = logger.child("API:towns");

// Path to towns JSON file
const TOWNS_FILE = path.join(process.cwd(), "public/data/towns.json");

// =============================================================================
// DATA ACCESS
// =============================================================================

interface TownsData {
  towns: TownDefinition[];
  lastUpdated: string;
}

async function loadTowns(): Promise<TownsData> {
  try {
    const data = await fs.readFile(TOWNS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // Return empty if file doesn't exist
    return {
      towns: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

async function saveTownsLocal(data: TownsData): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(TOWNS_FILE);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(TOWNS_FILE, JSON.stringify(data, null, 2));
  log.info("Saved towns locally", { count: data.towns.length });
}

// =============================================================================
// API HANDLERS
// =============================================================================

/**
 * GET - List all towns
 */
export async function GET() {
  try {
    const data = await loadTowns();
    log.info("Loaded towns", { count: data.towns.length });
    return NextResponse.json(data);
  } catch (error) {
    log.error("Error loading towns", { error });
    return NextResponse.json(
      { error: "Failed to load towns" },
      { status: 500 },
    );
  }
}

/**
 * POST - Create or update a town
 */
export async function POST(request: NextRequest) {
  try {
    const town: TownDefinition = await request.json();

    if (!town.id || !town.name) {
      return NextResponse.json(
        { error: "Town ID and name required" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const updatedTown: TownDefinition = {
      ...town,
      createdAt: town.createdAt || now,
      updatedAt: now,
    };

    // Save to Supabase baked-structures bucket if configured
    if (isSupabaseConfigured()) {
      try {
        const savedFiles = await saveTown({
          townId: town.id,
          definition: updatedTown,
        });

        log.info("Saved town to Supabase", {
          id: town.id,
          definitionUrl: savedFiles.definitionUrl,
        });
      } catch (uploadError) {
        log.warn("Failed to save town to Supabase", {
          error:
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError),
        });
      }
    }

    // Also save to local storage
    const data = await loadTowns();

    // Check if town already exists
    const existingIndex = data.towns.findIndex((t) => t.id === town.id);

    if (existingIndex >= 0) {
      // Update existing town
      data.towns[existingIndex] = updatedTown;
      log.info("Updated town", {
        id: town.id,
        buildings: town.buildings.length,
      });
    } else {
      // Add new town
      data.towns.push(updatedTown);
      log.info("Created town", {
        id: town.id,
        buildings: town.buildings.length,
      });
    }

    data.lastUpdated = now;
    await saveTownsLocal(data);

    return NextResponse.json({
      success: true,
      town: updatedTown,
    });
  } catch (error) {
    log.error("Error saving town", { error });
    return NextResponse.json({ error: "Failed to save town" }, { status: 500 });
  }
}

/**
 * DELETE - Delete a town
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const townId = searchParams.get("id");

    if (!townId) {
      return NextResponse.json({ error: "Town ID required" }, { status: 400 });
    }

    const data = await loadTowns();
    const initialCount = data.towns.length;
    data.towns = data.towns.filter((t) => t.id !== townId);

    if (data.towns.length === initialCount) {
      return NextResponse.json({ error: "Town not found" }, { status: 404 });
    }

    data.lastUpdated = new Date().toISOString();
    await saveTownsLocal(data);

    log.info("Deleted town", { id: townId });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Error deleting town", { error });
    return NextResponse.json(
      { error: "Failed to delete town" },
      { status: 500 },
    );
  }
}
