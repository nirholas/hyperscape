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

/** Mobile breakpoint threshold - aligned with breakpoints.md (640px) */
const MOBILE_BREAKPOINT = 640;

/** Design resolution used as stable reference for scaling */
const DESIGN_RESOLUTION = { width: 1920, height: 1080 };

/** Maximum scale ratio to prevent extreme scaling */
const MAX_SCALE_RATIO = 2.0;

/** Minimum scale ratio to prevent extreme scaling */
const MIN_SCALE_RATIO = 0.5;

/**
 * Clamp a scale ratio to prevent extreme scaling
 * Returns 1.0 (no scaling) if ratio is outside safe bounds
 */
function clampScaleRatio(ratio: number): number {
  if (ratio > MAX_SCALE_RATIO || ratio < MIN_SCALE_RATIO) {
    // For extreme ratios, return 1.0 to avoid corrupted state
    return 1.0;
  }
  return ratio;
}

/**
 * Check if a scale ratio is within safe bounds
 */
function isScaleRatioSafe(ratio: number): boolean {
  return ratio >= MIN_SCALE_RATIO && ratio <= MAX_SCALE_RATIO;
}

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
 * Uses clamped scale ratios to prevent extreme scaling
 */
function scaleWindowSize(
  currentSize: { width: number; height: number },
  oldViewport: { width: number; height: number },
  newViewport: { width: number; height: number },
  minSize: { width: number; height: number },
  maxSize?: { width: number; height: number },
): { width: number; height: number } {
  const rawWidthScale = newViewport.width / oldViewport.width;
  const rawHeightScale = newViewport.height / oldViewport.height;

  // Clamp scale ratios to prevent extreme scaling
  const widthScale = clampScaleRatio(rawWidthScale);
  const heightScale = clampScaleRatio(rawHeightScale);

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

  // Calculate scale ratios with clamping
  const rawWidthScale = newViewport.width / oldViewport.width;
  const rawHeightScale = newViewport.height / oldViewport.height;
  const widthScale = clampScaleRatio(rawWidthScale);
  const heightScale = clampScaleRatio(rawHeightScale);

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

  // Calculate scale ratios with clamping
  const rawWidthScale = newViewport.width / oldViewport.width;
  const rawHeightScale = newViewport.height / oldViewport.height;
  const widthScale = clampScaleRatio(rawWidthScale);
  const heightScale = clampScaleRatio(rawHeightScale);

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

    // Calculate gap proportionally (original gap = space between minimap bottom and skills top)
    const originalMinimapBottom =
      minimapWindow.position.y + minimapWindow.size.height;
    const skillsWindow = bottomStackWindows.find(
      (w) => w.id === "skills-prayer-window",
    );
    const originalGap = skillsWindow
      ? skillsWindow.position.y - originalMinimapBottom
      : 20; // Default gap if skills not found

    // Scale gap proportionally
    const newGap = Math.max(10, Math.round(originalGap * heightScale));

    // Skills Y in new viewport (top of bottom stack)
    const actualSkillsY =
      updates.get("skills-prayer-window")?.position.y ?? bottomStackY;

    // Minimap fills from top (y=0) down to gap above skills
    let newMinimapHeight = actualSkillsY - newGap;
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
 * Validate that a layout is sane after scaling
 * Returns true if layout is valid, false if it needs reset
 */
function validateLayout(
  windows: WindowState[],
  viewport: { width: number; height: number },
): boolean {
  for (const win of windows) {
    // Check if window is completely off-screen
    if (
      win.position.x + win.size.width < 0 ||
      win.position.x > viewport.width
    ) {
      return false;
    }
    if (
      win.position.y + win.size.height < 0 ||
      win.position.y > viewport.height
    ) {
      return false;
    }

    // Check if window size is too small (less than 50% of minSize)
    const panelId = getPanelIdFromWindow(win);
    const config = getPanelConfig(panelId);
    if (win.size.width < config.minSize.width * 0.5) {
      return false;
    }
    if (win.size.height < config.minSize.height * 0.5) {
      return false;
    }

    // Check for NaN or invalid values
    if (
      !Number.isFinite(win.position.x) ||
      !Number.isFinite(win.position.y) ||
      !Number.isFinite(win.size.width) ||
      !Number.isFinite(win.size.height)
    ) {
      return false;
    }
  }
  return true;
}

/** Saved desktop layout state for restoring after mobile mode */
type SavedLayoutState = Array<{
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}>;

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

  // Reference viewport for stable scaling calculations
  // This is the baseline desktop viewport - updated only when in stable desktop state
  const referenceViewportRef = useRef<{ width: number; height: number }>({
    width:
      typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT
        ? window.innerWidth
        : DESIGN_RESOLUTION.width,
    height:
      typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT
        ? window.innerHeight
        : DESIGN_RESOLUTION.height,
  });

  // Track previous mobile state to detect mobile <-> desktop transitions
  const wasMobileRef = useRef<boolean>(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false,
  );

  // Saved desktop layout for restoring after mobile mode
  const savedDesktopLayoutRef = useRef<SavedLayoutState | null>(null);

  // Viewport resize handling with anchor-based repositioning
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true; // Track mount state to prevent post-unmount execution

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
        // Early exit if component has unmounted
        if (!isMounted) return;

        // Detect mobile <-> desktop UI mode transition
        const transitionedFromMobile = wasMobile && !nowMobile;
        const transitionedToMobile = !wasMobile && nowMobile;

        // Update mobile state tracking
        wasMobileRef.current = nowMobile;

        // On mobile <-> desktop transition, handle layout save/restore
        if (transitionedFromMobile || transitionedToMobile) {
          const windowStoreUpdate = useWindowStore.getState().updateWindow;
          const allWindows = useWindowStore.getState().getAllWindows();

          if (transitionedToMobile) {
            // Save current desktop layout before going to mobile
            savedDesktopLayoutRef.current = allWindows.map((win) => ({
              id: win.id,
              position: { ...win.position },
              size: { ...win.size },
            }));
            // Also save reference viewport
            referenceViewportRef.current = {
              width: prevWidth,
              height: prevHeight,
            };
          }

          if (transitionedFromMobile) {
            // Restore saved desktop layout OR reset to default
            if (
              savedDesktopLayoutRef.current &&
              savedDesktopLayoutRef.current.length > 0
            ) {
              // Restore saved layout, scaled to current viewport if different
              const savedViewport = referenceViewportRef.current;
              const currentViewport = { width: newWidth, height: newHeight };

              // Check if we need to scale the saved layout
              const widthRatio = currentViewport.width / savedViewport.width;
              const heightRatio = currentViewport.height / savedViewport.height;
              const needsScaling =
                isScaleRatioSafe(widthRatio) &&
                isScaleRatioSafe(heightRatio) &&
                (Math.abs(widthRatio - 1) > 0.01 ||
                  Math.abs(heightRatio - 1) > 0.01);

              savedDesktopLayoutRef.current.forEach((saved) => {
                const win = allWindows.find((w) => w.id === saved.id);
                if (!win) return;

                let newPosition = saved.position;
                let newSize = saved.size;

                if (needsScaling) {
                  // Scale position and size proportionally
                  newPosition = {
                    x: Math.round(saved.position.x * widthRatio),
                    y: Math.round(saved.position.y * heightRatio),
                  };
                  const panelId = getPanelIdFromWindow(win);
                  const config = getPanelConfig(panelId);
                  newSize = scaleWindowSize(
                    saved.size,
                    savedViewport,
                    currentViewport,
                    config.minSize,
                    config.maxSize,
                  );
                }

                windowStoreUpdate(win.id, {
                  position: newPosition,
                  size: newSize,
                  anchor: win.anchor ?? getDefaultAnchor(win.id),
                });
              });

              // Update reference viewport to current
              referenceViewportRef.current = currentViewport;
            } else {
              // No saved layout - reset to default
              const defaultWindows = createDefaultWindows();
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

              // Update reference viewport
              referenceViewportRef.current = {
                width: newWidth,
                height: newHeight,
              };
            }

            // Clear saved layout after restore
            savedDesktopLayoutRef.current = null;
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

        // Validate the layout after scaling
        const updatedWindows = useWindowStore.getState().getAllWindows();
        if (!validateLayout(updatedWindows, newViewport)) {
          // Layout is invalid - reset to default
          console.warn(
            "[useViewportResize] Layout validation failed after scaling, resetting to default",
          );
          const defaultWindows = createDefaultWindows();
          const defaultConfigs = new Map(defaultWindows.map((w) => [w.id, w]));

          updatedWindows.forEach((win) => {
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

        // Update tracked viewport size
        prevViewportRef.current = { width: newWidth, height: newHeight };

        // Update reference viewport only when in stable desktop state
        if (!nowMobile) {
          referenceViewportRef.current = { width: newWidth, height: newHeight };
        }

        useWindowStore.getState().setSavedViewportSize(newViewport);
      }, 100);
    };

    // Initial check
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => {
      isMounted = false; // Mark as unmounted first to prevent callback execution
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
