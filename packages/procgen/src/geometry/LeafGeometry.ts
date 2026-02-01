/**
 * Leaf Geometry Generation
 *
 * Converts leaf/blossom data into Three.js BufferGeometry.
 * Handles transformation, scaling, and mesh generation.
 *
 * OPTIMIZED: Uses instanced rendering for leaves when possible.
 * Each leaf is a single card (2 triangles) with position and orientation
 * packed into instance attributes for GPU-efficient rendering.
 *
 * COORDINATE SYSTEM NOTE:
 * The tree generation algorithm uses Z-up (Blender convention).
 * Three.js uses Y-up. We transform coordinates when creating geometry.
 */

import * as THREE from "three";
import type {
  LeafData,
  LeafShapeGeometry,
  TreeParams,
  MeshGeometryData,
  LeafSamplingMode,
} from "../types.js";
import { getLeafShape, getBlossomShape } from "./LeafShapes.js";
import {
  createInstancedLeafMaterialTSL,
  type TSLLeafShape,
} from "./LeafMaterialTSL.js";

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================

/**
 * Simple seeded PRNG using mulberry32 algorithm.
 * Produces deterministic random numbers for consistent LOD results.
 */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is a positive integer
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  /**
   * Returns a random number in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a random integer in [0, max)
   */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

// ============================================================================
// LEAF SAMPLING ALGORITHMS
// ============================================================================

/**
 * Sample leaves using spatially-stratified sampling.
 * Divides the canopy into cells and samples proportionally from each
 * to maintain uniform spatial distribution at lower LODs.
 *
 * @param leaves - All leaves to sample from
 * @param targetCount - Number of leaves to keep
 * @param seed - Random seed for deterministic sampling
 * @returns Sampled leaf array with spatial distribution preserved
 */
function sampleLeavesSpatially(
  leaves: LeafData[],
  targetCount: number,
  seed: number,
): LeafData[] {
  if (leaves.length <= targetCount) {
    return leaves;
  }

  const rng = new SeededRandom(seed);

  // Compute bounding box of all leaves
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const leaf of leaves) {
    min.min(leaf.position);
    max.max(leaf.position);
  }

  // Determine grid resolution based on leaf count and target
  // More cells = finer spatial distribution, but minimum 2x2x2
  const reductionRatio = targetCount / leaves.length;
  // Use more cells for larger reductions to maintain distribution
  const cellsPerAxis = Math.max(2, Math.min(8, Math.ceil(4 / reductionRatio)));

  const cellSize = new THREE.Vector3();
  cellSize.subVectors(max, min).divideScalar(cellsPerAxis);
  // Prevent division by zero for flat canopies
  if (cellSize.x === 0) cellSize.x = 1;
  if (cellSize.y === 0) cellSize.y = 1;
  if (cellSize.z === 0) cellSize.z = 1;

  // Assign each leaf to a cell
  const cellCount = cellsPerAxis * cellsPerAxis * cellsPerAxis;
  const cells: LeafData[][] = Array.from({ length: cellCount }, () => []);

  for (const leaf of leaves) {
    const cx = Math.min(
      cellsPerAxis - 1,
      Math.floor((leaf.position.x - min.x) / cellSize.x),
    );
    const cy = Math.min(
      cellsPerAxis - 1,
      Math.floor((leaf.position.y - min.y) / cellSize.y),
    );
    const cz = Math.min(
      cellsPerAxis - 1,
      Math.floor((leaf.position.z - min.z) / cellSize.z),
    );
    const cellIdx = cx + cy * cellsPerAxis + cz * cellsPerAxis * cellsPerAxis;
    cells[cellIdx].push(leaf);
  }

  // Calculate how many leaves to sample from each cell
  // Proportional to cell population to maintain density distribution
  const result: LeafData[] = [];
  let remaining = targetCount;
  let totalRemaining = leaves.length;

  for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
    const cellLeaves = cells[cellIdx];
    if (cellLeaves.length === 0) continue;

    // Proportional allocation: (cellSize / totalRemaining) * remaining
    const cellAllocation = Math.round(
      (cellLeaves.length / totalRemaining) * remaining,
    );
    const toSample = Math.min(cellAllocation, cellLeaves.length);

    if (toSample > 0) {
      // Shuffle cell leaves using Fisher-Yates
      for (let i = cellLeaves.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [cellLeaves[i], cellLeaves[j]] = [cellLeaves[j], cellLeaves[i]];
      }

      // Take the first toSample leaves
      for (let i = 0; i < toSample; i++) {
        result.push(cellLeaves[i]);
      }
    }

    // Update remaining counts for next cell
    remaining -= toSample;
    totalRemaining -= cellLeaves.length;
  }

  // If we haven't reached target due to rounding, fill from any remaining leaves
  if (result.length < targetCount) {
    // Collect all unsampled leaves
    const sampledSet = new Set(result);
    const unsampled: LeafData[] = [];
    for (const leaf of leaves) {
      if (!sampledSet.has(leaf)) {
        unsampled.push(leaf);
      }
    }

    // Shuffle and take remaining
    for (let i = unsampled.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [unsampled[i], unsampled[j]] = [unsampled[j], unsampled[i]];
    }

    const needed = targetCount - result.length;
    for (let i = 0; i < needed && i < unsampled.length; i++) {
      result.push(unsampled[i]);
    }
  }

  return result;
}

