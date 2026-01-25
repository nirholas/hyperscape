/**
 * Hook for filtering chat messages by channel
 * @packageDocumentation
 */

import { useState, useCallback, useMemo } from "react";
import type { ChatMessage, ChatMessageType } from "./useChatState";

/** Channel configuration */
export interface ChannelConfig {
  /** Channel type */
  type: ChatMessageType;
  /** Display name */
  name: string;
  /** Short label for tabs */
  label: string;
  /** Channel color */
  color: string;
  /** Whether channel is enabled */
  enabled: boolean;
  /** Whether channel is visible in tabs */
  visible: boolean;
}

/** Options for useChatFilters hook */
export interface UseChatFiltersOptions {
  /** Custom channel configurations */
  channels?: Partial<Record<ChatMessageType, Partial<ChannelConfig>>>;
  /** Initially active channels (null for all) */
  activeChannels?: ChatMessageType[] | null;
  /** Whether to allow multi-select */
  multiSelect?: boolean;
}

/** Result from useChatFilters hook */
export interface UseChatFiltersResult {
  /** All channel configurations */
  channels: ChannelConfig[];
  /** Currently active channel(s) */
  activeChannels: ChatMessageType[] | null;
  /** Set active channel (single select) */
  setActiveChannel: (channel: ChatMessageType | null) => void;
  /** Toggle channel active state (multi select) */
  toggleChannel: (channel: ChatMessageType) => void;
  /** Check if channel is active */
  isChannelActive: (channel: ChatMessageType) => boolean;
  /** Filter messages by active channels */
  filterMessages: (messages: ChatMessage[]) => ChatMessage[];
  /** Get channel config by type */
  getChannel: (type: ChatMessageType) => ChannelConfig | undefined;
  /** Reset to showing all channels */
  showAll: () => void;
  /** Show only specific channels */
  showOnly: (channels: ChatMessageType[]) => void;
  /** Whether multi-select is enabled */
  multiSelect: boolean;
  /** Toggle multi-select mode */
  setMultiSelect: (enabled: boolean) => void;
}

/** Default channel configurations */
const DEFAULT_CHANNELS: Record<ChatMessageType, ChannelConfig> = {
  system: {
    type: "system",
    name: "System",
    label: "Sys",
    color: "#ffcc00",
    enabled: true,
    visible: true,
  },
  player: {
    type: "player",
    name: "Local",
    label: "All",
    color: "#ffffff",
    enabled: true,
    visible: true,
  },
  npc: {
    type: "npc",
    name: "NPC",
    label: "NPC",
    color: "#99ccff",
    enabled: true,
    visible: true,
  },
  guild: {
    type: "guild",
    name: "Guild",
    label: "Guild",
    color: "#66ff66",
    enabled: true,
    visible: true,
  },
  trade: {
    type: "trade",
    name: "Trade",
    label: "Trade",
    color: "#ff9966",
    enabled: true,
    visible: true,
  },
  whisper: {
    type: "whisper",
    name: "Whisper",
    label: "PM",
    color: "#ff66ff",
    enabled: true,
    visible: true,
  },
};

/**
 * Hook for filtering chat messages by channel
 *
 * @example
 * ```tsx
 * function ChatTabs() {
 *   const { channels, activeChannels, setActiveChannel, filterMessages } = useChatFilters();
 *   const { messages } = useChatState();
 *
 *   const visibleMessages = filterMessages(messages);
 *
 *   return (
 *     <div>
 *       {channels.filter(c => c.visible).map(channel => (
 *         <button
 *           key={channel.type}
 *           onClick={() => setActiveChannel(channel.type)}
 *           style={{ color: channel.color }}
 *         >
 *           {channel.label}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useChatFilters(
  options: UseChatFiltersOptions = {},
): UseChatFiltersResult {
  const {
    channels: customChannels = {},
    activeChannels: initialActiveChannels = null,
    multiSelect: initialMultiSelect = false,
  } = options;

  const [activeChannels, setActiveChannels] = useState<
    ChatMessageType[] | null
  >(initialActiveChannels);
  const [multiSelect, setMultiSelect] = useState(initialMultiSelect);

  // Merge custom channels with defaults
  const channels = useMemo(() => {
    const merged: ChannelConfig[] = [];
    const types: ChatMessageType[] = [
      "player",
      "system",
      "guild",
      "trade",
      "whisper",
      "npc",
    ];

    for (const type of types) {
      const defaultConfig = DEFAULT_CHANNELS[type];
      const customConfig = customChannels[type] || {};
      merged.push({
        ...defaultConfig,
        ...customConfig,
      });
    }

    return merged;
  }, [customChannels]);

  // Set single active channel
  const setActiveChannel = useCallback((channel: ChatMessageType | null) => {
    if (channel === null) {
      setActiveChannels(null);
    } else {
      setActiveChannels([channel]);
    }
  }, []);

  // Toggle channel (for multi-select)
  const toggleChannel = useCallback(
    (channel: ChatMessageType) => {
      setActiveChannels((prev) => {
        if (prev === null) {
          // Was showing all, now show only this one
          return [channel];
        }

        if (prev.includes(channel)) {
          // Remove channel
          const newChannels = prev.filter((c) => c !== channel);
          // If no channels left, show all
          return newChannels.length === 0 ? null : newChannels;
        }

        // Add channel
        return multiSelect ? [...prev, channel] : [channel];
      });
    },
    [multiSelect],
  );

  // Check if channel is active
  const isChannelActive = useCallback(
    (channel: ChatMessageType): boolean => {
      if (activeChannels === null) return true;
      return activeChannels.includes(channel);
    },
    [activeChannels],
  );

  // Filter messages by active channels
  const filterMessages = useCallback(
    (messages: ChatMessage[]): ChatMessage[] => {
      if (activeChannels === null) {
        // Show all enabled channels
        const enabledTypes = new Set(
          channels.filter((c) => c.enabled).map((c) => c.type),
        );
        return messages.filter((msg) => enabledTypes.has(msg.type));
      }

      // Show only active channels that are also enabled
      const enabledTypes = new Set(
        channels.filter((c) => c.enabled).map((c) => c.type),
      );
      return messages.filter(
        (msg) =>
          activeChannels.includes(msg.type) && enabledTypes.has(msg.type),
      );
    },
    [activeChannels, channels],
  );

  // Get channel config by type
  const getChannel = useCallback(
    (type: ChatMessageType): ChannelConfig | undefined => {
      return channels.find((c) => c.type === type);
    },
    [channels],
  );

  // Reset to showing all
  const showAll = useCallback(() => {
    setActiveChannels(null);
  }, []);

  // Show only specific channels
  const showOnly = useCallback((channelTypes: ChatMessageType[]) => {
    setActiveChannels(channelTypes);
  }, []);

  return {
    channels,
    activeChannels,
    setActiveChannel,
    toggleChannel,
    isChannelActive,
    filterMessages,
    getChannel,
    showAll,
    showOnly,
    multiSelect,
    setMultiSelect,
  };
}

/** Preset channel filter configurations */
export const CHANNEL_PRESETS = {
  /** All channels */
  all: null as ChatMessageType[] | null,
  /** Game-related channels */
  game: ["player", "npc", "system"] as ChatMessageType[],
  /** Social channels */
  social: ["player", "guild", "whisper"] as ChatMessageType[],
  /** Trading only */
  trading: ["trade"] as ChatMessageType[],
  /** Private messages */
  private: ["whisper", "guild"] as ChatMessageType[],
};
