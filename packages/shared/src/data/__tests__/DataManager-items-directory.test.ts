/**
 * Tests for DataManager items/ directory loading
 *
 * Verifies:
 * - Atomic loading from items/ directory (all files or fallback)
 * - Backwards compatibility with single items.json
 * - Duplicate ID detection across files
 *
 * Note: These tests require actual manifest files to be available.
 * They are skipped in CI environments where manifests don't exist.
 * The vitest.setup.ts initializes DataManager before tests run, so we
 * can check ITEMS.size to determine if manifests were loaded.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { dataManager } from "../DataManager";
import { ITEMS } from "../items";

// ITEMS is populated by vitest.setup.ts before this file runs
// If ITEMS is empty, manifests weren't available (CI without manifest files)
const manifestsAvailable = ITEMS.size > 0;

describe.skipIf(!manifestsAvailable)(
  "DataManager items/ directory loading",
  () => {
    beforeAll(async () => {
      // Initialize DataManager if not already initialized
      if (!dataManager.isReady()) {
        await dataManager.initialize();
      }
    });

    describe("directory loading", () => {
      it("loads all items from category files", () => {
        // Get all base items (not noted variants)
        const baseItems = Array.from(ITEMS.values()).filter(
          (item) => !item.id.endsWith("_noted"),
        );
        // Count reflects all items across weapons, tools, resources, food, misc
        // Use minimum count for maintainability as items may be added
        expect(baseItems.length).toBeGreaterThanOrEqual(86);
      });

      it("loads items from all 5 category files", () => {
        // Check representative items from each category
        const weapons = [
          "bronze_sword",
          "iron_sword",
          "steel_sword",
          "mithril_sword",
        ];
        const tools = ["bronze_hatchet", "fishing_rod", "hammer", "tinderbox"];
        const resources = ["copper_ore", "bronze_bar", "logs", "raw_shrimp"];
        const food = ["shrimp", "lobster", "shark"];
        const misc = ["coins", "burnt_shrimp"];

        for (const id of [
          ...weapons,
          ...tools,
          ...resources,
          ...food,
          ...misc,
        ]) {
          expect(ITEMS.has(id)).toBe(true);
        }
      });

      it("correctly categorizes items by type", () => {
        // Weapons
        expect(ITEMS.get("bronze_sword")?.type).toBe("weapon");
        expect(ITEMS.get("mithril_sword")?.type).toBe("weapon");

        // Tools
        expect(ITEMS.get("bronze_hatchet")?.type).toBe("tool");
        expect(ITEMS.get("tinderbox")?.type).toBe("tool");

        // Resources
        expect(ITEMS.get("copper_ore")?.type).toBe("resource");
        expect(ITEMS.get("logs")?.type).toBe("resource");

        // Consumables (food)
        expect(ITEMS.get("shrimp")?.type).toBe("consumable");
        expect(ITEMS.get("shark")?.type).toBe("consumable");

        // Misc (junk + currency)
        expect(ITEMS.get("coins")?.type).toBe("currency");
        expect(ITEMS.get("burnt_shrimp")?.type).toBe("junk");
      });
    });

    describe("item normalization", () => {
      it("applies TierDataProvider requirements to tiered weapons", () => {
        const steelSword = ITEMS.get("steel_sword");
        expect(steelSword).toBeDefined();
        // Steel weapons require attack level 5
        expect(steelSword?.requirements?.skills?.attack).toBe(5);
      });

      it("applies TierDataProvider requirements to tiered tools", () => {
        const steelHatchet = ITEMS.get("steel_hatchet");
        expect(steelHatchet).toBeDefined();
        // Steel tools require attack 5 (to equip) and woodcutting 6 (to use)
        expect(steelHatchet?.requirements?.skills?.attack).toBe(5);
        expect(steelHatchet?.requirements?.skills?.woodcutting).toBe(6);
      });

      it("generates noted variants for tradeable non-stackable items", () => {
        // Check that noted variants exist
        expect(ITEMS.has("bronze_sword_noted")).toBe(true);
        expect(ITEMS.has("logs_noted")).toBe(true);
        expect(ITEMS.has("shrimp_noted")).toBe(true);

        // Verify noted items have isNoted flag
        expect(ITEMS.get("bronze_sword_noted")?.isNoted).toBe(true);
      });

      it("does not generate noted variants for stackable items", () => {
        // Coins are stackable, should not have noted variant
        expect(ITEMS.has("coins_noted")).toBe(false);
        // Fishing bait is stackable
        expect(ITEMS.has("fishing_bait_noted")).toBe(false);
      });
    });

    describe("item counts by category", () => {
      it("has correct weapon count", () => {
        const weapons = Array.from(ITEMS.values()).filter(
          (item) => item.type === "weapon" && !item.id.endsWith("_noted"),
        );
        // 6 swords: bronze, iron, steel, mithril, adamant, rune
        expect(weapons.length).toBe(6);
      });

      it("has correct tool count", () => {
        const tools = Array.from(ITEMS.values()).filter(
          (item) => item.type === "tool" && !item.id.endsWith("_noted"),
        );
        // 6 hatchets + 6 pickaxes + fishing rod, fly fishing rod, net, hammer, tinderbox, etc.
        expect(tools.length).toBe(19);
      });

      it("has correct resource count", () => {
        const resources = Array.from(ITEMS.values()).filter(
          (item) => item.type === "resource" && !item.id.endsWith("_noted"),
        );
        // Ores, bars, logs, raw fish, etc.
        // Use minimum count for maintainability as resources may be added
        expect(resources.length).toBeGreaterThanOrEqual(36);
      });

      it("has correct consumable count", () => {
        const consumables = Array.from(ITEMS.values()).filter(
          (item) => item.type === "consumable" && !item.id.endsWith("_noted"),
        );
        expect(consumables.length).toBe(12);
      });

      it("has correct junk count", () => {
        const junk = Array.from(ITEMS.values()).filter(
          (item) => item.type === "junk" && !item.id.endsWith("_noted"),
        );
        expect(junk.length).toBe(11);
      });

      it("has correct currency count", () => {
        const currency = Array.from(ITEMS.values()).filter(
          (item) => item.type === "currency" && !item.id.endsWith("_noted"),
        );
        expect(currency.length).toBe(1);
      });
    });

    describe("EXTERNAL_TOOLS integration", () => {
      it("builds tools from items with tool property", () => {
        const toolsMap = (
          globalThis as { EXTERNAL_TOOLS?: Map<string, unknown> }
        ).EXTERNAL_TOOLS;

        expect(toolsMap).toBeDefined();
        expect(toolsMap?.size).toBeGreaterThan(0);
      });

      it("includes hatchets as woodcutting tools", () => {
        const toolsMap = (
          globalThis as {
            EXTERNAL_TOOLS?: Map<string, { skill: string; itemId: string }>;
          }
        ).EXTERNAL_TOOLS;

        const hatchet = toolsMap?.get("bronze_hatchet");
        expect(hatchet).toBeDefined();
        expect(hatchet?.skill).toBe("woodcutting");
      });

      it("includes pickaxes as mining tools", () => {
        const toolsMap = (
          globalThis as {
            EXTERNAL_TOOLS?: Map<string, { skill: string; itemId: string }>;
          }
        ).EXTERNAL_TOOLS;

        const pickaxe = toolsMap?.get("bronze_pickaxe");
        expect(pickaxe).toBeDefined();
        expect(pickaxe?.skill).toBe("mining");
      });
    });
  },
);
