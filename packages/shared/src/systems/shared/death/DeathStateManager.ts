/**
 * DeathStateManager
 *
 * Tracks active player deaths with dual persistence:
 * - In-memory cache for fast access (client & server)
 * - Database persistence for durability (server only)
 *
 * CRITICAL FOR SECURITY:
 * Database persistence prevents item duplication on server restart/crash.
 * If server restarts mid-death, the death lock in DB prevents re-spawning items.
 *
 * P0-004: Database-first write order (write DB before memory)
 * P0-005: Server startup death recovery (recoverUnfinishedDeaths in init)
 *
 * NOTE: This is just for tracking - gravestone/ground items are regular
 * world entities that persist via the entity system (like RuneScape).
 */

import type { World } from "../../../core/World";
import type {
  DeathLock,
  ZoneType,
  TransactionContext,
} from "../../../types/death";
import type { InventoryItem } from "../../../types/core/core";
import type { EntityManager } from "..";
import { EventType } from "../../../types/events";

/**
 * P0-003: Death item data for crash recovery
 */
interface DeathItemData {
  itemId: string;
  quantity: number;
}

/**
 * P0-003: Full death lock data including crash recovery fields
 */
interface DeathLockData {
  playerId: string;
  gravestoneId: string | null;
  groundItemIds: string[];
  position: { x: number; y: number; z: number };
  timestamp: number;
  zoneType: string;
  itemCount: number;
  items: DeathItemData[];
  killedBy: string;
  recovered: boolean;
}

// Type for DatabaseSystem (only available on server)
type DatabaseSystem = {
  saveDeathLockAsync: (
    data: DeathLockData,
    tx?: TransactionContext,
  ) => Promise<void>;
  getDeathLockAsync: (playerId: string) => Promise<DeathLockData | null>;
  deleteDeathLockAsync: (playerId: string) => Promise<void>;
  updateGroundItemsAsync: (
    playerId: string,
    groundItemIds: string[],
  ) => Promise<void>;
  // P0-005: Crash recovery methods
  getUnrecoveredDeathsAsync: () => Promise<DeathLockData[]>;
  markDeathRecoveredAsync: (playerId: string) => Promise<void>;
};

export class DeathStateManager {
  private entityManager: EntityManager | null = null;
  private databaseSystem: DatabaseSystem | null = null;

  // In-memory cache for fast access (both client and server)
  private activeDeaths = new Map<string, DeathLock>();

  constructor(private world: World) {}

  /**
   * Initialize - get entity manager and database system references
   * P0-005: Also recovers unfinished deaths from previous server session
   */
  async init(): Promise<void> {
    this.entityManager = this.world.getSystem(
      "entity-manager",
    ) as EntityManager | null;

    // Get database system (server only)
    if (this.world.isServer) {
      this.databaseSystem = this.world.getSystem(
        "database",
      ) as unknown as DatabaseSystem | null;
      if (this.databaseSystem) {
        console.log(
          "[DeathStateManager] ✓ Initialized with database persistence (server)",
        );

        // P0-005: CRITICAL - Recover unfinished deaths from previous server session
        // This prevents item loss when server crashes during death handling
        await this.recoverUnfinishedDeaths();
      } else {
        console.warn(
          "[DeathStateManager] ⚠️ DatabaseSystem not available - running without persistence!",
        );
      }
    } else {
      console.log("[DeathStateManager] ✓ Initialized (client, in-memory only)");
    }
  }

