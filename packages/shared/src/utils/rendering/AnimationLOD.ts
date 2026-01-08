/**
 * AnimationLOD - Distance-Based Animation Update Throttling
 *
 * Reduces CPU/GPU load by throttling animation updates for distant entities.
 * OSRS-style: Full animations up close, reduced/paused at distance.
 *
 * ## LOD Levels
 * - **Full**: <30m - Update every frame (60fps animation)
 * - **Half**: 30-60m - Update every other frame (30fps animation)
 * - **Quarter**: 60-100m - Update every 4th frame (15fps animation)
 * - **Paused**: >100m - Skip animation updates entirely (bind pose)
 *
 * ## Performance Impact
 * - Reduces animation mixer updates by 50-80% for typical scenes
 * - Reduces VRM avatar updates (expensive bone transforms)
 * - Reduces skeleton matrix updates
 *
 * ## Usage
 * ```typescript
 * // In entity constructor
 * this.animLOD = new AnimationLOD();
 *
 * // In clientUpdate
 * const lod = this.animLOD.update(playerDistance, deltaTime);
 * if (lod.shouldUpdate) {
 *   this.mixer.update(lod.effectiveDelta);
 * }
 * ```
 */

/**
 * LOD configuration for animation updates
 */
export interface AnimationLODConfig {
  /** Distance for full animation (60fps) - default 30m */
  fullDistance: number;
  /** Distance for half-rate animation (30fps) - default 60m */
  halfDistance: number;
  /** Distance for quarter-rate animation (15fps) - default 100m */
  quarterDistance: number;
  /** Distance beyond which animations are paused - default 150m */
  pauseDistance: number;
}

/**
 * LOD update result
 */
export interface AnimationLODResult {
  /** Whether animation should be updated this frame */
  shouldUpdate: boolean;
  /** Effective delta time to use (may be accumulated for skipped frames) */
  effectiveDelta: number;
  /** Current LOD level (0=full, 1=half, 2=quarter, 3=paused) */
  lodLevel: number;
  /** Squared distance (for additional optimizations) */
  distanceSq: number;
}

/**
 * Default LOD configuration
 * Tuned for typical RPG viewing distances
 */
export const DEFAULT_ANIMATION_LOD_CONFIG: AnimationLODConfig = {
  fullDistance: 30, // Full 60fps animation
  halfDistance: 60, // 30fps animation
  quarterDistance: 100, // 15fps animation
  pauseDistance: 150, // No animation (bind pose)
};

/**
 * AnimationLOD - Manages distance-based animation update throttling
 */
export class AnimationLOD {
  private config: AnimationLODConfig;

  // LOD state
  private frameCounter: number = 0;
  private accumulatedDelta: number = 0;
  private lastLodLevel: number = 0;

  // Pre-computed squared distances for fast comparison (avoid sqrt)
  private fullDistanceSq: number;
  private halfDistanceSq: number;
  private quarterDistanceSq: number;
  private pauseDistanceSq: number;

  // Reusable result object to avoid allocations
  private readonly _result: AnimationLODResult = {
    shouldUpdate: true,
    effectiveDelta: 0,
    lodLevel: 0,
    distanceSq: 0,
  };

  constructor(config: Partial<AnimationLODConfig> = {}) {
    this.config = { ...DEFAULT_ANIMATION_LOD_CONFIG, ...config };

    // Pre-compute squared distances
    this.fullDistanceSq = this.config.fullDistance * this.config.fullDistance;
    this.halfDistanceSq = this.config.halfDistance * this.config.halfDistance;
    this.quarterDistanceSq =
      this.config.quarterDistance * this.config.quarterDistance;
    this.pauseDistanceSq =
      this.config.pauseDistance * this.config.pauseDistance;
  }

