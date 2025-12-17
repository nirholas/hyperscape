/**
 * Level-Up Notification Utility Functions
 *
 * Helper functions for skill name normalization and formatting.
 */

/**
 * Normalize skill name to lowercase key (removes spaces)
 * Matches the pattern in useXPOrbState.ts for consistency
 *
 * @example normalizeSkillName("Woodcutting") -> "woodcutting"
 * @example normalizeSkillName("Hit Points") -> "hitpoints"
 */
export function normalizeSkillName(skill: string): string {
  return skill.toLowerCase().replace(/\s+/g, "");
}

/**
 * Capitalize skill name for display
 *
 * @example capitalizeSkill("woodcutting") -> "Woodcutting"
 * @example capitalizeSkill("ATTACK") -> "Attack"
 */
export function capitalizeSkill(skill: string): string {
  return skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase();
}
