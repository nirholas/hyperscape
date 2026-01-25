/**
 * Item Comparison Component
 *
 * Side-by-side comparison of equipped vs candidate item.
 * Shows stat differences with color-coded improvements/downgrades.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import type { EquipmentItemData } from "../core/equipment";
import {
  compareItemStats,
  formatStatName,
  formatStatValue,
  calculateItemPower,
  getDurabilityStatus,
  RARITY_COLORS,
  RARITY_NAMES,
} from "../core/equipment";

/** Item comparison props */
export interface ItemComparisonProps {
  /** Currently equipped item (can be null) */
  equippedItem: EquipmentItemData | null;
  /** Item being compared */
  comparisonItem: EquipmentItemData;
  /** Whether to show detailed breakdown */
  detailed?: boolean;
  /** Whether to show item power comparison */
  showPower?: boolean;
  /** Whether to show durability info */
  showDurability?: boolean;
  /** Which item to highlight as "current" */
  highlightSide?: "equipped" | "comparison" | "none";
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Item Comparison Component
 *
 * @example
 * ```tsx
 * <ItemComparison
 *   equippedItem={currentHelmet}
 *   comparisonItem={newHelmet}
 *   showPower
 *   detailed
 * />
 * ```
 */
export const ItemComparison = memo(function ItemComparison({
  equippedItem,
  comparisonItem,
  detailed = false,
  showPower = true,
  showDurability = false,
  highlightSide = "none",
  className,
  style,
}: ItemComparisonProps): React.ReactElement {
  const theme = useTheme();

  // Calculate comparison data
  const statComparison = compareItemStats(equippedItem, comparisonItem);
  const equippedPower = equippedItem ? calculateItemPower(equippedItem) : 0;
  const comparisonPower = calculateItemPower(comparisonItem);
  const powerDiff = comparisonPower - equippedPower;

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    minWidth: 280,
    fontSize: theme.typography.fontSize.sm,
    ...style,
  };

  // Header section styles
  const headerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const itemColumnStyle: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  };

  const itemNameStyle = (
    rarity: string,
    highlighted: boolean,
  ): CSSProperties => ({
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.bold,
    color:
      RARITY_COLORS[rarity as keyof typeof RARITY_COLORS] ||
      theme.colors.text.primary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: highlighted ? "underline" : "none",
    textDecorationColor: theme.colors.accent.primary,
  });

