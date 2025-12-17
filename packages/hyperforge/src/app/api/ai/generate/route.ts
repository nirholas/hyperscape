/**
 * AI Generation API Route
 * Handles AI text generation (via LLM providers) and image generation
 *
 * Endpoint: POST /api/ai/generate
 *
 * This is for AI-powered text/image generation using the AI Gateway.
 * For 3D model generation, use /api/generation instead.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateTextWithProvider,
  generateImageWithProvider,
} from "@/lib/ai/gateway";
import { logger } from "@/lib/utils";

const log = logger.child("API:ai/generate");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, prompt, provider, options } = body;

    if (type === "text") {
      const text = await generateTextWithProvider(prompt, {
        model: provider, // Provider is used as model identifier (e.g., "anthropic/claude-sonnet-4")
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        systemPrompt: options?.systemPrompt,
      });

      return NextResponse.json({ text });
    }

    if (type === "image") {
      const imageUrl = await generateImageWithProvider(prompt, {
        model: provider, // Provider is used as model identifier (e.g., "google/gemini-2.5-flash-image")
        size: options?.size,
        quality: options?.quality,
        style: options?.style,
      });

      return NextResponse.json({ imageUrl });
    }

    return NextResponse.json(
      { error: "Invalid generation type. Use 'text' or 'image'." },
      { status: 400 },
    );
  } catch (error) {
    log.error({ error }, "AI generation failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "AI generation failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    name: "AI Generation API",
    description:
      "Generate text or images using AI providers via the AI Gateway",
    usage: {
      method: "POST",
      body: {
        type: "'text' | 'image'",
        prompt: "The generation prompt",
        provider:
          "Model identifier (e.g., 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash-image')",
        options: {
          text: {
            maxTokens: "number (optional)",
            temperature: "number (optional)",
            systemPrompt: "string (optional)",
          },
          image: {
            size: "'256x256' | '512x512' | '768x768' | '1024x1024' (default) | '1792x1024' | '1024x1792' | '2048x2048'",
            quality: "'standard' | 'hd' (enhances prompt for quality)",
            style: "'vivid' | 'natural' (guides prompt style)",
          },
        },
      },
    },
    examples: {
      textGeneration: {
        type: "text",
        prompt: "Describe a medieval sword",
        provider: "anthropic/claude-sonnet-4",
        options: { maxTokens: 500, temperature: 0.7 },
      },
      imageGeneration: {
        type: "image",
        prompt: "A glowing enchanted sword",
        provider: "google/gemini-2.5-flash-image",
        options: { size: "1024x1024", quality: "hd", style: "vivid" },
      },
    },
    models: {
      text: [
        "anthropic/claude-sonnet-4",
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash",
      ],
      image: [
        "google/gemini-2.5-flash-image (multimodal, default)",
        "bfl/flux-2-pro (dedicated)",
        "google/imagen-3 (dedicated)",
      ],
    },
    related: {
      "/api/generation": "3D model generation with Meshy",
      "/api/content/generate": "Game content generation",
    },
  });
}
