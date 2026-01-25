/**
 * Skill Tree Component
 *
 * Main container for skill tree visualization with pan/zoom support.
 * Renders nodes, connections, and handles viewport navigation.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { useTheme } from "../stores/themeStore";
import type { Point } from "../types";

// ============================================================================
// Types
// ============================================================================

/** Props for SkillTree component */
export interface SkillTreeProps {
  /** Width of the tree container */
  width?: number | string;
  /** Height of the tree container */
  height?: number | string;
  /** Current view offset */
  viewOffset?: Point;
  /** Current zoom level (1 = 100%) */
  zoom?: number;
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Zoom step for wheel/keyboard */
  zoomStep?: number;
  /** Whether pan is enabled */
  panEnabled?: boolean;
  /** Whether zoom is enabled */
  zoomEnabled?: boolean;
  /** Whether keyboard navigation is enabled */
  keyboardEnabled?: boolean;
  /** Callback when view changes */
  onViewChange?: (offset: Point, zoom: number) => void;
  /** Callback when pan starts */
  onPanStart?: () => void;
  /** Callback when pan ends */
  onPanEnd?: () => void;
  /** Background color or element */
  background?: string | ReactNode;
  /** Grid overlay settings */
  showGrid?: boolean;
  /** Grid size in pixels */
  gridSize?: number;
  /** Children (SkillNode, SkillConnection components) */
  children?: ReactNode;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Skill Tree Container Component
 *
 * @example
 * ```tsx
 * function MySkillTree() {
 *   const [offset, setOffset] = useState({ x: 0, y: 0 });
 *   const [zoom, setZoom] = useState(1);
 *
 *   return (
 *     <SkillTree
 *       viewOffset={offset}
 *       zoom={zoom}
 *       onViewChange={(newOffset, newZoom) => {
 *         setOffset(newOffset);
 *         setZoom(newZoom);
 *       }}
 *     >
 *       {connections.map(conn => (
 *         <SkillConnection key={conn.id} {...conn} />
 *       ))}
 *       {nodes.map(node => (
 *         <SkillNode key={node.id} {...node} />
 *       ))}
 *     </SkillTree>
 *   );
 * }
 * ```
 */
export const SkillTree = memo(function SkillTree({
  width = "100%",
  height = "100%",
  viewOffset = { x: 0, y: 0 },
  zoom = 1,
  minZoom = 0.25,
  maxZoom = 2,
  zoomStep = 0.1,
  panEnabled = true,
  zoomEnabled = true,
  keyboardEnabled = true,
  onViewChange,
  onPanStart,
  onPanEnd,
  background,
  showGrid = false,
  gridSize = 50,
  children,
  className,
  style,
}: SkillTreeProps): React.ReactElement {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<Point | null>(null);
  const viewStartRef = useRef<Point | null>(null);

  // Clamp zoom to bounds
  const clampZoom = useCallback(
    (z: number) => Math.max(minZoom, Math.min(maxZoom, z)),
    [minZoom, maxZoom],
  );

  // Handle wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!zoomEnabled) return;

      e.preventDefault();

      const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
      const newZoom = clampZoom(zoom + delta);

      if (newZoom !== zoom && onViewChange) {
        // Zoom towards mouse position
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const mouseX = e.clientX - rect.left - rect.width / 2;
          const mouseY = e.clientY - rect.top - rect.height / 2;

          // Adjust offset to zoom towards cursor
          const scale = newZoom / zoom;
          const newOffsetX = viewOffset.x - (mouseX * (1 - scale)) / newZoom;
          const newOffsetY = viewOffset.y - (mouseY * (1 - scale)) / newZoom;

          onViewChange({ x: newOffsetX, y: newOffsetY }, newZoom);
        } else {
          onViewChange(viewOffset, newZoom);
        }
      }
    },
    [zoomEnabled, zoom, zoomStep, clampZoom, viewOffset, onViewChange],
  );

  // Handle pan start
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!panEnabled) return;

      // Only pan with left mouse button or touch
      if (e.button !== 0) return;

      // Don't pan if clicking on a node
      const target = e.target as HTMLElement;
      if (target.closest("[data-skill-node]")) return;

      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      viewStartRef.current = { ...viewOffset };
      onPanStart?.();

      // Capture pointer for smooth panning
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [panEnabled, viewOffset, onPanStart],
  );

  // Handle pan move
  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isPanning || !panStartRef.current || !viewStartRef.current) return;

      const dx = (e.clientX - panStartRef.current.x) / zoom;
      const dy = (e.clientY - panStartRef.current.y) / zoom;

      onViewChange?.(
        {
          x: viewStartRef.current.x + dx,
          y: viewStartRef.current.y + dy,
        },
        zoom,
      );
    },
    [isPanning, zoom, onViewChange],
  );

  // Handle pan end
  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isPanning) return;

      setIsPanning(false);
      panStartRef.current = null;
      viewStartRef.current = null;
      onPanEnd?.();

      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [isPanning, onPanEnd],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardEnabled || !onViewChange) return;

      const panAmount = 50 / zoom;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          onViewChange({ x: viewOffset.x, y: viewOffset.y + panAmount }, zoom);
          break;
        case "ArrowDown":
          e.preventDefault();
          onViewChange({ x: viewOffset.x, y: viewOffset.y - panAmount }, zoom);
          break;
        case "ArrowLeft":
          e.preventDefault();
          onViewChange({ x: viewOffset.x + panAmount, y: viewOffset.y }, zoom);
          break;
        case "ArrowRight":
          e.preventDefault();
          onViewChange({ x: viewOffset.x - panAmount, y: viewOffset.y }, zoom);
          break;
        case "+":
        case "=":
          e.preventDefault();
          onViewChange(viewOffset, clampZoom(zoom + zoomStep));
          break;
        case "-":
        case "_":
          e.preventDefault();
          onViewChange(viewOffset, clampZoom(zoom - zoomStep));
          break;
        case "0":
          e.preventDefault();
          onViewChange({ x: 0, y: 0 }, 1);
          break;
      }
    },
    [keyboardEnabled, viewOffset, zoom, zoomStep, clampZoom, onViewChange],
  );

  // Container styles
  const containerStyle: CSSProperties = {
    width,
    height,
    position: "relative",
    overflow: "hidden",
    backgroundColor:
      typeof background === "string"
        ? background
        : theme.colors.background.primary,
    cursor: isPanning ? "grabbing" : panEnabled ? "grab" : "default",
    userSelect: "none",
    touchAction: "none",
    outline: "none",
    ...style,
  };

  // Transform wrapper styles
  const transformStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: `translate(${viewOffset.x * zoom}px, ${viewOffset.y * zoom}px) scale(${zoom})`,
    transformOrigin: "center center",
    transition: isPanning ? "none" : "transform 100ms ease-out",
    willChange: "transform",
  };

  // Grid background
  const gridBackground = showGrid
    ? `
      linear-gradient(${theme.colors.border.default}40 1px, transparent 1px),
      linear-gradient(90deg, ${theme.colors.border.default}40 1px, transparent 1px)
    `
    : undefined;

  const gridBackgroundSize = showGrid
    ? `${gridSize * zoom}px ${gridSize * zoom}px`
    : undefined;

  const gridBackgroundPosition = showGrid
    ? `${viewOffset.x * zoom}px ${viewOffset.y * zoom}px`
    : undefined;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...containerStyle,
        backgroundImage: gridBackground,
        backgroundSize: gridBackgroundSize,
        backgroundPosition: gridBackgroundPosition,
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Skill tree. Use arrow keys to pan, +/- to zoom, 0 to reset."
    >
      {/* Custom background */}
      {typeof background !== "string" && background && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        >
          {background}
        </div>
      )}

      {/* Transform wrapper for pan/zoom */}
      <div style={transformStyle}>{children}</div>

      {/* Zoom indicator */}
      <div
        style={{
          position: "absolute",
          bottom: theme.spacing.sm,
          right: theme.spacing.sm,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          backgroundColor: theme.colors.background.glass,
          borderRadius: theme.borderRadius.md,
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.text.secondary,
          pointerEvents: "none",
        }}
      >
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
});

