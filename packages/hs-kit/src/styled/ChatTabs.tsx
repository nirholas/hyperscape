/**
 * Chat channel tabs component
 * @packageDocumentation
 */

import React, { useCallback } from "react";
import { useTheme } from "../stores/themeStore";
import type { UseChatFiltersResult } from "../core/chat/useChatFilters";
import type { ChatMessageType } from "../core/chat/useChatState";

/** Props for ChatTabs component */
export interface ChatTabsProps {
  /** Chat filters hook result */
  chatFilters: UseChatFiltersResult;
  /** Unread counts per channel */
  unreadCounts?: Record<ChatMessageType, number>;
  /** Whether to show "All" tab */
  showAllTab?: boolean;
  /** Whether to show unread badges */
  showBadges?: boolean;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
  /** Callback when tab is clicked */
  onTabClick?: (channel: ChatMessageType | null) => void;
}

/**
 * Chat channel tabs component
 *
 * @example
 * ```tsx
 * function MyChatTabs() {
 *   const chatFilters = useChatFilters();
 *   const { unreadCounts } = useChatState();
 *
 *   return (
 *     <ChatTabs
 *       chatFilters={chatFilters}
 *       unreadCounts={unreadCounts}
 *       showBadges
 *     />
 *   );
 * }
 * ```
 */
export function ChatTabs({
  chatFilters,
  unreadCounts = {
    system: 0,
    player: 0,
    npc: 0,
    guild: 0,
    trade: 0,
    whisper: 0,
  },
  showAllTab = true,
  showBadges = true,
  className,
  style,
  onTabClick,
}: ChatTabsProps): React.ReactElement {
  const theme = useTheme();

  const {
    channels,
    activeChannels,
    setActiveChannel,
    isChannelActive,
    multiSelect,
    toggleChannel,
  } = chatFilters;

  // Check if "All" is active (no specific filter)
  const isAllActive = activeChannels === null;

  const handleTabClick = useCallback(
    (channel: ChatMessageType | null) => {
      if (channel === null) {
        setActiveChannel(null);
      } else if (multiSelect) {
        toggleChannel(channel);
      } else {
        setActiveChannel(channel);
      }
      onTabClick?.(channel);
    },
    [setActiveChannel, toggleChannel, multiSelect, onTabClick],
  );

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    overflowX: "auto",
    scrollbarWidth: "none",
    ...style,
  };

  const getTabStyle = (
    isActive: boolean,
    color: string,
  ): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: isActive
      ? theme.colors.background.tertiary
      : "transparent",
    border: "none",
    borderRadius: theme.borderRadius.sm,
    color: isActive ? color : theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: isActive
      ? theme.typography.fontWeight.semibold
      : theme.typography.fontWeight.normal,
    cursor: "pointer",
    transition: theme.transitions.fast,
    flexShrink: 0,
    position: "relative" as const,
  });

  const badgeStyle: React.CSSProperties = {
    minWidth: 16,
    height: 16,
    padding: "0 4px",
    backgroundColor: theme.colors.state.danger,
    borderRadius: theme.borderRadius.full,
    color: theme.colors.text.primary,
    fontSize: "10px",
    fontWeight: theme.typography.fontWeight.bold,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Filter to only visible channels
  const visibleChannels = channels.filter((c) => c.visible);

  return (
    <div
      className={className}
      style={containerStyle}
      role="tablist"
      aria-label="Chat channels"
    >
      {/* All tab */}
      {showAllTab && (
        <button
          style={getTabStyle(isAllActive, theme.colors.text.primary)}
          onClick={() => handleTabClick(null)}
          onMouseEnter={(e) => {
            if (!isAllActive) {
              (e.target as HTMLElement).style.color =
                theme.colors.text.secondary;
              (e.target as HTMLElement).style.backgroundColor =
                theme.colors.background.tertiary;
            }
          }}
          onMouseLeave={(e) => {
            if (!isAllActive) {
              (e.target as HTMLElement).style.color = theme.colors.text.muted;
              (e.target as HTMLElement).style.backgroundColor = "transparent";
            }
          }}
          role="tab"
          aria-selected={isAllActive}
          tabIndex={isAllActive ? 0 : -1}
        >
          All
        </button>
      )}

      {/* Channel tabs */}
      {visibleChannels.map((channel) => {
        const isActive = !isAllActive && isChannelActive(channel.type);
        const unread = unreadCounts[channel.type] || 0;

        return (
          <button
            key={channel.type}
            style={getTabStyle(isActive, channel.color)}
            onClick={() => handleTabClick(channel.type)}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.target as HTMLElement).style.color = channel.color;
                (e.target as HTMLElement).style.backgroundColor =
                  theme.colors.background.tertiary;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.target as HTMLElement).style.color = theme.colors.text.muted;
                (e.target as HTMLElement).style.backgroundColor = "transparent";
              }
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            aria-label={`${channel.label}${unread > 0 ? `, ${unread} unread` : ""}`}
          >
            {channel.label}
            {showBadges && unread > 0 && (
              <span style={badgeStyle}>{unread > 99 ? "99+" : unread}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
