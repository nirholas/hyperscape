/**
 * Advanced Edit Options Hook
 *
 * Enables editing of hidden and contextual panels in Edit Mode.
 * This allows users to position interfaces that normally only appear
 * in specific contexts (bank, combat, minigames, etc.)
 *
 * @packageDocumentation
 */

import { useState, useCallback, useMemo } from "react";
import { useWindowStore } from "../../stores/windowStore";
import { useEditStore } from "../../stores/editStore";
import type { Point, Size } from "../../types";

/** Panel visibility condition */
export type PanelCondition =
  | "always"
  | "on_bank"
  | "on_combat"
  | "on_minigame"
  | "on_skilling"
  | "on_dialogue"
  | "custom";

/** Hidden/contextual panel definition */
export interface ContextualPanel {
  id: string;
  name: string;
  icon?: string;
  condition: PanelCondition;
  defaultSize: Size;
  minSize: Size;
  maxSize?: Size;
  description?: string;
}

/** Default contextual panels */
export const CONTEXTUAL_PANELS: ContextualPanel[] = [
  {
    id: "buff_bar",
    name: "Buff Bar",
    icon: "⬆️",
    condition: "always",
    defaultSize: { width: 300, height: 40 },
    minSize: { width: 200, height: 32 },
    description: "Shows active buffs and effects",
  },
  {
    id: "debuff_bar",
    name: "Debuff Bar",
    icon: "⬇️",
    condition: "always",
    defaultSize: { width: 300, height: 40 },
    minSize: { width: 200, height: 32 },
    description: "Shows active debuffs and negative effects",
  },
  {
    id: "xp_popups",
    name: "XP Popups",
    icon: "✨",
    condition: "always",
    defaultSize: { width: 150, height: 100 },
    minSize: { width: 100, height: 60 },
    description: "Experience gain notifications",
  },
  {
    id: "crafting_progress",
    name: "Crafting Progress",
    icon: "🔨",
    condition: "on_skilling",
    defaultSize: { width: 200, height: 60 },
    minSize: { width: 150, height: 48 },
    description: "Shows crafting/skilling progress bar",
  },
  {
    id: "bank_interface",
    name: "Bank Interface",
    icon: "🏦",
    condition: "on_bank",
    defaultSize: { width: 500, height: 400 },
    minSize: { width: 400, height: 300 },
    maxSize: { width: 1200, height: 900 },
    description: "Bank panel layout",
  },
  {
    id: "familiar_interface",
    name: "Familiar Interface",
    icon: "🐾",
    condition: "on_combat",
    defaultSize: { width: 200, height: 150 },
    minSize: { width: 150, height: 100 },
    description: "Summoned familiar controls",
  },
  {
    id: "minigame_hud",
    name: "Minigame HUD",
    icon: "🎮",
    condition: "on_minigame",
    defaultSize: { width: 300, height: 100 },
    minSize: { width: 200, height: 80 },
    description: "Minigame-specific interface",
  },
  {
    id: "dialogue_box",
    name: "Dialogue Box",
    icon: "💬",
    condition: "on_dialogue",
    defaultSize: { width: 400, height: 150 },
    minSize: { width: 300, height: 100 },
    description: "NPC dialogue interface",
  },
  {
    id: "boss_timer",
    name: "Boss Timer",
    icon: "⏱️",
    condition: "on_combat",
    defaultSize: { width: 200, height: 80 },
    minSize: { width: 150, height: 60 },
    description: "Boss phase and mechanic timers",
  },
  {
    id: "loot_beam",
    name: "Loot Notification",
    icon: "💎",
    condition: "always",
    defaultSize: { width: 250, height: 60 },
    minSize: { width: 200, height: 48 },
    description: "Valuable loot drop notifications",
  },
];

/** Advanced edit options state */
export interface AdvancedEditOptionsState {
  /** Whether advanced options are enabled */
  enabled: boolean;
  /** Currently visible contextual panels for editing */
  visiblePanels: string[];
  /** Panel definitions */
  panels: ContextualPanel[];
}

/** Return value from useAdvancedEditOptions */
export interface AdvancedEditOptionsResult {
  /** Whether advanced options are enabled */
  enabled: boolean;
  /** Toggle advanced options on/off */
  toggleAdvancedOptions: () => void;
  /** Enable advanced options */
  enableAdvancedOptions: () => void;
  /** Disable advanced options */
  disableAdvancedOptions: () => void;
  /** Show a contextual panel for editing */
  showPanelForEditing: (panelId: string) => void;
  /** Hide a contextual panel */
  hidePanelFromEditing: (panelId: string) => void;
  /** Get all available contextual panels */
  availablePanels: ContextualPanel[];
  /** Get panels currently visible for editing */
  visiblePanels: ContextualPanel[];
  /** Check if a panel is visible for editing */
  isPanelVisible: (panelId: string) => boolean;
  /** Show all contextual panels for editing */
  showAllPanels: () => void;
  /** Hide all contextual panels */
  hideAllPanels: () => void;
}

