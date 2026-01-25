/**
 * Prayer Panel
 * RuneScape-inspired prayer interface with adaptive grid layout
 * Authentic OSRS/RS3 style design
 * Supports drag-drop to action bar
 * Syncs with server prayer state
 *
 * Layout adapts based on panel size:
 * - Wide: 5 columns (default OSRS style)
 * - Medium: 4 columns
 * - Narrow: 3 columns
 * - Very narrow: 2 columns (vertical layout)
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  calculateCursorTooltipPosition,
  useDraggable,
  useThemeStore,
  useMobileLayout,
} from "hs-kit";
import { zIndex, MOBILE_PRAYER } from "../../constants";
import { useTooltipSize } from "../../hooks";
import type { PlayerStats, ClientWorld } from "../../types";
import {
  EventType,
  type PrayerStateSyncPayload,
  type PrayerToggledEvent,
  type PrayerDefinition,
  prayerDataProvider,
} from "@hyperscape/shared";

// Prayer panel layout constants
const PRAYER_ICON_SIZE = 36;
const PRAYER_GAP = 3;
const PANEL_PADDING = 6;
const GRID_PADDING = 4;
const HEADER_HEIGHT = 60; // Prayer points header + bar
const FOOTER_HEIGHT = 40; // Active prayers footer

/**
 * Calculate number of columns based on available width
 * Prefers 5 columns (OSRS style) but adapts for narrower windows
 */
function calculateColumns(containerWidth: number): number {
  const availableWidth = containerWidth - PANEL_PADDING * 2 - GRID_PADDING * 2;
  // Calculate how many columns fit
  // Each column needs: icon size + gap (except last column)
  const colWidth = PRAYER_ICON_SIZE + PRAYER_GAP;
  const maxCols = Math.floor((availableWidth + PRAYER_GAP) / colWidth);
  // Clamp between 2-5 columns
  return Math.max(2, Math.min(5, maxCols));
}

/**
 * Calculate dimensions for different layouts
 */
function calculateLayoutDimensions(cols: number, prayerCount: number) {
  const rows = Math.ceil(prayerCount / cols);
  const gridWidth =
    cols * PRAYER_ICON_SIZE + (cols - 1) * PRAYER_GAP + GRID_PADDING * 2;
  const gridHeight =
    rows * PRAYER_ICON_SIZE + (rows - 1) * PRAYER_GAP + GRID_PADDING * 2;
  return {
    width: gridWidth + PANEL_PADDING * 2,
    height: gridHeight + HEADER_HEIGHT + FOOTER_HEIGHT + PANEL_PADDING * 2,
  };
}

// Default prayer count for dimension calculations
const DEFAULT_PRAYER_COUNT = 30;

// Calculate default dimensions for 5 columns (OSRS style)
const default5Col = calculateLayoutDimensions(5, DEFAULT_PRAYER_COUNT);
const default4Col = calculateLayoutDimensions(4, DEFAULT_PRAYER_COUNT);
const default3Col = calculateLayoutDimensions(3, DEFAULT_PRAYER_COUNT);
const default2Col = calculateLayoutDimensions(2, DEFAULT_PRAYER_COUNT);

/** Export dimensions for window configuration */
export const PRAYER_PANEL_DIMENSIONS = {
  // Minimum size: 2 columns
  minWidth: default2Col.width,
  minHeight: 220,
  // Preferred size: 5 columns (OSRS style)
  defaultWidth: default5Col.width,
  defaultHeight: default5Col.height,
  // Max size: wider for horizontal layouts
  maxWidth: 400,
  maxHeight: 500,
  // Layout breakpoints
  layouts: {
    twoCol: default2Col,
    threeCol: default3Col,
    fourCol: default4Col,
    fiveCol: default5Col,
  },
  // Icon sizing
  iconSize: PRAYER_ICON_SIZE,
  gap: PRAYER_GAP,
  padding: PANEL_PADDING,
};

/** Prayer UI representation (combines manifest definition with active state) */
interface PrayerUI {
  id: string;
  name: string;
  icon: string;
  level: number;
  description: string;
  drainRate: number;
  category: "offensive" | "defensive" | "utility";
  active: boolean;
}

