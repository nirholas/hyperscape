/**
 * VegetationSsboUtils - Shared compute shader utilities for vegetation systems
 *
 * Provides reusable TSL functions for:
 * - Stochastic LOD (density falloff with distance)
 * - Frustum culling with NDC padding
 * - Alpha masking from terrain type texture
 * - Heightmap Y offset sampling
 * - Position wrapping for player-following tiles
 *
 * Ported from Revo Realms ssboUtils.ts
 *
 * @module VegetationSsboUtils
 */

import THREE from "../../../extras/three/three";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  step,
  hash,
  instanceIndex,
  mix,
  max,
  mod,
  texture,
  smoothstep,
  EPSILON,
} from "three/tsl";
import { tslUtils } from "../../../utils/TSLUtils";

// TSL types - use any for dynamic TSL function signatures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLFn = (...args: any[]) => any;

/**
 * Texture references for terrain sampling
 * These must be set by the consuming system before use
 */
let grassMapTexture: THREE.Texture | null = null;
let heightmapTexture: THREE.Texture | null = null;
let localExclusionTexture: THREE.Texture | null = null;
let localExclusionTileSize = 130; // Size of the grass tile in meters
let heightmapMax = 100; // Default max height, should be set from texture userData

// Exclusion configuration
// Grass grows right up to the road edge and fades smoothly onto the road
// Exclusion influence: 0 = no exclusion, 0.5 = edge blend zone, 1.0 = fully excluded
const EXCLUSION_FADE_START = 0.3; // Grass starts fading at this influence
const EXCLUSION_FADE_END = 0.8; // Grass fully gone at this influence

/**
 * Set the grass map texture for alpha computation
 */
export function setGrassMapTexture(tex: THREE.Texture | null): void {
  grassMapTexture = tex;
}

/**
 * Set the local exclusion texture for grass masking (player-centered)
 * This texture covers the grass tile area and uses local coordinates for UV mapping.
 * Exclusion values: 0 = grass can grow, 1 = fully excluded (road/building)
 *
 * @param tex - The exclusion texture (or null to disable)
 * @param tileSize - Size of the grass tile in meters (default: 130)
 */
export function setLocalExclusionTexture(
  tex: THREE.Texture | null,
  tileSize: number = 130,
): void {
  localExclusionTexture = tex;
  localExclusionTileSize = tileSize;
}

/**
 * Get the current local exclusion texture
 */
export function getLocalExclusionTexture(): THREE.Texture | null {
  return localExclusionTexture;
}

/**
 * Set the heightmap texture and max height for Y offset computation
 */
export function setHeightmapTexture(
  tex: THREE.Texture | null,
  maxHeight: number,
): void {
  heightmapTexture = tex;
  heightmapMax = maxHeight;
}

/**
 * Get the current heightmap max value
 */
export function getHeightmapMax(): number {
  return heightmapMax;
}

/**
 * VegetationSsboUtils - Static utility class with shared compute shader functions
 *
 * All functions are TSL Fn definitions that can be called from compute shaders
 */
export class VegetationSsboUtils {
  /**
   * Compute stochastic keep/discard based on distance from player
   *
   * Implements radial density falloff without sqrt for performance.
   * Uses deterministic RNG per instance for stable culling during movement.
   *
   * @param worldPos - World position of the vegetation instance (vec3)
   * @param playerPosition - Player world position (vec3)
   * @param R0 - Inner radius where full density is maintained (float)
   * @param R1 - Outer radius where minimum density is reached (float)
   * @param pMin - Minimum probability at outer radius (float)
   * @returns Flag (0 or 1) indicating keep/discard
   */
  static computeStochasticKeep: TSLFn = Fn(
    // @ts-expect-error TSL array destructuring not typed correctly
    ([
      worldPos = vec3(0),
      playerPosition = vec3(0),
      R0 = float(0),
      R1 = float(0),
      pMin = float(0),
    ]) => {
      // World-space radial thinning using squared distance (no sqrt)
      const dx = worldPos.x.sub(playerPosition.x);
      const dz = worldPos.z.sub(playerPosition.z);
      const distSq = dx.mul(dx).add(dz.mul(dz));

      const R0Sq = R0.mul(R0);
      const R1Sq = R1.mul(R1);

      // t = 0 inside R0, t = 1 at/after R1
      const t = distSq
        .sub(R0Sq)
        .div(max(R1Sq.sub(R0Sq), EPSILON))
        .clamp();

      // Keep probability interpolates from 1 → pMin
      const p = mix(1, pMin, t);

      // Deterministic RNG per blade (stable under wrap)
      const rnd = hash(float(instanceIndex).mul(0.73));

      // Keep if random value is less than probability
      const keep = step(rnd, p);
      return keep;
    },
  );

