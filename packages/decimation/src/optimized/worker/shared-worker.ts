/**
 * SharedArrayBuffer-based Worker Pool
 *
 * Uses SharedArrayBuffer for true zero-copy parallel processing.
 * Workers share memory directly without transfer overhead.
 */

import { MATRIX_6X6_SIZE, MAX_TC_PER_VERTEX } from "../types.js";

// Message types for shared memory workers
export interface SharedWorkerInitMessage {
  type: "init";
  data: {
    positionsBuffer: SharedArrayBuffer;
    uvsBuffer: SharedArrayBuffer;
    faceVerticesBuffer: SharedArrayBuffer;
    faceTexCoordsBuffer: SharedArrayBuffer;
    metricsBuffer: SharedArrayBuffer;
    costsBuffer: SharedArrayBuffer;
    edgesBuffer: SharedArrayBuffer;
    vertexCount: number;
    faceCount: number;
    edgeCount: number;
  };
}

export interface SharedWorkerComputeMessage {
  type: "compute";
  data: {
    edgeStart: number;
    edgeEnd: number;
    strictness: 0 | 1 | 2;
  };
}

export interface SharedWorkerDoneMessage {
  type: "done";
  data: { edgesComputed: number };
}

export type SharedWorkerMessage =
  | SharedWorkerInitMessage
  | SharedWorkerComputeMessage;
export type SharedWorkerResponse = SharedWorkerDoneMessage;

// Check if SharedArrayBuffer is available
export function sharedArrayBufferAvailable(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof Atomics !== "undefined" &&
      new SharedArrayBuffer(1).byteLength === 1
    );
  } catch {
    return false;
  }
}

// Inline worker code for shared memory processing
const SHARED_WORKER_CODE = `
const NULL = -1;
const MATRIX_SIZE = 36;
const MAX_TC = 8;
const INF = Infinity;
const EPS = 1e-8;

let positions, uvs, faceVertices, faceTexCoords, metrics, costs, edges;
let vertexCount, faceCount, edgeCount;

// Workspace arrays (per-worker, not shared)
const M = new Float64Array(MATRIX_SIZE);
const V6 = new Float64Array(6);

self.onmessage = function(e) {
  const msg = e.data;
  
  if (msg.type === 'init') {
    const d = msg.data;
    positions = new Float32Array(d.positionsBuffer);
    uvs = new Float32Array(d.uvsBuffer);
    faceVertices = new Uint32Array(d.faceVerticesBuffer);
    faceTexCoords = new Uint32Array(d.faceTexCoordsBuffer);
    metrics = new Float64Array(d.metricsBuffer);
    costs = new Float64Array(d.costsBuffer);
    edges = new Uint32Array(d.edgesBuffer);
    vertexCount = d.vertexCount;
    faceCount = d.faceCount;
    edgeCount = d.edgeCount;
    return;
  }
  
  if (msg.type === 'compute') {
    const { edgeStart, edgeEnd, strictness } = msg.data;
    let computed = 0;
    
    for (let ei = edgeStart; ei < edgeEnd; ei++) {
      const v0 = edges[ei * 2], v1 = edges[ei * 2 + 1];
      if (v0 === NULL) { costs[ei] = INF; continue; }
      
      // Simplified cost computation using shared data
      const cost = computeEdgeCost(ei, v0, v1);
      costs[ei] = cost;
      computed++;
    }
    
    self.postMessage({ type: 'done', data: { edgesComputed: computed } });
  }
};

function getMetricOffset(vi, tci) {
  const base = vi * MAX_TC;
  // Linear search for TC slot (metrics stored as tcIndices then matrices)
  const tcBase = vertexCount * MAX_TC * MATRIX_SIZE;
  for (let s = 0; s < MAX_TC; s++) {
    // TC indices stored after all metrics
    // This is a simplified layout - actual impl would need proper indexing
    if (s === 0) return vi * MAX_TC * MATRIX_SIZE; // Fallback to first slot
  }
  return NULL;
}

function computeEdgeCost(ei, v0, v1) {
  // Find face containing this edge to get TC indices
  let tci0 = 0, tci1 = 0;
  for (let fi = 0; fi < faceCount; fi++) {
    const b = fi * 3;
    if (faceVertices[b] === NULL) continue;
    
    for (let c = 0; c < 3; c++) {
      const cv = faceVertices[b + c];
      const nv = faceVertices[b + (c + 1) % 3];
      if ((cv === v0 && nv === v1) || (cv === v1 && nv === v0)) {
        tci0 = faceTexCoords[b + c];
        tci1 = faceTexCoords[b + (c + 1) % 3];
        break;
      }
    }
    if (tci0 !== 0 || tci1 !== 0) break;
  }
  
  // Get combined metric
  M.fill(0);
  const o0 = v0 * MAX_TC * MATRIX_SIZE;
  const o1 = v1 * MAX_TC * MATRIX_SIZE;
  for (let i = 0; i < MATRIX_SIZE; i++) {
    M[i] = metrics[o0 + i] + metrics[o1 + i];
  }
  
  // Midpoint
  const px = (positions[v0 * 3] + positions[v1 * 3]) * 0.5;
  const py = (positions[v0 * 3 + 1] + positions[v1 * 3 + 1]) * 0.5;
  const pz = (positions[v0 * 3 + 2] + positions[v1 * 3 + 2]) * 0.5;
  const tu = (uvs[tci0 * 2] + uvs[tci1 * 2]) * 0.5;
  const tv = (uvs[tci0 * 2 + 1] + uvs[tci1 * 2 + 1]) * 0.5;
  
  V6[0] = px; V6[1] = py; V6[2] = pz; V6[3] = tu; V6[4] = tv; V6[5] = 1;
  
  // Quadratic form (unrolled)
  const v0_ = V6[0], v1_ = V6[1], v2_ = V6[2], v3_ = V6[3], v4_ = V6[4], v5_ = V6[5];
  let r = v0_ * (M[0] * v0_ + M[1] * v1_ + M[2] * v2_ + M[3] * v3_ + M[4] * v4_ + M[5] * v5_);
  r += v1_ * (M[6] * v0_ + M[7] * v1_ + M[8] * v2_ + M[9] * v3_ + M[10] * v4_ + M[11] * v5_);
  r += v2_ * (M[12] * v0_ + M[13] * v1_ + M[14] * v2_ + M[15] * v3_ + M[16] * v4_ + M[17] * v5_);
  r += v3_ * (M[18] * v0_ + M[19] * v1_ + M[20] * v2_ + M[21] * v3_ + M[22] * v4_ + M[23] * v5_);
  r += v4_ * (M[24] * v0_ + M[25] * v1_ + M[26] * v2_ + M[27] * v3_ + M[28] * v4_ + M[29] * v5_);
  r += v5_ * (M[30] * v0_ + M[31] * v1_ + M[32] * v2_ + M[33] * v3_ + M[34] * v4_ + M[35] * v5_);
  
  return r;
}
`;

