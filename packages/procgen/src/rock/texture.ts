/**
 * Procedural Texture Generation
 *
 * UV generation, procedural patterns, and texture baking utilities.
 */

import * as THREE from "three";
import type { TextureParams, UVMethodType, RockParams } from "./types";
import { TexturePattern, UVMethod } from "./types";
import { SimplexNoise } from "./noise";
import { clamp } from "../math/Vector3.js";

// ============================================================================
// COLOR UTILITIES
// ============================================================================

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255,
    };
  }
  return { r: 0.5, g: 0.5, b: 0.5 };
}

function lerpColor(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
  };
}

// ============================================================================
// UV GENERATION
// ============================================================================

/**
 * Generate UV coordinates for geometry using specified method
 */
export function generateUVs(
  geometry: THREE.BufferGeometry,
  method: UVMethodType,
): Float32Array {
  const position = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const vertexCount = position.count;
  const uvs = new Float32Array(vertexCount * 2);

  switch (method) {
    case UVMethod.Spherical: {
      for (let i = 0; i < vertexCount; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        const nx = x / len;
        const ny = y / len;
        const nz = z / len;
        uvs[i * 2] = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
        uvs[i * 2 + 1] = 0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI;
      }
      break;
    }

    case UVMethod.Unwrap: {
      // Per-triangle unwrap with grid packing
      const index = geometry.index;
      const triCount = index ? index.count / 3 : vertexCount / 3;
      const gridSize = Math.ceil(Math.sqrt(triCount));
      const cellSize = 1.0 / gridSize;
      const margin = cellSize * 0.05;

      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        const gridX = t % gridSize;
        const gridY = Math.floor(t / gridSize);
        const baseU = gridX * cellSize + margin;
        const baseV = gridY * cellSize + margin;
        const size = cellSize - margin * 2;

        uvs[i0 * 2] = baseU;
        uvs[i0 * 2 + 1] = baseV;
        uvs[i1 * 2] = baseU + size;
        uvs[i1 * 2 + 1] = baseV;
        uvs[i2 * 2] = baseU + size * 0.5;
        uvs[i2 * 2 + 1] = baseV + size;
      }
      break;
    }

    case UVMethod.Box:
    default: {
      // Box/triplanar projection
      for (let i = 0; i < vertexCount; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const normalX = Math.abs(normals.getX(i));
        const normalY = Math.abs(normals.getY(i));
        const normalZ = Math.abs(normals.getZ(i));

        let u: number, v: number;
        if (normalY > normalX && normalY > normalZ) {
          u = x * 0.5 + 0.5;
          v = z * 0.5 + 0.5;
        } else if (normalX > normalZ) {
          u = z * 0.5 + 0.5;
          v = y * 0.5 + 0.5;
        } else {
          u = x * 0.5 + 0.5;
          v = y * 0.5 + 0.5;
        }

        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
      break;
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return uvs;
}

// ============================================================================
// PROCEDURAL TEXTURE PATTERNS
// ============================================================================

/**
 * Sample a procedural texture pattern at given coordinates
 */
export function samplePattern(
  noise: SimplexNoise,
  x: number,
  y: number,
  pattern: TextureParams,
): { value: number; roughValue: number } {
  const { scale, detail, contrast } = pattern;
  const nx = x * scale;
  const ny = y * scale;

  let value = 0;
  let roughValue = 0;

  switch (pattern.pattern) {
    case TexturePattern.Layered: {
      // Horizontal layers like sandstone
      let layerNoise = 0;
      let amp = 1;
      let freq = 1;
      for (let i = 0; i < detail; i++) {
        layerNoise += noise.noise2D(nx * freq * 0.5, ny * freq * 3) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      const layerY = ny * 4 + layerNoise * 0.5;
      value = Math.sin(layerY * Math.PI * 2) * 0.5 + 0.5;
      value = Math.pow(value, 0.7);
      roughValue = value;
      break;
    }

    case TexturePattern.Speckled: {
      // Speckled pattern like granite
      let speckle = 0;
      let amp = 1;
      let freq = 1;
      for (let i = 0; i < detail; i++) {
        const n = noise.noise2D(nx * freq, ny * freq);
        speckle += Math.abs(n) * amp;
        amp *= 0.5;
        freq *= 2.2;
      }
      const spots = noise.noise2D(nx * 0.8, ny * 0.8);
      value = speckle * 0.6 + (spots > 0.3 ? 0.3 : 0);
      const darkSpots = noise.noise2D(nx * 15, ny * 15);
      if (darkSpots > 0.6) value -= 0.3;
      roughValue = 0.5 + speckle * 0.3;
      break;
    }

    case TexturePattern.Veined: {
      // Veined pattern like marble
      const warp = noise.fbm2D(nx, ny, detail, 2, 0.5);
      const veinX = nx + warp * 0.5;
      const veinY = ny + warp * 0.5;
      let vein = Math.sin((veinX + veinY) * Math.PI * 2);
      vein = Math.abs(vein);
      vein = Math.pow(vein, 0.3);
      let vein2 = Math.sin((veinX * 1.5 - veinY * 0.8) * Math.PI * 3);
      vein2 = Math.abs(vein2);
      vein2 = Math.pow(vein2, 0.5);
      value = 1 - Math.min(vein, vein2) * 0.7;
      roughValue = value * 0.5;
      break;
    }

    case TexturePattern.Cellular: {
      // Cellular/cracked pattern like basalt
      let minDist = Infinity;
      let secondDist = Infinity;
      const cellSize = scale * 0.15;
      const cellX = Math.floor(nx / cellSize);
      const cellY = Math.floor(ny / cellSize);
      for (let cy = cellY - 1; cy <= cellY + 1; cy++) {
        for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
          const seed = (cx * 127 + cy * 311) & 0xffff;
          const px = (cx + 0.5 + Math.sin(seed) * 0.5) * cellSize;
          const py = (cy + 0.5 + Math.cos(seed * 1.3) * 0.5) * cellSize;
          const dist = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2);
          if (dist < minDist) {
            secondDist = minDist;
            minDist = dist;
          } else if (dist < secondDist) {
            secondDist = dist;
          }
        }
      }
      const edge = secondDist - minDist;
      value = Math.min(1, edge * 15);
      value = Math.pow(value, 0.5);
      roughValue = 1 - value * 0.5;
      break;
    }

    case TexturePattern.Flow: {
      // Flow pattern like obsidian
      const flowWarp = noise.fbm2D(nx * 0.5, ny * 0.5, detail, 2, 0.6);
      const flowX = nx + flowWarp * 1.5;
      const flowY = ny + flowWarp * 1.5;
      const flow = noise.fbm2D(flowX, flowY * 0.3, detail, 2, 0.5);
      const flowNorm = flow * 0.5 + 0.5;
      const streak = Math.sin((flowX * 2 + flowNorm * 3) * Math.PI);
      value = flowNorm * 0.7 + streak * 0.15 + 0.15;
      roughValue = 0.3 + flowNorm * 0.3;
      break;
    }

    case TexturePattern.Noise:
    default: {
      // Standard FBM noise
      value = noise.fbm2D(nx, ny, detail, 2, 0.5);
      value = value * 0.5 + 0.5;
      roughValue = value;
      break;
    }
  }

  // Apply contrast
  value = Math.pow(clamp(value, 0, 1), 1 / contrast);

  return { value, roughValue };
}

// ============================================================================
// TEXTURE BAKING
// ============================================================================

/**
 * Bake texture result
 */
export type BakedTexture = {
  /** Color texture */
  colorTexture: THREE.CanvasTexture;
  /** Roughness texture */
  roughnessTexture: THREE.CanvasTexture;
  /** Canvas element (for PNG export) */
  canvas: HTMLCanvasElement;
  /** Resolution */
  resolution: number;
};

/**
 * Bake procedural texture to UV-mapped texture
 */
export function bakeTexture(
  geometry: THREE.BufferGeometry,
  params: RockParams,
  noise: SimplexNoise,
  resolution: number = 1024,
  useTriplanar: boolean = true,
): BakedTexture {
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d")!;

  const roughnessCanvas = document.createElement("canvas");
  roughnessCanvas.width = resolution;
  roughnessCanvas.height = resolution;
  const roughCtx = roughnessCanvas.getContext("2d")!;

  const imageData = ctx.createImageData(resolution, resolution);
  const roughnessData = roughCtx.createImageData(resolution, resolution);
  const data = imageData.data;
  const roughData = roughnessData.data;

  // Initialize transparent
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 0;
  }

  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const index = geometry.index;

  const col1 = hexToRGB(params.colors.baseColor);
  const col2 = hexToRGB(params.colors.secondaryColor);
  const col3 = hexToRGB(params.colors.accentColor);

  // Triplanar sampling function
  function sampleTriplanar(
    worldPos: THREE.Vector3,
    worldNormal: THREE.Vector3,
  ): { r: number; g: number; b: number } {
    const x = worldPos.x * params.texture.scale;
    const y = worldPos.y * params.texture.scale;
    const z = worldPos.z * params.texture.scale;

    let value: number;

    if (useTriplanar) {
      // Triplanar blend weights
      let blendX = Math.abs(worldNormal.x);
      let blendY = Math.abs(worldNormal.y);
      let blendZ = Math.abs(worldNormal.z);

      const sharpness = 4.0;
      blendX = Math.pow(blendX, sharpness);
      blendY = Math.pow(blendY, sharpness);
      blendZ = Math.pow(blendZ, sharpness);

      const sum = blendX + blendY + blendZ + 0.0001;
      blendX /= sum;
      blendY /= sum;
      blendZ /= sum;

      const valYZ = samplePattern(noise, y, z, params.texture).value;
      const valXZ = samplePattern(noise, x, z, params.texture).value;
      const valXY = samplePattern(noise, x, y, params.texture).value;
      value = valYZ * blendX + valXZ * blendY + valXY * blendZ;
    } else {
      value = noise.fbm(x, y, z, params.texture.detail, 2, 0.5) * 0.5 + 0.5;
    }

    value = Math.pow(clamp(value, 0, 1), 1 / params.texture.contrast);

    let color: { r: number; g: number; b: number };
    if (value < 0.5) {
      color = lerpColor(col3, col1, value * 2);
    } else {
      color = lerpColor(col1, col2, (value - 0.5) * 2);
    }

    return color;
  }

  // Rasterize triangles
  const triCount = index ? index.count / 3 : position.count / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    const uv0 = { x: uv.getX(i0), y: uv.getY(i0) };
    const uv1 = { x: uv.getX(i1), y: uv.getY(i1) };
    const uv2 = { x: uv.getX(i2), y: uv.getY(i2) };

    const p0 = new THREE.Vector3(
      position.getX(i0),
      position.getY(i0),
      position.getZ(i0),
    );
    const p1 = new THREE.Vector3(
      position.getX(i1),
      position.getY(i1),
      position.getZ(i1),
    );
    const p2 = new THREE.Vector3(
      position.getX(i2),
      position.getY(i2),
      position.getZ(i2),
    );

    const n0 = new THREE.Vector3(
      normal.getX(i0),
      normal.getY(i0),
      normal.getZ(i0),
    );
    const n1 = new THREE.Vector3(
      normal.getX(i1),
      normal.getY(i1),
      normal.getZ(i1),
    );
    const n2 = new THREE.Vector3(
      normal.getX(i2),
      normal.getY(i2),
      normal.getZ(i2),
    );

    const minU = Math.max(
      0,
      Math.floor(Math.min(uv0.x, uv1.x, uv2.x) * resolution) - 1,
    );
    const maxU = Math.min(
      resolution - 1,
      Math.ceil(Math.max(uv0.x, uv1.x, uv2.x) * resolution) + 1,
    );
    const minV = Math.max(
      0,
      Math.floor(Math.min(uv0.y, uv1.y, uv2.y) * resolution) - 1,
    );
    const maxV = Math.min(
      resolution - 1,
      Math.ceil(Math.max(uv0.y, uv1.y, uv2.y) * resolution) + 1,
    );

    for (let py = minV; py <= maxV; py++) {
      for (let px = minU; px <= maxU; px++) {
        const u = (px + 0.5) / resolution;
        const v = (py + 0.5) / resolution;

        // Barycentric coordinates
        const v0x = uv2.x - uv0.x;
        const v0y = uv2.y - uv0.y;
        const v1x = uv1.x - uv0.x;
        const v1y = uv1.y - uv0.y;
        const v2x = u - uv0.x;
        const v2y = v - uv0.y;

        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;

        const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 + 0.00001);
        const baryU = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const baryV = (dot00 * dot12 - dot01 * dot02) * invDenom;
        const baryW = 1 - baryU - baryV;

        if (baryU >= -0.01 && baryV >= -0.01 && baryW >= -0.01) {
          const worldPos = new THREE.Vector3(
            p0.x * baryW + p1.x * baryV + p2.x * baryU,
            p0.y * baryW + p1.y * baryV + p2.y * baryU,
            p0.z * baryW + p1.z * baryV + p2.z * baryU,
          );

          const worldNormal = new THREE.Vector3(
            n0.x * baryW + n1.x * baryV + n2.x * baryU,
            n0.y * baryW + n1.y * baryV + n2.y * baryU,
            n0.z * baryW + n1.z * baryV + n2.z * baryU,
          ).normalize();

          const color = sampleTriplanar(worldPos, worldNormal);

          const idx = ((resolution - 1 - py) * resolution + px) * 4;
          data[idx] = clamp(color.r * 255, 0, 255);
          data[idx + 1] = clamp(color.g * 255, 0, 255);
          data[idx + 2] = clamp(color.b * 255, 0, 255);
          data[idx + 3] = 255;

          const rough = params.material.roughness;
          const roughByte = clamp(rough * 255, 0, 255);
          roughData[idx] = roughByte;
          roughData[idx + 1] = roughByte;
          roughData[idx + 2] = roughByte;
          roughData[idx + 3] = 255;
        }
      }
    }
  }

  // Dilate to fill seams
  dilateTexture(data, resolution, 3);
  dilateTexture(roughData, resolution, 3);

  ctx.putImageData(imageData, 0, 0);
  roughCtx.putImageData(roughnessData, 0, 0);

  const colorTexture = new THREE.CanvasTexture(canvas);
  colorTexture.flipY = false;
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.wrapS = THREE.RepeatWrapping;
  colorTexture.wrapT = THREE.RepeatWrapping;

  const roughnessTexture = new THREE.CanvasTexture(roughnessCanvas);
  roughnessTexture.flipY = false;
  roughnessTexture.wrapS = THREE.RepeatWrapping;
  roughnessTexture.wrapT = THREE.RepeatWrapping;

  return {
    colorTexture,
    roughnessTexture,
    canvas,
    resolution,
  };
}

