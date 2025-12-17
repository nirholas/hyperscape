/**
 * Game Content Types for HyperForge
 *
 * Types for generated game content (quests, areas, stores, biomes).
 * These match the game's manifest structures.
 */

import type { Position3D } from "../core";

// =============================================================================
// QUEST TYPES
// =============================================================================

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
  completeNpcId?: string;
  completeNpcName?: string;
  dialogue?: QuestDialogueRef[];
  lore?: string;
  hint?: string;
  timeLimit?: number; // In minutes
  repeatable?: boolean;
  cooldown?: number; // In minutes
}

export interface GeneratedQuestContent {
  quest: Quest;
  generatedAt: string;
  prompt: string;
}

// =============================================================================
// WORLD AREA TYPES
// =============================================================================

export interface AreaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AreaNPCSpawn {
  id: string;
  type: string;
  position: Position3D;
  storeId?: string;
}

export interface AreaResourceSpawn {
  type: string;
  resourceId: string;
  position: Position3D;
  respawnTime?: number;
}

export interface AreaMobSpawn {
  mobId: string;
  mobName?: string;
  position: Position3D;
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

// =============================================================================
// BIOME TYPES
// =============================================================================

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

// =============================================================================
// STORE TYPES
// =============================================================================

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
  ownerId?: string;
  ownerName?: string;
  location?: string;
  description?: string;
  items: StoreItem[];
  buybackRate: number; // 0.0-1.0 multiplier
  currency?: string;
}

export interface GeneratedStoreContent {
  store: Store;
  generatedAt: string;
  prompt: string;
}

// =============================================================================
// BACKWARDS COMPATIBILITY RE-EXPORTS
// =============================================================================

/**
 * Re-export Item types for backwards compatibility
 * Consumers should migrate to importing from '@/types' or '@/types/game'
 */
export type { Item, GeneratedItemContent } from "./item-types";
