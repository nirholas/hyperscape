import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CSM, CSMOptions } from "../CSM";

describe("CSM", () => {
  function createTestCSM(options: Partial<CSMOptions> = {}): CSM {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.position.set(0, 5, 10);
    camera.updateMatrixWorld(true);

    return new CSM({
      parent: scene,
      camera,
      cascades: options.cascades ?? 3,
      maxFar: options.maxFar ?? 100,
      shadowMapSize: options.shadowMapSize ?? 1024,
      lightDirection:
        options.lightDirection ?? new THREE.Vector3(-1, -1, -1).normalize(),
      ...options,
    });
  }

  describe("cascade distances", () => {
    it("3 cascades, maxFar=100", () => {
      const csm = createTestCSM({ cascades: 3, maxFar: 100 });
      expect(csm.cascadeDistances.length).toBe(3);
      expect(csm.cascadeDistances[0]).toBeLessThan(csm.cascadeDistances[1]);
      expect(csm.cascadeDistances[2]).toBeCloseTo(100, 0);
      csm.dispose();
    });

    it("2 cascades, maxFar=150", () => {
      const csm = createTestCSM({ cascades: 2, maxFar: 150 });
      expect(csm.cascadeDistances.length).toBe(2);
      expect(csm.cascadeDistances[1]).toBeCloseTo(150, 0);
      csm.dispose();
    });

    it("first cascade closer than uniform split", () => {
      const csm = createTestCSM({ cascades: 3, maxFar: 100 });
      expect(csm.cascadeDistances[0]).toBeLessThan(0.5 + 99.5 / 3);
      csm.dispose();
    });

    it("monotonically increasing", () => {
      for (const { cascades, maxFar } of [
        { cascades: 2, maxFar: 100 },
        { cascades: 4, maxFar: 200 },
      ]) {
        const csm = createTestCSM({ cascades, maxFar });
        for (let i = 1; i < csm.cascadeDistances.length; i++) {
          expect(csm.cascadeDistances[i]).toBeGreaterThan(
            csm.cascadeDistances[i - 1],
          );
        }
        csm.dispose();
      }
    });

    it("final cascade reaches maxFar", () => {
      for (const maxFar of [50, 100, 200]) {
        const csm = createTestCSM({ cascades: 3, maxFar });
        expect(csm.cascadeDistances[2]).toBeCloseTo(maxFar, 1);
        csm.dispose();
      }
    });

    it("single cascade", () => {
      const csm = createTestCSM({ cascades: 1, maxFar: 100 });
      expect(csm.cascadeDistances.length).toBe(1);
      expect(csm.cascadeDistances[0]).toBeCloseTo(100, 1);
      csm.dispose();
    });

    it("recalculate after updateCascades", () => {
      const csm = createTestCSM({ cascades: 2, maxFar: 100 });
      expect(csm.cascadeDistances.length).toBe(2);
      csm.updateCascades(4);
      expect(csm.cascadeDistances.length).toBe(4);
      csm.dispose();
    });
  });

  describe("light initialization", () => {
    it("creates lights per cascade", () => {
      const csm = createTestCSM({ cascades: 3 });
      expect(csm.lights.length).toBe(3);
      csm.dispose();
    });

    it("all lights are DirectionalLight", () => {
      const csm = createTestCSM({ cascades: 3 });
      for (const l of csm.lights)
        expect(l).toBeInstanceOf(THREE.DirectionalLight);
      csm.dispose();
    });

    it("shadow map size", () => {
      const csm = createTestCSM({ cascades: 2, shadowMapSize: 2048 });
      for (const l of csm.lights) expect(l.shadow.mapSize.width).toBe(2048);
      csm.dispose();
    });

    it("castShadow default true", () => {
      const csm = createTestCSM({ cascades: 2 });
      for (const l of csm.lights) expect(l.castShadow).toBe(true);
      csm.dispose();
    });

    it("castShadow=false option", () => {
      const csm = createTestCSM({ cascades: 2, castShadow: false });
      for (const l of csm.lights) expect(l.castShadow).toBe(false);
      csm.dispose();
    });

    it("bias values", () => {
      const csm = createTestCSM({
        cascades: 2,
        shadowBias: -0.001,
        shadowNormalBias: 0.01,
      });
      for (const l of csm.lights) {
        expect(l.shadow.bias).toBe(-0.001);
        expect(l.shadow.normalBias).toBe(0.01);
      }
      csm.dispose();
    });
  });

  describe("updateCascades", () => {
    it("recreates lights when count changes", () => {
      const csm = createTestCSM({ cascades: 2 });
      csm.updateCascades(4);
      expect(csm.lights.length).toBe(4);
      csm.dispose();
    });

    it("no-op if unchanged", () => {
      const csm = createTestCSM({ cascades: 3 });
      const original = [...csm.lights];
      csm.updateCascades(3);
      expect(csm.lights).toEqual(original);
      csm.dispose();
    });
  });

  describe("updateShadowMapSize", () => {
    it("updates all lights", () => {
      const csm = createTestCSM({ cascades: 2, shadowMapSize: 1024 });
      csm.updateShadowMapSize(2048);
      for (const l of csm.lights) expect(l.shadow.mapSize.width).toBe(2048);
      csm.dispose();
    });

    it("no-op if unchanged", () => {
      const csm = createTestCSM({ cascades: 2, shadowMapSize: 1024 });
      csm.updateShadowMapSize(1024);
      for (const l of csm.lights) expect(l.shadow.mapSize.width).toBe(1024);
      csm.dispose();
    });
  });

  describe("update", () => {
    it("light positions follow camera", () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
      camera.updateMatrixWorld(true);

      const csm = new CSM({ parent: scene, camera, cascades: 2, maxFar: 100 });
      const initial = csm.lights.map((l) => l.position.clone());

      camera.position.set(50, 10, 50);
      camera.updateMatrixWorld(true);
      csm.update();

      for (let i = 0; i < csm.lights.length; i++) {
        expect(csm.lights[i].position.equals(initial[i])).toBe(false);
      }
      csm.dispose();
    });

    it("light targets offset from light position by light direction", () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
      camera.position.set(100, 50, 100);
      camera.updateMatrixWorld(true);

      const lightDirection = new THREE.Vector3(1, -1, 1).normalize();
      const csm = new CSM({
        parent: scene,
        camera,
        cascades: 2,
        maxFar: 100,
        lightDirection,
      });
      csm.update();

      // In three.js CSM, light.target.position = light.position + lightDirection
      for (const l of csm.lights) {
        const expectedTarget = l.position.clone().add(lightDirection);
        expect(l.target.position.x).toBeCloseTo(expectedTarget.x, 5);
        expect(l.target.position.y).toBeCloseTo(expectedTarget.y, 5);
        expect(l.target.position.z).toBeCloseTo(expectedTarget.z, 5);
      }
      csm.dispose();
    });
  });

  describe("dispose", () => {
    it("removes lights from scene", () => {
      const scene = new THREE.Scene();
      const csm = new CSM({
        parent: scene,
        camera: new THREE.PerspectiveCamera(),
        cascades: 3,
      });
      expect(scene.children.length).toBeGreaterThan(0);
      csm.dispose();
      expect(
        scene.children.filter((c) => c instanceof THREE.DirectionalLight)
          .length,
      ).toBe(0);
    });

    it("clears lights array", () => {
      const csm = createTestCSM({ cascades: 2 });
      csm.dispose();
      expect(csm.lights.length).toBe(0);
    });
  });

  describe("light direction", () => {
    it("uses configured direction", () => {
      const dir = new THREE.Vector3(0, -1, 0).normalize();
      const csm = createTestCSM({ cascades: 2, lightDirection: dir });
      expect(csm.lightDirection.equals(dir)).toBe(true);
      csm.dispose();
    });

    it("defaults downward", () => {
      const scene = new THREE.Scene();
      const csm = new CSM({
        parent: scene,
        camera: new THREE.PerspectiveCamera(),
        cascades: 2,
      });
      expect(csm.lightDirection.y).toBeLessThan(0);
      csm.dispose();
    });
  });

  describe("boundary conditions", () => {
    it("small maxFar", () => {
      const csm = createTestCSM({ cascades: 2, maxFar: 10 });
      expect(csm.lights.length).toBe(2);
      csm.dispose();
    });

    it("large maxFar", () => {
      const csm = createTestCSM({ cascades: 4, maxFar: 1000 });
      expect(csm.lights.length).toBe(4);
      csm.dispose();
    });

    it("many cascades", () => {
      const csm = createTestCSM({ cascades: 8, maxFar: 500 });
      expect(csm.lights.length).toBe(8);
      expect(new Set(csm.lights.map((l) => l.uuid)).size).toBe(8);
      csm.dispose();
    });
  });

  describe("shadow camera frustum", () => {
    it("frustum size increases with distance", () => {
      const csm = createTestCSM({ cascades: 3, maxFar: 100 });
      const widths = csm.lights.map(
        (l) => l.shadow.camera.right - l.shadow.camera.left,
      );
      for (let i = 1; i < widths.length; i++)
        expect(widths[i]).toBeGreaterThan(widths[i - 1]);
      csm.dispose();
    });

    it("frustum is symmetric", () => {
      const csm = createTestCSM({ cascades: 3, maxFar: 100 });
      for (const l of csm.lights) {
        expect(l.shadow.camera.left).toBe(-l.shadow.camera.right);
        expect(l.shadow.camera.bottom).toBe(-l.shadow.camera.top);
      }
      csm.dispose();
    });
  });
});
