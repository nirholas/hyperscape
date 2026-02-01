/**
 * Minimap Component
 *
 * Resizable square minimap with navigation features.
 * Supports click-to-move, compass, run energy, and world icons.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";
import { useEditStore } from "../stores/editStore";

/** Minimap icon */
export interface MinimapIcon {
  id: string;
  type: "npc" | "object" | "player" | "marker" | "custom";
  x: number;
  y: number;
  icon: string;
  label?: string;
  onClick?: () => void;
}

/** Minimap state */
export interface MinimapState {
  size: number; // 150-400 (square)
  position: { x: number; y: number };
  zoom: number; // 0.5-2.0
  rotation: number; // 0-360
  compassLocked: boolean;
}

/** Props for Minimap component */
export interface MinimapProps {
  /** Current minimap state */
  state: MinimapState;
  /** Player position in world */
  playerPosition?: { x: number; y: number };
  /** Icons to render on minimap */
  icons?: MinimapIcon[];
  /** Run energy (0-100) */
  runEnergy?: number;
  /** Whether running is enabled */
  isRunning?: boolean;
  /** Callback when minimap is clicked */
  onMinimapClick?: (worldX: number, worldY: number) => void;
  /** Callback when compass is clicked (reset rotation) */
  onCompassClick?: () => void;
  /** Callback when run orb is clicked */
  onRunOrbClick?: () => void;
  /** Callback when size changes (resize) */
  onSizeChange?: (size: number) => void;
  /** Callback to open world map */
  onWorldMapClick?: () => void;
  /** Callback to logout */
  onLogoutClick?: () => void;
  /** Minimum size */
  minSize?: number;
  /** Maximum size (Infinity for no limit) */
  maxSize?: number;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/** Pixels per game square */
const PIXELS_PER_SQUARE = 16;

/**
 * Minimap Component
 *
 * @example
 * ```tsx
 * function GameMinimap() {
 *   const [state, setState] = useState<MinimapState>({
 *     size: 200,
 *     position: { x: window.innerWidth - 220, y: 20 },
 *     zoom: 1.0,
 *     rotation: 0,
 *     compassLocked: true,
 *   });
 *
 *   return (
 *     <Minimap
 *       state={state}
 *       playerPosition={{ x: 3200, y: 3200 }}
 *       runEnergy={100}
 *       isRunning={true}
 *       onMinimapClick={(x, y) => movePlayer(x, y)}
 *       onSizeChange={(size) => setState(s => ({ ...s, size }))}
 *       icons={[
 *         { id: 'bank', type: 'object', x: 3205, y: 3210, icon: '🏦' },
 *       ]}
 *     />
 *   );
 * }
 * ```
 */
export const Minimap = memo(function Minimap({
  state,
  playerPosition = { x: 0, y: 0 },
  icons = [],
  runEnergy = 100,
  isRunning = false,
  onMinimapClick,
  onCompassClick,
  onRunOrbClick,
  onSizeChange,
  onWorldMapClick,
  onLogoutClick,
  minSize = 150,
  maxSize,
  className,
  style,
}: MinimapProps) {
  const theme = useTheme();
  const mode = useEditStore((s) => s.mode);
  const mapRef = useRef<HTMLDivElement>(null);
  const [_isResizing, setIsResizing] = useState(false);

  // Track cleanup function for resize listeners to prevent memory leaks on unmount
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Clean up resize listeners on unmount
  useEffect(() => {
    return () => {
      if (resizeCleanupRef.current) {
        resizeCleanupRef.current();
        resizeCleanupRef.current = null;
      }
    };
  }, []);

  // Handle minimap click
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent) => {
      if (!mapRef.current || !onMinimapClick) return;

      const rect = mapRef.current.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert to tile offset
      const offsetX = (clickX - centerX) / PIXELS_PER_SQUARE / state.zoom;
      const offsetY = (clickY - centerY) / PIXELS_PER_SQUARE / state.zoom;

      // Apply rotation if not locked
      let worldX = playerPosition.x + offsetX;
      let worldY = playerPosition.y + offsetY;

      if (!state.compassLocked && state.rotation !== 0) {
        const rad = (state.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        worldX = playerPosition.x + offsetX * cos - offsetY * sin;
        worldY = playerPosition.y + offsetX * sin + offsetY * cos;
      }

      onMinimapClick(Math.round(worldX), Math.round(worldY));
    },
    [state, playerPosition, onMinimapClick],
  );

  // Handle resize drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "unlocked" || !onSizeChange) return;

      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startSize = state.size;

      const handleMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - startY;
        // Use viewport as max if maxSize is not specified
        const effectiveMaxSize =
          maxSize ?? Math.min(window.innerWidth, window.innerHeight);
        const newSize = Math.max(
          minSize,
          Math.min(effectiveMaxSize, startSize + delta),
        );
        onSizeChange(Math.round(newSize / 8) * 8); // Snap to 8px grid
      };

