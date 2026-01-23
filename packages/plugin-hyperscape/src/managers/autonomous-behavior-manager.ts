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
import type { Entity } from "../types.js";
import {
  hasCombatCapableItem,
  hasWeapon,
  hasOre,
  hasBars,
} from "../utils/item-detection.js";

/**
 * Find the nearest entity matching a type/name pattern from nearby entities
 * Returns the entity's position if found, null otherwise
 *
 * @param entities - Array of nearby entities
 * @param typePatterns - Array of type/name patterns to match (case-insensitive)
 * @param playerPos - Current player position for distance calculation
 * @returns Position [x, y, z] of nearest matching entity, or null if not found
 */
function findNearestEntityPosition(
  entities: Entity[],
  typePatterns: string[],
  playerPos: [number, number, number] | null,
): [number, number, number] | null {
  if (!entities || entities.length === 0) return null;

  const patterns = typePatterns.map((p) => p.toLowerCase());

  // Filter entities matching any pattern
  const matchingEntities = entities.filter((e) => {
    const name = (e.name || "").toLowerCase();
    const id = (e.id || "").toLowerCase();
    return patterns.some((p) => name.includes(p) || id.includes(p));
  });

  if (matchingEntities.length === 0) return null;

  // If no player position, return first match
  if (!playerPos) {
    const first = matchingEntities[0];
    return first.position || null;
  }

  // Find nearest
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const e of matchingEntities) {
    if (!e.position) continue;
    const dx = e.position[0] - playerPos[0];
    const dz = e.position[2] - playerPos[2];
    const dist = dx * dx + dz * dz; // squared distance is fine for comparison
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = e;
    }
  }

  return nearest?.position || null;
}

// Configuration
const DEFAULT_TICK_INTERVAL = 10000; // 10 seconds between decisions
const MIN_TICK_INTERVAL = 5000; // Minimum 5 seconds
const MAX_TICK_INTERVAL = 30000; // Maximum 30 seconds

/**
 * Generate a UUID v4
 */
