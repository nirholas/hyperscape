/**
 * API Route: Get Available Voices
 * Lists all available ElevenLabs voices
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getVoices,
  searchVoices,
  getSharedVoices,
  GAME_VOICE_PRESETS,
} from "@/lib/audio/elevenlabs-service";
import { logger } from "@/lib/utils";

const log = logger.child("API:audio/voices");

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all"; // all, search, shared, presets
    const search = searchParams.get("search") || undefined;
    const gender = searchParams.get("gender") || undefined;
    const category = searchParams.get("category") || undefined;
    const pageSize = parseInt(searchParams.get("pageSize") || "20");

    // Return presets (no API call needed)
    if (type === "presets") {
      const presets = Object.entries(GAME_VOICE_PRESETS).map(
        ([key, value]) => ({
          id: key,
          voiceId: value.voiceId,
          name: key
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          description: value.description,
        }),
      );
      return NextResponse.json({ voices: presets, type: "presets" });
    }

    // Search voices
    if (type === "search" && search) {
      const voices = await searchVoices({
        search,
        gender,
        category,
        pageSize,
      });
      return NextResponse.json({ voices, type: "search" });
    }

    // Get shared/community voices
    if (type === "shared") {
      const voices = await getSharedVoices({
        gender,
        category,
        pageSize,
      });
      return NextResponse.json({ voices, type: "shared" });
    }

    // Get all user voices
    const voices = await getVoices();
    return NextResponse.json({ voices, type: "all" });
  } catch (error) {
    log.error("Get voices error", { error });

    // Check if it's an API key error
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
      { error: "Failed to fetch voices" },
      { status: 500 },
    );
  }
}
