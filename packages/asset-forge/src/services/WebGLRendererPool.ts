import { ACESFilmicToneMapping, Camera, SRGBColorSpace, Scene, WebGLRenderer } from 'three'
import { createLogger } from '../utils/logger.ts'

const logger = createLogger('WebGLRendererPool')

export interface RendererOptions {
  antialias?: boolean
  alpha?: boolean
  preserveDrawingBuffer?: boolean
  powerPreference?: 'default' | 'high-performance' | 'low-power'
  width?: number
  height?: number
  pixelRatio?: number
}

export interface RendererMetrics {
  activeCount: number
  totalCreated: number
  totalReleased: number
  totalDisposed: number
  poolUtilization: number
  memoryEstimateMB: number
}

interface RendererEntry {
  id: string
  renderer: WebGLRenderer
  refCount: number
  lastUsed: number
  options: RendererOptions
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

/**
 * WebGL Renderer Pool - Manages a shared pool of WebGL renderers to prevent
 * "Too many active WebGL contexts" errors and reduce memory usage.
 *
 * Features:
 * - Automatic renderer reuse across components
 * - Reference counting for safe disposal
 * - Idle timeout cleanup (30s default)
 * - Performance monitoring and metrics
 * - Fallback handling for pool exhaustion
 */
export class WebGLRendererPool {
  private renderers: Map<string, RendererEntry> = new Map()
  private readonly maxRenderers: number
  private readonly idleTimeout: number
  private readonly enableMetrics: boolean
  private metrics: RendererMetrics = {
    activeCount: 0,
    totalCreated: 0,
    totalReleased: 0,
    totalDisposed: 0,
    poolUtilization: 0,
    memoryEstimateMB: 0
  }

  constructor(options: {
    maxRenderers?: number
    idleTimeout?: number
    enableMetrics?: boolean
  } = {}) {
    this.maxRenderers = options.maxRenderers || 4
    this.idleTimeout = options.idleTimeout || 30000 // 30 seconds
    this.enableMetrics = options.enableMetrics !== false

    logger.debug(`WebGLRendererPool initialized: maxRenderers=${this.maxRenderers}, idleTimeout=${this.idleTimeout}ms`)
  }

  /**
   * Acquire a renderer from the pool. Creates a new one if needed and pool limit not reached.
   * Returns a unique ID for this renderer instance.
   */
  acquire(options: RendererOptions = {}): string {
    // Try to find a compatible renderer
    const compatibleId = this.findCompatibleRenderer(options)

    if (compatibleId) {
      const entry = this.renderers.get(compatibleId)!
      entry.refCount++
      entry.lastUsed = Date.now()

      // Cancel any pending cleanup
      if (entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer)
        entry.cleanupTimer = null
      }

      logger.debug(`Renderer ${compatibleId} acquired (refCount: ${entry.refCount})`)
      this.updateMetrics()
      return compatibleId
    }

    // Create new renderer if under limit
    if (this.renderers.size < this.maxRenderers) {
      return this.createRenderer(options)
    }

    // Pool exhausted - try to find and dispose idle renderers
    const idleRenderer = this.findIdleRenderer()
    if (idleRenderer) {
      this.disposeRenderer(idleRenderer)
      return this.createRenderer(options)
    }

    // Last resort - create renderer anyway with warning
    logger.warn(`WebGL renderer pool exhausted (${this.renderers.size}/${this.maxRenderers}), creating anyway`)
    return this.createRenderer(options)
  }

  /**
   * Release a renderer back to the pool. Decrements reference count and schedules cleanup if idle.
   */
  release(id: string): void {
    const entry = this.renderers.get(id)
    if (!entry) {
      logger.warn(`Attempted to release unknown renderer: ${id}`)
      return
    }

    entry.refCount = Math.max(0, entry.refCount - 1)
    entry.lastUsed = Date.now()

    logger.debug(`Renderer ${id} released (refCount: ${entry.refCount})`)

    // Schedule cleanup if idle
    if (entry.refCount === 0) {
      entry.cleanupTimer = setTimeout(() => {
        this.disposeRenderer(id)
      }, this.idleTimeout)
    }

    this.updateMetrics()
  }

  /**
   * Get the WebGLRenderer instance for a given ID
   */
  getRenderer(id: string): WebGLRenderer | undefined {
    return this.renderers.get(id)?.renderer
  }

