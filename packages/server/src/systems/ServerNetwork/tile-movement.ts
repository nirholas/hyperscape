/**
 * Tile Movement Manager
 *
 * RuneScape-style tile-based movement system.
 * Players move discretely from tile to tile on server ticks (600ms).
 *
 * Key differences from the old continuous system:
 * - Movement happens on ticks, not frames
 * - Players move 1 tile (walk) or 2 tiles (run) per tick
 * - Uses BFS pathfinding for paths
 * - Client interpolates visually between tile positions
 */

import type { ServerSocket } from "../../shared/types";
import {
  THREE,
  TerrainSystem,
  TownSystem,
  World,
  EventType,
  DeathState,
  AttackType,
  // Tile movement utilities
  TILES_PER_TICK_WALK,
  TILES_PER_TICK_RUN,
  worldToTile,
  worldToTileInto,
  tileToWorld,
  tilesEqual,
  tilesWithinMeleeRange,
  tilesWithinRange,
  getBestMeleeTile,
  getBestCombatRangeTile,
  createTileMovementState,
  BFSPathfinder,
  // Collision system
  CollisionMask,
} from "@hyperscape/shared";
import type {
  TileCoord,
  TileMovementState,
  EntityID,
} from "@hyperscape/shared";

// Security: Input validation and anti-cheat
import {
  MovementInputValidator,
  MovementViolationSeverity,
} from "./movement/MovementInputValidator";
import { MovementAntiCheat } from "./movement/MovementAntiCheat";
import {
  getTileMovementRateLimiter,
  getPathfindRateLimiter,
} from "./services/SlidingWindowRateLimiter";

// Agility XP constants (batched to prevent visual spam)
const AGILITY_TILES_PER_XP_GRANT = 100; // Tiles needed before XP is granted
const AGILITY_XP_PER_GRANT = 50; // XP granted per threshold (effectively 1 XP per 2 tiles)

/**
 * Tile-based movement manager for RuneScape-style movement
 */
export class TileMovementManager {
  private playerStates: Map<string, TileMovementState> = new Map();
  private pathfinder: BFSPathfinder;

  /**
   * Agility XP tracking: tiles traveled per player (batched at 100 tiles = 50 XP)
   * Reset on death, cleared on disconnect
   */
  private tilesTraveledForXP: Map<string, number> = new Map();
  // Y-axis for stable yaw rotation calculation
  private _up = new THREE.Vector3(0, 1, 0);
  private _tempQuat = new THREE.Quaternion();

  /**
   * Arrival emotes: When a player arrives at destination, use this emote instead of "idle"
   * Used by gathering systems (fishing, mining, etc.) to set the action emote atomically
   * with the movement end packet, preventing race conditions on the client.
   */
  private arrivalEmotes: Map<string, string> = new Map();

  /**
   * OSRS-ACCURATE: Tick-start positions for all players
   * Captured at the VERY START of onTick(), BEFORE any movement processing.
   * Used by FollowManager to create the 1-tick delay effect.
   *
   * Key insight from OSRS: "The important part is to set the previousTile
   * at the start (or the end) of the tick not when they actually move"
   */
  private tickStartTiles: Map<string, TileCoord> = new Map();

  // Security: Input validation and anti-cheat monitoring
  private readonly inputValidator = new MovementInputValidator();
  private readonly antiCheat = new MovementAntiCheat();
  private readonly movementRateLimiter = getTileMovementRateLimiter();
  private readonly pathfindRateLimiter = getPathfindRateLimiter();

  // Cached reference to EntityManager for spatial registry updates
  private _entityManager: {
    updatePlayerPosition?: (playerId: string, x: number, z: number) => void;
  } | null = null;
  private _entityManagerChecked = false;

  // Cached reference to TownSystem for building collision
  private _townSystem: InstanceType<typeof TownSystem> | null = null;
  private _townSystemChecked = false;

  // Diagnostic: Log building status once per session
  private _hasLoggedBuildingStatus = false;

  /**
   * Current player floor for walkability checks.
   * Set before pathfinding operations for floor-aware collision.
   * Defaults to 0 (ground floor) when not set.
   */
  private currentPlayerFloor: number = 0;

  /**
   * Current player's building ID for layer separation.
   * If null, player is on ground layer (outside buildings).
   * If set, player is in building layer and BFS should ONLY explore building tiles.
   */
  private currentPlayerBuildingId: string | null = null;

  /**
   * Get EntityManager for spatial registry updates (cached lazy lookup)
   */
  private get entityManager() {
    if (!this._entityManagerChecked) {
      this._entityManager = this.world.getSystem?.("entity-manager") as {
        updatePlayerPosition?: (playerId: string, x: number, z: number) => void;
      } | null;
      this._entityManagerChecked = true;
      if (!this._entityManager?.updatePlayerPosition) {
        console.warn(
          "[TileMovement] EntityManager not available for spatial position tracking",
        );
      }
    }
    return this._entityManager;
  }

  /**
   * Get TownSystem for building collision (cached lazy lookup)
   * Note: Re-checks if no buildings are registered to handle async initialization
   */
  private get townSystem(): InstanceType<typeof TownSystem> | null {
    // Re-check TownSystem if we haven't found buildings yet
    // This handles the case where first access happens before collision registration
    if (
      !this._townSystemChecked ||
      (this._townSystem &&
        this._townSystem.getCollisionService().getBuildingCount() === 0)
    ) {
      this._townSystem = this.world.getSystem?.("towns") as InstanceType<
        typeof TownSystem
      > | null;

      if (this._townSystem) {
        const buildingCount = this._townSystem
          .getCollisionService()
          .getBuildingCount();
        if (buildingCount > 0) {
          // Found buildings - cache the system
          this._townSystemChecked = true;
        }
        // If no buildings, don't cache yet - keep checking
      } else {
        this._townSystemChecked = true; // No TownSystem available at all
      }
    }
    return this._townSystem;
  }

  // ============================================================================
  // PRE-ALLOCATED BUFFERS (Zero-allocation hot path support)
  // ============================================================================

  /** Reusable tile coordinate for previous position in onTick/processPlayerTick */
  private readonly _prevTile: TileCoord = { x: 0, z: 0 };

  /** Reusable tile coordinate for target position calculations */
  private readonly _targetTile: TileCoord = { x: 0, z: 0 };

  /** Reusable tile coordinate for entity position sync */
  private readonly _actualEntityTile: TileCoord = { x: 0, z: 0 };

  /** Pre-allocated buffer for network path transmission (avoids .map() allocation) */
  private readonly _networkPathBuffer: Array<{ x: number; z: number }> = [];

  constructor(
    private world: World,
    private sendFn: (
      name: string,
      data: unknown,
      ignoreSocketId?: string,
    ) => void,
  ) {
    this.pathfinder = new BFSPathfinder();
  }

  /**
   * Get terrain system
   */
  private getTerrain(): InstanceType<typeof TerrainSystem> | null {
    return this.world.getSystem("terrain") as InstanceType<
      typeof TerrainSystem
    > | null;
  }

  // Debug flag for walkability logging (set to true to debug pathfinding)
  // NOTE: Keep disabled in production - excessive logging causes performance issues
  private _debugWalkability = false;

  // Track logged building mismatch tiles to avoid spam
  private loggedBuildingMismatchTiles: Set<string> | null = null;

