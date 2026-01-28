/**
 * Quest Tracker Hook
 *
 * Hook for tracking pinned/active quests with real-time
 * progress updates and notifications.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  type Quest,
  type QuestObjective,
  calculateQuestProgress,
  isObjectiveComplete,
  formatTimeRemaining,
} from "./questUtils";

// ============================================================================
// Types
// ============================================================================

/** Configuration for useQuestTracker hook */
export interface UseQuestTrackerOptions {
  /** Maximum number of tracked quests */
  maxTracked?: number;
  /** Auto-remove completed quests after delay (ms) */
  autoRemoveCompletedDelay?: number;
  /** Show time remaining for timed quests */
  showTimers?: boolean;
  /** Update interval for timers (ms) */
  timerUpdateInterval?: number;
  /** Callback when objective completes */
  onObjectiveComplete?: (quest: Quest, objective: QuestObjective) => void;
  /** Callback when quest completes */
  onQuestComplete?: (quest: Quest) => void;
  /** Callback when timed quest expires */
  onTimedQuestExpire?: (quest: Quest) => void;
}

/** Tracked quest with computed state */
export interface TrackedQuest {
  /** The quest data */
  quest: Quest;
  /** Overall progress (0-100) */
  progress: number;
  /** Currently focused objective (first incomplete) */
  currentObjective: QuestObjective | null;
  /** Time remaining (formatted string) */
  timeRemainingText: string | null;
  /** Whether quest is near completion (>80%) */
  nearCompletion: boolean;
  /** Whether timed quest is expiring soon */
  expiringSoon: boolean;
  /** Display order (for animation) */
  displayOrder: number;
}

/** Return value from useQuestTracker hook */
export interface UseQuestTrackerResult {
  /** Currently tracked quests */
  trackedQuests: TrackedQuest[];
  /** Number of tracked quests */
  trackedCount: number;
  /** Whether max tracked limit reached */
  isAtLimit: boolean;

  // Actions
  /** Track a quest (pin to tracker) */
  trackQuest: (quest: Quest) => boolean;
  /** Untrack a quest */
  untrackQuest: (questId: string) => void;
  /** Check if quest is tracked */
  isTracked: (questId: string) => boolean;
  /** Update tracked quest data */
  updateTrackedQuest: (quest: Quest) => void;
  /** Reorder tracked quests */
  reorderTracked: (fromIndex: number, toIndex: number) => void;
  /** Clear all tracked quests */
  clearAllTracked: () => void;

  // State
  /** Expanded quest ID (for mobile view) */
  expandedQuestId: string | null;
  /** Set expanded quest */
  setExpandedQuestId: (questId: string | null) => void;
  /** Toggle expanded state */
  toggleExpanded: (questId: string) => void;

