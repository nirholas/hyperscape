/**
 * Arrangement - Plant assembly and leaf positioning
 *
 * Arranges leaves around a central trunk with:
 * - Rotational symmetry
 * - Node-based vertical distribution
 * - Scale variation
 * - Physics-based collision avoidance
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 *
 * CRITICAL COMPATIBILITY NOTES:
 * - Y positioning uses absolute values (NodeInitialY + i * NodeDistance), NOT t parameter
 * - Scale gradient: oldest leaves (i=0) are smallest, newest (last) are largest
 * - Stem rotation: calculated from RotationClustering and RotationalSymmetry
 */

import type {
  Point3D,
  Curve3D,
  LeafParamDict,
  ArrangementData,
  LeafBundle,
  LeafStemData,
  PlantTrunkData,
} from "../types.js";
import { LPK } from "../types.js";
import { evaluateCurve3D, findPointFromY } from "../math/Bezier.js";
import { add3D, sub3D, mul3D } from "../math/Vector.js";
import { radians, DEG_TO_RAD } from "../math/Polar.js";
import { getParamValue } from "../params/LeafParamDefaults.js";
import { SeededRandom, genTypedSeed } from "../math/Random.js";

// =============================================================================
// CONSTANTS (from original C#)
// =============================================================================

/** Pot scale fudge factor from original */
const POT_SCALE_FUDGE = 6.66;

/** Base pot scale from original */
const POT_SCALE_BASE = 2.0 * POT_SCALE_FUDGE;

// =============================================================================
// QUATERNION UTILITIES
// =============================================================================

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Create quaternion from Euler angles (radians)
 * Exported for testing
 */
