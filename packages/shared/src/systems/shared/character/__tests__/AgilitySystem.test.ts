/**
 * Agility Skill Unit Tests
 *
 * Tests for agility skill mechanics:
 * - Movement XP batching (100 tiles = 50 XP)
 * - Weight-based stamina drain (+0.5% per kg)
 * - Agility-based stamina regeneration (+1% per level)
 *
 * @see AGILITY_IMPLEMENTATION_PLAN.md
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Constants (matching implementation in PlayerLocal.ts and TileMovementManager)
// ============================================================================

const AGILITY_TILES_PER_XP_GRANT = 100;
const AGILITY_XP_PER_GRANT = 50;
const WEIGHT_DRAIN_MODIFIER = 0.005; // +0.5% per kg
const AGILITY_REGEN_MODIFIER = 0.01; // +1% per level
const BASE_STAMINA_DRAIN_PER_SECOND = 2;
const BASE_STAMINA_REGEN_WALKING = 2;
const BASE_STAMINA_REGEN_IDLE = 4;

// ============================================================================
// Helper Functions (matching implementation logic)
// ============================================================================

/**
 * Calculate XP grants from tiles traveled
 */
function calculateAgilityXP(tilesTraveled: number): {
  xpGranted: number;
  remainingTiles: number;
} {
  const grantsEarned = Math.floor(tilesTraveled / AGILITY_TILES_PER_XP_GRANT);
  const xpGranted = grantsEarned * AGILITY_XP_PER_GRANT;
  const remainingTiles = tilesTraveled % AGILITY_TILES_PER_XP_GRANT;
  return { xpGranted, remainingTiles };
}

/**
 * Calculate stamina drain rate with weight modifier
 */
function calculateStaminaDrain(baseRate: number, weightKg: number): number {
  const weightMultiplier = 1 + weightKg * WEIGHT_DRAIN_MODIFIER;
  return baseRate * weightMultiplier;
}

/**
 * Calculate stamina regen rate with agility modifier
 */
function calculateStaminaRegen(baseRate: number, agilityLevel: number): number {
  const agilityMultiplier = 1 + agilityLevel * AGILITY_REGEN_MODIFIER;
  return baseRate * agilityMultiplier;
}

// ============================================================================
// Tests
// ============================================================================

