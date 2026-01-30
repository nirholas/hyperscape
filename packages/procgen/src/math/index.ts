/**
 * Math utilities for tree generation.
 */

export {
  SeededRandom,
  randInRange,
  hashSeed,
  createRng,
  setGlobalSeed,
  getGlobalRandom,
  genTypedSeed,
  type RNG,
} from "./Random.js";
export {
  declination,
  randomVector,
  rotatedVector,
  radians,
  degrees,
  toTrackQuat,
  vec3FromArray,
  lerpVec3,
  DEG_TO_RAD,
  RAD_TO_DEG,
  PI,
  PI2,
  HALF_PI,
  clamp,
  clamp01,
  lerp,
} from "./Vector3.js";
export {
  type BezierSplinePoint,
  calcPointOnBezier,
  calcTangentToBezier,
  calcPointOnBezierInto,
  calcTangentToBezierInto,
  createBezierPoint,
  evaluateBezierSpline,
  bezierArcLength,
  sampleBezierByArcLength,
} from "./Bezier.js";
export {
  tempVec3,
  tempQuat,
  tempMat4,
  resetPools,
  getPoolStats,
  _scratch,
} from "./Pool.js";
export {
  type HelixPoints,
  calcHelixPoints,
  calcHelixPitch,
  calcHelixRadius,
} from "./Helix.js";
