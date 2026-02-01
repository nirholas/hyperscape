/**
 * Branch Geometry Generation
 *
 * Converts stem/branch data into Three.js BufferGeometry.
 * Creates tube-like geometry from Bezier curves.
 *
 * COORDINATE SYSTEM NOTE:
 * The tree generation algorithm uses Z-up (Blender convention).
 * Three.js uses Y-up. We transform coordinates when creating geometry:
 * - Blender X -> Three.js X
 * - Blender Y -> Three.js -Z
 * - Blender Z -> Three.js Y
 */

import * as THREE from "three";
import type {
  StemData,
  TreeParams,
  GeometryOptions,
  MeshGeometryData,
} from "../types.js";
import {
  calcPointOnBezier,
  calcTangentToBezier,
  type BezierSplinePoint,
} from "../math/Bezier.js";

/**
 * Transform a Vector3 from Z-up to Y-up.
 * Blender: X-right, Y-forward, Z-up
 * Three.js: X-right, Y-up, Z-forward (toward camera)
 */
function transformVec3(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

/**
 * Default geometry options.
 */
const DEFAULT_OPTIONS: Required<GeometryOptions> = {
  radialSegments: 8,
  branchCaps: true,
  vertexColors: false,
  uvScale: 1,
  maxLeaves: 50000,
  maxBranchDepth: Infinity,
  maxStems: 2000, // Safety limit to prevent memory allocation failures
  leafSamplingMode: "spatial",
  leafSamplingSeed: 0,
  leafScaleMultiplier: 1.0,
};

/**
 * Generate Three.js geometry for all stems.
 *
 * @param stems - Array of stem data
 * @param params - Tree parameters
 * @param options - Geometry generation options
 * @returns Three.js BufferGeometry
 */
export function generateBranchGeometry(
  stems: StemData[],
  params: TreeParams,
  options: GeometryOptions = {},
): THREE.BufferGeometry {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const geometries: MeshGeometryData[] = [];

  // Filter stems by depth if maxBranchDepth is set
  const maxDepth = opts.maxBranchDepth;
  let filteredStems =
    maxDepth < Infinity ? stems.filter((s) => s.depth <= maxDepth) : stems;

  // Apply maxStems limit - prioritize lower depth (trunk/main branches)
  if (filteredStems.length > opts.maxStems) {
    // Sort by depth (ascending) then by radius (descending) to keep most important branches
    filteredStems = [...filteredStems]
      .sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return b.radius - a.radius; // Larger radius = more important
      })
      .slice(0, opts.maxStems);
  }

  // Generate geometry for each stem
  for (const stem of filteredStems) {
    const radialSegs = calculateRadialSegments(
      stem,
      params,
      opts.radialSegments,
    );
    const geometry = generateStemGeometry(stem, radialSegs, opts);
    geometries.push(geometry);
  }

  // Merge all geometries
  return mergeGeometries(geometries, opts.vertexColors);
}

/**
 * Generate geometry by depth level for separate materials.
 *
 * @param stems - Array of stem data
 * @param params - Tree parameters
 * @param options - Geometry generation options
 * @returns Object containing geometry for each depth level
 */
export function generateBranchGeometryByDepth(
  stems: StemData[],
  params: TreeParams,
  options: GeometryOptions = {},
): Map<number, THREE.BufferGeometry> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const geometriesByDepth = new Map<number, MeshGeometryData[]>();

  // Filter stems by depth if maxBranchDepth is set
  const maxDepth = opts.maxBranchDepth;
  let filteredStems = stems.filter((s) => s.depth <= maxDepth);

  // Apply maxStems limit - prioritize lower depth (trunk/main branches)
  if (filteredStems.length > opts.maxStems) {
    filteredStems = [...filteredStems]
      .sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return b.radius - a.radius;
      })
      .slice(0, opts.maxStems);
  }

  // Generate geometry for each stem, organized by depth
  for (const stem of filteredStems) {
    const radialSegs = calculateRadialSegments(
      stem,
      params,
      opts.radialSegments,
    );
    const geometry = generateStemGeometry(stem, radialSegs, opts);

    if (!geometriesByDepth.has(stem.depth)) {
      geometriesByDepth.set(stem.depth, []);
    }
    geometriesByDepth.get(stem.depth)!.push(geometry);
  }

  // Merge geometries per depth
  const result = new Map<number, THREE.BufferGeometry>();
  for (const [depth, geos] of geometriesByDepth) {
    result.set(depth, mergeGeometries(geos, opts.vertexColors));
  }

  return result;
}

