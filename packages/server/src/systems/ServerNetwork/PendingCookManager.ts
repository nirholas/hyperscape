/**
 * PendingCookManager - Server-Authoritative Cooking
 *
 * Modeled after PendingGatherManager for resource gathering.
 * Handles the movement-to-cook flow when a player clicks a fire.
 *
 * SERVER-AUTHORITATIVE FLOW:
 * 1. Player clicks fire → client sends cookingSourceInteract with fireId
 * 2. Server looks up fire's TRUE position from injected FireRegistry
 * 3. Server calculates best cardinal tile using GATHERING_CONSTANTS.GATHERING_RANGE
 * 4. Server paths player to that tile via movePlayerToward()
 * 5. Every tick, server checks if player arrived at cardinal tile
 * 6. When arrived, server starts cooking via PROCESSING_COOKING_REQUEST event
 *
 * DEPENDENCY INJECTION (Phase 4.2):
 * FireRegistry is now injected via constructor instead of looked up via getSystem().
 * This improves testability and follows the Dependency Inversion Principle.
 *
 * @see PendingGatherManager - resource gathering equivalent
 * @see PendingAttackManager - combat equivalent
 * @see Phase 4.2 of COOKING_FIREMAKING_HARDENING_PLAN.md
 */

import type { World, Fire } from "@hyperscape/shared";
import {
  EventType,
  worldToTileInto,
  tilesWithinMeleeRange,
  type TileCoord,
  GATHERING_CONSTANTS,
} from "@hyperscape/shared";
import type { TileMovementManager } from "./tile-movement";

/**
 * FireRegistry interface for dependency injection.
 * Allows PendingCookManager to access fire data without
 * directly coupling to ProcessingSystem.
 */
export interface FireRegistry {
  getActiveFires(): Map<string, Fire>;
}

/**
 * Pending cook request data
 */
interface PendingCook {
  playerId: string;
  fireId: string;
  /** Fire tile position */
  fireTile: TileCoord;
  /** Fire world position */
  firePosition: { x: number; y: number; z: number };
  /** Last known player tile (for detecting arrival) */
  lastPlayerTile: TileCoord;
  /** When this pending cook was created (for timeout) */
  createdTick: number;
  /** Specific inventory slot to cook from (-1 = find first raw_shrimp) */
  fishSlot: number;
}

/** Timeout for pending cooks (in ticks) - 20 ticks = 12 seconds at 600ms/tick */
const PENDING_COOK_TIMEOUT_TICKS = 20;

export class PendingCookManager {
  private world: World;
  private tileMovementManager: TileMovementManager;
  private fireRegistry: FireRegistry;

  /** Map of playerId → pending cook data */
  private pendingCooks: Map<string, PendingCook> = new Map();

  /** Pre-allocated tile buffers (zero-allocation hot path) */
  private readonly _playerTile: TileCoord = { x: 0, z: 0 };
  private readonly _fireTile: TileCoord = { x: 0, z: 0 };

  /**
   * Create a new PendingCookManager.
   *
   * @param world - World instance for player lookups
   * @param tileMovementManager - Movement manager for pathing
   * @param fireRegistry - Injected fire registry (Phase 4.2 DIP)
   */
  constructor(
    world: World,
    tileMovementManager: TileMovementManager,
    fireRegistry: FireRegistry,
  ) {
    this.world = world;
    this.tileMovementManager = tileMovementManager;
    this.fireRegistry = fireRegistry;
  }

