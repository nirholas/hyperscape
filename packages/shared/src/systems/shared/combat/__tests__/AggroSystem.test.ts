/**
 * AggroSystem Unit Tests
 *
 * Tests the mob aggression and AI system.
 *
 * Key behaviors tested:
 * - Mob registration and unregistration
 * - Level-based aggression logic
 * - Combat level calculation
 * - Player skills caching
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AggroSystem } from "../AggroSystem";
import { COMBAT_CONSTANTS } from "../../../../constants/CombatConstants";

// Mock World
function createMockWorld() {
  const entities = new Map<string, Record<string, unknown>>();
  const players = new Map<
    string,
    { id: string; node: { position: { x: number; y: number; z: number } } }
  >();
  const emitFn = vi.fn();
  const onFn = vi.fn();
  const offFn = vi.fn();

  return {
    entities,
    emit: emitFn,
    on: onFn,
    off: offFn,
    getSystem: vi.fn(),
    getPlayer: (playerId: string) => players.get(playerId),
    _emit: emitFn,
    _players: players,
    setPlayer: (
      playerId: string,
      x: number,
      y: number,
      z: number,
      data: Record<string, unknown> = {},
    ) => {
      players.set(playerId, {
        id: playerId,
        node: { position: { x, y, z } },
      });
      entities.set(playerId, { data });
    },
  };
}

describe("AggroSystem", () => {
  let world: ReturnType<typeof createMockWorld>;
  let system: AggroSystem;

  beforeEach(() => {
    world = createMockWorld();
    system = new AggroSystem(world as never);
  });

  afterEach(() => {
    system.destroy();
  });

  describe("mob registration", () => {
    it("registers mob with correct initial state", () => {
      const privateSystem = system as unknown as {
        mobStates: Map<string, unknown>;
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position: { x: number; y: number; z: number };
          combat?: {
            aggressive?: boolean;
            aggroRange?: number;
            leashRange?: number;
            levelIgnoreThreshold?: number;
          };
        }) => void;
      };

      privateSystem.registerMob({
        id: "mob1",
        type: "goblin",
        level: 1,
        position: { x: 10, y: 0, z: 10 },
      });

      expect(privateSystem.mobStates.size).toBe(1);
      expect(privateSystem.mobStates.has("mob1")).toBe(true);
    });

    it("registers mob with manifest combat config", () => {
      const privateSystem = system as unknown as {
        mobStates: Map<
          string,
          { detectionRange: number; leashRange: number; levelIgnore: number }
        >;
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position: { x: number; y: number; z: number };
          combat?: {
            aggressive?: boolean;
            aggroRange?: number;
            leashRange?: number;
            levelIgnoreThreshold?: number;
          };
        }) => void;
      };

      privateSystem.registerMob({
        id: "mob2",
        type: "goblin",
        level: 2,
        position: { x: 10, y: 0, z: 10 },
        combat: {
          aggressive: true,
          aggroRange: 6,
          leashRange: 10,
          levelIgnoreThreshold: 20,
        },
      });

      const mobState = privateSystem.mobStates.get("mob2")!;
      expect(mobState.detectionRange).toBe(6);
      expect(mobState.leashRange).toBe(10);
      expect(mobState.levelIgnore).toBe(20);
    });

    it("uses DEFAULTS when combat config not provided", () => {
      const privateSystem = system as unknown as {
        mobStates: Map<
          string,
          { detectionRange: number; leashRange: number; levelIgnore: number }
        >;
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position: { x: number; y: number; z: number };
          combat?: {
            aggressive?: boolean;
            aggroRange?: number;
            leashRange?: number;
            levelIgnoreThreshold?: number;
          };
        }) => void;
      };

      privateSystem.registerMob({
        id: "mob3",
        type: "chicken",
        level: 1,
        position: { x: 10, y: 0, z: 10 },
        // No combat config - should use DEFAULTS
      });

      const mobState = privateSystem.mobStates.get("mob3")!;
      expect(mobState.detectionRange).toBe(
        COMBAT_CONSTANTS.DEFAULTS.NPC.AGGRO_RANGE,
      );
      expect(mobState.leashRange).toBe(
        COMBAT_CONSTANTS.DEFAULTS.NPC.LEASH_RANGE,
      );
    });

    it("throws error when registering mob without position", () => {
      const privateSystem = system as unknown as {
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position?: { x: number; y: number; z: number };
        }) => void;
      };

      expect(() =>
        privateSystem.registerMob({
          id: "mob1",
          type: "goblin",
          level: 1,
          position: undefined,
        }),
      ).toThrow("Missing position for mob mob1");
    });

    it("unregisters mob correctly", () => {
      const privateSystem = system as unknown as {
        mobStates: Map<string, unknown>;
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position: { x: number; y: number; z: number };
        }) => void;
        unregisterMob: (mobId: string) => void;
      };

      privateSystem.registerMob({
        id: "mob1",
        type: "goblin",
        level: 1,
        position: { x: 10, y: 0, z: 10 },
      });

      expect(privateSystem.mobStates.size).toBe(1);

      privateSystem.unregisterMob("mob1");

      expect(privateSystem.mobStates.size).toBe(0);
    });
  });

  describe("DEFAULTS.NPC constants", () => {
    it("has OSRS-accurate aggroRange of 4", () => {
      expect(COMBAT_CONSTANTS.DEFAULTS.NPC.AGGRO_RANGE).toBe(4);
    });

    it("has OSRS-accurate leashRange of 7", () => {
      expect(COMBAT_CONSTANTS.DEFAULTS.NPC.LEASH_RANGE).toBe(7);
    });

    it("has OSRS-accurate attackSpeedTicks of 4", () => {
      expect(COMBAT_CONSTANTS.DEFAULTS.NPC.ATTACK_SPEED_TICKS).toBe(4);
    });

    it("has OSRS-accurate respawnTicks of 25", () => {
      expect(COMBAT_CONSTANTS.DEFAULTS.NPC.RESPAWN_TICKS).toBe(25);
    });
  });

  describe("player skills caching", () => {
    it("caches player skills from SKILLS_UPDATED event", () => {
      const privateSystem = system as unknown as {
        playerSkills: Map<
          string,
          Record<string, { level: number; xp: number }>
        >;
        getPlayerSkills: (playerId: string) => {
          attack: number;
          strength: number;
          defense: number;
          constitution: number;
        };
      };

      privateSystem.playerSkills.set("player1", {
        attack: { level: 50, xp: 100000 },
        strength: { level: 45, xp: 80000 },
        defense: { level: 40, xp: 60000 },
        constitution: { level: 55, xp: 120000 },
      });

      const skills = privateSystem.getPlayerSkills("player1");
      expect(skills.attack).toBe(50);
      expect(skills.strength).toBe(45);
      expect(skills.defense).toBe(40);
      expect(skills.constitution).toBe(55);
    });

    it("returns OSRS default skills when player not cached", () => {
      const privateSystem = system as unknown as {
        getPlayerSkills: (playerId: string) => {
          attack: number;
          strength: number;
          defense: number;
          constitution: number;
        };
      };

      const skills = privateSystem.getPlayerSkills("unknown_player");
      expect(skills.attack).toBe(1);
      expect(skills.strength).toBe(1);
      expect(skills.defense).toBe(1);
      // OSRS: Hitpoints starts at 10, not 1
      expect(skills.constitution).toBe(10);
    });
  });

  describe("combat level calculation", () => {
    it("calculates combat level using OSRS formula", () => {
      const privateSystem = system as unknown as {
        playerSkills: Map<
          string,
          Record<string, { level: number; xp: number }>
        >;
        getPlayerCombatLevel: (playerId: string) => number;
      };

      // Set skills for OSRS formula test
      // OSRS Combat Level = floor(Base + max(Melee, Ranged, Magic))
      // Base = 0.25 * (Defence + Hitpoints + floor(Prayer / 2))
      // Melee = 0.325 * (Attack + Strength)
      //
      // For: Attack=50, Strength=45, Defence=40, Hitpoints=55, Prayer=1, Ranged=1, Magic=1
      // Base = 0.25 * (40 + 55 + 0) = 23.75
      // Melee = 0.325 * (50 + 45) = 30.875
      // Combat Level = floor(23.75 + 30.875) = floor(54.625) = 54
      privateSystem.playerSkills.set("player1", {
        attack: { level: 50, xp: 100000 },
        strength: { level: 45, xp: 80000 },
        defense: { level: 40, xp: 60000 },
        constitution: { level: 55, xp: 120000 },
      });

      const combatLevel = privateSystem.getPlayerCombatLevel("player1");
      expect(combatLevel).toBe(54);
    });

    it("returns minimum level 3 for new players (OSRS-accurate)", () => {
      const privateSystem = system as unknown as {
        playerSkills: Map<
          string,
          Record<string, { level: number; xp: number }>
        >;
        getPlayerCombatLevel: (playerId: string) => number;
      };

      // OSRS fresh character: All skills at 1, Hitpoints at 10
      // Base = 0.25 * (1 + 10 + 0) = 2.75
      // Melee = 0.325 * (1 + 1) = 0.65
      // Combat Level = floor(2.75 + 0.65) = 3
      privateSystem.playerSkills.set("player1", {
        attack: { level: 1, xp: 0 },
        strength: { level: 1, xp: 0 },
        defense: { level: 1, xp: 0 },
        constitution: { level: 10, xp: 0 }, // OSRS: Hitpoints starts at 10
      });

      const combatLevel = privateSystem.getPlayerCombatLevel("player1");
      expect(combatLevel).toBe(3);
    });

    it("returns level 3 for unknown player (OSRS default)", () => {
      const privateSystem = system as unknown as {
        getPlayerCombatLevel: (playerId: string) => number;
      };

      // Unknown player uses OSRS defaults: all 1 except Hitpoints=10
      // Combat level = 3 (OSRS starting combat level)
      const combatLevel = privateSystem.getPlayerCombatLevel("unknown_player");
      expect(combatLevel).toBe(3);
    });
  });

  describe("shouldMobAggroPlayer", () => {
    it("returns false for passive mobs regardless of level", () => {
      const privateSystem = system as unknown as {
        shouldMobAggroPlayer: (
          mobState: { behavior: string; levelIgnore: number; mobId: string },
          playerId: string,
        ) => boolean;
      };

      // Passive mobs never aggro
      const mobState = {
        behavior: "passive",
        levelIgnore: 10,
        mobId: "cow1",
      };

      const shouldAggro = privateSystem.shouldMobAggroPlayer(
        mobState,
        "player1",
      );
      expect(shouldAggro).toBe(false);
    });

    it("aggressive mob with high levelIgnore (999) is toleranceImmune", () => {
      const privateSystem = system as unknown as {
        playerSkills: Map<
          string,
          Record<string, { level: number; xp: number }>
        >;
        shouldMobAggroPlayer: (
          mobState: { behavior: string; levelIgnore: number; mobId: string },
          playerId: string,
        ) => boolean;
      };

      // Special mobs like Dark Warriors have levelIgnore of 999
      // They are "toleranceImmune" - always aggro regardless of player level
      const mobState = {
        behavior: "aggressive",
        levelIgnore: 999, // Tolerance immune
        mobId: "dark_warrior1",
      };

      // High level player - would normally be ignored
      privateSystem.playerSkills.set("player1", {
        attack: { level: 99, xp: 0 },
        strength: { level: 99, xp: 0 },
        defense: { level: 99, xp: 0 },
        constitution: { level: 99, xp: 0 },
      });

      // With levelIgnore 999 (toleranceImmune), mob always aggros
      // Note: actual result depends on OSRS double-level rule and tolerance timer
      // This test verifies the toleranceImmune check works
      const shouldAggro = privateSystem.shouldMobAggroPlayer(
        mobState,
        "player1",
      );
      // toleranceImmune mobs skip level-based ignore AND tolerance timer
      expect(shouldAggro).toBe(true);
    });
  });

  describe("shouldIgnorePlayer", () => {
    it("returns true when player level exceeds threshold", () => {
      const privateSystem = system as unknown as {
        shouldIgnorePlayer: (
          mobState: { levelIgnore: number },
          playerCombatLevel: number,
        ) => boolean;
      };

      // Mob with levelIgnore threshold of 10
      const mobState = { levelIgnore: 10 };

      // Player level 15 > threshold 10
      const shouldIgnore = privateSystem.shouldIgnorePlayer(mobState, 15);
      expect(shouldIgnore).toBe(true);
    });

    it("returns false when player level is at or below threshold", () => {
      const privateSystem = system as unknown as {
        shouldIgnorePlayer: (
          mobState: { levelIgnore: number },
          playerCombatLevel: number,
        ) => boolean;
      };

      // Mob with levelIgnore threshold of 10
      const mobState = { levelIgnore: 10 };

      // Player level 10 is not > threshold 10
      const shouldIgnore = privateSystem.shouldIgnorePlayer(mobState, 10);
      expect(shouldIgnore).toBe(false);
    });

    it("returns false for toleranceImmune mobs (levelIgnore >= 999)", () => {
      const privateSystem = system as unknown as {
        shouldIgnorePlayer: (
          mobState: { levelIgnore: number },
          playerCombatLevel: number,
        ) => boolean;
      };

      // Special mob like Dark Warrior with threshold 999
      const mobState = { levelIgnore: 999 };

      // Even level 126 player is NOT ignored by toleranceImmune mob
      const shouldIgnore = privateSystem.shouldIgnorePlayer(mobState, 126);
      expect(shouldIgnore).toBe(false);
    });
  });

  describe("destroy", () => {
    it("clears all mob states", () => {
      const privateSystem = system as unknown as {
        mobStates: Map<string, unknown>;
        registerMob: (data: {
          id: string;
          type: string;
          level: number;
          position: { x: number; y: number; z: number };
        }) => void;
      };

      privateSystem.registerMob({
        id: "mob1",
        type: "goblin",
        level: 1,
        position: { x: 10, y: 0, z: 10 },
      });

      privateSystem.registerMob({
        id: "mob2",
        type: "cow",
        level: 1,
        position: { x: 20, y: 0, z: 20 },
      });

      expect(privateSystem.mobStates.size).toBe(2);

      system.destroy();

      expect(privateSystem.mobStates.size).toBe(0);
    });
  });
});
