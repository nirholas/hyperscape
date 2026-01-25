/**
 * goalProvider - Provides current agent goal context and available goals
 *
 * Goals are stored in the AutonomousBehaviorManager for reliability.
 * This provider reads the current goal and available goal options
 * based on the agent's current state (skills, health, nearby entities).
 */

import type {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult,
} from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";
import type { AvailableGoalType } from "../types.js";
import {
  hasWeapon as detectHasWeapon,
  hasCombatCapableItem,
  hasFood as detectHasFood,
  hasAxe as detectHasAxe,
  hasPickaxe as detectHasPickaxe,
} from "../utils/item-detection.js";

/**
 * Known locations in the game world (FALLBACK DEFAULTS)
 *
 * These are used as fallbacks when dynamic entity lookup doesn't find
 * the target entity nearby. The agent prefers to find actual entity
 * positions at runtime using findNearestEntityPosition() in the behavior manager.
 *
 * NOTE: Coordinates are approximate and may change as the world evolves.
 * Must be within 200 tiles of spawn for anti-cheat compliance.
 */
export const KNOWN_LOCATIONS: Record<
  string,
  {
    position: [number, number, number];
    description: string;
    entities?: string[];
  }
> = {
  spawn: {
    position: [0, 0, 0],
    description: "Spawn area where goblins roam - good for combat training",
    entities: ["goblin"],
  },
  forest: {
    position: [25, 10, -15],
    description: "Nearby grove with trees for woodcutting",
    entities: ["tree"],
  },
  fishing: {
    position: [-20, 0, 15],
    description: "Fishing spot by the water - good for catching fish",
    entities: ["fishing_spot", "fishing spot"],
  },
  mine: {
    position: [40, 5, 25],
    description: "Mining area with rocks - good for mining ore",
    entities: ["rock", "ore"],
  },
  furnace: {
    position: [15, 0, -10],
    description: "Furnace for smelting ore into bars",
    entities: ["furnace"],
  },
  anvil: {
    position: [18, 0, -10],
    description: "Anvil for smithing bars into weapons and armor",
    entities: ["anvil"],
  },
};

/**
 * Goal option that can be selected by the LLM
 */
export interface GoalOption {
  id: string;
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
  targetSkill?: string;
  targetSkillLevel?: number;
  targetEntity?: string;
  location?: string;
  priority: number; // Higher = more recommended
  reason: string; // Why this goal is available/recommended
  warning?: string; // Optional warning for low readiness
}

/**
 * Combat readiness assessment
 */
export interface CombatReadiness {
  score: number; // 0-100
  factors: string[]; // Reasons for deductions
  ready: boolean; // score >= 50
}

/**
 * Assess combat readiness based on equipment, food, and health
 * Returns a score (0-100) with detailed factors
 */
export function getCombatReadiness(
  service: HyperscapeService,
): CombatReadiness {
  const player = service.getPlayerEntity();
  const factors: string[] = [];
  let score = 100;

  if (!player) {
    return { score: 0, factors: ["No player data"], ready: false };
  }

  // Check health (deduct up to 30 points for low health)
  const healthPercent = player?.health
    ? (player.health.current / player.health.max) * 100
    : 100;

  if (healthPercent < 30) {
    score -= 30;
    factors.push(`Low health (${healthPercent.toFixed(0)}%)`);
  } else if (healthPercent < 50) {
    score -= 15;
    factors.push(`Health below 50% (${healthPercent.toFixed(0)}%)`);
  }

  // Check for weapon (deduct points based on combat capability)
  // In OSRS, hatchets and pickaxes can be equipped and used as melee weapons
  const hasWeaponEquipped = detectHasWeapon(player);
  const hasCombatItem = hasCombatCapableItem(player);

  if (!hasWeaponEquipped) {
    if (hasCombatItem) {
      // Has combat-capable item but not equipped - small penalty
      score -= 10;
      factors.push("Weapon not equipped (have axe/pickaxe that can be used)");
    } else {
      // No combat-capable item at all - full penalty
      score -= 25;
      factors.push("No weapon available");
    }
  }

  // Check for food in inventory (deduct 20 points if no food)
  // Use centralized item detection utility
  const hasFood = detectHasFood(player);

  if (!hasFood) {
    score -= 20;
    factors.push("No food in inventory");
  }

  return {
    score: Math.max(0, score),
    factors,
    ready: score >= 50,
  };
}

/**
 * Generate available goal options based on current state
 */
