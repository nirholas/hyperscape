/**
 * Accessibility Panel Component
 *
 * UI panel for managing accessibility settings including colorblind modes,
 * high contrast, reduced motion, font size, and keyboard navigation.
 *
 * @packageDocumentation
 */

import React from "react";
import { useAccessibilityStore } from "../stores/accessibilityStore";
import { useTheme } from "../stores/themeStore";
import type { ColorblindMode, FontSizeOption } from "../types/accessibility";

/** Props for AccessibilityPanel */
export interface AccessibilityPanelProps {
  /** Optional className for custom styling */
  className?: string;
  /** Whether to show section headers */
  showHeaders?: boolean;
  /** Compact mode for smaller panels */
  compact?: boolean;
}

/** Colorblind mode option labels */
const COLORBLIND_LABELS: Record<ColorblindMode, string> = {
  none: "None",
  protanopia: "Protanopia (Red-Blind)",
  deuteranopia: "Deuteranopia (Green-Blind)",
  tritanopia: "Tritanopia (Blue-Blind)",
};

/** Font size option labels */
const FONT_SIZE_LABELS: Record<FontSizeOption, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  xlarge: "Extra Large",
};

/** Toggle switch component */
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: theme.spacing.sm,
        cursor: "pointer",
        padding: `${theme.spacing.xs}px 0`,
      }}
    >
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        tabIndex={0}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          backgroundColor: checked
            ? theme.colors.accent.primary
            : theme.colors.background.tertiary,
          position: "relative",
          transition: theme.transitions.fast,
          flexShrink: 0,
          marginTop: 2,
          border: `1px solid ${checked ? theme.colors.accent.primary : theme.colors.border.default}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundColor: theme.colors.text.primary,
            transition: theme.transitions.fast,
          }}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            color: theme.colors.text.primary,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.medium,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              color: theme.colors.text.muted,
              fontSize: theme.typography.fontSize.xs,
              marginTop: 2,
            }}
          >
            {description}
          </div>
        )}
      </div>
    </label>
  );
}

/** Select dropdown component */
function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Record<T, string>;
  label: string;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <div style={{ marginBottom: theme.spacing.sm }}>
      <label
        style={{
          display: "block",
          color: theme.colors.text.secondary,
          fontSize: theme.typography.fontSize.xs,
          marginBottom: theme.spacing.xs,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          width: "100%",
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          backgroundColor: theme.colors.background.secondary,
          color: theme.colors.text.primary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: theme.borderRadius.md,
          fontSize: theme.typography.fontSize.sm,
          cursor: "pointer",
          outline: "none",
        }}
      >
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>
            {options[key]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Section header component */
function SectionHeader({ title }: { title: string }): React.ReactElement {
  const theme = useTheme();

  return (
    <div
      style={{
        color: theme.colors.text.accent,
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.semibold,
        textTransform: "uppercase",
        letterSpacing: "1px",
        marginBottom: theme.spacing.sm,
        marginTop: theme.spacing.md,
        paddingBottom: theme.spacing.xs,
        borderBottom: `1px solid ${theme.colors.border.default}`,
      }}
    >
      {title}
    </div>
  );
}

/**
 * Accessibility Panel
 *
 * Provides UI controls for all accessibility settings.
 *
 * @example
 * ```tsx
 * <AccessibilityPanel />
 * ```
 */
export function AccessibilityPanel({
  className,
  showHeaders = true,
  compact = false,
}: AccessibilityPanelProps): React.ReactElement {
  const theme = useTheme();
  const {
    colorblindMode,
    highContrast,
    reducedMotion,
    fontSize,
    keyboardNavigation,
    setColorblindMode,
    setHighContrast,
    setReducedMotion,
    setFontSize,
    setKeyboardNavigation,
    resetToDefaults,
  } = useAccessibilityStore();

  const containerStyle: React.CSSProperties = {
    padding: compact ? theme.spacing.sm : theme.spacing.md,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily.body,
  };

  return (
    <div className={className} style={containerStyle}>
      {showHeaders && <SectionHeader title="Vision" />}

      <Select
        value={colorblindMode}
        onChange={setColorblindMode}
        options={COLORBLIND_LABELS}
        label="Colorblind Mode"
      />

      <Toggle
        checked={highContrast}
        onChange={setHighContrast}
        label="High Contrast"
        description="Increases contrast for better visibility"
      />

      {showHeaders && <SectionHeader title="Motion" />}

      <Toggle
        checked={reducedMotion}
        onChange={setReducedMotion}
        label="Reduced Motion"
        description="Minimizes animations and transitions"
      />

      {showHeaders && <SectionHeader title="Text" />}

      <Select
        value={fontSize}
        onChange={setFontSize}
        options={FONT_SIZE_LABELS}
        label="Font Size"
      />

      {showHeaders && <SectionHeader title="Navigation" />}

      <Toggle
        checked={keyboardNavigation}
        onChange={setKeyboardNavigation}
        label="Keyboard Navigation"
        description="Enhanced focus indicators for keyboard users"
      />

      {/* Reset button */}
      <div
        style={{
          marginTop: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          borderTop: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <button
          onClick={resetToDefaults}
          style={{
            width: "100%",
            padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
            backgroundColor: "transparent",
            color: theme.colors.text.muted,
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: theme.borderRadius.md,
            fontSize: theme.typography.fontSize.sm,
            cursor: "pointer",
            transition: theme.transitions.fast,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              theme.colors.background.tertiary;
            e.currentTarget.style.color = theme.colors.text.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = theme.colors.text.muted;
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
