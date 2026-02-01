/**
 * Global Mob Atlas
 *
 * Manages a merged texture array containing all mob variants.
 * Enables single-draw-call rendering of all mob impostors.
 *
 * Architecture:
 * - Each mob type is baked separately with AnimatedImpostorBaker
 * - GlobalMobAtlas merges all mob atlases into one DataArrayTexture
 * - Each mob variant has a base frame index and frame count
 * - InstancedAnimatedImpostor uses per-instance uniforms to select variant
 */

import * as THREE from "three/webgpu";
import type {
  AnimatedBakeResult,
  GlobalMobAtlas as GlobalMobAtlasType,
  MobVariantConfig,
} from "./types";

/**
 * GlobalMobAtlasBuilder - Builds merged atlas from individual mob bake results
 */
export class GlobalMobAtlasBuilder {
  /** Collected bake results */
  private bakeResults: AnimatedBakeResult[] = [];

  /** Shared configuration */
  private spritesPerSide = 12;
  private atlasSize = 512;
  private hemisphere = true;
  private animationFPS = 6;

  /**
   * Add a mob variant to the atlas
   *
   * All variants must have the same:
   * - spritesPerSide
   * - atlasSize
   * - hemisphere mode
   *
   * @param bakeResult - Bake result from AnimatedImpostorBaker
   * @throws Error if configuration doesn't match existing variants
   */
  addVariant(bakeResult: AnimatedBakeResult): void {
    // Infer atlas size from texture dimensions
    const incomingAtlasSize = bakeResult.atlasArray.image.width;

    // Validate configuration matches
    if (this.bakeResults.length > 0) {
      const first = this.bakeResults[0];
      if (bakeResult.spritesPerSide !== first.spritesPerSide) {
        throw new Error(
          `[GlobalMobAtlasBuilder] Sprites per side mismatch for ${bakeResult.modelId}: ` +
            `expected ${first.spritesPerSide}, got ${bakeResult.spritesPerSide}`,
        );
      }
      if (bakeResult.hemisphere !== first.hemisphere) {
        throw new Error(
          `[GlobalMobAtlasBuilder] Hemisphere mode mismatch for ${bakeResult.modelId}: ` +
            `expected ${first.hemisphere}, got ${bakeResult.hemisphere}`,
        );
      }
      // CRITICAL: Validate atlas size matches (was missing!)
      if (incomingAtlasSize !== this.atlasSize) {
        throw new Error(
          `[GlobalMobAtlasBuilder] Atlas size mismatch for ${bakeResult.modelId}: ` +
            `expected ${this.atlasSize}x${this.atlasSize}, got ${incomingAtlasSize}x${incomingAtlasSize}. ` +
            `All variants must use the same atlas dimensions.`,
        );
      }
      // Also validate height matches width (should be square)
      const incomingHeight = bakeResult.atlasArray.image.height;
      if (incomingHeight !== incomingAtlasSize) {
        throw new Error(
          `[GlobalMobAtlasBuilder] Atlas must be square for ${bakeResult.modelId}: ` +
            `got ${incomingAtlasSize}x${incomingHeight}`,
        );
      }
    } else {
      // First variant sets the configuration
      this.spritesPerSide = bakeResult.spritesPerSide;
      this.hemisphere = bakeResult.hemisphere;
      this.animationFPS = bakeResult.animationFPS;
      this.atlasSize = incomingAtlasSize;
    }

    this.bakeResults.push(bakeResult);
  }

