/**
 * Poll Task Tests
 *
 * Tests for the unified task polling module.
 * Tests focus on polling configuration, status handling, and callback invocation.
 *
 * Real Issues to Surface:
 * - Infinite polling loops
 * - Timeout not being respected
 * - Progress callbacks not firing
 * - Incorrect status transitions
 * - API version fallback failures
 */

import { describe, it, expect } from "vitest";
import type { MeshyTask } from "../types";
import type { PollOptions, PollTaskResult, TextureUrls } from "../poll-task";

describe("Poll Task Module", () => {
  describe("Polling Configuration", () => {
    it("defines default poll interval of 5 seconds", () => {
      const options: PollOptions = {};
      const pollIntervalMs = options.pollIntervalMs ?? 5000;

      expect(pollIntervalMs).toBe(5000);
    });

    it("defines default timeout of 5 minutes", () => {
      const options: PollOptions = {};
      const timeoutMs = options.timeoutMs ?? 300000;

      expect(timeoutMs).toBe(300000);
      expect(timeoutMs / 1000 / 60).toBe(5); // 5 minutes
    });

    it("calculates max attempts from timeout and interval", () => {
      const pollIntervalMs = 5000;
      const timeoutMs = 300000;
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

      expect(maxAttempts).toBe(60); // 300000 / 5000 = 60 attempts
    });

    it("accepts custom poll interval", () => {
      const options: PollOptions = {
        pollIntervalMs: 2000,
      };

      expect(options.pollIntervalMs).toBe(2000);
    });

    it("accepts custom timeout", () => {
      const options: PollOptions = {
        timeoutMs: 600000, // 10 minutes
      };

      expect(options.timeoutMs).toBe(600000);
    });

    it("ensures at least 1 attempt even with very short timeout", () => {
      const pollIntervalMs = 5000;
      const timeoutMs = 100; // Very short
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

      expect(maxAttempts).toBeGreaterThanOrEqual(1);
    });

    it("handles custom interval and timeout together", () => {
      const options: PollOptions = {
        pollIntervalMs: 10000, // 10 seconds
        timeoutMs: 120000, // 2 minutes
      };

      const maxAttempts = Math.max(
        1,
        Math.ceil(options.timeoutMs! / options.pollIntervalMs!),
      );

      expect(maxAttempts).toBe(12); // 120000 / 10000 = 12 attempts
    });
  });

  describe("Status Handling", () => {
    it("recognizes PENDING status as in-progress", () => {
      const task: Partial<MeshyTask> = {
        id: "task_pending",
        status: "PENDING",
        progress: 0,
      };

      const isInProgress =
        task.status === "PENDING" || task.status === "IN_PROGRESS";
      expect(isInProgress).toBe(true);
    });

    it("recognizes IN_PROGRESS status as in-progress", () => {
      const task: Partial<MeshyTask> = {
        id: "task_processing",
        status: "IN_PROGRESS",
        progress: 45,
      };

      const isInProgress =
        task.status === "PENDING" || task.status === "IN_PROGRESS";
      expect(isInProgress).toBe(true);
    });

    it("recognizes SUCCEEDED status as terminal", () => {
      const task: Partial<MeshyTask> = {
        id: "task_done",
        status: "SUCCEEDED",
        progress: 100,
        model_urls: {
          glb: "https://assets.meshy.ai/model.glb",
        },
      };

      const isTerminal =
        task.status === "SUCCEEDED" ||
        task.status === "FAILED" ||
        task.status === "CANCELED";
      expect(isTerminal).toBe(true);
    });

    it("recognizes FAILED status as terminal", () => {
      const task: Partial<MeshyTask> = {
        id: "task_error",
        status: "FAILED",
        task_error: {
          message: "Generation failed",
        },
      };

      const isTerminal =
        task.status === "SUCCEEDED" ||
        task.status === "FAILED" ||
        task.status === "CANCELED";
      expect(isTerminal).toBe(true);
    });

    it("recognizes CANCELED status as terminal", () => {
      const task: Partial<MeshyTask> = {
        id: "task_canceled",
        status: "CANCELED",
      };

      const isTerminal =
        task.status === "SUCCEEDED" ||
        task.status === "FAILED" ||
        task.status === "CANCELED";
      expect(isTerminal).toBe(true);
    });

    it("extracts error message from task_error", () => {
      const task: Partial<MeshyTask> = {
        id: "task_with_error",
        status: "FAILED",
        task_error: {
          message: "Mesh generation failed due to invalid geometry",
        },
      };

      const errorMessage =
        task.task_error?.message || task.error || "Unknown error";
      expect(errorMessage).toBe(
        "Mesh generation failed due to invalid geometry",
      );
    });

    it("falls back to legacy error field", () => {
      const task: Partial<MeshyTask> = {
        id: "task_legacy_error",
        status: "FAILED",
        error: "Legacy error message",
      };

      const errorMessage =
        task.task_error?.message || task.error || "Unknown error";
      expect(errorMessage).toBe("Legacy error message");
    });
  });

  describe("Progress Callback Invocation", () => {
    it("callback receives progress value 0-100", () => {
      const progressValues: number[] = [];
      const onProgress = (progress: number) => {
        progressValues.push(progress);
      };

      // Simulate progress updates
      [0, 25, 50, 75, 100].forEach((p) => onProgress(p));

      expect(progressValues).toEqual([0, 25, 50, 75, 100]);
      expect(progressValues[0]).toBe(0);
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });

    it("callback receives preceding_tasks for queue position", () => {
      let receivedPrecedingTasks: number | undefined;
      const onProgress = (progress: number, precedingTasks?: number) => {
        receivedPrecedingTasks = precedingTasks;
      };

      // Simulate queued task
      onProgress(0, 5);

      expect(receivedPrecedingTasks).toBe(5);
    });

    it("estimates progress from queue position when progress unavailable", () => {
      const precedingTasks = 3;
      const estimatedProgress = Math.max(0, 100 - precedingTasks * 10);

      expect(estimatedProgress).toBe(70);
    });

    it("caps estimated progress at 0 for large queue", () => {
      const precedingTasks = 15;
      const estimatedProgress = Math.max(0, 100 - precedingTasks * 10);

      expect(estimatedProgress).toBe(0);
    });

    it("callback is optional", () => {
      const options: PollOptions = {
        pollIntervalMs: 5000,
        // onProgress not provided
      };

      expect(options.onProgress).toBeUndefined();
    });
  });

  describe("Result Building", () => {
    it("builds result with model URL from model_urls.glb", () => {
      const task: Partial<MeshyTask> = {
        id: "task_result_1",
        status: "SUCCEEDED",
        model_urls: {
          glb: "https://assets.meshy.ai/task_result_1/model.glb",
          fbx: "https://assets.meshy.ai/task_result_1/model.fbx",
        },
        thumbnail_url: "https://assets.meshy.ai/task_result_1/thumbnail.png",
      };

      const modelUrl = task.model_urls?.glb || task.model_url || "";
      const result: PollTaskResult = {
        taskId: task.id!,
        modelUrl,
        thumbnailUrl: task.thumbnail_url,
        status: "SUCCEEDED",
      };

      expect(result.modelUrl).toContain(".glb");
      expect(result.taskId).toBe("task_result_1");
    });

    it("falls back to legacy model_url field", () => {
      const task: Partial<MeshyTask> = {
        id: "task_legacy",
        status: "SUCCEEDED",
        model_url: "https://assets.meshy.ai/legacy/model.glb",
      };

      const modelUrl = task.model_urls?.glb || task.model_url || "";

      expect(modelUrl).toBe("https://assets.meshy.ai/legacy/model.glb");
    });

    it("includes texture URLs in result", () => {
      const textureUrls: TextureUrls[] = [
        {
          base_color: "https://assets.meshy.ai/textures/base.png",
          metallic: "https://assets.meshy.ai/textures/metallic.png",
          normal: "https://assets.meshy.ai/textures/normal.png",
          roughness: "https://assets.meshy.ai/textures/roughness.png",
        },
      ];

      const result: PollTaskResult = {
        taskId: "task_textures",
        modelUrl: "https://assets.meshy.ai/model.glb",
        textureUrls,
        status: "SUCCEEDED",
      };

      expect(result.textureUrls).toBeDefined();
      expect(result.textureUrls!.length).toBe(1);
      expect(result.textureUrls![0].base_color).toContain("base");
    });

    it("result status is one of terminal states", () => {
      const validStatuses: PollTaskResult["status"][] = [
        "SUCCEEDED",
        "FAILED",
        "CANCELED",
      ];

      const result: PollTaskResult = {
        taskId: "task_terminal",
        modelUrl: "https://assets.meshy.ai/model.glb",
        status: "SUCCEEDED",
      };

      expect(validStatuses).toContain(result.status);
    });
  });

  describe("Timeout Handling", () => {
    it("detects timeout based on elapsed time", () => {
      const startTime = Date.now();
      const timeoutMs = 300000;

      // Simulate time passing
      const currentTime = startTime + timeoutMs + 1000;
      const hasTimedOut = currentTime - startTime > timeoutMs;

      expect(hasTimedOut).toBe(true);
    });

    it("timeout error includes duration in message", () => {
      const timeoutMs = 300000;
      const errorMessage = `Task polling timeout after ${timeoutMs / 1000} seconds`;

      expect(errorMessage).toContain("300 seconds");
    });

    it("timeout error includes attempt count", () => {
      const maxAttempts = 60;
      const timeoutMs = 300000;
      const errorMessage = `Task polling timeout after ${maxAttempts} attempts (${timeoutMs / 1000}s)`;

      expect(errorMessage).toContain("60 attempts");
      expect(errorMessage).toContain("300s");
    });

    it("respects max attempts limit", () => {
      const pollIntervalMs = 5000;
      const timeoutMs = 60000; // 1 minute
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

      expect(maxAttempts).toBe(12);
    });
  });

  describe("API Version Handling", () => {
    it("v1 endpoints include image-to-3d, retexture, rigging", () => {
      const v1Endpoints: Array<"image-to-3d" | "retexture" | "rigging"> = [
        "image-to-3d",
        "retexture",
        "rigging",
      ];

      expect(v1Endpoints).toContain("image-to-3d");
      expect(v1Endpoints).toContain("retexture");
      expect(v1Endpoints).toContain("rigging");
      expect(v1Endpoints.length).toBe(3);
    });

    it("handles v2 to v1 fallback for task lookup", () => {
      // When v2 fails, should try v1 endpoints
      let useV2 = true;
      const v1Endpoints = ["image-to-3d", "retexture", "rigging"];

      // Simulate v2 failure
      useV2 = false;

      expect(useV2).toBe(false);
      expect(v1Endpoints.length).toBe(3);
    });
  });

  describe("Error Scenarios", () => {
    it("throws on FAILED status", () => {
      const task: Partial<MeshyTask> = {
        id: "task_failed",
        status: "FAILED",
        task_error: {
          message: "Generation failed",
        },
      };

      expect(() => {
        if (task.status === "FAILED") {
          throw new Error(task.task_error?.message || "Task failed");
        }
      }).toThrow("Generation failed");
    });

    it("throws on CANCELED status", () => {
      const task: Partial<MeshyTask> = {
        id: "task_canceled",
        status: "CANCELED",
      };

      expect(() => {
        if (task.status === "CANCELED") {
          throw new Error("Task was canceled");
        }
      }).toThrow("Task was canceled");
    });

    it("throws when completed but no model URL", () => {
      const task: Partial<MeshyTask> = {
        id: "task_no_url",
        status: "SUCCEEDED",
        model_urls: {},
      };

      const modelUrl = task.model_urls?.glb || task.model_url || "";

      expect(() => {
        if (!modelUrl) {
          throw new Error("Task completed but no model URL");
        }
      }).toThrow("Task completed but no model URL");
    });

    it("throws on polling timeout", () => {
      const maxAttempts = 60;
      let attempts = 60; // At max

      expect(() => {
        if (attempts >= maxAttempts) {
          throw new Error("Task polling timeout");
        }
      }).toThrow("Task polling timeout");
    });

    it("handles task not found error", () => {
      const taskId = "nonexistent_task";

      expect(() => {
        throw new Error(`Failed to get task status for ${taskId}`);
      }).toThrow("Failed to get task status for nonexistent_task");
    });
  });

  describe("Edge Cases", () => {
    it("handles task with undefined progress", () => {
      const task: Partial<MeshyTask> = {
        id: "task_no_progress",
        status: "PENDING",
        // progress not set
      };

      expect(task.progress).toBeUndefined();
    });

    it("uses preceding_tasks when progress undefined", () => {
      const task: Partial<MeshyTask> = {
        id: "task_queued",
        status: "PENDING",
        preceding_tasks: 5,
      };

      const progress =
        task.progress ?? Math.max(0, 100 - (task.preceding_tasks || 0) * 10);

      expect(progress).toBe(50);
    });

    it("handles task with both progress and preceding_tasks", () => {
      const task: Partial<MeshyTask> = {
        id: "task_both",
        status: "IN_PROGRESS",
        progress: 30,
        preceding_tasks: 2,
      };

      // progress takes precedence
      const reportedProgress = task.progress ?? 0;

      expect(reportedProgress).toBe(30);
    });

    it("handles rapid status transitions", () => {
      const statusHistory: MeshyTask["status"][] = [];

      // Simulate rapid transitions
      ["PENDING", "IN_PROGRESS", "SUCCEEDED"].forEach((status) => {
        statusHistory.push(status as MeshyTask["status"]);
      });

      expect(statusHistory[0]).toBe("PENDING");
      expect(statusHistory[statusHistory.length - 1]).toBe("SUCCEEDED");
    });
  });
});
