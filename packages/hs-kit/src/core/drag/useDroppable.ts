/**
 * useDroppable Hook
 *
 * A hook with @dnd-kit compatible API for making elements droppable.
 * This is the hs-kit equivalent of @dnd-kit's useDroppable.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useEffect } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { Rect } from "../../types";
import { dropTargetRegistry } from "./utils";

/** Configuration for useDroppable */
export interface UseDroppableConfig {
  /** Unique identifier for this droppable */
  id: string;

  /** Data to attach to this drop target */
  data?: Record<string, unknown>;

  /** Whether dropping is disabled */
  disabled?: boolean;
}

/** Return value from useDroppable */
export interface UseDroppableReturn {
  /** Whether a draggable is currently over this droppable */
  isOver: boolean;

  /** Ref callback to set on the droppable element */
  setNodeRef: (node: HTMLElement | null) => void;

  /** The droppable element's bounding rect */
  rect: Rect | null;

  /** The node ref */
  node: { current: HTMLElement | null };

  /** Active draggable info if dragging */
  active: { id: string; data: Record<string, unknown> } | null;

  /** Over target info (for compatibility with @dnd-kit patterns) */
  over: { id: string } | null;
}

/**
 * Make an element a drop target
 *
 * @example
 * ```tsx
 * function DropSlot({ id, index }: { id: string; index: number }) {
 *   const { setNodeRef, isOver, active } = useDroppable({
 *     id,
 *     data: { index },
 *   });
 *
 *   return (
 *     <div
 *       ref={setNodeRef}
 *       style={{
 *         backgroundColor: isOver ? 'rgba(0, 255, 0, 0.2)' : 'transparent',
 *         border: active ? '2px dashed #999' : '1px solid #333',
 *       }}
 *     >
 *       Drop here
 *     </div>
 *   );
 * }
 * ```
 */
export function useDroppable(config: UseDroppableConfig): UseDroppableReturn {
  const { id, data = {}, disabled = false } = config;

  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);

  const nodeRef = useRef<HTMLElement | null>(null);
  const rectRef = useRef<Rect | null>(null);

  // Check if drag is over this droppable
  const isOver = overTargets.includes(id);

  // Set node ref and register with drop target registry
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;

      if (node && !disabled) {
        // Get bounding rect
        const domRect = node.getBoundingClientRect();
        rectRef.current = {
          x: domRect.left,
          y: domRect.top,
          width: domRect.width,
          height: domRect.height,
        };

        // Register with drop target registry
        dropTargetRegistry.register(id, {
          element: node,
          rect: rectRef.current,
          accepts: ["item", "tab", "window"], // Accept all types by default
          data,
        });
      } else {
        dropTargetRegistry.unregister(id);
        rectRef.current = null;
      }
    },
    [id, data, disabled],
  );

  // Unregister on unmount
  useEffect(() => {
    return () => {
      dropTargetRegistry.unregister(id);
    };
  }, [id]);

  // Update rect when element resizes or scrolls
  useEffect(() => {
    if (!nodeRef.current || disabled) return;

    const updateRect = () => {
      if (nodeRef.current) {
        const domRect = nodeRef.current.getBoundingClientRect();
        rectRef.current = {
          x: domRect.left,
          y: domRect.top,
          width: domRect.width,
          height: domRect.height,
        };

        // Update registry
        dropTargetRegistry.register(id, {
          element: nodeRef.current,
          rect: rectRef.current,
          accepts: ["item", "tab", "window"],
          data,
        });
      }
    };

    // Update on scroll and resize
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);

    // Initial update
    updateRect();

    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [id, data, disabled]);

  // Compute active state
  const active =
    isDragging && dragItem
      ? { id: dragItem.id, data: dragItem.data as Record<string, unknown> }
      : null;

  // Compute over state
  const over = isOver ? { id } : null;

  return {
    isOver,
    setNodeRef,
    rect: rectRef.current,
    node: nodeRef,
    active,
    over,
  };
}
