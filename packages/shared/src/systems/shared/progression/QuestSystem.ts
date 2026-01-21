/**
 * QuestSystem - Quest Management System
 *
 * Manages player quest progression, tracking, and rewards.
 * Quests are defined in quests.json manifest and loaded at runtime.
 *
 * **Features:**
 * - Manifest-driven quest definitions
 * - Kill tracking for combat objectives
 * - Stage-based quest progression
 * - Item rewards on start/completion
 * - Quest points tracking
 * - Integration with DialogueSystem for quest-aware dialogue
 *
 * **Event Flow:**
 * 1. DialogueSystem effect "startQuest:quest_id" triggers quest start
 * 2. QuestSystem tracks progress (kills, etc.)
 * 3. When objective complete, status becomes "ready_to_complete"
 * 4. DialogueSystem effect "completeQuest:quest_id" triggers completion
 * 5. Rewards distributed, QUEST_COMPLETED event emitted
 *
 * **Runs on:** Server only (client receives state via network messages)
 */

import { EventType } from "../../../types/events";
import type { World } from "../../../types/index";
import { SystemBase } from "../infrastructure/SystemBase";
import type {
  QuestDefinition,
  QuestManifest,
  QuestStatus,
  QuestDbStatus,
  StageProgress,
  QuestProgress,
  PlayerQuestState,
} from "../../../types/game/quest-types";
import type { NPCDiedPayload } from "../../../types/events/event-payloads";

/**
 * QuestSystem - Handles quest progression and rewards
 */
export class QuestSystem extends SystemBase {
  /** Quest definitions loaded from manifest */
  private questDefinitions: Map<string, QuestDefinition> = new Map();

  /** Player quest state (in-memory cache, synced with database) */
  private playerStates: Map<string, PlayerQuestState> = new Map();

  /** Flag to check if manifest is loaded */
  private manifestLoaded: boolean = false;

