/**
 * Optimized Types for High-Performance Mesh Decimation
 *
 * All data structures use flat typed arrays for:
 * - Cache-friendly memory layout
 * - Zero-copy transfer to workers
 * - WebGPU buffer compatibility
 * - SIMD-friendly operations
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Epsilon for floating point comparisons */
export const EPS = 1e-8;

/** Positive infinity marker */
export const INF = Infinity;

/** Null index marker for deleted/invalid elements */
export const NULL_INDEX = -1;

/** Size of a 6x6 matrix (for 5D QEM + homogeneous coordinate) */
export const MATRIX_6X6_SIZE = 36;

/** Size of a 8x8 matrix (for seam edge QEM) */
export const MATRIX_8X8_SIZE = 64;

/** Maximum texture coordinates per vertex (for seam vertices) */
export const MAX_TC_PER_VERTEX = 8;

// ============================================================================
// OPTIMIZED MESH DATA
// ============================================================================

/**
 * Optimized mesh data structure using flat typed arrays.
 *
 * Memory layout:
 * - positions: [x0, y0, z0, x1, y1, z1, ...] (V × 3 floats)
 * - uvs: [u0, v0, u1, v1, ...] (TC × 2 floats)
 * - faceVertices: [v0_f0, v1_f0, v2_f0, v0_f1, ...] (F × 3 indices)
 * - faceTexCoords: [t0_f0, t1_f0, t2_f0, t0_f1, ...] (F × 3 indices)
 */
export class OptimizedMeshData {
  /** Vertex positions: [x, y, z, x, y, z, ...] */
  positions: Float32Array;

  /** Texture coordinates: [u, v, u, v, ...] */
  uvs: Float32Array;

  /** Face vertex indices: [v0, v1, v2, v0, v1, v2, ...] */
  faceVertices: Uint32Array;

  /** Face texture coordinate indices: [t0, t1, t2, t0, t1, t2, ...] */
  faceTexCoords: Uint32Array;

  /** Number of vertices */
  vertexCount: number;

  /** Number of texture coordinates */
  texCoordCount: number;

  /** Number of faces */
  faceCount: number;

  constructor(
    positions: Float32Array,
    uvs: Float32Array,
    faceVertices: Uint32Array,
    faceTexCoords: Uint32Array,
  ) {
    this.positions = positions;
    this.uvs = uvs;
    this.faceVertices = faceVertices;
    this.faceTexCoords = faceTexCoords;
    this.vertexCount = positions.length / 3;
    this.texCoordCount = uvs.length / 2;
    this.faceCount = faceVertices.length / 3;
  }

  /**
   * Create from vertex/face arrays (for compatibility)
   */
  static fromArrays(
    V: [number, number, number][],
    F: [number, number, number][],
    TC: [number, number][],
    FT: [number, number, number][],
  ): OptimizedMeshData {
    const positions = new Float32Array(V.length * 3);
    for (let i = 0; i < V.length; i++) {
      positions[i * 3] = V[i][0];
      positions[i * 3 + 1] = V[i][1];
      positions[i * 3 + 2] = V[i][2];
    }

    const uvs = new Float32Array(TC.length * 2);
    for (let i = 0; i < TC.length; i++) {
      uvs[i * 2] = TC[i][0];
      uvs[i * 2 + 1] = TC[i][1];
    }

    const faceVertices = new Uint32Array(F.length * 3);
    for (let i = 0; i < F.length; i++) {
      faceVertices[i * 3] = F[i][0];
      faceVertices[i * 3 + 1] = F[i][1];
      faceVertices[i * 3 + 2] = F[i][2];
    }

    const faceTexCoords = new Uint32Array(FT.length * 3);
    for (let i = 0; i < FT.length; i++) {
      faceTexCoords[i * 3] = FT[i][0];
      faceTexCoords[i * 3 + 1] = FT[i][1];
      faceTexCoords[i * 3 + 2] = FT[i][2];
    }

    return new OptimizedMeshData(positions, uvs, faceVertices, faceTexCoords);
  }