export function quaternionFromEuler(
  x: number,
  y: number,
  z: number,
): Quaternion {
  const cx = Math.cos(x / 2);
  const cy = Math.cos(y / 2);
  const cz = Math.cos(z / 2);
  const sx = Math.sin(x / 2);
  const sy = Math.sin(y / 2);
  const sz = Math.sin(z / 2);

  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

/**
 * Rotate a point by a quaternion
 * Exported for testing
 */
export function rotateByQuaternion(point: Point3D, q: Quaternion): Point3D {
  const px = point.x,
    py = point.y,
    pz = point.z;
  const qx = q.x,
    qy = q.y,
    qz = q.z,
    qw = q.w;

  // Calculate quaternion * point * quaternion conjugate
  const ix = qw * px + qy * pz - qz * py;
  const iy = qw * py + qz * px - qx * pz;
  const iz = qw * pz + qx * py - qy * px;
  const iw = -qx * px - qy * py - qz * pz;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

// =============================================================================
// POT UTILITIES (matching original C#)
// =============================================================================

/**
 * Get pot scale from params (matches original C# GetPotScale)
 */
export function getPotScale(params: LeafParamDict): number {
  return POT_SCALE_BASE * getParamValue(params, LPK.PotScale);
}

/**
 * Get pot Y offset - simplified since we don't have FlowerPotController
 * In the original, this returns: potController.GetCurrentYPos() * (GetPotScale(fields) / POT_SCALE_FUDGE)
 * We assume pot Y position is 0 for foliage-only generation (no pot)
 */
export function getPotYAdd(_params: LeafParamDict): number {
  // No pot in foliage-only mode
  return 0;
}

// =============================================================================
// TRUNK GENERATION
// =============================================================================

/**
 * Trunk data with point-from-Y lookup capability
 */
export interface PlantTrunkWithLookup extends PlantTrunkData {
  /**
   * Get a point on the trunk at a specific Y height
   * Matches original C# PlantTrunk.GetPointFromY
   */
  getPointFromY(y: number): Point3D;
}

/**
 * Generate plant trunk with Y-lookup capability
 */
export function generateTrunk(
  params: LeafParamDict,
  totalHeight: number,
  seed: number,
): PlantTrunkWithLookup {
  const random = new SeededRandom(genTypedSeed(seed, "trunk"));

  const trunkWidth = getParamValue(params, LPK.TrunkWidth);
  const trunkLean = radians(getParamValue(params, LPK.TrunkLean));
  const trunkWobble = getParamValue(params, LPK.TrunkWobble);

  // Calculate wobble offsets
  const wobbleX = random.rangeAdd(trunkWobble) * totalHeight * 0.1;
  const wobbleZ = random.rangeAdd(trunkWobble) * totalHeight * 0.1;

  // Create trunk curve with lean and wobble
  const leanX = Math.sin(trunkLean) * totalHeight * 0.3;

  const p0: Point3D = { x: 0, y: 0, z: 0 };
  const p1: Point3D = { x: leanX, y: totalHeight, z: 0 };

  const h0: Point3D = {
    x: wobbleX * 0.5,
    y: totalHeight * 0.33,
    z: wobbleZ * 0.5,
  };

  const h1: Point3D = {
    x: leanX + wobbleX,
    y: totalHeight * 0.66,
    z: wobbleZ,
  };

  const curve: Curve3D = { p0, h0, h1, p1 };

  return {
    curves: [curve],
    width: trunkWidth,
    getPointFromY(targetY: number): Point3D {
      // Find t parameter that gives us the target Y
      const t = findPointFromY(curve, targetY);
      return evaluateCurve3D(curve, Math.max(0, Math.min(1, t)));
    },
  };
}

// =============================================================================
// STEM GENERATION (matching original C# LeafStem.CreateCurves EXACTLY)
// =============================================================================

/**
 * Calculate flop percentage (matches original C# LeafStem.GetFlopPerc)
 * Exported for testing
 */
export function getFlopPerc(
  params: LeafParamDict,
  arrData: ArrangementData,
): number {
  let flopVal = getParamValue(params, LPK.StemFlop);
  const flopDiff = arrData.stemFlopMult > 1 ? flopVal : 90 - flopVal;
  flopVal += flopDiff * (1 - arrData.stemFlopMult);
  flopVal += arrData.stemFlopAdd;
  return flopVal / 90;
}

/**
 * Polar to vector conversion (matches original C# Polar.vec)
 * Exported for testing
 */
export function polarToVec2D(
  len: number,
  thetaRad: number,
): { x: number; y: number } {
  return {
    x: len * Math.cos(thetaRad),
    y: len * Math.sin(thetaRad),
  };
}

/**
 * Add polar offset to a 2D point (matches original C# Vector2.AddPolar)
 * Exported for testing
 */
export function addPolar2D(
  from: { x: number; y: number },
  len: number,
  angleDeg: number,
): { x: number; y: number } {
  const angleRad = angleDeg * DEG_TO_RAD;
  return {
    x: from.x + len * Math.cos(angleRad),
    y: from.y + len * Math.sin(angleRad),
  };
}

/**
 * Calculate angle between two 2D points (matches original C# Curve.Angle)
 * Exported for testing
 */
export function angle2D(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
): number {
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

/**
 * Calculate distance between two 2D points
 * Exported for testing
 */
export function distance2D(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * De Casteljau subdivision - EXACTLY matches C# Curve.Subdivide2
 * Splits a curve at parameter t, returning both halves
 * Exported for testing
 */
export function subdivideCurve(
  p0: { x: number; y: number },
  h0: { x: number; y: number },
  h1: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
): {
  first: {
    p0: { x: number; y: number };
    h0: { x: number; y: number };
    h1: { x: number; y: number };
    p1: { x: number; y: number };
  };
  second: {
    p0: { x: number; y: number };
    h0: { x: number; y: number };
    h1: { x: number; y: number };
    p1: { x: number; y: number };
  };
} {
  // De Casteljau algorithm - EXACTLY as in C#
  const b0 = { x: p0.x + (h0.x - p0.x) * t, y: p0.y + (h0.y - p0.y) * t };
  const b1 = { x: h0.x + (h1.x - h0.x) * t, y: h0.y + (h1.y - h0.y) * t };
  const b2 = { x: h1.x + (p1.x - h1.x) * t, y: h1.y + (p1.y - h1.y) * t };

  const c0 = { x: b0.x + (b1.x - b0.x) * t, y: b0.y + (b1.y - b0.y) * t };
  const c1 = { x: b1.x + (b2.x - b1.x) * t, y: b1.y + (b2.y - b1.y) * t };

  const d0 = { x: c0.x + (c1.x - c0.x) * t, y: c0.y + (c1.y - c0.y) * t };

  return {
    first: { p0: p0, h0: b0, h1: c0, p1: d0 },
    second: { p0: d0, h0: c1, h1: b2, p1: p1 },
  };
}

/**
 * Fast length approximation for a 2D bezier curve
 * Exported for testing
 */
export function fastCurveLength(
  p0: { x: number; y: number },
  h0: { x: number; y: number },
  h1: { x: number; y: number },
  p1: { x: number; y: number },
): number {
  // Approximate by averaging chord length and control polygon length
  const chord = distance2D(p0, p1);
  const poly = distance2D(p0, h0) + distance2D(h0, h1) + distance2D(h1, p1);
  return (chord + poly) / 2;
}

/**
 * Generate stem curves for a leaf (matches original C# LeafStem.CreateCurves)
 *
 * Stems are generated at origin in local bundle space - the bundle's transform
 * positions and rotates the stem in world space. Stem direction/curvature is
 * controlled by StemFlop and StemNeck parameters.
 *
 * @param params - Plant parameters dictionary
 * @param arrangementData - Arrangement data for this leaf bundle
 * @param seed - Random seed for curve variation
 */
export function generateStem(
  params: LeafParamDict,
  arrangementData: ArrangementData,
  seed: number,
): LeafStemData {
  // Use seed for deterministic variation
  const random = new SeededRandom(genTypedSeed(seed, "stem"));

  const flopPerc = getFlopPerc(params, arrangementData);
  const lenAdj = 0.25;

  // Calculate stem length with flop adjustment + seed-based variation
  // Original: len = stemLengthMult * (StemLength + stemLengthAdd) / (1 + lenAdj * flopPerc^2)
  const baseLen =
    arrangementData.stemLengthMult *
    (getParamValue(params, LPK.StemLength) + arrangementData.stemLengthAdd);
  // Add ±5% length variation from seed
  const lengthVariation = 1.0 + random.rangeAdd(0.05);
  const len = (baseLen * lengthVariation) / (1 + lenAdj * flopPerc * flopPerc);

  // Calculate flop polar angle
  // Original: Polar flop = new Polar(len, -(flopPerc * 90) + 90, true)
  const flopAngleDeg = -(flopPerc * 90) + 90;
  const flopVec = polarToVec2D(len, flopAngleDeg * DEG_TO_RAD);

  // Create main curve from origin to flop endpoint (2D in XY plane)
  const mainP0 = { x: 0, y: 0 };
  const mainP1 = { x: flopVec.x, y: flopVec.y };

  // Handle interpolation based on flop percentage - EXACTLY as original
  // h0s = (0, len * 0.25), h0e = (len * 0.25, len * 0.5)
  // h1s = (0, len * 0.75), h1e = (len * 0.75, len * 0.5)
  // main.h0 = (h0e - h0s) * flopPerc + h0s
  // main.h1 = (h1e - h1s) * flopPerc + h1s
  const h0s = { x: 0, y: len * 0.25 };
  const h0e = { x: len * 0.25, y: len * 0.5 };
  const h1s = { x: 0, y: len * 0.75 };
  const h1e = { x: len * 0.75, y: len * 0.5 };

  const mainH0 = {
    x: (h0e.x - h0s.x) * flopPerc + h0s.x,
    y: (h0e.y - h0s.y) * flopPerc + h0s.y,
  };
  const mainH1 = {
    x: (h1e.x - h1s.x) * flopPerc + h1s.x,
    y: (h1e.y - h1s.y) * flopPerc + h1s.y,
  };

  // CRITICAL: Subdivide main curve at 0.9 - this MODIFIES main and RETURNS neck
  // Original: Curve neck = main.Subdivide(0.9f);
  const { first: truncatedMain, second: neck } = subdivideCurve(
    mainP0,
    mainH0,
    mainH1,
    mainP1,
    0.9,
  );

  // Now adjust the neck curve as the original does:
  // float neckLen = neck.FastLength();
  // float angle = neck.angleFull;  // Angle from neck.p0 to neck.p1
  // neck.p1 = neck.p0.AddPolar(new Polar(neckLen, -stemNeck + angle, true));
  const neckLen = fastCurveLength(neck.p0, neck.h0, neck.h1, neck.p1);
  const neckAngle = angle2D(neck.p0, neck.p1); // In radians
  const stemNeck = getParamValue(params, LPK.StemNeck);

  // Reposition neck.p1
  const newNeckP1 = addPolar2D(
    neck.p0,
    neckLen,
    -stemNeck + neckAngle * (180 / Math.PI),
  );

  // Adjust neck.h1 as original:
  // float h1Len = Vector2.Distance(neck.p0, neck.h1);
  // float p0ToH1Angle = Curve.Angle(neck.p0, neck.h1);
  // float neckPerc = stemNeck / 90f;
  // neck.h1 = neck.p0.AddPolar(new Polar(h1Len * (1f + neckPerc * 0.3f), -stemNeck/2 + p0ToH1Angle, true));
  const h1Len = distance2D(neck.p0, neck.h1);
  const p0ToH1Angle = angle2D(neck.p0, neck.h1) * (180 / Math.PI); // Convert to degrees
  const neckPerc = stemNeck / 90;
  const newNeckH1 = addPolar2D(
    neck.p0,
    h1Len * (1 + neckPerc * 0.3),
    -stemNeck / 2 + p0ToH1Angle,
  );

  // Add seed-based Z wobble for unique stem curves
  // This adds slight 3D variation to make stems look more natural
  const wobbleStrength = len * 0.02; // 2% of length
  const zWobble = random.rangeAdd(wobbleStrength);

  // Create final 3D curves with seed-based Z variation
  const mainCurve: Curve3D = {
    p0: { x: truncatedMain.p0.x, y: truncatedMain.p0.y, z: 0 },
    h0: { x: truncatedMain.h0.x, y: truncatedMain.h0.y, z: zWobble * 0.3 },
    h1: { x: truncatedMain.h1.x, y: truncatedMain.h1.y, z: zWobble },
    p1: { x: truncatedMain.p1.x, y: truncatedMain.p1.y, z: zWobble * 0.5 },
  };

  const neckCurve: Curve3D = {
    p0: { x: neck.p0.x, y: neck.p0.y, z: zWobble * 0.5 },
    h0: { x: neck.h0.x, y: neck.h0.y, z: zWobble * 0.3 }, // Keep h0 from subdivision
    h1: { x: newNeckH1.x, y: newNeckH1.y, z: zWobble * 0.1 }, // Adjusted h1
    p1: { x: newNeckP1.x, y: newNeckP1.y, z: 0 }, // Adjusted p1 - back to z=0 for leaf attachment
  };

  return {
    curves: [mainCurve, neckCurve],
    length: len,
  };
}

// =============================================================================
// LEAF ARRANGEMENT (matching original C# Arrangement.Arrange)
// =============================================================================

/**
 * Calculate arrangement data for all leaves
 *
 * CRITICAL: This matches the original C# implementation exactly:
 * - Y position starts at NodeInitialY and increases by NodeDistance each leaf
 * - Scale gradient: fullPerc = i / (count - 1), scale = (1 - ScaleMin) * fullPerc + ScaleMin
 * - Rotation: stemYAngle = mostPerc * angleMax + symAngleAdd + rand + angleStart
 * - Stem flop increases for lower (earlier) leaves
 */
export function calculateArrangements(
  params: LeafParamDict,
  trunk: PlantTrunkData | PlantTrunkWithLookup,
  seed: number,
): ArrangementData[] {
  const random = new SeededRandom(genTypedSeed(seed, "arrangement"));

  // Get parameters (matching original C# names)
  const count = Math.floor(getParamValue(params, LPK.LeafCount));
  if (count <= 0) return [];

  const leafScale = getParamValue(params, LPK.LeafScale);
  const scaleMin = getParamValue(params, LPK.ScaleMin);
  const scaleRand = getParamValue(params, LPK.ScaleRand);
  const leafSkewMax = getParamValue(params, LPK.LeafSkewMax);
  const rotationalSymmetry = getParamValue(params, LPK.RotationalSymmetry);
  const rotationClustering = getParamValue(params, LPK.RotationClustering);
  const rotationRand = getParamValue(params, LPK.RotationRand);
  const nodeDistance = getParamValue(params, LPK.NodeDistance);
  const nodeInitialY = getParamValue(params, LPK.NodeInitialY);
  const stemLengthIncrease = getParamValue(params, LPK.StemLengthIncrease);
  const stemLengthRand = getParamValue(params, LPK.StemLengthRand);
  const stemFlopLower = getParamValue(params, LPK.StemFlopLower);
  const stemFlopRand = getParamValue(params, LPK.StemFlopRand);

  // Get pot scale using helper
  const potScaleValue = getPotScale(params);
  const potYAdd = getPotYAdd(params);

  const arrangements: ArrangementData[] = [];

  // Original C# rotation calculation
  // angleMax = 360 * (1 - RotationClustering)
  // angleStart = 90 - (angleMax / 2)
  const angleMax = 360 * (1 - rotationClustering);
  const angleStart = 90 - angleMax / 2;

  // Symmetry
  let sym = Math.round(rotationalSymmetry);
  if (sym === 0) sym = 1;

  // Starting Y position (matches original: NodeInitialY + potYAdd)
  let yPos = nodeInitialY + potYAdd;

  // Random rotation base (matches original)
  const randRotationBase = 90;

  for (let i = 0; i < count; i++) {
    // fullPerc: 0 to 1 from first to last leaf (for scale)
    // Original: (float)i / (count - 1f), or 1 if count == 1
    const fullPerc = count === 1 ? 1 : i / (count - 1);

    // mostPerc: 0 to ~1 for rotation (doesn't reach 1)
    // Original: (float)i / count
    const mostPerc = i / count;

    // Random rotation amount
    const randRange = randRotationBase * rotationRand;
    const rand = random.rangeAdd(randRange);

    // Scale calculation (matches original)
    // scale = (1 - ScaleMin) * fullPerc + ScaleMin
    // Then multiply by LeafScale and add random variation
    let scale = count === 1 ? 1 : (1 - scaleMin) * fullPerc + scaleMin;
    scale *= leafScale;
    scale += random.rangeAdd(0.25 * scaleRand);

    // Symmetry angle addition (matches original)
    let symAngleAdd = (360 / sym) * (i % sym);
    if (sym === 2) symAngleAdd += 90;
    if (sym === 3) symAngleAdd += 180;

    // Stem Y angle in degrees (matches original)
    const stemYAngle = mostPerc * angleMax + symAngleAdd + rand + angleStart;

    // Get trunk point at current Y position
    let trunkPoint: Point3D;
    if ("getPointFromY" in trunk) {
      trunkPoint = trunk.getPointFromY(yPos);
    } else {
      // Fallback: evaluate trunk curve at approximate t
      const trunkCurve = trunk.curves[0];
      const trunkHeight = trunkCurve.p1.y - trunkCurve.p0.y;
      const t = trunkHeight > 0 ? yPos / trunkHeight : 0;
      trunkPoint = evaluateCurve3D(trunkCurve, Math.max(0, Math.min(1, t)));
    }

    // Position uses trunk XZ and current yPos
    const pos: Point3D = {
      x: trunkPoint.x,
      y: yPos,
      z: trunkPoint.z,
    };

    // Extra flop for lower (earlier) leaves
    // Original: extraFlop = StemFlopLower * (1 - fullPerc) * 45
    const extraFlop = stemFlopLower * (1 - fullPerc) * 45;

    // Leaf Z angle (skew)
    const leafZAngle = random.range(-leafSkewMax, leafSkewMax);

    // Stem length modifiers (matches original)
    // stemLengthAdd = StemLengthIncrease * (i / (count - 1))
    const stemLengthAdd =
      count <= 1 ? 0 : stemLengthIncrease * (i / (count - 1));
    const stemLengthMult = 1 + random.rangeAdd(stemLengthRand * 0.3);

    // Stem flop modifiers (matches original)
    const stemFlopMult = 1 + random.rangeAdd(stemFlopRand);
    const stemFlopAdd = extraFlop;

    // Create quaternion from Y rotation in degrees
    const stemRotation = quaternionFromEuler(0, stemYAngle * DEG_TO_RAD, 0);

    arrangements.push({
      pos,
      stemRotation,
      leafZAngle,
      scale,
      stemLengthAdd,
      stemLengthMult,
      stemFlopMult,
      stemFlopAdd,
      potScale: potScaleValue,
    });

    // Move to next node position (matches original: yPos += NodeDistance)
    yPos += nodeDistance;
  }

  return arrangements;
}

// =============================================================================
// COLLISION DETECTION
// =============================================================================

interface AABB {
  min: Point3D;
  max: Point3D;
}

/**
 * Transform AABB by position, rotation, and scale
 */
function transformAABB(
  aabb: AABB,
  position: Point3D,
  rotation: Quaternion,
  scale: number,
): AABB {
  // Get all 8 corners of the AABB
  const corners: Point3D[] = [
    { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
    { x: aabb.max.x, y: aabb.min.y, z: aabb.min.z },
    { x: aabb.min.x, y: aabb.max.y, z: aabb.min.z },
    { x: aabb.max.x, y: aabb.max.y, z: aabb.min.z },
    { x: aabb.min.x, y: aabb.min.y, z: aabb.max.z },
    { x: aabb.max.x, y: aabb.min.y, z: aabb.max.z },
    { x: aabb.min.x, y: aabb.max.y, z: aabb.max.z },
    { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z },
  ];

  // Transform each corner
  const transformedCorners = corners.map((corner) => {
    // Scale
    const scaled = mul3D(corner, scale);
    // Rotate
    const rotated = rotateByQuaternion(scaled, rotation);
    // Translate
    return add3D(rotated, position);
  });

  // Calculate new AABB
  return {
    min: {
      x: Math.min(...transformedCorners.map((c) => c.x)),
      y: Math.min(...transformedCorners.map((c) => c.y)),
      z: Math.min(...transformedCorners.map((c) => c.z)),
    },
    max: {
      x: Math.max(...transformedCorners.map((c) => c.x)),
      y: Math.max(...transformedCorners.map((c) => c.y)),
      z: Math.max(...transformedCorners.map((c) => c.z)),
    },
  };
}

/**
 * Check if two AABBs intersect
 */
function aabbIntersects(a: AABB, b: AABB): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}

/**
 * Calculate separation vector between two AABBs
 */
function calculateSeparation(a: AABB, b: AABB): Point3D {
  const overlapX = Math.min(a.max.x - b.min.x, b.max.x - a.min.x);
  const overlapY = Math.min(a.max.y - b.min.y, b.max.y - a.min.y);
  const overlapZ = Math.min(a.max.z - b.min.z, b.max.z - a.min.z);

  // Find minimum overlap axis
  if (overlapX <= overlapY && overlapX <= overlapZ) {
    const sign = (a.min.x + a.max.x) / 2 < (b.min.x + b.max.x) / 2 ? -1 : 1;
    return { x: overlapX * sign, y: 0, z: 0 };
  } else if (overlapY <= overlapZ) {
    const sign = (a.min.y + a.max.y) / 2 < (b.min.y + b.max.y) / 2 ? -1 : 1;
    return { x: 0, y: overlapY * sign, z: 0 };
  } else {
    const sign = (a.min.z + a.max.z) / 2 < (b.min.z + b.max.z) / 2 ? -1 : 1;
    return { x: 0, y: 0, z: overlapZ * sign };
  }
}

/**
 * Apply physics-based collision avoidance to leaf bundles
 */
export function applyCollisionAvoidance(
  bundles: LeafBundle[],
  baseAABB: AABB,
  params: LeafParamDict,
  iterations: number = 5,
): void {
  const physicsAmp = getParamValue(params, LPK.PhysicsAmplification);

  if (physicsAmp < 0.01) return;

  // Maximum adjustment per iteration to prevent massive separations
  const maxAdjustmentPerIter = 0.1;
  // Maximum total adjustment to keep bundles attached to trunk
  const maxTotalAdjustment = 0.3;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < bundles.length; i++) {
      const bundleA = bundles[i];
      if (!bundleA.visible) continue;

      // Calculate transformed AABB for bundle A
      const aabbA = transformAABB(
        baseAABB,
        add3D(bundleA.arrangementData.pos, bundleA.collisionAdjustment),
        bundleA.arrangementData.stemRotation,
        bundleA.arrangementData.scale,
      );

      for (let j = i + 1; j < bundles.length; j++) {
        const bundleB = bundles[j];
        if (!bundleB.visible) continue;

        // Calculate transformed AABB for bundle B
        const aabbB = transformAABB(
          baseAABB,
          add3D(bundleB.arrangementData.pos, bundleB.collisionAdjustment),
          bundleB.arrangementData.stemRotation,
          bundleB.arrangementData.scale,
        );

        // Check intersection
        if (aabbIntersects(aabbA, aabbB)) {
          // Calculate separation
          const separation = calculateSeparation(aabbA, aabbB);
          let halfSep = mul3D(separation, physicsAmp * 0.5);

          // Clamp adjustment per iteration
          const sepLen = Math.sqrt(
            halfSep.x * halfSep.x +
              halfSep.y * halfSep.y +
              halfSep.z * halfSep.z,
          );
          if (sepLen > maxAdjustmentPerIter) {
            const scale = maxAdjustmentPerIter / sepLen;
            halfSep = mul3D(halfSep, scale);
          }

          // Apply to both bundles (move apart)
          bundleA.collisionAdjustment = add3D(
            bundleA.collisionAdjustment,
            halfSep,
          );
          bundleB.collisionAdjustment = sub3D(
            bundleB.collisionAdjustment,
            halfSep,
          );
        }
      }
    }
  }

  // Clamp total adjustments to keep bundles near trunk
  for (const bundle of bundles) {
    const adj = bundle.collisionAdjustment;
    const totalLen = Math.sqrt(adj.x * adj.x + adj.y * adj.y + adj.z * adj.z);
    if (totalLen > maxTotalAdjustment) {
      const scale = maxTotalAdjustment / totalLen;
      bundle.collisionAdjustment = mul3D(adj, scale);
    }
  }
}
