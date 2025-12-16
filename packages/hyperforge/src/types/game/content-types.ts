/**
 * Game Content Types for HyperForge
 * Matches the game's manifest structures exactly
 */

// ============================================
// QUEST TYPES
// ============================================

export type QuestDifficulty = "easy" | "medium" | "hard" | "legendary";
export type QuestCategory = "main" | "side" | "daily" | "event";

export interface QuestObjective {
  id: string;
  type:
    | "kill"
    | "collect"
    | "deliver"
    | "talk"
    | "explore"
    | "craft"
    | "skill"
    | "interact";
  target: string; // ID of target (mob, item, npc, area)
  targetName: string; // Display name
  quantity: number;
  current?: number; // Progress tracking
  description: string;
  optional?: boolean;
  hint?: string;
}

export interface QuestReward {
  type: "xp" | "item" | "gold" | "skill_xp" | "unlock";
  id?: string; // Item ID or skill name
  name: string; // Display name
  quantity: number;
  skillName?: string; // For skill_xp type
}

export interface QuestRequirement {
  type: "quest" | "level" | "skill" | "item";
  id?: string; // Quest ID, skill name
  name: string;
  value?: number; // Level or skill level required
}

export interface QuestDialogueRef {
  npcId: string;
  npcName: string;
  dialogueId: string; // Reference to dialogue tree
  trigger: "start" | "progress" | "complete";
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  category: QuestCategory;
  difficulty: QuestDifficulty;
  recommendedLevel: number;
  objectives: QuestObjective[];
  rewards: QuestReward[];
  requirements?: QuestRequirement[];
  startNpcId: string;
  startNpcName: string;
  completeNpcId?: string; // If different from start NPC
  completeNpcName?: string;
  dialogue?: QuestDialogueRef[];
  lore?: string;
  hint?: string;
  timeLimit?: number; // In minutes, for timed quests
  repeatable?: boolean;
  cooldown?: number; // In minutes, for repeatable quests
}

export interface GeneratedQuestContent {
  quest: Quest;
  generatedAt: string;
  prompt: string;
}

// ============================================
// WORLD AREA TYPES
// ============================================

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface AreaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AreaNPCSpawn {
  id: string;
  type: string; // NPC type/role
  position: Position;
  storeId?: string; // For shopkeepers
}

export interface AreaResourceSpawn {
  type: string; // tree, rock, fishing_spot
  resourceId: string;
  position: Position;
  respawnTime?: number;
}

export interface AreaMobSpawn {
  mobId: string;
  mobName?: string;
  position: Position;
  spawnRadius: number;
  maxCount: number;
  respawnTicks?: number;
}

export interface WorldArea {
  id: string;
  name: string;
  description: string;
  difficultyLevel: number; // 0-5
  bounds: AreaBounds;
  biomeType: string;
  safeZone: boolean;
  npcs: AreaNPCSpawn[];
  resources: AreaResourceSpawn[];
  mobSpawns: AreaMobSpawn[];
  ambientSound?: string;
  musicTrack?: string;
  fogIntensity?: number;
  colorScheme?: {
    primary: string;
    secondary: string;
    fog: string;
  };
}

export interface GeneratedAreaContent {
  area: WorldArea;
  generatedAt: string;
  prompt: string;
}

// ============================================
// ITEM TYPES (Enhanced from CDN types)
// ============================================

export type ItemType =
  | "weapon"
  | "armor"
  | "tool"
  | "resource"
  | "consumable"
  | "quest"
  | "currency"
  | "material";

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
  | "ring";

export type WeaponType =
  | "SWORD"
  | "AXE"
  | "MACE"
  | "DAGGER"
  | "SPEAR"
  | "BOW"
  | "STAFF"
  | "WAND";

export type AttackType = "MELEE" | "RANGED" | "MAGIC";

export type ItemRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "unique";

export interface ItemBonuses {
  attack?: number;
  strength?: number;
  defense?: number;
  ranged?: number;
  magic?: number;
  prayer?: number;
  health?: number;
}

export interface ItemRequirements {
  level?: number;
  skills?: Record<string, number>;
  quest?: string;
}

export interface ItemEffect {
  type: "heal" | "buff" | "debuff" | "teleport" | "unlock";
  value?: number;
  duration?: number; // In seconds
  target?: string; // For teleport/unlock
}

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  subtype?: string;
  description: string;
  examine: string;
  rarity: ItemRarity;
  value: number;
  weight: number;
  stackable: boolean;
  tradeable: boolean;
  // Equipment properties
  equipSlot?: EquipSlot;
  weaponType?: WeaponType;
  attackType?: AttackType;
  attackSpeed?: number;
  attackRange?: number;
  twoHanded?: boolean;
  // Stats
  bonuses?: ItemBonuses;
  requirements?: ItemRequirements;
  // Consumable effects
  effects?: ItemEffect[];
  // Model paths
  modelPath?: string;
  iconPath?: string;
  equippedModelPath?: string;
}

export interface GeneratedItemContent {
  item: Item;
  generatedAt: string;
  prompt: string;
}

// ============================================
// BIOME TYPES
// ============================================

export interface Biome {
  id: string;
  name: string;
  description: string;
  difficultyLevel: number;
  terrain: string;
  resources: string[];
  mobs: string[];
  fogIntensity: number;
  ambientSound: string;
  colorScheme: {
    primary: string;
    secondary: string;
    fog: string;
  };
  heightRange: [number, number];
  resourceDensity: number;
  resourceTypes: string[];
  mobTypes: string[];
}

export interface GeneratedBiomeContent {
  biome: Biome;
  generatedAt: string;
  prompt: string;
}

// ============================================
// STORE TYPES
// ============================================

export interface StoreItem {
  itemId: string;
  itemName: string;
  basePrice: number;
  stock: number | "unlimited";
  restockRate?: number; // Items per minute
}

export interface Store {
  id: string;
  name: string;
  type: "general" | "weapon" | "armor" | "magic" | "food" | "specialty";
  ownerId?: string; // NPC ID
  ownerName?: string;
  location?: string;
  description?: string;
  items: StoreItem[];
  buybackRate: number; // 0.0-1.0 multiplier for selling
  currency?: string; // Default: coins
}

export interface GeneratedStoreContent {
  store: Store;
  generatedAt: string;
  prompt: string;
}