  // Animation state
  /** Quest IDs that were recently added (for enter animation) */
  recentlyAdded: Set<string>;
  /** Quest IDs that are being removed (for exit animation) */
  beingRemoved: Set<string>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Quest tracker hook for managing pinned quests
 *
 * @example
 * ```tsx
 * function QuestTracker() {
 *   const { trackedQuests, trackQuest, untrackQuest } = useQuestTracker({
 *     maxTracked: 5,
 *     onQuestComplete: (quest) => showNotification(`Quest complete: ${quest.title}`),
 *   });
 *
 *   return (
 *     <div className="quest-tracker">
 *       {trackedQuests.map(({ quest, progress, currentObjective }) => (
 *         <div key={quest.id}>
 *           <h4>{quest.title} ({progress}%)</h4>
 *           {currentObjective && (
 *             <p>{currentObjective.description} ({currentObjective.current}/{currentObjective.target})</p>
 *           )}
 *           <button onClick={() => untrackQuest(quest.id)}>Untrack</button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useQuestTracker(
  options: UseQuestTrackerOptions = {},
): UseQuestTrackerResult {
  const {
    maxTracked = 5,
    autoRemoveCompletedDelay,
    showTimers = true,
    timerUpdateInterval = 1000,
    onObjectiveComplete,
    onQuestComplete,
    onTimedQuestExpire,
  } = options;

  // Core state
  const [trackedQuestIds, setTrackedQuestIds] = useState<string[]>([]);
  const [questsMap, setQuestsMap] = useState<Map<string, Quest>>(new Map());
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);

  // Animation state
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [beingRemoved, setBeingRemoved] = useState<Set<string>>(new Set());

  // Timer state
  const [timerTick, setTimerTick] = useState(0);

  // Previous objectives for completion detection
  const prevObjectivesRef = useRef<Map<string, Map<string, boolean>>>(
    new Map(),
  );

  // Timer interval for timed quests
  useEffect(() => {
    if (!showTimers) return;

    const hasTimedQuests = Array.from(questsMap.values()).some(
      (q) => q.timeRemaining !== undefined && q.timeRemaining > 0,
    );

    if (!hasTimedQuests) return;

    const interval = setInterval(() => {
      setTimerTick((prev) => prev + 1);

      // Check for expired quests
      questsMap.forEach((quest) => {
        if (quest.timeRemaining !== undefined && quest.timeRemaining <= 0) {
          onTimedQuestExpire?.(quest);
        }
      });
    }, timerUpdateInterval);

    return () => clearInterval(interval);
  }, [showTimers, timerUpdateInterval, questsMap, onTimedQuestExpire]);

  // Clear recently added after animation
  useEffect(() => {
    if (recentlyAdded.size === 0) return;

    const timeout = setTimeout(() => {
      setRecentlyAdded(new Set());
    }, 500);

    return () => clearTimeout(timeout);
  }, [recentlyAdded]);

  // Computed tracked quests
  const trackedQuests = useMemo((): TrackedQuest[] => {
    // Force recompute on timer tick
    void timerTick;

    return trackedQuestIds
      .map((id, index) => {
        const quest = questsMap.get(id);
        if (!quest) return null;

        const progress = calculateQuestProgress(quest);
        const currentObjective =
          quest.objectives.find((o) => !isObjectiveComplete(o) && !o.hidden) ||
          null;

        const timeRemainingText =
          quest.timeRemaining !== undefined
            ? formatTimeRemaining(quest.timeRemaining)
            : null;

        return {
          quest,
          progress,
          currentObjective,
          timeRemainingText,
          nearCompletion: progress >= 80,
          expiringSoon:
            quest.timeRemaining !== undefined && quest.timeRemaining <= 60,
          displayOrder: index,
        };
      })
      .filter((t): t is TrackedQuest => t !== null);
  }, [trackedQuestIds, questsMap, timerTick]);

  // Check for objective/quest completion
  useEffect(() => {
    trackedQuests.forEach(({ quest }) => {
      const prevObjectives = prevObjectivesRef.current.get(quest.id);
      const currentObjectives = new Map<string, boolean>();

      quest.objectives.forEach((obj) => {
        const wasComplete = prevObjectives?.get(obj.id) ?? false;
        const isComplete = isObjectiveComplete(obj);

        currentObjectives.set(obj.id, isComplete);

        // Check if objective just completed
        if (isComplete && !wasComplete) {
          onObjectiveComplete?.(quest, obj);
        }
      });

      prevObjectivesRef.current.set(quest.id, currentObjectives);
    });

    // Check for quest completion
    trackedQuests.forEach(({ quest, progress }) => {
      if (progress === 100 && quest.state === "active") {
        onQuestComplete?.(quest);

        // Auto-remove after delay
        if (autoRemoveCompletedDelay !== undefined) {
          setTimeout(() => {
            untrackQuest(quest.id);
          }, autoRemoveCompletedDelay);
        }
      }
    });
  }, [
    trackedQuests,
    onObjectiveComplete,
    onQuestComplete,
    autoRemoveCompletedDelay,
  ]);

  // Actions
  const trackQuest = useCallback(
    (quest: Quest): boolean => {
      if (trackedQuestIds.length >= maxTracked) {
        return false;
      }

      if (trackedQuestIds.includes(quest.id)) {
        // Already tracked, just update data
        setQuestsMap((prev) => new Map(prev).set(quest.id, quest));
        return true;
      }

      setTrackedQuestIds((prev) => [...prev, quest.id]);
      setQuestsMap((prev) => new Map(prev).set(quest.id, quest));
      setRecentlyAdded((prev) => new Set(prev).add(quest.id));

      // Initialize objective tracking
      const objectiveStatus = new Map<string, boolean>();
      quest.objectives.forEach((obj) => {
        objectiveStatus.set(obj.id, isObjectiveComplete(obj));
      });
      prevObjectivesRef.current.set(quest.id, objectiveStatus);

      return true;
    },
    [trackedQuestIds, maxTracked],
  );

  const untrackQuest = useCallback((questId: string) => {
    setBeingRemoved((prev) => new Set(prev).add(questId));

    // Delay actual removal for exit animation
    setTimeout(() => {
      setTrackedQuestIds((prev) => prev.filter((id) => id !== questId));
      setQuestsMap((prev) => {
        const next = new Map(prev);
        next.delete(questId);
        return next;
      });
      setBeingRemoved((prev) => {
        const next = new Set(prev);
        next.delete(questId);
        return next;
      });
      prevObjectivesRef.current.delete(questId);
    }, 300);
  }, []);

  const isTracked = useCallback(
    (questId: string): boolean => {
      return trackedQuestIds.includes(questId);
    },
    [trackedQuestIds],
  );

  const updateTrackedQuest = useCallback((quest: Quest) => {
    setQuestsMap((prev) => {
      if (!prev.has(quest.id)) return prev;
      return new Map(prev).set(quest.id, quest);
    });
  }, []);

  const reorderTracked = useCallback((fromIndex: number, toIndex: number) => {
    setTrackedQuestIds((prev) => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  }, []);

  const clearAllTracked = useCallback(() => {
    // Mark all as being removed
    setBeingRemoved(new Set(trackedQuestIds));

    // Clear after animation
    setTimeout(() => {
      setTrackedQuestIds([]);
      setQuestsMap(new Map());
      setBeingRemoved(new Set());
      prevObjectivesRef.current.clear();
    }, 300);
  }, [trackedQuestIds]);

  const toggleExpanded = useCallback((questId: string) => {
    setExpandedQuestId((prev) => (prev === questId ? null : questId));
  }, []);

  return {
    // Data
    trackedQuests,
    trackedCount: trackedQuestIds.length,
    isAtLimit: trackedQuestIds.length >= maxTracked,

    // Actions
    trackQuest,
    untrackQuest,
    isTracked,
    updateTrackedQuest,
    reorderTracked,
    clearAllTracked,

    // State
    expandedQuestId,
    setExpandedQuestId,
    toggleExpanded,

    // Animation
    recentlyAdded,
    beingRemoved,
  };
}
