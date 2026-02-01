/**
 * Off-Thread Mesh Decimation
 *
 * Runs the ENTIRE decimation algorithm in a Web Worker.
 * Main thread stays completely free - zero blocking.
 *
 * This is the recommended API for real-time applications.
 */

import { OptimizedMeshData, OptimizedDecimationResult } from "./types.js";
import type { StopReason } from "./types.js";
import {
  getFullWorkerUrl,
  type FullWorkerStartMessage,
  type FullWorkerResponse,
} from "./worker/full-worker.js";

// ============================================================================
// OPTIONS
// ============================================================================

export interface OffThreadDecimationOptions {
  /** Target number of vertices */
  targetVertices?: number;
  /** Target percentage of vertices to keep */
  targetPercent?: number;
  /** Strictness level: 0=fast, 1=UV shape, 2=seam-aware */
  strictness?: 0 | 1 | 2;
  /** Progress callback - called periodically with current state */
  onProgress?: (progress: DecimationProgress) => void;
  /** Abort signal to cancel the operation */
  signal?: AbortSignal;
}

export interface DecimationProgress {
  currentVertices: number;
  collapses: number;
  percentComplete: number;
}

// ============================================================================
// OFFTHREAD DECIMATION
// ============================================================================

/**
 * Decimate mesh completely off the main thread.
 *
 * The entire decimation algorithm runs in a Web Worker.
 * Main thread receives only progress updates and final result.
 *
 * @example
 * ```typescript
 * // Basic usage - completely non-blocking
 * const result = await decimateOffThread(mesh, { targetPercent: 50 });
 *
 * // With progress reporting
 * const result = await decimateOffThread(mesh, {
 *   targetPercent: 50,
 *   onProgress: (p) => console.log(`${p.percentComplete}% complete`)
 * });
 *
 * // With cancellation
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 5000); // Cancel after 5s
 * const result = await decimateOffThread(mesh, {
 *   targetPercent: 50,
 *   signal: controller.signal
 * });
 * ```
 */
export async function decimateOffThread(
  mesh: OptimizedMeshData,
  options: OffThreadDecimationOptions = {},
): Promise<OptimizedDecimationResult> {
  const {
    targetVertices,
    targetPercent,
    strictness = 2,
    onProgress,
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    // Check for cancellation before starting
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const worker = new Worker(getFullWorkerUrl());

    // Handle abort
    const abortHandler = () => {
      worker.terminate();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abortHandler);

    worker.onmessage = (event: MessageEvent<FullWorkerResponse>) => {
      const msg = event.data;

      if (msg.type === "progress" && onProgress) {
        onProgress(msg.data);
        return;
      }

      if (msg.type === "result") {
        signal?.removeEventListener("abort", abortHandler);
        worker.terminate();

        const result: OptimizedDecimationResult = {
          mesh: new OptimizedMeshData(
            msg.data.positions,
            msg.data.uvs,
            msg.data.faceVertices,
            msg.data.faceTexCoords,
          ),
          originalVertices: msg.data.originalVertices,
          finalVertices: msg.data.finalVertices,
          originalFaces: msg.data.originalFaces,
          finalFaces: msg.data.finalFaces,
          collapses: msg.data.collapses,
          stopReason: msg.data.stopReason as StopReason,
          processingTimeMs: msg.data.processingTimeMs,
        };

        resolve(result);
        return;
      }

      if (msg.type === "error") {
        signal?.removeEventListener("abort", abortHandler);
        worker.terminate();
        reject(new Error(msg.data.message));
        return;
      }
    };

    worker.onerror = (err) => {
      signal?.removeEventListener("abort", abortHandler);
      worker.terminate();
      reject(new Error(err.message || "Worker error"));
    };

    // Start decimation
    const startMsg: FullWorkerStartMessage = {
      type: "start",
      data: {
        positions: new Float32Array(mesh.positions),
        uvs: new Float32Array(mesh.uvs),
        faceVertices: new Uint32Array(mesh.faceVertices),
        faceTexCoords: new Uint32Array(mesh.faceTexCoords),
        targetVertices,
        targetPercent,
        strictness,
      },
    };

    // Transfer arrays for zero-copy
    worker.postMessage(startMsg, [
      startMsg.data.positions.buffer,
      startMsg.data.uvs.buffer,
      startMsg.data.faceVertices.buffer,
      startMsg.data.faceTexCoords.buffer,
    ]);
  });
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Process multiple meshes off-thread, one at a time.
 * Useful for LOD generation of multiple assets.
 *
 * @example
 * ```typescript
 * const results = await decimateBatchOffThread(meshes, { targetPercent: 50 });
 * ```
 */
export async function decimateBatchOffThread(
  meshes: OptimizedMeshData[],
  options: Omit<OffThreadDecimationOptions, "onProgress"> & {
    onMeshProgress?: (meshIndex: number, progress: DecimationProgress) => void;
    onMeshComplete?: (
      meshIndex: number,
      result: OptimizedDecimationResult,
    ) => void;
  } = {},
): Promise<OptimizedDecimationResult[]> {
  const results: OptimizedDecimationResult[] = [];

  for (let i = 0; i < meshes.length; i++) {
    const result = await decimateOffThread(meshes[i], {
      ...options,
      onProgress: options.onMeshProgress
        ? (p) => options.onMeshProgress!(i, p)
        : undefined,
    });

    results.push(result);
    options.onMeshComplete?.(i, result);

    // Check for abort between meshes
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  return results;
}

// ============================================================================
// TIME-SLICED DECIMATION (for streaming results)
// ============================================================================

/**
 * Generator for time-sliced decimation that yields after each collapse.
 * Allows interleaving with rendering/other work.
 *
 * NOTE: This still runs on main thread but yields control.
 * For true non-blocking, use decimateOffThread.
 *
 * @example
 * ```typescript
 * for await (const state of decimateTimeSliced(mesh, { targetPercent: 50 })) {
 *   console.log(`${state.currentVertices} vertices remaining`);
 *   // Render intermediate state if desired
 * }
 * ```
 */
export async function* decimateTimeSliced(
  mesh: OptimizedMeshData,
  options: OffThreadDecimationOptions = {},
): AsyncGenerator<
  DecimationProgress & { mesh: OptimizedMeshData },
  OptimizedDecimationResult
> {
  // This is a placeholder - full implementation would need
  // a refactored decimation loop that can yield
  // For now, just run off-thread and yield final result
  const result = await decimateOffThread(mesh, options);

  yield {
    currentVertices: result.finalVertices,
    collapses: result.collapses,
    percentComplete: 100,
    mesh: result.mesh,
  };

  return result;
}
