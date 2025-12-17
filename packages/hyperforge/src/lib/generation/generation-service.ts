/**
 * Generation Service
 * Unified orchestrator for all generation types (3D, Audio, Content)
 *
 * Uses Meshy API for 3D generation with optimized settings for Three.js web MMO.
 * @see https://docs.meshy.ai/api/text-to-3d
 * @see https://docs.meshy.ai/en/api/image-to-3d
 */

import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";
import {
  startTextTo3DPreview,
  startTextTo3DRefine,
} from "@/lib/meshy/text-to-3d";
import { startImageTo3D } from "@/lib/meshy/image-to-3d";
import {
  pollTaskStatus as pollTaskStatusUnified,
  type TextureUrls,
} from "@/lib/meshy/poll-task";
import { createRiggingTask, getRiggingTaskStatus } from "@/lib/meshy/client";
import {
  POLYCOUNT_PRESETS,
  DEFAULT_TEXTURE_RESOLUTION,
  DEFAULT_CHARACTER_HEIGHT,
} from "@/lib/meshy/constants";
import type { MeshyAIModel } from "@/lib/meshy/types";
import type { GenerationProgress } from "@/stores/generation-store";
import { saveAssetFiles, downloadFile } from "@/lib/storage/asset-storage";
import { enhancePromptWithGPT4 } from "@/lib/ai/gateway";
import { generateConceptArt } from "@/lib/ai/concept-art-service";
import { logger } from "@/lib/utils";

const log = logger.child("Generation");

/**
 * Merge skeleton/skin data from a rigged GLB into a textured GLB
 * This preserves textures from the textured model while adding skeleton from rigged model
 *
 * Used when Meshy rigging strips textures - we take:
 * - Skeleton/bones from rigged model
 * - Textures/materials from textured model
 * - Merge them into one GLB with both
 */
