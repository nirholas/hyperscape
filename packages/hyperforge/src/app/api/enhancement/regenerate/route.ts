/**
 * Regenerate API Route
 * Creates variations of existing assets using same/modified prompts
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAssetById,
  createAsset,
  updateAssetPaths,
  updateAssetStatus,
} from "@/lib/db/asset-queries";
import { downloadAndSaveModel } from "@/lib/storage/asset-storage";
import {
  startTextTo3DPreview,
  startTextTo3DRefine,
} from "@/lib/meshy/text-to-3d";
import { startImageTo3D } from "@/lib/meshy/image-to-3d";
import { pollTaskStatus } from "@/lib/meshy/poll-task";
import type { MeshyAIModel } from "@/lib/meshy/types";
import { logger } from "@/lib/utils";

const log = logger.child("API:regenerate");

/**
 * Modify prompt based on variation strength
 * Lower strength = subtle changes, Higher strength = more creative
 */
function modifyPrompt(
  originalPrompt: string,
  variationStrength: number,
  customPrompt?: string,
): string {
  if (customPrompt) {
    // Blend custom prompt with original based on strength
    if (variationStrength >= 80) {
      return customPrompt;
    } else if (variationStrength >= 50) {
      return `${customPrompt}, inspired by: ${originalPrompt}`;
    } else {
      return `${originalPrompt}, with elements of: ${customPrompt}`;
    }
  }

  // Auto-variation modifiers based on strength
  const variations = [
    "", // 0-20: No change
    ", slight variation", // 21-40
    ", alternative interpretation", // 41-60
    ", reimagined", // 61-80
    ", creative new take on", // 81-100
  ];

  const index = Math.min(Math.floor(variationStrength / 20), 4);
  const modifier = variations[index];

  if (modifier && variationStrength > 20) {
    return `${originalPrompt}${modifier} (variation ${Math.random().toString(36).slice(2, 6)})`;
  }

  return originalPrompt;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetId, prompt: customPrompt, variationStrength = 50 } = body;

    if (!assetId) {
      return NextResponse.json({ error: "Asset ID required" }, { status: 400 });
    }

    // Get the source asset
    const sourceAsset = await getAssetById(assetId);
    if (!sourceAsset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Get original generation parameters
    const generationParams = sourceAsset.generationParams as Record<
      string,
      unknown
    > | null;
    const originalPrompt =
      sourceAsset.prompt || (generationParams?.prompt as string) || "";
    const pipeline =
      (generationParams?.pipeline as "text-to-3d" | "image-to-3d") ||
      "text-to-3d";
    const quality =
      (generationParams?.quality as "standard" | "high" | "ultra") || "high";
    const imageUrl = generationParams?.imageUrl as string | undefined;

    if (!originalPrompt && pipeline === "text-to-3d") {
      return NextResponse.json(
        { error: "Source asset has no prompt for regeneration" },
        { status: 400 },
      );
    }

    if (pipeline === "image-to-3d" && !imageUrl) {
      return NextResponse.json(
        { error: "Source asset has no image URL for regeneration" },
        { status: 400 },
      );
    }

    log.info({ assetId, variationStrength }, "Starting regeneration");

    // Create new asset record first
    const modifiedPrompt = modifyPrompt(
      originalPrompt,
      variationStrength,
      customPrompt,
    );
    const variantNumber = Date.now().toString(36).slice(-4);
    const variantName = `${sourceAsset.name}-v${variantNumber}`;

    const newAsset = await createAsset({
      name: variantName,
      description: `Variation of ${sourceAsset.name} (${variationStrength}% strength)`,
      type: sourceAsset.type,
      category: sourceAsset.category || undefined,
      tags: [...(sourceAsset.tags || []), "variant", "regenerated"],
      prompt: modifiedPrompt,
      generationParams: {
        pipeline,
        quality,
        originalPrompt,
        modifiedPrompt,
        variationStrength,
        imageUrl: pipeline === "image-to-3d" ? imageUrl : undefined,
        sourceAssetId: assetId,
      },
      aiModel: (generationParams?.aiModel as string) || "meshy-5",
      status: "processing",
      parentAssetId: assetId,
    });

    // Quality settings with properly typed AI models
    const qualityOptions: Record<
      string,
      {
        targetPolycount: number;
        textureResolution: number;
        enablePBR: boolean;
        aiModel: MeshyAIModel;
      }
    > = {
      standard: {
        targetPolycount: 6000,
        textureResolution: 1024,
        enablePBR: false,
        aiModel: "meshy-4",
      },
      high: {
        targetPolycount: 12000,
        textureResolution: 2048,
        enablePBR: true,
        aiModel: "meshy-5",
      },
      ultra: {
        targetPolycount: 20000,
        textureResolution: 4096,
        enablePBR: true,
        aiModel: "meshy-5",
      },
    };
    const options = qualityOptions[quality];

    let modelUrl: string;
    let thumbnailUrl: string | undefined;
    let meshyTaskId: string;

    try {
      if (pipeline === "text-to-3d") {
        // Two-stage text-to-3D
        log.debug("Starting text-to-3D preview");
        const { previewTaskId } = await startTextTo3DPreview(modifiedPrompt, {
          ai_model: options.aiModel,
          topology: "triangle",
          target_polycount: options.targetPolycount,
          art_style: "realistic",
        });

        // Poll preview completion
        await pollTaskStatus(previewTaskId, {
          pollIntervalMs: 5000,
          timeoutMs: 300000,
          onProgress: (progress) => {
            log.debug({ progress }, "Preview progress");
          },
        });

        log.debug("Starting text-to-3D refine");
        const { refineTaskId } = await startTextTo3DRefine(previewTaskId, {
          enable_pbr: options.enablePBR,
          texture_resolution: options.textureResolution,
        });

        // Poll refine completion
        const result = await pollTaskStatus(refineTaskId, {
          pollIntervalMs: 5000,
          timeoutMs: 300000,
          onProgress: (progress) => {
            log.debug({ progress }, "Refine progress");
          },
        });

        modelUrl = result.modelUrl;
        thumbnailUrl = result.thumbnailUrl;
        meshyTaskId = refineTaskId;
      } else {
        // Image-to-3D
        log.debug("Starting image-to-3D");
        const { taskId } = await startImageTo3D(imageUrl!, {
          enable_pbr: options.enablePBR,
          ai_model: options.aiModel,
          topology: "quad",
          target_polycount: options.targetPolycount,
          texture_resolution: options.textureResolution,
        });

        const result = await pollTaskStatus(taskId, {
          pollIntervalMs: 5000,
          timeoutMs: 300000,
          onProgress: (progress) => {
            log.debug({ progress }, "Image-to-3D progress");
          },
        });

        modelUrl = result.modelUrl;
        thumbnailUrl = result.thumbnailUrl;
        meshyTaskId = taskId;
      }

      log.info({ modelUrl }, "Regeneration completed");

      // Download and save the model
      const savedFiles = await downloadAndSaveModel(
        newAsset.id,
        modelUrl,
        thumbnailUrl,
        {
          name: variantName,
          type: sourceAsset.type,
          sourceAssetId: assetId,
          meshyTaskId,
          prompt: modifiedPrompt,
          variationStrength,
          regeneratedAt: new Date().toISOString(),
        },
      );

      // Update asset with file paths and completed status
      await updateAssetPaths(
        newAsset.id,
        savedFiles.modelPath,
        savedFiles.thumbnailPath,
      );
      await updateAssetStatus(newAsset.id, "completed");

      return NextResponse.json({
        success: true,
        assetId: newAsset.id,
        name: variantName,
        taskId: meshyTaskId,
        modelUrl: savedFiles.modelUrl,
        thumbnailUrl: savedFiles.thumbnailUrl,
        prompt: modifiedPrompt,
        variationStrength,
        message: "Asset regenerated successfully",
      });
    } catch (generationError) {
      // Update asset status to failed
      await updateAssetStatus(newAsset.id, "failed");
      throw generationError;
    }
  } catch (error) {
    log.error({ error }, "Regeneration failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Regeneration failed",
      },
      { status: 500 },
    );
  }
}