  constructor(world: World) {
    super(world, {
      name: "quest",
      dependencies: {
        optional: ["dialogue", "inventory", "skills"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Only run on server
    if (!this.world.isServer) {
      return;
    }

    // Load quest manifest
    await this.loadQuestManifest();

    // Subscribe to NPC deaths for kill quest tracking
    this.subscribe<NPCDiedPayload>(EventType.NPC_DIED, (data) => {
      this.handleNPCDied(data);
    });

    // Subscribe to player registration for loading quest state
    this.subscribe(
      EventType.PLAYER_REGISTERED,
      async (data: { playerId: string }) => {
        await this.loadPlayerQuestState(data.playerId);
      },
    );

    // Subscribe to player cleanup
    this.subscribe(EventType.PLAYER_CLEANUP, (data: { id: string }) => {
      this.playerStates.delete(data.id);
    });

    // Subscribe to quest start acceptance (player clicked Accept on quest start screen)
    this.subscribe(
      EventType.QUEST_START_ACCEPTED,
      async (data: { playerId: string; questId: string }) => {
        await this.startQuest(data.playerId, data.questId);
      },
    );

    this.logger.info(
      `QuestSystem initialized with ${this.questDefinitions.size} quests`,
    );
  }

  /**
   * Load quest definitions from manifest
   */
  private async loadQuestManifest(): Promise<void> {
    try {
      // Check if we're on the server (Node.js environment)
      const isServer =
        typeof process !== "undefined" &&
        process.versions !== undefined &&
        process.versions.node !== undefined;

      if (!isServer) {
        // Client-side - quests are server-only
        this.logger.warn("Quest manifest not available on client");
        this.manifestLoaded = true;
        return;
      }

      // Server-side: Load from filesystem
      const fs = await import("fs/promises");
      const path = await import("path");

      // Find manifests directory
      let manifestsDir: string;
      if (process.env.ASSETS_DIR) {
        manifestsDir = path.join(process.env.ASSETS_DIR, "manifests");
      } else {
        const cwd = process.cwd();
        const normalizedCwd = cwd.replace(/\\/g, "/");
        if (
          normalizedCwd.endsWith("/packages/server") ||
          normalizedCwd.includes("/packages/server/")
        ) {
          manifestsDir = path.join(cwd, "world", "assets", "manifests");
        } else if (normalizedCwd.includes("/packages/")) {
          const workspaceRoot = path.resolve(cwd, "../..");
          manifestsDir = path.join(
            workspaceRoot,
            "packages",
            "server",
            "world",
            "assets",
            "manifests",
          );
        } else {
          manifestsDir = path.join(
            cwd,
            "packages",
            "server",
            "world",
            "assets",
            "manifests",
          );
        }
      }

      const questsPath = path.join(manifestsDir, "quests.json");

      try {
        const questsData = await fs.readFile(questsPath, "utf-8");
        const questData = JSON.parse(questsData) as Record<
          string,
          QuestDefinition
        >;

        for (const [questId, definition] of Object.entries(questData)) {
          this.questDefinitions.set(questId, definition as QuestDefinition);
        }

        this.manifestLoaded = true;
        this.logger.info(
          `Loaded ${this.questDefinitions.size} quest definitions from ${questsPath}`,
        );
      } catch (err) {
        this.logger.warn(
          `Quest manifest not found at ${questsPath}, using empty quest list`,
        );
        this.manifestLoaded = true;
      }
    } catch (error) {
      this.logger.error(
        "Failed to load quest manifest",
        error instanceof Error ? error : undefined,
      );
      this.manifestLoaded = true; // Continue without quests
    }
  }

  /**
   * Load player quest state from database
   */
  private async loadPlayerQuestState(playerId: string): Promise<void> {
    // Initialize player state
    const state: PlayerQuestState = {
      playerId,
      questPoints: 0,
      activeQuests: new Map(),
      completedQuests: new Set(),
    };

    // Load from database via DatabaseSystem if available
    try {
      const dbSystem = this.world.getSystem("database") as {
        getQuestRepository?: () => {
          getAllPlayerQuests: (playerId: string) => Promise<
            Array<{
              questId: string;
              status: QuestDbStatus;
              currentStage: string | null;
              stageProgress: StageProgress;
              startedAt: number | null;
              completedAt: number | null;
            }>
          >;
          getQuestPoints: (playerId: string) => Promise<number>;
        };
      };

      if (dbSystem?.getQuestRepository) {
        const repo = dbSystem.getQuestRepository();
        const questRows = await repo.getAllPlayerQuests(playerId);
        const questPoints = await repo.getQuestPoints(playerId);

        state.questPoints = questPoints;

        for (const row of questRows) {
          if (row.status === "completed") {
            state.completedQuests.add(row.questId);
          } else if (row.status === "in_progress") {
            state.activeQuests.set(row.questId, {
              playerId,
              questId: row.questId,
              status: this.computeQuestStatus(row.questId, row),
              currentStage: row.currentStage || "",
              stageProgress: row.stageProgress || {},
              startedAt: row.startedAt ?? undefined,
              completedAt: row.completedAt ?? undefined,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to load quest state for ${playerId}`,
        error instanceof Error ? error : undefined,
      );
    }

    this.playerStates.set(playerId, state);
  }

  /**
   * Compute the full quest status including derived "ready_to_complete"
   */
  private computeQuestStatus(
    questId: string,
    row: {
      status: QuestDbStatus;
      currentStage: string | null;
      stageProgress: StageProgress;
    },
  ): QuestStatus {
    if (row.status !== "in_progress") {
      return row.status;
    }

    const definition = this.questDefinitions.get(questId);
    if (!definition || !row.currentStage) {
      return "in_progress";
    }

    // Check if current stage objective is complete
    const stage = definition.stages.find((s) => s.id === row.currentStage);
    if (!stage) {
      return "in_progress";
    }

    if (stage.type === "kill" && stage.count && stage.target) {
      const kills = row.stageProgress.kills || 0;
      if (kills >= stage.count) {
        return "ready_to_complete";
      }
    }

    // Add other stage type completion checks here as needed

    return "in_progress";
  }

  /**
   * Get quest status for a player (used by DialogueSystem for quest overrides)
   */
  public getQuestStatus(playerId: string, questId: string): QuestStatus {
    const state = this.playerStates.get(playerId);
    if (!state) {
      return "not_started";
    }

    if (state.completedQuests.has(questId)) {
      return "completed";
    }

    const active = state.activeQuests.get(questId);
    if (active) {
      return active.status;
    }

    return "not_started";
  }

  /**
   * Get all active quests for a player
   */
  public getActiveQuests(playerId: string): QuestProgress[] {
    const state = this.playerStates.get(playerId);
    if (!state) {
      return [];
    }
    return Array.from(state.activeQuests.values());
  }

  /**
   * Get quest definition by ID
   */
  public getQuestDefinition(questId: string): QuestDefinition | undefined {
    return this.questDefinitions.get(questId);
  }

  /**
   * Request to start a quest - shows confirmation screen to player
   *
   * Called when DialogueSystem processes a "startQuest:quest_id" effect
   * This emits QUEST_START_CONFIRM to show the quest accept screen
   */
  public requestQuestStart(playerId: string, questId: string): boolean {
    const state = this.playerStates.get(playerId);
    if (!state) {
      this.logger.warn(
        `Cannot request quest start: player ${playerId} not found`,
      );
      return false;
    }

    // Check if already started or completed
    if (state.completedQuests.has(questId)) {
      this.logger.info(`Quest ${questId} already completed for ${playerId}`);
      return false;
    }

    if (state.activeQuests.has(questId)) {
      this.logger.info(`Quest ${questId} already active for ${playerId}`);
      return false;
    }

    const definition = this.questDefinitions.get(questId);
    if (!definition) {
      this.logger.warn(`Quest definition not found: ${questId}`);
      return false;
    }

    // Check requirements
    if (!this.checkRequirements(playerId, definition)) {
      this.logger.info(
        `Player ${playerId} doesn't meet requirements for ${questId}`,
      );
      return false;
    }

    // Emit confirmation event to show quest start screen
    this.emitTypedEvent(EventType.QUEST_START_CONFIRM, {
      playerId,
      questId,
      questName: definition.name,
      description: definition.description,
      difficulty: definition.difficulty,
      requirements: {
        quests: definition.requirements?.quests || [],
        skills: definition.requirements?.skills || {},
        items: definition.requirements?.items || [],
      },
      rewards: {
        questPoints: definition.rewards.questPoints,
        items: definition.rewards.items || [],
        xp: definition.rewards.xp || {},
      },
    });

    this.logger.info(
      `Quest start confirmation shown for ${questId} to ${playerId}`,
    );
    return true;
  }

  /**
   * Start a quest for a player (actually starts the quest)
   *
   * Called when player accepts quest via QUEST_START_ACCEPTED event
   */
  public async startQuest(playerId: string, questId: string): Promise<boolean> {
    const state = this.playerStates.get(playerId);
    if (!state) {
      this.logger.warn(`Cannot start quest: player ${playerId} not found`);
      return false;
    }

    // Check if already started or completed
    if (state.completedQuests.has(questId)) {
      this.logger.info(`Quest ${questId} already completed for ${playerId}`);
      return false;
    }

    if (state.activeQuests.has(questId)) {
      this.logger.info(`Quest ${questId} already active for ${playerId}`);
      return false;
    }

    const definition = this.questDefinitions.get(questId);
    if (!definition) {
      this.logger.warn(`Quest definition not found: ${questId}`);
      return false;
    }

    // Check requirements
    if (!this.checkRequirements(playerId, definition)) {
      this.logger.info(
        `Player ${playerId} doesn't meet requirements for ${questId}`,
      );
      return false;
    }

    // Get the first non-dialogue stage (since the first dialogue stage is "talking to NPC")
    // The actual first stage is the kill stage in our case
    const firstKillStage = definition.stages.find((s) => s.type !== "dialogue");
    const initialStage =
      firstKillStage?.id || definition.stages[1]?.id || definition.stages[0].id;

    // Create quest progress
    const progress: QuestProgress = {
      playerId,
      questId,
      status: "in_progress",
      currentStage: initialStage,
      stageProgress: {},
      startedAt: Date.now(),
    };

    state.activeQuests.set(questId, progress);

    // Save to database
    await this.saveQuestProgress(playerId, questId, initialStage, {});

    // Grant starting items
    if (definition.onStart?.items) {
      await this.grantItems(playerId, definition.onStart.items);
    }

    // Emit quest started event
    this.emitTypedEvent(EventType.QUEST_STARTED, {
      playerId,
      questId,
      questName: definition.name,
    });

    // Send chat message
    this.emitTypedEvent(EventType.CHAT_MESSAGE, {
      playerId,
      message: `You have started a new quest: ${definition.name}`,
      type: "game",
    });

    this.logger.info(`Player ${playerId} started quest: ${questId}`);
    return true;
  }

  /**
   * Complete a quest for a player
   *
   * Called when DialogueSystem processes a "completeQuest:quest_id" effect
   */
  public async completeQuest(
    playerId: string,
    questId: string,
  ): Promise<boolean> {
    const state = this.playerStates.get(playerId);
    if (!state) {
      return false;
    }

    const progress = state.activeQuests.get(questId);
    if (!progress) {
      this.logger.warn(`Quest ${questId} not active for ${playerId}`);
      return false;
    }

    // Verify quest is ready to complete
    if (progress.status !== "ready_to_complete") {
      this.logger.warn(
        `Quest ${questId} not ready to complete for ${playerId}`,
      );
      return false;
    }

    const definition = this.questDefinitions.get(questId);
    if (!definition) {
      return false;
    }

    // Move to completed
    state.activeQuests.delete(questId);
    state.completedQuests.add(questId);

    // Update database
    await this.markQuestCompleted(playerId, questId);

    // Award quest points
    if (definition.rewards.questPoints > 0) {
      state.questPoints += definition.rewards.questPoints;
      await this.addQuestPoints(playerId, definition.rewards.questPoints);
    }

    // Grant reward items
    if (definition.rewards.items.length > 0) {
      await this.grantItems(playerId, definition.rewards.items);
    }

    // Emit quest completed event (SkillsSystem will handle XP rewards)
    this.emitTypedEvent(EventType.QUEST_COMPLETED, {
      playerId,
      questId,
      questName: definition.name,
      rewards: definition.rewards,
    });

    this.logger.info(`Player ${playerId} completed quest: ${questId}`);
    return true;
  }

  /**
   * Handle NPC death for kill quest tracking
   */
  private handleNPCDied(data: NPCDiedPayload): void {
    const { killedBy, mobType } = data;

    this.logger.info(
      `[QuestSystem] NPC_DIED received: killedBy=${killedBy}, mobType=${mobType}`,
    );

    const state = this.playerStates.get(killedBy);
    if (!state) {
      this.logger.info(
        `[QuestSystem] No player state for ${killedBy}. Known players: ${Array.from(this.playerStates.keys()).join(", ")}`,
      );
      return;
    }

    this.logger.info(
      `[QuestSystem] Player ${killedBy} has ${state.activeQuests.size} active quests`,
    );

    // Check all active quests for kill objectives
    for (const [questId, progress] of state.activeQuests) {
      this.logger.info(
        `[QuestSystem] Checking quest ${questId}, currentStage=${progress.currentStage}`,
      );

      const definition = this.questDefinitions.get(questId);
      if (!definition) {
        this.logger.info(`[QuestSystem] No definition for quest ${questId}`);
        continue;
      }

      const stage = definition.stages.find(
        (s) => s.id === progress.currentStage,
      );
      if (!stage) {
        this.logger.info(
          `[QuestSystem] Stage ${progress.currentStage} not found in quest ${questId}`,
        );
        continue;
      }

      if (stage.type !== "kill") {
        this.logger.info(
          `[QuestSystem] Stage ${stage.id} is type=${stage.type}, not kill`,
        );
        continue;
      }

      // Check if this mob matches the target
      // mobType is "goblin" and target is "goblin"
      const targetType = stage.target;
      this.logger.info(
        `[QuestSystem] Comparing mobType="${mobType}" with target="${targetType}"`,
      );
      if (!targetType || mobType !== targetType) {
        this.logger.info(
          `[QuestSystem] mobType doesn't match target, skipping`,
        );
        continue;
      }

      // Increment kill count
      const kills = (progress.stageProgress.kills || 0) + 1;
      progress.stageProgress = { ...progress.stageProgress, kills };

      this.logger.info(
        `[QuestSystem] Player ${killedBy} killed ${mobType}, quest ${questId} progress: ${kills}/${stage.count}`,
      );

      // Check if objective complete
      if (stage.count && kills >= stage.count) {
        progress.status = "ready_to_complete";

        // Send chat message that objective is complete
        this.emitTypedEvent(EventType.CHAT_MESSAGE, {
          playerId: killedBy,
          message: `You've killed enough ${targetType}s. Return to ${definition.startNpc.replace(/_/g, " ")}.`,
          type: "game",
        });
      }

      // Save progress
      this.saveQuestProgress(
        killedBy,
        questId,
        progress.currentStage,
        progress.stageProgress,
      );

      // Emit progress event
      this.emitTypedEvent(EventType.QUEST_PROGRESSED, {
        playerId: killedBy,
        questId,
        stage: progress.currentStage,
        progress: progress.stageProgress,
        description: stage.description,
      });
    }
  }

  /**
   * Check if player meets quest requirements
   */
  private checkRequirements(
    playerId: string,
    definition: QuestDefinition,
  ): boolean {
    const state = this.playerStates.get(playerId);
    if (!state) return false;

    // Check prerequisite quests
    for (const prereqQuestId of definition.requirements.quests) {
      if (!state.completedQuests.has(prereqQuestId)) {
        return false;
      }
    }

    // TODO: Check skill requirements
    // TODO: Check item requirements

    return true;
  }

  /**
   * Grant items to player (via InventorySystem)
   */
  private async grantItems(
    playerId: string,
    items: Array<{ itemId: string; quantity: number }>,
  ): Promise<void> {
    for (const { itemId, quantity } of items) {
      this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
        playerId,
        item: {
          itemId,
          quantity,
          slot: -1, // Let inventory system find a slot
        },
      });
    }
  }

  /**
   * Save quest progress to database
   */
  private async saveQuestProgress(
    playerId: string,
    questId: string,
    stage: string,
    progress: StageProgress,
  ): Promise<void> {
    try {
      const dbSystem = this.world.getSystem("database") as {
        getQuestRepository?: () => {
          startQuest: (
            playerId: string,
            questId: string,
            initialStage: string,
          ) => Promise<void>;
          updateProgress: (
            playerId: string,
            questId: string,
            stage: string,
            progress: StageProgress,
          ) => Promise<void>;
        };
      };

      if (dbSystem?.getQuestRepository) {
        const repo = dbSystem.getQuestRepository();
        const state = this.playerStates.get(playerId);
        const isNew =
          state?.activeQuests.get(questId)?.startedAt === Date.now();

        if (isNew) {
          await repo.startQuest(playerId, questId, stage);
        } else {
          await repo.updateProgress(playerId, questId, stage, progress);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to save quest progress for ${playerId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Mark quest as completed in database
   */
  private async markQuestCompleted(
    playerId: string,
    questId: string,
  ): Promise<void> {
    try {
      const dbSystem = this.world.getSystem("database") as {
        getQuestRepository?: () => {
          completeQuest: (playerId: string, questId: string) => Promise<void>;
        };
      };

      if (dbSystem?.getQuestRepository) {
        await dbSystem.getQuestRepository().completeQuest(playerId, questId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to mark quest completed for ${playerId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Add quest points to player in database
   */
  private async addQuestPoints(
    playerId: string,
    points: number,
  ): Promise<void> {
    try {
      const dbSystem = this.world.getSystem("database") as {
        getQuestRepository?: () => {
          addQuestPoints: (playerId: string, points: number) => Promise<void>;
        };
      };

      if (dbSystem?.getQuestRepository) {
        await dbSystem.getQuestRepository().addQuestPoints(playerId, points);
      }
    } catch (error) {
      this.logger.error(
        `Failed to add quest points for ${playerId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get player's quest points
   */
  public getQuestPoints(playerId: string): number {
    return this.playerStates.get(playerId)?.questPoints || 0;
  }

  /**
   * Check if player has completed a quest
   */
  public hasCompletedQuest(playerId: string, questId: string): boolean {
    return (
      this.playerStates.get(playerId)?.completedQuests.has(questId) || false
    );
  }

  /**
   * Get all quest definitions (for quest journal)
   */
  public getAllQuestDefinitions(): QuestDefinition[] {
    return Array.from(this.questDefinitions.values());
  }
}
