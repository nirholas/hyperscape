/**
 * Quest Type Definitions
 *
 * Types for the manifest-driven quest system.
 * Quests are defined in quests.json and loaded at runtime.
 *
 * @see QUEST_SYSTEM_PLAN.md for implementation details
 */

// === Constants ===

/** Maximum length for quest IDs (security: prevent DoS via huge strings) */
export const MAX_QUEST_ID_LENGTH = 64;

/** Pattern for valid quest IDs: lowercase alphanumeric + underscore */
export const QUEST_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

// === Core Types ===

/**
 * Quest status values.
 * - "not_started": Player hasn't begun the quest
 * - "in_progress": Quest active, objectives not complete
 * - "ready_to_complete": Quest active, current stage objective IS complete (derived state)
 * - "completed": Quest finished, rewards claimed
 */
export type QuestStatus =
  | "not_started"
  | "in_progress"
  | "ready_to_complete"
  | "completed";

/** Database-stored status values (ready_to_complete is derived, not stored) */
export type QuestDbStatus = "not_started" | "in_progress" | "completed";

/** Quest difficulty levels matching RuneScape */
export type QuestDifficulty =
  | "novice"
  | "intermediate"
  | "experienced"
  | "master"
  | "grandmaster";

/** Types of quest stage objectives */
export type QuestStageType =
  | "dialogue"
  | "kill"
  | "gather"
  | "travel"
  | "interact";

// === Quest Definition Types ===

/** Requirements to start a quest */
export interface QuestRequirements {
  /** Quest IDs that must be completed first */
  readonly quests: string[];
  /** Skill requirements: { "attack": 10, "woodcutting": 15 } */
  readonly skills: Record<string, number>;
  /** Item IDs the player must have */
  readonly items: string[];
}

/** A single stage within a quest */
export interface QuestStage {
  /** Unique stage identifier within this quest */
  readonly id: string;
  /** Type of objective */
  readonly type: QuestStageType;
  /** Human-readable description for quest journal */
  readonly description: string;
  /** NPC ID for dialogue stages */
  readonly npcId?: string;
  /** Target NPC/item ID for kill/gather stages */
  readonly target?: string;
  /** Required count for kill/gather stages */
  readonly count?: number;
  /** Location requirement for travel stages */
  readonly location?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly radius: number;
  };
}

/** Items/effects granted when quest starts */
export interface QuestOnStart {
  /** Items given to player on quest start */
  readonly items?: Array<{
    readonly itemId: string;
    readonly quantity: number;
  }>;
  /** Dialogue node to jump to after starting */
  readonly dialogue?: string;
}

/** Rewards granted on quest completion */
export interface QuestRewards {
  /** Quest points awarded */
  readonly questPoints: number;
  /** Items given on completion */
  readonly items: Array<{ readonly itemId: string; readonly quantity: number }>;
  /** XP awarded per skill: { "attack": 500, "strength": 500 } */
  readonly xp: Record<string, number>;
}

/** Full quest definition from manifest */
export interface QuestDefinition {
  /** Unique quest identifier */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Short description for quest list */
  readonly description: string;
  /** Difficulty rating */
  readonly difficulty: QuestDifficulty;
  /** Quest points awarded on completion */
  readonly questPoints: number;
  /** Whether quest can be done again (typically false) */
  readonly replayable: boolean;
  /** Requirements to start the quest */
  readonly requirements: QuestRequirements;
  /** NPC ID that starts this quest */
  readonly startNpc: string;
  /** Ordered list of quest stages */
  readonly stages: QuestStage[];
  /** Items/effects on quest start */
  readonly onStart?: QuestOnStart;
  /** Rewards on completion */
  readonly rewards: QuestRewards;
}

// === Player Progress Types ===

/** Progress data for a stage (e.g., kill count) */
export interface StageProgress {
  [key: string]: number;
}

/** Player's progress on a specific quest */
export interface QuestProgress {
  /** Player/character ID */
  readonly playerId: string;
  /** Quest identifier */
  readonly questId: string;
  /** Current status */
  readonly status: QuestStatus;
  /** Current stage ID */
  readonly currentStage: string;
  /** Progress within current stage */
  readonly stageProgress: StageProgress;
  /** When quest was started (Unix ms) */
  readonly startedAt?: number;
  /** When quest was completed (Unix ms) */
  readonly completedAt?: number;
}

/** Complete quest state for a player */
export interface PlayerQuestState {
  /** Player/character ID */
  readonly playerId: string;
  /** Total quest points earned */
  readonly questPoints: number;
  /** Active quests mapped by quest ID */
  readonly activeQuests: Map<string, QuestProgress>;
  /** Set of completed quest IDs */
  readonly completedQuests: Set<string>;
}

// === Manifest Types ===

/** Quest manifest structure (quests.json) */
export interface QuestManifest {
  [questId: string]: QuestDefinition;
}

// === Dialogue Integration Types ===

/** Quest-based dialogue overrides for NPCs */
export interface QuestDialogueOverrides {
  /** Entry node when quest is in progress but objective incomplete */
  readonly in_progress?: string;
  /** Entry node when quest is in progress AND objective complete */
  readonly ready_to_complete?: string;
  /** Entry node after quest is completed */
  readonly completed?: string;
}

/** NPC dialogue with quest overrides */
export interface QuestAwareDialogue {
  /** Default entry node */
  readonly entryNodeId: string;
  /** Quest-specific entry node overrides */
  readonly questOverrides?: Record<string, QuestDialogueOverrides>;
  /** Dialogue nodes */
  readonly nodes: unknown[]; // Full type defined in dialogue-types.ts
}

// === Type Guards ===

/**
 * Validates a quest ID string
 */
export function isValidQuestId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_QUEST_ID_LENGTH &&
    QUEST_ID_PATTERN.test(id)
  );
}

/**
 * Validates a quest status value
 */
export function isValidQuestStatus(status: unknown): status is QuestStatus {
  return (
    status === "not_started" ||
    status === "in_progress" ||
    status === "ready_to_complete" ||
    status === "completed"
  );
}

/**
 * Validates a quest difficulty value
 */
export function isValidQuestDifficulty(
  difficulty: unknown,
): difficulty is QuestDifficulty {
  return (
    difficulty === "novice" ||
    difficulty === "intermediate" ||
    difficulty === "experienced" ||
    difficulty === "master" ||
    difficulty === "grandmaster"
  );
}
