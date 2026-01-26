import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useDragStore } from "../../stores/dragStore";
import { dropTargetRegistry } from "./utils";
import type { DragEndEvent } from "./useDrop";

/** Drag context value */
interface DragContextValue {
  /** Whether a drag is currently in progress */
  isDragging: boolean;
}

const DragContextInternal = createContext<DragContextValue | null>(null);

/** Props for DragProvider */
interface DragProviderProps {
  children: ReactNode;
  /** Callback when a drag operation ends */
  onDragEnd?: (event: DragEndEvent) => void;
  /** Callback when a drag operation starts */
  onDragStart?: (event: { active: { id: string; data: unknown } }) => void;
}

/**
 * Provider component for the drag-drop system
 *
 * Wrap your app (or the part that uses drag-drop) with this provider.
 * It handles cleanup and provides context for drag state.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <DragProvider onDragEnd={(event) => console.log('Dropped', event)}>
 *       <YourWindows />
 *       <DragOverlay />
 *     </DragProvider>
 *   );
 * }
 * ```
 */
export function DragProvider({
  children,
  onDragEnd,
  onDragStart,
}: DragProviderProps): React.ReactElement {
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const overTargets = useDragStore((s) => s.overTargets);
  const delta = useDragStore((s) => s.delta);
  const reset = useDragStore((s) => s.reset);

  // Track previous state for detecting transitions
  const wasDraggingRef = useRef(false);
  const prevItemRef = useRef(dragItem);
  // Save overTargets and delta while dragging so we can use them after endDrag() clears them
  const savedOverTargetsRef = useRef(overTargets);
  const savedDeltaRef = useRef(delta);

  // Update saved refs while dragging
  useEffect(() => {
    if (isDragging) {
      savedOverTargetsRef.current = overTargets;
      savedDeltaRef.current = delta;
    }
  }, [isDragging, overTargets, delta]);

  // Fire callbacks on drag start/end
  useEffect(() => {
    // Detect drag start
    if (isDragging && !wasDraggingRef.current && dragItem) {
      onDragStart?.({ active: { id: dragItem.id, data: dragItem.data } });
    }

    // Detect drag end - use saved refs since store is cleared before this runs
    if (!isDragging && wasDraggingRef.current && prevItemRef.current) {
      const item = prevItemRef.current;
      const savedTargets = savedOverTargetsRef.current;
      const overId = savedTargets.length > 0 ? savedTargets[0] : null;

      onDragEnd?.({
        active: {
          id: item.id,
          type: item.type,
          sourceId: item.sourceId,
          data: item.data,
        },
        over: overId ? { id: overId } : null,
        delta: savedDeltaRef.current,
      });

      // Clear saved refs after firing
      savedOverTargetsRef.current = [];
      savedDeltaRef.current = { x: 0, y: 0 };
    }

    wasDraggingRef.current = isDragging;
    prevItemRef.current = dragItem;
  }, [isDragging, dragItem, onDragStart, onDragEnd]);

  // Reset drag state on unmount
  useEffect(() => {
    return () => {
      reset();
      dropTargetRegistry.clear();
    };
  }, [reset]);

  // Handle escape key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDragging) {
        reset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDragging, reset]);

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

  const value: DragContextValue = {
    isDragging,
  };

  // React 19: Context can be used directly as a provider
  return <DragContextInternal value={value}>{children}</DragContextInternal>;
}

/**
 * Hook to access drag context
 *
 * Must be used within a DragProvider
 */
export function useDragContext(): DragContextValue {
  const context = useContext(DragContextInternal);
  if (!context) {
    throw new Error("useDragContext must be used within a DragProvider");
  }
  return context;
}

/** Alias for DragProvider for backwards compatibility */
export const DragContext = DragProvider;

/** dnd-kit compatible alias */
export const DndProvider = DragProvider;
