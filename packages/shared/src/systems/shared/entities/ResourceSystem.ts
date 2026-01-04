import { SystemBase } from "../infrastructure/SystemBase";
import { TerrainSystem } from "..";
import { uuid } from "../../../utils";
import type { World } from "../../../types";
import { EventType } from "../../../types/events";
import { Resource, ResourceDrop } from "../../../types/core/core";
import { PlayerID, ResourceID } from "../../../types/core/identifiers";
import { calculateDistance } from "../../../utils/game/EntityUtils";
import {
  createPlayerID,
  createResourceID,
} from "../../../utils/IdentifierUtils";
import type { TerrainResourceSpawnPoint } from "../../../types/world/terrain";
import {
  TICK_DURATION_MS,
  snapToTileCenter,
  worldToTile,
  isCardinallyAdjacentToResource,
  type TileCoord,
} from "../movement/TileSystem";
import {
  FOOTPRINT_SIZES,
  type ResourceFootprint,
} from "../../../types/game/resource-processing-types";
import {
  getExternalResource,
  getExternalToolsForSkill,
} from "../../../utils/ExternalAssetUtils";
import type { GatheringToolData } from "../../../data/DataManager";
import { ALL_WORLD_AREAS } from "../../../data/world-areas";
import { GATHERING_CONSTANTS } from "../../../constants/GatheringConstants";
// Note: quaternionPool no longer used here - face rotation is deferred to FaceDirectionManager

/**
 * ResourceSystem - Manages resource gathering for all skills (woodcutting, mining, fishing)
 *
 * ## Architecture
 *
 * ### Data Flow
 * 1. Client clicks resource → ResourceInteractionHandler
 * 2. Handler sends network message → resources.ts handler
 * 3. Handler emits RESOURCE_GATHER event with server-authoritative position
 * 4. ResourceSystem.startGathering() validates and creates session
 * 5. TickSystem calls processGatheringTick() every 600ms (OSRS tick rate)
 * 6. On success: drops item via manifest data, awards XP, may deplete resource
 *
 * ### Manifest Integration
 * All resource data comes from resources.json manifest:
 * - harvestSkill, levelRequired: Skill validation
 * - toolRequired: Tool validation (via tools.json manifest)
 * - baseCycleTicks, depleteChance, respawnTicks: Timing configuration
 * - harvestYield: Drop table with itemId, itemName, quantity, chance, xpAmount, stackable
 *
 * ### Session Management
 * Active gathering sessions stored in activeGathering Map (keyed by PlayerID).
 * Sessions cache tuning data at start to avoid per-tick allocations (performance).
 * Sessions end on: resource depletion, player movement, inventory full, or disconnect.
 *
 * ### Security Features
 * - Rate limiting: 600ms minimum between gather requests (1 tick)
 * - Server-authoritative position: Client position ignored, uses world state
 * - Resource ID validation: Alphanumeric with length limit to prevent injection
 * - Proximity checks: Uses server-side player position for range validation
 *
 * ### Tool Tier System (OSRS-Accurate, Manifest-Driven)
 * Tool definitions loaded from tools.json manifest:
 * - Woodcutting: Axe tier affects SUCCESS RATE (not speed), fixed 4-tick rolls
 * - Mining: Pickaxe tier affects ROLL FREQUENCY (not success), variable ticks
 * - Fishing: Equipment doesn't affect speed or success, fixed 5-tick rolls
 *
 * @see GATHERING_CONSTANTS for skill-specific mechanics
 * @see tools.json for tool definitions
 * @see resources.json for resource definitions
 */
export class ResourceSystem extends SystemBase {
  private resources = new Map<ResourceID, Resource>();

  // ===== PERFORMANCE: Debug flag for hot-path logging =====
  /** Enable verbose logging for debugging (disable in production) */
  private static readonly DEBUG_GATHERING = false;

  // Tick-based gathering sessions (OSRS-accurate timing)
  // Session includes cached data to avoid per-tick allocations
  private activeGathering = new Map<
    PlayerID,
    {
      playerId: PlayerID;
      resourceId: ResourceID;
      startTick: number; // Tick when gathering started
      nextAttemptTick: number; // Next tick to roll for success
      cycleTickInterval: number; // Ticks between attempts
      attempts: number;
      successes: number;
      // PERFORMANCE: Cached at session start to avoid per-tick allocations
      cachedTuning: {
        levelRequired: number;
        xpPerLog: number;
        depleteChance: number;
        respawnTicks: number;
      };
      cachedSuccessRate: number;
      cachedDrops: ResourceDrop[];
      cachedResourceName: string; // For messages without lookup
      // OSRS-ACCURACY: Store start position to detect movement (cancels gathering)
      cachedStartPosition: { x: number; y: number; z: number };
      // DEBUG: Cached for logging (only used when DEBUG_GATHERING=true)
      debugInfo?: {
        skill: string;
        variant: string;
        toolTier: string | null;
        lowHigh: { low: number; high: number };
      };
    }
  >();
  // Tick-based respawn tracking (replaces legacy setTimeout approach)
  private respawnAtTick = new Map<ResourceID, number>();
  private playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();
  private resourceVariants = new Map<ResourceID, string>();
  // Track manifest-spawned resources (from world-areas.json) - these should NOT be deleted on tile unload
  private manifestResourceIds = new Set<ResourceID>();
  // Terrain system reference for height lookups
  private terrainSystem: TerrainSystem | null = null;

  // ===== FORESTRY-STYLE RESOURCE TIMERS (OSRS-accurate) =====
  /**
   * Per-resource depletion timer for Forestry-style tree mechanics.
   * - Timer starts on FIRST LOG (not first interaction)
   * - Counts down at 1 tick/tick while anyone is gathering
   * - Regenerates at 1 tick/tick when no one is gathering
   * - Tree depletes when timer=0 AND player receives a log
   * - Multiple players share the same timer (no penalty)
   *
   * @see https://oldschool.runescape.wiki/w/Forestry
   */
  private resourceTimers = new Map<
    ResourceID,
    {
      currentTicks: number; // Current timer value (counts down while gathering)
      maxTicks: number; // Max timer value from TREE_DESPAWN_TICKS
      hasReceivedFirstLog: boolean; // Timer only starts after first log
      activeGatherers: Set<PlayerID>; // Players currently gathering this resource
      lastUpdateTick: number; // For calculating tick deltas
    }
  >();

  // ===== SECURITY: Rate limiting to prevent gather request spam =====
  private gatherRateLimits = new Map<PlayerID, number>();

  // ===== OSRS-ACCURACY: Fishing spot movement timers =====
  /**
   * Fishing spots don't deplete - they periodically move to nearby tiles.
   * Each spot has a random timer that triggers relocation.
   *
   * @see https://oldschool.runescape.wiki/w/Fishing
   */
  private fishingSpotMoveTimers = new Map<
    ResourceID,
    {
      moveAtTick: number; // Tick when spot will move
      originalPosition: { x: number; y: number; z: number }; // For reference
    }
  >();

  // =============================================================================
  // TOOL DATA - Now loaded from tools.json manifest
  // =============================================================================
  //
  // Tool definitions are in packages/server/world/assets/manifests/tools.json
  // Loaded at runtime via DataManager → getExternalToolsForSkill()
  //
  // OSRS-ACCURATE MECHANICS:
  // - Woodcutting: tier affects success rate, roll frequency is fixed (4 ticks)
  // - Mining: rollTicks affects roll frequency, success rate is level-only
  // - Fishing: Equipment doesn't affect speed or success
  //
  // @see https://oldschool.runescape.wiki/w/Axe
  // @see https://oldschool.runescape.wiki/w/Pickaxe
  // =============================================================================

  constructor(world: World) {
    super(world, {
      name: "resource",
      dependencies: {
        required: [], // Resource system can work independently
        optional: ["inventory", "skills", "ui", "terrain"], // Better with inventory, skills, and terrain systems
      },
      autoCleanup: true,
    });
  }

  /**
   * Helper to send network messages (DRY principle)
   */
  private sendNetworkMessage(method: string, data: unknown): void {
    const network = this.world.network as
      | { send?: (method: string, data: unknown) => void }
      | undefined;
    if (network?.send) {
      network.send(method, data);
    }
  }

  /**
   * Calculate all tiles occupied by a resource based on its anchor tile and footprint
   *
   * OSRS-ACCURACY: Multi-tile resources (like large trees) occupy multiple tiles.
   * The anchor tile is the SW corner, and this function returns all tiles
   * in the rectangular footprint.
   *
   * @param anchorTile - SW corner tile of the resource
   * @param footprint - Footprint type (standard=1×1, large=2×2, massive=3×3)
   * @returns Array of all occupied tile coordinates
   */
  private getOccupiedTiles(
    anchorTile: TileCoord,
    footprint: ResourceFootprint,
  ): TileCoord[] {
    const size = FOOTPRINT_SIZES[footprint];
    const tiles: TileCoord[] = [];

    for (let dx = 0; dx < size.x; dx++) {
      for (let dz = 0; dz < size.z; dz++) {
        tiles.push({
          x: anchorTile.x + dx,
          z: anchorTile.z + dz,
        });
      }
    }

    return tiles;
  }

