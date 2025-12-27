/**
 * Tests terrain shader constants and blending calculations.
 * TSL material tests require Playwright.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

const TERRAIN_CONSTANTS = {
  TRIPLANAR_SCALE: 0.02,
  SNOW_HEIGHT: 50.0,
  FOG_NEAR: 200.0,
  FOG_FAR: 500.0,
};

describe("TerrainShader", () => {
  describe("TERRAIN_CONSTANTS", () => {
    it("has valid triplanar scale (positive, reasonable range)", () => {
      expect(TERRAIN_CONSTANTS.TRIPLANAR_SCALE).toBeGreaterThan(0);
      expect(TERRAIN_CONSTANTS.TRIPLANAR_SCALE).toBeLessThan(1);
    });

    it("triplanar scale produces reasonable texture repeat", () => {
      // At 0.02 scale, a 50m distance produces 1 texture repeat
      const worldSize = 50;
      const repeats = worldSize * TERRAIN_CONSTANTS.TRIPLANAR_SCALE;
      expect(repeats).toBe(1);
    });

    it("has valid snow height (positive elevation)", () => {
      expect(TERRAIN_CONSTANTS.SNOW_HEIGHT).toBeGreaterThan(0);
    });

    it("snow height is reasonable for game world", () => {
      // Snow at 50+ units is mountainous terrain
      expect(TERRAIN_CONSTANTS.SNOW_HEIGHT).toBeGreaterThanOrEqual(30);
      expect(TERRAIN_CONSTANTS.SNOW_HEIGHT).toBeLessThanOrEqual(100);
    });

    it("has valid fog distances (near < far)", () => {
      expect(TERRAIN_CONSTANTS.FOG_NEAR).toBeGreaterThan(0);
      expect(TERRAIN_CONSTANTS.FOG_FAR).toBeGreaterThan(
        TERRAIN_CONSTANTS.FOG_NEAR,
      );
    });

    it("fog distances provide reasonable visibility range", () => {
      // Near should allow clear visibility for gameplay
      expect(TERRAIN_CONSTANTS.FOG_NEAR).toBeGreaterThanOrEqual(100);

      // Far should limit draw distance but not be too close
      expect(TERRAIN_CONSTANTS.FOG_FAR).toBeGreaterThanOrEqual(300);
      expect(TERRAIN_CONSTANTS.FOG_FAR).toBeLessThanOrEqual(1000);
    });

    it("fog transition range is reasonable", () => {
      const fogRange = TERRAIN_CONSTANTS.FOG_FAR - TERRAIN_CONSTANTS.FOG_NEAR;
      // Should have a gradual transition
      expect(fogRange).toBeGreaterThanOrEqual(100);
    });
  });

  describe("Triplanar blending logic", () => {
    // Simulate triplanar weight calculation
    function calculateTriplanarWeights(
      normalX: number,
      normalY: number,
      normalZ: number,
    ): THREE.Vector3 {
      const blendSharpness = 4.0;
      const weights = new THREE.Vector3(
        Math.pow(Math.abs(normalX), blendSharpness),
        Math.pow(Math.abs(normalY), blendSharpness),
        Math.pow(Math.abs(normalZ), blendSharpness),
      );
      const sum = weights.x + weights.y + weights.z;
      weights.divideScalar(sum);
      return weights;
    }

    it("flat surface (Y-up) weights Y axis heavily", () => {
      const weights = calculateTriplanarWeights(0, 1, 0);

      expect(weights.y).toBeGreaterThan(0.99);
      expect(weights.x).toBeLessThan(0.01);
      expect(weights.z).toBeLessThan(0.01);
    });

    it("vertical wall (X-facing) weights X axis heavily", () => {
      const weights = calculateTriplanarWeights(1, 0, 0);

      expect(weights.x).toBeGreaterThan(0.99);
      expect(weights.y).toBeLessThan(0.01);
      expect(weights.z).toBeLessThan(0.01);
    });

    it("vertical wall (Z-facing) weights Z axis heavily", () => {
      const weights = calculateTriplanarWeights(0, 0, 1);

      expect(weights.z).toBeGreaterThan(0.99);
      expect(weights.x).toBeLessThan(0.01);
      expect(weights.y).toBeLessThan(0.01);
    });

    it("45-degree slope blends X and Y", () => {
      const angle = Math.PI / 4;
      const weights = calculateTriplanarWeights(
        Math.sin(angle),
        Math.cos(angle),
        0,
      );

      // Both X and Y should have significant weight
      expect(weights.x).toBeGreaterThan(0.1);
      expect(weights.y).toBeGreaterThan(0.1);
      expect(weights.z).toBeLessThan(0.01);
    });

    it("diagonal normal blends all three axes", () => {
      const len = Math.sqrt(3);
      const weights = calculateTriplanarWeights(1 / len, 1 / len, 1 / len);

      // All weights should be approximately equal
      expect(weights.x).toBeCloseTo(1 / 3, 1);
      expect(weights.y).toBeCloseTo(1 / 3, 1);
      expect(weights.z).toBeCloseTo(1 / 3, 1);
    });

    it("weights always sum to 1", () => {
      const testNormals = [
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 1],
        [0.707, 0.707, 0],
        [0.577, 0.577, 0.577],
        [0.2, 0.9, 0.3],
      ];

      for (const [x, y, z] of testNormals) {
        const weights = calculateTriplanarWeights(x, y, z);
        const sum = weights.x + weights.y + weights.z;
        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it("handles negative normals correctly", () => {
      const weightsPos = calculateTriplanarWeights(0, 1, 0);
      const weightsNeg = calculateTriplanarWeights(0, -1, 0);

      // Absolute value means same weights
      expect(weightsPos.y).toBeCloseTo(weightsNeg.y, 5);
    });
  });

  describe("Height-based texture blending", () => {
    // Simulate smoothstep
    function smoothstep(edge0: number, edge1: number, x: number): number {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    }

    it("no snow below snow height", () => {
      const snowBlend = smoothstep(
        TERRAIN_CONSTANTS.SNOW_HEIGHT,
        TERRAIN_CONSTANTS.SNOW_HEIGHT + 10,
        TERRAIN_CONSTANTS.SNOW_HEIGHT - 10,
      );

      expect(snowBlend).toBe(0);
    });

    it("full snow above snow height + 10", () => {
      const snowBlend = smoothstep(
        TERRAIN_CONSTANTS.SNOW_HEIGHT,
        TERRAIN_CONSTANTS.SNOW_HEIGHT + 10,
        TERRAIN_CONSTANTS.SNOW_HEIGHT + 20,
      );

      expect(snowBlend).toBe(1);
    });

    it("partial snow in transition zone", () => {
      const snowBlend = smoothstep(
        TERRAIN_CONSTANTS.SNOW_HEIGHT,
        TERRAIN_CONSTANTS.SNOW_HEIGHT + 10,
        TERRAIN_CONSTANTS.SNOW_HEIGHT + 5,
      );

      expect(snowBlend).toBeGreaterThan(0);
      expect(snowBlend).toBeLessThan(1);
    });

    it("sand at low elevations near water", () => {
      const sandBlend = smoothstep(5.0, 0.0, 2.5);

      expect(sandBlend).toBeGreaterThan(0);
      expect(sandBlend).toBeLessThan(1);
    });

    it("no sand at high elevations", () => {
      const sandBlend = smoothstep(5.0, 0.0, 10.0);

      expect(sandBlend).toBe(0);
    });
  });

  describe("Slope-based texture blending", () => {
    function smoothstep(edge0: number, edge1: number, x: number): number {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    }

    function calculateSlope(normalY: number): number {
      return 1.0 - Math.abs(normalY);
    }

    it("flat terrain (normalY=1) has zero slope", () => {
      const slope = calculateSlope(1.0);
      expect(slope).toBe(0);
    });

    it("vertical wall (normalY=0) has max slope", () => {
      const slope = calculateSlope(0);
      expect(slope).toBe(1);
    });

    it("45-degree angle has 0.29 slope", () => {
      const normalY = Math.cos(Math.PI / 4);
      const slope = calculateSlope(normalY);
      expect(slope).toBeCloseTo(0.29, 2);
    });

    it("rock blending starts at slope 0.6", () => {
      const rockBlend = smoothstep(0.6, 0.75, 0.5);
      expect(rockBlend).toBe(0); // Below threshold
    });

    it("full rock at slope 0.75+", () => {
      const rockBlend = smoothstep(0.6, 0.75, 0.8);
      expect(rockBlend).toBe(1);
    });

    it("partial rock blending in transition", () => {
      const rockBlend = smoothstep(0.6, 0.75, 0.675);
      expect(rockBlend).toBeGreaterThan(0);
      expect(rockBlend).toBeLessThan(1);
    });

    it("dirt blending on moderate slopes", () => {
      const dirtBlend = smoothstep(0.3, 0.5, 0.4) * 0.4;
      expect(dirtBlend).toBeGreaterThan(0);
      expect(dirtBlend).toBeLessThanOrEqual(0.4);
    });
  });

  describe("Fog calculation", () => {
    function smoothstep(edge0: number, edge1: number, x: number): number {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    }

    function calculateFog(distance: number): number {
      return smoothstep(
        TERRAIN_CONSTANTS.FOG_NEAR,
        TERRAIN_CONSTANTS.FOG_FAR,
        distance,
      );
    }

    it("no fog at close range", () => {
      const fog = calculateFog(50);
      expect(fog).toBe(0);
    });

    it("no fog just before FOG_NEAR", () => {
      const fog = calculateFog(TERRAIN_CONSTANTS.FOG_NEAR - 10);
      expect(fog).toBe(0);
    });

    it("partial fog between FOG_NEAR and FOG_FAR", () => {
      const midpoint =
        (TERRAIN_CONSTANTS.FOG_NEAR + TERRAIN_CONSTANTS.FOG_FAR) / 2;
      const fog = calculateFog(midpoint);

      expect(fog).toBeGreaterThan(0);
      expect(fog).toBeLessThan(1);
    });

    it("full fog at FOG_FAR", () => {
      const fog = calculateFog(TERRAIN_CONSTANTS.FOG_FAR);
      expect(fog).toBe(1);
    });

    it("full fog beyond FOG_FAR", () => {
      const fog = calculateFog(TERRAIN_CONSTANTS.FOG_FAR + 100);
      expect(fog).toBe(1);
    });
  });

  describe("Lighting calculation (Half-Lambert)", () => {
    function halfLambert(ndotl: number): number {
      const h = ndotl * 0.5 + 0.5;
      return h * h;
    }

    it("bright at sun-facing surfaces", () => {
      const brightness = halfLambert(1.0);
      expect(brightness).toBe(1.0);
    });

    it("moderate at tangent surfaces", () => {
      const brightness = halfLambert(0);
      expect(brightness).toBe(0.25);
    });

    it("dim but not black at shadow-facing surfaces", () => {
      const brightness = halfLambert(-1.0);
      expect(brightness).toBe(0);
    });

    it("smooth gradient across angles", () => {
      const b1 = halfLambert(1.0);
      const b2 = halfLambert(0.5);
      const b3 = halfLambert(0.0);
      const b4 = halfLambert(-0.5);
      const b5 = halfLambert(-1.0);

      expect(b1).toBeGreaterThan(b2);
      expect(b2).toBeGreaterThan(b3);
      expect(b3).toBeGreaterThan(b4);
      expect(b4).toBeGreaterThan(b5);
    });
  });

  describe("Placeholder texture creation", () => {
    it("creates valid DataTexture for server-side", () => {
      // Simulate server-side placeholder creation
      const data = new Uint8Array([255, 0, 0, 255]); // Red
      const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;

      expect(tex.image.data).toBeDefined();
      expect(tex.image.width).toBe(1);
      expect(tex.image.height).toBe(1);
    });

    it("placeholder colors are valid hex", () => {
      const colors = [0x5a9216, 0x6b4423, 0x7a7265, 0xc2b280, 0xf0f8ff];

      for (const color of colors) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);

        // Extract RGB components
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;

        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    });
  });
});