/**
 * Sample leaves using random shuffle.
 * Simple uniform random sampling without spatial weighting.
 *
 * @param leaves - All leaves to sample from
 * @param targetCount - Number of leaves to keep
 * @param seed - Random seed for deterministic sampling
 * @returns Randomly sampled leaf array
 */
function sampleLeavesRandom(
  leaves: LeafData[],
  targetCount: number,
  seed: number,
): LeafData[] {
  if (leaves.length <= targetCount) {
    return leaves;
  }

  const rng = new SeededRandom(seed);

  // Fisher-Yates shuffle (in-place on copy)
  const shuffled = [...leaves];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, targetCount);
}

/**
 * Sample leaves based on the specified mode.
 *
 * @param leaves - All leaves to sample from
 * @param targetCount - Number of leaves to keep
 * @param mode - Sampling mode ('sequential', 'random', or 'spatial')
 * @param seed - Random seed for deterministic sampling
 * @returns Sampled leaf array
 */
function sampleLeaves(
  leaves: LeafData[],
  targetCount: number,
  mode: LeafSamplingMode,
  seed: number,
): LeafData[] {
  if (leaves.length <= targetCount) {
    return leaves;
  }

  switch (mode) {
    case "spatial":
      return sampleLeavesSpatially(leaves, targetCount, seed);
    case "random":
      return sampleLeavesRandom(leaves, targetCount, seed);
    case "sequential":
    default:
      return leaves.slice(0, targetCount);
  }
}

/**
 * Result of instanced leaf generation.
 */
export type InstancedLeafResult = {
  /** The instanced mesh for leaves */
  mesh: THREE.InstancedMesh;
  /** Number of active instances */
  instanceCount: number;
  /** The shared material */
  material: THREE.Material;
};

/**
 * Options for instanced leaf generation.
 */
export type InstancedLeafOptions = {
  /** Maximum number of leaf instances (default: 50000) */
  maxInstances?: number;
  /** Leaf material (optional, will create default if not provided) */
  material?: THREE.Material;
  /** Use alpha test for transparency (default: true) */
  alphaTest?: boolean;
  /** Alpha test threshold (default: 0.5) */
  alphaThreshold?: number;
  /** Leaf sampling mode for LOD reduction (default: 'spatial') */
  leafSamplingMode?: LeafSamplingMode;
  /** Seed for deterministic sampling (default: 0) */
  leafSamplingSeed?: number;
  /** Use TSL (WebGPU-compatible) material instead of GLSL ShaderMaterial (default: false) */
  useTSL?: boolean;
};

// Scratch vectors for hot loops (avoid allocations)
const _leafPos = new THREE.Vector3();
const _leafDir = new THREE.Vector3();
const _leafRight = new THREE.Vector3();
const _leafUp = new THREE.Vector3();
const _leafVert = new THREE.Vector3();
const _rightT = new THREE.Vector3();
const _trackQuat = new THREE.Quaternion();
const _spinQuat = new THREE.Quaternion();
const _finalQuat = new THREE.Quaternion();
const _rotMatrix = new THREE.Matrix4();
const _zAxis = new THREE.Vector3(0, 0, 1);

// Cache for pre-triangulated face indices per shape
const _triangulatedFacesCache = new Map<LeafShapeGeometry, Uint16Array>();
const _uvsCache = new Map<LeafShapeGeometry, Float32Array>();

function getTriangulatedFaces(shape: LeafShapeGeometry): Uint16Array {
  let cached = _triangulatedFacesCache.get(shape);
  if (!cached) {
    const indices: number[] = [];
    for (const face of shape.faces) {
      if (face.length === 3) {
        indices.push(face[0]!, face[1]!, face[2]!);
      } else if (face.length === 4) {
        indices.push(face[0]!, face[1]!, face[2]!);
        indices.push(face[0]!, face[2]!, face[3]!);
      } else if (face.length > 4) {
        for (let i = 1; i < face.length - 1; i++) {
          indices.push(face[0]!, face[i]!, face[i + 1]!);
        }
      }
    }
    cached = new Uint16Array(indices);
    _triangulatedFacesCache.set(shape, cached);
  }
  return cached;
}

function getShapeUVs(shape: LeafShapeGeometry): Float32Array {
  let cached = _uvsCache.get(shape);
  if (!cached) {
    const uvs: number[] = [];
    if (shape.uvs) {
      for (const uv of shape.uvs) {
        uvs.push(uv[0], uv[1]);
      }
    } else {
      for (const vertex of shape.vertices) {
        uvs.push(vertex[0] + 0.5, vertex[2]);
      }
    }
    cached = new Float32Array(uvs);
    _uvsCache.set(shape, cached);
  }
  return cached;
}

/**
 * Transform Vector3 from Z-up to Y-up, writing to existing vector.
 */
function transformVec3Into(
  src: THREE.Vector3,
  dst: THREE.Vector3,
): THREE.Vector3 {
  dst.x = src.x;
  dst.y = src.z;
  dst.z = -src.y;
  return dst;
}

/** Maximum leaves before warning/limiting for performance */
const DEFAULT_MAX_LEAVES = 50000;

/**
 * Generate Three.js geometry for all leaves.
 *
 * @param leaves - Array of leaf data
 * @param params - Tree parameters
 * @param treeScale - Overall tree scale
 * @param maxLeaves - Maximum leaves to render (for performance)
 * @returns Three.js BufferGeometry
 */