/**
 * Dilate texture to fill seam gaps
 */
function dilateTexture(
  data: Uint8ClampedArray,
  resolution: number,
  iterations: number,
): void {
  for (let iter = 0; iter < iterations; iter++) {
    const copy = new Uint8ClampedArray(data);

    for (let y = 1; y < resolution - 1; y++) {
      for (let x = 1; x < resolution - 1; x++) {
        const idx = (y * resolution + x) * 4;

        if (data[idx + 3] === 0) {
          let sumR = 0,
            sumG = 0,
            sumB = 0,
            count = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nidx = ((y + dy) * resolution + (x + dx)) * 4;
              if (copy[nidx + 3] > 0) {
                sumR += copy[nidx];
                sumG += copy[nidx + 1];
                sumB += copy[nidx + 2];
                count++;
              }
            }
          }

          if (count > 0) {
            data[idx] = sumR / count;
            data[idx + 1] = sumG / count;
            data[idx + 2] = sumB / count;
            data[idx + 3] = 255;
          }
        }
      }
    }
  }
}

/**
 * Export baked texture as PNG blob
 */
export async function exportTexturePNG(
  bakedTexture: BakedTexture,
): Promise<Blob> {
  return new Promise((resolve) => {
    bakedTexture.canvas.toBlob((blob) => {
      resolve(blob!);
    }, "image/png");
  });
}