  /**
   * Build the merged global atlas
   *
   * @returns GlobalMobAtlas with merged texture and variant configs
   */
  build(): GlobalMobAtlasType {
    if (this.bakeResults.length === 0) {
      throw new Error("No variants added to atlas");
    }

    // Calculate total frame count
    let totalFrames = 0;
    const variants = new Map<string, MobVariantConfig>();

    for (const result of this.bakeResults) {
      const config: MobVariantConfig = {
        modelId: result.modelId,
        frameCount: result.frameCount,
        baseFrameIndex: totalFrames,
        scale: 1.0, // Default scale, can be adjusted per-mob
        boundingRadius: result.boundingSphere.radius,
      };
      variants.set(result.modelId, config);
      totalFrames += result.frameCount;
    }

    console.log(
      `[GlobalMobAtlas] Building merged atlas: ${this.bakeResults.length} variants, ${totalFrames} total frames`,
    );

    // Create merged texture array
    const pixelsPerFrame = this.atlasSize * this.atlasSize * 4;
    const mergedData = new Uint8Array(pixelsPerFrame * totalFrames);

    let frameOffset = 0;
    for (const result of this.bakeResults) {
      const sourceData = result.atlasArray.image.data as Uint8Array;

      for (let f = 0; f < result.frameCount; f++) {
        const srcOffset = f * pixelsPerFrame;
        const dstOffset = (frameOffset + f) * pixelsPerFrame;

        // Copy frame data
        for (let i = 0; i < pixelsPerFrame; i++) {
          mergedData[dstOffset + i] = sourceData[srcOffset + i];
        }
      }

      frameOffset += result.frameCount;
    }

    // Create merged DataArrayTexture
    // DataArrayTexture accepts TypedArray at runtime, but TS types are stricter
    const atlasArray = new THREE.DataArrayTexture(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergedData as any,
      this.atlasSize,
      this.atlasSize,
      totalFrames,
    );
    atlasArray.format = THREE.RGBAFormat;
    atlasArray.type = THREE.UnsignedByteType;
    // Use LinearFilter to allow TSL to generate textureSample instead of textureLoad
    // This is required because WGSL textureLoad for texture_2d_array needs 4 params
    atlasArray.minFilter = THREE.LinearFilter;
    atlasArray.magFilter = THREE.LinearFilter;
    atlasArray.wrapS = THREE.ClampToEdgeWrapping;
    atlasArray.wrapT = THREE.ClampToEdgeWrapping;
    atlasArray.generateMipmaps = false;
    atlasArray.needsUpdate = true;

    console.log(
      `[GlobalMobAtlas] Created merged atlas: ${this.atlasSize}x${this.atlasSize}x${totalFrames}`,
    );

    return {
      atlasArray,
      totalFrames,
      variants,
      spritesPerSide: this.spritesPerSide,
      hemisphere: this.hemisphere,
      animationFPS: this.animationFPS,
    };
  }

  /**
   * Get the number of variants added
   */
  get variantCount(): number {
    return this.bakeResults.length;
  }

  /**
   * Clear all added variants
   */
  clear(): void {
    this.bakeResults = [];
  }
}

/**
 * GlobalMobAtlasManager - Singleton manager for the global mob atlas
 *
 * Handles:
 * - Runtime baking of new mob types
 * - Rebuilding merged atlas when new variants are added
 * - Caching and lookup
 */
export class GlobalMobAtlasManager {
  private static instance: GlobalMobAtlasManager | null = null;

  /** Current global atlas (null until first mob is baked) */
  private atlas: GlobalMobAtlasType | null = null;

  /** Builder for accumulating variants */
  private builder = new GlobalMobAtlasBuilder();

  /** Individual bake results by model ID */
  private bakeResults = new Map<string, AnimatedBakeResult>();

  /** Pending bake requests */
  private pendingBakes = new Map<
    string,
    {
      resolve: (result: AnimatedBakeResult) => void;
      reject: (error: Error) => void;
    }[]
  >();

