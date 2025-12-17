/**
 * Generation Types for HyperForge
 *
 * Types for AI generation pipelines (image-to-3d, text-to-3d, audio, etc.)
 */

// =============================================================================
// PIPELINE TYPES
// =============================================================================

/**
 * 3D generation pipeline types
 */
export type GenerationPipeline = "image-to-3d" | "text-to-3d";

/**
 * AI provider options
 */
export type AIProvider = "openai" | "anthropic" | "google" | "meshy";

/**
 * Generation quality levels
 */
export type GenerationQuality = "preview" | "medium" | "high";

// =============================================================================
// STATUS & PROGRESS
// =============================================================================

/**
 * Generation status states
 */
export type GenerationStatus =
  | "idle"
  | "generating"
  | "generating-image"
  | "converting-to-3d"
  | "completed"
  | "failed";

/**
 * Generation progress tracking
 */
export interface GenerationProgress {
  status: GenerationStatus;
  progress: number; // 0-100
  percent?: number; // Alias for progress (SSE compatibility)
  stage?: string; // Current pipeline stage name
  currentStep?: string;
  error?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * 3D generation configuration
 */
export interface GenerationConfig {
  pipeline: GenerationPipeline;
  prompt: string;
  provider?: AIProvider;
  quality?: GenerationQuality;
  imageUrl?: string; // For image-to-3d pipeline
  options?: GenerationOptions;
}

/**
 * Advanced generation options
 */
export interface GenerationOptions {
  enablePBR?: boolean;
  topology?: "quad" | "triangle";
  targetPolycount?: number;
  textureResolution?: number;
  style?: string;
  negativePrompt?: string;
}

// =============================================================================
// RESULTS
// =============================================================================

/**
 * Generation result
 */
export interface GenerationResult {
  id?: string;
  taskId: string;
  modelUrl: string;
  thumbnailUrl?: string;
  status: "completed" | "failed";
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Batch generation job
 */
export interface BatchGenerationJob {
  id: string;
  configs: GenerationConfig[];
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  results: GenerationResult[];
  errors: string[];
}
