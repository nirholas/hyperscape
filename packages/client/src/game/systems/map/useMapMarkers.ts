/**
 * useMapMarkers Hook
 *
 * Hook for managing map markers with filtering and layer controls.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useMemo } from "react";
import type { WorldCoordinate } from "./mapUtils";

// ============================================================================
// Types
// ============================================================================

/** Marker type categories */
export type MarkerType =
  | "player"
  | "party"
  | "quest"
  | "poi"
  | "waypoint"
  | "resource"
  | "npc"
  | "danger"
  | "custom";

/** Marker visibility layer */
export type MarkerLayer =
  | "players"
  | "quests"
  | "pois"
  | "resources"
  | "waypoints"
  | "custom";

/** Individual map marker */
export interface MapMarker {
  /** Unique identifier */
  id: string;
  /** Marker type */
  type: MarkerType;
  /** World position */
  position: WorldCoordinate;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Icon identifier or emoji */
  icon?: string;
  /** Color for the marker */
  color?: string;
  /** Whether marker is highlighted/selected */
  highlighted?: boolean;
  /** Whether marker is interactive */
  interactive?: boolean;
  /** Custom data */
  data?: Record<string, unknown>;
  /** Layer this marker belongs to */
  layer?: MarkerLayer;
  /** Z-level (floor) */
  level?: number;
  /** Whether marker is visible (separate from layer visibility) */
  visible?: boolean;
  /** Priority for rendering order (higher = on top) */
  priority?: number;
}

/** Layer configuration */
export interface LayerConfig {
  id: MarkerLayer;
  label: string;
  visible: boolean;
  icon: string;
  color: string;
}

/** Options for useMapMarkers hook */
export interface MapMarkersOptions {
  /** Initial markers */
  initialMarkers?: MapMarker[];
  /** Initial layer visibility */
  initialLayers?: Partial<Record<MarkerLayer, boolean>>;
  /** Callback when marker is clicked */
  onMarkerClick?: (marker: MapMarker) => void;
  /** Callback when marker is hovered */
  onMarkerHover?: (marker: MapMarker | null) => void;
  /** Current Z-level filter (only show markers on this level) */
  currentLevel?: number;
}

/** Map markers hook result */
export interface MapMarkersResult {
  /** All markers */
  markers: MapMarker[];
  /** Visible markers (filtered by layers and level) */
  visibleMarkers: MapMarker[];
  /** Layer configurations */
  layers: LayerConfig[];
  /** Currently hovered marker */
  hoveredMarker: MapMarker | null;
  /** Currently selected marker */
  selectedMarker: MapMarker | null;
  /** Waypoint marker (if any) */
  waypoint: MapMarker | null;

  // Marker operations
  /** Add a marker */
  addMarker: (marker: Omit<MapMarker, "id"> & { id?: string }) => MapMarker;
  /** Remove a marker */
  removeMarker: (id: string) => void;
  /** Update a marker */
  updateMarker: (id: string, updates: Partial<MapMarker>) => void;
  /** Clear all markers of a type */
  clearMarkers: (type?: MarkerType) => void;
  /** Set waypoint */
  setWaypoint: (position: WorldCoordinate | null, label?: string) => void;

  // Selection
  /** Select a marker */
  selectMarker: (id: string | null) => void;
  /** Set hovered marker */
  setHoveredMarker: (marker: MapMarker | null) => void;

  // Layer operations
  /** Toggle layer visibility */
  toggleLayer: (layer: MarkerLayer) => void;
  /** Set layer visibility */
  setLayerVisible: (layer: MarkerLayer, visible: boolean) => void;
  /** Show all layers */
  showAllLayers: () => void;
  /** Hide all layers */
  hideAllLayers: () => void;

