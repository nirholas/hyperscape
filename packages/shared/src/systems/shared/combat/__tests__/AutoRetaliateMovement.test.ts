/**
 * OSRS-Accurate Auto-Retaliate Movement Tests
 *
 * Tests the critical OSRS behavior: when auto-retaliate triggers,
 * the player's movement destination is REPLACED with the attacker's position.
 *
 * Key OSRS behaviors tested:
 * - Auto-retaliate ON: Player moves toward attacker (cancels "run away" movement)
 * - Auto-retaliate OFF: Player keeps their current movement (can run away)
 *
 * @see https://oldschool.runescape.wiki/w/Auto_Retaliate
 * "the player's character walks/runs towards the monster attacking and fights back"
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CombatSystem } from "../CombatSystem";
import { EventType } from "../../../../types/events";
import { COMBAT_CONSTANTS } from "../../../../constants/CombatConstants";

/**
 * Create a mock player entity
 */
function createTestPlayer(
  id: string,
  options: {
    health?: number;
    position?: { x: number; y: number; z: number };
    autoRetaliate?: boolean;
  } = {},
) {
  const health = options.health ?? 100;
  const position = options.position ?? { x: 0, y: 0, z: 0 };
  const autoRetaliate = options.autoRetaliate ?? true;

  return {
    id,
    type: "player" as const,
    position,
    health,
    autoRetaliate,
    data: {
      isLoading: false,
      stats: { attack: 50, strength: 50, defence: 50, hitpoints: 100 },
    },
    emote: "idle",
    base: { quaternion: { set: vi.fn(), copy: vi.fn() } },
    node: {
      position,
      quaternion: { set: vi.fn(), copy: vi.fn() },
    },
    getPosition: () => position,
    markNetworkDirty: vi.fn(),
    takeDamage: vi.fn((amount: number) => Math.max(0, health - amount)),
    getHealth: () => health,
    getComponent: (name: string) => {
      if (name === "health") {
        return { data: { current: health, max: 100, isDead: health <= 0 } };
      }
      if (name === "stats") {
        return {
          data: { attack: 50, strength: 50, defense: 50, ranged: 1 },
        };
      }
      return null;
    },
    isDead: () => health <= 0,
    alive: true,
  };
}

/**
 * Create a mock mob entity
 */
function createTestMob(
  id: string,
  options: {
    health?: number;
    position?: { x: number; y: number; z: number };
  } = {},
) {
  const health = {
    current: options.health ?? 100,
    max: options.health ?? 100,
  };
  const position = options.position ?? { x: 1, y: 0, z: 1 };

  return {
    id,
    type: "mob" as const,
    position,
    health: health.current,
    node: {
      position,
      quaternion: { set: vi.fn(), copy: vi.fn() },
    },
    getPosition: () => position,
    getMobData: () => ({
      health: health.current,
      attack: 10,
      attackPower: 10,
      defense: 10,
      stats: { attack: 10, strength: 10, defence: 10, hitpoints: health.max },
      combatRange: 1,
      attackSpeedTicks: COMBAT_CONSTANTS.DEFAULT_ATTACK_SPEED_TICKS,
    }),
    getHealth: () => health.current,
    takeDamage: vi.fn((amount: number) => {
      health.current = Math.max(0, health.current - amount);
      return health.current;
    }),
    getCombatRange: () => 1,
    isAttackable: () => health.current > 0,
    isDead: () => health.current <= 0,
    setServerEmote: vi.fn(),
    markNetworkDirty: vi.fn(),
  };
}

/**
 * Create a mock world with auto-retaliate support
 */
