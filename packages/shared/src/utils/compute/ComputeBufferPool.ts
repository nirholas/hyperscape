/**
 * Compute Buffer Pool
 *
 * Manages pre-allocated GPU buffers for compute operations.
 * Provides double-buffering for ping-pong patterns and
 * automatic staging buffer management for CPU read-back.
 */

import type { RuntimeComputeContext } from "./RuntimeComputeContext";

// ============================================================================
// TYPES
// ============================================================================

export interface PooledBuffer {
  buffer: GPUBuffer;
  size: number;
  usage: GPUBufferUsageFlags;
  inUse: boolean;
  lastUsedFrame: number;
}

export interface BufferPoolConfig {
  /** Initial pool sizes for common buffer types */
  initialPoolSize?: number;
  /** Maximum number of buffers to keep in pool */
  maxPoolSize?: number;
  /** Number of frames before a buffer is considered stale */
  staleFrameThreshold?: number;
}

export interface DoubleBuffer {
  read: GPUBuffer;
  write: GPUBuffer;
  size: number;
}

/** Standard buffer size tiers for pooling */
export const BUFFER_SIZE_TIERS = [
  1024, // 1KB
  4096, // 4KB
  16384, // 16KB
  65536, // 64KB
  262144, // 256KB
  1048576, // 1MB
  4194304, // 4MB
  16777216, // 16MB
  67108864, // 64MB
] as const;

// ============================================================================
// BUFFER POOL
// ============================================================================

/**
 * Pool of reusable GPU buffers to minimize allocation overhead.
 */
export class ComputeBufferPool {
  private context: RuntimeComputeContext;
  private config: Required<BufferPoolConfig>;

  // Pools organized by usage type and size tier
  private storagePools: Map<number, PooledBuffer[]> = new Map();
  private uniformPools: Map<number, PooledBuffer[]> = new Map();
  private stagingPools: Map<number, PooledBuffer[]> = new Map();
  private indirectPools: PooledBuffer[] = [];

  // Double buffer management
  private doubleBuffers: Map<string, DoubleBuffer> = new Map();

  // Frame tracking for cleanup
  private currentFrame = 0;

  constructor(context: RuntimeComputeContext, config: BufferPoolConfig = {}) {
    this.context = context;
    this.config = {
      initialPoolSize: config.initialPoolSize ?? 4,
      maxPoolSize: config.maxPoolSize ?? 32,
      staleFrameThreshold: config.staleFrameThreshold ?? 300, // 5 seconds at 60fps
    };
  }

  // ==========================================================================
  // STORAGE BUFFERS
  // ==========================================================================

  /**
   * Acquire a storage buffer of at least the specified size.
   */
  acquireStorageBuffer(minSize: number, label?: string): GPUBuffer | null {
    const tierSize = this.findSizeTier(minSize);
    return this.acquireFromPool(
      this.storagePools,
      tierSize,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      label ?? `storage_${tierSize}`,
      "storage",
    );
  }

  /**
   * Release a storage buffer back to the pool.
   */
  releaseStorageBuffer(buffer: GPUBuffer): void {
    this.releaseToPool(this.storagePools, buffer);
  }

  /**
   * Create a storage buffer with initial data (not pooled).
   */
  createStorageBufferWithData(
    data: ArrayBufferView,
    label: string,
  ): GPUBuffer | null {
    return this.context.createStorageBuffer(label, data);
  }

  // ==========================================================================
  // UNIFORM BUFFERS
  // ==========================================================================

  /**
   * Acquire a uniform buffer of at least the specified size.
   * Uniform buffers have stricter alignment requirements.
   */
  acquireUniformBuffer(minSize: number, label?: string): GPUBuffer | null {
    // Uniform buffers need 16-byte alignment for size
    const alignedSize = Math.ceil(minSize / 16) * 16;
    const tierSize = this.findSizeTier(alignedSize);

    return this.acquireFromPool(
      this.uniformPools,
      tierSize,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label ?? `uniform_${tierSize}`,
      "uniform",
    );
  }

