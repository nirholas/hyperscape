/**
 * Dialogue Generator
 * Uses AI Gateway to generate NPC dialogue trees
 */

import { generateTextWithProvider } from "@/lib/ai/gateway";
import { TASK_MODELS } from "@/lib/ai/providers";
import type {
  DialogueTree,
  DialogueNode,
  DialogueGenerationContext,
  GeneratedNPCContent,
} from "@/types/game/dialogue-types";
import { logger } from "@/lib/utils";

const log = logger.child("DialogueGenerator");

/**
 * System prompt for dialogue generation
 */
const DIALOGUE_SYSTEM_PROMPT = `You are a game dialogue writer for a RuneScape-style MMORPG called Hyperscape.

Your task is to generate NPC dialogue trees in a specific JSON format.

DIALOGUE TREE STRUCTURE:
- entryNodeId: The ID of the first node in the dialogue
- nodes: Array of dialogue nodes, each with:
  - id: Unique string identifier (snake_case, e.g., "greeting", "quest_intro", "trade_offer")
  - text: What the NPC says (1-3 sentences, medieval fantasy tone)
  - responses: Array of player response options (optional, omit for ending nodes)
    - text: What the player says
    - nextNodeId: ID of next node, or "end" to end dialogue
    - effect: Optional game effect (openBank, openStore, startQuest:quest_id, etc.)

AVAILABLE EFFECTS:
- "openBank" - Opens the bank interface
- "openStore" - Opens the shop interface
- "startQuest:quest_id" - Starts a quest
- "completeQuest:quest_id" - Completes a quest
- "giveItem:item_id:quantity" - Gives item to player
- "takeItem:item_id:quantity" - Takes item from player
- "giveXP:skill:amount" - Gives XP to player

DIALOGUE GUIDELINES:
1. Keep NPC text concise but flavorful (medieval fantasy style)
2. Provide 2-4 response options per node
3. Include a "goodbye" option where appropriate
4. For service NPCs, include options to access their services
5. Add personality and humor where appropriate
6. Reference the NPC's role and the game world
7. For quest NPCs, create a natural conversation flow about the quest

OUTPUT FORMAT:
Return ONLY valid JSON matching the DialogueTree interface. No markdown, no explanation.`;

/**
 * Generate a dialogue tree for an NPC
 */
export async function generateDialogueTree(
  context: DialogueGenerationContext,
): Promise<DialogueTree> {
  const prompt = buildDialoguePrompt(context);

  const response = await generateTextWithProvider(prompt, {
    systemPrompt: DIALOGUE_SYSTEM_PROMPT,
    model: TASK_MODELS.dialogueGeneration,
    temperature: 0.8,
    maxTokens: 4000,
  });

  // Parse the JSON response
  try {
    const dialogueTree = JSON.parse(response.trim()) as DialogueTree;
    return validateAndNormalizeDialogueTree(dialogueTree);
  } catch (_error) {
    log.error("Failed to parse dialogue tree", { response });
    throw new Error("Failed to generate valid dialogue tree");
  }
}

/**
 * Build the prompt for dialogue generation
 */
export function buildDialoguePrompt(
  context: DialogueGenerationContext,
): string {
  let prompt = `Generate a dialogue tree for this NPC:

NPC NAME: ${context.npcName}
DESCRIPTION: ${context.npcDescription}
CATEGORY: ${context.npcCategory}
`;

  if (context.npcPersonality) {
    prompt += `PERSONALITY: ${context.npcPersonality}\n`;
  }

  if (context.npcRole) {
    prompt += `ROLE: ${context.npcRole}\n`;
  }

  if (context.services && context.services.length > 0) {
    prompt += `SERVICES: ${context.services.join(", ")}\n`;
    prompt += `Include dialogue options to access these services.\n`;
  }

  if (context.questContext) {
    prompt += `\nQUEST CONTEXT:
Quest ID: ${context.questContext.questId}
Quest Name: ${context.questContext.questName}
Description: ${context.questContext.questDescription}
`;
    if (context.questContext.objectives) {
      prompt += `Objectives: ${context.questContext.objectives.join(", ")}\n`;
    }
    prompt += `Create dialogue that introduces and explains this quest.\n`;
  }

  if (context.lore) {
    prompt += `\nWORLD LORE:\n${context.lore}\n`;
  }

  if (context.tone) {
    prompt += `\nTONE: The NPC should speak in a ${context.tone} manner.\n`;
  }

  prompt += `\nGenerate a complete dialogue tree with at least 3-5 nodes and multiple conversation paths.`;

  return prompt;
}

/**
 * Validate and normalize a dialogue tree
 */
