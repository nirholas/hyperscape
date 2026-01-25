import { describe, it, expect } from "vitest";
import {
  closestCenter,
  closestCorners,
  rectIntersection,
  pointerWithin,
  isPointInRect,
  getIntersectionArea,
} from "../src/core/drag/collisionDetection";
import type { Rect, Point } from "../src/types";

describe("Collision Detection", () => {
  describe("isPointInRect", () => {
    it("should return true when point is inside rect", () => {
      const point: Point = { x: 50, y: 50 };
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(isPointInRect(point, rect)).toBe(true);
    });

    it("should return true when point is on edge", () => {
      const point: Point = { x: 0, y: 0 };
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(isPointInRect(point, rect)).toBe(true);
    });

    it("should return false when point is outside rect", () => {
      const point: Point = { x: 150, y: 50 };
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(isPointInRect(point, rect)).toBe(false);
    });
  });

  describe("getIntersectionArea", () => {
    it("should return correct area for overlapping rects", () => {
      const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const b: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(getIntersectionArea(a, b)).toBe(2500); // 50 * 50
    });

    it("should return 0 for non-overlapping rects", () => {
      const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const b: Rect = { x: 200, y: 200, width: 100, height: 100 };
      expect(getIntersectionArea(a, b)).toBe(0);
    });

    it("should return full area when one contains other", () => {
      const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const b: Rect = { x: 25, y: 25, width: 50, height: 50 };
      expect(getIntersectionArea(a, b)).toBe(2500);
    });
  });

  describe("closestCenter", () => {
    it("should return targets sorted by distance to center", () => {
      const dragRect: Rect = { x: 50, y: 50, width: 20, height: 20 };
      const targets = new Map<string, Rect>([
        ["far", { x: 200, y: 200, width: 50, height: 50 }],
        ["close", { x: 60, y: 60, width: 50, height: 50 }],
        ["medium", { x: 100, y: 100, width: 50, height: 50 }],
      ]);

      const results = closestCenter(dragRect, targets);
      expect(results[0].id).toBe("close");
      expect(results[1].id).toBe("medium");
      expect(results[2].id).toBe("far");
    });

    it("should return empty array for no targets", () => {
      const dragRect: Rect = { x: 50, y: 50, width: 20, height: 20 };
      const targets = new Map<string, Rect>();
      const results = closestCenter(dragRect, targets);
      expect(results).toEqual([]);
    });
  });

  describe("closestCorners", () => {
    it("should return targets sorted by corner distance", () => {
      const dragRect: Rect = { x: 0, y: 0, width: 10, height: 10 };
      const targets = new Map<string, Rect>([
        ["adjacent", { x: 10, y: 0, width: 10, height: 10 }],
        ["far", { x: 100, y: 100, width: 10, height: 10 }],
      ]);

      const results = closestCorners(dragRect, targets);
      expect(results[0].id).toBe("adjacent");
      expect(results[1].id).toBe("far");
    });
  });

  describe("rectIntersection", () => {
    it("should return only overlapping targets", () => {
      const dragRect: Rect = { x: 50, y: 50, width: 100, height: 100 };
      const targets = new Map<string, Rect>([
        ["overlapping", { x: 100, y: 100, width: 100, height: 100 }],
        ["notOverlapping", { x: 300, y: 300, width: 50, height: 50 }],
      ]);

      const results = rectIntersection(dragRect, targets);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("overlapping");
    });

    it("should sort by overlap area (larger overlap first)", () => {
      const dragRect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const targets = new Map<string, Rect>([
        ["smallOverlap", { x: 90, y: 0, width: 100, height: 100 }],
        ["largeOverlap", { x: 50, y: 0, width: 100, height: 100 }],
      ]);

      const results = rectIntersection(dragRect, targets);
      expect(results[0].id).toBe("largeOverlap");
    });
  });

  describe("pointerWithin", () => {
    it("should return targets containing pointer", () => {
      const pointer: Point = { x: 75, y: 75 };
      const targets = new Map<string, Rect>([
        ["contains", { x: 50, y: 50, width: 100, height: 100 }],
        ["notContains", { x: 200, y: 200, width: 50, height: 50 }],
      ]);

      const results = pointerWithin(pointer, targets);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("contains");
    });

    it("should prefer smaller targets", () => {
      const pointer: Point = { x: 50, y: 50 };
      const targets = new Map<string, Rect>([
        ["large", { x: 0, y: 0, width: 200, height: 200 }],
        ["small", { x: 25, y: 25, width: 50, height: 50 }],
      ]);

      const results = pointerWithin(pointer, targets);
      expect(results[0].id).toBe("small");
    });
  });
});
