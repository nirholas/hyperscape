/**
 * Sorting Strategies
 *
 * Defines how items are positioned in sortable containers.
 * These strategies calculate the index for placing items based on
 * pointer position and layout type.
 *
 * @packageDocumentation
 */

import type { Rect, Point } from "../../types";

/** Information about a sortable item */
export interface SortableItemInfo {
  /** Unique identifier */
  id: string;
  /** Current index in the container */
  index: number;
  /** Bounding rectangle of the item */
  rect: Rect;
  /** Whether this item is currently being dragged */
  disabled?: boolean;
}

/** Result from a sorting strategy */
export interface SortingResult {
  /** Target index for the dragged item */
  index: number;
  /** Which items should shift and how */
  itemsToShift: Array<{
    id: string;
    fromIndex: number;
    toIndex: number;
  }>;
}

/** Sorting strategy function type */
export type SortingStrategy = (
  items: SortableItemInfo[],
  activeIndex: number,
  overIndex: number,
  pointerPosition: Point,
) => SortingResult;

/**
 * Vertical list sorting strategy
 *
 * Used for lists that stack items vertically.
 * Determines insertion point based on Y coordinate.
 *
 * @example
 * ```tsx
 * <SortableContext items={items} strategy={verticalListSorting}>
 *   {items.map(item => <SortableItem key={item.id} id={item.id} />)}
 * </SortableContext>
 * ```
 */
export function verticalListSorting(
  items: SortableItemInfo[],
  activeIndex: number,
  overIndex: number,
  pointerPosition: Point,
): SortingResult {
  if (items.length === 0 || activeIndex === overIndex) {
    return { index: activeIndex, itemsToShift: [] };
  }

  // Find the target index based on pointer Y position
  let targetIndex = overIndex;
  const overItem = items[overIndex];

  if (overItem) {
    const midY = overItem.rect.y + overItem.rect.height / 2;
    // If pointer is above the midpoint, insert before; otherwise after
    if (pointerPosition.y < midY && overIndex > activeIndex) {
      targetIndex = Math.max(0, overIndex);
    } else if (pointerPosition.y >= midY && overIndex < activeIndex) {
      targetIndex = Math.min(items.length - 1, overIndex);
    }
  }

  // Calculate items to shift
  const itemsToShift: SortingResult["itemsToShift"] = [];

  if (targetIndex !== activeIndex) {
    if (targetIndex > activeIndex) {
      // Moving down: shift items up
      for (let i = activeIndex + 1; i <= targetIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i - 1,
          });
        }
      }
    } else {
      // Moving up: shift items down
      for (let i = targetIndex; i < activeIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i + 1,
          });
        }
      }
    }
  }

  return { index: targetIndex, itemsToShift };
}

/**
 * Horizontal list sorting strategy
 *
 * Used for lists that arrange items horizontally.
 * Determines insertion point based on X coordinate.
 *
 * @example
 * ```tsx
 * <SortableContext items={items} strategy={horizontalListSorting}>
 *   {items.map(item => <SortableItem key={item.id} id={item.id} />)}
 * </SortableContext>
 * ```
 */
export function horizontalListSorting(
  items: SortableItemInfo[],
  activeIndex: number,
  overIndex: number,
  pointerPosition: Point,
): SortingResult {
  if (items.length === 0 || activeIndex === overIndex) {
    return { index: activeIndex, itemsToShift: [] };
  }

  // Find the target index based on pointer X position
  let targetIndex = overIndex;
  const overItem = items[overIndex];

  if (overItem) {
    const midX = overItem.rect.x + overItem.rect.width / 2;
    // If pointer is left of the midpoint, insert before; otherwise after
    if (pointerPosition.x < midX && overIndex > activeIndex) {
      targetIndex = Math.max(0, overIndex);
    } else if (pointerPosition.x >= midX && overIndex < activeIndex) {
      targetIndex = Math.min(items.length - 1, overIndex);
    }
  }

  // Calculate items to shift
  const itemsToShift: SortingResult["itemsToShift"] = [];

  if (targetIndex !== activeIndex) {
    if (targetIndex > activeIndex) {
      // Moving right: shift items left
      for (let i = activeIndex + 1; i <= targetIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i - 1,
          });
        }
      }
    } else {
      // Moving left: shift items right
      for (let i = targetIndex; i < activeIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i + 1,
          });
        }
      }
    }
  }

  return { index: targetIndex, itemsToShift };
}

/**
 * Grid/rect sorting strategy
 *
 * Used for grid layouts where items are arranged in rows and columns.
 * Determines insertion point based on both X and Y coordinates.
 *
 * @param columns - Number of columns in the grid (auto-detected if not provided)
 *
 * @example
 * ```tsx
 * <SortableContext items={items} strategy={rectSorting}>
 *   <div className="grid grid-cols-4">
 *     {items.map(item => <SortableItem key={item.id} id={item.id} />)}
 *   </div>
 * </SortableContext>
 * ```
 */
