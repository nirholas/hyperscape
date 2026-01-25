import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuestLog } from "../../src/core/quest/useQuestLog";
import type { Quest, QuestObjective } from "../../src/core/quest/questUtils";

// Helper to create test quests
function createTestQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: `quest-${Math.random().toString(36).substr(2, 9)}`,
    title: "Test Quest",
    description: "A test quest description",
    state: "available",
    category: "side",
    level: 10,
    objectives: [
      {
        id: "obj-1",
        type: "kill",
        description: "Defeat 5 goblins",
        current: 0,
        target: 5,
      },
    ],
    rewards: [
      { type: "xp", name: "Combat XP", amount: 100 },
      { type: "gold", name: "Gold", amount: 50 },
    ],
    pinned: false,
    ...overrides,
  };
}

// Create a set of test quests
function createTestQuests(): Quest[] {
  return [
    createTestQuest({
      id: "main-1",
      title: "The Main Quest",
      category: "main",
      level: 1,
      state: "active",
      objectives: [
        {
          id: "m1-obj1",
          type: "talk",
          description: "Talk to the King",
          current: 1,
          target: 1,
        },
        {
          id: "m1-obj2",
          type: "explore",
          description: "Explore the dungeon",
          current: 0,
          target: 1,
        },
      ],
      pinned: true,
    }),
    createTestQuest({
      id: "side-1",
      title: "Side Quest Alpha",
      category: "side",
      level: 5,
      state: "available",
    }),
    createTestQuest({
      id: "side-2",
      title: "Side Quest Beta",
      category: "side",
      level: 15,
      state: "completed",
      completedAt: Date.now() - 1000,
    }),
    createTestQuest({
      id: "daily-1",
      title: "Daily Challenge",
      category: "daily",
      level: 10,
      state: "active",
      objectives: [
        {
          id: "d1-obj1",
          type: "kill",
          description: "Kill 10 monsters",
          current: 7,
          target: 10,
        },
      ],
    }),
    createTestQuest({
      id: "weekly-1",
      title: "Weekly Boss",
      category: "weekly",
      level: 50,
      state: "available",
    }),
  ];
}

