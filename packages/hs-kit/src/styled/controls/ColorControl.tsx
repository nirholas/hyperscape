/**
 * Color Control Component
 *
 * A color picker input for color settings.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useRef, useState } from "react";
import { useTheme } from "../../stores/themeStore";
import type { ColorSettingDefinition } from "../../core/settings/settingsSchema";

/** Props for ColorControl */
export interface ColorControlProps {
  /** Setting definition */
  setting: ColorSettingDefinition;
  /** Current value (hex color) */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Optional className */
  className?: string;
}

/** Default preset colors */
const DEFAULT_PRESETS = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#eab308", // Yellow
  "#84cc16", // Lime
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#06b6d4", // Cyan
  "#0ea5e9", // Sky
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#a855f7", // Purple
  "#d946ef", // Fuchsia
  "#ec4899", // Pink
  "#f43f5e", // Rose
];

/**
 * Color Control
 *
 * Renders a color picker with optional presets.
 *
 * @example
 * ```tsx
 * <ColorControl
 *   setting={{
 *     id: 'interface.accentColor',
 *     type: 'color',
 *     label: 'Accent Color',
 *     defaultValue: '#3b82f6',
 *     presets: ['#ef4444', '#22c55e', '#3b82f6'],
 *   }}
 *   value="#3b82f6"
 *   onChange={(value) => console.log(value)}
 * />
 * ```
 */
export const ColorControl = memo(function ColorControl({
  setting,
  value,
  onChange,
  disabled = false,
  className,
}: ColorControlProps): React.ReactElement {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const presets = setting.presets ?? DEFAULT_PRESETS;

  const handleColorClick = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handlePresetClick = useCallback(
    (color: string) => {
      if (!disabled) {
        onChange(color);
      }
    },
    [disabled, onChange],
  );

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    opacity: disabled ? 0.5 : 1,
  };

  const mainRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
  };

  const swatchStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    backgroundColor: value,
    border: `1px solid ${theme.colors.border.default}`,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.1)`,
    transition: theme.transitions.fast,
  };

  const inputStyle: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  };

  const hexInputStyle: React.CSSProperties = {
    flex: 1,
    maxWidth: 90,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.fontFamily.mono,
    textTransform: "uppercase",
    outline: "none",
  };

  const expandButtonStyle: React.CSSProperties = {
    padding: `${theme.spacing.xs}px`,
    backgroundColor: "transparent",
    color: theme.colors.text.muted,
    border: "none",
    borderRadius: theme.borderRadius.sm,
    cursor: "pointer",
    transition: theme.transitions.fast,
  };

  const presetsContainerStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(8, 1fr)",
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
  };

  const presetSwatchStyle = (color: string): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: color,
    border: `1px solid ${color === value ? theme.colors.accent.primary : theme.colors.border.default}`,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: theme.transitions.fast,
    boxShadow:
      color === value ? `0 0 0 2px ${theme.colors.accent.primary}` : "none",
  });

  return (
    <div className={className} style={containerStyle}>
      <div style={mainRowStyle}>
        <button
          onClick={handleColorClick}
          disabled={disabled}
          style={swatchStyle}
          aria-label={`Current color: ${value}. Click to pick a new color.`}
        />
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          style={inputStyle}
          aria-hidden="true"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const newValue = e.target.value;
            if (/^#[0-9A-Fa-f]{0,6}$/.test(newValue)) {
              onChange(newValue);
            }
          }}
          onBlur={(e) => {
            // Validate and fix on blur
            const val = e.target.value;
            if (!/^#[0-9A-Fa-f]{6}$/.test(val)) {
              onChange(setting.defaultValue);
            }
          }}
          disabled={disabled}
          style={hexInputStyle}
          maxLength={7}
          aria-label="Hex color value"
        />
        {presets.length > 0 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={expandButtonStyle}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? "Hide color presets" : "Show color presets"
            }
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: theme.transitions.fast,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
      {isExpanded && presets.length > 0 && (
        <div style={presetsContainerStyle}>
          {presets.map((color) => (
            <button
              key={color}
              onClick={() => handlePresetClick(color)}
              disabled={disabled}
              style={presetSwatchStyle(color)}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>
      )}
    </div>
  );
});
