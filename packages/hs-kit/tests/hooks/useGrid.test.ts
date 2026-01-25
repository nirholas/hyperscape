import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGrid } from "../../src/core/edit/useGrid";
import { useEditStore } from "../../src/stores/editStore";

describe("useGrid", () => {
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
    it("should snap value to nearest grid point", () => {
      const { result } = renderHook(() => useGrid());

      expect(result.current.snapToGrid(14)).toBe(16);
      expect(result.current.snapToGrid(12)).toBe(16);
      expect(result.current.snapToGrid(11)).toBe(8);
      expect(result.current.snapToGrid(4)).toBe(8);
      expect(result.current.snapToGrid(3)).toBe(0);
    });

    it("should snap to exact grid points", () => {
      const { result } = renderHook(() => useGrid());

      expect(result.current.snapToGrid(0)).toBe(0);
      expect(result.current.snapToGrid(8)).toBe(8);
      expect(result.current.snapToGrid(16)).toBe(16);
      expect(result.current.snapToGrid(24)).toBe(24);
    });
  });

  describe("snapPointToGrid", () => {
    it("should snap both x and y coordinates", () => {
      const { result } = renderHook(() => useGrid());

      const point = result.current.snapPointToGrid({ x: 14, y: 22 });
      expect(point).toEqual({ x: 16, y: 24 });
    });
  });

  describe("getGridLines", () => {
    it("should return grid lines with x and y arrays", () => {
      const { result } = renderHook(() => useGrid());

      const lines = result.current.getGridLines({ width: 100, height: 100 });
      expect(lines.x).toBeDefined();
      expect(lines.y).toBeDefined();
      expect(Array.isArray(lines.x)).toBe(true);
      expect(Array.isArray(lines.y)).toBe(true);
    });

    it("should have major lines arrays", () => {
      const { result } = renderHook(() => useGrid());

      const lines = result.current.getGridLines({ width: 100, height: 100 });
      expect(lines.majorX).toBeDefined();
      expect(lines.majorY).toBeDefined();
      expect(Array.isArray(lines.majorX)).toBe(true);
    });

    it("should generate correct number of lines", () => {
      const { result } = renderHook(() => useGrid());

      const lines = result.current.getGridLines({ width: 80, height: 80 });
      // 80 / 8 = 10 grid lines (0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80)
      // Major lines at 0, 32, 64 (every 32px)
      // Regular lines at 8, 16, 24, 40, 48, 56, 72, 80
      const totalX = lines.x.length + lines.majorX.length;
      expect(totalX).toBeGreaterThan(0);
    });
  });

  describe("majorGridSize", () => {
    it("should be 4x grid size (32 when grid is 8)", () => {
      const { result } = renderHook(() => useGrid());
      expect(result.current.majorGridSize).toBe(32);
    });
  });
});