  // Queries
  /** Get marker by ID */
  getMarker: (id: string) => MapMarker | undefined;
  /** Get markers by type */
  getMarkersByType: (type: MarkerType) => MapMarker[];
  /** Get markers in bounds */
  getMarkersInBounds: (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) => MapMarker[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default layer configurations */
export const DEFAULT_LAYERS: LayerConfig[] = [
  {
    id: "players",
    label: "Players",
    visible: true,
    icon: "users",
    color: "#4CAF50",
  },
  {
    id: "quests",
    label: "Quests",
    visible: true,
    icon: "scroll",
    color: "#FFD700",
  },
  {
    id: "pois",
    label: "Points of Interest",
    visible: true,
    icon: "map-pin",
    color: "#2196F3",
  },
  {
    id: "resources",
    label: "Resources",
    visible: false,
    icon: "pickaxe",
    color: "#9C27B0",
  },
  {
    id: "waypoints",
    label: "Waypoints",
    visible: true,
    icon: "flag",
    color: "#F44336",
  },
  {
    id: "custom",
    label: "Custom",
    visible: true,
    icon: "star",
    color: "#FF9800",
  },
];

/** Default marker icons by type */
export const DEFAULT_MARKER_ICONS: Record<MarkerType, string> = {
  player: "user",
  party: "users",
  quest: "scroll",
  poi: "map-pin",
  waypoint: "flag",
  resource: "gem",
  npc: "message-circle",
  danger: "alert-triangle",
  custom: "star",
};

/** Default marker colors by type */
export const DEFAULT_MARKER_COLORS: Record<MarkerType, string> = {
  player: "#4CAF50",
  party: "#8BC34A",
  quest: "#FFD700",
  poi: "#2196F3",
  waypoint: "#F44336",
  resource: "#9C27B0",
  npc: "#00BCD4",
  danger: "#FF5722",
  custom: "#FF9800",
};

// ============================================================================
// Utilities
// ============================================================================

/** Generate unique marker ID */
function generateMarkerId(): string {
  return `marker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Map marker type to layer */
function getLayerForType(type: MarkerType): MarkerLayer {
  switch (type) {
    case "player":
    case "party":
      return "players";
    case "quest":
      return "quests";
    case "poi":
    case "npc":
      return "pois";
    case "resource":
      return "resources";
    case "waypoint":
      return "waypoints";
    case "danger":
    case "custom":
    default:
      return "custom";
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing map markers
 *
 * @example
 * ```tsx
 * function MapWithMarkers() {
 *   const {
 *     visibleMarkers,
 *     layers,
 *     setWaypoint,
 *     toggleLayer,
 *   } = useMapMarkers({
 *     initialMarkers: [
 *       { id: 'quest-1', type: 'quest', position: { x: 3200, y: 3200 }, label: 'Main Quest' },
 *     ],
 *     onMarkerClick: (marker) => openMarkerDetails(marker),
 *   });
 *
 *   return (
 *     <WorldMap
 *       onLocationClick={(coord) => setWaypoint(coord)}
 *     >
 *       {visibleMarkers.map(marker => (
 *         <MapMarker key={marker.id} marker={marker} />
 *       ))}
 *     </WorldMap>
 *   );
 * }
 * ```
 */
export function useMapMarkers(
  options: MapMarkersOptions = {},
): MapMarkersResult {
  // Markers state
  const [markers, setMarkers] = useState<MapMarker[]>(
    options.initialMarkers ?? [],
  );

  // Layer visibility state
  const [layerVisibility, setLayerVisibility] = useState<
    Record<MarkerLayer, boolean>
  >({
    players: true,
    quests: true,
    pois: true,
    resources: false,
    waypoints: true,
    custom: true,
    ...options.initialLayers,
  });

  // Selection state
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<MapMarker | null>(null);

  // Compute layers config
  const layers = useMemo<LayerConfig[]>(() => {
    return DEFAULT_LAYERS.map((layer) => ({
      ...layer,
      visible: layerVisibility[layer.id],
    }));
  }, [layerVisibility]);

  // Filter visible markers
  const visibleMarkers = useMemo(() => {
    return markers
      .filter((marker) => {
        // Check marker's own visibility
        if (marker.visible === false) return false;

        // Check layer visibility
        const layer = marker.layer ?? getLayerForType(marker.type);
        if (!layerVisibility[layer]) return false;

        // Check level filter
        if (
          options.currentLevel !== undefined &&
          marker.level !== undefined &&
          marker.level !== options.currentLevel
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }, [markers, layerVisibility, options.currentLevel]);

  // Get waypoint
  const waypoint = useMemo(() => {
    return markers.find((m) => m.type === "waypoint") ?? null;
  }, [markers]);

  // Get selected marker
  const selectedMarker = useMemo(() => {
    if (!selectedMarkerId) return null;
    return markers.find((m) => m.id === selectedMarkerId) ?? null;
  }, [markers, selectedMarkerId]);

  // Marker operations
  const addMarker = useCallback(
    (markerData: Omit<MapMarker, "id"> & { id?: string }): MapMarker => {
      const marker: MapMarker = {
        ...markerData,
        id: markerData.id ?? generateMarkerId(),
        icon: markerData.icon ?? DEFAULT_MARKER_ICONS[markerData.type],
        color: markerData.color ?? DEFAULT_MARKER_COLORS[markerData.type],
        visible: markerData.visible ?? true,
        interactive: markerData.interactive ?? true,
        priority: markerData.priority ?? 0,
      };

      setMarkers((prev) => [...prev, marker]);
      return marker;
    },
    [],
  );

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
    setSelectedMarkerId((prev) => (prev === id ? null : prev));
  }, []);

  const updateMarker = useCallback(
    (id: string, updates: Partial<MapMarker>) => {
      setMarkers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      );
    },
    [],
  );

  const clearMarkers = useCallback((type?: MarkerType) => {
    setMarkers((prev) => {
      if (type === undefined) return [];
      return prev.filter((m) => m.type !== type);
    });
    setSelectedMarkerId(null);
  }, []);

  const setWaypoint = useCallback(
    (position: WorldCoordinate | null, label: string = "Waypoint") => {
      // Remove existing waypoint
      setMarkers((prev) => prev.filter((m) => m.type !== "waypoint"));

      // Add new waypoint if position provided
      if (position) {
        const waypointMarker: MapMarker = {
          id: "waypoint-active",
          type: "waypoint",
          position,
          label,
          icon: "flag",
          color: DEFAULT_MARKER_COLORS.waypoint,
          highlighted: true,
          interactive: true,
          priority: 100,
          layer: "waypoints",
        };
        setMarkers((prev) => [...prev, waypointMarker]);
      }
    },
    [],
  );

  // Selection
  const selectMarker = useCallback(
    (id: string | null) => {
      setSelectedMarkerId(id);
      if (id) {
        const marker = markers.find((m) => m.id === id);
        if (marker) {
          options.onMarkerClick?.(marker);
        }
      }
    },
    [markers, options.onMarkerClick],
  );

  const handleSetHoveredMarker = useCallback(
    (marker: MapMarker | null) => {
      setHoveredMarker(marker);
      options.onMarkerHover?.(marker);
    },
    [options.onMarkerHover],
  );

  // Layer operations
  const toggleLayer = useCallback((layer: MarkerLayer) => {
    setLayerVisibility((prev) => ({
      ...prev,
      [layer]: !prev[layer],
    }));
  }, []);

  const setLayerVisible = useCallback(
    (layer: MarkerLayer, visible: boolean) => {
      setLayerVisibility((prev) => ({
        ...prev,
        [layer]: visible,
      }));
    },
    [],
  );

  const showAllLayers = useCallback(() => {
    setLayerVisibility({
      players: true,
      quests: true,
      pois: true,
      resources: true,
      waypoints: true,
      custom: true,
    });
  }, []);

  const hideAllLayers = useCallback(() => {
    setLayerVisibility({
      players: false,
      quests: false,
      pois: false,
      resources: false,
      waypoints: false,
      custom: false,
    });
  }, []);

  // Queries
  const getMarker = useCallback(
    (id: string): MapMarker | undefined => {
      return markers.find((m) => m.id === id);
    },
    [markers],
  );

  const getMarkersByType = useCallback(
    (type: MarkerType): MapMarker[] => {
      return markers.filter((m) => m.type === type);
    },
    [markers],
  );

  const getMarkersInBounds = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number): MapMarker[] => {
      return markers.filter((m) => {
        const { x, y } = m.position;
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      });
    },
    [markers],
  );

  return {
    markers,
    visibleMarkers,
    layers,
    hoveredMarker,
    selectedMarker,
    waypoint,

    addMarker,
    removeMarker,
    updateMarker,
    clearMarkers,
    setWaypoint,

    selectMarker,
    setHoveredMarker: handleSetHoveredMarker,

    toggleLayer,
    setLayerVisible,
    showAllLayers,
    hideAllLayers,

    getMarker,
    getMarkersByType,
    getMarkersInBounds,
  };
}
