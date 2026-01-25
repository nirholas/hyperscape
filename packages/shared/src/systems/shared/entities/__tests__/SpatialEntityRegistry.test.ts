/**
 * SpatialEntityRegistry Unit Tests
 *
 * Tests for chunk-based spatial partitioning:
 * - Entity registration and removal
 * - Chunk assignment and updates
 * - Hysteresis for boundary jitter prevention
 * - Active chunk calculation based on player positions
 * - Range queries and nearest player lookup
 * - Edge cases and boundary conditions
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SpatialEntityRegistry } from "../SpatialEntityRegistry";

describe("SpatialEntityRegistry", () => {
  let registry: SpatialEntityRegistry;

  beforeEach(() => {
    registry = new SpatialEntityRegistry();
  });

  // ===== ENTITY REGISTRATION TESTS =====
  describe("addEntity", () => {
    it("should register an entity at given position", () => {
      registry.addEntity("mob_1", 100, 100, "mob");
      const reg = registry.getEntityRegistration("mob_1");

      expect(reg).toBeDefined();
      expect(reg!.entityId).toBe("mob_1");
      expect(reg!.x).toBe(100);
      expect(reg!.z).toBe(100);
      expect(reg!.entityType).toBe("mob");
      expect(reg!.isPlayer).toBe(false);
    });

    it("should register a player with isPlayer flag", () => {
      registry.addEntity("player_1", 50, 50, "player", true);
      const reg = registry.getEntityRegistration("player_1");

      expect(reg).toBeDefined();
      expect(reg!.isPlayer).toBe(true);
    });

    it("should assign correct chunk key based on position", () => {
      // Position (100, 100) should be in chunk (1, 1) for 64m chunks
      registry.addEntity("mob_1", 100, 100, "mob");
      const reg = registry.getEntityRegistration("mob_1");

      expect(reg!.chunkKey).toBe("1_1");
    });

    it("should handle negative coordinates", () => {
      registry.addEntity("mob_1", -100, -100, "mob");
      const reg = registry.getEntityRegistration("mob_1");

      // -100 / 64 = -1.5625, floor = -2
      expect(reg!.chunkKey).toBe("-2_-2");
    });

    it("should handle origin (0,0)", () => {
      registry.addEntity("mob_1", 0, 0, "mob");
      const reg = registry.getEntityRegistration("mob_1");

      expect(reg!.chunkKey).toBe("0_0");
    });

    it("should update position if entity already registered", () => {
      registry.addEntity("mob_1", 100, 100, "mob");
      registry.addEntity("mob_1", 200, 200, "mob");

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg!.x).toBe(200);
      expect(reg!.z).toBe(200);
      expect(reg!.chunkKey).toBe("3_3"); // 200/64 = 3.125
    });

    it("should track multiple entities in same chunk", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("mob_2", 20, 20, "mob");
      registry.addEntity("mob_3", 30, 30, "mob");

      const entities = registry.getEntitiesInChunk("0_0");
      expect(entities).toHaveLength(3);
      expect(entities).toContain("mob_1");
      expect(entities).toContain("mob_2");
      expect(entities).toContain("mob_3");
    });
  });

  // ===== ENTITY REMOVAL TESTS =====
  describe("removeEntity", () => {
    it("should remove entity from registry", () => {
      registry.addEntity("mob_1", 100, 100, "mob");
      registry.removeEntity("mob_1");

      expect(registry.getEntityRegistration("mob_1")).toBeUndefined();
    });

    it("should remove entity from chunk", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("mob_2", 20, 20, "mob");
      registry.removeEntity("mob_1");

      const entities = registry.getEntitiesInChunk("0_0");
      expect(entities).toHaveLength(1);
      expect(entities).toContain("mob_2");
    });

    it("should handle removing non-existent entity gracefully", () => {
      // Should not throw
      expect(() => registry.removeEntity("nonexistent")).not.toThrow();
    });

    it("should remove player from players set", () => {
      registry.addEntity("player_1", 100, 100, "player", true);
      registry.removeEntity("player_1");

      const players = registry.getPlayerPositions();
      expect(players).toHaveLength(0);
    });

    it("should clean up empty chunks", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.removeEntity("mob_1");

      const entities = registry.getEntitiesInChunk("0_0");
      expect(entities).toHaveLength(0);
    });
  });

  // ===== POSITION UPDATE TESTS =====
  describe("updateEntityPosition", () => {
    it("should update entity position within same chunk", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.updateEntityPosition("mob_1", 20, 20);

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg!.x).toBe(20);
      expect(reg!.z).toBe(20);
      expect(reg!.chunkKey).toBe("0_0"); // Still in chunk 0
    });

    it("should move entity to new chunk when crossing boundary", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.updateEntityPosition("mob_1", 100, 100);

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg!.chunkKey).toBe("1_1");

      // Should be removed from old chunk
      expect(registry.getEntitiesInChunk("0_0")).not.toContain("mob_1");
      // Should be in new chunk
      expect(registry.getEntitiesInChunk("1_1")).toContain("mob_1");
    });

    it("should handle updating non-existent entity gracefully", () => {
      expect(() =>
        registry.updateEntityPosition("nonexistent", 100, 100),
      ).not.toThrow();
    });

    it("should apply hysteresis for player chunk changes", () => {
      // Player at center of chunk 0 (position 32, 32)
      registry.addEntity("player_1", 32, 32, "player", true);

      // Move slightly past chunk boundary but within hysteresis
      // Chunk boundary is at 64, hysteresis is 5m, so threshold is 32 + 5 = 37m from center
      registry.updateEntityPosition("player_1", 65, 32);

      const reg = registry.getEntityRegistration("player_1");
      // Should still be in chunk 0 due to hysteresis
      expect(reg!.chunkKey).toBe("0_0");
    });

    it("should move player to new chunk when well past hysteresis", () => {
      registry.addEntity("player_1", 32, 32, "player", true);

      // Move well past the hysteresis zone
      registry.updateEntityPosition("player_1", 100, 100);

      const reg = registry.getEntityRegistration("player_1");
      expect(reg!.chunkKey).toBe("1_1");
    });

    it("should NOT apply hysteresis to non-player entities", () => {
      registry.addEntity("mob_1", 32, 32, "mob");

      // Move just past chunk boundary
      registry.updateEntityPosition("mob_1", 65, 32);

      const reg = registry.getEntityRegistration("mob_1");
      // Mobs should immediately change chunks
      expect(reg!.chunkKey).toBe("1_0");
    });
  });

  // ===== RANGE QUERY TESTS =====
  describe("getEntitiesInRange", () => {
    beforeEach(() => {
      // Set up a grid of entities
      registry.addEntity("mob_1", 0, 0, "mob"); // Origin
      registry.addEntity("mob_2", 50, 0, "mob"); // 50m away
      registry.addEntity("mob_3", 100, 0, "mob"); // 100m away
      registry.addEntity("npc_1", 0, 100, "npc"); // 100m away (different type)
      registry.addEntity("mob_4", 200, 200, "mob"); // ~283m away (diagonal)
    });

    it("should return entities within specified radius", () => {
      const results = registry.getEntitiesInRange(0, 0, 75);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.entityId)).toContain("mob_1");
      expect(results.map((r) => r.entityId)).toContain("mob_2");
    });

    it("should return empty array when no entities in range", () => {
      const results = registry.getEntitiesInRange(1000, 1000, 10);
      expect(results).toHaveLength(0);
    });

    it("should filter by entity type when specified", () => {
      const results = registry.getEntitiesInRange(0, 0, 150, "npc");

      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("npc_1");
    });

    it("should sort results by distance (closest first)", () => {
      const results = registry.getEntitiesInRange(0, 0, 150);

      // mob_1 at origin should be first
      expect(results[0].entityId).toBe("mob_1");
      expect(results[0].distanceSq).toBe(0);

      // mob_2 at 50m should be second
      expect(results[1].entityId).toBe("mob_2");
      expect(results[1].distanceSq).toBe(50 * 50);
    });

    it("should include squared distance in results", () => {
      const results = registry.getEntitiesInRange(0, 0, 150);

      for (const result of results) {
        expect(typeof result.distanceSq).toBe("number");
        expect(result.distanceSq).toBeGreaterThanOrEqual(0);
      }
    });

    it("should handle negative query coordinates", () => {
      registry.addEntity("mob_neg", -50, -50, "mob");

      const results = registry.getEntitiesInRange(-50, -50, 10);
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("mob_neg");
    });

    it("should handle large radius spanning multiple chunks", () => {
      const results = registry.getEntitiesInRange(0, 0, 500);

      // Should find all entities
      expect(results.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ===== PLAYER POSITION TESTS =====
  describe("getPlayerPositions", () => {
    it("should return empty array when no players", () => {
      registry.addEntity("mob_1", 100, 100, "mob");

      const players = registry.getPlayerPositions();
      expect(players).toHaveLength(0);
    });

    it("should return all player positions", () => {
      registry.addEntity("player_1", 100, 100, "player", true);
      registry.addEntity("player_2", 200, 200, "player", true);
      registry.addEntity("mob_1", 300, 300, "mob");

      const players = registry.getPlayerPositions();
      expect(players).toHaveLength(2);
      expect(players.map((p) => p.entityId)).toContain("player_1");
      expect(players.map((p) => p.entityId)).toContain("player_2");
    });

    it("should return updated positions after player moves", () => {
      registry.addEntity("player_1", 100, 100, "player", true);
      registry.updateEntityPosition("player_1", 200, 200);

      const players = registry.getPlayerPositions();
      expect(players[0].x).toBe(200);
      expect(players[0].z).toBe(200);
    });
  });

  // ===== NEAREST PLAYER TESTS =====
  describe("getNearestPlayer", () => {
    it("should return null when no players registered", () => {
      const nearest = registry.getNearestPlayer(100, 100);
      expect(nearest).toBeNull();
    });

    it("should return the nearest player", () => {
      registry.addEntity("player_1", 100, 100, "player", true);
      registry.addEntity("player_2", 500, 500, "player", true);

      const nearest = registry.getNearestPlayer(120, 120);

      expect(nearest).not.toBeNull();
      expect(nearest!.entityId).toBe("player_1");
    });

    it("should return correct squared distance", () => {
      registry.addEntity("player_1", 100, 100, "player", true);

      const nearest = registry.getNearestPlayer(200, 100);

      // Distance is 100m, squared = 10000
      expect(nearest!.distanceSq).toBe(10000);
    });

    it("should handle ties (same distance) deterministically", () => {
      registry.addEntity("player_1", 100, 0, "player", true);
      registry.addEntity("player_2", -100, 0, "player", true);

      const nearest = registry.getNearestPlayer(0, 0);

      // Should return one of them (first found)
      expect(nearest).not.toBeNull();
      expect(["player_1", "player_2"]).toContain(nearest!.entityId);
    });
  });

  // ===== ACTIVE CHUNK TESTS =====
  describe("getActiveChunks", () => {
    it("should return empty set when no players", () => {
      registry.addEntity("mob_1", 100, 100, "mob");

      const activeChunks = registry.getActiveChunks();
      expect(activeChunks.size).toBe(0);
    });

    it("should mark chunks near players as active", () => {
      registry.addEntity("player_1", 0, 0, "player", true);

      const activeChunks = registry.getActiveChunks();

      // Player at origin should activate chunk 0_0
      expect(activeChunks.has("0_0")).toBe(true);
    });

    it("should include surrounding chunks within active radius", () => {
      registry.addEntity("player_1", 0, 0, "player", true);

      const activeChunks = registry.getActiveChunks();

      // Should have multiple active chunks (at minimum the player's chunk)
      // Active radius is ~256m, chunk size is 64m, so should have ~4x4 chunks
      expect(activeChunks.size).toBeGreaterThan(0);
    });

    it("should combine active areas for multiple players", () => {
      // Players far apart
      registry.addEntity("player_1", 0, 0, "player", true);
      registry.addEntity("player_2", 1000, 1000, "player", true);

      const activeChunks = registry.getActiveChunks();

      // Should have chunks near both players
      expect(activeChunks.has("0_0")).toBe(true);
      expect(activeChunks.has("15_15")).toBe(true); // 1000/64 ≈ 15
    });

    it("should cache results until player moves chunks", () => {
      registry.addEntity("player_1", 0, 0, "player", true);

      const activeChunks1 = registry.getActiveChunks();
      const activeChunks2 = registry.getActiveChunks();

      // Should return same set (cached)
      expect(activeChunks1).toBe(activeChunks2);
    });

    it("should invalidate cache when player moves to new chunk", () => {
      registry.addEntity("player_1", 32, 32, "player", true);
      // First call populates cache with chunks near (32, 32)
      registry.getActiveChunks();

      // Move player to different chunk
      registry.updateEntityPosition("player_1", 200, 200);
      const activeChunks2 = registry.getActiveChunks();

      // Cache should be invalidated, new chunks should include (3, 3)
      expect(activeChunks2.has("3_3")).toBe(true); // 200/64 ≈ 3
    });
  });

  // ===== ENTITY ACTIVE STATE TESTS =====
  describe("isEntityActive", () => {
    it("should return false when no players nearby", () => {
      registry.addEntity("mob_1", 100, 100, "mob");

      expect(registry.isEntityActive("mob_1")).toBe(false);
    });

    it("should return true when player is nearby", () => {
      registry.addEntity("mob_1", 100, 100, "mob");
      registry.addEntity("player_1", 120, 120, "player", true);

      expect(registry.isEntityActive("mob_1")).toBe(true);
    });

    it("should return false for non-existent entity", () => {
      expect(registry.isEntityActive("nonexistent")).toBe(false);
    });
  });

  // ===== ACTIVE ENTITIES TESTS =====
  describe("getActiveEntities", () => {
    it("should return empty array when no players", () => {
      registry.addEntity("mob_1", 100, 100, "mob");
      registry.addEntity("mob_2", 200, 200, "mob");

      const active = registry.getActiveEntities();
      expect(active).toHaveLength(0);
    });

    it("should return entities in active chunks", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("mob_2", 10000, 10000, "mob"); // Far away
      registry.addEntity("player_1", 50, 50, "player", true);

      const active = registry.getActiveEntities();

      expect(active).toContain("mob_1");
      expect(active).toContain("player_1");
      expect(active).not.toContain("mob_2");
    });
  });

  // ===== STATISTICS TESTS =====
  describe("getStats", () => {
    it("should return correct statistics", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("mob_2", 100, 100, "mob");
      registry.addEntity("player_1", 50, 50, "player", true);

      const stats = registry.getStats();

      expect(stats.totalEntities).toBe(3);
      expect(stats.playerCount).toBe(1);
      expect(stats.totalChunks).toBe(2); // 0_0 and 1_1
    });

    it("should calculate average entities per chunk", () => {
      // 3 entities in chunk 0_0
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("mob_2", 20, 20, "mob");
      registry.addEntity("mob_3", 30, 30, "mob");

      const stats = registry.getStats();

      expect(stats.avgEntitiesPerChunk).toBe(3);
    });

    it("should handle empty registry", () => {
      const stats = registry.getStats();

      expect(stats.totalEntities).toBe(0);
      expect(stats.playerCount).toBe(0);
      expect(stats.totalChunks).toBe(0);
      expect(stats.avgEntitiesPerChunk).toBe(0);
    });
  });

  // ===== CLEAR TESTS =====
  describe("clear", () => {
    it("should remove all entities", () => {
      registry.addEntity("mob_1", 10, 10, "mob");
      registry.addEntity("player_1", 50, 50, "player", true);

      registry.clear();

      const stats = registry.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.playerCount).toBe(0);
    });
  });

  // ===== BOUNDARY CONDITIONS =====
  describe("boundary conditions", () => {
    it("should handle entity at exact chunk boundary", () => {
      registry.addEntity("mob_1", 64, 64, "mob"); // Exact boundary

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg!.chunkKey).toBe("1_1");
    });

    it("should handle very large coordinates", () => {
      const bigCoord = 1000000;
      registry.addEntity("mob_1", bigCoord, bigCoord, "mob");

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg).toBeDefined();
      expect(reg!.x).toBe(bigCoord);
    });

    it("should handle zero radius range query", () => {
      registry.addEntity("mob_1", 0, 0, "mob");

      const results = registry.getEntitiesInRange(0, 0, 0);
      expect(results).toHaveLength(1); // Entity at exact point
    });

    it("should handle many entities in single chunk", () => {
      for (let i = 0; i < 100; i++) {
        registry.addEntity(`mob_${i}`, i % 64, i % 64, "mob");
      }

      const entities = registry.getEntitiesInChunk("0_0");
      expect(entities).toHaveLength(100);
    });

    it("should handle rapid position updates", () => {
      registry.addEntity("mob_1", 0, 0, "mob");

      for (let i = 0; i < 1000; i++) {
        registry.updateEntityPosition("mob_1", i, i);
      }

      const reg = registry.getEntityRegistration("mob_1");
      expect(reg!.x).toBe(999);
      expect(reg!.z).toBe(999);
    });
  });

  // ===== PERFORMANCE CHARACTERISTICS =====
  describe("performance characteristics", () => {
    it("should handle 1000 entities efficiently", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        registry.addEntity(
          `mob_${i}`,
          Math.random() * 10000,
          Math.random() * 10000,
          "mob",
        );
      }

      const addTime = performance.now() - start;
      expect(addTime).toBeLessThan(100); // Should be well under 100ms

      const queryStart = performance.now();
      registry.getEntitiesInRange(5000, 5000, 200);
      const queryTime = performance.now() - queryStart;

      expect(queryTime).toBeLessThan(10); // Range query should be fast
    });
  });
});
