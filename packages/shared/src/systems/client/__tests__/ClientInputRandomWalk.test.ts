/**
 * Algorithm Documentation Tests for ClientInput Random Walk
 *
 * These tests document and verify the mathematical algorithms used by
 * ClientInput's random walk behavior. They test the formulas in isolation,
 * not the actual ClientInput class (which requires a full World context).
 *
 * The algorithms tested here match the implementation in ClientInput.ts:
 * - Target generation: random angle and distance within [MIN_RADIUS, RADIUS]
 * - Direction calculation: normalized vector from current to target
 * - Arrival detection: distance <= STOP_DISTANCE
 * - Pause time: random duration within [PAUSE_MIN, PAUSE_MAX]
 *
 * Full integration testing of ClientInput requires Playwright tests.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TileInterpolator } from "../TileInterpolator";
import {
  TICK_DURATION_MS,
  TILES_PER_TICK_RUN,
  tileToWorld,
} from "../../shared/movement/TileSystem";

// Random walk constants (must match ClientInput.ts)
const RANDOM_WALK_CONFIG = {
  RADIUS: 15.0, // Max distance to walk
  MIN_RADIUS: 5.0, // Min distance to walk
  PAUSE_MIN: 2000, // Min pause between walks (ms)
  PAUSE_MAX: 5000, // Max pause between walks (ms)
  STOP_DISTANCE: 2.0, // Distance to stop at
};

describe("ClientInput Random Walk", () => {
  describe("Target Generation", () => {
    /**
     * Generate a random walk target position
     */
    function generateRandomTarget(
      currentX: number,
      currentZ: number,
      rng: () => number = Math.random,
    ): { x: number; z: number; distance: number; angle: number } {
      const angle = rng() * Math.PI * 2;
      const distance =
        RANDOM_WALK_CONFIG.MIN_RADIUS +
        rng() * (RANDOM_WALK_CONFIG.RADIUS - RANDOM_WALK_CONFIG.MIN_RADIUS);

      return {
        x: currentX + Math.cos(angle) * distance,
        z: currentZ + Math.sin(angle) * distance,
        distance,
        angle,
      };
    }

    it("generates targets within min/max radius range", () => {
      for (let i = 0; i < 100; i++) {
        const target = generateRandomTarget(0, 0);
        const dist = Math.sqrt(target.x * target.x + target.z * target.z);

        expect(dist).toBeGreaterThanOrEqual(
          RANDOM_WALK_CONFIG.MIN_RADIUS * 0.99,
        );
        expect(dist).toBeLessThanOrEqual(RANDOM_WALK_CONFIG.RADIUS * 1.01);
      }
    });

    it("generates targets around the current position", () => {
      const currentX = 100;
      const currentZ = 200;

      for (let i = 0; i < 100; i++) {
        const target = generateRandomTarget(currentX, currentZ);
        const dx = target.x - currentX;
        const dz = target.z - currentZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        expect(dist).toBeGreaterThanOrEqual(
          RANDOM_WALK_CONFIG.MIN_RADIUS * 0.99,
        );
        expect(dist).toBeLessThanOrEqual(RANDOM_WALK_CONFIG.RADIUS * 1.01);
      }
    });

    it("generates targets in all directions (360 degrees)", () => {
      const quadrants = { q1: 0, q2: 0, q3: 0, q4: 0 };

      for (let i = 0; i < 1000; i++) {
        const target = generateRandomTarget(0, 0);

        if (target.x >= 0 && target.z >= 0) quadrants.q1++;
        else if (target.x < 0 && target.z >= 0) quadrants.q2++;
        else if (target.x < 0 && target.z < 0) quadrants.q3++;
        else quadrants.q4++;
      }

      // Each quadrant should have roughly 250 targets (25%)
      // Allow for randomness with 15-35% range
      for (const count of Object.values(quadrants)) {
        expect(count).toBeGreaterThan(150);
        expect(count).toBeLessThan(350);
      }
    });

    it("uses deterministic RNG correctly", () => {
      let rngState = 0;
      const deterministicRng = () => {
        rngState = (rngState + 0.3) % 1;
        return rngState;
      };

      const target1 = generateRandomTarget(0, 0, deterministicRng);
      rngState = 0; // Reset
      const target2 = generateRandomTarget(0, 0, deterministicRng);

      expect(target1.x).toBe(target2.x);
      expect(target1.z).toBe(target2.z);
    });
  });

  describe("Movement Direction Calculation", () => {
    /**
     * Calculate normalized direction from current to target
     */
    function calculateDirection(
      currentX: number,
      currentZ: number,
      targetX: number,
      targetZ: number,
    ): { dirX: number; dirZ: number; distance: number } {
      const dx = targetX - currentX;
      const dz = targetZ - currentZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance === 0) {
        return { dirX: 0, dirZ: 0, distance: 0 };
      }

      return {
        dirX: dx / distance,
        dirZ: dz / distance,
        distance,
      };
    }

    it("calculates correct direction to target", () => {
      const dir = calculateDirection(0, 0, 10, 0);

      expect(dir.dirX).toBeCloseTo(1, 5);
      expect(dir.dirZ).toBeCloseTo(0, 5);
      expect(dir.distance).toBeCloseTo(10, 5);
    });

    it("handles diagonal directions", () => {
      const dir = calculateDirection(0, 0, 10, 10);

      expect(dir.dirX).toBeCloseTo(Math.SQRT1_2, 5);
      expect(dir.dirZ).toBeCloseTo(Math.SQRT1_2, 5);
      expect(dir.distance).toBeCloseTo(Math.sqrt(200), 5);
    });

    it("handles negative directions", () => {
      const dir = calculateDirection(10, 10, 0, 0);

      expect(dir.dirX).toBeCloseTo(-Math.SQRT1_2, 5);
      expect(dir.dirZ).toBeCloseTo(-Math.SQRT1_2, 5);
    });

    it("returns zero direction at same position", () => {
      const dir = calculateDirection(5, 5, 5, 5);

      expect(dir.dirX).toBe(0);
      expect(dir.dirZ).toBe(0);
      expect(dir.distance).toBe(0);
    });

    it("direction is always normalized (unit vector)", () => {
      const testCases = [
        { from: [0, 0], to: [100, 0] },
        { from: [0, 0], to: [0, 100] },
        { from: [50, 50], to: [100, 100] },
        { from: [0, 0], to: [3, 4] },
      ];

      for (const { from, to } of testCases) {
        const dir = calculateDirection(from[0], from[1], to[0], to[1]);

        if (dir.distance > 0) {
          const length = Math.sqrt(dir.dirX * dir.dirX + dir.dirZ * dir.dirZ);
          expect(length).toBeCloseTo(1, 5);
        }
      }
    });
  });

  describe("Arrival Detection", () => {
    /**
     * Check if we've arrived at the target
     */
    function hasArrived(
      currentX: number,
      currentZ: number,
      targetX: number,
      targetZ: number,
      stopDistance: number = RANDOM_WALK_CONFIG.STOP_DISTANCE,
    ): boolean {
      const dx = targetX - currentX;
      const dz = targetZ - currentZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      return distance <= stopDistance;
    }

    it("returns true when at exact target", () => {
      expect(hasArrived(10, 10, 10, 10)).toBe(true);
    });

    it("returns true when within stop distance", () => {
      expect(hasArrived(10, 10, 11, 10)).toBe(true); // 1m away
      expect(hasArrived(10, 10, 11.5, 10)).toBe(true); // 1.5m away
      expect(hasArrived(10, 10, 11.9, 10)).toBe(true); // 1.9m away
    });

    it("returns false when beyond stop distance", () => {
      expect(hasArrived(10, 10, 13, 10)).toBe(false); // 3m away
      expect(hasArrived(10, 10, 15, 15)).toBe(false); // ~7m away
    });

    it("handles exact boundary correctly", () => {
      // At exactly stop distance
      expect(hasArrived(0, 0, 2, 0)).toBe(true); // Exactly 2m
      expect(hasArrived(0, 0, 2.001, 0)).toBe(false); // Just over 2m
    });

    it("handles custom stop distances", () => {
      expect(hasArrived(0, 0, 5, 0, 10)).toBe(true);
      expect(hasArrived(0, 0, 15, 0, 10)).toBe(false);
    });
  });

  describe("Pause Time Generation", () => {
    /**
     * Generate a random pause duration
     */
    function generatePauseTime(rng: () => number = Math.random): number {
      return (
        RANDOM_WALK_CONFIG.PAUSE_MIN +
        rng() * (RANDOM_WALK_CONFIG.PAUSE_MAX - RANDOM_WALK_CONFIG.PAUSE_MIN)
      );
    }

    it("generates pause times within configured range", () => {
      for (let i = 0; i < 100; i++) {
        const pause = generatePauseTime();

        expect(pause).toBeGreaterThanOrEqual(RANDOM_WALK_CONFIG.PAUSE_MIN);
        expect(pause).toBeLessThanOrEqual(RANDOM_WALK_CONFIG.PAUSE_MAX);
      }
    });

    it("generates minimum pause at rng=0", () => {
      const pause = generatePauseTime(() => 0);
      expect(pause).toBe(RANDOM_WALK_CONFIG.PAUSE_MIN);
    });

    it("generates maximum pause at rng=1", () => {
      const pause = generatePauseTime(() => 0.9999999);
      expect(pause).toBeCloseTo(RANDOM_WALK_CONFIG.PAUSE_MAX, 0);
    });

    it("generates varied pause times", () => {
      const pauses = new Set<number>();
      for (let i = 0; i < 100; i++) {
        pauses.add(Math.round(generatePauseTime() / 100) * 100); // Round to 100ms buckets
      }

      // Should have variety in pause times
      expect(pauses.size).toBeGreaterThan(10);
    });
  });

  describe("Random Walk State Machine", () => {
    type WalkState = "idle" | "walking" | "pausing" | "stopped";

    interface RandomWalkContext {
      state: WalkState;
      target: { x: number; z: number } | null;
      position: { x: number; z: number };
      pauseEndTime: number | null;
    }

    /**
     * Get next state based on current context
     */
    function getNextState(
      ctx: RandomWalkContext,
      currentTime: number,
    ): WalkState {
      switch (ctx.state) {
        case "idle":
          return "walking";

        case "walking": {
          if (!ctx.target) return "pausing";
          const dx = ctx.target.x - ctx.position.x;
          const dz = ctx.target.z - ctx.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          return dist <= RANDOM_WALK_CONFIG.STOP_DISTANCE
            ? "pausing"
            : "walking";
        }

        case "pausing":
          if (ctx.pauseEndTime && currentTime >= ctx.pauseEndTime) {
            return "walking";
          }
          return "pausing";

        case "stopped":
          return "stopped"; // Terminal state until restarted

        default:
          return "idle";
      }
    }

    it("transitions from idle to walking", () => {
      const ctx: RandomWalkContext = {
        state: "idle",
        target: null,
        position: { x: 0, z: 0 },
        pauseEndTime: null,
      };

      expect(getNextState(ctx, 0)).toBe("walking");
    });

    it("stays walking until target reached", () => {
      const ctx: RandomWalkContext = {
        state: "walking",
        target: { x: 10, z: 0 },
        position: { x: 0, z: 0 },
        pauseEndTime: null,
      };

      expect(getNextState(ctx, 0)).toBe("walking");
    });

    it("transitions to pausing when target reached", () => {
      const ctx: RandomWalkContext = {
        state: "walking",
        target: { x: 1, z: 0 },
        position: { x: 0, z: 0 },
        pauseEndTime: null,
      };

      expect(getNextState(ctx, 0)).toBe("pausing");
    });

    it("transitions to pausing when no target", () => {
      const ctx: RandomWalkContext = {
        state: "walking",
        target: null,
        position: { x: 0, z: 0 },
        pauseEndTime: null,
      };

      expect(getNextState(ctx, 0)).toBe("pausing");
    });

    it("stays pausing until pause time elapsed", () => {
      const ctx: RandomWalkContext = {
        state: "pausing",
        target: null,
        position: { x: 0, z: 0 },
        pauseEndTime: 5000,
      };

      expect(getNextState(ctx, 3000)).toBe("pausing");
    });

    it("transitions to walking after pause", () => {
      const ctx: RandomWalkContext = {
        state: "pausing",
        target: null,
        position: { x: 0, z: 0 },
        pauseEndTime: 5000,
      };

      expect(getNextState(ctx, 5001)).toBe("walking");
    });

    it("stopped is terminal state", () => {
      const ctx: RandomWalkContext = {
        state: "stopped",
        target: null,
        position: { x: 0, z: 0 },
        pauseEndTime: null,
      };

      expect(getNextState(ctx, 0)).toBe("stopped");
      expect(getNextState(ctx, 999999)).toBe("stopped");
    });
  });

  describe("Walk Speed and Movement", () => {
    const WALK_SPEED = 1.5; // m/s for random walk (from ClientInput)
    const TICK_INTERVAL = 100; // ms

    /**
     * Calculate distance covered per tick
     */
    function distancePerTick(): number {
      return WALK_SPEED * (TICK_INTERVAL / 1000);
    }

    it("moves correct distance per tick", () => {
      const dist = distancePerTick();
      expect(dist).toBeCloseTo(0.15, 3); // 1.5 m/s * 0.1s = 0.15m
    });

    it("reaches nearby targets in reasonable time", () => {
      const targetDistance = 10; // 10 meters
      const distPerTick = distancePerTick();
      const ticksNeeded = Math.ceil(targetDistance / distPerTick);
      const timeNeeded = ticksNeeded * TICK_INTERVAL;

      // 10m at 1.5m/s should take ~6.7 seconds (67 ticks)
      expect(timeNeeded).toBeGreaterThan(5000);
      expect(timeNeeded).toBeLessThan(10000);
    });

    it("max walk distance takes reasonable time", () => {
      const maxDistance = RANDOM_WALK_CONFIG.RADIUS;
      const distPerTick = distancePerTick();
      const ticksNeeded = Math.ceil(maxDistance / distPerTick);
      const timeNeeded = ticksNeeded * TICK_INTERVAL;

      // 15m at 1.5m/s should take 10 seconds
      expect(timeNeeded).toBeCloseTo(10000, -3);
    });
  });

  describe("Edge Cases", () => {
    it("handles very small distances", () => {
      const dir = calculateDirection(0, 0, 0.001, 0);
      expect(dir.distance).toBeCloseTo(0.001, 6);
      expect(dir.dirX).toBeCloseTo(1, 5);
    });

    it("handles very large coordinates", () => {
      const dir = calculateDirection(10000, 10000, 10010, 10000);
      expect(dir.distance).toBeCloseTo(10, 5);
      expect(dir.dirX).toBeCloseTo(1, 5);
    });

    it("handles floating point coordinates", () => {
      const dir = calculateDirection(1.5, 2.7, 4.2, 5.1);
      expect(dir.distance).toBeGreaterThan(0);
      const length = Math.sqrt(dir.dirX * dir.dirX + dir.dirZ * dir.dirZ);
      expect(length).toBeCloseTo(1, 5);
    });
  });
});

