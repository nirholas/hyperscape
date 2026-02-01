/**
 * Optimized Cost and Placement Computation
 *
 * Computes the cost of collapsing an edge and the optimal placement
 * of the new vertex, taking into account seam preservation.
 */

import {
  OptimizedMeshData,
  OptimizedEdgeFlaps,
  OptimizedVertexMetrics,
  OptimizedSeamEdgeSet,
  OptimizedSeamVertexMap,
  PlacementBuffer,
  EPS,
  INF,
  MATRIX_6X6_SIZE,
  MATRIX_8X8_SIZE,
  MAX_BONES_PER_VERTEX,
} from "./types.js";
import { HalfEdgeBundle, getHalfEdgeBundle } from "./connectivity.js";
import { getCombinedMetric } from "./quadric.js";
import { interpolateSkinWeights } from "./collapse.js";
import {
  midpoint3,
  midpoint2,
  quadraticForm6,
  zero8x8,
  get6x6,
  get8x8,
  set8x8,
  solveQP,
} from "./math.js";

// ============================================================================
// PRE-ALLOCATED WORKSPACE
// ============================================================================

// Edge endpoints
const vi = new Uint32Array(2);

// Seam endpoint bundles
const eP0 = [
  { vi: 0, tci: 0 },
  { vi: 0, tci: 0 },
];
const eP1 = [
  { vi: 0, tci: 0 },
  { vi: 0, tci: 0 },
];

// Combined metrics for seam edges (2 × 6×6)
const m0 = new Float64Array(MATRIX_6X6_SIZE);
const m1 = new Float64Array(MATRIX_6X6_SIZE);

// For regular edge
const combinedMetric = new Float64Array(MATRIX_6X6_SIZE);

// QP workspace
const G6 = new Float64Array(MATRIX_6X6_SIZE);
const G8 = new Float64Array(MATRIX_8X8_SIZE);
const g0_6 = new Float64Array(6);
const g0_8 = new Float64Array(8);
const CE_6 = new Float64Array(6); // Single constraint
const CE_8 = new Float64Array(32); // 8 × 4
const ce0_6 = new Float64Array(1);
const ce0_8 = new Float64Array(4);
const CI_8 = new Float64Array(16); // 8 × 2
const ci0_8 = new Float64Array(2);
const x_6 = new Float64Array(6);
const x_8 = new Float64Array(8);
const v6 = new Float64Array(6);

// Midpoint computation
const midPos = new Float32Array(3);
const midUV = new Float32Array(2);
const midUV0 = new Float32Array(2);
const midUV1 = new Float32Array(2);

// UV vectors for seam constraint computation
const vec0 = new Float32Array(2);
const vec1 = new Float32Array(2);

// Temporary UV storage
const tc_e0_0 = new Float32Array(2);
const tc_e1_0 = new Float32Array(2);
const tc_e0_1 = new Float32Array(2);
const tc_e1_1 = new Float32Array(2);
const tcj_val = new Float32Array(2);

// Seam neighbors
const seamNeighbors = new Int32Array(8);
const vjTCs = new Int32Array(4);

// Skin weight interpolation workspace
const skinIndicesOut = new Uint16Array(MAX_BONES_PER_VERTEX);
const skinWeightsOut = new Float32Array(MAX_BONES_PER_VERTEX);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if three UV points are collinear
 */
function isCollinear(
  tc1u: number,
  tc1v: number,
  tc2u: number,
  tc2v: number,
  tc3u: number,
  tc3v: number,
): boolean {
  const n1u = tc2u - tc1u;
  const n1v = tc2v - tc1v;
  const n2u = tc3u - tc1u;
  const n2v = tc3v - tc1v;

  const len1 = Math.sqrt(n1u * n1u + n1v * n1v);
  const len2 = Math.sqrt(n2u * n2u + n2v * n2v);

  if (len1 < EPS || len2 < EPS) return true;

  const dot = (n1u / len1) * (n2u / len2) + (n1v / len1) * (n2v / len2);
  return 1 - Math.abs(dot) < EPS;
}

/**
 * Compute edge ratio for seam-aware strictness
 */
