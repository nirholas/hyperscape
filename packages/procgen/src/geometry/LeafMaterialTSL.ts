/**
 * Instanced Leaf Material - WebGPU TSL Version
 *
 * Uses Three.js TSL (Three Shading Language) for WebGPU compatibility.
 * Supports instanced rendering with quaternion-based rotation.
 *
 * Features:
 * - Instanced rendering with custom orientation attribute
 * - Quaternion-based rotation for leaf orientation
 * - Procedural leaf alpha shapes (elliptic, ovate, maple, oak, palm, needle)
 * - Per-instance color variation
 * - Subsurface scattering simulation
 */

import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";

// TSL functions from three/webgpu
const {
  Fn,
  uv,
  positionLocal,
  instanceIndex,
  attribute,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  add,
  sub,
  mul,
  div,
  dot,
  abs,
  fract,
  sin,
  cos,
  max,
  normalize,
  cross,
  smoothstep,
  mix,
  select,
  length,
  step,
  cameraPosition,
  positionWorld,
} = THREE_WEBGPU.TSL;

/** Leaf shape types for procedural generation */
export type TSLLeafShape =
  | "elliptic"
  | "ovate"
  | "maple"
  | "oak"
  | "palm"
  | "needle";

/** Options for TSL instanced leaf material */
export type TSLInstancedLeafMaterialOptions = {
  color?: THREE.Color;
  colorVariation?: number;
  alphaTest?: number;
  opacity?: number;
  side?: THREE.Side;
  leafShape?: TSLLeafShape;
  subsurfaceScatter?: number;
  windStrength?: number;
  time?: number;
};

/** TSL Instanced Leaf Material type with update methods */
export type TSLInstancedLeafMaterial = THREE_WEBGPU.MeshBasicNodeMaterial & {
  leafUniforms: {
    color: { value: THREE.Color };
    colorVariation: { value: number };
    alphaTest: { value: number };
    opacity: { value: number };
    subsurface: { value: number };
    windStrength: { value: number };
    time: { value: number };
  };
  /** Update time for wind animation */
  updateTime: (time: number) => void;
};

/**
 * Create a WebGPU TSL instanced leaf material.
 * Supports quaternion-based instance rotation and procedural leaf shapes.
 */
