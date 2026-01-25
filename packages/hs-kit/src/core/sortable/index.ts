/**
 * Sortable System
 *
 * Complete sortable system with @dnd-kit compatible API.
 * Provides drag-to-reorder functionality for lists and grids.
 *
 * @packageDocumentation
 */

// Main sortable hook
export {
  useSortable,
  type UseSortableConfig,
  type UseSortableReturn,
} from "./useSortable";

// Context hook (internal)
export {
  useSortableContext,
  type UseSortableContextConfig,
  type UseSortableContextReturn,
  type SortableContextState,
  type SortableContextActions,
  type SortableItem,
} from "./useSortableContext";

// Context provider
export {
  SortableContext,
  useSortableContextValue,
  useMaybeSortableContext,
  type SortableContextProps,
  type SortableContextValue,
} from "./SortableContext";

// Sorting strategies
export {
  verticalListSorting,
  horizontalListSorting,
  rectSorting,
  calculateSortableTransform,
  SORTABLE_TRANSITION,
  type SortableItemInfo,
  type SortingResult,
  type SortingStrategy,
} from "./sortingStrategies";

// Utility functions
/**
 * Move an item in an array from one index to another
 *
 * @param array - The array to modify
 * @param from - Source index
 * @param to - Target index
 * @returns New array with the item moved
 *
 * @example
 * ```ts
 * const items = ['a', 'b', 'c', 'd'];
 * const reordered = arrayMove(items, 0, 2);
 * // reordered = ['b', 'c', 'a', 'd']
 * ```
 */
export function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const newArray = [...array];
  const [item] = newArray.splice(from, 1);
  newArray.splice(to, 0, item);
  return newArray;
}

/**
 * Swap two items in an array
 *
 * @param array - The array to modify
 * @param indexA - First index
 * @param indexB - Second index
 * @returns New array with items swapped
 *
 * @example
 * ```ts
 * const items = ['a', 'b', 'c'];
 * const swapped = arraySwap(items, 0, 2);
 * // swapped = ['c', 'b', 'a']
 * ```
 */
export function arraySwap<T>(array: T[], indexA: number, indexB: number): T[] {
  const newArray = [...array];
  const temp = newArray[indexA];
  newArray[indexA] = newArray[indexB];
  newArray[indexB] = temp;
  return newArray;
}
