/**
 * useViewportResize - Handle viewport resize and window repositioning
 *
 * Uses anchor-based positioning (like Unity/Unreal) where windows maintain
 * their position relative to a specific viewport edge/corner.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useWindowStore } from "@/ui";
import {
  repositionWindowForViewport,
  detectNearestAnchor,
  getDefaultAnchor,
  clampPositionToViewport,
} from "@/ui/stores/anchorUtils";
import { createDefaultWindows } from "./DefaultLayoutFactory";
import { getUIScale } from "@/ui/core/drag/utils";

/** Mobile breakpoint threshold */
const MOBILE_BREAKPOINT = 768;

/**
 * Get the current scaled viewport dimensions
 * When UI is scaled, the effective viewport is smaller/larger
 */
function getScaledViewport(): { width: number; height: number } {
  const scale = getUIScale();
  return {
    width: (typeof window !== "undefined" ? window.innerWidth : 1920) / scale,
    height: (typeof window !== "undefined" ? window.innerHeight : 1080) / scale,
  };
}

/**
 * Hook for handling viewport resize and window repositioning
 *
 * @returns Object with isMobile state and viewport ref
 */
export function useViewportResize() {
  // UI state - detect mobile viewport
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false,
  );

  // Track previous viewport size for responsive repositioning
  const prevViewportRef = useRef<{ width: number; height: number }>({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  });

  // Track previous mobile state to detect mobile <-> desktop transitions
  const wasMobileRef = useRef<boolean>(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false,
  );

  // Viewport resize handling
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;
      const prevWidth = prevViewportRef.current.width;
      const prevHeight = prevViewportRef.current.height;
      const wasMobile = wasMobileRef.current;
      const nowMobile = newWidth < MOBILE_BREAKPOINT;

      setIsMobile(nowMobile);

      // Debounce the window repositioning
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Detect mobile <-> desktop UI mode transition
        const transitionedFromMobile = wasMobile && !nowMobile;
        const transitionedToMobile = !wasMobile && nowMobile;

        // Update mobile state tracking
        wasMobileRef.current = nowMobile;

        // On mobile <-> desktop transition, reset to default layout
        // Mobile and desktop use completely different layouts, so we reset entirely
        if (transitionedFromMobile || transitionedToMobile) {
          if (transitionedFromMobile) {
            // Get the default layout for the current (desktop) viewport
            const defaultWindows = createDefaultWindows();
            const windowStoreUpdate = useWindowStore.getState().updateWindow;
            const allWindows = useWindowStore.getState().getAllWindows();

            // Create a map of default window positions by ID
            const defaultPositions = new Map(
              defaultWindows.map((w) => [
                w.id,
                { position: w.position, anchor: w.anchor },
              ]),
            );

            // Update each existing window to its default position
            allWindows.forEach((win) => {
              const defaultWin = defaultPositions.get(win.id);
              if (defaultWin?.position) {
                windowStoreUpdate(win.id, {
                  position: defaultWin.position,
                  anchor: defaultWin.anchor ?? getDefaultAnchor(win.id),
                });
              } else {
                // For windows not in default layout, use anchor-based positioning
                const anchor = win.anchor ?? getDefaultAnchor(win.id);
                const newViewport = { width: newWidth, height: newHeight };
                const newPosition = repositionWindowForViewport(
                  win.position,
                  win.size,
                  anchor,
                  prevViewportRef.current,
                  newViewport,
                );
                windowStoreUpdate(win.id, {
                  position: newPosition,
                  anchor,
                });
              }
            });
          }

          // Update tracked viewport size
          prevViewportRef.current = { width: newWidth, height: newHeight };
          return;
        }

        // Skip if viewport hasn't actually changed
        if (newWidth === prevWidth && newHeight === prevHeight) return;

        // Get all windows and reposition them using anchor-based positioning
        const allWindows = useWindowStore.getState().getAllWindows();
        const windowStoreUpdate = useWindowStore.getState().updateWindow;

        const oldViewport = { width: prevWidth, height: prevHeight };
        const newViewport = { width: newWidth, height: newHeight };

        allWindows.forEach((win) => {
          // Use window's anchor if set, otherwise detect from position or use default
          const anchor =
            win.anchor ??
            detectNearestAnchor(win.position, win.size, oldViewport) ??
            getDefaultAnchor(win.id);

          // Reposition window using anchor-based calculation
          const newPosition = repositionWindowForViewport(
            win.position,
            win.size,
            anchor,
            oldViewport,
            newViewport,
          );

          // Only update if position actually changed
          const roundedX = Math.round(newPosition.x);
          const roundedY = Math.round(newPosition.y);
          if (roundedX !== win.position.x || roundedY !== win.position.y) {
            windowStoreUpdate(win.id, {
              position: { x: roundedX, y: roundedY },
              // Also save the anchor if it wasn't already set
              ...(win.anchor === undefined ? { anchor } : {}),
            });
          }
        });

        // Update tracked viewport size
        prevViewportRef.current = { width: newWidth, height: newHeight };
      }, 100);
    };

    // Initial check
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, []);

  return {
    isMobile,
    prevViewportRef,
  };
}

/**
 * Hook for clamping position within viewport bounds
 */
export function usePositionClamping() {
  const clampToViewport = useCallback(
    (
      x: number,
      y: number,
      width: number,
      height: number,
    ): { x: number; y: number } => {
      const viewport = getScaledViewport();
      const minVisible = 50;

      let newX = x;
      let newY = y;

      // Ensure window is visible
      if (newX + width < minVisible) {
        newX = minVisible - width + 100;
      }
      if (newX > viewport.width - minVisible) {
        newX = viewport.width - minVisible;
      }
      if (newY + height < minVisible) {
        newY = minVisible - height + 100;
      }
      if (newY > viewport.height - minVisible) {
        newY = viewport.height - minVisible;
      }

      return { x: Math.round(newX), y: Math.round(newY) };
    },
    [],
  );

  return { clampToViewport };
}

/**
 * Clamp all windows to the current scaled viewport bounds
 * Call this when the UI scale changes to ensure all windows stay visible
 */
export function clampAllWindowsToViewport(): void {
  const viewport = getScaledViewport();
  const allWindows = useWindowStore.getState().getAllWindows();
  const windowStoreUpdate = useWindowStore.getState().updateWindow;

  allWindows.forEach((win) => {
    const clampedPosition = clampPositionToViewport(
      win.position,
      win.size,
      viewport,
    );

    // Only update if position actually changed
    if (
      clampedPosition.x !== win.position.x ||
      clampedPosition.y !== win.position.y
    ) {
      windowStoreUpdate(win.id, {
        position: {
          x: Math.round(clampedPosition.x),
          y: Math.round(clampedPosition.y),
        },
      });
    }
  });
}
