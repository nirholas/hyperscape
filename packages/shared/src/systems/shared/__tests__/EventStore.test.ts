/**
 * EventStore Unit Tests
 *
 * Tests for the game event recording and replay system:
 * - Event recording and ring buffer behavior
 * - Entity event filtering
 * - Combat event retrieval
 * - Checksum computation and verification
 * - Snapshot creation and retrieval
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventStore, GameEventType, type GameStateInfo } from "../EventStore";

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  describe("record", () => {
    it("records a single event", () => {
      const stateInfo: GameStateInfo = {
        currentTick: 100,
        playerCount: 5,
        activeCombats: 2,
      };

      store.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_ATTACK,
          entityId: "player1",
          payload: { targetId: "mob1", damage: 10 },
        },
        stateInfo,
      );

      expect(store.getEventCount()).toBe(1);
    });

    it("records multiple events", () => {
      const stateInfo: GameStateInfo = {
        currentTick: 100,
        playerCount: 5,
        activeCombats: 2,
      };

      for (let i = 0; i < 10; i++) {
        store.record(
          {
            tick: 100 + i,
            type: GameEventType.COMBAT_DAMAGE,
            entityId: "player1",
            payload: { damage: i },
          },
          { ...stateInfo, currentTick: 100 + i },
        );
      }

      expect(store.getEventCount()).toBe(10);
    });

    it("respects ring buffer limit", () => {
      const smallStore = new EventStore({ maxEvents: 5 });
      const stateInfo: GameStateInfo = {
        currentTick: 0,
        playerCount: 1,
        activeCombats: 0,
      };

      for (let i = 0; i < 10; i++) {
        smallStore.record(
          {
            tick: i,
            type: GameEventType.MOVEMENT_TICK,
            entityId: "player1",
            payload: { x: i },
          },
          { ...stateInfo, currentTick: i },
        );
      }

      expect(smallStore.getEventCount()).toBe(5);
      expect(smallStore.getOldestEventTick()).toBe(5);
      expect(smallStore.getNewestEventTick()).toBe(9);
    });

    it("adds timestamp to events", () => {
      const before = Date.now();

      store.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {},
        },
        { currentTick: 100, playerCount: 1, activeCombats: 1 },
      );

      const after = Date.now();
      const events = store.getEntityEvents("player1");

      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after);
    });

    it("computes state checksum", () => {
      store.record(
        {
          tick: 100,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {},
        },
        { currentTick: 100, playerCount: 5, activeCombats: 2 },
      );

      const events = store.getEntityEvents("player1");
      expect(events[0].stateChecksum).toBeGreaterThan(0);
    });

    it("creates snapshot at interval", () => {
      const storeWithSnapshots = new EventStore({ snapshotInterval: 10 });

      // Record events at ticks 0, 10, 20 (should create 3 snapshots)
      for (let tick = 0; tick <= 20; tick += 10) {
        storeWithSnapshots.record(
          {
            tick,
            type: GameEventType.STATE_HEALTH,
            entityId: "player1",
            payload: {},
          },
          { currentTick: tick, playerCount: 1, activeCombats: 0 },
          {
            entities: new Map([["player1", { id: "player1", type: "player" }]]),
            combatStates: new Map(),
            rngState: { state0: "123", state1: "456" },
          },
        );
      }

      expect(storeWithSnapshots.getSnapshotCount()).toBe(3);
      expect(storeWithSnapshots.getSnapshot(0)).toBeDefined();
      expect(storeWithSnapshots.getSnapshot(10)).toBeDefined();
      expect(storeWithSnapshots.getSnapshot(20)).toBeDefined();
    });
  });

  describe("getEntityEvents", () => {
    beforeEach(() => {
      const stateInfo: GameStateInfo = {
        currentTick: 0,
        playerCount: 2,
        activeCombats: 1,
      };

      // Record events for multiple entities
      store.record(
        {
          tick: 1,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 1 },
      );
      store.record(
        {
          tick: 2,
          type: GameEventType.COMBAT_ATTACK,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 2 },
      );
      store.record(
        {
          tick: 3,
          type: GameEventType.COMBAT_ATTACK,
          entityId: "player2",
          payload: {},
        },
        { ...stateInfo, currentTick: 3 },
      );
      store.record(
        {
          tick: 4,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 4 },
      );
    });

    it("returns events for specific entity", () => {
      const events = store.getEntityEvents("player1");
      expect(events.length).toBe(3);
      expect(events.every((e) => e.entityId === "player1")).toBe(true);
    });

    it("returns empty array for unknown entity", () => {
      const events = store.getEntityEvents("unknown");
      expect(events).toEqual([]);
    });

    it("filters by start tick", () => {
      const events = store.getEntityEvents("player1", 2);
      expect(events.length).toBe(2);
      expect(events[0].tick).toBe(2);
    });

    it("filters by end tick", () => {
      const events = store.getEntityEvents("player1", undefined, 2);
      expect(events.length).toBe(2);
      expect(events[1].tick).toBe(2);
    });

    it("filters by tick range", () => {
      const events = store.getEntityEvents("player1", 2, 3);
      expect(events.length).toBe(1);
      expect(events[0].tick).toBe(2);
    });
  });

  describe("getCombatEvents", () => {
    beforeEach(() => {
      const stateInfo: GameStateInfo = {
        currentTick: 0,
        playerCount: 1,
        activeCombats: 1,
      };

      store.record(
        {
          tick: 1,
          type: GameEventType.MOVEMENT_START,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 1 },
      );
      store.record(
        {
          tick: 2,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 2 },
      );
      store.record(
        {
          tick: 3,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 3 },
      );
      store.record(
        {
          tick: 4,
          type: GameEventType.DEATH_MOB,
          entityId: "mob1",
          payload: {},
        },
        { ...stateInfo, currentTick: 4 },
      );
      store.record(
        {
          tick: 5,
          type: GameEventType.MOVEMENT_TICK,
          entityId: "player1",
          payload: {},
        },
        { ...stateInfo, currentTick: 5 },
      );
    });

    it("returns only combat-related events", () => {
      const events = store.getCombatEvents(1, 5);
      expect(events.length).toBe(3);
      expect(events.map((e) => e.type)).toContain(GameEventType.COMBAT_START);
      expect(events.map((e) => e.type)).toContain(GameEventType.COMBAT_DAMAGE);
      expect(events.map((e) => e.type)).toContain(GameEventType.DEATH_MOB);
    });

    it("filters by tick range", () => {
      const events = store.getCombatEvents(2, 3);
      expect(events.length).toBe(2);
    });
  });

  describe("getEventsInRange", () => {
    it("returns all events in tick range", () => {
      const stateInfo: GameStateInfo = {
        currentTick: 0,
        playerCount: 1,
        activeCombats: 0,
      };

      for (let i = 1; i <= 10; i++) {
        store.record(
          {
            tick: i,
            type: GameEventType.MOVEMENT_TICK,
            entityId: "player1",
            payload: {},
          },
          { ...stateInfo, currentTick: i },
        );
      }

      const events = store.getEventsInRange(3, 7);
      expect(events.length).toBe(5);
      expect(events[0].tick).toBe(3);
      expect(events[4].tick).toBe(7);
    });
  });

  describe("getEventsByType", () => {
    it("returns events of specific type", () => {
      const stateInfo: GameStateInfo = {
        currentTick: 0,
        playerCount: 1,
        activeCombats: 0,
      };

      store.record(
        {
          tick: 1,
          type: GameEventType.COMBAT_START,
          entityId: "player1",
          payload: {},
        },
        stateInfo,
      );
      store.record(
        {
          tick: 2,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: {},
        },
        stateInfo,
      );
      store.record(
        {
          tick: 3,
          type: GameEventType.COMBAT_DAMAGE,
          entityId: "player1",
          payload: {},
        },
        stateInfo,
      );

      const events = store.getEventsByType(GameEventType.COMBAT_DAMAGE);
      expect(events.length).toBe(2);
    });
  });

  describe("verifyChecksum", () => {
    it("returns true for matching checksum", () => {
      const stateInfo: GameStateInfo = {
        currentTick: 100,
        playerCount: 5,
        activeCombats: 2,
      };

      store.record(
        {
          tick: 100,
          type: GameEventType.STATE_HEALTH,
          entityId: "player1",
          payload: {},
        },
        stateInfo,
      );

      const events = store.getEntityEvents("player1");
      const checksum = events[0].stateChecksum;

      expect(store.verifyChecksum(100, checksum)).toBe(true);
    });

    it("returns false for non-matching checksum", () => {
      store.record(
        {
          tick: 100,
          type: GameEventType.STATE_HEALTH,
          entityId: "player1",
          payload: {},
        },
        { currentTick: 100, playerCount: 5, activeCombats: 2 },
      );

      expect(store.verifyChecksum(100, 12345)).toBe(false);
    });

    it("returns false for non-existent tick", () => {
      expect(store.verifyChecksum(999, 12345)).toBe(false);
    });
  });

  describe("snapshots", () => {
    it("getNearestSnapshot returns closest snapshot before tick", () => {
      const storeWithSnapshots = new EventStore({ snapshotInterval: 100 });

      // Create snapshots at ticks 0, 100, 200
      for (let tick = 0; tick <= 200; tick += 100) {
        storeWithSnapshots.record(
          {
            tick,
            type: GameEventType.STATE_HEALTH,
            entityId: "player1",
            payload: {},
          },
          { currentTick: tick, playerCount: 1, activeCombats: 0 },
          {
            entities: new Map([
              ["player1", { id: "player1", type: "player", health: tick }],
            ]),
            combatStates: new Map(),
            rngState: { state0: `${tick}`, state1: "0" },
          },
        );
      }

      // Get nearest snapshot before tick 150 (should be tick 100)
      const snapshot = storeWithSnapshots.getNearestSnapshot(150);
      expect(snapshot).toBeDefined();
      expect(snapshot!.tick).toBe(100);
    });

    it("getNearestSnapshot returns undefined if no snapshots before tick", () => {
      const storeWithSnapshots = new EventStore({ snapshotInterval: 100 });

      storeWithSnapshots.record(
        {
          tick: 100,
          type: GameEventType.STATE_HEALTH,
          entityId: "player1",
          payload: {},
        },
        { currentTick: 100, playerCount: 1, activeCombats: 0 },
        {
          entities: new Map(),
          combatStates: new Map(),
          rngState: { state0: "0", state1: "0" },
        },
      );

      const snapshot = storeWithSnapshots.getNearestSnapshot(50);
      expect(snapshot).toBeUndefined();
    });

    it("limits number of snapshots", () => {
      const storeWithSmallLimit = new EventStore({
        snapshotInterval: 1,
        maxSnapshots: 3,
      });

      // Create 10 snapshots
      for (let tick = 0; tick < 10; tick++) {
        storeWithSmallLimit.record(
          {
            tick,
            type: GameEventType.STATE_HEALTH,
            entityId: "player1",
            payload: {},
          },
          { currentTick: tick, playerCount: 1, activeCombats: 0 },
          {
            entities: new Map(),
            combatStates: new Map(),
            rngState: { state0: `${tick}`, state1: "0" },
          },
        );
      }

      expect(storeWithSmallLimit.getSnapshotCount()).toBe(3);
      // Should keep the most recent 3: 7, 8, 9
      expect(storeWithSmallLimit.getSnapshot(7)).toBeDefined();
      expect(storeWithSmallLimit.getSnapshot(8)).toBeDefined();
      expect(storeWithSmallLimit.getSnapshot(9)).toBeDefined();
      expect(storeWithSmallLimit.getSnapshot(0)).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all events and snapshots", () => {
      const storeWithSnapshots = new EventStore({ snapshotInterval: 1 });

      for (let i = 0; i < 5; i++) {
        storeWithSnapshots.record(
          {
            tick: i,
            type: GameEventType.COMBAT_DAMAGE,
            entityId: "player1",
            payload: {},
          },
          { currentTick: i, playerCount: 1, activeCombats: 0 },
          {
            entities: new Map(),
            combatStates: new Map(),
            rngState: { state0: "0", state1: "0" },
          },
        );
      }

      expect(storeWithSnapshots.getEventCount()).toBe(5);
      expect(storeWithSnapshots.getSnapshotCount()).toBe(5);

      storeWithSnapshots.clear();

      expect(storeWithSnapshots.getEventCount()).toBe(0);
      expect(storeWithSnapshots.getSnapshotCount()).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("getOldestEventTick returns undefined for empty store", () => {
      expect(store.getOldestEventTick()).toBeUndefined();
    });

    it("getNewestEventTick returns undefined for empty store", () => {
      expect(store.getNewestEventTick()).toBeUndefined();
    });

    it("handles custom event types (strings)", () => {
      store.record(
        {
          tick: 1,
          type: "CUSTOM_EVENT",
          entityId: "player1",
          payload: { custom: true },
        },
        { currentTick: 1, playerCount: 1, activeCombats: 0 },
      );

      const events = store.getEventsByType("CUSTOM_EVENT");
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("CUSTOM_EVENT");
    });
  });
});
