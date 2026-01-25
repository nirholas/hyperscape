import React, { memo, useCallback, useRef, useMemo } from "react";
import { useWindow } from "../core/window/useWindow";
import { useResize } from "../core/window/useResize";
import { useDrag } from "../core/drag/useDrag";
import { useEditMode } from "../core/edit/useEditMode";
import { useSnap } from "../core/window/useSnap";
import { useWindowManager } from "../core/window/useWindowManager";
import { useAlignmentGuides } from "../core/edit/useAlignmentGuides";
import { useTabDrag } from "../core/tabs/useTabDrag";
import { useTheme } from "../stores/themeStore";
import { useEditStore } from "../stores/editStore";
import {
  restrictToWindowEdgesFully,
  snapToGridModifier,
  composeWindowModifiers,
  type WindowPositionModifier,
} from "../core/drag/modifiers";
import {
  getThemedGlassmorphismStyle,
  getThemedWindowShadow,
  getDecorativeBorderStyle,
} from "./themes";
import { WindowErrorBoundary } from "./WindowErrorBoundary";
import type { WindowProps } from "../types";

/** Resize handle size in pixels - can be overridden via theme */
const DEFAULT_HANDLE_SIZE = 8;
const DEFAULT_CORNER_SIZE = 12;

/**
 * Styled draggable window component
 *
 * @example
 * ```tsx
 * function App() {
 *   const { windows } = useWindowManager();
 *
 *   return (
 *     <DragProvider>
 *       {windows.map(w => (
 *         <Window key={w.id} windowId={w.id}>
 *           <TabBar windowId={w.id} />
 *           <div style={{ padding: 16 }}>Content</div>
 *         </Window>
 *       ))}
 *     </DragProvider>
 *   );
 * }
 * ```
 */
