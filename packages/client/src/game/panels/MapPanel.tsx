/**
 * MapPanel - World Map panel for the game interface
 *
 * Displays the full world map with player position, POI markers,
 * and navigation controls using the hs-kit WorldMap component.
 */

import React, { useMemo, useCallback, useState } from "react";
import { WorldMap, type WorldCoordinate, type MapViewport } from "hs-kit";
import type { ClientWorld } from "../../types";

interface MapPanelProps {
  world: ClientWorld;
}

/**
 * MapPanel Component
 *
 * Full world map with player tracking, zoom controls, and navigation.
 */
export function MapPanel({ world }: MapPanelProps) {
  const [waypoint, setWaypoint] = useState<WorldCoordinate | null>(null);

  // Get player position from world
  const playerPosition = useMemo<WorldCoordinate>(() => {
    const player = world.getPlayer?.();
    const pos = player?.position;
    if (pos) {
      return {
        x: pos.x,
        y: pos.z, // Map Y is world Z
        z: 0,
      };
    }
    // Default to center of world
    return { x: 3200, y: 3200, z: 0 };
  }, [world]);

  // World bounds from terrain system
  const worldBounds = useMemo(() => {
    const terrain = world.getSystem?.("terrain");
    if (terrain && typeof terrain === "object" && "getWorldBounds" in terrain) {
      const getBounds = terrain.getWorldBounds as () => {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
      return getBounds();
    }
    // Default world bounds
    return {
      minX: 0,
      minY: 0,
      maxX: 6400,
      maxY: 6400,
    };
  }, [world]);

  // Handle map click for waypoint
  const handleLocationClick = useCallback((coord: WorldCoordinate) => {
    setWaypoint(coord);
    // TODO: Could also set a navigation waypoint in the game
  }, []);

  // Handle viewport change for tracking
  const handleViewportChange = useCallback((_viewport: MapViewport) => {
    // Could track viewport state if needed
  }, []);

  // Get map background image
  // TODO: Replace with actual world map image when available
  const backgroundImage = "/assets/maps/world-map.png";

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 300 }}>
      <WorldMap
        backgroundImage={backgroundImage}
        backgroundColor="#1a2a1a"
        worldBounds={worldBounds}
        playerPosition={playerPosition}
        initialCenter={playerPosition}
        initialZoom={1.0}
        minZoom={0.25}
        maxZoom={4.0}
        showCoordinates
        showGrid
        gridSize={64}
        onLocationClick={handleLocationClick}
        onViewportChange={handleViewportChange}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Player marker */}
        <MapMarker
          type="player"
          position={playerPosition}
          label="You"
          color="#22c55e"
        />

        {/* Waypoint marker */}
        {waypoint && (
          <MapMarker
            type="waypoint"
            position={waypoint}
            label="Waypoint"
            color="#eab308"
          />
        )}

        {/* TODO: Add POI markers from world data */}
        {/* TODO: Add other player markers if enabled */}
      </WorldMap>

      {/* Waypoint controls */}
      {waypoint && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0, 0, 0, 0.7)",
            padding: "8px 12px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#eab308",
          }}
        >
          <span>
            Waypoint: ({Math.round(waypoint.x)}, {Math.round(waypoint.y)})
          </span>
          <button
            onClick={() => setWaypoint(null)}
            style={{
              background: "none",
              border: "1px solid #eab308",
              color: "#eab308",
              padding: "2px 8px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Map legend/controls */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          background: "rgba(0, 0, 0, 0.7)",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 11,
          color: "#9ca3af",
        }}
      >
        <div style={{ marginBottom: 4, color: "#d1d5db", fontWeight: 500 }}>
          Controls
        </div>
        <div>Drag to pan • Scroll to zoom</div>
        <div>Click to set waypoint</div>
        <div>WASD / Arrows to navigate</div>
      </div>
    </div>
  );
}

/**
 * MapMarker Component
 *
 * Simple marker for the world map.
 * TODO: Move to hs-kit as a proper component
 */
interface MapMarkerProps {
  type: "player" | "waypoint" | "poi" | "npc";
  position: WorldCoordinate;
  label?: string;
  color?: string;
  viewport?: MapViewport;
}

function MapMarker({
  type,
  position,
  label,
  color = "#ffffff",
  viewport,
}: MapMarkerProps) {
  // If no viewport, can't render
  if (!viewport || viewport.size.width === 0) {
    return null;
  }

  // Convert world position to screen position
  const scale = 4 * viewport.zoom;
  const screenX =
    viewport.size.width / 2 + (position.x - viewport.center.x) * scale;
  const screenY =
    viewport.size.height / 2 - (position.y - viewport.center.y) * scale;

  // Don't render if off-screen
  if (
    screenX < -20 ||
    screenX > viewport.size.width + 20 ||
    screenY < -20 ||
    screenY > viewport.size.height + 20
  ) {
    return null;
  }

  // Marker size based on type
  const size = type === "player" ? 12 : type === "waypoint" ? 10 : 8;

  return (
    <div
      style={{
        position: "absolute",
        left: screenX - size / 2,
        top: screenY - size / 2,
        width: size,
        height: size,
        borderRadius:
          type === "player" ? "50%" : type === "waypoint" ? 0 : "50%",
        backgroundColor: color,
        border: "2px solid white",
        transform: type === "waypoint" ? "rotate(45deg)" : undefined,
        pointerEvents: "none",
        zIndex: type === "player" ? 100 : 50,
      }}
    >
      {label && (
        <div
          style={{
            position: "absolute",
            top: size + 4,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 10,
            color: "white",
            textShadow: "0 1px 2px black",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

export default MapPanel;
