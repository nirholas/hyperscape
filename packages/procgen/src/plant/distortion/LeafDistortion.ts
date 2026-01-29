/**
 * LeafDistortion - 3D vertex distortions for leaves
 *
 * Applies various distortion effects to leaf vertices:
 * - Curl: Curls the leaf tip forward/backward
 * - Cup: Creates concave/convex cupping across width
 * - Wave: Sinusoidal waves along the leaf
 * - Flop: Drooping from gravity
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type {
  Point3D,
  Curve3D,
  MeshData,
  LeafParamDict,
  DistortionCurve,
  LeafVein,
} from "../types.js";
import { LeafDistortionType, Axis, LPK } from "../types.js";
import {
  evaluateCurve3D,
  findClosestPointOnCurve3D,
  getCurveLength3D,
  createArc,
} from "../math/Bezier.js";
import {
  clone3D,
  sub3D,
  mul3D,
  lerp3D,
  distance3D,
  getExtents3D,
} from "../math/Vector.js";
import { PI, radians } from "../math/Polar.js";
import { getParamValue } from "../params/LeafParamDefaults.js";
import { calculateVertexNormals } from "../mesh/Triangulation.js";

// =============================================================================
// DISTORTION CURVE GENERATION
// =============================================================================

/**
 * Generate curl distortion curve
 * Creates an arc that curls the leaf tip
 */
function generateCurlCurve(
  midrib: Curve3D,
  curlAmount: number,
  curlPoint: number,
): DistortionCurve {
  // Slice the midrib at the curl point
  const startPoint = evaluateCurve3D(midrib, curlPoint);
  const endPoint = evaluateCurve3D(midrib, 1);

  // Create the curl arc
  const baseCurve: Curve3D = {
    p0: startPoint,
    h0: lerp3D(startPoint, endPoint, 0.33),
    h1: lerp3D(startPoint, endPoint, 0.66),
    p1: endPoint,
  };

  const arcCurve = createArc(baseCurve, curlAmount, curlAmount < 0);

  return {
    influenceCurves: [midrib],
    distortionPoints: [arcCurve.p0, arcCurve.h0, arcCurve.h1, arcCurve.p1],
    config: {
      affectAxes: Axis.YZ,
      maxFadeDist: 1,
      useDistFade: true,
      reverseFade: false,
      skipOutsideLowerBound: true,
      type: LeafDistortionType.Curl,
    },
    shouldFade: true,
  };
}

/**
 * Generate cup distortion curves
 * Creates concave/convex cupping across the leaf width
 */
function generateCupCurves(
  midrib: Curve3D,
  leafWidth: number,
  cupAmount: number,
  cupClamp: number,
): DistortionCurve[] {
  const curves: DistortionCurve[] = [];

  // Sample points along midrib
  const sampleCount = 8;
  for (let i = 0; i < sampleCount; i++) {
    const t = (i + 1) / (sampleCount + 1);
    const midribPoint = evaluateCurve3D(midrib, t);

    // Create horizontal influence curve (across width)
    const leftPoint: Point3D = {
      x: -leafWidth * cupClamp,
      y: midribPoint.y,
      z: 0,
    };
    const rightPoint: Point3D = {
      x: leafWidth * cupClamp,
      y: midribPoint.y,
      z: 0,
    };

    const influenceCurve: Curve3D = {
      p0: leftPoint,
      h0: lerp3D(leftPoint, rightPoint, 0.33),
      h1: lerp3D(leftPoint, rightPoint, 0.66),
      p1: rightPoint,
    };

    // Cup distortion moves edges up/down in Z
    const cupHeight = cupAmount * leafWidth * 0.3;
    const distortedLeft: Point3D = { ...leftPoint, z: cupHeight };
    const distortedRight: Point3D = { ...rightPoint, z: cupHeight };

    curves.push({
      influenceCurves: [influenceCurve],
      distortionPoints: [distortedLeft, midribPoint, distortedRight],
      config: {
        affectAxes: Axis.Z,
        maxFadeDist: leafWidth,
        useDistFade: false,
        reverseFade: false,
        skipOutsideLowerBound: false,
        type: LeafDistortionType.Cup,
      },
      shouldFade: false,
    });
  }

  return curves;
}

/**
 * Generate wave distortion curves
 * Creates sinusoidal waves along the leaf
 */
