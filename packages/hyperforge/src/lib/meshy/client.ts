/**
 * Meshy API Client
 * Handles all Meshy 3D generation API calls
 *
 * API Versions:
 * - v1: Image-to-3D, Retexture, Rigging
 * - v2: Text-to-3D (two-stage: preview → refine)
 *
 * @see https://www.meshy.ai/api - API Overview
 * @see https://docs.meshy.ai/en/api/image-to-3d - Image-to-3D API
 * @see https://docs.meshy.ai/api/text-to-3d - Text-to-3D API
 * @see https://docs.meshy.ai/en/api/changelog - API Changelog
 */

import type {
  MeshyTask as MeshyTaskType,
  ImageTo3DOptions,
  TextTo3DOptions,
  RetextureOptions,
  RiggingOptions,
  RiggingTaskResult,
  MeshyTaskResponse,
} from "./types";
import {
  MESHY_API_V1,
  MESHY_API_V2,
  DEFAULT_AI_MODEL,
  DEFAULT_TOPOLOGY,
  DEFAULT_TEXTURE_RESOLUTION,
} from "./constants";

// Re-export MeshyTask for use by other modules
export type { MeshyTask } from "./types";
type MeshyTask = MeshyTaskType;

function getApiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) {
    throw new Error("MESHY_API_KEY environment variable is required");
  }
  return key;
}