  const itemSubtitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  const vsStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    alignSelf: "center",
    padding: `0 ${theme.spacing.xs}px`,
  };

  // Stats comparison styles
  const statsContainerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  };

  const statRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
  };

  const statLabelStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.text.secondary,
  };

  const statValueContainerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    minWidth: 140,
    justifyContent: "flex-end",
  };

  const oldValueStyle: CSSProperties = {
    color: theme.colors.text.muted,
    textDecoration: "line-through",
    fontSize: theme.typography.fontSize.xs,
  };

  const arrowStyle = (isImprovement: boolean): CSSProperties => ({
    color: isImprovement
      ? theme.colors.state.success
      : theme.colors.state.danger,
    fontWeight: theme.typography.fontWeight.bold,
  });

  const newValueStyle = (isImprovement: boolean): CSSProperties => ({
    fontWeight: theme.typography.fontWeight.medium,
    color: isImprovement
      ? theme.colors.state.success
      : theme.colors.state.danger,
  });

  const diffStyle = (diff: number): CSSProperties => ({
    fontSize: theme.typography.fontSize.xs,
    color:
      diff > 0
        ? theme.colors.state.success
        : diff < 0
          ? theme.colors.state.danger
          : theme.colors.text.muted,
    fontWeight: theme.typography.fontWeight.medium,
  });

  // Power comparison styles
  const powerContainerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.md,
  };

  const powerLabelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    textTransform: "uppercase",
  };

  const powerValueStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
  };

  const powerNumberStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.accent.primary,
  };

  const powerDiffStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color:
      powerDiff > 0
        ? theme.colors.state.success
        : powerDiff < 0
          ? theme.colors.state.danger
          : theme.colors.text.muted,
  };

  // Summary styles
  const summaryStyle: CSSProperties = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor:
      powerDiff > 0
        ? `${theme.colors.state.success}20`
        : powerDiff < 0
          ? `${theme.colors.state.danger}20`
          : theme.colors.background.tertiary,
    color:
      powerDiff > 0
        ? theme.colors.state.success
        : powerDiff < 0
          ? theme.colors.state.danger
          : theme.colors.text.muted,
    fontWeight: theme.typography.fontWeight.medium,
  };

  // Durability info
  const equippedDurability = equippedItem
    ? getDurabilityStatus(equippedItem)
    : null;
  const comparisonDurability = getDurabilityStatus(comparisonItem);

  // Filter stats to show
  const significantStats = statComparison.filter(
    (s) => s.diff !== 0 || (detailed && (s.current !== 0 || s.new !== 0)),
  );

  // Count improvements/downgrades
  const improvements = statComparison.filter((s) => s.diff > 0).length;
  const downgrades = statComparison.filter((s) => s.diff < 0).length;

  return (
    <div className={className} style={containerStyle}>
      {/* Item headers */}
      <div style={headerStyle}>
        <div style={itemColumnStyle}>
          {equippedItem ? (
            <>
              <div
                style={itemNameStyle(
                  equippedItem.rarity,
                  highlightSide === "equipped",
                )}
              >
                {equippedItem.name}
              </div>
              <div style={itemSubtitleStyle}>
                {RARITY_NAMES[equippedItem.rarity]} - iLvl{" "}
                {equippedItem.itemLevel}
              </div>
            </>
          ) : (
            <div style={{ color: theme.colors.text.muted }}>Empty Slot</div>
          )}
        </div>

        <span style={vsStyle}>vs</span>

        <div style={{ ...itemColumnStyle, alignItems: "flex-end" }}>
          <div
            style={itemNameStyle(
              comparisonItem.rarity,
              highlightSide === "comparison",
            )}
          >
            {comparisonItem.name}
          </div>
          <div style={itemSubtitleStyle}>
            {RARITY_NAMES[comparisonItem.rarity]} - iLvl{" "}
            {comparisonItem.itemLevel}
          </div>
        </div>
      </div>

      {/* Power comparison */}
      {showPower && (
        <div style={powerContainerStyle}>
          <span style={powerLabelStyle}>Item Power</span>
          <div style={powerValueStyle}>
            <span style={powerNumberStyle}>{comparisonPower}</span>
            {powerDiff !== 0 && (
              <span style={powerDiffStyle}>
                ({powerDiff > 0 ? "+" : ""}
                {powerDiff})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stat comparison */}
      {significantStats.length > 0 && (
        <div style={statsContainerStyle}>
          {significantStats.map(
            ({ stat, current, new: newVal, diff, isImprovement }) => (
              <div key={stat} style={statRowStyle}>
                <span style={statLabelStyle}>{formatStatName(stat)}</span>
                <div style={statValueContainerStyle}>
                  {detailed && current !== 0 && (
                    <span style={oldValueStyle}>
                      {formatStatValue(stat, current)}
                    </span>
                  )}
                  {diff !== 0 && (
                    <span style={arrowStyle(isImprovement)}>
                      {isImprovement ? "+" : "-"}
                    </span>
                  )}
                  <span style={newValueStyle(isImprovement)}>
                    {formatStatValue(stat, newVal)}
                  </span>
                  <span style={diffStyle(diff)}>
                    ({diff > 0 ? "+" : ""}
                    {formatStatValue(stat, diff)})
                  </span>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* Durability comparison */}
      {showDurability && (
        <div style={statsContainerStyle}>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Durability</span>
            <div style={statValueContainerStyle}>
              {equippedDurability && (
                <span style={{ color: equippedDurability.color }}>
                  {equippedDurability.percent}%
                </span>
              )}
              <span style={vsStyle}>vs</span>
              <span style={{ color: comparisonDurability.color }}>
                {comparisonDurability.percent}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div style={summaryStyle}>
        {powerDiff > 0 ? (
          <>
            Upgrade - {improvements} stat{improvements !== 1 ? "s" : ""}{" "}
            improved
          </>
        ) : powerDiff < 0 ? (
          <>
            Downgrade - {downgrades} stat{downgrades !== 1 ? "s" : ""} reduced
          </>
        ) : improvements > downgrades ? (
          <>Sidegrade - Mixed changes</>
        ) : improvements === 0 && downgrades === 0 ? (
          <>Equivalent - No stat changes</>
        ) : (
          <>
            Sidegrade - {improvements} up, {downgrades} down
          </>
        )}
      </div>
    </div>
  );
});

/**
 * Compact stat diff indicator for inline display
 */
export interface StatDiffIndicatorProps {
  /** Stat difference value */
  diff: number;
  /** Stat name for formatting */
  stat?: string;
  /** Show plus/minus sign */
  showSign?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

export const StatDiffIndicator = memo(function StatDiffIndicator({
  diff,
  stat,
  showSign = true,
  className,
  style,
}: StatDiffIndicatorProps): React.ReactElement {
  const theme = useTheme();

  const indicatorStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color:
      diff > 0
        ? theme.colors.state.success
        : diff < 0
          ? theme.colors.state.danger
          : theme.colors.text.muted,
    ...style,
  };

  const formattedValue = stat
    ? formatStatValue(stat, Math.abs(diff))
    : Math.abs(diff).toString();
  const sign = showSign && diff !== 0 ? (diff > 0 ? "+" : "-") : "";

  return (
    <span className={className} style={indicatorStyle}>
      {sign}
      {formattedValue}
    </span>
  );
});

export default ItemComparison;