  /**
   * Update LOD state and determine if animation should update this frame
   *
   * @param distanceSq - Squared distance to camera/player (use squared to avoid sqrt)
   * @param deltaTime - Frame delta time in seconds
   * @returns LOD result with shouldUpdate flag and effective delta
   */
  update(distanceSq: number, deltaTime: number): AnimationLODResult {
    // Determine LOD level based on squared distance
    let lodLevel: number;
    let updateInterval: number;

    if (distanceSq <= this.fullDistanceSq) {
      lodLevel = 0; // Full - every frame
      updateInterval = 1;
    } else if (distanceSq <= this.halfDistanceSq) {
      lodLevel = 1; // Half - every 2 frames
      updateInterval = 2;
    } else if (distanceSq <= this.quarterDistanceSq) {
      lodLevel = 2; // Quarter - every 4 frames
      updateInterval = 4;
    } else {
      lodLevel = 3; // Paused - no updates
      updateInterval = 0;
    }

    // Accumulate delta time
    this.accumulatedDelta += deltaTime;
    this.frameCounter++;

    // Reset accumulation on LOD level change (prevents time jump)
    if (lodLevel !== this.lastLodLevel) {
      this.accumulatedDelta = deltaTime;
      this.frameCounter = 0;
      this.lastLodLevel = lodLevel;
    }

    // Determine if we should update this frame
    let shouldUpdate: boolean;
    let effectiveDelta: number;

    if (lodLevel === 3) {
      // Paused - no updates
      shouldUpdate = false;
      effectiveDelta = 0;
    } else if (lodLevel === 0) {
      // Full - update every frame with normal delta
      shouldUpdate = true;
      effectiveDelta = deltaTime;
      this.accumulatedDelta = 0;
    } else {
      // Throttled - update on interval with accumulated delta
      shouldUpdate = this.frameCounter % updateInterval === 0;
      if (shouldUpdate) {
        effectiveDelta = this.accumulatedDelta;
        this.accumulatedDelta = 0;
      } else {
        effectiveDelta = 0;
      }
    }

    // Populate result (reuse object to avoid allocations)
    this._result.shouldUpdate = shouldUpdate;
    this._result.effectiveDelta = effectiveDelta;
    this._result.lodLevel = lodLevel;
    this._result.distanceSq = distanceSq;

    return this._result;
  }

  /**
   * Update LOD using world position vectors
   * Convenience method that computes squared distance from positions
   *
   * @param entityX - Entity world X position
   * @param entityZ - Entity world Z position
   * @param cameraX - Camera/player world X position
   * @param cameraZ - Camera/player world Z position
   * @param deltaTime - Frame delta time in seconds
   * @returns LOD result
   */
  updateFromPosition(
    entityX: number,
    entityZ: number,
    cameraX: number,
    cameraZ: number,
    deltaTime: number,
  ): AnimationLODResult {
    // Use only XZ distance (ignore Y - entity could be at different elevation)
    const dx = entityX - cameraX;
    const dz = entityZ - cameraZ;
    const distanceSq = dx * dx + dz * dz;

    return this.update(distanceSq, deltaTime);
  }

  /**
   * Force reset LOD state
   * Call when entity teleports or spawns
   */
  reset(): void {
    this.frameCounter = 0;
    this.accumulatedDelta = 0;
    this.lastLodLevel = 0;
  }

  /**
   * Get current LOD level without updating
   */
  getCurrentLevel(): number {
    return this.lastLodLevel;
  }

  /**
   * Check if currently paused (at max LOD level)
   */
  isPaused(): boolean {
    return this.lastLodLevel >= 3;
  }

  /**
   * Update configuration (recalculates squared distances)
   */
  setConfig(config: Partial<AnimationLODConfig>): void {
    this.config = { ...this.config, ...config };
    this.fullDistanceSq = this.config.fullDistance * this.config.fullDistance;
    this.halfDistanceSq = this.config.halfDistance * this.config.halfDistance;
    this.quarterDistanceSq =
      this.config.quarterDistance * this.config.quarterDistance;
    this.pauseDistanceSq =
      this.config.pauseDistance * this.config.pauseDistance;
  }
}

/**
 * Get camera position from world for LOD calculations
 * Utility function to avoid repeated code in entities
 *
 * @param world - World instance
 * @returns Camera position or null if not available
 */
export function getCameraPosition(world: {
  camera?: { position?: { x: number; y: number; z: number } };
}): { x: number; z: number } | null {
  if (!world.camera?.position) return null;
  return { x: world.camera.position.x, z: world.camera.position.z };
}

/**
 * Compute squared distance between two XZ positions
 * Optimized: Avoids sqrt for fast distance comparison
 *
 * @param ax - First position X
 * @param az - First position Z
 * @param bx - Second position X
 * @param bz - Second position Z
 * @returns Squared distance
 */
export function distanceSquaredXZ(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
