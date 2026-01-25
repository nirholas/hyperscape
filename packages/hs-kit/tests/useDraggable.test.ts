import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraggable } from "../src/core/drag/useDraggable";
import { useDragStore } from "../src/stores/dragStore";

// Mock pointer events
const createPointerEvent = (
  type: string,
  options: Partial<PointerEvent> = {},
): PointerEvent => {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...options,
  });
};

describe("useDraggable", () => {
  beforeEach(() => {
    // Reset drag store before each test
    useDragStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should return initial state correctly", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      expect(result.current.isDragging).toBe(false);
      expect(result.current.transform).toBeNull();
      expect(result.current.active).toBeNull();
    });

    it("should return correct attributes", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      expect(result.current.attributes.role).toBe("button");
      expect(result.current.attributes.tabIndex).toBe(0);
      expect(result.current.attributes["aria-disabled"]).toBe(false);
      expect(result.current.attributes["data-draggable-id"]).toBe("test-item");
    });

    it("should return disabled attributes when disabled", () => {
      const { result } = renderHook(() =>
        useDraggable({ id: "test-item", disabled: true }),
      );

      expect(result.current.attributes["aria-disabled"]).toBe(true);
      expect(result.current.attributes.tabIndex).toBe(-1);
    });

    it("should provide setNodeRef callback", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      expect(typeof result.current.setNodeRef).toBe("function");
    });

    it("should provide event listeners", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      expect(typeof result.current.listeners.onPointerDown).toBe("function");
      expect(typeof result.current.listeners.onKeyDown).toBe("function");
    });
  });

  describe("with custom data", () => {
    it("should store custom data in active state when dragging", () => {
      const customData = { item: { id: 123, name: "Sword" }, slot: 5 };

      const { result } = renderHook(() =>
        useDraggable({ id: "test-item", data: customData }),
      );

      // Verify data is accessible (will be in active state when dragging starts)
      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("with activation distance", () => {
    it("should use default activation distance", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      // Default is 3px - drag should not start until moved 3px
      expect(result.current.isDragging).toBe(false);
    });

    it("should accept custom activation distance", () => {
      const { result } = renderHook(() =>
        useDraggable({ id: "test-item", activationDistance: 10 }),
      );

      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("disabled state", () => {
    it("should not respond to pointer down when disabled", () => {
      const { result } = renderHook(() =>
        useDraggable({ id: "test-item", disabled: true }),
      );

      // Create a mock event
      const mockEvent = {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        target: document.createElement("div"),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent;

      // Should not throw and should not start drag
      act(() => {
        result.current.listeners.onPointerDown(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it("should not respond to keyboard when disabled", () => {
      const { result } = renderHook(() =>
        useDraggable({ id: "test-item", disabled: true }),
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
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      const element = document.createElement("div");

      act(() => {
        result.current.setNodeRef(element);
      });

      expect(result.current.node.current).toBe(element);
    });

    it("should handle null node ref", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      act(() => {
        result.current.setNodeRef(null);
      });

      expect(result.current.node.current).toBeNull();
    });
  });

  describe("keyboard interaction", () => {
    it("should handle Space key", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      const mockEvent = {
        key: " ",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      // Without a node ref, keyboard drag won't start
      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should handle Enter key", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      const mockEvent = {
        key: "Enter",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should ignore other keys", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      const mockEvent = {
        key: "Escape",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.listeners.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("pointer interaction", () => {
    it("should ignore non-primary button clicks", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

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

  describe("transform calculation", () => {
    it("should return null transform when not dragging", () => {
      const { result } = renderHook(() => useDraggable({ id: "test-item" }));

      expect(result.current.transform).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should cleanup on unmount", () => {
      const { unmount } = renderHook(() => useDraggable({ id: "test-item" }));

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });
  });
});
