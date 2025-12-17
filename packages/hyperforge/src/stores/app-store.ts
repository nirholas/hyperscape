"use client";

import { create } from "zustand";
import type { AssetData } from "@/types/asset";

export type ModuleView =
  | "library"
  | "character-equipment"
  | "armor-fitting"
  | "hand-rigging"
  | "retargeting"
  | "audio-studio";

export type ViewportPanelType =
  | "none"
  | "generation"
  | "properties"
  | "enhancement"
  | "character-equipment"
  | "armor-fitting"
  | "hand-rigging"
  | "retargeting"
  | "audio-studio";

interface AppState {
  // Current module/view
  activeModule: ModuleView;
  setActiveModule: (module: ModuleView) => void;

  // Selected asset
  selectedAsset: AssetData | null;
  setSelectedAsset: (asset: AssetData | null) => void;

  // Sidebar collapse state
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Vault sidebar
  vaultOpen: boolean;
  setVaultOpen: (open: boolean) => void;
  toggleVault: () => void;

  // Viewport panel (replaces properties panel - now inside viewport)
  viewportPanel: ViewportPanelType;
  setViewportPanel: (panel: ViewportPanelType) => void;
  closeViewportPanel: () => void;

  // Legacy aliases for compatibility
  propertiesPanelOpen: boolean;
  openPropertiesPanel: () => void;
  closePropertiesPanel: () => void;
}

export const useAppStore = create<AppState>((set, _get) => ({
  // Module state
  activeModule: "library",
  setActiveModule: (module) => {
    // Map module to its corresponding viewport panel
    const moduleToPanelMap: Record<ModuleView, ViewportPanelType> = {
      library: "none", // Library uses properties panel when asset selected
      "character-equipment": "character-equipment",
      "armor-fitting": "armor-fitting",
      "hand-rigging": "hand-rigging",
      retargeting: "retargeting",
      "audio-studio": "audio-studio",
    };

    const panel = moduleToPanelMap[module];
    set({
      activeModule: module,
      viewportPanel: panel,
      // Close properties panel when switching modules - module-specific panels take over
      // Properties panel is only opened via setSelectedAsset(), not module switching
      propertiesPanelOpen: false,
    });
  },

  // Selected asset
  selectedAsset: null,
  setSelectedAsset: (asset) =>
    set({
      selectedAsset: asset,
      // Show properties panel when selecting asset
      viewportPanel: asset !== null ? "properties" : "none",
      propertiesPanelOpen: asset !== null,
    }),

  // Sidebar collapse
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // Vault
  vaultOpen: true,
  setVaultOpen: (open) => set({ vaultOpen: open }),
  toggleVault: () => set((state) => ({ vaultOpen: !state.vaultOpen })),

  // Viewport panel
  viewportPanel: "none", // Default to no panel - generation is now a separate page
  setViewportPanel: (panel) =>
    set({
      viewportPanel: panel,
      propertiesPanelOpen: panel === "properties",
    }),
  closeViewportPanel: () =>
    set({
      viewportPanel: "none",
      propertiesPanelOpen: false,
    }),

  // Legacy compatibility - stored as regular state, updated when viewportPanel changes
  propertiesPanelOpen: false,
  openPropertiesPanel: () =>
    set({
      viewportPanel: "properties",
      propertiesPanelOpen: true,
    }),
  closePropertiesPanel: () =>
    set({
      viewportPanel: "none",
      propertiesPanelOpen: false,
    }),
}));
