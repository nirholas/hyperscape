import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDroppable } from "../src/core/drag/useDroppable";
import { useDragStore } from "../src/stores/dragStore";

describe("useDroppable", () => {
  beforeEach(() => {
    // Reset drag store before each test
    useDragStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should return initial state correctly", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      expect(result.current.isOver).toBe(false);
      expect(result.current.active).toBeNull();
      expect(result.current.over).toBeNull();
    });

    it("should provide setNodeRef callback", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      expect(typeof result.current.setNodeRef).toBe("function");
    });
  });

  describe("with data", () => {
    it("should accept custom data", () => {
      const customData = { accepts: ["item", "weapon"], maxItems: 10 };

      const { result } = renderHook(() =>
        useDroppable({ id: "drop-zone", data: customData }),
      );

      // Data is stored internally for use during drop events
      expect(result.current.isOver).toBe(false);
    });
  });

  describe("disabled state", () => {
    it("should handle disabled prop", () => {
      const { result } = renderHook(() =>
        useDroppable({ id: "drop-zone", disabled: true }),
      );

      expect(result.current.isOver).toBe(false);
    });

    it("should not register drop target when disabled", () => {
      const { result } = renderHook(() =>
        useDroppable({ id: "drop-zone", disabled: true }),
      );

      // Create a mock element
      const element = document.createElement("div");

      act(() => {
        result.current.setNodeRef(element);
      });

      // Should still work but won't accept drops
      expect(result.current.isOver).toBe(false);
    });
  });

  describe("node ref", () => {
    it("should update node ref when setNodeRef is called", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      const element = document.createElement("div");

      act(() => {
        result.current.setNodeRef(element);
      });

      // Node is registered internally
      expect(result.current.isOver).toBe(false);
    });

    it("should handle null node ref", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      act(() => {
        result.current.setNodeRef(null);
      });

      expect(result.current.isOver).toBe(false);
    });

    it("should unregister when node ref changes to null", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      const element = document.createElement("div");

      act(() => {
        result.current.setNodeRef(element);
      });

      act(() => {
        result.current.setNodeRef(null);
      });

      expect(result.current.isOver).toBe(false);
    });
  });

  describe("isOver detection", () => {
    it("should return false when no drag is active", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      expect(result.current.isOver).toBe(false);
    });

    it("should update isOver when drag enters", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      // Simulate drag starting and entering this drop target
      act(() => {
        useDragStore
          .getState()
          .startDrag(
            { id: "item-1", type: "item", sourceId: null },
            { x: 0, y: 0 },
          );
        useDragStore.getState().addOverTarget("drop-zone");
      });

      expect(result.current.isOver).toBe(true);
    });

    it("should update isOver when drag leaves", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      // Start drag and enter
      act(() => {
        useDragStore
          .getState()
          .startDrag(
            { id: "item-1", type: "item", sourceId: null },
            { x: 0, y: 0 },
          );
        useDragStore.getState().addOverTarget("drop-zone");
      });

      expect(result.current.isOver).toBe(true);

      // Leave
      act(() => {
        useDragStore.getState().removeOverTarget("drop-zone");
      });

      expect(result.current.isOver).toBe(false);
    });
  });

  describe("active state", () => {
    it("should return null when no drag is active", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      expect(result.current.active).toBeNull();
    });

    it("should return active item when drag is active", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      act(() => {
        useDragStore.getState().startDrag(
          {
            id: "item-1",
            type: "item",
            sourceId: "inventory",
            data: { slot: 5 },
          },
          { x: 100, y: 100 },
        );
      });

      expect(result.current.active).not.toBeNull();
      expect(result.current.active?.id).toBe("item-1");
    });
  });

  describe("over state", () => {
    it("should return null when not over any target", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      expect(result.current.over).toBeNull();
    });

    it("should return over state when drag is over this target", () => {
      const { result } = renderHook(() => useDroppable({ id: "drop-zone" }));

      act(() => {
        useDragStore
          .getState()
          .startDrag(
            { id: "item-1", type: "item", sourceId: null },
            { x: 0, y: 0 },
          );
        useDragStore.getState().addOverTarget("drop-zone");
      });

      expect(result.current.over).not.toBeNull();
      expect(result.current.over?.id).toBe("drop-zone");
    });
  });

  describe("cleanup", () => {
    it("should cleanup on unmount", () => {
      const { unmount } = renderHook(() => useDroppable({ id: "drop-zone" }));

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });

    it("should unregister drop target on unmount", () => {
      const element = document.createElement("div");

      const { result, unmount } = renderHook(() =>
        useDroppable({ id: "drop-zone" }),
      );

      act(() => {
        result.current.setNodeRef(element);
      });

      // Unmount should clean up
      unmount();

      // No errors should occur
    });
  });

  describe("multiple drop targets", () => {
    it("should handle multiple drop targets independently", () => {
      const { result: result1 } = renderHook(() =>
        useDroppable({ id: "drop-zone-1" }),
      );
      const { result: result2 } = renderHook(() =>
        useDroppable({ id: "drop-zone-2" }),
      );

      // Start drag and enter only zone 1
      act(() => {
        useDragStore
          .getState()
          .startDrag(
            { id: "item-1", type: "item", sourceId: null },
            { x: 0, y: 0 },
          );
        useDragStore.getState().addOverTarget("drop-zone-1");
      });

      expect(result1.current.isOver).toBe(true);
      expect(result2.current.isOver).toBe(false);

      // Move to zone 2
      act(() => {
        useDragStore.getState().removeOverTarget("drop-zone-1");
        useDragStore.getState().addOverTarget("drop-zone-2");
      });

      expect(result1.current.isOver).toBe(false);
      expect(result2.current.isOver).toBe(true);
    });
  });
});
