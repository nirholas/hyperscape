/**
 * WorldChunkRepository - World chunk persistence operations
 *
 * Stores persistent modifications to terrain and entities in the world.
 * Each chunk is identified by its X,Z coordinates and contains serialized data.
 *
 * Responsibilities:
 * - Load/save chunk data (terrain modifications, resources, buildings)
 * - Track chunk activity and player counts
 * - Handle chunk resets
 * - Query inactive chunks for cleanup
 *
 * Rate Limiting:
 * - Uses a semaphore to limit concurrent save operations
 * - Prevents connection pool exhaustion during bulk chunk saves
 * - Queues excess operations rather than failing them
 *
 * Used by: World system, terrain generation, entity spawning
 */

import { eq, and, sql } from "drizzle-orm";
import { BaseRepository } from "./BaseRepository";
import * as schema from "../schema";
import type { WorldChunkRow, ItemRow } from "../../shared/types";

/**
 * Simple semaphore for limiting concurrent operations
 * Prevents connection pool exhaustion during bulk saves
 */
class Semaphore {
  private available: number;
  private waiting: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    } else {
      this.available++;
    }
  }
}

/**
 * WorldChunkRepository class
 *
 * Provides all world chunk persistence operations.
 * Uses a semaphore to limit concurrent save operations and prevent
 * connection pool exhaustion during bulk chunk saves (e.g., server startup).
 */
export class WorldChunkRepository extends BaseRepository {
  /**
   * Semaphore to limit concurrent chunk save operations
   * Limit to 5 concurrent saves to leave headroom for other database operations
   * (pool has 20 connections, so 5 saves + other systems = safe margin)
   */
  private static saveSemaphore = new Semaphore(5);

  /**
   * Load world chunk data from database
   *
   * Retrieves persistent modifications for a specific chunk (resources, buildings, etc.).
   * Returns null if chunk has no persistent data (meaning it uses default generation).
   *
   * @param chunkX - Chunk X coordinate
   * @param chunkZ - Chunk Z coordinate
   * @returns Chunk data or null if not found
   */
  async getWorldChunkAsync(
    chunkX: number,
    chunkZ: number,
  ): Promise<WorldChunkRow | null> {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.worldChunks)
      .where(
        and(
          eq(schema.worldChunks.chunkX, chunkX),
          eq(schema.worldChunks.chunkZ, chunkZ),
        ),
      )
      .limit(1);

    if (results.length === 0) return null;

