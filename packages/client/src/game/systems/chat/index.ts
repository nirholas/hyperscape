/**
 * Chat system hooks and utilities
 * @packageDocumentation
 */

// Chat state management
export {
  useChatState,
  type ChatMessage,
  type ChatMessageType,
  type UserRole,
  type UseChatStateOptions,
  type UseChatStateResult,
} from "./useChatState";

// Chat input with commands
export {
  useChatInput,
  type SlashCommand,
  type CommandContext,
  type CommandResult,
  type UseChatInputOptions,
  type UseChatInputResult,
} from "./useChatInput";

// Channel filtering
export {
  useChatFilters,
  type ChannelConfig,
  type UseChatFiltersOptions,
  type UseChatFiltersResult,
  CHANNEL_PRESETS,
} from "./useChatFilters";
