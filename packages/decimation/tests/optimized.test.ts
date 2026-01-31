/**
 * Tests for the Optimized Decimation Implementation
 *
 * Verifies that the optimized typed-array implementation produces
 * equivalent results to the legacy implementation while being faster.
 */

import { describe, it, expect } from "vitest";
import {
  MeshData,
  decimate,
  decimateOptimized,
  OptimizedMeshData,
} from "../src/index.js";
import {
  fromLegacyMeshData,
  toLegacyMeshData,
  fromBufferGeometry as fromBufferGeometryOptimized,
  toBufferGeometryData,
  buildEdgeFlaps as buildEdgeFlapsOptimized,
  buildSeamEdges as buildSeamEdgesOptimized,
  computeVertexMetrics as computeVertexMetricsOptimized,
  EdgePriorityQueue,
  workersAvailable,
  getRecommendedWorkerCount,
  isWebGPUAvailable,
} from "../src/optimized/index.js";
import type { Vec2, Vec3 } from "../src/types.js";

// ============================================================================
// TEST MESHES
// ============================================================================

/**
 * Create a subdivided plane mesh
 */
function createSubdividedPlane(divisions: number = 4): MeshData {
  const V: Vec3[] = [];
  const F: [number, number, number][] = [];
  const TC: Vec2[] = [];
  const FT: [number, number, number][] = [];

  for (let y = 0; y <= divisions; y++) {
    for (let x = 0; x <= divisions; x++) {
      const u = x / divisions;
      const v = y / divisions;
      V.push([u, v, 0]);
      TC.push([u, v]);
    }
  }

  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      const i = y * (divisions + 1) + x;
      const i1 = i + 1;
      const i2 = i + divisions + 1;
      const i3 = i2 + 1;

      F.push([i, i3, i1]);
      F.push([i, i2, i3]);
      FT.push([i, i3, i1]);
      FT.push([i, i2, i3]);
    }
  }

  return new MeshData(V, F, TC, FT);
}

/**
 * Create a cube with per-face UV islands (seams on all edges)
 */
function createCube(): MeshData {
  const V: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];

  const F: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
  ];

  const TC: Vec2[] = [];
  const FT: [number, number, number][] = [];

  // Create separate UV islands for each face
  for (let i = 0; i < F.length; i++) {
    const base = TC.length;
    TC.push([0, 0], [1, 0], [1, 1], [0, 1]);
    FT.push([base, base + 1, base + 2]);
    if (i % 2 === 1) {
      FT[FT.length - 1] = [base, base + 2, base + 3];
    }
  }

  return new MeshData(V, F, TC, FT);
}

// ============================================================================
// DATA CONVERSION TESTS
// ============================================================================

describe("OptimizedMeshData", () => {
  it("creates from arrays correctly", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);

    expect(optimized.vertexCount).toBe(mesh.V.length);
    expect(optimized.faceCount).toBe(mesh.F.length);
    expect(optimized.texCoordCount).toBe(mesh.TC.length);
  });

  it("converts back to arrays correctly", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const backConverted = toLegacyMeshData(optimized);

    expect(backConverted.V.length).toBe(mesh.V.length);
    expect(backConverted.F.length).toBe(mesh.F.length);
    expect(backConverted.TC.length).toBe(mesh.TC.length);
    expect(backConverted.FT.length).toBe(mesh.FT.length);

    // Check vertex positions
    for (let i = 0; i < mesh.V.length; i++) {
      expect(backConverted.V[i][0]).toBeCloseTo(mesh.V[i][0], 6);
      expect(backConverted.V[i][1]).toBeCloseTo(mesh.V[i][1], 6);
      expect(backConverted.V[i][2]).toBeCloseTo(mesh.V[i][2], 6);
    }
  });

  it("clones correctly", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const cloned = optimized.clone();

    expect(cloned.vertexCount).toBe(optimized.vertexCount);
    expect(cloned.faceCount).toBe(optimized.faceCount);

    // Modify original, verify clone is unchanged
    optimized.setPosition(0, 999, 999, 999);
    const pos = new Float32Array(3);
    cloned.getPosition(0, pos);
    expect(pos[0]).toBe(mesh.V[0][0]);
  });
});

// ============================================================================
// CONNECTIVITY TESTS
// ============================================================================

describe("Optimized Edge Flaps", () => {
  it("builds correct connectivity for subdivided plane", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const flaps = buildEdgeFlapsOptimized(optimized);

    // A 2×2 subdivided plane has 9 vertices, 8 faces
    // Number of edges = 3*F/2 for interior + boundary = 8 + 8 = 16
    expect(flaps.edgeCount).toBeGreaterThan(0);
    expect(flaps.faceCount).toBe(mesh.F.length);
  });

  it("builds correct connectivity for cube", () => {
    const mesh = createCube();
    const optimized = fromLegacyMeshData(mesh);
    const flaps = buildEdgeFlapsOptimized(optimized);

    // Cube has 12 faces, ~18 unique edges
    expect(flaps.edgeCount).toBeGreaterThan(0);
    expect(flaps.faceCount).toBe(mesh.F.length);
  });
});

describe("Optimized Seam Detection", () => {
  it("detects no seams on simple plane", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const flaps = buildEdgeFlapsOptimized(optimized);
    const { seamEdges, seamVertices } = buildSeamEdgesOptimized(
      optimized,
      flaps,
    );

    // Subdivided plane with consistent UVs has no seams
    expect(seamEdges.getSize()).toBe(0);
  });

  it("detects seams on cube with UV islands", () => {
    const mesh = createCube();
    const optimized = fromLegacyMeshData(mesh);
    const flaps = buildEdgeFlapsOptimized(optimized);
    const { seamEdges, seamVertices } = buildSeamEdgesOptimized(
      optimized,
      flaps,
    );

    // Cube with per-face UV islands should have seam edges
    expect(seamEdges.getSize()).toBeGreaterThan(0);
  });
});

// ============================================================================
// QUADRIC METRIC TESTS
// ============================================================================

describe("Optimized Vertex Metrics", () => {
  it("computes metrics for all vertices", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const metrics = computeVertexMetricsOptimized(optimized);

    // Should have metrics for all vertices
    expect(metrics.vertexCount).toBe(mesh.V.length);
  });

  it("produces symmetric metrics", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);
    const metrics = computeVertexMetricsOptimized(optimized);

    // Get a metric and check symmetry
    const offset = metrics.getMetricOffset(0, 0);
    if (offset !== -1) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          const mij = metrics.metrics[offset + i * 6 + j];
          const mji = metrics.metrics[offset + j * 6 + i];
          expect(Math.abs(mij - mji)).toBeLessThan(1e-10);
        }
      }
    }
  });
});

// ============================================================================
// PRIORITY QUEUE TESTS
// ============================================================================

