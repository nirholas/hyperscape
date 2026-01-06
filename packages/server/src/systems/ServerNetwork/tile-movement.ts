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
  World,
  EventType,
  // Tile movement utilities
  TILES_PER_TICK_WALK,
  TILES_PER_TICK_RUN,
  worldToTile,
  worldToTileInto,
  tileToWorld,
  tilesEqual,
  tilesWithinMeleeRange,
  getBestMeleeTile,
  createTileMovementState,
  BFSPathfinder,
} from "@hyperscape/shared";
import type { TileCoord, TileMovementState } from "@hyperscape/shared";

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

/**
 * Tile-based movement manager for RuneScape-style movement
 */
export class TileMovementManager {
  private playerStates: Map<string, TileMovementState> = new Map();
  private pathfinder: BFSPathfinder;
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

  /**
   * Check if a tile is walkable based on terrain constraints
   * Uses TerrainSystem to check water level, slope, and biome rules
   */
  private isTileWalkable(tile: TileCoord): boolean {
    const terrain = this.getTerrain();
    if (!terrain) {
      // Fallback: walkable if no terrain system available
      return true;
    }

    // Convert tile to world coordinates (center of tile)
    const worldPos = tileToWorld(tile);

    // Use TerrainSystem's walkability check (water, slope, lakes biome)
    const result = terrain.isPositionWalkable(worldPos.x, worldPos.z);
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

    const playerId = playerEntity.id;

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

    // Calculate BFS path from current tile to target
    const path = this.pathfinder.findPath(
      state.currentTile,
      payload.targetTile,
      (tile) => this.isTileWalkable(tile),
    );

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

      // Convert tile to world position
      const worldPos = tileToWorld(state.currentTile);

      // Get terrain height
      if (terrain) {
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

    // Get terrain height
    if (terrain) {
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
    this.antiCheat.cleanup(playerId);
    this.movementRateLimiter.reset(playerId);
    this.pathfindRateLimiter.reset(playerId);
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
    const newTile = worldToTile(position.x, position.z);

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

      console.log(
        `[TileMovement] Synced ${playerId} position to tile (${newTile.x},${newTile.z}) after respawn/teleport`,
      );
    } else {
      // Create fresh state at new position
      state = createTileMovementState(newTile);
      this.playerStates.set(playerId, state);
      console.log(
        `[TileMovement] Created new state for ${playerId} at tile (${newTile.x},${newTile.z})`,
      );
    }
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
   * - When clicking on an NPC, the requested tiles are all tiles within melee range
   * - BFS finds the CLOSEST valid tile among those options
   * - For range 1 melee: only cardinal tiles (N/S/E/W) are valid destinations
   * - Pathfinding recalculates every tick until target tile is found
   *
   * @param playerId - The player to move
   * @param targetPosition - Target position in world coordinates
   * @param running - Whether to run (default: true for combat following)
   * @param meleeRange - Weapon's melee range (1 = standard, 2 = halberd, 0 = non-combat)
   *
   * @see https://oldschool.runescape.wiki/w/Pathfinding
   */
  movePlayerToward(
    playerId: string,
    targetPosition: { x: number; y: number; z: number },
    running: boolean = true,
    meleeRange: number = 0, // 0 = non-combat, 1+ = melee combat range
  ): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) {
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

    if (meleeRange > 0) {
      // COMBAT MOVEMENT: Use OSRS-accurate melee positioning
      // Check if already in valid melee range (cardinal-only for range 1)
      if (
        tilesWithinMeleeRange(state.currentTile, this._targetTile, meleeRange)
      ) {
        return; // Already in position, no movement needed
      }

      // Find best melee tile (cardinal-only for range 1, diagonal allowed for range 2+)
      const meleeTile = getBestMeleeTile(
        this._targetTile,
        state.currentTile,
        meleeRange,
        (tile) => this.isTileWalkable(tile),
      );

      if (!meleeTile) {
        return; // No valid melee position found
      }

      destinationTile = meleeTile;
    } else {
      // NON-COMBAT MOVEMENT: Go directly to target tile
      if (tilesEqual(this._targetTile, state.currentTile)) {
        return; // Already at target
      }
      destinationTile = this._targetTile;
    }

    // Calculate BFS path to the destination tile (NOT to target, then truncate!)
    const path = this.pathfinder.findPath(
      state.currentTile,
      destinationTile,
      (tile) => this.isTileWalkable(tile),
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
