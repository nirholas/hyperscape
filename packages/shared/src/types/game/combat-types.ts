/**
 * Combat Types
 * All combat-related type definitions
 */

import type { Position3D } from "../core/base-types";
import type { AttackType } from "../game/item-types";
import type { CombatStyle } from "../../utils/game/CombatCalculations";

// Re-export CombatStyle from CombatCalculations (single source of truth)
// This includes the 4 melee styles: accurate, aggressive, defensive, controlled
export type { CombatStyle };

// Extended combat style type that includes ranged/magic
export type CombatStyleExtended =
  | "accurate"
  | "aggressive"
  | "defensive"
  | "controlled"
  | "longrange"
  | "rapid"
  | "autocast";

/**
 * Ranged combat styles with OSRS-accurate bonuses
 */
export type RangedCombatStyle = "accurate" | "rapid" | "longrange";

/**
 * Magic combat styles
 */
export type MagicCombatStyle = "accurate" | "longrange" | "autocast";

/**
 * Style bonus configuration - pre-allocated, frozen objects
 */
export interface RangedStyleBonus {
  readonly attackBonus: number; // Invisible ranged level bonus
  readonly speedModifier: number; // -1 for rapid
  readonly rangeModifier: number; // +2 for longrange
  readonly xpSplit: "ranged" | "ranged_defence";
}

export interface MagicStyleBonus {
  readonly attackBonus: number;
  readonly speedModifier: number;
  readonly rangeModifier: number;
  readonly xpSplit: "magic" | "magic_defence";
}

/**
 * Pre-allocated frozen style bonuses (no allocations in hot path)
 * OSRS-accurate style bonuses for ranged combat
 */
export const RANGED_STYLE_BONUSES: Readonly<
  Record<RangedCombatStyle, Readonly<RangedStyleBonus>>
> = Object.freeze({
  accurate: Object.freeze({
    attackBonus: 3,
    speedModifier: 0,
    rangeModifier: 0,
    xpSplit: "ranged" as const,
  }),
  rapid: Object.freeze({
    attackBonus: 0,
    speedModifier: -1,
    rangeModifier: 0,
    xpSplit: "ranged" as const,
  }),
  longrange: Object.freeze({
    attackBonus: 0,
    speedModifier: 0,
    rangeModifier: 2,
    xpSplit: "ranged_defence" as const,
  }),
});

/**
 * Pre-allocated frozen style bonuses for magic combat
 */
export const MAGIC_STYLE_BONUSES: Readonly<
  Record<MagicCombatStyle, Readonly<MagicStyleBonus>>
> = Object.freeze({
  accurate: Object.freeze({
    attackBonus: 3,
    speedModifier: 0,
    rangeModifier: 0,
    xpSplit: "magic" as const,
  }),
  longrange: Object.freeze({
    attackBonus: 1,
    speedModifier: 0,
    rangeModifier: 2,
    xpSplit: "magic_defence" as const,
  }),
  autocast: Object.freeze({
    attackBonus: 0,
    speedModifier: 0,
    rangeModifier: 0,
    xpSplit: "magic" as const,
  }),
});

export interface CombatData {
  attackerId: string;
  targetId: string;
  attackerType: "player" | "mob";
  targetType: "player" | "mob";
  startTime: number;
  lastAttackTime: number;
  combatStyle: CombatStyle | null;
}

export interface CombatStateData {
  isInCombat: boolean;
  target: string | null;
  lastAttackTime: number;
  attackCooldown: number;
  damage: number;
  range: number;
}

export interface CombatTarget {
  entityId: string;
  entityType: "player" | "mob";
  distance: number;
  playerId: string;
  threat: number;
  position: Position3D;
  lastSeen: number;
}

// Attack style interfaces
export interface AttackStyle {
  id: string;
  name: string;
  description: string;
  xpDistribution: {
    attack: number;
    strength: number;
    defense: number;
    constitution: number;
  };
  // Note: damageModifier and accuracyModifier are kept for potential future use
  // (e.g., prayers, potions, special attacks that use event-based multipliers).
  // Current implementation uses OSRS-accurate invisible stat boosts in calculateDamage().
  damageModifier?: number; // Multiplier for damage calculation (unused - see note)
  accuracyModifier?: number; // Multiplier for hit chance (unused - see note)
  icon: string;
}

// Animation system types
export interface AnimationTask {
  id: string;
  entityId: string;
  targetId?: string;
  animationName: string;
  duration: number;
  attackType: AttackType;
  style: CombatStyle;
  damage?: number;
  startTime: number;
  progress: number;
  cancelled?: boolean;
}

// Combat utility result types
export interface CanAttackResult {
  canAttack: boolean;
  reason?: string;
}

export interface CombatAttackResult {
  success: boolean;
  reason?: string;
  damage?: number;
}
