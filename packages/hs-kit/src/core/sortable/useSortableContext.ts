/**
 * useSortableContext Hook
 *
 * Internal hook for managing sortable container state.
 * Tracks item positions, sorting state, and coordinates with dragStore.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useDragStore } from "../../stores/dragStore";
import type { Point, Rect } from "../../types";
import type {
  SortableItemInfo,
  SortingStrategy,
  SortingResult,
} from "./sortingStrategies";
import { verticalListSorting } from "./sortingStrategies";

/** Item descriptor for sortable context */
export interface SortableItem {
  /** Unique identifier for the item */
  id: string;
  /** Optional data attached to the item */
  data?: Record<string, unknown>;
  /** Whether this item is disabled (cannot be sorted) */
  disabled?: boolean;
}

/** Configuration for sortable context */
export interface UseSortableContextConfig {
  /** Unique identifier for this sortable container */
  id: string;

  /** Array of sortable items or item IDs */
  items: Array<string | SortableItem>;

  /** Sorting strategy to use */
  strategy?: SortingStrategy;

  /** Whether sorting is disabled */
  disabled?: boolean;

  /** Callback when items are reordered */
  onReorder?: (activeId: string, overId: string, newIndex: number) => void;

  /** Callback when item is moved to another container */
  onMoveToContainer?: (
    itemId: string,
    targetContainerId: string,
    newIndex: number,
  ) => void;
}

/** State of a sortable container */
export interface SortableContextState {
  /** Container ID */
  containerId: string;

  /** Current items with their info */
  items: SortableItemInfo[];

  /** Active (dragging) item ID */
  activeId: string | null;

  /** Item being hovered over */
  overId: string | null;

  /** Target index for insertion */
  targetIndex: number;

  /** Current sorting result */
  sortingResult: SortingResult | null;

  /** Whether this container is the source of the drag */
  isSourceContainer: boolean;

  /** Whether a sortable item is being dragged over this container */
  isOverContainer: boolean;
}

/** Actions available from sortable context */
export interface SortableContextActions {
  /** Register an item's element */
  registerItem: (id: string, element: HTMLElement) => void;

  /** Unregister an item */
  unregisterItem: (id: string) => void;

  /** Update an item's rect */
  updateItemRect: (id: string, rect: Rect) => void;

  /** Get the index of an item */
  getItemIndex: (id: string) => number;

  /** Get item info by ID */
  getItemInfo: (id: string) => SortableItemInfo | undefined;

  /** Check if an item is being dragged */
  isItemDragging: (id: string) => boolean;

  /** Get transform for an item based on current sorting */
  getItemTransform: (id: string) => { x: number; y: number } | null;

  /** Start drag for a sortable item */
  startSortableDrag: (id: string, origin: Point) => void;

  /** End the current sort operation */
  endSortableDrag: () => void;
}

/** Return type from useSortableContext */
export interface UseSortableContextReturn {
  /** Current state */
  state: SortableContextState;

  /** Available actions */
  actions: SortableContextActions;
}

/**
 * Internal hook for managing sortable context state
 *
 * This hook is used by SortableContext provider and should not
 * be used directly. Use useSortable for individual items.
 */
