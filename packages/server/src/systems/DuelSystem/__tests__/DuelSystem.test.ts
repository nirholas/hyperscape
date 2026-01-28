/**
 * DuelSystem Unit Tests
 *
 * Tests the complete duel state machine:
 * - Challenge creation and acceptance
 * - State transitions: RULES → STAKES → CONFIRMING → COUNTDOWN → FIGHTING → FINISHED
 * - Rule toggling and validation
 * - Equipment restriction toggling
 * - Stake operations (add/remove)
 * - Combat outcomes (death, forfeit)
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DuelSystem } from "../index";
import { createMockWorld, createDuelPlayers, type MockWorld } from "./mocks";

describe("DuelSystem", () => {
  let world: MockWorld;
  let duelSystem: DuelSystem;

  beforeEach(() => {
    vi.useFakeTimers();
    world = createMockWorld();
    const [player1, player2] = createDuelPlayers();
    world.addPlayer(player1);
    world.addPlayer(player2);
    duelSystem = new DuelSystem(world as never);
    duelSystem.init();
  });

  afterEach(() => {
    duelSystem.destroy();
    vi.useRealTimers();
  });

  // ============================================================================
  // Challenge Flow
  // ============================================================================

  describe("createChallenge", () => {
    it("creates a challenge successfully", () => {
      const result = duelSystem.createChallenge(
        "player1",
        "TestPlayer1",
        "player2",
        "TestPlayer2",
      );

      expect(result.success).toBe(true);
      expect(result.challengeId).toBeDefined();
    });

    it("rejects self-challenge", () => {
      const result = duelSystem.createChallenge(
        "player1",
        "TestPlayer1",
        "player1",
        "TestPlayer1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("can't challenge yourself");
    });

    it("rejects if challenger already in duel", () => {
      // Accept a challenge to create a duel session
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (challenge.success && challenge.challengeId) {
        duelSystem.respondToChallenge(challenge.challengeId, "player2", true);
      }

      // Try to challenge another player
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      const result = duelSystem.createChallenge(
        "player1",
        "P1",
        "player3",
        "P3",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already in a duel");
    });

    it("rejects if target already in duel", () => {
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });

      // Create a duel with player2
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      if (challenge.success && challenge.challengeId) {
        duelSystem.respondToChallenge(challenge.challengeId, "player2", true);
      }

      // Try to challenge player2 from player3
      const result = duelSystem.createChallenge(
        "player3",
        "P3",
        "player2",
        "P2",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already in a duel");
    });
  });

  describe("respondToChallenge", () => {
    it("accepts challenge and creates duel session", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      expect(challenge.success).toBe(true);

      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );

      expect(response.success).toBe(true);
      expect(response.duelId).toBeDefined();
    });

    it("declines challenge", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );

      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        false,
      );

      expect(response.success).toBe(true);
      expect(response.duelId).toBeUndefined();
    });

    it("returns error for non-existent challenge", () => {
      const response = duelSystem.respondToChallenge(
        "nonexistent",
        "player2",
        true,
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain("not found");
    });
  });

  // ============================================================================
  // Duel Session Queries
  // ============================================================================

  describe("getDuelSession", () => {
    it("returns session by ID", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );

      const session = duelSystem.getDuelSession(response.duelId!);

      expect(session).toBeDefined();
      expect(session!.duelId).toBe(response.duelId);
      expect(session!.state).toBe("RULES");
    });

    it("returns undefined for non-existent session", () => {
      const session = duelSystem.getDuelSession("nonexistent");
      expect(session).toBeUndefined();
    });
  });

  describe("getPlayerDuel", () => {
    it("returns session for player in duel", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      duelSystem.respondToChallenge(challenge.challengeId!, "player2", true);

      const session = duelSystem.getPlayerDuel("player1");

      expect(session).toBeDefined();
      expect(session!.challengerId).toBe("player1");
    });

    it("returns undefined for player not in duel", () => {
      const session = duelSystem.getPlayerDuel("player1");
      expect(session).toBeUndefined();
    });
  });

  describe("isPlayerInDuel", () => {
    it("returns true when player is in duel", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      duelSystem.respondToChallenge(challenge.challengeId!, "player2", true);

      expect(duelSystem.isPlayerInDuel("player1")).toBe(true);
      expect(duelSystem.isPlayerInDuel("player2")).toBe(true);
    });

    it("returns false when player is not in duel", () => {
      expect(duelSystem.isPlayerInDuel("player1")).toBe(false);
    });
  });

  // ============================================================================
  // State Machine: RULES
  // ============================================================================

  describe("toggleRule", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;
    });

    it("toggles a rule successfully", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      const initialValue = session.rules.noRanged;

      const result = duelSystem.toggleRule(duelId, "player1", "noRanged");

      expect(result.success).toBe(true);
      expect(session.rules.noRanged).toBe(!initialValue);
    });

    it("resets acceptance when rule changes", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      // Manually set acceptance to simulate player having accepted
      session.challengerAccepted = true;

      duelSystem.toggleRule(duelId, "player1", "noRanged");

      expect(session.challengerAccepted).toBe(false);
      expect(session.targetAccepted).toBe(false);
    });

    it("rejects invalid rule combination (noForfeit + noMovement)", () => {
      // Enable noForfeit
      duelSystem.toggleRule(duelId, "player1", "noForfeit");

      // Try to also enable noMovement (invalid combination)
      const result = duelSystem.toggleRule(duelId, "player1", "noMovement");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("No Forfeit");
    });

    it("rejects toggle when not in RULES state", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      session.state = "STAKES"; // Manually change state

      const result = duelSystem.toggleRule(duelId, "player1", "noRanged");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot modify rules");
    });

    it("rejects toggle from non-participant", () => {
      const result = duelSystem.toggleRule(duelId, "player3", "noRanged");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not in this duel");
    });
  });

  describe("toggleEquipmentRestriction", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;
    });

    it("toggles equipment restriction successfully", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      const initialValue = session.equipmentRestrictions.weapon;

      const result = duelSystem.toggleEquipmentRestriction(
        duelId,
        "player1",
        "weapon",
      );

      expect(result.success).toBe(true);
      expect(session.equipmentRestrictions.weapon).toBe(!initialValue);
    });

    it("resets acceptance when equipment restriction changes", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      session.challengerAccepted = true;

      duelSystem.toggleEquipmentRestriction(duelId, "player1", "head");

      expect(session.challengerAccepted).toBe(false);
      expect(session.targetAccepted).toBe(false);
    });
  });

  describe("acceptRules", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;
    });

    it("accepts rules for one player", () => {
      const result = duelSystem.acceptRules(duelId, "player1");
      const session = duelSystem.getDuelSession(duelId)!;

      expect(result.success).toBe(true);
      expect(session.challengerAccepted).toBe(true);
      expect(session.targetAccepted).toBe(false);
      expect(session.state).toBe("RULES"); // Still in RULES
    });

    it("transitions to STAKES when both accept", () => {
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");

      const session = duelSystem.getDuelSession(duelId)!;

      expect(session.state).toBe("STAKES");
      expect(session.challengerAccepted).toBe(false); // Reset for next screen
      expect(session.targetAccepted).toBe(false);
    });
  });

  // ============================================================================
  // State Machine: STAKES
  // ============================================================================

  describe("addStake", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      // Move to STAKES state
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
    });

    it("adds stake successfully", () => {
      const result = duelSystem.addStake(
        duelId,
        "player1",
        0,
        "bronze_sword",
        1,
        100,
      );

      expect(result.success).toBe(true);

      const session = duelSystem.getDuelSession(duelId)!;
      expect(session.challengerStakes).toHaveLength(1);
      expect(session.challengerStakes[0].itemId).toBe("bronze_sword");
    });

    it("resets acceptance when stake added", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      session.challengerAccepted = true;

      duelSystem.addStake(duelId, "player1", 0, "bronze_sword", 1, 100);

      expect(session.challengerAccepted).toBe(false);
    });

    it("rejects duplicate inventory slot", () => {
      duelSystem.addStake(duelId, "player1", 0, "bronze_sword", 1, 100);
      const result = duelSystem.addStake(
        duelId,
        "player1",
        0,
        "iron_sword",
        1,
        200,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already staked");
    });

    it("rejects stake when not in STAKES state", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      session.state = "CONFIRMING";

      const result = duelSystem.addStake(
        duelId,
        "player1",
        0,
        "bronze_sword",
        1,
        100,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot modify stakes");
    });
  });

  describe("removeStake", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");

      // Add a stake to remove
      duelSystem.addStake(duelId, "player1", 0, "bronze_sword", 1, 100);
    });

    it("removes stake successfully", () => {
      const result = duelSystem.removeStake(duelId, "player1", 0);

      expect(result.success).toBe(true);

      const session = duelSystem.getDuelSession(duelId)!;
      expect(session.challengerStakes).toHaveLength(0);
    });

    it("resets acceptance when stake removed", () => {
      const session = duelSystem.getDuelSession(duelId)!;
      session.challengerAccepted = true;

      duelSystem.removeStake(duelId, "player1", 0);

      expect(session.challengerAccepted).toBe(false);
    });

    it("rejects invalid stake index", () => {
      const result = duelSystem.removeStake(duelId, "player1", 99);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid stake index");
    });
  });

  describe("acceptStakes", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
    });

    it("transitions to CONFIRMING when both accept", () => {
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");

      const session = duelSystem.getDuelSession(duelId)!;

      expect(session.state).toBe("CONFIRMING");
    });
  });

  // ============================================================================
  // State Machine: CONFIRMING → COUNTDOWN
  // ============================================================================

  describe("acceptFinal", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      // Progress through screens
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
    });

    it("transitions to COUNTDOWN when both accept", () => {
      duelSystem.acceptFinal(duelId, "player1");
      const result = duelSystem.acceptFinal(duelId, "player2");

      expect(result.success).toBe(true);
      expect(result.arenaId).toBeDefined();

      const session = duelSystem.getDuelSession(duelId)!;
      expect(session.state).toBe("COUNTDOWN");
      expect(session.arenaId).toBe(result.arenaId);
    });

    it("reserves arena on confirmation", () => {
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      const session = duelSystem.getDuelSession(duelId)!;
      expect(duelSystem.arenaPool.isArenaAvailable(session.arenaId!)).toBe(
        false,
      );
    });
  });

  // ============================================================================
  // State Machine: COUNTDOWN → FIGHTING
  // ============================================================================

  describe("processTick - countdown", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      // Progress to COUNTDOWN
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");
    });

    it("transitions to FIGHTING after countdown completes", () => {
      // Advance time past countdown (3 seconds)
      vi.advanceTimersByTime(3500);
      duelSystem.processTick();

      const session = duelSystem.getDuelSession(duelId)!;
      expect(session.state).toBe("FIGHTING");
    });

    it("emits countdown ticks", () => {
      // Process tick at each second
      vi.advanceTimersByTime(1000);
      duelSystem.processTick();

      expect(world._emit).toHaveBeenCalledWith(
        "duel:countdown:tick",
        expect.objectContaining({ count: 2 }),
      );

      vi.advanceTimersByTime(1000);
      duelSystem.processTick();

      expect(world._emit).toHaveBeenCalledWith(
        "duel:countdown:tick",
        expect.objectContaining({ count: 1 }),
      );
    });
  });

  // ============================================================================
  // State Machine: FIGHTING → FINISHED
  // ============================================================================

  describe("forfeitDuel", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      // Progress to FIGHTING
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      vi.advanceTimersByTime(3500);
      duelSystem.processTick();
    });

    it("allows forfeit during FIGHTING", () => {
      const result = duelSystem.forfeitDuel("player1");

      expect(result.success).toBe(true);

      // Session should be cleaned up
      expect(duelSystem.getDuelSession(duelId)).toBeUndefined();
      expect(duelSystem.isPlayerInDuel("player1")).toBe(false);
    });

    it("rejects forfeit when noForfeit rule is active", () => {
      // Need to set up a new duel with noForfeit rule
      const session = duelSystem.getDuelSession(duelId)!;
      session.rules.noForfeit = true;

      const result = duelSystem.forfeitDuel("player1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot forfeit");
    });

    it("declares opponent as winner", () => {
      duelSystem.forfeitDuel("player1");

      expect(world._emit).toHaveBeenCalledWith(
        "duel:completed",
        expect.objectContaining({
          winnerId: "player2",
          loserId: "player1",
          reason: "forfeit",
        }),
      );
    });
  });

  // ============================================================================
  // Cancel Duel
  // ============================================================================

  describe("cancelDuel", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;
    });

    it("cancels duel and cleans up", () => {
      const result = duelSystem.cancelDuel(duelId, "player_cancelled");

      expect(result.success).toBe(true);
      expect(duelSystem.getDuelSession(duelId)).toBeUndefined();
      expect(duelSystem.isPlayerInDuel("player1")).toBe(false);
      expect(duelSystem.isPlayerInDuel("player2")).toBe(false);
    });

    it("emits cancel event", () => {
      duelSystem.cancelDuel(duelId, "player_cancelled", "player1");

      expect(world._emit).toHaveBeenCalledWith(
        "duel:cancelled",
        expect.objectContaining({
          duelId,
          reason: "player_cancelled",
          cancelledBy: "player1",
        }),
      );
    });

    it("returns stakes on cancel", () => {
      // Add stakes
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.addStake(duelId, "player1", 0, "bronze_sword", 1, 100);

      duelSystem.cancelDuel(duelId, "player_cancelled");

      expect(world._emit).toHaveBeenCalledWith(
        "duel:stakes:return",
        expect.objectContaining({
          playerId: "player1",
        }),
      );
    });

    it("releases arena on cancel", () => {
      // Progress to COUNTDOWN to reserve arena
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      const session = duelSystem.getDuelSession(duelId)!;
      const arenaId = session.arenaId!;

      duelSystem.cancelDuel(duelId, "player_cancelled");

      expect(duelSystem.arenaPool.isArenaAvailable(arenaId)).toBe(true);
    });
  });

  // ============================================================================
  // Rule Enforcement API
  // ============================================================================

  describe("rule enforcement", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;

      // Enable some rules
      duelSystem.toggleRule(duelId, "player1", "noRanged");
      duelSystem.toggleRule(duelId, "player1", "noFood");

      // Progress to FIGHTING
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      vi.advanceTimersByTime(3500);
      duelSystem.processTick();
    });

    it("isPlayerInActiveDuel returns true during FIGHTING", () => {
      expect(duelSystem.isPlayerInActiveDuel("player1")).toBe(true);
    });

    it("canUseRanged returns false when noRanged is active", () => {
      expect(duelSystem.canUseRanged("player1")).toBe(false);
    });

    it("canUseMelee returns true when noMelee is not active", () => {
      expect(duelSystem.canUseMelee("player1")).toBe(true);
    });

    it("canEatFood returns false when noFood is active", () => {
      expect(duelSystem.canEatFood("player1")).toBe(false);
    });

    it("canMove returns false during COUNTDOWN", () => {
      // Create a new duel and progress to countdown
      world.addPlayer({ id: "player3", position: { x: 70, y: 0, z: 70 } });
      world.addPlayer({ id: "player4", position: { x: 72, y: 0, z: 70 } });

      const challenge2 = duelSystem.createChallenge(
        "player3",
        "P3",
        "player4",
        "P4",
      );
      duelSystem.respondToChallenge(challenge2.challengeId!, "player4", true);

      const session = duelSystem.getPlayerDuel("player3")!;
      session.state = "COUNTDOWN";

      expect(duelSystem.canMove("player3")).toBe(false);
    });

    it("getDuelOpponentId returns correct opponent", () => {
      expect(duelSystem.getDuelOpponentId("player1")).toBe("player2");
      expect(duelSystem.getDuelOpponentId("player2")).toBe("player1");
    });
  });

  // ============================================================================
  // Player Disconnect Handling
  // ============================================================================

  describe("onPlayerDisconnect", () => {
    let duelId: string;

    beforeEach(() => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      duelId = response.duelId!;
    });

    it("cancels duel when player disconnects during setup", () => {
      duelSystem.onPlayerDisconnect("player1");

      expect(duelSystem.getDuelSession(duelId)).toBeUndefined();
      expect(world._emit).toHaveBeenCalledWith(
        "duel:cancelled",
        expect.objectContaining({
          reason: "player_disconnected",
        }),
      );
    });

    it("starts disconnect timer during FIGHTING", () => {
      // Progress to FIGHTING
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      vi.advanceTimersByTime(3500);
      duelSystem.processTick();

      duelSystem.onPlayerDisconnect("player1");

      // Session should still exist
      expect(duelSystem.getDuelSession(duelId)).toBeDefined();

      // Event should be emitted
      expect(world._emit).toHaveBeenCalledWith(
        "duel:player:disconnected",
        expect.objectContaining({
          playerId: "player1",
          timeoutMs: 30000,
        }),
      );
    });

    it("auto-forfeits after disconnect timeout", () => {
      // Progress to FIGHTING
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      vi.advanceTimersByTime(3500);
      duelSystem.processTick();

      duelSystem.onPlayerDisconnect("player1");

      // Advance past disconnect timeout (30 seconds)
      vi.advanceTimersByTime(31000);

      // Session should be resolved
      expect(world._emit).toHaveBeenCalledWith(
        "duel:completed",
        expect.objectContaining({
          winnerId: "player2",
          loserId: "player1",
        }),
      );
    });
  });

  describe("onPlayerReconnect", () => {
    it("clears disconnect timer on reconnect", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      const duelId = response.duelId!;

      // Progress to FIGHTING
      duelSystem.acceptRules(duelId, "player1");
      duelSystem.acceptRules(duelId, "player2");
      duelSystem.acceptStakes(duelId, "player1");
      duelSystem.acceptStakes(duelId, "player2");
      duelSystem.acceptFinal(duelId, "player1");
      duelSystem.acceptFinal(duelId, "player2");

      vi.advanceTimersByTime(3500);
      duelSystem.processTick();

      // Disconnect then reconnect
      duelSystem.onPlayerDisconnect("player1");
      duelSystem.onPlayerReconnect("player1");

      // Advance past what would be the timeout
      vi.advanceTimersByTime(35000);

      // Session should still be active (not auto-forfeited)
      expect(duelSystem.getDuelSession(duelId)).toBeDefined();
      expect(duelSystem.getDuelSession(duelId)!.state).toBe("FIGHTING");
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe("destroy", () => {
    it("cancels all active duels", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      duelSystem.respondToChallenge(challenge.challengeId!, "player2", true);

      duelSystem.destroy();

      expect(duelSystem.isPlayerInDuel("player1")).toBe(false);
      expect(duelSystem.isPlayerInDuel("player2")).toBe(false);
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("cancels sessions stuck in setup for too long", () => {
      const challenge = duelSystem.createChallenge(
        "player1",
        "P1",
        "player2",
        "P2",
      );
      const response = duelSystem.respondToChallenge(
        challenge.challengeId!,
        "player2",
        true,
      );
      const duelId = response.duelId!;

      // Advance time past max session age (30 minutes)
      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(duelSystem.getDuelSession(duelId)).toBeUndefined();
    });
  });
});