/**
 * Calculate radial segments for a stem based on its depth and radius.
 */
function calculateRadialSegments(
  stem: StemData,
  params: TreeParams,
  baseRadialSegs: number,
): number {
  // Use bevel resolution if available, otherwise calculate based on depth
  const bevelRes = params.bevelRes[stem.depth];
  if (bevelRes !== undefined && bevelRes > 0) {
    return Math.max(3, Math.floor(bevelRes));
  }

  // Reduce resolution for smaller branches
  if (stem.depth === 0) {
    return Math.max(6, baseRadialSegs);
  } else if (stem.depth === 1) {
    return Math.max(4, Math.floor(baseRadialSegs * 0.75));
  } else {
    return Math.max(3, Math.floor(baseRadialSegs * 0.5));
  }
}

/**
 * Generate geometry for a single stem.
 */
function generateStemGeometry(
  stem: StemData,
  radialSegments: number,
  options: Required<GeometryOptions>,
): MeshGeometryData {
  const points = stem.points;
  if (points.length < 2) {
    return createEmptyGeometry();
  }

  // Convert to BezierSplinePoints with coordinate transformation (Z-up to Y-up)
  const splinePoints: BezierSplinePoint[] = points.map((p) => ({
    co: transformVec3(p.position),
    handleLeft: transformVec3(p.handleLeft),
    handleRight: transformVec3(p.handleRight),
  }));

  // Sample points along the spline
  const sampledPoints: Array<{
    position: THREE.Vector3;
    radius: number;
    t: number;
  }> = [];
  const segmentSamples = 4; // Samples per bezier segment

  for (let i = 0; i < splinePoints.length - 1; i++) {
    const startPoint = splinePoints[i]!;
    const endPoint = splinePoints[i + 1]!;
    const startRadius = points[i]!.radius;
    const endRadius = points[i + 1]!.radius;

    for (let j = 0; j < segmentSamples; j++) {
      const t = j / segmentSamples;
      const globalT = (i + t) / (splinePoints.length - 1);

      // Position is already in Y-up space after splinePoints transformation
      const position = calcPointOnBezier(t, startPoint, endPoint);
      const radius = startRadius + (endRadius - startRadius) * t;

      sampledPoints.push({ position, radius, t: globalT });
    }
  }

  // Add final point
  const lastSplinePoint = splinePoints[splinePoints.length - 1]!;
  const lastRadius = points[points.length - 1]!.radius;
  sampledPoints.push({
    position: lastSplinePoint.co.clone(),
    radius: lastRadius,
    t: 1,
  });

  // Generate tube geometry
  return generateTubeGeometry(
    sampledPoints,
    splinePoints,
    radialSegments,
    options,
  );
}

/**
 * Generate tube geometry from sampled points.
 */
