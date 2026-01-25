/**
 * MapMarker Component
 *
 * Map marker/icon component for world map.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import {
  type WorldCoordinate,
  type MapViewport,
  type MarkerType,
  DEFAULT_MARKER_COLORS,
  DEFAULT_PIXELS_PER_UNIT,
  worldToMap,
} from "../core/map";

// ============================================================================
// Types
// ============================================================================

/** Props for MapMarker component */
export interface MapMarkerProps {
  /** Marker ID */
  id?: string;
  /** Marker type */
  type: MarkerType;
  /** World position */
  position: WorldCoordinate;
  /** Display label */
  label: string;
  /** Icon (emoji, URL, or icon name) */
  icon?: string;
  /** Custom color override */
  color?: string;
  /** Marker size in pixels */
  size?: number;
  /** Whether marker is highlighted/selected */
  highlighted?: boolean;
  /** Whether marker is pulsing/animated */
  pulsing?: boolean;
  /** Whether marker is interactive */
  interactive?: boolean;
  /** Map viewport (passed by WorldMap parent) */
  viewport?: MapViewport;
  /** Click handler */
  onClick?: () => void;
  /** Hover enter handler */
  onMouseEnter?: () => void;
  /** Hover leave handler */
  onMouseLeave?: () => void;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Constants
// ============================================================================

/** Default marker size */
const DEFAULT_SIZE = 24;

/** Default icons by type (emoji) */
const DEFAULT_ICONS: Record<MarkerType, string> = {
  player: "🧑",
  party: "👥",
  quest: "❗",
  poi: "📍",
  waypoint: "🚩",
  resource: "💎",
  npc: "💬",
  danger: "⚠️",
  custom: "⭐",
};

// ============================================================================
// Component
// ============================================================================

/**
 * MapMarker Component
 *
 * Renders a marker on the world map at the specified world coordinates.
 *
 * @example
 * ```tsx
 * <WorldMap>
 *   <MapMarker
 *     type="quest"
 *     position={{ x: 3200, y: 3200 }}
 *     label="Main Quest"
 *     highlighted
 *     onClick={() => showQuestDetails()}
 *   />
 *   <MapMarker
 *     type="waypoint"
 *     position={waypoint}
 *     label="Destination"
 *     pulsing
 *   />
 * </WorldMap>
 * ```
 */
export const MapMarker = memo(function MapMarker({
  id,
  type,
  position,
  label,
  icon,
  color,
  size = DEFAULT_SIZE,
  highlighted = false,
  pulsing = false,
  interactive = true,
  viewport,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
  style,
}: MapMarkerProps) {
  const theme = useTheme();

  // Calculate screen position from world coordinates
  const screenPos = viewport
    ? worldToMap(position, viewport, DEFAULT_PIXELS_PER_UNIT)
    : null;

  // Don't render if no viewport or off-screen
  if (!screenPos || !viewport) return null;

  // Check if marker is visible in viewport (with margin)
  const margin = size * 2;
  if (
    screenPos.x < -margin ||
    screenPos.x > viewport.size.width + margin ||
    screenPos.y < -margin ||
    screenPos.y > viewport.size.height + margin
  ) {
    return null;
  }

  const markerColor = color ?? DEFAULT_MARKER_COLORS[type];
  const markerIcon = icon ?? DEFAULT_ICONS[type];

  // Handle click
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.();
    },
    [onClick],
  );

  // Marker styles
  const markerStyle: CSSProperties = {
    position: "absolute",
    left: screenPos.x,
    top: screenPos.y,
    transform: "translate(-50%, -50%)",
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    backgroundColor: highlighted
      ? markerColor
      : theme.colors.background.secondary,
    border: `2px solid ${markerColor}`,
    boxShadow: highlighted
      ? `0 0 12px ${markerColor}, ${theme.shadows.md}`
      : theme.shadows.sm,
    cursor: interactive ? "pointer" : "default",
    pointerEvents: interactive ? "auto" : "none",
    transition: theme.transitions.fast,
    zIndex: highlighted ? 100 : type === "waypoint" ? 50 : 10,
    ...style,
  };

  // Pulsing animation styles
  const pulsingStyles: CSSProperties = pulsing
    ? {
        animation: "marker-pulse 2s infinite",
      }
    : {};

  // Icon styles
  const iconStyle: CSSProperties = {
    fontSize: size * 0.6,
    lineHeight: 1,
    userSelect: "none",
  };

  return (
    <>
      {/* Pulsing animation keyframes */}
      {pulsing && (
        <style>
          {`
            @keyframes marker-pulse {
              0%, 100% {
                transform: translate(-50%, -50%) scale(1);
                opacity: 1;
              }
              50% {
                transform: translate(-50%, -50%) scale(1.2);
                opacity: 0.8;
              }
            }
          `}
        </style>
      )}

      <div
        data-marker-id={id}
        data-marker-type={type}
        className={className}
        style={{ ...markerStyle, ...pulsingStyles }}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        title={label}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={label}
      >
        <span style={iconStyle}>{markerIcon}</span>
      </div>
    </>
  );
});

/**
 * Player marker with direction indicator
 */
export const PlayerMarker = memo(function PlayerMarker({
  position,
  label = "You",
  direction,
  viewport,
  isPartyMember = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
  style,
}: {
  position: WorldCoordinate;
  label?: string;
  direction?: number; // Degrees, 0 = North
  viewport?: MapViewport;
  isPartyMember?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const theme = useTheme();

  const screenPos = viewport
    ? worldToMap(position, viewport, DEFAULT_PIXELS_PER_UNIT)
    : null;

  if (!screenPos || !viewport) return null;

  const size = 28;
  const color = isPartyMember
    ? DEFAULT_MARKER_COLORS.party
    : DEFAULT_MARKER_COLORS.player;

  const markerStyle: CSSProperties = {
    position: "absolute",
    left: screenPos.x,
    top: screenPos.y,
    transform: "translate(-50%, -50%)",
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    backgroundColor: color,
    border: `3px solid ${theme.colors.text.primary}`,
    boxShadow: `0 0 8px ${color}, ${theme.shadows.md}`,
    cursor: onClick ? "pointer" : "default",
    pointerEvents: onClick ? "auto" : "none",
    zIndex: isPartyMember ? 90 : 100,
    ...style,
  };

  // Direction indicator
  const directionStyle: CSSProperties =
    direction !== undefined
      ? {
          position: "absolute",
          top: -6,
          left: "50%",
          transform: `translateX(-50%) rotate(${direction}deg)`,
          transformOrigin: "center 20px",
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: `10px solid ${theme.colors.text.primary}`,
        }
      : {};

  return (
    <div
      className={className}
      style={markerStyle}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={label}
      role={onClick ? "button" : undefined}
      aria-label={label}
    >
      {direction !== undefined && <div style={directionStyle} />}
    </div>
  );
});

export default MapMarker;