describe("TileInterpolator Arrival Emotes", () => {
  class TestEntity {
    position = new THREE.Vector3();
    data: Record<string, string | boolean> = {};

    modify(update: Record<string, string | boolean>): void {
      Object.assign(this.data, update);
    }
  }

  it("keeps run emote until interpolation finishes", () => {
    const interpolator = new TileInterpolator();
    const entityId = "player-1";
    const entity = new TestEntity();

    const startTile = { x: 0, z: 0 };
    const destTile = { x: 2, z: 0 };
    const path = [
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ];
    const startWorld = tileToWorld(startTile);
    const destWorld = tileToWorld(destTile);

    entity.position.set(startWorld.x, startWorld.y, startWorld.z);

    interpolator.onMovementStart(
      entityId,
      path,
      true,
      entity.position.clone(),
      startTile,
      destTile,
      1,
      "run",
    );

    // Movement end arrives early with arrival emote (idle)
    interpolator.onMovementEnd(
      entityId,
      destTile,
      new THREE.Vector3(destWorld.x, destWorld.y, destWorld.z),
      1,
      "idle",
    );

    const runSpeed = TILES_PER_TICK_RUN / (TICK_DURATION_MS / 1000);
    const partialDelta = 0.25 / runSpeed; // Move ~0.25 tiles (still mid-path)

    interpolator.update(partialDelta, (id: string) =>
      id === entityId ? entity : undefined,
    );

    expect(entity.data.e).toBe("run");
    expect(entity.data.tileMovementActive).toBe(true);

    // Finish interpolation
    interpolator.update(1, (id: string) =>
      id === entityId ? entity : undefined,
    );

    expect(entity.data.e).toBe("idle");
    expect(entity.data.tileMovementActive).toBe(false);
  });
});

// Helper: copy of direction calculation
function calculateDirection(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
): { dirX: number; dirZ: number; distance: number } {
  const dx = targetX - currentX;
  const dz = targetZ - currentZ;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance === 0) {
    return { dirX: 0, dirZ: 0, distance: 0 };
  }

  return {
    dirX: dx / distance,
    dirZ: dz / distance,
    distance,
  };
}
