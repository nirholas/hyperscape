/**
 * Optimized Math Utilities for High-Performance Mesh Decimation
 *
 * All operations work directly on typed arrays with offsets to avoid allocations.
 * Functions are designed for inlining by JIT compilers.
 */

import { EPS, INF, MATRIX_6X6_SIZE } from "./types.js";

// ============================================================================
// VECTOR OPERATIONS (INLINE-FRIENDLY)
// ============================================================================

/**
 * Dot product of two 3D vectors at offsets in arrays
 */
export function dot3(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
): number {
  return (
    a[aOffset] * b[bOffset] +
    a[aOffset + 1] * b[bOffset + 1] +
    a[aOffset + 2] * b[bOffset + 2]
  );
}

/**
 * Dot product of two 5D vectors at offsets
 */
export function dot5(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
): number {
  return (
    a[aOffset] * b[bOffset] +
    a[aOffset + 1] * b[bOffset + 1] +
    a[aOffset + 2] * b[bOffset + 2] +
    a[aOffset + 3] * b[bOffset + 3] +
    a[aOffset + 4] * b[bOffset + 4]
  );
}

/**
 * Dot product of two 6D vectors at offsets
 */
export function dot6(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
): number {
  return (
    a[aOffset] * b[bOffset] +
    a[aOffset + 1] * b[bOffset + 1] +
    a[aOffset + 2] * b[bOffset + 2] +
    a[aOffset + 3] * b[bOffset + 3] +
    a[aOffset + 4] * b[bOffset + 4] +
    a[aOffset + 5] * b[bOffset + 5]
  );
}

/**
 * Dot product of two N-dimensional vectors
 */
export function dotN(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  n: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += a[aOffset + i] * b[bOffset + i];
  }
  return sum;
}

/**
 * Squared norm of 3D vector
 */
export function normSq3(
  a: Float32Array | Float64Array,
  offset: number,
): number {
  const x = a[offset];
  const y = a[offset + 1];
  const z = a[offset + 2];
  return x * x + y * y + z * z;
}

/**
 * Norm of 3D vector
 */
export function norm3(a: Float32Array | Float64Array, offset: number): number {
  return Math.sqrt(normSq3(a, offset));
}

/**
 * Squared norm of 5D vector (unrolled)
 */
export function normSq5(
  a: Float32Array | Float64Array,
  offset: number,
): number {
  const v0 = a[offset],
    v1 = a[offset + 1],
    v2 = a[offset + 2],
    v3 = a[offset + 3],
    v4 = a[offset + 4];
  return v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3 + v4 * v4;
}

/**
 * Norm of 5D vector
 */
export function norm5(a: Float32Array | Float64Array, offset: number): number {
  return Math.sqrt(normSq5(a, offset));
}

/**
 * Subtract 3D vectors: out = a - b
 */
export function sub3(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = a[aOffset] - b[bOffset];
  out[outOffset + 1] = a[aOffset + 1] - b[bOffset + 1];
  out[outOffset + 2] = a[aOffset + 2] - b[bOffset + 2];
}

/**
 * Subtract 5D vectors: out = a - b (unrolled)
 */
export function sub5(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = a[aOffset] - b[bOffset];
  out[outOffset + 1] = a[aOffset + 1] - b[bOffset + 1];
  out[outOffset + 2] = a[aOffset + 2] - b[bOffset + 2];
  out[outOffset + 3] = a[aOffset + 3] - b[bOffset + 3];
  out[outOffset + 4] = a[aOffset + 4] - b[bOffset + 4];
}

/**
 * Scale 5D vector: out = a * s (unrolled)
 */
export function scale5(
  a: Float32Array | Float64Array,
  aOffset: number,
  s: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = a[aOffset] * s;
  out[outOffset + 1] = a[aOffset + 1] * s;
  out[outOffset + 2] = a[aOffset + 2] * s;
  out[outOffset + 3] = a[aOffset + 3] * s;
  out[outOffset + 4] = a[aOffset + 4] * s;
}

/**
 * Add scaled vector: out = a + b * s (unrolled)
 */
export function addScaled5(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  s: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = a[aOffset] + b[bOffset] * s;
  out[outOffset + 1] = a[aOffset + 1] + b[bOffset + 1] * s;
  out[outOffset + 2] = a[aOffset + 2] + b[bOffset + 2] * s;
  out[outOffset + 3] = a[aOffset + 3] + b[bOffset + 3] * s;
  out[outOffset + 4] = a[aOffset + 4] + b[bOffset + 4] * s;
}

/**
 * Midpoint of two 3D vectors
 */
export function midpoint3(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = (a[aOffset] + b[bOffset]) * 0.5;
  out[outOffset + 1] = (a[aOffset + 1] + b[bOffset + 1]) * 0.5;
  out[outOffset + 2] = (a[aOffset + 2] + b[bOffset + 2]) * 0.5;
}

/**
 * Midpoint of two 2D vectors (UVs)
 */
export function midpoint2(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  out[outOffset] = (a[aOffset] + b[bOffset]) * 0.5;
  out[outOffset + 1] = (a[aOffset + 1] + b[bOffset + 1]) * 0.5;
}

/**
 * Cross product of 3D vectors: out = a × b
 */
export function cross3(
  a: Float32Array | Float64Array,
  aOffset: number,
  b: Float32Array | Float64Array,
  bOffset: number,
  out: Float32Array | Float64Array,
  outOffset: number,
): void {
  const ax = a[aOffset];
  const ay = a[aOffset + 1];
  const az = a[aOffset + 2];
  const bx = b[bOffset];
  const by = b[bOffset + 1];
  const bz = b[bOffset + 2];

  out[outOffset] = ay * bz - az * by;
  out[outOffset + 1] = az * bx - ax * bz;
  out[outOffset + 2] = ax * by - ay * bx;
}

/**
 * Normalize 3D vector in place, returns original length
 */
export function normalize3InPlace(
  a: Float32Array | Float64Array,
  offset: number,
): number {
  const len = norm3(a, offset);
  if (len < EPS) return 0;
  const invLen = 1 / len;
  a[offset] *= invLen;
  a[offset + 1] *= invLen;
  a[offset + 2] *= invLen;
  return len;
}

/**
 * Normalize 5D vector in place, returns original length (unrolled)
 */
export function normalize5InPlace(
  a: Float32Array | Float64Array,
  offset: number,
): number {
  const len = norm5(a, offset);
  if (len < EPS) return 0;
  const invLen = 1 / len;
  a[offset] *= invLen;
  a[offset + 1] *= invLen;
  a[offset + 2] *= invLen;
  a[offset + 3] *= invLen;
  a[offset + 4] *= invLen;
  return len;
}

// ============================================================================
// MATRIX OPERATIONS (OPTIMIZED FOR 6×6 AND 8×8)
// ============================================================================

/**
 * Zero a 6×6 matrix at offset (unrolled in blocks of 6)
 */
