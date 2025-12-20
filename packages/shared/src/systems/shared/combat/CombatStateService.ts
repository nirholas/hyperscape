/**
 * CombatStateService - Combat state management
 *
 * Single Responsibility: Manage combat state data and entity sync
 * Handles the combatStates Map, entity sync, and state queries.
 */

import type { World } from "../../../core/World";
import { AttackType } from "../../../types/core/core";
import { EntityID } from "../../../types/core/identifiers";
import { createEntityID } from "../../../utils/IdentifierUtils";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";

/**
 * Combat data for a single combatant
 */
export interface CombatData {
  attackerId: EntityID;
  targetId: EntityID;
  attackerType: "player" | "mob";
  targetType: "player" | "mob";
  weaponType: AttackType;
  inCombat: boolean;

  // TICK-BASED timing (OSRS-accurate)
  lastAttackTick: number;
  nextAttackTick: number;
  combatEndTick: number;
  attackSpeedTicks: number;
}

/**
 * Interface for player entity combat state
 */
interface CombatPlayerEntity {
  id: string;
  combat?: {
    inCombat: boolean;
    combatTarget: string | null;
    pendingAttacker?: string | null; // Stores attacker ID when auto-retaliate is OFF
  };
  data?: {
    c?: boolean;
    ct?: string | null;
    pa?: string | null; // Pending attacker (abbreviated for network efficiency)
  };
  markNetworkDirty?: () => void;
}

export class CombatStateService {
  private world: World;
  private combatStates = new Map<EntityID, CombatData>();

  // Reusable buffer to avoid allocation during iteration
  private combatStateBuffer: Array<[EntityID, CombatData]> = [];

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Check if entity is in combat
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   */
  isInCombat(entityId: EntityID | string): boolean {
    const typedId =
      typeof entityId === "string" ? createEntityID(entityId) : entityId;
    return this.combatStates.has(typedId);
  }

  /**
   * Get combat data for an entity
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   */
  getCombatData(entityId: EntityID | string): CombatData | null {
    const typedId =
      typeof entityId === "string" ? createEntityID(entityId) : entityId;
    return this.combatStates.get(typedId) || null;
  }

  /**
   * Get all combat states (for iteration)
   * Returns reusable buffer to avoid allocations
   */
  getAllCombatStates(): Array<[EntityID, CombatData]> {
    this.combatStateBuffer.length = 0;
    for (const entry of this.combatStates.entries()) {
      this.combatStateBuffer.push(entry);
    }
    return this.combatStateBuffer;
  }

  /**
   * Get the underlying Map (for direct iteration when needed)
   */
  getCombatStatesMap(): Map<EntityID, CombatData> {
    return this.combatStates;
  }

  /**
   * Set combat state for an entity
   */
  setCombatState(entityId: EntityID, data: CombatData): void {
    this.combatStates.set(entityId, data);
  }

  /**
   * Remove combat state for an entity
   */
  removeCombatState(entityId: EntityID): void {
    this.combatStates.delete(entityId);
  }

  /**
   * Create combat state for attacker
   */
  createAttackerState(
    attackerId: EntityID,
    targetId: EntityID,
    attackerType: "player" | "mob",
    targetType: "player" | "mob",
    currentTick: number,
    attackSpeedTicks: number,
  ): CombatData {
    const combatEndTick = currentTick + COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS;

    const state: CombatData = {
      attackerId,
      targetId,
      attackerType,
      targetType,
      weaponType: AttackType.MELEE,
      inCombat: true,
      lastAttackTick: currentTick,
      nextAttackTick: currentTick + attackSpeedTicks,
      combatEndTick,
      attackSpeedTicks,
    };

    this.combatStates.set(attackerId, state);
    return state;
  }

  /**
   * Create combat state for retaliating target
   */
  createRetaliatorState(
    targetId: EntityID,
    attackerId: EntityID,
    targetType: "player" | "mob",
    attackerType: "player" | "mob",
    currentTick: number,
    retaliationDelay: number,
    attackSpeedTicks: number,
  ): CombatData {
    const combatEndTick = currentTick + COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS;

    const state: CombatData = {
      attackerId: targetId,
      targetId: attackerId,
      attackerType: targetType,
      targetType: attackerType,
      weaponType: AttackType.MELEE,
      inCombat: true,
      lastAttackTick: currentTick,
      nextAttackTick: currentTick + retaliationDelay,
      combatEndTick,
      attackSpeedTicks,
    };

    this.combatStates.set(targetId, state);
    return state;
  }

  /**
   * Update combat end tick (for extending combat timer on hit)
   */
  extendCombatTimer(entityId: EntityID, currentTick: number): void {
    const state = this.combatStates.get(entityId);
    if (state) {
      state.combatEndTick = currentTick + COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS;
    }
  }

