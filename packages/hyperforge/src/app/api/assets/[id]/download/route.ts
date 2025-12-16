/**
 * Asset Download Route
 * Serves asset files for download
 */

import { NextResponse } from "next/server";
import {
  assetExists,
  readAssetModel,
  getModelPath,
} from "@/lib/storage/asset-storage";
import { promises as fs } from "fs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/assets/[id]/download
 * Download an asset's model file
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "glb";

    if (!assetId) {
      return NextResponse.json({ error: "Asset ID is required" }, { status: 400 });
    }

    // Check if asset exists
    const exists = await assetExists(assetId);
    if (!exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Try to read the model in the requested format
    let modelBuffer: Buffer;
    let actualFormat = format;

    try {
      modelBuffer = await readAssetModel(assetId, format);
    } catch {
      // If requested format not found, try other formats
      const formats = ["glb", "vrm", "gltf"];
      let found = false;
      
      for (const fmt of formats) {
        if (fmt === format) continue;
        try {
          const modelPath = getModelPath(assetId, fmt);
          await fs.access(modelPath);
          modelBuffer = await readAssetModel(assetId, fmt);
          actualFormat = fmt;
          found = true;
          break;
        } catch {
          // Try next format
        }
      }

      if (!found) {
        return NextResponse.json(
          { error: `Model file not found for asset: ${assetId}` },
          { status: 404 }
        );
      }
    }

    // Set appropriate content type
    const contentTypes: Record<string, string> = {
      glb: "model/gltf-binary",
      vrm: "model/gltf-binary",
      gltf: "model/gltf+json",
    };

    const contentType = contentTypes[actualFormat] || "application/octet-stream";
    const filename = `${assetId}.${actualFormat}`;

    return new NextResponse(modelBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": modelBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("[Assets Download API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to download asset" },
      { status: 500 }
    );
  }
}
