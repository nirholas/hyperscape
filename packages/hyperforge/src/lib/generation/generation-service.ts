/**
 * Generation Service
 * Unified orchestrator for all generation types (3D, Audio, Content)
 */

import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";
import {
  startTextTo3DPreview,
  startTextTo3DRefine,
} from "@/lib-core/meshy/text-to-3d";
import { startImageTo3D } from "@/lib-core/meshy/image-to-3d";
import {
  pollTaskStatus as pollTaskStatusUnified,
  type TextureUrls,
} from "@/lib-core/meshy/poll-task";
import {
  createRiggingTask,
  getRiggingTaskStatus,
} from "@/lib-core/meshy/client";
import type { GenerationProgress } from "@/stores/generation-store";
import {
  downloadAndSaveModel,
  saveAssetFiles,
  downloadFile,
} from "@/lib/storage/asset-storage";
import { enhancePromptWithGPT4 } from "@/lib/ai/openai-service";
import { generateConceptArt } from "@/lib/ai/concept-art-service";

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
  const qualityOptions = {
    // Preview / Meshy-4: Fast, lower quality (for quick iterations)
    preview: {
      targetPolycount: 10000,
      textureResolution: 1024,
      enablePBR: true,
      aiModel: "meshy-4",
      textureRichness: "medium",
    },
    // Medium / Meshy-6: High quality with latest model
    medium: {
      targetPolycount: 30000,
      textureResolution: 2048,
      enablePBR: true,
      aiModel: "latest", // Meshy-6 - best quality
      textureRichness: "high",
    },
    // High / Meshy-6: Maximum quality settings
    high: {
      targetPolycount: 50000,
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
        console.log("[Generation] Enhanced prompt:", effectivePrompt);
      } else {
        console.warn("[Generation] Prompt enhancement failed, using original");
      }
    }

    // Stage 1: Get texture reference image (custom upload or AI-generated concept art)
    let textureImageUrl: string | undefined;

    // Priority: 1. Custom HTTP URL, 2. Custom data URL, 3. AI-generated concept art
    if (config.referenceImageUrl) {
      // User provided a custom reference image URL (already uploaded)
      textureImageUrl = config.referenceImageUrl;
      console.log(
        "[Generation] Using custom reference image URL:",
        textureImageUrl,
      );

      onProgress?.({
        status: "generating",
        stage: "Reference Image",
        progress: 3,
        currentStep: "Using custom reference image for texturing...",
      });
    } else if (config.referenceImageDataUrl) {
      // User provided a data URL - Meshy may not accept data URLs, log a warning
      console.warn(
        "[Generation] Reference image provided as data URL. Meshy may require HTTP URL.",
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
          console.log("[Generation] Concept art generated successfully");
        } else {
          console.warn(
            "[Generation] Concept art generation failed, continuing without",
          );
        }
      } catch (error) {
        console.warn("[Generation] Concept art error:", error);
        // Continue without concept art
      }
    } else {
      console.log(
        "[Generation] No texture reference image - using text prompt only",
      );
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
      console.log("[Generation] Preview model URL:", previewModelUrl);

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
        console.warn(
          "[Generation] texture_image_url must be HTTP/HTTPS URL, data URLs not supported by Meshy. Using texture_prompt only.",
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
            height_meters: 1.7, // Standard adult human height
          });

          console.log(
            "[Generation] Started Meshy rigging task with input_task_id:",
            refineResult.taskId,
          );
          console.log("[Generation] Rigging task ID:", riggingTaskId);

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
            console.log("[Generation] Meshy rigging completed successfully");
            console.log("[Generation] Rigged model URL:", riggedModelUrl);
            result = {
              taskId: riggingTaskId,
              modelUrl: riggedModelUrl,
              thumbnailUrl: refineResult.thumbnailUrl,
              // Also keep textured model info for fallback if rigged model has no textures
              texturedModelUrl,
              textureUrls,
            };
          } else {
            console.warn(
              "[Generation] Meshy rigging failed with status:",
              riggingStatus.status,
            );
            console.warn(
              "[Generation] Rigging error details:",
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
          console.error("[Generation] Meshy rigging error:", riggingError);
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
    console.log("[Generation] Downloading model from:", result.modelUrl);
    const modelBuffer = await downloadFile(result.modelUrl);
    console.log(
      `[Generation] Downloaded model: ${(modelBuffer.length / 1024 / 1024).toFixed(2)} MB`,
    );

    // Download the original textured model if different from main model (rigging may strip textures)
    let texturedModelBuffer: Buffer | undefined;
    if (
      result.texturedModelUrl &&
      result.texturedModelUrl !== result.modelUrl
    ) {
      try {
        console.log(
          "[Generation] Downloading original textured model from:",
          result.texturedModelUrl,
        );
        texturedModelBuffer = await downloadFile(result.texturedModelUrl);
        console.log(
          `[Generation] Downloaded textured model: ${(texturedModelBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        );
      } catch (error) {
        console.warn("[Generation] Failed to download textured model:", error);
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
            console.log(
              `[Generation] Downloaded base_color texture: ${(buffer.length / 1024).toFixed(1)} KB`,
            );
          } catch (e) {
            console.warn(
              "[Generation] Failed to download base_color texture:",
              e,
            );
          }
        }

        // Download PBR textures if available
        if (textureSet.metallic) {
          try {
            const buffer = await downloadFile(textureSet.metallic);
            textureBuffers.push({ name: "metallic.png", buffer });
          } catch (e) {
            console.warn(
              "[Generation] Failed to download metallic texture:",
              e,
            );
          }
        }

        if (textureSet.roughness) {
          try {
            const buffer = await downloadFile(textureSet.roughness);
            textureBuffers.push({ name: "roughness.png", buffer });
          } catch (e) {
            console.warn(
              "[Generation] Failed to download roughness texture:",
              e,
            );
          }
        }

        if (textureSet.normal) {
          try {
            const buffer = await downloadFile(textureSet.normal);
            textureBuffers.push({ name: "normal.png", buffer });
          } catch (e) {
            console.warn("[Generation] Failed to download normal texture:", e);
          }
        }
      }

      console.log(
        `[Generation] Downloaded ${textureBuffers.length} separate texture files`,
      );
    }

    // Download preview model if available (untextured, fast-loading version)
    // previewModelUrl is only set for text-to-3d pipeline
    let previewBuffer: Buffer | undefined;
    if (previewModelUrl) {
      try {
        console.log(
          "[Generation] Downloading preview model from:",
          previewModelUrl,
        );
        previewBuffer = await downloadFile(previewModelUrl);
        console.log(
          `[Generation] Downloaded preview model: ${(previewBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        );
      } catch (error) {
        console.warn("[Generation] Failed to download preview model:", error);
      }
    }

    // Download thumbnail
    let thumbnailBuffer: Buffer | undefined;
    if (result.thumbnailUrl) {
      try {
        thumbnailBuffer = await downloadFile(result.thumbnailUrl);
      } catch {
        console.warn("Failed to download thumbnail");
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
    let processedModelBuffer = modelBuffer;
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
              glbData: modelBuffer.toString("base64"),
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
            console.log("✅ Hand rigging complete:", {
              leftHandBones: handRigData.leftHandBones?.length || 0,
              rightHandBones: handRigData.rightHandBones?.length || 0,
            });
          }

          if (handRigData.warnings && handRigData.warnings.length > 0) {
            console.warn("Hand rigging warnings:", handRigData.warnings);
          }
        } else {
          console.error("Hand rigging failed:", await handRigResponse.text());
          // Don't fail - continue with original GLB
        }
      } catch (error) {
        console.error("Hand rigging error:", error);
        // Don't fail the whole generation if hand rigging fails
      }
    }

    // Step 2: VRM conversion (always last in pipeline, if enabled)
    // IMPORTANT: Use the TEXTURED model for VRM conversion because:
    // - Meshy rigging strips textures from the model
    // - VRM needs textures for proper visual rendering
    // - The textured model from refine stage has embedded textures
    let vrmUrl: string | undefined;
    let vrmBuffer: Buffer | undefined;
    const shouldConvertToVRM =
      config.convertToVRM &&
      (config.category === "npc" || config.category === "character");

    if (shouldConvertToVRM) {
      try {
        onProgress?.({
          status: "generating",
          stage: "VRM Conversion",
          progress: 95,
          currentStep: "Converting to VRM format...",
        });

        // Determine which model to use for VRM conversion:
        // Priority: 1. Textured model (has textures), 2. Processed model (may have hand rigging)
        // We prefer textured model because VRM needs good visual quality
        const useTexturedForVRM =
          texturedModelBuffer && texturedModelBuffer.length > 0;
        const vrmSourceBuffer = useTexturedForVRM
          ? texturedModelBuffer
          : processedModelBuffer;
        const vrmSourceUrl = useTexturedForVRM
          ? result.texturedModelUrl
          : hasHandRigging
            ? undefined
            : result.modelUrl;

        console.log(
          `[Generation] VRM conversion using: ${useTexturedForVRM ? "textured model (with textures)" : "rigged/processed model"}`,
        );

        // Call VRM conversion API with the best available model
        const vrmResponse = await fetch(`${baseUrl}/api/vrm/convert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Use buffer if available (prefer textured), otherwise fall back to URL
            glbData: vrmSourceBuffer
              ? vrmSourceBuffer.toString("base64")
              : undefined,
            modelUrl: vrmSourceBuffer ? undefined : vrmSourceUrl,
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
            console.warn("VRM conversion warnings:", vrmData.warnings);
          }
        } else {
          console.error("VRM conversion failed:", await vrmResponse.text());
          // Don't fail the whole generation if VRM conversion fails
        }
      } catch (error) {
        console.error("VRM conversion error:", error);
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
      console.error(`Failed to generate variation ${i + 1}:`, error);
      // Continue with other variations
    }
  }

  return results;
}