  async init(): Promise<void> {
    // Set up type-safe event subscriptions for resource management
    this.subscribe<{ spawnPoints: TerrainResourceSpawnPoint[] }>(
      EventType.RESOURCE_SPAWN_POINTS_REGISTERED,
      async (data) => {
        await this.registerTerrainResources(data);
      },
    );

    // Subscribe to direct harvest requests from ResourceEntity interactions
    this.subscribe(EventType.RESOURCE_HARVEST_REQUEST, (data) => {
      // Forward to RESOURCE_GATHER handler with correct format
      this.world.emit(EventType.RESOURCE_GATHER, {
        playerId: data.playerId,
        resourceId: data.entityId, // entityId is the resource entity ID
        playerPosition: undefined, // Will be looked up from player entity
      });
    });

    this.subscribe<{
      playerId: string;
      resourceId: string;
      playerPosition?: { x: number; y: number; z: number };
    }>(EventType.RESOURCE_GATHER, (data) => {
      const playerPosition =
        data.playerPosition ||
        (() => {
          const player = this.world.getPlayer?.(data.playerId);
          return player &&
            (player as { position?: { x: number; y: number; z: number } })
              .position
            ? (player as { position: { x: number; y: number; z: number } })
                .position
            : { x: 0, y: 0, z: 0 };
        })();
      this.startGathering({
        playerId: data.playerId,
        resourceId: data.resourceId,
        playerPosition,
      });
    });

    // Set up player gathering event subscriptions (RESOURCE_GATHER only to avoid loops)
    this.subscribe<{ playerId: string; resourceId: string }>(
      EventType.RESOURCE_GATHERING_STOPPED,
      (data) => this.stopGathering(data),
    );
    this.subscribe<{ id: string }>(EventType.PLAYER_UNREGISTERED, (data) =>
      this.cleanupPlayerGathering(data.id),
    );

    // OSRS-ACCURACY: Cancel gathering when player clicks to move anywhere
    // In OSRS, gathering uses "weak queue" which is cancelled by ANY click (even same tile)
    // This ensures clicking ground under yourself cancels gathering, matching OSRS behavior
    this.subscribe<{
      playerId: string;
      targetPosition: { x: number; y: number; z: number };
    }>(EventType.MOVEMENT_CLICK_TO_MOVE, (data) => {
      const playerId = createPlayerID(data.playerId);
      const session = this.activeGathering.get(playerId);
      if (session) {
        // Cancel gathering - player clicked to move (weak queue behavior)
        this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
          playerId: data.playerId,
          resourceId: session.resourceId,
        });
        this.resetGatheringEmote(data.playerId);
        this.activeGathering.delete(playerId);
      }
    });

    // OSRS-ACCURACY: Cancel gathering when player dies
    // Critical: Dead players cannot continue gathering
    this.subscribe<{ playerId: string }>(EventType.PLAYER_DIED, (data) => {
      this.cancelGatheringForPlayer(data.playerId, "died");
    });

    // OSRS-ACCURACY: Cancel gathering when player teleports
    // Cannot gather from a resource across the map
    this.subscribe<{
      playerId: string;
      position: { x: number; y: number; z: number };
    }>(EventType.PLAYER_TELEPORT_REQUEST, (data) => {
      this.cancelGatheringForPlayer(data.playerId, "teleported");
    });

    // OSRS-ACCURACY: Cancel gathering when player initiates combat
    // Attacking a mob/player is a new action that replaces gathering
    this.subscribe<{
      attackerId?: string;
      playerId?: string;
      targetId: string;
      attackerType: string;
      targetType: string;
    }>(EventType.COMBAT_ATTACK_REQUEST, (data) => {
      const playerId = data.attackerId || data.playerId;
      if (playerId) {
        this.cancelGatheringForPlayer(playerId, "combat");
      }
    });

    // OSRS-ACCURACY: Cancel gathering when player opens bank
    // Opening interface = new action
    this.subscribe<{ playerId: string; bankId?: string }>(
      EventType.BANK_OPEN,
      (data) => {
        this.cancelGatheringForPlayer(data.playerId, "bank_open");
      },
    );

    // OSRS-ACCURACY: Cancel gathering when player opens store
    // Opening interface = new action
    this.subscribe<{ playerId: string; storeId?: string }>(
      EventType.STORE_OPEN,
      (data) => {
        this.cancelGatheringForPlayer(data.playerId, "store_open");
      },
    );

    // OSRS-ACCURACY: Cancel gathering when player interacts with any entity
    // Clicking on an entity (NPC, player, object) = new action
    // Exception: Don't cancel if interacting with the same resource we're gathering
    this.subscribe<{
      playerId: string;
      entityId: string;
      interactionType: string;
    }>(EventType.ENTITY_INTERACT_REQUEST, (data) => {
      const playerId = createPlayerID(data.playerId);
      const session = this.activeGathering.get(playerId);
      // Only cancel if interacting with a DIFFERENT entity than what we're gathering
      if (session && session.resourceId !== data.entityId) {
        this.cancelGatheringForPlayer(data.playerId, "entity_interact");
      }
    });

    // OSRS-ACCURACY: Cancel gathering when player drops an item
    // Dropping is an action that should cancel gathering
    // Also prevents database deadlocks between inventory insert (gathering) and delete (drop)
    this.subscribe<{
      playerId: string;
      itemId: string;
      quantity?: number;
      slot?: number;
    }>(EventType.ITEM_DROP, (data) => {
      this.cancelGatheringForPlayer(data.playerId, "item_drop");
    });

    // OSRS-ACCURACY: Cancel gathering when equipping/unequipping items
    // In OSRS, equipment changes are distinct actions that interrupt gathering
    this.subscribe<{
      playerId: string;
      itemId: string;
      slot?: string;
    }>(EventType.EQUIPMENT_EQUIP, (data) => {
      this.cancelGatheringForPlayer(data.playerId, "equip_item");
    });

    this.subscribe<{
      playerId: string;
      itemId: string;
      slot?: string;
    }>(EventType.EQUIPMENT_UNEQUIP, (data) => {
      this.cancelGatheringForPlayer(data.playerId, "unequip_item");
    });

    // Terrain resources now flow through RESOURCE_SPAWN_POINTS_REGISTERED only
    this.subscribe<{ tileId: string }>("terrain:tile:unloaded", (data) =>
      this.onTerrainTileUnloaded(data),
    );

    // Listen to skills updates for reactive patterns
    this.subscribe<{
      playerId: string;
      skills: Record<string, { level: number; xp: number }>;
    }>(EventType.SKILLS_UPDATED, (data) => {
      this.playerSkills.set(data.playerId, data.skills);
    });

    // Get terrain system for height lookups
    this.terrainSystem = this.world.getSystem(
      "terrain",
    ) as TerrainSystem | null;
  }

  private sendChat(playerId: string | PlayerID, text: string): void {
    // World.chat is properly typed, no cast needed
    const chat = this.world.chat;
    const msg = {
      id: uuid(),
      from: "System",
      fromId: null,
      body: text,
      text,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
    chat.add(msg, true);
  }

  /**
   * Set gathering emote for a player
   */
  private setGatheringEmote(playerId: string, emote: string): void {
    const playerEntity = this.world.getPlayer?.(playerId);
    if (playerEntity) {
      console.log(`[ResourceSystem] 🪓 Setting ${emote} emote for ${playerId}`);

      // Set emote STRING KEY (players use emote strings which get mapped to URLs)
      const playerWithEmote = playerEntity as unknown as {
        emote?: string;
        data?: { e?: string };
        markNetworkDirty?: () => void;
      };
      if (playerWithEmote.emote !== undefined) {
        playerWithEmote.emote = emote;
      }
      if (playerWithEmote.data) {
        playerWithEmote.data.e = emote;
      }

      // Send immediate network update for emote (same pattern as CombatSystem)
      // This ensures the emote update arrives at clients immediately
      if (this.world.isServer && this.world.network?.send) {
        this.world.network.send("entityModified", {
          id: playerId,
          e: emote,
        });
      }

      playerWithEmote.markNetworkDirty?.();
    }
  }

  /**
   * Reset gathering emote back to idle
   */
  private resetGatheringEmote(playerId: string): void {
    const playerEntity = this.world.getPlayer?.(playerId);
    if (playerEntity) {
      console.log(
        `[ResourceSystem] 🪓 Resetting emote to idle for ${playerId}`,
      );

      // Reset to idle
      const playerWithEmote = playerEntity as unknown as {
        emote?: string;
        data?: { e?: string };
        markNetworkDirty?: () => void;
      };
      if (playerWithEmote.emote !== undefined) {
        playerWithEmote.emote = "idle";
      }
      if (playerWithEmote.data) {
        playerWithEmote.data.e = "idle";
      }

      // Send immediate network update for emote reset (same pattern as CombatSystem)
      if (this.world.isServer && this.world.network?.send) {
        this.world.network.send("entityModified", {
          id: playerId,
          e: "idle",
        });
      }

      playerWithEmote.markNetworkDirty?.();
    }
  }

  async start(): Promise<void> {
    // Resources will be spawned procedurally by TerrainSystem across all terrain tiles
    // No need for manual default spawning - TerrainSystem generates resources based on biome
    // NOTE: Gathering is now processed via processGatheringTick() called by TickSystem
    // The old 500ms interval has been removed in favor of OSRS-accurate 600ms tick-based processing
    // Registration happens in ServerNetwork/index.ts at TickPriority.RESOURCES

    // Load explicit resource placements from world-areas.json (server only)
    // This must be in start() not init() because network broadcast isn't ready during init()
    if (this.world.isServer) {
      this.initializeWorldAreaResources();

      // SECURITY: Periodic cleanup of stale rate limit entries
      // Prevents memory leak from disconnected players
      this.createInterval(() => {
        const now = Date.now();
        for (const [playerId, timestamp] of this.gatherRateLimits) {
          if (now - timestamp > GATHERING_CONSTANTS.STALE_RATE_LIMIT_MS) {
            this.gatherRateLimits.delete(playerId);
          }
        }
      }, GATHERING_CONSTANTS.RATE_LIMIT_CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * Initialize resources from world-areas.json manifest
   * Called once on server startup to spawn explicit resource placements
   */
  private initializeWorldAreaResources(): void {
    // Type mapping: resources.json type → TerrainResourceSpawnPoint type
    const typeMap: Record<string, TerrainResourceSpawnPoint["type"]> = {
      tree: "tree",
      fishing_spot: "fish",
      herb_patch: "herb",
      rock: "rock",
      ore: "ore",
    };

    console.log(
      `[ResourceSystem] initializeWorldAreaResources() called. ALL_WORLD_AREAS keys: ${Object.keys(ALL_WORLD_AREAS).join(", ")}`,
    );

    for (const [areaId, area] of Object.entries(ALL_WORLD_AREAS)) {
      if (!area.resources || area.resources.length === 0) continue;
      console.log(
        `[ResourceSystem] Processing area "${areaId}" with ${area.resources.length} resources`,
      );

      const spawnPoints: TerrainResourceSpawnPoint[] = [];

      for (const r of area.resources) {
        // Look up resource in manifest to get authoritative type
        const resourceData = getExternalResource(r.resourceId);
        console.log(
          `[ResourceSystem] getExternalResource("${r.resourceId}") returned: ${resourceData ? resourceData.type : "null"}`,
        );
        if (!resourceData) {
          console.warn(
            `[ResourceSystem] Unknown resource ID in world-areas: ${r.resourceId}`,
          );
          continue;
        }

        // Map type (e.g., "fishing_spot" → "fish")
        const mappedType = typeMap[resourceData.type] || resourceData.type;

        // Extract subType by removing type prefix from resourceId
        // "tree_oak" - "tree_" = "oak"
        // "tree_normal" - "tree_" = "normal" → undefined
        const suffix = r.resourceId.replace(resourceData.type + "_", "");
        const subType = suffix === "normal" ? undefined : suffix;

        // Ground Y position to terrain height
        let groundedY = r.position.y;
        if (this.terrainSystem) {
          const terrainHeight = this.terrainSystem.getHeightAt(
            r.position.x,
            r.position.z,
          );
          if (Number.isFinite(terrainHeight)) {
            groundedY = terrainHeight + 0.1; // Slight offset above ground
          }
        }

        spawnPoints.push({
          position: { x: r.position.x, y: groundedY, z: r.position.z },
          type: mappedType as TerrainResourceSpawnPoint["type"],
          subType: subType as TerrainResourceSpawnPoint["subType"],
        });
      }

      if (spawnPoints.length > 0) {
        console.log(
          `[ResourceSystem] Spawning ${spawnPoints.length} explicit resources for area "${areaId}"`,
        );
        // Pass isManifest: true to protect these resources from tile unload deletion
        this.registerTerrainResources({ spawnPoints, isManifest: true });
      }
    }
  }

  /**
   * Handle terrain system resource registration (new procedural system)
   * @param data.spawnPoints - Resource spawn points to register
   * @param data.isManifest - If true, resources are from world-areas.json and won't be deleted on tile unload
   */
  private async registerTerrainResources(data: {
    spawnPoints: TerrainResourceSpawnPoint[];
    isManifest?: boolean;
  }): Promise<void> {
    const { spawnPoints, isManifest = false } = data;

    if (spawnPoints.length === 0) return;

    // Only spawn actual entities on the server (authoritative)
    if (!this.world.isServer) {
      return;
    }

    // Get EntityManager for spawning
    const entityManager = this.world.getSystem("entity-manager") as {
      spawnEntity?: (config: unknown) => Promise<unknown>;
    } | null;
    if (!entityManager?.spawnEntity) {
      console.error(
        "[ResourceSystem] EntityManager not available, cannot spawn resources!",
      );
      return;
    }

    let spawned = 0;

    for (const spawnPoint of spawnPoints) {
      const resource = this.createResourceFromSpawnPoint(spawnPoint);
      if (!resource) {
        continue;
      }

      // Store in map for tracking
      const rid = createResourceID(resource.id);
      this.resources.set(rid, resource);

      // Mark manifest resources so they're not deleted on tile unload
      if (isManifest) {
        this.manifestResourceIds.add(rid);
      }

      console.log(
        `[ResourceSystem] Stored resource in map: id="${resource.id}", rid="${rid}", map size=${this.resources.size}${isManifest ? " (manifest)" : ""}`,
      );
      // Track variant/subtype for tuning (e.g., 'tree_oak')
      if (resource.type === "tree") {
        // Build full key: if subType is "normal", key is "tree_normal"
        const variant = spawnPoint.subType
          ? `tree_${spawnPoint.subType}`
          : "tree_normal";
        this.resourceVariants.set(rid, variant);
      }

      // OSRS-ACCURACY: Initialize fishing spot movement timer
      if (
        resource.type === "fishing_spot" ||
        resource.skillRequired === "fishing"
      ) {
        this.initializeFishingSpotTimer(rid, resource.position);
      }

      // Spawn actual ResourceEntity instance
      // Create proper quaternion for random Y-axis rotation
      const randomYRotation = Math.random() * Math.PI * 2;
      const quat = {
        x: 0,
        y: Math.sin(randomYRotation / 2),
        z: 0,
        w: Math.cos(randomYRotation / 2),
      };

      // OSRS-ACCURACY: Calculate tile footprint data for proper interaction positioning
      const footprint: ResourceFootprint = resource.footprint || "standard";
      const anchorTile = worldToTile(resource.position.x, resource.position.z);
      const occupiedTiles = this.getOccupiedTiles(anchorTile, footprint);

      const resourceConfig = {
        id: resource.id,
        type: "resource" as const,
        name: resource.name,
        position: {
          x: resource.position.x,
          y: resource.position.y,
          z: resource.position.z,
        },
        rotation: quat, // Proper quaternion for random Y-axis rotation
        scale: { x: 1, y: 1, z: 1 }, // ALWAYS uniform scale - ResourceEntity handles mesh scale
        visible: true,
        interactable: true,
        interactionType: "harvest",
        interactionDistance: 3,
        description: `${resource.name} - Requires level ${resource.levelRequired} ${resource.skillRequired}`,
        model: this.getModelPathForResource(resource.type, spawnPoint.subType),
        properties: {},
        // ResourceEntity specific
        resourceType: resource.type,
        resourceId: spawnPoint.subType
          ? `${resource.type}_${spawnPoint.subType}`
          : `${resource.type}_normal`,
        harvestSkill: resource.skillRequired,
        requiredLevel: resource.levelRequired,
        harvestTime: 3000,
        harvestYield: resource.drops.map((drop) => ({
          itemId: drop.itemId,
          quantity: drop.quantity,
          chance: drop.chance,
        })),
        respawnTime: resource.respawnTime,
        depleted: false,
        // Manifest-driven model config
        depletedModelPath: this.getDepletedModelPathForResource(
          resource.type,
          spawnPoint.subType,
        ),
        modelScale: this.getScaleForResource(resource.type, spawnPoint.subType),
        depletedModelScale: this.getDepletedScaleForResource(
          resource.type,
          spawnPoint.subType,
        ),
        // OSRS-ACCURACY: Tile-based positioning for face direction and interaction
        footprint,
        anchorTile,
        occupiedTiles,
      };

      try {
        const spawnedEntity = (await entityManager.spawnEntity(
          resourceConfig,
        )) as { id?: string } | null;
        if (spawnedEntity) {
          spawned++;
        }
      } catch (err) {
        console.error(
          `[ResourceSystem] Failed to spawn resource entity ${resource.id}:`,
          err,
        );
      }
    }

    if (spawned > 0) {
      // Resources spawned successfully
    }
  }

  /**
   * Get model path for resource type from manifest
   * Fails fast if manifest data not found
   */
  private getModelPathForResource(type: string, subType?: string): string {
    // Build resource ID to look up in manifest
    const variantKey = subType ? `${type}_${subType}` : `${type}_normal`;
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    // Return modelPath (can be null for fishing spots, etc.)
    return manifestData.modelPath || "";
  }

  /**
   * Get depleted model path for resource type from manifest
   * Fails fast if manifest data not found
   */
  private getDepletedModelPathForResource(
    type: string,
    subType?: string,
  ): string | null {
    const variantKey = subType ? `${type}_${subType}` : `${type}_normal`;
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    return manifestData.depletedModelPath;
  }

  /**
   * Get scale for resource type from manifest
   * Fails fast if manifest data not found
   */
  private getScaleForResource(type: string, subType?: string): number {
    const variantKey = subType ? `${type}_${subType}` : `${type}_normal`;
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    return manifestData.scale;
  }

  /**
   * Get depleted scale for resource type from manifest
   * Fails fast if manifest data not found
   */
  private getDepletedScaleForResource(type: string, subType?: string): number {
    const variantKey = subType ? `${type}_${subType}` : `${type}_normal`;
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    return manifestData.depletedScale;
  }

  /**
   * Get drops for resource type from manifest
   * Fails fast if manifest data not found
   */
  private getDropsFromManifest(variantKey: string): ResourceDrop[] {
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    if (!manifestData.harvestYield || manifestData.harvestYield.length === 0) {
      throw new Error(
        `[ResourceSystem] Resource '${variantKey}' has no harvestYield defined in manifest.`,
      );
    }

    return manifestData.harvestYield.map((yield_) => ({
      itemId: yield_.itemId,
      itemName: yield_.itemName,
      quantity: yield_.quantity,
      chance: yield_.chance,
      xpAmount: yield_.xpAmount,
      stackable: yield_.stackable,
    }));
  }

  /**
   * Create a Resource from a spawn point - ALL values come from resources.json manifest
   * No hardcoded values - manifest is the single source of truth
   */
  private createResourceFromSpawnPoint(
    spawnPoint: TerrainResourceSpawnPoint,
  ): Resource | undefined {
    const { position, type } = spawnPoint;

    // Map spawn type to resource type for manifest lookup
    const resourceType: "tree" | "fishing_spot" | "ore" | "herb_patch" =
      type === "rock" || type === "ore" || type === "gem" || type === "rare_ore"
        ? "ore"
        : type === "fish"
          ? "fishing_spot"
          : type === "herb"
            ? "herb_patch"
            : "tree";

    // Build variant key for manifest lookup
    // e.g., "tree_normal", "tree_oak", "ore_copper", "fishing_spot_normal"
    // Uses subType if available, otherwise defaults to "_normal"
    const variantKey = spawnPoint.subType
      ? `${resourceType}_${spawnPoint.subType}`
      : `${resourceType}_normal`;

    // Get manifest data - fail fast if not found
    const manifestData = getExternalResource(variantKey);
    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    // OSRS-ACCURACY: Snap position to tile center for proper face direction and interaction
    // This ensures resources are always at tile centers (e.g., 15.5, -9.5) not corners (15, -10)
    const snappedPosition = snapToTileCenter(position);

    // All values come from manifest - no hardcoding
    const resource: Resource = {
      id: `${type}_${snappedPosition.x.toFixed(0)}_${snappedPosition.z.toFixed(0)}`,
      type: resourceType,
      name: manifestData.name,
      position: {
        x: snappedPosition.x,
        y: snappedPosition.y,
        z: snappedPosition.z,
      },
      skillRequired: manifestData.harvestSkill,
      levelRequired: manifestData.levelRequired,
      toolRequired: manifestData.toolRequired || "",
      respawnTime: this.ticksToMs(manifestData.respawnTicks),
      isAvailable: true,
      lastDepleted: 0,
      drops: this.getDropsFromManifest(variantKey),
    };

    return resource;
  }

  /**
   * Handle terrain tile unloading - remove resources from unloaded tiles
   * Note: Manifest resources (from world-areas.json) are protected and never deleted
   */
  private onTerrainTileUnloaded(data: { tileId: string }): void {
    // Extract tileX and tileZ from tileId (format: "x,z")
    const [tileX, tileZ] = data.tileId.split(",").map(Number);

    // Remove resources that belong to this tile (but not manifest resources)
    for (const [resourceId, resource] of this.resources) {
      // Skip manifest resources - they are permanent and shouldn't be deleted on tile unload
      if (this.manifestResourceIds.has(resourceId)) {
        continue;
      }

      // Check if resource belongs to this tile (based on position)
      const resourceTileX = Math.floor(resource.position.x / 100); // 100m tile size
      const resourceTileZ = Math.floor(resource.position.z / 100);

      if (resourceTileX === tileX && resourceTileZ === tileZ) {
        this.resources.delete(resourceId);

        // Clean up any active gathering on this resource
        // Note: activeGathering is keyed by PlayerID, not ResourceID
        // We need to find and remove any gathering sessions for this resource
        for (const [playerId, session] of this.activeGathering) {
          if (session.resourceId === resourceId) {
            this.activeGathering.delete(playerId);
          }
        }
      }
    }
  }

  /**
   * Start a gathering session for a player on a resource
   *
   * Validates:
   * - Rate limit not exceeded (600ms between requests)
   * - Resource ID format is valid (security)
   * - Resource exists and is available
   * - Player has required skill level (from manifest levelRequired)
   * - Player has required tool category (from manifest toolRequired)
   * - Tool level requirement met (from TOOL_TIERS)
   *
   * Creates tick-based gathering session processed by processGatheringTick().
   * Session data is cached at start to avoid per-tick allocations.
   *
   * @param data.playerId - Player attempting to gather
   * @param data.resourceId - Target resource entity ID
   * @param data.playerPosition - Player position (used for proximity fallback)
   *
   * @emits RESOURCE_GATHERING_STARTED on successful session start
   * @emits UI_MESSAGE on validation failure with error details
   *
   * @example
   * ```typescript
   * world.emit(EventType.RESOURCE_GATHER, {
   *   playerId: 'player_123',
   *   resourceId: 'tree_50_100',
   *   playerPosition: { x: 50, y: 0, z: 100 },
   * });
   * ```
   */
  private startGathering(data: {
    playerId: string;
    resourceId: string;
    playerPosition: { x: number; y: number; z: number };
  }): void {
    // Only server should handle actual gathering logic
    if (!this.world.isServer) {
      return;
    }

    const playerId = createPlayerID(data.playerId);

    // ===== SECURITY: Rate limiting - prevent gather request spam =====
    const now = Date.now();
    const lastAttempt = this.gatherRateLimits.get(playerId);
    if (lastAttempt && now - lastAttempt < GATHERING_CONSTANTS.RATE_LIMIT_MS) {
      // Silently drop rapid requests - don't send error to prevent timing attacks
      return;
    }
    this.gatherRateLimits.set(playerId, now);

    // ===== SECURITY: Validate resource ID format =====
    if (!this.isValidResourceId(data.resourceId)) {
      console.warn(
        "[ResourceSystem] Invalid resource ID format:",
        data.resourceId,
      );
      return;
    }

    const resourceId = createResourceID(data.resourceId);

    let resource = this.resources.get(resourceId);

    if (!resource) {
      for (const r of this.resources.values()) {
        const derived = `${r.type}_${Math.round(r.position.x)}_${Math.round(r.position.z)}`;
        if (derived === (data.resourceId || "")) {
          resource = r;
          break;
        }
      }
    }

    if (!resource) {
      let nearest: Resource | null = null;
      let nearestDist = Infinity;
      for (const r of this.resources.values()) {
        if (!r.isAvailable) continue;
        const d = calculateDistance(data.playerPosition, r.position);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = r;
        }
      }
      if (
        nearest &&
        nearestDist < GATHERING_CONSTANTS.PROXIMITY_SEARCH_RADIUS
      ) {
        console.warn(
          "[ResourceSystem] Matched nearest resource",
          nearest.id,
          "at",
          nearestDist.toFixed(2),
          "m",
        );
        resource = nearest;
      } else {
        console.warn(
          "[ResourceSystem] Resource not found for id",
          data.resourceId,
          "available ids:",
          Array.from(this.resources.keys()).slice(0, 10),
        );
        this.sendChat(data.playerId, `Resource not found. Please try again.`);
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId: data.playerId,
          message: `Resource not found: ${data.resourceId}`,
          type: "error",
        });
        return;
      }
    }

    // Check if resource is available
    if (!resource.isAvailable) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.playerId,
        message: `This ${resource.type.replace("_", " ")} is depleted. Please wait for it to respawn.`,
        type: "info",
      });
      return;
    }

    // ===== CARDINAL ADJACENCY CHECK =====
    // Validate player is on a cardinal tile (N/E/S/W) adjacent to the resource
    // This prevents gathering while standing ON the resource or from diagonal tiles
    const footprint = resource.footprint || "standard";
    const size = FOOTPRINT_SIZES[footprint];
    const resourceAnchorTile = worldToTile(
      resource.position.x,
      resource.position.z,
    );
    const playerTile = worldToTile(
      data.playerPosition.x,
      data.playerPosition.z,
    );

    // Check if player is standing ON the resource
    const isOnResource =
      playerTile.x >= resourceAnchorTile.x &&
      playerTile.x < resourceAnchorTile.x + size.x &&
      playerTile.z >= resourceAnchorTile.z &&
      playerTile.z < resourceAnchorTile.z + size.z;

    if (isOnResource) {
      console.warn(
        `[ResourceSystem] Player ${data.playerId} at tile (${playerTile.x}, ${playerTile.z}) is ON resource ` +
          `at anchor (${resourceAnchorTile.x}, ${resourceAnchorTile.z}) with footprint ${size.x}x${size.z}. Rejecting gather.`,
      );
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.playerId,
        message: `You can't gather while standing on the resource. Move to an adjacent tile.`,
        type: "error",
      });
      return;
    }

    // Check if player is on a cardinal adjacent tile (not diagonal)
    const isOnCardinal = isCardinallyAdjacentToResource(
      playerTile,
      resourceAnchorTile,
      size.x,
      size.z,
    );

    if (!isOnCardinal) {
      console.warn(
        `[ResourceSystem] Player ${data.playerId} at tile (${playerTile.x}, ${playerTile.z}) is NOT on cardinal tile ` +
          `adjacent to resource at (${resourceAnchorTile.x}, ${resourceAnchorTile.z}). Rejecting gather.`,
      );
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.playerId,
        message: `Move closer to the resource.`,
        type: "info",
      });
      return;
    }

    console.log(
      `[ResourceSystem] ✅ Player ${data.playerId} at tile (${playerTile.x}, ${playerTile.z}) is on CARDINAL tile ` +
        `adjacent to resource at anchor (${resourceAnchorTile.x}, ${resourceAnchorTile.z}). Proceeding with gather.`,
    );

    // Check player skill level (reactive pattern)
    const cachedSkills = this.playerSkills.get(data.playerId);
    const skillLevel = cachedSkills?.[resource.skillRequired]?.level ?? 1;

    if (
      resource.levelRequired !== undefined &&
      skillLevel < resource.levelRequired
    ) {
      this.sendChat(
        data.playerId,
        `You need level ${resource.levelRequired} ${resource.skillRequired} to use this resource.`,
      );
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.playerId,
        message: `You need level ${resource.levelRequired} ${resource.skillRequired} to use this resource.`,
        type: "error",
      });
      return;
    }

    // Tool check using manifest's toolRequired field (RuneScape-style: any tier qualifies; tier affects speed)
    if (resource.toolRequired) {
      const toolCategory = this.getToolCategory(resource.toolRequired);
      const hasTool = this.playerHasToolCategory(data.playerId, toolCategory);

      if (!hasTool) {
        const toolName = this.getToolDisplayName(toolCategory);
        this.sendChat(
          data.playerId,
          `You need a ${toolName} to harvest the ${resource.name.toLowerCase()}.`,
        );
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId: data.playerId,
          message: `You need a ${toolName} to harvest the ${resource.name.toLowerCase()}.`,
          type: "error",
        });
        return;
      }

      // Enforce tool level requirement using manifest-driven tool system
      const bestTool = this.getBestTool(data.playerId, resource.skillRequired);
      if (bestTool) {
        const cached = this.playerSkills.get(data.playerId);
        const currentSkillLevel = cached?.[resource.skillRequired]?.level ?? 1;
        if (currentSkillLevel < bestTool.levelRequired) {
          const toolName = this.getToolDisplayName(toolCategory);
          this.emitTypedEvent(EventType.UI_MESSAGE, {
            playerId: data.playerId,
            message: `You need level ${bestTool.levelRequired} ${resource.skillRequired} to use this ${toolName}.`,
            type: "error",
          });
          return;
        }
      }
    }

    // If player is already gathering, replace session with the latest request
    if (this.activeGathering.has(playerId)) {
      this.activeGathering.delete(playerId);
    }

    // Start RS-like timed gathering session with OSRS-accurate messages
    const resourceName = resource.name || resource.type.replace("_", " ");

    // OSRS-ACCURACY: Skill-specific gathering start messages
    // @see https://oldschool.runescape.wiki/w/Woodcutting
    // @see https://oldschool.runescape.wiki/w/Mining
    // @see https://oldschool.runescape.wiki/w/Fishing
    const gatheringStartMessage = (() => {
      switch (resource.skillRequired) {
        case "woodcutting":
          return `You swing your axe at the ${resourceName.toLowerCase()}.`;
        case "mining":
          return `You swing your pickaxe at the ${resourceName.toLowerCase()}.`;
        case "fishing":
          return "You attempt to catch some fish.";
        default:
          return `You start gathering from the ${resourceName.toLowerCase()}.`;
      }
    })();

    // Create tick-based session
    const sessionResourceId = createResourceID(resource.id);

    // Get current tick from world (OSRS-accurate tick-based timing)
    const currentTick = this.world.currentTick || 0;

    // Compute tick-based cycle interval
    const variant =
      this.resourceVariants.get(sessionResourceId) || "tree_normal";
    const tuned = this.getVariantTuning(variant);

    // Get best tool tier using unified tool system
    const toolInfo = this.getBestTool(data.playerId, resource.skillRequired);

    // OSRS-ACCURATE: Compute cycle ticks based on skill-specific mechanics
    // - Woodcutting: Fixed 4 ticks (axe affects success rate, not speed)
    // - Mining: Variable ticks based on pickaxe tier
    // - Fishing: Fixed 5 ticks
    const cycleTickInterval = this.computeCycleTicks(
      resource.skillRequired,
      tuned,
      toolInfo,
    );

    // PERFORMANCE: Pre-compute success rate to avoid per-tick calculation
    // OSRS-ACCURATE: Uses LERP formula with skill-specific tables
    // - Woodcutting: Tree type + axe tier determines success
    // - Mining/Fishing: Resource type only (tool doesn't affect success)
    const successRate = this.computeSuccessRate(
      skillLevel,
      resource.skillRequired,
      variant,
      toolInfo?.tier ?? null,
    );

    // OSRS-ACCURACY: Get server-authoritative player position for movement detection
    const player = this.world.getPlayer?.(data.playerId);
    const startPosition = player?.position
      ? { x: player.position.x, y: player.position.y, z: player.position.z }
      : {
          x: data.playerPosition.x,
          y: data.playerPosition.y,
          z: data.playerPosition.z,
        };

    // OSRS-ACCURACY: Rotate player to face the resource (instant rotation like OSRS)
    // This happens before session starts so animation plays in correct direction
    const footprintForRotation = resource.footprint || "standard";
    console.log(
      `[ResourceSystem] startGathering: Calling rotatePlayerToFaceResource for ${data.playerId}, ` +
        `resource at (${resource.position.x.toFixed(1)}, ${resource.position.z.toFixed(1)}), ` +
        `footprint=${footprintForRotation}, player at (${startPosition.x.toFixed(1)}, ${startPosition.z.toFixed(1)})`,
    );
    this.rotatePlayerToFaceResource(
      data.playerId,
      resource.position,
      footprintForRotation,
    );

    // Get low/high values for debug logging
    const toolTier = toolInfo?.tier ?? null;
    const lowHigh = this.getSuccessRateValues(
      resource.skillRequired,
      variant,
      toolTier,
    );

    // Schedule first attempt on next tick with CACHED data
    this.activeGathering.set(playerId, {
      playerId,
      resourceId: sessionResourceId,
      startTick: currentTick,
      nextAttemptTick: currentTick + 1, // First attempt next tick
      cycleTickInterval,
      attempts: 0,
      successes: 0,
      // PERFORMANCE: Cache everything needed during tick processing
      cachedTuning: tuned,
      cachedSuccessRate: successRate,
      cachedDrops: resource.drops,
      cachedResourceName: resourceName,
      // OSRS-ACCURACY: Store position to detect movement (any movement cancels gathering)
      cachedStartPosition: startPosition,
      // DEBUG: Store for logging (only used when DEBUG_GATHERING=true)
      debugInfo: ResourceSystem.DEBUG_GATHERING
        ? {
            skill: resource.skillRequired,
            variant,
            toolTier,
            lowHigh,
          }
        : undefined,
    });

    // DEBUG: Log session start with OSRS mechanics details
    if (ResourceSystem.DEBUG_GATHERING) {
      const mechanics =
        GATHERING_CONSTANTS.SKILL_MECHANICS[
          resource.skillRequired as keyof typeof GATHERING_CONSTANTS.SKILL_MECHANICS
        ];
      console.log(
        `[Gathering DEBUG] ═══════════════════════════════════════════════════════`,
      );
      console.log(`[Gathering DEBUG] Session started for ${playerId}`);
      console.log(
        `[Gathering DEBUG] Resource: ${variant} (${resource.skillRequired})`,
      );
      console.log(
        `[Gathering DEBUG] Tool: ${toolInfo?.itemId ?? "none"} (tier: ${toolTier ?? "none"})`,
      );
      console.log(
        `[Gathering DEBUG] Mechanics: ${mechanics?.type ?? "unknown"}`,
      );
      console.log(
        `[Gathering DEBUG] Cycle: ${cycleTickInterval} ticks (${(cycleTickInterval * 0.6).toFixed(1)}s)`,
      );
      console.log(
        `[Gathering DEBUG] Success Rate: ${(successRate * 100).toFixed(1)}% (low=${lowHigh.low}, high=${lowHigh.high}, level=${skillLevel})`,
      );
      console.log(
        `[Gathering DEBUG] ═══════════════════════════════════════════════════════`,
      );
    }

    // FORESTRY: Track as active gatherer for timer-based resources
    this.addActiveGatherer(playerId, sessionResourceId, currentTick);

    // Set gathering emote based on skill (generalized)
    const skillEmotes: Record<string, string> = {
      woodcutting: "chopping",
      mining: "mining",
      fishing: "fishing",
    };
    const emote = skillEmotes[resource.skillRequired] ?? resource.skillRequired;
    this.setGatheringEmote(data.playerId, emote);

    // Emit gathering started event with tick timing info for client progress bar
    this.emitTypedEvent(EventType.RESOURCE_GATHERING_STARTED, {
      playerId: data.playerId,
      resourceId: resource.id,
      skill: resource.skillRequired,
      cycleTicks: cycleTickInterval,
      tickDurationMs: TICK_DURATION_MS,
    });

    // OSRS-ACCURACY: Send OSRS-style gathering start message via chat and UI
    this.sendChat(data.playerId, gatheringStartMessage);
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId: data.playerId,
      message: gatheringStartMessage,
      type: "info",
    });

    // Broadcast toast to client via network
    this.sendNetworkMessage("showToast", {
      playerId: data.playerId,
      message: gatheringStartMessage,
      type: "info",
    });
  }

  private stopGathering(data: { playerId: string }): void {
    const playerId = createPlayerID(data.playerId);
    const session = this.activeGathering.get(playerId);
    if (session) {
      // FORESTRY: Remove from active gatherers (timer will regenerate if no other gatherers)
      this.removeActiveGatherer(playerId, session.resourceId);

      this.activeGathering.delete(playerId);

      // Reset emote back to idle when gathering stops
      this.resetGatheringEmote(data.playerId);

      this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
        playerId: data.playerId,
        resourceId: session.resourceId,
      });
    }
  }

  private cleanupPlayerGathering(playerId: string): void {
    const pid = createPlayerID(playerId);
    const session = this.activeGathering.get(pid);
    if (session) {
      // FORESTRY: Remove from active gatherers before deleting session
      this.removeActiveGatherer(pid, session.resourceId);
    }
    this.activeGathering.delete(pid);
    // SECURITY: Clean up rate limit tracking on disconnect
    this.gatherRateLimits.delete(pid);
  }

  /**
   * Cancel gathering for a player due to an action/event (OSRS weak queue behavior)
   * Used by event subscriptions to cancel gathering when player performs another action.
   *
   * @param playerId - The player whose gathering should be cancelled
   * @param reason - Debug reason for logging (e.g., "died", "teleported", "combat")
   */
  private cancelGatheringForPlayer(playerId: string, reason: string): void {
    const pid = createPlayerID(playerId);
    const session = this.activeGathering.get(pid);
    if (session) {
      if (ResourceSystem.DEBUG_GATHERING) {
        console.log(
          `[ResourceSystem] Cancelling gather for ${playerId} - reason: ${reason}`,
        );
      }
      // FORESTRY: Remove from active gatherers (timer will regenerate if no other gatherers)
      this.removeActiveGatherer(pid, session.resourceId);

      this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
        playerId: playerId,
        resourceId: session.resourceId,
      });
      this.resetGatheringEmote(playerId);
      this.activeGathering.delete(pid);
    }
  }

  /**
   * Set face target for player to face a resource (OSRS-accurate deferred rotation)
   *
   * OSRS-ACCURACY: Face direction is NOT applied immediately. Instead:
   * 1. A faceTarget is set on the player
   * 2. At END of the server tick, if player did NOT move, rotation is applied
   * 3. If player moved, rotation is skipped but faceTarget persists
   * 4. Player will face the resource when they eventually stop moving
   *
   * For multi-tile resources (2×2, 3×3), the player faces the center of the
   * occupied tile area, not just a single tile.
   *
   * @see https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/
   *
   * @param playerId - The player to set face target for
   * @param resourcePosition - The position of the resource (tile-centered)
   * @param footprint - The resource's tile footprint (defaults to "standard")
   */
  private rotatePlayerToFaceResource(
    playerId: string,
    resourcePosition: { x: number; y: number; z: number },
    footprint: ResourceFootprint = "standard",
  ): void {
    // OSRS-ACCURACY: Use FaceDirectionManager for deferred tick-end processing
    // The manager will apply rotation at end of tick only if player didn't move
    //
    // CARDINAL-ONLY: Uses deterministic cardinal face direction for AAA quality.
    // Player standing N of resource faces S, E faces W, S faces N, W faces E.
    const faceManager = (
      this.world as {
        faceDirectionManager?: {
          setFaceTarget: (playerId: string, x: number, z: number) => void;
          setCardinalFaceTarget: (
            playerId: string,
            anchorTile: { x: number; z: number },
            footprintX: number,
            footprintZ: number,
          ) => void;
        };
      }
    ).faceDirectionManager;

    if (faceManager) {
      const size = FOOTPRINT_SIZES[footprint];
      const anchorTile = worldToTile(resourcePosition.x, resourcePosition.z);

      console.log(
        `[ResourceSystem] rotatePlayerToFaceResource: ` +
          `resourcePos=(${resourcePosition.x.toFixed(1)}, ${resourcePosition.z.toFixed(1)}), ` +
          `anchorTile=(${anchorTile.x}, ${anchorTile.z}), size=${size.x}x${size.z}`,
      );

      // Use cardinal-only face direction for deterministic behavior
      if (faceManager.setCardinalFaceTarget) {
        console.log(`[ResourceSystem] Using setCardinalFaceTarget`);
        faceManager.setCardinalFaceTarget(playerId, anchorTile, size.x, size.z);
      } else {
        // Fallback to legacy center-based targeting
        console.log(
          `[ResourceSystem] FALLBACK: Using setFaceTarget (no setCardinalFaceTarget)`,
        );
        const targetX = anchorTile.x + size.x / 2;
        const targetZ = anchorTile.z + size.z / 2;
        faceManager.setFaceTarget(playerId, targetX, targetZ);
      }
    } else {
      console.warn(
        `[ResourceSystem] rotatePlayerToFaceResource: No faceManager found!`,
      );
    }
  }

  /**
   * Process resource timers for Forestry-style depletion/regeneration.
   * Called every tick to:
   * - Decrement timers for resources being gathered
   * - Regenerate timers for resources not being gathered
   *
   * @param tickNumber - Current server tick
   */
  private processResourceTimers(tickNumber: number): void {
    for (const [resourceId, timer] of this.resourceTimers) {
      const ticksDelta = tickNumber - timer.lastUpdateTick;
      timer.lastUpdateTick = tickNumber;

      if (timer.activeGatherers.size > 0 && timer.hasReceivedFirstLog) {
        // Being gathered AND first log received - decrement timer
        // OSRS-ACCURACY: Timer only counts down AFTER first log is received
        const oldTicks = timer.currentTicks;
        timer.currentTicks = Math.max(
          0,
          timer.currentTicks -
            ticksDelta * GATHERING_CONSTANTS.TIMER_REGEN_PER_TICK,
        );
        if (oldTicks !== timer.currentTicks) {
          console.log(
            `[Forestry] ⏬ ${resourceId}: timer ${oldTicks} → ${timer.currentTicks} ` +
              `(${timer.activeGatherers.size} gatherer${timer.activeGatherers.size > 1 ? "s" : ""})`,
          );
        }
      } else if (
        timer.activeGatherers.size === 0 &&
        timer.hasReceivedFirstLog
      ) {
        // Not being gathered but was started - regenerate
        const oldTicks = timer.currentTicks;
        timer.currentTicks = Math.min(
          timer.maxTicks,
          timer.currentTicks +
            ticksDelta * GATHERING_CONSTANTS.TIMER_REGEN_PER_TICK,
        );

        if (oldTicks !== timer.currentTicks) {
          console.log(
            `[Forestry] ⏫ ${resourceId}: timer REGEN ${oldTicks} → ${timer.currentTicks}/${timer.maxTicks} (no gatherers)`,
          );
        }

        // If fully regenerated, reset the "first log" state
        if (timer.currentTicks >= timer.maxTicks) {
          console.log(
            `[Forestry] ✅ ${resourceId}: timer FULLY REGENERATED - resetting firstLog flag`,
          );
          timer.hasReceivedFirstLog = false;
        }
      }
    }
  }

  /**
   * Add a player to a resource's active gatherers set.
   * Creates the timer structure if it doesn't exist (for Forestry resources).
   *
   * @param playerId - Player starting to gather
   * @param resourceId - Resource being gathered
   * @param tickNumber - Current tick for timer initialization
   */
  private addActiveGatherer(
    playerId: PlayerID,
    resourceId: ResourceID,
    tickNumber: number,
  ): void {
    // Only track for timer-based resources
    const despawnTicks = this.getResourceDespawnTicks(resourceId);
    if (despawnTicks <= 0) {
      console.log(
        `[Forestry] ℹ️ ${resourceId}: NOT timer-based (despawnTicks=0), using chance depletion`,
      );
      return;
    }

    let timer = this.resourceTimers.get(resourceId);
    if (!timer) {
      // Create timer structure (but don't start countdown yet - that's on first log)
      timer = {
        currentTicks: despawnTicks,
        maxTicks: despawnTicks,
        hasReceivedFirstLog: false,
        activeGatherers: new Set(),
        lastUpdateTick: tickNumber,
      };
      this.resourceTimers.set(resourceId, timer);
      console.log(
        `[Forestry] 🌲 ${resourceId}: Created timer structure (${despawnTicks} ticks max)`,
      );
    }

    timer.activeGatherers.add(playerId);
    console.log(
      `[Forestry] 👤+ ${resourceId}: Added gatherer ${playerId} ` +
        `(now ${timer.activeGatherers.size} total, timer=${timer.currentTicks}/${timer.maxTicks}, started=${timer.hasReceivedFirstLog})`,
    );
  }

  /**
   * Remove a player from a resource's active gatherers set.
   *
   * @param playerId - Player stopping gathering
   * @param resourceId - Resource that was being gathered
   */
  private removeActiveGatherer(
    playerId: PlayerID,
    resourceId: ResourceID,
  ): void {
    const timer = this.resourceTimers.get(resourceId);
    if (timer) {
      const hadPlayer = timer.activeGatherers.has(playerId);
      timer.activeGatherers.delete(playerId);
      if (hadPlayer) {
        console.log(
          `[Forestry] 👤- ${resourceId}: Removed gatherer ${playerId} ` +
            `(now ${timer.activeGatherers.size} total, timer=${timer.currentTicks}/${timer.maxTicks})` +
            (timer.activeGatherers.size === 0 && timer.hasReceivedFirstLog
              ? " - will start REGENERATING"
              : ""),
        );
      }
    }
  }

  /**
   * Handle receiving a log from a Forestry-timer resource.
   * Initializes the timer on first log and checks for depletion.
   *
   * @param playerId - Player who received the log
   * @param resourceId - Resource being gathered
   * @param tickNumber - Current tick
   * @returns true if resource should deplete, false otherwise
   */
  private handleForestryLog(
    playerId: PlayerID,
    resourceId: ResourceID,
    tickNumber: number,
  ): boolean {
    const timer = this.resourceTimers.get(resourceId);
    if (!timer) {
      console.log(
        `[Forestry] ⚠️ ${resourceId}: handleForestryLog called but no timer exists!`,
      );
      return false;
    }

    // First log starts the timer countdown
    if (!timer.hasReceivedFirstLog) {
      timer.hasReceivedFirstLog = true;
      timer.lastUpdateTick = tickNumber;
      console.log(
        `[Forestry] 🪵 ${resourceId}: FIRST LOG received by ${playerId}! ` +
          `Timer NOW ACTIVE: ${timer.currentTicks}/${timer.maxTicks} ticks`,
      );
    } else {
      console.log(
        `[Forestry] 🪵 ${resourceId}: Log received by ${playerId}, ` +
          `timer=${timer.currentTicks}/${timer.maxTicks}`,
      );
    }

    // Check if tree should deplete (timer at 0 AND player receives log)
    if (timer.currentTicks <= 0) {
      console.log(
        `[Forestry] 🌳💥 ${resourceId}: Timer=0 AND log received - TREE FALLS! ` +
          `(${timer.activeGatherers.size} gatherers were active)`,
      );
      // Clean up timer
      this.resourceTimers.delete(resourceId);
      return true; // Deplete the resource
    }

    return false; // Don't deplete yet
  }

  /**
   * Process resource respawns on tick (OSRS-accurate tick-based timing)
   * Replaces setTimeout-based respawn with deterministic tick counting
   */
  private processRespawns(tickNumber: number): void {
    const respawnedResources: ResourceID[] = [];

    for (const [resourceId, respawnTick] of this.respawnAtTick.entries()) {
      if (tickNumber >= respawnTick) {
        const resource = this.resources.get(resourceId);
        if (resource) {
          resource.isAvailable = true;
          resource.lastDepleted = 0;

          // Call entity respawn method if available
          const ent = this.world.entities.get(resourceId);
          // ResourceEntity has a respawn method - check if entity is ResourceEntity
          if (
            ent &&
            typeof (ent as unknown as { respawn?: () => void }).respawn ===
              "function"
          ) {
            (ent as unknown as { respawn: () => void }).respawn();
          }

          this.emitTypedEvent(EventType.RESOURCE_RESPAWNED, {
            resourceId: resourceId,
            position: resource.position,
          });
          this.sendNetworkMessage("resourceRespawned", {
            resourceId: resourceId,
            position: resource.position,
            depleted: false,
          });
        }
        respawnedResources.push(resourceId);
      }
    }

    // Clean up processed respawns
    for (const resourceId of respawnedResources) {
      this.respawnAtTick.delete(resourceId);
    }
  }

  /**
   * Initialize a fishing spot movement timer with random delay.
   * OSRS-ACCURACY: Fishing spots move periodically instead of depleting.
   */
  private initializeFishingSpotTimer(
    resourceId: ResourceID,
    position: { x: number; y: number; z: number },
  ): void {
    const currentTick = this.world.currentTick || 0;
    const { baseTicks, varianceTicks } = GATHERING_CONSTANTS.FISHING_SPOT_MOVE;

    // Random delay: baseTicks ± varianceTicks
    const randomVariance =
      Math.floor(Math.random() * varianceTicks * 2) - varianceTicks;
    const moveAtTick = currentTick + baseTicks + randomVariance;

    this.fishingSpotMoveTimers.set(resourceId, {
      moveAtTick,
      originalPosition: { ...position },
    });

    console.log(
      `[Fishing] Initialized spot ${resourceId} move timer: will move at tick ${moveAtTick} (${((moveAtTick - currentTick) * 0.6).toFixed(0)}s)`,
    );
  }

  /**
   * Process fishing spot movement on each tick.
   * OSRS-ACCURACY: Fishing spots don't deplete - they move to nearby tiles periodically.
   *
   * @see https://oldschool.runescape.wiki/w/Fishing
   */
  private processFishingSpotMovement(tickNumber: number): void {
    const spotsToMove: ResourceID[] = [];

    for (const [resourceId, timer] of this.fishingSpotMoveTimers.entries()) {
      if (tickNumber >= timer.moveAtTick) {
        spotsToMove.push(resourceId);
      }
    }

    for (const resourceId of spotsToMove) {
      this.relocateFishingSpot(resourceId, tickNumber);
    }
  }

  /**
   * Relocate a fishing spot to a nearby valid tile.
   * Cancels gathering for any players fishing at the old location.
   */
  private relocateFishingSpot(
    resourceId: ResourceID,
    currentTick: number,
  ): void {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      this.fishingSpotMoveTimers.delete(resourceId);
      return;
    }

    const timer = this.fishingSpotMoveTimers.get(resourceId);
    if (!timer) return;

    const { relocateRadius, relocateMinDistance } =
      GATHERING_CONSTANTS.FISHING_SPOT_MOVE;

    // Find a new position nearby
    const oldPos = resource.position;
    let newX = oldPos.x;
    let newZ = oldPos.z;

    // Try to find a valid new position (simple random offset within radius)
    // In a full implementation, this would check for water tiles, walkability, etc.
    for (let attempts = 0; attempts < 10; attempts++) {
      const angle = Math.random() * Math.PI * 2;
      const distance =
        relocateMinDistance +
        Math.random() * (relocateRadius - relocateMinDistance);
      const candidateX = oldPos.x + Math.cos(angle) * distance * 2; // 2 = tile size
      const candidateZ = oldPos.z + Math.sin(angle) * distance * 2;

      // Check distance from original
      const dx = candidateX - oldPos.x;
      const dz = candidateZ - oldPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist >= relocateMinDistance * 2) {
        newX = candidateX;
        newZ = candidateZ;
        break;
      }
    }

    // Cancel gathering for any players fishing at this spot
    for (const [playerId, session] of this.activeGathering.entries()) {
      if (session.resourceId === resourceId) {
        // Send message to player
        this.sendChat(
          playerId as unknown as string,
          "The fishing spot has moved!",
        );
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId: playerId as unknown as string,
          message: "The fishing spot has moved!",
          type: "info",
        });

        // Stop gathering
        this.stopGathering({ playerId: playerId as unknown as string });
      }
    }

    // Update resource position
    resource.position = { x: newX, y: oldPos.y, z: newZ };

    // Update entity position if it exists
    const entity = this.world.entities.get(resourceId);
    if (entity?.position) {
      entity.position.x = newX;
      entity.position.z = newZ;
    }

    // Broadcast position update to clients
    this.sendNetworkMessage("fishingSpotMoved", {
      resourceId: resourceId,
      oldPosition: oldPos,
      newPosition: resource.position,
    });

    console.log(
      `[Fishing] Spot ${resourceId} moved from (${oldPos.x.toFixed(1)}, ${oldPos.z.toFixed(1)}) to (${newX.toFixed(1)}, ${newZ.toFixed(1)})`,
    );

    // Reset timer for next movement
    this.initializeFishingSpotTimer(resourceId, resource.position);
  }

  /**
   * Process all active gathering sessions on each server tick (OSRS-accurate 600ms)
   *
   * Called by TickSystem at RESOURCES priority. Handles:
   * 1. Resource respawn checks (tick-based, not setTimeout)
   * 2. Proximity validation (server-authoritative position)
   * 3. Inventory capacity checks
   * 4. Success/failure rolls using cached success rate
   * 5. Drop rolling from manifest harvestYield
   * 6. XP awards and inventory updates
   * 7. Resource depletion with tick-based respawn scheduling
   *
   * Uses cached session data to avoid per-tick allocations (performance).
   * Sessions are cleaned up immediately when conditions fail.
   *
   * @param tickNumber - Current server tick number for timing calculations
   *
   * @emits INVENTORY_ITEM_ADDED on successful gather
   * @emits SKILLS_XP_GAINED on successful gather
   * @emits RESOURCE_GATHERING_STOPPED when session ends
   * @emits RESOURCE_DEPLETED when resource is exhausted
   */
  public processGatheringTick(tickNumber: number): void {
    // Process respawns first (tick-based)
    this.processRespawns(tickNumber);

    // OSRS-ACCURACY: Process fishing spot movement
    this.processFishingSpotMovement(tickNumber);

    // FORESTRY: Process resource timers (depletion/regeneration)
    this.processResourceTimers(tickNumber);

    // Process active gathering sessions
    const completedSessions: PlayerID[] = [];

    for (const [playerId, session] of this.activeGathering.entries()) {
      const resource = this.resources.get(session.resourceId);
      if (!resource?.isAvailable) {
        // Resource depleted, end session
        completedSessions.push(playerId);
        continue;
      }

      // Only process when it's time for the next attempt (tick-based)
      if (tickNumber < session.nextAttemptTick) continue;

      // OSRS-ACCURACY: Server-authoritative movement detection
      // In OSRS, ANY movement cancels gathering (weak queue action)
      // Position is fetched from world state, never from client payload
      const p = this.world.getPlayer?.(playerId);
      const playerPos =
        p && (p as { position?: { x: number; y: number; z: number } }).position
          ? (p as { position: { x: number; y: number; z: number } }).position
          : null;

      if (!playerPos) {
        // Player not found - cancel session
        this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
          playerId: playerId,
          resourceId: session.resourceId,
        });
        completedSessions.push(playerId);
        continue;
      }

      // Check if player moved from their starting position (OSRS: any movement cancels)
      const startPos = session.cachedStartPosition;
      const epsilon = GATHERING_CONSTANTS.POSITION_EPSILON;
      const movedX = Math.abs(playerPos.x - startPos.x) > epsilon;
      const movedZ = Math.abs(playerPos.z - startPos.z) > epsilon;

      if (movedX || movedZ) {
        // Player moved - cancel gathering (OSRS: weak queue cancelled on any movement)
        if (ResourceSystem.DEBUG_GATHERING) {
          console.log(
            `[ResourceSystem] Cancelling gather for ${playerId} - player moved from (${startPos.x.toFixed(2)}, ${startPos.z.toFixed(2)}) to (${playerPos.x.toFixed(2)}, ${playerPos.z.toFixed(2)})`,
          );
        }
        this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
          playerId: playerId,
          resourceId: session.resourceId,
        });
        this.resetGatheringEmote(playerId);
        completedSessions.push(playerId);
        continue;
      }

      // Secondary check: still within interaction range (safety net)
      if (
        calculateDistance(playerPos, resource.position) >
        GATHERING_CONSTANTS.DEFAULT_INTERACTION_RANGE
      ) {
        this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
          playerId: playerId,
          resourceId: session.resourceId,
        });
        this.resetGatheringEmote(playerId);
        completedSessions.push(playerId);
        continue;
      }

      // Inventory capacity guard - if full, stop session
      const inventorySystem = this.world.getSystem?.("inventory") as {
        getInventory?: (playerId: string) => {
          items?: unknown[];
          capacity?: number;
        };
      } | null;
      if (inventorySystem?.getInventory) {
        const inv = inventorySystem.getInventory(playerId);
        const capacity = (inv?.capacity as number) ?? 28;
        const count = Array.isArray(inv?.items) ? inv!.items!.length : 0;
        if (count >= capacity) {
          // PERFORMANCE: Use cached drops instead of resource.drops lookup
          const dropName =
            session.cachedDrops[0]?.itemName?.toLowerCase() || "items";
          this.emitTypedEvent(EventType.UI_MESSAGE, {
            playerId: playerId,
            message: `Your inventory is too full to hold any more ${dropName}.`,
            type: "warning",
          });
          this.emitTypedEvent(EventType.RESOURCE_GATHERING_STOPPED, {
            playerId: playerId,
            resourceId: session.resourceId,
          });
          completedSessions.push(playerId);
          continue;
        }
      }

      // PERFORMANCE: Use cached tuning data (zero allocation per tick)
      const tuned = session.cachedTuning;

      // Schedule next attempt (tick-based)
      session.nextAttemptTick = tickNumber + session.cycleTickInterval;
      session.attempts++;

      // PERFORMANCE: Use cached success rate (zero allocation per tick)
      const roll = Math.random();
      const isSuccessful = roll < session.cachedSuccessRate;

      // DEBUG: Log each roll result
      if (ResourceSystem.DEBUG_GATHERING) {
        const debug = session.debugInfo;
        console.log(
          `[Gathering DEBUG] Roll #${session.attempts}: ${(roll * 100).toFixed(1)}% vs ${(session.cachedSuccessRate * 100).toFixed(1)}% → ${isSuccessful ? "SUCCESS" : "FAIL"} ` +
            `(${debug?.skill ?? "?"} | ${debug?.variant ?? "?"} | ${debug?.toolTier ?? "no tool"})`,
        );
      }

      if (isSuccessful) {
        session.successes++;

        // PERFORMANCE: Roll against cached drop table (avoids resource lookup)
        const drop = this.rollDrop(session.cachedDrops);

        // Add item to inventory using manifest data
        this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
          playerId: playerId,
          item: {
            id: `inv_${playerId}_${Date.now()}_${drop.itemId}`,
            itemId: drop.itemId, // FROM MANIFEST
            quantity: drop.quantity, // FROM MANIFEST
            slot: -1,
            metadata: drop.stackable ? { stackable: true } : null,
          },
        });

        // Award XP from the rolled drop (fixes multi-drop XP bug)
        const xpAmount = drop.xpAmount;
        this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
          playerId: playerId,
          skill: resource.skillRequired,
          amount: xpAmount,
        });

        // Feedback using manifest data
        this.sendChat(
          playerId as unknown as string,
          `You receive ${drop.quantity}x ${drop.itemName}.`,
        );
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId: playerId,
          message: `You get some ${drop.itemName.toLowerCase()}. (+${xpAmount} ${resource.skillRequired} XP)`,
          type: "success",
        });

        // ===== DEPLETION CHECK =====
        // OSRS-ACCURACY: Use Forestry timer for higher-level trees, chance-based for mining/regular trees
        let shouldDeplete = false;
        let depletionMethod = "";

        if (this.usesTimerBasedDepletion(session.resourceId)) {
          // FORESTRY: Timer-based depletion (oak, willow, maple, yew, magic, redwood)
          // Timer started on first log, depletes when timer=0 AND player receives log
          depletionMethod = "forestry-timer";
          shouldDeplete = this.handleForestryLog(
            playerId,
            session.resourceId,
            tickNumber,
          );
        } else if (
          resource.type === "ore" ||
          resource.skillRequired === "mining"
        ) {
          // MINING: Chance-based depletion (1/8 for most rocks)
          depletionMethod = "mining-chance";
          const roll = Math.random();
          shouldDeplete = roll < GATHERING_CONSTANTS.MINING_DEPLETE_CHANCE;
          console.log(
            `[Forestry] ⛏️ ${session.resourceId}: Mining roll=${roll.toFixed(3)} vs ${GATHERING_CONSTANTS.MINING_DEPLETE_CHANCE} → ${shouldDeplete ? "DEPLETE" : "continue"}`,
          );
        } else if (
          resource.type === "fishing_spot" ||
          resource.skillRequired === "fishing"
        ) {
          // FISHING: Spots don't deplete (they move, handled elsewhere)
          depletionMethod = "fishing-no-deplete";
          shouldDeplete = false;
        } else {
          // REGULAR TREES & FALLBACK: Use manifest depleteChance (1/8 for regular trees)
          depletionMethod = "chance-based";
          const roll = Math.random();
          shouldDeplete = roll < tuned.depleteChance;
          console.log(
            `[Forestry] 🌲 ${session.resourceId}: Chance roll=${roll.toFixed(3)} vs ${tuned.depleteChance} → ${shouldDeplete ? "DEPLETE" : "continue"}`,
          );
        }

        if (shouldDeplete) {
          // Deplete resource and schedule tick-based respawn
          resource.isAvailable = false;
          resource.lastDepleted = Date.now();

          const resourceEntity = this.world.entities.get(session.resourceId);
          if (
            resourceEntity &&
            typeof (resourceEntity as unknown as { deplete?: () => void })
              .deplete === "function"
          ) {
            (resourceEntity as unknown as { deplete: () => void }).deplete();
          }

          this.emitTypedEvent(EventType.RESOURCE_DEPLETED, {
            resourceId: session.resourceId,
            position: resource.position,
          });
          // PERFORMANCE: Use cached resource name
          this.sendChat(
            playerId,
            `The ${session.cachedResourceName.toLowerCase()} is depleted.`,
          );
          this.sendNetworkMessage("resourceDepleted", {
            resourceId: session.resourceId,
            position: resource.position,
            depleted: true,
          });

          // Schedule tick-based respawn (replaces setTimeout)
          const respawnTick = tickNumber + tuned.respawnTicks;
          this.respawnAtTick.set(session.resourceId, respawnTick);

          // Emit completion for this session
          this.emitTypedEvent(EventType.RESOURCE_GATHERING_COMPLETED, {
            playerId: playerId,
            resourceId: session.resourceId,
            successful: true,
            skill: resource.skillRequired,
          });

          completedSessions.push(playerId);
        }
      } else {
        // Failure feedback (optional gentle info)
        // PERFORMANCE: Use cached resource name
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId: playerId,
          message: `You fail to gather from the ${session.cachedResourceName.toLowerCase()}.`,
          type: "info",
        });
      }
    }

    // Clean up completed sessions
    for (const playerId of completedSessions) {
      const session = this.activeGathering.get(playerId);
      if (session) {
        // FORESTRY: Remove from active gatherers (timer will regenerate if no other gatherers)
        this.removeActiveGatherer(playerId, session.resourceId);
      }
      this.activeGathering.delete(playerId);
      // Reset emote back to idle when gathering completes
      this.resetGatheringEmote(playerId);
    }
  }

  // Legacy completeGathering() method removed - continuous loop in updateGathering() handles all gathering now

  // ===== Tuning helpers (TICK-BASED for OSRS accuracy) =====
  // OSRS Reference: https://oldschool.runescape.wiki/w/Tick_manipulation
  // Standard woodcutting = 4 ticks (2.4 seconds) per attempt
  // Respawn times from OSRS Wiki: https://oldschool.runescape.wiki/w/Tree
  private getVariantTuning(variantKey: string): {
    levelRequired: number;
    xpPerLog: number;
    baseCycleTicks: number; // Ticks between attempts (600ms each)
    depleteChance: number;
    respawnTicks: number; // Respawn time in ticks
  } {
    // Load from manifest - fail fast if not found
    const manifestData = getExternalResource(variantKey);

    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    if (!manifestData.harvestYield || manifestData.harvestYield.length === 0) {
      throw new Error(
        `[ResourceSystem] Resource '${variantKey}' has no harvestYield defined in manifest.`,
      );
    }

    // Get XP from first harvest yield entry
    const xpPerLog = manifestData.harvestYield[0].xpAmount;
    return {
      levelRequired: manifestData.levelRequired,
      xpPerLog,
      baseCycleTicks: manifestData.baseCycleTicks,
      depleteChance: manifestData.depleteChance,
      respawnTicks: manifestData.respawnTicks,
    };
  }

  /**
   * Compute gathering cycle in ticks (OSRS-accurate, skill-specific)
   *
   * OSRS MECHANICS:
   * - Woodcutting: Fixed 4 ticks, tool doesn't affect frequency
   * - Mining: Tool determines tick interval (8 bronze → 3 rune/dragon)
   * - Fishing: Fixed 5 ticks, equipment doesn't affect frequency
   *
   * @param skill - The gathering skill (woodcutting, mining, fishing)
   * @param tuned - Resource tuning data from manifest
   * @param toolData - Tool data from tools.json manifest (may have rollTicks for mining)
   */
  private computeCycleTicks(
    skill: string,
    tuned: { levelRequired: number; baseCycleTicks: number },
    toolData: GatheringToolData | null,
  ): number {
    const mechanics =
      GATHERING_CONSTANTS.SKILL_MECHANICS[
        skill as keyof typeof GATHERING_CONSTANTS.SKILL_MECHANICS
      ];

    if (mechanics) {
      if (mechanics.type === "fixed-roll-variable-success") {
        // WOODCUTTING: Fixed roll frequency, tool affects success rate (handled elsewhere)
        // Always use the skill's base roll ticks (4 for woodcutting)
        return Math.max(
          GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS,
          mechanics.baseRollTicks,
        );
      }

      if (mechanics.type === "variable-roll-fixed-success") {
        // MINING: Tool tier determines roll frequency
        // Use rollTicks from tool data, or fall back to base (bronze = 8)
        const rollTicks = toolData?.rollTicks ?? mechanics.baseRollTicks;
        return Math.max(GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS, rollTicks);
      }

      if (mechanics.type === "fixed-roll-fixed-success") {
        // FISHING: Fixed roll frequency, equipment doesn't matter
        return Math.max(
          GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS,
          mechanics.baseRollTicks,
        );
      }
    }

    // Fallback to base ticks for unknown skills
    return Math.max(
      GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS,
      tuned.baseCycleTicks,
    );
  }

  /**
   * Convert ticks to milliseconds for client progress bar
   */
  private ticksToMs(ticks: number): number {
    return ticks * TICK_DURATION_MS;
  }

  /**
   * Compute success rate using OSRS's LERP interpolation formula.
   *
   * OSRS Formula: P(Level) = (1 + floor(low × (99 - L) / 98 + high × (L - 1) / 98 + 0.5)) / 256
   *
   * The low/high values come from skill-specific tables:
   * - Woodcutting: Varies by tree type AND axe tier
   * - Mining: Varies by ore type only (pickaxe doesn't affect success)
   * - Fishing: Varies by spot type only (equipment doesn't affect success)
   *
   * @param skillLevel - Player's current skill level (1-99)
   * @param skill - The gathering skill (woodcutting, mining, fishing)
   * @param resourceVariant - Resource type key (e.g., "tree_normal", "ore_copper")
   * @param toolTier - Tool tier for woodcutting (e.g., "bronze", "rune"), ignored for other skills
   * @returns Success probability (0-1)
   *
   * @see https://oldschool.runescape.wiki/w/Skilling_success_rate
   */
  private computeSuccessRate(
    skillLevel: number,
    skill: string,
    resourceVariant: string,
    toolTier: string | null,
  ): number {
    // Get low/high values based on skill type
    const { low, high } = this.getSuccessRateValues(
      skill,
      resourceVariant,
      toolTier,
    );

    // Apply OSRS LERP formula
    return this.lerpSuccessRate(low, high, skillLevel);
  }

  /**
   * Get low/high success rate values from the appropriate table.
   */
  private getSuccessRateValues(
    skill: string,
    resourceVariant: string,
    toolTier: string | null,
  ): { low: number; high: number } {
    if (skill === "woodcutting") {
      // Woodcutting: lookup by tree type AND axe tier
      const treeRates =
        GATHERING_CONSTANTS.WOODCUTTING_SUCCESS_RATES[
          resourceVariant as keyof typeof GATHERING_CONSTANTS.WOODCUTTING_SUCCESS_RATES
        ];
      if (treeRates) {
        const tier = toolTier || "bronze";
        const tierRates = treeRates[tier as keyof typeof treeRates];
        if (tierRates) {
          return tierRates;
        }
        // Unknown tier, fall back to bronze
        return treeRates.bronze;
      }
    }

    if (skill === "mining") {
      // Mining: lookup by ore type only (pickaxe doesn't affect success)
      const oreRates =
        GATHERING_CONSTANTS.MINING_SUCCESS_RATES[
          resourceVariant as keyof typeof GATHERING_CONSTANTS.MINING_SUCCESS_RATES
        ];
      if (oreRates) {
        return oreRates;
      }
    }

    if (skill === "fishing") {
      // Fishing: lookup by spot type only (equipment doesn't affect success)
      const fishRates =
        GATHERING_CONSTANTS.FISHING_SUCCESS_RATES[
          resourceVariant as keyof typeof GATHERING_CONSTANTS.FISHING_SUCCESS_RATES
        ];
      if (fishRates) {
        return fishRates;
      }
    }

    // Fallback to default values
    return GATHERING_CONSTANTS.DEFAULT_SUCCESS_RATE;
  }

  /**
   * OSRS linear interpolation formula for success rates.
   *
   * Formula: P(Level) = (1 + floor(low × (99 - L) / 98 + high × (L - 1) / 98 + 0.5)) / 256
   *
   * @param low - Success numerator at level 1 (x/256)
   * @param high - Success numerator at level 99 (x/256)
   * @param level - Current skill level (1-99)
   * @returns Success probability (0-1), clamped to valid range
   */
  private lerpSuccessRate(low: number, high: number, level: number): number {
    // Clamp level to valid range
    const clampedLevel = Math.min(99, Math.max(1, level));

    // OSRS interpolation formula
    const lowComponent = (low * (99 - clampedLevel)) / 98;
    const highComponent = (high * (clampedLevel - 1)) / 98;
    const numerator = 1 + Math.floor(lowComponent + highComponent + 0.5);

    // Convert to probability and clamp to [0, 1]
    return Math.min(1, Math.max(0, numerator / 256));
  }

  /**
   * Roll against harvestYield chances to determine drop
   * Respects chance values from manifest for multi-drop resources (e.g., fishing)
   * @param drops - Array of possible drops from manifest harvestYield
   * @returns The rolled drop with all manifest data (itemId, itemName, quantity, xpAmount, etc.)
   */
  private rollDrop(drops: ResourceDrop[]): ResourceDrop {
    if (drops.length === 0) {
      throw new Error(
        "[ResourceSystem] Resource has no drops defined in manifest",
      );
    }

    // Single drop - no roll needed
    if (drops.length === 1) {
      return drops[0];
    }

    // Roll against cumulative chances for multiple drops
    const roll = Math.random();
    let cumulative = 0;

    for (const drop of drops) {
      cumulative += drop.chance;
      if (roll < cumulative) {
        return drop;
      }
    }

    // Fallback to first drop if chances don't sum to 1.0
    return drops[0];
  }

  /**
   * SECURITY: Validate resource ID format to prevent injection attacks
   * Valid IDs are alphanumeric with underscores/hyphens, reasonable length
   */
  private isValidResourceId(resourceId: string): boolean {
    if (!resourceId || typeof resourceId !== "string") {
      return false;
    }
    if (resourceId.length > GATHERING_CONSTANTS.MAX_RESOURCE_ID_LENGTH) {
      return false;
    }
    // Only allow alphanumeric, underscores, hyphens, and periods
    if (!GATHERING_CONSTANTS.VALID_RESOURCE_ID_PATTERN.test(resourceId)) {
      return false;
    }
    return true;
  }

  /**
   * Get best tool for a skill from player inventory (manifest-driven)
   * Returns tool data from tools.json manifest
   *
   * Tools are loaded from packages/server/world/assets/manifests/tools.json
   * and sorted by priority (1 = best, higher = worse)
   *
   * @param playerId - Player to check inventory for
   * @param skill - Skill name (woodcutting, mining, fishing)
   */
  private getBestTool(
    playerId: string,
    skill: string,
  ): GatheringToolData | null {
    // Get tools for this skill from manifest, sorted by priority (best first)
    const skillTools = getExternalToolsForSkill(
      skill as "woodcutting" | "mining" | "fishing",
    );

    if (skillTools.length === 0) {
      // No tools defined for this skill in manifest
      return null;
    }

    const inventorySystem = this.world.getSystem?.("inventory") as {
      getInventory?: (playerId: string) => {
        items?: Array<{ itemId?: string }>;
      };
    } | null;

    const inv = inventorySystem?.getInventory?.(playerId);
    const items = inv?.items || [];

    // Build a set of item IDs for fast lookup
    const playerItemIds = new Set(
      items.map((item) => item?.itemId).filter(Boolean),
    );

    // Check tools in priority order (best first) - exact itemId match
    for (const tool of skillTools) {
      if (playerItemIds.has(tool.itemId)) {
        return tool;
      }
    }

    return null; // No tool found for this skill
  }

  /**
   * Extract tool category from toolRequired field
   * e.g., "bronze_hatchet" → "hatchet", "bronze_pickaxe" → "pickaxe"
   */
  private getToolCategory(toolRequired: string): string {
    const lowerTool = toolRequired.toLowerCase();

    // Handle common patterns (check pickaxe before axe since "pickaxe" contains "axe")
    if (lowerTool.includes("pickaxe") || lowerTool.includes("pick")) {
      return "pickaxe";
    }
    if (lowerTool.includes("hatchet") || lowerTool.includes("axe")) {
      return "hatchet";
    }
    if (
      lowerTool.includes("fishing") ||
      lowerTool.includes("net") ||
      lowerTool.includes("rod") ||
      lowerTool.includes("harpoon")
    ) {
      return "fishing";
    }

    // Fallback: take last segment after underscore
    const parts = toolRequired.split("_");
    return parts[parts.length - 1];
  }

  /**
   * Get display name for tool category
   */
  private getToolDisplayName(category: string): string {
    const names: Record<string, string> = {
      hatchet: "hatchet",
      pickaxe: "pickaxe",
      fishing: "fishing equipment",
    };
    return names[category] || category;
  }

  /**
   * Get the despawn ticks for a resource based on its type (Forestry system).
   * Returns 0 for resources that use chance-based depletion (regular trees, mining).
   *
   * @param resourceId - The resource ID to look up
   * @returns Despawn time in ticks, or 0 if chance-based
   */
  private getResourceDespawnTicks(resourceId: ResourceID): number {
    // Get the variant key (e.g., "tree_oak", "tree_willow")
    const variantKey = this.resourceVariants.get(resourceId) || "tree_normal";

    // Extract tree type from variant key (e.g., "tree_oak" -> "oak")
    const parts = variantKey.split("_");
    const resourceType = parts[0];
    const subType = parts.length > 1 ? parts[1] : "tree";

    // Only trees use the Forestry timer system
    if (resourceType !== "tree") {
      return 0; // Mining, fishing, etc. use chance-based or don't deplete
    }

    // Map subType to TREE_DESPAWN_TICKS key
    const treeType = subType === "normal" ? "tree" : subType;
    const despawnTicks =
      GATHERING_CONSTANTS.TREE_DESPAWN_TICKS[
        treeType as keyof typeof GATHERING_CONSTANTS.TREE_DESPAWN_TICKS
      ];

    return despawnTicks ?? 0;
  }

  /**
   * Check if a resource uses timer-based depletion (Forestry) vs chance-based.
   *
   * @param resourceId - The resource ID
   * @returns true if uses Forestry timer, false if chance-based
   */
  private usesTimerBasedDepletion(resourceId: ResourceID): boolean {
    return this.getResourceDespawnTicks(resourceId) > 0;
  }

  /**
   * Check if player has any tool matching the required category
   */
  private playerHasToolCategory(playerId: string, category: string): boolean {
    const inventorySystem = this.world.getSystem?.("inventory") as {
      getInventory?: (playerId: string) => {
        items?: Array<{ itemId?: string }>;
      };
    } | null;

    if (!inventorySystem?.getInventory) {
      return false;
    }

    const inv = inventorySystem.getInventory(playerId);
    const items = inv?.items || [];

    return items.some((item) => {
      if (!item?.itemId) return false;
      const itemId = item.itemId.toLowerCase();

      switch (category) {
        case "hatchet":
          return itemId.includes("hatchet") || itemId.includes("axe");
        case "pickaxe":
          return itemId.includes("pickaxe") || itemId.includes("pick");
        case "fishing":
          return (
            itemId.includes("fishing") ||
            itemId.includes("net") ||
            itemId.includes("rod") ||
            itemId.includes("harpoon")
          );
        default:
          return itemId.includes(category);
      }
    });
  }

  /**
   * Get all resources for testing/debugging
   */
  getAllResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get resources by type
   */
  getResourcesByType(type: string): Resource[] {
    return this.getAllResources().filter((resource) => resource.type === type);
  }

  /**
   * Get resource by ID
   */
  getResource(resourceId: string): Resource | undefined {
    return this.resources.get(createResourceID(resourceId));
  }

  /**
   * Cleanup when system is destroyed
   * Clears all active sessions, resources, and rate limits
   */
  destroy(): void {
    // Clear all active gathering sessions
    this.activeGathering.clear();

    // Clear tick-based respawn tracking
    this.respawnAtTick.clear();

    // FORESTRY: Clear resource timer tracking
    this.resourceTimers.clear();

    // OSRS-ACCURACY: Clear fishing spot movement timers
    this.fishingSpotMoveTimers.clear();

    // Clear all resource data
    this.resources.clear();
    this.manifestResourceIds.clear();

    // SECURITY: Clear rate limit tracking
    this.gatherRateLimits.clear();

    // Call parent cleanup (automatically clears all tracked timers, intervals, and listeners)
    super.destroy();
  }
}