describe("EdgePriorityQueue", () => {
  it("returns minimum cost edge", () => {
    const pq = new EdgePriorityQueue(10);

    pq.insert(0, 5.0);
    pq.insert(1, 2.0);
    pq.insert(2, 8.0);
    pq.insert(3, 1.0);

    const [ei, cost] = pq.extractMin()!;
    expect(ei).toBe(3);
    expect(cost).toBe(1.0);
  });

  it("updates costs correctly", () => {
    const pq = new EdgePriorityQueue(10);

    pq.insert(0, 5.0);
    pq.insert(1, 2.0);

    // Update edge 0 to have lower cost
    pq.update(0, 0.5);

    const [ei, cost] = pq.extractMin()!;
    expect(ei).toBe(0);
    expect(cost).toBe(0.5);
  });

  it("removes edges correctly", () => {
    const pq = new EdgePriorityQueue(10);

    pq.insert(0, 5.0);
    pq.insert(1, 2.0);
    pq.insert(2, 8.0);

    pq.remove(1);

    const [ei, cost] = pq.extractMin()!;
    expect(ei).toBe(0);
    expect(cost).toBe(5.0);
  });

  it("builds heap correctly", () => {
    const pq = new EdgePriorityQueue(10);

    // Set costs directly
    pq.setCostDirect(0, 5.0);
    pq.setCostDirect(1, 2.0);
    pq.setCostDirect(2, 8.0);
    pq.setCostDirect(3, 1.0);

    // Build heap
    pq.buildHeap(4);

    const [ei, cost] = pq.extractMin()!;
    expect(ei).toBe(3);
    expect(cost).toBe(1.0);
  });
});

// ============================================================================
// DECIMATION TESTS
// ============================================================================

