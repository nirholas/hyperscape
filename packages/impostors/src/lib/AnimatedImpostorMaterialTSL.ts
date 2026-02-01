/**
 * Animated Impostor Material (WebGPU/TSL)
 *
 * TSL material for rendering animated octahedral impostors.
 * Uses texture array sampling with frame index for animation.
 *
 * Features:
 * - Vertex shader: billboarding + octahedral sprite selection
 * - Fragment shader: texture array sampling with frame modulo
 */

import * as THREE from "three/webgpu";
import {
  texture,
  uniform,
  Fn,
  positionLocal,
  uv,
  cameraPosition,
  vec3,
  vec2,
  vec4,
  float,
  dot,
  normalize,
  cross,
  mix,
  step,
  floor,
  abs,
  sign,
  min,
  round,
  clamp,
  Discard,
  If,
  varying,
} from "three/tsl";
import type { AnimatedImpostorMaterialConfig } from "./types";

/**
 * TSL uniform node type with value property
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLUniform<T> = ReturnType<typeof uniform> & { value: T };

/**
 * Uniforms exposed by the animated impostor material
 */
export interface AnimatedImpostorUniforms {
  spritesPerSide: TSLUniform<number>;
  alphaClamp: TSLUniform<number>;
  frameIndex: TSLUniform<number>;
  frameCount: TSLUniform<number>;
  globalScale: TSLUniform<number>;
  flipYFlag: TSLUniform<number>;
}

/**
 * Extended material type with animated impostor uniforms
 */
export type AnimatedImpostorMaterial = THREE.MeshStandardNodeMaterial & {
  animatedImpostorUniforms: AnimatedImpostorUniforms;
};

/**
 * Create an animated impostor material using TSL for WebGPU.
 *
 * @param arrayTexture - The DataArrayTexture containing all animation frames
 * @param config - Material configuration
 * @returns MeshStandardNodeMaterial with animated impostor support
 */
export function createAnimatedImpostorMaterial(
  arrayTexture: THREE.DataArrayTexture,
  config: AnimatedImpostorMaterialConfig,
): AnimatedImpostorMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  material.transparent = config.transparent ?? true;
  material.metalness = 0.0;
  material.roughness = 0.7;

  // Uniforms
  const spritesPerSide = uniform(config.spritesPerSide ?? 16);
  const alphaClamp = uniform(config.alphaClamp ?? 0.05);
  const useHemiOctahedron = uniform(config.hemisphere ? 1 : 0);
  const frameIndex = uniform(0);
  const frameCount = uniform(config.frameCount);
  const globalScale = uniform(config.scale ?? 1);
  const flipYFlag = uniform(config.flipY ? 1 : 0);

  // Varyings
  const vSprite = varying(vec2(), "vSprite");
  const vSpriteUV = varying(vec2(), "vSpriteUV");

  // Vertex: billboarding + octahedral sprite selection
  material.positionNode = Fn(() => {
    const spritesMinusOne = vec2(spritesPerSide.sub(1.0));

    const cameraPosLocal = cameraPosition; // impostor at origin in local
    const cameraDir = normalize(
      vec3(cameraPosLocal.x, cameraPosLocal.y, cameraPosLocal.z),
    );

    const up = vec3(0.0, 1.0, 0.0).toVar();
    If(useHemiOctahedron, () => {
      up.assign(mix(up, vec3(-1.0, 0.0, 0.0), step(0.999, cameraDir.y)));
    }).Else(() => {
      up.assign(mix(up, vec3(-1.0, 0.0, 0.0), step(0.999, cameraDir.y)));
      up.assign(mix(up, vec3(1.0, 0.0, 0.0), step(cameraDir.y, -0.999)));
    });

    const tangent = normalize(cross(up, cameraDir));
    const bitangent = cross(cameraDir, tangent);
    const projectedVertex = tangent
      .mul(positionLocal.x.mul(globalScale))
      .add(bitangent.mul(positionLocal.y.mul(globalScale)));

    const grid = vec2().toVar();
    If(useHemiOctahedron, () => {
      const octahedron = cameraDir.div(dot(cameraDir, sign(cameraDir)));
      grid.assign(
        vec2(octahedron.x.add(octahedron.z), octahedron.z.sub(octahedron.x))
          .add(1.0)
          .mul(0.5),
      );
    }).Else(() => {
      const dir = cameraDir.div(dot(abs(cameraDir), vec3(1.0))).toVar();
      If(dir.y.lessThan(0.0), () => {
        const signNotZero = mix(vec2(1.0), sign(dir.xz), step(0.0, dir.xz));
        const oldX = dir.x;
        dir.x.assign(float(1.0).sub(abs(dir.z)).mul(signNotZero.x));
        dir.z.assign(float(1.0).sub(abs(oldX)).mul(signNotZero.y));
      });
      grid.assign(dir.xz.mul(0.5).add(0.5));
    });

    const spriteGrid = grid.mul(spritesMinusOne);
    vSprite.assign(min(round(spriteGrid), spritesMinusOne));
    vSpriteUV.assign(uv());

    return vec4(projectedVertex, 1.0);
  })();

  // Fragment: sample array layer by frameIndex
  material.colorNode = Fn(() => {
    const frameSize = float(1.0).div(spritesPerSide);
    const uvY = mix(vSpriteUV.y, float(1.0).sub(vSpriteUV.y), flipYFlag);
    const localUV = vec2(vSpriteUV.x, uvY);
    const finalUV = frameSize.mul(
      vSprite.add(clamp(localUV, vec2(0), vec2(1))),
    );

    // Wrap frame index to frame count
    const wrappedFrame = floor(frameIndex.mod(frameCount));

    // Sample the texture array at the frame layer
    // For DataArrayTexture, use texture(tex, uv).depth(layer)
    // Pass wrappedFrame as float - TSL should convert internally for WGSL
    const spriteColor = texture(arrayTexture, finalUV).depth(wrappedFrame);

    If(spriteColor.a.lessThanEqual(alphaClamp), () => {
      Discard();
    });

    return spriteColor;
  })();

  // Store uniforms for runtime updates
  // Cast to extended type for property assignment
  const animatedMaterial = material as AnimatedImpostorMaterial;
  animatedMaterial.animatedImpostorUniforms = {
    spritesPerSide,
    alphaClamp,
    frameIndex,
    frameCount,
    globalScale,
    flipYFlag,
  };

  return animatedMaterial;
}

/**
 * Instanced animated impostor uniforms for per-instance rendering
 */
export interface InstancedAnimatedImpostorUniforms {
  spritesPerSide: { value: number };
  alphaClamp: { value: number };
  frameIndex: { value: number };
  frameCount: { value: number };
  globalScale: { value: number };
  flipYFlag: { value: number };
  yawSpriteOffset: { value: number };
}

/**
 * Extended material type for instanced animated impostors
 */
export type InstancedAnimatedImpostorMaterial =
  THREE.MeshStandardNodeMaterial & {
    instancedAnimatedUniforms: InstancedAnimatedImpostorUniforms;
    instanceStateStorage: ReturnType<typeof import("three/tsl").storage>;
    instanceOffsetStorage: ReturnType<typeof import("three/tsl").storage>;
    instanceVariantStorage: ReturnType<typeof import("three/tsl").storage>;
  };

/**
 * Configuration for instanced animated impostor material
 */
export interface InstancedAnimatedMaterialConfig
  extends AnimatedImpostorMaterialConfig {
  instanceCount: number;
  variantCounts?: number[]; // Frame counts per variant
  variantBases?: number[]; // Base layer indices per variant
}
