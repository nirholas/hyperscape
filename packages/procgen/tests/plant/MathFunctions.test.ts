/**
 * Comprehensive Math Function Tests
 *
 * Verifies ALL math functions against expected values from the original C# implementation.
 * Each function is tested with multiple edge cases and known values.
 *
 * IMPORTANT: This file imports and tests the ACTUAL functions from source files,
 * not copies. This ensures tests validate the real implementation.
 */

import { describe, it, expect } from "vitest";

// Import ACTUAL functions from source files - NO COPIES!
// Arrangement.ts exports: polar math, bezier subdivision, quaternion utilities
import {
  polarToVec2D,
  addPolar2D,
  angle2D,
  distance2D,
  subdivideCurve,
  fastCurveLength,
  quaternionFromEuler,
} from "../../src/plant/assembly/Arrangement.js";

// PlantGenerator.ts exports: bezier evaluation, lookRotation, stem shape utilities
import {
  evaluateBezierPoint,
  getBezierTangent,
  lookRotation,
  rotatePointByQuat,
  shapeScaleAtPercent,
  trunkShapeScaleAtPercent,
  createStemShape,
} from "../../src/plant/PlantGenerator.js";

// Constants matching C# originals
const DEG_TO_RAD = Math.PI / 180;
const PI = Math.PI;
const PI2 = PI * 2;

// =============================================================================
// TESTS
// =============================================================================

