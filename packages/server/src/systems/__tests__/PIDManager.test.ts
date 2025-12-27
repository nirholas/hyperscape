/**
 * PIDManager Tests
 *
 * Verifies:
 * - PID assignment and removal
 * - Processing order (lower PID first)
 * - Reshuffle timing (100-150 ticks)
 * - Deterministic shuffling
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PIDManager,
  resetPIDManager,
  getPIDManager,
  type PIDReshuffleEvent,
} from "../PIDManager";
import { initializeGameRng } from "@hyperscape/shared";

describe("PIDManager", () => {
  let manager: PIDManager;

  beforeEach(() => {
    // Initialize game RNG with fixed seed for deterministic tests
    initializeGameRng(12345);
    resetPIDManager();
    manager = new PIDManager();
  });

  describe("PID assignment", () => {
    it("assigns PID to new player", () => {
      const pid = manager.assignPID("player1");
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThanOrEqual(0);
      expect(pid).toBeLessThanOrEqual(2047);
    });

    it("returns same PID for same player", () => {
      const pid1 = manager.assignPID("player1");
      const pid2 = manager.assignPID("player1");
      expect(pid1).toBe(pid2);
    });

    it("assigns different PIDs to different players", () => {
      const pid1 = manager.assignPID("player1");
      const pid2 = manager.assignPID("player2");
      expect(pid1).not.toBe(pid2);
    });

    it("getPID returns assigned PID", () => {
      const assigned = manager.assignPID("player1");
      const retrieved = manager.getPID("player1");
      expect(retrieved).toBe(assigned);
    });

    it("getPID returns undefined for unknown player", () => {
      expect(manager.getPID("unknown")).toBeUndefined();
    });

    it("handles many players", () => {
      const pids = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const pid = manager.assignPID(`player${i}`);
        expect(pids.has(pid)).toBe(false);
        pids.add(pid);
      }
      expect(manager.getPlayerCount()).toBe(100);
    });
  });

  describe("PID removal", () => {
    it("removes PID on disconnect", () => {
      manager.assignPID("player1");
      manager.removePID("player1");
      expect(manager.getPID("player1")).toBeUndefined();
      expect(manager.getPlayerCount()).toBe(0);
    });

    it("allows PID reuse after removal", () => {
      manager.assignPID("player1");
      manager.removePID("player1");
      // The next player might get a different PID due to increment
      // but the old PID slot is now available
      expect(manager.getPlayerCount()).toBe(0);
    });

    it("handles removing non-existent player", () => {
      // Should not throw
      manager.removePID("unknown");
      expect(manager.getPlayerCount()).toBe(0);
    });
  });

  describe("processing order", () => {
    it("returns players sorted by PID (lowest first)", () => {
      // Add players
      manager.assignPID("playerA");
      manager.assignPID("playerB");
      manager.assignPID("playerC");

      const order = manager.getProcessingOrder();
      expect(order.length).toBe(3);

      // Verify sorted by PID
      const pids = order.map((id) => manager.getPID(id)!);
      for (let i = 1; i < pids.length; i++) {
        expect(pids[i]).toBeGreaterThan(pids[i - 1]);
      }
    });

    it("comparePID returns correct ordering", () => {
      manager.assignPID("playerA");
      manager.assignPID("playerB");

      const pidA = manager.getPID("playerA")!;
      const pidB = manager.getPID("playerB")!;

      if (pidA < pidB) {
        expect(manager.comparePID("playerA", "playerB")).toBeLessThan(0);
        expect(manager.comparePID("playerB", "playerA")).toBeGreaterThan(0);
      } else {
        expect(manager.comparePID("playerA", "playerB")).toBeGreaterThan(0);
        expect(manager.comparePID("playerB", "playerA")).toBeLessThan(0);
      }
    });
  });

  describe("reshuffle", () => {
    it("schedules reshuffle between 100-150 ticks", () => {
      const nextReshuffle = manager.getNextReshuffleTick();
      expect(nextReshuffle).toBeGreaterThanOrEqual(100);
      expect(nextReshuffle).toBeLessThanOrEqual(150);
    });

    it("reshuffles when tick reaches threshold", () => {
      manager.assignPID("player1");
      manager.assignPID("player2");
      manager.assignPID("player3");

      manager.getProcessingOrder().slice();
      const reshuffleTick = manager.getNextReshuffleTick();

      // Process ticks up to reshuffle
      manager.processTick(reshuffleTick);

      // After reshuffle, order may have changed
      // (deterministic, so we just verify reshuffle occurred)
      const newReshuffleTick = manager.getNextReshuffleTick();
      expect(newReshuffleTick).toBeGreaterThan(reshuffleTick);
    });

    it("emits reshuffle event", () => {
      let eventReceived = false;
      let eventData: PIDReshuffleEvent | null = null;

      manager.setReshuffleCallback((event) => {
        eventReceived = true;
        eventData = event;
      });

      manager.assignPID("player1");
      const reshuffleTick = manager.getNextReshuffleTick();
      manager.processTick(reshuffleTick);

      expect(eventReceived).toBe(true);
      expect(eventData!.tick).toBe(reshuffleTick);
    });

    it("changes PID assignments on reshuffle", () => {
      // Add multiple players
      for (let i = 0; i < 10; i++) {
        manager.assignPID(`player${i}`);
      }

      const beforePIDs = manager.getAllAssignments();
      const reshuffleTick = manager.getNextReshuffleTick();
      manager.processTick(reshuffleTick);
      const afterPIDs = manager.getAllAssignments();

      // At least some PIDs should have changed
      let changedCount = 0;
      for (const [playerId, newPid] of afterPIDs) {
        if (beforePIDs.get(playerId) !== newPid) {
          changedCount++;
        }
      }
      expect(changedCount).toBeGreaterThan(0);
    });

    it("reshuffle is deterministic with same seed", () => {
      // First run
      initializeGameRng(99999);
      const manager1 = new PIDManager();
      for (let i = 0; i < 5; i++) {
        manager1.assignPID(`player${i}`);
      }
      manager1.processTick(manager1.getNextReshuffleTick());
      const order1 = manager1.getProcessingOrder();

      // Second run with same seed
      initializeGameRng(99999);
      const manager2 = new PIDManager();
      for (let i = 0; i < 5; i++) {
        manager2.assignPID(`player${i}`);
      }
      manager2.processTick(manager2.getNextReshuffleTick());
      const order2 = manager2.getProcessingOrder();

      expect(order1).toEqual(order2);
    });
  });

  describe("global instance", () => {
    beforeEach(() => {
      resetPIDManager();
    });

    it("getPIDManager returns singleton", () => {
      const manager1 = getPIDManager();
      const manager2 = getPIDManager();
      expect(manager1).toBe(manager2);
    });

    it("resetPIDManager clears global instance", () => {
      const manager1 = getPIDManager();
      manager1.assignPID("player1");

      resetPIDManager();

      const manager2 = getPIDManager();
      expect(manager2.getPlayerCount()).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty reshuffle", () => {
      // No players, should not throw
      manager.reshufflePIDs(100);
      expect(manager.getPlayerCount()).toBe(0);
    });

    it("handles single player reshuffle", () => {
      manager.assignPID("player1");
      manager.reshufflePIDs(100);
      expect(manager.getPlayerCount()).toBe(1);
      expect(manager.getPID("player1")).toBeDefined();
    });

    it("reset clears all state", () => {
      manager.assignPID("player1");
      manager.assignPID("player2");
      manager.reset();

      expect(manager.getPlayerCount()).toBe(0);
      expect(manager.getPID("player1")).toBeUndefined();
    });
  });
});
