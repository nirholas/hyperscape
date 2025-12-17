import { NextRequest, NextResponse } from "next/server";
import {
  generate3DModel,
  generateBatch,
} from "@/lib/generation/generation-service";
import { generateConceptArt } from "@/lib/ai/concept-art-service";
import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";
import { logger } from "@/lib/utils";

const log = logger.child("API:generation");

// Enable streaming responses
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, config, count, stream } = body;

    // Generate concept art preview (before 3D generation)
    if (action === "generate-concept-art") {
      if (!config?.prompt) {
        return NextResponse.json(
          { error: "Prompt required for concept art generation" },
          { status: 400 },
        );
      }

      const result = await generateConceptArt(config.prompt, {
        style: config.style || "stylized",
        viewAngle: config.viewAngle || "isometric",
        background: "simple",
        assetType: config.assetType || "item",
      });

      if (!result) {
        return NextResponse.json(
          { error: "Concept art generation failed" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        conceptArtUrl: result.imageUrl,
        previewUrl: result.dataUrl,
      });
    }

    if (action === "generate") {
      if (!config) {
        return NextResponse.json(
          { error: "Generation config required" },
          { status: 400 },
        );
      }

      // If streaming requested, use SSE
      if (stream) {
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              const result = await generate3DModel(
                config as GenerationConfig,
                (progress) => {
                  // Send progress update via SSE
                  const data = JSON.stringify({
                    type: "progress",
                    ...progress,
                  });
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                },
              );

              // Send final result
              const finalData = JSON.stringify({
                type: "complete",
                result,
              });
              controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
              controller.close();
            } catch (error) {
              const errorData = JSON.stringify({
                type: "error",
                error:
                  error instanceof Error ? error.message : "Generation failed",
              });
              controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming: wait for completion and return result
      const result = await generate3DModel(config as GenerationConfig);
      return NextResponse.json(result);
    }

    if (action === "batch") {
      if (!config || !count) {
        return NextResponse.json(
          { error: "Config and count required for batch generation" },
          { status: 400 },
        );
      }

      const results = await generateBatch(
        config as GenerationConfig,
        count as number,
      );
      return NextResponse.json({ results });
    }

    if (action === "status") {
      // TODO: Implement status polling endpoint
      return NextResponse.json({ status: "not_implemented" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    log.error({ error }, "Generation failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Generation failed",
      },
      { status: 500 },
    );
  }
}
