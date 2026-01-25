import { useCallback, useMemo } from "react";
import { useWindowStore } from "../../stores/windowStore";
import type {
  WindowManagerResult,
  WindowConfig,
  WindowState,
} from "../../types";

/**
 * Hook to manage all windows
 *
 * Uses a stable selector that returns the windows Map reference,
 * then converts to array in useMemo for proper React reactivity.
 *
 * @example
 * ```tsx
 * function WindowManager() {
 *   const { windows, createWindow, destroyWindow } = useWindowManager();
 *
 *   return (
 *     <div>
 *       <button onClick={() => createWindow({ tabs: [{ label: 'New', content: 'Hello' }] })}>
 *         New Window
 *       </button>
 *       {windows.map(w => (
 *         <Window key={w.id} windowId={w.id} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWindowManager(): WindowManagerResult {
  // Subscribe to the windows Map - Zustand will detect new Map references
  const windowsMap = useWindowStore((s) => s.windows);

  // Convert to sorted array - useMemo ensures stable reference when Map doesn't change
  const windows = useMemo((): WindowState[] => {
    const arr = Array.from(windowsMap.values());
    return arr.sort((a, b) => a.zIndex - b.zIndex);
  }, [windowsMap]);

  const createWindowStore = useWindowStore((s) => s.createWindow);
  const destroyWindowStore = useWindowStore((s) => s.destroyWindow);
  const getWindowStore = useWindowStore((s) => s.getWindow);
  const resetStore = useWindowStore((s) => s.reset);

  const createWindow = useCallback(
    (config?: WindowConfig): WindowState => {
      return createWindowStore(config);
    },
    [createWindowStore],
  );

  const destroyWindow = useCallback(
    (id: string) => {
      destroyWindowStore(id);
    },
    [destroyWindowStore],
  );

  const getTopWindow = useCallback((): WindowState | undefined => {
    if (windows.length === 0) return undefined;
    return windows[windows.length - 1];
  }, [windows]);

  const resetLayout = useCallback(() => {
    resetStore();
  }, [resetStore]);

  const getWindow = useCallback(
    (id: string): WindowState | undefined => {
      return getWindowStore(id);
    },
    [getWindowStore],
  );

  return {
    windows,
    createWindow,
    destroyWindow,
    getTopWindow,
    resetLayout,
    getWindow,
  };
}