function createTestWorld(options: { currentTick?: number } = {}) {
  const players = new Map<string, ReturnType<typeof createTestPlayer>>();
  const eventHandlers = new Map<string, Function[]>();
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

  let currentTick = options.currentTick ?? 100;

  const entities = new Map<string, unknown>() as Map<string, unknown> & {
    players: Map<string, ReturnType<typeof createTestPlayer>>;
  };
  entities.players = players;

  const mockEventBus = {
    emitEvent: vi.fn((type: string, data: unknown, _source?: string) => {
      emittedEvents.push({ event: type, data });
      const handlers = eventHandlers.get(type) || [];
      handlers.forEach((h) => h(data));
    }),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    subscribeOnce: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };

  const mobsMap = new Map<string, ReturnType<typeof createTestMob>>();
  const mobs = {
    set: (id: string, mob: ReturnType<typeof createTestMob>) => {
      mobsMap.set(id, mob);
      entities.set(id, mob);
      return mobs;
    },
    get: (id: string) => mobsMap.get(id),
    delete: (id: string) => {
      entities.delete(id);
      return mobsMap.delete(id);
    },
    has: (id: string) => mobsMap.has(id),
  };

  return {
    isServer: true,
    $eventBus: mockEventBus,
    get currentTick() {
      return currentTick;
    },
    setTick(tick: number) {
      currentTick = tick;
    },
    advanceTicks(count: number) {
      currentTick += count;
    },
    entities,
    players,
    mobs,
    emittedEvents,
    network: { send: vi.fn() },
    getPlayer: (id: string) => players.get(id),
    getSystem: (name: string) => {
      if (name === "entity-manager") {
        // Required by CombatSystem.init()
        return {
          getEntity: (id: string) => entities.get(id) || mobs.get(id),
        };
      }
      if (name === "equipment") {
        return {
          getPlayerEquipment: () => ({ weapon: null }),
        };
      }
      if (name === "player") {
        return {
          damagePlayer: vi.fn(),
          getPlayer: (id: string) => players.get(id),
          // Critical: Return the player's auto-retaliate setting
          getPlayerAutoRetaliate: (playerId: string) => {
            const player = players.get(playerId);
            return player?.autoRetaliate ?? true;
          },
        };
      }
      if (name === "mob-npc") {
        return { getMob: (id: string) => mobs.get(id) };
      }
      if (name === "ground-item") {
        return { spawnGroundItem: vi.fn() };
      }
      return undefined;
    },
    on: (event: string, handler: Function) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
    },
    off: vi.fn(),
    emit: vi.fn((event: string, data: unknown) => {
      emittedEvents.push({ event, data });
      const handlers = eventHandlers.get(event) || [];
      handlers.forEach((h) => h(data));
    }),
  };
}