  /**
   * Convert to vertex/face arrays (for compatibility)
   */
  toArrays(): {
    V: [number, number, number][];
    F: [number, number, number][];
    TC: [number, number][];
    FT: [number, number, number][];
  } {
    const V: [number, number, number][] = [];
    for (let i = 0; i < this.vertexCount; i++) {
      V.push([
        this.positions[i * 3],
        this.positions[i * 3 + 1],
        this.positions[i * 3 + 2],
      ]);
    }

    const TC: [number, number][] = [];
    for (let i = 0; i < this.texCoordCount; i++) {
      TC.push([this.uvs[i * 2], this.uvs[i * 2 + 1]]);
    }

    const F: [number, number, number][] = [];
    const FT: [number, number, number][] = [];
    for (let i = 0; i < this.faceCount; i++) {
      F.push([
        this.faceVertices[i * 3],
        this.faceVertices[i * 3 + 1],
        this.faceVertices[i * 3 + 2],
      ]);
      FT.push([
        this.faceTexCoords[i * 3],
        this.faceTexCoords[i * 3 + 1],
        this.faceTexCoords[i * 3 + 2],
      ]);
    }

    return { V, F, TC, FT };
  }

  /**
   * Create a deep copy
   */
  clone(): OptimizedMeshData {
    return new OptimizedMeshData(
      new Float32Array(this.positions),
      new Float32Array(this.uvs),
      new Uint32Array(this.faceVertices),
      new Uint32Array(this.faceTexCoords),
    );
  }

  /**
   * Get position at vertex index
   */
  getPosition(vi: number, out: Float32Array): void {
    const base = vi * 3;
    out[0] = this.positions[base];
    out[1] = this.positions[base + 1];
    out[2] = this.positions[base + 2];
  }

  /**
   * Set position at vertex index
   */
  setPosition(vi: number, x: number, y: number, z: number): void {
    const base = vi * 3;
    this.positions[base] = x;
    this.positions[base + 1] = y;
    this.positions[base + 2] = z;
  }

  /**
   * Get UV at texture coordinate index
   */
  getUV(ti: number, out: Float32Array): void {
    const base = ti * 2;
    out[0] = this.uvs[base];
    out[1] = this.uvs[base + 1];
  }

  /**
   * Set UV at texture coordinate index
   */
  setUV(ti: number, u: number, v: number): void {
    const base = ti * 2;
    this.uvs[base] = u;
    this.uvs[base + 1] = v;
  }

  /**
   * Get face vertex indices
   */
  getFaceVertices(fi: number, out: Uint32Array): void {
    const base = fi * 3;
    out[0] = this.faceVertices[base];
    out[1] = this.faceVertices[base + 1];
    out[2] = this.faceVertices[base + 2];
  }

  /**
   * Get face texture coordinate indices
   */
  getFaceTexCoords(fi: number, out: Uint32Array): void {
    const base = fi * 3;
    out[0] = this.faceTexCoords[base];
    out[1] = this.faceTexCoords[base + 1];
    out[2] = this.faceTexCoords[base + 2];
  }

  /**
   * Mark a face as deleted by setting all indices to NULL_INDEX
   */
  deleteFace(fi: number): void {
    const base = fi * 3;
    this.faceVertices[base] = NULL_INDEX;
    this.faceVertices[base + 1] = NULL_INDEX;
    this.faceVertices[base + 2] = NULL_INDEX;
    this.faceTexCoords[base] = NULL_INDEX;
    this.faceTexCoords[base + 1] = NULL_INDEX;
    this.faceTexCoords[base + 2] = NULL_INDEX;
  }

  /**
   * Check if face is deleted
   */
  isFaceDeleted(fi: number): boolean {
    return this.faceVertices[fi * 3] === NULL_INDEX;
  }
}

// ============================================================================
// EDGE CONNECTIVITY (FLAT TYPED ARRAYS)
// ============================================================================

/**
 * Edge connectivity data structure using flat typed arrays.
 *
 * This replaces the EdgeFlaps class with cache-friendly arrays.
 */
export class OptimizedEdgeFlaps {
  /** Edge endpoints: [v0_e0, v1_e0, v0_e1, v1_e1, ...] (E × 2) */
  edges: Uint32Array;

