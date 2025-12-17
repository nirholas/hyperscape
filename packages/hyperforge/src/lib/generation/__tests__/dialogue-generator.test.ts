/**
 * Dialogue Generator Tests
 *
 * Tests for dialogue tree structure, validation, and node operations.
 * Integration tests that mock AI gateway and call real service functions.
 *
 * Real Issues to Surface:
 * - Invalid dialogue tree structure
 * - Orphaned/unreachable nodes
 * - Invalid node references
 * - Missing required fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the AI gateway BEFORE importing the module
vi.mock("@/lib/ai/gateway", () => ({
  generateTextWithProvider: vi.fn(),
}));

import { generateTextWithProvider } from "@/lib/ai/gateway";
import {
  addDialogueNode,
  updateDialogueNode,
  deleteDialogueNode,
  createEmptyDialogueTree,
  generateDialogueTree,
  generateNPCContent,
  generateNPCBackstory,
  buildDialoguePrompt,
  validateAndNormalizeDialogueTree,
  generateNPCId,
} from "../dialogue-generator";

import type {
  DialogueTree,
  DialogueNode,
  DialogueResponse,
  DialogueGenerationContext,
} from "@/types/game/dialogue-types";

// Get typed mock reference
const mockGenerateText = vi.mocked(generateTextWithProvider);

describe("DialogueGenerator", () => {
  describe("Dialogue Tree Structure", () => {
    it("valid dialogue tree has required fields", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello, traveler!",
            responses: [{ text: "Hi!", nextNodeId: "end" }],
          },
        ],
      };

      expect(tree.entryNodeId).toBeDefined();
      expect(tree.nodes).toBeDefined();
      expect(tree.nodes.length).toBeGreaterThan(0);
    });

    it("nodes have required fields", () => {
      const node: DialogueNode = {
        id: "test_node",
        text: "This is a test node.",
        responses: [{ text: "Continue", nextNodeId: "end" }],
      };

      expect(node.id).toBeDefined();
      expect(node.text).toBeDefined();
      expect(typeof node.id).toBe("string");
      expect(typeof node.text).toBe("string");
    });

    it("response options have nextNodeId references", () => {
      const response: DialogueResponse = {
        text: "Tell me more.",
        nextNodeId: "more_info",
      };

      expect(response.text).toBeDefined();
      expect(response.nextNodeId).toBeDefined();
      expect(typeof response.nextNodeId).toBe("string");
    });

    it("root node exists and is reachable", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Welcome!",
            responses: [{ text: "Thanks!", nextNodeId: "end" }],
          },
        ],
      };

      const entryNode = tree.nodes.find((n) => n.id === tree.entryNodeId);
      expect(entryNode).toBeDefined();
      expect(entryNode!.id).toBe(tree.entryNodeId);
    });

    it("supports optional audio configuration", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [{ id: "greeting", text: "Hello!" }],
        voiceConfig: {
          voiceId: "voice_123",
          voicePreset: "male-warrior",
          modelId: "eleven_multilingual_v2",
        },
        hasAudio: false,
      };

      expect(tree.voiceConfig).toBeDefined();
      expect(tree.voiceConfig!.voiceId).toBe("voice_123");
      expect(tree.hasAudio).toBe(false);
    });

    it("nodes can have optional speaker override", () => {
      const node: DialogueNode = {
        id: "cutscene_1",
        text: "The kingdom is in danger!",
        speakerOverride: "King Aldric",
      };

      expect(node.speakerOverride).toBe("King Aldric");
    });
  });

  describe("Prompt Building", () => {
    it("builds context with NPC name and description", () => {
      const context: DialogueGenerationContext = {
        npcName: "Thorin",
        npcDescription: "A gruff blacksmith with a heart of gold.",
        npcCategory: "neutral",
      };

      expect(context.npcName).toBe("Thorin");
      expect(context.npcDescription).toBeDefined();
      expect(context.npcCategory).toBe("neutral");
    });

    it("includes NPC personality", () => {
      const context: DialogueGenerationContext = {
        npcName: "Elara",
        npcDescription: "A mysterious elf mage.",
        npcCategory: "quest",
        npcPersonality: "mysterious and aloof",
      };

      expect(context.npcPersonality).toBe("mysterious and aloof");
    });

    it("includes location context via lore", () => {
      const context: DialogueGenerationContext = {
        npcName: "Guard Captain",
        npcDescription: "Leader of the town guard.",
        npcCategory: "neutral",
        lore: "The town of Millhaven sits at the edge of the Darkwood Forest.",
      };

      expect(context.lore).toBeDefined();
      expect(context.lore!.length).toBeGreaterThan(0);
    });

    it("includes quest requirements if provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Old Sage",
        npcDescription: "A wise elder seeking help.",
        npcCategory: "quest",
        questContext: {
          questId: "goblin_invasion",
          questName: "Goblin Invasion",
          questDescription: "Defeat the goblins threatening the village.",
          objectives: ["Kill 10 goblins", "Retrieve the stolen amulet"],
        },
      };

      expect(context.questContext).toBeDefined();
      expect(context.questContext!.questId).toBe("goblin_invasion");
      expect(context.questContext!.objectives).toHaveLength(2);
    });

    it("includes service types for NPCs", () => {
      const context: DialogueGenerationContext = {
        npcName: "Banker Bob",
        npcDescription: "The local banker.",
        npcCategory: "neutral",
        npcRole: "banker",
        services: ["bank", "exchange"],
      };

      expect(context.services).toContain("bank");
      expect(context.npcRole).toBe("banker");
    });

    it("includes tone for dialogue style", () => {
      const context: DialogueGenerationContext = {
        npcName: "Grumpy Dwarf",
        npcDescription: "A dwarf who hates visitors.",
        npcCategory: "neutral",
        tone: "grumpy",
      };

      expect(context.tone).toBe("grumpy");
    });

    it("validates NPC category values", () => {
      const validCategories: DialogueGenerationContext["npcCategory"][] = [
        "mob",
        "boss",
        "neutral",
        "quest",
      ];

      validCategories.forEach((category) => {
        const context: DialogueGenerationContext = {
          npcName: "Test NPC",
          npcDescription: "A test NPC.",
          npcCategory: category,
        };
        expect(context.npcCategory).toBe(category);
      });
    });
  });

  describe("Tree Validation", () => {
    it("detects orphaned nodes (unreachable from root)", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Bye!", nextNodeId: "end" }],
          },
          {
            id: "orphaned_node",
            text: "You cannot reach me.",
            responses: [],
          },
        ],
      };

      // Find all reachable nodes starting from entry
      const reachable = new Set<string>();
      const queue = [tree.entryNodeId];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (nodeId === "end" || reachable.has(nodeId)) continue;

        reachable.add(nodeId);
        const node = tree.nodes.find((n) => n.id === nodeId);
        if (node?.responses) {
          for (const response of node.responses) {
            if (response.nextNodeId !== "end") {
              queue.push(response.nextNodeId);
            }
          }
        }
      }

      const orphaned = tree.nodes.filter((n) => !reachable.has(n.id));
      expect(orphaned.length).toBe(1);
      expect(orphaned[0].id).toBe("orphaned_node");
    });

    it("detects invalid nextNodeId references", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Go to nowhere", nextNodeId: "nonexistent" }],
          },
        ],
      };

      const nodeIds = new Set(tree.nodes.map((n) => n.id));
      const invalidRefs: string[] = [];

      for (const node of tree.nodes) {
        if (node.responses) {
          for (const response of node.responses) {
            if (
              response.nextNodeId !== "end" &&
              !nodeIds.has(response.nextNodeId)
            ) {
              invalidRefs.push(response.nextNodeId);
            }
          }
        }
      }

      expect(invalidRefs.length).toBe(1);
      expect(invalidRefs[0]).toBe("nonexistent");
    });

    it("detects missing response options on non-ending nodes", () => {
      const node: DialogueNode = {
        id: "incomplete",
        text: "This node has no responses.",
      };

      // A node without responses is valid (it's an ending node)
      // But we can check if a node that should have responses doesn't
      const hasResponses = node.responses && node.responses.length > 0;
      expect(hasResponses).toBeFalsy();
    });

    it("validates node type structures", () => {
      const validNode: DialogueNode = {
        id: "valid_node",
        text: "Valid text here.",
        responses: [
          { text: "Option A", nextNodeId: "node_a" },
          { text: "Option B", nextNodeId: "end" },
        ],
      };

      expect(typeof validNode.id).toBe("string");
      expect(typeof validNode.text).toBe("string");
      expect(Array.isArray(validNode.responses)).toBe(true);

      validNode.responses!.forEach((response) => {
        expect(typeof response.text).toBe("string");
        expect(typeof response.nextNodeId).toBe("string");
      });
    });

    it("validates effect string formats", () => {
      const validEffects = [
        "openBank",
        "openStore",
        "openShop",
        "startQuest:goblin_slayer",
        "completeQuest:dragon_hunt",
        "giveItem:gold_coins:100",
        "takeItem:iron_ore:5",
        "giveXP:mining:500",
        "teleport:lumbridge",
        "setFlag:talked_to_sage",
        "clearFlag:quest_started",
      ];

      validEffects.forEach((effect) => {
        expect(typeof effect).toBe("string");
        expect(effect.length).toBeGreaterThan(0);
      });
    });

    it("detects missing entry node", () => {
      const tree: DialogueTree = {
        entryNodeId: "missing_entry",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [],
          },
        ],
      };

      const entryExists = tree.nodes.some((n) => n.id === tree.entryNodeId);
      expect(entryExists).toBe(false);
    });

    it("validates response conditions format", () => {
      const response: DialogueResponse = {
        text: "Here's your reward!",
        nextNodeId: "reward",
        condition: "hasItem:goblin_token:10",
        effect: "giveItem:gold_coins:100",
      };

      expect(response.condition).toMatch(/^[a-zA-Z]+:/);
      expect(response.effect).toBeDefined();
    });
  });

  describe("Node Operations", () => {
    it("addDialogueNode adds to correct position", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Bye!", nextNodeId: "end" }],
          },
        ],
      };

      const newNode: DialogueNode = {
        id: "new_node",
        text: "This is new!",
        responses: [{ text: "Ok", nextNodeId: "end" }],
      };

      const updatedTree = addDialogueNode(tree, newNode);

      expect(updatedTree.nodes.length).toBe(2);
      expect(updatedTree.nodes[1].id).toBe("new_node");
      expect(updatedTree.entryNodeId).toBe("greeting");
    });

    it("addDialogueNode does not mutate original tree", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [{ id: "greeting", text: "Hello!" }],
      };

      const newNode: DialogueNode = {
        id: "new_node",
        text: "New!",
      };

      const updatedTree = addDialogueNode(tree, newNode);

      expect(tree.nodes.length).toBe(1);
      expect(updatedTree.nodes.length).toBe(2);
    });

    it("updateDialogueNode modifies existing node", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Original text",
            responses: [],
          },
        ],
      };

      const updatedTree = updateDialogueNode(tree, "greeting", {
        text: "Updated text",
      });

      expect(updatedTree.nodes[0].text).toBe("Updated text");
      expect(updatedTree.nodes[0].id).toBe("greeting");
    });

    it("updateDialogueNode preserves other node properties", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Bye!", nextNodeId: "end" }],
            speakerOverride: "Guard",
          },
        ],
      };

      const updatedTree = updateDialogueNode(tree, "greeting", {
        text: "Greetings, traveler!",
      });

      expect(updatedTree.nodes[0].speakerOverride).toBe("Guard");
      expect(updatedTree.nodes[0].responses!.length).toBe(1);
    });

    it("updateDialogueNode does not mutate original tree", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [{ id: "greeting", text: "Original" }],
      };

      const updatedTree = updateDialogueNode(tree, "greeting", {
        text: "Modified",
      });

      expect(tree.nodes[0].text).toBe("Original");
      expect(updatedTree.nodes[0].text).toBe("Modified");
    });

    it("deleteDialogueNode removes node and updates references", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Tell me more", nextNodeId: "info" }],
          },
          {
            id: "info",
            text: "Here's some info.",
            responses: [{ text: "Thanks!", nextNodeId: "end" }],
          },
        ],
      };

      const updatedTree = deleteDialogueNode(tree, "info");

      expect(updatedTree.nodes.length).toBe(1);
      expect(updatedTree.nodes[0].responses![0].nextNodeId).toBe("end");
    });

    it("deleteDialogueNode updates entry node if deleted", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          { id: "greeting", text: "Hello!" },
          { id: "backup", text: "Backup greeting." },
        ],
      };

      const updatedTree = deleteDialogueNode(tree, "greeting");

      expect(updatedTree.nodes.length).toBe(1);
      expect(updatedTree.entryNodeId).toBe("backup");
    });

    it("deleteDialogueNode does not mutate original tree", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          { id: "greeting", text: "Hello!" },
          { id: "info", text: "Info." },
        ],
      };

      const updatedTree = deleteDialogueNode(tree, "info");

      expect(tree.nodes.length).toBe(2);
      expect(updatedTree.nodes.length).toBe(1);
    });
  });

  describe("Empty Tree Creation", () => {
    it("creates tree with default greeting node", () => {
      const tree = createEmptyDialogueTree("Test NPC");

      expect(tree.entryNodeId).toBe("greeting");
      expect(tree.nodes.length).toBeGreaterThanOrEqual(1);

      const greetingNode = tree.nodes.find((n) => n.id === "greeting");
      expect(greetingNode).toBeDefined();
    });

    it("uses provided NPC name", () => {
      const npcName = "Thorin the Blacksmith";
      const tree = createEmptyDialogueTree(npcName);

      const greetingNode = tree.nodes.find((n) => n.id === "greeting");
      expect(greetingNode!.text).toContain(npcName);
    });

    it("has valid structure for editing", () => {
      const tree = createEmptyDialogueTree("Test NPC");

      // Entry node exists
      const entryNode = tree.nodes.find((n) => n.id === tree.entryNodeId);
      expect(entryNode).toBeDefined();

      // All node references are valid
      const nodeIds = new Set(tree.nodes.map((n) => n.id));
      for (const node of tree.nodes) {
        if (node.responses) {
          for (const response of node.responses) {
            if (response.nextNodeId !== "end") {
              expect(nodeIds.has(response.nextNodeId)).toBe(true);
            }
          }
        }
      }
    });

    it("includes default response options", () => {
      const tree = createEmptyDialogueTree("Guard");

      const greetingNode = tree.nodes.find((n) => n.id === "greeting");
      expect(greetingNode!.responses).toBeDefined();
      expect(greetingNode!.responses!.length).toBeGreaterThanOrEqual(1);
    });

    it("includes goodbye option", () => {
      const tree = createEmptyDialogueTree("Shopkeeper");

      const greetingNode = tree.nodes.find((n) => n.id === "greeting");
      const goodbyeResponse = greetingNode!.responses!.find(
        (r) => r.nextNodeId === "end",
      );

      expect(goodbyeResponse).toBeDefined();
    });

    it("creates multiple nodes for complete structure", () => {
      const tree = createEmptyDialogueTree("Wise Sage");

      // Should have at least greeting and about_me nodes
      expect(tree.nodes.length).toBeGreaterThanOrEqual(2);

      const hasAboutMe = tree.nodes.some((n) => n.id === "about_me");
      expect(hasAboutMe).toBe(true);
    });
  });

  describe("Data Integrity", () => {
    it("node IDs follow snake_case convention", () => {
      const validIds = [
        "greeting",
        "quest_intro",
        "trade_offer",
        "about_me",
        "shop_open",
      ];

      validIds.forEach((id) => {
        expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
      });
    });

    it("validates response text is non-empty", () => {
      const response: DialogueResponse = {
        text: "Tell me more.",
        nextNodeId: "more_info",
      };

      expect(response.text.length).toBeGreaterThan(0);
      expect(response.text.trim()).toBe(response.text);
    });

    it("validates node text is non-empty", () => {
      const node: DialogueNode = {
        id: "test",
        text: "Hello, adventurer!",
      };

      expect(node.text.length).toBeGreaterThan(0);
    });

    it("audio metadata has required fields", () => {
      const audio = {
        url: "audio/npc/greeting.mp3",
        voiceId: "voice_abc123",
        duration: 2.5,
        generatedAt: new Date().toISOString(),
      };

      expect(audio.url).toBeDefined();
      expect(audio.voiceId).toBeDefined();
      expect(audio.duration).toBeGreaterThan(0);
      expect(audio.generatedAt).toBeDefined();
    });

    it("supports optional audio timestamps for lip-sync", () => {
      const audio = {
        url: "audio/npc/greeting.mp3",
        voiceId: "voice_abc123",
        duration: 2.5,
        generatedAt: new Date().toISOString(),
        timestamps: [
          { character: "H", start: 0.0, end: 0.1 },
          { character: "e", start: 0.1, end: 0.15 },
          { character: "l", start: 0.15, end: 0.2 },
        ],
      };

      expect(audio.timestamps).toBeDefined();
      expect(audio.timestamps!.length).toBe(3);
      audio.timestamps!.forEach((ts) => {
        expect(ts.start).toBeLessThan(ts.end);
      });
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS - Mock AI, call real functions
  // ==========================================================================

  describe("Integration: generateDialogueTree", () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it("generates valid dialogue tree for merchant NPC", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Welcome to my shop, traveler! What can I get for you today?",
            responses: [
              {
                text: "Show me your wares.",
                nextNodeId: "shop",
                effect: "openStore",
              },
              { text: "Just looking around.", nextNodeId: "browse" },
              { text: "Goodbye.", nextNodeId: "end" },
            ],
          },
          {
            id: "shop",
            text: "Of course! Take your time browsing.",
            responses: [{ text: "Thanks!", nextNodeId: "end" }],
          },
          {
            id: "browse",
            text: "Feel free to look around. Let me know if you need anything.",
            responses: [{ text: "I will.", nextNodeId: "end" }],
          },
        ],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Merchant Giles",
        npcDescription: "A friendly shopkeeper with a wide selection of goods.",
        npcCategory: "neutral",
        npcRole: "shopkeeper",
        services: ["shop"],
      };

      const result = await generateDialogueTree(context);

      expect(mockGenerateText).toHaveBeenCalledOnce();
      expect(result.entryNodeId).toBe("greeting");
      expect(result.nodes.length).toBe(3);
      expect(result.nodes[0].responses).toBeDefined();
      expect(result.nodes[0].responses!.length).toBe(3);
    });

    it("generates valid dialogue tree for guard NPC", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "halt",
        nodes: [
          {
            id: "halt",
            text: "Halt! State your business in this town.",
            responses: [
              { text: "I'm just passing through.", nextNodeId: "pass" },
              { text: "I'm looking for work.", nextNodeId: "work" },
              { text: "None of your concern.", nextNodeId: "hostile" },
            ],
          },
          {
            id: "pass",
            text: "Move along then, but stay out of trouble.",
            responses: [{ text: "I will.", nextNodeId: "end" }],
          },
          {
            id: "work",
            text: "Try the notice board near the tavern.",
            responses: [{ text: "Thanks.", nextNodeId: "end" }],
          },
          {
            id: "hostile",
            text: "Watch yourself, stranger. I have my eye on you.",
            responses: [{ text: "Whatever.", nextNodeId: "end" }],
          },
        ],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Town Guard",
        npcDescription: "A stern guard protecting the town gates.",
        npcCategory: "neutral",
        npcPersonality: "suspicious and stern",
        tone: "formal",
      };

      const result = await generateDialogueTree(context);

      expect(result.entryNodeId).toBe("halt");
      expect(result.nodes.length).toBe(4);
      // Verify all node references are valid
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      for (const node of result.nodes) {
        if (node.responses) {
          for (const response of node.responses) {
            if (response.nextNodeId !== "end") {
              expect(nodeIds.has(response.nextNodeId)).toBe(true);
            }
          }
        }
      }
    });

    it("generates valid dialogue tree for quest giver NPC", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Ah, an adventurer! I could use your help.",
            responses: [
              { text: "What do you need?", nextNodeId: "quest_intro" },
              { text: "Not interested.", nextNodeId: "end" },
            ],
          },
          {
            id: "quest_intro",
            text: "Goblins have stolen my family heirloom. Will you retrieve it?",
            responses: [
              {
                text: "I'll do it.",
                nextNodeId: "accept",
                effect: "startQuest:goblin_treasure",
              },
              { text: "Maybe later.", nextNodeId: "decline" },
            ],
          },
          {
            id: "accept",
            text: "Thank you! The goblins camp east of here in the caves.",
            responses: [{ text: "I'm on my way.", nextNodeId: "end" }],
          },
          {
            id: "decline",
            text: "I understand. Come back if you change your mind.",
            responses: [{ text: "Farewell.", nextNodeId: "end" }],
          },
        ],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Elder Mariah",
        npcDescription:
          "An elderly woman who needs help recovering a family heirloom.",
        npcCategory: "quest",
        questContext: {
          questId: "goblin_treasure",
          questName: "The Stolen Heirloom",
          questDescription:
            "Retrieve the family heirloom from the goblin caves.",
          objectives: [
            "Find the goblin caves",
            "Defeat the goblin chief",
            "Retrieve the heirloom",
          ],
        },
      };

      const result = await generateDialogueTree(context);

      expect(result.entryNodeId).toBe("greeting");
      // Check for quest effect
      const acceptNode = result.nodes.find((n) => n.id === "accept");
      expect(acceptNode).toBeDefined();
      const questIntro = result.nodes.find((n) => n.id === "quest_intro");
      expect(questIntro).toBeDefined();
      const acceptResponse = questIntro!.responses!.find(
        (r) => r.nextNodeId === "accept",
      );
      expect(acceptResponse?.effect).toBe("startQuest:goblin_treasure");
    });

    it("fixes invalid node references in AI response", async () => {
      // AI returns invalid reference that should be fixed
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello there!",
            responses: [
              { text: "Hi!", nextNodeId: "nonexistent_node" }, // Invalid reference
              { text: "Bye!", nextNodeId: "end" },
            ],
          },
        ],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Test NPC",
        npcDescription: "A test NPC.",
        npcCategory: "neutral",
      };

      const result = await generateDialogueTree(context);

      // The invalid reference should be fixed to "end"
      const greetingNode = result.nodes.find((n) => n.id === "greeting");
      expect(greetingNode!.responses![0].nextNodeId).toBe("end");
    });

    it("throws error for missing entry node in AI response", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "missing_entry",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [],
          },
        ],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Test NPC",
        npcDescription: "A test NPC.",
        npcCategory: "neutral",
      };

      // The validateAndNormalizeDialogueTree throws, but generateDialogueTree catches and re-throws generic error
      await expect(generateDialogueTree(context)).rejects.toThrow(
        "Failed to generate valid dialogue tree",
      );
    });

    it("throws error for invalid JSON response", async () => {
      mockGenerateText.mockResolvedValueOnce("This is not valid JSON { broken");

      const context: DialogueGenerationContext = {
        npcName: "Test NPC",
        npcDescription: "A test NPC.",
        npcCategory: "neutral",
      };

      await expect(generateDialogueTree(context)).rejects.toThrow(
        "Failed to generate valid dialogue tree",
      );
    });

    it("throws error for empty nodes array", async () => {
      const mockDialogueTree = {
        entryNodeId: "greeting",
        nodes: [],
      };

      mockGenerateText.mockResolvedValueOnce(JSON.stringify(mockDialogueTree));

      const context: DialogueGenerationContext = {
        npcName: "Test NPC",
        npcDescription: "A test NPC.",
        npcCategory: "neutral",
      };

      // The validateAndNormalizeDialogueTree throws, but generateDialogueTree catches and re-throws generic error
      await expect(generateDialogueTree(context)).rejects.toThrow(
        "Failed to generate valid dialogue tree",
      );
    });
  });

  describe("Integration: buildDialoguePrompt", () => {
    it("builds prompt with NPC name and description", () => {
      const context: DialogueGenerationContext = {
        npcName: "Thorin",
        npcDescription: "A gruff blacksmith with a heart of gold.",
        npcCategory: "neutral",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("NPC NAME: Thorin");
      expect(prompt).toContain(
        "DESCRIPTION: A gruff blacksmith with a heart of gold.",
      );
      expect(prompt).toContain("CATEGORY: neutral");
    });

    it("includes personality when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Elara",
        npcDescription: "A mysterious elf mage.",
        npcCategory: "quest",
        npcPersonality: "mysterious and aloof",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("PERSONALITY: mysterious and aloof");
    });

    it("includes role when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Banker Bob",
        npcDescription: "The local banker.",
        npcCategory: "neutral",
        npcRole: "banker",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("ROLE: banker");
    });

    it("includes services when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Shop Owner",
        npcDescription: "Runs the general store.",
        npcCategory: "neutral",
        services: ["shop", "repair"],
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("SERVICES: shop, repair");
      expect(prompt).toContain(
        "Include dialogue options to access these services.",
      );
    });

    it("includes quest context when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Quest Giver",
        npcDescription: "A villager in need.",
        npcCategory: "quest",
        questContext: {
          questId: "rescue_mission",
          questName: "Rescue the Villagers",
          questDescription: "Save villagers from bandits.",
          objectives: [
            "Find the bandit camp",
            "Defeat the bandits",
            "Free the prisoners",
          ],
        },
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("QUEST CONTEXT:");
      expect(prompt).toContain("Quest ID: rescue_mission");
      expect(prompt).toContain("Quest Name: Rescue the Villagers");
      expect(prompt).toContain("Description: Save villagers from bandits.");
      expect(prompt).toContain(
        "Objectives: Find the bandit camp, Defeat the bandits, Free the prisoners",
      );
    });

    it("includes lore when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Town Elder",
        npcDescription: "An old man who knows the town's history.",
        npcCategory: "neutral",
        lore: "The ancient kingdom fell a thousand years ago.",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("WORLD LORE:");
      expect(prompt).toContain(
        "The ancient kingdom fell a thousand years ago.",
      );
    });

    it("includes tone when provided", () => {
      const context: DialogueGenerationContext = {
        npcName: "Grumpy Dwarf",
        npcDescription: "A dwarf who hates visitors.",
        npcCategory: "neutral",
        tone: "grumpy",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain(
        "TONE: The NPC should speak in a grumpy manner.",
      );
    });

    it("always requests at least 3-5 nodes", () => {
      const context: DialogueGenerationContext = {
        npcName: "Simple NPC",
        npcDescription: "A simple NPC.",
        npcCategory: "neutral",
      };

      const prompt = buildDialoguePrompt(context);

      expect(prompt).toContain("at least 3-5 nodes");
    });
  });

  describe("Integration: validateAndNormalizeDialogueTree", () => {
    it("validates a correct dialogue tree", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Hi!", nextNodeId: "end" }],
          },
        ],
      };

      const result = validateAndNormalizeDialogueTree(tree);

      expect(result).toEqual(tree);
    });

    it("throws error when entryNodeId is missing", () => {
      const tree = {
        entryNodeId: "",
        nodes: [{ id: "greeting", text: "Hello!" }],
      } as DialogueTree;

      expect(() => validateAndNormalizeDialogueTree(tree)).toThrow(
        "Dialogue tree missing entryNodeId",
      );
    });

    it("throws error when nodes array is empty", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [],
      };

      expect(() => validateAndNormalizeDialogueTree(tree)).toThrow(
        "Dialogue tree has no nodes",
      );
    });

    it("throws error when entry node is not found", () => {
      const tree: DialogueTree = {
        entryNodeId: "missing",
        nodes: [{ id: "greeting", text: "Hello!" }],
      };

      expect(() => validateAndNormalizeDialogueTree(tree)).toThrow(
        'Entry node "missing" not found',
      );
    });

    it("fixes invalid nextNodeId references to end", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [
              { text: "Option 1", nextNodeId: "invalid_node_1" },
              { text: "Option 2", nextNodeId: "invalid_node_2" },
              { text: "Goodbye", nextNodeId: "end" },
            ],
          },
        ],
      };

      const result = validateAndNormalizeDialogueTree(tree);

      expect(result.nodes[0].responses![0].nextNodeId).toBe("end");
      expect(result.nodes[0].responses![1].nextNodeId).toBe("end");
      expect(result.nodes[0].responses![2].nextNodeId).toBe("end");
    });

    it("preserves valid node references", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [
              { text: "Tell me more", nextNodeId: "info" },
              { text: "Goodbye", nextNodeId: "end" },
            ],
          },
          {
            id: "info",
            text: "Here is some info.",
            responses: [{ text: "Thanks!", nextNodeId: "end" }],
          },
        ],
      };

      const result = validateAndNormalizeDialogueTree(tree);

      expect(result.nodes[0].responses![0].nextNodeId).toBe("info");
      expect(result.nodes[0].responses![1].nextNodeId).toBe("end");
    });

    it("handles nodes without responses (ending nodes)", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Tell me more", nextNodeId: "info" }],
          },
          {
            id: "info",
            text: "This is all I have to say.",
            // No responses - this is an ending node
          },
        ],
      };

      const result = validateAndNormalizeDialogueTree(tree);

      expect(result.nodes[1].responses).toBeUndefined();
    });

    it("handles complex tree with multiple valid paths", () => {
      const tree: DialogueTree = {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            text: "Welcome!",
            responses: [
              { text: "Path A", nextNodeId: "branch_a" },
              { text: "Path B", nextNodeId: "branch_b" },
            ],
          },
          {
            id: "branch_a",
            text: "You chose A.",
            responses: [
              { text: "Continue", nextNodeId: "merge" },
              { text: "Exit", nextNodeId: "end" },
            ],
          },
          {
            id: "branch_b",
            text: "You chose B.",
            responses: [{ text: "Continue", nextNodeId: "merge" }],
          },
          {
            id: "merge",
            text: "Paths merged here.",
            responses: [{ text: "Done", nextNodeId: "end" }],
          },
        ],
      };

      const result = validateAndNormalizeDialogueTree(tree);

      expect(result.nodes.length).toBe(4);
      // All references should remain valid
      expect(result.nodes[0].responses![0].nextNodeId).toBe("branch_a");
      expect(result.nodes[0].responses![1].nextNodeId).toBe("branch_b");
      expect(result.nodes[1].responses![0].nextNodeId).toBe("merge");
    });
  });

  describe("Integration: generateNPCContent", () => {
    it("generates full NPC content with dialogue and backstory", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Welcome, traveler.",
            responses: [{ text: "Hello.", nextNodeId: "end" }],
          },
        ],
      };

      const mockBackstory = "Thorin was born in the mountain halls...";

      // Use mockImplementation that returns different values based on prompt content
      mockGenerateText.mockImplementation(async (prompt: string) => {
        // Dialogue generation prompts start with "Generate a dialogue tree"
        if (prompt.includes("Generate a dialogue tree")) {
          return JSON.stringify(mockDialogueTree);
        }
        // Backstory prompts start with "Write a brief backstory"
        return mockBackstory;
      });

      const context: DialogueGenerationContext = {
        npcName: "Thorin Ironforge",
        npcDescription: "A skilled blacksmith.",
        npcCategory: "neutral",
        npcPersonality: "gruff but kind",
      };

      const result = await generateNPCContent(context, true);

      // Verify results
      expect(result.id).toBe("thorin_ironforge");
      expect(result.name).toBe("Thorin Ironforge");
      expect(result.description).toBe("A skilled blacksmith.");
      expect(result.category).toBe("neutral");
      expect(result.personality).toBe("gruff but kind");
      expect(result.backstory).toBe(mockBackstory);
      expect(result.dialogue).toEqual(mockDialogueTree);
      expect(result.generatedAt).toBeDefined();
      expect(result.prompt).toContain("Thorin Ironforge");
    });

    it("generates NPC content without backstory when disabled", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [{ id: "greeting", text: "Hello!", responses: [] }],
      };

      mockGenerateText.mockImplementation(async () => {
        return JSON.stringify(mockDialogueTree);
      });

      const context: DialogueGenerationContext = {
        npcName: "Simple NPC",
        npcDescription: "A simple NPC.",
        npcCategory: "neutral",
      };

      const result = await generateNPCContent(context, false);

      expect(result.backstory).toBeUndefined();
      expect(result.dialogue).toBeDefined();
      expect(result.dialogue.entryNodeId).toBe("greeting");
    });

    it("uses neutral personality when not provided", async () => {
      const mockDialogueTree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [{ id: "greeting", text: "Hello!" }],
      };

      mockGenerateText.mockImplementation(async () => {
        return JSON.stringify(mockDialogueTree);
      });

      const context: DialogueGenerationContext = {
        npcName: "Guard",
        npcDescription: "A town guard.",
        npcCategory: "neutral",
        // No personality provided
      };

      const result = await generateNPCContent(context, false);

      expect(result.personality).toBe("neutral");
    });
  });

  describe("Integration: generateNPCBackstory", () => {
    it("generates backstory for NPC", async () => {
      const mockBackstory = `Elara was born in the enchanted forest, where she spent her youth learning the arcane arts from the forest spirits. Her talent for magic was unmatched, and she quickly rose to become the guardian of the sacred grove.

Years passed, and Elara witnessed the corruption spreading through the land. She left her home to seek heroes who could help restore balance to the world.

Now she serves as a guide to adventurers, sharing her wisdom and magical knowledge with those brave enough to face the darkness.`;

      mockGenerateText.mockImplementation(async () => mockBackstory);

      const context: DialogueGenerationContext = {
        npcName: "Elara the Sage",
        npcDescription: "An ancient elf mage who guides adventurers.",
        npcCategory: "quest",
        npcRole: "quest_giver",
        npcPersonality: "wise and mysterious",
        lore: "The ancient forest is dying from dark magic corruption.",
      };

      const result = await generateNPCBackstory(context);

      expect(result).toBe(mockBackstory);
      expect(result).toContain("Elara");
    });

    it("includes lore context in backstory generation", async () => {
      let capturedPrompt = "";
      mockGenerateText.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return "A backstory including lore.";
      });

      const context: DialogueGenerationContext = {
        npcName: "Ancient Scholar",
        npcDescription: "Keeper of forbidden knowledge.",
        npcCategory: "neutral",
        lore: "The Great Library was destroyed in the Cataclysm.",
      };

      const result = await generateNPCBackstory(context);

      expect(result).toBe("A backstory including lore.");
      expect(capturedPrompt).toContain("The Great Library was destroyed");
    });

    it("uses category as role when role not provided", async () => {
      let capturedPrompt = "";
      mockGenerateText.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return "Backstory text.";
      });

      const context: DialogueGenerationContext = {
        npcName: "Guard Captain",
        npcDescription: "Leader of the town guard.",
        npcCategory: "neutral",
        // No npcRole provided
      };

      const result = await generateNPCBackstory(context);

      expect(result).toBe("Backstory text.");
      expect(capturedPrompt).toContain("Role: neutral");
    });
  });

  describe("Integration: generateNPCId", () => {
    it("converts name to valid snake_case ID", () => {
      expect(generateNPCId("Thorin Ironforge")).toBe("thorin_ironforge");
      expect(generateNPCId("Guard Captain")).toBe("guard_captain");
      expect(generateNPCId("Elara the Sage")).toBe("elara_the_sage");
    });

    it("removes special characters", () => {
      expect(generateNPCId("Dr. Smith")).toBe("dr_smith");
      expect(generateNPCId("O'Brien")).toBe("o_brien");
      expect(generateNPCId("NPC #42")).toBe("npc_42");
    });

    it("handles leading/trailing whitespace and underscores", () => {
      expect(generateNPCId("  Spaced Name  ")).toBe("spaced_name");
      expect(generateNPCId("__Underscored__")).toBe("underscored");
    });

    it("converts uppercase to lowercase", () => {
      expect(generateNPCId("UPPERCASE")).toBe("uppercase");
      expect(generateNPCId("MixedCase")).toBe("mixedcase");
    });

    it("handles multiple consecutive special characters", () => {
      expect(generateNPCId("Name---With...Symbols")).toBe("name_with_symbols");
      expect(generateNPCId("A & B")).toBe("a_b");
    });
  });

  describe("Integration: Node Operations with Complex Trees", () => {
    it("addDialogueNode maintains tree integrity", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [{ text: "Tell me more", nextNodeId: "info" }],
          },
        ],
      };

      const newNode: DialogueNode = {
        id: "info",
        text: "Here is some information.",
        responses: [{ text: "Thanks!", nextNodeId: "end" }],
      };

      const updatedTree = addDialogueNode(tree, newNode);

      // Verify all references are now valid
      const nodeIds = new Set(updatedTree.nodes.map((n) => n.id));
      for (const node of updatedTree.nodes) {
        if (node.responses) {
          for (const response of node.responses) {
            if (response.nextNodeId !== "end") {
              expect(nodeIds.has(response.nextNodeId)).toBe(true);
            }
          }
        }
      }
    });

    it("updateDialogueNode preserves node connections", () => {
      const tree: DialogueTree = {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello!",
            responses: [
              { text: "Option A", nextNodeId: "node_a" },
              { text: "Option B", nextNodeId: "node_b" },
            ],
          },
          { id: "node_a", text: "Node A", responses: [] },
          { id: "node_b", text: "Node B", responses: [] },
        ],
      };

      const updatedTree = updateDialogueNode(tree, "greeting", {
        text: "Greetings, adventurer!",
      });

      // Responses should be preserved
      expect(updatedTree.nodes[0].responses!.length).toBe(2);
      expect(updatedTree.nodes[0].responses![0].nextNodeId).toBe("node_a");
      expect(updatedTree.nodes[0].responses![1].nextNodeId).toBe("node_b");
    });

    it("deleteDialogueNode cascades reference updates correctly", () => {
      const tree: DialogueTree = {
        entryNodeId: "start",
        nodes: [
          {
            id: "start",
            text: "Start",
            responses: [
              { text: "Go to middle", nextNodeId: "middle" },
              { text: "Go to end", nextNodeId: "final" },
            ],
          },
          {
            id: "middle",
            text: "Middle node",
            responses: [
              { text: "Back to start", nextNodeId: "start" },
              { text: "Go to final", nextNodeId: "final" },
            ],
          },
          {
            id: "final",
            text: "Final node",
            responses: [{ text: "Done", nextNodeId: "end" }],
          },
        ],
      };

      // Delete the middle node
      const updatedTree = deleteDialogueNode(tree, "middle");

      expect(updatedTree.nodes.length).toBe(2);

      // Reference to deleted node should become "end"
      const startNode = updatedTree.nodes.find((n) => n.id === "start");
      expect(startNode!.responses![0].nextNodeId).toBe("end");
      expect(startNode!.responses![1].nextNodeId).toBe("final");
    });

    it("deleteDialogueNode handles entry node deletion with proper fallback", () => {
      const tree: DialogueTree = {
        entryNodeId: "old_entry",
        nodes: [
          { id: "old_entry", text: "Old entry" },
          { id: "new_entry", text: "New entry" },
          { id: "third", text: "Third node" },
        ],
      };

      const updatedTree = deleteDialogueNode(tree, "old_entry");

      // Entry should fall back to first remaining node
      expect(updatedTree.entryNodeId).toBe("new_entry");
      expect(updatedTree.nodes.length).toBe(2);
    });
  });
});
