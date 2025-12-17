/**
 * World Config API
 * Read/write world.json configuration file
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:world:config");

// Path to world.json in the server package
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
  name?: string;
  description?: string;
  version?: string;
  entities: WorldEntity[];
  settings?: Record<string, unknown>;
}

/**
 * Ensure world directory exists
 */
async function ensureWorldDir(): Promise<void> {
  await fs.mkdir(SERVER_WORLD_DIR, { recursive: true });
}

/**
 * Read world.json, creating default if doesn't exist
 */
async function readWorldConfig(): Promise<WorldConfig> {
  try {
    await ensureWorldDir();
    const content = await fs.readFile(WORLD_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    // Return default config if file doesn't exist
    return {
      name: "Hyperscape World",
      version: "1.0.0",
      entities: [],
      settings: {},
    };
  }
}

/**
 * Write world.json
 */
async function writeWorldConfig(config: WorldConfig): Promise<void> {
  await ensureWorldDir();
  await fs.writeFile(WORLD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * GET /api/world/config
 * Read current world configuration
 */
export async function GET() {
  try {
    const config = await readWorldConfig();

    return NextResponse.json({
      success: true,
      config,
      path: WORLD_CONFIG_PATH,
      entityCount: config.entities?.length || 0,
    });
  } catch (error) {
    log.error("GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read world config",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/world/config
 * Update world configuration (merge or replace)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action = "merge", config: newConfig, entity } = body;

    const currentConfig = await readWorldConfig();

    if (action === "replace") {
      // Full replacement
      await writeWorldConfig(newConfig as WorldConfig);
      return NextResponse.json({
        success: true,
        message: "World config replaced",
        entityCount: (newConfig as WorldConfig).entities?.length || 0,
      });
    }

    if (action === "merge" && newConfig) {
      // Merge settings
      const merged: WorldConfig = {
        ...currentConfig,
        ...newConfig,
        entities: newConfig.entities || currentConfig.entities,
        settings: { ...currentConfig.settings, ...newConfig.settings },
      };
      await writeWorldConfig(merged);
      return NextResponse.json({
        success: true,
        message: "World config merged",
        entityCount: merged.entities?.length || 0,
      });
    }

    if (action === "addEntity" && entity) {
      // Add single entity
      const worldEntity = entity as WorldEntity;

      // Check if entity with same ID exists
      const existingIndex = currentConfig.entities.findIndex(
        (e) => e.id === worldEntity.id,
      );

      if (existingIndex >= 0) {
        // Update existing
        currentConfig.entities[existingIndex] = worldEntity;
      } else {
        // Add new
        currentConfig.entities.push(worldEntity);
      }

      await writeWorldConfig(currentConfig);
      return NextResponse.json({
        success: true,
        message: existingIndex >= 0 ? "Entity updated" : "Entity added",
        entity: worldEntity,
        entityCount: currentConfig.entities.length,
      });
    }

    if (action === "removeEntity" && entity?.id) {
      // Remove entity by ID
      const initialCount = currentConfig.entities.length;
      currentConfig.entities = currentConfig.entities.filter(
        (e) => e.id !== entity.id,
      );

      if (currentConfig.entities.length === initialCount) {
        return NextResponse.json(
          { error: "Entity not found" },
          { status: 404 },
        );
      }

      await writeWorldConfig(currentConfig);
      return NextResponse.json({
        success: true,
        message: "Entity removed",
        entityCount: currentConfig.entities.length,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use: merge, replace, addEntity, removeEntity" },
      { status: 400 },
    );
  } catch (error) {
    log.error("POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update world config",
      },
      { status: 500 },
    );
  }
}
