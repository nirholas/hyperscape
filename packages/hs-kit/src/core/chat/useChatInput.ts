/**
 * Hook for chat input with command support
 * @packageDocumentation
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ChatMessageType, UserRole } from "./useChatState";

/** Slash command definition */
export interface SlashCommand {
  /** Command name (without /) */
  name: string;
  /** Alternative aliases */
  aliases?: string[];
  /** Command description */
  description: string;
  /** Usage pattern */
  usage: string;
  /** Required role to use this command (if not set, available to all) */
  requiredRole?: UserRole;
  /** Execute command (returns false to prevent sending) */
  execute: (args: string[], context: CommandContext) => CommandResult;
}

/** Context provided to command execution */
export interface CommandContext {
  /** Current input value */
  input: string;
  /** Parsed arguments */
  args: string[];
  /** Current user's username */
  currentUsername: string;
  /** Current user's role */
  currentRole: UserRole;
  /** Function to send a chat message */
  sendMessage: (
    type: ChatMessageType,
    content: string,
    targetUsername?: string,
  ) => void;
  /** Function to add a local system message */
  addLocalMessage: (content: string) => void;
  /** Set the current channel */
  setChannel: (channel: ChatMessageType) => void;
}

/** Result of command execution */
export interface CommandResult {
  /** Whether to send the message */
  send: boolean;
  /** Modified message type (if any) */
  type?: ChatMessageType;
  /** Modified content (if any) */
  content?: string;
  /** Target username (for whispers) */
  targetUsername?: string;
}

/** Options for useChatInput hook */
export interface UseChatInputOptions {
  /** Current user's username */
  currentUsername: string;
  /** Current user's role */
  currentRole?: UserRole;
  /** Default channel to send to */
  defaultChannel?: ChatMessageType;
  /** Maximum input length */
  maxLength?: number;
  /** History size */
  historySize?: number;
  /** Custom commands */
  customCommands?: SlashCommand[];
  /** Callback when message should be sent */
  onSend: (
    type: ChatMessageType,
    content: string,
    targetUsername?: string,
  ) => void;
  /** Callback for local messages (displayed only to self) */
  onLocalMessage?: (content: string) => void;
  /** Callback when channel changes */
  onChannelChange?: (channel: ChatMessageType) => void;
}

/** Result from useChatInput hook */
export interface UseChatInputResult {
  /** Current input value */
  value: string;
  /** Set input value */
  setValue: (value: string) => void;
  /** Current channel */
  channel: ChatMessageType;
  /** Set current channel */
  setChannel: (channel: ChatMessageType) => void;
  /** Submit the current input */
  submit: () => void;
  /** Handle key down (for history navigation) */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Props to spread on input element */
  inputProps: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    maxLength: number;
    placeholder: string;
  };
  /** Available commands */
  commands: SlashCommand[];
  /** Whether input is a command */
  isCommand: boolean;
  /** Suggested command (for autocomplete) */
  suggestedCommand: SlashCommand | null;
  /** Clear input */
  clear: () => void;
  /** Navigate history up */
  historyUp: () => void;
  /** Navigate history down */
  historyDown: () => void;
  /** Current history index (-1 = current input) */
  historyIndex: number;
}

/** Role priority for permission checking (higher = more permissions) */
const ROLE_PRIORITY: Record<UserRole, number> = {
  default: 0,
  premium: 1,
  vip: 2,
  moderator: 3,
  admin: 4,
  developer: 5,
};

/** Check if a role has permission for a required role */
function hasRolePermission(
  userRole: UserRole,
  requiredRole: UserRole | undefined,
): boolean {
  if (!requiredRole) return true; // No role required = available to all
  return ROLE_PRIORITY[userRole] >= ROLE_PRIORITY[requiredRole];
}

