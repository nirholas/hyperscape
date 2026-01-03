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
import { TICK_DURATION_MS } from "../movement/TileSystem";
import { getExternalResource } from "../../../utils/ExternalAssetUtils";
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
 * - toolRequired: Tool validation (via unified TOOL_TIERS system)
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
 * ### Tool Tier System
 * Unified TOOL_TIERS structure supports all gathering skills:
 * - Woodcutting: Bronze → Dragon hatchet (0.7x - 1.0x cycle multiplier)
 * - Mining: Bronze → Dragon pickaxe (0.7x - 1.0x cycle multiplier)
 * - Fishing: Any equipment (1.0x - no speed tiers in OSRS)
 *
 * @see GATHERING_CONSTANTS for tunable values
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

  // ===== SECURITY: Rate limiting to prevent gather request spam =====
  private gatherRateLimits = new Map<PlayerID, number>();

  // ===== TOOL TIER SYSTEM (generalized for all gathering skills) =====
  /**
   * Tool tier definitions by skill
   * Defines speed multipliers for each tool tier (lower = faster)
   * Order matters: best tools first (checked in order until match found)
   */
  private static readonly TOOL_TIERS: Record<
    string,
    Array<{
      id: string;
      pattern: RegExp;
      levelRequired: number;
      cycleMultiplier: number;
    }>
  > = {
    woodcutting: [
      {
        id: "dragon_hatchet",
        pattern: /dragon.*(hatchet|axe)/i,
        levelRequired: 61,
        cycleMultiplier: 0.7,
      },
      {
        id: "rune_hatchet",
        pattern: /rune.*(hatchet|axe)/i,
        levelRequired: 41,
        cycleMultiplier: 0.78,
      },
      {
        id: "adamant_hatchet",
        pattern: /adamant.*(hatchet|axe)/i,
        levelRequired: 31,
        cycleMultiplier: 0.84,
      },
      {
        id: "mithril_hatchet",
        pattern: /mithril.*(hatchet|axe)/i,
        levelRequired: 21,
        cycleMultiplier: 0.88,
      },
      {
        id: "steel_hatchet",
        pattern: /steel.*(hatchet|axe)/i,
        levelRequired: 6,
        cycleMultiplier: 0.92,
      },
      {
        id: "iron_hatchet",
        pattern: /iron.*(hatchet|axe)/i,
        levelRequired: 1,
        cycleMultiplier: 0.96,
      },
      {
        id: "bronze_hatchet",
        pattern: /bronze.*(hatchet|axe)/i,
        levelRequired: 1,
        cycleMultiplier: 1.0,
      },
    ],
    mining: [
      {
        id: "dragon_pickaxe",
        pattern: /dragon.*(pickaxe|pick)/i,
        levelRequired: 61,
        cycleMultiplier: 0.7,
      },
      {
        id: "rune_pickaxe",
        pattern: /rune.*(pickaxe|pick)/i,
        levelRequired: 41,
        cycleMultiplier: 0.78,
      },
      {
        id: "adamant_pickaxe",
        pattern: /adamant.*(pickaxe|pick)/i,
        levelRequired: 31,
        cycleMultiplier: 0.84,
      },
      {
        id: "mithril_pickaxe",
        pattern: /mithril.*(pickaxe|pick)/i,
        levelRequired: 21,
        cycleMultiplier: 0.88,
      },
      {
        id: "steel_pickaxe",
        pattern: /steel.*(pickaxe|pick)/i,
        levelRequired: 6,
        cycleMultiplier: 0.92,
      },
      {
        id: "iron_pickaxe",
        pattern: /iron.*(pickaxe|pick)/i,
        levelRequired: 1,
        cycleMultiplier: 0.96,
      },
      {
        id: "bronze_pickaxe",
        pattern: /bronze.*(pickaxe|pick)/i,
        levelRequired: 1,
        cycleMultiplier: 1.0,
      },
    ],
    fishing: [
      // Fishing tools don't have speed tiers in OSRS - all equipment is same speed
      {
        id: "fishing_equipment",
        pattern: /(fishing|net|rod|harpoon)/i,
        levelRequired: 1,
        cycleMultiplier: 1.0,
      },
    ],
  };

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

      // Spawn actual ResourceEntity instance
      // Create proper quaternion for random Y-axis rotation
      const randomYRotation = Math.random() * Math.PI * 2;
      const quat = {
        x: 0,
        y: Math.sin(randomYRotation / 2),
        z: 0,
        w: Math.cos(randomYRotation / 2),
      };

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
    // e.g., "tree_normal", "tree_oak", "fishing_spot_normal"
    const variantKey =
      resourceType === "tree"
        ? spawnPoint.subType
          ? `tree_${spawnPoint.subType}`
          : "tree_normal"
        : `${resourceType}_normal`;

    // Get manifest data - fail fast if not found
    const manifestData = getExternalResource(variantKey);
    if (!manifestData) {
      throw new Error(
        `[ResourceSystem] Resource manifest not found for '${variantKey}'. ` +
          `Ensure resources.json is loaded and contains this resource type.`,
      );
    }

    // All values come from manifest - no hardcoding
    const resource: Resource = {
      id: `${type}_${position.x.toFixed(0)}_${position.z.toFixed(0)}`,
      type: resourceType,
      name: manifestData.name,
      position: {
        x: position.x,
        y: position.y,
        z: position.z,
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

      // Enforce tool level requirement using unified tool system
      const bestTool = this.getBestTool(data.playerId, resource.skillRequired);
      if (bestTool && bestTool.id !== "none") {
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

    // Start RS-like timed gathering session
    const actionName =
      resource.skillRequired === "woodcutting"
        ? "chopping"
        : resource.skillRequired === "fishing"
          ? "fishing"
          : "gathering";
    const resourceName = resource.name || resource.type.replace("_", " ");

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
    const toolMultiplier = toolInfo ? toolInfo.cycleMultiplier : 1.0;

    const cycleTickInterval = this.computeCycleTicks(
      skillLevel,
      tuned,
      toolMultiplier,
    );

    // PERFORMANCE: Pre-compute success rate to avoid per-tick calculation
    const successRate = this.computeSuccessRate(skillLevel, tuned);

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
    this.rotatePlayerToFaceResource(data.playerId, resource.position);

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
    });

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

    // Send feedback to player via chat and UI
    this.sendChat(data.playerId, `You start ${actionName}...`);
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId: data.playerId,
      message: `You start ${actionName} the ${resourceName.toLowerCase()}...`,
      type: "info",
    });

    // Broadcast toast to client via network
    this.sendNetworkMessage("showToast", {
      playerId: data.playerId,
      message: `You start ${actionName} the ${resourceName.toLowerCase()}...`,
      type: "info",
    });
  }

  private stopGathering(data: { playerId: string }): void {
    const playerId = createPlayerID(data.playerId);
    const session = this.activeGathering.get(playerId);
    if (session) {
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
   * @see https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/
   *
   * @param playerId - The player to set face target for
   * @param resourcePosition - The position of the resource to face
   */
  private rotatePlayerToFaceResource(
    playerId: string,
    resourcePosition: { x: number; y: number; z: number },
  ): void {
    // OSRS-ACCURACY: Use FaceDirectionManager for deferred tick-end processing
    // The manager will apply rotation at end of tick only if player didn't move
    const faceManager = (
      this.world as {
        faceDirectionManager?: {
          setFaceTarget: (playerId: string, x: number, z: number) => void;
        };
      }
    ).faceDirectionManager;

    if (faceManager) {
      faceManager.setFaceTarget(
        playerId,
        resourcePosition.x,
        resourcePosition.z,
      );
    }
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
      const isSuccessful = Math.random() < session.cachedSuccessRate;

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

        // Depletion roll
        if (Math.random() < tuned.depleteChance) {
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
   * Compute gathering cycle in ticks (OSRS-accurate)
   * Higher skill level = fewer ticks between attempts
   * Better tools = fewer ticks (via multiplier)
   */
  private computeCycleTicks(
    skillLevel: number,
    tuned: { levelRequired: number; baseCycleTicks: number },
    toolMultiplier: number = 1.0,
  ): number {
    const levelDelta = Math.max(0, skillLevel - tuned.levelRequired);
    // Up to ~30% faster at high level delta
    const levelFactor = Math.min(
      GATHERING_CONSTANTS.MAX_LEVEL_FACTOR,
      levelDelta * GATHERING_CONSTANTS.LEVEL_FACTOR_PER_LEVEL,
    );
    const baseTicks = Math.ceil(tuned.baseCycleTicks * (1 - levelFactor));
    // Apply tool multiplier (better tools = fewer ticks)
    const finalTicks = Math.floor(baseTicks * toolMultiplier);
    // Minimum ticks to prevent instant gathering
    return Math.max(GATHERING_CONSTANTS.MINIMUM_CYCLE_TICKS, finalTicks);
  }

  /**
   * Convert ticks to milliseconds for client progress bar
   */
  private ticksToMs(ticks: number): number {
    return ticks * TICK_DURATION_MS;
  }

  private computeSuccessRate(
    skillLevel: number,
    tuned: { levelRequired: number },
  ): number {
    // Base rate at requirement level, +bonus per level above, clamped to [min, max]
    const delta = skillLevel - tuned.levelRequired;
    const base =
      GATHERING_CONSTANTS.BASE_SUCCESS_RATE +
      Math.max(0, delta) * GATHERING_CONSTANTS.PER_LEVEL_SUCCESS_BONUS;
    return Math.max(
      GATHERING_CONSTANTS.MIN_SUCCESS_RATE,
      Math.min(GATHERING_CONSTANTS.MAX_SUCCESS_RATE, base),
    );
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
   * Get best tool for a skill from player inventory (unified tool tier system)
   * Returns tool info with level requirement and speed multiplier
   * @param playerId - Player to check inventory for
   * @param skill - Skill name (woodcutting, mining, fishing)
   */
  private getBestTool(
    playerId: string,
    skill: string,
  ): { id: string; levelRequired: number; cycleMultiplier: number } | null {
    const tiers = ResourceSystem.TOOL_TIERS[skill];
    if (!tiers) {
      // Unknown skill - no tool boost available
      return { id: "none", levelRequired: 1, cycleMultiplier: 1.0 };
    }

    const inventorySystem = this.world.getSystem?.("inventory") as {
      getInventory?: (playerId: string) => {
        items?: Array<{ itemId?: string }>;
      };
    } | null;

    const inv = inventorySystem?.getInventory?.(playerId);
    const items = inv?.items || [];

    // Check tiers in order (best tools first)
    for (const tier of tiers) {
      const hasTool = items.some(
        (item) => item?.itemId && tier.pattern.test(item.itemId),
      );
      if (hasTool) {
        return {
          id: tier.id,
          levelRequired: tier.levelRequired,
          cycleMultiplier: tier.cycleMultiplier,
        };
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

    // Clear all resource data
    this.resources.clear();
    this.manifestResourceIds.clear();

    // SECURITY: Clear rate limit tracking
    this.gatherRateLimits.clear();

    // Call parent cleanup (automatically clears all tracked timers, intervals, and listeners)
    super.destroy();
  }
}
