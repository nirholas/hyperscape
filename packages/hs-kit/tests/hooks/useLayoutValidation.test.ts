import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLayoutValidation } from "../../src/core/presets/useLayoutValidation";
import { useWindowStore } from "../../src/stores/windowStore";
import type { WindowState } from "../../src/types";

describe("useLayoutValidation", () => {
  const createMockWindow = (
    overrides: Partial<WindowState> = {},
  ): WindowState => ({
    id: "test-window",
    position: { x: 100, y: 100 },
    size: { width: 300, height: 200 },
    minSize: { width: 100, height: 50 },
    tabs: [
      { id: "tab-1", windowId: "test-window", label: "Test", closeable: true },
    ],
    activeTabIndex: 0,
    transparency: 0,
    visible: true,
    zIndex: 1000,
    locked: false,
    ...overrides,
  });

  beforeEach(() => {
    useWindowStore.setState({ windows: new Map(), nextZIndex: 1000 });

    // Mock window dimensions
    vi.stubGlobal("window", {
      innerWidth: 1920,
      innerHeight: 1080,
    });
  });

  describe("validateWindow", () => {
    it("should pass for valid window", () => {
      const { result } = renderHook(() => useLayoutValidation());

      const window = createMockWindow();
      const validation = result.current.validateWindow(window);

      expect(validation.canSave).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should fail for off-screen window (right)", () => {
      const { result } = renderHook(() => useLayoutValidation());

      const window = createMockWindow({
        position: { x: 2000, y: 100 },
      });
      const validation = result.current.validateWindow(window);

      expect(validation.canSave).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it("should fail for off-screen window (bottom)", () => {
      const { result } = renderHook(() => useLayoutValidation());

      const window = createMockWindow({
        position: { x: 100, y: 1200 },
      });
      const validation = result.current.validateWindow(window);

      expect(validation.canSave).toBe(false);
    });

    it("should warn for window below minimum size", () => {
      const { result } = renderHook(() => useLayoutValidation());

      const window = createMockWindow({
        size: { width: 50, height: 30 },
        minSize: { width: 100, height: 50 },
      });
      const validation = result.current.validateWindow(window);

      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("validate (all windows)", () => {
    it("should validate all windows in store", () => {
      const { createWindow } = useWindowStore.getState();
      createWindow({ id: "window-1", position: { x: 100, y: 100 } });
      createWindow({ id: "window-2", position: { x: 400, y: 100 } });

      const { result } = renderHook(() => useLayoutValidation());
      const validation = result.current.validate();

      expect(validation.canSave).toBe(true);
    });

    it("should fail if required panel is missing", () => {
      const { createWindow } = useWindowStore.getState();
      createWindow({ id: "window-1" });

      const { result } = renderHook(() =>
        useLayoutValidation({ requiredPanels: ["inventory", "chat"] }),
      );
      const validation = result.current.validate();

      expect(validation.canSave).toBe(false);
      expect(validation.errors.some((e) => e.includes("inventory"))).toBe(true);
    });

    it("should warn for high occlusion", () => {
      const { createWindow } = useWindowStore.getState();
      // Create windows that cover most of screen
      createWindow({
        id: "big-window",
        size: { width: 1800, height: 1000 },
        position: { x: 0, y: 0 },
      });

      const { result } = renderHook(() =>
        useLayoutValidation({ maxOcclusionPercent: 80 }),
      );
      const validation = result.current.validate();

      expect(validation.warnings.some((w) => w.includes("%"))).toBe(true);
    });
  });
});