export function zero6x6(m: Float64Array, offset: number): void {
  m[offset] =
    m[offset + 1] =
    m[offset + 2] =
    m[offset + 3] =
    m[offset + 4] =
    m[offset + 5] =
      0;
  m[offset + 6] =
    m[offset + 7] =
    m[offset + 8] =
    m[offset + 9] =
    m[offset + 10] =
    m[offset + 11] =
      0;
  m[offset + 12] =
    m[offset + 13] =
    m[offset + 14] =
    m[offset + 15] =
    m[offset + 16] =
    m[offset + 17] =
      0;
  m[offset + 18] =
    m[offset + 19] =
    m[offset + 20] =
    m[offset + 21] =
    m[offset + 22] =
    m[offset + 23] =
      0;
  m[offset + 24] =
    m[offset + 25] =
    m[offset + 26] =
    m[offset + 27] =
    m[offset + 28] =
    m[offset + 29] =
      0;
  m[offset + 30] =
    m[offset + 31] =
    m[offset + 32] =
    m[offset + 33] =
    m[offset + 34] =
    m[offset + 35] =
      0;
}

/**
 * Zero an 8×8 matrix at offset (unrolled in blocks of 8)
 */
export function zero8x8(m: Float64Array, offset: number): void {
  m[offset] =
    m[offset + 1] =
    m[offset + 2] =
    m[offset + 3] =
    m[offset + 4] =
    m[offset + 5] =
    m[offset + 6] =
    m[offset + 7] =
      0;
  m[offset + 8] =
    m[offset + 9] =
    m[offset + 10] =
    m[offset + 11] =
    m[offset + 12] =
    m[offset + 13] =
    m[offset + 14] =
    m[offset + 15] =
      0;
  m[offset + 16] =
    m[offset + 17] =
    m[offset + 18] =
    m[offset + 19] =
    m[offset + 20] =
    m[offset + 21] =
    m[offset + 22] =
    m[offset + 23] =
      0;
  m[offset + 24] =
    m[offset + 25] =
    m[offset + 26] =
    m[offset + 27] =
    m[offset + 28] =
    m[offset + 29] =
    m[offset + 30] =
    m[offset + 31] =
      0;
  m[offset + 32] =
    m[offset + 33] =
    m[offset + 34] =
    m[offset + 35] =
    m[offset + 36] =
    m[offset + 37] =
    m[offset + 38] =
    m[offset + 39] =
      0;
  m[offset + 40] =
    m[offset + 41] =
    m[offset + 42] =
    m[offset + 43] =
    m[offset + 44] =
    m[offset + 45] =
    m[offset + 46] =
    m[offset + 47] =
      0;
  m[offset + 48] =
    m[offset + 49] =
    m[offset + 50] =
    m[offset + 51] =
    m[offset + 52] =
    m[offset + 53] =
    m[offset + 54] =
    m[offset + 55] =
      0;
  m[offset + 56] =
    m[offset + 57] =
    m[offset + 58] =
    m[offset + 59] =
    m[offset + 60] =
    m[offset + 61] =
    m[offset + 62] =
    m[offset + 63] =
      0;
}

/**
 * Copy 6×6 matrix (unrolled)
 */
export function copy6x6(
  src: Float64Array,
  srcOffset: number,
  dst: Float64Array,
  dstOffset: number,
): void {
  dst[dstOffset] = src[srcOffset];
  dst[dstOffset + 1] = src[srcOffset + 1];
  dst[dstOffset + 2] = src[srcOffset + 2];
  dst[dstOffset + 3] = src[srcOffset + 3];
  dst[dstOffset + 4] = src[srcOffset + 4];
  dst[dstOffset + 5] = src[srcOffset + 5];
  dst[dstOffset + 6] = src[srcOffset + 6];
  dst[dstOffset + 7] = src[srcOffset + 7];
  dst[dstOffset + 8] = src[srcOffset + 8];
  dst[dstOffset + 9] = src[srcOffset + 9];
  dst[dstOffset + 10] = src[srcOffset + 10];
  dst[dstOffset + 11] = src[srcOffset + 11];
  dst[dstOffset + 12] = src[srcOffset + 12];
  dst[dstOffset + 13] = src[srcOffset + 13];
  dst[dstOffset + 14] = src[srcOffset + 14];
  dst[dstOffset + 15] = src[srcOffset + 15];
  dst[dstOffset + 16] = src[srcOffset + 16];
  dst[dstOffset + 17] = src[srcOffset + 17];
  dst[dstOffset + 18] = src[srcOffset + 18];
  dst[dstOffset + 19] = src[srcOffset + 19];
  dst[dstOffset + 20] = src[srcOffset + 20];
  dst[dstOffset + 21] = src[srcOffset + 21];
  dst[dstOffset + 22] = src[srcOffset + 22];
  dst[dstOffset + 23] = src[srcOffset + 23];
  dst[dstOffset + 24] = src[srcOffset + 24];
  dst[dstOffset + 25] = src[srcOffset + 25];
  dst[dstOffset + 26] = src[srcOffset + 26];
  dst[dstOffset + 27] = src[srcOffset + 27];
  dst[dstOffset + 28] = src[srcOffset + 28];
  dst[dstOffset + 29] = src[srcOffset + 29];
  dst[dstOffset + 30] = src[srcOffset + 30];
  dst[dstOffset + 31] = src[srcOffset + 31];
  dst[dstOffset + 32] = src[srcOffset + 32];
  dst[dstOffset + 33] = src[srcOffset + 33];
  dst[dstOffset + 34] = src[srcOffset + 34];
  dst[dstOffset + 35] = src[srcOffset + 35];
}

/**
 * Add 6×6 matrices: out = a + b (unrolled)
 */
export function add6x6(
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
  out: Float64Array,
  outOffset: number,
): void {
  out[outOffset] = a[aOffset] + b[bOffset];
  out[outOffset + 1] = a[aOffset + 1] + b[bOffset + 1];
  out[outOffset + 2] = a[aOffset + 2] + b[bOffset + 2];
  out[outOffset + 3] = a[aOffset + 3] + b[bOffset + 3];
  out[outOffset + 4] = a[aOffset + 4] + b[bOffset + 4];
  out[outOffset + 5] = a[aOffset + 5] + b[bOffset + 5];
  out[outOffset + 6] = a[aOffset + 6] + b[bOffset + 6];
  out[outOffset + 7] = a[aOffset + 7] + b[bOffset + 7];
  out[outOffset + 8] = a[aOffset + 8] + b[bOffset + 8];
  out[outOffset + 9] = a[aOffset + 9] + b[bOffset + 9];
  out[outOffset + 10] = a[aOffset + 10] + b[bOffset + 10];
  out[outOffset + 11] = a[aOffset + 11] + b[bOffset + 11];
  out[outOffset + 12] = a[aOffset + 12] + b[bOffset + 12];
  out[outOffset + 13] = a[aOffset + 13] + b[bOffset + 13];
  out[outOffset + 14] = a[aOffset + 14] + b[bOffset + 14];
  out[outOffset + 15] = a[aOffset + 15] + b[bOffset + 15];
  out[outOffset + 16] = a[aOffset + 16] + b[bOffset + 16];
  out[outOffset + 17] = a[aOffset + 17] + b[bOffset + 17];
  out[outOffset + 18] = a[aOffset + 18] + b[bOffset + 18];
  out[outOffset + 19] = a[aOffset + 19] + b[bOffset + 19];
  out[outOffset + 20] = a[aOffset + 20] + b[bOffset + 20];
  out[outOffset + 21] = a[aOffset + 21] + b[bOffset + 21];
  out[outOffset + 22] = a[aOffset + 22] + b[bOffset + 22];
  out[outOffset + 23] = a[aOffset + 23] + b[bOffset + 23];
  out[outOffset + 24] = a[aOffset + 24] + b[bOffset + 24];
  out[outOffset + 25] = a[aOffset + 25] + b[bOffset + 25];
  out[outOffset + 26] = a[aOffset + 26] + b[bOffset + 26];
  out[outOffset + 27] = a[aOffset + 27] + b[bOffset + 27];
  out[outOffset + 28] = a[aOffset + 28] + b[bOffset + 28];
  out[outOffset + 29] = a[aOffset + 29] + b[bOffset + 29];
  out[outOffset + 30] = a[aOffset + 30] + b[bOffset + 30];
  out[outOffset + 31] = a[aOffset + 31] + b[bOffset + 31];
  out[outOffset + 32] = a[aOffset + 32] + b[bOffset + 32];
  out[outOffset + 33] = a[aOffset + 33] + b[bOffset + 33];
  out[outOffset + 34] = a[aOffset + 34] + b[bOffset + 34];
  out[outOffset + 35] = a[aOffset + 35] + b[bOffset + 35];
}

