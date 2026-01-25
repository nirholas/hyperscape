/**
 * Virtual Grid Hook
 *
 * Efficient virtualization for grid layouts (inventories, item grids).
 * Optimized for fixed-size cells with row-based rendering.
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

/** Grid cell with positioning info */
export interface VirtualCell {
  /** Index in the original data array */
  index: number;
  /** Row index in the grid */
  row: number;
  /** Column index in the grid */
  column: number;
  /** X offset from left edge */
  offsetX: number;
  /** Y offset from top edge */
  offsetY: number;
  /** Width of this cell */
  width: number;
  /** Height of this cell */
  height: number;
  /** Whether this cell is currently visible (not just in overscan) */
  isVisible: boolean;
}

/** Range of visible rows/columns */
export interface VirtualGridRange {
  /** First visible row (with overscan) */
  startRow: number;
  /** Last visible row (with overscan) */
  endRow: number;
  /** First visible column (with overscan) */
  startColumn: number;
  /** Last visible column (with overscan) */
  endColumn: number;
  /** Visible range without overscan */
  visible: {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  };
}

/** Options for useVirtualGrid hook */
export interface UseVirtualGridOptions {
  /** Total number of items */
  itemCount: number;
  /** Number of columns (or 'auto' to calculate based on container width) */
  columns: number | "auto";
  /** Cell width in pixels */
  cellWidth: number;
  /** Cell height in pixels */
  cellHeight: number;
  /** Gap between cells in pixels */
  gap?: number;
  /** Horizontal gap (overrides gap for horizontal) */
  gapX?: number;
  /** Vertical gap (overrides gap for vertical) */
  gapY?: number;
  /** Number of rows to render beyond visible area */
  overscan?: number;
  /** Initial scroll offset */
  initialScrollOffset?: number;
  /** Callback when scroll changes */
  onScroll?: (offset: number) => void;
  /** Callback when visible range changes */
  onRangeChange?: (range: VirtualGridRange) => void;
  /** Enable smooth scroll behavior */
  smoothScroll?: boolean;
  /** Padding around the grid */
  padding?: number;
}

/** Result from useVirtualGrid hook */
export interface UseVirtualGridResult {
  /** Ref to attach to the scroll container */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Total height of the grid content */
  totalHeight: number;
  /** Total width of the grid content */
  totalWidth: number;
  /** Calculated number of columns */
  columnCount: number;
  /** Total number of rows */
  rowCount: number;
  /** Virtual cells to render */
  virtualCells: VirtualCell[];
  /** Current visible range */
  range: VirtualGridRange;
  /** Current scroll offset (Y) */
  scrollOffset: number;
  /** Scroll to a specific item index */
  scrollToIndex: (index: number, options?: GridScrollToOptions) => void;
  /** Scroll to a specific cell */
  scrollToCell: (
    row: number,
    column: number,
    options?: GridScrollToOptions,
  ) => void;
  /** Scroll to a specific offset */
  scrollToOffset: (offset: number, options?: GridScrollToOptions) => void;
  /** Check if currently scrolling */
  isScrolling: boolean;
  /** Get cell position for an index */
  getCellPosition: (index: number) => { row: number; column: number } | null;
  /** Get index from cell position */
  getIndexFromCell: (row: number, column: number) => number | null;
}

/** Options for grid scroll operations */
export interface GridScrollToOptions {
  /** Alignment of the target cell */
  align?: "start" | "center" | "end" | "auto";
  /** Use smooth scrolling */
  smooth?: boolean;
}

