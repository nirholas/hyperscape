/**
 * LeafShape - Procedural leaf outline generation
 *
 * Generates leaf outlines using cubic Bezier curves with various
 * shape modifications:
 * - Gen 0: Pudge, Sheer, Scale, Tip
 * - Gen 1: Heart shape (sinuses)
 * - Gen 2: Lobes
 * - Gen 3: Scoop
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type {
  Point2D,
  LeafCurve,
  LeafParamDict,
  LeafShapeData,
} from "../types.js";
import { LeafCurveType as LCT, LPK } from "../types.js";
import {
  createDefaultLeafCurve,
  setTip,
  subdivideLeafCurve,
  mirrorCurves,
  rebuildCurveJoins,
  joinCurveEnds,
  curvesIntersect,
  findCurveByType,
  flattenJunctionAngle,
  getHandlesInnerAngle,
  sliceLeafCurve,
  getPercentFromPoint,
  findCurveApex,
} from "./LeafCurve.js";
import { clone2D } from "../math/Vector.js";
import { addPolar, polar, PI } from "../math/Polar.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Base parameters for leaf shape generation
 */
export interface LeafShapeConfig {
  baseWidth: number;
  baseHeight: number;
}

const DEFAULT_CONFIG: LeafShapeConfig = {
  baseWidth: 1,
  baseHeight: 3,
};

// =============================================================================
// LEAF SHAPE GENERATOR
// =============================================================================

/**
 * Generate a complete leaf shape from parameters
 */
export function generateLeafShape(
  params: LeafParamDict,
  config: LeafShapeConfig = DEFAULT_CONFIG,
): LeafShapeData {
  // Initialize with default curve
  const curves: LeafCurve[] = [
    createDefaultLeafCurve(config.baseWidth, config.baseHeight),
  ];

  // Gen 0 transformations
  applyPudge(curves, params, config);
  applySheer(curves, params, config);
  applyScale(curves, params, config);
  applyTip(curves, params);

  // Gen 1 - Heart shape
  applyHeart(curves, params, config);

  // Gen 2 - Lobes
  applyLobes(curves, params);

  // Gen 3 - Scoop
  applyScoop(curves, params);

  // Mirror to create full leaf
  mirrorCurves(curves);
  joinCurveEnds(curves);

  // Handle self-intersections
  findAndFixIntersections(curves);

  return { curves };
}

// =============================================================================
// GEN 0 TRANSFORMATIONS
// =============================================================================

/**
 * Apply pudge (bulge) to the leaf shape
 *
 * From original C# LeafCurve.cs:
 * public float Pudge {
 *   set {
 *     h0.y = value * (p1.y - p0.y);
 *     h1.y = (1 - value) * (p1.y - p0.y);
 *   }
 * }
 */
function applyPudge(
  curves: LeafCurve[],
  params: LeafParamDict,
  config: LeafShapeConfig,
): void {
  const param = params[LPK.Pudge];
  if (!param.enabled) return;

  const curve = findCurveByType(curves, LCT.FullSide);
  if (!curve) return;

  // Original C#: value = param.value / -baseHeight
  const value = param.value / -config.baseHeight;

  // Original C#: h0.y = value * (p1.y - p0.y); h1.y = (1 - value) * (p1.y - p0.y)
  const heightDiff = curve.p1.y - curve.p0.y;
  curve.h0.y = value * heightDiff;
  curve.h1.y = (1 - value) * heightDiff;
}

/**
 * Apply sheer (slant) to the leaf shape
 *
 * From original C# LeafCurve.cs:
 * public void Sheer(float val, float baseWidth) {
 *   h0.x = baseWidth * val * 2f;
 *   h1.x = baseWidth * (1 - val) * 2f;
 * }
 */
function applySheer(
  curves: LeafCurve[],
  params: LeafParamDict,
  config: LeafShapeConfig,
): void {
  const param = params[LPK.Sheer];
  if (!param.enabled) return;

  const curve = findCurveByType(curves, LCT.FullSide);
  if (!curve) return;

  // Original C# implementation
  curve.h0.x = config.baseWidth * param.value * 2;
  curve.h1.x = config.baseWidth * (1 - param.value) * 2;
}

/**
 * Apply width and length scaling
 *
 * From original C# Curve.cs:
 * LengthExtent: multiplies all points by (1, value)
 * WidthExtent: multiplies all points by (value, 1)
 */
