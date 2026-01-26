/**
 * Grid Utility Functions
 *
 * Consolidated grid snapping and positioning utilities for UI components.
 *
 * @packageDocumentation
 */

/** Default grid size for snapping (matches editStore default) */
export const DEFAULT_GRID_SIZE = 8;

/**
 * Snap a value to the nearest grid point.
 *
 * @param value - The value to snap
 * @param gridSize - The grid size (default: 8)
 * @returns The snapped value
 */
export function snapToGrid(
  value: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a position (x, y) to the grid.
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param gridSize - The grid size (default: 8)
 * @returns Snapped position object
 */
export function snapPositionToGrid(
  x: number,
  y: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): { x: number; y: number } {
  return {
    x: snapToGrid(x, gridSize),
    y: snapToGrid(y, gridSize),
  };
}

/**
 * Clamp a position to ensure the window stays within viewport bounds.
 * Also snaps the position to the grid for consistent alignment.
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param width - Window width
 * @param height - Window height
 * @param viewport - Viewport dimensions
 * @param gridSize - The grid size (default: 8)
 * @returns Clamped and snapped position
 */
export function clampAndSnapPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  gridSize: number = DEFAULT_GRID_SIZE,
): { x: number; y: number } {
  const minVisiblePx = 50;
  // First clamp to viewport, then snap to grid
  const clampedX = Math.max(
    0,
    Math.min(x, viewport.width - Math.min(width, minVisiblePx)),
  );
  const clampedY = Math.max(
    0,
    Math.min(y, viewport.height - Math.min(height, minVisiblePx)),
  );
  return {
    x: snapToGrid(clampedX, gridSize),
    y: snapToGrid(clampedY, gridSize),
  };
}
