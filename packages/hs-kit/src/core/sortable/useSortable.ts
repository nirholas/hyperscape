/**
 * useSortable Hook
 *
 * A hook with @dnd-kit compatible API for making elements sortable.
 * This is the hs-kit equivalent of @dnd-kit's useSortable.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useEffect, useMemo } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DragItem, Point } from "../../types";
import { getPointerPosition, dropTargetRegistry } from "../drag/utils";
import { useMaybeSortableContext } from "./SortableContext";
import { SORTABLE_TRANSITION } from "./sortingStrategies";

/** Configuration for useSortable */
export interface UseSortableConfig {
  /**
   * Unique identifier for this sortable item.
   * Must match an ID provided to the parent SortableContext.
   */
  id: string;

  /**
   * Data to attach to this sortable item.
   * Available in drag events and callbacks.
   */
  data?: Record<string, unknown>;

  /**
   * Whether this item is disabled (cannot be sorted).
   * @default false
   */
  disabled?: boolean;

  /**
   * Minimum distance in pixels before drag starts.
   * @default 3
   */
  activationDistance?: number;

  /**
   * Whether to animate when sorting.
   * @default true
   */
  animateLayoutChanges?: boolean;

  /**
   * Custom transition for layout animations.
   * @default "transform 200ms ease"
   */
  transition?: string | null;
}

/** Return value from useSortable */
export interface UseSortableReturn {
  /**
   * Whether this item is currently being dragged.
   */
  isDragging: boolean;

  /**
   * Whether this item is being sorted (position changed).
   */
  isSorting: boolean;

  /**
   * Current index of this item in the sortable list.
   */
  index: number;

  /**
   * New index (during sorting) or current index.
   */
  newIndex: number;

  /**
   * Attributes to spread on the sortable element.
   * Includes accessibility attributes for screen readers.
   */
  attributes: {
    role: string;
    tabIndex: number;
    "aria-disabled": boolean;
    "aria-roledescription": string;
    "data-sortable-id": string;
  };

  /**
   * Event listeners to spread on the sortable element.
   * Handles pointer and keyboard interactions.
   */
  listeners: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  };

  /**
   * Ref callback to set on the sortable element.
   * Required for sorting to work.
   */
  setNodeRef: (node: HTMLElement | null) => void;

  /**
   * Current transform during drag/sort.
   * Apply to element's transform style.
   */
  transform: { x: number; y: number } | null;

  /**
   * Transition CSS value for smooth animations.
   * Apply to element's transition style.
   */
  transition: string | null;

  /**
   * Reference to the DOM node.
   */
  node: { current: HTMLElement | null };

  /**
   * Active drag state (when this item is dragging).
   */
  active: {
    id: string;
    data: Record<string, unknown>;
    rect: { current: { initial: DOMRect | null } };
  } | null;

  /**
   * Over target state (when dragging over another sortable).
   */
  over: { id: string } | null;

  /**
   * Set active node ref for drag overlay positioning.
   */
  setActivatorNodeRef: (node: HTMLElement | null) => void;
}

/** Default activation distance */
const DEFAULT_ACTIVATION_DISTANCE = 3;

