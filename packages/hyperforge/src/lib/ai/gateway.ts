/**
 * AI Gateway Service
 * Unified AI text/image generation using Vercel AI Gateway
 *
 * Uses the AI SDK with gateway() function for all AI operations.
 * All requests route through Vercel AI Gateway for:
 * - Unified API access to OpenAI, Anthropic, Google, etc.
 * - Automatic failover and load balancing
 * - Centralized billing and usage tracking
 *
 * @see https://vercel.com/docs/ai-gateway
 * @see https://sdk.vercel.ai/docs
 *
 * Required environment variables:
 * - AI_GATEWAY_API_KEY: Your Vercel AI Gateway API key
 */

import {
  generateText,
  streamText,
  generateObject,
  experimental_generateImage as generateImage,
} from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { z } from "zod";
import { TASK_MODELS, isMultimodalImageModel } from "./providers";
import { logger } from "@/lib/utils";

const log = logger.child("AI Gateway");

// ============================================================================
// Types
// ============================================================================

export interface TextGenerationOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface StreamTextOptions extends TextGenerationOptions {
  onChunk?: (chunk: string) => void;
}

/**
 * Standard image sizes for generation
 * - 256x256: Thumbnails, icons
 * - 512x512: Sprites, small images
 * - 768x768: Intermediate size
 * - 1024x1024: Standard quality (default)
 * - 1792x1024: Wide landscape
 * - 1024x1792: Tall portrait
 * - 2048x2048: High resolution (Flux only)
 */
export type ImageSize =
  | "256x256"
  | "512x512"
  | "768x768"
  | "1024x1024"
  | "1792x1024"
  | "1024x1792"
  | "2048x2048";

export interface ImageGenerationOptions {
  /** Model to use for image generation (e.g., 'bfl/flux-2-pro', 'google/gemini-2.5-flash-image') */
  model?: string;
  /**
   * Image dimensions
   * - 256x256: Thumbnails, icons
   * - 512x512: Sprites, small images
   * - 768x768: Intermediate size
   * - 1024x1024: Standard quality (default)
   * - 1792x1024: Wide landscape
   * - 1024x1792: Tall portrait
   * - 2048x2048: High resolution (Flux only)
   */
  size?: ImageSize;
  /** Quality level - 'hd' adds emphasis in prompt */
  quality?: "standard" | "hd";
  /** Style guidance - affects prompt wording */
  style?: "vivid" | "natural";
}

export interface StructuredOutputOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface PromptEnhancementResult {
  originalPrompt: string;
  enhancedPrompt: string;
  model: string;
  error?: string;
}

export interface EnhancementOptions {
  assetType: string;
  gameStyle?: string;
  isAvatar?: boolean;
}

// ============================================================================
// Text Generation
// ============================================================================

/**
 * Generate text using Vercel AI Gateway
 * Routes to the specified provider/model via AI Gateway
 */
export async function generateTextWithProvider(
  prompt: string,
  options: TextGenerationOptions = {},
): Promise<string> {
  const {
    model = TASK_MODELS.textGeneration,
    maxTokens = 2000,
    temperature = 0.7,
    systemPrompt,
  } = options;

  log.debug(`Generating text with model: ${model}`);

  const result = await generateText({
    model: gateway(model),
    prompt,
    system: systemPrompt,
    maxOutputTokens: maxTokens,
    temperature,
  });

  return result.text;
}

/**
 * Stream text using Vercel AI Gateway
 * Yields chunks as they arrive for real-time display
 */
export async function* streamTextWithProvider(
  prompt: string,
  options: StreamTextOptions = {},
): AsyncGenerator<string, void, unknown> {
  const {
    model = TASK_MODELS.textGeneration,
    maxTokens = 2000,
    temperature = 0.7,
    systemPrompt,
    onChunk,
  } = options;

  log.debug(`Streaming text with model: ${model}`);

  const result = streamText({
    model: gateway(model),
    prompt,
    system: systemPrompt,
    maxOutputTokens: maxTokens,
    temperature,
  });

  for await (const chunk of result.textStream) {
    if (onChunk) {
      onChunk(chunk);
    }
    yield chunk;
  }
}

// ============================================================================
// Structured Output (JSON with Zod schemas)
// ============================================================================

/**
 * Generate structured JSON output with type safety
 * Uses Zod schema for validation and type inference
 */
export async function generateStructuredOutput<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: StructuredOutputOptions = {},
): Promise<T> {
  const {
    model = TASK_MODELS.contentGeneration,
    maxTokens = 4000,
    temperature = 0.3,
    systemPrompt,
  } = options;

  log.debug(`Generating structured output with model: ${model}`);

  const result = await generateObject({
    model: gateway(model),
    prompt,
    schema,
    system: systemPrompt,
    maxOutputTokens: maxTokens,
    temperature,
  });

  return result.object;
}

/**
 * Generate JSON output (legacy - prefer generateStructuredOutput with Zod)
 * Parses response as JSON with cleanup for markdown formatting
 */