  /** Adjacent faces per edge: [f0_e0, f1_e0, f0_e1, f1_e1, ...] (E × 2, -1 for boundary) */
  edgeFaces: Int32Array;

  /** Opposite corner indices: [c0_e0, c1_e0, c0_e1, c1_e1, ...] (E × 2, 0-2) */
  edgeOpposites: Int8Array;

  /** Face corner to edge index: EMAP[corner * faceCount + faceIndex] = edgeIndex */
  faceToEdge: Int32Array;

  /** Number of edges */
  edgeCount: number;

  /** Number of faces (for EMAP indexing) */
  faceCount: number;

  constructor(edgeCount: number, faceCount: number) {
    this.edges = new Uint32Array(edgeCount * 2);
    this.edgeFaces = new Int32Array(edgeCount * 2);
    this.edgeOpposites = new Int8Array(edgeCount * 2);
    this.faceToEdge = new Int32Array(faceCount * 3);
    this.edgeCount = edgeCount;
    this.faceCount = faceCount;

    // Initialize to NULL
    this.edgeFaces.fill(NULL_INDEX);
    this.edgeOpposites.fill(NULL_INDEX);
    this.faceToEdge.fill(NULL_INDEX);
  }

  /**
   * Get edge endpoints
   */
  getEdge(ei: number): [number, number] {
    const base = ei * 2;
    return [this.edges[base], this.edges[base + 1]];
  }

  /**
   * Set edge endpoints
   */
  setEdge(ei: number, v0: number, v1: number): void {
    const base = ei * 2;
    this.edges[base] = v0;
    this.edges[base + 1] = v1;
  }

  /**
   * Get adjacent faces for edge
   */
  getEdgeFaces(ei: number): [number, number] {
    const base = ei * 2;
    return [this.edgeFaces[base], this.edgeFaces[base + 1]];
  }

  /**
   * Set adjacent face for edge side
   */
  setEdgeFace(
    ei: number,
    side: 0 | 1,
    fi: number,
    oppositeCorner: number,
  ): void {
    const base = ei * 2;
    this.edgeFaces[base + side] = fi;
    this.edgeOpposites[base + side] = oppositeCorner;
  }

  /**
   * Get opposite corner for edge side
   */
  getEdgeOpposite(ei: number, side: 0 | 1): number {
    return this.edgeOpposites[ei * 2 + side];
  }

  /**
   * Get edge index for face corner (replaces EMAP lookup)
   */
  getEdgeForFaceCorner(fi: number, corner: number): number {
    return this.faceToEdge[corner * this.faceCount + fi];
  }

  /**
   * Set edge index for face corner
   */
  setEdgeForFaceCorner(fi: number, corner: number, ei: number): void {
    this.faceToEdge[corner * this.faceCount + fi] = ei;
  }

  /**
   * Mark edge as deleted
   */
  deleteEdge(ei: number): void {
    const base = ei * 2;
    this.edges[base] = NULL_INDEX;
    this.edges[base + 1] = NULL_INDEX;
    this.edgeFaces[base] = NULL_INDEX;
    this.edgeFaces[base + 1] = NULL_INDEX;
    this.edgeOpposites[base] = NULL_INDEX;
    this.edgeOpposites[base + 1] = NULL_INDEX;
  }

  /**
   * Check if edge is deleted
   */
  isEdgeDeleted(ei: number): boolean {
    return this.edges[ei * 2] === NULL_INDEX;
  }
}

// ============================================================================
// VERTEX METRICS (FLAT TYPED ARRAYS)
// ============================================================================

/**
 * Per-vertex 5D quadric error metrics using flat typed arrays.
 *
 * For vertices on seams, we store multiple metrics (one per unique TC).
 * Layout: metrics[(vi * MAX_TC_PER_VERTEX + slot) * 36] for 6×6 matrix
 *
 * tcIndices[vi * MAX_TC_PER_VERTEX + slot] = texture coord index, or -1 if unused
 */
