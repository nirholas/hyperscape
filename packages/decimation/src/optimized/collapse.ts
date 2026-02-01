/**
 * Optimized Edge Collapse Operations
 *
 * Performs edge collapse while maintaining mesh connectivity and seam data.
 */

import {
  OptimizedMeshData,
  OptimizedEdgeFlaps,
  OptimizedVertexMetrics,
  OptimizedSeamEdgeSet,
  OptimizedSeamVertexMap,
  PlacementBuffer,
  NULL_INDEX,
  MATRIX_6X6_SIZE,
  MAX_BONES_PER_VERTEX,
} from "./types.js";
import {
  getHalfEdgeBundle,
  circulation,
  edgeCollapseIsValid,
} from "./connectivity.js";
import { twoPointsOnSameSide } from "./math.js";

// ============================================================================
// PRE-ALLOCATED WORKSPACE
// ============================================================================

// Circulation results
const facesS = new Int32Array(64);
const facesD = new Int32Array(64);

// Face vertex/TC lookups
const fv = new Uint32Array(3);
const ft = new Uint32Array(3);

// UV points for foldover check
const uv = new Float32Array(2);
const uv1 = new Float32Array(2);
const uv2 = new Float32Array(2);
const newUV = new Float32Array(2);

// Skin weight workspace
const skinIndicesA = new Uint16Array(MAX_BONES_PER_VERTEX);
const skinWeightsA = new Float32Array(MAX_BONES_PER_VERTEX);
const skinIndicesB = new Uint16Array(MAX_BONES_PER_VERTEX);
const skinWeightsB = new Float32Array(MAX_BONES_PER_VERTEX);
const mergedIndices = new Uint16Array(MAX_BONES_PER_VERTEX * 2);
const mergedWeights = new Float32Array(MAX_BONES_PER_VERTEX * 2);
const resultIndices = new Uint16Array(MAX_BONES_PER_VERTEX);
const resultWeights = new Float32Array(MAX_BONES_PER_VERTEX);

// ============================================================================
// COLLAPSE RESULT
// ============================================================================

export interface CollapseResult {
  /** True if collapse succeeded */
  success: boolean;

  /** First edge that was killed (for queue removal) */
  killedEdge1: number;

  /** Second edge that was killed (for queue removal) */
  killedEdge2: number;

  /** Edges that need cost recalculation */
  affectedEdges: Int32Array;

  /** Number of affected edges */
  affectedCount: number;
}

// Pre-allocated result
const collapseResult: CollapseResult = {
  success: false,
  killedEdge1: NULL_INDEX,
  killedEdge2: NULL_INDEX,
  affectedEdges: new Int32Array(256),
  affectedCount: 0,
};

// ============================================================================
// SKIN WEIGHT INTERPOLATION
// ============================================================================

/**
 * Interpolate skin weights from two vertices with optional blend factor.
 * Combines bone influences, keeping only the top MAX_BONES_PER_VERTEX.
 *
 * @param mesh Mesh with skin data
 * @param vi0 First vertex index
 * @param vi1 Second vertex index
 * @param t Blend factor: 0.0 = use vi0, 1.0 = use vi1, 0.5 = average
 * @param outIndices Output bone indices (4)
 * @param outWeights Output bone weights (4)
 * @returns True if skin data was interpolated
 */
