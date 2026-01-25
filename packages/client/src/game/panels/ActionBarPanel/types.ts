/**
 * ActionBarPanel - Type definitions
 */

import type { ClientWorld } from "../../../types";

/** Action bar slot content - can be an item, skill, spell, or prayer */
export interface ActionBarSlotContent {
  type: "item" | "skill" | "spell" | "prayer" | "empty";
  id: string;
  itemId?: string;
  skillId?: string;
  spellId?: string;
  prayerId?: string;
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
}

/** Drop target data */
export interface DropTargetData {
  slotIndex?: number;
  target?: string;
}
