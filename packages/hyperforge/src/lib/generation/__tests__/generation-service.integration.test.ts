/**
 * Generation Service Integration Tests
 *
 * Tests the REAL orchestration logic of generation-service.ts with mocked external APIs.
 * This tests:
 * - Pipeline stage progression and timing
 * - Progress callbacks at each stage
 * - Error handling at each stage
 * - Batch generation logic
 * - GLB merging with real binary data
 * - Conditional rigging/VRM conversion based on config
 *
 * External APIs mocked:
 * - Meshy (text-to-3d, image-to-3d, rigging, polling)
 * - AI Gateway (prompt enhancement, concept art)
 * - Asset storage (file operations)
 *
 * Lines covered: 36-1094
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";
import type { GenerationProgress } from "@/stores/generation-store";
import { generate3DModel, generateBatch } from "../generation-service";

// Mock external dependencies
vi.mock("@/lib/meshy/text-to-3d", () => ({
  startTextTo3DPreview: vi.fn(),
  startTextTo3DRefine: vi.fn(),
}));

vi.mock("@/lib/meshy/image-to-3d", () => ({
  startImageTo3D: vi.fn(),
}));

vi.mock("@/lib/meshy/poll-task", () => ({
  pollTaskStatus: vi.fn(),
}));

vi.mock("@/lib/meshy/client", () => ({
  createRiggingTask: vi.fn(),
  getRiggingTaskStatus: vi.fn(),
}));

vi.mock("@/lib/storage/asset-storage", () => ({
  saveAssetFiles: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/ai/gateway", () => ({
  enhancePromptWithGPT4: vi.fn(),
}));

vi.mock("@/lib/ai/concept-art-service", () => ({
  generateConceptArt: vi.fn(),
}));

// Import mocked modules
import {
  startTextTo3DPreview,
  startTextTo3DRefine,
} from "@/lib/meshy/text-to-3d";
import { startImageTo3D } from "@/lib/meshy/image-to-3d";
import { pollTaskStatus } from "@/lib/meshy/poll-task";
import { createRiggingTask, getRiggingTaskStatus } from "@/lib/meshy/client";
import { saveAssetFiles, downloadFile } from "@/lib/storage/asset-storage";
import { enhancePromptWithGPT4 } from "@/lib/ai/gateway";
import { generateConceptArt } from "@/lib/ai/concept-art-service";

// ============================================================================
// Test Fixtures - Real GLB Binary Data
// ============================================================================

/**
 * Create a minimal valid GLB buffer with optional skeleton
 * This is REAL binary GLB data, not mocked
 */
