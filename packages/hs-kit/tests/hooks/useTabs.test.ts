import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabs } from "../../src/core/tabs/useTabs";
import { useWindowStore } from "../../src/stores/windowStore";

describe("useTabs", () => {
  beforeEach(() => {
    useWindowStore.setState({ windows: new Map(), nextZIndex: 1000 });
    const { createWindow, addTab, setActiveTab } = useWindowStore.getState();
    createWindow({ id: "test-window" });
    addTab("test-window", { label: "Tab 1", content: "Content 1" });
    addTab("test-window", { label: "Tab 2", content: "Content 2" });
    // Set active tab to first one
    setActiveTab("test-window", 0);
  });

  describe("tabs", () => {
    it("should return tabs for window", () => {
      const { result } = renderHook(() => useTabs("test-window"));
      expect(result.current.tabs.length).toBe(2);
    });

    it("should return empty array for non-existent window", () => {
      const { result } = renderHook(() => useTabs("non-existent"));
      expect(result.current.tabs).toEqual([]);
    });
  });

  describe("activeTab", () => {
    it("should return first tab when set to index 0", () => {
      const { result } = renderHook(() => useTabs("test-window"));
      expect(result.current.activeTabIndex).toBe(0);
      expect(result.current.activeTab?.label).toBe("Tab 1");
    });

    it("should change when setActiveTab called", () => {
      const { result } = renderHook(() => useTabs("test-window"));

      act(() => {
        result.current.setActiveTab(1);
      });

      expect(result.current.activeTabIndex).toBe(1);
      expect(result.current.activeTab?.label).toBe("Tab 2");
    });
  });

  describe("addTab", () => {
    it("should add new tab", () => {
      const { result } = renderHook(() => useTabs("test-window"));

      act(() => {
        result.current.addTab({ label: "Tab 3", content: "Content 3" });
      });

      expect(result.current.tabs.length).toBe(3);
    });
  });

  describe("removeTab", () => {
    it("should remove tab by id", () => {
      const { result } = renderHook(() => useTabs("test-window"));
      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.removeTab(tabId);
      });

      expect(result.current.tabs.length).toBe(1);
    });
  });

  describe("reorderTabs", () => {
    it("should reorder tabs", () => {
      const { result } = renderHook(() => useTabs("test-window"));

      act(() => {
        result.current.reorderTabs(0, 1);
      });

      expect(result.current.tabs[0].label).toBe("Tab 2");
      expect(result.current.tabs[1].label).toBe("Tab 1");
    });
  });
});
