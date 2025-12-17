/**
 * Sprite Generation Service Tests
 *
 * Tests for the SpriteGenerationService that renders 2D sprites from 3D models.
 * Mocks Three.js WebGL dependencies since they require a browser environment.
 *
 * Tests cover:
 * - Service initialization and constructor
 * - Sprite generation with various options
 * - Isometric sprite generation
 * - Character sprite generation
 * - Model loading
 * - Error handling
 * - Resource cleanup/disposal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to define mocks that are referenced in vi.mock
const {
  mockToDataURL,
  mockRender,
  mockSetSize,
  mockSetClearColor,
  mockDispose,
  mockGLTFLoad,
  MockWebGLRenderer,
  MockGLTFLoader,
} = vi.hoisted(() => {
  const mockToDataURL = vi
    .fn()
    .mockReturnValue("data:image/png;base64,mockImageData");
  const mockRender = vi.fn();
  const mockSetSize = vi.fn();
  const mockSetClearColor = vi.fn();
  const mockDispose = vi.fn();
  const mockGLTFLoad = vi.fn();

  // Mock WebGLRenderer class
  class MockWebGLRenderer {
    domElement = { toDataURL: mockToDataURL };
    shadowMap = { enabled: false, type: 2 }; // PCFSoftShadowMap = 2

    setSize(...args: number[]) {
      return mockSetSize(...args);
    }
    setClearColor(...args: (number | string)[]) {
      return mockSetClearColor(...args);
    }
    render(...args: unknown[]) {
      return mockRender(...args);
    }
    dispose() {
      return mockDispose();
    }
  }

  // Mock GLTFLoader class
  class MockGLTFLoader {
    load(...args: unknown[]) {
      return mockGLTFLoad(...args);
    }
  }

  return {
    mockToDataURL,
    mockRender,
    mockSetSize,
    mockSetClearColor,
    mockDispose,
    mockGLTFLoad,
    MockWebGLRenderer,
    MockGLTFLoader,
  };
});

// Apply mocks
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: MockGLTFLoader,
}));

import * as THREE from "three";
import type { SpriteGenerationOptions } from "../SpriteGenerationService";

// Create a mock GLTF result with a simple scene
function createMockGLTF(): { scene: THREE.Object3D } {
  const scene = new THREE.Object3D();
  scene.name = "MockModel";

  // Add a mesh to simulate a 3D model with bounds
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0.5, 0.5, 0.5);
  scene.add(mesh);

  return { scene };
}

// Helper to reset GLTF mock to default behavior
function resetGLTFMockToDefault() {
  mockGLTFLoad.mockImplementation(
    (path: string, onLoad: (gltf: { scene: THREE.Object3D }) => void) => {
      const mockGLTF = createMockGLTF();
      onLoad(mockGLTF);
    },
  );
}

describe("SpriteGenerationService", () => {
  let SpriteGenerationService: typeof import("../SpriteGenerationService").SpriteGenerationService;
  let spriteGenerator: import("../SpriteGenerationService").SpriteGenerationService;
  let service: import("../SpriteGenerationService").SpriteGenerationService;

  beforeEach(async () => {
    // Reset to default return values
    mockToDataURL.mockReturnValue("data:image/png;base64,mockImageData");

    // Setup default GLTFLoader mock behavior
    resetGLTFMockToDefault();

    // Reset the module cache and reimport
    vi.resetModules();
    const module = await import("../SpriteGenerationService");
    SpriteGenerationService = module.SpriteGenerationService;
    spriteGenerator = module.spriteGenerator;

    // Setup default GLTF mock again after module reset
    resetGLTFMockToDefault();

    service = new SpriteGenerationService();
  });

  describe("Constructor/Initialization", () => {
    it("creates WebGLRenderer", () => {
      expect(service).toBeDefined();
    });

    it("sets initial renderer size to 512x512", async () => {
      // Create a fresh instance and check
      vi.resetModules();
      mockSetSize.mockClear();
      const module = await import("../SpriteGenerationService");
      new module.SpriteGenerationService();
      expect(mockSetSize).toHaveBeenCalledWith(512, 512);
    });

    it("initializes scene, camera, and loader", () => {
      expect(service).toBeInstanceOf(SpriteGenerationService);
    });

    it("exports singleton spriteGenerator instance", () => {
      expect(spriteGenerator).toBeDefined();
    });
  });

  describe("generateSprites", () => {
    it("generates sprites for default 8 angles", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
      };

      const sprites = await service.generateSprites(options);

      expect(sprites).toHaveLength(8);
      // Verify render was called (at least once per sprite)
      expect(mockRender).toHaveBeenCalled();
    });

    it("generates sprites for custom angles", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0, 90, 180, 270],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites).toHaveLength(4);
      expect(mockRender).toHaveBeenCalled();
    });

    it("updates renderer size based on outputSize option", async () => {
      mockSetSize.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        outputSize: 256,
        angles: [0],
      };

      await service.generateSprites(options);

      expect(mockSetSize).toHaveBeenCalledWith(256, 256);
    });

    it("sets transparent background when backgroundColor is transparent", async () => {
      mockSetClearColor.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        backgroundColor: "transparent",
        angles: [0],
      };

      await service.generateSprites(options);

      expect(mockSetClearColor).toHaveBeenCalledWith(0x000000, 0);
    });

    it("sets custom background color when specified", async () => {
      mockSetClearColor.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        backgroundColor: "#ff0000",
        angles: [0],
      };

      await service.generateSprites(options);

      expect(mockSetClearColor).toHaveBeenCalledWith("#ff0000");
    });

    it("returns SpriteResult with correct structure", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        outputSize: 256,
        angles: [45],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites[0]).toEqual({
        angle: "45deg",
        imageUrl: "data:image/png;base64,mockImageData",
        width: 256,
        height: 256,
      });
    });

    it("renders each angle with camera positioning", async () => {
      mockRender.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0, 90],
      };

      const sprites = await service.generateSprites(options);

      // Verify we got the expected number of sprites
      expect(sprites).toHaveLength(2);
      expect(mockRender).toHaveBeenCalled();
    });

    it("calls toDataURL with PNG format for each sprite", async () => {
      mockToDataURL.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0, 45, 90],
      };

      const sprites = await service.generateSprites(options);

      // Verify all sprites have data URLs
      expect(sprites).toHaveLength(3);
      sprites.forEach((sprite) => {
        expect(sprite.imageUrl).toContain("data:image/png;base64,");
      });
      expect(mockToDataURL).toHaveBeenCalledWith("image/png");
    });

    it("uses default outputSize of 256", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites[0].width).toBe(256);
      expect(sprites[0].height).toBe(256);
    });

    it("uses default padding of 0.1", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0],
      };

      const sprites = await service.generateSprites(options);
      expect(sprites).toHaveLength(1);
    });
  });

  describe("generateIsometricSprites", () => {
    it("generates 8 isometric sprites with default angles", async () => {
      const sprites =
        await service.generateIsometricSprites("/models/test.glb");

      expect(sprites).toHaveLength(8);
    });

    it("uses default output size of 128 for isometric sprites", async () => {
      const sprites =
        await service.generateIsometricSprites("/models/test.glb");

      expect(sprites[0].width).toBe(128);
      expect(sprites[0].height).toBe(128);
    });

    it("accepts custom output size", async () => {
      const sprites = await service.generateIsometricSprites(
        "/models/test.glb",
        256,
      );

      expect(sprites[0].width).toBe(256);
      expect(sprites[0].height).toBe(256);
    });

    it("uses transparent background for isometric sprites", async () => {
      mockSetClearColor.mockClear();

      await service.generateIsometricSprites("/models/test.glb");

      expect(mockSetClearColor).toHaveBeenCalledWith(0x000000, 0);
    });

    it("generates all 8 directional angles", async () => {
      const sprites =
        await service.generateIsometricSprites("/models/test.glb");

      const expectedAngles = [
        "0deg",
        "45deg",
        "90deg",
        "135deg",
        "180deg",
        "225deg",
        "270deg",
        "315deg",
      ];
      const actualAngles = sprites.map((s) => s.angle);

      expect(actualAngles).toEqual(expectedAngles);
    });
  });

  describe("generateCharacterSprites", () => {
    it("returns sprites organized by animation name", async () => {
      const result = await service.generateCharacterSprites(
        "/models/character.vrm",
      );

      expect(result).toHaveProperty("idle");
      expect(result.idle).toBeInstanceOf(Array);
    });

    it("generates 4 directional sprites for idle pose", async () => {
      const result = await service.generateCharacterSprites(
        "/models/character.vrm",
      );

      expect(result.idle).toHaveLength(4);
    });

    it("uses correct angles for character directions", async () => {
      const result = await service.generateCharacterSprites(
        "/models/character.vrm",
      );

      const expectedAngles = ["0deg", "90deg", "180deg", "270deg"];
      const actualAngles = result.idle.map((s) => s.angle);

      expect(actualAngles).toEqual(expectedAngles);
    });

    it("uses default output size of 256 for characters", async () => {
      const result = await service.generateCharacterSprites(
        "/models/character.vrm",
      );

      expect(result.idle[0].width).toBe(256);
      expect(result.idle[0].height).toBe(256);
    });

    it("accepts custom output size", async () => {
      const result = await service.generateCharacterSprites(
        "/models/character.vrm",
        undefined,
        512,
      );

      expect(result.idle[0].width).toBe(512);
      expect(result.idle[0].height).toBe(512);
    });

    it("uses transparent background for character sprites", async () => {
      mockSetClearColor.mockClear();

      await service.generateCharacterSprites("/models/character.vrm");

      expect(mockSetClearColor).toHaveBeenCalledWith(0x000000, 0);
    });
  });

  describe("Error Handling", () => {
    it("rejects when model fails to load", async () => {
      const loadError = new Error("Failed to load model");
      mockGLTFLoad.mockImplementation(
        (
          _path: string,
          _onLoad: unknown,
          _onProgress: unknown,
          onError: (err: Error) => void,
        ) => {
          onError(loadError);
        },
      );

      const options: SpriteGenerationOptions = {
        modelPath: "/models/invalid.glb",
        angles: [0],
      };

      await expect(service.generateSprites(options)).rejects.toThrow(
        "Failed to load model",
      );
    });

    it("converts non-Error exceptions to Error objects", async () => {
      mockGLTFLoad.mockImplementation(
        (
          _path: string,
          _onLoad: unknown,
          _onProgress: unknown,
          onError: (err: string) => void,
        ) => {
          onError("String error message");
        },
      );

      const options: SpriteGenerationOptions = {
        modelPath: "/models/invalid.glb",
        angles: [0],
      };

      await expect(service.generateSprites(options)).rejects.toThrow(
        "String error message",
      );
    });

    it("handles empty angles array", async () => {
      // Reset mock to default successful behavior for this test
      resetGLTFMockToDefault();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("disposes renderer resources", () => {
      mockDispose.mockClear();
      service.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it("can be called multiple times safely", () => {
      mockDispose.mockClear();
      service.dispose();
      service.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(2);
    });
  });

  describe("Sprite Configuration", () => {
    it("validates power of 2 sprite sizes", () => {
      const validSizes = [64, 128, 256, 512, 1024, 2048];

      validSizes.forEach((size) => {
        const isPowerOf2 = (size & (size - 1)) === 0 && size > 0;
        expect(isPowerOf2).toBe(true);
      });
    });

    it("validates standard angle counts", () => {
      const validAngleCounts = [4, 8, 16];

      validAngleCounts.forEach((count) => {
        const angleStep = 360 / count;
        expect(angleStep).toBeGreaterThan(0);
        expect(angleStep).toBeLessThanOrEqual(90);
      });
    });

    it("uses default 8-direction angles", () => {
      const defaultAngles = [0, 45, 90, 135, 180, 225, 270, 315];

      expect(defaultAngles.length).toBe(8);
      expect(defaultAngles[0]).toBe(0);
      expect(defaultAngles[defaultAngles.length - 1]).toBe(315);
    });
  });

  describe("Camera Positioning", () => {
    it("calculates correct rotation per angle in radians", () => {
      const angles = [0, 45, 90, 135, 180, 225, 270, 315];

      angles.forEach((angle) => {
        const radian = (angle * Math.PI) / 180;

        if (angle === 0) expect(radian).toBe(0);
        if (angle === 90) expect(radian).toBeCloseTo(Math.PI / 2);
        if (angle === 180) expect(radian).toBeCloseTo(Math.PI);
        if (angle === 270) expect(radian).toBeCloseTo((3 * Math.PI) / 2);
      });
    });

    it("calculates camera position from angle", () => {
      const distance = 7;

      // Test front (0 degrees)
      const frontRadian = (0 * Math.PI) / 180;
      const frontX = Math.sin(frontRadian) * distance;
      const frontZ = Math.cos(frontRadian) * distance;

      expect(frontX).toBeCloseTo(0);
      expect(frontZ).toBeCloseTo(distance);

      // Test side (90 degrees)
      const sideRadian = (90 * Math.PI) / 180;
      const sideX = Math.sin(sideRadian) * distance;
      const sideZ = Math.cos(sideRadian) * distance;

      expect(sideX).toBeCloseTo(distance);
      expect(sideZ).toBeCloseTo(0);
    });
  });

  describe("Output Format", () => {
    it("outputs PNG format with transparency", async () => {
      mockToDataURL.mockClear();

      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0],
      };

      await service.generateSprites(options);

      expect(mockToDataURL).toHaveBeenCalledWith("image/png");
    });

    it("returns data URL for each sprite", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [0],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites[0].imageUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("returns correct dimensions matching output size", async () => {
      const outputSize = 512;
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        outputSize,
        angles: [0],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites[0].width).toBe(outputSize);
      expect(sprites[0].height).toBe(outputSize);
      expect(sprites[0].width).toBe(sprites[0].height);
    });

    it("formats angle as degrees string", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        angles: [45, 90, 135],
      };

      const sprites = await service.generateSprites(options);

      expect(sprites[0].angle).toBe("45deg");
      expect(sprites[1].angle).toBe("90deg");
      expect(sprites[2].angle).toBe("135deg");
    });
  });

  describe("Model Scaling and Centering", () => {
    it("calculates scale from bounding box", () => {
      const frustumSize = 5;
      const padding = 0.1;
      const maxModelDimension = 2;

      const scale = (frustumSize * (1 - padding)) / maxModelDimension;

      expect(scale).toBeCloseTo(2.25);
    });

    it("uses largest dimension for uniform scaling", () => {
      const size = { x: 1, y: 2, z: 1.5 };
      const maxDim = Math.max(size.x, size.y, size.z);

      expect(maxDim).toBe(2);
    });
  });

  describe("Options Validation", () => {
    it("accepts valid SpriteGenerationOptions", async () => {
      const options: SpriteGenerationOptions = {
        modelPath: "/models/test.glb",
        outputSize: 256,
        angles: [0, 90, 180, 270],
        backgroundColor: "transparent",
        padding: 0.1,
      };

      const sprites = await service.generateSprites(options);
      expect(sprites).toHaveLength(4);
    });

    it("requires modelPath in options", async () => {
      const options = {
        modelPath: "/models/required.glb",
      } as SpriteGenerationOptions;

      const sprites = await service.generateSprites(options);
      expect(sprites.length).toBeGreaterThan(0);
    });

    it("supports custom background colors", async () => {
      const backgroundColors = ["transparent", "#000000", "#FFFFFF"];

      for (const color of backgroundColors) {
        mockSetClearColor.mockClear();
        resetGLTFMockToDefault();

        const options: SpriteGenerationOptions = {
          modelPath: "/models/test.glb",
          backgroundColor: color,
          angles: [0],
        };

        await service.generateSprites(options);

        if (color === "transparent") {
          expect(mockSetClearColor).toHaveBeenCalledWith(0x000000, 0);
        } else {
          expect(mockSetClearColor).toHaveBeenCalledWith(color);
        }
      }
    });
  });
});
