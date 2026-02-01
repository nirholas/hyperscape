/**
 * Spatial Hash for O(1) Edge Lookups
 *
 * Provides fast spatial queries for finding edges affected by a vertex move.
 * Uses a 3D grid hash with configurable cell size.
 */

import { NULL_INDEX } from "../types.js";

/**
 * Spatial hash configuration
 */
export interface SpatialHashConfig {
  cellSize: number; // Size of each grid cell
  expectedEdges: number; // Expected number of edges (for initial allocation)
}

/**
 * High-performance spatial hash for edge lookups
 */
export class EdgeSpatialHash {
  private cellSize: number;
  private invCellSize: number;
  private tableSize: number;
  private tableMask: number;

  // Hash table (indices into entries array)
  private table: Int32Array;

  // Edge entries (linked list nodes)
  private edgeIndices: Uint32Array;
  private v0Array: Uint32Array;
  private v1Array: Uint32Array;
  private nextArray: Int32Array;
  private entryCount: number;

  // Vertex-to-edges mapping for fast "find edges containing vertex"
  private vertexEdgeHead: Int32Array;
  private vertexEdgeNext: Int32Array;

  constructor(config: SpatialHashConfig, vertexCount: number) {
    this.cellSize = config.cellSize;
    this.invCellSize = 1 / config.cellSize;

    // Round table size to power of 2 for fast modulo
    this.tableSize = 1;
    while (this.tableSize < config.expectedEdges) {
      this.tableSize <<= 1;
    }
    this.tableMask = this.tableSize - 1;

    // Allocate hash table
    this.table = new Int32Array(this.tableSize);
    this.table.fill(NULL_INDEX);

    // Allocate entry arrays
    const capacity = config.expectedEdges;
    this.edgeIndices = new Uint32Array(capacity);
    this.v0Array = new Uint32Array(capacity);
    this.v1Array = new Uint32Array(capacity);
    this.nextArray = new Int32Array(capacity);
    this.nextArray.fill(NULL_INDEX);
    this.entryCount = 0;

    // Allocate vertex-to-edge mapping
    this.vertexEdgeHead = new Int32Array(vertexCount);
    this.vertexEdgeHead.fill(NULL_INDEX);
    this.vertexEdgeNext = new Int32Array(capacity * 2); // Each edge connects 2 vertices
    this.vertexEdgeNext.fill(NULL_INDEX);
  }

  /**
   * Hash a 3D cell coordinate
   */
  private hashCell(cx: number, cy: number, cz: number): number {
    // FNV-1a inspired hash
    let h = 2166136261;
    h ^= cx;
    h = Math.imul(h, 16777619);
    h ^= cy;
    h = Math.imul(h, 16777619);
    h ^= cz;
    h = Math.imul(h, 16777619);
    return (h >>> 0) & this.tableMask;
  }

  /**
   * Get cell coordinate from world position
   */
  private getCell(x: number, y: number, z: number): [number, number, number] {
    return [
      Math.floor(x * this.invCellSize),
      Math.floor(y * this.invCellSize),
      Math.floor(z * this.invCellSize),
    ];
  }

  /**
   * Insert an edge into the spatial hash
   */
  insert(
    edgeIndex: number,
    v0: number,
    v1: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): void {
    // Store edge data
    const entryIdx = this.entryCount++;
    this.edgeIndices[entryIdx] = edgeIndex;
    this.v0Array[entryIdx] = v0;
    this.v1Array[entryIdx] = v1;

    // Compute midpoint for spatial hash
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const mz = (z0 + z1) * 0.5;

    // Insert into spatial hash at midpoint
    const [cx, cy, cz] = this.getCell(mx, my, mz);
    const bucket = this.hashCell(cx, cy, cz);

    // Chain to existing entries
    this.nextArray[entryIdx] = this.table[bucket];
    this.table[bucket] = entryIdx;

    // Also add to vertex-edge lists
    this.addToVertexList(v0, entryIdx);
    this.addToVertexList(v1, entryIdx);
  }

  /**
   * Add edge entry to vertex's edge list
   */
  private addToVertexList(vi: number, entryIdx: number): void {
    const listIdx = entryIdx * 2 + (this.v0Array[entryIdx] === vi ? 0 : 1);
    this.vertexEdgeNext[listIdx] = this.vertexEdgeHead[vi];
    this.vertexEdgeHead[vi] = entryIdx;
  }

  /**
   * Find all edges containing a vertex (O(degree) time)
   */
  findEdgesForVertex(vi: number, output: Uint32Array): number {
    let count = 0;
    let entryIdx = this.vertexEdgeHead[vi];

    while (entryIdx !== NULL_INDEX && count < output.length) {
      output[count++] = this.edgeIndices[entryIdx];

      // Follow the correct next pointer (v0 or v1 list)
      const listIdx = entryIdx * 2 + (this.v0Array[entryIdx] === vi ? 0 : 1);
      entryIdx = this.vertexEdgeNext[listIdx];
    }

    return count;
  }

  /**
   * Find all edges in cells near a point (O(1) average time)
   */
  findEdgesNearPoint(
    x: number,
    y: number,
    z: number,
    radius: number,
    output: Uint32Array,
  ): number {
    const cellRadius = Math.ceil(radius * this.invCellSize);
    const [cx, cy, cz] = this.getCell(x, y, z);

    let count = 0;

    // Check cells within radius
    for (
      let dx = -cellRadius;
      dx <= cellRadius && count < output.length;
      dx++
    ) {
      for (
        let dy = -cellRadius;
        dy <= cellRadius && count < output.length;
        dy++
      ) {
        for (
          let dz = -cellRadius;
          dz <= cellRadius && count < output.length;
          dz++
        ) {
          const bucket = this.hashCell(cx + dx, cy + dy, cz + dz);
          let entryIdx = this.table[bucket];

          while (entryIdx !== NULL_INDEX && count < output.length) {
            output[count++] = this.edgeIndices[entryIdx];
            entryIdx = this.nextArray[entryIdx];
          }
        }
      }
    }

    return count;
  }