/**
 * Detect the number of columns in a grid layout
 * by analyzing item positions
 */
function detectGridColumns(items: SortableItemInfo[]): number {
  if (items.length < 2) return 1;

  // Find items in the first row (same Y position with tolerance)
  const firstItemY = items[0].rect.y;
  const tolerance = items[0].rect.height * 0.5;
  let columnsInFirstRow = 1;

  for (let i = 1; i < items.length; i++) {
    if (Math.abs(items[i].rect.y - firstItemY) < tolerance) {
      columnsInFirstRow++;
    } else {
      break;
    }
  }

  return Math.max(1, columnsInFirstRow);
}

/**
 * Get the row and column position of an item in a grid
 */
function getGridPosition(
  index: number,
  columns: number,
): { row: number; col: number } {
  return {
    row: Math.floor(index / columns),
    col: index % columns,
  };
}

export function rectSorting(
  items: SortableItemInfo[],
  activeIndex: number,
  overIndex: number,
  pointerPosition: Point,
): SortingResult {
  if (items.length === 0 || activeIndex === overIndex) {
    return { index: activeIndex, itemsToShift: [] };
  }

  // Detect grid layout
  const columns = detectGridColumns(items);
  const activeGridPos = getGridPosition(activeIndex, columns);
  const overGridPos = getGridPosition(overIndex, columns);

  // Calculate target index based on pointer position
  let targetIndex = overIndex;
  const overItem = items[overIndex];

  if (overItem) {
    const midX = overItem.rect.x + overItem.rect.width / 2;
    const midY = overItem.rect.y + overItem.rect.height / 2;

    // For grid sorting, we consider both X and Y
    const isLeftOf = pointerPosition.x < midX;
    const isAbove = pointerPosition.y < midY;

    // Grid-aware sorting: consider row transitions
    const sameRow = activeGridPos.row === overGridPos.row;

    // Determine if we should adjust the target index based on grid position
    if (overIndex > activeIndex) {
      if (sameRow) {
        // Same row: use horizontal position
        if (isLeftOf) {
          targetIndex = Math.max(0, overIndex - 1);
        }
      } else {
        // Different row: use vertical position primarily
        if (isAbove) {
          // If above the midpoint and we're moving down, stay at current row's end
          const rowStart = overGridPos.row * columns;
          targetIndex = Math.max(rowStart, overIndex);
        }
      }
    } else if (overIndex < activeIndex) {
      if (sameRow) {
        // Same row: use horizontal position
        if (!isLeftOf) {
          targetIndex = Math.min(items.length - 1, overIndex + 1);
        }
      } else {
        // Different row: use vertical position primarily
        if (!isAbove) {
          // If below the midpoint and we're moving up, jump to next row's start
          const nextRowStart = (overGridPos.row + 1) * columns;
          targetIndex = Math.min(
            items.length - 1,
            Math.min(nextRowStart - 1, overIndex),
          );
        }
      }
    }
  }

  // Calculate items to shift
  const itemsToShift: SortingResult["itemsToShift"] = [];

  if (targetIndex !== activeIndex) {
    if (targetIndex > activeIndex) {
      for (let i = activeIndex + 1; i <= targetIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i - 1,
          });
        }
      }
    } else {
      for (let i = targetIndex; i < activeIndex; i++) {
        if (items[i] && !items[i].disabled) {
          itemsToShift.push({
            id: items[i].id,
            fromIndex: i,
            toIndex: i + 1,
          });
        }
      }
    }
  }

  return { index: targetIndex, itemsToShift };
}

/**
 * Calculate the visual transform for a sortable item
 * based on the sorting result
 */
export function calculateSortableTransform(
  itemId: string,
  items: SortableItemInfo[],
  activeId: string | null,
  overIndex: number,
  strategy: SortingStrategy,
  pointerPosition: Point,
): { x: number; y: number } | null {
  if (!activeId) return null;

  const activeIndex = items.findIndex((item) => item.id === activeId);
  if (activeIndex === -1) return null;

  // If this is the active item, no transform (DragOverlay handles it)
  if (itemId === activeId) return null;

  const result = strategy(items, activeIndex, overIndex, pointerPosition);

  // Find if this item needs to shift
  const shift = result.itemsToShift.find((s) => s.id === itemId);
  if (!shift) return null;

  const fromItem = items[shift.fromIndex];
  const toItem = items[shift.toIndex];

  if (!fromItem || !toItem) return null;

  return {
    x: toItem.rect.x - fromItem.rect.x,
    y: toItem.rect.y - fromItem.rect.y,
  };
}

/**
 * Default animation transition CSS
 */
export const SORTABLE_TRANSITION = "transform 200ms ease";
