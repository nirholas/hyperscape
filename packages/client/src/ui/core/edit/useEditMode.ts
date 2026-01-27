import { useCallback } from "react";
import { useEditStore } from "../../stores/editStore";
import type { EditModeResult, EditMode } from "../../types";

/**
 * Hook to manage edit mode (locked/unlocked interface customization)
 *
 * This hook provides access to edit mode state and actions.
 * Keyboard handling is done separately by useEditModeKeyboard(),
 * which should be called once at the top level (InterfaceManager).
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
  // Read state from store
  const mode = useEditStore((s) => s.mode);
  const gridSize = useEditStore((s) => s.gridSize);
  const snapEnabled = useEditStore((s) => s.snapEnabled);
  const showGrid = useEditStore((s) => s.showGrid);
  const showGuides = useEditStore((s) => s.showGuides);
  const holdToToggle = useEditStore((s) => s.holdToToggle);
  const holdDuration = useEditStore((s) => s.holdDuration);
  const toggleKey = useEditStore((s) => s.toggleKey);

  // Hold state from store (managed by useEditModeKeyboard)
  const isHolding = useEditStore((s) => s.isHolding);
  const holdProgress = useEditStore((s) => s.holdProgress);

  // Get store actions
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

  // Note: Keyboard handling is done by useEditModeKeyboard() hook,
  // which should be called once at the top level (InterfaceManager).
  // This hook only provides access to state and actions.

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