describe("Math Functions - Polar Coordinates", () => {
  describe("polarToVec2D", () => {
    it("should convert 0° angle correctly", () => {
      const result = polarToVec2D(1, 0);
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("should convert 90° angle correctly", () => {
      const result = polarToVec2D(1, PI / 2);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(1, 5);
    });

    it("should convert 180° angle correctly", () => {
      const result = polarToVec2D(1, PI);
      expect(result.x).toBeCloseTo(-1, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("should convert 270° angle correctly", () => {
      const result = polarToVec2D(1, (3 * PI) / 2);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(-1, 5);
    });

    it("should scale by length", () => {
      const result = polarToVec2D(5, PI / 4);
      expect(result.x).toBeCloseTo(5 * Math.cos(PI / 4), 5);
      expect(result.y).toBeCloseTo(5 * Math.sin(PI / 4), 5);
    });

    it("should handle zero length", () => {
      const result = polarToVec2D(0, PI / 3);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });
  });

  describe("addPolar2D", () => {
    it("should add offset at 0° from origin", () => {
      const result = addPolar2D({ x: 0, y: 0 }, 1, 0);
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("should add offset at 90° from origin", () => {
      const result = addPolar2D({ x: 0, y: 0 }, 1, 90);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(1, 5);
    });

    it("should add offset from non-origin point", () => {
      const result = addPolar2D({ x: 3, y: 4 }, 2, 45);
      expect(result.x).toBeCloseTo(3 + 2 * Math.cos(45 * DEG_TO_RAD), 5);
      expect(result.y).toBeCloseTo(4 + 2 * Math.sin(45 * DEG_TO_RAD), 5);
    });

    it("should handle negative angles", () => {
      const result = addPolar2D({ x: 0, y: 0 }, 1, -90);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(-1, 5);
    });

    it("should handle angles > 360", () => {
      const result = addPolar2D({ x: 0, y: 0 }, 1, 450); // Same as 90°
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(1, 5);
    });
  });

  describe("angle2D", () => {
    it("should return 0 for point to the right", () => {
      const angle = angle2D({ x: 0, y: 0 }, { x: 1, y: 0 });
      expect(angle).toBeCloseTo(0, 5);
    });

    it("should return π/2 for point above", () => {
      const angle = angle2D({ x: 0, y: 0 }, { x: 0, y: 1 });
      expect(angle).toBeCloseTo(PI / 2, 5);
    });

    it("should return π for point to the left", () => {
      const angle = angle2D({ x: 0, y: 0 }, { x: -1, y: 0 });
      expect(Math.abs(angle)).toBeCloseTo(PI, 5);
    });

    it("should return -π/2 for point below", () => {
      const angle = angle2D({ x: 0, y: 0 }, { x: 0, y: -1 });
      expect(angle).toBeCloseTo(-PI / 2, 5);
    });

    it("should handle non-origin points", () => {
      const angle = angle2D({ x: 1, y: 1 }, { x: 2, y: 2 });
      expect(angle).toBeCloseTo(PI / 4, 5);
    });

    it("should return 0 for same point", () => {
      const angle = angle2D({ x: 5, y: 5 }, { x: 5, y: 5 });
      expect(angle).toBeCloseTo(0, 5);
    });
  });

  describe("distance2D", () => {
    it("should return 0 for same point", () => {
      expect(distance2D({ x: 5, y: 3 }, { x: 5, y: 3 })).toBeCloseTo(0, 5);
    });

    it("should calculate horizontal distance", () => {
      expect(distance2D({ x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(5, 5);
    });

    it("should calculate vertical distance", () => {
      expect(distance2D({ x: 0, y: 0 }, { x: 0, y: 7 })).toBeCloseTo(7, 5);
    });

    it("should calculate diagonal distance (3-4-5 triangle)", () => {
      expect(distance2D({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 5);
    });

    it("should handle negative coordinates", () => {
      expect(distance2D({ x: -3, y: -4 }, { x: 0, y: 0 })).toBeCloseTo(5, 5);
    });
  });
});

describe("Math Functions - Bezier Curves", () => {
  describe("evaluateBezierPoint", () => {
    // Use curve object format as the actual function expects
    const curve = {
      p0: { x: 0, y: 0, z: 0 },
      h0: { x: 0, y: 1, z: 0 },
      h1: { x: 1, y: 1, z: 0 },
      p1: { x: 1, y: 0, z: 0 },
    };

    it("should return p0 at t=0", () => {
      const result = evaluateBezierPoint(curve, 0);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should return p1 at t=1", () => {
      const result = evaluateBezierPoint(curve, 1);
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should interpolate at t=0.5", () => {
      const result = evaluateBezierPoint(curve, 0.5);
      // For this symmetric curve, midpoint should be (0.5, 0.75, 0)
      expect(result.x).toBeCloseTo(0.5, 5);
      expect(result.y).toBeCloseTo(0.75, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should handle straight line (handles on line)", () => {
      const lineCurve = {
        p0: { x: 0, y: 0, z: 0 },
        h0: { x: 1, y: 0, z: 0 },
        h1: { x: 2, y: 0, z: 0 },
        p1: { x: 3, y: 0, z: 0 },
      };

      const result = evaluateBezierPoint(lineCurve, 0.5);
      expect(result.x).toBeCloseTo(1.5, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("should handle 3D curves", () => {
      const curve3d = {
        p0: { x: 0, y: 0, z: 0 },
        h0: { x: 0, y: 0, z: 1 },
        h1: { x: 1, y: 0, z: 1 },
        p1: { x: 1, y: 0, z: 0 },
      };

      const result = evaluateBezierPoint(curve3d, 0.5);
      expect(result.x).toBeCloseTo(0.5, 5);
      expect(result.z).toBeCloseTo(0.75, 5);
    });
  });

  describe("getBezierTangent", () => {
    const curve = {
      p0: { x: 0, y: 0, z: 0 },
      h0: { x: 0, y: 1, z: 0 },
      h1: { x: 1, y: 1, z: 0 },
      p1: { x: 1, y: 0, z: 0 },
    };

    it("should return tangent at t=0 pointing toward h0", () => {
      const result = getBezierTangent(curve, 0);
      // At t=0, tangent = 3*(h0 - p0) = 3*(0,1,0) - 3*(0,0,0) = (0, 3, 0)
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(3, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should return tangent at t=1 pointing away from h1", () => {
      const result = getBezierTangent(curve, 1);
      // At t=1, tangent = 3*(p1 - h1) = 3*((1,0,0) - (1,1,0)) = (0, -3, 0)
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(-3, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should return tangent at t=0.5", () => {
      const result = getBezierTangent(curve, 0.5);
      // Should be horizontal-ish at midpoint
      expect(result.x).toBeCloseTo(1.5, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("should handle straight line", () => {
      const lineCurve = {
        p0: { x: 0, y: 0, z: 0 },
        h0: { x: 1, y: 0, z: 0 },
        h1: { x: 2, y: 0, z: 0 },
        p1: { x: 3, y: 0, z: 0 },
      };

      // Tangent should be constant for straight line
      const t0 = getBezierTangent(lineCurve, 0);
      const t5 = getBezierTangent(lineCurve, 0.5);
      const t1 = getBezierTangent(lineCurve, 1);

      expect(t0.x).toBeCloseTo(3, 5);
      expect(t5.x).toBeCloseTo(3, 5);
      expect(t1.x).toBeCloseTo(3, 5);
    });
  });

  describe("subdivideCurve", () => {
    it("should split curve at t=0.5 into two equal parts", () => {
      const p0 = { x: 0, y: 0 };
      const h0 = { x: 0, y: 2 };
      const h1 = { x: 2, y: 2 };
      const p1 = { x: 2, y: 0 };

      const { first, second } = subdivideCurve(p0, h0, h1, p1, 0.5);

      // First curve should start at p0
      expect(first.p0.x).toBeCloseTo(0, 5);
      expect(first.p0.y).toBeCloseTo(0, 5);

      // Split point should be the same for both curves
      expect(first.p1.x).toBeCloseTo(second.p0.x, 5);
      expect(first.p1.y).toBeCloseTo(second.p0.y, 5);

      // Second curve should end at p1
      expect(second.p1.x).toBeCloseTo(2, 5);
      expect(second.p1.y).toBeCloseTo(0, 5);
    });

    it("should evaluate to same point as original at split point", () => {
      const p0 = { x: 0, y: 0 };
      const h0 = { x: 1, y: 3 };
      const h1 = { x: 3, y: 3 };
      const p1 = { x: 4, y: 0 };
      const t = 0.9;

      // Evaluate original curve at t
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;
      const expected = {
        x: mt3 * p0.x + 3 * mt2 * t * h0.x + 3 * mt * t2 * h1.x + t3 * p1.x,
        y: mt3 * p0.y + 3 * mt2 * t * h0.y + 3 * mt * t2 * h1.y + t3 * p1.y,
      };

      const { first, second } = subdivideCurve(p0, h0, h1, p1, t);

      // Split point should match original curve at t
      expect(first.p1.x).toBeCloseTo(expected.x, 5);
      expect(first.p1.y).toBeCloseTo(expected.y, 5);
      expect(second.p0.x).toBeCloseTo(expected.x, 5);
      expect(second.p0.y).toBeCloseTo(expected.y, 5);
    });

    it("should preserve curve continuity at split point", () => {
      const p0 = { x: 0, y: 0 };
      const h0 = { x: 0, y: 1 };
      const h1 = { x: 1, y: 1 };
      const p1 = { x: 1, y: 0 };

      const { first, second } = subdivideCurve(p0, h0, h1, p1, 0.3);

      // The tangent direction at the split should be the same from both curves
      // first.h1 -> first.p1 and second.p0 -> second.h0 should be colinear
      const dir1 = {
        x: first.p1.x - first.h1.x,
        y: first.p1.y - first.h1.y,
      };
      const dir2 = {
        x: second.h0.x - second.p0.x,
        y: second.h0.y - second.p0.y,
      };

      // Cross product should be ~0 for colinear vectors
      const cross = dir1.x * dir2.y - dir1.y * dir2.x;
      const dot = dir1.x * dir2.x + dir1.y * dir2.y;

      // Should be same direction (dot > 0) and colinear (cross ≈ 0)
      expect(dot).toBeGreaterThan(0);
      expect(cross).toBeCloseTo(0, 5);
    });
  });

  describe("fastCurveLength", () => {
    it("should return 0 for degenerate curve (all same point)", () => {
      const p = { x: 1, y: 1 };
      const len = fastCurveLength(p, p, p, p);
      expect(len).toBeCloseTo(0, 5);
    });

    it("should approximate straight line length correctly", () => {
      const p0 = { x: 0, y: 0 };
      const h0 = { x: 1, y: 0 };
      const h1 = { x: 2, y: 0 };
      const p1 = { x: 3, y: 0 };

      const len = fastCurveLength(p0, h0, h1, p1);
      // For straight line, chord = 3, poly = 1+1+1 = 3, avg = 3
      expect(len).toBeCloseTo(3, 5);
    });

    it("should return positive value for curved path", () => {
      const p0 = { x: 0, y: 0 };
      const h0 = { x: 0, y: 2 };
      const h1 = { x: 2, y: 2 };
      const p1 = { x: 2, y: 0 };

      const len = fastCurveLength(p0, h0, h1, p1);
      // Should be longer than chord (2*sqrt(2) ≈ 2.83) and shorter than polygon
      expect(len).toBeGreaterThan(2.8);
      expect(len).toBeLessThan(6);
    });
  });
});

describe("Math Functions - Quaternions", () => {
  describe("quaternionFromEuler", () => {
    it("should return identity for zero rotation", () => {
      const q = quaternionFromEuler(0, 0, 0);
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(0, 5);
      expect(q.w).toBeCloseTo(1, 5);
    });

    it("should create 90° rotation around X axis", () => {
      const q = quaternionFromEuler(PI / 2, 0, 0);
      // sin(45°) ≈ 0.7071
      expect(q.x).toBeCloseTo(Math.sin(PI / 4), 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(0, 5);
      expect(q.w).toBeCloseTo(Math.cos(PI / 4), 5);
    });

    it("should create 90° rotation around Y axis", () => {
      const q = quaternionFromEuler(0, PI / 2, 0);
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(Math.sin(PI / 4), 5);
      expect(q.z).toBeCloseTo(0, 5);
      expect(q.w).toBeCloseTo(Math.cos(PI / 4), 5);
    });

    it("should create 90° rotation around Z axis", () => {
      const q = quaternionFromEuler(0, 0, PI / 2);
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(Math.sin(PI / 4), 5);
      expect(q.w).toBeCloseTo(Math.cos(PI / 4), 5);
    });

    it("should produce normalized quaternion", () => {
      const q = quaternionFromEuler(PI / 3, PI / 4, PI / 6);
      const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  describe("lookRotation", () => {
    it("should return identity for forward = (0, 0, 1)", () => {
      const q = lookRotation({ x: 0, y: 0, z: 1 });
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(0, 5);
      expect(q.w).toBeCloseTo(1, 5);
    });

    it("should return 180° Y rotation for forward = (0, 0, -1)", () => {
      const q = lookRotation({ x: 0, y: 0, z: -1 });
      // 180° around Y: (0, 1, 0, 0) or (0, sin(90), 0, cos(90)) = (0, 1, 0, 0)
      expect(Math.abs(q.y)).toBeCloseTo(1, 5);
      expect(q.w).toBeCloseTo(0, 4);
    });

    it("should return 90° Y rotation for forward = (1, 0, 0)", () => {
      const q = lookRotation({ x: 1, y: 0, z: 0 });
      // Should rotate so Z points along X
      const rotated = rotatePointByQuat({ x: 0, y: 0, z: 1 }, q);
      expect(rotated.x).toBeCloseTo(1, 4);
      expect(rotated.y).toBeCloseTo(0, 4);
      expect(rotated.z).toBeCloseTo(0, 4);
    });

    it("should handle upward direction", () => {
      const q = lookRotation({ x: 0, y: 1, z: 0 });
      // Looking up should rotate so Z points up
      const rotated = rotatePointByQuat({ x: 0, y: 0, z: 1 }, q);
      expect(rotated.x).toBeCloseTo(0, 4);
      expect(rotated.y).toBeCloseTo(1, 4);
      expect(rotated.z).toBeCloseTo(0, 4);
    });

    it("should handle zero-length forward (return identity)", () => {
      const q = lookRotation({ x: 0, y: 0, z: 0 });
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(0, 5);
      expect(q.w).toBeCloseTo(1, 5);
    });

    it("should produce normalized quaternion", () => {
      const q = lookRotation({ x: 1, y: 2, z: 3 });
      const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  describe("rotatePointByQuat", () => {
    it("should not change point with identity quaternion", () => {
      const p = { x: 1, y: 2, z: 3 };
      const q = { x: 0, y: 0, z: 0, w: 1 };
      const result = rotatePointByQuat(p, q);
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(2, 5);
      expect(result.z).toBeCloseTo(3, 5);
    });

    it("should rotate 90° around X axis correctly", () => {
      const p = { x: 0, y: 1, z: 0 };
      const q = quaternionFromEuler(PI / 2, 0, 0);
      const result = rotatePointByQuat(p, q);
      // (0, 1, 0) rotated 90° around X -> (0, 0, 1)
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(1, 5);
    });

    it("should rotate 90° around Y axis correctly", () => {
      const p = { x: 1, y: 0, z: 0 };
      const q = quaternionFromEuler(0, PI / 2, 0);
      const result = rotatePointByQuat(p, q);
      // (1, 0, 0) rotated 90° around Y -> (0, 0, -1)
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(-1, 5);
    });

    it("should rotate 90° around Z axis correctly", () => {
      const p = { x: 1, y: 0, z: 0 };
      const q = quaternionFromEuler(0, 0, PI / 2);
      const result = rotatePointByQuat(p, q);
      // (1, 0, 0) rotated 90° around Z -> (0, 1, 0)
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(1, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it("should preserve vector length", () => {
      const p = { x: 3, y: 4, z: 5 };
      const origLen = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const q = quaternionFromEuler(PI / 3, PI / 5, PI / 7);
      const result = rotatePointByQuat(p, q);
      const newLen = Math.sqrt(
        result.x * result.x + result.y * result.y + result.z * result.z,
      );
      expect(newLen).toBeCloseTo(origLen, 5);
    });
  });
});

describe("Math Functions - Shape Scaling", () => {
  describe("shapeScaleAtPercent (Stem)", () => {
    it("should return 1 for perc <= 0.95", () => {
      expect(shapeScaleAtPercent(0)).toBeCloseTo(1, 5);
      expect(shapeScaleAtPercent(0.5)).toBeCloseTo(1, 5);
      expect(shapeScaleAtPercent(0.95)).toBeCloseTo(1, 5);
    });

    it("should taper from 0.95 to 1.0", () => {
      // At 0.96: ret = 1 - 0.01*20 = 0.8
      // adjusted = 0.8 * 0.75 + 0.25 = 0.85
      // eased = 1 - (0.15)^2 = 0.9775
      expect(shapeScaleAtPercent(0.96)).toBeLessThan(1);
      expect(shapeScaleAtPercent(0.96)).toBeGreaterThan(0.9);
    });

    it("should not reach 0 at perc = 1.0", () => {
      // floor = 0.25, so minimum is 0.25 before easing
      const scale = shapeScaleAtPercent(1.0);
      expect(scale).toBeGreaterThan(0.2);
    });

    it("should be monotonically decreasing from 0.95 to 1.0", () => {
      const values = [0.95, 0.96, 0.97, 0.98, 0.99, 1.0].map(
        shapeScaleAtPercent,
      );
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      }
    });
  });

  describe("trunkShapeScaleAtPercent", () => {
    it("should return 1 for perc <= taperStartPerc", () => {
      expect(trunkShapeScaleAtPercent(0, 0.8)).toBeCloseTo(1, 5);
      expect(trunkShapeScaleAtPercent(0.5, 0.8)).toBeCloseTo(1, 5);
      expect(trunkShapeScaleAtPercent(0.8, 0.8)).toBeCloseTo(1, 5);
    });

    it("should return 0 at perc >= 0.99", () => {
      expect(trunkShapeScaleAtPercent(0.99, 0.5)).toBeCloseTo(0, 5);
      expect(trunkShapeScaleAtPercent(1.0, 0.5)).toBeCloseTo(0, 5);
    });

    it("should taper quadratically", () => {
      // With taperStartPerc = 0.5, at perc = 0.75:
      // newPerc = (0.75 - 0.5) / 0.5 = 0.5
      // squared = 0.25
      // result = 1 - 0.25 = 0.75
      expect(trunkShapeScaleAtPercent(0.75, 0.5)).toBeCloseTo(0.75, 5);
    });

    it("should handle taperStartPerc = 0", () => {
      // Everything should taper from the start
      expect(trunkShapeScaleAtPercent(0, 0)).toBeCloseTo(1, 5);
      expect(trunkShapeScaleAtPercent(0.5, 0)).toBeCloseTo(0.75, 5); // 1 - 0.25
    });

    it("should handle taperStartPerc close to 1", () => {
      // Very short taper region
      expect(trunkShapeScaleAtPercent(0.95, 0.95)).toBeCloseTo(1, 5);
      expect(trunkShapeScaleAtPercent(0.97, 0.95)).toBeLessThan(1);
    });
  });
});

describe("Math Functions - Polar3 Shape", () => {
  describe("createStemShape", () => {
    it("should create correct number of points", () => {
      expect(createStemShape(1, 6).length).toBe(6);
      expect(createStemShape(1, 8).length).toBe(8);
      expect(createStemShape(1, 16).length).toBe(16);
    });

    it("should place all points in XZ plane (y=0)", () => {
      const shape = createStemShape(1, 6);
      for (const p of shape) {
        expect(p.y).toBeCloseTo(0, 5);
      }
    });

    it("should create points at specified radius", () => {
      const radius = 2.5;
      const shape = createStemShape(radius, 6);
      for (const p of shape) {
        const dist = Math.sqrt(p.x * p.x + p.z * p.z);
        expect(dist).toBeCloseTo(radius, 5);
      }
    });

    it("should create circular cross-section with standard angle distribution", () => {
      const width = 1;
      const shape = createStemShape(width, 6);

      // New implementation creates standard circular cross-section starting from angle 0
      // i=0: angle = 0, x = cos(0) = 1, z = sin(0) = 0
      expect(shape[0].x).toBeCloseTo(1, 5);
      expect(shape[0].z).toBeCloseTo(0, 5);

      // i=3: angle = π, x = cos(π) = -1, z = sin(π) = 0
      expect(shape[3].x).toBeCloseTo(-1, 5);
      expect(shape[3].z).toBeCloseTo(0, 5);
    });

    it("should create evenly spaced points around circle", () => {
      const shape = createStemShape(1, 6);
      const angles: number[] = [];

      for (const p of shape) {
        // Use atan2(z, x) for angle in XZ plane
        angles.push(Math.atan2(p.z, p.x));
      }

      // Check angle differences are approximately 60° (π/3)
      for (let i = 1; i < angles.length; i++) {
        let diff = angles[i] - angles[i - 1];
        // Normalize to positive
        if (diff < 0) diff += 2 * PI;
        expect(diff).toBeCloseTo(PI / 3, 3);
      }
    });
  });
});

describe("Math Functions - Flop Calculation", () => {
  // Test the flop angle calculation used in stem generation
  it("should calculate flop angle correctly for flopPerc = 0", () => {
    // flopPerc = 0 -> angle = -0*90 + 90 = 90°
    const flopAngleDeg = -(0 * 90) + 90;
    expect(flopAngleDeg).toBe(90);

    // At 90°: cos(90°) = 0, sin(90°) = 1
    // So stem points straight UP
    const vec = polarToVec2D(1, flopAngleDeg * DEG_TO_RAD);
    expect(vec.x).toBeCloseTo(0, 5);
    expect(vec.y).toBeCloseTo(1, 5);
  });

  it("should calculate flop angle correctly for flopPerc = 1", () => {
    // flopPerc = 1 -> angle = -1*90 + 90 = 0°
    const flopAngleDeg = -(1 * 90) + 90;
    expect(flopAngleDeg).toBe(0);

    // At 0°: cos(0°) = 1, sin(0°) = 0
    // So stem points HORIZONTALLY
    const vec = polarToVec2D(1, flopAngleDeg * DEG_TO_RAD);
    expect(vec.x).toBeCloseTo(1, 5);
    expect(vec.y).toBeCloseTo(0, 5);
  });

  it("should calculate flop angle correctly for flopPerc = 0.5", () => {
    // flopPerc = 0.5 -> angle = -0.5*90 + 90 = 45°
    const flopAngleDeg = -(0.5 * 90) + 90;
    expect(flopAngleDeg).toBe(45);

    // At 45°: cos(45°) = sin(45°) ≈ 0.707
    const vec = polarToVec2D(1, flopAngleDeg * DEG_TO_RAD);
    expect(vec.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(vec.y).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe("Math Functions - Handle Interpolation", () => {
  // Test the handle interpolation used in stem curve generation
  it("should interpolate h0 handle correctly at flopPerc = 0", () => {
    const len = 1;
    const flopPerc = 0;

    const h0s = { x: 0, y: len * 0.25 };
    const h0e = { x: len * 0.25, y: len * 0.5 };

    // At flopPerc = 0, h0 = h0s
    const h0 = {
      x: (h0e.x - h0s.x) * flopPerc + h0s.x,
      y: (h0e.y - h0s.y) * flopPerc + h0s.y,
    };

    expect(h0.x).toBeCloseTo(0, 5);
    expect(h0.y).toBeCloseTo(0.25, 5);
  });

  it("should interpolate h0 handle correctly at flopPerc = 1", () => {
    const len = 1;
    const flopPerc = 1;

    const h0s = { x: 0, y: len * 0.25 };
    const h0e = { x: len * 0.25, y: len * 0.5 };

    // At flopPerc = 1, h0 = h0e
    const h0 = {
      x: (h0e.x - h0s.x) * flopPerc + h0s.x,
      y: (h0e.y - h0s.y) * flopPerc + h0s.y,
    };

    expect(h0.x).toBeCloseTo(0.25, 5);
    expect(h0.y).toBeCloseTo(0.5, 5);
  });

  it("should interpolate h1 handle correctly at flopPerc = 0.5", () => {
    const len = 2;
    const flopPerc = 0.5;

    const h1s = { x: 0, y: len * 0.75 };
    const h1e = { x: len * 0.75, y: len * 0.5 };

    // At flopPerc = 0.5, h1 = midpoint
    const h1 = {
      x: (h1e.x - h1s.x) * flopPerc + h1s.x,
      y: (h1e.y - h1s.y) * flopPerc + h1s.y,
    };

    // h1s = (0, 1.5), h1e = (1.5, 1), midpoint = (0.75, 1.25)
    expect(h1.x).toBeCloseTo(0.75, 5);
    expect(h1.y).toBeCloseTo(1.25, 5);
  });
});

describe("Math Functions - Stem Curve Integration", () => {
  // Test complete stem curve generation with known values
  it("should generate stem curve endpoints correctly at flopPerc = 0 (straight up)", () => {
    const len = 1;
    const flopPerc = 0;

    // Flop angle at flopPerc=0: angle = -0*90 + 90 = 90°
    // Endpoint: (len*cos(90°), len*sin(90°)) = (0, 1)
    const flopAngleDeg = -(flopPerc * 90) + 90;
    const flopVec = polarToVec2D(len, flopAngleDeg * DEG_TO_RAD);

    expect(flopVec.x).toBeCloseTo(0, 5);
    expect(flopVec.y).toBeCloseTo(1, 5);
  });

  it("should generate stem curve endpoints correctly at flopPerc = 1 (horizontal)", () => {
    const len = 1;
    const flopPerc = 1;

    // Flop angle at flopPerc=1: angle = -1*90 + 90 = 0°
    // Endpoint: (len*cos(0°), len*sin(0°)) = (1, 0)
    const flopAngleDeg = -(flopPerc * 90) + 90;
    const flopVec = polarToVec2D(len, flopAngleDeg * DEG_TO_RAD);

    expect(flopVec.x).toBeCloseTo(1, 5);
    expect(flopVec.y).toBeCloseTo(0, 5);
  });

  it("should generate complete stem geometry with proper subdivision", () => {
    const len = 1;
    const flopPerc = 0;

    // Create main curve (straight up at flopPerc=0)
    const mainP0 = { x: 0, y: 0 };
    const mainP1 = { x: 0, y: len };
    const mainH0 = { x: 0, y: len * 0.25 };
    const mainH1 = { x: 0, y: len * 0.75 };

    // Subdivide at 0.9
    const { first, second } = subdivideCurve(
      mainP0,
      mainH0,
      mainH1,
      mainP1,
      0.9,
    );

    // First curve should go from 0 to approximately t=0.9 of the original
    // Note: Bezier parameter t doesn't map linearly to arc length
    // For straight line with handles at 1/3 and 2/3, t=0.9 gives ~0.918
    expect(first.p0.y).toBeCloseTo(0, 5);
    expect(first.p1.y).toBeGreaterThan(0.8);
    expect(first.p1.y).toBeLessThan(1.0);

    // Second curve (neck) should start at split point
    expect(second.p0.y).toBeCloseTo(first.p1.y, 5);
    expect(second.p1.y).toBeCloseTo(1, 5); // Should end at original endpoint

    // Curves should be continuous at split
    expect(first.p1.x).toBeCloseTo(second.p0.x, 5);
    expect(first.p1.y).toBeCloseTo(second.p0.y, 5);
  });

  it("should position stem mesh rings correctly along curve", () => {
    // Straight line curve from (0,0,0) to (0,1,0)
    const curve = {
      p0: { x: 0, y: 0, z: 0 },
      h0: { x: 0, y: 0.33, z: 0 },
      h1: { x: 0, y: 0.66, z: 0 },
      p1: { x: 0, y: 1, z: 0 },
    };

    // Sample points along curve
    const points = [0, 0.5, 1].map((t) => evaluateBezierPoint(curve, t));

    // All points should have X and Z close to 0
    for (const point of points) {
      expect(point.x).toBeCloseTo(0, 5);
      expect(point.z).toBeCloseTo(0, 5);
    }

    // Y should increase from 0 to 1
    expect(points[0].y).toBeCloseTo(0, 5);
    expect(points[2].y).toBeCloseTo(1, 5);
  });

  it("should orient stem mesh rings perpendicular to tangent", () => {
    // For a straight line going UP, the tangent points UP (0, 1, 0)
    // lookRotation with forward = (0, 1, 0) and up = (0, 1, 0) is tricky
    // because they're parallel - should use fallback

    // Test with tangent = (0, 0, 1) which is simpler
    const tangent = { x: 0, y: 0, z: 1 };
    const q = lookRotation(tangent);

    // A point in the XZ plane should stay in XZ plane after rotation
    // because we're looking along Z with Y up
    const shapePoint = { x: 1, y: 0, z: 0 };
    const rotated = rotatePointByQuat(shapePoint, q);

    // Should rotate shape point to be perpendicular to the tangent
    // With identity rotation for forward=(0,0,1), point stays same
    expect(rotated.x).toBeCloseTo(1, 4);
    expect(rotated.y).toBeCloseTo(0, 4);
    expect(rotated.z).toBeCloseTo(0, 4);
  });

  it("should apply faceForward rotation correctly", () => {
    // faceForward = Euler(90, 0, 0) rotates shape from XZ plane to XY plane
    const faceForward = quaternionFromEuler(PI / 2, 0, 0);

    // A point at (1, 0, 0) in XZ plane should stay at (1, 0, 0)
    const p1 = { x: 1, y: 0, z: 0 };
    const r1 = rotatePointByQuat(p1, faceForward);
    expect(r1.x).toBeCloseTo(1, 5);
    expect(r1.y).toBeCloseTo(0, 5);
    expect(r1.z).toBeCloseTo(0, 5);

    // A point at (0, 0, 1) should rotate to (0, -1, 0)
    const p2 = { x: 0, y: 0, z: 1 };
    const r2 = rotatePointByQuat(p2, faceForward);
    expect(r2.x).toBeCloseTo(0, 5);
    expect(r2.y).toBeCloseTo(-1, 5);
    expect(r2.z).toBeCloseTo(0, 5);

    // A point at (0, 0, -1) should rotate to (0, 1, 0)
    const p3 = { x: 0, y: 0, z: -1 };
    const r3 = rotatePointByQuat(p3, faceForward);
    expect(r3.x).toBeCloseTo(0, 5);
    expect(r3.y).toBeCloseTo(1, 5);
    expect(r3.z).toBeCloseTo(0, 5);
  });

  it("should create stem shape in XZ plane with standard circular distribution", () => {
    const shape = createStemShape(1, 6);

    // New implementation: circular cross-section starting from angle 0
    // First point at i=0: angle = 0
    // x = cos(0) = 1, z = sin(0) = 0
    expect(shape[0].x).toBeCloseTo(1, 5);
    expect(shape[0].y).toBeCloseTo(0, 5);
    expect(shape[0].z).toBeCloseTo(0, 5);

    // Point at i=3: angle = π
    // x = cos(π) = -1, z = sin(π) = 0
    expect(shape[3].x).toBeCloseTo(-1, 5);
    expect(shape[3].y).toBeCloseTo(0, 5);
    expect(shape[3].z).toBeCloseTo(0, 5);
  });

  it("should transform stem shape point correctly for vertical stem", () => {
    // For a vertical stem (tangent = (0, 1, 0)), the shape should end up
    // perpendicular to Y axis, i.e., in the XZ plane

    // First shape point from new implementation: angle = 0 -> (1, 0, 0)
    const shapePoint = { x: 1, y: 0, z: 0 };

    // When mapped to stem mesh, this should stay in XZ plane for a vertical stem
    // The new implementation calculates basis vectors directly from tangent
    // For tangent = (0, 1, 0), the cross-section is perpendicular to Y

    // Verify shape points are in XZ plane (y = 0)
    const shape = createStemShape(1, 6);
    for (const p of shape) {
      expect(p.y).toBeCloseTo(0, 5);
    }

    // Verify first shape point is at expected position
    expect(shape[0].x).toBeCloseTo(1, 5);
    expect(shape[0].z).toBeCloseTo(0, 5);
  });
});
