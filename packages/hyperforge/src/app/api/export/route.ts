import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:export");

// Server assets paths
const SERVER_ASSETS_PATH = path.resolve(
  process.cwd(),
  "../server/world/assets",
);
const MODELS_PATH = path.join(SERVER_ASSETS_PATH, "models");
const AVATARS_PATH = path.join(SERVER_ASSETS_PATH, "avatars");
const MANIFESTS_PATH = path.join(SERVER_ASSETS_PATH, "manifests");

// HyperForge local assets
const LOCAL_ASSETS_PATH = path.resolve(process.cwd(), "assets");

interface ExportRequest {
  assetId: string;
  targetType: "item" | "npc" | "resource" | "avatar";
  manifestEntry?: {
    id: string;
    name: string;
    type: string;
    description?: string;
    rarity?: string;
    value?: number;
    // Item-specific
    equipSlot?: string;
    weaponType?: string;
    // NPC-specific
    category?: "mob" | "boss" | "neutral" | "quest";
    faction?: string;
    level?: number;
  };
  isDraft?: boolean; // Draft assets aren't added to manifests until promoted
}

/**
 * POST /api/export - Export a generated asset to the game server for testing
 */
export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { assetId, targetType, manifestEntry, isDraft = true } = body;

    if (!assetId) {
      return NextResponse.json({ error: "assetId required" }, { status: 400 });
    }

    // Find the local asset
    const localAssetDir = path.join(LOCAL_ASSETS_PATH, assetId);
    const localMetadataPath = path.join(localAssetDir, "metadata.json");

    // Check if asset exists
    try {
      await fs.access(localAssetDir);
    } catch {
      return NextResponse.json(
        { error: `Asset not found: ${assetId}` },
        { status: 404 },
      );
    }

    // Read local metadata
    let localMetadata: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(localMetadataPath, "utf-8");
      localMetadata = JSON.parse(content);
    } catch {
      // No metadata, will create from manifest entry
    }

    // Determine target directory
    const targetId = manifestEntry?.id || assetId;
    let targetDir: string;
    let targetManifest: string;

    if (targetType === "avatar") {
      targetDir = AVATARS_PATH;
      targetManifest = ""; // Avatars don't have a manifest
    } else {
      targetDir = path.join(MODELS_PATH, targetId);
      targetManifest =
        targetType === "npc"
          ? "npcs.json"
          : targetType === "resource"
            ? "resources.json"
            : "items.json";
    }

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true });

    // Copy model files
    const files = await fs.readdir(localAssetDir);
    const copiedFiles: string[] = [];

    for (const file of files) {
      const sourcePath = path.join(localAssetDir, file);
      const stat = await fs.stat(sourcePath);

      if (stat.isFile()) {
        let targetFileName = file;

        // Rename model file to match targetId
        if (file.endsWith(".glb") && file.includes(assetId)) {
          targetFileName = file.replace(assetId, targetId);
        }

        const targetPath =
          targetType === "avatar"
            ? path.join(targetDir, `${targetId}.vrm`) // Avatars use VRM
            : path.join(targetDir, targetFileName);

        await fs.copyFile(sourcePath, targetPath);
        copiedFiles.push(targetFileName);
      }
    }

    // Create server-compatible metadata
    const serverMetadata = {
      name: targetId,
      gameId: targetId,
      type: manifestEntry?.type || localMetadata.type || targetType,
      subtype: manifestEntry?.type || localMetadata.category,
      description: manifestEntry?.description || localMetadata.description,
      generatedAt: localMetadata.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      isBaseModel: true,
      materialVariants: [],
      isPlaceholder: false,
      hasModel: true,
      hasConceptArt: copiedFiles.includes("thumbnail.png"),
      modelPath: `models/${targetId}/${targetId}.glb`,
      conceptArtUrl: "./concept-art.png",
      gddCompliant: false, // Generated assets need review
      workflow: "HyperForge → Meshy Text-to-3D",
      meshyTaskId: localMetadata.meshyTaskId,
      meshyStatus: "completed",
      isDraft,
      exportedAt: new Date().toISOString(),
      sourceAssetId: assetId,
    };

    // Rename thumbnail to concept-art
    const thumbnailPath = path.join(targetDir, "thumbnail.png");
    const conceptArtPath = path.join(targetDir, "concept-art.png");
    try {
      await fs.access(thumbnailPath);
      await fs.rename(thumbnailPath, conceptArtPath);
    } catch {
      // No thumbnail to rename
    }

    // Write server metadata
    await fs.writeFile(
      path.join(targetDir, "metadata.json"),
      JSON.stringify(serverMetadata, null, 2),
    );

    // Add to manifest if not draft
    let manifestUpdated = false;
    if (!isDraft && targetManifest && manifestEntry) {
      manifestUpdated = await addToManifest(
        targetManifest,
        targetType,
        targetId,
        manifestEntry,
        serverMetadata,
      );
    }

    return NextResponse.json({
      success: true,
      assetId: targetId,
      targetDir,
      copiedFiles,
      isDraft,
      manifestUpdated,
      serverMetadata,
    });
  } catch (error) {
    log.error({ error }, "Export failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    );
  }
}

