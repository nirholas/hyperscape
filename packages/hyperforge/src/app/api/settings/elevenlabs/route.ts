import { NextResponse } from "next/server";

/**
 * GET /api/settings/elevenlabs
 * Fetches the ElevenLabs user subscription info
 *
 * @see https://elevenlabs.io/docs/api-reference/user/subscription/get
 */

interface ElevenLabsSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  can_extend_character_limit: boolean;
  allowed_to_extend_character_limit: boolean;
  next_character_count_reset_unix: number;
  voice_limit: number;
  max_voice_add_edits: number;
  voice_add_edit_counter: number;
  professional_voice_limit: number;
  can_extend_voice_limit: boolean;
  can_use_instant_voice_cloning: boolean;
  can_use_professional_voice_cloning: boolean;
  currency: string;
  status: string;
  billing_period: string;
  character_refresh_period: string;
  has_open_invoices: boolean;
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        configured: false,
        error: "ELEVENLABS_API_KEY environment variable is not set",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/user/subscription",
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          configured: true,
          error: `Failed to fetch subscription: ${response.status} ${response.statusText}`,
          details: errorData,
        },
        { status: 200 },
      );
    }

    const data: ElevenLabsSubscription = await response.json();

    // Calculate usage percentage
    const usagePercent =
      data.character_limit > 0
        ? Math.round((data.character_count / data.character_limit) * 100)
        : 0;

    // Calculate reset date
    const resetDate = data.next_character_count_reset_unix
      ? new Date(
          data.next_character_count_reset_unix * 1000,
        ).toLocaleDateString()
      : null;

    return NextResponse.json({
      configured: true,
      tier: data.tier,
      status: data.status,
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      usagePercent,
      voiceLimit: data.voice_limit,
      voicesUsed: data.voice_add_edit_counter,
      canExtendLimit: data.can_extend_character_limit,
      currency: data.currency,
      billingPeriod: data.billing_period,
      resetDate,
      features: {
        instantVoiceCloning: data.can_use_instant_voice_cloning,
        professionalVoiceCloning: data.can_use_professional_voice_cloning,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 200 },
    );
  }
}
