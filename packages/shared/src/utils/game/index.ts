/**
 * Game logic utilities
 * Combat, entity, component helpers
 */

// Export all from CombatCalculations except calculateDistance* (re-exported from MathUtils)
export {
  type CombatStats,
  type DamageResult,
  type CombatStyle,
  type StyleBonus,
  getStyleBonus,
  calculateDamage,
  isInAttackRange,
  calculateDistance3D,
  isAttackOnCooldown,
  shouldCombatTimeout,
} from "./CombatCalculations";

export * from "./CombatUtils";
export * from "./CombatValidation";
export * from "./HitDelayCalculator";

// Export all from EntityUtils except calculateDistance* (to avoid duplicates)
export {
  getEntity,
  getComponent,
  getEntityWithComponent,
  getEntitiesInRange,
  getPlayer,
  groundToTerrain,
} from "./EntityUtils";

export * from "./ComponentUtils";

// Combat level calculation (OSRS-accurate)
export * from "./CombatLevelCalculator";
