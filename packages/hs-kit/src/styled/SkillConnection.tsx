/**
 * Skill Connection Component
 *
 * SVG path connecting two skill nodes with animated states.
 *
 * @packageDocumentation
 */

import React, { memo, useMemo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import type { Point } from "../types";
import { calculateConnectionPath } from "../core/skilltree/skillTreeUtils";

// ============================================================================
// Types
// ============================================================================

/** Props for SkillConnection component */
export interface SkillConnectionProps {
  /** Start position */
  from: Point;
  /** End position */
  to: Point;
  /** Whether the source node is purchased */
  active?: boolean;
  /** Whether the target node is available */
  targetAvailable?: boolean;
  /** Whether to show as highlighted (e.g., in a path preview) */
  highlighted?: boolean;
  /** Whether to use curved lines */
  curved?: boolean;
  /** Line width */
  strokeWidth?: number;
  /** Whether to animate the line */
  animated?: boolean;
  /** Animation duration in ms */
  animationDuration?: number;
  /** Custom class name */
  className?: string;
  /** Custom style for the SVG element */
  style?: CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Skill Connection Component
 *
 * Renders an SVG path between two nodes with state-based styling.
 *
 * @example
 * ```tsx
 * <SkillConnection
 *   from={{ x: 100, y: 100 }}
 *   to={{ x: 200, y: 150 }}
 *   active={true}
 *   targetAvailable={true}
 * />
 * ```
 */
export const SkillConnection = memo(function SkillConnection({
  from,
  to,
  active = false,
  targetAvailable = false,
  highlighted = false,
  curved = true,
  strokeWidth = 2,
  animated = true,
  animationDuration = 2000,
  className,
  style,
}: SkillConnectionProps): React.ReactElement {
  const theme = useTheme();

  // Calculate bounding box for SVG viewBox
  const bounds = useMemo(() => {
    const padding = 10;
    const minX = Math.min(from.x, to.x) - padding;
    const minY = Math.min(from.y, to.y) - padding;
    const maxX = Math.max(from.x, to.x) + padding;
    const maxY = Math.max(from.y, to.y) + padding;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [from, to]);

  // Determine colors based on state
  const colors = useMemo(() => {
    if (highlighted) {
      return {
        stroke: theme.colors.state.info,
        glow: theme.colors.state.info,
        opacity: 1,
      };
    }
    if (active && targetAvailable) {
      return {
        stroke: theme.colors.accent.primary,
        glow: theme.colors.accent.primary,
        opacity: 1,
      };
    }
    if (active) {
      return {
        stroke: theme.colors.accent.primary,
        glow: theme.colors.accent.primary,
        opacity: 0.6,
      };
    }
    return {
      stroke: theme.colors.border.default,
      glow: "transparent",
      opacity: 0.3,
    };
  }, [active, targetAvailable, highlighted, theme]);

  // Generate unique ID for this connection's gradient
  const gradientId = useMemo(
    () => `skill-conn-${from.x}-${from.y}-${to.x}-${to.y}`.replace(/\./g, "-"),
    [from, to],
  );

  // Container style - position absolutely in skill tree coordinate space
  const containerStyle: CSSProperties = {
    position: "absolute",
    left: bounds.minX,
    top: bounds.minY,
    width: bounds.width,
    height: bounds.height,
    pointerEvents: "none",
    overflow: "visible",
    ...style,
  };

  // Adjusted path for local SVG coordinates
  const localPath = useMemo(
    () =>
      calculateConnectionPath(
        { x: from.x - bounds.minX, y: from.y - bounds.minY },
        { x: to.x - bounds.minX, y: to.y - bounds.minY },
        curved,
      ),
    [from, to, bounds, curved],
  );

  // Calculate path length for animation
  const pathLength = useMemo(() => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy) * (curved ? 1.2 : 1);
  }, [from, to, curved]);

  return (
    <svg
      className={className}
      style={containerStyle}
      viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/* Gradient for active connections */}
        {active && (
          <linearGradient
            id={gradientId}
            x1={from.x < to.x ? "0%" : "100%"}
            y1={from.y < to.y ? "0%" : "100%"}
            x2={from.x < to.x ? "100%" : "0%"}
            y2={from.y < to.y ? "100%" : "0%"}
          >
            <stop offset="0%" stopColor={colors.stroke} stopOpacity={1} />
            <stop offset="100%" stopColor={colors.stroke} stopOpacity={0.4} />
          </linearGradient>
        )}

        {/* Glow filter */}
        <filter
          id={`${gradientId}-glow`}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background glow for active connections */}
      {active && (
        <path
          d={localPath}
          fill="none"
          stroke={colors.glow}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          opacity={0.3}
          filter={`url(#${gradientId}-glow)`}
        />
      )}

      {/* Main path */}
      <path
        d={localPath}
        fill="none"
        stroke={active ? `url(#${gradientId})` : colors.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={active ? "none" : "4 4"}
        opacity={colors.opacity}
        style={{
          transition: `opacity ${theme.transitions.normal}, stroke ${theme.transitions.normal}`,
        }}
      />

      {/* Animated flow for active connections */}
      {active && animated && (
        <path
          d={localPath}
          fill="none"
          stroke={theme.colors.text.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${pathLength * 0.1} ${pathLength * 0.9}`}
          opacity={0.8}
          style={{
            animation: `skillFlowAnimation ${animationDuration}ms linear infinite`,
          }}
        />
      )}

      {/* Arrow indicator at target for available nodes */}
      {active && targetAvailable && (
        <circle
          cx={to.x - bounds.minX}
          cy={to.y - bounds.minY}
          r={4}
          fill={colors.stroke}
          opacity={0.8}
        >
          <animate
            attributeName="r"
            values="3;5;3"
            dur="1.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.8;0.4;0.8"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Keyframes for flow animation */}
      <style>
        {`
          @keyframes skillFlowAnimation {
            0% { stroke-dashoffset: ${pathLength}; }
            100% { stroke-dashoffset: 0; }
          }
        `}
      </style>
    </svg>
  );
});

// ============================================================================
// Connection Group
// ============================================================================

/** Props for SkillConnectionGroup component */
export interface SkillConnectionGroupProps {
  /** Array of connections */
  connections: Array<{
    from: Point;
    to: Point;
    active: boolean;
    targetAvailable: boolean;
  }>;
  /** Whether to use curved lines */
  curved?: boolean;
  /** Line width */
  strokeWidth?: number;
  /** Whether to animate */
  animated?: boolean;
  /** Highlighted connection indices */
  highlightedConnections?: Set<number>;
}

/**
 * Renders multiple skill connections efficiently
 */
export const SkillConnectionGroup = memo(function SkillConnectionGroup({
  connections,
  curved = true,
  strokeWidth = 2,
  animated = true,
  highlightedConnections,
}: SkillConnectionGroupProps): React.ReactElement {
  return (
    <>
      {connections.map((conn, index) => (
        <SkillConnection
          key={`${conn.from.x}-${conn.from.y}-${conn.to.x}-${conn.to.y}`}
          from={conn.from}
          to={conn.to}
          active={conn.active}
          targetAvailable={conn.targetAvailable}
          highlighted={highlightedConnections?.has(index)}
          curved={curved}
          strokeWidth={strokeWidth}
          animated={animated}
        />
      ))}
    </>
  );
});

export default SkillConnection;