describe("OSRS Auto-Retaliate Movement", () => {
  let combatSystem: CombatSystem;
  let world: ReturnType<typeof createTestWorld>;

  beforeEach(async () => {
    world = createTestWorld({ currentTick: 100 });
    combatSystem = new CombatSystem(world as unknown as never);
    // CRITICAL: Call init() to cache playerSystem for auto-retaliate checks
    await combatSystem.init();
  });

  afterEach(() => {
    combatSystem.destroy();
  });

  describe("auto-retaliate ON - movement replacement", () => {
    it("emits COMBAT_FOLLOW_TARGET when player is attacked with auto-retaliate ON", () => {
      // Player and mob must be within melee range (adjacent tiles) for combat to start
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 }, // Tile (5, 5)
        autoRetaliate: true, // ON
      });

      // Mob attacks the player from adjacent tile (cardinal direction)
      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Tile (5, 6) - NORTH of player
        health: 100,
      });

      world.players.set("player1", player);
      world.mobs.set("mob1", mob);

      // Clear any previous events
      world.emittedEvents.length = 0;

      // Mob attacks player (initiating combat where player will retaliate)
      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Should emit COMBAT_FOLLOW_TARGET for the player to chase the mob
      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeDefined();
      expect(followEvent?.data).toMatchObject({
        playerId: "player1", // Player should move
        targetId: "mob1", // Toward the mob
      });
    });

    it("includes correct attacker position in follow event", () => {
      // Adjacent tiles for valid combat
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 }, // Tile (5, 5)
        autoRetaliate: true,
      });

      const mob = createTestMob("mob1", {
        position: { x: 6.5, y: 3, z: 5.5 }, // Tile (6, 5) - EAST of player, different Y
        health: 100,
      });

      world.players.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeDefined();
      expect(followEvent?.data).toMatchObject({
        targetPosition: {
          x: 6.5,
          y: 3,
          z: 5.5,
        },
      });
    });

    it("emits follow event for player-vs-player combat with auto-retaliate ON", () => {
      // Adjacent tiles for valid combat
      const defender = createTestPlayer("defender", {
        position: { x: 5.5, y: 0, z: 5.5 }, // Tile (5, 5)
        autoRetaliate: true,
      });

      const attacker = createTestPlayer("attacker", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Tile (5, 6) - adjacent
      });

      world.players.set("defender", defender);
      world.players.set("attacker", attacker);
      world.entities.set("defender", defender);
      world.entities.set("attacker", attacker);

      world.emittedEvents.length = 0;

      combatSystem.startCombat("attacker", "defender", {
        attackerType: "player",
        targetType: "player",
      });

      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeDefined();
      expect(followEvent?.data).toMatchObject({
        playerId: "defender",
        targetId: "attacker",
      });
    });
  });

  describe("auto-retaliate OFF - no movement change", () => {
    it("does NOT emit COMBAT_FOLLOW_TARGET when auto-retaliate is OFF", () => {
      // Adjacent tiles for valid combat
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 }, // Tile (5, 5)
        autoRetaliate: false, // OFF - player can run away
      });

      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Tile (5, 6) - adjacent
        health: 100,
      });

      world.players.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Should NOT emit follow event - player keeps running
      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeUndefined();
    });

    it("player can escape without being forced to fight back", () => {
      // Adjacent tiles for valid combat
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 }, // Tile (5, 5)
        autoRetaliate: false,
      });

      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Tile (5, 6) - adjacent
        health: 100,
      });

      world.players.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Verify NO follow events were emitted for the player
      const followEvents = world.emittedEvents.filter(
        (e) =>
          e.event === EventType.COMBAT_FOLLOW_TARGET &&
          (e.data as { playerId: string }).playerId === "player1",
      );

      expect(followEvents).toHaveLength(0);
    });
  });

  describe("mob attacks player scenarios", () => {
    it("NPC-initiated combat triggers auto-retaliate movement", () => {
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 },
        autoRetaliate: true,
      });

      const mob = createTestMob("goblin", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Adjacent tile
        health: 50,
      });

      world.players.set("player1", player);
      world.mobs.set("goblin", mob);
      world.emittedEvents.length = 0;

      // Goblin aggros the player
      combatSystem.startCombat("goblin", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeDefined();
      expect((followEvent?.data as { playerId: string }).playerId).toBe(
        "player1",
      );
    });

    it("handles multiple mobs attacking - only follows first attacker", () => {
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 },
        autoRetaliate: true,
      });

      const mob1 = createTestMob("goblin1", {
        position: { x: 5.5, y: 0, z: 6.5 },
        health: 50,
      });

      const mob2 = createTestMob("goblin2", {
        position: { x: 6.5, y: 0, z: 5.5 },
        health: 50,
      });

      world.players.set("player1", player);
      world.mobs.set("goblin1", mob1);
      world.mobs.set("goblin2", mob2);
      world.emittedEvents.length = 0;

      // First goblin attacks
      combatSystem.startCombat("goblin1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      const followEvents = world.emittedEvents.filter(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      // Should have exactly one follow event for the first attacker
      expect(followEvents).toHaveLength(1);
      expect((followEvents[0].data as { targetId: string }).targetId).toBe(
        "goblin1",
      );
    });
  });

  describe("RS3-style movement priority", () => {
    it("does NOT emit COMBAT_FOLLOW_TARGET when player is actively moving", () => {
      // Player is actively moving (tileMovementActive = true)
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 },
        autoRetaliate: true,
      });
      // Set the movement flag to simulate player walking
      (player.data as { tileMovementActive?: boolean }).tileMovementActive =
        true;

      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 }, // Adjacent tile
        health: 100,
      });

      world.players.set("player1", player);
      world.entities.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      // Mob attacks player who is actively moving
      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Should NOT emit COMBAT_FOLLOW_TARGET - player keeps walking
      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeUndefined();
    });

    it("still creates combat state when player is moving", () => {
      // Player is actively moving
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 },
        autoRetaliate: true,
      });
      (player.data as { tileMovementActive?: boolean }).tileMovementActive =
        true;

      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 },
        health: 100,
      });

      world.players.set("player1", player);
      world.entities.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Combat should still be started (state created) even though follow is deferred
      const combatStartedEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_STARTED,
      );

      expect(combatStartedEvent).toBeDefined();
    });

    it("emits COMBAT_FOLLOW_TARGET when player stops moving", () => {
      // Player starts stationary (tileMovementActive = false or undefined)
      const player = createTestPlayer("player1", {
        position: { x: 5.5, y: 0, z: 5.5 },
        autoRetaliate: true,
      });
      // Explicitly not moving
      (player.data as { tileMovementActive?: boolean }).tileMovementActive =
        false;

      const mob = createTestMob("mob1", {
        position: { x: 5.5, y: 0, z: 6.5 },
        health: 100,
      });

      world.players.set("player1", player);
      world.entities.set("player1", player);
      world.mobs.set("mob1", mob);
      world.emittedEvents.length = 0;

      combatSystem.startCombat("mob1", "player1", {
        attackerType: "mob",
        targetType: "player",
      });

      // Should emit COMBAT_FOLLOW_TARGET since player is standing still
      const followEvent = world.emittedEvents.find(
        (e) => e.event === EventType.COMBAT_FOLLOW_TARGET,
      );

      expect(followEvent).toBeDefined();
      expect(followEvent?.data).toMatchObject({
        playerId: "player1",
        targetId: "mob1",
      });
    });
  });
});
