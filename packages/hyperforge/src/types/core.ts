/**
 * Core Type Definitions for HyperForge
 *
 * This file contains foundational types used across the entire HyperForge system.
 * All other type files should import from here for consistency.
 *
 * Naming Conventions (December 2025):
 * - Type aliases: PascalCase (e.g., AssetSource, WeaponType)
 * - String literal unions: lowercase (e.g., "melee" | "ranged")
 * - Interfaces: PascalCase with descriptive names (no I prefix)
 * - Constants: SCREAMING_SNAKE_CASE
 */

// =============================================================================
// ASSET SOURCE & STORAGE
// =============================================================================

/**
 * Where an asset originates from
 * - CDN: From game CDN manifests (read-only)
 * - LOCAL: Generated/imported locally (read-write)
 * - BASE: Base template for generation
 */
export type AssetSource = "CDN" | "LOCAL" | "BASE";

// =============================================================================
// ASSET CATEGORIES
// =============================================================================

/**
 * Primary asset categories for HyperForge
 * Used for asset library organization and generation pipelines
 */
export type AssetCategory =
  | "weapon"
  | "armor"
  | "tool"
  | "resource"
  | "npc"
  | "mob" // Alias for npc, used in some contexts
  | "character"
  | "environment"
  | "prop"
  | "building"
  | "item"
  | "currency"
  | "avatar"
  | "emote"
  | "audio"
  | "music"
  | "biome";

/**
 * Categories that produce 3D models
 */
export type ModelCategory = Extract<
  AssetCategory,
  | "weapon"
  | "armor"
  | "tool"
  | "resource"
  | "npc"
  | "character"
  | "environment"
  | "prop"
  | "building"
  | "item"
  | "avatar"
>;

/**
 * Manifest type mapping for export
 */
export type ManifestType = "items" | "npcs" | "resources" | "music" | "biomes";

/**
 * Map category to manifest type
 */
export const CATEGORY_TO_MANIFEST: Record<AssetCategory, ManifestType> = {
  weapon: "items",
  armor: "items",
  tool: "items",
  item: "items",
  currency: "items",
  prop: "items",
  building: "items",
  npc: "npcs",
  mob: "npcs", // Alias for npc
  character: "npcs",
  avatar: "npcs",
  resource: "resources",
  environment: "resources",
  emote: "items",
  audio: "items",
  music: "music",
  biome: "biomes",
};

// =============================================================================
// RARITY SYSTEM
// =============================================================================

/**
 * Asset/Item rarity levels
 * Matches game manifest rarity values (lowercase)
 */
export type Rarity =
  | "common"
  | "uncommon"
  | "rare"
  | "very_rare"
  | "epic"
  | "legendary"
  | "unique"
  | "always"; // For guaranteed drops

/**
 * Rarity color mapping for UI
 */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: "#9ca3af", // gray
  uncommon: "#22c55e", // green
  rare: "#3b82f6", // blue
  very_rare: "#a855f7", // purple
  epic: "#f59e0b", // amber
  legendary: "#ef4444", // red
  unique: "#ec4899", // pink
  always: "#6b7280", // neutral gray
};

// =============================================================================
// EQUIPMENT & COMBAT
// =============================================================================

/**
 * Equipment slot names
 * Where an item can be equipped on a character
 */
export type EquipSlot =
  | "weapon"
  | "shield"
  | "head"
  | "body"
  | "legs"
  | "hands"
  | "feet"
  | "cape"
  | "neck"
  | "ring"
  | "ammunition";

/**
 * Weapon type classifications
 * Uses lowercase for consistency
 */
export type WeaponType =
  | "sword"
  | "axe"
  | "mace"
  | "dagger"
  | "spear"
  | "bow"
  | "crossbow"
  | "staff"
  | "wand"
  | "scimitar"
  | "halberd"
  | "shield"
  | "none";

/**
 * Attack/combat style types
 */
export type AttackType = "melee" | "ranged" | "magic";

/**
 * Combat stat bonuses
 */
export interface CombatBonuses {
  attack?: number;
  strength?: number;
  defense?: number;
  ranged?: number;
  magic?: number;
  prayer?: number;
  health?: number;
}

/**
 * Skill/level requirements
 */
export interface Requirements {
  level?: number;
  skills?: Record<string, number>;
  quest?: string;
}

// =============================================================================
// NPC TYPES
// =============================================================================

/**
 * NPC behavior categories
 */
export type NPCCategory = "mob" | "boss" | "neutral" | "quest";

// =============================================================================
// ITEM TYPES
// =============================================================================

/**
 * Item type classifications
 */
export type ItemType =
  | "weapon"
  | "armor"
  | "tool"
  | "resource"
  | "consumable"
  | "quest"
  | "currency"
  | "material"
  | "food"
  | "misc"
  | "ammunition";

// =============================================================================
// 3D POSITION
// =============================================================================

/**
 * 3D world position
 */
export interface Position3D {
  x: number;
  y: number;
  z: number;
}

// =============================================================================
// GENERATION METADATA
// =============================================================================

/**
 * Common metadata for generated content
 */
export interface GeneratedMetadata {
  generatedAt: string; // ISO timestamp
  prompt: string;
  modelVersion?: string;
  provider?: "openai" | "anthropic" | "google" | "meshy";
}