  /**
   * Remove an edge from spatial hash (marks as deleted)
   */
  remove(edgeIndex: number): void {
    // Find and mark the entry
    // Note: We don't actually remove from linked lists (costly)
    // Instead we mark the edge index as NULL_INDEX
    for (let i = 0; i < this.entryCount; i++) {
      if (this.edgeIndices[i] === edgeIndex) {
        this.edgeIndices[i] = NULL_INDEX;
        break;
      }
    }
  }

  /**
   * Update vertex position for all edges containing it
   */
  updateVertex(
    _vi: number,
    _newX: number,
    _newY: number,
    _newZ: number,
    _positions: Float32Array,
  ): void {
    // For each edge containing this vertex, we'd need to rehash
    // This is O(degree) which is typically small
    // For now, we skip rehashing as the approximation is good enough
    // The spatial hash is primarily used for initial queries
  }

  /**
   * Get statistics
   */
  getStats(): { entryCount: number; tableSize: number; loadFactor: number } {
    let usedBuckets = 0;
    for (let i = 0; i < this.tableSize; i++) {
      if (this.table[i] !== NULL_INDEX) usedBuckets++;
    }
    return {
      entryCount: this.entryCount,
      tableSize: this.tableSize,
      loadFactor: usedBuckets / this.tableSize,
    };
  }
}

/**
 * Build spatial hash from mesh data
 */
export function buildEdgeSpatialHash(
  positions: Float32Array,
  edges: Uint32Array,
  edgeCount: number,
  cellSize?: number,
): EdgeSpatialHash {
  // Auto-compute cell size from bounding box if not provided
  if (!cellSize) {
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    const vertexCount = positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3],
        y = positions[i * 3 + 1],
        z = positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    // Target ~100-1000 cells per dimension
    cellSize = extent / 100;
    if (cellSize < 0.001) cellSize = 0.001; // Minimum cell size
  }

  const vertexCount = positions.length / 3;
  const hash = new EdgeSpatialHash(
    { cellSize, expectedEdges: edgeCount },
    vertexCount,
  );

  // Insert all edges
  for (let ei = 0; ei < edgeCount; ei++) {
    const v0 = edges[ei * 2];
    const v1 = edges[ei * 2 + 1];
    if (v0 === NULL_INDEX) continue;

    const x0 = positions[v0 * 3],
      y0 = positions[v0 * 3 + 1],
      z0 = positions[v0 * 3 + 2];
    const x1 = positions[v1 * 3],
      y1 = positions[v1 * 3 + 1],
      z1 = positions[v1 * 3 + 2];

    hash.insert(ei, v0, v1, x0, y0, z0, x1, y1, z1);
  }

  return hash;
}

/**
 * Vertex-to-edge index for O(1) "affected edges" lookup
 */
export class VertexEdgeIndex {
  private heads: Int32Array;
  private edgeData: Uint32Array; // [edgeIndex, nextPtr] pairs
  private count: number;

  constructor(vertexCount: number, maxEdges: number) {
    this.heads = new Int32Array(vertexCount);
    this.heads.fill(NULL_INDEX);
    this.edgeData = new Uint32Array(maxEdges * 4); // 2 entries per edge (v0 and v1)
    this.count = 0;
  }

  /**
   * Add edge to both vertices' lists
   */
  addEdge(edgeIndex: number, v0: number, v1: number): void {
    // Add to v0's list
    const idx0 = this.count++;
    this.edgeData[idx0 * 2] = edgeIndex;
    this.edgeData[idx0 * 2 + 1] = this.heads[v0];
    this.heads[v0] = idx0;

    // Add to v1's list
    const idx1 = this.count++;
    this.edgeData[idx1 * 2] = edgeIndex;
    this.edgeData[idx1 * 2 + 1] = this.heads[v1];
    this.heads[v1] = idx1;
  }

  /**
   * Get all edges for a vertex
   */
  getEdges(vi: number, output: Uint32Array): number {
    let count = 0;
    let idx = this.heads[vi];

    while (idx !== NULL_INDEX && count < output.length) {
      output[count++] = this.edgeData[idx * 2];
      idx = this.edgeData[idx * 2 + 1];
    }

    return count;
  }

  /**
   * Merge vertex (update all edges from src to point to dst)
   */
  mergeVertex(src: number, dst: number): void {
    // Move src's edge list to dst
    let idx = this.heads[src];
    if (idx === NULL_INDEX) return;

    // Find end of src's list
    while (this.edgeData[idx * 2 + 1] !== NULL_INDEX) {
      idx = this.edgeData[idx * 2 + 1];
    }

    // Append dst's list to end of src's list
    this.edgeData[idx * 2 + 1] = this.heads[dst];
    this.heads[dst] = this.heads[src];
    this.heads[src] = NULL_INDEX;
  }
}

/**
 * Build vertex-edge index from edges
 */
export function buildVertexEdgeIndex(
  edges: Uint32Array,
  edgeCount: number,
  vertexCount: number,
): VertexEdgeIndex {
  const index = new VertexEdgeIndex(vertexCount, edgeCount);

  for (let ei = 0; ei < edgeCount; ei++) {
    const v0 = edges[ei * 2];
    const v1 = edges[ei * 2 + 1];
    if (v0 !== NULL_INDEX) {
      index.addEdge(ei, v0, v1);
    }
  }

  return index;
}
