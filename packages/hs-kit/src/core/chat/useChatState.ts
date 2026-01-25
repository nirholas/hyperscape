/**
 * Hook for managing chat state
 * @packageDocumentation
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";

/** Message type identifier */
export type ChatMessageType =
  | "system"
  | "player"
  | "npc"
  | "guild"
  | "trade"
  | "whisper";

/** User role for username coloring */
export type UserRole =
  | "default"
  | "admin"
  | "moderator"
  | "vip"
  | "premium"
  | "developer";

/** Individual chat message */
export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  /** Message type/channel */
  type: ChatMessageType;
  /** Sender username (empty for system messages) */
  username: string;
  /** User's role for coloring */
  role: UserRole;
  /** Message content */
  content: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Optional target username (for whispers) */
  targetUsername?: string;
  /** Whether message contains links */
  hasLinks: boolean;
  /** Whether message contains emojis */
  hasEmojis: boolean;
}

/** Options for useChatState hook */
export interface UseChatStateOptions {
  /** Maximum messages to keep in history (default: 200) */
  maxMessages?: number;
  /** Initial messages */
  initialMessages?: ChatMessage[];
  /** Callback when a new message is added */
  onMessage?: (message: ChatMessage) => void;
  /** Callback when username is clicked */
  onUsernameClick?: (username: string) => void;
}

/** Result from useChatState hook */
export interface UseChatStateResult {
  /** All chat messages */
  messages: ChatMessage[];
  /** Filtered messages (based on current filter) */
  filteredMessages: ChatMessage[];
  /** Current filter (null for all) */
  filter: ChatMessageType | null;
  /** Set message filter */
  setFilter: (filter: ChatMessageType | null) => void;
  /** Add a new message */
  addMessage: (
    message: Omit<ChatMessage, "id" | "timestamp" | "hasLinks" | "hasEmojis">,
  ) => void;
  /** Add a system message */
  addSystemMessage: (content: string) => void;
  /** Clear all messages */
  clearMessages: () => void;
  /** Clear messages by type */
  clearMessagesByType: (type: ChatMessageType) => void;
  /** Get messages by type */
  getMessagesByType: (type: ChatMessageType) => ChatMessage[];
  /** Total message count */
  messageCount: number;
  /** Unread message count per channel */
  unreadCounts: Record<ChatMessageType, number>;
  /** Mark channel as read */
  markAsRead: (type: ChatMessageType) => void;
  /** Mark all channels as read */
  markAllAsRead: () => void;
}

/** Generate unique message ID */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** URL regex pattern */
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+/gi;

/** Emoji regex pattern (basic Unicode emoji detection) */
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/u;

/** Check if content contains links */
function containsLinks(content: string): boolean {
  return URL_PATTERN.test(content);
}

/** Check if content contains emojis */
function containsEmojis(content: string): boolean {
  return EMOJI_PATTERN.test(content);
}

/**
 * Hook to manage chat state
 *
 * @example
 * ```tsx
 * function ChatWindow() {
 *   const { messages, addMessage, filter, setFilter } = useChatState({
 *     maxMessages: 100,
 *     onMessage: (msg) => console.log('New message:', msg)
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <ChatMessage key={msg.id} message={msg} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useChatState(
  options: UseChatStateOptions = {},
): UseChatStateResult {
  const {
    maxMessages = 200,
    initialMessages = [],
    onMessage,
    onUsernameClick: _onUsernameClick,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [filter, setFilter] = useState<ChatMessageType | null>(null);
  const [readTimestamps, setReadTimestamps] = useState<
    Record<ChatMessageType, number>
  >({
    system: Date.now(),
    player: Date.now(),
    npc: Date.now(),
    guild: Date.now(),
    trade: Date.now(),
    whisper: Date.now(),
  });

  // Ref to store callback to avoid stale closures
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const addMessage = useCallback(
    (
      messageData: Omit<
        ChatMessage,
        "id" | "timestamp" | "hasLinks" | "hasEmojis"
      >,
    ) => {
      const message: ChatMessage = {
        ...messageData,
        id: generateMessageId(),
        timestamp: Date.now(),
        hasLinks: containsLinks(messageData.content),
        hasEmojis: containsEmojis(messageData.content),
      };

      setMessages((prev) => {
        const newMessages = [...prev, message];
        // Trim to maxMessages
        if (newMessages.length > maxMessages) {
          return newMessages.slice(-maxMessages);
        }
        return newMessages;
      });

      // Notify callback
      onMessageRef.current?.(message);
    },
    [maxMessages],
  );

  const addSystemMessage = useCallback(
    (content: string) => {
      addMessage({
        type: "system",
        username: "",
        role: "default",
        content,
      });
    },
    [addMessage],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const clearMessagesByType = useCallback((type: ChatMessageType) => {
    setMessages((prev) => prev.filter((msg) => msg.type !== type));
  }, []);

  const getMessagesByType = useCallback(
    (type: ChatMessageType) => {
      return messages.filter((msg) => msg.type === type);
    },
    [messages],
  );

  const filteredMessages = useMemo(() => {
    if (filter === null) {
      return messages;
    }
    return messages.filter((msg) => msg.type === filter);
  }, [messages, filter]);

  const unreadCounts = useMemo(() => {
    const counts: Record<ChatMessageType, number> = {
      system: 0,
      player: 0,
      npc: 0,
      guild: 0,
      trade: 0,
      whisper: 0,
    };

    for (const msg of messages) {
      if (msg.timestamp > readTimestamps[msg.type]) {
        counts[msg.type]++;
      }
    }

    return counts;
  }, [messages, readTimestamps]);

  const markAsRead = useCallback((type: ChatMessageType) => {
    setReadTimestamps((prev) => ({
      ...prev,
      [type]: Date.now(),
    }));
  }, []);

  const markAllAsRead = useCallback(() => {
    const now = Date.now();
    setReadTimestamps({
      system: now,
      player: now,
      npc: now,
      guild: now,
      trade: now,
      whisper: now,
    });
  }, []);

  return {
    messages,
    filteredMessages,
    filter,
    setFilter,
    addMessage,
    addSystemMessage,
    clearMessages,
    clearMessagesByType,
    getMessagesByType,
    messageCount: messages.length,
    unreadCounts,
    markAsRead,
    markAllAsRead,
  };
}
