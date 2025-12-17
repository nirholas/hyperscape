/**
 * Unified Task Polling
 * Works for both image-to-3d and text-to-3d tasks
 *
 * Matches asset-forge polling patterns with configurable intervals
 */

import { getTaskStatusV1, getTaskStatusV2, type MeshyTask } from "./client";

export interface TextureUrls {
  base_color: string;
  metallic?: string;
  normal?: string;
  roughness?: string;
}

export interface PollTaskResult {
  taskId: string;
  modelUrl: string;
  thumbnailUrl?: string;
  textureUrls?: TextureUrls[];
  status: "SUCCEEDED" | "FAILED" | "CANCELED";
}

export interface PollOptions {
  pollIntervalMs?: number; // Default: 5000ms
  timeoutMs?: number; // Default: 300000ms (5 minutes)
  onProgress?: (progress: number, precedingTasks?: number) => void;
}

/**
 * Poll Meshy task status until completion
 * Supports both v1 and v2 APIs
 */
export async function pollTaskStatus(
  taskId: string,
  options: PollOptions = {},
): Promise<PollTaskResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 300000;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

  let attempts = 0;
  const startTime = Date.now();

  // Try v2 first (unified tasks endpoint)
  let useV2 = true;
  const v1Endpoints: Array<"image-to-3d" | "retexture" | "rigging"> = [
    "image-to-3d",
    "retexture",
    "rigging",
  ];

  while (attempts < maxAttempts) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Task polling timeout after ${timeoutMs / 1000} seconds`);
    }

    try {
      let task: MeshyTask | undefined;

      if (useV2) {
        try {
          task = await getTaskStatusV2(taskId);
        } catch {
          // Fallback to v1
          useV2 = false;
          continue;
        }
      } else {
        // Try v1 endpoints
        for (const endpoint of v1Endpoints) {
          try {
            task = await getTaskStatusV1(taskId, endpoint);
            break;
          } catch {
            continue;
          }
        }
        if (!task) {
          throw new Error(`Failed to get task status for ${taskId}`);
        }
      }

      // Ensure task was fetched
      if (!task) {
        throw new Error(`Failed to get task status for ${taskId}`);
      }

      // Report progress
      if (task.progress !== undefined) {
        options.onProgress?.(task.progress, task.preceding_tasks);
      } else if (task.preceding_tasks !== undefined) {
        // Estimate progress based on queue position
        const estimatedProgress = Math.max(0, 100 - task.preceding_tasks * 10);
        options.onProgress?.(estimatedProgress, task.preceding_tasks);
      }

      // Check status
      if (task.status === "SUCCEEDED") {
        const modelUrl = task.model_urls?.glb || task.model_url || "";
        if (!modelUrl) {
          throw new Error("Task completed but no model URL");
        }
        return {
          taskId: task.id || taskId,
          modelUrl,
          thumbnailUrl: task.thumbnail_url,
          textureUrls: task.texture_urls,
          status: "SUCCEEDED",
        };
      }

      if (task.status === "FAILED") {
        const errorMessage =
          task.task_error?.message || task.error || "Task failed";
        throw new Error(errorMessage);
      }

      if (task.status === "CANCELED") {
        throw new Error("Task was canceled");
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      attempts++;
    } catch (error) {
      // If it's a final error (SUCCEEDED, FAILED, CANCELED), rethrow
      if (
        error instanceof Error &&
        (error.message.includes("failed") ||
          error.message.includes("canceled") ||
          error.message.includes("completed"))
      ) {
        throw error;
      }
      // Otherwise, continue polling
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      attempts++;
    }
  }

  throw new Error(
    `Task polling timeout after ${maxAttempts} attempts (${timeoutMs / 1000}s)`,
  );
}
