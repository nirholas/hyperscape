/**
 * Combat Performance Benchmarks
 *
 * Tests to ensure combat calculations meet performance targets.
 * These benchmarks establish baselines and detect regressions.
 *
 * Target: Each operation should complete within its time budget
 * to support 2000+ concurrent players.
 */

import { describe, it, expect } from "vitest";
import { performance } from "perf_hooks";
import {
  calculateDamage,
  getStyleBonus,
  isInAttackRange,
} from "../../../../utils/game/CombatCalculations";
import {
  calculateCombatLevel,
  type CombatSkills,
} from "../../../../utils/game/CombatLevelCalculator";
import { AttackType } from "../../../../types/core/core";
import type { CombatStyle } from "../../../../utils/game/CombatCalculations";

describe("Combat Performance Benchmarks", () => {
  const ITERATIONS = 10000;

  // Performance targets (average time per operation in milliseconds)
  const MAX_TIME_MS = {
    damageCalculation: 0.01, // 10 microseconds
    styleBonus: 0.001, // 1 microsecond
    combatLevel: 0.02, // 20 microseconds
    rangeCheck: 0.005, // 5 microseconds
  };

  // Test fixtures
  const attackerStats = {
    stats: {
      attack: 60,
      strength: 60,
      defense: 50,
      hitpoints: 70,
      ranged: 1,
      magic: 1,
      prayer: 45,
    },
  };

  const targetStats = {
    stats: {
      attack: 30,
      strength: 30,
      defense: 40,
      hitpoints: 50,
      ranged: 1,
      magic: 1,
      prayer: 1,
    },
  };

  const equipmentStats = {
    attack: 30,
    strength: 20,
    defense: 25,
    ranged: 0,
  };

  describe("damage calculation performance", () => {
    it("meets performance target for melee damage", () => {
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        calculateDamage(
          attackerStats,
          targetStats,
          AttackType.MELEE,
          equipmentStats,
          "aggressive",
        );
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_TIME_MS.damageCalculation);
      console.log(
        `Damage calculation: ${(avgMs * 1000).toFixed(2)} µs average`,
      );
    });

    it("performs consistently across combat styles", () => {
      const styles: CombatStyle[] = [
        "accurate",
        "aggressive",
        "defensive",
        "controlled",
      ];
      const results: Map<string, number> = new Map();

      for (const style of styles) {
        const start = performance.now();

        for (let i = 0; i < ITERATIONS; i++) {
          calculateDamage(
            attackerStats,
            targetStats,
            AttackType.MELEE,
            equipmentStats,
            style,
          );
        }

        const elapsed = performance.now() - start;
        const avgMs = elapsed / ITERATIONS;
        results.set(style, avgMs);
      }

      // All styles should meet the target
      for (const [style, avgMs] of results) {
        expect(avgMs).toBeLessThan(MAX_TIME_MS.damageCalculation);
        console.log(`  ${style}: ${(avgMs * 1000).toFixed(2)} µs`);
      }
    });
  });

  describe("style bonus calculation performance", () => {
    it("meets performance target", () => {
      const styles: CombatStyle[] = [
        "accurate",
        "aggressive",
        "defensive",
        "controlled",
      ];
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        for (const style of styles) {
          getStyleBonus(style);
        }
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / (ITERATIONS * styles.length);

      expect(avgMs).toBeLessThan(MAX_TIME_MS.styleBonus);
      console.log(`Style bonus: ${(avgMs * 1000).toFixed(3)} µs average`);
    });
  });

  describe("combat level calculation performance", () => {
    it("meets performance target", () => {
      const skills: CombatSkills = {
        attack: 60,
        strength: 60,
        defense: 60,
        hitpoints: 60,
        ranged: 40,
        magic: 40,
        prayer: 45,
      };

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        calculateCombatLevel(skills);
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_TIME_MS.combatLevel);
      console.log(`Combat level: ${(avgMs * 1000).toFixed(2)} µs average`);
    });

    it("handles varying skill combinations efficiently", () => {
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        // Vary skills based on iteration to prevent caching
        calculateCombatLevel({
          attack: (i % 99) + 1,
          strength: ((i * 2) % 99) + 1,
          defense: ((i * 3) % 99) + 1,
          hitpoints: Math.max(10, ((i * 4) % 99) + 1),
          ranged: ((i * 5) % 99) + 1,
          magic: ((i * 6) % 99) + 1,
          prayer: ((i * 7) % 99) + 1,
        });
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_TIME_MS.combatLevel);
      console.log(
        `Combat level (varied): ${(avgMs * 1000).toFixed(2)} µs average`,
      );
    });
  });

  describe("range check performance", () => {
    it("meets performance target for melee range", () => {
      const attackerTile = { x: 10, z: 10 };
      const targetTile = { x: 11, z: 10 };

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        isInAttackRange(attackerTile, targetTile, AttackType.MELEE, 1);
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_TIME_MS.rangeCheck);
      console.log(`Range check (melee): ${(avgMs * 1000).toFixed(2)} µs`);
    });

    it("meets performance target for ranged", () => {
      const attackerTile = { x: 10, z: 10 };
      const targetTile = { x: 15, z: 15 };

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        isInAttackRange(attackerTile, targetTile, AttackType.RANGED, 10);
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_TIME_MS.rangeCheck);
      console.log(`Range check (ranged): ${(avgMs * 1000).toFixed(2)} µs`);
    });
  });

  describe("memory allocation patterns", () => {
    it("damage calculation does not create excessive garbage", () => {
      // Warm up
      for (let i = 0; i < 100; i++) {
        calculateDamage(
          attackerStats,
          targetStats,
          AttackType.MELEE,
          equipmentStats,
          "aggressive",
        );
      }

      // Force GC if available (Node.js with --expose-gc flag)
      if (typeof global.gc === "function") {
        global.gc();
      }

      const heapBefore = process.memoryUsage().heapUsed;

      // Run many iterations
      for (let i = 0; i < ITERATIONS * 10; i++) {
        calculateDamage(
          attackerStats,
          targetStats,
          AttackType.MELEE,
          equipmentStats,
          "aggressive",
        );
      }

      const heapAfter = process.memoryUsage().heapUsed;
      const heapGrowthMB = (heapAfter - heapBefore) / (1024 * 1024);

      // Should not grow more than 10MB for 100k operations
      expect(heapGrowthMB).toBeLessThan(10);
      console.log(`Heap growth: ${heapGrowthMB.toFixed(2)} MB`);
    });
  });

  describe("scalability tests", () => {
    it("maintains performance at high iteration counts", () => {
      const largeIterations = 100000;
      const start = performance.now();

      for (let i = 0; i < largeIterations; i++) {
        calculateDamage(
          attackerStats,
          targetStats,
          AttackType.MELEE,
          equipmentStats,
          "aggressive",
        );
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / largeIterations;

      // Should still meet target even at scale
      expect(avgMs).toBeLessThan(MAX_TIME_MS.damageCalculation);
      console.log(
        `Large scale (${largeIterations}): ${(avgMs * 1000).toFixed(2)} µs average`,
      );
    });

    it("simulates 1-second game tick with 500 combat operations", () => {
      // Simulate what happens in a busy game tick:
      // 500 players in combat = 500 damage calculations
      const operationsPerTick = 500;
      const start = performance.now();

      for (let i = 0; i < operationsPerTick; i++) {
        // Damage calculation
        calculateDamage(
          attackerStats,
          targetStats,
          AttackType.MELEE,
          equipmentStats,
          "aggressive",
        );

        // Range check
        isInAttackRange(
          { x: i % 100, z: i % 100 },
          { x: 50, z: 50 },
          AttackType.MELEE,
          1,
        );
      }

      const elapsed = performance.now() - start;

      // Should complete well within a 600ms game tick
      expect(elapsed).toBeLessThan(50); // 50ms budget for combat calculations
      console.log(`500-player tick simulation: ${elapsed.toFixed(2)} ms total`);
    });
  });
});
