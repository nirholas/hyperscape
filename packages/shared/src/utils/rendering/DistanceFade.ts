/**
 * Distance-based entity fade using dithered dissolve shader.
 * Falls back to opacity for VRM/incompatible materials.
 */

import THREE from "../../extras/three/three";
import { DISTANCE_CONSTANTS } from "../../constants/GameConstants";

export interface DistanceFadeConfig {
  fadeStart: number;
  fadeEnd: number;
  fadeStartSq?: number;
  fadeEndSq?: number;
}

/** Pre-built configs for entity types */
export const ENTITY_FADE_CONFIGS = {
  MOB: {
    fadeStart: DISTANCE_CONSTANTS.RENDER.MOB_FADE_START,
    fadeEnd: DISTANCE_CONSTANTS.RENDER.MOB,
    fadeStartSq: DISTANCE_CONSTANTS.RENDER_SQ.MOB_FADE_START,
    fadeEndSq: DISTANCE_CONSTANTS.RENDER_SQ.MOB,
  },
  NPC: {
    fadeStart: DISTANCE_CONSTANTS.RENDER.NPC_FADE_START,
    fadeEnd: DISTANCE_CONSTANTS.RENDER.NPC,
    fadeStartSq: DISTANCE_CONSTANTS.RENDER_SQ.NPC_FADE_START,
    fadeEndSq: DISTANCE_CONSTANTS.RENDER_SQ.NPC,
  },
  PLAYER: {
    fadeStart: DISTANCE_CONSTANTS.RENDER.PLAYER_FADE_START,
    fadeEnd: DISTANCE_CONSTANTS.RENDER.PLAYER,
    fadeStartSq: DISTANCE_CONSTANTS.RENDER_SQ.PLAYER_FADE_START,
    fadeEndSq: DISTANCE_CONSTANTS.RENDER_SQ.PLAYER,
  },
} as const;

export const enum FadeState {
  VISIBLE = 0,
  FADING = 1,
  CULLED = 2,
}

// Shader code for dithered dissolve (uses discard, not alpha blending)
const DISSOLVE_SHADER_UNIFORMS = `
uniform float uFadeAmount;
uniform float uDitherScale;
`;

const DISSOLVE_SHADER_FRAGMENT = `
vec2 ditherCoord = gl_FragCoord.xy * uDitherScale;
float hash = fract(sin(dot(ditherCoord, vec2(12.9898, 78.233))) * 43758.5453);
float threshold = hash + uFadeAmount - 0.5;
if (threshold > 0.5) discard;
`;

/** Apply dissolve shader to material, returns uniform refs for updating fade */
function applyDissolveShader(material: THREE.Material): {
  fadeAmount: { value: number };
  ditherScale: { value: number };
} | null {
  if (!material || typeof material.onBeforeCompile !== "function") return null;

  // Check if already patched
  const matWithUniforms = material as THREE.Material & {
    _dissolveUniforms?: {
      fadeAmount: { value: number };
      ditherScale: { value: number };
    };
  };
  if (matWithUniforms._dissolveUniforms)
    return matWithUniforms._dissolveUniforms;

  const uniforms = { fadeAmount: { value: 0.0 }, ditherScale: { value: 0.01 } };
  const originalOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    originalOnBeforeCompile?.call(material, shader, renderer);

    shader.uniforms.uFadeAmount = uniforms.fadeAmount;
    shader.uniforms.uDitherScale = uniforms.ditherScale;
    shader.vertexShader = DISSOLVE_SHADER_UNIFORMS + shader.vertexShader;
    shader.fragmentShader = DISSOLVE_SHADER_UNIFORMS + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `#include <alphatest_fragment>\n${DISSOLVE_SHADER_FRAGMENT}`,
    );
  };

  material.needsUpdate = true;
  matWithUniforms._dissolveUniforms = uniforms;
  return uniforms;
}

export interface FadeUpdateResult {
  state: FadeState;
  fadeAmount: number;
  distanceSq: number;
  visible: boolean;
}

// Reusable result to avoid allocations
const _fadeResult: FadeUpdateResult = {
  state: FadeState.VISIBLE,
  fadeAmount: 0,
  distanceSq: 0,
  visible: true,
};

/** Manages distance-based fade for an entity (shader dissolve or opacity fallback) */
export class DistanceFadeController {
  private config: Required<DistanceFadeConfig>;
  private rootObject: THREE.Object3D;
  private materialUniforms: Array<{
    fadeAmount: { value: number };
    ditherScale: { value: number };
  }> = [];
  private useShaderFade: boolean = false;
  private lastState: FadeState = FadeState.VISIBLE;
  private lastFadeAmount: number = 0;