  /**
   * P0-005: Recover unfinished deaths from database after server restart
   *
   * CRITICAL: Prevents item loss when server crashes during death handling.
   *
   * Recovery logic:
   * 1. Query all player_deaths where recovered = false
   * 2. For each death, check if gravestone/ground items still exist
   * 3. If not, emit DEATH_RECOVERED event to recreate them
   * 4. Mark death as recovered in database
   */
  private async recoverUnfinishedDeaths(): Promise<void> {
    if (!this.databaseSystem) return;

    console.log(
      "[DeathStateManager] Checking for unfinished deaths to recover...",
    );

    try {
      const unrecoveredDeaths =
        await this.databaseSystem.getUnrecoveredDeathsAsync();

      if (unrecoveredDeaths.length === 0) {
        console.log("[DeathStateManager] No unfinished deaths to recover");
        return;
      }

      console.log(
        `[DeathStateManager] Found ${unrecoveredDeaths.length} unfinished deaths to recover`,
      );

      for (const death of unrecoveredDeaths) {
        await this.recoverSingleDeath(death);
      }

      console.log(
        `[DeathStateManager] Recovery complete: ${unrecoveredDeaths.length} deaths processed`,
      );
    } catch (error) {
      console.error("[DeathStateManager] Death recovery failed:", error);
      // Don't throw - server should start even if recovery fails
      // Items may be lost but server remains functional
    }
  }

  /**
   * P0-005: Recover a single unfinished death
   *
   * Checks if entities still exist, recreates if necessary, marks as recovered.
   */
  private async recoverSingleDeath(death: DeathLockData): Promise<void> {
    const {
      playerId,
      gravestoneId,
      groundItemIds,
      position,
      zoneType,
      items,
      killedBy,
    } = death;

    console.log(
      `[DeathStateManager] Recovering death for ${playerId}: ${items.length} items, zone: ${zoneType}`,
    );

    // Check if gravestone still exists
    let gravestoneExists = false;
    if (gravestoneId && this.entityManager) {
      const entity = this.world.entities?.get(gravestoneId);
      gravestoneExists = !!entity;
    }

    // Check if ground items still exist
    const existingGroundItems = groundItemIds.filter((id) => {
      return !!this.world.entities?.get(id);
    });

    // If items are already recovered (entities exist), just restore memory state
    if (gravestoneExists || existingGroundItems.length > 0) {
      console.log(
        `[DeathStateManager] Death for ${playerId} partially recovered - entities exist`,
      );

      // Restore to in-memory cache
      this.activeDeaths.set(playerId, {
        playerId,
        gravestoneId: gravestoneExists ? gravestoneId! : undefined,
        groundItemIds: existingGroundItems,
        position,
        timestamp: Date.now(),
        zoneType: zoneType as ZoneType,
        itemCount: items.length,
      });
    } else if (items.length > 0) {
      // Items were stored but entities don't exist - recreate them
      console.log(
        `[DeathStateManager] Recreating items for ${playerId} death recovery`,
      );

      // Convert stored items back to InventoryItem format
      const inventoryItems: InventoryItem[] = items.map((item, index) => ({
        id: `recovery_${playerId}_${Date.now()}_${index}`,
        itemId: item.itemId,
        quantity: item.quantity,
        slot: -1,
        metadata: null,
      }));

      // Emit DEATH_RECOVERED event - handlers will recreate gravestone/ground items
      this.world.emit(EventType.DEATH_RECOVERED, {
        playerId,
        position,
        items: inventoryItems,
        killedBy,
        zoneType: zoneType as ZoneType,
      });
    }

    // Mark death as recovered in database
    await this.databaseSystem!.markDeathRecoveredAsync(playerId);

    console.log(`[DeathStateManager] ✓ Death recovered for ${playerId}`);
  }

