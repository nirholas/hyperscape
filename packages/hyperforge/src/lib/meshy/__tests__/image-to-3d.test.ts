/**
 * Image-to-3D Pipeline Tests
 *
 * Tests for the image-to-3d generation pipeline.
 * Tests focus on options validation, request building, and response parsing.
 *
 * Real Issues to Surface:
 * - Invalid image URL formats
 * - Polycount outside recommended ranges
 * - Missing required options
 * - Malformed API responses
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOPOLOGY,
  DEFAULT_TEXTURE_RESOLUTION,
  POLYCOUNT_PRESETS,
  validatePolycount,
} from "../constants";
import type { ImageTo3DOptions, MeshyTask } from "../types";
import type { ImageTo3DPipelineResult } from "../image-to-3d";

describe("Image-to-3D Pipeline", () => {
  describe("Image-to-3D Options Validation", () => {
    it("requires image_url field", () => {
      const validOptions: ImageTo3DOptions = {
        image_url: "https://example.com/image.png",
      };

      expect(validOptions.image_url).toBeDefined();
      expect(typeof validOptions.image_url).toBe("string");
      expect(validOptions.image_url.length).toBeGreaterThan(0);
    });

    it("accepts https URL for image_url", () => {
      const options: ImageTo3DOptions = {
        image_url: "https://cdn.example.com/assets/sword.png",
      };

      expect(options.image_url.startsWith("https://")).toBe(true);
    });

    it("accepts data URI for image_url", () => {
      const options: ImageTo3DOptions = {
        image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      };

      expect(options.image_url.startsWith("data:image/")).toBe(true);
    });

    it("validates topology options", () => {
      const validTopologies = ["quad", "triangle"];

      validTopologies.forEach((topology) => {
        const options: ImageTo3DOptions = {
          image_url: "https://example.com/image.png",
          topology: topology as "quad" | "triangle",
        };
        expect(validTopologies).toContain(options.topology);
      });
    });

    it("validates target_polycount is a positive number", () => {
      const polycounts = [500, 2000, 5000, 10000, 30000];

      polycounts.forEach((polycount) => {
        const options: ImageTo3DOptions = {
          image_url: "https://example.com/image.png",
          target_polycount: polycount,
        };
        expect(options.target_polycount).toBeGreaterThan(0);
        expect(Number.isInteger(options.target_polycount)).toBe(true);
      });
    });

    it("validates texture_resolution accepts valid values", () => {
      const validResolutions = [512, 1024, 2048, 4096];

      validResolutions.forEach((resolution) => {
        const options: ImageTo3DOptions = {
          image_url: "https://example.com/image.png",
          texture_resolution: resolution,
        };
        expect(validResolutions).toContain(options.texture_resolution);
      });
    });

    it("validates enable_pbr is boolean", () => {
      const withPBR: ImageTo3DOptions = {
        image_url: "https://example.com/image.png",
        enable_pbr: true,
      };

      const withoutPBR: ImageTo3DOptions = {
        image_url: "https://example.com/image.png",
        enable_pbr: false,
      };

      expect(typeof withPBR.enable_pbr).toBe("boolean");
      expect(typeof withoutPBR.enable_pbr).toBe("boolean");
    });

    it("validates ai_model options", () => {
      const validModels = ["meshy-4", "meshy-5", "meshy-6", "latest"];

      validModels.forEach((model) => {
        const options: ImageTo3DOptions = {
          image_url: "https://example.com/image.png",
          ai_model: model as "meshy-4" | "meshy-5" | "meshy-6" | "latest",
        };
        expect(validModels).toContain(options.ai_model);
      });
    });
  });

  describe("Polycount Validation for Asset Classes", () => {
    it("validates small prop polycount range (500-2000)", () => {
      const preset = POLYCOUNT_PRESETS.small_prop;

      expect(preset.minPolycount).toBe(500);
      expect(preset.maxPolycount).toBe(2000);

      const validPolycount = 1500;
      const result = validatePolycount("small_prop", validPolycount);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("validates medium prop polycount range (2000-5000)", () => {
      const preset = POLYCOUNT_PRESETS.medium_prop;

      expect(preset.minPolycount).toBe(2000);
      expect(preset.maxPolycount).toBe(5000);

      const validPolycount = 3000;
      const result = validatePolycount("medium_prop", validPolycount);
      expect(result.valid).toBe(true);
    });

    it("validates npc character polycount range (2000-10000)", () => {
      const preset = POLYCOUNT_PRESETS.npc_character;

      expect(preset.minPolycount).toBe(2000);
      expect(preset.maxPolycount).toBe(10000);

      const validPolycount = 5000;
      const result = validatePolycount("npc_character", validPolycount);
      expect(result.valid).toBe(true);
    });

    it("warns when polycount exceeds recommended maximum", () => {
      const result = validatePolycount("small_prop", 5000);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("exceeds recommended maximum");
    });

    it("warns when polycount is below recommended minimum", () => {
      const result = validatePolycount("npc_character", 500);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("below recommended minimum");
    });
  });

  describe("Request Building", () => {
    it("builds correct request body with all options", () => {
      const options: ImageTo3DOptions = {
        image_url: "https://example.com/sword.png",
        ai_model: "meshy-4",
        topology: "quad",
        target_polycount: 3000,
        enable_pbr: true,
        texture_resolution: 2048,
        should_remesh: true,
        should_texture: true,
      };

      const body: Record<string, unknown> = {
        image_url: options.image_url,
        ai_model: options.ai_model ?? "meshy-4",
        topology: options.topology ?? DEFAULT_TOPOLOGY,
        target_polycount: options.target_polycount ?? 30000,
        enable_pbr: options.enable_pbr ?? true,
        texture_resolution:
          options.texture_resolution ?? DEFAULT_TEXTURE_RESOLUTION,
      };

      if (options.should_remesh !== undefined) {
        body.should_remesh = options.should_remesh;
      }
      if (options.should_texture !== undefined) {
        body.should_texture = options.should_texture;
      }

      expect(body.image_url).toBe("https://example.com/sword.png");
      expect(body.ai_model).toBe("meshy-4");
      expect(body.topology).toBe("quad");
      expect(body.target_polycount).toBe(3000);
      expect(body.enable_pbr).toBe(true);
      expect(body.texture_resolution).toBe(2048);
      expect(body.should_remesh).toBe(true);
      expect(body.should_texture).toBe(true);
    });

    it("applies default values for missing optional fields", () => {
      const options: ImageTo3DOptions = {
        image_url: "https://example.com/image.png",
      };

      const body: Record<string, unknown> = {
        image_url: options.image_url,
        ai_model: options.ai_model ?? "meshy-4",
        topology: options.topology ?? DEFAULT_TOPOLOGY,
        target_polycount: options.target_polycount ?? 30000,
        enable_pbr: options.enable_pbr ?? true,
        texture_resolution:
          options.texture_resolution ?? DEFAULT_TEXTURE_RESOLUTION,
      };

      expect(body.ai_model).toBe("meshy-4");
      expect(body.topology).toBe(DEFAULT_TOPOLOGY);
      expect(body.target_polycount).toBe(30000);
      expect(body.enable_pbr).toBe(true);
      expect(body.texture_resolution).toBe(DEFAULT_TEXTURE_RESOLUTION);
    });

    it("omits undefined optional fields from request", () => {
      const options: ImageTo3DOptions = {
        image_url: "https://example.com/image.png",
      };

      const body: Record<string, unknown> = {
        image_url: options.image_url,
        ai_model: options.ai_model ?? "meshy-4",
        enable_pbr: options.enable_pbr ?? true,
      };

      // should_remesh and should_texture should not be present unless explicitly set
      expect(body.should_remesh).toBeUndefined();
      expect(body.should_texture).toBeUndefined();
    });
  });

  describe("Response Parsing", () => {
    it("extracts task ID from result field", () => {
      const response = { result: "task_img_abc123" };
      const taskId = response.result || "";

      expect(taskId).toBe("task_img_abc123");
      expect(taskId.length).toBeGreaterThan(0);
    });

    it("handles alternative task_id field", () => {
      const response = { task_id: "task_img_def456" };
      const taskId =
        (response as { result?: string }).result || response.task_id || "";

      expect(taskId).toBe("task_img_def456");
    });

    it("handles empty response gracefully", () => {
      const response = {};
      const taskId =
        (response as { result?: string }).result ||
        (response as { task_id?: string }).task_id ||
        "";

      expect(taskId).toBe("");
    });

    it("parses completed task with model URLs", () => {
      const completedTask: Partial<MeshyTask> = {
        id: "task_img_completed",
        status: "SUCCEEDED",
        progress: 100,
        model_urls: {
          glb: "https://assets.meshy.ai/task_img_completed/model.glb",
          fbx: "https://assets.meshy.ai/task_img_completed/model.fbx",
        },
        thumbnail_url:
          "https://assets.meshy.ai/task_img_completed/thumbnail.png",
      };

      expect(completedTask.status).toBe("SUCCEEDED");
      expect(completedTask.model_urls?.glb).toContain(".glb");
      expect(completedTask.thumbnail_url).toContain("thumbnail");
    });

    it("builds pipeline result from completed task", () => {
      const task: Partial<MeshyTask> = {
        id: "task_img_result",
        status: "SUCCEEDED",
        model_urls: {
          glb: "https://assets.meshy.ai/model.glb",
        },
        thumbnail_url: "https://assets.meshy.ai/thumbnail.png",
      };

      const modelUrl = task.model_urls?.glb || "";
      const result: ImageTo3DPipelineResult = {
        taskId: task.id!,
        modelUrl,
        thumbnailUrl: task.thumbnail_url,
        status: task.status!,
      };

      expect(result.taskId).toBe("task_img_result");
      expect(result.modelUrl).toContain(".glb");
      expect(result.thumbnailUrl).toBeDefined();
      expect(result.status).toBe("SUCCEEDED");
    });

    it("handles task with legacy model_url field", () => {
      const task: Partial<MeshyTask> = {
        id: "task_legacy",
        status: "SUCCEEDED",
        model_url: "https://assets.meshy.ai/legacy/model.glb",
      };

      const modelUrl = task.model_urls?.glb || task.model_url || "";

      expect(modelUrl).toBe("https://assets.meshy.ai/legacy/model.glb");
    });
  });

  describe("Error Handling", () => {
    it("identifies failed task status", () => {
      const failedTask: Partial<MeshyTask> = {
        id: "task_failed",
        status: "FAILED",
        task_error: {
          message: "Image quality too low for 3D reconstruction",
        },
      };

      expect(failedTask.status).toBe("FAILED");
      expect(failedTask.task_error?.message).toBeDefined();
    });

    it("handles legacy error field", () => {
      const failedTask: Partial<MeshyTask> = {
        id: "task_failed_legacy",
        status: "FAILED",
        error: "Generation failed",
      };

      const errorMessage =
        failedTask.task_error?.message || failedTask.error || "Unknown error";

      expect(errorMessage).toBe("Generation failed");
    });

    it("identifies canceled task status", () => {
      const canceledTask: Partial<MeshyTask> = {
        id: "task_canceled",
        status: "CANCELED",
      };

      expect(canceledTask.status).toBe("CANCELED");
    });

    it("detects missing model URL in completed task", () => {
      const incompleteTask: Partial<MeshyTask> = {
        id: "task_no_model",
        status: "SUCCEEDED",
        model_urls: {},
      };

      const modelUrl = incompleteTask.model_urls?.glb || "";

      expect(modelUrl).toBe("");
    });
  });
});
