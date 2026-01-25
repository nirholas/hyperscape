/**
 * useDialogHistory Hook
 *
 * Hook for tracking conversation history and enabling scroll-back.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  DialogNode,
  DialogTree,
  DialogChoice,
  DialogMood,
} from "./dialogParser";

// ============================================================================
// Types
// ============================================================================

/** Entry type in conversation history */
export type DialogHistoryEntryType = "npc" | "player" | "action" | "system";

/** Single entry in conversation history */
export interface DialogHistoryEntry {
  /** Unique ID for this entry */
  id: string;
  /** Type of entry */
  type: DialogHistoryEntryType;
  /** Speaker name (NPC name or "You" for player) */
  speaker: string;
  /** Text content */
  text: string;
  /** Portrait URL/key */
  portrait: string | null;
  /** Mood for NPC entries */
  mood: DialogMood;
  /** Timestamp */
  timestamp: number;
  /** Original node ID (for debugging/reference) */
  nodeId: string | null;
  /** Choice that was selected (for player entries) */
  selectedChoice?: {
    id: string;
    text: string;
  };
  /** Voice line ID (if any) */
  voiceLineId: string | null;
}

/** Options for useDialogHistory hook */
export interface UseDialogHistoryOptions {
  /** Maximum entries to keep (0 = unlimited) */
  maxEntries?: number;
  /** Whether to persist history across sessions */
  persist?: boolean;
  /** Storage key for persistence */
  storageKey?: string;
  /** Player display name */
  playerName?: string;
  /** Callback when entry is added */
  onEntryAdded?: (entry: DialogHistoryEntry) => void;
}