export function generateLeafGeometry(
  leaves: LeafData[],
  params: TreeParams,
  treeScale: number,
  maxLeaves: number = DEFAULT_MAX_LEAVES,
): THREE.BufferGeometry {
  // Limit leaves for performance
  let leafList = leaves;
  if (leaves.length > maxLeaves) {
    console.warn(
      `Limiting leaves from ${leaves.length} to ${maxLeaves} for performance`,
    );
    // Sample evenly across all leaves to maintain distribution
    const step = leaves.length / maxLeaves;
    leafList = [];
    for (let i = 0; i < maxLeaves; i++) {
      const idx = Math.floor(i * step);
      leafList.push(leaves[idx]!);
    }
  }

  // Get base shapes
  const gScale = treeScale / params.gScale;
  const leafBaseShape = getScaledShape(
    getLeafShape(params.leafShape),
    gScale,
    params.leafScale,
    params.leafScaleX,
  );
  const blossomBaseShape = getScaledShape(
    getBlossomShape(params.blossomShape),
    gScale,
    params.blossomScale,
    1,
  );

  // Pre-calculate total size to avoid intermediate arrays
  const leafShapeVertCount = leafBaseShape.vertices.length;
  const leafShapeFaceCount = leafBaseShape.faces.reduce(
    (sum, f) => sum + (f.length - 2),
    0,
  );
  const blossomShapeVertCount = blossomBaseShape.vertices.length;
  const blossomShapeFaceCount = blossomBaseShape.faces.reduce(
    (sum, f) => sum + (f.length - 2),
    0,
  );

  let totalVerts = 0;
  let totalTris = 0;
  for (const leaf of leafList) {
    if (leaf.isBlossom) {
      totalVerts += blossomShapeVertCount;
      totalTris += blossomShapeFaceCount;
    } else {
      totalVerts += leafShapeVertCount;
      totalTris += leafShapeFaceCount;
    }
  }

  // Pre-allocate arrays
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalTris * 3);

  let posOffset = 0;
  let uvOffset = 0;
  let idxOffset = 0;
  let vertOffset = 0;

  // Generate geometry directly into arrays
  for (const leaf of leafList) {
    const baseShape = leaf.isBlossom ? blossomBaseShape : leafBaseShape;
    const geometry = generateSingleLeafGeometry(
      leaf,
      baseShape,
      params.leafBend,
    );

    // Copy positions
    positions.set(geometry.positions, posOffset);
    normals.set(geometry.normals, posOffset);
    uvs.set(geometry.uvs, uvOffset);

    // Copy indices with offset
    for (let i = 0; i < geometry.indices.length; i++) {
      indices[idxOffset + i] = geometry.indices[i]! + vertOffset;
    }

    posOffset += geometry.positions.length;
    uvOffset += geometry.uvs.length;
    idxOffset += geometry.indices.length;
    vertOffset += geometry.positions.length / 3;
  }

  // Create BufferGeometry
  const bufferGeometry = new THREE.BufferGeometry();
  bufferGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  bufferGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  bufferGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  bufferGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return bufferGeometry;
}

/**
 * Generate separate geometries for leaves and blossoms.
 *
 * @param leaves - Array of leaf data
 * @param params - Tree parameters
 * @param treeScale - Overall tree scale
 * @param maxLeaves - Maximum leaves to render (for performance)
 * @returns Object containing leaf and blossom geometries
 */
export function generateSeparateLeafGeometry(
  leaves: LeafData[],
  params: TreeParams,
  treeScale: number,
  maxLeaves: number = DEFAULT_MAX_LEAVES,
): { leaves: THREE.BufferGeometry; blossoms: THREE.BufferGeometry } {
  // Limit leaves for performance
  let leafList = leaves;
  if (leaves.length > maxLeaves) {
    console.warn(
      `Limiting leaves from ${leaves.length} to ${maxLeaves} for performance`,
    );
    const step = leaves.length / maxLeaves;
    leafList = [];
    for (let i = 0; i < maxLeaves; i++) {
      const idx = Math.floor(i * step);
      leafList.push(leaves[idx]!);
    }
  }

  const leafGeometries: MeshGeometryData[] = [];
  const blossomGeometries: MeshGeometryData[] = [];

  // Get base shapes
  const gScale = treeScale / params.gScale;
  const leafBaseShape = getScaledShape(
    getLeafShape(params.leafShape),
    gScale,
    params.leafScale,
    params.leafScaleX,
  );
  const blossomBaseShape = getScaledShape(
    getBlossomShape(params.blossomShape),
    gScale,
    params.blossomScale,
    1,
  );

  // Generate geometry for each leaf
  for (const leaf of leaves) {
    const baseShape = leaf.isBlossom ? blossomBaseShape : leafBaseShape;
    const geometry = generateSingleLeafGeometry(
      leaf,
      baseShape,
      params.leafBend,
    );

    if (leaf.isBlossom) {
      blossomGeometries.push(geometry);
    } else {
      leafGeometries.push(geometry);
    }
  }

  return {
    leaves: mergeGeometries(leafGeometries),
    blossoms: mergeGeometries(blossomGeometries),
  };
}

/**
 * Scale a leaf shape geometry.
 *
 * @param shape - Base shape geometry
 * @param gScale - Global scale factor
 * @param scale - Leaf scale
 * @param scaleX - Leaf width scale
 * @returns Scaled vertices (vertices are modified in place in returned copy)
 */
