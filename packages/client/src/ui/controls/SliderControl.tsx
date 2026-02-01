/**
 * Slider Control Component
 *
 * A modern slider input for numeric range settings with polished visuals.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useState, useRef } from "react";
import { useTheme } from "../stores/themeStore";
import type { SliderSettingDefinition } from "../core/settings/settingsSchema";

/** Props for SliderControl */
export interface SliderControlProps {
  /** Setting definition */
  setting: SliderSettingDefinition;
  /** Current value */
  value: number;
  /** Change handler */
  onChange: (value: number) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Show tick marks */
  showTicks?: boolean;
  /** Variant style */
  variant?: "default" | "compact" | "large";
  /** Optional className */
  className?: string;
}

/**
 * Slider Control
 *
 * Renders a polished slider input with gradient fill, smooth animations,
 * and optional value display.
 *
 * @example
 * ```tsx
 * <SliderControl
 *   setting={{
 *     id: 'audio.master',
 *     type: 'slider',
 *     label: 'Master Volume',
 *     defaultValue: 80,
 *     min: 0,
 *     max: 100,
 *     step: 1,
 *     unit: '%',
 *     showValue: true,
 *   }}
 *   value={80}
 *   onChange={(value) => console.log(value)}
 * />
 * ```
 */
export const SliderControl = memo(function SliderControl({
  setting,
  value,
  onChange,
  disabled = false,
  showTicks = false,
  variant = "default",
  className,
}: SliderControlProps): React.ReactElement {
  const theme = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const percentage =
    ((value - setting.min) / (setting.max - setting.min)) * 100;

  // Variant-based sizing
  const sizes = {
    compact: { height: 16, trackHeight: 3, thumbSize: 10 },
    default: { height: 24, trackHeight: 5, thumbSize: 14 },
    large: { height: 32, trackHeight: 6, thumbSize: 18 },
  };
  const size = sizes[variant];

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      onChange(newValue);
    },
    [onChange],
  );

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    opacity: disabled ? 0.4 : 1,
    pointerEvents: disabled ? "none" : "auto",
    transition: "opacity 150ms ease",
  };

  const sliderContainerStyle: React.CSSProperties = {
    flex: 1,
    position: "relative",
    height: size.height,
    display: "flex",
    alignItems: "center",
  };

  // Track with subtle inner shadow for depth
  const trackStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    height: size.trackHeight,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: size.trackHeight / 2,
    overflow: "hidden",
    boxShadow: `inset 0 1px 2px rgba(0, 0, 0, 0.3)`,
  };

  // Gradient fill for more visual interest
  const fillStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: `${percentage}%`,
    background: `linear-gradient(90deg, ${theme.colors.accent.primary} 0%, ${theme.colors.accent.hover} 100%)`,
    borderRadius: size.trackHeight / 2,
    transition: isDragging ? "none" : "width 100ms ease-out",
    boxShadow: isHovered ? `0 0 8px ${theme.colors.accent.primary}40` : "none",
  };

  const inputStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    width: "100%",
    height: "100%",
    margin: 0,
    padding: 0,
    opacity: 0,
    cursor: disabled ? "not-allowed" : "pointer",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  // Enhanced thumb with glow effect
  const thumbStyle: React.CSSProperties = {
    position: "absolute",
    left: `calc(${percentage}% - ${size.thumbSize / 2}px)`,
    width: size.thumbSize,
    height: size.thumbSize,
    backgroundColor: theme.colors.text.primary,
    borderRadius: "50%",
    boxShadow: isDragging
      ? `0 0 0 3px ${theme.colors.accent.primary}40, ${theme.shadows.md}`
      : isHovered
        ? `0 0 0 2px ${theme.colors.accent.primary}30, ${theme.shadows.sm}`
        : theme.shadows.sm,
    pointerEvents: "none",
    transition: isDragging ? "none" : "all 150ms ease-out",
    transform: isDragging
      ? "scale(1.15)"
      : isHovered
        ? "scale(1.05)"
        : "scale(1)",
  };

  const valueStyle: React.CSSProperties = {
    minWidth: 48,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    textAlign: "center",
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.fontFamily.mono,
    fontWeight: theme.typography.fontWeight.medium,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    border: `1px solid ${theme.colors.border.default}`,
    transition: "all 150ms ease",
  };

  // Generate tick marks if enabled
  const renderTicks = () => {
    if (!showTicks) return null;
    const tickCount = 5;
    const ticks: React.ReactElement[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const tickPercent = (i / tickCount) * 100;
      ticks.push(
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${tickPercent}%`,
            bottom: -8,
            width: 1,
            height: 4,
            backgroundColor: theme.colors.border.default,
            transform: "translateX(-50%)",
          }}
        />,
      );
    }
    return ticks;
  };

  return (
    <div className={className} style={containerStyle}>
      <div
        style={sliderContainerStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div ref={trackRef} style={trackStyle}>
          <div style={fillStyle} />
        </div>
        <div style={thumbStyle} />
        {renderTicks()}
        <input
          type="range"
          min={setting.min}
          max={setting.max}
          step={setting.step}
          value={value}
          onChange={handleChange}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          disabled={disabled}
          style={inputStyle}
          aria-label={setting.label}
          aria-valuemin={setting.min}
          aria-valuemax={setting.max}
          aria-valuenow={value}
        />
      </div>
      {setting.showValue && (
        <span style={valueStyle}>
          {value}
          {setting.unit && setting.unit}
        </span>
      )}
    </div>
  );
});
