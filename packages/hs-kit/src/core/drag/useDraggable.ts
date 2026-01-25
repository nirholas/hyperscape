/**
 * useDraggable Hook
 *
 * A hook with @dnd-kit compatible API for making elements draggable.
 * This is the hs-kit equivalent of @dnd-kit's useDraggable.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useEffect, useMemo } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DragItem, Point } from "../../types";
import { getPointerPosition, dropTargetRegistry } from "./utils";

/** Configuration for useDraggable */
export interface UseDraggableConfig {
  /** Unique identifier for this draggable */
  id: string;

  /** Data to attach to the drag item */
  data?: Record<string, unknown>;

  /** Whether dragging is disabled */
  disabled?: boolean;

  /** Minimum distance in pixels before drag starts */
  activationDistance?: number;
}

/** Return value from useDraggable */
export interface UseDraggableReturn {
  /** Whether this element is currently being dragged */
  isDragging: boolean;

  /** Attributes to spread on the draggable element */
  attributes: {
    role: string;
    tabIndex: number;
    "aria-disabled": boolean;
    "data-draggable-id": string;
  };

  /** Event listeners to spread on the draggable element */
  listeners: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  };

  /** Ref callback to set on the draggable element */
  setNodeRef: (node: HTMLElement | null) => void;

  /** Current transform during drag */
  transform: { x: number; y: number } | null;

  /** The dragged element's bounding rect at drag start */
  node: { current: HTMLElement | null };

  /** The drag active state with rect info */
  active: {
    id: string;
    data: Record<string, unknown>;
    rect: { current: { initial: DOMRect | null } };
  } | null;
}

/** Default activation distance */
const DEFAULT_ACTIVATION_DISTANCE = 3;

