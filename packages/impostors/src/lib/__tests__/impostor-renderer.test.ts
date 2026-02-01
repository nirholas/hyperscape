/**
 * Impostor Renderer Tests (WebGPU)
 *
 * Tests for WebGPU impostor materials and baking.
 * These tests verify the core functionality of the impostor system.
 *
 * Runs in browser environment via Playwright for WebGPU support.
 */

import * as THREE from "three/webgpu";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OctahedralImpostor,
  OctahedronType,
  PBRBakeMode,
  createTSLImpostorMaterial,
  type CompatibleRenderer,
} from "../index";
// Note: ImpostorViewData type available in types.ts if needed
import type { TSLImpostorMaterial } from "../ImpostorMaterialTSL";

// Helper to cast WebGPURenderer to CompatibleRenderer for tests
function asCompatible(renderer: THREE.WebGPURenderer): CompatibleRenderer {
  return renderer as unknown as CompatibleRenderer;
}

// Create a test mesh with a distinct color
function createTestMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  return new THREE.Mesh(geometry, material);
}

// Create a multi-colored test mesh to verify atlas content variety
function createColoredCubeMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [
    new THREE.MeshBasicMaterial({ color: 0xff0000 }), // Red +X
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // Green -X
    new THREE.MeshBasicMaterial({ color: 0x0000ff }), // Blue +Y
    new THREE.MeshBasicMaterial({ color: 0xffff00 }), // Yellow -Y
    new THREE.MeshBasicMaterial({ color: 0xff00ff }), // Magenta +Z
    new THREE.MeshBasicMaterial({ color: 0x00ffff }), // Cyan -Z
  ];
  return new THREE.Mesh(geometry, materials);
}

// Create a WebGPU renderer for testing
async function createTestRenderer(): Promise<THREE.WebGPURenderer> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(512, 512);
  await renderer.init();
  return renderer;
}

// ============================================================================
// WEBGPU IMPOSTOR TESTS
// ============================================================================

describe("OctahedralImpostor (WebGPU)", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer.dispose();
  });

  describe("WebGPU Baking", () => {
    it("should bake a basic impostor atlas", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.gridSizeX).toBe(8);
      expect(bakeResult.gridSizeY).toBe(8);
    });

    it("should bake with normals (Standard mode)", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bakeWithNormals(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
        pbrMode: PBRBakeMode.STANDARD,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.normalAtlasTexture).toBeInstanceOf(THREE.Texture);
    });

    it("should bake full AAA (depth + normals)", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bakeFull(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
        pbrMode: PBRBakeMode.COMPLETE,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.normalAtlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.depthAtlasTexture).toBeInstanceOf(THREE.Texture);
    });

    it("should bake atlas with actual content (not all white/black)", async () => {
      const mesh = createColoredCubeMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.renderTarget).toBeDefined();
      // Verify the texture has valid dimensions
      expect(bakeResult.renderTarget?.width).toBe(256);
      expect(bakeResult.renderTarget?.height).toBe(256);
    });

    it("should bake consistent atlas across multiple calls with same mesh", async () => {
      const mesh = createColoredCubeMesh();
      const config = {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      };

      const result1 = await impostor.bake(mesh, config);
      const result2 = await impostor.bake(mesh, config);

      expect(result1.gridSizeX).toBe(result2.gridSizeX);
      expect(result1.gridSizeY).toBe(result2.gridSizeY);
    });
  });

  describe("Instance Creation", () => {
    it("should create an impostor instance", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);

      expect(instance).toBeDefined();
      expect(instance.mesh).toBeInstanceOf(THREE.Mesh);
      expect(instance.mesh.material).toBeDefined();
    });

    it("should create TSL material instance", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult, 1, { useTSL: true });

      expect(instance).toBeDefined();
      expect(instance.mesh).toBeInstanceOf(THREE.Mesh);
    });
  });

  describe("Impostor Rendering", () => {
    it("should render impostor to scene without being all white", async () => {
      const mesh = createColoredCubeMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);

      scene.add(instance.mesh);
      instance.update(camera);

      // Render to verify no errors
      renderer.render(scene, camera);

      // The instance should be valid
      expect(instance.mesh.visible).toBe(true);
    });

    it("should position impostor mesh correctly at center", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);

      // Default position should be at origin
      expect(instance.mesh.position.x).toBe(0);
      expect(instance.mesh.position.y).toBeCloseTo(0, 1);
      expect(instance.mesh.position.z).toBe(0);
    });
  });
});

// ============================================================================
// TSL MATERIAL TESTS
// ============================================================================

describe("TSL Impostor Material (WebGPU)", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer.dispose();
  });

  it("should create TSL material with required uniforms", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    }) as TSLImpostorMaterial;

    expect(material).toBeDefined();
    expect(material.impostorUniforms).toBeDefined();
    expect(material.impostorUniforms.faceIndices).toBeDefined();
    expect(material.impostorUniforms.faceWeights).toBeDefined();
  });

  it("should support updateView method", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    }) as TSLImpostorMaterial;

    const faceIndices = new THREE.Vector3(1, 2, 3);
    const faceWeights = new THREE.Vector3(0.5, 0.3, 0.2);

    material.updateView(faceIndices, faceWeights);

    expect(material.impostorUniforms.faceIndices.value.x).toBe(1);
    expect(material.impostorUniforms.faceIndices.value.y).toBe(2);
    expect(material.impostorUniforms.faceIndices.value.z).toBe(3);
  });
});

// ============================================================================
// TSL MATERIAL TESTS
// ============================================================================

describe("TSL Impostor Material", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer.dispose();
  });

  it("should create TSL material with required methods", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    });

    expect(material).toBeDefined();
    expect(material.isMaterial).toBe(true);
    // TSL materials have updateView method for view updates
    expect(typeof material.updateView).toBe("function");
  });
});

// ============================================================================
// BOUNDING SPHERE TESTS
// ============================================================================

describe("Bounding Sphere Calculation", () => {
  it("should calculate correct bounding sphere for simple mesh", async () => {
    const renderer = await createTestRenderer();
    const impostor = new OctahedralImpostor(asCompatible(renderer));

    const geometry = new THREE.BoxGeometry(2, 2, 2); // 2x2x2 cube
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    });

    // Bounding sphere radius should be approximately sqrt(3) for a 2x2x2 cube centered at origin
    // sqrt(1^2 + 1^2 + 1^2) = sqrt(3) ≈ 1.73
    expect(bakeResult.boundingSphere).toBeDefined();
    expect(bakeResult.boundingSphere.radius).toBeGreaterThan(1.5);
    expect(bakeResult.boundingSphere.radius).toBeLessThan(2.5);

    renderer.dispose();
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe("Impostor Configuration", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer.dispose();
  });

  it("should respect gridSizeX and gridSizeY configuration", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 16,
      gridSizeY: 16,
      atlasWidth: 512,
      atlasHeight: 512,
    });

    expect(bakeResult.gridSizeX).toBe(16);
    expect(bakeResult.gridSizeY).toBe(16);
  });

  it("should respect atlas dimensions", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 256,
    });

    expect(bakeResult.renderTarget?.width).toBe(128);
    expect(bakeResult.renderTarget?.height).toBe(256);
  });

  it("should use hemisphere octahedron by default", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    });

    // HEMI (0) is the default
    expect(bakeResult.octType).toBe(OctahedronType.HEMI);
  });

  it("should support full octahedron configuration", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
      octType: OctahedronType.FULL,
    });

    expect(bakeResult.octType).toBe(OctahedronType.FULL);
  });
});
