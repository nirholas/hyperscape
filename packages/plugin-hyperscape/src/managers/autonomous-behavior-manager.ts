/**
 * AutonomousBehaviorManager - Full ElizaOS Decision Loop
 *
 * This manager implements the complete ElizaOS action/decision flow for
 * autonomous agent behavior. Unlike the simple ExplorationManager, this
 * uses the full ElizaOS pipeline:
 *
 * 1. Create internal "tick" message
 * 2. Compose state (gather context from all providers)
 * 3. Run evaluators (assess situation)
 * 4. Process actions (LLM selects action based on state)
 * 5. Execute selected action
 * 6. Store result in memory
 *
 * This enables the agent to make intelligent, context-aware decisions
 * about what to do autonomously.
 */

import {
  logger,
  ModelType,
  type IAgentRuntime,
  type Memory,
  type UUID,
  type Action,
  type State,
} from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";

// Import autonomous actions directly for execution
import {
  exploreAction,
  fleeAction,
  idleAction,
  approachEntityAction,
  attackEntityAction,
  lootStarterChestAction,
} from "../actions/autonomous.js";
import { setGoalAction, navigateToAction } from "../actions/goals.js";
import {
  chopTreeAction,
  mineRockAction,
  catchFishAction,
} from "../actions/skills.js";
import { equipItemAction } from "../actions/inventory.js";
import { KNOWN_LOCATIONS } from "../providers/goalProvider.js";
import {
  hasCombatCapableItem,
  hasWeapon,
  hasOre,
  hasBars,
} from "../utils/item-detection.js";

// Configuration
const DEFAULT_TICK_INTERVAL = 10000; // 10 seconds between decisions
const MIN_TICK_INTERVAL = 5000; // Minimum 5 seconds
const MAX_TICK_INTERVAL = 30000; // Maximum 30 seconds

export interface AutonomousBehaviorConfig {
  /** Interval between decision ticks in milliseconds */
  tickInterval?: number;
  /** Whether to log detailed debug info */
  debug?: boolean;
  /** Actions to consider for autonomous behavior */
  allowedActions?: string[];
}

/** Simple goal structure stored in memory */
export interface CurrentGoal {
  type:
    | "combat_training"
    | "woodcutting"
    | "mining"
    | "smithing"
    | "fishing"
    | "firemaking"
    | "cooking"
    | "exploration"
    | "idle"
    | "starter_items";
  description: string;
  target: number;
  progress: number;
  location?: string;
  /** Dynamic position found at runtime (overrides KNOWN_LOCATIONS lookup) */
  targetPosition?: [number, number, number];
  targetEntity?: string;
  /** For skill-based goals: which skill to train */
  targetSkill?: string;
  /** For skill-based goals: target level to reach */
  targetSkillLevel?: number;
  startedAt: number;
  /** If true, autonomous SET_GOAL will skip (manual override active) */
  locked?: boolean;
  /** Who locked the goal */
  lockedBy?: "manual" | "autonomous";
  /** When the goal was locked */
  lockedAt?: number;
  /** Original user message for multi-step user commands */
  userMessage?: string;
}

export class AutonomousBehaviorManager {
  private isRunning = false;
  private runtime: IAgentRuntime;
  private service: HyperscapeService | null = null;
  private tickInterval: number;
  private debug: boolean;
  private allowedActions: Set<string>;
  private lastTickTime = 0;
  private tickCount = 0;

  /** Current goal - persists between ticks */
  private currentGoal: CurrentGoal | null = null;

  /** If true, the user explicitly paused goals - don't auto-set new ones */
  private goalPaused: boolean = false;

  /**
   * Goal history - tracks recently completed goals to encourage variety
   * Used by goal templates provider to penalize repetitive goal selection
   */
  private goalHistory: Array<{ goal: CurrentGoal; completedAt: number }> = [];
  private readonly GOAL_HISTORY_RETENTION = 5 * 60 * 1000; // Keep history for 5 minutes
  private readonly MAX_GOAL_HISTORY = 10; // Max goals to track

  /**
   * Target locking for combat - prevents switching targets mid-fight
   * Agent should finish killing current target before switching to another
   */
  private lockedTargetId: string | null = null;
  private lockedTargetStartTime: number = 0;
  private readonly TARGET_LOCK_TIMEOUT = 30000; // 30s max lock duration

  constructor(runtime: IAgentRuntime, config?: AutonomousBehaviorConfig) {
    this.runtime = runtime;
    this.tickInterval = Math.max(
      MIN_TICK_INTERVAL,
      Math.min(
        MAX_TICK_INTERVAL,
        config?.tickInterval ?? DEFAULT_TICK_INTERVAL,
      ),
    );
    this.debug = config?.debug ?? false;

    // Default allowed actions for autonomous behavior
    this.allowedActions = new Set(
      config?.allowedActions ?? [
        // Goal-oriented actions (highest priority)
        "SET_GOAL",
        "NAVIGATE_TO",
        // Combat and interaction
        "ATTACK_ENTITY",
        "APPROACH_ENTITY",
        // Survival
        "FLEE",
        // Exploration
        "EXPLORE",
        // Skills
        "CHOP_TREE",
        "MINE_ROCK",
        "CATCH_FISH",
        // Equipment management
        "EQUIP_ITEM",
        // World interactions
        "LOOT_STARTER_CHEST",
        // Idle
        "IDLE",
      ],
    );
  }

  /**
   * Check if the manager is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Start autonomous behavior
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("[AutonomousBehavior] Already running, ignoring start");
      return;
    }

    this.service =
      this.runtime.getService<HyperscapeService>("hyperscapeService");
    if (!this.service) {
      logger.error(
        "[AutonomousBehavior] HyperscapeService not found, cannot start",
      );
      return;
    }

    logger.info("[AutonomousBehavior] Starting autonomous behavior...");
    logger.info(`[AutonomousBehavior] Tick interval: ${this.tickInterval}ms`);
    logger.info(
      `[AutonomousBehavior] Allowed actions: ${Array.from(this.allowedActions).join(", ")}`,
    );

    this.isRunning = true;
    this.tickCount = 0;
    this.runLoop().catch((err) => {
      logger.error(
        "[AutonomousBehavior] Loop crashed:",
        err instanceof Error ? err.message : String(err),
      );
      this.isRunning = false;
    });
  }

  /**
   * Stop autonomous behavior
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn("[AutonomousBehavior] Not running, ignoring stop");
      return;
    }

    logger.info("[AutonomousBehavior] Stopping autonomous behavior...");
    this.isRunning = false;
  }

  /**
   * Main behavior loop
   */
  private async runLoop(): Promise<void> {
    // Initial delay to let things settle
    await this.sleep(3000);

    while (this.isRunning) {
      const tickStart = Date.now();

      try {
        await this.tick();
      } catch (error) {
        logger.error(
          "[AutonomousBehavior] Error in tick:",
          error instanceof Error ? error.message : String(error),
        );
      }

      // Calculate how long to wait until next tick
      const tickDuration = Date.now() - tickStart;
      const sleepTime = Math.max(0, this.tickInterval - tickDuration);

      if (this.debug) {
        logger.debug(
          `[AutonomousBehavior] Tick ${this.tickCount} took ${tickDuration}ms, sleeping ${sleepTime}ms`,
        );
      }

      await this.sleep(sleepTime);
    }

    logger.info("[AutonomousBehavior] Behavior loop ended");
  }

