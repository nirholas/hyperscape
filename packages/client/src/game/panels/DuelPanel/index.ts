/**
 * Duel Panel - Barrel Export
 *
 * Exports all duel-related UI components:
 * - DuelChallengeModal: Incoming challenge popup
 * - DuelPanel: Main duel interface with screen switching
 * - RulesScreen: Rules negotiation screen
 *
 * Future components (to be added in later phases):
 * - StakesScreen: Stakes negotiation
 * - ConfirmScreen: Final confirmation
 */

export {
  DuelChallengeModal,
  type DuelChallengeModalState,
} from "./DuelChallengeModal";

export {
  DuelPanel,
  createDefaultDuelPanelState,
  type DuelPanelState,
  type DuelScreenState,
} from "./DuelPanel";

export { RulesScreen } from "./RulesScreen";
