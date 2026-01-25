/**
 * Enhanced Drag Context
 *
 * A more feature-rich DragProvider that supports:
 * - onDragStart, onDragEnd, onDragOver, onDragCancel callbacks
 * - Sensor configuration
 * - Collision detection strategy
 * - Modifiers
 *
 * This is the hs-kit equivalent of @dnd-kit's DndContext.
 *
 * @packageDocumentation
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useDragStore } from "../../stores/dragStore";
import { dropTargetRegistry } from "./utils";
import type { DragItem, Point, CollisionDetector } from "../../types";
import { pointerWithin } from "./collisionDetection";

/** Active drag event data */
export interface DragEvent {
  /** The item being dragged */
  active: {
    id: string;
    data: DragItem;
    rect?: { current: { initial: DOMRect | null } };
  };
}

/** Drag start event */
export interface DragStartEvent extends DragEvent {}

/** Drag move event */
export interface DragMoveEvent extends DragEvent {
  /** Current pointer position */
  position: Point;
  /** Delta from start position */
  delta: Point;
}

/** Drag over event */
export interface DragOverEvent extends DragEvent {
  /** The drop target being hovered */
  over: { id: string } | null;
}

/** Drag end event */
export interface DragEndEvent extends DragEvent {
  /** The drop target where item was dropped (null if cancelled) */
  over: { id: string; data?: Record<string, unknown> } | null;
  /** Delta from start position */
  delta: Point;
}

/** Drag cancel event */
export interface DragCancelEvent extends DragEvent {}

/** Sensor configuration */
export interface SensorConfig {
  /** Mouse sensor settings */
  mouse?: {
    /** Minimum distance before drag starts */
    activationConstraint?: { distance?: number };
  };
  /** Touch sensor settings */
  touch?: {
    /** Delay before touch drag starts */
    activationConstraint?: { delay?: number; tolerance?: number };
  };
  /** Keyboard sensor settings */
  keyboard?: {
    enabled?: boolean;
  };
}

/** Props for DndProvider */
export interface DndProviderProps {
  children: ReactNode;

  /**
   * Called when drag starts
   */
  onDragStart?: (event: DragStartEvent) => void;

  /**
   * Called when drag moves
   */
  onDragMove?: (event: DragMoveEvent) => void;

  /**
   * Called when dragging over a drop target
   */
  onDragOver?: (event: DragOverEvent) => void;

  /**
   * Called when drag ends (dropped or cancelled)
   */
  onDragEnd?: (event: DragEndEvent) => void;

  /**
   * Called when drag is cancelled (escape key)
   */
  onDragCancel?: (event: DragCancelEvent) => void;

  /**
   * Collision detection strategy
   * @default pointerWithin
   */
  collisionDetection?: CollisionDetector;

  /**
   * Sensor configuration
   */
  sensors?: SensorConfig;
}

/** Internal context value */
interface DndContextValue {
  isDragging: boolean;
  activeId: string | null;
  overId: string | null;
}

const DndContextInternal = createContext<DndContextValue | null>(null);

/**
 * Enhanced drag-drop provider with @dnd-kit compatible API
 *
 * @example
 * ```tsx
 * function InventoryGrid() {
 *   const handleDragEnd = (event: DragEndEvent) => {
 *     const { active, over } = event;
 *     if (over) {
 *       moveItem(active.id, over.id);
 *     }
 *   };
 *
 *   return (
 *     <DndProvider onDragEnd={handleDragEnd}>
 *       {slots.map((slot) => (
 *         <InventorySlot key={slot.id} slot={slot} />
 *       ))}
 *       <ComposableDragOverlay>
 *         {({ item }) => <ItemPreview item={item} />}
 *       </ComposableDragOverlay>
 *     </DndProvider>
 *   );
 * }
 * ```
 */