/**
 * Make an element draggable
 *
 * @example
 * ```tsx
 * function DraggableItem({ id, item }: { id: string; item: Item }) {
 *   const {
 *     attributes,
 *     listeners,
 *     setNodeRef,
 *     isDragging,
 *     transform,
 *   } = useDraggable({
 *     id,
 *     data: { item, index: item.slot },
 *     disabled: !item,
 *   });
 *
 *   return (
 *     <div
 *       ref={setNodeRef}
 *       {...attributes}
 *       {...listeners}
 *       style={{
 *         opacity: isDragging ? 0.5 : 1,
 *         transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
 *       }}
 *     >
 *       <ItemIcon itemId={item.itemId} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useDraggable(config: UseDraggableConfig): UseDraggableReturn {
  const {
    id,
    data = {},
    disabled = false,
    activationDistance = DEFAULT_ACTIVATION_DISTANCE,
  } = config;

  const startDrag = useDragStore((s) => s.startDrag);
  const updateDrag = useDragStore((s) => s.updateDrag);
  const endDrag = useDragStore((s) => s.endDrag);
  const addOverTarget = useDragStore((s) => s.addOverTarget);
  const removeOverTarget = useDragStore((s) => s.removeOverTarget);
  const isDragging = useDragStore((s) => s.isDragging && s.item?.id === id);
  const currentDelta = useDragStore((s) => s.delta);

  // Refs
  const nodeRef = useRef<HTMLElement | null>(null);
  const initialRectRef = useRef<DOMRect | null>(null);
  const pendingRef = useRef<{
    started: boolean;
    origin: Point;
    pointerId: number;
  } | null>(null);
  const prevOverTargetsRef = useRef<Set<string>>(new Set());

  // Refs for handler functions to avoid recreating listeners
  // This prevents the useEffect from running on every render
  const handlersRef = useRef<{
    handlePointerMove: (e: PointerEvent) => void;
    handlePointerUp: (e: PointerEvent) => void;
  } | null>(null);
  const listenersAttachedRef = useRef(false);

  // Set node ref callback
  const setNodeRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  // Stable refs for values used in handlers to avoid recreating handlers
  const configRef = useRef({ id, data, activationDistance });
  configRef.current = { id, data, activationDistance };

  const actionsRef = useRef({
    startDrag,
    updateDrag,
    endDrag,
    addOverTarget,
    removeOverTarget,
  });
  actionsRef.current = {
    startDrag,
    updateDrag,
    endDrag,
    addOverTarget,
    removeOverTarget,
  };

  // Detach global listeners (defined first to avoid circular reference)
  const detachListeners = useCallback(() => {
    if (!listenersAttachedRef.current || !handlersRef.current) return;

    const { handlePointerMove, handlePointerUp } = handlersRef.current;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    listenersAttachedRef.current = false;
    handlersRef.current = null;
  }, []);

  // Attach global listeners only when drag starts/ends
  const attachListeners = useCallback(() => {
    if (listenersAttachedRef.current) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!pendingRef.current) return;
      if (pendingRef.current.pointerId !== e.pointerId) return;

      const current = getPointerPosition(e);
      const {
        id: itemId,
        data: itemData,
        activationDistance: actDist,
      } = configRef.current;
      const {
        startDrag: start,
        updateDrag: update,
        addOverTarget: addTarget,
        removeOverTarget: removeTarget,
      } = actionsRef.current;

      if (!pendingRef.current.started) {
        // Check activation distance
        const dx = current.x - pendingRef.current.origin.x;
        const dy = current.y - pendingRef.current.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= actDist) {
          pendingRef.current.started = true;

          const item: DragItem = {
            id: itemId,
            type: "item",
            sourceId: null,
            data: itemData,
          };

          start(item, pendingRef.current.origin);
        }
      }

      if (pendingRef.current.started) {
        update(current);

        // Find drop targets under pointer
        const targetsAtPoint = dropTargetRegistry.getTargetsAtPoint(
          current,
          "item",
        );
        const currentTargets = new Set(targetsAtPoint);
        const prevTargets = prevOverTargetsRef.current;

        currentTargets.forEach((targetId) => {
          if (!prevTargets.has(targetId)) {
            addTarget(targetId);
          }
        });

        prevTargets.forEach((targetId) => {
          if (!currentTargets.has(targetId)) {
            removeTarget(targetId);
          }
        });

        prevOverTargetsRef.current = currentTargets;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!pendingRef.current) return;
      if (pendingRef.current.pointerId !== e.pointerId) return;

      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }

      if (pendingRef.current.started) {
        actionsRef.current.endDrag();
      }

      pendingRef.current = null;
      prevOverTargetsRef.current.clear();
      detachListeners();
    };

    handlersRef.current = { handlePointerMove, handlePointerUp };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    listenersAttachedRef.current = true;
  }, [detachListeners]);

  // Handle pointer down
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (e.button !== 0) return;

      e.preventDefault();

      // Store initial rect for DragOverlay positioning
      if (nodeRef.current) {
        initialRectRef.current = nodeRef.current.getBoundingClientRect();
      }

      const origin = getPointerPosition(e);
      pendingRef.current = {
        started: false,
        origin,
        pointerId: e.pointerId,
      };

      // Attach global listeners only when drag starts (optimization)
      attachListeners();

      // Capture pointer
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled, attachListeners],
  );

  // Handle keyboard activation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();

        // Toggle drag state with keyboard
        if (!isDragging && nodeRef.current) {
          initialRectRef.current = nodeRef.current.getBoundingClientRect();
          const rect = initialRectRef.current;
          const origin = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };

          const item: DragItem = {
            id,
            type: "item",
            sourceId: null,
            data,
          };
          startDrag(item, origin);
        } else {
          endDrag();
        }
      }
    },
    [disabled, isDragging, id, data, startDrag, endDrag],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      detachListeners();
    };
  }, [detachListeners]);

  // Compute transform
  const transform = isDragging
    ? { x: currentDelta.x, y: currentDelta.y }
    : null;

  // Compute active state
  const active = useMemo(() => {
    if (!isDragging) return null;
    return {
      id,
      data,
      rect: { current: { initial: initialRectRef.current } },
    };
  }, [isDragging, id, data]);

  return {
    isDragging,
    attributes: {
      role: "button",
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled,
      "data-draggable-id": id,
    },
    listeners: {
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
    },
    setNodeRef,
    transform,
    node: nodeRef,
    active,
  };
}
