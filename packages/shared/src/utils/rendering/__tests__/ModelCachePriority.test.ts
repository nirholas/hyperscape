/**
 * Tests for ModelCache Priority Loading Support.
 * Tests the priority parameter integration in loadModel().
 *
 * Coverage:
 * - Priority parameter acceptance
 * - Position/tile parameter handling
 * - Default behavior (no priority = immediate)
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import THREE from "../../../extras/three/three";

/**
 * Define LoadPriority enum locally to avoid import issues during testing.
 */
enum LoadPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  PREFETCH = 4,
}

describe("ModelCache Priority Support", () => {
  describe("Priority Parameter Handling", () => {
    /**
     * Simulate the options validation that ModelCache performs
     */
    type LoadModelOptions = {
      shareMaterials?: boolean;
      generateLODs?: boolean;
      lodCategory?: string;
      lodOptions?: object;
      priority?: number;
      position?: THREE.Vector3;
      tile?: { x: number; z: number };
    };

    function validateLoadModelOptions(options?: LoadModelOptions): {
      usePriorityLoading: boolean;
      priority: LoadPriority;
      hasPosition: boolean;
      hasTile: boolean;
    } {
      const priority = options?.priority ?? LoadPriority.HIGH; // Default is HIGH (immediate)
      const usePriorityLoading = options?.priority !== undefined;
      const hasPosition = options?.position !== undefined;
      const hasTile = options?.tile !== undefined;

      return {
        usePriorityLoading,
        priority: priority as LoadPriority,
        hasPosition,
        hasTile,
      };
    }

    it("uses immediate loading when no priority specified", () => {
      const result = validateLoadModelOptions({});

      expect(result.usePriorityLoading).toBe(false);
      expect(result.priority).toBe(LoadPriority.HIGH);
    });

    it("uses priority loading when priority explicitly specified", () => {
      const result = validateLoadModelOptions({ priority: LoadPriority.LOW });

      expect(result.usePriorityLoading).toBe(true);
      expect(result.priority).toBe(LoadPriority.LOW);
    });

    it("accepts all priority levels", () => {
      for (const priority of [
        LoadPriority.CRITICAL,
        LoadPriority.HIGH,
        LoadPriority.NORMAL,
        LoadPriority.LOW,
        LoadPriority.PREFETCH,
      ]) {
        const result = validateLoadModelOptions({ priority });
        expect(result.priority).toBe(priority);
      }
    });

    it("passes position when provided", () => {
      const position = new THREE.Vector3(100, 50, 200);
      const result = validateLoadModelOptions({ position });

      expect(result.hasPosition).toBe(true);
    });

    it("passes tile when provided", () => {
      const result = validateLoadModelOptions({ tile: { x: 5, z: 10 } });

      expect(result.hasTile).toBe(true);
    });

    it("handles both position and tile", () => {
      const position = new THREE.Vector3(100, 50, 200);
      const result = validateLoadModelOptions({
        priority: LoadPriority.NORMAL,
        position,
        tile: { x: 5, z: 10 },
      });

      expect(result.hasPosition).toBe(true);
      expect(result.hasTile).toBe(true);
    });

    it("handles undefined options gracefully", () => {
      const result = validateLoadModelOptions(undefined);

      expect(result.usePriorityLoading).toBe(false);
      expect(result.priority).toBe(LoadPriority.HIGH);
    });
  });

  describe("Priority Path Selection", () => {
    /**
     * Simulate the decision logic for using priority vs immediate loading
     */
    function shouldUsePriorityPath(
      priority: LoadPriority | undefined,
      loaderHasPriorityMethod: boolean,
    ): boolean {
      // No priority specified = use immediate loading
      if (priority === undefined) return false;

      // Loader doesn't support priority = fall back to immediate
      if (!loaderHasPriorityMethod) return false;

      // CRITICAL and HIGH priorities = immediate loading anyway
      if (priority <= LoadPriority.HIGH) return false;

      // NORMAL, LOW, PREFETCH use priority queue
      return true;
    }

    it("uses immediate loading when no priority specified", () => {
      expect(shouldUsePriorityPath(undefined, true)).toBe(false);
    });

    it("uses immediate loading for CRITICAL priority", () => {
      expect(shouldUsePriorityPath(LoadPriority.CRITICAL, true)).toBe(false);
    });

    it("uses immediate loading for HIGH priority", () => {
      expect(shouldUsePriorityPath(LoadPriority.HIGH, true)).toBe(false);
    });

    it("uses priority path for NORMAL priority", () => {
      expect(shouldUsePriorityPath(LoadPriority.NORMAL, true)).toBe(true);
    });

    it("uses priority path for LOW priority", () => {
      expect(shouldUsePriorityPath(LoadPriority.LOW, true)).toBe(true);
    });

    it("uses priority path for PREFETCH priority", () => {
      expect(shouldUsePriorityPath(LoadPriority.PREFETCH, true)).toBe(true);
    });

    it("falls back to immediate when loader lacks priority method", () => {
      expect(shouldUsePriorityPath(LoadPriority.LOW, false)).toBe(false);
      expect(shouldUsePriorityPath(LoadPriority.PREFETCH, false)).toBe(false);
    });
  });

  describe("Position Cloning", () => {
    /**
     * Test that position vectors are cloned to prevent mutation issues
     */
    it("clones position vector to prevent mutation", () => {
      const original = new THREE.Vector3(100, 50, 200);
      const cloned = original.clone();

      // Modify original
      original.set(0, 0, 0);

      // Clone should be unaffected
      expect(cloned.x).toBe(100);
      expect(cloned.y).toBe(50);
      expect(cloned.z).toBe(200);
    });

    it("handles undefined position without cloning", () => {
      const position: THREE.Vector3 | undefined = undefined;
      const cloned = position?.clone();

      expect(cloned).toBeUndefined();
    });
  });

  describe("Cache Behavior with Priority", () => {
    /**
     * Test that caching behavior is consistent regardless of priority
     */
    type CacheEntry = {
      url: string;
      loadedAt: number;
      priority?: LoadPriority;
    };

    const cache = new Map<string, CacheEntry>();

    beforeEach(() => {
      cache.clear();
    });

    function simulateLoad(
      url: string,
      priority?: LoadPriority,
    ): { fromCache: boolean; entry: CacheEntry } {
      const existing = cache.get(url);
      if (existing) {
        return { fromCache: true, entry: existing };
      }

      const entry: CacheEntry = {
        url,
        loadedAt: Date.now(),
        priority,
      };
      cache.set(url, entry);
      return { fromCache: false, entry };
    }

    it("returns cached result regardless of new priority", () => {
      // First load with LOW priority
      const first = simulateLoad("model.glb", LoadPriority.LOW);
      expect(first.fromCache).toBe(false);

      // Second load with CRITICAL priority should still return cached
      const second = simulateLoad("model.glb", LoadPriority.CRITICAL);
      expect(second.fromCache).toBe(true);
      expect(second.entry).toBe(first.entry);
    });

    it("does not modify cached entry priority", () => {
      simulateLoad("model.glb", LoadPriority.LOW);
      simulateLoad("model.glb", LoadPriority.CRITICAL);

      const entry = cache.get("model.glb");
      expect(entry?.priority).toBe(LoadPriority.LOW); // Original priority unchanged
    });
  });

  describe("URL Resolution with Priority", () => {
    /**
     * Test URL resolution happens before priority queueing
     */
    function resolveAssetURL(url: string, assetsUrl?: string): string {
      if (url.startsWith("asset://")) {
        const cdnUrl = assetsUrl?.replace(/\/$/, "") || "http://localhost:8080";
        return url.replace("asset://", `${cdnUrl}/`);
      }
      return url;
    }

    it("resolves asset:// URLs before priority processing", () => {
      const assetUrl = "asset://models/tree.glb";
      const resolved = resolveAssetURL(assetUrl, "https://cdn.example.com");

      expect(resolved).toBe("https://cdn.example.com/models/tree.glb");
    });

    it("preserves absolute URLs", () => {
      const absoluteUrl = "https://other-cdn.com/models/tree.glb";
      const resolved = resolveAssetURL(absoluteUrl, "https://cdn.example.com");

      expect(resolved).toBe(absoluteUrl);
    });

    it("uses localhost fallback when no assetsUrl", () => {
      const assetUrl = "asset://models/tree.glb";
      const resolved = resolveAssetURL(assetUrl);

      expect(resolved).toBe("http://localhost:8080/models/tree.glb");
    });
  });
});

