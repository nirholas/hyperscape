/**
 * Service Exports
 * Central export point for all specialized services
 */

// Service Factory (preferred for API routes and components)
export { ServiceFactory, getServiceFactory } from "./service-factory";

// VRM Services
export { VRMConverter, convertGLBToVRM } from "@/services/vrm/VRMConverter";
export type {
  VRMConversionOptions,
  VRMConversionResult,
} from "@/services/vrm/VRMConverter";
export * from "@/services/vrm/BoneMappings";

// Fitting Services
export { ArmorFittingService } from "@/services/fitting/ArmorFittingService";
export type {
  BodyRegion,
  FittingConfig,
} from "@/services/fitting/ArmorFittingService";
export { MeshFittingService } from "@/services/fitting/MeshFittingService";
export type { MeshFittingParameters } from "@/services/fitting/MeshFittingService";
export { WeightTransferService } from "@/services/fitting/WeightTransferService";
export { WeaponFittingService } from "@/services/fitting/WeaponFittingService";
export type {
  WeaponAttachmentOptions,
  WeaponAttachmentResult,
} from "@/services/fitting/WeaponFittingService";

// Processing Services
export { AssetNormalizationService } from "@/services/processing/AssetNormalizationService";
export type { NormalizedAssetResult } from "@/services/processing/AssetNormalizationService";

// Hand Rigging Services
export { HandPoseDetectionService } from "@/services/hand-rigging/HandPoseDetectionService";
export { HandRiggingService } from "@/services/hand-rigging/HandRiggingService";
export { HandSegmentationService } from "@/services/hand-rigging/HandSegmentationService";
export { OrthographicHandRenderer } from "@/services/hand-rigging/OrthographicHandRenderer";
export { SimpleHandRiggingService } from "@/services/hand-rigging/SimpleHandRiggingService";

// Animation Retargeting Services
export { AnimationRetargeter } from "@/services/retargeting/AnimationRetargeter";
export { retargetAnimation } from "@/services/retargeting/AnimationRetargeting";
export { AutoSkinSolver } from "@/services/retargeting/AutoSkinSolver";
export { DistanceSolver } from "@/services/retargeting/DistanceSolver";
export { DistanceChildTargetingSolver } from "@/services/retargeting/DistanceChildTargetingSolver";
export { WeightTransferSolver } from "@/services/retargeting/WeightTransferSolver";
export { SkeletonRetargeter } from "@/services/retargeting/SkeletonRetargeter";

// Generation Services
export { SpriteGenerationService } from "@/services/generation/SpriteGenerationService";
