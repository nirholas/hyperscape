/**
 * Aggression System
 * Handles mob AI, aggression detection, and chase mechanics per GDD specifications
 * - Mob aggression based on player level and mob type
 * - Detection ranges and line-of-sight
 * - Chase mechanics with leashing
 * - Different mob behaviors (passive, aggressive, special cases)
 */

import { World } from "../../../core/World";
import { EventType } from "../../../types/events";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import { AggroTarget, Position3D, MobAIStateData } from "../../../types";
import { calculateDistance } from "../../../utils/game/EntityUtils";
import {
  calculateCombatLevel,
  normalizeCombatSkills,
  shouldMobIgnorePlayer,
} from "../../../utils/game/CombatLevelCalculator";
import { SystemBase } from "../infrastructure/SystemBase";
import {
  TICK_DURATION_MS,
  worldToTile,
  type TileCoord,
} from "../movement/TileSystem";
import type { Entity } from "../../../entities/Entity";

/**
 * Tolerance state for a player in a region
 * In OSRS, aggressive mobs stop attacking after player has been in a 21x21 region for 10 minutes
 *
 * @see https://oldschool.runescape.wiki/w/Aggression#Tolerance
 */
interface ToleranceState {
  /** Region identifier (21x21 tile zone) */
  regionId: string;
  /** Tick when player entered this region */
  enteredTick: number;
  /** Tick when tolerance expires (player becomes immune to aggression) */
  toleranceExpiredTick: number;
}

/** Tolerance timer duration: 1000 ticks = 10 minutes at 600ms/tick */
const TOLERANCE_TICKS = 1000;

/** Tolerance region size in tiles (OSRS uses 21x21 regions) */
const TOLERANCE_REGION_SIZE = 21;

/**
 * Aggression System - GDD Compliant
 * Implements mob AI and aggression mechanics per GDD specifications:
 * - Level-based aggression (low-level aggressive mobs ignore high-level players)
 * - Special cases (Dark Warriors always aggressive regardless of level)
 * - Detection ranges and chase mechanics
 * - Leashing to prevent mobs from going too far from spawn
 * - Multiple target management
 */
export class AggroSystem extends SystemBase {
  private mobStates = new Map<string, MobAIStateData>();
  private playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  /**
   * Tolerance tracking for players per region
   * Key: playerId, Value: tolerance state
   */
  private playerTolerance = new Map<string, ToleranceState>();

  /**
   * Current server tick (updated on each AI tick)
   */
  private currentTick = 0;

