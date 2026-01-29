/**
 * Biome Configuration Loading Tests
 *
 * Verifies that biomes.json with trees/ores configs is loaded correctly
 * at runtime. Uses real DataManager and real JSON files.
 *
 * NO MOCKS - tests real data loading.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DataManager } from "../../../../data/DataManager";
import { BIOMES } from "../../../../data/world-structure";
import type {
  BiomeTreeConfig,
  BiomeOreConfig,
} from "../../../../types/world/world-types";

describe("Biome Configuration Loading", () => {
  beforeAll(async () => {
    // DataManager is already initialized by test setup, but ensure it's ready
    const dm = DataManager.getInstance();
    if (!dm.isReady()) {
      await dm.waitForReady();
    }
  });

  describe("BIOMES object population", () => {
    it("BIOMES object has entries", () => {
      const biomeIds = Object.keys(BIOMES);
      expect(biomeIds.length).toBeGreaterThan(0);
    });

    it("contains expected biome IDs", () => {
      // These should exist based on biomes.json
      expect(BIOMES.plains).toBeDefined();
      expect(BIOMES.forest).toBeDefined();
      expect(BIOMES.mountains).toBeDefined();
    });
  });

  describe("Tree configuration loading", () => {
    it("plains biome has trees config", () => {
      const plains = BIOMES.plains;
      expect(plains).toBeDefined();
      expect(plains.trees).toBeDefined();

      const treesConfig = plains.trees as BiomeTreeConfig;
      expect(treesConfig.enabled).toBe(true);
      expect(treesConfig.distribution).toBeDefined();
      expect(Object.keys(treesConfig.distribution).length).toBeGreaterThan(0);
    });

    it("forest biome has denser tree config than plains", () => {
      const plains = BIOMES.plains;
      const forest = BIOMES.forest;

      expect(plains.trees).toBeDefined();
      expect(forest.trees).toBeDefined();

      // Forest should have higher density
      expect((forest.trees as BiomeTreeConfig).density).toBeGreaterThan(
        (plains.trees as BiomeTreeConfig).density,
      );
    });

    it("tree distribution weights sum to valid total", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.trees?.enabled) continue;

        const treesConfig = biome.trees as BiomeTreeConfig;
        const distribution = treesConfig.distribution;
        const weights = Object.values(distribution);
        const total = weights.reduce((sum, w) => sum + w, 0);

        // Weights should be positive and sum to something valid
        expect(total).toBeGreaterThan(0);
        expect(weights.every((w) => w >= 0)).toBe(true);
      }
    });

    it("tree types in distribution are valid", () => {
      const validTreeTypes = [
        "tree_normal",
        "tree_oak",
        "tree_willow",
        "tree_teak",
        "tree_maple",
        "tree_mahogany",
        "tree_yew",
        "tree_magic",
      ];

      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.trees?.enabled) continue;

        const treesConfig = biome.trees as BiomeTreeConfig;
        const treeTypes = Object.keys(treesConfig.distribution);

        for (const treeType of treeTypes) {
          expect(validTreeTypes).toContain(treeType);
        }
      }
    });
  });

  describe("Ore configuration loading", () => {
    it("mountains biome has ores config", () => {
      const mountains = BIOMES.mountains;
      expect(mountains).toBeDefined();
      expect(mountains.ores).toBeDefined();

      const oresConfig = mountains.ores as BiomeOreConfig;
      expect(oresConfig.enabled).toBe(true);
      expect(oresConfig.distribution).toBeDefined();
      expect(Object.keys(oresConfig.distribution).length).toBeGreaterThan(0);
    });

    it("mountains has higher ore density than plains", () => {
      const plains = BIOMES.plains;
      const mountains = BIOMES.mountains;

      expect(plains.ores).toBeDefined();
      expect(mountains.ores).toBeDefined();

      // Mountains should have higher ore density (more ores)
      expect((mountains.ores as BiomeOreConfig).density).toBeGreaterThan(
        (plains.ores as BiomeOreConfig).density,
      );
    });

    it("mountains has rare ores that plains does not", () => {
      const plains = BIOMES.plains;
      const mountains = BIOMES.mountains;

      const plainsOreTypes = Object.keys(
        (plains.ores as BiomeOreConfig).distribution,
      );
      const mountainOreTypes = Object.keys(
        (mountains.ores as BiomeOreConfig).distribution,
      );

      // Mountains should have high-level ores
      expect(mountainOreTypes).toContain("ore_mithril");
      expect(mountainOreTypes).toContain("ore_adamant");
      expect(mountainOreTypes).toContain("ore_runite");

      // Plains should only have low-level ores
      expect(plainsOreTypes).not.toContain("ore_mithril");
      expect(plainsOreTypes).not.toContain("ore_adamant");
      expect(plainsOreTypes).not.toContain("ore_runite");
    });

    it("ore distribution weights sum to valid total", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.ores?.enabled) continue;

        const oresConfig = biome.ores as BiomeOreConfig;
        const distribution = oresConfig.distribution;
        const weights = Object.values(distribution);
        const total = weights.reduce((sum, w) => sum + w, 0);

        expect(total).toBeGreaterThan(0);
        expect(weights.every((w) => w >= 0)).toBe(true);
      }
    });

    it("ore types in distribution are valid", () => {
      const validOreTypes = [
        "ore_copper",
        "ore_tin",
        "ore_iron",
        "ore_coal",
        "ore_mithril",
        "ore_adamant",
        "ore_runite",
      ];

      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.ores?.enabled) continue;

        const oresConfig = biome.ores as BiomeOreConfig;
        const oreTypes = Object.keys(oresConfig.distribution);

        for (const oreType of oreTypes) {
          expect(validOreTypes).toContain(oreType);
        }
      }
    });
  });

  describe("Biome difficulty progression", () => {
    it("tundra has magic trees (highest level)", () => {
      const tundra = BIOMES.tundra;
      expect(tundra).toBeDefined();
      expect(tundra.trees).toBeDefined();

      const treesConfig = tundra.trees as BiomeTreeConfig;
      expect(treesConfig.distribution.tree_magic).toBeDefined();
      expect(treesConfig.distribution.tree_magic).toBeGreaterThan(0);
    });

    it("tundra has high-level ores", () => {
      const tundra = BIOMES.tundra;
      expect(tundra).toBeDefined();
      expect(tundra.ores).toBeDefined();

      const oresConfig = tundra.ores as BiomeOreConfig;
      // Tundra should have runite
      expect(oresConfig.distribution.ore_runite).toBeDefined();
      expect(oresConfig.distribution.ore_runite).toBeGreaterThan(0);
    });

    it("lakes biome has ores disabled", () => {
      const lakes = BIOMES.lakes;
      expect(lakes).toBeDefined();

      // Lakes should have ores disabled (water biome)
      const oresConfig = lakes.ores as BiomeOreConfig;
      expect(oresConfig.enabled).toBe(false);
    });
  });

  describe("Config completeness", () => {
    it("all biomes have trees config (even if disabled)", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        expect(biome.trees).toBeDefined();
      }
    });

    it("all biomes have ores config (even if disabled)", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        expect(biome.ores).toBeDefined();
      }
    });

    it("enabled tree configs have required fields", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.trees?.enabled) continue;

        const cfg = biome.trees as BiomeTreeConfig;
        expect(typeof cfg.density).toBe("number");
        expect(typeof cfg.minSpacing).toBe("number");
        expect(typeof cfg.clustering).toBe("boolean");
        expect(cfg.distribution).toBeDefined();
      }
    });

    it("enabled ore configs have required fields", () => {
      for (const [biomeId, biome] of Object.entries(BIOMES)) {
        if (!biome.ores?.enabled) continue;

        const cfg = biome.ores as BiomeOreConfig;
        expect(typeof cfg.density).toBe("number");
        expect(typeof cfg.minSpacing).toBe("number");
        expect(typeof cfg.veins).toBe("boolean");
        expect(cfg.distribution).toBeDefined();
      }
    });
  });
});