interface PrayerPanelProps {
  stats: PlayerStats | null;
  world: ClientWorld;
}

/** Prayer icon component with OSRS-style glow effect and drag support */
function PrayerIcon({
  prayer,
  playerLevel,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  isMobile = false,
}: {
  prayer: PrayerUI;
  playerLevel: number;
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  isMobile?: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const isUnlocked = playerLevel >= prayer.level;
  const isActive = prayer.active;

  // Use mobile or desktop icon size
  const iconSize = isMobile ? MOBILE_PRAYER.iconSize : 36;

  // Make prayer draggable for action bar
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `prayer-${prayer.id}`,
    data: {
      prayer: {
        id: prayer.id,
        name: prayer.name,
        icon: prayer.icon,
        level: prayer.level,
      },
      source: "prayer",
    },
    disabled: !isUnlocked,
  });

  // Memoize button style to prevent recreation on every render
  const buttonStyle = useMemo(
    (): React.CSSProperties => ({
      width: iconSize,
      height: iconSize,
      padding: 0,
      background: isActive
        ? `radial-gradient(ellipse at center, ${theme.colors.accent.secondary}4D 0%, ${theme.colors.slot.selected} 70%)`
        : theme.colors.slot.filled,
      border: isActive
        ? `2px solid ${theme.colors.accent.secondary}B3`
        : `1px solid ${theme.colors.border.default}`,
      borderRadius: isMobile ? 4 : 2,
      cursor: isUnlocked ? (isDragging ? "grabbing" : "grab") : "not-allowed",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      transition: "all 0.2s ease",
      boxShadow: isActive
        ? `0 0 ${isMobile ? 16 : 12}px ${theme.colors.accent.secondary}80, inset 0 0 ${isMobile ? 20 : 15}px ${theme.colors.accent.secondary}33`
        : "inset 0 1px 3px rgba(0, 0, 0, 0.5)",
      opacity: isDragging ? 0.5 : 1,
      touchAction: "none",
    }),
    [isActive, isUnlocked, isDragging, theme, iconSize, isMobile],
  );

  return (
    <button
      ref={setNodeRef}
      onClick={isUnlocked ? onClick : undefined}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      disabled={!isUnlocked}
      aria-pressed={isActive}
      aria-label={`${prayer.name}${isActive ? " (Active)" : ""}${!isUnlocked ? " (Locked)" : ""}`}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      style={buttonStyle}
      {...attributes}
      {...listeners}
    >
      {/* Glow effect for active prayers */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            inset: -2,
            background: `radial-gradient(ellipse at center, ${theme.colors.accent.secondary}26 0%, transparent 70%)`,
            animation: "pulse 2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Prayer icon */}
      <span
        style={{
          // Mobile: larger icon text (24px), Desktop: 18px
          fontSize: isMobile ? 24 : 18,
          filter: isUnlocked
            ? isActive
              ? `drop-shadow(0 0 ${isMobile ? 8 : 6}px ${theme.colors.accent.secondary}CC) brightness(1.3)`
              : "none"
            : "grayscale(100%) brightness(0.4)",
          opacity: isUnlocked ? 1 : 0.5,
          transition: "all 0.2s ease",
          zIndex: 1,
        }}
      >
        {prayer.icon}
      </span>

      {/* Lock overlay for unavailable prayers */}
      {!isUnlocked && (
        <div
          style={{
            position: "absolute",
            bottom: 2,
            right: 2,
            fontSize: 8,
            color: theme.colors.state.danger,
            fontWeight: "bold",
          }}
        >
          {prayer.level}
        </div>
      )}
    </button>
  );
}

/**
 * Get prayer definitions from the manifest-loaded PrayerDataProvider.
 * This ensures prayer data (including conflicts) matches the server.
 * Returns empty array if manifest not yet loaded.
 */
function getPrayerDefinitions(): readonly PrayerDefinition[] {
  return prayerDataProvider.getAllPrayers();
}

