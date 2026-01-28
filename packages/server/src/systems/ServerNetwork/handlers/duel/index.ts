/**
 * Duel Handlers - Barrel Export
 *
 * All duel-related packet handlers organized into focused modules:
 *
 * - challenge.ts: Duel challenge initiation and response
 * - rules.ts: Toggle rules, accept rules
 * - stakes.ts: Add, remove, accept stakes
 * - confirmation.ts: Final confirmation handlers
 * - combat.ts: Forfeit and combat-related handlers
 * - helpers.ts: Shared utilities (not exported externally)
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

// Stakes handlers
export {
  handleDuelAddStake,
  handleDuelRemoveStake,
  handleDuelAcceptStakes,
} from "./stakes";

// Confirmation handlers
export { handleDuelAcceptFinal } from "./confirmation";

// Combat handlers
export { handleDuelForfeit } from "./combat";
