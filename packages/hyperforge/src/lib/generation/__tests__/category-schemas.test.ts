/**
 * Category Schemas Tests
 *
 * Tests for Zod schema validation of asset categories.
 * Tests schema structure, validation, and rejection of invalid data.
 *
 * Real Issues to Surface:
 * - Missing schema for category
 * - Schema not rejecting invalid data
 * - Incorrect field types in schemas
 * - Schema validation error formatting
 */

import { describe, it, expect } from "vitest";
import {
  ItemSchema,
  NPCSchema,
  ResourceSchema,
  validateAsset,
  generateAssetId,
  getDefaultMetadata,
} from "../category-schemas";
import type { AssetCategory } from "@/types";
import { z } from "zod";

describe("Category Schemas", () => {
  describe("Category Schemas - All Categories Have Zod Schemas", () => {
    it("ItemSchema is defined and is a Zod schema", () => {
      expect(ItemSchema).toBeDefined();
      expect(ItemSchema instanceof z.ZodType).toBe(true);
    });

    it("NPCSchema is defined and is a Zod schema", () => {
      expect(NPCSchema).toBeDefined();
      expect(NPCSchema instanceof z.ZodType).toBe(true);
    });

    it("ResourceSchema is defined and is a Zod schema", () => {
      expect(ResourceSchema).toBeDefined();
      expect(ResourceSchema instanceof z.ZodType).toBe(true);
    });

    it("validateAsset handles all expected categories", () => {
      const categories: AssetCategory[] = [
        "weapon",
        "prop",
        "building",
        "npc",
        "character",
        "resource",
        "environment",
      ];

      categories.forEach((category) => {
        const result = validateAsset(category, { id: "test", name: "Test" });
        // Should return object with valid and errors, not throw
        expect(result).toHaveProperty("valid");
        expect(result).toHaveProperty("errors");
      });
    });
  });

  describe("Schema Validation - ItemSchema", () => {
    it("validates correct item data", () => {
      const validItem = {
        id: "bronze_sword",
        name: "Bronze Sword",
        type: "melee",
        description: "A bronze sword.",
        modelPath: "asset://items/bronze-sword.glb",
        value: 100,
        weight: 2.5,
        tradeable: true,
        rarity: "common",
      };

      const result = ItemSchema.safeParse(validItem);

      expect(result.success).toBe(true);
    });

    it("validates item with minimal required fields", () => {
      const minimalItem = {
        id: "test",
        name: "Test Item",
        type: "misc",
      };

      const result = ItemSchema.safeParse(minimalItem);

      expect(result.success).toBe(true);
    });

    it("validates item with weapon-specific fields", () => {
      const weaponItem = {
        id: "iron_scimitar",
        name: "Iron Scimitar",
        type: "weapon",
        weaponType: "scimitar",
        attackType: "melee",
        attackSpeed: 5,
        attackRange: 1,
        bonuses: { attackBonus: 10, strengthBonus: 8 },
        requirements: { level: 20, skills: { attack: 20 } },
      };

      const result = ItemSchema.safeParse(weaponItem);

      expect(result.success).toBe(true);
    });

    it("validates item with optional fields", () => {
      const fullItem = {
        id: "dragon_platebody",
        name: "Dragon Platebody",
        type: "armor",
        description: "A legendary dragon platebody.",
        modelPath: "asset://items/dragon-platebody.glb",
        equippedModelPath: "asset://items/equipped/dragon-platebody.glb",
        iconPath: "asset://icons/dragon-platebody.png",
        value: 10000000,
        weight: 10,
        tradeable: true,
        rarity: "legendary",
      };

      const result = ItemSchema.safeParse(fullItem);

      expect(result.success).toBe(true);
    });

    it("validates rarity enum values", () => {
      const rarities = ["common", "uncommon", "rare", "epic", "legendary"];

      rarities.forEach((rarity) => {
        const item = {
          id: "test",
          name: "Test",
          type: "item",
          rarity,
        };

        const result = ItemSchema.safeParse(item);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("Schema Validation - NPCSchema", () => {
    it("validates correct NPC data", () => {
      const validNPC = {
        id: "goblin_warrior",
        name: "Goblin Warrior",
        description: "A fierce goblin warrior.",
        category: "mob",
        level: 5,
        health: 50,
        combatLevel: 10,
      };

      const result = NPCSchema.safeParse(validNPC);

      expect(result.success).toBe(true);
    });

    it("validates NPC with minimal required fields", () => {
      const minimalNPC = {
        id: "guard",
        name: "Town Guard",
        description: "A guard.",
        category: "neutral",
      };

      const result = NPCSchema.safeParse(minimalNPC);

      expect(result.success).toBe(true);
    });

    it("validates NPC with stats", () => {
      const npcWithStats = {
        id: "dragon",
        name: "Green Dragon",
        description: "A dangerous green dragon.",
        category: "boss",
        stats: {
          level: 100,
          health: 5000,
          attack: 200,
          strength: 200,
          defense: 150,
          ranged: 0,
          magic: 100,
        },
      };

      const result = NPCSchema.safeParse(npcWithStats);

      expect(result.success).toBe(true);
    });

    it("validates NPC with drops", () => {
      const npcWithDrops = {
        id: "goblin",
        name: "Goblin",
        description: "A goblin.",
        category: "mob",
        drops: {
          defaultDrop: { itemId: "bones", quantity: 1, enabled: true },
          common: [{ itemId: "bronze_bar", chance: 0.5 }],
          rare: [{ itemId: "dragon_bone", chance: 0.01 }],
        },
      };

      const result = NPCSchema.safeParse(npcWithDrops);

      expect(result.success).toBe(true);
    });

    it("validates NPC with dialogue", () => {
      const npcWithDialogue = {
        id: "sage",
        name: "Wise Sage",
        description: "A wise sage.",
        category: "quest",
        dialogue: {
          entryNodeId: "greeting",
          nodes: [
            {
              id: "greeting",
              text: "Greetings, traveler.",
              responses: [{ text: "Hello!", nextNodeId: "end" }],
            },
          ],
        },
      };

      const result = NPCSchema.safeParse(npcWithDialogue);

      expect(result.success).toBe(true);
    });

    it("validates NPC category enum values", () => {
      const categories = ["mob", "boss", "neutral", "quest"];

      categories.forEach((category) => {
        const npc = {
          id: "test",
          name: "Test NPC",
          description: "A test.",
          category,
        };

        const result = NPCSchema.safeParse(npc);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("Schema Validation - ResourceSchema", () => {
    it("validates correct resource data", () => {
      const validResource = {
        id: "oak_tree",
        name: "Oak Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        modelPath: "asset://resources/oak-tree.glb",
      };

      const result = ResourceSchema.safeParse(validResource);

      expect(result.success).toBe(true);
    });

    it("validates resource with minimal required fields", () => {
      const minimalResource = {
        id: "tree",
        name: "Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        modelPath: null,
      };

      const result = ResourceSchema.safeParse(minimalResource);

      expect(result.success).toBe(true);
    });

    it("validates resource with all optional fields", () => {
      const fullResource = {
        id: "iron_ore",
        name: "Iron Ore Rock",
        type: "ore",
        examine: "Contains iron ore.",
        modelPath: "asset://resources/iron-rock.glb",
        depletedModelPath: "asset://resources/empty-rock.glb",
        scale: 1.5,
        depletedScale: 1.0,
        harvestSkill: "mining",
        toolRequired: "pickaxe",
        levelRequired: 15,
        baseCycleTicks: 4,
        depleteChance: 0.25,
        respawnTicks: 100,
        harvestYield: [
          {
            itemId: "iron_ore",
            itemName: "Iron Ore",
            quantity: 1,
            chance: 1.0,
            xpAmount: 35,
            stackable: true,
          },
        ],
      };

      const result = ResourceSchema.safeParse(fullResource);

      expect(result.success).toBe(true);
    });

    it("validates resource with multiple harvest yields", () => {
      const resourceWithYields = {
        id: "magic_tree",
        name: "Magic Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 75,
        modelPath: "asset://resources/magic-tree.glb",
        harvestYield: [
          {
            itemId: "magic_logs",
            itemName: "Magic Logs",
            quantity: 1,
            chance: 1.0,
            xpAmount: 250,
            stackable: true,
          },
          {
            itemId: "bird_nest",
            itemName: "Bird Nest",
            quantity: 1,
            chance: 0.05,
            xpAmount: 0,
            stackable: false,
          },
        ],
      };

      const result = ResourceSchema.safeParse(resourceWithYields);

      expect(result.success).toBe(true);
    });
  });

  describe("Schema Rejection - Invalid Data", () => {
    it("rejects item with missing id", () => {
      const invalidItem = {
        name: "Test Item",
        type: "item",
      };

      const result = ItemSchema.safeParse(invalidItem);

      expect(result.success).toBe(false);
    });

    it("rejects item with missing name", () => {
      const invalidItem = {
        id: "test",
        type: "item",
      };

      const result = ItemSchema.safeParse(invalidItem);

      expect(result.success).toBe(false);
    });

    it("rejects item with empty id", () => {
      const invalidItem = {
        id: "",
        name: "Test",
        type: "item",
      };

      const result = ItemSchema.safeParse(invalidItem);

      expect(result.success).toBe(false);
    });

    it("rejects item with invalid rarity", () => {
      const invalidItem = {
        id: "test",
        name: "Test",
        type: "item",
        rarity: "ultra_rare", // Not in enum
      };

      const result = ItemSchema.safeParse(invalidItem);

      expect(result.success).toBe(false);
    });

    it("rejects NPC with missing description", () => {
      const invalidNPC = {
        id: "goblin",
        name: "Goblin",
        category: "mob",
      };

      const result = NPCSchema.safeParse(invalidNPC);

      expect(result.success).toBe(false);
    });

    it("rejects NPC with invalid category", () => {
      const invalidNPC = {
        id: "goblin",
        name: "Goblin",
        description: "A goblin.",
        category: "enemy", // Not in enum
      };

      const result = NPCSchema.safeParse(invalidNPC);

      expect(result.success).toBe(false);
    });

    it("rejects resource with missing harvestSkill", () => {
      const invalidResource = {
        id: "tree",
        name: "Tree",
        type: "tree",
        levelRequired: 1,
        modelPath: null,
      };

      const result = ResourceSchema.safeParse(invalidResource);

      expect(result.success).toBe(false);
    });

    it("rejects resource with missing levelRequired", () => {
      const invalidResource = {
        id: "tree",
        name: "Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        modelPath: null,
      };

      const result = ResourceSchema.safeParse(invalidResource);

      expect(result.success).toBe(false);
    });

    it("rejects resource with wrong type for levelRequired", () => {
      const invalidResource = {
        id: "tree",
        name: "Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: "one", // Should be number
        modelPath: null,
      };

      const result = ResourceSchema.safeParse(invalidResource);

      expect(result.success).toBe(false);
    });
  });

  describe("validateAsset Function", () => {
    it("validates weapon category", () => {
      const result = validateAsset("weapon", {
        id: "sword",
        name: "Sword",
        type: "weapon",
      });

      expect(result.valid).toBe(true);
    });

    it("validates prop category", () => {
      const result = validateAsset("prop", {
        id: "barrel",
        name: "Barrel",
        type: "prop",
      });

      expect(result.valid).toBe(true);
    });

    it("validates building category", () => {
      const result = validateAsset("building", {
        id: "house",
        name: "House",
        type: "building",
      });

      expect(result.valid).toBe(true);
    });

    it("validates npc category", () => {
      const result = validateAsset("npc", {
        id: "guard",
        name: "Guard",
        description: "A guard.",
        category: "neutral",
      });

      expect(result.valid).toBe(true);
    });

    it("validates character category", () => {
      const result = validateAsset("character", {
        id: "hero",
        name: "Hero",
        description: "The hero.",
        category: "quest",
      });

      expect(result.valid).toBe(true);
    });

    it("validates resource category", () => {
      const result = validateAsset("resource", {
        id: "ore",
        name: "Ore",
        type: "ore",
        harvestSkill: "mining",
        levelRequired: 1,
        modelPath: null,
      });

      expect(result.valid).toBe(true);
    });

    it("validates environment category", () => {
      const result = validateAsset("environment", {
        id: "tree",
        name: "Tree",
        type: "tree",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        modelPath: null,
      });

      expect(result.valid).toBe(true);
    });

    it("returns error for unknown category", () => {
      const result = validateAsset("unknown" as AssetCategory, {
        id: "test",
        name: "Test",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Unknown category"))).toBe(
        true,
      );
    });

    it("returns formatted error messages", () => {
      const result = validateAsset("weapon", { name: "Test" });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Errors should include path information
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    });
  });

  describe("generateAssetId Function", () => {
    it("generates snake_case ID from name", () => {
      const id = generateAssetId("Bronze Sword", "weapon");

      expect(id).toBe("bronze_sword");
    });

    it("handles special characters", () => {
      const id = generateAssetId("Dragon's Flame!", "weapon");

      expect(id).toBe("dragon_s_flame");
      expect(id).toMatch(/^[a-z0-9_]+$/);
    });

    it("removes leading/trailing underscores", () => {
      const id = generateAssetId("  Test Item  ", "prop");

      expect(id).not.toMatch(/^_/);
      expect(id).not.toMatch(/_$/);
    });

    it("adds prefix for resource/environment categories", () => {
      const id = generateAssetId("Ore", "resource");

      // Single-word names get category prefix
      expect(id).toBe("resource_ore");
    });

    it("does not add prefix for NPC categories", () => {
      const id = generateAssetId("Guard", "npc");

      expect(id).toBe("guard");
      expect(id).not.toContain("npc_");
    });

    it("ensures uniqueness with existing IDs", () => {
      const existingIds = ["bronze_sword", "bronze_sword_01"];
      const id = generateAssetId("Bronze Sword", "weapon", existingIds);

      expect(id).toBe("bronze_sword_02");
      expect(existingIds).not.toContain(id);
    });

    it("handles empty name", () => {
      const id = generateAssetId("", "weapon");

      expect(typeof id).toBe("string");
    });
  });

  describe("getDefaultMetadata Function", () => {
    it("returns overrides when no category found", () => {
      const overrides = { customField: "value" };
      const metadata = getDefaultMetadata(
        "unknown" as AssetCategory,
        overrides,
      );

      expect(metadata.customField).toBe("value");
    });

    it("merges overrides with defaults", () => {
      const overrides = { value: 500 };
      const metadata = getDefaultMetadata("weapon", overrides);

      expect(metadata.value).toBe(500);
    });

    it("returns defaults for valid category", () => {
      const metadata = getDefaultMetadata("weapon");

      expect(typeof metadata).toBe("object");
    });

    it("handles empty overrides", () => {
      const metadata = getDefaultMetadata("npc", {});

      expect(typeof metadata).toBe("object");
    });
  });

  describe("Schema Error Formatting", () => {
    it("provides path information in errors", () => {
      const invalidItem = {
        id: "test",
        name: "Test",
        type: "item",
        requirements: {
          level: "high", // Should be number
        },
      };

      const result = validateAsset("weapon", invalidItem);

      if (!result.valid) {
        // Error should mention the path
        expect(
          result.errors.some(
            (e) => e.includes("requirements") || e.includes("level"),
          ),
        ).toBe(true);
      }
    });

    it("provides type information in errors", () => {
      const invalidNPC = {
        id: "test",
        name: "Test",
        description: 123, // Should be string
        category: "neutral",
      };

      const result = validateAsset("npc", invalidNPC);

      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("collects all errors, not just first", () => {
      const veryInvalidItem = {
        // Missing id, name, type
        rarity: "invalid_rarity",
        value: "not_a_number",
      };

      const result = validateAsset("weapon", veryInvalidItem);

      expect(result.valid).toBe(false);
      // Should have multiple errors
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