/**
 * Add 6×6 matrix in place: a += b (unrolled)
 */
export function addInPlace6x6(
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
): void {
  a[aOffset] += b[bOffset];
  a[aOffset + 1] += b[bOffset + 1];
  a[aOffset + 2] += b[bOffset + 2];
  a[aOffset + 3] += b[bOffset + 3];
  a[aOffset + 4] += b[bOffset + 4];
  a[aOffset + 5] += b[bOffset + 5];
  a[aOffset + 6] += b[bOffset + 6];
  a[aOffset + 7] += b[bOffset + 7];
  a[aOffset + 8] += b[bOffset + 8];
  a[aOffset + 9] += b[bOffset + 9];
  a[aOffset + 10] += b[bOffset + 10];
  a[aOffset + 11] += b[bOffset + 11];
  a[aOffset + 12] += b[bOffset + 12];
  a[aOffset + 13] += b[bOffset + 13];
  a[aOffset + 14] += b[bOffset + 14];
  a[aOffset + 15] += b[bOffset + 15];
  a[aOffset + 16] += b[bOffset + 16];
  a[aOffset + 17] += b[bOffset + 17];
  a[aOffset + 18] += b[bOffset + 18];
  a[aOffset + 19] += b[bOffset + 19];
  a[aOffset + 20] += b[bOffset + 20];
  a[aOffset + 21] += b[bOffset + 21];
  a[aOffset + 22] += b[bOffset + 22];
  a[aOffset + 23] += b[bOffset + 23];
  a[aOffset + 24] += b[bOffset + 24];
  a[aOffset + 25] += b[bOffset + 25];
  a[aOffset + 26] += b[bOffset + 26];
  a[aOffset + 27] += b[bOffset + 27];
  a[aOffset + 28] += b[bOffset + 28];
  a[aOffset + 29] += b[bOffset + 29];
  a[aOffset + 30] += b[bOffset + 30];
  a[aOffset + 31] += b[bOffset + 31];
  a[aOffset + 32] += b[bOffset + 32];
  a[aOffset + 33] += b[bOffset + 33];
  a[aOffset + 34] += b[bOffset + 34];
  a[aOffset + 35] += b[bOffset + 35];
}

/**
 * Get element from 6×6 matrix (row-major layout)
 */
export function get6x6(
  m: Float64Array,
  offset: number,
  row: number,
  col: number,
): number {
  return m[offset + row * 6 + col];
}

/**
 * Set element in 6×6 matrix (row-major layout)
 */
export function set6x6(
  m: Float64Array,
  offset: number,
  row: number,
  col: number,
  value: number,
): void {
  m[offset + row * 6 + col] = value;
}

/**
 * Get element from 8×8 matrix (row-major layout)
 */
export function get8x8(
  m: Float64Array,
  offset: number,
  row: number,
  col: number,
): number {
  return m[offset + row * 8 + col];
}

/**
 * Set element in 8×8 matrix (row-major layout)
 */
export function set8x8(
  m: Float64Array,
  offset: number,
  row: number,
  col: number,
  value: number,
): void {
  m[offset + row * 8 + col] = value;
}

/**
 * Outer product 5×5 added to 6×6 matrix (upper-left 5×5 block) - fully unrolled
 * Used for building QEM: M += v ⊗ v
 */
export function addOuter5To6x6(
  m: Float64Array,
  mOffset: number,
  v: Float64Array,
  vOffset: number,
): void {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2],
    v3 = v[vOffset + 3],
    v4 = v[vOffset + 4];
  // Row 0
  m[mOffset] += v0 * v0;
  m[mOffset + 1] += v0 * v1;
  m[mOffset + 2] += v0 * v2;
  m[mOffset + 3] += v0 * v3;
  m[mOffset + 4] += v0 * v4;
  // Row 1
  m[mOffset + 6] += v1 * v0;
  m[mOffset + 7] += v1 * v1;
  m[mOffset + 8] += v1 * v2;
  m[mOffset + 9] += v1 * v3;
  m[mOffset + 10] += v1 * v4;
  // Row 2
  m[mOffset + 12] += v2 * v0;
  m[mOffset + 13] += v2 * v1;
  m[mOffset + 14] += v2 * v2;
  m[mOffset + 15] += v2 * v3;
  m[mOffset + 16] += v2 * v4;
  // Row 3
  m[mOffset + 18] += v3 * v0;
  m[mOffset + 19] += v3 * v1;
  m[mOffset + 20] += v3 * v2;
  m[mOffset + 21] += v3 * v3;
  m[mOffset + 22] += v3 * v4;
  // Row 4
  m[mOffset + 24] += v4 * v0;
  m[mOffset + 25] += v4 * v1;
  m[mOffset + 26] += v4 * v2;
  m[mOffset + 27] += v4 * v3;
  m[mOffset + 28] += v4 * v4;
}

/**
 * Matrix-vector multiply for 6×6: out = M * v (fully unrolled)
 */
