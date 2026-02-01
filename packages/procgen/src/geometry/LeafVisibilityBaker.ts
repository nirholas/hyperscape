/**
 * Leaf Visibility Baker
 *
 * Pre-computes per-leaf visibility from multiple horizontal viewing directions.
 * This data enables runtime view-dependent leaf culling to reduce overdraw
 * while maintaining visual quality.
 *
 * ## Architecture Overview
 *
 * ### Baking Phase (offline/build-time)
 *
 * 1. For each tree, render from N horizontal directions (8 or 16)
 * 2. Use depth buffer to determine which leaves are visible from each direction
 * 3. Store visibility as a bitmask per leaf (1 bit per direction = 8-16 bits)
 *
 * ### Runtime Phase (GPU shader)
 *
 * 1. Upload visibility bitmask buffer to GPU
 * 2. In vertex shader, compute current view sector (0-N)
 * 3. Read visibility bit for this leaf and sector
 * 4. If not visible, cull (move behind camera or scale to 0)
 *
 * ## Data Structures
 *
 * ```typescript
 * // Visibility data per tree
 * type LeafVisibilityData = {
 *   // Bitmask per leaf: bit i = visible from direction i
 *   // For 16 directions, use Uint16Array
 *   visibilityMask: Uint16Array;
 *   // Number of horizontal directions
 *   directionCount: number;
 *   // Starting angle (radians, typically 0)
 *   startAngle: number;
 *   // Angle step (radians, typically 2π / directionCount)
 *   angleStep: number;
 * };
 * ```
 *
 * ## Baking Algorithm
 *
 * For each direction i in [0, N):
 *   1. Compute camera position: (cos(θᵢ) * distance, height, sin(θᵢ) * distance)
 *   2. Render tree to depth buffer only
 *   3. For each leaf j:
 *      a. Project leaf center to screen space
 *      b. Sample depth buffer at that position
 *      c. If leaf depth ≤ buffer depth + epsilon: mark visible
 *      d. Set bit i in visibilityMask[j]
 *
 * ## GPU Integration (WebGPU/WGSL)
 *
 * ```wgsl
 * // Visibility buffer (read-only storage)
 * @group(1) @binding(0) var<storage, read> leafVisibility: array<u32>;
 *
 * // Uniforms
 * @group(0) @binding(0) var<uniform> cameraPos: vec3<f32>;
 * @group(0) @binding(1) var<uniform> treePos: vec3<f32>;
 * @group(0) @binding(2) var<uniform> visParams: vec4<f32>; // startAngle, angleStep, dirCount, _
 *
 * fn getVisibilitySector(camPos: vec3<f32>, objPos: vec3<f32>) -> u32 {
 *     let delta = camPos - objPos;
 *     let angle = atan2(delta.x, delta.z); // -π to π
 *     let normalizedAngle = (angle + PI) / (2.0 * PI); // 0 to 1
 *     let sector = u32(normalizedAngle * visParams.z) % u32(visParams.z);
 *     return sector;
 * }
 *
 * @vertex
 * fn vertexMain(@builtin(instance_index) instanceIdx: u32, ...) -> VertexOutput {
 *     // Get visibility for this leaf
 *     let visWord = leafVisibility[instanceIdx / 32u];
 *     let visBit = instanceIdx % 32u;
 *
 *     // For 16-direction packing: 2 leaves per u32
 *     let sector = getVisibilitySector(cameraPos, treePos);
 *     let isVisible = (leafVisibility[instanceIdx] >> sector) & 1u;
 *
 *     // Cull if not visible
 *     if (isVisible == 0u) {
 *         output.position = vec4<f32>(0.0, 0.0, 2.0, 1.0); // Behind near plane
 *         return output;
 *     }
 *
 *     // Normal vertex processing...
 * }
 * ```
 *
 * ## TSL Integration (Three.js Shading Language)
 *
 * For WebGPU via Three.js TSL:
 *
 * ```typescript
 * import { storage, instanceIndex, uniform, Fn } from 'three/webgpu';
 *
 * const visibilityBuffer = storage(visibilityData, 'uint', leafCount);
 * const cameraPosition = uniform(new Vector3());
 * const treePosition = uniform(new Vector3());
 * const directionCount = uniform(16);
 *
 * const getVisibilitySector = Fn(() => {
 *   const delta = sub(cameraPosition, treePosition);
 *   const angle = atan2(delta.x, delta.z);
 *   const normalized = div(add(angle, PI), mul(2.0, PI));
 *   return mod(floor(mul(normalized, directionCount)), directionCount);
 * });
 *
 * const isLeafVisible = Fn(() => {
 *   const mask = visibilityBuffer.element(instanceIndex);
 *   const sector = getVisibilitySector();
 *   return bitAnd(shiftRight(mask, sector), 1);
 * });
 *
 * // In position node
 * positionNode = select(
 *   isLeafVisible(),
 *   normalPositionCalculation,
 *   vec3(0, 0, FAR_DISTANCE) // Cull
 * );
 * ```
 *
 * ## Performance Considerations
 *
 * ### Storage
 * - 16 directions = 16 bits = 2 bytes per leaf
 * - 50,000 leaves = 100KB per tree (acceptable)
 * - 8 directions = 8 bits = 1 byte per leaf = 50KB per tree
 *
 * ### Baking Time
 * - N renders per tree (depth only, fast)
 * - Per-leaf depth test: O(leafCount × directionCount)
 * - Estimated: <1 second per tree with 50k leaves
 *
 * ### Runtime
 * - Single storage buffer read per leaf vertex
 * - Single bit shift + AND operation
 * - Negligible overhead vs. non-culled rendering
 *
 * ## Soft Visibility (Optional Enhancement)
 *
 * Instead of binary culling, use opacity:
 *
 * - 4 bits per direction (16 levels) instead of 1 bit
 * - 16 directions × 4 bits = 64 bits = 8 bytes per leaf
 * - Blend alpha based on visibility level
 * - Reduces popping artifacts
 *
 * ```wgsl
 * // Soft visibility (4 bits per direction)
 * let visNibble = (leafVisibility[instanceIdx * 2u + sector / 8u] >> ((sector % 8u) * 4u)) & 0xFu;
 * let opacity = f32(visNibble) / 15.0;
 * output.alpha *= opacity;
 * ```
 *
 * ## Integration with Existing Systems
 *
 * ### ProcgenTreeInstancer Integration Points
 *
 * 1. `createLeafInstanceBuffer()` - Add visibility data upload
 * 2. `updateLeafMaterial()` - Add visibility sampling to TSL shader
 * 3. `TreeInstanceData` - Add visibility buffer reference
 *
 * ### LeafGeometry Integration Points
 *
 * 1. `generateInstancedLeaves()` - Return visibility baker hook
 * 2. Add optional `bakeVisibility` parameter
 *
 * @module LeafVisibilityBaker
 */

