/**
 * Combat damage/accuracy calculations. Deterministic via SeededRandom.
 * @see https://oldschool.runescape.wiki/w/Damage_per_second/Melee
 */

import { COMBAT_CONSTANTS } from "../../constants/CombatConstants";
import { AttackType } from "../../types/core/core";
import {
  calculateDistance as mathCalculateDistance,
  calculateDistance2D as mathCalculateDistance2D,
} from "../MathUtils";
import {
  worldToTile,
  tilesWithinMeleeRange,
  tileChebyshevDistance,
} from "../../systems/shared/movement/TileSystem";
import { getGameRng, SeededRandom } from "../SeededRandom";

export type CombatStyle =
  | "accurate"
  | "aggressive"
  | "defensive"
  | "controlled";

export interface StyleBonus {
  attack: number;
  strength: number;
  defense: number;
}

/**
 * Pre-allocated style bonuses to avoid object creation in hot path.
 * Frozen to prevent mutation and enable V8 optimizations.
 * @see https://oldschool.runescape.wiki/w/Combat_Options
 */
const STYLE_BONUSES: Readonly<Record<CombatStyle, Readonly<StyleBonus>>> = {
  accurate: Object.freeze({ attack: 3, strength: 0, defense: 0 }),
  aggressive: Object.freeze({ attack: 0, strength: 3, defense: 0 }),
  defensive: Object.freeze({ attack: 0, strength: 0, defense: 3 }),
  controlled: Object.freeze({ attack: 1, strength: 1, defense: 1 }),
} as const;

/** Accurate: +3 atk, Aggressive: +3 str, Defensive: +3 def, Controlled: +1 all */
export function getStyleBonus(style: CombatStyle): Readonly<StyleBonus> {
  return STYLE_BONUSES[style];
}

export interface CombatStats {
  attack?: number;
  strength?: number;
  defense?: number;
  defenseBonus?: number;
  ranged?: number;
  attackPower?: number;
}

export interface DamageResult {
  damage: number;
  isCritical: boolean;
  damageType: AttackType;
  didHit: boolean;
}

/** @see https://oldschool.runescape.wiki/w/Accuracy */
function calculateAccuracy(
  attackerAttackLevel: number,
  attackerAttackBonus: number,
  targetDefenseLevel: number,
  targetDefenseBonus: number,
  attackerStyle: CombatStyle = "accurate",
  defenderStyle?: CombatStyle,
  rng?: SeededRandom,
): boolean {
  const random = rng ?? getGameRng();

  const attackerStyleBonus = getStyleBonus(attackerStyle);
  const defenderStyleBonus = defenderStyle
    ? getStyleBonus(defenderStyle)
    : { attack: 0, strength: 0, defense: 0 };

  const effectiveAttack = attackerAttackLevel + 8 + attackerStyleBonus.attack;
  const attackRoll = effectiveAttack * (attackerAttackBonus + 64);

  const effectiveDefence = targetDefenseLevel + 9 + defenderStyleBonus.defense;
  const defenceRoll = effectiveDefence * (targetDefenseBonus + 64);

  let hitChance: number;
  if (attackRoll > defenceRoll) {
    hitChance = 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  } else {
    hitChance = attackRoll / (2 * (defenceRoll + 1));
  }

  return random.random() < hitChance;
}