export function matVec6(
  m: Float64Array,
  mOffset: number,
  v: Float64Array,
  vOffset: number,
  out: Float64Array,
  outOffset: number,
): void {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2];
  const v3 = v[vOffset + 3],
    v4 = v[vOffset + 4],
    v5 = v[vOffset + 5];

  out[outOffset] =
    m[mOffset] * v0 +
    m[mOffset + 1] * v1 +
    m[mOffset + 2] * v2 +
    m[mOffset + 3] * v3 +
    m[mOffset + 4] * v4 +
    m[mOffset + 5] * v5;
  out[outOffset + 1] =
    m[mOffset + 6] * v0 +
    m[mOffset + 7] * v1 +
    m[mOffset + 8] * v2 +
    m[mOffset + 9] * v3 +
    m[mOffset + 10] * v4 +
    m[mOffset + 11] * v5;
  out[outOffset + 2] =
    m[mOffset + 12] * v0 +
    m[mOffset + 13] * v1 +
    m[mOffset + 14] * v2 +
    m[mOffset + 15] * v3 +
    m[mOffset + 16] * v4 +
    m[mOffset + 17] * v5;
  out[outOffset + 3] =
    m[mOffset + 18] * v0 +
    m[mOffset + 19] * v1 +
    m[mOffset + 20] * v2 +
    m[mOffset + 21] * v3 +
    m[mOffset + 22] * v4 +
    m[mOffset + 23] * v5;
  out[outOffset + 4] =
    m[mOffset + 24] * v0 +
    m[mOffset + 25] * v1 +
    m[mOffset + 26] * v2 +
    m[mOffset + 27] * v3 +
    m[mOffset + 28] * v4 +
    m[mOffset + 29] * v5;
  out[outOffset + 5] =
    m[mOffset + 30] * v0 +
    m[mOffset + 31] * v1 +
    m[mOffset + 32] * v2 +
    m[mOffset + 33] * v3 +
    m[mOffset + 34] * v4 +
    m[mOffset + 35] * v5;
}

/**
 * Matrix-vector multiply for 8×8: out = M * v (fully unrolled)
 */
export function matVec8(
  m: Float64Array,
  mOffset: number,
  v: Float64Array,
  vOffset: number,
  out: Float64Array,
  outOffset: number,
): void {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2],
    v3 = v[vOffset + 3];
  const v4 = v[vOffset + 4],
    v5 = v[vOffset + 5],
    v6 = v[vOffset + 6],
    v7 = v[vOffset + 7];

  out[outOffset] =
    m[mOffset] * v0 +
    m[mOffset + 1] * v1 +
    m[mOffset + 2] * v2 +
    m[mOffset + 3] * v3 +
    m[mOffset + 4] * v4 +
    m[mOffset + 5] * v5 +
    m[mOffset + 6] * v6 +
    m[mOffset + 7] * v7;
  out[outOffset + 1] =
    m[mOffset + 8] * v0 +
    m[mOffset + 9] * v1 +
    m[mOffset + 10] * v2 +
    m[mOffset + 11] * v3 +
    m[mOffset + 12] * v4 +
    m[mOffset + 13] * v5 +
    m[mOffset + 14] * v6 +
    m[mOffset + 15] * v7;
  out[outOffset + 2] =
    m[mOffset + 16] * v0 +
    m[mOffset + 17] * v1 +
    m[mOffset + 18] * v2 +
    m[mOffset + 19] * v3 +
    m[mOffset + 20] * v4 +
    m[mOffset + 21] * v5 +
    m[mOffset + 22] * v6 +
    m[mOffset + 23] * v7;
  out[outOffset + 3] =
    m[mOffset + 24] * v0 +
    m[mOffset + 25] * v1 +
    m[mOffset + 26] * v2 +
    m[mOffset + 27] * v3 +
    m[mOffset + 28] * v4 +
    m[mOffset + 29] * v5 +
    m[mOffset + 30] * v6 +
    m[mOffset + 31] * v7;
  out[outOffset + 4] =
    m[mOffset + 32] * v0 +
    m[mOffset + 33] * v1 +
    m[mOffset + 34] * v2 +
    m[mOffset + 35] * v3 +
    m[mOffset + 36] * v4 +
    m[mOffset + 37] * v5 +
    m[mOffset + 38] * v6 +
    m[mOffset + 39] * v7;
  out[outOffset + 5] =
    m[mOffset + 40] * v0 +
    m[mOffset + 41] * v1 +
    m[mOffset + 42] * v2 +
    m[mOffset + 43] * v3 +
    m[mOffset + 44] * v4 +
    m[mOffset + 45] * v5 +
    m[mOffset + 46] * v6 +
    m[mOffset + 47] * v7;
  out[outOffset + 6] =
    m[mOffset + 48] * v0 +
    m[mOffset + 49] * v1 +
    m[mOffset + 50] * v2 +
    m[mOffset + 51] * v3 +
    m[mOffset + 52] * v4 +
    m[mOffset + 53] * v5 +
    m[mOffset + 54] * v6 +
    m[mOffset + 55] * v7;
  out[outOffset + 7] =
    m[mOffset + 56] * v0 +
    m[mOffset + 57] * v1 +
    m[mOffset + 58] * v2 +
    m[mOffset + 59] * v3 +
    m[mOffset + 60] * v4 +
    m[mOffset + 61] * v5 +
    m[mOffset + 62] * v6 +
    m[mOffset + 63] * v7;
}

/**
 * Quadratic form: v^T * M * v for 6×6 (fully unrolled for max performance)
 */
export function quadraticForm6(
  v: Float64Array,
  vOffset: number,
  m: Float64Array,
  mOffset: number,
): number {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2];
  const v3 = v[vOffset + 3],
    v4 = v[vOffset + 4],
    v5 = v[vOffset + 5];

  // Row 0
  let r =
    v0 *
    (m[mOffset] * v0 +
      m[mOffset + 1] * v1 +
      m[mOffset + 2] * v2 +
      m[mOffset + 3] * v3 +
      m[mOffset + 4] * v4 +
      m[mOffset + 5] * v5);
  // Row 1
  r +=
    v1 *
    (m[mOffset + 6] * v0 +
      m[mOffset + 7] * v1 +
      m[mOffset + 8] * v2 +
      m[mOffset + 9] * v3 +
      m[mOffset + 10] * v4 +
      m[mOffset + 11] * v5);
  // Row 2
  r +=
    v2 *
    (m[mOffset + 12] * v0 +
      m[mOffset + 13] * v1 +
      m[mOffset + 14] * v2 +
      m[mOffset + 15] * v3 +
      m[mOffset + 16] * v4 +
      m[mOffset + 17] * v5);
  // Row 3
  r +=
    v3 *
    (m[mOffset + 18] * v0 +
      m[mOffset + 19] * v1 +
      m[mOffset + 20] * v2 +
      m[mOffset + 21] * v3 +
      m[mOffset + 22] * v4 +
      m[mOffset + 23] * v5);
  // Row 4
  r +=
    v4 *
    (m[mOffset + 24] * v0 +
      m[mOffset + 25] * v1 +
      m[mOffset + 26] * v2 +
      m[mOffset + 27] * v3 +
      m[mOffset + 28] * v4 +
      m[mOffset + 29] * v5);
  // Row 5
  r +=
    v5 *
    (m[mOffset + 30] * v0 +
      m[mOffset + 31] * v1 +
      m[mOffset + 32] * v2 +
      m[mOffset + 33] * v3 +
      m[mOffset + 34] * v4 +
      m[mOffset + 35] * v5);

  return r;
}

/**
 * Quadratic form: v^T * M * v for 8×8 (fully unrolled)
 */
