/**
 * Octahedral Impostor Material - WebGPU TSL Version
 *
 * Uses Three.js TSL (Three Shading Language) for WebGPU compatibility.
 * This replaces the GLSL ShaderMaterial for WebGPU rendering.
 *
 * AAA Features:
 * - Octahedral atlas sampling with 3-view blending
 * - Depth atlas for depth-based frame blending (reduces ghosting)
 * - Normal atlas for dynamic lighting
 * - PBR atlas (roughness, metallic, AO)
 * - Multi-light support (4 directional + 4 point lights)
 * - Specular highlights with Fresnel
 * - Distance-based dithered dissolve for LOD transitions
 */

import * as THREE_NAMESPACE from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { ImpostorMaterialConfig } from "./types";
import type { DissolveConfig } from "./ImpostorMaterial";

// Maximum lights for TSL
const MAX_DIRECTIONAL_LIGHTS_TSL = 4;
const MAX_POINT_LIGHTS_TSL = 4;

// TSL functions are under the TSL namespace in three/webgpu
const {
  Fn,
  uv,
  positionWorld,
  instanceIndex,
  cameraPosition,
  uniform,
  texture,
  float,
  int,
  vec2,
  vec3,
  vec4,
  add,
  sub,
  mul,
  div,
  dot,
  floor,
  fract,
  sin,
  cos,
  pow,
  min,
  max,
  clamp,
  normalize,
  cross,
  smoothstep,
  mix,
  select,
} = THREE_NAMESPACE.TSL;

// ============================================================================
// TSL IMPOSTOR MATERIAL
// ============================================================================

/**
 * Material with TSL impostor uniforms for runtime updates.
 */
export type TSLImpostorMaterial = THREE_NAMESPACE.MeshBasicNodeMaterial & {
  impostorUniforms: {
    faceIndices: { value: THREE_NAMESPACE.Vector3 };
    faceWeights: { value: THREE_NAMESPACE.Vector3 };
    playerPos?: { value: THREE_NAMESPACE.Vector3 };
    fadeStart?: { value: number };
    fadeEnd?: { value: number };
    // AAA uniforms
    ambientColor?: { value: THREE_NAMESPACE.Vector3 };
    ambientIntensity?: { value: number };
    numDirectionalLights?: { value: number };
    directionalLightDirs?: { value: THREE_NAMESPACE.Vector3[] };
    directionalLightColors?: { value: THREE_NAMESPACE.Vector3[] };
    directionalLightIntensities?: { value: number[] };
    numPointLights?: { value: number };
    pointLightPositions?: { value: THREE_NAMESPACE.Vector3[] };
    pointLightColors?: { value: THREE_NAMESPACE.Vector3[] };
    pointLightIntensities?: { value: number[] };
    pointLightDistances?: { value: number[] };
    pointLightDecays?: { value: number[] };
    specularF0?: { value: number };
    specularShininess?: { value: number };
    specularIntensity?: { value: number };
  };
  /** Update face indices and weights from view data */
  updateView: (
    faceIndices: THREE_NAMESPACE.Vector3,
    faceWeights: THREE_NAMESPACE.Vector3,
  ) => void;
  /** Update AAA lighting (if AAA mode enabled) */
  updateLighting?: (config: {
    ambientColor?: THREE_NAMESPACE.Vector3;
    ambientIntensity?: number;
    directionalLights?: Array<{
      direction: THREE_NAMESPACE.Vector3;
      color: THREE_NAMESPACE.Vector3;
      intensity: number;
    }>;
    pointLights?: Array<{
      position: THREE_NAMESPACE.Vector3;
      color: THREE_NAMESPACE.Vector3;
      intensity: number;
      distance: number;
      decay: number;
    }>;
    specular?: {
      f0?: number;
      shininess?: number;
      intensity?: number;
    };
  }) => void;
};

/**
 * Options for creating TSL impostor material
 */
