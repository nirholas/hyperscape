import { describe, it, expect } from "vitest";
import {
  checkActivationConstraint,
  getKeyboardMovementDelta,
  isStartKey,
  isCancelKey,
  isDropKey,
  DEFAULT_KEYBOARD_OPTIONS,
} from "../src/core/drag/sensors";

describe("Sensors", () => {
  describe("checkActivationConstraint", () => {
    it("should activate when distance threshold is met", () => {
      const origin = { x: 0, y: 0 };
      const current = { x: 5, y: 0 };
      const startTime = Date.now();

      const result = checkActivationConstraint(origin, current, startTime, {
        distance: 3,
      });
      expect(result.activated).toBe(true);
      expect(result.shouldCancel).toBe(false);
    });

    it("should not activate before distance threshold", () => {
      const origin = { x: 0, y: 0 };
      const current = { x: 2, y: 0 };
      const startTime = Date.now();

      const result = checkActivationConstraint(origin, current, startTime, {
        distance: 5,
      });
      expect(result.activated).toBe(false);
    });

    it("should cancel if moved too much during delay", () => {
      const origin = { x: 0, y: 0 };
      const current = { x: 10, y: 0 };
      const startTime = Date.now();

      const result = checkActivationConstraint(origin, current, startTime, {
        delay: 500,
        tolerance: 5,
      });
      expect(result.shouldCancel).toBe(true);
      expect(result.activated).toBe(false);
    });
  });

  describe("getKeyboardMovementDelta", () => {
    it("should return up delta for ArrowUp", () => {
      const delta = getKeyboardMovementDelta(
        "ArrowUp",
        DEFAULT_KEYBOARD_OPTIONS,
      );
      expect(delta).toEqual({ x: 0, y: -10 });
    });

    it("should return down delta for ArrowDown", () => {
      const delta = getKeyboardMovementDelta(
        "ArrowDown",
        DEFAULT_KEYBOARD_OPTIONS,
      );
      expect(delta).toEqual({ x: 0, y: 10 });
    });

    it("should return left delta for ArrowLeft", () => {
      const delta = getKeyboardMovementDelta(
        "ArrowLeft",
        DEFAULT_KEYBOARD_OPTIONS,
      );
      expect(delta).toEqual({ x: -10, y: 0 });
    });

    it("should return right delta for ArrowRight", () => {
      const delta = getKeyboardMovementDelta(
        "ArrowRight",
        DEFAULT_KEYBOARD_OPTIONS,
      );
      expect(delta).toEqual({ x: 10, y: 0 });
    });

    it("should multiply step by 5 when shift is pressed", () => {
      const delta = getKeyboardMovementDelta(
        "ArrowUp",
        DEFAULT_KEYBOARD_OPTIONS,
        true,
      );
      expect(delta).toEqual({ x: 0, y: -50 });
    });

    it("should return null for non-movement keys", () => {
      const delta = getKeyboardMovementDelta("a", DEFAULT_KEYBOARD_OPTIONS);
      expect(delta).toBeNull();
    });
  });

  describe("Key detection functions", () => {
    it("should detect start keys", () => {
      expect(isStartKey(" ")).toBe(true);
      expect(isStartKey("Enter")).toBe(true);
      expect(isStartKey("a")).toBe(false);
    });

    it("should detect cancel keys", () => {
      expect(isCancelKey("Escape")).toBe(true);
      expect(isCancelKey("Enter")).toBe(false);
    });

    it("should detect drop keys", () => {
      expect(isDropKey(" ")).toBe(true);
      expect(isDropKey("Enter")).toBe(true);
      expect(isDropKey("Escape")).toBe(false);
    });
  });
});