/**
 * Add asset entry to the appropriate manifest
 */
async function addToManifest(
  manifestFile: string,
  targetType: string,
  targetId: string,
  entry: ExportRequest["manifestEntry"],
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const manifestPath = path.join(MANIFESTS_PATH, manifestFile);

  try {
    // Read existing manifest
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as Record<string, unknown>[];

    // Check if entry already exists
    const existingIndex = manifest.findIndex((m) => m.id === targetId);
    if (existingIndex >= 0) {
      log.debug({ targetId }, "Updating existing manifest entry");
      manifest[existingIndex] = createManifestEntry(
        targetType,
        targetId,
        entry!,
        metadata,
      );
    } else {
      log.debug({ targetId }, "Adding new manifest entry");
      manifest.push(
        createManifestEntry(targetType, targetId, entry!, metadata),
      );
    }

    // Write updated manifest
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return true;
  } catch (error) {
    log.error({ error }, "Failed to update manifest");
    return false;
  }
}

/**
 * Create a manifest entry based on type
 */
function createManifestEntry(
  targetType: string,
  targetId: string,
  entry: NonNullable<ExportRequest["manifestEntry"]>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const baseEntry = {
    id: targetId,
    name: entry.name,
    description: entry.description,
  };

  if (targetType === "item") {
    return {
      ...baseEntry,
      type: entry.type || "item",
      value: entry.value || 100,
      weight: 1,
      tradeable: true,
      rarity: entry.rarity || "common",
      modelPath: `asset://models/${targetId}/${targetId}.glb`,
      iconPath: `asset://models/${targetId}/concept-art.png`,
      equipSlot: entry.equipSlot,
      weaponType: entry.weaponType,
      _generatedBy: "hyperforge",
      _exportedAt: metadata.exportedAt,
    };
  }

  if (targetType === "npc") {
    return {
      ...baseEntry,
      category: entry.category || "mob",
      faction: entry.faction || "monster",
      stats: {
        level: entry.level || 1,
        health: (entry.level || 1) * 10,
        attack: entry.level || 1,
        strength: entry.level || 1,
        defense: entry.level || 1,
      },
      combat: {
        attackable: entry.category !== "neutral",
        aggressive: false,
        retaliates: true,
      },
      movement: {
        type: entry.category === "neutral" ? "stationary" : "wander",
        speed: 3.33,
        wanderRadius: 10,
      },
      appearance: {
        modelPath: `asset://models/${targetId}/${targetId}.vrm`,
        iconPath: `asset://models/${targetId}/concept-art.png`,
        scale: 1.0,
      },
      _generatedBy: "hyperforge",
      _exportedAt: metadata.exportedAt,
    };
  }

  if (targetType === "resource") {
    return {
      ...baseEntry,
      type: entry.type || "tree",
      examine: entry.description,
      modelPath: `asset://models/${targetId}/${targetId}.glb`,
      scale: 1.0,
      _generatedBy: "hyperforge",
      _exportedAt: metadata.exportedAt,
    };
  }

  return baseEntry;
}

/**
 * GET /api/export - List exported (draft) assets
 */
export async function GET() {
  try {
    // Scan models directory for draft assets
    const drafts: Array<{
      id: string;
      name: string;
      type: string;
      isDraft: boolean;
      exportedAt: string;
    }> = [];

    const modelDirs = await fs.readdir(MODELS_PATH, { withFileTypes: true });

    for (const dir of modelDirs) {
      if (!dir.isDirectory()) continue;

      const metadataPath = path.join(MODELS_PATH, dir.name, "metadata.json");
      try {
        const content = await fs.readFile(metadataPath, "utf-8");
        const metadata = JSON.parse(content);

        if (metadata._generatedBy === "hyperforge" || metadata.isDraft) {
          drafts.push({
            id: dir.name,
            name: metadata.name,
            type: metadata.type,
            isDraft: metadata.isDraft ?? true,
            exportedAt: metadata.exportedAt || metadata.completedAt,
          });
        }
      } catch {
        // Skip directories without valid metadata
      }
    }

    return NextResponse.json(drafts);
  } catch (error) {
    log.error({ error }, "Failed to list drafts");
    return NextResponse.json(
      { error: "Failed to list exported assets" },
      { status: 500 },
    );
  }
}
