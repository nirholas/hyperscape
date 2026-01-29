/**
 * Distance-based entity fade using dithered dissolve shader.
 * Includes camera-to-player occlusion dissolve (RuneScape-style).
 * Falls back to opacity for VRM/incompatible materials.
 */

import THREE from "../../extras/three/three";
import { DISTANCE_CONSTANTS } from "../../constants/GameConstants";
import { GPU_VEG_CONFIG } from "../../systems/shared/world/GPUVegetation";

export interface DistanceFadeConfig {
  fadeStart: number;
  fadeEnd: number;
  fadeStartSq?: number;
  fadeEndSq?: number;
  /** Enable camera-to-player occlusion dissolve (default: true) */
  enableOcclusionDissolve?: boolean;
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

// Shader uniforms for dithered dissolve with occlusion support
const DISSOLVE_SHADER_UNIFORMS = `
uniform float uFadeAmount;
uniform vec3 uCameraPos;
uniform vec3 uPlayerPos;
uniform float uOcclusionEnabled;
`;

// Vertex shader addition to pass world position to fragment
const DISSOLVE_VERTEX_ADDITION = `
varying vec3 vWorldPositionDissolve;
`;

const DISSOLVE_VERTEX_WORLDPOS = `
vWorldPositionDissolve = (modelMatrix * vec4(position, 1.0)).xyz;
`;

// Fragment shader addition for receiving world position
const DISSOLVE_FRAGMENT_VARYING = `
varying vec3 vWorldPositionDissolve;
`;

// Fragment shader code for dithered dissolve with RuneScape 3-style effects
const DISSOLVE_SHADER_FRAGMENT = `
// SCREEN-SPACE 4x4 BAYER DITHERING (RuneScape 3 style)
// 4x4 Bayer matrix: [ 0, 8, 2,10; 12, 4,14, 6; 3,11, 1, 9; 15, 7,13, 5]/16
float ix = mod(floor(gl_FragCoord.x), 4.0);
float iy = mod(floor(gl_FragCoord.y), 4.0);

float bit0_x = mod(ix, 2.0);
float bit1_x = floor(ix * 0.5);
float bit0_y = mod(iy, 2.0);
float bit1_y = floor(iy * 0.5);
float xor0 = abs(bit0_x - bit0_y);
float xor1 = abs(bit1_x - bit1_y);
float ditherValue = (xor0 * 8.0 + bit0_y * 4.0 + xor1 * 2.0 + bit1_y) * 0.0625;

// Base fade from distance
float fadeValue = uFadeAmount;

// NEAR-CAMERA DISSOLVE (prevents hard clipping)
vec3 camToFrag = vWorldPositionDissolve - uCameraPos;
float camDist = length(camToFrag);
float nearCameraFade = 1.0 - smoothstep(${GPU_VEG_CONFIG.NEAR_CAMERA_FADE_END.toFixed(2)}, ${GPU_VEG_CONFIG.NEAR_CAMERA_FADE_START.toFixed(1)}, camDist);
fadeValue = max(fadeValue, nearCameraFade);

// Camera-to-player occlusion dissolve (RuneScape-style cone)
if (uOcclusionEnabled > 0.5) {
  vec3 camToPlayer = uPlayerPos - uCameraPos;
  float ctLengthSq = dot(camToPlayer, camToPlayer);
  float ctLength = sqrt(ctLengthSq);
  vec3 ctDir = camToPlayer / max(ctLength, 0.001);
  
  float projDist = dot(camToFrag, ctDir);
  float inRange = step(${GPU_VEG_CONFIG.OCCLUSION_NEAR_MARGIN.toFixed(1)}, projDist) * step(projDist, ctLength - ${GPU_VEG_CONFIG.OCCLUSION_FAR_MARGIN.toFixed(1)});
  
  vec3 projPoint = uCameraPos + projDist * ctDir;
  float perpDist = distance(vWorldPositionDissolve, projPoint);
  
  float t = clamp(projDist / max(ctLength, 0.001), 0.0, 1.0);
  float coneRadius = ${GPU_VEG_CONFIG.OCCLUSION_CAMERA_RADIUS.toFixed(2)} + t * (${GPU_VEG_CONFIG.OCCLUSION_PLAYER_RADIUS.toFixed(2)} - ${GPU_VEG_CONFIG.OCCLUSION_CAMERA_RADIUS.toFixed(2)}) + ctLength * ${GPU_VEG_CONFIG.OCCLUSION_DISTANCE_SCALE.toFixed(3)};
  
  float edgeStart = coneRadius * (1.0 - ${GPU_VEG_CONFIG.OCCLUSION_EDGE_SHARPNESS.toFixed(2)});
  float occlusionFade = (1.0 - smoothstep(edgeStart, coneRadius, perpDist)) * ${GPU_VEG_CONFIG.OCCLUSION_STRENGTH.toFixed(2)} * inRange;
  fadeValue = max(fadeValue, occlusionFade);
}

// RS3-style: discard when fade >= dither (binary pattern)
// Only discard if there's actual fade happening (prevents holes when fadeValue=0)
if (fadeValue > 0.001 && fadeValue >= ditherValue) discard;
`;

/** Dissolve uniforms structure with occlusion support */
export type DissolveUniforms = {
  fadeAmount: { value: number };
  cameraPos: { value: THREE.Vector3 };
  playerPos: { value: THREE.Vector3 };
  occlusionEnabled: { value: number };
};

/** Apply dissolve shader to material, returns uniform refs for updating fade */
function applyDissolveShader(
  material: THREE.Material,
  enableOcclusion: boolean = true,
): DissolveUniforms | null {
  if (!material || typeof material.onBeforeCompile !== "function") return null;

  // Check if already patched
  const matWithUniforms = material as THREE.Material & {
    _dissolveUniforms?: DissolveUniforms;
  };
  if (matWithUniforms._dissolveUniforms)
    return matWithUniforms._dissolveUniforms;

  const uniforms: DissolveUniforms = {
    fadeAmount: { value: 0.0 },
    cameraPos: { value: new THREE.Vector3() },
    playerPos: { value: new THREE.Vector3() },
    occlusionEnabled: { value: enableOcclusion ? 1.0 : 0.0 },
  };
  const originalOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    originalOnBeforeCompile?.call(material, shader, renderer);

    // Add uniforms
    shader.uniforms.uFadeAmount = uniforms.fadeAmount;
    shader.uniforms.uCameraPos = uniforms.cameraPos;
    shader.uniforms.uPlayerPos = uniforms.playerPos;
    shader.uniforms.uOcclusionEnabled = uniforms.occlusionEnabled;

    // Patch vertex shader
    shader.vertexShader =
      DISSOLVE_SHADER_UNIFORMS + DISSOLVE_VERTEX_ADDITION + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>\n${DISSOLVE_VERTEX_WORLDPOS}`,
    );

    // Patch fragment shader
    shader.fragmentShader =
      DISSOLVE_SHADER_UNIFORMS +
      DISSOLVE_FRAGMENT_VARYING +
      shader.fragmentShader;
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
  private config: Required<DistanceFadeConfig> & {
    enableOcclusionDissolve: boolean;
  };
  private rootObject: THREE.Object3D;
  private materialUniforms: DissolveUniforms[] = [];
  private useShaderFade: boolean = false;
  private lastState: FadeState = FadeState.VISIBLE;
  private lastFadeAmount: number = 0;

  /**
   * Create a new DistanceFadeController
   *
   * @param rootObject - The root Object3D of the entity (typically entity.node or entity.mesh)
   * @param config - Fade configuration (fadeStart, fadeEnd distances, occlusion settings)
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
      enableOcclusionDissolve: config.enableOcclusionDissolve !== false, // Default: enabled
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

          const uniforms = applyDissolveShader(
            material,
            this.config.enableOcclusionDissolve,
          );
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

  /**
   * Update fade based on XZ distance from camera.
   * Also updates camera/player positions for occlusion dissolve.
   *
   * @param cameraX - Camera X position
   * @param cameraZ - Camera Z position (for distance calculation)
   * @param entityX - Entity X position
   * @param entityZ - Entity Z position
   * @param cameraY - Camera Y position (for occlusion, optional)
   * @param playerX - Player X position (for occlusion target, optional)
   * @param playerY - Player Y position (for occlusion target, optional)
   * @param playerZ - Player Z position (for occlusion target, optional)
   */
  update(
    cameraX: number,
    cameraZ: number,
    entityX: number,
    entityZ: number,
    cameraY?: number,
    playerX?: number,
    playerY?: number,
    playerZ?: number,
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

    // Update occlusion uniforms if shader fade is active
    if (this.useShaderFade && this.materialUniforms.length > 0) {
      const camY = cameraY ?? 0;
      const plrX = playerX ?? cameraX;
      const plrY = playerY ?? camY;
      const plrZ = playerZ ?? cameraZ;

      for (const uniforms of this.materialUniforms) {
        uniforms.cameraPos.value.set(cameraX, camY, cameraZ);
        uniforms.playerPos.value.set(plrX, plrY, plrZ);
      }
    }

    _fadeResult.state = state;
    _fadeResult.fadeAmount = fadeAmount;
    _fadeResult.distanceSq = distanceSq;
    _fadeResult.visible = state !== FadeState.CULLED;
    return _fadeResult;
  }

  /**
   * Update only the camera and player positions for occlusion dissolve.
   * Call this when positions change but you don't need full distance-based update.
   */
  updateOcclusionPositions(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    playerX: number,
    playerY: number,
    playerZ: number,
  ): void {
    if (!this.useShaderFade) return;

    for (const uniforms of this.materialUniforms) {
      uniforms.cameraPos.value.set(cameraX, cameraY, cameraZ);
      uniforms.playerPos.value.set(playerX, playerY, playerZ);
    }
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
    if (config.enableOcclusionDissolve !== undefined) {
      this.config.enableOcclusionDissolve = config.enableOcclusionDissolve;
      // Update shader uniforms
      for (const uniforms of this.materialUniforms) {
        uniforms.occlusionEnabled.value = config.enableOcclusionDissolve
          ? 1.0
          : 0.0;
      }
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
  hasOcclusionDissolve(): boolean {
    return this.config.enableOcclusionDissolve && this.useShaderFade;
  }

  dispose(): void {
    this.materialUniforms.length = 0;
    this.useShaderFade = false;
  }
}
