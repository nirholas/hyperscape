/**
 * PlayerInteractionHandler
 *
 * Handles interactions with other players (OSRS-accurate).
 *
 * Menu order (matches OSRS):
 * 1. Attack PlayerName (level-XX) - ONLY APPEARS in PvP zones (not shown elsewhere)
 * 2. Trade with PlayerName - disabled until trading implemented
 * 3. Follow PlayerName
 * 4. Report PlayerName
 * 5. Walk here
 * 6. Examine
 *
 * Note: Left-click on players does nothing by default (OSRS behavior).
 * All player interactions require right-click context menu.
 *
 * @see https://oldschool.runescape.wiki/w/Player_killing - Attack only in PvP areas
 */

import { BaseInteractionHandler } from "./BaseInteractionHandler";
import type { RaycastTarget, ContextMenuAction } from "../types";
import { INTERACTION_RANGE, MESSAGE_TYPES } from "../constants";
import type { ZoneDetectionSystem } from "../../../shared/death/ZoneDetectionSystem";

export class PlayerInteractionHandler extends BaseInteractionHandler {
  /**
   * Left-click: No action (OSRS behavior)
   *
   * Players require right-click to interact.
   */
  onLeftClick(_target: RaycastTarget): void {
    // No-op - players need right-click menu
  }

  /**
   * Right-click: Show player interaction options (OSRS order)
   */
  getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    const targetLevel = this.getPlayerCombatLevel(target.entityId);
    const inPvPZone = this.isInPvPZone();

    // 1. Attack (OSRS-accurate: only APPEARS in PvP zones, not just greyed out)
    if (inPvPZone) {
      actions.push({
        id: "attack",
        label: `Attack ${target.name} (level-${targetLevel})`,
        icon: "⚔️",
        enabled: true,
        priority: 0,
        handler: () => this.attackPlayer(target),
      });
    }

    // 2. Trade with - Priority 1
    actions.push({
      id: "trade",
      label: `Trade with ${target.name}`,
      icon: "🤝",
      enabled: false, // Disabled until trading implemented
      priority: 1,
      handler: () => this.showExamineMessage("Trading is not yet available."),
    });

    // 3. Follow - Priority 2
    actions.push({
      id: "follow",
      label: `Follow ${target.name}`,
      icon: "👣",
      enabled: true,
      priority: 2,
      handler: () => this.followPlayer(target),
    });

    // 4. Report - Priority 3
    actions.push({
      id: "report",
      label: `Report ${target.name}`,
      icon: "🚩",
      enabled: true,
      priority: 3,
      handler: () => this.showExamineMessage("Report system coming soon."),
    });

    // 5. Walk here - Priority 99
    actions.push(this.createWalkHereAction(target));

    // 6. Examine - Priority 100
    actions.push(
      this.createExamineAction(target, `${target.name}, a fellow adventurer.`),
    );

    return actions.sort((a, b) => a.priority - b.priority);
  }

  getActionRange(_actionId: string): number {
    return INTERACTION_RANGE.ADJACENT;
  }

  // === Private Methods ===

  /**
   * Check if the LOCAL player is currently in a PvP-enabled zone.
   */
  private isInPvPZone(): boolean {
    const player = this.getPlayer();
    if (!player) return false;

    const position = player.position;
    if (!position) return false;

    // Use ZoneDetectionSystem
    const zoneSystem =
      this.world.getSystem<ZoneDetectionSystem>("zone-detection");
    if (!zoneSystem) {
      // Fallback: no zone system = safe (conservative)
      return false;
    }

    return zoneSystem.isPvPEnabled({ x: position.x, z: position.z });
  }

  /**
   * Send attack request to server.
   */
  private attackPlayer(target: RaycastTarget): void {
    if (!this.isInPvPZone()) {
      this.showExamineMessage("You can't attack players here.");
      return;
    }

    this.send(MESSAGE_TYPES.ATTACK_PLAYER, {
      targetPlayerId: target.entityId,
    });

    this.addChatMessage(`Attacking ${target.name}...`);
  }

  /**
   * Get target player's combat level.
   * Falls back to 3 (OSRS minimum) if unknown.
   */
  private getPlayerCombatLevel(playerId: string): number {
    const playerEntity = this.world.entities?.players?.get(playerId);
    if (playerEntity) {
      const entity = playerEntity as unknown as { combatLevel?: number };
      if (typeof entity.combatLevel === "number") {
        return entity.combatLevel;
      }
    }
    // Fallback: OSRS minimum combat level
    return 3;
  }

  private followPlayer(target: RaycastTarget): void {
    this.send(MESSAGE_TYPES.FOLLOW_PLAYER, {
      targetPlayerId: target.entityId,
    });

    this.addChatMessage(`Following ${target.name}.`);
  }
}
