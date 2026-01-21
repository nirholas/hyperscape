/**
 * QuestRepository - Quest progress database operations
 *
 * Tracks player quest progress, completion status, and quest points.
 * Each row in quest_progress represents a player's state for a specific quest.
 *
 * Responsibilities:
 * - Start quests (create progress row)
 * - Update quest stage and progress
 * - Complete quests
 * - Query quest status and progress
 * - Manage quest points
 *
 * Used by: QuestSystem
 */

import { eq, and, sql } from "drizzle-orm";
import { BaseRepository } from "./BaseRepository";
import * as schema from "../schema";

/** Database status values (not including derived "ready_to_complete") */
export type QuestDbStatus = "not_started" | "in_progress" | "completed";

/** Stage progress data stored as JSON */
export interface StageProgress {
  [key: string]: number;
}

/** Quest progress row from database */
export interface QuestProgressRow {
  id: number;
  playerId: string;
  questId: string;
  status: QuestDbStatus;
  currentStage: string | null;
  stageProgress: StageProgress;
  startedAt: number | null;
  completedAt: number | null;
}

/**
 * QuestRepository class
 *
 * Provides all quest progress database operations.
 */
export class QuestRepository extends BaseRepository {
  /**
   * Get quest progress for a specific quest
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   * @returns Quest progress or null if not started
   */
  async getQuestProgress(
    playerId: string,
    questId: string,
  ): Promise<QuestProgressRow | null> {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.questProgress)
      .where(
        and(
          eq(schema.questProgress.playerId, playerId),
          eq(schema.questProgress.questId, questId),
        ),
      )
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id,
      playerId: row.playerId,
      questId: row.questId,
      status: row.status as QuestDbStatus,
      currentStage: row.currentStage,
      stageProgress: (row.stageProgress as StageProgress) || {},
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  /**
   * Get all quest progress for a player
   *
   * @param playerId - The player ID
   * @returns Array of quest progress rows
   */
  async getAllPlayerQuests(playerId: string): Promise<QuestProgressRow[]> {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.questProgress)
      .where(eq(schema.questProgress.playerId, playerId));

    return results.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      questId: row.questId,
      status: row.status as QuestDbStatus,
      currentStage: row.currentStage,
      stageProgress: (row.stageProgress as StageProgress) || {},
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));
  }

  /**
   * Get list of completed quest IDs for a player
   *
   * @param playerId - The player ID
   * @returns Array of completed quest IDs
   */
  async getCompletedQuests(playerId: string): Promise<string[]> {
    this.ensureDatabase();

    const results = await this.db
      .select({ questId: schema.questProgress.questId })
      .from(schema.questProgress)
      .where(
        and(
          eq(schema.questProgress.playerId, playerId),
          eq(schema.questProgress.status, "completed"),
        ),
      );

    return results.map((row) => row.questId);
  }

  /**
   * Start a quest for a player
   *
   * Creates a new quest progress row with status "in_progress".
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   * @param initialStage - The starting stage ID
   */
  async startQuest(
    playerId: string,
    questId: string,
    initialStage: string,
  ): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db.insert(schema.questProgress).values({
      playerId,
      questId,
      status: "in_progress",
      currentStage: initialStage,
      stageProgress: {},
      startedAt: Date.now(),
    });
  }

  /**
   * Update quest progress
   *
   * Updates the current stage and/or stage progress for a quest.
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   * @param stage - The current stage ID
   * @param progress - Stage progress data (e.g., {"kills": 7})
   */
  async updateProgress(
    playerId: string,
    questId: string,
    stage: string,
    progress: StageProgress,
  ): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db
      .update(schema.questProgress)
      .set({
        currentStage: stage,
        stageProgress: progress,
      })
      .where(
        and(
          eq(schema.questProgress.playerId, playerId),
          eq(schema.questProgress.questId, questId),
        ),
      );
  }

  /**
   * Complete a quest
   *
   * Marks the quest as completed with a timestamp.
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   */
  async completeQuest(playerId: string, questId: string): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db
      .update(schema.questProgress)
      .set({
        status: "completed",
        completedAt: Date.now(),
      })
      .where(
        and(
          eq(schema.questProgress.playerId, playerId),
          eq(schema.questProgress.questId, questId),
        ),
      );
  }

  /**
   * Get quest points for a player
   *
   * @param playerId - The player ID (character ID)
   * @returns Number of quest points
   */
  async getQuestPoints(playerId: string): Promise<number> {
    this.ensureDatabase();

    const results = await this.db
      .select({ questPoints: schema.characters.questPoints })
      .from(schema.characters)
      .where(eq(schema.characters.id, playerId))
      .limit(1);

    return results.length > 0 ? (results[0].questPoints ?? 0) : 0;
  }

  /**
   * Add quest points to a player
   *
   * Atomically increments the player's quest points.
   *
   * @param playerId - The player ID (character ID)
   * @param points - Number of points to add
   */
  async addQuestPoints(playerId: string, points: number): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db
      .update(schema.characters)
      .set({
        questPoints: sql`${schema.characters.questPoints} + ${points}`,
      })
      .where(eq(schema.characters.id, playerId));
  }
}
