/**
 * MapLegend Component
 *
 * Legend showing marker types and their meanings.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import { type LayerConfig, DEFAULT_MARKER_COLORS } from "../core/map";

// ============================================================================
// Types
// ============================================================================

/** Legend item for custom entries */
export interface LegendItem {
  id: string;
  label: string;
  icon: string;
  color: string;
  description?: string;
}

/** Props for MapLegend component */
export interface MapLegendProps {
  /** Layer configs (for toggleable layers) */
  layers?: LayerConfig[];
  /** Custom legend items */
  items?: LegendItem[];
  /** Callback when layer is toggled */
  onLayerToggle?: (layerId: string) => void;
  /** Whether legend is collapsible */
  collapsible?: boolean;
  /** Whether legend is collapsed */
  collapsed?: boolean;
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Position of the legend */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Title of the legend */
  title?: string;
  /** Whether to show layer checkboxes */
  showCheckboxes?: boolean;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Constants
// ============================================================================

/** Default legend items (marker types) */
export const DEFAULT_LEGEND_ITEMS: LegendItem[] = [
  {
    id: "player",
    label: "Player",
    icon: "🧑",
    color: DEFAULT_MARKER_COLORS.player,
  },
  {
    id: "party",
    label: "Party Member",
    icon: "👥",
    color: DEFAULT_MARKER_COLORS.party,
  },
  {
    id: "quest",
    label: "Quest",
    icon: "❗",
    color: DEFAULT_MARKER_COLORS.quest,
  },
  {
    id: "poi",
    label: "Point of Interest",
    icon: "📍",
    color: DEFAULT_MARKER_COLORS.poi,
  },
  {
    id: "waypoint",
    label: "Waypoint",
    icon: "🚩",
    color: DEFAULT_MARKER_COLORS.waypoint,
  },
  {
    id: "resource",
    label: "Resource",
    icon: "💎",
    color: DEFAULT_MARKER_COLORS.resource,
  },
  { id: "npc", label: "NPC", icon: "💬", color: DEFAULT_MARKER_COLORS.npc },
  {
    id: "danger",
    label: "Danger Zone",
    icon: "⚠️",
    color: DEFAULT_MARKER_COLORS.danger,
  },
];

// ============================================================================
// Component
// ============================================================================

/**
 * MapLegend Component
 *
 * Shows a legend of marker types with optional layer toggles.
 *
 * @example
 * ```tsx
 * function MapWithLegend() {
 *   const { layers, toggleLayer } = useMapMarkers();
 *
 *   return (
 *     <div style={{ position: 'relative' }}>
 *       <WorldMap>
 *         {markers}
 *       </WorldMap>
 *       <MapLegend
 *         layers={layers}
 *         onLayerToggle={toggleLayer}
 *         position="bottom-right"
 *         collapsible
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export const MapLegend = memo(function MapLegend({
  layers,
  items = DEFAULT_LEGEND_ITEMS,
  onLayerToggle,
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
  position = "bottom-right",
  title = "Legend",
  showCheckboxes = true,
  className,
  style,
}: MapLegendProps) {
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
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    minWidth: 140,
    maxWidth: 200,
    zIndex: 10,
    ...style,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: collapsed ? 0 : theme.spacing.sm,
    cursor: collapsible ? "pointer" : "default",
  };

  const titleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
  };

  const collapseIconStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    transition: theme.transitions.fast,
    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
  };

  // Content styles
  const contentStyle: CSSProperties = {
    display: collapsed ? "none" : "block",
  };

  // Item styles
  const itemStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px 0`,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  };

  const iconContainerStyle = (
    color: string,
    visible: boolean,
  ): CSSProperties => ({
    width: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    backgroundColor: visible ? color : theme.colors.background.tertiary,
    border: `1px solid ${visible ? color : theme.colors.border.default}`,
    opacity: visible ? 1 : 0.5,
    transition: theme.transitions.fast,
    fontSize: 12,
  });

  const labelStyle = (visible: boolean): CSSProperties => ({
    flex: 1,
    color: visible ? theme.colors.text.secondary : theme.colors.text.disabled,
    transition: theme.transitions.fast,
  });

  const checkboxStyle: CSSProperties = {
    width: 14,
    height: 14,
    cursor: "pointer",
    accentColor: theme.colors.accent.primary,
  };

  // Handle header click for collapse
  const handleHeaderClick = () => {
    if (collapsible && onCollapsedChange) {
      onCollapsedChange(!collapsed);
    }
  };

  // Render layer items
  const renderLayerItems = () => {
    if (!layers) return null;

    return layers.map((layer) => (
      <div key={layer.id} style={itemStyle}>
        <div style={iconContainerStyle(layer.color, layer.visible)}>
          {layer.icon === "users" && "👥"}
          {layer.icon === "scroll" && "📜"}
          {layer.icon === "map-pin" && "📍"}
          {layer.icon === "pickaxe" && "⛏️"}
          {layer.icon === "flag" && "🚩"}
          {layer.icon === "star" && "⭐"}
        </div>
        <span style={labelStyle(layer.visible)}>{layer.label}</span>
        {showCheckboxes && onLayerToggle && (
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={() => onLayerToggle(layer.id)}
            style={checkboxStyle}
            aria-label={`Toggle ${layer.label}`}
          />
        )}
      </div>
    ));
  };

  // Render custom items
  const renderCustomItems = () => {
    return items.map((item) => (
      <div key={item.id} style={itemStyle}>
        <div style={iconContainerStyle(item.color, true)}>{item.icon}</div>
        <span style={labelStyle(true)}>{item.label}</span>
      </div>
    ));
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div
        style={headerStyle}
        onClick={handleHeaderClick}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        tabIndex={collapsible ? 0 : undefined}
      >
        <span style={titleStyle}>{title}</span>
        {collapsible && <span style={collapseIconStyle}>▼</span>}
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* Layer toggles */}
        {layers && layers.length > 0 && <div>{renderLayerItems()}</div>}

        {/* Divider if both layers and items */}
        {layers && layers.length > 0 && items && items.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${theme.colors.border.default}`,
              margin: `${theme.spacing.sm}px 0`,
            }}
          />
        )}

        {/* Custom items (if no layers) */}
        {(!layers || layers.length === 0) && items && items.length > 0 && (
          <div>{renderCustomItems()}</div>
        )}
      </div>
    </div>
  );
});

export default MapLegend;
