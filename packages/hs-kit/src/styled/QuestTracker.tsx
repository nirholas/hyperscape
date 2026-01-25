/**
 * Quest Tracker Component
 *
 * Floating widget for tracking pinned/active quests with
 * real-time progress updates and compact objective display.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";
import { type TrackedQuest, CATEGORY_CONFIG } from "../core/quest";
import { QuestObjective } from "./QuestObjective";

/** Props for QuestTracker component */
export interface QuestTrackerProps {
  /** Tracked quests to display */
  trackedQuests: TrackedQuest[];
  /** Title text */
  title?: string;
  /** Maximum visible quests (scroll for more) */
  maxVisible?: number;
  /** Currently expanded quest ID */
  expandedQuestId?: string | null;
  /** Expand change handler */
  onExpandChange?: (questId: string | null) => void;
  /** Quest click handler */
  onQuestClick?: (questId: string) => void;
  /** Untrack quest handler */
  onUntrack?: (questId: string) => void;
  /** Quest IDs being removed (for animation) */
  beingRemoved?: Set<string>;
  /** Show minimize button */
  showMinimize?: boolean;
  /** Minimized state */
  minimized?: boolean;
  /** Minimize toggle handler */
  onMinimizeToggle?: () => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/** Single tracked quest item */
interface TrackedQuestItemProps {
  trackedQuest: TrackedQuest;
  isExpanded: boolean;
  isRemoving: boolean;
  onToggleExpand: () => void;
  onUntrack?: () => void;
  onClick?: () => void;
}

const TrackedQuestItem = memo(function TrackedQuestItem({
  trackedQuest,
  isExpanded,
  isRemoving,
  onToggleExpand,
  onUntrack,
  onClick,
}: TrackedQuestItemProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  const { quest, progress, currentObjective, timeRemainingText, expiringSoon } =
    trackedQuest;

  const categoryConfig = CATEGORY_CONFIG[quest.category];

  // Container styles
  const containerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    opacity: isRemoving ? 0 : 1,
    transform: isRemoving ? "translateX(20px)" : "translateX(0)",
    transition: reducedMotion
      ? "none"
      : "opacity 0.3s ease, transform 0.3s ease",
    cursor: onClick ? "pointer" : "default",
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: theme.spacing.xs,
  };

  // Category indicator
  const categoryIndicatorStyle: CSSProperties = {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: categoryConfig.color,
    flexShrink: 0,
    marginTop: 2,
  };

  // Title container
  const titleContainerStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  // Title row
  const titleRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
  };

