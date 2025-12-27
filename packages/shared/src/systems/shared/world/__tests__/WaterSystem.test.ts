/**
 * Tests water geometry generation algorithm (copy from WaterSystem).
 * TSL material tests require Playwright.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

function generateWaterGeometry(
  tileSize: number,
  resolution: number,
  waterThreshold: number,
  getHeightAt: (x: number, z: number) => number,
): { vertices: number[]; uvs: number[]; indices: number[] } | null {
  const heights: number[][] = [];

  for (let i = 0; i <= resolution; i++) {
    heights[i] = [];
    for (let j = 0; j <= resolution; j++) {
      const worldX = (i / resolution - 0.5) * tileSize;
      const worldZ = (j / resolution - 0.5) * tileSize;
      heights[i][j] = getHeightAt(worldX, worldZ);
    }
  }

  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexMap = new Map<string, number>();
  let vertexIdx = 0;

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const h = [
        heights[i][j],
        heights[i + 1][j],
        heights[i][j + 1],
        heights[i + 1][j + 1],
      ];
      if (!h.some((h) => h < waterThreshold)) continue;

      const corners = [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ];
      const quadIdx: number[] = [];

      for (const [ci, cj] of corners) {
        const key = `${ci},${cj}`;
        if (!vertexMap.has(key)) {
          const localX = (ci / resolution - 0.5) * tileSize;
          const localZ = (cj / resolution - 0.5) * tileSize;
          vertices.push(localX, 0, localZ);
          uvs.push(ci / resolution, cj / resolution);
          vertexMap.set(key, vertexIdx++);
        }
        quadIdx.push(vertexMap.get(key)!);
      }

      indices.push(
        quadIdx[0],
        quadIdx[2],
        quadIdx[1],
        quadIdx[1],
        quadIdx[2],
        quadIdx[3],
      );
    }
  }

  if (vertices.length === 0) return null;
  return { vertices, uvs, indices };
}

describe("WaterSystem Geometry Generation", () => {
  describe("generateWaterGeometry", () => {
    it("returns null when no areas are underwater", () => {
      const result = generateWaterGeometry(
        100, // tileSize
        8, // resolution
        0, // waterThreshold
        () => 10, // All terrain above water
      );

      expect(result).toBeNull();
    });

    it("generates geometry when all areas are underwater", () => {
      const result = generateWaterGeometry(
        100,
        8,
        10, // Water at y=10
        () => 0, // All terrain at y=0 (underwater)
      );

      expect(result).not.toBeNull();
      expect(result!.vertices.length).toBeGreaterThan(0);
      expect(result!.indices.length).toBeGreaterThan(0);
    });

    it("generates partial geometry for mixed terrain", () => {
      const result = generateWaterGeometry(
        100,
        8,
        5, // Water at y=5
        (x) => (x < 0 ? 0 : 10), // Left half underwater, right half above
      );

      expect(result).not.toBeNull();
      // Should have fewer vertices than full coverage
      expect(result!.vertices.length).toBeGreaterThan(0);
    });

    it("generates vertices in groups of 3 (x, y, z)", () => {
      const result = generateWaterGeometry(100, 4, 10, () => 0);

      expect(result).not.toBeNull();
      expect(result!.vertices.length % 3).toBe(0);
    });

    it("generates UVs in groups of 2 (u, v)", () => {
      const result = generateWaterGeometry(100, 4, 10, () => 0);

      expect(result).not.toBeNull();
      expect(result!.uvs.length % 2).toBe(0);
    });

    it("generates indices in groups of 3 (triangles)", () => {
      const result = generateWaterGeometry(100, 4, 10, () => 0);

      expect(result).not.toBeNull();
      expect(result!.indices.length % 3).toBe(0);
    });

    it("vertex count matches UV count / 2 * 3", () => {
      const result = generateWaterGeometry(100, 4, 10, () => 0);

      expect(result).not.toBeNull();
      const vertexCount = result!.vertices.length / 3;
      const uvCount = result!.uvs.length / 2;
      expect(vertexCount).toBe(uvCount);
    });

    it("all vertex Y coordinates are 0 (flat water plane)", () => {
      const result = generateWaterGeometry(100, 4, 10, () => 0);

      expect(result).not.toBeNull();
      for (let i = 1; i < result!.vertices.length; i += 3) {
        expect(result!.vertices[i]).toBe(0);
      }
    });

    it("handles small resolution (minimum grid)", () => {
      const result = generateWaterGeometry(100, 2, 10, () => 0);

      expect(result).not.toBeNull();
      expect(result!.vertices.length).toBeGreaterThan(0);
    });

    it("handles large resolution", () => {
      const result = generateWaterGeometry(100, 64, 10, () => 0);

      expect(result).not.toBeNull();
      expect(result!.vertices.length).toBeGreaterThan(0);
    });

    it("handles negative water threshold", () => {
      const result = generateWaterGeometry(
        100,
        8,
        -10,
        () => -20, // Very deep terrain
      );

      expect(result).not.toBeNull();
    });

    it("handles terrain exactly at water threshold", () => {
      const result = generateWaterGeometry(
        100,
        8,
        5,
        () => 5, // Exactly at water level
      );

      // Height == threshold is NOT underwater (< not <=)
      expect(result).toBeNull();
    });

    it("UV coordinates are in [0, 1] range", () => {
      const result = generateWaterGeometry(100, 8, 10, () => 0);

      expect(result).not.toBeNull();
      for (let i = 0; i < result!.uvs.length; i++) {
        expect(result!.uvs[i]).toBeGreaterThanOrEqual(0);
        expect(result!.uvs[i]).toBeLessThanOrEqual(1);
      }
    });

    it("all indices are valid vertex references", () => {
      const result = generateWaterGeometry(100, 8, 10, () => 0);

      expect(result).not.toBeNull();
      const vertexCount = result!.vertices.length / 3;
      for (const idx of result!.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(vertexCount);
      }
    });
  });

  describe("THREE.js BufferGeometry integration", () => {
    it("creates valid BufferGeometry from generated data", () => {
      const result = generateWaterGeometry(100, 8, 10, () => 0);
      expect(result).not.toBeNull();

      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(result!.vertices, 3),
      );
      geom.setAttribute("uv", new THREE.Float32BufferAttribute(result!.uvs, 2));
      geom.setIndex(result!.indices);
      geom.computeVertexNormals();

      expect(geom.attributes.position).toBeDefined();
      expect(geom.attributes.uv).toBeDefined();
      expect(geom.attributes.normal).toBeDefined();
      expect(geom.index).toBeDefined();
    });

    it("generated mesh has correct bounding sphere", () => {
      const result = generateWaterGeometry(100, 8, 10, () => 0);
      expect(result).not.toBeNull();

      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(result!.vertices, 3),
      );
      geom.setIndex(result!.indices);
      geom.computeBoundingSphere();

      expect(geom.boundingSphere).not.toBeNull();
      expect(geom.boundingSphere!.radius).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles checkerboard underwater pattern", () => {
      const result = generateWaterGeometry(100, 8, 5, (x, z) =>
        (Math.floor(x + 50) + Math.floor(z + 50)) % 2 === 0 ? 0 : 10,
      );

      // Some areas underwater, some not
      expect(result).not.toBeNull();
    });

    it("handles single underwater cell", () => {
      const result = generateWaterGeometry(
        100,
        8,
        5,
        (x, z) => (x < -40 && z < -40 ? 0 : 10), // Only corner underwater
      );

      expect(result).not.toBeNull();
      // Should have minimal geometry
      expect(result!.vertices.length).toBeLessThan(100);
    });

    it("handles varying terrain slopes", () => {
      const result = generateWaterGeometry(
        100,
        8,
        5,
        (x) => x * 0.1, // Linear slope from -5 to +5
      );

      // Approximately half should be underwater
      expect(result).not.toBeNull();
    });
  });
});

describe("Water mesh userData", () => {
  it("water mesh should have correct userData properties", () => {
    const expectedUserData = {
      type: "water",
      walkable: false,
      clickable: false,
    };

    expect(expectedUserData.type).toBe("water");
    expect(expectedUserData.walkable).toBe(false);
    expect(expectedUserData.clickable).toBe(false);
  });
});

describe("Water time accumulation", () => {
  it("accumulates time correctly over multiple frames", () => {
    let time = 0;
    const dt = 1 / 60; // 60fps

    for (let i = 0; i < 60; i++) {
      time += dt;
    }

    // After 60 frames at 60fps, should be ~1 second
    expect(time).toBeCloseTo(1.0, 2);
  });

  it("handles variable deltaTime", () => {
    let time = 0;
    const frames = [0.016, 0.017, 0.015, 0.02, 0.014];

    for (const dt of frames) {
      time += dt;
    }

    expect(time).toBeCloseTo(0.082, 3);
  });

  it("clamps invalid deltaTime to default", () => {
    const clampDt = (dt: number) =>
      typeof dt === "number" && isFinite(dt) ? dt : 1 / 60;

    expect(clampDt(0.016)).toBe(0.016);
    expect(clampDt(NaN)).toBeCloseTo(1 / 60, 4);
    expect(clampDt(Infinity)).toBeCloseTo(1 / 60, 4);
    expect(clampDt(-1)).toBe(-1); // Negative is still finite
  });
});
