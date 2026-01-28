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
 * - Audit logging for all quest state changes
 *
 * Used by: QuestSystem
 */

import { eq, and, sql, desc } from "drizzle-orm";
import { BaseRepository } from "./BaseRepository";
import * as schema from "../schema";

/** Quest audit action types */
export type QuestAuditAction =
  | "started"
  | "progressed"
  | "completed"
  | "abandoned";

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

    const now = Date.now();

    await this.db.transaction(async (tx) => {
      // Create quest progress entry
      await tx.insert(schema.questProgress).values({
        playerId,
        questId,
        status: "in_progress",
        currentStage: initialStage,
        stageProgress: {},
        startedAt: now,
      });

      // Audit log entry for quest start
      await tx.insert(schema.questAuditLog).values({
        playerId,
        questId,
        action: "started",
        stageId: initialStage,
        timestamp: now,
      });
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
   * Abandon a quest
   *
   * Deletes the quest progress row, effectively resetting the quest to not_started.
   * Logs the abandonment in the audit log.
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   */
  async abandonQuest(playerId: string, questId: string): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db.transaction(async (tx) => {
      // Delete quest progress entry
      await tx
        .delete(schema.questProgress)
        .where(
          and(
            eq(schema.questProgress.playerId, playerId),
            eq(schema.questProgress.questId, questId),
          ),
        );

      // Audit log entry for quest abandonment
      await tx.insert(schema.questAuditLog).values({
        playerId,
        questId,
        action: "abandoned",
        timestamp: Date.now(),
      });
    });
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

  /**
   * Complete a quest and award points atomically
   *
   * Wraps quest completion and point award in a transaction to ensure
   * database consistency. If either operation fails, both are rolled back.
   *
   * @param playerId - The player ID (character ID)
   * @param questId - The quest identifier
   * @param questPoints - Number of quest points to award
   */
  async completeQuestWithPoints(
    playerId: string,
    questId: string,
    questPoints: number,
  ): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db.transaction(async (tx) => {
      // Mark quest as completed
      await tx
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

      // Award quest points (if any)
      if (questPoints > 0) {
        await tx
          .update(schema.characters)
          .set({
            questPoints: sql`${schema.characters.questPoints} + ${questPoints}`,
          })
          .where(eq(schema.characters.id, playerId));
      }

      // Audit log entry for quest completion
      await tx.insert(schema.questAuditLog).values({
        playerId,
        questId,
        action: "completed",
        questPointsAwarded: questPoints,
        timestamp: Date.now(),
      });
    });
  }

  // =========================================================================
  // AUDIT LOGGING
  // =========================================================================

  /**
   * Log a quest audit event
   *
   * Creates an immutable audit trail entry for quest actions.
   * Used for security auditing and exploit detection.
   *
   * @param playerId - The player ID
   * @param questId - The quest identifier
   * @param action - The action type ("started", "progressed", "completed")
   * @param options - Optional additional data
   */
  async logAuditEvent(
    playerId: string,
    questId: string,
    action: QuestAuditAction,
    options?: {
      questPointsAwarded?: number;
      stageId?: string;
      stageProgress?: StageProgress;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (this.isDestroying) {
      return;
    }

    this.ensureDatabase();

    await this.db.insert(schema.questAuditLog).values({
      playerId,
      questId,
      action,
      questPointsAwarded: options?.questPointsAwarded ?? 0,
      stageId: options?.stageId ?? null,
      stageProgress: options?.stageProgress ?? {},
      timestamp: Date.now(),
      metadata: options?.metadata ?? {},
    });
  }

  /**
   * Get audit log entries for a player
   *
   * @param playerId - The player ID
   * @param limit - Maximum entries to return (default: 100)
   * @returns Array of audit log entries, newest first
   */
  async getPlayerAuditLog(
    playerId: string,
    limit: number = 100,
  ): Promise<
    Array<{
      id: number;
      playerId: string;
      questId: string;
      action: string;
      questPointsAwarded: number | null;
      stageId: string | null;
      stageProgress: StageProgress;
      timestamp: number;
      metadata: Record<string, unknown>;
    }>
  > {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.questAuditLog)
      .where(eq(schema.questAuditLog.playerId, playerId))
      .orderBy(desc(schema.questAuditLog.timestamp))
      .limit(limit);

    return results.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      questId: row.questId,
      action: row.action,
      questPointsAwarded: row.questPointsAwarded,
      stageId: row.stageId,
      stageProgress: (row.stageProgress as StageProgress) || {},
      timestamp: row.timestamp,
      metadata: (row.metadata as Record<string, unknown>) || {},
    }));
  }

  /**
   * Get audit log entries for a specific quest
   *
   * @param questId - The quest identifier
   * @param limit - Maximum entries to return (default: 100)
   * @returns Array of audit log entries, newest first
   */
  async getQuestAuditLog(
    questId: string,
    limit: number = 100,
  ): Promise<
    Array<{
      id: number;
      playerId: string;
      questId: string;
      action: string;
      questPointsAwarded: number | null;
      stageId: string | null;
      stageProgress: StageProgress;
      timestamp: number;
      metadata: Record<string, unknown>;
    }>
  > {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.questAuditLog)
      .where(eq(schema.questAuditLog.questId, questId))
      .orderBy(desc(schema.questAuditLog.timestamp))
      .limit(limit);

    return results.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      questId: row.questId,
      action: row.action,
      questPointsAwarded: row.questPointsAwarded,
      stageId: row.stageId,
      stageProgress: (row.stageProgress as StageProgress) || {},
      timestamp: row.timestamp,
      metadata: (row.metadata as Record<string, unknown>) || {},
    }));
  }
}