let sharedWorkerBlobUrl: string | null = null;

function getSharedWorkerUrl(): string {
  if (!sharedWorkerBlobUrl) {
    const blob = new Blob([SHARED_WORKER_CODE], {
      type: "application/javascript",
    });
    sharedWorkerBlobUrl = URL.createObjectURL(blob);
  }
  return sharedWorkerBlobUrl;
}

/**
 * Worker pool using SharedArrayBuffer for zero-copy parallelism
 */
export class SharedMemoryWorkerPool {
  private workers: Worker[] = [];
  private numWorkers: number;
  private initialized = false;

  // Shared buffers
  private positionsBuffer: SharedArrayBuffer | null = null;
  private uvsBuffer: SharedArrayBuffer | null = null;
  private faceVerticesBuffer: SharedArrayBuffer | null = null;
  private faceTexCoordsBuffer: SharedArrayBuffer | null = null;
  private metricsBuffer: SharedArrayBuffer | null = null;
  private costsBuffer: SharedArrayBuffer | null = null;
  private edgesBuffer: SharedArrayBuffer | null = null;

  constructor(numWorkers?: number) {
    this.numWorkers =
      numWorkers ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1);

    if (!sharedArrayBufferAvailable()) {
      throw new Error(
        "SharedArrayBuffer not available - check COOP/COEP headers",
      );
    }