export class OptimizedVertexMetrics {
  /** Flat 6×6 matrices: (V × MAX_TC × 36) floats */
  metrics: Float64Array;

  /** TC indices per slot: (V × MAX_TC) ints, -1 if unused */
  tcIndices: Int32Array;

  /** Number of vertices */
  vertexCount: number;

  constructor(vertexCount: number) {
    this.vertexCount = vertexCount;
    this.metrics = new Float64Array(
      vertexCount * MAX_TC_PER_VERTEX * MATRIX_6X6_SIZE,
    );
    this.tcIndices = new Int32Array(vertexCount * MAX_TC_PER_VERTEX);
    this.tcIndices.fill(NULL_INDEX);
  }

  /**
   * Get base offset for vertex's metric slot
   */
  private getSlotOffset(vi: number, slot: number): number {
    return (vi * MAX_TC_PER_VERTEX + slot) * MATRIX_6X6_SIZE;
  }

  /**
   * Find or create slot for vertex-TC pair
   * Returns slot index (0 to MAX_TC_PER_VERTEX-1), or -1 if full
   */
  findOrCreateSlot(vi: number, tci: number): number {
    const base = vi * MAX_TC_PER_VERTEX;

    // Check existing slots
    for (let slot = 0; slot < MAX_TC_PER_VERTEX; slot++) {
      const existingTc = this.tcIndices[base + slot];
      if (existingTc === tci) {
        return slot; // Found existing
      }
      if (existingTc === NULL_INDEX) {
        // Use this empty slot
        this.tcIndices[base + slot] = tci;
        return slot;
      }
    }

    return NULL_INDEX; // All slots full
  }

  /**
   * Find slot for vertex-TC pair (returns -1 if not found)
   */
  findSlot(vi: number, tci: number): number {
    const base = vi * MAX_TC_PER_VERTEX;
    for (let slot = 0; slot < MAX_TC_PER_VERTEX; slot++) {
      if (this.tcIndices[base + slot] === tci) {
        return slot;
      }
    }
    return NULL_INDEX;
  }

  /**
   * Get metric matrix for vertex-TC pair
   * Returns offset into metrics array, or -1 if not found
   */
  getMetricOffset(vi: number, tci: number): number {
    const slot = this.findSlot(vi, tci);
    if (slot === NULL_INDEX) return NULL_INDEX;
    return this.getSlotOffset(vi, slot);
  }

  /**
   * Add matrix to vertex-TC metric (creates if doesn't exist)
   */
  addMetric(vi: number, tci: number, matrix: Float64Array): void {
    const slot = this.findOrCreateSlot(vi, tci);
    if (slot === NULL_INDEX) {
      throw new Error(
        `Vertex ${vi} exceeded MAX_TC_PER_VERTEX=${MAX_TC_PER_VERTEX}`,
      );
    }

    const offset = this.getSlotOffset(vi, slot);
    for (let i = 0; i < MATRIX_6X6_SIZE; i++) {
      this.metrics[offset + i] += matrix[i];
    }
  }

  /**
   * Set metric for vertex-TC pair (creates if doesn't exist)
   */
  setMetric(vi: number, tci: number, matrix: Float64Array): void {
    const slot = this.findOrCreateSlot(vi, tci);
    if (slot === NULL_INDEX) {
      throw new Error(
        `Vertex ${vi} exceeded MAX_TC_PER_VERTEX=${MAX_TC_PER_VERTEX}`,
      );
    }

    const offset = this.getSlotOffset(vi, slot);
    this.metrics.set(matrix.subarray(0, MATRIX_6X6_SIZE), offset);
  }

  /**
   * Copy metric from one vertex-TC to another (for collapse operations)
   */
  copyMetric(
    fromVi: number,
    fromTci: number,
    toVi: number,
    toTci: number,
  ): void {
    const fromOffset = this.getMetricOffset(fromVi, fromTci);
    if (fromOffset === NULL_INDEX) return;

    const toSlot = this.findOrCreateSlot(toVi, toTci);
    if (toSlot === NULL_INDEX) {
      throw new Error(
        `Vertex ${toVi} exceeded MAX_TC_PER_VERTEX=${MAX_TC_PER_VERTEX}`,
      );
    }

    const toOffset = this.getSlotOffset(toVi, toSlot);
    this.metrics.set(
      this.metrics.subarray(fromOffset, fromOffset + MATRIX_6X6_SIZE),
      toOffset,
    );
  }

