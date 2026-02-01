/**
 * Animated Octahedral Impostor (WebGPU)
 *
 * A billboard mesh that displays animated octahedral impostors.
 * Uses texture array sampling for efficient animation playback.
 *
 * Usage:
 * ```typescript
 * const impostor = new AnimatedOctahedralImpostor(bakeResult);
 * scene.add(impostor);
 *
 * // In render loop:
 * impostor.update(deltaTime); // Advances animation
 * ```
 */

import * as THREE from "three/webgpu";
import type { AnimatedBakeResult } from "./types";
import {
  createAnimatedImpostorMaterial,
  type AnimatedImpostorMaterial,
} from "./AnimatedImpostorMaterialTSL";

/**
 * Configuration for AnimatedOctahedralImpostor
 */
export interface AnimatedOctahedralImpostorConfig {
  /** Billboard scale (default: 1.0) */
  scale?: number;
  /** Alpha clamp threshold (default: 0.05) */
  alphaClamp?: number;
  /** Flip Y axis for atlas sampling */
  flipY?: boolean;
  /** Start paused (default: false) */
  paused?: boolean;
}

/**
 * AnimatedOctahedralImpostor - Single animated billboard impostor
 *
 * Extends THREE.Mesh with animation control methods.
 * The impostor automatically billboards towards the camera and
 * selects the correct sprite based on view direction.
 */
export class AnimatedOctahedralImpostor extends THREE.Mesh<
  THREE.PlaneGeometry,
  AnimatedImpostorMaterial
> {
  /** Bake result containing the texture array */
  private bakeResult: AnimatedBakeResult;

  /** Animation state */
  private animationTime = 0;
  private frameTicker = 0;
  private paused = false;

  /** Frame timing */
  private frameInterval: number;
  private lastFrameTime = 0;

  /**
   * Create an animated octahedral impostor
   *
   * @param bakeResult - Result from AnimatedImpostorBaker
   * @param config - Optional configuration
   */
  constructor(
    bakeResult: AnimatedBakeResult,
    config: AnimatedOctahedralImpostorConfig = {},
  ) {
    const { scale = 1.0, alphaClamp = 0.05, paused = false } = config;

    // Create plane geometry for billboard
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Create animated material (supports asymmetric grids)
    const material = createAnimatedImpostorMaterial(bakeResult.atlasArray, {
      atlasArray: bakeResult.atlasArray,
      spritesPerSide: bakeResult.spritesPerSide,
      spritesX: bakeResult.spritesX ?? bakeResult.spritesPerSide,
      spritesY: bakeResult.spritesY ?? bakeResult.spritesPerSide,
      hemisphere: bakeResult.hemisphere,
      frameCount: bakeResult.frameCount,
      transparent: true,
      alphaClamp,
      scale,
    });

    super(geometry, material);

    this.bakeResult = bakeResult;
    this.paused = paused;
    this.frameInterval = 1000 / bakeResult.animationFPS;

    // Disable frustum culling (billboard position may not match bounds)
    this.frustumCulled = false;

    // Set scale based on bounding sphere
    const diameter = bakeResult.boundingSphere.radius * 2;
    this.scale.setScalar(diameter * scale);
  }

  /**
   * Update animation based on elapsed time
   *
   * @param now - Current timestamp in milliseconds (e.g. performance.now())
   */
  update(now: number): void {
    if (this.paused) return;

    // Advance frame at target FPS
    if (now - this.lastFrameTime >= this.frameInterval) {
      this.lastFrameTime = now;
      // Wrap frame index to loop the animation
      this.frameTicker = (this.frameTicker + 1) % this.bakeResult.frameCount;
      this.material.animatedImpostorUniforms.frameIndex.value =
        this.frameTicker;
    }

    // Note: TSL materials handle billboarding automatically via cameraPosition
    // No need to manually update instance center uniform
  }

  /**
   * Update animation with delta time
   *
   * @param deltaSeconds - Time since last update in seconds
   */
  updateDelta(deltaSeconds: number): void {
    if (this.paused) return;

    this.animationTime += deltaSeconds;

    // Calculate current frame
    const frameFloat = this.animationTime * this.bakeResult.animationFPS;
    const frame = Math.floor(frameFloat) % this.bakeResult.frameCount;

    this.material.animatedImpostorUniforms.frameIndex.value = frame;
  }

  /**
   * Set the current animation frame directly
   *
   * @param frame - Frame index (will be wrapped to frame count)
   */
  setFrame(frame: number): void {
    const wrappedFrame = frame % this.bakeResult.frameCount;
    this.material.animatedImpostorUniforms.frameIndex.value = wrappedFrame;
    this.frameTicker = wrappedFrame;
  }

  /**
   * Get the current animation frame
   */
  getFrame(): number {
    return this.material.animatedImpostorUniforms.frameIndex.value;
  }

  /**
   * Pause animation
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume animation
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if animation is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Set pause state
   */
  setPaused(value: boolean): void {
    this.paused = value;
  }

  /**
   * Reset animation to frame 0
   */
  reset(): void {
    this.animationTime = 0;
    this.frameTicker = 0;
    this.material.animatedImpostorUniforms.frameIndex.value = 0;
    this.lastFrameTime = 0;
  }

  /**
   * Get the bake result
   */
  getBakeResult(): AnimatedBakeResult {
    return this.bakeResult;
  }

  /**
   * Get total frame count
   */
  getFrameCount(): number {
    return this.bakeResult.frameCount;
  }

  /**
   * Get animation FPS
   */
  getAnimationFPS(): number {
    return this.bakeResult.animationFPS;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * AnimatedImpostorController - Manages animation timing for multiple impostors
 *
 * Provides centralized frame timing to keep multiple impostors in sync
 * or with controlled offsets.
 */
export class AnimatedImpostorController {
  private fps: number;
  private frameInterval: number;
  private lastFrameTime = 0;
  private frameCounter = 0;
  private impostors: Set<AnimatedOctahedralImpostor> = new Set();

  /**
   * Create a controller with target FPS
   *
   * @param fps - Animation frames per second (default: 6)
   */
  constructor(fps = 6) {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
  }

  /**
   * Update all registered impostors
   *
   * @param now - Current timestamp in milliseconds
   */
  update(now: number): void {
    if (now - this.lastFrameTime >= this.frameInterval) {
      this.lastFrameTime = now;
      this.frameCounter++;

      for (const impostor of this.impostors) {
        impostor.setFrame(this.frameCounter);
      }
    }
  }

  /**
   * Register an impostor to be controlled
   */
  register(impostor: AnimatedOctahedralImpostor): void {
    this.impostors.add(impostor);
  }

  /**
   * Unregister an impostor
   */
  unregister(impostor: AnimatedOctahedralImpostor): void {
    this.impostors.delete(impostor);
  }

  /**
   * Get current global frame
   */
  getFrame(): number {
    return this.frameCounter;
  }

  /**
   * Set FPS
   */
  setFPS(fps: number): void {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
  }

  /**
   * Get FPS
   */
  getFPS(): number {
    return this.fps;
  }

  /**
   * Get registered impostor count
   */
  getCount(): number {
    return this.impostors.size;
  }

  /**
   * Clear all registered impostors
   */
  clear(): void {
    this.impostors.clear();
  }
}