export async function generateJSON<T>(
  prompt: string,
  schemaDescription: string,
  options: TextGenerationOptions = {},
): Promise<T> {
  const systemPrompt = `You are a JSON generator. You MUST return ONLY valid JSON matching this schema:

${schemaDescription}

Return ONLY the JSON object, no markdown, no explanation, no code blocks.`;

  const result = await generateTextWithProvider(prompt, {
    ...options,
    systemPrompt,
    temperature: 0.3,
  });

  // Clean up any markdown formatting
  let cleaned = result.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  return JSON.parse(cleaned.trim()) as T;
}

// ============================================================================
// Vision / Image Analysis
// ============================================================================

/**
 * Analyze an image using a vision model via AI Gateway
 */
export async function analyzeImage(
  imageUrl: string,
  prompt: string,
  options: TextGenerationOptions = {},
): Promise<string> {
  const {
    model = TASK_MODELS.vision,
    maxTokens = 1000,
    temperature = 0.3,
  } = options;

  log.debug(`Analyzing image with model: ${model}`);

  const result = await generateText({
    model: gateway(model),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageUrl },
        ],
      },
    ],
    maxOutputTokens: maxTokens,
    temperature,
  });

  return result.text;
}

// ============================================================================
// Image Generation
// ============================================================================

/**
 * Build enhanced prompt with style/quality hints for image generation
 */
function buildImagePrompt(
  basePrompt: string,
  options: Pick<ImageGenerationOptions, "quality" | "style">,
): string {
  const parts = [basePrompt];

  if (options.style === "vivid") {
    parts.push("Vivid, vibrant colors with dramatic lighting.");
  } else if (options.style === "natural") {
    parts.push("Natural, realistic lighting and colors.");
  }

  if (options.quality === "hd") {
    parts.push("High detail, sharp, professional quality.");
  }

  return parts.join(" ");
}

/**
 * System prompt for multimodal image generation
 * Instructs the model to ONLY generate an image, no text
 */
const IMAGE_GENERATION_SYSTEM_PROMPT = `You are an image generation assistant. Your ONLY task is to generate images.

CRITICAL INSTRUCTIONS:
- Generate EXACTLY ONE high-quality image based on the user's description
- Do NOT include any text, explanations, or descriptions in your response
- Do NOT describe what you will create or what you have created
- Do NOT ask clarifying questions
- ONLY output the generated image, nothing else

Your response must contain ONLY the generated image file.`;

/**
 * Generate image using multimodal LLM (Gemini)
 * Uses generateText() and extracts images from result.files
 */
async function generateWithMultimodalModel(
  model: string,
  prompt: string,
  size: string,
): Promise<string | null> {
  log.debug("Multimodal image generation:", { model, size });

  const result = await generateText({
    model: gateway(model),
    system: IMAGE_GENERATION_SYSTEM_PROMPT,
    prompt: `Generate an image (${size}): ${prompt}`,
  });

  // Multimodal models return images as files in the response
  const imageFiles = result.files?.filter((f) =>
    f.mediaType?.startsWith("image/"),
  );

  if (imageFiles && imageFiles.length > 0) {
    const file = imageFiles[0];
    const base64 = Buffer.from(file.uint8Array).toString("base64");
    const mediaType = file.mediaType || "image/png";
    log.debug(
      `Generated image: ${mediaType}, ${(file.uint8Array.length / 1024).toFixed(1)} KB`,
    );
    return `data:${mediaType};base64,${base64}`;
  }

  return null;
}

/**
 * Image model type from generateImage parameters
 * Used for type bridging when gateway() returns a model that supports image generation
 */
type ImageModel = Parameters<typeof generateImage>[0]["model"];

/**
 * Generate image using dedicated image model (Flux, Imagen)
 * Uses experimental_generateImage() API
 */
async function generateWithDedicatedModel(
  model: string,
  prompt: string,
  size: `${number}x${number}`,
): Promise<string | null> {
  log.debug("Dedicated image generation:", { model, size });

  // Generate image using the AI SDK
  // Note: gateway() returns a language model, but some models support image generation
  // The gateway model is compatible at runtime, but types don't reflect this
  const gatewayModel = gateway(model);
  const result = await generateImage({
    model: gatewayModel as unknown as ImageModel,
    prompt,
    size,
  });

  // Dedicated image models return images array
  if (result.images && result.images.length > 0) {
    const image = result.images[0];
    // Image can be base64 string or have .base64 property
    const base64 = typeof image === "string" ? image : image.base64;
    if (base64) {
      log.debug(
        `Generated image via dedicated model: ${(base64.length / 1024).toFixed(1)} KB`,
      );
      // Return as data URL if not already
      if (base64.startsWith("data:")) {
        return base64;
      }
      return `data:image/png;base64,${base64}`;
    }
  }

  return null;
}

