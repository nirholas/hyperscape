import { useCallback } from "react";
import { useEditStore } from "../../stores/editStore";
import type { Point, Size, Rect } from "../../types";

/** Snap result with snapped position and whether snap occurred */
interface SnapResult {
  position: Point;
  snapped: boolean;
  snappedX: boolean;
  snappedY: boolean;
}

/** Return value from useSnap hook */
interface UseSnapResult {
  /** Snap a position to the grid */
  snapToGrid: (position: Point) => SnapResult;
  /** Snap a rectangle to viewport edges */
  snapToEdges: (rect: Rect, viewport: Size, threshold?: number) => SnapResult;
  /** Combined snap (grid + edges) */
  snap: (position: Point, size: Size, viewport: Size) => SnapResult;
  /** Whether snapping is enabled */
  snapEnabled: boolean;
  /** Current grid size */
  gridSize: number;
}

/**
 * Hook for snapping positions to grid and edges
 *
 * @example
 * ```tsx
 * function DraggableWindow({ id }: { id: string }) {
 *   const { window, updatePosition } = useWindow(id);
 *   const { snap, snapEnabled } = useSnap();
 *
 *   const handleDragEnd = (delta: Point) => {
 *     const newPosition = {
 *       x: window.position.x + delta.x,
 *       y: window.position.y + delta.y,
 *     };
 *
 *     if (snapEnabled) {
 *       const { position } = snap(
 *         newPosition,
 *         window.size,
 *         { width: window.innerWidth, height: window.innerHeight }
 *       );
 *       updatePosition(position);
 *     } else {
 *       updatePosition(newPosition);
 *     }
 *   };
 * }
 * ```
 */
export function useSnap(): UseSnapResult {
  const snapEnabled = useEditStore((s) => s.snapEnabled);
  const gridSize = useEditStore((s) => s.gridSize);

  const snapToGrid = useCallback(
    (position: Point): SnapResult => {
      if (!snapEnabled || gridSize <= 0) {
        return {
          position,
          snapped: false,
          snappedX: false,
          snappedY: false,
        };
      }

      const snappedX = Math.round(position.x / gridSize) * gridSize;
      const snappedY = Math.round(position.y / gridSize) * gridSize;

      return {
        position: { x: snappedX, y: snappedY },
        snapped: snappedX !== position.x || snappedY !== position.y,
        snappedX: snappedX !== position.x,
        snappedY: snappedY !== position.y,
      };
    },
    [snapEnabled, gridSize],
  );

  const snapToEdges = useCallback(
    (rect: Rect, viewport: Size, threshold: number = 10): SnapResult => {
      if (!snapEnabled) {
        return {
          position: { x: rect.x, y: rect.y },
          snapped: false,
          snappedX: false,
          snappedY: false,
        };
      }

      let { x, y } = rect;
      let snappedX = false;
      let snappedY = false;

      // Left edge
      if (Math.abs(x) < threshold) {
        x = 0;
        snappedX = true;
      }
      // Right edge
      else if (Math.abs(x + rect.width - viewport.width) < threshold) {
        x = viewport.width - rect.width;
        snappedX = true;
      }

      // Top edge
      if (Math.abs(y) < threshold) {
        y = 0;
        snappedY = true;
      }
      // Bottom edge
      else if (Math.abs(y + rect.height - viewport.height) < threshold) {
        y = viewport.height - rect.height;
        snappedY = true;
      }

      return {
        position: { x, y },
        snapped: snappedX || snappedY,
        snappedX,
        snappedY,
      };
    },
    [snapEnabled],
  );

  const snap = useCallback(
    (position: Point, size: Size, viewport: Size): SnapResult => {
      if (!snapEnabled) {
        return {
          position,
          snapped: false,
          snappedX: false,
          snappedY: false,
        };
      }

      // First snap to grid
      const gridResult = snapToGrid(position);

      // Then snap to edges (with higher priority)
      const edgeResult = snapToEdges(
        { ...gridResult.position, ...size },
        viewport,
      );

      return {
        position: edgeResult.position,
        snapped: gridResult.snapped || edgeResult.snapped,
        snappedX: edgeResult.snappedX || gridResult.snappedX,
        snappedY: edgeResult.snappedY || gridResult.snappedY,
      };
    },
    [snapEnabled, snapToGrid, snapToEdges],
  );

  return {
    snapToGrid,
    snapToEdges,
    snap,
    snapEnabled,
    gridSize,
  };
}
