/**
 * PendingGatherManager - Server-Authoritative Resource Gathering
 *
 * Modeled after PendingAttackManager for combat.
 * Handles the movement-to-gather flow when a player clicks a resource.
 *
 * SERVER-AUTHORITATIVE FLOW:
 * 1. Player clicks resource → client sends resourceInteract with resourceId
 * 2. Server looks up resource's TRUE position from ResourceSystem
 * 3. Server calculates best cardinal tile using GATHERING_CONSTANTS.GATHERING_RANGE
 * 4. Server paths player to that tile via movePlayerToward()
 * 5. Every tick, server checks if player arrived at cardinal tile
 * 6. When arrived, server rotates player to face resource and starts gathering
 *
 * KEY DIFFERENCES FROM OLD APPROACH:
 * - Uses movePlayerToward() with GATHERING_RANGE (like combat's MELEE_RANGE_STANDARD)
 * - Tick-based processing (like PendingAttackManager) instead of setInterval
 * - Direct rotation on entity.rotation (like CombatRotationManager) for reliable broadcast
 * - No client-side position calculations
 *
 * @see PendingAttackManager - combat equivalent
 * @see CombatRotationManager - rotation approach we copy
 */

import type { World } from "@hyperscape/shared";
import {
  EventType,
  worldToTile,
  worldToTileInto,
  tileToWorld,
  tilesWithinMeleeRange,
  quaternionPool,
  type TileCoord,
  type ResourceFootprint,
  FOOTPRINT_SIZES,
  GATHERING_CONSTANTS,
} from "@hyperscape/shared";
import type { TileMovementManager } from "./tile-movement";

/**
 * Pending gather request data
 */
interface PendingGather {
  playerId: string;
  resourceId: string;
  /** Resource anchor tile (SW corner for multi-tile resources) */
  resourceAnchorTile: TileCoord;
  /** Resource footprint size */
  footprintX: number;
  footprintZ: number;
  /** Last known player tile (for detecting arrival) */
  lastPlayerTile: TileCoord;
  /** When this pending gather was created (for timeout) */
  createdTick: number;
  /** Whether this is a fishing spot (uses distance check instead of tile adjacency) */
  isFishing: boolean;
  /** Resource world position (for distance calculations) */
  resourcePosition: { x: number; y: number; z: number };
}

/**
 * Entity interface for rotation operations (matches CombatRotationManager)
 */
interface RotatableEntity {
  id: string;
  position?: { x: number; y: number; z: number };
  // Server-side rotation (plain object with x,y,z,w) - CRITICAL for network sync
  rotation?: { x: number; y: number; z: number; w: number };
  // Client-side transforms (THREE.js objects)
  base?: {
    quaternion?: {
      set(x: number, y: number, z: number, w: number): void;
    };
  };
  node?: {
    quaternion?: {
      set(x: number, y: number, z: number, w: number): void;
    };
  };
  markNetworkDirty?: () => void;
}

/**
 * Resource data from ResourceSystem
 */
interface ResourceData {
  id: string;
  position: { x: number; y: number; z: number };
  footprint?: ResourceFootprint;
  isAvailable?: boolean;
  skillRequired?: string;
  type?: string;
}

/** Fishing interaction range in world units (meters) */
const FISHING_INTERACTION_RANGE = 4.0;

/** Timeout for pending gathers (in ticks) - 20 ticks = 12 seconds at 600ms/tick */
const PENDING_GATHER_TIMEOUT_TICKS = 20;

export class PendingGatherManager {
  private world: World;
  private tileMovementManager: TileMovementManager;
  private sendFn: (name: string, data: unknown) => void;

  /** Map of playerId → pending gather data */
  private pendingGathers: Map<string, PendingGather> = new Map();

  /** Pre-allocated tile buffers (zero-allocation hot path) */
  private readonly _playerTile: TileCoord = { x: 0, z: 0 };
  private readonly _resourceTile: TileCoord = { x: 0, z: 0 };