async function meshyRequest<T>(
  endpoint: string,
  options: RequestInit & { baseUrl?: string } = {},
): Promise<T> {
  const baseUrl = options.baseUrl || MESHY_API_V1;
  const { baseUrl: _, ...fetchOptions } = options;

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      `Meshy API error (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return response.json();
}

/**
 * Create Image-to-3D task (v1 API)
 * Returns task ID string from { result: "task-id" } response
 *
 * @see https://docs.meshy.ai/en/api/image-to-3d
 *
 * Polycount recommendations for Three.js web MMO:
 * - Small props: 500 - 2,000 triangles
 * - Medium props: 2,000 - 5,000 triangles
 * - Large props: 5,000 - 10,000 triangles
 * - NPC Characters: 2,000 - 10,000 triangles
 * - Small buildings: 5,000 - 15,000 triangles
 * - Large structures: 15,000 - 50,000 triangles
 */
export async function createImageTo3DTask(
  options: ImageTo3DOptions,
): Promise<string> {
  // Build request body with all supported parameters
  const body: Record<string, unknown> = {
    image_url: options.image_url,
    ai_model: options.ai_model ?? "meshy-4",
    topology: options.topology ?? DEFAULT_TOPOLOGY,
    target_polycount: options.target_polycount ?? 30000,
  };

  // Texture options (enable_pbr requires texturing to be enabled)
  if (options.should_texture !== false) {
    body.enable_pbr = options.enable_pbr ?? true;
    body.texture_resolution =
      options.texture_resolution ?? DEFAULT_TEXTURE_RESOLUTION;
  }

  // Remeshing for cleaner topology
  if (options.should_remesh !== undefined) {
    body.should_remesh = options.should_remesh;
  }

  const response = await meshyRequest<MeshyTaskResponse>("/image-to-3d", {
    method: "POST",
    baseUrl: MESHY_API_V1,
    body: JSON.stringify(body),
  });

  // Extract task ID from response
  return response.result || response.task_id || response.id || "";
}

/**
 * Create Text-to-3D Preview task (v2 API - Stage 1)
 * Returns task ID string from { result: "task-id" } response
 *
 * Two-stage workflow:
 * 1. Preview stage (this function): Generates mesh without texture
 * 2. Refine stage: Adds texture to preview mesh
 *
 * @see https://docs.meshy.ai/api/text-to-3d
 */
export async function createTextTo3DPreviewTask(
  options: TextTo3DOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    mode: "preview",
    prompt: options.prompt,
    art_style: options.art_style ?? "realistic",
    ai_model: options.ai_model ?? DEFAULT_AI_MODEL,
    topology: options.topology ?? DEFAULT_TOPOLOGY,
    target_polycount: options.target_polycount ?? 30000,
    should_remesh: options.should_remesh ?? true,
    symmetry_mode: options.symmetry_mode ?? "auto",
    pose_mode: options.pose_mode ?? "",
  };

  // Add seed for reproducible generation
  if (options.seed !== undefined) {
    body.seed = options.seed;
  }

  // Add moderation flag if specified
  if (options.moderation !== undefined) {
    body.moderation = options.moderation;
  }

  const response = await meshyRequest<MeshyTaskResponse>("/text-to-3d", {
    method: "POST",
    baseUrl: MESHY_API_V2,
    body: JSON.stringify(body),
  });

  return response.result || response.task_id || response.id || "";
}

/**
 * Create Text-to-3D Refine task (v2 API - Stage 2)
 * Requires a completed preview task ID
 *
 * Valid params per Meshy docs:
 * - mode, preview_task_id, enable_pbr, texture_prompt, texture_image_url, ai_model, moderation
 *
 * Note: texture_resolution is NOT valid for refine - texturing uses original resolution
 *
 * @see https://docs.meshy.ai/api/text-to-3d
 *
 * @param previewTaskId - Task ID from completed preview stage
 * @param options - Texture generation options
 */
export async function createTextTo3DRefineTask(
  previewTaskId: string,
  options: TextTo3DOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    mode: "refine",
    preview_task_id: previewTaskId,
    enable_pbr: options.enable_pbr ?? true,
  };

  // Texture prompt guides texture generation
  // If not provided, Meshy uses the original preview prompt
  if (options.texture_prompt) {
    body.texture_prompt = options.texture_prompt;
  }

  // Reference image for texture style (alternative to texture_prompt)
  if (options.texture_image_url) {
    body.texture_image_url = options.texture_image_url;
  }

  // AI model must match preview task's model for meshy-5/latest
  if (options.ai_model) {
    body.ai_model = options.ai_model;
  }

  // Moderation flag
  if (options.moderation !== undefined) {
    body.moderation = options.moderation;
  }

  const response = await meshyRequest<MeshyTaskResponse>("/text-to-3d", {
    method: "POST",
    baseUrl: MESHY_API_V2,
    body: JSON.stringify(body),
  });

  return response.result || response.task_id || response.id || "";
}

/**
 * Get task status (v1 API)
 * For image-to-3d, retexture, rigging tasks
 */
export async function getTaskStatusV1(
  taskId: string,
  endpoint: "image-to-3d" | "retexture" | "rigging",
): Promise<MeshyTask> {
  return meshyRequest<MeshyTask>(`/${endpoint}/${taskId}`, {
    method: "GET",
    baseUrl: MESHY_API_V1,
  });
}

/**
 * Get rigging task status (v1 API)
 * Returns RiggingTaskResult with result.rigged_character_glb_url
 */
export async function getRiggingTaskStatus(
  taskId: string,
): Promise<RiggingTaskResult> {
  return meshyRequest<RiggingTaskResult>(`/rigging/${taskId}`, {
    method: "GET",
    baseUrl: MESHY_API_V1,
  });
}

/**
 * Get task status (v2 API)
 * For text-to-3d tasks using unified tasks endpoint
 */
export async function getTaskStatusV2(taskId: string): Promise<MeshyTask> {
  return meshyRequest<MeshyTask>(`/tasks/${taskId}`, {
    method: "GET",
    baseUrl: MESHY_API_V2,
  });
}

/**
 * Get task status (auto-detect API version)
 * Tries v2 first, falls back to v1 if needed
 */
export async function getTaskStatus(taskId: string): Promise<MeshyTask> {
  try {
    return await getTaskStatusV2(taskId);
  } catch {
    // Fallback to v1 endpoints
    for (const endpoint of ["image-to-3d", "retexture", "rigging"] as const) {
      try {
        return await getTaskStatusV1(taskId, endpoint);
      } catch {
        // Try next endpoint
      }
    }
    throw new Error(`Failed to get task status for ${taskId}`);
  }
}

/**
 * Create retexture task (v1 API)
 * Apply new textures to existing 3D models
 *
 * Requires either:
 * - input_task_id: Task ID of source model from previous Meshy generation
 * - model_url: URL to a 3D model file
 *
 * And either:
 * - text_style_prompt: Text description of desired texture style
 * - image_style_url: Reference image for texture style
 *
 * @see https://docs.meshy.ai/en/api/retexture (if available)
 */
export async function createRetextureTask(
  options: RetextureOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    art_style: options.art_style ?? "realistic",
    ai_model: options.ai_model ?? "meshy-5",
    enable_original_uv: options.enable_original_uv ?? true,
  };

  // Source model (task ID or URL)
  if (options.input_task_id) {
    body.input_task_id = options.input_task_id;
  } else if (options.model_url) {
    body.model_url = options.model_url;
  } else {
    throw new Error("Either input_task_id or model_url must be provided");
  }

  // Texture style (text prompt or image reference)
  if (options.text_style_prompt) {
    body.text_style_prompt = options.text_style_prompt;
  } else if (options.image_style_url) {
    body.image_style_url = options.image_style_url;
  } else {
    throw new Error(
      "Either text_style_prompt or image_style_url must be provided",
    );
  }

  const response = await meshyRequest<MeshyTaskResponse>("/retexture", {
    method: "POST",
    baseUrl: MESHY_API_V1,
    body: JSON.stringify(body),
  });

  return response.result || response.task_id || response.id || "";
}

/**
 * Create rigging task (v1 API)
 * Add skeleton and basic animations to character meshes
 *
 * The rigging API adds a humanoid skeleton to character meshes
 * and provides basic walking/running animations.
 *
 * Rigged models are returned in:
 * - result.rigged_character_glb_url
 * - result.rigged_character_fbx_url
 *
 * Basic animations included:
 * - Walking (GLB/FBX)
 * - Running (GLB/FBX)
 *
 * @see https://docs.meshy.ai/en/api/rigging (if available)
 */
export async function createRiggingTask(
  options: RiggingOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    // Character height for proper bone scaling
    height_meters: options.height_meters ?? 1.7,
  };

  // Source model (task ID or URL)
  if (options.input_task_id) {
    body.input_task_id = options.input_task_id;
  } else if (options.model_url) {
    body.model_url = options.model_url;
  } else {
    throw new Error("Either input_task_id or model_url must be provided");
  }

  const response = await meshyRequest<MeshyTaskResponse>("/rigging", {
    method: "POST",
    baseUrl: MESHY_API_V1,
    body: JSON.stringify(body),
  });

  return response.result || response.task_id || response.id || "";
}