  constructor(world: World) {
    super(world, {
      name: "aggro",
      dependencies: {
        required: [], // Aggro system can work independently
        optional: ["mob-npc", "player", "combat", "entity-manager"], // Better with mob NPC and player systems
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Set up type-safe event subscriptions for aggro mechanics
    this.subscribe(
      EventType.MOB_NPC_SPAWNED,
      (data: {
        mobId: string;
        mobType: string;
        position: { x: number; y: number; z: number };
      }) => {
        this.registerMob({
          id: data.mobId,
          type: data.mobType,
          level: 1,
          position: data.position,
        });
      },
    );
    this.subscribe(EventType.MOB_NPC_DESPAWN, (data: { mobId: string }) => {
      this.unregisterMob(data.mobId);
    });
    this.subscribe(
      EventType.PLAYER_POSITION_UPDATED,
      (data: { playerId: string; position: Position3D }) => {
        this.updatePlayerPosition({
          entityId: data.playerId,
          position: data.position,
        });
      },
    );
    this.subscribe(
      EventType.COMBAT_STARTED,
      (data: { attackerId: string; targetId: string }) => {
        this.onCombatStarted({
          attackerId: data.attackerId,
          targetId: data.targetId,
        });
      },
    );
    this.subscribe(
      EventType.MOB_NPC_POSITION_UPDATED,
      (data: { mobId: string; position: Position3D }) => {
        this.updateMobPosition({
          entityId: data.mobId,
          position: data.position,
        });
      },
    );
    this.subscribe(
      EventType.PLAYER_LEVEL_CHANGED,
      (data: {
        playerId: string;
        skill:
          | "attack"
          | "strength"
          | "defense"
          | "constitution"
          | "ranged"
          | "woodcutting"
          | "fishing"
          | "firemaking"
          | "cooking";
        newLevel: number;
        oldLevel: number;
      }) => {
        this.checkAggroUpdates({
          playerId: data.playerId,
          oldLevel: data.oldLevel,
          newLevel: data.newLevel,
          skill: data.skill,
        });
      },
    );

    // Listen to skills updates for reactive patterns
    this.subscribe(
      EventType.SKILLS_UPDATED,
      (data: {
        playerId: string;
        skills: Record<
          | "attack"
          | "strength"
          | "defense"
          | "constitution"
          | "ranged"
          | "woodcutting"
          | "fishing"
          | "firemaking"
          | "cooking",
          { level: number; xp: number }
        >;
      }) => {
        this.playerSkills.set(data.playerId, data.skills);
      },
    );
  }

  start(): void {
    // Start AI update loop aligned to server tick (OSRS-accurate)
    this.createInterval(() => {
      this.updateMobAI();
    }, TICK_DURATION_MS); // 600ms - aligned to server tick
  }

  private registerMob(mobData: {
    id: string;
    type: string;
    level: number;
    position: { x: number; y: number; z: number };
    /** Optional combat config from manifest (aggroRange, leashRange, etc.) */
    combat?: {
      aggressive?: boolean;
      aggroRange?: number;
      leashRange?: number;
      levelIgnoreThreshold?: number;
    };
  }): void {
    // Strong type assumption - mobData.position is typed and valid from caller
    // If position is missing, that's a bug in the spawning system
    if (!mobData.position) {
      throw new Error(`[AggroSystem] Missing position for mob ${mobData.id}`);
    }

    const mobType = mobData.type.toLowerCase();

    // Use manifest values with OSRS-accurate DEFAULTS as fallback
    // This replaces the legacy MOB_BEHAVIORS lookup pattern
    const detectionRange =
      mobData.combat?.aggroRange ?? COMBAT_CONSTANTS.DEFAULTS.NPC.AGGRO_RANGE;
    const leashRange =
      mobData.combat?.leashRange ?? COMBAT_CONSTANTS.DEFAULTS.NPC.LEASH_RANGE;
    const isAggressive = mobData.combat?.aggressive ?? false;
    const levelIgnoreThreshold = mobData.combat?.levelIgnoreThreshold ?? 10;

    const aiState: MobAIStateData = {
      mobId: mobData.id,
      type: mobType,
      state: "idle",
      behavior: isAggressive ? "aggressive" : "passive",
      lastStateChange: Date.now(),
      lastAction: Date.now(),
      isPatrolling: false,
      isChasing: false,
      isInCombat: false,
      currentTarget: null,
      homePosition: {
        x: mobData.position.x || 0,
        y: mobData.position.y || 0,
        z: mobData.position.z || 0,
      },
      currentPosition: {
        x: mobData.position.x || 0,
        y: mobData.position.y || 0,
        z: mobData.position.z || 0,
      },
      detectionRange,
      leashRange,
      chaseSpeed: 3.0, // Default chase speed
      patrolRadius: 5.0, // Default patrol radius
      aggroTargets: new Map(),
      combatCooldown: 0,
      lastAttack: 0,
      levelIgnore: levelIgnoreThreshold,
      targetId: null,
      patrolPath: [],
      patrolIndex: 0,
      patrolTarget: null,
      combatTarget: null,
    };

    this.mobStates.set(mobData.id, aiState);
  }

  private unregisterMob(mobId: string): void {
    this.mobStates.delete(mobId);
  }

  private updatePlayerPosition(data: {
    entityId: string;
    position: Position3D;
  }): void {
    // Check all mobs for aggro against this player
    for (const [_mobId, mobState] of this.mobStates) {
      if (mobState.behavior === "passive") continue;

      this.checkPlayerAggro(mobState, data.entityId, data.position);
    }
  }

  private updateMobPosition(data: {
    entityId: string;
    position: Position3D;
  }): void {
    const mobState = this.mobStates.get(data.entityId);
    if (mobState && data.position) {
      // Strong type assumption - Position3D is always valid with x, y, z numbers
      mobState.currentPosition = {
        x: data.position.x,
        y: data.position.y,
        z: data.position.z,
      };
    }
  }

  private checkPlayerAggro(
    mobState: MobAIStateData,
    playerId: string,
    playerPosition: Position3D,
  ): void {
    // Skip players still loading - they're immune to aggro until clientReady
    const playerEntity = this.world.entities.get(playerId);
    if (playerEntity?.data?.isLoading) {
      return;
    }

    // Update player's tolerance state based on their position
    // This tracks how long they've been in the current 21x21 region
    this.updatePlayerTolerance(playerId, playerPosition);

    const distance = calculateDistance(
      mobState.currentPosition,
      playerPosition,
    );

    // Check if player is within detection range
    if (distance > mobState.detectionRange) {
      // Remove from aggro if too far
      if (mobState.aggroTargets.has(playerId)) {
        mobState.aggroTargets.delete(playerId);
      }
      return;
    }

    // Check level-based aggression per GDD
    if (!this.shouldMobAggroPlayer(mobState, playerId)) {
      return;
    }

    // Update or create aggro target
    let aggroTarget = mobState.aggroTargets.get(playerId);
    if (!aggroTarget) {
      aggroTarget = {
        playerId: playerId,
        aggroLevel: 10, // Initial aggro
        lastDamageTime: Date.now(),
        lastSeen: Date.now(),
        distance: distance,
        inRange: true,
      };

      mobState.aggroTargets.set(playerId, aggroTarget);

      // Start chasing if not already in combat
      if (!mobState.isInCombat && !mobState.currentTarget) {
        this.startChasing(mobState, playerId);
      }
    } else {
      // Update existing aggro
      aggroTarget.lastSeen = Date.now();
      aggroTarget.distance = distance;
      aggroTarget.inRange = distance <= mobState.detectionRange;
    }
  }

  /**
   * Check if mob should aggro a player based on level and behavior
   *
   * OSRS Rule: Mobs ignore players whose combat level is MORE THAN DOUBLE the mob's level.
   *
   * Examples:
   * - Level 2 goblin ignores level 5+ players (5 > 2*2 = 4)
   * - Level 10 guard ignores level 21+ players (21 > 10*2 = 20)
   * - Bosses (toleranceImmune) never ignore based on level
   *
   * @see https://oldschool.runescape.wiki/w/Aggression
   */
  private shouldMobAggroPlayer(
    mobState: MobAIStateData,
    playerId: string,
  ): boolean {
    // Non-aggressive mobs never aggro
    if (mobState.behavior !== "aggressive") {
      return false;
    }

    // Get player combat level using OSRS formula
    const playerCombatLevel = this.getPlayerCombatLevel(playerId);

    // Get mob's combat level from the entity
    const mobLevel = this.getMobCombatLevel(mobState.mobId);

    // Check if mob is tolerance-immune (bosses, special mobs)
    // Use levelIgnore from mobState (set from manifest during registration)
    // Special mobs with levelIgnoreThreshold of 999 are "toleranceImmune"
    // They always aggro regardless of player level
    const toleranceImmune = mobState.levelIgnore >= 999;

    // OSRS double-level aggro rule
    // Player level > (mob level * 2) = mob ignores player
    if (shouldMobIgnorePlayer(playerCombatLevel, mobLevel, toleranceImmune)) {
      return false;
    }

    // Check tolerance timer - after 10 minutes in region, mobs ignore player
    // Tolerance-immune mobs (bosses) skip this check
    if (!toleranceImmune && this.hasToleranceExpired(playerId)) {
      return false;
    }

    return true;
  }

  /**
   * Get mob's combat level from the entity
   * Falls back to levelIgnore from state or default of 1
   */
  private getMobCombatLevel(mobId: string): number {
    const mobEntity = this.world.entities.get(mobId) as Entity | undefined;
    if (mobEntity) {
      // Try to get level from entity property (set by MobEntity)
      const level = mobEntity.getProperty<number>("level");
      if (level !== undefined && level > 0) {
        return level;
      }
    }

    // Fallback: use the levelIgnore stored in mob state (if available)
    const mobState = this.mobStates.get(mobId);
    if (mobState && mobState.levelIgnore > 0 && mobState.levelIgnore < 999) {
      return mobState.levelIgnore;
    }

    // Default to level 1
    return 1;
  }

  /**
   * Get player combat level using OSRS-accurate formula
   *
   * Formula: Base + max(Melee, Ranged, Magic)
   * Where:
   *   Base = 0.25 * (Defence + Hitpoints + floor(Prayer / 2))
   *   Melee = 0.325 * (Attack + Strength)
   *   Ranged = 0.325 * floor(Ranged * 1.5)
   *   Magic = 0.325 * floor(Magic * 1.5)
   *
   * @see https://oldschool.runescape.wiki/w/Combat_level
   */
  private getPlayerCombatLevel(playerId: string): number {
    const playerSkills = this.getPlayerSkills(playerId);

    // Use OSRS-accurate combat level formula
    const combatSkills = normalizeCombatSkills({
      attack: playerSkills.attack,
      strength: playerSkills.strength,
      defense: playerSkills.defense,
      constitution: playerSkills.constitution, // Maps to hitpoints
      ranged: playerSkills.ranged,
      magic: playerSkills.magic,
      prayer: playerSkills.prayer,
    });

    return calculateCombatLevel(combatSkills);
  }

  private getPlayerSkills(playerId: string): {
    attack: number;
    strength: number;
    defense: number;
    constitution: number;
    ranged: number;
    magic: number;
    prayer: number;
  } {
    // Use cached skills data (reactive pattern)
    const cachedSkills = this.playerSkills.get(playerId);

    if (cachedSkills) {
      return {
        attack: cachedSkills.attack?.level ?? 1,
        strength: cachedSkills.strength?.level ?? 1,
        defense: cachedSkills.defense?.level ?? 1,
        constitution: cachedSkills.constitution?.level ?? 10,
        ranged: cachedSkills.ranged?.level ?? 1,
        magic:
          (cachedSkills as Record<string, { level: number }>).magic?.level ?? 1,
        prayer:
          (cachedSkills as Record<string, { level: number }>).prayer?.level ??
          1,
      };
    }

    // Default skills for fresh character (OSRS level 3)
    return {
      attack: 1,
      strength: 1,
      defense: 1,
      constitution: 10, // Hitpoints starts at 10 in OSRS
      ranged: 1,
      magic: 1,
      prayer: 1,
    };
  }

  /**
   * Update tolerance state for a player based on their current position
   *
   * OSRS Tolerance System:
   * - World is divided into 21x21 tile regions
   * - When player enters a new region, a 10-minute timer starts
   * - After 10 minutes in the same region, aggressive mobs stop attacking
   * - Moving to a new region resets the timer
   *
   * @param playerId - Player to update
   * @param playerPosition - Player's current world position
   *
   * @see https://oldschool.runescape.wiki/w/Aggression#Tolerance
   */
  private updatePlayerTolerance(
    playerId: string,
    playerPosition: Position3D,
  ): void {
    const tile = worldToTile(playerPosition.x, playerPosition.z);
    const regionId = this.getToleranceRegionId(tile);
    const existing = this.playerTolerance.get(playerId);

    if (!existing || existing.regionId !== regionId) {
      // Entered new region - reset timer
      this.playerTolerance.set(playerId, {
        regionId,
        enteredTick: this.currentTick,
        toleranceExpiredTick: this.currentTick + TOLERANCE_TICKS,
      });
    }
  }

  /**
   * Check if player has tolerance expired in their current region
   * If expired, aggressive mobs will no longer attack them
   *
   * @param playerId - Player to check
   * @returns true if player's tolerance has expired (mobs should ignore them)
   */
  private hasToleranceExpired(playerId: string): boolean {
    const state = this.playerTolerance.get(playerId);
    if (!state) return false;

    return this.currentTick >= state.toleranceExpiredTick;
  }

  /**
   * Get tolerance region ID for a tile position
   * OSRS divides the world into 21x21 tile regions for tolerance purposes
   *
   * @param tile - Tile coordinates
   * @returns Region identifier string "x:z"
   */
  private getToleranceRegionId(tile: TileCoord): string {
    const regionX = Math.floor(tile.x / TOLERANCE_REGION_SIZE);
    const regionZ = Math.floor(tile.z / TOLERANCE_REGION_SIZE);
    return `${regionX}:${regionZ}`;
  }

  /**
   * Clean up tolerance data for a player (on disconnect)
   */
  private removePlayerTolerance(playerId: string): void {
    this.playerTolerance.delete(playerId);
  }

  /**
   * Get remaining tolerance time in ticks for a player
   * Useful for debugging and UI display
   *
   * @param playerId - Player to check
   * @returns Remaining ticks until tolerance expires, or 0 if already expired
   */
  getRemainingToleranceTicks(playerId: string): number {
    const state = this.playerTolerance.get(playerId);
    if (!state) return 0;

    const remaining = state.toleranceExpiredTick - this.currentTick;
    return Math.max(0, remaining);
  }

  private startChasing(mobState: MobAIStateData, playerId: string): void {
    mobState.isChasing = true;
    mobState.currentTarget = playerId;
    mobState.isPatrolling = false;

    // Emit chase event for other systems
    this.emitTypedEvent(EventType.MOB_NPC_CHASE_STARTED, {
      mobId: mobState.mobId,
      targetPlayerId: playerId,
      mobPosition: {
        x: mobState.currentPosition.x,
        y: mobState.currentPosition.y,
        z: mobState.currentPosition.z,
      },
    });

    // Start combat if close enough
    const aggroTarget = mobState.aggroTargets.get(playerId);
    if (aggroTarget && aggroTarget.distance <= 2.0) {
      // Melee range
      this.startCombatWithPlayer(mobState, playerId);
    }
  }

  private startCombatWithPlayer(
    mobState: MobAIStateData,
    playerId: string,
  ): void {
    mobState.isInCombat = true;

    // Trigger combat system
    this.emitTypedEvent(EventType.COMBAT_START_ATTACK, {
      attackerId: mobState.mobId,
      targetId: playerId,
    });
  }

  private stopChasing(mobState: MobAIStateData): void {
    if (!mobState.isChasing) return;

    const previousTarget = mobState.currentTarget;

    mobState.isChasing = false;
    mobState.currentTarget = null;
    mobState.isPatrolling = true; // Resume patrolling

    // Emit chase end event
    this.emitTypedEvent(EventType.MOB_NPC_CHASE_ENDED, {
      mobId: mobState.mobId,
      targetPlayerId: previousTarget || "",
    });

    // Start returning to home position
    this.returnToHome(mobState);
  }

  private returnToHome(_mobState: MobAIStateData): void {
    // DISABLED: Return-to-home movement now handled by MobEntity.handleFleeState()
    // MobEntity automatically returns to spawn when target is lost
    // This system only triggers the state change, not the actual movement
  }

  private updateMobAI(): void {
    const now = Date.now();

    // Increment tick counter for tolerance system
    this.currentTick++;

    for (const [_mobId, mobState] of this.mobStates) {
      // Skip if in combat - combat system handles behavior
      if (mobState.isInCombat) continue;

      // Strong type assumption - positions are always valid Position3D objects
      if (!mobState.currentPosition || !mobState.homePosition) {
        console.warn(
          `[AggroSystem] Missing positions for mob ${mobState.mobId}`,
        );
        continue;
      }

      // Check leashing - if too far from home, return
      const homeDistance = calculateDistance(
        mobState.currentPosition,
        mobState.homePosition,
      );
      if (homeDistance > mobState.leashRange) {
        if (mobState.isChasing) {
          this.stopChasing(mobState);
        } else {
          this.returnToHome(mobState);
        }
        continue;
      }

      // Clean up old aggro targets
      this.cleanupAggroTargets(mobState);

      // If chasing, update chase behavior
      if (mobState.isChasing && mobState.currentTarget) {
        this.updateChasing(mobState);
      } else if (
        mobState.behavior === "aggressive" &&
        mobState.aggroTargets.size > 0
      ) {
        // Check if we should start chasing someone
        const bestTarget = this.getBestAggroTarget(mobState);
        this.startChasing(mobState, bestTarget.playerId);
      } else if (!mobState.isChasing && now - mobState.lastAction > 5000) {
        // Patrol behavior when not chasing
        this.updatePatrol(mobState);
        mobState.lastAction = now;
      }
    }
  }

  private cleanupAggroTargets(mobState: MobAIStateData): void {
    const now = Date.now();

    for (const [playerId, aggroTarget] of mobState.aggroTargets) {
      // Remove aggro if not seen for 10 seconds
      if (now - aggroTarget.lastSeen > 10000) {
        mobState.aggroTargets.delete(playerId);
      }
    }
  }

  private getBestAggroTarget(mobState: MobAIStateData): AggroTarget {
    let bestTarget!: AggroTarget;
    let highestAggro = 0;

    for (const [_playerId, aggroTarget] of mobState.aggroTargets) {
      if (aggroTarget.aggroLevel > highestAggro) {
        highestAggro = aggroTarget.aggroLevel;
        bestTarget = aggroTarget;
      }
    }

    return bestTarget;
  }

  private updateChasing(mobState: MobAIStateData): void {
    // Ensure we have a valid target
    if (!mobState.currentTarget) {
      this.stopChasing(mobState);
      return;
    }

    const player = this.world.getPlayer(mobState.currentTarget)!;

    // Strong type assumption - player.node.position is always Vector3
    if (!player.node?.position) {
      console.warn(`[AggroSystem] Player ${player.id} has no node`);
      this.stopChasing(mobState);
      return;
    }

    const distance = calculateDistance(
      mobState.currentPosition,
      player.node.position,
    );
    const aggroTarget = mobState.aggroTargets.get(mobState.currentTarget);

    if (!aggroTarget || distance > mobState.detectionRange * 1.5) {
      // Lost target or too far
      this.stopChasing(mobState);
      return;
    }

    // Update aggro target distance
    aggroTarget.distance = distance;
    aggroTarget.lastSeen = Date.now();

    // If close enough, start combat
    if (distance <= 2.0 && !mobState.isInCombat) {
      this.startCombatWithPlayer(mobState, mobState.currentTarget);
    }
    // NOTE: Movement requests removed - MobEntity handles all movement via its own AI
    // MobEntity.serverUpdate() detects target and moves towards it
    // Emitting MOB_MOVE_REQUEST events was redundant and no system handled them
  }

  private updatePatrol(_mobState: MobAIStateData): void {
    // DISABLED: Patrol movement now handled by MobEntity.serverUpdate()
    // MobEntity has built-in patrol logic with patrol points
    // This system only tracks aggro state, not actual movement
  }

  private onCombatStarted(data: {
    attackerId: string;
    targetId: string;
    entityType?: string;
  }): void {
    // Handle combat session started - update mob AI state
    const mobState =
      this.mobStates.get(data.attackerId) || this.mobStates.get(data.targetId);
    if (mobState) {
      mobState.isInCombat = true;
      mobState.isChasing = false; // Stop chasing when in combat

      // If mob is the attacker, set target
      if (mobState.mobId === data.attackerId) {
        mobState.currentTarget = data.targetId;
      }
    }
  }

  private onCombatEnded(data: {
    attackerId: string;
    targetId: string;
    reason?: string;
  }): void {
    // Handle combat session ended - update mob AI state
    const mobState =
      this.mobStates.get(data.attackerId) || this.mobStates.get(data.targetId);
    if (mobState) {
      mobState.isInCombat = false;

      // Clear target if combat ended
      if (data.reason === "death" || data.reason === "flee") {
        mobState.currentTarget = null;
        mobState.aggroTargets.clear();
      }
    }
  }

  private shouldIgnorePlayer(
    mobState: MobAIStateData,
    playerCombatLevel: number,
  ): boolean {
    // Check if mob should ignore player based on level (GDD requirement)
    // Use levelIgnore from mobState (set from manifest during registration)
    const levelIgnoreThreshold = mobState.levelIgnore;

    // Check level-based aggression per GDD
    if (playerCombatLevel > levelIgnoreThreshold) {
      // Player is too high level, mob ignores them (except special cases)
      if (levelIgnoreThreshold < 999) {
        // Special cases like Dark Warriors have levelIgnoreThreshold: 999
        return true; // Should ignore this player
      }
    }

    return false; // Should not ignore this player
  }

  private checkAggroUpdates(data: {
    playerId: string;
    oldLevel: number;
    newLevel: number;
    skill?: string;
  }): void {
    // Handle player level changes - update aggro status for all mobs
    // Per GDD: low-level aggressive mobs should ignore high-level players
    const playerId = data.playerId;
    const newLevel = data.newLevel;

    // Check all mobs for aggro changes
    for (const [_mobId, mobState] of this.mobStates) {
      if (mobState.behavior === "passive") continue;

      const aggroTarget = mobState.aggroTargets.get(playerId);
      if (aggroTarget) {
        // Re-evaluate aggro based on new level
        const shouldIgnore = this.shouldIgnorePlayer(mobState, newLevel);
        if (shouldIgnore && mobState.currentTarget === playerId) {
          // Stop targeting this player
          this.stopChasing(mobState);
          mobState.aggroTargets.delete(playerId);
        }
      }
    }
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    // Clear all mob states and aggro data
    this.mobStates.clear();

    // Call parent cleanup (automatically handles interval cleanup)
    super.destroy();
  }
}
