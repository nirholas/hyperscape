import { describe, it, expect } from "vitest";
import {
  restrictToWindow,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
  createSnapToGridModifier,
  composeModifiers,
  createModifierContext,
} from "../src/core/drag/modifiers";
import type { Point, ModifierContext } from "../src/core/drag/modifiers";

describe("Modifiers", () => {
  const createContext = (origin: Point, current: Point): ModifierContext => ({
    origin,
    current,
    windowSize: { width: 1920, height: 1080 },
  });

  describe("restrictToWindow", () => {
    it("should keep position inside window bounds", () => {
      const context = createContext({ x: 0, y: 0 }, { x: 2000, y: 1200 });
      context.dragSize = { width: 100, height: 100 };

      const result = restrictToWindow({ x: 2000, y: 1200 }, context);
      expect(result.x).toBe(1820); // 1920 - 100
      expect(result.y).toBe(980); // 1080 - 100
    });

    it("should not modify position if already inside", () => {
      const context = createContext({ x: 0, y: 0 }, { x: 500, y: 500 });
      context.dragSize = { width: 100, height: 100 };

      const result = restrictToWindow({ x: 500, y: 500 }, context);
      expect(result.x).toBe(500);
      expect(result.y).toBe(500);
    });

    it("should prevent negative positions", () => {
      const context = createContext({ x: 0, y: 0 }, { x: -100, y: -100 });

      const result = restrictToWindow({ x: -100, y: -100 }, context);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe("restrictToHorizontalAxis", () => {
    it("should only allow horizontal movement", () => {
      const context = createContext({ x: 100, y: 200 }, { x: 300, y: 400 });

      const result = restrictToHorizontalAxis({ x: 300, y: 400 }, context);
      expect(result.x).toBe(300);
      expect(result.y).toBe(200); // Y stays at origin
    });
  });

  describe("restrictToVerticalAxis", () => {
    it("should only allow vertical movement", () => {
      const context = createContext({ x: 100, y: 200 }, { x: 300, y: 400 });

      const result = restrictToVerticalAxis({ x: 300, y: 400 }, context);
      expect(result.x).toBe(100); // X stays at origin
      expect(result.y).toBe(400);
    });
  });

  describe("createSnapToGridModifier", () => {
    it("should snap to 8px grid", () => {
      const snapTo8 = createSnapToGridModifier(8);
      const context = createContext({ x: 0, y: 0 }, { x: 0, y: 0 });

      expect(snapTo8({ x: 14, y: 22 }, context)).toEqual({ x: 16, y: 24 });
      expect(snapTo8({ x: 3, y: 7 }, context)).toEqual({ x: 0, y: 8 });
    });

    it("should snap to custom grid size", () => {
      const snapTo16 = createSnapToGridModifier(16);
      const context = createContext({ x: 0, y: 0 }, { x: 0, y: 0 });

      expect(snapTo16({ x: 25, y: 30 }, context)).toEqual({ x: 32, y: 32 });
    });
  });

  describe("composeModifiers", () => {
    it("should apply modifiers in order", () => {
      const context = createContext({ x: 100, y: 100 }, { x: 200, y: 200 });

      const composed = composeModifiers(
        restrictToHorizontalAxis,
        createSnapToGridModifier(8),
      );

      const result = composed({ x: 203, y: 305 }, context);
      expect(result.x).toBe(200); // Snapped to grid
      expect(result.y).toBe(104); // Restricted to horizontal axis, then snapped
    });
  });
});