  /**
   * Delete metric slot for vertex-TC pair
   */
  deleteMetric(vi: number, tci: number): void {
    const base = vi * MAX_TC_PER_VERTEX;
    for (let slot = 0; slot < MAX_TC_PER_VERTEX; slot++) {
      if (this.tcIndices[base + slot] === tci) {
        this.tcIndices[base + slot] = NULL_INDEX;
        // Zero out the matrix
        const offset = this.getSlotOffset(vi, slot);
        this.metrics.fill(0, offset, offset + MATRIX_6X6_SIZE);
        return;
      }
    }
  }

  /**
   * Delete all metrics for a vertex (for collapse operations)
   */
  deleteAllMetrics(vi: number): void {
    const base = vi * MAX_TC_PER_VERTEX;
    for (let slot = 0; slot < MAX_TC_PER_VERTEX; slot++) {
      this.tcIndices[base + slot] = NULL_INDEX;
    }
    const offset = this.getSlotOffset(vi, 0);
    this.metrics.fill(0, offset, offset + MAX_TC_PER_VERTEX * MATRIX_6X6_SIZE);
  }

  /**
   * Get all TC indices for a vertex (for iteration)
   */
  getVertexTCIndices(vi: number, out: Int32Array): number {
    const base = vi * MAX_TC_PER_VERTEX;
    let count = 0;
    for (let slot = 0; slot < MAX_TC_PER_VERTEX; slot++) {
      const tci = this.tcIndices[base + slot];
      if (tci !== NULL_INDEX) {
        out[count++] = tci;
      }
    }
    return count;
  }
}

// ============================================================================
// SEAM EDGE SET (FLAT TYPED ARRAYS)
// ============================================================================

/**
 * Seam edge set using a hash set backed by typed arrays.
 *
 * Uses open addressing with linear probing for fast lookup.
 * Edge keys are encoded as (min(v0,v1) << 20) | max(v0,v1) for vertices < 1M.
 */
export class OptimizedSeamEdgeSet {
  /** Hash table entries: edgeKey or -1 if empty */
  private table: BigInt64Array;

  /** Capacity (power of 2) */
  private capacity: number;

  /** Number of entries */
  private size: number;

  /** Load factor threshold for resize */
  private readonly loadFactor = 0.7;

  constructor(initialCapacity: number = 1024) {
    // Round up to power of 2
    this.capacity = 1;
    while (this.capacity < initialCapacity) {
      this.capacity *= 2;
    }
    this.table = new BigInt64Array(this.capacity);
    this.table.fill(BigInt(-1));
    this.size = 0;
  }

  /**
   * Encode edge as single key (v0, v1 must be < 2^31)
   */
  private encodeEdge(v0: number, v1: number): bigint {
    const min = v0 < v1 ? v0 : v1;
    const max = v0 < v1 ? v1 : v0;
    return (BigInt(min) << BigInt(32)) | BigInt(max);
  }

  /**
   * Decode edge key to vertices
   */
  private decodeEdge(key: bigint): [number, number] {
    const max = Number(key & BigInt(0xffffffff));
    const min = Number(key >> BigInt(32));
    return [min, max];
  }

  /**
   * Hash function
   */
  private hash(key: bigint): number {
    // FNV-1a style hash
    let h = key;
    h ^= h >> BigInt(33);
    h *= 0xff51afd7ed558ccdn;
    h ^= h >> BigInt(33);
    return Number(h & BigInt(this.capacity - 1));
  }

  /**
   * Add edge to set
   */
  add(v0: number, v1: number): void {
    if (this.size >= this.capacity * this.loadFactor) {
      this.resize();
    }

    const key = this.encodeEdge(v0, v1);
    let index = this.hash(key);

    while (this.table[index] !== BigInt(-1)) {
      if (this.table[index] === key) {
        return; // Already exists
      }
      index = (index + 1) & (this.capacity - 1);
    }

    this.table[index] = key;
    this.size++;
  }