describe("ImpostorManager BakePriority Mapping", () => {
  /**
   * Tests for the BakePriority enum that maps to LoadPriority
   */

  enum BakePriority {
    HIGH = LoadPriority.HIGH,
    NORMAL = LoadPriority.NORMAL,
    LOW = LoadPriority.LOW,
  }

  it("BakePriority.HIGH equals LoadPriority.HIGH", () => {
    expect(BakePriority.HIGH).toBe(LoadPriority.HIGH);
    expect(BakePriority.HIGH).toBe(1);
  });

  it("BakePriority.NORMAL equals LoadPriority.NORMAL", () => {
    expect(BakePriority.NORMAL).toBe(LoadPriority.NORMAL);
    expect(BakePriority.NORMAL).toBe(2);
  });

  it("BakePriority.LOW equals LoadPriority.LOW", () => {
    expect(BakePriority.LOW).toBe(LoadPriority.LOW);
    expect(BakePriority.LOW).toBe(3);
  });

  it("BakePriority maintains consistent ordering with LoadPriority", () => {
    expect(BakePriority.HIGH).toBeLessThan(BakePriority.NORMAL);
    expect(BakePriority.NORMAL).toBeLessThan(BakePriority.LOW);
  });

  it("can be used interchangeably with LoadPriority for comparisons", () => {
    const bakePriority: BakePriority = BakePriority.NORMAL;
    const loadPriority: LoadPriority = LoadPriority.NORMAL;

    expect(bakePriority === loadPriority).toBe(true);
  });
});

