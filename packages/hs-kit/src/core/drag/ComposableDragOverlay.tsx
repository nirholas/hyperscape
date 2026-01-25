/**
 * Composable Drag Overlay
 *
 * A flexible DragOverlay component that can render custom content
 * during drag operations. This is the hs-kit equivalent of @dnd-kit's DragOverlay.
 *
 * @packageDocumentation
 */

import React, { type ReactNode, type CSSProperties } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DragItem, Point, Modifier, ModifierContext } from "../../types";

/** Props for ComposableDragOverlay */
export interface ComposableDragOverlayProps {
  /**
   * Children to render during drag.
   * Can be a function that receives drag state for custom rendering.
   */
  children?:
    | ReactNode
    | ((state: { item: DragItem; position: Point; delta: Point }) => ReactNode);

  /**
   * Custom style for the overlay container
   */
  style?: CSSProperties;

  /**
   * Modifiers to apply to the overlay position
   * @example [snapCenterToCursor, restrictToWindow()]
   */
  modifiers?: Modifier[];

  /**
   * Drop animation configuration (null to disable)
   * @default null (no animation, immediate)
   */
  dropAnimation?: {
    duration: number;
    easing: string;
  } | null;

  /**
   * Z-index for the overlay
   * @default 9999
   */
  zIndex?: number;

  /**
   * Adjusts for pointer position within the dragged element.
   * When true, overlay appears where the cursor is.
   * When false, overlay appears at element center offset by delta.
   * @default true
   */
  adjustToPointer?: boolean;
}

/**
 * Composable drag overlay that renders custom content during drag
 *
 * @example
 * ```tsx
 * // Simple usage with children function
 * <ComposableDragOverlay>
 *   {({ item }) => (
 *     <div className="drag-preview">
 *       <ItemIcon itemId={item.data.itemId} />
 *     </div>
 *   )}
 * </ComposableDragOverlay>
 *
 * // With modifiers
 * <ComposableDragOverlay modifiers={[snapCenterToCursor]}>
 *   {({ item }) => <ItemPreview item={item} />}
 * </ComposableDragOverlay>
 * ```
 */
export function ComposableDragOverlay({
  children,
  style,
  modifiers,
  dropAnimation: _dropAnimation = null,
  zIndex = 9999,
  adjustToPointer = true,
}: ComposableDragOverlayProps): React.ReactElement | null {
  const isDragging = useDragStore((s) => s.isDragging);
  const item = useDragStore((s) => s.item);
  const current = useDragStore((s) => s.current);
  const origin = useDragStore((s) => s.origin);
  const delta = useDragStore((s) => s.delta);

  if (!isDragging || !item) {
    return null;
  }

  // Calculate position - either at cursor or offset from origin
  let position: Point = adjustToPointer
    ? current
    : { x: origin.x + delta.x, y: origin.y + delta.y };

  // Apply modifiers if provided
  if (modifiers && modifiers.length > 0) {
    const context: ModifierContext = {
      active: { id: item.id, rect: null },
      containerRect: null,
      draggingNodeRect: null,
      scrollableAncestors: [],
      windowRect: {
        x: 0,
        y: 0,
        width: typeof window !== "undefined" ? window.innerWidth : 1920,
        height: typeof window !== "undefined" ? window.innerHeight : 1080,
      },
    };

    for (const modifier of modifiers) {
      const result = modifier(position, context);
      position = result;
    }
  }

  const overlayStyle: CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    transform: adjustToPointer ? "translate(-50%, -50%)" : "translate(0, 0)",
    pointerEvents: "none",
    zIndex,
    ...style,
  };

  // Render children
  const content =
    typeof children === "function"
      ? children({ item, position, delta })
      : children;

  // If no children, render nothing (user must provide custom overlay)
  if (!content) {
    return null;
  }

  return <div style={overlayStyle}>{content}</div>;
}

/**
 * Snap center to cursor modifier
 *
 * This modifier adjusts the overlay position so that
 * the element's center aligns with the cursor position.
 * Useful when dragging items that should appear centered under cursor.
 */
export function snapCenterToCursor(
  position: Point,
  context: ModifierContext,
): Point {
  // If we have dragging node rect, offset to center on cursor
  if (context.draggingNodeRect) {
    const rect = context.draggingNodeRect;
    return {
      x: position.x - rect.width / 2,
      y: position.y - rect.height / 2,
    };
  }
  return position;
}
