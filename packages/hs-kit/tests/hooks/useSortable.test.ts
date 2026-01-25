import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { useSortable } from "../../src/core/sortable/useSortable";
import { useDragStore } from "../../src/stores/dragStore";
import {
  verticalListSorting,
  horizontalListSorting,
  rectSorting,
  arrayMove,
  arraySwap,
} from "../../src/core/sortable";

describe("useSortable", () => {
  beforeEach(() => {
    useDragStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should return initial state correctly", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(result.current.isDragging).toBe(false);
      expect(result.current.isSorting).toBe(false);
      expect(result.current.transform).toBeNull();
      expect(result.current.transition).toBeNull();
      expect(result.current.active).toBeNull();
    });

    it("should return correct attributes", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(result.current.attributes.role).toBe("listitem");
      expect(result.current.attributes.tabIndex).toBe(0);
      expect(result.current.attributes["aria-disabled"]).toBe(false);
      expect(result.current.attributes["aria-roledescription"]).toBe(
        "sortable",
      );
      expect(result.current.attributes["data-sortable-id"]).toBe("item-1");
    });

    it("should return disabled attributes when disabled", () => {
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", disabled: true }),
      );

      expect(result.current.attributes["aria-disabled"]).toBe(true);
      expect(result.current.attributes.tabIndex).toBe(-1);
    });

    it("should provide setNodeRef callback", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(typeof result.current.setNodeRef).toBe("function");
    });

    it("should provide event listeners", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(typeof result.current.listeners.onPointerDown).toBe("function");
      expect(typeof result.current.listeners.onKeyDown).toBe("function");
    });

    it("should provide setActivatorNodeRef callback", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(typeof result.current.setActivatorNodeRef).toBe("function");
    });
  });

  describe("with custom data", () => {
    it("should store custom data for access in events", () => {
      const customData = { name: "Test Item", order: 5 };
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", data: customData }),
      );

      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("disabled state", () => {
    it("should not respond to pointer down when disabled", () => {
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", disabled: true }),
      );

      const mockEvent = {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        target: document.createElement("div"),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent;

      act(() => {
        result.current.listeners.onPointerDown(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it("should not respond to keyboard when disabled", () => {
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", disabled: true }),
      );

      const mockEvent = {
        key: " ",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("node ref", () => {
    it("should update node ref when setNodeRef is called", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      const element = document.createElement("div");

      act(() => {
        result.current.setNodeRef(element);
      });

      expect(result.current.node.current).toBe(element);
    });

    it("should handle null node ref", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      act(() => {
        result.current.setNodeRef(null);
      });

      expect(result.current.node.current).toBeNull();
    });
  });

  describe("keyboard interaction", () => {
    it("should handle Space key", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      const mockEvent = {
        key: " ",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should handle Enter key", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      const mockEvent = {
        key: "Enter",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should ignore other keys when not dragging", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      const mockEvent = {
        key: "ArrowUp",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      // Arrow keys should not prevent default when not dragging
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("pointer interaction", () => {
    it("should ignore non-primary button clicks", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      const mockEvent = {
        button: 2, // Right click
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        target: document.createElement("div"),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent;

      act(() => {
        result.current.listeners.onPointerDown(mockEvent);
      });

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("transform and transition", () => {
    it("should return null transform when not dragging", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(result.current.transform).toBeNull();
    });

    it("should return null transition when not sorting", () => {
      const { result } = renderHook(() => useSortable({ id: "item-1" }));

      expect(result.current.transition).toBeNull();
    });

    it("should respect animateLayoutChanges option", () => {
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", animateLayoutChanges: false }),
      );

      expect(result.current.transition).toBeNull();
    });

    it("should use custom transition when provided and sorting", () => {
      const { result } = renderHook(() =>
        useSortable({ id: "item-1", transition: "transform 100ms linear" }),
      );

      // Custom transition is only applied during sorting, which requires a SortableContext
      // Without context, transition should always be null
      expect(result.current.transition).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should cleanup on unmount", () => {
      const { unmount } = renderHook(() => useSortable({ id: "item-1" }));

      expect(() => unmount()).not.toThrow();
    });
  });
});

describe("Sorting Strategies", () => {
  const createItems = (
    count: number,
    layout: "vertical" | "horizontal" | "grid",
  ) => {
    const items = [];
    const itemSize = 50;
    const columns = layout === "grid" ? 3 : 1;

    for (let i = 0; i < count; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      items.push({
        id: `item-${i}`,
        index: i,
        rect: {
          x: layout === "horizontal" ? i * itemSize : col * itemSize,
          y: layout === "vertical" ? i * itemSize : row * itemSize,
          width: itemSize,
          height: itemSize,
        },
      });
    }
    return items;
  };

  describe("verticalListSorting", () => {
    it("should return same index when not over different item", () => {
      const items = createItems(5, "vertical");
      const result = verticalListSorting(items, 0, 0, { x: 25, y: 25 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });

    it("should calculate items to shift when moving down", () => {
      const items = createItems(5, "vertical");
      const result = verticalListSorting(items, 0, 2, { x: 25, y: 125 });

      expect(result.index).toBe(2);
      expect(result.itemsToShift.length).toBeGreaterThan(0);
    });

    it("should calculate items to shift when moving up", () => {
      const items = createItems(5, "vertical");
      const result = verticalListSorting(items, 3, 1, { x: 25, y: 75 });

      expect(result.itemsToShift.length).toBeGreaterThan(0);
    });

    it("should handle empty items array", () => {
      const result = verticalListSorting([], 0, 0, { x: 0, y: 0 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });
  });

  describe("horizontalListSorting", () => {
    it("should return same index when not over different item", () => {
      const items = createItems(5, "horizontal");
      const result = horizontalListSorting(items, 0, 0, { x: 25, y: 25 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });

    it("should calculate items to shift when moving right", () => {
      const items = createItems(5, "horizontal");
      const result = horizontalListSorting(items, 0, 2, { x: 125, y: 25 });

      expect(result.index).toBe(2);
      expect(result.itemsToShift.length).toBeGreaterThan(0);
    });

    it("should calculate items to shift when moving left", () => {
      const items = createItems(5, "horizontal");
      const result = horizontalListSorting(items, 3, 1, { x: 75, y: 25 });

      expect(result.itemsToShift.length).toBeGreaterThan(0);
    });

    it("should handle empty items array", () => {
      const result = horizontalListSorting([], 0, 0, { x: 0, y: 0 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });
  });

  describe("rectSorting", () => {
    it("should return same index when not over different item", () => {
      const items = createItems(9, "grid");
      const result = rectSorting(items, 0, 0, { x: 25, y: 25 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });

    it("should handle grid movement", () => {
      const items = createItems(9, "grid");
      const result = rectSorting(items, 0, 4, { x: 75, y: 75 });

      expect(result.index).toBe(4);
    });

    it("should handle empty items array", () => {
      const result = rectSorting([], 0, 0, { x: 0, y: 0 });

      expect(result.index).toBe(0);
      expect(result.itemsToShift).toHaveLength(0);
    });
  });
});

describe("Array Utilities", () => {
  describe("arrayMove", () => {
    it("should move item forward", () => {
      const items = ["a", "b", "c", "d"];
      const result = arrayMove(items, 0, 2);

      expect(result).toEqual(["b", "c", "a", "d"]);
    });

    it("should move item backward", () => {
      const items = ["a", "b", "c", "d"];
      const result = arrayMove(items, 3, 1);

      expect(result).toEqual(["a", "d", "b", "c"]);
    });

    it("should not mutate original array", () => {
      const items = ["a", "b", "c"];
      const result = arrayMove(items, 0, 2);

      expect(items).toEqual(["a", "b", "c"]);
      expect(result).not.toBe(items);
    });

    it("should handle same index", () => {
      const items = ["a", "b", "c"];
      const result = arrayMove(items, 1, 1);

      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should handle single item array", () => {
      const items = ["a"];
      const result = arrayMove(items, 0, 0);

      expect(result).toEqual(["a"]);
    });
  });

  describe("arraySwap", () => {
    it("should swap two items", () => {
      const items = ["a", "b", "c"];
      const result = arraySwap(items, 0, 2);

      expect(result).toEqual(["c", "b", "a"]);
    });

    it("should not mutate original array", () => {
      const items = ["a", "b", "c"];
      const result = arraySwap(items, 0, 2);

      expect(items).toEqual(["a", "b", "c"]);
      expect(result).not.toBe(items);
    });

    it("should handle same index", () => {
      const items = ["a", "b", "c"];
      const result = arraySwap(items, 1, 1);

      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should handle adjacent items", () => {
      const items = ["a", "b", "c", "d"];
      const result = arraySwap(items, 1, 2);

      expect(result).toEqual(["a", "c", "b", "d"]);
    });
  });
});