  /**
   * Release a uniform buffer back to the pool.
   */
  releaseUniformBuffer(buffer: GPUBuffer): void {
    this.releaseToPool(this.uniformPools, buffer);
  }

  // ==========================================================================
  // STAGING BUFFERS
  // ==========================================================================

  /**
   * Acquire a staging buffer for CPU read-back.
   */
  acquireStagingBuffer(minSize: number, label?: string): GPUBuffer | null {
    const tierSize = this.findSizeTier(minSize);
    return this.acquireFromPool(
      this.stagingPools,
      tierSize,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label ?? `staging_${tierSize}`,
      "staging",
    );
  }

  /**
   * Release a staging buffer back to the pool.
   * IMPORTANT: Buffer must be unmapped before release.
   */
  releaseStagingBuffer(buffer: GPUBuffer): void {
    this.releaseToPool(this.stagingPools, buffer);
  }

  // ==========================================================================
  // INDIRECT BUFFERS
  // ==========================================================================

  /**
   * Acquire an indirect draw buffer.
   */
  acquireIndirectBuffer(indexed: boolean = false): GPUBuffer | null {
    const size = indexed ? 20 : 16;

    // Check pool for available buffer
    for (const pooled of this.indirectPools) {
      if (!pooled.inUse && pooled.size === size) {
        pooled.inUse = true;
        pooled.lastUsedFrame = this.currentFrame;
        return pooled.buffer;
      }
    }

    // Create new buffer
    const buffer = this.context.createIndirectBuffer(
      `indirect_${indexed ? "indexed" : "draw"}_${this.indirectPools.length}`,
      indexed,
    );

    if (buffer) {
      this.indirectPools.push({
        buffer,
        size,
        usage:
          GPUBufferUsage.INDIRECT |
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST,
        inUse: true,
        lastUsedFrame: this.currentFrame,
      });
    }

    return buffer;
  }

  /**
   * Release an indirect buffer back to the pool.
   */
  releaseIndirectBuffer(buffer: GPUBuffer): void {
    for (const pooled of this.indirectPools) {
      if (pooled.buffer === buffer) {
        pooled.inUse = false;
        return;
      }
    }
  }

  // ==========================================================================
  // DOUBLE BUFFERING
  // ==========================================================================

  /**
   * Create or get a double buffer pair for ping-pong operations.
   */
  getDoubleBuffer(name: string, size: number): DoubleBuffer | null {
    // Check if already exists
    const existing = this.doubleBuffers.get(name);
    if (existing && existing.size >= size) {
      return existing;
    }

    // Destroy existing if size changed
    if (existing) {
      existing.read.destroy();
      existing.write.destroy();
    }

    // Create new double buffer
    const tierSize = this.findSizeTier(size);
    const usage =
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST;

    const readBuffer = this.context.createBuffer({
      label: `${name}_read`,
      size: tierSize,
      usage,
    });

    const writeBuffer = this.context.createBuffer({
      label: `${name}_write`,
      size: tierSize,
      usage,
    });

    if (!readBuffer || !writeBuffer) {
      readBuffer?.destroy();
      writeBuffer?.destroy();
      return null;
    }

    const doubleBuffer: DoubleBuffer = {
      read: readBuffer,
      write: writeBuffer,
      size: tierSize,
    };

    this.doubleBuffers.set(name, doubleBuffer);
    return doubleBuffer;
  }

  /**
   * Swap the read and write buffers.
   */
  swapDoubleBuffer(name: string): void {
    const doubleBuffer = this.doubleBuffers.get(name);
    if (doubleBuffer) {
      const temp = doubleBuffer.read;
      doubleBuffer.read = doubleBuffer.write;
      doubleBuffer.write = temp;
    }
  }