  /**
   * Enable/disable walkability debug logging
   */
  setDebugWalkability(enabled: boolean): void {
    this._debugWalkability = enabled;
    console.log(
      `[TileMovement] Walkability debug logging ${enabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * Check if a tile is walkable based on collision and terrain constraints.
   *
   * STRICT LAYER SEPARATION:
   * - When player is on GROUND (currentPlayerBuildingId === null):
   *   Only GROUND tiles are walkable. Building tiles are blocked EXCEPT door tiles
   *   which serve as transition points.
   * - When player is in BUILDING (currentPlayerBuildingId !== null):
   *   Only tiles within the SAME building are walkable. Ground tiles are blocked
   *   EXCEPT door approach tiles which serve as exit transition points.
   *
   * @param tile - Target tile to check walkability
   * @param fromTile - Optional source tile for directional wall checks
   * @returns true if tile is walkable (and movement from fromTile is not blocked)
   */
  private isTileWalkable(tile: TileCoord, fromTile?: TileCoord): boolean {
    const towns = this.townSystem;
    const playerFloor = this.currentPlayerFloor;
    const playerBuildingId = this.currentPlayerBuildingId;
    const debug = this._debugWalkability;

    // Get collision service once for all checks
    const collisionService = towns?.getCollisionService();

    // Check if target tile is inside a building's WALKABLE footprint
    const targetBuildingId = collisionService?.isTileInBuildingFootprint(
      tile.x,
      tile.z,
    );
    const targetIsBuilding = targetBuildingId !== null;

    // ALSO check if tile is inside a building's BOUNDING BOX (even if not walkable)
    // This catches tiles UNDER buildings that shouldn't be pathable
    const targetInBuildingBbox = collisionService?.isTileInBuildingBoundingBox(
      tile.x,
      tile.z,
    );
    const targetUnderBuilding =
      targetInBuildingBbox !== null && !targetIsBuilding;

    // =========================================================================
    // LAYER SEPARATION: Ground vs Building
    // =========================================================================

    if (playerBuildingId === null) {
      // PLAYER IS ON GROUND LAYER

      // Block tiles UNDER buildings that aren't walkable floor tiles
      // (These are tiles inside building bbox but not in walkable footprint)
      if (targetUnderBuilding && collisionService) {
        // Check if this is a door EXTERIOR tile (approach area)
        const isWalkableUnderBuilding =
          collisionService.isTileWalkableInBuilding(
            tile.x,
            tile.z,
            0, // Ground floor
          );
        if (!isWalkableUnderBuilding) {
          if (debug) {
            console.log(
              `[isTileWalkable] BLOCKED by layer separation: tile (${tile.x},${tile.z}) ` +
                `is under building ${targetInBuildingBbox} but not walkable`,
            );
          }
          return false;
        }
      }

      // Building tiles (in walkable footprint) are UNWALKABLE unless this is a door transition
      if (targetIsBuilding && collisionService) {
        // Check if this is a door tile (transition point INTO building)
        const doorOpenings = collisionService.getDoorOpeningsAtTile(
          tile.x,
          tile.z,
          0, // Ground floor for entering
        );
        if (doorOpenings.length === 0) {
          // Not a door tile - building interior is unwalkable from ground
          if (debug) {
            console.log(
              `[isTileWalkable] BLOCKED by layer separation: ground player cannot enter ` +
                `building tile (${tile.x},${tile.z}) building=${targetBuildingId} (not a door)`,
            );
          }
          return false;
        }
        // Door tile - allow as transition point
      }
    } else {
      // PLAYER IS IN BUILDING LAYER

      // Block tiles under a DIFFERENT building
      if (targetUnderBuilding && targetInBuildingBbox !== playerBuildingId) {
        if (debug) {
          console.log(
            `[isTileWalkable] BLOCKED by layer separation: building player (${playerBuildingId}) ` +
              `cannot path through different building ${targetInBuildingBbox} bbox at (${tile.x},${tile.z})`,
          );
        }
        return false;
      }

      if (targetIsBuilding) {
        // Target is a building tile - only allow if SAME building
        if (targetBuildingId !== playerBuildingId) {
          if (debug) {
            console.log(
              `[isTileWalkable] BLOCKED by layer separation: building player (${playerBuildingId}) ` +
                `cannot enter different building (${targetBuildingId}) at (${tile.x},${tile.z})`,
            );
          }
          return false;
        }
        // Same building - proceed with standard checks
      } else {
        // Target is a GROUND tile - only allow if this is a door exit transition
        if (collisionService && fromTile) {
          // Check if we're exiting through a door
          const fromBuildingId = collisionService.isTileInBuildingFootprint(
            fromTile.x,
            fromTile.z,
          );
          if (fromBuildingId === playerBuildingId) {
            // Moving from inside building to ground - check for door
            const doorOpenings = collisionService.getDoorOpeningsAtTile(
              fromTile.x,
              fromTile.z,
              playerFloor,
            );
            const dx = tile.x - fromTile.x;
            const dz = tile.z - fromTile.z;
            let exitDirection: "north" | "south" | "east" | "west" | null =
              null;
            if (dx === 1) exitDirection = "east";
            else if (dx === -1) exitDirection = "west";
            else if (dz === 1) exitDirection = "south";
            else if (dz === -1) exitDirection = "north";

            if (!exitDirection || !doorOpenings.includes(exitDirection)) {
              if (debug) {
                console.log(
                  `[isTileWalkable] BLOCKED by layer separation: building player cannot exit ` +
                    `to ground tile (${tile.x},${tile.z}) without door. fromTile doors=[${doorOpenings.join(",")}]`,
                );
              }
              return false;
            }
            // Door exit - allow as transition point
          }
        } else if (!fromTile) {
          // No fromTile - this is a destination check, not a path step
          // Ground tiles are not valid destinations from inside building
          // (Two-stage nav will find the door first)
          if (debug) {
            console.log(
              `[isTileWalkable] BLOCKED by layer separation: building player ` +
                `cannot target ground tile (${tile.x},${tile.z}) directly`,
            );
          }
          return false;
        }
      }
    }

    // =========================================================================
    // WALL BLOCKING: Check directional blocking between tiles
    // =========================================================================
    if (fromTile && towns && collisionService) {
      // Check building wall blocking (handles entry, exit, and internal movement)
      const wallBlocked = towns.isBuildingWallBlocked(
        fromTile.x,
        fromTile.z,
        tile.x,
        tile.z,
        playerFloor,
      );
      if (wallBlocked) {
        if (debug) {
          const fromResult = collisionService.queryCollision(
            fromTile.x,
            fromTile.z,
            playerFloor,
          );
          const toResult = collisionService.queryCollision(
            tile.x,
            tile.z,
            playerFloor,
          );
          console.log(
            `[isTileWalkable] BLOCKED by building wall: (${fromTile.x},${fromTile.z}) -> (${tile.x},${tile.z}) floor=${playerFloor}` +
              ` | from=${fromResult.buildingId || "none"} walls=${JSON.stringify(fromResult.wallBlocking)}` +
              ` | to=${toResult.buildingId || "none"} walls=${JSON.stringify(toResult.wallBlocking)}`,
          );
        }
        return false;
      }

      // Also check CollisionMatrix directional walls (for non-building obstacles)
      if (
        this.world.collision.isBlocked(fromTile.x, fromTile.z, tile.x, tile.z)
      ) {
        if (debug) {
          console.log(
            `[isTileWalkable] BLOCKED by CollisionMatrix wall: (${fromTile.x},${fromTile.z}) -> (${tile.x},${tile.z})`,
          );
        }
        return false;
      }

      // Check step directional blocking (can only approach steps from front)
      const stepBlocked = collisionService.isStepBlocked(
        fromTile.x,
        fromTile.z,
        tile.x,
        tile.z,
      );
      if (stepBlocked) {
        if (debug) {
          console.log(
            `[isTileWalkable] BLOCKED by step side approach: (${fromTile.x},${fromTile.z}) -> (${tile.x},${tile.z})`,
          );
        }
        return false;
      }
    }

    // =========================================================================
    // BUILDING FLOOR WALKABILITY
    // =========================================================================
    if (targetIsBuilding && collisionService) {
      // Check if tile is walkable on this floor
      const isWalkableInBuilding = collisionService.isTileWalkableInBuilding(
        tile.x,
        tile.z,
        playerFloor,
      );

      if (!isWalkableInBuilding) {
        if (debug) {
          const inBbox = collisionService.isTileInBuildingBoundingBox(
            tile.x,
            tile.z,
          );
          console.log(
            `[isTileWalkable] BLOCKED by building system: (${tile.x},${tile.z}) floor=${playerFloor}` +
              ` | inBbox=${inBbox || "no"} | building=${targetBuildingId}`,
          );
        }
        return false;
      }

      // Walkable building tile - skip terrain checks
      if (debug) {
        console.log(
          `[isTileWalkable] ALLOWED (building floor): (${tile.x},${tile.z}) floor=${playerFloor} building=${targetBuildingId}`,
        );
      }
      return true;
    }

    // =========================================================================
    // GROUND LAYER CHECKS (static objects, terrain)
    // =========================================================================

    // Check CollisionMatrix for static objects (trees, rocks, furnaces, etc.)
    // BLOCKS_WALK includes BLOCKED, WATER, STEEP_SLOPE - excludes OCCUPIED
    if (
      this.world.collision.hasFlags(tile.x, tile.z, CollisionMask.BLOCKS_WALK)
    ) {
      if (debug) {
        const flags = this.world.collision.getFlags(tile.x, tile.z);
        console.log(
          `[isTileWalkable] BLOCKED by CollisionMatrix flags: (${tile.x},${tile.z}) flags=${flags}`,
        );
      }
      return false;
    }

    const terrain = this.getTerrain();
    if (!terrain) {
      // Fallback: walkable if no terrain system available
      return true;
    }

    // Convert tile to world coordinates (center of tile)
    const worldPos = tileToWorld(tile);

    // Use TerrainSystem's walkability check (water, slope, lakes biome)
    const result = terrain.isPositionWalkable(worldPos.x, worldPos.z);
    if (!result.walkable && debug) {
      console.log(
        `[isTileWalkable] BLOCKED by terrain: (${tile.x},${tile.z}) reason=${result.reason || "unknown"}`,
      );
    }
    return result.walkable;
  }

  /**
   * Find the closest walkable tile to a target position using BFS.
   * Used for fishing where the target (fishing spot) is in water
   * and we need to find the nearest shore tile.
   *
   * @param targetPos - Target position in world coordinates
   * @param maxSearchRadius - Maximum tiles to search outward (default: 10)
   * @returns The closest walkable tile, or null if none found within radius
   */
  findClosestWalkableTile(
    targetPos: { x: number; z: number },
    maxSearchRadius: number = 10,
  ): TileCoord | null {
    const targetTile = worldToTile(targetPos.x, targetPos.z);

    // If target tile is already walkable, return it
    if (this.isTileWalkable(targetTile)) {
      return targetTile;
    }

    // BFS outward from target tile to find closest walkable tile
    // Search in expanding rings (distance 1, 2, 3, etc.)
    for (let radius = 1; radius <= maxSearchRadius; radius++) {
      // Check all tiles at this radius (ring around target)
      // Use a simple approach: check all tiles in a square, filter by distance
      const candidates: Array<{ tile: TileCoord; dist: number }> = [];

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          // Only check tiles at exactly this radius (Chebyshev distance)
          const chebyshev = Math.max(Math.abs(dx), Math.abs(dz));
          if (chebyshev !== radius) continue;

          const tile: TileCoord = {
            x: targetTile.x + dx,
            z: targetTile.z + dz,
          };

          if (this.isTileWalkable(tile)) {
            // Use Euclidean distance for sorting (more accurate than Chebyshev)
            const euclidean = Math.sqrt(dx * dx + dz * dz);
            candidates.push({ tile, dist: euclidean });
          }
        }
      }

      // If we found walkable tiles at this radius, return the closest one
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.dist - b.dist);
        return candidates[0].tile;
      }
    }

    // No walkable tile found within search radius
    return null;
  }

  /**
   * Get or create movement state for a player
   */
  private getOrCreateState(playerId: string): TileMovementState {
    let state = this.playerStates.get(playerId);
    if (!state) {
      // Get current position and convert to tile
      const entity = this.world.entities.get(playerId);
      const currentTile: TileCoord = entity?.position
        ? worldToTile(entity.position.x, entity.position.z)
        : { x: 0, z: 0 };

      state = createTileMovementState(currentTile);
      this.playerStates.set(playerId, state);
    }
    return state;
  }

  /**
   * Handle move request from client
   *
   * Security: All input is validated before processing.
   * Rate limiting prevents spam attacks.
   * Anti-cheat monitors for suspicious patterns.
   */
  handleMoveRequest(socket: ServerSocket, data: unknown): void {
    const playerEntity = socket.player;
    if (!playerEntity) {
      return;
    }

    // Death lock: Dead players cannot move
    const deathState = playerEntity.data?.deathState;
    if (deathState === DeathState.DYING || deathState === DeathState.DEAD) {
      return;
    }

    const playerId = playerEntity.id;

    // CRITICAL: Block movement during death state
    // Players should not be able to move while dying or dead
    const entityData = playerEntity.data as
      | { deathState?: DeathState }
      | undefined;
    if (
      entityData?.deathState === DeathState.DYING ||
      entityData?.deathState === DeathState.DEAD
    ) {
      return; // Silently reject - player is dead
    }

    // Duel lock: Check if player can move (frozen during countdown, or noMovement rule)
    const duelSystem = this.world.getSystem("duel") as {
      canMove?: (playerId: string) => boolean;
    } | null;
    if (duelSystem?.canMove && !duelSystem.canMove(playerId)) {
      return; // Silently reject - player frozen in duel
    }

    // Rate limit: prevent spam attacks
    if (!this.movementRateLimiter.check(playerId)) {
      return; // Silently drop - rate limiting is expected during fast clicking
    }

    // Get current state for validation context
    const state = this.getOrCreateState(playerId);

    // Validate input using MovementInputValidator
    const validation = this.inputValidator.validateMoveRequest(
      data,
      state.currentTile,
    );

    if (!validation.valid) {
      // Log violation to anti-cheat system
      this.antiCheat.recordViolation(
        playerId,
        "invalid_move_request",
        validation.severity ?? MovementViolationSeverity.MINOR,
        validation.error ?? "Unknown validation error",
        state.currentTile,
      );
      return;
    }

    const payload = validation.payload!;

    // DEBUG: Log received move request
    if (this._debugWalkability && payload.targetTile) {
      console.log(
        `[TileMovement] MOVE_REQUEST received:` +
          `\n  target tile: (${payload.targetTile.x}, ${payload.targetTile.z})` +
          `\n  current tile: (${state.currentTile.x}, ${state.currentTile.z})` +
          `\n  runMode: ${payload.runMode}`,
      );
    }

    // OSRS-ACCURACY: Emit click-to-move event for weak queue cancellation
    // This MUST happen before any early returns (same-tile, cancel, etc.)
    // ResourceSystem subscribes to this to cancel gathering when player clicks ground
    // In OSRS, ANY click cancels weak queue actions like gathering
    this.world.emit(EventType.MOVEMENT_CLICK_TO_MOVE, {
      playerId: playerId,
      targetPosition: {
        x: payload.targetTile.x,
        y: 0,
        z: payload.targetTile.z,
      },
    });

    // Handle cancellation
    if (payload.cancel) {
      state.path.length = 0; // Zero-allocation clear
      state.pathIndex = 0;

      // RS3-style: Clear movement flag so combat can resume
      playerEntity.data.tileMovementActive = false;

      // Broadcast idle state
      const curr = playerEntity.position;
      this.sendFn("entityModified", {
        id: playerId,
        changes: {
          p: [curr.x, curr.y, curr.z],
          v: [0, 0, 0],
          e: "idle",
        },
      });
      return;
    }

    // Check if this is just a runMode toggle (target equals current tile)
    if (tilesEqual(payload.targetTile, state.currentTile)) {
      state.isRunning = payload.runMode;
      this.sendFn("entityModified", {
        id: playerId,
        changes: { e: payload.runMode ? "run" : "walk" },
      });
      return;
    }

    // Rate limit pathfinding separately (CPU-expensive operation)
    if (!this.pathfindRateLimiter.check(playerId)) {
      return; // Too many pathfind requests
    }

    // Set player floor and building ID for floor-aware pathfinding with layer separation
    const towns = this.townSystem;
    if (towns) {
      const playerState = towns
        .getCollisionService()
        .getPlayerBuildingState(playerId as EntityID);
      this.currentPlayerFloor = playerState.currentFloor;
      this.currentPlayerBuildingId = playerState.insideBuildingId;
    }

    // === TWO-STAGE BUILDING NAVIGATION ===
    // If target is inside a building but player is outside, we need to:
    // 1. First path to the nearest door of the building
    // 2. Then continue to the final destination inside
    let path: TileCoord[] = [];
    let waypointDoor: TileCoord | null = null;
    let finalDestination: TileCoord | null = null;

    if (towns) {
      const collisionService = towns.getCollisionService();

      // Check if target is inside a building on ANY floor (not just floor 0!)
      // This is critical for detecting clicks on stairs or upper floors
      const targetInBuilding = collisionService.isTileInBuildingAnyFloor(
        payload.targetTile.x,
        payload.targetTile.z,
      );

      // Check if player is currently inside a building
      const playerInBuilding = collisionService.isTileInBuildingAnyFloor(
        state.currentTile.x,
        state.currentTile.z,
      );

      // Check if target is inside a building but player is outside (or in different building)
      const targetInsideBuilding = targetInBuilding !== null;
      const playerInSameBuilding =
        playerInBuilding !== null &&
        targetInBuilding !== null &&
        playerInBuilding.buildingId === targetInBuilding.buildingId;

      // Debug: Log what we detected
      if (this._debugWalkability) {
        console.log(
          `[TileMovement] Click analysis: target=(${payload.targetTile.x},${payload.targetTile.z}) ` +
            `inBuilding=${targetInsideBuilding} buildingId=${targetInBuilding?.buildingId || "none"} floor=${targetInBuilding?.floorIndex ?? "N/A"} | ` +
            `player=(${state.currentTile.x},${state.currentTile.z}) ` +
            `inBuilding=${playerInBuilding !== null} buildingId=${playerInBuilding?.buildingId || "none"}`,
        );
      }

      // Keep targetResult for backward compatibility with buildingId access
      const targetResult = {
        isInsideBuilding: targetInsideBuilding,
        buildingId: targetInBuilding?.buildingId ?? null,
      };

      if (targetInsideBuilding && !playerInSameBuilding) {
        // CASE 1: Player is OUTSIDE, target is INSIDE - need door-based navigation to ENTER
        const buildingId = targetResult.buildingId!;

        if (this._debugWalkability) {
          console.log(
            `[TileMovement] TWO-STAGE NAV (ENTER): Player at (${state.currentTile.x},${state.currentTile.z}) ` +
              `clicking inside ${buildingId} at (${payload.targetTile.x},${payload.targetTile.z})`,
          );
        }

        // Find nearest door to player's current position
        const doorTile = collisionService.findClosestDoorTile(
          buildingId,
          state.currentTile.x,
          state.currentTile.z,
        );

        if (doorTile) {
          // Store the final destination for stage 2 (after entering building)
          finalDestination = payload.targetTile;

          // EXTERIOR door tile is the approach tile OUTSIDE the building
          const exteriorTile = { x: doorTile.tileX, z: doorTile.tileZ };
          // INTERIOR door tile is the first tile INSIDE the building
          const interiorDoorTile = {
            x: doorTile.interiorTileX,
            z: doorTile.interiorTileZ,
          };

          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (ENTER): Found door - exterior=(${exteriorTile.x},${exteriorTile.z}) ` +
                `interior=(${interiorDoorTile.x},${interiorDoorTile.z}) direction=${doorTile.direction}`,
            );
          }

