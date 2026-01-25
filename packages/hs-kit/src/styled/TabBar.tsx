import React, { memo, useRef, useState, useEffect } from "react";
import { useTabs } from "../core/tabs/useTabs";
import { useDrop } from "../core/drag/useDrop";
import { useTabDrag } from "../core/tabs/useTabDrag";
import { Tab } from "./Tab";
import { useTheme } from "../stores/themeStore";
import { useWindowStore } from "../stores/windowStore";
import { useDragStore } from "../stores/dragStore";
import type { TabBarProps } from "../types";

/** Extended TabBar props with window controls */
interface ExtendedTabBarProps extends TabBarProps {
  /** Drag handle props from Window for making tab bar draggable */
  dragHandleProps?: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Close window handler */
  onCloseWindow?: () => void;
  /** Whether in edit mode (for drag cursor) */
  isUnlocked?: boolean;
}

/**
 * Styled tab bar component with scroll arrows and window controls
 *
 * @example
 * ```tsx
 * <Window windowId={windowId}>
 *   <TabBar windowId={windowId} />
 *   <TabContent windowId={windowId} />
 * </Window>
 * ```
 */
export const TabBar = memo(function TabBar({
  windowId,
  className,
  style,
  dragHandleProps,
  onCloseWindow,
  isUnlocked,
}: ExtendedTabBarProps): React.ReactElement {
  const theme = useTheme();
  const { tabs, activeTabIndex, setActiveTab, removeTab, addTab } =
    useTabs(windowId);
  const { moveTab, isTabDragging, draggingSourceWindowId, draggingTabId } =
    useTabDrag();

  // Scroll state
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll state
  const updateScrollState = () => {
    const container = tabsContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft <
          container.scrollWidth - container.clientWidth - 1,
      );
    }
  };

  useEffect(() => {
    updateScrollState();
    const container = tabsContainerRef.current;
    if (container) {
      container.addEventListener("scroll", updateScrollState);
      const observer = new ResizeObserver(updateScrollState);
      observer.observe(container);
      return () => {
        container.removeEventListener("scroll", updateScrollState);
        observer.disconnect();
      };
    }
  }, [tabs.length]);

  const scrollTabs = (direction: "left" | "right") => {
    const container = tabsContainerRef.current;
    if (container) {
      const scrollAmount = 100; // pixels to scroll
      container.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  // Check if a tab from THIS window is being dragged
  const isDraggingFromThisWindow =
    isTabDragging && draggingSourceWindowId === windowId;

  // Check if a tab from ANOTHER window is being dragged (potential drop target)
  const isDraggingFromOtherWindow =
    isTabDragging && draggingSourceWindowId !== windowId;

  // Also check if a WINDOW (not tab) is being dragged from another window
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const isWindowDragging = isDragging && dragItem?.type === "window";
  const isDraggingWindowFromOther =
    isWindowDragging && dragItem?.id !== windowId;

  // Either tab or window being dragged from another source
  const isDraggingFromOther =
    isDraggingFromOtherWindow || isDraggingWindowFromOther;

  // Accept tab AND window drops (for merging single-tab windows into multi-tab)
  const { isOver, canDrop, relativePosition, dropProps } = useDrop({
    id: `tabbar-${windowId}`,
    accepts: ["tab", "window"],
    onDrop: (item) => {
      if (item.type === "tab") {
        // Move tab to this window
        if (item.sourceId && item.sourceId !== windowId) {
          moveTab(item.id, windowId);
        }
      } else if (item.type === "window") {
        // Merge entire window into this one
        if (item.id && item.id !== windowId) {
          // Get all tabs from source window and move them
          const sourceWindow = useWindowStore.getState().getWindow(item.id);
          if (sourceWindow) {
            sourceWindow.tabs.forEach((tab) => {
              useWindowStore.getState().moveTab(tab.id, item.id, windowId);
            });
          }
        }
      }
    },
  });

  // Calculate drop position indicator based on relative position
  const dropIndicatorIndex =
    isOver && canDrop && relativePosition
      ? Math.min(Math.floor(relativePosition.x / 100), tabs.length)
      : -1;

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    minHeight: 28,
    overflow: "hidden",
    position: "relative",
    userSelect: "none",
    touchAction: dragHandleProps?.style.touchAction || "none",
    cursor: isUnlocked ? dragHandleProps?.style.cursor || "move" : "default",
    // Highlight when dragging from another window and hovering
    ...(isOver && canDrop
      ? {
          backgroundColor: theme.colors.background.tertiary,
          borderBottom: `1px solid ${theme.colors.accent.primary}`,
        }
      : {}),
    // Dim when dragging from this window
    ...(isDraggingFromThisWindow
      ? {
          opacity: 0.7,
        }
      : {}),
    // Highlight border when potential drop target (tab or window from another source)
    ...(isDraggingFromOther && !isOver
      ? {
          borderBottom: `1px solid ${theme.colors.border.hover}`,
        }
      : {}),
    ...style,
  };

  const dropIndicatorStyle: React.CSSProperties = {
    position: "absolute",
    width: 2,
    top: 4,
    bottom: 4,
    backgroundColor: theme.colors.accent.primary,
    borderRadius: 1,
    transition: "left 100ms ease-out",
  };

  const tabsContainerStyle: React.CSSProperties = {
    display: "flex",
    flex: 1,
    overflow: "auto",
    scrollbarWidth: "none",
  };

  const scrollButtonStyle: React.CSSProperties = {
    width: 20,
    height: 20,
    border: "none",
    background: "transparent",
    color: theme.colors.text.muted,
    cursor: "pointer",
    borderRadius: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    flexShrink: 0,
  };

  const actionButtonStyle: React.CSSProperties = {
    width: 20,
    height: 20,
    border: "none",
    background: "transparent",
    color: theme.colors.text.muted,
    cursor: "pointer",
    borderRadius: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    flexShrink: 0,
  };

  const buttonGroupStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    marginLeft: 4,
    marginRight: 4,
  };

  // Handle drag on the container (not on tabs or buttons)
  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;

    // Don't trigger window drag if clicking on:
    // - Buttons (scroll arrows, add, close)
    // - Tabs (they have their own drag handlers)
    // - Any element inside a tab
    if (target.tagName === "BUTTON") return;
    if (target.closest("[data-tab]")) return;

    // Only trigger window drag on empty space in tab bar
    dragHandleProps?.onPointerDown(e);
  };

  return (
    <div
      className={className}
      style={containerStyle}
      onPointerDown={handlePointerDown}
      role="tablist"
      aria-label="Window tabs"
      {...dropProps}
    >
      {/* Drop position indicator */}
      {dropIndicatorIndex >= 0 && (
        <div
          style={{
            ...dropIndicatorStyle,
            left: dropIndicatorIndex * 100, // Approximate tab width
          }}
        />
      )}

      {/* Left scroll arrow */}
      {canScrollLeft && (
        <button
          style={scrollButtonStyle}
          onClick={() => scrollTabs("left")}
          onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) =>
            e.stopPropagation()
          }
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.color = theme.colors.text.primary;
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.color = theme.colors.text.muted;
          }}
          aria-label="Scroll tabs left"
        >
          ◀
        </button>
      )}

      {/* Tabs container */}
      <div ref={tabsContainerRef} style={tabsContainerStyle}>
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={index === activeTabIndex}
            onActivate={() => setActiveTab(index)}
            onClose={tab.closeable ? () => removeTab(tab.id) : undefined}
            // Dim the tab if it's the one being dragged
            style={draggingTabId === tab.id ? { opacity: 0.4 } : undefined}
          />
        ))}
      </div>

      {/* Right scroll arrow */}
      {canScrollRight && (
        <button
          style={scrollButtonStyle}
          onClick={() => scrollTabs("right")}
          onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) =>
            e.stopPropagation()
          }
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.color = theme.colors.text.primary;
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.color = theme.colors.text.muted;
          }}
          aria-label="Scroll tabs right"
        >
          ▶
        </button>
      )}

      {/* Button group: Add + Close - only show close button in edit mode */}
      <div style={buttonGroupStyle}>
        {isUnlocked && (
          <button
            style={actionButtonStyle}
            onClick={() => addTab({ label: "New Tab", content: "New Content" })}
            onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) =>
              e.stopPropagation()
            }
            title="Add tab"
            aria-label="Add new tab"
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.color = theme.colors.text.primary;
              e.currentTarget.style.backgroundColor =
                theme.colors.background.tertiary;
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.color = theme.colors.text.muted;
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            +
          </button>
        )}
        {isUnlocked && onCloseWindow && (
          <button
            style={actionButtonStyle}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onCloseWindow();
            }}
            onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) =>
              e.stopPropagation()
            }
            title="Close window"
            aria-label="Close window"
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.color = theme.colors.text.primary;
              e.currentTarget.style.backgroundColor = theme.colors.state.danger;
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.color = theme.colors.text.muted;
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
});
