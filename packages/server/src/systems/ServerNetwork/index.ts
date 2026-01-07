/**
 * ServerNetwork - Authoritative multiplayer networking system
 *
 * This is the server-side networking system that manages all WebSocket connections,
 * player state synchronization, and authoritative game logic. It's the "brain" of
 * the multiplayer server.
 *
 * **Core Responsibilities**:
 * 1. **Connection Management** - Accept/validate WebSocket connections, handle disconnects
 * 2. **Authentication** - Verify Privy tokens or JWT, create/load user accounts
 * 3. **Character System** - Character selection, creation, and spawning
 * 4. **Player State** - Authoritative position, movement, combat, inventory
 * 5. **Event Broadcasting** - Relay player actions to other clients
 * 6. **Command Processing** - Handle slash commands (/move, /admin, etc.)
 * 7. **Position Validation** - Prevent cheating by validating player positions
 *
 * **Modular Architecture**:
 * This file now coordinates between specialized modules:
 * - authentication.ts - Privy and JWT authentication
 * - character-selection.ts - Character management and spawning
 * - movement.ts - Server-authoritative movement system
 * - socket-management.ts - WebSocket health monitoring
 * - broadcast.ts - Network message broadcasting
 * - save-manager.ts - Periodic state persistence
 * - position-validator.ts - Anti-cheat position validation
 * - event-bridge.ts - World event to network message bridge
 * - initialization.ts - Startup state loading
 * - connection-handler.ts - WebSocket connection flow
 * - handlers/* - Individual packet handlers (chat, combat, inventory, etc.)
 *
 * @see {@link ServerNetwork/authentication} for authentication logic
 * @see {@link ServerNetwork/movement} for movement system
 * @see {@link ServerNetwork/socket-management} for connection health
 * @see {@link ServerNetwork/broadcast} for message broadcasting
 * @see {@link ServerNetwork/connection-handler} for connection flow
 */

import type {
  ConnectionParams,
  NetworkWithSocket,
  NodeWebSocket,
  SpawnData,
  WorldOptions,
  SystemDatabase,
  ServerSocket,
} from "../../shared/types";
import {
  Socket,
  System,
  hasRole,
  isDatabaseInstance,
  World,
  EventType,
  CombatSystem,
  ResourceSystem,
  worldToTile,
  tilesWithinMeleeRange,
  getItem,
} from "@hyperscape/shared";

// PlayerDeathSystem type for tick processing (not exported from main index)
interface PlayerDeathSystemWithTick {
  processTick(currentTick: number): void;
}

// Import modular components
import {
  handleCharacterListRequest,
  handleCharacterCreate,
  handleCharacterSelected,
  handleEnterWorld,
} from "./character-selection";
import { MovementManager } from "./movement";
import { TileMovementManager } from "./tile-movement";
import { MobTileMovementManager } from "./mob-tile-movement";
import { ActionQueue } from "./action-queue";
import { TickSystem, TickPriority } from "../TickSystem";
import { SocketManager } from "./socket-management";
import { BroadcastManager } from "./broadcast";
import { SaveManager } from "./save-manager";
import { PositionValidator } from "./position-validator";
import { EventBridge } from "./event-bridge";
import { InitializationManager } from "./initialization";
import { ConnectionHandler } from "./connection-handler";
import { InteractionSessionManager } from "./InteractionSessionManager";
import { handleChatAdded } from "./handlers/chat";
import {
  handleAttackMob,
  handleAttackPlayer,
  handleChangeAttackStyle,
  handleSetAutoRetaliate,
} from "./handlers/combat";
import {
  handlePickupItem,
  handleDropItem,
  handleEquipItem,
  handleUnequipItem,
  handleMoveItem,
} from "./handlers/inventory";
import { handleResourceGather } from "./handlers/resources";
import {
  handleBankOpen,
  handleBankDeposit,
  handleBankWithdraw,
  handleBankDepositAll,
  handleBankDepositCoins,
  handleBankWithdrawCoins,
  handleBankClose,
  handleBankMove,
  handleBankCreateTab,
  handleBankDeleteTab,
  handleBankMoveToTab,
  handleBankWithdrawPlaceholder,
  handleBankReleasePlaceholder,
  handleBankReleaseAllPlaceholders,
  handleBankToggleAlwaysPlaceholder,
  handleBankWithdrawToEquipment,
  handleBankDepositEquipment,
  handleBankDepositAllEquipment,
} from "./handlers/bank";
import {
  handleEntityModified,
  handleEntityEvent,
  handleEntityRemoved,
  handleSettings,
} from "./handlers/entities";
import { handleCommand } from "./handlers/commands";
import {
  handleStoreOpen,
  handleStoreBuy,
  handleStoreSell,
  handleStoreClose,
} from "./handlers/store";
import {
  handleDialogueResponse,
  handleDialogueClose,
} from "./handlers/dialogue";
import { PendingAttackManager } from "./PendingAttackManager";
import { PendingGatherManager } from "./PendingGatherManager";
import { PendingCookManager } from "./PendingCookManager";
import { FollowManager } from "./FollowManager";
import { FaceDirectionManager } from "./FaceDirectionManager";
import { handleFollowPlayer } from "./handlers/player";

const defaultSpawn = '{ "position": [0, 50, 0], "quaternion": [0, 0, 0, 1] }';

type QueueItem = [ServerSocket, string, unknown];

/**
 * Network message handler function type
 */
type NetworkHandler = (
  socket: ServerSocket,
  data: unknown,
) => void | Promise<void>;

/**
 * ServerNetwork - Authoritative multiplayer networking system
 *
 * Coordinates between specialized modules to handle all server networking.
 * This refactored version delegates most logic to focused modules while
 * maintaining the same external API.
 */
export class ServerNetwork extends System implements NetworkWithSocket {
  /** Unique network ID (incremented for each connection) */
  id: number;

  /** Counter for assigning network IDs */
  ids: number;

  /** Map of all active WebSocket connections by socket ID */
  sockets: Map<string, ServerSocket>;

  /** Flag indicating this is the server network (true) */
  isServer: boolean;

  /** Flag indicating this is a client network (false) */
  isClient: boolean;

  /** Queue of outgoing messages to be batched and sent */
  queue: QueueItem[];

  /** Database instance for persistence operations */
  db!: SystemDatabase;

  /** Default spawn point for new players */
  spawn: SpawnData;

  /** Maximum upload file size in bytes */
  maxUploadSize: number;

  /** Handler method registry */
  private handlers: Record<string, NetworkHandler> = {};

  /** Agent goal storage (characterId -> goal data) for dashboard display */
  static agentGoals: Map<string, unknown> = new Map();

