/**
 * useLevelUpState - State management hook for Level-Up Notifications
 *
 * Handles:
 * - Level-up detection from XP_DROP_RECEIVED events
 * - Queue management for multiple level-ups
 * - Auto-dismiss timing
 *
 * Separated from XPProgressOrb for Single Responsibility Principle (SRP).
 * Both systems independently detect level-ups - orb shows celebration animation,
 * notification shows the popup dialog.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { EventType } from "@hyperscape/shared";
import type { ClientWorld } from "../../../types";
import type { XPDropData } from "../xp-orb";
import { normalizeSkillName } from "./utils";

/** Level-up event data for popup display */
export interface LevelUpEvent {
  skill: string;
  oldLevel: number;
  newLevel: number;
  timestamp: number;
}

/** Return type for useLevelUpState hook */
export interface UseLevelUpStateResult {
  /** Currently displayed level-up (null if none) */
  currentLevelUp: LevelUpEvent | null;
  /** Dismiss the current level-up popup */
  dismissLevelUp: () => void;
}

/**
 * Hook to track level-up events and manage popup queue
 *
 * @param world - Client world instance for event subscription
 * @returns Current level-up event and dismiss callback
 */
export function useLevelUpState(world: ClientWorld): UseLevelUpStateResult {
  const [levelUpQueue, setLevelUpQueue] = useState<LevelUpEvent[]>([]);
  const [currentLevelUp, setCurrentLevelUp] = useState<LevelUpEvent | null>(
    null,
  );

  // Track previous levels to detect level-ups
  const previousLevelsRef = useRef<Record<string, number>>({});

  // Listen to XP_DROP_RECEIVED and detect level-ups
  useEffect(() => {
    const handleXPDrop = (data: unknown) => {
      // Type guard for XP drop data
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as XPDropData).skill !== "string" ||
        typeof (data as XPDropData).newLevel !== "number"
      ) {
        return;
      }

      const xpData = data as XPDropData;
      const skillKey = normalizeSkillName(xpData.skill);
      const prevLevel = previousLevelsRef.current[skillKey];

      // Detect level-up: previous level exists and new level is higher
      if (prevLevel !== undefined && xpData.newLevel > prevLevel) {
        const event: LevelUpEvent = {
          skill: xpData.skill,
          oldLevel: prevLevel,
          newLevel: xpData.newLevel,
          timestamp: Date.now(),
        };
        setLevelUpQueue((prev) => [...prev, event]);
      }

      // Always update the tracked level
      previousLevelsRef.current[skillKey] = xpData.newLevel;
    };

    world.on(EventType.XP_DROP_RECEIVED, handleXPDrop);
    return () => {
      world.off(EventType.XP_DROP_RECEIVED, handleXPDrop);
    };
  }, [world]);

  // Process queue - show one level-up at a time
  useEffect(() => {
    if (!currentLevelUp && levelUpQueue.length > 0) {
      const [next, ...rest] = levelUpQueue;
      setCurrentLevelUp(next);
      setLevelUpQueue(rest);
    }
  }, [currentLevelUp, levelUpQueue]);

  // Dismiss callback - clears current level-up, allowing next in queue
  const dismissLevelUp = useCallback(() => {
    setCurrentLevelUp(null);
  }, []);

  return { currentLevelUp, dismissLevelUp };
}