  /**
   * Single decision tick - the full ElizaOS pipeline
   */
  private async tick(): Promise<void> {
    this.tickCount++;
    this.lastTickTime = Date.now();

    // Step 1: Validate we can act
    if (!this.canAct()) {
      if (this.debug) {
        logger.debug("[AutonomousBehavior] Cannot act, skipping tick");
      }
      return;
    }

    logger.info(`[AutonomousBehavior] === Tick ${this.tickCount} ===`);

    // SURVIVAL OVERRIDE: Force flee if health is critical with threats nearby
    // This bypasses LLM selection to ensure agent survives
    const forceFleeResult = await this.checkForceFleeNeeded();
    if (forceFleeResult.shouldFlee) {
      logger.warn(
        `[AutonomousBehavior] ⚠️ FORCE FLEE: ${forceFleeResult.reason}`,
      );

      // Clear target lock - survival > combat
      this.clearTargetLock();

      // Create minimal state for flee action
      const fleeMessage = this.createTickMessage();
      const fleeState = await this.runtime.composeState(fleeMessage);

      // Execute flee directly, bypassing LLM selection
      await this.executeAction(fleeAction, fleeMessage, fleeState);
      return;
    }

    // NOTE: Removed STARTER ITEMS OVERRIDE - LLM now decides when to loot chest
    // The LLM has full context about the starter_items goal and can choose appropriately

    // NOTE: Removed COMBAT READINESS OVERRIDE - LLM now decides when to equip weapons
    // The LLM has full context about combat goals and equipment status

    // Check for locked user command goal - continue executing it
    if (this.currentGoal?.locked && this.currentGoal?.lockedBy === "manual") {
      const goalDescription = this.currentGoal.description || "";
      const originalUserMessage = this.currentGoal.userMessage || "";
      logger.info(
        `[AutonomousBehavior] 🔒 Locked user command goal: ${goalDescription}`,
      );
      logger.info(
        `[AutonomousBehavior] 📝 Original user message: "${originalUserMessage}"`,
      );

      // Extract action name from goal description (format: "User command: ACTION_NAME - ...")
      const actionMatch = goalDescription.match(/User command: (\w+)/);
      if (actionMatch) {
        const actionName = actionMatch[1];
        logger.info(
          `[AutonomousBehavior] Continuing user command: ${actionName}`,
        );

        // Import and execute the user's action
        const { pickupItemAction, dropItemAction } = await import(
          "../actions/inventory.js"
        );
        const { attackEntityAction } = await import("../actions/combat.js");
        const { chopTreeAction } = await import("../actions/skills.js");
        const { moveToAction } = await import("../actions/movement.js");

        const actionMap: Record<string, Action> = {
          PICKUP_ITEM: pickupItemAction,
          DROP_ITEM: dropItemAction,
          ATTACK_ENTITY: attackEntityAction,
          CHOP_TREE: chopTreeAction,
          MOVE_TO: moveToAction,
        };

        const userAction = actionMap[actionName];
        if (userAction) {
          // Create a message with the ORIGINAL user text so action handlers can match correctly
          const userCommandMessage: Memory = {
            id: crypto.randomUUID() as UUID,
            entityId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.runtime.agentId,
            content: {
              text: originalUserMessage, // Use original message for item/target matching!
              source: "user_command_continuation",
            },
            createdAt: Date.now(),
          };
          const state = await this.runtime.composeState(userCommandMessage);

          // Validate the action
          const isValid = await userAction.validate(
            this.runtime,
            userCommandMessage,
            state,
          );

          if (isValid) {
            logger.info(
              `[AutonomousBehavior] Executing user command action: ${actionName}`,
            );
            await this.executeAction(userAction, userCommandMessage, state);
            return; // Don't do normal tick processing
          } else {
            // Check if goal was set recently - agent might still be walking to target
            const goalAge = Date.now() - (this.currentGoal?.startedAt || 0);
            const GRACE_PERIOD_MS = 60000; // 60 seconds grace period for multi-step actions

            if (goalAge < GRACE_PERIOD_MS) {
              logger.info(
                `[AutonomousBehavior] User command action ${actionName} validation failed, but goal is only ${Math.round(goalAge / 1000)}s old - keeping goal (grace period)`,
              );
              // Skip this tick but don't clear the goal - agent might still be walking
              return;
            }

            logger.info(
              `[AutonomousBehavior] User command action ${actionName} no longer valid after ${Math.round(goalAge / 1000)}s, clearing goal`,
            );
            // Action is no longer valid (e.g., item picked up, target dead)
            // Clear the goal so normal behavior can resume
            this.clearGoal();
          }
        }
      }
    }

    // Step 2: Create internal "tick" message
    const tickMessage = this.createTickMessage();

    // Step 3: Compose state (gathers context from all providers)
    if (this.debug) logger.debug("[AutonomousBehavior] Composing state...");
    const state = await this.runtime.composeState(tickMessage);

    // Step 4: Run evaluators (assess the situation)
    if (this.debug) logger.debug("[AutonomousBehavior] Running evaluators...");
    const evaluatorResults = await this.runtime.evaluate(
      tickMessage,
      state,
      false, // didRespond
    );

    if (this.debug && evaluatorResults && evaluatorResults.length > 0) {
      logger.debug(
        `[AutonomousBehavior] ${evaluatorResults.length} evaluators ran: ${evaluatorResults.map((e) => e.name).join(", ")}`,
      );
    }

    // Step 5: Select and execute an action using the LLM
    if (this.debug) logger.debug("[AutonomousBehavior] Selecting action...");

    let selectedAction = await this.selectAction(tickMessage, state);

    if (!selectedAction) {
      logger.info("[AutonomousBehavior] No action selected this tick");
      return;
    }

    logger.info(
      `[AutonomousBehavior] LLM selected action: ${selectedAction.name}`,
    );

    // NOTE: Removed defensive overrides - LLM now has full autonomy to:
    // - Choose actions even without a goal (it will learn from context)
    // - Choose when to equip weapons (it has equipment context)
    // Only survival (FLEE) is still enforced above

    logger.info(
      `[AutonomousBehavior] Executing action: ${selectedAction.name}`,
    );

    // Step 6: Validate the selected action
    const isValid = await selectedAction.validate(
      this.runtime,
      tickMessage,
      state,
    );
    if (!isValid) {
      logger.warn(
        `[AutonomousBehavior] Action ${selectedAction.name} failed validation`,
      );

      // NOTE: Removed smart fallback logic that forced NAVIGATE_TO or goal actions
      // LLM will try again next tick with updated context
      // This gives more autonomy - let the LLM learn from failed validations

      // Simple fallback to IDLE - wait for next tick
      logger.info("[AutonomousBehavior] Falling back to IDLE");
      const idleValid = await idleAction.validate(
        this.runtime,
        tickMessage,
        state,
      );
      if (idleValid) {
        await this.executeAction(idleAction, tickMessage, state);
      }
      return;
    }

    // Step 7: Execute the selected action
    await this.executeAction(selectedAction, tickMessage, state);
  }

