/**
 * useContextMenuState Hook
 *
 * Tracks context menu open/close state and provides tooltip suppression.
 * Used by panels that show hover tooltips (EquipmentPanel, InventoryPanel)
 * to suppress tooltips while context menus are visible.
 *
 * @packageDocumentation
 */

import { useState, useEffect } from "react";

/**
 * Context menu state result
 */
export interface ContextMenuStateResult {
  /** Whether a context menu is currently open */
  isContextMenuOpen: boolean;
  /** Manually set the context menu open state (for when opening a menu) */
  setContextMenuOpen: (open: boolean) => void;
}

/**
 * Hook for tracking context menu state and suppressing hover tooltips.
 *
 * Listens to window events:
 * - `contextmenu:close` - Fired when context menu is closed
 * - `contextmenu:select` - Fired when a context menu item is selected
 *
 * @returns Context menu state and setter
 *
 * @example
 * ```tsx
 * const { isContextMenuOpen, setContextMenuOpen } = useContextMenuState();
 *
 * // Suppress hover tooltip when context menu is open
 * const handleHover = (item, position) => {
 *   if (isContextMenuOpen) return;
 *   setHoverState({ item, position });
 * };
 *
 * // Open context menu
 * const handleContextMenu = (e) => {
 *   e.preventDefault();
 *   setContextMenuOpen(true);
 *   // ... show context menu
 * };
 * ```
 */
export function useContextMenuState(): ContextMenuStateResult {
  const [isContextMenuOpen, setContextMenuOpen] = useState(false);

  useEffect(() => {
    const handleContextMenuClose = () => {
      setContextMenuOpen(false);
    };

    window.addEventListener("contextmenu:close", handleContextMenuClose);
    window.addEventListener("contextmenu:select", handleContextMenuClose);

    return () => {
      window.removeEventListener("contextmenu:close", handleContextMenuClose);
      window.removeEventListener("contextmenu:select", handleContextMenuClose);
    };
  }, []);

  return { isContextMenuOpen, setContextMenuOpen };
}
