/**
 * UI Types
 *
 * Type definitions for UI-specific data structures used across the game interface.
 *
 * @packageDocumentation
 */

/** Inventory slot view item - simplified for UI rendering */
export type InventorySlotViewItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

/** Status value for HP/Prayer/Stamina displays */
export interface StatusValue {
  current?: number;
  max?: number;
}

/** Panel state for tracking open/closed panels */
export interface PanelState {
  isOpen: boolean;
  data?: unknown;
}
