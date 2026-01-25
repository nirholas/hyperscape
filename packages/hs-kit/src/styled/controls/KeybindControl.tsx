/**
 * Keybind Control Component
 *
 * A keybind capture input for keyboard shortcuts.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../stores/themeStore";
import type { KeybindSettingDefinition } from "../../core/settings/settingsSchema";

/** Props for KeybindControl */
export interface KeybindControlProps {
  /** Setting definition */
  setting: KeybindSettingDefinition;
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** Optional className */
  className?: string;
  /** Callback when listening state changes */
  onListeningChange?: (isListening: boolean) => void;
}

/**
 * Format a key event into a readable keybind string
 */
function formatKeybind(e: KeyboardEvent, allowModifiers: boolean): string {
  const parts: string[] = [];

  if (allowModifiers) {
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
  }

  // Get the key name
  let key = e.key;

  // Handle special keys
  switch (key) {
    case " ":
      key = "Space";
      break;
    case "ArrowUp":
      key = "Up";
      break;
    case "ArrowDown":
      key = "Down";
      break;
    case "ArrowLeft":
      key = "Left";
      break;
    case "ArrowRight":
      key = "Right";
      break;
    case "Escape":
      key = "Esc";
      break;
    case "Control":
    case "Alt":
    case "Shift":
    case "Meta":
      // Modifier-only presses - return empty if we already captured them
      if (allowModifiers && parts.length > 0) {
        return "";
      }
      break;
    default:
      // Capitalize single letters
      if (key.length === 1) {
        key = key.toUpperCase();
      }
  }

  // Don't add duplicate modifiers
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
    parts.push(key);
  }

  return parts.join("+");
}

/**
 * Keybind Control
 *
 * Renders a keybind input that captures keyboard shortcuts.
 *
 * @example
 * ```tsx
 * <KeybindControl
 *   setting={{
 *     id: 'controls.keyMoveForward',
 *     type: 'keybind',
 *     label: 'Move Forward',
 *     defaultValue: 'W',
 *     allowModifiers: false,
 *     isRebindable: true,
 *   }}
 *   value="W"
 *   onChange={(value) => console.log(value)}
 * />
 * ```
 */
export const KeybindControl = memo(function KeybindControl({
  setting,
  value,
  onChange,
  disabled = false,
  className,
  onListeningChange,
}: KeybindControlProps): React.ReactElement {
  const theme = useTheme();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isListening, setIsListening] = useState(false);

  const isRebindable = setting.isRebindable ?? true;
  const isDisabled = disabled || !isRebindable;

  // Handle click to start listening
  const handleClick = useCallback(() => {
    if (!isDisabled) {
      setIsListening(true);
      onListeningChange?.(true);
    }
  }, [isDisabled, onListeningChange]);

  // Handle key capture
  useEffect(() => {
    if (!isListening) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.key === "Escape") {
        setIsListening(false);
        onListeningChange?.(false);
        return;
      }

      const keybind = formatKeybind(e, setting.allowModifiers ?? true);
      if (keybind) {
        onChange(keybind);
        setIsListening(false);
        onListeningChange?.(false);
      }
    };

    const handleBlur = () => {
      setIsListening(false);
      onListeningChange?.(false);
    };

    // Focus the button when listening
    buttonRef.current?.focus();

    window.addEventListener("keydown", handleKeyDown, true);
    buttonRef.current?.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      buttonRef.current?.removeEventListener("blur", handleBlur);
    };
  }, [isListening, onChange, setting.allowModifiers, onListeningChange]);

  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: isListening
      ? theme.colors.accent.primary
      : theme.colors.background.secondary,
    color: isListening
      ? theme.colors.background.primary
      : theme.colors.text.primary,
    border: `1px solid ${
      isListening ? theme.colors.accent.primary : theme.colors.border.default
    }`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.fontFamily.mono,
    cursor: isDisabled ? "not-allowed" : "pointer",
    outline: "none",
    opacity: isDisabled ? 0.5 : 1,
    transition: theme.transitions.fast,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  const displayValue = isListening ? "Press a key..." : value || "Unbound";

  return (
    <button
      ref={buttonRef}
      className={className}
      onClick={handleClick}
      disabled={isDisabled}
      style={buttonStyle}
      aria-label={`${setting.label}: ${value || "Unbound"}. ${
        isListening ? "Listening for key input" : "Click to change"
      }`}
      aria-pressed={isListening}
    >
      {displayValue}
    </button>
  );
});

/**
 * Clear keybind button
 */
export const KeybindClearButton = memo(function KeybindClearButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const theme = useTheme();

  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: `${theme.spacing.xs}px`,
    backgroundColor: "transparent",
    color: theme.colors.text.muted,
    border: "none",
    borderRadius: theme.borderRadius.sm,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: theme.transitions.fast,
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={buttonStyle}
      aria-label="Clear keybind"
      title="Clear keybind"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
});
