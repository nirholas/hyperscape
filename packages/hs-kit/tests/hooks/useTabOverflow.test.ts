import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabOverflow } from "../../src/core/tabs/useTabOverflow";

describe("useTabOverflow", () => {
  describe("needsOverflow", () => {
    it("should not need overflow when tabs fit", () => {
      const { result } = renderHook(() => useTabOverflow(5));
      expect(result.current.needsOverflow).toBe(false);
    });

    it("should need overflow when tabs exceed max", () => {
      const { result } = renderHook(() => useTabOverflow(10));
      expect(result.current.needsOverflow).toBe(true);
    });

    it("should respect custom maxVisibleTabs", () => {
      const { result } = renderHook(() =>
        useTabOverflow(5, { maxVisibleTabs: 4 }),
      );
      expect(result.current.needsOverflow).toBe(true);
    });
  });

  describe("scroll controls", () => {
    it("should start with canScrollLeft false", () => {
      const { result } = renderHook(() => useTabOverflow(10));
      expect(result.current.canScrollLeft).toBe(false);
    });

    it("should have canScrollRight true when overflow needed", () => {
      const { result } = renderHook(() => useTabOverflow(10));
      expect(result.current.canScrollRight).toBe(true);
    });

    it("should scroll right", () => {
      const { result } = renderHook(() => useTabOverflow(10));

      act(() => {
        result.current.scrollRight();
      });

      expect(result.current.scrollPosition).toBe(1);
      expect(result.current.canScrollLeft).toBe(true);
    });

    it("should scroll left", () => {
      const { result } = renderHook(() => useTabOverflow(10));

      act(() => {
        result.current.scrollRight();
        result.current.scrollRight();
        result.current.scrollLeft();
      });

      expect(result.current.scrollPosition).toBe(1);
    });

    it("should not scroll past beginning", () => {
      const { result } = renderHook(() => useTabOverflow(10));

      act(() => {
        result.current.scrollLeft();
      });

      expect(result.current.scrollPosition).toBe(0);
    });

    it("should not scroll past end", () => {
      const { result } = renderHook(() =>
        useTabOverflow(10, { maxVisibleTabs: 8 }),
      );

      // maxScroll = 10 - 8 = 2
      act(() => {
        result.current.scrollRight();
        result.current.scrollRight();
        result.current.scrollRight();
        result.current.scrollRight();
      });

      expect(result.current.scrollPosition).toBe(2);
      expect(result.current.canScrollRight).toBe(false);
    });
  });
});