      const handleUp = () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        resizeCleanupRef.current = null;
      };

      // Store cleanup function for unmount handling
      resizeCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [mode, state.size, minSize, maxSize, onSizeChange],
  );

  // Convert world position to minimap position
  const worldToMinimap = useCallback(
    (worldX: number, worldY: number): { x: number; y: number } | null => {
      const offsetX =
        (worldX - playerPosition.x) * PIXELS_PER_SQUARE * state.zoom;
      const offsetY =
        (worldY - playerPosition.y) * PIXELS_PER_SQUARE * state.zoom;

      const mapX = state.size / 2 + offsetX;
      const mapY = state.size / 2 + offsetY;

      // Check if within minimap bounds
      if (mapX < 0 || mapX > state.size || mapY < 0 || mapY > state.size) {
        return null;
      }

      return { x: mapX, y: mapY };
    },
    [state.size, state.zoom, playerPosition],
  );

  // Styles - square minimap with rounded corners
  const containerStyle: CSSProperties = {
    width: state.size,
    height: state.size,
    position: "relative",
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    border: `3px solid ${theme.colors.border.active}`,
    overflow: "hidden",
    boxShadow: theme.shadows.lg,
    ...style,
  };

  const mapAreaStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
    cursor: onMinimapClick ? "crosshair" : "default",
    backgroundColor: "#2a4a2a", // Map background (grass-like)
    transform: state.compassLocked ? "none" : `rotate(${-state.rotation}deg)`,
    transition: "transform 0.2s ease-out",
  };

  const playerMarkerStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 12,
    height: 12,
    backgroundColor: theme.colors.accent.primary,
    borderRadius: "50%",
    border: `2px solid ${theme.colors.text.primary}`,
    boxShadow: "0 0 4px rgba(0,0,0,0.5)",
    zIndex: 10,
  };

  const orbStyle = (color: string): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: "50%",
    backgroundColor: theme.colors.background.primary,
    border: `2px solid ${color}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    position: "relative",
    overflow: "hidden",
  });

  const orbFillStyle = (percent: number, color: string): CSSProperties => ({
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: `${percent}%`,
    backgroundColor: color,
    opacity: 0.6,
    transition: "height 0.3s ease-out",
  });

  const orbTextStyle: CSSProperties = {
    position: "relative",
    fontSize: 10,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    textShadow: "1px 1px 1px rgba(0,0,0,0.8)",
  };

  const resizeHandleStyle: CSSProperties = {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    cursor: mode === "unlocked" ? "se-resize" : "default",
    opacity: mode === "unlocked" ? 1 : 0,
    transition: "opacity 0.2s",
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Map area */}
      <div ref={mapRef} style={mapAreaStyle} onClick={handleMinimapClick}>
        {/* Icons */}
        {icons.map((icon) => {
          const pos = worldToMinimap(icon.x, icon.y);
          if (!pos) return null;

          return (
            <div
              key={icon.id}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                transform: "translate(-50%, -50%)",
                fontSize: 12,
                cursor: icon.onClick ? "pointer" : "default",
                zIndex: 5,
              }}
              onClick={(e) => {
                e.stopPropagation();
                icon.onClick?.();
              }}
              title={icon.label}
            >
              {icon.icon}
            </div>
          );
        })}

        {/* Player marker */}
        <div style={playerMarkerStyle} />
      </div>

      {/* Compass (top-right) */}
      <div
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          ...orbStyle(theme.colors.accent.secondary),
        }}
        onClick={onCompassClick}
        title="Reset camera (click to face north)"
      >
        <span
          style={{ fontSize: 14, transform: `rotate(${-state.rotation}deg)` }}
        >
          🧭
        </span>
      </div>

      {/* Run energy orb (bottom-left) */}
      <div
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          ...orbStyle(
            runEnergy < 25
              ? theme.colors.state.danger
              : theme.colors.status.energy,
          ),
        }}
        onClick={onRunOrbClick}
        title={`Run energy: ${runEnergy}% (click to toggle)`}
      >
        <div
          style={orbFillStyle(
            runEnergy,
            runEnergy < 25
              ? theme.colors.state.danger
              : theme.colors.status.energy,
          )}
        />
        <span style={orbTextStyle}>{isRunning ? "🏃" : "🚶"}</span>
      </div>

      {/* World map button (bottom-right) */}
      <div
        style={{
          position: "absolute",
          bottom: 4,
          right: 4,
          ...orbStyle(theme.colors.accent.secondary),
        }}
        onClick={onWorldMapClick}
        title="Open world map"
      >
        <span style={{ fontSize: 14 }}>🗺️</span>
      </div>

      {/* Logout button (top-left) */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          ...orbStyle(theme.colors.state.danger),
        }}
        onClick={onLogoutClick}
        title="Logout"
      >
        <span style={{ fontSize: 12 }}>🚪</span>
      </div>

      {/* Resize handle (edit mode only) */}
      {mode === "unlocked" && (
        <div
          style={resizeHandleStyle}
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill={theme.colors.text.secondary}
          >
            <path d="M14 14H10V12H12V10H14V14ZM14 8V6H12V8H14ZM8 14V12H6V14H8Z" />
          </svg>
        </div>
      )}
    </div>
  );
});

/**
 * Create default minimap state
 */
export function createMinimapState(
  size: number = 200,
  position?: { x: number; y: number },
): MinimapState {
  return {
    size: Math.max(150, Math.min(400, size)),
    position: position ?? {
      x: typeof window !== "undefined" ? window.innerWidth - size - 20 : 0,
      y: 20,
    },
    zoom: 1.0,
    rotation: 0,
    compassLocked: true,
  };
}
