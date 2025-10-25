/**
 * Cache Invalidation Service (Stub)
 *
 * Temporary stub implementation for cache invalidation
 * TODO: Implement full cache invalidation with event-based triggers
 */

class CacheInvalidationServiceImpl {
  private static instance: CacheInvalidationServiceImpl
  private listeners: Map<string, Set<() => void>> = new Map()

  private constructor() {}

  static getInstance(): CacheInvalidationServiceImpl {
    if (!CacheInvalidationServiceImpl.instance) {
      CacheInvalidationServiceImpl.instance = new CacheInvalidationServiceImpl()
    }
    return CacheInvalidationServiceImpl.instance
  }

  invalidate(key: string): void {
    const listeners = this.listeners.get(key)
    if (listeners) {
      listeners.forEach(listener => listener())
    }
  }

  invalidatePattern(pattern: RegExp): void {
    // Stub: In a full implementation, this would iterate cache keys
    // and invalidate matching ones
  }

  invalidateAll(): void {
    this.listeners.forEach(listeners => {
      listeners.forEach(listener => listener())
    })
  }

  onInvalidate(key: string, callback: () => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback)

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(callback)
    }
  }
}

export const CacheInvalidationService = CacheInvalidationServiceImpl