  /**
   * Destroy a double buffer.
   */
  destroyDoubleBuffer(name: string): void {
    const doubleBuffer = this.doubleBuffers.get(name);
    if (doubleBuffer) {
      doubleBuffer.read.destroy();
      doubleBuffer.write.destroy();
      this.doubleBuffers.delete(name);
    }
  }

  // ==========================================================================
  // FRAME MANAGEMENT
  // ==========================================================================

  /**
   * Call at the beginning of each frame to track buffer usage.
   */
  beginFrame(): void {
    this.currentFrame++;
  }

  /**
   * Clean up stale buffers that haven't been used recently.
   */
  cleanupStaleBuffers(): void {
    const threshold = this.currentFrame - this.config.staleFrameThreshold;

    this.cleanupPoolStaleBuffers(this.storagePools, threshold);
    this.cleanupPoolStaleBuffers(this.uniformPools, threshold);
    this.cleanupPoolStaleBuffers(this.stagingPools, threshold);

    // Cleanup indirect buffers
    this.indirectPools = this.indirectPools.filter((pooled) => {
      if (!pooled.inUse && pooled.lastUsedFrame < threshold) {
        pooled.buffer.destroy();
        return false;
      }
      return true;
    });
  }

  // ==========================================================================
  // PRE-WARMING
  // ==========================================================================

  /**
   * Pre-allocate buffers to avoid allocation spikes during gameplay.
   * Call this during initialization/loading screens.
   *
   * @param config - Sizes to pre-allocate for each buffer type
   */
  warmup(config: {
    storageSizes?: number[];
    uniformSizes?: number[];
    stagingSizes?: number[];
    indirectCount?: number;
    indexedIndirectCount?: number;
  }): void {
    // Pre-warm storage buffers
    if (config.storageSizes) {
      for (const size of config.storageSizes) {
        const buffer = this.acquireStorageBuffer(
          size,
          `warmup_storage_${size}`,
        );
        if (buffer) this.releaseStorageBuffer(buffer);
      }
    }

    // Pre-warm uniform buffers
    if (config.uniformSizes) {
      for (const size of config.uniformSizes) {
        const buffer = this.acquireUniformBuffer(
          size,
          `warmup_uniform_${size}`,
        );
        if (buffer) this.releaseUniformBuffer(buffer);
      }
    }

    // Pre-warm staging buffers
    if (config.stagingSizes) {
      for (const size of config.stagingSizes) {
        const buffer = this.acquireStagingBuffer(
          size,
          `warmup_staging_${size}`,
        );
        if (buffer) this.releaseStagingBuffer(buffer);
      }
    }

    // Pre-warm indirect buffers
    if (config.indirectCount) {
      const buffers: GPUBuffer[] = [];
      for (let i = 0; i < config.indirectCount; i++) {
        const buffer = this.acquireIndirectBuffer(false);
        if (buffer) buffers.push(buffer);
      }
      for (const buffer of buffers) {
        this.releaseIndirectBuffer(buffer);
      }
    }

    // Pre-warm indexed indirect buffers
    if (config.indexedIndirectCount) {
      const buffers: GPUBuffer[] = [];
      for (let i = 0; i < config.indexedIndirectCount; i++) {
        const buffer = this.acquireIndirectBuffer(true);
        if (buffer) buffers.push(buffer);
      }
      for (const buffer of buffers) {
        this.releaseIndirectBuffer(buffer);
      }
    }
  }

  /**
   * Pre-warm with common sizes for typical game workloads.
   * Creates buffers for culling, particles, terrain, and grass.
   */
  warmupDefault(): void {
    this.warmup({
      storageSizes: [
        65536, // 64KB - small instance buffers
        262144, // 256KB - medium instance buffers
        1048576, // 1MB - large instance buffers
        4194304, // 4MB - very large instance buffers
      ],
      uniformSizes: [
        64, // Params struct
        256, // Extended params
        1024, // Permutation tables, etc.
      ],
      stagingSizes: [
        1024, // Small read-backs
        16384, // Medium read-backs
        65536, // Large read-backs
      ],
      indirectCount: 8,
      indexedIndirectCount: 4,
    });
  }

