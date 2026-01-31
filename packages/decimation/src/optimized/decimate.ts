/**
 * Optimized Mesh Decimation
 *
 * Main entry point for high-performance seam-aware mesh decimation.
 */

import {
  OptimizedMeshData,
  OptimizedEdgeFlaps,
  OptimizedVertexMetrics,
  OptimizedSeamEdgeSet,
  OptimizedSeamVertexMap,
  OptimizedDecimationOptions,
  OptimizedDecimationResult,
  PlacementBuffer,
  StopReason,
  INF,
  NULL_INDEX,
  NULL_INDEX_UINT32,
} from "./types.js";
import { buildEdgeFlaps, buildSeamEdges } from "./connectivity.js";
import { computeVertexMetrics } from "./quadric.js";
import { EdgePriorityQueue } from "./priority-queue.js";
import { computeCostAndPlacement } from "./cost-placement.js";
import { tryCollapseEdge } from "./collapse.js";

// ============================================================================
// MESH CLEANING (Zero-allocation using bit-masks)
// ============================================================================

/**
 * Clean mesh by compacting deleted faces and remapping indices.
 * Uses typed array bit-masks instead of Set to avoid allocations.
 *
 * IMPORTANT: Deleted faces are marked with NULL_INDEX (-1), which is stored
 * as 0xFFFFFFFF in Uint32Array. We use DELETED_MARKER (0xFFFFFFFF) for comparisons
 * since JavaScript number comparison with -1 doesn't work for Uint32Array values.
 *
 * @param mesh Input mesh (modified in place)
 * @returns Cleaned mesh with compacted arrays
 */
