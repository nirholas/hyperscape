/**
 * Quest Entry Component
 *
 * Individual quest entry with expandable details, objectives,
 * and reward preview. Used in the quest log panel.
 *
 * @packageDocumentation
 */

import React, { memo, useState, useCallback, type CSSProperties } from "react";
import { useTheme, useAccessibilityStore } from "@/ui";
import {
  type Quest,
  calculateQuestProgress,
  CATEGORY_CONFIG,
  STATE_CONFIG,
  formatTimeRemaining,
} from "@/game/systems";
import { QuestObjective } from "./QuestObjective";
import { QuestRewards, QuestRewardsSummary } from "./QuestRewards";

/** Props for QuestEntry component */
export interface QuestEntryProps {
  /** Quest data */
  quest: Quest;
  /** Whether entry is expanded */
  expanded?: boolean;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Controlled expand handler */
  onExpandChange?: (expanded: boolean) => void;
  /** Whether quest is selected */
  selected?: boolean;
  /** Click handler (selects quest) */
  onClick?: (quest: Quest) => void;
  /** Pin toggle handler */
  onTogglePin?: (quest: Quest) => void;
  /** Accept quest handler */
  onAccept?: (quest: Quest) => void;
  /** Complete quest handler */
  onComplete?: (quest: Quest) => void;
  /** Track quest handler */
  onTrack?: (quest: Quest) => void;
  /** Show category badge */
  showCategory?: boolean;
  /** Show level requirement */
  showLevel?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Quest Entry Component
 *
 * Expandable quest entry showing title, progress, and details.
 *
 * @example
 * ```tsx
 * <QuestEntry
 *   quest={myQuest}
 *   onTogglePin={(q) => togglePin(q.id)}
 *   onAccept={(q) => acceptQuest(q.id)}
 *   showCategory
 *   showLevel
 * />
 * ```
 */
export const QuestEntry = memo(function QuestEntry({
  quest,
  expanded: controlledExpanded,
  defaultExpanded = false,
  onExpandChange,
  selected = false,
  onClick,
  onTogglePin,
  onAccept,
  onComplete,
  onTrack,
  showCategory = true,
  showLevel = true,
  compact = false,
  className,
  style,
}: QuestEntryProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  // Internal expanded state (if uncontrolled)
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = controlledExpanded ?? internalExpanded;

  const toggleExpanded = useCallback(() => {
    const newExpanded = !isExpanded;
    setInternalExpanded(newExpanded);
    onExpandChange?.(newExpanded);
  }, [isExpanded, onExpandChange]);

  // Calculate progress
  const progress = calculateQuestProgress(quest);
  const categoryConfig = CATEGORY_CONFIG[quest.category];
  const stateConfig = STATE_CONFIG[quest.state];

  // Is quest actionable
  const canAccept = quest.state === "available";
  const canComplete = quest.state === "active" && progress === 100;

  // Handle click on header
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onClick) {
        onClick(quest);
      }
      if (!compact) {
        toggleExpanded();
      }
    },
    [onClick, quest, compact, toggleExpanded],
  );

  // Handle keyboard on header
  const handleHeaderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (onClick) {
          onClick(quest);
        }
        if (!compact) {
          toggleExpanded();
        }
      }
    },
    [onClick, quest, compact, toggleExpanded],
  );

  // Handle pin button click
  const handlePinClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePin?.(quest);
    },
    [onTogglePin, quest],
  );

  // Container styles
  const containerStyle: CSSProperties = {
    backgroundColor: selected
      ? theme.colors.background.tertiary
      : theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${selected ? theme.colors.border.active : theme.colors.border.default}`,
    overflow: "hidden",
    transition: reducedMotion ? "none" : theme.transitions.fast,
    ...style,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: compact
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : theme.spacing.sm,
    cursor: "pointer",
    userSelect: "none",
  };

  // Expand indicator
  const expandIndicatorStyle: CSSProperties = {
    width: 16,
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.muted,
    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
    transition: reducedMotion ? "none" : "transform 0.2s ease",
    flexShrink: 0,
  };

  // State indicator dot
  const stateIndicatorStyle: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: stateConfig.color,
    flexShrink: 0,
  };

  // Title container
  const titleContainerStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };

  // Title style
  const titleStyle: CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    lineHeight: theme.typography.lineHeight.tight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  // Subtitle row (category, level)
  const subtitleRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  // Category badge
  const categoryBadgeStyle: CSSProperties = {
    color: categoryConfig.color,
    fontWeight: theme.typography.fontWeight.medium,
  };

  // Level display
  const levelStyle: CSSProperties = {
    color: theme.colors.text.muted,
  };

  // Progress section
  const progressSectionStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    flexShrink: 0,
  };

  // Progress bar
  const progressBarContainerStyle: CSSProperties = {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    overflow: "hidden",
  };

  const progressBarFillStyle: CSSProperties = {
    height: "100%",
    width: `${progress}%`,
    backgroundColor:
      progress === 100
        ? theme.colors.state.success
        : theme.colors.accent.primary,
    transition: reducedMotion ? "none" : "width 0.3s ease",
  };

  // Progress text
  const progressTextStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color:
      progress === 100
        ? theme.colors.state.success
        : theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeight.medium,
    minWidth: 32,
    textAlign: "right",
  };

  // Pin button
  const pinButtonStyle: CSSProperties = {
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    color: quest.pinned ? theme.colors.accent.primary : theme.colors.text.muted,
    transition: reducedMotion ? "none" : theme.transitions.fast,
    padding: 0,
    flexShrink: 0,
  };

  // Content section (expanded)
  const contentStyle: CSSProperties = {
    padding: `0 ${theme.spacing.sm}px ${theme.spacing.sm}px`,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  // Description
  const descriptionStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: theme.typography.lineHeight.normal,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  };

  // Quest giver info
  const questGiverStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginBottom: theme.spacing.sm,
  };

  // Objectives section
  const objectivesSectionStyle: CSSProperties = {
    marginTop: theme.spacing.sm,
  };

  const sectionTitleStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: theme.spacing.xs,
  };

  // Rewards section
  const rewardsSectionStyle: CSSProperties = {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  // Actions section
  const actionsSectionStyle: CSSProperties = {
    display: "flex",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  // Action button base
  const actionButtonStyle: CSSProperties = {
    flex: 1,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    borderRadius: theme.borderRadius.sm,
    border: "none",
    cursor: "pointer",
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    transition: reducedMotion ? "none" : theme.transitions.fast,
  };

  // Primary action button
  const primaryButtonStyle: CSSProperties = {
    ...actionButtonStyle,
    backgroundColor: theme.colors.accent.primary,
    color: theme.colors.background.primary,
  };

  // Secondary action button
  const secondaryButtonStyle: CSSProperties = {
    ...actionButtonStyle,
    backgroundColor: theme.colors.background.tertiary,
    color: theme.colors.text.primary,
  };

  // Time remaining badge
  const timerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: theme.typography.fontSize.xs,
    color:
      quest.timeRemaining && quest.timeRemaining <= 60
        ? theme.colors.state.danger
        : theme.colors.state.warning,
    fontWeight: theme.typography.fontWeight.medium,
  };

  // Chain indicator
  const chainStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!compact ? isExpanded : undefined}
        aria-controls={!compact ? `quest-content-${quest.id}` : undefined}
        aria-label={`Quest: ${quest.title}${!compact ? (isExpanded ? ", expanded" : ", collapsed") : ""}`}
        style={headerStyle}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
      >
        {/* Expand indicator (non-compact) */}
        {!compact && (
          <div style={expandIndicatorStyle}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2l4 4-4 4V2z" />
            </svg>
          </div>
        )}

        {/* State indicator */}
        <div style={stateIndicatorStyle} title={stateConfig.label} />

        {/* Title and info */}
        <div style={titleContainerStyle}>
          <span style={titleStyle}>{quest.title}</span>
          <div style={subtitleRowStyle}>
            {showCategory && (
              <span style={categoryBadgeStyle}>{categoryConfig.label}</span>
            )}
            {showCategory && showLevel && <span>·</span>}
            {showLevel && <span style={levelStyle}>Lv. {quest.level}</span>}
            {quest.chainId && (
              <>
                <span>·</span>
                <span style={chainStyle}>
                  Part {quest.chainPosition}/{quest.chainTotal}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Timer (if timed quest) */}
        {quest.timeRemaining !== undefined && quest.state === "active" && (
          <div style={timerStyle}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12A5 5 0 118 3a5 5 0 010 10zm.5-8H7v4.5l3.5 2 .75-1.25-2.75-1.5V5z" />
            </svg>
            {formatTimeRemaining(quest.timeRemaining)}
          </div>
        )}

        {/* Progress (active quests) */}
        {quest.state === "active" && (
          <div style={progressSectionStyle}>
            <div style={progressBarContainerStyle}>
              <div style={progressBarFillStyle} />
            </div>
            <span style={progressTextStyle}>{progress}%</span>
          </div>
        )}

        {/* Pin button */}
        {quest.state === "active" && onTogglePin && (
          <button
            style={pinButtonStyle}
            onClick={handlePinClick}
            title={quest.pinned ? "Unpin quest" : "Pin to tracker"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              {quest.pinned ? (
                <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182a.5.5 0 0 1-.707 0 .5.5 0 0 1 0-.707l3.182-3.182L2.404 7.222a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z" />
              ) : (
                <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182a.5.5 0 0 1-.707-.707l3.182-3.182L2.404 7.222a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146zm.122 1.474c-.082.141-.136.333-.136.527 0 .156.026.343.078.513l.063.192-.167.167-3.525 3.525-.167.167-.192-.063a4.938 4.938 0 0 0-.513-.078.827.827 0 0 0-.529.137l5.656 5.656a.827.827 0 0 0 .137-.528 4.938 4.938 0 0 0-.078-.513l-.063-.192.167-.167 3.525-3.525.167-.167.192.063c.17.052.357.078.513.078.194 0 .386-.054.528-.137L9.95 2.196z" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && !compact && (
        <div id={`quest-content-${quest.id}`} style={contentStyle}>
          {/* Description */}
          <p style={descriptionStyle}>{quest.description}</p>

          {/* Quest giver */}
          {quest.questGiver && (
            <div style={questGiverStyle}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm2-3a2 2 0 11-4 0 2 2 0 014 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z" />
              </svg>
              <span>{quest.questGiver}</span>
              {quest.questGiverLocation && (
                <>
                  <span>·</span>
                  <span>{quest.questGiverLocation}</span>
                </>
              )}
            </div>
          )}

          {/* Objectives */}
          {quest.objectives.length > 0 && (
            <div style={objectivesSectionStyle}>
              <div style={sectionTitleStyle}>Objectives</div>
              {quest.objectives.map((objective) => (
                <QuestObjective
                  key={objective.id}
                  objective={objective}
                  showProgress
                />
              ))}
            </div>
          )}

          {/* Rewards */}
          {quest.rewards.length > 0 && (
            <div style={rewardsSectionStyle}>
              <QuestRewards rewards={quest.rewards} showTitle />
            </div>
          )}

          {/* Actions */}
          <div style={actionsSectionStyle}>
            {canAccept && onAccept && (
              <button
                style={primaryButtonStyle}
                onClick={() => onAccept(quest)}
              >
                Accept Quest
              </button>
            )}
            {canComplete && onComplete && (
              <button
                style={primaryButtonStyle}
                onClick={() => onComplete(quest)}
              >
                Complete Quest
              </button>
            )}
            {quest.state === "active" && onTrack && (
              <button
                style={secondaryButtonStyle}
                onClick={() => onTrack(quest)}
              >
                {quest.pinned ? "Untrack" : "Track"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Compact mode: show rewards summary */}
      {compact && quest.rewards.length > 0 && (
        <div
          style={{ padding: `0 ${theme.spacing.sm}px ${theme.spacing.xs}px` }}
        >
          <QuestRewardsSummary rewards={quest.rewards} />
        </div>
      )}
    </div>
  );
});

export default QuestEntry;
