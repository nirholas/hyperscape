/**
 * Chat input component with slash command support
 * @packageDocumentation
 */

import React, { memo, useRef, useEffect, useMemo } from "react";
import { useTheme } from "../stores/themeStore";
import type { UseChatInputResult } from "../core/chat/useChatInput";
import type { ChatMessageType } from "../core/chat/useChatState";

/** Props for ChatInput component */
export interface ChatInputProps {
  /** Chat input hook result */
  chatInput: UseChatInputResult;
  /** Whether input is focused */
  autoFocus?: boolean;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Show command suggestions */
  showSuggestions?: boolean;
  /** Show channel indicator */
  showChannel?: boolean;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
  /** Callback when input is focused */
  onFocus?: () => void;
  /** Callback when input is blurred */
  onBlur?: () => void;
}

/** Get channel color */
function getChannelColor(channel: ChatMessageType): string {
  switch (channel) {
    case "guild":
      return "#66ff66";
    case "trade":
      return "#ff9966";
    case "whisper":
      return "#ff66ff";
    case "player":
    default:
      return "#ffffff";
  }
}

/** Get channel display name */
function getChannelName(channel: ChatMessageType): string {
  switch (channel) {
    case "guild":
      return "Guild";
    case "trade":
      return "Trade";
    case "whisper":
      return "Whisper";
    case "player":
    default:
      return "Local";
  }
}

/**
 * Chat input component with command support
 *
 * @example
 * ```tsx
 * function MyChatInput() {
 *   const chatInput = useChatInput({
 *     currentUsername: 'Player1',
 *     onSend: (type, content, target) => {
 *       // Send message to server
 *     }
 *   });
 *
 *   return <ChatInput chatInput={chatInput} autoFocus />;
 * }
 * ```
 */
export const ChatInput = memo(function ChatInput({
  chatInput,
  autoFocus = false,
  disabled = false,
  showSuggestions = true,
  showChannel = true,
  className,
  style,
  onFocus,
  onBlur,
}: ChatInputProps): React.ReactElement {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  const { inputProps, channel, isCommand, suggestedCommand } = chatInput;

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const channelColor = useMemo(() => getChannelColor(channel), [channel]);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    borderTop: `1px solid ${theme.colors.border.default}`,
    position: "relative",
    ...style,
  };

  const channelIndicatorStyle: React.CSSProperties = {
    color: channelColor,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    padding: `2px ${theme.spacing.xs}px`,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    color: isCommand ? theme.colors.accent.primary : theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.fontFamily.body,
    padding: `${theme.spacing.xs}px 0`,
    width: "100%",
    minWidth: 0,
  };

  const suggestionStyle: React.CSSProperties = {
    position: "absolute",
    bottom: "100%",
    left: theme.spacing.sm,
    right: theme.spacing.sm,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    boxShadow: theme.shadows.md,
  };

  const suggestionNameStyle: React.CSSProperties = {
    color: theme.colors.accent.primary,
    fontWeight: theme.typography.fontWeight.semibold,
    fontSize: theme.typography.fontSize.sm,
  };

  const suggestionDescStyle: React.CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    marginTop: 2,
  };

  const suggestionUsageStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    fontFamily: theme.typography.fontFamily.mono,
    marginTop: 4,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Command suggestion popup */}
      {showSuggestions && isCommand && suggestedCommand && (
        <div style={suggestionStyle}>
          <div style={suggestionNameStyle}>/{suggestedCommand.name}</div>
          <div style={suggestionDescStyle}>{suggestedCommand.description}</div>
          <div style={suggestionUsageStyle}>{suggestedCommand.usage}</div>
        </div>
      )}

      {/* Channel indicator */}
      {showChannel && !isCommand && (
        <span style={channelIndicatorStyle}>{getChannelName(channel)}</span>
      )}

      {/* Command indicator */}
      {isCommand && (
        <span
          style={{
            ...channelIndicatorStyle,
            color: theme.colors.accent.primary,
          }}
        >
          CMD
        </span>
      )}

      {/* Input field */}
      <input
        ref={inputRef}
        {...inputProps}
        style={inputStyle}
        disabled={disabled}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label="Chat input"
        autoComplete="off"
        spellCheck="false"
      />
    </div>
  );
});
