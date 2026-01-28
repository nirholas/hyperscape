/**
 * Settings Category Component
 *
 * Renders all settings within a category with proper grouping and layout.
 *
 * @packageDocumentation
 */

import React, { useState, memo } from "react";
import { useTheme } from "@/ui";
import {
  type SettingCategory,
  type SettingDefinition,
  getSettingsByCategory,
  SETTING_CATEGORIES,
} from "@/game/systems/settings";
import { SettingsControl } from "./SettingsControl";

/** Props for SettingsCategory */
export interface SettingsCategoryProps {
  /** Category to display */
  category: SettingCategory;
  /** Current setting values */
  values: Record<string, unknown>;
  /** Change handler */
  onChange: (id: string, value: unknown) => void;
  /** Whether to show advanced settings */
  showAdvanced?: boolean;
  /** Toggle advanced settings callback */
  onToggleAdvanced?: (show: boolean) => void;
  /** Reset category callback */
  onResetCategory?: () => void;
  /** Compact mode */
  compact?: boolean;
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/**
 * Check if a setting should be enabled based on dependencies
 */
function isSettingEnabled(
  setting: SettingDefinition,
  values: Record<string, unknown>,
): boolean {
  if (!setting.dependsOn) return true;
  return values[setting.dependsOn.settingId] === setting.dependsOn.value;
}

/**
 * Settings Category
 *
 * Renders all settings for a specific category.
 *
 * @example
 * ```tsx
 * <SettingsCategory
 *   category="graphics"
 *   values={settingValues}
 *   onChange={(id, value) => updateSetting(id, value)}
 * />
 * ```
 */
// Wrapped with memo to prevent unnecessary re-renders from parent updates
export const SettingsCategory = memo(function SettingsCategory({
  category,
  values,
  onChange,
  showAdvanced = false,
  onToggleAdvanced,
  onResetCategory,
  compact = false,
  className,
  style,
}: SettingsCategoryProps): React.ReactElement {
  const theme = useTheme();
  const [localShowAdvanced, setLocalShowAdvanced] = useState(showAdvanced);

  const categoryInfo = SETTING_CATEGORIES.find((c) => c.id === category);
  const allSettings = getSettingsByCategory(category);
  const basicSettings = allSettings.filter((s) => !s.advanced);
  const advancedSettings = allSettings.filter((s) => s.advanced);

  const effectiveShowAdvanced = onToggleAdvanced
    ? showAdvanced
    : localShowAdvanced;
  const toggleAdvanced = onToggleAdvanced ?? setLocalShowAdvanced;

  const displaySettings = effectiveShowAdvanced ? allSettings : basicSettings;

  const containerStyle: React.CSSProperties = {
    padding: compact ? theme.spacing.sm : theme.spacing.md,
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const titleStyle: React.CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
  };

  const descriptionStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.sm,
    marginTop: theme.spacing.xs,
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
  };

  const buttonStyle: React.CSSProperties = {
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: "transparent",
    color: theme.colors.text.muted,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: theme.typography.fontSize.xs,
    cursor: "pointer",
    transition: theme.transitions.fast,
  };

  const settingsListStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
  };

  const advancedSectionStyle: React.CSSProperties = {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTop: `1px dashed ${theme.colors.border.default}`,
  };

  const advancedHeaderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  };

  const advancedLabelStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>{categoryInfo?.label ?? category}</h3>
          {categoryInfo?.description && !compact && (
            <p style={descriptionStyle}>{categoryInfo.description}</p>
          )}
        </div>
        <div style={actionsStyle}>
          {advancedSettings.length > 0 && (
            <button
              onClick={() => toggleAdvanced(!effectiveShowAdvanced)}
              style={{
                ...buttonStyle,
                backgroundColor: effectiveShowAdvanced
                  ? theme.colors.accent.primary + "20"
                  : "transparent",
                borderColor: effectiveShowAdvanced
                  ? theme.colors.accent.primary
                  : theme.colors.border.default,
                color: effectiveShowAdvanced
                  ? theme.colors.accent.primary
                  : theme.colors.text.muted,
              }}
            >
              {effectiveShowAdvanced ? "Hide Advanced" : "Show Advanced"}
            </button>
          )}
          {onResetCategory && (
            <button
              onClick={onResetCategory}
              style={buttonStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.background.tertiary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Basic Settings */}
      <div style={settingsListStyle}>
        {basicSettings.map((setting) => (
          <SettingsControl
            key={setting.id}
            setting={setting}
            value={values[setting.id] ?? setting.defaultValue}
            onChange={(value) => onChange(setting.id, value)}
            disabled={!isSettingEnabled(setting, values)}
            compact={compact}
          />
        ))}
      </div>

      {/* Advanced Settings */}
      {effectiveShowAdvanced && advancedSettings.length > 0 && (
        <div style={advancedSectionStyle}>
          <div style={advancedHeaderStyle}>
            <span style={advancedLabelStyle}>Advanced Settings</span>
          </div>
          <div style={settingsListStyle}>
            {advancedSettings.map((setting) => (
              <SettingsControl
                key={setting.id}
                setting={setting}
                value={values[setting.id] ?? setting.defaultValue}
                onChange={(value) => onChange(setting.id, value)}
                disabled={!isSettingEnabled(setting, values)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {displaySettings.length === 0 && (
        <div
          style={{
            padding: theme.spacing.lg,
            textAlign: "center",
            color: theme.colors.text.muted,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          No settings available in this category.
        </div>
      )}
    </div>
  );
});
