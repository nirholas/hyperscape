/**
 * Virtual List Component
 *
 * A styled virtual list component for efficiently rendering large lists.
 * Integrates with hs-kit theming and provides smooth scrolling for
 * chat logs, item lists, and other scrollable content.
 *
 * @packageDocumentation
 */

import React, {
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { useTheme } from "../stores/themeStore";
import {
  useVirtualList,
  type UseVirtualListOptions,
  type VirtualItem,
  type ScrollToOptions,
} from "../core/virtual/useVirtualList";

/** Render function for list items */
export type VirtualListRenderItem<T> = (
  item: T,
  index: number,
  virtualItem: VirtualItem,
) => ReactNode;

/** Props for VirtualList component */
export interface VirtualListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Fixed item height (use for best performance) */
  itemHeight?: number;
  /** Function to estimate item height for variable heights */
  estimateItemHeight?: (index: number, item: T) => number;
  /** Number of items to render beyond visible area */
  overscan?: number;
  /** Height of the container */
  height: number | string;
  /** Width of the container */
  width?: number | string;
  /** Render function for each item */
  renderItem: VirtualListRenderItem<T>;
  /** Callback when an item is clicked */
  onItemClick?: (item: T, index: number) => void;
  /** Callback when an item is double-clicked */
  onItemDoubleClick?: (item: T, index: number) => void;
  /** Callback when scroll changes */
  onScroll?: (offset: number) => void;
  /** Index of selected item */
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
  /** Empty state content */
  emptyContent?: ReactNode;
  /** Loading state */
  isLoading?: boolean;
  /** Loading indicator content */
  loadingContent?: ReactNode;
  /** Accessible label */
  "aria-label"?: string;
}

/** Ref type for VirtualList imperative handle */
export interface VirtualListRef {
  /** Scroll to a specific index */
  scrollToIndex: (index: number, options?: ScrollToOptions) => void;
  /** Scroll to a specific offset */
  scrollToOffset: (offset: number, options?: ScrollToOptions) => void;
  /** Get the container element */
  getContainer: () => HTMLDivElement | null;
}

/**
 * Virtual List Component
 *
 * Efficiently renders large lists by only rendering visible items.
 *
 * @example
 * ```tsx
 * function ChatLog({ messages }) {
 *   return (
 *     <VirtualList
 *       items={messages}
 *       height={400}
 *       itemHeight={60}
 *       renderItem={(message, index) => (
 *         <ChatMessage key={message.id} message={message} />
 *       )}
 *       onItemClick={(message) => selectMessage(message)}
 *       keyboardNavigation
 *     />
 *   );
 * }
 * ```
 */
// React 19: ref is now a regular prop, no forwardRef needed
function VirtualListComponent<T>({
  items,
  itemHeight = 40,
  estimateItemHeight,
  overscan = 5,
  height,
  width = "100%",
  renderItem,
  onItemClick,
  onItemDoubleClick,
  onScroll,
  selectedIndex,
  keyboardNavigation = false,
  onSelectionChange,
  smoothScroll = false,
  className,
  style,
  customScrollbar = true,
  emptyContent,
  isLoading = false,
  loadingContent,
  "aria-label": ariaLabel,
  ref,
}: VirtualListProps<T> & {
  ref?: React.Ref<VirtualListRef>;
}): React.ReactElement {
  const theme = useTheme();
  const internalRef = useRef<HTMLDivElement>(null);

  // Virtual list options
  const virtualOptions: UseVirtualListOptions<T> = {
    itemCount: items.length,
    itemHeight: estimateItemHeight ? undefined : itemHeight,
    estimateItemHeight: estimateItemHeight
      ? (index, item) => estimateItemHeight(index, item as T)
      : undefined,
    overscan,
    onScroll,
    smoothScroll,
    items,
  };

  const {
    containerRef,
    totalHeight,
    virtualItems,
    scrollToIndex,
    scrollToOffset,
    isScrolling,
  } = useVirtualList(virtualOptions);

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
      scrollToOffset,
      getContainer: () => containerRef.current,
    }),
    [scrollToIndex, scrollToOffset, containerRef],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardNavigation || items.length === 0) return;

      const currentIndex = selectedIndex ?? -1;
      let newIndex: number | null = null;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          newIndex = Math.min(currentIndex + 1, items.length - 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          newIndex = Math.max(currentIndex - 1, 0);
          break;
        case "Home":
          e.preventDefault();
          newIndex = 0;
          break;
        case "End":
          e.preventDefault();
          newIndex = items.length - 1;
          break;
        case "PageDown":
          e.preventDefault();
          newIndex = Math.min(currentIndex + 10, items.length - 1);
          break;
        case "PageUp":
          e.preventDefault();
          newIndex = Math.max(currentIndex - 10, 0);
          break;
        case "Enter":
        case " ":
          if (selectedIndex !== null && selectedIndex !== undefined) {
            e.preventDefault();
            onItemClick?.(items[selectedIndex], selectedIndex);
          }
          return;
      }

      if (newIndex !== null && newIndex !== currentIndex) {
        onSelectionChange?.(newIndex);
        scrollToIndex(newIndex, { align: "auto" });
      }
    },
    [
      keyboardNavigation,
      items,
      selectedIndex,
      onSelectionChange,
      onItemClick,
      scrollToIndex,
    ],
  );

  // Handle item click
  const handleItemClick = useCallback(
    (item: T, index: number) => {
      if (keyboardNavigation) {
        onSelectionChange?.(index);
      }
      onItemClick?.(item, index);
    },
    [keyboardNavigation, onSelectionChange, onItemClick],
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
    width: "100%",
    position: "relative",
  };

  // Item container styles
  const getItemStyle = (
    virtualItem: VirtualItem,
    isSelected: boolean,
  ): CSSProperties => ({
    position: "absolute",
    top: virtualItem.offset,
    left: 0,
    width: "100%",
    height: virtualItem.height,
    boxSizing: "border-box",
    cursor: onItemClick ? "pointer" : "default",
    backgroundColor: isSelected
      ? `${theme.colors.accent.primary}20`
      : "transparent",
    transition: isScrolling ? "none" : "background-color 150ms ease",
    borderBottom: `1px solid ${theme.colors.border.default}`,
  });

  // Loading state
  if (isLoading) {
    return (
      <div className={className} style={containerStyle}>
        {loadingContent ?? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.colors.text.muted,
            }}
          >
            Loading...
          </div>
        )}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
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
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={
        selectedIndex !== null && selectedIndex !== undefined
          ? `virtual-list-item-${selectedIndex}`
          : undefined
      }
    >
      <div style={innerStyle}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          const isSelected = selectedIndex === virtualItem.index;

          return (
            <div
              key={virtualItem.index}
              id={`virtual-list-item-${virtualItem.index}`}
              style={getItemStyle(virtualItem, isSelected)}
              onClick={() => handleItemClick(item, virtualItem.index)}
              onDoubleClick={() => onItemDoubleClick?.(item, virtualItem.index)}
              role="option"
              aria-selected={isSelected}
            >
              {renderItem(item, virtualItem.index, virtualItem)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// React 19: Export the component directly with ref-as-prop support
export const VirtualList = VirtualListComponent as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListRef> },
) => React.ReactElement;

export default VirtualList;
