/**
 * AI Provider Model Configurations
 * Uses Vercel AI Gateway exclusively - all models route through AI Gateway
 *
 * Model strings use provider/model-name format that AI Gateway recognizes.
 * The gateway() function routes these to the appropriate provider via AI Gateway.
 *
 * Example: 'anthropic/claude-sonnet-4' → AI Gateway → Anthropic API
 *
 * @see https://vercel.com/docs/ai-gateway
 * @see https://vercel.com/docs/ai-gateway/models-and-providers
 * @see https://vercel.com/docs/ai-gateway/image-generation
 *
 * We do NOT use direct provider SDKs - only AI Gateway.
 */

export type AIProvider = "openai" | "anthropic" | "google";

export interface ModelConfig {
  text: string;
  image?: string;
  vision?: string;
}

/**
 * Model configurations for each provider
 * These use the provider/model-name format that AI Gateway recognizes
 */
export const PROVIDER_MODELS: Record<AIProvider, ModelConfig> = {
  openai: {
    text: "openai/gpt-4o",
    vision: "openai/gpt-4o",
    // No image generation - we use Gemini/Flux/Imagen instead
  },
  anthropic: {
    text: "anthropic/claude-sonnet-4-20250514",
    vision: "anthropic/claude-sonnet-4-20250514",
    // Anthropic doesn't support image generation
  },
  google: {
    text: "google/gemini-2.0-flash",
    image: "google/gemini-2.5-flash-image",
    vision: "google/gemini-2.0-flash",
  },
};

// ============================================================================
// Image Generation Models
// ============================================================================

/**
 * Image generation model types:
 * - "multimodal": Uses generateText(), returns images in result.files (Gemini)
 * - "dedicated": Uses experimental_generateImage() (Flux, Imagen)
 */
export type ImageModelType = "multimodal" | "dedicated";

export interface ImageModelConfig {
  id: string;
  name: string;
  type: ImageModelType;
  provider: string;
  description: string;
  supportedSizes?: string[];
}

/**
 * Available image generation models via AI Gateway
 * @see https://vercel.com/ai-gateway/models?type=image
 *
 * Size support varies by model:
 * - Gemini: Size is requested in prompt, model outputs ~1024x1024
 * - Flux: Supports explicit sizes from 512 to 2048
 * - Imagen: Fixed 1024x1024 output
 *
 * For sprites/thumbnails (256-512), use Flux or encode size in prompt
 * For concept art (1024), any model works well
 * For high-res textures (2048), use Flux Pro
 */
export const IMAGE_MODELS: ImageModelConfig[] = [
  // Multimodal LLMs (use generateText, extract from result.files)
  {
    id: "google/gemini-2.5-flash-image",
    name: "Gemini 2.5 Flash Image",
    type: "multimodal",
    provider: "google",
    description: "Fast multimodal text+image generation (default)",
    supportedSizes: ["256x256", "512x512", "768x768", "1024x1024"], // Size encoded in prompt
  },
  // Dedicated image models (use experimental_generateImage)
  {
    id: "bfl/flux-2-pro",
    name: "Flux 2 Pro",
    type: "dedicated",
    provider: "bfl",
    description: "High-quality image generation from Black Forest Labs",
    supportedSizes: ["256x256", "512x512", "768x768", "1024x1024", "2048x2048"],
  },
  {
    id: "bfl/flux-2-flex",
    name: "Flux 2 Flex",
    type: "dedicated",
    provider: "bfl",
    description: "Flexible image generation with style control",
    supportedSizes: ["256x256", "512x512", "768x768", "1024x1024"],
  },
  {
    id: "google/imagen-4.0-generate",
    name: "Imagen 4.0",
    type: "dedicated",
    provider: "google",
    description: "Google's latest image generation model",
    supportedSizes: ["1024x1024"],
  },
  {
    id: "google/imagen-4.0-fast-generate",
    name: "Imagen 4.0 Fast",
    type: "dedicated",
    provider: "google",
    description: "Faster variant of Imagen 4.0",
    supportedSizes: ["1024x1024"],
  },
];

/**
 * Get image model config by ID
 */
export function getImageModelConfig(
  modelId: string,
): ImageModelConfig | undefined {
  return IMAGE_MODELS.find((m) => m.id === modelId);
}

/**
 * Check if a model uses multimodal generation (generateText with files)
 */
export function isMultimodalImageModel(modelId: string): boolean {
  const config = getImageModelConfig(modelId);
  return config?.type === "multimodal";
}

// ============================================================================
// Task-Specific Models with User Preferences
// ============================================================================

const PREFERENCES_KEY = "hyperforge:model-preferences";

/**
 * Default task-specific model recommendations
 * Use these for specific generation tasks to optimize for speed, cost, or quality
 */
export const DEFAULT_TASK_MODELS = {
  /** Fast, cheap model for prompt enhancement and simple tasks */
  promptEnhancement: "openai/gpt-4o-mini",

  /** General text generation - good balance of speed and quality */
  textGeneration: "openai/gpt-4o-mini",

  /** Dialogue and structured JSON generation - good at following schemas */
  dialogueGeneration: "google/gemini-2.0-flash",

  /** Creative content generation - best for quests, lore, descriptions */
  contentGeneration: "anthropic/claude-sonnet-4-20250514",

  /** Image generation via Gemini */
  imageGeneration: "google/gemini-2.5-flash-image",

  /** Vision/image analysis */
  vision: "openai/gpt-4o",

  /** Complex reasoning tasks */
  reasoning: "anthropic/claude-sonnet-4-20250514",
} as const;

export type TaskType = keyof typeof DEFAULT_TASK_MODELS;

/**
 * Get the model for a specific task, checking user preferences first
 *
 * On client-side: Reads from localStorage if user has customized models
 * On server-side: Always returns default (preferences passed via request body if needed)
 */
export function getTaskModel(task: TaskType): string {
  // In browser: check for user preferences
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        // Zustand persist stores under 'state' key
        const prefs = state?.state?.preferences || state?.preferences;
        if (prefs && prefs[task]) {
          return prefs[task];
        }
      }
    } catch {
      // Ignore parse errors, fall through to default
    }
  }
  return DEFAULT_TASK_MODELS[task];
}

/**
 * TASK_MODELS with Proxy for backward compatibility
 *
 * Accessing TASK_MODELS.contentGeneration will call getTaskModel('contentGeneration')
 * This allows existing code to work without modification while respecting preferences
 */
export const TASK_MODELS = new Proxy(DEFAULT_TASK_MODELS, {
  get(target, prop: string): string {
    if (prop in target) {
      return getTaskModel(prop as TaskType);
    }
    return target[prop as TaskType];
  },
}) as typeof DEFAULT_TASK_MODELS;

/**
 * Get text model string for provider
 */
export function getTextModel(provider: AIProvider): string {
  return PROVIDER_MODELS[provider].text;
}

/**
 * Get image model string for provider
 */
export function getImageModel(provider: AIProvider): string {
  const model = PROVIDER_MODELS[provider].image;
  if (!model) {
    throw new Error(`Provider ${provider} does not support image generation`);
  }
  return model;
}

/**
 * Get vision model string for provider
 */
export function getVisionModel(provider: AIProvider): string {
  return PROVIDER_MODELS[provider].vision || PROVIDER_MODELS[provider].text;
}
