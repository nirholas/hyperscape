import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore } from "../../src/stores/windowStore";

describe("windowStore", () => {
  beforeEach(() => {
    useWindowStore.setState({
      windows: new Map(),
      nextZIndex: 1000,
    });
  });

  describe("createWindow", () => {
    it("should create a new window with defaults", () => {
      const { createWindow } = useWindowStore.getState();
      const window = createWindow({});

      expect(window).toBeDefined();
      expect(window!.id).toBeDefined();
      expect(window!.visible).toBe(true);
      expect(window!.zIndex).toBeGreaterThan(0);
    });

    it("should use provided config values", () => {
      const { createWindow } = useWindowStore.getState();
      const window = createWindow({
        id: "my-window",
        position: { x: 100, y: 200 },
        size: { width: 400, height: 300 },
      });

      expect(window!.id).toBe("my-window");
      expect(window!.position).toEqual({ x: 100, y: 200 });
      expect(window!.size).toEqual({ width: 400, height: 300 });
    });

    it("should add window to store", () => {
      const { createWindow, windows } = useWindowStore.getState();
      createWindow({ id: "test-window" });

      const state = useWindowStore.getState();
      expect(state.windows.has("test-window")).toBe(true);
    });
  });

  describe("destroyWindow", () => {
    it("should remove window from store", () => {
      const { createWindow, destroyWindow } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      destroyWindow("test-window");

      const state = useWindowStore.getState();
      expect(state.windows.has("test-window")).toBe(false);
    });
  });

  describe("updateWindow", () => {
    it("should update window position", () => {
      const { createWindow, updateWindow } = useWindowStore.getState();
      createWindow({ id: "test-window", position: { x: 0, y: 0 } });
      updateWindow("test-window", { position: { x: 100, y: 200 } });

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.position).toEqual({ x: 100, y: 200 });
    });

    it("should update window size", () => {
      const { createWindow, updateWindow } = useWindowStore.getState();
      createWindow({ id: "test-window", size: { width: 200, height: 100 } });
      updateWindow("test-window", { size: { width: 400, height: 300 } });

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.size).toEqual({ width: 400, height: 300 });
    });

    it("should update visibility", () => {
      const { createWindow, updateWindow } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      updateWindow("test-window", { visible: false });

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.visible).toBe(false);
    });
  });

  describe("bringToFront", () => {
    it("should increase z-index to be on top", () => {
      const { createWindow, bringToFront } = useWindowStore.getState();
      createWindow({ id: "window-1" });
      createWindow({ id: "window-2" });

      const z1Before = useWindowStore
        .getState()
        .windows.get("window-1")!.zIndex;
      bringToFront("window-1");
      const z1After = useWindowStore.getState().windows.get("window-1")!.zIndex;

      expect(z1After).toBeGreaterThan(z1Before);
    });
  });

  describe("tabs", () => {
    it("should add tab to window", () => {
      const { createWindow, addTab } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      addTab("test-window", { label: "New Tab", content: "Content" });

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.tabs.length).toBe(1);
      expect(window!.tabs[0].label).toBe("New Tab");
    });

    it("should remove tab from window", () => {
      const { createWindow, addTab, removeTab } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      const tab = addTab("test-window", { label: "Tab 1" });
      addTab("test-window", { label: "Tab 2" });
      removeTab("test-window", tab!.id);

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.tabs.length).toBe(1);
      expect(window!.tabs[0].label).toBe("Tab 2");
    });

    it("should set active tab", () => {
      const { createWindow, addTab, setActiveTab } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      addTab("test-window", { label: "Tab 1" });
      addTab("test-window", { label: "Tab 2" });
      setActiveTab("test-window", 1);

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.activeTabIndex).toBe(1);
    });

    it("should reorder tabs", () => {
      const { createWindow, addTab, reorderTabs } = useWindowStore.getState();
      createWindow({ id: "test-window" });
      addTab("test-window", { label: "Tab 1" });
      addTab("test-window", { label: "Tab 2" });
      addTab("test-window", { label: "Tab 3" });
      reorderTabs("test-window", 0, 2);

      const window = useWindowStore.getState().windows.get("test-window");
      expect(window!.tabs[0].label).toBe("Tab 2");
      expect(window!.tabs[1].label).toBe("Tab 3");
      expect(window!.tabs[2].label).toBe("Tab 1");
    });
  });

  describe("getAllWindows", () => {
    it("should return array of all windows", () => {
      const { createWindow, getAllWindows } = useWindowStore.getState();
      createWindow({ id: "window-1" });
      createWindow({ id: "window-2" });
      createWindow({ id: "window-3" });

      const windows = useWindowStore.getState().getAllWindows();
      expect(windows.length).toBe(3);
    });
  });
});
