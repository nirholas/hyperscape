/**
 * Level-Up Notification System
 *
 * RuneScape-style level-up popup with:
 * - Visual popup with skill icon and level
 * - CSS fireworks animation
 * - Placeholder audio fanfare (Web Audio API)
 * - Chat message integration (Phase 4)
 * - Skill unlock display (Phase 5)
 */

// Main component
export { LevelUpNotification } from "./LevelUpNotification";

// Sub-components
export { LevelUpPopup } from "./LevelUpPopup";
export { FireworksEffect } from "./FireworksEffect";

// Hooks
export { useLevelUpState } from "./useLevelUpState";
export type { LevelUpEvent, UseLevelUpStateResult } from "./useLevelUpState";

// Audio
export {
  playLevelUpSound,
  playMilestoneLevelUpSound,
  playLevelUpFanfare,
  isMilestoneLevel,
} from "./levelUpAudio";

// Utilities
export { normalizeSkillName, capitalizeSkill } from "./utils";
