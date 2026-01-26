/**
 * Duel Handlers - Barrel Export
 *
 * All duel-related packet handlers organized into focused modules:
 *
 * - challenge.ts: Duel challenge initiation and response
 * - rules.ts: Toggle rules, accept rules
 * - helpers.ts: Shared utilities (not exported externally)
 *
 * Future modules (to be added in later phases):
 * - stakes.ts: Add, remove, accept stakes
 * - confirmation.ts: Final confirmation handlers
 * - combat.ts: Forfeit handler
 */

// Challenge handlers
export { handleDuelChallenge, handleDuelChallengeRespond } from "./challenge";

// Rules handlers
export {
  handleDuelToggleRule,
  handleDuelToggleEquipment,
  handleDuelAcceptRules,
  handleDuelCancel,
} from "./rules";
