/**
 * Image-to-3D Pipeline
 * Complete workflow for converting images to 3D models
 *
 * Single-stage process (v1 API)
 *
 * @see https://docs.meshy.ai/en/api/image-to-3d
 */

import { createImageTo3DTask } from "./client";
import type { ImageTo3DOptions } from "./types";
import { DEFAULT_TOPOLOGY, DEFAULT_TEXTURE_RESOLUTION } from "./constants";

// Re-export polling from unified poll-task module
export { pollTaskStatus } from "./poll-task";
export type { PollTaskResult as ImageTo3DPipelineResult } from "./poll-task";

/**
 * Start Image-to-3D generation
 *
 * Polycount recommendations for Three.js web MMO:
 * - Small props: 500 - 2,000 triangles
 * - Medium props: 2,000 - 5,000 triangles
 * - Large props: 5,000 - 10,000 triangles
 * - NPC Characters: 2,000 - 10,000 triangles
 * - Small buildings: 5,000 - 15,000 triangles
 * - Large structures: 15,000 - 50,000 triangles
 *
 * @param imageUrl - Source image URL or data URI
 * @param options - Generation options (polycount, topology, PBR, etc.)
 */
export async function startImageTo3D(
  imageUrl: string,
  options?: Partial<ImageTo3DOptions>,
): Promise<{ taskId: string }> {
  const taskId = await createImageTo3DTask({
    image_url: imageUrl,
    enable_pbr: options?.enable_pbr ?? true,
    ai_model: options?.ai_model ?? "meshy-4",
    topology: options?.topology ?? DEFAULT_TOPOLOGY,
    target_polycount: options?.target_polycount ?? 30000,
    texture_resolution:
      options?.texture_resolution ?? DEFAULT_TEXTURE_RESOLUTION,
    should_remesh: options?.should_remesh,
    should_texture: options?.should_texture,
  });

  if (!taskId) {
    throw new Error("Failed to create image-to-3d task");
  }

  return { taskId };
}
