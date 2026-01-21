import {
  IAgentRuntime,
  Memory,
  State,
  elizaLogger,
  addHeader,
  ChannelType,
  ModelType,
  Content,
} from "@elizaos/core";
import { hyperscapeShouldRespondTemplate } from "../templates/index.js";

// Type definitions
export interface ActionResult {
  text: string;
  success: boolean;
  data?: any;
}

export interface ComposeContextOptions {
  state: State;
  template?: string;
  runtime?: IAgentRuntime;
  additionalContext?: Record<string, any>;
}

export interface GenerateMessageOptions {
  runtime: IAgentRuntime;
  context: string;
  modelType?: (typeof ModelType)[keyof typeof ModelType];
  stop?: string[];
}

export interface ShouldRespondOptions {
  runtime: IAgentRuntime;
  message: Memory;
  state?: State;
}

// Helper to get value from State.values (supports both Map in 1.6.4 and object in 1.7.0)
function getStateValue(state: State | undefined, key: string): unknown {
  if (!state?.values) return undefined;
  // Check if it's a Map (1.6.4) or object (1.7.0)
  if (state.values instanceof Map) {
    return state.values.get(key);
  }
  // Object access for 1.7.0
  return (state.values as Record<string, unknown>)[key];
}

// Helper to create a State object that works with both versions
function createEmptyState(): State {
  // Use object for 1.7.0 compatibility, cast as any for cross-version support
  return { values: {} as any, data: {}, text: "" };
}

// Main functions
export function composeContext(options: ComposeContextOptions): string {
  const {
    state,
    template = "{{currentLocation}}\n{{recentMessages}}",
    runtime,
    additionalContext = {},
  } = options;

  const characterBio = runtime?.character?.bio || "An AI assistant";
  const agentName = runtime?.character?.name || "Assistant";

  let context = template || "";

  // Replace placeholders with actual values
  const replacements: Record<string, any> = {
    agentName,
    characterBio,
    currentLocation:
      getStateValue(state, "currentLocation") || "Unknown Location",
    recentMessages:
      getStateValue(state, "recentMessages") || "No recent messages",
    ...additionalContext,
  };

  for (const [key, value] of Object.entries(replacements)) {
    context = context.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }

  // Add state information
  if (state?.text) {
    context = addHeader("Current Context", state.text) + "\n" + context;
  }

  // Add character information
  if (runtime?.character) {
    const characterInfo = `Name: ${agentName}\nBio: ${characterBio}`;
    context = addHeader("Character", characterInfo) + "\n" + context;
  }

  return context;
}

export async function generateMessageResponse(
  options: GenerateMessageOptions,
): Promise<ActionResult> {
  const { runtime, context, modelType = ModelType.MEDIUM, stop = [] } = options;

  const response = await runtime.useModel(modelType, {
    prompt: context,
    maxTokens: 1000,
    max_tokens: 1000, // Fallback for older versions
    temperature: 0.8,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    stop,
  } as any);

  // Model returns either string directly or object with text property
  const text = (response as { text?: string }).text || String(response);

  return { text, success: true };
}

export async function shouldRespond(
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
  options: {
    template?: string;
    modelType?: (typeof ModelType)[keyof typeof ModelType];
  } = {},
): Promise<boolean> {
  const context = composeContext({
    state: state || createEmptyState(),
    template: options.template || hyperscapeShouldRespondTemplate,
    runtime,
  });

  const result = await runtime.evaluate(message, state || createEmptyState());

  return !!result;
}

export async function generateDetailedResponse(
  runtime: IAgentRuntime,
  message: Memory,
  state: State,
  options: {
    template?: string;
    modelType?: (typeof ModelType)[keyof typeof ModelType];
  } = {},
): Promise<ActionResult> {
  const context = composeContext({
    state,
    template: options.template,
    runtime,
    additionalContext: {
      messageText: message.content?.text || "",
      userName: (message as any).username || "User",
    },
  });

  // Call useModel with proper parameters
  const response = (await runtime.useModel(
    options.modelType || ModelType.TEXT_LARGE,
    {
      prompt: context,
      maxTokens: 2000,
      max_tokens: 2000, // Fallback for older versions
      temperature: 0.8,
    } as any,
  )) as string;

  const text = response;

  return { text, success: true };
}

// Channel context helper
export function getChannelContext(channelId?: string): string {
  const channelType = channelId || "DM";
  const context = `You are in a ${channelType} channel.`;
  return addHeader(context, channelType);
}

// Export helper functions
export function formatContext(data: Record<string, any>): string {
  const entries = Object.entries(data).filter(([_, value]) => value != null);
  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
}

export function extractMemoryText(memory: Memory): string {
  return memory.content?.text || "";
}

export function createChannelContext(channel: string = "DM"): string {
  return addHeader(`Channel: ${channel}`, "");
}
