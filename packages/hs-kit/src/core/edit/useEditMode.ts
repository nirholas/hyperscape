import { useCallback, useEffect, useRef, useState } from "react";
import { useEditStore } from "../../stores/editStore";
import type { EditModeResult, EditMode } from "../../types";

/**
 * Hook to manage edit mode (locked/unlocked interface customization)
 *
 * Features:
 * - Configurable hold-to-toggle behavior (holdToToggle, holdDuration)
 * - Exposes hold state for visual feedback (isHolding, holdProgress)
 * - Escape key immediately locks when in edit mode
 *
 * @example
 * ```tsx
 * function App() {
 *   const {
 *     mode, toggleMode, isLocked, isUnlocked,
 *     isHolding, holdProgress // For visual feedback
 *   } = useEditMode();
 *
 *   return (
 *     <div>
 *       {isHolding && <HoldIndicator progress={holdProgress} />}
 *       {isUnlocked && <EditModeOverlay />}
 *       <Windows />
 *     </div>
 *   );
 * }
 * ```
 */
export function useEditMode(): EditModeResult {
  const mode = useEditStore((s) => s.mode);
  const gridSize = useEditStore((s) => s.gridSize);
  const snapEnabled = useEditStore((s) => s.snapEnabled);
  const showGrid = useEditStore((s) => s.showGrid);
  const showGuides = useEditStore((s) => s.showGuides);
  const holdToToggle = useEditStore((s) => s.holdToToggle);
  const holdDuration = useEditStore((s) => s.holdDuration);
  const toggleKey = useEditStore((s) => s.toggleKey);

  const toggleModeStore = useEditStore((s) => s.toggleMode);
  const setModeStore = useEditStore((s) => s.setMode);
  const setSnapEnabledStore = useEditStore((s) => s.setSnapEnabled);
  const setShowGridStore = useEditStore((s) => s.setShowGrid);
  const setShowGuidesStore = useEditStore((s) => s.setShowGuides);
  const setHoldToToggleStore = useEditStore((s) => s.setHoldToToggle);
  const setHoldDurationStore = useEditStore((s) => s.setHoldDuration);
  const setToggleKeyStore = useEditStore((s) => s.setToggleKey);

  const isLocked = mode === "locked";
  const isUnlocked = mode === "unlocked";

  // Hold state for visual feedback
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0-100
  const holdStartTimeRef = useRef<number | null>(null);
  const holdAnimationRef = useRef<number | null>(null);

  const toggleMode = useCallback(() => {
    toggleModeStore();
  }, [toggleModeStore]);

  const setMode = useCallback(
    (newMode: EditMode) => {
      setModeStore(newMode);
    },
    [setModeStore],
  );

  const setSnapEnabled = useCallback(
    (enabled: boolean) => {
      setSnapEnabledStore(enabled);
    },
    [setSnapEnabledStore],
  );

  const setShowGrid = useCallback(
    (show: boolean) => {
      setShowGridStore(show);
    },
    [setShowGridStore],
  );

  const setShowGuides = useCallback(
    (show: boolean) => {
      setShowGuidesStore(show);
    },
    [setShowGuidesStore],
  );

  const setHoldToToggle = useCallback(
    (enabled: boolean) => {
      setHoldToToggleStore(enabled);
    },
    [setHoldToToggleStore],
  );

  const setHoldDurationSetting = useCallback(
    (duration: number) => {
      setHoldDurationStore(duration);
    },
    [setHoldDurationStore],
  );

  const setToggleKeySetting = useCallback(
    (key: string) => {
      setToggleKeyStore(key);
    },
    [setToggleKeyStore],
  );

  // Reset hold state helper
  const resetHoldState = useCallback(() => {
    holdStartTimeRef.current = null;
    setIsHolding(false);
    setHoldProgress(0);
    if (holdAnimationRef.current) {
      cancelAnimationFrame(holdAnimationRef.current);
      holdAnimationRef.current = null;
    }
  }, []);

  // Keyboard shortcuts with configurable hold-to-toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Toggle key handling
      if (e.key.toLowerCase() === toggleKey) {
        e.preventDefault();

        if (holdToToggle) {
          // Hold-to-toggle mode
          if (holdStartTimeRef.current !== null) return; // Already holding

          holdStartTimeRef.current = Date.now();
          setIsHolding(true);
          setHoldProgress(0);

          // Start animation loop
          const animate = () => {
            if (holdStartTimeRef.current === null) return;

            const elapsed = Date.now() - holdStartTimeRef.current;
            const progress = Math.min((elapsed / holdDuration) * 100, 100);
            setHoldProgress(progress);

            if (progress >= 100) {
              // Toggle edit mode
              toggleMode();
              resetHoldState();
            } else {
              holdAnimationRef.current = requestAnimationFrame(animate);
            }
          };

          holdAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Instant toggle mode
          toggleMode();
        }
      }

      // Escape saves and locks
      if (e.key === "Escape" && isUnlocked) {
        setMode("locked");
        resetHoldState();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === toggleKey && holdToToggle) {
        // Cancel hold if key released before duration
        resetHoldState();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdAnimationRef.current) {
        cancelAnimationFrame(holdAnimationRef.current);
      }
    };
  }, [
    toggleKey,
    holdToToggle,
    holdDuration,
    toggleMode,
    setMode,
    isUnlocked,
    resetHoldState,
  ]);

  return {
    mode,
    isLocked,
    isUnlocked,
    toggleMode,
    setMode,
    gridSize,
    snapEnabled,
    setSnapEnabled,
    showGrid,
    setShowGrid,
    showGuides,
    setShowGuides,
    // Hold-to-toggle state
    isHolding,
    holdProgress,
    holdToToggle,
    holdDuration,
    toggleKey,
    setHoldToToggle,
    setHoldDuration: setHoldDurationSetting,
    setToggleKey: setToggleKeySetting,
  };
}
