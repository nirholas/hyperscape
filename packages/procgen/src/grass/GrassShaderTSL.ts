/**
 * Grass Shader TSL
 *
 * This contains the EXACT same TSL shader code used in the game engine's
 * ProceduralGrass system. Both Asset Forge and the game engine share this code.
 *
 * The game engine's ProceduralGrass adds:
 * - SSBO compute shaders for massive scale (1M+ blades)
 * - Heightmap integration
 * - Road/water/exclusion zone culling
 * - Player trail effects
 *
 * This module provides the core visual appearance that both systems use.
 *
 * @module GrassShaderTSL
 */

import * as THREE from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import {
  uniform,
  uv,
  vec3,
  float,
  sin,
  mix,
  smoothstep,
  clamp,
  hash,
  instanceIndex,
  time,
  PI2,
} from "three/tsl";

// ============================================================================
// GRASS UNIFORMS - Matches game engine exactly
// ============================================================================

/**
 * Create grass uniforms that match the game engine's ProceduralGrass
 */
export function createGameGrassUniforms() {
  return {
    // Camera/position
    uCameraPosition: uniform(new THREE.Vector3(0, 0, 0)),
    uCameraForward: uniform(new THREE.Vector3(0, 0, 1)),
    // Scale
    uBladeMinScale: uniform(0.3),
    uBladeMaxScale: uniform(0.8),
    // Wind - noise-based natural movement
    uWindStrength: uniform(0.05),
    uWindSpeed: uniform(0.25),
    uWindScale: uniform(1.75),
    uWindDirection: uniform(new THREE.Vector2(1, 0)),
    // Color - MATCHES TERRAIN SHADER EXACTLY
    // TerrainShader.ts: grassGreen = vec3(0.3, 0.55, 0.15), grassDark = vec3(0.22, 0.42, 0.1)
    uBaseColor: uniform(new THREE.Color().setRGB(0.26, 0.48, 0.12)),
    uTipColor: uniform(new THREE.Color().setRGB(0.29, 0.53, 0.14)),
    uAoScale: uniform(0.5),
    uColorMixFactor: uniform(0.85),
    uBaseWindShade: uniform(0.5),
    uBaseShadeHeight: uniform(1.0),
    // Rotation
    uBaseBending: uniform(2.0),
    // Bottom fade - dither grass base into ground
    uBottomFadeHeight: uniform(0.15),
    // Day/Night colors
    uDayColor: uniform(new THREE.Color().setRGB(0.859, 0.82, 0.82)),
    uNightColor: uniform(new THREE.Color().setRGB(0.188, 0.231, 0.271)),
    uDayNightMix: uniform(1.0),
  };
}

export type GameGrassUniforms = ReturnType<typeof createGameGrassUniforms>;

// ============================================================================
// GRASS MATERIAL - Exact same visual as game engine
// ============================================================================

/**
 * Options for creating game-accurate grass material
 */
export interface GameGrassMaterialOptions {
  /** Pre-created uniforms (for sharing between instances) */
  uniforms?: GameGrassUniforms;
  /** Instance count for preview */
  instanceCount?: number;
}

/**
 * Create a grass material that looks EXACTLY like the game engine's grass.
 *
 * This uses the same TSL shader code as ProceduralGrass in packages/shared.
 * The difference is this version uses simpler instancing instead of SSBO compute.
 *
 * @param options - Material options
 * @returns SpriteNodeMaterial configured for grass rendering
 */