export function cleanMesh(mesh: OptimizedMeshData): OptimizedMeshData {
  // Count valid faces using NULL_INDEX_UINT32 (the unsigned representation of -1)
  let validFaceCount = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const idx0 = mesh.faceVertices[fi * 3];
    if (idx0 !== NULL_INDEX_UINT32) {
      validFaceCount++;
    }
  }

  if (validFaceCount === mesh.faceCount) return mesh;

  // Use bit-masks instead of Set (32 indices per Uint32)
  const vertexMaskLen = (mesh.vertexCount + 31) >>> 5;
  const tcMaskLen = (mesh.texCoordCount + 31) >>> 5;
  const vertexMask = new Uint32Array(vertexMaskLen);
  const tcMask = new Uint32Array(tcMaskLen);

  // Mark used vertices and TCs using bit operations
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const base = fi * 3;
    const idx0 = mesh.faceVertices[base];

    // Skip deleted faces (NULL_INDEX_UINT32 is the unsigned representation of -1)
    if (idx0 === NULL_INDEX_UINT32) continue;

    for (let c = 0; c < 3; c++) {
      const vi = mesh.faceVertices[base + c];
      const tci = mesh.faceTexCoords[base + c];
      vertexMask[vi >>> 5] |= 1 << (vi & 31);
      tcMask[tci >>> 5] |= 1 << (tci & 31);
    }
  }

  // Build remap tables (single pass)
  const vertexRemap = new Int32Array(mesh.vertexCount);
  const tcRemap = new Int32Array(mesh.texCoordCount);
  let newVertexCount = 0;
  let newTCCount = 0;

  for (let vi = 0; vi < mesh.vertexCount; vi++) {
    if (vertexMask[vi >>> 5] & (1 << (vi & 31))) {
      vertexRemap[vi] = newVertexCount++;
    } else {
      vertexRemap[vi] = NULL_INDEX;
    }
  }

  for (let tci = 0; tci < mesh.texCoordCount; tci++) {
    if (tcMask[tci >>> 5] & (1 << (tci & 31))) {
      tcRemap[tci] = newTCCount++;
    } else {
      tcRemap[tci] = NULL_INDEX;
    }
  }

  // Allocate output arrays
  const newPositions = new Float32Array(newVertexCount * 3);
  const newUVs = new Float32Array(newTCCount * 2);
  const newFaceVertices = new Uint32Array(validFaceCount * 3);
  const newFaceTexCoords = new Uint32Array(validFaceCount * 3);

  // Allocate skin weight arrays if present
  let newSkinIndices: Uint16Array | null = null;
  let newSkinWeights: Float32Array | null = null;
  if (mesh.skinIndices && mesh.skinWeights) {
    newSkinIndices = new Uint16Array(newVertexCount * 4);
    newSkinWeights = new Float32Array(newVertexCount * 4);
  }

  // Copy positions and skin weights (single pass using remap)
  for (let vi = 0; vi < mesh.vertexCount; vi++) {
    const newVi = vertexRemap[vi];
    if (newVi !== NULL_INDEX) {
      // Copy position
      const srcOff = vi * 3,
        dstOff = newVi * 3;
      newPositions[dstOff] = mesh.positions[srcOff];
      newPositions[dstOff + 1] = mesh.positions[srcOff + 1];
      newPositions[dstOff + 2] = mesh.positions[srcOff + 2];

      // Copy skin weights if present
      if (
        newSkinIndices &&
        newSkinWeights &&
        mesh.skinIndices &&
        mesh.skinWeights
      ) {
        const srcSkinOff = vi * 4,
          dstSkinOff = newVi * 4;
        newSkinIndices[dstSkinOff] = mesh.skinIndices[srcSkinOff];
        newSkinIndices[dstSkinOff + 1] = mesh.skinIndices[srcSkinOff + 1];
        newSkinIndices[dstSkinOff + 2] = mesh.skinIndices[srcSkinOff + 2];
        newSkinIndices[dstSkinOff + 3] = mesh.skinIndices[srcSkinOff + 3];
        newSkinWeights[dstSkinOff] = mesh.skinWeights[srcSkinOff];
        newSkinWeights[dstSkinOff + 1] = mesh.skinWeights[srcSkinOff + 1];
        newSkinWeights[dstSkinOff + 2] = mesh.skinWeights[srcSkinOff + 2];
        newSkinWeights[dstSkinOff + 3] = mesh.skinWeights[srcSkinOff + 3];
      }
    }
  }

  // Copy TCs (single pass using remap)
  for (let tci = 0; tci < mesh.texCoordCount; tci++) {
    const newTci = tcRemap[tci];
    if (newTci !== NULL_INDEX) {
      const srcOff = tci * 2,
        dstOff = newTci * 2;
      newUVs[dstOff] = mesh.uvs[srcOff];
      newUVs[dstOff + 1] = mesh.uvs[srcOff + 1];
    }
  }

  // Copy faces with remapped indices
  let newFaceIndex = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const srcBase = fi * 3;
    const idx0 = mesh.faceVertices[srcBase];

    // Skip deleted faces (NULL_INDEX_UINT32 is 0xFFFFFFFF, the unsigned representation of -1)
    if (idx0 === NULL_INDEX_UINT32) continue;

    const dstBase = newFaceIndex * 3;
    newFaceVertices[dstBase] = vertexRemap[idx0];
    newFaceVertices[dstBase + 1] = vertexRemap[mesh.faceVertices[srcBase + 1]];
    newFaceVertices[dstBase + 2] = vertexRemap[mesh.faceVertices[srcBase + 2]];
    newFaceTexCoords[dstBase] = tcRemap[mesh.faceTexCoords[srcBase]];
    newFaceTexCoords[dstBase + 1] = tcRemap[mesh.faceTexCoords[srcBase + 1]];
    newFaceTexCoords[dstBase + 2] = tcRemap[mesh.faceTexCoords[srcBase + 2]];
    newFaceIndex++;
  }

  return new OptimizedMeshData(
    newPositions,
    newUVs,
    newFaceVertices,
    newFaceTexCoords,
    newSkinIndices,
    newSkinWeights,
  );
}

// ============================================================================
// MAIN DECIMATION FUNCTION
// ============================================================================

/**
 * Decimate a mesh to reduce vertex count.
 *
 * @param mesh Input mesh
 * @param options Decimation options
 * @returns Decimation result with simplified mesh
 */
