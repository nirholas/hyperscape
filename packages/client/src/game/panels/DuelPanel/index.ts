/**
 * Duel Panel - Barrel Export
 *
 * Exports all duel-related UI components:
 * - DuelChallengeModal: Incoming challenge popup
 * - DuelPanel: Main duel interface with screen switching
 * - RulesScreen: Rules negotiation screen
 * - StakesScreen: Stakes negotiation screen
 * - ConfirmScreen: Final confirmation screen
 * - DuelCountdown: 3-2-1-FIGHT overlay
 * - DuelResultModal: Win/loss result display
 * - DuelHUD: In-combat overlay with opponent health and forfeit
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

export { StakesScreen } from "./StakesScreen";

export { ConfirmScreen } from "./ConfirmScreen";

export {
  DuelCountdown,
  createDefaultDuelCountdownState,
  type DuelCountdownState,
} from "./DuelCountdown";

export {
  DuelResultModal,
  createDefaultDuelResultState,
  type DuelResultState,
  type DuelResultItem,
} from "./DuelResultModal";

export {
  DuelHUD,
  createDefaultDuelHUDState,
  type DuelHUDState,
} from "./DuelHUD";