export function getAvailableGoals(service: HyperscapeService): GoalOption[] {
  const goals: GoalOption[] = [];
  const player = service.getPlayerEntity();

  // Get current skill levels
  const skills = player?.skills as
    | Record<string, { level: number; xp: number }>
    | undefined;
  const attackLevel = skills?.attack?.level ?? 1;
  const strengthLevel = skills?.strength?.level ?? 1;
  const defenseLevel = skills?.defence?.level ?? 1;
  const woodcuttingLevel = skills?.woodcutting?.level ?? 1;
  const fishingLevel = skills?.fishing?.level ?? 1;
  const miningLevel = skills?.mining?.level ?? 1;

  // Get health status
  const healthPercent = player?.health
    ? (player.health.current / player.health.max) * 100
    : 100;

  // Get nearby entities
  const nearbyEntities = service.getNearbyEntities();
  const hasGoblins = nearbyEntities.some((e) =>
    e.name?.toLowerCase().includes("goblin"),
  );
  const hasTrees = nearbyEntities.some((e) => {
    const resourceType = e.resourceType?.toLowerCase() || "";
    const name = e.name?.toLowerCase() || "";
    return resourceType === "tree" || name.includes("tree");
  });
  const hasFishingSpots = nearbyEntities.some((e) => {
    const resourceType = e.resourceType?.toLowerCase() || "";
    const name = e.name?.toLowerCase() || "";
    return resourceType === "fishing_spot" || name.includes("fishing spot");
  });
  const hasMiningRocks = nearbyEntities.some((e) => {
    const resourceType = e.resourceType?.toLowerCase() || "";
    const name = e.name?.toLowerCase() || "";
    return (
      resourceType === "mining_rock" ||
      resourceType === "ore" ||
      name.includes("rock") ||
      name.includes("ore")
    );
  });
  const hasStarterChest = nearbyEntities.some(
    (e) =>
      (e as unknown as { type?: string }).type === "starter_chest" ||
      e.name?.toLowerCase().includes("starter chest"),
  );

  // Check if player has basic tools using centralized item detection
  const hasAxe = detectHasAxe(player);
  const hasPickaxe = detectHasPickaxe(player);

  // Starter chest goal - highest priority when player has no basic tools
  if (hasStarterChest && !hasAxe && !hasPickaxe) {
    goals.push({
      id: "get_starter_items",
      type: "starter_items",
      description: "Search the starter chest for basic tools and food",
      targetEntity: "starter_chest",
      priority: 100, // Highest priority - new players need tools!
      reason:
        "You have no basic tools! The starter chest contains an axe, pickaxe, tinderbox, fishing net, and food to get you started.",
    });
  }

  // Combat training goals - check readiness before recommending
  const combatReadiness = getCombatReadiness(service);
  const readinessMultiplier = combatReadiness.ready
    ? combatReadiness.score / 100
    : 0.3; // Heavily penalize if not ready

  // Only add combat goals if health allows (30%+ threshold)
  if (healthPercent >= 30) {
    // Build warning message for low readiness
    const combatWarning = !combatReadiness.ready
      ? `⚠️ NOT RECOMMENDED: ${combatReadiness.factors.join(", ")}`
      : combatReadiness.factors.length > 0
        ? `Note: ${combatReadiness.factors.join(", ")}`
        : undefined;

    // Attack training
    const attackPriority = Math.round(
      (hasGoblins ? 80 : 60) * readinessMultiplier,
    );
    goals.push({
      id: "train_attack",
      type: "combat_training",
      description: `Train attack from ${attackLevel} to ${attackLevel + 2} by killing goblins`,
      targetSkill: "attack",
      targetSkillLevel: attackLevel + 2,
      targetEntity: "goblin",
      location: "spawn",
      priority: attackPriority,
      reason: hasGoblins
        ? `Goblins nearby - great for attack training! (Readiness: ${combatReadiness.score}%)`
        : `Goblins at spawn area for attack training (Readiness: ${combatReadiness.score}%)`,
      warning: combatWarning,
    });

    // Strength training
    const strengthPriority = Math.round(
      (hasGoblins ? 75 : 55) * readinessMultiplier,
    );
    goals.push({
      id: "train_strength",
      type: "combat_training",
      description: `Train strength from ${strengthLevel} to ${strengthLevel + 2} by killing goblins`,
      targetSkill: "strength",
      targetSkillLevel: strengthLevel + 2,
      targetEntity: "goblin",
      location: "spawn",
      priority: strengthPriority,
      reason: hasGoblins
        ? `Goblins nearby - good for strength training (Readiness: ${combatReadiness.score}%)`
        : `Train strength on goblins at spawn (Readiness: ${combatReadiness.score}%)`,
      warning: combatWarning,
    });

    // Defense training
    const defencePriority = Math.round(
      (hasGoblins ? 70 : 50) * readinessMultiplier,
    );
    goals.push({
      id: "train_defence",
      type: "combat_training",
      description: `Train defence from ${defenseLevel} to ${defenseLevel + 2} by killing goblins`,
      targetSkill: "defence",
      targetSkillLevel: defenseLevel + 2,
      targetEntity: "goblin",
      location: "spawn",
      priority: defencePriority,
      reason: `Train defence by taking hits from goblins (Readiness: ${combatReadiness.score}%)`,
      warning: combatWarning,
    });
  }

  // Woodcutting goal
  goals.push({
    id: "train_woodcutting",
    type: "woodcutting",
    description: `Train woodcutting from ${woodcuttingLevel} to ${woodcuttingLevel + 2} by chopping trees in the forest`,
    targetSkill: "woodcutting",
    targetSkillLevel: woodcuttingLevel + 2,
    targetEntity: "tree",
    location: "forest",
    priority: hasTrees ? 65 : 40,
    reason: hasTrees
      ? "Trees nearby - safe way to train"
      : "Head to the western forest for woodcutting",
  });

  // Fishing goal
  goals.push({
    id: "train_fishing",
    type: "fishing",
    description: `Train fishing from ${fishingLevel} to ${fishingLevel + 2} by catching fish`,
    targetSkill: "fishing",
    targetSkillLevel: fishingLevel + 2,
    targetEntity: "fishing_spot",
    priority: hasFishingSpots ? 60 : 35,
    reason: hasFishingSpots
      ? "Fishing spots nearby - steady XP gains"
      : "Look for fishing spots near water",
  });

  // Mining goal
  goals.push({
    id: "train_mining",
    type: "mining",
    description: `Train mining from ${miningLevel} to ${miningLevel + 2} by mining rocks`,
    targetSkill: "mining",
    targetSkillLevel: miningLevel + 2,
    targetEntity: "mining_rock",
    priority: hasMiningRocks ? 60 : 35,
    reason: hasMiningRocks
      ? "Mining rocks nearby - good for mining practice"
      : "Search for rocks to mine",
  });

  // Exploration goal (good when health is low)
  goals.push({
    id: "explore",
    type: "exploration",
    description: "Explore the world and discover new areas",
    location: "spawn",
    priority: healthPercent < 50 ? 90 : 30, // High priority when hurt
    reason:
      healthPercent < 50
        ? "Health is low - explore safely while recovering"
        : "Discover new areas and resources",
  });

  // Idle/rest goal (when health is very low)
  if (healthPercent < 30) {
    goals.push({
      id: "rest",
      type: "idle",
      description: "Rest and recover health before continuing",
      priority: 95,
      reason: "Health critically low - rest to recover",
    });
  }

  // Sort by priority (highest first)
  return goals.sort((a, b) => b.priority - a.priority);
}

