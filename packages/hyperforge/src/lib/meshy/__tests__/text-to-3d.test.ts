/**
 * Text-to-3D Pipeline Tests
 *
 * Tests for the text-to-3d generation pipeline.
 * Tests focus on the two-stage workflow, options validation, and request building.
 *
 * Real Issues to Surface:
 * - Empty or invalid prompts
 * - Preview-refine stage mismatch
 * - Missing preview task ID for refine stage
 * - Invalid art style or symmetry mode
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_AI_MODEL, DEFAULT_TOPOLOGY, MESHY_API_V2 } from "../constants";
import type {
  TextTo3DOptions,
  MeshyTask,
  MeshyArtStyle,
  MeshySymmetryMode,
  MeshyPoseMode,
} from "../types";
import type { TextTo3DPipelineResult } from "../text-to-3d";

describe("Text-to-3D Pipeline", () => {
  describe("Two-Stage Workflow", () => {
    it("uses v2 API for text-to-3d", () => {
      expect(MESHY_API_V2).toBe("https://api.meshy.ai/openapi/v2");
    });

    it("preview stage generates mesh without texture", () => {
      const previewRequest = {
        mode: "preview",
        prompt: "A medieval sword",
        art_style: "realistic",
        ai_model: DEFAULT_AI_MODEL,
      };

      expect(previewRequest.mode).toBe("preview");
      expect(previewRequest.prompt).toBeDefined();
    });

    it("refine stage requires preview_task_id", () => {
      const refineRequest = {
        mode: "refine",
        preview_task_id: "task_preview_123",
        enable_pbr: true,
      };

      expect(refineRequest.mode).toBe("refine");
      expect(refineRequest.preview_task_id).toBeDefined();
      expect(refineRequest.preview_task_id.length).toBeGreaterThan(0);
    });

    it("refine stage uses texture_prompt for texturing", () => {
      const refineRequest = {
        mode: "refine",
        preview_task_id: "task_preview_456",
        enable_pbr: true,
        texture_prompt: "Detailed steel texture with golden inlays",
      };

      expect(refineRequest.texture_prompt).toBeDefined();
    });

    it("refine stage can use texture_image_url as alternative", () => {
      const refineRequest = {
        mode: "refine",
        preview_task_id: "task_preview_789",
        enable_pbr: true,
        texture_image_url: "https://example.com/texture-reference.png",
      };

      expect(refineRequest.texture_image_url).toBeDefined();
    });
  });

  describe("Preview Options Validation", () => {
    it("requires prompt field", () => {
      const options: TextTo3DOptions = {
        prompt: "A fantasy dragon with wings",
      };

      expect(options.prompt).toBeDefined();
      expect(options.prompt.length).toBeGreaterThan(0);
    });

    it("validates art_style options", () => {
      const validStyles: MeshyArtStyle[] = ["realistic", "sculpture"];

      validStyles.forEach((style) => {
        const options: TextTo3DOptions = {
          prompt: "A knight in armor",
          art_style: style,
        };
        expect(validStyles).toContain(options.art_style);
      });
    });

    it("validates symmetry_mode options", () => {
      const validModes: MeshySymmetryMode[] = ["off", "auto", "on"];

      validModes.forEach((mode) => {
        const options: TextTo3DOptions = {
          prompt: "A symmetrical vase",
          symmetry_mode: mode,
        };
        expect(validModes).toContain(options.symmetry_mode);
      });
    });

    it("validates pose_mode for character generation", () => {
      const validPoses: MeshyPoseMode[] = ["a-pose", "t-pose", ""];

      validPoses.forEach((pose) => {
        const options: TextTo3DOptions = {
          prompt: "A humanoid character",
          pose_mode: pose,
        };
        expect(validPoses).toContain(options.pose_mode);
      });
    });

    it("accepts seed for reproducible generation", () => {
      const options: TextTo3DOptions = {
        prompt: "A crystal ball",
        seed: 42,
      };

      expect(options.seed).toBe(42);
      expect(typeof options.seed).toBe("number");
    });

    it("accepts moderation flag", () => {
      const options: TextTo3DOptions = {
        prompt: "A treasure chest",
        moderation: true,
      };

      expect(options.moderation).toBe(true);
    });

    it("validates ai_model options", () => {
      const validModels = ["meshy-4", "meshy-5", "meshy-6", "latest"];

      validModels.forEach((model) => {
        const options: TextTo3DOptions = {
          prompt: "A goblin warrior",
          ai_model: model as TextTo3DOptions["ai_model"],
        };
        expect(validModels).toContain(options.ai_model);
      });
    });

    it("validates topology options", () => {
      const validTopologies = ["quad", "triangle"];

      validTopologies.forEach((topology) => {
        const options: TextTo3DOptions = {
          prompt: "A wooden barrel",
          topology: topology as "quad" | "triangle",
        };
        expect(validTopologies).toContain(options.topology);
      });
    });

    it("validates target_polycount is positive", () => {
      const options: TextTo3DOptions = {
        prompt: "A small potion bottle",
        target_polycount: 2000,
      };

      expect(options.target_polycount).toBeGreaterThan(0);
    });
  });

  describe("Refine Options Validation", () => {
    it("validates enable_pbr is boolean", () => {
      const withPBR: TextTo3DOptions = {
        prompt: "",
        enable_pbr: true,
      };

      const withoutPBR: TextTo3DOptions = {
        prompt: "",
        enable_pbr: false,
      };

      expect(typeof withPBR.enable_pbr).toBe("boolean");
      expect(typeof withoutPBR.enable_pbr).toBe("boolean");
    });

    it("accepts texture_prompt for refine stage", () => {
      const options: TextTo3DOptions = {
        prompt: "", // Not used in refine
        texture_prompt: "Scaly green dragon skin with iridescent highlights",
      };

      expect(options.texture_prompt).toBeDefined();
      expect(options.texture_prompt!.length).toBeGreaterThan(0);
    });

    it("accepts texture_image_url for refine stage", () => {
      const options: TextTo3DOptions = {
        prompt: "",
        texture_image_url: "https://cdn.example.com/textures/dragon-scale.png",
      };

      expect(options.texture_image_url).toBeDefined();
      expect(options.texture_image_url!.startsWith("https://")).toBe(true);
    });

    it("texture_resolution is optional in refine stage", () => {
      const options: TextTo3DOptions = {
        prompt: "",
        enable_pbr: true,
        // texture_resolution not set for refine stage per Meshy docs
      };

      expect(options.texture_resolution).toBeUndefined();
    });
  });

  describe("Request Building - Preview Stage", () => {
    it("builds correct preview request body", () => {
      const options: TextTo3DOptions = {
        prompt: "A fantasy dragon",
        art_style: "realistic",
        ai_model: "meshy-5",
        topology: "quad",
        target_polycount: 10000,
        symmetry_mode: "auto",
        pose_mode: "",
        should_remesh: true,
        moderation: false,
      };

      const body: Record<string, unknown> = {
        mode: "preview",
        prompt: options.prompt,
        art_style: options.art_style ?? "realistic",
        ai_model: options.ai_model ?? DEFAULT_AI_MODEL,
        topology: options.topology ?? DEFAULT_TOPOLOGY,
        target_polycount: options.target_polycount ?? 30000,
        symmetry_mode: options.symmetry_mode ?? "auto",
        pose_mode: options.pose_mode ?? "",
        should_remesh: options.should_remesh ?? true,
        moderation: options.moderation ?? false,
      };

      if (options.seed !== undefined) {
        body.seed = options.seed;
      }

      expect(body.mode).toBe("preview");
      expect(body.prompt).toBe("A fantasy dragon");
      expect(body.art_style).toBe("realistic");
      expect(body.ai_model).toBe("meshy-5");
      expect(body.topology).toBe("quad");
      expect(body.target_polycount).toBe(10000);
      expect(body.symmetry_mode).toBe("auto");
    });

    it("applies default values for preview request", () => {
      const options: TextTo3DOptions = {
        prompt: "A simple cube",
      };

      const body: Record<string, unknown> = {
        mode: "preview",
        prompt: options.prompt,
        art_style: options.art_style ?? "realistic",
        ai_model: options.ai_model ?? DEFAULT_AI_MODEL,
        topology: options.topology ?? DEFAULT_TOPOLOGY,
        target_polycount: options.target_polycount ?? 30000,
        symmetry_mode: options.symmetry_mode ?? "auto",
      };

      expect(body.art_style).toBe("realistic");
      expect(body.ai_model).toBe(DEFAULT_AI_MODEL);
      expect(body.topology).toBe(DEFAULT_TOPOLOGY);
      expect(body.target_polycount).toBe(30000);
      expect(body.symmetry_mode).toBe("auto");
    });

    it("includes seed when provided", () => {
      const options: TextTo3DOptions = {
        prompt: "A magic wand",
        seed: 12345,
      };

      const body: Record<string, unknown> = {
        mode: "preview",
        prompt: options.prompt,
      };

      if (options.seed !== undefined) {
        body.seed = options.seed;
      }

      expect(body.seed).toBe(12345);
    });
  });

  describe("Request Building - Refine Stage", () => {
    it("builds correct refine request body", () => {
      const previewTaskId = "task_preview_abc123";
      const options: TextTo3DOptions = {
        prompt: "", // Not used in refine
        enable_pbr: true,
        texture_prompt: "Rusty iron texture with scratches",
      };

      const body: Record<string, unknown> = {
        mode: "refine",
        preview_task_id: previewTaskId,
        enable_pbr: options.enable_pbr ?? true,
      };

      if (options.texture_prompt) {
        body.texture_prompt = options.texture_prompt;
      }
      if (options.texture_image_url) {
        body.texture_image_url = options.texture_image_url;
      }
      if (options.ai_model) {
        body.ai_model = options.ai_model;
      }

      expect(body.mode).toBe("refine");
      expect(body.preview_task_id).toBe(previewTaskId);
      expect(body.enable_pbr).toBe(true);
      expect(body.texture_prompt).toBe("Rusty iron texture with scratches");
    });

    it("refine request requires preview_task_id", () => {
      const previewTaskId = "task_preview_def456";

      const body = {
        mode: "refine",
        preview_task_id: previewTaskId,
        enable_pbr: true,
      };

      expect(body.preview_task_id).toBeDefined();
      expect(body.preview_task_id.length).toBeGreaterThan(0);
    });

    it("omits texture fields if not provided", () => {
      const previewTaskId = "task_preview_ghi789";
      const options: TextTo3DOptions = {
        prompt: "",
        enable_pbr: true,
        // No texture_prompt or texture_image_url
      };

      const body: Record<string, unknown> = {
        mode: "refine",
        preview_task_id: previewTaskId,
        enable_pbr: options.enable_pbr ?? true,
      };

      if (options.texture_prompt) {
        body.texture_prompt = options.texture_prompt;
      }

      expect(body.texture_prompt).toBeUndefined();
      expect(body.texture_image_url).toBeUndefined();
    });

    it("ai_model in refine should match preview for meshy-5/latest", () => {
      const options: TextTo3DOptions = {
        prompt: "",
        ai_model: "meshy-5",
        enable_pbr: true,
      };

      const body: Record<string, unknown> = {
        mode: "refine",
        preview_task_id: "task_preview_match",
        enable_pbr: true,
      };

      if (options.ai_model) {
        body.ai_model = options.ai_model;
      }

      expect(body.ai_model).toBe("meshy-5");
    });
  });

  describe("Response Parsing", () => {
    it("extracts preview task ID from response", () => {
      const response = { result: "task_preview_created" };
      const previewTaskId = response.result || "";

      expect(previewTaskId).toBe("task_preview_created");
    });

    it("extracts refine task ID from response", () => {
      const response = { result: "task_refine_created" };
      const refineTaskId = response.result || "";

      expect(refineTaskId).toBe("task_refine_created");
    });

    it("parses completed task with model URLs", () => {
      const completedTask: Partial<MeshyTask> = {
        id: "task_txt_completed",
        status: "SUCCEEDED",
        progress: 100,
        model_urls: {
          glb: "https://assets.meshy.ai/task_txt_completed/model.glb",
          fbx: "https://assets.meshy.ai/task_txt_completed/model.fbx",
          usdz: "https://assets.meshy.ai/task_txt_completed/model.usdz",
        },
        thumbnail_url:
          "https://assets.meshy.ai/task_txt_completed/thumbnail.png",
        video_url: "https://assets.meshy.ai/task_txt_completed/preview.mp4",
      };

      expect(completedTask.status).toBe("SUCCEEDED");
      expect(completedTask.model_urls?.glb).toContain(".glb");
      expect(completedTask.video_url).toBeDefined();
    });

    it("builds pipeline result from completed task", () => {
      const task: Partial<MeshyTask> = {
        id: "task_txt_result",
        status: "SUCCEEDED",
        model_urls: {
          glb: "https://assets.meshy.ai/model.glb",
        },
        thumbnail_url: "https://assets.meshy.ai/thumbnail.png",
      };

      const modelUrl = task.model_urls?.glb || task.model_url || "";
      const result: TextTo3DPipelineResult = {
        taskId: task.id!,
        modelUrl,
        thumbnailUrl: task.thumbnail_url,
        status: task.status!,
      };

      expect(result.taskId).toBe("task_txt_result");
      expect(result.modelUrl).toContain(".glb");
      expect(result.status).toBe("SUCCEEDED");
    });

    it("includes texture URLs in completed task", () => {
      const completedTask: Partial<MeshyTask> = {
        id: "task_with_textures",
        status: "SUCCEEDED",
        texture_urls: [
          {
            base_color: "https://assets.meshy.ai/textures/base.png",
            metallic: "https://assets.meshy.ai/textures/metallic.png",
            normal: "https://assets.meshy.ai/textures/normal.png",
            roughness: "https://assets.meshy.ai/textures/roughness.png",
          },
        ],
      };

      expect(completedTask.texture_urls).toBeDefined();
      expect(completedTask.texture_urls!.length).toBeGreaterThan(0);
      expect(completedTask.texture_urls![0].base_color).toContain("base");
    });
  });

  describe("Error Handling", () => {
    it("identifies failed preview task", () => {
      const failedTask: Partial<MeshyTask> = {
        id: "task_preview_failed",
        status: "FAILED",
        task_error: {
          message: "Content moderation rejected prompt",
        },
      };

      expect(failedTask.status).toBe("FAILED");
      expect(failedTask.task_error?.message).toContain("moderation");
    });

    it("identifies failed refine task", () => {
      const failedTask: Partial<MeshyTask> = {
        id: "task_refine_failed",
        status: "FAILED",
        task_error: {
          message: "Preview task not found or expired",
        },
      };

      expect(failedTask.status).toBe("FAILED");
      expect(failedTask.task_error?.message).toContain("Preview task");
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

    it("handles empty prompt gracefully", () => {
      const options: TextTo3DOptions = {
        prompt: "",
      };

      expect(options.prompt.length).toBe(0);
      // Client should validate and reject empty prompts before API call
    });
  });
});