export function useSortableContext(
  config: UseSortableContextConfig,
): UseSortableContextReturn {
  const {
    id: containerId,
    items: itemsConfig,
    strategy = verticalListSorting,
    disabled = false,
    onReorder,
    onMoveToContainer,
  } = config;

  // Drag store state
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const current = useDragStore((s) => s.current);
  const overTargets = useDragStore((s) => s.overTargets);
  const startDrag = useDragStore((s) => s.startDrag);
  const endDrag = useDragStore((s) => s.endDrag);

  // Local state for item rects
  const [itemElements, setItemElements] = useState<Map<string, HTMLElement>>(
    new Map(),
  );
  const [itemRects, setItemRects] = useState<Map<string, Rect>>(new Map());

  // Refs for callbacks
  const callbacksRef = useRef({ onReorder, onMoveToContainer });
  callbacksRef.current = { onReorder, onMoveToContainer };

  // Normalize items to SortableItem array
  const normalizedItems = useMemo((): SortableItem[] => {
    return itemsConfig.map((item) => {
      if (typeof item === "string") {
        return { id: item };
      }
      return item;
    });
  }, [itemsConfig]);

  // Build item info array with current rects
  const items = useMemo((): SortableItemInfo[] => {
    return normalizedItems.map((item, index) => ({
      id: item.id,
      index,
      rect: itemRects.get(item.id) || { x: 0, y: 0, width: 0, height: 0 },
      disabled: item.disabled,
    }));
  }, [normalizedItems, itemRects]);

  // Determine active item
  const activeId = useMemo(() => {
    if (!isDragging || !dragItem) return null;
    // Check if the active item belongs to this container
    const isInContainer = normalizedItems.some(
      (item) => item.id === dragItem.id,
    );
    return isInContainer ? dragItem.id : null;
  }, [isDragging, dragItem, normalizedItems]);

  // Determine over item
  const overId = useMemo(() => {
    if (!isDragging) return null;
    // Find which item in this container is being hovered
    for (const targetId of overTargets) {
      if (normalizedItems.some((item) => item.id === targetId)) {
        return targetId;
      }
    }
    return null;
  }, [isDragging, overTargets, normalizedItems]);

  // Calculate target index and sorting result
  const { targetIndex, sortingResult } = useMemo(() => {
    if (!activeId || !isDragging) {
      return { targetIndex: -1, sortingResult: null };
    }

    const activeIndex = items.findIndex((item) => item.id === activeId);
    let overIndex = activeIndex;

    if (overId) {
      const foundOverIndex = items.findIndex((item) => item.id === overId);
      if (foundOverIndex !== -1) {
        overIndex = foundOverIndex;
      }
    }

    const result = strategy(items, activeIndex, overIndex, current);
    return { targetIndex: result.index, sortingResult: result };
  }, [activeId, isDragging, items, overId, current, strategy]);

  // Check if this is the source container
  const isSourceContainer = useMemo(() => {
    if (!isDragging || !dragItem) return false;
    const sourceData = dragItem.data as { containerId?: string } | undefined;
    return sourceData?.containerId === containerId;
  }, [isDragging, dragItem, containerId]);

  // Check if container is being hovered
  const isOverContainer = useMemo(() => {
    return overTargets.includes(containerId) || overId !== null;
  }, [overTargets, containerId, overId]);

  // Register item element
  const registerItem = useCallback((id: string, element: HTMLElement) => {
    setItemElements((prev) => {
      const next = new Map(prev);
      next.set(id, element);
      return next;
    });

    // Initial rect calculation
    const rect = element.getBoundingClientRect();
    setItemRects((prev) => {
      const next = new Map(prev);
      next.set(id, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
      return next;
    });
  }, []);

  // Unregister item
  const unregisterItem = useCallback((id: string) => {
    setItemElements((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setItemRects((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Update item rect
  const updateItemRect = useCallback((id: string, rect: Rect) => {
    setItemRects((prev) => {
      const next = new Map(prev);
      next.set(id, rect);
      return next;
    });
  }, []);

  // Get item index
  const getItemIndex = useCallback(
    (id: string): number => {
      return items.findIndex((item) => item.id === id);
    },
    [items],
  );

  // Get item info
  const getItemInfo = useCallback(
    (id: string): SortableItemInfo | undefined => {
      return items.find((item) => item.id === id);
    },
    [items],
  );

  // Check if item is dragging
  const isItemDragging = useCallback(
    (id: string): boolean => {
      return activeId === id;
    },
    [activeId],
  );

  // Get item transform
  const getItemTransform = useCallback(
    (id: string): { x: number; y: number } | null => {
      if (!sortingResult || !activeId || id === activeId) return null;

      const shift = sortingResult.itemsToShift.find((s) => s.id === id);
      if (!shift) return null;

      const fromItem = items[shift.fromIndex];
      const toItem = items[shift.toIndex];

      if (!fromItem || !toItem) return null;

      return {
        x: toItem.rect.x - fromItem.rect.x,
        y: toItem.rect.y - fromItem.rect.y,
      };
    },
    [sortingResult, activeId, items],
  );

  // Start sortable drag
  const startSortableDrag = useCallback(
    (id: string, origin: Point) => {
      if (disabled) return;

      const item = normalizedItems.find((i) => i.id === id);
      if (!item || item.disabled) return;

      startDrag(
        {
          id,
          type: "item",
          sourceId: containerId,
          data: {
            containerId,
            index: getItemIndex(id),
            ...item.data,
          },
        },
        origin,
      );
    },
    [disabled, normalizedItems, containerId, getItemIndex, startDrag],
  );

  // End sortable drag
  const endSortableDrag = useCallback(() => {
    if (!activeId || !sortingResult) {
      endDrag();
      return;
    }

    const activeIndex = getItemIndex(activeId);
    const newIndex = sortingResult.index;

    if (activeIndex !== newIndex && callbacksRef.current.onReorder) {
      callbacksRef.current.onReorder(activeId, overId || activeId, newIndex);
    }

    endDrag();
  }, [activeId, sortingResult, overId, getItemIndex, endDrag]);

  // Update rects on scroll/resize
  useEffect(() => {
    const updateAllRects = () => {
      itemElements.forEach((element, id) => {
        const rect = element.getBoundingClientRect();
        updateItemRect(id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      });
    };

    window.addEventListener("scroll", updateAllRects, true);
    window.addEventListener("resize", updateAllRects);

    return () => {
      window.removeEventListener("scroll", updateAllRects, true);
      window.removeEventListener("resize", updateAllRects);
    };
  }, [itemElements, updateItemRect]);

  // Build state
  const state: SortableContextState = {
    containerId,
    items,
    activeId,
    overId,
    targetIndex,
    sortingResult,
    isSourceContainer,
    isOverContainer,
  };

  // Build actions
  const actions: SortableContextActions = {
    registerItem,
    unregisterItem,
    updateItemRect,
    getItemIndex,
    getItemInfo,
    isItemDragging,
    getItemTransform,
    startSortableDrag,
    endSortableDrag,
  };

  return { state, actions };
}
