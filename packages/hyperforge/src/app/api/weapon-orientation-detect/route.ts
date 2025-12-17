/**
 * Weapon Orientation Detection API Route
 * Uses AI vision to determine if weapon needs to be flipped
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";

const log = logger.child("API:weapon-orientation-detect");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image } = body;

    if (!image) {
      return NextResponse.json({ error: "Image required" }, { status: 400 });
    }

    // If no API key, use heuristic
    if (!OPENAI_API_KEY) {
      log.info("No API key, using heuristic");
      return NextResponse.json({
        success: true,
        needsFlip: false,
        reason: "Heuristic: assuming correct orientation",
      });
    }

    // Use OpenAI Vision API
    const systemPrompt = `You are analyzing a weapon image to determine its orientation.

The weapon should be oriented with:
- The BLADE/TIP pointing UP (toward the top of the image)
- The HANDLE/GRIP pointing DOWN (toward the bottom of the image)

Look at the image and determine if the weapon needs to be flipped 180 degrees.

Respond with ONLY a JSON object (no markdown):
{
  "needsFlip": <true if handle is at top and blade at bottom, false if already correct>,
  "reason": "<brief explanation>"
}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: image.startsWith("data:")
                    ? image
                    : `data:image/png;base64,${image}`,
                },
              },
              {
                type: "text",
                text: "Is the handle at the bottom (correct) or at the top (needs flip)?",
              },
            ],
          },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      log.error("OpenAI API error");
      return NextResponse.json({
        success: true,
        needsFlip: false,
        reason: "API error - assuming correct orientation",
      });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({
        success: true,
        needsFlip: false,
        reason: "Empty response - assuming correct orientation",
      });
    }

    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
      }

      const data = JSON.parse(jsonStr);

      log.info({ data }, "Orientation detection result");

      return NextResponse.json({
        success: true,
        needsFlip: data.needsFlip || false,
        reason: data.reason || "AI orientation check",
      });
    } catch {
      return NextResponse.json({
        success: true,
        needsFlip: false,
        reason: "Parse error - assuming correct orientation",
      });
    }
  } catch (error) {
    log.error({ error }, "Orientation detection failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Detection failed" },
      { status: 500 },
    );
  }
}