  /**
   * Compute visibility based on camera frustum culling
   *
   * Projects world position to NDC and checks if within visible bounds.
   * Uses padding to hide culling artifacts during camera rotation.
   *
   * @param worldPos - World position of the vegetation instance (vec3)
   * @param cameraMatrix - Combined projection * view matrix (uniform mat4)
   * @param fX - Projection matrix element [0] for X NDC radius (float)
   * @param fY - Projection matrix element [5] for Y NDC radius (float)
   * @param r - Bounding sphere radius of the vegetation (float)
   * @param padNdcX - X padding in NDC space (affects left and right) (float)
   * @param padNdcYNear - Y padding for near clipping (float)
   * @param padNdcYFar - Y padding for far clipping (float)
   * @returns Flag (0 or 1) indicating visible/hidden
   */
  static computeVisibility: TSLFn = Fn(
    // @ts-expect-error TSL array destructuring not typed correctly
    ([
      worldPos = vec3(0),
      // cameraMatrix passed as uniform from caller
      cameraMatrix,
      fX = float(0),
      fY = float(0),
      r = float(0),
      padNdcX = float(0),
      padNdcYNear = float(0),
      padNdcYFar = float(0),
    ]) => {
      const one = float(1);

      // Transform to clip space
      const clip = cameraMatrix.mul(vec4(worldPos, 1.0));
      const invW = one.div(clip.w);
      const ndc = clip.xyz.mul(invW);

      // Eye depth for proper NDC radius calculation
      // Works for both WebGL and WebGPU
      const eyeDepthAbs = clip.w.abs().max(EPSILON);

      // Calculate NDC radius with padding
      const rNdcX = fX.mul(r).div(eyeDepthAbs).add(padNdcX);
      const rNdcY = fY.mul(r).div(eyeDepthAbs);
      const rNdcYNear = rNdcY.add(padNdcYNear);
      const rNdcYFar = rNdcY.sub(padNdcYFar);

      // X visibility (left and right bounds)
      const visLeft = step(one.negate().sub(rNdcX), ndc.x);
      const visRight = step(ndc.x, one.add(rNdcX));
      const visX = visLeft.mul(visRight);

      // Y visibility (near and far with separate padding)
      const visNear = step(one.negate().sub(rNdcYNear), ndc.y);
      const visFar = step(ndc.y.add(rNdcYFar), one);
      const visY = visNear.mul(visFar);

      // Z visibility (no padding)
      const visZ = step(-1, ndc.z).mul(step(ndc.z, 1));

      return visX.mul(visY).mul(visZ);
    },
  );

  /**
   * Compute alpha/visibility based on terrain grass map and local exclusion texture
   *
   * For infinite procedural worlds, this uses a player-local exclusion texture
   * that covers the grass tile area. UV coordinates are computed from the
   * local offset position (relative to player), not world coordinates.
   *
   * @param worldPos - World position of the vegetation instance (vec3) - used for grass map
   * @param localOffset - Local offset from player position (vec2) - used for exclusion texture
   * @returns Alpha value (0-1 based on masks)
   */
  static computeAlpha: TSLFn = Fn(
    // @ts-expect-error TSL array destructuring not typed correctly
    ([worldPos = vec3(0), localOffset = vec2(0)]) => {
      // Compute grass map alpha using world coordinates (1 if no texture)
      const worldUv = tslUtils.computeMapUvByPosition(worldPos.xz);
      const grassMask = grassMapTexture
        ? step(0.25, texture(grassMapTexture, worldUv).g)
        : float(1);

      // Compute local exclusion mask using local offset coordinates
      // Local offset ranges from -tileSize/2 to +tileSize/2
      // UV = (offset + tileSize/2) / tileSize
      const halfTile = float(localExclusionTileSize / 2);
      const localUv = vec2(
        localOffset.x.add(halfTile).div(localExclusionTileSize),
        localOffset.y.add(halfTile).div(localExclusionTileSize),
      );

      // Sample exclusion texture with smooth fade at edges
      const exclusionMask = localExclusionTexture
        ? float(1).sub(
            smoothstep(
              float(EXCLUSION_FADE_START),
              float(EXCLUSION_FADE_END),
              texture(localExclusionTexture, localUv).r,
            ),
          )
        : float(1);

      // Multiply masks together
      return grassMask.mul(exclusionMask);
    },
  );

  /**
   * Compute Y offset from terrain heightmap
   *
   * Samples the heightmap texture to place vegetation at terrain surface.
   * Note: UV y-coordinate is flipped for proper heightmap sampling.
   *
   * @param worldPos - World position of the vegetation instance (vec3)
   * @returns Y offset value (height at this position)
   */
  static computeYOffset: TSLFn = Fn(
    // @ts-expect-error TSL array destructuring not typed correctly
    ([worldPos = vec3(0)]) => {
      const uvCoord = tslUtils.computeMapUvByPosition(worldPos.xz);

      // If heightmap texture is available, sample it
      if (heightmapTexture) {
        // Flip Y coordinate for proper heightmap sampling
        const fixedUv = vec2(uvCoord.x, float(1).sub(uvCoord.y));
        const height = texture(heightmapTexture, fixedUv).r;
        return height;
      }

      // Fallback: ground level
      return float(0);
    },
  );

  /**
   * Wrap position around tile boundaries as player moves
   *
   * Implements toroidal wrapping so vegetation tile follows the player
   * without visible popping.
   *
   * @param posXZ - Current XZ offset position (vec2)
   * @param playerDeltaXZ - Player movement delta since last frame (vec2)
   * @param tileSize - Size of the vegetation tile (float)
   * @returns Wrapped position as vec3 (x, 0, z)
   */
  static wrapPosition: TSLFn = Fn(
    // @ts-expect-error TSL array destructuring not typed correctly
    ([posXZ = vec2(0), playerDeltaXZ = vec2(0), tileSize = float(0)]) => {
      const halfTile = tileSize.div(2);

      const newOffsetX = mod(
        posXZ.x.sub(playerDeltaXZ.x).add(halfTile),
        tileSize,
      ).sub(halfTile);

      const newOffsetZ = mod(
        posXZ.y.sub(playerDeltaXZ.y).add(halfTile),
        tileSize,
      ).sub(halfTile);

      return vec3(newOffsetX, 0, newOffsetZ);
    },
  );
}
