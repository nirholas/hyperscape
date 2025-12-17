/**
 * Level-Up Notification System
 *
 * RuneScape-style level-up popup with:
 * - Visual popup with skill icon and level
 * - CSS fireworks animation (Phase 3)
 * - Placeholder audio fanfare (Phase 2)
 * - Chat message integration (Phase 4)
 * - Skill unlock display (Phase 5)
 */

// Main component
export { LevelUpNotification } from "./LevelUpNotification";

// Sub-components
export { LevelUpPopup } from "./LevelUpPopup";

// Hooks
export { useLevelUpState } from "./useLevelUpState";
export type { LevelUpEvent, UseLevelUpStateResult } from "./useLevelUpState";

// Utilities
export { normalizeSkillName, capitalizeSkill } from "./utils";
