/**
 * Optimized Mesh Connectivity Builder
 *
 * Builds edge-face connectivity structures using typed arrays.
 */

import {
  OptimizedMeshData,
  OptimizedEdgeFlaps,
  OptimizedSeamEdgeSet,
  OptimizedSeamVertexMap,
  NULL_INDEX,
} from "./types.js";

// ============================================================================
// EDGE HASH TABLE FOR BUILDING CONNECTIVITY
// ============================================================================

/**
 * Temporary hash table for edge building (not exported, used internally)
 * Uses open addressing with linear probing
 */
class EdgeHashTable {
  private keys: BigInt64Array;
  private values: Int32Array;
  private capacity: number;
  private size: number;

  constructor(capacity: number) {
    // Round up to power of 2
    this.capacity = 1;
    while (this.capacity < capacity) {
      this.capacity *= 2;
    }
    this.keys = new BigInt64Array(this.capacity);
    this.keys.fill(BigInt(-1));
    this.values = new Int32Array(this.capacity);
    this.values.fill(-1);
    this.size = 0;
  }

  private encodeEdge(v0: number, v1: number): bigint {
    const min = v0 < v1 ? v0 : v1;
    const max = v0 < v1 ? v1 : v0;
    return (BigInt(min) << BigInt(32)) | BigInt(max);
  }

  private hash(key: bigint): number {
    let h = key;
    h ^= h >> BigInt(33);
    h *= 0xff51afd7ed558ccdn;
    h ^= h >> BigInt(33);
    return Number(h & BigInt(this.capacity - 1));
  }

  /**
   * Get or create edge index
   * Returns [edgeIndex, isNew]
   */
  getOrCreate(v0: number, v1: number, nextIndex: number): [number, boolean] {
    const key = this.encodeEdge(v0, v1);
    let index = this.hash(key);

    while (this.keys[index] !== BigInt(-1)) {
      if (this.keys[index] === key) {
        return [this.values[index], false];
      }
      index = (index + 1) & (this.capacity - 1);
    }

    // Insert new
    this.keys[index] = key;
    this.values[index] = nextIndex;
    this.size++;
    return [nextIndex, true];
  }

  getSize(): number {
    return this.size;
  }
}

// ============================================================================
// BUILD EDGE FLAPS
// ============================================================================

/**
 * Build edge-face connectivity from mesh faces.
 *
 * For each edge, stores:
 * - The two endpoint vertices (sorted: E[ei*2] < E[ei*2+1])
 * - The two adjacent faces (-1 for boundary)
 * - The opposite corner index in each face
 *
 * @param mesh Input mesh
 * @returns Edge connectivity structure
 */
export function buildEdgeFlaps(mesh: OptimizedMeshData): OptimizedEdgeFlaps {
  const faceCount = mesh.faceCount;
  const maxEdges = faceCount * 3; // Upper bound

  // First pass: count unique edges
  const edgeTable = new EdgeHashTable(maxEdges * 2);
  let edgeCount = 0;

  for (let fi = 0; fi < faceCount; fi++) {
    const base = fi * 3;
    for (let ki = 0; ki < 3; ki++) {
      const v0 = mesh.faceVertices[base + ki];
      const v1 = mesh.faceVertices[base + ((ki + 1) % 3)];

      const [_ei, isNew] = edgeTable.getOrCreate(v0, v1, edgeCount);
      if (isNew) {
        edgeCount++;
      }
    }
  }

  // Create edge flaps structure
  const flaps = new OptimizedEdgeFlaps(edgeCount, faceCount);

  // Reset table for second pass
  const edgeTable2 = new EdgeHashTable(maxEdges * 2);
  let nextEdgeIndex = 0;

  // Second pass: populate connectivity
  for (let fi = 0; fi < faceCount; fi++) {
    const base = fi * 3;

    for (let ki = 0; ki < 3; ki++) {
      const v0 = mesh.faceVertices[base + ki];
      const v1 = mesh.faceVertices[base + ((ki + 1) % 3)];

      // Get or create edge index
      const [ei, isNew] = edgeTable2.getOrCreate(v0, v1, nextEdgeIndex);

      if (isNew) {
        // Initialize new edge
        const minV = v0 < v1 ? v0 : v1;
        const maxV = v0 < v1 ? v1 : v0;
        flaps.setEdge(ei, minV, maxV);
        nextEdgeIndex++;
      }

      // Map face corner to edge
      flaps.setEdgeForFaceCorner(fi, ki, ei);

      // Determine which side of the edge this face is on
      // Side 0: edge goes v0 -> v1 where v0 < v1 (same as stored order)
      // Side 1: edge goes v1 -> v0 (opposite of stored order)
      const side = (v0 < v1 ? 0 : 1) as 0 | 1;

      // Store the opposite corner index (the vertex NOT on the edge)
      // Edge goes from ki to (ki+1)%3, so opposite is (ki+2)%3
      const oppositeCorner = (ki + 2) % 3;
      flaps.setEdgeFace(ei, side, fi, oppositeCorner);
    }
  }

  return flaps;
}

