/**
 * Game Manifest Types for HyperForge
 *
 * Types that match the actual game manifest structures (items.json, npcs.json, etc.)
 * These are used for importing from and exporting to game manifests.
 */

import type {
  AssetCategory,
  Rarity,
  EquipSlot,
  WeaponType,
  AttackType,
  NPCCategory,
  CombatBonuses,
  Requirements,
} from "./core";

// =============================================================================
// ITEM MANIFEST
// =============================================================================

/**
 * Item from items.json manifest
 * Matches the actual game manifest structure
 */
export interface ItemManifest {
  id: string;
  name: string;
  type: string; // "weapon", "tool", "resource", "currency"
  description?: string;
  examine?: string;

  // Model paths
  modelPath?: string | null;
  equippedModelPath?: string;
  iconPath?: string;
  thumbnailPath?: string;

  // Basic properties
  value?: number;
  weight?: number;
  rarity?: Rarity;
  stackable?: boolean;
  maxStackSize?: number;
  tradeable?: boolean;

  // Equipment properties
  equipSlot?: EquipSlot;
  weaponType?: WeaponType;
  attackType?: AttackType;
  attackSpeed?: number;
  attackRange?: number;
  is2h?: boolean;

  // Combat bonuses
  bonuses?: CombatBonuses;

  // Requirements
  requirements?: Requirements;
}

// =============================================================================
// NPC MANIFEST
// =============================================================================

/**
 * NPC from npcs.json manifest
 * Matches the actual game manifest structure
 */
export interface NPCManifest {
  id: string;
  name: string;
  description?: string;
  category: NPCCategory;
  faction?: string;

  // Stats
  stats?: {
    level?: number;
    health?: number;
    attack?: number;
    strength?: number;
    defense?: number;
    ranged?: number;
    magic?: number;
  };

  // Combat settings
  combat?: {
    attackable?: boolean;
    aggressive?: boolean;
    retaliates?: boolean;
    aggroRange?: number;
    combatRange?: number;
    attackSpeedTicks?: number;
    respawnTicks?: number;
  };

  // Movement
  movement?: {
    type?: "wander" | "stationary" | "patrol";
    speed?: number;
    wanderRadius?: number;
  };

  // Appearance (nested in manifest)
  appearance?: {
    modelPath?: string;
    iconPath?: string;
    scale?: number;
  };

  // Direct paths (flattened for convenience)
  modelPath?: string;
  thumbnailPath?: string;
  iconPath?: string;

  // Services for NPCs like shopkeepers/bankers
  services?: {
    enabled?: boolean;
    types?: string[];
  };

  // Spawn info
  spawnBiomes?: string[];

  // Legacy fields for compatibility
  level?: number;
  health?: number;
  combatLevel?: number;
}

// =============================================================================
// RESOURCE MANIFEST
// =============================================================================

/**
 * Resource from resources.json manifest
 * Matches the actual game manifest structure
 */
export interface ResourceManifest {
  id: string;
  name: string;
  type: string; // "tree", "fishing_spot", "rock", etc.
  examine?: string;

  // Model paths
  modelPath: string | null;
  depletedModelPath?: string | null;

  // Scale
  scale?: number;
  depletedScale?: number;

  // Harvesting requirements
  harvestSkill?: string;
  toolRequired?: string | null;
  levelRequired?: number;

  // Timing
  baseCycleTicks?: number;
  depleteChance?: number;
  respawnTicks?: number;

  // Yield
  harvestYield?: Array<{
    itemId: string;
    itemName?: string;
    quantity: number;
    chance: number;
    xpAmount?: number;
    stackable?: boolean;
  }>;
}

// =============================================================================
// MUSIC MANIFEST
// =============================================================================

/**
 * Music track from music.json manifest
 */
export interface MusicTrackManifest {
  id: string;
  name: string;
  type: "theme" | "ambient" | "combat";
  category: "intro" | "normal" | "combat" | "boss" | "ambient";
  path: string;
  description?: string;
  duration?: number;
  mood?: string;
}

// =============================================================================
// BIOME MANIFEST
// =============================================================================

/**
 * Biome from biomes.json manifest
 */
export interface BiomeManifest {
  id: string;
  name: string;
  description?: string;
  terrain?: string;
  difficultyLevel?: number;
  difficulty?: number;
  colorScheme?: {
    primary: string;
    secondary: string;
    fog: string;
  };
  resources?: string[];
  resourceTypes?: string[];
  mobs?: string[];
  mobTypes?: string[];
}

// =============================================================================
// CATEGORY METADATA
// =============================================================================

/**
 * Category definition with metadata requirements
 */
export interface CategoryDefinition {
  id: AssetCategory;
  name: string;
  description: string;
  icon: string;
  manifestType: "items" | "npcs" | "resources";
  metadataSchema: CategoryMetadataSchema;
}

/**
 * Schema for category metadata
 */
export interface CategoryMetadataSchema {
  requiredFields: string[];
  optionalFields: string[];
  defaults: Record<string, unknown>;
}