export function quadraticForm8(
  v: Float64Array,
  vOffset: number,
  m: Float64Array,
  mOffset: number,
): number {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2],
    v3 = v[vOffset + 3];
  const v4 = v[vOffset + 4],
    v5 = v[vOffset + 5],
    v6 = v[vOffset + 6],
    v7 = v[vOffset + 7];

  let r =
    v0 *
    (m[mOffset] * v0 +
      m[mOffset + 1] * v1 +
      m[mOffset + 2] * v2 +
      m[mOffset + 3] * v3 +
      m[mOffset + 4] * v4 +
      m[mOffset + 5] * v5 +
      m[mOffset + 6] * v6 +
      m[mOffset + 7] * v7);
  r +=
    v1 *
    (m[mOffset + 8] * v0 +
      m[mOffset + 9] * v1 +
      m[mOffset + 10] * v2 +
      m[mOffset + 11] * v3 +
      m[mOffset + 12] * v4 +
      m[mOffset + 13] * v5 +
      m[mOffset + 14] * v6 +
      m[mOffset + 15] * v7);
  r +=
    v2 *
    (m[mOffset + 16] * v0 +
      m[mOffset + 17] * v1 +
      m[mOffset + 18] * v2 +
      m[mOffset + 19] * v3 +
      m[mOffset + 20] * v4 +
      m[mOffset + 21] * v5 +
      m[mOffset + 22] * v6 +
      m[mOffset + 23] * v7);
  r +=
    v3 *
    (m[mOffset + 24] * v0 +
      m[mOffset + 25] * v1 +
      m[mOffset + 26] * v2 +
      m[mOffset + 27] * v3 +
      m[mOffset + 28] * v4 +
      m[mOffset + 29] * v5 +
      m[mOffset + 30] * v6 +
      m[mOffset + 31] * v7);
  r +=
    v4 *
    (m[mOffset + 32] * v0 +
      m[mOffset + 33] * v1 +
      m[mOffset + 34] * v2 +
      m[mOffset + 35] * v3 +
      m[mOffset + 36] * v4 +
      m[mOffset + 37] * v5 +
      m[mOffset + 38] * v6 +
      m[mOffset + 39] * v7);
  r +=
    v5 *
    (m[mOffset + 40] * v0 +
      m[mOffset + 41] * v1 +
      m[mOffset + 42] * v2 +
      m[mOffset + 43] * v3 +
      m[mOffset + 44] * v4 +
      m[mOffset + 45] * v5 +
      m[mOffset + 46] * v6 +
      m[mOffset + 47] * v7);
  r +=
    v6 *
    (m[mOffset + 48] * v0 +
      m[mOffset + 49] * v1 +
      m[mOffset + 50] * v2 +
      m[mOffset + 51] * v3 +
      m[mOffset + 52] * v4 +
      m[mOffset + 53] * v5 +
      m[mOffset + 54] * v6 +
      m[mOffset + 55] * v7);
  r +=
    v7 *
    (m[mOffset + 56] * v0 +
      m[mOffset + 57] * v1 +
      m[mOffset + 58] * v2 +
      m[mOffset + 59] * v3 +
      m[mOffset + 60] * v4 +
      m[mOffset + 61] * v5 +
      m[mOffset + 62] * v6 +
      m[mOffset + 63] * v7);

  return r;
}

// ============================================================================
// CHOLESKY DECOMPOSITION AND LINEAR SOLVE (FOR QP)
// ============================================================================

// Pre-allocated workspace for Cholesky
const choleskyL6 = new Float64Array(MATRIX_6X6_SIZE);
const choleskyY6 = new Float64Array(6);

/**
 * Cholesky decomposition for 6×6 matrix: M = L * L^T
 * L is stored in lower triangle, overwrites input if inPlace=true
 * Returns false if not positive definite (with regularization applied)
 */
export function cholesky6(
  m: Float64Array,
  mOffset: number,
  L: Float64Array,
  LOffset: number,
): boolean {
  const REG_EPS = 1e-10;

  // Copy to L
  copy6x6(m, mOffset, L, LOffset);

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = L[LOffset + i * 6 + j];

      for (let k = 0; k < j; k++) {
        sum -= L[LOffset + i * 6 + k] * L[LOffset + j * 6 + k];
      }

      if (i === j) {
        if (sum <= 0) {
          // Apply regularization
          L[LOffset + i * 6 + j] = Math.sqrt(REG_EPS);
        } else {
          L[LOffset + i * 6 + j] = Math.sqrt(sum);
        }
      } else {
        const Ljj = L[LOffset + j * 6 + j];
        if (Math.abs(Ljj) < REG_EPS) {
          L[LOffset + i * 6 + j] = 0;
        } else {
          L[LOffset + i * 6 + j] = sum / Ljj;
        }
      }
    }

    // Zero upper triangle
    for (let j = i + 1; j < 6; j++) {
      L[LOffset + i * 6 + j] = 0;
    }
  }

  return true;
}

/**
 * Solve L * x = b where L is lower triangular 6×6 (forward substitution)
 */
export function solveLower6(
  L: Float64Array,
  LOffset: number,
  b: Float64Array,
  bOffset: number,
  x: Float64Array,
  xOffset: number,
): void {
  for (let i = 0; i < 6; i++) {
    let sum = b[bOffset + i];
    const rowOffset = LOffset + i * 6;
    for (let j = 0; j < i; j++) {
      sum -= L[rowOffset + j] * x[xOffset + j];
    }
    x[xOffset + i] = sum / L[rowOffset + i];
  }
}

/**
 * Solve L^T * x = b where L is lower triangular 6×6 (backward substitution)
 */
export function solveUpperT6(
  L: Float64Array,
  LOffset: number,
  b: Float64Array,
  bOffset: number,
  x: Float64Array,
  xOffset: number,
): void {
  for (let i = 5; i >= 0; i--) {
    let sum = b[bOffset + i];
    for (let j = i + 1; j < 6; j++) {
      // L^T[i][j] = L[j][i]
      sum -= L[LOffset + j * 6 + i] * x[xOffset + j];
    }
    // L^T[i][i] = L[i][i]
    x[xOffset + i] = sum / L[LOffset + i * 6 + i];
  }
}

/**
 * Solve M * x = b using Cholesky for 6×6 SPD matrix
 * Uses pre-allocated workspace
 */
export function solveCholesky6(
  m: Float64Array,
  mOffset: number,
  b: Float64Array,
  bOffset: number,
  x: Float64Array,
  xOffset: number,
): boolean {
  if (!cholesky6(m, mOffset, choleskyL6, 0)) {
    return false;
  }

  // Solve L * y = b
  solveLower6(choleskyL6, 0, b, bOffset, choleskyY6, 0);

  // Solve L^T * x = y
  solveUpperT6(choleskyL6, 0, choleskyY6, 0, x, xOffset);

  return true;
}

// ============================================================================
// GOLDFARB-IDNANI QP SOLVER (OPTIMIZED)
// ============================================================================

// Pre-allocated workspace for QP solver (sized for max 8 variables)
const qpJ = new Float64Array(64); // J matrix (n×n)
const qpR = new Float64Array(64); // R matrix (n×n)
const qpZ = new Float64Array(8);
const qpD = new Float64Array(8);
const qpNp = new Float64Array(8);
const qpU = new Float64Array(16); // Lagrange multipliers (n + m)
const qpR2 = new Float64Array(16);
const qpS = new Float64Array(16); // Slack variables
const qpXOld = new Float64Array(8);
const qpUOld = new Float64Array(16);
const qpA = new Int32Array(16); // Active set
const qpAOld = new Int32Array(16);
const qpIai = new Int32Array(16);
const qpIaexcl = new Uint8Array(16);