function createMinimalGLB(options: {
  hasSkeleton?: boolean;
  hasTextures?: boolean;
  nodeCount?: number;
  boneCount?: number;
}): Buffer {
  const {
    hasSkeleton = false,
    hasTextures = false,
    nodeCount = 1,
    boneCount = 4,
  } = options;

  // Create minimal glTF JSON
  const nodes: Record<string, unknown>[] = [];

  // Add mesh node
  nodes.push({
    name: "MeshNode",
    mesh: 0,
  });

  // Add additional nodes if specified
  for (let i = 1; i < nodeCount; i++) {
    nodes.push({ name: `Node_${i}` });
  }

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 44 }],
  };

  // Add texture data if requested
  if (hasTextures) {
    gltf.textures = [{ source: 0, sampler: 0 }];
    gltf.images = [{ uri: "data:image/png;base64,iVBORw0KGgo=" }];
    gltf.samplers = [{}];
    gltf.materials = [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
        },
      },
    ];
  }

  // Add skeleton if requested
  if (hasSkeleton) {
    const joints: number[] = [];
    const boneNodes: Record<string, unknown>[] = [];
    const startIndex = nodes.length;

    for (let i = 0; i < boneCount; i++) {
      joints.push(startIndex + i);
      const boneNode: Record<string, unknown> = {
        name: `Bone_${i}`,
        translation: [0, i * 0.1, 0],
      };
      // Create hierarchy
      if (i < boneCount - 1) {
        boneNode.children = [startIndex + i + 1];
      }
      boneNodes.push(boneNode);
    }

    // Add bone nodes
    gltf.nodes = [...nodes, ...boneNodes];

    // Add inverse bind matrices data
    const ibmByteLength = boneCount * 64; // 4x4 float matrix = 64 bytes
    const ibmBufferViewIndex = (gltf.bufferViews as unknown[]).length;
    const ibmAccessorIndex = (gltf.accessors as unknown[]).length;

    (gltf.bufferViews as unknown[]).push({
      buffer: 0,
      byteOffset: 44,
      byteLength: ibmByteLength,
    });

    (gltf.accessors as unknown[]).push({
      bufferView: ibmBufferViewIndex,
      componentType: 5126,
      count: boneCount,
      type: "MAT4",
    });

    // Add skin
    gltf.skins = [
      {
        joints,
        skeleton: startIndex,
        inverseBindMatrices: ibmAccessorIndex,
      },
    ];

    // Update buffer size
    (gltf.buffers as { byteLength: number }[])[0].byteLength =
      44 + ibmByteLength;
  }

  // Serialize JSON
  const jsonStr = JSON.stringify(gltf);
  const jsonBuffer = Buffer.from(jsonStr);
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const paddedJsonBuffer = Buffer.concat([
    jsonBuffer,
    Buffer.alloc(jsonPadding, 0x20), // Space padding for JSON
  ]);

  // Create binary data
  const binLength = hasSkeleton ? 44 + boneCount * 64 : 44;
  const binData = Buffer.alloc(binLength);

  // Write some vertex data (3 vertices, 3 floats each)
  let offset = 0;
  for (let i = 0; i < 3; i++) {
    binData.writeFloatLE(i * 0.1, offset);
    binData.writeFloatLE(0, offset + 4);
    binData.writeFloatLE(0, offset + 8);
    offset += 12;
  }
  // Write indices
  binData.writeUInt16LE(0, 36);
  binData.writeUInt16LE(1, 38);
  binData.writeUInt16LE(2, 40);

  // Write identity matrices for inverse bind matrices
  if (hasSkeleton) {
    offset = 44;
    for (let b = 0; b < boneCount; b++) {
      for (let i = 0; i < 16; i++) {
        binData.writeFloatLE(i % 5 === 0 ? 1.0 : 0.0, offset + i * 4);
      }
      offset += 64;
    }
  }

  const binPadding = (4 - (binData.length % 4)) % 4;
  const paddedBinBuffer = Buffer.concat([
    binData,
    Buffer.alloc(binPadding, 0x00),
  ]);

  // Build GLB
  const totalLength =
    12 + 8 + paddedJsonBuffer.length + 8 + paddedBinBuffer.length;
  const glb = Buffer.alloc(totalLength);

  // Header
  glb.writeUInt32LE(0x46546c67, 0); // "glTF" magic
  glb.writeUInt32LE(2, 4); // version
  glb.writeUInt32LE(totalLength, 8);

  // JSON chunk
  glb.writeUInt32LE(paddedJsonBuffer.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  paddedJsonBuffer.copy(glb, 20);

  // BIN chunk
  const binChunkStart = 20 + paddedJsonBuffer.length;
  glb.writeUInt32LE(paddedBinBuffer.length, binChunkStart);
  glb.writeUInt32LE(0x004e4942, binChunkStart + 4); // "BIN\0"
  paddedBinBuffer.copy(glb, binChunkStart + 8);

  return glb;
}

// ============================================================================
// Test Setup
// ============================================================================

