/**
 * Image Upload API
 * Handles uploading reference images for generation
 * Returns a publicly accessible URL that Meshy can use
 *
 * Uses Supabase Storage (S3-compatible) when configured, falls back to local storage
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  isSupabaseConfigured,
  uploadReferenceImage,
} from "@/lib/storage/supabase-storage";
import { logger } from "@/lib/utils";

const log = logger.child("API:upload:image");

const ASSETS_DIR =
  process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
const UPLOADS_DIR = path.join(ASSETS_DIR, "uploads");

// Ensure uploads directory exists (for local fallback)
async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const type = (formData.get("type") as string) || "reference";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/webp", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only PNG, JPG, and WEBP are allowed." },
        { status: 400 },
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 },
      );
    }

    // Try Supabase Storage first (recommended for production)
    if (isSupabaseConfigured()) {
      log.info("Using Supabase Storage");

      const result = await uploadReferenceImage(file, file.name, file.type);

      if (result.success) {
        return NextResponse.json({
          success: true,
          filename: path.basename(result.path),
          url: result.url,
          size: file.size,
          type: file.type,
          storage: "supabase",
        });
      } else {
        log.warn(
          { error: result.error },
          "Supabase upload failed, falling back to local",
        );
        // Fall through to local storage
      }
    }

    // Fallback: Local file storage
    log.info("Using local file storage");
    await ensureUploadsDir();

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split(".").pop() || "png";
    const filename = `${type}_${timestamp}_${randomId}.${extension}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    // Read file data and save
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filepath, buffer);

    // Generate URLs
    // For local development, we need to serve from our own server
    // The CDN_URL env var can be set for production
    const cdnUrl =
      process.env.CDN_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3500";
    const publicUrl = `${cdnUrl}/api/upload/image/${filename}`;

    log.info({ filename }, "Saved reference image locally");

    return NextResponse.json({
      success: true,
      filename,
      url: publicUrl,
      size: file.size,
      type: file.type,
      storage: "local",
    });
  } catch (error) {
    log.error({ error }, "Upload error");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

/**
 * Serve uploaded images (for local storage fallback only)
 * Supabase serves images directly from their CDN
 */
export async function GET(request: NextRequest) {
  try {
    // Get filename from URL path (this handles the [...path] pattern)
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const filename = pathParts[pathParts.length - 1];

    if (!filename || filename === "image") {
      return NextResponse.json(
        { error: "No filename provided" },
        { status: 400 },
      );
    }

    const filepath = path.join(UPLOADS_DIR, filename);

    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read and serve the file
    const data = await fs.readFile(filepath);

    // Determine content type
    const ext = filename.split(".").pop()?.toLowerCase();
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