  /**
   * Render a scene with the given renderer ID
   */
  render(id: string, scene: Scene, camera: Camera): boolean {
    const entry = this.renderers.get(id)
    if (!entry) {
      logger.error(`Attempted to render with unknown renderer: ${id}`)
      return false
    }

    try {
      entry.renderer.render(scene, camera)
      entry.lastUsed = Date.now()
      return true
    } catch (err) {
      logger.error(`Render failed for ${id}:`, err)
      return false
    }
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): RendererMetrics {
    return { ...this.metrics }
  }

  /**
   * Dispose all renderers and clear the pool
   */
  disposeAll(): void {
    logger.debug(`Disposing all renderers (${this.renderers.size} total)`)

    for (const [id, entry] of this.renderers.entries()) {
      if (entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer)
      }
      entry.renderer.dispose()
      logger.debug(`Renderer ${id} disposed`)
    }

    this.renderers.clear()
    this.metrics.totalDisposed += this.metrics.activeCount
    this.metrics.activeCount = 0
    this.updateMetrics()
  }

  // Private methods

  private createRenderer(options: RendererOptions): string {
    const id = `renderer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const renderer = new WebGLRenderer({
      antialias: options.antialias !== false,
      alpha: options.alpha !== false,
      preserveDrawingBuffer: options.preserveDrawingBuffer || false,
      powerPreference: options.powerPreference || 'high-performance'
    })

    // Configure renderer
    renderer.setPixelRatio(options.pixelRatio || window.devicePixelRatio)
    if (options.width && options.height) {
      renderer.setSize(options.width, options.height)
    }
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping

    const entry: RendererEntry = {
      id,
      renderer,
      refCount: 1,
      lastUsed: Date.now(),
      options,
      cleanupTimer: null
    }

    this.renderers.set(id, entry)
    this.metrics.totalCreated++
    this.metrics.activeCount++

    logger.debug(`Renderer ${id} created (total: ${this.renderers.size}/${this.maxRenderers})`)
    this.updateMetrics()

    return id
  }

  private disposeRenderer(id: string): void {
    const entry = this.renderers.get(id)
    if (!entry) {
      return
    }

    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer)
    }

    entry.renderer.dispose()
    this.renderers.delete(id)
    this.metrics.activeCount--
    this.metrics.totalDisposed++

    logger.debug(`Renderer ${id} disposed (remaining: ${this.renderers.size})`)
    this.updateMetrics()
  }

  private findCompatibleRenderer(options: RendererOptions): string | null {
    for (const [id, entry] of this.renderers.entries()) {
      if (entry.refCount === 0 && this.optionsMatch(entry.options, options)) {
        return id
      }
    }
    return null
  }

  private findIdleRenderer(): string | null {
    let oldestIdle: { id: string; lastUsed: number } | null = null

    for (const [id, entry] of this.renderers.entries()) {
      if (entry.refCount === 0) {
        if (!oldestIdle || entry.lastUsed < oldestIdle.lastUsed) {
          oldestIdle = { id, lastUsed: entry.lastUsed }
        }
      }
    }

    return oldestIdle?.id || null
  }

  private optionsMatch(a: RendererOptions, b: RendererOptions): boolean {
    return (
      a.antialias === b.antialias &&
      a.alpha === b.alpha &&
      a.preserveDrawingBuffer === b.preserveDrawingBuffer &&
      a.powerPreference === b.powerPreference
    )
  }

  private updateMetrics(): void {
    if (!this.enableMetrics) return

    this.metrics.poolUtilization = this.renderers.size / this.maxRenderers

    // Rough memory estimate: ~10MB per renderer context
    this.metrics.memoryEstimateMB = this.renderers.size * 10
  }
}

// Singleton instance
let poolInstance: WebGLRendererPool | null = null

/**
 * Get the global WebGL renderer pool instance
 */
export function getRendererPool(): WebGLRendererPool {
  if (!poolInstance) {
    poolInstance = new WebGLRendererPool({
      maxRenderers: 4,
      idleTimeout: 30000,
      enableMetrics: true
    })
  }
  return poolInstance
}

/**
 * Reset the global pool (mainly for testing)
 */
export function resetRendererPool(): void {
  if (poolInstance) {
    poolInstance.disposeAll()
    poolInstance = null
  }
}
