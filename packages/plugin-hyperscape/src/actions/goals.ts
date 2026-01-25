/**
 * Goal-related actions for ElizaOS
 *
 * SET_GOAL - Choose a new objective to work towards (LLM-driven selection)
 * NAVIGATE_TO - Travel to a known location
 *
 * Goals are stored directly in the AutonomousBehaviorManager for reliability.
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  JsonValue,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";
import {
  KNOWN_LOCATIONS,
  getAvailableGoals,
} from "../providers/goalProvider.js";
import { SCRIPTED_AUTONOMY_CONFIG } from "../config/constants.js";

type HandlerOptionsParam =
  | HandlerOptions
  | Record<string, JsonValue | undefined>;
type Position3 = [number, number, number];
type PositionLike = Position3 | { x: number; y?: number; z: number };

function getPositionXZ(
  pos: PositionLike | null | undefined,
): { x: number; z: number } | null {
  if (!pos) return null;
  if (Array.isArray(pos) && pos.length >= 3) {
    return { x: pos[0], z: pos[2] };
  }
  const obj = pos as { x: number; z: number };
  return { x: obj.x, z: obj.z };
}

function getPositionArray(
  pos: PositionLike | null | undefined,
): Position3 | null {
  if (!pos) return null;
  if (Array.isArray(pos) && pos.length >= 3) {
    return [pos[0], pos[1], pos[2]];
  }
  const obj = pos as { x: number; y?: number; z: number };
  return [obj.x, obj.y ?? 0, obj.z];
}

function selectScriptedGoal(
  availableGoals: ReturnType<typeof getAvailableGoals>,
  role: string,
) {
  const normalizedRole = role.toLowerCase();
  const preferredType =
    normalizedRole === "combat"
      ? "combat_training"
      : normalizedRole === "woodcutting"
        ? "woodcutting"
        : normalizedRole === "fishing"
          ? "fishing"
          : normalizedRole === "mining"
            ? "mining"
            : null;

  if (preferredType) {
    const preferred = availableGoals.find(
      (goal) => goal.type === preferredType,
    );
    if (preferred) {
      return preferred;
    }
  }

  return availableGoals[0];
}

/**
 * SET_GOAL - Choose a new objective using LLM
 *
 * The agent uses LLM to select from available goals based on current state.
 * Goals are stored in the behavior manager and persist between ticks.
 */
