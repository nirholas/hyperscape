import { useCallback, useRef, useEffect } from "react";
import { useWindowStore } from "../../stores/windowStore";
import { useEditStore } from "../../stores/editStore";
import type { ResizeDirection, Point, Size } from "../../types";
import { clamp } from "../drag/utils";
import { getViewportSize } from "../drag/modifiers";

/** Snap a value to the nearest grid unit */
function snapToGrid(value: number, gridSize: number, enabled: boolean): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** Resize handle props for a specific direction */
interface ResizeHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  style: {
    cursor: string;
    touchAction: string;
  };
}

/** Return value from useResize hook */
interface ResizeResult {
  /** Get props for a specific resize handle */
  getResizeHandleProps: (direction: ResizeDirection) => ResizeHandleProps;
  /** Whether currently resizing */
  isResizing: boolean;
  /** Current resize direction (if resizing) */
  resizeDirection: ResizeDirection | null;
}

/** Cursor styles for each direction */
const CURSOR_MAP: Record<ResizeDirection, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

/**
 * Hook to handle window resizing from 8 directions
 *
 * @example
 * ```tsx
 * function ResizableWindow({ id }: { id: string }) {
 *   const { window } = useWindow(id);
 *   const { getResizeHandleProps, isResizing } = useResize(id);
 *
 *   return (
 *     <div style={{ position: 'relative', width: window.size.width, height: window.size.height }}>
 *       <div {...getResizeHandleProps('n')} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8 }} />
 *       <div {...getResizeHandleProps('s')} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8 }} />
 *       <div {...getResizeHandleProps('e')} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 8 }} />
 *       <div {...getResizeHandleProps('w')} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 8 }} />
 *       <div {...getResizeHandleProps('ne')} style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12 }} />
 *       <div {...getResizeHandleProps('nw')} style={{ position: 'absolute', top: 0, left: 0, width: 12, height: 12 }} />
 *       <div {...getResizeHandleProps('se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12 }} />
 *       <div {...getResizeHandleProps('sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: 12, height: 12 }} />
 *       Content
 *     </div>
 *   );
 * }
 * ```
 */
