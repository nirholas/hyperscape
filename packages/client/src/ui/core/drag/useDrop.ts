import { useCallback, useRef, useEffect, useState } from "react";
import { useDragStore } from "../../stores/dragStore";
import type {
  DropConfig,
  DropResult,
  DragItem,
  Point,
  Rect,
} from "../../types";
import { dropTargetRegistry, getElementRect } from "./utils";

/**
 * Hook to make an element a drop target
 *
 * @example
 * ```tsx
 * function DropZone({ id }: { id: string }) {
 *   const { isOver, canDrop, dropProps } = useDrop({
 *     id,
 *     accepts: ['window', 'tab'],
 *     onDrop: (item, position) => {
 *       console.log('Dropped', item, 'at', position);
 *     },
 *   });
 *
 *   return (
 *     <div
 *       {...dropProps}
 *       style={{
 *         backgroundColor: isOver && canDrop ? 'green' : 'gray',
 *       }}
 *     >
 *       Drop here
 *     </div>
 *   );
 * }
 * ```
 */
export function useDrop(config: DropConfig): DropResult {
  const {
    id,
    accepts,
    onDrop,
    onDragEnter,
    onDragLeave,
    onDragOver,
    disabled,
  } = config;

  const elementRef = useRef<HTMLElement | null>(null);
  const [dropRect, setDropRect] = useState<Rect | null>(null);

  // Get drag state from store
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);
  const currentPosition = useDragStore((s) => s.current);

  // Check if this target is being hovered
  const isOver = overTargets.includes(id);

  // Check if the current drag item is compatible
  const canDrop =
    !disabled && dragItem !== null && accepts.includes(dragItem.type);

  // Calculate relative position within the drop target
  const relativePosition: Point | null =
    isOver && dropRect
      ? {
          x: currentPosition.x - dropRect.x,
          y: currentPosition.y - dropRect.y,
        }
      : null;

  // Ref callback to register/unregister the drop target
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      elementRef.current = node;

      if (node && !disabled) {
        const rect = getElementRect(node);
        setDropRect(rect);
        dropTargetRegistry.register(id, {
          element: node,
          accepts,
          rect,
        });
      } else {
        dropTargetRegistry.unregister(id);
        setDropRect(null);
      }
    },
    [id, accepts, disabled],
  );

  // Update rect on resize
  useEffect(() => {
    if (!elementRef.current || disabled) return;

    const observer = new ResizeObserver(() => {
      if (elementRef.current) {
        const rect = getElementRect(elementRef.current);
        setDropRect(rect);
        dropTargetRegistry.updateRect(id, rect);
      }
    });

    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [id, disabled]);

  // Track enter/leave for callbacks
  const wasOverRef = useRef(false);

  useEffect(() => {
    if (!dragItem || !canDrop) {
      wasOverRef.current = false;
      return;
    }

    if (isOver && !wasOverRef.current) {
      // Just entered
      onDragEnter?.(dragItem);
      wasOverRef.current = true;
    } else if (!isOver && wasOverRef.current) {
      // Just left
      onDragLeave?.(dragItem);
      wasOverRef.current = false;
    } else if (isOver && relativePosition) {
      // Dragging over
      onDragOver?.(dragItem, relativePosition);
    }
  }, [
    isOver,
    dragItem,
    canDrop,
    relativePosition,
    onDragEnter,
    onDragLeave,
    onDragOver,
  ]);

  // Handle drop when drag ends
  useEffect(() => {
    if (
      !isDragging &&
      wasOverRef.current &&
      dragItem &&
      canDrop &&
      relativePosition
    ) {
      onDrop(dragItem, relativePosition);
    }
    // Only run when isDragging changes to false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dropTargetRegistry.unregister(id);
    };
  }, [id]);

  return {
    isOver,
    canDrop,
    relativePosition,
    dropRect,
    dragItem: canDrop ? dragItem : null,
    dropProps: {
      ref: setNodeRef,
      "data-drop-id": id,
    },
  };
}

/**
 * Event type for drag end events (dnd-kit compatible interface)
 */
export interface DragEndEvent {
  /** The draggable that was dropped */
  active: {
    id: string;
    data: unknown;
  };
  /** The drop target (if any) */
  over: {
    id: string;
    data?: unknown;
  } | null;
  /** Position delta from start to end */
  delta: Point;
}

/**
 * dnd-kit compatible useDraggable hook
 *
 * @example
 * ```tsx
 * const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
 *   id: 'my-draggable',
 *   data: { type: 'item' },
 * });
 * ```
 */
