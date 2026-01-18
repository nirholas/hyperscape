/**
 * NPC Strategy Interfaces (Dependency Inversion Principle)
 *
 * These interfaces define the contracts for NPC behavior systems.
 * Following SOLID principles, high-level modules (NPCTickProcessor)
 * depend on these abstractions, not concrete implementations.
 *
 */

import type { TileCoord } from "../../systems/shared/movement/TileSystem";
import type { Position3D } from "../core";
import type { AttackType } from "../core/core";

/**
 * Minimal interface for entities that can be NPC targets
 */
export interface NPCTarget {
  id: string;
  position: Position3D;
  isDead(): boolean;
  isLoading?: boolean;
}

/**
 * Minimal interface for NPC entities processed by the tick system
 * Named ProcessableNPC to avoid conflict with NPCEntity in world-types
 */
export interface ProcessableNPC {
  id: string;
  position: Position3D;
  spawnOrder: number;
  isDead(): boolean;
  hasTarget(): boolean;
  getTarget(): string | null;
  setTarget(targetId: string | null): void;
  getCurrentTile(): TileCoord;
  getSpawnTile(): TileCoord;
  getHuntRange(): number;
  getAttackRange(): number;
  getMaxRange(): number;
  getAttackType(): AttackType;
  getSize(): number;
  isInCombat(): boolean;
  shouldWander(currentTick: number): boolean;
  hasWanderPath(): boolean;
}

/**
 * Result of damage calculation
 */
export interface DamageResult {
  damage: number;
  isCritical: boolean;
  damageType: AttackType;
  didHit: boolean;
}

/**
 * Aggro Strategy Interface
 *
 * Responsible for target acquisition and validation.
 * Implementations determine how NPCs select targets.
 */
export interface IAggroStrategy {
  /**
   * Find a valid target for the NPC
   * @param npc - The NPC looking for targets
   * @param candidates - Buffer to fill with valid candidates (no allocation)
   * @returns Selected target or null
   */
  findTarget(npc: ProcessableNPC, candidates: NPCTarget[]): NPCTarget | null;

  /**
   * Check if NPC should aggro on a specific target
   * @param npc - The NPC
   * @param target - Potential target
   * @returns true if NPC should aggro
   */
  shouldAggro(npc: ProcessableNPC, target: NPCTarget): boolean;

  /**
   * Clear aggro state for an NPC
   * @param npcId - NPC to clear
   */
  clearAggro(npcId: string): void;
}

/**
 * Path Strategy Interface
 *
 * Responsible for NPC pathfinding and movement.
 * Uses the "dumb pathfinder" for chase behavior.
 */
export interface IPathStrategy {
  /**
   * Calculate the next step for an NPC
   * @param npc - The NPC to move
   * @param targetTile - Destination tile (or null for wander)
   * @returns Next tile to move to, or null if blocked
   */
  calculateNextStep(
    npc: ProcessableNPC,
    targetTile: TileCoord | null,
  ): TileCoord | null;

  /**
   * Check if NPC is blocked from moving
   * @param npc - The NPC to check
   * @returns true if blocked
   */
  isBlocked(npc: ProcessableNPC): boolean;

  /**
   * Check if blocked by an entity (path should persist)
   * vs terrain (path should clear - safespotted)
   * @param npc - The NPC to check
   * @returns true if blocked by entity, false if by terrain
   */
  isBlockedByEntity(npc: ProcessableNPC): boolean;

  /**
   * Clear path state for an NPC
   * @param npcId - NPC to clear
   */
  clearPath(npcId: string): void;
}

/**
 * Combat Strategy Interface
 *
 * Responsible for combat calculations and attack processing.
 */
export interface ICombatStrategy {
  /**
   * Check if attacker is in range of target
   * @param attacker - The attacking entity
   * @param target - The target entity
   * @returns true if in attack range
   */
  isInRange(attacker: ProcessableNPC, target: NPCTarget): boolean;

  /**
   * Process an attack from NPC to target
   * @param attacker - The attacking NPC
   * @param target - The target entity
   * @param tick - Current server tick
   */
  processAttack(
    attacker: ProcessableNPC,
    target: NPCTarget,
    tick: number,
  ): void;

  /**
   * Calculate damage for an attack
   * @param attacker - The attacking entity
   * @param target - The target entity
   * @returns Damage result
   */
  calculateDamage(attacker: ProcessableNPC, target: NPCTarget): DamageResult;

  /**
   * Check if NPC can attack this tick
   * @param npcId - NPC to check
   * @param currentTick - Current server tick
   * @returns true if can attack
   */
  canAttack(npcId: string, currentTick: number): boolean;
}
