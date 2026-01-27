/**
 * ChatPanel - A window-based chat panel for the UI system
 *
 * Features:
 * - Scrollable message history with colored timestamps
 * - Different colors for message types (system, player, activity, etc.)
 * - Input field for sending messages
 * - Tab support (All, Game, Clan, etc.)
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useThemeStore, useMobileLayout } from "@/ui";
import type { ClientWorld } from "../../types";
import { COLORS, MOBILE_CHAT } from "../../constants";

interface ChatMessage {
  id: string;
  from: string;
  fromId?: string;
  body: string;
  createdAt: string;
  timestamp?: number;
  /**
   * Message type - aligns with server types:
   * - chat: Normal player messages
   * - system: System messages
   * - activity: Login/logout events
   * - warning: Warning messages
   * - news: News/event announcements
   * - trade: Trade channel messages
   * - trade_request: OSRS-style clickable trade request
   * - duel_challenge: OSRS-style clickable duel challenge
   * - private: Private/whisper messages
   * - clan/guild: Clan chat messages
   */
  type?:
    | "chat"
    | "system"
    | "activity"
    | "warning"
    | "news"
    | "trade"
    | "trade_request"
    | "duel_challenge"
    | "private"
    | "clan"
    | "guild";
  /** Trade ID for trade_request messages */
  tradeId?: string;
  /** Challenge ID for duel_challenge messages */
  challengeId?: string;
  /** Channel for filtering (e.g., "clan", "guild", "private") */
  channel?: string;
}

interface ChatPanelProps {
  world: ClientWorld;
}

type ChatWorld = ClientWorld & {
  chat: {
    subscribe: (callback: (msgs: ChatMessage[]) => void) => () => void;
    send: (message: string) => void;
    command: (command: string) => void;
  };
  controls?: {
    bind?: (options: { priority?: number }) => {
      enter?: { onPress?: () => void | boolean | null };
      release?: () => void;
    };
  };
  network?: {
    send?: (method: string, payload?: Record<string, unknown>) => void;
  };
};

// Color scheme for different message types
const MESSAGE_COLORS = {
  timestamp: COLORS.TEXT_MUTED,
  player: COLORS.INFO, // Blue for player names
  system: COLORS.WARNING, // Orange for system messages
  activity: COLORS.SUCCESS, // Green for activity (logins, etc.)
  warning: COLORS.ERROR, // Red for warnings
  news: "#a855f7", // Purple for news/events (no exact match in COLORS)
  trade_request: "#FF00FF", // Pink/magenta for trade requests (OSRS-style)
  duel_challenge: "#FF4444", // Red for duel challenges
  default: COLORS.TEXT_PRIMARY,
};

