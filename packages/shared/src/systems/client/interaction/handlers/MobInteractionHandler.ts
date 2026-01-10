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
import { calculateCombatLevel } from "../../../../utils/game/CombatLevelCalculator";
import type { Player } from "../../../../types/core/core";
import { CONTEXT_MENU_COLORS } from "../../../../constants/GameConstants";

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
   *
   * Returns empty array for dead mobs - this allows items dropped
   * at the mob's position to be clickable instead.
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const mobData = this.getMobData(target);
    const isAlive = (mobData?.health || 0) > 0;

    // Dead mobs should not show context menu - let items underneath be clicked
    // This fixes the bug where clicking on loot shows dead mob menu instead
    if (!isAlive) {
      return [];
    }

    const actions: ContextMenuAction[] = [];
    const mobLevel = mobData?.level || 1;
    const playerLevel = this.getLocalPlayerCombatLevel();
    const levelColor = getCombatLevelColor(mobLevel, playerLevel);

    // Attack action with colored level (format: "Level: X")
    // Note: We already returned early if !isAlive, so enabled is always true
    actions.push({
      id: "attack",
      label: `Attack ${target.name} (Level: ${mobLevel})`,
      styledLabel: [
        { text: "Attack " },
        { text: target.name, color: CONTEXT_MENU_COLORS.NPC }, // Yellow for mob names (OSRS style)
        { text: " (Level: " },
        { text: `${mobLevel}`, color: levelColor },
        { text: ")" },
      ],
      enabled: true,
      priority: 1,
      handler: () => this.attackMob(target),
    });

    // Walk here
    actions.push(this.createWalkHereAction(target));

    // Examine - OSRS: "Examine Goblin"
    const examineText = this.getExamineText(target, mobData);
    actions.push({
      id: "examine",
      label: `Examine ${target.name}`,
      styledLabel: [
        { text: "Examine " },
        { text: target.name, color: CONTEXT_MENU_COLORS.NPC }, // Yellow for NPC/mob names
      ],
      enabled: true,
      priority: 100,
      handler: () => {
        this.showExamineMessage(examineText);
      },
    });

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
   *
   * Checks multiple property paths to handle different player entity types:
   * - PlayerRemote: has `combatLevel` getter
   * - PlayerLocal: stores in `combat.combatLevel` or can be calculated from skills
   */
  private getLocalPlayerCombatLevel(): number {
    const player = this.getPlayer();
    if (!player) return 3;

    const entity = player as unknown as Record<string, unknown>;

    // 1. Check direct getter (PlayerRemote)
    if (typeof entity.combatLevel === "number") {
      return entity.combatLevel;
    }

    // 2. Check data object (raw entity data from server sync)
    const data = entity.data as { combatLevel?: number } | undefined;
    if (typeof data?.combatLevel === "number" && data.combatLevel > 1) {
      return data.combatLevel;
    }

    // 3. Calculate from skills (PlayerLocal has synced skills via SKILLS_UPDATED)
    // This is the most reliable method for the local player
    const skills = entity.skills as
      | Record<string, { level: number }>
      | undefined;
    if (skills) {
      return calculateCombatLevel({
        attack: skills.attack?.level || 1,
        strength: skills.strength?.level || 1,
        defense: skills.defense?.level || 1,
        hitpoints: skills.constitution?.level || 10,
        ranged: skills.ranged?.level || 1,
        magic: skills.magic?.level || 1,
        prayer: skills.prayer?.level || 1,
      });
    }

    // 4. Check nested combat object (PlayerLocal - fallback)
    const combat = entity.combat as { combatLevel?: number } | undefined;
    if (typeof combat?.combatLevel === "number" && combat.combatLevel > 1) {
      return combat.combatLevel;
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