export function useResize(windowId: string): ResizeResult {
  const window = useWindowStore((s) => s.windows.get(windowId));
  const updateWindow = useWindowStore((s) => s.updateWindow);
  const snapEnabled = useEditStore((s) => s.snapEnabled);
  const gridSize = useEditStore((s) => s.gridSize);
  const restrictToViewport = useEditStore((s) => s.restrictToViewport);
  const startResizeStore = useEditStore((s) => s.startResize);
  const endResizeStore = useEditStore((s) => s.endResize);

  const resizingRef = useRef<{
    direction: ResizeDirection;
    startPointer: Point;
    startPosition: Point;
    startSize: Size;
    pointerId: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (direction: ResizeDirection, e: React.PointerEvent) => {
      if (!window) return;

      e.preventDefault();
      e.stopPropagation();

      resizingRef.current = {
        direction,
        startPointer: { x: e.clientX, y: e.clientY },
        startPosition: { ...window.position },
        startSize: { ...window.size },
        pointerId: e.pointerId,
      };

      // Notify edit store that resizing has started
      startResizeStore(windowId);

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [window, windowId, startResizeStore],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!resizingRef.current || !window) return;
      if (resizingRef.current.pointerId !== e.pointerId) return;

      const { direction, startPointer, startPosition, startSize } =
        resizingRef.current;

      const dx = e.clientX - startPointer.x;
      const dy = e.clientY - startPointer.y;

      let newX = startPosition.x;
      let newY = startPosition.y;
      let newWidth = startSize.width;
      let newHeight = startSize.height;

      const minWidth = window.minSize.width;
      const minHeight = window.minSize.height;
      const maxWidth = window.maxSize?.width ?? Infinity;
      const maxHeight = window.maxSize?.height ?? Infinity;
      const aspectRatio = window.aspectRatio;

      // Check if this window has uncapped sizing (no maxSize set)
      // When uncapped, we allow resizing beyond viewport bounds
      const hasUncappedSize = !window.maxSize;

      // Viewport bounds
      const viewport = getViewportSize();
      const edgeThreshold = 10;

      // For aspect ratio windows, determine the dominant resize direction for corners
      // and compute size from a single delta value
      if (aspectRatio && aspectRatio > 0) {
        // For corners, use the larger movement to determine new size
        // For edges, calculate the opposite dimension from aspect ratio
        const isCorner = direction.length === 2;

        // Calculate min/max that respect aspect ratio
        const minSizeByWidth = minWidth;
        const minSizeByHeight = Math.round(minHeight * aspectRatio);
        const effectiveMinWidth = Math.max(minSizeByWidth, minSizeByHeight);
        const effectiveMinHeight = Math.round(effectiveMinWidth / aspectRatio);

        // Handle Infinity properly for max sizes
        const maxSizeByWidth = maxWidth;
        const maxSizeByHeight =
          maxHeight === Infinity
            ? Infinity
            : Math.round(maxHeight * aspectRatio);
        const effectiveMaxWidth = Math.min(maxSizeByWidth, maxSizeByHeight);
        const effectiveMaxHeight =
          effectiveMaxWidth === Infinity
            ? Infinity
            : Math.round(effectiveMaxWidth / aspectRatio);

        if (isCorner) {
          // Determine which direction has larger movement
          // Use the larger of dx or dy (accounting for direction signs)
          const effectiveDx = direction.includes("e")
            ? dx
            : direction.includes("w")
              ? -dx
              : 0;
          const effectiveDy = direction.includes("s")
            ? dy
            : direction.includes("n")
              ? -dy
              : 0;

          // Use the larger delta to determine new size
          const delta =
            Math.abs(effectiveDx) > Math.abs(effectiveDy)
              ? effectiveDx
              : effectiveDy;

          // Calculate new width and clamp to effective min/max
          newWidth = startSize.width + delta;
          newWidth = snapToGrid(newWidth, gridSize, snapEnabled);
          newWidth = clamp(newWidth, effectiveMinWidth, effectiveMaxWidth);
          newHeight = Math.round(newWidth / aspectRatio);
        } else {
          // Edge resize - width or height changes, other dimension follows
          if (direction === "e" || direction === "w") {
            // Width changes, height follows
            const widthDelta = direction === "e" ? dx : -dx;
            newWidth = startSize.width + widthDelta;
            newWidth = snapToGrid(newWidth, gridSize, snapEnabled);
            newWidth = clamp(newWidth, effectiveMinWidth, effectiveMaxWidth);
            newHeight = Math.round(newWidth / aspectRatio);
          } else {
            // Height changes, width follows
            const heightDelta = direction === "s" ? dy : -dy;
            newHeight = startSize.height + heightDelta;
            newHeight = snapToGrid(newHeight, gridSize, snapEnabled);
            newHeight = clamp(
              newHeight,
              effectiveMinHeight,
              effectiveMaxHeight,
            );
            newWidth = Math.round(newHeight * aspectRatio);
          }
        }

        // Viewport restrictions for aspect ratio windows
        // Skip viewport restrictions if this window has uncapped sizing (no maxSize)
        if (restrictToViewport && !hasUncappedSize) {
          // Check right edge
          if (newX + newWidth > viewport.width) {
            newWidth = viewport.width - newX;
            newWidth = clamp(newWidth, effectiveMinWidth, effectiveMaxWidth);
            newHeight = Math.round(newWidth / aspectRatio);
          }
          // Check bottom edge
          if (newY + newHeight > viewport.height) {
            newHeight = viewport.height - newY;
            newHeight = clamp(
              newHeight,
              effectiveMinHeight,
              effectiveMaxHeight,
            );
            newWidth = Math.round(newHeight * aspectRatio);
          }
        }

        // Adjust position AFTER final size is determined (for w/n directions)
        if (direction.includes("w")) {
          newX = startPosition.x + startSize.width - newWidth;
          // Clamp to viewport left edge
          if (restrictToViewport && newX < 0) {
            newX = 0;
          }
        }
        if (direction.includes("n")) {
          newY = startPosition.y + startSize.height - newHeight;
          // Clamp to viewport top edge
          if (restrictToViewport && newY < 0) {
            newY = 0;
          }
        }

        updateWindow(windowId, {
          position: { x: newX, y: newY },
          size: { width: newWidth, height: newHeight },
        });
        return;
      }

      // Non-aspect-ratio resize handling (original logic)
      // Handle each direction with optional viewport boundaries (based on restrictToViewport setting)
      // Track if hard clamp was applied (to skip redundant soft edge snapping)
      let hardClampAppliedX = false;
      let hardClampAppliedY = false;

      if (direction.includes("e")) {
        newWidth = clamp(startSize.width + dx, minWidth, maxWidth);
        // Snap width to grid
        newWidth = snapToGrid(newWidth, gridSize, snapEnabled);
        newWidth = clamp(newWidth, minWidth, maxWidth);
        // Hard clamp: don't let right edge go past viewport (when enabled and not uncapped)
        if (restrictToViewport && !hasUncappedSize) {
          const maxAllowedWidth = viewport.width - newX;
          if (newWidth > maxAllowedWidth) {
            newWidth = maxAllowedWidth;
            hardClampAppliedX = true;
          }
        }
        // Soft snap right edge to viewport (only if NOT already hard-clamped)
        // This prevents oscillation when dragging past the boundary
        if (
          !hardClampAppliedX &&
          snapEnabled &&
          Math.abs(newX + newWidth - viewport.width) < edgeThreshold
        ) {
          const snapWidth = viewport.width - newX;
          if (snapWidth >= minWidth && snapWidth <= maxWidth) {
            newWidth = snapWidth;
          }
        }
      }
      if (direction.includes("w")) {
        // Calculate new width from drag delta (west resize = shrink when dx > 0)
        newWidth = clamp(startSize.width - dx, minWidth, maxWidth);
        // Snap WIDTH to grid (not position) - same as east direction
        newWidth = snapToGrid(newWidth, gridSize, snapEnabled);
        newWidth = clamp(newWidth, minWidth, maxWidth);

        // Calculate position from the snapped width (maintain right edge position)
        const rightEdge = startPosition.x + startSize.width;
        newX = rightEdge - newWidth;

        // Hard clamp: don't let left edge go past viewport left (when enabled and not uncapped)
        if (restrictToViewport && !hasUncappedSize && newX < 0) {
          newX = 0;
          newWidth = rightEdge; // Expand to fill from left edge to original right edge
          newWidth = clamp(newWidth, minWidth, maxWidth);
          hardClampAppliedX = true;
        }

        // Soft snap left edge to viewport (only if close and not already clamped)
        if (
          !hardClampAppliedX &&
          snapEnabled &&
          Math.abs(newX) < edgeThreshold
        ) {
          if (rightEdge >= minWidth && rightEdge <= maxWidth) {
            newX = 0;
            newWidth = rightEdge;
          }
        }
      }
      if (direction.includes("s")) {
        newHeight = clamp(startSize.height + dy, minHeight, maxHeight);
        // Snap height to grid
        newHeight = snapToGrid(newHeight, gridSize, snapEnabled);
        newHeight = clamp(newHeight, minHeight, maxHeight);
        // Hard clamp: don't let bottom edge go past viewport (when enabled and not uncapped)
        if (restrictToViewport && !hasUncappedSize) {
          const maxAllowedHeight = viewport.height - newY;
          if (newHeight > maxAllowedHeight) {
            newHeight = maxAllowedHeight;
            hardClampAppliedY = true;
          }
        }
        // Soft snap bottom edge to viewport (only if NOT already hard-clamped)
        if (
          !hardClampAppliedY &&
          snapEnabled &&
          Math.abs(newY + newHeight - viewport.height) < edgeThreshold
        ) {
          const snapHeight = viewport.height - newY;
          if (snapHeight >= minHeight && snapHeight <= maxHeight) {
            newHeight = snapHeight;
          }
        }
      }
      if (direction.includes("n")) {
        // Calculate new height from drag delta (north resize = shrink when dy > 0)
        newHeight = clamp(startSize.height - dy, minHeight, maxHeight);
        // Snap HEIGHT to grid (not position) - same as south direction
        newHeight = snapToGrid(newHeight, gridSize, snapEnabled);
        newHeight = clamp(newHeight, minHeight, maxHeight);

        // Calculate position from the snapped height (maintain bottom edge position)
        const bottomEdge = startPosition.y + startSize.height;
        newY = bottomEdge - newHeight;

        // Hard clamp: don't let top edge go past viewport top (when enabled and not uncapped)
        if (restrictToViewport && !hasUncappedSize && newY < 0) {
          newY = 0;
          newHeight = bottomEdge; // Expand to fill from top edge to original bottom edge
          newHeight = clamp(newHeight, minHeight, maxHeight);
          hardClampAppliedY = true;
        }

        // Soft snap top edge to viewport (only if close and not already clamped)
        if (
          !hardClampAppliedY &&
          snapEnabled &&
          Math.abs(newY) < edgeThreshold
        ) {
          if (bottomEdge >= minHeight && bottomEdge <= maxHeight) {
            newY = 0;
            newHeight = bottomEdge;
          }
        }
      }

      // Final clamp to ensure we never exceed viewport (when restrictToViewport is enabled and not uncapped)
      if (restrictToViewport && !hasUncappedSize) {
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);
        if (newX + newWidth > viewport.width) {
          newWidth = viewport.width - newX;
        }
        if (newY + newHeight > viewport.height) {
          newHeight = viewport.height - newY;
        }
      }

      updateWindow(windowId, {
        position: { x: newX, y: newY },
        size: { width: newWidth, height: newHeight },
      });
    },
    [window, windowId, updateWindow, snapEnabled, gridSize, restrictToViewport],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!resizingRef.current) return;
      if (resizingRef.current.pointerId !== e.pointerId) return;

      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      resizingRef.current = null;

      // Notify edit store that resizing has ended
      endResizeStore();
    },
    [endResizeStore],
  );

  // Add global listeners
  useEffect(() => {
    const globalWindow = typeof globalThis !== "undefined" ? globalThis : self;
    globalWindow.addEventListener(
      "pointermove",
      handlePointerMove as EventListener,
    );
    globalWindow.addEventListener(
      "pointerup",
      handlePointerUp as EventListener,
    );
    globalWindow.addEventListener(
      "pointercancel",
      handlePointerUp as EventListener,
    );

    return () => {
      globalWindow.removeEventListener(
        "pointermove",
        handlePointerMove as EventListener,
      );
      globalWindow.removeEventListener(
        "pointerup",
        handlePointerUp as EventListener,
      );
      globalWindow.removeEventListener(
        "pointercancel",
        handlePointerUp as EventListener,
      );
    };
  }, [handlePointerMove, handlePointerUp]);

  const getResizeHandleProps = useCallback(
    (direction: ResizeDirection): ResizeHandleProps => {
      return {
        onPointerDown: (e) => handlePointerDown(direction, e),
        style: {
          cursor: CURSOR_MAP[direction],
          touchAction: "none",
        },
      };
    },
    [handlePointerDown],
  );

  return {
    getResizeHandleProps,
    isResizing: resizingRef.current !== null,
    resizeDirection: resizingRef.current?.direction ?? null,
  };
}
