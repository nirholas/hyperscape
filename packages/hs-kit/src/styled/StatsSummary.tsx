/**
 * Stats Summary Component
 *
 * Displays total equipment stats, set bonuses, and gear score.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import type { ItemStats, EquipmentSet } from "../core/equipment";
import { formatStatName, formatStatValue } from "../core/equipment";

/** Stats summary props */
export interface StatsSummaryProps {
  /** Total stats from all equipment */
  stats: ItemStats;
  /** Average item level */
  averageItemLevel?: number;
  /** Total gear score */
  gearScore?: number;
  /** Active set bonuses */
  setBonuses?: Array<{
    set: EquipmentSet;
    equippedCount: number;
    activeBonus: EquipmentSet["bonuses"][number] | null;
    nextBonus: EquipmentSet["bonuses"][number] | null;
  }>;
  /** Stats to highlight */
  highlightedStats?: string[];
  /** Whether to show set bonuses section */
  showSetBonuses?: boolean;
  /** Stat categories for grouping */
  statCategories?: Record<string, string[]>;
  /** Compact display mode */
  compact?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/** Default stat categories */
const DEFAULT_STAT_CATEGORIES: Record<string, string[]> = {
  Primary: ["strength", "agility", "intelligence", "stamina"],
  Offense: ["attackPower", "spellPower", "critChance", "critDamage", "haste"],
  Defense: ["armor", "accuracy", "evasion"],
  Utility: ["healthRegen", "manaRegen", "movementSpeed"],
};

/**
 * Stats Summary Component
 *
 * @example
 * ```tsx
 * <StatsSummary
 *   stats={totalStats}
 *   averageItemLevel={350}
 *   gearScore={4500}
 *   setBonuses={activeBonuses}
 *   showSetBonuses
 * />
 * ```
 */
export const StatsSummary = memo(function StatsSummary({
  stats,
  averageItemLevel,
  gearScore,
  setBonuses = [],
  highlightedStats = [],
  showSetBonuses = true,
  statCategories = DEFAULT_STAT_CATEGORIES,
  compact = false,
  className,
  style,
}: StatsSummaryProps): React.ReactElement {
  const theme = useTheme();

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    padding: compact ? theme.spacing.sm : theme.spacing.md,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    fontSize: compact
      ? theme.typography.fontSize.xs
      : theme.typography.fontSize.sm,
    ...style,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const headerTitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
  };

  const headerValueStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  };

  const gearScoreStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.accent.primary,
  };

  const itemLevelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  };

  // Category section styles
  const categoryStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  };

  const categoryTitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };

  const statRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: `${theme.spacing.xs}px 0`,
  };

  const statNameStyle: CSSProperties = {
    color: theme.colors.text.secondary,
  };

  const statValueStyle: CSSProperties = {
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.primary,
  };

  const highlightedValueStyle: CSSProperties = {
    ...statValueStyle,
    color: theme.colors.accent.primary,
  };

  // Set bonus styles
  const setBonusSectionStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  const setBonusHeaderStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
  };

  const setBonusItemStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.md,
  };

  const setBonusNameStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.accent.secondary,
  };

  const setBonusCountStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  const activeBonusStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.state.success,
    padding: `2px ${theme.spacing.xs}px`,
    backgroundColor: `${theme.colors.state.success}20`,
    borderRadius: theme.borderRadius.sm,
    display: "inline-block",
  };

  const nextBonusStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    fontStyle: "italic",
  };

  // Group stats by category
  const statsByCategory = Object.entries(statCategories).map(
    ([categoryName, categoryStats]) => {
      const filteredStats = categoryStats
        .filter((stat) => stats[stat] !== undefined && stats[stat] !== 0)
        .map((stat) => ({
          name: stat,
          value: stats[stat],
          isHighlighted: highlightedStats.includes(stat),
        }));

      return { categoryName, stats: filteredStats };
    },
  );

  // Get uncategorized stats
  const categorizedStats = new Set(Object.values(statCategories).flat());
  const uncategorizedStats = Object.entries(stats)
    .filter(([stat, value]) => !categorizedStats.has(stat) && value !== 0)
    .map(([stat, value]) => ({
      name: stat,
      value,
      isHighlighted: highlightedStats.includes(stat),
    }));

  return (
    <div className={className} style={containerStyle}>
      {/* Header with gear score */}
      {(gearScore !== undefined || averageItemLevel !== undefined) && (
        <div style={headerStyle}>
          <span style={headerTitleStyle}>Stats</span>
          <div style={headerValueStyle}>
            {gearScore !== undefined && (
              <span style={gearScoreStyle}>{gearScore.toLocaleString()}</span>
            )}
            {averageItemLevel !== undefined && (
              <span style={itemLevelStyle}>iLvl {averageItemLevel}</span>
            )}
          </div>
        </div>
      )}

      {/* Stat categories */}
      {statsByCategory.map(
        ({ categoryName, stats: categoryStats }) =>
          categoryStats.length > 0 && (
            <div key={categoryName} style={categoryStyle}>
              <div style={categoryTitleStyle}>{categoryName}</div>
              {categoryStats.map(({ name, value, isHighlighted }) => (
                <div key={name} style={statRowStyle}>
                  <span style={statNameStyle}>{formatStatName(name)}</span>
                  <span
                    style={
                      isHighlighted ? highlightedValueStyle : statValueStyle
                    }
                  >
                    {formatStatValue(name, value)}
                  </span>
                </div>
              ))}
            </div>
          ),
      )}

      {/* Uncategorized stats */}
      {uncategorizedStats.length > 0 && (
        <div style={categoryStyle}>
          <div style={categoryTitleStyle}>Other</div>
          {uncategorizedStats.map(({ name, value, isHighlighted }) => (
            <div key={name} style={statRowStyle}>
              <span style={statNameStyle}>{formatStatName(name)}</span>
              <span
                style={isHighlighted ? highlightedValueStyle : statValueStyle}
              >
                {formatStatValue(name, value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Set bonuses */}
      {showSetBonuses && setBonuses.length > 0 && (
        <div style={setBonusSectionStyle}>
          <div style={setBonusHeaderStyle}>Set Bonuses</div>
          {setBonuses
            .filter((b) => b.equippedCount > 0)
            .map(({ set, equippedCount, activeBonus, nextBonus }) => (
              <div key={set.id} style={setBonusItemStyle}>
                <div style={setBonusNameStyle}>
                  {set.name}
                  <span style={setBonusCountStyle}>
                    {" "}
                    ({equippedCount}/{set.itemIds.length})
                  </span>
                </div>

                {activeBonus && (
                  <div style={activeBonusStyle}>
                    ({activeBonus.pieces}){" "}
                    {activeBonus.effect ||
                      formatSetBonusStats(activeBonus.stats)}
                  </div>
                )}

                {nextBonus && (
                  <div style={nextBonusStyle}>
                    Next: ({nextBonus.pieces}){" "}
                    {nextBonus.effect || formatSetBonusStats(nextBonus.stats)}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Empty state */}
      {Object.keys(stats).length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: theme.colors.text.muted,
            padding: theme.spacing.lg,
          }}
        >
          No equipment stats
        </div>
      )}
    </div>
  );
});

/** Format set bonus stats for display */
function formatSetBonusStats(stats: ItemStats): string {
  return Object.entries(stats)
    .map(
      ([stat, value]) =>
        `+${formatStatValue(stat, value)} ${formatStatName(stat)}`,
    )
    .join(", ");
}

export default StatsSummary;