export function PrayerPanel({ stats, world }: PrayerPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  const [hoveredPrayer, setHoveredPrayer] = useState<PrayerUI | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activePrayers, setActivePrayers] = useState<Set<string>>(new Set());
  const [prayerPoints, setPrayerPoints] = useState({ current: 1, max: 1 });
  const [containerWidth, setContainerWidth] = useState(
    PRAYER_PANEL_DIMENSIONS.defaultWidth,
  );
  const prayerTooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prayerTooltipSize = useTooltipSize(hoveredPrayer, prayerTooltipRef, {
    width: 200,
    height: 100,
  });

  const playerPrayerLevel = stats?.skills?.prayer?.level ?? 1;

  // Track container width for adaptive layout
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);
    // Set initial width
    setContainerWidth(containerRef.current.offsetWidth);

    return () => resizeObserver.disconnect();
  }, []);

  // Calculate number of columns based on container width and mobile state
  const gridColumns = useMemo(() => {
    if (shouldUseMobileUI) {
      // Mobile: max 4 columns with larger icons
      const availableWidth =
        containerWidth - PANEL_PADDING * 2 - GRID_PADDING * 2;
      const colWidth = MOBILE_PRAYER.iconSize + MOBILE_PRAYER.gap;
      const maxCols = Math.floor(
        (availableWidth + MOBILE_PRAYER.gap) / colWidth,
      );
      return Math.max(2, Math.min(MOBILE_PRAYER.maxColumns, maxCols));
    }
    return calculateColumns(containerWidth);
  }, [containerWidth, shouldUseMobileUI]);

  // Get prayer definitions from manifest-loaded provider (includes proper conflict data)
  const prayerDefinitions = useMemo(() => getPrayerDefinitions(), []);

  // Sync with server prayer state
  useEffect(() => {
    if (!world) return;

    // Get initial state from ClientNetwork cache (if panel mounted after sync event)
    const localPlayer = world.getPlayer();
    if (localPlayer) {
      const network = world.network as {
        lastPrayerStateByPlayerId?: Record<
          string,
          { points: number; maxPoints: number; active: string[] }
        >;
      };
      const cachedState = network?.lastPrayerStateByPlayerId?.[localPlayer.id];
      if (cachedState) {
        setPrayerPoints({
          current: cachedState.points,
          max: cachedState.maxPoints,
        });
        setActivePrayers(new Set(cachedState.active));
      }
    }

    const handlePrayerStateSync = (payload: unknown) => {
      const data = payload as PrayerStateSyncPayload;
      const player = world.getPlayer();
      if (!player || data.playerId !== player.id) return;

      setPrayerPoints({ current: data.points, max: data.maxPoints });
      setActivePrayers(new Set(data.active));
    };

    const handlePrayerToggled = (payload: unknown) => {
      const data = payload as PrayerToggledEvent;
      const player = world.getPlayer();
      if (!player || data.playerId !== player.id) return;

      setActivePrayers((prev) => {
        const next = new Set(prev);
        if (data.active) {
          next.add(data.prayerId);
        } else {
          next.delete(data.prayerId);
        }
        return next;
      });
      setPrayerPoints((prev) => ({ ...prev, current: data.points }));
    };

    const handlePrayerPointsChanged = (payload: unknown) => {
      const data = payload as {
        playerId: string;
        points: number;
        maxPoints: number;
      };
      const player = world.getPlayer();
      if (!player || data.playerId !== player.id) return;

      setPrayerPoints({ current: data.points, max: data.maxPoints });
    };

    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
    world.on(EventType.PRAYER_TOGGLED, handlePrayerToggled);
    world.on(EventType.PRAYER_POINTS_CHANGED, handlePrayerPointsChanged);

    return () => {
      world.off(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
      world.off(EventType.PRAYER_TOGGLED, handlePrayerToggled);
      world.off(EventType.PRAYER_POINTS_CHANGED, handlePrayerPointsChanged);
    };
  }, [world]);

  // Sync from stats prop as fallback
  useEffect(() => {
    if (stats?.prayerPoints) {
      setPrayerPoints({
        current: stats.prayerPoints.current,
        max: stats.prayerPoints.max,
      });
    }
  }, [stats?.prayerPoints]);

  // Convert prayer definitions to UI prayers with active state
  const prayers: PrayerUI[] = useMemo(() => {
    return prayerDefinitions
      .map((def) => ({
        id: def.id,
        name: def.name,
        icon: def.icon,
        level: def.level,
        description: def.description,
        drainRate: def.drainEffect,
        category: def.category,
        active: activePrayers.has(def.id),
      }))
      .sort((a, b) => a.level - b.level);
  }, [prayerDefinitions, activePrayers]);

  // Prayer points
  const prayerPct =
    prayerPoints.max > 0
      ? Math.min(
          100,
          Math.max(0, (prayerPoints.current / prayerPoints.max) * 100),
        )
      : 0;

  // Calculate total drain rate
  const totalDrain = prayers
    .filter((p) => p.active)
    .reduce((sum, p) => sum + p.drainRate, 0);

  // Toggle prayer - send to server via network
  const togglePrayer = useCallback(
    (id: string) => {
      const prayer = prayers.find((p) => p.id === id);
      if (!prayer || playerPrayerLevel < prayer.level) return;

      // Send to server via ClientNetwork - server handles conflicts and state
      const network = world.network;
      if (network && "togglePrayer" in network) {
        (network as { togglePrayer: (id: string) => void }).togglePrayer(id);
      }
    },
    [prayers, playerPrayerLevel, world],
  );

  // Deactivate all prayers
  const deactivateAll = useCallback(() => {
    if (activePrayers.size === 0) return;
    // Send to server via ClientNetwork
    const network = world.network;
    if (network && "deactivateAllPrayers" in network) {
      (network as { deactivateAllPrayers: () => void }).deactivateAllPrayers();
    }
  }, [activePrayers.size, world]);

  // Category colors using theme
  const getCategoryColor = (category: PrayerUI["category"]) => {
    switch (category) {
      case "defensive":
        return theme.colors.state.info;
      case "offensive":
        return theme.colors.accent.secondary;
      case "utility":
        return "#a78bfa"; // Purple for utility (not in theme)
      default:
        return theme.colors.accent.primary;
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full"
      style={{
        background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
        padding: PANEL_PADDING,
      }}
    >
      {/* Prayer Points Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px",
          marginBottom: 6,
          background: theme.colors.background.overlay,
          borderRadius: 4,
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>✨</span>
          <div>
            <div
              style={{
                fontSize: 10,
                color: theme.colors.text.muted,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Prayer Points
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: theme.colors.status.prayer,
              }}
            >
              {prayerPoints.current} / {prayerPoints.max}
            </div>
          </div>
        </div>

        {/* Drain indicator */}
        {totalDrain > 0 && (
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 9,
                color: theme.colors.state.danger,
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              Drain
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.colors.state.danger,
                fontWeight: 600,
              }}
            >
              -{totalDrain}/min
            </div>
          </div>
        )}
      </div>

      {/* Prayer Points Bar - Mobile: thicker (14px), Desktop: 6px */}
      <div
        style={{
          height: shouldUseMobileUI ? MOBILE_PRAYER.barHeight : 6,
          background: theme.colors.status.prayerBackground,
          borderRadius: shouldUseMobileUI ? 7 : 3,
          marginBottom: 8,
          overflow: "hidden",
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${prayerPct}%`,
            background: `linear-gradient(90deg, ${theme.colors.status.prayer} 0%, ${theme.colors.state.info} 100%)`,
            borderRadius: 2,
            transition: "width 0.3s ease",
            boxShadow:
              totalDrain > 0
                ? `0 0 8px ${theme.colors.status.prayer}80`
                : "none",
          }}
        />
      </div>

      {/* Prayer Grid - adaptive columns based on panel width */}
      <div
        className="scrollbar-thin"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            // Mobile: larger icons (48px) with more gap, Desktop: standard (36px)
            gridTemplateColumns: shouldUseMobileUI
              ? `repeat(${gridColumns}, ${MOBILE_PRAYER.iconSize}px)`
              : `repeat(${gridColumns}, ${PRAYER_ICON_SIZE}px)`,
            gap: shouldUseMobileUI ? MOBILE_PRAYER.gap : PRAYER_GAP,
            padding: GRID_PADDING,
            background: theme.colors.slot.empty,
            borderRadius: 4,
            border: `1px solid ${theme.colors.border.default}`,
            justifyContent: "center",
          }}
        >
          {prayers.map((prayer) => (
            <PrayerIcon
              key={prayer.id}
              prayer={prayer}
              playerLevel={playerPrayerLevel}
              onClick={() => togglePrayer(prayer.id)}
              onMouseEnter={(e) => {
                setHoveredPrayer(prayer);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoveredPrayer(null)}
              isMobile={shouldUseMobileUI}
            />
          ))}
        </div>
      </div>

      {/* Quick Prayers Toggle */}
      <div
        style={{
          marginTop: 6,
          padding: "6px 8px",
          background: theme.colors.background.overlay,
          borderRadius: 4,
          border: `1px solid ${theme.colors.border.default}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 10, color: theme.colors.text.muted }}>
          Active: {activePrayers.size} prayer
          {activePrayers.size !== 1 ? "s" : ""}
        </span>
        <button
          onClick={deactivateAll}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          style={{
            padding: "3px 8px",
            fontSize: 10,
            background:
              activePrayers.size > 0
                ? `${theme.colors.state.danger}33`
                : theme.colors.slot.disabled,
            border: `1px solid ${theme.colors.state.danger}66`,
            borderRadius: 3,
            color:
              activePrayers.size > 0
                ? theme.colors.state.danger
                : theme.colors.text.disabled,
            cursor: activePrayers.size > 0 ? "pointer" : "default",
          }}
          disabled={activePrayers.size === 0}
        >
          Deactivate All
        </button>
      </div>

      {/* Prayer Tooltip */}
      {hoveredPrayer &&
        createPortal(
          (() => {
            const tooltipSize = {
              width: prayerTooltipSize.width || 200,
              height: prayerTooltipSize.height || 100,
            };
            const { left, top } = calculateCursorTooltipPosition(
              mousePos,
              tooltipSize,
            );
            const isUnlocked = playerPrayerLevel >= hoveredPrayer.level;

            return (
              <div
                ref={prayerTooltipRef}
                className="fixed pointer-events-none"
                style={{
                  left,
                  top,
                  zIndex: zIndex.tooltip,
                  background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
                  border: `1px solid ${getCategoryColor(hoveredPrayer.category)}50`,
                  borderRadius: 4,
                  padding: "10px 12px",
                  boxShadow: theme.shadows.lg,
                  minWidth: 180,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{hoveredPrayer.icon}</span>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: getCategoryColor(hoveredPrayer.category),
                      }}
                    >
                      {hoveredPrayer.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: theme.colors.text.muted,
                      }}
                    >
                      Level {hoveredPrayer.level} Prayer
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div
                  style={{
                    fontSize: 11,
                    color: theme.colors.text.secondary,
                    marginBottom: 8,
                    lineHeight: 1.4,
                  }}
                >
                  {hoveredPrayer.description}
                </div>

                {/* Drain rate */}
                <div
                  style={{
                    fontSize: 10,
                    color: theme.colors.text.muted,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Drain rate:</span>
                  <span style={{ color: theme.colors.accent.secondary }}>
                    {hoveredPrayer.drainRate} points/min
                  </span>
                </div>

                {/* Status */}
                {!isUnlocked && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "4px 8px",
                      background: `${theme.colors.state.danger}26`,
                      borderRadius: 3,
                      fontSize: 10,
                      color: theme.colors.state.danger,
                      textAlign: "center",
                    }}
                  >
                    Requires level {hoveredPrayer.level} Prayer
                  </div>
                )}
                {hoveredPrayer.active && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "4px 8px",
                      background: `${theme.colors.state.success}26`,
                      borderRadius: 3,
                      fontSize: 10,
                      color: theme.colors.state.success,
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    Currently Active
                  </div>
                )}
              </div>
            );
          })(),
          document.body,
        )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
