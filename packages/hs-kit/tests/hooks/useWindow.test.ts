import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindow } from "../../src/core/window/useWindow";
import { useWindowStore } from "../../src/stores/windowStore";

describe("useWindow", () => {
  beforeEach(() => {
    useWindowStore.setState({ windows: new Map(), nextZIndex: 1000 });
    const { createWindow } = useWindowStore.getState();
    createWindow({
      id: "test-window",
      position: { x: 100, y: 100 },
      size: { width: 300, height: 200 },
    });
  });

  describe("window state", () => {
    it("should return window state", () => {
      const { result } = renderHook(() => useWindow("test-window"));
      expect(result.current.window.id).toBe("test-window");
      expect(result.current.window.position).toEqual({ x: 100, y: 100 });
    });

    it("should return default state for non-existent window", () => {
      const { result } = renderHook(() => useWindow("non-existent"));
      expect(result.current.window.id).toBe("non-existent");
    });
  });

  describe("updatePosition", () => {
    it("should update window position", () => {
      const { result } = renderHook(() => useWindow("test-window"));

      act(() => {
        result.current.updatePosition({ x: 200, y: 300 });
      });

      expect(result.current.window.position).toEqual({ x: 200, y: 300 });
    });
  });

  describe("updateSize", () => {
    it("should update window size", () => {
      const { result } = renderHook(() => useWindow("test-window"));

      act(() => {
        result.current.updateSize({ width: 400, height: 350 });
      });

      expect(result.current.window.size).toEqual({ width: 400, height: 350 });
    });
  });

  describe("setTransparency", () => {
    it("should update transparency", () => {
      const { result } = renderHook(() => useWindow("test-window"));

      act(() => {
        result.current.setTransparency(50);
      });

      expect(result.current.window.transparency).toBe(50);
    });
  });

  describe("toggleVisible", () => {
    it("should toggle visibility", () => {
      const { result } = renderHook(() => useWindow("test-window"));

      expect(result.current.window.visible).toBe(true);

      act(() => {
        result.current.toggleVisible();
      });

      expect(result.current.window.visible).toBe(false);
    });
  });

  describe("close", () => {
    it("should remove window", () => {
      const { result } = renderHook(() => useWindow("test-window"));

      act(() => {
        result.current.close();
      });

      const windows = useWindowStore.getState().windows;
      expect(windows.has("test-window")).toBe(false);
    });
  });
});