    const url = getSharedWorkerUrl();
    for (let i = 0; i < this.numWorkers; i++) {
      this.workers.push(new Worker(url));
    }
  }

  /**
   * Initialize shared memory with mesh data
   */
  initialize(
    positions: Float32Array,
    uvs: Float32Array,
    faceVertices: Uint32Array,
    faceTexCoords: Uint32Array,
    edges: Uint32Array,
    metricsSize: number,
  ): { costs: Float64Array; metrics: Float64Array } {
    const vertexCount = positions.length / 3;
    const faceCount = faceVertices.length / 3;
    const edgeCount = edges.length / 2;

    // Allocate shared buffers
    this.positionsBuffer = new SharedArrayBuffer(positions.byteLength);
    this.uvsBuffer = new SharedArrayBuffer(uvs.byteLength);
    this.faceVerticesBuffer = new SharedArrayBuffer(faceVertices.byteLength);
    this.faceTexCoordsBuffer = new SharedArrayBuffer(faceTexCoords.byteLength);
    this.metricsBuffer = new SharedArrayBuffer(
      metricsSize * Float64Array.BYTES_PER_ELEMENT,
    );
    this.costsBuffer = new SharedArrayBuffer(
      edgeCount * Float64Array.BYTES_PER_ELEMENT,
    );
    this.edgesBuffer = new SharedArrayBuffer(edges.byteLength);

    // Copy data to shared buffers
    new Float32Array(this.positionsBuffer).set(positions);
    new Float32Array(this.uvsBuffer).set(uvs);
    new Uint32Array(this.faceVerticesBuffer).set(faceVertices);
    new Uint32Array(this.faceTexCoordsBuffer).set(faceTexCoords);
    new Uint32Array(this.edgesBuffer).set(edges);

    // Initialize all workers with shared memory
    const initMsg: SharedWorkerInitMessage = {
      type: "init",
      data: {
        positionsBuffer: this.positionsBuffer,
        uvsBuffer: this.uvsBuffer,
        faceVerticesBuffer: this.faceVerticesBuffer,
        faceTexCoordsBuffer: this.faceTexCoordsBuffer,
        metricsBuffer: this.metricsBuffer,
        costsBuffer: this.costsBuffer,
        edgesBuffer: this.edgesBuffer,
        vertexCount,
        faceCount,
        edgeCount,
      },
    };

    for (const worker of this.workers) {
      worker.postMessage(initMsg);
    }

    this.initialized = true;

    return {
      costs: new Float64Array(this.costsBuffer),
      metrics: new Float64Array(this.metricsBuffer),
    };
  }

  /**
   * Compute costs in parallel using shared memory
   */
  async computeCostsParallel(
    edgeCount: number,
    strictness: 0 | 1 | 2,
  ): Promise<void> {
    if (!this.initialized) throw new Error("Pool not initialized");

    const edgesPerWorker = Math.ceil(edgeCount / this.numWorkers);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const edgeStart = i * edgesPerWorker;
      const edgeEnd = Math.min(edgeStart + edgesPerWorker, edgeCount);

      if (edgeStart >= edgeCount) break;

      promises.push(
        new Promise((resolve) => {
          const worker = this.workers[i];
          const handler = (e: MessageEvent<SharedWorkerResponse>) => {
            if (e.data.type === "done") {
              worker.removeEventListener("message", handler);
              resolve();
            }
          };
          worker.addEventListener("message", handler);

          const msg: SharedWorkerComputeMessage = {
            type: "compute",
            data: { edgeStart, edgeEnd, strictness },
          };
          worker.postMessage(msg);
        }),
      );
    }

    await Promise.all(promises);
  }

  /**
   * Get shared costs array (zero-copy access)
   */
  getCosts(): Float64Array | null {
    return this.costsBuffer ? new Float64Array(this.costsBuffer) : null;
  }

  /**
   * Get shared metrics array (zero-copy access)
   */
  getMetrics(): Float64Array | null {
    return this.metricsBuffer ? new Float64Array(this.metricsBuffer) : null;
  }

  dispose(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.initialized = false;
  }
}

/**
 * Decimate using shared memory workers
 */
export async function decimateSharedMemory(
  positions: Float32Array,
  uvs: Float32Array,
  faceVertices: Uint32Array,
  faceTexCoords: Uint32Array,
  options: {
    targetVertices?: number;
    targetPercent?: number;
    strictness?: 0 | 1 | 2;
    numWorkers?: number;
  } = {},
): Promise<{
  positions: Float32Array;
  uvs: Float32Array;
  faceVertices: Uint32Array;
  faceTexCoords: Uint32Array;
  originalVertices: number;
  finalVertices: number;
}> {
  if (!sharedArrayBufferAvailable()) {
    throw new Error("SharedArrayBuffer not available");
  }

  const vertexCount = positions.length / 3;
  const strictness = options.strictness ?? 2;

  let _targetVertices: number;
  if (options.targetVertices !== undefined) {
    _targetVertices = options.targetVertices;
  } else if (options.targetPercent !== undefined) {
    _targetVertices = Math.floor(vertexCount * (options.targetPercent / 100));
  } else {
    _targetVertices = Math.floor(vertexCount * 0.5);
  }
  _targetVertices = Math.max(4, _targetVertices);

  // Build edges (simplified - just unique vertex pairs)
  const edgeSet = new Map<string, [number, number]>();
  const faceCount = faceVertices.length / 3;

  for (let fi = 0; fi < faceCount; fi++) {
    const b = fi * 3;
    for (let c = 0; c < 3; c++) {
      const v0 = faceVertices[b + c];
      const v1 = faceVertices[b + ((c + 1) % 3)];
      const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;
      if (!edgeSet.has(key)) {
        edgeSet.set(key, v0 < v1 ? [v0, v1] : [v1, v0]);
      }
    }
  }

  const edges = new Uint32Array(edgeSet.size * 2);
  let ei = 0;
  for (const [v0, v1] of edgeSet.values()) {
    edges[ei * 2] = v0;
    edges[ei * 2 + 1] = v1;
    ei++;
  }
  const edgeCount = edgeSet.size;

  // Initialize worker pool
  const pool = new SharedMemoryWorkerPool(options.numWorkers);
  const metricsSize = vertexCount * MAX_TC_PER_VERTEX * MATRIX_6X6_SIZE;

  pool.initialize(
    positions,
    uvs,
    faceVertices,
    faceTexCoords,
    edges,
    metricsSize,
  );

  // Compute initial costs in parallel
  await pool.computeCostsParallel(edgeCount, strictness);

  // Get results (costs are written to shared buffer)
  pool.getCosts();

  // For now, just return original (full implementation would do the collapse loop)
  // The key optimization is the parallel cost computation
  pool.dispose();

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    faceVertices: new Uint32Array(faceVertices),
    faceTexCoords: new Uint32Array(faceTexCoords),
    originalVertices: vertexCount,
    finalVertices: vertexCount, // Would be reduced after collapse loop
  };
}
