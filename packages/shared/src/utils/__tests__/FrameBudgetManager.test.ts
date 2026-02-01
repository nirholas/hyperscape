/**
 * FrameBudgetManager Tests
 *
 * Tests for the frame budget manager that helps reduce main thread jank
 * by tracking frame time and deferring heavy work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FrameBudgetManager,
  WorkPriority,
  getFrameBudget,
} from "../FrameBudgetManager";

// Mock performance.now() for time control
let mockTime = 0;

function setMockTime(time: number) {
  mockTime = time;
}

describe("FrameBudgetManager", () => {
  beforeEach(() => {
    // Reset singleton between tests
    FrameBudgetManager.reset();
    mockTime = 0;
    vi.spyOn(performance, "now").mockImplementation(() => mockTime);
  });

  afterEach(() => {
    FrameBudgetManager.reset();
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("returns singleton instance", () => {
      const instance1 = FrameBudgetManager.getInstance();
      const instance2 = FrameBudgetManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("getFrameBudget returns same singleton", () => {
      const instance = FrameBudgetManager.getInstance();
      expect(getFrameBudget()).toBe(instance);
    });
  });

  describe("frame timing", () => {
    it("tracks frame start time", () => {
      const budget = FrameBudgetManager.getInstance();
      setMockTime(1000);

      budget.beginFrame();
      const elapsed = budget.getElapsedTime();

      expect(elapsed).toBe(0);
    });

    it("calculates time remaining correctly", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      setMockTime(0);
      budget.beginFrame();

      // At start, should have ~12.67ms remaining (16.67 - 4)
      const remaining = budget.getTimeRemaining();
      expect(remaining).toBeCloseTo(12.67, 0);
    });

    it("detects when over budget", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      setMockTime(0);
      budget.beginFrame();

      expect(budget.isOverBudget()).toBe(false);

      // Advance time past budget
      setMockTime(20);
      expect(budget.isOverBudget()).toBe(true);
    });

    it("hasTimeRemaining returns correct values", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      setMockTime(0);
      budget.beginFrame();

      // Should have ~12ms remaining
      expect(budget.hasTimeRemaining(5)).toBe(true);
      expect(budget.hasTimeRemaining(10)).toBe(true);
      expect(budget.hasTimeRemaining(15)).toBe(false);
    });
  });

  describe("deferred work", () => {
    it("defers work when budget exceeded", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      const callback = vi.fn();

      setMockTime(0);
      budget.beginFrame();

      // Simulate time passing to exceed budget
      setMockTime(20);

      // This should defer the work
      budget.deferWork("test-work", callback, WorkPriority.NORMAL, 5);

      // Callback should not have been called yet
      expect(callback).not.toHaveBeenCalled();

      // Check that work is pending
      const stats = budget.getStats();
      expect(stats.pendingWorkCount).toBe(1);
    });

    it("executeOrDefer runs immediately when budget allows", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      const callback = vi.fn();

      setMockTime(0);
      budget.beginFrame();

      const executed = budget.executeOrDefer("test", callback, 5);

      expect(executed).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it("executeOrDefer defers when budget exceeded", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      const callback = vi.fn();

      setMockTime(0);
      budget.beginFrame();

      // Exceed budget
      setMockTime(20);

      const executed = budget.executeOrDefer("test", callback, 5);

      expect(executed).toBe(false);
      expect(callback).not.toHaveBeenCalled();
    });

    it("cancelWork removes pending work", () => {
      const budget = FrameBudgetManager.getInstance();

      const callback = vi.fn();
      budget.deferWork("test-work", callback);

      expect(budget.getStats().pendingWorkCount).toBe(1);

      const cancelled = budget.cancelWork("test-work");

      expect(cancelled).toBe(true);
      expect(budget.getStats().pendingWorkCount).toBe(0);
    });

    it("processDeferredWork executes pending work", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      const callback = vi.fn();

      setMockTime(0);
      budget.beginFrame();

      // Defer work
      budget.deferWork("test-work", callback, WorkPriority.HIGH, 1);

      expect(callback).not.toHaveBeenCalled();

      // Process deferred work
      const processed = budget.processDeferredWork(10);

      expect(processed).toBe(1);
      expect(callback).toHaveBeenCalled();
      expect(budget.getStats().pendingWorkCount).toBe(0);
    });

    it("respects priority order when processing", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 100,
        renderReserve: 0,
      });

      const callOrder: string[] = [];

      setMockTime(0);
      budget.beginFrame();

      // Add work in mixed order
      budget.deferWork("low", () => callOrder.push("low"), WorkPriority.LOW, 1);
      budget.deferWork(
        "critical",
        () => callOrder.push("critical"),
        WorkPriority.CRITICAL,
        1,
      );
      budget.deferWork(
        "normal",
        () => callOrder.push("normal"),
        WorkPriority.NORMAL,
        1,
      );
      budget.deferWork(
        "high",
        () => callOrder.push("high"),
        WorkPriority.HIGH,
        1,
      );

      // Process all
      budget.processDeferredWork(100);

      // Critical should be first, then high, normal, low
      expect(callOrder).toEqual(["critical", "high", "normal", "low"]);
    });
  });

  describe("stats", () => {
    it("tracks frame statistics", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      // Simulate a few frames
      setMockTime(0);
      budget.beginFrame();
      setMockTime(10);
      budget.endFrame();

      setMockTime(20);
      budget.beginFrame();
      setMockTime(35); // 15ms frame
      budget.endFrame();

      setMockTime(50);
      budget.beginFrame();
      setMockTime(70); // 20ms frame (over budget)
      budget.endFrame();

      const stats = budget.getStats();

      expect(stats.frameBudget).toBe(16.67);
      expect(stats.currentFrameTime).toBe(20);
      expect(stats.averageFrameTime).toBeGreaterThan(0);
      expect(stats.maxFrameTime).toBe(20);
    });

    it("tracks over-budget frames", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 0,
      });

      // Frame over budget
      setMockTime(0);
      budget.beginFrame();
      setMockTime(20);
      budget.endFrame();

      let stats = budget.getStats();
      expect(stats.framesOverBudget).toBe(1);

      // Frame under budget
      setMockTime(30);
      budget.beginFrame();
      setMockTime(40);
      budget.endFrame();

      stats = budget.getStats();
      // framesOverBudget should decay
      expect(stats.framesOverBudget).toBe(0);
    });
  });

  describe("batch processing", () => {
    it("processes items in batches synchronously when budget available", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 100, // Large budget
        renderReserve: 0,
      });

      const items = [1, 2, 3, 4, 5];
      const processed: number[] = [];

      setMockTime(0);
      budget.beginFrame();

      // Process synchronously
      for (const item of items) {
        if (budget.hasTimeRemaining(1)) {
          processed.push(item);
        }
      }

      expect(processed).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("work aging", () => {
    it("promotes work to higher priority after delay", () => {
      const budget = FrameBudgetManager.getInstance({
        targetFrameTime: 16.67,
        renderReserve: 4,
      });

      const callback = vi.fn();

      setMockTime(0);
      budget.beginFrame();

      // Defer with LOW priority and max 4 frame delay
      budget.deferWork("test", callback, WorkPriority.LOW, 5, 4);
      budget.endFrame();

      // Simulate 2 frames passing (should promote to NORMAL at halfway)
      for (let i = 0; i < 2; i++) {
        budget.beginFrame();
        budget.endFrame();
      }

      // The work should still be pending (not executed)
      expect(callback).not.toHaveBeenCalled();

      // After max delay, work becomes CRITICAL and should run
      for (let i = 0; i < 3; i++) {
        budget.beginFrame();
        budget.endFrame();
      }

      // Critical work runs at beginning of next frame
      budget.beginFrame();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe("disabled mode", () => {
    it("executes work immediately when disabled", () => {
      const budget = FrameBudgetManager.getInstance();
      budget.setEnabled(false);

      const callback = vi.fn();
      budget.deferWork("test", callback);

      // Should execute immediately when disabled
      expect(callback).toHaveBeenCalled();
    });
  });
});