function getScaledShape(
  shape: LeafShapeGeometry,
  gScale: number,
  scale: number,
  scaleX: number,
): LeafShapeGeometry {
  const scaledVertices: Array<readonly [number, number, number]> =
    shape.vertices.map(
      (v) =>
        [
          v[0] * scale * gScale * scaleX,
          v[1] * scale * gScale,
          v[2] * scale * gScale,
        ] as const,
    );

  return {
    vertices: scaledVertices,
    faces: shape.faces,
    uvs: shape.uvs,
  };
}

/**
 * Generate geometry for a single leaf.
 * Optimized version with scratch vectors and cached data.
 *
 * @param leaf - Leaf data
 * @param baseShape - Scaled base shape
 * @param bend - Bend amount (0-1)
 * @returns Mesh geometry data
 */
function generateSingleLeafGeometry(
  leaf: LeafData,
  baseShape: LeafShapeGeometry,
  bend: number,
): MeshGeometryData {
  // Transform from Z-up to Y-up coordinate system using scratch vectors
  transformVec3Into(leaf.position, _leafPos);
  transformVec3Into(leaf.direction, _leafDir).normalize();
  transformVec3Into(leaf.right, _leafRight).normalize();
  _leafUp.crossVectors(_leafDir, _leafRight).normalize();

  // Create rotation quaternion to align Z axis with direction
  _rotMatrix.makeBasis(_leafRight, _leafUp, _leafDir);
  _trackQuat.setFromRotationMatrix(_rotMatrix);

  // Calculate spin angle to align right vector properly
  _rightT.copy(_leafRight).applyQuaternion(_trackQuat.clone().invert());
  const spinAngle = Math.PI - Math.atan2(_rightT.y, _rightT.x);
  _spinQuat.setFromAxisAngle(_zAxis, spinAngle);

  // Combine rotations
  _finalQuat.copy(_trackQuat).premultiply(_spinQuat);

  // Apply bend transformation if needed
  if (bend > 0) {
    const bendTrf = calcBendTransform(_leafPos, _leafDir, _leafRight, bend);
    _finalQuat.premultiply(bendTrf);
  }

  // Transform vertices directly into typed array
  const vertCount = baseShape.vertices.length;
  const positions = new Float32Array(vertCount * 3);
  let posIdx = 0;

  for (let i = 0; i < vertCount; i++) {
    const vertex = baseShape.vertices[i]!;
    _leafVert.set(vertex[0], vertex[1], vertex[2]);
    _leafVert.applyQuaternion(_finalQuat);
    _leafVert.add(_leafPos);
    positions[posIdx++] = _leafVert.x;
    positions[posIdx++] = _leafVert.y;
    positions[posIdx++] = _leafVert.z;
  }

  // Get cached triangulated indices
  const cachedIndices = getTriangulatedFaces(baseShape);
  const indices = new Uint32Array(cachedIndices.length);
  indices.set(cachedIndices);

  // Calculate normals (flat shading)
  const normals = calculateFlatNormalsOpt(positions, indices);

  // Get cached UVs
  const cachedUvs = getShapeUVs(baseShape);
  const uvs = new Float32Array(cachedUvs.length);
  uvs.set(cachedUvs);

  return {
    positions,
    normals,
    uvs,
    indices,
  };
}

/**
 * Calculate bend transformation for a leaf.
 * Takes already-transformed (Y-up) position and direction vectors.
 */
function calcBendTransform(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  right: THREE.Vector3,
  bend: number,
): THREE.Quaternion {
  // Calculate normal
  const normal = new THREE.Vector3().crossVectors(direction, right);

  // Calculate angle from position in XZ plane (was XY in Z-up space)
  // In Y-up space: X is right, Y is up, Z is forward
  // The original used XY plane (horizontal in Z-up), which is now XZ plane
  const thetaPos = Math.atan2(-position.z, position.x);
  const thetaBend = thetaPos - Math.atan2(-normal.z, normal.x);

  // Create bend rotation around Y axis (was Z in Z-up space)
  return new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    thetaBend * bend,
  );
}

/**
 * Calculate flat normals for a mesh.
 */
/**
 * Optimized flat normals calculation for typed arrays.
 * Avoids creating intermediate objects.
 */
function calculateFlatNormalsOpt(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const vertCount = positions.length / 3;
  const normals = new Float32Array(positions.length);
  const counts = new Uint8Array(vertCount);

  // Calculate face normals and accumulate to vertices
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]!;
    const i1 = indices[i + 1]!;
    const i2 = indices[i + 2]!;

    // Get vertices inline
    const v0x = positions[i0 * 3]!;
    const v0y = positions[i0 * 3 + 1]!;
    const v0z = positions[i0 * 3 + 2]!;
    const v1x = positions[i1 * 3]!;
    const v1y = positions[i1 * 3 + 1]!;
    const v1z = positions[i1 * 3 + 2]!;
    const v2x = positions[i2 * 3]!;
    const v2y = positions[i2 * 3 + 1]!;
    const v2z = positions[i2 * 3 + 2]!;

    // Edge vectors
    const e1x = v1x - v0x;
    const e1y = v1y - v0y;
    const e1z = v1z - v0z;
    const e2x = v2x - v0x;
    const e2y = v2y - v0y;
    const e2z = v2z - v0z;

    // Cross product
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;

    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    // Accumulate to vertices
    normals[i0 * 3] += nx;
    normals[i0 * 3 + 1] += ny;
    normals[i0 * 3 + 2] += nz;
    counts[i0]++;

    normals[i1 * 3] += nx;
    normals[i1 * 3 + 1] += ny;
    normals[i1 * 3 + 2] += nz;
    counts[i1]++;

    normals[i2 * 3] += nx;
    normals[i2 * 3 + 1] += ny;
    normals[i2 * 3 + 2] += nz;
    counts[i2]++;
  }

  // Normalize accumulated normals
  for (let i = 0; i < vertCount; i++) {
    const c = counts[i]!;
    if (c > 0) {
      const idx = i * 3;
      const nx = normals[idx]! / c;
      const ny = normals[idx + 1]! / c;
      const nz = normals[idx + 2]! / c;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        normals[idx] = nx / len;
        normals[idx + 1] = ny / len;
        normals[idx + 2] = nz / len;
      }
    }
  }

  return normals;
}

