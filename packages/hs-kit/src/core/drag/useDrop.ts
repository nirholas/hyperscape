import { useCallback, useEffect, useRef, useMemo } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DropConfig, DropResult, Point, Rect } from "../../types";
import { dropTargetRegistry, getElementRect, isPointInRect } from "./utils";

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
 *         background: isOver && canDrop ? 'lightgreen' : 'white',
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
  const wasOverRef = useRef(false);

  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);
  const current = useDragStore((s) => s.current);

  // Check if we can accept the current drag
  const canDrop = Boolean(
    isDragging && dragItem && accepts.includes(dragItem.type) && !disabled,
  );

  // Check if drag is currently over this target
  const isOver = canDrop && overTargets.includes(id);

  // Register/unregister drop target
  const refCallback = useCallback(
    (element: HTMLElement | null) => {
      // Unregister previous element
      if (elementRef.current) {
        dropTargetRegistry.unregister(id);
      }

      elementRef.current = element;

      // Register new element
      if (element && !disabled) {
        dropTargetRegistry.register(id, element, accepts);
      }
    },
    [id, accepts, disabled],
  );

  // Handle drag enter/leave/over events
  useEffect(() => {
    if (!canDrop || !dragItem) return;

    const isCurrentlyOver = isOver;
    const wasOver = wasOverRef.current;

    if (isCurrentlyOver && !wasOver) {
      // Just entered
      onDragEnter?.(dragItem);
    } else if (!isCurrentlyOver && wasOver) {
      // Just left
      onDragLeave?.(dragItem);
    } else if (isCurrentlyOver) {
      // Still over, fire drag over
      onDragOver?.(dragItem, current);
    }

    wasOverRef.current = isCurrentlyOver;
  }, [
    isOver,
    canDrop,
    dragItem,
    current,
    onDragEnter,
    onDragLeave,
    onDragOver,
  ]);

  // Handle drop
  useEffect(() => {
    // Listen for drag end while over this target
    const unsubscribe = useDragStore.subscribe((state, prevState) => {
      // Detect drag end
      if (prevState.isDragging && !state.isDragging && prevState.item) {
        // Check if we were a valid drop target
        if (
          prevState.overTargets.includes(id) &&
          accepts.includes(prevState.item.type) &&
          !disabled
        ) {
          onDrop(prevState.item, prevState.current);
        }
      }
    });

    return unsubscribe;
  }, [id, accepts, disabled, onDrop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dropTargetRegistry.unregister(id);
    };
  }, [id]);

  // Calculate relative position within the drop target
  const { relativePosition, dropRect } = useMemo((): {
    relativePosition: Point | null;
    dropRect: Rect | null;
  } => {
    if (!isOver || !elementRef.current) {
      return { relativePosition: null, dropRect: null };
    }

    const rect = getElementRect(elementRef.current);

    // Verify the current pointer is actually in the rect (defensive check)
    if (!isPointInRect(current, rect)) {
      return { relativePosition: null, dropRect: rect };
    }

    return {
      relativePosition: {
        x: current.x - rect.x,
        y: current.y - rect.y,
      },
      dropRect: rect,
    };
  }, [isOver, current]);

  return {
    isOver: Boolean(isOver),
    canDrop: Boolean(canDrop),
    relativePosition,
    dropRect,
    dragItem: canDrop ? dragItem : null,
    dropProps: {
      ref: refCallback,
      "data-drop-id": id,
    },
  };
}