function edgeRatio(
  tc1u: number,
  tc1v: number,
  tc2u: number,
  tc2v: number,
  tc3u: number,
  tc3v: number,
): number {
  const len1 = Math.sqrt(
    (tc2u - tc1u) * (tc2u - tc1u) + (tc2v - tc1v) * (tc2v - tc1v),
  );
  const len2 = Math.sqrt(
    (tc3u - tc2u) * (tc3u - tc2u) + (tc3v - tc2v) * (tc3v - tc2v),
  );

  if (len2 < EPS) return INF;
  return len1 / len2;
}

// ============================================================================
// COST AND PLACEMENT COMPUTATION
// ============================================================================

/**
 * Compute cost and placement for an edge collapse.
 *
 * @param ei Edge index
 * @param flaps Edge connectivity
 * @param mesh Mesh data
 * @param metrics Vertex metrics
 * @param seamEdges Seam edge set
 * @param seamVertices Seam vertex map
 * @param strictness Seam-awareness level (0, 1, or 2)
 * @param placement Output placement buffer
 * @returns Cost of collapse (INF if not collapsible)
 */
export function computeCostAndPlacement(
  ei: number,
  flaps: OptimizedEdgeFlaps,
  mesh: OptimizedMeshData,
  metrics: OptimizedVertexMetrics,
  seamEdges: OptimizedSeamEdgeSet,
  seamVertices: OptimizedSeamVertexMap,
  strictness: 0 | 1 | 2,
  placement: PlacementBuffer,
): number {
  placement.reset();

  // Get half-edge bundle
  const bundle = getHalfEdgeBundle(ei, flaps, mesh);

  if (bundle.count < 2) {
    // Boundary edge - don't collapse
    return INF;
  }

  // Get edge vertices
  const [v0, v1] = flaps.getEdge(ei);
  vi[0] = v0;
  vi[1] = v1;

  // Check if both vertices are on seams but no seam edge between them
  const v0OnSeam = seamVertices.isOnSeam(v0);
  const v1OnSeam = seamVertices.isOnSeam(v1);
  const isSeamEdge = seamEdges.has(v0, v1);

  if (v0OnSeam && v1OnSeam && !isSeamEdge) {
    return INF;
  }

  if (isSeamEdge) {
    return computeSeamEdgeCost(
      bundle,
      mesh,
      metrics,
      seamEdges,
      seamVertices,
      strictness,
      placement,
    );
  } else {
    return computeRegularEdgeCost(
      bundle,
      mesh,
      metrics,
      seamEdges,
      seamVertices,
      placement,
    );
  }
}

/**
 * Compute cost for a seam edge
 */
