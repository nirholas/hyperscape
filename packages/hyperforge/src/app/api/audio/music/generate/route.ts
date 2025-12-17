/**
 * API Route: Generate Music
 * Text-to-Music using ElevenLabs
 *
 * Storage order: Supabase audio-generations bucket (primary), local fallback
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { generateMusic, MUSIC_PROMPTS } from "@/lib/audio/elevenlabs-service";
import {
  uploadAudio,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import { logger } from "@/lib/utils";
import type { MusicAsset, MusicCategory } from "@/types/audio";

const log = logger.child("API:audio/music/generate");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt,
      presetId, // Use a preset instead of custom prompt
      category = "custom" as MusicCategory,
      name,
      durationMs = 30000, // Default 30 seconds
      forceInstrumental = true, // Default to instrumental for game music
      loopable = true,
      zones = [],
      saveToAsset = true,
    } = body;

    // Use preset prompt if provided
    let effectivePrompt = prompt;
    let effectiveName = name;
    if (presetId && MUSIC_PROMPTS[presetId]) {
      effectivePrompt = MUSIC_PROMPTS[presetId];
      effectiveName = effectiveName || presetId;
    }

    if (!effectivePrompt || typeof effectivePrompt !== "string") {
      return NextResponse.json(
        { error: "Prompt or presetId is required" },
        { status: 400 },
      );
    }

    log.info("Generating music", {
      prompt: effectivePrompt.substring(0, 50) + "...",
      category,
      durationMs,
      forceInstrumental,
    });

    // Append instrumental instruction if needed
    const finalPrompt = forceInstrumental
      ? `${effectivePrompt}. Instrumental only, no vocals.`
      : effectivePrompt;

    // Generate music
    const result = await generateMusic({
      prompt: finalPrompt,
      durationMs,
      forceInstrumental,
    });

    // Calculate duration in seconds
    const duration = durationMs / 1000;

    // Build asset metadata
    const assetId = generateMusicId(effectiveName, category);
    const asset: MusicAsset = {
      id: assetId,
      name: effectiveName || assetId,
      category,
      prompt: effectivePrompt,
      url: "", // Will be set after saving
      duration,
      format: "mp3",
      loopable,
      genre: extractGenre(effectivePrompt),
      mood: extractMood(effectivePrompt),
      zones,
      generatedAt: new Date().toISOString(),
    };

    // Save audio file
    if (saveToAsset) {
      const filename = `music_${category}_${assetId}.mp3`;

      // Try Supabase first (primary storage)
      if (isSupabaseConfigured()) {
        try {
          const uploadResult = await uploadAudio(
            result.audio,
            filename,
            "audio/mpeg",
          );
          if (uploadResult.success) {
            asset.url = uploadResult.url;
            log.info("Music saved to Supabase", { url: uploadResult.url });
          } else {
            throw new Error(uploadResult.error || "Upload failed");
          }
        } catch (error) {
          log.warn("Supabase upload failed, falling back to local", { error });
          // Fall through to local storage
        }
      }

      // Local fallback if Supabase not configured or failed
      if (!asset.url) {
        const assetsDir =
          process.env.HYPERFORGE_ASSETS_DIR ||
          path.join(process.cwd(), "assets");
        const audioDir = path.join(assetsDir, "audio", "music", category);

        // Create directory if needed
        await fs.mkdir(audioDir, { recursive: true });

        // Save audio file
        const filepath = path.join(audioDir, filename);
        await fs.writeFile(filepath, result.audio);

        asset.url = `/api/audio/file/music/${category}/${filename}`;

        log.info("Music saved locally", { filepath });
      }
    }

    // Return audio as base64 for immediate playback
    const audioBase64 = result.audio.toString("base64");

    return NextResponse.json({
      success: true,
      asset,
      audio: `data:audio/mp3;base64,${audioBase64}`,
    });
  } catch (error) {
    log.error("Music generation error", { error });

    if (
      error instanceof Error &&
      error.message.includes("ELEVENLABS_API_KEY")
    ) {
      return NextResponse.json(
        {
          error: "ElevenLabs API key not configured",
          message: error.message,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Failed to generate music" },
      { status: 500 },
    );
  }
}

// GET endpoint to list available music presets
export async function GET() {
  const presets = Object.entries(MUSIC_PROMPTS).map(([id, prompt]) => ({
    id,
    name: id
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    prompt,
    category: categorizePreset(id),
  }));

  return NextResponse.json({ presets });
}

function generateMusicId(name?: string, _category?: string): string {
  const timestamp = Date.now().toString(36);
  const safeName = name
    ? name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "music";
  return `${safeName}_${timestamp}`;
}

function categorizePreset(id: string): MusicCategory {
  if (id.includes("combat") || id.includes("boss")) {
    return "combat";
  }
  if (id.includes("town") || id.includes("tavern")) {
    return "town";
  }
  if (id.includes("dungeon") || id.includes("cave")) {
    return "dungeon";
  }
  if (id.includes("menu")) {
    return "menu";
  }
  if (id.includes("victory") || id.includes("defeat")) {
    return "victory";
  }
  if (id.includes("emotional") || id.includes("cutscene")) {
    return "cutscene";
  }
  return "ambient";
}

function extractGenre(prompt: string): string | undefined {
  const genres = [
    "orchestral",
    "electronic",
    "folk",
    "ambient",
    "epic",
    "jazz",
    "medieval",
    "fantasy",
    "cinematic",
  ];
  const lower = prompt.toLowerCase();
  return genres.find((g) => lower.includes(g));
}

function extractMood(prompt: string): string | undefined {
  const moods = [
    "peaceful",
    "tense",
    "heroic",
    "mysterious",
    "sad",
    "triumphant",
    "dark",
    "warm",
    "epic",
    "calm",
  ];
  const lower = prompt.toLowerCase();
  return moods.find((m) => lower.includes(m));
}
