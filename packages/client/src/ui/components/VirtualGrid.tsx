/**
 * Virtual Grid Component
 *
 * A styled virtual grid component for efficiently rendering large inventories.
 * Integrates with ItemSlot and hs-kit theming for game inventory UIs.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { useTheme } from "../stores/themeStore";
import {
  useVirtualGrid,
  type UseVirtualGridOptions,
  type VirtualCell,
  type GridScrollToOptions,
} from "../core/virtual/useVirtualGrid";
import { ItemSlot, type ItemData } from "./ItemSlot";

/** Render function for grid cells */
export type VirtualGridRenderCell<T> = (
  item: T | null,
  index: number,
  cell: VirtualCell,
) => ReactNode;

/** Props for VirtualGrid component */
export interface VirtualGridProps<T = ItemData> {
  /** Array of items to render (sparse array allowed, null for empty slots) */
  items: (T | null)[];
  /** Total number of slots (defaults to items.length) */
  slotCount?: number;
  /** Number of columns (or 'auto' to calculate based on container width) */
  columns?: number | "auto";
  /** Cell width in pixels */
  cellWidth?: number;
  /** Cell height in pixels */
  cellHeight?: number;
  /** Gap between cells in pixels */
  gap?: number;
  /** Number of rows to render beyond visible area */
  overscan?: number;
  /** Height of the container */
  height: number | string;
  /** Width of the container */
  width?: number | string;
  /** Grid identifier (for slot IDs) */
  gridId: string;
  /** Custom render function (defaults to ItemSlot) */
  renderCell?: VirtualGridRenderCell<T>;
  /** Callback when a cell is clicked */
  onCellClick?: (item: T | null, index: number) => void;
  /** Callback when a cell is right-clicked */
  onCellContextMenu?: (
    item: T | null,
    index: number,
    event: React.MouseEvent,
  ) => void;
  /** Callback when an item is dropped on a cell */
  onCellDrop?: (index: number, droppedItem: ItemData) => void;
  /** Callback when scroll changes */
  onScroll?: (offset: number) => void;
  /** Index of selected cell */
  selectedIndex?: number | null;
  /** Enable keyboard navigation */
  keyboardNavigation?: boolean;
  /** Callback when selection changes via keyboard */
  onSelectionChange?: (index: number) => void;
  /** Enable smooth scroll behavior */
  smoothScroll?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /** Custom scrollbar styling */
  customScrollbar?: boolean;
  /** Padding around the grid */
  padding?: number;
  /** Whether slots are draggable */
  draggable?: boolean;
  /** Whether slots accept drops */
  droppable?: boolean;
  /** Empty state content (when items array is empty) */
  emptyContent?: ReactNode;
  /** Accessible label */
  "aria-label"?: string;
}

/** Ref type for VirtualGrid imperative handle */
export interface VirtualGridRef {
  /** Scroll to a specific index */
  scrollToIndex: (index: number, options?: GridScrollToOptions) => void;
  /** Scroll to a specific cell position */
  scrollToCell: (
    row: number,
    column: number,
    options?: GridScrollToOptions,
  ) => void;
  /** Scroll to a specific offset */
  scrollToOffset: (offset: number, options?: GridScrollToOptions) => void;
  /** Get the container element */
  getContainer: () => HTMLDivElement | null;
  /** Get cell position for an index */
  getCellPosition: (index: number) => { row: number; column: number } | null;
}

/**
 * Virtual Grid Component
 *
 * Efficiently renders large inventory grids by only rendering visible cells.
 * Integrates with ItemSlot for consistent inventory UI.
 *
 * @example
 * ```tsx
 * function BankInventory({ items }) {
 *   const [selectedIndex, setSelectedIndex] = useState(null);
 *
 *   return (
 *     <VirtualGrid
 *       gridId="bank"
 *       items={items}
 *       slotCount={800}
 *       columns={8}
 *       height={400}
 *       selectedIndex={selectedIndex}
 *       onCellClick={(item, index) => setSelectedIndex(index)}
 *       onCellDrop={(index, item) => moveItemToBank(item, index)}
 *       keyboardNavigation
 *     />
 *   );
 * }
 * ```
 */
