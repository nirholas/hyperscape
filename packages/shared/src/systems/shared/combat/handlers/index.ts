/**
 * Combat Damage Handlers
 *
 * Polymorphic damage handling for different entity types.
 * Eliminates player/mob conditionals in CombatSystem.
 */

export type { DamageHandler, DamageResult } from "./DamageHandler";
export { PlayerDamageHandler } from "./PlayerDamageHandler";
export { MobDamageHandler } from "./MobDamageHandler";
