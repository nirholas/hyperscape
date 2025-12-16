/**
 * Skill Icons - Emoji mappings for OSRS-style skills
 *
 * Shared constant used by:
 * - XPProgressOrb (HUD orbs)
 * - XPDropSystem (3D floating drops)
 * - Other UI components displaying skill information
 */

/** Emoji icons for each skill, keyed by lowercase skill name */
export const SKILL_ICONS: Readonly<Record<string, string>> = {
  attack: "⚔️",
  strength: "💪",
  defence: "🛡️",
  defense: "🛡️", // US spelling alias
  constitution: "❤️",
  hitpoints: "❤️", // OSRS alias
  ranged: "🏹",
  prayer: "✨",
  magic: "🔮",
  cooking: "🍖",
  woodcutting: "🪓",
  fishing: "🐟",
  firemaking: "🔥",
  mining: "⛏️",
  smithing: "🔨",
  herblore: "🧪",
  agility: "🏃",
  thieving: "🗝️",
  slayer: "💀",
  farming: "🌱",
  runecrafting: "🔮",
  hunter: "🦌",
  construction: "🏠",
  summoning: "🐺",
  dungeoneering: "🚪",
  divination: "✨",
  invention: "⚙️",
  archaeology: "🏺",
} as const;

/**
 * Get the emoji icon for a skill
 * @param skill - Skill name (case-insensitive)
 * @returns Emoji icon or star fallback
 */
export function getSkillIcon(skill: string): string {
  return SKILL_ICONS[skill.toLowerCase()] ?? "⭐";
}
