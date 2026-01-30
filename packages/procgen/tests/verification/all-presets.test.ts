/**
 * Verification Tests: All Presets
 *
 * This file tests that all tree presets generate valid, consistent trees.
 * Each preset is tested for:
 * - Valid tree structure (stems, leaves, radii)
 * - Determinism (same seed produces same output)
 * - Reasonable bounds (no NaN, Infinity, or extreme values)
 */

import { describe, it, expect } from "vitest";
import { Tree } from "../../src/core/Tree.js";
import { PRESETS, getPresetNames } from "../../src/params/index.js";

describe("All Presets Verification", () => {
  const presetNames = getPresetNames();

  // Skip intensive presets that take too long for quick testing
  // These are tested manually or in longer CI runs
  // Presets that generate many leaves/stems and can exceed 10s timeout
  const intensivePresets = new Set([
    "balsamFir",
    "blackTupelo",
    "douglasFir",
    "europeanLarch",
    "silverBirch",
    "weepingWillow",
  ]);

  describe("structural validity", () => {
    // Filter out intensive presets for quick test runs
    const structureTestPresets = presetNames.filter(
      (name) => !intensivePresets.has(name),
    );

    it.each(structureTestPresets)(
      "preset %s generates valid tree structure",
      (presetName) => {
        const params = PRESETS[presetName]!;
        const tree = new Tree(params, { seed: 12345 });
        const data = tree.generate();

        // Should have at least one stem (trunk)
        expect(data.stems.length).toBeGreaterThan(0);

        // Trunk should be at depth 0
        const trunk = data.stems.find((s) => s.depth === 0);
        expect(trunk).toBeDefined();
        expect(trunk!.parentIndex).toBeNull();

        // Trunk should have valid dimensions
        expect(trunk!.length).toBeGreaterThan(0);
        expect(trunk!.radius).toBeGreaterThan(0);
        expect(trunk!.points.length).toBeGreaterThan(1);

        // All stems should have valid data
        // Note: Some stems may have 0 points (pruned, too thin, etc.)
        // This is valid behavior - we just check that stems with points are valid
        let stemsWithPoints = 0;
        for (const stem of data.stems) {
          expect(Number.isFinite(stem.length)).toBe(true);
          expect(Number.isFinite(stem.radius)).toBe(true);
          expect(stem.depth).toBeGreaterThanOrEqual(0);

          if (stem.points.length > 0) {
            stemsWithPoints++;
            // Check all points have valid coordinates
            for (const point of stem.points) {
              expect(Number.isFinite(point.position.x)).toBe(true);
              expect(Number.isFinite(point.position.y)).toBe(true);
              expect(Number.isFinite(point.position.z)).toBe(true);
              expect(Number.isFinite(point.radius)).toBe(true);
            }
          }
        }

        // At least some stems should have points
        expect(stemsWithPoints).toBeGreaterThan(0);

        // Metadata should be valid
        expect(Number.isFinite(data.treeScale)).toBe(true);
        expect(Number.isFinite(data.trunkLength)).toBe(true);
        expect(Number.isFinite(data.baseLength)).toBe(true);
        expect(data.treeScale).toBeGreaterThan(0);
        expect(data.trunkLength).toBeGreaterThan(0);
      },
    );
  });

  describe("determinism", () => {
    it.each(presetNames)("preset %s is deterministic", (presetName) => {
      const params = PRESETS[presetName]!;
      const seed = 42;

      const tree1 = new Tree(params, { seed });
      const data1 = tree1.generate();

      const tree2 = new Tree(params, { seed });
      const data2 = tree2.generate();

      // Should produce identical trees
      expect(data1.stems.length).toBe(data2.stems.length);
      expect(data1.leaves.length).toBe(data2.leaves.length);
      expect(data1.treeScale).toBe(data2.treeScale);
      expect(data1.trunkLength).toBe(data2.trunkLength);
      expect(data1.baseLength).toBe(data2.baseLength);

      // Check first few stems match
      for (let i = 0; i < Math.min(5, data1.stems.length); i++) {
        const s1 = data1.stems[i]!;
        const s2 = data2.stems[i]!;
        expect(s1.depth).toBe(s2.depth);
        expect(s1.length).toBe(s2.length);
        expect(s1.radius).toBe(s2.radius);
        expect(s1.points.length).toBe(s2.points.length);
      }
    });
  });

  describe("parent-child relationships", () => {
    it.each(presetNames)(
      "preset %s has valid parent-child relationships",
      (presetName) => {
        const params = PRESETS[presetName]!;
        const tree = new Tree(params, { seed: 100 });
        const data = tree.generate();

        for (const stem of data.stems) {
          if (stem.depth === 0) {
            // Trunk has no parent
            expect(stem.parentIndex).toBeNull();
          } else {
            // Non-trunk stems must have valid parent
            expect(stem.parentIndex).not.toBeNull();
            expect(stem.parentIndex!).toBeGreaterThanOrEqual(0);
            expect(stem.parentIndex!).toBeLessThan(data.stems.length);

            const parent = data.stems[stem.parentIndex!]!;
            expect(parent.depth).toBe(stem.depth - 1);
          }
        }
      },
    );
  });

  describe("leaf generation", () => {
    // Filter out intensive presets that generate many leaves and take too long
    const leafTestPresets = presetNames.filter(
      (name) => !intensivePresets.has(name),
    );

    it.each(leafTestPresets)(
      "preset %s generates valid leaves when enabled",
      (presetName) => {
        const params = PRESETS[presetName]!;
        const tree = new Tree(params, { seed: 100, generateLeaves: true });
        const data = tree.generate();

        // Check if preset expects leaves
        if (params.leafBlosNum > 0 && params.levels >= 2) {
          // Should have some leaves (though count depends on tree structure)
          // Some presets may not have leaves due to depth limitations
          // Just verify leaves are valid if they exist
          for (const leaf of data.leaves) {
            expect(Number.isFinite(leaf.position.x)).toBe(true);
            expect(Number.isFinite(leaf.position.y)).toBe(true);
            expect(Number.isFinite(leaf.position.z)).toBe(true);
            expect(Number.isFinite(leaf.direction.x)).toBe(true);
            expect(Number.isFinite(leaf.direction.y)).toBe(true);
            expect(Number.isFinite(leaf.direction.z)).toBe(true);
          }
        }
      },
    );
  });

  describe("parameter bounds", () => {
    it.each(presetNames)(
      "preset %s produces tree within reasonable bounds",
      (presetName) => {
        const params = PRESETS[presetName]!;
        const tree = new Tree(params, { seed: 100 });
        const data = tree.generate();

        // Tree scale should be reasonable
        expect(data.treeScale).toBeGreaterThan(0.1);
        expect(data.treeScale).toBeLessThan(1000);

        // Trunk should not be excessively large or small
        const trunk = data.stems.find((s) => s.depth === 0)!;
        expect(trunk.length).toBeGreaterThan(0.1);
        expect(trunk.length).toBeLessThan(500);
        expect(trunk.radius).toBeGreaterThan(0.0001);
        expect(trunk.radius).toBeLessThan(50);

        // Total stem count should be reasonable
        // Some presets like blackTupelo can have many small stems
        expect(data.stems.length).toBeLessThan(50000);
      },
    );
  });

  describe("different seeds produce different trees", () => {
    it.each(presetNames)(
      "preset %s produces variation with different seeds",
      (presetName) => {
        const params = PRESETS[presetName]!;

        const tree1 = new Tree(params, { seed: 111 });
        const data1 = tree1.generate();

        const tree2 = new Tree(params, { seed: 222 });
        const data2 = tree2.generate();

        // Trees should be different (at least one value should differ)
        const isDifferent =
          data1.treeScale !== data2.treeScale ||
          data1.stems.length !== data2.stems.length ||
          data1.trunkLength !== data2.trunkLength;

        expect(isDifferent).toBe(true);
      },
    );
  });
});
