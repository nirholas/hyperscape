/**
 * Game NPC Types
 *
 * Extended NPC types for game content generation.
 */

import type { NPCCategory, Position3D, AttackType } from "../core";
import type { DialogueTree } from "./dialogue-types";

// Re-export for convenience
export type { NPCCategory } from "../core";

// =============================================================================
// NPC STATS
// =============================================================================

/**
 * NPC combat and attribute stats
 */
export interface NPCStats {
  health: number;
  maxHealth: number;
  attack: number;
  strength: number;
  defense: number;
  magic?: number;
  ranged?: number;
}

// =============================================================================
// NPC CONFIG
// =============================================================================

/**
 * NPC combat configuration
 */
export interface NPCCombatConfig {
  enabled: boolean;
  attackType: AttackType;
  attackSpeed: number;
  attackRange: number;
  canRetreat: boolean;
  aggroRange: number;
}

/**
 * NPC movement configuration
 */
export interface NPCMovementConfig {
  enabled: boolean;
  speed: number;
  canFly?: boolean;
  canSwim?: boolean;
}

/**
 * NPC appearance configuration
 */
export interface NPCAppearanceConfig {
  modelPath?: string;
  thumbnailPath?: string;
  iconPath?: string;
  scale: number;
  tint?: string;
}

// =============================================================================
// NPC DATA
// =============================================================================

/**
 * Complete NPC data input for generation/creation
 */
export interface NPCDataInput {
  // Required
  id: string;
  name: string;
  description: string;
  category: NPCCategory;

  // Optional
  faction?: string;
  stats?: Partial<NPCStats>;
  combat?: Partial<NPCCombatConfig>;
  movement?: Partial<NPCMovementConfig>;
  appearance?: Partial<NPCAppearanceConfig>;
  level?: number;
  health?: number;
  combatLevel?: number;
  modelPath?: string;
  thumbnailPath?: string;
  position?: Position3D;
  spawnBiomes?: string[];
  dialogue?: DialogueTree;
  drops?: Record<string, unknown>;

  // Generation metadata
  personality?: string;
  backstory?: string;
  services?: string[];
}

/**
 * Generated NPC content with metadata
 */
export interface GeneratedNPCContent {
  id: string;
  name: string;
  description: string;
  category: NPCCategory;
  personality: string;
  backstory?: string;
  dialogue: DialogueTree;
  generatedAt: string;
  prompt: string;
}
