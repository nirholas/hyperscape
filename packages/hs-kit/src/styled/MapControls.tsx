/**
 * MapControls Component
 *
 * Zoom buttons, layer toggles, and navigation controls for the map.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import type { LayerConfig, MarkerLayer } from "../core/map";

// ============================================================================
// Types
// ============================================================================

/** Props for MapControls component */
export interface MapControlsProps {
  /** Current zoom level */
  zoom?: number;
  /** Minimum zoom */
  minZoom?: number;
  /** Maximum zoom */
  maxZoom?: number;
  /** Callback to zoom in */
  onZoomIn?: () => void;
  /** Callback to zoom out */
  onZoomOut?: () => void;
  /** Callback to reset view */
  onReset?: () => void;
  /** Callback to center on player */
  onCenterPlayer?: () => void;
  /** Layer configs */
  layers?: LayerConfig[];
  /** Callback when layer is toggled */
  onLayerToggle?: (layer: MarkerLayer) => void;
  /** Whether minimap sync is enabled */
  minimapSyncEnabled?: boolean;
  /** Callback to toggle minimap sync */
  onMinimapSyncToggle?: () => void;
  /** Whether to show zoom buttons */
  showZoomButtons?: boolean;
  /** Whether to show zoom slider */
  showZoomSlider?: boolean;
  /** Callback when zoom changes via slider */
  onZoomChange?: (zoom: number) => void;
  /** Whether to show layer toggles */
  showLayerToggles?: boolean;
  /** Whether to show navigation buttons */
  showNavigationButtons?: boolean;
  /** Position of controls */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Layout orientation */
  orientation?: "horizontal" | "vertical";
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Sub-components
// ============================================================================

/** Control button */
const ControlButton = memo(function ControlButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const theme = useTheme();

  const buttonStyle: CSSProperties = {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: active
      ? theme.colors.accent.primary
      : theme.colors.background.secondary,
    border: `1px solid ${active ? theme.colors.accent.primary : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: theme.transitions.fast,
    fontSize: 16,
    color: active ? theme.colors.text.primary : theme.colors.text.secondary,
  };

  return (
    <button
      style={buttonStyle}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      type="button"
    >
      {icon}
    </button>
  );
});

/** Zoom slider */
const ZoomSlider = memo(function ZoomSlider({
  zoom,
  minZoom,
  maxZoom,
  onChange,
}: {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onChange?: (zoom: number) => void;
}) {
  const theme = useTheme();

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px 0`,
  };

  const sliderStyle: CSSProperties = {
    width: 4,
    height: 80,
    appearance: "none",
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: 2,
    outline: "none",
    cursor: "pointer",
    // Use standard slider rotation for vertical
    writingMode: "vertical-lr" as CSSProperties["writingMode"],
    direction: "rtl",
  };

  const labelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily.mono,
  };

  return (
    <div style={containerStyle}>
      <span style={labelStyle}>{Math.round(zoom * 100)}%</span>
      <input
        type="range"
        min={minZoom}
        max={maxZoom}
        step={0.05}
        value={zoom}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
        style={sliderStyle}
        aria-label="Zoom level"
      />
    </div>
  );
});

