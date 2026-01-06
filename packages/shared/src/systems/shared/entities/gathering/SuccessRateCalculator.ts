/**
 * SuccessRateCalculator - OSRS-accurate success rate and cycle calculations
 *
 * Extracted from ResourceSystem.ts for SOLID compliance.
 * These functions compute gathering success rates using OSRS formulas.
 *
 * @see https://oldschool.runescape.wiki/w/Skilling_success_rate
 */

import { GATHERING_CONSTANTS } from "../../../../constants/GatheringConstants";
import type { GatheringToolData } from "../../../../data/DataManager";
import { TICK_DURATION_MS } from "../../movement/TileSystem";
import { lerpSuccessRate } from "./DropRoller";
import type { SuccessRateValues } from "./types";

/**
 * Get low/high success rate values from OSRS-accurate tables.
 *
 * @param skill - The gathering skill (woodcutting, mining, fishing)
 * @param resourceVariant - Resource type key (e.g., "tree_normal", "ore_copper")
 * @param toolTier - Tool tier for woodcutting (e.g., "bronze", "rune"), ignored for other skills
 * @returns Success rate values { low, high } for LERP formula
 */
export function getSuccessRateValues(
  skill: string,
  resourceVariant: string,
  toolTier: string | null,
): SuccessRateValues {
  if (skill === "woodcutting") {
    // Woodcutting: lookup by tree type AND axe tier
    const treeRates =
      GATHERING_CONSTANTS.WOODCUTTING_SUCCESS_RATES[
        resourceVariant as keyof typeof GATHERING_CONSTANTS.WOODCUTTING_SUCCESS_RATES
      ];
    if (treeRates) {
      const tier = toolTier || "bronze";
      const tierRates = treeRates[tier as keyof typeof treeRates];
      if (tierRates) {
        return tierRates;
      }
      // Unknown tier, fall back to bronze
      return treeRates.bronze;
    }
  }

  if (skill === "mining") {
    // Mining: lookup by ore type only (pickaxe doesn't affect success)
    const oreRates =
      GATHERING_CONSTANTS.MINING_SUCCESS_RATES[
        resourceVariant as keyof typeof GATHERING_CONSTANTS.MINING_SUCCESS_RATES
      ];
    if (oreRates) {
      return oreRates;
    }
  }

  if (skill === "fishing") {
    // Fishing: lookup by spot type only (equipment doesn't affect success)
    const fishRates =
      GATHERING_CONSTANTS.FISHING_SUCCESS_RATES[
        resourceVariant as keyof typeof GATHERING_CONSTANTS.FISHING_SUCCESS_RATES
      ];
    if (fishRates) {
      return fishRates;
    }
  }

  // Fallback to default values
  return GATHERING_CONSTANTS.DEFAULT_SUCCESS_RATE;
}

/**
 * Compute success rate using OSRS's LERP interpolation formula.
 *
 * OSRS Formula: P(Level) = (1 + floor(low × (99 - L) / 98 + high × (L - 1) / 98 + 0.5)) / 256
 *
 * The low/high values come from skill-specific tables:
 * - Woodcutting: Varies by tree type AND axe tier
 * - Mining: Varies by ore type only (pickaxe doesn't affect success)
 * - Fishing: Varies by spot type only (equipment doesn't affect success)
 *
 * @param skillLevel - Player's current skill level (1-99)
 * @param skill - The gathering skill (woodcutting, mining, fishing)
 * @param resourceVariant - Resource type key (e.g., "tree_normal", "ore_copper")
 * @param toolTier - Tool tier for woodcutting (e.g., "bronze", "rune"), ignored for other skills
 * @returns Success probability (0-1)
 *
 * @see https://oldschool.runescape.wiki/w/Skilling_success_rate
 */
export function computeSuccessRate(
  skillLevel: number,
  skill: string,
  resourceVariant: string,
  toolTier: string | null,
): number {
  // Get low/high values based on skill type
  const { low, high } = getSuccessRateValues(skill, resourceVariant, toolTier);

  // Apply OSRS LERP formula
  return lerpSuccessRate(low, high, skillLevel);
}

/**
 * Compute gathering cycle in ticks (OSRS-accurate, skill-specific).
 *
 * OSRS MECHANICS:
 * - Woodcutting: Fixed 4 ticks, tool doesn't affect frequency
 * - Mining: Tool determines tick interval (8 bronze → 3 rune/dragon)
 * - Fishing: Fixed 5 ticks, equipment doesn't affect frequency
 *
 * @param skill - The gathering skill (woodcutting, mining, fishing)
 * @param baseCycleTicks - Base cycle ticks from resource manifest
 * @param toolData - Tool data from tools.json manifest (may have rollTicks for mining)
 * @returns Number of ticks between gathering attempts
 */
export function computeCycleTicks(
  skill: string,
  baseCycleTicks: number,
  toolData: GatheringToolData | null,
): number {
  const mechanics =
    GATHERING_CONSTANTS.SKILL_MECHANICS[
      skill as keyof typeof GATHERING_CONSTANTS.SKILL_MECHANICS
    ];

  if (mechanics) {
    if (mechanics.type === "fixed-roll-variable-success") {
      // WOODCUTTING: Fixed roll frequency, tool affects success rate (handled elsewhere)
      // Always use the skill's base roll ticks (4 for woodcutting)
      return Math.max(
        GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS,
        mechanics.baseRollTicks,
      );
    }

    if (mechanics.type === "variable-roll-fixed-success") {
      // MINING: Tool tier determines roll frequency
      // Use rollTicks from tool data, or fall back to base (bronze = 8)
      const rollTicks = toolData?.rollTicks ?? mechanics.baseRollTicks;
      return Math.max(GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS, rollTicks);
    }

    if (mechanics.type === "fixed-roll-fixed-success") {
      // FISHING: Fixed roll frequency, equipment doesn't matter
      return Math.max(
        GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS,
        mechanics.baseRollTicks,
      );
    }
  }

  // Fallback to base ticks for unknown skills
  return Math.max(GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS, baseCycleTicks);
}

/**
 * Convert ticks to milliseconds for client progress bar.
 *
 * @param ticks - Number of game ticks
 * @returns Duration in milliseconds
 */
export function ticksToMs(ticks: number): number {
  return ticks * TICK_DURATION_MS;
}