  // ==========================================================================
  // STATISTICS & METRICS
  // ==========================================================================

  // Usage metrics tracking
  private metrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    allocations: 0,
    peakUsage: { storage: 0, uniform: 0, staging: 0 },
  };

  /**
   * Get statistics about pool usage.
   */
  getStats(): {
    storageBuffers: { total: number; inUse: number; totalSize: number };
    uniformBuffers: { total: number; inUse: number; totalSize: number };
    stagingBuffers: { total: number; inUse: number; totalSize: number };
    indirectBuffers: { total: number; inUse: number };
    doubleBuffers: { count: number; totalSize: number };
  } {
    return {
      storageBuffers: this.getPoolStats(this.storagePools),
      uniformBuffers: this.getPoolStats(this.uniformPools),
      stagingBuffers: this.getPoolStats(this.stagingPools),
      indirectBuffers: {
        total: this.indirectPools.length,
        inUse: this.indirectPools.filter((p) => p.inUse).length,
      },
      doubleBuffers: {
        count: this.doubleBuffers.size,
        totalSize: Array.from(this.doubleBuffers.values()).reduce(
          (sum, db) => sum + db.size * 2,
          0,
        ),
      },
    };
  }

  /**
   * Get usage metrics for the pool.
   * Useful for tuning pool configuration.
   */
  getMetrics(): {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    allocations: number;
    peakUsage: { storage: number; uniform: number; staging: number };
  } {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
    };
  }

  /**
   * Reset usage metrics.
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      allocations: 0,
      peakUsage: { storage: 0, uniform: 0, staging: 0 },
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Destroy all pooled buffers.
   */
  destroy(): void {
    // Destroy storage pools
    for (const pool of this.storagePools.values()) {
      for (const pooled of pool) {
        pooled.buffer.destroy();
      }
    }
    this.storagePools.clear();

    // Destroy uniform pools
    for (const pool of this.uniformPools.values()) {
      for (const pooled of pool) {
        pooled.buffer.destroy();
      }
    }
    this.uniformPools.clear();

    // Destroy staging pools
    for (const pool of this.stagingPools.values()) {
      for (const pooled of pool) {
        pooled.buffer.destroy();
      }
    }
    this.stagingPools.clear();

    // Destroy indirect buffers
    for (const pooled of this.indirectPools) {
      pooled.buffer.destroy();
    }
    this.indirectPools = [];

    // Destroy double buffers
    for (const doubleBuffer of this.doubleBuffers.values()) {
      doubleBuffer.read.destroy();
      doubleBuffer.write.destroy();
    }
    this.doubleBuffers.clear();
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private findSizeTier(size: number): number {
    for (const tier of BUFFER_SIZE_TIERS) {
      if (tier >= size) return tier;
    }
    // Round up to next power of 2 for very large buffers
    return Math.pow(2, Math.ceil(Math.log2(size)));
  }

  private acquireFromPool(
    pools: Map<number, PooledBuffer[]>,
    tierSize: number,
    usage: GPUBufferUsageFlags,
    label: string,
    poolType: "storage" | "uniform" | "staging" = "storage",
  ): GPUBuffer | null {
    let pool = pools.get(tierSize);
    if (!pool) {
      pool = [];
      pools.set(tierSize, pool);
    }

    // Find available buffer
    for (const pooled of pool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsedFrame = this.currentFrame;
        this.metrics.hits++;
        this.updatePeakUsage(pools, poolType);
        return pooled.buffer;
      }
    }

    // No available buffer - record miss
    this.metrics.misses++;

    // Check pool size limit
    if (pool.length >= this.config.maxPoolSize) {
      console.warn(
        `[ComputeBufferPool] Pool size limit reached for tier ${tierSize}`,
      );
      // Create non-pooled buffer
      this.metrics.allocations++;
      return this.context.createBuffer({ label, size: tierSize, usage });
    }

    // Create new buffer
    const buffer = this.context.createBuffer({ label, size: tierSize, usage });
    if (buffer) {
      pool.push({
        buffer,
        size: tierSize,
        usage,
        inUse: true,
        lastUsedFrame: this.currentFrame,
      });
      this.metrics.allocations++;
      this.updatePeakUsage(pools, poolType);
    }

    return buffer;
  }

  private updatePeakUsage(
    pools: Map<number, PooledBuffer[]>,
    poolType: "storage" | "uniform" | "staging",
  ): void {
    let inUse = 0;
    for (const pool of pools.values()) {
      inUse += pool.filter((p) => p.inUse).length;
    }
    if (inUse > this.metrics.peakUsage[poolType]) {
      this.metrics.peakUsage[poolType] = inUse;
    }
  }

  private releaseToPool(
    pools: Map<number, PooledBuffer[]>,
    buffer: GPUBuffer,
  ): void {
    for (const pool of pools.values()) {
      for (const pooled of pool) {
        if (pooled.buffer === buffer) {
          pooled.inUse = false;
          return;
        }
      }
    }
    // Buffer not found in pool - it was created outside the pool, destroy it
    buffer.destroy();
  }

  private cleanupPoolStaleBuffers(
    pools: Map<number, PooledBuffer[]>,
    threshold: number,
  ): void {
    for (const [tierSize, pool] of pools.entries()) {
      const filtered = pool.filter((pooled) => {
        if (!pooled.inUse && pooled.lastUsedFrame < threshold) {
          pooled.buffer.destroy();
          this.metrics.evictions++;
          return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        pools.delete(tierSize);
      } else {
        pools.set(tierSize, filtered);
      }
    }
  }

  private getPoolStats(pools: Map<number, PooledBuffer[]>): {
    total: number;
    inUse: number;
    totalSize: number;
  } {
    let total = 0;
    let inUse = 0;
    let totalSize = 0;

    for (const pool of pools.values()) {
      for (const pooled of pool) {
        total++;
        if (pooled.inUse) inUse++;
        totalSize += pooled.size;
      }
    }

    return { total, inUse, totalSize };
  }
}

// ============================================================================
// TYPED BUFFER HELPERS
// ============================================================================

/**
 * Helper class for managing typed array data with pooled buffers.
 */
export class TypedBufferHelper<
  T extends Float32Array | Uint32Array | Int32Array,
> {
  private pool: ComputeBufferPool;
  private buffer: GPUBuffer | null = null;
  private data: T;
  private dirty = true;

  constructor(
    pool: ComputeBufferPool,
    data: T,
    private bufferType: "storage" | "uniform" = "storage",
  ) {
    this.pool = pool;
    this.data = data;
  }

  /**
   * Get the underlying typed array.
   */
  getData(): T {
    return this.data;
  }

  /**
   * Mark the data as modified.
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Upload data to GPU if dirty.
   */
  upload(context: RuntimeComputeContext): GPUBuffer | null {
    if (!this.buffer) {
      this.buffer =
        this.bufferType === "storage"
          ? this.pool.acquireStorageBuffer(this.data.byteLength)
          : this.pool.acquireUniformBuffer(this.data.byteLength);
    }

    if (this.buffer && this.dirty) {
      context.uploadToBuffer(this.buffer, this.data);
      this.dirty = false;
    }

    return this.buffer;
  }

  /**
   * Release the buffer back to the pool.
   */
  release(): void {
    if (this.buffer) {
      if (this.bufferType === "storage") {
        this.pool.releaseStorageBuffer(this.buffer);
      } else {
        this.pool.releaseUniformBuffer(this.buffer);
      }
      this.buffer = null;
    }
  }
}
