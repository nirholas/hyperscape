/**
 * Serve uploaded images by filename
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:upload:image");

const ASSETS_DIR =
  process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
const UPLOADS_DIR = path.join(ASSETS_DIR, "uploads");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;

    if (!filename) {
      return NextResponse.json(
        { error: "No filename provided" },
        { status: 400 },
      );
    }

    // Security: prevent directory traversal
    const sanitizedFilename = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, sanitizedFilename);

    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read and serve the file
    const data = await fs.readFile(filepath);

    // Determine content type
    const ext = sanitizedFilename.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    const contentType = contentTypes[ext || "png"] || "image/png";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    log.error({ error }, "GET error");
    return NextResponse.json(
      { error: "Failed to serve image" },
      { status: 500 },
    );
  }
}
