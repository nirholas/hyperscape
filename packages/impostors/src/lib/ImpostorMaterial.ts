/**
 * Octahedral Impostor Library - Runtime Material
 *
 * AAA-quality shader material for rendering octahedral impostors at runtime.
 * Features:
 * - Per-pixel depth maps for parallax and proper scene integration
 * - Depth-based frame blending to eliminate ghosting
 * - PBR material support (roughness, metallic, AO)
 * - Multi-light support (4 directional + 4 point lights)
 * - Specular highlights (Blinn-Phong)
 * - Distance-based dithered dissolve for LOD transitions
 */

import * as THREE from "three";
import type { ImpostorMaterialConfig, ImpostorViewData } from "./types";

// Maximum number of lights supported
const MAX_DIRECTIONAL_LIGHTS = 4;
const MAX_POINT_LIGHTS = 4;

// ============================================================================
// DISSOLVE CONFIGURATION
// ============================================================================

/**
 * Configuration for distance-based dissolve effect.
 * When enabled, impostors smoothly fade out at distance using dithered dissolve.
 */
export interface DissolveConfig {
  /** Enable dissolve effect (default: false) */
  enabled?: boolean;
  /** Distance where fade begins (fully opaque inside) */
  fadeStart?: number;
  /** Distance where fully invisible */
  fadeEnd?: number;
  /** Initial player position (default: origin) */
  playerPos?: THREE.Vector3;
}

// ============================================================================
// GLOBAL DEBUG MODE
// ============================================================================

/**
 * Debug modes for impostor rendering:
 * - 0: Normal rendering
 * - 1: Show UV coordinates as colors (red=U, green=V)
 * - 2: Show barycentric weights (RGB = weights)
 * - 3: Show cell indices as colors
 */
export type ImpostorDebugMode = 0 | 1 | 2 | 3 | 4 | 5;

/** Global debug mode value */
let globalDebugMode: ImpostorDebugMode = 0;

/** Global alpha threshold value */
let globalAlphaThreshold = 0.5;

/** Set of all created impostor materials (WeakRef for GC) */
const allMaterials = new Set<THREE.ShaderMaterial>();

/**
 * Set the debug mode for ALL impostor materials.
 *
 * @param mode - Debug mode:
 *   -1=cyan (verify shader runs), 0=normal, 1=UV, 2=weights, 3=cell UVs, 4=raw texture, 5=center texture
 */
export function setImpostorDebugMode(mode: ImpostorDebugMode): void {
  globalDebugMode = mode;

  // Update all existing materials
  for (const material of allMaterials) {
    if (material.uniforms?.debugMode) {
      material.uniforms.debugMode.value = mode;
    }
  }

  console.log(
    `[ImpostorMaterial] Debug mode set to ${mode} for ${allMaterials.size} materials`,
  );
}

// Expose debug function globally for easy browser console access
if (typeof window !== "undefined") {
  (
    window as unknown as { setImpostorDebugMode: typeof setImpostorDebugMode }
  ).setImpostorDebugMode = setImpostorDebugMode;
}

/**
 * Get the current global debug mode.
 */
export function getImpostorDebugMode(): ImpostorDebugMode {
  return globalDebugMode;
}

/**
 * Cycle through debug modes (0 → 1 → 2 → 3 → 4 → 5 → 0).
 * Debug modes:
 * - 0: Normal rendering
 * - 1: UV coordinates
 * - 2: Face weights
 * - 3: Cell indices
 * - 4: Raw normal atlas (requires lit mode)
 * - 5: Decoded normals (requires lit mode)
 * Useful for keyboard shortcuts.
 */
export function cycleImpostorDebugMode(): ImpostorDebugMode {
  const next = ((globalDebugMode + 1) % 6) as ImpostorDebugMode;
  setImpostorDebugMode(next);
  return next;
}

// ============================================================================
// GLOBAL ALPHA THRESHOLD
// ============================================================================

/**
 * Set the alpha threshold for ALL impostor materials.
 * Lower values show more semi-transparent areas, higher values cut more.
 *
 * @param threshold - Alpha cutoff (0.0 to 1.0, default 0.1)
 */
export function setImpostorAlphaThreshold(threshold: number): void {
  globalAlphaThreshold = Math.max(0, Math.min(1, threshold));

  // Update all existing materials
  for (const material of allMaterials) {
    if (material.uniforms?.alphaThreshold) {
      material.uniforms.alphaThreshold.value = globalAlphaThreshold;
    }
  }
}

/**
 * Get the current global alpha threshold.
 */
export function getImpostorAlphaThreshold(): number {
  return globalAlphaThreshold;
}

/** Register a material for global debug mode updates */
function registerMaterial(material: THREE.ShaderMaterial): void {
  allMaterials.add(material);

  // Set initial debug mode and alpha threshold
  if (material.uniforms?.debugMode) {
    material.uniforms.debugMode.value = globalDebugMode;
  }
  if (material.uniforms?.alphaThreshold) {
    material.uniforms.alphaThreshold.value = globalAlphaThreshold;
  }
}

/** Unregister a material (call on dispose) */
export function unregisterMaterial(material: THREE.ShaderMaterial): void {
  allMaterials.delete(material);
}

/**
 * Vertex shader for impostor rendering
 * Outputs all data needed for AAA lighting and depth reconstruction
 */
const IMPOSTOR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec4 vClipPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 viewPos = viewMatrix * worldPos;
    vViewPosition = viewPos.xyz;
    vec4 clipPos = projectionMatrix * viewPos;
    vClipPosition = clipPos;
    gl_Position = clipPos;
  }
`;

/**
 * Vertex shader with instance index for dissolve
 * Uses gl_InstanceID for temporally stable dithering
 */
const IMPOSTOR_VERTEX_SHADER_DISSOLVE = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec4 vClipPosition;
  varying float vInstanceSeed;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 viewPos = viewMatrix * worldPos;
    vViewPosition = viewPos.xyz;
    vec4 clipPos = projectionMatrix * viewPos;
    vClipPosition = clipPos;
    
    // Instance-based seed for temporally stable dithering
    // Uses golden ratio hash for good distribution
    vInstanceSeed = fract(float(gl_InstanceID) * 0.61803398875);
    
    gl_Position = clipPos;
  }
`;

/**
 * Fragment shader for impostor rendering with octahedral sampling
 * Supports non-square grids (gridSizeX != gridSizeY)
 *
 * Grid Layout:
 * - gridSize represents the number of points/cells per axis
 * - buildOctahedronMesh(gridSize) creates gridSize points per axis
 * - Baker renders gridSize x gridSize cells into the atlas
 * - Each cell is 1/gridSize of the atlas texture
 * - Shader samples using: (cellIndex + localUV) / gridSize
 *
 * Example for gridSize=31 (default):
 * - buildOctahedronMesh(31) → 31x31 = 961 points
 * - Atlas has 31x31 cells
 * - Cell 0: UV [0, 1/31]
 * - Cell 30: UV [30/31, 31/31]
 */
