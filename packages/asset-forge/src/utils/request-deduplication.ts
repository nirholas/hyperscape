/**
 * Request Deduplication Utility
 *
 * Prevents duplicate concurrent requests by caching promises
 */

type PendingRequest = {
  promise: Promise<Response>
  timestamp: number
}

class RequestDeduplicator {
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private readonly CACHE_TTL = 60000 // 1 minute

  /**
   * Generate a cache key from request parameters
   */
  generateKey(url: string, method: string = 'GET', body?: any): string {
    const bodyHash = body ? JSON.stringify(body) : ''
    return `${method}:${url}:${bodyHash}`
  }

  async deduplicate(key: string, fetcher: () => Promise<Response>): Promise<Response> {
    // Check if there's a pending request for this key
    const pending = this.pendingRequests.get(key)
    if (pending && Date.now() - pending.timestamp < this.CACHE_TTL) {
      return pending.promise
    }

    // Create new request
    const promise = fetcher()
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
    })

    // Clean up after request completes
    promise.finally(() => {
      const current = this.pendingRequests.get(key)
      if (current?.promise === promise) {
        this.pendingRequests.delete(key)
      }
    })

    return promise
  }

  clear(): void {
    this.pendingRequests.clear()
  }
}

export const requestDeduplicator = new RequestDeduplicator()
