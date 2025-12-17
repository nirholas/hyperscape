import { NextRequest, NextResponse } from "next/server";
import {
  createImageTo3DTask,
  createTextTo3DPreviewTask,
  createTextTo3DRefineTask,
  getTaskStatus,
} from "@/lib/meshy/client";
import { logger } from "@/lib/utils";

const log = logger.child("API:meshy");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    if (action === "image-to-3d") {
      const task = await createImageTo3DTask({
        image_url: params.imageUrl,
        enable_pbr: params.enablePBR,
        ai_model: params.aiModel,
        topology: params.topology,
        target_polycount: params.targetPolycount,
        texture_resolution: params.textureResolution,
      });

      return NextResponse.json(task);
    }

    if (action === "text-to-3d-preview") {
      // Stage 1: Create preview task (generates mesh without texture)
      const taskId = await createTextTo3DPreviewTask({
        prompt: params.prompt,
        ai_model: params.aiModel ?? "latest",
        topology: params.topology ?? "triangle",
        target_polycount: params.targetPolycount ?? 30000,
        art_style: params.artStyle ?? "realistic",
        symmetry_mode: params.symmetryMode ?? "auto",
        pose_mode: params.poseMode ?? "",
        seed: params.seed,
      });

      return NextResponse.json({ taskId, stage: "preview" });
    }

    if (action === "text-to-3d-refine") {
      // Stage 2: Create refine task (adds texture to preview mesh)
      if (!params.previewTaskId) {
        return NextResponse.json(
          { error: "previewTaskId is required for refine stage" },
          { status: 400 },
        );
      }

      const taskId = await createTextTo3DRefineTask(params.previewTaskId, {
        prompt: "", // Not used in refine stage
        enable_pbr: params.enablePBR ?? true,
        texture_resolution: params.textureResolution ?? 2048,
        texture_prompt: params.texturePrompt,
        texture_image_url: params.textureImageUrl,
      });

      return NextResponse.json({ taskId, stage: "refine" });
    }

    if (action === "status") {
      const task = await getTaskStatus(params.taskId);
      return NextResponse.json(task);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    log.error({ error }, "Meshy request failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Meshy request failed",
      },
      { status: 500 },
    );
  }
}
