/**
 * ContextMenuController
 *
 * Handles context menu display and selection.
 *
 * Uses DOM CustomEvents to communicate with React UI:
 * - Dispatches "contextmenu" event with menu items
 * - Listens for "contextmenu:select" event for selection
 * - Dispatches "contextmenu:close" to close menu
 *
 * This pattern must be maintained for compatibility with
 * the existing ContextMenu React component.
 */

import type { RaycastTarget, ContextMenuAction } from "./types";

export class ContextMenuController {
  private currentTargetId: string | null = null;
  private currentActions: ContextMenuAction[] = [];
  private selectHandler: ((e: Event) => void) | null = null;

  /**
   * Show context menu for a target (or terrain if target is null)
   */
  showMenu(
    target: RaycastTarget | null,
    actions: ContextMenuAction[],
    screenX: number,
    screenY: number,
  ): void {
    if (actions.length === 0) {
      if (target) {
        console.warn(
          "[ContextMenuController] No actions available for",
          target.entityType,
        );
      }
      return;
    }

    // For terrain clicks, use synthetic values
    const targetId = target?.entityId ?? "terrain";
    const targetType = target?.entityType ?? "terrain";
    const targetName = target?.name ?? "";

    this.currentTargetId = targetId;
    this.currentActions = actions;

    // Dispatch contextmenu event for React component
    // NOTE: This is a CustomEvent named "contextmenu" - not the native MouseEvent
    // EntityContextMenu.tsx listens for this on window
    const evt = new CustomEvent("contextmenu", {
      detail: {
        target: {
          id: targetId,
          type: targetType,
          name: targetName,
          position: target?.position ?? null,
        },
        mousePosition: { x: screenX, y: screenY },
        items: actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: action.icon,
          styledLabel: action.styledLabel,
          enabled: action.enabled,
        })),
      },
    });
    window.dispatchEvent(evt);

    // Listen for selection
    this.cleanupSelectHandler();
    this.selectHandler = this.onMenuSelect.bind(this);
    window.addEventListener("contextmenu:select", this.selectHandler, {
      once: true,
    });
  }

  /**
   * Close the context menu
   */
  closeMenu(): void {
    window.dispatchEvent(new CustomEvent("contextmenu:close"));
    this.cleanupSelectHandler();
    this.currentTargetId = null;
    this.currentActions = [];
  }

  /**
   * Handle menu selection
   */
  private onMenuSelect(e: Event): void {
    const ce = e as CustomEvent<{ actionId: string; targetId: string }>;

    if (!ce?.detail || ce.detail.targetId !== this.currentTargetId) {
      return;
    }

    const action = this.currentActions.find((a) => a.id === ce.detail.actionId);
    if (action && action.enabled) {
      action.handler();
    }

    this.currentTargetId = null;
    this.currentActions = [];
  }

  /**
   * Clean up select handler
   */
  private cleanupSelectHandler(): void {
    if (this.selectHandler) {
      window.removeEventListener("contextmenu:select", this.selectHandler);
      this.selectHandler = null;
    }
  }

  /**
   * Destroy - clean up
   */
  destroy(): void {
    this.closeMenu();
    this.cleanupSelectHandler();
  }
}
