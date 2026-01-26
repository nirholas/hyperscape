/**
 * Tiered Tooltip Component
 *
 * Displays tooltip content based on tier level:
 * - immediate: Name and keybind only
 * - delayed: Stats, requirements, effects
 * - examine: Full description, origin, value
 *
 * @packageDocumentation
 */

import React, { memo } from "react";
import { useTheme } from "../stores/themeStore";
import type { TooltipTier } from "../core/tooltip/useProgressiveTooltip";

/** Item data for tooltip display */
export interface TooltipItemData {
  /** Item name */
  name: string;
  /** Keybind (if any) */
  keybind?: string;
  /** Item type (e.g., "Weapon", "Potion") */
  type?: string;
  /** Item rarity */
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  /** Stats (attack, defense, etc.) */
  stats?: Record<string, number>;
  /** Level requirements */
  requirements?: Record<string, number>;
  /** Effects (e.g., "Heals 20 HP") */
  effects?: string[];
  /** Full description */
  description?: string;
  /** Item origin/source */
  origin?: string;
  /** Item value in coins */
  value?: number;
  /** Custom sections */
  customSections?: Array<{
    title: string;
    content: string | string[];
  }>;
}

/** Player stats for requirement checking */
export interface PlayerStatsForTooltip {
  /** Player level */
  level?: number;
  /** Skill levels keyed by skill name (attack, strength, etc.) */
  skills?: Record<string, { level: number }>;
}

