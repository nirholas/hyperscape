/**
 * Skill Tooltip Component
 *
 * Detailed tooltip for skill nodes showing name, description, costs, and effects.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../stores/themeStore";
import type { Theme } from "./themes";
import type {
  SkillNodeDef,
  SkillNodeProgress,
  SkillNodeState,
  SkillCost,
} from "../core/skilltree/skillTreeUtils";

// ============================================================================
// Types
// ============================================================================

/** Props for SkillTooltip component */
export interface SkillTooltipProps {
  /** Node definition */
  node: SkillNodeDef;
  /** Node progress */
  progress?: SkillNodeProgress | null;
  /** Whether the node can be purchased */
  canPurchase?: boolean;
  /** Whether the node can be refunded */
  canRefund?: boolean;
  /** Path cost to unlock this node (if locked) */
  pathCost?: SkillCost[];
  /** Custom effects to display */
  effects?: SkillEffect[];
  /** Position on screen */
  position?: { x: number; y: number };
  /** Anchor side */
  anchor?: "top" | "bottom" | "left" | "right";
  /** Whether tooltip is visible */
  visible?: boolean;
  /** Max width */
  maxWidth?: number;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /** Custom header content */
  headerSlot?: ReactNode;
  /** Custom footer content */
  footerSlot?: ReactNode;
}

/** Effect definition for skill */
export interface SkillEffect {
  /** Effect label */
  label: string;
  /** Current value */
  value: string | number;
  /** Value at next rank (optional) */
  nextValue?: string | number;
  /** Whether this is a positive effect */
  positive?: boolean;
  /** Icon for the effect */
  icon?: string | ReactNode;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatCostAmount(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toString();
}

function formatCostType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getStateLabel(state: SkillNodeState): string {
  switch (state) {
    case "locked":
      return "Locked";
    case "available":
      return "Available";
    case "purchased":
      return "Purchased";
    case "maxed":
      return "Maxed";
    default:
      return "";
  }
}

function getStateColor(state: SkillNodeState, theme: Theme): string {
  switch (state) {
    case "locked":
      return theme.colors.text.disabled;
    case "available":
      return theme.colors.state.info;
    case "purchased":
      return theme.colors.accent.primary;
    case "maxed":
      return theme.colors.state.success;
    default:
      return theme.colors.text.secondary;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Skill Tooltip Component
 *
 * @example
 * ```tsx
 * {hoveredNode && (
 *   <SkillTooltip
 *     node={hoveredNode}
 *     progress={progress.get(hoveredNode.id)}
 *     canPurchase={canPurchaseNode(hoveredNode.id)}
 *     position={{ x: mouseX, y: mouseY }}
 *     visible={true}
 *   />
 * )}
 * ```
 */
export const SkillTooltip = memo(function SkillTooltip({
  node,
  progress,
  canPurchase = false,
  canRefund = false,
  pathCost,
  effects,
  position,
  anchor = "right",
  visible = true,
  maxWidth = 300,
  className,
  style,
  headerSlot,
  footerSlot,
}: SkillTooltipProps): React.ReactElement | null {
  const theme = useTheme();

  if (!visible) return null;

  const state = progress?.state ?? "locked";
  const currentRank = progress?.currentRank ?? 0;
  const stateColor = getStateColor(state, theme);

  // Get cost for next rank
  const nextCost = useMemo(() => {
    if (currentRank >= node.maxRank) return null;
    const costIndex = Math.min(currentRank, node.costs.length - 1);
    return node.costs[costIndex] || null;
  }, [currentRank, node.maxRank, node.costs]);

  // Container positioning
  const containerStyle: CSSProperties = {
    position: position ? "fixed" : "relative",
    ...(position
      ? {
          left:
            anchor === "left" ? position.x - maxWidth - 16 : position.x + 16,
          top: anchor === "top" ? position.y - 16 : position.y + 16,
          transform:
            anchor === "top"
              ? "translateY(-100%)"
              : anchor === "bottom"
                ? "translateY(0)"
                : "translateY(-50%)",
        }
      : {}),
    width: maxWidth,
    maxWidth,
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.decorative}`,
    borderRadius: theme.borderRadius.lg,
    boxShadow: theme.shadows.lg,
    overflow: "hidden",
    zIndex: theme.zIndex.tooltip,
    pointerEvents: "none",
    animation: "tooltipFadeIn 150ms ease-out",
    ...style,
  };

  // Header style
  const headerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
  };

  // Body style
  const bodyStyle: CSSProperties = {
    padding: theme.spacing.sm,
  };

  // Footer style
  const footerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: theme.borderRadius.md,
              backgroundColor: theme.colors.background.tertiary,
              border: `1px solid ${theme.colors.border.default}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            {typeof node.icon === "string" ? (
              node.icon.startsWith("http") || node.icon.startsWith("/") ? (
                <img
                  src={node.icon}
                  alt=""
                  style={{ width: 28, height: 28, objectFit: "contain" }}
                />
              ) : (
                <span>{node.icon}</span>
              )
            ) : (
              node.icon
            )}
          </div>

          {/* Name and state */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.xs,
              }}
            >
              <span
                style={{
                  fontWeight: theme.typography.fontWeight.semibold,
                  color: theme.colors.text.primary,
                  fontSize: theme.typography.fontSize.base,
                }}
              >
                {node.name}
              </span>
              {node.isKeystone && (
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.accent.secondary,
                    fontWeight: theme.typography.fontWeight.bold,
                  }}
                >
                  KEYSTONE
                </span>
              )}
            </div>

            {/* State and rank */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.sm,
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.text.secondary,
              }}
            >
              <span style={{ color: stateColor }}>{getStateLabel(state)}</span>
              {node.maxRank > 1 && (
                <span>
                  Rank {currentRank}/{node.maxRank}
                </span>
              )}
            </div>
          </div>
        </div>

