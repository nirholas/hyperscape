import { useCallback, useMemo } from "react";
import { useEditStore } from "../../stores/editStore";
import type {
  AlignmentGuidesResult,
  AlignmentGuide,
  WindowState,
  Point,
  Size,
} from "../../types";

/** Snap threshold in pixels */
const SNAP_THRESHOLD = 8;

/** Edge positions for a window */
interface WindowEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

function getWindowEdges(window: WindowState): WindowEdges {
  return {
    left: window.position.x,
    right: window.position.x + window.size.width,
    top: window.position.y,
    bottom: window.position.y + window.size.height,
    centerX: window.position.x + window.size.width / 2,
    centerY: window.position.y + window.size.height / 2,
  };
}

/**
 * Hook for alignment guides during window dragging
 *
 * @example
 * ```tsx
 * function WindowDragHandler({ windowId }: { windowId: string }) {
 *   const { windows } = useWindowManager();
 *   const { window, updatePosition } = useWindow(windowId);
 *   const { guides, snapToGuide } = useAlignmentGuides(windows, windowId);
 *
 *   const handleDrag = (delta: Point) => {
 *     const newPosition = {
 *       x: window.position.x + delta.x,
 *       y: window.position.y + delta.y,
 *     };
 *
 *     const snapped = snapToGuide(newPosition, window.size);
 *     updatePosition(snapped);
 *   };
 *
 *   return (
 *     <>
 *       {guides.map((guide, i) => (
 *         <div
 *           key={i}
 *           style={{
 *             position: 'absolute',
 *             [guide.edge.includes('X') || guide.edge === 'left' || guide.edge === 'right'
 *               ? 'left' : 'top']: guide.position,
 *             [guide.edge.includes('Y') || guide.edge === 'top' || guide.edge === 'bottom'
 *               ? 'height' : 'width']: 1,
 *             background: 'cyan',
 *           }}
 *         />
 *       ))}
 *     </>
 *   );
 * }
 * ```
 */