function generateUUID(): UUID {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }) as UUID;
}

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

    // STARTER ITEMS OVERRIDE: Force LOOT_STARTER_CHEST if goal is starter_items
    // This bypasses LLM selection to ensure agent gets starter tools
    if (this.currentGoal?.type === "starter_items") {
      logger.info(
        `[AutonomousBehavior] 📦 FORCE LOOT_STARTER_CHEST: Goal is starter_items`,
      );

      // Create message and state for the action
      const lootMessage = this.createTickMessage();
      const lootState = await this.runtime.composeState(lootMessage);

      // Validate the action first
      const isValid = await lootStarterChestAction.validate(
        this.runtime,
        lootMessage,
        lootState,
      );

      if (isValid) {
        // Execute loot starter chest directly, bypassing LLM selection
        await this.executeAction(
          lootStarterChestAction,
          lootMessage,
          lootState,
        );
        return;
      } else {
        logger.info(
          `[AutonomousBehavior] LOOT_STARTER_CHEST validation failed - agent may already have tools`,
        );
        // Clear the goal since it's no longer valid (already have tools)
        this.clearGoal();
        // Fall through to normal tick processing to select a new goal
      }
    }

    // COMBAT READINESS OVERRIDE: Force EQUIP_ITEM if combat goal but weapon not equipped
    // This ensures agent equips a weapon before engaging in combat
    // Check for any combat-related goal type (combat_training, combat_training_goblins, etc.)
    const goalType = this.currentGoal?.type || "";
    const isCombatGoal =
      goalType.startsWith("combat") || goalType.includes("combat");

    if (isCombatGoal) {
      const player = this.service?.getPlayerEntity();
      const hasWeaponEquipped = hasWeapon(player);
      const hasCombatItem = hasCombatCapableItem(player);

      logger.info(
        `[AutonomousBehavior] 🔍 Combat readiness check: goalType=${goalType}, hasWeapon=${hasWeaponEquipped}, hasCombatItem=${hasCombatItem}`,
      );

      if (!hasWeaponEquipped && hasCombatItem) {
        logger.info(
          `[AutonomousBehavior] ⚔️ FORCE EQUIP_ITEM: Combat goal but weapon not equipped (has combat item in inventory)`,
        );

        // Import the equip action
        const { equipItemAction } = await import("../actions/inventory.js");

        // Create message and state for the action
        const equipMessage = this.createTickMessage();
        const equipState = await this.runtime.composeState(equipMessage);

        // Validate the action first
        const isValid = await equipItemAction.validate(
          this.runtime,
          equipMessage,
          equipState,
        );

        if (isValid) {
          // Execute equip item directly, bypassing LLM selection
          await this.executeAction(equipItemAction, equipMessage, equipState);
          return;
        } else {
          logger.info(
            `[AutonomousBehavior] EQUIP_ITEM validation failed - may already have weapon equipped`,
          );
          // Fall through to normal tick processing
        }
      }
    }

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
            id: generateUUID(),
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

    // DEFENSIVE CHECK: Force SET_GOAL if there's no goal and LLM didn't select SET_GOAL
    // This ensures the agent always has a goal before taking other actions
    if (
      !this.currentGoal &&
      !this.goalPaused &&
      selectedAction.name !== "SET_GOAL"
    ) {
      logger.warn(
        `[AutonomousBehavior] ⚠️ No goal but LLM selected ${selectedAction.name} - forcing SET_GOAL`,
      );
      selectedAction = setGoalAction;
    }

    // DEFENSIVE CHECK: Force EQUIP_ITEM if "Prepare for Combat" goal and has equippable weapon
    // This ensures the agent equips weapons before doing unrelated tasks like chopping wood
    if (
      this.currentGoal?.type === "exploration" &&
      this.currentGoal?.description?.toLowerCase().includes("combat") &&
      selectedAction.name !== "EQUIP_ITEM" &&
      selectedAction.name !== "NAVIGATE_TO"
    ) {
      const player = this.service?.getPlayerEntity();
      const hasWeaponEquipped = hasWeapon(player);

      if (!hasWeaponEquipped && hasCombatCapableItem(player)) {
        logger.warn(
          `[AutonomousBehavior] ⚠️ "Prepare for Combat" goal but LLM selected ${selectedAction.name} - forcing EQUIP_ITEM`,
        );
        selectedAction = equipItemAction;
      }
    }

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

      // Smart fallback: If a goal-related action failed (CHOP_TREE, ATTACK_ENTITY),
      // try NAVIGATE_TO first to get to the goal location
      const goalRelatedActions = [
        "CHOP_TREE",
        "ATTACK_ENTITY",
        "APPROACH_ENTITY",
      ];
      if (goalRelatedActions.includes(selectedAction.name)) {
        const goal = this.currentGoal;
        if (goal?.location) {
          logger.info(
            `[AutonomousBehavior] Goal has location "${goal.location}", trying NAVIGATE_TO`,
          );
          const navValid = await navigateToAction.validate(
            this.runtime,
            tickMessage,
            state,
          );
          if (navValid) {
            logger.info(
              "[AutonomousBehavior] NAVIGATE_TO validated, executing...",
            );
            await this.executeAction(navigateToAction, tickMessage, state);
            return;
          } else {
            logger.info(
              "[AutonomousBehavior] NAVIGATE_TO also failed validation",
            );
          }
        }
      }

      // Reverse fallback: If NAVIGATE_TO failed (already at location), try the goal's target action
      if (selectedAction.name === "NAVIGATE_TO") {
        const goal = this.currentGoal;
        if (goal) {
          let goalAction: Action | null = null;
          if (goal.type === "woodcutting") {
            goalAction = chopTreeAction;
            logger.info(
              "[AutonomousBehavior] At forest location, trying CHOP_TREE instead",
            );
          } else if (
            goal.type?.startsWith("combat") ||
            goal.type?.includes("combat")
          ) {
            goalAction = attackEntityAction;
            logger.info(
              "[AutonomousBehavior] At spawn location, trying ATTACK_ENTITY instead",
            );
          }

          if (goalAction) {
            const goalActionValid = await goalAction.validate(
              this.runtime,
              tickMessage,
              state,
            );
            if (goalActionValid) {
              logger.info(
                `[AutonomousBehavior] ${goalAction.name} validated, executing...`,
              );
              await this.executeAction(goalAction, tickMessage, state);
              return;
            } else {
              logger.info(
                `[AutonomousBehavior] ${goalAction.name} also failed validation - may need to wait`,
              );
            }
          }
        }
      }

      // Final fallback to IDLE
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

  /**
   * Select an action using the LLM based on current state
   */
  private async selectAction(
    _message: Memory,
    state: State,
  ): Promise<Action | null> {
    // Get available actions for autonomous behavior
    const availableActions = this.getAvailableActions();

    // Build the action selection prompt
    const prompt = this.buildActionSelectionPrompt(state, availableActions);

    try {
      // Use the LLM to select an action
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        stopSequences: ["\n\n"],
      });

      const responseText =
        typeof response === "string" ? response : String(response);
      if (this.debug)
        logger.debug(
          `[AutonomousBehavior] LLM response: ${responseText.trim()}`,
        );

      // Parse the selected action from response
      let selectedActionName = this.parseActionFromResponse(
        responseText,
        availableActions,
      );

      if (!selectedActionName) {
        logger.warn(
          "[AutonomousBehavior] Could not parse action from LLM response, defaulting to EXPLORE",
        );
        return exploreAction;
      }

      // If goals are paused by user, block SET_GOAL and force IDLE
      if (this.goalPaused && selectedActionName === "SET_GOAL") {
        logger.info(
          "[AutonomousBehavior] Blocked SET_GOAL because goals are paused by user - forcing IDLE",
        );
        selectedActionName = "IDLE";
      }

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
      // Default to EXPLORE on error
      return exploreAction;
    }
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
      exploreAction,
      fleeAction,
      idleAction,
      approachEntityAction,
    ];
  }

  /**
   * Build prompt for action selection
   */
  private buildActionSelectionPrompt(state: State, actions: Action[]): string {
    // Read goal directly from behavior manager (more reliable than evaluator state)
    const goal = this.currentGoal;

    // Extract facts from evaluators
    const survivalFacts = (state.survivalFacts as string[]) || [];
    const combatFacts = (state.combatFacts as string[]) || [];
    const combatRecommendations =
      (state.combatRecommendations as string[]) || [];
    const survivalRecommendations =
      (state.survivalRecommendations as string[]) || [];

    // Extract data from providers (populated by composeState)
    const skillsData = state.skillsData as
      | { totalLevel?: number; combatLevel?: number }
      | undefined;
    const skills = this.service?.getPlayerEntity()?.skills as
      | Record<string, { level: number; xp: number }>
      | undefined;

    const lines = [
      "You are an AI agent playing a 3D RPG game. Select ONE action to perform.",
      "You should have a GOAL and work towards it purposefully, not wander randomly.",
      "",
    ];

    // Add skills summary if available
    if (skills) {
      lines.push("=== YOUR SKILLS ===");
      const combatSkills = ["attack", "strength", "defense", "constitution"];
      for (const skillName of combatSkills) {
        const skill = skills[skillName];
        if (skill) {
          lines.push(`  ${skillName}: Level ${skill.level} (${skill.xp} XP)`);
        }
      }
      if (skillsData?.combatLevel) {
        lines.push(`  Combat Level: ${skillsData.combatLevel}`);
      }
      lines.push("");
    }

    lines.push("=== GOAL STATUS ===");

    // Add goal info directly from behavior manager
    if (goal) {
      lines.push(`  Goal: ${goal.description}`);
      lines.push(`  Type: ${goal.type}`);
      lines.push(`  Kill Progress: ${goal.progress}/${goal.target}`);
      if (goal.location) lines.push(`  Location: ${goal.location}`);
      if (goal.targetEntity) lines.push(`  Target: ${goal.targetEntity}`);

      // Show skill-based progress if applicable
      if (goal.targetSkill && goal.targetSkillLevel && skills) {
        const currentLevel = skills[goal.targetSkill]?.level ?? 0;
        const skillProgress = `${currentLevel}/${goal.targetSkillLevel}`;
        lines.push(`  Skill Goal: ${goal.targetSkill} ${skillProgress}`);
        if (currentLevel >= goal.targetSkillLevel) {
          lines.push("  ** SKILL GOAL REACHED! **");
        }
      }

      // Add recommendation based on goal type
      if (goal.progress >= goal.target) {
        lines.push("  ** KILL GOAL COMPLETE! Set a new goal. **");
      }
    } else {
      lines.push("  ** NO ACTIVE GOAL ** - You MUST use SET_GOAL first!");
    }

    // Add survival facts
    if (survivalFacts.length > 0) {
      lines.push("");
      lines.push("Survival Status:");
      survivalFacts.forEach((f) => lines.push(`  ${f}`));
    }

    // Add combat facts
    if (combatFacts.length > 0) {
      lines.push("");
      lines.push("Combat:");
      combatFacts.forEach((f) => lines.push(`  ${f}`));
    }

    // Add all recommendations
    const allRecommendations = [
      ...survivalRecommendations,
      ...combatRecommendations,
    ].filter(Boolean);
    if (allRecommendations.length > 0) {
      lines.push("");
      lines.push("Recommendations:");
      allRecommendations.forEach((r) => lines.push(`  ${r}`));
    }

    // === DYNAMIC NEARBY ENTITIES SECTION ===
    // Let the LLM see what's nearby and figure out the appropriate action
    const nearbyEntities = this.service?.getNearbyEntities() || [];
    const playerPos = this.service?.getPlayerEntity()?.position;

    // Categorize nearby entities dynamically
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

    // Count nearby resource types (within 20m approach range)
    let treesNearby = 0,
      rocksNearby = 0,
      fishingSpotsNearby = 0,
      mobsNearby = 0;
    const mobNames: string[] = [];

    for (const entity of nearbyEntities) {
      const entityAny = entity as unknown as Record<string, unknown>;
      const dist = getDistance(entityAny.position);
      if (dist === null || dist > 20) continue;
      if (entityAny.depleted === true) continue; // Skip depleted resources

      const name = entity.name?.toLowerCase() || "";
      const resourceType = entityAny.resourceType as string | undefined;

      // Trees
      if (resourceType === "tree" || name.includes("tree")) {
        treesNearby++;
      }
      // Rocks/Ore
      else if (
        resourceType === "rock" ||
        resourceType === "ore" ||
        name.includes("rock") ||
        name.includes("ore") ||
        /copper|tin|iron|coal/i.test(name)
      ) {
        rocksNearby++;
      }
      // Fishing spots
      else if (resourceType === "fishing_spot" || name.includes("fishing")) {
        fishingSpotsNearby++;
      }
      // Mobs
      else if (
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

    lines.push("");
    lines.push("=== NEARBY RESOURCES (informational only) ===");
    if (treesNearby > 0) lines.push(`  🌲 Trees: ${treesNearby}`);
    if (rocksNearby > 0) lines.push(`  �ite Rocks/Ore: ${rocksNearby}`);
    if (fishingSpotsNearby > 0)
      lines.push(`  🎣 Fishing spots: ${fishingSpotsNearby}`);
    if (mobsNearby > 0)
      lines.push(`  ⚔️ Mobs: ${mobsNearby} - ${mobNames.join(", ")}`);
    if (
      treesNearby === 0 &&
      rocksNearby === 0 &&
      fishingSpotsNearby === 0 &&
      mobsNearby === 0
    ) {
      lines.push("  (No harvestable resources or attackable mobs nearby)");
    }

    lines.push("");
    lines.push("=== AVAILABLE ACTIONS ===");
    for (const action of actions) {
      lines.push(`${action.name}: ${action.description}`);
    }

    lines.push("");
    lines.push("=== KNOWN LOCATIONS ===");
    lines.push(`  spawn: [0, 0] - Goblins for combat training`);
    lines.push(
      `  forest: [${KNOWN_LOCATIONS.forest?.position[0]}, ${KNOWN_LOCATIONS.forest?.position[2]}] - Trees for woodcutting`,
    );
    lines.push(
      `  mine: [${KNOWN_LOCATIONS.mine?.position[0]}, ${KNOWN_LOCATIONS.mine?.position[2]}] - Rocks for mining`,
    );
    lines.push(
      `  fishing: [${KNOWN_LOCATIONS.fishing?.position[0]}, ${KNOWN_LOCATIONS.fishing?.position[2]}] - Fishing spots`,
    );

    lines.push("");
    lines.push("=== DECISION GUIDELINES ===");
    lines.push(
      "1. CRITICAL: If health < 30% with threats nearby → FLEE immediately",
    );
    lines.push("2. If NO GOAL → SET_GOAL (you must have purpose!)");
    lines.push("3. If starter_items goal → LOOT_STARTER_CHEST");
    lines.push(
      "4. ** IMPORTANT: Follow the RECOMMENDED ACTION below if one is shown! **",
    );
    lines.push("5. If 'Prepare for Combat' goal:");
    lines.push(
      "   - If you have axe/pickaxe/sword in inventory → EQUIP_ITEM (these are weapons!)",
    );
    lines.push(
      "   - If no weapon in inventory → MINE_ROCK to get ore, then smith",
    );
    lines.push(
      "6. Match your goal to nearby resources ONLY if no recommended action:",
    );
    lines.push("   - woodcutting goal + trees nearby → CHOP_TREE");
    lines.push("   - mining goal + rocks nearby → MINE_ROCK");
    lines.push("   - fishing goal + fishing spots nearby → CATCH_FISH");
    lines.push("   - combat_training goal + mobs nearby → ATTACK_ENTITY");
    lines.push(
      "7. If goal resources NOT nearby → NAVIGATE_TO the appropriate location",
    );
    lines.push(
      "8. If at location but resources not visible → EXPLORE the area",
    );

    // === MINIMAL GUARDRAILS (only critical safety checks) ===
    let priorityAction: string | null = null;

    if (!goal) {
      // No goal - must set one (unless paused)
      if (this.goalPaused) {
        priorityAction = "IDLE";
        lines.push("");
        lines.push("** GOALS PAUSED ** - Waiting for user to set a new goal");
      } else {
        priorityAction = "SET_GOAL";
        lines.push("");
        lines.push("** NO GOAL - You MUST use SET_GOAL first! **");
      }
    } else if (goal.type === "woodcutting") {
      // Woodcutting goal - force CHOP_TREE if trees are nearby, else NAVIGATE_TO forest
      if (treesNearby > 0) {
        priorityAction = "CHOP_TREE";
        lines.push("");
        lines.push(
          `** WOODCUTTING GOAL - ${treesNearby} trees nearby! Use CHOP_TREE to continue training! **`,
        );
      } else {
        // No trees nearby - navigate to forest
        if (this.currentGoal) {
          this.currentGoal.location = "forest";
        }
        priorityAction = "NAVIGATE_TO";
        lines.push("");
        lines.push(
          "** WOODCUTTING GOAL - No trees nearby! Use NAVIGATE_TO to get to the forest! **",
        );
      }
    } else if (goal.type === "mining") {
      // Mining goal - force MINE_ROCK if rocks are nearby, else NAVIGATE_TO mine
      if (rocksNearby > 0) {
        priorityAction = "MINE_ROCK";
        lines.push("");
        lines.push(
          `** MINING GOAL - ${rocksNearby} rocks nearby! Use MINE_ROCK to continue training! **`,
        );
      } else {
        // No rocks nearby - navigate to mine
        if (this.currentGoal) {
          this.currentGoal.location = "mine";
        }
        priorityAction = "NAVIGATE_TO";
        lines.push("");
        lines.push(
          "** MINING GOAL - No rocks nearby! Use NAVIGATE_TO to get to the mine! **",
        );
      }
    } else if (goal.type === "fishing") {
      // Fishing goal - force CATCH_FISH if fishing spots are nearby, else NAVIGATE_TO fishing
      if (fishingSpotsNearby > 0) {
        priorityAction = "CATCH_FISH";
        lines.push("");
        lines.push(
          `** FISHING GOAL - ${fishingSpotsNearby} fishing spots nearby! Use CATCH_FISH to continue training! **`,
        );
      } else {
        // No fishing spots nearby - navigate to fishing area
        if (this.currentGoal) {
          this.currentGoal.location = "fishing";
        }
        priorityAction = "NAVIGATE_TO";
        lines.push("");
        lines.push(
          "** FISHING GOAL - No fishing spots nearby! Use NAVIGATE_TO to get to the fishing area! **",
        );
      }
    } else if (
      goal.type?.startsWith("combat") ||
      goal.type?.includes("combat")
    ) {
      // Combat training goal - check combat readiness first, then attack or navigate
      const player = this.service?.getPlayerEntity();
      const hasWeaponEquipped = hasWeapon(player);
      const hasCombatItem = hasCombatCapableItem(player);

      // First priority: equip a weapon if we have one but it's not equipped
      if (!hasWeaponEquipped && hasCombatItem) {
        priorityAction = "EQUIP_ITEM";
        lines.push("");
        lines.push(
          "** COMBAT GOAL - You have a weapon in inventory but it's not equipped! Use EQUIP_ITEM first! **",
        );
      } else if (mobsNearby > 0) {
        // Have weapon (or no weapon available) and mobs nearby - attack
        priorityAction = "ATTACK_ENTITY";
        lines.push("");
        if (!hasWeaponEquipped) {
          lines.push(
            `** COMBAT GOAL - ${mobsNearby} mobs nearby but NO WEAPON! Consider getting a weapon first. **`,
          );
        } else {
          lines.push(
            `** COMBAT GOAL - ${mobsNearby} mobs nearby (${mobNames.join(", ")})! Use ATTACK_ENTITY to continue training! **`,
          );
        }
      } else {
        // No mobs nearby - navigate to spawn area
        if (this.currentGoal) {
          this.currentGoal.location = "spawn";
        }
        priorityAction = "NAVIGATE_TO";
        lines.push("");
        lines.push(
          "** COMBAT GOAL - No mobs nearby! Use NAVIGATE_TO to get to the spawn area! **",
        );
      }
    } else if (goal.type === "starter_items") {
      // Starter items is a special case - always loot chest
      priorityAction = "LOOT_STARTER_CHEST";
      lines.push("");
      lines.push(
        "** STARTER ITEMS GOAL - Use LOOT_STARTER_CHEST to get tools! **",
      );
    } else if (
      goal.type === "exploration" &&
      goal.description?.toLowerCase().includes("combat")
    ) {
      // "Prepare for Combat" goal - need to get a weapon equipped
      const player = this.service?.getPlayerEntity();
      const hasWeaponEquipped = hasWeapon(player);
      const hasCombatItem = hasCombatCapableItem(player);
      const playerHasOre = hasOre(player);
      const playerHasBars = hasBars(player);

      if (!hasWeaponEquipped && hasCombatItem) {
        // Has a combat-capable item in inventory - equip it!
        priorityAction = "EQUIP_ITEM";
        lines.push("");
        lines.push(
          "** PREPARE FOR COMBAT - You have a weapon in inventory! Use EQUIP_ITEM to equip it! **",
        );
      } else if (!hasWeaponEquipped && !playerHasOre && !playerHasBars) {
        // No weapon and no materials - need to mine ore first
        if (rocksNearby > 0) {
          priorityAction = "MINE_ROCK";
          lines.push("");
          lines.push(
            "** PREPARE FOR COMBAT - No weapon! Use MINE_ROCK to gather ore for smithing! **",
          );
        } else {
          // Try to find rocks/mine dynamically from nearby entities
          const nearbyEntities = this.service?.getNearbyEntities() || [];
          const playerPos = player?.position as [number, number, number] | null;
          const rockPos = findNearestEntityPosition(
            nearbyEntities,
            ["rock", "ore", "mine"],
            playerPos,
          );

          if (this.currentGoal) {
            if (rockPos) {
              // Found a rock/mine - set dynamic position
              this.currentGoal.targetPosition = rockPos;
              this.currentGoal.location = "mine";
            } else {
              // Fall back to KNOWN_LOCATIONS
              this.currentGoal.location = "mine";
            }
          }
          priorityAction = "NAVIGATE_TO";
          lines.push("");
          lines.push(
            "** PREPARE FOR COMBAT - No weapon! Use NAVIGATE_TO to get to the mine for ore! **",
          );
        }
      } else if (!hasWeaponEquipped && (playerHasOre || playerHasBars)) {
        // Has materials - need to find furnace or anvil
        const nearbyEntities = this.service?.getNearbyEntities() || [];
        const playerPos = player?.position as [number, number, number] | null;
        const targetType = playerHasOre ? "furnace" : "anvil";
        const stationPos = findNearestEntityPosition(
          nearbyEntities,
          [targetType],
          playerPos,
        );

        if (this.currentGoal) {
          if (stationPos) {
            // Found the station - set dynamic position
            this.currentGoal.targetPosition = stationPos;
            this.currentGoal.location = targetType;
          } else {
            // Fall back to KNOWN_LOCATIONS
            this.currentGoal.location = targetType;
          }
        }
        priorityAction = "NAVIGATE_TO";
        lines.push("");
        lines.push(
          `** PREPARE FOR COMBAT - You have ore/bars! Use NAVIGATE_TO to find a ${targetType} to smith a weapon. **`,
        );
      }
    }
    // For all other goals, let the LLM figure it out based on:
    // - Current goal type
    // - Nearby resources listed above
    // - Available actions and known locations

    if (priorityAction) {
      lines.push("");
      lines.push("╔════════════════════════════════════════════╗");
      lines.push(`║  >>> YOU MUST USE: ${priorityAction} <<<`);
      lines.push("╚════════════════════════════════════════════╝");
    }

    lines.push("");
    if (priorityAction) {
      lines.push(`Respond with ONLY: ${priorityAction}`);
    } else {
      lines.push(
        "Respond with ONLY the action name (e.g., SET_GOAL or ATTACK_ENTITY or NAVIGATE_TO):",
      );
    }

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
                metadata: {
                  type: "autonomous_action",
                  actionName: action.name,
                  timestamp: Date.now(),
                  tags: ["hyperscape", "autonomous", action.name.toLowerCase()],
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
      id: generateUUID(),
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
  } {
    return {
      running: this.isRunning,
      tickCount: this.tickCount,
      lastTickTime: this.lastTickTime,
      tickInterval: this.tickInterval,
    };
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