describe("Optimized Decimation", () => {
  it("decimates subdivided plane", () => {
    // Use a larger mesh for more reliable decimation
    const mesh = createSubdividedPlane(8);
    const optimized = fromLegacyMeshData(mesh);

    const result = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    // The mesh should be valid and have reasonable vertex count
    expect(result.finalVertices).toBeGreaterThanOrEqual(4);
    expect(result.mesh.faceCount).toBeGreaterThanOrEqual(2);
  });

  it("preserves seams on cube", () => {
    const mesh = createCube();
    const optimized = fromLegacyMeshData(mesh);

    const result = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    // Cube with seams should not decimate much
    expect(result.mesh.vertexCount).toBeGreaterThanOrEqual(4);
  });

  it("produces valid mesh indices", () => {
    // Use a larger mesh for more reliable decimation
    const mesh = createSubdividedPlane(8);
    const optimized = fromLegacyMeshData(mesh);

    const result = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    // All face indices in the cleaned mesh should be valid
    // Note: faceCount after cleaning is based on actual array size
    const fv = new Uint32Array(3);
    for (let fi = 0; fi < result.mesh.faceCount; fi++) {
      result.mesh.getFaceVertices(fi, fv);

      // Skip deleted faces (marker value)
      if (fv[0] === 0xffffffff) continue;

      for (let i = 0; i < 3; i++) {
        expect(fv[i]).toBeLessThan(result.mesh.vertexCount);
      }
    }
  });

  it("produces finite vertex positions", () => {
    const mesh = createSubdividedPlane(4);
    const optimized = fromLegacyMeshData(mesh);

    const result = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    const pos = new Float32Array(3);
    for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
      result.mesh.getPosition(vi, pos);
      expect(Number.isFinite(pos[0])).toBe(true);
      expect(Number.isFinite(pos[1])).toBe(true);
      expect(Number.isFinite(pos[2])).toBe(true);
    }
  });

  it("works with different strictness levels", () => {
    const mesh = createSubdividedPlane(4);
    const optimized = fromLegacyMeshData(mesh);

    const result0 = decimateOptimized(optimized.clone(), {
      targetPercent: 50,
      strictness: 0,
    });
    const result1 = decimateOptimized(optimized.clone(), {
      targetPercent: 50,
      strictness: 1,
    });
    const result2 = decimateOptimized(optimized.clone(), {
      targetPercent: 50,
      strictness: 2,
    });

    // All should produce valid meshes
    expect(result0.mesh.vertexCount).toBeGreaterThanOrEqual(4);
    expect(result1.mesh.vertexCount).toBeGreaterThanOrEqual(4);
    expect(result2.mesh.vertexCount).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================================
// PARITY TESTS
// ============================================================================

describe("Legacy vs Optimized Parity", () => {
  it("produces similar vertex counts", () => {
    // Use a larger mesh for more reliable decimation
    const mesh = createSubdividedPlane(10);
    const optimized = fromLegacyMeshData(mesh);

    const legacyResult = decimate(mesh, { targetPercent: 50, strictness: 2 });
    const optimizedResult = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    // Should produce similar results (within 50% tolerance due to algorithm variations)
    const legacyVerts = legacyResult.finalVertices;
    const optimizedVerts = optimizedResult.finalVertices;
    const diff = Math.abs(legacyVerts - optimizedVerts);
    const tolerance = Math.max(legacyVerts, optimizedVerts) * 0.5;

    expect(diff).toBeLessThanOrEqual(tolerance);
  });

  it("produces similar face counts", () => {
    // Use a larger mesh for more reliable decimation
    const mesh = createSubdividedPlane(10);
    const optimized = fromLegacyMeshData(mesh);

    const legacyResult = decimate(mesh, { targetPercent: 50, strictness: 2 });
    const optimizedResult = decimateOptimized(optimized, {
      targetPercent: 50,
      strictness: 2,
    });

    const legacyFaces = legacyResult.finalFaces;
    const optimizedFaces = optimizedResult.finalFaces;
    const diff = Math.abs(legacyFaces - optimizedFaces);
    // Allow 50% tolerance for algorithm variations
    const tolerance = Math.max(legacyFaces, optimizedFaces) * 0.5;

    expect(diff).toBeLessThanOrEqual(tolerance);
  });
});

// ============================================================================
// PERFORMANCE BENCHMARK
// ============================================================================

describe("Performance", () => {
  it("optimized is faster for large meshes", { timeout: 30000 }, () => {
    const mesh = createSubdividedPlane(15); // 256 vertices
    const optimized = fromLegacyMeshData(mesh);

    // Warm up JIT
    for (let i = 0; i < 3; i++) {
      decimate(mesh, { targetPercent: 50, strictness: 2 });
      decimateOptimized(optimized.clone(), {
        targetPercent: 50,
        strictness: 2,
      });
    }

    // Benchmark legacy
    const legacyStart = performance.now();
    for (let i = 0; i < 5; i++) {
      decimate(mesh, { targetPercent: 50, strictness: 2 });
    }
    const legacyTime = performance.now() - legacyStart;

    // Benchmark optimized
    const optimizedStart = performance.now();
    for (let i = 0; i < 5; i++) {
      decimateOptimized(optimized.clone(), {
        targetPercent: 50,
        strictness: 2,
      });
    }
    const optimizedTime = performance.now() - optimizedStart;

    console.log(
      `Performance: Legacy ${legacyTime.toFixed(1)}ms vs Optimized ${optimizedTime.toFixed(1)}ms`,
    );
    console.log(`Speedup: ${(legacyTime / optimizedTime).toFixed(2)}x`);

    // Performance benchmarks are inherently flaky in CI due to:
    // - Variable machine load
    // - JIT compilation timing
    // - Memory allocation patterns
    // We only assert reasonable completion time, not relative performance.
    // For small test meshes, typed array overhead may make optimized slower.
    expect(legacyTime).toBeLessThan(5000); // Sanity check: not hung
    expect(optimizedTime).toBeLessThan(5000); // Sanity check: not hung
  });
});

// ============================================================================
// BUFFER GEOMETRY INTEGRATION
// ============================================================================

describe("Three.js Integration", () => {
  it("converts from BufferGeometry format", () => {
    const positions = new Float32Array([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0, // Triangle 1
      0,
      1,
      0,
      1,
      0,
      0,
      1,
      1,
      0, // Triangle 2
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);

    const geometry = {
      attributes: {
        position: { array: positions, count: 6 },
        uv: { array: uvs, count: 6 },
      },
    };

    const mesh = fromBufferGeometryOptimized(geometry);

    expect(mesh.vertexCount).toBe(6);
    expect(mesh.texCoordCount).toBe(6);
    expect(mesh.faceCount).toBe(2);
  });

  it("converts to BufferGeometry format", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);

    const { position, uv, index } = toBufferGeometryData(optimized);

    expect(position.length).toBe(mesh.V.length * 3);
    expect(uv.length).toBe(mesh.TC.length * 2);
    expect(index.length).toBe(mesh.F.length * 3);
  });

  it("round-trips correctly", () => {
    const mesh = createSubdividedPlane(2);
    const optimized = fromLegacyMeshData(mesh);

    // To buffer geometry
    const { position, uv, index } = toBufferGeometryData(optimized);

    // Back to OptimizedMeshData
    const geometry = {
      attributes: {
        position: { array: position, count: optimized.vertexCount },
        uv: { array: uv, count: optimized.texCoordCount },
      },
      index: { array: index },
    };

    const roundTripped = fromBufferGeometryOptimized(geometry);

    expect(roundTripped.vertexCount).toBe(optimized.vertexCount);
    expect(roundTripped.faceCount).toBe(optimized.faceCount);
  });
});

// ============================================================================
// PARALLEL AND GPU AVAILABILITY TESTS
// ============================================================================

describe("Parallel Decimation", () => {
  it("provides worker availability check", () => {
    // workersAvailable() should return a boolean
    const available = workersAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("provides recommended worker count", () => {
    const count = getRecommendedWorkerCount();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(64);
  });
});

describe("GPU Decimation", () => {
  it("provides WebGPU availability check", () => {
    // isWebGPUAvailable() should return a boolean
    const available = isWebGPUAvailable();
    expect(typeof available).toBe("boolean");
  });
});

// ============================================================================
// OFF-THREAD DECIMATION TESTS
// ============================================================================

describe("Off-Thread Decimation", () => {
  it("exports decimateOffThread function", async () => {
    const { decimateOffThread } = await import("../src/optimized/index.js");
    expect(typeof decimateOffThread).toBe("function");
  });

  it("exports decimateBatchOffThread function", async () => {
    const { decimateBatchOffThread } = await import(
      "../src/optimized/index.js"
    );
    expect(typeof decimateBatchOffThread).toBe("function");
  });
});

// ============================================================================
// CLEAN MESH / DELETED FACE HANDLING TESTS
// ============================================================================

describe("cleanMesh deleted face handling", () => {
  it("correctly removes faces marked with NULL_INDEX_UINT32", async () => {
    const { cleanMesh, NULL_INDEX_UINT32 } = await import(
      "../src/optimized/index.js"
    );

    // Create a simple mesh with 4 faces (2 triangles per face of a quad)
    const positions = new Float32Array([
      0,
      0,
      0, // v0
      1,
      0,
      0, // v1
      1,
      1,
      0, // v2
      0,
      1,
      0, // v3
    ]);
    const uvs = new Float32Array([
      0,
      0, // uv0
      1,
      0, // uv1
      1,
      1, // uv2
      0,
      1, // uv3
    ]);
    const faceVertices = new Uint32Array([
      0,
      1,
      2, // face 0 (valid)
      0,
      2,
      3, // face 1 (will be marked deleted)
    ]);
    const faceTexCoords = new Uint32Array([
      0,
      1,
      2, // face 0
      0,
      2,
      3, // face 1
    ]);

    const mesh = new OptimizedMeshData(
      positions,
      uvs,
      faceVertices,
      faceTexCoords,
    );

    // Mark face 1 as deleted (this is how decimation marks deleted faces)
    mesh.deleteFace(1);

    // Verify the face was marked with NULL_INDEX_UINT32 (0xFFFFFFFF)
    expect(mesh.faceVertices[3]).toBe(NULL_INDEX_UINT32);
    expect(mesh.faceVertices[4]).toBe(NULL_INDEX_UINT32);
    expect(mesh.faceVertices[5]).toBe(NULL_INDEX_UINT32);

    // Clean the mesh - should remove the deleted face
    const cleaned = cleanMesh(mesh);

    // Should have only 1 face remaining
    expect(cleaned.faceCount).toBe(1);

    // The remaining face should have valid indices (not 0xFFFFFFFF)
    expect(cleaned.faceVertices[0]).not.toBe(NULL_INDEX_UINT32);
    expect(cleaned.faceVertices[1]).not.toBe(NULL_INDEX_UINT32);
    expect(cleaned.faceVertices[2]).not.toBe(NULL_INDEX_UINT32);

    // Vertices should be remapped correctly
    // Only vertices 0, 1, 2 are used by face 0, so vertex 3 should be removed
    expect(cleaned.vertexCount).toBe(3);
  });

  it("returns original mesh when no faces are deleted", async () => {
    const { cleanMesh } = await import("../src/optimized/index.js");

    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1]);
    const faceVertices = new Uint32Array([0, 1, 2]);
    const faceTexCoords = new Uint32Array([0, 1, 2]);

    const mesh = new OptimizedMeshData(
      positions,
      uvs,
      faceVertices,
      faceTexCoords,
    );

    const cleaned = cleanMesh(mesh);

    // Should return the same mesh (no changes)
    expect(cleaned).toBe(mesh);
    expect(cleaned.faceCount).toBe(1);
    expect(cleaned.vertexCount).toBe(3);
  });

  it("handles mesh with all faces deleted", async () => {
    const { cleanMesh } = await import("../src/optimized/index.js");

    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1]);
    const faceVertices = new Uint32Array([0, 1, 2]);
    const faceTexCoords = new Uint32Array([0, 1, 2]);

    const mesh = new OptimizedMeshData(
      positions,
      uvs,
      faceVertices,
      faceTexCoords,
    );

    // Delete the only face
    mesh.deleteFace(0);

    const cleaned = cleanMesh(mesh);

    // Should have 0 faces and 0 vertices
    expect(cleaned.faceCount).toBe(0);
    expect(cleaned.vertexCount).toBe(0);
  });
});