export function interpolateSkinWeights(
  mesh: OptimizedMeshData,
  vi0: number,
  vi1: number,
  t: number,
  outIndices: Uint16Array,
  outWeights: Float32Array,
): boolean {
  if (!mesh.hasSkinWeights()) return false;

  // Get skin weights from both vertices
  mesh.getSkinIndices(vi0, skinIndicesA);
  mesh.getSkinWeights(vi0, skinWeightsA);
  mesh.getSkinIndices(vi1, skinIndicesB);
  mesh.getSkinWeights(vi1, skinWeightsB);

  // Blend factor for each vertex
  const w0 = 1.0 - t;
  const w1 = t;

  // Collect all bone influences with merged weights
  let mergedCount = 0;

  // Add influences from vertex A
  for (let i = 0; i < MAX_BONES_PER_VERTEX; i++) {
    if (skinWeightsA[i] > 0) {
      const boneIndex = skinIndicesA[i];
      const weight = skinWeightsA[i] * w0;

      // Check if this bone already exists in merged
      let found = false;
      for (let j = 0; j < mergedCount; j++) {
        if (mergedIndices[j] === boneIndex) {
          mergedWeights[j] += weight;
          found = true;
          break;
        }
      }

      if (!found && mergedCount < MAX_BONES_PER_VERTEX * 2) {
        mergedIndices[mergedCount] = boneIndex;
        mergedWeights[mergedCount] = weight;
        mergedCount++;
      }
    }
  }

  // Add influences from vertex B
  for (let i = 0; i < MAX_BONES_PER_VERTEX; i++) {
    if (skinWeightsB[i] > 0) {
      const boneIndex = skinIndicesB[i];
      const weight = skinWeightsB[i] * w1;

      // Check if this bone already exists in merged
      let found = false;
      for (let j = 0; j < mergedCount; j++) {
        if (mergedIndices[j] === boneIndex) {
          mergedWeights[j] += weight;
          found = true;
          break;
        }
      }

      if (!found && mergedCount < MAX_BONES_PER_VERTEX * 2) {
        mergedIndices[mergedCount] = boneIndex;
        mergedWeights[mergedCount] = weight;
        mergedCount++;
      }
    }
  }

  // Sort by weight (descending) using simple selection sort
  // We only need to find the top MAX_BONES_PER_VERTEX
  for (let i = 0; i < Math.min(MAX_BONES_PER_VERTEX, mergedCount); i++) {
    let maxIdx = i;
    for (let j = i + 1; j < mergedCount; j++) {
      if (mergedWeights[j] > mergedWeights[maxIdx]) {
        maxIdx = j;
      }
    }
    // Swap
    if (maxIdx !== i) {
      const tmpIdx = mergedIndices[i];
      const tmpWeight = mergedWeights[i];
      mergedIndices[i] = mergedIndices[maxIdx];
      mergedWeights[i] = mergedWeights[maxIdx];
      mergedIndices[maxIdx] = tmpIdx;
      mergedWeights[maxIdx] = tmpWeight;
    }
  }

  // Take top MAX_BONES_PER_VERTEX and normalize
  let totalWeight = 0;
  const count = Math.min(MAX_BONES_PER_VERTEX, mergedCount);

  for (let i = 0; i < count; i++) {
    resultIndices[i] = mergedIndices[i];
    resultWeights[i] = mergedWeights[i];
    totalWeight += mergedWeights[i];
  }

  // Fill remaining slots with zeros
  for (let i = count; i < MAX_BONES_PER_VERTEX; i++) {
    resultIndices[i] = 0;
    resultWeights[i] = 0;
  }

  // Normalize weights to sum to 1.0
  if (totalWeight > 0) {
    for (let i = 0; i < count; i++) {
      resultWeights[i] /= totalWeight;
    }
  } else if (mergedCount === 0) {
    // No influences - fallback to first bone with full weight
    resultIndices[0] = 0;
    resultWeights[0] = 1.0;
  }

  // Copy to output
  for (let i = 0; i < MAX_BONES_PER_VERTEX; i++) {
    outIndices[i] = resultIndices[i];
    outWeights[i] = resultWeights[i];
  }

  return true;
}

// ============================================================================
// FOLDOVER CHECK
// ============================================================================

/**
 * Check if collapse would cause UV foldover in faces around destination vertex
 */
function checkFoldover(
  faces: Int32Array,
  faceCount: number,
  vertexToCheck: number,
  newTCu: number,
  newTCv: number,
  mesh: OptimizedMeshData,
): boolean {
  newUV[0] = newTCu;
  newUV[1] = newTCv;

  for (let i = 1; i < faceCount - 1; i++) {
    const fi = faces[i];
    if (mesh.isFaceDeleted(fi)) continue;

    mesh.getFaceVertices(fi, fv);
    mesh.getFaceTexCoords(fi, ft);

    for (let v = 0; v < 3; v++) {
      if (fv[v] === vertexToCheck) {
        // Get the UVs of the triangle
        mesh.getUV(ft[v], uv);
        mesh.getUV(ft[(v + 1) % 3], uv1);
        mesh.getUV(ft[(v + 2) % 3], uv2);

        // Check if old and new UV are on same side of opposite edge
        if (!twoPointsOnSameSide(uv1, 0, uv2, 0, uv, 0, newUV, 0)) {
          return false; // Would cause foldover
        }
      }
    }
  }

  return true;
}

// ============================================================================
// EDGE COLLAPSE
// ============================================================================

/**
 * Try to collapse an edge.
 *
 * @param ei Edge index
 * @param placement New position and UVs for merged vertex
 * @param mesh Mesh data
 * @param flaps Edge connectivity
 * @param metrics Vertex metrics
 * @param seamEdges Seam edge set
 * @param seamVertices Seam vertex map
 * @returns Collapse result
 */
