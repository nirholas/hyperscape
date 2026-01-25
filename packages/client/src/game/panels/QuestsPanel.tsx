/**
 * QuestsPanel - Quest Log panel for the game interface
 *
 * Connects the hs-kit QuestLog component to the game world's quest system.
 * Displays available, active, and completed quests with filtering and sorting.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  QuestLog,
  type Quest,
  type QuestState,
  type QuestCategory,
  type QuestSortOption,
  type SortDirection,
  sortQuests,
  filterQuests,
} from "hs-kit";
import type { ClientWorld } from "../../types";

interface QuestsPanelProps {
  world: ClientWorld;
}

/**
 * QuestsPanel Component
 *
 * Displays the quest log with filtering, sorting, and quest management.
 * Connects to the game world for quest data and actions.
 */
export function QuestsPanel({ world }: QuestsPanelProps) {
  // Filter state
  const [searchText, setSearchText] = useState("");
  const [stateFilter, setStateFilter] = useState<QuestState[]>([
    "available",
    "active",
  ]);
  const [categoryFilter, setCategoryFilter] = useState<QuestCategory[]>([]);
  const [sortBy, setSortBy] = useState<QuestSortOption>("category");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);

  // Get quests from world
  // TODO: Connect to actual quest system when available
  const allQuests = useMemo<Quest[]>(() => {
    // Check if world has quest data
    const questSystem = world.getSystem?.("quests");
    if (
      questSystem &&
      typeof questSystem === "object" &&
      "getPlayerQuests" in questSystem
    ) {
      const getQuests = questSystem.getPlayerQuests as () => Quest[];
      return getQuests();
    }

    // Return sample quests for development/testing
    return getSampleQuests();
  }, [world]);

  // Filter and sort quests
  const filteredQuests = useMemo(() => {
    let quests = [...allQuests];

    // Apply filters
    quests = filterQuests(quests, {
      searchText: searchText,
      states: stateFilter.length > 0 ? stateFilter : undefined,
      categories: categoryFilter.length > 0 ? categoryFilter : undefined,
    });

    // Apply sorting
    quests = sortQuests(quests, sortBy, sortDirection);

    return quests;
  }, [
    allQuests,
    searchText,
    stateFilter,
    categoryFilter,
    sortBy,
    sortDirection,
  ]);

  // Quest counts
  const questCounts = useMemo(
    () => ({
      active: allQuests.filter((q) => q.state === "active").length,
      available: allQuests.filter((q) => q.state === "available").length,
      completed: allQuests.filter((q) => q.state === "completed").length,
    }),
    [allQuests],
  );

  // Quest actions
  const handleSelectQuest = useCallback((quest: Quest | null) => {
    setSelectedQuestId(quest?.id ?? null);
  }, []);

  const handleAcceptQuest = useCallback(
    (quest: Quest) => {
      // Send accept quest request to server
      world.network?.send?.("questAccept", { questId: quest.id });
    },
    [world],
  );

  const handleAbandonQuest = useCallback(
    (quest: Quest) => {
      // Send abandon quest request to server
      world.network?.send?.("questAbandon", { questId: quest.id });
    },
    [world],
  );

  const handleTogglePin = useCallback(
    (quest: Quest) => {
      // Toggle pinned state - this could be client-side only or synced
      world.network?.send?.("questTogglePin", { questId: quest.id });
    },
    [world],
  );

  const handleTrackQuest = useCallback(
    (quest: Quest) => {
      // Track quest on screen
      world.network?.send?.("questTrack", { questId: quest.id });
    },
    [world],
  );

  return (
    <QuestLog
      quests={filteredQuests}
      questCounts={questCounts}
      searchText={searchText}
      onSearchChange={setSearchText}
      sortBy={sortBy}
      onSortChange={setSortBy}
      sortDirection={sortDirection}
      onSortDirectionChange={setSortDirection}
      stateFilter={stateFilter}
      onStateFilterChange={setStateFilter}
      categoryFilter={categoryFilter}
      onCategoryFilterChange={setCategoryFilter}
      selectedQuestId={selectedQuestId}
      onSelectQuest={handleSelectQuest}
      onTogglePin={handleTogglePin}
      onAcceptQuest={handleAcceptQuest}
      onAbandonQuest={handleAbandonQuest}
      onTrackQuest={handleTrackQuest}
      groupByCategory
      showSearch
      showFilters
      showSort
      showHeader
      title="Quest Log"
      emptyMessage="No quests found. Talk to NPCs to discover new quests!"
      style={{ height: "100%", border: "none", background: "transparent" }}
    />
  );
}