  /**
   * Track a player death (for cleanup purposes)
   * P0-004: Database-first write order - stores in database BEFORE memory
   *
   * @param playerId - The player who died
   * @param options - Death lock options (gravestone ID, ground items, position, etc.)
   * @param tx - Optional transaction context for atomic operations (server only)
   */
  async createDeathLock(
    playerId: string,
    options: {
      gravestoneId?: string;
      groundItemIds?: string[];
      position: { x: number; y: number; z: number };
      zoneType: ZoneType;
      itemCount: number;
      // P0-003: Crash recovery fields
      items?: Array<{ itemId: string; quantity: number }>;
      killedBy?: string;
    },
    tx?: TransactionContext,
  ): Promise<void> {
    // CRITICAL: Server authority check - prevent client from creating fake death locks
    if (!this.world.isServer) {
      console.error(
        `[DeathStateManager] ⚠️  Client attempted server-only death lock creation for ${playerId} - BLOCKED`,
      );
      return;
    }

    const timestamp = Date.now();

    // P0-004: CRITICAL - Write to DATABASE FIRST before memory!
    // This prevents item loss if server crashes after memory update but before DB write.
    if (this.databaseSystem) {
      try {
        await this.databaseSystem.saveDeathLockAsync(
          {
            playerId,
            gravestoneId: options.gravestoneId || null,
            groundItemIds: options.groundItemIds || [],
            position: options.position,
            timestamp,
            zoneType: options.zoneType,
            itemCount: options.itemCount,
            // P0-003: Crash recovery fields
            items: options.items || [],
            killedBy: options.killedBy || "unknown",
            recovered: false, // New deaths are not yet recovered
          },
          tx, // Pass transaction context if provided
        );
        console.log(
          `[DeathStateManager] ✓ Persisted death lock to database for ${playerId}${tx ? " (in transaction)" : ""}`,
        );
      } catch (error) {
        console.error(
          `[DeathStateManager] ❌ Failed to persist death lock for ${playerId}:`,
          error,
        );
        // If in transaction, re-throw to trigger rollback
        if (tx) {
          throw error;
        }
        // P0-004: If DB write fails and not in transaction, still update memory
        // but log warning that crash recovery won't work
        console.warn(
          `[DeathStateManager] ⚠️ Death lock for ${playerId} only in memory - crash recovery won't work!`,
        );
      }
    }

    // P0-004: Update memory AFTER successful database write (or if no DB system)
    const deathData: DeathLock = {
      playerId,
      gravestoneId: options.gravestoneId,
      groundItemIds: options.groundItemIds,
      position: options.position,
      timestamp,
      zoneType: options.zoneType,
      itemCount: options.itemCount,
    };
    this.activeDeaths.set(playerId, deathData);

    console.log(
      `[DeathStateManager] ✓ Tracking death for ${playerId}: ${options.itemCount} items, zone: ${options.zoneType}`,
    );
  }

  /**
   * Clear death tracking (items have been looted or despawned)
   * Removes from memory AND database (server only)
   */
  async clearDeathLock(playerId: string): Promise<void> {
    // Remove from in-memory cache
    this.activeDeaths.delete(playerId);

    // Remove from database (server only)
    if (this.world.isServer && this.databaseSystem) {
      try {
        await this.databaseSystem.deleteDeathLockAsync(playerId);
        console.log(
          `[DeathStateManager] ✓ Deleted death lock from database for ${playerId}`,
        );
      } catch (error) {
        console.error(
          `[DeathStateManager] ❌ Failed to delete death lock for ${playerId}:`,
          error,
        );
        // Continue anyway - in-memory tracking cleared
      }
    }

    console.log(`[DeathStateManager] ✓ Cleared death tracking for ${playerId}`);
  }

  /**
   * Get active death data
   * Checks in-memory cache first, then database (server only) as fallback
   */
  async getDeathLock(playerId: string): Promise<DeathLock | null> {
    // Check in-memory cache first (fast path)
    const cached = this.activeDeaths.get(playerId);
    if (cached) {
      return cached;
    }

    // Fallback to database (server only) - critical for reconnect validation
    if (this.world.isServer && this.databaseSystem) {
      try {
        const dbData = await this.databaseSystem.getDeathLockAsync(playerId);
        if (dbData) {
          // Reconstruct DeathLock from database data
          const deathLock: DeathLock = {
            playerId: dbData.playerId,
            gravestoneId: dbData.gravestoneId || undefined,
            groundItemIds: dbData.groundItemIds,
            position: dbData.position,
            timestamp: dbData.timestamp,
            zoneType: dbData.zoneType as ZoneType,
            itemCount: dbData.itemCount,
          };

          // Restore to in-memory cache
          this.activeDeaths.set(playerId, deathLock);
          console.log(
            `[DeathStateManager] ✓ Restored death lock from database for ${playerId}`,
          );
          return deathLock;
        }
      } catch (error) {
        console.error(
          `[DeathStateManager] ❌ Failed to fetch death lock from database for ${playerId}:`,
          error,
        );
        // Fall through to return null
      }
    }

    return null;
  }

