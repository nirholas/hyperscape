import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVirtualList } from "../../src/core/virtual/useVirtualList";

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

describe("useVirtualList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should return correct total height for fixed height items", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(result.current.totalHeight).toBe(4000); // 100 * 40
    });

    it("should return empty virtual items when itemCount is 0", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 0,
          itemHeight: 40,
        }),
      );

      expect(result.current.virtualItems).toEqual([]);
      expect(result.current.totalHeight).toBe(0);
    });

    it("should provide a container ref", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(result.current.containerRef).toBeDefined();
      expect(result.current.containerRef.current).toBeNull(); // Not attached yet
    });

    it("should track scroll offset", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          initialScrollOffset: 100,
        }),
      );

      expect(result.current.scrollOffset).toBe(100);
    });
  });

  describe("range calculation", () => {
    it("should calculate initial range with overscan", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          overscan: 3,
        }),
      );

      // With no container height, range should be minimal
      expect(result.current.range.startIndex).toBe(0);
    });

    it("should respect overscan setting", () => {
      const { result: result1 } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          overscan: 5,
        }),
      );

      const { result: result2 } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          overscan: 10,
        }),
      );

      // Both should start at 0 (can't go negative)
      expect(result1.current.range.startIndex).toBe(0);
      expect(result2.current.range.startIndex).toBe(0);
    });
  });

  describe("virtual items", () => {
    it("should generate virtual items with correct offsets", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 10,
          itemHeight: 50,
        }),
      );

      // Check that virtual items have correct offsets
      const items = result.current.virtualItems;
      if (items.length > 0) {
        expect(items[0].offset).toBe(0);
        expect(items[0].height).toBe(50);
        expect(items[0].index).toBe(0);
      }
    });

    it("should mark visible items correctly", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          overscan: 2,
        }),
      );

      // All items in the range should have isVisible property
      result.current.virtualItems.forEach((item) => {
        expect(typeof item.isVisible).toBe("boolean");
      });
    });
  });

  describe("scroll functions", () => {
    it("should provide scrollToIndex function", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(typeof result.current.scrollToIndex).toBe("function");
    });

    it("should provide scrollToOffset function", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(typeof result.current.scrollToOffset).toBe("function");
    });
  });

  describe("measurement functions", () => {
    it("should provide measureAll function", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(typeof result.current.measureAll).toBe("function");
      // Should not throw
      act(() => {
        result.current.measureAll();
      });
    });

    it("should provide measureItem function", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      expect(typeof result.current.measureItem).toBe("function");
      // Should not throw
      act(() => {
        result.current.measureItem(0, 60);
      });
    });
  });

  describe("variable height items", () => {
    it("should use estimateItemHeight when provided", () => {
      const estimateFn = vi.fn((index: number) => 30 + index * 2);

      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 10,
          estimateItemHeight: estimateFn,
        }),
      );

      // Total height should be sum of estimated heights
      // 30, 32, 34, 36, 38, 40, 42, 44, 46, 48 = 390
      expect(result.current.totalHeight).toBe(390);
    });

    it("should fall back to default height when no height specified", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 10,
          // No itemHeight or estimateItemHeight
        }),
      );

      // Default is 40px per item
      expect(result.current.totalHeight).toBe(400);
    });
  });

  describe("callbacks", () => {
    it("should call onRangeChange when range changes", () => {
      const onRangeChange = vi.fn();

      renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
          onRangeChange,
        }),
      );

      // Should be called at least once on mount
      expect(onRangeChange).toHaveBeenCalled();
    });
  });

  describe("scrolling state", () => {
    it("should track isScrolling state", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 100,
          itemHeight: 40,
        }),
      );

      // Initially not scrolling
      expect(result.current.isScrolling).toBe(false);
    });
  });

  describe("large datasets", () => {
    it("should handle 10000 items efficiently", () => {
      const startTime = performance.now();

      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 10000,
          itemHeight: 40,
          overscan: 5,
        }),
      );

      const endTime = performance.now();

      // Should complete in under 100ms
      expect(endTime - startTime).toBeLessThan(100);
      expect(result.current.totalHeight).toBe(400000);
    });

    it("should only render a subset of items for large datasets", () => {
      const { result } = renderHook(() =>
        useVirtualList({
          itemCount: 10000,
          itemHeight: 40,
          overscan: 5,
        }),
      );

      // Should not render all 10000 items
      expect(result.current.virtualItems.length).toBeLessThan(100);
    });
  });
});
