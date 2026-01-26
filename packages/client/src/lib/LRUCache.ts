/**
 * Simple Data Structures for Client State
 *
 * Keep it simple. For a browser-based MMORPG:
 * - V8's garbage collector handles typical game patterns well
 * - Three.js already pools vectors/matrices internally
 * - Your bottleneck is server CPU and network, not client GC
 *
 * Only use ObjectPool if profiling shows GC is a problem (10,000+ allocations/sec).
 *
 * @packageDocumentation
 */

/**
 * Factory function for creating pooled objects
 */
export type ObjectFactory<T> = () => T;

/**
 * Reset function to prepare object for reuse
 */
export type ObjectReset<T> = (obj: T) => void;

/**
 * Simple Object Pool
 *
 * Only use this if profiling shows GC pressure. For most game patterns,
 * just create objects normally - V8 handles it fine.
 *
 * Good use cases:
 * - Particle systems (1000s of particles/second)
 * - Bullet hell games
 * - Real-time physics simulations
 *
 * NOT needed for:
 * - Normal entity spawning (<100/second)
 * - UI state updates
 * - Network message handling
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private readonly factory: ObjectFactory<T>;
  private readonly reset: ObjectReset<T>;
  private readonly maxSize: number;

  constructor(
    factory: ObjectFactory<T>,
    reset: ObjectReset<T>,
    initialSize: number = 0,
    maxSize: number = 100,
  ) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;

    // Pre-warm if requested
    for (let i = 0; i < Math.min(initialSize, maxSize); i++) {
      this.pool.push(this.factory());
    }
  }

  acquire(): T {
    return this.pool.length > 0 ? this.pool.pop()! : this.factory();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }

  get available(): number {
    return this.pool.length;
  }

  getStats() {
    return { available: this.pool.length, maxSize: this.maxSize };
  }
}

/**
 * Entity lookup by ID - just use a Map
 * No need for complex pooling for typical MMORPG entity counts
 */
export class EntityPool<T extends { id?: string }> extends ObjectPool<T> {
  private active: Map<string, T> = new Map();

  acquireWithId(id: string): T {
    const entity = this.acquire();
    entity.id = id;
    this.active.set(id, entity);
    return entity;
  }

  getActive(id: string): T | undefined {
    return this.active.get(id);
  }

  releaseById(id: string): void {
    const entity = this.active.get(id);
    if (entity) {
      this.active.delete(id);
      this.release(entity);
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  clearActive(): void {
    this.active.clear();
  }
}

// Simple registry for cleanup on logout
class PoolRegistry {
  private pools: Map<string, ObjectPool<unknown>> = new Map();

  register(name: string, pool: ObjectPool<unknown>): void {
    this.pools.set(name, pool);
  }

  unregister(name: string): void {
    this.pools.delete(name);
  }

  clearAll(): void {
    for (const pool of this.pools.values()) {
      pool.clear();
    }
  }

  logAllStats(): void {
    for (const [name, pool] of this.pools.entries()) {
      console.debug(`[Pool:${name}]`, pool.getStats());
    }
  }

  getTotalAvailable(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.available;
    }
    return total;
  }
}

export const poolRegistry = new PoolRegistry();

export function createMonitoredPool<T>(
  name: string,
  factory: ObjectFactory<T>,
  reset: ObjectReset<T>,
  initialSize?: number,
  maxSize?: number,
): ObjectPool<T> {
  const pool = new ObjectPool<T>(factory, reset, initialSize, maxSize);
  poolRegistry.register(name, pool as ObjectPool<unknown>);
  return pool;
}

// Backward compatibility - just use Map for simple key-value storage
export { ObjectPool as LRUCache };

export function createMonitoredCache<K, V>(
  _name: string,
  _maxSize: number,
  _ttlMs?: number,
): Map<K, V> & { logStats: () => void } {
  const map = new Map<K, V>();
  return Object.assign(map, {
    logStats: () => console.debug(`[Map] size: ${map.size}`),
  });
}

export const cacheRegistry = {
  clearAll: () => poolRegistry.clearAll(),
  logAllStats: () => poolRegistry.logAllStats(),
  getTotalSize: () => poolRegistry.getTotalAvailable(),
  pruneAll: () => 0,
};