/** Props for TieredTooltip */
export interface TieredTooltipProps {
  /** Current tooltip tier */
  tier: TooltipTier;
  /** Item data to display */
  item: TooltipItemData;
  /** Player stats for requirement checking */
  playerStats?: PlayerStatsForTooltip;
  /** Position (optional, for portal positioning) */
  position?: { x: number; y: number };
  /** Maximum width */
  maxWidth?: number;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/** Rarity colors */
const RARITY_COLORS: Record<string, string> = {
  common: "#B0B0B0",
  uncommon: "#4CAF50",
  rare: "#2196F3",
  epic: "#9C27B0",
  legendary: "#FF9800",
};

/** Stat display component */
function StatLine({
  label,
  value,
  isPositive,
}: {
  label: string;
  value: number;
  isPositive?: boolean;
}): React.ReactElement {
  const theme = useTheme();

  const color =
    isPositive === true
      ? theme.colors.state.success
      : isPositive === false
        ? theme.colors.state.danger
        : theme.colors.text.secondary;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: theme.typography.fontSize.xs,
      }}
    >
      <span style={{ color: theme.colors.text.muted }}>{label}:</span>
      <span style={{ color, fontWeight: 500 }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

/** Requirement display component */
function RequirementLine({
  label,
  value,
  met,
}: {
  label: string;
  value: number;
  met: boolean;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: theme.typography.fontSize.xs,
      }}
    >
      <span style={{ color: theme.colors.text.muted }}>Requires {label}:</span>
      <span
        style={{
          color: met ? theme.colors.text.primary : theme.colors.state.danger,
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Tiered Tooltip Component
 *
 * Displays progressively more information based on the tier:
 * - immediate: Just name and keybind
 * - delayed: Stats and requirements added
 * - examine: Full description and origin
 *
 * @example
 * ```tsx
 * const tooltip = useProgressiveTooltip();
 *
 * {tooltip.isVisible && (
 *   <TieredTooltip
 *     tier={tooltip.tier}
 *     item={{
 *       name: "Dragon Longsword",
 *       type: "Weapon",
 *       rarity: "rare",
 *       stats: { attack: 65, strength: 60 },
 *       requirements: { attack: 60 },
 *       description: "A powerful sword forged by dragons.",
 *       value: 100000,
 *     }}
 *   />
 * )}
 * ```
 */
export const TieredTooltip = memo(function TieredTooltip({
  tier,
  item,
  playerStats,
  position,
  maxWidth = 280,
  className,
  style,
}: TieredTooltipProps): React.ReactElement {
  const theme = useTheme();

  const rarityColor = item.rarity
    ? RARITY_COLORS[item.rarity] || theme.colors.text.primary
    : theme.colors.text.primary;

  /**
   * Check if player meets a requirement
   * @param requirementName - Name of the requirement (e.g., "attack", "level")
   * @param requiredValue - Required value
   * @returns true if met, false if not met, true if no player stats available
   */
  const meetsRequirement = (
    requirementName: string,
    requiredValue: number,
  ): boolean => {
    if (!playerStats) return true; // Assume met if no stats provided

    const lowerName = requirementName.toLowerCase();

    // Check for "level" requirement (combat level)
    if (lowerName === "level" || lowerName === "combat") {
      return (playerStats.level ?? 1) >= requiredValue;
    }

    // Check skill requirements
    if (playerStats.skills) {
      const skillData = playerStats.skills[lowerName];
      if (skillData) {
        return skillData.level >= requiredValue;
      }
    }

    // Unknown requirement type - assume met
    return true;
  };

  const positionStyle: React.CSSProperties = position
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
      }
    : {};

  return (
    <div
      className={className}
      style={{
        ...positionStyle,
        maxWidth,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.background.primary,
        border: `1px solid ${theme.colors.border.decorative}`,
        borderRadius: theme.borderRadius.md,
        boxShadow: theme.shadows.lg,
        color: theme.colors.text.primary,
        fontFamily: theme.typography.fontFamily.body,
        zIndex: theme.zIndex.tooltip,
        ...style,
      }}
    >
      {/* TIER: immediate - Name and keybind */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: tier !== "immediate" ? theme.spacing.xs : 0,
        }}
      >
        <span
          style={{
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.semibold,
            color: rarityColor,
          }}
        >
          {item.name}
        </span>
        {item.keybind && (
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
              padding: "1px 4px",
              backgroundColor: theme.colors.background.tertiary,
              borderRadius: 2,
              marginLeft: 8,
            }}
          >
            {item.keybind}
          </span>
        )}
      </div>

      {/* Item type (always visible if present) */}
      {item.type && tier === "immediate" && (
        <div
          style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.muted,
          }}
        >
          {item.type}
        </div>
      )}

      {/* TIER: delayed - Stats and requirements */}
      {(tier === "delayed" || tier === "examine") && (
        <>
          {/* Type and rarity */}
          {(item.type || item.rarity) && (
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                marginBottom: theme.spacing.xs,
              }}
            >
              {item.rarity && (
                <span
                  style={{ color: rarityColor, textTransform: "capitalize" }}
                >
                  {item.rarity}
                </span>
              )}
              {item.rarity && item.type && " "}
              {item.type}
            </div>
          )}

          {/* Stats */}
          {item.stats && Object.keys(item.stats).length > 0 && (
            <div
              style={{
                marginBottom: theme.spacing.xs,
                paddingBottom: theme.spacing.xs,
                borderBottom: `1px solid ${theme.colors.border.default}`,
              }}
            >
              {Object.entries(item.stats).map(([stat, value]) => (
                <StatLine
                  key={stat}
                  label={stat.charAt(0).toUpperCase() + stat.slice(1)}
                  value={value}
                  isPositive={value > 0}
                />
              ))}
            </div>
          )}

          {/* Requirements */}
          {item.requirements && Object.keys(item.requirements).length > 0 && (
            <div
              style={{
                marginBottom: theme.spacing.xs,
                paddingBottom: theme.spacing.xs,
                borderBottom: `1px solid ${theme.colors.border.default}`,
              }}
            >
              {Object.entries(item.requirements).map(([req, value]) => (
                <RequirementLine
                  key={req}
                  label={req.charAt(0).toUpperCase() + req.slice(1)}
                  value={value}
                  met={meetsRequirement(req, value)}
                />
              ))}
            </div>
          )}

          {/* Effects */}
          {item.effects && item.effects.length > 0 && (
            <div style={{ marginBottom: theme.spacing.xs }}>
              {item.effects.map((effect, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.state.success,
                    marginBottom: 2,
                  }}
                >
                  • {effect}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TIER: examine - Full description, origin, value */}
      {tier === "examine" && (
        <>
          {/* Description */}
          {item.description && (
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.secondary,
                fontStyle: "italic",
                marginBottom: theme.spacing.sm,
                lineHeight: theme.typography.lineHeight.relaxed,
              }}
            >
              "{item.description}"
            </div>
          )}

          {/* Custom sections */}
          {item.customSections?.map((section, i) => (
            <div key={i} style={{ marginBottom: theme.spacing.xs }}>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 2,
                }}
              >
                {section.title}
              </div>
              {Array.isArray(section.content) ? (
                section.content.map((line, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.text.secondary,
                    }}
                  >
                    {line}
                  </div>
                ))
              ) : (
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.text.secondary,
                  }}
                >
                  {section.content}
                </div>
              )}
            </div>
          ))}

          {/* Origin and value footer */}
          {(item.origin || item.value !== undefined) && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: theme.spacing.xs,
                paddingTop: theme.spacing.xs,
                borderTop: `1px solid ${theme.colors.border.default}`,
                fontSize: theme.typography.fontSize.xs,
              }}
            >
              {item.origin && (
                <span style={{ color: theme.colors.text.muted }}>
                  {item.origin}
                </span>
              )}
              {item.value !== undefined && (
                <span style={{ color: theme.colors.accent.secondary }}>
                  {item.value.toLocaleString()} 🪙
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
