/**
 * Service Factory
 * Initializes and provides access to all specialized services
 *
 * Usage:
 *   import { getServiceFactory } from "@/lib/services";
 *   const armorService = getServiceFactory().getArmorFittingService();
 *
 * Benefits:
 * - Singleton pattern ensures consistent service instances
 * - Enables future dependency injection, lazy loading, mocking
 * - Centralized service lifecycle management
 */

import * as THREE from "three";
import { logger } from "@/lib/utils";

const log = logger.child("ServiceFactory");
import { VRMConverter } from "@/services/vrm/VRMConverter";
import { ArmorFittingService } from "@/services/fitting/ArmorFittingService";
import { MeshFittingService } from "@/services/fitting/MeshFittingService";
import { WeaponFittingService } from "@/services/fitting/WeaponFittingService";
import { AssetNormalizationService } from "@/services/processing/AssetNormalizationService";
import { HandRiggingService } from "@/services/hand-rigging/HandRiggingService";
// AnimationRetargeter is instantiated per-use with specific skeletons
import type { AnimationRetargeter } from "@/services/retargeting/AnimationRetargeter";
export { AnimationRetargeter } from "@/services/retargeting/AnimationRetargeter";
import { SpriteGenerationService } from "@/services/generation/SpriteGenerationService";

/**
 * Service Factory
 * Singleton pattern for service initialization
 */
export class ServiceFactory {
  private static instance: ServiceFactory;

  private vrmConverter: VRMConverter;
  private armorFittingService: ArmorFittingService;
  private meshFittingService: MeshFittingService;
  private weaponFittingService: WeaponFittingService;
  private normalizationService: AssetNormalizationService;
  private handRiggingService: HandRiggingService | null;
  private spriteGenerationService: SpriteGenerationService;

  private constructor() {
    // Initialize services
    this.vrmConverter = new VRMConverter();
    this.armorFittingService = new ArmorFittingService();
    this.meshFittingService = new MeshFittingService();
    this.weaponFittingService = new WeaponFittingService();
    this.normalizationService = new AssetNormalizationService();

    // Hand rigging may not be available if dependencies are missing
    try {
      this.handRiggingService = new HandRiggingService();
    } catch {
      log.warn(
        "HandRiggingService not available - dependencies may be missing",
      );
      this.handRiggingService = null;
    }

    this.spriteGenerationService = new SpriteGenerationService();
  }

  static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }

  getVRMConverter(): VRMConverter {
    return this.vrmConverter;
  }

  getArmorFittingService(): ArmorFittingService {
    return this.armorFittingService;
  }

  getMeshFittingService(): MeshFittingService {
    return this.meshFittingService;
  }

  getWeaponFittingService(): WeaponFittingService {
    return this.weaponFittingService;
  }

  getNormalizationService(): AssetNormalizationService {
    return this.normalizationService;
  }

  getHandRiggingService(): HandRiggingService | null {
    return this.handRiggingService;
  }

  /**
   * AnimationRetargeter is instantiated per-use with specific skeletons.
   * Import and construct it directly:
   *   import { AnimationRetargeter } from "@/services/retargeting/AnimationRetargeter";
   *   const retargeter = new AnimationRetargeter(animations, sourceSkeleton, targetSkeleton);
   *
   * @deprecated Use direct import instead
   */
  async createAnimationRetargeter(
    sourceAnimations: THREE.AnimationClip[],
    sourceSkeleton: THREE.Skeleton,
    targetSkeleton: THREE.Skeleton,
  ): Promise<AnimationRetargeter> {
    // Dynamic import to avoid issues with the constructor
    const { AnimationRetargeter: Retargeter } = await import(
      "@/services/retargeting/AnimationRetargeter"
    );
    return new Retargeter(sourceAnimations, sourceSkeleton, targetSkeleton);
  }

  getSpriteGenerationService(): SpriteGenerationService {
    return this.spriteGenerationService;
  }
}

/**
 * Convenience function to get service factory instance
 */
export function getServiceFactory(): ServiceFactory {
  return ServiceFactory.getInstance();
}