function computeSeamEdgeCost(
  bundle: HalfEdgeBundle,
  mesh: OptimizedMeshData,
  metrics: OptimizedVertexMetrics,
  seamEdges: OptimizedSeamEdgeSet,
  seamVertices: OptimizedSeamVertexMap,
  strictness: 0 | 1 | 2,
  placement: PlacementBuffer,
): number {
  // Get endpoints for both sides
  // Side 0: [start_vi, start_tci, end_vi, end_tci]
  eP0[0].vi = bundle.side0[0];
  eP0[0].tci = bundle.side0[1];
  eP0[1].vi = bundle.side1[0];
  eP0[1].tci = bundle.side1[1];

  eP1[0].vi = bundle.side0[2];
  eP1[0].tci = bundle.side0[3];
  eP1[1].vi = bundle.side1[2];
  eP1[1].tci = bundle.side1[3];

  // Edge vertex indices (sorted)
  vi[0] = eP0[0].vi < eP1[0].vi ? eP0[0].vi : eP1[0].vi;
  vi[1] = eP0[0].vi < eP1[0].vi ? eP1[0].vi : eP0[0].vi;

  // Get combined metrics for both sides
  getCombinedMetric(metrics, eP0[0].vi, eP0[0].tci, eP1[0].vi, eP1[0].tci, m0);
  getCombinedMetric(metrics, eP0[1].vi, eP0[1].tci, eP1[1].vi, eP1[1].tci, m1);

  // Check which ends are "free" to collapse
  const isFree = [false, false];

  for (let end = 0; end < 2; end++) {
    const vEnd = vi[end];
    const seamCount = seamVertices.getSeamNeighborCount(vEnd);

    if (seamCount !== 2) continue;

    const neighborCount = seamVertices.getSeamNeighbors(vEnd, seamNeighbors);

    for (let ni = 0; ni < neighborCount; ni++) {
      const vj = seamNeighbors[ni];
      if (vj === vi[1 - end]) continue;

      // Get TC indices for neighbor
      const vjTCCount = metrics.getVertexTCIndices(vj, vjTCs);
      if (vjTCCount === 0) continue;

      const ratio = [INF, INF];

      // Get UVs for edge endpoints
      mesh.getUV(eP0[0].tci, tc_e0_0);
      mesh.getUV(eP1[0].tci, tc_e1_0);
      mesh.getUV(eP0[1].tci, tc_e0_1);
      mesh.getUV(eP1[1].tci, tc_e1_1);

      for (let ti = 0; ti < vjTCCount; ti++) {
        const tcj = vjTCs[ti];
        mesh.getUV(tcj, tcj_val);

        if (
          isCollinear(
            tcj_val[0],
            tcj_val[1],
            tc_e0_0[0],
            tc_e0_0[1],
            tc_e1_0[0],
            tc_e1_0[1],
          )
        ) {
          ratio[0] = edgeRatio(
            tcj_val[0],
            tcj_val[1],
            tc_e0_0[0],
            tc_e0_0[1],
            tc_e1_0[0],
            tc_e1_0[1],
          );
        }
        if (
          isCollinear(
            tcj_val[0],
            tcj_val[1],
            tc_e1_1[0],
            tc_e1_1[1],
            tc_e0_1[0],
            tc_e0_1[1],
          )
        ) {
          ratio[1] = edgeRatio(
            tcj_val[0],
            tcj_val[1],
            tc_e1_1[0],
            tc_e1_1[1],
            tc_e0_1[0],
            tc_e0_1[1],
          );
        }
      }

      switch (strictness) {
        case 0:
          isFree[end] = true;
          break;
        case 1:
          if (ratio[0] !== INF && ratio[1] !== INF) {
            isFree[end] = true;
          }
          break;
        case 2:
          if (
            ratio[0] !== INF &&
            ratio[1] !== INF &&
            Math.abs(ratio[0] - ratio[1]) <= 1e-3
          ) {
            isFree[end] = true;
          }
          break;
      }
    }
  }

  // Neither end is free - can't collapse
  if (!isFree[0] && !isFree[1]) {
    return INF;
  }

  // If one end is not free, collapse to that end
  for (let end = 0; end < 2; end++) {
    if (!isFree[end]) {
      const vEnd = vi[end];
      let cost = 0;

      // Get position
      mesh.getPosition(vEnd, placement.position);

      // Get UVs for both sides
      for (let side = 0; side < 2; side++) {
        const p = side === 0 ? bundle.side0 : bundle.side1;
        const m = side === 0 ? m0 : m1;

        // Find the TC for this vertex on this side
        const tc = p[0] === vEnd ? p[1] : p[3];

        // Build 6D point
        v6[0] = placement.position[0];
        v6[1] = placement.position[1];
        v6[2] = placement.position[2];
        mesh.getUV(tc, midUV);
        v6[3] = midUV[0];
        v6[4] = midUV[1];
        v6[5] = 1;

        cost += quadraticForm6(v6, 0, m, 0);
        placement.setTC(side, midUV[0], midUV[1]);
      }

      placement.metricCount = 2;
      placement.metrics.set(m0, 0);
      placement.metrics.set(m1, MATRIX_6X6_SIZE);

      // Interpolate skin weights: collapse to the fixed end
      // t = 0 when end = 0 (use vi[0]'s weights), t = 1 when end = 1 (use vi[1]'s weights)
      const t = end === 0 ? 0.0 : 1.0;
      if (
        interpolateSkinWeights(
          mesh,
          vi[0],
          vi[1],
          t,
          skinIndicesOut,
          skinWeightsOut,
        )
      ) {
        placement.setSkinData(skinIndicesOut, skinWeightsOut);
      }

      return cost;
    }
  }

  // Both ends are free - optimize placement along the seam
  return computeSeamOptimalPlacement(bundle, mesh, m0, m1, placement);
}

