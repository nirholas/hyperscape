import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

interface ImageMetadata {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  type: string;
  prompt?: string;
  createdAt: string;
  width?: number;
  height?: number;
  size?: number;
}

/**
 * GET /api/images
 * List all generated images
 */
export async function GET(request: NextRequest) {
  try {
    const assetsDir =
      process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const imagesDir = path.join(assetsDir, "images");

    const images: ImageMetadata[] = [];
    const cdnUrl =
      process.env.CDN_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3500";

    // Check if images directory exists
    try {
      await fs.access(imagesDir);
    } catch {
      // Directory doesn't exist yet
      return NextResponse.json({ images: [] });
    }

    // Scan subdirectories for each type
    const types = ["concept-art", "sprite", "texture", "icon", "other"];

    for (const type of types) {
      const typeDir = path.join(imagesDir, type);

      try {
        await fs.access(typeDir);
        const files = await fs.readdir(typeDir);

        for (const filename of files) {
          if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) continue;

          const filepath = path.join(typeDir, filename);
          const stats = await fs.stat(filepath);

          // Extract ID from filename (format: type_timestamp_random.ext)
          const id = filename.replace(/\.[^.]+$/, "");

          images.push({
            id,
            filename,
            url: `${cdnUrl}/api/images/file/${type}/${filename}`,
            thumbnailUrl: `${cdnUrl}/api/images/file/${type}/${filename}`,
            type,
            createdAt: stats.mtime.toISOString(),
            size: stats.size,
          });
        }
      } catch {
        // Type directory doesn't exist, skip
      }
    }

    // Also check uploads directory (for concept art used in 3D generation)
    const uploadsDir = path.join(assetsDir, "uploads");
    try {
      await fs.access(uploadsDir);
      const files = await fs.readdir(uploadsDir);

      for (const filename of files) {
        if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) continue;
        if (filename.startsWith("concept_")) {
          const filepath = path.join(uploadsDir, filename);
          const stats = await fs.stat(filepath);
          const id = filename.replace(/\.[^.]+$/, "");

          images.push({
            id,
            filename,
            url: `${cdnUrl}/api/upload/image/${filename}`,
            thumbnailUrl: `${cdnUrl}/api/upload/image/${filename}`,
            type: "concept-art",
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
    console.error("[Images API] Error listing images:", error);
    return NextResponse.json(
      { error: "Failed to list images" },
      { status: 500 },
    );
  }
}
