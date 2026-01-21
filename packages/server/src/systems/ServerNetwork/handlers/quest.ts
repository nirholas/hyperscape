/**
 * Quest Network Handlers
 *
 * Handles network messages for quest-related operations:
 * - getQuestList: Fetch all quests for a player
 * - getQuestDetail: Fetch detailed info for a specific quest
 */

import type { World } from "@hyperscape/shared";
import type { QuestSystem } from "@hyperscape/shared";
import type { ServerSocket } from "../../../shared/types";
import { sendToSocket, getPlayerId } from "./common";

/**
 * Handle request for quest list
 */
export function handleGetQuestList(
  socket: ServerSocket,
  _data: Record<string, unknown>,
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    console.warn("[QuestHandlers] No playerId for getQuestList request");
    return;
  }

  const questSystem = world.getSystem("quest") as QuestSystem | undefined;
  if (!questSystem) {
    console.warn("[QuestHandlers] QuestSystem not available");
    return;
  }

  // Get all quest definitions
  const allDefinitions = questSystem.getAllQuestDefinitions();

  // Build quest list with status for this player
  const quests = allDefinitions.map((def) => ({
    id: def.id,
    name: def.name,
    status: questSystem.getQuestStatus(playerId, def.id),
    difficulty: def.difficulty,
    questPoints: def.questPoints,
  }));

  const questPoints = questSystem.getQuestPoints(playerId);

  // Send quest list to client via packet
  sendToSocket(socket, "questList", {
    quests,
    questPoints,
  });
}

/**
 * Handle request for quest detail
 */
export function handleGetQuestDetail(
  socket: ServerSocket,
  data: { questId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    console.warn("[QuestHandlers] No playerId for getQuestDetail request");
    return;
  }

  const { questId } = data;
  if (!questId) {
    console.warn("[QuestHandlers] No questId provided");
    return;
  }

  const questSystem = world.getSystem("quest") as QuestSystem | undefined;
  if (!questSystem) {
    console.warn("[QuestHandlers] QuestSystem not available");
    return;
  }

  const definition = questSystem.getQuestDefinition(questId);
  if (!definition) {
    console.warn(`[QuestHandlers] Quest not found: ${questId}`);
    return;
  }

  const status = questSystem.getQuestStatus(playerId, questId);

  // Get active quest progress if in progress
  const activeQuests = questSystem.getActiveQuests(playerId);
  const activeQuest = activeQuests.find((q) => q.questId === questId);

  console.log(
    `[QuestHandlers] getQuestDetail for ${questId}: activeQuest=`,
    activeQuest ? JSON.stringify(activeQuest) : "null",
  );

  // Build detail response
  const detail = {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status,
    difficulty: definition.difficulty,
    questPoints: definition.questPoints,
    currentStage: activeQuest?.currentStage || definition.stages[0]?.id || "",
    stageProgress: activeQuest?.stageProgress || {},
    stages: definition.stages.map((stage) => ({
      id: stage.id,
      description: stage.description,
      type: stage.type,
      target: stage.target,
      count: stage.count,
    })),
  };

  console.log(
    `[QuestHandlers] Sending detail with stageProgress:`,
    JSON.stringify(detail.stageProgress),
  );

  // Send quest detail to client via packet
  sendToSocket(socket, "questDetail", detail);
}

/**
 * Handle quest accept from client
 * Called when player clicks Accept on the quest start screen
 */
export function handleQuestAccept(
  socket: ServerSocket,
  data: { questId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    console.warn("[QuestHandlers] No playerId for questAccept request");
    return;
  }

  const { questId } = data;
  if (!questId) {
    console.warn("[QuestHandlers] No questId provided for questAccept");
    return;
  }

  const questSystem = world.getSystem("quest") as QuestSystem | undefined;
  if (!questSystem) {
    console.warn("[QuestHandlers] QuestSystem not available");
    return;
  }

  // Start the quest (this will validate requirements and set status to in_progress)
  const success = questSystem.startQuest(playerId, questId);

  if (success) {
    console.log(`[QuestHandlers] Player ${playerId} started quest ${questId}`);
  } else {
    console.warn(
      `[QuestHandlers] Failed to start quest ${questId} for player ${playerId}`,
    );
  }
}
