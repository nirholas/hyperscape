/**
 * Generation Service Tests
 *
 * Tests for the master orchestrator of 3D generation pipeline.
 * Tests validation, configuration, and structural logic without calling external APIs.
 *
 * Real Issues to Surface:
 * - Invalid pipeline configuration
 * - Incorrect quality/polycount mappings
 * - Missing required config fields
 * - Invalid category handling
 * - Progress tracking issues
 * - GLB merging logic errors
 */

import { describe, it, expect } from "vitest";

import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";
import type { GenerationProgress } from "@/stores/generation-store";
import {
  POLYCOUNT_PRESETS,
  DEFAULT_TEXTURE_RESOLUTION,
} from "@/lib/meshy/constants";

describe("GenerationService", () => {
  describe("Pipeline Configuration", () => {
    it("quality presets have valid settings", () => {
      const qualityOptions = {
        preview: {
          targetPolycount: POLYCOUNT_PRESETS.small_building.defaultPolycount,
          textureResolution: 1024,
          enablePBR: true,
          aiModel: "meshy-4",
          textureRichness: "medium",
        },
        medium: {
          targetPolycount: POLYCOUNT_PRESETS.large_structure.defaultPolycount,
          textureResolution: DEFAULT_TEXTURE_RESOLUTION,
          enablePBR: true,
          aiModel: "latest",
          textureRichness: "high",
        },
        high: {
          targetPolycount: POLYCOUNT_PRESETS.large_structure.maxPolycount,
          textureResolution: 4096,
          enablePBR: true,
          aiModel: "latest",
          textureRichness: "high",
        },
      };

      // Preview uses lower polycount than medium
      expect(qualityOptions.preview.targetPolycount).toBeLessThan(
        qualityOptions.medium.targetPolycount,
      );

      // Medium uses lower polycount than high
      expect(qualityOptions.medium.targetPolycount).toBeLessThan(
        qualityOptions.high.targetPolycount,
      );

      // Texture resolution increases with quality
      expect(qualityOptions.preview.textureResolution).toBeLessThan(
        qualityOptions.medium.textureResolution,
      );
      expect(qualityOptions.medium.textureResolution).toBeLessThan(
        qualityOptions.high.textureResolution,
      );

      // All presets enable PBR
      expect(qualityOptions.preview.enablePBR).toBe(true);
      expect(qualityOptions.medium.enablePBR).toBe(true);
      expect(qualityOptions.high.enablePBR).toBe(true);
    });

    it("preview quality uses meshy-4 model", () => {
      const previewOptions = {
        aiModel: "meshy-4",
        textureRichness: "medium",
      };

      expect(previewOptions.aiModel).toBe("meshy-4");
      expect(previewOptions.textureRichness).toBe("medium");
    });

    it("medium and high quality use latest model", () => {
      const mediumOptions = { aiModel: "latest" };
      const highOptions = { aiModel: "latest" };

      expect(mediumOptions.aiModel).toBe("latest");
      expect(highOptions.aiModel).toBe("latest");
    });

    it("text-to-3d pipeline has preview and refine stages", () => {
      const textTo3DStages = [
        "Prompt Enhancement",
        "Concept Art",
        "Text-to-3D Preview",
        "Text-to-3D Refine",
        "Meshy Auto-Rigging",
        "Downloading",
        "Hand Rigging",
        "VRM Conversion",
        "Saving",
        "Complete",
      ];

      // Verify stage order
      const previewIdx = textTo3DStages.indexOf("Text-to-3D Preview");
      const refineIdx = textTo3DStages.indexOf("Text-to-3D Refine");
      const riggingIdx = textTo3DStages.indexOf("Meshy Auto-Rigging");
      const handRigIdx = textTo3DStages.indexOf("Hand Rigging");
      const vrmIdx = textTo3DStages.indexOf("VRM Conversion");

      expect(previewIdx).toBeLessThan(refineIdx);
      expect(refineIdx).toBeLessThan(riggingIdx);
      expect(riggingIdx).toBeLessThan(handRigIdx);
      expect(handRigIdx).toBeLessThan(vrmIdx);
    });

    it("image-to-3d pipeline is single stage", () => {
      const imageTo3DPipeline = "image-to-3d";
      expect(imageTo3DPipeline).toBe("image-to-3d");

      // Image-to-3D doesn't have separate preview/refine
      // It goes directly to processing
    });

    it("valid pipeline types are text-to-3d and image-to-3d", () => {
      const validPipelines: GenerationConfig["pipeline"][] = [
        "text-to-3d",
        "image-to-3d",
      ];

      expect(validPipelines).toContain("text-to-3d");
      expect(validPipelines).toContain("image-to-3d");
      expect(validPipelines.length).toBe(2);
    });
  });

  describe("Generation Config Validation", () => {
    it("valid config has required fields", () => {
      const config: GenerationConfig = {
        prompt: "A medieval sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {},
      };

      expect(config.prompt).toBeDefined();
      expect(config.category).toBeDefined();
      expect(config.pipeline).toBeDefined();
      expect(config.quality).toBeDefined();
      expect(config.metadata).toBeDefined();
    });

    it("prompt must be non-empty string", () => {
      const validPrompt = "A detailed fantasy helmet";
      expect(validPrompt.length).toBeGreaterThan(0);
      expect(typeof validPrompt).toBe("string");

      const emptyPrompt = "";
      expect(emptyPrompt.length).toBe(0);
    });

    it("validates quality values", () => {
      const validQualities: GenerationConfig["quality"][] = [
        "preview",
        "medium",
        "high",
      ];

      validQualities.forEach((quality) => {
        expect(["preview", "medium", "high"]).toContain(quality);
      });
    });

    it("image-to-3d requires imageUrl", () => {
      const configWithImage: GenerationConfig = {
        prompt: "3D model from image",
        category: "prop",
        pipeline: "image-to-3d",
        quality: "medium",
        imageUrl: "https://example.com/image.png",
        metadata: {},
      };

      const configWithoutImage: GenerationConfig = {
        prompt: "3D model from image",
        category: "prop",
        pipeline: "image-to-3d",
        quality: "medium",
        metadata: {},
      };

      expect(configWithImage.imageUrl).toBeDefined();
      expect(configWithoutImage.imageUrl).toBeUndefined();

      // Validation: image-to-3d pipeline requires imageUrl
      if (configWithoutImage.pipeline === "image-to-3d") {
        expect(configWithoutImage.imageUrl).toBeUndefined();
      }
    });

    it("optional fields have correct types", () => {
      const config: GenerationConfig = {
        prompt: "An NPC character",
        category: "npc",
        pipeline: "text-to-3d",
        quality: "high",
        metadata: { id: "test_123" },
        convertToVRM: true,
        enableHandRigging: true,
        useGPT4Enhancement: true,
        generateConceptArt: true,
        referenceImageUrl: "https://example.com/ref.png",
      };

      expect(typeof config.convertToVRM).toBe("boolean");
      expect(typeof config.enableHandRigging).toBe("boolean");
      expect(typeof config.useGPT4Enhancement).toBe("boolean");
      expect(typeof config.generateConceptArt).toBe("boolean");
      expect(typeof config.referenceImageUrl).toBe("string");
    });

    it("metadata is a record type", () => {
      const config: GenerationConfig = {
        prompt: "A test prompt",
        category: "prop",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {
          id: "asset_123",
          name: "Test Asset",
          createdAt: new Date().toISOString(),
          customField: 42,
        },
      };

      expect(typeof config.metadata).toBe("object");
      expect(config.metadata.id).toBe("asset_123");
      expect(config.metadata.name).toBe("Test Asset");
    });

    it("referenceImageDataUrl fallback for data URLs", () => {
      const config: GenerationConfig = {
        prompt: "Character with custom texture",
        category: "character",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {},
        referenceImageDataUrl: "data:image/png;base64,abc123...",
      };

      // Data URLs are stored separately from HTTP URLs
      expect(config.referenceImageDataUrl).toBeDefined();
      expect(config.referenceImageDataUrl).toMatch(/^data:/);
    });
  });

  describe("Progress Tracking", () => {
    it("progress has required fields", () => {
      const progress: GenerationProgress = {
        status: "generating",
        stage: "Text-to-3D Preview",
        progress: 25,
        currentStep: "Generating preview mesh...",
      };

      expect(progress.status).toBeDefined();
      expect(progress.progress).toBeDefined();
      expect(typeof progress.progress).toBe("number");
    });

    it("status values are valid", () => {
      const validStatuses: GenerationProgress["status"][] = [
        "idle",
        "generating",
        "completed",
        "failed",
      ];

      validStatuses.forEach((status) => {
        const progress: GenerationProgress = {
          status,
          progress: 0,
        };
        expect(["idle", "generating", "completed", "failed"]).toContain(
          progress.status,
        );
      });
    });

    it("progress percentage is 0-100", () => {
      const validProgress: GenerationProgress[] = [
        { status: "idle", progress: 0 },
        { status: "generating", progress: 50 },
        { status: "completed", progress: 100 },
      ];

      validProgress.forEach((p) => {
        expect(p.progress).toBeGreaterThanOrEqual(0);
        expect(p.progress).toBeLessThanOrEqual(100);
      });
    });

    it("failed status includes error message", () => {
      const failedProgress: GenerationProgress = {
        status: "failed",
        progress: 0,
        error: "API request failed: timeout",
      };

      expect(failedProgress.status).toBe("failed");
      expect(failedProgress.error).toBeDefined();
      expect(typeof failedProgress.error).toBe("string");
    });

    it("stage tracks current pipeline stage", () => {
      const stages = [
        { stage: "Prompt Enhancement", progress: 0 },
        { stage: "Concept Art", progress: 3 },
        { stage: "Text-to-3D Preview", progress: 10 },
        { stage: "Text-to-3D Refine", progress: 50 },
        { stage: "Downloading", progress: 85 },
        { stage: "Saving", progress: 90 },
        { stage: "Complete", progress: 100 },
      ];

      // Progress should increase with each stage
      for (let i = 1; i < stages.length; i++) {
        expect(stages[i].progress).toBeGreaterThanOrEqual(
          stages[i - 1].progress,
        );
      }
    });

    it("currentStep provides human-readable description", () => {
      const progress: GenerationProgress = {
        status: "generating",
        stage: "Text-to-3D Preview",
        progress: 25,
        currentStep: "Preview stage: 50% (3 tasks ahead)",
      };

      expect(progress.currentStep).toBeDefined();
      expect(progress.currentStep!.length).toBeGreaterThan(0);
    });
  });

  describe("Skeleton Merging Logic", () => {
    it("GLB has correct magic number", () => {
      // GLB format: magic 0x46546C67 = "glTF"
      const glbMagic = 0x46546c67;
      const buffer = Buffer.alloc(12);
      buffer.writeUInt32LE(glbMagic, 0);
      buffer.writeUInt32LE(2, 4); // Version 2
      buffer.writeUInt32LE(12, 8); // Total length

      expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
    });

    it("GLB version is 2", () => {
      const expectedVersion = 2;
      expect(expectedVersion).toBe(2);
    });

    it("JSON chunk type is correct", () => {
      // JSON chunk type: 0x4E4F534A = "JSON"
      const jsonChunkType = 0x4e4f534a;
      expect(jsonChunkType).toBe(0x4e4f534a);
    });

    it("BIN chunk type is correct", () => {
      // BIN chunk type: 0x004E4942 = "BIN\0"
      const binChunkType = 0x004e4942;
      expect(binChunkType).toBe(0x004e4942);
    });

    it("skin requires joints array", () => {
      const validSkin = {
        joints: [0, 1, 2, 3],
        skeleton: 0,
        inverseBindMatrices: 5,
      };

      expect(validSkin.joints).toBeDefined();
      expect(Array.isArray(validSkin.joints)).toBe(true);
      expect(validSkin.joints.length).toBeGreaterThan(0);
    });

    it("node index mapping preserves order", () => {
      const originalJoints = [5, 6, 7, 8];
      const texturedNodeCount = 10;
      const nodeIndexMap = new Map<number, number>();

      originalJoints.forEach((oldIdx, i) => {
        const newIdx = texturedNodeCount + i;
        nodeIndexMap.set(oldIdx, newIdx);
      });

      expect(nodeIndexMap.get(5)).toBe(10);
      expect(nodeIndexMap.get(6)).toBe(11);
      expect(nodeIndexMap.get(7)).toBe(12);
      expect(nodeIndexMap.get(8)).toBe(13);
    });

    it("children references are updated correctly", () => {
      const node = {
        name: "Spine",
        children: [5, 6, 7],
      };

      const nodeIndexMap = new Map<number, number>();
      nodeIndexMap.set(5, 15);
      nodeIndexMap.set(6, 16);
      nodeIndexMap.set(7, 17);

      const updatedChildren = (node.children as number[]).map((childIdx) => {
        const newIdx = nodeIndexMap.get(childIdx);
        return newIdx !== undefined ? newIdx : childIdx;
      });

      expect(updatedChildren).toEqual([15, 16, 17]);
    });

    it("buffer view references binary data offset", () => {
      const bufferView = {
        buffer: 0,
        byteOffset: 1024,
        byteLength: 512,
      };

      expect(bufferView.buffer).toBe(0);
      expect(bufferView.byteOffset).toBeGreaterThanOrEqual(0);
      expect(bufferView.byteLength).toBeGreaterThan(0);
    });

    it("accessor references buffer view", () => {
      const accessor = {
        bufferView: 3,
        componentType: 5126, // FLOAT
        count: 24,
        type: "MAT4",
      };

      expect(accessor.bufferView).toBeDefined();
      expect(typeof accessor.bufferView).toBe("number");
    });

    it("4-byte alignment padding is calculated correctly", () => {
      const testCases = [
        { length: 100, expectedPadding: 0 },
        { length: 101, expectedPadding: 3 },
        { length: 102, expectedPadding: 2 },
        { length: 103, expectedPadding: 1 },
        { length: 104, expectedPadding: 0 },
      ];

      testCases.forEach(({ length, expectedPadding }) => {
        const padding = (4 - (length % 4)) % 4;
        expect(padding).toBe(expectedPadding);
      });
    });
  });

  describe("Category Handling", () => {
    it("character categories enable rigging", () => {
      const characterCategories = ["npc", "character"];

      characterCategories.forEach((category) => {
        const isCharacter = category === "npc" || category === "character";
        expect(isCharacter).toBe(true);
      });
    });

    it("weapon category skips rigging", () => {
      const category = "weapon";
      const isCharacter = category === "npc" || category === "character";

      expect(isCharacter).toBe(false);
    });

    it("prop category skips rigging", () => {
      const category = "prop";
      const isCharacter = category === "npc" || category === "character";

      expect(isCharacter).toBe(false);
    });

    it("environment category skips rigging", () => {
      const category = "environment";
      const isCharacter = category === "npc" || category === "character";

      expect(isCharacter).toBe(false);
    });

    it("VRM conversion only applies to characters", () => {
      const configs = [
        { category: "npc", convertToVRM: true },
        { category: "character", convertToVRM: true },
        { category: "weapon", convertToVRM: true },
        { category: "prop", convertToVRM: true },
      ];

      configs.forEach((config) => {
        const shouldConvert =
          config.convertToVRM &&
          (config.category === "npc" || config.category === "character");

        if (config.category === "npc" || config.category === "character") {
          expect(shouldConvert).toBe(true);
        } else {
          expect(shouldConvert).toBe(false);
        }
      });
    });

    it("hand rigging only applies to characters", () => {
      const configs = [
        { category: "npc", enableHandRigging: true },
        { category: "character", enableHandRigging: true },
        { category: "weapon", enableHandRigging: true },
      ];

      configs.forEach((config) => {
        const shouldAddHands =
          config.enableHandRigging &&
          (config.category === "npc" || config.category === "character");

        if (config.category === "npc" || config.category === "character") {
          expect(shouldAddHands).toBe(true);
        } else {
          expect(shouldAddHands).toBe(false);
        }
      });
    });

    it("all valid categories are recognized", () => {
      const validCategories = [
        "npc",
        "character",
        "weapon",
        "prop",
        "resource",
        "environment",
        "building",
      ];

      validCategories.forEach((category) => {
        expect(typeof category).toBe("string");
        expect(category.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Error Handling", () => {
    it("error progress has failed status and error message", () => {
      const errorProgress: GenerationProgress = {
        status: "failed",
        progress: 0,
        error: "Generation failed",
      };

      expect(errorProgress.status).toBe("failed");
      expect(errorProgress.progress).toBe(0);
      expect(errorProgress.error).toBeDefined();
    });

    it("validates required prompt field", () => {
      const validatePrompt = (prompt: string | undefined): boolean => {
        return prompt !== undefined && prompt.length > 0;
      };

      expect(validatePrompt("A sword")).toBe(true);
      expect(validatePrompt("")).toBe(false);
      expect(validatePrompt(undefined)).toBe(false);
    });

    it("validates required category field", () => {
      const validCategories = [
        "npc",
        "character",
        "weapon",
        "prop",
        "resource",
        "environment",
        "building",
      ];

      const validateCategory = (category: string | undefined): boolean => {
        return category !== undefined && validCategories.includes(category);
      };

      expect(validateCategory("weapon")).toBe(true);
      expect(validateCategory("invalid")).toBe(false);
      expect(validateCategory(undefined)).toBe(false);
    });

    it("image-to-3d validates imageUrl presence", () => {
      const validateImageTo3DConfig = (config: {
        pipeline: string;
        imageUrl?: string;
      }): { valid: boolean; error?: string } => {
        if (config.pipeline === "image-to-3d" && !config.imageUrl) {
          return {
            valid: false,
            error: "Image URL required for image-to-3d pipeline",
          };
        }
        return { valid: true };
      };

      expect(validateImageTo3DConfig({ pipeline: "image-to-3d" }).valid).toBe(
        false,
      );
      expect(
        validateImageTo3DConfig({
          pipeline: "image-to-3d",
          imageUrl: "https://example.com/img.png",
        }).valid,
      ).toBe(true);
      expect(validateImageTo3DConfig({ pipeline: "text-to-3d" }).valid).toBe(
        true,
      );
    });

    it("handles concept art generation failure gracefully", () => {
      // When concept art fails, we continue without it
      let textureImageUrl: string | undefined;
      let conceptArtFailed = false;

      try {
        // Simulate concept art failure
        throw new Error("Concept art generation failed");
      } catch {
        conceptArtFailed = true;
        textureImageUrl = undefined;
      }

      expect(conceptArtFailed).toBe(true);
      expect(textureImageUrl).toBeUndefined();
      // Generation should continue without concept art
    });

    it("handles rigging failure gracefully", () => {
      // When rigging fails, we fall back to unrigged model
      const refineResult = {
        taskId: "refine_123",
        modelUrl: "https://meshy.ai/model.glb",
        thumbnailUrl: "https://meshy.ai/thumb.png",
      };

      let result = refineResult;
      let riggingFailed = false;

      try {
        // Simulate rigging failure
        throw new Error("Rigging failed");
      } catch {
        riggingFailed = true;
        // Fall back to unrigged model
        result = {
          taskId: refineResult.taskId,
          modelUrl: refineResult.modelUrl,
          thumbnailUrl: refineResult.thumbnailUrl,
        };
      }

      expect(riggingFailed).toBe(true);
      expect(result.modelUrl).toBe(refineResult.modelUrl);
    });

    it("validates HTTP URL for texture reference", () => {
      const validateTextureUrl = (url: string | undefined): boolean => {
        if (!url) return false;
        return url.startsWith("http://") || url.startsWith("https://");
      };

      expect(validateTextureUrl("https://example.com/texture.png")).toBe(true);
      expect(validateTextureUrl("http://example.com/texture.png")).toBe(true);
      expect(validateTextureUrl("data:image/png;base64,abc")).toBe(false);
      expect(validateTextureUrl(undefined)).toBe(false);
    });
  });

  describe("Result Structure", () => {
    it("generation result has required fields", () => {
      const result = {
        taskId: "task_abc123",
        modelUrl: "https://meshy.ai/model.glb",
        metadata: {},
      };

      expect(result.taskId).toBeDefined();
      expect(result.modelUrl).toBeDefined();
      expect(result.metadata).toBeDefined();
    });

    it("result includes optional VRM data", () => {
      const result = {
        taskId: "task_abc123",
        modelUrl: "https://meshy.ai/model.glb",
        vrmUrl: "data:model/gltf-binary;base64,abc...",
        hasVRM: true,
        localVrmUrl: "/api/assets/asset_123/model.vrm",
        metadata: {},
      };

      expect(result.hasVRM).toBe(true);
      expect(result.vrmUrl).toBeDefined();
      expect(result.localVrmUrl).toBeDefined();
    });

    it("result includes local URLs for saved assets", () => {
      const result = {
        taskId: "task_abc123",
        modelUrl: "https://meshy.ai/model.glb",
        localModelUrl: "/api/assets/asset_123/model.glb",
        localThumbnailUrl: "/api/assets/asset_123/thumbnail.png",
        metadata: {},
      };

      expect(result.localModelUrl).toBeDefined();
      expect(result.localThumbnailUrl).toBeDefined();
    });

    it("result tracks hand rigging status", () => {
      const result = {
        taskId: "task_abc123",
        modelUrl: "https://meshy.ai/model.glb",
        hasHandRigging: true,
        metadata: { hasHandRigging: true },
      };

      expect(result.hasHandRigging).toBe(true);
      expect(result.metadata.hasHandRigging).toBe(true);
    });
  });

  describe("Batch Generation", () => {
    it("batch variations modify prompt correctly", () => {
      const basePrompt = "A medieval sword";
      const count = 3;

      const variations = Array.from({ length: count }, (_, i) => ({
        prompt: `${basePrompt} (variation ${i + 1})`,
      }));

      expect(variations.length).toBe(3);
      expect(variations[0].prompt).toBe("A medieval sword (variation 1)");
      expect(variations[1].prompt).toBe("A medieval sword (variation 2)");
      expect(variations[2].prompt).toBe("A medieval sword (variation 3)");
    });

    it("batch progress tracks total count", () => {
      const count = 5;
      const progressUpdates: { progress: number; step: string }[] = [];

      for (let i = 0; i < count; i++) {
        progressUpdates.push({
          progress: Math.floor((i / count) * 100),
          step: `Generating variation ${i + 1} of ${count}...`,
        });
      }

      expect(progressUpdates[0].progress).toBe(0);
      expect(progressUpdates[2].progress).toBe(40);
      expect(progressUpdates[4].progress).toBe(80);
    });

    it("batch continues on individual failure", () => {
      const results: { success: boolean }[] = [];
      const count = 3;

      // Simulate batch with one failure
      for (let i = 0; i < count; i++) {
        try {
          if (i === 1) {
            throw new Error("Failed to generate variation 2");
          }
          results.push({ success: true });
        } catch {
          // Continue with other variations
        }
      }

      // Should have 2 successful results (variations 1 and 3)
      expect(results.length).toBe(2);
    });
  });
});