/**
 * Hook for managing advanced edit options
 *
 * Allows editing of hidden and contextual panels that normally
 * only appear in specific game contexts.
 *
 * @example
 * ```tsx
 * function EditModeToolbar() {
 *   const { mode } = useEditMode();
 *   const {
 *     enabled,
 *     toggleAdvancedOptions,
 *     availablePanels,
 *     showPanelForEditing,
 *   } = useAdvancedEditOptions();
 *
 *   if (mode !== 'unlocked') return null;
 *
 *   return (
 *     <div>
 *       <button onClick={toggleAdvancedOptions}>
 *         {enabled ? 'Hide Advanced' : 'Show Advanced'}
 *       </button>
 *       {enabled && availablePanels.map(panel => (
 *         <button key={panel.id} onClick={() => showPanelForEditing(panel.id)}>
 *           {panel.icon} {panel.name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAdvancedEditOptions(
  customPanels?: ContextualPanel[],
): AdvancedEditOptionsResult {
  const mode = useEditStore((s) => s.mode);
  const createWindow = useWindowStore((s) => s.createWindow);
  const destroyWindow = useWindowStore((s) => s.destroyWindow);
  const getAllWindows = useWindowStore((s) => s.getAllWindows);

  const [enabled, setEnabled] = useState(false);
  const [visiblePanelIds, setVisiblePanelIds] = useState<Set<string>>(
    new Set(),
  );

  // Combine default and custom panels
  const allPanels = useMemo(() => {
    return customPanels
      ? [...CONTEXTUAL_PANELS, ...customPanels]
      : CONTEXTUAL_PANELS;
  }, [customPanels]);

  const toggleAdvancedOptions = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  const enableAdvancedOptions = useCallback(() => {
    setEnabled(true);
  }, []);

  const disableAdvancedOptions = useCallback(() => {
    setEnabled(false);
    // Hide all panels when disabling
    visiblePanelIds.forEach((panelId) => {
      const windowId = `contextual-${panelId}`;
      destroyWindow(windowId);
    });
    setVisiblePanelIds(new Set());
  }, [visiblePanelIds, destroyWindow]);

  const showPanelForEditing = useCallback(
    (panelId: string) => {
      if (mode !== "unlocked") return;

      const panel = allPanels.find((p) => p.id === panelId);
      if (!panel) return;

      const windowId = `contextual-${panelId}`;

      // Check if already exists
      const existingWindows = getAllWindows();
      if (existingWindows.some((w) => w.id === windowId)) {
        return;
      }

      // Calculate position (cascade from top-left)
      const existingCount = visiblePanelIds.size;
      const position: Point = {
        x: 100 + existingCount * 30,
        y: 100 + existingCount * 30,
      };

      // Create window for the panel
      createWindow({
        id: windowId,
        position,
        size: panel.defaultSize,
        tabs: [
          {
            id: `tab-${panelId}`,
            label: panel.name,
            content: panel.id, // panelId as content
            closeable: true,
          },
        ],
        transparency: 50, // Semi-transparent for editing visibility
        minSize: panel.minSize,
        maxSize: panel.maxSize,
      });

      setVisiblePanelIds((prev) => new Set([...prev, panelId]));
    },
    [mode, allPanels, getAllWindows, createWindow, visiblePanelIds.size],
  );

  const hidePanelFromEditing = useCallback(
    (panelId: string) => {
      const windowId = `contextual-${panelId}`;
      destroyWindow(windowId);
      setVisiblePanelIds((prev) => {
        const next = new Set(prev);
        next.delete(panelId);
        return next;
      });
    },
    [destroyWindow],
  );

  const isPanelVisible = useCallback(
    (panelId: string) => {
      return visiblePanelIds.has(panelId);
    },
    [visiblePanelIds],
  );

  const showAllPanels = useCallback(() => {
    allPanels.forEach((panel) => {
      showPanelForEditing(panel.id);
    });
  }, [allPanels, showPanelForEditing]);

  const hideAllPanels = useCallback(() => {
    visiblePanelIds.forEach((panelId) => {
      hidePanelFromEditing(panelId);
    });
  }, [visiblePanelIds, hidePanelFromEditing]);

  const visiblePanels = useMemo(() => {
    return allPanels.filter((p) => visiblePanelIds.has(p.id));
  }, [allPanels, visiblePanelIds]);

  return {
    enabled,
    toggleAdvancedOptions,
    enableAdvancedOptions,
    disableAdvancedOptions,
    showPanelForEditing,
    hidePanelFromEditing,
    availablePanels: allPanels,
    visiblePanels,
    isPanelVisible,
    showAllPanels,
    hideAllPanels,
  };
}