function generateWaveCurves(
  midrib: Curve3D,
  leafWidth: number,
  waveAmp: number,
  wavePeriod: number,
  waveDepth: number,
  waveDivergence: number,
  waveDivergencePeriod: number,
): DistortionCurve[] {
  const curves: DistortionCurve[] = [];

  if (wavePeriod < 0.5 || waveAmp < 0.01) return curves;

  const midribLength = getCurveLength3D(midrib);
  const waveCount = Math.floor((midribLength * wavePeriod) / 2);

  for (let w = 0; w < waveCount; w++) {
    const waveT = (w + 0.5) / waveCount;

    // Skip if below depth threshold
    if (waveT < 1 - waveDepth) continue;

    const midribPoint = evaluateCurve3D(midrib, waveT);

    // Calculate wave phase
    const phase = w * PI;
    const waveHeight = waveAmp * leafWidth * 0.2 * Math.sin(phase);

    // Add divergence (waves spread outward)
    const divergencePhase = w * waveDivergencePeriod * PI;
    const xOffset = waveDivergence * 0.1 * Math.sin(divergencePhase);

    // Create wave influence across width
    const leftPoint: Point3D = {
      x: -leafWidth * 0.8 + xOffset,
      y: midribPoint.y,
      z: waveHeight,
    };
    const rightPoint: Point3D = {
      x: leafWidth * 0.8 + xOffset,
      y: midribPoint.y,
      z: waveHeight,
    };
    const centerPoint: Point3D = {
      x: midribPoint.x,
      y: midribPoint.y,
      z: -waveHeight * 0.5, // Opposite direction at center
    };

    const influenceCurve: Curve3D = {
      p0: leftPoint,
      h0: lerp3D(leftPoint, centerPoint, 0.5),
      h1: lerp3D(centerPoint, rightPoint, 0.5),
      p1: rightPoint,
    };

    curves.push({
      influenceCurves: [influenceCurve],
      distortionPoints: [leftPoint, centerPoint, rightPoint],
      config: {
        affectAxes: Axis.Z,
        maxFadeDist: leafWidth,
        useDistFade: false,
        reverseFade: false,
        skipOutsideLowerBound: false,
        type: LeafDistortionType.Wave,
      },
      shouldFade: false,
    });
  }

  return curves;
}

/**
 * Generate flop distortion curve
 * Creates drooping/gravity effect
 */
function generateFlopCurve(
  midrib: Curve3D,
  flopAmount: number,
  flopStart: number,
): DistortionCurve {
  // Flop affects from flopStart to end
  const startPoint = evaluateCurve3D(midrib, flopStart);
  const endPoint = evaluateCurve3D(midrib, 1);

  // Calculate droop amount (angle to Z displacement)
  const flopRad = radians(flopAmount);
  const length = distance3D(startPoint, endPoint);
  const zDrop = length * Math.sin(flopRad);

  // Create drooping curve
  const midPoint: Point3D = {
    x: (startPoint.x + endPoint.x) / 2,
    y: (startPoint.y + endPoint.y) / 2,
    z: -zDrop * 0.5,
  };

  const droppedEnd: Point3D = {
    x: endPoint.x,
    y: endPoint.y,
    z: -zDrop,
  };

  return {
    influenceCurves: [midrib],
    distortionPoints: [startPoint, midPoint, droppedEnd],
    config: {
      affectAxes: Axis.Z,
      maxFadeDist: 1,
      useDistFade: true,
      reverseFade: false,
      skipOutsideLowerBound: true,
      type: LeafDistortionType.Flop,
    },
    shouldFade: true,
  };
}

// =============================================================================
// DISTORTION APPLICATION
// =============================================================================

/**
 * Apply a single distortion curve to vertices
 */
