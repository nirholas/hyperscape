/**
 * LevelUpNotification - Main composition root for level-up notifications
 *
 * Combines:
 * - useLevelUpState: Event subscription and queue management
 * - LevelUpPopup: Visual popup display
 *
 * Audio integration added in Phase 2.
 * Fireworks animation added in Phase 3.
 * Chat message integration added in Phase 4.
 */

import type { ClientWorld } from "../../../types";
import { useLevelUpState } from "./useLevelUpState";
import { LevelUpPopup } from "./LevelUpPopup";

interface LevelUpNotificationProps {
  world: ClientWorld;
}

export function LevelUpNotification({ world }: LevelUpNotificationProps) {
  const { currentLevelUp, dismissLevelUp } = useLevelUpState(world);

  // Don't render if no level-up to display
  if (!currentLevelUp) {
    return null;
  }

  return <LevelUpPopup event={currentLevelUp} onDismiss={dismissLevelUp} />;
}
