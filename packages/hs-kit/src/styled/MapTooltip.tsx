/**
 * MapTooltip Component
 *
 * Hover tooltip for map locations and markers.
 *
 * @packageDocumentation
 */

import React, { memo, useMemo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import {
  type WorldCoordinate,
  type MapMarker,
  formatCoordinates,
  formatDistance,
  calculateDistance,
} from "../core/map";

// ============================================================================
// Types
// ============================================================================

/** Tooltip placement relative to anchor */
export type MapTooltipPlacement = "top" | "bottom" | "left" | "right" | "auto";

/** Props for MapTooltip component */
export interface MapTooltipProps {
  /** Marker to show tooltip for */
  marker?: MapMarker | null;
  /** Position to show tooltip at (screen coordinates) */
  position?: { x: number; y: number };
  /** Area/region name */
  areaName?: string | null;
  /** World coordinates to display */
  coordinates?: WorldCoordinate | null;
  /** Player position (for distance calculation) */
  playerPosition?: WorldCoordinate;
  /** Whether to show distance */
  showDistance?: boolean;
  /** Whether to show coordinates */
  showCoordinates?: boolean;
  /** Whether tooltip is visible */
  visible?: boolean;
  /** Tooltip placement */
  placement?: MapTooltipPlacement;
  /** Custom content */
  children?: React.ReactNode;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * MapTooltip Component
 *
 * Shows contextual information about map locations and markers.
 *
 * @example
 * ```tsx
 * function MapWithTooltip() {
 *   const [hoveredMarker, setHoveredMarker] = useState<MapMarker | null>(null);
 *   const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
 *
 *   return (
 *     <>
 *       <WorldMap onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}>
 *         {markers.map(marker => (
 *           <MapMarker
 *             key={marker.id}
 *             {...marker}
 *             onMouseEnter={() => setHoveredMarker(marker)}
 *             onMouseLeave={() => setHoveredMarker(null)}
 *           />
 *         ))}
 *       </WorldMap>
 *       <MapTooltip
 *         marker={hoveredMarker}
 *         position={mousePos}
 *         playerPosition={playerPos}
 *         visible={!!hoveredMarker}
 *         showDistance
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export const MapTooltip = memo(function MapTooltip({
  marker,
  position,
  areaName,
  coordinates,
  playerPosition,
  showDistance = true,
  showCoordinates = true,
  visible = true,
  placement = "auto",
  children,
  className,
  style,
}: MapTooltipProps) {
  const theme = useTheme();

  // Determine actual placement based on position
  const actualPlacement = useMemo(() => {
    if (placement !== "auto" || !position) return placement;

    // Auto-place based on screen position
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : 1920;
    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : 1080;

    // Prefer placing tooltip where there's more space
    if (position.y < viewportHeight / 3) return "bottom";
    if (position.y > (viewportHeight * 2) / 3) return "top";
    if (position.x < viewportWidth / 2) return "right";
    return "left";
  }, [placement, position]);

  // Calculate distance if we have both positions
  const distance = useMemo(() => {
    if (!showDistance || !playerPosition) return null;
    const targetPos = marker?.position ?? coordinates;
    if (!targetPos) return null;
    return calculateDistance(playerPosition, targetPos);
  }, [showDistance, playerPosition, marker?.position, coordinates]);

  // Get coordinates to display
  const displayCoordinates = marker?.position ?? coordinates;

  // Don't render if not visible or no content
  if (!visible) return null;
  if (!marker && !areaName && !coordinates && !children) return null;

  // Position offset based on placement
  const offsetX =
    actualPlacement === "left" ? -12 : actualPlacement === "right" ? 12 : 0;
  const offsetY =
    actualPlacement === "top" ? -12 : actualPlacement === "bottom" ? 12 : 0;

  // Transform based on placement
  const transform = {
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0%)",
    left: "translate(-100%, -50%)",
    right: "translate(0%, -50%)",
    auto: "translate(-50%, -100%)",
  }[actualPlacement];

  // Container styles
  const containerStyle: CSSProperties = {
    position: "fixed",
    left: position ? position.x + offsetX : "50%",
    top: position ? position.y + offsetY : "50%",
    transform,
    zIndex: theme.zIndex.tooltip,
    pointerEvents: "none",
    ...style,
  };

  // Tooltip box styles
  const tooltipStyle: CSSProperties = {
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    boxShadow: theme.shadows.lg,
    maxWidth: 280,
    minWidth: 120,
  };

  // Header styles (marker label or area name)
  const headerStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
  };

  // Info row styles
  const infoRowStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    display: "flex",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  };

  // Description styles
  const descriptionStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing.xs,
    lineHeight: theme.typography.lineHeight.normal,
  };

  // Marker type badge styles
  const badgeStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    padding: "1px 6px",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: marker?.color ?? theme.colors.accent.primary,
    color: theme.colors.text.primary,
    textTransform: "capitalize",
  };

  return (
    <div className={className} style={containerStyle}>
      <div style={tooltipStyle}>
        {/* Header: Marker label or area name */}
        {(marker || areaName) && (
          <div style={headerStyle}>
            {marker && (
              <>
                <span>{marker.icon}</span>
                <span>{marker.label}</span>
                <span style={badgeStyle}>{marker.type}</span>
              </>
            )}
            {!marker && areaName && <span>{areaName}</span>}
          </div>
        )}

        {/* Marker description */}
        {marker?.description && (
          <div style={descriptionStyle}>{marker.description}</div>
        )}

        {/* Info rows */}
        <div style={{ marginTop: marker || areaName ? theme.spacing.xs : 0 }}>
          {/* Coordinates */}
          {showCoordinates && displayCoordinates && (
            <div style={infoRowStyle}>
              <span>Position:</span>
              <span style={{ fontFamily: theme.typography.fontFamily.mono }}>
                {formatCoordinates(displayCoordinates)}
              </span>
            </div>
          )}

          {/* Distance */}
          {distance !== null && (
            <div style={infoRowStyle}>
              <span>Distance:</span>
              <span>{formatDistance(distance)}</span>
            </div>
          )}

          {/* Level/floor if present */}
          {marker?.level !== undefined && (
            <div style={infoRowStyle}>
              <span>Floor:</span>
              <span>{marker.level}</span>
            </div>
          )}
        </div>

        {/* Custom content */}
        {children}
      </div>
    </div>
  );
});

export default MapTooltip;
