/**
 * Tests grass position generation algorithm (copy from GrassSystem).
 * TSL material tests require Playwright.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

interface GrassGenerationParams {
  tileX: number;
  tileZ: number;
  tileSize: number;
  targetCount: number;
  waterThreshold: number;
  maxSlope: number;
  getHeightAt: (x: number, z: number) => number;
  calculateSlope: (x: number, z: number) => number;
  rng: () => number;
}

function generateGrassPositions(params: GrassGenerationParams): number[] {
  const {
    tileX,
    tileZ,
    tileSize,
    targetCount,
    waterThreshold,
    maxSlope,
    getHeightAt,
    calculateSlope,
    rng,
  } = params;

  const positions: number[] = [];

  for (let i = 0; i < targetCount; i++) {
    const localX = (rng() - 0.5) * tileSize * 0.95;
    const localZ = (rng() - 0.5) * tileSize * 0.95;
    const worldX = tileX * tileSize + localX;
    const worldZ = tileZ * tileSize + localZ;
    const height = getHeightAt(worldX, worldZ);

    if (height < waterThreshold) continue;
    const slope = calculateSlope(worldX, worldZ);
    if (slope > maxSlope) continue;

    positions.push(worldX, height + 0.02, worldZ);
  }

  return positions;
}

function calculateGrassDensity(
  biome: string,
  baseDensity: number = 0.3,
): number {
  const densityMul = biome === "plains" ? 1.2 : biome === "forest" ? 0.8 : 1.0;
  return baseDensity * densityMul;
}

function calculateTargetCount(
  tileSize: number,
  density: number,
  maxCount: number = 3000,
): number {
  return Math.min(maxCount, Math.floor(tileSize * tileSize * density));
}

// Deterministic RNG for testing
function createSeededRng(seed: number = 12345): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe("GrassSystem Position Generation", () => {
  describe("generateGrassPositions", () => {
    it("filters positions below water threshold", () => {
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 100,
        waterThreshold: 5,
        maxSlope: 1.0,
        getHeightAt: () => 0, // All underwater
        calculateSlope: () => 0,
        rng: createSeededRng(),
      });

      expect(positions.length).toBe(0);
    });

    it("filters positions on steep slopes", () => {
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 100,
        waterThreshold: 0,
        maxSlope: 0.6,
        getHeightAt: () => 10,
        calculateSlope: () => 0.8, // Too steep
        rng: createSeededRng(),
      });

      expect(positions.length).toBe(0);
    });

    it("generates positions on valid terrain", () => {
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 100,
        waterThreshold: 0,
        maxSlope: 0.6,
        getHeightAt: () => 10,
        calculateSlope: () => 0.3, // Gentle slope
        rng: createSeededRng(),
      });

      expect(positions.length).toBeGreaterThan(0);
      expect(positions.length % 3).toBe(0); // Groups of 3 (x, y, z)
    });

    it("positions are in groups of 3", () => {
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 50,
        waterThreshold: 0,
        maxSlope: 1.0,
        getHeightAt: () => 10,
        calculateSlope: () => 0,
        rng: createSeededRng(),
      });

      expect(positions.length % 3).toBe(0);
    });

    it("Y position is height + 0.02 offset", () => {
      const testHeight = 15;
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 10,
        waterThreshold: 0,
        maxSlope: 1.0,
        getHeightAt: () => testHeight,
        calculateSlope: () => 0,
        rng: createSeededRng(),
      });

      // Check Y values (every 3rd element starting at index 1)
      for (let i = 1; i < positions.length; i += 3) {
        expect(positions[i]).toBeCloseTo(testHeight + 0.02, 4);
      }
    });

    it("positions stay within tile bounds (with 0.95 margin)", () => {
      const tileSize = 100;
      const halfSize = (tileSize * 0.95) / 2;

      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize,
        targetCount: 100,
        waterThreshold: 0,
        maxSlope: 1.0,
        getHeightAt: () => 10,
        calculateSlope: () => 0,
        rng: createSeededRng(),
      });

      // Check X values (index 0, 3, 6, ...)
      for (let i = 0; i < positions.length; i += 3) {
        expect(Math.abs(positions[i])).toBeLessThanOrEqual(halfSize);
      }

      // Check Z values (index 2, 5, 8, ...)
      for (let i = 2; i < positions.length; i += 3) {
        expect(Math.abs(positions[i])).toBeLessThanOrEqual(halfSize);
      }
    });

    it("handles mixed terrain (some valid, some invalid)", () => {
      const positions = generateGrassPositions({
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 100,
        waterThreshold: 5,
        maxSlope: 0.6,
        getHeightAt: (x) => (x > 0 ? 10 : 0), // Right half above water
        calculateSlope: (x) => (x > 25 ? 0.8 : 0.3), // Far right too steep
        rng: createSeededRng(),
      });

      // Should have some but not all positions
      expect(positions.length).toBeGreaterThan(0);
      expect(positions.length / 3).toBeLessThan(100);
    });

    it("deterministic RNG produces same results", () => {
      const params: Omit<GrassGenerationParams, "rng"> = {
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 50,
        waterThreshold: 0,
        maxSlope: 1.0,
        getHeightAt: () => 10,
        calculateSlope: () => 0,
      };

      const positions1 = generateGrassPositions({
        ...params,
        rng: createSeededRng(42),
      });
      const positions2 = generateGrassPositions({
        ...params,
        rng: createSeededRng(42),
      });

      expect(positions1).toEqual(positions2);
    });

    it("different seeds produce different positions", () => {
      const params: Omit<GrassGenerationParams, "rng"> = {
        tileX: 0,
        tileZ: 0,
        tileSize: 100,
        targetCount: 50,
        waterThreshold: 0,
        maxSlope: 1.0,
        getHeightAt: () => 10,
        calculateSlope: () => 0,
      };

      const positions1 = generateGrassPositions({
        ...params,
        rng: createSeededRng(42),
      });
      const positions2 = generateGrassPositions({
        ...params,
        rng: createSeededRng(43),
      });

      expect(positions1).not.toEqual(positions2);
    });
  });

  describe("calculateGrassDensity", () => {
    it("plains biome has 1.2x density", () => {
      const density = calculateGrassDensity("plains");
      expect(density).toBeCloseTo(0.3 * 1.2, 4);
    });

    it("forest biome has 0.8x density", () => {
      const density = calculateGrassDensity("forest");
      expect(density).toBeCloseTo(0.3 * 0.8, 4);
    });

    it("unknown biome has 1.0x density", () => {
      const density = calculateGrassDensity("unknown");
      expect(density).toBeCloseTo(0.3, 4);
    });

    it("desert biome has default density", () => {
      const density = calculateGrassDensity("desert");
      expect(density).toBeCloseTo(0.3, 4);
    });
  });

  describe("calculateTargetCount", () => {
    it("caps at maxCount for large tiles", () => {
      const count = calculateTargetCount(200, 0.5);
      expect(count).toBe(3000);
    });

    it("returns area * density for small tiles", () => {
      const count = calculateTargetCount(50, 0.3);
      expect(count).toBe(750);
    });

    it("custom maxCount works", () => {
      const count = calculateTargetCount(200, 0.5, 1000);
      expect(count).toBe(1000);
    });
  });
});

describe("Grass Instance Matrix Generation", () => {
  it("creates valid matrices from positions", () => {
    const positions = [10, 5, 20, -15, 8, 30];
    const count = positions.length / 3;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      position.set(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      matrix.compose(position, quaternion, scale);
      matrices.push(matrix.clone());
    }

    expect(matrices.length).toBe(2);

    // First matrix should have position (10, 5, 20)
    const pos1 = new THREE.Vector3();
    pos1.setFromMatrixPosition(matrices[0]);
    expect(pos1.x).toBe(10);
    expect(pos1.y).toBe(5);
    expect(pos1.z).toBe(20);

    // Second matrix should have position (-15, 8, 30)
    const pos2 = new THREE.Vector3();
    pos2.setFromMatrixPosition(matrices[1]);
    expect(pos2.x).toBe(-15);
    expect(pos2.y).toBe(8);
    expect(pos2.z).toBe(30);
  });
});

describe("Grass time accumulation", () => {
  it("accumulates time correctly", () => {
    let time = 0;
    const dt = 1 / 60;

    for (let i = 0; i < 120; i++) {
      time += dt;
    }

    expect(time).toBeCloseTo(2.0, 2);
  });
});

describe("Edge cases", () => {
  it("handles tile at origin", () => {
    const positions = generateGrassPositions({
      tileX: 0,
      tileZ: 0,
      tileSize: 100,
      targetCount: 10,
      waterThreshold: 0,
      maxSlope: 1.0,
      getHeightAt: () => 10,
      calculateSlope: () => 0,
      rng: createSeededRng(),
    });

    expect(positions.length).toBeGreaterThan(0);
  });

  it("handles negative tile coordinates", () => {
    const positions = generateGrassPositions({
      tileX: -5,
      tileZ: -3,
      tileSize: 100,
      targetCount: 10,
      waterThreshold: 0,
      maxSlope: 1.0,
      getHeightAt: () => 10,
      calculateSlope: () => 0,
      rng: createSeededRng(),
    });

    expect(positions.length).toBeGreaterThan(0);

    // Positions should be offset by tile coordinates
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeLessThan(0); // X should be negative
    }
  });

  it("handles very small tile", () => {
    const positions = generateGrassPositions({
      tileX: 0,
      tileZ: 0,
      tileSize: 1,
      targetCount: 10,
      waterThreshold: 0,
      maxSlope: 1.0,
      getHeightAt: () => 10,
      calculateSlope: () => 0,
      rng: createSeededRng(),
    });

    // Should still generate positions
    expect(positions.length).toBeGreaterThan(0);
  });

  it("handles zero target count", () => {
    const positions = generateGrassPositions({
      tileX: 0,
      tileZ: 0,
      tileSize: 100,
      targetCount: 0,
      waterThreshold: 0,
      maxSlope: 1.0,
      getHeightAt: () => 10,
      calculateSlope: () => 0,
      rng: createSeededRng(),
    });

    expect(positions.length).toBe(0);
  });
});
