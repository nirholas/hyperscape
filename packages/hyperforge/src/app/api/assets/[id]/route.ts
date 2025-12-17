import { NextRequest, NextResponse } from "next/server";
import { loadCDNAssets } from "@/lib/cdn/loader";
import {
  getForgeAsset,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import { readAssetMetadata, assetExists } from "@/lib/storage/asset-storage";
import type { CDNAsset } from "@/lib/cdn/types";
import { logger } from "@/lib/utils";

const log = logger.child("API:assets");

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

/**
 * GET /api/assets/[id]
 * Get single asset metadata with three-tier lookup:
 * 1. CDN (main Hyperscape repo)
 * 2. Supabase (FORGE assets)
 * 3. Local filesystem
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // 1. Check CDN assets first
    try {
      const cdnAssets = await loadCDNAssets();
      const cdnAsset = cdnAssets.find((a) => a.id === id);
      if (cdnAsset) {
        return NextResponse.json({
          ...cdnAsset,
          modelUrl: cdnAsset.modelPath.startsWith("asset://")
            ? cdnAsset.modelPath.replace("asset://", `${CDN_URL}/`)
            : `${CDN_URL}/${cdnAsset.modelPath}`,
          thumbnailUrl: cdnAsset.thumbnailPath
            ? cdnAsset.thumbnailPath.startsWith("asset://")
              ? cdnAsset.thumbnailPath.replace("asset://", `${CDN_URL}/`)
              : `${CDN_URL}/${cdnAsset.thumbnailPath}`
            : undefined,
        });
      }
    } catch (error) {
      log.warn("CDN lookup failed", { error });
    }

    // 2. Check Supabase FORGE assets
    if (isSupabaseConfigured()) {
      try {
        const forgeAsset = await getForgeAsset(id);
        if (forgeAsset) {
          return NextResponse.json({
            id: forgeAsset.id,
            name: forgeAsset.name,
            source: "LOCAL",
            modelPath: forgeAsset.modelUrl,
            modelUrl: forgeAsset.modelUrl,
            thumbnailPath: forgeAsset.thumbnailUrl,
            thumbnailUrl: forgeAsset.thumbnailUrl,
            vrmPath: forgeAsset.vrmPath,
            vrmUrl: forgeAsset.vrmUrl,
            previewUrl: forgeAsset.previewUrl,
            hasVRM: forgeAsset.hasVRM,
            hasModel: forgeAsset.hasModel,
            category: forgeAsset.category as CDNAsset["category"],
            type: forgeAsset.type,
            createdAt: forgeAsset.createdAt,
            metadata: forgeAsset.metadata,
          });
        }
      } catch (error) {
        log.warn("Supabase lookup failed", { error });
      }
    }

    // 3. Check local filesystem
    const existsLocally = await assetExists(id);
    if (existsLocally) {
      const metadata = await readAssetMetadata(id);
      if (metadata) {
        return NextResponse.json({
          id,
          name: (metadata.name as string) || id,
          source: "LOCAL",
          modelPath: `/api/assets/${id}/model.glb`,
          modelUrl: `/api/assets/${id}/model.glb`,
          thumbnailPath: `/api/assets/${id}/thumbnail.png`,
          thumbnailUrl: `/api/assets/${id}/thumbnail.png`,
          vrmUrl: metadata.hasVRM ? `/api/assets/${id}/model.vrm` : undefined,
          hasVRM: !!metadata.hasVRM,
          hasModel: true,
          category:
            (metadata.category as CDNAsset["category"]) ||
            (metadata.type as CDNAsset["category"]) ||
            "item",
          type: (metadata.type as string) || "object",
          status: metadata.status || "completed",
          createdAt: metadata.createdAt,
          metadata,
        });
      }
    }

    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  } catch (error) {
    log.error("Error fetching asset", { error });
    return NextResponse.json(
      { error: "Failed to fetch asset" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/assets/[id]
 * Delete an asset
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { deleteAssetFiles } = await import("@/lib/storage/asset-storage");

    await deleteAssetFiles(id);

    return NextResponse.json({
      success: true,
      message: `Asset ${id} deleted`,
    });
  } catch (error) {
    log.error("Error deleting asset", { error });
    return NextResponse.json(
      { error: "Failed to delete asset" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/assets/[id]
 * Update asset metadata
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const { promises: fs } = await import("fs");
    const { getMetadataPath, assetExists } = await import(
      "@/lib/storage/asset-storage"
    );

    const exists = await assetExists(id);
    if (!exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Read existing metadata
    const metadataPath = getMetadataPath(id);
    let metadata: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(content);
    } catch {
      // No existing metadata
    }

    // Merge updates
    const updatedMetadata = {
      ...metadata,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Write updated metadata
    await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2));

    return NextResponse.json(updatedMetadata);
  } catch (error) {
    log.error("Error updating asset", { error });
    return NextResponse.json(
      { error: "Failed to update asset" },
      { status: 500 },
    );
  }
}