  constructor(
    world: World,
    tileMovementManager: TileMovementManager,
    sendFn: (name: string, data: unknown) => void,
  ) {
    this.world = world;
    this.tileMovementManager = tileMovementManager;
    this.sendFn = sendFn;
  }

  /**
   * Queue a pending gather for a player.
   * Called when player clicks a resource.
   *
   * SERVER-AUTHORITATIVE: Server looks up resource position and paths player.
   */
  queuePendingGather(
    playerId: string,
    resourceId: string,
    currentTick: number,
  ): void {
    // Cancel any existing pending gather
    this.cancelPendingGather(playerId);

    // Look up resource using SERVER's authoritative data
    const resourceSystem = this.world.getSystem("resource") as {
      getResource?: (id: string) => ResourceData | null;
    } | null;

    if (!resourceSystem?.getResource) {
      console.warn("[PendingGather] No resource system available");
      return;
    }

    const resource = resourceSystem.getResource(resourceId);
    if (!resource) {
      console.warn(`[PendingGather] Resource ${resourceId} not found`);
      return;
    }

    if (!resource.isAvailable) {
      // Resource is depleted - silently ignore
      return;
    }

    // Get player entity
    const player = this.world.getPlayer?.(playerId);
    if (!player?.position) {
      console.warn(`[PendingGather] Player ${playerId} not found`);
      return;
    }

    // Get resource footprint
    const footprint: ResourceFootprint = resource.footprint || "standard";
    const size = FOOTPRINT_SIZES[footprint];

    // Detect if this is a fishing spot (uses distance check instead of tile adjacency)
    const isFishing =
      resource.skillRequired === "fishing" || resource.type === "fishing_spot";

    // Calculate tiles
    worldToTileInto(player.position.x, player.position.z, this._playerTile);
    worldToTileInto(
      resource.position.x,
      resource.position.z,
      this._resourceTile,
    );

    console.log(
      `[PendingGather] SERVER-AUTHORITATIVE: Player ${playerId} wants to gather ${resourceId}${isFishing ? " (FISHING)" : ""}`,
    );
    console.log(
      `[PendingGather]   Resource at anchor (${this._resourceTile.x}, ${this._resourceTile.z}), footprint ${size.x}x${size.z}`,
    );
    console.log(
      `[PendingGather]   Player at tile (${this._playerTile.x}, ${this._playerTile.z})`,
    );

    // FISHING: Use world-distance check (shore/water boundary doesn't align with tiles)
    if (isFishing) {
      const dx = player.position.x - resource.position.x;
      const dz = player.position.z - resource.position.z;
      const worldDistance = Math.sqrt(dx * dx + dz * dz);

      console.log(
        `[PendingGather]   🎣 Fishing: player is ${worldDistance.toFixed(1)}m from spot (max ${FISHING_INTERACTION_RANGE}m)`,
      );

      // Already in range - start immediately
      if (worldDistance <= FISHING_INTERACTION_RANGE) {
        console.log(
          `[PendingGather]   🎣 Already in fishing range - starting gather immediately`,
        );
        this.rotateToFaceResource(playerId, this._resourceTile, size.x, size.z);
        this.startGathering(playerId, resourceId);
        return;
      }
    } else {
      // NON-FISHING: Check if already on a cardinal tile adjacent to resource
      if (
        this.isOnCardinalTile(
          this._playerTile,
          this._resourceTile,
          size.x,
          size.z,
        )
      ) {
        console.log(
          `[PendingGather]   Already on cardinal tile - starting gather immediately`,
        );
        this.rotateToFaceResource(playerId, this._resourceTile, size.x, size.z);
        this.startGathering(playerId, resourceId);
        return;
      }
    }

    // Get player's run mode from TileMovementManager
    const isRunning = this.tileMovementManager.getIsRunning(playerId);

    console.log(
      `[PendingGather]   Movement mode: ${isRunning ? "running" : "walking"}`,
    );

    if (isFishing) {
      // FISHING: Find closest walkable shore tile and path directly to it
      // Fishing spots are in water, so we can't use melee-range-based pathfinding
      const shoreTile = this.tileMovementManager.findClosestWalkableTile(
        resource.position,
        10, // Search up to 10 tiles away from fishing spot
      );

      if (shoreTile) {
        const shoreWorld = tileToWorld(shoreTile);
        console.log(
          `[PendingGather]   🎣 Found shore tile at (${shoreTile.x}, ${shoreTile.z}) - pathing there`,
        );
        // Use meleeRange=0 for non-combat direct movement to the shore tile
        this.tileMovementManager.movePlayerToward(
          playerId,
          { x: shoreWorld.x, y: 0, z: shoreWorld.z },
          isRunning,
          0, // Non-combat movement - go directly to tile
        );
      } else {
        console.warn(
          `[PendingGather]   🎣 No walkable shore tile found near fishing spot!`,
        );
      }
    } else {
      // NON-FISHING: Use GATHERING_RANGE (1) for cardinal-only positioning
      this.tileMovementManager.movePlayerToward(
        playerId,
        resource.position,
        isRunning,
        GATHERING_CONSTANTS.GATHERING_RANGE,
      );
    }

    // Store pending gather
    this.pendingGathers.set(playerId, {
      playerId,
      resourceId,
      resourceAnchorTile: { x: this._resourceTile.x, z: this._resourceTile.z },
      footprintX: size.x,
      footprintZ: size.z,
      lastPlayerTile: { x: this._playerTile.x, z: this._playerTile.z },
      createdTick: currentTick,
      isFishing,
      resourcePosition: { ...resource.position },
    });

    console.log(
      `[PendingGather]   Queued pending gather, waiting for player to arrive`,
    );
  }