export function useDraggable(config: {
  id: string;
  data?: Record<string, unknown>;
  disabled?: boolean;
}): {
  attributes: Record<string, string | number>;
  listeners: {
    onPointerDown: (e: React.PointerEvent) => void;
  };
  setNodeRef: (node: HTMLElement | null) => void;
  isDragging: boolean;
} {
  const { id, data, disabled } = config;
  const nodeRef = useRef<HTMLElement | null>(null);
  const isDragging = useDragStore((s) => s.isDragging && s.item?.id === id);
  const startDrag = useDragStore((s) => s.startDrag);
  const updateDrag = useDragStore((s) => s.updateDrag);
  const endDrag = useDragStore((s) => s.endDrag);
  const addOverTarget = useDragStore((s) => s.addOverTarget);
  const removeOverTarget = useDragStore((s) => s.removeOverTarget);

  const pendingRef = useRef<{
    started: boolean;
    origin: Point;
    pointerId: number;
  } | null>(null);

  const prevOverTargetsRef = useRef<Set<string>>(new Set());

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();

      const origin = { x: e.clientX, y: e.clientY };
      pendingRef.current = {
        started: false,
        origin,
        pointerId: e.pointerId,
      };

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!pendingRef.current || pendingRef.current.pointerId !== e.pointerId)
        return;

      const current = { x: e.clientX, y: e.clientY };
      const DRAG_THRESHOLD = 3;

      if (!pendingRef.current.started) {
        const dx = current.x - pendingRef.current.origin.x;
        const dy = current.y - pendingRef.current.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= DRAG_THRESHOLD) {
          pendingRef.current.started = true;
          startDrag(
            { id, type: "item", sourceId: null, data },
            pendingRef.current.origin,
          );
        }
      }

      if (pendingRef.current.started) {
        updateDrag(current);

        // Find drop targets under pointer
        const targetsAtPoint = dropTargetRegistry.getTargetsAtPoint(
          current,
          "item",
        );
        const currentTargets = new Set(targetsAtPoint);
        const prevTargets = prevOverTargetsRef.current;

        currentTargets.forEach((targetId) => {
          if (!prevTargets.has(targetId)) {
            addOverTarget(targetId);
          }
        });

        prevTargets.forEach((targetId) => {
          if (!currentTargets.has(targetId)) {
            removeOverTarget(targetId);
          }
        });

        prevOverTargetsRef.current = currentTargets;
      }
    },
    [id, data, startDrag, updateDrag, addOverTarget, removeOverTarget],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!pendingRef.current || pendingRef.current.pointerId !== e.pointerId)
        return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      if (pendingRef.current.started) {
        endDrag();
      }

      pendingRef.current = null;
      prevOverTargetsRef.current.clear();
    },
    [endDrag],
  );

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return {
    attributes: {
      role: "button",
      "aria-pressed": String(isDragging),
      tabIndex: 0,
    },
    listeners: {
      onPointerDown: handlePointerDown,
    },
    setNodeRef: (node: HTMLElement | null) => {
      nodeRef.current = node;
    },
    isDragging,
  };
}

/**
 * dnd-kit compatible useDroppable hook
 *
 * @example
 * ```tsx
 * const { setNodeRef, isOver } = useDroppable({
 *   id: 'my-droppable',
 *   data: { accepts: ['item'] },
 * });
 * ```
 */
export function useDroppable(config: {
  id: string;
  data?: Record<string, unknown>;
  disabled?: boolean;
}): {
  setNodeRef: (node: HTMLElement | null) => void;
  isOver: boolean;
  active: { id: string; data: unknown } | null;
} {
  const { id, disabled } = config;
  const elementRef = useRef<HTMLElement | null>(null);

  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);

  const isOver = overTargets.includes(id);

  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      elementRef.current = node;

      if (node && !disabled) {
        const rect = getElementRect(node);
        dropTargetRegistry.register(id, {
          element: node,
          accepts: ["item", "window", "tab", "resize-handle", "custom"],
          rect,
        });
      } else {
        dropTargetRegistry.unregister(id);
      }
    },
    [id, disabled],
  );

  useEffect(() => {
    return () => {
      dropTargetRegistry.unregister(id);
    };
  }, [id]);

  return {
    setNodeRef,
    isOver,
    active:
      isDragging && dragItem ? { id: dragItem.id, data: dragItem.data } : null,
  };
}

/**
 * Monitor for drag-drop events (dnd-kit compatible interface)
 *
 * @example
 * ```tsx
 * useDndMonitor({
 *   onDragStart: (event) => console.log('Started dragging', event.active.id),
 *   onDragEnd: (event) => console.log('Dropped', event.active.id, 'on', event.over?.id),
 * });
 * ```
 */
export function useDndMonitor(handlers: {
  onDragStart?: (event: { active: { id: string; data: unknown } }) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragOver?: (event: {
    active: { id: string; data: unknown };
    over: { id: string } | null;
  }) => void;
}): void {
  const { onDragStart, onDragEnd, onDragOver } = handlers;

  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);
  const delta = useDragStore((s) => s.delta);

  const wasDraggingRef = useRef(false);
  const prevItemRef = useRef<typeof dragItem>(null);

  useEffect(() => {
    // Detect drag start
    if (isDragging && !wasDraggingRef.current && dragItem) {
      onDragStart?.({ active: { id: dragItem.id, data: dragItem.data } });
    }

    // Detect drag end
    if (!isDragging && wasDraggingRef.current && prevItemRef.current) {
      const item = prevItemRef.current;
      const overId = overTargets.length > 0 ? overTargets[0] : null;

      onDragEnd?.({
        active: { id: item.id, data: item.data },
        over: overId ? { id: overId } : null,
        delta,
      });
    }

    // Detect drag over changes
    if (isDragging && dragItem) {
      const overId = overTargets.length > 0 ? overTargets[0] : null;
      onDragOver?.({
        active: { id: dragItem.id, data: dragItem.data },
        over: overId ? { id: overId } : null,
      });
    }

    wasDraggingRef.current = isDragging;
    prevItemRef.current = dragItem;
  }, [
    isDragging,
    dragItem,
    overTargets,
    delta,
    onDragStart,
    onDragEnd,
    onDragOver,
  ]);
}
