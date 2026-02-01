/**
 * Optimized Quadric Error Metric Computation
 *
 * Computes 5D QEM (3D position + 2D UV) for each vertex-TC pair.
 * Based on Section 5.1 of the "Seamless" SIGGRAPH Asia 2017 paper.
 */

import {
  OptimizedMeshData,
  OptimizedVertexMetrics,
  EPS,
  MATRIX_6X6_SIZE,
} from "./types.js";
import {
  dot5,
  norm5,
  sub5,
  scale5,
  zero6x6,
  set6x6,
  addInPlace6x6,
} from "./math.js";

// ============================================================================
// PRE-ALLOCATED WORKSPACE
// ============================================================================

// 5D points for face metric computation
const p1 = new Float64Array(5);
const p2 = new Float64Array(5);
const p3 = new Float64Array(5);

// Basis vectors
const v12 = new Float64Array(5);
const v13 = new Float64Array(5);
const e1 = new Float64Array(5);
const e2raw = new Float64Array(5);
const e2 = new Float64Array(5);
const proj = new Float64Array(5);

// Temporary matrices
const I5 = new Float64Array(25);
const e1e1T = new Float64Array(25);
const e2e2T = new Float64Array(25);
const A5 = new Float64Array(25);
const b5 = new Float64Array(5);
const faceMetric = new Float64Array(MATRIX_6X6_SIZE);

// Initialize I5 as identity
for (let i = 0; i < 5; i++) {
  I5[i * 5 + i] = 1;
}

// ============================================================================
// FACE METRIC COMPUTATION
// ============================================================================

/**
 * Compute 5D metric for a single face.
 *
 * The metric measures squared distance from a 5D point (x,y,z,u,v) to the
 * 5D plane defined by the face's three vertices.
 *
 * @param mesh Mesh data
 * @param fi Face index
 * @param out Output 6×6 matrix (36 floats, row-major)
 */
function computeFaceMetric5D(
  mesh: OptimizedMeshData,
  fi: number,
  out: Float64Array,
): void {
  const base = fi * 3;

  // Get vertex indices
  const v0i = mesh.faceVertices[base];
  const v1i = mesh.faceVertices[base + 1];
  const v2i = mesh.faceVertices[base + 2];

  // Get texture indices
  const t0i = mesh.faceTexCoords[base];
  const t1i = mesh.faceTexCoords[base + 1];
  const t2i = mesh.faceTexCoords[base + 2];

  // Build 5D points (x, y, z, u, v)
  p1[0] = mesh.positions[v0i * 3];
  p1[1] = mesh.positions[v0i * 3 + 1];
  p1[2] = mesh.positions[v0i * 3 + 2];
  p1[3] = mesh.uvs[t0i * 2];
  p1[4] = mesh.uvs[t0i * 2 + 1];

  p2[0] = mesh.positions[v1i * 3];
  p2[1] = mesh.positions[v1i * 3 + 1];
  p2[2] = mesh.positions[v1i * 3 + 2];
  p2[3] = mesh.uvs[t1i * 2];
  p2[4] = mesh.uvs[t1i * 2 + 1];

  p3[0] = mesh.positions[v2i * 3];
  p3[1] = mesh.positions[v2i * 3 + 1];
  p3[2] = mesh.positions[v2i * 3 + 2];
  p3[3] = mesh.uvs[t2i * 2];
  p3[4] = mesh.uvs[t2i * 2 + 1];

  // Compute orthonormal basis in 5D
  // e1 = normalize(p2 - p1)
  sub5(p2, 0, p1, 0, v12, 0);
  const e1Norm = norm5(v12, 0);

  if (e1Norm < EPS) {
    // Degenerate triangle - return zero metric
    zero6x6(out, 0);
    return;
  }

  scale5(v12, 0, 1 / e1Norm, e1, 0);

  // e2 = normalize((p3 - p1) - (e1 · (p3 - p1)) * e1)
  sub5(p3, 0, p1, 0, v13, 0);
  const projLen = dot5(e1, 0, v13, 0);
  scale5(e1, 0, projLen, proj, 0);
  sub5(v13, 0, proj, 0, e2raw, 0);

  const e2Norm = norm5(e2raw, 0);
  if (e2Norm < EPS) {
    // Degenerate triangle - return zero metric
    zero6x6(out, 0);
    return;
  }

  scale5(e2raw, 0, 1 / e2Norm, e2, 0);

  // A = I - e1⊗e1 - e2⊗e2 (5×5 matrix)
  // Clear workspace
  e1e1T.fill(0);
  e2e2T.fill(0);

  // Compute outer products
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      e1e1T[i * 5 + j] = e1[i] * e1[j];
      e2e2T[i * 5 + j] = e2[i] * e2[j];
    }
  }

  // A = I - e1e1T - e2e2T
  for (let i = 0; i < 25; i++) {
    A5[i] = I5[i] - e1e1T[i] - e2e2T[i];
  }

  // b = (p1 · e1) * e1 + (p1 · e2) * e2 - p1
  const p1DotE1 = dot5(p1, 0, e1, 0);
  const p1DotE2 = dot5(p1, 0, e2, 0);
  for (let i = 0; i < 5; i++) {
    b5[i] = p1DotE1 * e1[i] + p1DotE2 * e2[i] - p1[i];
  }

  // c = p1 · p1 - (p1 · e1)² - (p1 · e2)²
  const c = dot5(p1, 0, p1, 0) - p1DotE1 * p1DotE1 - p1DotE2 * p1DotE2;

  // Build 6×6 metric:
  // [ A   b ]
  // [ b^T c ]
  zero6x6(out, 0);

  // Copy A (5×5) to upper-left
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      set6x6(out, 0, i, j, A5[i * 5 + j]);
    }
  }

  // Set b in column 5 and row 5
  for (let i = 0; i < 5; i++) {
    set6x6(out, 0, i, 5, b5[i]);
    set6x6(out, 0, 5, i, b5[i]);
  }

  // Set c at (5, 5)
  set6x6(out, 0, 5, 5, c);
}