/**
 * Hook for virtualizing grid layouts with efficient rendering of large datasets.
 *
 * @example
 * ```tsx
 * function VirtualizedBankGrid({ items }) {
 *   const {
 *     containerRef,
 *     virtualCells,
 *     totalHeight,
 *     totalWidth,
 *   } = useVirtualGrid({
 *     itemCount: items.length,
 *     columns: 8,
 *     cellWidth: 36,
 *     cellHeight: 36,
 *     gap: 2,
 *     overscan: 2,
 *   });
 *
 *   return (
 *     <div ref={containerRef} style={{ height: 400, overflow: 'auto' }}>
 *       <div style={{ height: totalHeight, width: totalWidth, position: 'relative' }}>
 *         {virtualCells.map(({ index, offsetX, offsetY, width, height }) => (
 *           <div
 *             key={index}
 *             style={{
 *               position: 'absolute',
 *               left: offsetX,
 *               top: offsetY,
 *               width,
 *               height,
 *             }}
 *           >
 *             <ItemSlot item={items[index]} />
 *           </div>
 *         ))}
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVirtualGrid(
  options: UseVirtualGridOptions,
): UseVirtualGridResult {
  const {
    itemCount,
    columns: columnsProp,
    cellWidth,
    cellHeight,
    gap = 0,
    gapX = gap,
    gapY = gap,
    overscan = 2,
    initialScrollOffset = 0,
    onScroll,
    onRangeChange,
    smoothScroll = false,
    padding = 0,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(initialScrollOffset);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /** Calculate actual column count */
  const columnCount = useMemo(() => {
    if (columnsProp === "auto") {
      if (containerSize.width === 0) return 1;
      const availableWidth = containerSize.width - padding * 2;
      // Calculate how many cells fit: n * cellWidth + (n-1) * gapX <= availableWidth
      const cols = Math.floor((availableWidth + gapX) / (cellWidth + gapX));
      return Math.max(1, cols);
    }
    return columnsProp;
  }, [columnsProp, containerSize.width, cellWidth, gapX, padding]);

  /** Calculate total row count */
  const rowCount = useMemo(
    () => Math.ceil(itemCount / columnCount),
    [itemCount, columnCount],
  );

  /** Get cell dimensions with gap */
  const cellWidthWithGap = cellWidth + gapX;
  const cellHeightWithGap = cellHeight + gapY;

  /** Calculate total dimensions */
  const totalWidth = useMemo(
    () =>
      padding * 2 +
      columnCount * cellWidth +
      Math.max(0, columnCount - 1) * gapX,
    [padding, columnCount, cellWidth, gapX],
  );

  const totalHeight = useMemo(
    () =>
      padding * 2 + rowCount * cellHeight + Math.max(0, rowCount - 1) * gapY,
    [padding, rowCount, cellHeight, gapY],
  );

  /** Get cell position from index */
  const getCellPosition = useCallback(
    (index: number): { row: number; column: number } | null => {
      if (index < 0 || index >= itemCount) return null;
      return {
        row: Math.floor(index / columnCount),
        column: index % columnCount,
      };
    },
    [itemCount, columnCount],
  );

  /** Get index from cell position */
  const getIndexFromCell = useCallback(
    (row: number, column: number): number | null => {
      if (row < 0 || row >= rowCount || column < 0 || column >= columnCount) {
        return null;
      }
      const index = row * columnCount + column;
      return index < itemCount ? index : null;
    },
    [rowCount, columnCount, itemCount],
  );

  /** Calculate visible range */
  const calculateRange = useCallback((): VirtualGridRange => {
    if (itemCount === 0 || containerSize.height === 0) {
      return {
        startRow: 0,
        endRow: 0,
        startColumn: 0,
        endColumn: Math.min(columnCount - 1, 0),
        visible: {
          startRow: 0,
          endRow: 0,
          startColumn: 0,
          endColumn: Math.min(columnCount - 1, 0),
        },
      };
    }

    // Calculate visible rows
    const visibleStartRow = Math.floor(
      Math.max(0, scrollOffset - padding) / cellHeightWithGap,
    );
    const visibleEndRow = Math.min(
      rowCount - 1,
      Math.floor(
        (scrollOffset + containerSize.height - padding) / cellHeightWithGap,
      ),
    );

    // Apply overscan
    const startRow = Math.max(0, visibleStartRow - overscan);
    const endRow = Math.min(rowCount - 1, visibleEndRow + overscan);

    // For columns, render all (horizontal scrolling not virtualized in most inventory UIs)
    const startColumn = 0;
    const endColumn = columnCount - 1;

    return {
      startRow,
      endRow,
      startColumn,
      endColumn,
      visible: {
        startRow: visibleStartRow,
        endRow: visibleEndRow,
        startColumn: 0,
        endColumn: columnCount - 1,
      },
    };
  }, [
    itemCount,
    containerSize.height,
    scrollOffset,
    padding,
    cellHeightWithGap,
    rowCount,
    overscan,
    columnCount,
  ]);

  const range = useMemo(() => calculateRange(), [calculateRange]);

  // Notify on range change
  useEffect(() => {
    onRangeChange?.(range);
  }, [range, onRangeChange]);

  /** Generate virtual cells for the current range */
  const virtualCells = useMemo((): VirtualCell[] => {
    if (itemCount === 0) return [];

    const cells: VirtualCell[] = [];

    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        const index = row * columnCount + col;
        if (index >= itemCount) continue;

        const offsetX = padding + col * cellWidthWithGap;
        const offsetY = padding + row * cellHeightWithGap;

        const isVisible =
          row >= range.visible.startRow &&
          row <= range.visible.endRow &&
          col >= range.visible.startColumn &&
          col <= range.visible.endColumn;

        cells.push({
          index,
          row,
          column: col,
          offsetX,
          offsetY,
          width: cellWidth,
          height: cellHeight,
          isVisible,
        });
      }
    }

    return cells;
  }, [
    itemCount,
    range,
    columnCount,
    padding,
    cellWidthWithGap,
    cellHeightWithGap,
    cellWidth,
    cellHeight,
  ]);

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

  /** Update container size on resize */
  const updateContainerSize = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
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

  /** Scroll to a specific cell */
  const scrollToCell = useCallback(
    (row: number, column: number, scrollOptions?: GridScrollToOptions) => {
      const container = containerRef.current;
      if (!container) return;

      const clampedRow = Math.max(0, Math.min(row, rowCount - 1));
      const cellTop = padding + clampedRow * cellHeightWithGap;

      let targetOffset: number;

      switch (scrollOptions?.align) {
        case "start":
          targetOffset = cellTop;
          break;
        case "center":
          targetOffset = cellTop - containerSize.height / 2 + cellHeight / 2;
          break;
        case "end":
          targetOffset = cellTop - containerSize.height + cellHeight;
          break;
        case "auto":
        default: {
          // Only scroll if not visible
          const cellBottom = cellTop + cellHeight;
          if (
            cellTop < scrollOffset ||
            cellBottom > scrollOffset + containerSize.height
          ) {
            if (cellTop < scrollOffset) {
              targetOffset = cellTop;
            } else {
              targetOffset = cellBottom - containerSize.height;
            }
          } else {
            return; // Already visible
          }
        }
      }

      targetOffset = Math.max(
        0,
        Math.min(targetOffset, totalHeight - containerSize.height),
      );

      container.scrollTo({
        top: targetOffset,
        behavior:
          (scrollOptions?.smooth ?? smoothScroll) ? "smooth" : "instant",
      });
    },
    [
      rowCount,
      padding,
      cellHeightWithGap,
      cellHeight,
      containerSize.height,
      scrollOffset,
      totalHeight,
      smoothScroll,
    ],
  );

  /** Scroll to a specific item index */
  const scrollToIndex = useCallback(
    (index: number, scrollOptions?: GridScrollToOptions) => {
      const position = getCellPosition(index);
      if (position) {
        scrollToCell(position.row, position.column, scrollOptions);
      }
    },
    [getCellPosition, scrollToCell],
  );

  /** Scroll to a specific offset */
  const scrollToOffset = useCallback(
    (offset: number, scrollOptions?: GridScrollToOptions) => {
      const container = containerRef.current;
      if (!container) return;

      const clampedOffset = Math.max(
        0,
        Math.min(offset, totalHeight - containerSize.height),
      );

      container.scrollTo({
        top: clampedOffset,
        behavior:
          (scrollOptions?.smooth ?? smoothScroll) ? "smooth" : "instant",
      });
    },
    [totalHeight, containerSize.height, smoothScroll],
  );

  return {
    containerRef,
    totalHeight,
    totalWidth,
    columnCount,
    rowCount,
    virtualCells,
    range,
    scrollOffset,
    scrollToIndex,
    scrollToCell,
    scrollToOffset,
    isScrolling,
    getCellPosition,
    getIndexFromCell,
  };
}

export default useVirtualGrid;
