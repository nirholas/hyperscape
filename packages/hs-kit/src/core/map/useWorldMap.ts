/**
 * useWorldMap Hook
 *
 * Hook for managing world map state including pan, zoom, and viewport.
 *
 * @packageDocumentation
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useLayoutEffect,
} from "react";
import type { Point } from "../../types";
import {
  type WorldCoordinate,
  type MapCoordinate,
  type MapViewport,
  type WorldBounds,
  type MapRegion,
  DEFAULT_WORLD_BOUNDS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_PIXELS_PER_UNIT,
  worldToMap,
  mapToWorld,
  screenToMap,
  clampToBounds,
  clampZoom,
  findRegionAt,
  calculateZoomToFit,
  getBoundsCenter,
} from "./mapUtils";

// ============================================================================
// Types
// ============================================================================

/** World map configuration options */
export interface WorldMapOptions {
  /** Initial center position */
  initialCenter?: WorldCoordinate;
  /** Initial zoom level */
  initialZoom?: number;
  /** World bounds for clamping */
  worldBounds?: WorldBounds;
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Pixels per world unit at zoom 1.0 */
  pixelsPerUnit?: number;
  /** Enable keyboard navigation */
  keyboardNavigation?: boolean;
  /** Pan speed for keyboard navigation (pixels per keypress) */
  keyboardPanSpeed?: number;
  /** Zoom speed for mouse wheel */
  wheelZoomSpeed?: number;
  /** Map regions for area name lookup */
  regions?: MapRegion[];
  /** Callback when viewport changes */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Callback when location is clicked */
  onLocationClick?: (coord: WorldCoordinate) => void;
}

/** Drag state for panning */
interface DragState {
  isDragging: boolean;
  startPointer: Point;
  startCenter: WorldCoordinate;
}

/** World map hook result */
export interface WorldMapResult {
  /** Current viewport state */
  viewport: MapViewport;
  /** Ref to attach to map container */
  mapRef: React.RefObject<HTMLDivElement>;
  /** Current region name at center */
  currentRegion: MapRegion | null;
  /** Whether map is currently being dragged */
  isDragging: boolean;
  /** Whether viewport dimensions have been measured (ready to render) */
  isReady: boolean;

  // Actions
  /** Set the center position */
  setCenter: (center: WorldCoordinate) => void;
  /** Set the zoom level */
  setZoom: (zoom: number) => void;
  /** Zoom in by a step */
  zoomIn: () => void;
  /** Zoom out by a step */
  zoomOut: () => void;
  /** Pan by delta in pixels */
  pan: (deltaX: number, deltaY: number) => void;
  /** Pan by delta in world units */
  panWorld: (deltaX: number, deltaY: number) => void;
  /** Zoom to fit bounds */
  fitBounds: (bounds: WorldBounds, padding?: number) => void;
  /** Reset to initial viewport */
  reset: () => void;
  /** Zoom to specific point */
  zoomToPoint: (
    coord: WorldCoordinate,
    zoom?: number,
    animate?: boolean,
  ) => void;

  // Coordinate conversion helpers
  /** Convert world to map coordinates */
  worldToMapCoord: (world: WorldCoordinate) => MapCoordinate;
  /** Convert map to world coordinates */
  mapToWorldCoord: (map: MapCoordinate) => WorldCoordinate;
  /** Convert screen to world coordinates */
  screenToWorldCoord: (screen: Point) => WorldCoordinate | null;

  // Event handlers to spread on map element
  mapEventHandlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
    onWheel: (e: React.WheelEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onClick: (e: React.MouseEvent) => void;
  };

  // Keyboard handlers (call from parent with useEffect)
  handleKeyDown: (e: KeyboardEvent) => void;
}

/** Default options */
const DEFAULT_OPTIONS: Required<
  Omit<WorldMapOptions, "onViewportChange" | "onLocationClick" | "regions">
