/**
 * Progression Tracker Hook
 *
 * Tracks player progression (playtime, level) and determines
 * when to suggest complexity mode upgrades.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useComplexityStore } from "../../stores/complexityStore";
import type { ComplexityMode } from "../../types/complexity";
import { DEFAULT_PROGRESSION_THRESHOLDS } from "../../types/complexity";

/** Progression data stored in localStorage */
interface ProgressionData {
  /** Total playtime in milliseconds */
  totalPlaytimeMs: number;
  /** Last session start timestamp */
  sessionStartedAt: number | null;
  /** Whether tutorial is complete */
  tutorialComplete: boolean;
}

/** Storage key for progression data */
const STORAGE_KEY = "hs-kit-progression";

/** Default progression data */
const DEFAULT_PROGRESSION: ProgressionData = {
  totalPlaytimeMs: 0,
  sessionStartedAt: null,
  tutorialComplete: false,
};

/** Load progression data from localStorage */
function loadProgressionData(): ProgressionData {
  if (typeof window === "undefined") return DEFAULT_PROGRESSION;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_PROGRESSION, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_PROGRESSION;
}

/** Save progression data to localStorage */
function saveProgressionData(data: ProgressionData): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

/** Options for progression tracker */
export interface ProgressionTrackerOptions {
  /** Player's current level (for advanced mode suggestion) */
  playerLevel?: number;
  /** Whether tutorial is complete */
  tutorialComplete?: boolean;
  /** Custom thresholds (defaults to DEFAULT_PROGRESSION_THRESHOLDS) */
  thresholds?: {
    standardPlaytimeHours?: number;
    advancedPlaytimeHours?: number;
    advancedPlayerLevel?: number;
  };
  /** Callback when upgrade should be suggested */
  onSuggestUpgrade?: (targetMode: ComplexityMode, reason: string) => void;
}

/** Return type for progression tracker hook */
export interface ProgressionTrackerResult {
  /** Total playtime in hours */
  playtimeHours: number;
  /** Whether standard mode should be suggested */
  shouldSuggestStandard: boolean;
  /** Whether advanced mode should be suggested */
  shouldSuggestAdvanced: boolean;
  /** Reason for standard mode suggestion (if applicable) */
  standardReason: string | null;
  /** Reason for advanced mode suggestion (if applicable) */
  advancedReason: string | null;
  /** Mark tutorial as complete */
  markTutorialComplete: () => void;
  /** Manually trigger upgrade check */
  checkForUpgrade: () => void;
  /** Reset progression data (for testing) */
  resetProgression: () => void;
}

/**
 * Hook to track player progression and suggest complexity mode upgrades
 *
 * @param options - Configuration options
 * @returns Progression tracking state and actions
 *
 * @example
 * ```tsx
 * function GameUI() {
 *   const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
 *   const [upgradeTarget, setUpgradeTarget] = useState<ComplexityMode | null>(null);
 *   const [upgradeReason, setUpgradeReason] = useState<string>("");
 *
 *   const { shouldSuggestStandard, standardReason } = useProgressionTracker({
 *     playerLevel: player.level,
 *     onSuggestUpgrade: (mode, reason) => {
 *       setUpgradeTarget(mode);
 *       setUpgradeReason(reason);
 *       setShowUpgradePrompt(true);
 *     },
 *   });
 *
 *   return (
 *     <>
 *       {showUpgradePrompt && upgradeTarget && (
 *         <UpgradePrompt
 *           targetMode={upgradeTarget}
 *           reason={upgradeReason}
 *           onClose={() => setShowUpgradePrompt(false)}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */
