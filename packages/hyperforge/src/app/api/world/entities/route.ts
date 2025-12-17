/**
 * World Entities API
 * CRUD operations for world entities (reads from world.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:world:entities");

// Path to world.json
const SERVER_WORLD_DIR =
  process.env.HYPERSCAPE_WORLD_DIR ||
  path.resolve(process.cwd(), "..", "server", "world");

const WORLD_CONFIG_PATH = path.join(SERVER_WORLD_DIR, "world.json");

interface WorldEntity {
  id: string;
  name: string;
  type: string;
  blueprint?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: [number, number, number];
  data?: Record<string, unknown>;
}

interface WorldConfig {
  entities: WorldEntity[];
  [key: string]: unknown;
}

/**
 * Request body for POST /api/world/entities
 * Creates a new entity in the world
 */
interface CreateEntityRequest {
  id: string;
  name: string;
  type?: string;
  blueprint?: string;
  modelPath?: string;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
  data?: Record<string, unknown>;
}

/**
 * Read world.json
 */
async function readWorldConfig(): Promise<WorldConfig> {
  try {
    const content = await fs.readFile(WORLD_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return { entities: [] };
  }
}

/**
 * Write world.json
 */
async function writeWorldConfig(config: WorldConfig): Promise<void> {
  await fs.mkdir(SERVER_WORLD_DIR, { recursive: true });
  await fs.writeFile(WORLD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * GET /api/world/entities
 * List all entities in the world
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type");
    const areaFilter = searchParams.get("area");

    const config = await readWorldConfig();
    let entities = config.entities || [];

    // Apply filters
    if (typeFilter) {
      entities = entities.filter((e) => e.type === typeFilter);
    }
    if (areaFilter) {
      entities = entities.filter(
        (e) => e.data?.spawnArea === areaFilter || e.data?.area === areaFilter,
      );
    }

    // Transform to UI-friendly format
    const formattedEntities = entities.map((e) => ({
      id: e.id,
      name: e.name || e.id,
      type: mapEntityType(e.type),
      position: {
        x: e.position?.[0] || 0,
        y: e.position?.[1] || 0,
        z: e.position?.[2] || 0,
      },
      rotation: e.rotation
        ? { x: e.rotation[0], y: e.rotation[1], z: e.rotation[2] }
        : undefined,
      scale: e.scale
        ? { x: e.scale[0], y: e.scale[1], z: e.scale[2] }
        : undefined,
      modelPath: e.blueprint || e.data?.modelPath,
      spawnArea: e.data?.spawnArea || e.data?.area,
      isActive: true,
      loadedAt: new Date().toISOString(),
      metadata: e.data,
    }));

    // Get unique areas
    const areas = [
      ...new Set(
        entities.map((e) => e.data?.spawnArea || e.data?.area).filter(Boolean),
      ),
    ].map((id) => ({ id, name: formatAreaName(id as string), entities: [] }));

    return NextResponse.json({
      success: true,
      entities: formattedEntities,
      areas,
      total: formattedEntities.length,
    });
  } catch (error) {
    log.error("GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list entities",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/world/entities
 * Add a new entity to the world
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateEntityRequest;
    const {
      id,
      name,
      type,
      position,
      rotation,
      scale,
      modelPath,
      blueprint,
      data,
    } = body;

    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 },
      );
    }

    const config = await readWorldConfig();

    // Check for duplicate
    if (config.entities.some((e) => e.id === id)) {
      return NextResponse.json(
        { error: "Entity with this ID already exists" },
        { status: 409 },
      );
    }

    // Create entity in world.json format
    const entity: WorldEntity = {
      id,
      name,
      type: type || "app",
      blueprint: blueprint || modelPath,
      position: position
        ? [position.x ?? 0, position.y ?? 0, position.z ?? 0]
        : [0, 0, 0],
      data: data || {},
    };

    if (rotation) {
      entity.rotation = [rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0];
    }
    if (scale) {
      entity.scale = [scale.x ?? 1, scale.y ?? 1, scale.z ?? 1];
    }

    config.entities.push(entity);
    await writeWorldConfig(config);

    return NextResponse.json({
      success: true,
      message: "Entity added to world",
      entity,
      total: config.entities.length,
    });
  } catch (error) {
    log.error("POST error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to add entity",
      },
      { status: 500 },
    );
  }
}

/**
 * Map internal type to UI type
 */
function mapEntityType(type: string): string {
  const typeMap: Record<string, string> = {
    app: "prop",
    player: "player",
    npc: "npc",
    mob: "mob",
    item: "item",
    resource: "resource",
    building: "building",
    tree: "resource",
    rock: "resource",
    ore: "resource",
  };
  return typeMap[type] || type;
}

/**
 * Format area ID to display name
 */
function formatAreaName(id: string): string {
  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
