/**
 * Quest Objective Component
 *
 * Individual objective display with progress indicator,
 * checkbox, and completion state.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";
import {
  type QuestObjective as QuestObjectiveData,
  isObjectiveComplete,
  OBJECTIVE_TYPE_CONFIG,
} from "../core/quest";

/** Props for QuestObjective component */
export interface QuestObjectiveProps {
  /** Objective data */
  objective: QuestObjectiveData;
  /** Whether to show progress bar */
  showProgress?: boolean;
  /** Whether to show the objective type icon */
  showIcon?: boolean;
  /** Compact mode (single line) */
  compact?: boolean;
  /** Click handler */
  onClick?: (objective: QuestObjectiveData) => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Quest Objective Component
 *
 * Displays a single quest objective with progress tracking.
 *
 * @example
 * ```tsx
 * <QuestObjective
 *   objective={{
 *     id: "obj1",
 *     type: "kill",
 *     description: "Defeat goblins",
 *     current: 3,
 *     target: 5,
 *   }}
 *   showProgress
 * />
 * ```
 */
export const QuestObjective = memo(function QuestObjective({
  objective,
  showProgress = true,
  showIcon = true,
  compact = false,
  onClick,
  className,
  style,
}: QuestObjectiveProps): React.ReactElement | null {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  // Don't render hidden objectives
  if (objective.hidden) {
    return null;
  }

  const isComplete = isObjectiveComplete(objective);
  const progress = Math.min((objective.current / objective.target) * 100, 100);
  const typeConfig = OBJECTIVE_TYPE_CONFIG[objective.type];

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    alignItems: compact ? "center" : "flex-start",
    gap: theme.spacing.sm,
    padding: compact ? `${theme.spacing.xs}px 0` : theme.spacing.xs,
    opacity: isComplete ? 0.7 : 1,
    cursor: onClick ? "pointer" : "default",
    transition: reducedMotion ? "none" : theme.transitions.fast,
    ...style,
  };

  // Checkbox styles
  const checkboxStyle: CSSProperties = {
    width: 16,
    height: 16,
    minWidth: 16,
    borderRadius: theme.borderRadius.sm,
    border: `1px solid ${isComplete ? theme.colors.state.success : theme.colors.border.default}`,
    backgroundColor: isComplete ? theme.colors.state.success : "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: reducedMotion ? "none" : theme.transitions.fast,
    marginTop: compact ? 0 : 2,
  };

  // Check mark
  const checkmarkStyle: CSSProperties = {
    color: theme.colors.background.primary,
    fontSize: 10,
    fontWeight: theme.typography.fontWeight.bold,
    lineHeight: 1,
  };

  // Content container
  const contentStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  // Description line styles
  const descriptionStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    color: isComplete ? theme.colors.text.muted : theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: theme.typography.lineHeight.normal,
    textDecoration: isComplete ? "line-through" : "none",
  };

  // Icon styles
  const iconStyle: CSSProperties = {
    width: 14,
    height: 14,
    color: isComplete ? theme.colors.text.muted : theme.colors.text.secondary,
    flexShrink: 0,
  };

  // Progress text styles
  const progressTextStyle: CSSProperties = {
    color: isComplete
      ? theme.colors.state.success
      : progress >= 50
        ? theme.colors.accent.primary
        : theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    marginLeft: "auto",
    flexShrink: 0,
  };

  // Progress bar container
  const progressBarContainerStyle: CSSProperties = {
    height: 4,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.xs,
    overflow: "hidden",
  };

  // Progress bar fill
  const progressBarFillStyle: CSSProperties = {
    height: "100%",
    width: `${progress}%`,
    backgroundColor: isComplete
      ? theme.colors.state.success
      : theme.colors.accent.primary,
    borderRadius: theme.borderRadius.sm,
    transition: reducedMotion ? "none" : "width 0.3s ease",
  };

  // Optional badge
  const optionalBadgeStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    backgroundColor: theme.colors.background.tertiary,
    padding: `0 ${theme.spacing.xs}px`,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.xs,
  };

  // Location hint
  const locationStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing.xs,
    display: "flex",
    alignItems: "center",
    gap: 4,
  };

  // Get objective type icon (simple SVG inline)
  const getTypeIcon = () => {
    const icons: Record<string, React.ReactNode> = {
      kill: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M8 1L6 5H2l3.5 3L4 12l4-2.5L12 12l-1.5-4L14 5h-4L8 1z" />
        </svg>
      ),
      collect: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M2 4h12v8H2V4zm1 1v6h10V5H3zm3 2h4v2H6V7z" />
        </svg>
      ),
      talk: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M2 3h12v8H4l-2 2V3zm2 2v4h8V5H4z" />
        </svg>
      ),
      explore: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12A5 5 0 118 3a5 5 0 010 10zm0-8L5 8h2v3h2V8h2L8 5z" />
        </svg>
      ),
      escort: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M4 4a2 2 0 114 0 2 2 0 01-4 0zm6 0a2 2 0 114 0 2 2 0 01-4 0zM2 10c0-2 2-3 4-3s4 1 4 3v2H2v-2zm8 0c0-2 2-3 4-3s4 1 4 3v2h-8v-2z" />
        </svg>
      ),
      interact: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M8 2a1 1 0 011 1v4h4a1 1 0 110 2H9v4a1 1 0 11-2 0V9H3a1 1 0 110-2h4V3a1 1 0 011-1z" />
        </svg>
      ),
      craft: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M3 3h3v3H3V3zm7 0h3v3h-3V3zm-7 7h3v3H3v-3zm7 0h3v3h-3v-3zM7 7h2v2H7V7z" />
        </svg>
      ),
      deliver: (
        <svg viewBox="0 0 16 16" fill="currentColor" style={iconStyle}>
          <path d="M14 8l-4-4v3H2v2h8v3l4-4z" />
        </svg>
      ),
    };
    return icons[objective.type] || icons.interact;
  };

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={() => onClick?.(objective)}
      title={typeConfig.label}
    >
      {/* Checkbox */}
      <div style={checkboxStyle}>
        {isComplete && <span style={checkmarkStyle}>✓</span>}
      </div>

      {/* Content */}
      <div style={contentStyle}>
        <div style={descriptionStyle}>
          {/* Type icon */}
          {showIcon && getTypeIcon()}

          {/* Description */}
          <span>{objective.description}</span>

          {/* Optional badge */}
          {objective.optional && (
            <span style={optionalBadgeStyle}>Optional</span>
          )}

          {/* Progress count */}
          {!compact && objective.target > 1 && (
            <span style={progressTextStyle}>
              {objective.current}/{objective.target}
            </span>
          )}
        </div>

        {/* Progress bar (non-compact mode) */}
        {showProgress && !compact && objective.target > 1 && (
          <div style={progressBarContainerStyle}>
            <div style={progressBarFillStyle} />
          </div>
        )}

        {/* Location hint */}
        {!compact && objective.location && (
          <div style={locationStyle}>
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ width: 10, height: 10 }}
            >
              <path d="M8 1a5 5 0 015 5c0 3.5-5 8-5 8S3 9.5 3 6a5 5 0 015-5zm0 7a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
            {objective.location}
          </div>
        )}
      </div>

      {/* Compact mode progress */}
      {compact && objective.target > 1 && (
        <span style={progressTextStyle}>
          {objective.current}/{objective.target}
        </span>
      )}
    </div>
  );
});

export default QuestObjective;
