import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const ASSETS_BASE_DIR =
  process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");

/**
 * GET /api/audio/file/[type]/[...filename]
 * Serves audio files from the assets directory
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathParts } = await params;

    if (!pathParts || pathParts.length === 0) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
    }

    // Build file path: audio/{type}/{category?}/{filename}
    const filePath = path.join(ASSETS_BASE_DIR, "audio", ...pathParts);

    // Security check: ensure path is within assets directory
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(ASSETS_BASE_DIR);
    if (!resolvedPath.startsWith(resolvedBase)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 403 });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read file
    const buffer = await fs.readFile(filePath);

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentType = getAudioContentType(ext);

    // Return file with appropriate headers
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[API] Failed to serve audio file:", error);
    return NextResponse.json(
      { error: "Failed to serve audio file" },
      { status: 500 },
    );
  }
}

function getAudioContentType(ext: string): string {
  const contentTypes: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
  };
  return contentTypes[ext] || "application/octet-stream";
}
