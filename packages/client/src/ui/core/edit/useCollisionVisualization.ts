/**
 * Collision Visualization Hook
 *
 * Provides visual feedback during window dragging by detecting
 * overlaps with other windows and returning appropriate outline colors.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { rectIntersection } from "../drag/collisionDetection";
import type { WindowState, Point, Size } from "../../types";

/**
 * Outline color states for collision visualization
 * - orange: Valid placement, snapping to grid
 * - red: Collision detected, overlaps with other windows
 * - green: Perfect alignment with another window edge
 * - null: No visualization (not dragging)
 */
export type OutlineColor = "orange" | "red" | "green" | null;

/**
 * Result of collision visualization calculation
 */
export interface CollisionVisualizationResult {
  /** Current outline color for the dragged window */
  outlineColor: OutlineColor;
  /** IDs of windows that would overlap if dropped here */
  collidingWindowIds: string[];
  /** Whether the current position is valid for drop */
  isValidPlacement: boolean;
  /** Warning message to display (e.g., "Overlaps with Inventory") */
  warningMessage: string | null;
  /** CSS outline style to apply to the dragged window */
  outlineStyle: React.CSSProperties;
}

/**
 * Options for collision visualization
 */
export interface CollisionVisualizationOptions {
  /** Whether to allow overlapping windows (default: true - warning only) */
  allowOverlap?: boolean;
  /** Outline width in pixels (default: 2) */
  outlineWidth?: number;
  /** Enable green glow for perfect alignment (default: true) */
  showAlignmentGlow?: boolean;
}

const OUTLINE_COLORS = {
  orange: "#FF9800",
  red: "#F44336",
  green: "#4CAF50",
} as const;

/**
 * Hook for visualizing window collision during drag operations
 *
 * @param windows - All windows in the interface
 * @param draggedWindowId - ID of the currently dragged window (null if not dragging)
 * @param dragPosition - Current drag position (null if not dragging)
 * @param dragSize - Size of the dragged window (null if not dragging)
 * @param options - Visualization options
 * @returns Collision visualization result with outline color and styles
 *
 * @example
 * ```tsx
 * function WindowDragHandler({ windowId }: { windowId: string }) {
 *   const { windows } = useWindowManager();
 *   const [dragPos, setDragPos] = useState<Point | null>(null);
 *   const window = windows.find(w => w.id === windowId);
 *
 *   const { outlineStyle, warningMessage } = useCollisionVisualization(
 *     windows,
 *     windowId,
 *     dragPos,
 *     window?.size ?? null
 *   );
 *
 *   return (
 *     <div style={outlineStyle}>
 *       {warningMessage && <span className="warning">{warningMessage}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCollisionVisualization(
  windows: WindowState[],
  draggedWindowId: string | null,
  dragPosition: Point | null,
  dragSize: Size | null,
  options: CollisionVisualizationOptions = {},
): CollisionVisualizationResult {
  const {
    allowOverlap = true,
    outlineWidth = 2,
    showAlignmentGlow = true,
  } = options;

  return useMemo(() => {
    // Not dragging - no visualization
    if (!draggedWindowId || !dragPosition || !dragSize) {
      return {
        outlineColor: null,
        collidingWindowIds: [],
        isValidPlacement: true,
        warningMessage: null,
        outlineStyle: {},
      };
    }

    // Build drag rect
    const dragRect = {
      x: dragPosition.x,
      y: dragPosition.y,
      width: dragSize.width,
      height: dragSize.height,
    };

    // Get other visible windows
    const otherWindows = windows.filter(
      (w) => w.id !== draggedWindowId && w.visible,
    );

    // Build target rects map
    const targets = new Map(
      otherWindows.map((w) => [
        w.id,
        {
          x: w.position.x,
          y: w.position.y,
          width: w.size.width,
          height: w.size.height,
        },
      ]),
    );

    // Detect collisions
    const collisions = rectIntersection(dragRect, targets);
    const collidingIds = collisions.map((c) => c.id);

    // Determine outline color and state
    let outlineColor: OutlineColor;
    let isValidPlacement: boolean;
    let warningMessage: string | null = null;

    if (collidingIds.length > 0) {
      // Collision detected
      outlineColor = "red";
      isValidPlacement = allowOverlap;

      // Build warning message with window titles
      const collidingNames = collidingIds
        .map((id) => {
          const win = windows.find((w) => w.id === id);
          // Use first tab label or window id
          return win?.tabs[0]?.label ?? id;
        })
        .slice(0, 3); // Limit to 3 names

      if (collidingNames.length === 1) {
        warningMessage = `Overlaps with ${collidingNames[0]}`;
      } else if (collidingNames.length === 2) {
        warningMessage = `Overlaps with ${collidingNames[0]} and ${collidingNames[1]}`;
      } else {
        warningMessage = `Overlaps with ${collidingNames[0]}, ${collidingNames[1]}, and ${collidingIds.length - 2} more`;
      }
    } else {
      // No collision - valid placement
      outlineColor = "orange";
      isValidPlacement = true;
    }

    // Build outline style
    const color = outlineColor ? OUTLINE_COLORS[outlineColor] : "transparent";
    const outlineStyle: React.CSSProperties = {
      outline: `${outlineWidth}px solid ${color}`,
      outlineOffset: -outlineWidth,
    };

    // Add warning glow for collisions
    if (outlineColor === "red") {
      outlineStyle.boxShadow = `0 0 8px ${OUTLINE_COLORS.red}40`;
    } else if (showAlignmentGlow && outlineColor === "orange") {
      // Add subtle glow for valid placement
      outlineStyle.boxShadow = `0 0 6px ${OUTLINE_COLORS.orange}60`;
    }

    return {
      outlineColor,
      collidingWindowIds: collidingIds,
      isValidPlacement,
      warningMessage,
      outlineStyle,
    };
  }, [
    windows,
    draggedWindowId,
    dragPosition,
    dragSize,
    allowOverlap,
    outlineWidth,
    showAlignmentGlow,
  ]);
}

/**
 * Check if a position would result in a collision
 * Utility function for imperative collision checking
 */
export function checkCollision(
  windows: WindowState[],
  windowId: string,
  position: Point,
  size: Size,
): { hasCollision: boolean; collidingIds: string[] } {
  const dragRect = {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };

  const otherWindows = windows.filter((w) => w.id !== windowId && w.visible);
  const targets = new Map(
    otherWindows.map((w) => [
      w.id,
      {
        x: w.position.x,
        y: w.position.y,
        width: w.size.width,
        height: w.size.height,
      },
    ]),
  );

  const collisions = rectIntersection(dragRect, targets);
  const collidingIds = collisions.map((c) => c.id);

  return {
    hasCollision: collidingIds.length > 0,
    collidingIds,
  };
}
