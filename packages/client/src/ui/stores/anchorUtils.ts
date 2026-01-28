/**
 * Anchor Utilities for Responsive Window Positioning
 *
 * Based on Unity/Unreal UI best practices, windows maintain their position
 * relative to an anchor point (corner, edge, or center) on the viewport.
 * When the viewport resizes, positions are recalculated from the anchor.
 *
 * @packageDocumentation
 */

import type { Point, Size, WindowAnchor } from "../types";

/** Viewport dimensions */
export interface Viewport {
  width: number;
  height: number;
}

/** Offset from anchor point */
export interface AnchorOffset {
  x: number;
  y: number;
}

/**
 * Get the viewport coordinates for an anchor point.
 *
 * @param anchor - The anchor type
 * @param viewport - Current viewport dimensions
 * @returns The anchor point coordinates on the viewport
 */
export function getAnchorPosition(
  anchor: WindowAnchor,
  viewport: Viewport,
): Point {
  switch (anchor) {
    case "top-left":
      return { x: 0, y: 0 };
    case "top-center":
      return { x: viewport.width / 2, y: 0 };
    case "top-right":
      return { x: viewport.width, y: 0 };
    case "left-center":
      return { x: 0, y: viewport.height / 2 };
    case "center":
      return { x: viewport.width / 2, y: viewport.height / 2 };
    case "right-center":
      return { x: viewport.width, y: viewport.height / 2 };
    case "bottom-left":
      return { x: 0, y: viewport.height };
    case "bottom-center":
      return { x: viewport.width / 2, y: viewport.height };
    case "bottom-right":
      return { x: viewport.width, y: viewport.height };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Calculate the offset from an anchor point to a window's position.
 *
 * For right/bottom anchors, the offset is from the anchor to the window's
 * corresponding edge (right edge for right anchors, bottom for bottom anchors).
 * For center anchors, the offset is from anchor to window center.
 * For left/top anchors, the offset is from anchor to window's top-left.
 *
 * @param position - Current window position (top-left corner)
 * @param size - Window size
 * @param anchor - The anchor type
 * @param viewport - Current viewport dimensions
 * @returns The offset from anchor to window reference point
 */
export function calculateOffsetFromAnchor(
  position: Point,
  size: Size,
  anchor: WindowAnchor,
  viewport: Viewport,
): AnchorOffset {
  const anchorPos = getAnchorPosition(anchor, viewport);

  // Determine which corner/edge of the window to measure from
  switch (anchor) {
    case "top-left":
      // Offset from top-left anchor to window's top-left
      return {
        x: position.x - anchorPos.x,
        y: position.y - anchorPos.y,
      };

    case "top-center":
      // Offset from top-center anchor to window's top-center
      return {
        x: position.x + size.width / 2 - anchorPos.x,
        y: position.y - anchorPos.y,
      };

    case "top-right":
      // Offset from top-right anchor to window's top-right (negative x means left of anchor)
      return {
        x: position.x + size.width - anchorPos.x,
        y: position.y - anchorPos.y,
      };

    case "left-center":
      // Offset from left-center to window's left-center
      return {
        x: position.x - anchorPos.x,
        y: position.y + size.height / 2 - anchorPos.y,
      };

    case "center":
      // Offset from center to window's center
      return {
        x: position.x + size.width / 2 - anchorPos.x,
        y: position.y + size.height / 2 - anchorPos.y,
      };

    case "right-center":
      // Offset from right-center to window's right-center
      return {
        x: position.x + size.width - anchorPos.x,
        y: position.y + size.height / 2 - anchorPos.y,
      };

    case "bottom-left":
      // Offset from bottom-left to window's bottom-left
      return {
        x: position.x - anchorPos.x,
        y: position.y + size.height - anchorPos.y,
      };

    case "bottom-center":
      // Offset from bottom-center to window's bottom-center
      return {
        x: position.x + size.width / 2 - anchorPos.x,
        y: position.y + size.height - anchorPos.y,
      };

    case "bottom-right":
      // Offset from bottom-right to window's bottom-right
      return {
        x: position.x + size.width - anchorPos.x,
        y: position.y + size.height - anchorPos.y,
      };

    default:
      return { x: position.x, y: position.y };
  }
}

/**
 * Calculate absolute position from an anchor point and offset.
 *
 * This is the inverse of calculateOffsetFromAnchor - given an offset
 * and anchor, compute the window's top-left position.
 *
 * @param offset - Offset from anchor to window reference point
 * @param size - Window size
 * @param anchor - The anchor type
 * @param viewport - Current viewport dimensions
 * @returns The window's top-left position
 */
export function calculatePositionFromAnchor(
  offset: AnchorOffset,
  size: Size,
  anchor: WindowAnchor,
  viewport: Viewport,
): Point {
  const anchorPos = getAnchorPosition(anchor, viewport);

  switch (anchor) {
    case "top-left":
      return {
        x: anchorPos.x + offset.x,
        y: anchorPos.y + offset.y,
      };

    case "top-center":
      return {
        x: anchorPos.x + offset.x - size.width / 2,
        y: anchorPos.y + offset.y,
      };

    case "top-right":
      return {
        x: anchorPos.x + offset.x - size.width,
        y: anchorPos.y + offset.y,
      };

    case "left-center":
      return {
        x: anchorPos.x + offset.x,
        y: anchorPos.y + offset.y - size.height / 2,
      };

    case "center":
      return {
        x: anchorPos.x + offset.x - size.width / 2,
        y: anchorPos.y + offset.y - size.height / 2,
      };

    case "right-center":
      return {
        x: anchorPos.x + offset.x - size.width,
        y: anchorPos.y + offset.y - size.height / 2,
      };

    case "bottom-left":
      return {
        x: anchorPos.x + offset.x,
        y: anchorPos.y + offset.y - size.height,
      };

    case "bottom-center":
      return {
        x: anchorPos.x + offset.x - size.width / 2,
        y: anchorPos.y + offset.y - size.height,
      };

    case "bottom-right":
      return {
        x: anchorPos.x + offset.x - size.width,
        y: anchorPos.y + offset.y - size.height,
      };

    default:
      return { x: offset.x, y: offset.y };
  }
}

/** Threshold in pixels for detecting edge proximity */
const EDGE_THRESHOLD = 100;

/**
 * Detect the nearest anchor based on window position.
 *
 * This auto-detects which anchor a window is closest to based on
 * its position relative to the viewport edges.
 *
 * @param position - Window position (top-left corner)
 * @param size - Window size
 * @param viewport - Current viewport dimensions
 * @returns The detected anchor point
 */
export function detectNearestAnchor(
  position: Point,
  size: Size,
  viewport: Viewport,
): WindowAnchor {
  const windowRight = position.x + size.width;
  const windowBottom = position.y + size.height;
  const windowCenterX = position.x + size.width / 2;
  const windowCenterY = position.y + size.height / 2;

  // Check horizontal alignment
  const nearLeft = position.x < EDGE_THRESHOLD;
  const nearRight = viewport.width - windowRight < EDGE_THRESHOLD;
  const nearHorizontalCenter =
    Math.abs(windowCenterX - viewport.width / 2) < EDGE_THRESHOLD;

  // Check vertical alignment
  const nearTop = position.y < EDGE_THRESHOLD;
  const nearBottom = viewport.height - windowBottom < EDGE_THRESHOLD;
  const nearVerticalCenter =
    Math.abs(windowCenterY - viewport.height / 2) < EDGE_THRESHOLD;

  // Determine anchor based on proximity to edges
  // Priority: corners > edges > center

  // Corners
  if (nearTop && nearLeft) return "top-left";
  if (nearTop && nearRight) return "top-right";
  if (nearBottom && nearLeft) return "bottom-left";
  if (nearBottom && nearRight) return "bottom-right";

  // Edges (horizontal center)
  if (nearTop && nearHorizontalCenter) return "top-center";
  if (nearBottom && nearHorizontalCenter) return "bottom-center";

  // Edges (vertical center)
  if (nearLeft && nearVerticalCenter) return "left-center";
  if (nearRight && nearVerticalCenter) return "right-center";

  // Center
  if (nearHorizontalCenter && nearVerticalCenter) return "center";

  // Default to corner/edge based on which edges are closest
  if (nearTop)
    return nearLeft ? "top-left" : nearRight ? "top-right" : "top-left";
  if (nearBottom)
    return nearLeft
      ? "bottom-left"
      : nearRight
        ? "bottom-right"
        : "bottom-left";
  if (nearLeft) return "top-left";
  if (nearRight) return "top-right";

  // Default fallback to top-left
  return "top-left";
}

/**
 * Get the default anchor for a window based on its ID.
 *
 * This provides sensible defaults for known panel types:
 * - Chat, Skills, Prayer -> bottom-left
 * - Minimap -> top-right
 * - Inventory, Equipment, Menubar -> bottom-right
 * - Actionbar -> bottom-center
 *
 * @param windowId - The window's unique identifier
 * @returns The default anchor for this window type
 */
export function getDefaultAnchor(windowId: string): WindowAnchor {
  const id = windowId.toLowerCase();

  // Bottom-left windows
  if (id.includes("chat") || id.includes("skills") || id.includes("prayer")) {
    return "bottom-left";
  }

  // Top-right windows
  if (id.includes("minimap")) {
    return "top-right";
  }

  // Bottom-right windows
  if (
    id.includes("inventory") ||
    id.includes("equipment") ||
    id.includes("menubar") ||
    id.includes("menu-bar")
  ) {
    return "bottom-right";
  }

  // Bottom-center windows
  if (id.includes("actionbar") || id.includes("action-bar")) {
    return "bottom-center";
  }

  // Default to top-left for unknown windows
  return "top-left";
}

/**
 * Clamp a position to ensure the window stays within viewport bounds.
 *
 * @param position - The position to clamp
 * @param size - Window size
 * @param viewport - Viewport dimensions
 * @returns Clamped position
 */
export function clampPositionToViewport(
  position: Point,
  size: Size,
  viewport: Viewport,
): Point {
  return {
    x: Math.max(0, Math.min(position.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(position.y, viewport.height - size.height)),
  };
}

/**
 * Reposition a window from one viewport to another using its anchor.
 *
 * This is the main function for handling viewport resizes. It:
 * 1. Calculates the window's offset from its anchor in the old viewport
 * 2. Applies that same offset from the anchor in the new viewport
 * 3. Clamps the result to ensure visibility
 *
 * @param position - Current window position
 * @param size - Window size
 * @param anchor - Window's anchor point
 * @param oldViewport - Previous viewport dimensions
 * @param newViewport - New viewport dimensions
 * @returns New position for the window
 */
export function repositionWindowForViewport(
  position: Point,
  size: Size,
  anchor: WindowAnchor,
  oldViewport: Viewport,
  newViewport: Viewport,
): Point {
  // Calculate offset from anchor in old viewport
  const offset = calculateOffsetFromAnchor(position, size, anchor, oldViewport);

  // Calculate new position from anchor in new viewport
  const newPosition = calculatePositionFromAnchor(
    offset,
    size,
    anchor,
    newViewport,
  );

  // Clamp to ensure window stays visible
  return clampPositionToViewport(newPosition, size, newViewport);
}

/**
 * Calculate the default position for a window based on its anchor.
 *
 * This places the window flush against its anchor edge with zero offset.
 * Used when resetting layouts or transitioning between mobile/desktop
 * where old positions are meaningless.
 *
 * @param size - Window size
 * @param anchor - Window's anchor point
 * @param viewport - Target viewport dimensions
 * @returns Default position for the window
 */
export function getDefaultPositionForAnchor(
  size: Size,
  anchor: WindowAnchor,
  viewport: Viewport,
): Point {
  // Use zero offset to place window flush with its anchor
  const zeroOffset: AnchorOffset = { x: 0, y: 0 };
  const position = calculatePositionFromAnchor(
    zeroOffset,
    size,
    anchor,
    viewport,
  );

  // Clamp to ensure window stays visible
  return clampPositionToViewport(position, size, viewport);
}
