/**
 * WorkerPool - Manages a pool of Web Workers for parallel processing
 *
 * Provides efficient task distribution across multiple worker threads with:
 * - Automatic load balancing (round-robin with busy tracking)
 * - Task queuing when all workers are busy
 * - Transfer support for zero-copy ArrayBuffer passing
 * - Promise-based API for easy async/await usage
 *
 * @example
 * const pool = new WorkerPool(workerCode, 4);
 * const result = await pool.execute({ type: 'process', data: myData });
 */

type WorkerTask<T, R> = {
  data: T;
  transfers?: Transferable[];
  resolve: (result: R) => void;
  reject: (error: Error) => void;
};

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  taskCount: number;
}

export class WorkerPool<TInput = unknown, TOutput = unknown> {
  private workers: PoolWorker[] = [];
  private taskQueue: WorkerTask<TInput, TOutput>[] = [];
  private nextWorkerIndex = 0;
  private terminated = false;
  /** Fallback function for synchronous execution when workers unavailable */
  private fallbackFn?: (input: TInput) => TOutput | Promise<TOutput>;
  /** True if workers are available and working */
  private workersAvailable = false;
  /** Initialization error if workers failed to create */
  private initError: Error | null = null;

  /**
   * Create a new worker pool
   * @param workerCode - Inline worker code as a string (will be converted to blob URL)
   * @param poolSize - Number of workers to spawn (defaults to navigator.hardwareConcurrency - 1, min 1)
   * @param fallbackFn - Optional fallback function for when workers unavailable (e.g., server-side)
   */
  constructor(
    workerCode: string,
    poolSize: number = Math.max(
      1,
      (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) -
        1,
    ),
    fallbackFn?: (input: TInput) => TOutput | Promise<TOutput>,
  ) {
    this.fallbackFn = fallbackFn;

    // Check if we're in an environment with Worker support
    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      this.initError = new Error(
        "Web Workers not available in this environment",
      );
      console.warn(
        "[WorkerPool] Web Workers not available - using fallback if provided",
      );
      return;
    }

    // Detect Bun runtime - Bun has Worker/Blob but blob URLs don't work for workers
    if (
      typeof process !== "undefined" &&
      process.versions &&
      "bun" in process.versions
    ) {
      this.initError = new Error("Blob URLs not supported in Bun runtime");
      console.warn(
        "[WorkerPool] Bun runtime detected - blob URLs not supported, using fallback if provided",
      );
      return;
    }

    // Detect non-browser environment (no window global)
    if (typeof window === "undefined") {
      this.initError = new Error(
        "Web Workers require browser environment (window global)",
      );
      console.warn(
        "[WorkerPool] Server environment detected - using fallback if provided",
      );
      return;
    }

    // Create blob URL from inline worker code
    let url: string;
    try {
      const blob = new Blob([workerCode], { type: "application/javascript" });
      url = URL.createObjectURL(blob);
    } catch (e) {
      this.initError =
        e instanceof Error ? e : new Error("Failed to create worker blob");
      console.warn("[WorkerPool] Failed to create worker blob:", e);
      return;
    }

    // Spawn workers
    for (let i = 0; i < poolSize; i++) {
      try {
        const worker = new Worker(url);
        this.workers.push({
          worker,
          busy: false,
          taskCount: 0,
        });
        worker.onerror = (e) => {
          console.error(`[WorkerPool] Worker ${i} error:`, e.message);
        };
      } catch (e) {
        console.warn(`[WorkerPool] Failed to create worker ${i}:`, e);
      }
    }

    // Clean up blob URL after workers are created
    URL.revokeObjectURL(url);

    this.workersAvailable = this.workers.length > 0;

