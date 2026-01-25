/**
 * SortableContext Provider
 *
 * Provides context for sortable items within a container.
 * This is the hs-kit equivalent of @dnd-kit's SortableContext.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, type ReactNode } from "react";
import {
  useSortableContext,
  type UseSortableContextConfig,
  type SortableContextState,
  type SortableContextActions,
  type SortableItem,
} from "./useSortableContext";
import type { SortingStrategy } from "./sortingStrategies";
import { verticalListSorting } from "./sortingStrategies";

/** Context value for SortableContext */
export interface SortableContextValue {
  /** Current state */
  state: SortableContextState;
  /** Available actions */
  actions: SortableContextActions;
}

const SortableContextInternal = createContext<SortableContextValue | null>(
  null,
);

/** Props for SortableContext */
export interface SortableContextProps {
  /**
   * Unique identifier for this sortable container.
   * Required for multi-container sorting.
   */
  id: string;

  /**
   * Items in this sortable container.
   * Can be an array of IDs or SortableItem objects.
   *
   * @example
   * // Simple ID array
   * <SortableContext id="list" items={['a', 'b', 'c']} />
   *
   * // With metadata
   * <SortableContext id="list" items={[
   *   { id: 'a', data: { name: 'Item A' } },
   *   { id: 'b', data: { name: 'Item B' }, disabled: true },
   * ]} />
   */
  items: Array<string | SortableItem>;

  /**
   * Sorting strategy to use.
   * @default verticalListSorting
   *
   * Available strategies:
   * - verticalListSorting: For vertical lists
   * - horizontalListSorting: For horizontal lists
   * - rectSorting: For grid layouts
   */
  strategy?: SortingStrategy;

  /**
   * Whether sorting is disabled for this container.
   * @default false
   */
  disabled?: boolean;

  /**
   * Callback when items are reordered within this container.
   *
   * @param activeId - ID of the item being dragged
   * @param overId - ID of the item being hovered
   * @param newIndex - New index for the dragged item
   */
  onReorder?: (activeId: string, overId: string, newIndex: number) => void;

  /**
   * Callback when an item is moved to another container.
   * Used for multi-container sorting scenarios.
   *
   * @param itemId - ID of the item being moved
   * @param targetContainerId - ID of the target container
   * @param newIndex - Index in the target container
   */
  onMoveToContainer?: (
    itemId: string,
    targetContainerId: string,
    newIndex: number,
  ) => void;

  /** Child elements */
  children: ReactNode;
}

/**
 * Provider for sortable items
 *
 * Wraps sortable items and provides the context needed for sorting.
 * Items within this context can be reordered by dragging.
 *
 * @example
 * ```tsx
 * function SortableList({ items, onReorder }: Props) {
 *   return (
 *     <SortableContext
 *       id="my-list"
 *       items={items.map(i => i.id)}
 *       strategy={verticalListSorting}
 *       onReorder={(activeId, overId, newIndex) => {
 *         onReorder(arrayMove(items, oldIndex, newIndex));
 *       }}
 *     >
 *       {items.map((item) => (
 *         <SortableItem key={item.id} id={item.id}>
 *           {item.name}
 *         </SortableItem>
 *       ))}
 *     </SortableContext>
 *   );
 * }
 * ```
 */
export function SortableContext({
  id,
  items,
  strategy = verticalListSorting,
  disabled = false,
  onReorder,
  onMoveToContainer,
  children,
}: SortableContextProps): React.ReactElement {
  const config: UseSortableContextConfig = {
    id,
    items,
    strategy,
    disabled,
    onReorder,
    onMoveToContainer,
  };

  const { state, actions } = useSortableContext(config);

  const contextValue: SortableContextValue = {
    state,
    actions,
  };

  // React 19: Context can be used directly as a provider
  return (
    <SortableContextInternal value={contextValue}>
      {children}
    </SortableContextInternal>
  );
}

/**
 * Hook to access sortable context
 *
 * Must be used within a SortableContext provider.
 *
 * @throws Error if used outside SortableContext
 */
export function useSortableContextValue(): SortableContextValue {
  const context = useContext(SortableContextInternal);
  if (!context) {
    throw new Error(
      "useSortableContextValue must be used within a SortableContext",
    );
  }
  return context;
}

/**
 * Hook to check if within a sortable context
 *
 * Returns null if not within a SortableContext, allowing
 * for optional sortable functionality.
 */
export function useMaybeSortableContext(): SortableContextValue | null {
  return useContext(SortableContextInternal);
}