describe("useQuestLog", () => {
  describe("initialization", () => {
    it("should initialize with empty quests", () => {
      const { result } = renderHook(() => useQuestLog());

      expect(result.current.quests).toEqual([]);
      expect(result.current.filteredQuests).toEqual([]);
      expect(result.current.activeCount).toBe(0);
      expect(result.current.availableCount).toBe(0);
      expect(result.current.completedCount).toBe(0);
    });

    it("should initialize with provided quests", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      expect(result.current.quests.length).toBe(5);
      expect(result.current.activeCount).toBe(2);
      expect(result.current.availableCount).toBe(2);
      expect(result.current.completedCount).toBe(1);
    });

    it("should use default sort options", () => {
      const { result } = renderHook(() => useQuestLog());

      expect(result.current.sortBy).toBe("category");
      expect(result.current.sortDirection).toBe("asc");
    });

    it("should use custom default sort options", () => {
      const { result } = renderHook(() =>
        useQuestLog({
          defaultSort: "level",
          defaultSortDirection: "desc",
        }),
      );

      expect(result.current.sortBy).toBe("level");
      expect(result.current.sortDirection).toBe("desc");
    });
  });

  describe("quest CRUD operations", () => {
    it("should add a quest", () => {
      const { result } = renderHook(() => useQuestLog());
      const newQuest = createTestQuest();

      act(() => {
        result.current.addQuest(newQuest);
      });

      expect(result.current.quests.length).toBe(1);
      expect(result.current.quests[0].id).toBe(newQuest.id);
    });

    it("should remove a quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      const initialLength = result.current.quests.length;

      act(() => {
        result.current.removeQuest("side-1");
      });

      expect(result.current.quests.length).toBe(initialLength - 1);
      expect(result.current.getQuest("side-1")).toBeUndefined();
    });

    it("should update a quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.updateQuest("side-1", { title: "Updated Title" });
      });

      expect(result.current.getQuest("side-1")?.title).toBe("Updated Title");
    });

    it("should set all quests", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      const newQuests = [createTestQuest({ id: "new-1" })];

      act(() => {
        result.current.setQuests(newQuests);
      });

      expect(result.current.quests.length).toBe(1);
      expect(result.current.quests[0].id).toBe("new-1");
    });
  });

  describe("quest state actions", () => {
    it("should accept a quest", () => {
      const initialQuests = createTestQuests();
      const onStateChange = vi.fn();
      const { result } = renderHook(() =>
        useQuestLog({ initialQuests, onQuestStateChange: onStateChange }),
      );

      act(() => {
        result.current.acceptQuest("side-1");
      });

      const quest = result.current.getQuest("side-1");
      expect(quest?.state).toBe("active");
      expect(quest?.startedAt).toBeDefined();
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "side-1", state: "active" }),
        "active",
      );
    });

    it("should abandon a quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.abandonQuest("main-1");
      });

      const quest = result.current.getQuest("main-1");
      expect(quest?.state).toBe("available");
      expect(quest?.pinned).toBe(false);
    });

    it("should complete a quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.completeQuest("main-1");
      });

      const quest = result.current.getQuest("main-1");
      expect(quest?.state).toBe("completed");
      expect(quest?.completedAt).toBeDefined();
      expect(quest?.pinned).toBe(false);
    });

    it("should fail a quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.failQuest("daily-1");
      });

      const quest = result.current.getQuest("daily-1");
      expect(quest?.state).toBe("failed");
      expect(quest?.completedAt).toBeDefined();
    });

    it("should toggle pin status", () => {
      const initialQuests = createTestQuests();
      const onPinChange = vi.fn();
      const { result } = renderHook(() =>
        useQuestLog({ initialQuests, onQuestPinChange: onPinChange }),
      );

      // main-1 is already pinned
      act(() => {
        result.current.togglePinQuest("main-1");
      });
      expect(result.current.getQuest("main-1")?.pinned).toBe(false);
      expect(onPinChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "main-1" }),
        false,
      );

      // Pin it again
      act(() => {
        result.current.togglePinQuest("main-1");
      });
      expect(result.current.getQuest("main-1")?.pinned).toBe(true);
    });
  });

  describe("objective progress", () => {
    it("should update objective progress", () => {
      const initialQuests = createTestQuests();
      const onProgress = vi.fn();
      const { result } = renderHook(() =>
        useQuestLog({ initialQuests, onObjectiveProgress: onProgress }),
      );

      act(() => {
        result.current.updateObjectiveProgress("daily-1", "d1-obj1", 9);
      });

      const quest = result.current.getQuest("daily-1");
      const objective = quest?.objectives.find((o) => o.id === "d1-obj1");
      expect(objective?.current).toBe(9);
      expect(onProgress).toHaveBeenCalledWith("daily-1", "d1-obj1", 9, 10);
    });

    it("should cap objective progress at target", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.updateObjectiveProgress("daily-1", "d1-obj1", 100);
      });

      const quest = result.current.getQuest("daily-1");
      const objective = quest?.objectives.find((o) => o.id === "d1-obj1");
      expect(objective?.current).toBe(10); // Capped at target
    });
  });

  describe("filtering", () => {
    it("should filter by search text", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setSearchText("main");
      });

      expect(result.current.filteredQuests.length).toBe(1);
      expect(result.current.filteredQuests[0].title).toBe("The Main Quest");
    });

    it("should filter by state", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ states: ["active"] });
      });

      expect(
        result.current.filteredQuests.every((q) => q.state === "active"),
      ).toBe(true);
      expect(result.current.filteredQuests.length).toBe(2);
    });

    it("should filter by category", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ categories: ["side"] });
      });

      expect(
        result.current.filteredQuests.every((q) => q.category === "side"),
      ).toBe(true);
      expect(result.current.filteredQuests.length).toBe(2);
    });

    it("should filter by level range", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ minLevel: 10, maxLevel: 20 });
      });

      expect(
        result.current.filteredQuests.every(
          (q) => q.level >= 10 && q.level <= 20,
        ),
      ).toBe(true);
    });

    it("should filter to pinned only", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ pinnedOnly: true });
      });

      expect(result.current.filteredQuests.every((q) => q.pinned)).toBe(true);
      expect(result.current.filteredQuests.length).toBe(1);
    });

    it("should update filters", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ states: ["active"] });
      });

      act(() => {
        result.current.updateFilters({ categories: ["main"] });
      });

      // Should have both filters applied
      expect(result.current.filters.states).toEqual(["active"]);
      expect(result.current.filters.categories).toEqual(["main"]);
    });

    it("should clear all filters", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setFilters({ states: ["active"], categories: ["main"] });
        result.current.setSearchText("test");
      });

      act(() => {
        result.current.clearFilters();
      });

      expect(result.current.filters).toEqual({});
      expect(result.current.searchText).toBe("");
      expect(result.current.filteredQuests.length).toBe(5);
    });
  });

  describe("sorting", () => {
    it("should sort by name", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() =>
        useQuestLog({ initialQuests, defaultSort: "name" }),
      );

      const names = result.current.filteredQuests.map((q) => q.title);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it("should sort by level", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() =>
        useQuestLog({ initialQuests, defaultSort: "level" }),
      );

      const levels = result.current.filteredQuests.map((q) => q.level);
      const sortedLevels = [...levels].sort((a, b) => a - b);
      expect(levels).toEqual(sortedLevels);
    });

    it("should sort descending", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() =>
        useQuestLog({
          initialQuests,
          defaultSort: "level",
          defaultSortDirection: "desc",
        }),
      );

      const levels = result.current.filteredQuests.map((q) => q.level);
      const sortedLevels = [...levels].sort((a, b) => b - a);
      expect(levels).toEqual(sortedLevels);
    });

    it("should change sort option", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      act(() => {
        result.current.setSortBy("level");
      });

      expect(result.current.sortBy).toBe("level");
    });

    it("should toggle sort direction", () => {
      const { result } = renderHook(() => useQuestLog());

      expect(result.current.sortDirection).toBe("asc");

      act(() => {
        result.current.toggleSortDirection();
      });

      expect(result.current.sortDirection).toBe("desc");

      act(() => {
        result.current.toggleSortDirection();
      });

      expect(result.current.sortDirection).toBe("asc");
    });
  });

  describe("helpers", () => {
    it("should get quest by ID", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      const quest = result.current.getQuest("main-1");
      expect(quest?.title).toBe("The Main Quest");
    });

    it("should return undefined for non-existent quest", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      expect(result.current.getQuest("non-existent")).toBeUndefined();
    });

    it("should calculate quest progress", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      // main-1 has 2 objectives: 1/1 complete, 0/1 incomplete = 50%
      expect(result.current.getQuestProgress("main-1")).toBe(50);

      // daily-1 has 1 objective: 7/10 = 70%
      expect(result.current.getQuestProgress("daily-1")).toBe(70);
    });

    it("should check if quest can be completed", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      // main-1 has incomplete objectives
      expect(result.current.canCompleteQuest("main-1")).toBe(false);

      // Complete main-1 objectives
      act(() => {
        result.current.updateObjectiveProgress("main-1", "m1-obj2", 1);
      });

      expect(result.current.canCompleteQuest("main-1")).toBe(true);
    });

    it("should return pinned quests sorted by progress", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      // Pin another quest
      act(() => {
        result.current.togglePinQuest("daily-1");
      });

      // daily-1 (70% progress) should come before main-1 (50% progress)
      // because pinned quests are sorted by most complete first
      expect(result.current.pinnedQuests[0].id).toBe("daily-1");
      expect(result.current.pinnedQuests[1].id).toBe("main-1");
    });
  });

  describe("groups by category", () => {
    it("should group quests by category", () => {
      const initialQuests = createTestQuests();
      const { result } = renderHook(() => useQuestLog({ initialQuests }));

      const groups = result.current.questsByCategory;

      expect(groups.main.length).toBe(1);
      expect(groups.side.length).toBe(2);
      expect(groups.daily.length).toBe(1);
      expect(groups.weekly.length).toBe(1);
      expect(groups.event.length).toBe(0);
    });
  });
});
