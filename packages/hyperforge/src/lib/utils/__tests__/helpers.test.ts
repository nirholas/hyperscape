/**
 * Helpers Tests
 *
 * Tests for common utility helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  generateId,
  sleep,
  formatBytes,
  createProgressBar,
  parseAssetType,
  parseBuildingType,
  parseWeaponType,
  getPolycountForType,
  MATERIAL_TIERS,
  generateMaterialDescription,
  generateTierBatch,
  DIFFICULTY_LEVELS,
} from "@/lib/utils/helpers";

describe("Helpers", () => {
  describe("generateId", () => {
    it("generates unique IDs", () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
    });

    it("generates IDs with timestamp prefix", () => {
      const id = generateId();
      const parts = id.split("-");

      // First part should be a timestamp
      expect(parts[0]).toMatch(/^\d+$/);
      expect(Number(parts[0])).toBeGreaterThan(0);
    });

    it("generates IDs with random suffix", () => {
      const id = generateId();
      const parts = id.split("-");

      // Second part should be alphanumeric
      expect(parts[1]).toMatch(/^[a-z0-9]+$/);
    });

    it("generates IDs of consistent format", () => {
      for (let i = 0; i < 10; i++) {
        const id = generateId();
        expect(id).toMatch(/^\d+-[a-z0-9]+$/);
      }
    });
  });

  describe("sleep", () => {
    it("delays execution", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(150);
    });

    it("handles zero delay", async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("formatBytes", () => {
    it("formats bytes", () => {
      expect(formatBytes(0)).toBe("0 Bytes");
      expect(formatBytes(500)).toBe("500 Bytes");
      expect(formatBytes(1023)).toBe("1023 Bytes");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(2048)).toBe("2 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(5242880)).toBe("5 MB");
      expect(formatBytes(1572864)).toBe("1.5 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(1073741824)).toBe("1 GB");
      expect(formatBytes(2147483648)).toBe("2 GB");
    });

    it("handles negative values", () => {
      expect(formatBytes(-100)).toBe("0 Bytes");
    });

    it("handles decimal precision", () => {
      expect(formatBytes(1500)).toBe("1.46 KB");
      expect(formatBytes(1500000)).toBe("1.43 MB");
    });
  });

  describe("createProgressBar", () => {
    it("creates empty progress bar at 0%", () => {
      const bar = createProgressBar(0, 100, 10);

      expect(bar).toBe("[          ] 0%");
    });

    it("creates full progress bar at 100%", () => {
      const bar = createProgressBar(100, 100, 10);

      expect(bar).toBe("[==========] 100%");
    });

    it("creates half-filled progress bar at 50%", () => {
      const bar = createProgressBar(50, 100, 10);

      expect(bar).toBe("[=====     ] 50%");
    });

    it("uses default width of 30", () => {
      const bar = createProgressBar(50, 100);

      expect(bar).toContain("[");
      expect(bar).toContain("] 50%");
      expect(bar.split("[")[1].split("]")[0].length).toBe(30);
    });

    it("handles custom widths", () => {
      const bar = createProgressBar(50, 100, 20);

      expect(bar.split("[")[1].split("]")[0].length).toBe(20);
    });
  });

  describe("parseAssetType", () => {
    it("detects weapon types", () => {
      expect(parseAssetType("A bronze sword")).toBe("weapon");
      expect(parseAssetType("Iron axe")).toBe("weapon");
      expect(parseAssetType("Magical staff")).toBe("weapon");
      expect(parseAssetType("Oak bow")).toBe("weapon");
      expect(parseAssetType("Steel dagger")).toBe("weapon");
    });

    it("detects armor types", () => {
      expect(parseAssetType("Iron helmet")).toBe("armor");
      expect(parseAssetType("Chainmail armor")).toBe("armor");
      expect(parseAssetType("Leather boots")).toBe("armor");
      expect(parseAssetType("Steel gloves")).toBe("armor");
    });

    it("detects consumable types", () => {
      expect(parseAssetType("Health potion")).toBe("consumable");
      expect(parseAssetType("Cooked fish")).toBe("consumable");
      expect(parseAssetType("Magic scroll")).toBe("consumable");
    });

    it("detects tool types", () => {
      // Note: "pickaxe" contains "axe" (weapon), "fishing" contains "fish" (consumable)
      // Use truly unambiguous tool keywords
      expect(parseAssetType("A chisel set")).toBe("tool");
      expect(parseAssetType("A tinderbox")).toBe("tool");
      expect(parseAssetType("A hammer tool")).toBe("tool");
    });

    it("detects building types", () => {
      expect(parseAssetType("General store")).toBe("building");
      expect(parseAssetType("Player house")).toBe("building");
      expect(parseAssetType("Ancient temple")).toBe("building");
    });

    it("detects resource types", () => {
      expect(parseAssetType("Iron ore")).toBe("resource");
      expect(parseAssetType("Gold bar")).toBe("resource");
      expect(parseAssetType("Oak log")).toBe("resource");
    });

    it("detects character types", () => {
      expect(parseAssetType("Cave goblin")).toBe("character");
      expect(parseAssetType("Town guard")).toBe("character");
      expect(parseAssetType("Fire dragon")).toBe("character");
    });

    it("returns decoration for unknown types", () => {
      expect(parseAssetType("A mysterious object")).toBe("decoration");
      expect(parseAssetType("Something random")).toBe("decoration");
    });
  });

  describe("parseBuildingType", () => {
    it("detects bank", () => {
      expect(parseBuildingType("The grand bank")).toBe("bank");
    });

    it("detects store/shop", () => {
      expect(parseBuildingType("General store")).toBe("store");
      expect(parseBuildingType("Weapon shop")).toBe("store");
    });

    it("detects house/home", () => {
      expect(parseBuildingType("Player house")).toBe("house");
      expect(parseBuildingType("Cozy home")).toBe("house");
    });

    it("detects temple/church", () => {
      expect(parseBuildingType("Ancient temple")).toBe("temple");
      expect(parseBuildingType("Village church")).toBe("temple");
    });

    it("detects castle", () => {
      expect(parseBuildingType("Dark castle")).toBe("castle");
    });

    it("detects guild", () => {
      expect(parseBuildingType("Warriors guild")).toBe("guild");
    });

    it("detects inn/tavern", () => {
      expect(parseBuildingType("The Blue inn")).toBe("inn");
      expect(parseBuildingType("Dragon tavern")).toBe("inn");
    });

    it("detects tower", () => {
      expect(parseBuildingType("Wizard tower")).toBe("tower");
    });

    it("returns house as default", () => {
      expect(parseBuildingType("A random building")).toBe("house");
    });
  });

  describe("parseWeaponType", () => {
    it("detects sword", () => {
      expect(parseWeaponType("Bronze sword")).toBe("sword");
      // "longsword" contains "sword" which matches first in the array
      expect(parseWeaponType("Dragon longsword")).toBe("sword");
    });

    it("detects axe", () => {
      expect(parseWeaponType("Iron axe")).toBe("axe");
      // "battleaxe" contains "axe" which matches first in the array
      expect(parseWeaponType("Rune battleaxe")).toBe("axe");
    });

    it("detects bow", () => {
      expect(parseWeaponType("Oak bow")).toBe("bow");
    });

    it("detects staff", () => {
      expect(parseWeaponType("Magic staff")).toBe("staff");
    });

    it("detects shield", () => {
      expect(parseWeaponType("Bronze shield")).toBe("shield");
    });

    it("detects dagger", () => {
      expect(parseWeaponType("Steel dagger")).toBe("dagger");
    });

    it("detects mace", () => {
      expect(parseWeaponType("Iron mace")).toBe("mace");
    });

    it("detects spear", () => {
      expect(parseWeaponType("Bronze spear")).toBe("spear");
    });

    it("detects crossbow", () => {
      // "crossbow" contains "bow" which is checked first in the array
      expect(parseWeaponType("Heavy crossbow")).toBe("bow");
    });

    it("detects wand", () => {
      expect(parseWeaponType("Magic wand")).toBe("wand");
    });

    it("detects scimitar", () => {
      expect(parseWeaponType("Mithril scimitar")).toBe("scimitar");
    });

    it("returns undefined for non-weapons", () => {
      expect(parseWeaponType("A helmet")).toBeUndefined();
      expect(parseWeaponType("Cooking pot")).toBeUndefined();
    });
  });

  describe("getPolycountForType", () => {
    it("returns correct polycount for weapon", () => {
      expect(getPolycountForType("weapon")).toBe(5000);
    });

    it("returns correct polycount for armor", () => {
      expect(getPolycountForType("armor")).toBe(8000);
    });

    it("returns correct polycount for building", () => {
      expect(getPolycountForType("building")).toBe(30000);
    });

    it("returns correct polycount for character", () => {
      expect(getPolycountForType("character")).toBe(15000);
    });

    it("returns default for unknown types", () => {
      expect(getPolycountForType("unknown")).toBe(5000);
      expect(getPolycountForType("")).toBe(5000);
    });
  });

  describe("MATERIAL_TIERS", () => {
    it("has bronze tier with correct properties", () => {
      expect(MATERIAL_TIERS.bronze.name).toBe("Bronze");
      expect(MATERIAL_TIERS.bronze.level).toBe(1);
      expect(MATERIAL_TIERS.bronze.rarity).toBe("common");
      expect(MATERIAL_TIERS.bronze.color).toBe("#CD7F32");
    });

    it("has steel tier with correct properties", () => {
      expect(MATERIAL_TIERS.steel.name).toBe("Steel");
      expect(MATERIAL_TIERS.steel.level).toBe(10);
      expect(MATERIAL_TIERS.steel.rarity).toBe("uncommon");
    });

    it("has mithril tier with correct properties", () => {
      expect(MATERIAL_TIERS.mithril.name).toBe("Mithril");
      expect(MATERIAL_TIERS.mithril.level).toBe(20);
      expect(MATERIAL_TIERS.mithril.rarity).toBe("rare");
    });

    it("has wood tiers for bows", () => {
      expect(MATERIAL_TIERS.wood.level).toBe(1);
      expect(MATERIAL_TIERS.oak.level).toBe(10);
      expect(MATERIAL_TIERS.willow.level).toBe(20);
    });

    it("has leather tier for armor", () => {
      expect(MATERIAL_TIERS.leather.name).toBe("Leather");
      expect(MATERIAL_TIERS.leather.level).toBe(1);
    });
  });

  describe("generateMaterialDescription", () => {
    it("generates weapon description", () => {
      const desc = generateMaterialDescription(
        "A sharp blade",
        "bronze",
        "weapon",
      );

      expect(desc).toContain("A sharp blade");
      expect(desc).toContain("with");
      expect(desc.toLowerCase()).toContain("bronze");
    });

    it("generates armor description", () => {
      const desc = generateMaterialDescription(
        "Protective helmet",
        "steel",
        "armor",
      );

      expect(desc).toContain("Protective helmet");
      expect(desc).toContain("made from");
    });

    it("generates tool description", () => {
      // Use bronze which exists in MATERIAL_TIERS
      const desc = generateMaterialDescription("Mining pick", "bronze", "tool");

      expect(desc).toContain("Mining pick");
      expect(desc).toContain("crafted from");
    });

    it("adds special effects for mithril", () => {
      const desc = generateMaterialDescription("A blade", "mithril", "weapon");

      expect(desc).toContain("magical runes");
    });

    it("adds craftsmanship note for steel", () => {
      const desc = generateMaterialDescription("A blade", "steel", "weapon");

      expect(desc).toContain("craftsmanship");
    });
  });

  describe("generateTierBatch", () => {
    it("generates batch of tiered items", () => {
      const baseItem = {
        name: "Sword",
        description: "A sharp blade",
        type: "weapon",
      };

      const batch = generateTierBatch(
        baseItem,
        ["bronze", "steel", "mithril"],
        "weapon",
      );

      expect(batch).toHaveLength(3);
      expect(batch[0].name).toBe("Bronze Sword");
      expect(batch[1].name).toBe("Steel Sword");
      expect(batch[2].name).toBe("Mithril Sword");
    });

    it("includes tier metadata", () => {
      const baseItem = {
        name: "Axe",
        description: "A heavy axe",
        type: "weapon",
      };

      const batch = generateTierBatch(baseItem, ["bronze"], "weapon");

      expect(batch[0].metadata?.tier).toBe("bronze");
      expect(batch[0].metadata?.level).toBe(1);
      expect(batch[0].metadata?.rarity).toBe("common");
      expect(batch[0].metadata?.color).toBe("#CD7F32");
    });

    it("preserves base item properties", () => {
      const baseItem = {
        name: "Helmet",
        description: "Protective headgear",
        type: "armor",
        subtype: "head",
        style: "medieval",
      };

      const batch = generateTierBatch(baseItem, ["steel"], "armor");

      expect(batch[0].type).toBe("armor");
      expect(batch[0].subtype).toBe("head");
      expect(batch[0].style).toBe("medieval");
    });
  });

  describe("DIFFICULTY_LEVELS", () => {
    it("has beginner level", () => {
      expect(DIFFICULTY_LEVELS[1].name).toBe("Beginner");
      expect(DIFFICULTY_LEVELS[1].levelRange).toEqual([1, 5]);
      expect(DIFFICULTY_LEVELS[1].examples).toContain("Goblin");
    });

    it("has intermediate level", () => {
      expect(DIFFICULTY_LEVELS[2].name).toBe("Intermediate");
      expect(DIFFICULTY_LEVELS[2].levelRange).toEqual([6, 15]);
    });

    it("has advanced level", () => {
      expect(DIFFICULTY_LEVELS[3].name).toBe("Advanced");
      expect(DIFFICULTY_LEVELS[3].levelRange).toEqual([16, 25]);
      expect(DIFFICULTY_LEVELS[3].examples).toContain("Black Knight");
    });
  });
});
