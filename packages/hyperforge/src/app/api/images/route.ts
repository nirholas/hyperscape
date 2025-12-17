import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  listImageAssets,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import { loadCDNAssets } from "@/lib/cdn/loader";
import { logger } from "@/lib/utils";

const log = logger.child("API:images");

interface ImageMetadata {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  type: string;
  source: "cdn" | "supabase" | "local";
  prompt?: string;
  createdAt: string;
  width?: number;
  height?: number;
  size?: number;
}

/**
 * GET /api/images
 * List all images following the storage priority pattern:
 * 1. CDN (icons, thumbnails from game manifests)
 * 2. Supabase image-generation bucket (HyperForge generations)
 * 3. Local filesystem (fallback)
 */
export async function GET(_request: NextRequest) {
  try {
    const images: ImageMetadata[] = [];
    const loadedIds = new Set<string>();
    const cdnUrl =
      process.env.CDN_URL ||
      process.env.NEXT_PUBLIC_CDN_URL ||
      "http://localhost:8080";

    // 1. Load icons/thumbnails from CDN manifests (production assets)
    try {
      const cdnAssets = await loadCDNAssets();
      for (const asset of cdnAssets) {
        // Only include assets with icon/thumbnail paths
        if (asset.iconPath || asset.thumbnailPath) {
          const imagePath = asset.iconPath || asset.thumbnailPath;
          if (!imagePath) continue;

          const imageUrl = imagePath.startsWith("asset://")
            ? imagePath.replace("asset://", `${cdnUrl}/`)
            : `${cdnUrl}/${imagePath}`;

          const id = `cdn_${asset.id}`;
          loadedIds.add(id);

          images.push({
            id,
            filename: path.basename(imagePath),
            url: imageUrl,
            thumbnailUrl: imageUrl,
            type: "icon",
            source: "cdn",
            createdAt: new Date().toISOString(),
          });
        }
      }
      log.info(`Loaded ${images.length} icons from CDN`);
    } catch (error) {
      log.warn({ error }, "Failed to load from CDN");
    }

    // 2. Load from Supabase image-generation bucket (HyperForge generations)
    if (isSupabaseConfigured()) {
      try {
        const supabaseImages = await listImageAssets();
        for (const img of supabaseImages) {
          if (loadedIds.has(img.id)) continue;
          loadedIds.add(img.id);
          images.push({
            id: img.id,
            filename: img.filename,
            url: img.url,
            thumbnailUrl: img.url,
            type: img.type,
            source: "supabase",
            createdAt: img.createdAt || new Date().toISOString(),
            size: img.size,
          });
        }
        log.info(`Loaded ${supabaseImages.length} images from Supabase`);
      } catch (error) {
        log.warn({ error }, "Failed to load from Supabase");
      }
    }

    // 2. Load from local filesystem (fallback)
    const assetsDir =
      process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const imagesDir = path.join(assetsDir, "images");
    const localApiUrl =
      process.env.CDN_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3500";

    // Check if images directory exists
    try {
      await fs.access(imagesDir);

      // Scan subdirectories for each type
      const types = ["concept-art", "sprite", "texture", "icon", "other"];

      for (const type of types) {
        const typeDir = path.join(imagesDir, type);

        try {
          await fs.access(typeDir);
          const files = await fs.readdir(typeDir);

          for (const filename of files) {
            if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) continue;

            const id = filename.replace(/\.[^.]+$/, "");
            // Skip if already loaded from Supabase
            if (loadedIds.has(id)) continue;

            const filepath = path.join(typeDir, filename);
            const stats = await fs.stat(filepath);

            images.push({
              id,
              filename,
              url: `${localApiUrl}/api/images/file/${type}/${filename}`,
              thumbnailUrl: `${localApiUrl}/api/images/file/${type}/${filename}`,
              type,
              source: "local",
              createdAt: stats.mtime.toISOString(),
              size: stats.size,
            });
          }
        } catch {
          // Type directory doesn't exist, skip
        }
      }
    } catch {
      // Images directory doesn't exist yet
    }

    // Also check uploads directory (for concept art used in 3D generation)
    const uploadsDir = path.join(assetsDir, "uploads");
    try {
      await fs.access(uploadsDir);
      const files = await fs.readdir(uploadsDir);

      for (const filename of files) {
        if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) continue;
        if (filename.startsWith("concept_")) {
          const id = filename.replace(/\.[^.]+$/, "");
          // Skip if already loaded from Supabase
          if (loadedIds.has(id)) continue;

          const filepath = path.join(uploadsDir, filename);
          const stats = await fs.stat(filepath);

          images.push({
            id,
            filename,
            url: `${localApiUrl}/api/upload/image/${filename}`,
            thumbnailUrl: `${localApiUrl}/api/upload/image/${filename}`,
            type: "concept-art",
            source: "local",
            createdAt: stats.mtime.toISOString(),
            size: stats.size,
          });
        }
      }
    } catch {
      // Uploads directory doesn't exist, skip
    }

    // Sort by creation date, newest first
    images.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({ images });
  } catch (error) {
    log.error({ error }, "Error listing images");
    return NextResponse.json(
      { error: "Failed to list images" },
      { status: 500 },
    );
  }
}
