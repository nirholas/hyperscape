/**
 * useViewportResize - Handle viewport resize with proportional scaling
 *
 * Implements full screenspace scaling where windows scale both position AND size
 * proportionally when the viewport changes. Uses anchor-based positioning
 * (like Unity/Unreal) for edge-relative positioning.
 *
 * Key features:
 * - Proportional size scaling based on viewport ratio
 * - Anchor-based position repositioning
 * - Min/max size constraints respected
 * - Smooth transitions with debouncing
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowStore, useEditStore, type WindowState } from "@/ui";
import {
  repositionWindowForViewport,
  detectNearestAnchor,
  getDefaultAnchor,
  clampPositionToViewport,
} from "@/ui/stores/anchorUtils";
import { createDefaultWindows } from "./DefaultLayoutFactory";
import { getUIScale } from "@/ui/core/drag/utils";
import { getPanelConfig } from "./PanelRegistry";

/**
 * Snap a value to the grid
 */
function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

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
 * Calculate proportionally scaled size for a window
 */
function scaleWindowSize(
  currentSize: { width: number; height: number },
  oldViewport: { width: number; height: number },
  newViewport: { width: number; height: number },
  minSize: { width: number; height: number },
  maxSize?: { width: number; height: number },
): { width: number; height: number } {
  const widthScale = newViewport.width / oldViewport.width;
  const heightScale = newViewport.height / oldViewport.height;

  let newWidth = Math.round(currentSize.width * widthScale);
  let newHeight = Math.round(currentSize.height * heightScale);

  newWidth = Math.max(minSize.width, newWidth);
  newHeight = Math.max(minSize.height, newHeight);

  if (maxSize) {
    newWidth = Math.min(maxSize.width, newWidth);
    newHeight = Math.min(maxSize.height, newHeight);
  }

  return { width: newWidth, height: newHeight };
}

/**
 * Get panel ID from window tabs to look up sizing config
 */
function getPanelIdFromWindow(win: WindowState): string {
  const firstTab = win.tabs[0];
  if (!firstTab) return "default";
  const content = firstTab.content;
  if (typeof content === "string") return content;
  return "default";
}

/** IDs for right column windows (need to scale together) */
const RIGHT_COLUMN_WINDOW_IDS = [
  "minimap-window",
  "combat-window",
  "skills-prayer-window",
  "inventory-window",
  "menubar-window",
];

/** IDs for left column windows (need to scale together) */
const LEFT_COLUMN_WINDOW_IDS = ["quests-window", "chat-window"];

/**
 * Scale left column panels together so they fit properly.
 * Left column stacks from bottom: Chat at bottom, Quests above it.
 * Note: Quests is half the width of Chat, so each panel scales its own width.
 * Returns a map of window ID -> { position, size } for updated panels.
 * Uses grid snapping for alignment.
 */
function scaleLeftColumnPanels(
  windows: WindowState[],
  oldViewport: { width: number; height: number },
  newViewport: { width: number; height: number },
  gridSize: number,
): Map<
  string,
  {
    position: { x: number; y: number };
    size: { width: number; height: number };
  }
