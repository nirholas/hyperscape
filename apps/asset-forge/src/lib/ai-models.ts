/**
 * AI Model Definitions
 *
 * Shared constants for available AI models.
 * Frontend-safe (no SDK imports).
 */

export const AVAILABLE_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', tier: 'cost' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', tier: 'speed' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', tier: 'quality' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', tier: 'quality' },
] as const

export type TaskType =
  | 'npc_dialogue'
  | 'dialogue_tree'
  | 'quest_generation'
  | 'lore_writing'

export type Priority = 'cost' | 'quality' | 'speed'