function applyScale(
  curves: LeafCurve[],
  params: LeafParamDict,
  config: LeafShapeConfig,
): void {
  const lengthParam = params[LPK.Length];
  const widthParam = params[LPK.Width];

  const curve = findCurveByType(curves, LCT.FullSide);
  if (!curve) return;

  // Length scaling - original C#: value = length.value / -baseHeight
  // Then multiply ALL points Y coordinates by value
  if (lengthParam.enabled) {
    const lengthScale = lengthParam.value / -config.baseHeight;
    curve.p0.y *= lengthScale;
    curve.h0.y *= lengthScale;
    curve.h1.y *= lengthScale;
    curve.p1.y *= lengthScale;
  }

  // Width scaling - original C#: value = width.value / baseWidth
  // Then multiply ALL points X coordinates by value
  if (widthParam.enabled) {
    const widthScale = widthParam.value / config.baseWidth;
    curve.p0.x *= widthScale;
    curve.h0.x *= widthScale;
    curve.h1.x *= widthScale;
    curve.p1.x *= widthScale;
  }
}

/**
 * Apply tip angle and amplitude
 */
function applyTip(curves: LeafCurve[], params: LeafParamDict): void {
  const angleParam = params[LPK.TipAngle];
  const ampParam = params[LPK.TipAmplitude];

  const curve = findCurveByType(curves, LCT.FullSide);
  if (!curve) return;

  const angle = angleParam.enabled
    ? angleParam.value
    : angleParam.range.default;
  const amp = ampParam.enabled ? ampParam.value : ampParam.range.default;

  setTip(curve, angle, amp);
}

// =============================================================================
// GEN 1 - HEART SHAPE
// =============================================================================

/**
 * Apply heart shape (creates the sinus/notch at the base)
 */
function applyHeart(
  curves: LeafCurve[],
  params: LeafParamDict,
  config: LeafShapeConfig,
): void {
  const heartParam = params[LPK.Heart];
  if (heartParam.value <= 0) return;

  const baseCurve = findCurveByType(curves, LCT.FullSide, "all", false);
  if (!baseCurve) return;

  const handlesAngle = getHandlesInnerAngle(baseCurve);
  const curveIndex = curves.indexOf(baseCurve);

  // Subdivide at 0.5 to create two curves
  const { first: c0, second: c1 } = subdivideLeafCurve(baseCurve, 0.5);

  // Update types
  c0.curveType = LCT.LobeOuter;
  c1.curveType = LCT.LowerHalf;

  // Replace original curve with the two new curves
  curves.splice(curveIndex, 1, c0, c1);

  // Get parameters
  const width = params[LPK.Width].value;
  const length = params[LPK.Length].value;
  const thirdLen = length / 3;

  // Update the junction point
  const junctionPoint: Point2D = { x: width, y: -length / 3 };
  c0.p1 = clone2D(junctionPoint);
  c1.p0 = clone2D(junctionPoint);

  // Flatten the angle at the junction
  flattenJunctionAngle(c0, c1, config.baseWidth);

  // Apply heart parameters
  const sinusHeight = params[LPK.SinusHeight].value;
  const sinusSheer = params[LPK.SinusSheer].value;
  const waistAmp = thirdLen * params[LPK.WaistAmp].value;
  const waistAmpOffset = params[LPK.WaistAmpOffset].value + 1;

  // Adjust handles for the waist
  c0.h1 = addPolar(c0.p1, polar(-waistAmp * waistAmpOffset, handlesAngle));
  c1.h0 = addPolar(
    c1.p0,
    polar(-waistAmp * (2 - waistAmpOffset), handlesAngle + PI),
  );

  // Set the sinus curve
  c0.h0 = { x: sinusSheer * width, y: sinusHeight * thirdLen };

  // Rebuild curve joins
  rebuildCurveJoins(curves);
}

// =============================================================================
// GEN 2 - LOBES
// =============================================================================

/**
 * Apply lobes to the leaf shape
 */
function applyLobes(curves: LeafCurve[], params: LeafParamDict): void {
  const lobeParam = params[LPK.Lobes];
  const heartParam = params[LPK.Heart];

  // Lobes require heart shape
  if (lobeParam.value <= 0 || heartParam.value <= 0) return;

  const baseCurve = findCurveByType(curves, LCT.LobeOuter);
  if (!baseCurve) return;

  // Find the point where the tangent is horizontal (apex of the lobe)
  const subpoint = findCurveApex(baseCurve);

  // Subdivide at that point
  const curveIndex = curves.indexOf(baseCurve);
  const { first: c0, second: c1 } = subdivideLeafCurve(baseCurve, subpoint);

  c0.curveType = LCT.LobeInner;
  c1.curveType = LCT.LobeOuter;

  curves.splice(curveIndex, 1, c0, c1);

  // Apply lobe parameters
  const lobeTilt = (360 - params[LPK.LobeTilt].value) * (PI / 180);
  const lobeAmp = params[LPK.LobeAmplitude].value;
  const lobeAmpOffset = params[LPK.LobeAmpOffset].value + 1;

  // Adjust handles
  c0.h1 = addPolar(c0.p1, polar(-lobeAmp * lobeAmpOffset, lobeTilt));
  c1.h0 = addPolar(c1.p0, polar(-lobeAmp * (2 - lobeAmpOffset), lobeTilt + PI));

  rebuildCurveJoins(curves);
}

