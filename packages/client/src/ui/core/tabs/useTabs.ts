import { useCallback, useMemo } from "react";
import { useWindowStore } from "../../stores/windowStore";
import type { TabsResult, TabConfig, TabState } from "../../types";

/**
 * Hook to manage tabs within a window
 *
 * @example
 * ```tsx
 * function WindowTabBar({ windowId }: { windowId: string }) {
 *   const { tabs, activeTab, setActiveTab, addTab, removeTab } = useTabs(windowId);
 *
 *   return (
 *     <div style={{ display: 'flex' }}>
 *       {tabs.map((tab, index) => (
 *         <div
 *           key={tab.id}
 *           onClick={() => setActiveTab(index)}
 *           style={{ fontWeight: activeTab?.id === tab.id ? 'bold' : 'normal' }}
 *         >
 *           {tab.label}
 *           {tab.closeable && (
 *             <button onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}>×</button>
 *           )}
 *         </div>
 *       ))}
 *       <button onClick={() => addTab({ label: 'New Tab', content: 'Content' })}>+</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTabs(windowId: string): TabsResult {
  const window = useWindowStore(
    useCallback((state) => state.windows.get(windowId), [windowId]),
  );

  const addTabStore = useWindowStore((s) => s.addTab);
  const removeTabStore = useWindowStore((s) => s.removeTab);
  const setActiveTabStore = useWindowStore((s) => s.setActiveTab);
  const reorderTabsStore = useWindowStore((s) => s.reorderTabs);

  const tabs = useMemo(() => window?.tabs || [], [window?.tabs]);

  const activeTabIndex = window?.activeTabIndex ?? 0;

  const activeTab = useMemo(() => {
    if (!tabs.length) return undefined;
    return tabs[Math.min(activeTabIndex, tabs.length - 1)];
  }, [tabs, activeTabIndex]);

  const setActiveTab = useCallback(
    (index: number) => {
      setActiveTabStore(windowId, index);
    },
    [windowId, setActiveTabStore],
  );

  const addTab = useCallback(
    (config: TabConfig): TabState => {
      const tab = addTabStore(windowId, config);
      if (!tab) {
        // Return a placeholder tab if window doesn't exist
        return {
          id: "",
          windowId,
          label: config.label,
          icon: config.icon,
          closeable: config.closeable ?? true,
          content: config.content,
        };
      }
      return tab;
    },
    [windowId, addTabStore],
  );

  const removeTab = useCallback(
    (tabId: string) => {
      removeTabStore(windowId, tabId);
    },
    [windowId, removeTabStore],
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderTabsStore(windowId, fromIndex, toIndex);
    },
    [windowId, reorderTabsStore],
  );

  return {
    tabs,
    activeTab,
    activeTabIndex,
    setActiveTab,
    addTab,
    removeTab,
    reorderTabs,
  };
}
