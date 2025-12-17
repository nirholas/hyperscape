import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:promote");

const SERVER_ASSETS_PATH = path.resolve(
  process.cwd(),
  "../server/world/assets",
);
const MODELS_PATH = path.join(SERVER_ASSETS_PATH, "models");
const MANIFESTS_PATH = path.join(SERVER_ASSETS_PATH, "manifests");

interface PromoteRequest {
  assetId: string;
  manifestEntry: {
    id: string;
    name: string;
    type: string;
    description?: string;
    rarity?: string;
    value?: number;
    equipSlot?: string;
    weaponType?: string;
    category?: "mob" | "boss" | "neutral" | "quest";
    faction?: string;
    level?: number;
  };
  targetManifest: "items" | "npcs" | "resources";
}

/**
 * POST /api/export/promote - Promote a draft asset to production
 * Removes isDraft flag and adds to manifest
 */
export async function POST(request: NextRequest) {
  try {
    const body: PromoteRequest = await request.json();
    const { assetId, manifestEntry, targetManifest } = body;

    if (!assetId || !manifestEntry || !targetManifest) {
      return NextResponse.json(
        { error: "assetId, manifestEntry, and targetManifest required" },
        { status: 400 },
      );
    }

    // Check asset exists
    const assetDir = path.join(MODELS_PATH, assetId);
    const metadataPath = path.join(assetDir, "metadata.json");

    try {
      await fs.access(assetDir);
    } catch {
      return NextResponse.json(
        { error: `Asset not found in server: ${assetId}` },
        { status: 404 },
      );
    }

    // Update metadata to remove draft flag
    let metadata: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(content);
    } catch {
      metadata = { name: assetId };
    }

    metadata.isDraft = false;
    metadata.promotedAt = new Date().toISOString();
    metadata.gddCompliant = true; // Mark as reviewed/approved

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Add to manifest
    const manifestFile = `${targetManifest}.json`;
    const manifestPath = path.join(MANIFESTS_PATH, manifestFile);

    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent) as Record<string, unknown>[];

    // Create manifest entry
    const entry = createManifestEntry(targetManifest, assetId, manifestEntry);

    // Update or add
    const existingIndex = manifest.findIndex((m) => m.id === assetId);
    if (existingIndex >= 0) {
      manifest[existingIndex] = entry;
    } else {
      manifest.push(entry);
    }

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return NextResponse.json({
      success: true,
      assetId,
      promoted: true,
      manifestEntry: entry,
      manifestFile,
    });
  } catch (error) {
    log.error({ error }, "Promote failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Promote failed" },
      { status: 500 },
    );
  }
}

function createManifestEntry(
  targetType: string,
  assetId: string,
  entry: PromoteRequest["manifestEntry"],
): Record<string, unknown> {
  const baseEntry = {
    id: assetId,
    name: entry.name,
    description: entry.description,
  };

  if (targetType === "items") {
    return {
      ...baseEntry,
      type: entry.type || "item",
      value: entry.value || 100,
      weight: 1,
      tradeable: true,
      rarity: entry.rarity || "common",
      modelPath: `asset://models/${assetId}/${assetId}.glb`,
      iconPath: `asset://models/${assetId}/concept-art.png`,
      equipSlot: entry.equipSlot,
      weaponType: entry.weaponType,
    };
  }

  if (targetType === "npcs") {
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
        modelPath: `asset://models/${assetId}/${assetId}.vrm`,
        iconPath: `asset://models/${assetId}/concept-art.png`,
        scale: 1.0,
      },
    };
  }

  if (targetType === "resources") {
    return {
      ...baseEntry,
      type: entry.type || "tree",
      examine: entry.description,
      modelPath: `asset://models/${assetId}/${assetId}.glb`,
      scale: 1.0,
    };
  }

  return baseEntry;
}