function applyDistortionCurve(
  vertices: Point3D[],
  curve: DistortionCurve,
  leafExtents: { min: Point3D; max: Point3D },
): void {
  const { influenceCurves, distortionPoints, config } = curve;

  if (influenceCurves.length === 0 || distortionPoints.length < 2) return;

  const mainInfluence = influenceCurves[0];
  const leafWidth = leafExtents.max.x - leafExtents.min.x;

  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];

    // Find position along influence curve
    const closest = findClosestPointOnCurve3D(mainInfluence, vertex, 2, 10);
    const t = closest.t;

    // Skip if outside bounds for certain distortion types
    if (config.skipOutsideLowerBound && t < 0.05) continue;

    // Calculate distance from influence curve
    const distanceFromCurve = closest.distance;

    // Calculate fade factor based on distance
    let fadeFactor = 1;
    if (config.useDistFade && config.maxFadeDist > 0) {
      const normalizedDist = distanceFromCurve / config.maxFadeDist;
      fadeFactor = config.reverseFade
        ? normalizedDist
        : Math.max(0, 1 - normalizedDist);
    }

    // Calculate distortion amount based on position
    let distortion: Point3D = { x: 0, y: 0, z: 0 };

    switch (config.type) {
      case LeafDistortionType.Curl:
        distortion = calculateCurlDistortion(
          vertex,
          distortionPoints,
          t,
          fadeFactor,
        );
        break;
      case LeafDistortionType.Cup:
        distortion = calculateCupDistortion(
          vertex,
          distortionPoints,
          leafWidth,
          fadeFactor,
        );
        break;
      case LeafDistortionType.Wave:
        distortion = calculateWaveDistortion(
          vertex,
          distortionPoints,
          fadeFactor,
        );
        break;
      case LeafDistortionType.Flop:
        distortion = calculateFlopDistortion(
          vertex,
          distortionPoints,
          t,
          fadeFactor,
        );
        break;
    }

    // Apply distortion to affected axes
    if (config.affectAxes & Axis.X) vertex.x += distortion.x;
    if (config.affectAxes & Axis.Y) vertex.y += distortion.y;
    if (config.affectAxes & Axis.Z) vertex.z += distortion.z;
  }
}

/**
 * Calculate curl distortion for a vertex
 */
function calculateCurlDistortion(
  vertex: Point3D,
  points: Point3D[],
  t: number,
  fade: number,
): Point3D {
  if (points.length < 4) return { x: 0, y: 0, z: 0 };

  // Curl pulls vertex toward the arc
  const arcT = Math.max(0, (t - 0.5) * 2); // Only affects upper half
  if (arcT <= 0) return { x: 0, y: 0, z: 0 };

  // Interpolate along arc
  const arcPoint = evaluateCurve3D(
    { p0: points[0], h0: points[1], h1: points[2], p1: points[3] },
    arcT,
  );

  // Move vertex toward arc position
  const toArc = sub3D(arcPoint, vertex);

  return mul3D(toArc, fade * arcT);
}

/**
 * Calculate cup distortion for a vertex
 */
function calculateCupDistortion(
  vertex: Point3D,
  points: Point3D[],
  leafWidth: number,
  fade: number,
): Point3D {
  // Cup is based on distance from center (X=0)
  const distFromCenter = Math.abs(vertex.x);
  const normalizedX = leafWidth > 0 ? distFromCenter / (leafWidth / 2) : 0;

  // Parabolic cup profile
  const cupFactor = Math.pow(normalizedX, 2);

  // Get cup height from distortion points
  const cupHeight = points.length > 0 ? points[0].z : 0;

  return {
    x: 0,
    y: 0,
    z: cupHeight * cupFactor * fade,
  };
}

/**
 * Calculate wave distortion for a vertex
 */
function calculateWaveDistortion(
  vertex: Point3D,
  points: Point3D[],
  fade: number,
): Point3D {
  if (points.length < 3) return { x: 0, y: 0, z: 0 };

  // Interpolate wave height based on X position
  const leftHeight = points[0].z;
  const centerHeight = points[1].z;
  const rightHeight = points[2].z;

  let waveHeight: number;
  if (vertex.x < 0) {
    // Lerp from left to center
    const t = (vertex.x - points[0].x) / (points[1].x - points[0].x);
    waveHeight =
      leftHeight + (centerHeight - leftHeight) * Math.max(0, Math.min(1, t));
  } else {
    // Lerp from center to right
    const t = (vertex.x - points[1].x) / (points[2].x - points[1].x);
    waveHeight =
      centerHeight + (rightHeight - centerHeight) * Math.max(0, Math.min(1, t));
  }

  return {
    x: 0,
    y: 0,
    z: waveHeight * fade,
  };
}

/**
 * Calculate flop distortion for a vertex
 */
function calculateFlopDistortion(
  _vertex: Point3D,
  points: Point3D[],
  t: number,
  fade: number,
): Point3D {
  if (points.length < 3) return { x: 0, y: 0, z: 0 };

  // Flop increases toward the tip
  const flopT = Math.max(0, t);
  const flopFactor = Math.pow(flopT, 2); // Quadratic falloff

  // Get droop amount from points
  const maxDroop = points[2].z;

  return {
    x: 0,
    y: 0,
    z: maxDroop * flopFactor * fade,
  };
}