/**
 * Generate an image using AI Gateway
 *
 * Supports two types of image models:
 * - **Multimodal LLMs** (Gemini): Uses generateText(), returns images in result.files
 * - **Dedicated image models** (Flux, Imagen): Uses experimental_generateImage()
 *
 * The model type is auto-detected based on TASK_MODELS.imageGeneration or explicit model param.
 *
 * @param prompt - The image description
 * @param options - Generation options:
 *   - model: Override the default model (e.g., 'bfl/flux-2-pro')
 *   - size: Image dimensions ('1024x1024', '512x512', etc.)
 *   - quality: 'standard' | 'hd' (affects prompt emphasis)
 *   - style: 'vivid' | 'natural' (affects prompt style guidance)
 * @returns Base64 data URL of the generated image
 *
 * @see https://vercel.com/docs/ai-gateway/image-generation
 * @see https://vercel.com/docs/ai-gateway/image-generation/ai-sdk
 */
export async function generateImageWithProvider(
  prompt: string,
  options: ImageGenerationOptions = {},
): Promise<string> {
  const { model: explicitModel, size = "1024x1024", quality, style } = options;

  const model = explicitModel || TASK_MODELS.imageGeneration;
  const enhancedPrompt = buildImagePrompt(prompt, { quality, style });

  log.debug("Image generation requested:", { model, size });

  let imageUrl: string | null = null;

  // Route to appropriate generation method based on model type
  if (isMultimodalImageModel(model)) {
    imageUrl = await generateWithMultimodalModel(model, enhancedPrompt, size);
  } else {
    // Dedicated image model (Flux, Imagen, etc.)
    imageUrl = await generateWithDedicatedModel(model, enhancedPrompt, size);
  }

  if (imageUrl) {
    return imageUrl;
  }

  log.warn("No image generated, returning placeholder");
  return `https://placeholder.hyperforge.ai/generated?prompt=${encodeURIComponent(prompt)}&size=${size}`;
}

// ============================================================================
// Prompt Enhancement
// ============================================================================

/**
 * Enhance a prompt using GPT-4 via Vercel AI Gateway
 * Optimizes prompts for 3D asset generation with Meshy AI
 */
export async function enhancePromptWithGPT4(
  description: string,
  options: EnhancementOptions,
): Promise<PromptEnhancementResult> {
  const modelName = TASK_MODELS.promptEnhancement;

  // Build system prompt based on asset type
  let systemPrompt = `You are an expert at optimizing prompts for 3D asset generation with Meshy AI.
Your task is to enhance the user's description to create better results with text-to-3D generation.

Focus on:
- Clear, specific visual details
- Material and texture descriptions  
- Geometric shape and form
- Game-ready asset considerations`;

  if (options.isAvatar) {
    systemPrompt += `

CRITICAL REQUIREMENTS FOR CHARACTER RIGGING:
The generated model will be auto-rigged, so the body structure MUST be clearly visible:

1. POSE: Standing in T-pose with arms stretched out horizontally to the sides, legs slightly apart
2. EMPTY HANDS: No weapons, tools, shields, or held items - hands must be empty and open
3. VISIBLE LIMBS: Arms and legs must be CLEARLY VISIBLE and separated from the body
   - NO long robes, cloaks, or dresses that cover or merge with the legs
   - NO bulky capes or flowing fabric that obscures arm silhouette
   - Clothing should be fitted or short enough to show leg separation
4. CLEAR SILHOUETTE: The body outline should clearly show head, torso, 2 arms, 2 legs
5. HUMANOID PROPORTIONS: Standard humanoid body with clearly defined joints

REWRITE the clothing/armor description to ensure limbs are visible:
- Instead of "long robes" → use "fitted tunic" or "short robes above the knee"
- Instead of "flowing cloak" → use "short shoulder cape" or remove it
- Instead of "heavy plate armor" → use "form-fitting armor" or "segmented armor showing joints"

Always end with: "Full body character in T-pose with arms extended horizontally, legs apart, empty open hands, clearly visible arms and legs."`;
  }

  systemPrompt += `

Keep the enhanced prompt concise but detailed. Return ONLY the enhanced prompt, nothing else.`;

  const userPrompt = `Enhance this ${options.assetType} asset description for 3D generation: "${description}"`;

  try {
    log.debug("Enhancing prompt via Vercel AI Gateway...");

    const result = await generateText({
      model: gateway(modelName),
      prompt: userPrompt,
      system: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 500,
    });

    const enhancedPrompt = result.text.trim();

    log.info("Prompt enhanced successfully");

    return {
      originalPrompt: description,
      enhancedPrompt,
      model: modelName,
    };
  } catch (error) {
    log.error("Enhancement failed:", error);

    // Fallback: add basic game-ready suffix
    const fallbackPrompt = `${description}. Game-ready 3D asset, clean geometry, detailed textures.`;

    return {
      originalPrompt: description,
      enhancedPrompt: fallbackPrompt,
      model: "fallback",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