/**
 * Category definitions with their metadata requirements
 */
export const CATEGORIES: Partial<Record<AssetCategory, CategoryDefinition>> = {
  npc: {
    id: "npc",
    name: "NPCs & Characters",
    description: "Non-player characters, mobs, bosses, and quest NPCs",
    icon: "👤",
    manifestType: "npcs",
    metadataSchema: {
      requiredFields: [
        "id",
        "name",
        "description",
        "category",
        "level",
        "health",
      ],
      optionalFields: [
        "combatLevel",
        "faction",
        "stats",
        "drops",
        "dialogue",
        "spawnBiomes",
      ],
      defaults: {
        category: "mob",
        level: 1,
        health: 10,
        combatLevel: 1,
        scale: 1.0,
      },
    },
  },
  mob: {
    id: "mob",
    name: "Mobs",
    description: "Enemy creatures and monsters (alias for NPC)",
    icon: "👹",
    manifestType: "npcs",
    metadataSchema: {
      requiredFields: [
        "id",
        "name",
        "description",
        "category",
        "level",
        "health",
      ],
      optionalFields: [
        "combatLevel",
        "faction",
        "stats",
        "drops",
        "dialogue",
        "spawnBiomes",
      ],
      defaults: {
        category: "mob",
        level: 1,
        health: 10,
        combatLevel: 1,
        scale: 1.0,
      },
    },
  },
  character: {
    id: "character",
    name: "Player Characters",
    description: "Player avatars and character models",
    icon: "🧙",
    manifestType: "npcs",
    metadataSchema: {
      requiredFields: ["id", "name", "description"],
      optionalFields: ["scale", "isRigged", "isVRM", "animations"],
      defaults: {
        scale: 1.0,
        isRigged: true,
        isVRM: true,
      },
    },
  },
  resource: {
    id: "resource",
    name: "Resources",
    description: "Harvestable resources like trees, ore, plants",
    icon: "🌳",
    manifestType: "resources",
    metadataSchema: {
      requiredFields: [
        "id",
        "name",
        "type",
        "modelPath",
        "harvestSkill",
        "levelRequired",
      ],
      optionalFields: [
        "depletedModelPath",
        "scale",
        "depletedScale",
        "toolRequired",
        "harvestYield",
      ],
      defaults: {
        scale: 1.0,
        depletedScale: 0.3,
        baseCycleTicks: 4,
        depleteChance: 0.125,
        respawnTicks: 80,
      },
    },
  },
  weapon: {
    id: "weapon",
    name: "Weapons",
    description: "Melee and ranged weapons",
    icon: "⚔️",
    manifestType: "items",
    metadataSchema: {
      requiredFields: [
        "id",
        "name",
        "type",
        "weaponType",
        "attackType",
        "attackSpeed",
      ],
      optionalFields: [
        "equippedModelPath",
        "bonuses",
        "requirements",
        "attackRange",
        "is2h",
      ],
      defaults: {
        type: "weapon",
        attackSpeed: 4,
        attackRange: 1,
        tradeable: true,
        rarity: "common",
      },
    },
  },
  environment: {
    id: "environment",
    name: "Environment",
    description: "Trees, rocks, terrain features",
    icon: "🏔️",
    manifestType: "resources",
    metadataSchema: {
      requiredFields: ["id", "name", "type", "modelPath"],
      optionalFields: ["scale", "depletedModelPath", "depletedScale"],
      defaults: {
        type: "environment",
        scale: 1.0,
      },
    },
  },
  prop: {
    id: "prop",
    name: "Props",
    description: "Decorative items and interactive objects",
    icon: "📦",
    manifestType: "items",
    metadataSchema: {
      requiredFields: ["id", "name", "type", "description"],
      optionalFields: ["modelPath", "iconPath", "value", "weight"],
      defaults: {
        type: "prop",
        tradeable: false,
        rarity: "common",
      },
    },
  },
  building: {
    id: "building",
    name: "Building Materials",
    description: "Walls, doors, steps, building components",
    icon: "🏗️",
    manifestType: "items",
    metadataSchema: {
      requiredFields: ["id", "name", "type", "modelPath"],
      optionalFields: ["iconPath", "value", "weight", "description"],
      defaults: {
        type: "building",
        tradeable: false,
        rarity: "common",
      },
    },
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get category definition by ID
 */
export function getCategory(
  categoryId: AssetCategory,
): CategoryDefinition | undefined {
  return CATEGORIES[categoryId];
}

/**
 * Get all categories as array
 */
export function getAllCategories(): CategoryDefinition[] {
  return Object.values(CATEGORIES).filter(
    (cat): cat is CategoryDefinition => cat !== undefined,
  );
}

/**
 * Get categories by manifest type
 */
export function getCategoriesByManifestType(
  manifestType: "items" | "npcs" | "resources",
): CategoryDefinition[] {
  return getAllCategories().filter((cat) => cat.manifestType === manifestType);
}
