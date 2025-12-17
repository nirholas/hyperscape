/**
 * Generation Store
 * Zustand store for generation state management
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AssetCategory } from "@/types/categories";
import type { GenerationConfig } from "@/components/generation/GenerationFormRouter";

export interface GenerationProgress {
  status: "idle" | "generating" | "completed" | "failed";
  stage?: string; // Current pipeline stage name
  progress: number; // 0-100
  percent?: number; // Alias for progress (SSE compatibility)
  currentStep?: string;
  error?: string;
}

export interface GeneratedAsset {
  id: string;
  category: AssetCategory;
  config: GenerationConfig;
  modelUrl?: string;
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface BatchJob {
  id: string;
  category: AssetCategory;
  baseConfig: GenerationConfig;
  variations: number;
  status: "pending" | "processing" | "completed" | "failed";
  results: GeneratedAsset[];
}

interface GenerationState {
  // Category selection
  selectedCategory: AssetCategory | null;
  setSelectedCategory: (category: AssetCategory | null) => void;

  // Current generation
  currentGeneration: GenerationConfig | null;
  setCurrentGeneration: (config: GenerationConfig | null) => void;

  // Progress tracking
  progress: GenerationProgress;
  setProgress: (progress: GenerationProgress) => void;
  updateProgress: (progress: number, step?: string) => void;

  // Generated assets
  generatedAssets: GeneratedAsset[];
  addGeneratedAsset: (asset: GeneratedAsset) => void;
  removeGeneratedAsset: (id: string) => void;
  clearGeneratedAssets: () => void;

  // Batch generation
  batchQueue: BatchJob[];
  addBatchJob: (job: BatchJob) => void;
  updateBatchJob: (id: string, updates: Partial<BatchJob>) => void;
  removeBatchJob: (id: string) => void;

  // Reset
  reset: () => void;
}

const initialState: Pick<
  GenerationState,
  | "selectedCategory"
  | "currentGeneration"
  | "progress"
  | "generatedAssets"
  | "batchQueue"
> = {
  selectedCategory: null,
  currentGeneration: null,
  progress: {
    status: "idle" as const,
    progress: 0,
  },
  generatedAssets: [],
  batchQueue: [],
};

export const useGenerationStore = create<GenerationState>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelectedCategory: (category) => set({ selectedCategory: category }),

      setCurrentGeneration: (config) => set({ currentGeneration: config }),

      setProgress: (progress) => set({ progress }),

      updateProgress: (progress, step) =>
        set((state) => ({
          progress: {
            ...state.progress,
            progress,
            currentStep: step,
          },
        })),

      addGeneratedAsset: (asset) =>
        set((state) => ({
          generatedAssets: [...state.generatedAssets, asset],
        })),

      removeGeneratedAsset: (id) =>
        set((state) => ({
          generatedAssets: state.generatedAssets.filter((a) => a.id !== id),
        })),

      clearGeneratedAssets: () => set({ generatedAssets: [] }),

      addBatchJob: (job) =>
        set((state) => ({
          batchQueue: [...state.batchQueue, job],
        })),

      updateBatchJob: (id, updates) =>
        set((state) => ({
          batchQueue: state.batchQueue.map((job) =>
            job.id === id ? { ...job, ...updates } : job,
          ),
        })),

      removeBatchJob: (id) =>
        set((state) => ({
          batchQueue: state.batchQueue.filter((job) => job.id !== id),
        })),

      reset: () => set(initialState),
    }),
    { name: "GenerationStore" },
  ),
);
