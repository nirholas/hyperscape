import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useWindowStore,
  type WindowStoreState,
} from "../src/stores/windowStore";
import type { WindowState, TabState } from "../src/types";

// Helper to create a mock window state
function createMockWindow(
  id: string,
  overrides: Partial<WindowState> = {},
): WindowState {
  return {
    id,
    position: { x: 100, y: 100 },
    size: { width: 400, height: 300 },
    minSize: { width: 200, height: 150 },
    tabs: [],
    activeTabIndex: 0,
    transparency: 0,
    visible: true,
    zIndex: 1000,
    locked: false,
    ...overrides,
  };
}

// Helper to create a mock tab state
function createMockTab(
  id: string,
  windowId: string,
  overrides: Partial<TabState> = {},
): TabState {
  return {
    id,
    windowId,
    label: `Tab ${id}`,
    closeable: true,
    content: `panel-${id}`,
    ...overrides,
  };
}

describe("WindowStore", () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    // Reset store to initial state
    useWindowStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createWindow", () => {
    it("should create a window with default config", () => {
      const window = useWindowStore.getState().createWindow();

      expect(window).toBeDefined();
      expect(window.id).toMatch(/^window_/);
      expect(window.position).toEqual({ x: 100, y: 100 });
      expect(window.size).toEqual({ width: 400, height: 300 });
      expect(window.visible).toBe(true);
    });

    it("should create a window with custom config", () => {
      const window = useWindowStore.getState().createWindow({
        id: "custom-window",
        position: { x: 200, y: 200 },
        size: { width: 500, height: 400 },
      });

      expect(window.id).toBe("custom-window");
      expect(window.position).toEqual({ x: 200, y: 200 });
      expect(window.size).toEqual({ width: 500, height: 400 });
    });

    it("should create a window with tabs", () => {
      const window = useWindowStore.getState().createWindow({
        tabs: [
          { label: "Tab 1", content: "panel-1" },
          { label: "Tab 2", content: "panel-2" },
        ],
      });

      expect(window.tabs).toHaveLength(2);
      expect(window.tabs[0].label).toBe("Tab 1");
      expect(window.tabs[1].label).toBe("Tab 2");
    });

    it("should generate unique IDs using crypto.randomUUID pattern", () => {
      const window1 = useWindowStore.getState().createWindow();
      const window2 = useWindowStore.getState().createWindow();

      expect(window1.id).not.toBe(window2.id);
      expect(window1.id).toMatch(/^window_/);
      expect(window2.id).toMatch(/^window_/);
    });

    it("should increment zIndex for each new window", () => {
      const window1 = useWindowStore.getState().createWindow();
      const window2 = useWindowStore.getState().createWindow();

      expect(window2.zIndex).toBeGreaterThan(window1.zIndex);
    });
  });

  describe("updateWindow", () => {
    it("should update window position", () => {
      const window = useWindowStore.getState().createWindow({ id: "test" });

      useWindowStore.getState().updateWindow("test", {
        position: { x: 300, y: 300 },
      });

      const updated = useWindowStore.getState().getWindow("test");
      expect(updated?.position).toEqual({ x: 300, y: 300 });
    });

    it("should update window size", () => {
      useWindowStore.getState().createWindow({ id: "test" });

      useWindowStore.getState().updateWindow("test", {
        size: { width: 600, height: 500 },
      });

      const updated = useWindowStore.getState().getWindow("test");
      expect(updated?.size).toEqual({ width: 600, height: 500 });
    });

    it("should not update non-existent window", () => {
      useWindowStore.getState().updateWindow("non-existent", {
        position: { x: 999, y: 999 },
      });

      const window = useWindowStore.getState().getWindow("non-existent");
      expect(window).toBeUndefined();
    });
  });

  describe("destroyWindow", () => {
    it("should remove a window", () => {
      useWindowStore.getState().createWindow({ id: "to-destroy" });

      expect(useWindowStore.getState().getWindow("to-destroy")).toBeDefined();

      useWindowStore.getState().destroyWindow("to-destroy");

      expect(useWindowStore.getState().getWindow("to-destroy")).toBeUndefined();
    });

    it("should handle destroying non-existent window", () => {
      expect(() => {
        useWindowStore.getState().destroyWindow("non-existent");
      }).not.toThrow();
    });
  });

  describe("bringToFront", () => {
    it("should update zIndex to highest", () => {
      useWindowStore.getState().createWindow({ id: "window-1" });
      useWindowStore.getState().createWindow({ id: "window-2" });

      const w1Before = useWindowStore.getState().getWindow("window-1");
      const w2Before = useWindowStore.getState().getWindow("window-2");

      expect(w2Before!.zIndex).toBeGreaterThan(w1Before!.zIndex);

      useWindowStore.getState().bringToFront("window-1");

      const w1After = useWindowStore.getState().getWindow("window-1");
      const w2After = useWindowStore.getState().getWindow("window-2");

      expect(w1After!.zIndex).toBeGreaterThan(w2After!.zIndex);
    });

    it("should not change zIndex if already on top", () => {
      useWindowStore.getState().createWindow({ id: "window-1" });

      const before = useWindowStore.getState().getWindow("window-1");
      const zIndexBefore = before!.zIndex;

      useWindowStore.getState().bringToFront("window-1");

      const after = useWindowStore.getState().getWindow("window-1");
      expect(after!.zIndex).toBe(zIndexBefore);
    });
  });

  describe("getAllWindows", () => {
    it("should return all windows as array", () => {
      useWindowStore.getState().createWindow({ id: "w1" });
      useWindowStore.getState().createWindow({ id: "w2" });
      useWindowStore.getState().createWindow({ id: "w3" });

      const windows = useWindowStore.getState().getAllWindows();

      expect(windows).toHaveLength(3);
      expect(windows.map((w) => w.id)).toContain("w1");
      expect(windows.map((w) => w.id)).toContain("w2");
      expect(windows.map((w) => w.id)).toContain("w3");
    });

    it("should return empty array when no windows", () => {
      const windows = useWindowStore.getState().getAllWindows();
      expect(windows).toEqual([]);
    });
  });

  describe("setWindows", () => {
    it("should replace all windows", () => {
      useWindowStore.getState().createWindow({ id: "old-1" });
      useWindowStore.getState().createWindow({ id: "old-2" });

      const newWindows = [createMockWindow("new-1"), createMockWindow("new-2")];

      useWindowStore.getState().setWindows(newWindows);

      const windows = useWindowStore.getState().getAllWindows();

      expect(windows).toHaveLength(2);
      expect(windows.map((w) => w.id)).toContain("new-1");
      expect(windows.map((w) => w.id)).toContain("new-2");
      expect(windows.map((w) => w.id)).not.toContain("old-1");
    });

    it("should update nextZIndex based on loaded windows", () => {
      const newWindows = [
        createMockWindow("w1", { zIndex: 5000 }),
        createMockWindow("w2", { zIndex: 6000 }),
      ];

      useWindowStore.getState().setWindows(newWindows);

      const nextWindow = useWindowStore.getState().createWindow();
      expect(nextWindow.zIndex).toBeGreaterThan(6000);
    });
  });

  describe("loadLayout", () => {
    it("should scale window positions based on resolution", () => {
      const sourceResolution = { width: 1920, height: 1080 };

      // Mock window dimensions
      vi.stubGlobal("window", {
        innerWidth: 3840,
        innerHeight: 2160,
      });

      const windows = [
        createMockWindow("w1", { position: { x: 100, y: 100 } }),
      ];

      useWindowStore.getState().loadLayout(windows, sourceResolution);

      const loaded = useWindowStore.getState().getWindow("w1");

      // 3840/1920 = 2, so x should be 200
      // 2160/1080 = 2, so y should be 200
      expect(loaded?.position.x).toBe(200);
      expect(loaded?.position.y).toBe(200);

      vi.unstubAllGlobals();
    });
  });

  describe("reset", () => {
    it("should clear all windows", () => {
      useWindowStore.getState().createWindow({ id: "w1" });
      useWindowStore.getState().createWindow({ id: "w2" });

      useWindowStore.getState().reset();

      const windows = useWindowStore.getState().getAllWindows();
      expect(windows).toHaveLength(0);
    });

    it("should reset nextZIndex", () => {
      useWindowStore.getState().createWindow();
      useWindowStore.getState().createWindow();

      useWindowStore.getState().reset();

      const newWindow = useWindowStore.getState().createWindow();
      expect(newWindow.zIndex).toBe(1000);
    });
  });

  describe("tab operations", () => {
    describe("addTab", () => {
      it("should add a tab to a window", () => {
        useWindowStore.getState().createWindow({ id: "window-1" });

        const tab = useWindowStore.getState().addTab("window-1", {
          label: "New Tab",
          content: "panel-new",
        });

        expect(tab).toBeDefined();
        expect(tab?.label).toBe("New Tab");

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.tabs).toHaveLength(1);
      });

      it("should set new tab as active", () => {
        useWindowStore.getState().createWindow({ id: "window-1" });

        useWindowStore.getState().addTab("window-1", {
          label: "Tab 1",
          content: "panel-1",
        });

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.activeTabIndex).toBe(0);
      });

      it("should return undefined for non-existent window", () => {
        const tab = useWindowStore.getState().addTab("non-existent", {
          label: "Tab",
          content: "panel",
        });

        expect(tab).toBeUndefined();
      });
    });

    describe("removeTab", () => {
      it("should remove a tab from a window", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
          ],
        });

        const window = useWindowStore.getState().getWindow("window-1");
        const tabId = window!.tabs[0].id;

        useWindowStore.getState().removeTab("window-1", tabId);

        const updated = useWindowStore.getState().getWindow("window-1");
        expect(updated?.tabs).toHaveLength(1);
        expect(updated?.tabs[0].label).toBe("Tab 2");
      });

      it("should destroy window when last tab is removed", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [{ label: "Tab 1", content: "panel-1" }],
        });

        const window = useWindowStore.getState().getWindow("window-1");
        const tabId = window!.tabs[0].id;

        useWindowStore.getState().removeTab("window-1", tabId);

        expect(useWindowStore.getState().getWindow("window-1")).toBeUndefined();
      });

      it("should adjust activeTabIndex when removing active tab", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
            { label: "Tab 3", content: "panel-3" },
          ],
        });

        const window = useWindowStore.getState().getWindow("window-1");
        useWindowStore.getState().setActiveTab("window-1", 1); // Select Tab 2

        const tabId = window!.tabs[1].id;
        useWindowStore.getState().removeTab("window-1", tabId);

        const updated = useWindowStore.getState().getWindow("window-1");
        expect(updated?.activeTabIndex).toBeLessThanOrEqual(1);
      });
    });

    describe("setActiveTab", () => {
      it("should set active tab index", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
          ],
        });

        useWindowStore.getState().setActiveTab("window-1", 1);

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.activeTabIndex).toBe(1);
      });

      it("should clamp index to valid range", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
          ],
        });

        useWindowStore.getState().setActiveTab("window-1", 99);

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.activeTabIndex).toBe(1); // Clamped to max
      });

      it("should handle negative index", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
          ],
        });

        useWindowStore.getState().setActiveTab("window-1", -5);

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.activeTabIndex).toBe(0); // Clamped to 0
      });
    });

    describe("reorderTabs", () => {
      it("should reorder tabs within a window", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab A", content: "panel-a" },
            { label: "Tab B", content: "panel-b" },
            { label: "Tab C", content: "panel-c" },
          ],
        });

        useWindowStore.getState().reorderTabs("window-1", 0, 2);

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.tabs[0].label).toBe("Tab B");
        expect(window?.tabs[1].label).toBe("Tab C");
        expect(window?.tabs[2].label).toBe("Tab A");
      });

      it("should adjust activeTabIndex when reordering", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab A", content: "panel-a" },
            { label: "Tab B", content: "panel-b" },
            { label: "Tab C", content: "panel-c" },
          ],
        });

        useWindowStore.getState().setActiveTab("window-1", 0); // Tab A is active
        useWindowStore.getState().reorderTabs("window-1", 0, 2); // Move Tab A to end

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.activeTabIndex).toBe(2); // Tab A is now at index 2
      });

      it("should handle out of bounds indices", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab A", content: "panel-a" },
            { label: "Tab B", content: "panel-b" },
          ],
        });

        // Should not throw
        useWindowStore.getState().reorderTabs("window-1", 99, 100);

        const window = useWindowStore.getState().getWindow("window-1");
        expect(window?.tabs).toHaveLength(2); // No change
      });
    });

    describe("moveTab", () => {
      it("should move tab between windows", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [
            { label: "Tab 1", content: "panel-1" },
            { label: "Tab 2", content: "panel-2" },
          ],
        });

        useWindowStore.getState().createWindow({
          id: "window-2",
          tabs: [{ label: "Tab A", content: "panel-a" }],
        });

        const window1 = useWindowStore.getState().getWindow("window-1");
        const tabId = window1!.tabs[0].id;

        useWindowStore.getState().moveTab(tabId, "window-1", "window-2");

        const updated1 = useWindowStore.getState().getWindow("window-1");
        const updated2 = useWindowStore.getState().getWindow("window-2");

        expect(updated1?.tabs).toHaveLength(1);
        expect(updated2?.tabs).toHaveLength(2);
        expect(updated2?.tabs[1].label).toBe("Tab 1");
      });

      it("should destroy source window if last tab is moved", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [{ label: "Tab 1", content: "panel-1" }],
        });

        useWindowStore.getState().createWindow({
          id: "window-2",
          tabs: [{ label: "Tab A", content: "panel-a" }],
        });

        const window1 = useWindowStore.getState().getWindow("window-1");
        const tabId = window1!.tabs[0].id;

        useWindowStore.getState().moveTab(tabId, "window-1", "window-2");

        expect(useWindowStore.getState().getWindow("window-1")).toBeUndefined();
      });

      it("should move tab to specific index", () => {
        useWindowStore.getState().createWindow({
          id: "window-1",
          tabs: [{ label: "Tab 1", content: "panel-1" }],
        });

        useWindowStore.getState().createWindow({
          id: "window-2",
          tabs: [
            { label: "Tab A", content: "panel-a" },
            { label: "Tab B", content: "panel-b" },
          ],
        });

        const window1 = useWindowStore.getState().getWindow("window-1");
        const tabId = window1!.tabs[0].id;

        useWindowStore.getState().moveTab(tabId, "window-1", "window-2", 1);

        const updated2 = useWindowStore.getState().getWindow("window-2");
        expect(updated2?.tabs[1].label).toBe("Tab 1");
      });
    });
  });
});