export function createInstancedLeafMaterialTSL(
  options: TSLInstancedLeafMaterialOptions = {},
): TSLInstancedLeafMaterial {
  const {
    color = new THREE.Color(0x3d7a3d),
    colorVariation = 0.15,
    alphaTest = 0.5,
    opacity = 1.0,
    side = THREE.DoubleSide,
    leafShape = "elliptic",
    subsurfaceScatter = 0.3,
    windStrength = 0.0,
  } = options;

  // Create material
  const material = new MeshBasicNodeMaterial();
  material.side = side;
  material.transparent = true;

  // ========== UNIFORMS ==========
  const uColor = uniform(color);
  const uColorVariation = uniform(float(colorVariation));
  const uAlphaTest = uniform(float(alphaTest));
  const uOpacity = uniform(float(opacity));
  const uSubsurface = uniform(float(subsurfaceScatter));
  const uWindStrength = uniform(float(windStrength));
  const uTime = uniform(float(0));

  // ========== HELPER FUNCTIONS ==========

  // Hash function for randomness
  const hash = Fn(([n]: [ReturnType<typeof float>]) => {
    return fract(mul(sin(n), 43758.5453123));
  });

  // Hash3 for color variation
  const hash3 = Fn(([n]: [ReturnType<typeof float>]) => {
    return vec3(hash(n), hash(add(n, 127.1)), hash(add(n, 269.5)));
  });

  // Quaternion rotation: rotate vector v by quaternion q
  const rotateByQuat = Fn(
    ([v, q]: [ReturnType<typeof vec3>, ReturnType<typeof vec4>]) => {
      const qxyz = vec3(q.x, q.y, q.z);
      const t = mul(2.0, cross(qxyz, v));
      return add(v, add(mul(q.w, t), cross(qxyz, t)));
    },
  );

  // ========== LEAF SHAPE FUNCTIONS ==========

  // Elliptic leaf shape
  const leafShapeElliptic = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.5));
    const a = float(0.35);
    const b = float(0.48);
    const pointiness = mul(smoothstep(0.3, 0.5, uvCoord.y), 0.15);
    const aAdjusted = sub(a, mul(pointiness, abs(p.x)));
    const d = add(
      div(mul(p.x, p.x), mul(aAdjusted, aAdjusted)),
      div(mul(p.y, p.y), mul(b, b)),
    );
    return sub(1.0, smoothstep(0.9, 1.0, d));
  });

  // Ovate leaf shape
  const leafShapeOvate = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.4));
    const widthMod = mix(float(0.4), float(0.2), uvCoord.y);
    const d = length(div(p, vec2(widthMod, 0.5)));
    const tip = smoothstep(0.7, 0.95, uvCoord.y);
    const dWithTip = add(d, mul(tip, 0.5));
    return sub(1.0, smoothstep(0.85, 1.0, dWithTip));
  });

  // Maple leaf shape (simplified - star pattern)
  const leafShapeMaple = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = mul(sub(uvCoord, 0.5), 2.0);
    const r = length(p);
    // Approximate angle-based lobes using x/y ratio
    const angle = mul(add(p.x, p.y), 5.0);
    const lobes = add(0.5, mul(0.3, cos(angle)));
    const shape = sub(1.0, smoothstep(mul(lobes, 0.85), mul(lobes, 0.9), r));
    // Stem notch
    const stemMask = mul(
      step(uvCoord.y, 0.15),
      step(abs(sub(uvCoord.x, 0.5)), 0.05),
    );
    return mul(shape, sub(1.0, stemMask));
  });

  // Oak leaf shape
  const leafShapeOak = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.5));
    const base = sub(
      1.0,
      smoothstep(0.8, 1.0, length(div(p, vec2(0.35, 0.48)))),
    );
    // Wavy edges
    const angle = mul(add(p.x, p.y), 7.0);
    const lobeWave = mul(0.08, sin(add(angle, 1.5)));
    const r = length(p);
    const lobed = sub(
      1.0,
      smoothstep(add(0.35, lobeWave), add(0.4, lobeWave), r),
    );
    return mul(lobed, base);
  });

  // Palm/frond leaf shape
  const leafShapePalm = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.5));
    const width = max(mul(0.12, sub(1.0, mul(abs(p.y), 1.5))), 0.02);
    const d = div(abs(p.x), width);
    const edge = sub(1.0, smoothstep(0.8, 1.0, d));
    const len = sub(1.0, smoothstep(0.45, 0.5, abs(p.y)));
    return mul(edge, len);
  });

  // Needle leaf shape
  const leafShapeNeedle = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.5));
    const width = max(mul(0.08, sub(1.0, mul(abs(p.y), 1.8))), 0.01);
    const d = div(abs(p.x), width);
    const edge = sub(1.0, smoothstep(0.7, 1.0, d));
    const len = sub(1.0, smoothstep(0.48, 0.5, abs(p.y)));
    return mul(edge, len);
  });

  // Select leaf shape based on option
  const getLeafAlpha = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    switch (leafShape) {
      case "ovate":
        return leafShapeOvate(uvCoord);
      case "maple":
        return leafShapeMaple(uvCoord);
      case "oak":
        return leafShapeOak(uvCoord);
      case "palm":
        return leafShapePalm(uvCoord);
      case "needle":
        return leafShapeNeedle(uvCoord);
      case "elliptic":
      default:
        return leafShapeElliptic(uvCoord);
    }
  });

  // Leaf vein pattern
  const leafVeins = Fn(([uvCoord]: [ReturnType<typeof vec2>]) => {
    const p = sub(uvCoord, vec2(0.5, 0.0));
    // Central vein
    const centralVein = sub(1.0, smoothstep(0.0, 0.02, abs(p.x)));
    return mul(centralVein, 0.6);
  });

  // ========== VERTEX POSITION NODE ==========
  // Get instance orientation from attribute
  const instanceOrientation = attribute("instanceOrientation", "vec4");

  // Custom position calculation with quaternion rotation
  const customPosition = Fn(() => {
    const pos = positionLocal;
    const quat = instanceOrientation;

    // Apply quaternion rotation to position
    const rotatedPos = rotateByQuat(pos, quat);

    // Wind animation using select (conditional)
    const windPhase = mul(hash(float(instanceIndex)), 6.28);
    const windAmount = mul(mul(uWindStrength, pos.y), 0.1);
    const windX = mul(sin(add(mul(uTime, 2.0), windPhase)), windAmount);
    const windZ = mul(
      mul(cos(add(mul(uTime, 1.5), mul(windPhase, 0.7))), windAmount),
      0.5,
    );

    // Apply wind only if windStrength > 0
    const hasWind = uWindStrength.greaterThan(0.0);
    const finalX = select(hasWind, add(rotatedPos.x, windX), rotatedPos.x);
    const finalZ = select(hasWind, add(rotatedPos.z, windZ), rotatedPos.z);

    return vec3(finalX, rotatedPos.y, finalZ);
  });

  // Set custom position
  material.positionNode = customPosition();

  // ========== FRAGMENT COLOR NODE ==========
  const customColor = Fn(() => {
    const uvCoord = uv();
    const instIdx = float(instanceIndex);

    // Get procedural leaf alpha
    const alpha = getLeafAlpha(uvCoord);

    // Alpha test using select (discard simulation via zero alpha)
    const passesAlphaTest = alpha.greaterThanEqual(uAlphaTest);
    const finalAlpha = select(passesAlphaTest, alpha, float(0.0));

    // Instance-based color variation
    const variation = sub(mul(hash3(instIdx), 2.0), 1.0);
    const leafColor = add(uColor, mul(variation, uColorVariation));

    // Darken edges slightly for depth
    const edgeDark = add(mul(smoothstep(0.3, 0.8, alpha), 0.2), 0.8);
    const darkendColor = mul(leafColor, edgeDark);

    // Add subtle vein pattern (darker)
    const veins = leafVeins(uvCoord);
    const veinedColor = mix(
      darkendColor,
      mul(darkendColor, 0.7),
      mul(veins, 0.3),
    );

    // Simple lighting using world position
    const worldPos = positionWorld;
    const viewDir = normalize(sub(cameraPosition, worldPos));
    const lightDir = normalize(vec3(0.5, 1.0, 0.3));

    // Simple two-sided diffuse
    const NdotL = dot(viewDir, lightDir);
    const diff = abs(NdotL);

    // Subsurface scattering simulation (back-lighting)
    const isBackLit = NdotL.lessThan(0.0);
    const subsurfaceAmount = select(
      isBackLit,
      mul(mul(NdotL, -1.0), uSubsurface),
      float(0.0),
    );

    const ambient = float(0.35);
    const light = add(add(ambient, mul(diff, 0.5)), subsurfaceAmount);

    // Subsurface adds warmth
    const subsurfaceColor = mul(veinedColor, vec3(1.2, 1.1, 0.8));
    const litColor = select(
      isBackLit,
      mul(mix(veinedColor, subsurfaceColor, subsurfaceAmount), light),
      mul(veinedColor, light),
    );

    return vec4(litColor, mul(finalAlpha, uOpacity));
  });

  material.colorNode = customColor();

  // Store uniforms for runtime updates
  const tslMaterial = material as TSLInstancedLeafMaterial;
  tslMaterial.leafUniforms = {
    color: uColor,
    colorVariation: uColorVariation,
    alphaTest: uAlphaTest,
    opacity: uOpacity,
    subsurface: uSubsurface,
    windStrength: uWindStrength,
    time: uTime,
  };

  // Update methods
  tslMaterial.updateTime = (time: number) => {
    uTime.value = time;
  };

  return tslMaterial;
}

/**
 * Check if a material is a TSL instanced leaf material.
 */
export function isTSLInstancedLeafMaterial(
  material: THREE.Material,
): material is TSLInstancedLeafMaterial {
  return (
    material instanceof MeshBasicNodeMaterial &&
    "leafUniforms" in material &&
    "updateTime" in material
  );
}
