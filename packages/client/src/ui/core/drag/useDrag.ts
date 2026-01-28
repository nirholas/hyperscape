import { useCallback, useRef, useEffect } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DragConfig, DragResult, DragItem, Point } from "../../types";
import { getPointerPosition, dropTargetRegistry } from "./utils";

/** Minimum distance before drag starts (prevents accidental drags) */
const DRAG_THRESHOLD = 3;

/**
 * Hook to make an element draggable
 *
 * @example
 * ```tsx
 * function DraggableBox({ id }: { id: string }) {
 *   const { isDragging, dragHandleProps } = useDrag({
 *     id,
 *     type: 'window',
 *     onDragEnd: (item, delta) => {
 *       // Update position
 *     },
 *   });
 *
 *   return (
 *     <div {...dragHandleProps} style={{ opacity: isDragging ? 0.5 : 1 }}>
 *       Drag me
 *     </div>
 *   );
 * }
 * ```
 */
export function useDrag(config: DragConfig): DragResult {
  const { id, type, sourceId, data, disabled, onDragStart, onDrag, onDragEnd } =
    config;

  const startDrag = useDragStore((s) => s.startDrag);
  const updateDrag = useDragStore((s) => s.updateDrag);
  const endDrag = useDragStore((s) => s.endDrag);
  const addOverTarget = useDragStore((s) => s.addOverTarget);
  const removeOverTarget = useDragStore((s) => s.removeOverTarget);
  const isDragging = useDragStore((s) => s.isDragging && s.item?.id === id);
  const currentDelta = useDragStore((s) => s.delta);
  const currentPosition = useDragStore((s) => s.current);

  // Track pending drag state
  const pendingRef = useRef<{
    started: boolean;
    origin: Point;
    pointerId: number;
  } | null>(null);

  // Track previous over targets for enter/leave events
  const prevOverTargetsRef = useRef<Set<string>>(new Set());

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;

      // Only handle primary button (left click / touch)
      if (e.button !== 0) return;

      // Prevent text selection during drag
      e.preventDefault();

      const origin = getPointerPosition(e);
      pendingRef.current = {
        started: false,
        origin,
        pointerId: e.pointerId,
      };

      // Capture pointer to receive events outside element
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!pendingRef.current) return;
      if (pendingRef.current.pointerId !== e.pointerId) return;

      const current = getPointerPosition(e);

      if (!pendingRef.current.started) {
        // Check if we've moved enough to start dragging
        const dx = current.x - pendingRef.current.origin.x;
        const dy = current.y - pendingRef.current.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= DRAG_THRESHOLD) {
          // Start the drag
          pendingRef.current.started = true;

          const item: DragItem = {
            id,
            type,
            sourceId: sourceId || null,
            data,
          };

          startDrag(item, pendingRef.current.origin);
          onDragStart?.(item);
        }
      }

      if (pendingRef.current.started) {
        updateDrag(current);

        // Find drop targets under pointer
        const targetsAtPoint = dropTargetRegistry.getTargetsAtPoint(
          current,
          type,
        );
        const currentTargets = new Set(targetsAtPoint);
        const prevTargets = prevOverTargetsRef.current;

        // Check for enter/leave
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

        // Fire onDrag callback
        const delta = {
          x: current.x - pendingRef.current.origin.x,
          y: current.y - pendingRef.current.origin.y,
        };
        onDrag?.({ id, type, sourceId: sourceId || null, data }, delta);
      }
    },
    [
      id,
      type,
      sourceId,
      data,
      startDrag,
      updateDrag,
      addOverTarget,
      removeOverTarget,
      onDragStart,
      onDrag,
    ],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!pendingRef.current) return;
      if (pendingRef.current.pointerId !== e.pointerId) return;

      // Release pointer capture
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      if (pendingRef.current.started) {
        const current = getPointerPosition(e);
        const delta = {
          x: current.x - pendingRef.current.origin.x,
          y: current.y - pendingRef.current.origin.y,
        };

        onDragEnd?.({ id, type, sourceId: sourceId || null, data }, delta);
        endDrag();
      }

      pendingRef.current = null;
      prevOverTargetsRef.current.clear();
    },
    [id, type, sourceId, data, endDrag, onDragEnd],
  );

  // Add global listeners when drag might be in progress
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
    isDragging,
    delta: isDragging ? currentDelta : { x: 0, y: 0 },
    position: isDragging ? currentPosition : { x: 0, y: 0 },
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      style: {
        cursor: disabled ? "default" : "grab",
        touchAction: "none",
      },
    },
  };
}
