/**
 * Tests for useBadge and useBadges hooks
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBadge,
  useBadges,
  useBadgeStore,
  BADGE_COLORS,
  getBadgeStyle,
} from "../../src/core/notifications/useBadges";

describe("useBadge", () => {
  beforeEach(() => {
    useBadgeStore.getState().clearAllBadges();
  });

  describe("initial state", () => {
    it("should have undefined badge initially", () => {
      const { result } = renderHook(() => useBadge("test"));

      expect(result.current.badge).toBeUndefined();
      expect(result.current.isVisible).toBe(false);
    });
  });

  describe("set badge", () => {
    it("should set badge count", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(5);
      });

      expect(result.current.badge?.count).toBe(5);
      expect(result.current.isVisible).toBe(true);
    });

    it("should set badge type", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(3, "warning");
      });

      expect(result.current.badge?.type).toBe("warning");
    });

    it("should set badge pulsate", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(1, "error", true);
      });

      expect(result.current.badge?.pulsate).toBe(true);
    });
  });

  describe("clear badge", () => {
    it("should clear badge", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(5);
        result.current.clearBadge();
      });

      expect(result.current.badge).toBeUndefined();
      expect(result.current.isVisible).toBe(false);
    });
  });

  describe("increment/decrement", () => {
    it("should increment badge", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.increment();
      });

      expect(result.current.badge?.count).toBe(1);

      act(() => {
        result.current.increment(5);
      });

      expect(result.current.badge?.count).toBe(6);
    });

    it("should decrement badge", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(10);
        result.current.decrement(3);
      });

      expect(result.current.badge?.count).toBe(7);
    });

    it("should remove badge when decremented to 0", () => {
      const { result } = renderHook(() => useBadge("test"));

      act(() => {
        result.current.setBadge(2);
        result.current.decrement(5);
      });

      expect(result.current.badge).toBeUndefined();
    });
  });
});

describe("useBadges", () => {
  beforeEach(() => {
    useBadgeStore.getState().clearAllBadges();
  });

  it("should list all badges", () => {
    const { result } = renderHook(() => useBadges());

    act(() => {
      result.current.setBadge("badge1", 5);
      result.current.setBadge("badge2", 3);
    });

    expect(result.current.badges).toHaveLength(2);
    expect(result.current.totalCount).toBe(8);
  });

  it("should clear all badges", () => {
    const { result } = renderHook(() => useBadges());

    act(() => {
      result.current.setBadge("badge1", 5);
      result.current.setBadge("badge2", 3);
      result.current.clearAll();
    });

    expect(result.current.badges).toHaveLength(0);
    expect(result.current.totalCount).toBe(0);
  });

  it("should get specific badge", () => {
    const { result } = renderHook(() => useBadges());

    act(() => {
      result.current.setBadge("badge1", 5, "success");
    });

    const badge = result.current.getBadge("badge1");
    expect(badge?.count).toBe(5);
    expect(badge?.type).toBe("success");
  });
});

describe("getBadgeStyle", () => {
  it("should return correct style for badge", () => {
    const badge = {
      id: "test",
      count: 5,
      type: "error" as const,
      pulsate: false,
    };
    const style = getBadgeStyle(badge);

    expect(style.backgroundColor).toBe(BADGE_COLORS.error);
  });

  it("should include animation for pulsating badge", () => {
    const badge = {
      id: "test",
      count: 5,
      type: "info" as const,
      pulsate: true,
    };
    const style = getBadgeStyle(badge);

    expect(style.animation).toBeDefined();
    expect(style.animation).toContain("badge-pulse");
  });
});

describe("BADGE_COLORS", () => {
  it("should have all badge types", () => {
    expect(BADGE_COLORS.info).toBeDefined();
    expect(BADGE_COLORS.success).toBeDefined();
    expect(BADGE_COLORS.warning).toBeDefined();
    expect(BADGE_COLORS.error).toBeDefined();
  });
});
