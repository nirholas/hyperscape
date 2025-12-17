/**
 * Game Types Barrel Export
 *
 * Re-exports all game content types from a single entry point.
 */

// Content types (quests, areas, stores, biomes) - also re-exports Item and GeneratedItemContent
export type {
  QuestDifficulty,
  QuestCategory,
  QuestObjective,
  QuestReward,
  QuestRequirement,
  QuestDialogueRef,
  Quest,
  GeneratedQuestContent,
  AreaBounds,
  AreaNPCSpawn,
  AreaResourceSpawn,
  AreaMobSpawn,
  WorldArea,
  GeneratedAreaContent,
  Biome,
  GeneratedBiomeContent,
  StoreItem,
  Store,
  GeneratedStoreContent,
  // Item types are re-exported here for convenience
  Item,
  GeneratedItemContent,
} from "./content-types";

// Dialogue types
export type {
  DialogueAudio,
  DialogueResponse,
  DialogueEffect,
  DialogueNode,
  DialogueTree,
  DialogueGenerationContext,
  DialogueEditorNode,
  DialogueEditorState,
} from "./dialogue-types";

// Item types (additional exports not covered by content-types re-exports)
export type {
  ItemRarity,
  WeaponType,
  AttackType,
  ItemType,
  EquipSlot,
  CombatBonuses,
  ItemRequirements,
  ItemEffect,
} from "./item-types";

// NPC types
export type {
  NPCCategory,
  NPCStats,
  NPCCombatConfig,
  NPCMovementConfig,
  NPCAppearanceConfig,
  NPCDataInput,
  GeneratedNPCContent,
} from "./npc-types";