  /**
   * Sync combat state to player entity for client-side awareness
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   * @param targetId - Target ID (accepts both EntityID and string for backwards compatibility)
   */
  syncCombatStateToEntity(
    entityId: EntityID | string,
    targetId: EntityID | string,
    entityType: "player" | "mob",
  ): void {
    if (entityType !== "player") return;

    const entityIdStr = String(entityId);
    const targetIdStr = String(targetId);

    const playerEntity = this.world.getPlayer?.(
      entityIdStr,
    ) as CombatPlayerEntity | null;

    if (!playerEntity) return;

    // Set combat property if it exists (legacy support)
    if (playerEntity.combat) {
      playerEntity.combat.inCombat = true;
      playerEntity.combat.combatTarget = targetIdStr;
    }

    // ALWAYS set in data for network sync (abbreviated keys for efficiency)
    if (playerEntity.data) {
      playerEntity.data.c = true;
      playerEntity.data.ct = targetIdStr;

      // Send immediate network update when combat starts
      if (this.world.isServer && this.world.network?.send) {
        this.world.network.send("entityModified", {
          id: entityIdStr,
          c: true,
          ct: targetIdStr,
        });
      }
    }

    playerEntity.markNetworkDirty?.();
  }

  /**
   * Mark player as in combat but without a target (OSRS auto-retaliate OFF behavior)
   * Player is being attacked but won't fight back - still triggers combat timer
   * Stores attackerId so we can start combat if auto-retaliate is toggled ON
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   * @param attackerId - Attacker ID (accepts both EntityID and string for backwards compatibility)
   */
  markInCombatWithoutTarget(
    entityId: EntityID | string,
    attackerId?: EntityID | string,
  ): void {
    const entityIdStr = String(entityId);
    const attackerIdStr = attackerId ? String(attackerId) : null;

    const playerEntity = this.world.getPlayer?.(
      entityIdStr,
    ) as CombatPlayerEntity | null;

    if (!playerEntity) return;

    // Set combat property if it exists (legacy support)
    if (playerEntity.combat) {
      playerEntity.combat.inCombat = true;
      playerEntity.combat.combatTarget = null;
      // Store attacker for potential retaliation if auto-retaliate is toggled ON
      playerEntity.combat.pendingAttacker = attackerIdStr;
    }

    // ALWAYS set in data for network sync (abbreviated keys for efficiency)
    if (playerEntity.data) {
      playerEntity.data.c = true;
      playerEntity.data.ct = null;
      // Store pending attacker (pa) for auto-retaliate toggle
      playerEntity.data.pa = attackerIdStr;

      // Send immediate network update
      if (this.world.isServer && this.world.network?.send) {
        this.world.network.send("entityModified", {
          id: entityIdStr,
          c: true,
          ct: null,
        });
      }
    }

    playerEntity.markNetworkDirty?.();
  }

  /**
   * Clear combat state from player entity when combat ends
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   */
  clearCombatStateFromEntity(
    entityId: EntityID | string,
    entityType: "player" | "mob",
  ): void {
    if (entityType !== "player") return;

    const entityIdStr = String(entityId);

    const playerEntity = this.world.getPlayer?.(
      entityIdStr,
    ) as CombatPlayerEntity | null;

    if (!playerEntity) return;

    // Clear combat property if it exists (legacy support)
    if (playerEntity.combat) {
      playerEntity.combat.inCombat = false;
      playerEntity.combat.combatTarget = null;
      playerEntity.combat.pendingAttacker = null;
    }

    // ALWAYS clear in data for network sync (abbreviated keys)
    if (playerEntity.data) {
      playerEntity.data.c = false;
      playerEntity.data.ct = null;
      playerEntity.data.pa = null;

      // Send immediate network update when combat ends
      if (this.world.isServer && this.world.network?.send) {
        this.world.network.send("entityModified", {
          id: entityIdStr,
          c: false,
          ct: null,
        });
      }
    }

    playerEntity.markNetworkDirty?.();
  }

  /**
   * Get all attackers targeting a specific entity
   * @param entityId - Entity ID (accepts both EntityID and string for backwards compatibility)
   */
  getAttackersTargeting(entityId: EntityID | string): EntityID[] {
    const entityIdStr = String(entityId);
    const attackers: EntityID[] = [];
    for (const [attackerId, state] of this.combatStates) {
      if (String(state.targetId) === entityIdStr) {
        attackers.push(attackerId);
      }
    }
    return attackers;
  }

  /**
   * Clear all combat state for cleanup
   */
  destroy(): void {
    this.combatStates.clear();
    this.combatStateBuffer.length = 0;
  }
}
