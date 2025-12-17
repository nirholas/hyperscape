/**
 * Asset Duplicate Route
 * Creates a copy of an existing asset
 */

import { NextResponse } from "next/server";
import {
  assetExists,
  copyAssetFiles,
  readAssetMetadata,
  getMetadataPath,
} from "@/lib/storage/asset-storage";
import { promises as fs } from "fs";
import { logger } from "@/lib/utils";

const log = logger.child("API:assets:duplicate");

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Generate a unique asset ID based on source
 */
function generateDuplicateId(sourceId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${sourceId}-copy-${timestamp}-${random}`;
}

/**
 * POST /api/assets/[id]/duplicate
 * Create a copy of an asset
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: sourceAssetId } = await params;

    if (!sourceAssetId) {
      return NextResponse.json(
        { error: "Source asset ID is required" },
        { status: 400 }
      );
    }

    // Check if source asset exists
    const exists = await assetExists(sourceAssetId);
    if (!exists) {
      return NextResponse.json({ error: "Source asset not found" }, { status: 404 });
    }

    // Generate new asset ID
    const newAssetId = generateDuplicateId(sourceAssetId);

    // Copy all files
    const files = await copyAssetFiles(sourceAssetId, newAssetId);

    // Read source metadata and update it for the new asset
    const sourceMetadata = await readAssetMetadata(sourceAssetId);
    let newMetadata = sourceMetadata;

    if (sourceMetadata) {
      newMetadata = {
        ...sourceMetadata,
        id: newAssetId,
        name: `${sourceMetadata.name || sourceAssetId} (Copy)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceAssetId, // Track the original
      };

      // Save updated metadata
      const metadataPath = getMetadataPath(newAssetId);
      await fs.writeFile(metadataPath, JSON.stringify(newMetadata, null, 2));
    }

    log.info("Duplicated asset", { sourceAssetId, newAssetId });

    return NextResponse.json({
      success: true,
      message: "Asset duplicated successfully",
      asset: {
        id: newAssetId,
        name: newMetadata?.name || `${sourceAssetId} (Copy)`,
        ...files,
        metadata: newMetadata,
      },
    });
  } catch (error) {
    log.error("Duplicate error", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to duplicate asset" },
      { status: 500 }
    );
  }
}
