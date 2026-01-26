/**
 * Quest Selection Store
 *
 * Manages the currently selected quest for the quest detail panel.
 * Used to communicate between QuestsPanel (list) and QuestDetailPanel (detail view).
 */

import { create } from "zustand";
import type { Quest } from "@/game/systems/quest";

/** Quest selection store state and actions */
export interface QuestSelectionState {
  /** The currently selected quest (null if none) */
  selectedQuest: Quest | null;
  /** Set the selected quest */
  setSelectedQuest: (quest: Quest | null) => void;
  /** Clear the selected quest */
  clearSelectedQuest: () => void;
}

/**
 * Zustand store for quest selection state
 *
 * This store is used to share the selected quest between the quest list
 * and the quest detail panel, which may be in separate windows.
 */
export const useQuestSelectionStore = create<QuestSelectionState>((set) => ({
  selectedQuest: null,
  setSelectedQuest: (quest) => set({ selectedQuest: quest }),
  clearSelectedQuest: () => set({ selectedQuest: null }),
}));