  /**
   * Check if player has active death
   * Checks in-memory cache first, then database (server only) for reconnect validation
   */
  async hasActiveDeathLock(playerId: string): Promise<boolean> {
    // Check in-memory cache first (fast path)
    if (this.activeDeaths.has(playerId)) {
      return true;
    }

    // Fallback to database (server only) - CRITICAL for reconnect validation
    // Prevents duplicate deaths when player reconnects after server restart
    if (this.world.isServer && this.databaseSystem) {
      try {
        const dbData = await this.databaseSystem.getDeathLockAsync(playerId);
        if (dbData) {
          // Death lock exists in database - restore to memory
          const deathLock: DeathLock = {
            playerId: dbData.playerId,
            gravestoneId: dbData.gravestoneId || undefined,
            groundItemIds: dbData.groundItemIds,
            position: dbData.position,
            timestamp: dbData.timestamp,
            zoneType: dbData.zoneType as ZoneType,
            itemCount: dbData.itemCount,
          };
          this.activeDeaths.set(playerId, deathLock);
          console.log(
            `[DeathStateManager] ✓ Restored death lock from database for ${playerId} (hasActiveDeathLock check)`,
          );
          return true;
        }
      } catch (error) {
        console.error(
          `[DeathStateManager] ❌ Failed to check death lock in database for ${playerId}:`,
          error,
        );
        // Fall through to return false
      }
    }

    return false;
  }

  /**
   * Handle item looted from gravestone/ground
   * Updates in-memory AND database (server only)
   */
  async onItemLooted(playerId: string, itemId: string): Promise<void> {
    const deathData = this.activeDeaths.get(playerId);
    if (!deathData) return;

    // Remove item from ground item list
    if (deathData.groundItemIds) {
      const index = deathData.groundItemIds.indexOf(itemId);
      if (index !== -1) {
        deathData.groundItemIds.splice(index, 1);
      }
    }

    // Decrement item count
    deathData.itemCount = Math.max(0, deathData.itemCount - 1);

    // If all items looted, clear death tracking
    if (deathData.itemCount === 0) {
      await this.clearDeathLock(playerId);
      console.log(
        `[DeathStateManager] ✓ All items looted for ${playerId}, cleared tracking`,
      );
    } else {
      // Update in-memory record
      this.activeDeaths.set(playerId, deathData);

      // Update database (server only)
      if (this.world.isServer && this.databaseSystem) {
        try {
          await this.databaseSystem.saveDeathLockAsync({
            playerId,
            gravestoneId: deathData.gravestoneId || null,
            groundItemIds: deathData.groundItemIds || [],
            position: deathData.position,
            timestamp: deathData.timestamp,
            zoneType: deathData.zoneType,
            itemCount: deathData.itemCount,
            // P0-003: Preserve crash recovery fields
            items: deathData.items || [],
            killedBy: deathData.killedBy || "unknown",
            recovered: deathData.recovered || false,
          });
        } catch (error) {
          console.error(
            `[DeathStateManager] ❌ Failed to update death lock after item looted:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Handle gravestone expired (transitioned to ground items)
   * Updates in-memory AND database (server only)
   */
  async onGravestoneExpired(
    playerId: string,
    groundItemIds: string[],
  ): Promise<void> {
    const deathData = this.activeDeaths.get(playerId);
    if (!deathData) return;

    // Update tracking: gravestone → ground items
    deathData.gravestoneId = undefined;
    deathData.groundItemIds = groundItemIds;
    this.activeDeaths.set(playerId, deathData);

    // Update database (server only)
    if (this.world.isServer && this.databaseSystem) {
      try {
        await this.databaseSystem.updateGroundItemsAsync(
          playerId,
          groundItemIds,
        );
        console.log(
          `[DeathStateManager] ✓ Updated database: gravestone → ground items for ${playerId}`,
        );
      } catch (error) {
        console.error(
          `[DeathStateManager] ❌ Failed to update database after gravestone expired:`,
          error,
        );
      }
    }

    console.log(
      `[DeathStateManager] ✓ Gravestone expired for ${playerId}, transitioned to ${groundItemIds.length} ground items`,
    );
  }
}