export function useAlignmentGuides(
  windows: WindowState[],
  activeWindowId: string | null,
): AlignmentGuidesResult {
  const showGuides = useEditStore((s) => s.showGuides);
  const snapEnabled = useEditStore((s) => s.snapEnabled);

  // Get edges of all other windows
  const otherWindowEdges = useMemo(() => {
    if (!activeWindowId) return [];

    return windows
      .filter((w) => w.id !== activeWindowId && w.visible)
      .map((w) => ({
        windowId: w.id,
        edges: getWindowEdges(w),
      }));
  }, [windows, activeWindowId]);

  // Calculate guides based on active window position and size
  const calculateGuides = useCallback(
    (position: Point, size: Size): AlignmentGuide[] => {
      if (!showGuides || !snapEnabled || otherWindowEdges.length === 0) {
        return [];
      }

      const activeEdges: WindowEdges = {
        left: position.x,
        right: position.x + size.width,
        top: position.y,
        bottom: position.y + size.height,
        centerX: position.x + size.width / 2,
        centerY: position.y + size.height / 2,
      };

      const guides: AlignmentGuide[] = [];

      otherWindowEdges.forEach(({ windowId, edges }) => {
        // Check left edge alignments
        if (Math.abs(activeEdges.left - edges.left) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "left",
            position: edges.left,
            targetWindowId: windowId,
          });
        }
        if (Math.abs(activeEdges.left - edges.right) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "left",
            position: edges.right,
            targetWindowId: windowId,
          });
        }

        // Check right edge alignments
        if (Math.abs(activeEdges.right - edges.left) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "right",
            position: edges.left,
            targetWindowId: windowId,
          });
        }
        if (Math.abs(activeEdges.right - edges.right) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "right",
            position: edges.right,
            targetWindowId: windowId,
          });
        }

        // Check top edge alignments
        if (Math.abs(activeEdges.top - edges.top) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "top",
            position: edges.top,
            targetWindowId: windowId,
          });
        }
        if (Math.abs(activeEdges.top - edges.bottom) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "top",
            position: edges.bottom,
            targetWindowId: windowId,
          });
        }

        // Check bottom edge alignments
        if (Math.abs(activeEdges.bottom - edges.top) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "bottom",
            position: edges.top,
            targetWindowId: windowId,
          });
        }
        if (Math.abs(activeEdges.bottom - edges.bottom) <= SNAP_THRESHOLD) {
          guides.push({
            type: "edge",
            edge: "bottom",
            position: edges.bottom,
            targetWindowId: windowId,
          });
        }

        // Check center alignments
        if (Math.abs(activeEdges.centerX - edges.centerX) <= SNAP_THRESHOLD) {
          guides.push({
            type: "center",
            edge: "centerX",
            position: edges.centerX,
            targetWindowId: windowId,
          });
        }
        if (Math.abs(activeEdges.centerY - edges.centerY) <= SNAP_THRESHOLD) {
          guides.push({
            type: "center",
            edge: "centerY",
            position: edges.centerY,
            targetWindowId: windowId,
          });
        }
      });

      // Check viewport center alignment
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : 1920;
      const viewportHeight =
        typeof window !== "undefined" ? window.innerHeight : 1080;
      const viewportCenterX = viewportWidth / 2;
      const viewportCenterY = viewportHeight / 2;

      // Check if window center aligns with viewport center (horizontal)
      if (Math.abs(activeEdges.centerX - viewportCenterX) <= SNAP_THRESHOLD) {
        guides.push({
          type: "center",
          edge: "centerX",
          position: viewportCenterX,
          targetWindowId: "viewport",
        });
      }

      // Check if window center aligns with viewport center (vertical)
      if (Math.abs(activeEdges.centerY - viewportCenterY) <= SNAP_THRESHOLD) {
        guides.push({
          type: "center",
          edge: "centerY",
          position: viewportCenterY,
          targetWindowId: "viewport",
        });
      }

      return guides;
    },
    [showGuides, snapEnabled, otherWindowEdges],
  );

  const snapToGuide = useCallback(
    (position: Point, windowSize: Size): Point => {
      if (!snapEnabled || otherWindowEdges.length === 0) {
        return position;
      }

      let { x, y } = position;
      const activeEdges: WindowEdges = {
        left: position.x,
        right: position.x + windowSize.width,
        top: position.y,
        bottom: position.y + windowSize.height,
        centerX: position.x + windowSize.width / 2,
        centerY: position.y + windowSize.height / 2,
      };

      let snappedX = false;
      let snappedY = false;

      otherWindowEdges.forEach(({ edges }) => {
        if (!snappedX) {
          // Snap left edge
          if (Math.abs(activeEdges.left - edges.left) <= SNAP_THRESHOLD) {
            x = edges.left;
            snappedX = true;
          } else if (
            Math.abs(activeEdges.left - edges.right) <= SNAP_THRESHOLD
          ) {
            x = edges.right;
            snappedX = true;
          }
          // Snap right edge
          else if (Math.abs(activeEdges.right - edges.left) <= SNAP_THRESHOLD) {
            x = edges.left - windowSize.width;
            snappedX = true;
          } else if (
            Math.abs(activeEdges.right - edges.right) <= SNAP_THRESHOLD
          ) {
            x = edges.right - windowSize.width;
            snappedX = true;
          }
          // Snap center X
          else if (
            Math.abs(activeEdges.centerX - edges.centerX) <= SNAP_THRESHOLD
          ) {
            x = edges.centerX - windowSize.width / 2;
            snappedX = true;
          }
        }

        if (!snappedY) {
          // Snap top edge
          if (Math.abs(activeEdges.top - edges.top) <= SNAP_THRESHOLD) {
            y = edges.top;
            snappedY = true;
          } else if (
            Math.abs(activeEdges.top - edges.bottom) <= SNAP_THRESHOLD
          ) {
            y = edges.bottom;
            snappedY = true;
          }
          // Snap bottom edge
          else if (Math.abs(activeEdges.bottom - edges.top) <= SNAP_THRESHOLD) {
            y = edges.top - windowSize.height;
            snappedY = true;
          } else if (
            Math.abs(activeEdges.bottom - edges.bottom) <= SNAP_THRESHOLD
          ) {
            y = edges.bottom - windowSize.height;
            snappedY = true;
          }
          // Snap center Y
          else if (
            Math.abs(activeEdges.centerY - edges.centerY) <= SNAP_THRESHOLD
          ) {
            y = edges.centerY - windowSize.height / 2;
            snappedY = true;
          }
        }
      });

      // Snap to viewport center if not already snapped
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : 1920;
      const viewportHeight =
        typeof window !== "undefined" ? window.innerHeight : 1080;
      const viewportCenterX = viewportWidth / 2;
      const viewportCenterY = viewportHeight / 2;

      if (!snappedX) {
        if (Math.abs(activeEdges.centerX - viewportCenterX) <= SNAP_THRESHOLD) {
          x = viewportCenterX - windowSize.width / 2;
        }
      }

      if (!snappedY) {
        if (Math.abs(activeEdges.centerY - viewportCenterY) <= SNAP_THRESHOLD) {
          y = viewportCenterY - windowSize.height / 2;
        }
      }

      return { x, y };
    },
    [snapEnabled, otherWindowEdges],
  );

  return {
    guides: [] as AlignmentGuide[],
    snapToGuide,
    calculateGuides,
  };
}
