/**
 * Map Utilities
 *
 * Coordinate conversion, distance calculation, and map helpers.
 *
 * @packageDocumentation
 */

import type { Point, Size } from "../../types";

// ============================================================================
// Types
// ============================================================================

/** World coordinate */
export interface WorldCoordinate {
  x: number;
  y: number;
  /** Optional z-level (floor) */
  z?: number;
}

/** Map coordinate (pixels on the map) */
export interface MapCoordinate {
  x: number;
  y: number;
}

/** Map viewport state */
export interface MapViewport {
  /** Center position in world coordinates */
  center: WorldCoordinate;
  /** Zoom level (1.0 = 100%, 0.5 = 50%, 2.0 = 200%) */
  zoom: number;
  /** Viewport size in pixels */
  size: Size;
}

/** Bounding box in world coordinates */
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Map region/area definition */
export interface MapRegion {
  id: string;
  name: string;
  bounds: WorldBounds;
  /** Optional sub-regions */
  children?: MapRegion[];
  /** Z-level (floor) this region is on */
  level?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default pixels per world unit */
export const DEFAULT_PIXELS_PER_UNIT = 4;

/** Minimum zoom level */
export const MIN_ZOOM = 0.25;

/** Maximum zoom level */
export const MAX_ZOOM = 4.0;

/** Default world bounds */
export const DEFAULT_WORLD_BOUNDS: WorldBounds = {
  minX: 0,
  minY: 0,
  maxX: 6400,
  maxY: 6400,
};

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert world coordinates to map pixel coordinates
 *
 * @param world - World coordinate
 * @param viewport - Current map viewport
 * @param pixelsPerUnit - Pixels per world unit at zoom 1.0
 * @returns Map pixel coordinate relative to viewport top-left
 */
export function worldToMap(
  world: WorldCoordinate,
  viewport: MapViewport,
  pixelsPerUnit: number = DEFAULT_PIXELS_PER_UNIT,
): MapCoordinate {
  const scale = pixelsPerUnit * viewport.zoom;

  // Calculate offset from viewport center
  const offsetX = (world.x - viewport.center.x) * scale;
  const offsetY = (world.y - viewport.center.y) * scale;

  // Return position relative to viewport center
  return {
    x: viewport.size.width / 2 + offsetX,
    y: viewport.size.height / 2 - offsetY, // Y is inverted (up is positive in world)
  };
}

/**
 * Convert map pixel coordinates to world coordinates
 *
 * @param map - Map pixel coordinate
 * @param viewport - Current map viewport
 * @param pixelsPerUnit - Pixels per world unit at zoom 1.0
 * @returns World coordinate
 */
export function mapToWorld(
  map: MapCoordinate,
  viewport: MapViewport,
  pixelsPerUnit: number = DEFAULT_PIXELS_PER_UNIT,
): WorldCoordinate {
  const scale = pixelsPerUnit * viewport.zoom;

  // Calculate offset from viewport center
  const offsetX = (map.x - viewport.size.width / 2) / scale;
  const offsetY = (viewport.size.height / 2 - map.y) / scale;

  return {
    x: viewport.center.x + offsetX,
    y: viewport.center.y + offsetY,
    z: viewport.center.z,
  };
}

/**
 * Convert screen/pointer coordinates to map coordinates
 *
 * @param screen - Screen coordinate (e.g., from mouse event)
 * @param mapRect - Bounding rect of the map element
 * @returns Map coordinate relative to map element
 */
export function screenToMap(
  screen: Point,
  mapRect: DOMRect | { left: number; top: number },
): MapCoordinate {
  return {
    x: screen.x - mapRect.left,
    y: screen.y - mapRect.top,
  };
}

// ============================================================================
// Distance Calculations
// ============================================================================

/**
 * Calculate Euclidean distance between two world coordinates
 *
 * @param a - First coordinate
 * @param b - Second coordinate
 * @returns Distance in world units
 */
export function calculateDistance(
  a: WorldCoordinate,
  b: WorldCoordinate,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate Manhattan distance between two world coordinates
 * Useful for grid-based movement calculations
 *
 * @param a - First coordinate
 * @param b - Second coordinate
 * @returns Manhattan distance in world units
 */
export function calculateManhattanDistance(
  a: WorldCoordinate,
  b: WorldCoordinate,
): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

/**
 * Calculate the bearing (angle) from one point to another
 *
 * @param from - Starting coordinate
 * @param to - Target coordinate
 * @returns Angle in degrees (0 = North, 90 = East, etc.)
 */
export function calculateBearing(
  from: WorldCoordinate,
  to: WorldCoordinate,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const radians = Math.atan2(dx, dy);
  const degrees = (radians * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * Format distance for display
 *
 * @param distance - Distance in world units
 * @param unitsPerTile - World units per game tile (default 1)
 * @returns Formatted string like "42 tiles" or "1.2km"
 */
export function formatDistance(
  distance: number,
  unitsPerTile: number = 1,
): string {
  const tiles = distance / unitsPerTile;

  if (tiles < 100) {
    return `${Math.round(tiles)} tiles`;
  } else if (tiles < 1000) {
    return `${(tiles / 100).toFixed(1)}km`;
  } else {
    return `${(tiles / 1000).toFixed(1)}km`;
  }
}

// ============================================================================
// Bounds & Viewport
// ============================================================================

/**
 * Check if a world coordinate is within bounds
 *
 * @param coord - World coordinate to check
 * @param bounds - World bounds
 * @returns True if coordinate is within bounds
 */
export function isWithinBounds(
  coord: WorldCoordinate,
  bounds: WorldBounds,
): boolean {
  return (
    coord.x >= bounds.minX &&
    coord.x <= bounds.maxX &&
    coord.y >= bounds.minY &&
    coord.y <= bounds.maxY
  );
}

/**
 * Clamp a world coordinate to within bounds
 *
 * @param coord - World coordinate
 * @param bounds - World bounds
 * @returns Clamped coordinate
 */
export function clampToBounds(
  coord: WorldCoordinate,
  bounds: WorldBounds,
): WorldCoordinate {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, coord.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, coord.y)),
    z: coord.z,
  };
}

/**
 * Calculate visible world bounds from viewport
 *
 * @param viewport - Current map viewport
 * @param pixelsPerUnit - Pixels per world unit at zoom 1.0
 * @returns World bounds visible in viewport
 */
export function getVisibleBounds(
  viewport: MapViewport,
  pixelsPerUnit: number = DEFAULT_PIXELS_PER_UNIT,
): WorldBounds {
  const scale = pixelsPerUnit * viewport.zoom;
  const halfWidth = viewport.size.width / 2 / scale;
  const halfHeight = viewport.size.height / 2 / scale;

  return {
    minX: viewport.center.x - halfWidth,
    maxX: viewport.center.x + halfWidth,
    minY: viewport.center.y - halfHeight,
    maxY: viewport.center.y + halfHeight,
  };
}

/**
 * Check if a world coordinate is visible in the viewport
 *
 * @param coord - World coordinate
 * @param viewport - Current map viewport
 * @param pixelsPerUnit - Pixels per world unit at zoom 1.0
 * @param margin - Extra margin in pixels
 * @returns True if coordinate is visible
 */
export function isVisibleInViewport(
  coord: WorldCoordinate,
  viewport: MapViewport,
  pixelsPerUnit: number = DEFAULT_PIXELS_PER_UNIT,
  margin: number = 0,
): boolean {
  const mapCoord = worldToMap(coord, viewport, pixelsPerUnit);
  return (
    mapCoord.x >= -margin &&
    mapCoord.x <= viewport.size.width + margin &&
    mapCoord.y >= -margin &&
    mapCoord.y <= viewport.size.height + margin
  );
}

// ============================================================================
// Region Helpers
// ============================================================================

/**
 * Find which region a coordinate is in
 *
 * @param coord - World coordinate
 * @param regions - Array of map regions
 * @returns The innermost region containing the coordinate, or null
 */
export function findRegionAt(
  coord: WorldCoordinate,
  regions: MapRegion[],
): MapRegion | null {
  for (const region of regions) {
    if (
      coord.x >= region.bounds.minX &&
      coord.x <= region.bounds.maxX &&
      coord.y >= region.bounds.minY &&
      coord.y <= region.bounds.maxY
    ) {
      // Check children for more specific region
      if (region.children && region.children.length > 0) {
        const childRegion = findRegionAt(coord, region.children);
        if (childRegion) {
          return childRegion;
        }
      }
      return region;
    }
  }
  return null;
}

/**
 * Format world coordinates for display
 *
 * @param coord - World coordinate
 * @param includeZ - Whether to include Z level
 * @returns Formatted string like "(3200, 3200)" or "(3200, 3200, 0)"
 */
export function formatCoordinates(
  coord: WorldCoordinate,
  includeZ: boolean = false,
): string {
  const x = Math.round(coord.x);
  const y = Math.round(coord.y);

  if (includeZ && coord.z !== undefined) {
    return `(${x}, ${y}, ${coord.z})`;
  }
  return `(${x}, ${y})`;
}

// ============================================================================
// Zoom Helpers
// ============================================================================

/**
 * Clamp zoom level to valid range
 *
 * @param zoom - Desired zoom level
 * @param min - Minimum zoom (default MIN_ZOOM)
 * @param max - Maximum zoom (default MAX_ZOOM)
 * @returns Clamped zoom level
 */
export function clampZoom(
  zoom: number,
  min: number = MIN_ZOOM,
  max: number = MAX_ZOOM,
): number {
  return Math.max(min, Math.min(max, zoom));
}

/**
 * Calculate zoom level to fit bounds in viewport
 *
 * @param bounds - World bounds to fit
 * @param viewportSize - Viewport size
 * @param pixelsPerUnit - Pixels per world unit at zoom 1.0
 * @param padding - Padding in pixels
 * @returns Optimal zoom level
 */
export function calculateZoomToFit(
  bounds: WorldBounds,
  viewportSize: Size,
  pixelsPerUnit: number = DEFAULT_PIXELS_PER_UNIT,
  padding: number = 20,
): number {
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;

  const availableWidth = viewportSize.width - padding * 2;
  const availableHeight = viewportSize.height - padding * 2;

  const zoomX = availableWidth / (worldWidth * pixelsPerUnit);
  const zoomY = availableHeight / (worldHeight * pixelsPerUnit);

  return clampZoom(Math.min(zoomX, zoomY));
}

/**
 * Calculate center of bounds
 *
 * @param bounds - World bounds
 * @returns Center coordinate
 */
export function getBoundsCenter(bounds: WorldBounds): WorldCoordinate {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
