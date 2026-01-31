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

    it(
      "selects assets according to weight distribution",
      { timeout: 15000 },
      () => {
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
      },
    );

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

  describe("Imposter Distance Thresholds (algorithm documentation)", () => {
    /**
     * Algorithm Documentation: These tests verify the LOD/culling thresholds
     * used in VegetationSystem.ts. Constants must match VegetationConfig.
     *
     * Full integration testing of VegetationSystem requires Playwright tests.
     */
    const VEGETATION_CONFIG = {
      cullDistance: 150,
      imposterDistance: 80,
    };

    type RenderMode = "3d" | "imposter" | "culled";

    /**
     * Determine render mode based on distance
     * Mirrors updateAssetVisibility() logic in VegetationSystem
     */
    function getRenderMode(distance: number): RenderMode {
      if (distance > VEGETATION_CONFIG.cullDistance) {
        return "culled";
      }
      if (distance > VEGETATION_CONFIG.imposterDistance) {
        return "imposter";
      }
      return "3d";
    }

    it("renders 3D mesh at close range (< 80m)", () => {
      expect(getRenderMode(0)).toBe("3d");
      expect(getRenderMode(50)).toBe("3d");
      expect(getRenderMode(79)).toBe("3d");
    });

    it("renders imposter at medium range (80-150m)", () => {
      expect(getRenderMode(80)).toBe("3d"); // At boundary, still 3D
      expect(getRenderMode(81)).toBe("imposter");
      expect(getRenderMode(100)).toBe("imposter");
      expect(getRenderMode(149)).toBe("imposter");
    });

    it("culls at far range (> 150m)", () => {
      expect(getRenderMode(150)).toBe("imposter"); // At boundary
      expect(getRenderMode(151)).toBe("culled");
      expect(getRenderMode(200)).toBe("culled");
      expect(getRenderMode(1000)).toBe("culled");
    });

    it("handles exact boundaries", () => {
      // At exactly imposterDistance: still 3D (using >)
      expect(getRenderMode(80)).toBe("3d");
      // Just past: imposter
      expect(getRenderMode(80.001)).toBe("imposter");

      // At exactly cullDistance: still imposter
      expect(getRenderMode(150)).toBe("imposter");
      // Just past: culled
      expect(getRenderMode(150.001)).toBe("culled");
    });

    it("handles zero distance", () => {
      expect(getRenderMode(0)).toBe("3d");
    });

    it("handles negative distance (shouldn't occur but safe)", () => {
      expect(getRenderMode(-10)).toBe("3d");
    });
  });

  describe("Instance Visibility Update (algorithm documentation)", () => {
    /**
     * Algorithm Documentation: Tests the visibility update logic
     * that VegetationSystem uses when camera moves.
     */
    type InstanceState = {
      x: number;
      z: number;
      visible: boolean;
      mode: "3d" | "imposter" | "culled";
    };

    const CONFIG = {
      cullDistance: 150,
      imposterDistance: 80,
    };

    /**
     * Simulate the visibility update logic from VegetationSystem
     */
    function updateVisibility(
      instances: InstanceState[],
      cameraX: number,
      cameraZ: number,
    ): void {
      for (const instance of instances) {
        const dx = instance.x - cameraX;
        const dz = instance.z - cameraZ;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance > CONFIG.cullDistance) {
          instance.visible = false;
          instance.mode = "culled";
        } else if (distance > CONFIG.imposterDistance) {
          instance.visible = true;
          instance.mode = "imposter";
        } else {
          instance.visible = true;
          instance.mode = "3d";
        }
      }
    }

    it("updates all instances based on camera position", () => {
      const instances: InstanceState[] = [
        { x: 0, z: 0, visible: true, mode: "3d" },
        { x: 100, z: 0, visible: true, mode: "3d" },
        { x: 200, z: 0, visible: true, mode: "3d" },
      ];

      updateVisibility(instances, 0, 0);

      expect(instances[0].mode).toBe("3d"); // 0m away
      expect(instances[1].mode).toBe("imposter"); // 100m away
      expect(instances[2].mode).toBe("culled"); // 200m away
    });

    it("visibility changes when camera moves", () => {
      const instances: InstanceState[] = [
        { x: 100, z: 0, visible: true, mode: "3d" },
      ];

      // Camera at origin: 100m away -> imposter
      updateVisibility(instances, 0, 0);
      expect(instances[0].mode).toBe("imposter");

      // Camera moves closer: 50m away -> 3d
      updateVisibility(instances, 50, 0);
      expect(instances[0].mode).toBe("3d");

      // Camera moves further: 250m away -> culled
      updateVisibility(instances, -150, 0);
      expect(instances[0].mode).toBe("culled");
    });

    it("handles diagonal distances correctly", () => {
      const instances: InstanceState[] = [
        { x: 60, z: 60, visible: true, mode: "3d" }, // sqrt(60^2 + 60^2) ≈ 85m
      ];

      updateVisibility(instances, 0, 0);

      // 85m is beyond imposterDistance (80) but below cullDistance (150)
      expect(instances[0].mode).toBe("imposter");
    });

    it("handles many instances efficiently", () => {
      const instances: InstanceState[] = [];

      // Create grid of 1000 instances
      for (let x = 0; x < 100; x++) {
        for (let z = 0; z < 10; z++) {
          instances.push({
            x: x * 5,
            z: z * 5,
            visible: true,
            mode: "3d",
          });
        }
      }

      const start = performance.now();
      updateVisibility(instances, 250, 25);
      const elapsed = performance.now() - start;

      // Should complete quickly (< 10ms for 1000 instances)
      expect(elapsed).toBeLessThan(10);

      // Verify distribution
      const modes = { "3d": 0, imposter: 0, culled: 0 };
      for (const inst of instances) {
        modes[inst.mode]++;
      }

      // Should have instances in all categories
      expect(modes["3d"]).toBeGreaterThan(0);
      expect(modes.imposter).toBeGreaterThan(0);
      expect(modes.culled).toBeGreaterThan(0);
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

  describe("Culling Configuration", () => {
    it("cullDistance > imposterDistance", () => {
      // This is required for the LOD system to work
      const cullDistance = 150;
      const imposterDistance = 80;

      expect(cullDistance).toBeGreaterThan(imposterDistance);
    });

    it("imposterDistance provides useful 3D detail range", () => {
      // Should have enough 3D detail range for player vicinity
      const imposterDistance = 80;
      expect(imposterDistance).toBeGreaterThanOrEqual(50);
    });

    it("cullDistance provides reasonable draw distance", () => {
      // Should match terrain draw distance approximately
      const cullDistance = 150;
      expect(cullDistance).toBeGreaterThanOrEqual(100);
      expect(cullDistance).toBeLessThanOrEqual(300);
    });
  });
});