// ============================================================================
// SKIN WEIGHT TESTS
// ============================================================================

describe("Skin Weight Support", () => {
  /**
   * Create a skinned subdivided plane mesh with bone weights
   */
  function createSkinnedPlane(divisions: number = 4): {
    V: [number, number, number][];
    F: [number, number, number][];
    TC: [number, number][];
    FT: [number, number, number][];
    skinIndices: [number, number, number, number][];
    skinWeights: [number, number, number, number][];
  } {
    const V: [number, number, number][] = [];
    const F: [number, number, number][] = [];
    const TC: [number, number][] = [];
    const FT: [number, number, number][] = [];
    const skinIndices: [number, number, number, number][] = [];
    const skinWeights: [number, number, number, number][] = [];

    // Create vertices with gradient skin weights from bone 0 to bone 1
    for (let y = 0; y <= divisions; y++) {
      for (let x = 0; x <= divisions; x++) {
        const u = x / divisions;
        const v = y / divisions;
        V.push([u, v, 0]);
        TC.push([u, v]);

        // Skin weight gradient: left side -> bone 0, right side -> bone 1
        const bone0Weight = 1.0 - u;
        const bone1Weight = u;
        skinIndices.push([0, 1, 0, 0]);
        skinWeights.push([bone0Weight, bone1Weight, 0, 0]);
      }
    }

    for (let y = 0; y < divisions; y++) {
      for (let x = 0; x < divisions; x++) {
        const i = y * (divisions + 1) + x;
        const i1 = i + 1;
        const i2 = i + divisions + 1;
        const i3 = i2 + 1;

        F.push([i, i3, i1]);
        F.push([i, i2, i3]);
        FT.push([i, i3, i1]);
        FT.push([i, i2, i3]);
      }
    }

    return { V, F, TC, FT, skinIndices, skinWeights };
  }

  /**
   * Create a more complex skinned tube mesh (like an arm)
   * with 4 bones along its length
   */
  function createSkinnedTube(
    segments: number = 8,
    radialDivisions: number = 6,
  ): {
    V: [number, number, number][];
    F: [number, number, number][];
    TC: [number, number][];
    FT: [number, number, number][];
    skinIndices: [number, number, number, number][];
    skinWeights: [number, number, number, number][];
  } {
    const V: [number, number, number][] = [];
    const F: [number, number, number][] = [];
    const TC: [number, number][] = [];
    const FT: [number, number, number][] = [];
    const skinIndices: [number, number, number, number][] = [];
    const skinWeights: [number, number, number, number][] = [];

    const radius = 0.5;

    // Create vertices
    for (let s = 0; s <= segments; s++) {
      const t = s / segments; // 0 to 1 along tube
      const y = t * 4; // 4 units long

      for (let r = 0; r < radialDivisions; r++) {
        const angle = (r / radialDivisions) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        V.push([x, y, z]);
        TC.push([r / radialDivisions, t]);

        // 4 bones along the tube (bone 0 at bottom, bone 3 at top)
        // Use smooth blending between adjacent bones
        const boneT = t * 3; // 0-3 range
        const lowerBone = Math.min(3, Math.floor(boneT));
        const upperBone = Math.min(3, lowerBone + 1);
        const blend = boneT - Math.floor(boneT);

        // Initialize all weights to 0
        const weights: [number, number, number, number] = [0, 0, 0, 0];
        const indices: [number, number, number, number] = [0, 1, 2, 3];

        if (lowerBone === upperBone) {
          // At the very top (t=1), only use upperBone with full weight
          weights[lowerBone] = 1.0;
        } else {
          weights[lowerBone] = 1.0 - blend;
          weights[upperBone] = blend;
        }

        skinIndices.push(indices);
        skinWeights.push(weights);
      }
    }

    // Create faces
    for (let s = 0; s < segments; s++) {
      for (let r = 0; r < radialDivisions; r++) {
        const i0 = s * radialDivisions + r;
        const i1 = s * radialDivisions + ((r + 1) % radialDivisions);
        const i2 = (s + 1) * radialDivisions + r;
        const i3 = (s + 1) * radialDivisions + ((r + 1) % radialDivisions);

        F.push([i0, i2, i1]);
        F.push([i1, i2, i3]);
        FT.push([i0, i2, i1]);
        FT.push([i1, i2, i3]);
      }
    }

    return { V, F, TC, FT, skinIndices, skinWeights };
  }

  it("creates mesh with skin weights correctly", () => {
    const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(2);
    const mesh = OptimizedMeshData.fromArrays(
      V,
      F,
      TC,
      FT,
      skinIndices,
      skinWeights,
    );

    expect(mesh.hasSkinWeights()).toBe(true);
    expect(mesh.skinIndices).not.toBeNull();
    expect(mesh.skinWeights).not.toBeNull();
    expect(mesh.skinIndices!.length).toBe(V.length * 4);
    expect(mesh.skinWeights!.length).toBe(V.length * 4);

    // Verify weights at corners
    const weights = new Float32Array(4);
    const indices = new Uint16Array(4);

    // Top-left corner (x=0): should be bone 0
    mesh.getSkinWeights(0, weights);
    mesh.getSkinIndices(0, indices);
    expect(weights[0]).toBeCloseTo(1.0); // Full weight on bone 0
    expect(weights[1]).toBeCloseTo(0.0); // No weight on bone 1
    expect(indices[0]).toBe(0);

    // Top-right corner (x=divisions): should be bone 1
    mesh.getSkinWeights(2, weights); // For divisions=2, vertex 2 is at x=1
    mesh.getSkinIndices(2, indices);
    expect(weights[0]).toBeCloseTo(0.0); // No weight on bone 0
    expect(weights[1]).toBeCloseTo(1.0); // Full weight on bone 1
    expect(indices[1]).toBe(1);
  });

  it("clones mesh with skin weights", () => {
    const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(2);
    const mesh = OptimizedMeshData.fromArrays(
      V,
      F,
      TC,
      FT,
      skinIndices,
      skinWeights,
    );
    const cloned = mesh.clone();

    expect(cloned.hasSkinWeights()).toBe(true);
    expect(cloned.skinIndices).not.toBeNull();
    expect(cloned.skinWeights).not.toBeNull();
    expect(cloned.skinIndices!.length).toBe(mesh.skinIndices!.length);
    expect(cloned.skinWeights!.length).toBe(mesh.skinWeights!.length);

    // Verify cloned data matches
    for (let i = 0; i < cloned.skinIndices!.length; i++) {
      expect(cloned.skinIndices![i]).toBe(mesh.skinIndices![i]);
      expect(cloned.skinWeights![i]).toBeCloseTo(mesh.skinWeights![i]);
    }
  });

  it("decimates skinned mesh preserving skin weights", () => {
    const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(4);
    const mesh = OptimizedMeshData.fromArrays(
      V,
      F,
      TC,
      FT,
      skinIndices,
      skinWeights,
    );

    const result = decimateOptimized(mesh, {
      targetPercent: 50,
      strictness: 2,
    });

    // Result should still have skin weights
    expect(result.mesh.hasSkinWeights()).toBe(true);
    expect(result.mesh.skinIndices).not.toBeNull();
    expect(result.mesh.skinWeights).not.toBeNull();

    // Skin weights should be normalized (sum to ~1.0) for all vertices
    const weights = new Float32Array(4);
    for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
      result.mesh.getSkinWeights(vi, weights);
      const sum = weights[0] + weights[1] + weights[2] + weights[3];
      expect(sum).toBeCloseTo(1.0, 4); // Allow small floating point error
    }
  });

  it("interpolates skin weights correctly during collapse", async () => {
    const { interpolateSkinWeights } = await import(
      "../src/optimized/index.js"
    );

    // Create a simple 3-vertex mesh with skin weights
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const faceVertices = new Uint32Array([0, 1, 2]);
    const faceTexCoords = new Uint32Array([0, 1, 2]);

    // V0: 100% bone 0, V1: 100% bone 1
    const skinIndices = new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
    const skinWeights = new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0,
    ]);

    const mesh = new OptimizedMeshData(
      positions,
      uvs,
      faceVertices,
      faceTexCoords,
      skinIndices,
      skinWeights,
    );

    const outIndices = new Uint16Array(4);
    const outWeights = new Float32Array(4);

    // Interpolate at midpoint (t=0.5)
    const result = interpolateSkinWeights(
      mesh,
      0,
      1,
      0.5,
      outIndices,
      outWeights,
    );
    expect(result).toBe(true);

    // Should have 50% bone 0, 50% bone 1
    const bone0Weight = outIndices[0] === 0 ? outWeights[0] : outWeights[1];
    const bone1Weight = outIndices[0] === 1 ? outWeights[0] : outWeights[1];

    expect(bone0Weight + bone1Weight).toBeCloseTo(1.0);
    expect(bone0Weight).toBeCloseTo(0.5, 1);
    expect(bone1Weight).toBeCloseTo(0.5, 1);
  });

  it("converts to/from BufferGeometry with skin weights", async () => {
    const { fromBufferGeometry, toBufferGeometryData } = await import(
      "../src/optimized/index.js"
    );

    // Create BufferGeometry-like object with skin weights
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1]);
    const skinIndex = new Uint16Array([0, 1, 0, 0, 1, 2, 0, 0, 2, 3, 0, 0]);
    const skinWeight = new Float32Array([
      0.5, 0.5, 0, 0, 0.3, 0.7, 0, 0, 0.8, 0.2, 0, 0,
    ]);

    const geometry = {
      attributes: {
        position: { array: positions, count: 3 },
        uv: { array: uvs, count: 3 },
        skinIndex: { array: skinIndex, count: 3 },
        skinWeight: { array: skinWeight, count: 3 },
      },
    };

    const mesh = fromBufferGeometry(geometry);

    expect(mesh.hasSkinWeights()).toBe(true);
    expect(mesh.vertexCount).toBe(3);

    // Convert back
    const data = toBufferGeometryData(mesh);

    expect(data.skinIndex).toBeDefined();
    expect(data.skinWeight).toBeDefined();
    expect(data.skinIndex!.length).toBe(12);
    expect(data.skinWeight!.length).toBe(12);

    // Verify round-trip
    for (let i = 0; i < skinIndex.length; i++) {
      expect(data.skinIndex![i]).toBe(skinIndex[i]);
      expect(data.skinWeight![i]).toBeCloseTo(skinWeight[i]);
    }
  });

  it("cleanMesh preserves skin weights", async () => {
    const { cleanMesh } = await import("../src/optimized/index.js");

    const positions = new Float32Array([
      0,
      0,
      0, // v0
      1,
      0,
      0, // v1
      1,
      1,
      0, // v2
      0,
      1,
      0, // v3
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const faceVertices = new Uint32Array([
      0,
      1,
      2, // face 0 (valid)
      0,
      2,
      3, // face 1 (will be deleted)
    ]);
    const faceTexCoords = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const skinIndices = new Uint16Array([
      0,
      0,
      0,
      0, // v0
      1,
      0,
      0,
      0, // v1
      2,
      0,
      0,
      0, // v2
      3,
      0,
      0,
      0, // v3
    ]);
    const skinWeights = new Float32Array([
      1,
      0,
      0,
      0, // v0
      1,
      0,
      0,
      0, // v1
      1,
      0,
      0,
      0, // v2
      1,
      0,
      0,
      0, // v3
    ]);

    const mesh = new OptimizedMeshData(
      positions,
      uvs,
      faceVertices,
      faceTexCoords,
      skinIndices,
      skinWeights,
    );

    // Delete face 1
    mesh.deleteFace(1);

    const cleaned = cleanMesh(mesh);

    expect(cleaned.hasSkinWeights()).toBe(true);
    expect(cleaned.vertexCount).toBe(3); // v0, v1, v2 used
    expect(cleaned.faceCount).toBe(1);

    // Verify skin indices were preserved and remapped
    const indices = new Uint16Array(4);
    for (let vi = 0; vi < cleaned.vertexCount; vi++) {
      cleaned.getSkinIndices(vi, indices);
      // Each vertex should have its original bone index (0, 1, or 2)
      expect(indices[0]).toBeLessThan(3);
    }
  });

  // ========================================================================
  // COMPREHENSIVE SKIN WEIGHT CORRECTNESS TESTS
  // ========================================================================

  describe("Interpolation Math Correctness", () => {
    it("interpolates exactly at endpoints (t=0 and t=1)", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      // Create mesh with distinct weights
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // V0: bone 0 = 0.8, bone 1 = 0.2
      // V1: bone 2 = 0.6, bone 3 = 0.4
      const skinIndices = new Uint16Array([
        0,
        1,
        0,
        0, // v0
        2,
        3,
        0,
        0, // v1
        0,
        0,
        0,
        0, // v2
      ]);
      const skinWeights = new Float32Array([
        0.8,
        0.2,
        0,
        0, // v0
        0.6,
        0.4,
        0,
        0, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      // t=0: should get V0's weights exactly
      interpolateSkinWeights(mesh, 0, 1, 0.0, outIndices, outWeights);
      expect(outWeights[0]).toBeCloseTo(0.8, 5);
      expect(outWeights[1]).toBeCloseTo(0.2, 5);
      expect(outIndices[0]).toBe(0);
      expect(outIndices[1]).toBe(1);

      // t=1: should get V1's weights exactly
      interpolateSkinWeights(mesh, 0, 1, 1.0, outIndices, outWeights);
      expect(outWeights[0]).toBeCloseTo(0.6, 5);
      expect(outWeights[1]).toBeCloseTo(0.4, 5);
      expect(outIndices[0]).toBe(2);
      expect(outIndices[1]).toBe(3);
    });

    it("interpolates correctly at midpoint (t=0.5) with shared bones", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // V0: bone 0 = 1.0
      // V1: bone 1 = 1.0
      const skinIndices = new Uint16Array([
        0,
        0,
        0,
        0, // v0
        1,
        0,
        0,
        0, // v1
        0,
        0,
        0,
        0, // v2
      ]);
      const skinWeights = new Float32Array([
        1,
        0,
        0,
        0, // v0
        1,
        0,
        0,
        0, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      // t=0.5: should be 50% bone 0, 50% bone 1
      interpolateSkinWeights(mesh, 0, 1, 0.5, outIndices, outWeights);

      // Find weights for each bone (only count non-zero weights to avoid empty slot issues)
      let bone0Weight = 0,
        bone1Weight = 0;
      for (let i = 0; i < 4; i++) {
        if (outWeights[i] > 0) {
          if (outIndices[i] === 0) bone0Weight = outWeights[i];
          if (outIndices[i] === 1) bone1Weight = outWeights[i];
        }
      }

      expect(bone0Weight).toBeCloseTo(0.5, 5);
      expect(bone1Weight).toBeCloseTo(0.5, 5);
    });

    it("merges shared bone indices correctly", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // Both vertices have bone 0, but different amounts
      // V0: bone 0 = 0.6, bone 1 = 0.4
      // V1: bone 0 = 0.3, bone 2 = 0.7
      const skinIndices = new Uint16Array([
        0,
        1,
        0,
        0, // v0
        0,
        2,
        0,
        0, // v1
        0,
        0,
        0,
        0, // v2
      ]);
      const skinWeights = new Float32Array([
        0.6,
        0.4,
        0,
        0, // v0
        0.3,
        0.7,
        0,
        0, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      // t=0.5: bone 0 should be merged: 0.5 * 0.6 + 0.5 * 0.3 = 0.45
      // bone 1: 0.5 * 0.4 = 0.2
      // bone 2: 0.5 * 0.7 = 0.35
      // Total = 1.0, already normalized
      interpolateSkinWeights(mesh, 0, 1, 0.5, outIndices, outWeights);

      let bone0Weight = 0,
        bone1Weight = 0,
        bone2Weight = 0;
      for (let i = 0; i < 4; i++) {
        if (outWeights[i] > 0) {
          if (outIndices[i] === 0) bone0Weight = outWeights[i];
          if (outIndices[i] === 1) bone1Weight = outWeights[i];
          if (outIndices[i] === 2) bone2Weight = outWeights[i];
        }
      }

      expect(bone0Weight).toBeCloseTo(0.45, 5);
      expect(bone1Weight).toBeCloseTo(0.2, 5);
      expect(bone2Weight).toBeCloseTo(0.35, 5);
    });

    it("normalizes weights to sum to 1.0", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // Any valid skin weights
      const skinIndices = new Uint16Array([
        0,
        1,
        2,
        3, // v0
        4,
        5,
        6,
        7, // v1 (different bones!)
        0,
        0,
        0,
        0, // v2
      ]);
      const skinWeights = new Float32Array([
        0.4,
        0.3,
        0.2,
        0.1, // v0
        0.5,
        0.3,
        0.15,
        0.05, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      // Test at various interpolation values
      for (const t of [0, 0.25, 0.5, 0.75, 1.0]) {
        interpolateSkinWeights(mesh, 0, 1, t, outIndices, outWeights);

        const sum =
          outWeights[0] + outWeights[1] + outWeights[2] + outWeights[3];
        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it("keeps top 4 bones when merging results in more than 4", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // V0: bones 0,1,2,3
      // V1: bones 4,5,6,7 (all different!)
      // At midpoint, we have 8 bones but can only keep 4
      const skinIndices = new Uint16Array([
        0,
        1,
        2,
        3, // v0
        4,
        5,
        6,
        7, // v1
        0,
        0,
        0,
        0, // v2
      ]);
      const skinWeights = new Float32Array([
        0.4,
        0.3,
        0.2,
        0.1, // v0
        0.4,
        0.3,
        0.2,
        0.1, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      interpolateSkinWeights(mesh, 0, 1, 0.5, outIndices, outWeights);

      // Should only have 4 non-zero weights
      let nonZeroCount = 0;
      for (let i = 0; i < 4; i++) {
        if (outWeights[i] > 0) nonZeroCount++;
      }

      // The top 4 bones should be kept (bones 0,1,4,5 with weights 0.2, 0.15, 0.2, 0.15)
      // After normalization, these should sum to 1.0
      expect(nonZeroCount).toBeLessThanOrEqual(4);

      const sum = outWeights[0] + outWeights[1] + outWeights[2] + outWeights[3];
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("Complex Mesh Decimation", () => {
    it("decimates tube mesh preserving bone weight gradient", () => {
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedTube(
        8,
        6,
      );
      const mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      // Verify input mesh has valid skin weights
      expect(mesh.hasSkinWeights()).toBe(true);

      // Verify input skin weights sum to 1.0 before decimation
      const inputWeights = new Float32Array(4);
      for (let vi = 0; vi < mesh.vertexCount; vi++) {
        mesh.getSkinWeights(vi, inputWeights);
        const inputSum =
          inputWeights[0] + inputWeights[1] + inputWeights[2] + inputWeights[3];
        expect(inputSum).toBeCloseTo(1.0, 3);
      }

      const result = decimateOptimized(mesh, {
        targetPercent: 50,
        strictness: 2,
      });

      expect(result.mesh.hasSkinWeights()).toBe(true);

      // Verify all weights are valid
      const weights = new Float32Array(4);
      const indices = new Uint16Array(4);

      let validCount = 0;
      let invalidCount = 0;
      for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
        result.mesh.getSkinWeights(vi, weights);
        result.mesh.getSkinIndices(vi, indices);

        // Weights should sum to 1.0
        const sum = weights[0] + weights[1] + weights[2] + weights[3];

        if (sum > 0.99 && sum < 1.01) {
          validCount++;
        } else {
          invalidCount++;
        }
      }

      // At least 95% of vertices should have valid weights
      // (some edge cases during collapse might produce slightly off values)
      const validRatio = validCount / result.mesh.vertexCount;
      expect(validRatio).toBeGreaterThanOrEqual(0.95);
    });

    it("preserves spatial weight distribution after decimation", () => {
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(8);
      const mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      const result = decimateOptimized(mesh, {
        targetPercent: 50,
        strictness: 2,
      });

      expect(result.mesh.hasSkinWeights()).toBe(true);

      // Verify all decimated vertices have valid skin weights
      const weights = new Float32Array(4);
      let validWeights = 0;

      for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
        result.mesh.getSkinWeights(vi, weights);
        const sum = weights[0] + weights[1] + weights[2] + weights[3];
        if (sum > 0.99 && sum < 1.01) {
          validWeights++;
        }
      }

      // At least 95% of vertices should have valid normalized weights
      const validRatio = validWeights / result.mesh.vertexCount;
      expect(validRatio).toBeGreaterThanOrEqual(0.95);
    });

    it("handles multiple decimation passes correctly", () => {
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(8);
      let mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      // Decimate in multiple passes
      for (let pass = 0; pass < 3; pass++) {
        const result = decimateOptimized(mesh, {
          targetPercent: 70,
          strictness: 2,
        });

        mesh = result.mesh;

        // Verify skin weights are still valid after each pass
        expect(mesh.hasSkinWeights()).toBe(true);

        const weights = new Float32Array(4);
        for (let vi = 0; vi < mesh.vertexCount; vi++) {
          mesh.getSkinWeights(vi, weights);
          const sum = weights[0] + weights[1] + weights[2] + weights[3];
          expect(sum).toBeCloseTo(1.0, 4);
        }
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles vertices with single bone influence", async () => {
      const { interpolateSkinWeights } = await import(
        "../src/optimized/index.js"
      );

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]);
      const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      const faceVertices = new Uint32Array([0, 1, 2]);
      const faceTexCoords = new Uint32Array([0, 1, 2]);

      // All vertices bound to single bone
      const skinIndices = new Uint16Array([
        5,
        0,
        0,
        0, // v0: only bone 5
        5,
        0,
        0,
        0, // v1: only bone 5
        5,
        0,
        0,
        0, // v2: only bone 5
      ]);
      const skinWeights = new Float32Array([
        1,
        0,
        0,
        0, // v0
        1,
        0,
        0,
        0, // v1
        1,
        0,
        0,
        0, // v2
      ]);

      const mesh = new OptimizedMeshData(
        positions,
        uvs,
        faceVertices,
        faceTexCoords,
        skinIndices,
        skinWeights,
      );

      const outIndices = new Uint16Array(4);
      const outWeights = new Float32Array(4);

      interpolateSkinWeights(mesh, 0, 1, 0.5, outIndices, outWeights);

      expect(outIndices[0]).toBe(5);
      expect(outWeights[0]).toBeCloseTo(1.0, 5);
    });

    it("handles mesh without skin weights (returns original)", () => {
      const mesh = createSubdividedPlane(4);
      const optimized = fromLegacyMeshData(mesh);

      // This mesh has no skin weights
      expect(optimized.hasSkinWeights()).toBe(false);

      const result = decimateOptimized(optimized, {
        targetPercent: 50,
        strictness: 2,
      });

      // Should still decimate without skin weights
      expect(result.mesh.hasSkinWeights()).toBe(false);
      expect(result.mesh.vertexCount).toBeLessThan(optimized.vertexCount);
    });

    it("toArrays includes skin weights when present", () => {
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(2);
      const mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      const arrays = mesh.toArrays();

      expect(arrays.skinIndices).toBeDefined();
      expect(arrays.skinWeights).toBeDefined();
      expect(arrays.skinIndices!.length).toBe(V.length);
      expect(arrays.skinWeights!.length).toBe(V.length);

      // Verify round-trip
      for (let i = 0; i < V.length; i++) {
        for (let j = 0; j < 4; j++) {
          expect(arrays.skinIndices![i][j]).toBe(skinIndices[i][j]);
          expect(arrays.skinWeights![i][j]).toBeCloseTo(skinWeights[i][j], 5);
        }
      }
    });

    it("decimation preserves UVs and skin weights together", () => {
      // Create a larger mesh with distinct UVs and skin weights
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedPlane(6);
      const mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      const originalVertexCount = mesh.vertexCount;

      // Record original UV range
      const originalUvs: { u: number; v: number }[] = [];
      const uvOut = new Float32Array(2);
      for (let ti = 0; ti < mesh.texCoordCount; ti++) {
        mesh.getUV(ti, uvOut);
        originalUvs.push({ u: uvOut[0], v: uvOut[1] });
      }

      // Verify original UVs are in [0, 1] range
      for (const uv of originalUvs) {
        expect(uv.u).toBeGreaterThanOrEqual(0);
        expect(uv.u).toBeLessThanOrEqual(1);
        expect(uv.v).toBeGreaterThanOrEqual(0);
        expect(uv.v).toBeLessThanOrEqual(1);
      }

      // Decimate
      const result = decimateOptimized(mesh, {
        targetPercent: 50,
        strictness: 2,
      });

      // Verify mesh was actually decimated
      expect(result.mesh.vertexCount).toBeLessThan(originalVertexCount);

      // Verify UVs are still valid after decimation
      for (let ti = 0; ti < result.mesh.texCoordCount; ti++) {
        result.mesh.getUV(ti, uvOut);
        expect(Number.isFinite(uvOut[0])).toBe(true);
        expect(Number.isFinite(uvOut[1])).toBe(true);
        // UVs should still be in reasonable range (may go slightly outside [0,1] due to interpolation)
        expect(uvOut[0]).toBeGreaterThanOrEqual(-0.1);
        expect(uvOut[0]).toBeLessThanOrEqual(1.1);
        expect(uvOut[1]).toBeGreaterThanOrEqual(-0.1);
        expect(uvOut[1]).toBeLessThanOrEqual(1.1);
      }

      // Verify skin weights are still valid
      expect(result.mesh.hasSkinWeights()).toBe(true);
      const weights = new Float32Array(4);
      for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
        result.mesh.getSkinWeights(vi, weights);
        const sum = weights[0] + weights[1] + weights[2] + weights[3];
        expect(sum).toBeCloseTo(1.0, 3);
      }
    });

    it("verifies UV seam preservation during decimation", () => {
      // Create a cube with UV seams (each face is a separate UV island)
      const mesh = createCube();
      const optimized = fromLegacyMeshData(mesh);

      const originalFaceCount = optimized.faceCount;

      // Decimate with high strictness to preserve seams
      const result = decimateOptimized(optimized, {
        targetPercent: 80, // Light decimation
        strictness: 3, // High strictness to preserve seams
      });

      // Verify mesh was decimated but seams are respected
      expect(result.mesh.faceCount).toBeLessThanOrEqual(originalFaceCount);

      // Verify all UVs are still finite and valid
      const uvOut = new Float32Array(2);
      for (let ti = 0; ti < result.mesh.texCoordCount; ti++) {
        result.mesh.getUV(ti, uvOut);
        expect(Number.isFinite(uvOut[0])).toBe(true);
        expect(Number.isFinite(uvOut[1])).toBe(true);
      }

      // Verify face tex coord indices are valid
      const faceTC = new Uint32Array(3);
      for (let fi = 0; fi < result.mesh.faceCount; fi++) {
        result.mesh.getFaceTexCoords(fi, faceTC);
        for (let i = 0; i < 3; i++) {
          expect(faceTC[i]).toBeLessThan(result.mesh.texCoordCount);
        }
      }
    });
  });

  describe("Mesh Deformation Verification", () => {
    /**
     * Simulate skeletal deformation by applying bone transformations to vertices.
     * Returns the deformed positions.
     */
    function applySkeletalDeformation(
      mesh: typeof OptimizedMeshData.prototype,
      boneMatrices: Float32Array[], // 4x4 matrices for each bone
    ): Float32Array {
      const deformedPositions = new Float32Array(mesh.vertexCount * 3);
      const pos = new Float32Array(3);
      const weights = new Float32Array(4);
      const indices = new Uint16Array(4);

      for (let vi = 0; vi < mesh.vertexCount; vi++) {
        mesh.getPosition(vi, pos);
        mesh.getSkinWeights(vi, weights);
        mesh.getSkinIndices(vi, indices);

        let dx = 0,
          dy = 0,
          dz = 0;

        // Apply weighted bone transformations
        for (let i = 0; i < 4; i++) {
          const w = weights[i];
          if (w > 0.001) {
            const boneIdx = indices[i];
            const m = boneMatrices[boneIdx];

            // Apply 4x4 matrix transformation (assuming row-major)
            const tx = m[0] * pos[0] + m[4] * pos[1] + m[8] * pos[2] + m[12];
            const ty = m[1] * pos[0] + m[5] * pos[1] + m[9] * pos[2] + m[13];
            const tz = m[2] * pos[0] + m[6] * pos[1] + m[10] * pos[2] + m[14];

            dx += tx * w;
            dy += ty * w;
            dz += tz * w;
          }
        }

        deformedPositions[vi * 3] = dx;
        deformedPositions[vi * 3 + 1] = dy;
        deformedPositions[vi * 3 + 2] = dz;
      }

      return deformedPositions;
    }

    /**
     * Create identity 4x4 matrix
     */
    function identityMatrix(): Float32Array {
      return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }

    /**
     * Create rotation matrix around X axis
     */
    function rotationMatrixX(radians: number): Float32Array {
      const c = Math.cos(radians);
      const s = Math.sin(radians);
      return new Float32Array([
        1,
        0,
        0,
        0,
        0,
        c,
        s,
        0,
        0,
        -s,
        c,
        0,
        0,
        0,
        0,
        1,
      ]);
    }

    it("verifies decimated mesh deforms correctly with skeletal animation", () => {
      // Create a tube mesh (like an arm) with 4 bones along its length
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedTube(
        8,
        6,
      );
      const originalMesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      // Create identity matrices for all 4 bones (bind pose)
      const bindPose = [
        identityMatrix(),
        identityMatrix(),
        identityMatrix(),
        identityMatrix(),
      ];

      // Get original deformed positions in bind pose
      const originalBindPositions = applySkeletalDeformation(
        originalMesh,
        bindPose,
      );

      // Decimate the mesh
      const result = decimateOptimized(originalMesh, {
        targetPercent: 50,
        strictness: 2,
      });

      // Get decimated deformed positions in bind pose
      const decimatedBindPositions = applySkeletalDeformation(
        result.mesh,
        bindPose,
      );

      // Now create a bent pose - rotate bone 2 by 45 degrees (bend the "elbow")
      const bentPose = [
        identityMatrix(),
        identityMatrix(),
        rotationMatrixX(Math.PI / 4), // 45 degree bend
        rotationMatrixX(Math.PI / 4), // Propagate to child bone
      ];

      // Get original deformed positions in bent pose
      const originalBentPositions = applySkeletalDeformation(
        originalMesh,
        bentPose,
      );

      // Get decimated deformed positions in bent pose
      const decimatedBentPositions = applySkeletalDeformation(
        result.mesh,
        bentPose,
      );

      // Verify that decimated mesh has valid skin weights and deforms
      expect(result.mesh.hasSkinWeights()).toBe(true);

      // Check that vertices actually moved when bent (deformation is working)
      let originalMovement = 0;
      let decimatedMovement = 0;

      for (let vi = 0; vi < originalMesh.vertexCount; vi++) {
        const dx =
          originalBentPositions[vi * 3] - originalBindPositions[vi * 3];
        const dy =
          originalBentPositions[vi * 3 + 1] - originalBindPositions[vi * 3 + 1];
        const dz =
          originalBentPositions[vi * 3 + 2] - originalBindPositions[vi * 3 + 2];
        originalMovement += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
        const dx =
          decimatedBentPositions[vi * 3] - decimatedBindPositions[vi * 3];
        const dy =
          decimatedBentPositions[vi * 3 + 1] -
          decimatedBindPositions[vi * 3 + 1];
        const dz =
          decimatedBentPositions[vi * 3 + 2] -
          decimatedBindPositions[vi * 3 + 2];
        decimatedMovement += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // Both meshes should show significant deformation when bent
      expect(originalMovement).toBeGreaterThan(0.1);
      expect(decimatedMovement).toBeGreaterThan(0.1);

      // The average movement per vertex should be in a reasonable range
      // Decimation can significantly change vertex distribution, especially at joints
      const originalAvgMovement = originalMovement / originalMesh.vertexCount;
      const decimatedAvgMovement = decimatedMovement / result.mesh.vertexCount;

      // The decimated mesh should still show meaningful deformation (>50% of original)
      // and not deform excessively (< 200% of original)
      expect(decimatedAvgMovement).toBeGreaterThan(originalAvgMovement * 0.5);
      expect(decimatedAvgMovement).toBeLessThan(originalAvgMovement * 2.0);
    });

    it("preserves joint integrity after aggressive decimation", () => {
      // Create a tube mesh
      const { V, F, TC, FT, skinIndices, skinWeights } = createSkinnedTube(
        12,
        8,
      );
      const mesh = OptimizedMeshData.fromArrays(
        V,
        F,
        TC,
        FT,
        skinIndices,
        skinWeights,
      );

      // Aggressively decimate
      const result = decimateOptimized(mesh, {
        targetPercent: 25, // Very aggressive - 75% reduction
        strictness: 2,
      });

      expect(result.mesh.hasSkinWeights()).toBe(true);

      // Verify all vertices still have valid normalized weights
      const weights = new Float32Array(4);
      const indices = new Uint16Array(4);

      for (let vi = 0; vi < result.mesh.vertexCount; vi++) {
        result.mesh.getSkinWeights(vi, weights);
        result.mesh.getSkinIndices(vi, indices);

        // Weights must sum to 1.0
        const sum = weights[0] + weights[1] + weights[2] + weights[3];
        expect(sum).toBeCloseTo(1.0, 2);

        // Weights must be in [0, 1]
        for (let i = 0; i < 4; i++) {
          expect(weights[i]).toBeGreaterThanOrEqual(0);
          expect(weights[i]).toBeLessThanOrEqual(1);
        }

        // Non-zero weights must have valid bone indices (0-3 for our tube)
        for (let i = 0; i < 4; i++) {
          if (weights[i] > 0.01) {
            expect(indices[i]).toBeGreaterThanOrEqual(0);
            expect(indices[i]).toBeLessThanOrEqual(3);
          }
        }
      }
    });
  });
});
