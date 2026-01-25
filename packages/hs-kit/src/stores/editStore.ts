import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EditMode, AlignmentGuide } from "../types";

/** Storage key for edit mode settings */
const STORAGE_KEY = "hs-kit-edit-settings";

/** Edit store state and actions */
export interface EditStoreState {
  /** Current mode (locked or unlocked) */
  mode: EditMode;
  /** Grid size in pixels */
  gridSize: number;
  /** Whether snap to grid is enabled */
  snapEnabled: boolean;
  /** Whether to show grid overlay */
  showGrid: boolean;
  /** Whether to show alignment guides */
  showGuides: boolean;
  /** Whether to restrict windows to viewport edges (always enabled by default) */
  restrictToViewport: boolean;
  /** Minimum pixels of window that must remain visible when near edge */
  viewportEdgeMargin: number;

  // Hold-to-toggle settings
  /** Whether to require holding the key to toggle (vs instant toggle) */
  holdToToggle: boolean;
  /** Duration in ms to hold the key before toggling (only applies if holdToToggle is true) */
  holdDuration: number;
  /** The key used to toggle edit mode */
  toggleKey: string;

  // Resize tracking state
  /** Whether a window is currently being resized */
  isResizing: boolean;
  /** The ID of the window currently being resized */
  resizingWindowId: string | null;

  // Alignment guide state (ephemeral, not persisted)
  /** Currently active alignment guides to display */
  activeGuides: AlignmentGuide[];
  /** The ID of the window currently being dragged */
  draggingWindowId: string | null;

  /** Toggle between locked and unlocked mode */
  toggleMode: () => void;
  /** Set specific mode */
  setMode: (mode: EditMode) => void;
  /** Set grid size */
  setGridSize: (size: number) => void;
  /** Set snap enabled */
  setSnapEnabled: (enabled: boolean) => void;
  /** Set show grid */
  setShowGrid: (show: boolean) => void;
  /** Set show guides */
  setShowGuides: (show: boolean) => void;
  /** Set restrict to viewport */
  setRestrictToViewport: (enabled: boolean) => void;
  /** Set viewport edge margin */
  setViewportEdgeMargin: (margin: number) => void;
  /** Set hold to toggle */
  setHoldToToggle: (enabled: boolean) => void;
  /** Set hold duration */
  setHoldDuration: (duration: number) => void;
  /** Set toggle key */
  setToggleKey: (key: string) => void;
  /** Start resizing a window */
  startResize: (windowId: string) => void;
  /** End resizing */
  endResize: () => void;
  /** Set active alignment guides */
  setActiveGuides: (guides: AlignmentGuide[]) => void;
  /** Set the currently dragging window ID */
  setDraggingWindowId: (windowId: string | null) => void;
  /** Clear all active guides */
  clearGuides: () => void;
}

/**
 * Zustand store for edit mode state
 *
 * Uses persist middleware to save settings to localStorage.
 * Note: mode is intentionally NOT persisted - always starts locked for safety.
 */
export const useEditStore = create<EditStoreState>()(
  persist(
    (set) => ({
      mode: "locked",
      gridSize: 8,
      snapEnabled: true,
      showGrid: true,
      showGuides: true,
      restrictToViewport: true, // Always restrict to viewport by default
      viewportEdgeMargin: 40, // At least 40px must remain visible
      holdToToggle: true, // Require holding key by default
      holdDuration: 1000, // 1 second by default
      toggleKey: "l", // L key by default
      isResizing: false,
      resizingWindowId: null,
      activeGuides: [],
      draggingWindowId: null,

      toggleMode: () => {
        set((state) => ({
          mode: state.mode === "locked" ? "unlocked" : "locked",
        }));
      },

      setMode: (mode: EditMode) => {
        set({ mode });
      },

      setGridSize: (gridSize: number) => {
        set({ gridSize: Math.max(1, gridSize) });
      },

      setSnapEnabled: (snapEnabled: boolean) => {
        set({ snapEnabled });
      },

      setShowGrid: (showGrid: boolean) => {
        set({ showGrid });
      },

      setShowGuides: (showGuides: boolean) => {
        set({ showGuides });
      },

      setRestrictToViewport: (restrictToViewport: boolean) => {
        set({ restrictToViewport });
      },

      setViewportEdgeMargin: (viewportEdgeMargin: number) => {
        set({ viewportEdgeMargin: Math.max(0, viewportEdgeMargin) });
      },

      setHoldToToggle: (holdToToggle: boolean) => {
        set({ holdToToggle });
      },

      setHoldDuration: (holdDuration: number) => {
        set({ holdDuration: Math.max(100, holdDuration) }); // Minimum 100ms
      },

      setToggleKey: (toggleKey: string) => {
        set({ toggleKey: toggleKey.toLowerCase() });
      },

      startResize: (windowId: string) => {
        set({ isResizing: true, resizingWindowId: windowId });
      },

      endResize: () => {
        set({ isResizing: false, resizingWindowId: null });
      },

      setActiveGuides: (activeGuides: AlignmentGuide[]) => {
        set({ activeGuides });
      },

      setDraggingWindowId: (draggingWindowId: string | null) => {
        set({ draggingWindowId });
        // Clear guides when drag ends
        if (!draggingWindowId) {
          set({ activeGuides: [] });
        }
      },

      clearGuides: () => {
        set({ activeGuides: [], draggingWindowId: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1, // Increment when changing defaults
      storage: createJSONStorage(() => localStorage),
      // Don't persist mode - always start locked for safety
      partialize: (state) => ({
        gridSize: state.gridSize,
        snapEnabled: state.snapEnabled,
        showGrid: state.showGrid,
        showGuides: state.showGuides,
        restrictToViewport: state.restrictToViewport,
        viewportEdgeMargin: state.viewportEdgeMargin,
        holdToToggle: state.holdToToggle,
        holdDuration: state.holdDuration,
        toggleKey: state.toggleKey,
      }),
      // Migrate old settings to new defaults
      migrate: (persistedState, version) => {
        const state = persistedState as Record<string, unknown>;
        if (version === 0) {
          // Migrate from old 2000ms default to new 1000ms default
          if (state.holdDuration === 2000) {
            state.holdDuration = 1000;
          }
        }
        return state as typeof persistedState;
      },
    },
  ),
);
