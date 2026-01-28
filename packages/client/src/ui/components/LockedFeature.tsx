/**
 * Locked Feature Component
 *
 * Reusable component for displaying locked features based on complexity mode.
 * Shows a lock indicator with an optional upgrade prompt.
 *
 * @packageDocumentation
 */

import React from "react";
import { useComplexityStore } from "../stores/complexityStore";
import { useTheme } from "../stores/themeStore";
import type { ComplexityMode, ComplexityFeatures } from "../types/complexity";
import { COMPLEXITY_MODE_CONFIGS } from "../types/complexity";

/** Props for LockedFeature */
export interface LockedFeatureProps {
  /** The feature that is locked */
  feature: keyof ComplexityFeatures;
  /** The mode required to unlock this feature */
  requiredMode: ComplexityMode;
  /** Custom message to display */
  message?: string;
  /** Whether to show the upgrade button */
  showUpgrade?: boolean;
  /** Callback when upgrade is clicked */
  onUpgrade?: () => void;
  /** Style variant */
  variant?: "inline" | "block" | "tooltip";
  /** Optional className */
  className?: string;
  /** Optional children to render as locked content placeholder */
  children?: React.ReactNode;
}

/**
 * Locked Feature Component
 *
 * Displays a lock indicator for features that require a higher complexity mode.
 * Optionally includes an upgrade button to switch modes.
 *
 * @example
 * ```tsx
 * // Inline lock indicator
 * <LockedFeature
 *   feature="interfaceSharingPublish"
 *   requiredMode="standard"
 *   variant="inline"
 * />
 *
 * // Block with custom message
 * <LockedFeature
 *   feature="editMode"
 *   requiredMode="advanced"
 *   message="Unlock Edit Mode to customize your interface"
 *   showUpgrade
 * />
 *
 * // Wrap locked content
 * <LockedFeature feature="customKeybinds" requiredMode="standard">
 *   <KeybindPanel />
 * </LockedFeature>
 * ```
 */
export function LockedFeature({
  feature: _feature,
  requiredMode,
  message,
  showUpgrade = true,
  onUpgrade,
  variant = "block",
  className,
  children,
}: LockedFeatureProps): React.ReactElement {
  const theme = useTheme();
  const { setMode } = useComplexityStore();
  const modeConfig = COMPLEXITY_MODE_CONFIGS[requiredMode];

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      setMode(requiredMode);
    }
  };

  const defaultMessage = `Upgrade to ${modeConfig.displayName} mode to unlock this feature`;

  // Inline variant - small lock icon with tooltip
  if (variant === "inline") {
    return (
      <span
        className={className}
        title={message || defaultMessage}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: theme.colors.text.muted,
          fontSize: theme.typography.fontSize.xs,
          cursor: showUpgrade ? "pointer" : "default",
        }}
        onClick={showUpgrade ? handleUpgrade : undefined}
      >
        🔒
        <span style={{ opacity: 0.7 }}>{modeConfig.displayName}</span>
      </span>
    );
  }

  // Tooltip variant - just the lock icon for tight spaces
  if (variant === "tooltip") {
    return (
      <span
        className={className}
        title={message || defaultMessage}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: theme.colors.text.muted,
          cursor: showUpgrade ? "pointer" : "default",
        }}
        onClick={showUpgrade ? handleUpgrade : undefined}
      >
        🔒
      </span>
    );
  }

  // Block variant - full locked state display
  return (
    <div
      className={className}
      style={{
        position: "relative",
        padding: theme.spacing.md,
        backgroundColor: theme.colors.background.secondary,
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: theme.borderRadius.md,
        textAlign: "center",
      }}
    >
      {/* Locked overlay if children are provided */}
      {children && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(2px)",
            borderRadius: theme.borderRadius.md,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <span style={{ fontSize: 24, marginBottom: theme.spacing.sm }}>
            🔒
          </span>
          <span
            style={{
              color: theme.colors.text.primary,
              fontSize: theme.typography.fontSize.sm,
              marginBottom: theme.spacing.sm,
            }}
          >
            {message || defaultMessage}
          </span>
          {showUpgrade && (
            <button
              onClick={handleUpgrade}
              style={{
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                backgroundColor: theme.colors.accent.primary,
                color: theme.colors.background.primary,
                border: "none",
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                cursor: "pointer",
              }}
            >
              Upgrade to {modeConfig.displayName}
            </button>
          )}
        </div>
      )}

      {/* Show children (blurred behind overlay) or default locked state */}
      {children || (
        <>
          <span style={{ fontSize: 24, marginBottom: theme.spacing.sm }}>
            🔒
          </span>
          <div
            style={{
              color: theme.colors.text.secondary,
              fontSize: theme.typography.fontSize.sm,
              marginBottom: showUpgrade ? theme.spacing.sm : 0,
            }}
          >
            {message || defaultMessage}
          </div>
          {showUpgrade && (
            <button
              onClick={handleUpgrade}
              style={{
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                backgroundColor: theme.colors.accent.primary,
                color: theme.colors.background.primary,
                border: "none",
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                cursor: "pointer",
              }}
            >
              Upgrade to {modeConfig.displayName}
            </button>
          )}
        </>
      )}
    </div>
  );
}