/** @see https://oldschool.runescape.wiki/w/Damage_per_second/Melee */
export function calculateDamage(
  attacker: { stats?: CombatStats; config?: { attackPower?: number } },
  target: { stats?: CombatStats; config?: { defense?: number } },
  attackType: AttackType,
  equipmentStats?: {
    attack: number;
    strength: number;
    defense: number;
    ranged: number;
  },
  style: CombatStyle = "accurate",
  defenderStyle?: CombatStyle,
): DamageResult {
  let maxHit = 1;
  let attackStat = 0;
  let attackBonus = 0;
  const styleBonus = getStyleBonus(style);

  if (attackType === AttackType.MELEE) {
    const strengthStat = attacker.stats?.strength || 0;
    attackStat = attacker.stats?.attack || 1;
    const attackPower = attacker.config?.attackPower || 0;

    if (strengthStat > 0 || attackPower > 0) {
      const effectiveStrengthLevel =
        strengthStat > 0
          ? strengthStat
          : Math.max(1, Math.floor(attackPower / 2));
      const effectiveAttackLevel =
        attackStat > 0 ? attackStat : effectiveStrengthLevel;

      attackStat = effectiveAttackLevel;

      const effectiveStrength =
        effectiveStrengthLevel + 8 + styleBonus.strength;
      const strengthBonus = equipmentStats?.strength || 0;
      attackBonus = equipmentStats?.attack || 0;

      maxHit = Math.floor(
        0.5 + (effectiveStrength * (strengthBonus + 64)) / 640,
      );

      if (maxHit < 1 && (attackPower >= 10 || strengthStat >= 10)) {
        maxHit = 1;
      }
    } else {
      maxHit = 1;
    }
  }

  if (!Number.isFinite(maxHit) || maxHit < 1) {
    maxHit = 5;
  }

  const targetDefense = target.stats?.defense || 1;
  const targetDefenseBonus = target.stats?.defenseBonus ?? 0;

  const didHit = calculateAccuracy(
    attackStat,
    attackBonus,
    targetDefense,
    targetDefenseBonus,
    style,
    defenderStyle,
  );

  if (!didHit) {
    return {
      damage: 0,
      isCritical: false,
      damageType: attackType,
      didHit: false,
    };
  }

  const rng = getGameRng();
  const damage = rng.damageRoll(maxHit);

  if (!Number.isFinite(damage) || damage < 0) {
    return {
      damage: 0,
      isCritical: false,
      damageType: attackType,
      didHit: true,
    };
  }

  return { damage, isCritical: false, damageType: attackType, didHit: true };
}

function getDefenseValue(entity: {
  stats?: CombatStats;
  config?: { defense?: number };
}): number {
  if (entity.stats?.defense) {
    return entity.stats.defense;
  } else if (entity.config?.defense) {
    return entity.config.defense;
  }
  return 0;
}

/** @see https://oldschool.runescape.wiki/w/Attack_range */
export function isInAttackRange(
  attackerPos: { x: number; y: number; z: number },
  targetPos: { x: number; y: number; z: number },
  attackType: AttackType,
  meleeRange: number = COMBAT_CONSTANTS.MELEE_RANGE_STANDARD,
): boolean {
  const attackerTile = worldToTile(attackerPos.x, attackerPos.z);
  const targetTile = worldToTile(targetPos.x, targetPos.z);

  if (attackType === AttackType.MELEE) {
    return tilesWithinMeleeRange(attackerTile, targetTile, meleeRange);
  } else {
    const tileDistance = tileChebyshevDistance(attackerTile, targetTile);
    return tileDistance <= COMBAT_CONSTANTS.RANGED_RANGE && tileDistance > 0;
  }
}

export const calculateDistance3D = mathCalculateDistance;
export const calculateDistance2D = mathCalculateDistance2D;

export function isAttackOnCooldown(
  lastAttackTime: number,
  currentTime: number,
  attackSpeed?: number,
): boolean {
  const cooldown = attackSpeed ?? COMBAT_CONSTANTS.ATTACK_COOLDOWN_MS;
  return currentTime - lastAttackTime < cooldown;
}

export function shouldCombatTimeout(
  combatStartTime: number,
  currentTime: number,
): boolean {
  return currentTime - combatStartTime > COMBAT_CONSTANTS.COMBAT_TIMEOUT_MS;
}

export function isAttackOnCooldownTicks(
  currentTick: number,
  nextAttackTick: number,
): boolean {
  return currentTick < nextAttackTick;
}

/** ceil(attack_speed / 2) + 1 ticks @see https://oldschool.runescape.wiki/w/Auto_Retaliate */
export function calculateRetaliationDelay(attackSpeedTicks: number): number {
  return Math.ceil(attackSpeedTicks / 2) + 1;
}

/** Mob config stores attackSpeed in seconds (e.g., 2.4) */
export function attackSpeedSecondsToTicks(seconds: number): number {
  return Math.max(
    1,
    Math.round((seconds * 1000) / COMBAT_CONSTANTS.TICK_DURATION_MS),
  );
}

/** Weapon config stores attackSpeed in ms (e.g., 2400) */
export function attackSpeedMsToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / COMBAT_CONSTANTS.TICK_DURATION_MS));
}

export function shouldCombatTimeoutTicks(
  currentTick: number,
  combatEndTick: number,
): boolean {
  return currentTick >= combatEndTick;
}

export function msToTicks(ms: number, minTicks: number = 1): number {
  return Math.max(minTicks, Math.round(ms / COMBAT_CONSTANTS.TICK_DURATION_MS));
}

export function ticksToMs(ticks: number): number {
  return ticks * COMBAT_CONSTANTS.TICK_DURATION_MS;
}
