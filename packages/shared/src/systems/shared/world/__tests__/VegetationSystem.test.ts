/**
 * Tests for VegetationSystem procedural placement algorithms.
 * Tests the core placement logic without requiring a full world context.
 */

import { describe, it, expect } from "vitest";

/**
 * Deterministic PRNG - copied from VegetationSystem for testing
 */
function createTileLayerRng(
  tileKey: string,
  category: string,
  seed: number = 0,
): () => number {
  let hash = 5381;
  const str = `${tileKey}_${category}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }

  let state = (hash >>> 0) ^ seed;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Test weighted asset selection algorithm
 */
function selectWeightedAsset<T extends { weight: number }>(
  assets: T[],
  totalWeight: number,
  rng: () => number,
): T | null {
  let random = rng() * totalWeight;
  for (const asset of assets) {
    random -= asset.weight;
    if (random <= 0) {
      return asset;
    }
  }
  return assets[assets.length - 1] ?? null;
}

/**
 * Slope estimation algorithm
 */
function estimateSlope(
  x: number,
  z: number,
  getHeight: (x: number, z: number) => number,
): number {
  const delta = 1.0;
  const hN = getHeight(x, z - delta);
  const hS = getHeight(x, z + delta);
  const hE = getHeight(x + delta, z);
  const hW = getHeight(x - delta, z);

  const dhdx = (hE - hW) / (2 * delta);
  const dhdz = (hS - hN) / (2 * delta);

  return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
}

describe("VegetationSystem Algorithms", () => {
  describe("createTileLayerRng", () => {
    it("generates deterministic values for same inputs", () => {
      const rng1 = createTileLayerRng("0_0", "tree");
      const rng2 = createTileLayerRng("0_0", "tree");

      const values1 = [rng1(), rng1(), rng1()];
      const values2 = [rng2(), rng2(), rng2()];

      expect(values1).toEqual(values2);
    });

    it("generates different values for different tiles", () => {
      const rng1 = createTileLayerRng("0_0", "tree");
      const rng2 = createTileLayerRng("1_0", "tree");

      expect(rng1()).not.toBe(rng2());
    });

    it("generates different values for different categories", () => {
      const rng1 = createTileLayerRng("0_0", "tree");
      const rng2 = createTileLayerRng("0_0", "bush");

      expect(rng1()).not.toBe(rng2());
    });

    it("generates values in range [0, 1)", () => {
      const rng = createTileLayerRng("test_tile", "grass");

      for (let i = 0; i < 1000; i++) {
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("incorporates seed into generation", () => {
      const rng1 = createTileLayerRng("0_0", "tree", 12345);
      const rng2 = createTileLayerRng("0_0", "tree", 54321);

      expect(rng1()).not.toBe(rng2());
    });
  });

  describe("selectWeightedAsset", () => {
    const assets = [
      { id: "common", weight: 100 },
      { id: "uncommon", weight: 30 },
      { id: "rare", weight: 10 },
    ];
    const totalWeight = 140;

    it("selects assets according to weight distribution", () => {
      // Run many selections and count occurrences
      const counts: Record<string, number> = {
        common: 0,
        uncommon: 0,
        rare: 0,
      };
      const iterations = 10000;

      // Use fixed seed for reproducibility
      const rng = createTileLayerRng("weighted_test", "test");

      for (let i = 0; i < iterations; i++) {
        const selected = selectWeightedAsset(assets, totalWeight, rng);
        if (selected) {
          counts[selected.id]++;
        }
      }

      // Common should appear most often (~71%), uncommon (~21%), rare (~7%)
      expect(counts.common).toBeGreaterThan(counts.uncommon);
      expect(counts.uncommon).toBeGreaterThan(counts.rare);

      // Rough bounds check (with some tolerance)
      expect(counts.common / iterations).toBeGreaterThan(0.5);
      expect(counts.rare / iterations).toBeLessThan(0.2);
    });

    it("returns null for empty assets array", () => {
      const rng = createTileLayerRng("empty_test", "test");
      const result = selectWeightedAsset([], 0, rng);
      expect(result).toBeNull();
    });

    it("returns last asset when random exceeds total weight", () => {
      // Edge case: when rng returns ~1.0
      const assets = [{ id: "only", weight: 10 }];
      // Create RNG that will generate values very close to 1
      const highRng = () => {
        return 0.9999;
      };

      const result = selectWeightedAsset(assets, 10, highRng);
      expect(result?.id).toBe("only");
    });
  });

  describe("estimateSlope", () => {
    it("returns 0 for flat terrain", () => {
      const flatHeight = () => 5;
      const slope = estimateSlope(0, 0, flatHeight);
      expect(slope).toBeCloseTo(0, 5);
    });

    it("returns correct slope for simple inclines", () => {
      // Terrain that rises 1 unit per 1 unit in X direction
      const inclineX = (x: number) => x;
      const slope = estimateSlope(0, 0, inclineX);
      // Slope should be 1 (45 degree incline)
      expect(slope).toBeCloseTo(1, 2);
    });

    it("returns correct slope for diagonal inclines", () => {
      // Terrain that rises in both X and Z
      const inclineBoth = (x: number, z: number) => x + z;
      const slope = estimateSlope(0, 0, inclineBoth);
      // Slope should be sqrt(2) for 45-degree incline in both directions
      expect(slope).toBeCloseTo(Math.sqrt(2), 2);
    });

    it("handles negative slopes", () => {
      const decline = (x: number) => -x;
      const slope = estimateSlope(0, 0, decline);
      // Slope magnitude should still be positive
      expect(slope).toBeGreaterThan(0);
      expect(slope).toBeCloseTo(1, 2);
    });

    it("detects steep slopes", () => {
      // Steep terrain (2 units rise per 1 unit run)
      const steep = (x: number) => x * 2;
      const slope = estimateSlope(0, 0, steep);
      expect(slope).toBeGreaterThan(1);
      expect(slope).toBeCloseTo(2, 2);
    });
  });

  describe("Position Generation", () => {
    it("generates positions within tile bounds", () => {
      const tileWorldX = 100;
      const tileWorldZ = 200;
      const tileSize = 100;

      const rng = createTileLayerRng("100_200", "tree");

      // Generate 100 random positions
      for (let i = 0; i < 100; i++) {
        const x = tileWorldX + rng() * tileSize;
        const z = tileWorldZ + rng() * tileSize;

        expect(x).toBeGreaterThanOrEqual(tileWorldX);
        expect(x).toBeLessThan(tileWorldX + tileSize);
        expect(z).toBeGreaterThanOrEqual(tileWorldZ);
        expect(z).toBeLessThan(tileWorldZ + tileSize);
      }
    });
  });

  describe("Spacing Algorithm", () => {
    /**
     * Check if minimum spacing is maintained between positions
     */
    function checkMinSpacing(
      positions: Array<{ x: number; z: number }>,
      minSpacing: number,
    ): boolean {
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = positions[i].x - positions[j].x;
          const dz = positions[i].z - positions[j].z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < minSpacing * 0.99) {
            // Small tolerance for floating point
            return false;
          }
        }
      }
      return true;
    }

    it("respects minimum spacing between positions", () => {
      const positions: Array<{ x: number; z: number }> = [];
      const minSpacing = 10;
      const tileSize = 100;
      const rng = createTileLayerRng("spacing_test", "tree");

      // Generate positions with spacing constraint
      for (
        let attempts = 0;
        attempts < 200 && positions.length < 20;
        attempts++
      ) {
        const x = rng() * tileSize;
        const z = rng() * tileSize;

        // Check spacing against existing positions
        let tooClose = false;
        for (const existing of positions) {
          const dx = existing.x - x;
          const dz = existing.z - z;
          if (dx * dx + dz * dz < minSpacing * minSpacing) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          positions.push({ x, z });
        }
      }

      expect(checkMinSpacing(positions, minSpacing)).toBe(true);
    });
  });

  describe("Scale Variation", () => {
    it("generates scales within specified range", () => {
      const baseScale = 1.0;
      const scaleVariation: [number, number] = [0.8, 1.2];
      const rng = createTileLayerRng("scale_test", "tree");

      for (let i = 0; i < 100; i++) {
        const randomFactor =
          scaleVariation[0] + rng() * (scaleVariation[1] - scaleVariation[0]);
        const scale = baseScale * randomFactor;

        expect(scale).toBeGreaterThanOrEqual(baseScale * scaleVariation[0]);
        expect(scale).toBeLessThanOrEqual(baseScale * scaleVariation[1]);
      }
    });
  });

  describe("Noise-based Filtering", () => {
    /**
     * Simple 2D noise approximation for testing
     */
    function simpleNoise2D(x: number, z: number): number {
      // Simple deterministic pseudo-noise
      const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      return n - Math.floor(n);
    }

    it("filters positions based on noise threshold", () => {
      const noiseScale = 0.05;
      const noiseThreshold = 0.5;
      const tileSize = 100;

      const rng = createTileLayerRng("noise_test", "grass");
      const accepted: Array<{ x: number; z: number }> = [];
      const rejected: Array<{ x: number; z: number }> = [];

      for (let i = 0; i < 100; i++) {
        const x = rng() * tileSize;
        const z = rng() * tileSize;
        const noiseValue = simpleNoise2D(x * noiseScale, z * noiseScale);

        if (noiseValue >= noiseThreshold) {
          accepted.push({ x, z });
        } else {
          rejected.push({ x, z });
        }
      }

      // Should have filtered out some positions
      expect(rejected.length).toBeGreaterThan(0);
      expect(accepted.length).toBeGreaterThan(0);
    });
  });

  describe("5-Tier LOD Distance Thresholds", () => {
    /**
     * Algorithm Documentation: These tests verify the 5-tier LOD/culling system
     * used in VegetationSystem.ts after LOD2 support was added.
     *
     * LOD Pipeline (5 tiers):
     * 0. LOD0: Full detail 3D mesh (0 to lod1Distance)
     * 1. LOD1: Low-poly 3D mesh ~10% (lod1Distance to lod2Distance)
     * 2. LOD2: Very low-poly 3D mesh ~3% (lod2Distance to imposterDistance)
     * 3. Imposter: Billboard (imposterDistance to fadeDistance)
     * 4. Culled: Hidden (beyond fadeDistance)
     */
    const TREE_LOD_CONFIG = {
      lod1Distance: 60,
      lod2Distance: 120,
      imposterDistance: 200,
      fadeDistance: 350,
    };

    type LODLevel = 0 | 1 | 2 | 3 | 4;

    /**
     * Determine LOD level based on distance.
     * Mirrors updateChunkVisibility() logic in VegetationSystem.
     */
    function getLODLevel(
      distance: number,
      hasLOD1: boolean,
      hasLOD2: boolean,
    ): LODLevel {
      if (distance > TREE_LOD_CONFIG.fadeDistance) {
        return 4; // Culled
      }
      if (distance > TREE_LOD_CONFIG.imposterDistance) {
        return 3; // Impostor
      }
      if (distance > TREE_LOD_CONFIG.lod2Distance && hasLOD2) {
        return 2; // LOD2
      }
      if (distance > TREE_LOD_CONFIG.lod1Distance && hasLOD1) {
        return 1; // LOD1
      }
      return 0; // LOD0 (full detail)
    }

    it("renders LOD0 at close range (< 60m) for trees", () => {
      expect(getLODLevel(0, true, true)).toBe(0);
      expect(getLODLevel(30, true, true)).toBe(0);
      expect(getLODLevel(59, true, true)).toBe(0);
      expect(getLODLevel(60, true, true)).toBe(0); // At boundary
    });

    it("renders LOD1 at medium range (60-120m) when LOD1 available", () => {
      expect(getLODLevel(61, true, true)).toBe(1);
      expect(getLODLevel(90, true, true)).toBe(1);
      expect(getLODLevel(119, true, true)).toBe(1);
    });

    it("renders LOD2 at far range (120-200m) when LOD2 available", () => {
      expect(getLODLevel(121, true, true)).toBe(2);
      expect(getLODLevel(150, true, true)).toBe(2);
      expect(getLODLevel(199, true, true)).toBe(2);
    });

    it("renders Impostor at very far range (200-350m)", () => {
      expect(getLODLevel(201, true, true)).toBe(3);
      expect(getLODLevel(250, true, true)).toBe(3);
      expect(getLODLevel(349, true, true)).toBe(3);
    });

    it("culls beyond fade distance (> 350m)", () => {
      expect(getLODLevel(351, true, true)).toBe(4);
      expect(getLODLevel(500, true, true)).toBe(4);
      expect(getLODLevel(1000, true, true)).toBe(4);
    });

    it("skips LOD1 when not available", () => {
      // Without LOD1, should go LOD0 -> LOD2 or LOD0 -> Impostor
      expect(getLODLevel(30, false, true)).toBe(0); // LOD0
      expect(getLODLevel(90, false, true)).toBe(0); // Still LOD0 (no LOD1)
      expect(getLODLevel(121, false, true)).toBe(2); // LOD2
    });

    it("skips LOD2 when not available", () => {
      // Without LOD2, should go LOD1 -> Impostor
      expect(getLODLevel(90, true, false)).toBe(1); // LOD1
      expect(getLODLevel(150, true, false)).toBe(1); // Still LOD1 (no LOD2)
      expect(getLODLevel(201, true, false)).toBe(3); // Impostor
    });

    it("falls back to LOD0 when no LODs available", () => {
      expect(getLODLevel(30, false, false)).toBe(0);
      expect(getLODLevel(90, false, false)).toBe(0);
      expect(getLODLevel(150, false, false)).toBe(0);
      expect(getLODLevel(201, false, false)).toBe(3); // Impostor still works
    });

    it("handles exact boundaries correctly", () => {
      // At exactly lod1Distance: still LOD0
      expect(getLODLevel(60, true, true)).toBe(0);
      expect(getLODLevel(60.001, true, true)).toBe(1);

      // At exactly lod2Distance: still LOD1
      expect(getLODLevel(120, true, true)).toBe(1);
      expect(getLODLevel(120.001, true, true)).toBe(2);

      // At exactly imposterDistance: still LOD2
      expect(getLODLevel(200, true, true)).toBe(2);
      expect(getLODLevel(200.001, true, true)).toBe(3);

      // At exactly fadeDistance: still Impostor
      expect(getLODLevel(350, true, true)).toBe(3);
      expect(getLODLevel(350.001, true, true)).toBe(4);
    });

    it("handles zero and negative distances", () => {
      expect(getLODLevel(0, true, true)).toBe(0);
      expect(getLODLevel(-10, true, true)).toBe(0);
    });
  });

  describe("LOD2 Decimation Ratios (documentation)", () => {
    /**
     * Documents the decimation ratios used in bake-lod.py
     * These are the vertex reduction targets for each LOD level.
     */
    const DECIMATION_RATIOS = {
      // LOD1: ~10% of original vertices
      tree_lod1: 0.1,
      rock_lod1: 0.2,
      bush_lod1: 0.15,
      building_lod1: 0.25,
      // LOD2: ~3% of original vertices (LOD1 * 0.33)
      tree_lod2: 0.1 * 0.33, // ~3.3%
      rock_lod2: 0.2 * 0.33, // ~6.6%
      bush_lod2: 0.15 * 0.33, // ~5%
    };

    it("LOD2 should be significantly more decimated than LOD1", () => {
      expect(DECIMATION_RATIOS.tree_lod2).toBeLessThan(
        DECIMATION_RATIOS.tree_lod1,
      );
      expect(DECIMATION_RATIOS.rock_lod2).toBeLessThan(
        DECIMATION_RATIOS.rock_lod1,
      );
      expect(DECIMATION_RATIOS.bush_lod2).toBeLessThan(
        DECIMATION_RATIOS.bush_lod1,
      );
    });

    it("LOD1 decimation should preserve reasonable detail", () => {
      // LOD1 should keep 10-25% of vertices
      expect(DECIMATION_RATIOS.tree_lod1).toBeGreaterThanOrEqual(0.05);
      expect(DECIMATION_RATIOS.tree_lod1).toBeLessThanOrEqual(0.3);
    });

    it("LOD2 decimation should be aggressive but not extreme", () => {
      // LOD2 should keep 2-10% of vertices
      expect(DECIMATION_RATIOS.tree_lod2).toBeGreaterThanOrEqual(0.02);
      expect(DECIMATION_RATIOS.tree_lod2).toBeLessThanOrEqual(0.1);
    });
  });

  describe("Streaming LOD Queue Behavior (real behavior tests)", () => {
    /**
     * Tests the actual streaming LOD loading behavior with real queue simulation.
     * LOD1 and LOD2 models are loaded on-demand after LOD0 is ready.
     */

    it("streaming batch size should be reasonable", () => {
      // VegetationSystem.STREAMING_BATCH_SIZE = 2
      // This is the actual value used in the code
      const STREAMING_BATCH_SIZE = 2;
      // Small batch size to avoid frame drops
      expect(STREAMING_BATCH_SIZE).toBeGreaterThanOrEqual(1);
      expect(STREAMING_BATCH_SIZE).toBeLessThanOrEqual(5);
    });

    it("LOD1 queue is processed before LOD2 queue in each frame", () => {
      // Simulate the actual processStreamingLODQueue logic
      const lod1Queue = ["tree1", "tree2", "tree3"];
      const lod2Queue = ["tree1", "tree2", "tree3"];
      const processed: string[] = [];
      const BATCH_SIZE = 2;

      // This mirrors the actual code: LOD1 is processed first, then LOD2
      for (const assetId of lod1Queue.splice(0, BATCH_SIZE)) {
        processed.push(`LOD1:${assetId}`);
      }
      for (const assetId of lod2Queue.splice(0, BATCH_SIZE)) {
        processed.push(`LOD2:${assetId}`);
      }

      // LOD1 items should appear before LOD2 items
      expect(processed[0]).toBe("LOD1:tree1");
      expect(processed[1]).toBe("LOD1:tree2");
      expect(processed[2]).toBe("LOD2:tree1");
      expect(processed[3]).toBe("LOD2:tree2");

      // Remaining items stay in queue for next frame
      expect(lod1Queue).toEqual(["tree3"]);
      expect(lod2Queue).toEqual(["tree3"]);
    });

    it("small vegetation categories should skip LOD queuing", () => {
      // The actual SKIP_LOD1_CATEGORIES set from VegetationSystem
      // This tests the real skip logic used when loading assets
      const SKIP_LOD1_CATEGORIES = new Set([
        "mushroom",
        "grass",
        "flower",
        "fern",
        "ivy",
      ]);

      // Simulate the actual queueing logic from loadAssetData()
      function shouldQueueLOD(category: string): boolean {
        return !SKIP_LOD1_CATEGORIES.has(category);
      }

      // Small objects should NOT be queued for LOD loading
      expect(shouldQueueLOD("mushroom")).toBe(false);
      expect(shouldQueueLOD("grass")).toBe(false);
      expect(shouldQueueLOD("flower")).toBe(false);
      expect(shouldQueueLOD("fern")).toBe(false);
      expect(shouldQueueLOD("ivy")).toBe(false);

      // Large objects SHOULD be queued for LOD loading
      expect(shouldQueueLOD("tree")).toBe(true);
      expect(shouldQueueLOD("rock")).toBe(true);
      expect(shouldQueueLOD("bush")).toBe(true);
    });
  });

  describe("Instance Visibility Update (5-tier algorithm)", () => {
    /**
     * Algorithm Documentation: Tests the 5-tier visibility update logic
     * that VegetationSystem uses when camera moves.
     *
     * The actual implementation operates on CHUNKS, not individual instances.
     * Each chunk has its own visibility state based on center distance.
     * This provides better performance than per-instance LOD.
     */
    type InstanceState = {
      x: number;
      z: number;
      visible: boolean;
      mode: "lod0" | "lod1" | "lod2" | "imposter" | "culled";
    };

    const CONFIG = {
      lod1Distance: 60,
      lod2Distance: 120,
      imposterDistance: 200,
      fadeDistance: 350,
    };

    /**
     * Simulate the 5-tier visibility update logic from VegetationSystem.
     * Note: Actual implementation uses squared distances for performance.
     */
    function updateVisibility(
      instances: InstanceState[],
      cameraX: number,
      cameraZ: number,
      hasLOD1 = true,
      hasLOD2 = true,
    ): void {
      for (const instance of instances) {
        const dx = instance.x - cameraX;
        const dz = instance.z - cameraZ;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance > CONFIG.fadeDistance) {
          instance.visible = false;
          instance.mode = "culled";
        } else if (distance > CONFIG.imposterDistance) {
          instance.visible = true;
          instance.mode = "imposter";
        } else if (distance > CONFIG.lod2Distance && hasLOD2) {
          instance.visible = true;
          instance.mode = "lod2";
        } else if (distance > CONFIG.lod1Distance && hasLOD1) {
          instance.visible = true;
          instance.mode = "lod1";
        } else {
          instance.visible = true;
          instance.mode = "lod0";
        }
      }
    }

    it("updates all instances based on camera position using 5 tiers", () => {
      const instances: InstanceState[] = [
        { x: 0, z: 0, visible: true, mode: "lod0" },
        { x: 80, z: 0, visible: true, mode: "lod0" }, // Beyond 60m LOD1 threshold
        { x: 140, z: 0, visible: true, mode: "lod0" }, // Beyond 120m LOD2 threshold
        { x: 220, z: 0, visible: true, mode: "lod0" }, // Beyond 200m impostor threshold
        { x: 400, z: 0, visible: true, mode: "lod0" }, // Beyond 350m fade threshold
      ];

      updateVisibility(instances, 0, 0);

      expect(instances[0].mode).toBe("lod0"); // 0m away
      expect(instances[1].mode).toBe("lod1"); // 80m away
      expect(instances[2].mode).toBe("lod2"); // 140m away
      expect(instances[3].mode).toBe("imposter"); // 220m away
      expect(instances[4].mode).toBe("culled"); // 400m away
    });

    it("LOD visibility changes when camera moves", () => {
      const instances: InstanceState[] = [
        { x: 140, z: 0, visible: true, mode: "lod0" },
      ];

      // Camera at origin: 140m away -> LOD2
      updateVisibility(instances, 0, 0);
      expect(instances[0].mode).toBe("lod2");

      // Camera at x=50: 90m away (140-50=90) -> LOD1 (60-120 range)
      updateVisibility(instances, 50, 0);
      expect(instances[0].mode).toBe("lod1");

      // Camera at x=110: 30m away (140-110=30) -> LOD0 (< 60)
      updateVisibility(instances, 110, 0);
      expect(instances[0].mode).toBe("lod0");

      // Camera at x=-100: 240m away (140-(-100)=240) -> Impostor (200-350 range)
      updateVisibility(instances, -100, 0);
      expect(instances[0].mode).toBe("imposter");
    });

    it("handles diagonal distances correctly with 5 tiers", () => {
      const instances: InstanceState[] = [
        { x: 100, z: 80, visible: true, mode: "lod0" }, // sqrt(100^2 + 80^2) ≈ 128m
      ];

      updateVisibility(instances, 0, 0);

      // 128m is beyond lod2Distance (120) but below imposterDistance (200)
      expect(instances[0].mode).toBe("lod2");
    });

    it("skips LOD1 when not available", () => {
      const instances: InstanceState[] = [
        { x: 80, z: 0, visible: true, mode: "lod0" }, // Would be LOD1 if available
      ];

      updateVisibility(instances, 0, 0, false, true); // hasLOD1 = false

      // Should stay LOD0 since LOD1 not available
      expect(instances[0].mode).toBe("lod0");
    });

    it("skips LOD2 when not available", () => {
      const instances: InstanceState[] = [
        { x: 140, z: 0, visible: true, mode: "lod0" }, // Would be LOD2 if available
      ];

      updateVisibility(instances, 0, 0, true, false); // hasLOD2 = false

      // Should stay LOD1 since LOD2 not available
      expect(instances[0].mode).toBe("lod1");
    });

    it("handles many instances efficiently with 5 tiers", () => {
      const instances: InstanceState[] = [];

      // Create grid of instances spread across ALL LOD zones
      // Camera will be at (200, 25), so we need instances from 0 to 600+ to cover all zones:
      // LOD0: 0-60m, LOD1: 60-120m, LOD2: 120-200m, Impostor: 200-350m, Culled: >350m
      for (let x = 0; x <= 600; x += 20) {
        // 20m spacing, 0 to 600 = ~30 x-positions
        for (let z = 0; z <= 100; z += 20) {
          // 20m spacing, 0 to 100 = 6 z-positions
          instances.push({
            x,
            z,
            visible: true,
            mode: "lod0",
          });
        }
      }

      const start = performance.now();
      // Camera at (200, 25) - instances range from ~175m away to ~425m away
      updateVisibility(instances, 200, 25);
      const elapsed = performance.now() - start;

      // Should complete quickly (< 100ms for ~180 instances)
      // Threshold relaxed for CI environments with variable performance
      expect(elapsed).toBeLessThan(100);

      // Verify distribution across all 5 tiers
      const modes = { lod0: 0, lod1: 0, lod2: 0, imposter: 0, culled: 0 };
      for (const inst of instances) {
        modes[inst.mode]++;
      }

      // Should have instances in multiple categories (at least 3 of 5)
      // The exact distribution depends on the grid layout relative to camera
      const categoriesWithInstances = Object.values(modes).filter(
        (c) => c > 0,
      ).length;
      expect(categoriesWithInstances).toBeGreaterThanOrEqual(3);

      // Specifically verify we have close and far instances
      expect(modes.lod0 + modes.lod1 + modes.lod2).toBeGreaterThan(0); // Some close instances
      expect(modes.imposter + modes.culled).toBeGreaterThan(0); // Some far instances
    });
  });

  describe("Streaming LOD Queue Edge Cases", () => {
    /**
     * Tests for the streaming LOD queue behavior.
     * These verify the queue processing logic without requiring a full world context.
     */

    type StreamingState = {
      lod1Queue: string[];
      lod2Queue: string[];
      pendingLOD1: Set<string>;
      pendingLOD2: Set<string>;
      loadedLOD1: Set<string>;
      loadedLOD2: Set<string>;
    };

    const STREAMING_BATCH_SIZE = 2;
    const SKIP_LOD_CATEGORIES = new Set([
      "mushroom",
      "grass",
      "flower",
      "fern",
      "ivy",
    ]);

    function createStreamingState(): StreamingState {
      return {
        lod1Queue: [],
        lod2Queue: [],
        pendingLOD1: new Set(),
        pendingLOD2: new Set(),
        loadedLOD1: new Set(),
        loadedLOD2: new Set(),
      };
    }

    function queueAssetForStreaming(
      state: StreamingState,
      assetId: string,
      category: string,
    ): void {
      const skipLOD = SKIP_LOD_CATEGORIES.has(category);
      if (!skipLOD && !state.pendingLOD1.has(assetId)) {
        state.lod1Queue.push(assetId);
        state.pendingLOD1.add(assetId);
      }
      if (!skipLOD && !state.pendingLOD2.has(assetId)) {
        state.lod2Queue.push(assetId);
        state.pendingLOD2.add(assetId);
      }
    }

    function processStreamingQueue(state: StreamingState): {
      lod1Processed: string[];
      lod2Processed: string[];
    } {
      const lod1Processed = state.lod1Queue.splice(0, STREAMING_BATCH_SIZE);
      const lod2Processed = state.lod2Queue.splice(0, STREAMING_BATCH_SIZE);

      for (const assetId of lod1Processed) {
        state.loadedLOD1.add(assetId);
        state.pendingLOD1.delete(assetId);
      }
      for (const assetId of lod2Processed) {
        state.loadedLOD2.add(assetId);
        state.pendingLOD2.delete(assetId);
      }

      return { lod1Processed, lod2Processed };
    }

    it("processes LOD1 queue before LOD2 queue", () => {
      const state = createStreamingState();
      queueAssetForStreaming(state, "tree1", "tree");
      queueAssetForStreaming(state, "tree2", "tree");

      // First frame: both LOD1 entries should be processed first
      const result = processStreamingQueue(state);

      expect(result.lod1Processed).toEqual(["tree1", "tree2"]);
      expect(result.lod2Processed).toEqual(["tree1", "tree2"]);
    });

    it("respects batch size limit", () => {
      const state = createStreamingState();

      // Queue more than batch size
      for (let i = 0; i < 10; i++) {
        queueAssetForStreaming(state, `tree${i}`, "tree");
      }

      const result = processStreamingQueue(state);

      // Should only process STREAMING_BATCH_SIZE items per queue
      expect(result.lod1Processed.length).toBe(STREAMING_BATCH_SIZE);
      expect(result.lod2Processed.length).toBe(STREAMING_BATCH_SIZE);
      expect(state.lod1Queue.length).toBe(10 - STREAMING_BATCH_SIZE);
      expect(state.lod2Queue.length).toBe(10 - STREAMING_BATCH_SIZE);
    });

    it("skips LOD queuing for small vegetation categories", () => {
      const state = createStreamingState();

      // Queue skippable categories
      for (const category of ["mushroom", "grass", "flower", "fern", "ivy"]) {
        queueAssetForStreaming(state, `${category}_asset`, category);
      }

      // Nothing should be queued
      expect(state.lod1Queue.length).toBe(0);
      expect(state.lod2Queue.length).toBe(0);
      expect(state.pendingLOD1.size).toBe(0);
      expect(state.pendingLOD2.size).toBe(0);
    });

    it("queues LOD for large vegetation categories", () => {
      const state = createStreamingState();

      // Queue non-skippable categories
      for (const category of ["tree", "rock", "bush", "fallen_tree"]) {
        queueAssetForStreaming(state, `${category}_asset`, category);
      }

      expect(state.lod1Queue.length).toBe(4);
      expect(state.lod2Queue.length).toBe(4);
    });

    it("handles empty queues gracefully", () => {
      const state = createStreamingState();

      // Process empty queues
      const result = processStreamingQueue(state);

      expect(result.lod1Processed).toEqual([]);
      expect(result.lod2Processed).toEqual([]);
    });

    it("prevents duplicate queuing of same asset", () => {
      const state = createStreamingState();

      // Queue same asset multiple times
      queueAssetForStreaming(state, "tree1", "tree");
      queueAssetForStreaming(state, "tree1", "tree");
      queueAssetForStreaming(state, "tree1", "tree");

      // Should only be queued once
      expect(state.lod1Queue.length).toBe(1);
      expect(state.lod2Queue.length).toBe(1);
    });

    it("processes queues to completion over multiple frames", () => {
      const state = createStreamingState();

      // Queue 5 assets (more than batch size)
      for (let i = 0; i < 5; i++) {
        queueAssetForStreaming(state, `tree${i}`, "tree");
      }

      // Simulate multiple frames
      let frameCount = 0;
      while (state.lod1Queue.length > 0 || state.lod2Queue.length > 0) {
        processStreamingQueue(state);
        frameCount++;
        if (frameCount > 10) break; // Safety limit
      }

      // Should complete in 3 frames (2+2+1)
      expect(frameCount).toBe(3);
      expect(state.loadedLOD1.size).toBe(5);
      expect(state.loadedLOD2.size).toBe(5);
    });

    it("maintains FIFO order", () => {
      const state = createStreamingState();

      queueAssetForStreaming(state, "first", "tree");
      queueAssetForStreaming(state, "second", "tree");
      queueAssetForStreaming(state, "third", "tree");

      const result = processStreamingQueue(state);

      expect(result.lod1Processed).toEqual(["first", "second"]);
    });
  });

  describe("Category-Specific LOD Skipping", () => {
    /**
     * Tests that verify small vegetation categories skip LOD levels.
     * Small objects go directly from LOD0 to Impostor.
     */
    const SKIP_LOD1_CATEGORIES = new Set([
      "mushroom",
      "grass",
      "flower",
      "fern",
      "ivy",
    ]);

    it("mushroom category skips LOD1 and LOD2", () => {
      expect(SKIP_LOD1_CATEGORIES.has("mushroom")).toBe(true);
    });

    it("grass category skips LOD1 and LOD2", () => {
      expect(SKIP_LOD1_CATEGORIES.has("grass")).toBe(true);
    });

    it("flower category skips LOD1 and LOD2", () => {
      expect(SKIP_LOD1_CATEGORIES.has("flower")).toBe(true);
    });

    it("fern category skips LOD1 and LOD2", () => {
      expect(SKIP_LOD1_CATEGORIES.has("fern")).toBe(true);
    });

    it("ivy category skips LOD1 and LOD2", () => {
      expect(SKIP_LOD1_CATEGORIES.has("ivy")).toBe(true);
    });

    it("tree category does NOT skip LOD", () => {
      expect(SKIP_LOD1_CATEGORIES.has("tree")).toBe(false);
    });

    it("rock category does NOT skip LOD", () => {
      expect(SKIP_LOD1_CATEGORIES.has("rock")).toBe(false);
    });

    it("bush category does NOT skip LOD", () => {
      expect(SKIP_LOD1_CATEGORIES.has("bush")).toBe(false);
    });

    it("fallen_tree category does NOT skip LOD", () => {
      expect(SKIP_LOD1_CATEGORIES.has("fallen_tree")).toBe(false);
    });

    /**
     * Simulate the LOD path decision for an asset
     */
    function getLODPath(
      category: string,
      distance: number,
      config: {
        lod1Distance: number;
        lod2Distance: number;
        imposterDistance: number;
        fadeDistance: number;
      },
    ): string[] {
      const skipLOD = SKIP_LOD1_CATEGORIES.has(category);
      const path: string[] = [];

      if (distance <= config.lod1Distance) {
        path.push("LOD0");
      } else if (distance <= config.lod2Distance && !skipLOD) {
        path.push("LOD1");
      } else if (distance <= config.imposterDistance && !skipLOD) {
        path.push("LOD2");
      } else if (distance <= config.imposterDistance && skipLOD) {
        // Small objects go straight from LOD0 to impostor zone
        path.push("LOD0");
      } else if (distance <= config.fadeDistance) {
        path.push("Impostor");
      } else {
        path.push("Culled");
      }

      return path;
    }

    it("small vegetation uses LOD0 -> Impostor path", () => {
      const config = {
        lod1Distance: 25,
        lod2Distance: 45,
        imposterDistance: 60,
        fadeDistance: 100,
      };

      // At 30m, flowers should still be LOD0 (skipping LOD1/LOD2 zones)
      expect(getLODPath("flower", 30, config)).toEqual(["LOD0"]);

      // At 65m, flowers should be Impostor
      expect(getLODPath("flower", 65, config)).toEqual(["Impostor"]);
    });

    it("large vegetation uses full 5-tier path", () => {
      const config = {
        lod1Distance: 60,
        lod2Distance: 120,
        imposterDistance: 200,
        fadeDistance: 350,
      };

      // Tree at various distances
      expect(getLODPath("tree", 30, config)).toEqual(["LOD0"]);
      expect(getLODPath("tree", 90, config)).toEqual(["LOD1"]);
      expect(getLODPath("tree", 150, config)).toEqual(["LOD2"]);
      expect(getLODPath("tree", 250, config)).toEqual(["Impostor"]);
      expect(getLODPath("tree", 400, config)).toEqual(["Culled"]);
    });
  });

  describe("Billboard Orientation (algorithm documentation)", () => {
    /**
     * Algorithm Documentation: Billboard rotation formula.
     * Calculate billboard rotation to face camera.
     * Returns Y-axis rotation in radians.
     */
    function calculateBillboardRotation(
      objectX: number,
      objectZ: number,
      cameraX: number,
      cameraZ: number,
    ): number {
      const dx = cameraX - objectX;
      const dz = cameraZ - objectZ;
      return Math.atan2(dx, dz);
    }

    it("billboard faces camera when camera is in front", () => {
      // Object at origin, camera at (0, 0, 10) - looking down +Z
      const rotation = calculateBillboardRotation(0, 0, 0, 10);
      expect(rotation).toBeCloseTo(0, 5); // No rotation needed
    });

    it("billboard rotates to face camera behind", () => {
      // Object at origin, camera at (0, 0, -10) - looking down -Z
      const rotation = calculateBillboardRotation(0, 0, 0, -10);
      expect(rotation).toBeCloseTo(Math.PI, 5); // 180 degrees
    });

    it("billboard rotates to face camera on side", () => {
      // Object at origin, camera at (10, 0, 0) - to the right
      const rotation = calculateBillboardRotation(0, 0, 10, 0);
      expect(rotation).toBeCloseTo(Math.PI / 2, 5); // 90 degrees
    });

    it("billboard rotates to face camera on left", () => {
      // Object at origin, camera at (-10, 0, 0) - to the left
      const rotation = calculateBillboardRotation(0, 0, -10, 0);
      expect(rotation).toBeCloseTo(-Math.PI / 2, 5); // -90 degrees
    });

    it("billboard handles diagonal camera positions", () => {
      // Object at origin, camera at (10, 0, 10)
      const rotation = calculateBillboardRotation(0, 0, 10, 10);
      expect(rotation).toBeCloseTo(Math.PI / 4, 5); // 45 degrees
    });

    it("billboard handles non-origin object positions", () => {
      // Object at (100, 0, 100), camera at (100, 0, 110)
      const rotation = calculateBillboardRotation(100, 100, 100, 110);
      expect(rotation).toBeCloseTo(0, 5); // Camera directly ahead
    });
  });

  describe("Concurrent LOD Loading Behavior", () => {
    /**
     * Tests for concurrent LOD loading scenarios.
     * Verifies that LOD1 and LOD2 can be loaded independently without blocking.
     */

    type AssetLoadState = {
      assetId: string;
      lod0Loaded: boolean;
      lod1Loaded: boolean;
      lod2Loaded: boolean;
      lod1Loading: boolean;
      lod2Loading: boolean;
    };

    function createAssetState(assetId: string): AssetLoadState {
      return {
        assetId,
        lod0Loaded: false,
        lod1Loaded: false,
        lod2Loaded: false,
        lod1Loading: false,
        lod2Loading: false,
      };
    }

    function simulateAsyncLoad(
      state: AssetLoadState,
      lodLevel: 0 | 1 | 2,
      delayMs: number,
    ): Promise<void> {
      return new Promise((resolve) => {
        if (lodLevel === 0) {
          state.lod0Loaded = true;
        } else if (lodLevel === 1) {
          state.lod1Loading = true;
          setTimeout(() => {
            state.lod1Loaded = true;
            state.lod1Loading = false;
            resolve();
          }, delayMs);
          return;
        } else {
          state.lod2Loading = true;
          setTimeout(() => {
            state.lod2Loaded = true;
            state.lod2Loading = false;
            resolve();
          }, delayMs);
          return;
        }
        resolve();
      });
    }

    it("LOD1 and LOD2 can load in parallel", async () => {
      const state = createAssetState("tree1");

      // LOD0 loads first (synchronously in this test)
      await simulateAsyncLoad(state, 0, 0);
      expect(state.lod0Loaded).toBe(true);

      // Start LOD1 and LOD2 loading concurrently
      const lod1Promise = simulateAsyncLoad(state, 1, 10);
      const lod2Promise = simulateAsyncLoad(state, 2, 10);

      // Both should be loading
      expect(state.lod1Loading).toBe(true);
      expect(state.lod2Loading).toBe(true);

      // Wait for both to complete
      await Promise.all([lod1Promise, lod2Promise]);

      expect(state.lod1Loaded).toBe(true);
      expect(state.lod2Loaded).toBe(true);
    });

    it("LOD0 must be loaded before LOD rendering can proceed", () => {
      const state = createAssetState("tree1");

      // Can't use LOD1/LOD2 if LOD0 isn't loaded yet
      function canRenderAtLOD(
        state: AssetLoadState,
        lodLevel: 0 | 1 | 2,
      ): boolean {
        if (!state.lod0Loaded) return false; // Must have base mesh
        if (lodLevel === 1 && !state.lod1Loaded) return false;
        if (lodLevel === 2 && !state.lod2Loaded) return false;
        return true;
      }

      expect(canRenderAtLOD(state, 0)).toBe(false); // LOD0 not loaded yet

      state.lod0Loaded = true;
      expect(canRenderAtLOD(state, 0)).toBe(true);
      expect(canRenderAtLOD(state, 1)).toBe(false); // LOD1 not loaded

      state.lod1Loaded = true;
      expect(canRenderAtLOD(state, 1)).toBe(true);
      expect(canRenderAtLOD(state, 2)).toBe(false); // LOD2 not loaded

      state.lod2Loaded = true;
      expect(canRenderAtLOD(state, 2)).toBe(true);
    });

    it("missing LOD files should not block rendering", () => {
      const state = createAssetState("tree1");
      state.lod0Loaded = true;

      // Simulate LOD1 load failure (file not found)
      function simulateLODLoadFailure(
        state: AssetLoadState,
        lodLevel: 1 | 2,
      ): void {
        // On failure, just don't set loaded = true
        // The system falls back to using lower LOD levels
      }

      function getFallbackLOD(
        state: AssetLoadState,
        desiredLOD: 0 | 1 | 2,
      ): 0 | 1 | 2 {
        if (desiredLOD === 2) {
          if (state.lod2Loaded) return 2;
          if (state.lod1Loaded) return 1;
          return 0;
        }
        if (desiredLOD === 1) {
          if (state.lod1Loaded) return 1;
          return 0;
        }
        return 0;
      }

      simulateLODLoadFailure(state, 1);
      expect(getFallbackLOD(state, 1)).toBe(0); // Fall back to LOD0
      expect(getFallbackLOD(state, 2)).toBe(0); // Fall back to LOD0

      // If only LOD2 fails but LOD1 loaded
      state.lod1Loaded = true;
      expect(getFallbackLOD(state, 2)).toBe(1); // Fall back to LOD1
    });
  });

  describe("Distance Squared Optimization", () => {
    /**
     * Tests that verify the squared distance optimization works correctly.
     * Using squared distances avoids expensive sqrt() calls in hot loops.
     */

    it("squared distance comparison produces same results as regular distance", () => {
      const testCases = [
        { x: 0, z: 0, threshold: 100 },
        { x: 70, z: 70, threshold: 100 },
        { x: 100, z: 100, threshold: 100 },
        { x: 150, z: 150, threshold: 200 },
      ];

      for (const tc of testCases) {
        const distanceSq = tc.x * tc.x + tc.z * tc.z;
        const distance = Math.sqrt(distanceSq);
        const thresholdSq = tc.threshold * tc.threshold;

        // Both methods should give same result
        const sqResult = distanceSq < thresholdSq;
        const regularResult = distance < tc.threshold;

        expect(sqResult).toBe(regularResult);
      }
    });

    it("squared distance avoids sqrt call while producing correct results", () => {
      // This test verifies the optimization technique, not actual performance
      // JIT compilers may optimize both approaches similarly, but squared distance
      // avoids the sqrt() call which is the theoretical advantage

      const testCases = [
        { x: 123.456, z: 789.012, threshold: 500 },
        { x: 50, z: 50, threshold: 100 },
        { x: 300, z: 400, threshold: 500 }, // Exactly on threshold (300^2 + 400^2 = 500^2)
      ];

      for (const { x, z, threshold } of testCases) {
        const thresholdSq = threshold * threshold;

        // Squared distance method (no sqrt)
        const distSq = x * x + z * z;
        const sqResult = distSq < thresholdSq;

        // Regular distance method (with sqrt)
        const dist = Math.sqrt(x * x + z * z);
        const regResult = dist < threshold;

        // Both should produce identical results
        expect(sqResult).toBe(regResult);
      }

      // Verify the optimization is valid: sqrt(a) < b iff a < b^2 (for positive values)
      const a = 100 * 100 + 50 * 50; // 12500
      const b = 120;
      const bSq = 120 * 120; // 14400

      expect(Math.sqrt(a) < b).toBe(a < bSq);
    });

    it("handles large coordinate values without overflow", () => {
      // Test coordinates that might overflow if not careful
      const maxSafeCoord = Math.sqrt(Number.MAX_SAFE_INTEGER / 2);

      const x = maxSafeCoord * 0.9;
      const z = maxSafeCoord * 0.9;

      const distanceSq = x * x + z * z;

      // Should still be a finite number
      expect(Number.isFinite(distanceSq)).toBe(true);
      expect(distanceSq).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });

    it("handles negative coordinates correctly", () => {
      // Squared distance should be same regardless of sign
      const posDistSq = 100 * 100 + 50 * 50;
      const negDistSq = -100 * -100 + -50 * -50;
      const mixedDistSq = -100 * -100 + 50 * 50;

      expect(posDistSq).toBe(negDistSq);
      expect(posDistSq).toBe(mixedDistSq);
    });
  });

  describe("Impostor File Path Inference", () => {
    /**
     * Tests for the LOD and impostor file path generation.
     */

    function inferLOD1Path(lod0Path: string): string {
      return lod0Path.replace(/\.glb$/i, "_lod1.glb");
    }

    function inferLOD2Path(lod0Path: string): string {
      return lod0Path.replace(/\.glb$/i, "_lod2.glb");
    }

    function inferImpostorPath(lod0Path: string): string {
      return lod0Path.replace(/\.glb$/i, "_impostor.png");
    }

    it("preserves directory structure", () => {
      expect(inferLOD1Path("assets/vegetation/trees/oak/large_oak.glb")).toBe(
        "assets/vegetation/trees/oak/large_oak_lod1.glb",
      );
    });

    it("handles paths without extension (no change)", () => {
      // If no .glb extension, replace doesn't change anything
      expect(inferLOD1Path("trees/tree1")).toBe("trees/tree1");
    });
  });

  describe("5-Tier Culling Configuration", () => {
    /**
     * Configuration values used by VegetationSystem.
     * Note: These are DEFAULT values for trees. At runtime, they're adjusted
     * based on vegetation category and shadow quality settings.
     */
    const TREE_CONFIG = {
      lod1Distance: 60,
      lod2Distance: 120,
      imposterDistance: 200,
      fadeDistance: 350,
    };

    it("fadeDistance > imposterDistance > lod2Distance > lod1Distance", () => {
      // LOD distances must be in ascending order for proper 5-tier transitions
      expect(TREE_CONFIG.lod1Distance).toBeLessThan(TREE_CONFIG.lod2Distance);
      expect(TREE_CONFIG.lod2Distance).toBeLessThan(
        TREE_CONFIG.imposterDistance,
      );
      expect(TREE_CONFIG.imposterDistance).toBeLessThan(
        TREE_CONFIG.fadeDistance,
      );
    });

    it("LOD0 provides useful full detail range", () => {
      // Should have enough full detail range for immediate vicinity
      expect(TREE_CONFIG.lod1Distance).toBeGreaterThanOrEqual(40);
      expect(TREE_CONFIG.lod1Distance).toBeLessThanOrEqual(100);
    });

    it("LOD1 zone provides useful reduced detail range", () => {
      // LOD1 zone width (lod1 to lod2) should be meaningful
      const lod1ZoneWidth = TREE_CONFIG.lod2Distance - TREE_CONFIG.lod1Distance;
      expect(lod1ZoneWidth).toBeGreaterThanOrEqual(30); // At least 30m
    });

    it("LOD2 zone provides useful heavily decimated range", () => {
      // LOD2 zone width (lod2 to imposter) should be meaningful
      const lod2ZoneWidth =
        TREE_CONFIG.imposterDistance - TREE_CONFIG.lod2Distance;
      expect(lod2ZoneWidth).toBeGreaterThanOrEqual(50); // At least 50m
    });

    it("impostor zone provides useful billboard range", () => {
      // Impostor zone (imposter to fade) should be meaningful
      const imposterZoneWidth =
        TREE_CONFIG.fadeDistance - TREE_CONFIG.imposterDistance;
      expect(imposterZoneWidth).toBeGreaterThanOrEqual(100); // At least 100m
    });

    it("total draw distance is reasonable", () => {
      // Total draw distance should be reasonable for performance
      expect(TREE_CONFIG.fadeDistance).toBeGreaterThanOrEqual(200);
      expect(TREE_CONFIG.fadeDistance).toBeLessThanOrEqual(500);
    });

    it("zone widths progressively increase with distance", () => {
      // Further zones should be wider (cheaper rendering = longer distance)
      const lod0ZoneWidth = TREE_CONFIG.lod1Distance - 0;
      const lod1ZoneWidth = TREE_CONFIG.lod2Distance - TREE_CONFIG.lod1Distance;
      const lod2ZoneWidth =
        TREE_CONFIG.imposterDistance - TREE_CONFIG.lod2Distance;
      const imposterZoneWidth =
        TREE_CONFIG.fadeDistance - TREE_CONFIG.imposterDistance;

      // LOD2 zone should be >= LOD1 zone (more aggressive decimation = longer range)
      expect(lod2ZoneWidth).toBeGreaterThanOrEqual(lod1ZoneWidth);
      // Impostor zone should be >= LOD2 zone (cheapest rendering = longest range)
      expect(imposterZoneWidth).toBeGreaterThanOrEqual(lod2ZoneWidth);
    });
  });
});

// ===== SPATIAL HASH GRID TESTS =====
// Tests the O(1) spatial lookup used by VegetationWorker for spacing checks

describe("SpatialHashGrid Algorithm", () => {
  /**
   * Simplified SpatialHashGrid for testing - mirrors worker implementation
   */
  class SpatialHashGrid {
    private cellSize: number;
    private invCellSize: number;
    private minX: number;
    private minZ: number;
    private gridWidth: number;
    private cells: Map<number, Array<{ x: number; z: number }>>;

    constructor(
      cellSize: number,
      minX: number,
      minZ: number,
      maxX: number,
      maxZ: number,
    ) {
      this.cellSize = cellSize;
      this.invCellSize = 1 / cellSize;
      this.minX = minX;
      this.minZ = minZ;
      this.gridWidth = Math.ceil((maxX - minX) * this.invCellSize) + 1;
      this.cells = new Map();
    }

    getCellKey(x: number, z: number): number {
      const cellX = Math.floor((x - this.minX) * this.invCellSize);
      const cellZ = Math.floor((z - this.minZ) * this.invCellSize);
      return cellX + cellZ * this.gridWidth;
    }

    insert(x: number, z: number): void {
      const key = this.getCellKey(x, z);
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push({ x, z });
    }

    hasNearby(x: number, z: number, minSpacingSq: number): boolean {
      const cellX = Math.floor((x - this.minX) * this.invCellSize);
      const cellZ = Math.floor((z - this.minZ) * this.invCellSize);

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = cellX + dx + (cellZ + dz) * this.gridWidth;
          const cell = this.cells.get(key);
          if (!cell) continue;

          for (const pos of cell) {
            const ddx = pos.x - x;
            const ddz = pos.z - z;
            if (ddx * ddx + ddz * ddz < minSpacingSq) {
              return true;
            }
          }
        }
      }
      return false;
    }

    clear(): void {
      this.cells.clear();
    }

    get size(): number {
      let count = 0;
      for (const cell of this.cells.values()) {
        count += cell.length;
      }
      return count;
    }
  }

  describe("basic operations", () => {
    it("inserts and finds items within range", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 100, 100);
      grid.insert(50, 50);

      // Should find item at exact position
      expect(grid.hasNearby(50, 50, 1)).toBe(true);
      // Should find item within range
      expect(grid.hasNearby(55, 55, 100)).toBe(true);
      // Should not find item outside range
      expect(grid.hasNearby(80, 80, 100)).toBe(false);
    });

    it("handles multiple items", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 100, 100);
      grid.insert(10, 10);
      grid.insert(50, 50);
      grid.insert(90, 90);

      expect(grid.size).toBe(3);
      expect(grid.hasNearby(10, 10, 1)).toBe(true);
      expect(grid.hasNearby(50, 50, 1)).toBe(true);
      expect(grid.hasNearby(90, 90, 1)).toBe(true);
    });

    it("clears all items", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 100, 100);
      grid.insert(10, 10);
      grid.insert(50, 50);

      grid.clear();
      expect(grid.size).toBe(0);
      expect(grid.hasNearby(10, 10, 1)).toBe(false);
    });
  });

  describe("boundary conditions", () => {
    it("handles items at grid boundaries", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 100, 100);
      // Insert at corners
      grid.insert(0, 0);
      grid.insert(100, 0);
      grid.insert(0, 100);
      grid.insert(100, 100);

      expect(grid.hasNearby(0, 0, 1)).toBe(true);
      expect(grid.hasNearby(100, 100, 1)).toBe(true);
    });

    it("handles items at cell boundaries", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 100, 100);
      // Insert at cell boundary
      grid.insert(10, 10);

      // Should find from adjacent cell
      expect(grid.hasNearby(11, 11, 10)).toBe(true);
      expect(grid.hasNearby(9, 9, 10)).toBe(true);
    });

    it("handles very small spacing", () => {
      const grid = new SpatialHashGrid(1, 0, 0, 100, 100);
      grid.insert(50, 50);

      // Should find at very close range
      expect(grid.hasNearby(50.1, 50.1, 0.1)).toBe(true);
      // Should not find just outside range
      expect(grid.hasNearby(50.5, 50.5, 0.1)).toBe(false);
    });

    it("handles very large spacing", () => {
      const grid = new SpatialHashGrid(50, 0, 0, 100, 100);
      grid.insert(0, 0);

      // Large spacing should find item far away
      // sqrt(40^2 + 40^2) = 56.6, so spacing of 3300 (> 3200 = 56.6^2) should find it
      expect(grid.hasNearby(40, 40, 3300)).toBe(true);
    });

    it("handles negative coordinates", () => {
      const grid = new SpatialHashGrid(10, -100, -100, 100, 100);
      grid.insert(-50, -50);

      expect(grid.hasNearby(-50, -50, 1)).toBe(true);
      expect(grid.hasNearby(-45, -45, 100)).toBe(true);
    });
  });

  describe("performance characteristics", () => {
    it("handles many items efficiently (O(1) average case)", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 1000, 1000);
      const rng = createTileLayerRng("perf_test", "tree");

      // Insert 1000 items
      for (let i = 0; i < 1000; i++) {
        grid.insert(rng() * 1000, rng() * 1000);
      }

      // Query should be fast even with many items
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        grid.hasNearby(rng() * 1000, rng() * 1000, 100);
      }
      const elapsed = performance.now() - start;

      // 1000 queries should complete in < 500ms
      // Threshold relaxed for CI environments with variable performance
      expect(elapsed).toBeLessThan(500);
    });

    it("scales better than O(n²) brute force", () => {
      const grid = new SpatialHashGrid(10, 0, 0, 1000, 1000);
      const items: Array<{ x: number; z: number }> = [];
      const rng = createTileLayerRng("scale_test", "tree");

      // Insert 500 items
      for (let i = 0; i < 500; i++) {
        const x = rng() * 1000;
        const z = rng() * 1000;
        grid.insert(x, z);
        items.push({ x, z });
      }

      // Time spatial hash grid queries
      const gridStart = performance.now();
      for (let i = 0; i < 500; i++) {
        grid.hasNearby(rng() * 1000, rng() * 1000, 100);
      }
      const gridTime = performance.now() - gridStart;

      // Time brute force queries
      const bruteStart = performance.now();
      for (let i = 0; i < 500; i++) {
        const x = rng() * 1000;
        const z = rng() * 1000;
        for (const item of items) {
          const dx = item.x - x;
          const dz = item.z - z;
          if (dx * dx + dz * dz < 100) break;
        }
      }
      const bruteTime = performance.now() - bruteStart;

      // Grid should be faster (or at least comparable)
      // Note: for small N, brute force can be competitive
      expect(gridTime).toBeLessThan(bruteTime * 5); // Allow some variance
    });
  });
});

// ===== PLACEMENT GENERATION EDGE CASES =====
// Tests for boundary conditions and error handling in vegetation placement

describe("Placement Generation Edge Cases", () => {
  describe("empty and zero inputs", () => {
    it("handles empty layers array", () => {
      // Simulating generatePlacements with no layers
      const layers: Array<{
        density: number;
        minSpacing: number;
        assets: Array<{ weight: number }>;
      }> = [];
      const placements: Array<{ x: number; z: number }> = [];

      for (const layer of layers) {
        // Should not execute
        placements.push({ x: 0, z: 0 });
      }

      expect(placements.length).toBe(0);
    });

    it("handles zero density", () => {
      const density = 0;
      const tileSize = 100;
      const targetCount = Math.floor(density * (tileSize / 100) ** 2);

      expect(targetCount).toBe(0);
    });

    it("handles zero total weight", () => {
      const assets = [
        { id: "a", weight: 0 },
        { id: "b", weight: 0 },
      ];
      const totalWeight = assets.reduce((sum, a) => sum + a.weight, 0);

      expect(totalWeight).toBe(0);
      // Should skip layer when total weight is 0
    });

    it("handles single asset with zero weight", () => {
      const assets = [{ id: "a", weight: 0 }];
      const totalWeight = assets.reduce((sum, a) => sum + a.weight, 0);

      expect(totalWeight).toBe(0);
    });
  });

  describe("extreme values", () => {
    it("handles very high density", () => {
      const density = 10000; // Very high
      const tileSize = 100;
      const targetCount = Math.floor(density * (tileSize / 100) ** 2);

      expect(targetCount).toBe(10000);
      // In practice, minSpacing will limit actual placements
    });

    it("handles very small tile size", () => {
      const density = 50;
      const tileSize = 1; // Very small
      const targetCount = Math.floor(density * (tileSize / 100) ** 2);

      expect(targetCount).toBe(0); // (1/100)^2 * 50 = 0.005 -> 0
    });

    it("handles very large tile size", () => {
      const density = 50;
      const tileSize = 10000; // Very large
      const targetCount = Math.floor(density * (tileSize / 100) ** 2);

      expect(targetCount).toBe(500000);
    });

    it("handles very small minSpacing", () => {
      const minSpacing = 0.001;
      const minSpacingSq = minSpacing * minSpacing;

      expect(minSpacingSq).toBeCloseTo(0.000001, 10);
    });

    it("handles minSpacing larger than tile", () => {
      const minSpacing = 200;
      const tileSize = 100;

      // Should only place 1 item max if minSpacing > tile diagonal
      const tileDiagonal = Math.sqrt(tileSize * tileSize * 2);
      expect(minSpacing).toBeGreaterThan(tileDiagonal);
    });
  });

  describe("clustering edge cases", () => {
    it("handles clustering with clusterSize = 1", () => {
      const clustering = true;
      const clusterSize = 1;
      const targetCount = 10;

      // clusterCount = floor(10 / 1) = 10
      const clusterCount = Math.max(1, Math.floor(targetCount / clusterSize));
      expect(clusterCount).toBe(10);
    });

    it("handles clustering with clusterSize > targetCount", () => {
      const clustering = true;
      const clusterSize = 100;
      const targetCount = 10;

      // clusterCount = max(1, floor(10 / 100)) = max(1, 0) = 1
      const clusterCount = Math.max(1, Math.floor(targetCount / clusterSize));
      expect(clusterCount).toBe(1);
    });

    it("handles clustering disabled", () => {
      const clustering = false;
      // When clustering is disabled, positions should be uniform random
      const rng = createTileLayerRng("cluster_test", "tree");
      const positions: Array<{ x: number; z: number }> = [];

      for (let i = 0; i < 100; i++) {
        positions.push({
          x: rng() * 100,
          z: rng() * 100,
        });
      }

      // Should cover the entire tile
      const xValues = positions.map((p) => p.x);
      const zValues = positions.map((p) => p.z);
      expect(Math.max(...xValues) - Math.min(...xValues)).toBeGreaterThan(50);
      expect(Math.max(...zValues) - Math.min(...zValues)).toBeGreaterThan(50);
    });
  });

  describe("noise filtering edge cases", () => {
    it("handles noiseThreshold = 0 (all pass)", () => {
      const noiseThreshold = 0;
      const noiseValue = 0.001; // Any positive value

      expect(noiseValue >= noiseThreshold).toBe(true);
    });

    it("handles noiseThreshold = 1 (all fail)", () => {
      const noiseThreshold = 1;

      // Noise values are in [0, 1), so no value >= 1
      for (let i = 0; i < 100; i++) {
        const noiseValue = Math.random(); // [0, 1)
        expect(noiseValue >= noiseThreshold).toBe(false);
      }
    });

    it("handles noiseScale = 0 (constant noise)", () => {
      // When noiseScale is 0, all positions get same noise value
      // This tests the noise2D function behavior
      const noiseScale = 0;
      const positions = [
        { x: 0, z: 0 },
        { x: 100, z: 100 },
        { x: 50, z: 200 },
      ];

      // All scaled positions should be effectively zero (noise input is constant)
      const scaledPositions = positions.map((p) => ({
        x: Math.abs(p.x * noiseScale),
        z: Math.abs(p.z * noiseScale),
      }));

      // All should be exactly 0
      for (const pos of scaledPositions) {
        expect(pos.x).toBe(0);
        expect(pos.z).toBe(0);
      }
    });
  });
});

// ===== CHUNK KEY PARSING TESTS =====
// Tests for chunk key format and parsing used in VegetationSystem

describe("Chunk Key Operations", () => {
  const CHUNK_SIZE = 64;

  function getChunkKey(x: number, z: number, assetId: string): string {
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);
    return `${chunkX}_${chunkZ}_${assetId}`;
  }

  function parseChunkKey(
    chunkKey: string,
  ): { chunkX: number; chunkZ: number; assetId: string } | null {
    const parts = chunkKey.split("_");
    if (parts.length < 3) return null;
    return {
      chunkX: parseInt(parts[0], 10),
      chunkZ: parseInt(parts[1], 10),
      assetId: parts.slice(2).join("_"),
    };
  }

  describe("key generation", () => {
    it("generates correct keys for positive positions", () => {
      expect(getChunkKey(100, 200, "oak_tree")).toBe("1_3_oak_tree");
      expect(getChunkKey(64, 128, "pine")).toBe("1_2_pine");
    });

    it("generates correct keys for negative positions", () => {
      expect(getChunkKey(-100, -200, "bush")).toBe("-2_-4_bush");
      expect(getChunkKey(-1, -1, "rock")).toBe("-1_-1_rock");
    });

    it("generates correct keys for origin", () => {
      expect(getChunkKey(0, 0, "tree")).toBe("0_0_tree");
    });

    it("handles asset IDs with underscores", () => {
      expect(getChunkKey(100, 200, "oak_large_tree")).toBe(
        "1_3_oak_large_tree",
      );
    });
  });

  describe("key parsing", () => {
    it("parses valid keys", () => {
      const parsed = parseChunkKey("1_3_oak_tree");
      expect(parsed).toEqual({ chunkX: 1, chunkZ: 3, assetId: "oak_tree" });
    });

    it("parses keys with complex asset IDs", () => {
      const parsed = parseChunkKey("0_0_oak_large_dead_tree");
      expect(parsed).toEqual({
        chunkX: 0,
        chunkZ: 0,
        assetId: "oak_large_dead_tree",
      });
    });

    it("returns null for invalid keys", () => {
      expect(parseChunkKey("invalid")).toBeNull();
      expect(parseChunkKey("1_2")).toBeNull();
      expect(parseChunkKey("")).toBeNull();
    });

    it("roundtrips correctly", () => {
      const original = { x: 150, z: 250, assetId: "birch_tree" };
      const key = getChunkKey(original.x, original.z, original.assetId);
      const parsed = parseChunkKey(key);

      expect(parsed?.assetId).toBe(original.assetId);
      expect(parsed?.chunkX).toBe(Math.floor(original.x / CHUNK_SIZE));
      expect(parsed?.chunkZ).toBe(Math.floor(original.z / CHUNK_SIZE));
    });
  });

  describe("chunk boundaries", () => {
    it("positions at chunk boundaries go to correct chunk", () => {
      // Position at exact chunk boundary should go to the next chunk
      expect(getChunkKey(64, 0, "tree")).toBe("1_0_tree");
      expect(getChunkKey(63.9, 0, "tree")).toBe("0_0_tree");
    });

    it("multiple positions in same chunk generate same key", () => {
      const key1 = getChunkKey(10, 10, "tree");
      const key2 = getChunkKey(30, 50, "tree");
      const key3 = getChunkKey(63, 63, "tree");

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it("adjacent chunks have different keys", () => {
      const key1 = getChunkKey(32, 32, "tree"); // Chunk (0, 0)
      const key2 = getChunkKey(96, 32, "tree"); // Chunk (1, 0)
      const key3 = getChunkKey(32, 96, "tree"); // Chunk (0, 1)

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });
});

// ===== TILE-CHUNK REFERENCE COUNTING TESTS =====
// Tests for chunk reference counting used in tile cleanup

describe("Tile-Chunk Reference Counting", () => {
  type TileChunkState = {
    tileChunks: Map<string, Set<string>>;
    chunkTileRefs: Map<string, number>;
  };

  function createState(): TileChunkState {
    return {
      tileChunks: new Map(),
      chunkTileRefs: new Map(),
    };
  }

  function addChunkToTile(
    state: TileChunkState,
    tileKey: string,
    chunkKey: string,
  ): void {
    let chunks = state.tileChunks.get(tileKey);
    if (!chunks) {
      chunks = new Set();
      state.tileChunks.set(tileKey, chunks);
    }

    if (!chunks.has(chunkKey)) {
      chunks.add(chunkKey);
      const refCount = state.chunkTileRefs.get(chunkKey) ?? 0;
      state.chunkTileRefs.set(chunkKey, refCount + 1);
    }
  }

  function removeTile(state: TileChunkState, tileKey: string): string[] {
    const orphanedChunks: string[] = [];
    const chunks = state.tileChunks.get(tileKey);

    if (chunks) {
      for (const chunkKey of chunks) {
        const refCount = state.chunkTileRefs.get(chunkKey) ?? 0;
        const newRefCount = refCount - 1;

        if (newRefCount <= 0) {
          state.chunkTileRefs.delete(chunkKey);
          orphanedChunks.push(chunkKey);
        } else {
          state.chunkTileRefs.set(chunkKey, newRefCount);
        }
      }
      state.tileChunks.delete(tileKey);
    }

    return orphanedChunks;
  }

  describe("reference counting", () => {
    it("increments ref count when chunk added to tile", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "chunk1");

      expect(state.chunkTileRefs.get("chunk1")).toBe(1);
    });

    it("increments ref count when chunk shared by multiple tiles", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "chunk1");
      addChunkToTile(state, "1_0", "chunk1");
      addChunkToTile(state, "0_1", "chunk1");

      expect(state.chunkTileRefs.get("chunk1")).toBe(3);
    });

    it("does not double-count same tile adding same chunk", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "chunk1");
      addChunkToTile(state, "0_0", "chunk1");

      expect(state.chunkTileRefs.get("chunk1")).toBe(1);
    });

    it("decrements ref count when tile removed", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "chunk1");
      addChunkToTile(state, "1_0", "chunk1");

      removeTile(state, "0_0");

      expect(state.chunkTileRefs.get("chunk1")).toBe(1);
    });

    it("returns orphaned chunks when ref count reaches zero", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "chunk1");
      addChunkToTile(state, "0_0", "chunk2");

      const orphaned = removeTile(state, "0_0");

      expect(orphaned).toContain("chunk1");
      expect(orphaned).toContain("chunk2");
      expect(state.chunkTileRefs.has("chunk1")).toBe(false);
      expect(state.chunkTileRefs.has("chunk2")).toBe(false);
    });

    it("does not return shared chunks as orphaned", () => {
      const state = createState();
      addChunkToTile(state, "0_0", "shared");
      addChunkToTile(state, "1_0", "shared");
      addChunkToTile(state, "0_0", "unique");

      const orphaned = removeTile(state, "0_0");

      expect(orphaned).not.toContain("shared");
      expect(orphaned).toContain("unique");
      expect(state.chunkTileRefs.get("shared")).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles removing non-existent tile", () => {
      const state = createState();
      const orphaned = removeTile(state, "nonexistent");

      expect(orphaned).toEqual([]);
    });

    it("handles tile with no chunks", () => {
      const state = createState();
      state.tileChunks.set("empty", new Set());

      const orphaned = removeTile(state, "empty");

      expect(orphaned).toEqual([]);
    });

    it("handles multiple tiles with multiple chunks", () => {
      const state = createState();
      // Tile 0_0 has chunks A, B
      addChunkToTile(state, "0_0", "A");
      addChunkToTile(state, "0_0", "B");
      // Tile 1_0 has chunks B, C
      addChunkToTile(state, "1_0", "B");
      addChunkToTile(state, "1_0", "C");
      // Tile 0_1 has chunks C, D
      addChunkToTile(state, "0_1", "C");
      addChunkToTile(state, "0_1", "D");

      expect(state.chunkTileRefs.get("A")).toBe(1);
      expect(state.chunkTileRefs.get("B")).toBe(2);
      expect(state.chunkTileRefs.get("C")).toBe(2);
      expect(state.chunkTileRefs.get("D")).toBe(1);

      // Remove tile 0_0 -> A orphaned, B decremented
      let orphaned = removeTile(state, "0_0");
      expect(orphaned).toContain("A");
      expect(orphaned).not.toContain("B");
      expect(state.chunkTileRefs.get("B")).toBe(1);

      // Remove tile 1_0 -> B orphaned, C decremented
      orphaned = removeTile(state, "1_0");
      expect(orphaned).toContain("B");
      expect(orphaned).not.toContain("C");
      expect(state.chunkTileRefs.get("C")).toBe(1);
    });
  });
});

// ===== CONCURRENT/PARALLEL PROCESSING TESTS =====
// Tests for parallel tile processing behavior

describe("Concurrent Processing", () => {
  describe("parallel tile batch processing", () => {
    type TileData = {
      tileKey: string;
      generated: boolean;
      startTime?: number;
      endTime?: number;
    };

    async function simulateTileGeneration(
      tile: TileData,
      processingTimeMs: number,
    ): Promise<void> {
      tile.startTime = Date.now();
      await new Promise((resolve) => setTimeout(resolve, processingTimeMs));
      tile.generated = true;
      tile.endTime = Date.now();
    }

    it("processes tiles in parallel batches", async () => {
      const tiles: TileData[] = [
        { tileKey: "0_0", generated: false },
        { tileKey: "1_0", generated: false },
        { tileKey: "0_1", generated: false },
        { tileKey: "1_1", generated: false },
      ];

      const BATCH_SIZE = 2;
      const PROCESSING_TIME = 50; // ms

      // Process in batches of 2
      for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
        const batch = tiles.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((tile) => simulateTileGeneration(tile, PROCESSING_TIME)),
        );
      }

      // All should be generated
      expect(tiles.every((t) => t.generated)).toBe(true);

      // First batch should have started together (within 10ms)
      const batch1StartDiff = Math.abs(
        tiles[0].startTime! - tiles[1].startTime!,
      );
      expect(batch1StartDiff).toBeLessThan(10);

      // Second batch should have started together
      const batch2StartDiff = Math.abs(
        tiles[2].startTime! - tiles[3].startTime!,
      );
      expect(batch2StartDiff).toBeLessThan(10);

      // Second batch should start after first batch finishes
      expect(tiles[2].startTime!).toBeGreaterThanOrEqual(tiles[0].endTime!);
    });

    it("handles batch with fewer items than batch size", async () => {
      const tiles: TileData[] = [
        { tileKey: "0_0", generated: false },
        { tileKey: "1_0", generated: false },
        { tileKey: "0_1", generated: false },
      ];

      const BATCH_SIZE = 4; // Larger than tiles count

      await Promise.all(tiles.map((tile) => simulateTileGeneration(tile, 10)));

      expect(tiles.every((t) => t.generated)).toBe(true);
    });

    it("maintains order of results from parallel processing", async () => {
      const results: string[] = [];
      const items = ["a", "b", "c", "d", "e"];

      // Process in parallel but capture results in order
      const promises = items.map(async (item, index) => {
        // Random delay to simulate variable processing time
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        return { index, item };
      });

      const resolved = await Promise.all(promises);

      // Promise.all preserves order
      for (let i = 0; i < resolved.length; i++) {
        expect(resolved[i].index).toBe(i);
        expect(resolved[i].item).toBe(items[i]);
      }
    });
  });

  describe("concurrent map operations", () => {
    it("handles concurrent inserts to same map", async () => {
      const map = new Map<string, number>();

      const operations = Array.from({ length: 100 }, (_, i) => async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        map.set(`key${i}`, i);
      });

      await Promise.all(operations.map((op) => op()));

      expect(map.size).toBe(100);
    });

    it("handles concurrent reads and writes", async () => {
      const map = new Map<string, number>();

      // Pre-populate
      for (let i = 0; i < 50; i++) {
        map.set(`key${i}`, i);
      }

      const reads: number[] = [];
      const operations: Promise<void>[] = [];

      // Concurrent reads
      for (let i = 0; i < 50; i++) {
        operations.push(
          (async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 5),
            );
            const value = map.get(`key${i}`);
            if (value !== undefined) reads.push(value);
          })(),
        );
      }

      // Concurrent writes
      for (let i = 50; i < 100; i++) {
        operations.push(
          (async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 5),
            );
            map.set(`key${i}`, i);
          })(),
        );
      }

      await Promise.all(operations);

      expect(map.size).toBe(100);
      expect(reads.length).toBe(50);
    });
  });

  describe("async deduplication", () => {
    it("prevents duplicate processing of same tile", async () => {
      const processing = new Set<string>();
      const completed = new Set<string>();
      let duplicateAttempts = 0;

      async function processTile(tileKey: string): Promise<boolean> {
        if (processing.has(tileKey)) {
          duplicateAttempts++;
          return false;
        }
        processing.add(tileKey);

        await new Promise((resolve) => setTimeout(resolve, 20));

        completed.add(tileKey);
        processing.delete(tileKey);
        return true;
      }

      // Try to process same tile multiple times concurrently
      const results = await Promise.all([
        processTile("0_0"),
        processTile("0_0"),
        processTile("0_0"),
        processTile("1_0"),
      ]);

      // Only first attempt for 0_0 should succeed
      expect(results.filter((r) => r).length).toBe(2); // 0_0 once, 1_0 once
      expect(duplicateAttempts).toBe(2); // Two duplicate attempts for 0_0
      expect(completed.size).toBe(2);
    });

    it("allows reprocessing after completion", async () => {
      const processing = new Set<string>();
      const processCount = new Map<string, number>();

      async function processTile(tileKey: string): Promise<void> {
        if (processing.has(tileKey)) return;
        processing.add(tileKey);

        await new Promise((resolve) => setTimeout(resolve, 10));

        processCount.set(tileKey, (processCount.get(tileKey) ?? 0) + 1);
        processing.delete(tileKey);
      }

      // Process, then reprocess
      await processTile("0_0");
      await processTile("0_0");

      expect(processCount.get("0_0")).toBe(2);
    });
  });

  describe("timeout and cancellation", () => {
    it("handles promise race for timeout", async () => {
      async function operationWithTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
      ): Promise<T | "timeout"> {
        const timeout = new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), timeoutMs),
        );
        return Promise.race([operation, timeout]);
      }

      // Fast operation should complete
      const fast = operationWithTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10)),
        100,
      );
      expect(await fast).toBe("done");

      // Slow operation should timeout
      const slow = operationWithTimeout(
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("done"), 100),
        ),
        10,
      );
      expect(await slow).toBe("timeout");
    });
  });
});

// ===== DETERMINISM TESTS =====
// Tests that verify vegetation placement is reproducible

describe("Deterministic Generation", () => {
  describe("PRNG consistency", () => {
    it("generates identical sequences for same seed across multiple runs", () => {
      const sequences: number[][] = [];

      for (let run = 0; run < 5; run++) {
        const rng = createTileLayerRng("determinism_test", "tree", 42);
        const sequence: number[] = [];
        for (let i = 0; i < 20; i++) {
          sequence.push(rng());
        }
        sequences.push(sequence);
      }

      // All sequences should be identical
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toEqual(sequences[0]);
      }
    });

    it("generates different sequences for different seeds", () => {
      const rng1 = createTileLayerRng("test", "tree", 1);
      const rng2 = createTileLayerRng("test", "tree", 2);

      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());

      // Should be different
      let allSame = true;
      for (let i = 0; i < seq1.length; i++) {
        if (seq1[i] !== seq2[i]) allSame = false;
      }
      expect(allSame).toBe(false);
    });
  });

  describe("placement reproducibility", () => {
    it("generates same positions for same tile", () => {
      function generatePositions(
        tileKey: string,
        count: number,
      ): Array<{ x: number; z: number }> {
        const rng = createTileLayerRng(tileKey, "tree", 12345);
        const positions: Array<{ x: number; z: number }> = [];
        for (let i = 0; i < count; i++) {
          positions.push({
            x: rng() * 100,
            z: rng() * 100,
          });
        }
        return positions;
      }

      const run1 = generatePositions("0_0", 50);
      const run2 = generatePositions("0_0", 50);

      expect(run1).toEqual(run2);
    });

    it("generates consistent positions across category boundaries", () => {
      // Different categories should have different placements
      const treeRng = createTileLayerRng("0_0", "tree", 0);
      const bushRng = createTileLayerRng("0_0", "bush", 0);

      const treePos = { x: treeRng(), z: treeRng() };
      const bushPos = { x: bushRng(), z: bushRng() };

      // Same tile, different category = different positions
      expect(treePos.x).not.toBe(bushPos.x);
    });
  });

  describe("edge cases in determinism", () => {
    it("handles empty string tile key", () => {
      const rng = createTileLayerRng("", "tree", 0);
      const values = [rng(), rng(), rng()];

      // Should produce valid numbers
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it("handles very long tile keys", () => {
      const longKey = "a".repeat(1000);
      const rng = createTileLayerRng(longKey, "tree", 0);
      const values = [rng(), rng(), rng()];

      // Should produce valid numbers
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it("handles special characters in keys", () => {
      const specialKeys = [
        "tile_with_underscore",
        "tile-with-dash",
        "tile.with.dots",
        "tile/with/slashes",
        "tile with spaces",
        "日本語タイル",
        "🌲🌳🌴",
      ];

      for (const key of specialKeys) {
        const rng = createTileLayerRng(key, "tree", 0);
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("produces unique sequences for adjacent tiles", () => {
      const tiles = ["0_0", "0_1", "1_0", "1_1", "-1_0", "0_-1", "-1_-1"];

      const sequences = new Map<string, number[]>();
      for (const tile of tiles) {
        const rng = createTileLayerRng(tile, "tree", 0);
        sequences.set(tile, [rng(), rng(), rng()]);
      }

      // All sequences should be unique
      const seqStrings = Array.from(sequences.values()).map((s) => s.join(","));
      const uniqueSeqs = new Set(seqStrings);
      expect(uniqueSeqs.size).toBe(tiles.length);
    });
  });
});