  /** Whether atlas needs rebuild */
  private needsRebuild = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): GlobalMobAtlasManager {
    if (!GlobalMobAtlasManager.instance) {
      GlobalMobAtlasManager.instance = new GlobalMobAtlasManager();
    }
    return GlobalMobAtlasManager.instance;
  }

  /**
   * Check if a mob variant is already in the atlas
   */
  hasVariant(modelId: string): boolean {
    return this.bakeResults.has(modelId);
  }

  /**
   * Get variant configuration by model ID
   */
  getVariantConfig(modelId: string): MobVariantConfig | undefined {
    return this.atlas?.variants.get(modelId);
  }

  /**
   * Register a baked mob variant
   *
   * After registering, call rebuild() to update the merged atlas.
   *
   * @param bakeResult - Bake result from AnimatedImpostorBaker
   */
  registerVariant(bakeResult: AnimatedBakeResult): void {
    if (this.bakeResults.has(bakeResult.modelId)) {
      console.warn(
        `[GlobalMobAtlasManager] Variant ${bakeResult.modelId} already registered, skipping`,
      );
      return;
    }

    console.log(
      `[GlobalMobAtlasManager] Registered variant: ${bakeResult.modelId} (${bakeResult.frameCount} frames)`,
    );

    this.bakeResults.set(bakeResult.modelId, bakeResult);
    this.needsRebuild = true;

    // Resolve any pending requests for this model
    const pending = this.pendingBakes.get(bakeResult.modelId);
    if (pending) {
      for (const { resolve } of pending) {
        resolve(bakeResult);
      }
      this.pendingBakes.delete(bakeResult.modelId);
    }
  }

  /**
   * Rebuild the merged global atlas
   *
   * Call this after registering new variants to update the atlas.
   * Existing atlas is disposed and replaced.
   */
  rebuild(): GlobalMobAtlasType | null {
    if (!this.needsRebuild && this.atlas) {
      return this.atlas;
    }

    if (this.bakeResults.size === 0) {
      return null;
    }

    // Dispose old atlas
    if (this.atlas) {
      this.atlas.atlasArray.dispose();
    }

    // Build new atlas
    this.builder.clear();
    for (const result of this.bakeResults.values()) {
      this.builder.addVariant(result);
    }

    this.atlas = this.builder.build();
    this.needsRebuild = false;

    console.log(
      `[GlobalMobAtlasManager] Rebuilt atlas: ${this.atlas.variants.size} variants, ${this.atlas.totalFrames} frames`,
    );

    return this.atlas;
  }

  /**
   * Get the current global atlas
   *
   * Returns null if no variants have been registered.
   * Call rebuild() first if variants have been added.
   */
  getAtlas(): GlobalMobAtlasType | null {
    if (this.needsRebuild) {
      return this.rebuild();
    }
    return this.atlas;
  }

  /**
   * Get variant index for instanced rendering
   *
   * Returns the index of the variant in the atlas (order of registration).
   * Used for per-instance variant selection in the shader.
   */
  getVariantIndex(modelId: string): number {
    let index = 0;
    for (const id of this.bakeResults.keys()) {
      if (id === modelId) {
        return index;
      }
      index++;
    }
    return -1;
  }

  /**
   * Wait for a variant to be registered
   *
   * Returns immediately if already registered, otherwise waits.
   *
   * @param modelId - Model ID to wait for
   * @returns Promise resolving to the bake result
   */
  waitForVariant(modelId: string): Promise<AnimatedBakeResult> {
    const existing = this.bakeResults.get(modelId);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const pending = this.pendingBakes.get(modelId) ?? [];
      pending.push({ resolve, reject });
      this.pendingBakes.set(modelId, pending);
    });
  }

  /**
   * Get all registered model IDs
   */
  getRegisteredModels(): string[] {
    return Array.from(this.bakeResults.keys());
  }

  /**
   * Get the total number of frames in the atlas
   */
  getTotalFrames(): number {
    return this.atlas?.totalFrames ?? 0;
  }

  /**
   * Get the number of registered variants
   */
  getVariantCount(): number {
    return this.bakeResults.size;
  }

  /**
   * Check if atlas needs rebuild
   */
  get dirty(): boolean {
    return this.needsRebuild;
  }

  /**
   * Dispose of atlas resources
   */
  dispose(): void {
    if (this.atlas) {
      this.atlas.atlasArray.dispose();
      this.atlas = null;
    }
    this.bakeResults.clear();
    this.builder.clear();
    this.needsRebuild = false;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static reset(): void {
    if (GlobalMobAtlasManager.instance) {
      GlobalMobAtlasManager.instance.dispose();
      GlobalMobAtlasManager.instance = null;
    }
  }
}