export function decimateOptimized(
  mesh: OptimizedMeshData,
  options: OptimizedDecimationOptions = {},
): OptimizedDecimationResult {
  const startTime = performance.now();

  // Clone mesh for in-place modification
  const workMesh = mesh.clone();

  const originalVertices = workMesh.vertexCount;
  const originalFaces = workMesh.faceCount;

  // Calculate target
  let targetVertices: number;
  if (options.targetVertices !== undefined) {
    targetVertices = options.targetVertices;
  } else if (options.targetPercent !== undefined) {
    targetVertices = Math.floor(
      originalVertices * (options.targetPercent / 100),
    );
  } else {
    targetVertices = Math.floor(originalVertices * 0.5); // Default 50%
  }

  targetVertices = Math.max(4, targetVertices); // Minimum 4 vertices (tetrahedron)

  const strictness = options.strictness ?? 2;

  // Build connectivity
  const flaps = buildEdgeFlaps(workMesh);
  const { seamEdges, seamVertices } = buildSeamEdges(workMesh, flaps);

  // Compute vertex metrics
  const metrics = computeVertexMetrics(workMesh);

  // Initialize priority queue
  const pq = new EdgePriorityQueue(flaps.edgeCount);
  const placement = new PlacementBuffer();

  // Compute initial costs
  for (let ei = 0; ei < flaps.edgeCount; ei++) {
    const cost = computeCostAndPlacement(
      ei,
      flaps,
      workMesh,
      metrics,
      seamEdges,
      seamVertices,
      strictness,
      placement,
    );
    pq.setCostDirect(ei, cost);
  }

  // Build heap
  pq.buildHeap(flaps.edgeCount);

  // Track active vertex count
  let currentVertices = originalVertices;
  let collapses = 0;
  let stopReason: StopReason = "target_reached";
  let noProgressCount = 0;
  const maxNoProgress = 1000;

  // Main loop
  while (currentVertices > targetVertices) {
    // Get minimum cost edge
    const minEntry = pq.extractMin();
    if (minEntry === null) {
      stopReason = "empty_queue";
      break;
    }

    const [ei, cost] = minEntry;

    // Skip if cost is infinite
    if (!Number.isFinite(cost)) {
      noProgressCount++;
      if (noProgressCount > maxNoProgress) {
        stopReason = "all_infinite_cost";
        break;
      }
      continue;
    }

    // Skip deleted edges
    if (flaps.isEdgeDeleted(ei)) {
      continue;
    }

    // Recompute cost (it may have changed due to neighbor collapses)
    const freshCost = computeCostAndPlacement(
      ei,
      flaps,
      workMesh,
      metrics,
      seamEdges,
      seamVertices,
      strictness,
      placement,
    );

    // If cost changed significantly, re-queue
    if (Math.abs(freshCost - cost) > 1e-6 * Math.max(1, Math.abs(cost))) {
      pq.insert(ei, freshCost);
      continue;
    }

    // Try to collapse
    const result = tryCollapseEdge(
      ei,
      placement,
      workMesh,
      flaps,
      metrics,
      seamEdges,
      seamVertices,
    );

    if (!result.success) {
      noProgressCount++;
      if (noProgressCount > maxNoProgress) {
        stopReason = "no_progress";
        break;
      }
      continue;
    }

    // Success!
    collapses++;
    currentVertices--;
    noProgressCount = 0;

    // Remove killed edges from queue
    if (result.killedEdge1 >= 0) {
      pq.remove(result.killedEdge1);
    }
    if (result.killedEdge2 >= 0) {
      pq.remove(result.killedEdge2);
    }

    // Update costs for affected edges
    for (let i = 0; i < result.affectedCount; i++) {
      const affectedEi = result.affectedEdges[i];
      if (!flaps.isEdgeDeleted(affectedEi)) {
        const newCost = computeCostAndPlacement(
          affectedEi,
          flaps,
          workMesh,
          metrics,
          seamEdges,
          seamVertices,
          strictness,
          placement,
        );
        pq.update(affectedEi, newCost);
      }
    }
  }

  // Clean up mesh
  const cleanedMesh = cleanMesh(workMesh);

  const processingTime = performance.now() - startTime;

  return {
    mesh: cleanedMesh,
    originalVertices,
    finalVertices: cleanedMesh.vertexCount,
    originalFaces,
    finalFaces: cleanedMesh.faceCount,
    collapses,
    stopReason,
    processingTimeMs: processingTime,
  };
}