> {
  const updates = new Map<
    string,
    {
      position: { x: number; y: number };
      size: { width: number; height: number };
    }
  >();

  // Get left column windows sorted by Y position (bottom to top for stacking)
  const leftColumnWindows = windows
    .filter((w) => LEFT_COLUMN_WINDOW_IDS.includes(w.id))
    .sort((a, b) => b.position.y - a.position.y); // Sort by Y descending (bottom first)

  if (leftColumnWindows.length === 0) return updates;

  // Calculate scale ratios
  const widthScale = newViewport.width / oldViewport.width;
  const heightScale = newViewport.height / oldViewport.height;

  // Left edge X position is always 0
  const leftColumnX = 0;

  // Scale each panel height and stack from bottom
  let currentY = newViewport.height; // Start from bottom
  for (let i = 0; i < leftColumnWindows.length; i++) {
    const win = leftColumnWindows[i];
    const panelId = getPanelIdFromWindow(win);
    const config = getPanelConfig(panelId);

    // Scale width proportionally (each panel keeps its own width ratio)
    let newWidth = Math.round(win.size.width * widthScale);
    newWidth = Math.max(config.minSize.width, newWidth);
    newWidth = snapToGrid(newWidth, gridSize);

    // Scale height proportionally
    let newHeight = Math.round(win.size.height * heightScale);
    newHeight = Math.max(config.minSize.height, newHeight);
    // Snap height to grid
    newHeight = snapToGrid(newHeight, gridSize);

    // Position from bottom up
    currentY -= newHeight;

    // Ensure we don't go above viewport
    if (currentY < 0) {
      newHeight += currentY; // Reduce height to fit
      newHeight = Math.max(config.minSize.height, newHeight);
      currentY = 0;
    }

    updates.set(win.id, {
      position: { x: leftColumnX, y: currentY },
      size: { width: newWidth, height: newHeight },
    });
  }

  return updates;
}

/** IDs for bottom stack (attached together, menubar at bottom) */
const BOTTOM_STACK_WINDOW_IDS = [
  "combat-window",
  "skills-prayer-window",
  "inventory-window",
  "menubar-window",
];

/**
 * Scale right column panels together so they fit the viewport height.
 * Layout: Minimap (top) -> [gap] -> Bottom stack (combat, skills, inventory, menubar at bottom)
 * Returns a map of window ID -> { position, size } for updated panels.
 * Uses grid snapping for alignment.
 */
function scaleRightColumnPanels(
  windows: WindowState[],
  oldViewport: { width: number; height: number },
  newViewport: { width: number; height: number },
  gridSize: number,
): Map<
  string,
  {
    position: { x: number; y: number };
    size: { width: number; height: number };
  }
> {
  const updates = new Map<
    string,
    {
      position: { x: number; y: number };
      size: { width: number; height: number };
    }
  >();

  // Get right column windows
  const rightColumnWindows = windows.filter((w) =>
    RIGHT_COLUMN_WINDOW_IDS.includes(w.id),
  );
  if (rightColumnWindows.length === 0) return updates;

  // Separate minimap from bottom stack
  const minimapWindow = rightColumnWindows.find(
    (w) => w.id === "minimap-window",
  );
  const bottomStackWindows = rightColumnWindows
    .filter((w) => BOTTOM_STACK_WINDOW_IDS.includes(w.id))
    .sort((a, b) => a.position.y - b.position.y); // Sort top to bottom

  // Calculate scale ratios
  const widthScale = newViewport.width / oldViewport.width;
  const heightScale = newViewport.height / oldViewport.height;

  // Calculate new width for right column (all panels share same width)
  const firstPanel = rightColumnWindows[0];
  const panelConfig = getPanelConfig(getPanelIdFromWindow(firstPanel));
  let newColumnWidth = Math.round(firstPanel.size.width * widthScale);
  newColumnWidth = Math.max(panelConfig.minSize.width, newColumnWidth);
  newColumnWidth = snapToGrid(newColumnWidth, gridSize);

  // Right edge X position
  const rightColumnX = newViewport.width - newColumnWidth;

  // === SCALE BOTTOM STACK (attached, from bottom up) ===
  // Stack from bottom: menubar at very bottom, then inventory, skills, combat
  let bottomStackY = newViewport.height;
  const bottomStackUpdates: Array<{
    win: WindowState;
    height: number;
    y: number;
  }> = [];

  // Process bottom stack from bottom to top (menubar first, then inventory, etc.)
  const bottomStackReversed = [...bottomStackWindows].reverse();
  for (const win of bottomStackReversed) {
    const panelId = getPanelIdFromWindow(win);
    const config = getPanelConfig(panelId);

    // Scale height proportionally
    let newHeight = Math.round(win.size.height * heightScale);
    newHeight = Math.max(config.minSize.height, newHeight);
    newHeight = snapToGrid(newHeight, gridSize);

    bottomStackY -= newHeight;
    bottomStackUpdates.push({ win, height: newHeight, y: bottomStackY });
  }

  // Apply bottom stack updates
  for (const { win, height, y } of bottomStackUpdates) {
    updates.set(win.id, {
      position: { x: rightColumnX, y },
      size: { width: newColumnWidth, height },
    });
  }

  // === SCALE MINIMAP (at top, with gap to bottom stack) ===
  if (minimapWindow) {
    const minimapConfig = getPanelConfig("minimap");

    // Calculate gap proportionally (original gap = space between minimap bottom and combat top)
    const originalMinimapBottom =
      minimapWindow.position.y + minimapWindow.size.height;
    const combatWindow = bottomStackWindows.find(
      (w) => w.id === "combat-window",
    );
    const originalGap = combatWindow
      ? combatWindow.position.y - originalMinimapBottom
      : 20; // Default gap if combat not found

    // Scale gap proportionally
    const newGap = Math.max(10, Math.round(originalGap * heightScale));

    // Combat Y in new viewport (top of bottom stack)
    const newCombatY =
      bottomStackY +
      (bottomStackUpdates.find((u) => u.win.id === "combat-window")?.y ??
        bottomStackY);
    const actualCombatY =
      updates.get("combat-window")?.position.y ?? bottomStackY;

    // Minimap fills from top (y=0) down to gap above combat
    let newMinimapHeight = actualCombatY - newGap;
    newMinimapHeight = Math.max(minimapConfig.minSize.height, newMinimapHeight);
    newMinimapHeight = snapToGrid(newMinimapHeight, gridSize);

    updates.set(minimapWindow.id, {
      position: { x: rightColumnX, y: 0 },
      size: { width: newColumnWidth, height: newMinimapHeight },
    });
  }

  return updates;
}

