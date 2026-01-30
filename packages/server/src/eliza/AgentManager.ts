/**
 * AgentManager - Manages embedded ElizaOS agent runtimes
 *
 * This manager handles:
 * - Creating and initializing agent runtimes
 * - Starting and stopping agents
 * - Providing agent status and control
 * - Managing agent lifecycle
 *
 * Unlike external ElizaOS processes, these agents run directly in the
 * Hyperscape server process with direct world access.
 */

import {
  AgentRuntime,
  ChannelType,
  mergeCharacterDefaults,
  stringToUuid,
  type Plugin,
} from "@elizaos/core";
import { hyperscapePlugin } from "@hyperscape/plugin-hyperscape";
import { createJWT } from "../shared/utils.js";

/**
 * Dynamically import the SQL plugin required for ElizaOS database operations.
 * Returns the plugin or null if not available.
 */
async function getSqlPlugin(): Promise<Plugin | null> {
  try {
    const mod = await import("@elizaos/plugin-sql");
    // The SQL plugin exports as 'sqlPlugin', 'plugin', or 'default' depending on version
    const sqlPlugin =
      (mod as Record<string, unknown>).sqlPlugin ??
      (mod as Record<string, unknown>).plugin ??
      mod.default;
    if (sqlPlugin) {
      console.log("[AgentManager] Loaded SQL plugin for database support");
      return sqlPlugin as Plugin;
    }
    console.warn(
      "[AgentManager] SQL plugin module loaded but no plugin export found. Exports:",
      Object.keys(mod),
    );
    return null;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load SQL plugin:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Dynamically import the appropriate model provider plugin based on available API keys.
 * Returns the plugin or null if no API key is configured.
 *
 * Note: We return Plugin type but dynamically imported plugins may have slightly different
 * type definitions due to nested node_modules. The runtime handles this correctly.
 */
async function getModelProviderPlugin(): Promise<Plugin | null> {
  // Check for OpenAI API key first (most common)
  if (process.env.OPENAI_API_KEY) {
    try {
      const mod = await import("@elizaos/plugin-openai");
      console.log("[AgentManager] Using OpenAI model provider");
      // Cast needed due to potential type version mismatch in nested node_modules
      return mod.openaiPlugin as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load OpenAI plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Check for Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      const mod = await import("@elizaos/plugin-anthropic");
      console.log("[AgentManager] Using Anthropic model provider");
      return (mod.anthropicPlugin ?? mod.default) as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load Anthropic plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Check for OpenRouter API key
  if (process.env.OPENROUTER_API_KEY) {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      const mod = await import("@elizaos/plugin-openrouter");
      console.log("[AgentManager] Using OpenRouter model provider");
      return (mod.openrouterPlugin ?? mod.default) as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load OpenRouter plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fall back to Ollama for local development (no API key needed)
  try {
    const mod = await import("@elizaos/plugin-ollama");
    console.log("[AgentManager] Using Ollama model provider (local fallback)");
    return mod.ollamaPlugin as Plugin;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load Ollama plugin:",
      err instanceof Error ? err.message : String(err),
    );
  }

  console.warn(
    "[AgentManager] No model provider available! Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY",
  );
  return null;
}
import type { World } from "@hyperscape/shared";
import type { Equipment } from "@hyperscape/plugin-hyperscape/src/types.js";
import type { HyperscapeService } from "../../../plugin-hyperscape/src/services/HyperscapeService.js";
import type { DatabaseSystem } from "../systems/DatabaseSystem/index.js";
import type {
  EmbeddedAgentConfig,
  EmbeddedAgentInfo,
  AgentState,
} from "./types.js";

/**
 * Internal agent instance tracking
 */
interface AgentInstance {
  config: EmbeddedAgentConfig;
  state: AgentState;
  startedAt: number;
  lastActivity: number;
  error?: string;
  runtime?: AgentRuntime;
  service?: HyperscapeService;
  /** Promise for tracking ongoing initialization (for cancellation during shutdown) */
  initializationPromise?: Promise<void>;
  /** AbortController for cancelling initialization during shutdown */
  initializationAbort?: AbortController;
}

type ScriptedRole = EmbeddedAgentConfig["scriptedRole"];
type EquipSlot = keyof Equipment;
type GatherSkill =
  | "woodcutting"
  | "fishing"
  | "mining"
  | "firemaking"
  | "cooking";

type CommandData = {
  target?: [number, number, number];
  runMode?: boolean;
  targetId?: string;
  resourceId?: string;
  itemId?: string;
  quantity?: number;
  equipSlot?: string;
  slot?: number;
  message?: string;
  skill?: GatherSkill;
};

const DEV_BOT_DEFINITIONS: Array<{ name: string; role: ScriptedRole }> = [
  { name: "Dev Woodcutter", role: "woodcutting" },
  { name: "Dev Fisher", role: "fishing" },
  { name: "Dev Miner", role: "mining" },
  { name: "Dev Slayer", role: "combat" },
];

function normalizeEquipSlot(slot: string | undefined): EquipSlot | null {
  if (!slot) return null;
  switch (slot.toLowerCase()) {
    case "head":
    case "helmet":
      return "helmet";
    case "neck":
    case "amulet":
      return "amulet";
    case "hands":
    case "gloves":
      return "gloves";
    case "feet":
    case "boots":
      return "boots";
    case "weapon":
      return "weapon";
    case "shield":
      return "shield";
    case "body":
      return "body";
    case "legs":
      return "legs";
    case "cape":
      return "cape";
    case "ring":
      return "ring";
    case "arrows":
      return "arrows";
    default:
      return null;
  }
}

/**
 * AgentManager manages the lifecycle of embedded ElizaOS agents
 */
export class AgentManager {
  private world: World;
  private agents: Map<string, AgentInstance> = new Map();
  private isShuttingDown: boolean = false;

  constructor(world: World) {
    this.world = world;
    console.log("[AgentManager] Initialized");
  }

  /**
   * Create and optionally start an embedded agent
   *
   * @param config - Agent configuration
   * @returns The agent's character ID
   */
  async createAgent(config: EmbeddedAgentConfig): Promise<string> {
    const { characterId, name } = config;

    // Check if agent already exists
    if (this.agents.has(characterId)) {
      console.warn(
        `[AgentManager] Agent ${characterId} already exists, returning existing`,
      );
      return characterId;
    }

    console.log(`[AgentManager] Creating agent: ${name} (${characterId})`);

    // Track the agent
    const instance: AgentInstance = {
      config,
      state: "initializing",
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.agents.set(characterId, instance);

    // Auto-start if configured
    if (config.autoStart !== false) {
      try {
        await this.startAgent(characterId);
      } catch (err) {
        instance.state = "error";
        instance.error = err instanceof Error ? err.message : String(err);
        console.error(
          `[AgentManager] Failed to auto-start agent ${name}:`,
          instance.error,
        );
      }
    }

    return characterId;
  }

  /**
   * Start an agent (spawn player entity and begin autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async startAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state === "running") {
      console.log(`[AgentManager] Agent ${characterId} is already running`);
      return;
    }

    // Check if shutdown is in progress
    if (this.isShuttingDown) {
      console.log(
        `[AgentManager] Shutdown in progress, skipping agent start: ${characterId}`,
      );
      return;
    }

    console.log(
      `[AgentManager] Starting agent: ${instance.config.name} (${characterId})`,
    );

    instance.state = "initializing";
    instance.lastActivity = Date.now();

    // Create abort controller for this agent's initialization
    const abortController = new AbortController();
    instance.initializationAbort = abortController;

    try {
      if (!instance.runtime) {
        const wsUrl =
          process.env.PUBLIC_WS_URL ||
          process.env.HYPERSCAPE_SERVER_URL ||
          "ws://localhost:5555/ws";
        const isScripted = instance.config.scriptedRole !== undefined;
        const role = instance.config.scriptedRole ?? "balanced";
        const autonomyMode = isScripted ? "scripted" : "llm";
        const silentChat = isScripted ? "true" : "false";

        // Build secrets object with available API keys
        const secrets: Record<string, string> = {
          HYPERSCAPE_CHARACTER_ID: instance.config.characterId,
          HYPERSCAPE_SERVER_URL: wsUrl,
        };

        // Generate auth token for embedded agent so HyperscapeService can authenticate
        // Uses the agent's accountId to create a valid Hyperscape JWT
        try {
          const authToken = await createJWT({
            userId: instance.config.accountId,
          });
          secrets.HYPERSCAPE_AUTH_TOKEN = authToken;
          console.log(
            `[AgentManager] Generated auth token for embedded agent ${instance.config.name} (accountId: ${instance.config.accountId})`,
          );
        } catch (authErr) {
          console.error(
            `[AgentManager] Failed to generate auth token for agent ${instance.config.name}:`,
            authErr instanceof Error ? authErr.message : String(authErr),
          );
          // Continue without auth token - will use first-message auth or fail gracefully
        }

        // Add model provider API keys if available
        if (process.env.OPENAI_API_KEY) {
          secrets.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        }
        if (process.env.ANTHROPIC_API_KEY) {
          secrets.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
        }
        if (process.env.OPENROUTER_API_KEY) {
          secrets.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        }

        const character = mergeCharacterDefaults({
          name: instance.config.name,
          system: isScripted
            ? "Silent scripted bot for Hyperscape."
            : "Autonomous agent for Hyperscape.",
          bio: [
            isScripted
              ? `Scripted ${role} bot running inside the Hyperscape server.`
              : "Autonomous agent running inside the Hyperscape server.",
          ],
          plugins: ["@hyperscape/plugin-hyperscape"],
          settings: {
            secrets,
            HYPERSCAPE_AUTONOMY_MODE: autonomyMode,
            HYPERSCAPE_SCRIPTED_ROLE: isScripted ? role : "",
            HYPERSCAPE_SILENT_CHAT: silentChat,
            DISABLE_BASIC_CAPABILITIES: isScripted ? "true" : "false",
            characterType: "ai-agent",
          },
        });

        // Build plugins array with required plugins
        // Cast needed due to potential type version mismatch between plugin package and @elizaos/core
        const plugins: Plugin[] = [hyperscapePlugin as unknown as Plugin];

        // Add SQL plugin (required for ElizaOS database operations)
        const sqlPlugin = await getSqlPlugin();
        if (sqlPlugin) {
          plugins.push(sqlPlugin);
        } else {
          console.warn(
            `[AgentManager] SQL plugin not available for agent ${instance.config.name}. ` +
              "Some database features may not work.",
          );
        }

        // Add model provider for non-scripted (LLM) agents
        if (!isScripted) {
          const modelProviderPlugin = await getModelProviderPlugin();
          if (modelProviderPlugin) {
            plugins.push(modelProviderPlugin);
          } else {
            console.warn(
              `[AgentManager] No model provider available for LLM agent ${instance.config.name}. ` +
                "The agent may fail when trying to use AI models. " +
                "Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY.",
            );
          }
        }

        const runtime = new AgentRuntime({
          character,
          plugins,
        });

        runtime.setSetting("CHECK_SHOULD_RESPOND", false);
        runtime.setSetting("HYPERSCAPE_AUTONOMY_MODE", autonomyMode);
        runtime.setSetting("HYPERSCAPE_SCRIPTED_ROLE", isScripted ? role : "");
        runtime.setSetting("HYPERSCAPE_SILENT_CHAT", silentChat);
        runtime.setSetting(
          "HYPERSCAPE_CHARACTER_ID",
          instance.config.characterId,
          true,
        );
        runtime.setSetting("HYPERSCAPE_SERVER_URL", wsUrl);
        runtime.setSetting("HYPERSCAPE_ACCOUNT_ID", instance.config.accountId);

        // Set up database for ElizaOS SQL plugin
        // Use PGLite (embedded PostgreSQL) by default - simpler than sharing game's database
        // Each agent gets its own data directory to avoid conflicts
        const agentDataDir = process.env.ELIZAOS_DATA_DIR || "./data/elizaos";
        const agentDbPath = `${agentDataDir}/${instance.config.characterId}`;
        runtime.setSetting("PGLITE_DATA_DIR", agentDbPath);
        console.log(
          `[AgentManager] Using PGLite database for agent ${instance.config.name} at ${agentDbPath}`,
        );

        // Wrap initialization in a promise we can track and abort
        const initPromise = (async () => {
          // Check abort before each async step
          if (abortController.signal.aborted) {
            throw new Error(
              "Agent initialization aborted (shutdown in progress)",
            );
          }

          // Note: allowNoDatabase is no longer supported in newer ElizaOS versions
          console.log(
            `[AgentManager] Initializing ElizaOS runtime for agent ${instance.config.name}...`,
          );
          try {
            await runtime.initialize({
              skipMigrations: false,
            } as { skipMigrations?: boolean });
            console.log(
              `[AgentManager] ElizaOS runtime initialized for agent ${instance.config.name}`,
            );
          } catch (initError) {
            console.error(
              `[AgentManager] ElizaOS runtime.initialize() failed for agent ${instance.config.name}:`,
              initError instanceof Error
                ? initError.message
                : String(initError),
            );
            throw initError;
          }

          if (abortController.signal.aborted) {
            throw new Error(
              "Agent initialization aborted (shutdown in progress)",
            );
          }

          await runtime.ensureConnection({
            entityId: stringToUuid(
              `embedded-agent-${instance.config.characterId}`,
            ),
            roomId: stringToUuid(
              `embedded-agent-room-${instance.config.characterId}`,
            ),
            worldId: stringToUuid("hyperscape-world"),
            userName: instance.config.name,
            source: "hyperscape-embedded",
            channelId: instance.config.characterId,
            type: ChannelType.DM,
          });

          if (abortController.signal.aborted) {
            throw new Error(
              "Agent initialization aborted (shutdown in progress)",
            );
          }

          // Wait for the HyperscapeService to be available (it may take time to connect)
          // The service is started during runtime.initialize() but connection is async
          // Note: ElizaOS registers services AFTER their start() method returns, so we need to poll
          const SERVICE_WAIT_TIMEOUT_MS = 30000; // 30 seconds max wait
          const SERVICE_POLL_INTERVAL_MS = 500; // Check every 500ms
          const startWaitTime = Date.now();
          let service: HyperscapeService | undefined;

          console.log(
            `[AgentManager] Waiting for HyperscapeService to be available for agent ${instance.config.name}...`,
          );

          while (
            !service &&
            Date.now() - startWaitTime < SERVICE_WAIT_TIMEOUT_MS
          ) {
            if (abortController.signal.aborted) {
              throw new Error(
                "Agent initialization aborted (shutdown in progress)",
              );
            }

            // Cast needed because HyperscapeService extends Service but has protected properties
            service = runtime.getService("hyperscapeService") as unknown as
              | HyperscapeService
              | undefined;

            if (!service) {
              // Log progress every 5 seconds
              const elapsed = Date.now() - startWaitTime;
              if (elapsed > 0 && elapsed % 5000 < SERVICE_POLL_INTERVAL_MS) {
                console.log(
                  `[AgentManager] Waiting for HyperscapeService... (${Math.round(elapsed / 1000)}s elapsed)`,
                );
              }
              await new Promise((resolve) =>
                setTimeout(resolve, SERVICE_POLL_INTERVAL_MS),
              );
            }
          }

          if (service) {
            console.log(
              `[AgentManager] HyperscapeService found for agent ${instance.config.name} ` +
                `after ${Date.now() - startWaitTime}ms`,
            );
          }

          if (!service) {
            // Try to get diagnostic info about available services
            let debugInfo = "";
            try {
              // ElizaOS runtime may expose services via different methods
              const runtimeAny = runtime as unknown as Record<string, unknown>;
              if (
                typeof runtimeAny.services === "object" &&
                runtimeAny.services !== null
              ) {
                const servicesObj = runtimeAny.services as Record<
                  string,
                  unknown
                >;
                const serviceKeys = Object.keys(servicesObj);
                debugInfo = ` Available service keys: ${serviceKeys.length > 0 ? serviceKeys.join(", ") : "none"}`;
              }
            } catch {
              // Ignore debug info errors
            }
            console.error(
              `[AgentManager] HyperscapeService not found after ${SERVICE_WAIT_TIMEOUT_MS}ms.${debugInfo}`,
            );
            throw new Error(
              "Hyperscape service not available in runtime after " +
                `${SERVICE_WAIT_TIMEOUT_MS / 1000}s timeout. The service may have failed to start.`,
            );
          }

          instance.runtime = runtime;
          instance.service = service;
        })();

        instance.initializationPromise = initPromise;

        await initPromise;
      }

      // Clear initialization tracking on success
      instance.initializationPromise = undefined;
      instance.initializationAbort = undefined;

      instance.state = "running";
      instance.lastActivity = Date.now();
      instance.error = undefined;

      console.log(
        `[AgentManager] ✅ Agent ${instance.config.name} is now running`,
      );
    } catch (err) {
      // Clear initialization tracking on error
      instance.initializationPromise = undefined;
      instance.initializationAbort = undefined;

      // Don't set error state if we aborted due to shutdown
      if (this.isShuttingDown) {
        instance.state = "stopped";
        console.log(
          `[AgentManager] Agent ${instance.config.name} initialization aborted (shutdown)`,
        );
        return;
      }

      instance.state = "error";
      instance.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Stop an agent (remove from world, stop autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async stopAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state === "stopped") {
      console.log(`[AgentManager] Agent ${characterId} is already stopped`);
      return;
    }

    console.log(
      `[AgentManager] Stopping agent: ${instance.config.name} (${characterId})`,
    );

    try {
      if (instance.runtime) {
        await instance.runtime.stop();
      }
      instance.runtime = undefined;
      instance.service = undefined;
      instance.state = "stopped";
      instance.lastActivity = Date.now();

      console.log(`[AgentManager] ✅ Agent ${instance.config.name} stopped`);
    } catch (err) {
      instance.state = "error";
      instance.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Pause an agent (keep entity but stop autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async pauseAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "running") {
      console.log(
        `[AgentManager] Agent ${characterId} is not running (state: ${instance.state})`,
      );
      return;
    }

    console.log(
      `[AgentManager] Pausing agent: ${instance.config.name} (${characterId})`,
    );

    if (instance.service) {
      instance.service.setAutonomousBehaviorEnabled(false);
    }
    instance.state = "paused";
    instance.lastActivity = Date.now();

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} paused`);
  }

  /**
   * Resume a paused agent
   *
   * @param characterId - The agent's character ID
   */
  async resumeAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "paused") {
      console.log(
        `[AgentManager] Agent ${characterId} is not paused (state: ${instance.state})`,
      );
      return;
    }

    console.log(
      `[AgentManager] Resuming agent: ${instance.config.name} (${characterId})`,
    );

    if (instance.service) {
      instance.service.setAutonomousBehaviorEnabled(true);
    }
    instance.state = "running";
    instance.lastActivity = Date.now();

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} resumed`);
  }

  /**
   * Remove an agent completely
   *
   * @param characterId - The agent's character ID
   */
  async removeAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      console.log(
        `[AgentManager] Agent ${characterId} not found, nothing to remove`,
      );
      return;
    }

    console.log(
      `[AgentManager] Removing agent: ${instance.config.name} (${characterId})`,
    );

    // Stop first if running
    if (instance.state === "running" || instance.state === "paused") {
      await this.stopAgent(characterId);
    }

    // Remove from tracking
    this.agents.delete(characterId);

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} removed`);
  }

  /**
   * Get information about an agent
   *
   * @param characterId - The agent's character ID
   * @returns Agent information or null if not found
   */
  getAgentInfo(characterId: string): EmbeddedAgentInfo | null {
    const instance = this.agents.get(characterId);
    if (!instance) {
      return null;
    }

    const gameState = instance.service?.getGameState();
    const playerEntity = gameState?.playerEntity || null;

    return {
      agentId: characterId,
      characterId,
      accountId: instance.config.accountId,
      name: instance.config.name,
      scriptedRole: instance.config.scriptedRole,
      state: instance.state,
      entityId: playerEntity?.id || null,
      position: playerEntity?.position || null,
      health: playerEntity?.health?.current ?? null,
      maxHealth: playerEntity?.health?.max ?? null,
      startedAt: instance.startedAt,
      lastActivity: instance.lastActivity,
      error: instance.error,
    };
  }

  /**
   * Get information about all agents
   *
   * @returns Array of agent information
   */
  getAllAgents(): EmbeddedAgentInfo[] {
    const result: EmbeddedAgentInfo[] = [];
    for (const [characterId] of this.agents) {
      const info = this.getAgentInfo(characterId);
      if (info) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Get agents by account ID
   *
   * @param accountId - The account ID to filter by
   * @returns Array of agent information for the account
   */
  getAgentsByAccount(accountId: string): EmbeddedAgentInfo[] {
    return this.getAllAgents().filter((agent) => agent.accountId === accountId);
  }

  /**
   * Check if an agent exists
   *
   * @param characterId - The agent's character ID
   * @returns True if the agent exists
   */
  hasAgent(characterId: string): boolean {
    return this.agents.has(characterId);
  }

  /**
   * Get the embedded service for an agent (for direct manipulation)
   *
   * @param characterId - The agent's character ID
   * @returns The embedded service or null
   */
  getAgentService(characterId: string): HyperscapeService | null {
    return this.agents.get(characterId)?.service || null;
  }

  /**
   * Send a command to an agent
   *
   * @param characterId - The agent's character ID
   * @param command - The command type
   * @param data - Command data
   */
  async sendCommand(
    characterId: string,
    command: string,
    data: CommandData,
  ): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "running") {
      throw new Error(`Agent ${characterId} is not running`);
    }

    instance.lastActivity = Date.now();

    const service = instance.service;
    if (!service) {
      throw new Error(`Agent ${characterId} has no active service`);
    }

    const commandData = data;

    switch (command) {
      case "move": {
        const target = commandData.target;
        if (!target) {
          throw new Error("Move command requires target [x, y, z]");
        }
        await service.executeMove({
          target,
          runMode: commandData.runMode,
        });
        break;
      }

      case "attack": {
        const targetId = commandData.targetId;
        if (!targetId) {
          throw new Error("Attack command requires targetId");
        }
        await service.executeAttack({ targetEntityId: targetId });
        break;
      }

      case "gather": {
        const resourceId = commandData.resourceId;
        const skill = commandData.skill;
        if (!resourceId) {
          throw new Error("Gather command requires resourceId");
        }
        await service.executeGatherResource({
          resourceEntityId: resourceId,
          skill: skill || this.resolveGatherSkill(service, resourceId),
        });
        break;
      }

      case "pickup": {
        const itemId = commandData.itemId;
        if (!itemId) {
          throw new Error("Pickup command requires itemId");
        }
        await service.executePickupItem(itemId);
        break;
      }

      case "drop": {
        const itemId = commandData.itemId;
        if (!itemId) {
          throw new Error("Drop command requires itemId");
        }
        await service.executeDropItem(
          itemId,
          commandData.quantity,
          commandData.slot,
        );
        break;
      }

      case "equip": {
        const itemId = commandData.itemId;
        if (!itemId) {
          throw new Error("Equip command requires itemId");
        }
        const equipSlot = this.resolveEquipSlot(
          service,
          itemId,
          commandData.equipSlot,
        );
        await service.executeEquipItem({ itemId, equipSlot });
        break;
      }

      case "use": {
        const itemId = commandData.itemId;
        if (!itemId) {
          throw new Error("Use command requires itemId");
        }
        await service.executeUseItem({
          itemId,
          slot: commandData.slot,
        });
        break;
      }

      case "chat": {
        const message = commandData.message;
        if (!message) {
          throw new Error("Chat command requires message");
        }
        await service.executeChatMessage({ message });
        break;
      }

      case "stop": {
        const target = this.getPositionArray(
          service.getGameState().playerEntity?.position,
        );
        if (!target) {
          throw new Error("Stop command requires active player position");
        }
        await service.executeMove({
          target,
          cancel: true,
        });
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private resolveGatherSkill(
    service: HyperscapeService,
    resourceId: string,
  ): GatherSkill {
    const resource = service
      .getNearbyEntities()
      .find((entity) => entity.id === resourceId);
    if (!resource) return "woodcutting";

    const harvestSkill = resource.harvestSkill;
    if (harvestSkill) return harvestSkill;

    const resourceType = (resource.resourceType || "").toLowerCase();
    if (resourceType === "fishing_spot") return "fishing";
    if (resourceType === "mining_rock" || resourceType === "ore")
      return "mining";

    return "woodcutting";
  }

  private resolveEquipSlot(
    service: HyperscapeService,
    itemId: string,
    equipSlotRaw?: string,
  ): EquipSlot {
    const normalized = normalizeEquipSlot(equipSlotRaw);
    if (normalized) return normalized;

    const player = service.getPlayerEntity();
    if (!player) return "weapon";

    const item = player.items.find(
      (entry) => entry.id === itemId || entry.itemId === itemId,
    );
    const itemName = (
      item?.name ||
      item?.item?.name ||
      item?.itemId ||
      ""
    ).toLowerCase();

    if (itemName.includes("shield")) return "shield";
    if (itemName.includes("helmet") || itemName.includes("helm"))
      return "helmet";
    if (itemName.includes("platebody") || itemName.includes("body"))
      return "body";
    if (itemName.includes("legs") || itemName.includes("platelegs"))
      return "legs";
    if (itemName.includes("boots")) return "boots";
    if (itemName.includes("gloves")) return "gloves";
    if (itemName.includes("cape")) return "cape";
    if (itemName.includes("amulet")) return "amulet";
    if (itemName.includes("ring")) return "ring";
    if (itemName.includes("arrow")) return "arrows";

    return "weapon";
  }

  private getPositionArray(
    pos:
      | [number, number, number]
      | { x: number; y?: number; z: number }
      | null
      | undefined,
  ): [number, number, number] | null {
    if (!pos) return null;
    if (Array.isArray(pos) && pos.length >= 3) {
      return [pos[0], pos[1], pos[2]];
    }
    if (typeof pos === "object") {
      const obj = pos as { x: number; y?: number; z: number };
      return [obj.x, obj.y ?? 0, obj.z];
    }
    return null;
  }

  /**
   * Load agents from database that are marked as AI agents
   * and auto-start them
   */
  async loadAgentsFromDatabase(): Promise<void> {
    // Check if shutdown is in progress
    if (this.isShuttingDown) {
      console.log("[AgentManager] Shutdown in progress, skipping agent load");
      return;
    }

    console.log("[AgentManager] Loading agents from database...");

    const databaseSystem = this.world.getSystem("database") as
      | DatabaseSystem
      | undefined;
    const db = databaseSystem?.getDb();

    if (!db) {
      console.warn(
        "[AgentManager] Database not available, skipping agent load",
      );
      return;
    }

    try {
      const enableDevBots = this.shouldEnableDevBots();
      const devBotIds = new Set(
        DEV_BOT_DEFINITIONS.map((bot) =>
          stringToUuid(`hyperscape-dev-bot-${bot.role}`),
        ),
      );

      // Query characters marked as agents
      const { characters, users } = await import("../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // isAgent is stored as integer (1 = true, 0 = false) in database
      const agentCharacters = await db
        .select()
        .from(characters)
        .where(eq(characters.isAgent, 1));

      const devBots: Array<{
        id: string;
        accountId: string;
        name: string;
        role: ScriptedRole;
      }> = [];

      if (enableDevBots) {
        const devAccountId = stringToUuid("hyperscape-dev-bots");
        const existingUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, devAccountId));

        if (existingUsers.length === 0) {
          await db.insert(users).values({
            id: devAccountId,
            name: "Dev Bots",
            roles: "",
            createdAt: new Date().toISOString(),
          });
        }

        for (const bot of DEV_BOT_DEFINITIONS) {
          const botId = stringToUuid(`hyperscape-dev-bot-${bot.role}`);
          const existing = await db
            .select({
              id: characters.id,
              accountId: characters.accountId,
              isAgent: characters.isAgent,
            })
            .from(characters)
            .where(eq(characters.id, botId));

          if (existing.length === 0) {
            await db.insert(characters).values({
              id: botId,
              accountId: devAccountId,
              name: bot.name,
              isAgent: 1,
              createdAt: Date.now(),
              lastLogin: Date.now(),
            });
          } else if (existing[0].accountId !== devAccountId) {
            console.warn(
              `[AgentManager] Dev bot id ${botId} belongs to a different account, skipping auto-start`,
            );
            continue;
          } else if (existing[0].isAgent !== 1) {
            await db
              .update(characters)
              .set({ isAgent: 1 })
              .where(eq(characters.id, botId));
          }

          devBots.push({
            id: botId,
            accountId: devAccountId,
            name: bot.name,
            role: bot.role,
          });
        }
      }

      console.log(
        `[AgentManager] Found ${agentCharacters.length} agent character(s) in database`,
      );

      // Create agents for each (with staggered startup to avoid resource contention)
      const AGENT_START_DELAY_MS = 1000; // 1 second delay between agent starts

      for (const char of agentCharacters) {
        // Check shutdown before each agent
        if (this.isShuttingDown) {
          console.log(
            "[AgentManager] Shutdown in progress, stopping agent load",
          );
          break;
        }

        if (
          devBotIds.has(
            char.id as `${string}-${string}-${string}-${string}-${string}`,
          )
        ) {
          continue;
        }
        try {
          await this.createAgent({
            characterId: char.id,
            accountId: char.accountId,
            name: char.name,
            autoStart: true,
          });
          // Small delay between agents to avoid resource contention
          await new Promise((resolve) =>
            setTimeout(resolve, AGENT_START_DELAY_MS),
          );
        } catch (err) {
          console.error(
            `[AgentManager] Failed to create agent for ${char.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      for (const bot of devBots) {
        // Check shutdown before each bot
        if (this.isShuttingDown) {
          console.log("[AgentManager] Shutdown in progress, stopping bot load");
          break;
        }

        try {
          await this.createAgent({
            characterId: bot.id,
            accountId: bot.accountId,
            name: bot.name,
            scriptedRole: bot.role,
            autoStart: true,
          });
          // Small delay between agents to avoid resource contention
          await new Promise((resolve) =>
            setTimeout(resolve, AGENT_START_DELAY_MS),
          );
        } catch (err) {
          console.error(
            `[AgentManager] Failed to create dev bot ${bot.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      console.log(`[AgentManager] ✅ Loaded ${this.agents.size} agent(s)`);
    } catch (err) {
      console.error(
        "[AgentManager] Error loading agents from database:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private shouldEnableDevBots(): boolean {
    const setting = (process.env.HYPERSCAPE_DEV_BOTS || "").toLowerCase();
    if (setting === "true") return true;
    if (setting === "false") return false;
    return process.env.NODE_ENV === "development";
  }

  /**
   * Gracefully shut down all agents
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.log(`[AgentManager] Shutting down ${this.agents.size} agent(s)...`);

    // First, abort any pending initializations to prevent timeout errors
    let abortedCount = 0;
    for (const [_characterId, instance] of this.agents) {
      if (instance.initializationAbort) {
        console.log(
          `[AgentManager] Aborting initialization for ${instance.config.name}`,
        );
        instance.initializationAbort.abort();
        abortedCount++;
      }
    }
    if (abortedCount > 0) {
      console.log(
        `[AgentManager] Aborted ${abortedCount} pending initialization(s)`,
      );
    }

    // Wait briefly for abort signals to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Wait for any pending initializations to complete/fail (with a timeout)
    const initPromises: Promise<void>[] = [];
    for (const [_characterId, instance] of this.agents) {
      if (instance.initializationPromise) {
        initPromises.push(
          instance.initializationPromise.catch(() => {
            // Ignore errors - we expect aborted initializations to fail
          }),
        );
      }
    }
    if (initPromises.length > 0) {
      console.log(
        `[AgentManager] Waiting for ${initPromises.length} initialization(s) to complete...`,
      );
      // Wait up to 5 seconds for initializations to abort
      await Promise.race([
        Promise.all(initPromises),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }

    // Now stop all running agents
    const stopPromises: Promise<void>[] = [];

    for (const [characterId, instance] of this.agents) {
      // Skip agents that were still initializing (already aborted)
      if (instance.state === "initializing") {
        instance.state = "stopped";
        continue;
      }

      stopPromises.push(
        this.stopAgent(characterId).catch((err) => {
          console.error(
            `[AgentManager] Error stopping agent ${characterId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }),
      );
    }

    await Promise.all(stopPromises);

    this.agents.clear();
    console.log("[AgentManager] ✅ All agents shut down");
  }
}

/**
 * Global agent manager instance (set during server startup)
 */
let globalAgentManager: AgentManager | null = null;

/**
 * Get the global agent manager instance
 */
export function getAgentManager(): AgentManager | null {
  return globalAgentManager;
}

/**
 * Set the global agent manager instance (called during startup)
 */
export function setAgentManager(manager: AgentManager): void {
  globalAgentManager = manager;
}
