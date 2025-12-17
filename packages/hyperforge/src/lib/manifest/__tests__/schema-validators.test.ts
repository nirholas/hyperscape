/**
 * Schema Validators Tests
 *
 * Tests for manifest schema validation utilities.
 * Tests item, NPC, and resource validation with proper error messages.
 *
 * Real Issues to Surface:
 * - Missing required fields not detected
 * - Invalid field formats passing validation
 * - Unclear error messages
 * - Category-specific validation gaps
 */

import { describe, it, expect } from "vitest";
import {
  validateItem,
  validateNPC,
  validateResource,
  validateAssetForExport,
} from "../schema-validators";
import type { AssetCategory } from "@/types";

describe("Schema Validators", () => {
  describe("Item Validation", () => {
    it("validates complete item with all required fields", () => {
      const validItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "armor", // Use non-weapon type to avoid weapon-specific validation
        description: "A sturdy bronze armor.",
        examine: "A well-crafted bronze armor.",
        tradeable: true,
        rarity: "common",
        modelPath: "asset://items/bronze-armor.glb",
      };

      const result = validateItem(validItem);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required field: id", () => {
      const invalidItem = {
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(invalidItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: id");
    });

    it("detects missing required field: name", () => {
      const invalidItem = {
        id: "bronze_sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(invalidItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
    });

    it("detects missing required field: type", () => {
      const invalidItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(invalidItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: type");
    });

    it("detects missing required field: description", () => {
      const invalidItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "weapon",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(invalidItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: description");
    });

    it("detects missing required field: tradeable", () => {
      const invalidItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        rarity: "common",
      };

      const result = validateItem(invalidItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: tradeable");
    });

    it("validates ID format - lowercase with underscores", () => {
      const invalidIdItem = {
        id: "Bronze-Sword", // Invalid: uppercase and dash
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(invalidIdItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "ID must be lowercase with underscores only",
      );
    });

    it("accepts valid ID formats", () => {
      const validIds = ["bronze_sword", "iron_platebody_01", "rune123"];

      validIds.forEach((id) => {
        const item = {
          id,
          name: "Test Item",
          type: "weapon",
          description: "Test.",
          examine: "Test.",
          tradeable: true,
          rarity: "common",
        };

        const result = validateItem(item);
        expect(result.errors).not.toContain(
          "ID must be lowercase with underscores only",
        );
      });
    });

    it("validates weapon-specific fields", () => {
      const weaponItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
        // Missing weaponType, attackType, attackSpeed
      };

      const result = validateItem(weaponItem);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Weapon missing weaponType");
      expect(result.errors).toContain("Weapon missing attackType");
      expect(result.errors).toContain("Weapon missing attackSpeed");
    });

    it("passes weapon with all weapon-specific fields", () => {
      const validWeapon = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
        weaponType: "sword",
        attackType: "melee",
        attackSpeed: 5,
        modelPath: "asset://weapons/bronze-sword.glb",
        equippedModelPath: "asset://weapons/equipped/bronze-sword.glb",
      };

      const result = validateItem(validWeapon);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("warns about missing modelPath", () => {
      const itemWithoutModel = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "armor", // Not weapon to avoid weapon-specific validation
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
      };

      const result = validateItem(itemWithoutModel);

      expect(result.warnings).toContain(
        "No modelPath specified - asset won't render in game",
      );
    });

    it("warns about weapon missing equippedModelPath", () => {
      const weaponWithoutEquipped = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
        weaponType: "sword",
        attackType: "melee",
        attackSpeed: 5,
        modelPath: "asset://weapons/bronze-sword.glb",
        // Missing equippedModelPath
      };

      const result = validateItem(weaponWithoutEquipped);

      expect(result.warnings).toContain(
        "Weapon missing equippedModelPath - may not display correctly when equipped",
      );
    });
  });

  describe("NPC Validation", () => {
    it("validates complete NPC with all required fields", () => {
      const validNPC = {
        id: "goblin_warrior",
        name: "Goblin Warrior",
        description: "A fierce goblin warrior.",
        category: "mob",
      };

      const result = validateNPC(validNPC);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required field: id", () => {
      const invalidNPC = {
        name: "Goblin",
        description: "A goblin.",
        category: "mob",
      };

      const result = validateNPC(invalidNPC);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: id");
    });

    it("detects missing required field: name", () => {
      const invalidNPC = {
        id: "goblin",
        description: "A goblin.",
        category: "mob",
      };

      const result = validateNPC(invalidNPC);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
    });

    it("detects missing required field: description", () => {
      const invalidNPC = {
        id: "goblin",
        name: "Goblin",
        category: "mob",
      };

      const result = validateNPC(invalidNPC);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: description");
    });

    it("detects missing required field: category", () => {
      const invalidNPC = {
        id: "goblin",
        name: "Goblin",
        description: "A goblin.",
      };

      const result = validateNPC(invalidNPC);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: category");
    });

    it("validates category values", () => {
      const validCategories = ["mob", "boss", "neutral", "quest"];

      validCategories.forEach((category) => {
        const npc = {
          id: "test_npc",
          name: "Test NPC",
          description: "A test NPC.",
          category,
        };

        const result = validateNPC(npc);
        expect(result.valid).toBe(true);
      });
    });

    it("rejects invalid category values", () => {
      const invalidNPC = {
        id: "test_npc",
        name: "Test NPC",
        description: "A test NPC.",
        category: "invalid_category",
      };

      const result = validateNPC(invalidNPC);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid category"))).toBe(
        true,
      );
    });

    it("validates ID format - lowercase with underscores", () => {
      const invalidIdNPC = {
        id: "Goblin-Warrior", // Invalid format
        name: "Goblin Warrior",
        description: "A goblin.",
        category: "mob",
      };

      const result = validateNPC(invalidIdNPC);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "ID must be lowercase with underscores only",
      );
    });

    it("warns about missing modelPath", () => {
      const npcWithoutModel = {
        id: "goblin",
        name: "Goblin",
        description: "A goblin.",
        category: "mob",
      };

      const result = validateNPC(npcWithoutModel);

      expect(result.warnings).toContain(
        "No modelPath specified - NPC won't render in game",
      );
    });

    it("does not warn when modelPath is present", () => {
      const npcWithModel = {
        id: "goblin",
        name: "Goblin",
        description: "A goblin.",
        category: "mob",
        modelPath: "asset://npcs/goblin.glb",
      };

      const result = validateNPC(npcWithModel);

      expect(result.warnings).not.toContain(
        "No modelPath specified - NPC won't render in game",
      );
    });
  });

  describe("Resource Validation", () => {
    it("validates complete resource with all required fields", () => {
      const validResource = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(validResource);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required field: id", () => {
      const invalidResource = {
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(invalidResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: id");
    });

    it("detects missing required field: name", () => {
      const invalidResource = {
        id: "oak_tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(invalidResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
    });

    it("detects missing required field: type", () => {
      const invalidResource = {
        id: "oak_tree",
        name: "Oak Tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(invalidResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: type");
    });

    it("detects missing required field: harvestSkill", () => {
      const invalidResource = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        levelRequired: 1,
      };

      const result = validateResource(invalidResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: harvestSkill");
    });

    it("detects missing required field: levelRequired", () => {
      const invalidResource = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
      };

      const result = validateResource(invalidResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: levelRequired");
    });

    it("validates ID format - lowercase with underscores", () => {
      const invalidIdResource = {
        id: "Oak-Tree", // Invalid format
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(invalidIdResource);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "ID must be lowercase with underscores only",
      );
    });

    it("warns about missing modelPath", () => {
      const resourceWithoutModel = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
      };

      const result = validateResource(resourceWithoutModel);

      expect(result.warnings).toContain(
        "No modelPath specified - resource won't render in game",
      );
    });

    it("warns about missing depletedModelPath", () => {
      const resourceWithoutDepleted = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        modelPath: "asset://resources/oak-tree.glb",
      };

      const result = validateResource(resourceWithoutDepleted);

      expect(result.warnings).toContain(
        "No depletedModelPath - resource won't show depleted state",
      );
    });

    it("does not warn when all paths present", () => {
      const completeResource = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        modelPath: "asset://resources/oak-tree.glb",
        depletedModelPath: "asset://resources/oak-stump.glb",
      };

      const result = validateResource(completeResource);

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("Error Messages", () => {
    it("provides clear error messages for missing fields", () => {
      const emptyItem = {};

      const result = validateItem(emptyItem);

      expect(result.errors.length).toBeGreaterThan(0);
      result.errors.forEach((error) => {
        expect(error).toMatch(/Missing required field:|must be/);
      });
    });

    it("provides specific field names in errors", () => {
      const partialItem = {
        name: "Test",
      };

      const result = validateItem(partialItem);

      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
      expect(result.errors.some((e) => e.includes("type"))).toBe(true);
    });

    it("distinguishes between errors and warnings", () => {
      const itemWithWarnings = {
        id: "test_item",
        name: "Test Item",
        type: "prop",
        description: "A test.",
        examine: "A test item.",
        tradeable: false,
        rarity: "common",
        // Missing modelPath - should be warning, not error
      };

      const result = validateItem(itemWithWarnings);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Category-Based Validation", () => {
    it("validates weapon category as item", () => {
      const result = validateAssetForExport("weapon", {
        id: "sword",
        name: "Sword",
        type: "weapon",
        description: "A sword.",
        examine: "A sword.",
        tradeable: true,
        rarity: "common",
        weaponType: "sword",
        attackType: "melee",
        attackSpeed: 5,
      });

      expect(result.valid).toBe(true);
    });

    it("validates prop category as item", () => {
      const result = validateAssetForExport("prop", {
        id: "barrel",
        name: "Barrel",
        type: "decoration",
        description: "A barrel.",
        examine: "A wooden barrel.",
        tradeable: false,
        rarity: "common",
      });

      expect(result.valid).toBe(true);
    });

    it("validates building category as item", () => {
      const result = validateAssetForExport("building", {
        id: "house",
        name: "House",
        type: "building",
        description: "A house.",
        examine: "A small house.",
        tradeable: false,
        rarity: "common",
      });

      expect(result.valid).toBe(true);
    });

    it("validates npc category as NPC", () => {
      const result = validateAssetForExport("npc", {
        id: "guard",
        name: "Town Guard",
        description: "A town guard.",
        category: "neutral",
      });

      expect(result.valid).toBe(true);
    });

    it("validates character category as NPC", () => {
      const result = validateAssetForExport("character", {
        id: "wizard",
        name: "Wizard",
        description: "A wise wizard.",
        category: "quest",
      });

      expect(result.valid).toBe(true);
    });

    it("validates resource category as resource", () => {
      const result = validateAssetForExport("resource", {
        id: "iron_ore",
        name: "Iron Ore",
        type: "ore",
        harvestSkill: "mining",
        levelRequired: 15,
      });

      expect(result.valid).toBe(true);
    });

    it("validates environment category as resource", () => {
      const result = validateAssetForExport("environment", {
        id: "willow_tree",
        name: "Willow Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 30,
      });

      expect(result.valid).toBe(true);
    });

    it("handles unknown category", () => {
      const result = validateAssetForExport("unknown" as AssetCategory, {
        id: "test",
        name: "Test",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Unknown category"))).toBe(
        true,
      );
    });
  });

  describe("Edge Cases", () => {
    it("handles empty object", () => {
      const result = validateItem({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles null values gracefully", () => {
      const itemWithNulls = {
        id: null,
        name: null,
        type: null,
      };

      const result = validateItem(itemWithNulls);

      expect(result.valid).toBe(false);
    });

    it("handles undefined values gracefully", () => {
      const itemWithUndefined = {
        id: undefined,
        name: "Test",
        type: "item",
      };

      const result = validateItem(itemWithUndefined);

      expect(result.valid).toBe(false);
    });

    it("validates levelRequired as number for resources", () => {
      const resourceWithZeroLevel = {
        id: "fishing_spot",
        name: "Fishing Spot",
        type: "fishing",
        harvestSkill: "fishing",
        levelRequired: 0,
      };

      const result = validateResource(resourceWithZeroLevel);

      // levelRequired: 0 is valid (level 0 is acceptable)
      expect(result.errors).not.toContain(
        "Missing required field: levelRequired",
      );
    });
  });
});