export function ChatPanel({ world }: ChatPanelProps): React.ReactElement {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  const chatWorld = world as ChatWorld;
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [activeTab, setActiveTab] = useState<
    "all" | "game" | "clan" | "private"
  >("all");
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Subscribe to chat messages
  useEffect(() => {
    if (!chatWorld.chat?.subscribe) return;

    const unsubscribe = chatWorld.chat.subscribe((msgs) => {
      setMessages(msgs as ChatMessage[]);
    });

    return () => unsubscribe();
  }, [chatWorld]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle sending messages
  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;

    if (inputValue.startsWith("/")) {
      chatWorld.chat?.command?.(inputValue);
    } else {
      chatWorld.chat?.send?.(inputValue);
    }

    setInputValue("");
  }, [inputValue, chatWorld]);

  // Handle key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSend();
      } else if (e.key === "Escape") {
        inputRef.current?.blur();
      }
    },
    [handleSend],
  );

  // Format timestamp
  const formatTime = (msg: ChatMessage): string => {
    if (msg.timestamp) {
      const date = new Date(msg.timestamp);
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    if (msg.createdAt) {
      const date = new Date(msg.createdAt);
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return "";
  };

  // Determine message type from content
  const getMessageType = (msg: ChatMessage): ChatMessage["type"] => {
    if (msg.type) return msg.type;

    const body = msg.body.toLowerCase();
    if (
      body.includes("logged in") ||
      body.includes("logged out") ||
      body.includes("has appeared")
    ) {
      return "activity";
    }
    if (
      body.includes("news:") ||
      body.includes("event:") ||
      body.includes("flash")
    ) {
      return "news";
    }
    if (body.includes("warning") || body.includes("error")) {
      return "warning";
    }
    if (msg.from === "System" || msg.from === "Server" || !msg.from) {
      return "system";
    }
    return "chat";
  };

  // Get color for message type
  const getMessageColor = (type: ChatMessage["type"]): string => {
    switch (type) {
      case "activity":
        return MESSAGE_COLORS.activity;
      case "system":
        return MESSAGE_COLORS.system;
      case "warning":
        return MESSAGE_COLORS.warning;
      case "news":
        return MESSAGE_COLORS.news;
      case "trade":
      case "trade_request":
        return MESSAGE_COLORS.trade_request;
      case "duel_challenge":
        return MESSAGE_COLORS.duel_challenge;
      case "private":
        return "#ff66ff"; // Pink for private messages
      case "clan":
      case "guild":
        return "#66ff66"; // Green for clan/guild messages
      default:
        return MESSAGE_COLORS.default;
    }
  };

  // Filter messages based on active tab
  const filterMessagesByTab = useCallback(
    (msg: ChatMessage): boolean => {
      const msgType = getMessageType(msg);
      // Also check the raw type from server (may differ from inferred type)
      const serverType = msg.type;
      const channel = msg.channel?.toLowerCase();

      switch (activeTab) {
        case "all":
          return true;

        case "game":
          // Game tab shows regular chat, system, activity, news, warning, and trade messages
          // Excludes clan/guild and private messages
          // Check both inferred type and server type
          if (
            serverType === "private" ||
            serverType === "clan" ||
            serverType === "guild" ||
            channel === "clan" ||
            channel === "guild" ||
            channel === "private"
          ) {
            return false;
          }
          return (
            msgType === "chat" ||
            msgType === "system" ||
            msgType === "activity" ||
            msgType === "news" ||
            msgType === "warning" ||
            msgType === "trade_request" ||
            serverType === "trade"
          );

        case "clan":
          // Clan tab - filter by clan/guild messages
          // Check server type, channel, and content patterns
          return (
            serverType === "clan" ||
            serverType === "guild" ||
            channel === "clan" ||
            channel === "guild" ||
            msg.from?.toLowerCase().includes("[clan]") ||
            msg.body?.toLowerCase().includes("[clan]") ||
            msg.from?.toLowerCase().includes("[guild]") ||
            msg.body?.toLowerCase().includes("[guild]")
          );

        case "private":
          // Private tab - filter for private/whisper messages
          // Check server type, channel, and content patterns
          return (
            serverType === "private" ||
            channel === "private" ||
            channel === "whisper" ||
            msg.from?.toLowerCase().includes("[pm]") ||
            msg.body?.toLowerCase().includes("[pm]") ||
            msg.from?.toLowerCase().includes("[whisper]") ||
            msg.body?.toLowerCase().includes("[whisper]")
          );

        default:
          return true;
      }
    },
    [activeTab],
  );

  // Get filtered messages based on active tab
  const filteredMessages = messages.filter(filterMessagesByTab);

  // Handle clicking on a trade request message
  const handleTradeRequestClick = useCallback(
    (tradeId: string) => {
      // Send trade acceptance to server
      if (chatWorld.network?.send) {
        chatWorld.network.send("tradeRequestRespond", {
          tradeId,
          accept: true,
        });
      }
    },
    [chatWorld],
  );

  // Handle clicking on a duel challenge message
  const handleDuelChallengeClick = useCallback(
    (challengeId: string) => {
      // Send duel acceptance to server
      if (chatWorld.network?.send) {
        chatWorld.network.send("duel:challenge:respond", {
          challengeId,
          accept: true,
        });
      }
    },
    [chatWorld],
  );

  const tabs = [
    { id: "all" as const, icon: "📢", title: "All Messages" },
    { id: "game" as const, icon: "🎮", title: "Game Messages" },
    { id: "clan" as const, icon: "👥", title: "Clan Chat" },
    { id: "private" as const, icon: "💬", title: "Private Messages" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: theme.colors.background.panelPrimary,
        color: theme.colors.text.primary,
        fontFamily: theme.typography.fontFamily.body,
        fontSize: parseInt(theme.typography.fontSize.sm),
      }}
    >
      {/* Tab Bar - Mobile: compact icon-only, Desktop: larger with padding */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: `1px solid ${theme.colors.border.default}`,
          padding: `0 ${theme.spacing.xs}px`,
          flexShrink: 0,
          // Mobile: compact height
          height: shouldUseMobileUI ? MOBILE_CHAT.tabBarHeight : "auto",
          alignItems: "center",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.title}
            aria-label={tab.title}
            aria-pressed={activeTab === tab.id}
            style={{
              // Mobile: compact square buttons, Desktop: padded
              padding: shouldUseMobileUI
                ? `${theme.spacing.xs}px`
                : `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              width: shouldUseMobileUI ? MOBILE_CHAT.tabButtonSize : "auto",
              height: shouldUseMobileUI ? MOBILE_CHAT.tabButtonSize : "auto",
              background:
                activeTab === tab.id ? theme.colors.slot.hover : "transparent",
              border: "none",
              borderBottom:
                activeTab === tab.id
                  ? `2px solid ${theme.colors.accent.primary}`
                  : "2px solid transparent",
              fontSize: shouldUseMobileUI
                ? parseInt(theme.typography.fontSize.lg)
                : parseInt(theme.typography.fontSize.base),
              cursor: "pointer",
              transition: theme.transitions.fast,
              opacity: activeTab === tab.id ? 1 : 0.6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "manipulation",
            }}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Messages Area */}
      <div
        ref={messagesRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
        className="scrollbar-thin"
      >
        {filteredMessages.map((msg) => {
          const msgType = getMessageType(msg);
          const msgColor = getMessageColor(msgType);
          const time = formatTime(msg);
          const isTradeRequest = msgType === "trade_request" && msg.tradeId;
          const isDuelChallenge =
            msgType === "duel_challenge" && msg.challengeId;
          const isClickable = isTradeRequest || isDuelChallenge;

          const handleClick = isTradeRequest
            ? () => handleTradeRequestClick(msg.tradeId!)
            : isDuelChallenge
              ? () => handleDuelChallengeClick(msg.challengeId!)
              : undefined;

          const clickTitle = isTradeRequest
            ? "Click to accept trade request"
            : isDuelChallenge
              ? "Click to accept duel challenge"
              : undefined;

          return (
            <div
              key={msg.id}
              onClick={handleClick}
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                wordBreak: "break-word",
                overflowWrap: "break-word",
                whiteSpace: "pre-wrap",
                cursor: isClickable ? "pointer" : "default",
                textDecoration: isClickable ? "underline" : "none",
              }}
              title={clickTitle}
            >
              {/* Timestamp */}
              {time && (
                <span
                  style={{ color: MESSAGE_COLORS.timestamp, marginRight: 6 }}
                >
                  [{time}]
                </span>
              )}

              {/* Username (for chat messages) */}
              {msg.from && msgType === "chat" && (
                <span
                  style={{
                    color: MESSAGE_COLORS.player,
                    fontWeight: 600,
                    marginRight: 4,
                  }}
                >
                  {msg.from}:
                </span>
              )}

              {/* Message body */}
              <span style={{ color: msgColor }}>
                {msgType !== "chat" &&
                  msgType !== "trade_request" &&
                  msgType !== "duel_challenge" &&
                  msg.from && (
                    <span style={{ fontWeight: 600 }}>{msg.from}: </span>
                  )}
                {msg.body}
              </span>
            </div>
          );
        })}

        {filteredMessages.length === 0 && (
          <div
            style={{
              color: theme.colors.text.muted,
              fontStyle: "italic",
              padding: `${theme.spacing.lg}px 0`,
              textAlign: "center",
            }}
          >
            {activeTab === "all"
              ? "No messages yet..."
              : activeTab === "game"
                ? "No game messages..."
                : activeTab === "clan"
                  ? "No clan messages..."
                  : activeTab === "private"
                    ? "No private messages..."
                    : "No messages yet..."}
          </div>
        )}
      </div>

      {/* Input Area - minimal design for more space */}
      <div
        style={{
          borderTop: `1px solid ${theme.colors.border.default}`,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          flexShrink: 0,
          display: "flex",
          gap: theme.spacing.xs,
          alignItems: "center",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          placeholder="Type a message..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            borderBottom: isInputFocused
              ? `1px solid ${theme.colors.border.focus}`
              : `1px solid transparent`,
            padding: `${theme.spacing.xs}px 0`,
            color: theme.colors.text.primary,
            fontSize: parseInt(theme.typography.fontSize.sm),
            outline: "none",
            transition: theme.transitions.fast,
            minHeight: shouldUseMobileUI ? 32 : 28,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim()}
          title="Send message"
          aria-label="Send message"
          style={{
            padding: 0,
            background: "transparent",
            border: "none",
            fontSize: shouldUseMobileUI ? 22 : 20,
            cursor: inputValue.trim() ? "pointer" : "default",
            transition: theme.transitions.fast,
            opacity: inputValue.trim() ? 1 : 0.3,
            color: inputValue.trim()
              ? theme.colors.accent.primary
              : theme.colors.text.muted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