  /** Agent available goals storage (characterId -> available goals) for dashboard selection */
  static agentAvailableGoals: Map<string, unknown[]> = new Map();

  /** Character ID to socket mapping for sending goal overrides */
  static characterSockets: Map<string, ServerSocket> = new Map();

  /** Modular managers */
  private movementManager!: MovementManager;
  private tileMovementManager!: TileMovementManager;
  private mobTileMovementManager!: MobTileMovementManager;
  private pendingAttackManager!: PendingAttackManager;
  private pendingGatherManager!: PendingGatherManager;
  private pendingCookManager!: PendingCookManager;
  private followManager!: FollowManager;
  private actionQueue!: ActionQueue;
  private tickSystem!: TickSystem;
  private socketManager!: SocketManager;
  private broadcastManager!: BroadcastManager;
  private saveManager!: SaveManager;
  private positionValidator!: PositionValidator;
  private eventBridge!: EventBridge;
  private initializationManager!: InitializationManager;
  private connectionHandler!: ConnectionHandler;
  private interactionSessionManager!: InteractionSessionManager;
  private faceDirectionManager!: FaceDirectionManager;

  /** Time sync state - broadcast world time every 5 seconds for day/night sync */
  private worldTimeSyncAccumulator = 0;
  private readonly WORLD_TIME_SYNC_INTERVAL = 5; // seconds

  // === Phase 5.1: Rate Limiting for Processing Requests ===
  /** Rate limiter for processing requests (playerId -> lastRequestTime) */
  private readonly processingRateLimiter = new Map<string, number>();
  /** Minimum time between processing requests (500ms) */
  private readonly PROCESSING_COOLDOWN_MS = 500;

  constructor(world: World) {
    super(world);
    this.id = 0;
    this.ids = -1;
    this.sockets = new Map();
    this.isServer = true;
    this.isClient = false;
    this.queue = [];
    this.spawn = JSON.parse(defaultSpawn);
    this.maxUploadSize = 50; // Default 50MB upload limit

    // Initialize managers will happen in init() after world.db is set
  }

  // === Phase 5.1: Rate Limiting Helper ===

  /**
   * Check if a player can make a processing request (rate limiting).
   * Prevents spam by requiring PROCESSING_COOLDOWN_MS between requests.
   *
   * @param playerId - The player ID to check
   * @returns true if request is allowed, false if rate limited
   */
  private canProcessRequest(playerId: string): boolean {
    const now = Date.now();
    const lastRequest = this.processingRateLimiter.get(playerId) ?? 0;

    if (now - lastRequest < this.PROCESSING_COOLDOWN_MS) {
      console.warn(
        `[ServerNetwork] Rate limited processing request from ${playerId}`,
      );
      return false;
    }

    this.processingRateLimiter.set(playerId, now);
    return true;
  }

