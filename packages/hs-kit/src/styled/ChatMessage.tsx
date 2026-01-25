/**
 * Individual chat message component
 * @packageDocumentation
 */

import React, { memo, useMemo, useCallback } from "react";
import { useTheme } from "../stores/themeStore";
import type {
  ChatMessage as ChatMessageData,
  ChatMessageType,
  UserRole,
} from "../core/chat/useChatState";
import type { Theme } from "./themes";

/** Props for ChatMessage component */
export interface ChatMessageProps {
  /** Message data */
  message: ChatMessageData;
  /** Whether to show timestamp */
  showTimestamp?: boolean;
  /** Timestamp format ('short' | 'long') */
  timestampFormat?: "short" | "long";
  /** Callback when username is clicked */
  onUsernameClick?: (username: string) => void;
  /** Callback when link is clicked */
  onLinkClick?: (url: string) => void;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/** Get color for message type */
function getMessageTypeColor(type: ChatMessageType, theme: Theme): string {
  switch (type) {
    case "system":
      return theme.colors.state.warning;
    case "npc":
      return "#99ccff";
    case "guild":
      return theme.colors.state.success;
    case "trade":
      return "#ff9966";
    case "whisper":
      return "#ff66ff";
    case "player":
    default:
      return theme.colors.text.primary;
  }
}

/** Get color for user role */
function getRoleColor(role: UserRole, theme: Theme): string {
  switch (role) {
    case "admin":
      return "#ff4444";
    case "moderator":
      return "#44ff44";
    case "developer":
      return "#ff8800";
    case "vip":
      return theme.colors.accent.primary;
    case "premium":
      return theme.colors.accent.secondary;
    case "default":
    default:
      return theme.colors.text.primary;
  }
}

/** Format timestamp */
function formatTimestamp(timestamp: number, format: "short" | "long"): string {
  const date = new Date(timestamp);
  if (format === "short") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** URL pattern for link detection */
const URL_PATTERN =
  /(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi;

/** Parse content and convert links to clickable elements */
function parseContent(
  content: string,
  onLinkClick?: (url: string) => void,
  linkStyle?: React.CSSProperties,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(URL_PATTERN);

  while ((match = regex.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    // Add the link
    const url = match[0];
    const href = url.startsWith("www.") ? `https://${url}` : url;
    parts.push(
      <a
        key={`link-${match.index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
        onClick={(e) => {
          if (onLinkClick) {
            e.preventDefault();
            onLinkClick(href);
          }
        }}
      >
        {url}
      </a>,
    );

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [content];
}

/**
 * Individual chat message component
 *
 * @example
 * ```tsx
 * <ChatMessage
 *   message={{
 *     id: '1',
 *     type: 'player',
 *     username: 'Player1',
 *     role: 'default',
 *     content: 'Hello world!',
 *     timestamp: Date.now(),
 *     hasLinks: false,
 *     hasEmojis: false
 *   }}
 *   showTimestamp
 *   onUsernameClick={(name) => console.log('Clicked:', name)}
 * />
 * ```
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  showTimestamp = true,
  timestampFormat = "short",
  onUsernameClick,
  onLinkClick,
  className,
  style,
}: ChatMessageProps): React.ReactElement {
  const theme = useTheme();

  const messageColor = useMemo(
    () => getMessageTypeColor(message.type, theme),
    [message.type, theme],
  );

  const usernameColor = useMemo(
    () => getRoleColor(message.role, theme),
    [message.role, theme],
  );

  const handleUsernameClick = useCallback(() => {
    if (onUsernameClick && message.username) {
      onUsernameClick(message.username);
    }
  }, [onUsernameClick, message.username]);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: theme.typography.lineHeight.normal,
    color: messageColor,
    wordBreak: "break-word",
    ...style,
  };

  const timestampStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    flexShrink: 0,
    minWidth: timestampFormat === "long" ? 65 : 45,
  };

  const usernameStyle: React.CSSProperties = {
    color: usernameColor,
    fontWeight: theme.typography.fontWeight.semibold,
    cursor: onUsernameClick ? "pointer" : "default",
    flexShrink: 0,
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    color: messageColor,
  };

  const linkStyle: React.CSSProperties = {
    color: theme.colors.text.link,
    textDecoration: "underline",
    cursor: "pointer",
  };

  const prefixStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
  };

  // Render system message
  if (message.type === "system") {
    return (
      <div className={className} style={containerStyle}>
        {showTimestamp && (
          <span style={timestampStyle}>
            [{formatTimestamp(message.timestamp, timestampFormat)}]
          </span>
        )}
        <span
          style={{ color: theme.colors.state.warning, fontStyle: "italic" }}
        >
          {parseContent(message.content, onLinkClick, linkStyle)}
        </span>
      </div>
    );
  }

  // Render NPC message
  if (message.type === "npc") {
    return (
      <div className={className} style={containerStyle}>
        {showTimestamp && (
          <span style={timestampStyle}>
            [{formatTimestamp(message.timestamp, timestampFormat)}]
          </span>
        )}
        <span style={usernameStyle}>{message.username}:</span>
        <span style={contentStyle}>
          {parseContent(message.content, onLinkClick, linkStyle)}
        </span>
      </div>
    );
  }

  // Render whisper
  if (message.type === "whisper") {
    const prefix = message.targetUsername
      ? `To [${message.targetUsername}]`
      : `From [${message.username}]`;
    return (
      <div className={className} style={containerStyle}>
        {showTimestamp && (
          <span style={timestampStyle}>
            [{formatTimestamp(message.timestamp, timestampFormat)}]
          </span>
        )}
        <span style={prefixStyle}>{prefix}:</span>
        <span style={contentStyle}>
          {parseContent(message.content, onLinkClick, linkStyle)}
        </span>
      </div>
    );
  }

  // Render guild message
  if (message.type === "guild") {
    return (
      <div className={className} style={containerStyle}>
        {showTimestamp && (
          <span style={timestampStyle}>
            [{formatTimestamp(message.timestamp, timestampFormat)}]
          </span>
        )}
        <span style={prefixStyle}>[Guild]</span>
        <span
          style={usernameStyle}
          onClick={handleUsernameClick}
          role={onUsernameClick ? "button" : undefined}
          tabIndex={onUsernameClick ? 0 : undefined}
          onKeyDown={
            onUsernameClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleUsernameClick();
                  }
                }
              : undefined
          }
        >
          {message.username}:
        </span>
        <span style={contentStyle}>
          {parseContent(message.content, onLinkClick, linkStyle)}
        </span>
      </div>
    );
  }

  // Render trade message
  if (message.type === "trade") {
    return (
      <div className={className} style={containerStyle}>
        {showTimestamp && (
          <span style={timestampStyle}>
            [{formatTimestamp(message.timestamp, timestampFormat)}]
          </span>
        )}
        <span style={prefixStyle}>[Trade]</span>
        <span
          style={usernameStyle}
          onClick={handleUsernameClick}
          role={onUsernameClick ? "button" : undefined}
          tabIndex={onUsernameClick ? 0 : undefined}
          onKeyDown={
            onUsernameClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleUsernameClick();
                  }
                }
              : undefined
          }
        >
          {message.username}:
        </span>
        <span style={contentStyle}>
          {parseContent(message.content, onLinkClick, linkStyle)}
        </span>
      </div>
    );
  }

  // Render player message (default)
  return (
    <div className={className} style={containerStyle}>
      {showTimestamp && (
        <span style={timestampStyle}>
          [{formatTimestamp(message.timestamp, timestampFormat)}]
        </span>
      )}
      <span
        style={usernameStyle}
        onClick={handleUsernameClick}
        role={onUsernameClick ? "button" : undefined}
        tabIndex={onUsernameClick ? 0 : undefined}
        onKeyDown={
          onUsernameClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleUsernameClick();
                }
              }
            : undefined
        }
      >
        {message.username}:
      </span>
      <span style={contentStyle}>
        {parseContent(message.content, onLinkClick, linkStyle)}
      </span>
    </div>
  );
});