  /** Last LLM reasoning - synced to dashboard as agent thoughts */
  private lastThinking: string = "";

  /**
   * Select an action using the LLM based on current state
   * Now parses THINKING + ACTION format for genuine LLM reasoning
   */
  private async selectAction(
    _message: Memory,
    state: State,
  ): Promise<Action | null> {
    // Get available actions for autonomous behavior
    const availableActions = this.getAvailableActions();

    // Build the action selection prompt (now asks for THINKING + ACTION)
    const prompt = this.buildActionSelectionPrompt(state, availableActions);

    try {
      // Use the LLM to select an action - allow longer response for reasoning
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        stopSequences: [], // Don't cut off early - we want full reasoning
      });

      const responseText =
        typeof response === "string" ? response : String(response);

      // Parse THINKING and ACTION from the response
      const { thinking, actionName } = this.parseThinkingAndAction(
        responseText,
        availableActions,
      );

      // Store thinking for dashboard sync
      if (thinking) {
        this.lastThinking = thinking;
        logger.info(`[AutonomousBehavior] LLM Thinking: ${thinking}`);

        // Sync to dashboard via service
        this.syncThinkingToDashboard(thinking);
      }

      if (this.debug) {
        logger.debug(
          `[AutonomousBehavior] LLM full response:\n${responseText.trim()}`,
        );
      }

      let selectedActionName = actionName;

      if (!selectedActionName) {
        logger.warn(
          "[AutonomousBehavior] Could not parse action from LLM response, defaulting to EXPLORE",
        );
        this.lastThinking =
          "Could not determine action - exploring to find opportunities";
        this.syncThinkingToDashboard(this.lastThinking);
        return exploreAction;
      }

      // If goals are paused by user, block SET_GOAL and force IDLE
      if (this.goalPaused && selectedActionName === "SET_GOAL") {
        logger.info(
          "[AutonomousBehavior] Blocked SET_GOAL because goals are paused by user - forcing IDLE",
        );
        this.lastThinking = "Goals are paused - waiting for direction";
        this.syncThinkingToDashboard(this.lastThinking);
        selectedActionName = "IDLE";
      }

      logger.info(
        `[AutonomousBehavior] Selected action: ${selectedActionName}`,
      );