// ============================================================================
// BUILD SEAM EDGES
// ============================================================================

/**
 * Detect UV seam edges in the mesh.
 *
 * An edge is a seam if:
 * - It has two adjacent faces (not boundary)
 * - The texture coordinates on each side don't match
 *
 * @param mesh Input mesh
 * @param flaps Edge connectivity
 * @returns Seam edge set and vertex map
 */
export function buildSeamEdges(
  mesh: OptimizedMeshData,
  flaps: OptimizedEdgeFlaps,
): { seamEdges: OptimizedSeamEdgeSet; seamVertices: OptimizedSeamVertexMap } {
  const seamEdges = new OptimizedSeamEdgeSet(
    Math.max(1024, flaps.edgeCount / 4),
  );
  const seamVertices = new OptimizedSeamVertexMap(mesh.vertexCount);

  // Temporary arrays for face lookups
  const fv = new Uint32Array(3);
  const ft = new Uint32Array(3);

  for (let ei = 0; ei < flaps.edgeCount; ei++) {
    const [f0, f1] = flaps.getEdgeFaces(ei);

    // Skip boundary edges
    if (f0 === NULL_INDEX || f1 === NULL_INDEX) {
      continue;
    }

    const [v0, v1] = flaps.getEdge(ei);
    const opp0 = flaps.getEdgeOpposite(ei, 0);
    const opp1 = flaps.getEdgeOpposite(ei, 1);

    // Get face vertex and texture indices
    mesh.getFaceVertices(f0, fv);
    mesh.getFaceTexCoords(f0, ft);

    // Find the texture indices for v0 and v1 in face 0
    // Edge is opposite to corner opp0, so edge vertices are at (opp0+1)%3 and (opp0+2)%3
    const e0_v0_corner = (opp0 + 1) % 3;
    const e0_v1_corner = (opp0 + 2) % 3;
    const f0_v0 = fv[e0_v0_corner];
    const f0_t0 = ft[e0_v0_corner];
    const f0_t1 = ft[e0_v1_corner];

    // Determine which vertex is v0 and which is v1 (edge is stored sorted)
    let t0_side0: number, t1_side0: number;
    if (f0_v0 === v0) {
      t0_side0 = f0_t0;
      t1_side0 = f0_t1;
    } else {
      t0_side0 = f0_t1;
      t1_side0 = f0_t0;
    }

    // Get texture indices for face 1
    mesh.getFaceVertices(f1, fv);
    mesh.getFaceTexCoords(f1, ft);

    const e1_v0_corner = (opp1 + 1) % 3;
    const e1_v1_corner = (opp1 + 2) % 3;
    const f1_v0 = fv[e1_v0_corner];
    const f1_t0 = ft[e1_v0_corner];
    const f1_t1 = ft[e1_v1_corner];

    let t0_side1: number, t1_side1: number;
    if (f1_v0 === v0) {
      t0_side1 = f1_t0;
      t1_side1 = f1_t1;
    } else {
      t0_side1 = f1_t1;
      t1_side1 = f1_t0;
    }

    // Check if texture coordinates match across the edge
    // For a non-seam edge, both vertices should have the same TC on both sides
    const isSeam = t0_side0 !== t0_side1 || t1_side0 !== t1_side1;

    if (isSeam) {
      seamEdges.add(v0, v1);
      seamVertices.addSeamEdge(v0, v1);
    }
  }

  return { seamEdges, seamVertices };
}