import * as THREE from "three";
import type { LeafData } from "../types.js";

/**
 * Visibility data for a set of leaves.
 */
export interface LeafVisibilityData {
  /** Visibility bitmask per leaf (bit i = visible from direction i) */
  visibilityMask: Uint16Array;
  /** Number of horizontal viewing directions */
  directionCount: number;
  /** Starting angle in radians (typically 0) */
  startAngle: number;
  /** Angle between adjacent directions in radians */
  angleStep: number;
}

/**
 * Options for visibility baking.
 */
export interface LeafVisibilityBakeOptions {
  /** Number of horizontal directions to sample (default: 8, reduced for mobile) */
  directionCount?: number;
  /** Distance from tree center to camera (default: auto from bounds) */
  cameraDistance?: number;
  /** Camera height relative to tree center (default: 0.5 * tree height) */
  cameraHeight?: number;
  /** Depth tolerance for visibility test (default: 0.01) */
  depthEpsilon?: number;
  /** Render resolution for depth buffer (default: 512) */
  resolution?: number;
}

/**
 * Result of visibility baking.
 */
export interface LeafVisibilityBakeResult {
  /** Visibility data ready for GPU upload */
  data: LeafVisibilityData;
  /** Statistics about the bake */
  stats: {
    /** Total leaves processed */
    leafCount: number;
    /** Directions sampled */
    directionCount: number;
    /** Average visible leaves per direction */
    avgVisiblePerDirection: number;
    /** Bake time in milliseconds */
    bakeTimeMs: number;
  };
}

/**
 * Bakes per-leaf visibility data from multiple horizontal directions.
 *
 * This is a CPU-based implementation suitable for build-time baking.
 * For runtime/GPU-based baking, see the architecture notes in this file.
 *
 * @param leaves - Array of leaf positions/data
 * @param treeMesh - The tree mesh (for occlusion testing)
 * @param options - Baking options
 * @returns Visibility data and statistics
 */
