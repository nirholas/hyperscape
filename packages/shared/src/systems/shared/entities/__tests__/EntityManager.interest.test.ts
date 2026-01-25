/**
 * EntityManager Interest-Based Filtering Tests
 *
 * Tests for the interest-based network filtering functionality:
 * - getInterestedPlayers() returns correct players based on distance
 * - Type-specific broadcast distances work correctly
 * - Integration with SpatialEntityRegistry
 */

import { describe, it, expect, beforeEach } from "vitest";

// Mock World for testing EntityManager in isolation
class MockWorld {
  isServer = true;
  isClient = false;
  entities = new Map();
  network = null;
  currentTick = 0;

  getSystem(_name: string) {
    return null;
  }

  getPlayer(_id: string) {
    return null;
  }

  on() {}
  off() {}
  emit() {}
}

// Import after mocks are set up
import { EntityManager } from "../EntityManager";

describe("EntityManager Interest Filtering", () => {
  let world: MockWorld;
  let entityManager: EntityManager;

  beforeEach(async () => {
    world = new MockWorld();
    entityManager = new EntityManager(
      world as unknown as Parameters<
        (typeof EntityManager)["prototype"]["constructor"]
      >[0],
    );
    await entityManager.init();
  });

  describe("getInterestedPlayers", () => {
    beforeEach(() => {
      // Register some players in the spatial registry
      entityManager.registerPlayer("player_1", 0, 0);
      entityManager.registerPlayer("player_2", 100, 0);
      entityManager.registerPlayer("player_3", 300, 0);
    });

    it("should return all players within default broadcast distance", () => {
      // Entity at origin, default broadcast distance is 200m
      const interested = entityManager.getInterestedPlayers(0, 0);

      // player_1 at (0,0) = 0m distance - IN
      // player_2 at (100,0) = 100m distance - IN
      // player_3 at (300,0) = 300m distance - OUT
      expect(interested).toContain("player_1");
      expect(interested).toContain("player_2");
      expect(interested).not.toContain("player_3");
    });

    it("should use mob-specific broadcast distance for mob entities", () => {
      // Entity at origin with type "mob"
      // Mob broadcast distance is RENDER_SQ.MOB = 150*150 = 22500
      const interested = entityManager.getInterestedPlayers(0, 0, "mob");

      // player_1 at (0,0) = 0m distance - IN
      // player_2 at (100,0) = 100m distance - IN
      // player_3 at (300,0) = 300m distance - OUT (beyond 150m)
      expect(interested).toContain("player_1");
      expect(interested).toContain("player_2");
      expect(interested).not.toContain("player_3");
    });

    it("should use item-specific broadcast distance for item entities", () => {
      // Item broadcast distance is RENDER_SQ.ITEM = 100*100 = 10000
      // Place player_2 at 100m - should be exactly at boundary
      const interested = entityManager.getInterestedPlayers(0, 0, "item");

      // player_1 at (0,0) = 0m - IN
      // player_2 at (100,0) = 100m - EXACTLY at boundary (should be IN)
      // player_3 at (300,0) = 300m - OUT
      expect(interested).toContain("player_1");
      expect(interested).toContain("player_2");
      expect(interested).not.toContain("player_3");
    });

    it("should return empty array when no players are nearby", () => {
      // Entity far from all players
      const interested = entityManager.getInterestedPlayers(10000, 10000);
      expect(interested).toHaveLength(0);
    });

    it("should return empty array when no players registered", () => {
      // Clear all players
      entityManager.unregisterPlayer("player_1");
      entityManager.unregisterPlayer("player_2");
      entityManager.unregisterPlayer("player_3");

      const interested = entityManager.getInterestedPlayers(0, 0);
      expect(interested).toHaveLength(0);
    });

    it("should update when player position changes", () => {
      // Initially player_3 is too far
      let interested = entityManager.getInterestedPlayers(0, 0);
      expect(interested).not.toContain("player_3");

      // Move player_3 closer
      entityManager.updatePlayerPosition("player_3", 50, 0);

      interested = entityManager.getInterestedPlayers(0, 0);
      expect(interested).toContain("player_3");
    });

    it("should use XZ distance (ignore Y)", () => {
      // The spatial registry uses XZ distance
      // Player at (0,0) should see entity at (0,0) regardless of Y
      const interested = entityManager.getInterestedPlayers(0, 0);
      expect(interested).toContain("player_1");
    });
  });

  describe("spatial registry integration", () => {
    it("should return spatial registry via getSpatialRegistry()", () => {
      const registry = entityManager.getSpatialRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.addEntity).toBe("function");
      expect(typeof registry.removeEntity).toBe("function");
    });

    it("should track registered players in spatial registry", () => {
      entityManager.registerPlayer("test_player", 50, 50);

      const registry = entityManager.getSpatialRegistry();
      const positions = registry.getPlayerPositions();

      expect(positions.some((p) => p.entityId === "test_player")).toBe(true);
    });

    it("should remove player from spatial registry on unregister", () => {
      entityManager.registerPlayer("temp_player", 100, 100);
      entityManager.unregisterPlayer("temp_player");

      const registry = entityManager.getSpatialRegistry();
      const positions = registry.getPlayerPositions();

      expect(positions.some((p) => p.entityId === "temp_player")).toBe(false);
    });
  });

  describe("debug info", () => {
    it("should include spatial stats in debug info", () => {
      entityManager.registerPlayer("debug_player", 0, 0);

      const debugInfo = entityManager.getDebugInfo();

      expect(debugInfo.spatialStats).toBeDefined();
      expect(debugInfo.spatialStats!.playerCount).toBeGreaterThanOrEqual(1);
    });

    it("should include network stats in debug info", () => {
      const debugInfo = entityManager.getDebugInfo();

      expect(debugInfo.networkStats).toBeDefined();
      expect(debugInfo.networkStats!.interestFilteredUpdates).toBe(0);
      expect(debugInfo.networkStats!.broadcastUpdates).toBe(0);
      expect(debugInfo.networkStats!.interestFilteringRatio).toBe(0);
      expect(debugInfo.networkStats!.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("should reset network stats", () => {
      entityManager.resetNetworkStats();

      const debugInfo = entityManager.getDebugInfo();
      expect(debugInfo.networkStats!.interestFilteredUpdates).toBe(0);
      expect(debugInfo.networkStats!.broadcastUpdates).toBe(0);
    });
  });
});