// ============================================================================
// VERTEX CIRCULATION (1-RING NEIGHBORS)
// ============================================================================

/**
 * Get faces in the 1-ring neighborhood around a vertex by circulating
 * around one side of an edge.
 *
 * @param ei Edge index
 * @param ccw True for counter-clockwise, false for clockwise
 * @param flaps Edge connectivity
 * @param mesh Mesh data
 * @param outFaces Output array for face indices
 * @returns Number of faces found
 */
export function circulation(
  ei: number,
  ccw: boolean,
  flaps: OptimizedEdgeFlaps,
  mesh: OptimizedMeshData,
  outFaces: Int32Array,
): number {
  const faceCount = mesh.faceCount;
  let count = 0;

  const startSide = ccw ? 0 : 1;
  const f0 = flaps.edgeFaces[ei * 2 + startSide];
  if (f0 === NULL_INDEX) return 0;

  let fi = f0;
  let currentEi = ei;
  const maxIterations = faceCount + 1; // Safety limit

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check if face is deleted
    if (mesh.isFaceDeleted(fi)) {
      break;
    }

    outFaces[count++] = fi;

    // Find which side of the current edge we're on
    const currentSide = flaps.edgeFaces[currentEi * 2] === fi ? 0 : 1;

    // Get the opposite corner in the current face (the vertex not on the edge)
    const oppCorner = flaps.edgeOpposites[currentEi * 2 + currentSide];

    // Get the next edge in this face (the one that shares the pivot vertex)
    // For CCW: move to the "previous" edge (oppCorner + 2 = edge ending at pivot)
    // For CW: move to the "next" edge (oppCorner + 1 = edge starting at pivot)
    const dir = ccw ? 2 : 1;
    const nextCorner = (oppCorner + dir) % 3;
    const nextEi = flaps.getEdgeForFaceCorner(fi, nextCorner);

    if (nextEi === NULL_INDEX) break;

    // Move to the face on the other side of the next edge
    const nextEdgeSide = flaps.edgeFaces[nextEi * 2] === fi ? 1 : 0;
    fi = flaps.edgeFaces[nextEi * 2 + nextEdgeSide];

    if (fi === NULL_INDEX) break;
    if (fi === f0) break; // Completed loop

    currentEi = nextEi;
  }

  return count;
}

/**
 * Get all faces around a vertex (combining both circulation directions)
 */
export function getVertexFaces(
  ei: number,
  flaps: OptimizedEdgeFlaps,
  mesh: OptimizedMeshData,
  outFaces: Int32Array,
): number {
  // Get faces from CCW direction
  const count1 = circulation(ei, true, flaps, mesh, outFaces);

  // Get faces from CW direction (may overlap with CCW at boundaries)
  const temp = new Int32Array(outFaces.length);
  const count2 = circulation(ei, false, flaps, mesh, temp);

  // Merge, avoiding duplicates
  const seen = new Set<number>();
  for (let i = 0; i < count1; i++) {
    seen.add(outFaces[i]);
  }

  let totalCount = count1;
  for (let i = 0; i < count2; i++) {
    if (!seen.has(temp[i])) {
      outFaces[totalCount++] = temp[i];
      seen.add(temp[i]);
    }
  }

  return totalCount;
}

// ============================================================================
// LINK CONDITION CHECK
// ============================================================================

/**
 * Check if an edge collapse is valid using the link condition.
 *
 * The edge (s, d) can be collapsed if and only if:
 * link(s) ∩ link(d) = link(edge(s,d))
 *
 * In other words, the only vertices shared by the 1-rings of s and d
 * should be the two vertices opposite the edge in its adjacent faces.
 *
 * @param ei Edge index
 * @param flaps Edge connectivity
 * @param mesh Mesh data
 * @returns True if collapse is valid
 */
