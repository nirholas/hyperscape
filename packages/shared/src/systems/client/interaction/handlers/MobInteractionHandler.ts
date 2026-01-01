/**
 * MobInteractionHandler
 *
 * Handles interactions with hostile mobs.
 *
 * Actions:
 * - Attack (left-click primary, context menu)
 * - Walk here
 * - Examine
 *
 * OSRS-Style Behavior:
 * - Combat range based on equipped weapon
 * - Must be within range but NOT on same tile
 * - Tracks moving targets (mobs that wander)
 */

import { BaseInteractionHandler } from "./BaseInteractionHandler";
import type { RaycastTarget, ContextMenuAction } from "../types";
import { INTERACTION_RANGE, TIMING, MESSAGE_TYPES } from "../constants";
import { getCombatLevelColor } from "../utils/combatLevelColor";
import { getNPCById } from "../../../../data/npcs";
import { getPlayerWeaponRange } from "../../../../utils/game/CombatUtils";
import type { Player } from "../../../../types/core/core";

/**
 * Mob entity interface for type safety
 */
interface MobEntity {
  getMobData?: () => { health?: number; level?: number; type?: string } | null;
  config?: { mobType?: string };
}

export class MobInteractionHandler extends BaseInteractionHandler {
  /**
   * Left-click: Attack mob (if alive)
   */
  onLeftClick(target: RaycastTarget): void {
    const mobData = this.getMobData(target);
    const isAlive = (mobData?.health || 0) > 0;

    if (!isAlive) {
      return; // Don't attack dead mobs
    }

    this.attackMob(target);
  }

  /**
   * Right-click: Show attack and other options
   *
   * Mob levels are colored based on relative level difference:
   * - Green: Mob is lower level than you
   * - Yellow: Mob is same level as you
   * - Red: Mob is higher level than you
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    const mobData = this.getMobData(target);
    const isAlive = (mobData?.health || 0) > 0;
    const mobLevel = mobData?.level || 1;
    const playerLevel = this.getLocalPlayerCombatLevel();
    const levelColor = getCombatLevelColor(mobLevel, playerLevel);

    // Attack action with colored level
    actions.push({
      id: "attack",
      label: `Attack ${target.name} (Lv${mobLevel})`,
      styledLabel: [
        { text: "Attack " },
        { text: target.name, color: "#ffff00" }, // Yellow for mob names (OSRS style)
        { text: " (Lv" },
        { text: `${mobLevel}`, color: levelColor },
        { text: ")" },
      ],
      icon: "⚔️",
      enabled: isAlive,
      priority: 1,
      handler: () => {
        if (isAlive) {
          this.attackMob(target);
        }
      },
    });

    // Walk here
    actions.push(this.createWalkHereAction(target));

    // Examine
    const examineText = this.getExamineText(target, mobData);
    actions.push(this.createExamineAction(target, examineText));

    return actions.sort((a, b) => a.priority - b.priority);
  }

  getActionRange(_actionId: string): number {
    const player = this.getPlayer();
    if (player) {
      return this.getPlayerCombatRange(player);
    }
    return INTERACTION_RANGE.MELEE;
  }

  // === Private Methods ===

  private attackMob(target: RaycastTarget): void {
    const player = this.getPlayer();
    if (!player) return;

    // Check debounce to prevent rapid clicking spam
    const debounceKey = `attack:${player.id}:${target.entityId}`;
    if (this.actionQueue.isDebounced(debounceKey, TIMING.ATTACK_DEBOUNCE_MS)) {
      return;
    }

    // Server-authoritative attack system:
    // Send attack request immediately - server handles OSRS-style pathfinding
    // (cardinal-only melee range, path-to-adjacent tile)
    this.send(MESSAGE_TYPES.ATTACK_MOB, {
      mobId: target.entityId,
      attackType: "melee",
    });
  }

  private getMobData(
    target: RaycastTarget,
  ): { health?: number; level?: number; type?: string } | null {
    const entity = target.entity as unknown as MobEntity;
    return entity.getMobData?.() || null;
  }

  private getPlayerCombatRange(player: { id: string }): number {
    const playerData = player as unknown as Player;
    return getPlayerWeaponRange(playerData);
  }

  /**
   * Get local player's combat level.
   * Used for relative color calculation (green/yellow/red).
   * Falls back to 3 (OSRS minimum) if unknown.
   */
  private getLocalPlayerCombatLevel(): number {
    const player = this.getPlayer();
    if (!player) return 3;

    const entity = player as unknown as { combatLevel?: number };
    if (typeof entity.combatLevel === "number") {
      return entity.combatLevel;
    }
    // Fallback: OSRS minimum combat level
    return 3;
  }

  private getExamineText(
    target: RaycastTarget,
    mobData: { level?: number; type?: string } | null,
  ): string {
    const entity = target.entity as unknown as MobEntity;
    const mobType = entity.config?.mobType || mobData?.type;

    if (mobType) {
      const npcData = getNPCById(mobType);
      if (npcData?.description) {
        return npcData.description;
      }
    }

    return `A level ${mobData?.level || 1} ${target.name.toLowerCase()}.`;
  }
}