/** Result from useDialogHistory hook */
export interface UseDialogHistoryResult {
  /** All history entries */
  entries: DialogHistoryEntry[];
  /** Add an NPC text entry */
  addNpcEntry: (
    speaker: string,
    text: string,
    options?: {
      portrait?: string | null;
      mood?: DialogMood;
      nodeId?: string;
      voiceLineId?: string | null;
    },
  ) => DialogHistoryEntry;
  /** Add a player choice entry */
  addPlayerEntry: (
    text: string,
    choice?: DialogChoice,
    options?: {
      nodeId?: string;
    },
  ) => DialogHistoryEntry;
  /** Add a system message */
  addSystemEntry: (
    text: string,
    options?: {
      nodeId?: string;
    },
  ) => DialogHistoryEntry;
  /** Add an action notification */
  addActionEntry: (
    text: string,
    options?: {
      nodeId?: string;
    },
  ) => DialogHistoryEntry;
  /** Record dialog node automatically */
  recordNode: (
    node: DialogNode,
    tree: DialogTree,
    selectedChoiceId?: string,
  ) => void;
  /** Clear all history */
  clear: () => void;
  /** Clear history for a specific dialog */
  clearDialog: (dialogId: string) => void;
  /** Get entries for a specific dialog (by tags) */
  getDialogEntries: (dialogId: string) => DialogHistoryEntry[];
  /** Scroll ref for auto-scroll behavior */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Scroll to bottom of history */
  scrollToBottom: () => void;
  /** Scroll to a specific entry */
  scrollToEntry: (entryId: string) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for tracking conversation history
 *
 * @example
 * ```tsx
 * function DialogWithHistory() {
 *   const dialog = useDialog({
 *     onNodeChange: (node, tree) => {
 *       history.recordNode(node, tree);
 *     }
 *   });
 *
 *   const history = useDialogHistory({
 *     maxEntries: 100,
 *     playerName: 'Player'
 *   });
 *
 *   return (
 *     <div>
 *       <DialogHistory
 *         entries={history.entries}
 *         scrollRef={history.scrollRef}
 *       />
 *       <DialogBox ... />
 *     </div>
 *   );
 * }
 * ```
 */
export function useDialogHistory(
  options: UseDialogHistoryOptions = {},
): UseDialogHistoryResult {
  const {
    maxEntries = 0,
    persist = false,
    storageKey = "dialog-history",
    playerName = "You",
    onEntryAdded,
  } = options;

  const [entries, setEntries] = useState<DialogHistoryEntry[]>(() => {
    if (persist && typeof localStorage !== "undefined") {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          return JSON.parse(stored);
        }
      } catch {
        // Ignore parse errors
      }
    }
    return [];
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const entryIdCounterRef = useRef(0);

  // Generate unique entry ID
  const generateId = useCallback(() => {
    entryIdCounterRef.current++;
    return `entry_${Date.now()}_${entryIdCounterRef.current}`;
  }, []);

  // Add entry with trimming
  const addEntry = useCallback(
    (entry: DialogHistoryEntry) => {
      setEntries((prev) => {
        let newEntries = [...prev, entry];
        if (maxEntries > 0 && newEntries.length > maxEntries) {
          newEntries = newEntries.slice(-maxEntries);
        }
        return newEntries;
      });
      onEntryAdded?.(entry);
      return entry;
    },
    [maxEntries, onEntryAdded],
  );

  // Persist to localStorage
  useEffect(() => {
    if (persist && typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    }
  }, [entries, persist, storageKey]);

  // Add NPC entry
  const addNpcEntry = useCallback(
    (
      speaker: string,
      text: string,
      entryOptions?: {
        portrait?: string | null;
        mood?: DialogMood;
        nodeId?: string;
        voiceLineId?: string | null;
      },
    ): DialogHistoryEntry => {
      const entry: DialogHistoryEntry = {
        id: generateId(),
        type: "npc",
        speaker,
        text,
        portrait: entryOptions?.portrait ?? null,
        mood: entryOptions?.mood ?? "neutral",
        timestamp: Date.now(),
        nodeId: entryOptions?.nodeId ?? null,
        voiceLineId: entryOptions?.voiceLineId ?? null,
      };
      return addEntry(entry);
    },
    [generateId, addEntry],
  );

  // Add player entry
  const addPlayerEntry = useCallback(
    (
      text: string,
      choice?: DialogChoice,
      entryOptions?: {
        nodeId?: string;
      },
    ): DialogHistoryEntry => {
      const entry: DialogHistoryEntry = {
        id: generateId(),
        type: "player",
        speaker: playerName,
        text,
        portrait: null,
        mood: "neutral",
        timestamp: Date.now(),
        nodeId: entryOptions?.nodeId ?? null,
        selectedChoice: choice
          ? {
              id: choice.id,
              text: choice.text,
            }
          : undefined,
        voiceLineId: null,
      };
      return addEntry(entry);
    },
    [generateId, addEntry, playerName],
  );

  // Add system entry
  const addSystemEntry = useCallback(
    (
      text: string,
      entryOptions?: {
        nodeId?: string;
      },
    ): DialogHistoryEntry => {
      const entry: DialogHistoryEntry = {
        id: generateId(),
        type: "system",
        speaker: "System",
        text,
        portrait: null,
        mood: "neutral",
        timestamp: Date.now(),
        nodeId: entryOptions?.nodeId ?? null,
        voiceLineId: null,
      };
      return addEntry(entry);
    },
    [generateId, addEntry],
  );

  // Add action entry
  const addActionEntry = useCallback(
    (
      text: string,
      entryOptions?: {
        nodeId?: string;
      },
    ): DialogHistoryEntry => {
      const entry: DialogHistoryEntry = {
        id: generateId(),
        type: "action",
        speaker: "",
        text,
        portrait: null,
        mood: "neutral",
        timestamp: Date.now(),
        nodeId: entryOptions?.nodeId ?? null,
        voiceLineId: null,
      };
      return addEntry(entry);
    },
    [generateId, addEntry],
  );

  // Record dialog node automatically
  const recordNode = useCallback(
    (node: DialogNode, tree: DialogTree, selectedChoiceId?: string) => {
      switch (node.type) {
        case "text":
          addNpcEntry(
            node.speaker || tree.defaultSpeaker || "Unknown",
            node.text,
            {
              portrait: node.portrait || tree.defaultPortrait,
              mood: node.mood,
              nodeId: node.id,
              voiceLineId: node.voiceLineId,
            },
          );
          break;

        case "choice":
          if (selectedChoiceId) {
            const choice = node.choices.find((c) => c.id === selectedChoiceId);
            if (choice) {
              addPlayerEntry(choice.text, choice, { nodeId: node.id });
            }
          }
          break;

        case "action":
          // Optionally record action descriptions
          for (const action of node.actions) {
            if (action.type === "give_item") {
              const itemName = (action.params.itemName as string) || "an item";
              addActionEntry(`Received ${itemName}`, { nodeId: node.id });
            } else if (action.type === "quest_start") {
              const questName =
                (action.params.questName as string) || "a quest";
              addActionEntry(`Quest started: ${questName}`, {
                nodeId: node.id,
              });
            } else if (action.type === "quest_complete") {
              const questName =
                (action.params.questName as string) || "a quest";
              addActionEntry(`Quest completed: ${questName}`, {
                nodeId: node.id,
              });
            }
          }
          break;

        case "end":
          if (node.closingText) {
            addSystemEntry(node.closingText, { nodeId: node.id });
          }
          break;
      }
    },
    [addNpcEntry, addPlayerEntry, addActionEntry, addSystemEntry],
  );

  // Clear all history
  const clear = useCallback(() => {
    setEntries([]);
    if (persist && typeof localStorage !== "undefined") {
      localStorage.removeItem(storageKey);
    }
  }, [persist, storageKey]);

  // Clear history for specific dialog (by nodeId prefix)
  const clearDialog = useCallback((dialogId: string) => {
    setEntries((prev) => prev.filter((e) => !e.nodeId?.startsWith(dialogId)));
  }, []);

  // Get entries for specific dialog
  const getDialogEntries = useCallback(
    (dialogId: string) => {
      return entries.filter((e) => e.nodeId?.startsWith(dialogId));
    },
    [entries],
  );

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Scroll to specific entry
  const scrollToEntry = useCallback((entryId: string) => {
    if (scrollRef.current) {
      const element = scrollRef.current.querySelector(
        `[data-entry-id="${entryId}"]`,
      );
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

  // Auto-scroll on new entries
  useEffect(() => {
    // Small delay to allow DOM update
    const timer = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(timer);
  }, [entries.length, scrollToBottom]);

  return {
    entries,
    addNpcEntry,
    addPlayerEntry,
    addSystemEntry,
    addActionEntry,
    recordNode,
    clear,
    clearDialog,
    getDialogEntries,
    scrollRef,
    scrollToBottom,
    scrollToEntry,
  };
}
