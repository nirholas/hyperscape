/**
 * Utility Exports
 * Centralized exports for all utility functions
 */

// Helpers (ID generation, sleep, parsing, materials)
export {
  generateId,
  sleep,
  formatBytes,
  createProgressBar,
  parseAssetType,
  parseBuildingType,
  parseWeaponType,
  getPolycountForType,
  MATERIAL_TIERS,
  generateMaterialDescription,
  generateTierBatch,
  DIFFICULTY_LEVELS,
  type MaterialTierKey,
  type DifficultyLevel,
} from "./helpers";

// Weapon utilities
export {
  BONE_MAPPING,
  WEAPON_OFFSETS,
  calculateAvatarHeight,
  calculateWeaponScale,
  createNormalizedWeapon,
  findBone,
  getWorldScale,
  getAttachedBone,
  getWeaponOffset,
} from "./weapon-utils";

// Asset name formatting
export {
  formatAssetName,
  parseMaterialFromName,
  isBaseModel,
  nameToSlug,
} from "./format-asset-name";

// Generation config builder
export {
  buildGenerationConfig,
  type GenerationConfig as BuilderGenerationConfig,
  type BuildConfigOptions,
  type MaterialVariant,
  type MaterialPreset,
} from "./generation-config-builder";

// Typed event emitter
export { TypedEventEmitter } from "./typed-event-emitter";

// Toast notifications
export { toast, notify } from "./toast";

// Centralized logger (Pino-based)
export { logger, pinoLogger, type Logger, type ChildLogger } from "./logger";

// API utilities
export {
  apiFetch,
  fetchJson,
  postJson,
  putJson,
  deleteRequest,
  retryFetch,
  apiResponse,
  apiErrorResponse,
  getErrorMessage,
  isAbortError,
  ApiError,
  type ApiRequestOptions,
} from "./api";

// VRM detection (existing) - import directly from file
// export * from "./vrm-detection";

// Asset converter (existing) - import directly from file
// export * from "./asset-converter";
