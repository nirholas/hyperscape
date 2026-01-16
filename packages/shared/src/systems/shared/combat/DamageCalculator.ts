/**
 * DamageCalculator - Melee damage calculation utilities for combat
 *
 * Single Responsibility: Calculate damage for melee attacks.
 * Extracted from CombatSystem to improve testability and reuse.
 */

import { Entity } from "../../../entities/Entity";
import { MobEntity } from "../../../entities/npc/MobEntity";
import { AttackType } from "../../../types/core/core";
import {
  calculateDamage,
  CombatStats,
  CombatStyle,
  PrayerCombatBonuses,
} from "../../../utils/game/CombatCalculations";
import { isMobEntity } from "../../../utils/typeGuards";

/**
 * Equipment stats for damage bonus calculation
 */
export interface EquipmentStats {
  attack: number;
  strength: number;
  defense: number;
  ranged: number;
}

/**
 * DamageCalculator handles all melee damage calculations
 */
export class DamageCalculator {
  private playerEquipmentStats: Map<string, EquipmentStats>;

  constructor(playerEquipmentStats: Map<string, EquipmentStats>) {
    this.playerEquipmentStats = playerEquipmentStats;
  }

  /**
   * Update equipment stats reference
   */
  setEquipmentStats(playerEquipmentStats: Map<string, EquipmentStats>): void {
    this.playerEquipmentStats = playerEquipmentStats;
  }

  /**
   * Calculate melee damage for an attack
   * @param attacker - The attacking entity
   * @param target - The target entity
   * @param style - Combat style for OSRS-accurate stat bonuses (default: "accurate")
   * @param attackerPrayerBonuses - Prayer multipliers for attacker (optional)
   * @param defenderPrayerBonuses - Prayer multipliers for defender (optional)
   * @returns Calculated damage value
   */
  calculateMeleeDamage(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    style: CombatStyle = "accurate",
    attackerPrayerBonuses?: PrayerCombatBonuses,
    defenderPrayerBonuses?: PrayerCombatBonuses,
  ): number {
    // Extract required properties for damage calculation
    let attackerData: {
      stats?: CombatStats;
      config?: { attackPower?: number };
    } = {};
    let targetData: { stats?: CombatStats; config?: { defense?: number } } = {};

    // Use type guard to check if attacker is a MobEntity
    const attackerIsMob = isMobEntity(attacker);
    if (attackerIsMob) {
      const mobData = attacker.getMobData();
      attackerData = {
        stats: { attack: mobData.attack },
        config: { attackPower: mobData.attackPower },
      };
    } else {
      // Handle player or other Entity - get stats from components
      const statsComponent = attacker.getComponent("stats");
      if (statsComponent?.data) {
        // Extract .level from SkillData objects for combat calculations
        const stats = statsComponent.data as {
          attack?: { level: number } | number;
          strength?: { level: number } | number;
          defense?: { level: number } | number;
          ranged?: { level: number } | number;
        };
        attackerData = {
          stats: {
            attack:
              typeof stats.attack === "object"
                ? stats.attack.level
                : (stats.attack ?? 1),
            strength:
              typeof stats.strength === "object"
                ? stats.strength.level
                : (stats.strength ?? 1),
            defense:
              typeof stats.defense === "object"
                ? stats.defense.level
                : (stats.defense ?? 1),
            ranged:
              typeof stats.ranged === "object"
                ? stats.ranged.level
                : (stats.ranged ?? 1),
          },
        };
      }
    }

    // Use type guard to check if target is a MobEntity
    if (isMobEntity(target)) {
      const mobData = target.getMobData();
      targetData = {
        stats: { defense: mobData.defense },
        config: { defense: mobData.defense },
      };
    } else {
      // Handle player or other Entity
      const statsComponent = target.getComponent("stats");
      if (statsComponent?.data) {
        // Extract .level from SkillData objects for combat calculations
        const stats = statsComponent.data as {
          attack?: { level: number } | number;
          strength?: { level: number } | number;
          defense?: { level: number } | number;
          ranged?: { level: number } | number;
        };
        targetData = {
          stats: {
            attack:
              typeof stats.attack === "object"
                ? stats.attack.level
                : (stats.attack ?? 1),
            strength:
              typeof stats.strength === "object"
                ? stats.strength.level
                : (stats.strength ?? 1),
            defense:
              typeof stats.defense === "object"
                ? stats.defense.level
                : (stats.defense ?? 1),
            ranged:
              typeof stats.ranged === "object"
                ? stats.ranged.level
                : (stats.ranged ?? 1),
          },
        };
      }
    }

    // Get equipment stats for player attacker
    let equipmentStats: EquipmentStats | undefined = undefined;
    if (!attackerIsMob) {
      // Attacker is a player - get equipment stats
      equipmentStats = this.playerEquipmentStats.get(attacker.id);
    }

    const result = calculateDamage(
      attackerData,
      targetData,
      AttackType.MELEE,
      equipmentStats,
      style,
      undefined, // defenderStyle - not tracked for mobs
      attackerPrayerBonuses,
      defenderPrayerBonuses,
    );

    return result.damage;
  }
}
