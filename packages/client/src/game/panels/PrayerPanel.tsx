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
import { useDraggable } from "@dnd-kit/core";
import {
  calculateCursorTooltipPosition,
  useThemeStore,
  useMobileLayout,
} from "@/ui";
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

// Type guards for prayer events
function isPrayerStateSyncPayload(
  data: unknown,
): data is PrayerStateSyncPayload {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.playerId === "string" &&
    typeof obj.points === "number" &&
    typeof obj.maxPoints === "number" &&
    Array.isArray(obj.active)
  );
}

function isPrayerToggledPayload(data: unknown): data is PrayerToggledEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.playerId === "string" &&
    typeof obj.prayerId === "string" &&
    typeof obj.active === "boolean"
  );
}

// Prayer panel layout constants - compact sizing
const PRAYER_ICON_SIZE = 36; // Compact icon size
const PRAYER_GAP = 2; // Tight gap
const PANEL_PADDING = 3; // Minimal container padding
const GRID_PADDING = 3; // Minimal grid padding
const HEADER_HEIGHT = 44; // Compact prayer points header + bar
const FOOTER_HEIGHT = 28; // Compact active prayers footer

/**
 * Calculate number of columns based on available width
 * Prefers 6 columns by default, adapts for narrower windows
 */
function calculateColumns(containerWidth: number): number {
  const availableWidth = containerWidth - PANEL_PADDING * 2 - GRID_PADDING * 2;
  // Calculate how many columns fit
  // Each column needs: icon size + gap (except last column)
  const colWidth = PRAYER_ICON_SIZE + PRAYER_GAP;
  const maxCols = Math.floor((availableWidth + PRAYER_GAP) / colWidth);
  // Clamp between 2-6 columns
  return Math.max(2, Math.min(6, maxCols));
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

// Calculate default dimensions for various column layouts
const default6Col = calculateLayoutDimensions(6, DEFAULT_PRAYER_COUNT);
const default5Col = calculateLayoutDimensions(5, DEFAULT_PRAYER_COUNT);
const default4Col = calculateLayoutDimensions(4, DEFAULT_PRAYER_COUNT);
const default3Col = calculateLayoutDimensions(3, DEFAULT_PRAYER_COUNT);
const default2Col = calculateLayoutDimensions(2, DEFAULT_PRAYER_COUNT);

/** Export dimensions for window configuration */
export const PRAYER_PANEL_DIMENSIONS = {
  // Minimum size: 2 columns
  minWidth: default2Col.width,
  minHeight: 235,
  // Preferred size: 6 columns (compact layout)
  defaultWidth: default6Col.width,
  defaultHeight: default6Col.height,
  // Max size: wider for horizontal layouts
  maxWidth: 520,
  maxHeight: 585,
  // Layout breakpoints
  layouts: {
    twoCol: default2Col,
    threeCol: default3Col,
    fourCol: default4Col,
    fiveCol: default5Col,
    sixCol: default6Col,
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

/**
 * Map prayer icon IDs from manifest to display icons.
 * Uses emoji fallbacks until actual prayer icon assets are added.
 * Icon IDs follow pattern: prayer_{snake_case_name}
 */
const PRAYER_ICON_MAP: Record<string, string> = {
  // Defense prayers
  prayer_thick_skin: "🛡️",
  prayer_rock_skin: "🪨",
  prayer_steel_skin: "🔩",
  // Strength prayers
  prayer_burst_of_strength: "💪",
  prayer_superhuman_strength: "⚡",
  prayer_ultimate_strength: "🔥",
  // Attack prayers
  prayer_clarity_of_thought: "🎯",
  prayer_improved_reflexes: "⚔️",
  prayer_incredible_reflexes: "⚡",
  // Ranged prayers
  prayer_sharp_eye: "👁️",
  prayer_hawk_eye: "🦅",
  prayer_eagle_eye: "🎯",
  // Magic prayers
  prayer_mystic_will: "✨",
  prayer_mystic_lore: "📖",
  prayer_mystic_might: "🌟",
  // Protection prayers
  prayer_protect_from_magic: "🔮",
  prayer_protect_from_missiles: "🏹",
  prayer_protect_from_melee: "🗡️",
  // Utility prayers
  prayer_rapid_restore: "💚",
  prayer_rapid_heal: "❤️",
  prayer_protect_item: "🔒",
  prayer_retribution: "💀",
  prayer_redemption: "💖",
  prayer_smite: "⚡",
  prayer_preserve: "⏳",
  // High-level prayers
  prayer_chivalry: "🏰",
  prayer_piety: "⚜️",
  prayer_rigour: "🏹",
  prayer_augury: "🌙",
};

/**
 * Get display icon for a prayer icon ID.
 * Returns the mapped emoji or falls back to a default prayer icon.
 */
function getPrayerDisplayIcon(iconId: string): string {
  return PRAYER_ICON_MAP[iconId] ?? "✨";
}

/** Prayer icon component with OSRS-style glow effect and drag support */
function PrayerIcon({
  prayer,
  playerLevel,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  isMobile = false,
}: {
  prayer: PrayerUI;
  playerLevel: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  isMobile?: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const isUnlocked = playerLevel >= prayer.level;
  const isActive = prayer.active;

  // Use mobile or desktop icon size - compact on desktop
  const iconSize = isMobile ? MOBILE_PRAYER.iconSize : PRAYER_ICON_SIZE;

  // Track pointer position to distinguish clicks from drags
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Make prayer draggable for action bar
  // Pass the display icon (emoji) not the raw icon ID so it shows correctly in action bar
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `prayer-${prayer.id}`,
    data: {
      prayer: {
        id: prayer.id,
        name: prayer.name,
        icon: getPrayerDisplayIcon(prayer.icon),
        level: prayer.level,
      },
      source: "prayer",
    },
    disabled: !isUnlocked,
  });

  // Wrap drag listeners to track pointer start position for click vs drag detection
  const wrappedListeners = useMemo(() => {
    if (!listeners) return {};
    const originalPointerDown = listeners.onPointerDown;
    return {
      ...listeners,
      onPointerDown: (e: React.PointerEvent) => {
        pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
        originalPointerDown?.(e);
      },
    };
  }, [listeners]);

  // Handle click - only fire if pointer didn't move much (click, not drag)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isUnlocked) return;

      // Check if pointer moved significantly (drag activation distance is 3px)
      if (pointerStartPosRef.current) {
        const dx = e.clientX - pointerStartPosRef.current.x;
        const dy = e.clientY - pointerStartPosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // If moved more than activation distance, this was a drag, not a click
        if (distance > 3) {
          return;
        }
      }

      // Not a drag, execute the click action
      onClick();
    },
    [onClick, isUnlocked],
  );

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
        ? `1px solid ${theme.colors.accent.secondary}B3`
        : `1px solid ${theme.colors.border.default}40`,
      borderRadius: isMobile ? 4 : 2,
      cursor: isUnlocked ? (isDragging ? "grabbing" : "grab") : "not-allowed",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      transition: "all 0.15s ease",
      boxShadow: isActive
        ? `0 0 ${isMobile ? 12 : 8}px ${theme.colors.accent.secondary}80, inset 0 0 ${isMobile ? 16 : 10}px ${theme.colors.accent.secondary}33`
        : "inset 0 1px 2px rgba(0, 0, 0, 0.4)",
      opacity: isDragging ? 0.5 : 1,
      touchAction: "none",
    }),
    [isActive, isUnlocked, isDragging, theme, iconSize, isMobile],
  );

  return (
    <button
      ref={setNodeRef}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      disabled={!isUnlocked}
      aria-label={`${prayer.name}${isActive ? " (Active)" : ""}${!isUnlocked ? " (Locked)" : ""}`}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      style={buttonStyle}
      {...attributes}
      {...wrappedListeners}
      aria-pressed={isActive}
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
          // Mobile: larger icon text (22px), Desktop: 16px for compact look
          fontSize: isMobile ? 22 : 16,
          filter: isUnlocked
            ? isActive
              ? `drop-shadow(0 0 ${isMobile ? 6 : 4}px ${theme.colors.accent.secondary}CC) brightness(1.3)`
              : "none"
            : "grayscale(100%) brightness(0.4)",
          opacity: isUnlocked ? 1 : 0.5,
          transition: "all 0.15s ease",
          zIndex: 1,
        }}
      >
        {getPrayerDisplayIcon(prayer.icon)}
      </span>

      {/* Lock overlay for unavailable prayers */}
      {!isUnlocked && (
        <div
          style={{
            position: "absolute",
            bottom: 1,
            right: 1,
            fontSize: 7,
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

/** Prayer context menu state */
interface PrayerContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  prayer: PrayerUI | null;
}

export function PrayerPanel({ stats, world }: PrayerPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  const [hoveredPrayer, setHoveredPrayer] = useState<PrayerUI | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activePrayers, setActivePrayers] = useState<Set<string>>(new Set());
  const [containerWidth, setContainerWidth] = useState(
    PRAYER_PANEL_DIMENSIONS.defaultWidth,
  );
  // Track when prayer data is loaded (manifest might load after component mounts)
  const [prayerDataVersion, setPrayerDataVersion] = useState(0);
  // Context menu state
  const [contextMenu, setContextMenu] = useState<PrayerContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    prayer: null,
  });
  const prayerTooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Use prayer points directly from stats prop (same pattern as StatusBars)
  // This ensures a single source of truth - no local state that can get out of sync
  const prayerPoints = stats?.prayerPoints ?? { current: 0, max: 1 };

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
      // Mobile: always use 4 columns for consistent layout
      return MOBILE_PRAYER.minColumns;
    }
    return calculateColumns(containerWidth);
  }, [containerWidth, shouldUseMobileUI]);

  // Poll for prayer data availability (manifest may load after component mounts)
  useEffect(() => {
    const prayers = prayerDataProvider.getAllPrayers();
    if (prayers.length > 0) {
      // Prayers already loaded
      setPrayerDataVersion((v) => v + 1);
      return;
    }

    // Poll until prayers are loaded (manifest loading is async)
    const interval = setInterval(() => {
      const loaded = prayerDataProvider.getAllPrayers();
      if (loaded.length > 0) {
        setPrayerDataVersion((v) => v + 1);
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Get prayer definitions from manifest-loaded provider (includes proper conflict data)
  // Re-fetch when prayerDataVersion changes (after manifest loads)
  const prayerDefinitions = useMemo(
    () => getPrayerDefinitions(),
    [prayerDataVersion],
  );

  // Sync active prayers with server prayer state
  // Note: Prayer POINTS now come from stats prop (single source of truth)
  // Only active prayers need local state since they come from prayer-specific events
  useEffect(() => {
    if (!world) return;

    // Get initial active prayers from ClientNetwork cache (if panel mounted after sync event)
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
        setActivePrayers(new Set(cachedState.active));
      }
    }

    const handlePrayerStateSync = (payload: unknown) => {
      // Type guard for PrayerStateSyncPayload
      if (!isPrayerStateSyncPayload(payload)) {
        console.warn(
          "[PrayerPanel] Invalid prayer state sync payload:",
          payload,
        );
        return;
      }
      const player = world.getPlayer();
      if (!player || payload.playerId !== player.id) return;

      // Only update active prayers - points come from stats prop
      setActivePrayers(new Set(payload.active));
    };

    const handlePrayerToggled = (payload: unknown) => {
      // Type guard for PrayerToggledEvent
      if (!isPrayerToggledPayload(payload)) {
        console.warn("[PrayerPanel] Invalid prayer toggled payload:", payload);
        return;
      }
      const player = world.getPlayer();
      if (!player || payload.playerId !== player.id) return;

      setActivePrayers((prev) => {
        const next = new Set(prev);
        if (payload.active) {
          next.add(payload.prayerId);
        } else {
          next.delete(payload.prayerId);
        }
        return next;
      });
      // Note: Prayer points update will come through stats prop via PRAYER_POINTS_CHANGED -> CoreUI -> stats
    };

    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
    world.on(EventType.PRAYER_TOGGLED, handlePrayerToggled);

    return () => {
      world.off(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
      world.off(EventType.PRAYER_TOGGLED, handlePrayerToggled);
    };
  }, [world]);

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

  // Handle prayer context menu (right-click)
  const handlePrayerContextMenu = useCallback(
    (e: React.MouseEvent, prayer: PrayerUI) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        prayer,
      });
    },
    [],
  );

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    if (contextMenu.visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [contextMenu.visible]);

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
        background: "transparent",
        padding: shouldUseMobileUI ? 4 : 3,
      }}
    >
      {/* Prayer Points Header - Compact */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: shouldUseMobileUI ? "4px 6px" : "3px 6px",
          marginBottom: 4,
          background: theme.colors.slot.filled,
          borderRadius: 3,
          border: `1px solid ${theme.colors.border.default}30`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: shouldUseMobileUI ? 16 : 14 }}>✨</span>
          <div>
            <div
              style={{
                fontSize: shouldUseMobileUI ? 9 : 8,
                color: theme.colors.text.muted,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Prayer Points
            </div>
            <div
              style={{
                fontSize: shouldUseMobileUI ? 13 : 11,
                fontWeight: 600,
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
                fontSize: 8,
                color: theme.colors.state.danger,
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              Drain
            </div>
            <div
              style={{
                fontSize: 10,
                color: theme.colors.state.danger,
                fontWeight: 600,
              }}
            >
              -{totalDrain}/min
            </div>
          </div>
        )}
      </div>

      {/* Prayer Points Bar - Compact */}
      <div
        style={{
          height: shouldUseMobileUI ? 10 : 4,
          background: theme.colors.slot.empty,
          borderRadius: shouldUseMobileUI ? 5 : 2,
          marginBottom: 4,
          overflow: "hidden",
          border: `1px solid ${theme.colors.border.default}30`,
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
                ? `0 0 6px ${theme.colors.status.prayer}80`
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
            // Mobile: larger icons (48px) with more gap, Desktop: compact
            gridTemplateColumns: shouldUseMobileUI
              ? `repeat(${gridColumns}, ${MOBILE_PRAYER.iconSize}px)`
              : `repeat(${gridColumns}, ${PRAYER_ICON_SIZE}px)`,
            gap: shouldUseMobileUI ? MOBILE_PRAYER.gap : PRAYER_GAP,
            padding: GRID_PADDING,
            background: theme.colors.slot.empty,
            borderRadius: 3,
            border: `1px solid ${theme.colors.border.default}30`,
            justifyContent: "center",
          }}
        >
          {prayers.map((prayer) => (
            <PrayerIcon
              key={prayer.id}
              prayer={prayer}
              playerLevel={playerPrayerLevel}
              onClick={() => togglePrayer(prayer.id)}
              onContextMenu={(e) => handlePrayerContextMenu(e, prayer)}
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

      {/* Quick Prayers Toggle - Compact */}
      <div
        style={{
          marginTop: 4,
          padding: shouldUseMobileUI ? "4px 6px" : "3px 6px",
          background: theme.colors.slot.filled,
          borderRadius: 3,
          border: `1px solid ${theme.colors.border.default}30`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: shouldUseMobileUI ? 10 : 9,
            color: theme.colors.text.muted,
          }}
        >
          Active: {activePrayers.size} prayer
          {activePrayers.size !== 1 ? "s" : ""}
        </span>
        <button
          onClick={deactivateAll}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          style={{
            padding: shouldUseMobileUI ? "3px 8px" : "2px 6px",
            fontSize: shouldUseMobileUI ? 10 : 9,
            background:
              activePrayers.size > 0
                ? `${theme.colors.state.danger}20`
                : theme.colors.slot.disabled,
            border: `1px solid ${activePrayers.size > 0 ? theme.colors.state.danger : theme.colors.border.default}40`,
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
                  <span style={{ fontSize: 22 }}>
                    {getPrayerDisplayIcon(hoveredPrayer.icon)}
                  </span>
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

      {/* Prayer Context Menu */}
      {contextMenu.visible &&
        contextMenu.prayer &&
        createPortal(
          (() => {
            const prayer = contextMenu.prayer!;
            const isUnlocked = playerPrayerLevel >= prayer.level;
            const actionText = prayer.active ? "Deactivate" : "Activate";

            // Calculate position to show above cursor
            const padding = 4;
            const menuHeight = isUnlocked ? 64 : 40; // Approximate height
            let top = contextMenu.y - menuHeight - padding;
            if (top < padding) top = contextMenu.y + padding;
            const left = Math.max(
              padding,
              Math.min(contextMenu.x, window.innerWidth - 120 - padding),
            );

            return (
              <div
                ref={contextMenuRef}
                className="fixed z-[9999]"
                style={{ left, top }}
              >
                <div
                  style={{
                    background: theme.colors.background.secondary,
                    border: `1px solid ${theme.colors.border.default}`,
                    borderRadius: 4,
                    boxShadow: theme.shadows.lg,
                    overflow: "hidden",
                    minWidth: 100,
                  }}
                >
                  {/* Activate/Deactivate option */}
                  {isUnlocked && (
                    <button
                      onClick={() => {
                        togglePrayer(prayer.id);
                        setContextMenu((prev) => ({ ...prev, visible: false }));
                      }}
                      className="w-full text-left transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400/60"
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "block",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = `${theme.colors.accent.secondary}1F`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{ color: "#fff" }}>{actionText} </span>
                      <span style={{ color: theme.colors.status.prayer }}>
                        {prayer.name}
                      </span>
                    </button>
                  )}
                  {/* Cancel option */}
                  <button
                    onClick={() => {
                      setContextMenu((prev) => ({ ...prev, visible: false }));
                    }}
                    className="w-full text-left transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400/60"
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "block",
                      borderTop: isUnlocked
                        ? `1px solid ${theme.colors.border.default}26`
                        : "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${theme.colors.accent.secondary}1F`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span style={{ color: "#fff" }}>Cancel</span>
                  </button>
                </div>
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