const IMPOSTOR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D atlasTexture;
  uniform vec2 gridSize; // number of points/cells per axis (e.g., 31x31)
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  uniform float debugMode; // 0=normal, 1=show UV, 2=show weights, 3=show cell indices
  uniform float alphaThreshold; // Alpha cutoff threshold
  
  varying vec2 vUv;

  vec2 flatToCoords(float flatIndex) {
    // Convert flat vertex index to (col, row) coordinates
    // The octahedron has gridSize points per axis
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  void main() {
    // Get cell indices for the three contributing faces
    float flatIndexA = faceIndices.x;
    float flatIndexB = faceIndices.y;
    float flatIndexC = faceIndices.z;
    
    // Convert flat indices to grid coordinates (col, row)
    vec2 cellIndexA = flatToCoords(flatIndexA); 
    vec2 cellIndexB = flatToCoords(flatIndexB); 
    vec2 cellIndexC = flatToCoords(flatIndexC); 
    
    // Compute atlas UV coordinates for each cell
    // Cell N occupies UV range [N/gridSize, (N+1)/gridSize]
    // Adding vUv (0-1) gives position within cell
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // Debug mode 1: Raw billboard UV (should show clear gradient)
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    
    // Debug mode 2: show barycentric weights (uniform - flat)
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    
    // Debug mode 3: show atlas UV coordinates (varies slightly)
    if (debugMode > 2.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }

    // Sample the atlas for each view
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    // Alpha-weighted blending: prevents black fringing from transparent pixels
    // Weight = barycentric weight × alpha, then normalize
    float wa = faceWeights.x * color_a.a;
    float wb = faceWeights.y * color_b.a;
    float wc = faceWeights.z * color_c.a;
    float totalWeight = wa + wb + wc;
    
    // Alpha test - use uniform threshold
    if (totalWeight < alphaThreshold) {
      discard;
    }
    
    // Normalize weights by total alpha contribution
    wa /= totalWeight;
    wb /= totalWeight;
    wc /= totalWeight;
    
    vec4 finalColor = color_a * wa + color_b * wb + color_c * wc;
    
    // Debug: If color is very dark, show magenta to indicate possible texture issue
    float brightness = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
    if (brightness < 0.01) {
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      return;
    }
    
    // Atlas stores sRGB values, display expects sRGB - direct passthrough
    // No gamma conversion needed for non-lit mode
    gl_FragColor = vec4(finalColor.rgb, 1.0);
  }
`;

/**
 * Fragment shader for impostor rendering with distance-based dissolve
 * Includes dithered fade effect for smooth LOD transitions
 */
const IMPOSTOR_FRAGMENT_SHADER_DISSOLVE = /* glsl */ `
  uniform sampler2D atlasTexture;
  uniform vec2 gridSize;
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  uniform float debugMode;
  uniform float alphaThreshold;
  
  // Dissolve uniforms
  uniform vec3 playerPos;
  uniform float fadeStartSq; // Pre-computed squared distance
  uniform float fadeEndSq;
  
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vInstanceSeed;

  vec2 flatToCoords(float flatIndex) {
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  void main() {
    // Get cell indices for the three contributing faces
    vec2 cellIndexA = flatToCoords(faceIndices.x); 
    vec2 cellIndexB = flatToCoords(faceIndices.y); 
    vec2 cellIndexC = flatToCoords(faceIndices.z); 
    
    // Compute atlas UV coordinates
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // Debug modes (dissolve shader)
    // Mode -1 (debugMode < -0.5): Show cyan to verify shader is running
    if (debugMode < -0.5) {
      gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0); // Cyan
      return;
    }
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    if (debugMode > 2.5 && debugMode < 3.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }
    // Mode 4: Show raw texture sample (before blending)
    if (debugMode > 3.5 && debugMode < 4.5) {
      vec4 raw = texture2D(atlasTexture, atlasUV_a);
      gl_FragColor = vec4(raw.rgb, 1.0);
      return;
    }
    // Mode 5: Show center of atlas
    if (debugMode > 4.5) {
      vec4 center = texture2D(atlasTexture, vec2(0.5, 0.5));
      gl_FragColor = vec4(center.rgb, 1.0);
      return;
    }

    // === DISTANCE-BASED DISSOLVE ===
    // Calculate squared distance to player (horizontal only)
    vec3 toPlayer = vWorldPosition - playerPos;
    float distSq = toPlayer.x * toPlayer.x + toPlayer.z * toPlayer.z;
    
    // Fade factor: 0.0 when close, 1.0 when far
    float distanceFade = smoothstep(fadeStartSq, fadeEndSq, distSq);
    
    // Temporally stable dithering using instance seed
    // This prevents shimmer when camera moves
    float ditherScale = 0.5;
    vec2 ditherInput = vec2(
      vInstanceSeed * 100.0 + vWorldPosition.x * ditherScale + vWorldPosition.y * 0.2,
      fract(vInstanceSeed * 1.618) * 100.0 + vWorldPosition.z * ditherScale + vWorldPosition.y * 0.15
    );
    
    // Hash function for pseudo-random dither value
    float hash1 = fract(sin(dot(ditherInput, vec2(12.9898, 78.233))) * 43758.5453);
    float hash2 = fract(cos(dot(ditherInput, vec2(39.346, 11.135))) * 23421.6312);
    float ditherValue = (hash1 + hash2) * 0.5;
    
    // Combine: when distanceFade=1, ditherValue 0-1 causes random discard
    // This creates a dissolve effect as distance increases
    if (ditherValue < distanceFade) {
      discard;
    }

    // Sample the atlas for each view
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    // Alpha-weighted blending
    float wa = faceWeights.x * color_a.a;
    float wb = faceWeights.y * color_b.a;
    float wc = faceWeights.z * color_c.a;
    float totalWeight = wa + wb + wc;
    
    if (totalWeight < alphaThreshold) {
      discard;
    }
    
    wa /= totalWeight;
    wb /= totalWeight;
    wc /= totalWeight;
    
    vec4 finalColor = color_a * wa + color_b * wb + color_c * wc;
    
    // Debug: If color is very dark, show magenta to indicate possible texture issue
    float brightness = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
    if (brightness < 0.01) {
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      return;
    }
    
    gl_FragColor = vec4(finalColor.rgb, 1.0);
  }
`;

/**
 * Fragment shader for impostor rendering with dynamic lighting
 * Uses a normal atlas to compute real-time lighting
 */
const IMPOSTOR_LIT_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D atlasTexture;
  uniform sampler2D normalAtlasTexture;
  uniform vec2 gridSize;
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  uniform float debugMode;
  uniform float alphaThreshold; // Alpha cutoff threshold
  
  // Lighting uniforms
  uniform vec3 lightDirection; // Normalized direction TO the light
  uniform vec3 lightColor;
  uniform float lightIntensity;
  uniform vec3 ambientColor;
  uniform float ambientIntensity;
  
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  vec2 flatToCoords(float flatIndex) {
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  void main() {
    // Get cell indices
    vec2 cellIndexA = flatToCoords(faceIndices.x); 
    vec2 cellIndexB = flatToCoords(faceIndices.y); 
    vec2 cellIndexC = flatToCoords(faceIndices.z); 
    
    // Compute atlas UV coordinates
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // Debug modes
    // Mode 1: Raw billboard UV (should show clear gradient from black to yellow)
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    // Mode 2: Face weights (uniform - will be flat)
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    // Mode 3: Atlas UV (varies only slightly - 1/gridSize)
    if (debugMode > 2.5 && debugMode < 3.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }
    // Mode 4: Show raw normal atlas values (should be colorful if normals are valid)
    if (debugMode > 3.5 && debugMode < 4.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(normal_debug.rgb, 1.0);
      return;
    }
    // Mode 5: Show decoded normals
    if (debugMode > 4.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      vec3 decoded = normalize(normal_debug.rgb * 2.0 - 1.0);
      gl_FragColor = vec4(decoded * 0.5 + 0.5, 1.0);
      return;
    }

    // Sample color atlas
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    // Alpha-weighted blending: prevents black fringing from transparent pixels
    // Weight = barycentric weight × alpha, then normalize
    float wa = faceWeights.x * color_a.a;
    float wb = faceWeights.y * color_b.a;
    float wc = faceWeights.z * color_c.a;
    float totalWeight = wa + wb + wc;
    
    // Alpha test - use uniform threshold
    if (totalWeight < alphaThreshold) {
      discard;
    }
    
    // Normalize weights by total alpha contribution
    wa /= totalWeight;
    wb /= totalWeight;
    wc /= totalWeight;
    
    vec4 albedo = color_a * wa + color_b * wb + color_c * wc;
    
    // Atlas stores sRGB values (render target uses SRGBColorSpace format).
    // Convert to linear space for correct lighting calculations.
    albedo.rgb = pow(albedo.rgb, vec3(2.2));
    
    // Sample normal atlas and decode
    // The atlas stores VIEW-SPACE normals from each baking angle
    // Use same alpha-weighted blending for normals
    vec4 normal_a = texture2D(normalAtlasTexture, atlasUV_a);
    vec4 normal_b = texture2D(normalAtlasTexture, atlasUV_b);
    vec4 normal_c = texture2D(normalAtlasTexture, atlasUV_c);
    vec3 encodedNormal = (normal_a.rgb * wa + normal_b.rgb * wb + normal_c.rgb * wc);
    
    // Decode from [0,1] to [-1,1]
    vec3 viewNormal = normalize(encodedNormal * 2.0 - 1.0);
    
    // The baked normal is in view-space of the baking camera.
    // At runtime, we need to transform it to world space using the current view direction.
    // 
    // Build a basis from the current view direction:
    // N = view direction (toward camera) - this was Z+ in baking view space
    // T = right vector - this was X+ in baking view space
    // B = up vector - this was Y+ in baking view space
    vec3 N = normalize(cameraPosition - vWorldPosition); // Current view direction
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(worldUp, N)); // Right
    if (length(T) < 0.001) {
      T = normalize(cross(vec3(0.0, 0.0, 1.0), N));
    }
    vec3 B = normalize(cross(N, T)); // Up
    
    // Transform view-space normal to world space
    // viewNormal.x maps to T (right), viewNormal.y maps to B (up), viewNormal.z maps to N (toward camera)
    vec3 worldNormal = normalize(T * viewNormal.x + B * viewNormal.y + N * viewNormal.z);
    
    // Half-Lambert diffuse lighting for softer shadows (common for foliage)
    // Standard Lambert: max(NdotL, 0) gives harsh 0-1 range
    // Half-Lambert: NdotL * 0.5 + 0.5 wraps light around, giving 0.5-1.0 range
    float NdotL = dot(worldNormal, lightDirection);
    float halfLambert = NdotL * 0.5 + 0.5;
    
    // Very subtle diffuse contribution (0.25) for minimal contrast
    // Range: shadow=0.125, lit=0.25 - only 2:1 ratio with low magnitude
    vec3 diffuse = lightColor * lightIntensity * halfLambert * 0.25;
    
    // Ambient provides base illumination
    vec3 ambient = ambientColor * ambientIntensity;
    
    // Final color: albedo modulated by soft lighting
    // The lighting range is now more compressed: ambient to ambient+diffuse*0.7
    vec3 finalColor = albedo.rgb * (ambient + diffuse);
    
    // Soft clamp to prevent harsh clipping
    finalColor = min(finalColor, vec3(1.0));
    
    // Convert back to sRGB for display
    finalColor = pow(finalColor, vec3(0.4545));
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

/**
 * Fragment shader for impostor rendering with dynamic lighting AND dissolve
 */
const IMPOSTOR_LIT_FRAGMENT_SHADER_DISSOLVE = /* glsl */ `
  uniform sampler2D atlasTexture;
  uniform sampler2D normalAtlasTexture;
  uniform vec2 gridSize;
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  uniform float debugMode;
  uniform float alphaThreshold;
  
  // Lighting uniforms
  uniform vec3 lightDirection;
  uniform vec3 lightColor;
  uniform float lightIntensity;
  uniform vec3 ambientColor;
  uniform float ambientIntensity;
  
  // Dissolve uniforms
  uniform vec3 playerPos;
  uniform float fadeStartSq;
  uniform float fadeEndSq;
  
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vInstanceSeed;

  vec2 flatToCoords(float flatIndex) {
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  void main() {
    vec2 cellIndexA = flatToCoords(faceIndices.x); 
    vec2 cellIndexB = flatToCoords(faceIndices.y); 
    vec2 cellIndexC = flatToCoords(faceIndices.z); 
    
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // Debug modes
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    if (debugMode > 2.5 && debugMode < 3.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 3.5 && debugMode < 4.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(normal_debug.rgb, 1.0);
      return;
    }
    if (debugMode > 4.5 && debugMode < 5.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      vec3 decoded = normalize(normal_debug.rgb * 2.0 - 1.0);
      gl_FragColor = vec4(decoded * 0.5 + 0.5, 1.0);
      return;
    }
    // Debug mode 6: Raw texture sample (no processing)
    if (debugMode > 5.5 && debugMode < 6.5) {
      vec4 raw = texture2D(atlasTexture, atlasUV_a);
      gl_FragColor = vec4(raw.rgb, 1.0);
      return;
    }
    // Debug mode 7: Show center UV sampling (0.5, 0.5 of atlas)
    if (debugMode > 6.5) {
      vec4 center = texture2D(atlasTexture, vec2(0.5, 0.5));
      gl_FragColor = vec4(center.rgb, 1.0);
      return;
    }

    // === DISTANCE-BASED DISSOLVE ===
    vec3 toPlayer = vWorldPosition - playerPos;
    float distSq = toPlayer.x * toPlayer.x + toPlayer.z * toPlayer.z;
    float distanceFade = smoothstep(fadeStartSq, fadeEndSq, distSq);
    
    float ditherScale = 0.5;
    vec2 ditherInput = vec2(
      vInstanceSeed * 100.0 + vWorldPosition.x * ditherScale + vWorldPosition.y * 0.2,
      fract(vInstanceSeed * 1.618) * 100.0 + vWorldPosition.z * ditherScale + vWorldPosition.y * 0.15
    );
    
    float hash1 = fract(sin(dot(ditherInput, vec2(12.9898, 78.233))) * 43758.5453);
    float hash2 = fract(cos(dot(ditherInput, vec2(39.346, 11.135))) * 23421.6312);
    float ditherValue = (hash1 + hash2) * 0.5;
    
    if (ditherValue < distanceFade) {
      discard;
    }

    // Sample color atlas
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    float wa = faceWeights.x * color_a.a;
    float wb = faceWeights.y * color_b.a;
    float wc = faceWeights.z * color_c.a;
    float totalWeight = wa + wb + wc;
    
    if (totalWeight < alphaThreshold) {
      discard;
    }
    
    wa /= totalWeight;
    wb /= totalWeight;
    wc /= totalWeight;
    
    vec4 albedo = color_a * wa + color_b * wb + color_c * wc;
    
    // Debug: If albedo is very dark, output magenta to indicate possible texture issue
    float brightness = dot(albedo.rgb, vec3(0.299, 0.587, 0.114));
    if (brightness < 0.01) {
      // Very dark - show magenta for debugging
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      return;
    }
    
    // Output albedo directly (already in sRGB from texture)
    // No color space conversion needed when not using lighting
    gl_FragColor = vec4(albedo.rgb, 1.0);
  }
`;

/**
 * AAA Fragment Shader - Full-featured impostor rendering
 *
 * Features:
 * - Depth atlas for parallax and gl_FragDepth
 * - Depth-based frame blending (eliminates ghosting)
 * - PBR atlas (roughness, metallic, AO)
 * - Multi-light support (4 directional + 4 point)
 * - Specular highlights (Blinn-Phong)
 * - Proper sRGB/linear color space handling
 */
const IMPOSTOR_AAA_FRAGMENT_SHADER = /* glsl */ `
  #extension GL_EXT_frag_depth : enable
  
  // Atlas textures
  uniform sampler2D atlasTexture;
  uniform sampler2D normalAtlasTexture;
  uniform sampler2D depthAtlasTexture;
  uniform sampler2D pbrAtlasTexture;
  
  // Grid configuration
  uniform vec2 gridSize;
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  
  // Debug and alpha
  uniform float debugMode;
  uniform float alphaThreshold;
  
  // Depth reconstruction
  uniform float depthNear;
  uniform float depthFar;
  uniform float objectScale;
  
  // Feature flags
  uniform bool useDepthBlending;
  uniform bool useDepthOutput;
  uniform bool usePBR;
  uniform bool useSpecular;
  
  // Lighting - Directional lights (up to 4)
  uniform int numDirectionalLights;
  uniform vec3 directionalLightDirs[${MAX_DIRECTIONAL_LIGHTS}];
  uniform vec3 directionalLightColors[${MAX_DIRECTIONAL_LIGHTS}];
  uniform float directionalLightIntensities[${MAX_DIRECTIONAL_LIGHTS}];
  
  // Lighting - Point lights (up to 4)
  uniform int numPointLights;
  uniform vec3 pointLightPositions[${MAX_POINT_LIGHTS}];
  uniform vec3 pointLightColors[${MAX_POINT_LIGHTS}];
  uniform float pointLightIntensities[${MAX_POINT_LIGHTS}];
  uniform float pointLightDistances[${MAX_POINT_LIGHTS}];
  uniform float pointLightDecays[${MAX_POINT_LIGHTS}];
  
  // Ambient
  uniform vec3 ambientColor;
  uniform float ambientIntensity;
  
  // Specular configuration
  uniform float specularF0;       // Base reflectivity (0.04 for dielectrics)
  uniform float specularShininess; // Blinn-Phong exponent
  uniform float specularIntensity;
  
  // Varyings
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec4 vClipPosition;

  // Convert flat vertex index to (col, row) grid coordinates
  vec2 flatToCoords(float flatIndex) {
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  // Schlick Fresnel approximation
  vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }
  
  // Point light attenuation (physically based)
  float getPointLightAttenuation(float distance, float lightDistance, float decay) {
    if (lightDistance <= 0.0) {
      // No distance limit - use inverse square
      return 1.0 / max(distance * distance, 0.0001);
    }
    // Smooth falloff to zero at lightDistance
    float d = distance / lightDistance;
    float atten = clamp(1.0 - d * d * d * d, 0.0, 1.0);
    atten = atten * atten / max(distance * distance, 0.0001);
    return atten;
  }
  
  void main() {
    // Get cell indices for the three contributing faces
    vec2 cellIndexA = flatToCoords(faceIndices.x);
    vec2 cellIndexB = flatToCoords(faceIndices.y);
    vec2 cellIndexC = flatToCoords(faceIndices.z);
    
    // Compute atlas UV coordinates for each cell
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // =========================================================================
    // DEBUG MODES
    // =========================================================================
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    if (debugMode > 2.5 && debugMode < 3.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 3.5 && debugMode < 4.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(normal_debug.rgb, 1.0);
      return;
    }
    if (debugMode > 4.5 && debugMode < 5.5) {
      vec4 depth_debug = texture2D(depthAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(depth_debug.rrr, 1.0);
      return;
    }
    if (debugMode > 5.5 && debugMode < 6.5) {
      vec4 pbr_debug = texture2D(pbrAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(pbr_debug.rgb, 1.0);
      return;
    }

    // =========================================================================
    // SAMPLE ALL ATLASES
    // =========================================================================
    
    // Sample color atlas
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    // Sample depth atlas
    float depth_a = texture2D(depthAtlasTexture, atlasUV_a).r;
    float depth_b = texture2D(depthAtlasTexture, atlasUV_b).r;
    float depth_c = texture2D(depthAtlasTexture, atlasUV_c).r;
    
    // Sample normal atlas
    vec3 normal_a = texture2D(normalAtlasTexture, atlasUV_a).rgb;
    vec3 normal_b = texture2D(normalAtlasTexture, atlasUV_b).rgb;
    vec3 normal_c = texture2D(normalAtlasTexture, atlasUV_c).rgb;
    
    // Sample PBR atlas (R=roughness, G=metallic, B=AO)
    vec3 pbr_a = usePBR ? texture2D(pbrAtlasTexture, atlasUV_a).rgb : vec3(0.8, 0.0, 1.0);
    vec3 pbr_b = usePBR ? texture2D(pbrAtlasTexture, atlasUV_b).rgb : vec3(0.8, 0.0, 1.0);
    vec3 pbr_c = usePBR ? texture2D(pbrAtlasTexture, atlasUV_c).rgb : vec3(0.8, 0.0, 1.0);

    // =========================================================================
    // FRAME BLENDING - Depth-aware to reduce ghosting
    // =========================================================================
    
    float wa, wb, wc, totalWeight;
    
    if (useDepthBlending) {
      // Depth-based frame blending: favor frames with closer (smaller) depth
      // This picks the frame that shows the actual visible surface
      
      // Invert depths so closer = higher weight (closer depth = smaller value)
      float depthWeight_a = 1.0 - depth_a;
      float depthWeight_b = 1.0 - depth_b;
      float depthWeight_c = 1.0 - depth_c;
      
      // Combine with barycentric weights and alpha
      wa = faceWeights.x * color_a.a * depthWeight_a;
      wb = faceWeights.y * color_b.a * depthWeight_b;
      wc = faceWeights.z * color_c.a * depthWeight_c;
      
      totalWeight = wa + wb + wc;
      
      // Alpha test
      if (totalWeight < alphaThreshold) {
        discard;
      }
      
      // Normalize
      wa /= totalWeight;
      wb /= totalWeight;
      wc /= totalWeight;
      
      // For very different depths, sharpen the selection
      // This reduces ghosting when frames show different surfaces
      float maxDepthDiff = max(
        max(abs(depth_a - depth_b), abs(depth_b - depth_c)),
        abs(depth_a - depth_c)
      );
      
      if (maxDepthDiff > 0.1) {
        // Sharpen weights using softmax-like approach
        float sharpness = 4.0;
        wa = exp(wa * sharpness);
        wb = exp(wb * sharpness);
        wc = exp(wc * sharpness);
        float sumExp = wa + wb + wc;
        wa /= sumExp;
        wb /= sumExp;
        wc /= sumExp;
      }
    } else {
      // Standard alpha-weighted blending (original behavior)
      wa = faceWeights.x * color_a.a;
      wb = faceWeights.y * color_b.a;
      wc = faceWeights.z * color_c.a;
      totalWeight = wa + wb + wc;
      
      if (totalWeight < alphaThreshold) {
        discard;
      }
      
      wa /= totalWeight;
      wb /= totalWeight;
      wc /= totalWeight;
    }

    // =========================================================================
    // BLEND ALL CHANNELS
    // =========================================================================
    
    // Albedo - blend and convert to linear for lighting
    vec4 albedo = color_a * wa + color_b * wb + color_c * wc;
    vec3 albedoLinear = pow(albedo.rgb, vec3(2.2));
    
    // Depth
    float depth = depth_a * wa + depth_b * wb + depth_c * wc;
    
    // Normal - decode from [0,1] to [-1,1] then blend
    vec3 normal_dec_a = normalize(normal_a * 2.0 - 1.0);
    vec3 normal_dec_b = normalize(normal_b * 2.0 - 1.0);
    vec3 normal_dec_c = normalize(normal_c * 2.0 - 1.0);
    vec3 viewNormal = normalize(normal_dec_a * wa + normal_dec_b * wb + normal_dec_c * wc);
    
    // PBR channels
    vec3 pbr = pbr_a * wa + pbr_b * wb + pbr_c * wc;
    float roughness = pbr.r;
    float metallic = pbr.g;
    float ao = pbr.b;

    // =========================================================================
    // TRANSFORM NORMAL TO WORLD SPACE
    // =========================================================================
    
    // The baked normal is in view-space of the baking camera.
    // Build a basis from the current view direction to transform it.
    vec3 N = normalize(cameraPosition - vWorldPosition); // View direction (toward camera)
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(worldUp, N)); // Right vector
    if (length(T) < 0.001) {
      T = normalize(cross(vec3(0.0, 0.0, 1.0), N));
    }
    vec3 B = normalize(cross(N, T)); // Up vector
    
    // Transform view-space normal to world space
    vec3 worldNormal = normalize(T * viewNormal.x + B * viewNormal.y + N * viewNormal.z);
    
    // View direction for specular
    vec3 V = normalize(cameraPosition - vWorldPosition);

    // =========================================================================
    // LIGHTING CALCULATION
    // =========================================================================
    
    // Compute F0 based on metallic (metals use albedo as F0, dielectrics use constant)
    vec3 F0 = mix(vec3(specularF0), albedoLinear, metallic);
    
    // Accumulated lighting
    vec3 totalDiffuse = vec3(0.0);
    vec3 totalSpecular = vec3(0.0);
    
    // Directional lights
    for (int i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i++) {
      if (i >= numDirectionalLights) break;
      
      vec3 L = normalize(directionalLightDirs[i]);
      vec3 H = normalize(V + L);
      
      float NdotL = max(dot(worldNormal, L), 0.0);
      float NdotH = max(dot(worldNormal, H), 0.0);
      float VdotH = max(dot(V, H), 0.0);
      
      // Half-Lambert diffuse (softer for foliage)
      float halfLambert = NdotL * 0.5 + 0.5;
      vec3 diffuse = directionalLightColors[i] * directionalLightIntensities[i] * halfLambert;
      
      // Blinn-Phong specular with Fresnel
      if (useSpecular && NdotL > 0.0) {
        vec3 F = fresnelSchlick(VdotH, F0);
        // Roughness modulates shininess
        float effectiveShininess = specularShininess * (1.0 - roughness * 0.9);
        float spec = pow(NdotH, effectiveShininess);
        vec3 specular = F * spec * directionalLightColors[i] * directionalLightIntensities[i];
        totalSpecular += specular * specularIntensity;
      }
      
      totalDiffuse += diffuse;
    }
    
    // Point lights
    for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
      if (i >= numPointLights) break;
      
      vec3 lightVec = pointLightPositions[i] - vWorldPosition;
      float dist = length(lightVec);
      vec3 L = lightVec / dist;
      vec3 H = normalize(V + L);
      
      float attenuation = getPointLightAttenuation(dist, pointLightDistances[i], pointLightDecays[i]);
      
      float NdotL = max(dot(worldNormal, L), 0.0);
      float NdotH = max(dot(worldNormal, H), 0.0);
      float VdotH = max(dot(V, H), 0.0);
      
      // Half-Lambert diffuse
      float halfLambert = NdotL * 0.5 + 0.5;
      vec3 diffuse = pointLightColors[i] * pointLightIntensities[i] * attenuation * halfLambert;
      
      // Blinn-Phong specular with Fresnel
      if (useSpecular && NdotL > 0.0) {
        vec3 F = fresnelSchlick(VdotH, F0);
        float effectiveShininess = specularShininess * (1.0 - roughness * 0.9);
        float spec = pow(NdotH, effectiveShininess);
        vec3 specular = F * spec * pointLightColors[i] * pointLightIntensities[i] * attenuation;
        totalSpecular += specular * specularIntensity;
      }
      
      totalDiffuse += diffuse;
    }
    
    // Ambient with AO
    vec3 ambient = ambientColor * ambientIntensity * ao;
    
    // Final color composition
    // For metals, reduce diffuse contribution (metals have no diffuse, only specular)
    vec3 diffuseContrib = (1.0 - metallic) * albedoLinear * (ambient + totalDiffuse * 0.5);
    vec3 specularContrib = totalSpecular;
    
    vec3 finalColor = diffuseContrib + specularContrib;
    
    // Soft clamp to prevent harsh clipping
    finalColor = min(finalColor, vec3(1.2));
    finalColor = finalColor / (finalColor + vec3(0.1)); // Simple tonemapping
    finalColor *= 1.1; // Compensate for tonemapping darkening
    
    // Convert back to sRGB
    finalColor = pow(finalColor, vec3(0.4545));

    // =========================================================================
    // OUTPUT
    // =========================================================================
    
    gl_FragColor = vec4(finalColor, 1.0);
    
    // Write depth to gl_FragDepth for proper scene integration
    #ifdef GL_EXT_frag_depth
    if (useDepthOutput) {
      // Reconstruct world-space depth offset from the impostor's depth atlas
      // The depth atlas stores linear depth in [0,1] where 0=near, 1=far
      // We need to offset gl_FragCoord.z based on this
      
      // Convert linear depth to view-space Z
      float linearZ = depth * (depthFar - depthNear) + depthNear;
      linearZ *= objectScale;
      
      // The impostor billboard is at vViewPosition.z
      // Offset by the depth from the atlas
      float viewZ = vViewPosition.z - linearZ;
      
      // Convert view Z to clip Z using projection
      // For perspective: clipZ = (far + near) / (far - near) + (2 * far * near) / ((far - near) * viewZ)
      // For orthographic: clipZ = (viewZ - near) / (far - near) * 2 - 1
      // We use the clip position from vertex shader and offset it
      
      // Simple approach: interpolate between billboard depth and offset depth
      float billboardDepth = gl_FragCoord.z;
      
      // Calculate the NDC depth that would result from the actual surface
      // Using a blend factor based on how significant the depth offset is
      float depthOffset = depth * 0.5 * objectScale;
      float adjustedDepth = billboardDepth - depthOffset * 0.01;
      
      gl_FragDepthEXT = clamp(adjustedDepth, 0.0, 1.0);
    }
    #endif
  }
`;

/**
 * AAA Fragment Shader with Dissolve
 * Same as above but with distance-based dithered dissolve
 */
const IMPOSTOR_AAA_FRAGMENT_SHADER_DISSOLVE = /* glsl */ `
  #extension GL_EXT_frag_depth : enable
  
  // Atlas textures
  uniform sampler2D atlasTexture;
  uniform sampler2D normalAtlasTexture;
  uniform sampler2D depthAtlasTexture;
  uniform sampler2D pbrAtlasTexture;
  
  // Grid configuration
  uniform vec2 gridSize;
  uniform vec3 faceWeights;
  uniform vec3 faceIndices;
  
  // Debug and alpha
  uniform float debugMode;
  uniform float alphaThreshold;
  
  // Depth reconstruction
  uniform float depthNear;
  uniform float depthFar;
  uniform float objectScale;
  
  // Feature flags
  uniform bool useDepthBlending;
  uniform bool useDepthOutput;
  uniform bool usePBR;
  uniform bool useSpecular;
  
  // Dissolve uniforms
  uniform vec3 playerPos;
  uniform float fadeStartSq;
  uniform float fadeEndSq;
  
  // Lighting - Directional lights (up to 4)
  uniform int numDirectionalLights;
  uniform vec3 directionalLightDirs[${MAX_DIRECTIONAL_LIGHTS}];
  uniform vec3 directionalLightColors[${MAX_DIRECTIONAL_LIGHTS}];
  uniform float directionalLightIntensities[${MAX_DIRECTIONAL_LIGHTS}];
  
  // Lighting - Point lights (up to 4)
  uniform int numPointLights;
  uniform vec3 pointLightPositions[${MAX_POINT_LIGHTS}];
  uniform vec3 pointLightColors[${MAX_POINT_LIGHTS}];
  uniform float pointLightIntensities[${MAX_POINT_LIGHTS}];
  uniform float pointLightDistances[${MAX_POINT_LIGHTS}];
  uniform float pointLightDecays[${MAX_POINT_LIGHTS}];
  
  // Ambient
  uniform vec3 ambientColor;
  uniform float ambientIntensity;
  
  // Specular configuration
  uniform float specularF0;
  uniform float specularShininess;
  uniform float specularIntensity;
  
  // Varyings
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec4 vClipPosition;
  varying float vInstanceSeed;

  vec2 flatToCoords(float flatIndex) {
    float row = floor(flatIndex / gridSize.x);
    float col = flatIndex - row * gridSize.x;
    return vec2(col, row);
  }
  
  vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }
  
  float getPointLightAttenuation(float distance, float lightDistance, float decay) {
    if (lightDistance <= 0.0) {
      return 1.0 / max(distance * distance, 0.0001);
    }
    float d = distance / lightDistance;
    float atten = clamp(1.0 - d * d * d * d, 0.0, 1.0);
    atten = atten * atten / max(distance * distance, 0.0001);
    return atten;
  }
  
  void main() {
    // =========================================================================
    // DISSOLVE CHECK (before any expensive sampling)
    // =========================================================================
    vec3 toPlayer = vWorldPosition - playerPos;
    float distSq = toPlayer.x * toPlayer.x + toPlayer.z * toPlayer.z;
    float distanceFade = smoothstep(fadeStartSq, fadeEndSq, distSq);
    
    // Temporally stable dithering using instance seed
    float ditherScale = 0.5;
    vec2 ditherInput = vec2(
      vInstanceSeed * 100.0 + vWorldPosition.x * ditherScale + vWorldPosition.y * 0.2,
      fract(vInstanceSeed * 1.618) * 100.0 + vWorldPosition.z * ditherScale + vWorldPosition.y * 0.15
    );
    
    float hash1 = fract(sin(dot(ditherInput, vec2(12.9898, 78.233))) * 43758.5453);
    float hash2 = fract(cos(dot(ditherInput, vec2(39.346, 11.135))) * 23421.6312);
    float ditherValue = (hash1 + hash2) * 0.5;
    
    if (ditherValue < distanceFade) {
      discard;
    }
    
    // Get cell indices
    vec2 cellIndexA = flatToCoords(faceIndices.x);
    vec2 cellIndexB = flatToCoords(faceIndices.y);
    vec2 cellIndexC = flatToCoords(faceIndices.z);
    
    vec2 atlasUV_a = (cellIndexA + vUv) / gridSize;
    vec2 atlasUV_b = (cellIndexB + vUv) / gridSize;
    vec2 atlasUV_c = (cellIndexC + vUv) / gridSize;

    // Debug modes
    if (debugMode > 0.5 && debugMode < 1.5) {
      gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 1.5 && debugMode < 2.5) {
      gl_FragColor = vec4(faceWeights.xyz, 1.0);
      return;
    }
    if (debugMode > 2.5 && debugMode < 3.5) {
      gl_FragColor = vec4(atlasUV_a.x, atlasUV_a.y, 0.0, 1.0);
      return;
    }
    if (debugMode > 3.5 && debugMode < 4.5) {
      vec4 normal_debug = texture2D(normalAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(normal_debug.rgb, 1.0);
      return;
    }
    if (debugMode > 4.5 && debugMode < 5.5) {
      vec4 depth_debug = texture2D(depthAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(depth_debug.rrr, 1.0);
      return;
    }
    if (debugMode > 5.5 && debugMode < 6.5) {
      vec4 pbr_debug = texture2D(pbrAtlasTexture, atlasUV_a);
      gl_FragColor = vec4(pbr_debug.rgb, 1.0);
      return;
    }

    // Sample atlases
    vec4 color_a = texture2D(atlasTexture, atlasUV_a);
    vec4 color_b = texture2D(atlasTexture, atlasUV_b);
    vec4 color_c = texture2D(atlasTexture, atlasUV_c);
    
    float depth_a = texture2D(depthAtlasTexture, atlasUV_a).r;
    float depth_b = texture2D(depthAtlasTexture, atlasUV_b).r;
    float depth_c = texture2D(depthAtlasTexture, atlasUV_c).r;
    
    vec3 normal_a = texture2D(normalAtlasTexture, atlasUV_a).rgb;
    vec3 normal_b = texture2D(normalAtlasTexture, atlasUV_b).rgb;
    vec3 normal_c = texture2D(normalAtlasTexture, atlasUV_c).rgb;
    
    vec3 pbr_a = usePBR ? texture2D(pbrAtlasTexture, atlasUV_a).rgb : vec3(0.8, 0.0, 1.0);
    vec3 pbr_b = usePBR ? texture2D(pbrAtlasTexture, atlasUV_b).rgb : vec3(0.8, 0.0, 1.0);
    vec3 pbr_c = usePBR ? texture2D(pbrAtlasTexture, atlasUV_c).rgb : vec3(0.8, 0.0, 1.0);

    // Frame blending
    float wa, wb, wc, totalWeight;
    
    if (useDepthBlending) {
      float depthWeight_a = 1.0 - depth_a;
      float depthWeight_b = 1.0 - depth_b;
      float depthWeight_c = 1.0 - depth_c;
      
      wa = faceWeights.x * color_a.a * depthWeight_a;
      wb = faceWeights.y * color_b.a * depthWeight_b;
      wc = faceWeights.z * color_c.a * depthWeight_c;
      
      totalWeight = wa + wb + wc;
      
      if (totalWeight < alphaThreshold) {
        discard;
      }
      
      wa /= totalWeight;
      wb /= totalWeight;
      wc /= totalWeight;
      
      float maxDepthDiff = max(
        max(abs(depth_a - depth_b), abs(depth_b - depth_c)),
        abs(depth_a - depth_c)
      );
      
      if (maxDepthDiff > 0.1) {
        float sharpness = 4.0;
        wa = exp(wa * sharpness);
        wb = exp(wb * sharpness);
        wc = exp(wc * sharpness);
        float sumExp = wa + wb + wc;
        wa /= sumExp;
        wb /= sumExp;
        wc /= sumExp;
      }
    } else {
      wa = faceWeights.x * color_a.a;
      wb = faceWeights.y * color_b.a;
      wc = faceWeights.z * color_c.a;
      totalWeight = wa + wb + wc;
      
      if (totalWeight < alphaThreshold) {
        discard;
      }
      
      wa /= totalWeight;
      wb /= totalWeight;
      wc /= totalWeight;
    }

    // Blend channels
    vec4 albedo = color_a * wa + color_b * wb + color_c * wc;
    vec3 albedoLinear = pow(albedo.rgb, vec3(2.2));
    
    float depth = depth_a * wa + depth_b * wb + depth_c * wc;
    
    vec3 normal_dec_a = normalize(normal_a * 2.0 - 1.0);
    vec3 normal_dec_b = normalize(normal_b * 2.0 - 1.0);
    vec3 normal_dec_c = normalize(normal_c * 2.0 - 1.0);
    vec3 viewNormal = normalize(normal_dec_a * wa + normal_dec_b * wb + normal_dec_c * wc);
    
    vec3 pbr = pbr_a * wa + pbr_b * wb + pbr_c * wc;
    float roughness = pbr.r;
    float metallic = pbr.g;
    float ao = pbr.b;

    // Transform normal to world space
    vec3 N = normalize(cameraPosition - vWorldPosition);
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(worldUp, N));
    if (length(T) < 0.001) {
      T = normalize(cross(vec3(0.0, 0.0, 1.0), N));
    }
    vec3 B = normalize(cross(N, T));
    
    vec3 worldNormal = normalize(T * viewNormal.x + B * viewNormal.y + N * viewNormal.z);
    vec3 V = normalize(cameraPosition - vWorldPosition);

    // Lighting
    vec3 F0 = mix(vec3(specularF0), albedoLinear, metallic);
    vec3 totalDiffuse = vec3(0.0);
    vec3 totalSpecular = vec3(0.0);
    
    // Directional lights
    for (int i = 0; i < ${MAX_DIRECTIONAL_LIGHTS}; i++) {
      if (i >= numDirectionalLights) break;
      
      vec3 L = normalize(directionalLightDirs[i]);
      vec3 H = normalize(V + L);
      
      float NdotL = max(dot(worldNormal, L), 0.0);
      float NdotH = max(dot(worldNormal, H), 0.0);
      float VdotH = max(dot(V, H), 0.0);
      
      float halfLambert = NdotL * 0.5 + 0.5;
      vec3 diffuse = directionalLightColors[i] * directionalLightIntensities[i] * halfLambert;
      
      if (useSpecular && NdotL > 0.0) {
        vec3 F = fresnelSchlick(VdotH, F0);
        float effectiveShininess = specularShininess * (1.0 - roughness * 0.9);
        float spec = pow(NdotH, effectiveShininess);
        vec3 specular = F * spec * directionalLightColors[i] * directionalLightIntensities[i];
        totalSpecular += specular * specularIntensity;
      }
      
      totalDiffuse += diffuse;
    }
    
    // Point lights
    for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
      if (i >= numPointLights) break;
      
      vec3 lightVec = pointLightPositions[i] - vWorldPosition;
      float dist = length(lightVec);
      vec3 L = lightVec / dist;
      vec3 H = normalize(V + L);
      
      float attenuation = getPointLightAttenuation(dist, pointLightDistances[i], pointLightDecays[i]);
      
      float NdotL = max(dot(worldNormal, L), 0.0);
      float NdotH = max(dot(worldNormal, H), 0.0);
      float VdotH = max(dot(V, H), 0.0);
      
      float halfLambert = NdotL * 0.5 + 0.5;
      vec3 diffuse = pointLightColors[i] * pointLightIntensities[i] * attenuation * halfLambert;
      
      if (useSpecular && NdotL > 0.0) {
        vec3 F = fresnelSchlick(VdotH, F0);
        float effectiveShininess = specularShininess * (1.0 - roughness * 0.9);
        float spec = pow(NdotH, effectiveShininess);
        vec3 specular = F * spec * pointLightColors[i] * pointLightIntensities[i] * attenuation;
        totalSpecular += specular * specularIntensity;
      }
      
      totalDiffuse += diffuse;
    }
    
    // Ambient with AO
    vec3 ambient = ambientColor * ambientIntensity * ao;
    
    // Final composition
    vec3 diffuseContrib = (1.0 - metallic) * albedoLinear * (ambient + totalDiffuse * 0.5);
    vec3 specularContrib = totalSpecular;
    
    vec3 finalColor = diffuseContrib + specularContrib;
    
    // Soft clamp
    finalColor = min(finalColor, vec3(1.2));
    finalColor = finalColor / (finalColor + vec3(0.1));
    finalColor *= 1.1;
    
    // Convert to sRGB
    finalColor = pow(finalColor, vec3(0.4545));

    gl_FragColor = vec4(finalColor, 1.0);
    
    // Write depth
    #ifdef GL_EXT_frag_depth
    if (useDepthOutput) {
      float linearZ = depth * (depthFar - depthNear) + depthNear;
      linearZ *= objectScale;
      float viewZ = vViewPosition.z - linearZ;
      float billboardDepth = gl_FragCoord.z;
      float depthOffset = depth * 0.5 * objectScale;
      float adjustedDepth = billboardDepth - depthOffset * 0.01;
      gl_FragDepthEXT = clamp(adjustedDepth, 0.0, 1.0);
    }
    #endif
  }
`;

/**
 * Extended material configuration with optional dissolve support
 */
export interface ImpostorMaterialConfigExtended extends ImpostorMaterialConfig {
  /** Dissolve configuration for distance-based fade */
  dissolve?: DissolveConfig;
}

/**
 * Create an impostor material for runtime rendering
 *
 * gridSizeX/Y represents the number of points/cells per axis.
 * This matches the old code convention where GRID_SIZE=31 means 31 cells.
 *
 * If normalAtlasTexture is provided and enableLighting is true (default),
 * the material will use dynamic lighting based on the normal atlas.
 *
 * If depthAtlasTexture is provided, enables:
 * - Depth-based frame blending (reduces ghosting)
 * - gl_FragDepth output (proper scene integration)
 *
 * If pbrAtlasTexture is provided, enables:
 * - Roughness-modulated specular
 * - Metallic workflow
 * - Ambient occlusion
 *
 * @param config - Material configuration
 * @returns The configured ShaderMaterial with optional dissolve/lighting uniforms
 */
export function createImpostorMaterial(
  config: ImpostorMaterialConfigExtended,
): THREE.ShaderMaterial & {
  dissolveUniforms?: {
    playerPos: { value: THREE.Vector3 };
    fadeStartSq: { value: number };
    fadeEndSq: { value: number };
  };
  lightingUniforms?: {
    ambientColor: { value: THREE.Vector3 };
    ambientIntensity: { value: number };
    directionalLightDirs: { value: THREE.Vector3[] };
    directionalLightColors: { value: THREE.Vector3[] };
    directionalLightIntensities: { value: number[] };
    numDirectionalLights: { value: number };
    pointLightPositions: { value: THREE.Vector3[] };
    pointLightColors: { value: THREE.Vector3[] };
    pointLightIntensities: { value: number[] };
    pointLightDistances: { value: number[] };
    pointLightDecays: { value: number[] };
    numPointLights: { value: number };
  };
} {
  const {
    atlasTexture,
    normalAtlasTexture,
    depthAtlasTexture,
    pbrAtlasTexture,
    gridSizeX,
    gridSizeY,
    transparent,
    depthTest,
    depthWrite,
    side,
    enableLighting = !!normalAtlasTexture,
    enableDepthBlending = !!depthAtlasTexture,
    enableSpecular = enableLighting,
    depthNear = 0.001,
    depthFar = 10,
    objectScale = 1,
    dissolve,
  } = config;

  // Determine which shader variant to use
  const useAAA = !!depthAtlasTexture || !!pbrAtlasTexture;
  const useLighting = enableLighting && normalAtlasTexture;
  const useDissolve = dissolve?.enabled ?? false;

  // Grid center indices for initial view
  const rowSize = gridSizeX;
  const centerCol = Math.floor(gridSizeX / 2);
  const centerRow = Math.floor(gridSizeY / 2);
  const centerIdx = centerRow * rowSize + centerCol;
  const rightIdx = centerIdx + 1;
  const topIdx = centerIdx + rowSize;

  // Pre-compute squared fade distances for GPU efficiency
  const fadeStart = dissolve?.fadeStart ?? 300;
  const fadeEnd = dissolve?.fadeEnd ?? 350;
  const fadeStartSq = fadeStart * fadeStart;
  const fadeEndSq = fadeEnd * fadeEnd;

  // =========================================================================
  // BUILD UNIFORMS
  // =========================================================================

  const uniforms: Record<string, THREE.IUniform> = {
    atlasTexture: { value: atlasTexture },
    gridSize: { value: new THREE.Vector2(gridSizeX, gridSizeY) },
    faceWeights: { value: new THREE.Vector3(0.34, 0.33, 0.33) },
    faceIndices: { value: new THREE.Vector3(centerIdx, rightIdx, topIdx) },
    debugMode: { value: globalDebugMode },
    alphaThreshold: { value: globalAlphaThreshold },
  };

  // AAA shader uniforms (depth, PBR, multi-light)
  if (useAAA) {
    // Atlas textures (use placeholder 1x1 white texture if not provided)
    const placeholderTexture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    placeholderTexture.needsUpdate = true;

    uniforms.normalAtlasTexture = {
      value: normalAtlasTexture ?? placeholderTexture,
    };
    uniforms.depthAtlasTexture = {
      value: depthAtlasTexture ?? placeholderTexture,
    };
    uniforms.pbrAtlasTexture = { value: pbrAtlasTexture ?? placeholderTexture };

    // Depth reconstruction
    uniforms.depthNear = { value: depthNear };
    uniforms.depthFar = { value: depthFar };
    uniforms.objectScale = { value: objectScale };

    // Feature flags
    uniforms.useDepthBlending = {
      value: enableDepthBlending && !!depthAtlasTexture,
    };
    uniforms.useDepthOutput = { value: !!depthAtlasTexture };
    uniforms.usePBR = { value: !!pbrAtlasTexture };
    uniforms.useSpecular = { value: enableSpecular };

    // Directional lights (up to 4)
    uniforms.numDirectionalLights = { value: 1 };
    uniforms.directionalLightDirs = {
      value: [
        new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 1, 0),
      ],
    };
    uniforms.directionalLightColors = {
      value: [
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
      ],
    };
    uniforms.directionalLightIntensities = { value: [1.0, 0, 0, 0] };

    // Point lights (up to 4)
    uniforms.numPointLights = { value: 0 };
    uniforms.pointLightPositions = {
      value: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
      ],
    };
    uniforms.pointLightColors = {
      value: [
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(1, 1, 1),
      ],
    };
    uniforms.pointLightIntensities = { value: [0, 0, 0, 0] };
    uniforms.pointLightDistances = { value: [10, 10, 10, 10] };
    uniforms.pointLightDecays = { value: [2, 2, 2, 2] };

    // Ambient
    uniforms.ambientColor = { value: new THREE.Vector3(1, 1, 1) };
    uniforms.ambientIntensity = { value: 0.3 };

    // Specular configuration
    uniforms.specularF0 = { value: 0.04 }; // Plastic/dielectric default
    uniforms.specularShininess = { value: 32 };
    uniforms.specularIntensity = { value: 0.5 };
  } else if (useLighting) {
    // Legacy lighting uniforms (single light)
    uniforms.normalAtlasTexture = { value: normalAtlasTexture };
    uniforms.lightDirection = {
      value: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    };
    uniforms.lightColor = { value: new THREE.Vector3(1, 1, 1) };
    uniforms.lightIntensity = { value: 1.0 };
    uniforms.ambientColor = { value: new THREE.Vector3(1, 1, 1) };
    uniforms.ambientIntensity = { value: 0.3 };
  }

  // Dissolve uniforms
  if (useDissolve) {
    uniforms.playerPos = {
      value: dissolve?.playerPos?.clone() ?? new THREE.Vector3(0, 0, 0),
    };
    uniforms.fadeStartSq = { value: fadeStartSq };
    uniforms.fadeEndSq = { value: fadeEndSq };
  }

  // =========================================================================
  // SELECT SHADERS
  // =========================================================================

  let vertexShader: string;
  let fragmentShader: string;

  if (useAAA) {
    // Use AAA shaders with full features
    vertexShader = useDissolve
      ? IMPOSTOR_VERTEX_SHADER_DISSOLVE
      : IMPOSTOR_VERTEX_SHADER;
    fragmentShader = useDissolve
      ? IMPOSTOR_AAA_FRAGMENT_SHADER_DISSOLVE
      : IMPOSTOR_AAA_FRAGMENT_SHADER;
  } else if (useDissolve) {
    // Legacy dissolve shaders
    vertexShader = IMPOSTOR_VERTEX_SHADER_DISSOLVE;
    fragmentShader = useLighting
      ? IMPOSTOR_LIT_FRAGMENT_SHADER_DISSOLVE
      : IMPOSTOR_FRAGMENT_SHADER_DISSOLVE;
  } else {
    // Legacy shaders
    vertexShader = IMPOSTOR_VERTEX_SHADER;
    fragmentShader = useLighting
      ? IMPOSTOR_LIT_FRAGMENT_SHADER
      : IMPOSTOR_FRAGMENT_SHADER;
  }

  // =========================================================================
  // CREATE MATERIAL
  // =========================================================================

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: transparent ?? true,
    depthTest: depthTest ?? true,
    depthWrite: depthWrite ?? true,
    side: side ?? THREE.DoubleSide,
  }) as THREE.ShaderMaterial & {
    dissolveUniforms?: {
      playerPos: { value: THREE.Vector3 };
      fadeStartSq: { value: number };
      fadeEndSq: { value: number };
    };
    lightingUniforms?: {
      ambientColor: { value: THREE.Vector3 };
      ambientIntensity: { value: number };
      directionalLightDirs: { value: THREE.Vector3[] };
      directionalLightColors: { value: THREE.Vector3[] };
      directionalLightIntensities: { value: number[] };
      numDirectionalLights: { value: number };
      pointLightPositions: { value: THREE.Vector3[] };
      pointLightColors: { value: THREE.Vector3[] };
      pointLightIntensities: { value: number[] };
      pointLightDistances: { value: number[] };
      pointLightDecays: { value: number[] };
      numPointLights: { value: number };
    };
  };

  // Attach dissolve uniforms for easy per-frame updates
  if (useDissolve) {
    material.dissolveUniforms = {
      playerPos: uniforms.playerPos as { value: THREE.Vector3 },
      fadeStartSq: uniforms.fadeStartSq as { value: number },
      fadeEndSq: uniforms.fadeEndSq as { value: number },
    };
  }

  // Attach lighting uniforms for easy updates
  if (useAAA) {
    material.lightingUniforms = {
      ambientColor: uniforms.ambientColor as { value: THREE.Vector3 },
      ambientIntensity: uniforms.ambientIntensity as { value: number },
      directionalLightDirs: uniforms.directionalLightDirs as {
        value: THREE.Vector3[];
      },
      directionalLightColors: uniforms.directionalLightColors as {
        value: THREE.Vector3[];
      },
      directionalLightIntensities: uniforms.directionalLightIntensities as {
        value: number[];
      },
      numDirectionalLights: uniforms.numDirectionalLights as { value: number },
      pointLightPositions: uniforms.pointLightPositions as {
        value: THREE.Vector3[];
      },
      pointLightColors: uniforms.pointLightColors as { value: THREE.Vector3[] },
      pointLightIntensities: uniforms.pointLightIntensities as {
        value: number[];
      },
      pointLightDistances: uniforms.pointLightDistances as { value: number[] },
      pointLightDecays: uniforms.pointLightDecays as { value: number[] },
      numPointLights: uniforms.numPointLights as { value: number },
    };
  }

  // Register for global debug mode updates
  registerMaterial(material);

  return material;
}

/**
 * Update lighting uniforms on an impostor material.
 * Supports both legacy single-light and AAA multi-light materials.
 *
 * @param material - The impostor material
 * @param lighting - Lighting configuration (legacy format)
 */
export function updateImpostorLighting(
  material: THREE.ShaderMaterial,
  lighting: {
    lightDirection?: THREE.Vector3;
    lightColor?: THREE.Vector3;
    lightIntensity?: number;
    ambientColor?: THREE.Vector3;
    ambientIntensity?: number;
  },
): void {
  // Legacy single-light update
  if (lighting.lightDirection && material.uniforms.lightDirection) {
    material.uniforms.lightDirection.value
      .copy(lighting.lightDirection)
      .normalize();
  }
  if (lighting.lightColor && material.uniforms.lightColor) {
    material.uniforms.lightColor.value.copy(lighting.lightColor);
  }
  if (
    lighting.lightIntensity !== undefined &&
    material.uniforms.lightIntensity
  ) {
    material.uniforms.lightIntensity.value = lighting.lightIntensity;
  }

  // AAA multi-light update (maps to first directional light)
  if (lighting.lightDirection && material.uniforms.directionalLightDirs) {
    material.uniforms.directionalLightDirs.value[0]
      .copy(lighting.lightDirection)
      .normalize();
  }
  if (lighting.lightColor && material.uniforms.directionalLightColors) {
    material.uniforms.directionalLightColors.value[0].copy(lighting.lightColor);
  }
  if (
    lighting.lightIntensity !== undefined &&
    material.uniforms.directionalLightIntensities
  ) {
    material.uniforms.directionalLightIntensities.value[0] =
      lighting.lightIntensity;
    material.uniforms.numDirectionalLights.value = Math.max(
      1,
      material.uniforms.numDirectionalLights.value,
    );
  }

  // Ambient (same for both)
  if (lighting.ambientColor && material.uniforms.ambientColor) {
    material.uniforms.ambientColor.value.copy(lighting.ambientColor);
  }
  if (
    lighting.ambientIntensity !== undefined &&
    material.uniforms.ambientIntensity
  ) {
    material.uniforms.ambientIntensity.value = lighting.ambientIntensity;
  }
}

/**
 * AAA lighting configuration for full multi-light support
 */
export interface AAALightingConfig {
  /** Ambient light color (linear RGB, 0-1) */
  ambientColor?: THREE.Vector3;
  /** Ambient light intensity */
  ambientIntensity?: number;
  /** Directional lights (up to 4) */
  directionalLights?: Array<{
    direction: THREE.Vector3;
    color: THREE.Vector3;
    intensity: number;
  }>;
  /** Point lights (up to 4) */
  pointLights?: Array<{
    position: THREE.Vector3;
    color: THREE.Vector3;
    intensity: number;
    distance: number;
    decay: number;
  }>;
  /** Specular configuration */
  specular?: {
    f0?: number;
    shininess?: number;
    intensity?: number;
  };
}

/**
 * Update AAA lighting uniforms on an impostor material.
 * Supports multiple directional and point lights.
 *
 * @param material - The impostor material (must be created with AAA features)
 * @param config - Full lighting configuration
 */
export function updateImpostorAAALighting(
  material: THREE.ShaderMaterial,
  config: AAALightingConfig,
): void {
  // Ambient
  if (config.ambientColor && material.uniforms.ambientColor) {
    material.uniforms.ambientColor.value.copy(config.ambientColor);
  }
  if (
    config.ambientIntensity !== undefined &&
    material.uniforms.ambientIntensity
  ) {
    material.uniforms.ambientIntensity.value = config.ambientIntensity;
  }

  // Directional lights
  if (config.directionalLights && material.uniforms.directionalLightDirs) {
    const count = Math.min(
      config.directionalLights.length,
      MAX_DIRECTIONAL_LIGHTS,
    );
    material.uniforms.numDirectionalLights.value = count;

    for (let i = 0; i < count; i++) {
      const light = config.directionalLights[i];
      material.uniforms.directionalLightDirs.value[i]
        .copy(light.direction)
        .normalize();
      material.uniforms.directionalLightColors.value[i].copy(light.color);
      material.uniforms.directionalLightIntensities.value[i] = light.intensity;
    }
  }

  // Point lights
  if (config.pointLights && material.uniforms.pointLightPositions) {
    const count = Math.min(config.pointLights.length, MAX_POINT_LIGHTS);
    material.uniforms.numPointLights.value = count;

    for (let i = 0; i < count; i++) {
      const light = config.pointLights[i];
      material.uniforms.pointLightPositions.value[i].copy(light.position);
      material.uniforms.pointLightColors.value[i].copy(light.color);
      material.uniforms.pointLightIntensities.value[i] = light.intensity;
      material.uniforms.pointLightDistances.value[i] = light.distance;
      material.uniforms.pointLightDecays.value[i] = light.decay;
    }
  }

  // Specular
  if (config.specular) {
    if (config.specular.f0 !== undefined && material.uniforms.specularF0) {
      material.uniforms.specularF0.value = config.specular.f0;
    }
    if (
      config.specular.shininess !== undefined &&
      material.uniforms.specularShininess
    ) {
      material.uniforms.specularShininess.value = config.specular.shininess;
    }
    if (
      config.specular.intensity !== undefined &&
      material.uniforms.specularIntensity
    ) {
      material.uniforms.specularIntensity.value = config.specular.intensity;
    }
  }
}

/**
 * Sync impostor lighting with Three.js scene lights.
 * Extracts lights from the scene and updates the material.
 *
 * @param material - The impostor material
 * @param scene - The Three.js scene containing lights
 */
export function syncImpostorLightingFromScene(
  material: THREE.ShaderMaterial,
  scene: THREE.Scene,
): void {
  const directionalLights: AAALightingConfig["directionalLights"] = [];
  const pointLights: AAALightingConfig["pointLights"] = [];
  let ambientColor = new THREE.Vector3(0, 0, 0);
  let ambientIntensity = 0;

  scene.traverse((obj) => {
    if (
      obj instanceof THREE.DirectionalLight &&
      directionalLights.length < MAX_DIRECTIONAL_LIGHTS
    ) {
      // Get direction from light's target
      const direction = new THREE.Vector3();
      obj.getWorldDirection(direction);
      direction.negate(); // DirectionalLight points AT target, we want direction TO light

      directionalLights.push({
        direction,
        color: new THREE.Vector3(obj.color.r, obj.color.g, obj.color.b),
        intensity: obj.intensity,
      });
    } else if (
      obj instanceof THREE.PointLight &&
      pointLights.length < MAX_POINT_LIGHTS
    ) {
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);

      pointLights.push({
        position: worldPos,
        color: new THREE.Vector3(obj.color.r, obj.color.g, obj.color.b),
        intensity: obj.intensity,
        distance: obj.distance,
        decay: obj.decay,
      });
    } else if (obj instanceof THREE.AmbientLight) {
      // Accumulate ambient lights
      ambientColor.add(
        new THREE.Vector3(
          obj.color.r * obj.intensity,
          obj.color.g * obj.intensity,
          obj.color.b * obj.intensity,
        ),
      );
      ambientIntensity = 1.0; // Will be multiplied by accumulated color
    }
  });

  // Normalize ambient if we accumulated any
  if (ambientIntensity > 0) {
    const maxComponent = Math.max(
      ambientColor.x,
      ambientColor.y,
      ambientColor.z,
      0.001,
    );
    ambientColor.divideScalar(maxComponent);
    ambientIntensity = maxComponent;
  } else {
    // Default ambient if none found
    ambientColor.set(1, 1, 1);
    ambientIntensity = 0.1;
  }

  updateImpostorAAALighting(material, {
    ambientColor,
    ambientIntensity,
    directionalLights,
    pointLights,
  });
}

/**
 * Update impostor material uniforms with view data
 *
 * @param material - The impostor material
 * @param viewData - The view data from octahedron raycasting
 */
export function updateImpostorMaterial(
  material: THREE.ShaderMaterial,
  viewData: ImpostorViewData,
): void {
  material.uniforms.faceIndices.value.copy(viewData.faceIndices);
  material.uniforms.faceWeights.value.copy(viewData.faceWeights);
}

/**
 * Create a billboard material variant that doesn't require view data updates
 * Uses a simplified single-view sampling approach
 */
export function createSimpleImpostorMaterial(
  config: ImpostorMaterialConfig,
): THREE.ShaderMaterial {
  const {
    atlasTexture,
    gridSizeX,
    gridSizeY,
    transparent,
    depthTest,
    depthWrite,
    side,
  } = config;

  const simpleFragmentShader = /* glsl */ `
    uniform sampler2D atlasTexture;
    uniform vec2 gridSize;
    uniform vec2 cellIndex;
    uniform float debugMode;
    
    varying vec2 vUv;
    
    void main() {
      // Atlas has gridSize cells per axis
      vec2 atlasUV = (cellIndex + vUv) / gridSize;
      
      // Debug mode 1: show UV coordinates
      if (debugMode > 0.5 && debugMode < 1.5) {
        gl_FragColor = vec4(atlasUV.x, atlasUV.y, 0.0, 1.0);
        return;
      }
      
      // Debug mode 3: show cell index
      if (debugMode > 2.5) {
        gl_FragColor = vec4(cellIndex.x / gridSize.x, cellIndex.y / gridSize.y, 0.5, 1.0);
        return;
      }
      
      vec4 color = texture2D(atlasTexture, atlasUV);
      
      if (color.a < 0.1) {
        discard;
      }
      
      gl_FragColor = color;
    }
  `;

  // Center cell index - middle of the grid
  const centerCellX = Math.floor(gridSizeX / 2);
  const centerCellY = Math.floor(gridSizeY / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      atlasTexture: { value: atlasTexture },
      gridSize: { value: new THREE.Vector2(gridSizeX, gridSizeY) },
      cellIndex: { value: new THREE.Vector2(centerCellX, centerCellY) },
      debugMode: { value: globalDebugMode },
    },
    vertexShader: IMPOSTOR_VERTEX_SHADER,
    fragmentShader: simpleFragmentShader,
    transparent: transparent ?? true,
    depthTest: depthTest ?? true,
    depthWrite: depthWrite ?? true,
    side: side ?? THREE.DoubleSide,
  });

  // Register for global debug mode updates
  registerMaterial(material);

  return material;
}

/**
 * Get the shaders for custom material creation
 */
export const ImpostorShaders = {
  vertex: IMPOSTOR_VERTEX_SHADER,
  fragment: IMPOSTOR_FRAGMENT_SHADER,
};
