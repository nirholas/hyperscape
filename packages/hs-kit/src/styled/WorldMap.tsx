/**
 * WorldMap Component
 *
 * Full world map with pan, zoom, markers, and fog of war support.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  useMemo,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../stores/themeStore";
import {
  useWorldMap,
  type WorldMapOptions,
  type WorldCoordinate,
  type MapViewport,
  type WorldBounds,
  type MapRegion,
  DEFAULT_WORLD_BOUNDS,
} from "../core/map";

// ============================================================================
// Types
// ============================================================================

/** Fog of war cell state */
export type FogState = "hidden" | "explored" | "visible";

/** Fog of war grid */
export interface FogOfWar {
  /** Grid of fog states */
  grid: FogState[][];
  /** Grid cell size in world units */
  cellSize: number;
  /** Grid origin in world coordinates */
  origin: WorldCoordinate;
}

/** Props for WorldMap component */
export interface WorldMapProps {
  /** Map background image URL */
  backgroundImage?: string;
  /** Background color when no image */
  backgroundColor?: string;
  /** World bounds */
  worldBounds?: WorldBounds;
  /** Map regions for area names */
  regions?: MapRegion[];
  /** Player position (for centering/tracking) */
  playerPosition?: WorldCoordinate;
  /** Fog of war data */
  fogOfWar?: FogOfWar;
  /** Whether to show coordinates on hover */
  showCoordinates?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
  /** Grid size in world units */
  gridSize?: number;
  /** Initial center position */
  initialCenter?: WorldCoordinate;
  /** Initial zoom level */
  initialZoom?: number;
  /** Minimum zoom */
  minZoom?: number;
  /** Maximum zoom */
  maxZoom?: number;
  /** Callback when location is clicked */
  onLocationClick?: (coord: WorldCoordinate) => void;
  /** Callback when viewport changes */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Callback when area changes */
  onAreaChange?: (region: MapRegion | null) => void;
  /** Children (markers, overlays, etc.) */
  children?: ReactNode;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Constants
// ============================================================================

/** Default world map options */
const DEFAULT_OPTIONS: Partial<WorldMapProps> = {
  backgroundColor: "#1a2a1a",
  showCoordinates: true,
  showGrid: false,
  gridSize: 64,
  initialZoom: 1.0,
  minZoom: 0.25,
  maxZoom: 4.0,
};

// ============================================================================
// Sub-components
// ============================================================================

/** Grid overlay */
const GridOverlay = memo(function GridOverlay({
  viewport,
  gridSize,
  color,
}: {
  viewport: MapViewport;
  gridSize: number;
  color: string;
}) {
  const scale = 4 * viewport.zoom; // pixels per unit at current zoom
  const gridPixels = gridSize * scale;

  // Calculate grid offset for seamless scrolling
  const offsetX = -(viewport.center.x * scale) % gridPixels;
  const offsetY = -(viewport.center.y * scale) % gridPixels;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern
          id="map-grid"
          width={gridPixels}
          height={gridPixels}
          patternUnits="userSpaceOnUse"
          x={offsetX + viewport.size.width / 2}
          y={offsetY + viewport.size.height / 2}
        >
          <path
            d={`M ${gridPixels} 0 L 0 0 0 ${gridPixels}`}
            fill="none"
            stroke={color}
            strokeWidth={1}
            opacity={0.3}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#map-grid)" />
    </svg>
  );
});

/** Fog of war overlay */
const FogOverlay = memo(function FogOverlay({
  fogOfWar,
  viewport,
}: {
  fogOfWar: FogOfWar;
  viewport: MapViewport;
}) {
  const scale = 4 * viewport.zoom;
  const cellPixels = fogOfWar.cellSize * scale;

  // Calculate which cells are visible
  const startX = Math.floor(
    (viewport.center.x - viewport.size.width / 2 / scale - fogOfWar.origin.x) /
      fogOfWar.cellSize,
  );
  const startY = Math.floor(
    (viewport.center.y - viewport.size.height / 2 / scale - fogOfWar.origin.y) /
      fogOfWar.cellSize,
  );
  const endX = Math.ceil(
    (viewport.center.x + viewport.size.width / 2 / scale - fogOfWar.origin.x) /
      fogOfWar.cellSize,
  );
  const endY = Math.ceil(
    (viewport.center.y + viewport.size.height / 2 / scale - fogOfWar.origin.y) /
      fogOfWar.cellSize,
  );

  const cells: React.ReactNode[] = [];

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const row = fogOfWar.grid[y];
      const state: FogState = row ? (row[x] ?? "hidden") : "hidden";

      if (state === "visible") continue;

      const worldX = fogOfWar.origin.x + x * fogOfWar.cellSize;
      const worldY = fogOfWar.origin.y + y * fogOfWar.cellSize;

      const screenX =
        viewport.size.width / 2 + (worldX - viewport.center.x) * scale;
      const screenY =
        viewport.size.height / 2 - (worldY - viewport.center.y) * scale;

      cells.push(
        <rect
          key={`fog-${x}-${y}`}
          x={screenX}
          y={screenY - cellPixels}
          width={cellPixels}
          height={cellPixels}
          fill={state === "hidden" ? "#000" : "#000"}
          opacity={state === "hidden" ? 1 : 0.5}
        />,
      );
    }
  }

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {cells}
    </svg>
  );
});

