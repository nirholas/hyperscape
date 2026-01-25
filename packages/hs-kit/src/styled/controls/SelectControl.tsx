/**
 * Select Control Component
 *
 * A polished dropdown select input for choice settings.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useRef, useState } from "react";
import { useTheme } from "../../stores/themeStore";
import type { SelectSettingDefinition } from "../../core/settings/settingsSchema";

/** Props for SelectControl */
export interface SelectControlProps {
  /** Setting definition */
  setting: SelectSettingDefinition;
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show icon prefix */
  showIcon?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * Select Control
 *
 * Renders a polished dropdown select with hover effects and smooth animations.
 *
 * @example
 * ```tsx
 * <SelectControl
 *   setting={{
 *     id: 'graphics.quality',
 *     type: 'select',
 *     label: 'Graphics Quality',
 *     defaultValue: 'high',
 *     options: [
 *       { value: 'low', label: 'Low' },
 *       { value: 'medium', label: 'Medium' },
 *       { value: 'high', label: 'High' },
 *     ],
 *   }}
 *   value="high"
 *   onChange={(value) => console.log(value)}
 * />
 * ```
 */
export const SelectControl = memo(function SelectControl({
  setting,
  value,
  onChange,
  disabled = false,
  size = "md",
  fullWidth = false,
  className,
}: SelectControlProps): React.ReactElement {
  const theme = useTheme();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Size variants
  const sizes = {
    sm: { padding: "4px 28px 4px 8px", fontSize: "11px", minWidth: 100 },
    md: { padding: "6px 32px 6px 10px", fontSize: "13px", minWidth: 140 },
    lg: { padding: "8px 36px 8px 12px", fontSize: "14px", minWidth: 160 },
  };
  const s = sizes[size];

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const currentOption = setting.options.find((o) => o.value === value);

  const containerStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    minWidth: fullWidth ? "100%" : s.minWidth,
    opacity: disabled ? 0.4 : 1,
    transition: "opacity 150ms ease",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: s.padding,
    backgroundColor: isHovered
      ? theme.colors.background.tertiary
      : theme.colors.background.secondary,
    color: theme.colors.text.primary,
    border: `1px solid ${
      isFocused
        ? theme.colors.accent.primary
        : isHovered
          ? theme.colors.border.hover
          : theme.colors.border.default
    }`,
    borderRadius: theme.borderRadius.md,
    fontSize: s.fontSize,
    fontFamily: theme.typography.fontFamily.body,
    fontWeight: theme.typography.fontWeight.medium,
    cursor: disabled ? "not-allowed" : "pointer",
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    transition: "all 150ms ease",
    boxShadow: isFocused
      ? `0 0 0 2px ${theme.colors.accent.primary}25`
      : isHovered
        ? theme.shadows.sm
        : "none",
  };

  // Animated chevron arrow
  const arrowContainerStyle: React.CSSProperties = {
    position: "absolute",
    right: size === "sm" ? 6 : 10,
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "transform 150ms ease",
  };

  // Use SVG for better arrow rendering
  const arrowSize = size === "sm" ? 12 : size === "md" ? 14 : 16;

  return (
    <div
      className={className}
      style={containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <select
        ref={selectRef}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={selectStyle}
        aria-label={setting.label}
        title={currentOption?.label}
      >
        {setting.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div style={arrowContainerStyle}>
        <svg
          width={arrowSize}
          height={arrowSize}
          viewBox="0 0 16 16"
          fill="none"
          style={{
            transition: "transform 150ms ease",
            transform: isFocused ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path
            d="M4 6L8 10L12 6"
            stroke={
              isFocused
                ? theme.colors.accent.primary
                : theme.colors.text.secondary
            }
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
});
