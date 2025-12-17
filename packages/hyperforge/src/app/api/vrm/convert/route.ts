/**
 * VRM Conversion API Route
 * Converts GLB models to VRM format for Hyperscape animation
 *
 * This runs server-side as the FINAL step in the pipeline:
 * GLB → Hand Rigging (optional) → VRM Conversion
 *
 * IMPORTANT: Uses texture-preserving conversion that works directly with
 * GLB binary to avoid losing textures during server-side processing.
 *
 * Accepts either:
 * - modelUrl: URL to download the GLB from
 * - glbData: Base64-encoded GLB data (for hand-rigged models in memory)
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelUrl, glbData, avatarName, author } = body;

    if (!modelUrl && !glbData) {
      return NextResponse.json(
        { error: "Either modelUrl or glbData (base64) required" },
        { status: 400 },
      );
    }

    // Import the texture-preserving VRM converter
    const { convertGLBToVRMPreservingTextures } = await import(
      "@/services/vrm/VRMConverter"
    );

    let glbArrayBuffer: ArrayBuffer;

    if (glbData) {
      // Decode from base64
      console.log("🎭 Loading GLB from base64 data...");
      const glbBuffer = Buffer.from(glbData, "base64");
      glbArrayBuffer = glbBuffer.buffer.slice(
        glbBuffer.byteOffset,
        glbBuffer.byteOffset + glbBuffer.byteLength,
      );
    } else {
      // Download from URL
      console.log("🎭 Loading GLB from URL:", modelUrl);
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch GLB: ${response.statusText}`);
      }
      glbArrayBuffer = await response.arrayBuffer();
    }

    console.log(
      `🎭 GLB loaded: ${(glbArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`,
    );

    // Convert to VRM using texture-preserving method
    console.log("🎭 Converting to VRM format (preserving textures)...");
    const vrmResult = await convertGLBToVRMPreservingTextures(glbArrayBuffer, {
      avatarName: avatarName || "Generated Avatar",
      author: author || "HyperForge",
      version: "1.0",
    });

    // Return VRM as base64
    const vrmBase64 = Buffer.from(vrmResult.vrmData).toString("base64");
    const vrmDataUrl = `data:model/gltf-binary;base64,${vrmBase64}`;

    return NextResponse.json({
      success: true,
      vrmDataUrl,
      vrmData: vrmBase64, // Base64 encoded ArrayBuffer
      boneMappings: Object.fromEntries(vrmResult.boneMappings),
      warnings: vrmResult.warnings,
      coordinateSystemFixed: vrmResult.coordinateSystemFixed,
    });
  } catch (error) {
    console.error("[API] VRM conversion failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "VRM conversion failed",
      },
      { status: 500 },
    );
  }
}
