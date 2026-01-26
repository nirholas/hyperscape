/**
 * Settings Control Component
 *
 * Generic control renderer that displays the appropriate input type
 * based on the setting definition.
 *
 * @packageDocumentation
 */

import React, { memo } from "react";
import { useTheme } from "@/ui";
import type { SettingDefinition } from "@/game/systems/settings";
import {
  SliderControl,
  ToggleControl,
  SelectControl,
  KeybindControl,
  ColorControl,
} from "@/ui/controls";

/** Props for SettingsControl */
export interface SettingsControlProps {
  /** Setting definition */
  setting: SettingDefinition;
  /** Current value */
  value: unknown;
  /** Change handler */
  onChange: (value: unknown) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Whether to show the label inline */
  showLabel?: boolean;
  /** Whether to show the description */
  showDescription?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * Settings Control
 *
 * Renders the appropriate control type based on the setting definition.
 *
 * @example
 * ```tsx
 * <SettingsControl
 *   setting={volumeSetting}
 *   value={80}
 *   onChange={(value) => updateSetting('audio.master', value)}
 * />
 * ```
 */
// Wrapped with memo to prevent unnecessary re-renders from parent updates
export const SettingsControl = memo(function SettingsControl({
  setting,
  value,
  onChange,
  disabled = false,
  showLabel = true,
  showDescription = true,
  compact = false,
  className,
}: SettingsControlProps): React.ReactElement {
  const theme = useTheme();

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: compact ? "row" : "column",
    gap: compact ? theme.spacing.md : theme.spacing.xs,
    padding: compact ? `${theme.spacing.xs}px 0` : `${theme.spacing.sm}px 0`,
    alignItems: compact ? "center" : "stretch",
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const labelContainerStyle: React.CSSProperties = {
    flex: compact ? 1 : undefined,
    minWidth: compact ? 0 : undefined,
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    color: disabled ? theme.colors.text.disabled : theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    marginBottom: !compact && showDescription ? theme.spacing.xs : 0,
  };

  const descriptionStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    lineHeight: theme.typography.lineHeight.normal,
  };

  const controlContainerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    minWidth: compact ? 200 : undefined,
    justifyContent: compact ? "flex-end" : "flex-start",
  };

  const restartBadgeStyle: React.CSSProperties = {
    padding: `2px ${theme.spacing.xs}px`,
    backgroundColor: theme.colors.state.warning + "20",
    color: theme.colors.state.warning,
    fontSize: theme.typography.fontSize.xs,
    borderRadius: theme.borderRadius.sm,
  };

  const advancedBadgeStyle: React.CSSProperties = {
    padding: `2px ${theme.spacing.xs}px`,
    backgroundColor: theme.colors.accent.primary + "20",
    color: theme.colors.accent.primary,
    fontSize: theme.typography.fontSize.xs,
    borderRadius: theme.borderRadius.sm,
  };

  // Render the appropriate control
  const renderControl = () => {
    switch (setting.type) {
      case "slider":
        return (
          <SliderControl
            setting={setting}
            value={value as number}
            onChange={onChange}
            disabled={disabled}
          />
        );
      case "toggle":
        return (
          <ToggleControl
            setting={setting}
            value={value as boolean}
            onChange={onChange}
            disabled={disabled}
          />
        );
      case "select":
        return (
          <SelectControl
            setting={setting}
            value={value as string}
            onChange={onChange}
            disabled={disabled}
          />
        );
      case "keybind":
        return (
          <KeybindControl
            setting={setting}
            value={value as string}
            onChange={onChange}
            disabled={disabled}
          />
        );
      case "color":
        return (
          <ColorControl
            setting={setting}
            value={value as string}
            onChange={onChange}
            disabled={disabled}
          />
        );
      case "number":
        return (
          <NumberInput
            value={value as number}
            onChange={onChange}
            min={setting.min}
            max={setting.max}
            step={setting.step}
            unit={setting.unit}
            disabled={disabled}
          />
        );
      default:
        return (
          <span style={{ color: theme.colors.text.muted }}>
            Unknown control type
          </span>
        );
    }
  };

  return (
    <div className={className} style={containerStyle}>
      {showLabel && (
        <div style={labelContainerStyle}>
          <div style={labelStyle}>
            <span>{setting.label}</span>
            {setting.requiresRestart && (
              <span style={restartBadgeStyle}>Restart</span>
            )}
            {setting.advanced && (
              <span style={advancedBadgeStyle}>Advanced</span>
            )}
          </div>
          {showDescription && setting.description && !compact && (
            <div style={descriptionStyle}>{setting.description}</div>
          )}
        </div>
      )}
      <div style={controlContainerStyle}>{renderControl()}</div>
    </div>
  );
});

/** Simple number input component */
function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled,
}: {
  value: number;
  onChange: (value: unknown) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}): React.ReactElement {
  const theme = useTheme();

  const inputStyle: React.CSSProperties = {
    width: 80,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.fontFamily.mono,
    textAlign: "right",
    outline: "none",
    opacity: disabled ? 0.5 : 1,
  };

  const unitStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.sm,
    marginLeft: theme.spacing.xs,
  };

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={inputStyle}
      />
      {unit && <span style={unitStyle}>{unit}</span>}
    </div>
  );
}
