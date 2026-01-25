import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDialog } from "../../src/core/dialog/useDialog";
import { useDialogHistory } from "../../src/core/dialog/useDialogHistory";
import {
  parseDialogTree,
  createSimpleDialog,
  evaluateCondition,
  evaluateConditions,
  interpolateText,
  getNextNode,
  getAvailableChoices,
  type DialogTree,
  type DialogContext,
  type DialogCondition,
} from "../../src/core/dialog/dialogParser";

// ============================================================================
// Dialog Parser Tests
// ============================================================================

describe("dialogParser", () => {
  describe("parseDialogTree", () => {
    it("should parse a valid dialog tree", () => {
      const raw = {
        id: "test-dialog",
        title: "Test Dialog",
        startNodeId: "start",
        nodes: [
          {
            id: "start",
            type: "text" as const,
            speaker: "NPC",
            text: "Hello!",
            nextNodeId: "end",
          },
          {
            id: "end",
            type: "end" as const,
          },
        ],
      };

      const result = parseDialogTree(raw);

      expect(result.errors).toHaveLength(0);
      expect(result.tree.id).toBe("test-dialog");
      expect(result.tree.nodes.size).toBe(2);
      expect(result.tree.startNodeId).toBe("start");
    });

    it("should report errors for invalid nodes", () => {
      const raw = {
        id: "test",
        startNodeId: "start",
        nodes: [
          {
            id: "start",
            type: "text" as const,
            // Missing required 'text' field
            speaker: "NPC",
            nextNodeId: "missing",
          },
        ],
      };

      const result = parseDialogTree(raw);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("text"))).toBe(true);
    });

    it("should warn about unreachable nodes", () => {
      const raw = {
        id: "test",
        startNodeId: "start",
        nodes: [
          {
            id: "start",
            type: "text" as const,
            speaker: "NPC",
            text: "Hello",
            nextNodeId: "end",
          },
          {
            id: "end",
            type: "end" as const,
          },
          {
            id: "unreachable",
            type: "text" as const,
            speaker: "NPC",
            text: "You will never see this",
          },
        ],
      };

      const result = parseDialogTree(raw);

      expect(result.warnings.some((w) => w.includes("unreachable"))).toBe(true);
    });
  });

  describe("createSimpleDialog", () => {
    it("should create a linear dialog from text lines", () => {
      const dialog = createSimpleDialog(
        "greeting",
        "Greeting Dialog",
        "Guard",
        ["Hello there!", "Welcome to the city.", "Enjoy your stay."],
        "/portraits/guard.png",
      );

      expect(dialog.id).toBe("greeting");
      expect(dialog.nodes.size).toBe(4); // 3 text nodes + 1 end node
      expect(dialog.startNodeId).toBe("line_0");

      const firstNode = dialog.nodes.get("line_0");
      expect(firstNode?.type).toBe("text");
      if (firstNode?.type === "text") {
        expect(firstNode.text).toBe("Hello there!");
        expect(firstNode.speaker).toBe("Guard");
        expect(firstNode.nextNodeId).toBe("line_1");
      }
    });
  });

  describe("evaluateCondition", () => {
    const context: DialogContext = {
      player: {
        name: "Hero",
        skills: { attack: 50, defence: 30 },
        inventory: [
          { id: "coins", quantity: 1000 },
          { id: "sword", quantity: 1 },
        ],
        questStates: { cook_assistant: "completed", dragon_slayer: "started" },
        flags: { talked_to_guard: true },
        variables: { reputation: 75 },
      },
    };

    it("should evaluate quest_state conditions", () => {
      const condition: DialogCondition = {
        type: "quest_state",
        key: "cook_assistant",
        operator: "eq",
        value: "completed",
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it("should evaluate item_count conditions", () => {
      const condition: DialogCondition = {
        type: "item_count",
        key: "coins",
        operator: "gte",
        value: 500,
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it("should evaluate skill_level conditions", () => {
      const condition: DialogCondition = {
        type: "skill_level",
        key: "attack",
        operator: "gte",
        value: 40,
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it("should evaluate flag conditions", () => {
      const condition: DialogCondition = {
        type: "flag",
        key: "talked_to_guard",
        operator: "has",
        value: true,
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it("should evaluate custom conditions", () => {
      const condition: DialogCondition = {
        type: "custom",
        key: "custom_check",
        operator: "eq",
        value: true,
        evaluate: (ctx) => ctx.player?.name === "Hero",
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });
  });

  describe("evaluateConditions", () => {
    const context: DialogContext = {
      player: {
        name: "Hero",
        skills: { attack: 50 },
        flags: { quest_started: true },
      },
    };

    it("should return true when all conditions pass", () => {
      const conditions: DialogCondition[] = [
        { type: "skill_level", key: "attack", operator: "gte", value: 40 },
        { type: "flag", key: "quest_started", operator: "has", value: true },
      ];

      expect(evaluateConditions(conditions, context)).toBe(true);
    });

    it("should return false when any condition fails", () => {
      const conditions: DialogCondition[] = [
        { type: "skill_level", key: "attack", operator: "gte", value: 40 },
        { type: "skill_level", key: "defence", operator: "gte", value: 99 },
      ];

      expect(evaluateConditions(conditions, context)).toBe(false);
    });
  });

  describe("interpolateText", () => {
    it("should interpolate player name", () => {
      const context: DialogContext = {
        player: { name: "Adventurer" },
      };

      const text = "Hello, {player.name}! Welcome to our village.";
      const result = interpolateText(text, context);

      expect(result).toBe("Hello, Adventurer! Welcome to our village.");
    });

    it("should interpolate npc name", () => {
      const context: DialogContext = {
        npc: { id: "guard_1", name: "Guard Bob" },
      };

      const text = "My name is {npc.name}.";
      const result = interpolateText(text, context);

      expect(result).toBe("My name is Guard Bob.");
    });

    it("should keep original text for missing paths", () => {
      const context: DialogContext = {};
      const text = "Hello, {player.name}!";
      const result = interpolateText(text, context);

      expect(result).toBe("Hello, {player.name}!");
    });
  });

  describe("getNextNode", () => {
    let tree: DialogTree;

    beforeEach(() => {
      const result = parseDialogTree({
        id: "test",
        startNodeId: "start",
        nodes: [
          {
            id: "start",
            type: "text",
            speaker: "NPC",
            text: "Hi",
            nextNodeId: "choice",
          },
          {
            id: "choice",
            type: "choice",
            choices: [
              { id: "yes", text: "Yes", nextNodeId: "yes_response" },
              { id: "no", text: "No", nextNodeId: "no_response" },
            ],
          },
          {
            id: "yes_response",
            type: "text",
            speaker: "NPC",
            text: "Great!",
            nextNodeId: "end",
          },
          {
            id: "no_response",
            type: "text",
            speaker: "NPC",
            text: "Okay",
            nextNodeId: "end",
          },
          { id: "end", type: "end" },
        ],
      });
      tree = result.tree;
    });

    it("should navigate from text node to next", () => {
      const startNode = tree.nodes.get("start")!;
      const next = getNextNode(tree, startNode, {});

      expect(next?.id).toBe("choice");
    });

    it("should navigate from choice node with selection", () => {
      const choiceNode = tree.nodes.get("choice")!;
      const next = getNextNode(tree, choiceNode, {}, "yes");

      expect(next?.id).toBe("yes_response");
    });

    it("should return null from end node", () => {
      const endNode = tree.nodes.get("end")!;
      const next = getNextNode(tree, endNode, {});

      expect(next).toBeNull();
    });
  });

  describe("getAvailableChoices", () => {
    it("should filter choices by conditions", () => {
      const result = parseDialogTree({
        id: "test",
        startNodeId: "choice",
        nodes: [
          {
            id: "choice",
            type: "choice",
            choices: [
              { id: "always", text: "Always available", nextNodeId: "end" },
              {
                id: "conditional",
                text: "Requires high attack",
                nextNodeId: "end",
                conditions: [
                  {
                    type: "skill_level",
                    key: "attack",
                    operator: "gte",
                    value: 50,
                  },
                ],
              },
            ],
          },
          { id: "end", type: "end" },
        ],
      });

      const choiceNode = result.tree.nodes.get("choice")!;
      if (choiceNode.type !== "choice") throw new Error("Not a choice node");

      // Without meeting condition
      const lowContext: DialogContext = {
        player: { name: "Test", skills: { attack: 20 } },
      };
      const lowChoices = getAvailableChoices(choiceNode, lowContext);
      expect(lowChoices).toHaveLength(1);
      expect(lowChoices[0].id).toBe("always");

      // Meeting condition
      const highContext: DialogContext = {
        player: { name: "Test", skills: { attack: 60 } },
      };
      const highChoices = getAvailableChoices(choiceNode, highContext);
      expect(highChoices).toHaveLength(2);
    });
  });
});

// ============================================================================
// useDialog Hook Tests
// ============================================================================

describe("useDialog", () => {
  let testDialog: DialogTree;

  beforeEach(() => {
    const result = parseDialogTree({
      id: "test-dialog",
      title: "Test",
      startNodeId: "greeting",
      defaultSpeaker: "NPC",
      nodes: [
        {
          id: "greeting",
          type: "text",
          speaker: "Guard",
          text: "Hello!",
          nextNodeId: "choice",
        },
        {
          id: "choice",
          type: "choice",
          prompt: "What would you like?",
          choices: [
            { id: "talk", text: "Just talking", nextNodeId: "talk_response" },
            { id: "quest", text: "Any quests?", nextNodeId: "quest_response" },
          ],
        },
        {
          id: "talk_response",
          type: "text",
          speaker: "Guard",
          text: "Nice chat!",
          nextNodeId: "end",
        },
        {
          id: "quest_response",
          type: "text",
          speaker: "Guard",
          text: "No quests today.",
          nextNodeId: "end",
        },
        { id: "end", type: "end" },
      ],
    });
    testDialog = result.tree;
  });

  it("should start closed by default", () => {
    const { result } = renderHook(() => useDialog());

    expect(result.current.state.isOpen).toBe(false);
    expect(result.current.state.currentNode).toBeNull();
  });

  it("should open dialog and navigate to start node", async () => {
    const { result } = renderHook(
      () => useDialog({ typingSpeed: 1000 }), // Fast typing for tests
    );

    act(() => {
      result.current.open(testDialog);
    });

    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.currentNode?.id).toBe("greeting");
    expect(result.current.state.speaker).toBe("Guard");
  });

  it("should close dialog", async () => {
    const { result } = renderHook(() => useDialog({ typingSpeed: 1000 }));

    act(() => {
      result.current.open(testDialog);
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  it("should skip typing when requested", async () => {
    const { result } = renderHook(
      () => useDialog({ typingSpeed: 10 }), // Slow typing
    );

    act(() => {
      result.current.open(testDialog);
    });

    // Text should not be complete yet
    expect(result.current.state.isTypingComplete).toBe(false);

    act(() => {
      result.current.skipTyping();
    });

    expect(result.current.state.isTypingComplete).toBe(true);
    expect(result.current.state.displayedText).toBe("Hello!");
  });

  it("should navigate to choice node after text", async () => {
    const { result } = renderHook(() => useDialog({ typingSpeed: 1000 }));

    act(() => {
      result.current.open(testDialog);
    });

    // Skip typing and continue
    act(() => {
      result.current.skipTyping();
    });

    await waitFor(() => {
      expect(result.current.state.isTypingComplete).toBe(true);
    });

    act(() => {
      result.current.continue();
    });

    await waitFor(() => {
      expect(result.current.state.currentNode?.id).toBe("choice");
    });

    expect(result.current.state.availableChoices).toHaveLength(2);
    expect(result.current.hasChoices).toBe(true);
  });

  it("should select choice and navigate", async () => {
    const { result } = renderHook(() => useDialog({ typingSpeed: 1000 }));

    act(() => {
      result.current.open(testDialog);
    });

    // Skip to choice node
    act(() => {
      result.current.skipTyping();
    });

    await waitFor(() => {
      expect(result.current.state.isTypingComplete).toBe(true);
    });

    act(() => {
      result.current.continue();
    });

    await waitFor(() => {
      expect(result.current.state.currentNode?.id).toBe("choice");
    });

    // Select a choice
    act(() => {
      result.current.selectChoice("quest");
    });

    await waitFor(() => {
      expect(result.current.state.currentNode?.id).toBe("quest_response");
    });
  });

  it("should highlight and navigate choices", async () => {
    const { result } = renderHook(() => useDialog({ typingSpeed: 1000 }));

    act(() => {
      result.current.open(testDialog);
      result.current.skipTyping();
    });

    await waitFor(() => {
      expect(result.current.state.isTypingComplete).toBe(true);
    });

    act(() => {
      result.current.continue();
    });

    await waitFor(() => {
      expect(result.current.state.currentNode?.id).toBe("choice");
    });

    // Navigate choices
    act(() => {
      result.current.highlightChoice(1);
    });

    expect(result.current.state.highlightedChoiceIndex).toBe(1);

    // Select highlighted
    act(() => {
      result.current.selectHighlightedChoice();
    });

    await waitFor(() => {
      expect(result.current.state.currentNode?.id).toBe("quest_response");
    });
  });

  it("should call onAction callback for action nodes", async () => {
    const onAction = vi.fn();
    const actionDialog = parseDialogTree({
      id: "action-test",
      startNodeId: "start",
      nodes: [
        {
          id: "start",
          type: "action",
          actions: [{ type: "quest_start", params: { questId: "test_quest" } }],
          nextNodeId: "end",
        },
        { id: "end", type: "end" },
      ],
    }).tree;

    const { result } = renderHook(() =>
      useDialog({ onAction, typingSpeed: 1000 }),
    );

    act(() => {
      result.current.open(actionDialog);
    });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: "quest_start" }),
      );
    });
  });

  it("should update context", () => {
    const { result } = renderHook(() => useDialog());

    act(() => {
      result.current.updateContext({
        player: { name: "Test Hero" },
      });
    });

    expect(result.current.state.context.player?.name).toBe("Test Hero");
  });
});

// ============================================================================
// useDialogHistory Hook Tests
// ============================================================================

describe("useDialogHistory", () => {
  it("should start with empty history", () => {
    const { result } = renderHook(() => useDialogHistory());

    expect(result.current.entries).toHaveLength(0);
  });

  it("should add NPC entry", () => {
    const { result } = renderHook(() => useDialogHistory());

    act(() => {
      result.current.addNpcEntry("Guard", "Hello there!", {
        mood: "happy",
        portrait: "/guard.png",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe("npc");
    expect(result.current.entries[0].speaker).toBe("Guard");
    expect(result.current.entries[0].text).toBe("Hello there!");
    expect(result.current.entries[0].mood).toBe("happy");
  });

  it("should add player entry", () => {
    const { result } = renderHook(() =>
      useDialogHistory({ playerName: "Hero" }),
    );

    act(() => {
      result.current.addPlayerEntry("I'd like to buy something", {
        id: "buy",
        text: "I'd like to buy something",
        nextNodeId: "shop",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe("player");
    expect(result.current.entries[0].speaker).toBe("Hero");
    expect(result.current.entries[0].selectedChoice?.id).toBe("buy");
  });

  it("should add system entry", () => {
    const { result } = renderHook(() => useDialogHistory());

    act(() => {
      result.current.addSystemEntry("Quest started: The Lost Sword");
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe("system");
  });

  it("should add action entry", () => {
    const { result } = renderHook(() => useDialogHistory());

    act(() => {
      result.current.addActionEntry("Received 100 coins");
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe("action");
  });

  it("should respect maxEntries limit", () => {
    const { result } = renderHook(() => useDialogHistory({ maxEntries: 3 }));

    act(() => {
      result.current.addNpcEntry("NPC", "Message 1");
      result.current.addNpcEntry("NPC", "Message 2");
      result.current.addNpcEntry("NPC", "Message 3");
      result.current.addNpcEntry("NPC", "Message 4");
    });

    expect(result.current.entries).toHaveLength(3);
    expect(result.current.entries[0].text).toBe("Message 2");
    expect(result.current.entries[2].text).toBe("Message 4");
  });

  it("should clear history", () => {
    const { result } = renderHook(() => useDialogHistory());

    act(() => {
      result.current.addNpcEntry("NPC", "Hello");
      result.current.addPlayerEntry("Hi");
    });

    expect(result.current.entries).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.entries).toHaveLength(0);
  });

  it("should record dialog nodes automatically", () => {
    const { result: historyResult } = renderHook(() => useDialogHistory());

    const testDialog = parseDialogTree({
      id: "test",
      startNodeId: "greeting",
      defaultSpeaker: "Guard",
      nodes: [
        {
          id: "greeting",
          type: "text",
          speaker: "Guard",
          text: "Hello!",
          nextNodeId: "end",
        },
        { id: "end", type: "end" },
      ],
    }).tree;

    const textNode = testDialog.nodes.get("greeting")!;

    act(() => {
      historyResult.current.recordNode(textNode, testDialog);
    });

    expect(historyResult.current.entries).toHaveLength(1);
    expect(historyResult.current.entries[0].text).toBe("Hello!");
  });

  it("should call onEntryAdded callback", () => {
    const onEntryAdded = vi.fn();
    const { result } = renderHook(() => useDialogHistory({ onEntryAdded }));

    act(() => {
      result.current.addNpcEntry("NPC", "Test message");
    });

    expect(onEntryAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Test message",
        type: "npc",
      }),
    );
  });
});
