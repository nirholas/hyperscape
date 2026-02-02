/**
 * PendingDuelManager Unit Tests
 *
 * Tests the pending duel challenge system:
 * - Challenge creation and validation
 * - Challenge acceptance and decline
 * - Challenge expiration
 * - Distance-based cancellation
 * - Player disconnect cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PendingDuelManager } from "../PendingDuelManager";
import { createMockWorld, createDuelPlayers, type MockWorld } from "./mocks";
import { createPlayerID } from "@hyperscape/shared";

// Helper to create a challenge with proper branded types
function createTestChallenge(
  manager: PendingDuelManager,
  challengerId: string,
  challengerName: string,
  targetId: string,
  targetName: string,
  combatLevel: number = 100,
) {
  return manager.createChallenge(
    createPlayerID(challengerId),
    challengerName,
    `socket-${challengerId}`, // challengerSocketId
    combatLevel,
    createPlayerID(targetId),
    targetName,
  );
}

describe("PendingDuelManager", () => {
  let world: MockWorld;
  let manager: PendingDuelManager;

  beforeEach(() => {
    vi.useFakeTimers();
    world = createMockWorld();
    const [player1, player2] = createDuelPlayers();
    world.addPlayer(player1);
    world.addPlayer(player2);
    manager = new PendingDuelManager(world as never);
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe("createChallenge", () => {
    it("creates a challenge between two players", () => {
      const result = createTestChallenge(
        manager,
        "player1",
        "TestPlayer1",
        "player2",
        "TestPlayer2",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.challengeId).toBeDefined();
        expect(result.challengeId).toContain("duel_");
      }
    });

    it("stores challenge data correctly", () => {
      const result = createTestChallenge(
        manager,
        "player1",
        "TestPlayer1",
        "player2",
        "TestPlayer2",
      );

      if (result.success) {
        const challenge = manager.getChallenge(result.challengeId);
        expect(challenge).toBeDefined();
        expect(challenge!.challengerId).toBe("player1");
        expect(challenge!.challengerName).toBe("TestPlayer1");
        expect(challenge!.targetId).toBe("player2");
        expect(challenge!.targetName).toBe("TestPlayer2");
        expect(challenge!.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it("rejects if challenger already has pending challenge", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      const result = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player3",
        "P3",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("already have a pending challenge");
      }
    });

    it("rejects if challenger is being challenged", () => {
      createTestChallenge(manager, "player2", "P2", "player1", "P1");

      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      const result = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player3",
        "P3",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("pending challenge to respond to");
      }
    });

    it("rejects if target already has outgoing challenge", () => {
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      createTestChallenge(manager, "player2", "P2", "player3", "P3");

      const result = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("already has a pending challenge");
      }
    });

    it("rejects if target is being challenged", () => {
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      createTestChallenge(manager, "player3", "P3", "player2", "P2");

      const result = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("already being challenged");
      }
    });
  });

  describe("getChallenge", () => {
    it("returns challenge by ID", () => {
      const result = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (result.success) {
        const challenge = manager.getChallenge(result.challengeId);
        expect(challenge).toBeDefined();
        expect(challenge!.challengeId).toBe(result.challengeId);
      }
    });

    it("returns undefined for non-existent challenge", () => {
      const challenge = manager.getChallenge("nonexistent");
      expect(challenge).toBeUndefined();
    });
  });

  describe("getChallengeAsChallenger", () => {
    it("returns challenge where player is challenger", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const challenge = manager.getChallengeAsChallenger("player1");
      expect(challenge).toBeDefined();
      expect(challenge!.challengerId).toBe("player1");
    });

    it("returns undefined if player is not challenger", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const challenge = manager.getChallengeAsChallenger("player2");
      expect(challenge).toBeUndefined();
    });
  });

  describe("getChallengeAsTarget", () => {
    it("returns challenge where player is target", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const challenge = manager.getChallengeAsTarget("player2");
      expect(challenge).toBeDefined();
      expect(challenge!.targetId).toBe("player2");
    });

    it("returns undefined if player is not target", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const challenge = manager.getChallengeAsTarget("player1");
      expect(challenge).toBeUndefined();
    });
  });

  describe("hasAnyChallenge", () => {
    it("returns true for challenger", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.hasAnyChallenge("player1")).toBe(true);
    });

    it("returns true for target", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.hasAnyChallenge("player2")).toBe(true);
    });

    it("returns false for uninvolved player", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.hasAnyChallenge("player3")).toBe(false);
    });
  });

  describe("acceptChallenge", () => {
    it("accepts and returns challenge when target accepts", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      const challenge = manager.acceptChallenge(
        createResult.challengeId,
        "player2",
      );

      expect(challenge).toBeDefined();
      expect(challenge!.challengerId).toBe("player1");
      expect(challenge!.targetId).toBe("player2");
    });

    it("removes challenge from pending after acceptance", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      manager.acceptChallenge(createResult.challengeId, "player2");

      expect(manager.getChallenge(createResult.challengeId)).toBeUndefined();
      expect(manager.hasAnyChallenge("player1")).toBe(false);
      expect(manager.hasAnyChallenge("player2")).toBe(false);
    });

    it("rejects if non-target tries to accept", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      const challenge = manager.acceptChallenge(
        createResult.challengeId,
        "player1", // Challenger, not target
      );

      expect(challenge).toBeUndefined();
      // Challenge should still exist
      expect(manager.getChallenge(createResult.challengeId)).toBeDefined();
    });

    it("rejects if challenge is expired", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      // Advance time past expiration (30 seconds)
      vi.advanceTimersByTime(31_000);

      const challenge = manager.acceptChallenge(
        createResult.challengeId,
        "player2",
      );

      expect(challenge).toBeUndefined();
    });

    it("returns undefined for non-existent challenge", () => {
      const challenge = manager.acceptChallenge("nonexistent", "player2");
      expect(challenge).toBeUndefined();
    });
  });

  describe("declineChallenge", () => {
    it("removes challenge when target declines", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      const declined = manager.declineChallenge(
        createResult.challengeId,
        "player2",
      );

      expect(declined).toBeDefined();
      expect(manager.getChallenge(createResult.challengeId)).toBeUndefined();
    });

    it("returns undefined if non-target tries to decline", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      const declined = manager.declineChallenge(
        createResult.challengeId,
        "player1",
      );

      expect(declined).toBeUndefined();
      // Challenge should still exist
      expect(manager.getChallenge(createResult.challengeId)).toBeDefined();
    });
  });

  describe("cancelChallenge", () => {
    it("cancels and returns challenge by ID", () => {
      const createResult = createTestChallenge(
        manager,
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (!createResult.success) throw new Error("Failed to create challenge");

      const cancelled = manager.cancelChallenge(createResult.challengeId);

      expect(cancelled).toBeDefined();
      expect(cancelled!.challengeId).toBe(createResult.challengeId);
      expect(manager.getChallenge(createResult.challengeId)).toBeUndefined();
    });

    it("returns undefined for non-existent challenge", () => {
      const cancelled = manager.cancelChallenge("nonexistent");
      expect(cancelled).toBeUndefined();
    });
  });

  describe("cancelPlayerChallenges", () => {
    it("cancels challenge where player is challenger", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const cancelled = manager.cancelPlayerChallenges("player1");

      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].challengerId).toBe("player1");
      expect(manager.size).toBe(0);
    });

    it("cancels challenge where player is target", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const cancelled = manager.cancelPlayerChallenges("player2");

      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].targetId).toBe("player2");
      expect(manager.size).toBe(0);
    });

    it("returns empty array for uninvolved player", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      const cancelled = manager.cancelPlayerChallenges("player3");

      expect(cancelled).toHaveLength(0);
      expect(manager.size).toBe(1);
    });
  });

  describe("processTick - distance check", () => {
    it("cancels challenge when players are too far apart", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      // Move player2 far away (> 15 tiles)
      world.setPlayerPosition("player2", 100, 0, 100);

      manager.processTick();

      expect(manager.size).toBe(0);
      expect(world._emit).toHaveBeenCalledWith(
        "duel:challenge:cancelled",
        expect.objectContaining({ reason: "too_far" }),
      );
    });

    it("keeps challenge when players are within range", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      // Move player2 but stay within 15 tiles
      world.setPlayerPosition("player2", 80, 0, 70);

      manager.processTick();

      expect(manager.size).toBe(1);
    });

    it("cancels challenge when player disconnects", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");

      // Remove player2 (disconnect)
      world.removePlayer("player2");

      manager.processTick();

      expect(manager.size).toBe(0);
      expect(world._emit).toHaveBeenCalledWith(
        "duel:challenge:cancelled",
        expect.objectContaining({ reason: "player_disconnected" }),
      );
    });
  });

  describe("expiration cleanup", () => {
    it("removes expired challenges after cleanup interval", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.size).toBe(1);

      // Advance time past expiration (30 seconds) + cleanup interval (5 seconds)
      vi.advanceTimersByTime(36_000);

      expect(manager.size).toBe(0);
      expect(world._emit).toHaveBeenCalledWith(
        "duel:challenge:expired",
        expect.objectContaining({
          challengerId: "player1",
          targetId: "player2",
        }),
      );
    });
  });

  describe("size", () => {
    it("returns 0 when empty", () => {
      expect(manager.size).toBe(0);
    });

    it("returns correct count", () => {
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      world.addPlayer({ id: "player4", position: { x: 70, y: 0, z: 70 } });

      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.size).toBe(1);

      createTestChallenge(manager, "player3", "P3", "player4", "P4");
      expect(manager.size).toBe(2);
    });
  });

  describe("destroy", () => {
    it("clears all challenges", () => {
      createTestChallenge(manager, "player1", "P1", "player2", "P2");
      expect(manager.size).toBe(1);

      manager.destroy();

      expect(manager.size).toBe(0);
    });

    it("stops cleanup interval", () => {
      manager.destroy();

      // This should not throw or cause issues
      vi.advanceTimersByTime(60_000);
    });
  });
});