> = {
  initialCenter: { x: 3200, y: 3200 },
  initialZoom: 1.0,
  worldBounds: DEFAULT_WORLD_BOUNDS,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT,
  keyboardNavigation: true,
  keyboardPanSpeed: 50,
  wheelZoomSpeed: 0.1,
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing world map state
 *
 * @example
 * ```tsx
 * function WorldMapComponent() {
 *   const {
 *     viewport,
 *     mapRef,
 *     mapEventHandlers,
 *     zoomIn,
 *     zoomOut,
 *     handleKeyDown,
 *   } = useWorldMap({
 *     initialCenter: { x: 3200, y: 3200 },
 *     initialZoom: 1.0,
 *     onLocationClick: (coord) => setWaypoint(coord),
 *   });
 *
 *   useEffect(() => {
 *     window.addEventListener('keydown', handleKeyDown);
 *     return () => window.removeEventListener('keydown', handleKeyDown);
 *   }, [handleKeyDown]);
 *
 *   return (
 *     <div
 *       ref={mapRef}
 *       {...mapEventHandlers}
 *       style={{ width: '100%', height: '100%' }}
 *     >
 *       {renderMapContent()}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWorldMap(options: WorldMapOptions = {}): WorldMapResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Map container ref
  const mapRef = useRef<HTMLDivElement>(null);

  // Track if we've measured the container
  const [isReady, setIsReady] = useState(false);

  // Viewport state - start with 0x0 size, will be updated on mount
  const [viewport, setViewport] = useState<MapViewport>({
    center: opts.initialCenter,
    zoom: opts.initialZoom,
    size: { width: 0, height: 0 },
  });

  // Drag state
  const dragRef = useRef<DragState>({
    isDragging: false,
    startPointer: { x: 0, y: 0 },
    startCenter: opts.initialCenter,
  });

  // Touch state for pinch zoom
  const touchRef = useRef<{
    lastDistance: number | null;
    lastCenter: Point | null;
  }>({
    lastDistance: null,
    lastCenter: null,
  });

  // Measure container synchronously on mount using useLayoutEffect
  // This ensures we have correct dimensions before the first paint
  useLayoutEffect(() => {
    const element = mapRef.current;
    if (!element) return;

    const measureAndUpdate = () => {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.clientWidth || element.offsetWidth;
      const height =
        rect.height || element.clientHeight || element.offsetHeight;

      if (width > 0 && height > 0) {
        setViewport((prev) => ({
          ...prev,
          size: { width, height },
        }));
        setIsReady(true);
      }
    };

    // Measure immediately
    measureAndUpdate();

    // Also set up ResizeObserver for subsequent resizes
    const resizeObserver = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.clientWidth || element.offsetWidth;
      const height =
        rect.height || element.clientHeight || element.offsetHeight;

      if (width > 0 && height > 0) {
        setViewport((prev) => ({
          ...prev,
          size: { width, height },
        }));
        if (!isReady) setIsReady(true);
      }
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [isReady]);

  // Notify on viewport change
  useEffect(() => {
    opts.onViewportChange?.(viewport);
  }, [viewport, opts.onViewportChange]);

  // Current region
  const currentRegion = useMemo(() => {
    if (!options.regions || options.regions.length === 0) {
      return null;
    }
    return findRegionAt(viewport.center, options.regions);
  }, [viewport.center, options.regions]);

  // Actions
  const setCenter = useCallback(
    (center: WorldCoordinate) => {
      const clamped = clampToBounds(center, opts.worldBounds);
      setViewport((prev) => ({ ...prev, center: clamped }));
    },
    [opts.worldBounds],
  );

  const setZoom = useCallback(
    (zoom: number) => {
      const clamped = clampZoom(zoom, opts.minZoom, opts.maxZoom);
      setViewport((prev) => ({ ...prev, zoom: clamped }));
    },
    [opts.minZoom, opts.maxZoom],
  );

  const zoomIn = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      zoom: clampZoom(prev.zoom * 1.25, opts.minZoom, opts.maxZoom),
    }));
  }, [opts.minZoom, opts.maxZoom]);

  const zoomOut = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      zoom: clampZoom(prev.zoom / 1.25, opts.minZoom, opts.maxZoom),
    }));
  }, [opts.minZoom, opts.maxZoom]);

  const pan = useCallback(
    (deltaX: number, deltaY: number) => {
      setViewport((prev) => {
        const scale = opts.pixelsPerUnit * prev.zoom;
        const newCenter = clampToBounds(
          {
            x: prev.center.x - deltaX / scale,
            y: prev.center.y + deltaY / scale,
            z: prev.center.z,
          },
          opts.worldBounds,
        );
        return { ...prev, center: newCenter };
      });
    },
    [opts.pixelsPerUnit, opts.worldBounds],
  );

  const panWorld = useCallback(
    (deltaX: number, deltaY: number) => {
      setViewport((prev) => {
        const newCenter = clampToBounds(
          {
            x: prev.center.x + deltaX,
            y: prev.center.y + deltaY,
            z: prev.center.z,
          },
          opts.worldBounds,
        );
        return { ...prev, center: newCenter };
      });
    },
    [opts.worldBounds],
  );

  const fitBounds = useCallback(
    (bounds: WorldBounds, padding: number = 20) => {
      const zoom = calculateZoomToFit(
        bounds,
        viewport.size,
        opts.pixelsPerUnit,
        padding,
      );
      const center = getBoundsCenter(bounds);
      setViewport((prev) => ({
        ...prev,
        center: clampToBounds(center, opts.worldBounds),
        zoom: clampZoom(zoom, opts.minZoom, opts.maxZoom),
      }));
    },
    [
      viewport.size,
      opts.pixelsPerUnit,
      opts.worldBounds,
      opts.minZoom,
      opts.maxZoom,
    ],
  );

  const reset = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      center: opts.initialCenter,
      zoom: opts.initialZoom,
    }));
  }, [opts.initialCenter, opts.initialZoom]);

  const zoomToPoint = useCallback(
    (coord: WorldCoordinate, zoom?: number, _animate?: boolean) => {
      const targetZoom =
        zoom !== undefined
          ? clampZoom(zoom, opts.minZoom, opts.maxZoom)
          : viewport.zoom;
      const clamped = clampToBounds(coord, opts.worldBounds);
      setViewport((prev) => ({
        ...prev,
        center: clamped,
        zoom: targetZoom,
      }));
    },
    [opts.minZoom, opts.maxZoom, opts.worldBounds, viewport.zoom],
  );

  // Coordinate conversion
  const worldToMapCoord = useCallback(
    (world: WorldCoordinate): MapCoordinate => {
      return worldToMap(world, viewport, opts.pixelsPerUnit);
    },
    [viewport, opts.pixelsPerUnit],
  );

  const mapToWorldCoord = useCallback(
    (map: MapCoordinate): WorldCoordinate => {
      return mapToWorld(map, viewport, opts.pixelsPerUnit);
    },
    [viewport, opts.pixelsPerUnit],
  );

  const screenToWorldCoord = useCallback(
    (screen: Point): WorldCoordinate | null => {
      const element = mapRef.current;
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      const mapCoord = screenToMap(screen, rect);
      return mapToWorld(mapCoord, viewport, opts.pixelsPerUnit);
    },
    [viewport, opts.pixelsPerUnit],
  );

  // Mouse event handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left click
      e.preventDefault();

      dragRef.current = {
        isDragging: true,
        startPointer: { x: e.clientX, y: e.clientY },
        startCenter: viewport.center,
      };
    },
    [viewport.center],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current.isDragging) return;

      const deltaX = e.clientX - dragRef.current.startPointer.x;
      const deltaY = e.clientY - dragRef.current.startPointer.y;
      const scale = opts.pixelsPerUnit * viewport.zoom;

      const newCenter = clampToBounds(
        {
          x: dragRef.current.startCenter.x - deltaX / scale,
          y: dragRef.current.startCenter.y + deltaY / scale,
          z: dragRef.current.startCenter.z,
        },
        opts.worldBounds,
      );

      setViewport((prev) => ({ ...prev, center: newCenter }));
    },
    [opts.pixelsPerUnit, opts.worldBounds, viewport.zoom],
  );

  const onMouseUp = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  const onMouseLeave = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const element = mapRef.current;
      if (!element) return;

      // Get mouse position relative to map
      const rect = element.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate world position under mouse before zoom
      const worldBefore = mapToWorld(
        { x: mouseX, y: mouseY },
        viewport,
        opts.pixelsPerUnit,
      );

      // Calculate new zoom
      const zoomDelta =
        e.deltaY > 0 ? -opts.wheelZoomSpeed : opts.wheelZoomSpeed;
      const newZoom = clampZoom(
        viewport.zoom * (1 + zoomDelta),
        opts.minZoom,
        opts.maxZoom,
      );

      // Calculate world position under mouse after zoom
      const tempViewport = { ...viewport, zoom: newZoom };
      const worldAfter = mapToWorld(
        { x: mouseX, y: mouseY },
        tempViewport,
        opts.pixelsPerUnit,
      );

      // Adjust center to keep mouse position stable
      const newCenter = clampToBounds(
        {
          x: viewport.center.x + (worldBefore.x - worldAfter.x),
          y: viewport.center.y + (worldBefore.y - worldAfter.y),
          z: viewport.center.z,
        },
        opts.worldBounds,
      );

      setViewport((prev) => ({
        ...prev,
        zoom: newZoom,
        center: newCenter,
      }));
    },
    [
      viewport,
      opts.pixelsPerUnit,
      opts.wheelZoomSpeed,
      opts.minZoom,
      opts.maxZoom,
      opts.worldBounds,
    ],
  );

  // Touch event handlers
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        // Single touch - start pan
        const touch = e.touches[0];
        dragRef.current = {
          isDragging: true,
          startPointer: { x: touch.clientX, y: touch.clientY },
          startCenter: viewport.center,
        };
      } else if (e.touches.length === 2) {
        // Two touches - start pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchRef.current.lastDistance = Math.sqrt(dx * dx + dy * dy);
        touchRef.current.lastCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    },
    [viewport.center],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1 && dragRef.current.isDragging) {
        // Single touch - pan
        const touch = e.touches[0];
        const deltaX = touch.clientX - dragRef.current.startPointer.x;
        const deltaY = touch.clientY - dragRef.current.startPointer.y;
        const scale = opts.pixelsPerUnit * viewport.zoom;

        const newCenter = clampToBounds(
          {
            x: dragRef.current.startCenter.x - deltaX / scale,
            y: dragRef.current.startCenter.y + deltaY / scale,
            z: dragRef.current.startCenter.z,
          },
          opts.worldBounds,
        );

        setViewport((prev) => ({ ...prev, center: newCenter }));
      } else if (
        e.touches.length === 2 &&
        touchRef.current.lastDistance !== null
      ) {
        // Two touches - pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const scale = distance / touchRef.current.lastDistance;
        const newZoom = clampZoom(
          viewport.zoom * scale,
          opts.minZoom,
          opts.maxZoom,
        );

        touchRef.current.lastDistance = distance;

        setViewport((prev) => ({ ...prev, zoom: newZoom }));
      }
    },
    [
      opts.pixelsPerUnit,
      opts.worldBounds,
      opts.minZoom,
      opts.maxZoom,
      viewport.zoom,
    ],
  );

  const onTouchEnd = useCallback(() => {
    dragRef.current.isDragging = false;
    touchRef.current.lastDistance = null;
    touchRef.current.lastCenter = null;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't fire click if we were dragging
      if (dragRef.current.isDragging) return;

      const element = mapRef.current;
      if (!element || !opts.onLocationClick) return;

      const rect = element.getBoundingClientRect();
      const mapCoord = screenToMap({ x: e.clientX, y: e.clientY }, rect);
      const worldCoord = mapToWorld(mapCoord, viewport, opts.pixelsPerUnit);

      opts.onLocationClick(worldCoord);
    },
    [viewport, opts.pixelsPerUnit, opts.onLocationClick],
  );

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!opts.keyboardNavigation) return;

      const speed = opts.keyboardPanSpeed;

      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          pan(0, -speed);
          break;
        case "s":
        case "arrowdown":
          pan(0, speed);
          break;
        case "a":
        case "arrowleft":
          pan(-speed, 0);
          break;
        case "d":
        case "arrowright":
          pan(speed, 0);
          break;
        case "+":
        case "=":
          zoomIn();
          break;
        case "-":
        case "_":
          zoomOut();
          break;
        default:
          return;
      }

      e.preventDefault();
    },
    [opts.keyboardNavigation, opts.keyboardPanSpeed, pan, zoomIn, zoomOut],
  );

  return {
    viewport,
    mapRef: mapRef as React.RefObject<HTMLDivElement>,
    currentRegion,
    isDragging: dragRef.current.isDragging,
    isReady,

    setCenter,
    setZoom,
    zoomIn,
    zoomOut,
    pan,
    panWorld,
    fitBounds,
    reset,
    zoomToPoint,

    worldToMapCoord,
    mapToWorldCoord,
    screenToWorldCoord,

    mapEventHandlers: {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onClick,
    },

    handleKeyDown,
  };
}
