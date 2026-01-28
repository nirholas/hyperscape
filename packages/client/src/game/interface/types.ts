/**
 * Interface-specific Types
 *
 * Types used by InterfaceManager and its sub-components.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import type { WindowState } from "@/ui";
import type { ClientWorld } from "../../types";

// Re-export modal types from hooks for convenience
export type {
  BankData,
  BankItem,
  BankTab,
  StoreData,
  StoreItem,
  DialogueData,
  DialogueResponse,
  SmeltingData,
  SmeltingBar,
  SmithingData,
  SmithingRecipe,
  LootWindowData,
  QuestStartData,
  QuestCompleteData,
  XpLampData,
} from "@/hooks";

/** Panel ID to icon mapping for tab display */
export const PANEL_ICONS: Record<string, string> = {
  minimap: "🗺️",
  inventory: "🎒",
  equipment: "🎽",
  stats: "📊",
  skills: "⭐",
  prayer: "✨",
  combat: "🗡️",
  settings: "⚙️",
  bank: "🏦",
  quests: "📜",
  map: "🗺️",
  chat: "💬",
  friends: "👥",
  presets: "📐",
  dashboard: "📈",
  action: "⚡",
  "actionbar-0": "⚡",
  "actionbar-1": "⚡",
  "actionbar-2": "⚡",
  "actionbar-3": "⚡",
  "actionbar-4": "⚡",
};

/** Get icon for a panel ID */
export function getPanelIcon(panelId: string): string {
  return PANEL_ICONS[panelId] || "📋";
}

/** Max number of action bars allowed */
export const MAX_ACTION_BARS = 5;

/** TabBar height (TabBar component minHeight: 28) */
export const TAB_BAR_HEIGHT = 28;

// Re-export grid utilities from consolidated location
export {
  DEFAULT_GRID_SIZE,
  snapToGrid,
  clampAndSnapPosition as clampPosition,
} from "@/utils";

/** InterfaceManager Props */
export interface InterfaceManagerProps {
  /** The game world instance */
  world: ClientWorld;
  /** Children to render (typically game viewport) */
  children?: ReactNode;
  /** Whether the interface is enabled */
  enabled?: boolean;
}

/** Panel renderer function type */
export type PanelRenderer = (
  panelId: string,
  world?: ClientWorld,
  windowId?: string,
) => ReactNode;

/** Drag handle props passed to draggable components */
export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  style: React.CSSProperties;
}

/** Window content renderer props */
export interface WindowContentProps {
  activeTabIndex: number;
  tabs: WindowState["tabs"];
  renderPanel: PanelRenderer;
  windowId?: string;
  isUnlocked?: boolean;
}

/** Draggable content wrapper props */
export interface DraggableContentWrapperProps extends WindowContentProps {
  windowId: string;
  dragHandleProps?: DragHandleProps;
  isUnlocked?: boolean;
}

/** Action bar wrapper props */
export interface ActionBarWrapperProps extends WindowContentProps {
  dragHandleProps?: DragHandleProps;
  isUnlocked?: boolean;
}

/** Menu bar wrapper props */
export interface MenuBarWrapperProps extends WindowContentProps {
  dragHandleProps?: DragHandleProps;
  isUnlocked?: boolean;
}

/** Minimap wrapper props */
export interface MinimapWrapperProps {
  world: ClientWorld | null;
  dragHandleProps?: DragHandleProps;
  isUnlocked?: boolean;
}

/** Interface UI state for simple modal toggles */
export interface InterfaceUIState {
  /** World map fullscreen overlay open */
  worldMapOpen: boolean;
  /** Stats modal open */
  statsModalOpen: boolean;
  /** Items kept on death modal open */
  deathModalOpen: boolean;
}

/** Interface UI state setters */
export interface InterfaceUIStateSetters {
  setWorldMapOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeathModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}