/** Layer toggle button */
const LayerToggle = memo(function LayerToggle({
  layer,
  onToggle,
}: {
  layer: LayerConfig;
  onToggle?: () => void;
}) {
  const theme = useTheme();

  const buttonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: layer.visible
      ? theme.colors.background.secondary
      : theme.colors.background.primary,
    border: `1px solid ${layer.visible ? layer.color : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    cursor: "pointer",
    transition: theme.transitions.fast,
    fontSize: theme.typography.fontSize.xs,
    color: layer.visible
      ? theme.colors.text.primary
      : theme.colors.text.disabled,
    opacity: layer.visible ? 1 : 0.6,
  };

  const dotStyle: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: layer.visible ? layer.color : theme.colors.text.disabled,
  };

  // Map icon names to emojis
  const iconMap: Record<string, string> = {
    users: "👥",
    scroll: "📜",
    "map-pin": "📍",
    pickaxe: "⛏️",
    flag: "🚩",
    star: "⭐",
  };

  return (
    <button
      style={buttonStyle}
      onClick={onToggle}
      title={`Toggle ${layer.label}`}
      aria-label={`Toggle ${layer.label}`}
      aria-pressed={layer.visible}
      type="button"
    >
      <span style={dotStyle} />
      <span>{iconMap[layer.icon] ?? "•"}</span>
      <span>{layer.label}</span>
    </button>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * MapControls Component
 *
 * Provides zoom, navigation, and layer controls for the world map.
 *
 * @example
 * ```tsx
 * function MapWithControls() {
 *   const { zoomIn, zoomOut, viewport, reset, setCenter } = useWorldMap();
 *   const { layers, toggleLayer } = useMapMarkers();
 *
 *   return (
 *     <div style={{ position: 'relative' }}>
 *       <WorldMap {...mapProps} />
 *       <MapControls
 *         zoom={viewport.zoom}
 *         onZoomIn={zoomIn}
 *         onZoomOut={zoomOut}
 *         onReset={reset}
 *         onCenterPlayer={() => setCenter(playerPos)}
 *         layers={layers}
 *         onLayerToggle={toggleLayer}
 *         position="top-right"
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export const MapControls = memo(function MapControls({
  zoom = 1,
  minZoom = 0.25,
  maxZoom = 4,
  onZoomIn,
  onZoomOut,
  onReset,
  onCenterPlayer,
  layers,
  onLayerToggle,
  minimapSyncEnabled = false,
  onMinimapSyncToggle,
  showZoomButtons = true,
  showZoomSlider = false,
  onZoomChange,
  showLayerToggles = true,
  showNavigationButtons = true,
  position = "top-right",
  orientation = "vertical",
  className,
  style,
}: MapControlsProps) {
  const theme = useTheme();

  // Position styles
  const positionStyles: Record<string, CSSProperties> = {
    "top-left": { top: 8, left: 8 },
    "top-right": { top: 8, right: 8 },
    "bottom-left": { bottom: 8, left: 8 },
    "bottom-right": { bottom: 8, right: 8 },
  };

  // Container styles
  const containerStyle: CSSProperties = {
    position: "absolute",
    ...positionStyles[position],
    display: "flex",
    flexDirection: orientation === "vertical" ? "column" : "row",
    gap: theme.spacing.sm,
    zIndex: 10,
    ...style,
  };

  // Group styles
  const groupStyle: CSSProperties = {
    display: "flex",
    flexDirection: orientation === "vertical" ? "column" : "row",
    gap: 2,
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.xs,
  };

  // Layer group styles (horizontal)
  const layerGroupStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.xs,
    maxHeight: 200,
    overflowY: "auto",
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Zoom controls */}
      {showZoomButtons && (
        <div style={groupStyle}>
          <ControlButton
            icon="+"
            label="Zoom in"
            onClick={onZoomIn}
            disabled={zoom >= maxZoom}
          />
          <ControlButton
            icon="-"
            label="Zoom out"
            onClick={onZoomOut}
            disabled={zoom <= minZoom}
          />
        </div>
      )}

      {/* Zoom slider */}
      {showZoomSlider && (
        <div style={groupStyle}>
          <ZoomSlider
            zoom={zoom}
            minZoom={minZoom}
            maxZoom={maxZoom}
            onChange={onZoomChange}
          />
        </div>
      )}

      {/* Navigation controls */}
      {showNavigationButtons && (
        <div style={groupStyle}>
          {onCenterPlayer && (
            <ControlButton
              icon="🎯"
              label="Center on player"
              onClick={onCenterPlayer}
            />
          )}
          {onReset && (
            <ControlButton icon="🔄" label="Reset view" onClick={onReset} />
          )}
          {onMinimapSyncToggle && (
            <ControlButton
              icon="🔗"
              label="Sync with minimap"
              onClick={onMinimapSyncToggle}
              active={minimapSyncEnabled}
            />
          )}
        </div>
      )}

      {/* Layer toggles */}
      {showLayerToggles && layers && layers.length > 0 && (
        <div style={layerGroupStyle}>
          {layers.map((layer) => (
            <LayerToggle
              key={layer.id}
              layer={layer}
              onToggle={() => onLayerToggle?.(layer.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default MapControls;
