/**
 * Model Preferences Store
 * Manages user-selected AI models for each task type
 *
 * Features:
 * - localStorage persistence for browser sessions
 * - Optional Supabase sync for cross-device persistence
 * - Default fallback models when no preference is set
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type {
  AIModel,
  ModelsByCapability,
} from "@/app/api/settings/ai-gateway/models/route";

// ============================================================================
// Types
// ============================================================================

export type TaskType =
  | "promptEnhancement"
  | "textGeneration"
  | "dialogueGeneration"
  | "contentGeneration"
  | "imageGeneration"
  | "vision"
  | "reasoning";

export interface ModelPreferences {
  promptEnhancement: string;
  textGeneration: string;
  dialogueGeneration: string;
  contentGeneration: string;
  imageGeneration: string;
  vision: string;
  reasoning: string;
}

export interface TaskTypeInfo {
  key: TaskType;
  label: string;
  description: string;
  requiredCapability: keyof ModelsByCapability;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_PREFERENCES: ModelPreferences = {
  promptEnhancement: "openai/gpt-4o-mini",
  textGeneration: "openai/gpt-4o-mini",
  dialogueGeneration: "google/gemini-2.0-flash",
  contentGeneration: "anthropic/claude-sonnet-4-20250514",
  imageGeneration: "google/gemini-2.5-flash-image",
  vision: "openai/gpt-4o",
  reasoning: "anthropic/claude-sonnet-4-20250514",
};

export const TASK_TYPE_INFO: TaskTypeInfo[] = [
  {
    key: "promptEnhancement",
    label: "Prompt Enhancement",
    description:
      "Fast, cheap model for optimizing prompts before 3D generation",
    requiredCapability: "text",
  },
  {
    key: "textGeneration",
    label: "Text Generation",
    description: "General text generation tasks",
    requiredCapability: "text",
  },
  {
    key: "dialogueGeneration",
    label: "Dialogue Generation",
    description: "NPC dialogue trees and structured JSON output",
    requiredCapability: "text",
  },
  {
    key: "contentGeneration",
    label: "Content Generation",
    description: "Creative content: quests, NPCs, items, world areas",
    requiredCapability: "text",
  },
  {
    key: "imageGeneration",
    label: "Image Generation",
    description: "Concept art, sprites, and textures",
    requiredCapability: "image",
  },
  {
    key: "vision",
    label: "Vision / Image Analysis",
    description: "Analyzing images for asset classification and descriptions",
    requiredCapability: "vision",
  },
  {
    key: "reasoning",
    label: "Complex Reasoning",
    description: "Advanced reasoning and problem-solving tasks",
    requiredCapability: "text",
  },
];

const STORAGE_KEY = "hyperforge:model-preferences";

// ============================================================================
// Store Interface
// ============================================================================

interface ModelPreferencesState {
  // State
  preferences: ModelPreferences;
  availableModels: ModelsByCapability | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastSynced: Date | null;
  error: string | null;

  // Actions
  setPreference: (task: TaskType, modelId: string) => void;
  resetPreference: (task: TaskType) => void;
  resetAllPreferences: () => void;
  fetchAvailableModels: () => Promise<void>;
  syncToSupabase: () => Promise<boolean>;
  loadFromSupabase: () => Promise<boolean>;
  getModelForTask: (task: TaskType) => string;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useModelPreferencesStore = create<ModelPreferencesState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        preferences: { ...DEFAULT_PREFERENCES },
        availableModels: null,
        isLoading: false,
        isSyncing: false,
        lastSynced: null,
        error: null,

        // Set a specific preference
        setPreference: (task, modelId) => {
          set((state) => ({
            preferences: {
              ...state.preferences,
              [task]: modelId,
            },
          }));
        },

        // Reset a specific preference to default
        resetPreference: (task) => {
          set((state) => ({
            preferences: {
              ...state.preferences,
              [task]: DEFAULT_PREFERENCES[task],
            },
          }));
        },

        // Reset all preferences to defaults
        resetAllPreferences: () => {
          set({ preferences: { ...DEFAULT_PREFERENCES } });
        },

        // Fetch available models from API
        fetchAvailableModels: async () => {
          set({ isLoading: true, error: null });

          try {
            const response = await fetch("/api/settings/ai-gateway/models");
            const data = await response.json();

            if (data.configured && data.models) {
              set({
                availableModels: data.models,
                isLoading: false,
              });
            } else {
              set({
                error: data.error || "Failed to fetch models",
                isLoading: false,
              });
            }
          } catch (error) {
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch models",
              isLoading: false,
            });
          }
        },

        // Sync preferences to Supabase
        syncToSupabase: async () => {
          set({ isSyncing: true });

          try {
            const { preferences } = get();

            const response = await fetch("/api/settings/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "model-preferences",
                data: preferences,
              }),
            });

            if (response.ok) {
              set({ lastSynced: new Date(), isSyncing: false });
              return true;
            } else {
              set({ isSyncing: false });
              return false;
            }
          } catch {
            set({ isSyncing: false });
            return false;
          }
        },

        // Load preferences from Supabase
        loadFromSupabase: async () => {
          set({ isSyncing: true });

          try {
            const response = await fetch(
              "/api/settings/preferences?type=model-preferences",
            );

            if (response.ok) {
              const data = await response.json();
              if (data.preferences) {
                set({
                  preferences: { ...DEFAULT_PREFERENCES, ...data.preferences },
                  lastSynced: new Date(),
                  isSyncing: false,
                });
                return true;
              }
            }

            set({ isSyncing: false });
            return false;
          } catch {
            set({ isSyncing: false });
            return false;
          }
        },

        // Get model for a specific task (with fallback)
        getModelForTask: (task) => {
          const { preferences } = get();
          return preferences[task] || DEFAULT_PREFERENCES[task];
        },
      }),
      {
        name: STORAGE_KEY,
        partialize: (state) => ({
          preferences: state.preferences,
          lastSynced: state.lastSynced,
        }),
      },
    ),
    { name: "ModelPreferencesStore" },
  ),
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get available models for a specific task type
 */
export function getModelsForTask(
  availableModels: ModelsByCapability | null,
  task: TaskType,
): AIModel[] {
  if (!availableModels) return [];

  const taskInfo = TASK_TYPE_INFO.find((t) => t.key === task);
  if (!taskInfo) return availableModels.all;

  return availableModels[taskInfo.requiredCapability] || [];
}

/**
 * Check if a model is valid for a task
 */
export function isModelValidForTask(
  modelId: string,
  task: TaskType,
  availableModels: ModelsByCapability | null,
): boolean {
  const models = getModelsForTask(availableModels, task);
  return models.some((m) => m.id === modelId);
}
