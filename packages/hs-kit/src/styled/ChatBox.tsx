/**
 * Main chat container component with message list and input
 * @packageDocumentation
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useTheme } from "../stores/themeStore";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatTabs } from "./ChatTabs";
import {
  useChatState,
  type ChatMessage as ChatMessageData,
  type ChatMessageType,
  type UserRole,
  type UseChatStateOptions,
} from "../core/chat/useChatState";
import {
  useChatInput,
  type UseChatInputOptions,
  type SlashCommand,
} from "../core/chat/useChatInput";
import {
  useChatFilters,
  type UseChatFiltersOptions,
} from "../core/chat/useChatFilters";

/** Props for ChatBox component */
export interface ChatBoxProps {
  /** Current user's username */
  currentUsername: string;
  /** Current user's role */
  currentRole?: UserRole;
  /** Callback when message should be sent */
  onSend: (
    type: ChatMessageType,
    content: string,
    targetUsername?: string,
  ) => void;
  /** Callback when username is clicked */
  onUsernameClick?: (username: string) => void;
  /** Callback when link is clicked */
  onLinkClick?: (url: string) => void;
  /** Initial messages */
  initialMessages?: ChatMessageData[];
  /** Custom slash commands */
  customCommands?: SlashCommand[];
  /** Maximum messages to keep */
  maxMessages?: number;
  /** Default channel */
  defaultChannel?: ChatMessageType;
  /** Chat state options override */
  chatStateOptions?: Partial<UseChatStateOptions>;
  /** Chat input options override */
  chatInputOptions?: Partial<UseChatInputOptions>;
  /** Chat filter options override */
  chatFilterOptions?: Partial<UseChatFiltersOptions>;
  /** Whether to show timestamp */
  showTimestamp?: boolean;
  /** Timestamp format */
  timestampFormat?: "short" | "long";
  /** Whether to show channel tabs */
  showTabs?: boolean;
  /** Whether to show unread badges */
  showBadges?: boolean;
  /** Whether input auto-focuses */
  autoFocus?: boolean;
  /** Height of the chat box */
  height?: number | string;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/** Result from ChatBox (exposed for imperative control) */
export interface ChatBoxRef {
  /** Add a message programmatically */
  addMessage: (
    message: Omit<
      ChatMessageData,
      "id" | "timestamp" | "hasLinks" | "hasEmojis"
    >,
  ) => void;
  /** Add a system message */
  addSystemMessage: (content: string) => void;
  /** Clear all messages */
  clearMessages: () => void;
  /** Scroll to bottom */
  scrollToBottom: () => void;
  /** Focus the input */
  focusInput: () => void;
  /** Set the current channel */
  setChannel: (channel: ChatMessageType) => void;
}

/**
 * Main chat container component
 *
 * @example
 * ```tsx
 * function GameChat() {
 *   const handleSend = (type: ChatMessageType, content: string, target?: string) => {
 *     // Send to server via WebSocket
 *     socket.emit('chat', { type, content, target });
 *   };
 *
 *   return (
 *     <ChatBox
 *       currentUsername="Player1"
 *       currentRole="vip"
 *       onSend={handleSend}
 *       onUsernameClick={(name) => console.log('Clicked:', name)}
 *       showTabs
 *       showBadges
 *       autoFocus
 *       height={300}
 *     />
 *   );
 * }
 * ```
 */
// React 19: ref is now a regular prop, no forwardRef needed
export function ChatBox({
  currentUsername,
  currentRole = "default",
  onSend,
  onUsernameClick,
  onLinkClick,
  initialMessages = [],
  customCommands = [],
  maxMessages = 200,
  defaultChannel = "player",
  chatStateOptions = {},
  chatInputOptions = {},
  chatFilterOptions = {},
  showTimestamp = true,
  timestampFormat = "short",
  showTabs = true,
  showBadges = true,
  autoFocus = false,
  height = 300,
  className,
  style,
  ref,
}: ChatBoxProps & { ref?: React.Ref<ChatBoxRef> }): React.ReactElement {
  const theme = useTheme();
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isScrollLocked, setIsScrollLocked] = useState(false);