  /**
   * Check if edge is in set
   */
  has(v0: number, v1: number): boolean {
    const key = this.encodeEdge(v0, v1);
    let index = this.hash(key);

    while (this.table[index] !== BigInt(-1)) {
      if (this.table[index] === key) {
        return true;
      }
      index = (index + 1) & (this.capacity - 1);
    }

    return false;
  }

  /**
   * Remove edge from set
   */
  delete(v0: number, v1: number): boolean {
    const key = this.encodeEdge(v0, v1);
    let index = this.hash(key);

    while (this.table[index] !== BigInt(-1)) {
      if (this.table[index] === key) {
        // Mark as deleted (use -2 as tombstone)
        this.table[index] = BigInt(-2);
        this.size--;
        return true;
      }
      index = (index + 1) & (this.capacity - 1);
    }

    return false;
  }

  /**
   * Get number of seam edges
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Resize hash table
   */
  private resize(): void {
    const oldTable = this.table;
    const oldCapacity = this.capacity;

    this.capacity *= 2;
    this.table = new BigInt64Array(this.capacity);
    this.table.fill(BigInt(-1));
    this.size = 0;

    for (let i = 0; i < oldCapacity; i++) {
      const key = oldTable[i];
      if (key !== BigInt(-1) && key !== BigInt(-2)) {
        const [v0, v1] = this.decodeEdge(key);
        this.add(v0, v1);
      }
    }
  }
}

// ============================================================================
// SEAM VERTEX SET (FOR CHECKING IF VERTEX IS ON ANY SEAM)
// ============================================================================

/**
 * Tracks which vertices are on seams and their seam neighbors.
 */
export class OptimizedSeamVertexMap {
  /** For each vertex, stores up to 4 seam neighbor vertices */
  private neighbors: Int32Array;

  /** Number of seam neighbors per vertex */
  private neighborCounts: Uint8Array;

  /** Maximum neighbors per vertex */
  private readonly maxNeighbors = 8;

  /** Vertex count */
  private vertexCount: number;

  constructor(vertexCount: number) {
    this.vertexCount = vertexCount;
    this.neighbors = new Int32Array(vertexCount * this.maxNeighbors);
    this.neighbors.fill(NULL_INDEX);
    this.neighborCounts = new Uint8Array(vertexCount);
  }

  /**
   * Add a seam edge between two vertices
   */
  addSeamEdge(v0: number, v1: number): void {
    this.addNeighbor(v0, v1);
    this.addNeighbor(v1, v0);
  }

  /**
   * Add neighbor to vertex's seam neighbor list
   */
  private addNeighbor(vi: number, neighbor: number): void {
    const base = vi * this.maxNeighbors;
    const count = this.neighborCounts[vi];

    // Check if already exists
    for (let i = 0; i < count; i++) {
      if (this.neighbors[base + i] === neighbor) {
        return;
      }
    }

    // Add if space available
    if (count < this.maxNeighbors) {
      this.neighbors[base + count] = neighbor;
      this.neighborCounts[vi] = count + 1;
    }
  }

  /**
   * Check if vertex is on any seam
   */
  isOnSeam(vi: number): boolean {
    return this.neighborCounts[vi] > 0;
  }

  /**
   * Get seam neighbor count for vertex
   */
  getSeamNeighborCount(vi: number): number {
    return this.neighborCounts[vi];
  }

  /**
   * Get seam neighbors for vertex
   */
  getSeamNeighbors(vi: number, out: Int32Array): number {
    const base = vi * this.maxNeighbors;
    const count = this.neighborCounts[vi];
    for (let i = 0; i < count; i++) {
      out[i] = this.neighbors[base + i];
    }
    return count;
  }

  /**
   * Remove seam edge between vertices
   */
  removeSeamEdge(v0: number, v1: number): void {
    this.removeNeighbor(v0, v1);
    this.removeNeighbor(v1, v0);
  }

