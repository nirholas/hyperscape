/**
 * AnimationLOD Unit Tests
 *
 * Tests for distance-based animation update throttling:
 * - LOD level transitions (Full → Half → Quarter → Frozen → Culled)
 * - Frame skipping and delta accumulation
 * - Boundary conditions and edge cases
 * - Configuration changes
 * - Performance characteristics
 *
 * Based on packages/shared/src/utils/rendering/AnimationLOD.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AnimationLOD,
  AnimationLODConfig,
  AnimationLODResult,
  DEFAULT_ANIMATION_LOD_CONFIG,
  ANIMATION_LOD_PRESETS,
  ANIMATION_LOD_ALWAYS_UPDATE,
  LOD_LEVEL,
  getCameraPosition,
  distanceSquaredXZ,
} from "../AnimationLOD";
import { DISTANCE_CONSTANTS } from "../../../constants/GameConstants";

describe("AnimationLOD", () => {
  // ===== CONSTANTS AND PRESETS =====
  describe("LOD_LEVEL constants", () => {
    it("should have correct numeric values", () => {
      expect(LOD_LEVEL.FULL).toBe(0);
      expect(LOD_LEVEL.HALF).toBe(1);
      expect(LOD_LEVEL.QUARTER).toBe(2);
      expect(LOD_LEVEL.FROZEN).toBe(3);
      expect(LOD_LEVEL.CULLED).toBe(4);
    });

    it("should be in ascending order", () => {
      expect(LOD_LEVEL.FULL).toBeLessThan(LOD_LEVEL.HALF);
      expect(LOD_LEVEL.HALF).toBeLessThan(LOD_LEVEL.QUARTER);
      expect(LOD_LEVEL.QUARTER).toBeLessThan(LOD_LEVEL.FROZEN);
      expect(LOD_LEVEL.FROZEN).toBeLessThan(LOD_LEVEL.CULLED);
    });
  });

  describe("DEFAULT_ANIMATION_LOD_CONFIG", () => {
    it("should use DISTANCE_CONSTANTS values", () => {
      expect(DEFAULT_ANIMATION_LOD_CONFIG.fullDistance).toBe(
        DISTANCE_CONSTANTS.ANIMATION_LOD.FULL,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.halfDistance).toBe(
        DISTANCE_CONSTANTS.ANIMATION_LOD.HALF,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.quarterDistance).toBe(
        DISTANCE_CONSTANTS.ANIMATION_LOD.QUARTER,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.freezeDistance).toBe(
        DISTANCE_CONSTANTS.ANIMATION_LOD.FROZEN,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.cullDistance).toBe(
        DISTANCE_CONSTANTS.ANIMATION_LOD.CULLED,
      );
    });

    it("should have distances in ascending order", () => {
      expect(DEFAULT_ANIMATION_LOD_CONFIG.fullDistance).toBeLessThan(
        DEFAULT_ANIMATION_LOD_CONFIG.halfDistance,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.halfDistance).toBeLessThan(
        DEFAULT_ANIMATION_LOD_CONFIG.quarterDistance,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.quarterDistance).toBeLessThanOrEqual(
        DEFAULT_ANIMATION_LOD_CONFIG.freezeDistance,
      );
      expect(DEFAULT_ANIMATION_LOD_CONFIG.freezeDistance).toBeLessThan(
        DEFAULT_ANIMATION_LOD_CONFIG.cullDistance,
      );
    });
  });

  describe("ANIMATION_LOD_PRESETS", () => {
    it("should have MOB preset with correct cull distance", () => {
      expect(ANIMATION_LOD_PRESETS.MOB.cullDistance).toBe(
        DISTANCE_CONSTANTS.RENDER.MOB,
      );
    });

    it("should have NPC preset with correct cull distance", () => {
      expect(ANIMATION_LOD_PRESETS.NPC.cullDistance).toBe(
        DISTANCE_CONSTANTS.RENDER.NPC,
      );
    });

    it("should have PLAYER preset with correct cull distance", () => {
      expect(ANIMATION_LOD_PRESETS.PLAYER.cullDistance).toBe(
        DISTANCE_CONSTANTS.RENDER.PLAYER,
      );
    });

    it("should share animation LOD distances across presets", () => {
      // Animation LOD levels should be consistent
      expect(ANIMATION_LOD_PRESETS.MOB.fullDistance).toBe(
        ANIMATION_LOD_PRESETS.NPC.fullDistance,
      );
      expect(ANIMATION_LOD_PRESETS.MOB.halfDistance).toBe(
        ANIMATION_LOD_PRESETS.PLAYER.halfDistance,
      );
    });
  });

  describe("ANIMATION_LOD_ALWAYS_UPDATE", () => {
    it("should have correct default values", () => {
      expect(ANIMATION_LOD_ALWAYS_UPDATE.shouldUpdate).toBe(true);
      expect(ANIMATION_LOD_ALWAYS_UPDATE.lodLevel).toBe(LOD_LEVEL.FULL);
      expect(ANIMATION_LOD_ALWAYS_UPDATE.shouldFreeze).toBe(false);
      expect(ANIMATION_LOD_ALWAYS_UPDATE.shouldApplyRestPose).toBe(false);
      expect(ANIMATION_LOD_ALWAYS_UPDATE.shouldCull).toBe(false);
    });

    it("should be frozen (immutable)", () => {
      expect(Object.isFrozen(ANIMATION_LOD_ALWAYS_UPDATE)).toBe(true);
    });
  });

  // ===== CORE FUNCTIONALITY =====
  describe("AnimationLOD class", () => {
    let lod: AnimationLOD;
    const deltaTime = 1 / 60; // 16.67ms

    beforeEach(() => {
      lod = new AnimationLOD();
    });

    describe("constructor", () => {
      it("should use default config when no config provided", () => {
        const result = lod.update(0, deltaTime); // Very close
        expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
      });

      it("should accept partial config", () => {
        const customLod = new AnimationLOD({ fullDistance: 50 });

        // At 40m, should still be FULL with custom config
        const result = customLod.update(40 * 40, deltaTime);
        expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
      });

      it("should handle pauseDistance backward compatibility", () => {
        const customLod = new AnimationLOD({
          pauseDistance: 50,
        } as AnimationLODConfig);

        // pauseDistance should map to freezeDistance
        expect(customLod.getFreezeDistanceSq()).toBe(50 * 50);
      });
    });

    describe("update() - LOD level determination", () => {
      it("should return FULL level when very close", () => {
        const result = lod.update(10 * 10, deltaTime); // 10m squared
        expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
        expect(result.shouldUpdate).toBe(true);
        expect(result.shouldFreeze).toBe(false);
      });

      it("should return HALF level at half distance", () => {
        const halfDist = DEFAULT_ANIMATION_LOD_CONFIG.halfDistance;
        const result = lod.update(halfDist * halfDist - 1, deltaTime);
        expect(result.lodLevel).toBe(LOD_LEVEL.HALF);
      });

      it("should return QUARTER level at quarter distance", () => {
        const quarterDist = DEFAULT_ANIMATION_LOD_CONFIG.quarterDistance;
        const result = lod.update(quarterDist * quarterDist - 1, deltaTime);
        expect(result.lodLevel).toBe(LOD_LEVEL.QUARTER);
      });

      it("should return FROZEN level in freeze zone (between quarter and freeze distance)", () => {
        // FROZEN zone is >80m and <=100m (quarterDistance to freezeDistance)
        // Use 90m which is firmly in the frozen zone
        const result = lod.update(90 * 90, deltaTime);
        expect(result.lodLevel).toBe(LOD_LEVEL.FROZEN);
        expect(result.shouldFreeze).toBe(true);
        expect(result.shouldUpdate).toBe(false);
      });

      it("should return CULLED level beyond cull distance", () => {
        const cullDist = DEFAULT_ANIMATION_LOD_CONFIG.cullDistance;
        const result = lod.update(cullDist * cullDist + 1, deltaTime);
        expect(result.lodLevel).toBe(LOD_LEVEL.CULLED);
        expect(result.shouldCull).toBe(true);
      });
    });

    describe("update() - frame skipping", () => {
      it("should update every frame at FULL level", () => {
        const distSq = 10 * 10;

        for (let i = 0; i < 10; i++) {
          const result = lod.update(distSq, deltaTime);
          expect(result.shouldUpdate).toBe(true);
        }
      });

      it("should update every other frame at HALF level", () => {
        const distSq = (DEFAULT_ANIMATION_LOD_CONFIG.halfDistance - 5) ** 2;

        const updates: boolean[] = [];
        for (let i = 0; i < 10; i++) {
          const result = lod.update(distSq, deltaTime);
          updates.push(result.shouldUpdate);
        }

        // Should alternate (first frame resets, so pattern may vary)
        const trueCount = updates.filter((u) => u).length;
        expect(trueCount).toBeGreaterThanOrEqual(4);
        expect(trueCount).toBeLessThanOrEqual(6);
      });

      it("should update every 4th frame at QUARTER level", () => {
        const distSq = (DEFAULT_ANIMATION_LOD_CONFIG.quarterDistance - 5) ** 2;

        const updates: boolean[] = [];
        for (let i = 0; i < 12; i++) {
          const result = lod.update(distSq, deltaTime);
          updates.push(result.shouldUpdate);
        }

        const trueCount = updates.filter((u) => u).length;
        expect(trueCount).toBeGreaterThanOrEqual(2);
        expect(trueCount).toBeLessThanOrEqual(4);
      });

      it("should never update when FROZEN or CULLED", () => {
        // Use 90m which is in the FROZEN zone (80-100m)
        const frozenDistSq = 90 * 90;

        for (let i = 0; i < 10; i++) {
          const result = lod.update(frozenDistSq, deltaTime);
          expect(result.shouldUpdate).toBe(false);
        }
      });
    });

    describe("update() - delta accumulation", () => {
      it("should return exact delta at FULL level", () => {
        const distSq = 10 * 10;
        const result = lod.update(distSq, deltaTime);
        expect(result.effectiveDelta).toBe(deltaTime);
      });

      it("should accumulate delta when skipping frames", () => {
        const distSq = (DEFAULT_ANIMATION_LOD_CONFIG.halfDistance - 5) ** 2;

        // First update after level change - small delta
        lod.update(distSq, deltaTime);

        // Keep updating until we get an accumulated update
        let maxDelta = 0;
        for (let i = 0; i < 10; i++) {
          const result = lod.update(distSq, deltaTime);
          if (result.effectiveDelta > maxDelta) {
            maxDelta = result.effectiveDelta;
          }
        }

        // Should have accumulated multiple frames' worth
        expect(maxDelta).toBeGreaterThanOrEqual(deltaTime);
      });

      it("should return zero delta when frozen", () => {
        // Use 90m which is in the FROZEN zone (80-100m)
        const frozenDistSq = 90 * 90;
        const result = lod.update(frozenDistSq, deltaTime);
        expect(result.effectiveDelta).toBe(0);
      });
    });

    describe("update() - rest pose trigger", () => {
      it("should trigger rest pose only on transition INTO frozen state", () => {
        // Start close (FULL level at 10m)
        lod.update(10 * 10, deltaTime);
        expect(lod.isFrozen()).toBe(false);

        // Move to frozen zone (90m, between 80-100m)
        const frozenDistSq = 90 * 90;
        const result = lod.update(frozenDistSq, deltaTime);

        expect(result.shouldApplyRestPose).toBe(true);
        expect(result.lodLevel).toBe(LOD_LEVEL.FROZEN);

        // Second update at frozen - should NOT trigger rest pose again
        const result2 = lod.update(frozenDistSq, deltaTime);
        expect(result2.shouldApplyRestPose).toBe(false);
      });

      it("should not trigger rest pose when moving from frozen to culled", () => {
        // Start frozen (90m)
        const frozenDistSq = 90 * 90;
        lod.update(frozenDistSq, deltaTime);
        expect(lod.isFrozen()).toBe(true);

        // Move to culled (beyond 100m freeze distance)
        const cullDistSq = 150 * 150;
        const result = lod.update(cullDistSq, deltaTime);

        // Rest pose already applied when entering frozen, not again when moving to culled
        expect(result.shouldApplyRestPose).toBe(false);
      });
    });

    describe("updateFromPosition()", () => {
      it("should compute correct squared distance", () => {
        const result = lod.updateFromPosition(100, 0, 0, 0, deltaTime);
        expect(result.distanceSq).toBe(10000); // 100^2
      });

      it("should use XZ distance only", () => {
        // Y coordinate doesn't matter for XZ distance
        const result = lod.updateFromPosition(100, 0, 0, 0, deltaTime);
        expect(result.distanceSq).toBe(10000);
      });

      it("should handle negative coordinates", () => {
        const result = lod.updateFromPosition(-50, -50, 50, 50, deltaTime);
        // Distance = sqrt((100)^2 + (100)^2) = ~141.4, squared = 20000
        expect(result.distanceSq).toBe(20000);
      });
    });

    describe("reset()", () => {
      it("should reset frame counter", () => {
        // Run some updates
        lod.update(10 * 10, deltaTime);
        lod.update(10 * 10, deltaTime);
        lod.update(10 * 10, deltaTime);

        lod.reset();

        expect(lod.getCurrentLevel()).toBe(0);
      });

      it("should reset accumulated delta", () => {
        const halfDistSq = (DEFAULT_ANIMATION_LOD_CONFIG.halfDistance - 5) ** 2;

        // Accumulate some delta
        lod.update(halfDistSq, deltaTime);
        lod.update(halfDistSq, deltaTime);

        lod.reset();

        // After reset, should get fresh delta
        const result = lod.update(10 * 10, deltaTime);
        expect(result.effectiveDelta).toBe(deltaTime);
      });
    });

    describe("getCurrentLevel()", () => {
      it("should return last computed LOD level", () => {
        lod.update(10 * 10, deltaTime);
        expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.FULL);

        // Use 90m which is in the FROZEN zone (80-100m)
        const frozenDistSq = 90 * 90;
        lod.update(frozenDistSq, deltaTime);
        expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.FROZEN);
      });
    });

    describe("isFrozen() / isPaused()", () => {
      it("isFrozen() should return true when at FROZEN level", () => {
        // Use 90m which is in the FROZEN zone (80-100m)
        const frozenDistSq = 90 * 90;
        lod.update(frozenDistSq, deltaTime);
        expect(lod.isFrozen()).toBe(true);
      });

      it("isFrozen() should return true when CULLED", () => {
        const cullDistSq =
          (DEFAULT_ANIMATION_LOD_CONFIG.cullDistance + 100) ** 2;
        lod.update(cullDistSq, deltaTime);
        expect(lod.isFrozen()).toBe(true);
      });

      it("isPaused() should be alias for isFrozen()", () => {
        // Use 90m which is in the FROZEN zone (80-100m)
        const frozenDistSq = 90 * 90;
        lod.update(frozenDistSq, deltaTime);
        expect(lod.isPaused()).toBe(lod.isFrozen());
      });
    });

    describe("isCulled()", () => {
      it("should return true when beyond cull distance", () => {
        const cullDistSq =
          (DEFAULT_ANIMATION_LOD_CONFIG.cullDistance + 100) ** 2;
        lod.update(cullDistSq, deltaTime);
        expect(lod.isCulled()).toBe(true);
      });

      it("should return false when frozen (in freeze zone, not yet culled)", () => {
        // FROZEN zone is between quarterDistance (80m) and freezeDistance (100m)
        // Use 90m which is in the frozen zone
        const frozenDistSq = 90 * 90;
        lod.update(frozenDistSq, deltaTime);
        expect(lod.isCulled()).toBe(false);
        expect(lod.isFrozen()).toBe(true);
      });
    });

    describe("getters", () => {
      it("getFreezeDistanceSq() should return squared freeze distance", () => {
        expect(lod.getFreezeDistanceSq()).toBe(
          DEFAULT_ANIMATION_LOD_CONFIG.freezeDistance ** 2,
        );
      });

      it("getCullDistanceSq() should return squared cull distance", () => {
        expect(lod.getCullDistanceSq()).toBe(
          DEFAULT_ANIMATION_LOD_CONFIG.cullDistance ** 2,
        );
      });
    });

    describe("setConfig()", () => {
      it("should update freeze distance", () => {
        lod.setConfig({ freezeDistance: 50 });
        expect(lod.getFreezeDistanceSq()).toBe(2500);
      });

      it("should handle pauseDistance backward compatibility", () => {
        lod.setConfig({ pauseDistance: 75 } as Partial<AnimationLODConfig>);
        expect(lod.getFreezeDistanceSq()).toBe(75 * 75);
      });

      it("should recalculate squared distances", () => {
        lod.setConfig({ cullDistance: 300 });
        expect(lod.getCullDistanceSq()).toBe(90000);
      });
    });
  });

  // ===== BOUNDARY CONDITIONS =====
  describe("boundary conditions", () => {
    let lod: AnimationLOD;
    const deltaTime = 1 / 60;

    beforeEach(() => {
      lod = new AnimationLOD();
    });

    it("should handle zero distance", () => {
      const result = lod.update(0, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
      expect(result.shouldUpdate).toBe(true);
    });

    it("should handle exact boundary at fullDistance", () => {
      const dist = DEFAULT_ANIMATION_LOD_CONFIG.fullDistance;
      const result = lod.update(dist * dist, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
    });

    it("should handle just past fullDistance", () => {
      const dist = DEFAULT_ANIMATION_LOD_CONFIG.fullDistance + 0.01;
      const result = lod.update(dist * dist, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.HALF);
    });

    it("should handle very large distances", () => {
      const result = lod.update(1e12, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.CULLED);
      expect(result.shouldCull).toBe(true);
    });

    it("should handle zero delta time", () => {
      const result = lod.update(10 * 10, 0);
      expect(result.shouldUpdate).toBe(true);
      expect(result.effectiveDelta).toBe(0);
    });

    it("should handle very large delta time", () => {
      const result = lod.update(10 * 10, 10); // 10 second delta
      expect(result.shouldUpdate).toBe(true);
      expect(result.effectiveDelta).toBe(10);
    });

    it("should handle negative delta time (clock skew)", () => {
      // Negative delta shouldn't crash, though behavior is undefined
      const result = lod.update(10 * 10, -0.016);
      expect(result).toBeDefined();
    });
  });

  // ===== LEVEL TRANSITIONS =====
  describe("level transitions", () => {
    let lod: AnimationLOD;
    const deltaTime = 1 / 60;

    beforeEach(() => {
      lod = new AnimationLOD();
    });

    it("should reset accumulator on level change (prevents time jumps)", () => {
      // Stay at HALF for a while
      const halfDistSq = (DEFAULT_ANIMATION_LOD_CONFIG.halfDistance - 5) ** 2;
      for (let i = 0; i < 5; i++) {
        lod.update(halfDistSq, deltaTime);
      }

      // Transition to FULL
      const result = lod.update(10 * 10, deltaTime);

      // Should get just the current delta, not accumulated
      expect(result.effectiveDelta).toBe(deltaTime);
    });

    it("should handle rapid level changes", () => {
      const distances = [10, 50, 70, 90, 200, 50, 10];

      for (const dist of distances) {
        const result = lod.update(dist * dist, deltaTime);
        expect(result).toBeDefined();
        expect(result.lodLevel).toBeGreaterThanOrEqual(0);
        expect(result.lodLevel).toBeLessThanOrEqual(4);
      }
    });

    it("should track last LOD level correctly through transitions", () => {
      // FULL: <= 30m
      lod.update(10 * 10, deltaTime);
      expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.FULL);

      // HALF: > 30m and <= 60m
      lod.update(50 * 50, deltaTime);
      expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.HALF);

      // QUARTER: > 60m and <= 80m
      lod.update(75 * 75, deltaTime);
      expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.QUARTER);

      // FROZEN: > 80m and <= 100m
      lod.update(95 * 95, deltaTime);
      expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.FROZEN);

      // CULLED: > 100m (freezeDistance)
      lod.update(110 * 110, deltaTime);
      expect(lod.getCurrentLevel()).toBe(LOD_LEVEL.CULLED);
    });
  });

  // ===== UTILITY FUNCTIONS =====
  describe("getCameraPosition()", () => {
    it("should extract x,z from camera position", () => {
      const world = {
        camera: {
          position: { x: 100, y: 50, z: 200 },
        },
      };

      const pos = getCameraPosition(world);
      expect(pos).toEqual({ x: 100, z: 200 });
    });

    it("should return null if no camera", () => {
      const world = {};
      expect(getCameraPosition(world)).toBeNull();
    });

    it("should return null if no camera position", () => {
      const world = { camera: {} };
      expect(getCameraPosition(world)).toBeNull();
    });
  });

  describe("distanceSquaredXZ()", () => {
    it("should compute correct squared distance", () => {
      expect(distanceSquaredXZ(0, 0, 3, 4)).toBe(25); // 3-4-5 triangle
    });

    it("should handle same point", () => {
      expect(distanceSquaredXZ(100, 200, 100, 200)).toBe(0);
    });

    it("should handle negative coordinates", () => {
      expect(distanceSquaredXZ(-5, -5, 5, 5)).toBe(200); // 10^2 + 10^2
    });

    it("should be commutative", () => {
      const d1 = distanceSquaredXZ(10, 20, 30, 40);
      const d2 = distanceSquaredXZ(30, 40, 10, 20);
      expect(d1).toBe(d2);
    });
  });

  // ===== PERFORMANCE =====
  describe("performance", () => {
    it("should handle 10000 updates efficiently", () => {
      const lod = new AnimationLOD();
      const deltaTime = 1 / 60;

      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        const dist = Math.random() * 300;
        lod.update(dist * dist, deltaTime);
      }

      const elapsed = performance.now() - start;

      // 10000 updates should complete in under 20ms
      expect(elapsed).toBeLessThan(20);
    });

    it("should reuse result object (no allocations per update)", () => {
      const lod = new AnimationLOD();
      const deltaTime = 1 / 60;

      const result1 = lod.update(100, deltaTime);
      const result2 = lod.update(200, deltaTime);

      // Same object should be reused
      expect(result1).toBe(result2);
    });
  });

  // ===== REAL-WORLD SCENARIOS =====
  describe("real-world scenarios", () => {
    it("should simulate player approaching mob", () => {
      const lod = new AnimationLOD(ANIMATION_LOD_PRESETS.MOB);
      const deltaTime = 1 / 60;

      // Mob at origin, player starts far
      // LOD distances: FULL=30, HALF=60, QUARTER=80, FROZEN=100, CULLED>100
      const mobX = 0,
        mobZ = 0;
      let playerX = 180;

      // Far away (180m) - culled (beyond freeze distance of 100m)
      let result = lod.updateFromPosition(mobX, mobZ, playerX, 0, deltaTime);
      expect(result.shouldCull).toBe(true);
      expect(result.lodLevel).toBe(LOD_LEVEL.CULLED);

      // Player approaches to 95m - frozen (between 80m and 100m)
      playerX = 95;
      result = lod.updateFromPosition(mobX, mobZ, playerX, 0, deltaTime);
      expect(result.shouldFreeze).toBe(true);
      expect(result.shouldCull).toBe(false);
      expect(result.lodLevel).toBe(LOD_LEVEL.FROZEN);

      // Closer to 75m - quarter (between 60m and 80m)
      playerX = 75;
      result = lod.updateFromPosition(mobX, mobZ, playerX, 0, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.QUARTER);

      // Close at 20m - full (under 30m)
      playerX = 20;
      result = lod.updateFromPosition(mobX, mobZ, playerX, 0, deltaTime);
      expect(result.lodLevel).toBe(LOD_LEVEL.FULL);
    });

    it("should handle crowd of entities at varying distances", () => {
      const lod = new AnimationLOD();
      const deltaTime = 1 / 60;

      // Simulate 100 entities at random distances
      const results = {
        full: 0,
        half: 0,
        quarter: 0,
        frozen: 0,
        culled: 0,
      };

      for (let i = 0; i < 100; i++) {
        const dist = Math.random() * 250;
        const result = lod.update(dist * dist, deltaTime);

        switch (result.lodLevel) {
          case LOD_LEVEL.FULL:
            results.full++;
            break;
          case LOD_LEVEL.HALF:
            results.half++;
            break;
          case LOD_LEVEL.QUARTER:
            results.quarter++;
            break;
          case LOD_LEVEL.FROZEN:
            results.frozen++;
            break;
          case LOD_LEVEL.CULLED:
            results.culled++;
            break;
        }

        // Reset for next entity simulation
        lod.reset();
      }

      // Verify distribution makes sense (random distances from 0-250m)
      // With default config: 30m FULL, 60m HALF, 80m QUARTER, 100m FROZEN, 150m CULLED
      expect(
        results.full +
          results.half +
          results.quarter +
          results.frozen +
          results.culled,
      ).toBe(100);
    });
  });
});
