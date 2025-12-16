import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export interface AudioAsset {
  id: string;
  filename: string;
  type: "voice" | "sfx" | "music";
  url: string;
  size: number;
  createdAt: string;
  metadata?: {
    text?: string;
    voicePreset?: string;
    prompt?: string;
    category?: string;
    npcId?: string;
    dialogueNodeId?: string;
  };
}

const ASSETS_BASE_DIR =
  process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");

/**
 * GET /api/audio/assets
 * Lists all generated audio assets
 */
export async function GET() {
  try {
    const audioDir = path.join(ASSETS_BASE_DIR, "audio");
    const assets: AudioAsset[] = [];

    // Check if audio directory exists
    try {
      await fs.access(audioDir);
    } catch {
      // No audio directory yet
      return NextResponse.json([]);
    }

    // Get all audio type directories
    const typeDirs = await fs.readdir(audioDir, { withFileTypes: true });

    for (const typeDir of typeDirs) {
      if (!typeDir.isDirectory()) continue;

      const typeName = typeDir.name as "voice" | "sfx" | "music";
      const typePath = path.join(audioDir, typeName);

      // Get all files in this type directory (and subdirectories for categories)
      const entries = await fs.readdir(typePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Handle category subdirectories (e.g., sfx/combat, music/ambient)
          const categoryPath = path.join(typePath, entry.name);
          const categoryFiles = await fs.readdir(categoryPath, {
            withFileTypes: true,
          });

          for (const file of categoryFiles) {
            if (file.isFile() && isAudioFile(file.name)) {
              const filePath = path.join(categoryPath, file.name);
              const asset = await createAudioAsset(
                filePath,
                file.name,
                typeName,
                entry.name,
              );
              assets.push(asset);
            }
          }
        } else if (entry.isFile() && isAudioFile(entry.name)) {
          const filePath = path.join(typePath, entry.name);
          const asset = await createAudioAsset(filePath, entry.name, typeName);
          assets.push(asset);
        }
      }
    }

    // Sort by creation date, newest first
    assets.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json(assets);
  } catch (error) {
    console.error("[API] Failed to list audio assets:", error);
    return NextResponse.json(
      { error: "Failed to list audio assets" },
      { status: 500 },
    );
  }
}

function isAudioFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".mp3", ".wav", ".ogg", ".m4a", ".webm"].includes(ext);
}

async function createAudioAsset(
  filePath: string,
  filename: string,
  type: "voice" | "sfx" | "music",
  category?: string,
): Promise<AudioAsset> {
  const stats = await fs.stat(filePath);
  const id = path.basename(filename, path.extname(filename));

  // Try to read metadata if it exists
  const metadataPath = filePath.replace(/\.[^.]+$/, ".json");
  let metadata: AudioAsset["metadata"];
  try {
    const metadataContent = await fs.readFile(metadataPath, "utf-8");
    metadata = JSON.parse(metadataContent);
  } catch {
    // No metadata file
  }

  // Build URL path
  const relativePath = category
    ? `/api/audio/file/${type}/${category}/${filename}`
    : `/api/audio/file/${type}/${filename}`;

  return {
    id,
    filename,
    type,
    url: relativePath,
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    metadata: metadata
      ? { ...metadata, category }
      : category
        ? { category }
        : undefined,
  };
}