export interface TSLImpostorMaterialOptions extends ImpostorMaterialConfig {
  /** Optional dissolve configuration */
  dissolve?: DissolveConfig;
  /** Enable AAA features (depth blending, multi-light, specular) */
  enableAAA?: boolean;
  /**
   * Debug mode for diagnosing rendering issues:
   * - 0: Normal rendering (default)
   * - 1: Raw texture sample from center (no blending)
   * - 2: Show UV coordinates as color (red=U, green=V)
   * - 3: Show face indices as color (R=idx0, G=idx1, B=idx2)
   * - 4: Solid red (verify shader runs at all)
   * - 5: Sample texture at fixed (0.5, 0.5) coords - test texture binding
   * - 6: Sample texture with billboard UVs directly - test UV mapping
   */
  debugMode?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Create a WebGPU-compatible impostor material using TSL.
 *
 * This material samples an octahedral atlas texture and blends 3 views
 * based on face indices and barycentric weights.
 *
 * AAA mode adds:
 * - Depth-based frame blending (reduces ghosting)
 * - Multi-light support (4 directional + 4 point)
 * - Specular highlights with Fresnel
 * - PBR support (roughness, metallic, AO)
 *
 * @param options - Material configuration
 * @returns TSL-based impostor material
 */
export function createTSLImpostorMaterial(
  options: TSLImpostorMaterialOptions,
): TSLImpostorMaterial {
  const {
    atlasTexture,
    normalAtlasTexture,
    depthAtlasTexture,
    pbrAtlasTexture,
    gridSizeX,
    gridSizeY,
    dissolve,
    transparent = true,
    depthWrite = true,
    enableAAA = !!(depthAtlasTexture || normalAtlasTexture),
    enableDepthBlending = !!depthAtlasTexture,
    enableSpecular = !!normalAtlasTexture,
    debugMode = 0,
  } = options;

  // Ensure render target textures work with TSL
  const setupTexture = (tex: THREE_NAMESPACE.Texture | undefined) => {
    if (!tex) return;
    tex.needsUpdate = true;
    tex.wrapS = THREE_NAMESPACE.ClampToEdgeWrapping;
    tex.wrapT = THREE_NAMESPACE.ClampToEdgeWrapping;
    // For WebGPU, ensure the texture is marked ready
    if (!tex.generateMipmaps) {
      tex.generateMipmaps = false;
    }
  };
  setupTexture(atlasTexture);
  setupTexture(normalAtlasTexture);
  setupTexture(depthAtlasTexture);
  setupTexture(pbrAtlasTexture);

  // Create node material
  const material = new MeshBasicNodeMaterial();

  // ========== UNIFORMS ==========
  const uAtlasTexture = texture(atlasTexture);
  const uGridSize = uniform(vec2(gridSizeX, gridSizeY));
  const uFaceIndices = uniform(vec3(0, 0, 0));
  const uFaceWeights = uniform(vec3(0.33, 0.33, 0.34));
  const uAlphaThreshold = uniform(float(0.5));

  // AAA uniforms
  const placeholderTex = atlasTexture; // Use albedo as placeholder
  const uNormalAtlasTexture = texture(normalAtlasTexture ?? placeholderTex);
  const uDepthAtlasTexture = texture(depthAtlasTexture ?? placeholderTex);
  const uPBRAtlasTexture = texture(pbrAtlasTexture ?? placeholderTex);

  const uUseDepthBlending = uniform(int(enableDepthBlending ? 1 : 0));
  const uUsePBR = uniform(int(pbrAtlasTexture ? 1 : 0));
  const uUseSpecular = uniform(int(enableSpecular ? 1 : 0));

  // Lighting uniforms
  const uAmbientColor = uniform(vec3(1, 1, 1));
  const uAmbientIntensity = uniform(float(0.4));
  const uNumDirectionalLights = uniform(int(1));

  // Directional light arrays (up to 4)
  const uDirLightDirs = [
    uniform(vec3(0.5, 0.8, 0.3)),
    uniform(vec3(0, 1, 0)),
    uniform(vec3(0, 1, 0)),
    uniform(vec3(0, 1, 0)),
  ];
  const uDirLightColors = [
    uniform(vec3(1, 0.98, 0.95)),
    uniform(vec3(1, 1, 1)),
    uniform(vec3(1, 1, 1)),
    uniform(vec3(1, 1, 1)),
  ];
  const uDirLightIntensities = [
    uniform(float(1.2)),
    uniform(float(0)),
    uniform(float(0)),
    uniform(float(0)),
  ];

  // Point light arrays (up to 4)
  const uNumPointLights = uniform(int(0));
  const uPointLightPositions = [
    uniform(vec3(0, 0, 0)),
    uniform(vec3(0, 0, 0)),
    uniform(vec3(0, 0, 0)),
    uniform(vec3(0, 0, 0)),
  ];
  const uPointLightColors = [
    uniform(vec3(1, 1, 1)),
    uniform(vec3(1, 1, 1)),
    uniform(vec3(1, 1, 1)),
    uniform(vec3(1, 1, 1)),
  ];
  const uPointLightIntensities = [
    uniform(float(0)),
    uniform(float(0)),
    uniform(float(0)),
    uniform(float(0)),
  ];
  const uPointLightDistances = [
    uniform(float(10)),
    uniform(float(10)),
    uniform(float(10)),
    uniform(float(10)),
  ];
  const uPointLightDecays = [
    uniform(float(2)),
    uniform(float(2)),
    uniform(float(2)),
    uniform(float(2)),
  ];

  // Specular uniforms
  const uSpecularF0 = uniform(float(0.04));
  const uSpecularShininess = uniform(float(32));
  const uSpecularIntensity = uniform(float(0.5));

  // Dissolve uniforms
  const dissolveEnabled = dissolve?.enabled ?? false;
  const uPlayerPos = uniform(vec3(0, 0, 0));
  const uFadeStart = uniform(float(dissolve?.fadeStart ?? 300));
  const uFadeEnd = uniform(float(dissolve?.fadeEnd ?? 350));

  // ========== HELPER: Convert flat index to grid coords ==========
  const flatToCoords = Fn(([flatIndex]: [ReturnType<typeof float>]) => {
    const row = floor(div(flatIndex, uGridSize.x));
    const col = sub(flatIndex, mul(row, uGridSize.x));
    return vec2(col, row);
  });

  // ========== HELPER: Fresnel Schlick ==========
  const fresnelSchlick = Fn(
    ([cosTheta, f0]: [ReturnType<typeof float>, ReturnType<typeof vec3>]) => {
      return add(
        f0,
        mul(
          sub(vec3(1, 1, 1), f0),
          pow(clamp(sub(float(1), cosTheta), float(0), float(1)), float(5)),
        ),
      );
    },
  );

  // ========== COLOR NODE (with debug modes) ==========
  // debugMode:
  // 0 = Normal rendering with lighting
  // 1 = Raw texture from center cell (no blending, no lighting)
  // 2 = UV coordinates as color (red=U, green=V)
  // 3 = Face indices as colors (divided by gridSize for visibility)
  // 4 = Solid red (verify shader runs)
  // 5 = Sample texture at fixed coords (0.5,0.5) - test if texture has content
  // 6 = Sample texture at dynamic UVs without grid division - raw UV sample

  let colorNode;

  if (debugMode === 6) {
    // Mode 6: Sample texture using billboard UVs directly (no grid division)
    // This helps diagnose if the issue is UV math or texture binding
    colorNode = Fn(() => {
      const billboardUV = uv();
      // Sample directly with billboard UVs (will stretch across entire atlas)
      const color = uAtlasTexture.sample(billboardUV);
      return vec4(color.rgb, float(1)); // Force alpha to 1 to see if there's any content
    })();
  } else if (debugMode === 5) {
    // Mode 5: Sample texture at fixed center coordinate (0.5, 0.5)
    // This tests if the texture binding works at all
    colorNode = Fn(() => {
      const fixedUV = vec2(0.5, 0.5);
      const color = uAtlasTexture.sample(fixedUV);
      return vec4(color.rgb, float(1)); // Force alpha to 1
    })();
  } else if (debugMode === 4) {
    // Mode 4: Solid red - verifies shader runs at all
    colorNode = Fn(() => {
      return vec4(1, 0, 0, 1);
    })();
  } else if (debugMode === 3) {
    // Mode 3: Face indices as colors
    colorNode = Fn(() => {
      const idx0Norm = div(uFaceIndices.x, mul(uGridSize.x, uGridSize.y));
      const idx1Norm = div(uFaceIndices.y, mul(uGridSize.x, uGridSize.y));
      const idx2Norm = div(uFaceIndices.z, mul(uGridSize.x, uGridSize.y));
      return vec4(idx0Norm, idx1Norm, idx2Norm, float(1));
    })();
  } else if (debugMode === 2) {
    // Mode 2: UV coordinates as color
    colorNode = Fn(() => {
      const billboardUV = uv();
      return vec4(billboardUV.x, billboardUV.y, float(0), float(1));
    })();
  } else if (debugMode === 1) {
    // Mode 1: Raw texture from center (no blending, no lighting)
    // Sample from first cell using raw UVs
    colorNode = Fn(() => {
      const billboardUV = uv();
      // Sample from first grid cell (0,0) directly
      const cellUV = div(billboardUV, uGridSize);
      const color = uAtlasTexture.sample(cellUV);
      return vec4(color.rgb, color.a);
    })();
  } else if (!enableAAA) {
    // Simple non-AAA mode: just blend atlas colors without lighting
    // This is used when only atlasTexture is provided (no normals, depth, or PBR)
    colorNode = Fn(() => {
      const billboardUV = uv();

      // Get cell indices
      const cellA = flatToCoords(uFaceIndices.x);
      const cellB = flatToCoords(uFaceIndices.y);
      const cellC = flatToCoords(uFaceIndices.z);

      // Atlas UVs
      const atlasUV_a = div(add(cellA, billboardUV), uGridSize);
      const atlasUV_b = div(add(cellB, billboardUV), uGridSize);
      const atlasUV_c = div(add(cellC, billboardUV), uGridSize);

      // Sample atlas
      const color_a = uAtlasTexture.sample(atlasUV_a);
      const color_b = uAtlasTexture.sample(atlasUV_b);
      const color_c = uAtlasTexture.sample(atlasUV_c);

      // Alpha-weighted blending (same as GLSL material)
      const wa_raw = mul(uFaceWeights.x, color_a.a);
      const wb_raw = mul(uFaceWeights.y, color_b.a);
      const wc_raw = mul(uFaceWeights.z, color_c.a);
      const totalWeight = add(add(wa_raw, wb_raw), wc_raw);

      // Normalize weights
      const wa = div(wa_raw, totalWeight);
      const wb = div(wb_raw, totalWeight);
      const wc = div(wc_raw, totalWeight);

      // Blend colors
      const blendedColor = add(
        add(mul(color_a, wa), mul(color_b, wb)),
        mul(color_c, wc),
      );

      // Output sRGB directly (atlas is already in sRGB)
      return vec4(blendedColor.rgb, totalWeight);
    })();
  } else {
    // Mode 0: Full AAA rendering with blending and lighting
    // NOTE: TSL doesn't support traditional loops, so we unroll for all 4 lights
    colorNode = Fn(() => {
      const billboardUV = uv();
      const worldPos = positionWorld;

      // Get cell indices
      const cellA = flatToCoords(uFaceIndices.x);
      const cellB = flatToCoords(uFaceIndices.y);
      const cellC = flatToCoords(uFaceIndices.z);

      // Atlas UVs
      const atlasUV_a = div(add(cellA, billboardUV), uGridSize);
      const atlasUV_b = div(add(cellB, billboardUV), uGridSize);
      const atlasUV_c = div(add(cellC, billboardUV), uGridSize);

      // Sample all atlases
      const color_a = uAtlasTexture.sample(atlasUV_a);
      const color_b = uAtlasTexture.sample(atlasUV_b);
      const color_c = uAtlasTexture.sample(atlasUV_c);

      const depth_a = uDepthAtlasTexture.sample(atlasUV_a).r;
      const depth_b = uDepthAtlasTexture.sample(atlasUV_b).r;
      const depth_c = uDepthAtlasTexture.sample(atlasUV_c).r;

      const normal_a = uNormalAtlasTexture.sample(atlasUV_a).rgb;
      const normal_b = uNormalAtlasTexture.sample(atlasUV_b).rgb;
      const normal_c = uNormalAtlasTexture.sample(atlasUV_c).rgb;

      const pbr_a = uPBRAtlasTexture.sample(atlasUV_a).rgb;
      const pbr_b = uPBRAtlasTexture.sample(atlasUV_b).rgb;
      const pbr_c = uPBRAtlasTexture.sample(atlasUV_c).rgb;

      // Compute weights - depth-based or standard
      const depthWeight_a = sub(float(1), depth_a);
      const depthWeight_b = sub(float(1), depth_b);
      const depthWeight_c = sub(float(1), depth_c);

      // Standard weights
      const wa_std = mul(uFaceWeights.x, color_a.a);
      const wb_std = mul(uFaceWeights.y, color_b.a);
      const wc_std = mul(uFaceWeights.z, color_c.a);

      // Depth-weighted
      const wa_depth = mul(mul(uFaceWeights.x, color_a.a), depthWeight_a);
      const wb_depth = mul(mul(uFaceWeights.y, color_b.a), depthWeight_b);
      const wc_depth = mul(mul(uFaceWeights.z, color_c.a), depthWeight_c);

      // Select based on depth blending flag
      const wa_raw = select(uUseDepthBlending, wa_depth, wa_std);
      const wb_raw = select(uUseDepthBlending, wb_depth, wb_std);
      const wc_raw = select(uUseDepthBlending, wc_depth, wc_std);

      const totalWeight = add(add(wa_raw, wb_raw), wc_raw);

      // Normalize weights
      const wa = div(wa_raw, totalWeight);
      const wb = div(wb_raw, totalWeight);
      const wc = div(wc_raw, totalWeight);

      // Blend all channels
      const albedo = add(
        add(mul(color_a, wa), mul(color_b, wb)),
        mul(color_c, wc),
      );
      const albedoLinear = pow(albedo.rgb, vec3(2.2, 2.2, 2.2));

      // Decode and blend normals
      const normal_dec_a = normalize(
        sub(mul(normal_a, float(2)), vec3(1, 1, 1)),
      );
      const normal_dec_b = normalize(
        sub(mul(normal_b, float(2)), vec3(1, 1, 1)),
      );
      const normal_dec_c = normalize(
        sub(mul(normal_c, float(2)), vec3(1, 1, 1)),
      );
      const viewNormal = normalize(
        add(
          add(mul(normal_dec_a, wa), mul(normal_dec_b, wb)),
          mul(normal_dec_c, wc),
        ),
      );

      // Blend PBR
      const pbrBlended = add(
        add(mul(pbr_a, wa), mul(pbr_b, wb)),
        mul(pbr_c, wc),
      );
      const roughness = select(uUsePBR, pbrBlended.r, float(0.8));
      const metallic = select(uUsePBR, pbrBlended.g, float(0));
      const ao = select(uUsePBR, pbrBlended.b, float(1));

      // Transform normal to world space
      const N = normalize(sub(cameraPosition, worldPos));
      const worldUp = vec3(0, 1, 0);
      const T = normalize(cross(worldUp, N));
      const B = normalize(cross(N, T));
      const worldNormal = normalize(
        add(
          add(mul(T, viewNormal.x), mul(B, viewNormal.y)),
          mul(N, viewNormal.z),
        ),
      );

      // View direction
      const V = normalize(sub(cameraPosition, worldPos));

      // F0 based on metallic
      const f0Base = vec3(0.04, 0.04, 0.04);
      const F0 = mix(f0Base, albedoLinear, metallic);

      // Effective shininess (roughness-modulated)
      const effectiveShininess = mul(
        uSpecularShininess,
        sub(float(1), mul(roughness, float(0.9))),
      );

      // =========================================================================
      // DIRECTIONAL LIGHTS (all 4 - intensity=0 makes inactive lights contribute nothing)
      // Inlined calculations because TSL types don't work with helper functions
      // =========================================================================

      // Directional Light 0
      const L0 = normalize(uDirLightDirs[0]);
      const H0 = normalize(add(V, L0));
      const NdotL0 = max(dot(worldNormal, L0), float(0));
      const NdotH0 = max(dot(worldNormal, H0), float(0));
      const VdotH0 = max(dot(V, H0), float(0));
      const halfLambert0 = add(mul(NdotL0, float(0.5)), float(0.5));
      const diffuseDir0 = mul(
        mul(uDirLightColors[0], uDirLightIntensities[0]),
        halfLambert0,
      );
      const F0_spec0 = fresnelSchlick(VdotH0, F0);
      const spec0 = pow(NdotH0, effectiveShininess);
      const specularDir0 = mul(
        mul(mul(F0_spec0, spec0), uDirLightColors[0]),
        uDirLightIntensities[0],
      );

      // Directional Light 1
      const L1 = normalize(uDirLightDirs[1]);
      const H1 = normalize(add(V, L1));
      const NdotL1 = max(dot(worldNormal, L1), float(0));
      const NdotH1 = max(dot(worldNormal, H1), float(0));
      const VdotH1 = max(dot(V, H1), float(0));
      const halfLambert1 = add(mul(NdotL1, float(0.5)), float(0.5));
      const diffuseDir1 = mul(
        mul(uDirLightColors[1], uDirLightIntensities[1]),
        halfLambert1,
      );
      const F0_spec1 = fresnelSchlick(VdotH1, F0);
      const spec1 = pow(NdotH1, effectiveShininess);
      const specularDir1 = mul(
        mul(mul(F0_spec1, spec1), uDirLightColors[1]),
        uDirLightIntensities[1],
      );

      // Directional Light 2
      const L2 = normalize(uDirLightDirs[2]);
      const H2 = normalize(add(V, L2));
      const NdotL2 = max(dot(worldNormal, L2), float(0));
      const NdotH2 = max(dot(worldNormal, H2), float(0));
      const VdotH2 = max(dot(V, H2), float(0));
      const halfLambert2 = add(mul(NdotL2, float(0.5)), float(0.5));
      const diffuseDir2 = mul(
        mul(uDirLightColors[2], uDirLightIntensities[2]),
        halfLambert2,
      );
      const F0_spec2 = fresnelSchlick(VdotH2, F0);
      const spec2 = pow(NdotH2, effectiveShininess);
      const specularDir2 = mul(
        mul(mul(F0_spec2, spec2), uDirLightColors[2]),
        uDirLightIntensities[2],
      );

      // Directional Light 3
      const L3 = normalize(uDirLightDirs[3]);
      const H3 = normalize(add(V, L3));
      const NdotL3 = max(dot(worldNormal, L3), float(0));
      const NdotH3 = max(dot(worldNormal, H3), float(0));
      const VdotH3 = max(dot(V, H3), float(0));
      const halfLambert3 = add(mul(NdotL3, float(0.5)), float(0.5));
      const diffuseDir3 = mul(
        mul(uDirLightColors[3], uDirLightIntensities[3]),
        halfLambert3,
      );
      const F0_spec3 = fresnelSchlick(VdotH3, F0);
      const spec3 = pow(NdotH3, effectiveShininess);
      const specularDir3 = mul(
        mul(mul(F0_spec3, spec3), uDirLightColors[3]),
        uDirLightIntensities[3],
      );

      // Sum all directional lights
      const totalDirDiffuse = add(
        add(add(diffuseDir0, diffuseDir1), diffuseDir2),
        diffuseDir3,
      );
      const totalDirSpecular = add(
        add(add(specularDir0, specularDir1), specularDir2),
        specularDir3,
      );

      // =========================================================================
      // POINT LIGHTS (all 4 - intensity=0 makes inactive lights contribute nothing)
      // Physical attenuation: smooth falloff * inverse square law
      // =========================================================================

      // Point Light 0
      const pVec0 = sub(uPointLightPositions[0], worldPos);
      const pDist0 = max(
        float(0.0001),
        pow(
          add(
            add(mul(pVec0.x, pVec0.x), mul(pVec0.y, pVec0.y)),
            mul(pVec0.z, pVec0.z),
          ),
          float(0.5),
        ),
      );
      const pL0 = div(pVec0, pDist0);
      const pH0 = normalize(add(V, pL0));
      const pD0 = div(pDist0, max(uPointLightDistances[0], float(0.0001)));
      const pSmooth0 = clamp(
        sub(float(1), mul(mul(mul(pD0, pD0), pD0), pD0)),
        float(0),
        float(1),
      );
      const pAtten0 = mul(
        mul(pSmooth0, pSmooth0),
        div(float(1), mul(pDist0, pDist0)),
      );
      const pNdotL0 = max(dot(worldNormal, pL0), float(0));
      const pNdotH0 = max(dot(worldNormal, pH0), float(0));
      const pVdotH0 = max(dot(V, pH0), float(0));
      const pHalfLambert0 = add(mul(pNdotL0, float(0.5)), float(0.5));
      const diffusePoint0 = mul(
        mul(mul(uPointLightColors[0], uPointLightIntensities[0]), pAtten0),
        pHalfLambert0,
      );
      const pF0_spec0 = fresnelSchlick(pVdotH0, F0);
      const pSpec0 = pow(pNdotH0, effectiveShininess);
      const specularPoint0 = mul(
        mul(
          mul(mul(pF0_spec0, pSpec0), uPointLightColors[0]),
          uPointLightIntensities[0],
        ),
        pAtten0,
      );

      // Point Light 1
      const pVec1 = sub(uPointLightPositions[1], worldPos);
      const pDist1 = max(
        float(0.0001),
        pow(
          add(
            add(mul(pVec1.x, pVec1.x), mul(pVec1.y, pVec1.y)),
            mul(pVec1.z, pVec1.z),
          ),
          float(0.5),
        ),
      );
      const pL1 = div(pVec1, pDist1);
      const pH1 = normalize(add(V, pL1));
      const pD1 = div(pDist1, max(uPointLightDistances[1], float(0.0001)));
      const pSmooth1 = clamp(
        sub(float(1), mul(mul(mul(pD1, pD1), pD1), pD1)),
        float(0),
        float(1),
      );
      const pAtten1 = mul(
        mul(pSmooth1, pSmooth1),
        div(float(1), mul(pDist1, pDist1)),
      );
      const pNdotL1 = max(dot(worldNormal, pL1), float(0));
      const pNdotH1 = max(dot(worldNormal, pH1), float(0));
      const pVdotH1 = max(dot(V, pH1), float(0));
      const pHalfLambert1 = add(mul(pNdotL1, float(0.5)), float(0.5));
      const diffusePoint1 = mul(
        mul(mul(uPointLightColors[1], uPointLightIntensities[1]), pAtten1),
        pHalfLambert1,
      );
      const pF0_spec1 = fresnelSchlick(pVdotH1, F0);
      const pSpec1 = pow(pNdotH1, effectiveShininess);
      const specularPoint1 = mul(
        mul(
          mul(mul(pF0_spec1, pSpec1), uPointLightColors[1]),
          uPointLightIntensities[1],
        ),
        pAtten1,
      );

      // Point Light 2
      const pVec2 = sub(uPointLightPositions[2], worldPos);
      const pDist2 = max(
        float(0.0001),
        pow(
          add(
            add(mul(pVec2.x, pVec2.x), mul(pVec2.y, pVec2.y)),
            mul(pVec2.z, pVec2.z),
          ),
          float(0.5),
        ),
      );
      const pL2 = div(pVec2, pDist2);
      const pH2 = normalize(add(V, pL2));
      const pD2 = div(pDist2, max(uPointLightDistances[2], float(0.0001)));
      const pSmooth2 = clamp(
        sub(float(1), mul(mul(mul(pD2, pD2), pD2), pD2)),
        float(0),
        float(1),
      );
      const pAtten2 = mul(
        mul(pSmooth2, pSmooth2),
        div(float(1), mul(pDist2, pDist2)),
      );
      const pNdotL2 = max(dot(worldNormal, pL2), float(0));
      const pNdotH2 = max(dot(worldNormal, pH2), float(0));
      const pVdotH2 = max(dot(V, pH2), float(0));
      const pHalfLambert2 = add(mul(pNdotL2, float(0.5)), float(0.5));
      const diffusePoint2 = mul(
        mul(mul(uPointLightColors[2], uPointLightIntensities[2]), pAtten2),
        pHalfLambert2,
      );
      const pF0_spec2 = fresnelSchlick(pVdotH2, F0);
      const pSpec2 = pow(pNdotH2, effectiveShininess);
      const specularPoint2 = mul(
        mul(
          mul(mul(pF0_spec2, pSpec2), uPointLightColors[2]),
          uPointLightIntensities[2],
        ),
        pAtten2,
      );

      // Point Light 3
      const pVec3 = sub(uPointLightPositions[3], worldPos);
      const pDist3 = max(
        float(0.0001),
        pow(
          add(
            add(mul(pVec3.x, pVec3.x), mul(pVec3.y, pVec3.y)),
            mul(pVec3.z, pVec3.z),
          ),
          float(0.5),
        ),
      );
      const pL3 = div(pVec3, pDist3);
      const pH3 = normalize(add(V, pL3));
      const pD3 = div(pDist3, max(uPointLightDistances[3], float(0.0001)));
      const pSmooth3 = clamp(
        sub(float(1), mul(mul(mul(pD3, pD3), pD3), pD3)),
        float(0),
        float(1),
      );
      const pAtten3 = mul(
        mul(pSmooth3, pSmooth3),
        div(float(1), mul(pDist3, pDist3)),
      );
      const pNdotL3 = max(dot(worldNormal, pL3), float(0));
      const pNdotH3 = max(dot(worldNormal, pH3), float(0));
      const pVdotH3 = max(dot(V, pH3), float(0));
      const pHalfLambert3 = add(mul(pNdotL3, float(0.5)), float(0.5));
      const diffusePoint3 = mul(
        mul(mul(uPointLightColors[3], uPointLightIntensities[3]), pAtten3),
        pHalfLambert3,
      );
      const pF0_spec3 = fresnelSchlick(pVdotH3, F0);
      const pSpec3 = pow(pNdotH3, effectiveShininess);
      const specularPoint3 = mul(
        mul(
          mul(mul(pF0_spec3, pSpec3), uPointLightColors[3]),
          uPointLightIntensities[3],
        ),
        pAtten3,
      );

      // Sum all point lights
      const totalPointDiffuse = add(
        add(add(diffusePoint0, diffusePoint1), diffusePoint2),
        diffusePoint3,
      );
      const totalPointSpecular = add(
        add(add(specularPoint0, specularPoint1), specularPoint2),
        specularPoint3,
      );

      // =========================================================================
      // COMBINE ALL LIGHTING
      // =========================================================================

      // Total diffuse and specular from all lights
      const totalDiffuse = add(totalDirDiffuse, totalPointDiffuse);
      const totalSpecularRaw = add(totalDirSpecular, totalPointSpecular);
      const totalSpecular = select(
        uUseSpecular,
        mul(totalSpecularRaw, uSpecularIntensity),
        vec3(0, 0, 0),
      );

      // Ambient with AO
      const ambient = mul(mul(uAmbientColor, uAmbientIntensity), ao);

      // Final composition - diffuse contribution (metals have reduced diffuse)
      const oneMinusMetallic = sub(float(1), metallic);
      const lightingSum = add(ambient, mul(totalDiffuse, float(0.5)));
      const diffuseContrib = mul(
        mul(oneMinusMetallic, albedoLinear),
        lightingSum,
      );

      // Add specular
      const litColor = add(diffuseContrib, totalSpecular);

      // Soft clamp and tonemap
      const clampedColor = min(litColor, vec3(1.2, 1.2, 1.2));
      const tonemapped = div(
        clampedColor,
        add(clampedColor, vec3(0.1, 0.1, 0.1)),
      );
      const brightened = mul(tonemapped, float(1.1));

      // Convert to sRGB
      const finalColor = pow(brightened, vec3(0.4545, 0.4545, 0.4545));

      return vec4(finalColor, totalWeight);
    })();
  }

  material.colorNode = colorNode;

  // ========== ALPHA TEST NODE ==========
  if (dissolveEnabled) {
    material.alphaTestNode = Fn(() => {
      const worldPos = positionWorld;
      const toPlayer = sub(worldPos, uPlayerPos);
      const distSq = add(
        mul(toPlayer.x, toPlayer.x),
        mul(toPlayer.z, toPlayer.z),
      );
      const fadeStartSq = mul(uFadeStart, uFadeStart);
      const fadeEndSq = mul(uFadeEnd, uFadeEnd);
      const farFade = smoothstep(fadeStartSq, fadeEndSq, distSq);

      const ditherScale = float(0.5);
      const instanceSeed = fract(
        mul(float(instanceIndex), float(0.61803398875)),
      );
      const ditherInput = vec2(
        add(
          mul(instanceSeed, float(100)),
          add(mul(worldPos.x, ditherScale), mul(worldPos.y, float(0.2))),
        ),
        add(
          mul(fract(mul(instanceSeed, float(1.618))), float(100)),
          add(mul(worldPos.z, ditherScale), mul(worldPos.y, float(0.15))),
        ),
      );
      const hash1 = fract(
        mul(sin(dot(ditherInput, vec2(12.9898, 78.233))), float(43758.5453)),
      );
      const hash2 = fract(
        mul(cos(dot(ditherInput, vec2(39.346, 11.135))), float(23421.6312)),
      );
      const ditherValue = mul(add(hash1, hash2), float(0.5));

      return add(uAlphaThreshold, mul(ditherValue, farFade));
    })();
  } else {
    material.alphaTestNode = uAlphaThreshold;
  }

  // ========== MATERIAL SETTINGS ==========
  material.transparent = transparent;
  material.depthWrite = depthWrite;
  material.side = THREE_NAMESPACE.DoubleSide;
  material.alphaTest = 0.1;

  // ========== ATTACH UNIFORMS ==========
  // Cast to TSLImpostorMaterial and attach uniforms
  // Use explicit typing to match the expected interface
  const tslMaterial = material as unknown as TSLImpostorMaterial;

  // Build uniforms object
  const uniformsObj: TSLImpostorMaterial["impostorUniforms"] = {
    faceIndices: uFaceIndices as unknown as { value: THREE_NAMESPACE.Vector3 },
    faceWeights: uFaceWeights as unknown as { value: THREE_NAMESPACE.Vector3 },
  };

  if (dissolveEnabled) {
    uniformsObj.playerPos = uPlayerPos as unknown as {
      value: THREE_NAMESPACE.Vector3;
    };
    uniformsObj.fadeStart = uFadeStart as unknown as { value: number };
    uniformsObj.fadeEnd = uFadeEnd as unknown as { value: number };
  }

  if (enableAAA) {
    uniformsObj.ambientColor = uAmbientColor as unknown as {
      value: THREE_NAMESPACE.Vector3;
    };
    uniformsObj.ambientIntensity = uAmbientIntensity as unknown as {
      value: number;
    };
    uniformsObj.numDirectionalLights = uNumDirectionalLights as unknown as {
      value: number;
    };
    uniformsObj.directionalLightDirs = uDirLightDirs as unknown as {
      value: THREE_NAMESPACE.Vector3[];
    };
    uniformsObj.directionalLightColors = uDirLightColors as unknown as {
      value: THREE_NAMESPACE.Vector3[];
    };
    uniformsObj.directionalLightIntensities =
      uDirLightIntensities as unknown as { value: number[] };
    uniformsObj.numPointLights = uNumPointLights as unknown as {
      value: number;
    };
    uniformsObj.pointLightPositions = uPointLightPositions as unknown as {
      value: THREE_NAMESPACE.Vector3[];
    };
    uniformsObj.pointLightColors = uPointLightColors as unknown as {
      value: THREE_NAMESPACE.Vector3[];
    };
    uniformsObj.pointLightIntensities = uPointLightIntensities as unknown as {
      value: number[];
    };
    uniformsObj.pointLightDistances = uPointLightDistances as unknown as {
      value: number[];
    };
    uniformsObj.pointLightDecays = uPointLightDecays as unknown as {
      value: number[];
    };
    uniformsObj.specularF0 = uSpecularF0 as unknown as { value: number };
    uniformsObj.specularShininess = uSpecularShininess as unknown as {
      value: number;
    };
    uniformsObj.specularIntensity = uSpecularIntensity as unknown as {
      value: number;
    };
  }

  tslMaterial.impostorUniforms = uniformsObj;

  // Helper to update view
  tslMaterial.updateView = (
    faceIndices: THREE_NAMESPACE.Vector3,
    faceWeights: THREE_NAMESPACE.Vector3,
  ) => {
    uFaceIndices.value.copy(faceIndices);
    uFaceWeights.value.copy(faceWeights);
  };

  // Helper to update AAA lighting
  if (enableAAA) {
    tslMaterial.updateLighting = (config) => {
      if (config.ambientColor) uAmbientColor.value.copy(config.ambientColor);
      if (config.ambientIntensity !== undefined)
        uAmbientIntensity.value = config.ambientIntensity;

      if (config.directionalLights) {
        const count = Math.min(
          config.directionalLights.length,
          MAX_DIRECTIONAL_LIGHTS_TSL,
        );
        uNumDirectionalLights.value = count;
        for (let i = 0; i < count; i++) {
          const light = config.directionalLights[i];
          uDirLightDirs[i].value.copy(light.direction).normalize();
          uDirLightColors[i].value.copy(light.color);
          uDirLightIntensities[i].value = light.intensity;
        }
      }

      if (config.pointLights) {
        const count = Math.min(config.pointLights.length, MAX_POINT_LIGHTS_TSL);
        uNumPointLights.value = count;
        for (let i = 0; i < count; i++) {
          const light = config.pointLights[i];
          uPointLightPositions[i].value.copy(light.position);
          uPointLightColors[i].value.copy(light.color);
          uPointLightIntensities[i].value = light.intensity;
          uPointLightDistances[i].value = light.distance;
          uPointLightDecays[i].value = light.decay;
        }
      }

      if (config.specular) {
        if (config.specular.f0 !== undefined)
          uSpecularF0.value = config.specular.f0;
        if (config.specular.shininess !== undefined)
          uSpecularShininess.value = config.specular.shininess;
        if (config.specular.intensity !== undefined)
          uSpecularIntensity.value = config.specular.intensity;
      }
    };
  }

  material.needsUpdate = true;

  return tslMaterial;
}

/**
 * Check if a material is a TSL impostor material.
 */
export function isTSLImpostorMaterial(
  material: THREE_NAMESPACE.Material,
): material is TSLImpostorMaterial {
  return (
    material instanceof MeshBasicNodeMaterial &&
    "impostorUniforms" in material &&
    "updateView" in material
  );
}
