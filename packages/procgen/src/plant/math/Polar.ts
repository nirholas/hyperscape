/**
 * Polar coordinate utilities
 */

import type { Point2D, Point3D, Polar } from "../types.js";

// Import angle conversion utilities from shared math module for local use
import {
  PI as _PI,
  PI2 as _PI2,
  HALF_PI as _HALF_PI,
  DEG_TO_RAD as _DEG_TO_RAD,
  RAD_TO_DEG as _RAD_TO_DEG,
  radians as _radians,
  degrees as _degrees,
} from "../../math/Vector3.js";

// Re-export for consumers of this module
export const PI = _PI;
export const PI2 = _PI2;
export const HALF_PI = _HALF_PI;
export const DEG_TO_RAD = _DEG_TO_RAD;
export const RAD_TO_DEG = _RAD_TO_DEG;
export const radians = _radians;
export const degrees = _degrees;

/**
 * Create a polar coordinate
 */
export function polar(
  radius: number,
  angle: number,
  inDegrees: boolean = false,
): Polar {
  return {
    radius,
    angle: inDegrees ? _radians(angle) : angle,
  };
}

/**
 * Convert polar to cartesian coordinates
 */
export function polarToCartesian(p: Polar): Point2D {
  return {
    x: Math.cos(p.angle) * p.radius,
    y: Math.sin(p.angle) * p.radius,
  };
}

/**
 * Convert cartesian to polar coordinates
 */
export function cartesianToPolar(x: number, y: number): Polar {
  return {
    radius: Math.sqrt(x * x + y * y),
    angle: Math.atan2(y, x),
  };
}

/**
 * Add polar offset to a point
 */
export function addPolar(point: Point2D, p: Polar): Point2D {
  const offset = polarToCartesian(p);
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  };
}

/**
 * Add polar offset with degrees
 */
export function addPolarDeg(
  point: Point2D,
  radius: number,
  angleDeg: number,
): Point2D {
  return addPolar(point, polar(radius, angleDeg, true));
}

/**
 * Get angle between two points in radians
 */
export function angleBetween(p0: Point2D, p1: Point2D): number {
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

/**
 * Get angle between two 3D points in radians (XY plane)
 */
export function angleBetween3D(p0: Point3D, p1: Point3D): number {
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

/**
 * Normalize angle to [0, 2π)
 */
export function normalizeAngle(angle: number): number {
  while (angle < 0) angle += _PI2;
  while (angle >= _PI2) angle -= _PI2;
  return angle;
}

/**
 * Normalize angle to [-π, π)
 */
export function normalizeAngleSigned(angle: number): number {
  while (angle < -_PI) angle += _PI2;
  while (angle >= _PI) angle -= _PI2;
  return angle;
}

/**
 * Interpolate between two angles (shortest path)
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > _PI) diff -= _PI2;
  while (diff < -_PI) diff += _PI2;
  return a + diff * t;
}
