/**
 * Weapon Handle Detection API Route
 * Uses AI vision to identify grip/handle areas on weapon images
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";

const log = logger.child("API:weapon-handle-detect");

// OpenAI API for vision-based grip detection
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, angle, promptHint } = body;

    if (!image) {
      return NextResponse.json({ error: "Image required" }, { status: 400 });
    }

    // If no API key, use heuristic detection
    if (!OPENAI_API_KEY) {
      log.info("No API key, using heuristic detection");
      return NextResponse.json({
        success: true,
        gripData: await detectGripHeuristic(image),
      });
    }

    // Use OpenAI Vision API for grip detection
    const systemPrompt = `You are analyzing a weapon image to identify the handle/grip area where a hand would hold it.

The weapon is rendered orthographically (from the side) with Y-axis pointing up.
The image is 512x512 pixels.

${promptHint || "Focus on where the hand would naturally grip for combat. The handle is the narrow wrapped section, NOT the blade."}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "gripBounds": {
    "minX": <left edge of grip area in pixels>,
    "minY": <top edge of grip area in pixels>,
    "maxX": <right edge of grip area in pixels>,
    "maxY": <bottom edge of grip area in pixels>
  },
  "confidence": <0-1 confidence score>,
  "weaponType": "<sword|dagger|axe|hammer|mace|staff|spear|bow|other>",
  "gripDescription": "<brief description of the grip area>"
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
                text: angle
                  ? `Viewing angle: ${angle}. Identify the grip/handle area.`
                  : "Identify the grip/handle area of this weapon.",
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ error: errorText }, "OpenAI API error");
      // Fallback to heuristic
      return NextResponse.json({
        success: true,
        gripData: await detectGripHeuristic(image),
      });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      log.error("Empty response from OpenAI");
      return NextResponse.json({
        success: true,
        gripData: await detectGripHeuristic(image),
      });
    }

    // Parse JSON from response
    try {
      // Clean up response - remove markdown code blocks if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
      }

      const gripData = JSON.parse(jsonStr);

      // Validate bounds
      if (gripData.gripBounds) {
        const { minX, minY, maxX, maxY } = gripData.gripBounds;
        gripData.gripBounds.x = minX;
        gripData.gripBounds.y = minY;
        gripData.gripBounds.width = maxX - minX;
        gripData.gripBounds.height = maxY - minY;
      }

      log.info({ gripData }, "AI result");

      return NextResponse.json({
        success: true,
        gripData,
      });
    } catch (_parseError) {
      log.error({ content }, "Failed to parse response");
      return NextResponse.json({
        success: true,
        gripData: await detectGripHeuristic(image),
      });
    }
  } catch (error) {
    log.error({ error }, "Handle detection failed");
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Handle detection failed",
      },
      { status: 500 },
    );
  }
}

// Heuristic-based grip detection (fallback when no API key)
async function detectGripHeuristic(_image: string): Promise<{
  gripBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  weaponType: string;
  gripDescription: string;
}> {
  // Default to bottom third of the image (where handles usually are)
  // Centered horizontally
  const bounds = {
    minX: 200,
    minY: 350,
    maxX: 312,
    maxY: 440,
    x: 200,
    y: 350,
    width: 112,
    height: 90,
  };

  return {
    gripBounds: bounds,
    confidence: 0.5,
    weaponType: "sword",
    gripDescription: "Heuristic detection - handle assumed at bottom third",
  };
}

export async function GET() {
  return NextResponse.json({
    name: "Weapon Handle Detection API",
    description: "AI-powered weapon handle/grip detection from rendered images",
    hasApiKey: !!OPENAI_API_KEY,
  });
}