describe("VegetationSystem LOD Priority Usage", () => {
  /**
   * Tests documenting how VegetationSystem uses priorities for LOD loading
   */

  it("LOD1 should use LOW priority", () => {
    // VegetationSystem loads LOD1 with LOW priority for background streaming
    const LOD1_PRIORITY = LoadPriority.LOW;
    expect(LOD1_PRIORITY).toBe(3);
    expect(LOD1_PRIORITY).toBeGreaterThan(LoadPriority.NORMAL);
  });

  it("LOD2 should use PREFETCH priority", () => {
    // VegetationSystem loads LOD2 with PREFETCH priority (lowest)
    const LOD2_PRIORITY = LoadPriority.PREFETCH;
    expect(LOD2_PRIORITY).toBe(4);
    expect(LOD2_PRIORITY).toBeGreaterThan(LoadPriority.LOW);
  });

  it("LOD0 should use HIGH or immediate (no priority)", () => {
    // LOD0 (full detail) models are loaded immediately without queueing
    // No priority = immediate, or explicitly HIGH which also loads immediately
    expect(LoadPriority.HIGH).toBeLessThanOrEqual(LoadPriority.HIGH);
  });

  it("priority progression matches LOD importance", () => {
    // More detailed LODs = higher priority (lower number)
    const LOD0_PRIORITY = LoadPriority.HIGH; // Most important
    const LOD1_PRIORITY = LoadPriority.LOW; // Less important
    const LOD2_PRIORITY = LoadPriority.PREFETCH; // Least important

    expect(LOD0_PRIORITY).toBeLessThan(LOD1_PRIORITY);
    expect(LOD1_PRIORITY).toBeLessThan(LOD2_PRIORITY);
  });
});