export const goalProvider: Provider = {
  name: "currentGoal",
  description:
    "Provides current agent goal, progress, and available goal options",
  dynamic: true,
  position: 0, // Run first

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    const behaviorManager = service?.getBehaviorManager();
    const goal = behaviorManager?.getGoal();

    // Get available goals based on current state
    const availableGoals = service ? getAvailableGoals(service) : [];
    const goalsText = availableGoals
      .slice(0, 5) // Show top 5 options
      .map((g, i) => {
        let text = `${i + 1}. **${g.id}** (priority ${g.priority}): ${g.description}\n   _${g.reason}_`;
        if (g.warning) {
          text += `\n   **${g.warning}**`;
        }
        return text;
      })
      .join("\n");

    if (!goal) {
      return {
        text: `## Goal Status
**No active goal** - You need to choose a goal!

## Available Goals (choose one):
${goalsText}

Use SET_GOAL to select one of these objectives based on your situation.`,
        values: {
          hasGoal: false,
          availableGoalCount: availableGoals.length,
          topGoalId: availableGoals[0]?.id || null,
        },
        data: {
          currentGoal: null,
          availableGoals,
        },
      };
    }

    const progressPercent =
      goal.target > 0 ? Math.round((goal.progress / goal.target) * 100) : 0;

    return {
      text: `## Current Goal
**Type**: ${goal.type}
**Objective**: ${goal.description}
**Progress**: ${goal.progress}/${goal.target} (${progressPercent}%)
**Location**: ${goal.location || "anywhere"}
**Target**: ${goal.targetEntity || "any"}
${goal.targetSkill ? `**Training**: ${goal.targetSkill} to level ${goal.targetSkillLevel}` : ""}`,
      values: {
        hasGoal: true,
        goalType: goal.type,
        goalProgress: goal.progress,
        goalTarget: goal.target,
        goalProgressPercent: progressPercent,
        goalLocation: goal.location,
        goalTargetEntity: goal.targetEntity,
        goalTargetSkill: goal.targetSkill,
        goalTargetSkillLevel: goal.targetSkillLevel,
      },
      data: {
        currentGoal: goal,
        availableGoals, // Still include for reference
      },
    };
  },
};