/**
 * Merge multiple geometry data into a single geometry.
 */
function mergeGeometries(geometries: MeshGeometryData[]): THREE.BufferGeometry {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // Calculate total sizes
  let totalPositions = 0;
  let totalIndices = 0;
  for (const geo of geometries) {
    totalPositions += geo.positions.length;
    totalIndices += geo.indices.length;
  }

  const mergedPositions = new Float32Array(totalPositions);
  const mergedNormals = new Float32Array(totalPositions);
  const mergedUvs = new Float32Array((totalPositions / 3) * 2);
  const mergedIndices = new Uint32Array(totalIndices);

  let positionOffset = 0;
  let uvOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;

  for (const geo of geometries) {
    // Copy positions
    mergedPositions.set(geo.positions, positionOffset);

    // Copy normals
    mergedNormals.set(geo.normals, positionOffset);

    // Copy UVs
    mergedUvs.set(geo.uvs, uvOffset);

    // Copy indices with offset
    for (let i = 0; i < geo.indices.length; i++) {
      mergedIndices[indexOffset + i] = geo.indices[i]! + vertexOffset;
    }

    positionOffset += geo.positions.length;
    uvOffset += geo.uvs.length;
    indexOffset += geo.indices.length;
    vertexOffset += geo.positions.length / 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mergedPositions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(mergedNormals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mergedUvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));

  return geometry;
}

// ============================================================================
// INSTANCED LEAF RENDERING (OPTIMIZED)
// ============================================================================

/**
 * Create a single leaf card geometry for instanced rendering.
 * This is a simple quad (2 triangles) that will be instanced for each leaf.
 *
 * @param width - Width of the leaf card
 * @param height - Height of the leaf card
 * @returns BufferGeometry for a single leaf card
 */