export const Window = memo(function Window({
  windowId,
  windowState: passedWindowState,
  isUnlocked: passedIsUnlocked,
  windowCombiningEnabled = true,
  onError,
  errorFallback,
  showErrorUI = true,
  children,
  className,
  style,
}: WindowProps): React.ReactElement | null {
  // Get theme-configured handle sizes (with fallbacks to defaults)
  const theme = useTheme();
  const HANDLE_SIZE = theme.window?.resizeHandleSize ?? DEFAULT_HANDLE_SIZE;
  const CORNER_SIZE = theme.window?.resizeCornerSize ?? DEFAULT_CORNER_SIZE;
  const EDGE_SNAP_THRESHOLD = theme.window?.edgeSnapThreshold ?? 15;

  const {
    window: hookWindowState,
    updatePosition,
    bringToFront,
    close,
  } = useWindow(windowId);

  // For position and size, always prefer the hook's store state for immediate reactivity
  // This ensures drag/resize updates are reflected instantly without waiting for parent re-render
  // For other props (tabs, visibility, etc.), use passed state if available
  const storeHasWindow =
    hookWindowState.id === windowId && hookWindowState.visible !== false;
  const windowState = storeHasWindow
    ? {
        ...hookWindowState,
        // Merge in any additional props from passedWindowState that might not be in store
        tabs:
          hookWindowState.tabs.length > 0
            ? hookWindowState.tabs
            : passedWindowState?.tabs || hookWindowState.tabs,
      }
    : passedWindowState || hookWindowState;
  const { getResizeHandleProps } = useResize(windowId);
  const { isUnlocked: hookIsUnlocked } = useEditMode();
  // Use passed isUnlocked if provided, otherwise use hook result
  // This bypasses the store lookup issue when stores are in different bundles
  const isUnlocked = passedIsUnlocked ?? hookIsUnlocked;
  const { snapEnabled } = useSnap();
  const { windows } = useWindowManager();
  const { snapToGuide, calculateGuides } = useAlignmentGuides(
    windows,
    windowId,
  );

  // Get viewport restriction settings from edit store
  const restrictToViewport = useEditStore((s) => s.restrictToViewport);
  const viewportEdgeMargin = useEditStore((s) => s.viewportEdgeMargin);
  const gridSize = useEditStore((s) => s.gridSize);

  // Get guide state setters from edit store
  const setActiveGuides = useEditStore((s) => s.setActiveGuides);
  const setDraggingWindowId = useEditStore((s) => s.setDraggingWindowId);

  // Detect if a tab is being dragged (for combine highlighting)
  const { isTabDragging, draggingSourceWindowId, targetWindowId } =
    useTabDrag();

  // Check if this window is being targeted for tab combine (tab from another window is over this tabbar)
  // Only show combine UI if window combining is enabled
  const isTabCombineTarget =
    windowCombiningEnabled &&
    isTabDragging &&
    draggingSourceWindowId !== windowId &&
    targetWindowId === windowId;

  // Check if ANY tab is being dragged from another window (to show potential drop target)
  // Only show if window combining is enabled
  const isTabDraggingFromOther =
    windowCombiningEnabled &&
    isTabDragging &&
    draggingSourceWindowId !== windowId;

  // Compose position modifiers based on store settings
  // This is similar to dnd-kit's restrictToWindowEdges modifier pattern
  const positionModifier = useMemo((): WindowPositionModifier | null => {
    const modifiers: WindowPositionModifier[] = [];

    // Add grid snap modifier if enabled
    if (snapEnabled && gridSize > 0) {
      modifiers.push(snapToGridModifier(gridSize));
    }

    // Add viewport restriction modifier (always last to ensure boundaries are respected)
    // Use restrictToWindowEdgesFully to keep windows entirely on-screen
    if (restrictToViewport) {
      modifiers.push(restrictToWindowEdgesFully());
    }

    return modifiers.length > 0 ? composeWindowModifiers(modifiers) : null;
  }, [snapEnabled, gridSize, restrictToViewport, viewportEdgeMargin]);

  // Ref to capture position at drag start (avoids closure issues)
  const dragStartPositionRef = useRef({ x: 0, y: 0 });
  // Ref to store the committed position after drag ends (prevents snap-back)
  const committedPositionRef = useRef<{ x: number; y: number } | null>(null);
  // Track if we were dragging in the previous render
  const wasDraggingRef = useRef(false);

  const handleDragStart = useCallback(() => {
    // Capture the current position when drag starts
    dragStartPositionRef.current = { ...windowState.position };
    // Clear any committed position from previous drag
    committedPositionRef.current = null;
    // Track that this window is being dragged (for alignment guides)
    setDraggingWindowId(windowId);
  }, [windowState.position, setDraggingWindowId, windowId]);

  const handleDragEnd = useCallback(
    (_item: unknown, delta: { x: number; y: number }) => {
      // Use the captured start position, not the current windowState.position
      const startPos = dragStartPositionRef.current;
      let newPosition = {
        x: startPos.x + delta.x,
        y: startPos.y + delta.y,
      };

      // Step 1: Apply viewport restriction first (keeps window on screen)
      // This is the most important constraint
      if (positionModifier) {
        newPosition = positionModifier({
          position: newPosition,
          size: windowState.size,
          originalPosition: startPos,
          delta,
        });
      }

      // Step 2: Snap to alignment guides between windows (if any are close)
      // This takes priority over grid snapping for inter-window alignment
      const guidedPosition = snapToGuide(newPosition, windowState.size);
      const wasGuidedX = guidedPosition.x !== newPosition.x;
      const wasGuidedY = guidedPosition.y !== newPosition.y;
      newPosition = guidedPosition;

      // Step 3: Snap to viewport edges when close (magnetic edge snapping)
      // Only apply edge snap if we didn't already snap to a guide on that axis
      if (snapEnabled && typeof window !== "undefined") {
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const edgeThreshold = EDGE_SNAP_THRESHOLD;

        // Snap to left edge (only if not already guide-snapped on X)
        if (!wasGuidedX && Math.abs(newPosition.x) < edgeThreshold) {
          newPosition.x = 0;
        }
        // Snap to right edge (only if not already guide-snapped on X)
        else if (
          !wasGuidedX &&
          Math.abs(newPosition.x + windowState.size.width - viewport.width) <
            edgeThreshold
        ) {
          newPosition.x = viewport.width - windowState.size.width;
        }

        // Snap to top edge (only if not already guide-snapped on Y)
        if (!wasGuidedY && Math.abs(newPosition.y) < edgeThreshold) {
          newPosition.y = 0;
        }
        // Snap to bottom edge (only if not already guide-snapped on Y)
        else if (
          !wasGuidedY &&
          Math.abs(newPosition.y + windowState.size.height - viewport.height) <
            edgeThreshold
        ) {
          newPosition.y = viewport.height - windowState.size.height;
        }
      }

      // Note: Collision detection is disabled - it was causing windows to snap back unexpectedly
      // Windows can overlap, which is often the desired behavior for UI panels

      // Store the committed position so we don't snap back before store updates
      committedPositionRef.current = newPosition;
      updatePosition(newPosition);

      // Clear dragging state and alignment guides
      setDraggingWindowId(null);
    },
    [
      windowState.size,
      updatePosition,
      snapToGuide,
      positionModifier,
      setDraggingWindowId,
      snapEnabled,
      EDGE_SNAP_THRESHOLD,
    ],
  );

  const { isDragging, delta, dragHandleProps } = useDrag({
    id: windowId,
    type: "window",
    disabled: !isUnlocked,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
  });

  // Clear committed position once store has caught up
  // This happens when we transition from dragging to not dragging and the store position matches
  if (wasDraggingRef.current && !isDragging && committedPositionRef.current) {
    // Check if store has caught up
    if (
      windowState.position.x === committedPositionRef.current.x &&
      windowState.position.y === committedPositionRef.current.y
    ) {
      committedPositionRef.current = null;
    }
  }
  wasDraggingRef.current = isDragging;

  // Calculate real-time position during drag
  // When dragging: use start position + delta (with modifiers applied)
  // When just finished dragging: use committed position (before store catches up)
  // Otherwise: use store position
  const displayPosition = useMemo(() => {
    if (isDragging) {
      const rawPosition = {
        x: dragStartPositionRef.current.x + delta.x,
        y: dragStartPositionRef.current.y + delta.y,
      };

      // Step 1: Apply viewport restriction modifier during drag for real-time feedback
      let position = rawPosition;
      if (positionModifier) {
        position = positionModifier({
          position: rawPosition,
          size: windowState.size,
          originalPosition: dragStartPositionRef.current,
          delta,
        });
      }

      // Step 2: Apply alignment guide snapping during drag (must match handleDragEnd)
      // This ensures the visual position matches what will be committed on mouse up
      const guidedPosition = snapToGuide(position, windowState.size);
      const wasGuidedX = guidedPosition.x !== position.x;
      const wasGuidedY = guidedPosition.y !== position.y;
      position = guidedPosition;

      // Step 3: Apply viewport edge snapping during drag (magnetic edges)
      // Only apply if we didn't already snap to a guide on that axis
      if (snapEnabled && typeof window !== "undefined") {
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const edgeThreshold = EDGE_SNAP_THRESHOLD;

        // Snap to left edge (only if not already guide-snapped on X)
        if (!wasGuidedX && Math.abs(position.x) < edgeThreshold) {
          position = { ...position, x: 0 };
        }
        // Snap to right edge (only if not already guide-snapped on X)
        else if (
          !wasGuidedX &&
          Math.abs(position.x + windowState.size.width - viewport.width) <
            edgeThreshold
        ) {
          position = {
            ...position,
            x: viewport.width - windowState.size.width,
          };
        }

        // Snap to top edge (only if not already guide-snapped on Y)
        if (!wasGuidedY && Math.abs(position.y) < edgeThreshold) {
          position = { ...position, y: 0 };
        }
        // Snap to bottom edge (only if not already guide-snapped on Y)
        else if (
          !wasGuidedY &&
          Math.abs(position.y + windowState.size.height - viewport.height) <
            edgeThreshold
        ) {
          position = {
            ...position,
            y: viewport.height - windowState.size.height,
          };
        }
      }

      return position;
    }
    return committedPositionRef.current || windowState.position;
  }, [
    isDragging,
    delta,
    windowState.size,
    windowState.position,
    positionModifier,
    snapToGuide,
    snapEnabled,
    EDGE_SNAP_THRESHOLD,
  ]);

  // Update alignment guides during drag
  // This calculates which edges align with other windows and updates the global store
  React.useEffect(() => {
    if (isDragging) {
      const guides = calculateGuides(displayPosition, windowState.size);
      setActiveGuides(guides);
    }
  }, [
    isDragging,
    displayPosition,
    windowState.size,
    calculateGuides,
    setActiveGuides,
  ]);

  if (!windowState.visible) {
    return null;
  }

  // Get themed styles
  const decorativeBorder = getDecorativeBorderStyle(theme);
  const glassStyle = getThemedGlassmorphismStyle(
    theme,
    windowState.transparency,
  );
  const windowShadow = getThemedWindowShadow(
    theme,
    isDragging ? "dragging" : "normal",
  );

  // Check if we're actively resizing (using resize handle)
  const isResizing = useEditStore((s) => s.isResizing);
  const resizingWindowId = useEditStore((s) => s.resizingWindowId);
  const isThisWindowResizing = isResizing && resizingWindowId === windowId;

  // Smooth transitions for size changes, disabled during active drag/resize
  const shouldAnimateSize = !isDragging && !isThisWindowResizing;
  const sizeTransition = shouldAnimateSize
    ? `width 0.15s ease-out, height 0.15s ease-out`
    : "none";

  // Tab combine visual feedback
  // When a tab is actively over this window: cyan glow (combine indicator)
  // When a tab is being dragged from another window: subtle border highlight
  const tabCombineStyle: React.CSSProperties = isTabCombineTarget
    ? {
        outline: "2px solid #00bcd4",
        outlineOffset: -2,
        boxShadow: `${windowShadow}, 0 0 16px rgba(0, 188, 212, 0.4), inset 0 0 8px rgba(0, 188, 212, 0.1)`,
      }
    : isTabDraggingFromOther
      ? {
          outline: "1px dashed rgba(0, 188, 212, 0.5)",
          outlineOffset: -1,
        }
      : {};

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: displayPosition.x,
    top: displayPosition.y,
    width: windowState.size.width,
    height: windowState.size.height,
    zIndex: windowState.zIndex,
    display: "flex",
    flexDirection: "column",
    borderRadius: 2, // Square corners with slight rounding
    ...decorativeBorder,
    boxShadow: windowShadow,
    overflow: "hidden",
    opacity: isDragging ? 0.95 : 1,
    transition: isDragging
      ? "none"
      : `box-shadow ${theme.transitions.fast}, ${sizeTransition}`,
    ...glassStyle,
    ...tabCombineStyle, // Apply tab combine visual feedback
    ...style,
  };

  // Title bar is removed - tabs now serve as the header
  // Drag handle props are passed to children via context or prop drilling

  // Content container: flex-1 to fill remaining space, but NO overflow: auto
  // Each panel handles its own scrolling to avoid nested scroll containers
  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0, // Allow flex shrinking
    overflow: "hidden", // Clip overflow, panels handle their own scroll
    position: "relative", // Allow absolute positioning of children
  };

  // Resize handles (only in edit mode)
  const renderResizeHandles = () => {
    if (!isUnlocked) return null;

    const handles: Array<{
      direction: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
      style: React.CSSProperties;
    }> = [
      // Edges
      {
        direction: "n",
        style: {
          top: 0,
          left: CORNER_SIZE,
          right: CORNER_SIZE,
          height: HANDLE_SIZE,
        },
      },
      {
        direction: "s",
        style: {
          bottom: 0,
          left: CORNER_SIZE,
          right: CORNER_SIZE,
          height: HANDLE_SIZE,
        },
      },
      {
        direction: "e",
        style: {
          right: 0,
          top: CORNER_SIZE,
          bottom: CORNER_SIZE,
          width: HANDLE_SIZE,
        },
      },
      {
        direction: "w",
        style: {
          left: 0,
          top: CORNER_SIZE,
          bottom: CORNER_SIZE,
          width: HANDLE_SIZE,
        },
      },
      // Corners
      {
        direction: "nw",
        style: { top: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
      },
      {
        direction: "ne",
        style: { top: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
      },
      {
        direction: "sw",
        style: { bottom: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
      },
      {
        direction: "se",
        style: { bottom: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
      },
    ];

    return handles.map(({ direction, style: handleStyle }) => {
      const props = getResizeHandleProps(direction);
      return (
        <div
          key={direction}
          {...props}
          data-resize-handle={direction}
          style={{
            position: "absolute",
            // High z-index to stay above content overlays (drag borders use z-40)
            zIndex: 100,
            ...handleStyle,
            ...props.style,
          }}
        />
      );
    });
  };

  // Clone children and pass drag handle props and close handler to TabBar
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // Pass drag props to first child (typically TabBar)
      return React.cloneElement(
        child as React.ReactElement<{
          dragHandleProps?: typeof dragHandleProps;
          onCloseWindow?: () => void;
          isUnlocked?: boolean;
        }>,
        {
          dragHandleProps,
          onCloseWindow: close,
          isUnlocked,
        },
      );
    }
    return child;
  });

  // Error handler wrapper for the error boundary
  const handleWindowError = React.useCallback(
    (error: Error) => {
      onError?.(error, windowId);
    },
    [onError, windowId],
  );

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={bringToFront}
      data-window-id={windowId}
    >
      {/* No title bar - TabBar serves as the header with drag functionality */}
      <div style={contentStyle}>
        <WindowErrorBoundary
          windowId={windowId}
          fallback={errorFallback}
          showErrorUI={showErrorUI}
          onError={(error) => handleWindowError(error)}
        >
          {childrenWithProps}
        </WindowErrorBoundary>
      </div>
      {renderResizeHandles()}
    </div>
  );
});