          // Stage 1: Path to the EXTERIOR door tile (approach from outside)
          // This ensures BFS doesn't try to find an alternate path around the building
          path = this.pathfinder.findPath(
            state.currentTile,
            exteriorTile,
            (tile, fromTile) => this.isTileWalkable(tile, fromTile),
          );

          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (ENTER): Stage 1 path to exterior door: ${path.length} tiles`,
            );
          }

          if (path.length > 0) {
            // Append the interior door tile to the path so player steps through
            path.push(interiorDoorTile);

            // Store pending destination for stage 2 (from interior door to final destination)
            state.pendingDestination = finalDestination;
            state.pendingBuildingId = buildingId;
            waypointDoor = interiorDoorTile; // Stage 2 starts when we reach interior

            if (this._debugWalkability) {
              console.log(
                `[TileMovement] TWO-STAGE NAV (ENTER): Path extended with interior tile, total=${path.length} tiles`,
              );
            }
          } else {
            if (this._debugWalkability) {
              console.log(
                `[TileMovement] TWO-STAGE NAV (ENTER): FAILED - no path to exterior door tile`,
              );
            }
          }
        } else {
          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (ENTER): FAILED - no door found for ${buildingId}`,
            );
          }
        }
      } else if (!targetInsideBuilding && playerInBuilding !== null) {
        // CASE 2: Player is INSIDE a building, target is OUTSIDE - need door-based navigation to EXIT
        const buildingId = playerInBuilding.buildingId;

        if (this._debugWalkability) {
          console.log(
            `[TileMovement] TWO-STAGE NAV (EXIT): Player inside ${buildingId} at (${state.currentTile.x},${state.currentTile.z}) ` +
              `clicking outside at (${payload.targetTile.x},${payload.targetTile.z})`,
          );
        }

        // Find nearest door to player's current position (for exiting)
        const doorTile = collisionService.findClosestDoorTile(
          buildingId,
          state.currentTile.x,
          state.currentTile.z,
        );

        if (doorTile) {
          // Store the final destination for stage 2 (after exiting building)
          finalDestination = payload.targetTile;

          // INTERIOR door tile is inside the building (where player is)
          const interiorDoorTile = {
            x: doorTile.interiorTileX,
            z: doorTile.interiorTileZ,
          };
          // EXTERIOR door tile is the approach tile OUTSIDE the building
          const exteriorTile = { x: doorTile.tileX, z: doorTile.tileZ };

          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (EXIT): Found door - interior=(${interiorDoorTile.x},${interiorDoorTile.z}) ` +
                `exterior=(${exteriorTile.x},${exteriorTile.z}) direction=${doorTile.direction}`,
            );
          }

          // Stage 1: Path to the INTERIOR door tile (approach from inside)
          path = this.pathfinder.findPath(
            state.currentTile,
            interiorDoorTile,
            (tile, fromTile) => this.isTileWalkable(tile, fromTile),
          );

          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (EXIT): Stage 1 path to interior door: ${path.length} tiles`,
            );
          }

          if (path.length > 0) {
            // Append the exterior door tile to the path so player steps out
            path.push(exteriorTile);

            // Store pending destination for stage 2 (from exterior door to final destination)
            state.pendingDestination = finalDestination;
            state.pendingBuildingId = null; // Exiting to ground layer
            waypointDoor = exteriorTile; // Stage 2 starts when we reach exterior

            if (this._debugWalkability) {
              console.log(
                `[TileMovement] TWO-STAGE NAV (EXIT): Path extended with exterior tile, total=${path.length} tiles`,
              );
            }
          } else {
            if (this._debugWalkability) {
              console.log(
                `[TileMovement] TWO-STAGE NAV (EXIT): FAILED - no path to interior door tile`,
              );
            }
          }
        } else {
          if (this._debugWalkability) {
            console.log(
              `[TileMovement] TWO-STAGE NAV (EXIT): FAILED - no door found for ${buildingId}`,
            );
          }
        }
      }
    }

    // If no special building navigation, use standard pathfinding
    if (path.length === 0 && !waypointDoor) {
      // Calculate BFS path from current tile to target
      // IMPORTANT: Pass fromTile to enable wall blocking checks (building walls, etc.)
      path = this.pathfinder.findPath(
        state.currentTile,
        payload.targetTile,
        (tile, fromTile) => this.isTileWalkable(tile, fromTile),
      );
    }

    // === DIAGNOSTIC: Check if path goes through any building walls or touches buildings ===
    if (path.length > 1 && towns) {
      const collisionService = towns.getCollisionService();
      let pathTouchesBuildingBbox = false;

      for (let i = 0; i < path.length; i++) {
        const tile = path[i];
        const inBbox = collisionService.isTileInBuildingBoundingBox(
          tile.x,
          tile.z,
        );
        const inFootprint = collisionService.isTileInBuildingFootprint(
          tile.x,
          tile.z,
        );

        if (inBbox && !pathTouchesBuildingBbox) {
          pathTouchesBuildingBbox = true;
          if (this._debugWalkability) {
            console.log(
              `[TileMovement] PATH DIAGNOSTIC: Path step ${i} at (${tile.x},${tile.z}) is in building bbox=${inBbox}` +
                `\n  In walkable footprint: ${inFootprint ?? "NO"}` +
                `\n  This means: ${inFootprint ? "tile is a walkable floor tile" : "tile is inside building but NOT a registered walkable tile"}`,
            );
          }
        }

        // Check wall blocking for consecutive tiles
        if (i < path.length - 1) {
          const from = path[i];
          const to = path[i + 1];
          const wallBlocked = towns.isBuildingWallBlocked(
            from.x,
            from.z,
            to.x,
            to.z,
            this.currentPlayerFloor,
          );
          if (wallBlocked) {
            console.error(
              `[TileMovement] BUG: Path goes through wall! Step ${i}: (${from.x},${from.z}) -> (${to.x},${to.z})` +
                `\n  This should have been blocked by pathfinder!`,
            );
            const fromInfo = collisionService.queryCollision(
              from.x,
              from.z,
              this.currentPlayerFloor,
            );
            const toInfo = collisionService.queryCollision(
              to.x,
              to.z,
              this.currentPlayerFloor,
            );
            console.error(
              `  From tile: inside=${fromInfo.isInsideBuilding}, walls=${JSON.stringify(fromInfo.wallBlocking)}`,
            );
            console.error(
              `  To tile: inside=${toInfo.isInsideBuilding}, walls=${JSON.stringify(toInfo.wallBlocking)}`,
            );
            // Don't execute this invalid path - clear it
            path.length = 0;
            break;
          }
        }
      }
    }

    // === DIAGNOSTIC: Log once per session to confirm building collision status ===
    if (!this._hasLoggedBuildingStatus) {
      this._hasLoggedBuildingStatus = true;
      const towns = this.townSystem;
      const buildingCount =
        towns?.getCollisionService().getBuildingCount() ?? 0;
      console.log(`[TileMovement] ====== BUILDING COLLISION STATUS ======`);
      console.log(`[TileMovement] TownSystem available: ${!!towns}`);
      console.log(`[TileMovement] Buildings registered: ${buildingCount}`);
      if (buildingCount > 0) {
        const buildings = towns!.getCollisionService().getAllBuildings();
        for (const b of buildings.slice(0, 2)) {
          // Log first 2 buildings with detailed info
          const floor0 = b.floors[0];
          const tiles = floor0?.walkableTiles.size ?? 0;
          const wallSegments = floor0?.wallSegments.length ?? 0;
          const doors =
            floor0?.wallSegments.filter(
              (w) => w.hasOpening && w.openingType === "door",
            ).length ?? 0;
          console.log(
            `[TileMovement]   - ${b.buildingId}: ${tiles} tiles, ${wallSegments} wall segments (${doors} doors)`,
          );
          console.log(
            `[TileMovement]     Position: (${b.worldPosition.x.toFixed(0)}, ${b.worldPosition.z.toFixed(0)})`,
          );
          console.log(
            `[TileMovement]     Bbox: (${b.boundingBox.minTileX},${b.boundingBox.minTileZ}) → (${b.boundingBox.maxTileX},${b.boundingBox.maxTileZ})`,
          );
          // Show a sample of walkable tiles to help debug coordinate system
          const sampleTiles = Array.from(floor0?.walkableTiles ?? []).slice(
            0,
            15,
          );
          console.log(
            `[TileMovement]     Sample tiles: ${sampleTiles.join(", ")}`,
          );
        }
      }
      console.log(`[TileMovement] =====================================`);
    }

    // === DIAGNOSTIC: When path is empty, log detailed debug info ===
    if (path.length === 0) {
      const towns = this.townSystem;
      const collisionService = towns?.getCollisionService();

      // Check if we're near a building
      const targetInBuilding = collisionService?.isTileInBuildingAnyFloor(
        payload.targetTile.x,
        payload.targetTile.z,
      );
      const targetInBbox = collisionService?.isTileInBuildingBoundingBox(
        payload.targetTile.x,
        payload.targetTile.z,
      );

      if (targetInBuilding || targetInBbox) {
        // Player clicked inside/near a building but no path found - this is a problem!
        console.error(
          `[TileMovement] NAVIGATION FAILURE: Cannot path to building tile!\n` +
            `  Player at: (${state.currentTile.x}, ${state.currentTile.z})\n` +
            `  Target at: (${payload.targetTile.x}, ${payload.targetTile.z})\n` +
            `  Target in building: ${targetInBuilding ? `Yes (${targetInBuilding.buildingId} floor ${targetInBuilding.floorIndex})` : "No"}\n` +
            `  Target in bbox: ${targetInBbox ?? "No"}\n` +
            `  Buildings registered: ${collisionService?.getBuildingCount() ?? 0}`,
        );

        // Check if there are any doors we could path to
        if (targetInBuilding) {
          const doorTile = collisionService?.findClosestDoorTile(
            targetInBuilding.buildingId,
            state.currentTile.x,
            state.currentTile.z,
          );
          if (doorTile) {
            console.error(
              `  Closest door: exterior=(${doorTile.tileX}, ${doorTile.tileZ}) interior=(${doorTile.interiorTileX}, ${doorTile.interiorTileZ})\n` +
                `  Door direction: ${doorTile.direction}`,
            );

            // Check if exterior door tile is walkable
            const exteriorWalkable = this.isTileWalkable(
              { x: doorTile.tileX, z: doorTile.tileZ },
              state.currentTile,
            );
            console.error(`  Exterior door walkable: ${exteriorWalkable}`);

            // Try pathfinding just to the door
            const doorPath = this.pathfinder.findPath(
              state.currentTile,
              { x: doorTile.tileX, z: doorTile.tileZ },
              (tile, fromTile) => this.isTileWalkable(tile, fromTile),
            );
            console.error(
              `  Path to door: ${doorPath.length > 0 ? `${doorPath.length} tiles` : "NO PATH FOUND"}`,
            );
          } else {
            console.error(
              `  NO DOORS FOUND for building ${targetInBuilding.buildingId}!`,
            );
          }
        }
      }
    }

    // Store path and update state
    state.path = path;
    state.pathIndex = 0;
    state.isRunning = payload.runMode;
    // Increment movement sequence for packet ordering
    // Client uses this to ignore stale packets from previous movements
    state.moveSeq = (state.moveSeq || 0) + 1;

    // Set movement flag for tracking active tile movement
    if (path.length > 0) {
      playerEntity.data.tileMovementActive = true;

      // OSRS-accurate: Clicking ground cancels your attack
      // Player is walking away - they're no longer attacking their target
      // The mob continues chasing them, and auto-retaliate can trigger if hit
      this.world.emit(EventType.COMBAT_PLAYER_DISENGAGE, {
        playerId: playerId,
      });

      // Cancel any pending attack - player chose a different destination
      // This handles the case where player was walking to a mob but changed their mind
      this.world.emit(EventType.PENDING_ATTACK_CANCEL, {
        playerId: playerId,
      });
    }

    // Immediately rotate player toward destination and send first tile update
    if (path.length > 0) {
      const nextTile = path[0];
      const nextWorld = tileToWorld(nextTile);
      const curr = playerEntity.position;
      const dx = nextWorld.x - curr.x;
      const dz = nextWorld.z - curr.z;

      // Calculate rotation to face movement direction using stable atan2 method
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        // VRM faces -Z after factory rotation. Rotating -Z by yaw θ around Y gives:
        // (-sin(θ), 0, -cos(θ)). To face direction (dx, dz), solve:
        // -sin(θ) = dx, -cos(θ) = dz → θ = atan2(-dx, -dz)
        const yaw = Math.atan2(-dx, -dz);
        this._tempQuat.setFromAxisAngle(this._up, yaw);

        if (playerEntity.node) {
          playerEntity.node.quaternion.copy(this._tempQuat);
        }
        playerEntity.data.quaternion = [
          this._tempQuat.x,
          this._tempQuat.y,
          this._tempQuat.z,
          this._tempQuat.w,
        ];
      }

      // Broadcast movement started with path
      // Server sends COMPLETE authoritative path - client follows exactly, no recalculation
      // startTile: where server knows player IS (client uses this, not its visual position)
      // path: tiles to walk through (server's BFS result)
      // destinationTile: final target (for verification)
      // moveSeq: packet ordering to ignore stale packets
      // emote: bundled animation (OSRS-style, no separate packet)

      // Zero-allocation: copy path to pre-allocated network buffer
      this._networkPathBuffer.length = path.length;
      for (let i = 0; i < path.length; i++) {
        if (!this._networkPathBuffer[i]) {
          this._networkPathBuffer[i] = { x: 0, z: 0 };
        }
        this._networkPathBuffer[i].x = path[i].x;
        this._networkPathBuffer[i].z = path[i].z;
      }

      this.sendFn("tileMovementStart", {
        id: playerId,
        startTile: { x: state.currentTile.x, z: state.currentTile.z },
        path: this._networkPathBuffer,
        running: state.isRunning,
        destinationTile: { x: payload.targetTile.x, z: payload.targetTile.z },
        moveSeq: state.moveSeq,
        emote: state.isRunning ? "run" : "walk",
      });
    } else {
      // No path found or already at destination
      console.warn(
        `[TileMovement] ⚠️ No path found from (${state.currentTile.x},${state.currentTile.z}) to (${payload.targetTile.x},${payload.targetTile.z})`,
      );
    }
  }

  /**
   * Handle legacy input packet (routes to move request)
   *
   * Security: Basic type validation before routing to validated handler.
   */
  handleInput(socket: ServerSocket, data: unknown): void {
    // Type guard: must be non-null object
    if (data === null || typeof data !== "object") {
      return;
    }

    const payload = data as Record<string, unknown>;

    // Route click events to validated move request handler
    if (payload.type === "click" && Array.isArray(payload.target)) {
      this.handleMoveRequest(socket, {
        target: payload.target,
        runMode: typeof payload.runMode === "boolean" ? payload.runMode : false,
      });
    }
  }

  /**
   * Called every server tick (600ms) - advance all players along their paths
   */
  onTick(tickNumber: number): void {
    // OSRS-ACCURATE: Capture tick-start positions for ALL players FIRST
    // This happens BEFORE any movement, so FollowManager can see where
    // players were at the START of this tick (creating 1-tick delay effect)
    this.tickStartTiles.clear();
    for (const [playerId, state] of this.playerStates) {
      this.tickStartTiles.set(playerId, { ...state.currentTile });
    }

    // Initialize previousTile for newly spawned players only
    // Movement processing will update it to "last stepped off" tile
    for (const [_playerId, state] of this.playerStates) {
      if (state.previousTile === null) {
        state.previousTile = { ...state.currentTile };
      }
    }

    // Decay anti-cheat scores every 100 ticks (~60 seconds)
    // This rewards good behavior over time
    if (tickNumber % 100 === 0) {
      this.antiCheat.decayScores();
    }

    const terrain = this.getTerrain();

    for (const [playerId, state] of this.playerStates) {
      // Skip if no path or at end
      if (state.path.length === 0 || state.pathIndex >= state.path.length) {
        continue;
      }

      const entity = this.world.entities.get(playerId);
      if (!entity) {
        this.playerStates.delete(playerId);
        continue;
      }

      // Store previous position for rotation calculation (zero allocation)
      this._prevTile.x = state.currentTile.x;
      this._prevTile.z = state.currentTile.z;

      // Move 1 tile (walk) or 2 tiles (run) per tick
      const tilesToMove = state.isRunning
        ? TILES_PER_TICK_RUN
        : TILES_PER_TICK_WALK;

      for (let i = 0; i < tilesToMove; i++) {
        if (state.pathIndex >= state.path.length) break;

        // OSRS-ACCURATE: Capture the tile we're stepping OFF of
        // This ensures previousTile is always 1 tile behind currentTile
        // Used by FollowManager for 1-tile trailing effect
        state.previousTile = { ...state.currentTile };

        const nextTile = state.path[state.pathIndex];
        // Copy values instead of spread (zero allocation)
        state.currentTile.x = nextTile.x;
        state.currentTile.z = nextTile.z;
        state.pathIndex++;
      }

      // === TWO-STAGE BUILDING NAVIGATION: Check if we reached the door ===
      // If path is complete and there's a pending destination, continue to it
      // pendingBuildingId can be:
      //   - a building ID (entering building)
      //   - null (exiting to ground)
      //   - undefined (no two-stage nav in progress)
      const hasPendingTwoStage =
        state.pathIndex >= state.path.length &&
        state.pendingDestination !== null &&
        state.pendingDestination !== undefined &&
        state.pendingBuildingId !== undefined;

      if (hasPendingTwoStage) {
        const isExiting = state.pendingBuildingId === null;
        const towns = this.townSystem;
        if (towns) {
          console.log(
            `[TileMovement] TWO-STAGE NAV: Stage 2 (${isExiting ? "EXIT" : "ENTER"}) - Reached door at (${state.currentTile.x},${state.currentTile.z}), ` +
              `pathing to (${state.pendingDestination!.x},${state.pendingDestination!.z})${isExiting ? " on ground" : ` in ${state.pendingBuildingId}`}`,
          );

          const collisionService = towns.getCollisionService();

          // CRITICAL: Update player building state FIRST with current position
          // before getting the floor index. We just stepped through the door
          // but updatePlayerBuildingState hasn't been called yet for this tick.
          // Get current world Y from entity for proper floor detection
          const worldY = entity?.position?.y ?? 0;
          collisionService.updatePlayerBuildingState(
            playerId as EntityID,
            state.currentTile.x,
            state.currentTile.z,
            worldY,
          );

          // NOW get the updated player floor and building ID
          const playerState = collisionService.getPlayerBuildingState(
            playerId as EntityID,
          );
          this.currentPlayerFloor = playerState.currentFloor;
          this.currentPlayerBuildingId = playerState.insideBuildingId;

          // Calculate new path from door to final destination
          const newPath = this.pathfinder.findPath(
            state.currentTile,
            state.pendingDestination!,
            (tile, fromTile) => this.isTileWalkable(tile, fromTile),
          );

          console.log(
            `[TileMovement] TWO-STAGE NAV: Stage 2 path length: ${newPath.length}`,
          );

          // Validate Stage 2 path doesn't go through walls
          let pathValid = true;
          if (newPath.length > 1) {
            for (let i = 0; i < newPath.length - 1; i++) {
              const from = newPath[i];
              const to = newPath[i + 1];
              const wallBlocked = collisionService.isWallBlocked(
                from.x,
                from.z,
                to.x,
                to.z,
                this.currentPlayerFloor,
              );
              if (wallBlocked) {
                console.error(
                  `[TileMovement] TWO-STAGE NAV: Stage 2 path goes through wall! Step ${i}: (${from.x},${from.z}) -> (${to.x},${to.z})`,
                );
                const fromInfo = collisionService.queryCollision(
                  from.x,
                  from.z,
                  this.currentPlayerFloor,
                );
                const toInfo = collisionService.queryCollision(
                  to.x,
                  to.z,
                  this.currentPlayerFloor,
                );
                console.error(
                  `  From tile: inside=${fromInfo.isInsideBuilding}, walls=${JSON.stringify(fromInfo.wallBlocking)}`,
                );
                console.error(
                  `  To tile: inside=${toInfo.isInsideBuilding}, walls=${JSON.stringify(toInfo.wallBlocking)}`,
                );
                pathValid = false;
                break;
              }
            }
          }

          if (newPath.length > 0 && pathValid) {
            // Continue with the second stage of navigation
            state.path = newPath;
            state.pathIndex = 0;
            state.moveSeq = (state.moveSeq || 0) + 1;

            // Broadcast continuation of movement with new path
            this._networkPathBuffer.length = newPath.length;
            for (let i = 0; i < newPath.length; i++) {
              if (!this._networkPathBuffer[i]) {
                this._networkPathBuffer[i] = { x: 0, z: 0 };
              }
              this._networkPathBuffer[i].x = newPath[i].x;
              this._networkPathBuffer[i].z = newPath[i].z;
            }

            const finalDestination = newPath[newPath.length - 1];
            this.sendFn("tileMovementStart", {
              id: playerId,
              startTile: { x: state.currentTile.x, z: state.currentTile.z },
              path: this._networkPathBuffer,
              running: state.isRunning,
              destinationTile: { x: finalDestination.x, z: finalDestination.z },
              moveSeq: state.moveSeq,
              emote: state.isRunning ? "run" : "walk",
            });
          } else {
            // Stage 2 FAILED - player stuck at door, implement graceful recovery
            // This can happen if no path found OR if path goes through walls
            const reason = !pathValid
              ? "path goes through walls"
              : "no path found";
            console.warn(
              `[TileMovement] TWO-STAGE NAV: Stage 2 failed (${reason}), player stopping at door\n` +
                `  Current tile (door): (${state.currentTile.x}, ${state.currentTile.z})\n` +
                `  Target tile: (${state.pendingDestination.x}, ${state.pendingDestination.z})\n` +
                `  Building: ${state.pendingBuildingId}\n` +
                `  Player floor: ${this.currentPlayerFloor}`,
            );

            // RECOVERY: Stop the player at the door with proper notification
            // The player successfully entered the building but couldn't reach final destination
            state.path.length = 0;
            state.pathIndex = 0;

            // Clear movement flag
            if (entity) {
              entity.data.tileMovementActive = false;
            }

            // Get world position at current door tile
            const doorWorldPos = tileToWorld(state.currentTile);

            // Get building elevation for proper Y position
            const elevationService = collisionService;
            const doorElevation = elevationService.getFloorElevation(
              state.currentTile.x,
              state.currentTile.z,
              this.currentPlayerFloor,
            );
            if (doorElevation !== null && Number.isFinite(doorElevation)) {
              doorWorldPos.y = doorElevation + 0.1;
            }

            // Send tileMovementEnd to notify client that movement is complete
            this.sendFn("tileMovementEnd", {
              id: playerId,
              tile: state.currentTile,
              worldPos: [doorWorldPos.x, doorWorldPos.y, doorWorldPos.z],
              moveSeq: state.moveSeq,
              emote: "idle",
            });

            // Update entity position
            if (entity) {
              entity.position.set(
                doorWorldPos.x,
                doorWorldPos.y,
                doorWorldPos.z,
              );
              entity.data.position = [
                doorWorldPos.x,
                doorWorldPos.y,
                doorWorldPos.z,
              ];
            }

            // Broadcast idle state
            this.sendFn("entityModified", {
              id: playerId,
              changes: {
                p: [doorWorldPos.x, doorWorldPos.y, doorWorldPos.z],
                v: [0, 0, 0],
                e: "idle",
              },
            });
          }
        }

        // Clear pending destination (either we used it or it failed)
        state.pendingDestination = null;
        state.pendingBuildingId = null;
      }

      // Track tiles moved for Agility XP (batched at 100 tiles = 50 XP)
      const tilesMoved =
        Math.abs(state.currentTile.x - this._prevTile.x) +
        Math.abs(state.currentTile.z - this._prevTile.z);
      if (tilesMoved > 0) {
        const currentTiles =
          (this.tilesTraveledForXP.get(playerId) || 0) + tilesMoved;
        if (currentTiles >= AGILITY_TILES_PER_XP_GRANT) {
          // Grant XP and preserve overflow
          const grantsEarned = Math.floor(
            currentTiles / AGILITY_TILES_PER_XP_GRANT,
          );
          const xpToGrant = grantsEarned * AGILITY_XP_PER_GRANT;
          this.tilesTraveledForXP.set(
            playerId,
            currentTiles % AGILITY_TILES_PER_XP_GRANT,
          );
          // Emit XP gain event (handled by SkillsSystem)
          this.world.emit(EventType.SKILLS_XP_GAINED, {
            playerId,
            skill: "agility",
            amount: xpToGrant,
          });
        } else {
          // Accumulate tiles silently
          this.tilesTraveledForXP.set(playerId, currentTiles);
        }
      }

      // Convert tile to world position
      const worldPos = tileToWorld(state.currentTile);

      // === ELEVATION PRIORITY ===
      // 1. Building floor elevation (if inside building)
      // 2. Terrain height (includes flat zones like duel arenas)
      let elevationSet = false;

      // Check if inside a building - use building floor elevation
      const towns = this.townSystem;
      if (towns) {
        const collisionService = towns.getCollisionService();
        const playerBuildingState = collisionService.getPlayerBuildingState(
          playerId as EntityID,
        );

        // Check if tile is a WALKABLE building floor tile (in footprint)
        // Use FOOTPRINT check (not bounding box) to ensure correct elevation transitions:
        // - Inside building (footprint) → use building floor elevation
        // - Outside building (exterior door tiles, etc.) → use terrain elevation
        // This prevents players floating in the air on exterior door approach tiles
        const buildingIdForElevation =
          collisionService.isTileInBuildingFootprint(
            state.currentTile.x,
            state.currentTile.z,
          );

        if (buildingIdForElevation) {
          // Check if on stairs - use interpolated elevation
          const stairElevation = collisionService.getStairElevation(
            worldPos.x,
            worldPos.z,
            playerBuildingState.currentFloor,
          );

          if (stairElevation !== null && Number.isFinite(stairElevation)) {
            // On stairs - use interpolated elevation
            worldPos.y = stairElevation + 0.1;
            elevationSet = true;

            if (this._debugWalkability) {
              console.log(
                `[onTick] Using stair elevation for (${state.currentTile.x},${state.currentTile.z}): ${stairElevation.toFixed(2)} + 0.1`,
              );
            }
          } else {
            // Not on stairs - use flat floor elevation
            const floorElevation = collisionService.getFloorElevation(
              state.currentTile.x,
              state.currentTile.z,
              playerBuildingState.currentFloor,
            );

            if (floorElevation !== null && Number.isFinite(floorElevation)) {
              worldPos.y = floorElevation + 0.1;
              elevationSet = true;

              if (this._debugWalkability) {
                console.log(
                  `[onTick] Using building elevation for (${state.currentTile.x},${state.currentTile.z}): ${floorElevation.toFixed(2)} + 0.1`,
                );
              }
            }
          }

          // Update player's building state for floor tracking
          collisionService.updatePlayerBuildingState(
            playerId as EntityID,
            state.currentTile.x,
            state.currentTile.z,
            worldPos.y,
          );

          // Handle stair transitions (floor changes)
          if (state.previousTile) {
            const newFloor = collisionService.handleStairTransition(
              playerId as EntityID,
              state.previousTile,
              state.currentTile,
            );
            if (newFloor !== null) {
              // Floor changed - elevation will be updated on next tick
              if (this._debugWalkability) {
                console.log(`[onTick] Stair transition to floor ${newFloor}`);
              }
            }
          }
        }
      }

      // Fallback to terrain height (includes flat zones for duel arenas)
      if (!elevationSet && terrain) {
        const height = terrain.getHeightAt(worldPos.x, worldPos.z);
        if (height !== null && Number.isFinite(height)) {
          worldPos.y = (height as number) + 0.1;
        }
      }

      // Update entity position on server
      entity.position.set(worldPos.x, worldPos.y, worldPos.z);
      entity.data.position = [worldPos.x, worldPos.y, worldPos.z];

      // Update player position in spatial registry for interest-based network filtering
      this.entityManager?.updatePlayerPosition?.(
        playerId,
        worldPos.x,
        worldPos.z,
      );

      // OSRS-ACCURATE: Mark player as having moved this tick
      // Face direction system will skip rotation update if player moved
      // @see https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/
      const faceManager = (
        this.world as {
          faceDirectionManager?: { markPlayerMoved: (id: string) => void };
        }
      ).faceDirectionManager;
      faceManager?.markPlayerMoved(playerId);

      // Calculate rotation based on movement direction (from previous to current tile)
      const prevWorld = tileToWorld(this._prevTile);
      const dx = worldPos.x - prevWorld.x;
      const dz = worldPos.z - prevWorld.z;

      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        // VRM faces -Z after factory rotation. Rotating -Z by yaw θ around Y gives:
        // (-sin(θ), 0, -cos(θ)). To face direction (dx, dz), solve:
        // -sin(θ) = dx, -cos(θ) = dz → θ = atan2(-dx, -dz)
        const yaw = Math.atan2(-dx, -dz);
        this._tempQuat.setFromAxisAngle(this._up, yaw);

        if (entity.node) {
          entity.node.quaternion.copy(this._tempQuat);
        }
        entity.data.quaternion = [
          this._tempQuat.x,
          this._tempQuat.y,
          this._tempQuat.z,
          this._tempQuat.w,
        ];
      }

      // Broadcast tile position update to clients
      // Include moveSeq so client can ignore stale packets from previous movements
      this.sendFn("entityTileUpdate", {
        id: playerId,
        tile: state.currentTile,
        worldPos: [worldPos.x, worldPos.y, worldPos.z],
        quaternion: entity.data.quaternion,
        emote: state.isRunning ? "run" : "walk",
        tickNumber,
        moveSeq: state.moveSeq,
      });

      // Check if arrived at destination
      if (state.pathIndex >= state.path.length) {
        // Get any pending arrival emote (e.g., "fishing" for gathering actions)
        // This is bundled with tileMovementEnd to prevent race conditions
        const arrivalEmote = this.arrivalEmotes.get(playerId) || "idle";
        this.arrivalEmotes.delete(playerId);

        // Broadcast movement end with emote (atomic delivery)
        // Include moveSeq so client can ignore stale end packets
        // Note: Rotation is handled by FaceDirectionManager at end of tick
        this.sendFn("tileMovementEnd", {
          id: playerId,
          tile: state.currentTile,
          worldPos: [worldPos.x, worldPos.y, worldPos.z],
          moveSeq: state.moveSeq,
          emote: arrivalEmote,
        });

        // Clear path
        state.path.length = 0; // Zero-allocation clear
        state.pathIndex = 0;

        // RS3-style: Clear movement flag so combat can resume
        entity.data.tileMovementActive = false;

        // Broadcast entity state with arrival emote
        const entityModifiedChanges: Record<string, unknown> = {
          p: [worldPos.x, worldPos.y, worldPos.z],
          v: [0, 0, 0],
          e: arrivalEmote,
        };
        this.sendFn("entityModified", {
          id: playerId,
          changes: entityModifiedChanges,
        });
      }
    }
  }

  /**
   * Process movement for a specific player on this tick
   *
   * OSRS-ACCURATE: Called by GameTickProcessor during player phase
   * This processes just one player's movement instead of all players.
   *
   * Zero-allocation: Uses pre-allocated tile buffers.
   *
   * @param playerId - The player to process movement for
   * @param tickNumber - Current tick number
   */
  processPlayerTick(playerId: string, tickNumber: number): void {
    const state = this.playerStates.get(playerId);
    if (!state) return;

    // Skip if no path or at end
    if (state.path.length === 0 || state.pathIndex >= state.path.length) {
      return;
    }

    const entity = this.world.entities.get(playerId);
    if (!entity) {
      this.playerStates.delete(playerId);
      return;
    }

    const terrain = this.getTerrain();

    // Store previous position for rotation calculation (zero allocation)
    this._prevTile.x = state.currentTile.x;
    this._prevTile.z = state.currentTile.z;

    // Move 1 tile (walk) or 2 tiles (run) per tick
    const tilesToMove = state.isRunning
      ? TILES_PER_TICK_RUN
      : TILES_PER_TICK_WALK;

    for (let i = 0; i < tilesToMove; i++) {
      if (state.pathIndex >= state.path.length) break;

      // OSRS-ACCURATE: Capture the tile we're stepping OFF of
      // This ensures previousTile is always 1 tile behind currentTile
      // Used by FollowManager for 1-tile trailing effect
      state.previousTile = { ...state.currentTile };

      const nextTile = state.path[state.pathIndex];
      // Copy values instead of spread (zero allocation)
      state.currentTile.x = nextTile.x;
      state.currentTile.z = nextTile.z;
      state.pathIndex++;
    }

    // Convert tile to world position
    const worldPos = tileToWorld(state.currentTile);

    // Get height - prioritize building floor elevation over terrain
    const towns = this.townSystem;
    let usedBuildingElevation = false;

    if (towns) {
      const collisionService = towns.getCollisionService();
      const entityId = playerId as EntityID;

      // First, get current player state to know which floor they're on
      const playerState = collisionService.getPlayerBuildingState(entityId);

      // Check if this tile is a WALKABLE building floor tile (in footprint)
      // Use FOOTPRINT check (not bounding box) to ensure correct elevation transitions:
      // - Inside building (footprint) → use building floor elevation
      // - Outside building (exterior door tiles, etc.) → use terrain elevation
      // This prevents players floating in the air on exterior door approach tiles
      const buildingIdForElevation = collisionService.isTileInBuildingFootprint(
        state.currentTile.x,
        state.currentTile.z,
      );

      // DIAGNOSTIC: Log elevation decision once per tile change
      if (
        this._debugWalkability &&
        (state.previousTile?.x !== state.currentTile.x ||
          state.previousTile?.z !== state.currentTile.z)
      ) {
        const inBbox = collisionService.isTileInBuildingBoundingBox(
          state.currentTile.x,
          state.currentTile.z,
        );
        const terrainH = terrain?.getHeightAt(worldPos.x, worldPos.z);
        console.log(
          `[ELEVATION] Tile (${state.currentTile.x},${state.currentTile.z}): ` +
            `footprint=${buildingIdForElevation ?? "none"} bbox=${inBbox ?? "none"} terrain=${terrainH?.toFixed(2) ?? "null"}`,
        );
      }

      if (buildingIdForElevation) {
        // Check if on stairs - use interpolated elevation
        const stairElevation = collisionService.getStairElevation(
          worldPos.x,
          worldPos.z,
          playerState.currentFloor,
        );

        if (stairElevation !== null && Number.isFinite(stairElevation)) {
          // On stairs - use interpolated elevation
          worldPos.y = stairElevation + 0.1;
          usedBuildingElevation = true;

          if (this._debugWalkability) {
            console.log(
              `[processPlayerTick] Using stair elevation for (${state.currentTile.x},${state.currentTile.z}): ${stairElevation.toFixed(2)} + 0.1`,
            );
          }
        } else {
          // Not on stairs - use flat floor elevation
          const floorElevation = collisionService.getFloorElevation(
            state.currentTile.x,
            state.currentTile.z,
            playerState.currentFloor,
          );

          if (floorElevation !== null && Number.isFinite(floorElevation)) {
            worldPos.y = floorElevation + 0.1; // Small offset above floor
            usedBuildingElevation = true;

            if (this._debugWalkability) {
              console.log(
                `[processPlayerTick] Using building elevation for (${state.currentTile.x},${state.currentTile.z}): ${floorElevation.toFixed(2)} + 0.1`,
              );
            }
          }
        }
      }

      // Update player building/floor state for multi-level collision tracking
      collisionService.updatePlayerBuildingState(
        entityId,
        state.currentTile.x,
        state.currentTile.z,
        worldPos.y,
      );

      // Handle explicit stair transitions for precise floor changes
      // This is called when player steps onto a stair tile
      if (state.previousTile) {
        const newFloor = collisionService.handleStairTransition(
          entityId,
          state.previousTile,
          state.currentTile,
        );

        if (newFloor !== null) {
          // Floor changed - elevation will be updated on next tick
          if (this._debugWalkability) {
            console.log(
              `[processPlayerTick] Stair transition to floor ${newFloor}`,
            );
          }
        }
      }

      // Cache current floor and building ID for subsequent walkability checks
      const updatedState = collisionService.getPlayerBuildingState(entityId);
      this.currentPlayerFloor = updatedState.currentFloor;
      this.currentPlayerBuildingId = updatedState.insideBuildingId;
    }

    // Fall back to terrain height if not using building elevation
    if (!usedBuildingElevation && terrain) {
      const height = terrain.getHeightAt(worldPos.x, worldPos.z);
      if (height !== null && Number.isFinite(height)) {
        worldPos.y = (height as number) + 0.1;
      }
    }

    // Update entity position on server
    entity.position.set(worldPos.x, worldPos.y, worldPos.z);
    entity.data.position = [worldPos.x, worldPos.y, worldPos.z];

    // OSRS-ACCURATE: Mark player as having moved this tick
    // Face direction system will skip rotation update if player moved
    const faceManager = (
      this.world as {
        faceDirectionManager?: { markPlayerMoved: (id: string) => void };
      }
    ).faceDirectionManager;
    faceManager?.markPlayerMoved(playerId);

    // Calculate rotation based on movement direction (zero allocation - use pre-allocated tile)
    const prevWorld = tileToWorld(this._prevTile);
    const dx = worldPos.x - prevWorld.x;
    const dz = worldPos.z - prevWorld.z;

    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const yaw = Math.atan2(-dx, -dz);
      this._tempQuat.setFromAxisAngle(this._up, yaw);

      if (entity.node) {
        entity.node.quaternion.copy(this._tempQuat);
      }
      entity.data.quaternion = [
        this._tempQuat.x,
        this._tempQuat.y,
        this._tempQuat.z,
        this._tempQuat.w,
      ];
    }

    // Broadcast tile position update to clients
    this.sendFn("entityTileUpdate", {
      id: playerId,
      tile: state.currentTile,
      worldPos: [worldPos.x, worldPos.y, worldPos.z],
      quaternion: entity.data.quaternion,
      emote: state.isRunning ? "run" : "walk",
      tickNumber,
      moveSeq: state.moveSeq,
    });

    // Check if arrived at destination
    if (state.pathIndex >= state.path.length) {
      // Get any pending arrival emote (e.g., "fishing" for gathering actions)
      // This is bundled with tileMovementEnd to prevent race conditions
      const arrivalEmote = this.arrivalEmotes.get(playerId) || "idle";
      this.arrivalEmotes.delete(playerId);

      // Broadcast movement end with emote (atomic delivery)
      // Note: Rotation is handled by FaceDirectionManager at end of tick
      this.sendFn("tileMovementEnd", {
        id: playerId,
        tile: state.currentTile,
        worldPos: [worldPos.x, worldPos.y, worldPos.z],
        moveSeq: state.moveSeq,
        emote: arrivalEmote,
      });

      // Clear path
      state.path.length = 0; // Zero-allocation clear
      state.pathIndex = 0;

      // RS3-style: Clear movement flag so combat can resume
      entity.data.tileMovementActive = false;

      // Broadcast entity state with arrival emote
      const entityModifiedChanges: Record<string, unknown> = {
        p: [worldPos.x, worldPos.y, worldPos.z],
        v: [0, 0, 0],
        e: arrivalEmote,
      };
      this.sendFn("entityModified", {
        id: playerId,
        changes: entityModifiedChanges,
      });
    }
  }

  /**
   * Legacy frame-based update (for compatibility during transition)
   * This should be removed once tile movement is fully working
   */
  update(_dt: number): void {
    // No-op - movement is now tick-based
  }

  /**
   * Cleanup state for a player
   */
  cleanup(playerId: string): void {
    this.playerStates.delete(playerId);
    this.arrivalEmotes.delete(playerId);
    this.tilesTraveledForXP.delete(playerId);
    this.antiCheat.cleanup(playerId);
    this.movementRateLimiter.reset(playerId);
    this.pathfindRateLimiter.reset(playerId);
  }

  /**
   * Reset agility XP progress for a player (called on death)
   * Tiles accumulated toward the next XP grant are lost as a death penalty
   */
  resetAgilityProgress(playerId: string): void {
    this.tilesTraveledForXP.set(playerId, 0);
  }

  /**
   * Set an emote to be used when the player arrives at their destination.
   * This emote is included in the tileMovementEnd packet, ensuring atomic delivery
   * with the arrival notification. Prevents race conditions where the client
   * sets "idle" before receiving a separate emote packet.
   *
   * @param playerId - The player ID
   * @param emote - The emote to use on arrival (e.g., "fishing", "chopping")
   */
  setArrivalEmote(playerId: string, emote: string): void {
    this.arrivalEmotes.set(playerId, emote);
  }

  /**
   * Clear any pending arrival emote for a player.
   * Called when gathering is cancelled or player moves to a different destination.
   */
  clearArrivalEmote(playerId: string): void {
    this.arrivalEmotes.delete(playerId);
  }

  /**
   * Sync player position after respawn or teleport
   *
   * CRITICAL: When a player respawns at spawn point, the TileMovementManager's
   * internal state still has their old tile position. This method resets the
   * internal state to match the actual world position, preventing path calculation
   * from the wrong starting tile.
   */
  syncPlayerPosition(
    playerId: string,
    position: { x: number; y: number; z: number },
  ): void {
    // Validate inputs
    if (!playerId || typeof playerId !== "string") {
      throw new Error(
        `[TileMovement] syncPlayerPosition: invalid playerId: ${playerId}`,
      );
    }
    if (
      !position ||
      typeof position.x !== "number" ||
      typeof position.z !== "number"
    ) {
      throw new Error(
        `[TileMovement] syncPlayerPosition: invalid position for ${playerId}: ${JSON.stringify(position)}`,
      );
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      throw new Error(
        `[TileMovement] syncPlayerPosition: non-finite position for ${playerId}: (${position.x}, ${position.z})`,
      );
    }

    const newTile = worldToTile(position.x, position.z);

    // Validate resulting tile
    if (!Number.isFinite(newTile.x) || !Number.isFinite(newTile.z)) {
      throw new Error(
        `[TileMovement] syncPlayerPosition: worldToTile returned non-finite tile for ${playerId}: (${newTile.x}, ${newTile.z})`,
      );
    }

    // Get existing state or create new one
    let state = this.playerStates.get(playerId);

    if (state) {
      // Clear any pending movement and update tile
      state.currentTile = newTile;
      state.path.length = 0; // Zero-allocation clear
      state.pathIndex = 0;
      state.moveSeq = (state.moveSeq || 0) + 1; // Increment to invalidate stale client packets

      // RS3-style: Clear movement flag so combat can resume
      const entity = this.world.entities.get(playerId);
      if (entity?.data) {
        entity.data.tileMovementActive = false;
      }

      if (this._debugWalkability) {
        console.log(
          `[TileMovement] Synced ${playerId} position to tile (${newTile.x},${newTile.z}) after respawn/teleport`,
        );
      }
    } else {
      // Create fresh state at new position
      state = createTileMovementState(newTile);
      this.playerStates.set(playerId, state);
      if (this._debugWalkability) {
        console.log(
          `[TileMovement] Created new state for ${playerId} at tile (${newTile.x},${newTile.z})`,
        );
      }
    }

    // Update spatial registry with new position (for interest-based filtering)
    this.entityManager?.updatePlayerPosition?.(
      playerId,
      position.x,
      position.z,
    );
  }

  /**
   * Get current tile for a player
   */
  getCurrentTile(playerId: string): TileCoord | null {
    const state = this.playerStates.get(playerId);
    return state ? state.currentTile : null;
  }

  /**
   * Get the previous tile for a player (where they were at START of tick)
   *
   * OSRS-ACCURATE: Used by FollowManager for follow mechanic.
   * Followers path to target's PREVIOUS tile, creating the
   * characteristic 1-tick trailing effect.
   *
   * Edge cases:
   * - If no previous tile (just spawned/teleported): use tile WEST of current
   * - This matches OSRS behavior per private server community research
   *
   * @see https://rune-server.org/threads/help-with-player-dancing-spinning-when-following-each-other.706121/
   */
  getPreviousTile(playerId: string): TileCoord {
    const state = this.playerStates.get(playerId);

    // Use captured previous tile if available
    if (state?.previousTile) {
      return state.previousTile;
    }

    // Fallback: If no previous tile (just spawned/teleported), use tile WEST of current
    // This matches OSRS behavior per private server research
    if (state) {
      return {
        x: state.currentTile.x - 1,
        z: state.currentTile.z,
      };
    }

    // No state at all - try to get from entity position
    const entity = this.world.entities.get(playerId);
    if (entity?.position) {
      const currentTile = worldToTile(entity.position.x, entity.position.z);
      return {
        x: currentTile.x - 1,
        z: currentTile.z,
      };
    }

    // Ultimate fallback (should never happen)
    return { x: 0, z: 0 };
  }

  /**
   * Get the tick-start tile for a player
   *
   * OSRS-ACCURATE: Returns where the player was at the VERY START of the
   * current tick, BEFORE any movement was processed. This is different from
   * previousTile (which is the last tile stepped off during movement).
   *
   * Used by FollowManager to create the authentic 1-tick delay effect:
   * - Tick N: Target is at tile A (tick-start), then moves to tile B
   * - Tick N: Follower sees target's tick-start position (A)
   * - Tick N+1: Follower moves toward A, while target is now at B
   *
   * This creates the characteristic "always one step behind" feel.
   */
  getTickStartTile(playerId: string): TileCoord | null {
    return this.tickStartTiles.get(playerId) ?? null;
  }

  /**
   * Check if a player is currently moving
   */
  isMoving(playerId: string): boolean {
    const state = this.playerStates.get(playerId);
    return state
      ? state.path.length > 0 && state.pathIndex < state.path.length
      : false;
  }

  /**
   * Check if a player has run mode enabled
   * Used by resource/combat handlers to determine movement speed
   */
  getIsRunning(playerId: string): boolean {
    const state = this.playerStates.get(playerId);
    return state?.isRunning ?? false;
  }

  /**
   * Server-initiated movement toward a target position
   * Used for combat follow when target moves out of range
   *
   * OSRS-style pathfinding (from wiki):
   * - When clicking on an NPC, the requested tiles are all tiles within attack range
   * - BFS finds the CLOSEST valid tile among those options
   * - For melee range 1: only cardinal tiles (N/S/E/W) are valid destinations
   * - For ranged/magic: Chebyshev distance to any tile within range
   * - Pathfinding recalculates every tick until target tile is found
   *
   * @param playerId - The player to move
   * @param targetPosition - Target position in world coordinates
   * @param running - Whether to run (default: true for combat following)
   * @param attackRange - Weapon's attack range (1 = standard melee, 2 = halberd, 10 = ranged/magic, 0 = non-combat)
   * @param attackType - Attack type (MELEE, RANGED, MAGIC) - affects positioning logic
   *
   * @see https://oldschool.runescape.wiki/w/Pathfinding
   */
  movePlayerToward(
    playerId: string,
    targetPosition: { x: number; y: number; z: number },
    running: boolean = true,
    attackRange: number = 0, // 0 = non-combat, 1+ = combat range
    attackType: AttackType = AttackType.MELEE,
  ): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) {
      return;
    }

    // Death lock: Dead players cannot move
    const deathState = entity.data?.deathState;
    if (deathState === DeathState.DYING || deathState === DeathState.DEAD) {
      return;
    }

    const state = this.getOrCreateState(playerId);

    // CRITICAL: Sync state.currentTile with entity's actual position
    // The state might be stale if the player has been moving (zero allocation)
    worldToTileInto(
      entity.position.x,
      entity.position.z,
      this._actualEntityTile,
    );
    if (!tilesEqual(state.currentTile, this._actualEntityTile)) {
      state.currentTile.x = this._actualEntityTile.x;
      state.currentTile.z = this._actualEntityTile.z;
    }

    // Convert target to tile (zero allocation)
    worldToTileInto(targetPosition.x, targetPosition.z, this._targetTile);

    // Determine destination tile based on combat or non-combat movement
    let destinationTile: TileCoord;

    if (attackRange > 0) {
      // COMBAT MOVEMENT: Use appropriate positioning based on attack type
      if (attackType === AttackType.RANGED || attackType === AttackType.MAGIC) {
        // RANGED/MAGIC: Use Chebyshev distance - stop when within attack range
        if (
          tilesWithinRange(state.currentTile, this._targetTile, attackRange)
        ) {
          return; // Already in position, no movement needed
        }

        // Find best tile within attack range
        const combatTile = getBestCombatRangeTile(
          this._targetTile,
          state.currentTile,
          attackRange,
          (tile) => this.isTileWalkable(tile),
        );

        if (!combatTile) {
          return; // No valid combat position found
        }

        destinationTile = combatTile;
      } else {
        // MELEE: Use OSRS-accurate melee positioning (cardinal-only for range 1)
        if (
          tilesWithinMeleeRange(
            state.currentTile,
            this._targetTile,
            attackRange,
          )
        ) {
          return; // Already in position, no movement needed
        }

        // Find best melee tile (cardinal-only for range 1, diagonal allowed for range 2+)
        const meleeTile = getBestMeleeTile(
          this._targetTile,
          state.currentTile,
          attackRange,
          (tile) => this.isTileWalkable(tile),
        );

        if (!meleeTile) {
          return; // No valid melee position found
        }

        destinationTile = meleeTile;
      }
    } else {
      // NON-COMBAT MOVEMENT: Go directly to target tile
      if (tilesEqual(this._targetTile, state.currentTile)) {
        return; // Already at target
      }
      destinationTile = this._targetTile;
    }

    // Set player floor and building ID for floor-aware pathfinding with layer separation
    const townsForPath = this.townSystem;
    if (townsForPath) {
      const playerState = townsForPath
        .getCollisionService()
        .getPlayerBuildingState(playerId as EntityID);
      this.currentPlayerFloor = playerState.currentFloor;
      this.currentPlayerBuildingId = playerState.insideBuildingId;
    }

    // Calculate BFS path to the destination tile (NOT to target, then truncate!)
    // IMPORTANT: Pass fromTile to enable wall blocking checks (building walls, etc.)
    const path = this.pathfinder.findPath(
      state.currentTile,
      destinationTile,
      (tile, fromTile) => this.isTileWalkable(tile, fromTile),
    );

    if (path.length === 0) {
      return; // No path found
    }

    // Update state
    state.path = path;
    state.pathIndex = 0;
    state.isRunning = running;
    state.moveSeq = (state.moveSeq || 0) + 1;

    // RS3-style: Set movement flag to suppress combat while moving
    entity.data.tileMovementActive = true;

    // Broadcast movement start
    const nextTile = path[0];
    const nextWorld = tileToWorld(nextTile);
    const curr = entity.position;
    const dx = nextWorld.x - curr.x;
    const dz = nextWorld.z - curr.z;

    // Calculate rotation to face movement direction
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const yaw = Math.atan2(-dx, -dz);
      this._tempQuat.setFromAxisAngle(this._up, yaw);

      if ((entity as { node?: THREE.Object3D }).node) {
        (entity as { node: THREE.Object3D }).node.quaternion.copy(
          this._tempQuat,
        );
      }
      (entity as { data: { quaternion?: number[] } }).data.quaternion = [
        this._tempQuat.x,
        this._tempQuat.y,
        this._tempQuat.z,
        this._tempQuat.w,
      ];
    }

    // Send movement start packet
    const actualDestination = path[path.length - 1];

    // Zero-allocation: copy path to pre-allocated network buffer
    this._networkPathBuffer.length = path.length;
    for (let i = 0; i < path.length; i++) {
      if (!this._networkPathBuffer[i]) {
        this._networkPathBuffer[i] = { x: 0, z: 0 };
      }
      this._networkPathBuffer[i].x = path[i].x;
      this._networkPathBuffer[i].z = path[i].z;
    }

    this.sendFn("tileMovementStart", {
      id: playerId,
      startTile: { x: state.currentTile.x, z: state.currentTile.z },
      path: this._networkPathBuffer,
      running: state.isRunning,
      destinationTile: { x: actualDestination.x, z: actualDestination.z },
      moveSeq: state.moveSeq,
      emote: state.isRunning ? "run" : "walk",
    });
  }
}
