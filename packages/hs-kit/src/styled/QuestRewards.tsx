/**
 * Quest Rewards Component
 *
 * Displays quest rewards including XP, gold, items, and other rewards
 * with icons and formatted values.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "../stores/themeStore";
import { type QuestReward } from "../core/quest";

/** Props for QuestRewards component */
export interface QuestRewardsProps {
  /** Array of rewards */
  rewards: QuestReward[];
  /** Display orientation */
  orientation?: "horizontal" | "vertical";
  /** Compact mode (icons only) */
  compact?: boolean;
  /** Show title "Rewards:" */
  showTitle?: boolean;
  /** Icon size */
  iconSize?: number;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/** Single reward item display */
interface RewardItemProps {
  reward: QuestReward;
  compact: boolean;
  iconSize: number;
}

const RewardItem = memo(function RewardItem({
  reward,
  compact,
  iconSize,
}: RewardItemProps): React.ReactElement {
  const theme = useTheme();

  // Get reward icon
  const getRewardIcon = (): ReactNode => {
    if (reward.icon) {
      if (reward.icon.startsWith("http") || reward.icon.startsWith("/")) {
        return (
          <img
            src={reward.icon}
            alt={reward.name}
            style={{
              width: iconSize,
              height: iconSize,
              objectFit: "contain",
            }}
          />
        );
      }
      return <span style={{ fontSize: iconSize * 0.8 }}>{reward.icon}</span>;
    }

    // Default icons by type
    const icons: Record<string, string> = {
      xp: "⭐",
      gold: "💰",
      item: "📦",
      reputation: "🏆",
      unlock: "🔓",
      xp_lamp: "🪔",
      quest_points: "🏆",
    };
    return (
      <span style={{ fontSize: iconSize * 0.8 }}>
        {icons[reward.type] || "📋"}
      </span>
    );
  };

  // Format amount
  const formatAmount = (amount: number): string => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  };

  // Get reward color
  const getRewardColor = (): string => {
    switch (reward.type) {
      case "xp":
        return theme.colors.state.info;
      case "gold":
        return theme.colors.accent.primary;
      case "item":
        return theme.colors.text.primary;
      case "reputation":
        return theme.colors.state.success;
      case "unlock":
        return theme.colors.state.warning;
      case "xp_lamp":
        return "#ffcc00"; // Golden glow for XP lamps
      case "quest_points":
        return "#4ade80"; // Green for quest points
      default:
        return theme.colors.text.secondary;
    }
  };

  // Item container style
  const itemStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: compact ? 2 : theme.spacing.xs,
    padding: compact ? 2 : theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: compact ? "transparent" : theme.colors.background.tertiary,
  };

  // Icon container
  const iconContainerStyle: CSSProperties = {
    width: iconSize,
    height: iconSize,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: compact
      ? "transparent"
      : theme.colors.background.secondary,
  };

  // Text container
  const textContainerStyle: CSSProperties = {
    display: "flex",
    flexDirection: compact ? "row" : "column",
    gap: compact ? theme.spacing.xs : 0,
  };

  // Amount style
  const amountStyle: CSSProperties = {
    color: getRewardColor(),
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    lineHeight: 1.2,
  };

  // Name style
  const nameStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    lineHeight: 1.2,
  };

  // Skill label for XP
  const skillStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
  };

  return (
    <div
      style={itemStyle}
      title={`${reward.name}${reward.amount ? `: ${reward.amount}` : ""}`}
    >
      <div style={iconContainerStyle}>{getRewardIcon()}</div>
      {!compact && (
        <div style={textContainerStyle}>
          <span style={amountStyle}>
            {reward.amount ? formatAmount(reward.amount) : ""}
            {reward.type === "xp" && " XP"}
          </span>
          <span style={reward.skill ? skillStyle : nameStyle}>
            {reward.skill ? `${reward.skill}` : reward.name}
          </span>
        </div>
      )}
      {compact && reward.amount && (
        <span style={amountStyle}>{formatAmount(reward.amount)}</span>
      )}
    </div>
  );
});

/**
 * Quest Rewards Component
 *
 * Displays all rewards for a quest in a formatted layout.
 *
 * @example
 * ```tsx
 * <QuestRewards
 *   rewards={[
 *     { type: "xp", name: "Combat XP", amount: 1000, skill: "Attack" },
 *     { type: "gold", name: "Gold", amount: 500 },
 *     { type: "item", name: "Iron Sword", icon: "🗡️" },
 *   ]}
 *   showTitle
 * />
 * ```
 */
