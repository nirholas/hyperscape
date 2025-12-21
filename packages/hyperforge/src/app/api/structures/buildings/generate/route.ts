/**
 * Full Building Generation API
 *
 * Generates complete, non-enterable buildings via Meshy for town placement.
 * Unlike modular pieces, these are single complete meshes.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";
import {
  isSupabaseConfigured,
  saveMeshyModel,
  getMeshyModelUrl,
} from "@/lib/storage/supabase-storage";
import type { StructureDefinition } from "@/types/structures";

const log = logger.child("API:buildings/generate");

// Extend timeout for Meshy generation
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// =============================================================================
// TYPES
// =============================================================================

interface GenerateRequest {
  name: string;
  prompt: string;
  buildingType: string;
  style: string;
  targetPolycount: number;
}

interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  model_urls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
  };
  thumbnail_url?: string;
  texture_urls?: Array<{ base_color?: string }>;
  progress?: number;
  task_error?: { message?: string };
}

// =============================================================================
// MESHY HELPERS
// =============================================================================

const MESHY_API_KEY = process.env.MESHY_API_KEY;
const MESHY_API_URL = "https://api.meshy.ai/openapi/v2";

async function createTextTo3DTask(
  prompt: string,
  targetPolycount: number,
): Promise<string> {
  const response = await fetch(`${MESHY_API_URL}/text-to-3d`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "preview",
      prompt,
      negative_prompt:
        "interior, rooms, furniture, people, characters, animals, vehicles, multiple buildings, floating objects, ground, terrain, trees, grass",
      art_style: "realistic",
      target_polycount: targetPolycount,
      should_remesh: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Meshy preview failed: ${error}`);
  }

  const data = await response.json();
  return data.result;
}

async function refineTask(
  previewTaskId: string,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${MESHY_API_URL}/text-to-3d`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "refine",
      preview_task_id: previewTaskId,
      texture_prompt: `${prompt}, high quality textures, detailed materials, game-ready asset`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Meshy refine failed: ${error}`);
  }

  const data = await response.json();
  return data.result;
}

async function pollTask(taskId: string, maxAttempts = 120): Promise<MeshyTask> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${MESHY_API_URL}/text-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to poll task: ${response.statusText}`);
    }

    const task: MeshyTask = await response.json();
    log.debug("Poll task status", {
      taskId,
      status: task.status,
      progress: task.progress,
    });

    if (task.status === "SUCCEEDED") {
      return task;
    }

    if (task.status === "FAILED" || task.status === "EXPIRED") {
      throw new Error(task.task_error?.message || `Task ${task.status}`);
    }

    // Wait 3 seconds between polls
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("Generation timed out");
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    if (!MESHY_API_KEY) {
      return NextResponse.json(
        { error: "Meshy API key not configured" },
        { status: 500 },
      );
    }

    const body: GenerateRequest = await request.json();
    const { name, prompt, buildingType, style, targetPolycount } = body;

    log.info("Starting full building generation", {
      name,
      buildingType,
      style,
      targetPolycount,
    });

    // Step 1: Create preview task
    const previewTaskId = await createTextTo3DTask(prompt, targetPolycount);
    log.info("Preview task created", { taskId: previewTaskId });

    // Step 2: Poll for preview completion
    await pollTask(previewTaskId);
    log.info("Preview completed", { taskId: previewTaskId });

    // Step 3: Refine the model
    const refineTaskId = await refineTask(previewTaskId, prompt);
    log.info("Refine task created", { taskId: refineTaskId });

    // Step 4: Poll for refine completion
    const refineResult = await pollTask(refineTaskId);
    log.info("Refine completed", { taskId: refineTaskId });

    // Get model URL
    const meshyModelUrl = refineResult.model_urls?.glb;
    const meshyThumbnailUrl = refineResult.thumbnail_url;

    if (!meshyModelUrl) {
      throw new Error("No model URL returned from Meshy");
    }

    // Generate building ID
    const buildingId = `building_${Date.now()}`;
    let modelUrl = meshyModelUrl;
    let thumbnailUrl = meshyThumbnailUrl;

    // Step 5: Upload to Supabase if configured
    if (isSupabaseConfigured()) {
      try {
        // Download and re-upload model
        const modelResponse = await fetch(meshyModelUrl);
        if (modelResponse.ok) {
          const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());
          await saveMeshyModel({
            taskId: refineTaskId,
            modelBuffer,
            filename: `${buildingId}.glb`,
          });
          modelUrl = getMeshyModelUrl(refineTaskId, `${buildingId}.glb`);
          log.info("Uploaded model to Supabase", { url: modelUrl });
        }

        // Download and re-upload thumbnail
        if (meshyThumbnailUrl) {
          const thumbResponse = await fetch(meshyThumbnailUrl);
          if (thumbResponse.ok) {
            const thumbBuffer = Buffer.from(await thumbResponse.arrayBuffer());
            await saveMeshyModel({
              taskId: refineTaskId,
              modelBuffer: thumbBuffer,
              filename: `${buildingId}_thumb.png`,
            });
            thumbnailUrl = getMeshyModelUrl(
              refineTaskId,
              `${buildingId}_thumb.png`,
            );
          }
        }
      } catch (uploadError) {
        log.warn("Failed to upload to Supabase, using Meshy URLs", {
          error:
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError),
        });
      }
    }

    // Step 6: Create StructureDefinition
    const now = new Date().toISOString();
    const building: StructureDefinition = {
      id: buildingId,
      name: name || "Generated Building",
      description: `${style} ${buildingType} - AI generated complete building`,
      pieces: [], // Full buildings don't have modular pieces
      bounds: {
        width: 10,
        height: 10,
        depth: 10,
      },
      createdAt: now,
      updatedAt: now,
      thumbnailUrl,
      bakedModelUrl: modelUrl, // Use bakedModelUrl since it's ready to use
      bakedAt: now,
      enterable: false, // Full buildings are not enterable
    };

    // Step 7: Save to structures list
    const fs = await import("fs").then((m) => m.promises);
    const path = await import("path");
    const structuresPath = path.join(
      process.cwd(),
      "public/data/structures.json",
    );

    let structuresData = {
      structures: [] as StructureDefinition[],
      lastUpdated: now,
    };
    try {
      const existing = await fs.readFile(structuresPath, "utf-8");
      structuresData = JSON.parse(existing);
    } catch {
      // File doesn't exist, use defaults
    }

    structuresData.structures.push(building);
    structuresData.lastUpdated = now;

    await fs.writeFile(structuresPath, JSON.stringify(structuresData, null, 2));

    log.info("Full building generated successfully", {
      id: buildingId,
      name: building.name,
      modelUrl,
    });

    return NextResponse.json({
      success: true,
      building,
    });
  } catch (error) {
    log.error("Full building generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 },
    );
  }
}
