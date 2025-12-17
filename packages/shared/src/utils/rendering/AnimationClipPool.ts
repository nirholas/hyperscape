/**
 * AnimationClipPool - Shared animation clip caching to prevent duplicate loading
 */

import THREE from "../../extras/three/three";

interface RetargetOptions {
  rootToHips: number;
  version: string;
  getBoneName: (name: string) => string | undefined;
}

interface CachedAnimation {
  factory: { toClip: (options: RetargetOptions) => THREE.AnimationClip | null };
  retargetedClips: Map<string, THREE.AnimationClip>;
  loadedAt: number;
  accessCount: number;
  estimatedSize: number;
}

interface AnimationLoader {
  load: (type: "emote", url: string) => Promise<{
    toClip: (options: RetargetOptions) => THREE.AnimationClip | null;
  }>;
}

export interface AnimationPoolStats {
  cachedAnimations: number;
  totalRetargetedClips: number;
  totalAccessCount: number;
  estimatedMemoryBytes: number;
  cacheHits: number;
  cacheMisses: number;
}

export class AnimationClipPool {
  private static instance: AnimationClipPool;
  private cache = new Map<string, CachedAnimation>();
  private loading = new Map<string, Promise<{ toClip: (options: RetargetOptions) => THREE.AnimationClip | null }>>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private maxCacheSize = 100;

  private constructor() {}

  static getInstance(): AnimationClipPool {
    if (!AnimationClipPool.instance) {
      AnimationClipPool.instance = new AnimationClipPool();
    }
    return AnimationClipPool.instance;
  }

  private getRetargetKey(options: RetargetOptions): string {
    return `${Math.round(options.rootToHips * 100) / 100}_${options.version}`;
  }

  private estimateClipSize(clip: THREE.AnimationClip): number {
    let size = 200;
    for (const track of clip.tracks) {
      size += track.values.length * 4 + track.times.length * 4 + track.name.length * 2;
    }
    return size;
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].accessCount - b[1].accessCount);

    const removeCount = Math.ceil(this.cache.size * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  async getClip(
    url: string,
    loader: AnimationLoader,
    options: RetargetOptions,
  ): Promise<THREE.AnimationClip | null> {
    const retargetKey = this.getRetargetKey(options);

    const cached = this.cache.get(url);
    if (cached) {
      cached.accessCount++;
      this.cacheHits++;

      const existingClip = cached.retargetedClips.get(retargetKey);
      if (existingClip) return existingClip;

      const newClip = cached.factory.toClip(options);
      if (newClip) {
        cached.retargetedClips.set(retargetKey, newClip);
        cached.estimatedSize += this.estimateClipSize(newClip);
      }
      return newClip;
    }

    this.cacheMisses++;

    let loadPromise = this.loading.get(url);
    if (!loadPromise) {
      loadPromise = loader.load("emote", url);
      this.loading.set(url, loadPromise);
    }

    const factory = await loadPromise;

    // Re-check cache after await - another caller may have cached already
    const cachedAfterAwait = this.cache.get(url);
    if (cachedAfterAwait) {
      cachedAfterAwait.accessCount++;
      const existingClip = cachedAfterAwait.retargetedClips.get(retargetKey);
      if (existingClip) return existingClip;

      const newClip = cachedAfterAwait.factory.toClip(options);
      if (newClip) {
        cachedAfterAwait.retargetedClips.set(retargetKey, newClip);
        cachedAfterAwait.estimatedSize += this.estimateClipSize(newClip);
      }
      return newClip;
    }

    this.loading.delete(url);
    const clip = factory.toClip(options);

    const cacheEntry: CachedAnimation = {
      factory,
      retargetedClips: new Map(),
      loadedAt: Date.now(),
      accessCount: 1,
      estimatedSize: clip ? this.estimateClipSize(clip) : 0,
    };

    if (clip) {
      cacheEntry.retargetedClips.set(retargetKey, clip);
    }

    this.cache.set(url, cacheEntry);
    this.evictIfNeeded();
    return clip;
  }

  getStats(): AnimationPoolStats {
    let totalRetargetedClips = 0;
    let totalAccessCount = 0;
    let estimatedMemoryBytes = 0;

    for (const entry of this.cache.values()) {
      totalRetargetedClips += entry.retargetedClips.size;
      totalAccessCount += entry.accessCount;
      estimatedMemoryBytes += entry.estimatedSize;
    }

    return {
      cachedAnimations: this.cache.size,
      totalRetargetedClips,
      totalAccessCount,
      estimatedMemoryBytes,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  clear(): void {
    this.cache.clear();
    this.loading.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

export const animationClipPool = AnimationClipPool.getInstance();
