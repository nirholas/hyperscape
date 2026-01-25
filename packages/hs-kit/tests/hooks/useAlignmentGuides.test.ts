import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAlignmentGuides } from "../../src/core/edit/useAlignmentGuides";
import { useEditStore } from "../../src/stores/editStore";
import type { WindowState } from "../../src/types";

describe("useAlignmentGuides", () => {
  const createMockWindow = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): WindowState => ({
    id,
    position: { x, y },
    size: { width: w, height: h },
    minSize: { width: 100, height: 50 },
    tabs: [],
    activeTabIndex: 0,
    transparency: 0,
    visible: true,
    zIndex: 1000,
    locked: false,
  });

  beforeEach(() => {
    useEditStore.setState({
      mode: "unlocked",
      showGuides: true,
      snapEnabled: true,
      gridSize: 8,
      showGrid: true,
    });
  });

  describe("with no other windows", () => {
    it("should return empty guides", () => {
      const { result } = renderHook(() => useAlignmentGuides([], "window-1"));
      expect(result.current.guides).toEqual([]);
    });
  });

  describe("with other windows", () => {
    it("should detect guides from other windows", () => {
      const windows = [createMockWindow("other-window", 100, 100, 200, 150)];

      const { result } = renderHook(() =>
        useAlignmentGuides(windows, "window-1"),
      );

      // snapToGuide should work
      const rect = { x: 105, y: 300, width: 200, height: 150 };
      const snapped = result.current.snapToGuide(rect, {
        width: 200,
        height: 150,
      });

      // Should snap to x: 100 (left edge of other-window) within threshold
      expect(snapped.x).toBe(100);
    });

    it("should not modify position outside threshold", () => {
      const windows = [createMockWindow("other-window", 100, 100, 200, 150)];

      const { result } = renderHook(() =>
        useAlignmentGuides(windows, "window-1"),
      );

      // Far from any edge
      const rect = { x: 500, y: 500, width: 200, height: 150 };
      const snapped = result.current.snapToGuide(rect, {
        width: 200,
        height: 150,
      });

      expect(snapped.x).toBe(500);
      expect(snapped.y).toBe(500);
    });
  });

  describe("guides visibility", () => {
    it("should return empty guides when showGuides is false", () => {
      useEditStore.setState({ showGuides: false });

      const windows = [createMockWindow("other-window", 100, 100, 200, 150)];

      const { result } = renderHook(() =>
        useAlignmentGuides(windows, "window-1"),
      );
      expect(result.current.guides).toEqual([]);
    });
  });

  describe("snapToGuide", () => {
    it("should return point with x and y", () => {
      const { result } = renderHook(() => useAlignmentGuides([], "window-1"));

      const snapped = result.current.snapToGuide(
        { x: 100, y: 200, width: 100, height: 100 },
        { width: 100, height: 100 },
      );
      expect(snapped).toHaveProperty("x");
      expect(snapped).toHaveProperty("y");
    });
  });
});