  /**
   * Initialize managers after database is available
   *
   * Managers need access to world and database, so we initialize them
   * after world.init() sets world.db.
   */
  private initializeManagers(): void {
    // Broadcast manager (needed by many others)
    this.broadcastManager = new BroadcastManager(this.sockets);

    // Legacy movement manager (for compatibility)
    this.movementManager = new MovementManager(
      this.world,
      this.broadcastManager.sendToAll.bind(this.broadcastManager),
    );

    // Tick system for RuneScape-style 600ms ticks
    this.tickSystem = new TickSystem();

    // Tile-based movement manager (RuneScape-style)
    this.tileMovementManager = new TileMovementManager(
      this.world,
      this.broadcastManager.sendToAll.bind(this.broadcastManager),
    );

    // Action queue for OSRS-style input processing
    this.actionQueue = new ActionQueue();

    // Set up action queue handlers - these execute the actual game logic
    this.actionQueue.setHandlers({
      movement: (socket, data) => {
        this.tileMovementManager.handleMoveRequest(socket, data);
      },
      combat: (socket, data) => {
        // Combat actions trigger the combat system
        const playerEntity = socket.player;
        if (!playerEntity) return;

        const payload = data as { mobId?: string; targetId?: string };
        const targetId = payload.mobId || payload.targetId;
        if (!targetId) return;
        this.world.emit(EventType.COMBAT_ATTACK_REQUEST, {
          playerId: playerEntity.id,
          targetId,
          attackerType: "player",
          targetType: "mob",
          attackType: "melee",
        });
      },
      interaction: (socket, data) => {
        // Generic interaction handler - can be extended for object/NPC interactions
        console.log(
          `[ActionQueue] Interaction from ${socket.player?.id}:`,
          data,
        );
      },
    });

    // FIRST: Update world.currentTick on each tick so all systems can read it
    // This must run before any other tick processing (INPUT is earliest priority)
    // Mobs use this to run AI only once per tick instead of every frame
    this.tickSystem.onTick((tickNumber) => {
      this.world.currentTick = tickNumber;
    }, TickPriority.INPUT);

    // Register action queue to process inputs at INPUT priority
    this.tickSystem.onTick((tickNumber) => {
      this.actionQueue.processTick(tickNumber);
    }, TickPriority.INPUT);

    // Register tile movement to run on each tick (after inputs)
    this.tickSystem.onTick((tickNumber) => {
      this.tileMovementManager.onTick(tickNumber);
    }, TickPriority.MOVEMENT);

    // Mob tile-based movement manager (same tick system as players)
    this.mobTileMovementManager = new MobTileMovementManager(
      this.world,
      this.broadcastManager.sendToAll.bind(this.broadcastManager),
    );

    // Register mob tile movement to run on each tick (same priority as player movement)
    this.tickSystem.onTick((tickNumber) => {
      this.mobTileMovementManager.onTick(tickNumber);
    }, TickPriority.MOVEMENT);

    // Pending attack manager - server-authoritative tracking of "walk to mob and attack" actions
    // This replaces unreliable client-side tracking with 100% reliable server-side logic
    this.pendingAttackManager = new PendingAttackManager(
      this.world,
      this.tileMovementManager,
      // getMobPosition helper - get from world entity (mobs spawned via MobNPCSpawnerSystem with gdd_* IDs)
      (mobId: string) => {
        const mobEntity = this.world.entities.get(mobId) as {
          position?: { x: number; y: number; z: number };
        } | null;
        return mobEntity?.position ?? null;
      },
      // isMobAlive helper - get from world entity config
      (mobId: string) => {
        const mobEntity = this.world.entities.get(mobId) as {
          config?: { currentHealth?: number };
        } | null;
        return mobEntity ? (mobEntity.config?.currentHealth ?? 0) > 0 : false;
      },
    );

    // Register pending attack processing BEFORE combat (so attacks can initiate combat this tick)
    this.tickSystem.onTick((tickNumber) => {
      this.pendingAttackManager.processTick(tickNumber);
    }, TickPriority.MOVEMENT); // Same priority as movement, runs after player moves

    // Pending gather manager - server-authoritative tracking of "walk to resource and gather" actions
    // Uses same approach as PendingAttackManager: movePlayerToward with meleeRange=1 for cardinal-only
    this.pendingGatherManager = new PendingGatherManager(
      this.world,
      this.tileMovementManager,
      (name, data) => this.broadcastManager.sendToAll(name, data),
    );

    // Register pending gather processing (same priority as movement)
    this.tickSystem.onTick((tickNumber) => {
      this.pendingGatherManager.processTick(tickNumber);
    }, TickPriority.MOVEMENT);

    // Pending cook manager - server-authoritative tracking of "walk to fire and cook" actions
    // Uses same approach as PendingGatherManager: movePlayerToward with meleeRange=1 for cardinal-only
    // Phase 4.2: FireRegistry is now injected via constructor (DIP)
    const processingSystem = this.world.getSystem("processing") as {
      getActiveFires: () => Map<
        string,
        {
          id: string;
          position: { x: number; y: number; z: number };
          isActive: boolean;
          playerId: string;
        }
      >;
    };
    this.pendingCookManager = new PendingCookManager(
      this.world,
      this.tileMovementManager,
      processingSystem,
    );

    // Register pending cook processing (same priority as movement)
    this.tickSystem.onTick((tickNumber) => {
      this.pendingCookManager.processTick(tickNumber);
    }, TickPriority.MOVEMENT);

    // Follow manager - server-authoritative tracking of players following other players
    // OSRS-style: follower walks behind leader, re-paths when leader moves
    this.followManager = new FollowManager(
      this.world,
      this.tileMovementManager,
    );

    // Register follow processing (same priority as movement)
    // Pass tick number for OSRS-accurate 1-tick delay tracking
    this.tickSystem.onTick((tickNumber) => {
      this.followManager.processTick(tickNumber);
    }, TickPriority.MOVEMENT);

    // OSRS-accurate face direction manager
    // Defers rotation until end of tick, only applies if player didn't move
    // @see https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/
    this.faceDirectionManager = new FaceDirectionManager(this.world);

    // Wire up the send function so FaceDirectionManager can broadcast rotation changes
    this.faceDirectionManager.setSendFunction((name, data) =>
      this.broadcastManager.sendToAll(name, data),
    );

    // Register face direction processing - runs AFTER all movement at COMBAT priority
    // OSRS: Face direction mask is processed at end of tick if entity didn't move
    this.tickSystem.onTick(() => {
      // Get all player IDs from the players map (not items)
      const entitiesSystem = this.world.entities as {
        players?: Map<string, { id: string }>;
      } | null;

      if (!entitiesSystem?.players) {
        return;
      }

      const playerIds: string[] = [];
      for (const [playerId] of entitiesSystem.players) {
        playerIds.push(playerId);
      }

      if (playerIds.length > 0) {
        this.faceDirectionManager.processFaceDirection(playerIds);
      }
    }, TickPriority.COMBAT);

    // Reset movement flags at the START of each tick (INPUT priority)
    this.tickSystem.onTick(() => {
      this.faceDirectionManager.resetMovementFlags();
    }, TickPriority.INPUT);

    // Store face direction manager on world so ResourceSystem can access it
    (
      this.world as { faceDirectionManager?: FaceDirectionManager }
    ).faceDirectionManager = this.faceDirectionManager;

    // Register combat system to process on each tick (after movement, before AI)
    // This is OSRS-accurate: combat runs on the game tick, not per-frame
    this.tickSystem.onTick((tickNumber) => {
      const combatSystem = this.world.getSystem(
        "combat",
      ) as CombatSystem | null;
      if (combatSystem) {
        combatSystem.processCombatTick(tickNumber);
      }
    }, TickPriority.COMBAT);

    // Register death system to process on each tick (after combat)
    // Handles gravestone expiration and ground item despawn (OSRS-accurate tick-based timing)
    this.tickSystem.onTick((tickNumber) => {
      const playerDeathSystem = this.world.getSystem(
        "player-death",
      ) as unknown as PlayerDeathSystemWithTick | undefined;
      if (
        playerDeathSystem &&
        typeof playerDeathSystem.processTick === "function"
      ) {
        playerDeathSystem.processTick(tickNumber);
      }
    }, TickPriority.COMBAT); // Same priority as combat (after movement)

    // Register loot system to process on each tick (after combat)
    // Handles mob corpse despawn (OSRS-accurate tick-based timing)
    this.tickSystem.onTick((tickNumber) => {
      const lootSystem = this.world.getSystem("loot") as unknown as
        | PlayerDeathSystemWithTick
        | undefined;
      if (lootSystem && typeof lootSystem.processTick === "function") {
        lootSystem.processTick(tickNumber);
      }
    }, TickPriority.COMBAT); // Same priority as combat (after movement)

    // Register resource gathering system to process on each tick (after combat)
    // OSRS-accurate: Woodcutting attempts every 4 ticks (2.4 seconds)
    this.tickSystem.onTick((tickNumber) => {
      const resourceSystem = this.world.getSystem(
        "resource",
      ) as ResourceSystem | null;
      if (
        resourceSystem &&
        typeof resourceSystem.processGatheringTick === "function"
      ) {
        resourceSystem.processGatheringTick(tickNumber);
      }
    }, TickPriority.RESOURCES);

    // Socket manager
    this.socketManager = new SocketManager(
      this.sockets,
      this.world,
      this.broadcastManager.sendToAll.bind(this.broadcastManager),
    );

    // Clean up player state when player disconnects (prevents memory leak)
    this.world.on(EventType.PLAYER_LEFT, (event: { playerId: string }) => {
      this.tileMovementManager.cleanup(event.playerId);
      this.actionQueue.cleanup(event.playerId);
    });

    // Sync tile position when player respawns at spawn point
    // CRITICAL: Without this, TileMovementManager has stale tile position from death location
    // and paths would be calculated from wrong starting tile
    this.world.on(EventType.PLAYER_RESPAWNED, (eventData) => {
      const event = eventData as {
        playerId: string;
        spawnPosition: { x: number; y: number; z: number };
      };
      if (event.playerId && event.spawnPosition) {
        this.tileMovementManager.syncPlayerPosition(
          event.playerId,
          event.spawnPosition,
        );
        // Also clear any pending actions from before death
        this.actionQueue.cleanup(event.playerId);
        console.log(
          `[ServerNetwork] Synced tile position for respawned player ${event.playerId} at (${event.spawnPosition.x}, ${event.spawnPosition.z})`,
        );
      }
    });

    // Handle mob tile movement requests from MobEntity AI
    this.world.on(EventType.MOB_NPC_MOVE_REQUEST, (event) => {
      const moveEvent = event as {
        mobId: string;
        targetPos: { x: number; y: number; z: number };
        targetEntityId?: string;
        tilesPerTick?: number;
      };
      this.mobTileMovementManager.requestMoveTo(
        moveEvent.mobId,
        moveEvent.targetPos,
        moveEvent.targetEntityId || null,
        moveEvent.tilesPerTick,
      );
    });

    // Initialize mob tile movement state on spawn
    // This ensures mobs have proper tile state from the moment they're created
    this.world.on(EventType.MOB_NPC_SPAWNED, (event) => {
      const spawnEvent = event as {
        mobId: string;
        mobType: string;
        position: { x: number; y: number; z: number };
      };
      this.mobTileMovementManager.initializeMob(
        spawnEvent.mobId,
        spawnEvent.position,
        2, // Default walk speed: 2 tiles per tick
      );
    });

    // Clean up mob tile movement state on mob death
    // This immediately clears stale tile state when mob dies
    this.world.on(EventType.NPC_DIED, (event) => {
      const diedEvent = event as { mobId: string };
      this.mobTileMovementManager.cleanup(diedEvent.mobId);
    });

    // Clean up mob tile movement state on mob despawn (backup cleanup)
    this.world.on(EventType.MOB_NPC_DESPAWNED, (event) => {
      const despawnEvent = event as { mobId: string };
      this.mobTileMovementManager.cleanup(despawnEvent.mobId);
    });

    // CRITICAL: Reinitialize mob tile state on respawn
    // Without this, the mob's tile state has stale currentTile from death location
    // causing teleportation when the mob starts moving again
    this.world.on(EventType.MOB_NPC_RESPAWNED, (event) => {
      const respawnEvent = event as {
        mobId: string;
        position: { x: number; y: number; z: number };
      };
      // Clear old state and initialize at new spawn position
      this.mobTileMovementManager.cleanup(respawnEvent.mobId);
      this.mobTileMovementManager.initializeMob(
        respawnEvent.mobId,
        respawnEvent.position,
        2, // Default walk speed: 2 tiles per tick
      );
    });

    // Combat follow: When player is in combat but out of range, move toward target
    // OSRS-style: "if the clicked entity is an NPC or player, a new pathfinding attempt
    // will be started every tick, until a target tile can be found"
    this.world.on(EventType.COMBAT_FOLLOW_TARGET, (event) => {
      const followEvent = event as {
        playerId: string;
        targetId: string;
        targetPosition: { x: number; y: number; z: number };
        meleeRange?: number;
      };
      // Use OSRS-style melee pathfinding (cardinal-only for range 1)
      this.tileMovementManager.movePlayerToward(
        followEvent.playerId,
        followEvent.targetPosition,
        true, // Run toward target
        followEvent.meleeRange ?? 1, // Default to standard melee range
      );
    });

    // OSRS-accurate: Cancel pending attack when player clicks elsewhere
    this.world.on(EventType.PENDING_ATTACK_CANCEL, (event) => {
      const { playerId } = event as { playerId: string };
      this.pendingAttackManager.cancelPendingAttack(playerId);
    });

    // OSRS-accurate: Move player to adjacent tile after lighting fire
    // Priority: West → East → South → North (handled by ProcessingSystem)
    // Uses proper tile movement for smooth walking animation (not teleport)
    this.world.on(EventType.FIREMAKING_MOVE_REQUEST, (event) => {
      const { playerId, position } = event as {
        playerId: string;
        position: { x: number; y: number; z: number };
      };

      console.log(
        `[ServerNetwork] 🔥 Firemaking move request for ${playerId} to (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`,
      );

      // Get player entity
      const socket = this.broadcastManager.getPlayerSocket(playerId);
      const player = socket?.player;
      if (!player) {
        console.warn(
          `[ServerNetwork] Cannot find player for firemaking move: ${playerId}`,
        );
        return;
      }

      // OSRS-accurate: Use tile movement system for smooth walking animation
      // Walking (not running) to adjacent tile, meleeRange=0 means go directly to tile
      // This sends tileMovementStart packet for smooth client interpolation
      this.tileMovementManager.movePlayerToward(
        playerId,
        position,
        false, // OSRS firemaking step is a walk, not a run
        0, // meleeRange=0 = non-combat, go directly to the tile
      );
    });

    // Handle player emote changes from ProcessingSystem (firemaking, cooking)
    this.world.on(EventType.PLAYER_SET_EMOTE, (event) => {
      const { playerId, emote } = event as {
        playerId: string;
        emote: string;
      };

      // Broadcast emote change to all clients
      this.broadcastManager.sendToAll("entityModified", {
        id: playerId,
        changes: {
          e: emote,
        },
      });
    });

    // Save manager
    this.saveManager = new SaveManager(this.world, this.db);

    // Position validator
    this.positionValidator = new PositionValidator(
      this.world,
      this.sockets,
      this.broadcastManager,
    );

    // Event bridge
    this.eventBridge = new EventBridge(this.world, this.broadcastManager);

    // Interaction session manager (server-authoritative UI sessions)
    this.interactionSessionManager = new InteractionSessionManager(
      this.world,
      this.broadcastManager,
    );
    this.interactionSessionManager.initialize(this.tickSystem);

    // Store session manager on world so handlers can access it (Phase 6: single source of truth)
    // This replaces the previous pattern of storing entity IDs on socket properties
    (
      this.world as { interactionSessionManager?: InteractionSessionManager }
    ).interactionSessionManager = this.interactionSessionManager;

    // Clean up interaction sessions, pending attacks, follows, gathers, and cooks when player disconnects
    this.world.on(EventType.PLAYER_LEFT, (event: { playerId: string }) => {
      this.interactionSessionManager.onPlayerDisconnect(event.playerId);
      this.pendingAttackManager.onPlayerDisconnect(event.playerId);
      this.followManager.onPlayerDisconnect(event.playerId);
      this.pendingGatherManager.onPlayerDisconnect(event.playerId);
      this.pendingCookManager.onPlayerDisconnect(event.playerId);
    });

    // Initialization manager
    this.initializationManager = new InitializationManager(this.world, this.db);

    // Connection handler
    this.connectionHandler = new ConnectionHandler(
      this.world,
      this.sockets,
      this.broadcastManager,
      () => this.spawn,
      this.db,
    );

    // Register handlers
    this.registerHandlers();
  }

