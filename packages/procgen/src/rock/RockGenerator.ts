/**
 * RockGenerator
 *
 * Main class for procedural rock generation using noise displacement,
 * vertex colors, and configurable presets.
 */

import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type {
  RockParams,
  PartialRockParams,
  GeneratedRock,
  RockGenerationOptions,
  RockStats,
  BaseShapeType,
} from "./types";
import { BaseShape, ColorMode } from "./types";
import { SimplexNoise, hashSeed } from "./noise";
import { DEFAULT_PARAMS, getPreset, mergeParams } from "./presets";
import { createTriplanarRockMaterial } from "./triplanarMaterial";
import { clamp } from "../math/Vector3.js";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse hex color to RGB object
 */
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

/**
 * Linear interpolate between two colors
 */
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
// ROCK GENERATOR CLASS
// ============================================================================

/**
 * Procedural rock generator
 */
export class RockGenerator {
  private readonly material: THREE.MeshStandardMaterial;

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.0,
    });
  }

  /**
   * Generate a rock from a preset name
   */
  generateFromPreset(
    presetName: string,
    options: RockGenerationOptions = {},
  ): GeneratedRock | null {
    const preset = getPreset(presetName);
    if (!preset) {
      console.warn(`Unknown rock preset: ${presetName}`);
      return null;
    }

    const params = mergeParams(
      DEFAULT_PARAMS,
      options.params
        ? mergeParams(mergeParams(DEFAULT_PARAMS, preset), options.params)
        : preset,
    );

    return this.generate(params, options.seed);
  }

  /**
   * Generate a rock with custom parameters
   */
  generateCustom(
    customParams: PartialRockParams,
    options: RockGenerationOptions = {},
  ): GeneratedRock {
    const params = mergeParams(DEFAULT_PARAMS, customParams);
    if (options.params) {
      Object.assign(params, options.params);
    }
    return this.generate(params, options.seed);
  }

  /**
   * Generate a rock with full parameters
   */
  generate(params: RockParams, seed?: string | number): GeneratedRock {
    const startTime = performance.now();

    // Resolve seed
    const actualSeed = seed ?? `rock-${Date.now()}`;
    const seedHash =
      typeof actualSeed === "string" ? hashSeed(actualSeed) : actualSeed;

    // Create noise generators
    const noise = new SimplexNoise(seedHash);
    const noise2 = new SimplexNoise(seedHash + 12345);

    // Create base geometry
    let geometry = this.createBaseGeometry(
      params.baseShape,
      params.subdivisions,
    );

    // Prepare for vertex manipulation
    if (geometry.index) {
      geometry = geometry.toNonIndexed();
    }
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    geometry = BufferGeometryUtils.mergeVertices(geometry, 0.0001);

    const position = geometry.attributes.position;
    const vertexCount = position.count;

    // Apply scale and noise displacement
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
      // Get position and apply scale
      let x = position.getX(i) * params.scale.x;
      let y = position.getY(i) * params.scale.y;
      let z = position.getZ(i) * params.scale.z;

      // Get direction from center for displacement
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0.0001) {
        const nx = x / len;
        const ny = y / len;
        const nz = z / len;

        // Main FBM noise displacement
        const mainNoise = noise.fbm(
          x * params.noise.scale,
          y * params.noise.scale,
          z * params.noise.scale,
          params.noise.octaves,
          params.noise.lacunarity,
          params.noise.persistence,
        );

        // Crack/crevice noise (ridged)
        let crackNoise = 0;
        if (params.cracks.depth > 0) {
          crackNoise = noise2.ridged(
            x * params.cracks.frequency,
            y * params.cracks.frequency,
            z * params.cracks.frequency,
            3,
            2.0,
            0.5,
          );
          crackNoise = 1.0 - crackNoise;
        }

        // Combined displacement
        const displacement =
          mainNoise * params.noise.amplitude - crackNoise * params.cracks.depth;

        x += nx * displacement;
        y += ny * displacement;
        z += nz * displacement;
      }

      position.setXYZ(i, x, y, z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    position.needsUpdate = true;

    // Apply Laplacian smoothing
    if (
      !params.flatShading &&
      params.smooth.iterations > 0 &&
      params.smooth.strength > 0
    ) {
      this.applySmoothing(
        geometry,
        params.smooth.iterations,
        params.smooth.strength,
      );
    }

    // Convert to non-indexed for flat shading
    if (params.flatShading) {
      geometry = geometry.toNonIndexed();
    }

    // Compute normals
    geometry.computeVertexNormals();

    // Get final references
    const finalPosition = geometry.attributes.position;
    const finalVertexCount = finalPosition.count;
    const normals = geometry.attributes.normal;

    // Recalculate height range
    let finalMinY = Infinity;
    let finalMaxY = -Infinity;
    for (let i = 0; i < finalVertexCount; i++) {
      const y = finalPosition.getY(i);
      finalMinY = Math.min(finalMinY, y);
      finalMaxY = Math.max(finalMaxY, y);
    }
    const heightRange = finalMaxY - finalMinY || 1;

    // Generate vertex colors
    const colors = new Float32Array(finalVertexCount * 3);
    const col1 = hexToRGB(params.colors.baseColor);
    const col2 = hexToRGB(params.colors.secondaryColor);
    const col3 = hexToRGB(params.colors.accentColor);

    for (let i = 0; i < finalVertexCount; i++) {
      const x = finalPosition.getX(i);
      const y = finalPosition.getY(i);
      const z = finalPosition.getZ(i);
      const normalY = normals.getY(i);

      // Height factor (0 at bottom, 1 at top)
      const heightFactor = (y - finalMinY) / heightRange;

      // Slope factor (1 = horizontal, 0 = vertical)
      const slopeFactor = Math.abs(normalY);

      // Start with base color, blend to secondary by height
      let color = lerpColor(
        col1,
        col2,
        heightFactor * params.colors.heightBlend,
      );

      // Blend accent into steep areas
      const steepness = 1.0 - slopeFactor;
      color = lerpColor(color, col3, steepness * params.colors.slopeBlend);

      // Add noise variation
      const varNoise =
        noise.noise3D(x * 5, y * 5, z * 5) * params.colors.variation;
      color.r = clamp(color.r + varNoise, 0, 1);
      color.g = clamp(color.g + varNoise, 0, 1);
      color.b = clamp(color.b + varNoise, 0, 1);

      // Simple AO based on distance from center
      const lenFromCenter = Math.sqrt(x * x + y * y + z * z);
      const avgRadius = (params.scale.x + params.scale.y + params.scale.z) / 3;
      const aoFactor = clamp((lenFromCenter / avgRadius - 0.3) * 1.5, 0, 1);
      const ao = 1.0 - (1.0 - aoFactor) * params.colors.aoIntensity;

      color.r *= ao;
      color.g *= ao;
      color.b *= ao;

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Create material based on color mode
    let material: THREE.Material;

    if (
      params.colorMode === ColorMode.Texture ||
      params.colorMode === ColorMode.Blend
    ) {
      // Use triplanar shader for procedural textures
      const triplanarMaterial = createTriplanarRockMaterial(params);

      // For pure texture mode, set blend to 1.0 (full texture)
      if (params.colorMode === ColorMode.Texture) {
        triplanarMaterial.uniforms.textureBlend.value = 1.0;
      }

      material = triplanarMaterial;
    } else {
      // Vertex colors only - use standard material
      const stdMaterial = this.material.clone();
      stdMaterial.flatShading = params.flatShading;
      stdMaterial.roughness = params.material.roughness;
      stdMaterial.metalness = params.material.metalness;
      material = stdMaterial;
    }

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);

    // Center at bottom
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.y = -box.min.y;

    // Compute stats
    const indexCount = geometry.index ? geometry.index.count : finalVertexCount;
    const triangleCount = Math.floor(indexCount / 3);

    const stats: RockStats = {
      vertices: indexCount,
      triangles: triangleCount,
      uniqueVertices: finalVertexCount,
      generationTime: performance.now() - startTime,
    };

    return {
      mesh,
      geometry,
      stats,
      params,
      seed: actualSeed,
    };
  }

  /**
   * Create base geometry from shape type
   */
  private createBaseGeometry(
    shape: BaseShapeType,
    subdivisions: number,
  ): THREE.BufferGeometry {
    const detail = Math.max(0, Math.min(7, subdivisions));

    switch (shape) {
      case BaseShape.Sphere: {
        const segs = Math.max(16, Math.pow(2, detail + 2));
        return new THREE.SphereGeometry(1, segs, Math.ceil(segs * 0.75));
      }

      case BaseShape.Box: {
        const boxSegs = Math.max(4, Math.pow(2, detail));
        const geometry = new THREE.BoxGeometry(
          1.5,
          1.5,
          1.5,
          boxSegs,
          boxSegs,
          boxSegs,
        );

        // Spherify the box
        const boxPos = geometry.attributes.position;
        for (let i = 0; i < boxPos.count; i++) {
          const x = boxPos.getX(i);
          const y = boxPos.getY(i);
          const z = boxPos.getZ(i);
          const len = Math.sqrt(x * x + y * y + z * z);
          if (len > 0.001) {
            const nx = x / len;
            const ny = y / len;
            const nz = z / len;
            const sphereFactor = 0.7;
            const newX = x * (1 - sphereFactor) + nx * len * sphereFactor;
            const newY = y * (1 - sphereFactor) + ny * len * sphereFactor;
            const newZ = z * (1 - sphereFactor) + nz * len * sphereFactor;
            boxPos.setXYZ(i, newX, newY, newZ);
          }
        }
        return geometry;
      }

      case BaseShape.Dodecahedron:
        return new THREE.DodecahedronGeometry(1, detail);

      case BaseShape.Octahedron:
        return new THREE.OctahedronGeometry(1, detail);

      case BaseShape.Icosahedron:
      default:
        return new THREE.IcosahedronGeometry(1, detail);
    }
  }

  /**
   * Apply Laplacian smoothing to geometry
   */
  private applySmoothing(
    geometry: THREE.BufferGeometry,
    iterations: number,
    strength: number,
  ): void {
    const pos = geometry.attributes.position;
    const idx = geometry.index;
    const vCount = pos.count;

    // Build adjacency list
    const neighbors: Set<number>[] = new Array(vCount);
    for (let i = 0; i < vCount; i++) {
      neighbors[i] = new Set();
    }

    if (idx) {
      const indices = idx.array;
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i];
        const b = indices[i + 1];
        const c = indices[i + 2];
        neighbors[a].add(b);
        neighbors[a].add(c);
        neighbors[b].add(a);
        neighbors[b].add(c);
        neighbors[c].add(a);
        neighbors[c].add(b);
      }
    }

    // Smooth iterations
    for (let iter = 0; iter < iterations; iter++) {
      const newPositions = new Float32Array(vCount * 3);

      for (let i = 0; i < vCount; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);

        const neighborSet = neighbors[i];
        if (neighborSet.size > 0) {
          let avgX = 0,
            avgY = 0,
            avgZ = 0;
          for (const ni of neighborSet) {
            avgX += pos.getX(ni);
            avgY += pos.getY(ni);
            avgZ += pos.getZ(ni);
          }
          avgX /= neighborSet.size;
          avgY /= neighborSet.size;
          avgZ /= neighborSet.size;

          newPositions[i * 3] = px + (avgX - px) * strength;
          newPositions[i * 3 + 1] = py + (avgY - py) * strength;
          newPositions[i * 3 + 2] = pz + (avgZ - pz) * strength;
        } else {
          newPositions[i * 3] = px;
          newPositions[i * 3 + 1] = py;
          newPositions[i * 3 + 2] = pz;
        }
      }

      // Apply smoothed positions
      for (let i = 0; i < vCount; i++) {
        pos.setXYZ(
          i,
          newPositions[i * 3],
          newPositions[i * 3 + 1],
          newPositions[i * 3 + 2],
        );
      }
    }

    pos.needsUpdate = true;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.material.dispose();
  }
}

/**
 * Default generator instance
 */
export const defaultGenerator = new RockGenerator();