  /**
   * Remove neighbor from vertex's list
   */
  private removeNeighbor(vi: number, neighbor: number): void {
    const base = vi * this.maxNeighbors;
    const count = this.neighborCounts[vi];

    for (let i = 0; i < count; i++) {
      if (this.neighbors[base + i] === neighbor) {
        // Shift remaining neighbors
        for (let j = i; j < count - 1; j++) {
          this.neighbors[base + j] = this.neighbors[base + j + 1];
        }
        this.neighbors[base + count - 1] = NULL_INDEX;
        this.neighborCounts[vi] = count - 1;
        return;
      }
    }
  }

  /**
   * Rename vertex (for collapse operations)
   */
  renameVertex(oldVi: number, newVi: number): void {
    // Update all neighbors of oldVi to point to newVi
    const base = oldVi * this.maxNeighbors;
    const count = this.neighborCounts[oldVi];

    for (let i = 0; i < count; i++) {
      const neighbor = this.neighbors[base + i];
      if (neighbor !== NULL_INDEX && neighbor !== newVi) {
        // In neighbor's list, replace oldVi with newVi
        const nBase = neighbor * this.maxNeighbors;
        const nCount = this.neighborCounts[neighbor];
        for (let j = 0; j < nCount; j++) {
          if (this.neighbors[nBase + j] === oldVi) {
            this.neighbors[nBase + j] = newVi;
            break;
          }
        }

        // Add neighbor to newVi's list
        this.addNeighbor(newVi, neighbor);
      }
    }

    // Clear oldVi
    this.neighborCounts[oldVi] = 0;
    for (let i = 0; i < this.maxNeighbors; i++) {
      this.neighbors[base + i] = NULL_INDEX;
    }
  }
}

// ============================================================================
// PLACEMENT INFO (REUSABLE BUFFER)
// ============================================================================

/**
 * Pre-allocated placement info to avoid allocations in hot loop
 */
export class PlacementBuffer {
  /** New 3D position */
  position: Float32Array;

  /** New texture coordinates (up to 2 for seam edges) */
  tcs: Float32Array;

  /** Number of texture coordinates */
  tcCount: number;

  /** Combined metrics (up to 2 for seam edges) */
  metrics: Float64Array;

  /** Number of metrics */
  metricCount: number;

  constructor() {
    this.position = new Float32Array(3);
    this.tcs = new Float32Array(4); // 2 TCs × 2 components
    this.tcCount = 0;
    this.metrics = new Float64Array(MATRIX_6X6_SIZE * 2);
    this.metricCount = 0;
  }

  /**
   * Reset for reuse
   */
  reset(): void {
    this.tcCount = 0;
    this.metricCount = 0;
  }

  /**
   * Set single TC result
   */
  setTC(index: number, u: number, v: number): void {
    this.tcs[index * 2] = u;
    this.tcs[index * 2 + 1] = v;
    this.tcCount = Math.max(this.tcCount, index + 1);
  }

  /**
   * Get TC
   */
  getTC(index: number): [number, number] {
    return [this.tcs[index * 2], this.tcs[index * 2 + 1]];
  }
}

// ============================================================================
// DECIMATION OPTIONS
// ============================================================================

export interface OptimizedDecimationOptions {
  /** Target number of vertices (takes precedence over targetPercent) */
  targetVertices?: number;

  /** Target percentage of vertices to keep (0-100) */
  targetPercent?: number;

  /** Strictness level: 0=fast, 1=UV shape, 2=seam-aware (default) */
  strictness?: 0 | 1 | 2;
}

export type StopReason =
  | "target_reached"
  | "empty_queue"
  | "all_infinite_cost"
  | "no_progress";

export interface OptimizedDecimationResult {
  /** Simplified mesh */
  mesh: OptimizedMeshData;

  /** Original vertex count */
  originalVertices: number;

  /** Final vertex count */
  finalVertices: number;

  /** Original face count */
  originalFaces: number;

  /** Final face count */
  finalFaces: number;

  /** Number of edge collapses */
  collapses: number;

  /** Why decimation stopped */
  stopReason: StopReason;

  /** Processing time in milliseconds */
  processingTimeMs: number;
}
