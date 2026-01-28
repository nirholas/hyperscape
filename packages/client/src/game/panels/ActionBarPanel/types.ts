/**
 * ActionBarPanel - Type definitions
 */

import type { ClientWorld } from "../../../types";

// ============================================================================
// Event Payload Types (for proper type safety instead of unknown)
// ============================================================================

/** Payload for prayer state sync events */
export interface PrayerStateSyncEventPayload {
  playerId: string;
  active: string[];
}

/** Payload for prayer toggled events */
export interface PrayerToggledEventPayload {
  playerId: string;
  prayerId: string;
  active: boolean;
}

/** Payload for attack style update events */
export interface AttackStyleUpdateEventPayload {
  playerId: string;
  style: string;
}

/** Payload for attack style changed events */
export interface AttackStyleChangedEventPayload {
  playerId: string;
  newStyle: string;
}

/** Payload for action bar state from server */
export interface ActionBarStatePayload {
  barId: number;
  slotCount: number;
  slots: ActionBarSlotContent[];
}

/** Payload for action bar slot swap events */
export interface ActionBarSlotSwapPayload {
  barId: number;
  fromIndex: number;
  toIndex: number;
}

/** Extended network interface with attack style cache */
export interface ActionBarNetworkExtensions {
  lastAttackStyleByPlayerId?: Record<string, string>;
}

// ============================================================================
// Core Types
// ============================================================================

/** Action bar slot content - can be an item, skill, spell, prayer, or combat style */
export interface ActionBarSlotContent {
  type: "item" | "skill" | "spell" | "prayer" | "combatstyle" | "empty";
  id: string;
  itemId?: string;
  skillId?: string;
  spellId?: string;
  prayerId?: string;
  combatStyleId?: string;
  quantity?: number;
  icon?: string;
  label?: string;
}

export interface ActionBarPanelProps {
  world: ClientWorld;
  barId?: number; // 0-4 for multiple action bars
  /** Whether edit mode is unlocked (shows +/- controls) */
  isEditMode?: boolean;
  /** Window ID for dynamic minSize updates */
  windowId?: string;
  /** When true, uses parent DndProvider context (for cross-panel drag-drop) */
  useParentDndContext?: boolean;
  /** Layout orientation - horizontal (default) or vertical */
  orientation?: "horizontal" | "vertical";
  /** Whether to show keyboard shortcuts on slots (default: true) */
  showShortcuts?: boolean;
  /** Whether to show control buttons (+/-, lock) (default: true) */
  showControls?: boolean;
}

/** Payload for action bar slot update events */
export interface ActionBarSlotUpdatePayload {
  barId: number;
  slotIndex: number;
  slot: ActionBarSlotContent;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  styledLabel: Array<{ text: string; color?: string }>;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  targetSlot: ActionBarSlotContent | null;
  targetIndex: number;
}

/** Drag data from inventory */
export interface InventoryDragData {
  slot?: ActionBarSlotContent;
  slotIndex?: number;
  source?: string;
  item?: {
    itemId: string;
    quantity: number;
    slot: number;
  };
  prayer?: {
    id: string;
    name: string;
    icon: string;
    level: number;
  };
  skill?: {
    id: string;
    name: string;
    icon: string;
    level: number;
  };
  combatStyle?: {
    id: string;
    label: string;
    color: string;
  };
}

/** Drop target data */
export interface DropTargetData {
  slotIndex?: number;
  target?: string;
}
