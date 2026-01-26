import type { WindowState, TabState, Point } from "../../types";

/**
 * Calculate the insertion index for a tab based on drop position
 */
export function calculateTabInsertIndex(
  tabs: TabState[],
  dropX: number,
  tabBarRect: DOMRect,
  tabWidth: number = 120,
): number {
  // Calculate relative position within tab bar
  const relativeX = dropX - tabBarRect.left;

  // Calculate which tab slot this corresponds to
  const slotIndex = Math.floor(relativeX / tabWidth);

  // Clamp to valid range
  return Math.max(0, Math.min(slotIndex, tabs.length));
}

/**
 * Check if a point is over a tab bar
 */
export function isOverTabBar(
  point: Point,
  tabBarRect: DOMRect | null,
): boolean {
  if (!tabBarRect) return false;

  return (
    point.x >= tabBarRect.left &&
    point.x <= tabBarRect.right &&
    point.y >= tabBarRect.top &&
    point.y <= tabBarRect.bottom
  );
}

/**
 * Check if a point is over a window (not just tab bar)
 */
export function isOverWindow(
  point: Point,
  windowRect: DOMRect | null,
): boolean {
  if (!windowRect) return false;

  return (
    point.x >= windowRect.left &&
    point.x <= windowRect.right &&
    point.y >= windowRect.top &&
    point.y <= windowRect.bottom
  );
}

/**
 * Find the window at a given point
 */
export function findWindowAtPoint(
  point: Point,
  windows: WindowState[],
  getWindowElement: (id: string) => HTMLElement | null,
): WindowState | null {
  // Sort by z-index descending to check topmost first
  const sortedWindows = [...windows].sort((a, b) => b.zIndex - a.zIndex);

  for (const window of sortedWindows) {
    const element = getWindowElement(window.id);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    if (isOverWindow(point, rect)) {
      return window;
    }
  }

  return null;
}

/**
 * Determine the drop action for a tab drag
 */
export type TabDropAction =
  | { type: "reorder"; windowId: string; fromIndex: number; toIndex: number }
  | {
      type: "merge";
      sourceWindowId: string;
      targetWindowId: string;
      insertIndex: number;
    }
  | { type: "split"; sourceWindowId: string; position: Point }
  | { type: "cancel" };

export function determineTabDropAction(
  tabId: string,
  sourceWindowId: string,
  dropPoint: Point,
  windows: WindowState[],
  getWindowElement: (id: string) => HTMLElement | null,
  getTabBarElement: (windowId: string) => HTMLElement | null,
): TabDropAction {
  // Find what we're dropping on
  const targetWindow = findWindowAtPoint(dropPoint, windows, getWindowElement);

  if (!targetWindow) {
    // Dropping in empty space - split to new window
    return {
      type: "split",
      sourceWindowId,
      position: dropPoint,
    };
  }

  const tabBarElement = getTabBarElement(targetWindow.id);

  if (targetWindow.id === sourceWindowId) {
    // Reordering within same window
    if (!tabBarElement) return { type: "cancel" };

    const tabBarRect = tabBarElement.getBoundingClientRect();
    const sourceWindow = windows.find((w) => w.id === sourceWindowId);
    if (!sourceWindow) return { type: "cancel" };

    const fromIndex = sourceWindow.tabs.findIndex((t) => t.id === tabId);
    const toIndex = calculateTabInsertIndex(
      sourceWindow.tabs,
      dropPoint.x,
      tabBarRect,
    );

    if (fromIndex === toIndex || fromIndex === -1) {
      return { type: "cancel" };
    }

    return {
      type: "reorder",
      windowId: sourceWindowId,
      fromIndex,
      toIndex: toIndex > fromIndex ? toIndex - 1 : toIndex,
    };
  } else {
    // Merging into different window
    const tabBarRect = tabBarElement?.getBoundingClientRect();
    const insertIndex = tabBarRect
      ? calculateTabInsertIndex(targetWindow.tabs, dropPoint.x, tabBarRect)
      : targetWindow.tabs.length;

    return {
      type: "merge",
      sourceWindowId,
      targetWindowId: targetWindow.id,
      insertIndex,
    };
  }
}
