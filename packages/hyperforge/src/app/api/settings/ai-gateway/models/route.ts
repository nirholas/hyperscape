import { NextResponse } from "next/server";

/**
 * AI Model from Vercel AI Gateway
 */
export interface AIModel {
  id: string; // e.g., "openai/gpt-4o"
  provider: string; // e.g., "openai"
  name: string; // e.g., "GPT-4o"
  capabilities: string[]; // e.g., ["text", "vision", "code"]
  contextLength?: number;
  maxOutputTokens?: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

/**
 * Models grouped by capability for task-specific selection
 */
export interface ModelsByCapability {
  text: AIModel[];
  image: AIModel[];
  vision: AIModel[];
  code: AIModel[];
  embedding: AIModel[];
  all: AIModel[];
}

/**
 * Raw model response from AI Gateway
 */
interface RawModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  // Additional fields that may be present
  context_length?: number;
  max_output_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

/**
 * Infer capabilities from model ID and metadata
 */
function inferCapabilities(model: RawModel): string[] {
  const caps: string[] = [];
  const id = model.id.toLowerCase();

  // Embedding models
  if (id.includes("embed") || id.includes("embedding")) {
    caps.push("embedding");
    return caps; // Embedding models typically only do embeddings
  }

  // Audio/speech models
  if (id.includes("whisper") || id.includes("tts") || id.includes("speech")) {
    caps.push("audio");
    return caps;
  }

  // Image generation models
  if (
    id.includes("dall-e") ||
    id.includes("imagen") ||
    id.includes("flash-image") ||
    id.includes("stable-diffusion") ||
    id.includes("midjourney")
  ) {
    caps.push("image");
    return caps; // Image models typically only generate images
  }

  // Text generation (most LLMs)
  caps.push("text");

  // Vision capability
  if (
    id.includes("vision") ||
    id.includes("-4o") ||
    id.includes("gpt-4o") ||
    id.includes("gemini-1.5") ||
    id.includes("gemini-2") ||
    id.includes("claude-3") ||
    id.includes("claude-sonnet-4") ||
    id.includes("claude-opus-4")
  ) {
    caps.push("vision");
  }

  // Code capability (strong coding models)
  if (
    id.includes("code") ||
    id.includes("codex") ||
    id.includes("claude") ||
    id.includes("gpt-4") ||
    id.includes("gpt-5") ||
    id.includes("gemini")
  ) {
    caps.push("code");
  }

  // Reasoning capability (advanced models)
  if (
    id.includes("o1") ||
    id.includes("o3") ||
    id.includes("claude-sonnet-4") ||
    id.includes("claude-opus") ||
    id.includes("gpt-5")
  ) {
    caps.push("reasoning");
  }

  return caps;
}

/**
 * Extract provider from model ID
 */
function extractProvider(modelId: string): string {
  const parts = modelId.split("/");
  return parts.length > 1 ? parts[0] : "unknown";
}

/**
 * Generate human-readable name from model ID
 */
function generateDisplayName(modelId: string): string {
  const parts = modelId.split("/");
  const modelName = parts.length > 1 ? parts[1] : modelId;

  // Capitalize and clean up
  return modelName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * GET /api/settings/ai-gateway/models
 * Fetches all available models from Vercel AI Gateway and categorizes them
 */
export async function GET() {
  const apiKey =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

  if (!apiKey) {
    return NextResponse.json(
      {
        configured: false,
        error: "AI_GATEWAY_API_KEY environment variable is not set",
        models: null,
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          configured: true,
          error: `Failed to fetch models: ${response.status} ${response.statusText}`,
          details: errorData,
          models: null,
        },
        { status: 200 },
      );
    }

    const data = await response.json();

    // Handle both array and { data: [...] } response formats
    const rawModels: RawModel[] = Array.isArray(data)
      ? data
      : data.data || data.models || [];

    // Transform and categorize models
    const models: AIModel[] = rawModels.map((raw) => ({
      id: raw.id,
      provider: extractProvider(raw.id),
      name: generateDisplayName(raw.id),
      capabilities: inferCapabilities(raw),
      contextLength: raw.context_length,
      maxOutputTokens: raw.max_output_tokens,
      costPer1kInput: raw.input_cost_per_token
        ? raw.input_cost_per_token * 1000
        : undefined,
      costPer1kOutput: raw.output_cost_per_token
        ? raw.output_cost_per_token * 1000
        : undefined,
    }));

    // Group by capability
    const modelsByCapability: ModelsByCapability = {
      text: models.filter((m) => m.capabilities.includes("text")),
      image: models.filter((m) => m.capabilities.includes("image")),
      vision: models.filter((m) => m.capabilities.includes("vision")),
      code: models.filter((m) => m.capabilities.includes("code")),
      embedding: models.filter((m) => m.capabilities.includes("embedding")),
      all: models,
    };

    // Sort each category by provider, then by name
    for (const key of Object.keys(modelsByCapability) as Array<
      keyof ModelsByCapability
    >) {
      modelsByCapability[key].sort((a, b) => {
        if (a.provider !== b.provider) {
          return a.provider.localeCompare(b.provider);
        }
        return a.name.localeCompare(b.name);
      });
    }

    return NextResponse.json({
      configured: true,
      models: modelsByCapability,
      totalCount: models.length,
      counts: {
        text: modelsByCapability.text.length,
        image: modelsByCapability.image.length,
        vision: modelsByCapability.vision.length,
        code: modelsByCapability.code.length,
        embedding: modelsByCapability.embedding.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        models: null,
      },
      { status: 200 },
    );
  }
}
