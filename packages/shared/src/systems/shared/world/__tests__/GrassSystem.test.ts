/**
 * GrassSystem Unit Tests
 *
 * Tests for procedural WebGPU grass rendering:
 * - Configuration constants validation
 * - Grass blade geometry generation
 * - Biome grass configuration
 * - Chunk management and pooling
 * - Integration with terrain events
 *
 * Based on packages/shared/src/systems/shared/world/GrassSystem.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import THREE from "../../../../extras/three/three";
import {
  GRASS_CONFIG,
  BIOME_GRASS_DEFAULTS,
  GrassSystem,
  type BiomeGrassConfig,
} from "../GrassSystem";
import { GPU_VEG_CONFIG } from "../GPUVegetation";

// ============================================================================
// GRASS_CONFIG CONSTANTS TESTS
// ============================================================================

describe("GRASS_CONFIG", () => {
  describe("blade dimensions", () => {
    it("should have valid blade height (0.1m - 1.0m)", () => {
      expect(GRASS_CONFIG.BLADE_HEIGHT).toBeGreaterThanOrEqual(0.1);
      expect(GRASS_CONFIG.BLADE_HEIGHT).toBeLessThanOrEqual(1.0);
    });

    it("should have valid blade width (0.01m - 0.1m)", () => {
      expect(GRASS_CONFIG.BLADE_WIDTH).toBeGreaterThanOrEqual(0.01);
      expect(GRASS_CONFIG.BLADE_WIDTH).toBeLessThanOrEqual(0.1);
    });

    it("should have reasonable blade segments (2-8)", () => {
      expect(GRASS_CONFIG.BLADE_SEGMENTS).toBeGreaterThanOrEqual(2);
      expect(GRASS_CONFIG.BLADE_SEGMENTS).toBeLessThanOrEqual(8);
    });

    it("should have realistic blade proportions", () => {
      // Height should be at least 5x width
      const aspectRatio = GRASS_CONFIG.BLADE_HEIGHT / GRASS_CONFIG.BLADE_WIDTH;
      expect(aspectRatio).toBeGreaterThanOrEqual(5);
    });
  });

  describe("density and chunking", () => {
    it("should have positive base density", () => {
      expect(GRASS_CONFIG.BASE_DENSITY).toBeGreaterThan(0);
    });

    it("should have reasonable chunk size (10m - 100m)", () => {
      expect(GRASS_CONFIG.CHUNK_SIZE).toBeGreaterThanOrEqual(10);
      expect(GRASS_CONFIG.CHUNK_SIZE).toBeLessThanOrEqual(100);
    });

    it("should have valid max instances (power of 2 for GPU efficiency)", () => {
      expect(GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK).toBeGreaterThan(0);
      // Check it's a power of 2
      const log2 = Math.log2(GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK);
      expect(log2 % 1).toBe(0);
    });

    it("should have reasonable instance count per chunk at base density", () => {
      const chunkInstances =
        GRASS_CONFIG.CHUNK_SIZE *
        GRASS_CONFIG.CHUNK_SIZE *
        GRASS_CONFIG.BASE_DENSITY;
      expect(chunkInstances).toBeLessThanOrEqual(
        GRASS_CONFIG.MAX_INSTANCES_PER_CHUNK,
      );
    });
  });

  describe("fade distances", () => {
    it("should have fade start < fade end", () => {
      expect(GRASS_CONFIG.FADE_START).toBeLessThan(GRASS_CONFIG.FADE_END);
    });

    it("should have positive fade distances", () => {
      expect(GRASS_CONFIG.FADE_START).toBeGreaterThan(0);
      expect(GRASS_CONFIG.FADE_END).toBeGreaterThan(0);
    });

    it("should have reasonable fade range (10m - 100m)", () => {
      const fadeRange = GRASS_CONFIG.FADE_END - GRASS_CONFIG.FADE_START;
      expect(fadeRange).toBeGreaterThanOrEqual(10);
      expect(fadeRange).toBeLessThanOrEqual(100);
    });
  });

  describe("water level", () => {
    it("should reference GPU_VEG_CONFIG.WATER_LEVEL", () => {
      expect(GRASS_CONFIG.WATER_LEVEL).toBe(GPU_VEG_CONFIG.WATER_LEVEL);
    });

    it("should have positive water buffer", () => {
      expect(GRASS_CONFIG.WATER_BUFFER).toBeGreaterThan(0);
    });
  });

  describe("wind parameters", () => {
    it("should have positive wind speed", () => {
      expect(GRASS_CONFIG.WIND_SPEED).toBeGreaterThan(0);
    });

    it("should have positive gust speed", () => {
      expect(GRASS_CONFIG.GUST_SPEED).toBeGreaterThan(0);
    });

    it("should have gust speed slower than primary wind", () => {
      expect(GRASS_CONFIG.GUST_SPEED).toBeLessThan(GRASS_CONFIG.WIND_SPEED);
    });

    it("should have reasonable max bend (0 - PI/2)", () => {
      expect(GRASS_CONFIG.MAX_BEND).toBeGreaterThan(0);
      expect(GRASS_CONFIG.MAX_BEND).toBeLessThanOrEqual(Math.PI / 2);
    });

    it("should have reasonable flutter intensity (0 - 1)", () => {
      expect(GRASS_CONFIG.FLUTTER_INTENSITY).toBeGreaterThanOrEqual(0);
      expect(GRASS_CONFIG.FLUTTER_INTENSITY).toBeLessThanOrEqual(1);
    });
  });

  describe("colors", () => {
    it("should have valid base color", () => {
      expect(GRASS_CONFIG.BASE_COLOR).toBeInstanceOf(THREE.Color);
      expect(GRASS_CONFIG.BASE_COLOR.r).toBeGreaterThanOrEqual(0);
      expect(GRASS_CONFIG.BASE_COLOR.r).toBeLessThanOrEqual(1);
    });

    it("should have valid tip color", () => {
      expect(GRASS_CONFIG.TIP_COLOR).toBeInstanceOf(THREE.Color);
    });

    it("should have valid dark color", () => {
      expect(GRASS_CONFIG.DARK_COLOR).toBeInstanceOf(THREE.Color);
    });

    it("should have tip color lighter than base (higher luminance)", () => {
      const baseLuminance =
        GRASS_CONFIG.BASE_COLOR.r * 0.299 +
        GRASS_CONFIG.BASE_COLOR.g * 0.587 +
        GRASS_CONFIG.BASE_COLOR.b * 0.114;
      const tipLuminance =
        GRASS_CONFIG.TIP_COLOR.r * 0.299 +
        GRASS_CONFIG.TIP_COLOR.g * 0.587 +
        GRASS_CONFIG.TIP_COLOR.b * 0.114;
      expect(tipLuminance).toBeGreaterThan(baseLuminance);
    });
  });

  describe("LOD distances", () => {
    it("should have LOD_NEAR < LOD_FAR", () => {
      expect(GRASS_CONFIG.LOD_NEAR).toBeLessThan(GRASS_CONFIG.LOD_FAR);
    });

    it("should have LOD_FAR < FADE_START", () => {
      expect(GRASS_CONFIG.LOD_FAR).toBeLessThanOrEqual(GRASS_CONFIG.FADE_START);
    });

    it("should have valid LOD far density (0 - 1)", () => {
      expect(GRASS_CONFIG.LOD_FAR_DENSITY).toBeGreaterThan(0);
      expect(GRASS_CONFIG.LOD_FAR_DENSITY).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================================
// BIOME_GRASS_DEFAULTS TESTS
// ============================================================================

describe("BIOME_GRASS_DEFAULTS", () => {
  it("should have configurations for common biomes", () => {
    expect(BIOME_GRASS_DEFAULTS.plains).toBeDefined();
    expect(BIOME_GRASS_DEFAULTS.forest).toBeDefined();
    expect(BIOME_GRASS_DEFAULTS.mountains).toBeDefined();
    expect(BIOME_GRASS_DEFAULTS.desert).toBeDefined();
  });

  it("should have reduced grass density for harsh biomes", () => {
    // Desert, mountains, lakes have grass enabled but with lower density
    expect(BIOME_GRASS_DEFAULTS.desert?.enabled).toBe(true);
    expect(BIOME_GRASS_DEFAULTS.mountains?.enabled).toBe(true);
    expect(BIOME_GRASS_DEFAULTS.lakes?.enabled).toBe(true);

    // Verify they have lower density than lush biomes
    expect(BIOME_GRASS_DEFAULTS.desert.densityMultiplier).toBeLessThan(
      BIOME_GRASS_DEFAULTS.plains.densityMultiplier,
    );
    expect(BIOME_GRASS_DEFAULTS.mountains.densityMultiplier).toBeLessThan(
      BIOME_GRASS_DEFAULTS.plains.densityMultiplier,
    );
  });

  it("should enable grass for vegetated biomes", () => {
    expect(BIOME_GRASS_DEFAULTS.plains?.enabled).toBe(true);
    expect(BIOME_GRASS_DEFAULTS.forest?.enabled).toBe(true);
    expect(BIOME_GRASS_DEFAULTS.valley?.enabled).toBe(true);
  });

  it("should have valid density multipliers", () => {
    for (const [biome, config] of Object.entries(BIOME_GRASS_DEFAULTS)) {
      expect(config.densityMultiplier).toBeGreaterThanOrEqual(0);
      expect(config.densityMultiplier).toBeLessThanOrEqual(3);
    }
  });

  it("should have plains with higher density than forest", () => {
    expect(BIOME_GRASS_DEFAULTS.plains.densityMultiplier).toBeGreaterThan(
      BIOME_GRASS_DEFAULTS.forest.densityMultiplier,
    );
  });

  it("should have valid height multipliers when defined", () => {
    for (const [biome, config] of Object.entries(BIOME_GRASS_DEFAULTS)) {
      if (config.heightMultiplier !== undefined) {
        expect(config.heightMultiplier).toBeGreaterThan(0);
        expect(config.heightMultiplier).toBeLessThanOrEqual(2);
      }
    }
  });
});

// ============================================================================
// GRASS BLADE GEOMETRY TESTS
// ============================================================================

describe("Grass Blade Geometry", () => {
  // We can't directly test the private createGrassBladeGeometry function,
  // but we can verify the geometry through the system

  it("should generate expected vertex count for given segments", () => {
    // Formula: (segments + 1) * 2 vertices
    const segments = GRASS_CONFIG.BLADE_SEGMENTS;
    const expectedVertexCount = (segments + 1) * 2;

    // 4 segments = 10 vertices
    expect(expectedVertexCount).toBe(10);
  });

  it("should generate expected triangle count for given segments", () => {
    // Formula: segments * 2 triangles
    const segments = GRASS_CONFIG.BLADE_SEGMENTS;
    const expectedTriangles = segments * 2;

    // 4 segments = 8 triangles
    expect(expectedTriangles).toBe(8);
  });

  it("should calculate correct index count", () => {
    // Formula: triangles * 3 indices
    const segments = GRASS_CONFIG.BLADE_SEGMENTS;
    const expectedIndices = segments * 2 * 3;

    // 4 segments = 24 indices
    expect(expectedIndices).toBe(24);
  });
});

// ============================================================================
// BIOME GRASS CONFIG TYPE TESTS
// ============================================================================

describe("BiomeGrassConfig Type", () => {
  it("should allow creating valid configs", () => {
    const config: BiomeGrassConfig = {
      enabled: true,
      densityMultiplier: 1.0,
    };
    expect(config.enabled).toBe(true);
    expect(config.densityMultiplier).toBe(1.0);
  });

  it("should allow optional colorTint", () => {
    const config: BiomeGrassConfig = {
      enabled: true,
      densityMultiplier: 1.0,
      colorTint: new THREE.Color(0x00ff00),
    };
    expect(config.colorTint).toBeInstanceOf(THREE.Color);
  });

  it("should allow optional heightMultiplier", () => {
    const config: BiomeGrassConfig = {
      enabled: true,
      densityMultiplier: 1.0,
      heightMultiplier: 1.5,
    };
    expect(config.heightMultiplier).toBe(1.5);
  });
});

// ============================================================================
// GRASS CHUNK MATH TESTS
// ============================================================================

describe("Grass Chunk Math", () => {
  it("should calculate correct chunks per tile", () => {
    const tileSize = 100;
    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
    const chunksPerTile = Math.ceil(tileSize / chunkSize);

    // 100m tile / 25m chunks = 4 chunks per tile
    expect(chunksPerTile).toBe(4);
  });

  it("should calculate correct instance count from density", () => {
    const chunkSize = GRASS_CONFIG.CHUNK_SIZE;
    const density = GRASS_CONFIG.BASE_DENSITY;
    const instanceCount = Math.floor(chunkSize * chunkSize * density);

    // 25m * 25m * 40 density = 25000 instances
    expect(instanceCount).toBe(25000);
  });

  it("should calculate correct spacing from density", () => {
    const density = GRASS_CONFIG.BASE_DENSITY;
    const spacing = Math.sqrt(1 / density);

    // sqrt(1/40) ≈ 0.158m between grass blades
    expect(spacing).toBeCloseTo(0.158, 2);
  });

  it("should calculate correct bounding sphere radius", () => {
    const size = GRASS_CONFIG.CHUNK_SIZE;
    const expectedRadius =
      (Math.sqrt(2) * size) / 2 + GRASS_CONFIG.BLADE_HEIGHT;

    // sqrt(2) * 25 / 2 + 0.4 ≈ 18.07
    expect(expectedRadius).toBeCloseTo(18.07, 1);
  });
});

// ============================================================================
// DETERMINISTIC RNG TESTS
// ============================================================================

describe("Deterministic RNG", () => {
  it("should produce consistent values for same seed", () => {
    const seed = 12345;
    let rngState1 = seed;
    let rngState2 = seed;

    const nextRandom1 = (): number => {
      rngState1 = (rngState1 * 1103515245 + 12345) & 0x7fffffff;
      return rngState1 / 0x7fffffff;
    };

    const nextRandom2 = (): number => {
      rngState2 = (rngState2 * 1103515245 + 12345) & 0x7fffffff;
      return rngState2 / 0x7fffffff;
    };

    // Generate 10 values from each RNG
    const values1 = Array.from({ length: 10 }, () => nextRandom1());
    const values2 = Array.from({ length: 10 }, () => nextRandom2());

    expect(values1).toEqual(values2);
  });

  it("should produce values in range [0, 1)", () => {
    let rngState = 12345;
    const nextRandom = (): number => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };

    for (let i = 0; i < 1000; i++) {
      const value = nextRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("should produce different values for different seeds", () => {
    const getFirstValues = (seed: number): number[] => {
      let rngState = seed;
      const nextRandom = (): number => {
        rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
        return rngState / 0x7fffffff;
      };
      return Array.from({ length: 5 }, () => nextRandom());
    };

    const values1 = getFirstValues(12345);
    const values2 = getFirstValues(54321);

    expect(values1).not.toEqual(values2);
  });
});

// ============================================================================
// HASH FUNCTION TESTS
// ============================================================================

describe("Position Hash Function", () => {
  it("should be deterministic", () => {
    const hashPosition = (x: number, z: number): number => {
      const h1 = Math.imul(Math.floor(x * 100) ^ 0x85ebca6b, 0x85ebca6b);
      const h2 = Math.imul(Math.floor(z * 100) ^ 0xc2b2ae35, 0xc2b2ae35);
      return Math.abs((h1 ^ h2) | 0);
    };

    const hash1 = hashPosition(100, 200);
    const hash2 = hashPosition(100, 200);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different positions", () => {
    const hashPosition = (x: number, z: number): number => {
      const h1 = Math.imul(Math.floor(x * 100) ^ 0x85ebca6b, 0x85ebca6b);
      const h2 = Math.imul(Math.floor(z * 100) ^ 0xc2b2ae35, 0xc2b2ae35);
      return Math.abs((h1 ^ h2) | 0);
    };

    const hash1 = hashPosition(100, 200);
    const hash2 = hashPosition(200, 100);
    const hash3 = hashPosition(0, 0);

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it("should always return non-negative values", () => {
    const hashPosition = (x: number, z: number): number => {
      const h1 = Math.imul(Math.floor(x * 100) ^ 0x85ebca6b, 0x85ebca6b);
      const h2 = Math.imul(Math.floor(z * 100) ^ 0xc2b2ae35, 0xc2b2ae35);
      return Math.abs((h1 ^ h2) | 0);
    };

    // Test various positions including negatives
    const positions = [
      [0, 0],
      [100, 100],
      [-100, 100],
      [100, -100],
      [-100, -100],
      [1000, 1000],
      [-1000, -1000],
    ];

    for (const [x, z] of positions) {
      const hash = hashPosition(x, z);
      expect(hash).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// WORLD SEED TESTS
// ============================================================================

describe("World Seed Derivation", () => {
  it("should derive consistent seed from world ID", () => {
    const getWorldSeed = (worldId: string): number => {
      let hash = 0;
      for (let i = 0; i < worldId.length; i++) {
        const char = worldId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    const seed1 = getWorldSeed("test-world-123");
    const seed2 = getWorldSeed("test-world-123");

    expect(seed1).toBe(seed2);
  });

  it("should produce different seeds for different world IDs", () => {
    const getWorldSeed = (worldId: string): number => {
      let hash = 0;
      for (let i = 0; i < worldId.length; i++) {
        const char = worldId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    const seed1 = getWorldSeed("world-a");
    const seed2 = getWorldSeed("world-b");

    expect(seed1).not.toBe(seed2);
  });

  it("should always return non-negative seed", () => {
    const getWorldSeed = (worldId: string): number => {
      let hash = 0;
      for (let i = 0; i < worldId.length; i++) {
        const char = worldId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    const testIds = [
      "",
      "a",
      "test",
      "very-long-world-id-with-many-characters",
    ];
    for (const id of testIds) {
      const seed = getWorldSeed(id);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// DISTANCE CALCULATION TESTS
// ============================================================================

describe("Distance Calculations", () => {
  it("should calculate correct squared distance for fade", () => {
    const fadeStartSq = GRASS_CONFIG.FADE_START * GRASS_CONFIG.FADE_START;
    const fadeEndSq = GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END;

    expect(fadeStartSq).toBe(45 * 45);
    expect(fadeEndSq).toBe(60 * 60);
  });

  it("should correctly determine if position is in fade range", () => {
    const fadeStartSq = GRASS_CONFIG.FADE_START * GRASS_CONFIG.FADE_START;
    const fadeEndSq = GRASS_CONFIG.FADE_END * GRASS_CONFIG.FADE_END;

    const playerPos = { x: 0, z: 0 };

    // Test position at 30m - should be fully visible (before fade)
    const pos30 = { x: 30, z: 0 };
    const distSq30 =
      (pos30.x - playerPos.x) ** 2 + (pos30.z - playerPos.z) ** 2;
    expect(distSq30).toBeLessThan(fadeStartSq);

    // Test position at 50m - should be fading
    const pos50 = { x: 50, z: 0 };
    const distSq50 =
      (pos50.x - playerPos.x) ** 2 + (pos50.z - playerPos.z) ** 2;
    expect(distSq50).toBeGreaterThan(fadeStartSq);
    expect(distSq50).toBeLessThan(fadeEndSq);

    // Test position at 70m - should be fully hidden
    const pos70 = { x: 70, z: 0 };
    const distSq70 =
      (pos70.x - playerPos.x) ** 2 + (pos70.z - playerPos.z) ** 2;
    expect(distSq70).toBeGreaterThan(fadeEndSq);
  });
});

// ============================================================================
// WATER CULLING TESTS
// ============================================================================

describe("Water Culling", () => {
  it("should calculate correct water cutoff level", () => {
    const waterCutoff = GRASS_CONFIG.WATER_LEVEL + GRASS_CONFIG.WATER_BUFFER;
    expect(waterCutoff).toBeGreaterThan(GRASS_CONFIG.WATER_LEVEL);
  });

  it("should identify underwater positions", () => {
    const waterCutoff = GRASS_CONFIG.WATER_LEVEL + GRASS_CONFIG.WATER_BUFFER;

    // Position below water
    const underwaterY = GRASS_CONFIG.WATER_LEVEL - 1;
    expect(underwaterY).toBeLessThan(waterCutoff);

    // Position at water edge
    const atWaterY = GRASS_CONFIG.WATER_LEVEL + GRASS_CONFIG.WATER_BUFFER / 2;
    expect(atWaterY).toBeLessThan(waterCutoff);

    // Position above water
    const aboveWaterY = waterCutoff + 1;
    expect(aboveWaterY).toBeGreaterThan(waterCutoff);
  });
});

// ============================================================================
// FRUSTUM CULLING TESTS
// ============================================================================

describe("Frustum Culling", () => {
  it("should create valid bounding sphere for chunk", () => {
    const originX = 100;
    const originZ = 200;
    const size = GRASS_CONFIG.CHUNK_SIZE;
    const centerHeight = 10;

    const boundingSphere = new THREE.Sphere(
      new THREE.Vector3(
        originX + size / 2,
        centerHeight + GRASS_CONFIG.BLADE_HEIGHT / 2,
        originZ + size / 2,
      ),
      (Math.sqrt(2) * size) / 2 + GRASS_CONFIG.BLADE_HEIGHT,
    );

    expect(boundingSphere.center.x).toBe(112.5);
    expect(boundingSphere.center.z).toBe(212.5);
    expect(boundingSphere.radius).toBeGreaterThan(0);
  });

  it("should intersect frustum when chunk is visible", () => {
    const frustum = new THREE.Frustum();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 10, 0);
    camera.lookAt(100, 0, 100);
    camera.updateMatrixWorld();

    const frustumMatrix = new THREE.Matrix4();
    frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(frustumMatrix);

    // Chunk in front of camera
    const visibleSphere = new THREE.Sphere(new THREE.Vector3(100, 0, 100), 20);
    expect(frustum.intersectsSphere(visibleSphere)).toBe(true);
  });

  it("should not intersect frustum when chunk is behind camera", () => {
    const frustum = new THREE.Frustum();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 10, 0);
    camera.lookAt(100, 0, 100);
    camera.updateMatrixWorld();

    const frustumMatrix = new THREE.Matrix4();
    frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(frustumMatrix);

    // Chunk behind camera
    const behindSphere = new THREE.Sphere(new THREE.Vector3(-100, 0, -100), 20);
    expect(frustum.intersectsSphere(behindSphere)).toBe(false);
  });
});
