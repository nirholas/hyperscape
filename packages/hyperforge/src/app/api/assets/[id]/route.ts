/**
 * Asset API Route
 * Handles individual asset operations (GET, DELETE, etc.)
 */

import { NextResponse } from "next/server";
import {
  deleteAssetFiles,
  assetExists,
  readAssetMetadata,
  readAssetModel,
  readAssetThumbnail,
} from "@/lib/storage/asset-storage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/assets/[id]
 * Get asset metadata
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;

    if (!assetId) {
      return NextResponse.json({ error: "Asset ID is required" }, { status: 400 });
    }

    // Check if asset exists
    const exists = await assetExists(assetId);
    if (!exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Get metadata
    const metadata = await readAssetMetadata(assetId);

    return NextResponse.json({
      success: true,
      assetId,
      metadata,
    });
  } catch (error) {
    console.error("[Assets API] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get asset" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/assets/[id]
 * Delete an asset and all its files
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;

    if (!assetId) {
      return NextResponse.json({ error: "Asset ID is required" }, { status: 400 });
    }

    // Check if asset exists
    const exists = await assetExists(assetId);
    if (!exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Get metadata before deleting (for response)
    const metadata = await readAssetMetadata(assetId);

    // Delete all asset files
    await deleteAssetFiles(assetId);

    console.log(`[Assets API] Deleted asset: ${assetId}`);

    return NextResponse.json({
      success: true,
      message: "Asset deleted successfully",
      assetId,
      deletedAsset: metadata,
    });
  } catch (error) {
    console.error("[Assets API] DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete asset" },
      { status: 500 }
    );
  }
}
