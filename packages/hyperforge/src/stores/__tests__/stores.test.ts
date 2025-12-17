/**
 * Zustand Stores Tests
 *
 * Tests for HyperForge Zustand stores without mocks.
 * Tests actual store logic, state transitions, and data integrity.
 *
 * NOTE: Tests run sequentially within describe blocks because Zustand stores
 * are singletons and concurrent tests would cause race conditions.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useAppStore } from "../app-store";
import {
  useGenerationStore,
  type GenerationProgress,
  type GeneratedAsset,
} from "../generation-store";
import {
  useModelPreferencesStore,
  DEFAULT_PREFERENCES,
} from "../model-preferences-store";
import { useVariantStore } from "../variant-store";
import type { TextureVariant } from "@/components/generation/GenerationFormRouter";

// =============================================================================
// APP STORE TESTS
// =============================================================================

describe.sequential("App Store", () => {
  // Reset store state before each test
  beforeEach(() => {
    useAppStore.setState({
      activeModule: "library",
      selectedAsset: null,
      sidebarCollapsed: false,
      vaultOpen: true,
      viewportPanel: "none",
      propertiesPanelOpen: false,
    });
  });

  describe("Initial State", () => {
    it("has correct default values", () => {
      const state = useAppStore.getState();

      expect(state.activeModule).toBe("library");
      expect(state.selectedAsset).toBeNull();
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.vaultOpen).toBe(true);
      expect(state.viewportPanel).toBe("none");
      expect(state.propertiesPanelOpen).toBe(false);
    });
  });

  describe("setActiveModule", () => {
    it("updates activeModule to library", () => {
      useAppStore.getState().setActiveModule("library");
      expect(useAppStore.getState().activeModule).toBe("library");
    });

    it("updates activeModule to character-equipment", () => {
      useAppStore.getState().setActiveModule("character-equipment");
      expect(useAppStore.getState().activeModule).toBe("character-equipment");
    });

    it("updates activeModule to armor-fitting", () => {
      useAppStore.getState().setActiveModule("armor-fitting");
      expect(useAppStore.getState().activeModule).toBe("armor-fitting");
    });

    it("updates activeModule to audio-studio", () => {
      useAppStore.getState().setActiveModule("audio-studio");
      expect(useAppStore.getState().activeModule).toBe("audio-studio");
    });

    it("sets corresponding viewportPanel when switching modules", () => {
      useAppStore.getState().setActiveModule("character-equipment");
      expect(useAppStore.getState().viewportPanel).toBe("character-equipment");

      useAppStore.getState().setActiveModule("armor-fitting");
      expect(useAppStore.getState().viewportPanel).toBe("armor-fitting");

      useAppStore.getState().setActiveModule("library");
      expect(useAppStore.getState().viewportPanel).toBe("none");
    });

    it("closes properties panel when switching modules", () => {
      // First open properties panel by selecting an asset
      useAppStore.getState().setSelectedAsset({
        id: "test-1",
        name: "Test Asset",
        source: "LOCAL",
        category: "weapon",
      });
      expect(useAppStore.getState().propertiesPanelOpen).toBe(true);

      // Switch module - should close properties panel
      useAppStore.getState().setActiveModule("character-equipment");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(false);
    });
  });

  describe("setSelectedAsset", () => {
    it("updates selectedAsset to a valid asset", () => {
      const testAsset = {
        id: "asset-123",
        name: "Iron Sword",
        source: "CDN" as const,
        category: "weapon" as const,
        modelPath: "/models/iron-sword.glb",
      };

      useAppStore.getState().setSelectedAsset(testAsset);

      const state = useAppStore.getState();
      expect(state.selectedAsset).toEqual(testAsset);
      expect(state.selectedAsset?.id).toBe("asset-123");
      expect(state.selectedAsset?.name).toBe("Iron Sword");
    });

    it("clears selectedAsset when set to null", () => {
      // First set an asset
      useAppStore.getState().setSelectedAsset({
        id: "test-1",
        name: "Test",
        source: "LOCAL",
        category: "npc",
      });
      expect(useAppStore.getState().selectedAsset).not.toBeNull();

      // Clear it
      useAppStore.getState().setSelectedAsset(null);
      expect(useAppStore.getState().selectedAsset).toBeNull();
    });

    it("opens properties viewportPanel when selecting asset", () => {
      useAppStore.getState().setSelectedAsset({
        id: "test-1",
        name: "Test",
        source: "LOCAL",
        category: "prop",
      });

      expect(useAppStore.getState().viewportPanel).toBe("properties");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(true);
    });

    it("closes properties viewportPanel when deselecting asset", () => {
      // Select then deselect
      useAppStore.getState().setSelectedAsset({
        id: "test-1",
        name: "Test",
        source: "LOCAL",
        category: "prop",
      });
      useAppStore.getState().setSelectedAsset(null);

      expect(useAppStore.getState().viewportPanel).toBe("none");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(false);
    });
  });

  describe("toggleSidebar", () => {
    it("toggles from collapsed false to true", () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      useAppStore.getState().toggleSidebar();

      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });

    it("toggles from collapsed true to false", () => {
      useAppStore.setState({ sidebarCollapsed: true });
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      useAppStore.getState().toggleSidebar();

      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it("toggles multiple times correctly", () => {
      const initial = useAppStore.getState().sidebarCollapsed;

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(!initial);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(initial);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(!initial);
    });
  });

  describe("toggleVault", () => {
    it("toggles from open true to false", () => {
      expect(useAppStore.getState().vaultOpen).toBe(true);

      useAppStore.getState().toggleVault();

      expect(useAppStore.getState().vaultOpen).toBe(false);
    });

    it("toggles from open false to true", () => {
      useAppStore.setState({ vaultOpen: false });
      expect(useAppStore.getState().vaultOpen).toBe(false);

      useAppStore.getState().toggleVault();

      expect(useAppStore.getState().vaultOpen).toBe(true);
    });

    it("toggles multiple times correctly", () => {
      const initial = useAppStore.getState().vaultOpen;

      useAppStore.getState().toggleVault();
      expect(useAppStore.getState().vaultOpen).toBe(!initial);

      useAppStore.getState().toggleVault();
      expect(useAppStore.getState().vaultOpen).toBe(initial);
    });
  });

  describe("Viewport Panel Actions", () => {
    it("setViewportPanel updates panel type", () => {
      useAppStore.getState().setViewportPanel("generation");
      expect(useAppStore.getState().viewportPanel).toBe("generation");

      useAppStore.getState().setViewportPanel("enhancement");
      expect(useAppStore.getState().viewportPanel).toBe("enhancement");
    });

    it("closeViewportPanel resets to none", () => {
      useAppStore.getState().setViewportPanel("properties");
      expect(useAppStore.getState().viewportPanel).toBe("properties");

      useAppStore.getState().closeViewportPanel();
      expect(useAppStore.getState().viewportPanel).toBe("none");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(false);
    });
  });

  describe("Legacy Compatibility", () => {
    it("openPropertiesPanel sets correct state", () => {
      useAppStore.getState().openPropertiesPanel();

      expect(useAppStore.getState().viewportPanel).toBe("properties");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(true);
    });

    it("closePropertiesPanel sets correct state", () => {
      useAppStore.getState().openPropertiesPanel();
      useAppStore.getState().closePropertiesPanel();

      expect(useAppStore.getState().viewportPanel).toBe("none");
      expect(useAppStore.getState().propertiesPanelOpen).toBe(false);
    });
  });
});

// =============================================================================
// GENERATION STORE TESTS
// =============================================================================

describe.sequential("Generation Store", () => {
  // Reset store state before each test - use setState for full reset
  beforeEach(() => {
    useGenerationStore.setState({
      selectedCategory: null,
      currentGeneration: null,
      progress: {
        status: "idle" as const,
        progress: 0,
      },
      generatedAssets: [],
      batchQueue: [],
    });
  });

  describe("Initial State", () => {
    it("has idle progress state", () => {
      const state = useGenerationStore.getState();

      expect(state.progress.status).toBe("idle");
      expect(state.progress.progress).toBe(0);
    });

    it("has empty generated assets array", () => {
      expect(useGenerationStore.getState().generatedAssets).toEqual([]);
    });

    it("has null selected category", () => {
      expect(useGenerationStore.getState().selectedCategory).toBeNull();
    });

    it("has null current generation config", () => {
      expect(useGenerationStore.getState().currentGeneration).toBeNull();
    });

    it("has empty batch queue", () => {
      expect(useGenerationStore.getState().batchQueue).toEqual([]);
    });
  });

  describe("setProgress", () => {
    it("updates progress to generating state", () => {
      const progress: GenerationProgress = {
        status: "generating",
        progress: 25,
        stage: "meshing",
        currentStep: "Creating geometry",
      };

      useGenerationStore.getState().setProgress(progress);

      const state = useGenerationStore.getState();
      expect(state.progress.status).toBe("generating");
      expect(state.progress.progress).toBe(25);
      expect(state.progress.stage).toBe("meshing");
      expect(state.progress.currentStep).toBe("Creating geometry");
    });

    it("updates progress to completed state", () => {
      const progress: GenerationProgress = {
        status: "completed",
        progress: 100,
      };

      useGenerationStore.getState().setProgress(progress);

      expect(useGenerationStore.getState().progress.status).toBe("completed");
      expect(useGenerationStore.getState().progress.progress).toBe(100);
    });

    it("updates progress to failed state with error", () => {
      const progress: GenerationProgress = {
        status: "failed",
        progress: 50,
        error: "API rate limit exceeded",
      };

      useGenerationStore.getState().setProgress(progress);

      const state = useGenerationStore.getState();
      expect(state.progress.status).toBe("failed");
      expect(state.progress.error).toBe("API rate limit exceeded");
    });
  });

  describe("updateProgress", () => {
    it("updates progress value while preserving status", () => {
      // First set initial generating state
      useGenerationStore.getState().setProgress({
        status: "generating",
        progress: 0,
      });

      useGenerationStore.getState().updateProgress(75, "Texturing model");

      const state = useGenerationStore.getState();
      expect(state.progress.progress).toBe(75);
      expect(state.progress.currentStep).toBe("Texturing model");
      expect(state.progress.status).toBe("generating");
    });
  });

  describe("addGeneratedAsset", () => {
    it("adds a single asset to empty array", () => {
      const asset: GeneratedAsset = {
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "A steel sword",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
        },
        modelUrl: "https://cdn.example.com/models/sword.glb",
        createdAt: new Date(),
        metadata: { polyCount: 5000 },
      };

      useGenerationStore.getState().addGeneratedAsset(asset);

      const assets = useGenerationStore.getState().generatedAssets;
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe("gen-1");
      expect(assets[0].category).toBe("weapon");
    });

    it("appends multiple assets preserving order", () => {
      const asset1: GeneratedAsset = {
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "Sword",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      };

      const asset2: GeneratedAsset = {
        id: "gen-2",
        category: "npc",
        config: {
          category: "npc",
          prompt: "Goblin",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      };

      useGenerationStore.getState().addGeneratedAsset(asset1);
      useGenerationStore.getState().addGeneratedAsset(asset2);

      const assets = useGenerationStore.getState().generatedAssets;
      expect(assets).toHaveLength(2);
      expect(assets[0].id).toBe("gen-1");
      expect(assets[1].id).toBe("gen-2");
    });
  });

  describe("removeGeneratedAsset", () => {
    it("removes asset by id", () => {
      // Add two assets
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "Sword",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-2",
        category: "npc",
        config: {
          category: "npc",
          prompt: "Goblin",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });

      expect(useGenerationStore.getState().generatedAssets).toHaveLength(2);

      // Remove first asset
      useGenerationStore.getState().removeGeneratedAsset("gen-1");

      const assets = useGenerationStore.getState().generatedAssets;
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe("gen-2");
    });

    it("does nothing when removing non-existent id", () => {
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "Sword",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });

      useGenerationStore.getState().removeGeneratedAsset("non-existent");

      expect(useGenerationStore.getState().generatedAssets).toHaveLength(1);
    });
  });

  describe("clearGeneratedAssets", () => {
    it("resets generatedAssets to empty array", () => {
      // Add some assets
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "Sword",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-2",
        category: "npc",
        config: {
          category: "npc",
          prompt: "Goblin",
          pipeline: "text-to-3d",
          quality: "high",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });

      expect(useGenerationStore.getState().generatedAssets).toHaveLength(2);

      useGenerationStore.getState().clearGeneratedAssets();

      expect(useGenerationStore.getState().generatedAssets).toEqual([]);
    });
  });

  describe("setSelectedCategory", () => {
    it("updates selected category to weapon", () => {
      useGenerationStore.getState().setSelectedCategory("weapon");
      expect(useGenerationStore.getState().selectedCategory).toBe("weapon");
    });

    it("updates selected category to npc", () => {
      useGenerationStore.getState().setSelectedCategory("npc");
      expect(useGenerationStore.getState().selectedCategory).toBe("npc");
    });

    it("clears selected category when set to null", () => {
      useGenerationStore.getState().setSelectedCategory("weapon");
      useGenerationStore.getState().setSelectedCategory(null);
      expect(useGenerationStore.getState().selectedCategory).toBeNull();
    });
  });

  describe("Batch Job Management", () => {
    it("addBatchJob adds job to queue", () => {
      const job = {
        id: "batch-1",
        category: "weapon" as const,
        baseConfig: {
          category: "weapon" as const,
          prompt: "Sword",
          pipeline: "text-to-3d" as const,
          quality: "high" as const,
          metadata: {},
        },
        variations: 5,
        status: "pending" as const,
        results: [],
      };

      useGenerationStore.getState().addBatchJob(job);

      expect(useGenerationStore.getState().batchQueue).toHaveLength(1);
      expect(useGenerationStore.getState().batchQueue[0].id).toBe("batch-1");
    });

    it("updateBatchJob updates job status", () => {
      const job = {
        id: "batch-1",
        category: "weapon" as const,
        baseConfig: {
          category: "weapon" as const,
          prompt: "Sword",
          pipeline: "text-to-3d" as const,
          quality: "high" as const,
          metadata: {},
        },
        variations: 5,
        status: "pending" as const,
        results: [],
      };

      useGenerationStore.getState().addBatchJob(job);
      useGenerationStore
        .getState()
        .updateBatchJob("batch-1", { status: "processing" });

      expect(useGenerationStore.getState().batchQueue[0].status).toBe(
        "processing",
      );
    });

    it("removeBatchJob removes job from queue", () => {
      const job = {
        id: "batch-1",
        category: "weapon" as const,
        baseConfig: {
          category: "weapon" as const,
          prompt: "Sword",
          pipeline: "text-to-3d" as const,
          quality: "high" as const,
          metadata: {},
        },
        variations: 5,
        status: "pending" as const,
        results: [],
      };

      useGenerationStore.getState().addBatchJob(job);
      useGenerationStore.getState().removeBatchJob("batch-1");

      expect(useGenerationStore.getState().batchQueue).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", () => {
      // Modify state
      useGenerationStore.getState().setSelectedCategory("weapon");
      useGenerationStore
        .getState()
        .setProgress({ status: "generating", progress: 50 });
      useGenerationStore.getState().addGeneratedAsset({
        id: "gen-1",
        category: "weapon",
        config: {
          category: "weapon",
          prompt: "Sword",
          pipeline: "text-to-3d",
          quality: "medium",
          metadata: {},
        },
        createdAt: new Date(),
        metadata: {},
      });

      // Reset
      useGenerationStore.getState().reset();

      // Verify reset
      const state = useGenerationStore.getState();
      expect(state.selectedCategory).toBeNull();
      expect(state.progress.status).toBe("idle");
      expect(state.progress.progress).toBe(0);
      expect(state.generatedAssets).toEqual([]);
    });
  });
});

// =============================================================================
// MODEL PREFERENCES STORE TESTS
// =============================================================================

describe.sequential("Model Preferences Store", () => {
  // Reset store state before each test
  beforeEach(() => {
    useModelPreferencesStore.setState({
      preferences: { ...DEFAULT_PREFERENCES },
      availableModels: null,
      isLoading: false,
      isSyncing: false,
      lastSynced: null,
      error: null,
    });
  });

  describe("Initial State", () => {
    it("has default preferences for all task types", () => {
      const { preferences } = useModelPreferencesStore.getState();

      expect(preferences.promptEnhancement).toBe("openai/gpt-4o-mini");
      expect(preferences.textGeneration).toBe("openai/gpt-4o-mini");
      expect(preferences.dialogueGeneration).toBe("google/gemini-2.0-flash");
      expect(preferences.contentGeneration).toBe(
        "anthropic/claude-sonnet-4-20250514",
      );
      expect(preferences.imageGeneration).toBe("google/gemini-2.5-flash-image");
      expect(preferences.vision).toBe("openai/gpt-4o");
      expect(preferences.reasoning).toBe("anthropic/claude-sonnet-4-20250514");
    });

    it("has null available models initially", () => {
      expect(useModelPreferencesStore.getState().availableModels).toBeNull();
    });

    it("has loading and syncing as false", () => {
      const state = useModelPreferencesStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isSyncing).toBe(false);
    });

    it("has null lastSynced and error", () => {
      const state = useModelPreferencesStore.getState();
      expect(state.lastSynced).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe("setPreference", () => {
    it("updates promptEnhancement model", () => {
      useModelPreferencesStore
        .getState()
        .setPreference("promptEnhancement", "anthropic/claude-haiku-3");

      expect(
        useModelPreferencesStore.getState().preferences.promptEnhancement,
      ).toBe("anthropic/claude-haiku-3");
    });

    it("updates textGeneration model", () => {
      useModelPreferencesStore
        .getState()
        .setPreference("textGeneration", "google/gemini-pro");

      expect(
        useModelPreferencesStore.getState().preferences.textGeneration,
      ).toBe("google/gemini-pro");
    });

    it("updates imageGeneration model", () => {
      useModelPreferencesStore
        .getState()
        .setPreference("imageGeneration", "bfl/flux-2-pro");

      expect(
        useModelPreferencesStore.getState().preferences.imageGeneration,
      ).toBe("bfl/flux-2-pro");
    });

    it("updates vision model", () => {
      useModelPreferencesStore
        .getState()
        .setPreference("vision", "anthropic/claude-sonnet-4-20250514");

      expect(useModelPreferencesStore.getState().preferences.vision).toBe(
        "anthropic/claude-sonnet-4-20250514",
      );
    });

    it("preserves other preferences when updating one", () => {
      const originalPromptEnhancement =
        useModelPreferencesStore.getState().preferences.promptEnhancement;

      useModelPreferencesStore.getState().setPreference("vision", "new-model");

      expect(
        useModelPreferencesStore.getState().preferences.promptEnhancement,
      ).toBe(originalPromptEnhancement);
    });
  });

  describe("resetPreference", () => {
    it("resets single preference to default", () => {
      // Change a preference
      useModelPreferencesStore
        .getState()
        .setPreference("promptEnhancement", "custom-model");
      expect(
        useModelPreferencesStore.getState().preferences.promptEnhancement,
      ).toBe("custom-model");

      // Reset it
      useModelPreferencesStore.getState().resetPreference("promptEnhancement");

      expect(
        useModelPreferencesStore.getState().preferences.promptEnhancement,
      ).toBe(DEFAULT_PREFERENCES.promptEnhancement);
    });

    it("preserves other preferences when resetting one", () => {
      // Change multiple preferences
      useModelPreferencesStore
        .getState()
        .setPreference("promptEnhancement", "custom-1");
      useModelPreferencesStore.getState().setPreference("vision", "custom-2");

      // Reset only promptEnhancement
      useModelPreferencesStore.getState().resetPreference("promptEnhancement");

      // Vision should still be custom
      expect(useModelPreferencesStore.getState().preferences.vision).toBe(
        "custom-2",
      );
    });
  });

  describe("resetAllPreferences", () => {
    it("resets all preferences to defaults", () => {
      // Change multiple preferences
      useModelPreferencesStore
        .getState()
        .setPreference("promptEnhancement", "custom-1");
      useModelPreferencesStore
        .getState()
        .setPreference("textGeneration", "custom-2");
      useModelPreferencesStore.getState().setPreference("vision", "custom-3");
      useModelPreferencesStore
        .getState()
        .setPreference("imageGeneration", "custom-4");

      // Reset all
      useModelPreferencesStore.getState().resetAllPreferences();

      const { preferences } = useModelPreferencesStore.getState();
      expect(preferences).toEqual(DEFAULT_PREFERENCES);
    });
  });

  describe("getModelForTask", () => {
    it("returns preference for existing task", () => {
      const model = useModelPreferencesStore
        .getState()
        .getModelForTask("promptEnhancement");
      expect(model).toBe("openai/gpt-4o-mini");
    });

    it("returns preference after update", () => {
      useModelPreferencesStore
        .getState()
        .setPreference("reasoning", "openai/o1-preview");

      const model = useModelPreferencesStore
        .getState()
        .getModelForTask("reasoning");
      expect(model).toBe("openai/o1-preview");
    });
  });

  describe("Preferences Persistence", () => {
    it("maintains task model choices across multiple updates", () => {
      // Simulate user selecting models over time
      useModelPreferencesStore
        .getState()
        .setPreference("promptEnhancement", "fast-model");
      useModelPreferencesStore
        .getState()
        .setPreference("contentGeneration", "creative-model");
      useModelPreferencesStore
        .getState()
        .setPreference("reasoning", "smart-model");

      const { preferences } = useModelPreferencesStore.getState();

      expect(preferences.promptEnhancement).toBe("fast-model");
      expect(preferences.contentGeneration).toBe("creative-model");
      expect(preferences.reasoning).toBe("smart-model");
      // Unchanged ones should still be default
      expect(preferences.vision).toBe(DEFAULT_PREFERENCES.vision);
    });
  });
});

// =============================================================================
// VARIANT STORE TESTS
// =============================================================================

describe.sequential("Variant Store", () => {
  // Reset store state before each test - use setState for full reset
  beforeEach(() => {
    useVariantStore.setState({
      baseModelId: null,
      baseModelUrl: null,
      baseModelName: null,
      variants: [],
      generatedVariants: [],
      isGenerating: false,
      currentVariantIndex: 0,
    });
  });

  describe("Initial State", () => {
    it("has empty variants array", () => {
      expect(useVariantStore.getState().variants).toEqual([]);
    });

    it("has empty generatedVariants array", () => {
      expect(useVariantStore.getState().generatedVariants).toEqual([]);
    });

    it("has null base model values", () => {
      const state = useVariantStore.getState();
      expect(state.baseModelId).toBeNull();
      expect(state.baseModelUrl).toBeNull();
      expect(state.baseModelName).toBeNull();
    });

    it("has isGenerating as false", () => {
      expect(useVariantStore.getState().isGenerating).toBe(false);
    });

    it("has currentVariantIndex as 0", () => {
      expect(useVariantStore.getState().currentVariantIndex).toBe(0);
    });
  });

  describe("Base Model Management", () => {
    it("setBaseModel sets all base model properties", () => {
      useVariantStore
        .getState()
        .setBaseModel(
          "model-123",
          "https://cdn.example.com/model.glb",
          "Iron Sword",
        );

      const state = useVariantStore.getState();
      expect(state.baseModelId).toBe("model-123");
      expect(state.baseModelUrl).toBe("https://cdn.example.com/model.glb");
      expect(state.baseModelName).toBe("Iron Sword");
    });

    it("clearBaseModel resets base model properties", () => {
      useVariantStore
        .getState()
        .setBaseModel(
          "model-123",
          "https://cdn.example.com/model.glb",
          "Iron Sword",
        );
      useVariantStore.getState().clearBaseModel();

      const state = useVariantStore.getState();
      expect(state.baseModelId).toBeNull();
      expect(state.baseModelUrl).toBeNull();
      expect(state.baseModelName).toBeNull();
    });
  });

  describe("addVariant", () => {
    it("adds a single variant to empty array", () => {
      const variant: TextureVariant = {
        id: "variant-1",
        name: "Bronze",
        prompt: "Bronze metallic texture with patina",
        materialPresetId: "bronze-standard",
      };

      useVariantStore.getState().addVariant(variant);

      const variants = useVariantStore.getState().variants;
      expect(variants).toHaveLength(1);
      expect(variants[0].id).toBe("variant-1");
      expect(variants[0].name).toBe("Bronze");
    });

    it("appends multiple variants preserving order", () => {
      const variant1: TextureVariant = {
        id: "variant-1",
        name: "Bronze",
      };
      const variant2: TextureVariant = {
        id: "variant-2",
        name: "Steel",
      };
      const variant3: TextureVariant = {
        id: "variant-3",
        name: "Mithril",
      };

      useVariantStore.getState().addVariant(variant1);
      useVariantStore.getState().addVariant(variant2);
      useVariantStore.getState().addVariant(variant3);

      const variants = useVariantStore.getState().variants;
      expect(variants).toHaveLength(3);
      expect(variants[0].name).toBe("Bronze");
      expect(variants[1].name).toBe("Steel");
      expect(variants[2].name).toBe("Mithril");
    });
  });

  describe("removeVariant", () => {
    it("removes variant by id", () => {
      useVariantStore.getState().addVariant({ id: "v1", name: "Bronze" });
      useVariantStore.getState().addVariant({ id: "v2", name: "Steel" });
      useVariantStore.getState().addVariant({ id: "v3", name: "Mithril" });

      useVariantStore.getState().removeVariant("v2");

      const variants = useVariantStore.getState().variants;
      expect(variants).toHaveLength(2);
      expect(variants[0].id).toBe("v1");
      expect(variants[1].id).toBe("v3");
    });

    it("does nothing when removing non-existent id", () => {
      useVariantStore.getState().addVariant({ id: "v1", name: "Bronze" });

      useVariantStore.getState().removeVariant("non-existent");

      expect(useVariantStore.getState().variants).toHaveLength(1);
    });
  });

  describe("updateVariant", () => {
    it("updates variant properties by id", () => {
      useVariantStore
        .getState()
        .addVariant({ id: "v1", name: "Bronze", prompt: "Old prompt" });

      useVariantStore
        .getState()
        .updateVariant("v1", { prompt: "New enhanced prompt" });

      const variant = useVariantStore.getState().variants[0];
      expect(variant.name).toBe("Bronze");
      expect(variant.prompt).toBe("New enhanced prompt");
    });

    it("preserves unchanged properties", () => {
      useVariantStore.getState().addVariant({
        id: "v1",
        name: "Bronze",
        prompt: "Original prompt",
        materialPresetId: "bronze-1",
      });

      useVariantStore
        .getState()
        .updateVariant("v1", { name: "Updated Bronze" });

      const variant = useVariantStore.getState().variants[0];
      expect(variant.name).toBe("Updated Bronze");
      expect(variant.prompt).toBe("Original prompt");
      expect(variant.materialPresetId).toBe("bronze-1");
    });
  });

  describe("clearVariants", () => {
    it("resets variants array to empty", () => {
      useVariantStore.getState().addVariant({ id: "v1", name: "Bronze" });
      useVariantStore.getState().addVariant({ id: "v2", name: "Steel" });
      useVariantStore.getState().addVariant({ id: "v3", name: "Mithril" });

      expect(useVariantStore.getState().variants).toHaveLength(3);

      useVariantStore.getState().clearVariants();

      expect(useVariantStore.getState().variants).toEqual([]);
    });
  });

  describe("Generated Variants", () => {
    it("addGeneratedVariant adds to generatedVariants array", () => {
      const genVariant = {
        id: "gen-1",
        variantId: "v1",
        name: "Bronze Sword",
        modelUrl: "https://cdn.example.com/bronze-sword.glb",
        thumbnailUrl: "https://cdn.example.com/bronze-sword-thumb.png",
      };

      useVariantStore.getState().addGeneratedVariant(genVariant);

      const generated = useVariantStore.getState().generatedVariants;
      expect(generated).toHaveLength(1);
      expect(generated[0].variantId).toBe("v1");
    });

    it("clearGeneratedVariants resets array", () => {
      useVariantStore.getState().addGeneratedVariant({
        id: "gen-1",
        variantId: "v1",
        name: "Bronze",
        modelUrl: "url1",
      });
      useVariantStore.getState().addGeneratedVariant({
        id: "gen-2",
        variantId: "v2",
        name: "Steel",
        modelUrl: "url2",
      });

      useVariantStore.getState().clearGeneratedVariants();

      expect(useVariantStore.getState().generatedVariants).toEqual([]);
    });
  });

  describe("Generation State", () => {
    it("setIsGenerating updates isGenerating flag", () => {
      expect(useVariantStore.getState().isGenerating).toBe(false);

      useVariantStore.getState().setIsGenerating(true);
      expect(useVariantStore.getState().isGenerating).toBe(true);

      useVariantStore.getState().setIsGenerating(false);
      expect(useVariantStore.getState().isGenerating).toBe(false);
    });

    it("setCurrentVariantIndex updates index", () => {
      useVariantStore.getState().setCurrentVariantIndex(5);
      expect(useVariantStore.getState().currentVariantIndex).toBe(5);

      useVariantStore.getState().setCurrentVariantIndex(0);
      expect(useVariantStore.getState().currentVariantIndex).toBe(0);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", () => {
      // Modify state
      useVariantStore.getState().setBaseModel("model-1", "url", "Model Name");
      useVariantStore.getState().addVariant({ id: "v1", name: "Bronze" });
      useVariantStore.getState().addGeneratedVariant({
        id: "g1",
        variantId: "v1",
        name: "Bronze",
        modelUrl: "url",
      });
      useVariantStore.getState().setIsGenerating(true);
      useVariantStore.getState().setCurrentVariantIndex(3);

      // Reset
      useVariantStore.getState().reset();

      // Verify
      const state = useVariantStore.getState();
      expect(state.baseModelId).toBeNull();
      expect(state.baseModelUrl).toBeNull();
      expect(state.baseModelName).toBeNull();
      expect(state.variants).toEqual([]);
      expect(state.generatedVariants).toEqual([]);
      expect(state.isGenerating).toBe(false);
      expect(state.currentVariantIndex).toBe(0);
    });
  });
});