  /**
   * Register all packet handlers
   *
   * Sets up the handler registry with delegates to modular handlers.
   */
  private registerHandlers(): void {
    // Character selection handlers
    this.handlers["characterSelected"] = (socket, data) =>
      handleCharacterSelected(
        socket,
        data,
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );

    this.handlers["enterWorld"] = (socket, data) =>
      handleEnterWorld(
        socket,
        data,
        this.world,
        this.spawn,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );

    this.handlers["onChatAdded"] = (socket, data) =>
      handleChatAdded(
        socket,
        data,
        this.world,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
      );

    this.handlers["onCommand"] = (socket, data) =>
      handleCommand(
        socket,
        data,
        this.world,
        this.db,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
        this.isBuilder.bind(this),
      );

    this.handlers["onEntityModified"] = (socket, data) =>
      handleEntityModified(
        socket,
        data,
        this.world,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
      );

    this.handlers["onEntityEvent"] = (socket, data) =>
      handleEntityEvent(socket, data, this.world);

    this.handlers["onEntityRemoved"] = (socket, data) =>
      handleEntityRemoved(socket, data);

    this.handlers["onSettingsModified"] = (socket, data) =>
      handleSettings(socket, data);

    // SERVER-AUTHORITATIVE: Resource interaction - uses PendingGatherManager
    // Same approach as combat: movePlayerToward() with meleeRange=1 for cardinal-only positioning
    this.handlers["onResourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      const payload = data as { resourceId?: string; runMode?: boolean };
      if (!payload.resourceId) return;

      // Use PendingGatherManager (like PendingAttackManager for combat)
      // Pass runMode from client to ensure player runs/walks based on their preference
      this.pendingGatherManager.queuePendingGather(
        player.id,
        payload.resourceId,
        this.tickSystem.getCurrentTick(),
        payload.runMode,
      );
    };

    // Legacy: Direct gather (used after server has pathed player)
    this.handlers["onResourceGather"] = (socket, data) =>
      handleResourceGather(socket, data, this.world);

    // SERVER-AUTHORITATIVE: Cooking source interaction - uses PendingCookManager
    // Same approach as resource gathering: movePlayerToward() with meleeRange=1 for cardinal-only positioning
    this.handlers["onCookingSourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      const payload = data as {
        sourceId?: string;
        sourceType?: string;
        position?: [number, number, number];
        runMode?: boolean;
      };
      if (!payload.sourceId || !payload.position) return;

      // Use PendingCookManager (like PendingGatherManager for resources)
      // Pass runMode from client to ensure player runs/walks based on their preference
      this.pendingCookManager.queuePendingCook(
        player.id,
        payload.sourceId,
        {
          x: payload.position[0],
          y: payload.position[1],
          z: payload.position[2],
        },
        this.tickSystem.getCurrentTick(),
        payload.runMode,
      );
    };