/**
 * Hook for handling viewport resize with proportional scaling
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

  // Track previous viewport size for anchor-based repositioning
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

  // Viewport resize handling with anchor-based repositioning
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
        if (transitionedFromMobile || transitionedToMobile) {
          if (transitionedFromMobile) {
            const defaultWindows = createDefaultWindows();
            const windowStoreUpdate = useWindowStore.getState().updateWindow;
            const allWindows = useWindowStore.getState().getAllWindows();

            const defaultConfigs = new Map(
              defaultWindows.map((w) => [w.id, w]),
            );

            allWindows.forEach((win) => {
              const defaultWin = defaultConfigs.get(win.id);
              if (defaultWin) {
                windowStoreUpdate(win.id, {
                  position: defaultWin.position,
                  size: defaultWin.size,
                  anchor: defaultWin.anchor ?? getDefaultAnchor(win.id),
                });
              }
            });
          }

          prevViewportRef.current = { width: newWidth, height: newHeight };
          return;
        }

        // Skip if viewport hasn't actually changed
        if (newWidth === prevWidth && newHeight === prevHeight) return;

        // Get all windows and reposition them using anchors
        const allWindows = useWindowStore.getState().getAllWindows();
        const windowStoreUpdate = useWindowStore.getState().updateWindow;

        // Get grid settings for snapping
        const { gridSize, snapEnabled } = useEditStore.getState();
        const effectiveGridSize = snapEnabled ? gridSize : 0;

        const oldViewport = { width: prevWidth, height: prevHeight };
        const newViewport = { width: newWidth, height: newHeight };

        // Scale right column panels together (they stack vertically from top)
        const rightColumnUpdates = scaleRightColumnPanels(
          allWindows,
          oldViewport,
          newViewport,
          effectiveGridSize,
        );

        // Scale left column panels together (they stack vertically from bottom)
        const leftColumnUpdates = scaleLeftColumnPanels(
          allWindows,
          oldViewport,
          newViewport,
          effectiveGridSize,
        );

        // Apply right column updates
        rightColumnUpdates.forEach((update, windowId) => {
          const win = allWindows.find((w) => w.id === windowId);
          if (!win) return;

          const posChanged =
            update.position.x !== win.position.x ||
            update.position.y !== win.position.y;
          const sizeChanged =
            update.size.width !== win.size.width ||
            update.size.height !== win.size.height;

          if (posChanged || sizeChanged) {
            windowStoreUpdate(windowId, {
              position: update.position,
              size: update.size,
            });
          }
        });

        // Apply left column updates
        leftColumnUpdates.forEach((update, windowId) => {
          const win = allWindows.find((w) => w.id === windowId);
          if (!win) return;

          const posChanged =
            update.position.x !== win.position.x ||
            update.position.y !== win.position.y;
          const sizeChanged =
            update.size.width !== win.size.width ||
            update.size.height !== win.size.height;

          if (posChanged || sizeChanged) {
            windowStoreUpdate(windowId, {
              position: update.position,
              size: update.size,
            });
          }
        });

        // Handle non-column windows with individual scaling
        allWindows
          .filter(
            (win) =>
              !RIGHT_COLUMN_WINDOW_IDS.includes(win.id) &&
              !LEFT_COLUMN_WINDOW_IDS.includes(win.id),
          )
          .forEach((win) => {
            // Use window's anchor if set, otherwise detect from position
            const anchor =
              win.anchor ??
              detectNearestAnchor(win.position, win.size, oldViewport) ??
              getDefaultAnchor(win.id);

            // Get panel config for constraints
            const panelId = getPanelIdFromWindow(win);
            const panelConfig = getPanelConfig(panelId);

            // Calculate new size (optional scaling)
            const effectiveMinSize = win.minSize || panelConfig.minSize;
            const effectiveMaxSize = win.maxSize || panelConfig.maxSize;

            let newSize = scaleWindowSize(
              win.size,
              oldViewport,
              newViewport,
              effectiveMinSize,
              effectiveMaxSize,
            );

            // Snap size to grid
            newSize = {
              width: snapToGrid(newSize.width, effectiveGridSize),
              height: snapToGrid(newSize.height, effectiveGridSize),
            };
            // Re-apply min constraints after grid snap
            newSize.width = Math.max(effectiveMinSize.width, newSize.width);
            newSize.height = Math.max(effectiveMinSize.height, newSize.height);

            // Reposition window using anchor-based calculation
            const newPosition = repositionWindowForViewport(
              win.position,
              newSize,
              anchor,
              oldViewport,
              newViewport,
            );

            // Snap position to grid (unless at edge)
            const atRightEdge =
              Math.abs(newPosition.x + newSize.width - newViewport.width) <
              effectiveGridSize;
            const atBottomEdge =
              Math.abs(newPosition.y + newSize.height - newViewport.height) <
              effectiveGridSize;

            if (!atRightEdge) {
              newPosition.x = snapToGrid(newPosition.x, effectiveGridSize);
            } else {
              // Snap to right edge exactly
              newPosition.x = newViewport.width - newSize.width;
            }

            if (!atBottomEdge) {
              newPosition.y = snapToGrid(newPosition.y, effectiveGridSize);
            } else {
              // Snap to bottom edge exactly
              newPosition.y = newViewport.height - newSize.height;
            }

            // Clamp position to ensure window stays on screen
            const clampedPosition = clampPositionToViewport(
              newPosition,
              newSize,
              newViewport,
            );

            // Only update if something changed
            const posChanged =
              Math.round(clampedPosition.x) !== win.position.x ||
              Math.round(clampedPosition.y) !== win.position.y;
            const sizeChanged =
              newSize.width !== win.size.width ||
              newSize.height !== win.size.height;

            if (posChanged || sizeChanged) {
              windowStoreUpdate(win.id, {
                position: {
                  x: Math.round(clampedPosition.x),
                  y: Math.round(clampedPosition.y),
                },
                size: newSize,
                ...(win.anchor === undefined ? { anchor } : {}),
              });
            }
          });

        // Update tracked viewport size
        prevViewportRef.current = { width: newWidth, height: newHeight };
        useWindowStore.getState().setSavedViewportSize(newViewport);
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
