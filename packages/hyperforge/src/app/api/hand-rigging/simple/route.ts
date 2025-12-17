/**
 * Simple Hand Rigging API Route
 * Adds hand bones to a GLB model for finger animation support
 *
 * Hand rigging should happen BEFORE VRM conversion in the pipeline:
 * GLB → Hand Rigging → VRM Conversion
 */

// Must import polyfills BEFORE Three.js
import "@/lib/server/three-polyfills";

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";

const log = logger.child("API:hand-rigging");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { glbData, options = {} } = body;

    if (!glbData) {
      return NextResponse.json(
        { error: "GLB data (base64) required" },
        { status: 400 },
      );
    }

    // Import the hand rigging service dynamically (server-side only)
    const { SimpleHandRiggingService } = await import(
      "@/services/hand-rigging/SimpleHandRiggingService"
    );

    // Decode base64 GLB data
    const glbBuffer = Buffer.from(glbData, "base64");

    // Create a Blob URL to pass to the service
    // The service expects a File or URL string
    const glbBlob = new Blob([glbBuffer], { type: "model/gltf-binary" });
    const glbBlobUrl = URL.createObjectURL(glbBlob);

    try {
      // Initialize the service
      const handRiggingService = new SimpleHandRiggingService();

      // Run hand rigging on the GLB
      log.info("🦴 Starting simple hand rigging on GLB...");
      const result = await handRiggingService.rigHands(glbBlobUrl, {
        palmBoneLength: options.palmBoneLength || 300.0,
        fingerBoneLength: options.fingerBoneLength || 400.0,
        debugMode: options.debugMode || false,
      });

      // Clean up blob URL
      URL.revokeObjectURL(glbBlobUrl);

      if (!result.success || !result.riggedModel) {
        return NextResponse.json(
          {
            error: result.error || "Hand rigging failed",
            warnings: [],
          },
          { status: 500 },
        );
      }

      // Convert ArrayBuffer to base64 for response
      const riggedGlbData = Buffer.from(result.riggedModel).toString("base64");

      log.info(
        {
          originalBones: result.metadata.originalBoneCount,
          addedBones: result.metadata.addedBoneCount,
          leftHandBones: result.metadata.leftHandBones?.length || 0,
          rightHandBones: result.metadata.rightHandBones?.length || 0,
        },
        "✅ Hand rigging complete",
      );

      return NextResponse.json({
        success: true,
        riggedGlbData,
        leftHandBones: result.metadata.leftHandBones,
        rightHandBones: result.metadata.rightHandBones,
        metadata: {
          originalBoneCount: result.metadata.originalBoneCount,
          addedBoneCount: result.metadata.addedBoneCount,
        },
        warnings: [],
      });
    } catch (rigError) {
      // Clean up blob URL on error
      URL.revokeObjectURL(glbBlobUrl);
      throw rigError;
    }
  } catch (error) {
    log.error({ error }, "Hand rigging failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Hand rigging failed",
        warnings: [],
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Simple Hand Rigging API",
    description:
      "Adds palm and finger bones to GLB models (before VRM conversion)",
    usage: {
      method: "POST",
      body: {
        glbData: "Base64-encoded GLB file data",
        options: {
          palmBoneLength: "Length of palm bone (default: 300.0)",
          fingerBoneLength: "Length of finger bone (default: 400.0)",
          debugMode: "Enable debug output (default: false)",
        },
      },
      response: {
        riggedGlbData: "Base64-encoded rigged GLB file",
        leftHandBones: "Array of left hand bone names added",
        rightHandBones: "Array of right hand bone names added",
        metadata: {
          originalBoneCount: "Number of bones before rigging",
          addedBoneCount: "Number of bones added",
        },
      },
    },
    pipelineOrder: "GLB → Hand Rigging → VRM Conversion",
  });
}