function generateTubeGeometry(
  sampledPoints: Array<{ position: THREE.Vector3; radius: number; t: number }>,
  splinePoints: BezierSplinePoint[],
  radialSegments: number,
  options: Required<GeometryOptions>,
): MeshGeometryData {
  const numRings = sampledPoints.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  // Previous reference frame for consistent rotation
  let prevRight = new THREE.Vector3(1, 0, 0);
  let prevUp = new THREE.Vector3(0, 1, 0);

  // Generate rings
  let runningLength = 0;
  let prevPosition = sampledPoints[0]!.position;

  for (let i = 0; i < numRings; i++) {
    const point = sampledPoints[i]!;
    const { position, radius, t } = point;

    // Calculate tangent
    const segmentIndex = Math.min(
      Math.floor(t * (splinePoints.length - 1)),
      splinePoints.length - 2,
    );
    const localT = t * (splinePoints.length - 1) - segmentIndex;
    const tangent = calcTangentToBezier(
      Math.max(0.001, Math.min(0.999, localT)),
      splinePoints[segmentIndex]!,
      splinePoints[segmentIndex + 1]!,
    ).normalize();

    // Calculate reference frame using parallel transport
    const { right, up } = calculateReferenceFrame(tangent, prevRight, prevUp);
    prevRight = right;
    prevUp = up;

    // Calculate running length for UV mapping
    runningLength += position.distanceTo(prevPosition);
    prevPosition = position;

    // Generate ring vertices
    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Normal points radially outward
      const normal = new THREE.Vector3(
        cos * right.x + sin * up.x,
        cos * right.y + sin * up.y,
        cos * right.z + sin * up.z,
      ).normalize();

      // Position
      const vertexPos = position
        .clone()
        .add(normal.clone().multiplyScalar(radius));
      positions.push(vertexPos.x, vertexPos.y, vertexPos.z);

      // Normal
      normals.push(normal.x, normal.y, normal.z);

      // UV
      const u = j / radialSegments;
      const v = runningLength * options.uvScale;
      uvs.push(u, v);

      // Vertex color (AO approximation - darker at base)
      if (options.vertexColors) {
        const ao = 0.6 + 0.4 * t;
        colors.push(ao, ao, ao);
      }
    }
  }

  // Generate indices (quads between adjacent rings)
  for (let i = 0; i < numRings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const curr = i * radialSegments + j;
      const next = i * radialSegments + ((j + 1) % radialSegments);
      const currNext = (i + 1) * radialSegments + j;
      const nextNext = (i + 1) * radialSegments + ((j + 1) % radialSegments);

      // Two triangles per quad
      indices.push(curr, next, currNext);
      indices.push(next, nextNext, currNext);
    }
  }

  // Generate caps if requested
  if (options.branchCaps) {
    // Bottom cap
    const bottomCenter = positions.length / 3;
    const bottomPoint = sampledPoints[0]!;
    positions.push(
      bottomPoint.position.x,
      bottomPoint.position.y,
      bottomPoint.position.z,
    );

    // Get bottom tangent for normal
    const bottomTangent = calcTangentToBezier(
      0.001,
      splinePoints[0]!,
      splinePoints[1]!,
    )
      .normalize()
      .negate();
    normals.push(bottomTangent.x, bottomTangent.y, bottomTangent.z);
    uvs.push(0.5, 0.5);
    if (options.vertexColors) {
      colors.push(0.5, 0.5, 0.5);
    }

    // Bottom cap triangles
    for (let j = 0; j < radialSegments; j++) {
      const curr = j;
      const next = (j + 1) % radialSegments;
      indices.push(bottomCenter, next, curr);
    }

    // Top cap
    const topCenter = positions.length / 3;
    const topPoint = sampledPoints[sampledPoints.length - 1]!;
    positions.push(
      topPoint.position.x,
      topPoint.position.y,
      topPoint.position.z,
    );

    // Get top tangent for normal
    const topTangent = calcTangentToBezier(
      0.999,
      splinePoints[splinePoints.length - 2]!,
      splinePoints[splinePoints.length - 1]!,
    ).normalize();
    normals.push(topTangent.x, topTangent.y, topTangent.z);
    uvs.push(0.5, 0.5);
    if (options.vertexColors) {
      colors.push(1, 1, 1);
    }

    // Top cap triangles
    const lastRingStart = (numRings - 1) * radialSegments;
    for (let j = 0; j < radialSegments; j++) {
      const curr = lastRingStart + j;
      const next = lastRingStart + ((j + 1) % radialSegments);
      indices.push(topCenter, curr, next);
    }
  }

  const result: MeshGeometryData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };

  if (options.vertexColors) {
    result.colors = new Float32Array(colors);
  }

  return result;
}

