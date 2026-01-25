import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditMode } from "../../src/core/edit/useEditMode";
import { useEditStore } from "../../src/stores/editStore";

describe("useEditMode", () => {
  beforeEach(() => {
    useEditStore.setState({
      mode: "locked",
      gridSize: 8,
      snapEnabled: true,
      showGrid: true,
      showGuides: true,
    });
  });

  describe("mode state", () => {
    it("should start in locked mode", () => {
      const { result } = renderHook(() => useEditMode());
      expect(result.current.mode).toBe("locked");
      expect(result.current.isLocked).toBe(true);
      expect(result.current.isUnlocked).toBe(false);
    });

    it("should toggle mode", () => {
      const { result } = renderHook(() => useEditMode());

      act(() => {
        result.current.toggleMode();
      });

      expect(result.current.mode).toBe("unlocked");
      expect(result.current.isUnlocked).toBe(true);
    });

    it("should set mode directly", () => {
      const { result } = renderHook(() => useEditMode());

      act(() => {
        result.current.setMode("unlocked");
      });

      expect(result.current.mode).toBe("unlocked");

      act(() => {
        result.current.setMode("locked");
      });

      expect(result.current.mode).toBe("locked");
    });
  });

  describe("snap settings", () => {
    it("should toggle snap enabled", () => {
      const { result } = renderHook(() => useEditMode());

      expect(result.current.snapEnabled).toBe(true);

      act(() => {
        result.current.setSnapEnabled(false);
      });

      expect(result.current.snapEnabled).toBe(false);
    });
  });

  describe("grid settings", () => {
    it("should have 8px grid size", () => {
      const { result } = renderHook(() => useEditMode());
      expect(result.current.gridSize).toBe(8);
    });

    it("should toggle show grid", () => {
      const { result } = renderHook(() => useEditMode());

      act(() => {
        result.current.setShowGrid(false);
      });

      expect(result.current.showGrid).toBe(false);
    });
  });

  describe("guide settings", () => {
    it("should toggle show guides", () => {
      const { result } = renderHook(() => useEditMode());

      act(() => {
        result.current.setShowGuides(false);
      });

      expect(result.current.showGuides).toBe(false);
    });
  });
});