/**
 * Make an element sortable within a SortableContext
 *
 * @example
 * ```tsx
 * function SortableItem({ id, children }: { id: string; children: ReactNode }) {
 *   const {
 *     attributes,
 *     listeners,
 *     setNodeRef,
 *     transform,
 *     transition,
 *     isDragging,
 *   } = useSortable({ id });
 *
 *   const style = {
 *     transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
 *     transition,
 *     opacity: isDragging ? 0.5 : 1,
 *   };
 *
 *   return (
 *     <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSortable(config: UseSortableConfig): UseSortableReturn {
  const {
    id,
    data = {},
    disabled = false,
    activationDistance = DEFAULT_ACTIVATION_DISTANCE,
    animateLayoutChanges = true,
    transition: customTransition,
  } = config;

  // Get sortable context (may be null if not in a SortableContext)
  const sortableContext = useMaybeSortableContext();

  // Drag store
  const startDrag = useDragStore((s) => s.startDrag);
  const updateDrag = useDragStore((s) => s.updateDrag);
  const endDrag = useDragStore((s) => s.endDrag);
  const addOverTarget = useDragStore((s) => s.addOverTarget);
  const removeOverTarget = useDragStore((s) => s.removeOverTarget);
  const isDragging = useDragStore((s) => s.isDragging && s.item?.id === id);
  const currentDelta = useDragStore((s) => s.delta);
  const overTargets = useDragStore((s) => s.overTargets);
  const currentPosition = useDragStore((s) => s.current);

  // Refs
  const nodeRef = useRef<HTMLElement | null>(null);
  const activatorNodeRef = useRef<HTMLElement | null>(null);
  const initialRectRef = useRef<DOMRect | null>(null);
  const pendingRef = useRef<{
    started: boolean;
    origin: Point;
    pointerId: number;
  } | null>(null);
  const prevOverTargetsRef = useRef<Set<string>>(new Set());

  // Handler refs
  const handlersRef = useRef<{
    handlePointerMove: (e: PointerEvent) => void;
    handlePointerUp: (e: PointerEvent) => void;
  } | null>(null);
  const listenersAttachedRef = useRef(false);

  // Stable refs for values used in handlers
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

  // Get context info
  const contextState = sortableContext?.state;
  const contextActions = sortableContext?.actions;

  // Get current index
  const index = useMemo(() => {
    if (contextActions) {
      return contextActions.getItemIndex(id);
    }
    return -1;
  }, [contextActions, id]);

  // Get new index (during sorting)
  const newIndex = useMemo(() => {
    if (!contextState || !isDragging) return index;
    return contextState.targetIndex >= 0 ? contextState.targetIndex : index;
  }, [contextState, isDragging, index]);

  // Check if sorting (any item in the context is being dragged)
  const isSorting = useMemo(() => {
    // Must be in a context and have an active item
    return contextState !== undefined && contextState.activeId !== null;
  }, [contextState]);

  // Set node ref callback
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;

      // Register with sortable context
      if (contextActions) {
        if (node) {
          contextActions.registerItem(id, node);
        } else {
          contextActions.unregisterItem(id);
        }
      }

      // Also register as drop target
      if (node && !disabled) {
        const rect = node.getBoundingClientRect();
        dropTargetRegistry.register(id, {
          element: node,
          rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          accepts: ["item"],
          data,
        });
      } else {
        dropTargetRegistry.unregister(id);
      }
    },
    [id, data, disabled, contextActions],
  );

  // Set activator node ref
  const setActivatorNodeRef = useCallback((node: HTMLElement | null) => {
    activatorNodeRef.current = node;
  }, []);

  // Detach global listeners
  const detachListeners = useCallback(() => {
    if (!listenersAttachedRef.current || !handlersRef.current) return;

    const { handlePointerMove, handlePointerUp } = handlersRef.current;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    listenersAttachedRef.current = false;
    handlersRef.current = null;
  }, []);

  // Attach global listeners
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
        const dx = current.x - pendingRef.current.origin.x;
        const dy = current.y - pendingRef.current.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= actDist) {
          pendingRef.current.started = true;

          const item: DragItem = {
            id: itemId,
            type: "item",
            sourceId: sortableContext?.state.containerId || null,
            data: {
              ...itemData,
              containerId: sortableContext?.state.containerId,
              index: sortableContext?.actions.getItemIndex(itemId) ?? -1,
            },
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
        // Let sortable context handle the end
        if (sortableContext?.actions) {
          sortableContext.actions.endSortableDrag();
        } else {
          actionsRef.current.endDrag();
        }
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
  }, [sortableContext, detachListeners]);

  // Handle pointer down
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (e.button !== 0) return;

      e.preventDefault();

      // Store initial rect
      if (nodeRef.current) {
        initialRectRef.current = nodeRef.current.getBoundingClientRect();
      }

      const origin = getPointerPosition(e);
      pendingRef.current = {
        started: false,
        origin,
        pointerId: e.pointerId,
      };

      attachListeners();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled, attachListeners],
  );

  // Handle keyboard interaction
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      // Start/end drag with Space or Enter
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();

        if (!isDragging && nodeRef.current) {
          initialRectRef.current = nodeRef.current.getBoundingClientRect();
          const rect = initialRectRef.current;
          const origin = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };

          if (sortableContext?.actions) {
            sortableContext.actions.startSortableDrag(id, origin);
          } else {
            const item: DragItem = {
              id,
              type: "item",
              sourceId: null,
              data,
            };
            startDrag(item, origin);
          }
        } else if (isDragging) {
          if (sortableContext?.actions) {
            sortableContext.actions.endSortableDrag();
          } else {
            endDrag();
          }
        }
        return;
      }

      // Arrow key navigation for keyboard sorting
      if (isDragging) {
        let delta: Point | null = null;
        const step = e.shiftKey ? 50 : 10;

        switch (e.key) {
          case "ArrowUp":
            delta = { x: 0, y: -step };
            break;
          case "ArrowDown":
            delta = { x: 0, y: step };
            break;
          case "ArrowLeft":
            delta = { x: -step, y: 0 };
            break;
          case "ArrowRight":
            delta = { x: step, y: 0 };
            break;
          case "Escape":
            endDrag();
            return;
        }

        if (delta) {
          e.preventDefault();
          const newPosition = {
            x: currentPosition.x + delta.x,
            y: currentPosition.y + delta.y,
          };
          updateDrag(newPosition);

          // Update over targets for keyboard navigation
          const targetsAtPoint = dropTargetRegistry.getTargetsAtPoint(
            newPosition,
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
      }
    },
    [
      disabled,
      isDragging,
      id,
      data,
      sortableContext,
      startDrag,
      endDrag,
      updateDrag,
      currentPosition,
      addOverTarget,
      removeOverTarget,
    ],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      detachListeners();
      if (contextActions) {
        contextActions.unregisterItem(id);
      }
      dropTargetRegistry.unregister(id);
    };
  }, [id, contextActions, detachListeners]);

  // Update rect on scroll/resize
  useEffect(() => {
    if (!nodeRef.current || disabled) return;

    const updateRect = () => {
      if (nodeRef.current && contextActions) {
        const rect = nodeRef.current.getBoundingClientRect();
        contextActions.updateItemRect(id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });

        // Also update drop target registry
        dropTargetRegistry.register(id, {
          element: nodeRef.current,
          rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          accepts: ["item"],
          data,
        });
      }
    };

    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);

    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [id, data, disabled, contextActions]);

  // Compute transform
  const transform = useMemo((): { x: number; y: number } | null => {
    if (isDragging) {
      return { x: currentDelta.x, y: currentDelta.y };
    }

    // Get transform from context for items being shifted
    if (contextActions && isSorting) {
      return contextActions.getItemTransform(id);
    }

    return null;
  }, [isDragging, currentDelta, contextActions, isSorting, id]);

  // Compute transition
  const transition = useMemo((): string | null => {
    if (!animateLayoutChanges) return null;
    if (isDragging) return null; // No transition while actively dragging

    // Only apply transition when sorting (an item is being dragged in the context)
    if (!isSorting) return null;

    // Use custom transition if provided
    if (customTransition !== undefined) {
      return customTransition;
    }

    // Apply default transition for items being shifted
    if (transform) {
      return SORTABLE_TRANSITION;
    }

    return null;
  }, [
    animateLayoutChanges,
    isDragging,
    customTransition,
    isSorting,
    transform,
  ]);

  // Compute active state
  const active = useMemo(() => {
    if (!isDragging) return null;
    return {
      id,
      data,
      rect: { current: { initial: initialRectRef.current } },
    };
  }, [isDragging, id, data]);

  // Compute over state
  const over = useMemo(() => {
    const overId = overTargets[0];
    return overId ? { id: overId } : null;
  }, [overTargets]);

  return {
    isDragging,
    isSorting,
    index,
    newIndex,
    attributes: {
      role: "listitem",
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled,
      "aria-roledescription": "sortable",
      "data-sortable-id": id,
    },
    listeners: {
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
    },
    setNodeRef,
    transform,
    transition,
    node: nodeRef,
    active,
    over,
    setActivatorNodeRef,
  };
}
