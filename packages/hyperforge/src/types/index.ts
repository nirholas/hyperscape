/**
 * HyperForge Type Definitions - Barrel Export
 *
 * This is the main entry point for all HyperForge types.
 * Import from '@/types' for a unified type experience.
 *
 * Organization:
 * - core.ts: Foundational types (source, category, rarity, combat)
 * - asset.ts: Asset storage types (CDN, Local, Base)
 * - manifest.ts: Game manifest types for import/export
 * - generation.ts: AI generation pipeline types
 * - audio.ts: Audio asset types (voice, SFX, music)
 * - game/*: Game content types (items, NPCs, quests, dialogue)
 *
 * Naming Conventions:
 * - PascalCase for types and interfaces
 * - Lowercase for string literal unions (e.g., "melee" | "ranged")
 * - No I prefix for interfaces
 * - Descriptive names (Item, not IItem; CDNAsset, not CDNAssetData)
 */

// =============================================================================
// CORE TYPES
// =============================================================================

export type {
  AssetSource,
  AssetCategory,
  ModelCategory,
  ManifestType,
  Rarity,
  EquipSlot,
  WeaponType,
  AttackType,
  CombatBonuses,
  Requirements,
  NPCCategory,
  ItemType,
  Position3D,
  GeneratedMetadata,
} from "./core";

export { CATEGORY_TO_MANIFEST, RARITY_COLORS } from "./core";

// =============================================================================
// ASSET TYPES
// =============================================================================

export type {
  SpriteData,
  BaseAsset,
  CDNAsset,
  LocalAsset,
  BaseTemplateAsset,
  HyperForgeAsset,
  // Legacy aliases
  BaseAssetData,
  CDNAssetData,
  LocalAssetData,
  BaseTemplateAssetData,
  AssetData,
} from "./asset";

export { isCDNAsset, isLocalAsset, isBaseTemplateAsset } from "./asset";

// =============================================================================
// MANIFEST TYPES
// =============================================================================

export type {
  ItemManifest,
  NPCManifest,
  ResourceManifest,
  MusicTrackManifest,
  BiomeManifest,
  CategoryDefinition,
  CategoryMetadataSchema,
} from "./manifest";

export {
  CATEGORIES,
  getCategory,
  getAllCategories,
  getCategoriesByManifestType,
} from "./manifest";

// =============================================================================
// GENERATION TYPES
// =============================================================================

export type {
  GenerationPipeline,
  AIProvider,
  GenerationQuality,
  GenerationStatus,
  GenerationProgress,
  GenerationConfig,
  GenerationOptions,
  GenerationResult,
  BatchGenerationJob,
} from "./generation";

// =============================================================================
// AUDIO TYPES
// =============================================================================

export type {
  VoiceAsset,
  SoundEffectAsset,
  SoundEffectCategory,
  MusicAsset,
  MusicCategory,
  AudioManifest,
  VoiceManifest,
  SoundEffectManifest,
  MusicManifest,
  VoiceGenerationRequest,
  SoundEffectGenerationRequest,
  MusicGenerationRequest,
  AudioLibrary,
} from "./audio";

// =============================================================================
// GAME CONTENT TYPES
// =============================================================================

// Re-export all game types
export * from "./game";

// =============================================================================
// SERVICE TYPES
// =============================================================================

export type {
  // Viewer ref types
  HandCaptureViews,
  HandRiggingViewerRef,
  // TensorFlow types
  TensorFlowKeypoint,
  TensorFlowHand,
  // Hand rigging types
  HandBoneStructure,
  SingleHandResult,
  BoneStats,
  HandRiggingMetadata,
  HandRiggingOptions,
  RequiredHandRiggingOptions,
  HandRiggingResult,
  // Debug types
  Point3D,
  DetectedHandPose,
  DetectedPoseResult,
  VertexSegmentationResult,
  BonePositionsMap,
  HandRiggingResultWithDebug,
  // GLTF types
  GLTFPrimitive,
  GLTFMesh,
  GLTFNode,
  GLTFSkin,
  GLTFAccessor,
  GLTFBufferView,
  GLTFTextureInfo,
  GLTFPbrMetallicRoughness,
  GLTFMaterial,
  GLTFTexture,
  GLTFImage,
  GLTFSampler,
  GLTFAnimationChannelTarget,
  GLTFAnimationChannel,
  GLTFAnimationSampler,
  GLTFAnimation,
  GLTFExtensionData,
  GLTFDocument,
  // Normalization types
  AxisConvention,
  FrontDirection,
  NormalizationConventions,
  NormalizationResult,
} from "./service-types";

export { NORMALIZATION_CONVENTIONS, getConvention } from "./service-types";

// =============================================================================
// TYPE UTILITIES
// =============================================================================

export {
  // Branded ID types
  type UserId,
  type AssetId,
  type TaskId,
  type GenerationId,
  type ManifestId,
  type VoiceId,
  type MusicId,
  type SpriteId,
  type DialogueId,
  type ItemId,
  type NpcId,
  // Branded ID creators
  createUserId,
  createAssetId,
  createTaskId,
  createGenerationId,
  // Result types
  type Result,
  type AsyncResult,
  type Option,
  ok,
  err,
  some,
  none,
  // Error handling
  type AppError,
  isError,
  toError,
  toAppError,
  getErrorMessage,
  // Exhaustiveness
  assertNever,
  exhaustive,
  // Validation
  validateOrThrow,
  getOrThrow,
  getOr,
  // Type guards
  isObject,
  isNonEmptyString,
  isPositiveNumber,
  assert,
  assertDefined,
} from "./utils";

// =============================================================================
// LEGACY RE-EXPORTS (for backwards compatibility)
// =============================================================================

/**
 * @deprecated Import from '@/types' instead of '@/lib/cdn/types'
 * These re-exports maintain backwards compatibility during migration.
 */
export type { Rarity as AssetRarity } from "./core";
