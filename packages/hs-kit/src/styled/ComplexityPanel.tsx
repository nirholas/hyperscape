/**
 * Complexity Panel Component
 *
 * UI panel for managing progressive complexity mode settings.
 * Allows users to switch between Simple, Standard, and Advanced modes,
 * controlling feature visibility based on their experience level.
 *
 * @packageDocumentation
 */

import React from "react";
import {
  useComplexityStore,
  useComplexityMode,
} from "../stores/complexityStore";
import { useTheme } from "../stores/themeStore";
import type { ComplexityMode } from "../types/complexity";
import { COMPLEXITY_MODE_CONFIGS } from "../types/complexity";

/** Props for ComplexityPanel */
export interface ComplexityPanelProps {
  /** Optional className for custom styling */
  className?: string;
  /** Whether to show feature preview */
  showFeaturePreview?: boolean;
  /** Compact mode for smaller panels */
  compact?: boolean;
  /** Callback when mode changes */
  onModeChange?: (mode: ComplexityMode) => void;
}

/** Mode card icons */
const MODE_ICONS: Record<ComplexityMode, string> = {
  simple: "🎮",
  standard: "⚔️",
  advanced: "🏰",
};

/** Feature display names */
const FEATURE_LABELS: Record<string, string> = {
  editMode: "Edit Mode",
  multipleActionBars: "Multiple Action Bars",
  windowCombining: "Window Combining",
  advancedHUD: "Advanced HUD",
  customKeybinds: "Custom Keybinds",
  interfaceSharing: "Load Shared Layouts",
  interfaceSharingPublish: "Share Your Layouts",
  detailedTooltips: "Detailed Tooltips",
  presetHotkeys: "Preset Hotkeys (F1-F4)",
};

/** Mode selection card */
function ModeCard({
  mode,
  isSelected,
  onSelect,
  compact,
}: {
  mode: ComplexityMode;
  isSelected: boolean;
  onSelect: () => void;
  compact?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const config = COMPLEXITY_MODE_CONFIGS[mode];

  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: compact ? "row" : "column",
        alignItems: compact ? "center" : "flex-start",
        gap: compact ? theme.spacing.sm : theme.spacing.xs,
        padding: compact
          ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
          : theme.spacing.sm,
        backgroundColor: isSelected
          ? `${theme.colors.accent.primary}22`
          : theme.colors.background.secondary,
        border: `1px solid ${isSelected ? theme.colors.accent.primary : theme.colors.border.default}`,
        borderRadius: theme.borderRadius.md,
        cursor: "pointer",
        transition: theme.transitions.fast,
        textAlign: compact ? "left" : "center",
        flex: 1,
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.tertiary;
          e.currentTarget.style.borderColor = theme.colors.border.hover;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.secondary;
          e.currentTarget.style.borderColor = theme.colors.border.default;
        }
      }}
    >
      <span style={{ fontSize: compact ? 16 : 24 }}>{MODE_ICONS[mode]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: isSelected
              ? theme.colors.accent.primary
              : theme.colors.text.primary,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.semibold,
            whiteSpace: "nowrap",
          }}
        >
          {config.displayName}
        </div>
        {!compact && (
          <div
            style={{
              color: theme.colors.text.muted,
              fontSize: theme.typography.fontSize.xs,
              marginTop: 2,
            }}
          >
            {config.description}
          </div>
        )}
      </div>
      {isSelected && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: theme.colors.accent.primary,
            flexShrink: 0,
          }}
        />
      )}
    </button>
  );
}

/** Feature list item */
function FeatureItem({
  feature,
  enabled,
}: {
  feature: string;
  enabled: boolean;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs}px 0`,
        color: enabled ? theme.colors.text.primary : theme.colors.text.disabled,
      }}
    >
      <span
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: enabled
            ? theme.colors.state.success
            : theme.colors.text.disabled,
        }}
      >
        {enabled ? "✓" : "○"}
      </span>
      <span style={{ fontSize: theme.typography.fontSize.xs }}>
        {FEATURE_LABELS[feature] || feature}
      </span>
    </div>
  );
}

/**
 * Complexity Panel
 *
 * Provides UI controls for switching between complexity modes.
 *
 * @example
 * ```tsx
 * <ComplexityPanel showFeaturePreview />
 * ```
 */
export function ComplexityPanel({
  className,
  showFeaturePreview = true,
  compact = false,
  onModeChange,
}: ComplexityPanelProps): React.ReactElement {
  const theme = useTheme();
  const currentMode = useComplexityMode();
  const { setMode, getFeatures } = useComplexityStore();
  const features = getFeatures();

  const handleModeChange = (mode: ComplexityMode) => {
    setMode(mode);
    onModeChange?.(mode);
  };

  const modes: ComplexityMode[] = ["simple", "standard", "advanced"];

  return (
    <div
      className={className}
      style={{
        padding: compact ? theme.spacing.sm : theme.spacing.md,
        color: theme.colors.text.primary,
        fontFamily: theme.typography.fontFamily.body,
      }}
    >
      {/* Mode selector header */}
      <div
        style={{
          color: theme.colors.text.accent,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.fontWeight.semibold,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: theme.spacing.sm,
        }}
      >
        Interface Complexity
      </div>

      {/* Mode cards */}
      <div
        style={{
          display: "flex",
          gap: theme.spacing.xs,
          marginBottom: showFeaturePreview ? theme.spacing.md : 0,
        }}
      >
        {modes.map((mode) => (
          <ModeCard
            key={mode}
            mode={mode}
            isSelected={currentMode === mode}
            onSelect={() => handleModeChange(mode)}
            compact={compact}
          />
        ))}
      </div>

      {/* Feature preview */}
      {showFeaturePreview && (
        <>
          <div
            style={{
              color: theme.colors.text.secondary,
              fontSize: theme.typography.fontSize.xs,
              fontWeight: theme.typography.fontWeight.medium,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: theme.spacing.xs,
              paddingTop: theme.spacing.sm,
              borderTop: `1px solid ${theme.colors.border.default}`,
            }}
          >
            Available Features
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact ? "1fr" : "1fr 1fr",
              gap: `0 ${theme.spacing.md}px`,
            }}
          >
            {Object.entries(features).map(([feature, enabled]) => (
              <FeatureItem key={feature} feature={feature} enabled={enabled} />
            ))}
          </div>
        </>
      )}

      {/* Mode description */}
      <div
        style={{
          marginTop: theme.spacing.md,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.background.secondary,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.xs,
            marginBottom: theme.spacing.xs,
          }}
        >
          <span>{MODE_ICONS[currentMode]}</span>
          <span
            style={{
              color: theme.colors.accent.primary,
              fontSize: theme.typography.fontSize.sm,
              fontWeight: theme.typography.fontWeight.semibold,
            }}
          >
            {COMPLEXITY_MODE_CONFIGS[currentMode].displayName} Mode
          </span>
        </div>
        <div
          style={{
            color: theme.colors.text.muted,
            fontSize: theme.typography.fontSize.xs,
            lineHeight: 1.4,
          }}
        >
          {currentMode === "simple" && (
            <>
              Perfect for new players. Focuses on core gameplay with a clean,
              uncluttered interface. You can always upgrade later as you learn.
            </>
          )}
          {currentMode === "standard" && (
            <>
              Recommended for most players. Unlocks multiple action bars, window
              combining, and detailed tooltips while keeping the interface
              manageable.
            </>
          )}
          {currentMode === "advanced" && (
            <>
              Full customization for power users. Includes Edit Mode for
              complete interface control, custom keybinds, and all advanced
              features.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