/** Coordinates display */
const CoordinatesDisplay = memo(function CoordinatesDisplay({
  coord,
  regionName,
}: {
  coord: WorldCoordinate | null;
  regionName: string | null;
}) {
  const theme = useTheme();

  if (!coord) return null;

  const style: CSSProperties = {
    position: "absolute",
    bottom: 8,
    left: 8,
    padding: "4px 8px",
    backgroundColor: theme.colors.background.glass,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily.mono,
    pointerEvents: "none",
    zIndex: 10,
  };

  return (
    <div style={style}>
      ({Math.round(coord.x)}, {Math.round(coord.y)})
      {regionName && (
        <span style={{ marginLeft: 8, color: theme.colors.text.primary }}>
          {regionName}
        </span>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * WorldMap Component
 *
 * Full-featured world map with pan, zoom, and fog of war support.
 *
 * @example
 * ```tsx
 * function GameWorldMap() {
 *   const [waypoint, setWaypoint] = useState<WorldCoordinate | null>(null);
 *
 *   return (
 *     <WorldMap
 *       backgroundImage="/maps/world.png"
 *       playerPosition={{ x: 3200, y: 3200 }}
 *       onLocationClick={(coord) => setWaypoint(coord)}
 *       showCoordinates
 *       showGrid
 *     >
 *       {waypoint && (
 *         <MapMarker
 *           type="waypoint"
 *           position={waypoint}
 *           label="Waypoint"
 *         />
 *       )}
 *     </WorldMap>
 *   );
 * }
 * ```
 */
export const WorldMap = memo(function WorldMap({
  backgroundImage,
  backgroundColor = DEFAULT_OPTIONS.backgroundColor,
  worldBounds,
  regions,
  playerPosition,
  fogOfWar,
  showCoordinates = DEFAULT_OPTIONS.showCoordinates,
  showGrid = DEFAULT_OPTIONS.showGrid,
  gridSize = DEFAULT_OPTIONS.gridSize,
  initialCenter,
  initialZoom = DEFAULT_OPTIONS.initialZoom,
  minZoom = DEFAULT_OPTIONS.minZoom,
  maxZoom = DEFAULT_OPTIONS.maxZoom,
  onLocationClick,
  onViewportChange,
  onAreaChange,
  children,
  className,
  style,
}: WorldMapProps) {
  const theme = useTheme();

  // Use player position as initial center if not specified
  const center = initialCenter ?? playerPosition ?? { x: 3200, y: 3200 };

  // World map hook options
  const mapOptions: WorldMapOptions = useMemo(
    () => ({
      initialCenter: center,
      initialZoom,
      worldBounds,
      minZoom,
      maxZoom,
      regions,
      onViewportChange,
      onLocationClick,
      keyboardNavigation: true,
    }),
    [
      center,
      initialZoom,
      worldBounds,
      minZoom,
      maxZoom,
      regions,
      onViewportChange,
      onLocationClick,
    ],
  );

  const {
    viewport,
    mapRef,
    currentRegion,
    mapEventHandlers,
    handleKeyDown,
    isReady,
  } = useWorldMap(mapOptions);

  // Calculate actual world bounds for background sizing
  const effectiveWorldBounds = worldBounds ?? DEFAULT_WORLD_BOUNDS;
  const worldWidth = effectiveWorldBounds.maxX - effectiveWorldBounds.minX;
  const worldHeight = effectiveWorldBounds.maxY - effectiveWorldBounds.minY;

  // Keyboard navigation
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;

    // Make element focusable
    element.tabIndex = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      handleKeyDown(e);
    };

    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [handleKeyDown, mapRef]);

  // Notify on area change
  useEffect(() => {
    onAreaChange?.(currentRegion);
  }, [currentRegion, onAreaChange]);

  // Mouse position for coordinates display
  const [mousePosition, setMousePosition] =
    React.useState<WorldCoordinate | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mapEventHandlers.onMouseMove(e);

      if (showCoordinates) {
        const rect = mapRef.current?.getBoundingClientRect();
        if (!rect) return;

        const scale = 4 * viewport.zoom;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX =
          viewport.center.x + (mouseX - viewport.size.width / 2) / scale;
        const worldY =
          viewport.center.y - (mouseY - viewport.size.height / 2) / scale;

        setMousePosition({ x: worldX, y: worldY });
      }
    },
    [mapEventHandlers, showCoordinates, viewport, mapRef],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      mapEventHandlers.onMouseLeave(e);
      setMousePosition(null);
    },
    [mapEventHandlers],
  );

  // Container styles
  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    cursor: "grab",
    outline: "none",
    ...style,
  };

  // Background styles - calculate proper sizing based on world bounds and container aspect ratio
  const backgroundStyle: CSSProperties | undefined = useMemo(() => {
    if (
      !backgroundImage ||
      !isReady ||
      viewport.size.width === 0 ||
      viewport.size.height === 0
    ) {
      return undefined;
    }

    // Calculate how much of the world is visible at current zoom
    const pixelsPerUnit = 4; // DEFAULT_PIXELS_PER_UNIT
    const scale = pixelsPerUnit * viewport.zoom;

    // Calculate the background size to properly cover the world
    // The background image represents the entire world (worldWidth x worldHeight)
    // We need to scale it so that 1 world unit = scale pixels
    const bgWidth = worldWidth * scale;
    const bgHeight = worldHeight * scale;

    // Calculate background position
    // The center of the viewport should show viewport.center coordinates
    // Background position is relative to the container
    const centerXRatio =
      (viewport.center.x - effectiveWorldBounds.minX) / worldWidth;
    const centerYRatio =
      (effectiveWorldBounds.maxY - viewport.center.y) / worldHeight; // Y is inverted

    // Calculate offset so that the center point is at the center of the container
    const bgPosX = viewport.size.width / 2 - centerXRatio * bgWidth;
    const bgPosY = viewport.size.height / 2 - centerYRatio * bgHeight;

    return {
      position: "absolute" as const,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundImage: `url(${backgroundImage})`,
      backgroundSize: `${bgWidth}px ${bgHeight}px`,
      backgroundPosition: `${bgPosX}px ${bgPosY}px`,
      backgroundRepeat: "no-repeat",
      pointerEvents: "none" as const,
    };
  }, [
    backgroundImage,
    isReady,
    viewport,
    worldWidth,
    worldHeight,
    effectiveWorldBounds,
  ]);

  // Content wrapper for markers (applies coordinate transform)
  const contentStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  };

  // Provide context to children
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(
        child as React.ReactElement<{ viewport?: MapViewport }>,
        {
          viewport,
        },
      );
    }
    return child;
  });

  return (
    <div
      ref={mapRef}
      className={className}
      style={containerStyle}
      {...mapEventHandlers}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Background image - only render when we have proper dimensions */}
      {backgroundStyle && <div style={backgroundStyle} />}

      {/* Only render overlays when viewport is ready */}
      {isReady && (
        <>
          {/* Grid overlay */}
          {showGrid && gridSize && (
            <GridOverlay
              viewport={viewport}
              gridSize={gridSize}
              color={theme.colors.border.default}
            />
          )}

          {/* Fog of war */}
          {fogOfWar && <FogOverlay fogOfWar={fogOfWar} viewport={viewport} />}

          {/* Map content (markers, etc.) */}
          <div style={contentStyle}>{childrenWithProps}</div>

          {/* Coordinates display */}
          {showCoordinates && (
            <CoordinatesDisplay
              coord={mousePosition}
              regionName={currentRegion?.name ?? null}
            />
          )}
        </>
      )}

      {/* Loading indicator when not ready */}
      {!isReady && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: theme.colors.text.secondary,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          Loading map...
        </div>
      )}
    </div>
  );
});

export default WorldMap;