/**
 * Compute Euclidean distance used in Givens rotation
 */
function giDistance(a: number, b: number): number {
  const a1 = Math.abs(a);
  const b1 = Math.abs(b);
  if (a1 > b1) {
    const t = b1 / a1;
    return a1 * Math.sqrt(1.0 + t * t);
  } else if (b1 > a1) {
    const t = a1 / b1;
    return b1 * Math.sqrt(1.0 + t * t);
  }
  return a1 * Math.sqrt(2.0);
}

/**
 * Solve convex QP using Goldfarb-Idnani dual method:
 *
 * min  0.5 * x^T * G * x + g0^T * x
 * s.t. CE^T * x + ce0 = 0
 *      CI^T * x + ci0 >= 0
 *
 * @param n Number of variables
 * @param G Quadratic term (n×n, row-major in flat array)
 * @param gOffset Offset into G array
 * @param g0 Linear term (n)
 * @param g0Offset Offset into g0 array
 * @param p Number of equality constraints
 * @param CE Equality constraint matrix (n×p, row-major)
 * @param ceOffset Offset into CE array
 * @param ce0 Equality constraint constants (p)
 * @param ce0Offset Offset into ce0 array
 * @param m Number of inequality constraints
 * @param CI Inequality constraint matrix (n×m, row-major)
 * @param ciOffset Offset into CI array
 * @param ci0 Inequality constraint constants (m)
 * @param ci0Offset Offset into ci0 array
 * @param x Output solution vector
 * @param xOffset Offset into x array
 * @returns Cost at solution, or INF if infeasible
 */