/**
 * Calculate a consistent reference frame using parallel transport.
 */
function calculateReferenceFrame(
  tangent: THREE.Vector3,
  prevRight: THREE.Vector3,
  _prevUp: THREE.Vector3,
): { right: THREE.Vector3; up: THREE.Vector3 } {
  // Project previous right onto plane perpendicular to tangent
  let right = prevRight.clone().projectOnPlane(tangent);

  if (right.lengthSq() < 0.0001) {
    // Previous right is parallel to tangent, use fallback
    if (Math.abs(tangent.y) < 0.99) {
      right = new THREE.Vector3(0, 1, 0).cross(tangent);
    } else {
      right = new THREE.Vector3(1, 0, 0).cross(tangent);
    }
  }

  right.normalize();

  // Up is perpendicular to both tangent and right
  const up = new THREE.Vector3().crossVectors(tangent, right).normalize();

  return { right, up };
}

/**
 * Create an empty geometry data structure.
 */
function createEmptyGeometry(): MeshGeometryData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}

/**
 * Create a simple fallback branch geometry (a tapered cylinder).
 * Used when the full geometry would exceed memory limits.
 */
function createFallbackBranchGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.05, 0.2, 5, 6, 1);
  // Move base to origin (tree base)
  geometry.translate(0, 2.5, 0);
  return geometry;
}

/**
 * Maximum buffer size in bytes to prevent allocation failures.
 * 64MB is a safe limit for most browsers/devices.
 */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Merge multiple geometry data into a single Three.js geometry.
 * Includes safety checks to prevent memory allocation failures.
 */
function mergeGeometries(
  geometries: MeshGeometryData[],
  includeColors: boolean,
): THREE.BufferGeometry {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // Calculate total sizes
  let totalPositions = 0;
  let totalIndices = 0;
  let hasColors = includeColors;

  for (const geo of geometries) {
    totalPositions += geo.positions.length;
    totalIndices += geo.indices.length;
    if (!geo.colors) {
      hasColors = false;
    }
  }

  // Safety check: estimate total memory required
  // Float32Array: 4 bytes per element, Uint32Array: 4 bytes per element
  const positionBytes = totalPositions * 4; // positions
  const normalBytes = totalPositions * 4; // normals
  const uvBytes = (totalPositions / 3) * 2 * 4; // uvs
  const indexBytes = totalIndices * 4; // indices
  const colorBytes = hasColors ? totalPositions * 4 : 0;
  const totalBytes =
    positionBytes + normalBytes + uvBytes + indexBytes + colorBytes;

  if (totalBytes > MAX_BUFFER_BYTES) {
    console.warn(
      `[BranchGeometry] Geometry too large (${(totalBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_BUFFER_BYTES / 1024 / 1024}MB limit). ` +
        `Positions: ${totalPositions}, Indices: ${totalIndices}, Stems: ${geometries.length}. ` +
        `Returning simplified geometry.`,
    );
    // Return a simple placeholder geometry (a small cylinder)
    return createFallbackBranchGeometry();
  }

  const mergedPositions = new Float32Array(totalPositions);
  const mergedNormals = new Float32Array(totalPositions);
  const mergedUvs = new Float32Array((totalPositions / 3) * 2);
  const mergedIndices = new Uint32Array(totalIndices);
  const mergedColors = hasColors ? new Float32Array(totalPositions) : undefined;

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

    // Copy colors if present
    if (hasColors && geo.colors && mergedColors) {
      mergedColors.set(geo.colors, positionOffset);
    }

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

  if (hasColors && mergedColors) {
    geometry.setAttribute("color", new THREE.BufferAttribute(mergedColors, 3));
  }

  return geometry;
}
