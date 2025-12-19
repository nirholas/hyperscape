/**
 * DamageHandler Interface
 *
 * Strategy pattern for entity-type-specific combat logic.
 * Eliminates player/mob conditionals in CombatSystem.
 *
 * Each entity type (player, mob) has its own handler that implements
 * this interface, allowing CombatSystem to treat all entities uniformly.
 */

import type { EntityID } from "../../../../types/core/identifiers";
import type { Entity } from "../../../../entities/Entity";

/**
 * Result of applying damage to a target
 */
export interface DamageResult {
  /** Actual damage dealt (may differ from requested if target has less health) */
  actualDamage: number;
  /** Whether the target died from this damage */
  targetDied: boolean;
  /** Whether damage was successfully applied */
  success: boolean;
}

/**
 * DamageHandler - Interface for entity-type-specific damage logic
 *
 * Implementations handle:
 * - Damage application with entity-specific systems
 * - Health tracking
 * - Retaliation logic
 * - Protection/loading states
 */
export interface DamageHandler {
  /** Entity type this handler manages */
  readonly entityType: "player" | "mob";

  /**
   * Apply damage to target
   *
   * @param targetId - Target entity ID
   * @param damage - Damage amount to apply
   * @param attackerId - Attacker entity ID
   * @param attackerType - Type of attacker
   * @returns Result with actual damage dealt and target status
   */
  applyDamage(
    targetId: EntityID,
    damage: number,
    attackerId: EntityID,
    attackerType: "player" | "mob",
  ): DamageResult;

  /**
   * Get current health of entity
   *
   * @param entityId - Entity to check
   * @returns Current health value
   */
  getHealth(entityId: EntityID): number;

  /**
   * Check if entity is alive
   *
   * @param entityId - Entity to check
   * @returns true if entity is alive
   */
  isAlive(entityId: EntityID): boolean;

  /**
   * Check if entity can retaliate on this tick
   *
   * For players: checks auto-retaliate setting and AFK status
   * For mobs: checks retaliates config and combat state
   *
   * @param entityId - Entity to check
   * @param currentTick - Current game tick
   * @returns true if entity can retaliate
   */
  canRetaliate(entityId: EntityID, currentTick: number): boolean;

  /**
   * Check if entity is in a protected state (cannot be attacked)
   *
   * For players: loading protection
   * For mobs: always false (mobs don't have protection)
   *
   * @param entityId - Entity to check
   * @returns true if entity is protected
   */
  isProtected(entityId: EntityID): boolean;

  /**
   * Check if entity is attackable
   *
   * Combines alive check, protection check, and entity-specific logic
   *
   * @param entityId - Entity to check
   * @returns true if entity can be attacked
   */
  isAttackable(entityId: EntityID): boolean;

  /**
   * Get entity by ID
   *
   * @param entityId - Entity ID to look up
   * @returns Entity or null if not found
   */
  getEntity(entityId: EntityID): Entity | null;

  /**
   * Get display name for combat messages
   *
   * @param entityId - Entity to get name for
   * @returns Display name string
   */
  getDisplayName(entityId: EntityID): string;
}
