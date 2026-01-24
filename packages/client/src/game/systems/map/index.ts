/**
 * Map System
 *
 * Hooks and utilities for world map functionality.
 *
 * @packageDocumentation
 */

// Map utilities
export {
  // Types
  type WorldCoordinate,
  type MapCoordinate,
  type MapViewport,
  type WorldBounds,
  type MapRegion,
  // Constants
  DEFAULT_PIXELS_PER_UNIT,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_WORLD_BOUNDS,
  // Coordinate conversion
  worldToMap,
  mapToWorld,
  screenToMap,
  // Distance calculations
  calculateDistance,
  calculateManhattanDistance,
  calculateBearing,
  formatDistance,
  // Bounds helpers
  isWithinBounds,
  clampToBounds,
  getVisibleBounds,
  isVisibleInViewport,
  // Region helpers
  findRegionAt,
  formatCoordinates,
  // Zoom helpers
  clampZoom,
  calculateZoomToFit,
  getBoundsCenter,
} from "./mapUtils";

// World map hook
export {
  useWorldMap,
  type WorldMapOptions,
  type WorldMapResult,
} from "./useWorldMap";

// Map markers hook
export {
  useMapMarkers,
  type MarkerType,
  type MarkerLayer,
  type MapMarker,
  type LayerConfig,
  type MapMarkersOptions,
  type MapMarkersResult,
  DEFAULT_LAYERS,
  DEFAULT_MARKER_ICONS,
  DEFAULT_MARKER_COLORS,
} from "./useMapMarkers";

// Map navigation hook
export {
  useMapNavigation,
  type NavigationHistoryEntry,
  type MapBookmark,
  type MapNavigationOptions,
  type MapNavigationResult,
} from "./useMapNavigation";