// React 19: ref is now a regular prop, no forwardRef needed
function VirtualGridComponent<T = ItemData>({
  items,
  slotCount,
  columns = 4,
  cellWidth,
  cellHeight,
  gap = 2,
  overscan = 2,
  height,
  width = "100%",
  gridId,
  renderCell,
  onCellClick,
  onCellContextMenu,
  onCellDrop,
  onScroll,
  selectedIndex,
  keyboardNavigation = false,
  onSelectionChange,
  smoothScroll = false,
  className,
  style,
  customScrollbar = true,
  padding = 4,
  draggable = true,
  droppable = true,
  emptyContent,
  "aria-label": ariaLabel,
  ref,
}: VirtualGridProps<T> & {
  ref?: React.Ref<VirtualGridRef>;
}): React.ReactElement {
  const theme = useTheme();
  const internalRef = useRef<HTMLDivElement>(null);

  // Use theme slot size if not specified
  const slotSize = cellWidth ?? theme.slot.size;
  const slotHeightValue = cellHeight ?? slotSize;

  // Calculate total slot count
  const totalSlots = slotCount ?? items.length;

  // Virtual grid options
  const virtualOptions: UseVirtualGridOptions = {
    itemCount: totalSlots,
    columns,
    cellWidth: slotSize,
    cellHeight: slotHeightValue,
    gap,
    overscan,
    onScroll,
    smoothScroll,
    padding,
  };

  const {
    containerRef,
    totalHeight,
    totalWidth,
    columnCount,
    rowCount,
    virtualCells,
    scrollToIndex,
    scrollToCell,
    scrollToOffset,
    isScrolling,
    getCellPosition,
    getIndexFromCell,
  } = useVirtualGrid(virtualOptions);

  // Combine refs
  useEffect(() => {
    if (containerRef.current) {
      (internalRef as React.MutableRefObject<HTMLDivElement | null>).current =
        containerRef.current;
    }
  }, [containerRef]);

  // Expose imperative handle
  React.useImperativeHandle(
    ref,
    () => ({
      scrollToIndex,
      scrollToCell,
      scrollToOffset,
      getContainer: () => containerRef.current,
      getCellPosition,
      isScrolling: () => isScrolling,
    }),
    [
      scrollToIndex,
      scrollToCell,
      scrollToOffset,
      containerRef,
      getCellPosition,
      isScrolling,
    ],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardNavigation || totalSlots === 0) return;

      const currentIndex = selectedIndex ?? -1;
      const currentPos = getCellPosition(currentIndex) ?? {
        row: 0,
        column: -1,
      };
      let newRow = currentPos.row;
      let newCol = currentPos.column;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          newCol = Math.min(currentPos.column + 1, columnCount - 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          newCol = Math.max(currentPos.column - 1, 0);
          break;
        case "ArrowDown":
          e.preventDefault();
          newRow = Math.min(currentPos.row + 1, rowCount - 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          newRow = Math.max(currentPos.row - 1, 0);
          break;
        case "Home":
          e.preventDefault();
          if (e.ctrlKey) {
            newRow = 0;
            newCol = 0;
          } else {
            newCol = 0;
          }
          break;
        case "End":
          e.preventDefault();
          if (e.ctrlKey) {
            const lastIndex = totalSlots - 1;
            const lastPos = getCellPosition(lastIndex);
            if (lastPos) {
              newRow = lastPos.row;
              newCol = lastPos.column;
            }
          } else {
            newCol = columnCount - 1;
          }
          break;
        case "PageDown":
          e.preventDefault();
          newRow = Math.min(currentPos.row + 5, rowCount - 1);
          break;
        case "PageUp":
          e.preventDefault();
          newRow = Math.max(currentPos.row - 5, 0);
          break;
        case "Enter":
        case " ":
          if (selectedIndex !== null && selectedIndex !== undefined) {
            e.preventDefault();
            onCellClick?.(items[selectedIndex] ?? null, selectedIndex);
          }
          return;
      }

      const newIndex = getIndexFromCell(newRow, newCol);
      if (newIndex !== null && newIndex !== currentIndex) {
        onSelectionChange?.(newIndex);
        scrollToIndex(newIndex, { align: "auto" });
      }
    },
    [
      keyboardNavigation,
      totalSlots,
      selectedIndex,
      getCellPosition,
      columnCount,
      rowCount,
      getIndexFromCell,
      onSelectionChange,
      onCellClick,
      items,
      scrollToIndex,
    ],
  );

  // Handle cell click
  const handleCellClick = useCallback(
    (item: T | null, index: number) => {
      if (keyboardNavigation) {
        onSelectionChange?.(index);
      }
      onCellClick?.(item, index);
    },
    [keyboardNavigation, onSelectionChange, onCellClick],
  );

  // Container styles
  const containerStyle: CSSProperties = {
    height,
    width,
    overflow: "auto",
    position: "relative",
    outline: "none",
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    // Custom scrollbar styling
    ...(customScrollbar
      ? {
          scrollbarWidth: "thin" as const,
          scrollbarColor: `${theme.colors.border.default} transparent`,
        }
      : {}),
    ...style,
  };

  // Inner container styles
  const innerStyle: CSSProperties = {
    height: totalHeight,
    width: totalWidth,
    position: "relative",
  };

  // Default render function using ItemSlot
  const defaultRenderCell = useCallback(
    (item: T | null, index: number, cell: VirtualCell) => {
      const isSelected = selectedIndex === index;
      const itemData = item as ItemData | null;

      return (
        <ItemSlot
          slotId={`${gridId}-${index}`}
          item={itemData}
          size={cell.width}
          selected={isSelected}
          draggable={draggable}
          droppable={droppable}
          onClick={() => handleCellClick(item, index)}
          onContextMenu={(_, __, e) => onCellContextMenu?.(item, index, e)}
          onDrop={
            onCellDrop ? (_, dropped) => onCellDrop(index, dropped) : undefined
          }
        />
      );
    },
    [
      selectedIndex,
      gridId,
      draggable,
      droppable,
      handleCellClick,
      onCellContextMenu,
      onCellDrop,
    ],
  );

  const renderFn = renderCell ?? defaultRenderCell;

  // Empty state
  if (totalSlots === 0) {
    return (
      <div className={className} style={containerStyle}>
        {emptyContent ?? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.colors.text.muted,
            }}
          >
            No items
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={containerStyle}
      tabIndex={keyboardNavigation ? 0 : -1}
      onKeyDown={handleKeyDown}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rowCount}
      aria-colcount={columnCount}
    >
      <div style={innerStyle}>
        {virtualCells.map((cell) => {
          const item = items[cell.index] ?? null;

          return (
            <div
              key={cell.index}
              style={{
                position: "absolute",
                left: cell.offsetX,
                top: cell.offsetY,
                width: cell.width,
                height: cell.height,
              }}
              role="gridcell"
              aria-rowindex={cell.row + 1}
              aria-colindex={cell.column + 1}
              aria-selected={selectedIndex === cell.index}
            >
              {renderFn(item, cell.index, cell)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// React 19: Export the component directly with ref-as-prop support
export const VirtualGrid = VirtualGridComponent as <T = ItemData>(
  props: VirtualGridProps<T> & { ref?: React.Ref<VirtualGridRef> },
) => React.ReactElement;

/**
 * VirtualItemGrid - Convenience component for item inventories
 *
 * Pre-configured VirtualGrid specifically for ItemData arrays.
 */
export interface VirtualItemGridProps
  extends Omit<VirtualGridProps<ItemData>, "items" | "renderCell"> {
  /** Array of items (ItemData) */
  items: (ItemData | null)[];
}

export const VirtualItemGrid = memo(function VirtualItemGrid(
  props: VirtualItemGridProps,
): React.ReactElement {
  return <VirtualGrid<ItemData> {...props} />;
});

export default VirtualGrid;
