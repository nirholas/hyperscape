/**
 * Single Entity API
 * GET/DELETE operations for individual world entities
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:world:entity");

const SERVER_WORLD_DIR =
  process.env.HYPERSCAPE_WORLD_DIR ||
  path.resolve(process.cwd(), "..", "server", "world");

const WORLD_CONFIG_PATH = path.join(SERVER_WORLD_DIR, "world.json");

interface WorldEntity {
  id: string;
  name: string;
  type: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  blueprint?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorldConfig {
  entities: WorldEntity[];
  [key: string]: unknown;
}

async function readWorldConfig(): Promise<WorldConfig> {
  try {
    const content = await fs.readFile(WORLD_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return { entities: [] };
  }
}

async function writeWorldConfig(config: WorldConfig): Promise<void> {
  await fs.mkdir(SERVER_WORLD_DIR, { recursive: true });
  await fs.writeFile(WORLD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Request body for PATCH /api/world/entities/[id]
 * Allows partial updates to entity properties
 */
interface EntityUpdateRequest {
  name?: string;
  type?: string;
  blueprint?: string;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
  data?: Record<string, unknown>;
}

/**
 * GET /api/world/entities/[id]
 * Get a single entity by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const config = await readWorldConfig();
    const entity = config.entities.find((e) => e.id === id);

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, entity });
  } catch (error) {
    log.error("GET error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get entity",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/world/entities/[id]
 * Remove an entity from the world
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const config = await readWorldConfig();

    const initialCount = config.entities.length;
    config.entities = config.entities.filter((e) => e.id !== id);

    if (config.entities.length === initialCount) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    await writeWorldConfig(config);

    return NextResponse.json({
      success: true,
      message: "Entity removed from world",
      removedId: id,
      remainingCount: config.entities.length,
    });
  } catch (error) {
    log.error("DELETE error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete entity",
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/world/entities/[id]
 * Update an entity's properties
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const updates = (await request.json()) as EntityUpdateRequest;

    const config = await readWorldConfig();
    const entityIndex = config.entities.findIndex((e) => e.id === id);

    if (entityIndex === -1) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Merge updates
    const entity = config.entities[entityIndex];

    if (updates.position) {
      entity.position = [
        updates.position.x ?? entity.position?.[0] ?? 0,
        updates.position.y ?? entity.position?.[1] ?? 0,
        updates.position.z ?? entity.position?.[2] ?? 0,
      ];
    }
    if (updates.rotation) {
      entity.rotation = [
        updates.rotation.x ?? 0,
        updates.rotation.y ?? 0,
        updates.rotation.z ?? 0,
      ];
    }
    if (updates.scale) {
      entity.scale = [
        updates.scale.x ?? 1,
        updates.scale.y ?? 1,
        updates.scale.z ?? 1,
      ];
    }
    if (updates.name) entity.name = updates.name;
    if (updates.type) entity.type = updates.type;
    if (updates.blueprint) entity.blueprint = updates.blueprint;
    if (updates.data) {
      const existingData = (entity.data || {}) as Record<string, unknown>;
      entity.data = { ...existingData, ...updates.data };
    }

    config.entities[entityIndex] = entity;
    await writeWorldConfig(config);

    return NextResponse.json({
      success: true,
      message: "Entity updated",
      entity,
    });
  } catch (error) {
    log.error("PATCH error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update entity",
      },
      { status: 500 },
    );
  }
}