  /**
   * Cancel pending gather for a player
   */
  cancelPendingGather(playerId: string): void {
    if (this.pendingGathers.has(playerId)) {
      this.pendingGathers.delete(playerId);
      console.log(`[PendingGather] Cancelled pending gather for ${playerId}`);
    }
  }

  /**
   * Process all pending gathers - called every tick
   * Checks if players have arrived at cardinal tiles and starts gathering
   */
  processTick(currentTick: number): void {
    for (const [playerId, pending] of this.pendingGathers) {
      // Check timeout
      if (currentTick - pending.createdTick > PENDING_GATHER_TIMEOUT_TICKS) {
        console.log(`[PendingGather] Timeout for ${playerId}`);
        this.pendingGathers.delete(playerId);
        continue;
      }

      // Get player entity
      const player = this.world.getPlayer?.(playerId);
      if (!player?.position) {
        this.pendingGathers.delete(playerId);
        continue;
      }

      // Check if resource still exists and is available
      const resourceSystem = this.world.getSystem("resource") as {
        getResource?: (id: string) => ResourceData | null;
      } | null;

      const resource = resourceSystem?.getResource?.(pending.resourceId);
      if (!resource || !resource.isAvailable) {
        console.log(
          `[PendingGather] Resource ${pending.resourceId} no longer available`,
        );
        this.pendingGathers.delete(playerId);
        continue;
      }

      // Get current player tile
      worldToTileInto(player.position.x, player.position.z, this._playerTile);

      // FISHING: Use world-distance check
      // NON-FISHING: Use tile-based cardinal adjacency
      let hasArrived = false;

      if (pending.isFishing) {
        // Distance check for fishing
        const dx = player.position.x - pending.resourcePosition.x;
        const dz = player.position.z - pending.resourcePosition.z;
        const worldDistance = Math.sqrt(dx * dx + dz * dz);
        hasArrived = worldDistance <= FISHING_INTERACTION_RANGE;

        if (hasArrived) {
          console.log(
            `[PendingGather] 🎣 Player ${playerId} arrived within fishing range (${worldDistance.toFixed(1)}m) - starting gather`,
          );
        }
      } else {
        // Tile check for non-fishing
        hasArrived = this.isOnCardinalTile(
          this._playerTile,
          pending.resourceAnchorTile,
          pending.footprintX,
          pending.footprintZ,
        );

        if (hasArrived) {
          console.log(
            `[PendingGather] Player ${playerId} arrived at cardinal tile - starting gather`,
          );
        }
      }

      if (hasArrived) {
        // Rotate player to face resource center
        this.rotateToFaceResource(
          playerId,
          pending.resourceAnchorTile,
          pending.footprintX,
          pending.footprintZ,
        );

        // Start gathering
        this.startGathering(playerId, pending.resourceId);

        // Remove from pending
        this.pendingGathers.delete(playerId);
      }
    }
  }

