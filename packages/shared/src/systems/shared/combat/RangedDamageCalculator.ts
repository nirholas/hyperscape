/**
 * RangedDamageCalculator - OSRS-accurate ranged damage formulas
 *
 * Effective Level = floor(rangedLevel * prayerBonus) + styleBonus + 8
 * Attack Roll = effectiveLevel * (equipmentBonus + 64)
 * Defense Roll = (defenseLevel + 9) * (rangedDefenseBonus + 64)
 *
 * Hit Chance:
 *   if attackRoll > defenseRoll: 1 - (defenseRoll + 2) / (2 * (attackRoll + 1))
 *   else: attackRoll / (2 * (defenseRoll + 1))
 *
 * Max Hit = floor(0.5 + effectiveStr * (strengthBonus + 64) / 640)
 *
 * @see https://oldschool.runescape.wiki/w/Damage_per_second/Ranged
 */

import {
  RangedCombatStyle,
  RANGED_STYLE_BONUSES,
} from "../../../types/game/combat-types";
import type { PrayerBonuses } from "../../../types/game/prayer-types";
import { getGameRng, SeededRandom } from "../../../utils/SeededRandom";

/**
 * Parameters for ranged damage calculation
 */
export interface RangedDamageParams {
  /** Attacker's ranged level */
  rangedLevel: number;
  /** Equipment ranged attack bonus */
  rangedAttackBonus: number;
  /** Ranged strength bonus from ammunition */
  rangedStrengthBonus: number;
  /** Combat style */
  style: RangedCombatStyle;
  /** Target's defense level */
  targetDefenseLevel: number;
  /** Target's ranged defense bonus from equipment */
  targetRangedDefenseBonus: number;
  /** Prayer bonuses (optional) */
  prayerBonuses?: PrayerBonuses;
  /** Target's prayer bonuses (optional) */
  targetPrayerBonuses?: PrayerBonuses;
}

/**
 * Result of ranged damage calculation
 */
export interface RangedDamageResult {
  /** Actual damage dealt (0 if missed) */
  damage: number;
  /** Maximum possible hit */
  maxHit: number;
  /** Whether the attack hit */
  didHit: boolean;
  /** Calculated hit chance (0-1) */
  hitChance: number;
}

/**
 * Calculate ranged attack roll
 */
function calculateRangedAttackRoll(
  rangedLevel: number,
  rangedAttackBonus: number,
  style: RangedCombatStyle,
  prayerBonuses?: PrayerBonuses,
): number {
  const styleBonus = RANGED_STYLE_BONUSES[style];

  // Prayer multiplier
  const prayerMultiplier = prayerBonuses?.rangedAttackMultiplier ?? 1;

  // Effective level = floor(rangedLevel * prayerMultiplier) + styleBonus + 8
  const boostedLevel = Math.floor(rangedLevel * prayerMultiplier);
  const effectiveLevel = boostedLevel + styleBonus.attackBonus + 8;

  // Attack roll = effectiveLevel * (equipmentBonus + 64)
  return effectiveLevel * (rangedAttackBonus + 64);
}

/**
 * Calculate ranged defense roll
 */
function calculateRangedDefenseRoll(
  defenseLevel: number,
  rangedDefenseBonus: number,
  targetPrayerBonuses?: PrayerBonuses,
): number {
  // Prayer multiplier for defense
  const prayerMultiplier = targetPrayerBonuses?.defenseMultiplier ?? 1;

  // Effective defense = floor(defenseLevel * prayerMultiplier) + 9
  const boostedLevel = Math.floor(defenseLevel * prayerMultiplier);
  const effectiveDefense = boostedLevel + 9;

  // Defense roll = effectiveDefense * (rangedDefenseBonus + 64)
  return effectiveDefense * (rangedDefenseBonus + 64);
}

/**
 * Calculate hit chance from attack and defense rolls
 */
function calculateHitChance(attackRoll: number, defenseRoll: number): number {
  if (attackRoll > defenseRoll) {
    return 1 - (defenseRoll + 2) / (2 * (attackRoll + 1));
  } else {
    return attackRoll / (2 * (defenseRoll + 1));
  }
}

/**
 * Calculate ranged max hit
 */