// ============================================================================
// Zoom Controls
// ============================================================================

/** Props for SkillTreeZoomControls component */
export interface SkillTreeZoomControlsProps {
  /** Current zoom level */
  zoom: number;
  /** Minimum zoom */
  minZoom?: number;
  /** Maximum zoom */
  maxZoom?: number;
  /** Zoom in callback */
  onZoomIn?: () => void;
  /** Zoom out callback */
  onZoomOut?: () => void;
  /** Reset zoom callback */
  onReset?: () => void;
  /** Fit to view callback */
  onFitToView?: () => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Zoom controls for skill tree
 */
export const SkillTreeZoomControls = memo(function SkillTreeZoomControls({
  zoom,
  minZoom = 0.25,
  maxZoom = 2,
  onZoomIn,
  onZoomOut,
  onReset,
  onFitToView,
  className,
  style,
}: SkillTreeZoomControlsProps): React.ReactElement {
  const theme = useTheme();

  const buttonStyle: CSSProperties = {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.text.primary,
    cursor: "pointer",
    fontSize: theme.typography.fontSize.lg,
    transition: theme.transitions.fast,
  };

  const disabledStyle: CSSProperties = {
    opacity: 0.5,
    cursor: "not-allowed",
  };

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    backgroundColor: theme.colors.background.glass,
    borderRadius: theme.borderRadius.lg,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    ...style,
  };

  return (
    <div className={className} style={containerStyle}>
      <button
        style={{
          ...buttonStyle,
          ...(zoom >= maxZoom ? disabledStyle : {}),
        }}
        onClick={onZoomIn}
        disabled={zoom >= maxZoom}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        style={{
          ...buttonStyle,
          ...(zoom <= minZoom ? disabledStyle : {}),
        }}
        onClick={onZoomOut}
        disabled={zoom <= minZoom}
        aria-label="Zoom out"
      >
        -
      </button>
      <button style={buttonStyle} onClick={onReset} aria-label="Reset zoom">
        1:1
      </button>
      {onFitToView && (
        <button
          style={buttonStyle}
          onClick={onFitToView}
          aria-label="Fit to view"
        >
          <span style={{ fontSize: theme.typography.fontSize.xs }}>FIT</span>
        </button>
      )}
    </div>
  );
});

export default SkillTree;
