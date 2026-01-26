/**
 * Virtual List Hook
 *
 * Efficient virtualization for lists with 1000+ items.
 * Supports both fixed and variable height items with overscan
 * for smooth scrolling.
 *
 * @packageDocumentation
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type RefObject,
} from "react";

/** Item measurement for variable height lists */
export interface ItemMeasurement {
  /** Index of the item */
  index: number;
  /** Offset from start of list */
  offset: number;
  /** Height of the item */
  height: number;
}

/** Range of visible items */
export interface VirtualRange {
  /** First visible item index (with overscan) */
  startIndex: number;
  /** Last visible item index (with overscan) */
  endIndex: number;
  /** First visible item without overscan */
  visibleStartIndex: number;
  /** Last visible item without overscan */
  visibleEndIndex: number;
}

/** Virtual item with positioning info */
export interface VirtualItem {
  /** Index in the original data array */
  index: number;
  /** Offset from the top of the list in pixels */
  offset: number;
  /** Height of this item in pixels */
  height: number;
  /** Whether this item is currently visible (not just in overscan) */
  isVisible: boolean;
}

/** Options for useVirtualList hook */
export interface UseVirtualListOptions<T> {
  /** Total number of items */
  itemCount: number;
  /** Fixed item height (use for best performance) */
  itemHeight?: number;
  /** Function to estimate item height for variable heights */
  estimateItemHeight?: (index: number, item: T | undefined) => number;
  /** Number of items to render beyond visible area */
  overscan?: number;
  /** Initial scroll offset */
  initialScrollOffset?: number;
  /** Callback when scroll changes */
  onScroll?: (offset: number) => void;
  /** Callback when visible range changes */
  onRangeChange?: (range: VirtualRange) => void;
  /** Enable smooth scroll behavior */
  smoothScroll?: boolean;
  /** Items data for variable height estimation */
  items?: T[];
}

/** Result from useVirtualList hook */
export interface UseVirtualListResult {
  /** Ref to attach to the scroll container */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Total height of all items */
  totalHeight: number;
  /** Virtual items to render */
  virtualItems: VirtualItem[];
  /** Current visible range */
  range: VirtualRange;
  /** Current scroll offset */
  scrollOffset: number;
  /** Scroll to a specific index */
  scrollToIndex: (index: number, options?: ScrollToOptions) => void;
  /** Scroll to a specific offset */
  scrollToOffset: (offset: number, options?: ScrollToOptions) => void;
  /** Force re-measure all items */
  measureAll: () => void;
  /** Measure a specific item */
  measureItem: (index: number, height: number) => void;
  /** Check if currently scrolling */
  isScrolling: boolean;
}

/** Options for scroll operations */
export interface ScrollToOptions {
  /** Alignment of the target item */
  align?: "start" | "center" | "end" | "auto";
  /** Use smooth scrolling */
  smooth?: boolean;
}

