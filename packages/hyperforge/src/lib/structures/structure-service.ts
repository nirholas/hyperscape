/**
 * Structure Service
 *
 * Handles CRUD operations for structures and their storage.
 * Structures are stored in public/data/structures.json for now.
 */

import { logger } from "@/lib/utils";
import type {
  StructureDefinition,
  BuildingPiece,
  PieceLibrary,
} from "@/types/structures";
import fs from "fs/promises";
import path from "path";

const log = logger.child("StructureService");

// =============================================================================
// PATHS
// =============================================================================

const DATA_DIR = path.join(process.cwd(), "public", "data");
const STRUCTURES_FILE = path.join(DATA_DIR, "structures.json");
const PIECES_FILE = path.join(DATA_DIR, "building-pieces.json");

// =============================================================================
// STRUCTURE OPERATIONS
// =============================================================================

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * Load all structures from storage
 */
export async function loadStructures(): Promise<StructureDefinition[]> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(STRUCTURES_FILE, "utf-8");
    const parsed = JSON.parse(data);
    log.info("Loaded structures", { count: parsed.structures?.length || 0 });
    return parsed.structures || [];
  } catch (error) {
    // File doesn't exist yet, return empty array
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    log.error("Failed to load structures", { error });
    throw error;
  }
}

/**
 * Save all structures to storage
 */
export async function saveStructures(
  structures: StructureDefinition[],
): Promise<void> {
  await ensureDataDir();
  const data = JSON.stringify({ structures }, null, 2);
  await fs.writeFile(STRUCTURES_FILE, data, "utf-8");
  log.info("Saved structures", { count: structures.length });
}

/**
 * Get a single structure by ID
 */
export async function getStructure(
  id: string,
): Promise<StructureDefinition | null> {
  const structures = await loadStructures();
  return structures.find((s) => s.id === id) || null;
}

/**
 * Create or update a structure
 */
export async function upsertStructure(
  structure: StructureDefinition,
): Promise<StructureDefinition> {
  const structures = await loadStructures();
  const index = structures.findIndex((s) => s.id === structure.id);

  if (index >= 0) {
    structures[index] = structure;
    log.info("Updated structure", { id: structure.id });
  } else {
    structures.push(structure);
    log.info("Created structure", { id: structure.id });
  }

  await saveStructures(structures);
  return structure;
}

/**
 * Delete a structure by ID
 */
export async function deleteStructure(id: string): Promise<boolean> {
  const structures = await loadStructures();
  const filtered = structures.filter((s) => s.id !== id);

  if (filtered.length === structures.length) {
    return false; // Not found
  }

  await saveStructures(filtered);
  log.info("Deleted structure", { id });
  return true;
}

// =============================================================================
// PIECE LIBRARY OPERATIONS
// =============================================================================

/**
 * Load piece library from storage
 */
export async function loadPieceLibrary(): Promise<PieceLibrary> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PIECES_FILE, "utf-8");
    const parsed = JSON.parse(data);
    log.info("Loaded piece library", { count: parsed.pieces?.length || 0 });
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Return default empty library
      return {
        pieces: [],
        categories: [
          { type: "wall", label: "Walls", icon: "Square", pieces: [] },
          { type: "door", label: "Doors", icon: "DoorOpen", pieces: [] },
          { type: "window", label: "Windows", icon: "AppWindow", pieces: [] },
          { type: "roof", label: "Roofs", icon: "Home", pieces: [] },
          { type: "floor", label: "Floors", icon: "Layers", pieces: [] },
        ],
        lastUpdated: new Date().toISOString(),
      };
    }
    log.error("Failed to load piece library", { error });
    throw error;
  }
}

/**
 * Save piece library to storage
 */
export async function savePieceLibrary(library: PieceLibrary): Promise<void> {
  await ensureDataDir();
  library.lastUpdated = new Date().toISOString();
  const data = JSON.stringify(library, null, 2);
  await fs.writeFile(PIECES_FILE, data, "utf-8");
  log.info("Saved piece library", { count: library.pieces.length });
}

/**
 * Add a new piece to the library
 */
export async function addPiece(piece: BuildingPiece): Promise<BuildingPiece> {
  const library = await loadPieceLibrary();

  // Check for duplicate
  if (library.pieces.some((p) => p.id === piece.id)) {
    throw new Error(`Piece with ID ${piece.id} already exists`);
  }

  library.pieces.push(piece);

  // Update category
  const category = library.categories.find((c) => c.type === piece.type);
  if (category) {
    category.pieces.push(piece);
  }

  await savePieceLibrary(library);
  log.info("Added piece", { id: piece.id, type: piece.type });
  return piece;
}

/**
 * Get a single piece by ID
 */
export async function getPiece(id: string): Promise<BuildingPiece | null> {
  const library = await loadPieceLibrary();
  return library.pieces.find((p) => p.id === id) || null;
}

/**
 * Delete a piece from the library
 */
export async function deletePiece(id: string): Promise<boolean> {
  const library = await loadPieceLibrary();
  const piece = library.pieces.find((p) => p.id === id);

  if (!piece) {
    return false;
  }

  library.pieces = library.pieces.filter((p) => p.id !== id);

  // Remove from category
  const category = library.categories.find((c) => c.type === piece.type);
  if (category) {
    category.pieces = category.pieces.filter((p) => p.id !== id);
  }

  await savePieceLibrary(library);
  log.info("Deleted piece", { id });
  return true;
}