/**
 * Sample quests for development/testing
 * TODO: Remove when real quest system is connected
 */
function getSampleQuests(): Quest[] {
  return [
    {
      id: "tutorial-1",
      title: "Welcome to Hyperscape",
      description:
        "Learn the basics of the game by completing the tutorial tasks.",
      state: "active",
      category: "main",
      level: 1,
      objectives: [
        {
          id: "obj-1",
          type: "talk",
          description: "Talk to the Tutorial Guide",
          current: 1,
          target: 1,
        },
        {
          id: "obj-2",
          type: "explore",
          description: "Walk to the Training Grounds",
          current: 0,
          target: 1,
        },
        {
          id: "obj-3",
          type: "kill",
          description: "Defeat training dummies",
          current: 2,
          target: 5,
        },
      ],
      rewards: [
        { type: "xp", name: "Combat XP", amount: 100, skill: "combat" },
        { type: "gold", name: "Gold", amount: 50, icon: "🪙" },
      ],
      pinned: true,
      questGiver: "Tutorial Guide",
      questGiverLocation: "Spawn Point",
    },
    {
      id: "gather-resources",
      title: "Resource Gathering",
      description: "Collect resources from the wilderness to prove your worth.",
      state: "available",
      category: "side",
      level: 5,
      objectives: [
        {
          id: "obj-1",
          type: "collect",
          description: "Gather oak logs",
          current: 0,
          target: 10,
        },
        {
          id: "obj-2",
          type: "collect",
          description: "Mine copper ore",
          current: 0,
          target: 10,
        },
      ],
      rewards: [
        {
          type: "xp",
          name: "Woodcutting XP",
          amount: 200,
          skill: "woodcutting",
        },
        { type: "xp", name: "Mining XP", amount: 200, skill: "mining" },
        { type: "item", name: "Bronze Axe", itemId: "bronze_axe" },
      ],
      pinned: false,
      questGiver: "Resource Master",
      questGiverLocation: "Lumbridge",
    },
    {
      id: "daily-fishing",
      title: "Gone Fishing",
      description: "Catch some fish for the local inn.",
      state: "available",
      category: "daily",
      level: 1,
      objectives: [
        {
          id: "obj-1",
          type: "collect",
          description: "Catch raw fish",
          current: 0,
          target: 5,
        },
      ],
      rewards: [
        { type: "gold", name: "Gold", amount: 25, icon: "🪙" },
        { type: "xp", name: "Fishing XP", amount: 50, skill: "fishing" },
      ],
      pinned: false,
      questGiver: "Inn Keeper",
      questGiverLocation: "Lumbridge Inn",
    },
    {
      id: "completed-intro",
      title: "A New Beginning",
      description: "You have arrived in Hyperscape and taken your first steps.",
      state: "completed",
      category: "main",
      level: 1,
      objectives: [
        {
          id: "obj-1",
          type: "talk",
          description: "Speak with the Welcome NPC",
          current: 1,
          target: 1,
        },
      ],
      rewards: [{ type: "quest_points", name: "Quest Points", amount: 1 }],
      pinned: false,
      completedAt: Date.now() - 86400000,
    },
  ];
}

export default QuestsPanel;
