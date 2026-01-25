/**
 * Tests for useAutoCollapse hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAutoCollapse,
  useRibbonAutoCollapse,
} from "../../src/core/window/useAutoCollapse";

describe("useAutoCollapse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should start not collapsed", () => {
      const { result } = renderHook(() => useAutoCollapse());

      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isPending).toBe(false);
    });
  });

  describe("manual collapse/expand", () => {
    it("should collapse when collapse() is called", () => {
      const onCollapse = vi.fn();
      const { result } = renderHook(() => useAutoCollapse({ onCollapse }));

      act(() => {
        result.current.collapse();
      });

      expect(result.current.isCollapsed).toBe(true);
      expect(onCollapse).toHaveBeenCalled();
    });

    it("should expand when expand() is called", () => {
      const onExpand = vi.fn();
      const { result } = renderHook(() => useAutoCollapse({ onExpand }));

      act(() => {
        result.current.collapse();
        result.current.expand();
      });

      expect(result.current.isCollapsed).toBe(false);
      expect(onExpand).toHaveBeenCalled();
    });

    it("should toggle collapse state", () => {
      const { result } = renderHook(() => useAutoCollapse());

      expect(result.current.isCollapsed).toBe(false);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isCollapsed).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isCollapsed).toBe(false);
    });
  });

  describe("container props", () => {
    it("should provide container event handlers", () => {
      const { result } = renderHook(() => useAutoCollapse());

      expect(result.current.containerProps.onMouseEnter).toBeDefined();
      expect(result.current.containerProps.onMouseLeave).toBeDefined();
      expect(result.current.containerProps.onFocus).toBeDefined();
      expect(result.current.containerProps.onBlur).toBeDefined();
    });
  });

  describe("cancel pending", () => {
    it("should cancel pending collapse", () => {
      const { result } = renderHook(() =>
        useAutoCollapse({ collapseDelay: 1000 }),
      );

      act(() => {
        result.current.containerProps.onMouseLeave();
      });

      expect(result.current.isPending).toBe(true);

      act(() => {
        result.current.cancelPendingCollapse();
      });

      expect(result.current.isPending).toBe(false);
    });
  });

  describe("disabled behavior", () => {
    it("should not auto-collapse when disabled", () => {
      const { result } = renderHook(() =>
        useAutoCollapse({ enabled: false, collapseDelay: 100 }),
      );

      act(() => {
        result.current.containerProps.onMouseLeave();
      });

      expect(result.current.isPending).toBe(false);

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(result.current.isCollapsed).toBe(false);
    });
  });
});

describe("useRibbonAutoCollapse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track open panel state", () => {
    const { result } = renderHook(() => useRibbonAutoCollapse());

    expect(result.current.hasOpenPanel).toBe(false);

    act(() => {
      result.current.markPanelOpen();
    });

    expect(result.current.hasOpenPanel).toBe(true);

    act(() => {
      result.current.markPanelClosed();
    });

    expect(result.current.hasOpenPanel).toBe(false);
  });

  it("should expand when panel is opened", () => {
    const { result } = renderHook(() => useRibbonAutoCollapse());

    act(() => {
      result.current.collapse();
    });

    expect(result.current.isCollapsed).toBe(true);

    act(() => {
      result.current.markPanelOpen();
    });

    expect(result.current.isCollapsed).toBe(false);
  });
});