      // Find the action object
      const action = availableActions.find(
        (a) => a.name === selectedActionName,
      );
      return action || exploreAction;
    } catch (error) {
      logger.error(
        "[AutonomousBehavior] Error selecting action:",
        error instanceof Error ? error.message : String(error),
      );
      this.lastThinking = "Error occurred - exploring as fallback";
      this.syncThinkingToDashboard(this.lastThinking);
      return exploreAction;
    }
  }

  /**
   * Parse THINKING and ACTION from LLM response
   * Handles format: "THINKING: [reasoning]\nACTION: [action_name]"
   */
  private parseThinkingAndAction(
    response: string,
    actions: Action[],
  ): { thinking: string; actionName: string | null } {
    let thinking = "";
    let actionName: string | null = null;

    // Try to extract THINKING section
    const thinkingMatch = response.match(/THINKING:\s*(.+?)(?=ACTION:|$)/is);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
      // Clean up any trailing whitespace or newlines
      thinking = thinking.replace(/\n+$/, "").trim();
      // Limit length for dashboard display
      if (thinking.length > 500) {
        thinking = thinking.substring(0, 497) + "...";
      }
    }

    // Try to extract ACTION section
    const actionMatch = response.match(/ACTION:\s*(\w+)/i);
    if (actionMatch) {
      const rawAction = actionMatch[1].toUpperCase();
      // Verify it's a valid action
      const validAction = actions.find((a) => a.name === rawAction);
      if (validAction) {
        actionName = validAction.name;
      }
    }

    // Fallback: if no ACTION: prefix, try to find any action name in the response
    if (!actionName) {
      actionName = this.parseActionFromResponse(response, actions);
    }

    // If no thinking was extracted but we have a response, use a cleaned version
    if (!thinking && response.trim()) {
      // Remove ACTION line and use rest as thinking
      thinking = response
        .replace(/ACTION:\s*\w+/gi, "")
        .replace(/THINKING:/gi, "")
        .trim();
      if (thinking.length > 500) {
        thinking = thinking.substring(0, 497) + "...";
      }
    }

    return { thinking, actionName };
  }

  /**
   * Sync the LLM's thinking to the dashboard for display
   */
  private syncThinkingToDashboard(thinking: string): void {
    if (!this.service) return;

    try {
      // Use the service to sync thoughts to the server
      // This will be displayed in the agent dashboard
      this.service.syncThoughtsToServer(thinking);
    } catch (error) {
      // Non-critical - just log and continue
      if (this.debug) {
        logger.debug(
          "[AutonomousBehavior] Could not sync thinking to dashboard:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /**
   * Get the last LLM reasoning (for external access)
   */
  getLastThinking(): string {
    return this.lastThinking;
  }

  /**
   * Get available autonomous actions
   */
  private getAvailableActions(): Action[] {
    return [
      setGoalAction,
      navigateToAction,
      attackEntityAction,
      chopTreeAction, // For woodcutting goals
      mineRockAction, // For mining goals
      catchFishAction, // For fishing goals
      equipItemAction, // For equipping weapons/armor
      lootStarterChestAction, // For getting starter tools
      exploreAction,
      fleeAction,
      idleAction,
      approachEntityAction,
    ];
  }

  /**
   * Build prompt for action selection with OSRS common sense knowledge
   * This prompt gives the LLM context AND common sense rules so it can make intelligent decisions
   */
  private buildActionSelectionPrompt(state: State, actions: Action[]): string {
    const goal = this.currentGoal;
    const player = this.service?.getPlayerEntity();
    const nearbyEntities = this.service?.getNearbyEntities() || [];

    // Extract player stats
    const skills = player?.skills as
      | Record<string, { level: number; xp: number }>
      | undefined;
    const skillsData = state.skillsData as
      | { totalLevel?: number; combatLevel?: number }
      | undefined;

    // Extract facts from evaluators
    const survivalFacts = (state.survivalFacts as string[]) || [];
    const combatFacts = (state.combatFacts as string[]) || [];

    // Get equipment status using item detection utilities
    const hasWeaponEquipped = hasWeapon(player);
    const hasCombatItem = hasCombatCapableItem(player);
    const playerHasOre = hasOre(player);
    const playerHasBars = hasBars(player);

    // Check for specific tools in inventory
    const inventory = player?.items || [];
    const inventoryNames = inventory.map(
      (item: { name?: string; itemId?: string }) =>
        (item.name || item.itemId || "").toLowerCase(),
    );
    const hasAxe = inventoryNames.some(
      (n: string) => n.includes("axe") || n.includes("hatchet"),
    );
    const hasPickaxe = inventoryNames.some((n: string) =>
      n.includes("pickaxe"),
    );
    const hasTinderbox = inventoryNames.some((n: string) =>
      n.includes("tinderbox"),
    );
    const hasNet = inventoryNames.some(
      (n: string) => n.includes("net") || n.includes("rod"),
    );
    const hasFood = inventoryNames.some(
      (n: string) =>
        n.includes("shrimp") ||
        n.includes("bread") ||
        n.includes("meat") ||
        n.includes("fish") ||
        n.includes("cooked") ||
        n.includes("trout") ||
        n.includes("salmon"),
    );
    const hasLogs = inventoryNames.some((n: string) => n.includes("log"));

    // Calculate health
    const playerAny = player as unknown as Record<string, unknown>;
    let currentHealth = 100,
      maxHealth = 100;
    if (player?.health && typeof player.health === "object") {
      currentHealth = player.health.current ?? 100;
      maxHealth = player.health.max ?? 100;
    } else if (typeof player?.health === "number") {
      currentHealth = player.health;
      maxHealth = (playerAny?.maxHealth as number) ?? 100;
    }
    const healthPercent =
      maxHealth > 0 ? Math.round((currentHealth / maxHealth) * 100) : 100;

    // Calculate distance helper
    const playerPos = player?.position;
    const getDistance = (entityPos: unknown): number | null => {
      if (!playerPos || !entityPos) return null;
      let ex = 0,
        ez = 0,
        px = 0,
        pz = 0;
      if (Array.isArray(entityPos)) {
        ex = entityPos[0];
        ez = entityPos[2];
      } else if (
        typeof entityPos === "object" &&
        entityPos &&
        "x" in entityPos
      ) {
        ex = (entityPos as { x: number; z: number }).x;
        ez = (entityPos as { x: number; z: number }).z;
      }
      if (Array.isArray(playerPos)) {
        px = playerPos[0];
        pz = playerPos[2];
      } else if (typeof playerPos === "object" && "x" in playerPos) {
        px = (playerPos as { x: number; z: number }).x;
        pz = (playerPos as { x: number; z: number }).z;
      }
      return Math.sqrt((px - ex) ** 2 + (pz - ez) ** 2);
    };

    // Count nearby entities
    let treesNearby = 0,
      rocksNearby = 0,
      fishingSpotsNearby = 0,
      mobsNearby = 0;
    let starterChestNearby = false;
    const mobNames: string[] = [];

    for (const entity of nearbyEntities) {
      const entityAny = entity as unknown as Record<string, unknown>;
      const dist = getDistance(entityAny.position);
      if (dist === null || dist > 25) continue;
      if (entityAny.depleted === true) continue;

      const name = entity.name?.toLowerCase() || "";
      const resourceType = entityAny.resourceType as string | undefined;
      const entityType = entityAny.entityType as string | undefined;

      if (entityType === "starter_chest" || name.includes("starter")) {
        starterChestNearby = true;
      } else if (resourceType === "tree" || name.includes("tree")) {
        treesNearby++;
      } else if (
        resourceType === "rock" ||
        resourceType === "ore" ||
        name.includes("rock") ||
        /copper|tin|iron|coal/i.test(name)
      ) {
        rocksNearby++;
      } else if (resourceType === "fishing_spot" || name.includes("fishing")) {
        fishingSpotsNearby++;
      } else if (
        entityAny.mobType ||
        entityAny.type === "mob" ||
        /goblin|bandit|skeleton|zombie|rat|spider|wolf/i.test(name)
      ) {
        if (entityAny.alive !== false) {
          mobsNearby++;
          if (mobNames.length < 3) mobNames.push(entity.name || "mob");
        }
      }
    }

    // Build the prompt with THINKING + ACTION format
    const lines: string[] = [];

    // === SYSTEM INSTRUCTION ===
    lines.push(
      "You are an AI agent playing an OSRS-style RPG. Think through your decision step by step.",
    );
    lines.push("");
    lines.push("RESPONSE FORMAT:");
    lines.push("THINKING: [Your reasoning about what to do and why]");
    lines.push("ACTION: [The action name to take]");
    lines.push("");

    // === OSRS COMMON SENSE RULES ===
    lines.push("=== GAME KNOWLEDGE (Important!) ===");
    lines.push("These are the fundamental rules of the game:");
    lines.push("");
    lines.push("GATHERING SKILLS:");
    lines.push(
      "- Woodcutting: You NEED an axe/hatchet to chop trees. Without one, you cannot cut trees.",
    );
    lines.push(
      "- Mining: You NEED a pickaxe to mine rocks. Without one, you cannot mine ore.",
    );
    lines.push(
      "- Fishing: You NEED a fishing net or rod to catch fish. Without one, you cannot fish.",
    );
    lines.push("- Firemaking: You NEED a tinderbox AND logs to make a fire.");
    lines.push("");
    lines.push("COMBAT:");
    lines.push(
      "- You fight MUCH better with a weapon equipped. Unarmed combat is very weak.",
    );
    lines.push(
      "- If you have a weapon in inventory but not equipped, EQUIP IT before fighting!",
    );
    lines.push(
      "- Having food lets you heal during combat. Without food, you might die.",
    );
    lines.push("- If health drops below 30%, you should FLEE to survive.");
    lines.push("");
    lines.push("STARTER EQUIPMENT:");
    lines.push(
      "- New players should look for a STARTER CHEST near spawn to get basic tools.",
    );
    lines.push(
      "- The starter chest gives: bronze hatchet, bronze pickaxe, tinderbox, fishing net, food.",
    );
    lines.push("- You can only loot the starter chest ONCE per character.");
    lines.push("");
    lines.push("GENERAL LOGIC:");
    lines.push("- Have a goal and work toward it. Don't wander aimlessly.");
    lines.push(
      "- If you need to be somewhere specific, NAVIGATE_TO that location first.",
    );
    lines.push(
      "- If the resources/mobs for your goal aren't nearby, travel to where they are.",
    );
    lines.push(
      "- Only use IDLE if you're genuinely waiting for something (like health regen).",
    );
    lines.push("");

    // === CURRENT STATUS ===
    lines.push("=== YOUR CURRENT STATUS ===");
    lines.push(`Health: ${healthPercent}% (${currentHealth}/${maxHealth})`);
    lines.push(`In Combat: ${player?.inCombat ? "Yes" : "No"}`);
    if (skills) {
      const combatSkills = ["attack", "strength", "defense"];
      const skillSummary = combatSkills
        .map((s) => (skills[s] ? `${s}:${skills[s].level}` : null))
        .filter(Boolean)
        .join(", ");
      if (skillSummary) lines.push(`Combat Skills: ${skillSummary}`);
      if (skillsData?.combatLevel)
        lines.push(`Combat Level: ${skillsData.combatLevel}`);
    }
    lines.push("");

    // === INVENTORY/EQUIPMENT ===
    lines.push("=== YOUR EQUIPMENT & INVENTORY ===");
    lines.push(`Weapon Equipped: ${hasWeaponEquipped ? "YES" : "NO"}`);
    if (!hasWeaponEquipped && hasCombatItem) {
      lines.push(
        `>>> You have a COMBAT WEAPON in inventory but NOT equipped! <<<`,
      );
    }
    lines.push(`Has Axe/Hatchet: ${hasAxe ? "Yes" : "No"}`);
    lines.push(`Has Pickaxe: ${hasPickaxe ? "Yes" : "No"}`);
    lines.push(`Has Fishing Equipment: ${hasNet ? "Yes" : "No"}`);
    lines.push(`Has Tinderbox: ${hasTinderbox ? "Yes" : "No"}`);
    lines.push(`Has Food: ${hasFood ? "Yes" : "No"}`);
    lines.push(`Has Logs: ${hasLogs ? "Yes" : "No"}`);
    if (playerHasOre) lines.push(`Has Ore: Yes (can smelt at furnace)`);
    if (playerHasBars) lines.push(`Has Bars: Yes (can smith at anvil)`);
    lines.push("");

    // === GOAL STATUS ===
    lines.push("=== YOUR CURRENT GOAL ===");
    if (goal) {
      lines.push(`Goal: ${goal.description}`);
      lines.push(`Type: ${goal.type}`);
      if (goal.targetSkill && goal.targetSkillLevel && skills) {
        const currentLevel = skills[goal.targetSkill]?.level ?? 1;
        lines.push(
          `Skill Progress: ${goal.targetSkill} level ${currentLevel}/${goal.targetSkillLevel}`,
        );
        if (currentLevel >= goal.targetSkillLevel) {
          lines.push(
            `*** GOAL COMPLETE! You've reached level ${goal.targetSkillLevel}. Set a new goal. ***`,
          );
        }
      } else {
        lines.push(`Progress: ${goal.progress}/${goal.target}`);
        if (goal.progress >= goal.target) {
          lines.push(`*** GOAL COMPLETE! Set a new goal. ***`);
        }
      }
      if (goal.location) lines.push(`Target Location: ${goal.location}`);
      if (goal.targetEntity) lines.push(`Target Entity: ${goal.targetEntity}`);
    } else if (this.goalPaused) {
      lines.push("Goals are PAUSED by user. Wait for direction or use IDLE.");
    } else {
      lines.push("*** NO GOAL SET ***");
      lines.push("You should SET_GOAL to give yourself direction!");
    }
    lines.push("");

    // === NEARBY ENVIRONMENT ===
    lines.push("=== WHAT'S NEARBY ===");
    if (starterChestNearby)
      lines.push(`STARTER CHEST: Yes! (can get starter tools)`);
    if (treesNearby > 0) lines.push(`Trees: ${treesNearby} (need axe to chop)`);
    if (rocksNearby > 0)
      lines.push(`Rocks/Ore: ${rocksNearby} (need pickaxe to mine)`);
    if (fishingSpotsNearby > 0)
      lines.push(`Fishing Spots: ${fishingSpotsNearby} (need net/rod)`);
    if (mobsNearby > 0)
      lines.push(`Attackable Mobs: ${mobsNearby} - ${mobNames.join(", ")}`);
    if (
      !starterChestNearby &&
      treesNearby === 0 &&
      rocksNearby === 0 &&
      fishingSpotsNearby === 0 &&
      mobsNearby === 0
    ) {
      lines.push("(Nothing of interest nearby - consider traveling)");
    }
    lines.push("");

    // === KNOWN LOCATIONS ===
    lines.push("=== WORLD LOCATIONS ===");
    lines.push("spawn: [0, 0] - Starting area with goblins for combat");
    lines.push(
      `forest: [${KNOWN_LOCATIONS.forest?.position[0]}, ${KNOWN_LOCATIONS.forest?.position[2]}] - Trees for woodcutting`,
    );
    lines.push(
      `mine: [${KNOWN_LOCATIONS.mine?.position[0]}, ${KNOWN_LOCATIONS.mine?.position[2]}] - Rocks for mining`,
    );
    lines.push(
      `fishing: [${KNOWN_LOCATIONS.fishing?.position[0]}, ${KNOWN_LOCATIONS.fishing?.position[2]}] - Fishing spots`,
    );
    lines.push("");

    // === SURVIVAL WARNINGS ===
    if (survivalFacts.length > 0 || combatFacts.length > 0) {
      lines.push("=== WARNINGS ===");
      survivalFacts.forEach((f) => lines.push(`! ${f}`));
      combatFacts.forEach((f) => lines.push(`! ${f}`));
      lines.push("");
    }

    // === AVAILABLE ACTIONS ===
    lines.push("=== AVAILABLE ACTIONS ===");
    for (const action of actions) {
      lines.push(`${action.name}: ${action.description}`);
    }
    lines.push("");

    // === DECISION GUIDANCE ===
    lines.push("=== MAKE YOUR DECISION ===");
    lines.push("Think about:");
    lines.push("1. What is your goal? Do you have one?");
    lines.push("2. Do you have the required tools/equipment for your goal?");
    lines.push(
      "3. Are the resources/mobs for your goal nearby, or do you need to travel?",
    );
    lines.push("4. Is your health safe? Should you flee or heal?");
    lines.push("");
    lines.push("Now reason through your decision:");
    lines.push("");
    lines.push("THINKING:");

    return lines.join("\n");
  }

  /**
   * Parse action name from LLM response
   */
  private parseActionFromResponse(
    response: string,
    actions: Action[],
  ): string | null {
    const upperResponse = response.toUpperCase().trim();

    // Look for exact action name matches
    for (const action of actions) {
      if (upperResponse.includes(action.name)) {
        return action.name;
      }
    }

    // Check for similes
    for (const action of actions) {
      if (action.similes) {
        for (const simile of action.similes) {
          if (upperResponse.includes(simile)) {
            return action.name;
          }
        }
      }
    }

    return null;
  }

  /**
   * Execute a selected action
   */
  private async executeAction(
    action: Action,
    message: Memory,
    state: State,
  ): Promise<void> {
    logger.info(`[AutonomousBehavior] Executing action: ${action.name}`);

    try {
      const result = await action.handler(
        this.runtime,
        message,
        state,
        undefined,
        async (content) => {
          // Callback when action produces output
          if (this.debug)
            logger.debug(`[AutonomousBehavior] Action output: ${content.text}`);

          // Store in memory for learning - use ElizaOS pattern (no manual id/createdAt)
          try {
            await this.runtime.createMemory(
              {
                entityId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId: this.runtime.agentId, // Use agentId as roomId (standard pattern)
                content: {
                  text: content.text || "Autonomous action taken",
                  action: content.action,
                  source: "autonomous_behavior",
                },
              },
              "messages",
              false, // not unique
            );

            if (this.debug) {
              logger.debug("[AutonomousBehavior] Stored action memory");
            }
          } catch (error) {
            // Memory storage is optional, don't fail the action
            logger.warn(
              "[AutonomousBehavior] Could not store memory:",
              error instanceof Error ? error.message : String(error),
            );
          }

          // Return empty array - the callback return value is not critical
          return [];
        },
      );

      if (result && typeof result === "object" && "success" in result) {
        if (result.success) {
          logger.info(
            `[AutonomousBehavior] Action ${action.name} completed successfully`,
          );
        } else {
          logger.warn(
            `[AutonomousBehavior] Action ${action.name} failed: ${result.error || "unknown error"}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `[AutonomousBehavior] Error executing action ${action.name}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Check if the agent can currently act
   */
  private canAct(): boolean {
    if (!this.service) {
      if (this.debug) logger.debug("[AutonomousBehavior] No service");
      return false;
    }

    if (!this.service.isConnected()) {
      if (this.debug) logger.debug("[AutonomousBehavior] Not connected");
      return false;
    }

    const player = this.service.getPlayerEntity();
    if (!player) {
      if (this.debug) logger.debug("[AutonomousBehavior] No player entity");
      return false;
    }

    // Only skip if explicitly dead - undefined means alive
    if (player.alive === false) {
      if (this.debug)
        logger.debug("[AutonomousBehavior] Player is explicitly dead");
      return false;
    }

    return true;
  }

  /**
   * Create an internal message to trigger the decision cycle
   */
  private createTickMessage(): Memory {
    // Build context message that will be seen by action selection
    const messageText = this.buildTickMessageText();

    return {
      id: crypto.randomUUID() as UUID,
      entityId: this.runtime.agentId,
      agentId: this.runtime.agentId,
      roomId: this.runtime.agentId, // Use agentId as roomId (standard ElizaOS pattern)
      content: {
        text: messageText,
        source: "autonomous_tick",
        inReplyTo: undefined,
      },
      createdAt: Date.now(),
    };
  }

  /**
   * Build the message text for the tick
   *
   * This gives the LLM context about what it should be doing
   */
  private buildTickMessageText(): string {
    const player = this.service?.getPlayerEntity();
    if (!player) {
      return "Autonomous decision tick - waiting for player entity";
    }

    // Defensive position check - position might not be loaded yet
    if (
      !player.position ||
      !Array.isArray(player.position) ||
      player.position.length < 3
    ) {
      return "Autonomous decision tick - waiting for player position data";
    }

    // Defensive health calculation
    const currentHealth =
      player.health?.current ??
      (player as unknown as { hp?: number }).hp ??
      100;
    const maxHealth =
      player.health?.max ??
      (player as unknown as { maxHp?: number }).maxHp ??
      100;
    const healthPercent =
      maxHealth > 0 ? Math.round((currentHealth / maxHealth) * 100) : 100;

    const nearbyEntities = this.service?.getNearbyEntities() || [];
    const nearbyCount = nearbyEntities.length;

    // Safe position formatting
    const posX =
      typeof player.position[0] === "number"
        ? player.position[0].toFixed(1)
        : "?";
    const posZ =
      typeof player.position[2] === "number"
        ? player.position[2].toFixed(1)
        : "?";

    // Build a natural language prompt for the decision
    const lines = [
      "AUTONOMOUS BEHAVIOR TICK",
      "",
      "You are an AI agent playing a 3D RPG game autonomously.",
      "Decide what action to take based on your current situation.",
      "",
      `Current Status:`,
      `- Health: ${healthPercent}%`,
      `- Position: [${posX}, ${posZ}]`,
      `- In Combat: ${player.inCombat ? "Yes" : "No"}`,
      `- Nearby Entities: ${nearbyCount}`,
      "",
      "Available actions: SET_GOAL, NAVIGATE_TO, ATTACK_ENTITY, EXPLORE, FLEE, IDLE, APPROACH_ENTITY",
      "",
      "GOAL-ORIENTED BEHAVIOR:",
      "1. You MUST have a goal. If no goal, use SET_GOAL first.",
      "2. If goal requires being at a location, use NAVIGATE_TO.",
      "3. At goal location, take appropriate action (ATTACK_ENTITY for combat goals).",
      "",
      "PRIORITY:",
      "- FLEE if health < 30% and danger",
      "- SET_GOAL if no active goal",
      "- NAVIGATE_TO if not at goal location",
      "- ATTACK_ENTITY if combat goal and mob nearby",
      "- EXPLORE if exploration goal",
      "- IDLE only if waiting for something",
      "",
      "What action should you take?",
    ];

    return lines.join("\n");
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get statistics about the behavior manager
   */
  getStats(): {
    running: boolean;
    tickCount: number;
    lastTickTime: number;
    tickInterval: number;
    hasGoal: boolean;
    goalType: string | null;
    goalProgress: string | null;
  } {
    return {
      running: this.isRunning,
      tickCount: this.tickCount,
      lastTickTime: this.lastTickTime,
      tickInterval: this.tickInterval,
      hasGoal: this.currentGoal !== null,
      goalType: this.currentGoal?.type ?? null,
      goalProgress: this.currentGoal
        ? `${this.currentGoal.progress}/${this.currentGoal.target}`
        : null,
    };
  }

  /**
   * Process a message using the canonical ElizaOS messageService pipeline.
   * Use this for responding to player chat messages.
   * For autonomous game behavior, the tick() method is preferred.
   */
  async processMessageCanonically(
    messageText: string,
    source: string = "hyperscape_chat",
  ): Promise<{ responded: boolean; responseText?: string }> {
    if (!this.runtime.messageService) {
      logger.warn(
        "[AutonomousBehavior] messageService not available, falling back to manual processing",
      );
      return { responded: false };
    }

    const message: Memory = {
      id: crypto.randomUUID() as UUID,
      entityId: this.runtime.agentId,
      agentId: this.runtime.agentId,
      roomId: this.runtime.agentId,
      content: {
        text: messageText,
        source,
      },
      createdAt: Date.now(),
    };

    let responseText = "";

    try {
      const result = await this.runtime.messageService.handleMessage(
        this.runtime,
        message,
        async (content) => {
          if (content.text) {
            responseText = content.text;
            logger.info(
              `[AutonomousBehavior] Canonical response: ${content.text}`,
            );
          }
          return [];
        },
      );

      return {
        responded: result.didRespond ?? responseText.length > 0,
        responseText: responseText || undefined,
      };
    } catch (error) {
      logger.error(
        "[AutonomousBehavior] Error in canonical message processing:",
        error instanceof Error ? error.message : String(error),
      );
      return { responded: false };
    }
  }

  /**
   * Get the current goal
   */
  getGoal(): CurrentGoal | null {
    return this.currentGoal;
  }

  /**
   * Set a new goal
   */
  setGoal(goal: CurrentGoal): void {
    // Save previous goal to history before setting new one
    if (this.currentGoal) {
      this.addToGoalHistory(this.currentGoal);
    }

    this.currentGoal = goal;
    // Only clear paused state for autonomous goals (not locked/user commands)
    // If it's a locked goal (user command while paused), keep paused state
    // so agent returns to idle after command completes
    if (!goal.locked) {
      this.goalPaused = false;
    }
    logger.info(
      `[AutonomousBehavior] Goal set: ${goal.description} (target: ${goal.target})${goal.locked ? " [locked]" : ""}`,
    );
    // Sync to server for dashboard display
    this.service?.syncGoalToServer();
  }

  /**
   * Clear the current goal
   */
  clearGoal(): void {
    // Save completed goal to history
    if (this.currentGoal) {
      this.addToGoalHistory(this.currentGoal);
    }
    this.currentGoal = null;
    logger.info("[AutonomousBehavior] Goal cleared");
    // Sync to server for dashboard display
    this.service?.syncGoalToServer();
  }

  /**
   * Add a goal to history (for diversity tracking)
   */
  private addToGoalHistory(goal: CurrentGoal): void {
    // Clean up old entries first
    const now = Date.now();
    this.goalHistory = this.goalHistory.filter(
      (entry) => now - entry.completedAt < this.GOAL_HISTORY_RETENTION,
    );

    // Add new entry
    this.goalHistory.push({ goal, completedAt: now });

    // Trim to max size
    if (this.goalHistory.length > this.MAX_GOAL_HISTORY) {
      this.goalHistory = this.goalHistory.slice(-this.MAX_GOAL_HISTORY);
    }

    logger.debug(
      `[AutonomousBehavior] Goal added to history: ${goal.type} (${this.goalHistory.length} in history)`,
    );
  }

  /**
   * Get recent goal history for diversity scoring
   * Returns goals completed in the last GOAL_HISTORY_RETENTION ms
   */
  getGoalHistory(): Array<{
    type: string;
    skill?: string;
    completedAt: number;
  }> {
    const now = Date.now();
    return this.goalHistory
      .filter((entry) => now - entry.completedAt < this.GOAL_HISTORY_RETENTION)
      .map((entry) => ({
        type: entry.goal.type,
        skill: entry.goal.targetSkill,
        completedAt: entry.completedAt,
      }));
  }

  /**
   * Get count of recent goals by type (for diversity scoring)
   */
  getRecentGoalCounts(): Record<string, number> {
    const history = this.getGoalHistory();
    const counts: Record<string, number> = {};
    for (const entry of history) {
      const key = entry.skill || entry.type;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  /**
   * Pause goal selection (user explicitly stopped the goal via dashboard)
   * This prevents the agent from auto-setting a new goal until resumed
   */
  pauseGoals(): void {
    this.currentGoal = null;
    this.goalPaused = true;
    logger.info("[AutonomousBehavior] Goals paused by user");
    // Sync to server for dashboard display
    this.service?.syncGoalToServer();
  }

  /**
   * Resume goal selection (called when user sets a new goal or sends a command)
   */
  resumeGoals(): void {
    this.goalPaused = false;
    logger.info("[AutonomousBehavior] Goals resumed");
  }

  /**
   * Check if goals are paused
   */
  isGoalsPaused(): boolean {
    return this.goalPaused;
  }

  /**
   * Update goal progress (for non-skill goals like exploration)
   * For skill-based goals, use setSkillProgress() instead
   */
  updateGoalProgress(increment: number = 1): void {
    if (!this.currentGoal) return;

    // For skill-based goals, DON'T update progress via kills
    // Progress is tracked by skill level, not kill count
    if (this.currentGoal.targetSkill && this.currentGoal.targetSkillLevel) {
      logger.debug(
        `[AutonomousBehavior] Skill-based goal - progress tracked via skill level, not kill count`,
      );
      return;
    }

    this.currentGoal.progress += increment;
    logger.info(
      `[AutonomousBehavior] Goal progress: ${this.currentGoal.progress}/${this.currentGoal.target}`,
    );

    // Check if goal is complete (for non-skill goals like exploration)
    if (this.currentGoal.progress >= this.currentGoal.target) {
      logger.info(
        `[AutonomousBehavior] Goal COMPLETE: ${this.currentGoal.description}`,
      );
      this.currentGoal = null; // Clear so agent picks new goal
    }

    // Sync to server for dashboard display
    this.service?.syncGoalToServer();
  }

  /**
   * Update skill-based goal progress (called when skill level changes)
   */
  setSkillProgress(newLevel: number): void {
    if (!this.currentGoal) return;
    if (!this.currentGoal.targetSkill || !this.currentGoal.targetSkillLevel)
      return;

    this.currentGoal.progress = newLevel;
    logger.info(
      `[AutonomousBehavior] Skill goal progress: ${this.currentGoal.progress}/${this.currentGoal.target} (${this.currentGoal.targetSkill})`,
    );

    // Sync to server for dashboard display
    this.service?.syncGoalToServer();
  }

  /**
   * Check if agent has an active goal
   */
  hasGoal(): boolean {
    return this.currentGoal !== null;
  }

  // ============================================================================
  // TARGET LOCKING - Prevents switching targets mid-combat
  // ============================================================================

  /**
   * Lock onto a combat target
   * Agent will prioritize this target until it's dead, gone, or timeout
   */
  lockTarget(targetId: string): void {
    this.lockedTargetId = targetId;
    this.lockedTargetStartTime = Date.now();
    logger.info(`[AutonomousBehavior] 🎯 Target locked: ${targetId}`);
  }

  /**
   * Clear the current target lock
   * Called when target dies, despawns, or agent needs to flee
   */
  clearTargetLock(): void {
    if (this.lockedTargetId) {
      logger.info(
        `[AutonomousBehavior] 🎯 Target lock cleared: ${this.lockedTargetId}`,
      );
    }
    this.lockedTargetId = null;
    this.lockedTargetStartTime = 0;
  }

  /**
   * Get the currently locked target ID
   * Returns null if no lock, lock expired, or target is no longer valid
   */
  getLockedTarget(): string | null {
    if (!this.lockedTargetId) return null;

    // Check for timeout
    const lockAge = Date.now() - this.lockedTargetStartTime;
    if (lockAge > this.TARGET_LOCK_TIMEOUT) {
      logger.info(
        `[AutonomousBehavior] 🎯 Target lock expired after ${Math.round(lockAge / 1000)}s`,
      );
      this.clearTargetLock();
      return null;
    }

    // Validate target still exists and is alive
    const nearbyEntities = this.service?.getNearbyEntities() || [];
    const target = nearbyEntities.find((e) => e.id === this.lockedTargetId);

    if (!target) {
      logger.info(
        `[AutonomousBehavior] 🎯 Locked target ${this.lockedTargetId} no longer nearby`,
      );
      this.clearTargetLock();
      return null;
    }

    // Check if target is dead
    const targetAny = target as unknown as Record<string, unknown>;
    if (targetAny.alive === false || targetAny.dead === true) {
      logger.info(
        `[AutonomousBehavior] 🎯 Locked target ${this.lockedTargetId} is dead`,
      );
      this.clearTargetLock();
      return null;
    }

    return this.lockedTargetId;
  }

  /**
   * Check if we have a valid locked target
   */
  hasLockedTarget(): boolean {
    return this.getLockedTarget() !== null;
  }

  // ============================================================================
  // SURVIVAL OVERRIDE - Force flee when health is critical
  // ============================================================================

  /**
   * Check if force flee is needed (health critical with threats nearby)
   * This bypasses LLM selection to ensure agent survival
   */
  private async checkForceFleeNeeded(): Promise<{
    shouldFlee: boolean;
    reason: string;
  }> {
    if (!this.service) {
      return { shouldFlee: false, reason: "" };
    }

    const player = this.service.getPlayerEntity();
    if (!player) {
      return { shouldFlee: false, reason: "" };
    }

    // Calculate health percentage - check multiple possible formats
    const playerAny = player as unknown as Record<string, unknown>;

    // Try different health data formats
    // Server can send: { health: number, maxHealth: number } (flat)
    // Or normalized: { health: { current: number, max: number } } (nested)
    let currentHealth = 100;
    let maxHealth = 100;

    if (player.health && typeof player.health === "object") {
      // Standard format: health: { current: number, max: number }
      currentHealth = player.health.current ?? 100;
      maxHealth = player.health.max ?? 100;
    } else if (typeof player.health === "number") {
      // Flat format from server: health = current value, maxHealth = max value
      currentHealth = player.health;
      maxHealth = (playerAny.maxHealth as number) ?? 100;
    } else if (typeof playerAny.hp === "number") {
      // Alternative format: hp/maxHp
      currentHealth = playerAny.hp;
      maxHealth = (playerAny.maxHp as number) ?? 100;
    } else if (typeof playerAny.currentHealth === "number") {
      // Another alternative
      currentHealth = playerAny.currentHealth;
      maxHealth = (playerAny.maxHealth as number) ?? 100;
    }

    const healthPercent =
      maxHealth > 0 ? (currentHealth / maxHealth) * 100 : 100;

    // Log health status for debugging (only when in combat or low health)
    if (player.inCombat || healthPercent < 50) {
      logger.info(
        `[AutonomousBehavior] 🏥 Health check: ${currentHealth}/${maxHealth} (${healthPercent.toFixed(0)}%) - inCombat: ${player.inCombat}`,
      );
    }

    // Force flee threshold: 25% (slightly higher than validate's 30% for proactive escape)
    const CRITICAL_HEALTH_THRESHOLD = 25;

    if (healthPercent >= CRITICAL_HEALTH_THRESHOLD) {
      return { shouldFlee: false, reason: "" };
    }

    // Check for nearby threats (hostile mobs)
    const nearbyEntities = this.service.getNearbyEntities() || [];
    const threats = nearbyEntities.filter((entity) => {
      const entityAny = entity as unknown as Record<string, unknown>;

      // Check if this is a mob
      const isMob =
        "mobType" in entity ||
        entityAny.type === "mob" ||
        entityAny.entityType === "mob" ||
        (entity.name &&
          /goblin|bandit|skeleton|zombie|rat|spider|wolf/i.test(entity.name));

      if (!isMob) return false;

      // Check if alive
      if (entityAny.alive === false || entityAny.dead === true) return false;

      // Check distance (within 15 units = immediate threat)
      const playerPos = player.position;
      const entityPos = entity.position;
      if (!playerPos || !entityPos) return false;

      let px: number, pz: number;
      if (Array.isArray(playerPos)) {
        px = playerPos[0];
        pz = playerPos[2];
      } else if (typeof playerPos === "object" && "x" in playerPos) {
        px = (playerPos as { x: number }).x;
        pz = (playerPos as { z: number }).z;
      } else {
        return false;
      }

      let ex: number, ez: number;
      if (Array.isArray(entityPos)) {
        ex = entityPos[0];
        ez = entityPos[2];
      } else if (typeof entityPos === "object" && "x" in entityPos) {
        ex = (entityPos as { x: number }).x;
        ez = (entityPos as { z: number }).z;
      } else {
        return false;
      }

      const dist = Math.sqrt((px - ex) ** 2 + (pz - ez) ** 2);
      return dist < 15; // Within 15 units = immediate threat
    });

    if (threats.length > 0) {
      return {
        shouldFlee: true,
        reason: `Health critical (${healthPercent.toFixed(0)}%) with ${threats.length} threat(s) nearby`,
      };
    }

    return { shouldFlee: false, reason: "" };
  }
}
