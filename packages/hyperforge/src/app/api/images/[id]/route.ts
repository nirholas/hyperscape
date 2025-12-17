import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:images");

/**
 * DELETE /api/images/[id]
 * Delete a generated image
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const assetsDir =
      process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const imagesDir = path.join(assetsDir, "images");
    const uploadsDir = path.join(assetsDir, "uploads");

    // Try to find and delete the image in type directories
    const types = ["concept-art", "sprite", "texture", "icon", "other"];

    for (const type of types) {
      const typeDir = path.join(imagesDir, type);

      try {
        const files = await fs.readdir(typeDir);
        for (const filename of files) {
          const fileId = filename.replace(/\.[^.]+$/, "");
          if (fileId === id) {
            await fs.unlink(path.join(typeDir, filename));
            return NextResponse.json({ success: true, deleted: filename });
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    // Also check uploads directory
    try {
      const files = await fs.readdir(uploadsDir);
      for (const filename of files) {
        const fileId = filename.replace(/\.[^.]+$/, "");
        if (fileId === id) {
          await fs.unlink(path.join(uploadsDir, filename));
          return NextResponse.json({ success: true, deleted: filename });
        }
      }
    } catch {
      // Uploads directory doesn't exist
    }

    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  } catch (error) {
    log.error({ error }, "Error deleting image");
    return NextResponse.json(
      { error: "Failed to delete image" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/images/[id]
 * Get image metadata
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const assetsDir =
      process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const imagesDir = path.join(assetsDir, "images");
    const cdnUrl =
      process.env.CDN_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3500";

    // Try to find the image in type directories
    const types = ["concept-art", "sprite", "texture", "icon", "other"];

    for (const type of types) {
      const typeDir = path.join(imagesDir, type);

      try {
        const files = await fs.readdir(typeDir);
        for (const filename of files) {
          const fileId = filename.replace(/\.[^.]+$/, "");
          if (fileId === id) {
            const filepath = path.join(typeDir, filename);
            const stats = await fs.stat(filepath);

            return NextResponse.json({
              id,
              filename,
              url: `${cdnUrl}/api/images/file/${type}/${filename}`,
              type,
              createdAt: stats.mtime.toISOString(),
              size: stats.size,
            });
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  } catch (error) {
    log.error({ error }, "Error getting image");
    return NextResponse.json({ error: "Failed to get image" }, { status: 500 });
  }
}