// ============================================================================
// COMPUTE ALL VERTEX METRICS
// ============================================================================

/**
 * Compute 5D quadric error metrics for all vertices.
 *
 * For each face, computes its 5D metric and accumulates it to each vertex.
 * Vertices on seams will have multiple metrics (one per unique TC index).
 *
 * @param mesh Mesh data
 * @returns Per-vertex metrics
 */
export function computeVertexMetrics(
  mesh: OptimizedMeshData,
): OptimizedVertexMetrics {
  const metrics = new OptimizedVertexMetrics(mesh.vertexCount);

  for (let fi = 0; fi < mesh.faceCount; fi++) {
    // Skip deleted faces
    if (mesh.isFaceDeleted(fi)) continue;

    // Compute face metric
    computeFaceMetric5D(mesh, fi, faceMetric);

    // Add metric to each vertex-TC pair in the face
    const base = fi * 3;
    for (let corner = 0; corner < 3; corner++) {
      const vi = mesh.faceVertices[base + corner];
      const tci = mesh.faceTexCoords[base + corner];

      metrics.addMetric(vi, tci, faceMetric);
    }
  }

  return metrics;
}

// ============================================================================
// GET COMBINED METRIC
// ============================================================================

/**
 * Get combined metric for two vertex-TC pairs being merged.
 *
 * @param metrics Vertex metrics
 * @param vi1 First vertex index
 * @param tci1 First TC index
 * @param vi2 Second vertex index
 * @param tci2 Second TC index
 * @param out Output 6×6 matrix
 */
export function getCombinedMetric(
  metrics: OptimizedVertexMetrics,
  vi1: number,
  tci1: number,
  vi2: number,
  tci2: number,
  out: Float64Array,
): void {
  zero6x6(out, 0);

  const offset1 = metrics.getMetricOffset(vi1, tci1);
  const offset2 = metrics.getMetricOffset(vi2, tci2);

  if (offset1 !== -1) {
    addInPlace6x6(out, 0, metrics.metrics, offset1);
  }

  if (offset2 !== -1) {
    addInPlace6x6(out, 0, metrics.metrics, offset2);
  }
}
