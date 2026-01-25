/**
 * Skill Node Component
 *
 * Individual skill node with support for locked, available, purchased, and maxed states.
 * Includes rank display, cost indicator, and interaction handling.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../stores/themeStore";
import type { Theme } from "./themes";
import type { Point } from "../types";
import type {
  SkillNodeId,
  SkillNodeState,
  SkillCost,
} from "../core/skilltree/skillTreeUtils";

// ============================================================================
// Types
// ============================================================================

/** Props for SkillNode component */
export interface SkillNodeProps {
  /** Unique node ID */
  nodeId: SkillNodeId;
  /** Node position (center) */
  position: Point;
  /** Node state */
  state: SkillNodeState;
  /** Node name */
  name: string;
  /** Node icon (URL, emoji, or ReactNode) */
  icon: string | ReactNode;
  /** Current rank */
  currentRank: number;
  /** Maximum rank */
  maxRank: number;
  /** Size of the node */
  size?: number;
  /** Whether this is a keystone/major node */
  isKeystone?: boolean;
  /** Whether the node is selected */
  selected?: boolean;
  /** Whether the node is highlighted (e.g., in a path) */
  highlighted?: boolean;
  /** Whether the node can be purchased */
  canPurchase?: boolean;
  /** Cost for next rank */
  nextCost?: SkillCost[];
  /** Click handler */
  onClick?: (nodeId: SkillNodeId) => void;
  /** Context menu handler */
  onContextMenu?: (nodeId: SkillNodeId) => void;
  /** Hover handler */
  onHover?: (nodeId: SkillNodeId | null) => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatCost(costs: SkillCost[]): string {
  if (!costs || costs.length === 0) return "";
  return costs
    .map((c) => {
      if (c.amount >= 1000000) return `${(c.amount / 1000000).toFixed(1)}M`;
      if (c.amount >= 1000) return `${(c.amount / 1000).toFixed(1)}K`;
      return c.amount.toString();
    })
    .join(", ");
}

function getStateColors(state: SkillNodeState, theme: Theme) {
  switch (state) {
    case "locked":
      return {
        background: theme.colors.background.primary,
        border: theme.colors.border.default,
        icon: theme.colors.text.disabled,
        glow: "none",
      };
    case "available":
      return {
        background: theme.colors.background.secondary,
        border: theme.colors.accent.primary,
        icon: theme.colors.text.secondary,
        glow: `0 0 8px ${theme.colors.accent.primary}40`,
      };
    case "purchased":
      return {
        background: theme.colors.accent.primary + "30",
        border: theme.colors.accent.primary,
        icon: theme.colors.text.primary,
        glow: `0 0 12px ${theme.colors.accent.primary}60`,
      };
    case "maxed":
      return {
        background: theme.colors.accent.primary + "50",
        border: theme.colors.accent.secondary,
        icon: theme.colors.text.accent,
        glow: `0 0 16px ${theme.colors.accent.secondary}80`,
      };
    default:
      return {
        background: theme.colors.background.primary,
        border: theme.colors.border.default,
        icon: theme.colors.text.disabled,
        glow: "none",
      };
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Skill Node Component
 *
 * @example
 * ```tsx
 * <SkillNode
 *   nodeId="fireball"
 *   position={{ x: 100, y: 100 }}
 *   state="available"
 *   name="Fireball"
 *   icon="/icons/fireball.png"
 *   currentRank={0}
 *   maxRank={3}
 *   canPurchase={true}
 *   nextCost={[{ type: "skill_points", amount: 1 }]}
 *   onClick={(id) => purchaseNode(id)}
 * />
 * ```
 */
export const SkillNode = memo(function SkillNode({
  nodeId,
  position,
  state,
  name,
  icon,
  currentRank,
  maxRank,
  size = 48,
  isKeystone = false,
  selected = false,
  highlighted = false,
  canPurchase = false,
  nextCost,
  onClick,
  onContextMenu,
  onHover,
  className,
  style,
}: SkillNodeProps): React.ReactElement {
  const theme = useTheme();

  const nodeSize = isKeystone ? size * 1.5 : size;
  const colors = getStateColors(state, theme);

  // Event handlers
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.(nodeId);
    },
    [nodeId, onClick],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(nodeId);
    },
    [nodeId, onContextMenu],
  );

  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    onHover?.(nodeId);
  }, [nodeId, onHover]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    onHover?.(null);
  }, [onHover]);

  // Container style
  const containerStyle: CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    transform: "translate(-50%, -50%)",
    width: nodeSize,
    height: nodeSize,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: state === "locked" ? "not-allowed" : "pointer",
    ...style,
  };

  // Node circle style
  const nodeStyle: CSSProperties = {
    width: nodeSize,
    height: nodeSize,
    borderRadius: isKeystone ? theme.borderRadius.lg : "50%",
    backgroundColor: colors.background,
    border: `2px solid ${colors.border}`,
    boxShadow: `${colors.glow}${selected ? `, 0 0 0 3px ${theme.colors.accent.secondary}` : ""}${highlighted ? `, 0 0 20px ${theme.colors.state.info}` : ""}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: theme.transitions.fast,
    position: "relative",
    overflow: "hidden",
  };

  // Hover state
  const hoverStyle: CSSProperties =
    state !== "locked"
      ? {
          transform: "scale(1.1)",
          boxShadow: `${colors.glow}, 0 4px 12px rgba(0,0,0,0.3)`,
        }
      : {};

  // Icon style
  const iconStyle: CSSProperties = {
    width: nodeSize * 0.6,
    height: nodeSize * 0.6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.icon,
    fontSize: nodeSize * 0.4,
    filter: state === "locked" ? "grayscale(100%)" : "none",
    opacity: state === "locked" ? 0.5 : 1,
    transition: theme.transitions.fast,
  };

  // Rank badge style
  const rankBadgeStyle: CSSProperties = {
    position: "absolute",
    bottom: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor:
      state === "maxed"
        ? theme.colors.state.success
        : theme.colors.background.tertiary,
    border: `1px solid ${colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    padding: "0 4px",
  };

  // Cost indicator style
  const costStyle: CSSProperties = {
    position: "absolute",
    top: -8,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "1px 6px",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.background.overlay,
    fontSize: theme.typography.fontSize.xs,
    color: canPurchase ? theme.colors.state.success : theme.colors.state.danger,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };

  // Purchase indicator (pulsing glow for available)
  const purchaseIndicatorStyle: CSSProperties =
    state === "available" && canPurchase
      ? {
          position: "absolute",
          inset: -4,
          borderRadius: isKeystone ? theme.borderRadius.lg + 4 : "50%",
          border: `2px solid ${theme.colors.accent.primary}`,
          animation: "pulse 2s ease-in-out infinite",
          pointerEvents: "none",
        }
      : {};

  // Progress ring for multi-rank nodes
  const showProgressRing =
    maxRank > 1 && currentRank > 0 && currentRank < maxRank;
  const progressPercent = (currentRank / maxRank) * 100;

  return (
    <div
      className={className}
      style={containerStyle}
      data-skill-node
      data-node-id={nodeId}
      data-state={state}
    >
      {/* Cost indicator */}
      {state === "available" && nextCost && nextCost.length > 0 && (
        <div style={costStyle}>{formatCost(nextCost)}</div>
      )}

      {/* Purchase pulse indicator */}
      {state === "available" && canPurchase && (
        <div style={purchaseIndicatorStyle} />
      )}

      {/* Main node */}
      <div
        style={isHovered ? { ...nodeStyle, ...hoverStyle } : nodeStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
        aria-label={`${name}. ${currentRank} of ${maxRank}. ${state === "locked" ? "Locked" : state === "available" ? "Available" : state === "maxed" ? "Maxed" : "Purchased"}`}
        aria-selected={selected}
        aria-disabled={state === "locked"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.(nodeId);
          }
        }}
      >
        {/* Progress ring for multi-rank */}
        {showProgressRing && (
          <svg
            style={{
              position: "absolute",
              width: nodeSize + 8,
              height: nodeSize + 8,
              transform: "rotate(-90deg)",
              pointerEvents: "none",
            }}
          >
            <circle
              cx={(nodeSize + 8) / 2}
              cy={(nodeSize + 8) / 2}
              r={nodeSize / 2 + 2}
              fill="none"
              stroke={theme.colors.border.default}
              strokeWidth={2}
            />
            <circle
              cx={(nodeSize + 8) / 2}
              cy={(nodeSize + 8) / 2}
              r={nodeSize / 2 + 2}
              fill="none"
              stroke={theme.colors.accent.primary}
              strokeWidth={2}
              strokeDasharray={`${(progressPercent / 100) * Math.PI * (nodeSize + 4)} ${Math.PI * (nodeSize + 4)}`}
              style={{ transition: theme.transitions.normal }}
            />
          </svg>
        )}

        {/* Icon */}
        <div style={iconStyle}>
          {typeof icon === "string" ? (
            icon.startsWith("http") || icon.startsWith("/") ? (
              <img
                src={icon}
                alt={name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
                draggable={false}
              />
            ) : (
              <span>{icon}</span>
            )
          ) : (
            icon
          )}
        </div>

        {/* Rank badge */}
        {maxRank > 1 && (
          <div style={rankBadgeStyle}>
            {currentRank}/{maxRank}
          </div>
        )}

        {/* Maxed checkmark */}
        {state === "maxed" && maxRank === 1 && (
          <div
            style={{
              ...rankBadgeStyle,
              backgroundColor: theme.colors.state.success,
            }}
          >
            ✓
          </div>
        )}
      </div>

      {/* Keyframe animation for pulse */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 0.4; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.05); }
          }
        `}
      </style>
    </div>
  );
});

export default SkillNode;
