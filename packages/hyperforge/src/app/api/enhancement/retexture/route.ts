/**
 * Retexture API Route
 * Creates new texture variants of existing 3D models using Meshy API
 */

import { NextRequest, NextResponse } from "next/server";
import { createRetextureTask } from "@/lib/meshy/client";
import { pollTaskStatus } from "@/lib/meshy/poll-task";
import {
  getAssetById,
  createAsset,
  updateAssetPaths,
} from "@/lib/db/asset-queries";
import { downloadAndSaveModel } from "@/lib/storage/asset-storage";
import { logger } from "@/lib/utils";

const log = logger.child("API:retexture");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetId, styleType, textPrompt, imageUrl, artStyle, outputName } =
      body;

    if (!assetId) {
      return NextResponse.json({ error: "Asset ID required" }, { status: 400 });
    }

    if (styleType === "text" && !textPrompt) {
      return NextResponse.json(
        { error: "Text prompt required for text style type" },
        { status: 400 },
      );
    }

    if (styleType === "image" && !imageUrl) {
      return NextResponse.json(
        { error: "Image URL required for image style type" },
        { status: 400 },
      );
    }

    // Get the source asset
    const sourceAsset = await getAssetById(assetId);
    if (!sourceAsset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Get Meshy task ID or model URL from asset metadata
    const generationParams = sourceAsset.generationParams as Record<
      string,
      unknown
    > | null;
    const meshyTaskId = generationParams?.meshyTaskId as string | undefined;
    const modelUrl =
      sourceAsset.cdnUrl || (generationParams?.modelUrl as string | undefined);

    if (!meshyTaskId && !modelUrl) {
      return NextResponse.json(
        {
          error:
            "Asset does not have a Meshy task ID or model URL for retexturing",
        },
        { status: 400 },
      );
    }

    log.info({ assetId }, "Starting retexture");

    // Create retexture task
    const taskId = await createRetextureTask({
      input_task_id: meshyTaskId,
      model_url: meshyTaskId ? undefined : modelUrl,
      text_style_prompt: styleType === "text" ? textPrompt : undefined,
      image_style_url: styleType === "image" ? imageUrl : undefined,
      art_style: artStyle || "realistic",
      ai_model: "meshy-5",
      enable_original_uv: true,
    });

    log.debug({ taskId }, "Retexture task started");

    // Poll for completion
    const result = await pollTaskStatus(taskId, {
      pollIntervalMs: 5000,
      timeoutMs: 600000, // 10 minutes for retexture
      onProgress: (progress, precedingTasks) => {
        log.debug({ progress, precedingTasks }, "Retexture progress");
      },
    });

    log.info({ modelUrl: result.modelUrl }, "Retexture completed");

    // Generate variant name
    const styleSuffix =
      styleType === "text"
        ? textPrompt.slice(0, 20).replace(/\s+/g, "-").toLowerCase()
        : "image-style";
    const variantName = outputName || `${sourceAsset.name}-${styleSuffix}`;

    // Create new asset record for variant
    const newAsset = await createAsset({
      name: variantName,
      description: `Retextured variant of ${sourceAsset.name}`,
      type: sourceAsset.type,
      category: sourceAsset.category || undefined,
      tags: [...(sourceAsset.tags || []), "variant", "retextured"],
      prompt: styleType === "text" ? textPrompt : undefined,
      generationParams: {
        meshyTaskId: taskId,
        modelUrl: result.modelUrl,
        sourceAssetId: assetId,
        styleType,
        textPrompt: styleType === "text" ? textPrompt : undefined,
        imageStyleUrl: styleType === "image" ? imageUrl : undefined,
        artStyle: artStyle || "realistic",
      },
      aiModel: "meshy-5",
      status: "completed",
      parentAssetId: assetId,
    });

    // Download and save the retextured model
    const savedFiles = await downloadAndSaveModel(
      newAsset.id,
      result.modelUrl,
      result.thumbnailUrl,
      {
        name: variantName,
        type: sourceAsset.type,
        sourceAssetId: assetId,
        meshyTaskId: taskId,
        retexturedAt: new Date().toISOString(),
      },
    );

    // Update asset with file paths
    await updateAssetPaths(
      newAsset.id,
      savedFiles.modelPath,
      savedFiles.thumbnailPath,
    );

    return NextResponse.json({
      success: true,
      assetId: newAsset.id,
      name: variantName,
      taskId,
      modelUrl: savedFiles.modelUrl,
      thumbnailUrl: savedFiles.thumbnailUrl,
      message: "Asset retextured successfully",
    });
  } catch (error) {
    log.error({ error }, "Retexture failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Retexture failed",
      },
      { status: 500 },
    );
  }
}