export function createLeafCardGeometry(
  width = 1,
  height = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // Simple quad centered at origin, facing +Z
  const halfW = width * 0.5;
  const positions = new Float32Array([
    -halfW,
    0,
    0, // bottom-left
    halfW,
    0,
    0, // bottom-right
    halfW,
    height,
    0, // top-right
    -halfW,
    height,
    0, // top-left
  ]);

  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

  const indices = new Uint16Array([
    0,
    1,
    2, // first triangle
    0,
    2,
    3, // second triangle
  ]);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

/**
 * Leaf shape types for procedural generation.
 */
export type ProceduralLeafShape =
  | "elliptic"
  | "ovate"
  | "maple"
  | "oak"
  | "palm"
  | "needle";

/**
 * Create an instanced leaf material with alpha cutout shader.
 * Uses procedural leaf shapes - no texture needed!
 *
 * @param options - Material options
 * @returns ShaderMaterial for instanced leaves with alpha cutout
 */
export function createInstancedLeafMaterial(
  options: {
    color?: THREE.Color;
    colorVariation?: number;
    map?: THREE.Texture;
    alphaTest?: number;
    opacity?: number;
    side?: THREE.Side;
    leafShape?: ProceduralLeafShape;
    subsurfaceScatter?: number;
    windStrength?: number;
  } = {},
): THREE.ShaderMaterial {
  const {
    color = new THREE.Color(0x3d7a3d),
    colorVariation = 0.15,
    map,
    alphaTest = 0.5,
    opacity = 1.0,
    side = THREE.DoubleSide,
    leafShape = "elliptic",
    subsurfaceScatter = 0.3,
    windStrength = 0.0,
  } = options;

  // Map shape name to shader define
  const shapeDefines: Record<ProceduralLeafShape, string> = {
    elliptic: "LEAF_ELLIPTIC",
    ovate: "LEAF_OVATE",
    maple: "LEAF_MAPLE",
    oak: "LEAF_OAK",
    palm: "LEAF_PALM",
    needle: "LEAF_NEEDLE",
  };

  const defines: Record<string, string> = {
    [shapeDefines[leafShape]]: "",
  };
  if (map) {
    defines["USE_MAP"] = "";
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uColorVariation: { value: colorVariation },
      uMap: { value: map },
      uAlphaTest: { value: alphaTest },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uWindStrength: { value: windStrength },
      uSubsurface: { value: subsurfaceScatter },
      uBakeMode: { value: 0.0 }, // 0=normal rendering, 1=unlit for impostor baking
    },
    vertexShader: /* glsl */ `
      attribute vec4 instanceOrientation; // quaternion for rotation
      
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vInstanceId;
      
      uniform float uTime;
      uniform float uWindStrength;
      
      // Quaternion rotation
      vec3 rotateByQuat(vec3 v, vec4 q) {
        vec3 t = 2.0 * cross(q.xyz, v);
        return v + q.w * t + cross(q.xyz, t);
      }
      
      // Simple hash for instance variation
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }
      
      void main() {
        vUv = uv;
        vInstanceId = float(gl_InstanceID);
        
        // Apply instance rotation to position and normal
        vec3 rotatedPosition = rotateByQuat(position, instanceOrientation);
        vec3 rotatedNormal = rotateByQuat(normal, instanceOrientation);
        
        // Wind animation (subtle sway based on height and instance)
        if (uWindStrength > 0.0) {
          float windPhase = hash(vInstanceId) * 6.28;
          float windAmount = uWindStrength * position.y * 0.1;
          rotatedPosition.x += sin(uTime * 2.0 + windPhase) * windAmount;
          rotatedPosition.z += cos(uTime * 1.5 + windPhase * 0.7) * windAmount * 0.5;
        }
        
        // Apply instance transform (position from instanceMatrix)
        vec4 worldPosition = instanceMatrix * vec4(rotatedPosition, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalMatrix * rotatedNormal;
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uColorVariation;
      uniform sampler2D uMap;
      uniform float uAlphaTest;
      uniform float uOpacity;
      uniform float uSubsurface;
      uniform float uBakeMode; // 0=normal, 1=unlit for impostor baking
      
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vInstanceId;
      
      // Hash for color variation per instance
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }
      
      vec3 hash3(float n) {
        return vec3(
          hash(n),
          hash(n + 127.1),
          hash(n + 269.5)
        );
      }
      
      // Procedural leaf alpha shapes
      // UV: (0,0) bottom-left, (1,1) top-right
      // Leaf grows from bottom (0) to top (1)
      
      float leafShapeElliptic(vec2 uv) {
        // Centered UV
        vec2 p = uv - vec2(0.5, 0.5);
        // Ellipse equation: (x/a)^2 + (y/b)^2 <= 1
        float a = 0.35; // width
        float b = 0.48; // height
        float d = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
        // Add slight point at top
        float pointiness = smoothstep(0.3, 0.5, uv.y) * 0.15;
        a -= pointiness * abs(p.x);
        d = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
        return 1.0 - smoothstep(0.9, 1.0, d);
      }
      
      float leafShapeOvate(vec2 uv) {
        vec2 p = uv - vec2(0.5, 0.4); // offset center down
        // Wider at bottom, narrower at top
        float widthMod = mix(0.4, 0.2, uv.y);
        float d = length(p / vec2(widthMod, 0.5));
        // Sharper tip
        float tip = smoothstep(0.7, 0.95, uv.y);
        d += tip * 0.5;
        return 1.0 - smoothstep(0.85, 1.0, d);
      }
      
      float leafShapeMaple(vec2 uv) {
        vec2 p = (uv - 0.5) * 2.0;
        float angle = atan(p.y, p.x);
        float r = length(p);
        // 5-pointed star-like shape
        float lobes = 0.5 + 0.3 * cos(angle * 5.0);
        // Add serration
        lobes += 0.1 * cos(angle * 15.0);
        float shape = step(r, lobes * 0.9);
        // Stem notch at bottom
        if (uv.y < 0.15 && abs(uv.x - 0.5) < 0.05) shape = 0.0;
        return shape;
      }
      
      float leafShapeOak(vec2 uv) {
        vec2 p = uv - vec2(0.5, 0.5);
        // Base ellipse
        float base = 1.0 - smoothstep(0.8, 1.0, length(p / vec2(0.35, 0.48)));
        // Wavy lobed edges
        float angle = atan(p.y, p.x);
        float lobeWave = 0.08 * sin(angle * 7.0 + 1.5);
        float r = length(p);
        float lobed = step(r, 0.38 + lobeWave);
        return lobed * base;
      }
      
      float leafShapePalm(vec2 uv) {
        // Long narrow frond
        vec2 p = uv - vec2(0.5, 0.5);
        float width = 0.12 * (1.0 - abs(p.y) * 1.5);
        width = max(width, 0.02);
        float d = abs(p.x) / width;
        // Pointed tips
        float tip = smoothstep(0.4, 0.5, abs(p.y));
        d += tip * 2.0;
        return 1.0 - smoothstep(0.8, 1.0, d);
      }
      
      float leafShapeNeedle(vec2 uv) {
        // Very thin needle (for conifers)
        vec2 p = uv - vec2(0.5, 0.5);
        float width = 0.06 * (1.0 - pow(abs(p.y) * 2.0, 2.0));
        width = max(width, 0.01);
        return step(abs(p.x), width);
      }
      
      // Get leaf shape based on defines
      float getLeafAlpha(vec2 uv) {
        #ifdef LEAF_ELLIPTIC
          return leafShapeElliptic(uv);
        #endif
        #ifdef LEAF_OVATE
          return leafShapeOvate(uv);
        #endif
        #ifdef LEAF_MAPLE
          return leafShapeMaple(uv);
        #endif
        #ifdef LEAF_OAK
          return leafShapeOak(uv);
        #endif
        #ifdef LEAF_PALM
          return leafShapePalm(uv);
        #endif
        #ifdef LEAF_NEEDLE
          return leafShapeNeedle(uv);
        #endif
        // Default fallback
        return leafShapeElliptic(uv);
      }
      
      // Add vein pattern
      float leafVeins(vec2 uv) {
        vec2 p = uv - vec2(0.5, 0.0);
        // Central vein
        float central = 1.0 - smoothstep(0.0, 0.02, abs(p.x));
        // Side veins
        float sideAngle = 0.6;
        float veins = 0.0;
        for (float i = 0.2; i < 0.9; i += 0.15) {
          vec2 veinStart = vec2(0.0, i);
          float veinY = uv.y - i;
          float veinX = abs(p.x) - veinY * sideAngle;
          float vein = 1.0 - smoothstep(0.0, 0.015, abs(veinX));
          vein *= step(0.0, veinY) * step(veinY, 0.2);
          vein *= step(abs(p.x), 0.4);
          veins = max(veins, vein * 0.5);
        }
        return central * 0.6 + veins;
      }
      
      void main() {
        // Get procedural leaf alpha
        float alpha = getLeafAlpha(vUv);
        
        // Apply alpha test (cutout)
        if (alpha < uAlphaTest) discard;
        
        // Instance-based color variation
        vec3 variation = hash3(vInstanceId) * 2.0 - 1.0;
        vec3 leafColor = uColor + variation * uColorVariation;
        
        // Darken edges slightly for depth
        float edgeDark = smoothstep(0.3, 0.8, alpha) * 0.2 + 0.8;
        leafColor *= edgeDark;
        
        // Add subtle vein pattern (darker)
        float veins = leafVeins(vUv);
        leafColor = mix(leafColor, leafColor * 0.7, veins * 0.3);
        
        // Texture map if provided
        #ifdef USE_MAP
          vec4 texColor = texture2D(uMap, vUv);
          leafColor *= texColor.rgb;
          alpha *= texColor.a;
        #endif
        
        // Bake mode: output unlit color for impostor atlas
        // This preserves procedural details (color variation, edge darkening, veins)
        // but skips lighting so runtime impostor lighting is the only lighting applied
        if (uBakeMode > 0.5) {
          gl_FragColor = vec4(leafColor, alpha * uOpacity);
          return;
        }
        
        // Normal rendering with lighting
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        
        // Two-sided lighting for leaves
        float NdotL = dot(normal, lightDir);
        float diff = abs(NdotL); // Both sides lit
        
        // Subsurface scattering simulation (light through leaf)
        float subsurface = 0.0;
        if (NdotL < 0.0) {
          // Back-lit - add warm subsurface color
          subsurface = -NdotL * uSubsurface;
        }
        
        float ambient = 0.35;
        float light = ambient + diff * 0.5 + subsurface;
        
        // Subsurface adds warmth
        vec3 subsurfaceColor = leafColor * vec3(1.2, 1.1, 0.8);
        vec3 finalColor = mix(leafColor, subsurfaceColor, subsurface);
        finalColor *= light;
        
        gl_FragColor = vec4(finalColor, alpha * uOpacity);
      }
    `,
    side,
    transparent: true,
    depthWrite: true,
    alphaTest: alphaTest,
    defines,
  });
}

