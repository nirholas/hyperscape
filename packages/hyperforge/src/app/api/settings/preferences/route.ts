import { NextRequest, NextResponse } from "next/server";
import {
  saveModelPreferences,
  loadModelPreferences,
  isSupabaseConfigured,
  type StoredModelPreferences,
} from "@/lib/storage/supabase-storage";

/**
 * GET /api/settings/preferences?type=model-preferences&userId=xxx
 * Load user preferences from Supabase
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type");
  const userId = searchParams.get("userId") || "default";

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: "Supabase is not configured",
        preferences: null,
      },
      { status: 200 },
    );
  }

  if (type === "model-preferences") {
    try {
      const preferences = await loadModelPreferences(userId);

      return NextResponse.json({
        success: true,
        preferences,
        userId,
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load preferences",
          preferences: null,
        },
        { status: 200 },
      );
    }
  }

  return NextResponse.json(
    { error: "Invalid preference type" },
    { status: 400 },
  );
}

/**
 * POST /api/settings/preferences
 * Save user preferences to Supabase
 *
 * Body: { type: "model-preferences", userId?: string, data: {...} }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: "Supabase is not configured",
      },
      { status: 200 },
    );
  }

  try {
    const body = await request.json();
    const { type, userId = "default", data } = body;

    if (type === "model-preferences") {
      const preferences = data as StoredModelPreferences;

      const result = await saveModelPreferences(userId, preferences);

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: "Preferences saved",
          userId,
        });
      } else {
        return NextResponse.json(
          {
            success: false,
            error: result.error || "Failed to save preferences",
          },
          { status: 200 },
        );
      }
    }

    return NextResponse.json(
      { error: "Invalid preference type" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to save preferences",
      },
      { status: 500 },
    );
  }
}
