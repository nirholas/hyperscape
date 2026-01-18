/**
 * MobDamageHandler
 *
 * Handles mob-specific damage application, health checks,
 * and retaliation logic.
 *
 * Extracted from CombatSystem to eliminate player/mob conditionals.
 */

import type { World } from "../../../../core/World";
import type { DamageHandler, DamageResult } from "./DamageHandler";
import type { EntityID } from "../../../../types/core/identifiers";
import type { Entity } from "../../../../entities/Entity";
import { EventType } from "../../../../types/events";
import { getMobRetaliates } from "../../../../utils/typeGuards";

/**
 * Mob interface for damage operations
 * Supports both real MobEntity and test mocks via duck-typing
 */
interface MobLike {
  getHealth(): number;
  isDead(): boolean;
  takeDamage(damage: number, attackerId?: string): boolean;
  getProperty?(key: string): unknown;
}

/**
 * MobDamageHandler - Implements DamageHandler for mob entities
 *
 * Uses MobEntity.takeDamage() for damage application.
 * Mobs retaliate based on their config.retaliates flag.
 */
export class MobDamageHandler implements DamageHandler {
  readonly entityType = "mob" as const;

  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  applyDamage(
    targetId: EntityID,
    damage: number,
    attackerId: EntityID,
    _attackerType: "player" | "mob",
  ): DamageResult {
    // Validate attacker exists before applying damage
    // This prevents spoofed damage from non-existent attackers
    const attacker = this.world.entities.get(String(attackerId));
    if (!attacker) {
      console.warn(
        `[MobDamageHandler] Rejecting damage - attacker ${attackerId} does not exist`,
      );
      return { actualDamage: 0, targetDied: false, success: false };
    }

    const mobEntity = this.getEntity(targetId) as MobLike | null;
    if (!mobEntity) {
      return { actualDamage: 0, targetDied: false, success: false };
    }

    // Check if mob is already dead
    if (mobEntity.isDead()) {
      return { actualDamage: 0, targetDied: true, success: false };
    }

    const healthBefore = mobEntity.getHealth();

    // Apply damage through MobEntity.takeDamage()
    // Returns true if mob died from the damage
    const mobDied = mobEntity.takeDamage(damage, String(attackerId));

    // Emit MOB_NPC_ATTACKED event so EntityManager can track damage
    this.world.emit(EventType.MOB_NPC_ATTACKED, {
      mobId: String(targetId),
      damage: damage,
      attackerId: String(attackerId),
    });

    const healthAfter = mobEntity.getHealth();
    const actualDamage = healthBefore - healthAfter;

    return { actualDamage, targetDied: mobDied, success: true };
  }

  getHealth(entityId: EntityID): number {
    const mob = this.getEntity(entityId) as MobLike | null;
    return mob?.getHealth() ?? 0;
  }

  isAlive(entityId: EntityID): boolean {
    const mob = this.getEntity(entityId) as MobLike | null;
    if (!mob) return false;
    return !mob.isDead();
  }

  canRetaliate(entityId: EntityID, _currentTick: number): boolean {
    const mob = this.getEntity(entityId) as MobLike | null;
    if (!mob) return false;

    // Check if mob is configured to retaliate using type guard
    // Mobs with retaliates: false are peaceful (default: true)
    return getMobRetaliates(mob);
  }

  isProtected(_entityId: EntityID): boolean {
    // Mobs don't have loading protection like players
    return false;
  }

  isAttackable(entityId: EntityID): boolean {
    if (!this.isAlive(entityId)) return false;
    // Mobs are always attackable if alive
    return true;
  }

  getEntity(entityId: EntityID): Entity | null {
    const entity = this.world.entities.get(String(entityId));
    if (!entity) return null;

    // Duck-type check for mob interface (supports both real MobEntity and test mocks)
    // Mobs must have: takeDamage method, getHealth method, isDead method
    const maybeMob = entity as {
      takeDamage?: unknown;
      getHealth?: unknown;
      isDead?: unknown;
    };
    if (
      typeof maybeMob.takeDamage === "function" &&
      typeof maybeMob.getHealth === "function" &&
      typeof maybeMob.isDead === "function"
    ) {
      return entity as Entity;
    }

    return null;
  }

  getDisplayName(entityId: EntityID): string {
    const mob = this.getEntity(entityId) as MobLike | null;
    if (!mob) return "mob";

    // Try to get mob name from properties or config
    const name = mob.getProperty?.("name") as string | undefined;
    if (name) return name;

    const mobType = mob.getProperty?.("mobType") as string | undefined;
    if (mobType) return mobType;

    return "mob";
  }
}
