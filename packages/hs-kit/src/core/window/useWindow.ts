import { useCallback, useMemo } from "react";
import { useWindowStore } from "../../stores/windowStore";
import type { WindowResult, Point, Size } from "../../types";

/**
 * Hook to manage a single window's state
 *
 * Uses the windows Map subscription for proper reactivity.
 *
 * @example
 * ```tsx
 * function MyWindow({ id }: { id: string }) {
 *   const { window, updatePosition, bringToFront, close } = useWindow(id);
 *
 *   return (
 *     <div
 *       style={{
 *         position: 'absolute',
 *         left: window.position.x,
 *         top: window.position.y,
 *         width: window.size.width,
 *         height: window.size.height,
 *         zIndex: window.zIndex,
 *       }}
 *       onClick={bringToFront}
 *     >
 *       <button onClick={close}>Close</button>
 *       Content
 *     </div>
 *   );
 * }
 * ```
 */
export function useWindow(windowId: string): WindowResult {
  // Subscribe to the entire windows Map to ensure proper reactivity
  // Then extract our specific window in useMemo
  const windowsMap = useWindowStore((state) => state.windows);
  const window = useMemo(
    () => windowsMap.get(windowId),
    [windowsMap, windowId],
  );

  const updateWindowStore = useWindowStore((s) => s.updateWindow);
  const destroyWindowStore = useWindowStore((s) => s.destroyWindow);
  const bringToFrontStore = useWindowStore((s) => s.bringToFront);

  const updatePosition = useCallback(
    (position: Point) => {
      updateWindowStore(windowId, { position });
    },
    [windowId, updateWindowStore],
  );

  const updateSize = useCallback(
    (size: Size) => {
      updateWindowStore(windowId, { size });
    },
    [windowId, updateWindowStore],
  );

  const close = useCallback(() => {
    destroyWindowStore(windowId);
  }, [windowId, destroyWindowStore]);

  const bringToFront = useCallback(() => {
    bringToFrontStore(windowId);
  }, [windowId, bringToFrontStore]);

  const setTransparency = useCallback(
    (transparency: number) => {
      const clamped = Math.max(0, Math.min(100, transparency));
      updateWindowStore(windowId, { transparency: clamped });
    },
    [windowId, updateWindowStore],
  );

  const toggleVisible = useCallback(() => {
    if (window) {
      updateWindowStore(windowId, { visible: !window.visible });
    }
  }, [windowId, window, updateWindowStore]);

  // Return a default window state if window doesn't exist
  const safeWindow = useMemo(
    () =>
      window || {
        id: windowId,
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        minSize: { width: 200, height: 150 },
        tabs: [],
        activeTabIndex: 0,
        transparency: 0,
        visible: false,
        zIndex: 0,
        locked: false,
      },
    [window, windowId],
  );

  return {
    window: safeWindow,
    updatePosition,
    updateSize,
    close,
    bringToFront,
    setTransparency,
    toggleVisible,
  };
}
