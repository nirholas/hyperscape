import { NextRequest, NextResponse } from "next/server";
import { saveAssetFiles } from "@/lib/storage/asset-storage";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@/lib/utils";

const log = logger.child("API:assets:upload");

export interface UploadAssetMetadata {
  name: string;
  category: string;
  type?: string;
  description?: string;
  rarity?: string;
  // Item properties
  value?: number;
  weight?: number;
  stackable?: boolean;
  tradeable?: boolean;
  // Equipment properties
  equipSlot?: string;
  weaponType?: string;
  attackType?: string;
  attackSpeed?: number;
  attackRange?: number;
  // Combat bonuses
  bonusAttack?: number;
  bonusStrength?: number;
  bonusDefense?: number;
  bonusRanged?: number;
  bonusMagic?: number;
  // Requirements
  levelRequired?: number;
  skillRequirements?: Record<string, number>;
  // NPC properties
  npcCategory?: string;
  faction?: string;
  combatLevel?: number;
  health?: number;
  aggressive?: boolean;
  // Resource properties
  harvestSkill?: string;
  toolRequired?: string;
}

/**
 * POST /api/assets/upload
 * Upload a 3D model with metadata
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Get model file
    const modelFile = formData.get("model") as File | null;
    if (!modelFile) {
      return NextResponse.json(
        { error: "No model file provided" },
        { status: 400 },
      );
    }

    // Validate file type
    const validExtensions = [".glb", ".gltf", ".vrm"];
    const fileName = modelFile.name.toLowerCase();
    const hasValidExtension = validExtensions.some((ext) =>
      fileName.endsWith(ext),
    );
    if (!hasValidExtension) {
      return NextResponse.json(
        {
          error: "Invalid file type. Supported formats: GLB, GLTF, VRM",
        },
        { status: 400 },
      );
    }

    // Get thumbnail file (optional)
    const thumbnailFile = formData.get("thumbnail") as File | null;

    // Parse metadata from form
    const metadataJson = formData.get("metadata") as string | null;
    let metadata: UploadAssetMetadata;

    try {
      metadata = metadataJson
        ? JSON.parse(metadataJson)
        : { name: modelFile.name.replace(/\.[^.]+$/, ""), category: "item" };
    } catch {
      return NextResponse.json(
        { error: "Invalid metadata JSON" },
        { status: 400 },
      );
    }

    // Validate required fields
    if (!metadata.name || metadata.name.trim() === "") {
      return NextResponse.json(
        { error: "Asset name is required" },
        { status: 400 },
      );
    }

    if (!metadata.category) {
      return NextResponse.json(
        { error: "Asset category is required" },
        { status: 400 },
      );
    }

    // Generate asset ID
    const assetId = `uploaded-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Determine model format
    const format = fileName.endsWith(".vrm")
      ? "vrm"
      : fileName.endsWith(".gltf")
        ? "gltf"
        : "glb";

    // Convert files to buffers
    const modelBuffer = Buffer.from(await modelFile.arrayBuffer());
    const thumbnailBuffer = thumbnailFile
      ? Buffer.from(await thumbnailFile.arrayBuffer())
      : undefined;

    // Build full metadata object
    const fullMetadata = {
      id: assetId,
      name: metadata.name.trim(),
      source: "LOCAL" as const,
      category: metadata.category,
      type: metadata.type || metadata.category,
      description: metadata.description,
      rarity: metadata.rarity || "common",
      status: "completed" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      originalFileName: modelFile.name,
      fileSize: modelFile.size,
      // Item properties
      value: metadata.value,
      weight: metadata.weight,
      stackable: metadata.stackable,
      tradeable: metadata.tradeable,
      // Equipment
      equipSlot: metadata.equipSlot,
      weaponType: metadata.weaponType,
      attackType: metadata.attackType,
      attackSpeed: metadata.attackSpeed,
      attackRange: metadata.attackRange,
      // Bonuses
      bonuses:
        metadata.bonusAttack !== undefined ||
        metadata.bonusStrength !== undefined ||
        metadata.bonusDefense !== undefined
          ? {
              attack: metadata.bonusAttack || 0,
              strength: metadata.bonusStrength || 0,
              defense: metadata.bonusDefense || 0,
              ranged: metadata.bonusRanged || 0,
              magic: metadata.bonusMagic || 0,
            }
          : undefined,
      // Requirements
      requirements:
        metadata.levelRequired !== undefined
          ? {
              level: metadata.levelRequired,
              skills: metadata.skillRequirements || {},
            }
          : undefined,
      // NPC properties
      npcCategory: metadata.npcCategory,
      faction: metadata.faction,
      combatLevel: metadata.combatLevel,
      health: metadata.health,
      aggressive: metadata.aggressive,
      // Resource properties
      harvestSkill: metadata.harvestSkill,
      toolRequired: metadata.toolRequired,
      levelRequired: metadata.levelRequired,
    };

    // Save files
    const savedFiles = await saveAssetFiles({
      assetId,
      modelBuffer,
      modelFormat: format,
      thumbnailBuffer,
      metadata: fullMetadata,
    });

    return NextResponse.json({
      success: true,
      asset: {
        ...fullMetadata,
        modelUrl: savedFiles.modelUrl,
        thumbnailUrl: savedFiles.thumbnailUrl,
      },
    });
  } catch (error) {
    log.error("Upload failed", { error });
    return NextResponse.json(
      {
        error: "Upload failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

// Increase body size limit for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};
