import { useCallback } from "react";
import { useWindowStore } from "../../stores/windowStore";
import { useDragStore } from "../../stores/dragStore";
import type { Point, WindowState, TabOperations } from "../../types";

/**
 * Hook for tab drag operations between windows
 *
 * @example
 * ```tsx
 * function TabBar({ windowId }: { windowId: string }) {
 *   const { tabs } = useTabs(windowId);
 *   const { moveTab, splitTab } = useTabDrag();
 *
 *   const handleTabDrop = (tabId: string, targetWindowId: string) => {
 *     if (targetWindowId === windowId) return;
 *     moveTab(tabId, targetWindowId);
 *   };
 *
 *   const handleTabDropOutside = (tabId: string, position: Point) => {
 *     splitTab(tabId, position);
 *   };
 * }
 * ```
 */
export function useTabDrag(): TabOperations & {
  /** Whether a tab is currently being dragged */
  isTabDragging: boolean;
  /** The ID of the tab being dragged (if any) */
  draggingTabId: string | null;
  /** The source window ID of the dragging tab */
  draggingSourceWindowId: string | null;
  /** Current drop target window ID (if hovering over one) */
  targetWindowId: string | null;
  /** Highlight a window as potential drop target */
  setTargetWindow: (windowId: string | null) => void;
} {
  const moveTabStore = useWindowStore((s) => s.moveTab);
  const createWindow = useWindowStore((s) => s.createWindow);
  const getWindow = useWindowStore((s) => s.getWindow);
  const updateWindow = useWindowStore((s) => s.updateWindow);

  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);

  const isTabDragging = isDragging && dragItem?.type === "tab";
  const draggingTabId = isTabDragging ? dragItem?.id || null : null;
  const draggingSourceWindowId = isTabDragging
    ? dragItem?.sourceId || null
    : null;

  // Find if we're over a window drop target (tabbar-*)
  const targetWindowId = isTabDragging
    ? overTargets
        .find((t) => t.startsWith("tabbar-"))
        ?.replace("tabbar-", "") || null
    : null;

  // Set a window as the current drop target (for visual highlighting)
  const setTargetWindow = useCallback(
    (windowId: string | null) => {
      if (windowId) {
        const window = getWindow(windowId);
        if (window) {
          // Could add a 'dropTarget' flag to window state for highlighting
          updateWindow(windowId, { locked: false });
        }
      }
    },
    [getWindow, updateWindow],
  );

  const moveTab = useCallback(
    (tabId: string, targetWindowId: string, index?: number) => {
      // Find the source window
      const windows = useWindowStore.getState().getAllWindows();
      let sourceWindowId: string | null = null;

      for (const window of windows) {
        if (window.tabs.some((t) => t.id === tabId)) {
          sourceWindowId = window.id;
          break;
        }
      }

      if (!sourceWindowId) {
        console.warn(`Tab ${tabId} not found in any window`);
        return;
      }

      if (sourceWindowId === targetWindowId) {
        // Reordering within same window
        const window = getWindow(sourceWindowId);
        if (!window) return;

        const fromIndex = window.tabs.findIndex((t) => t.id === tabId);
        const toIndex = index ?? window.tabs.length - 1;

        if (fromIndex !== toIndex) {
          useWindowStore
            .getState()
            .reorderTabs(sourceWindowId, fromIndex, toIndex);
        }
      } else {
        // Moving to different window
        moveTabStore(tabId, sourceWindowId, targetWindowId, index);
      }
    },
    [getWindow, moveTabStore],
  );

  const splitTab = useCallback(
    (tabId: string, position: Point): WindowState => {
      // Find the source window
      const windows = useWindowStore.getState().getAllWindows();
      let sourceWindow: WindowState | null = null;
      let tabToSplit = null;

      for (const window of windows) {
        const tab = window.tabs.find((t) => t.id === tabId);
        if (tab) {
          sourceWindow = window;
          tabToSplit = tab;
          break;
        }
      }

      if (!sourceWindow || !tabToSplit) {
        console.warn(`Tab ${tabId} not found in any window`);
        // Return empty window as fallback
        return createWindow({ position });
      }

      // Create new window with this tab
      const newWindow = createWindow({
        position,
        size: { ...sourceWindow.size },
        minSize: { ...sourceWindow.minSize },
        tabs: [
          {
            id: tabToSplit.id,
            label: tabToSplit.label,
            icon: tabToSplit.icon,
            closeable: tabToSplit.closeable,
            content: tabToSplit.content,
          },
        ],
      });

      // Remove tab from source window
      useWindowStore.getState().removeTab(sourceWindow.id, tabId);

      return newWindow;
    },
    [createWindow],
  );

  const mergeWindow = useCallback(
    (sourceWindowId: string, targetWindowId: string) => {
      const sourceWindow = getWindow(sourceWindowId);
      const targetWindow = getWindow(targetWindowId);

      if (!sourceWindow || !targetWindow) {
        console.warn("Source or target window not found");
        return;
      }

      // Move all tabs from source to target
      sourceWindow.tabs.forEach((tab) => {
        moveTabStore(tab.id, sourceWindowId, targetWindowId);
      });

      // Source window will be automatically removed when last tab is moved
    },
    [getWindow, moveTabStore],
  );

  return {
    moveTab,
    splitTab,
    mergeWindow,
    isTabDragging,
    draggingTabId,
    draggingSourceWindowId,
    targetWindowId,
    setTargetWindow,
  };
}
