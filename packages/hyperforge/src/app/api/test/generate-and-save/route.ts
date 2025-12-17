import { NextRequest, NextResponse } from "next/server";
import {
  createTextTo3DPreviewTask,
  createTextTo3DRefineTask,
  getTaskStatus,
} from "@/lib/meshy/client";
import { downloadAndSaveModel } from "@/lib/storage/asset-storage";
import { logger } from "@/lib/utils";

const routeLogger = logger.child("API:test/generate-and-save");

/**
 * Test endpoint to generate a 3D model and save it locally
 * POST /api/test/generate-and-save
 *
 * This demonstrates the full generation flow:
 * 1. Create preview task with Meshy
 * 2. Poll for preview completion
 * 3. Create refine task
 * 4. Poll for refine completion
 * 5. Download and save model locally
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const logs: string[] = [];

  function logStep(message: string) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const entry = `[${elapsed}s] ${message}`;
    logs.push(entry);
    routeLogger.info(entry);
  }

  try {
    const body = await request.json();
    const {
      name = "Bronze Longsword",
      prompt = "A bronze longsword, low-poly RuneScape 2007 style, game-ready 3D asset, medieval fantasy weapon with bronze metal texture",
      skipGeneration = false, // For testing save flow without waiting
    } = body;

    logStep(`Starting generation for: ${name}`);
    logStep(`Prompt: ${prompt}`);

    // Generate unique asset ID
    const assetId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    logStep(`Asset ID: ${assetId}`);

    let modelUrl = "";
    let thumbnailUrl: string | undefined;

    if (skipGeneration) {
      // Use a placeholder for testing
      logStep("Skipping generation (test mode)");
      modelUrl = "https://assets.meshy.ai/sample/sample.glb";
      thumbnailUrl = undefined;
    } else {
      // Step 1: Create preview task
      logStep("Creating preview task...");
      const previewTaskId = await createTextTo3DPreviewTask({
        prompt,
        art_style: "realistic",
        ai_model: "meshy-4",
        topology: "triangle",
        target_polycount: 10000,
      });
      logStep(`Preview task created: ${previewTaskId}`);

      // Step 2: Poll for preview completion
      logStep("Polling preview status...");
      let previewComplete = false;
      let pollCount = 0;
      const maxPolls = 60; // 5 minutes max

      while (!previewComplete && pollCount < maxPolls) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        pollCount++;

        const status = await getTaskStatus(previewTaskId);
        logStep(`Preview status: ${status.status} (poll ${pollCount})`);

        if (status.status === "SUCCEEDED") {
          previewComplete = true;
          logStep("Preview completed!");
        } else if (
          status.status === "FAILED" ||
          (status.status as string) === "EXPIRED"
        ) {
          throw new Error(`Preview failed: ${status.status}`);
        }
      }

      if (!previewComplete) {
        throw new Error("Preview timed out");
      }

      // Step 3: Create refine task
      logStep("Creating refine task...");
      const refineTaskId = await createTextTo3DRefineTask(previewTaskId, {
        prompt,
        enable_pbr: true,
        texture_resolution: 2048,
      });
      logStep(`Refine task created: ${refineTaskId}`);

      // Step 4: Poll for refine completion
      logStep("Polling refine status...");
      let refineComplete = false;
      pollCount = 0;

      while (!refineComplete && pollCount < maxPolls) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        pollCount++;

        const status = await getTaskStatus(refineTaskId);
        logStep(`Refine status: ${status.status} (poll ${pollCount})`);

        if (status.status === "SUCCEEDED") {
          refineComplete = true;
          modelUrl = status.model_urls?.glb || "";
          thumbnailUrl = status.thumbnail_url;
          logStep(`Refine completed! Model URL: ${modelUrl}`);
        } else if (
          status.status === "FAILED" ||
          (status.status as string) === "EXPIRED"
        ) {
          throw new Error(`Refine failed: ${status.status}`);
        }
      }

      if (!refineComplete) {
        throw new Error("Refine timed out");
      }
    }

    if (!modelUrl) {
      throw new Error("No model URL available");
    }

    // Step 5: Download and save locally
    logStep("Downloading and saving model...");
    const savedFiles = await downloadAndSaveModel(
      assetId,
      modelUrl!,
      thumbnailUrl,
      {
        name,
        prompt,
        source: "LOCAL",
        category: "weapon",
        type: "weapon",
        status: "completed",
        createdAt: new Date().toISOString(),
        generationType: "item",
        gameStyle: "runescape",
        meshyModelUrl: modelUrl,
      },
    );
    logStep(`Model saved! Path: ${savedFiles.modelPath}`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logStep(`Total time: ${totalTime}s`);

    return NextResponse.json({
      success: true,
      assetId,
      name,
      files: savedFiles,
      logs,
      totalTimeSeconds: parseFloat(totalTime),
    });
  } catch (error) {
    logStep(
      `ERROR: ${error instanceof Error ? error.message : "Unknown error"}`,
    );

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Generation failed",
        logs,
      },
      { status: 500 },
    );
  }
}

/**
 * GET - Quick test to check if the API is working
 */
export async function GET() {
  return NextResponse.json({
    status: "ready",
    message:
      "POST to this endpoint with { name, prompt } to generate and save a 3D model",
    example: {
      name: "Bronze Longsword",
      prompt:
        "A bronze longsword, low-poly RuneScape 2007 style, game-ready 3D asset",
    },
  });
}