  /**
   * Queue a pending cook for a player.
   * Called when player clicks a fire OR uses raw food on fire.
   *
   * SERVER-AUTHORITATIVE: Server looks up fire position and paths player.
   *
   * @param playerId - The player ID
   * @param fireId - The fire ID
   * @param firePosition - Fire world position from client (validated against server)
   * @param currentTick - Current game tick
   * @param runMode - Player's run mode preference from client
   * @param fishSlot - Specific inventory slot to cook from (-1 = find first raw_shrimp)
   */
  queuePendingCook(
    playerId: string,
    fireId: string,
    firePosition: { x: number; y: number; z: number },
    currentTick: number,
    runMode?: boolean,
    fishSlot: number = -1,
  ): void {
    // Cancel any existing pending cook
    this.cancelPendingCook(playerId);

    // Look up fire using injected FireRegistry (Phase 4.2 DIP)
    const fires = this.fireRegistry.getActiveFires();
    const fire = fires.get(fireId);

    if (!fire || !fire.isActive) {
      console.log(`[PendingCook] Fire ${fireId} not found or inactive`);
      return;
    }

    // Get player entity
    const player = this.world.getPlayer?.(playerId);
    if (!player?.position) {
      console.warn(`[PendingCook] Player ${playerId} not found`);
      return;
    }

    // Calculate tiles
    worldToTileInto(player.position.x, player.position.z, this._playerTile);
    worldToTileInto(fire.position.x, fire.position.z, this._fireTile);

    console.log(
      `[PendingCook] SERVER-AUTHORITATIVE: Player ${playerId} wants to cook at fire ${fireId}`,
    );
    console.log(
      `[PendingCook]   Fire at tile (${this._fireTile.x}, ${this._fireTile.z})`,
    );
    console.log(
      `[PendingCook]   Player at tile (${this._playerTile.x}, ${this._playerTile.z})`,
    );

    // Check if already on a cardinal tile adjacent to fire
    if (
      tilesWithinMeleeRange(
        this._playerTile,
        this._fireTile,
        GATHERING_CONSTANTS.GATHERING_RANGE,
      )
    ) {
      console.log(
        `[PendingCook]   Already on cardinal tile - starting cook immediately`,
      );
      this.startCooking(playerId, fireId, fishSlot);
      return;
    }

    // Walk to cardinal tile adjacent to fire
    const isRunning =
      runMode ?? this.tileMovementManager.getIsRunning(playerId);

    console.log(
      `[PendingCook]   Movement mode: ${isRunning ? "running" : "walking"}`,
    );

    // Use GATHERING_RANGE (1) for cardinal-only positioning
    this.tileMovementManager.movePlayerToward(
      playerId,
      fire.position,
      isRunning,
      GATHERING_CONSTANTS.GATHERING_RANGE,
    );

    // Store pending cook
    this.pendingCooks.set(playerId, {
      playerId,
      fireId,
      fireTile: { x: this._fireTile.x, z: this._fireTile.z },
      firePosition: { ...fire.position },
      lastPlayerTile: { x: this._playerTile.x, z: this._playerTile.z },
      createdTick: currentTick,
      fishSlot,
    });

    console.log(
      `[PendingCook]   Queued pending cook, waiting for player to arrive`,
    );
  }

  /**
   * Cancel pending cook for a player
   */
  cancelPendingCook(playerId: string): void {
    if (this.pendingCooks.has(playerId)) {
      this.pendingCooks.delete(playerId);
      console.log(`[PendingCook] Cancelled pending cook for ${playerId}`);
    }
  }

  /**
   * Clean up when a player disconnects.
   * Prevents memory leak from orphaned pending cook entries.
   */
  onPlayerDisconnect(playerId: string): void {
    if (this.pendingCooks.has(playerId)) {
      this.pendingCooks.delete(playerId);
      console.log(
        `[PendingCook] Cleaned up pending cook for disconnected player ${playerId}`,
      );
    }
  }

  /**
   * Process all pending cooks - called every tick
   * Checks if players have arrived at cardinal tiles and starts cooking
   */
  processTick(currentTick: number): void {
    for (const [playerId, pending] of this.pendingCooks) {
      try {
        this.processPlayerPendingCook(playerId, pending, currentTick);
      } catch (error) {
        console.error(
          `[PendingCook] Error processing player ${playerId} for fire ${pending.fireId}:`,
          error,
        );
        this.pendingCooks.delete(playerId);
      }
    }
  }

  /**
   * Process a single player's pending cook check
   */
  private processPlayerPendingCook(
    playerId: string,
    pending: PendingCook,
    currentTick: number,
  ): void {
    // Check timeout
    if (currentTick - pending.createdTick > PENDING_COOK_TIMEOUT_TICKS) {
      console.log(`[PendingCook] Timeout for ${playerId}`);
      this.pendingCooks.delete(playerId);
      return;
    }

    // Get player entity
    const player = this.world.getPlayer?.(playerId);
    if (!player?.position) {
      this.pendingCooks.delete(playerId);
      return;
    }

    // Check if fire still exists and is active (using injected FireRegistry)
    const fires = this.fireRegistry.getActiveFires();
    const fire = fires.get(pending.fireId);

    if (!fire || !fire.isActive) {
      console.log(`[PendingCook] Fire ${pending.fireId} no longer available`);
      this.pendingCooks.delete(playerId);
      return;
    }

    // Get current player tile
    worldToTileInto(player.position.x, player.position.z, this._playerTile);

    // Check if player arrived at cardinal tile adjacent to fire
    const hasArrived = tilesWithinMeleeRange(
      this._playerTile,
      pending.fireTile,
      GATHERING_CONSTANTS.GATHERING_RANGE,
    );

    if (hasArrived) {
      console.log(
        `[PendingCook] Player ${playerId} arrived at cardinal tile - starting cook`,
      );

      // Start cooking with the stored fishSlot
      this.startCooking(playerId, pending.fireId, pending.fishSlot);

      // Remove from pending
      this.pendingCooks.delete(playerId);
    }
  }

  /**
   * Start the cooking process
   * @param fishSlot - Specific inventory slot to cook from (-1 = find first raw_shrimp)
   */
  private startCooking(
    playerId: string,
    fireId: string,
    fishSlot: number,
  ): void {
    // Emit PROCESSING_COOKING_REQUEST event - ProcessingSystem will handle the actual cooking
    // fishSlot = -1 means server should find first raw_shrimp slot
    this.world.emit(EventType.PROCESSING_COOKING_REQUEST, {
      playerId,
      fireId,
      fishSlot,
    });
  }
}