export const QuestRewards = memo(function QuestRewards({
  rewards,
  orientation = "horizontal",
  compact = false,
  showTitle = false,
  iconSize = 20,
  className,
  style,
}: QuestRewardsProps): React.ReactElement | null {
  const theme = useTheme();

  if (rewards.length === 0) {
    return null;
  }

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    ...style,
  };

  // Title styles
  const titleStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  // Rewards list styles
  const listStyle: CSSProperties = {
    display: "flex",
    flexDirection: orientation === "horizontal" ? "row" : "column",
    flexWrap: "wrap",
    gap: compact ? theme.spacing.xs : theme.spacing.sm,
  };

  // Group rewards by type for better display
  const questPointsReward = rewards.find((r) => r.type === "quest_points");
  const xpRewards = rewards.filter((r) => r.type === "xp");
  const xpLampRewards = rewards.filter((r) => r.type === "xp_lamp");
  const goldReward = rewards.find((r) => r.type === "gold");
  const itemRewards = rewards.filter((r) => r.type === "item");
  const otherRewards = rewards.filter(
    (r) =>
      r.type !== "xp" &&
      r.type !== "gold" &&
      r.type !== "item" &&
      r.type !== "xp_lamp" &&
      r.type !== "quest_points",
  );

  // Ordered rewards: Quest points, XP, XP lamps, gold, items, others
  const orderedRewards = [
    ...(questPointsReward ? [questPointsReward] : []),
    ...xpRewards,
    ...xpLampRewards,
    ...(goldReward ? [goldReward] : []),
    ...itemRewards,
    ...otherRewards,
  ];

  return (
    <div className={className} style={containerStyle}>
      {showTitle && <span style={titleStyle}>Rewards</span>}
      <div style={listStyle}>
        {orderedRewards.map((reward, index) => (
          <RewardItem
            key={`${reward.type}-${reward.name}-${index}`}
            reward={reward}
            compact={compact}
            iconSize={iconSize}
          />
        ))}
      </div>
    </div>
  );
});

/** Summary component for compact reward display */
export interface QuestRewardsSummaryProps {
  /** Array of rewards */
  rewards: QuestReward[];
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Compact summary of quest rewards
 *
 * @example
 * ```tsx
 * <QuestRewardsSummary rewards={quest.rewards} />
 * // Outputs: "1,000 XP, 500 Gold, 2 Items"
 * ```
 */
export const QuestRewardsSummary = memo(function QuestRewardsSummary({
  rewards,
  className,
  style,
}: QuestRewardsSummaryProps): React.ReactElement {
  const theme = useTheme();

  // Calculate totals
  const xpRewards = rewards.filter((r) => r.type === "xp");
  const totalXp = xpRewards.reduce((sum, r) => sum + (r.amount || 0), 0);
  const goldReward = rewards.find((r) => r.type === "gold");
  const itemCount = rewards.filter((r) => r.type === "item").length;
  const otherCount = rewards.filter(
    (r) => r.type !== "xp" && r.type !== "gold" && r.type !== "item",
  ).length;

  // Build summary parts
  const parts: Array<{ text: string; color: string }> = [];

  if (totalXp > 0) {
    parts.push({
      text: `${totalXp.toLocaleString()} XP`,
      color: theme.colors.state.info,
    });
  }

  if (goldReward?.amount) {
    parts.push({
      text: `${goldReward.amount.toLocaleString()} Gold`,
      color: theme.colors.accent.primary,
    });
  }

  if (itemCount > 0) {
    parts.push({
      text: `${itemCount} Item${itemCount > 1 ? "s" : ""}`,
      color: theme.colors.text.primary,
    });
  }

  if (otherCount > 0) {
    parts.push({
      text: `+${otherCount} more`,
      color: theme.colors.text.muted,
    });
  }

  // Container style
  const containerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    ...style,
  };

  return (
    <div className={className} style={containerStyle}>
      {parts.length > 0 ? (
        parts.map((part, index) => (
          <React.Fragment key={index}>
            <span style={{ color: part.color }}>{part.text}</span>
            {index < parts.length - 1 && (
              <span style={{ color: theme.colors.text.muted }}>·</span>
            )}
          </React.Fragment>
        ))
      ) : (
        <span style={{ color: theme.colors.text.muted }}>No rewards</span>
      )}
    </div>
  );
});

export default QuestRewards;