  // Initialize chat state
  const chatState = useChatState({
    maxMessages,
    initialMessages,
    ...chatStateOptions,
  });

  // Initialize chat filters
  const chatFilters = useChatFilters(chatFilterOptions);

  // Handle local messages (system feedback)
  const handleLocalMessage = useCallback(
    (content: string) => {
      if (content === "__CLEAR_CHAT__") {
        chatState.clearMessages();
      } else {
        chatState.addSystemMessage(content);
      }
    },
    [chatState],
  );

  // Initialize chat input
  const chatInput = useChatInput({
    currentUsername,
    currentRole,
    defaultChannel,
    customCommands,
    onSend,
    onLocalMessage: handleLocalMessage,
    ...chatInputOptions,
  });

  // Filter messages based on active channels
  const visibleMessages = useMemo(
    () => chatFilters.filterMessages(chatState.messages),
    [chatFilters, chatState.messages],
  );

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    if (messageListRef.current && !isScrollLocked) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [isScrollLocked]);

  useEffect(() => {
    scrollToBottom();
  }, [visibleMessages.length, scrollToBottom]);

  // Handle scroll to detect scroll-lock
  const handleScroll = useCallback(() => {
    if (messageListRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messageListRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsScrollLocked(!isNearBottom);
    }
  }, []);

  // Focus input
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Expose ref methods
  React.useImperativeHandle(
    ref,
    () => ({
      addMessage: chatState.addMessage,
      addSystemMessage: chatState.addSystemMessage,
      clearMessages: chatState.clearMessages,
      scrollToBottom,
      focusInput,
      setChannel: chatInput.setChannel,
    }),
    [chatState, scrollToBottom, focusInput, chatInput.setChannel],
  );

  // Mark channel as read when tab is clicked
  const handleTabClick = useCallback(
    (channel: ChatMessageType | null) => {
      if (channel !== null) {
        chatState.markAsRead(channel);
      } else {
        chatState.markAllAsRead();
      }
    },
    [chatState],
  );

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: typeof height === "number" ? `${height}px` : height,
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    ...style,
  };

  const messageListStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarWidth: "thin",
    scrollbarColor: `${theme.colors.border.default} transparent`,
  };

  const scrollLockIndicatorStyle: React.CSSProperties = {
    position: "absolute",
    bottom: 50,
    right: theme.spacing.md,
    backgroundColor: theme.colors.background.tertiary,
    color: theme.colors.text.secondary,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.xs,
    cursor: "pointer",
    boxShadow: theme.shadows.sm,
    display: isScrollLocked ? "block" : "none",
  };

  const emptyStateStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.sm,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Channel tabs */}
      {showTabs && (
        <ChatTabs
          chatFilters={chatFilters}
          unreadCounts={chatState.unreadCounts}
          showBadges={showBadges}
          onTabClick={handleTabClick}
        />
      )}

      {/* Message list */}
      <div
        ref={messageListRef}
        style={messageListStyle}
        onScroll={handleScroll}
      >
        {visibleMessages.length === 0 ? (
          <div style={emptyStateStyle}>No messages yet</div>
        ) : (
          visibleMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              showTimestamp={showTimestamp}
              timestampFormat={timestampFormat}
              onUsernameClick={onUsernameClick}
              onLinkClick={onLinkClick}
            />
          ))
        )}
      </div>

      {/* Scroll lock indicator */}
      <div
        style={scrollLockIndicatorStyle}
        onClick={() => {
          setIsScrollLocked(false);
          scrollToBottom();
        }}
      >
        Scroll locked - Click to unlock
      </div>

      {/* Chat input */}
      <ChatInput chatInput={chatInput} autoFocus={autoFocus} />
    </div>
  );
}

// Re-export hooks for convenience
export { useChatState, useChatInput, useChatFilters };
