/**
 * Toggle Control Component
 *
 * A modern toggle/switch input for boolean settings with polished animations.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useState } from "react";
import { useTheme } from "../../stores/themeStore";
import type { ToggleSettingDefinition } from "../../core/settings/settingsSchema";

/** Props for ToggleControl */
export interface ToggleControlProps {
  /** Setting definition */
  setting: ToggleSettingDefinition;
  /** Current value */
  value: boolean;
  /** Change handler */
  onChange: (value: boolean) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show on/off labels inside toggle */
  showLabels?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * Toggle Control
 *
 * Renders a polished toggle switch with smooth animations and glow effects.
 *
 * @example
 * ```tsx
 * <ToggleControl
 *   setting={{
 *     id: 'audio.mute',
 *     type: 'toggle',
 *     label: 'Mute All',
 *     defaultValue: false,
 *   }}
 *   value={false}
 *   onChange={(value) => console.log(value)}
 * />
 * ```
 */
export const ToggleControl = memo(function ToggleControl({
  setting,
  value,
  onChange,
  disabled = false,
  size = "md",
  showLabels = false,
  className,
}: ToggleControlProps): React.ReactElement {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Size variants
  const sizes = {
    sm: { width: 32, height: 18, thumbSize: 14, padding: 2 },
    md: { width: 44, height: 24, thumbSize: 18, padding: 3 },
    lg: { width: 56, height: 30, thumbSize: 24, padding: 3 },
  };
  const s = sizes[size];

  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!value);
    }
  }, [disabled, onChange, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !disabled) {
        e.preventDefault();
        onChange(!value);
      }
    },
    [disabled, onChange, value],
  );

  const containerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "opacity 150ms ease",
  };

  const trackStyle: React.CSSProperties = {
    position: "relative",
    width: s.width,
    height: s.height,
    borderRadius: s.height / 2,
    backgroundColor: value
      ? theme.colors.accent.primary
      : theme.colors.background.tertiary,
    border: `1px solid ${
      value
        ? theme.colors.accent.primary
        : isHovered || isFocused
          ? theme.colors.border.hover
          : theme.colors.border.default
    }`,
    boxShadow: value
      ? isHovered
        ? `0 0 12px ${theme.colors.accent.primary}50, inset 0 1px 2px rgba(0,0,0,0.1)`
        : `0 0 8px ${theme.colors.accent.primary}30, inset 0 1px 2px rgba(0,0,0,0.1)`
      : `inset 0 1px 3px rgba(0,0,0,0.2)`,
    transition: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
  };

  // Calculate thumb position
  const thumbLeft = value ? s.width - s.thumbSize - s.padding - 2 : s.padding;

  const thumbStyle: React.CSSProperties = {
    position: "absolute",
    top: s.padding,
    left: thumbLeft,
    width: s.thumbSize,
    height: s.thumbSize,
    borderRadius: "50%",
    backgroundColor: "#ffffff",
    boxShadow: isHovered
      ? `0 2px 6px rgba(0,0,0,0.3), 0 0 0 2px ${value ? theme.colors.accent.primary : theme.colors.border.default}20`
      : "0 2px 4px rgba(0,0,0,0.2)",
    transition: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)",
    transform: isHovered ? "scale(1.05)" : "scale(1)",
  };

  // Optional labels inside the toggle
  const labelStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: size === "lg" ? "9px" : "7px",
    fontWeight: theme.typography.fontWeight.bold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    transition: "opacity 150ms ease",
  };

  return (
    <div
      className={className}
      style={containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        role="switch"
        aria-checked={value}
        aria-label={setting.label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={trackStyle}
      >
        {showLabels && size !== "sm" && (
          <>
            <span
              style={{
                ...labelStyle,
                left: 6,
                color: value ? "rgba(255,255,255,0.9)" : "transparent",
                opacity: value ? 1 : 0,
              }}
            >
              On
            </span>
            <span
              style={{
                ...labelStyle,
                right: 6,
                color: !value ? theme.colors.text.muted : "transparent",
                opacity: !value ? 1 : 0,
              }}
            >
              Off
            </span>
          </>
        )}
        <div style={thumbStyle} />
      </div>
    </div>
  );
});
