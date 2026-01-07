/**
 * Smithing Types - Type definitions and reference constants
 *
 * This file provides type definitions for the smithing system.
 * Actual recipe data lives in items.json (smithing property on items).
 * ProcessingDataProvider builds runtime lookup tables from the manifest.
 *
 * Categories: sword, hatchet, pickaxe (bronze through mithril)
 * Note: Pickaxes CAN be smithed (intentional deviation from OSRS)
 *
 * @see packages/server/world/assets/manifests/items.json for recipe data
 * @see ProcessingDataProvider for runtime accessors
 * @see https://oldschool.runescape.wiki/w/Smithing for OSRS reference
 */

/**
 * Smithing category types
 */
export type SmithingCategory = "sword" | "hatchet" | "pickaxe";

/**
 * Bar tier types (matches bar IDs without "_bar" suffix)
 */
export type BarTier = "bronze" | "iron" | "steel" | "mithril";

/**
 * Reference: Base smithing levels for each bar tier
 * Used for documentation and validation.
 */
export const BAR_TIER_BASE_LEVELS: Record<BarTier, number> = {
  bronze: 1,
  iron: 15,
  steel: 30,
  mithril: 50,
};

/**
 * Reference: Level offsets from base level for each category
 * Sword/Pickaxe: +4 from base level
 * Hatchet: +1 from base level
 */
export const CATEGORY_LEVEL_OFFSETS: Record<SmithingCategory, number> = {
  hatchet: 1,
  pickaxe: 4,
  sword: 4,
};

/**
 * Reference: Bars required for each category
 * Pickaxes require 2 bars, others require 1
 */
export const CATEGORY_BARS_REQUIRED: Record<SmithingCategory, number> = {
  sword: 1,
  hatchet: 1,
  pickaxe: 2,
};

/**
 * Reference: XP per bar by metal tier (OSRS-accurate)
 *
 * Each metal tier grants different XP per bar used:
 * - Bronze: 12.5 XP/bar
 * - Iron: 25 XP/bar
 * - Steel: 37.5 XP/bar
 * - Mithril: 50 XP/bar
 *
 * @see https://oldschool.runescape.wiki/w/Smithing
 */
export const XP_PER_BAR_BY_TIER: Record<BarTier, number> = {
  bronze: 12.5,
  iron: 25,
  steel: 37.5,
  mithril: 50,
};

/**
 * All available bar tiers
 */
export const BAR_TIERS: readonly BarTier[] = [
  "bronze",
  "iron",
  "steel",
  "mithril",
];

/**
 * All available smithing categories
 */
export const SMITHING_CATEGORIES: readonly SmithingCategory[] = [
  "sword",
  "hatchet",
  "pickaxe",
];