/**
 * Map tree leaf shape parameter to procedural shader shape.
 */
function mapLeafShapeToShader(leafShape: number): ProceduralLeafShape {
  // LeafShape enum: 0=Default/Elliptic, 1=Ovate, 2=Linear, 3=Cordate, 4=Maple, 5=Palmate, 6=SpikyOak, 7=RoundedOak, 8=Elliptic, 9=Rectangle, 10=Triangle
  switch (leafShape) {
    case 1: // Ovate
    case 3: // Cordate (heart-shaped, use ovate)
      return "ovate";
    case 2: // Linear
      return "needle";
    case 4: // Maple
      return "maple";
    case 5: // Palmate
      return "palm";
    case 6: // SpikyOak
    case 7: // RoundedOak
      return "oak";
    case 0: // Default
    case 8: // Elliptic
    case 9: // Rectangle (use elliptic for cards)
    case 10: // Triangle
    default:
      return "elliptic";
  }
}

/**
 * Generate instanced leaf mesh from leaf data.
 * Uses a single leaf card geometry instanced for maximum GPU efficiency.
 * Only ONE draw call for all leaves!
 *
 * Features:
 * - Procedural alpha cutout (no texture needed)
 * - Automatic leaf shape based on tree params
 * - Per-instance color variation
 * - Subsurface scattering simulation
 * - Optional wind animation
 *
 * @param leaves - Array of leaf data
 * @param params - Tree parameters
 * @param treeScale - Overall tree scale
 * @param options - Instancing options
 * @returns Instanced leaf result with mesh and metadata
 */