// =============================================================================
// MAIN DISTORTION FUNCTION
// =============================================================================

/**
 * Simple seeded random for distortion variation
 */
function createDistortionRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Apply all distortions to a leaf mesh
 *
 * @param mesh - Base mesh to distort
 * @param midrib - Midrib vein curve for reference
 * @param params - Plant parameters
 * @param seed - Random seed for micro-variation in distortion amounts
 */
export function applyDistortions(
  mesh: MeshData,
  midrib: LeafVein,
  params: LeafParamDict,
  seed: number,
): MeshData {
  // Check if distortion is enabled
  const distortionEnabled = getParamValue(params, LPK.DistortionEnabled) > 0;
  if (!distortionEnabled) {
    return mesh;
  }

  // Create seeded random for variation
  const random = createDistortionRandom(seed);

  // Clone vertices for modification
  const distortedVertices = mesh.vertices.map(clone3D);

  // Calculate leaf extents
  const extents = getExtents3D(distortedVertices);
  const leafWidth = extents.max.x - extents.min.x;

  // Convert midrib vein to Curve3D
  const midribCurve: Curve3D = {
    p0: midrib.p0,
    h0: midrib.h0,
    h1: midrib.h1,
    p1: midrib.p1,
  };

  // Get distortion parameters with seed-based micro-variation (±5%)
  const variationFactor = () => 1.0 + (random() - 0.5) * 0.1;

  const curlAmount = getParamValue(params, LPK.DistortCurl) * variationFactor();
  const curlPoint = getParamValue(params, LPK.DistortCurlPoint);
  const cupAmount = getParamValue(params, LPK.DistortCup) * variationFactor();
  const cupClamp = getParamValue(params, LPK.DistortCupClamp);
  const flopAmount = getParamValue(params, LPK.DistortFlop) * variationFactor();
  const flopStart = getParamValue(params, LPK.DistortFlopStart);
  const waveAmp = getParamValue(params, LPK.DistortWaveAmp) * variationFactor();
  const wavePeriod = getParamValue(params, LPK.DistortWavePeriod);
  const waveDepth = getParamValue(params, LPK.DistortWaveDepth);
  const waveDivergence = getParamValue(params, LPK.DistortWaveDivergance);
  const waveDivergencePeriod = getParamValue(
    params,
    LPK.DistortWaveDivergancePeriod,
  );

  // Generate and apply distortion curves

  // 1. Cup distortion
  if (Math.abs(cupAmount) > 0.01) {
    const cupCurves = generateCupCurves(
      midribCurve,
      leafWidth,
      cupAmount,
      cupClamp,
    );
    for (const curve of cupCurves) {
      applyDistortionCurve(distortedVertices, curve, extents);
    }
  }

  // 2. Wave distortion
  if (waveAmp > 0.01 && wavePeriod > 0.5) {
    const waveCurves = generateWaveCurves(
      midribCurve,
      leafWidth,
      waveAmp,
      wavePeriod,
      waveDepth,
      waveDivergence,
      waveDivergencePeriod,
    );
    for (const curve of waveCurves) {
      applyDistortionCurve(distortedVertices, curve, extents);
    }
  }

  // 3. Curl distortion
  if (Math.abs(curlAmount) > 1) {
    const curlCurve = generateCurlCurve(midribCurve, curlAmount, curlPoint);
    applyDistortionCurve(distortedVertices, curlCurve, extents);
  }

  // 4. Flop distortion
  if (flopAmount > 1) {
    const flopCurve = generateFlopCurve(midribCurve, flopAmount, flopStart);
    applyDistortionCurve(distortedVertices, flopCurve, extents);
  }

  // Recalculate normals after distortion
  const newNormals = calculateVertexNormals(distortedVertices, mesh.triangles);

  return {
    ...mesh,
    vertices: distortedVertices,
    normals: newNormals,
  };
}

/**
 * Generate multiple distortion instances for variation
 */
export function generateDistortionInstances(
  baseMesh: MeshData,
  midrib: LeafVein,
  params: LeafParamDict,
  instanceCount: number,
  baseSeed: number,
): MeshData[] {
  const instances: MeshData[] = [];

  for (let i = 0; i < instanceCount; i++) {
    const instanceSeed = baseSeed + i * 1000;
    const distortedMesh = applyDistortions(
      baseMesh,
      midrib,
      params,
      instanceSeed,
    );
    instances.push(distortedMesh);
  }

  return instances;
}