export function validateAndNormalizeDialogueTree(
  tree: DialogueTree,
): DialogueTree {
  if (!tree.entryNodeId) {
    throw new Error("Dialogue tree missing entryNodeId");
  }

  if (!tree.nodes || tree.nodes.length === 0) {
    throw new Error("Dialogue tree has no nodes");
  }

  // Check entry node exists
  const entryNode = tree.nodes.find((n) => n.id === tree.entryNodeId);
  if (!entryNode) {
    throw new Error(`Entry node "${tree.entryNodeId}" not found`);
  }

  // Validate all node references
  const nodeIds = new Set(tree.nodes.map((n) => n.id));
  for (const node of tree.nodes) {
    if (node.responses) {
      for (const response of node.responses) {
        if (
          response.nextNodeId !== "end" &&
          !nodeIds.has(response.nextNodeId)
        ) {
          log.warn(
            `Response references non-existent node "${response.nextNodeId}", changing to "end"`,
          );
          response.nextNodeId = "end";
        }
      }
    }
  }

  return tree;
}

/**
 * Generate complete NPC content including dialogue
 */
export async function generateNPCContent(
  context: DialogueGenerationContext,
  generateBackstory: boolean = true,
): Promise<GeneratedNPCContent> {
  // Generate dialogue tree
  const dialogue = await generateDialogueTree(context);

  // Generate backstory if requested
  let backstory: string | undefined;
  if (generateBackstory) {
    backstory = await generateNPCBackstory(context);
  }

  return {
    id: generateNPCId(context.npcName),
    name: context.npcName,
    description: context.npcDescription,
    category: context.npcCategory,
    personality: context.npcPersonality || "neutral",
    backstory,
    dialogue,
    generatedAt: new Date().toISOString(),
    prompt: JSON.stringify(context),
  };
}

/**
 * Generate NPC backstory
 */
export async function generateNPCBackstory(
  context: DialogueGenerationContext,
): Promise<string> {
  const prompt = `Write a brief backstory (2-3 paragraphs) for this NPC in a medieval fantasy MMORPG:

Name: ${context.npcName}
Description: ${context.npcDescription}
Role: ${context.npcRole || context.npcCategory}
Personality: ${context.npcPersonality || "unknown"}

${context.lore ? `World Lore: ${context.lore}` : ""}

Write in third person, past tense. Include their history, motivations, and how they came to their current role.`;

  return generateTextWithProvider(prompt, {
    model: TASK_MODELS.contentGeneration,
    temperature: 0.7,
    maxTokens: 1000,
  });
}

/**
 * Generate a valid NPC ID from name
 */
export function generateNPCId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Add a new dialogue node to an existing tree
 */
export function addDialogueNode(
  tree: DialogueTree,
  node: DialogueNode,
): DialogueTree {
  return {
    ...tree,
    nodes: [...tree.nodes, node],
  };
}

/**
 * Update a dialogue node in a tree
 */
export function updateDialogueNode(
  tree: DialogueTree,
  nodeId: string,
  updates: Partial<DialogueNode>,
): DialogueTree {
  return {
    ...tree,
    nodes: tree.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...updates } : node,
    ),
  };
}

/**
 * Delete a dialogue node from a tree
 */
export function deleteDialogueNode(
  tree: DialogueTree,
  nodeId: string,
): DialogueTree {
  // Remove the node
  const newNodes = tree.nodes.filter((n) => n.id !== nodeId);

  // Update any references to this node to "end"
  for (const node of newNodes) {
    if (node.responses) {
      for (const response of node.responses) {
        if (response.nextNodeId === nodeId) {
          response.nextNodeId = "end";
        }
      }
    }
  }

  // Update entry node if it was deleted
  let entryNodeId = tree.entryNodeId;
  if (entryNodeId === nodeId && newNodes.length > 0) {
    entryNodeId = newNodes[0].id;
  }

  return {
    entryNodeId,
    nodes: newNodes,
  };
}

/**
 * Create a default empty dialogue tree
 */
export function createEmptyDialogueTree(npcName: string): DialogueTree {
  return {
    entryNodeId: "greeting",
    nodes: [
      {
        id: "greeting",
        text: `Greetings, traveler. I am ${npcName}. How may I assist you?`,
        responses: [
          {
            text: "Who are you?",
            nextNodeId: "about_me",
          },
          {
            text: "Goodbye.",
            nextNodeId: "end",
          },
        ],
      },
      {
        id: "about_me",
        text: `I am a humble servant of this realm. Is there anything else you wish to know?`,
        responses: [
          {
            text: "No, that's all. Farewell.",
            nextNodeId: "end",
          },
        ],
      },
    ],
  };
}