export function tryCollapseEdge(
  ei: number,
  placement: PlacementBuffer,
  mesh: OptimizedMeshData,
  flaps: OptimizedEdgeFlaps,
  metrics: OptimizedVertexMetrics,
  seamEdges: OptimizedSeamEdgeSet,
  seamVertices: OptimizedSeamVertexMap,
): CollapseResult {
  collapseResult.success = false;
  collapseResult.killedEdge1 = NULL_INDEX;
  collapseResult.killedEdge2 = NULL_INDEX;
  collapseResult.affectedCount = 0;

  if (flaps.isEdgeDeleted(ei)) {
    return collapseResult;
  }

  // Get edge endpoints (always collapse larger index to smaller)
  const [e0, e1] = flaps.getEdge(ei);
  const s = e0 < e1 ? e0 : e1; // destination (smaller)
  const d = e0 < e1 ? e1 : e0; // source (larger)

  // Check if edge is on seam
  const collapseOnSeam = seamEdges.has(s, d);

  // Reject if both on seams but no seam edge between them
  if (seamVertices.isOnSeam(s) && seamVertices.isOnSeam(d) && !collapseOnSeam) {
    return collapseResult;
  }

  // Check link condition
  if (!edgeCollapseIsValid(ei, flaps, mesh)) {
    return collapseResult;
  }

  // Get half-edge bundle
  const bundle = getHalfEdgeBundle(ei, flaps, mesh);
  if (bundle.count !== 2) {
    return collapseResult;
  }

  // Get circulation around both vertices
  const eflip = e0 > e1 ? 1 : 0;
  const countD = circulation(ei, !eflip, flaps, mesh, facesD);
  const countS = circulation(ei, !!eflip, flaps, mesh, facesS);

  // Get texture coordinate indices
  let sTc: number, dTc: number;
  if (bundle.side0[0] === s) {
    sTc = bundle.side0[1];
    dTc = bundle.side0[3];
  } else {
    sTc = bundle.side0[3];
    dTc = bundle.side0[1];
  }

  // Check for UV foldover (only for non-seam edges)
  if (!collapseOnSeam && placement.tcCount > 0) {
    const [newTCu, newTCv] = placement.getTC(0);

    // Check around d
    if (!checkFoldover(facesD, countD, d, newTCu, newTCv, mesh)) {
      return collapseResult;
    }

    // Check around s
    if (!checkFoldover(facesS, countS, s, newTCu, newTCv, mesh)) {
      return collapseResult;
    }
  }

  // Perform the collapse

  // CRITICAL: Validate placement positions before applying collapse
  // This catches any NaN/Infinity that might have slipped through cost computation
  if (
    !Number.isFinite(placement.position[0]) ||
    !Number.isFinite(placement.position[1]) ||
    !Number.isFinite(placement.position[2])
  ) {
    // Reject collapse with invalid position
    return collapseResult;
  }

  if (collapseOnSeam) {
    if (placement.tcCount !== 2 || placement.metricCount !== 2) {
      return collapseResult;
    }

    // Move both vertices to new position
    mesh.setPosition(
      s,
      placement.position[0],
      placement.position[1],
      placement.position[2],
    );
    mesh.setPosition(
      d,
      placement.position[0],
      placement.position[1],
      placement.position[2],
    );

    // Get TC indices for both sides
    const he0Ts = bundle.side0[0] === d ? bundle.side0[3] : bundle.side0[1];
    const he0Td = bundle.side0[0] === d ? bundle.side0[1] : bundle.side0[3];
    const he1Ts = bundle.side1[0] === d ? bundle.side1[3] : bundle.side1[1];
    const he1Td = bundle.side1[0] === d ? bundle.side1[1] : bundle.side1[3];

    // Update texture coordinates
    const [tc0u, tc0v] = placement.getTC(0);
    const [tc1u, tc1v] = placement.getTC(1);

    mesh.setUV(he0Ts, tc0u, tc0v);
    mesh.setUV(he0Td, tc0u, tc0v);
    mesh.setUV(he1Ts, tc1u, tc1v);
    mesh.setUV(he1Td, tc1u, tc1v);

    // Update metrics
    metrics.deleteMetric(d, he0Td);
    metrics.deleteMetric(d, he1Td);

    // Copy remaining d metrics to s
    const dTCs = new Int32Array(4);
    const dTCCount = metrics.getVertexTCIndices(d, dTCs);
    for (let i = 0; i < dTCCount; i++) {
      metrics.copyMetric(d, dTCs[i], s, dTCs[i]);
    }
    metrics.deleteAllMetrics(d);

    // Set new metrics
    metrics.setMetric(s, he0Ts, placement.metrics.subarray(0, MATRIX_6X6_SIZE));
    metrics.setMetric(
      s,
      he1Ts,
      placement.metrics.subarray(MATRIX_6X6_SIZE, MATRIX_6X6_SIZE * 2),
    );
  } else {
    if (placement.tcCount !== 1 || placement.metricCount !== 1) {
      return collapseResult;
    }

    // Move vertices
    mesh.setPosition(
      s,
      placement.position[0],
      placement.position[1],
      placement.position[2],
    );
    mesh.setPosition(
      d,
      placement.position[0],
      placement.position[1],
      placement.position[2],
    );

    // Update texture coordinates
    const [tcU, tcV] = placement.getTC(0);
    mesh.setUV(sTc, tcU, tcV);
    mesh.setUV(dTc, tcU, tcV);

    // Update metrics
    metrics.deleteMetric(d, dTc);

    const dTCs = new Int32Array(4);
    const dTCCount = metrics.getVertexTCIndices(d, dTCs);
    for (let i = 0; i < dTCCount; i++) {
      metrics.copyMetric(d, dTCs[i], s, dTCs[i]);
    }
    metrics.deleteAllMetrics(d);

    metrics.setMetric(s, sTc, placement.metrics.subarray(0, MATRIX_6X6_SIZE));
  }

  // Update skin weights if mesh has them
  if (mesh.hasSkinWeights() && placement.hasSkinData) {
    // Apply the interpolated skin weights from placement to the surviving vertex
    mesh.setSkinData(s, placement.skinIndices, placement.skinWeights);
    // Also update d since it points to same position (will be cleaned up later)
    mesh.setSkinData(d, placement.skinIndices, placement.skinWeights);
  }

  // Track affected edges for queue update
  const affectedSet = new Set<number>();

  // Update edge and face connectivity for each side
  for (let side = 0; side < 2; side++) {
    const fi = flaps.edgeFaces[ei * 2 + side];
    if (fi === NULL_INDEX) continue;

    const oppCorner = flaps.edgeOpposites[ei * 2 + side];
    const sign = (eflip === 0 ? 1 : -1) * (1 - 2 * side);

    // Find adjacent edges
    const corner1 = (oppCorner + sign * 1 + 3) % 3;
    const corner2 = (oppCorner + sign * 2 + 3) % 3;
    const e1 = flaps.getEdgeForFaceCorner(fi, corner1);
    const e2 = flaps.getEdgeForFaceCorner(fi, corner2);

    // Kill e1
    if (e1 >= 0) {
      flaps.deleteEdge(e1);
      if (side === 0) {
        collapseResult.killedEdge1 = e1;
      } else {
        collapseResult.killedEdge2 = e1;
      }
    }

    // Kill face
    mesh.deleteFace(fi);

    // Get adjacent face to e1
    if (e1 >= 0) {
      const [e1f0, e1f1] = flaps.getEdgeFaces(e1);
      const flip1 = e1f1 === fi ? 0 : 1;
      const f1 = flip1 ? e1f0 : e1f1;

      if (f1 !== NULL_INDEX && f1 !== fi) {
        const v1 = flaps.edgeOpposites[e1 * 2 + flip1];

        // Update face-to-edge mapping
        flaps.setEdgeForFaceCorner(f1, v1, e2);

        // Update e2's face reference
        const [e2f0] = flaps.getEdgeFaces(e2);
        const opp2 = e2f0 === fi ? 0 : 1;
        flaps.setEdgeFace(e2, opp2 as 0 | 1, f1, v1);

        // Remap e2 endpoints from d to s
        const [e2v0, e2v1] = flaps.getEdge(e2);
        if (e2v0 === d) flaps.edges[e2 * 2] = s;
        if (e2v1 === d) flaps.edges[e2 * 2 + 1] = s;
      }
    }
  }

  // Update face indices for d's 1-ring
  for (let i = 1; i < countD - 1; i++) {
    const fi = facesD[i];
    if (mesh.isFaceDeleted(fi)) continue;

    mesh.getFaceVertices(fi, fv);
    mesh.getFaceTexCoords(fi, ft);

    for (let v = 0; v < 3; v++) {
      if (fv[v] === d) {
        // Update edge endpoints
        const e1i = flaps.getEdgeForFaceCorner(fi, (v + 1) % 3);
        const e2i = flaps.getEdgeForFaceCorner(fi, (v + 2) % 3);

        if (e1i >= 0) {
          const [e1f0] = flaps.getEdgeFaces(e1i);
          const flip1 = e1f0 === fi ? 1 : 0;
          if (flaps.edges[e1i * 2 + flip1] === d) {
            flaps.edges[e1i * 2 + flip1] = s;
          }
          affectedSet.add(e1i);
        }

        if (e2i >= 0) {
          const [e2f0] = flaps.getEdgeFaces(e2i);
          const flip2 = e2f0 === fi ? 0 : 1;
          if (flaps.edges[e2i * 2 + flip2] === d) {
            flaps.edges[e2i * 2 + flip2] = s;
          }
          affectedSet.add(e2i);
        }

        // Update face vertex
        mesh.faceVertices[fi * 3 + v] = s;

        // Update texture coordinate reference
        if (!collapseOnSeam) {
          if (ft[v] === dTc) {
            mesh.faceTexCoords[fi * 3 + v] = sTc;
          }
        } else {
          // For seam collapses, need to check both sides
          const side0 = bundle.side0;
          const side1 = bundle.side1;
          const dTc0 = side0[0] === d ? side0[1] : side0[3];
          const dTc1 = side1[0] === d ? side1[1] : side1[3];
          const sTc0 = side0[0] === s ? side0[1] : side0[3];
          const sTc1 = side1[0] === s ? side1[1] : side1[3];

          if (ft[v] === dTc0) {
            mesh.faceTexCoords[fi * 3 + v] = sTc0;
          } else if (ft[v] === dTc1) {
            mesh.faceTexCoords[fi * 3 + v] = sTc1;
          }
        }
      }
    }
  }

  // Handle seam corner case (when d's TCs on both sides are the same)
  if (collapseOnSeam) {
    const dTc0 = bundle.side0[0] === d ? bundle.side0[1] : bundle.side0[3];
    const dTc1 = bundle.side1[0] === d ? bundle.side1[1] : bundle.side1[3];

    if (dTc0 === dTc1) {
      const sTc0 = bundle.side0[0] === s ? bundle.side0[1] : bundle.side0[3];
      const sTc1 = bundle.side1[0] === s ? bundle.side1[1] : bundle.side1[3];

      for (let i = 1; i < countS - 1; i++) {
        const fi = facesS[i];
        if (mesh.isFaceDeleted(fi)) continue;

        mesh.getFaceTexCoords(fi, ft);
        for (let v = 0; v < 3; v++) {
          if (ft[v] === sTc1) {
            mesh.faceTexCoords[fi * 3 + v] = sTc0;
          }
        }
      }
    }
  }

  // Update seam edge map
  if (seamVertices.isOnSeam(d) && !seamVertices.isOnSeam(s)) {
    seamVertices.renameVertex(d, s);
  }
  if (seamEdges.has(d, s)) {
    seamEdges.delete(d, s);
    // Also need to update seam vertex neighbor references
    seamVertices.removeSeamEdge(d, s);
  }

  // Kill the collapsed edge
  flaps.deleteEdge(ei);

  // Collect affected edges
  for (let i = 0; i < countS; i++) {
    const fi = facesS[i];
    if (mesh.isFaceDeleted(fi)) continue;

    for (let corner = 0; corner < 3; corner++) {
      const edgeIdx = flaps.getEdgeForFaceCorner(fi, corner);
      if (edgeIdx >= 0 && !flaps.isEdgeDeleted(edgeIdx)) {
        affectedSet.add(edgeIdx);
      }
    }
  }

  for (let i = 0; i < countD; i++) {
    const fi = facesD[i];
    if (mesh.isFaceDeleted(fi)) continue;

    for (let corner = 0; corner < 3; corner++) {
      const edgeIdx = flaps.getEdgeForFaceCorner(fi, corner);
      if (edgeIdx >= 0 && !flaps.isEdgeDeleted(edgeIdx)) {
        affectedSet.add(edgeIdx);
      }
    }
  }

  // Remove killed edges from affected set
  affectedSet.delete(ei);
  if (collapseResult.killedEdge1 >= 0) {
    affectedSet.delete(collapseResult.killedEdge1);
  }
  if (collapseResult.killedEdge2 >= 0) {
    affectedSet.delete(collapseResult.killedEdge2);
  }

  // Copy to output array
  let idx = 0;
  for (const e of affectedSet) {
    collapseResult.affectedEdges[idx++] = e;
  }
  collapseResult.affectedCount = idx;

  collapseResult.success = true;
  return collapseResult;
}