export const setGoalAction: Action = {
  name: "SET_GOAL",
  similes: ["CHOOSE_GOAL", "NEW_GOAL", "START_TASK"],
  description:
    "Set a new goal to work towards. Use when you have no current objective. The LLM will choose the best goal based on your current situation.",

  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) {
      logger.debug("[SET_GOAL] Validation failed: not connected");
      return false;
    }

    // Check behavior manager directly for existing goal
    const behaviorManager = service.getBehaviorManager();
    const currentGoal = behaviorManager?.getGoal();

    // Don't set a goal if user has paused goals (clicked stop button)
    if (behaviorManager?.isGoalsPaused?.()) {
      logger.debug("[SET_GOAL] Validation failed: goals are paused by user");
      return false;
    }

    // Don't override locked goals (manually set from dashboard)
    if (currentGoal?.locked) {
      logger.debug(
        "[SET_GOAL] Validation failed: goal is locked (manually set)",
      );
      return false;
    }

    if (behaviorManager?.hasGoal()) {
      logger.debug("[SET_GOAL] Validation failed: already has a goal");
      return false;
    }

    logger.info("[SET_GOAL] Validation passed - agent needs a goal");
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const behaviorManager = service.getBehaviorManager();
      if (!behaviorManager) {
        return { success: false, error: "Behavior manager not available" };
      }

      // Get available goals based on current state
      const availableGoals = getAvailableGoals(service);
      if (availableGoals.length === 0) {
        return { success: false, error: "No goals available" };
      }

      // Get player state for context
      const player = service.getPlayerEntity();
      const healthPercent = player?.health
        ? Math.round((player.health.current / player.health.max) * 100)
        : 100;
      const skills = player?.skills as
        | Record<string, { level: number; xp: number }>
        | undefined;

      // Format goals for LLM selection
      const goalsText = availableGoals
        .map(
          (g, i) =>
            `${i + 1}. ${g.id}: ${g.description} (priority: ${g.priority}, reason: ${g.reason})`,
        )
        .join("\n");

      const autonomyModeSetting = String(
        runtime.getSetting("HYPERSCAPE_AUTONOMY_MODE") ||
          SCRIPTED_AUTONOMY_CONFIG.MODE ||
          "",
      ).toLowerCase();
      const scriptedRoleSetting = String(
        runtime.getSetting("HYPERSCAPE_SCRIPTED_ROLE") ||
          SCRIPTED_AUTONOMY_CONFIG.ROLE ||
          "",
      );
      const isScripted = autonomyModeSetting === "scripted";

      // Use LLM to select the best goal (unless scripted mode is enabled)
      const selectionPrompt = `You are an AI agent playing a RuneScape-style MMORPG. You need to choose your next goal.

Current Status:
- Health: ${healthPercent}%
- Attack Level: ${skills?.attack?.level ?? 1}
- Strength Level: ${skills?.strength?.level ?? 1}
- Defence Level: ${skills?.defence?.level ?? 1}
- Woodcutting Level: ${skills?.woodcutting?.level ?? 1}

Available Goals:
${goalsText}

Choose the goal ID that makes the most sense for your current situation. Consider:
- If health is low, prioritize safety (exploration or rest)
- If health is good, train combat skills
- Balance your skill training (don't always train the same skill)

Respond with ONLY the goal ID (e.g., "train_attack" or "explore"). Nothing else.`;

      let selectedGoalId: string;
      let selectedGoal = availableGoals[0];

      if (isScripted) {
        selectedGoal = selectScriptedGoal(availableGoals, scriptedRoleSetting);
        selectedGoalId = selectedGoal.id;
        logger.info(`[SET_GOAL] Scripted goal selected: ${selectedGoalId}`);
      } else {
        try {
          const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt: selectionPrompt,
            maxTokens: 50,
            temperature: 0.7,
          });

          // Extract goal ID from response (clean up any extra text)
          selectedGoalId = response
            .trim()
            .toLowerCase()
            .replace(/[^a-z_]/g, "");
          logger.info(`[SET_GOAL] LLM selected goal: ${selectedGoalId}`);
        } catch (llmError) {
          // Fallback to highest priority goal if LLM fails
          logger.warn(
            `[SET_GOAL] LLM selection failed, using highest priority: ${llmError}`,
          );
          selectedGoalId = availableGoals[0].id;
        }

        // Find the selected goal
        const llmSelectedGoal = availableGoals.find(
          (g) => g.id === selectedGoalId,
        );
        if (!llmSelectedGoal) {
          // Fallback to highest priority if invalid selection
          logger.warn(
            `[SET_GOAL] Invalid goal ID "${selectedGoalId}", using highest priority`,
          );
          selectedGoal = availableGoals[0];
        } else {
          selectedGoal = llmSelectedGoal;
        }
      }

      // Calculate progress and target for skill-based goals
      let progress = 0;
      let target = 10;

      if (selectedGoal.targetSkill && selectedGoal.targetSkillLevel) {
        // For skill goals: progress = current level, target = target level
        const currentLevel = skills?.[selectedGoal.targetSkill]?.level ?? 1;
        progress = currentLevel;
        target = selectedGoal.targetSkillLevel;
      } else if (selectedGoal.type === "exploration") {
        progress = 0;
        target = 3; // 3 exploration steps
      } else if (selectedGoal.type === "idle") {
        progress = 0;
        target = 1; // Just rest once
      }

      // Set the goal in the behavior manager
      behaviorManager.setGoal({
        type: selectedGoal.type,
        description: selectedGoal.description,
        target,
        progress,
        location: selectedGoal.location,
        targetEntity: selectedGoal.targetEntity,
        targetSkill: selectedGoal.targetSkill,
        targetSkillLevel: selectedGoal.targetSkillLevel,
        startedAt: Date.now(),
      });

      const responseText = `Goal selected: ${selectedGoal.description} (${selectedGoal.reason})`;
      await callback?.({ text: responseText, action: "SET_GOAL" });

      logger.info(`[SET_GOAL] ${responseText}`);

      return {
        success: true,
        text: responseText,
        data: {
          action: "SET_GOAL",
          goalId: selectedGoal.id,
          goalType: selectedGoal.type,
          target,
          targetSkill: selectedGoal.targetSkill,
          targetSkillLevel: selectedGoal.targetSkillLevel,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SET_GOAL] Failed: ${errorMsg}`);
      await callback?.({
        text: `Failed to set goal: ${errorMsg}`,
        error: true,
      });
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      {
        name: "system",
        content: { text: "Agent has no current goal, health is 100%" },
      },
      {
        name: "agent",
        content: {
          text: "Goal selected: Train attack from 25 to 27 by killing goblins (Goblins nearby - great for attack training!)",
          action: "SET_GOAL",
        },
      },
    ],
    [
      {
        name: "system",
        content: { text: "Agent has no current goal, health is 25%" },
      },
      {
        name: "agent",
        content: {
          text: "Goal selected: Explore the world and discover new areas (Health is low - explore safely while recovering)",
          action: "SET_GOAL",
        },
      },
    ],
  ],
};

/**
 * NAVIGATE_TO - Travel to a known location
 *
 * Used when the agent needs to go somewhere to accomplish their goal.
 */
export const navigateToAction: Action = {
  name: "NAVIGATE_TO",
  similes: ["GO_TO", "TRAVEL_TO", "WALK_TO"],
  description:
    "Navigate to a known location. Use when you need to travel somewhere for your goal.",

  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) {
      logger.info("[NAVIGATE_TO] Validation failed: not connected");
      return false;
    }

    const player = service.getPlayerEntity();
    if (!player?.position) {
      logger.info("[NAVIGATE_TO] Validation failed: no player position");
      return false;
    }

    const playerXZ = getPositionXZ(player.position as PositionLike | null);
    if (!playerXZ) {
      logger.info(`[NAVIGATE_TO] Validation failed: invalid position format`);
      return false;
    }
    const { x: playerX, z: playerZ } = playerXZ;

    // Check if we need to navigate (not at goal location)
    const behaviorManager = service.getBehaviorManager();
    const goal = behaviorManager?.getGoal();

    const targetPosition = goal?.targetPosition;
    const targetLoc = goal?.location ? KNOWN_LOCATIONS[goal.location] : null;

    if (!targetPosition && !targetLoc) {
      logger.info(
        "[NAVIGATE_TO] Validation failed: no goal target position or location set",
      );
      return false;
    }

    // Check distance
    const target = targetPosition || targetLoc?.position;
    if (!target) return false;

    const goalLocation = goal?.location;
    const dx = playerX - target[0];
    const dz = playerZ - target[2];
    const distance = Math.sqrt(dx * dx + dz * dz);

    logger.info(
      `[NAVIGATE_TO] Player at (${playerX.toFixed(0)}, ${playerZ.toFixed(0)}), ` +
        `target "${goalLocation ?? "custom"}" at (${target[0]}, ${target[2]}), ` +
        `distance: ${distance.toFixed(0)}`,
    );

    if (distance <= 15) {
      logger.info(
        "[NAVIGATE_TO] Validation failed: already at location (<= 15 units)",
      );
      return false;
    }

    logger.info(
      `[NAVIGATE_TO] Validation passed - need to travel ${distance.toFixed(0)} units to ${goalLocation ?? "target"}`,
    );
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const behaviorManager = service.getBehaviorManager();
      const goal = behaviorManager?.getGoal();
      const targetPosition = goal?.targetPosition;
      const destinationKey =
        goal?.location || (targetPosition ? "goal_target" : "spawn");
      const destination = goal?.location
        ? KNOWN_LOCATIONS[destinationKey]
        : null;

      if (!targetPosition && !destination) {
        return { success: false, error: "No navigation target available" };
      }

      // Get current player position
      const player = service.getPlayerEntity();
      const playerPos = getPositionArray(
        player?.position as PositionLike | null,
      );
      if (!playerPos) {
        return { success: false, error: "Could not get player position" };
      }
      const [playerX, playerY, playerZ] = playerPos;

      // Calculate distance to destination
      const targetX = targetPosition
        ? targetPosition[0]
        : destination!.position[0];
      const targetY = targetPosition
        ? targetPosition[1]
        : destination!.position[1];
      const targetZ = targetPosition
        ? targetPosition[2]
        : destination!.position[2];

      const dx = targetX - playerX;
      const dz = targetZ - playerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Max move distance allowed by server (200 tiles, use 150 for safety margin)
      const MAX_MOVE_DISTANCE = 150;

      let moveTarget: [number, number, number];
      let responseText: string;

      if (distance > MAX_MOVE_DISTANCE) {
        // Move in steps - calculate intermediate waypoint
        const ratio = MAX_MOVE_DISTANCE / distance;
        const stepX = playerX + dx * ratio;
        const stepZ = playerZ + dz * ratio;

        moveTarget = [stepX, targetY, stepZ];
        responseText = `Moving towards ${destinationKey} (${Math.round(distance - MAX_MOVE_DISTANCE)} units remaining)`;

        logger.info(
          `[NAVIGATE_TO] Distance ${distance.toFixed(0)} exceeds max ${MAX_MOVE_DISTANCE}, moving to intermediate point`,
        );
      } else {
        // Close enough to move directly
        moveTarget = [targetX, targetY, targetZ];
        responseText =
          destinationKey === "goal_target"
            ? "Navigating to goal target"
            : `Navigating to ${destinationKey}`;
      }

      await service.executeMove({
        target: moveTarget,
        runMode: false,
      });

      await callback?.({ text: responseText, action: "NAVIGATE_TO" });

      logger.info(`[NAVIGATE_TO] ${responseText}`);

      return {
        success: true,
        text: responseText,
        data: { action: "NAVIGATE_TO", destination: destinationKey },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[NAVIGATE_TO] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      {
        name: "system",
        content: { text: "Goal requires traveling to spawn" },
      },
      {
        name: "agent",
        content: { text: "Navigating to spawn", action: "NAVIGATE_TO" },
      },
    ],
  ],
};

// Export all goal actions
export const goalActions = [setGoalAction, navigateToAction];
