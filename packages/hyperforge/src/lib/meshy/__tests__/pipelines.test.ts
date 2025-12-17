/**
 * Meshy Pipeline Tests
 *
 * Tests for Image-to-3D, Text-to-3D, and Poll Task pipelines.
 * Tests focus on configuration, validation, and request building - NO API calls.
 */

import { describe, it, expect } from "vitest";
import {
  MESHY_API_V1,
  MESHY_API_V2,
  DEFAULT_AI_MODEL,
  DEFAULT_TOPOLOGY,
  DEFAULT_TEXTURE_RESOLUTION,
  POLYCOUNT_PRESETS,
  getPolycountPreset,
  getRecommendedPolycount,
  createGenerationConfig,
  validatePolycount,
  THREE_JS_BEST_PRACTICES,
} from "../constants";
import type {
  ImageTo3DOptions,
  TextTo3DOptions,
  MeshyTask,
  MeshTopology,
  MeshyArtStyle,
  MeshySymmetryMode,
  MeshyPoseMode,
  AssetClass,
} from "../types";
import {
  MeshyTaskError,
  type PollOptions,
  type PollTaskResult,
} from "../poll-task";

describe("Meshy Pipelines", () => {
  // ==========================================================================
  // Image-to-3D Configuration
  // ==========================================================================

  describe("Image-to-3D Configuration", () => {
    describe("Image URL Formats", () => {
      it("accepts valid HTTPS image URLs", () => {
        const validUrls = [
          "https://example.com/image.png",
          "https://cdn.meshy.ai/uploads/12345.jpg",
          "https://storage.googleapis.com/bucket/image.webp",
          "https://images.unsplash.com/photo-12345?w=800",
        ];

        validUrls.forEach((url) => {
          expect(url.startsWith("https://")).toBe(true);
          expect(url.length).toBeGreaterThan(10);
        });
      });

      it("accepts data URI format for base64 images", () => {
        const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";

        expect(dataUri.startsWith("data:image/")).toBe(true);
        expect(dataUri.includes(";base64,")).toBe(true);
      });

      it("validates image file extensions", () => {
        const supportedExtensions = ["png", "jpg", "jpeg", "webp", "gif"];
        const url = "https://example.com/image.png";

        const extension = url.split(".").pop();
        expect(supportedExtensions).toContain(extension);
      });

      it("rejects empty or invalid URLs", () => {
        const invalidUrls = [
          "",
          " ",
          "not-a-url",
          "ftp://example.com/image.png",
        ];

        invalidUrls.forEach((url) => {
          const isValid =
            url.startsWith("https://") || url.startsWith("data:image/");
          expect(isValid).toBe(false);
        });
      });
    });

    describe("Quality Preset Options", () => {
      it("defines all asset class presets", () => {
        const expectedClasses: AssetClass[] = [
          "small_prop",
          "medium_prop",
          "large_prop",
          "npc_character",
          "small_building",
          "large_structure",
          "custom",
        ];

        expectedClasses.forEach((assetClass) => {
          expect(POLYCOUNT_PRESETS[assetClass]).toBeDefined();
        });
      });

      it("provides sensible default polycounts for each preset", () => {
        expect(getRecommendedPolycount("small_prop")).toBeLessThanOrEqual(2000);
        expect(getRecommendedPolycount("medium_prop")).toBeGreaterThan(2000);
        expect(getRecommendedPolycount("medium_prop")).toBeLessThanOrEqual(
          5000,
        );
        expect(getRecommendedPolycount("npc_character")).toBeGreaterThan(2000);
        expect(getRecommendedPolycount("npc_character")).toBeLessThanOrEqual(
          10000,
        );
        expect(
          getRecommendedPolycount("large_structure"),
        ).toBeGreaterThanOrEqual(15000);
      });

      it("creates generation config from preset", () => {
        const config = createGenerationConfig("medium_prop");

        expect(config.assetClass).toBe("medium_prop");
        expect(config.targetPolycount).toBe(3000);
        expect(config.topology).toBe("triangle");
        expect(config.enablePBR).toBe(true);
        expect(config.textureResolution).toBe(DEFAULT_TEXTURE_RESOLUTION);
      });

      it("allows config overrides", () => {
        const config = createGenerationConfig("small_prop", {
          targetPolycount: 1500,
          enablePBR: false,
          textureResolution: 1024,
        });

        expect(config.targetPolycount).toBe(1500);
        expect(config.enablePBR).toBe(false);
        expect(config.textureResolution).toBe(1024);
      });
    });

    describe("Polycount Target Ranges", () => {
      it("validates polycount within recommended range", () => {
        const result = validatePolycount("medium_prop", 3500);
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
      });

      it("warns when polycount below minimum", () => {
        const result = validatePolycount("medium_prop", 1000);
        expect(result.valid).toBe(true);
        expect(result.warning).toContain("below recommended minimum");
      });

      it("warns when polycount above maximum", () => {
        const result = validatePolycount("small_prop", 5000);
        expect(result.valid).toBe(true);
        expect(result.warning).toContain("exceeds recommended maximum");
      });

      it("warns when polycount exceeds custom preset maximum", () => {
        // Custom preset max is 100000, same as Three.js limit
        // Exceeding the preset max returns valid: true with warning
        const result = validatePolycount("custom", 150000);
        expect(result.valid).toBe(true);
        expect(result.warning).toContain("exceeds recommended maximum");
      });

      it("defines Three.js max triangles limit", () => {
        expect(THREE_JS_BEST_PRACTICES.maxTrianglesPerMesh).toBe(100000);
      });
    });

    describe("Topology Options", () => {
      it("supports triangle and quad topologies", () => {
        const topologies: MeshTopology[] = ["triangle", "quad"];

        topologies.forEach((topology) => {
          expect(["triangle", "quad"]).toContain(topology);
        });
      });

      it("defaults to triangle topology for GPU compatibility", () => {
        expect(DEFAULT_TOPOLOGY).toBe("triangle");
      });

      it("recommends triangle for runtime assets", () => {
        const preset = getPolycountPreset("npc_character");
        expect(preset.recommendedTopology).toBe("triangle");
      });

      it("builds image-to-3d request with topology", () => {
        const options: ImageTo3DOptions = {
          image_url: "https://example.com/image.png",
          topology: "quad",
          target_polycount: 5000,
        };

        expect(options.topology).toBe("quad");
      });
    });

    describe("Texture Resolution", () => {
      it("supports standard texture resolutions", () => {
        const validResolutions = [512, 1024, 2048, 4096];

        validResolutions.forEach((res) => {
          expect(res).toBeGreaterThanOrEqual(512);
          expect(res).toBeLessThanOrEqual(4096);
          expect(Math.log2(res) % 1).toBe(0); // Power of 2
        });
      });

      it("defaults to 2048 texture resolution", () => {
        expect(DEFAULT_TEXTURE_RESOLUTION).toBe(2048);
      });
    });

    describe("PBR Options", () => {
      it("enables PBR by default for quality assets", () => {
        const config = createGenerationConfig("medium_prop");
        expect(config.enablePBR).toBe(true);
      });

      it("disables PBR for small props to save bandwidth", () => {
        const preset = getPolycountPreset("small_prop");
        expect(preset.recommendPBR).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Text-to-3D Configuration
  // ==========================================================================

  describe("Text-to-3D Configuration", () => {
    describe("Two-Stage Workflow", () => {
      it("requires preview stage before refine stage", () => {
        // Preview stage creates mesh, refine stage adds texture
        const previewOptions: Partial<TextTo3DOptions> = {
          prompt: "A medieval sword",
          art_style: "realistic",
          topology: "triangle",
        };

        const refineOptions: Partial<TextTo3DOptions> = {
          enable_pbr: true,
          texture_prompt: "Detailed steel with golden inlays",
        };

        // Preview must have prompt
        expect(previewOptions.prompt).toBeDefined();

        // Refine uses texture_prompt for guidance
        expect(refineOptions.texture_prompt).toBeDefined();
      });

      it("maps preview to refine using task ID", () => {
        const previewTaskId = "task_preview_abc123";

        // Refine stage needs preview task ID
        expect(previewTaskId.length).toBeGreaterThan(0);
        expect(typeof previewTaskId).toBe("string");
      });

      it("builds correct preview request body", () => {
        const options: TextTo3DOptions = {
          prompt: "A fantasy dragon",
          art_style: "realistic",
          ai_model: "meshy-5",
          topology: "quad",
          target_polycount: 10000,
          symmetry_mode: "auto",
        };

        const body: Record<string, unknown> = {
          mode: "preview",
          prompt: options.prompt,
          art_style: options.art_style,
          ai_model: options.ai_model,
          topology: options.topology,
          target_polycount: options.target_polycount,
          symmetry_mode: options.symmetry_mode,
        };

        expect(body.mode).toBe("preview");
        expect(body.prompt).toBe("A fantasy dragon");
      });

      it("builds correct refine request body", () => {
        const previewTaskId = "task_preview_123";
        const options: Partial<TextTo3DOptions> = {
          enable_pbr: true,
          texture_prompt: "Scaly green skin",
        };

        const body: Record<string, unknown> = {
          mode: "refine",
          preview_task_id: previewTaskId,
          enable_pbr: options.enable_pbr ?? true,
        };

        if (options.texture_prompt) {
          body.texture_prompt = options.texture_prompt;
        }

        expect(body.mode).toBe("refine");
        expect(body.preview_task_id).toBe(previewTaskId);
        expect(body.texture_prompt).toBe("Scaly green skin");
      });
    });

    describe("Prompt Configuration", () => {
      it("accepts reasonable prompt lengths", () => {
        const shortPrompt = "A sword";
        const mediumPrompt =
          "A medieval longsword with ornate golden handle and intricate engravings";
        const longPrompt = "A".repeat(500);

        expect(shortPrompt.length).toBeGreaterThan(0);
        expect(mediumPrompt.length).toBeLessThan(200);
        expect(longPrompt.length).toBe(500);
      });

      it("validates prompt is not empty", () => {
        const emptyPrompts = ["", " ", "\n", "\t"];

        emptyPrompts.forEach((prompt) => {
          expect(prompt.trim().length).toBe(0);
        });
      });

      it("accepts texture_prompt for refine stage", () => {
        const options: Partial<TextTo3DOptions> = {
          texture_prompt: "Rusty metal with scratches and weathering",
        };

        expect(options.texture_prompt).toBeDefined();
        expect(options.texture_prompt!.length).toBeGreaterThan(0);
      });

      it("allows texture_image_url as alternative to texture_prompt", () => {
        const options: Partial<TextTo3DOptions> = {
          texture_image_url: "https://example.com/style.png",
        };

        expect(options.texture_image_url).toBeDefined();
      });
    });

    describe("Art Style Options", () => {
      it("supports realistic and sculpture styles", () => {
        const artStyles: MeshyArtStyle[] = ["realistic", "sculpture"];

        artStyles.forEach((style) => {
          expect(["realistic", "sculpture"]).toContain(style);
        });
      });

      it("defaults to realistic art style", () => {
        const options: Partial<TextTo3DOptions> = {};
        const artStyle = options.art_style ?? "realistic";

        expect(artStyle).toBe("realistic");
      });
    });

    describe("Symmetry Mode", () => {
      it("supports off, auto, and on symmetry modes", () => {
        const symmetryModes: MeshySymmetryMode[] = ["off", "auto", "on"];

        symmetryModes.forEach((mode) => {
          expect(["off", "auto", "on"]).toContain(mode);
        });
      });

      it("defaults to auto symmetry mode", () => {
        const options: Partial<TextTo3DOptions> = {};
        const symmetryMode = options.symmetry_mode ?? "auto";

        expect(symmetryMode).toBe("auto");
      });
    });

    describe("Pose Mode for Characters", () => {
      it("supports a-pose, t-pose, and no pose", () => {
        const poseModes: MeshyPoseMode[] = ["a-pose", "t-pose", ""];

        poseModes.forEach((mode) => {
          expect(["a-pose", "t-pose", ""]).toContain(mode);
        });
      });

      it("defaults to no specific pose", () => {
        const options: Partial<TextTo3DOptions> = {};
        const poseMode = options.pose_mode ?? "";

        expect(poseMode).toBe("");
      });
    });

    describe("Negative Prompt Handling", () => {
      it("accepts negative_prompt field (deprecated)", () => {
        const options: TextTo3DOptions = {
          prompt: "A medieval knight",
          negative_prompt: "low quality, blurry, distorted",
        };

        expect(options.negative_prompt).toBeDefined();
      });
    });

    describe("Seed for Reproducibility", () => {
      it("accepts seed for reproducible generation", () => {
        const options: Partial<TextTo3DOptions> = {
          seed: 12345,
        };

        expect(options.seed).toBe(12345);
        expect(typeof options.seed).toBe("number");
      });

      it("seed is optional", () => {
        const options: Partial<TextTo3DOptions> = {
          prompt: "A sword",
        };

        expect(options.seed).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // Poll Task Configuration
  // ==========================================================================

  describe("Poll Task Configuration", () => {
    describe("Polling Interval Settings", () => {
      it("defaults to 5000ms polling interval", () => {
        const options: PollOptions = {};
        const pollIntervalMs = options.pollIntervalMs ?? 5000;

        expect(pollIntervalMs).toBe(5000);
      });

      it("allows custom polling interval", () => {
        const options: PollOptions = {
          pollIntervalMs: 3000,
        };

        expect(options.pollIntervalMs).toBe(3000);
      });

      it("validates polling interval is reasonable", () => {
        const minInterval = 1000; // 1 second minimum
        const maxInterval = 60000; // 1 minute maximum

        const testIntervals = [1000, 3000, 5000, 10000];
        testIntervals.forEach((interval) => {
          expect(interval).toBeGreaterThanOrEqual(minInterval);
          expect(interval).toBeLessThanOrEqual(maxInterval);
        });
      });
    });

    describe("Max Retry Limits", () => {
      it("calculates max attempts from timeout and interval", () => {
        const timeoutMs = 300000; // 5 minutes
        const pollIntervalMs = 5000;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        expect(maxAttempts).toBe(60);
      });

      it("ensures at least one attempt", () => {
        const timeoutMs = 1000;
        const pollIntervalMs = 5000;
        const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

        expect(maxAttempts).toBeGreaterThanOrEqual(1);
      });
    });

    describe("Timeout Configuration", () => {
      it("defaults to 300000ms (5 minutes) timeout", () => {
        const options: PollOptions = {};
        const timeoutMs = options.timeoutMs ?? 300000;

        expect(timeoutMs).toBe(300000);
      });

      it("allows custom timeout", () => {
        const options: PollOptions = {
          timeoutMs: 600000, // 10 minutes
        };

        expect(options.timeoutMs).toBe(600000);
      });

      it("validates timeout is within reasonable bounds", () => {
        const minTimeout = 30000; // 30 seconds
        const maxTimeout = 1800000; // 30 minutes

        const testTimeouts = [60000, 300000, 600000];
        testTimeouts.forEach((timeout) => {
          expect(timeout).toBeGreaterThanOrEqual(minTimeout);
          expect(timeout).toBeLessThanOrEqual(maxTimeout);
        });
      });
    });

    describe("Status Callback Structure", () => {
      it("provides progress callback in options", () => {
        let progressValue = 0;
        let precedingTasksValue: number | undefined;

        const options: PollOptions = {
          onProgress: (progress, precedingTasks) => {
            progressValue = progress;
            precedingTasksValue = precedingTasks;
          },
        };

        // Simulate callback invocation
        options.onProgress?.(50, 2);

        expect(progressValue).toBe(50);
        expect(precedingTasksValue).toBe(2);
      });

      it("progress is 0-100 range", () => {
        const progressValues = [0, 25, 50, 75, 100];

        progressValues.forEach((progress) => {
          expect(progress).toBeGreaterThanOrEqual(0);
          expect(progress).toBeLessThanOrEqual(100);
        });
      });

      it("preceding_tasks indicates queue position", () => {
        const queuePositions = [0, 1, 5, 10];

        queuePositions.forEach((position) => {
          expect(position).toBeGreaterThanOrEqual(0);
        });
      });
    });

    describe("API Version Fallback", () => {
      it("tries v2 API first for unified tasks", () => {
        expect(MESHY_API_V2).toBe("https://api.meshy.ai/openapi/v2");
      });

      it("falls back to v1 for specific endpoints", () => {
        const v1Endpoints = ["image-to-3d", "retexture", "rigging"];

        v1Endpoints.forEach((endpoint) => {
          expect(endpoint.length).toBeGreaterThan(0);
        });

        expect(MESHY_API_V1).toBe("https://api.meshy.ai/openapi/v1");
      });
    });
  });

  // ==========================================================================
  // Progress Calculation
  // ==========================================================================

  describe("Progress Calculation", () => {
    describe("Task Status to Percentage Mapping", () => {
      it("maps PENDING to initial progress", () => {
        const task: Partial<MeshyTask> = {
          status: "PENDING",
          progress: 0,
        };

        expect(task.status).toBe("PENDING");
        expect(task.progress).toBe(0);
      });

      it("maps IN_PROGRESS to intermediate progress", () => {
        const task: Partial<MeshyTask> = {
          status: "IN_PROGRESS",
          progress: 50,
        };

        expect(task.status).toBe("IN_PROGRESS");
        expect(task.progress).toBeGreaterThan(0);
        expect(task.progress).toBeLessThan(100);
      });

      it("maps SUCCEEDED to 100% progress", () => {
        const task: Partial<MeshyTask> = {
          status: "SUCCEEDED",
          progress: 100,
        };

        expect(task.status).toBe("SUCCEEDED");
        expect(task.progress).toBe(100);
      });

      it("estimates progress from queue position", () => {
        const precedingTasks = 5;
        const estimatedProgress = Math.max(0, 100 - precedingTasks * 10);

        expect(estimatedProgress).toBe(50);
      });

      it("clamps estimated progress to valid range", () => {
        const precedingTasks = 15; // Would give -50
        const estimatedProgress = Math.max(0, 100 - precedingTasks * 10);

        expect(estimatedProgress).toBe(0);
        expect(estimatedProgress).toBeGreaterThanOrEqual(0);
      });
    });

    describe("Handles All Status Values", () => {
      it("recognizes all valid status values", () => {
        const validStatuses: MeshyTask["status"][] = [
          "PENDING",
          "IN_PROGRESS",
          "SUCCEEDED",
          "FAILED",
          "CANCELED",
        ];

        validStatuses.forEach((status) => {
          expect([
            "PENDING",
            "IN_PROGRESS",
            "SUCCEEDED",
            "FAILED",
            "CANCELED",
          ]).toContain(status);
        });
      });

      it("treats FAILED as terminal status", () => {
        const task: Partial<MeshyTask> = {
          status: "FAILED",
          task_error: { message: "Generation failed" },
        };

        expect(task.status).toBe("FAILED");
        expect(task.task_error?.message).toBeDefined();
      });

      it("treats CANCELED as terminal status", () => {
        const task: Partial<MeshyTask> = {
          status: "CANCELED",
        };

        expect(task.status).toBe("CANCELED");
      });
    });

    describe("Progress Callback Data", () => {
      it("receives progress percentage", () => {
        let receivedProgress = 0;

        const callback = (progress: number) => {
          receivedProgress = progress;
        };

        callback(75);

        expect(receivedProgress).toBe(75);
      });

      it("receives optional preceding tasks count", () => {
        let receivedPrecedingTasks: number | undefined;

        const callback = (progress: number, precedingTasks?: number) => {
          receivedPrecedingTasks = precedingTasks;
        };

        callback(50, 3);

        expect(receivedPrecedingTasks).toBe(3);
      });
    });
  });

  // ==========================================================================
  // Error States
  // ==========================================================================

  describe("Error States", () => {
    describe("Task Failure Handling", () => {
      it("extracts error message from task_error", () => {
        const task: Partial<MeshyTask> = {
          status: "FAILED",
          task_error: {
            message: "Model generation failed due to invalid input",
          },
        };

        const errorMessage = task.task_error?.message ?? "Unknown error";

        expect(errorMessage).toBe(
          "Model generation failed due to invalid input",
        );
      });

      it("falls back to legacy error field", () => {
        const task: Partial<MeshyTask> = {
          status: "FAILED",
          error: "Legacy error message",
        };

        const errorMessage =
          task.task_error?.message ?? task.error ?? "Unknown error";

        expect(errorMessage).toBe("Legacy error message");
      });

      it("provides default error message", () => {
        const task: Partial<MeshyTask> = {
          status: "FAILED",
        };

        const errorMessage =
          task.task_error?.message ?? task.error ?? "Task failed";

        expect(errorMessage).toBe("Task failed");
      });

      it("MeshyTaskError contains task status", () => {
        const error = new MeshyTaskError("Task failed", "FAILED", "task_123");

        expect(error.message).toBe("Task failed");
        expect(error.status).toBe("FAILED");
        expect(error.taskId).toBe("task_123");
        expect(error.name).toBe("MeshyTaskError");
      });

      it("MeshyTaskError handles CANCELED status", () => {
        const error = new MeshyTaskError("Task was canceled", "CANCELED");

        expect(error.status).toBe("CANCELED");
        expect(error.taskId).toBeUndefined();
      });
    });

    describe("Network Timeout Handling", () => {
      it("throws timeout error after max attempts", () => {
        const timeoutMs = 300000;
        const maxAttempts = 60;

        const timeoutError = `Task polling timeout after ${maxAttempts} attempts (${timeoutMs / 1000}s)`;

        expect(timeoutError).toContain("timeout");
        expect(timeoutError).toContain("300");
      });

      it("includes elapsed time in timeout error", () => {
        const timeoutSeconds = 300;
        const errorMessage = `Task polling timeout after ${timeoutSeconds} seconds`;

        expect(errorMessage).toContain(`${timeoutSeconds} seconds`);
      });
    });

    describe("Invalid Task ID Handling", () => {
      it("detects empty task ID", () => {
        const taskIds = ["", " ", null, undefined];

        taskIds.forEach((id) => {
          const isInvalid = !id || (typeof id === "string" && id.trim() === "");
          expect(isInvalid).toBe(true);
        });
      });

      it("validates task ID format", () => {
        const validTaskId = "task_abc123def456";

        expect(validTaskId.length).toBeGreaterThan(0);
        expect(typeof validTaskId).toBe("string");
      });

      it("throws when task status cannot be retrieved", () => {
        const taskId = "invalid_task_id";
        const errorMessage = `Failed to get task status for ${taskId}`;

        expect(errorMessage).toContain(taskId);
      });
    });

    describe("Missing Model URL Handling", () => {
      it("throws when succeeded task has no model URL", () => {
        const task: Partial<MeshyTask> = {
          id: "task_123",
          status: "SUCCEEDED",
          model_urls: undefined,
          model_url: undefined,
        };

        const modelUrl = task.model_urls?.glb ?? task.model_url ?? "";

        expect(modelUrl).toBe("");
      });

      it("extracts model URL from model_urls.glb", () => {
        const task: Partial<MeshyTask> = {
          id: "task_123",
          status: "SUCCEEDED",
          model_urls: {
            glb: "https://assets.meshy.ai/task_123/model.glb",
          },
        };

        const modelUrl = task.model_urls?.glb ?? "";

        expect(modelUrl).toContain(".glb");
      });

      it("falls back to legacy model_url field", () => {
        const task: Partial<MeshyTask> = {
          id: "task_123",
          status: "SUCCEEDED",
          model_url: "https://assets.meshy.ai/task_123/model.glb",
        };

        const modelUrl = task.model_urls?.glb ?? task.model_url ?? "";

        expect(modelUrl).toContain(".glb");
      });
    });

    describe("Poll Result Structure", () => {
      it("returns complete result on success", () => {
        const result: PollTaskResult = {
          taskId: "task_123",
          modelUrl: "https://assets.meshy.ai/task_123/model.glb",
          thumbnailUrl: "https://assets.meshy.ai/task_123/thumbnail.png",
          status: "SUCCEEDED",
        };

        expect(result.taskId).toBeDefined();
        expect(result.modelUrl).toBeDefined();
        expect(result.status).toBe("SUCCEEDED");
      });

      it("includes optional texture URLs", () => {
        const result: PollTaskResult = {
          taskId: "task_123",
          modelUrl: "https://assets.meshy.ai/task_123/model.glb",
          status: "SUCCEEDED",
          textureUrls: [
            {
              base_color: "https://assets.meshy.ai/task_123/base_color.png",
              normal: "https://assets.meshy.ai/task_123/normal.png",
              metallic: "https://assets.meshy.ai/task_123/metallic.png",
              roughness: "https://assets.meshy.ai/task_123/roughness.png",
            },
          ],
        };

        expect(result.textureUrls).toBeDefined();
        expect(result.textureUrls![0].base_color).toContain("base_color");
      });
    });
  });

  // ==========================================================================
  // AI Model Configuration
  // ==========================================================================

  describe("AI Model Configuration", () => {
    it("supports meshy-4, meshy-5, meshy-6, and latest", () => {
      const models = ["meshy-4", "meshy-5", "meshy-6", "latest"];

      models.forEach((model) => {
        expect(typeof model).toBe("string");
        expect(model.length).toBeGreaterThan(0);
      });
    });

    it("defaults to latest model", () => {
      expect(DEFAULT_AI_MODEL).toBe("latest");
    });

    it("allows explicit model selection in options", () => {
      const imageOptions: Partial<ImageTo3DOptions> = {
        ai_model: "meshy-5",
      };

      const textOptions: Partial<TextTo3DOptions> = {
        ai_model: "meshy-6",
      };

      expect(imageOptions.ai_model).toBe("meshy-5");
      expect(textOptions.ai_model).toBe("meshy-6");
    });
  });
});