function calculateRangedMaxHit(
  rangedLevel: number,
  rangedStrengthBonus: number,
  style: RangedCombatStyle,
  prayerBonuses?: PrayerBonuses,
): number {
  // Prayer multiplier for ranged strength
  const prayerMultiplier = prayerBonuses?.rangedStrengthMultiplier ?? 1;

  // Effective strength = floor(rangedLevel * prayerMultiplier) + styleBonus + 8
  // Note: For ranged, we use rangedLevel for both attack and strength calculations
  const boostedLevel = Math.floor(rangedLevel * prayerMultiplier);

  // Accurate style gives +3 to effective level for accuracy, not strength
  // Only accurate gives invisible +3, rapid and longrange give 0
  const effectiveStrength = boostedLevel + (style === "accurate" ? 3 : 0) + 8;

  // Max hit = floor(0.5 + effectiveStrength * (rangedStrengthBonus + 64) / 640)
  return Math.floor(
    0.5 + (effectiveStrength * (rangedStrengthBonus + 64)) / 640,
  );
}

/**
 * Calculate ranged damage using OSRS-accurate formulas
 *
 * @param params - Ranged damage calculation parameters
 * @param rng - Optional seeded random number generator
 * @returns Damage result with hit information
 */
export function calculateRangedDamage(
  params: RangedDamageParams,
  rng?: SeededRandom,
): RangedDamageResult {
  const random = rng ?? getGameRng();

  const {
    rangedLevel,
    rangedAttackBonus,
    rangedStrengthBonus,
    style,
    targetDefenseLevel,
    targetRangedDefenseBonus,
    prayerBonuses,
    targetPrayerBonuses,
  } = params;

  // Calculate attack and defense rolls
  const attackRoll = calculateRangedAttackRoll(
    rangedLevel,
    rangedAttackBonus,
    style,
    prayerBonuses,
  );

  const defenseRoll = calculateRangedDefenseRoll(
    targetDefenseLevel,
    targetRangedDefenseBonus,
    targetPrayerBonuses,
  );

  // Calculate hit chance
  const hitChance = calculateHitChance(attackRoll, defenseRoll);

  // Calculate max hit
  const maxHit = calculateRangedMaxHit(
    rangedLevel,
    rangedStrengthBonus,
    style,
    prayerBonuses,
  );

  // Roll for hit
  const didHit = random.random() < hitChance;

  if (!didHit) {
    return {
      damage: 0,
      maxHit,
      didHit: false,
      hitChance,
    };
  }

  // Roll for damage (0 to maxHit inclusive)
  const damage = random.damageRoll(maxHit);

  return {
    damage,
    maxHit,
    didHit: true,
    hitChance,
  };
}

/**
 * RangedDamageCalculator class for integration with CombatSystem
 */
export class RangedDamageCalculator {
  /**
   * Calculate ranged damage
   */
  calculate(
    params: RangedDamageParams,
    rng?: SeededRandom,
  ): RangedDamageResult {
    return calculateRangedDamage(params, rng);
  }

  /**
   * Get max hit for display purposes (no RNG)
   */
  getMaxHit(
    rangedLevel: number,
    rangedStrengthBonus: number,
    style: RangedCombatStyle,
    prayerBonuses?: PrayerBonuses,
  ): number {
    return calculateRangedMaxHit(
      rangedLevel,
      rangedStrengthBonus,
      style,
      prayerBonuses,
    );
  }

  /**
   * Get hit chance for display purposes (no RNG)
   */
  getHitChance(
    rangedLevel: number,
    rangedAttackBonus: number,
    style: RangedCombatStyle,
    targetDefenseLevel: number,
    targetRangedDefenseBonus: number,
    prayerBonuses?: PrayerBonuses,
    targetPrayerBonuses?: PrayerBonuses,
  ): number {
    const attackRoll = calculateRangedAttackRoll(
      rangedLevel,
      rangedAttackBonus,
      style,
      prayerBonuses,
    );

    const defenseRoll = calculateRangedDefenseRoll(
      targetDefenseLevel,
      targetRangedDefenseBonus,
      targetPrayerBonuses,
    );

    return calculateHitChance(attackRoll, defenseRoll);
  }
}
