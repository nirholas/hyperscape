import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * GET /api/images/file/[...path]
 * Serve generated image files
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const pathParts = (await params).path;

    if (!pathParts || pathParts.length < 2) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const assetsDir =
      process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const imagesDir = path.join(assetsDir, "images");

    // Construct file path: /api/images/file/[type]/[filename]
    const filepath = path.join(imagesDir, ...pathParts);

    // Security: ensure we're not traversing outside the images directory
    const resolvedPath = path.resolve(filepath);
    const resolvedImagesDir = path.resolve(imagesDir);

    if (!resolvedPath.startsWith(resolvedImagesDir)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 403 });
    }

    // Read the file
    try {
      const buffer = await fs.readFile(resolvedPath);

      // Determine content type
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };

      const contentType = contentTypes[ext] || "application/octet-stream";

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("[Images API] Error serving file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 },
    );
  }
}