export function bakeLeafVisibility(
  leaves: LeafData[],
  treeMesh: THREE.Object3D,
  options: LeafVisibilityBakeOptions = {},
): LeafVisibilityBakeResult {
  const startTime = performance.now();

  const {
    directionCount = 8, // Reduced from 16 for mobile performance
    depthEpsilon = 0.01,
    resolution = 512,
  } = options;

  // Compute tree bounds
  const bounds = new THREE.Box3().setFromObject(treeMesh);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);

  const cameraDistance = options.cameraDistance ?? Math.max(size.x, size.z) * 2;
  const cameraHeight = options.cameraHeight ?? center.y;

  // Create visibility mask array
  const visibilityMask = new Uint16Array(leaves.length);
  const angleStep = (Math.PI * 2) / directionCount;

  // Create depth rendering setup
  const scene = new THREE.Scene();
  const meshClone = treeMesh.clone();
  scene.add(meshClone);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, cameraDistance * 3);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(resolution, resolution);

  // Create depth render target
  const depthTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
    format: THREE.DepthFormat,
    type: THREE.UnsignedIntType,
  });

  // Statistics tracking
  let totalVisible = 0;

  // Scratch vectors for visibility testing
  const leafPos = new THREE.Vector3();
  const cameraPos = new THREE.Vector3();

  // For each direction
  for (let dir = 0; dir < directionCount; dir++) {
    const angle = dir * angleStep;

    // Position camera
    cameraPos.set(
      center.x + Math.cos(angle) * cameraDistance,
      cameraHeight,
      center.z + Math.sin(angle) * cameraDistance,
    );
    camera.position.copy(cameraPos);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    // Render depth buffer
    renderer.setRenderTarget(depthTarget);
    renderer.render(scene, camera);

    // Read depth buffer
    const depthPixels = new Float32Array(resolution * resolution);
    renderer.readRenderTargetPixels(
      depthTarget,
      0,
      0,
      resolution,
      resolution,
      depthPixels,
    );

    // Test each leaf's visibility
    for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
      const leaf = leaves[leafIdx];
      // Transform from Z-up to Y-up
      leafPos.set(leaf.position.x, leaf.position.z, -leaf.position.y);

      // Project leaf to screen space
      const projected = leafPos.clone().project(camera);

      // Check if in view frustum
      if (
        projected.x < -1 ||
        projected.x > 1 ||
        projected.y < -1 ||
        projected.y > 1 ||
        projected.z < 0 ||
        projected.z > 1
      ) {
        // Out of view, mark as not visible from this direction
        continue;
      }

      // Convert to pixel coordinates
      const px = Math.floor(((projected.x + 1) / 2) * resolution);
      const py = Math.floor(((1 - projected.y) / 2) * resolution);
      const pixelIdx = py * resolution + px;

      // Get depth at this pixel
      const bufferDepth = depthPixels[pixelIdx];

      // Compare leaf depth to buffer depth
      if (projected.z <= bufferDepth + depthEpsilon) {
        // Leaf is visible from this direction
        visibilityMask[leafIdx] |= 1 << dir;
        totalVisible++;
      }
    }
  }

  // Cleanup
  renderer.dispose();
  depthTarget.dispose();

  const bakeTimeMs = performance.now() - startTime;

  return {
    data: {
      visibilityMask,
      directionCount,
      startAngle: 0,
      angleStep,
    },
    stats: {
      leafCount: leaves.length,
      directionCount,
      avgVisiblePerDirection: totalVisible / directionCount,
      bakeTimeMs,
    },
  };
}

/**
 * Creates a GPU-ready buffer from visibility data.
 *
 * @param data - Visibility data from baking
 * @returns Buffer attribute for GPU upload
 */
export function createVisibilityBufferAttribute(
  data: LeafVisibilityData,
): THREE.BufferAttribute {
  return new THREE.BufferAttribute(data.visibilityMask, 1);
}

/**
 * Utility to convert visibility mask to string for debugging.
 *
 * @param mask - Visibility mask value
 * @param directionCount - Number of directions
 * @returns Binary string representation
 */
export function visibilityMaskToString(
  mask: number,
  directionCount: number,
): string {
  return mask.toString(2).padStart(directionCount, "0");
}