/**
 * Compute optimal placement when both seam endpoints are free
 */
function computeSeamOptimalPlacement(
  bundle: HalfEdgeBundle,
  mesh: OptimizedMeshData,
  m0Metric: Float64Array,
  m1Metric: Float64Array,
  placement: PlacementBuffer,
): number {
  // Get endpoint info
  eP0[0].vi = bundle.side0[0];
  eP0[0].tci = bundle.side0[1];
  eP0[1].vi = bundle.side1[0];
  eP0[1].tci = bundle.side1[1];

  eP1[0].vi = bundle.side0[2];
  eP1[0].tci = bundle.side0[3];
  eP1[1].vi = bundle.side1[2];
  eP1[1].tci = bundle.side1[3];

  // Build combined 8×8 metric for (x, y, z, u0, v0, u1, v1, 1)
  zero8x8(G8, 0);

  // Position part (3×3) - sum of both metrics
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      set8x8(
        G8,
        0,
        i,
        j,
        get6x6(m0Metric, 0, i, j) + get6x6(m1Metric, 0, i, j),
      );
    }
  }

  // Side 0 UV (at positions 3,4) - from m0
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      set8x8(G8, 0, 3 + i, j, get6x6(m0Metric, 0, 3 + i, j));
      set8x8(G8, 0, j, 3 + i, get6x6(m0Metric, 0, j, 3 + i));
    }
    for (let j = 0; j < 2; j++) {
      set8x8(G8, 0, 3 + i, 3 + j, get6x6(m0Metric, 0, 3 + i, 3 + j));
    }
  }

  // Side 1 UV (at positions 5,6) - from m1
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      set8x8(G8, 0, 5 + i, j, get6x6(m1Metric, 0, 3 + i, j));
      set8x8(G8, 0, j, 5 + i, get6x6(m1Metric, 0, j, 3 + i));
    }
    for (let j = 0; j < 2; j++) {
      set8x8(G8, 0, 5 + i, 5 + j, get6x6(m1Metric, 0, 3 + i, 3 + j));
    }
  }

  // Linear terms (row/col 7)
  g0_8.fill(0);
  for (let i = 0; i < 3; i++) {
    g0_8[i] = get6x6(m0Metric, 0, 5, i) + get6x6(m1Metric, 0, 5, i);
  }
  for (let i = 0; i < 2; i++) {
    g0_8[3 + i] = get6x6(m0Metric, 0, 5, 3 + i);
    g0_8[5 + i] = get6x6(m1Metric, 0, 5, 3 + i);
  }

  for (let i = 0; i < 7; i++) {
    set8x8(G8, 0, 7, i, g0_8[i]);
    set8x8(G8, 0, i, 7, g0_8[i]);
  }
  set8x8(G8, 0, 7, 7, get6x6(m0Metric, 0, 5, 5) + get6x6(m1Metric, 0, 5, 5));

  // Add regularizer
  const w = 1e-6;
  for (let i = 0; i < 8; i++) {
    const val = get8x8(G8, 0, i, i);
    set8x8(G8, 0, i, i, val + w);
  }

  // Get midpoint for initial guess
  const p0 = new Float32Array(3);
  const p1 = new Float32Array(3);
  mesh.getPosition(eP0[0].vi, p0);
  mesh.getPosition(eP1[0].vi, p1);
  midpoint3(p0, 0, p1, 0, midPos, 0);

  mesh.getUV(eP0[0].tci, tc_e0_0);
  mesh.getUV(eP1[0].tci, tc_e1_0);
  midpoint2(tc_e0_0, 0, tc_e1_0, 0, midUV0, 0);

  mesh.getUV(eP0[1].tci, tc_e0_1);
  mesh.getUV(eP1[1].tci, tc_e1_1);
  midpoint2(tc_e0_1, 0, tc_e1_1, 0, midUV1, 0);

  // Linear term with regularization
  g0_8[0] = -w * midPos[0];
  g0_8[1] = -w * midPos[1];
  g0_8[2] = -w * midPos[2];
  g0_8[3] = -w * midUV0[0];
  g0_8[4] = -w * midUV0[1];
  g0_8[5] = -w * midUV1[0];
  g0_8[6] = -w * midUV1[1];
  g0_8[7] = -w;

  // UV direction vectors
  vec0[0] = tc_e1_0[0] - tc_e0_0[0];
  vec0[1] = tc_e1_0[1] - tc_e0_0[1];
  vec1[0] = tc_e1_1[0] - tc_e0_1[0];
  vec1[1] = tc_e1_1[1] - tc_e0_1[1];

  // Build equality constraint matrix CE (8 × 4)
  CE_8.fill(0);
  ce0_8.fill(0);

  // Constraint 1: x[7] = 1
  CE_8[7 * 4 + 0] = 1;
  ce0_8[0] = -1;

  // Constraints 2-4: UV parameter synchronization
  if (Math.abs(vec0[0]) > EPS) {
    CE_8[3 * 4 + 1] = -vec0[1];
    CE_8[4 * 4 + 1] = vec0[0];
    ce0_8[1] = vec0[1] * tc_e0_0[0] - vec0[0] * tc_e0_0[1];

    CE_8[3 * 4 + 2] = -vec1[0];
    CE_8[5 * 4 + 2] = vec0[0];
    ce0_8[2] = vec1[0] * tc_e0_0[0] - vec0[0] * tc_e0_1[0];

    CE_8[3 * 4 + 3] = -vec1[1];
    CE_8[6 * 4 + 3] = vec0[0];
    ce0_8[3] = vec1[1] * tc_e0_0[0] - vec0[0] * tc_e0_1[1];
  } else if (Math.abs(vec0[1]) > EPS) {
    CE_8[4 * 4 + 1] = -vec0[0];
    CE_8[3 * 4 + 1] = vec0[1];
    ce0_8[1] = vec0[0] * tc_e0_0[1] - vec0[1] * tc_e0_0[0];

    CE_8[4 * 4 + 2] = -vec1[0];
    CE_8[5 * 4 + 2] = vec0[1];
    ce0_8[2] = vec1[0] * tc_e0_0[1] - vec0[1] * tc_e0_1[0];

    CE_8[4 * 4 + 3] = -vec1[1];
    CE_8[6 * 4 + 3] = vec0[1];
    ce0_8[3] = vec1[1] * tc_e0_0[1] - vec0[1] * tc_e0_1[1];
  }

  // Inequality constraints: t in [0, 1]
  CI_8.fill(0);
  ci0_8.fill(0);

  if (Math.abs(vec0[0]) > EPS) {
    const sign = vec0[0] > 0 ? 1 : -1;
    CI_8[3 * 2 + 0] = sign;
    ci0_8[0] = -sign * tc_e0_0[0];
    CI_8[3 * 2 + 1] = -sign;
    ci0_8[1] = sign * (tc_e0_0[0] + vec0[0]);
  } else if (Math.abs(vec0[1]) > EPS) {
    const sign = vec0[1] > 0 ? 1 : -1;
    CI_8[4 * 2 + 0] = sign;
    ci0_8[0] = -sign * tc_e0_0[1];
    CI_8[4 * 2 + 1] = -sign;
    ci0_8[1] = sign * (tc_e0_0[1] + vec0[1]);
  }

  // Solve QP
  const cost = solveQP(
    8,
    G8,
    0,
    g0_8,
    0,
    4,
    CE_8,
    0,
    ce0_8,
    0,
    2,
    CI_8,
    0,
    ci0_8,
    0,
    x_8,
    0,
  );

  // Check ALL output components for validity, not just x and u
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(x_8[0]) ||
    !Number.isFinite(x_8[1]) ||
    !Number.isFinite(x_8[2]) ||
    !Number.isFinite(x_8[3]) ||
    !Number.isFinite(x_8[4]) ||
    !Number.isFinite(x_8[5]) ||
    !Number.isFinite(x_8[6])
  ) {
    return INF;
  }

  placement.position[0] = x_8[0];
  placement.position[1] = x_8[1];
  placement.position[2] = x_8[2];
  placement.setTC(0, x_8[3], x_8[4]);
  placement.setTC(1, x_8[5], x_8[6]);
  placement.metricCount = 2;
  placement.metrics.set(m0Metric, 0);
  placement.metrics.set(m1Metric, MATRIX_6X6_SIZE);

  // Compute interpolation factor t from position along edge
  // Use positions from eP0[0] and eP1[0] (the first side's vertices)
  const edgeDx = p1[0] - p0[0];
  const edgeDy = p1[1] - p0[1];
  const edgeDz = p1[2] - p0[2];
  const edgeLenSq = edgeDx * edgeDx + edgeDy * edgeDy + edgeDz * edgeDz;

  let t = 0.5; // Default to midpoint
  if (edgeLenSq > EPS) {
    const dotProduct =
      (x_8[0] - p0[0]) * edgeDx +
      (x_8[1] - p0[1]) * edgeDy +
      (x_8[2] - p0[2]) * edgeDz;
    t = Math.max(0, Math.min(1, dotProduct / edgeLenSq));
  }

  // Interpolate skin weights
  if (
    interpolateSkinWeights(
      mesh,
      eP0[0].vi,
      eP1[0].vi,
      t,
      skinIndicesOut,
      skinWeightsOut,
    )
  ) {
    placement.setSkinData(skinIndicesOut, skinWeightsOut);
  }

  return cost;
}

