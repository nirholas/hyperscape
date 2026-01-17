/**
 * Extract Model Bounds - Build-time tool for automatic footprint calculation
 *
 * This script parses GLB files from the assets directory and extracts
 * bounding box information from glTF position accessor min/max values.
 *
 * AAA Approach:
 * - Parse actual model geometry to get real dimensions
 * - Pre-compute footprints at build time (not runtime)
 * - Write to manifest for server to load at startup
 *
 * Usage:
 *   bun run packages/server/scripts/extract-model-bounds.ts
 *
 * Output:
 *   packages/server/world/assets/manifests/model-bounds.json
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "fs";
import { join, relative, basename, dirname } from "path";

// ============================================================================
// TYPES
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

interface ModelBounds {
  /** Model identifier (relative path from models/) */
  id: string;
  /** Full asset path */
  assetPath: string;
  /** Bounding box in model space */
  bounds: BoundingBox;
  /** Dimensions (max - min) */
  dimensions: Vec3;
  /** Auto-calculated footprint (tiles) */
  footprint: { width: number; depth: number };
}

interface ModelBoundsManifest {
  generatedAt: string;
  tileSize: number;
  models: ModelBounds[];
}

// glTF accessor types
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GltfMeshPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMesh {
  name?: string;
  primitives: GltfMeshPrimitive[];
}

interface GltfJson {
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  scenes?: { nodes?: number[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    translation?: number[];
    scale?: number[];
  }[];
}

// ============================================================================
// GLB PARSER
// ============================================================================

const GLB_MAGIC = 0x46546c67; // "glTF" in little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" in little-endian
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0" in little-endian

/**
 * Parse GLB file and extract the JSON chunk
 */
function parseGlb(buffer: Buffer): GltfJson | null {
  if (buffer.length < 12) {
    console.warn("  GLB too short");
    return null;
  }

  // Read header
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);

  if (magic !== GLB_MAGIC) {
    console.warn("  Not a valid GLB file (bad magic)");
    return null;
  }

  if (version !== 2) {
    console.warn(`  Unsupported GLB version: ${version}`);
    return null;
  }

  // Parse chunks
  let offset = 12;
  while (offset < length) {
    if (offset + 8 > buffer.length) break;

    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkType === CHUNK_TYPE_JSON) {
      const jsonString = buffer.toString("utf8", offset, offset + chunkLength);
      try {
        return JSON.parse(jsonString) as GltfJson;
      } catch (e) {
        console.warn("  Failed to parse JSON chunk");
        return null;
      }
    }

    offset += chunkLength;
  }

  console.warn("  No JSON chunk found");
  return null;
}

/**
 * Extract bounding box from glTF accessors
 *
 * The position accessor (POSITION attribute) contains min/max arrays
 * that define the bounding box of the mesh vertices.
 */
function extractBounds(gltf: GltfJson): BoundingBox | null {
  if (!gltf.accessors || !gltf.meshes) {
    return null;
  }

  // Initialize bounds to extremes
  const globalMin: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const globalMax: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let foundAny = false;

  // Iterate all meshes and their primitives
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) continue;

      const accessor = gltf.accessors[positionIndex];
      if (!accessor || accessor.type !== "VEC3") continue;

      // Use accessor min/max if available (most efficient)
      if (
        accessor.min &&
        accessor.max &&
        accessor.min.length >= 3 &&
        accessor.max.length >= 3
      ) {
        foundAny = true;
        globalMin.x = Math.min(globalMin.x, accessor.min[0]);
        globalMin.y = Math.min(globalMin.y, accessor.min[1]);
        globalMin.z = Math.min(globalMin.z, accessor.min[2]);
        globalMax.x = Math.max(globalMax.x, accessor.max[0]);
        globalMax.y = Math.max(globalMax.y, accessor.max[1]);
        globalMax.z = Math.max(globalMax.z, accessor.max[2]);
      }
    }
  }

  if (!foundAny) {
    return null;
  }

  return { min: globalMin, max: globalMax };
}