    // Firemaking - use tinderbox on logs to create fire
    this.handlers["onFiremakingRequest"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Phase 5.1: Rate limiting
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        logsId?: string;
        logsSlot?: number;
        tinderboxSlot?: number;
      };

      if (
        !payload.logsId ||
        payload.logsSlot === undefined ||
        payload.tinderboxSlot === undefined
      ) {
        console.log("[ServerNetwork] Invalid firemaking request:", payload);
        return;
      }

      // Phase 5.2: Validate inventory slot bounds (OSRS inventory is 28 slots: 0-27)
      if (
        payload.logsSlot < 0 ||
        payload.logsSlot > 27 ||
        payload.tinderboxSlot < 0 ||
        payload.tinderboxSlot > 27
      ) {
        console.warn(
          `[ServerNetwork] Invalid slot bounds in firemaking request from ${player.id}`,
        );
        return;
      }

      console.log(
        "[ServerNetwork] 🔥 Firemaking request from",
        player.id,
        ":",
        payload,
      );

      // Emit event for ProcessingSystem to handle
      this.world.emit(EventType.PROCESSING_FIREMAKING_REQUEST, {
        playerId: player.id,
        logsId: payload.logsId,
        logsSlot: payload.logsSlot,
        tinderboxSlot: payload.tinderboxSlot,
      });
    };

    // Cooking - use raw food on fire/range
    // SERVER-AUTHORITATIVE: Uses PendingCookManager for distance checking (like woodcutting)
    this.handlers["onCookingRequest"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Phase 5.1: Rate limiting
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        rawFoodId?: string;
        rawFoodSlot?: number;
        fireId?: string;
      };

      if (
        !payload.rawFoodId ||
        payload.rawFoodSlot === undefined ||
        !payload.fireId
      ) {
        console.log("[ServerNetwork] Invalid cooking request:", payload);
        return;
      }

      // Phase 5.2: Validate inventory slot bounds (OSRS inventory is 28 slots: 0-27)
      // Note: -1 is allowed as it means "find first cookable item"
      if (payload.rawFoodSlot < -1 || payload.rawFoodSlot > 27) {
        console.warn(
          `[ServerNetwork] Invalid slot bounds in cooking request from ${player.id}`,
        );
        return;
      }

      console.log(
        "[ServerNetwork] 🍳 Cooking request from",
        player.id,
        "- routing through PendingCookManager for distance check",
      );

      // Use PendingCookManager for distance checking (like PendingGatherManager for woodcutting)
      // Fire position will be looked up server-side from ProcessingSystem
      this.pendingCookManager.queuePendingCook(
        player.id,
        payload.fireId,
        { x: 0, y: 0, z: 0 }, // Position ignored - server looks up from ProcessingSystem
        this.tickSystem.getCurrentTick(),
        undefined, // runMode - use server default
        payload.rawFoodSlot, // Pass specific slot to cook
      );
    };

    // Route movement and combat through action queue for OSRS-style tick processing
    // Actions are queued and processed on tick boundaries, not immediately
    this.handlers["onMoveRequest"] = (socket, data) => {
      // Cancel any pending attack or follow when player moves elsewhere (OSRS behavior)
      if (socket.player) {
        this.pendingAttackManager.cancelPendingAttack(socket.player.id);
        this.followManager.stopFollowing(socket.player.id);
      }
      this.actionQueue.queueMovement(socket, data);
    };

    this.handlers["onInput"] = (socket, data) => {
      // Legacy input handler - convert clicks to movement queue
      const payload = data as {
        type?: string;
        target?: number[];
        runMode?: boolean;
      };
      if (payload.type === "click" && Array.isArray(payload.target)) {
        // Cancel any pending attack or follow when player moves elsewhere (OSRS behavior)
        if (socket.player) {
          this.pendingAttackManager.cancelPendingAttack(socket.player.id);
          this.followManager.stopFollowing(socket.player.id);
        }
        this.actionQueue.queueMovement(socket, {
          target: payload.target,
          runMode: payload.runMode,
        });
      }
    };

    // Combat - server-authoritative "walk to and attack" system
    // OSRS-style: If in melee range, start combat immediately; otherwise queue pending attack
    // Melee range is CARDINAL ONLY for range 1 (standard melee)
    this.handlers["onAttackMob"] = (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) return;

      const payload = data as { mobId?: string; targetId?: string };
      const targetId = payload.mobId || payload.targetId;
      if (!targetId) return;

      // Cancel any existing combat and pending attacks when switching targets
      this.world.emit(EventType.COMBAT_STOP_ATTACK, {
        attackerId: playerEntity.id,
      });
      this.pendingAttackManager.cancelPendingAttack(playerEntity.id);

      // Get mob entity directly from world entities
      const mobEntity = this.world.entities.get(targetId) as {
        position?: { x: number; y: number; z: number };
        config?: { currentHealth?: number; maxHealth?: number };
        type?: string;
      } | null;

      if (!mobEntity || !mobEntity.position) return;
      if (mobEntity.type !== "mob") return;
      if ((mobEntity.config?.currentHealth ?? 0) <= 0) return;

      // Get player's weapon melee range from equipment system
      const meleeRange = this.getPlayerWeaponRange(playerEntity.id);

      // OSRS-accurate melee range check (cardinal-only for range 1)
      const playerPos = playerEntity.position;
      const playerTile = worldToTile(playerPos.x, playerPos.z);
      const targetTile = worldToTile(
        mobEntity.position.x,
        mobEntity.position.z,
      );

      if (tilesWithinMeleeRange(playerTile, targetTile, meleeRange)) {
        // In melee range - start combat immediately via action queue
        this.actionQueue.queueCombat(socket, data);
      } else {
        // Not in range - queue pending attack (server handles OSRS-style pathfinding)
        this.pendingAttackManager.queuePendingAttack(
          playerEntity.id,
          targetId,
          this.world.currentTick,
          meleeRange,
        );
      }
    };

    // PvP - attack another player (only in PvP zones)
    this.handlers["onAttackPlayer"] = (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) return;

      const payload = data as { targetPlayerId?: string };
      const targetPlayerId = payload.targetPlayerId;
      if (!targetPlayerId) return;

      // Cancel any existing combat and pending attacks when switching targets
      this.world.emit(EventType.COMBAT_STOP_ATTACK, {
        attackerId: playerEntity.id,
      });
      this.pendingAttackManager.cancelPendingAttack(playerEntity.id);

      // Get target player entity
      const targetPlayer = this.world.entities?.players?.get(
        targetPlayerId,
      ) as {
        position?: { x: number; y: number; z: number };
      } | null;

      if (!targetPlayer || !targetPlayer.position) return;

      // Get player's weapon melee range from equipment system
      const meleeRange = this.getPlayerWeaponRange(playerEntity.id);

      // OSRS-accurate melee range check (cardinal-only for range 1)
      const playerPos = playerEntity.position;
      const playerTile = worldToTile(playerPos.x, playerPos.z);
      const targetTile = worldToTile(
        targetPlayer.position.x,
        targetPlayer.position.z,
      );

      if (tilesWithinMeleeRange(playerTile, targetTile, meleeRange)) {
        // In melee range - validate zones and start combat immediately
        handleAttackPlayer(socket, data, this.world);
      } else {
        // Not in range - validate zones first, then queue pending attack
        // Zone validation happens in handleAttackPlayer, so we do basic checks here
        const zoneSystem = this.world.getSystem("zone-detection") as {
          isPvPEnabled?: (pos: { x: number; z: number }) => boolean;
        } | null;

        if (zoneSystem?.isPvPEnabled) {
          const attackerPos = playerEntity.position;
          if (
            !attackerPos ||
            !zoneSystem.isPvPEnabled({ x: attackerPos.x, z: attackerPos.z })
          ) {
            // Attacker not in PvP zone - silently ignore
            return;
          }
          if (
            !zoneSystem.isPvPEnabled({
              x: targetPlayer.position.x,
              z: targetPlayer.position.z,
            })
          ) {
            // Target not in PvP zone - silently ignore
            return;
          }
        }

        // Queue pending attack - will move toward target and attack when in range
        this.pendingAttackManager.queuePendingAttack(
          playerEntity.id,
          targetPlayerId,
          this.world.currentTick,
          meleeRange,
          "player", // PvP target type
        );
      }
    };

    // Follow another player (OSRS-style)
    this.handlers["onFollowPlayer"] = (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) return;

      // Cancel any pending attack when starting to follow
      this.pendingAttackManager.cancelPendingAttack(playerEntity.id);

      // Validate and start following
      handleFollowPlayer(socket, data, this.world, this.followManager);
    };

    this.handlers["onChangeAttackStyle"] = (socket, data) =>
      handleChangeAttackStyle(socket, data, this.world);

    this.handlers["onSetAutoRetaliate"] = (socket, data) =>
      handleSetAutoRetaliate(socket, data, this.world);

    this.handlers["onPickupItem"] = (socket, data) =>
      handlePickupItem(socket, data, this.world);

    this.handlers["onDropItem"] = (socket, data) =>
      handleDropItem(socket, data, this.world);

    this.handlers["onEquipItem"] = (socket, data) =>
      handleEquipItem(socket, data, this.world);

    this.handlers["onUnequipItem"] = (socket, data) =>
      handleUnequipItem(socket, data, this.world);

    this.handlers["onMoveItem"] = (socket, data) =>
      handleMoveItem(socket, data, this.world);

    // Death/respawn handlers
    this.handlers["onRequestRespawn"] = (socket, _data) => {
      const playerEntity = socket.player;
      if (playerEntity) {
        console.log(
          `[ServerNetwork] Received respawn request from player ${playerEntity.id}`,
        );
        this.world.emit(EventType.PLAYER_RESPAWN_REQUEST, {
          playerId: playerEntity.id,
        });
      } else {
        console.warn(
          "[ServerNetwork] requestRespawn: no player entity on socket",
        );
      }
    };

    // Character selection handlers
    // Support both with and without "on" prefix for client compatibility
    this.handlers["onCharacterListRequest"] = (socket) =>
      handleCharacterListRequest(socket, this.world);
    this.handlers["characterListRequest"] = (socket) =>
      handleCharacterListRequest(socket, this.world);

    this.handlers["onCharacterCreate"] = (socket, data) =>
      handleCharacterCreate(
        socket,
        data,
        this.world,
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );
    this.handlers["characterCreate"] = (socket, data) =>
      handleCharacterCreate(
        socket,
        data,
        this.world,
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );

    this.handlers["onCharacterSelected"] = (socket, data) =>
      handleCharacterSelected(
        socket,
        data,
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );
    this.handlers["characterSelected"] = (socket, data) =>
      handleCharacterSelected(
        socket,
        data,
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );

    this.handlers["onEnterWorld"] = (socket, data) =>
      handleEnterWorld(
        socket,
        data,
        this.world,
        this.spawn,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );
    this.handlers["enterWorld"] = (socket, data) =>
      handleEnterWorld(
        socket,
        data,
        this.world,
        this.spawn,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
        this.broadcastManager.sendToSocket.bind(this.broadcastManager),
      );

    // Client ready handler - player is now active and can be targeted
    // Sent by client when all assets have finished loading
    this.handlers["onClientReady"] = (socket) => {
      if (!socket.player) {
        console.warn(
          "[PlayerLoading] clientReady received but no player on socket",
          {
            socketId: socket.id,
            accountId: socket.accountId,
            characterId: socket.characterId,
            selectedCharacterId: socket.selectedCharacterId,
            isRegistered: this.sockets.has(socket.id),
          },
        );
        return;
      }

      const player = socket.player;

      // Validate ownership - only the owning socket can mark player as ready
      if (player.data.owner !== socket.id) {
        console.warn(
          `[PlayerLoading] clientReady rejected: socket ${socket.id} doesn't own player ${player.id}`,
        );
        return;
      }

      // Ignore duplicate clientReady packets (idempotent)
      if (!player.data.isLoading) {
        return;
      }

      console.log(
        `[PlayerLoading] Received clientReady from player ${player.id}`,
      );
      console.log(
        `[PlayerLoading] Player ${player.id} isLoading: ${player.data.isLoading} -> false`,
      );

      // Mark player as no longer loading
      player.data.isLoading = false;

      // Broadcast state change to all clients
      this.broadcastManager.sendToAll("entityModified", {
        id: player.id,
        changes: { isLoading: false },
      });

      console.log(
        `[PlayerLoading] Player ${player.id} now active and targetable`,
      );

      // Emit event for other systems
      this.world.emit(EventType.PLAYER_READY, {
        playerId: player.id,
      });
    };

    // Agent goal sync handler - stores goal and available goals for dashboard display
    this.handlers["onSyncGoal"] = (socket, data) => {
      const goalData = data as {
        characterId?: string;
        goal: unknown;
        availableGoals?: unknown[];
      };
      if (goalData.characterId) {
        // Store goal
        ServerNetwork.agentGoals.set(goalData.characterId, goalData.goal);

        // Store available goals if provided
        if (goalData.availableGoals) {
          ServerNetwork.agentAvailableGoals.set(
            goalData.characterId,
            goalData.availableGoals,
          );
        }

        // Track socket for this character (for sending goal overrides)
        ServerNetwork.characterSockets.set(goalData.characterId, socket);

        console.log(
          `[ServerNetwork] Goal synced for character ${goalData.characterId}:`,
          goalData.goal ? "active" : "cleared",
          goalData.availableGoals
            ? `(${goalData.availableGoals.length} available goals)`
            : "",
        );
      }
    };

    // Bank handlers
    this.handlers["onBankOpen"] = (socket, data) =>
      handleBankOpen(socket, data as { bankId: string }, this.world);

    this.handlers["onBankDeposit"] = (socket, data) =>
      handleBankDeposit(
        socket,
        data as { itemId: string; quantity: number; slot?: number },
        this.world,
      );

    this.handlers["onBankWithdraw"] = (socket, data) =>
      handleBankWithdraw(
        socket,
        data as { itemId: string; quantity: number },
        this.world,
      );

    this.handlers["onBankDepositAll"] = (socket, data) =>
      handleBankDepositAll(
        socket,
        data as { targetTabIndex?: number },
        this.world,
      );

    this.handlers["onBankDepositCoins"] = (socket, data) =>
      handleBankDepositCoins(socket, data as { amount: number }, this.world);

    this.handlers["onBankWithdrawCoins"] = (socket, data) =>
      handleBankWithdrawCoins(socket, data as { amount: number }, this.world);

    this.handlers["onBankClose"] = (socket, data) =>
      handleBankClose(socket, data, this.world);

    this.handlers["onBankMove"] = (socket, data) =>
      handleBankMove(
        socket,
        data as {
          fromSlot: number;
          toSlot: number;
          mode: "swap" | "insert";
          tabIndex: number;
        },
        this.world,
      );

    // Bank tab handlers (Phase 2)
    this.handlers["onBankCreateTab"] = (socket, data) =>
      handleBankCreateTab(
        socket,
        data as { fromSlot: number; fromTabIndex: number; newTabIndex: number },
        this.world,
      );

    this.handlers["onBankDeleteTab"] = (socket, data) =>
      handleBankDeleteTab(socket, data as { tabIndex: number }, this.world);

    this.handlers["onBankMoveToTab"] = (socket, data) =>
      handleBankMoveToTab(
        socket,
        data as { fromSlot: number; fromTabIndex: number; toTabIndex: number },
        this.world,
      );

    // Bank placeholder handlers (Phase 3 - RS3 style: qty=0 in bank_storage)
    this.handlers["onBankWithdrawPlaceholder"] = (socket, data) =>
      handleBankWithdrawPlaceholder(
        socket,
        data as { itemId: string },
        this.world,
      );

    this.handlers["onBankReleasePlaceholder"] = (socket, data) =>
      handleBankReleasePlaceholder(
        socket,
        data as { tabIndex: number; slot: number },
        this.world,
      );

    this.handlers["onBankReleaseAllPlaceholders"] = (socket, data) =>
      handleBankReleaseAllPlaceholders(socket, data, this.world);

    this.handlers["onBankToggleAlwaysPlaceholder"] = (socket, data) =>
      handleBankToggleAlwaysPlaceholder(socket, data, this.world);

    // Bank equipment tab handlers (RS3-style equipment view)
    this.handlers["onBankWithdrawToEquipment"] = (socket, data) =>
      handleBankWithdrawToEquipment(
        socket,
        data as { itemId: string; tabIndex: number; slot: number },
        this.world,
      );

    this.handlers["onBankDepositEquipment"] = (socket, data) =>
      handleBankDepositEquipment(socket, data as { slot: string }, this.world);

    this.handlers["onBankDepositAllEquipment"] = (socket, data) =>
      handleBankDepositAllEquipment(socket, data, this.world);

    // NPC interaction handler - client clicked on NPC
    this.handlers["onNpcInteract"] = (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) return;

      const payload = data as {
        npcId: string;
        npc: { id: string; name: string; type: string };
      };

      // Emit NPC_INTERACTION event for DialogueSystem to handle
      // npcId is the entity instance ID, pass as npcEntityId for distance checking
      this.world.emit(EventType.NPC_INTERACTION, {
        playerId: playerEntity.id,
        npcId: payload.npcId,
        npc: payload.npc,
        npcEntityId: payload.npcId,
      });
    };

    // Dialogue handlers (with input validation)
    this.handlers["onDialogueResponse"] = (socket, data) =>
      handleDialogueResponse(
        socket,
        data as { npcId: string; responseIndex: number },
        this.world,
      );

    this.handlers["onDialogueClose"] = (socket, data) =>
      handleDialogueClose(socket, data as { npcId: string }, this.world);

    // Store handlers
    this.handlers["onStoreOpen"] = (socket, data) =>
      handleStoreOpen(
        socket,
        data as {
          npcId: string;
          storeId?: string;
          npcPosition?: { x: number; y: number; z: number };
        },
        this.world,
      );

    this.handlers["onStoreBuy"] = (socket, data) =>
      handleStoreBuy(
        socket,
        data as { storeId: string; itemId: string; quantity: number },
        this.world,
      );

    this.handlers["onStoreSell"] = (socket, data) =>
      handleStoreSell(
        socket,
        data as { storeId: string; itemId: string; quantity: number },
        this.world,
      );

    this.handlers["onStoreClose"] = (socket, data) =>
      handleStoreClose(socket, data as { storeId: string }, this.world);
  }

  async init(options: WorldOptions): Promise<void> {
    // Validate that db exists and has the expected shape
    if (!options.db || !isDatabaseInstance(options.db)) {
      throw new Error(
        "[ServerNetwork] Valid database instance not provided in options",
      );
    }

    this.db = options.db;

    // Initialize managers now that db is available
    this.initializeManagers();
  }

  async start(): Promise<void> {
    if (!this.db) {
      throw new Error("[ServerNetwork] Database not available in start method");
    }

    // Load spawn configuration
    this.spawn = await this.initializationManager.loadSpawnPoint();

    // Hydrate entities from database
    await this.initializationManager.hydrateEntities();

    // Load world settings
    await this.initializationManager.loadSettings();

    // Start save manager (timer + settings watcher)
    this.saveManager.start();

    // Setup event bridge (world events → network messages)
    this.eventBridge.setupEventListeners();

    // Start tick system (600ms RuneScape-style ticks)
    this.tickSystem.start();
    console.log(
      "[ServerNetwork] Tick system started (600ms ticks) with action queue",
    );
  }

  override destroy(): void {
    this.socketManager.destroy();
    this.saveManager.destroy();
    this.interactionSessionManager.destroy();
    this.tickSystem.stop();

    for (const [_id, socket] of this.sockets) {
      socket.close?.();
    }
    this.sockets.clear();
  }

  override preFixedUpdate(): void {
    this.flush();
  }

  override update(dt: number): void {
    // Validate player positions periodically
    this.positionValidator.update(dt);

    // Delegate movement updates to MovementManager
    this.movementManager.update(dt);

    // Broadcast world time periodically for day/night cycle sync
    this.worldTimeSyncAccumulator += dt;
    if (this.worldTimeSyncAccumulator >= this.WORLD_TIME_SYNC_INTERVAL) {
      this.worldTimeSyncAccumulator = 0;
      this.broadcastManager.sendToAll("worldTimeSync", {
        worldTime: this.world.getTime(),
      });
    }
  }

  /**
   * Broadcast message to all connected clients
   *
   * Delegates to BroadcastManager.
   */
  send<T = unknown>(name: string, data: T, ignoreSocketId?: string): void {
    this.broadcastManager.sendToAll(name, data, ignoreSocketId);
  }

  /**
   * Send message to specific socket
   *
   * Delegates to BroadcastManager.
   */
  sendTo<T = unknown>(socketId: string, name: string, data: T): void {
    this.broadcastManager.sendToSocket(socketId, name, data);
  }

  /**
   * Delegate socket health checking to SocketManager
   */
  checkSockets(): void {
    this.socketManager.checkSockets();
  }

  enqueue(socket: ServerSocket | Socket, method: string, data: unknown): void {
    this.queue.push([socket as ServerSocket, method, data]);
  }

  /**
   * Delegate disconnection handling to SocketManager
   */
  onDisconnect(socket: ServerSocket | Socket, code?: number | string): void {
    this.socketManager.handleDisconnect(socket as ServerSocket, code);
  }

  flush(): void {
    while (this.queue.length) {
      const [socket, method, data] = this.queue.shift()!;

      const handler = this.handlers[method];
      if (handler) {
        const result = handler.call(this, socket, data);
        if (result && typeof result.then === "function") {
          result.catch((err: Error) => {
            console.error(
              `[ServerNetwork] Error in async handler ${method}:`,
              err,
            );
          });
        }
      } else {
        console.warn(`[ServerNetwork] No handler for packet: ${method}`);
      }
    }
  }

  getTime(): number {
    return performance.now() / 1000; // seconds
  }

  isAdmin(player: { data?: { roles?: string[] } }): boolean {
    return hasRole(player.data?.roles as string[] | undefined, "admin");
  }

  isBuilder(player: { data?: { roles?: string[] } }): boolean {
    return this.world.settings.public || this.isAdmin(player);
  }

  /**
   * Get player's weapon attack range in tiles
   * Uses equipment system to get equipped weapon's attackRange from manifest
   * Returns 1 for unarmed (punching)
   */
  getPlayerWeaponRange(playerId: string): number {
    const equipmentSystem = this.world.getSystem("equipment") as
      | {
          getPlayerEquipment?: (id: string) => {
            weapon?: { item?: { attackRange?: number; id?: string } };
          } | null;
        }
      | undefined;

    if (equipmentSystem?.getPlayerEquipment) {
      const equipment = equipmentSystem.getPlayerEquipment(playerId);

      if (equipment?.weapon?.item) {
        const weaponItem = equipment.weapon.item;

        // Check if weapon has attackRange directly
        if (weaponItem.attackRange) {
          return weaponItem.attackRange;
        }

        // Fallback: look up from items manifest
        if (weaponItem.id) {
          const itemData = getItem(weaponItem.id);
          if (itemData?.attackRange) {
            return itemData.attackRange;
          }
        }
      }
    }

    // Default to 1 tile (unarmed/punching)
    return 1;
  }

  /**
   * Handle incoming WebSocket connection
   *
   * Delegates to ConnectionHandler for the full connection flow.
   */
  async onConnection(
    ws: NodeWebSocket,
    params: ConnectionParams,
  ): Promise<void> {
    await this.connectionHandler.handleConnection(ws, params);
  }
}