/** Built-in slash commands */
const DEFAULT_COMMANDS: SlashCommand[] = [
  {
    name: "w",
    aliases: ["whisper", "pm", "msg"],
    description: "Send a private message to a player",
    usage: "/w <username> <message>",
    execute: (args, context) => {
      if (args.length < 2) {
        context.addLocalMessage("Usage: /w <username> <message>");
        return { send: false };
      }
      const [target, ...messageParts] = args;
      return {
        send: true,
        type: "whisper",
        content: messageParts.join(" "),
        targetUsername: target,
      };
    },
  },
  {
    name: "g",
    aliases: ["guild", "gc"],
    description: "Send a message to guild chat",
    usage: "/g <message>",
    execute: (args, context) => {
      if (args.length === 0) {
        context.setChannel("guild");
        context.addLocalMessage("Switched to guild chat.");
        return { send: false };
      }
      return {
        send: true,
        type: "guild",
        content: args.join(" "),
      };
    },
  },
  {
    name: "trade",
    aliases: ["t"],
    description: "Send a message to trade chat",
    usage: "/trade <message>",
    execute: (args, context) => {
      if (args.length === 0) {
        context.setChannel("trade");
        context.addLocalMessage("Switched to trade chat.");
        return { send: false };
      }
      return {
        send: true,
        type: "trade",
        content: args.join(" "),
      };
    },
  },
  {
    name: "say",
    aliases: ["s", "local"],
    description: "Send a message to local chat",
    usage: "/say <message>",
    execute: (args, context) => {
      if (args.length === 0) {
        context.setChannel("player");
        context.addLocalMessage("Switched to local chat.");
        return { send: false };
      }
      return {
        send: true,
        type: "player",
        content: args.join(" "),
      };
    },
  },
  {
    name: "me",
    aliases: ["emote"],
    description: "Send an emote/action message",
    usage: "/me <action>",
    execute: (args, context) => {
      if (args.length === 0) {
        context.addLocalMessage("Usage: /me <action>");
        return { send: false };
      }
      return {
        send: true,
        type: "player",
        content: `*${context.currentUsername} ${args.join(" ")}*`,
      };
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the chat window",
    usage: "/clear",
    execute: (_args, context) => {
      context.addLocalMessage("__CLEAR_CHAT__");
      return { send: false };
    },
  },
  {
    name: "help",
    aliases: ["?", "commands"],
    description: "Show available commands",
    usage: "/help [command]",
    execute: (args, context) => {
      // This will be handled specially by showing command list
      if (args.length > 0) {
        context.addLocalMessage(
          `Help for /${args[0]}: Use /help for all commands`,
        );
      } else {
        context.addLocalMessage(
          "Available commands: /w, /g, /trade, /say, /me, /clear, /help",
        );
      }
      return { send: false };
    },
  },
  {
    name: "mute",
    aliases: ["silence"],
    description: "Mute a player (moderator only)",
    usage: "/mute <username> [duration]",
    requiredRole: "moderator",
    execute: (args, context) => {
      if (args.length < 1) {
        context.addLocalMessage(
          "Usage: /mute <username> [duration in minutes]",
        );
        return { send: false };
      }
      const [target, duration = "10"] = args;
      context.addLocalMessage(`Muted ${target} for ${duration} minutes.`);
      return { send: false };
    },
  },
  {
    name: "kick",
    description: "Kick a player from the server (moderator only)",
    usage: "/kick <username> [reason]",
    requiredRole: "moderator",
    execute: (args, context) => {
      if (args.length < 1) {
        context.addLocalMessage("Usage: /kick <username> [reason]");
        return { send: false };
      }
      const [target, ...reasonParts] = args;
      const reason =
        reasonParts.length > 0 ? reasonParts.join(" ") : "No reason provided";
      context.addLocalMessage(`Kicked ${target}: ${reason}`);
      return { send: false };
    },
  },
  {
    name: "ban",
    description: "Ban a player from the server (admin only)",
    usage: "/ban <username> [duration] [reason]",
    requiredRole: "admin",
    execute: (args, context) => {
      if (args.length < 1) {
        context.addLocalMessage("Usage: /ban <username> [duration] [reason]");
        return { send: false };
      }
      const [target, ...rest] = args;
      context.addLocalMessage(`Banned ${target}. ${rest.join(" ")}`);
      return { send: false };
    },
  },
  {
    name: "announce",
    aliases: ["broadcast"],
    description: "Send a server-wide announcement (admin only)",
    usage: "/announce <message>",
    requiredRole: "admin",
    execute: (args, context) => {
      if (args.length < 1) {
        context.addLocalMessage("Usage: /announce <message>");
        return { send: false };
      }
      return {
        send: true,
        type: "system",
        content: `[ANNOUNCEMENT] ${args.join(" ")}`,
      };
    },
  },
];

/** Get placeholder text for channel */
function getPlaceholder(channel: ChatMessageType): string {
  switch (channel) {
    case "guild":
      return "Message guild...";
    case "trade":
      return "Message trade chat...";
    case "whisper":
      return "Whisper...";
    case "player":
    default:
      return "Press Enter to chat...";
  }
}

/**
 * Hook for chat input with slash command support
 *
 * @example
 * ```tsx
 * function ChatInput() {
 *   const { inputProps, channel, setChannel, commands } = useChatInput({
 *     currentUsername: 'Player1',
 *     onSend: (type, content, target) => {
 *       // Send to server
 *     }
 *   });
 *
 *   return <input {...inputProps} />;
 * }
 * ```
 */
export function useChatInput(options: UseChatInputOptions): UseChatInputResult {
  const {
    currentUsername,
    currentRole = "default",
    defaultChannel = "player",
    maxLength = 256,
    historySize = 50,
    customCommands = [],
    onSend,
    onLocalMessage,
    onChannelChange,
  } = options;

  const [value, setValue] = useState("");
  const [channel, setChannelState] = useState<ChatMessageType>(defaultChannel);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  // Refs for callbacks
  const onSendRef = useRef(onSend);
  const onLocalMessageRef = useRef(onLocalMessage);
  const onChannelChangeRef = useRef(onChannelChange);

  useEffect(() => {
    onSendRef.current = onSend;
    onLocalMessageRef.current = onLocalMessage;
    onChannelChangeRef.current = onChannelChange;
  }, [onSend, onLocalMessage, onChannelChange]);

  // Combine default and custom commands, filtered by role
  const allCommands = useMemo(
    () => [...DEFAULT_COMMANDS, ...customCommands],
    [customCommands],
  );

  // Filter commands available to current role
  const commands = useMemo(
    () =>
      allCommands.filter((cmd) =>
        hasRolePermission(currentRole, cmd.requiredRole),
      ),
    [allCommands, currentRole],
  );

  // Check if input is a command
  const isCommand = value.startsWith("/");

  // Find suggested command for autocomplete
  const suggestedCommand = useMemo(() => {
    if (!isCommand || value.length < 2) return null;
    const inputCmd = value.slice(1).split(" ")[0].toLowerCase();
    return (
      commands.find(
        (cmd) =>
          cmd.name.startsWith(inputCmd) ||
          cmd.aliases?.some((a) => a.startsWith(inputCmd)),
      ) || null
    );
  }, [value, isCommand, commands]);

  // Set channel with callback
  const setChannel = useCallback((newChannel: ChatMessageType) => {
    setChannelState(newChannel);
    onChannelChangeRef.current?.(newChannel);
  }, []);

  // Add to history
  const addToHistory = useCallback(
    (input: string) => {
      if (!input.trim()) return;
      setHistory((prev) => {
        const filtered = prev.filter((h) => h !== input);
        const newHistory = [input, ...filtered];
        return newHistory.slice(0, historySize);
      });
      setHistoryIndex(-1);
      setTempInput("");
    },
    [historySize],
  );

  // Parse and execute command
  const executeCommand = useCallback(
    (input: string): boolean => {
      const parts = input.slice(1).split(" ");
      const cmdName = parts[0].toLowerCase();
      const args = parts.slice(1);

      const command = commands.find(
        (cmd) => cmd.name === cmdName || cmd.aliases?.includes(cmdName),
      );

      if (!command) {
        onLocalMessageRef.current?.(`Unknown command: /${cmdName}`);
        return false;
      }

      const context: CommandContext = {
        input,
        args,
        currentUsername,
        currentRole,
        sendMessage: (type, content, target) => {
          onSendRef.current(type, content, target);
        },
        addLocalMessage: (content) => {
          onLocalMessageRef.current?.(content);
        },
        setChannel,
      };

      const result = command.execute(args, context);

      if (result.send && result.content) {
        onSendRef.current(
          result.type || channel,
          result.content,
          result.targetUsername,
        );
      }

      return true;
    },
    [commands, currentUsername, channel, setChannel],
  );

  // Submit handler
  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    addToHistory(trimmed);

    if (isCommand) {
      executeCommand(trimmed);
    } else {
      onSendRef.current(channel, trimmed);
    }

    setValue("");
  }, [value, isCommand, channel, addToHistory, executeCommand]);

  // History navigation
  const historyUp = useCallback(() => {
    if (history.length === 0) return;

    if (historyIndex === -1) {
      setTempInput(value);
      setHistoryIndex(0);
      setValue(history[0]);
    } else if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setValue(history[newIndex]);
    }
  }, [history, historyIndex, value]);

  const historyDown = useCallback(() => {
    if (historyIndex === -1) return;

    if (historyIndex === 0) {
      setHistoryIndex(-1);
      setValue(tempInput);
    } else {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setValue(history[newIndex]);
    }
  }, [history, historyIndex, tempInput]);

  // Key handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        historyUp();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        historyDown();
      } else if (e.key === "Tab" && suggestedCommand && isCommand) {
        e.preventDefault();
        const parts = value.split(" ");
        parts[0] = `/${suggestedCommand.name}`;
        setValue(parts.join(" ") + (parts.length === 1 ? " " : ""));
      }
    },
    [submit, historyUp, historyDown, suggestedCommand, isCommand, value],
  );

  // Input change handler
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setHistoryIndex(-1);
  }, []);

  // Clear handler
  const clear = useCallback(() => {
    setValue("");
    setHistoryIndex(-1);
  }, []);

  const inputProps = useMemo(
    () => ({
      value,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      maxLength,
      placeholder: getPlaceholder(channel),
    }),
    [value, handleChange, handleKeyDown, maxLength, channel],
  );

  return {
    value,
    setValue,
    channel,
    setChannel,
    submit,
    handleKeyDown,
    inputProps,
    commands,
    isCommand,
    suggestedCommand,
    clear,
    historyUp,
    historyDown,
    historyIndex,
  };
}
