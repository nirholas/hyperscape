import { useCallback, useState } from "react";
import { useWindowStore } from "../../stores/windowStore";
import type { Point, TabState } from "../../types";

export interface TabContextMenuAction {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface TabContextMenuState {
  isOpen: boolean;
  position: Point;
  tab: TabState | null;
  actions: TabContextMenuAction[];
}

export interface TabContextMenuResult {
  menuState: TabContextMenuState;
  openMenu: (tab: TabState, windowId: string, position: Point) => void;
  closeMenu: () => void;
}

export function useTabContextMenu(): TabContextMenuResult {
  const [menuState, setMenuState] = useState<TabContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    tab: null,
    actions: [],
  });

  const removeTab = useWindowStore((s) => s.removeTab);
  const windows = useWindowStore((s) => s.windows);
  const createWindow = useWindowStore((s) => s.createWindow);
  const moveTab = useWindowStore((s) => s.moveTab);

  const openMenu = useCallback(
    (tab: TabState, windowId: string, position: Point) => {
      const window = windows.get(windowId);
      if (!window) return;

      const tabIndex = window.tabs.findIndex((t) => t.id === tab.id);
      const tabCount = window.tabs.length;

      const actions: TabContextMenuAction[] = [];

      if (tab.closeable) {
        actions.push({
          label: "Close Tab",
          action: () => {
            removeTab(windowId, tab.id);
            setMenuState((s) => ({ ...s, isOpen: false }));
          },
        });
      }

      if (tabCount > 1) {
        actions.push({
          label: "Close Other Tabs",
          action: () => {
            window.tabs.forEach((t) => {
              if (t.id !== tab.id && t.closeable) {
                removeTab(windowId, t.id);
              }
            });
            setMenuState((s) => ({ ...s, isOpen: false }));
          },
        });

        if (tabIndex < tabCount - 1) {
          actions.push({
            label: "Close Tabs to Right",
            action: () => {
              window.tabs.slice(tabIndex + 1).forEach((t) => {
                if (t.closeable) removeTab(windowId, t.id);
              });
              setMenuState((s) => ({ ...s, isOpen: false }));
            },
          });
        }

        actions.push({
          label: "Split to New Window",
          action: () => {
            const newWindow = createWindow({
              position: { x: position.x + 20, y: position.y + 20 },
              size: { width: 300, height: 200 },
              tabs: [],
            });
            if (newWindow) {
              moveTab(tab.id, windowId, newWindow.id);
            }
            setMenuState((s) => ({ ...s, isOpen: false }));
          },
        });
      }

      setMenuState({ isOpen: true, position, tab, actions });
    },
    [windows, removeTab, createWindow, moveTab],
  );

  const closeMenu = useCallback(() => {
    setMenuState((s) => ({ ...s, isOpen: false, tab: null, actions: [] }));
  }, []);

  return { menuState, openMenu, closeMenu };
}