export function DndProvider({
  children,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragEnd,
  onDragCancel,
  collisionDetection = pointerWithin,
}: DndProviderProps): React.ReactElement {
  const isDragging = useDragStore((s) => s.isDragging);
  const item = useDragStore((s) => s.item);
  const current = useDragStore((s) => s.current);
  const delta = useDragStore((s) => s.delta);
  const overTargets = useDragStore((s) => s.overTargets);
  const reset = useDragStore((s) => s.reset);

  // Track callbacks in refs to avoid effect dependencies
  const callbacksRef = useRef({
    onDragStart,
    onDragMove,
    onDragOver,
    onDragEnd,
    onDragCancel,
  });
  callbacksRef.current = {
    onDragStart,
    onDragMove,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };

  // Track previous drag state to detect changes
  const prevDraggingRef = useRef(false);
  const prevOverTargetsRef = useRef<string[]>([]);
  const dragStartRectRef = useRef<DOMRect | null>(null);

  // Track collision detection
  const collisionDetectionRef = useRef(collisionDetection);
  collisionDetectionRef.current = collisionDetection;

  // Handle drag state changes
  useEffect(() => {
    // Drag started
    if (isDragging && !prevDraggingRef.current && item) {
      const event: DragStartEvent = {
        active: {
          id: item.id,
          data: item,
          rect: { current: { initial: dragStartRectRef.current } },
        },
      };
      callbacksRef.current.onDragStart?.(event);
    }

    prevDraggingRef.current = isDragging;
  }, [isDragging, item]);

  // Handle over target changes
  useEffect(() => {
    if (!isDragging || !item) return;

    const prevOver = prevOverTargetsRef.current[0] || null;
    const currentOver = overTargets[0] || null;

    if (prevOver !== currentOver) {
      const event: DragOverEvent = {
        active: {
          id: item.id,
          data: item,
        },
        over: currentOver ? { id: currentOver } : null,
      };
      callbacksRef.current.onDragOver?.(event);
    }

    prevOverTargetsRef.current = [...overTargets];
  }, [isDragging, item, overTargets]);

  // Handle drag move
  useEffect(() => {
    if (!isDragging || !item) return;

    const event: DragMoveEvent = {
      active: {
        id: item.id,
        data: item,
      },
      position: current,
      delta,
    };
    callbacksRef.current.onDragMove?.(event);
  }, [isDragging, item, current, delta]);

  // Subscribe to drag store to detect drag end
  // We use subscribe because by the time the effect runs, the store has already reset
  useEffect(() => {
    const unsubscribe = useDragStore.subscribe((state, prevState) => {
      // Detect drag end: was dragging, now not dragging
      if (prevState.isDragging && !state.isDragging && prevState.item) {
        const over = prevState.overTargets[0];
        const event: DragEndEvent = {
          active: {
            id: prevState.item.id,
            data: prevState.item,
            rect: { current: { initial: null } },
          },
          over: over
            ? {
                id: over,
                data: dropTargetRegistry.getTargetData(over),
              }
            : null,
          delta: prevState.delta,
        };
        callbacksRef.current.onDragEnd?.(event);
      }
    });

    return unsubscribe;
  }, []);

  // Handle escape key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDragging && item) {
        const event: DragCancelEvent = {
          active: {
            id: item.id,
            data: item,
          },
        };
        callbacksRef.current.onDragCancel?.(event);
        reset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDragging, item, reset]);

  // Prevent text selection during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  // Reset on unmount
  useEffect(() => {
    return () => {
      reset();
      dropTargetRegistry.clear();
    };
  }, [reset]);

  const contextValue: DndContextValue = {
    isDragging,
    activeId: item?.id || null,
    overId: overTargets[0] || null,
  };

  // React 19: Context can be used directly as a provider
  return (
    <DndContextInternal value={contextValue}>{children}</DndContextInternal>
  );
}

/**
 * Hook to access DnD context
 */
export function useDndContext(): DndContextValue {
  const context = useContext(DndContextInternal);
  if (!context) {
    throw new Error("useDndContext must be used within a DndProvider");
  }
  return context;
}

/**
 * Hook to check if currently dragging
 */
export function useDndMonitor(callbacks: {
  onDragStart?: (event: DragStartEvent) => void;
  onDragMove?: (event: DragMoveEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
}): void {
  const isDragging = useDragStore((s) => s.isDragging);
  const item = useDragStore((s) => s.item);
  const current = useDragStore((s) => s.current);
  const delta = useDragStore((s) => s.delta);
  const overTargets = useDragStore((s) => s.overTargets);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const prevDraggingRef = useRef(false);
  const prevOverRef = useRef<string | null>(null);

  useEffect(() => {
    if (isDragging && !prevDraggingRef.current && item) {
      callbacksRef.current.onDragStart?.({
        active: { id: item.id, data: item },
      });
    }

    if (!isDragging && prevDraggingRef.current && item) {
      const over = overTargets[0];
      callbacksRef.current.onDragEnd?.({
        active: { id: item.id, data: item },
        over: over ? { id: over } : null,
        delta,
      });
    }

    prevDraggingRef.current = isDragging;
  }, [isDragging, item, overTargets, delta]);

  useEffect(() => {
    if (!isDragging || !item) return;

    const currentOver = overTargets[0] || null;
    if (currentOver !== prevOverRef.current) {
      callbacksRef.current.onDragOver?.({
        active: { id: item.id, data: item },
        over: currentOver ? { id: currentOver } : null,
      });
      prevOverRef.current = currentOver;
    }
  }, [isDragging, item, overTargets]);

  useEffect(() => {
    if (!isDragging || !item) return;

    callbacksRef.current.onDragMove?.({
      active: { id: item.id, data: item },
      position: current,
      delta,
    });
  }, [isDragging, item, current, delta]);
}
