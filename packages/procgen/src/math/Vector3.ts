/**
 * Vector3 utilities for tree generation.
 *
 * Extends Three.js Vector3 with methods needed for the Weber & Penn algorithm,
 * particularly the declination calculation used for branch angles.
 */

import * as THREE from "three";
import type { SeededRandom } from "./Random.js";

/**
 * Calculate the declination angle (angle from vertical) of a vector in degrees.
 * This is the angle between the vector and the positive Z axis, measured in degrees.
 *
 * Used extensively in the tree generation algorithm for calculating branch angles.
 *
 * @param v - The vector to calculate declination for
 * @returns Declination angle in degrees (0 = pointing straight up, 90 = horizontal, 180 = straight down)
 */
export function declination(v: THREE.Vector3): number {
  const horizontalDist = Math.sqrt(v.x * v.x + v.y * v.y);
  return (Math.atan2(horizontalDist, v.z) * 180) / Math.PI;
}

/**
 * Create a random normalized vector.
 * @param rng - Seeded random number generator
 * @returns A new normalized Vector3 with random direction
 */
export function randomVector(rng: SeededRandom): THREE.Vector3 {
  const vec = new THREE.Vector3(rng.random(), rng.random(), rng.random());
  vec.normalize();
  return vec;
}

/**
 * Rotate a vector by a quaternion and return a new vector.
 * @param v - Vector to rotate
 * @param q - Quaternion to rotate by
 * @returns New rotated vector
 */
export function rotatedVector(
  v: THREE.Vector3,
  q: THREE.Quaternion,
): THREE.Vector3 {
  const result = v.clone();
  result.applyQuaternion(q);
  return result;
}

/** Degrees to radians conversion factor */
export const DEG_TO_RAD = Math.PI / 180;

/** Radians to degrees conversion factor */
export const RAD_TO_DEG = 180 / Math.PI;

/** Pi constant */
export const PI = Math.PI;

/** 2 * Pi */
export const PI2 = Math.PI * 2;

/** Pi / 2 */
export const HALF_PI = Math.PI / 2;

/**
 * Convert degrees to radians.
 */
export function radians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Convert radians to degrees.
 */
export function degrees(radians: number): number {
  return radians * RAD_TO_DEG;
}

/**
 * Get a quaternion that rotates from one vector to track another.
 * Similar to Blender's to_track_quat method.
 *
 * @param dir - Direction vector to create quaternion from
 * @param track - Axis to track ('X', 'Y', 'Z', '-X', '-Y', '-Z')
 * @param up - Up axis ('X', 'Y', 'Z', '-X', '-Y', '-Z')
 * @returns Quaternion that aligns 'track' axis with the direction
 */
export function toTrackQuat(
  dir: THREE.Vector3,
  track: "X" | "Y" | "Z" | "-X" | "-Y" | "-Z" = "Z",
  up: "X" | "Y" | "Z" | "-X" | "-Y" | "-Z" = "Y",
): THREE.Quaternion {
  // Normalize direction
  const forward = dir.clone().normalize();

  // Get up axis hint
  let upHint: THREE.Vector3;
  switch (up) {
    case "X":
      upHint = new THREE.Vector3(1, 0, 0);
      break;
    case "-X":
      upHint = new THREE.Vector3(-1, 0, 0);
      break;
    case "Y":
      upHint = new THREE.Vector3(0, 1, 0);
      break;
    case "-Y":
      upHint = new THREE.Vector3(0, -1, 0);
      break;
    case "Z":
      upHint = new THREE.Vector3(0, 0, 1);
      break;
    case "-Z":
      upHint = new THREE.Vector3(0, 0, -1);
      break;
  }

  // Create rotation matrix
  const matrix = new THREE.Matrix4();

  // Calculate right vector (perpendicular to forward and up)
  const right = new THREE.Vector3().crossVectors(upHint, forward);
  if (right.lengthSq() < 0.0001) {
    // forward is parallel to up, choose arbitrary right
    right.set(1, 0, 0);
    if (Math.abs(forward.x) > 0.9) {
      right.set(0, 1, 0);
    }
    right.crossVectors(right, forward);
  }
  right.normalize();

  // Calculate actual up vector
  const actualUp = new THREE.Vector3().crossVectors(forward, right).normalize();

  // Build rotation matrix based on track axis
  if (track === "Z" || track === "-Z") {
    const sign = track === "Z" ? 1 : -1;
    matrix.makeBasis(right, actualUp, forward.clone().multiplyScalar(sign));
  } else if (track === "Y" || track === "-Y") {
    const sign = track === "Y" ? 1 : -1;
    matrix.makeBasis(right, forward.clone().multiplyScalar(sign), actualUp);
  } else {
    const sign = track === "X" ? 1 : -1;
    matrix.makeBasis(forward.clone().multiplyScalar(sign), right, actualUp);
  }

  const quat = new THREE.Quaternion();
  quat.setFromRotationMatrix(matrix);
  return quat;
}

/**
 * Create a Vector3 from an array of numbers.
 */
export function vec3FromArray(arr: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(arr[0], arr[1], arr[2]);
}

/**
 * Linear interpolation between two vectors.
 */
export function lerpVec3(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a value between 0 and 1.
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Linear interpolation between two numbers.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