// ============================================================================
// FOOTPRINT CALCULATION
// ============================================================================

/** Tile size in world units (1 tile = 1 unit) */
const TILE_SIZE = 1.0;

/**
 * Calculate footprint from bounds
 *
 * Strategy:
 * - Width comes from X dimension
 * - Depth comes from Z dimension
 * - Round to nearest tile (not ceil - avoids over-blocking)
 * - Minimum 1x1 footprint
 *
 * Note: This calculates footprint at scale 1.0.
 * StationDataProvider applies modelScale at runtime for final footprint.
 */
function calculateFootprint(
  bounds: BoundingBox,
  modelScale: number = 1.0,
): { width: number; depth: number } {
  const width = (bounds.max.x - bounds.min.x) * modelScale;
  const depth = (bounds.max.z - bounds.min.z) * modelScale;

  return {
    width: Math.max(1, Math.round(width / TILE_SIZE)),
    depth: Math.max(1, Math.round(depth / TILE_SIZE)),
  };
}

// ============================================================================
// FILE SCANNER
// ============================================================================

/**
 * Recursively find all GLB files in a directory
 */
function findGlbFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip backup directories
      if (entry === "backups" || entry === ".git") continue;
      files.push(...findGlbFiles(fullPath));
    } else if (entry.endsWith(".glb")) {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const assetsDir = join(__dirname, "../world/assets");
  const modelsDir = join(assetsDir, "models");
  const outputPath = join(assetsDir, "manifests/model-bounds.json");

  console.log("=".repeat(60));
  console.log("Model Bounds Extractor");
  console.log("=".repeat(60));
  console.log(`Scanning: ${modelsDir}`);
  console.log("");

  // Find all GLB files
  const glbFiles = findGlbFiles(modelsDir);
  console.log(`Found ${glbFiles.length} GLB files\n`);

  const models: ModelBounds[] = [];

  for (const glbPath of glbFiles) {
    const relativePath = relative(modelsDir, glbPath);
    const modelId = dirname(relativePath);

    // Skip animation files and raw files
    if (
      relativePath.includes("/animations/") ||
      relativePath.includes("_raw.glb")
    ) {
      console.log(`[SKIP] ${relativePath} (animation/raw)`);
      continue;
    }

    console.log(`[SCAN] ${relativePath}`);

    try {
      const buffer = readFileSync(glbPath);
      const gltf = parseGlb(buffer);

      if (!gltf) {
        console.log("  -> Failed to parse GLB\n");
        continue;
      }

      const bounds = extractBounds(gltf);
      if (!bounds) {
        console.log("  -> No position bounds found\n");
        continue;
      }

      const dimensions: Vec3 = {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      };

      // Calculate footprint at scale 1.0 (manifest can specify scale separately)
      const footprint = calculateFootprint(bounds, 1.0);

      const modelBounds: ModelBounds = {
        id: modelId,
        assetPath: `asset://models/${relativePath}`,
        bounds,
        dimensions,
        footprint,
      };

      models.push(modelBounds);

      console.log(
        `  -> Dimensions: ${dimensions.x.toFixed(2)} x ${dimensions.y.toFixed(2)} x ${dimensions.z.toFixed(2)}`,
      );
      console.log(
        `  -> Footprint (scale=1.0): ${footprint.width}x${footprint.depth} tiles\n`,
      );
    } catch (error) {
      console.log(`  -> Error: ${error}\n`);
    }
  }

  // Write manifest
  const manifest: ModelBoundsManifest = {
    generatedAt: new Date().toISOString(),
    tileSize: TILE_SIZE,
    models,
  };

  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log("=".repeat(60));
  console.log(`Generated: ${outputPath}`);
  console.log(`Total models: ${models.length}`);
  console.log("=".repeat(60));
}

main();