  /**
   * Create a new DistanceFadeController
   *
   * @param rootObject - The root Object3D of the entity (typically entity.node or entity.mesh)
   * @param config - Fade configuration (fadeStart, fadeEnd distances)
   * @param enableShaderFade - Whether to attempt shader-based dissolve (default: true)
   */
  constructor(
    rootObject: THREE.Object3D,
    config: DistanceFadeConfig,
    enableShaderFade: boolean = true,
  ) {
    this.rootObject = rootObject;
    this.config = {
      fadeStart: config.fadeStart,
      fadeEnd: config.fadeEnd,
      fadeStartSq: config.fadeStartSq ?? config.fadeStart * config.fadeStart,
      fadeEndSq: config.fadeEndSq ?? config.fadeEnd * config.fadeEnd,
    };

    if (enableShaderFade) {
      this.initializeShaderFade();
    }
  }

  /**
   * Initialize shader-based fade for all meshes in the hierarchy
   */
  private initializeShaderFade(): void {
    this.rootObject.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        for (const material of materials) {
          // Skip VRM materials and other special materials
          if (this.isMaterialIncompatible(material)) {
            continue;
          }

          const uniforms = applyDissolveShader(material);
          if (uniforms) {
            this.materialUniforms.push(uniforms);
            this.useShaderFade = true;
          }
        }
      }
    });
  }

  private isMaterialIncompatible(material: THREE.Material): boolean {
    if (material.name?.includes("VRM") || material.name?.includes("MToon"))
      return true;
    if (
      material instanceof THREE.ShaderMaterial ||
      material instanceof THREE.RawShaderMaterial
    )
      return true;
    if (
      (material as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial
    )
      return true;
    return false;
  }

  /** Update fade based on XZ distance from camera */
  update(
    cameraX: number,
    cameraZ: number,
    entityX: number,
    entityZ: number,
  ): FadeUpdateResult {
    const dx = entityX - cameraX;
    const dz = entityZ - cameraZ;
    const distanceSq = dx * dx + dz * dz;

    let state: FadeState;
    let fadeAmount: number;

    if (distanceSq <= this.config.fadeStartSq) {
      state = FadeState.VISIBLE;
      fadeAmount = 0;
    } else if (distanceSq >= this.config.fadeEndSq) {
      state = FadeState.CULLED;
      fadeAmount = 1;
    } else {
      state = FadeState.FADING;
      fadeAmount =
        (distanceSq - this.config.fadeStartSq) /
        (this.config.fadeEndSq - this.config.fadeStartSq);
    }

    if (
      state !== this.lastState ||
      Math.abs(fadeAmount - this.lastFadeAmount) > 0.01
    ) {
      this.applyFade(state, fadeAmount);
      this.lastState = state;
      this.lastFadeAmount = fadeAmount;
    }

    _fadeResult.state = state;
    _fadeResult.fadeAmount = fadeAmount;
    _fadeResult.distanceSq = distanceSq;
    _fadeResult.visible = state !== FadeState.CULLED;
    return _fadeResult;
  }

  private applyFade(state: FadeState, fadeAmount: number): void {
    if (state === FadeState.CULLED) {
      this.rootObject.visible = false;
      return;
    }
    this.rootObject.visible = true;

    if (this.useShaderFade && this.materialUniforms.length > 0) {
      for (const uniforms of this.materialUniforms) {
        uniforms.fadeAmount.value = fadeAmount;
      }
    } else {
      this.applyOpacityFade(fadeAmount);
    }
  }

  private applyOpacityFade(fadeAmount: number): void {
    this.rootObject.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.material) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const mat of materials) {
        if ("opacity" in mat) {
          (mat as THREE.MeshStandardMaterial).opacity = 1 - fadeAmount;
          (mat as THREE.MeshStandardMaterial).transparent = fadeAmount > 0;
        }
      }
    });
  }

  setCulled(): void {
    this.applyFade(FadeState.CULLED, 1);
    this.lastState = FadeState.CULLED;
    this.lastFadeAmount = 1;
  }

  setVisible(): void {
    this.applyFade(FadeState.VISIBLE, 0);
    this.lastState = FadeState.VISIBLE;
    this.lastFadeAmount = 0;
  }

  setConfig(config: Partial<DistanceFadeConfig>): void {
    if (config.fadeStart !== undefined) {
      this.config.fadeStart = config.fadeStart;
      this.config.fadeStartSq = config.fadeStart * config.fadeStart;
    }
    if (config.fadeEnd !== undefined) {
      this.config.fadeEnd = config.fadeEnd;
      this.config.fadeEndSq = config.fadeEnd * config.fadeEnd;
    }
  }

  getState(): FadeState {
    return this.lastState;
  }
  getFadeAmount(): number {
    return this.lastFadeAmount;
  }
  isVisible(): boolean {
    return this.lastState !== FadeState.CULLED;
  }
  hasShaderFade(): boolean {
    return this.useShaderFade;
  }

  dispose(): void {
    this.materialUniforms.length = 0;
    this.useShaderFade = false;
  }
}
