/**
 * Sprites Generation API
 * POST /api/sprites/generate
 *
 * Generates 2D sprite images for an asset using Google Gemini via Vercel AI Gateway.
 * The front/isometric sprite becomes the asset thumbnail.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateSpritesForAsset,
  type SpriteResult,
  type AssetInfo,
} from "@/lib/ai/sprite-service";
import fs from "fs/promises";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:sprites");

interface SpriteGenerateRequest {
  assetId: string;
  assetName: string;
  assetDescription?: string;
  assetCategory?: string;
  views?: string[];
  style?: "pixel" | "clean" | "detailed";
  updateThumbnail?: boolean;
}

interface SpriteGenerateResponse {
  success: boolean;
  sprites: SpriteResult[];
  thumbnailUrl?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SpriteGenerateResponse>> {
  try {
    const body = (await request.json()) as SpriteGenerateRequest;

    const {
      assetId,
      assetName,
      assetDescription,
      assetCategory,
      views,
      style,
      updateThumbnail = true,
    } = body;

    if (!assetId || !assetName) {
      return NextResponse.json(
        {
          success: false,
          sprites: [],
          error: "assetId and assetName are required",
        },
        { status: 400 },
      );
    }

    log.info(`Generating sprites for asset: ${assetName}`);

    // Build asset info for sprite generation
    const assetInfo: AssetInfo = {
      id: assetId,
      name: assetName,
      description: assetDescription,
      category: assetCategory,
    };

    // Generate sprites
    const sprites = await generateSpritesForAsset(assetInfo, {
      views,
      style,
    });

    if (sprites.length === 0) {
      return NextResponse.json(
        {
          success: false,
          sprites: [],
          error: "No sprites were generated. Check AI Gateway configuration.",
        },
        { status: 500 },
      );
    }

    // Save sprites to asset storage
    const assetDir = path.join(
      process.cwd(),
      "public",
      "assets",
      assetId,
      "sprites",
    );
    await fs.mkdir(assetDir, { recursive: true });

    const savedSprites: SpriteResult[] = [];

    for (const sprite of sprites) {
      if (sprite.base64) {
        const filename = `${sprite.angle}.png`;
        const filepath = path.join(assetDir, filename);

        // Decode base64 and save to file
        const buffer = Buffer.from(sprite.base64, "base64");
        await fs.writeFile(filepath, buffer);

        // Update sprite with local URL
        const localUrl = `/assets/${assetId}/sprites/${filename}`;
        savedSprites.push({
          ...sprite,
          imageUrl: localUrl,
        });

        log.info(`Saved sprite: ${localUrl}`);
      }
    }

    // Update thumbnail if requested (use front or isometric as thumbnail)
    let thumbnailUrl: string | undefined;

    if (updateThumbnail && savedSprites.length > 0) {
      // Prefer isometric, then front
      const thumbnailSprite =
        savedSprites.find((s) => s.angle === "isometric") ||
        savedSprites.find((s) => s.angle === "front") ||
        savedSprites[0];

      if (thumbnailSprite) {
        // Copy sprite as thumbnail
        const thumbnailFilename = "thumbnail.png";
        const thumbnailPath = path.join(
          process.cwd(),
          "public",
          "assets",
          assetId,
          thumbnailFilename,
        );

        // Get source sprite path
        const sourceSpritePath = path.join(
          assetDir,
          `${thumbnailSprite.angle}.png`,
        );

        try {
          await fs.copyFile(sourceSpritePath, thumbnailPath);
          thumbnailUrl = `/assets/${assetId}/${thumbnailFilename}`;
          log.info(`Updated thumbnail: ${thumbnailUrl}`);
        } catch (error) {
          log.warn({ error }, "Failed to update thumbnail");
        }

        // Update metadata.json with new thumbnail
        const metadataPath = path.join(
          process.cwd(),
          "public",
          "assets",
          assetId,
          "metadata.json",
        );

        try {
          const metadataContent = await fs.readFile(metadataPath, "utf-8");
          const metadata = JSON.parse(metadataContent);

          metadata.thumbnailUrl = thumbnailUrl;
          metadata.hasSprites = true;
          metadata.sprites = savedSprites.map((s) => ({
            angle: s.angle,
            imageUrl: s.imageUrl,
          }));

          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
          log.info("Updated metadata.json with sprites info");
        } catch (error) {
          log.warn({ error }, "Failed to update metadata");
        }
      }
    }

    return NextResponse.json({
      success: true,
      sprites: savedSprites,
      thumbnailUrl,
    });
  } catch (error) {
    log.error({ error }, "Sprite generation failed");

    return NextResponse.json(
      {
        success: false,
        sprites: [],
        error:
          error instanceof Error ? error.message : "Sprite generation failed",
      },
      { status: 500 },
    );
  }
}