export function edgeCollapseIsValid(
  ei: number,
  flaps: OptimizedEdgeFlaps,
  mesh: OptimizedMeshData,
): boolean {
  if (flaps.isEdgeDeleted(ei)) {
    return false;
  }

  const [s, d] = flaps.getEdge(ei);

  // Get vertices in 1-ring of s
  const facesS = new Int32Array(64);
  const countS = circulation(ei, true, flaps, mesh, facesS);
  const Ns = new Set<number>();
  const fv = new Uint32Array(3);

  for (let i = 0; i < countS; i++) {
    const fi = facesS[i];
    if (!mesh.isFaceDeleted(fi)) {
      mesh.getFaceVertices(fi, fv);
      for (let k = 0; k < 3; k++) {
        if (fv[k] !== s) {
          Ns.add(fv[k]);
        }
      }
    }
  }

  // Get vertices in 1-ring of d
  const facesD = new Int32Array(64);
  const countD = circulation(ei, false, flaps, mesh, facesD);
  const Nd = new Set<number>();

  for (let i = 0; i < countD; i++) {
    const fi = facesD[i];
    if (!mesh.isFaceDeleted(fi)) {
      mesh.getFaceVertices(fi, fv);
      for (let k = 0; k < 3; k++) {
        if (fv[k] !== d) {
          Nd.add(fv[k]);
        }
      }
    }
  }

  // Count intersection (excluding s and d)
  let intersectionCount = 0;
  for (const v of Ns) {
    if (Nd.has(v) && v !== s && v !== d) {
      intersectionCount++;
    }
  }

  // Link of edge should be exactly 2 vertices for interior edges,
  // or 1 vertex for boundary edges
  return intersectionCount <= 2;
}

// ============================================================================
// HALF-EDGE BUNDLE (FOR COST COMPUTATION)
// ============================================================================

/**
 * Half-edge bundle information for an edge
 */
export interface HalfEdgeBundle {
  /** Number of half-edges (0, 1, or 2) */
  count: number;

  /** Face index for each side */
  faces: [number, number];

  /** Opposite corner for each side */
  opposites: [number, number];

  /** Vertex bundle for side 0: [start_vi, start_tci, end_vi, end_tci] */
  side0: Uint32Array;

  /** Vertex bundle for side 1: [start_vi, start_tci, end_vi, end_tci] */
  side1: Uint32Array;
}

// Pre-allocated bundle for reuse
const bundleBuffer: HalfEdgeBundle = {
  count: 0,
  faces: [NULL_INDEX, NULL_INDEX],
  opposites: [NULL_INDEX, NULL_INDEX],
  side0: new Uint32Array(4),
  side1: new Uint32Array(4),
};

/**
 * Get half-edge bundle for an edge
 *
 * Returns information about both half-edges (one per adjacent face),
 * including the vertex indices and texture coordinate indices.
 */
export function getHalfEdgeBundle(
  ei: number,
  flaps: OptimizedEdgeFlaps,
  mesh: OptimizedMeshData,
): HalfEdgeBundle {
  const bundle = bundleBuffer;
  bundle.count = 0;
  bundle.faces[0] = NULL_INDEX;
  bundle.faces[1] = NULL_INDEX;
  bundle.opposites[0] = NULL_INDEX;
  bundle.opposites[1] = NULL_INDEX;

  const fv = new Uint32Array(3);
  const ft = new Uint32Array(3);

  for (let side = 0; side < 2; side++) {
    const fi = flaps.edgeFaces[ei * 2 + side];
    const oppCorner = flaps.edgeOpposites[ei * 2 + side];

    if (fi === NULL_INDEX) continue;

    bundle.faces[side] = fi;
    bundle.opposites[side] = oppCorner;
    bundle.count++;

    mesh.getFaceVertices(fi, fv);
    mesh.getFaceTexCoords(fi, ft);

    // Edge vertices are at (oppCorner+1)%3 and (oppCorner+2)%3
    const c1 = (oppCorner + 1) % 3;
    const c2 = (oppCorner + 2) % 3;

    const out = side === 0 ? bundle.side0 : bundle.side1;
    out[0] = fv[c1]; // start vertex
    out[1] = ft[c1]; // start TC
    out[2] = fv[c2]; // end vertex
    out[3] = ft[c2]; // end TC
  }

  return bundle;
}