  /**
   * Check if player tile is on a cardinal adjacent tile to resource
   * Uses tilesWithinMeleeRange with GATHERING_RANGE (cardinal-only, like standard melee)
   */
  private isOnCardinalTile(
    playerTile: TileCoord,
    resourceAnchor: TileCoord,
    footprintX: number,
    footprintZ: number,
  ): boolean {
    // For multi-tile resources, we need to check all tiles the resource occupies
    // Player must be cardinally adjacent to ANY tile of the resource
    for (let ox = 0; ox < footprintX; ox++) {
      for (let oz = 0; oz < footprintZ; oz++) {
        const resourceTile = {
          x: resourceAnchor.x + ox,
          z: resourceAnchor.z + oz,
        };
        // tilesWithinMeleeRange with GATHERING_RANGE checks cardinal-only
        if (
          tilesWithinMeleeRange(
            playerTile,
            resourceTile,
            GATHERING_CONSTANTS.GATHERING_RANGE,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Rotate player to face the center of the resource.
   * Uses the SAME approach as CombatRotationManager for reliable broadcast.
   */
  private rotateToFaceResource(
    playerId: string,
    resourceAnchor: TileCoord,
    footprintX: number,
    footprintZ: number,
  ): void {
    const player = this.world.getPlayer?.(playerId) as RotatableEntity | null;
    if (!player?.position) return;

    // Calculate resource center in world coordinates
    // For 1×1 at anchor (15,-10): center = (15.5, -9.5)
    // For 2×2 at anchor (15,-10): center = (16.0, -9.0)
    const centerWorld = tileToWorld({
      x: resourceAnchor.x + footprintX / 2,
      z: resourceAnchor.z + footprintZ / 2,
    });

    // Calculate angle from player to resource center
    const dx = centerWorld.x - player.position.x;
    const dz = centerWorld.z - player.position.z;
    let angle = Math.atan2(dx, dz);

    // VRM 1.0+ models have 180° base rotation
    angle += Math.PI;

    // Apply rotation using pooled quaternion (same as CombatRotationManager)
    const tempQuat = quaternionPool.acquire();
    quaternionPool.setYRotation(tempQuat, angle);

    const qx = tempQuat.x;
    const qy = tempQuat.y;
    const qz = tempQuat.z;
    const qw = tempQuat.w;

    quaternionPool.release(tempQuat);

    // CRITICAL: Set entity.rotation for server-side sync
    // This is what EntityManager reads to broadcast
    if (player.rotation) {
      player.rotation.x = qx;
      player.rotation.y = qy;
      player.rotation.z = qz;
      player.rotation.w = qw;
    }

    // Also set client-side transforms
    if (player.base?.quaternion) {
      player.base.quaternion.set(qx, qy, qz, qw);
    }
    if (player.node?.quaternion) {
      player.node.quaternion.set(qx, qy, qz, qw);
    }

    // Mark network dirty
    player.markNetworkDirty?.();

    // ALSO send explicit entityModified packet for immediate sync
    this.sendFn("entityModified", {
      id: playerId,
      changes: {
        q: [qx, qy, qz, qw],
      },
    });

    console.log(
      `[PendingGather] 🧭 Rotated ${playerId} to face resource: angle=${((angle * 180) / Math.PI).toFixed(1)}°`,
    );
  }

  /**
   * Start the gathering process
   */
  private startGathering(playerId: string, resourceId: string): void {
    const player = this.world.getPlayer?.(playerId);
    if (!player?.position) return;

    // Emit RESOURCE_GATHER event - ResourceSystem will handle the actual gathering
    this.world.emit(EventType.RESOURCE_GATHER, {
      playerId,
      resourceId,
      playerPosition: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
    });
  }
}