/**
 * Hook for virtualizing lists with efficient rendering of large datasets.
 *
 * @example
 * ```tsx
 * function VirtualizedInventory({ items }) {
 *   const { containerRef, virtualItems, totalHeight } = useVirtualList({
 *     itemCount: items.length,
 *     itemHeight: 40,
 *     overscan: 5,
 *   });
 *
 *   return (
 *     <div ref={containerRef} style={{ height: 400, overflow: 'auto' }}>
 *       <div style={{ height: totalHeight, position: 'relative' }}>
 *         {virtualItems.map(({ index, offset, height }) => (
 *           <div
 *             key={index}
 *             style={{
 *               position: 'absolute',
 *               top: offset,
 *               height,
 *               width: '100%',
 *             }}
 *           >
 *             {items[index].name}
 *           </div>
 *         ))}
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVirtualList<T = unknown>(
  options: UseVirtualListOptions<T>,
): UseVirtualListResult {
  const {
    itemCount,
    itemHeight: fixedItemHeight,
    estimateItemHeight,
    overscan = 3,
    initialScrollOffset = 0,
    onScroll,
    onRangeChange,
    smoothScroll = false,
    items,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(initialScrollOffset);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Store measured heights for variable height items
  const measuredHeights = useRef<Map<number, number>>(new Map());
  const measurementCache = useRef<{
    offsets: number[];
    totalHeight: number;
    version: number;
  }>({ offsets: [], totalHeight: 0, version: 0 });

  // Default height estimation
  const defaultHeight = fixedItemHeight ?? 40;

  /** Get height for an item (measured or estimated) */
  const getItemHeight = useCallback(
    (index: number): number => {
      if (fixedItemHeight !== undefined) {
        return fixedItemHeight;
      }

      const measured = measuredHeights.current.get(index);
      if (measured !== undefined) {
        return measured;
      }

      if (estimateItemHeight) {
        return estimateItemHeight(index, items?.[index]);
      }

      return defaultHeight;
    },
    [fixedItemHeight, estimateItemHeight, items, defaultHeight],
  );

  /** Calculate offsets for all items */
  const calculateOffsets = useCallback((): {
    offsets: number[];
    totalHeight: number;
  } => {
    const offsets: number[] = [];
    let offset = 0;

    for (let i = 0; i < itemCount; i++) {
      offsets.push(offset);
      offset += getItemHeight(i);
    }

    return { offsets, totalHeight: offset };
  }, [itemCount, getItemHeight]);

  /** Get cached or recalculate offsets */
  const getOffsets = useCallback((): {
    offsets: number[];
    totalHeight: number;
  } => {
    // Invalidate cache when item count changes or measurements change
    const cacheVersion =
      itemCount + measuredHeights.current.size + (fixedItemHeight ?? 0);

    if (measurementCache.current.version !== cacheVersion) {
      const result = calculateOffsets();
      measurementCache.current = {
        ...result,
        version: cacheVersion,
      };
    }

    return measurementCache.current;
  }, [calculateOffsets, itemCount, fixedItemHeight]);

  /** Binary search to find item at offset */
  const findItemAtOffset = useCallback(
    (offset: number, offsets: number[]): number => {
      let low = 0;
      let high = offsets.length - 1;

      while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (offsets[mid] <= offset) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }

      return Math.max(0, Math.min(low, itemCount - 1));
    },
    [itemCount],
  );

  /** Calculate visible range */
  const calculateRange = useCallback((): VirtualRange => {
    if (itemCount === 0 || containerHeight === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        visibleStartIndex: 0,
        visibleEndIndex: 0,
      };
    }

    const { offsets } = getOffsets();

    const visibleStartIndex = findItemAtOffset(scrollOffset, offsets);
    const visibleEndIndex = findItemAtOffset(
      scrollOffset + containerHeight,
      offsets,
    );

    const startIndex = Math.max(0, visibleStartIndex - overscan);
    const endIndex = Math.min(itemCount - 1, visibleEndIndex + overscan);

    return {
      startIndex,
      endIndex,
      visibleStartIndex,
      visibleEndIndex,
    };
  }, [
    itemCount,
    containerHeight,
    scrollOffset,
    overscan,
    getOffsets,
    findItemAtOffset,
  ]);

  const range = useMemo(() => calculateRange(), [calculateRange]);

  // Notify on range change
  useEffect(() => {
    onRangeChange?.(range);
  }, [range, onRangeChange]);

  /** Generate virtual items for the current range */
  const virtualItems = useMemo((): VirtualItem[] => {
    if (itemCount === 0) return [];

    const { offsets } = getOffsets();
    const result: VirtualItem[] = [];

    for (let i = range.startIndex; i <= range.endIndex; i++) {
      const height = getItemHeight(i);
      result.push({
        index: i,
        offset: offsets[i],
        height,
        isVisible: i >= range.visibleStartIndex && i <= range.visibleEndIndex,
      });
    }

    return result;
  }, [itemCount, range, getOffsets, getItemHeight]);

  /** Total height of all items */
  const totalHeight = useMemo(() => getOffsets().totalHeight, [getOffsets]);

  /** Handle scroll events */
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const newOffset = container.scrollTop;
    setScrollOffset(newOffset);
    setIsScrolling(true);

    onScroll?.(newOffset);

    // Clear existing timeout
    if (scrollingTimeoutRef.current) {
      clearTimeout(scrollingTimeoutRef.current);
    }

    // Set scrolling to false after scroll stops
    scrollingTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, [onScroll]);

  /** Update container height on resize */
  const updateContainerSize = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      setContainerHeight(container.clientHeight);
    }
  }, []);

  // Set up scroll listener and ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll, { passive: true });
    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current);
      }
    };
  }, [handleScroll, updateContainerSize]);

  /** Scroll to a specific index */
  const scrollToIndex = useCallback(
    (index: number, scrollOptions?: ScrollToOptions) => {
      const container = containerRef.current;
      if (!container || itemCount === 0) return;

      const { offsets } = getOffsets();
      const clampedIndex = Math.max(0, Math.min(index, itemCount - 1));
      const itemOffset = offsets[clampedIndex];
      const itemHeightValue = getItemHeight(clampedIndex);

      let targetOffset: number;

      switch (scrollOptions?.align) {
        case "start":
          targetOffset = itemOffset;
          break;
        case "center":
          targetOffset = itemOffset - containerHeight / 2 + itemHeightValue / 2;
          break;
        case "end":
          targetOffset = itemOffset - containerHeight + itemHeightValue;
          break;
        case "auto":
        default:
          // Scroll only if item is not visible
          if (
            itemOffset < scrollOffset ||
            itemOffset + itemHeightValue > scrollOffset + containerHeight
          ) {
            if (itemOffset < scrollOffset) {
              targetOffset = itemOffset;
            } else {
              targetOffset = itemOffset - containerHeight + itemHeightValue;
            }
          } else {
            return; // Already visible
          }
      }

      targetOffset = Math.max(
        0,
        Math.min(targetOffset, totalHeight - containerHeight),
      );

      container.scrollTo({
        top: targetOffset,
        behavior:
          (scrollOptions?.smooth ?? smoothScroll) ? "smooth" : "instant",
      });
    },
    [
      itemCount,
      getOffsets,
      getItemHeight,
      containerHeight,
      scrollOffset,
      totalHeight,
      smoothScroll,
    ],
  );

  /** Scroll to a specific offset */
  const scrollToOffset = useCallback(
    (offset: number, scrollOptions?: ScrollToOptions) => {
      const container = containerRef.current;
      if (!container) return;

      const clampedOffset = Math.max(
        0,
        Math.min(offset, totalHeight - containerHeight),
      );

      container.scrollTo({
        top: clampedOffset,
        behavior:
          (scrollOptions?.smooth ?? smoothScroll) ? "smooth" : "instant",
      });
    },
    [totalHeight, containerHeight, smoothScroll],
  );

  /** Force re-measure all items */
  const measureAll = useCallback(() => {
    measuredHeights.current.clear();
    measurementCache.current.version = -1;
  }, []);

  /** Measure a specific item */
  const measureItem = useCallback((index: number, height: number) => {
    const existing = measuredHeights.current.get(index);
    if (existing !== height) {
      measuredHeights.current.set(index, height);
      measurementCache.current.version = -1;
    }
  }, []);

  return {
    containerRef,
    totalHeight,
    virtualItems,
    range,
    scrollOffset,
    scrollToIndex,
    scrollToOffset,
    measureAll,
    measureItem,
    isScrolling,
  };
}

export default useVirtualList;