async function mergeSkeletonIntoTexturedModel(
  texturedGlbBuffer: Buffer,
  riggedGlbBuffer: Buffer,
): Promise<Buffer> {
  // Parse both GLB files
  const parseGlb = (buffer: Buffer) => {
    const jsonChunkLength = buffer.readUInt32LE(12);
    const jsonData = buffer.slice(20, 20 + jsonChunkLength).toString("utf8");
    const binStart = 20 + jsonChunkLength + 8; // 8 bytes for bin chunk header
    const binData = buffer.slice(binStart);
    return {
      json: JSON.parse(jsonData),
      bin: binData,
      jsonChunkLength,
    };
  };

  const textured = parseGlb(texturedGlbBuffer);
  const rigged = parseGlb(riggedGlbBuffer);

  // Check if rigged model has skeleton data
  if (!rigged.json.skins || rigged.json.skins.length === 0) {
    log.debug("Rigged model has no skeleton, returning textured model as-is");
    return texturedGlbBuffer;
  }

  // Check if textured model already has skeleton
  if (textured.json.skins && textured.json.skins.length > 0) {
    log.debug("Textured model already has skeleton, returning as-is");
    return texturedGlbBuffer;
  }

  log.debug("Merging skeleton from rigged model into textured model...");
  log.debug(
    `Textured: ${textured.json.nodes?.length || 0} nodes, ${textured.json.images?.length || 0} images`,
  );
  log.debug(
    `Rigged: ${rigged.json.nodes?.length || 0} nodes, ${rigged.json.skins?.[0]?.joints?.length || 0} bones`,
  );

  // Copy skeleton-related data from rigged to textured
  const texturedNodeCount = textured.json.nodes?.length || 0;

  // Copy nodes (bone hierarchy) from rigged model
  const riggedSkin = rigged.json.skins[0];

  // Map old node indices to new indices
  const nodeIndexMap = new Map<number, number>();
  const nodesToAdd: Record<string, unknown>[] = [];

  for (const oldIdx of riggedSkin.joints) {
    const node = rigged.json.nodes[oldIdx];
    const newIdx = texturedNodeCount + nodesToAdd.length;
    nodeIndexMap.set(oldIdx, newIdx);

    // Clone node and update children references later
    nodesToAdd.push({ ...node });
  }

  // Update children references in added nodes
  for (const node of nodesToAdd) {
    if (node.children && Array.isArray(node.children)) {
      node.children = (node.children as number[]).map((childIdx) => {
        const newIdx = nodeIndexMap.get(childIdx);
        return newIdx !== undefined ? newIdx : childIdx;
      });
    }
  }

  // Add bone nodes to textured model
  textured.json.nodes = [...(textured.json.nodes || []), ...nodesToAdd];

  // Create skin referencing the new node indices
  const newSkin = {
    ...riggedSkin,
    joints: riggedSkin.joints.map(
      (oldIdx: number) => nodeIndexMap.get(oldIdx)!,
    ),
    skeleton: nodeIndexMap.get(riggedSkin.skeleton) ?? riggedSkin.skeleton,
  };

  // Handle inverse bind matrices accessor
  if (riggedSkin.inverseBindMatrices !== undefined) {
    const ibmAccessor = rigged.json.accessors[riggedSkin.inverseBindMatrices];
    const ibmBufferView = rigged.json.bufferViews[ibmAccessor.bufferView];

    // Copy the inverse bind matrices data
    const ibmData = rigged.bin.slice(
      ibmBufferView.byteOffset || 0,
      (ibmBufferView.byteOffset || 0) + ibmBufferView.byteLength,
    );

    // Add buffer view for IBM
    const newBufferViewIndex = textured.json.bufferViews?.length || 0;
    const texturedBinLength = textured.bin.length;

    textured.json.bufferViews = textured.json.bufferViews || [];
    textured.json.bufferViews.push({
      buffer: 0,
      byteOffset: texturedBinLength,
      byteLength: ibmData.length,
    });

    // Add accessor for IBM
    const newAccessorIndex = textured.json.accessors?.length || 0;
    textured.json.accessors = textured.json.accessors || [];
    textured.json.accessors.push({
      ...ibmAccessor,
      bufferView: newBufferViewIndex,
    });

    // Update skin reference
    newSkin.inverseBindMatrices = newAccessorIndex;

    // Append IBM data to bin chunk
    textured.bin = Buffer.concat([textured.bin, ibmData]);
  }

  // Add skin to textured model
  textured.json.skins = [newSkin];

  // Apply skin to mesh node (first mesh node)
  const meshNodeIdx = textured.json.nodes.findIndex(
    (n: Record<string, unknown>) => n.mesh !== undefined,
  );
  if (meshNodeIdx >= 0) {
    textured.json.nodes[meshNodeIdx].skin = 0;
  }

  // Update buffer size
  if (textured.json.buffers && textured.json.buffers.length > 0) {
    textured.json.buffers[0].byteLength = textured.bin.length;
  }

  // Reconstruct GLB
  const jsonStr = JSON.stringify(textured.json);
  const jsonBuffer = Buffer.from(jsonStr);
  // Pad JSON to 4-byte alignment
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const paddedJsonBuffer = Buffer.concat([
    jsonBuffer,
    Buffer.alloc(jsonPadding, 0x20),
  ]);

  // Pad BIN to 4-byte alignment
  const binPadding = (4 - (textured.bin.length % 4)) % 4;
  const paddedBinBuffer = Buffer.concat([
    textured.bin,
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

  log.info(
    `Merged model: ${(glb.length / 1024 / 1024).toFixed(2)} MB with ${newSkin.joints.length} bones`,
  );

  return glb;
}

export interface GenerationResult {
  taskId: string;
  modelUrl: string;
  thumbnailUrl?: string;
  vrmUrl?: string; // VRM format URL if conversion was performed
  hasVRM?: boolean; // Whether VRM was saved locally
  hasHandRigging?: boolean; // Whether hand bones were added
  localModelUrl?: string; // Local API URL for the model
  localVrmUrl?: string; // Local API URL for the VRM
  localThumbnailUrl?: string; // Local API URL for the thumbnail
  metadata: Record<string, unknown>;
}

/**
 * Generate 3D model using Meshy
 */
export async function generate3DModel(
  config: GenerationConfig,
  onProgress?: (progress: GenerationProgress) => void,
): Promise<GenerationResult> {
  const { prompt, pipeline, imageUrl, quality, metadata } = config;

  // Map quality to Meshy AI model options
  // See: https://docs.meshy.ai/en/api/text-to-3d
  // As of Dec 2024, "latest" = Meshy-6, the newest and best model
  //
  // Polycount guidelines for Three.js web MMO (from POLYCOUNT_PRESETS):
  // - Small props: 500 - 2,000 triangles
  // - Medium props: 2,000 - 5,000 triangles
  // - NPC Characters: 2,000 - 10,000 triangles
  // - Large props: 5,000 - 10,000 triangles
  // - Small buildings: 5,000 - 15,000 triangles
  // - Large structures: 15,000 - 50,000 triangles
  //
  // These quality presets provide reasonable defaults for most use cases.
  // For asset-specific polycount, use POLYCOUNT_PRESETS based on category.
  const qualityOptions: Record<
    string,
    {
      targetPolycount: number;
      textureResolution: number;
      enablePBR: boolean;
      aiModel: MeshyAIModel;
      textureRichness: string;
    }
  > = {
    // Preview / Meshy-4: Fast, lower quality (for quick iterations)
    // ~10K polys good for small buildings or detailed props
    preview: {
      targetPolycount: POLYCOUNT_PRESETS.small_building.defaultPolycount, // 10000
      textureResolution: 1024,
      enablePBR: true,
      aiModel: "meshy-4",
      textureRichness: "medium",
    },
    // Medium / Meshy-6: High quality with latest model
    // ~30K polys good for large structures or high-detail characters
    medium: {
      targetPolycount: POLYCOUNT_PRESETS.large_structure.defaultPolycount, // 30000
      textureResolution: DEFAULT_TEXTURE_RESOLUTION, // 2048
      enablePBR: true,
      aiModel: "latest", // Meshy-6 - best quality
      textureRichness: "high",
    },
    // High / Meshy-6: Maximum quality settings
    // ~50K polys for hero assets (use LOD for runtime)
    high: {
      targetPolycount: POLYCOUNT_PRESETS.large_structure.maxPolycount, // 50000
      textureResolution: 4096,
      enablePBR: true,
      aiModel: "latest", // Meshy-6 - best quality
      textureRichness: "high",
    },
  };

  const options = qualityOptions[quality] || qualityOptions.medium;

  try {
    // Stage 0: GPT-4 Prompt Enhancement (if enabled)
    let effectivePrompt = prompt;

    if (config.useGPT4Enhancement !== false) {
      onProgress?.({
        status: "generating",
        stage: "Prompt Enhancement",
        progress: 0,
        currentStep: "Enhancing prompt with AI...",
      });

      const isAvatar =
        config.category === "npc" || config.category === "character";
      const enhancementResult = await enhancePromptWithGPT4(prompt, {
        assetType: config.category || "item",
        isAvatar,
      });

      if (!enhancementResult.error) {
        effectivePrompt = enhancementResult.enhancedPrompt;
        log.debug("Enhanced prompt:", effectivePrompt);
      } else {
        log.warn("Prompt enhancement failed, using original");
      }
    }

    // Stage 1: Get texture reference image (custom upload or AI-generated concept art)
    let textureImageUrl: string | undefined;

    // Priority: 1. Custom HTTP URL, 2. Custom data URL, 3. AI-generated concept art
    if (config.referenceImageUrl) {
      // User provided a custom reference image URL (already uploaded)
      textureImageUrl = config.referenceImageUrl;
      log.debug("Using custom reference image URL:", textureImageUrl);

      onProgress?.({
        status: "generating",
        stage: "Reference Image",
        progress: 3,
        currentStep: "Using custom reference image for texturing...",
      });
    } else if (config.referenceImageDataUrl) {
      // User provided a data URL - Meshy may not accept data URLs, log a warning
      log.warn(
        "Reference image provided as data URL. Meshy may require HTTP URL.",
      );
      textureImageUrl = config.referenceImageDataUrl;

      onProgress?.({
        status: "generating",
        stage: "Reference Image",
        progress: 3,
        currentStep: "Using custom reference image...",
      });
    } else if (
      config.generateConceptArt !== false &&
      pipeline === "text-to-3d"
    ) {
      // No custom image - generate concept art with AI
      onProgress?.({
        status: "generating",
        stage: "Concept Art",
        progress: 3,
        currentStep: "Generating concept art with AI...",
      });

      try {
        const conceptArt = await generateConceptArt(effectivePrompt, {
          style: "realistic",
          viewAngle: "isometric",
          background: "simple",
          assetType: config.category || "item",
        });

        if (conceptArt) {
          textureImageUrl = conceptArt.imageUrl;
          log.info("Concept art generated successfully");
        } else {
          log.warn("Concept art generation failed, continuing without");
        }
      } catch (error) {
        log.warn("Concept art error:", error);
        // Continue without concept art
      }
    } else {
      log.debug("No texture reference image - using text prompt only");
    }

    // Stage 2: Start 3D generation
    onProgress?.({
      status: "generating",
      stage: "Text-to-3D Preview",
      progress: 5,
      currentStep: "Starting 3D generation...",
    });

    let result: {
      taskId: string;
      modelUrl: string;
      thumbnailUrl?: string;
      texturedModelUrl?: string; // Original textured model (before rigging)
      textureUrls?: TextureUrls[]; // Separate texture files from Meshy
    };
    let previewModelUrl: string | undefined; // Preview model URL (untextured, for text-to-3d only)

    if (pipeline === "text-to-3d") {
      // Two-stage text-to-3D workflow
      onProgress?.({
        status: "generating",
        stage: "Text-to-3D Preview",
        progress: 8,
        currentStep: "Starting preview stage...",
      });

      // Stage 1: Preview
      const { previewTaskId } = await startTextTo3DPreview(effectivePrompt, {
        ai_model: options.aiModel,
        topology: "triangle",
        target_polycount: options.targetPolycount,
        art_style: "realistic",
      });

      onProgress?.({
        status: "generating",
        stage: "Text-to-3D Preview",
        progress: 10,
        currentStep: "Generating preview mesh...",
      });

      // Poll preview completion and get the preview model URL
      const previewResult = await pollTaskStatusUnified(previewTaskId, {
        pollIntervalMs: 5000,
        timeoutMs: 300000,
        onProgress: (progress, precedingTasks) => {
          const queueInfo =
            precedingTasks !== undefined
              ? ` (${precedingTasks} tasks ahead)`
              : "";
          onProgress?.({
            status: "generating",
            stage: "Text-to-3D Preview",
            progress: 10 + Math.floor(progress * 0.35), // 10-45%
            currentStep: `Preview stage: ${progress}%${queueInfo}`,
          });
        },
      });

      // Save preview model URL for later (untextured, fast-loading version)
      previewModelUrl = previewResult.modelUrl;
      log.debug("Preview model URL:", previewModelUrl);

      // Stage 2: Refine (adds textures based on reference image and/or prompt)
      onProgress?.({
        status: "generating",
        stage: "Text-to-3D Refine",
        progress: 45,
        currentStep: textureImageUrl
          ? "Starting refine stage with texture reference..."
          : "Starting refine stage (texturing)...",
      });

      // Use texture reference image if available, otherwise use text prompt only
      // Per Meshy docs: texture_image_url OR texture_prompt can guide texturing
      // IMPORTANT: Meshy requires HTTP/HTTPS URLs, not data URLs for texture_image_url
      const isValidHttpUrl =
        textureImageUrl?.startsWith("http://") ||
        textureImageUrl?.startsWith("https://");

      const { refineTaskId } = await startTextTo3DRefine(previewTaskId, {
        enable_pbr: options.enablePBR,
        // Only pass texture_image_url if it's a valid HTTP URL
        texture_image_url: isValidHttpUrl ? textureImageUrl : undefined,
        // Always pass the prompt for texture guidance
        texture_prompt: effectivePrompt,
        ai_model: options.aiModel, // Use same model for consistent results
      });

      if (textureImageUrl && !isValidHttpUrl) {
        log.warn(
          "texture_image_url must be HTTP/HTTPS URL, data URLs not supported by Meshy. Using texture_prompt only.",
        );
      }

      onProgress?.({
        status: "generating",
        stage: "Text-to-3D Refine",
        progress: 50,
        currentStep: "Adding textures...",
      });

      // Poll refine completion
      const refineResult = await pollTaskStatusUnified(refineTaskId, {
        pollIntervalMs: 5000,
        timeoutMs: 300000,
        onProgress: (progress, precedingTasks) => {
          const queueInfo =
            precedingTasks !== undefined
              ? ` (${precedingTasks} tasks ahead)`
              : "";
          onProgress?.({
            status: "generating",
            stage: "Text-to-3D Refine",
            progress: 50 + Math.floor(progress * 0.45), // 50-95%
            currentStep: `Refine stage: ${progress}%${queueInfo}`,
          });
        },
      });

      // Stage 3: Meshy Auto-Rigging (if this is an avatar/character)
      // IMPORTANT: Use input_task_id (refine task ID) instead of model_url to preserve textures
      const needsRigging = config.convertToVRM || config.enableHandRigging;
      const isCharacter =
        config.category === "npc" || config.category === "character";

      // Store the textured model info from refine stage (before rigging which may strip textures)
      const texturedModelUrl = refineResult.modelUrl;
      const textureUrls = refineResult.textureUrls;

      if (needsRigging && isCharacter && refineResult.taskId) {
        onProgress?.({
          status: "generating",
          stage: "Meshy Auto-Rigging",
          progress: 70,
          currentStep: "Sending to Meshy for auto-rigging...",
        });

        try {
          // Start Meshy rigging task using input_task_id to preserve textures
          // The refine task ID is used so Meshy knows the source model's textures
          const riggingTaskId = await createRiggingTask({
            input_task_id: refineResult.taskId,
            height_meters: DEFAULT_CHARACTER_HEIGHT, // Standard adult human height
          });

          log.debug(
            "Started Meshy rigging task with input_task_id:",
            refineResult.taskId,
          );
          log.debug("Rigging task ID:", riggingTaskId);

          // Poll rigging task completion
          let riggingStatus = await getRiggingTaskStatus(riggingTaskId);
          let riggingAttempts = 0;
          const maxRiggingAttempts = 60; // 5 minutes max (5s * 60)

          while (
            riggingStatus.status !== "SUCCEEDED" &&
            riggingStatus.status !== "FAILED" &&
            riggingAttempts < maxRiggingAttempts
          ) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            riggingStatus = await getRiggingTaskStatus(riggingTaskId);
            riggingAttempts++;

            const progress =
              riggingStatus.progress ??
              Math.floor((riggingAttempts / maxRiggingAttempts) * 100);
            onProgress?.({
              status: "generating",
              stage: "Meshy Auto-Rigging",
              progress: 70 + Math.floor(progress * 0.15), // 70-85%
              currentStep: `Meshy rigging: ${progress}%`,
            });
          }

          // Rigging API returns model in result.rigged_character_glb_url
          const riggedModelUrl = riggingStatus.result?.rigged_character_glb_url;

          if (riggingStatus.status === "SUCCEEDED" && riggedModelUrl) {
            log.info("Meshy rigging completed successfully");
            log.debug("Rigged model URL:", riggedModelUrl);
            result = {
              taskId: riggingTaskId,
              modelUrl: riggedModelUrl,
              thumbnailUrl: refineResult.thumbnailUrl,
              // Also keep textured model info for fallback if rigged model has no textures
              texturedModelUrl,
              textureUrls,
            };
          } else {
            log.warn("Meshy rigging failed with status:", riggingStatus.status);
            log.warn(
              "Rigging error details:",
              riggingStatus.task_error?.message || "Unknown",
            );
            // Fall back to textured model without rigging
            result = {
              taskId: refineResult.taskId,
              modelUrl: refineResult.modelUrl,
              thumbnailUrl: refineResult.thumbnailUrl,
              texturedModelUrl,
              textureUrls,
            };
          }
        } catch (riggingError) {
          log.error("Meshy rigging error:", riggingError);
          // Continue with textured unrigged model
          result = {
            taskId: refineResult.taskId,
            modelUrl: refineResult.modelUrl,
            thumbnailUrl: refineResult.thumbnailUrl,
            texturedModelUrl,
            textureUrls,
          };
        }
      } else {
        result = {
          taskId: refineResult.taskId,
          modelUrl: refineResult.modelUrl,
          thumbnailUrl: refineResult.thumbnailUrl,
          texturedModelUrl,
          textureUrls,
        };
      }
    } else {
      // Single-stage image-to-3D workflow
      if (!imageUrl) {
        throw new Error("Image URL required for image-to-3d pipeline");
      }

      const { taskId } = await startImageTo3D(imageUrl, {
        enable_pbr: options.enablePBR,
        ai_model: options.aiModel,
        topology: "quad",
        target_polycount: options.targetPolycount,
        texture_resolution: options.textureResolution,
      });

      onProgress?.({
        status: "generating",
        progress: 10,
        currentStep: "Generating 3D model...",
      });

      // Poll for completion
      const imageResult = await pollTaskStatusUnified(taskId, {
        pollIntervalMs: 5000,
        timeoutMs: 300000,
        onProgress: (progress, precedingTasks) => {
          const queueInfo =
            precedingTasks !== undefined
              ? ` (${precedingTasks} tasks ahead)`
              : "";
          onProgress?.({
            status: "generating",
            progress: 10 + Math.floor(progress * 0.85), // 10-95%
            currentStep: `Processing: ${progress}%${queueInfo}`,
          });
        },
      });

      result = {
        taskId: imageResult.taskId,
        modelUrl: imageResult.modelUrl,
        thumbnailUrl: imageResult.thumbnailUrl,
      };
    }

    // Generate asset ID from metadata or task ID
    const assetId = (metadata?.id as string) || `asset_${result.taskId}`;

    // Download and save the GLB model
    onProgress?.({
      status: "generating",
      stage: "Downloading",
      progress: 85,
      currentStep: "Downloading 3D model from Meshy...",
    });

    // Download the main model (rigged if available, otherwise textured)
    log.debug("Downloading model from:", result.modelUrl);
    const modelBuffer = await downloadFile(result.modelUrl);
    log.info(
      `Downloaded model: ${(modelBuffer.length / 1024 / 1024).toFixed(2)} MB`,
    );

    // Download the original textured model if different from main model (rigging strips textures)
    let texturedModelBuffer: Buffer | undefined;
    let mergedModelBuffer: Buffer = modelBuffer; // Will hold merged result (skeleton + textures)

    if (
      result.texturedModelUrl &&
      result.texturedModelUrl !== result.modelUrl
    ) {
      try {
        log.debug(
          "Downloading original textured model from:",
          result.texturedModelUrl,
        );
        texturedModelBuffer = await downloadFile(result.texturedModelUrl);
        log.info(
          `Downloaded textured model: ${(texturedModelBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        );

        // Merge skeleton from rigged model into textured model
        // This preserves textures while adding the skeleton for hand rigging
        onProgress?.({
          status: "generating",
          stage: "Merging",
          progress: 86,
          currentStep: "Merging skeleton with textures...",
        });

        try {
          mergedModelBuffer = await mergeSkeletonIntoTexturedModel(
            texturedModelBuffer,
            modelBuffer,
          );
          log.info(
            `Merged model: ${(mergedModelBuffer.length / 1024 / 1024).toFixed(2)} MB`,
          );
        } catch (mergeError) {
          log.error("Failed to merge skeleton:", mergeError);
          // Fall back to rigged model (no textures but has skeleton)
          mergedModelBuffer = modelBuffer;
        }
      } catch (error) {
        log.warn("Failed to download textured model:", error);
      }
    }

    // Download separate texture files from Meshy (base_color, metallic, roughness, normal)
    const textureBuffers: { name: string; buffer: Buffer }[] = [];
    if (result.textureUrls && result.textureUrls.length > 0) {
      onProgress?.({
        status: "generating",
        stage: "Downloading",
        progress: 87,
        currentStep: "Downloading texture files...",
      });

      for (const textureSet of result.textureUrls) {
        // Download base color texture (always present)
        if (textureSet.base_color) {
          try {
            const buffer = await downloadFile(textureSet.base_color);
            textureBuffers.push({ name: "base_color.png", buffer });
            log.debug(
              `Downloaded base_color texture: ${(buffer.length / 1024).toFixed(1)} KB`,
            );
          } catch (e) {
            log.warn("Failed to download base_color texture:", e);
          }
        }

        // Download PBR textures if available
        if (textureSet.metallic) {
          try {
            const buffer = await downloadFile(textureSet.metallic);
            textureBuffers.push({ name: "metallic.png", buffer });
          } catch (e) {
            log.warn("Failed to download metallic texture:", e);
          }
        }

        if (textureSet.roughness) {
          try {
            const buffer = await downloadFile(textureSet.roughness);
            textureBuffers.push({ name: "roughness.png", buffer });
          } catch (e) {
            log.warn("Failed to download roughness texture:", e);
          }
        }

        if (textureSet.normal) {
          try {
            const buffer = await downloadFile(textureSet.normal);
            textureBuffers.push({ name: "normal.png", buffer });
          } catch (e) {
            log.warn("Failed to download normal texture:", e);
          }
        }
      }

      log.info(`Downloaded ${textureBuffers.length} separate texture files`);
    }

    // Download preview model if available (untextured, fast-loading version)
    // previewModelUrl is only set for text-to-3d pipeline
    let previewBuffer: Buffer | undefined;
    if (previewModelUrl) {
      try {
        log.debug("Downloading preview model from:", previewModelUrl);
        previewBuffer = await downloadFile(previewModelUrl);
        log.info(
          `Downloaded preview model: ${(previewBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        );
      } catch (error) {
        log.warn("Failed to download preview model:", error);
      }
    }

    // Download thumbnail
    let thumbnailBuffer: Buffer | undefined;
    if (result.thumbnailUrl) {
      try {
        thumbnailBuffer = await downloadFile(result.thumbnailUrl);
      } catch {
        log.warn("Failed to download thumbnail");
      }
    }

    onProgress?.({
      status: "generating",
      stage: "Saving",
      progress: 90,
      currentStep: "Saving 3D models locally...",
    });

    // Pipeline order: Hand Rigging (GLB) → VRM Conversion (last)
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3500";

    // Step 1: Hand rigging on GLB (if enabled)
    // Use merged model (with skeleton + textures) for hand rigging
    let processedModelBuffer = mergedModelBuffer;
    let hasHandRigging = false;
    const shouldAddHandRigging =
      config.enableHandRigging &&
      (config.category === "npc" || config.category === "character");

    if (shouldAddHandRigging) {
      try {
        onProgress?.({
          status: "generating",
          stage: "Hand Rigging",
          progress: 92,
          currentStep: "Adding hand bones to model...",
        });

        // Call hand rigging API with GLB data
        const handRigResponse = await fetch(
          `${baseUrl}/api/hand-rigging/simple`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              // Use merged model (has skeleton + textures)
              glbData: mergedModelBuffer.toString("base64"),
              options: {
                addFingerBones: true,
                fingerBoneLength: 0.1,
              },
            }),
          },
        );

        if (handRigResponse.ok) {
          const handRigData = await handRigResponse.json();

          // Use hand-rigged GLB for subsequent processing
          if (handRigData.riggedGlbData) {
            processedModelBuffer = Buffer.from(
              handRigData.riggedGlbData,
              "base64",
            );
            hasHandRigging = true;
            log.info("Hand rigging complete:", {
              leftHandBones: handRigData.leftHandBones?.length || 0,
              rightHandBones: handRigData.rightHandBones?.length || 0,
            });
          }

          if (handRigData.warnings && handRigData.warnings.length > 0) {
            log.warn("Hand rigging warnings:", handRigData.warnings);
          }
        } else {
          log.error("Hand rigging failed:", await handRigResponse.text());
          // Don't fail - continue with original GLB
        }
      } catch (error) {
        log.error("Hand rigging error:", error);
        // Don't fail the whole generation if hand rigging fails
      }
    }

    // Step 2: VRM conversion (always last in pipeline, if enabled)
    // Note: VRM needs textures for proper visual rendering. The processedModelBuffer
    // ideally has merged skeleton + textures, but this is only guaranteed when
    // texturedModelUrl differs from modelUrl. When they're identical or texturedModelUrl
    // is missing, textures may not be embedded.
    let vrmUrl: string | undefined;
    let vrmBuffer: Buffer | undefined;
    const shouldConvertToVRM =
      config.convertToVRM &&
      (config.category === "npc" || config.category === "character");

    // Check if we have confirmed textures in the model
    const hasConfirmedTextures =
      result.texturedModelUrl &&
      result.texturedModelUrl !== result.modelUrl &&
      texturedModelBuffer !== undefined;

    if (shouldConvertToVRM) {
      try {
        onProgress?.({
          status: "generating",
          stage: "VRM Conversion",
          progress: 95,
          currentStep: "Converting to VRM format...",
        });

        // Determine which model to use for VRM conversion:
        // Use processedModelBuffer which is based on mergedModelBuffer.
        // If textured model was separate and merged, it has skeleton + textures.
        // Otherwise, it may only have skeleton (textures not guaranteed).
        const vrmSourceBuffer = processedModelBuffer;

        if (!hasConfirmedTextures) {
          log.warn(
            "VRM conversion: textures may not be embedded in model. " +
              "texturedModelUrl was not separate from modelUrl.",
          );
        }

        log.debug(
          `VRM conversion using: processed model (skeleton${hasConfirmedTextures ? " + textures" : ""}${hasHandRigging ? " + hand rigging" : ""})`,
        );

        // Call VRM conversion API with the processed model
        const vrmResponse = await fetch(`${baseUrl}/api/vrm/convert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Always use the buffer - it has the merged skeleton + textures
            glbData: vrmSourceBuffer.toString("base64"),
            avatarName: (metadata?.name as string) || "Generated Avatar",
            author: "HyperForge",
          }),
        });

        if (vrmResponse.ok) {
          const vrmData = await vrmResponse.json();
          vrmUrl = vrmData.vrmDataUrl;

          // Decode base64 VRM data to buffer for saving
          if (vrmData.vrmData) {
            vrmBuffer = Buffer.from(vrmData.vrmData, "base64");
          }

          // Log warnings if any
          if (vrmData.warnings && vrmData.warnings.length > 0) {
            log.warn("VRM conversion warnings:", vrmData.warnings);
          }
        } else {
          log.error("VRM conversion failed:", await vrmResponse.text());
          // Don't fail the whole generation if VRM conversion fails
        }
      } catch (error) {
        log.error("VRM conversion error:", error);
        // Don't fail the whole generation if VRM conversion fails
      }
    }

    // Use the processed model buffer (with hand rigging if applied)
    const finalModelBuffer = processedModelBuffer;
    const finalVrmBuffer = vrmBuffer;

    onProgress?.({
      status: "generating",
      stage: "Saving",
      progress: 97,
      currentStep: "Saving assets to library...",
    });

    // Save all files (GLB with hand rigging if applied, thumbnail, preview, and optionally VRM)
    const savedFiles = await saveAssetFiles({
      assetId,
      modelBuffer: finalModelBuffer,
      modelFormat: "glb",
      thumbnailBuffer,
      vrmBuffer: finalVrmBuffer,
      previewBuffer, // Untextured preview model (fast-loading)
      metadata: {
        ...metadata,
        meshyTaskId: result.taskId,
        meshyModelUrl: result.modelUrl,
        meshyThumbnailUrl: result.thumbnailUrl,
        hasVRM: !!finalVrmBuffer,
        hasPreview: !!previewBuffer,
        hasHandRigging,
        convertToVRM: config.convertToVRM,
        enableHandRigging: config.enableHandRigging,
        pipeline: config.pipeline,
        quality: config.quality,
        prompt: config.prompt,
        createdAt: new Date().toISOString(),
      },
    });

    onProgress?.({
      status: "completed",
      stage: "Complete",
      progress: 100,
      currentStep: "Generation complete!",
    });

    return {
      taskId: result.taskId,
      modelUrl: result.modelUrl,
      thumbnailUrl: result.thumbnailUrl,
      vrmUrl,
      hasVRM: !!finalVrmBuffer,
      hasHandRigging,
      localModelUrl: savedFiles.modelUrl,
      localVrmUrl: savedFiles.vrmUrl,
      localThumbnailUrl: savedFiles.thumbnailUrl,
      metadata: {
        ...metadata,
        assetId,
        hasVRM: !!finalVrmBuffer,
        hasHandRigging,
      },
    };
  } catch (error) {
    onProgress?.({
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : "Generation failed",
    });
    throw error;
  }
}

/**
 * Generate batch of variations
 */
export async function generateBatch(
  baseConfig: GenerationConfig,
  count: number,
  onProgress?: (progress: GenerationProgress) => void,
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];

  for (let i = 0; i < count; i++) {
    onProgress?.({
      status: "generating",
      progress: Math.floor((i / count) * 100),
      currentStep: `Generating variation ${i + 1} of ${count}...`,
    });

    // Modify prompt slightly for variation
    const variationPrompt = `${baseConfig.prompt} (variation ${i + 1})`;
    const variationConfig = {
      ...baseConfig,
      prompt: variationPrompt,
    };

    try {
      const result = await generate3DModel(variationConfig);
      results.push(result);
    } catch (error) {
      log.error(`Failed to generate variation ${i + 1}:`, error);
      // Continue with other variations
    }
  }

  return results;
}