export function useProgressionTracker(
  options: ProgressionTrackerOptions = {},
): ProgressionTrackerResult {
  const {
    playerLevel = 1,
    tutorialComplete: tutorialCompleteProp = false,
    thresholds = {},
    onSuggestUpgrade,
  } = options;

  const { shouldShowUpgradePrompt, mode } = useComplexityStore();

  // Merge thresholds with defaults
  const mergedThresholds = {
    ...DEFAULT_PROGRESSION_THRESHOLDS,
    ...thresholds,
  };

  // Progression state
  const [progression, setProgression] =
    useState<ProgressionData>(loadProgressionData);
  const sessionStartRef = useRef<number>(Date.now());
  const lastCheckRef = useRef<number>(0);
  const hasTriggeredRef = useRef<{ standard: boolean; advanced: boolean }>({
    standard: false,
    advanced: false,
  });

  // Calculate current playtime including active session
  const currentPlaytimeMs =
    progression.totalPlaytimeMs + (Date.now() - sessionStartRef.current);
  const playtimeHours = currentPlaytimeMs / (1000 * 60 * 60);

  // Determine if upgrades should be suggested
  const tutorialDone = progression.tutorialComplete || tutorialCompleteProp;

  const shouldSuggestStandard =
    mode === "simple" &&
    shouldShowUpgradePrompt("standard") &&
    tutorialDone &&
    playtimeHours >= mergedThresholds.standardPlaytimeHours;

  const shouldSuggestAdvanced =
    mode === "standard" &&
    shouldShowUpgradePrompt("advanced") &&
    (playtimeHours >= mergedThresholds.advancedPlaytimeHours ||
      playerLevel >= mergedThresholds.advancedPlayerLevel);

  // Generate reasons
  const standardReason = shouldSuggestStandard
    ? `You've completed the tutorial and played for ${playtimeHours.toFixed(1)} hours`
    : null;

  const advancedReason = shouldSuggestAdvanced
    ? playerLevel >= mergedThresholds.advancedPlayerLevel
      ? `You've reached level ${playerLevel}`
      : `You've played for ${playtimeHours.toFixed(1)} hours`
    : null;

  // Mark tutorial complete
  const markTutorialComplete = useCallback(() => {
    setProgression((prev) => {
      const updated = { ...prev, tutorialComplete: true };
      saveProgressionData(updated);
      return updated;
    });
  }, []);

  // Check for upgrade and trigger callback
  const checkForUpgrade = useCallback(() => {
    const now = Date.now();
    // Debounce checks to every 5 seconds
    if (now - lastCheckRef.current < 5000) return;
    lastCheckRef.current = now;

    if (shouldSuggestStandard && !hasTriggeredRef.current.standard) {
      hasTriggeredRef.current.standard = true;
      onSuggestUpgrade?.("standard", standardReason || "");
    } else if (shouldSuggestAdvanced && !hasTriggeredRef.current.advanced) {
      hasTriggeredRef.current.advanced = true;
      onSuggestUpgrade?.("advanced", advancedReason || "");
    }
  }, [
    shouldSuggestStandard,
    shouldSuggestAdvanced,
    standardReason,
    advancedReason,
    onSuggestUpgrade,
  ]);

  // Reset progression (for testing)
  const resetProgression = useCallback(() => {
    setProgression(DEFAULT_PROGRESSION);
    saveProgressionData(DEFAULT_PROGRESSION);
    hasTriggeredRef.current = { standard: false, advanced: false };
  }, []);

  // Save playtime on unmount and periodically
  useEffect(() => {
    // Update session start in progression data
    setProgression((prev) => ({
      ...prev,
      sessionStartedAt: sessionStartRef.current,
    }));

    // Periodic save every minute
    const saveInterval = setInterval(() => {
      setProgression((prev) => {
        const sessionDuration = Date.now() - sessionStartRef.current;
        const updated = {
          ...prev,
          totalPlaytimeMs: prev.totalPlaytimeMs + sessionDuration,
        };
        saveProgressionData(updated);
        // Reset session start after saving
        sessionStartRef.current = Date.now();
        return updated;
      });
    }, 60000);

    // Save on page unload
    const handleUnload = () => {
      const sessionDuration = Date.now() - sessionStartRef.current;
      const finalData = {
        ...progression,
        totalPlaytimeMs: progression.totalPlaytimeMs + sessionDuration,
        sessionStartedAt: null,
      };
      saveProgressionData(finalData);
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(saveInterval);
      window.removeEventListener("beforeunload", handleUnload);
      handleUnload();
    };
  }, [progression]);

  // Check for upgrades when conditions change
  useEffect(() => {
    checkForUpgrade();
  }, [checkForUpgrade]);

  // Periodic check every 30 seconds
  useEffect(() => {
    const checkInterval = setInterval(checkForUpgrade, 30000);
    return () => clearInterval(checkInterval);
  }, [checkForUpgrade]);

  return {
    playtimeHours,
    shouldSuggestStandard,
    shouldSuggestAdvanced,
    standardReason,
    advancedReason,
    markTutorialComplete,
    checkForUpgrade,
    resetProgression,
  };
}
