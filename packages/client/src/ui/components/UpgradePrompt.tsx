/**
 * Upgrade Prompt Component
 *
 * Modal prompt that suggests upgrading to a higher complexity mode
 * based on player progression (playtime, level, etc.).
 *
 * @packageDocumentation
 */

import React, { useCallback } from "react";
import { useComplexityStore } from "../stores/complexityStore";
import { useTheme } from "../stores/themeStore";
import type { ComplexityMode } from "../types/complexity";
import { COMPLEXITY_MODE_CONFIGS } from "../types/complexity";

/** Props for UpgradePrompt */
export interface UpgradePromptProps {
  /** Target mode to upgrade to */
  targetMode: ComplexityMode;
  /** Reason for the upgrade suggestion */
  reason?: string;
  /** Optional className for custom styling */
  className?: string;
  /** Callback when prompt is closed (accepted or dismissed) */
  onClose?: () => void;
}

/** Feature highlights for each mode */
const MODE_HIGHLIGHTS: Record<ComplexityMode, string[]> = {
  simple: [],
  standard: [
    "Multiple Action Bars for more abilities",
    "Window Combining into tabbed groups",
    "Detailed Tooltips with stats",
    "Preset Hotkeys (F1-F4)",
  ],
  advanced: [
    "Edit Mode for full interface customization",
    "Custom Keybinds for any action",
    "All Standard features included",
  ],
};

/** Mode icons */
const MODE_ICONS: Record<ComplexityMode, string> = {
  simple: "🎮",
  standard: "⚔️",
  advanced: "🏰",
};

/**
 * Upgrade Prompt
 *
 * Displays a modal suggesting the user upgrade their complexity mode.
 * Shows feature highlights and allows accept/dismiss actions.
 *
 * @example
 * ```tsx
 * const { shouldShowUpgradePrompt } = useComplexityStore();
 *
 * {shouldShowUpgradePrompt("standard") && (
 *   <UpgradePrompt
 *     targetMode="standard"
 *     reason="You've been playing for over 2 hours"
 *     onClose={() => markStandardPromptShown()}
 *   />
 * )}
 * ```
 */
export function UpgradePrompt({
  targetMode,
  reason,
  className,
  onClose,
}: UpgradePromptProps): React.ReactElement {
  const theme = useTheme();
  const {
    setMode,
    markStandardPromptShown,
    markAdvancedPromptShown,
    dismissPrompt,
  } = useComplexityStore();
  const config = COMPLEXITY_MODE_CONFIGS[targetMode];
  const highlights = MODE_HIGHLIGHTS[targetMode];

  const handleAccept = useCallback(() => {
    setMode(targetMode);
    if (targetMode === "standard") {
      markStandardPromptShown();
    } else if (targetMode === "advanced") {
      markAdvancedPromptShown();
    }
    onClose?.();
  }, [
    targetMode,
    setMode,
    markStandardPromptShown,
    markAdvancedPromptShown,
    onClose,
  ]);

  const handleDismiss = useCallback(() => {
    dismissPrompt();
    if (targetMode === "standard") {
      markStandardPromptShown();
    } else if (targetMode === "advanced") {
      markAdvancedPromptShown();
    }
    onClose?.();
  }, [
    targetMode,
    dismissPrompt,
    markStandardPromptShown,
    markAdvancedPromptShown,
    onClose,
  ]);

  const handleRemindLater = useCallback(() => {
    dismissPrompt();
    onClose?.();
  }, [dismissPrompt, onClose]);

  return (
    <div
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        zIndex: theme.zIndex.modal,
        fontFamily: theme.typography.fontFamily.body,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleRemindLater();
        }
      }}
    >
      <div
        style={{
          backgroundColor: theme.colors.background.primary,
          border: `1px solid ${theme.colors.accent.primary}`,
          borderRadius: theme.borderRadius.lg,
          padding: theme.spacing.lg,
          maxWidth: 400,
          width: "90%",
          boxShadow: theme.shadows.xl,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          <span style={{ fontSize: 32 }}>{MODE_ICONS[targetMode]}</span>
          <div>
            <div
              style={{
                color: theme.colors.accent.primary,
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            >
              Upgrade to {config.displayName}?
            </div>
            {reason && (
              <div
                style={{
                  color: theme.colors.text.muted,
                  fontSize: theme.typography.fontSize.xs,
                  marginTop: 2,
                }}
              >
                {reason}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div
          style={{
            color: theme.colors.text.secondary,
            fontSize: theme.typography.fontSize.sm,
            lineHeight: 1.5,
            marginBottom: theme.spacing.md,
          }}
        >
          {config.description}. Ready to unlock more features?
        </div>

        {/* Feature highlights */}
        {highlights.length > 0 && (
          <div
            style={{
              backgroundColor: theme.colors.background.secondary,
              borderRadius: theme.borderRadius.md,
              padding: theme.spacing.sm,
              marginBottom: theme.spacing.md,
            }}
          >
            <div
              style={{
                color: theme.colors.text.accent,
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.semibold,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: theme.spacing.xs,
              }}
            >
              New Features
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: theme.spacing.md,
                color: theme.colors.text.primary,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {highlights.map((highlight, index) => (
                <li key={index} style={{ marginBottom: theme.spacing.xs }}>
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: theme.spacing.sm }}>
          <button
            onClick={handleAccept}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              backgroundColor: theme.colors.accent.primary,
              color: theme.colors.background.primary,
              border: "none",
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.sm,
              fontWeight: theme.typography.fontWeight.semibold,
              cursor: "pointer",
              transition: theme.transitions.fast,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.accent.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                theme.colors.accent.primary;
            }}
          >
            Upgrade Now
          </button>
          <button
            onClick={handleRemindLater}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              backgroundColor: "transparent",
              color: theme.colors.text.secondary,
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.sm,
              cursor: "pointer",
              transition: theme.transitions.fast,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                theme.colors.background.tertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Maybe Later
          </button>
        </div>

        {/* Don't show again option */}
        <button
          onClick={handleDismiss}
          style={{
            width: "100%",
            marginTop: theme.spacing.sm,
            padding: theme.spacing.xs,
            backgroundColor: "transparent",
            color: theme.colors.text.muted,
            border: "none",
            fontSize: theme.typography.fontSize.xs,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Don't show this again
        </button>
      </div>
    </div>
  );
}
