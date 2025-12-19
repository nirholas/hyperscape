/**
 * CombatReplayService Unit Tests
 *
 * Tests for combat event recording and replay functionality:
 * - Event recording in CombatSystem
 * - Event retrieval and parsing
 * - Combat timeline generation
 * - Investigation reports
 * - Suspicious event detection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventStore, GameEventType } from "../../EventStore";
import { CombatReplayService } from "../CombatReplayService";

describe("CombatReplayService", () => {
  let eventStore: EventStore;
  let replayService: CombatReplayService;

  beforeEach(() => {
    eventStore = new EventStore({
      snapshotInterval: 10,
      maxEvents: 1000,
      maxSnapshots: 5,
    });
    replayService = new CombatReplayService(eventStore);
  });

  describe("event parsing", () => {
    it("retrieves and parses entity events", () => {
      // Record some combat events
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {
            targetId: "mob1",
            attackerType: "player",
            targetType: "mob",
          },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: {
            targetId: "mob1",
            damage: 15,
            rawDamage: 15,
            rngState: { state0: "abc123", state1: "def456" },
          },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      const events = replayService.getEntityEvents("player1", 90, 110);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe(GameEventType.COMBAT_START);
      expect(events[0].targetId).toBe("mob1");
      expect(events[1].type).toBe(GameEventType.COMBAT_DAMAGE);
      expect(events[1].damage).toBe(15);
      expect(events[1].rngState).toEqual({
        state0: "abc123",
        state1: "def456",
      });
    });
  });

  describe("combat timeline", () => {
    it("generates timeline for a combat session", () => {
      // Record a complete combat session
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {
            targetId: "mob1",
            attackerType: "player",
            targetType: "mob",
          },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 10 },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 106,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "mob1",
          payload: { targetId: "player1", damage: 5 },
        },
        { currentTick: 106, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 108,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 20 },
        },
        { currentTick: 108, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 108,
          type: GameEventType.DEATH_MOB,
          entityId: "mob1",
          payload: { killedBy: "player1" },
        },
        { currentTick: 108, playerCount: 1, activeCombats: 0 },
      );

      const timeline = replayService.getCombatTimeline("player1", "mob1", 105);

      expect(timeline).not.toBeNull();
      expect(timeline!.attackerId).toBe("player1");
      expect(timeline!.targetId).toBe("mob1");
      expect(timeline!.startTick).toBe(100);
      expect(timeline!.endTick).toBe(108);
      expect(timeline!.totalDamageDealt).toBe(30); // 10 + 20
      expect(timeline!.totalDamageTaken).toBe(5);
      expect(timeline!.hitCount).toBe(2);
    });

    it("returns null for non-existent combat", () => {
      const timeline = replayService.getCombatTimeline("player1", "mob1", 100);
      expect(timeline).toBeNull();
    });
  });

  describe("investigation report", () => {
    it("generates comprehensive investigation report", () => {
      // Record multiple combat sessions
      // Session 1
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 15 },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 108,
          type: GameEventType.COMBAT_MISS,
          entityId: "player1",
          payload: { targetId: "mob1", rawDamage: 0 },
        },
        { currentTick: 108, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 112,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 25 },
        },
        { currentTick: 112, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 112,
          type: GameEventType.COMBAT_END,
          entityId: "player1",
          payload: { targetId: "mob1", reason: "target_died" },
        },
        { currentTick: 112, playerCount: 1, activeCombats: 0 },
      );

      // Session 2
      eventStore.record(
        {
          tick: 200,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob2" },
        },
        { currentTick: 200, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 204,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob2", damage: 10 },
        },
        { currentTick: 204, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 204,
          type: GameEventType.COMBAT_END,
          entityId: "player1",
          payload: { targetId: "mob2", reason: "target_died" },
        },
        { currentTick: 204, playerCount: 1, activeCombats: 0 },
      );

      const report = replayService.investigateEntity("player1", 0, 300);

      expect(report.entityId).toBe("player1");
      expect(report.combatSessions).toHaveLength(2);
      expect(report.totalDamageDealt).toBe(50); // 15 + 25 + 10
      expect(report.maxDamageDealt).toBe(25);
      expect(report.averageDamagePerHit).toBeCloseTo(16.67, 1); // 50/3
    });

    it("detects suspicious high damage events", () => {
      replayService.configure({ maxExpectedDamage: 50 });

      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 75 }, // Suspicious!
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_END,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 0 },
      );

      const report = replayService.investigateEntity("player1", 0, 200);

      expect(report.suspiciousEvents).toHaveLength(1);
      expect(report.suspiciousEvents[0].reason).toContain(
        "exceeds max expected",
      );
      expect(report.suspiciousEvents[0].event.damage).toBe(75);
    });
  });

  describe("event sequence verification", () => {
    it("validates correct event sequence", () => {
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 10 },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 108,
          type: GameEventType.COMBAT_END,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 108, playerCount: 1, activeCombats: 0 },
      );

      const result = replayService.verifyEventSequence(90, 120);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects duplicate COMBAT_START without end", () => {
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_START, // Another start without ending first!
          entityId: "player1",
          payload: { targetId: "mob2" },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 2 },
      );

      const result = replayService.verifyEventSequence(90, 120);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("while already in combat");
    });

    it("detects COMBAT_END without start", () => {
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_END, // End without start!
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 0 },
      );

      const result = replayService.verifyEventSequence(90, 120);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("while not in combat");
    });
  });

  describe("replay from snapshot", () => {
    it("replays events from nearest snapshot", () => {
      // Record events with a snapshot
      eventStore.record(
        {
          tick: 10, // Snapshot interval = 10
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 10, playerCount: 1, activeCombats: 1 },
        {
          entities: new Map(),
          combatStates: new Map(),
          rngState: { state0: "abc", state1: "def" },
        },
      );

      eventStore.record(
        {
          tick: 14,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 15 },
        },
        { currentTick: 14, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 18,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 20 },
        },
        { currentTick: 18, playerCount: 1, activeCombats: 1 },
      );

      const result = replayService.replayFromSnapshot(18);

      expect(result.success).toBe(true);
      expect(result.startTick).toBe(10);
      expect(result.endTick).toBe(18);
      expect(result.eventsReplayed).toBe(3);
      expect(result.checksumMatches).toBe(true);
    });

    it("returns failure when no snapshot available", () => {
      const result = replayService.replayFromSnapshot(100);

      expect(result.success).toBe(false);
      expect(result.eventsReplayed).toBe(0);
    });
  });

  describe("timeline formatting", () => {
    it("formats timeline summary correctly", () => {
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 104,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 15 },
        },
        { currentTick: 104, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 108,
          type: GameEventType.COMBAT_MISS,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 108, playerCount: 1, activeCombats: 1 },
      );

      eventStore.record(
        {
          tick: 112,
          type: GameEventType.DEATH_MOB,
          entityId: "mob1",
          payload: {},
        },
        { currentTick: 112, playerCount: 1, activeCombats: 0 },
      );

      const timeline = replayService.getCombatTimeline("player1", "mob1", 105);
      const summary = replayService.formatTimelineSummary(timeline!);

      expect(summary).toContain("player1 vs mob1");
      expect(summary).toContain("12 ticks");
      expect(summary).toContain("7.2s"); // 12 * 0.6
      expect(summary).toContain("Damage Dealt: 15");
      expect(summary).toContain("1 hits");
      expect(summary).toContain("1 misses");
      expect(summary).toContain("50.0%"); // 1 hit / 2 total
    });
  });

  describe("JSON export", () => {
    it("exports events as valid JSON", () => {
      eventStore.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: { targetId: "mob1" },
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      const json = replayService.exportEventsAsJSON(0, 200);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe(GameEventType.COMBAT_START);
      expect(parsed[0].entityId).toBe("player1");
    });
  });
});