    if (!this.workersAvailable) {
      console.warn(
        "[WorkerPool] No workers created - using fallback if provided",
      );
    }
  }

  /**
   * Check if workers are available
   */
  hasWorkers(): boolean {
    return this.workersAvailable;
  }

  /**
   * Get initialization error if workers failed to create
   * Returns null if workers initialized successfully or haven't been attempted yet
   */
  getInitError(): Error | null {
    return this.initError;
  }

  /**
   * Execute a task on the worker pool
   * @param data - Task data to send to worker
   * @param transfers - Optional transferable objects (e.g., ArrayBuffers)
   * @returns Promise that resolves with worker result
   */
  execute(data: TInput, transfers?: Transferable[]): Promise<TOutput> {
    if (this.terminated) {
      return Promise.reject(new Error("WorkerPool has been terminated"));
    }

    // Use fallback if no workers available
    if (!this.workersAvailable) {
      if (this.fallbackFn) {
        try {
          const result = this.fallbackFn(data);
          return result instanceof Promise ? result : Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return Promise.reject(
        new Error("WorkerPool has no workers and no fallback function"),
      );
    }

    return new Promise<TOutput>((resolve, reject) => {
      const task: WorkerTask<TInput, TOutput> = {
        data,
        transfers,
        resolve,
        reject,
      };

      // Find an available worker
      const availableWorker = this.getAvailableWorker();
      if (availableWorker) {
        this.runTask(availableWorker, task);
      } else {
        // Queue the task
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * Execute multiple tasks in parallel
   * @param tasks - Array of task data
   * @returns Promise that resolves with all results
   */
  executeAll(
    tasks: Array<{ data: TInput; transfers?: Transferable[] }>,
  ): Promise<TOutput[]> {
    return Promise.all(tasks.map((t) => this.execute(t.data, t.transfers)));
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    workerCount: number;
    busyCount: number;
    queuedTasks: number;
    totalTasksProcessed: number;
    workersAvailable: boolean;
    initError: string | null;
  } {
    const busyCount = this.workers.filter((w) => w.busy).length;
    const totalTasksProcessed = this.workers.reduce(
      (sum, w) => sum + w.taskCount,
      0,
    );
    return {
      workerCount: this.workers.length,
      busyCount,
      queuedTasks: this.taskQueue.length,
      totalTasksProcessed,
      workersAvailable: this.workersAvailable,
      initError: this.initError?.message ?? null,
    };
  }

  /**
   * Terminate all workers and clean up
   */
  terminate(): void {
    this.terminated = true;
    for (const { worker } of this.workers) {
      worker.terminate();
    }
    this.workers = [];

    // Reject any pending tasks
    for (const task of this.taskQueue) {
      task.reject(new Error("WorkerPool terminated"));
    }
    this.taskQueue = [];
  }

  private getAvailableWorker(): PoolWorker | null {
    // Round-robin with availability check
    const startIndex = this.nextWorkerIndex;
    for (let i = 0; i < this.workers.length; i++) {
      const index = (startIndex + i) % this.workers.length;
      const worker = this.workers[index];
      if (!worker.busy) {
        this.nextWorkerIndex = (index + 1) % this.workers.length;
        return worker;
      }
    }
    return null;
  }

  private runTask(
    poolWorker: PoolWorker,
    task: WorkerTask<TInput, TOutput>,
  ): void {
    poolWorker.busy = true;

    const handleMessage = (e: MessageEvent) => {
      poolWorker.worker.removeEventListener("message", handleMessage);
      poolWorker.worker.removeEventListener("error", handleError);
      poolWorker.busy = false;
      poolWorker.taskCount++;

      if (e.data.error) {
        task.reject(new Error(e.data.error));
      } else {
        task.resolve(e.data.result as TOutput);
      }

      // Process next queued task
      this.processQueue();
    };

    const handleError = (e: ErrorEvent) => {
      poolWorker.worker.removeEventListener("message", handleMessage);
      poolWorker.worker.removeEventListener("error", handleError);
      poolWorker.busy = false;

      task.reject(new Error(e.message || "Worker error"));

      // Process next queued task
      this.processQueue();
    };

    poolWorker.worker.addEventListener("message", handleMessage);
    poolWorker.worker.addEventListener("error", handleError);

    // Send task to worker
    if (task.transfers && task.transfers.length > 0) {
      poolWorker.worker.postMessage(task.data, task.transfers);
    } else {
      poolWorker.worker.postMessage(task.data);
    }
  }

  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    const availableWorker = this.getAvailableWorker();
    if (availableWorker) {
      const task = this.taskQueue.shift()!;
      this.runTask(availableWorker, task);
    }
  }
}

/**
 * Create a worker pool from a function
 * The function will be stringified and run in the worker context
 */
export function createWorkerFromFunction<TInput, TOutput>(
  fn: (input: TInput) => TOutput,
  poolSize?: number,
): WorkerPool<TInput, TOutput> {
  const workerCode = `
    const processFn = ${fn.toString()};
    
    self.onmessage = async function(e) {
      try {
        const result = await processFn(e.data);
        self.postMessage({ result });
      } catch (error) {
        self.postMessage({ error: error.message || 'Unknown error' });
      }
    };
  `;
  return new WorkerPool<TInput, TOutput>(workerCode, poolSize);
}