export function solveQP(
  n: number,
  G: Float64Array,
  gOffset: number,
  g0: Float64Array,
  g0Offset: number,
  p: number,
  CE: Float64Array,
  ceOffset: number,
  ce0: Float64Array,
  ce0Offset: number,
  m: number,
  CI: Float64Array,
  ciOffset: number,
  ci0: Float64Array,
  ci0Offset: number,
  x: Float64Array,
  xOffset: number,
): number {
  const EPS_MACHINE = Number.EPSILON;

  // Initialize J to identity (will store L^{-T})
  qpJ.fill(0);
  for (let i = 0; i < n; i++) {
    qpJ[i * n + i] = 1;
  }

  // Initialize R to zero
  qpR.fill(0);

  // Compute trace of G
  let c1 = 0;
  for (let i = 0; i < n; i++) {
    c1 += G[gOffset + i * n + i];
  }

  // Cholesky decomposition G = L * L^T
  // We compute L and then J = L^{-T}
  const L = new Float64Array(n * n);
  const REG_EPS = 1e-10;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = G[gOffset + i * n + j];
      for (let k = 0; k < j; k++) {
        sum -= L[i * n + k] * L[j * n + k];
      }

      if (i === j) {
        if (sum <= 0) {
          L[i * n + j] = Math.sqrt(REG_EPS);
        } else {
          L[i * n + j] = Math.sqrt(sum);
        }
      } else {
        const Ljj = L[j * n + j];
        if (Math.abs(Ljj) < REG_EPS) {
          L[i * n + j] = 0;
        } else {
          L[i * n + j] = sum / Ljj;
        }
      }
    }
  }

  // Compute J = L^{-T}
  for (let i = 0; i < n; i++) {
    qpJ[i * n + i] = 1.0 / L[i * n + i];
    for (let j = i + 1; j < n; j++) {
      let sum = 0;
      for (let k = i; k < j; k++) {
        sum += L[j * n + k] * qpJ[k * n + i];
      }
      qpJ[j * n + i] = -sum / L[j * n + j];
    }
  }

  // Transpose J
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const tmp = qpJ[i * n + j];
      qpJ[i * n + j] = qpJ[j * n + i];
      qpJ[j * n + i] = tmp;
    }
  }

  // Compute trace of J
  let c2 = 0;
  for (let i = 0; i < n; i++) {
    c2 += qpJ[i * n + i];
  }

  // Find unconstrained minimizer: x = -G^{-1} * g0 = -J * J^T * g0
  // Using Cholesky: x = -L^{-T} * L^{-1} * g0
  const y = new Float64Array(n);

  // Forward substitution: L * y = g0
  for (let i = 0; i < n; i++) {
    let sum = g0[g0Offset + i];
    for (let j = 0; j < i; j++) {
      sum -= L[i * n + j] * y[j];
    }
    y[i] = sum / L[i * n + i];
  }

  // Backward substitution: L^T * x = -y
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let j = i + 1; j < n; j++) {
      sum -= L[j * n + i] * x[xOffset + j];
    }
    x[xOffset + i] = -sum / L[i * n + i];
  }

  // Initial cost
  let fValue = 0;
  for (let i = 0; i < n; i++) {
    fValue += 0.5 * g0[g0Offset + i] * x[xOffset + i];
  }

  let iq = 0;
  let RNorm = 1.0;

  // Add equality constraints
  for (let i = 0; i < p; i++) {
    // np = CE column i
    for (let k = 0; k < n; k++) {
      qpNp[k] = CE[ceOffset + k * p + i];
    }

    // d = J^T * np
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += qpJ[j * n + k] * qpNp[j];
      }
      qpD[k] = sum;
    }

    // z = J_{right cols from iq} * d_{tail from iq}
    qpZ.fill(0);
    for (let k = 0; k < n; k++) {
      for (let j = iq; j < n; j++) {
        qpZ[k] += qpJ[k * n + j] * qpD[j];
      }
    }

    // r = R^{-1} * d_{head iq}
    qpR2.fill(0);
    for (let k = iq - 1; k >= 0; k--) {
      let sum = qpD[k];
      for (let j = k + 1; j < iq; j++) {
        sum -= qpR[k * n + j] * qpR2[j];
      }
      qpR2[k] = sum / qpR[k * n + k];
    }

    // Compute step length
    let t2 = 0;
    let zDotZ = 0;
    for (let k = 0; k < n; k++) {
      zDotZ += qpZ[k] * qpZ[k];
    }

    if (Math.abs(zDotZ) > EPS_MACHINE) {
      let npDotX = 0;
      let zDotNp = 0;
      for (let k = 0; k < n; k++) {
        npDotX += qpNp[k] * x[xOffset + k];
        zDotNp += qpZ[k] * qpNp[k];
      }
      t2 = (-npDotX - ce0[ce0Offset + i]) / zDotNp;
    }

    // Take step
    for (let k = 0; k < n; k++) {
      x[xOffset + k] += t2 * qpZ[k];
    }

    // Update u
    qpU[iq] = t2;
    for (let k = 0; k < iq; k++) {
      qpU[k] -= t2 * qpR2[k];
    }

    // Update cost
    let zDotNp = 0;
    for (let k = 0; k < n; k++) {
      zDotNp += qpZ[k] * qpNp[k];
    }
    fValue += 0.5 * t2 * t2 * zDotNp;

    // Add constraint to active set (simplified addConstraint)
    // Apply Givens rotations
    for (let j = n - 1; j >= iq + 1; j--) {
      let cc = qpD[j - 1];
      let ss = qpD[j];
      const h = giDistance(cc, ss);
      if (h === 0) continue;

      qpD[j] = 0;
      ss = ss / h;
      cc = cc / h;

      if (cc < 0) {
        cc = -cc;
        ss = -ss;
        qpD[j - 1] = -h;
      } else {
        qpD[j - 1] = h;
      }

      const xny = ss / (1.0 + cc);
      for (let k = 0; k < n; k++) {
        const t1 = qpJ[k * n + j - 1];
        const t2v = qpJ[k * n + j];
        qpJ[k * n + j - 1] = t1 * cc + t2v * ss;
        qpJ[k * n + j] = xny * (t1 + qpJ[k * n + j - 1]) - t2v;
      }
    }

    iq++;

    // Put d into column iq-1 of R
    for (let k = 0; k < iq; k++) {
      qpR[k * n + iq - 1] = qpD[k];
    }

    if (Math.abs(qpD[iq - 1]) <= EPS_MACHINE * RNorm) {
      // Constraint linearly dependent - continue anyway
    }
    RNorm = Math.max(RNorm, Math.abs(qpD[iq - 1]));

    qpA[i] = -(i + 1);
  }

  // Initialize active set tracking for inequalities
  qpA.fill(0, p);
  qpIai.fill(0);
  for (let i = 0; i < m; i++) {
    qpIai[i] = i;
  }

  // Main loop
  let iter = 0;
  const maxIter = 1000;

  while (iter++ < maxIter) {
    // Step 1: Find violated constraint
    for (let i = p; i < iq; i++) {
      const ip = qpA[i];
      if (ip >= 0) qpIai[ip] = -1;
    }

    // Compute s(x) = CI^T * x + ci0
    let psi = 0;
    for (let i = 0; i < m; i++) {
      qpIaexcl[i] = 1;
      let sum = ci0[ci0Offset + i];
      for (let k = 0; k < n; k++) {
        sum += CI[ciOffset + k * m + i] * x[xOffset + k];
      }
      qpS[i] = sum;
      psi += Math.min(0, sum);
    }

    if (Math.abs(psi) <= m * EPS_MACHINE * c1 * c2 * 100) {
      return fValue;
    }

    // Save old values
    for (let i = 0; i < n; i++) {
      qpXOld[i] = x[xOffset + i];
    }
    for (let i = 0; i < iq; i++) {
      qpUOld[i] = qpU[i];
      qpAOld[i] = qpA[i];
    }

    // Find most violated constraint
    let ss = 0;
    let ip = 0;
    let foundConstraint = false;
    for (let i = 0; i < m; i++) {
      if (qpS[i] < ss && qpIai[i] !== -1 && qpIaexcl[i]) {
        ss = qpS[i];
        ip = i;
        foundConstraint = true;
      }
    }

    if (!foundConstraint || ss >= 0) {
      return fValue;
    }

    // np = CI column ip
    for (let k = 0; k < n; k++) {
      qpNp[k] = CI[ciOffset + k * m + ip];
    }

    qpU[iq] = 0;
    qpA[iq] = ip;

    // Step 2: Determine step direction
    let loopCount = 0;
    while (loopCount++ < maxIter) {
      // d = J^T * np
      for (let k = 0; k < n; k++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += qpJ[j * n + k] * qpNp[j];
        }
        qpD[k] = sum;
      }

      // z = J_{right cols} * d_{tail}
      qpZ.fill(0);
      for (let k = 0; k < n; k++) {
        for (let j = iq; j < n; j++) {
          qpZ[k] += qpJ[k * n + j] * qpD[j];
        }
      }

      // r = R^{-1} * d_{head}
      qpR2.fill(0);
      for (let k = iq - 1; k >= 0; k--) {
        let sum = qpD[k];
        for (let j = k + 1; j < iq; j++) {
          sum -= qpR[k * n + j] * qpR2[j];
        }
        if (Math.abs(qpR[k * n + k]) < EPS_MACHINE) {
          qpR2[k] = 0;
        } else {
          qpR2[k] = sum / qpR[k * n + k];
        }
      }

      // Find step length
      let l = 0;
      let t1 = INF;

      for (let k = p; k < iq; k++) {
        if (qpR2[k] > 0) {
          const tmp = qpU[k] / qpR2[k];
          if (tmp < t1) {
            t1 = tmp;
            l = qpA[k];
          }
        }
      }

      let t2 = INF;
      let zDotZ = 0;
      for (let k = 0; k < n; k++) {
        zDotZ += qpZ[k] * qpZ[k];
      }

      if (Math.abs(zDotZ) > EPS_MACHINE) {
        let zDotNp = 0;
        for (let k = 0; k < n; k++) {
          zDotNp += qpZ[k] * qpNp[k];
        }
        t2 = -qpS[ip] / zDotNp;
      }

      const t = Math.min(t1, t2);

      if (t >= INF) {
        // Infeasible
        return INF;
      }

      if (t2 >= INF) {
        // Step in dual space only
        for (let k = 0; k < iq; k++) {
          qpU[k] -= t * qpR2[k];
        }
        qpU[iq] += t;
        qpIai[l] = l;

        // Delete constraint l
        let qq = -1;
        for (let i = p; i < iq; i++) {
          if (qpA[i] === l) {
            qq = i;
            break;
          }
        }

        if (qq >= 0) {
          for (let i = qq; i < iq - 1; i++) {
            qpA[i] = qpA[i + 1];
            qpU[i] = qpU[i + 1];
            for (let j = 0; j < n; j++) {
              qpR[j * n + i] = qpR[j * n + i + 1];
            }
          }

          qpA[iq - 1] = qpA[iq];
          qpU[iq - 1] = qpU[iq];
          qpA[iq] = 0;
          qpU[iq] = 0;

          for (let j = 0; j < iq; j++) {
            qpR[j * n + iq - 1] = 0;
          }

          iq--;

          // Restore R and J
          for (let j = qq; j < iq; j++) {
            let cc = qpR[j * n + j];
            let ssv = qpR[(j + 1) * n + j];
            const h = giDistance(cc, ssv);
            if (h === 0) continue;

            cc = cc / h;
            ssv = ssv / h;
            qpR[(j + 1) * n + j] = 0;

            if (cc < 0) {
              qpR[j * n + j] = -h;
              cc = -cc;
              ssv = -ssv;
            } else {
              qpR[j * n + j] = h;
            }

            const xny = ssv / (1.0 + cc);
            for (let k = j + 1; k < iq; k++) {
              const t1v = qpR[j * n + k];
              const t2v = qpR[(j + 1) * n + k];
              qpR[j * n + k] = t1v * cc + t2v * ssv;
              qpR[(j + 1) * n + k] = xny * (t1v + qpR[j * n + k]) - t2v;
            }

            for (let k = 0; k < n; k++) {
              const t1v = qpJ[k * n + j];
              const t2v = qpJ[k * n + j + 1];
              qpJ[k * n + j] = t1v * cc + t2v * ssv;
              qpJ[k * n + j + 1] = xny * (qpJ[k * n + j] + t1v) - t2v;
            }
          }
        }

        continue;
      }

      // Full step in primal and dual
      for (let k = 0; k < n; k++) {
        x[xOffset + k] += t * qpZ[k];
      }

      let zDotNp = 0;
      for (let k = 0; k < n; k++) {
        zDotNp += qpZ[k] * qpNp[k];
      }
      fValue += t * zDotNp * (0.5 * t + qpU[iq]);

      for (let k = 0; k < iq; k++) {
        qpU[k] -= t * qpR2[k];
      }
      qpU[iq] += t;

      if (Math.abs(t - t2) < EPS_MACHINE) {
        // Full step - add constraint
        // Apply Givens rotations
        for (let j = n - 1; j >= iq + 1; j--) {
          let cc = qpD[j - 1];
          let ssv = qpD[j];
          const h = giDistance(cc, ssv);
          if (h === 0) continue;

          qpD[j] = 0;
          ssv = ssv / h;
          cc = cc / h;

          if (cc < 0) {
            cc = -cc;
            ssv = -ssv;
            qpD[j - 1] = -h;
          } else {
            qpD[j - 1] = h;
          }

          const xny = ssv / (1.0 + cc);
          for (let k = 0; k < n; k++) {
            const t1v = qpJ[k * n + j - 1];
            const t2v = qpJ[k * n + j];
            qpJ[k * n + j - 1] = t1v * cc + t2v * ssv;
            qpJ[k * n + j] = xny * (t1v + qpJ[k * n + j - 1]) - t2v;
          }
        }

        iq++;

        for (let k = 0; k < iq; k++) {
          qpR[k * n + iq - 1] = qpD[k];
        }

        if (Math.abs(qpD[iq - 1]) <= EPS_MACHINE * RNorm) {
          // Degenerate - revert
          qpIaexcl[ip] = 0;

          // Delete constraint
          let qq = -1;
          for (let i = p; i < iq; i++) {
            if (qpA[i] === ip) {
              qq = i;
              break;
            }
          }

          if (qq >= 0) {
            for (let i = qq; i < iq - 1; i++) {
              qpA[i] = qpA[i + 1];
              qpU[i] = qpU[i + 1];
              for (let j = 0; j < n; j++) {
                qpR[j * n + i] = qpR[j * n + i + 1];
              }
            }
            iq--;
          }

          for (let i = 0; i < m; i++) {
            qpIai[i] = i;
          }
          for (let i = 0; i < iq; i++) {
            qpA[i] = qpAOld[i];
            if (qpA[i] >= 0) qpIai[qpA[i]] = -1;
            qpU[i] = qpUOld[i];
          }
          for (let i = 0; i < n; i++) {
            x[xOffset + i] = qpXOld[i];
          }
          break;
        }

        RNorm = Math.max(RNorm, Math.abs(qpD[iq - 1]));
        qpIai[ip] = -1;
        break;
      }

      // Partial step - remove constraint l
      qpIai[l] = l;

      // Delete constraint l
      let qq = -1;
      for (let i = p; i < iq; i++) {
        if (qpA[i] === l) {
          qq = i;
          break;
        }
      }

      if (qq >= 0) {
        for (let i = qq; i < iq - 1; i++) {
          qpA[i] = qpA[i + 1];
          qpU[i] = qpU[i + 1];
          for (let j = 0; j < n; j++) {
            qpR[j * n + i] = qpR[j * n + i + 1];
          }
        }

        qpA[iq - 1] = qpA[iq];
        qpU[iq - 1] = qpU[iq];
        qpA[iq] = 0;
        qpU[iq] = 0;

        for (let j = 0; j < iq; j++) {
          qpR[j * n + iq - 1] = 0;
        }

        iq--;

        // Restore R and J
        for (let j = qq; j < iq; j++) {
          let cc = qpR[j * n + j];
          let ssv = qpR[(j + 1) * n + j];
          const h = giDistance(cc, ssv);
          if (h === 0) continue;

          cc = cc / h;
          ssv = ssv / h;
          qpR[(j + 1) * n + j] = 0;

          if (cc < 0) {
            qpR[j * n + j] = -h;
            cc = -cc;
            ssv = -ssv;
          } else {
            qpR[j * n + j] = h;
          }

          const xny = ssv / (1.0 + cc);
          for (let k = j + 1; k < iq; k++) {
            const t1v = qpR[j * n + k];
            const t2v = qpR[(j + 1) * n + k];
            qpR[j * n + k] = t1v * cc + t2v * ssv;
            qpR[(j + 1) * n + k] = xny * (t1v + qpR[j * n + k]) - t2v;
          }

          for (let k = 0; k < n; k++) {
            const t1v = qpJ[k * n + j];
            const t2v = qpJ[k * n + j + 1];
            qpJ[k * n + j] = t1v * cc + t2v * ssv;
            qpJ[k * n + j + 1] = xny * (qpJ[k * n + j] + t1v) - t2v;
          }
        }
      }

      // Update s[ip]
      qpS[ip] = ci0[ci0Offset + ip];
      for (let k = 0; k < n; k++) {
        qpS[ip] += CI[ciOffset + k * m + ip] * x[xOffset + k];
      }
    }
  }

  return fValue;
}

