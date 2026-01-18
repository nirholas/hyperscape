/**
 * EntityPool - Generic object pool for reusable entities
 *
 * Eliminates allocations for frequently created/destroyed objects like:
 * - Hitsplats
 * - Projectiles
 * - Temporary calculation objects
 * - UI elements
 *
 * Performance characteristics:
 * - O(1) acquire/release operations
 * - Zero allocations after warmup (unless pool exhausted)
 * - Automatic pool growth when exhausted (with configurable max)
 *
 */

/**
 * Interface for poolable entities
 *
 * Entities must implement reset() to clear state when released,
 * and deactivate() to clean up when returned to pool.
 */
export interface PoolableEntity {
  /**
   * Reset entity to initial state for reuse.
   * Called when entity is acquired from pool.
   */
  reset(): void;

  /**
   * Deactivate entity before returning to pool.
   * Called when entity is released back to pool.
   */
  deactivate(): void;
}

/**
 * Configuration for EntityPool
 */
export interface EntityPoolConfig<T extends PoolableEntity> {
  /** Factory function to create new entities */
  factory: () => T;
  /** Initial pool size (created on construction) */
  initialSize: number;
  /** Maximum pool size (prevents unbounded growth) */
  maxSize: number;
  /** Growth increment when pool is exhausted */
  growthSize?: number;
  /** Name for debugging/monitoring */
  name?: string;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  name: string;
  total: number;
  available: number;
  inUse: number;
  peakUsage: number;
  acquireCount: number;
  releaseCount: number;
  growthCount: number;
}

/**
 * EntityPool - Generic object pool for reusable entities
 *
 * Example usage:
 * ```typescript
 * const hitsplatPool = new EntityPool({
 *   factory: () => new Hitsplat(),
 *   initialSize: 100,
 *   maxSize: 500,
 *   name: 'hitsplats',
 * });
 *
 * // Acquire from pool
 * const hitsplat = hitsplatPool.acquire();
 * hitsplat.value = damage;
 * hitsplat.show();
 *
 * // Release back to pool when done
 * hitsplatPool.release(hitsplat);
 * ```
 */
export class EntityPool<T extends PoolableEntity> {
  private readonly _pool: T[] = [];
  private readonly _factory: () => T;
  private readonly _maxSize: number;
  private readonly _growthSize: number;
  private readonly _name: string;

  // Statistics
  private _peakUsage: number = 0;
  private _acquireCount: number = 0;
  private _releaseCount: number = 0;
  private _growthCount: number = 0;

  constructor(config: EntityPoolConfig<T>) {
    this._factory = config.factory;
    this._maxSize = config.maxSize;
    this._growthSize = config.growthSize ?? Math.ceil(config.initialSize / 4);
    this._name = config.name ?? "EntityPool";

    // Pre-allocate initial pool
    this.grow(config.initialSize);
  }

  /**
   * Acquire an entity from the pool
   *
   * Returns a reset entity ready for use.
   * If pool is empty, grows the pool (up to maxSize).
   * If at maxSize, creates a new entity (not pooled on release).
   *
   * @returns Entity ready for use
   */
  acquire(): T {
    this._acquireCount++;

    if (this._pool.length === 0) {
      // Pool exhausted - try to grow
      if (this.getTotalCreated() < this._maxSize) {
        this.grow(
          Math.min(this._growthSize, this._maxSize - this.getTotalCreated()),
        );
      }
    }

    if (this._pool.length > 0) {
      const entity = this._pool.pop()!;
      entity.reset();
      this.updatePeakUsage();
      return entity;
    }

    // Still empty after growth attempt - create new (will be discarded on release)
    const entity = this._factory();
    entity.reset();
    return entity;
  }

  /**
   * Release an entity back to the pool
   *
   * Entity is deactivated and added back to pool (if not at max).
   *
   * @param entity - Entity to release
   */
  release(entity: T): void {
    this._releaseCount++;
    entity.deactivate();

    // Only add back if under max size
    if (this._pool.length < this._maxSize) {
      this._pool.push(entity);
    }
    // Otherwise entity is discarded (will be GC'd)
  }

  /**
   * Acquire an entity, use it, and automatically release
   *
   * Convenience method for short-lived usage patterns.
   *
   * @param fn - Function to execute with the entity
   * @returns Result of the function
   */
  withEntity<R>(fn: (entity: T) => R): R {
    const entity = this.acquire();
    try {
      return fn(entity);
    } finally {
      this.release(entity);
    }
  }

  /**
   * Pre-warm the pool by growing to a specific size
   *
   * Useful for initialization to avoid allocations during gameplay.
   *
   * @param targetSize - Target pool size
   */
  prewarm(targetSize: number): void {
    const neededSize = Math.min(targetSize, this._maxSize);
    const currentSize = this._pool.length;
    if (currentSize < neededSize) {
      this.grow(neededSize - currentSize);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      name: this._name,
      total: this.getTotalCreated(),
      available: this._pool.length,
      inUse: this.getTotalCreated() - this._pool.length,
      peakUsage: this._peakUsage,
      acquireCount: this._acquireCount,
      releaseCount: this._releaseCount,
      growthCount: this._growthCount,
    };
  }

  /**
   * Get number of available entities in pool
   */
  getAvailableCount(): number {
    return this._pool.length;
  }

  /**
   * Get number of entities currently in use
   */
  getInUseCount(): number {
    return this.getTotalCreated() - this._pool.length;
  }

  /**
   * Clear the pool
   *
   * All pooled entities are discarded.
   * Does not affect entities currently in use.
   */
  clear(): void {
    this._pool.length = 0;
  }

  /**
   * Reset pool to initial state
   *
   * Clears all entities and resets statistics.
   */
  reset(): void {
    this._pool.length = 0;
    this._peakUsage = 0;
    this._acquireCount = 0;
    this._releaseCount = 0;
    this._growthCount = 0;
  }

  /**
   * Grow the pool by creating new entities
   */
  private grow(count: number): void {
    this._growthCount++;
    for (let i = 0; i < count; i++) {
      const entity = this._factory();
      entity.deactivate();
      this._pool.push(entity);
    }
  }

  /**
   * Get total number of entities created (in pool + in use)
   */
  private getTotalCreated(): number {
    // We track this implicitly through pool operations
    // In-use count = acquireCount - releaseCount (but can be negative due to growth)
    // Simpler: pool.length + currently tracked in-use
    return (
      this._pool.length + Math.max(0, this._acquireCount - this._releaseCount)
    );
  }

  /**
   * Update peak usage tracking
   */
  private updatePeakUsage(): void {
    const currentInUse = this.getInUseCount();
    if (currentInUse > this._peakUsage) {
      this._peakUsage = currentInUse;
    }
  }
}

/**
 * Create a simple poolable wrapper for plain objects
 *
 * Useful for objects that don't implement PoolableEntity interface.
 *
 * @param factory - Factory function to create the object
 * @param reset - Function to reset the object
 * @param deactivate - Function to deactivate the object (optional)
 * @returns Wrapped poolable entity
 */
export function createPoolableWrapper<T>(
  factory: () => T,
  reset: (obj: T) => void,
  deactivate?: (obj: T) => void,
): () => PoolableEntity & { value: T } {
  return () => {
    const value = factory();
    return {
      value,
      reset() {
        reset(value);
      },
      deactivate() {
        if (deactivate) {
          deactivate(value);
        }
      },
    };
  };
}