export function generateInstancedLeaves(
  leaves: LeafData[],
  params: TreeParams,
  treeScale: number,
  options: InstancedLeafOptions = {},
): InstancedLeafResult {
  const {
    maxInstances = 50000,
    material,
    alphaTest = true,
    alphaThreshold = 0.5,
    leafSamplingMode = "spatial",
    leafSamplingSeed = 0,
    useTSL = false,
  } = options;

  // Sample leaves using the specified mode (spatial sampling preserves canopy distribution)
  const targetCount = Math.min(leaves.length, maxInstances);
  const leafList = sampleLeaves(
    leaves,
    targetCount,
    leafSamplingMode,
    leafSamplingSeed,
  );
  const leafCount = leafList.length;

  // Calculate leaf scale
  const gScale = treeScale / params.gScale;
  const leafWidth = params.leafScale * gScale * params.leafScaleX;
  const leafHeight = params.leafScale * gScale;

  // Create single leaf card geometry
  const geometry = createLeafCardGeometry(leafWidth, leafHeight);

  // Determine procedural leaf shape from tree params
  const leafShape = mapLeafShapeToShader(params.leafShape);

  // Create or use provided material with proper leaf shape
  // Use TSL (WebGPU) material when useTSL is true, otherwise fall back to GLSL ShaderMaterial
  let leafMaterial: THREE.Material;
  if (material) {
    leafMaterial = material;
  } else if (useTSL) {
    // TSL (WebGPU-compatible) material
    leafMaterial = createInstancedLeafMaterialTSL({
      alphaTest: alphaTest ? alphaThreshold : 0,
      leafShape: leafShape as TSLLeafShape,
      colorVariation: 0.12,
      subsurfaceScatter: 0.35,
    });
  } else {
    // GLSL ShaderMaterial (WebGL only)
    leafMaterial = createInstancedLeafMaterial({
      alphaTest: alphaTest ? alphaThreshold : 0,
      leafShape,
      colorVariation: 0.12,
      subsurfaceScatter: 0.35,
    });
  }

  // Create instanced mesh
  const instancedMesh = new THREE.InstancedMesh(
    geometry,
    leafMaterial,
    leafCount,
  );
  instancedMesh.name = "InstancedLeaves";

  // Create orientation attribute for quaternion-based rotation
  const orientations = new Float32Array(leafCount * 4);
  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3(1, 1, 1);

  // Scratch vectors for orientation calculation
  const leafDir = new THREE.Vector3();
  const leafRight = new THREE.Vector3();
  const leafUp = new THREE.Vector3();
  const rotMatrix = new THREE.Matrix4();

  // Fill instance transforms
  for (let i = 0; i < leafCount; i++) {
    const leaf = leafList[i]!;

    // Transform position from Z-up to Y-up
    tempPosition.set(leaf.position.x, leaf.position.z, -leaf.position.y);

    // Transform direction and right vectors
    leafDir
      .set(leaf.direction.x, leaf.direction.z, -leaf.direction.y)
      .normalize();
    leafRight.set(leaf.right.x, leaf.right.z, -leaf.right.y).normalize();
    leafUp.crossVectors(leafDir, leafRight).normalize();

    // Build rotation matrix from basis vectors
    rotMatrix.makeBasis(leafRight, leafUp, leafDir);
    tempQuat.setFromRotationMatrix(rotMatrix);

    // Store orientation (quaternion) for vertex shader
    orientations[i * 4] = tempQuat.x;
    orientations[i * 4 + 1] = tempQuat.y;
    orientations[i * 4 + 2] = tempQuat.z;
    orientations[i * 4 + 3] = tempQuat.w;

    // Set instance matrix (just position, rotation handled by quaternion attribute)
    tempMatrix.compose(tempPosition, new THREE.Quaternion(), tempScale);
    instancedMesh.setMatrixAt(i, tempMatrix);
  }

  // Add orientation as instance attribute
  const orientationAttr = new THREE.InstancedBufferAttribute(orientations, 4);
  geometry.setAttribute("instanceOrientation", orientationAttr);

  // Mark matrices as needing update
  instancedMesh.instanceMatrix.needsUpdate = true;

  // Enable frustum culling and shadow
  instancedMesh.frustumCulled = true;
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  return {
    mesh: instancedMesh,
    instanceCount: leafCount,
    material: leafMaterial,
  };
}

/**
 * Generate instanced leaves and blossoms separately.
 *
 * @param leaves - Array of leaf data (including blossoms)
 * @param params - Tree parameters
 * @param treeScale - Overall tree scale
 * @param options - Instancing options
 * @returns Object with leaf and blossom instanced meshes
 */
export function generateInstancedLeavesAndBlossoms(
  leaves: LeafData[],
  params: TreeParams,
  treeScale: number,
  options: InstancedLeafOptions = {},
): {
  leaves: InstancedLeafResult | null;
  blossoms: InstancedLeafResult | null;
} {
  const { useTSL = false } = options;

  // Separate leaves and blossoms
  const leafData = leaves.filter((l) => !l.isBlossom);
  const blossomData = leaves.filter((l) => l.isBlossom);

  let leafResult: InstancedLeafResult | null = null;
  let blossomResult: InstancedLeafResult | null = null;

  if (leafData.length > 0) {
    leafResult = generateInstancedLeaves(leafData, params, treeScale, options);
    leafResult.mesh.name = "InstancedLeaves";
  }

  if (blossomData.length > 0) {
    // Use blossom scale instead of leaf scale
    const blossomParams = {
      ...params,
      leafScale: params.blossomScale,
      leafScaleX: 1,
    };

    // Create blossom material - use TSL when requested for WebGPU compatibility
    let blossomMaterial: THREE.Material | undefined;
    if (!options.material) {
      if (useTSL) {
        blossomMaterial = createInstancedLeafMaterialTSL({
          color: new THREE.Color(0xffc0cb), // Pink for blossoms
        });
      } else {
        blossomMaterial = createInstancedLeafMaterial({
          color: new THREE.Color(0xffc0cb), // Pink for blossoms
        });
      }
    }

    blossomResult = generateInstancedLeaves(
      blossomData,
      blossomParams,
      treeScale,
      {
        ...options,
        material: blossomMaterial,
      },
    );
    blossomResult.mesh.name = "InstancedBlossoms";
  }

  return { leaves: leafResult, blossoms: blossomResult };
}
