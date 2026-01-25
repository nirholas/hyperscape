import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSnap } from "../../src/core/window/useSnap";
import { useEditStore } from "../../src/stores/editStore";

describe("useSnap", () => {
  beforeEach(() => {
    useEditStore.setState({
      mode: "unlocked",
      gridSize: 8,
      snapEnabled: true,
      showGrid: true,
      showGuides: true,
    });
  });

  describe("snapToGrid", () => {
    it("should snap position to 8px grid when enabled", () => {
      const { result } = renderHook(() => useSnap());

      const snapped = result.current.snapToGrid({ x: 14, y: 22 });
      expect(snapped.position).toEqual({ x: 16, y: 24 });
      expect(snapped.snapped).toBe(true);
    });

    it("should not snap when snap is disabled", () => {
      useEditStore.setState({ snapEnabled: false });
      const { result } = renderHook(() => useSnap());

      const snapped = result.current.snapToGrid({ x: 14, y: 22 });
      expect(snapped.position).toEqual({ x: 14, y: 22 });
      expect(snapped.snapped).toBe(false);
    });
  });

  describe("snapToEdges", () => {
    it("should snap to viewport left edge", () => {
      const { result } = renderHook(() => useSnap());

      const viewport = { width: 1920, height: 1080 };
      const snapped = result.current.snapToEdges(
        { x: 5, y: 100, width: 200, height: 100 },
        viewport,
      );
      expect(snapped.position.x).toBe(0);
      expect(snapped.snappedX).toBe(true);
    });

    it("should snap to viewport top edge", () => {
      const { result } = renderHook(() => useSnap());

      const viewport = { width: 1920, height: 1080 };
      const snapped = result.current.snapToEdges(
        { x: 100, y: 3, width: 200, height: 100 },
        viewport,
      );
      expect(snapped.position.y).toBe(0);
      expect(snapped.snappedY).toBe(true);
    });
  });

  describe("snap (combined)", () => {
    it("should return snap result with position", () => {
      const { result } = renderHook(() => useSnap());

      const viewport = { width: 1920, height: 1080 };
      const snapped = result.current.snap(
        { x: 5, y: 7 },
        { width: 200, height: 100 },
        viewport,
      );
      expect(snapped.position).toBeDefined();
      expect(typeof snapped.snapped).toBe("boolean");
    });
  });

  describe("snapEnabled", () => {
    it("should reflect store state", () => {
      const { result } = renderHook(() => useSnap());
      expect(result.current.snapEnabled).toBe(true);

      useEditStore.setState({ snapEnabled: false });
      const { result: result2 } = renderHook(() => useSnap());
      expect(result2.current.snapEnabled).toBe(false);
    });
  });

  describe("gridSize", () => {
    it("should return grid size from store", () => {
      const { result } = renderHook(() => useSnap());
      expect(result.current.gridSize).toBe(8);
    });
  });
});