// =============================================================================
// GEN 3 - SCOOP
// =============================================================================

/**
 * Apply scoop (indentation at the base)
 */
function applyScoop(curves: LeafCurve[], params: LeafParamDict): void {
  const depthParam = params[LPK.ScoopDepth];
  const heightParam = params[LPK.ScoopHeight];

  if (!depthParam.enabled || !heightParam.enabled) return;
  if (depthParam.value <= 0.01 || heightParam.value <= 0.01) return;

  const baseCurve = findCurveByType(curves, LCT.LobeInner);
  if (!baseCurve) return;

  // Don't apply scoop to simple leaves
  if (baseCurve.curveType === LCT.FullSide) return;

  const originalType = baseCurve.curveType;
  const curveIndex = curves.indexOf(baseCurve);

  // Subdivide at scoop depth
  const { first: c0, second: c1 } = subdivideLeafCurve(
    baseCurve,
    depthParam.value,
  );

  c0.curveType = LCT.Scoop;
  c1.curveType = originalType;

  curves.splice(curveIndex, 1, c0, c1);

  // Adjust scoop curve
  c0.p0.y += 0.5 * (c1.p0.y * 0.8);
  c0.h0.y = c0.p0.y + 0.01;
  c0.h1.y = (c1.p0.y - c0.p0.y) / 2 + c0.p0.y;

  rebuildCurveJoins(curves);
}

// =============================================================================
// INTERSECTION HANDLING
// =============================================================================

/**
 * Find and fix self-intersections in the leaf outline
 */
function findAndFixIntersections(curves: LeafCurve[]): void {
  if (curves.length < 4) return;

  const halfCount = Math.floor(curves.length / 2);
  const rightSide = curves.slice(0, halfCount);
  const leftSide = curves.slice(halfCount).reverse();

  for (let i = 0; i < rightSide.length; i++) {
    const rightCurve = rightSide[i];

    for (let j = 0; j < leftSide.length; j++) {
      const leftCurve = leftSide[j];

      const skipEndpoints = i === 0 && j === 0;
      const result = curvesIntersect(rightCurve, leftCurve, 4, skipEndpoints);

      if (result.intersects) {
        const point = result.point;

        // Skip if at endpoints
        if (
          (point.x === rightCurve.p0.x && point.y === rightCurve.p0.y) ||
          (point.x === rightCurve.p1.x && point.y === rightCurve.p1.y)
        ) {
          continue;
        }

        // Get percentages
        const p1 = getPercentFromPoint(rightCurve, point);
        const p2 = getPercentFromPoint(leftCurve, point);

        if (rightCurve.curveType === LCT.Scoop) {
          // Slice curves to remove the intersection
          const newRight = sliceLeafCurve(rightCurve, p1, 1);
          const newLeft = sliceLeafCurve(leftCurve, 0, p2);

          const rightIndex = curves.indexOf(rightCurve);
          const leftIndex = curves.indexOf(leftCurve);

          curves[rightIndex] = newRight;
          curves[leftIndex] = newLeft;
        } else if (rightCurve.curveType === LCT.LobeInner) {
          const newRight = sliceLeafCurve(rightCurve, p1, 1);
          const newLeft = sliceLeafCurve(leftCurve, 0, p2);

          // Remove the intersecting curves and replace
          const rightIndex = curves.indexOf(rightCurve);
          const leftIndex = curves.indexOf(leftCurve);

          // Handle the removal carefully
          if (rightIndex < leftIndex) {
            curves.splice(leftIndex, 1);
            curves.splice(rightIndex, 1);
          } else {
            curves.splice(rightIndex, 1);
            curves.splice(leftIndex, 1);
          }

          // Insert at the correct positions
          curves.splice(0, 0, newRight);
          curves.push(newLeft);
        }

        rebuildCurveJoins(curves);
        return; // Only fix first intersection
      }
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get the curves from a LeafShapeData
 */
export function getShapeCurves(shape: LeafShapeData): LeafCurve[] {
  return shape.curves;
}

/**
 * Get the number of curves in a shape
 */
export function getShapeCurveCount(shape: LeafShapeData): number {
  return shape.curves.length;
}

/**
 * Find a curve by type in the shape
 */
export function findShapeCurve(
  shape: LeafShapeData,
  type: LCT,
  side: "all" | "left" | "right" = "all",
): LeafCurve | null {
  return findCurveByType(shape.curves, type, side);
}
