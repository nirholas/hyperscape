import { useCallback, useRef, useEffect } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { DragItem, DragItemType, Point } from "../../types";
import {
  type KeyboardSensorOptions,
  DEFAULT_KEYBOARD_OPTIONS,
  getKeyboardMovementDelta,
  isStartKey,
  isCancelKey,
  isDropKey,
} from "./sensors";

/** Configuration for useKeyboardDrag hook */
export interface KeyboardDragConfig {
  /** Unique identifier for this draggable */
  id: string;
  /** Type of drag item */
  type: DragItemType;
  /** Optional source identifier */
  sourceId?: string;
  /** Custom data to attach */
  data?: unknown;
  /** Disable keyboard dragging */
  disabled?: boolean;
  /** Keyboard sensor options */
  options?: KeyboardSensorOptions;
  /** Callback when drag starts */
  onDragStart?: (item: DragItem) => void;
  /** Callback during drag (on each move) */
  onDrag?: (item: DragItem, delta: Point) => void;
  /** Callback when drag ends */
  onDragEnd?: (item: DragItem, delta: Point) => void;
  /** Callback when drag is cancelled */
  onDragCancel?: (item: DragItem) => void;
}

/** Return value from useKeyboardDrag hook */
export interface KeyboardDragResult {
  /** Whether this item is being dragged via keyboard */
  isDragging: boolean;
  /** Current drag delta from origin */
  delta: Point;
  /** Current position */
  position: Point;
  /** Props to spread on the draggable element for keyboard support */
  keyboardDragProps: {
    tabIndex: number;
    role: string;
    "aria-grabbed": boolean;
    "aria-describedby": string;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** ID for screen reader instructions element */
  instructionsId: string;
  /** Screen reader instructions text */
  instructions: string;
}

/**
 * Hook for keyboard-based drag and drop
 *
 * Provides full keyboard accessibility:
 * - Space/Enter to start drag
 * - Arrow keys to move
 * - Space/Enter to drop
 * - Escape to cancel
 *
 * @example
 * ```tsx
 * function AccessibleDraggable({ id }: { id: string }) {
 *   const { isDragging, keyboardDragProps, instructionsId } = useKeyboardDrag({
 *     id,
 *     type: 'item',
 *     onDragEnd: (item, delta) => {
 *       // Handle drop
 *     },
 *   });
 *
 *   return (
 *     <>
 *       <div {...keyboardDragProps}>
 *         Draggable Item
 *       </div>
 *       <div id={instructionsId} style={{ display: 'none' }}>
 *         Press Space or Enter to grab. Use arrow keys to move.
 *         Press Space or Enter to drop. Press Escape to cancel.
 *       </div>
 *     </>
 *   );
 * }
 * ```
 */
export function useKeyboardDrag(
  config: KeyboardDragConfig,
): KeyboardDragResult {
  const {
    id,
    type,
    sourceId,
    data,
    disabled,
    options = {},
    onDragStart,
    onDrag,
    onDragEnd,
    onDragCancel,
  } = config;

  const startDrag = useDragStore((s) => s.startDrag);
  const updateDrag = useDragStore((s) => s.updateDrag);
  const endDrag = useDragStore((s) => s.endDrag);
  const isDragging = useDragStore((s) => s.isDragging && s.item?.id === id);
  const origin = useDragStore((s) => s.origin);
  const currentPosition = useDragStore((s) => s.current);
  const currentDelta = useDragStore((s) => s.delta);

  // Merge with defaults
  const mergedOptions: KeyboardSensorOptions = {
    ...DEFAULT_KEYBOARD_OPTIONS,
    ...options,
  };

  const instructionsId = `hs-kit-drag-instructions-${id}`;
  const accumulatedDeltaRef = useRef<Point>({ x: 0, y: 0 });
  const isFocusedRef = useRef(false);

  // Generate screen reader instructions
  const instructions = `Press Space or Enter to grab this item. Use arrow keys to move${
    mergedOptions.shiftMultiplier && mergedOptions.shiftMultiplier > 1
      ? ` (hold Shift to move ${mergedOptions.shiftMultiplier}x faster)`
      : ""
  }. Press Space or Enter to drop, or Escape to cancel.`;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      const key = e.key;

      if (!isDragging) {
        // Not dragging - check for start key
        if (isStartKey(key, options)) {
          e.preventDefault();

          const item: DragItem = {
            id,
            type,
            sourceId: sourceId || null,
            data,
          };

          // Start from element's center (approximation)
          const element = e.currentTarget as HTMLElement;
          const rect = element.getBoundingClientRect();
          const startPosition = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };

          accumulatedDeltaRef.current = { x: 0, y: 0 };
          startDrag(item, startPosition);
          onDragStart?.(item);
        }
      } else {
        // Currently dragging
        const item: DragItem = { id, type, sourceId: sourceId || null, data };

        // Check for cancel
        if (isCancelKey(key, options)) {
          e.preventDefault();
          endDrag();
          onDragCancel?.(item);
          return;
        }

        // Check for drop
        if (isDropKey(key, options)) {
          e.preventDefault();
          onDragEnd?.(item, accumulatedDeltaRef.current);
          endDrag();
          return;
        }

        // Check for movement
        const moveDelta = getKeyboardMovementDelta(key, options, e.shiftKey);
        if (moveDelta) {
          e.preventDefault();

          accumulatedDeltaRef.current = {
            x: accumulatedDeltaRef.current.x + moveDelta.x,
            y: accumulatedDeltaRef.current.y + moveDelta.y,
          };

          const newPosition = {
            x: origin.x + accumulatedDeltaRef.current.x,
            y: origin.y + accumulatedDeltaRef.current.y,
          };

          updateDrag(newPosition);
          onDrag?.(item, accumulatedDeltaRef.current);
        }
      }
    },
    [
      id,
      type,
      sourceId,
      data,
      disabled,
      options,
      isDragging,
      origin,
      startDrag,
      updateDrag,
      endDrag,
      onDragStart,
      onDrag,
      onDragEnd,
      onDragCancel,
    ],
  );

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    isFocusedRef.current = false;
    // Cancel drag if focus is lost while dragging
    if (isDragging) {
      endDrag();
      onDragCancel?.({ id, type, sourceId: sourceId || null, data });
    }
  }, [isDragging, id, type, sourceId, data, endDrag, onDragCancel]);

  // Handle global keyboard events when dragging (for drop target detection, etc.)
  useEffect(() => {
    if (!isDragging || !isFocusedRef.current) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Handle Tab key to cycle through drop targets
      if (e.key === "Tab" && isDragging) {
        // Let the browser handle focus, but we could enhance this
        // to cycle through valid drop targets
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isDragging]);

  return {
    isDragging,
    delta: isDragging ? currentDelta : { x: 0, y: 0 },
    position: isDragging ? currentPosition : { x: 0, y: 0 },
    keyboardDragProps: {
      tabIndex: disabled ? -1 : 0,
      role: "button",
      "aria-grabbed": isDragging,
      "aria-describedby": instructionsId,
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
    instructionsId,
    instructions,
  };
}
