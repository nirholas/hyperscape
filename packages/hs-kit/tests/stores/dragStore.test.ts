import { describe, it, expect, beforeEach } from "vitest";
import { useDragStore } from "../../src/stores/dragStore";

describe("dragStore", () => {
  beforeEach(() => {
    useDragStore.setState({
      isDragging: false,
      item: null,
      origin: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      overTargets: [],
    });
  });

  describe("startDrag", () => {
    it("should set isDragging to true", () => {
      const { startDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      expect(useDragStore.getState().isDragging).toBe(true);
    });

    it("should set item correctly", () => {
      const { startDrag } = useDragStore.getState();
      const item = {
        id: "test-item",
        type: "tab" as const,
        sourceId: "window-1",
        data: { foo: "bar" },
      };
      startDrag(item, { x: 50, y: 75 });
      expect(useDragStore.getState().item).toEqual(item);
    });

    it("should set origin position", () => {
      const { startDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 200, y: 300 },
      );
      expect(useDragStore.getState().origin).toEqual({ x: 200, y: 300 });
    });
  });

  describe("updateDrag", () => {
    it("should update current position", () => {
      const { startDrag, updateDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      updateDrag({ x: 200, y: 250 });
      expect(useDragStore.getState().current).toEqual({ x: 200, y: 250 });
    });

    it("should calculate delta correctly", () => {
      const { startDrag, updateDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      updateDrag({ x: 150, y: 175 });
      expect(useDragStore.getState().delta).toEqual({ x: 50, y: 75 });
    });
  });

  describe("endDrag", () => {
    it("should reset isDragging to false", () => {
      const { startDrag, endDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      endDrag();
      expect(useDragStore.getState().isDragging).toBe(false);
    });

    it("should clear item", () => {
      const { startDrag, endDrag } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      endDrag();
      expect(useDragStore.getState().item).toBeNull();
    });
  });

  describe("overTargets", () => {
    it("should add over target", () => {
      const { startDrag, addOverTarget } = useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      addOverTarget("target-1");
      expect(useDragStore.getState().overTargets).toContain("target-1");
    });

    it("should remove over target", () => {
      const { startDrag, addOverTarget, removeOverTarget } =
        useDragStore.getState();
      startDrag(
        { id: "test", type: "window", sourceId: null },
        { x: 100, y: 100 },
      );
      addOverTarget("target-1");
      addOverTarget("target-2");
      removeOverTarget("target-1");
      expect(useDragStore.getState().overTargets).not.toContain("target-1");
      expect(useDragStore.getState().overTargets).toContain("target-2");
    });
  });
});