// ============================================================================
// 2D GEOMETRY (FOR UV FOLDOVER)
// ============================================================================

/**
 * Signed area of 2D triangle (positive if CCW)
 */
export function signedTriangleArea2D(
  a: Float32Array,
  aOffset: number,
  b: Float32Array,
  bOffset: number,
  c: Float32Array,
  cOffset: number,
): number {
  return (
    0.5 *
    ((b[bOffset] - a[aOffset]) * (c[cOffset + 1] - a[aOffset + 1]) -
      (c[cOffset] - a[aOffset]) * (b[bOffset + 1] - a[aOffset + 1]))
  );
}

/**
 * Check if two points are on the same side of a line
 */
export function twoPointsOnSameSide(
  lineP1: Float32Array,
  lineP1Offset: number,
  lineP2: Float32Array,
  lineP2Offset: number,
  p1: Float32Array,
  p1Offset: number,
  p2: Float32Array,
  p2Offset: number,
): boolean {
  const x1 = lineP1[lineP1Offset];
  const y1 = lineP1[lineP1Offset + 1];
  const x2 = lineP2[lineP2Offset];
  const y2 = lineP2[lineP2Offset + 1];

  // Handle degenerate case
  if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) {
    return true;
  }

  // Vertical line
  if (Math.abs(x1 - x2) < EPS) {
    const d1 = x1 - p1[p1Offset];
    const d2 = x1 - p2[p2Offset];
    return d1 * d2 > -EPS;
  }

  // General case
  const k = (y2 - y1) / (x2 - x1);
  const b = y1 - x1 * k;

  const d1 = p1[p1Offset] * k + b - p1[p1Offset + 1];
  const d2 = p2[p2Offset] * k + b - p2[p2Offset + 1];

  return d1 * d2 > -EPS;
}
