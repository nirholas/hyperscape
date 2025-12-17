/**
 * Meshy 3D Generation Module
 *
 * AI-powered 3D model generation using the Meshy API.
 * Optimized for Three.js web MMO assets.
 *
 * @see https://www.meshy.ai/api - API Overview
 * @see https://docs.meshy.ai/en/api/image-to-3d - Image-to-3D API
 * @see https://docs.meshy.ai/api/text-to-3d - Text-to-3D API
 *
 * @example
 * ```typescript
 * import {
 *   createImageTo3DTask,
 *   createGenerationConfig,
 *   POLYCOUNT_PRESETS,
 * } from '@/lib/meshy';
 *
 * // Create config from preset
 * const config = createGenerationConfig('npc_character');
 *
 * // Start generation with preset polycount
 * const taskId = await createImageTo3DTask({
 *   image_url: imageUrl,
 *   target_polycount: config.targetPolycount,
 *   topology: config.topology,
 *   enable_pbr: config.enablePBR,
 * });
 * ```
 */

// Types
export type {
  MeshyAIModel,
  MeshTopology,
  MeshyArtStyle,
  MeshySymmetryMode,
  MeshyPoseMode,
  MeshyTaskResponse,
  MeshyTask,
  ImageTo3DOptions,
  MultiImageTo3DOptions,
  TextTo3DOptions,
  RetextureOptions,
  RiggingOptions,
  RiggingTaskResult,
  AssetClass,
  PolycountPreset,
  MeshyGenerationConfig,
} from "./types";

// Client functions
export {
  createImageTo3DTask,
  createTextTo3DPreviewTask,
  createTextTo3DRefineTask,
  createRetextureTask,
  createRiggingTask,
  getTaskStatus,
  getTaskStatusV1,
  getTaskStatusV2,
  getRiggingTaskStatus,
} from "./client";

// Constants and presets
export {
  MESHY_API_V1,
  MESHY_API_V2,
  MESHY_ENDPOINTS,
  MESHY_DOCS,
  POLYCOUNT_PRESETS,
  DEFAULT_GENERATION_CONFIG,
  DEFAULT_AI_MODEL,
  DEFAULT_TOPOLOGY,
  DEFAULT_TEXTURE_RESOLUTION,
  DEFAULT_CHARACTER_HEIGHT,
  THREE_JS_BEST_PRACTICES,
  getPolycountPreset,
  getRecommendedPolycount,
  createGenerationConfig,
  validatePolycount,
} from "./constants";

// Pipeline functions
export {
  startImageTo3D,
  pollTaskStatus as pollImageTo3DStatus,
  type ImageTo3DPipelineResult,
} from "./image-to-3d";

export {
  startTextTo3DPreview,
  startTextTo3DRefine,
  startTextTo3D,
  pollTextTo3DStatus,
} from "./text-to-3d";

export {
  pollTaskStatus,
  MeshyTaskError,
  type PollTaskResult,
  type PollOptions,
  type TextureUrls,
} from "./poll-task";