  // Title
  const titleStyle: CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    lineHeight: theme.typography.lineHeight.tight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  };

  // Progress text
  const progressTextStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color:
      progress === 100
        ? theme.colors.state.success
        : theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeight.medium,
    flexShrink: 0,
  };

  // Progress bar
  const progressBarStyle: CSSProperties = {
    height: 3,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: 2,
    marginTop: theme.spacing.xs,
    overflow: "hidden",
  };

  const progressFillStyle: CSSProperties = {
    height: "100%",
    width: `${progress}%`,
    backgroundColor:
      progress === 100
        ? theme.colors.state.success
        : theme.colors.accent.primary,
    borderRadius: 2,
    transition: reducedMotion ? "none" : "width 0.3s ease",
  };

  // Timer styles
  const timerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: theme.typography.fontSize.xs,
    color: expiringSoon
      ? theme.colors.state.danger
      : theme.colors.state.warning,
    fontWeight: theme.typography.fontWeight.medium,
    marginTop: theme.spacing.xs,
  };

  // Objective preview
  const objectivePreviewStyle: CSSProperties = {
    marginTop: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  // Expand indicator
  const expandIndicatorStyle: CSSProperties = {
    width: 16,
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.muted,
    cursor: "pointer",
    flexShrink: 0,
    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
    transition: reducedMotion ? "none" : "transform 0.2s ease",
  };

  // Untrack button
  const untrackButtonStyle: CSSProperties = {
    width: 16,
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.muted,
    cursor: "pointer",
    opacity: 0.6,
    transition: reducedMotion ? "none" : theme.transitions.fast,
    flexShrink: 0,
  };

  // Expanded objectives section
  const expandedStyle: CSSProperties = {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  return (
    <div style={containerStyle} onClick={onClick}>
      {/* Header */}
      <div style={headerStyle}>
        {/* Category indicator */}
        <div style={categoryIndicatorStyle} title={categoryConfig.label} />

        {/* Title and progress */}
        <div style={titleContainerStyle}>
          <div style={titleRowStyle}>
            <span style={titleStyle}>{quest.title}</span>
            <span style={progressTextStyle}>{progress}%</span>
          </div>

          {/* Progress bar */}
          <div style={progressBarStyle}>
            <div style={progressFillStyle} />
          </div>

          {/* Timer (if timed) */}
          {timeRemainingText && (
            <div style={timerStyle}>
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12A5 5 0 118 3a5 5 0 010 10zm.5-8H7v4.5l3.5 2 .75-1.25-2.75-1.5V5z" />
              </svg>
              {timeRemainingText}
            </div>
          )}
        </div>

        {/* Expand button */}
        <div
          style={expandIndicatorStyle}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2 4l4 4 4-4H2z" />
          </svg>
        </div>

        {/* Untrack button */}
        {onUntrack && (
          <div
            style={untrackButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              onUntrack();
            }}
            title="Untrack quest"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
            </svg>
          </div>
        )}
      </div>

      {/* Current objective (non-expanded) */}
      {!isExpanded && currentObjective && (
        <div style={objectivePreviewStyle}>
          <QuestObjective
            objective={currentObjective}
            compact
            showIcon={false}
          />
        </div>
      )}

      {/* Expanded: all objectives */}
      {isExpanded && (
        <div style={expandedStyle}>
          {quest.objectives.map((obj) => (
            <QuestObjective
              key={obj.id}
              objective={obj}
              showProgress
              showIcon
            />
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Quest Tracker Component
 *
 * Floating widget showing tracked quests with real-time progress.
 *
 * @example
 * ```tsx
 * const { trackedQuests, expandedQuestId, toggleExpanded, untrackQuest } = useQuestTracker();
 *
 * <QuestTracker
 *   trackedQuests={trackedQuests}
 *   expandedQuestId={expandedQuestId}
 *   onExpandChange={(id) => toggleExpanded(id)}
 *   onUntrack={(id) => untrackQuest(id)}
 * />
 * ```
 */
export const QuestTracker = memo(function QuestTracker({
  trackedQuests,
  title = "Quest Tracker",
  maxVisible = 5,
  expandedQuestId,
  onExpandChange,
  onQuestClick,
  onUntrack,
  beingRemoved = new Set(),
  showMinimize = true,
  minimized = false,
  onMinimizeToggle,
  className,
  style,
}: QuestTrackerProps): React.ReactElement | null {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  // Toggle expanded quest
  const handleToggleExpand = useCallback(
    (questId: string) => {
      onExpandChange?.(expandedQuestId === questId ? null : questId);
    },
    [expandedQuestId, onExpandChange],
  );

  // Don't render if no tracked quests
  if (trackedQuests.length === 0) {
    return null;
  }

  // Container styles
  const containerStyle: CSSProperties = {
    width: 260,
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    boxShadow: theme.shadows.lg,
    overflow: "hidden",
    ...style,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.tertiary,
    borderBottom: minimized
      ? "none"
      : `1px solid ${theme.colors.border.default}`,
    cursor: showMinimize ? "pointer" : "default",
  };

  // Title
  const titleStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  };

  // Count badge
  const countBadgeStyle: CSSProperties = {
    backgroundColor: theme.colors.accent.primary,
    color: theme.colors.background.primary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.bold,
    padding: `0 ${theme.spacing.xs}px`,
    borderRadius: theme.borderRadius.full,
    minWidth: 18,
    height: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Minimize icon
  const minimizeStyle: CSSProperties = {
    width: 16,
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.muted,
    transform: minimized ? "rotate(180deg)" : "rotate(0deg)",
    transition: reducedMotion ? "none" : "transform 0.2s ease",
  };

  // Content styles
  const contentStyle: CSSProperties = {
    maxHeight: minimized ? 0 : maxVisible * 100,
    overflow: "auto",
    padding: minimized ? 0 : theme.spacing.sm,
    transition: reducedMotion
      ? "none"
      : "max-height 0.3s ease, padding 0.3s ease",
  };

  // Quest list
  const listStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
  };

  // Empty state
  const emptyStyle: CSSProperties = {
    padding: theme.spacing.md,
    textAlign: "center",
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.sm,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle} onClick={onMinimizeToggle}>
        <span style={titleStyle}>{title}</span>
        <span style={countBadgeStyle}>{trackedQuests.length}</span>
        {showMinimize && (
          <div style={minimizeStyle}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 8l4-4 4 4H2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {trackedQuests.length > 0 ? (
          <div style={listStyle}>
            {trackedQuests.map((trackedQuest) => (
              <TrackedQuestItem
                key={trackedQuest.quest.id}
                trackedQuest={trackedQuest}
                isExpanded={expandedQuestId === trackedQuest.quest.id}
                isRemoving={beingRemoved.has(trackedQuest.quest.id)}
                onToggleExpand={() => handleToggleExpand(trackedQuest.quest.id)}
                onUntrack={
                  onUntrack ? () => onUntrack(trackedQuest.quest.id) : undefined
                }
                onClick={
                  onQuestClick
                    ? () => onQuestClick(trackedQuest.quest.id)
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div style={emptyStyle}>No tracked quests</div>
        )}
      </div>
    </div>
  );
});

export default QuestTracker;