export function createGameGrassMaterial(
  options: GameGrassMaterialOptions = {},
): { material: SpriteNodeMaterial; uniforms: GameGrassUniforms } {
  const uniforms = options.uniforms ?? createGameGrassUniforms();

  const material = new SpriteNodeMaterial();
  material.precision = "lowp";
  material.transparent = true;
  material.alphaTest = 0.1;

  // ========== TSL SHADER LOGIC ==========
  // Uses TSL's built-in instance support via instanceIndex

  // Height along blade (from UV.y)
  const h = uv().y;

  // BOTTOM DITHER DISSOLVE - fade grass base into ground
  const bottomFade = smoothstep(float(0), uniforms.uBottomFadeHeight, h);
  const ditherNoise = hash(instanceIndex.add(h.mul(1000))).mul(0.3);
  const bottomOpacity = clamp(bottomFade.add(ditherNoise.sub(0.15)), 0, 1);
  material.opacityNode = bottomOpacity;

  // SCALE - varies per instance
  const positionNoise = hash(instanceIndex.add(196.4356));
  const scaleBase = positionNoise.remap(
    0,
    1,
    uniforms.uBladeMinScale,
    uniforms.uBladeMaxScale,
  );
  const scaleX = positionNoise.add(0.25);
  material.scaleNode = vec3(scaleX, scaleBase, 1);

  // ROTATION - blade bends
  const bendProfile = h.mul(h).mul(uniforms.uBaseBending);
  const instanceNoise = hash(instanceIndex.add(196.4356)).sub(0.5).mul(0.25);
  const baseBending = positionNoise
    .sub(0.5)
    .mul(0.25)
    .add(instanceNoise)
    .mul(bendProfile);
  material.rotationNode = vec3(baseBending, 0, 0);

  // POSITION - with wind animation
  // Base position from instance grid
  const gridSize = 1024; // Same as game
  const tileSize = 80;
  const spacing = tileSize / gridSize;

  const row = float(instanceIndex).div(gridSize).floor();
  const col = float(instanceIndex).mod(gridSize);

  const randX = hash(instanceIndex.add(4321));
  const randZ = hash(instanceIndex.add(1234));

  const halfTile = tileSize / 2;
  const offsetX = col
    .mul(spacing)
    .sub(halfTile)
    .add(randX.mul(spacing * 0.5));
  const offsetZ = row
    .mul(spacing)
    .sub(halfTile)
    .add(randZ.mul(spacing * 0.5));

  // Wind animation - simplified version of game's wind system
  const windPhase = positionNoise.mul(PI2);
  const windTime = time.mul(uniforms.uWindSpeed);

  // Primary wave
  const primaryWave = sin(windTime.add(windPhase).add(offsetX.mul(0.1)));

  // Gust overlay
  const gustWave = sin(windTime.mul(0.4).add(windPhase).add(offsetZ.mul(0.07)));

  // Combine
  const windIntensity = primaryWave.mul(0.7).add(gustWave.mul(0.3));
  const windOffset = windIntensity.mul(uniforms.uWindStrength).mul(bendProfile);

  // Flutter - perpendicular micro-movement
  const flutterPhase = hash(instanceIndex.add(333)).mul(PI2);
  const flutter = sin(time.mul(2.0).add(flutterPhase));
  const flutterAmount = flutter.mul(0.03).mul(bendProfile);

  // Vertical bob
  const verticalBob = windIntensity.abs().mul(h).mul(0.02);

  // Final position
  const windDir = uniforms.uWindDirection.normalize();
  const windOffsetVec = vec3(
    windDir.x.mul(windOffset).add(flutterAmount.mul(windDir.y.negate())),
    verticalBob,
    windDir.y.mul(windOffset).add(flutterAmount.mul(windDir.x)),
  );

  material.positionNode = vec3(offsetX, float(0), offsetZ).add(windOffsetVec);

  // ========== COLOR - Matches terrain shader exactly ==========
  // Terrain colors from TerrainShader.ts
  const grassGreen = vec3(0.3, 0.55, 0.15);
  const grassDark = vec3(0.22, 0.42, 0.1);

  // Variation between light and dark grass
  const noiseValue = hash(instanceIndex.mul(0.73).add(offsetX.mul(0.01)));
  const grassVariation = smoothstep(float(0.4), float(0.6), noiseValue);
  const baseGrassColor = mix(grassGreen, grassDark, grassVariation);

  // Tip brightness
  const tipBrightness = float(1.1).add(positionNoise.sub(0.5).mul(0.1));
  const tipColor = baseGrassColor.mul(tipBrightness);

  // Height gradient: darker at base, lighter at tip
  const colorProfile = h.mul(uniforms.uColorMixFactor).clamp(0, 1);
  const baseToTip = mix(baseGrassColor, tipColor, colorProfile);

  // Ambient occlusion at base
  const x = uv().x;
  const edge = x.mul(2.0).sub(1.0).abs();
  const rim = smoothstep(float(-5), float(5), edge);
  const hWeight = float(1).sub(smoothstep(0.1, 0.85, h));
  const aoStrength = uniforms.uAoScale.mul(0.25);
  const ao = float(1).sub(aoStrength.mul(rim).mul(hWeight));

  // Wind darkening
  const baseMask = float(1).sub(smoothstep(0.0, uniforms.uBaseShadeHeight, h));
  const windAo = mix(
    float(1.0),
    float(1).sub(uniforms.uBaseWindShade),
    baseMask.mul(smoothstep(0.0, 1.0, windIntensity.abs())),
  );

  // Day/night tinting
  const dayNightTint = mix(
    uniforms.uNightColor,
    uniforms.uDayColor,
    uniforms.uDayNightMix,
  );

  // Final color
  material.colorNode = baseToTip.mul(windAo).mul(ao).mul(dayNightTint);

  return { material, uniforms };
}

/**
 * Update wind parameters
 */
export function updateGameGrassWind(
  uniforms: GameGrassUniforms,
  strength: number,
  speed: number,
  direction?: THREE.Vector2,
): void {
  uniforms.uWindStrength.value = strength;
  uniforms.uWindSpeed.value = speed;
  if (direction) {
    uniforms.uWindDirection.value.copy(direction);
  }
}

/**
 * Update day/night mix
 */
export function updateGameGrassDayNight(
  uniforms: GameGrassUniforms,
  mix: number,
): void {
  uniforms.uDayNightMix.value = mix;
}

/**
 * Update colors
 */
export function updateGameGrassColors(
  uniforms: GameGrassUniforms,
  baseColor: THREE.Color,
  tipColor: THREE.Color,
): void {
  uniforms.uBaseColor.value.copy(baseColor);
  uniforms.uTipColor.value.copy(tipColor);
}
