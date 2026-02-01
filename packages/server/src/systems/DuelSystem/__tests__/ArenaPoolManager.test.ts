/**
 * ArenaPoolManager Unit Tests
 *
 * Tests the arena pool management system:
 * - Arena initialization (6 arenas)
 * - Arena reservation and release
 * - Spawn point and bounds retrieval
 * - Pool exhaustion handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ArenaPoolManager } from "../ArenaPoolManager";

describe("ArenaPoolManager", () => {
  let manager: ArenaPoolManager;

  beforeEach(() => {
    manager = new ArenaPoolManager();
  });

  describe("initialization", () => {
    it("initializes with 6 arenas", () => {
      const arenaIds = manager.getAllArenaIds();
      expect(arenaIds).toHaveLength(6);
      expect(arenaIds).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("all arenas start as available", () => {
      expect(manager.getAvailableCount()).toBe(6);
      for (let i = 1; i <= 6; i++) {
        expect(manager.isArenaAvailable(i)).toBe(true);
      }
    });

    it("each arena has valid spawn points", () => {
      for (let i = 1; i <= 6; i++) {
        const spawnPoints = manager.getSpawnPoints(i);
        expect(spawnPoints).toBeDefined();
        expect(spawnPoints).toHaveLength(2);
        expect(spawnPoints![0]).toHaveProperty("x");
        expect(spawnPoints![0]).toHaveProperty("y");
        expect(spawnPoints![0]).toHaveProperty("z");
        expect(spawnPoints![1]).toHaveProperty("x");
        expect(spawnPoints![1]).toHaveProperty("y");
        expect(spawnPoints![1]).toHaveProperty("z");
      }
    });

    it("each arena has valid bounds", () => {
      for (let i = 1; i <= 6; i++) {
        const bounds = manager.getArenaBounds(i);
        expect(bounds).toBeDefined();
        expect(bounds!.min).toHaveProperty("x");
        expect(bounds!.min).toHaveProperty("y");
        expect(bounds!.min).toHaveProperty("z");
        expect(bounds!.max).toHaveProperty("x");
        expect(bounds!.max).toHaveProperty("y");
        expect(bounds!.max).toHaveProperty("z");
        // Bounds should be valid (max > min)
        expect(bounds!.max.x).toBeGreaterThan(bounds!.min.x);
        expect(bounds!.max.z).toBeGreaterThan(bounds!.min.z);
      }
    });

    it("spawn points are within arena bounds", () => {
      for (let i = 1; i <= 6; i++) {
        const spawnPoints = manager.getSpawnPoints(i)!;
        const bounds = manager.getArenaBounds(i)!;

        for (const spawn of spawnPoints) {
          expect(spawn.x).toBeGreaterThanOrEqual(bounds.min.x);
          expect(spawn.x).toBeLessThanOrEqual(bounds.max.x);
          expect(spawn.z).toBeGreaterThanOrEqual(bounds.min.z);
          expect(spawn.z).toBeLessThanOrEqual(bounds.max.z);
        }
      }
    });
  });

  describe("reserveArena", () => {
    it("reserves and returns first available arena", () => {
      const arenaId = manager.reserveArena("duel_1");
      expect(arenaId).toBe(1);
      expect(manager.isArenaAvailable(1)).toBe(false);
      expect(manager.getAvailableCount()).toBe(5);
    });

    it("reserves next available arena when first is taken", () => {
      manager.reserveArena("duel_1");
      const arenaId = manager.reserveArena("duel_2");
      expect(arenaId).toBe(2);
      expect(manager.isArenaAvailable(2)).toBe(false);
      expect(manager.getAvailableCount()).toBe(4);
    });

    it("returns null when all arenas are in use", () => {
      // Reserve all 6 arenas
      for (let i = 1; i <= 6; i++) {
        expect(manager.reserveArena(`duel_${i}`)).toBe(i);
      }

      // Try to reserve a 7th
      const result = manager.reserveArena("duel_7");
      expect(result).toBeNull();
      expect(manager.getAvailableCount()).toBe(0);
    });

    it("tracks duel ID for reserved arena", () => {
      manager.reserveArena("duel_test_123");
      expect(manager.getDuelIdForArena(1)).toBe("duel_test_123");
    });
  });

  describe("releaseArena", () => {
    it("releases a reserved arena by arena ID", () => {
      manager.reserveArena("duel_1");
      expect(manager.isArenaAvailable(1)).toBe(false);

      const result = manager.releaseArena(1);
      expect(result).toBe(true);
      expect(manager.isArenaAvailable(1)).toBe(true);
      expect(manager.getAvailableCount()).toBe(6);
    });

    it("returns false for invalid arena ID", () => {
      const result = manager.releaseArena(999);
      expect(result).toBe(false);
    });

    it("clears duel ID when released", () => {
      manager.reserveArena("duel_1");
      expect(manager.getDuelIdForArena(1)).toBe("duel_1");

      manager.releaseArena(1);
      expect(manager.getDuelIdForArena(1)).toBeNull();
    });
  });

  describe("releaseArenaByDuelId", () => {
    it("releases arena by duel ID", () => {
      manager.reserveArena("duel_test_456");
      expect(manager.getAvailableCount()).toBe(5);

      const result = manager.releaseArenaByDuelId("duel_test_456");
      expect(result).toBe(true);
      expect(manager.getAvailableCount()).toBe(6);
    });

    it("returns false if duel ID not found", () => {
      const result = manager.releaseArenaByDuelId("nonexistent_duel");
      expect(result).toBe(false);
    });

    it("releases correct arena when multiple are reserved", () => {
      manager.reserveArena("duel_a");
      manager.reserveArena("duel_b");
      manager.reserveArena("duel_c");

      manager.releaseArenaByDuelId("duel_b");

      expect(manager.getDuelIdForArena(1)).toBe("duel_a");
      expect(manager.getDuelIdForArena(2)).toBeNull();
      expect(manager.getDuelIdForArena(3)).toBe("duel_c");
      expect(manager.getAvailableCount()).toBe(4);
    });
  });

  describe("getArena", () => {
    it("returns arena configuration by ID", () => {
      const arena = manager.getArena(1);
      expect(arena).toBeDefined();
      expect(arena!.arenaId).toBe(1);
      expect(arena!.spawnPoints).toBeDefined();
      expect(arena!.bounds).toBeDefined();
      expect(arena!.center).toBeDefined();
    });

    it("returns undefined for invalid arena ID", () => {
      const arena = manager.getArena(999);
      expect(arena).toBeUndefined();
    });
  });

  describe("getArenaCenter", () => {
    it("returns center position for arena", () => {
      const center = manager.getArenaCenter(1);
      expect(center).toBeDefined();
      expect(center).toHaveProperty("x");
      expect(center).toHaveProperty("z");
    });

    it("returns undefined for invalid arena ID", () => {
      const center = manager.getArenaCenter(999);
      expect(center).toBeUndefined();
    });

    it("center is between spawn points", () => {
      for (let i = 1; i <= 6; i++) {
        const center = manager.getArenaCenter(i)!;
        const spawnPoints = manager.getSpawnPoints(i)!;

        // Center x should be same as spawn x (spawns are north/south)
        expect(center.x).toBe(spawnPoints[0].x);
        expect(center.x).toBe(spawnPoints[1].x);

        // Center z should be between spawn z values
        const minZ = Math.min(spawnPoints[0].z, spawnPoints[1].z);
        const maxZ = Math.max(spawnPoints[0].z, spawnPoints[1].z);
        expect(center.z).toBeGreaterThan(minZ);
        expect(center.z).toBeLessThan(maxZ);
      }
    });
  });

  describe("arena grid layout", () => {
    it("arenas are arranged in 2x3 grid", () => {
      // Get centers of all arenas
      const centers: Array<{ x: number; z: number }> = [];
      for (let i = 1; i <= 6; i++) {
        centers.push(manager.getArenaCenter(i)!);
      }

      // Arenas 1 and 2 should be in the same row (same z range)
      expect(Math.abs(centers[0].z - centers[1].z)).toBeLessThan(1);

      // Arenas 1 and 3 should be in different rows (different z)
      expect(Math.abs(centers[0].z - centers[2].z)).toBeGreaterThan(10);

      // Arenas 1 and 2 should be in different columns (different x)
      expect(Math.abs(centers[0].x - centers[1].x)).toBeGreaterThan(10);
    });
  });
});
