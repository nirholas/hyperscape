import { NextResponse } from "next/server";
import { loadVRMEmotes } from "@/lib/cdn/loader";
import { logger } from "@/lib/utils";

const log = logger.child("API:emotes");

/**
 * GET /api/emotes - Get available emotes for VRM animation testing
 */
export async function GET() {
  try {
    const emotes = await loadVRMEmotes();
    return NextResponse.json(emotes);
  } catch (error) {
    log.error({ error }, "Failed to load emotes");
    return NextResponse.json(
      { error: "Failed to load emotes" },
      { status: 500 },
    );
  }
}