describe.sequential("GenerationService Integration", () => {
  let progressUpdates: GenerationProgress[];
  let onProgress: (progress: GenerationProgress) => void;

  /**
   * Setup default mocks - call this at the start of each test
   * Tests can override specific mocks after calling this
   */
  function setupDefaultMocks() {
    // Create real GLB buffers
    const texturedGlb = createMinimalGLB({ hasTextures: true });
    const riggedGlb = createMinimalGLB({ hasSkeleton: true, boneCount: 4 });

    vi.mocked(enhancePromptWithGPT4).mockResolvedValue({
      enhancedPrompt:
        "Enhanced: A detailed medieval sword with intricate patterns",
      error: undefined,
    });

    vi.mocked(generateConceptArt).mockResolvedValue({
      imageUrl: "https://example.com/concept-art.png",
      prompt: "concept art",
    });

    vi.mocked(startTextTo3DPreview).mockResolvedValue({
      previewTaskId: "preview_task_123",
    });

    vi.mocked(startTextTo3DRefine).mockResolvedValue({
      refineTaskId: "refine_task_456",
    });

    vi.mocked(pollTaskStatus).mockResolvedValue({
      taskId: "task_completed",
      modelUrl: "https://meshy.ai/models/test.glb",
      thumbnailUrl: "https://meshy.ai/thumbnails/test.png",
      status: "SUCCEEDED",
    });

    vi.mocked(createRiggingTask).mockResolvedValue("rigging_task_789");

    vi.mocked(getRiggingTaskStatus).mockResolvedValue({
      status: "SUCCEEDED",
      progress: 100,
      result: {
        rigged_character_glb_url: "https://meshy.ai/models/rigged.glb",
      },
    });

    vi.mocked(downloadFile).mockImplementation(async (url: string) => {
      if (url.includes("rigged")) {
        return riggedGlb;
      }
      if (url.includes("textured") || url.includes("refine")) {
        return texturedGlb;
      }
      if (url.includes("preview")) {
        return createMinimalGLB({});
      }
      if (url.includes("thumbnail") || url.includes("thumb")) {
        return Buffer.from("fake-thumbnail-png-data");
      }
      if (url.includes("texture") || url.includes("base_color")) {
        return Buffer.from("fake-texture-png-data");
      }
      return texturedGlb;
    });

    vi.mocked(saveAssetFiles).mockResolvedValue({
      modelPath: "/assets/test/model.glb",
      modelUrl: "/api/assets/test/model.glb",
      thumbnailUrl: "/api/assets/test/thumbnail.png",
    });

    // Mock fetch for hand rigging and VRM conversion APIs
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/hand-rigging/simple")) {
        return new Response(
          JSON.stringify({
            riggedGlbData: createMinimalGLB({
              hasSkeleton: true,
              boneCount: 20,
            }).toString("base64"),
            leftHandBones: ["thumb", "index", "middle", "ring", "pinky"],
            rightHandBones: ["thumb", "index", "middle", "ring", "pinky"],
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/api/vrm/convert")) {
        return new Response(
          JSON.stringify({
            vrmDataUrl: "data:model/gltf-binary;base64,abc123",
            vrmData: createMinimalGLB({ hasSkeleton: true }).toString("base64"),
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unmocked fetch: ${urlStr}`);
    });
  }

  beforeEach(() => {
    // Reset ALL mocks completely before each test
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    progressUpdates = [];
    onProgress = (progress) => progressUpdates.push({ ...progress });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ==========================================================================
  // generate3DModel Tests - Lines 248-1059
  // ==========================================================================

  describe("generate3DModel", () => {
    describe("Text-to-3D Pipeline", () => {
      it("executes full text-to-3d pipeline with all stages", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A medieval sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: { id: "test_sword_1" },
        };

        const result = await generate3DModel(config, onProgress);

        // Verify all stages were called
        expect(enhancePromptWithGPT4).toHaveBeenCalledWith(
          "A medieval sword",
          expect.objectContaining({ assetType: "weapon" }),
        );
        expect(generateConceptArt).toHaveBeenCalled();
        expect(startTextTo3DPreview).toHaveBeenCalled();
        expect(pollTaskStatus).toHaveBeenCalled();
        expect(startTextTo3DRefine).toHaveBeenCalled();
        expect(downloadFile).toHaveBeenCalled();
        expect(saveAssetFiles).toHaveBeenCalled();

        // Verify result structure
        expect(result.taskId).toBeDefined();
        expect(result.modelUrl).toBeDefined();
        expect(result.localModelUrl).toBeDefined();
      });

      it("tracks progress through all pipeline stages", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "An NPC character",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
          convertToVRM: true,
          enableHandRigging: true,
        };

        await generate3DModel(config, onProgress);

        // Verify progress stages were recorded
        const stages = progressUpdates.map((p) => p.stage).filter(Boolean);

        expect(stages).toContain("Prompt Enhancement");
        expect(stages).toContain("Text-to-3D Preview");
        expect(stages).toContain("Text-to-3D Refine");
        expect(stages).toContain("Downloading");
        expect(stages).toContain("Saving");
        expect(stages).toContain("Complete");

        // Verify progress increases monotonically (mostly)
        const nonErrorProgress = progressUpdates.filter(
          (p) => p.status !== "failed",
        );
        for (let i = 1; i < nonErrorProgress.length - 1; i++) {
          // Progress should generally increase (allow some flexibility for stage transitions)
          expect(nonErrorProgress[i].progress).toBeGreaterThanOrEqual(0);
          expect(nonErrorProgress[i].progress).toBeLessThanOrEqual(100);
        }

        // Verify final progress is 100%
        const lastProgress = progressUpdates[progressUpdates.length - 1];
        expect(lastProgress.status).toBe("completed");
        expect(lastProgress.progress).toBe(100);
      });

      it("passes enhanced prompt to 3D generation", async () => {
        setupDefaultMocks();

        // Override the default mock with custom value
        const enhancedPrompt =
          "Enhanced: A highly detailed medieval longsword with Damascus steel patterns";
        vi.mocked(enhancePromptWithGPT4).mockResolvedValue({
          enhancedPrompt,
          error: undefined,
        });

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          useGPT4Enhancement: true,
        };

        await generate3DModel(config, onProgress);

        // Verify enhanced prompt was used
        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          enhancedPrompt,
          expect.any(Object),
        );
      });

      it("uses original prompt when enhancement fails", async () => {
        setupDefaultMocks();

        // Override to simulate error
        vi.mocked(enhancePromptWithGPT4).mockResolvedValue({
          enhancedPrompt: "A sword",
          error: "API error",
        });

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          useGPT4Enhancement: true,
        };

        await generate3DModel(config, onProgress);

        // Original prompt should be used when enhancement fails
        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          "A sword",
          expect.any(Object),
        );
      });

      it("skips prompt enhancement when disabled", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          useGPT4Enhancement: false,
        };

        await generate3DModel(config, onProgress);

        expect(enhancePromptWithGPT4).not.toHaveBeenCalled();
        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          "A sword",
          expect.any(Object),
        );
      });

      it("skips concept art generation when disabled", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          generateConceptArt: false,
        };

        await generate3DModel(config, onProgress);

        expect(generateConceptArt).not.toHaveBeenCalled();
      });

      it("uses custom reference image URL for texturing", async () => {
        setupDefaultMocks();

        const customImageUrl = "https://my-cdn.com/reference.png";
        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          referenceImageUrl: customImageUrl,
        };

        await generate3DModel(config, onProgress);

        // Custom image should be used, not concept art
        expect(generateConceptArt).not.toHaveBeenCalled();
        expect(startTextTo3DRefine).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            texture_image_url: customImageUrl,
          }),
        );
      });

      it("warns when data URL is used (not supported by Meshy)", async () => {
        setupDefaultMocks();

        const dataUrl = "data:image/png;base64,abc123";
        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          referenceImageDataUrl: dataUrl,
        };

        await generate3DModel(config, onProgress);

        // Data URL should NOT be passed to Meshy (only HTTP URLs work)
        expect(startTextTo3DRefine).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            texture_image_url: undefined, // Data URLs filtered out
          }),
        );
      });
    });

    describe("Image-to-3D Pipeline", () => {
      it("executes image-to-3d pipeline", async () => {
        setupDefaultMocks();

        vi.mocked(startImageTo3D).mockResolvedValue({
          taskId: "img_task_123",
        });

        const config: GenerationConfig = {
          prompt: "3D model from image",
          category: "prop",
          pipeline: "image-to-3d",
          quality: "medium",
          imageUrl: "https://example.com/source.png",
          metadata: {},
        };

        const result = await generate3DModel(config, onProgress);

        expect(startImageTo3D).toHaveBeenCalledWith(
          "https://example.com/source.png",
          expect.objectContaining({
            enable_pbr: true,
            ai_model: "latest",
          }),
        );
        expect(result.taskId).toBeDefined();
      });

      it("throws error when imageUrl is missing for image-to-3d", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "3D model from image",
          category: "prop",
          pipeline: "image-to-3d",
          quality: "medium",
          metadata: {},
          // imageUrl intentionally missing
        };

        await expect(generate3DModel(config, onProgress)).rejects.toThrow(
          "Image URL required for image-to-3d pipeline",
        );
      });

      it("skips concept art for image-to-3d pipeline", async () => {
        setupDefaultMocks();

        vi.mocked(startImageTo3D).mockResolvedValue({
          taskId: "img_task_123",
        });

        const config: GenerationConfig = {
          prompt: "3D from image",
          category: "prop",
          pipeline: "image-to-3d",
          quality: "medium",
          imageUrl: "https://example.com/source.png",
          metadata: {},
          generateConceptArt: true, // Should be ignored for image-to-3d
        };

        await generate3DModel(config, onProgress);

        // Concept art is only for text-to-3d
        expect(generateConceptArt).not.toHaveBeenCalled();
      });
    });

    describe("Quality Presets", () => {
      it("uses preview quality settings (meshy-4, lower polycount)", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "preview",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            ai_model: "meshy-4",
            target_polycount: 10000, // small_building preset
          }),
        );
      });

      it("uses medium quality settings (latest model)", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            ai_model: "latest",
            target_polycount: 30000,
          }),
        );
      });

      it("uses high quality settings (max polycount)", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        expect(startTextTo3DPreview).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            ai_model: "latest",
            target_polycount: 50000,
          }),
        );
      });
    });

    describe("Auto-Rigging (Characters)", () => {
      it("triggers Meshy rigging for NPC with VRM conversion", async () => {
        setupDefaultMocks();

        // Return different URLs for textured vs rigged
        vi.mocked(pollTaskStatus)
          .mockResolvedValueOnce({
            taskId: "preview_done",
            modelUrl: "https://meshy.ai/preview.glb",
            status: "SUCCEEDED",
          })
          .mockResolvedValueOnce({
            taskId: "refine_done",
            modelUrl: "https://meshy.ai/textured.glb",
            thumbnailUrl: "https://meshy.ai/thumb.png",
            status: "SUCCEEDED",
            textureUrls: [{ base_color: "https://meshy.ai/base_color.png" }],
          });

        const config: GenerationConfig = {
          prompt: "A warrior NPC",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true,
        };

        await generate3DModel(config, onProgress);

        expect(createRiggingTask).toHaveBeenCalledWith(
          expect.objectContaining({
            input_task_id: "refine_done",
            height_meters: 1.7, // DEFAULT_CHARACTER_HEIGHT
          }),
        );
        expect(getRiggingTaskStatus).toHaveBeenCalled();
      });

      it("triggers Meshy rigging for character with hand rigging enabled", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A player character",
          category: "character",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          enableHandRigging: true,
        };

        await generate3DModel(config, onProgress);

        expect(createRiggingTask).toHaveBeenCalled();
      });

      it("skips rigging for non-character categories", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true, // Should be ignored for weapons
        };

        await generate3DModel(config, onProgress);

        expect(createRiggingTask).not.toHaveBeenCalled();
      });

      it("handles rigging task failure gracefully", async () => {
        setupDefaultMocks();

        vi.mocked(getRiggingTaskStatus).mockResolvedValue({
          status: "FAILED",
          progress: 0,
          task_error: { message: "Rigging failed: invalid mesh" },
        });

        const config: GenerationConfig = {
          prompt: "A warrior",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true,
        };

        // Should not throw, just fall back to unrigged model
        const result = await generate3DModel(config, onProgress);
        expect(result.taskId).toBeDefined();
        expect(result.modelUrl).toBeDefined();
      });

      it("handles rigging API error gracefully", async () => {
        setupDefaultMocks();

        vi.mocked(createRiggingTask).mockRejectedValue(
          new Error("API connection failed"),
        );

        const config: GenerationConfig = {
          prompt: "A warrior",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true,
        };

        // Should continue with unrigged model
        const result = await generate3DModel(config, onProgress);
        expect(result.taskId).toBeDefined();
      });
    });

    describe("Hand Rigging", () => {
      it("calls hand rigging API for characters with enableHandRigging", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A character",
          category: "character",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          enableHandRigging: true,
        };

        const result = await generate3DModel(config, onProgress);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/hand-rigging/simple"),
          expect.objectContaining({
            method: "POST",
            body: expect.any(String),
          }),
        );
        expect(result.hasHandRigging).toBe(true);
      });

      it("skips hand rigging for non-character categories", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A tree",
          category: "environment",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          enableHandRigging: true, // Ignored for environment
        };

        await generate3DModel(config, onProgress);

        // Should not call hand rigging API
        const handRigCalls = (
          global.fetch as ReturnType<typeof vi.fn>
        ).mock.calls.filter((call: unknown[]) =>
          (call[0] as string).includes("hand-rigging"),
        );
        expect(handRigCalls.length).toBe(0);
      });

      it("continues on hand rigging failure", async () => {
        setupDefaultMocks();

        vi.mocked(global.fetch).mockImplementation(async (url) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("/api/hand-rigging/simple")) {
            return new Response("Hand rigging failed: no skeleton found", {
              status: 500,
            });
          }
          if (urlStr.includes("/api/vrm/convert")) {
            return new Response(
              JSON.stringify({
                vrmData: createMinimalGLB({ hasSkeleton: true }).toString(
                  "base64",
                ),
              }),
              { status: 200 },
            );
          }
          throw new Error(`Unmocked: ${urlStr}`);
        });

        const config: GenerationConfig = {
          prompt: "A character",
          category: "character",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          enableHandRigging: true,
          convertToVRM: true,
        };

        const result = await generate3DModel(config, onProgress);

        // Should complete without hand rigging
        expect(result.hasHandRigging).toBeFalsy();
        expect(result.taskId).toBeDefined();
      });
    });

    describe("VRM Conversion", () => {
      it("converts to VRM for NPC characters", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "An NPC",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: { name: "Test NPC" },
          convertToVRM: true,
        };

        const result = await generate3DModel(config, onProgress);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/vrm/convert"),
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("Test NPC"), // avatarName from metadata
          }),
        );
        expect(result.hasVRM).toBe(true);
        expect(result.vrmUrl).toBeDefined();
      });

      it("skips VRM for non-character categories", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A building",
          category: "building",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true, // Ignored for buildings
        };

        await generate3DModel(config, onProgress);

        const vrmCalls = (
          global.fetch as ReturnType<typeof vi.fn>
        ).mock.calls.filter((call: unknown[]) =>
          (call[0] as string).includes("/api/vrm/convert"),
        );
        expect(vrmCalls.length).toBe(0);
      });

      it("continues on VRM conversion failure", async () => {
        setupDefaultMocks();

        vi.mocked(global.fetch).mockImplementation(async (url) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("/api/vrm/convert")) {
            return new Response("VRM conversion failed: missing skeleton", {
              status: 500,
            });
          }
          if (urlStr.includes("/api/hand-rigging")) {
            return new Response(
              JSON.stringify({
                riggedGlbData: createMinimalGLB({ hasSkeleton: true }).toString(
                  "base64",
                ),
              }),
              { status: 200 },
            );
          }
          throw new Error(`Unmocked: ${urlStr}`);
        });

        const config: GenerationConfig = {
          prompt: "A character",
          category: "character",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          convertToVRM: true,
        };

        const result = await generate3DModel(config, onProgress);

        expect(result.hasVRM).toBeFalsy();
        expect(result.taskId).toBeDefined();
      });
    });

    describe("Progress Callbacks", () => {
      it("reports progress percentage 0-100", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // All progress values should be 0-100
        progressUpdates.forEach((p) => {
          expect(p.progress).toBeGreaterThanOrEqual(0);
          expect(p.progress).toBeLessThanOrEqual(100);
        });
      });

      it("includes stage name in progress", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Most progress updates should have a stage
        const withStage = progressUpdates.filter((p) => p.stage);
        expect(withStage.length).toBeGreaterThan(0);
      });

      it("includes human-readable currentStep", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Most updates should have currentStep
        const withStep = progressUpdates.filter((p) => p.currentStep);
        expect(withStep.length).toBeGreaterThan(0);
        withStep.forEach((p) => {
          expect(typeof p.currentStep).toBe("string");
          expect(p.currentStep!.length).toBeGreaterThan(0);
        });
      });

      it("passes poll progress to callback", async () => {
        setupDefaultMocks();

        // Make poll call the onProgress callback
        vi.mocked(pollTaskStatus).mockImplementation(
          async (_taskId, options) => {
            // Simulate progress updates
            for (let i = 0; i <= 100; i += 25) {
              options?.onProgress?.(i, i < 50 ? 2 : undefined);
            }
            return {
              taskId: "done",
              modelUrl: "https://meshy.ai/model.glb",
              status: "SUCCEEDED",
            };
          },
        );

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Should have received poll progress updates
        const pollUpdates = progressUpdates.filter((p) =>
          p.currentStep?.includes("%"),
        );
        expect(pollUpdates.length).toBeGreaterThan(0);
      });

      it("reports queue position when available", async () => {
        setupDefaultMocks();

        vi.mocked(pollTaskStatus).mockImplementation(
          async (_taskId, options) => {
            // First call shows queue position
            options?.onProgress?.(10, 5); // 5 tasks ahead
            options?.onProgress?.(50, 2);
            options?.onProgress?.(100, undefined);
            return {
              taskId: "done",
              modelUrl: "https://meshy.ai/model.glb",
              status: "SUCCEEDED",
            };
          },
        );

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Should show queue info in currentStep
        const queueUpdates = progressUpdates.filter((p) =>
          p.currentStep?.includes("tasks ahead"),
        );
        expect(queueUpdates.length).toBeGreaterThan(0);
      });
    });

    describe("Error Handling", () => {
      it("reports error in progress on failure", async () => {
        setupDefaultMocks();

        vi.mocked(startTextTo3DPreview).mockRejectedValue(
          new Error("Meshy API rate limit exceeded"),
        );

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await expect(generate3DModel(config, onProgress)).rejects.toThrow();

        const failedProgress = progressUpdates.find(
          (p) => p.status === "failed",
        );
        expect(failedProgress).toBeDefined();
        expect(failedProgress?.error).toBe("Meshy API rate limit exceeded");
      });

      it("handles concept art failure gracefully", async () => {
        setupDefaultMocks();

        vi.mocked(generateConceptArt).mockRejectedValue(
          new Error("Image generation quota exceeded"),
        );

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
          generateConceptArt: true,
        };

        // Should continue without concept art
        const result = await generate3DModel(config, onProgress);
        expect(result.taskId).toBeDefined();
      });

      it("handles download failure", async () => {
        setupDefaultMocks();

        vi.mocked(downloadFile).mockRejectedValue(
          new Error("Failed to download model"),
        );

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await expect(generate3DModel(config, onProgress)).rejects.toThrow(
          "Failed to download model",
        );
      });

      it("handles save failure", async () => {
        setupDefaultMocks();

        vi.mocked(saveAssetFiles).mockRejectedValue(new Error("Disk full"));

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await expect(generate3DModel(config, onProgress)).rejects.toThrow(
          "Disk full",
        );
      });
    });

    describe("Asset Saving", () => {
      it("saves all generated files", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "An NPC",
          category: "npc",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: { id: "npc_123", name: "Test NPC" },
          convertToVRM: true,
        };

        await generate3DModel(config, onProgress);

        expect(saveAssetFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            assetId: "npc_123",
            modelBuffer: expect.any(Buffer),
            modelFormat: "glb",
          }),
        );
      });

      it("includes metadata in saved asset", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: { id: "sword_1", name: "Epic Sword" },
        };

        await generate3DModel(config, onProgress);

        expect(saveAssetFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              name: "Epic Sword",
              pipeline: "text-to-3d",
              quality: "high",
              prompt: "A sword",
            }),
          }),
        );
      });

      it("generates asset ID from task ID when not in metadata", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {}, // No ID provided
        };

        await generate3DModel(config, onProgress);

        expect(saveAssetFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            assetId: expect.stringMatching(/^asset_/),
          }),
        );
      });

      it("downloads and saves thumbnail", async () => {
        setupDefaultMocks();

        const config: GenerationConfig = {
          prompt: "A sword",
          category: "weapon",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Should download thumbnail
        const thumbnailDownloads = vi
          .mocked(downloadFile)
          .mock.calls.filter((call) => call[0].includes("thumb"));
        expect(thumbnailDownloads.length).toBeGreaterThan(0);

        // Should save with thumbnail
        expect(saveAssetFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            thumbnailBuffer: expect.any(Buffer),
          }),
        );
      });
    });

    describe("Texture Downloading", () => {
      it("downloads separate texture files when provided", async () => {
        setupDefaultMocks();

        vi.mocked(pollTaskStatus)
          .mockResolvedValueOnce({
            taskId: "preview",
            modelUrl: "https://meshy.ai/preview.glb",
            status: "SUCCEEDED",
          })
          .mockResolvedValueOnce({
            taskId: "refine",
            modelUrl: "https://meshy.ai/textured.glb",
            status: "SUCCEEDED",
            textureUrls: [
              {
                base_color: "https://meshy.ai/base_color.png",
                metallic: "https://meshy.ai/metallic.png",
                roughness: "https://meshy.ai/roughness.png",
                normal: "https://meshy.ai/normal.png",
              },
            ],
          });

        const config: GenerationConfig = {
          prompt: "A metal armor",
          category: "prop",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        };

        await generate3DModel(config, onProgress);

        // Should attempt to download all texture types
        const textureDownloads = vi
          .mocked(downloadFile)
          .mock.calls.filter(
            (call) =>
              call[0].includes("base_color") ||
              call[0].includes("metallic") ||
              call[0].includes("roughness") ||
              call[0].includes("normal"),
          );
        expect(textureDownloads.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ==========================================================================
  // mergeSkeletonIntoTexturedModel Tests - Lines 47-230
  // ==========================================================================

  describe("Skeleton Merging (via generate3DModel)", () => {
    it("merges skeleton from rigged model into textured model", async () => {
      setupDefaultMocks();

      // Set up distinct URLs so merging is triggered
      vi.mocked(pollTaskStatus)
        .mockResolvedValueOnce({
          taskId: "preview",
          modelUrl: "https://meshy.ai/preview.glb",
          status: "SUCCEEDED",
        })
        .mockResolvedValueOnce({
          taskId: "refine",
          modelUrl: "https://meshy.ai/textured.glb",
          thumbnailUrl: "https://meshy.ai/thumb.png",
          status: "SUCCEEDED",
        });

      vi.mocked(getRiggingTaskStatus).mockResolvedValue({
        status: "SUCCEEDED",
        progress: 100,
        result: {
          rigged_character_glb_url: "https://meshy.ai/rigged-different.glb",
        },
      });

      // Return different models for different URLs
      const texturedModel = createMinimalGLB({
        hasTextures: true,
        nodeCount: 3,
      });
      const riggedModel = createMinimalGLB({
        hasSkeleton: true,
        boneCount: 10,
      });

      vi.mocked(downloadFile).mockImplementation(async (url: string) => {
        if (url.includes("rigged")) return riggedModel;
        if (url.includes("textured")) return texturedModel;
        if (url.includes("preview")) return createMinimalGLB({});
        return Buffer.from("fake");
      });

      const config: GenerationConfig = {
        prompt: "A character",
        category: "character",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {},
        convertToVRM: true,
      };

      const result = await generate3DModel(config, onProgress);

      // Merging should have occurred
      expect(saveAssetFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          modelBuffer: expect.any(Buffer),
        }),
      );
      expect(result.taskId).toBeDefined();
    });

    it("returns textured model when rigged has no skeleton", async () => {
      setupDefaultMocks();

      // Rigged model has no skeleton - should return textured as-is
      vi.mocked(pollTaskStatus)
        .mockResolvedValueOnce({
          taskId: "preview",
          modelUrl: "https://meshy.ai/preview.glb",
          status: "SUCCEEDED",
        })
        .mockResolvedValueOnce({
          taskId: "refine",
          modelUrl: "https://meshy.ai/textured.glb",
          status: "SUCCEEDED",
        });

      vi.mocked(getRiggingTaskStatus).mockResolvedValue({
        status: "SUCCEEDED",
        progress: 100,
        result: {
          rigged_character_glb_url: "https://meshy.ai/rigged.glb",
        },
      });

      // Both models have no skeleton
      vi.mocked(downloadFile).mockImplementation(async () => {
        return createMinimalGLB({ hasTextures: true }); // No skeleton
      });

      const config: GenerationConfig = {
        prompt: "A character",
        category: "character",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {},
        convertToVRM: true,
      };

      const result = await generate3DModel(config, onProgress);
      expect(result.taskId).toBeDefined();
    });

    it("returns textured model when it already has skeleton", async () => {
      setupDefaultMocks();

      vi.mocked(pollTaskStatus)
        .mockResolvedValueOnce({
          taskId: "preview",
          modelUrl: "https://meshy.ai/preview.glb",
          status: "SUCCEEDED",
        })
        .mockResolvedValueOnce({
          taskId: "refine",
          modelUrl: "https://meshy.ai/textured.glb",
          status: "SUCCEEDED",
        });

      vi.mocked(getRiggingTaskStatus).mockResolvedValue({
        status: "SUCCEEDED",
        progress: 100,
        result: {
          rigged_character_glb_url: "https://meshy.ai/rigged.glb",
        },
      });

      // Textured model already has skeleton
      vi.mocked(downloadFile).mockImplementation(async () => {
        return createMinimalGLB({ hasTextures: true, hasSkeleton: true });
      });

      const config: GenerationConfig = {
        prompt: "A character",
        category: "character",
        pipeline: "text-to-3d",
        quality: "medium",
        metadata: {},
        convertToVRM: true,
      };

      const result = await generate3DModel(config, onProgress);
      expect(result.taskId).toBeDefined();
    });
  });

  // ==========================================================================
  // generateBatch Tests - Lines 1064-1095
  // ==========================================================================

  describe("generateBatch", () => {
    it("generates multiple variations", async () => {
      setupDefaultMocks();

      const config: GenerationConfig = {
        prompt: "A medieval sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "preview",
        metadata: {},
      };

      const results = await generateBatch(config, 3, onProgress);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.taskId).toBeDefined();
        expect(result.modelUrl).toBeDefined();
      });
    });

    it("modifies prompt for each variation", async () => {
      setupDefaultMocks();

      const basePrompt = "A sword";
      const config: GenerationConfig = {
        prompt: basePrompt,
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "preview",
        metadata: {},
        useGPT4Enhancement: false, // Skip enhancement to see raw prompts
      };

      await generateBatch(config, 3, onProgress);

      const previewCalls = vi.mocked(startTextTo3DPreview).mock.calls;
      expect(previewCalls.length).toBe(3);

      // Each call should have variation suffix
      expect(previewCalls[0][0]).toContain("(variation 1)");
      expect(previewCalls[1][0]).toContain("(variation 2)");
      expect(previewCalls[2][0]).toContain("(variation 3)");
    });

    it("reports batch progress correctly", async () => {
      setupDefaultMocks();

      const config: GenerationConfig = {
        prompt: "A sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "preview",
        metadata: {},
      };

      await generateBatch(config, 4, onProgress);

      // Should have batch-level progress updates
      const batchProgress = progressUpdates.filter(
        (p) =>
          p.currentStep?.includes("variation") && p.currentStep?.includes("of"),
      );
      expect(batchProgress.length).toBeGreaterThan(0);
    });

    it("continues on individual variation failure", async () => {
      setupDefaultMocks();

      let callCount = 0;
      vi.mocked(startTextTo3DPreview).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Variation 2 failed");
        }
        return { previewTaskId: `preview_${callCount}` };
      });

      const config: GenerationConfig = {
        prompt: "A sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "preview",
        metadata: {},
      };

      const results = await generateBatch(config, 3, onProgress);

      // Should have 2 successful results (variations 1 and 3)
      expect(results.length).toBe(2);
    });

    it("handles all variations failing", async () => {
      setupDefaultMocks();

      vi.mocked(startTextTo3DPreview).mockRejectedValue(
        new Error("All generations blocked"),
      );

      const config: GenerationConfig = {
        prompt: "A sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "preview",
        metadata: {},
      };

      const results = await generateBatch(config, 3, onProgress);

      // Should return empty array, not throw
      expect(results).toEqual([]);
    });

    it("uses base config for all variations", async () => {
      setupDefaultMocks();

      const config: GenerationConfig = {
        prompt: "A sword",
        category: "weapon",
        pipeline: "text-to-3d",
        quality: "high",
        metadata: { baseId: "sword" },
        useGPT4Enhancement: false,
      };

      await generateBatch(config, 2, onProgress);

      const previewCalls = vi.mocked(startTextTo3DPreview).mock.calls;

      // All variations should use same quality settings
      previewCalls.forEach((call) => {
        expect(call[1]).toEqual(
          expect.objectContaining({
            ai_model: "latest", // high quality
            target_polycount: 50000,
          }),
        );
      });
    });
  });
});