    return results[0] as WorldChunkRow;
  }

  /**
   * Save world chunk data to database
   *
   * Saves or updates persistent chunk data. Uses upsert (INSERT ... ON CONFLICT UPDATE)
   * to handle both new and existing chunks.
   *
   * Rate limited via semaphore to prevent connection pool exhaustion when
   * many chunks are saved simultaneously (e.g., during server startup or player movement).
   *
   * @param chunkData - Chunk data to save (coordinates, serialized data, last active time)
   */
  async saveWorldChunkAsync(chunkData: {
    chunkX: number;
    chunkZ: number;
    data: string;
  }): Promise<void> {
    if (this.isDestroying) {
      // Gracefully skip during shutdown
      return;
    }

    this.ensureDatabase();

    // Acquire semaphore to limit concurrent saves
    await WorldChunkRepository.saveSemaphore.acquire();

    try {
      await this.db
        .insert(schema.worldChunks)
        .values({
          chunkX: chunkData.chunkX,
          chunkZ: chunkData.chunkZ,
          data: chunkData.data,
          lastActive: Date.now(),
        })
        .onConflictDoUpdate({
          target: [schema.worldChunks.chunkX, schema.worldChunks.chunkZ],
          set: {
            data: chunkData.data,
            lastActive: Date.now(),
          },
        });
    } finally {
      // Always release semaphore, even on error
      WorldChunkRepository.saveSemaphore.release();
    }
  }

  /**
   * Get world items for a chunk
   *
   * NOTE: Not yet implemented - placeholder for future item persistence.
   *
   * @param _chunkX - Chunk X coordinate
   * @param _chunkZ - Chunk Z coordinate
   * @returns Empty array (not yet implemented)
   */
  async getWorldItemsAsync(
    _chunkX: number,
    _chunkZ: number,
  ): Promise<ItemRow[]> {
    console.warn(
      "[WorldChunkRepository] getWorldItemsAsync not yet implemented",
    );
    return [];
  }

  /**
   * Save world items for a chunk
   *
   * NOTE: Not yet implemented - placeholder for future item persistence.
   *
   * @param _chunkX - Chunk X coordinate
   * @param _chunkZ - Chunk Z coordinate
   * @param _items - Items to save
   */
  async saveWorldItemsAsync(
    _chunkX: number,
    _chunkZ: number,
    _items: ItemRow[],
  ): Promise<void> {
    console.warn(
      "[WorldChunkRepository] saveWorldItemsAsync not yet implemented",
    );
  }

  /**
   * Get inactive chunks
   *
   * Retrieves chunks that haven't been accessed in the specified time period.
   * Used for chunk cleanup and unloading.
   *
   * @param minutes - Number of minutes of inactivity
   * @returns Array of inactive chunk records
   */
  async getInactiveChunksAsync(minutes: number): Promise<WorldChunkRow[]> {
    this.ensureDatabase();

    const cutoffTime = Date.now() - minutes * 60 * 1000;

    const results = await this.db
      .select()
      .from(schema.worldChunks)
      .where(sql`${schema.worldChunks.lastActive} < ${cutoffTime}`);

    return results as WorldChunkRow[];
  }

  /**
   * Update chunk player count
   *
   * Updates the number of players currently in a chunk.
   * Used for chunk activity tracking and resource management.
   *
   * Rate limited via semaphore to prevent connection pool exhaustion.
   *
   * @param chunkX - Chunk X coordinate
   * @param chunkZ - Chunk Z coordinate
   * @param playerCount - Number of players in chunk
   */
  async updateChunkPlayerCountAsync(
    chunkX: number,
    chunkZ: number,
    playerCount: number,
  ): Promise<void> {
    if (this.isDestroying) {
      // Gracefully skip during shutdown
      return;
    }

    this.ensureDatabase();

    // Acquire semaphore to limit concurrent updates
    await WorldChunkRepository.saveSemaphore.acquire();

    try {
      await this.db
        .update(schema.worldChunks)
        .set({ playerCount })
        .where(
          and(
            eq(schema.worldChunks.chunkX, chunkX),
            eq(schema.worldChunks.chunkZ, chunkZ),
          ),
        );
    } finally {
      WorldChunkRepository.saveSemaphore.release();
    }
  }

  /**
   * Mark chunk for reset
   *
   * Flags a chunk to be reset to default generation.
   * The chunk will be regenerated next time it's loaded.
   *
   * @param chunkX - Chunk X coordinate
   * @param chunkZ - Chunk Z coordinate
   */
  async markChunkForResetAsync(chunkX: number, chunkZ: number): Promise<void> {
    this.ensureDatabase();

    await this.db
      .update(schema.worldChunks)
      .set({ needsReset: 1 })
      .where(
        and(
          eq(schema.worldChunks.chunkX, chunkX),
          eq(schema.worldChunks.chunkZ, chunkZ),
        ),
      );
  }

  /**
   * Reset chunk
   *
   * Deletes chunk data to allow it to regenerate with default generation.
   * Called after a chunk is marked for reset.
   *
   * @param chunkX - Chunk X coordinate
   * @param chunkZ - Chunk Z coordinate
   */
  async resetChunkAsync(chunkX: number, chunkZ: number): Promise<void> {
    this.ensureDatabase();

    // Delete the chunk to allow it to regenerate
    await this.db
      .delete(schema.worldChunks)
      .where(
        and(
          eq(schema.worldChunks.chunkX, chunkX),
          eq(schema.worldChunks.chunkZ, chunkZ),
        ),
      );
  }

  /**
   * Clean up old chunk activity records
   *
   * Deletes chunk activity records older than the specified number of days.
   * Used for maintenance to keep the database clean.
   *
   * @param daysOld - Delete activity records older than this many days
   * @returns Number of records deleted
   */
  async cleanupOldChunkActivityAsync(daysOld: number): Promise<number> {
    this.ensureDatabase();

    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    // Delete activity records where exitTime is set and older than cutoff
    const result = await this.db
      .delete(schema.chunkActivity)
      .where(
        sql`${schema.chunkActivity.exitTime} IS NOT NULL AND ${schema.chunkActivity.exitTime} < ${cutoffTime}`,
      );

    // PostgreSQL returns rowCount for delete operations
    return result.rowCount ?? 0;
  }

  /**
   * Get count of chunks
   *
   * Returns the total number of chunks in the database.
   *
   * @returns Total number of chunks
   */
  async getChunkCountAsync(): Promise<number> {
    this.ensureDatabase();

    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.worldChunks);

    return result[0]?.count ?? 0;
  }

  /**
   * Get count of active chunks
   *
   * Returns the number of chunks with players currently in them.
   *
   * @returns Number of active chunks
   */
  async getActiveChunkCountAsync(): Promise<number> {
    this.ensureDatabase();

    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.worldChunks)
      .where(sql`${schema.worldChunks.playerCount} > 0`);

    return result[0]?.count ?? 0;
  }

  /**
   * Get count of total chunk activity records
   *
   * Returns the total number of chunk activity records.
   *
   * @returns Total number of activity records
   */
  async getTotalActivityRecordsAsync(): Promise<number> {
    this.ensureDatabase();

    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.chunkActivity);

    return result[0]?.count ?? 0;
  }
}
