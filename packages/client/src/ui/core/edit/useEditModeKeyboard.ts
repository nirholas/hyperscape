/**
 * useEditModeKeyboard Hook
 *
 * Handles keyboard events for edit mode toggle.
 * This hook should be called ONCE at the top level (e.g., InterfaceManager)
 * to avoid multiple event listeners causing cycling issues.
 *
 * The hold state is stored in the Zustand store so all components
 * can read it via useEditMode().
 */

import { useEffect, useRef } from "react";
import { useEditStore } from "../../stores/editStore";

/**
 * Hook that handles keyboard events for edit mode toggle.
 *
 * IMPORTANT: Call this hook only ONCE in your application,
 * typically at the top-level InterfaceManager component.
 * Multiple calls will create multiple event listeners.
 */
export function useEditModeKeyboard(): void {
  // Get store settings (these rarely change)
  const holdToToggle = useEditStore((s) => s.holdToToggle);
  const holdDuration = useEditStore((s) => s.holdDuration);
  const toggleKey = useEditStore((s) => s.toggleKey);

  // Get store actions (stable references)
  const toggleMode = useEditStore((s) => s.toggleMode);
  const setMode = useEditStore((s) => s.setMode);
  const setIsHolding = useEditStore((s) => s.setIsHolding);
  const setHoldProgress = useEditStore((s) => s.setHoldProgress);

  // Refs for tracking key state - these persist across effect re-runs
  const keyIsDownRef = useRef(false);
  const holdStartTimeRef = useRef<number | null>(null);
  const holdAnimationRef = useRef<number | null>(null);

  // Reset hold visuals helper
  const resetHoldVisuals = () => {
    holdStartTimeRef.current = null;
    setIsHolding(false);
    setHoldProgress(0);
    if (holdAnimationRef.current) {
      cancelAnimationFrame(holdAnimationRef.current);
      holdAnimationRef.current = null;
    }
  };

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
          // Key is already down - ignore repeat events
          if (keyIsDownRef.current) return;

          // Mark key as down
          keyIsDownRef.current = true;

          holdStartTimeRef.current = Date.now();
          setIsHolding(true);
          setHoldProgress(0);

          // Start animation loop
          const animate = () => {
            // Capture start time in local variable to avoid race condition
            const startTime = holdStartTimeRef.current;
            // Stop if key was released or hold was reset
            if (startTime === null) return;

            const elapsed = Date.now() - startTime;
            const progress = Math.min((elapsed / holdDuration) * 100, 100);
            setHoldProgress(progress);

            if (progress >= 100) {
              // Toggle edit mode
              toggleMode();
              // Reset visual state - key stays "down" until physical release
              resetHoldVisuals();
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

      // Escape saves and locks - use getState() to avoid stale closure
      if (e.key === "Escape" && useEditStore.getState().mode === "unlocked") {
        setMode("locked");
        resetHoldVisuals();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === toggleKey) {
        // Key released - allow new hold cycle on next press
        keyIsDownRef.current = false;
        if (holdToToggle) {
          resetHoldVisuals();
        }
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
    // Note: We use useEditStore.getState() for mode to avoid stale closures
    // without causing effect re-runs when mode changes. Store actions are stable.
  }, [
    toggleKey,
    holdToToggle,
    holdDuration,
    toggleMode,
    setMode,
    setIsHolding,
    setHoldProgress,
  ]);
}
