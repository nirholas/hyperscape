/**
 * DistanceFade Unit Tests
 *
 * Tests for distance-based entity fade/dissolve system:
 * - Fade state calculation based on distance
 * - Configuration handling
 * - Boundary conditions
 * - FadeState transitions
 *
 * Note: These tests focus on the logic layer. Full Three.js material tests
 * would require a WebGL context which is better suited for integration tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DistanceFadeController,
  ENTITY_FADE_CONFIGS,
  FadeState,
} from "../DistanceFade";
import { DISTANCE_CONSTANTS } from "../../../constants/GameConstants";
import THREE from "../../../extras/three/three";

describe("DistanceFade", () => {
  // ===== ENTITY_FADE_CONFIGS TESTS =====
  describe("ENTITY_FADE_CONFIGS", () => {
    it("should have MOB config with correct values", () => {
      expect(ENTITY_FADE_CONFIGS.MOB.fadeStart).toBe(
        DISTANCE_CONSTANTS.RENDER.MOB_FADE_START,
      );
      expect(ENTITY_FADE_CONFIGS.MOB.fadeEnd).toBe(
        DISTANCE_CONSTANTS.RENDER.MOB,
      );
      expect(ENTITY_FADE_CONFIGS.MOB.fadeStartSq).toBe(
        DISTANCE_CONSTANTS.RENDER_SQ.MOB_FADE_START,
      );
      expect(ENTITY_FADE_CONFIGS.MOB.fadeEndSq).toBe(
        DISTANCE_CONSTANTS.RENDER_SQ.MOB,
      );
    });

    it("should have NPC config with correct values", () => {
      expect(ENTITY_FADE_CONFIGS.NPC.fadeStart).toBe(
        DISTANCE_CONSTANTS.RENDER.NPC_FADE_START,
      );
      expect(ENTITY_FADE_CONFIGS.NPC.fadeEnd).toBe(
        DISTANCE_CONSTANTS.RENDER.NPC,
      );
    });

    it("should have PLAYER config with correct values", () => {
      expect(ENTITY_FADE_CONFIGS.PLAYER.fadeStart).toBe(
        DISTANCE_CONSTANTS.RENDER.PLAYER_FADE_START,
      );
      expect(ENTITY_FADE_CONFIGS.PLAYER.fadeEnd).toBe(
        DISTANCE_CONSTANTS.RENDER.PLAYER,
      );
    });

    it("should have fadeStart < fadeEnd for all configs", () => {
      expect(ENTITY_FADE_CONFIGS.MOB.fadeStart).toBeLessThan(
        ENTITY_FADE_CONFIGS.MOB.fadeEnd,
      );
      expect(ENTITY_FADE_CONFIGS.NPC.fadeStart).toBeLessThan(
        ENTITY_FADE_CONFIGS.NPC.fadeEnd,
      );
      expect(ENTITY_FADE_CONFIGS.PLAYER.fadeStart).toBeLessThan(
        ENTITY_FADE_CONFIGS.PLAYER.fadeEnd,
      );
    });

    it("should have pre-computed squared distances", () => {
      expect(ENTITY_FADE_CONFIGS.MOB.fadeStartSq).toBe(
        ENTITY_FADE_CONFIGS.MOB.fadeStart ** 2,
      );
      expect(ENTITY_FADE_CONFIGS.MOB.fadeEndSq).toBe(
        ENTITY_FADE_CONFIGS.MOB.fadeEnd ** 2,
      );
    });
  });

  // ===== DISTANCE_FADE_CONTROLLER TESTS =====
  describe("DistanceFadeController", () => {
    let controller: DistanceFadeController;
    let rootObject: THREE.Object3D;

    const testConfig = {
      fadeStart: 100,
      fadeEnd: 150,
      fadeStartSq: 10000,
      fadeEndSq: 22500,
    };

    beforeEach(() => {
      // Create a simple Object3D hierarchy for testing
      rootObject = new THREE.Object3D();
      rootObject.visible = true;

      // Disable shader fade for unit tests (no WebGL context)
      controller = new DistanceFadeController(rootObject, testConfig, false);
    });

    describe("constructor", () => {
      it("should initialize with provided config", () => {
        expect(controller.getState()).toBe(FadeState.VISIBLE);
        expect(controller.getFadeAmount()).toBe(0);
      });

      it("should compute squared distances if not provided", () => {
        const simpleConfig = { fadeStart: 50, fadeEnd: 100 };
        const ctrl = new DistanceFadeController(
          rootObject,
          simpleConfig,
          false,
        );

        // Test via update at fadeStart distance
        ctrl.update(0, 0, 50, 0); // Distance = 50 (fadeStart)
        expect(ctrl.getState()).toBe(FadeState.VISIBLE);
      });
    });

    describe("update", () => {
      it("should return VISIBLE state when entity is close", () => {
        const result = controller.update(0, 0, 50, 0); // Distance = 50

        expect(result.state).toBe(FadeState.VISIBLE);
        expect(result.fadeAmount).toBe(0);
        expect(result.visible).toBe(true);
      });

      it("should return FADING state in fade zone", () => {
        // Distance of 125m (between 100 and 150)
        const result = controller.update(0, 0, 125, 0);

        expect(result.state).toBe(FadeState.FADING);
        expect(result.fadeAmount).toBeGreaterThan(0);
        expect(result.fadeAmount).toBeLessThan(1);
        expect(result.visible).toBe(true);
      });

      it("should return CULLED state when entity is far", () => {
        const result = controller.update(0, 0, 200, 0); // Distance = 200

        expect(result.state).toBe(FadeState.CULLED);
        expect(result.fadeAmount).toBe(1);
        expect(result.visible).toBe(false);
      });

      it("should calculate linear fade amount in fade zone", () => {
        // At fadeStart (100m) -> fadeAmount = 0
        const atStart = controller.update(0, 0, 100, 0);
        expect(atStart.fadeAmount).toBeCloseTo(0, 2);

        // At fadeEnd (150m) -> fadeAmount = 1
        const atEnd = controller.update(0, 0, 150, 0);
        expect(atEnd.fadeAmount).toBeCloseTo(1, 2);

        // At midpoint (125m) -> fadeAmount = 0.5
        const atMid = controller.update(0, 0, 125, 0);
        expect(atMid.fadeAmount).toBeCloseTo(0.5, 1);
      });

      it("should use XZ distance (ignore Y)", () => {
        // Entity at (100, 1000, 0) - high Y should not affect distance
        const result = controller.update(0, 0, 100, 0);
        expect(result.state).toBe(FadeState.VISIBLE); // XZ distance = 100
      });

      it("should include squared distance in result", () => {
        const result = controller.update(0, 0, 100, 0);
        expect(result.distanceSq).toBe(10000); // 100^2
      });

      it("should handle negative coordinates", () => {
        const result = controller.update(-50, -50, 50, 50);
        // Distance = sqrt((100)^2 + (100)^2) = ~141.4
        expect(result.distanceSq).toBeCloseTo(20000, 0);
      });

      it("should handle entity at same position as camera", () => {
        const result = controller.update(100, 100, 100, 100);
        expect(result.distanceSq).toBe(0);
        expect(result.state).toBe(FadeState.VISIBLE);
      });
    });

    describe("state transitions", () => {
      it("should transition from VISIBLE to FADING", () => {
        controller.update(0, 0, 50, 0); // VISIBLE
        const result = controller.update(0, 0, 125, 0); // FADING

        expect(result.state).toBe(FadeState.FADING);
      });

      it("should transition from FADING to CULLED", () => {
        controller.update(0, 0, 125, 0); // FADING
        const result = controller.update(0, 0, 200, 0); // CULLED

        expect(result.state).toBe(FadeState.CULLED);
      });

      it("should transition from CULLED back to VISIBLE", () => {
        controller.update(0, 0, 200, 0); // CULLED
        const result = controller.update(0, 0, 50, 0); // VISIBLE

        expect(result.state).toBe(FadeState.VISIBLE);
        expect(rootObject.visible).toBe(true);
      });

      it("should not update if state unchanged and fade delta < threshold", () => {
        controller.update(0, 0, 50, 0);
        controller.update(0, 0, 51, 0); // Tiny change

        // State should remain VISIBLE
        expect(controller.getState()).toBe(FadeState.VISIBLE);
      });
    });

    describe("visibility control", () => {
      it("should set rootObject.visible = false when culled", () => {
        controller.update(0, 0, 200, 0);
        expect(rootObject.visible).toBe(false);
      });

      it("should set rootObject.visible = true when not culled", () => {
        controller.update(0, 0, 200, 0); // Cull
        controller.update(0, 0, 50, 0); // Unculled

        expect(rootObject.visible).toBe(true);
      });
    });

    describe("setCulled / setVisible", () => {
      it("should immediately cull with setCulled()", () => {
        controller.setCulled();

        expect(controller.getState()).toBe(FadeState.CULLED);
        expect(controller.getFadeAmount()).toBe(1);
        expect(rootObject.visible).toBe(false);
      });

      it("should immediately show with setVisible()", () => {
        controller.setCulled();
        controller.setVisible();

        expect(controller.getState()).toBe(FadeState.VISIBLE);
        expect(controller.getFadeAmount()).toBe(0);
        expect(rootObject.visible).toBe(true);
      });
    });

    describe("setConfig", () => {
      it("should update fadeStart", () => {
        controller.setConfig({ fadeStart: 200 });

        // At 150m (was fadeEnd, now < fadeStart), should be VISIBLE
        const result = controller.update(0, 0, 150, 0);
        expect(result.state).toBe(FadeState.VISIBLE);
      });

      it("should update fadeEnd", () => {
        controller.setConfig({ fadeEnd: 200 });

        // At 175m, should now be FADING (was CULLED)
        const result = controller.update(0, 0, 175, 0);
        expect(result.state).toBe(FadeState.FADING);
      });

      it("should auto-compute squared values when setting linear values", () => {
        controller.setConfig({ fadeStart: 50, fadeEnd: 100 });

        const result = controller.update(0, 0, 75, 0);
        expect(result.state).toBe(FadeState.FADING);
      });
    });

    describe("getters", () => {
      it("getState() should return current state", () => {
        expect(controller.getState()).toBe(FadeState.VISIBLE);

        controller.update(0, 0, 200, 0);
        expect(controller.getState()).toBe(FadeState.CULLED);
      });

      it("getFadeAmount() should return current fade amount", () => {
        expect(controller.getFadeAmount()).toBe(0);

        controller.update(0, 0, 125, 0);
        expect(controller.getFadeAmount()).toBeGreaterThan(0);
      });

      it("isVisible() should return visibility state", () => {
        expect(controller.isVisible()).toBe(true);

        controller.update(0, 0, 200, 0);
        expect(controller.isVisible()).toBe(false);
      });

      it("hasShaderFade() should return shader fade status", () => {
        // We disabled shader fade in constructor
        expect(controller.hasShaderFade()).toBe(false);
      });
    });

    describe("dispose", () => {
      it("should clean up internal state", () => {
        controller.dispose();
        expect(controller.hasShaderFade()).toBe(false);
      });
    });
  });

  // ===== BOUNDARY CONDITIONS =====
  describe("boundary conditions", () => {
    let controller: DistanceFadeController;
    let rootObject: THREE.Object3D;

    beforeEach(() => {
      rootObject = new THREE.Object3D();
      controller = new DistanceFadeController(
        rootObject,
        ENTITY_FADE_CONFIGS.MOB,
        false,
      );
    });

    it("should handle very small distances", () => {
      const result = controller.update(0, 0, 0.001, 0);
      expect(result.state).toBe(FadeState.VISIBLE);
    });

    it("should handle very large distances", () => {
      const result = controller.update(0, 0, 1000000, 0);
      expect(result.state).toBe(FadeState.CULLED);
    });

    it("should handle exact fadeStart distance", () => {
      const result = controller.update(
        0,
        0,
        ENTITY_FADE_CONFIGS.MOB.fadeStart,
        0,
      );
      expect(result.state).toBe(FadeState.VISIBLE);
      expect(result.fadeAmount).toBe(0);
    });

    it("should handle exact fadeEnd distance", () => {
      const result = controller.update(
        0,
        0,
        ENTITY_FADE_CONFIGS.MOB.fadeEnd,
        0,
      );
      expect(result.state).toBe(FadeState.CULLED);
      expect(result.fadeAmount).toBe(1);
    });

    it("should handle zero config values gracefully", () => {
      const ctrl = new DistanceFadeController(
        rootObject,
        {
          fadeStart: 0,
          fadeEnd: 100,
        },
        false,
      );

      const result = ctrl.update(0, 0, 50, 0);
      expect(result.state).toBe(FadeState.FADING);
    });

    it("should handle equal fadeStart and fadeEnd", () => {
      const ctrl = new DistanceFadeController(
        rootObject,
        {
          fadeStart: 100,
          fadeEnd: 100,
        },
        false,
      );

      // At exactly 100m should be VISIBLE (distanceSq <= fadeStartSq)
      const atBoundary = ctrl.update(0, 0, 100, 0);
      expect(atBoundary.state).toBe(FadeState.VISIBLE);

      // Just past 100m should be CULLED (distanceSq >= fadeEndSq)
      const pastBoundary = ctrl.update(0, 0, 101, 0);
      expect(pastBoundary.state).toBe(FadeState.CULLED);
    });
  });

  // ===== PERFORMANCE =====
  describe("performance", () => {
    it("should handle rapid updates efficiently", () => {
      const rootObject = new THREE.Object3D();
      const controller = new DistanceFadeController(
        rootObject,
        ENTITY_FADE_CONFIGS.MOB,
        false,
      );

      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        controller.update(
          Math.random() * 1000,
          Math.random() * 1000,
          Math.random() * 1000,
          Math.random() * 1000,
        );
      }

      const elapsed = performance.now() - start;

      // 10000 updates should complete in under 50ms
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ===== REAL WORLD SCENARIOS =====
  describe("real world scenarios", () => {
    it("should correctly fade mob as player approaches", () => {
      const rootObject = new THREE.Object3D();
      const controller = new DistanceFadeController(
        rootObject,
        ENTITY_FADE_CONFIGS.MOB,
        false,
      );

      // Mob at origin, player starts far away
      let playerX = 200;

      // Far away - culled
      let result = controller.update(playerX, 0, 0, 0);
      expect(result.state).toBe(FadeState.CULLED);

      // Player approaches - enters fade zone
      playerX = 140;
      result = controller.update(playerX, 0, 0, 0);
      expect(result.state).toBe(FadeState.FADING);

      // Player closer - fully visible
      playerX = 50;
      result = controller.update(playerX, 0, 0, 0);
      expect(result.state).toBe(FadeState.VISIBLE);
    });

    it("should correctly handle mob moving away from player", () => {
      const rootObject = new THREE.Object3D();
      const controller = new DistanceFadeController(
        rootObject,
        ENTITY_FADE_CONFIGS.MOB,
        false,
      );

      // Player at origin
      const playerX = 0,
        playerZ = 0;

      // Mob starts close
      let result = controller.update(playerX, playerZ, 50, 0);
      expect(result.state).toBe(FadeState.VISIBLE);

      // Mob moves to fade zone
      result = controller.update(playerX, playerZ, 140, 0);
      expect(result.state).toBe(FadeState.FADING);

      // Mob moves beyond render distance
      result = controller.update(playerX, playerZ, 200, 0);
      expect(result.state).toBe(FadeState.CULLED);
    });
  });
});