        {headerSlot}
      </div>

      {/* Body */}
      <div style={bodyStyle}>
        {/* Description */}
        <p
          style={{
            margin: 0,
            marginBottom: theme.spacing.sm,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.text.secondary,
            lineHeight: theme.typography.lineHeight.relaxed,
          }}
        >
          {node.description}
        </p>

        {/* Effects */}
        {effects && effects.length > 0 && (
          <div style={{ marginBottom: theme.spacing.sm }}>
            {effects.map((effect, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                  padding: `${theme.spacing.xs}px 0`,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                {effect.icon && (
                  <span style={{ opacity: 0.7 }}>{effect.icon}</span>
                )}
                <span style={{ color: theme.colors.text.secondary }}>
                  {effect.label}:
                </span>
                <span
                  style={{
                    color: effect.positive
                      ? theme.colors.state.success
                      : theme.colors.state.danger,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  {effect.value}
                </span>
                {effect.nextValue !== undefined && (
                  <span style={{ color: theme.colors.text.muted }}>
                    → {effect.nextValue}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cost to unlock */}
        {state === "available" && nextCost && (
          <div
            style={{
              padding: theme.spacing.xs,
              backgroundColor: theme.colors.background.tertiary,
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.sm,
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                marginBottom: 2,
              }}
            >
              Cost to unlock:
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.sm,
                fontSize: theme.typography.fontSize.sm,
                color: canPurchase
                  ? theme.colors.state.success
                  : theme.colors.state.danger,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              <span>
                {formatCostAmount(nextCost.amount)}{" "}
                {formatCostType(nextCost.type)}
              </span>
              {!canPurchase && (
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.state.danger,
                  }}
                >
                  (Insufficient)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Path cost for locked nodes */}
        {state === "locked" && pathCost && pathCost.length > 0 && (
          <div
            style={{
              padding: theme.spacing.xs,
              backgroundColor: theme.colors.background.tertiary,
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.sm,
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                marginBottom: 2,
              }}
            >
              Total cost to unlock:
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.text.secondary,
              }}
            >
              {pathCost.map((cost, i) => (
                <span key={cost.type}>
                  {i > 0 && ", "}
                  {formatCostAmount(cost.amount)} {formatCostType(cost.type)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {node.dependencies.length > 0 && state === "locked" && (
          <div
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
            }}
          >
            Requires: {node.dependencies.length} prerequisite skill
            {node.dependencies.length > 1 ? "s" : ""}
          </div>
        )}

        {/* Tags */}
        {node.tags.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: theme.spacing.xs,
              marginTop: theme.spacing.sm,
            }}
          >
            {node.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: `1px ${theme.spacing.xs}px`,
                  backgroundColor: theme.colors.background.tertiary,
                  borderRadius: theme.borderRadius.sm,
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.muted,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {(canPurchase || canRefund || footerSlot) && (
        <div style={footerStyle}>
          {footerSlot}
          {!footerSlot && (
            <div style={{ display: "flex", gap: theme.spacing.sm }}>
              {canPurchase && (
                <span style={{ color: theme.colors.text.secondary }}>
                  Click to unlock
                </span>
              )}
              {canRefund && (
                <span style={{ color: theme.colors.text.secondary }}>
                  Right-click to refund
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Animation keyframes */}
      <style>
        {`
          @keyframes tooltipFadeIn {
            from { opacity: 0; transform: translateY(-50%) scale(0.95); }
            to { opacity: 1; transform: translateY(-50%) scale(1); }
          }
        `}
      </style>
    </div>
  );
});

// ============================================================================
// Compact Tooltip Variant
// ============================================================================

/** Props for SkillTooltipCompact */
export interface SkillTooltipCompactProps {
  /** Node name */
  name: string;
  /** Current rank */
  currentRank: number;
  /** Max rank */
  maxRank: number;
  /** Node state */
  state: SkillNodeState;
  /** Position */
  position?: { x: number; y: number };
  /** Visible */
  visible?: boolean;
}

/**
 * Compact version of skill tooltip for hover previews
 */
export const SkillTooltipCompact = memo(function SkillTooltipCompact({
  name,
  currentRank,
  maxRank,
  state,
  position,
  visible = true,
}: SkillTooltipCompactProps): React.ReactElement | null {
  const theme = useTheme();

  if (!visible) return null;

  const stateColor = getStateColor(state, theme);

  return (
    <div
      style={{
        position: "fixed",
        left: position?.x ?? 0,
        top: (position?.y ?? 0) - 40,
        transform: "translateX(-50%)",
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        backgroundColor: theme.colors.background.overlay,
        borderRadius: theme.borderRadius.md,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.primary,
        whiteSpace: "nowrap",
        zIndex: theme.zIndex.tooltip,
        pointerEvents: "none",
      }}
    >
      <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
        {name}
      </span>
      <span style={{ color: stateColor, marginLeft: theme.spacing.xs }}>
        {maxRank > 1 ? `${currentRank}/${maxRank}` : getStateLabel(state)}
      </span>
    </div>
  );
});

export default SkillTooltip;