/**
 * Compute cost for a regular (non-seam) edge
 */
function computeRegularEdgeCost(
  bundle: HalfEdgeBundle,
  mesh: OptimizedMeshData,
  metrics: OptimizedVertexMetrics,
  seamEdges: OptimizedSeamEdgeSet,
  seamVertices: OptimizedSeamVertexMap,
  placement: PlacementBuffer,
): number {
  // For regular edges, both sides should have matching vertex-TC pairs
  // Side 0: [vi0, tci0, vi1, tci1]
  // Side 1: [vi1, tci1, vi0, tci0] (reversed)

  const vi0 = bundle.side0[0];
  const tci0 = bundle.side0[1];
  const vi1 = bundle.side0[2];
  const tci1 = bundle.side0[3];

  // Get combined metric
  getCombinedMetric(metrics, vi0, tci0, vi1, tci1, combinedMetric);

  // Check if one vertex is on a seam (but edge is not)
  const v0OnSeam = seamVertices.isOnSeam(vi0);
  const v1OnSeam = seamVertices.isOnSeam(vi1);

  // If one vertex is on seam, collapse to that vertex
  if (v0OnSeam && !v1OnSeam) {
    mesh.getPosition(vi0, placement.position);
    mesh.getUV(tci0, midUV);

    v6[0] = placement.position[0];
    v6[1] = placement.position[1];
    v6[2] = placement.position[2];
    v6[3] = midUV[0];
    v6[4] = midUV[1];
    v6[5] = 1;

    const cost = quadraticForm6(v6, 0, combinedMetric, 0);
    placement.setTC(0, midUV[0], midUV[1]);
    placement.metricCount = 1;
    placement.metrics.set(combinedMetric, 0);

    // Interpolate skin weights: t=0 means use vi0's weights
    if (
      interpolateSkinWeights(
        mesh,
        vi0,
        vi1,
        0.0,
        skinIndicesOut,
        skinWeightsOut,
      )
    ) {
      placement.setSkinData(skinIndicesOut, skinWeightsOut);
    }

    return cost;
  }

  if (v1OnSeam && !v0OnSeam) {
    mesh.getPosition(vi1, placement.position);
    mesh.getUV(tci1, midUV);

    v6[0] = placement.position[0];
    v6[1] = placement.position[1];
    v6[2] = placement.position[2];
    v6[3] = midUV[0];
    v6[4] = midUV[1];
    v6[5] = 1;

    const cost = quadraticForm6(v6, 0, combinedMetric, 0);
    placement.setTC(0, midUV[0], midUV[1]);
    placement.metricCount = 1;
    placement.metrics.set(combinedMetric, 0);

    // Interpolate skin weights: t=1 means use vi1's weights
    if (
      interpolateSkinWeights(
        mesh,
        vi0,
        vi1,
        1.0,
        skinIndicesOut,
        skinWeightsOut,
      )
    ) {
      placement.setSkinData(skinIndicesOut, skinWeightsOut);
    }

    return cost;
  }

  // Neither on seam - solve for optimal position
  const w = 1e-6;

  // Copy metric and add regularizer
  G6.set(combinedMetric);
  for (let i = 0; i < 6; i++) {
    G6[i * 6 + i] += w;
  }

  // Compute midpoint for initial guess
  const p0 = new Float32Array(3);
  const p1 = new Float32Array(3);
  mesh.getPosition(vi0, p0);
  mesh.getPosition(vi1, p1);
  midpoint3(p0, 0, p1, 0, midPos, 0);

  const uv0 = new Float32Array(2);
  const uv1 = new Float32Array(2);
  mesh.getUV(tci0, uv0);
  mesh.getUV(tci1, uv1);
  midpoint2(uv0, 0, uv1, 0, midUV, 0);

  // Linear term with regularization
  g0_6[0] = -w * midPos[0];
  g0_6[1] = -w * midPos[1];
  g0_6[2] = -w * midPos[2];
  g0_6[3] = -w * midUV[0];
  g0_6[4] = -w * midUV[1];
  g0_6[5] = -w;

  // Equality constraint: x[5] = 1
  CE_6.fill(0);
  CE_6[5] = 1;
  ce0_6[0] = -1;

  // No inequality constraints for regular edges
  const emptyCI = new Float64Array(0);
  const emptyCi0 = new Float64Array(0);

  const cost = solveQP(
    6,
    G6,
    0,
    g0_6,
    0,
    1,
    CE_6,
    0,
    ce0_6,
    0,
    0,
    emptyCI,
    0,
    emptyCi0,
    0,
    x_6,
    0,
  );

  // Check ALL output components for validity (x, y, z, u, v)
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(x_6[0]) ||
    !Number.isFinite(x_6[1]) ||
    !Number.isFinite(x_6[2]) ||
    !Number.isFinite(x_6[3]) ||
    !Number.isFinite(x_6[4])
  ) {
    // Fallback to midpoint
    placement.position[0] = midPos[0];
    placement.position[1] = midPos[1];
    placement.position[2] = midPos[2];
    placement.setTC(0, midUV[0], midUV[1]);
    placement.metricCount = 1;
    placement.metrics.set(combinedMetric, 0);

    // Interpolate skin weights at midpoint (t=0.5)
    if (
      interpolateSkinWeights(
        mesh,
        vi0,
        vi1,
        0.5,
        skinIndicesOut,
        skinWeightsOut,
      )
    ) {
      placement.setSkinData(skinIndicesOut, skinWeightsOut);
    }

    v6[0] = midPos[0];
    v6[1] = midPos[1];
    v6[2] = midPos[2];
    v6[3] = midUV[0];
    v6[4] = midUV[1];
    v6[5] = 1;

    return quadraticForm6(v6, 0, combinedMetric, 0);
  }

  placement.position[0] = x_6[0];
  placement.position[1] = x_6[1];
  placement.position[2] = x_6[2];
  placement.setTC(0, x_6[3], x_6[4]);
  placement.metricCount = 1;
  placement.metrics.set(combinedMetric, 0);

  // Compute interpolation factor t from position along edge
  // t = |newPos - p0| / |p1 - p0|
  const edgeDx = p1[0] - p0[0];
  const edgeDy = p1[1] - p0[1];
  const edgeDz = p1[2] - p0[2];
  const edgeLenSq = edgeDx * edgeDx + edgeDy * edgeDy + edgeDz * edgeDz;

  let t = 0.5; // Default to midpoint
  if (edgeLenSq > EPS) {
    const dotProduct =
      (x_6[0] - p0[0]) * edgeDx +
      (x_6[1] - p0[1]) * edgeDy +
      (x_6[2] - p0[2]) * edgeDz;
    t = Math.max(0, Math.min(1, dotProduct / edgeLenSq));
  }

  // Interpolate skin weights
  if (
    interpolateSkinWeights(mesh, vi0, vi1, t, skinIndicesOut, skinWeightsOut)
  ) {
    placement.setSkinData(skinIndicesOut, skinWeightsOut);
  }

  return cost;
}