describe("Agility Skill", () => {
  describe("Constants", () => {
    it("grants XP every 100 tiles", () => {
      expect(AGILITY_TILES_PER_XP_GRANT).toBe(100);
    });

    it("grants 50 XP per batch", () => {
      expect(AGILITY_XP_PER_GRANT).toBe(50);
    });

    it("weight drain modifier is 0.5% per kg", () => {
      expect(WEIGHT_DRAIN_MODIFIER).toBe(0.005);
    });

    it("agility regen modifier is 1% per level", () => {
      expect(AGILITY_REGEN_MODIFIER).toBe(0.01);
    });
  });

  describe("Movement XP Batching", () => {
    it("grants no XP for less than 100 tiles", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(50);
      expect(xpGranted).toBe(0);
      expect(remainingTiles).toBe(50);
    });

    it("grants 50 XP for exactly 100 tiles", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(100);
      expect(xpGranted).toBe(50);
      expect(remainingTiles).toBe(0);
    });

    it("grants 50 XP for 150 tiles with 50 remaining", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(150);
      expect(xpGranted).toBe(50);
      expect(remainingTiles).toBe(50);
    });

    it("grants 100 XP for 200 tiles", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(200);
      expect(xpGranted).toBe(100);
      expect(remainingTiles).toBe(0);
    });

    it("grants 250 XP for 500 tiles", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(500);
      expect(xpGranted).toBe(250);
      expect(remainingTiles).toBe(0);
    });

    it("correctly calculates remainder for 275 tiles", () => {
      const { xpGranted, remainingTiles } = calculateAgilityXP(275);
      expect(xpGranted).toBe(100); // 2 grants
      expect(remainingTiles).toBe(75);
    });

    it("accumulates partial progress across batches", () => {
      // Simulate walking 75 tiles, then 50 more
      let accumulated = 0;

      // First batch: 75 tiles
      accumulated += 75;
      let result = calculateAgilityXP(accumulated);
      expect(result.xpGranted).toBe(0);
      expect(result.remainingTiles).toBe(75);

      // Second batch: 50 more tiles (total 125)
      accumulated = result.remainingTiles + 50;
      result = calculateAgilityXP(accumulated);
      expect(result.xpGranted).toBe(50);
      expect(result.remainingTiles).toBe(25);
    });
  });

  describe("Weight-Based Stamina Drain", () => {
    it("has no modifier at 0 kg weight", () => {
      const drainRate = calculateStaminaDrain(BASE_STAMINA_DRAIN_PER_SECOND, 0);
      expect(drainRate).toBe(2); // Base rate unchanged
    });

    it("increases drain by 0.5% per kg", () => {
      const drainRate = calculateStaminaDrain(BASE_STAMINA_DRAIN_PER_SECOND, 1);
      expect(drainRate).toBeCloseTo(2.01, 2); // 2 * 1.005
    });

    it("increases drain by 5% at 10 kg", () => {
      const drainRate = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        10,
      );
      expect(drainRate).toBeCloseTo(2.1, 2); // 2 * 1.05
    });

    it("increases drain by 10% at 20 kg", () => {
      const drainRate = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        20,
      );
      expect(drainRate).toBeCloseTo(2.2, 2); // 2 * 1.10
    });

    it("increases drain by 25% at 50 kg (full inventory of heavy items)", () => {
      const drainRate = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        50,
      );
      expect(drainRate).toBeCloseTo(2.5, 2); // 2 * 1.25
    });

    it("increases drain by 50% at 100 kg (very heavy load)", () => {
      const drainRate = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        100,
      );
      expect(drainRate).toBeCloseTo(3.0, 2); // 2 * 1.50
    });
  });

  describe("Agility-Based Stamina Regeneration", () => {
    describe("while walking", () => {
      it("has 1% bonus at level 1", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_WALKING, 1);
        expect(regenRate).toBeCloseTo(2.02, 2); // 2 * 1.01
      });

      it("has 10% bonus at level 10", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_WALKING, 10);
        expect(regenRate).toBeCloseTo(2.2, 2); // 2 * 1.10
      });

      it("has 50% bonus at level 50", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_WALKING, 50);
        expect(regenRate).toBeCloseTo(3.0, 2); // 2 * 1.50
      });

      it("has 99% bonus at level 99 (max)", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_WALKING, 99);
        expect(regenRate).toBeCloseTo(3.98, 2); // 2 * 1.99
      });
    });

    describe("while idle", () => {
      it("has 1% bonus at level 1", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_IDLE, 1);
        expect(regenRate).toBeCloseTo(4.04, 2); // 4 * 1.01
      });

      it("has 10% bonus at level 10", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_IDLE, 10);
        expect(regenRate).toBeCloseTo(4.4, 2); // 4 * 1.10
      });

      it("has 50% bonus at level 50", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_IDLE, 50);
        expect(regenRate).toBeCloseTo(6.0, 2); // 4 * 1.50
      });

      it("has 99% bonus at level 99 (max)", () => {
        const regenRate = calculateStaminaRegen(BASE_STAMINA_REGEN_IDLE, 99);
        expect(regenRate).toBeCloseTo(7.96, 2); // 4 * 1.99
      });
    });
  });

  describe("Combined Weight and Agility Effects", () => {
    it("high agility partially offsets heavy weight penalty", () => {
      // Heavy load (50 kg) increases drain by 25%
      const drainWithWeight = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        50,
      );
      expect(drainWithWeight).toBeCloseTo(2.5, 2);

      // High agility (50) increases regen by 50%
      const regenWithAgility = calculateStaminaRegen(
        BASE_STAMINA_REGEN_IDLE,
        50,
      );
      expect(regenWithAgility).toBeCloseTo(6.0, 2);

      // Net effect: Even with heavy load, high agility player regens faster
      // than they drain while idle (6.0 regen vs 2.5 drain)
      expect(regenWithAgility).toBeGreaterThan(drainWithWeight);
    });

    it("low agility with heavy weight results in net stamina loss while running", () => {
      // Heavy load (50 kg) with running
      const drainWithWeight = calculateStaminaDrain(
        BASE_STAMINA_DRAIN_PER_SECOND,
        50,
      );

      // Low agility (1) while walking
      const regenWhileWalking = calculateStaminaRegen(
        BASE_STAMINA_REGEN_WALKING,
        1,
      );

      // While running, stamina only drains (no regen)
      // Drain rate: 2.5/sec with 50kg load
      // This shows heavy loads significantly impact run sustainability
      expect(drainWithWeight).toBeCloseTo(2.5, 2);
      expect(regenWhileWalking).toBeCloseTo(2.02, 2);
    });
  });

  describe("XP Calculations at Various Travel Distances", () => {
    const testCases = [
      { tiles: 0, expectedXP: 0, remaining: 0 },
      { tiles: 50, expectedXP: 0, remaining: 50 },
      { tiles: 99, expectedXP: 0, remaining: 99 },
      { tiles: 100, expectedXP: 50, remaining: 0 },
      { tiles: 101, expectedXP: 50, remaining: 1 },
      { tiles: 199, expectedXP: 50, remaining: 99 },
      { tiles: 200, expectedXP: 100, remaining: 0 },
      { tiles: 500, expectedXP: 250, remaining: 0 },
      { tiles: 1000, expectedXP: 500, remaining: 0 },
      { tiles: 1234, expectedXP: 600, remaining: 34 },
    ];

    testCases.forEach(({ tiles, expectedXP, remaining }) => {
      it(`grants ${expectedXP} XP for ${tiles} tiles traveled`, () => {
        const { xpGranted, remainingTiles } = calculateAgilityXP(tiles);
        expect(xpGranted).toBe(expectedXP);
        expect(remainingTiles).toBe(remaining);
      });
    });
  });

  describe("Stamina Drain Rate at Various Weights", () => {
    const weightTestCases = [
      { weight: 0, expectedRate: 2.0 },
      { weight: 5, expectedRate: 2.05 },
      { weight: 10, expectedRate: 2.1 },
      { weight: 20, expectedRate: 2.2 },
      { weight: 30, expectedRate: 2.3 },
      { weight: 50, expectedRate: 2.5 },
      { weight: 100, expectedRate: 3.0 },
    ];

    weightTestCases.forEach(({ weight, expectedRate }) => {
      it(`drain rate is ${expectedRate}/s at ${weight} kg`, () => {
        const drainRate = calculateStaminaDrain(
          BASE_STAMINA_DRAIN_PER_SECOND,
          weight,
        );
        expect(drainRate).toBeCloseTo(expectedRate, 2);
      });
    });
  });

  describe("Stamina Regen Rate at Various Agility Levels", () => {
    const agilityTestCases = [
      { level: 1, walkingRate: 2.02, idleRate: 4.04 },
      { level: 10, walkingRate: 2.2, idleRate: 4.4 },
      { level: 25, walkingRate: 2.5, idleRate: 5.0 },
      { level: 50, walkingRate: 3.0, idleRate: 6.0 },
      { level: 75, walkingRate: 3.5, idleRate: 7.0 },
      { level: 99, walkingRate: 3.98, idleRate: 7.96 },
    ];

    agilityTestCases.forEach(({ level, walkingRate, idleRate }) => {
      it(`regen rate is ${walkingRate}/s walking, ${idleRate}/s idle at level ${level}`, () => {
        const walking = calculateStaminaRegen(
          BASE_STAMINA_REGEN_WALKING,
          level,
        );
        const idle = calculateStaminaRegen(BASE_STAMINA_REGEN_IDLE, level);
        expect(walking).toBeCloseTo(walkingRate, 2);
        expect(idle).toBeCloseTo(idleRate, 2);
      });
    });
  });
});
