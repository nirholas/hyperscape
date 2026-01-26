/**
 * Virtual Scrolling System
 *
 * Efficient virtualization hooks for rendering large lists and grids.
 * Designed for inventories, chat logs, and other scrollable content
 * with 1000+ items.
 *
 * @packageDocumentation
 */

export {
  useVirtualList,
  type UseVirtualListOptions,
  type UseVirtualListResult,
  type VirtualItem,
  type VirtualRange,
  type ItemMeasurement,
  type ScrollToOptions,
} from "./useVirtualList";

export {
  useVirtualGrid,
  type UseVirtualGridOptions,
  type UseVirtualGridResult,
  type VirtualCell,
  type VirtualGridRange,
  type GridScrollToOptions,
} from "./useVirtualGrid";
