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
  tileChebyshevDistance,
  getItem,
  DeathState,
  AttackType,
  WeaponType,
  type DuelRules,
  type DuelEquipmentSlot,
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
  handleAttackPlayer,
  handleChangeAttackStyle,
  handleSetAutoRetaliate,
} from "./handlers/combat";
import {
  handlePickupItem,
  handleDropItem,
  handleEquipItem,
  handleUseItem,
  handleUnequipItem,
  handleMoveItem,
  handleCoinPouchWithdraw,
  handleXpLampUse,
} from "./handlers/inventory";
import {
  handlePrayerToggle,
  handlePrayerDeactivateAll,
  handleAltarPray,
} from "./handlers/prayer";
import { handleSetAutocast } from "./handlers/magic";
import { handleResourceGather } from "./handlers/resources";
import {
  handleActionBarSave,
  handleActionBarLoad,
} from "./handlers/action-bar";
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
  handleDialogueContinue,
  handleDialogueClose,
} from "./handlers/dialogue";
import {
  handleGetQuestList,
  handleGetQuestDetail,
  handleQuestAccept,
  handleQuestAbandon,
  handleQuestComplete,
} from "./handlers/quest";
import { PendingAttackManager } from "./PendingAttackManager";
import { PendingGatherManager } from "./PendingGatherManager";
import { PendingCookManager } from "./PendingCookManager";
import { PendingTradeManager } from "./PendingTradeManager";
import { PendingDuelChallengeManager } from "./PendingDuelChallengeManager";
import { FollowManager } from "./FollowManager";
import { FaceDirectionManager } from "./FaceDirectionManager";
import { handleFollowPlayer, handleChangePlayerName } from "./handlers/player";
import {
  initHomeTeleportManager,
  getHomeTeleportManager,
  handleHomeTeleport,
  handleHomeTeleportCancel,
} from "./handlers/home-teleport";
import {
  handleTradeRequest,
  handleTradeRequestRespond,
  handleTradeAddItem,
  handleTradeRemoveItem,
  handleTradeSetQuantity,
  handleTradeAccept,
  handleTradeCancelAccept,
  handleTradeCancel,
} from "./handlers/trade";
import {
  handleFriendRequest,
  handleFriendAccept,
  handleFriendDecline,
  handleFriendRemove,
  handleIgnoreAdd,
  handleIgnoreRemove,
  handlePrivateMessage,
} from "./handlers/friends";
import { TradingSystem } from "../TradingSystem";
import { DuelSystem } from "../DuelSystem";
import {
  handleDuelChallenge,
  handleDuelChallengeRespond,
  handleDuelToggleRule,
  handleDuelToggleEquipment,
  handleDuelAcceptRules,
  handleDuelCancel,
  handleDuelAddStake,
  handleDuelRemoveStake,
  handleDuelAcceptStakes,
  handleDuelAcceptFinal,
  handleDuelForfeit,
} from "./handlers/duel";
import { getDatabase } from "./handlers/common";
import { sql } from "drizzle-orm";
import { InventoryRepository } from "../../database/repositories/InventoryRepository";

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

  /** Idempotency guard: prevents double-settlement of duel stakes */
  private processedDuelSettlements: Set<string> = new Set();

  /** Agent goal storage (characterId -> goal data) for dashboard display */
  static agentGoals: Map<string, unknown> = new Map();

  /** Agent available goals storage (characterId -> available goals) for dashboard selection */
  static agentAvailableGoals: Map<string, unknown[]> = new Map();

  /** Agent goals paused state (characterId -> boolean) for dashboard display */
  static agentGoalsPaused: Map<string, boolean> = new Map();

  /** Character ID to socket mapping for sending goal overrides */
  static characterSockets: Map<string, ServerSocket> = new Map();

  /** Agent thought storage (characterId -> recent thoughts) for dashboard display */
  static agentThoughts: Map<
    string,
    Array<{
      id: string;
      type: "situation" | "evaluation" | "thinking" | "decision";
      content: string;
      timestamp: number;
    }>
  > = new Map();

  /** Maximum number of thoughts to keep per agent */
  static MAX_THOUGHTS_PER_AGENT = 50;

  /** Modular managers */
  private tileMovementManager!: TileMovementManager;
  private mobTileMovementManager!: MobTileMovementManager;
  private pendingAttackManager!: PendingAttackManager;
  private pendingGatherManager!: PendingGatherManager;
  private pendingCookManager!: PendingCookManager;
  private pendingTradeManager!: PendingTradeManager;
  private pendingDuelChallengeManager!: PendingDuelChallengeManager;
  private followManager!: FollowManager;
  private tradingSystem!: TradingSystem;
  private duelSystem!: DuelSystem;
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

  // Rate Limiting for Processing Requests
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

  // Rate Limiting Helper

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

    // SECOND: Process duel state transitions BEFORE action queue
    // CRITICAL: Must run before ActionQueue so COUNTDOWN→FIGHTING transition
    // happens before movement validation (which calls canMove())
    // Without this ordering, there's a race condition where movement requests
    // are rejected because they see COUNTDOWN state, but state changes to
    // FIGHTING later in the same tick
    this.tickSystem.onTick(() => {
      this.duelSystem.processTick();
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
    // FireRegistry is now injected via constructor (DIP)
    const processingSystem = this.world.getSystem("processing") as unknown as {
      getActiveFires: () => Map<
        string,
        {
          id: string;
          position: { x: number; y: number; z: number };
          isActive: boolean;
          playerId: string;
          createdAt: number;
          duration: number;
          mesh?: unknown;
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

    // Pending trade manager - server-authoritative "walk to player and trade" system
    // OSRS-style: if player clicks to trade someone far away, walk up first
    this.pendingTradeManager = new PendingTradeManager(
      this.world,
      this.tileMovementManager,
    );

    // Register pending trade processing (same priority as movement)
    this.tickSystem.onTick(() => {
      this.pendingTradeManager.processTick();
    }, TickPriority.MOVEMENT);

    // Store pending trade manager on world so trade handlers can access it
    (
      this.world as { pendingTradeManager?: PendingTradeManager }
    ).pendingTradeManager = this.pendingTradeManager;

    // Pending duel challenge manager - server-authoritative "walk to player and challenge" system
    // OSRS-style: if player clicks to challenge someone far away, walk up first
    this.pendingDuelChallengeManager = new PendingDuelChallengeManager(
      this.world,
      this.tileMovementManager,
    );

    // Register pending duel challenge processing (same priority as movement)
    this.tickSystem.onTick(() => {
      this.pendingDuelChallengeManager.processTick();
    }, TickPriority.MOVEMENT);

    // Store pending duel challenge manager on world so handlers can access it
    (
      this.world as {
        pendingDuelChallengeManager?: PendingDuelChallengeManager;
      }
    ).pendingDuelChallengeManager = this.pendingDuelChallengeManager;

    // Trading system - server-authoritative player-to-player trading
    // Manages trade sessions, item offers, acceptance state, and atomic swaps
    this.tradingSystem = new TradingSystem(this.world);
    this.tradingSystem.init();

    // Store trading system on world so handlers can access it
    (this.world as { tradingSystem?: TradingSystem }).tradingSystem =
      this.tradingSystem;

    // Duel system - server-authoritative player-to-player dueling (OSRS-style)
    // Manages duel sessions, rules negotiation, stakes, and combat enforcement
    this.duelSystem = new DuelSystem(this.world);
    this.duelSystem.init();

    // Store duel system on world so handlers can access it
    (this.world as { duelSystem?: DuelSystem }).duelSystem = this.duelSystem;

    // Register duel system in systemsByName so it can be found via getSystem("duel")
    // This is required for combat.ts to detect duel combat and bypass PvP zone checks
    // NOTE: We use systemsByName directly instead of addSystem() because DuelSystem
    // doesn't implement the full System lifecycle interface (preTick, postTick, etc.)
    (this.world as { systemsByName: Map<string, unknown> }).systemsByName.set(
      "duel",
      this.duelSystem,
    );

    // Listen for duel countdown start and forward to clients
    // This tells clients to close the duel panel and show the countdown overlay
    this.world.on("duel:countdown:start", (event) => {
      const { duelId, arenaId, challengerId, targetId } = event as {
        duelId: string;
        arenaId: number;
        challengerId: string;
        targetId: string;
      };

      const payload = { duelId, arenaId, challengerId, targetId };

      const challengerSocket = this.getSocketByPlayerId(challengerId);
      if (challengerSocket) {
        challengerSocket.send("duelCountdownStart", payload);
      }

      const targetSocket = this.getSocketByPlayerId(targetId);
      if (targetSocket) {
        targetSocket.send("duelCountdownStart", payload);
      }
    });

    // Listen for duel countdown ticks and forward to clients
    this.world.on("duel:countdown:tick", (event) => {
      const { duelId, count, challengerId, targetId } = event as {
        duelId: string;
        count: number;
        challengerId: string;
        targetId: string;
      };

      // Include player IDs so client can display countdown over both players' heads
      const payload = { duelId, count, challengerId, targetId };

      const challengerSocket = this.getSocketByPlayerId(challengerId);
      if (challengerSocket) {
        challengerSocket.send("duelCountdownTick", payload);
      }

      const targetSocket = this.getSocketByPlayerId(targetId);
      if (targetSocket) {
        targetSocket.send("duelCountdownTick", payload);
      }
    });

    // Listen for duel fight start and forward to clients
    this.world.on("duel:fight:start", (event) => {
      const { duelId, challengerId, targetId, arenaId, bounds } = event as {
        duelId: string;
        challengerId: string;
        targetId: string;
        arenaId: number;
        bounds?: {
          min: { x: number; y: number; z: number };
          max: { x: number; y: number; z: number };
        };
      };

      // Send to challenger with target as their opponent
      const challengerSocket = this.getSocketByPlayerId(challengerId);
      if (challengerSocket) {
        challengerSocket.send("duelFightStart", {
          duelId,
          arenaId,
          opponentId: targetId,
          bounds,
        });
      }

      // Send to target with challenger as their opponent
      const targetSocket = this.getSocketByPlayerId(targetId);
      if (targetSocket) {
        targetSocket.send("duelFightStart", {
          duelId,
          arenaId,
          opponentId: challengerId,
          bounds,
        });
      }
    });

    // Listen for duel completion and send results to both players
    this.world.on("duel:completed", (event) => {
      const {
        duelId,
        winnerId,
        winnerName,
        loserId,
        loserName,
        reason,
        forfeit,
        winnerReceives,
        winnerReceivesValue,
        challengerStakes,
        targetStakes,
      } = event as {
        duelId: string;
        winnerId: string;
        winnerName: string;
        loserId: string;
        loserName: string;
        reason: "death" | "forfeit";
        forfeit: boolean;
        winnerReceives: Array<{
          itemId: string;
          quantity: number;
          value: number;
        }>;
        winnerReceivesValue: number;
        challengerStakes: Array<{
          itemId: string;
          quantity: number;
          value: number;
        }>;
        targetStakes: Array<{
          itemId: string;
          quantity: number;
          value: number;
        }>;
      };

      // Calculate what the loser lost (their stakes)
      const loserLostValue =
        winnerId === loserId
          ? 0
          : winnerReceives.reduce((sum, item) => sum + item.value, 0);

      // Send to winner
      const winnerSocket = this.getSocketByPlayerId(winnerId);
      if (winnerSocket) {
        winnerSocket.send("duelCompleted", {
          duelId,
          won: true,
          opponentName: loserName,
          itemsReceived: winnerReceives,
          itemsLost: [],
          totalValueWon: winnerReceivesValue,
          totalValueLost: 0,
          forfeit,
        });
      }

      // Send to loser
      const loserSocket = this.getSocketByPlayerId(loserId);
      if (loserSocket) {
        loserSocket.send("duelCompleted", {
          duelId,
          won: false,
          opponentName: winnerName,
          itemsReceived: [],
          itemsLost: winnerReceives,
          totalValueWon: 0,
          totalValueLost: loserLostValue,
          forfeit,
        });
      }
    });

    // Listen for duel player disconnect (notify opponent)
    this.world.on("duel:player:disconnected", (event) => {
      const { duelId, playerId, challengerId, targetId, timeoutMs } = event as {
        duelId: string;
        playerId: string;
        challengerId: string;
        targetId: string;
        timeoutMs: number;
      };

      // Notify the opponent that their duel partner disconnected
      const opponentId = playerId === challengerId ? targetId : challengerId;
      const opponentSocket = this.getSocketByPlayerId(opponentId);
      if (opponentSocket) {
        opponentSocket.send("duelOpponentDisconnected", {
          duelId,
          timeoutMs,
        });
      }
    });

    // Listen for duel player reconnect (notify opponent)
    this.world.on("duel:player:reconnected", (event) => {
      const { duelId, playerId, challengerId, targetId } = event as {
        duelId: string;
        playerId: string;
        challengerId: string;
        targetId: string;
      };

      // Notify the opponent that their duel partner reconnected
      const opponentId = playerId === challengerId ? targetId : challengerId;
      const opponentSocket = this.getSocketByPlayerId(opponentId);
      if (opponentSocket) {
        opponentSocket.send("duelOpponentReconnected", { duelId });
      }
    });

    // Listen for duel equipment restrictions (unequip items in disabled slots)
    this.world.on("duel:equipment:restrict", (event) => {
      const { challengerId, targetId, disabledSlots } = event as {
        duelId: string;
        challengerId: string;
        targetId: string;
        disabledSlots: string[];
      };

      // Unequip items from disabled slots for both players
      for (const playerId of [challengerId, targetId]) {
        for (const slot of disabledSlots) {
          this.world.emit(EventType.EQUIPMENT_UNEQUIP, {
            playerId,
            slot,
          });
        }
      }

      console.log(
        `[Duel] Equipment restrictions applied - disabled slots: ${disabledSlots.join(", ")}`,
      );
    });

    // Listen for duel stakes settle (atomic transfer: loser's items -> winner)
    // CRASH-SAFE: Items remain in inventory until this atomic transfer.
    // Winner's own stakes stay in their inventory (nothing to do).
    // Loser's stakes are atomically transferred to winner.
    this.world.on("duel:stakes:settle", (event) => {
      const { playerId, ownStakes, wonStakes, fromPlayerId, reason } =
        event as {
          playerId: string;
          ownStakes: Array<{
            inventorySlot: number;
            itemId: string;
            quantity: number;
            value: number;
          }>;
          wonStakes: Array<{
            inventorySlot: number;
            itemId: string;
            quantity: number;
            value: number;
          }>;
          fromPlayerId: string;
          reason: string;
        };

      console.log(
        `[Duel] Stakes settle event received - winnerId: ${playerId}, loserId: ${fromPlayerId}, ownStakes: ${ownStakes?.length || 0}, wonStakes: ${wonStakes?.length || 0}, reason: ${reason}`,
      );

      // Idempotency guard: prevent double-settlement if event fires twice
      const settlementKey = `${playerId}:${fromPlayerId}`;
      if (this.processedDuelSettlements.has(settlementKey)) {
        console.warn(
          `[Duel] SECURITY: Duplicate settlement blocked for ${settlementKey}`,
        );
        return;
      }
      this.processedDuelSettlements.add(settlementKey);
      // Auto-cleanup after 60 seconds to prevent unbounded growth
      setTimeout(() => {
        this.processedDuelSettlements.delete(settlementKey);
      }, 60_000);

      // Winner's own stakes stay in their inventory - nothing to do
      // Only need to transfer loser's stakes (wonStakes) from loser to winner
      if (!wonStakes || wonStakes.length === 0) {
        console.log("[Duel] No stakes to transfer from loser, skipping");
        return;
      }

      console.log(
        `[Duel] Transferring ${wonStakes.length} items from ${fromPlayerId} to ${playerId}`,
      );

      // Fire and forget with retry logic
      this.executeDuelStakeTransferWithRetry(
        playerId,
        fromPlayerId,
        wonStakes,
      ).catch((err) => {
        console.error("[Duel] All settlement retries exhausted:", err);
      });
    });

    // Listen for player teleport events (used by duel system)
    this.world.on("player:teleport", (event) => {
      const { playerId, position, rotation } = event as {
        playerId: string;
        position: { x: number; y: number; z: number };
        rotation: number;
      };

      // Update player position on server
      const player = this.world.entities.players?.get(playerId);
      if (player?.position) {
        player.position.x = position.x;
        player.position.y = position.y;
        player.position.z = position.z;
      }

      // Clear any in-progress movement by cleaning up the player's movement state
      this.tileMovementManager.cleanup(playerId);

      // CRITICAL: Sync position to TileMovementManager after teleport
      // Without this, movement system uses stale position and player appears stuck
      this.tileMovementManager.syncPlayerPosition(playerId, position);

      // Clear any pending actions from before teleport (e.g., queued movements, combat actions)
      // This prevents stale actions from executing after teleport
      this.actionQueue.cleanup(playerId);

      // Send teleport to the teleporting player
      const socket = this.getSocketByPlayerId(playerId);
      if (socket) {
        socket.send("playerTeleport", {
          playerId,
          position: [position.x, position.y, position.z],
          rotation,
        });
      }

      // Broadcast teleport to ALL other clients so they see the teleport
      // This is critical for duel arena - both players need to see each other teleport
      // We send playerTeleport (not entityModified) because remote players have tile state
      // and entityModified position updates are skipped for tile-controlled entities
      this.broadcastManager.sendToAll(
        "playerTeleport",
        {
          playerId,
          position: [position.x, position.y, position.z],
          rotation,
        },
        socket?.id,
      );

      // CRITICAL: Sync animation state after teleport to prevent T-pose
      // Without this, remote players may show default pose until next animation change
      this.broadcastManager.sendToAll("entityModified", {
        id: playerId,
        changes: {
          e: "idle",
        },
      });
    });

    // Listen for movement cancel events (used by duel system to prevent escaping arena)
    this.world.on("player:movement:cancel", (event) => {
      const { playerId } = event as { playerId: string };

      // Clear movement state
      this.tileMovementManager.cleanup(playerId);
    });

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

    // Register home teleport system to process on each tick
    // Handles cast completion and combat interruption checks
    this.tickSystem.onTick((tickNumber) => {
      const manager = getHomeTeleportManager();
      if (manager) {
        manager.processTick(tickNumber, (playerId: string) => {
          return this.broadcastManager.getPlayerSocket(playerId);
        });
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

    // Reset agility progress on death (small penalty - lose accumulated tiles toward next XP grant)
    this.world.on(EventType.PLAYER_DIED, (eventData) => {
      const event = eventData as { entityId: string };
      this.tileMovementManager.resetAgilityProgress(event.entityId);
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

    // Sync tile position when player teleports home
    // CRITICAL: Without this, TileMovementManager has stale tile position from pre-teleport location
    // and paths would be calculated from wrong starting tile, causing player to snap back
    this.world.on(EventType.HOME_TELEPORT_COMPLETE, (eventData) => {
      const event = eventData as {
        playerId: string;
        position: { x: number; y: number; z: number };
      };
      if (event.playerId && event.position) {
        this.tileMovementManager.syncPlayerPosition(
          event.playerId,
          event.position,
        );
        // Clear any pending actions from before teleport
        this.actionQueue.cleanup(event.playerId);
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
        attackRange?: number;
        attackType?: AttackType;
      };
      // Use OSRS-style pathfinding with appropriate range and type
      // MELEE: Cardinal-only for range 1, RANGED/MAGIC: Chebyshev distance
      this.tileMovementManager.movePlayerToward(
        followEvent.playerId,
        followEvent.targetPosition,
        true, // Run toward target
        followEvent.attackRange ?? 1, // Default to standard melee range
        followEvent.attackType ?? AttackType.MELEE, // Default to melee if not specified
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
      const payload = event as {
        playerId: string;
        position: { x: number; y: number; z: number };
      };
      const { playerId, position } = payload;

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

    // Store session manager on world so handlers can access it (single source of truth)
    // This replaces the previous pattern of storing entity IDs on socket properties
    (
      this.world as { interactionSessionManager?: InteractionSessionManager }
    ).interactionSessionManager = this.interactionSessionManager;

    // Clean up interaction sessions, pending attacks, follows, gathers, cooks, trades, duels, and home teleport when player disconnects
    this.world.on(EventType.PLAYER_LEFT, (event: { playerId: string }) => {
      this.interactionSessionManager.onPlayerDisconnect(event.playerId);
      this.pendingAttackManager.onPlayerDisconnect(event.playerId);
      this.followManager.onPlayerDisconnect(event.playerId);
      this.pendingGatherManager.onPlayerDisconnect(event.playerId);
      this.pendingCookManager.onPlayerDisconnect(event.playerId);
      this.pendingTradeManager.onPlayerDisconnect(event.playerId);
      this.pendingDuelChallengeManager.onPlayerDisconnect(event.playerId);
      this.duelSystem.onPlayerDisconnect(event.playerId);
      const homeTeleportManager = getHomeTeleportManager();
      if (homeTeleportManager) {
        homeTeleportManager.onPlayerDisconnect(event.playerId);
      }
    });

    // Handle player reconnection (clears disconnect timer if active duel)
    this.world.on(EventType.PLAYER_JOINED, (event: { playerId: string }) => {
      this.duelSystem.onPlayerReconnect(event.playerId);
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
        this.sockets,
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

      // Rate limiting
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

      // Validate inventory slot bounds (OSRS inventory is 28 slots: 0-27)
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

      // Emit event for ProcessingSystem to handle
      this.world.emit(EventType.PROCESSING_FIREMAKING_REQUEST, {
        playerId: player.id,
        logsId: payload.logsId,
        logsSlot: payload.logsSlot,
        tinderboxSlot: payload.tinderboxSlot,
      });
    };
    // Also register without "on" prefix for client compatibility
    this.handlers["firemakingRequest"] = this.handlers["onFiremakingRequest"];

    // Cooking - use raw food on fire/range
    // SERVER-AUTHORITATIVE: Uses PendingCookManager for distance checking (like woodcutting)
    this.handlers["onCookingRequest"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting
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

      // Validate inventory slot bounds (OSRS inventory is 28 slots: 0-27)
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
    // Also register without "on" prefix for client compatibility
    this.handlers["cookingRequest"] = this.handlers["onCookingRequest"];

    // Smelting - player clicked furnace
    // SERVER-AUTHORITATIVE: Emit SMELTING_INTERACT event for SmeltingSystem to handle
    this.handlers["onSmeltingSourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      const payload = data as {
        furnaceId?: string;
        position?: [number, number, number];
      };
      if (!payload.furnaceId || !payload.position) return;

      // Emit event for SmeltingSystem to handle
      this.world.emit(EventType.SMELTING_INTERACT, {
        playerId: player.id,
        furnaceId: payload.furnaceId,
        position: {
          x: payload.position[0],
          y: payload.position[1],
          z: payload.position[2],
        },
      });
    };

    // Smithing - player clicked anvil
    // SERVER-AUTHORITATIVE: Emit SMITHING_INTERACT event for SmithingSystem to handle
    this.handlers["onSmithingSourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      const payload = data as {
        anvilId?: string;
        position?: [number, number, number];
      };
      if (!payload.anvilId || !payload.position) return;

      // Emit event for SmithingSystem to handle
      this.world.emit(EventType.SMITHING_INTERACT, {
        playerId: player.id,
        anvilId: payload.anvilId,
        position: {
          x: payload.position[0],
          y: payload.position[1],
          z: payload.position[2],
        },
      });
    };

    // Processing smelting - player selected bar to smelt from UI
    this.handlers["onProcessingSmelting"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent request spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        barItemId?: unknown;
        furnaceId?: unknown;
        quantity?: unknown;
      };

      // Type validation
      if (
        typeof payload.barItemId !== "string" ||
        typeof payload.furnaceId !== "string"
      ) {
        return;
      }

      // Length validation (prevent memory abuse)
      if (payload.barItemId.length > 64 || payload.furnaceId.length > 64) {
        return;
      }

      // Quantity validation with bounds
      const quantity =
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
          ? Math.floor(Math.max(1, Math.min(payload.quantity, 10000)))
          : 1;

      // Emit event for SmeltingSystem to handle
      this.world.emit(EventType.PROCESSING_SMELTING_REQUEST, {
        playerId: player.id,
        barItemId: payload.barItemId,
        furnaceId: payload.furnaceId,
        quantity,
      });
    };

    // Processing smithing - player selected item to smith from UI
    this.handlers["onProcessingSmithing"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent request spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        recipeId?: unknown;
        anvilId?: unknown;
        quantity?: unknown;
      };

      // Type validation
      if (
        typeof payload.recipeId !== "string" ||
        typeof payload.anvilId !== "string"
      ) {
        return;
      }

      // Length validation (prevent memory abuse)
      if (payload.recipeId.length > 64 || payload.anvilId.length > 64) {
        return;
      }

      // Quantity validation with bounds
      const quantity =
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
          ? Math.floor(Math.max(1, Math.min(payload.quantity, 10000)))
          : 1;

      // Emit event for SmithingSystem to handle
      this.world.emit(EventType.PROCESSING_SMITHING_REQUEST, {
        playerId: player.id,
        recipeId: payload.recipeId,
        anvilId: payload.anvilId,
        quantity,
      });
    };

    // Crafting - player initiated crafting (needle, chisel, or furnace jewelry)
    this.handlers["onCraftingSourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent inventory/recipe computation spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        triggerType?: string;
        stationId?: string;
        inputItemId?: string;
      };
      if (!payload.triggerType) return;

      // Validate triggerType - narrow to literal union
      const validTriggerTypes = ["needle", "chisel", "furnace"] as const;
      type CraftingTriggerType = (typeof validTriggerTypes)[number];
      if (
        !validTriggerTypes.includes(payload.triggerType as CraftingTriggerType)
      ) {
        return;
      }
      const triggerType = payload.triggerType as CraftingTriggerType;

      // Validate inputItemId if provided
      if (
        payload.inputItemId !== undefined &&
        (typeof payload.inputItemId !== "string" ||
          payload.inputItemId.length > 64)
      ) {
        return;
      }

      // Emit event for CraftingSystem to handle
      this.world.emit(EventType.CRAFTING_INTERACT, {
        playerId: player.id,
        triggerType,
        stationId: payload.stationId,
        inputItemId: payload.inputItemId,
      });
    };

    // Processing crafting - player selected item to craft from UI
    this.handlers["onProcessingCrafting"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent request spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        recipeId?: unknown;
        quantity?: unknown;
      };

      // Type validation
      if (typeof payload.recipeId !== "string") {
        return;
      }

      // Length validation (prevent memory abuse)
      if (payload.recipeId.length > 64) {
        return;
      }

      // Quantity validation with bounds (-1 = "All", server computes actual max)
      let quantity = 1;
      if (
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
      ) {
        quantity =
          payload.quantity === -1
            ? 10000
            : Math.floor(Math.max(1, Math.min(payload.quantity, 10000)));
      }

      // Emit event for CraftingSystem to handle
      this.world.emit(EventType.PROCESSING_CRAFTING_REQUEST, {
        playerId: player.id,
        recipeId: payload.recipeId,
        quantity,
      });
    };

    // Fletching source interaction - player used knife on logs or item-on-item
    this.handlers["onFletchingSourceInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent inventory/recipe computation spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        triggerType?: string;
        inputItemId?: string;
        secondaryItemId?: string;
      };
      if (!payload.triggerType) return;

      // Validate triggerType - narrow to literal union
      const validFletchingTriggers = ["knife", "item_on_item"] as const;
      type FletchingTriggerType = (typeof validFletchingTriggers)[number];
      if (
        !validFletchingTriggers.includes(
          payload.triggerType as FletchingTriggerType,
        )
      ) {
        return;
      }
      const triggerType = payload.triggerType as FletchingTriggerType;

      // Validate inputItemId (required)
      if (
        typeof payload.inputItemId !== "string" ||
        payload.inputItemId.length > 64
      ) {
        return;
      }

      // Validate optional secondaryItemId
      if (
        payload.secondaryItemId !== undefined &&
        (typeof payload.secondaryItemId !== "string" ||
          payload.secondaryItemId.length > 64)
      ) {
        return;
      }

      // Emit event for FletchingSystem to handle
      this.world.emit(EventType.FLETCHING_INTERACT, {
        playerId: player.id,
        triggerType,
        inputItemId: payload.inputItemId,
        secondaryItemId: payload.secondaryItemId,
      });
    };

    // Processing fletching - player selected recipe to fletch from UI
    this.handlers["onProcessingFletching"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent request spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        recipeId?: unknown;
        quantity?: unknown;
      };

      // Type validation
      if (typeof payload.recipeId !== "string") {
        return;
      }

      // Length validation (prevent memory abuse)
      if (payload.recipeId.length > 64) {
        return;
      }

      // Quantity validation with bounds (-1 = "All", server computes actual max)
      let quantity = 1;
      if (
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
      ) {
        quantity =
          payload.quantity === -1
            ? 10000
            : Math.floor(Math.max(1, Math.min(payload.quantity, 10000)));
      }

      // Emit event for FletchingSystem to handle
      this.world.emit(EventType.PROCESSING_FLETCHING_REQUEST, {
        playerId: player.id,
        recipeId: payload.recipeId,
        quantity,
      });
    };

    // Tanning - player selected hide to tan from UI
    this.handlers["onProcessingTanning"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting - prevent request spam
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        inputItemId?: unknown;
        quantity?: unknown;
      };

      // Type validation
      if (typeof payload.inputItemId !== "string") {
        return;
      }

      // Length validation (prevent memory abuse)
      if (payload.inputItemId.length > 64) {
        return;
      }

      // Quantity validation with bounds (-1 = "All", server computes actual max)
      let quantity = 1;
      if (
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
      ) {
        quantity =
          payload.quantity === -1
            ? 10000
            : Math.floor(Math.max(1, Math.min(payload.quantity, 10000)));
      }

      // Emit event for TanningSystem to handle
      this.world.emit(EventType.TANNING_REQUEST, {
        playerId: player.id,
        inputItemId: payload.inputItemId,
        quantity,
      });
    };

    // Runecrafting - player clicked runecrafting altar
    // SERVER-AUTHORITATIVE: Emit RUNECRAFTING_INTERACT event for RunecraftingSystem to handle
    this.handlers["onRunecraftingAltarInteract"] = (socket, data) => {
      const player = socket.player;
      if (!player) return;

      // Rate limiting
      if (!this.canProcessRequest(player.id)) {
        return;
      }

      const payload = data as {
        altarId?: unknown;
      };

      // Validate altarId
      if (typeof payload.altarId !== "string" || payload.altarId.length > 64) {
        return;
      }

      // Look up the altar entity to get the authoritative runeType
      const altarEntity = this.world.entities.get(payload.altarId);
      if (!altarEntity) return;

      const runeType = (altarEntity as unknown as { runeType?: string })
        .runeType;
      if (!runeType) return;

      // Emit event for RunecraftingSystem to handle
      this.world.emit(EventType.RUNECRAFTING_INTERACT, {
        playerId: player.id,
        altarId: payload.altarId,
        runeType,
      });
    };
    this.handlers["runecraftingAltarInteract"] =
      this.handlers["onRunecraftingAltarInteract"];

    // Route movement and combat through action queue for OSRS-style tick processing
    // Actions are queued and processed on tick boundaries, not immediately
    this.handlers["onMoveRequest"] = (socket, data) => {
      // Cancel any pending attack, follow, trade, or home teleport when player moves elsewhere (OSRS behavior)
      if (socket.player) {
        this.pendingAttackManager.cancelPendingAttack(socket.player.id);
        this.followManager.stopFollowing(socket.player.id);
        this.pendingTradeManager.cancelPendingTrade(socket.player.id);
        this.pendingDuelChallengeManager.cancelPendingChallenge(
          socket.player.id,
        );
        const homeTeleportManager = getHomeTeleportManager();
        if (homeTeleportManager?.isCasting(socket.player.id)) {
          homeTeleportManager.cancelCasting(socket.player.id, "Player moved");
          socket.send("homeTeleportFailed", {
            reason: "Interrupted by movement",
          });
          socket.send("showToast", {
            message: "Home teleport canceled",
            type: "info",
          });
        }
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
        // Cancel any pending attack, follow, trade, or home teleport when player moves elsewhere (OSRS behavior)
        if (socket.player) {
          this.pendingAttackManager.cancelPendingAttack(socket.player.id);
          this.followManager.stopFollowing(socket.player.id);
          this.pendingTradeManager.cancelPendingTrade(socket.player.id);
          const homeTeleportManager = getHomeTeleportManager();
          if (homeTeleportManager?.isCasting(socket.player.id)) {
            homeTeleportManager.cancelCasting(socket.player.id, "Player moved");
            socket.send("homeTeleportFailed", {
              reason: "Interrupted by movement",
            });
            socket.send("showToast", {
              message: "Home teleport canceled",
              type: "info",
            });
          }
        }
        this.actionQueue.queueMovement(socket, {
          target: payload.target,
          runMode: payload.runMode,
        });
      }
    };

    // Combat - server-authoritative "walk to and attack" system
    // OSRS-style: If in attack range, start combat immediately; otherwise queue pending attack
    // Melee range is CARDINAL ONLY for range 1, ranged/magic use Chebyshev distance
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

      // Get player's weapon range and attack type from equipment system
      const attackRange = this.getPlayerWeaponRange(playerEntity.id);
      const attackType = this.getPlayerAttackType(playerEntity.id);

      // Get tiles for range check
      const playerPos = playerEntity.position;
      const playerTile = worldToTile(playerPos.x, playerPos.z);
      const targetTile = worldToTile(
        mobEntity.position.x,
        mobEntity.position.z,
      );

      // Check if in attack range (melee uses cardinal-only, ranged/magic use Chebyshev)
      if (
        this.isInAttackRange(playerTile, targetTile, attackType, attackRange)
      ) {
        // In range - start combat immediately via action queue
        this.actionQueue.queueCombat(socket, data);
      } else {
        // Not in range - queue pending attack (server handles OSRS-style pathfinding)
        this.pendingAttackManager.queuePendingAttack(
          playerEntity.id,
          targetId,
          this.world.currentTick,
          attackRange,
          "mob",
          attackType,
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

      // Get player's weapon range and attack type from equipment system
      const attackRange = this.getPlayerWeaponRange(playerEntity.id);
      const attackType = this.getPlayerAttackType(playerEntity.id);

      // Get tiles for range check
      const playerPos = playerEntity.position;
      const playerTile = worldToTile(playerPos.x, playerPos.z);
      const targetTile = worldToTile(
        targetPlayer.position.x,
        targetPlayer.position.z,
      );

      // Check if in attack range (melee uses cardinal-only, ranged/magic use Chebyshev)
      if (
        this.isInAttackRange(playerTile, targetTile, attackType, attackRange)
      ) {
        // In range - validate zones and start combat immediately
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
          attackRange,
          "player", // PvP target type
          attackType,
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

    // Autocast spell selection (F2P magic combat)
    this.handlers["onSetAutocast"] = (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) return;

      const payload = data as { spellId?: string | null };
      const spellId = payload.spellId;

      // Validate spell ID if provided
      if (spellId !== null && spellId !== undefined) {
        if (typeof spellId !== "string" || spellId.length > 50) {
          return;
        }
      }

      // Emit event to update player's selected spell
      this.world.emit(EventType.PLAYER_SET_AUTOCAST, {
        playerId: playerEntity.id,
        spellId: spellId ?? null,
      });
    };

    this.handlers["onPickupItem"] = (socket, data) =>
      handlePickupItem(socket, data, this.world);

    this.handlers["onDropItem"] = (socket, data) =>
      handleDropItem(socket, data, this.world);

    this.handlers["onEquipItem"] = (socket, data) =>
      handleEquipItem(socket, data, this.world);

    this.handlers["onUseItem"] = (socket, data) =>
      handleUseItem(socket, data, this.world);

    this.handlers["onUnequipItem"] = (socket, data) =>
      handleUnequipItem(socket, data, this.world);

    this.handlers["onMoveItem"] = (socket, data) =>
      handleMoveItem(socket, data, this.world);

    this.handlers["onCoinPouchWithdraw"] = (socket, data) =>
      handleCoinPouchWithdraw(socket, data as { amount: number }, this.world);

    this.handlers["onXpLampUse"] = (socket, data) =>
      handleXpLampUse(socket, data, this.world);

    // Prayer handlers
    this.handlers["onPrayerToggle"] = (socket, data) =>
      handlePrayerToggle(socket, data, this.world);
    this.handlers["prayerToggle"] = this.handlers["onPrayerToggle"];

    this.handlers["onPrayerDeactivateAll"] = (socket, data) =>
      handlePrayerDeactivateAll(socket, data, this.world);
    this.handlers["prayerDeactivateAll"] =
      this.handlers["onPrayerDeactivateAll"];

    this.handlers["onAltarPray"] = (socket, data) =>
      handleAltarPray(socket, data, this.world);
    this.handlers["altarPray"] = this.handlers["onAltarPray"];

    // Magic handlers
    this.handlers["onSetAutocast"] = (socket, data) =>
      handleSetAutocast(socket, data, this.world);
    this.handlers["setAutocast"] = this.handlers["onSetAutocast"];

    // Action bar handlers
    this.handlers["onActionBarSave"] = (socket, data) =>
      handleActionBarSave(socket, data, this.world);
    this.handlers["actionBarSave"] = this.handlers["onActionBarSave"];

    this.handlers["onActionBarLoad"] = (socket, data) =>
      handleActionBarLoad(socket, data, this.world);
    this.handlers["actionBarLoad"] = this.handlers["onActionBarLoad"];

    // Player name change handler
    this.handlers["changePlayerName"] = (socket, data) =>
      handleChangePlayerName(
        socket,
        data,
        this.world,
        this.broadcastManager.sendToAll.bind(this.broadcastManager),
      );

    // Death/respawn handlers
    this.handlers["onRequestRespawn"] = (socket, _data) => {
      const playerEntity = socket.player;
      if (playerEntity) {
        // Validate player is actually dead before allowing respawn
        // This prevents clients from sending fake respawn requests
        const entityData = playerEntity.data as
          | { deathState?: DeathState }
          | undefined;
        const isDead =
          entityData?.deathState === DeathState.DYING ||
          entityData?.deathState === DeathState.DEAD;

        if (!isDead) {
          console.warn(
            `[ServerNetwork] Rejected respawn request from ${playerEntity.id} - player is not dead`,
          );
          return;
        }

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

    // Home teleport handlers
    this.handlers["onHomeTeleport"] = (socket, data) =>
      handleHomeTeleport(
        socket,
        data,
        this.world,
        this.tickSystem.getCurrentTick(),
      );
    this.handlers["homeTeleport"] = (socket, data) =>
      handleHomeTeleport(
        socket,
        data,
        this.world,
        this.tickSystem.getCurrentTick(),
      );

    this.handlers["onHomeTeleportCancel"] = (socket, data) =>
      handleHomeTeleportCancel(socket, data);
    this.handlers["homeTeleportCancel"] = (socket, data) =>
      handleHomeTeleportCancel(socket, data);

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

    // Agent thought sync handler - stores agent thought process for dashboard display
    this.handlers["onSyncAgentThought"] = (_socket, data) => {
      const thoughtData = data as {
        characterId?: string;
        thought: {
          id: string;
          type: "situation" | "evaluation" | "thinking" | "decision";
          content: string;
          timestamp: number;
        };
      };

      if (thoughtData.characterId && thoughtData.thought) {
        // Get existing thoughts or create new array
        const thoughts =
          ServerNetwork.agentThoughts.get(thoughtData.characterId) || [];

        // Add new thought at the beginning (most recent first)
        thoughts.unshift(thoughtData.thought);

        // Limit stored thoughts
        if (thoughts.length > ServerNetwork.MAX_THOUGHTS_PER_AGENT) {
          thoughts.length = ServerNetwork.MAX_THOUGHTS_PER_AGENT;
        }

        ServerNetwork.agentThoughts.set(thoughtData.characterId, thoughts);

        console.log(
          `[ServerNetwork] Agent thought synced for character ${thoughtData.characterId}: [${thoughtData.thought.type}]`,
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

    // Bank tab handlers
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

    // Bank placeholder handlers (RS3 style: qty=0 in bank_storage)
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

    // Bank handler aliases without "on" prefix for client compatibility
    // Client sends "bankDeposit", server has "onBankDeposit"
    this.handlers["bankOpen"] = this.handlers["onBankOpen"];
    this.handlers["bankDeposit"] = this.handlers["onBankDeposit"];
    this.handlers["bankWithdraw"] = this.handlers["onBankWithdraw"];
    this.handlers["bankDepositAll"] = this.handlers["onBankDepositAll"];
    this.handlers["bankDepositCoins"] = this.handlers["onBankDepositCoins"];
    this.handlers["bankWithdrawCoins"] = this.handlers["onBankWithdrawCoins"];
    this.handlers["bankClose"] = this.handlers["onBankClose"];
    this.handlers["bankMove"] = this.handlers["onBankMove"];
    this.handlers["bankCreateTab"] = this.handlers["onBankCreateTab"];
    this.handlers["bankDeleteTab"] = this.handlers["onBankDeleteTab"];
    this.handlers["bankMoveToTab"] = this.handlers["onBankMoveToTab"];
    this.handlers["bankWithdrawPlaceholder"] =
      this.handlers["onBankWithdrawPlaceholder"];
    this.handlers["bankReleasePlaceholder"] =
      this.handlers["onBankReleasePlaceholder"];
    this.handlers["bankReleaseAllPlaceholders"] =
      this.handlers["onBankReleaseAllPlaceholders"];
    this.handlers["bankToggleAlwaysPlaceholder"] =
      this.handlers["onBankToggleAlwaysPlaceholder"];
    this.handlers["bankWithdrawToEquipment"] =
      this.handlers["onBankWithdrawToEquipment"];
    this.handlers["bankDepositEquipment"] =
      this.handlers["onBankDepositEquipment"];
    this.handlers["bankDepositAllEquipment"] =
      this.handlers["onBankDepositAllEquipment"];

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

    this.handlers["onDialogueContinue"] = (socket, data) =>
      handleDialogueContinue(socket, data as { npcId: string }, this.world);

    this.handlers["onDialogueClose"] = (socket, data) =>
      handleDialogueClose(socket, data as { npcId: string }, this.world);

    // Quest handlers
    this.handlers["onGetQuestList"] = (socket, data) =>
      handleGetQuestList(socket, data as Record<string, unknown>, this.world);
    this.handlers["getQuestList"] = this.handlers["onGetQuestList"];

    this.handlers["onGetQuestDetail"] = (socket, data) =>
      handleGetQuestDetail(socket, data as { questId: string }, this.world);
    this.handlers["getQuestDetail"] = this.handlers["onGetQuestDetail"];

    this.handlers["onQuestAccept"] = (socket, data) =>
      handleQuestAccept(socket, data as { questId: string }, this.world);
    this.handlers["questAccept"] = this.handlers["onQuestAccept"];

    this.handlers["onQuestAbandon"] = (socket, data) =>
      handleQuestAbandon(socket, data as { questId: string }, this.world);
    this.handlers["questAbandon"] = this.handlers["onQuestAbandon"];

    this.handlers["onQuestComplete"] = (socket, data) =>
      handleQuestComplete(socket, data as { questId: string }, this.world);
    this.handlers["questComplete"] = this.handlers["onQuestComplete"];

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

    // Generic entity interaction handler - for entities like starter chests
    this.handlers["onEntityInteract"] = async (socket, data) => {
      const playerEntity = socket.player;
      if (!playerEntity) {
        console.warn(
          "[ServerNetwork] entityInteract: no player entity on socket",
        );
        return;
      }

      const payload = data as {
        entityId: string;
        interactionType?: string;
      };

      console.log(
        `[ServerNetwork] entityInteract received: entityId=${payload.entityId}, interactionType=${payload.interactionType}, playerId=${playerEntity.id}`,
      );

      if (!payload.entityId) {
        console.warn("[ServerNetwork] entityInteract missing entityId");
        return;
      }

      // Find the entity in the world
      const entity = this.world.entities.get(payload.entityId);
      if (!entity) {
        console.warn(
          `[ServerNetwork] entityInteract: entity ${payload.entityId} not found`,
        );
        return;
      }

      console.log(
        `[ServerNetwork] Found entity: type=${entity.type}, name=${entity.name}`,
      );

      // Check if entity has handleInteraction method
      const interactableEntity = entity as unknown as {
        handleInteraction?: (data: {
          playerId: string;
          entityId: string;
          interactionType: string;
          position: { x: number; y: number; z: number };
          playerPosition: { x: number; y: number; z: number };
        }) => Promise<void>;
      };

      if (typeof interactableEntity.handleInteraction === "function") {
        console.log(
          `[ServerNetwork] Calling handleInteraction on ${entity.type} entity`,
        );
        try {
          // Build full EntityInteractionData
          const entityPos = entity.position ?? { x: 0, y: 0, z: 0 };
          const playerPos = playerEntity.position ?? { x: 0, y: 0, z: 0 };

          await interactableEntity.handleInteraction({
            playerId: playerEntity.id,
            entityId: payload.entityId,
            interactionType: payload.interactionType || "interact",
            position: { x: entityPos.x, y: entityPos.y, z: entityPos.z },
            playerPosition: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
          });
          console.log(
            `[ServerNetwork] handleInteraction completed for ${entity.type}`,
          );
        } catch (err) {
          console.error(`[ServerNetwork] Error in entity interaction: ${err}`);
        }
      } else {
        console.warn(
          `[ServerNetwork] Entity ${payload.entityId} has no handleInteraction method`,
        );
      }
    };
    // Also register without "on" prefix for client compatibility
    this.handlers["entityInteract"] = this.handlers["onEntityInteract"];

    // Trade handlers
    this.handlers["onTradeRequest"] = (socket, data) =>
      handleTradeRequest(
        socket,
        data as { targetPlayerId: string },
        this.world,
      );

    this.handlers["tradeRequest"] = (socket, data) =>
      handleTradeRequest(
        socket,
        data as { targetPlayerId: string },
        this.world,
      );

    this.handlers["onTradeRequestRespond"] = (socket, data) =>
      handleTradeRequestRespond(
        socket,
        data as { tradeId: string; accept: boolean },
        this.world,
      );

    this.handlers["tradeRequestRespond"] = (socket, data) =>
      handleTradeRequestRespond(
        socket,
        data as { tradeId: string; accept: boolean },
        this.world,
      );

    this.handlers["onTradeAddItem"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade add item",
        );
        return;
      }
      handleTradeAddItem(
        socket,
        data as { tradeId: string; inventorySlot: number; quantity?: number },
        this.world,
        db,
      );
    };

    this.handlers["tradeAddItem"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade add item",
        );
        return;
      }
      handleTradeAddItem(
        socket,
        data as { tradeId: string; inventorySlot: number; quantity?: number },
        this.world,
        db,
      );
    };

    this.handlers["onTradeRemoveItem"] = (socket, data) =>
      handleTradeRemoveItem(
        socket,
        data as { tradeId: string; tradeSlot: number },
        this.world,
      );

    this.handlers["tradeRemoveItem"] = (socket, data) =>
      handleTradeRemoveItem(
        socket,
        data as { tradeId: string; tradeSlot: number },
        this.world,
      );

    this.handlers["onTradeSetItemQuantity"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade set quantity",
        );
        return;
      }
      handleTradeSetQuantity(
        socket,
        data as { tradeId: string; tradeSlot: number; quantity: number },
        this.world,
        db,
      );
    };

    this.handlers["tradeSetItemQuantity"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade set quantity",
        );
        return;
      }
      handleTradeSetQuantity(
        socket,
        data as { tradeId: string; tradeSlot: number; quantity: number },
        this.world,
        db,
      );
    };

    this.handlers["onTradeAccept"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade accept",
        );
        return;
      }
      handleTradeAccept(socket, data as { tradeId: string }, this.world, db);
    };

    this.handlers["tradeAccept"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for trade accept",
        );
        return;
      }
      handleTradeAccept(socket, data as { tradeId: string }, this.world, db);
    };

    this.handlers["onTradeCancelAccept"] = (socket, data) =>
      handleTradeCancelAccept(socket, data as { tradeId: string }, this.world);

    this.handlers["tradeCancelAccept"] = (socket, data) =>
      handleTradeCancelAccept(socket, data as { tradeId: string }, this.world);

    this.handlers["onTradeCancel"] = (socket, data) =>
      handleTradeCancel(socket, data as { tradeId: string }, this.world);

    this.handlers["tradeCancel"] = (socket, data) =>
      handleTradeCancel(socket, data as { tradeId: string }, this.world);

    // Duel handlers
    this.handlers["onDuelChallenge"] = (socket, data) =>
      handleDuelChallenge(
        socket,
        data as { targetPlayerId: string },
        this.world,
      );

    this.handlers["duel:challenge"] = (socket, data) =>
      handleDuelChallenge(
        socket,
        data as { targetPlayerId: string },
        this.world,
      );

    // Also register with "on" prefix (packet transformation adds this)
    this.handlers["onDuel:challenge"] = (socket, data) =>
      handleDuelChallenge(
        socket,
        data as { targetPlayerId: string },
        this.world,
      );

    this.handlers["onDuelChallengeRespond"] = (socket, data) =>
      handleDuelChallengeRespond(
        socket,
        data as { challengeId: string; accept: boolean },
        this.world,
      );

    this.handlers["duel:challenge:respond"] = (socket, data) =>
      handleDuelChallengeRespond(
        socket,
        data as { challengeId: string; accept: boolean },
        this.world,
      );

    // Also register with "on" prefix (packet transformation adds this)
    this.handlers["onDuel:challenge:respond"] = (socket, data) =>
      handleDuelChallengeRespond(
        socket,
        data as { challengeId: string; accept: boolean },
        this.world,
      );

    // Duel rules handlers (register with both formats for packet routing)
    this.handlers["duel:toggle:rule"] = (socket, data) =>
      handleDuelToggleRule(
        socket,
        data as { duelId: string; rule: keyof DuelRules },
        this.world,
      );
    this.handlers["onDuel:toggle:rule"] = this.handlers["duel:toggle:rule"];

    this.handlers["duel:toggle:equipment"] = (socket, data) =>
      handleDuelToggleEquipment(
        socket,
        data as { duelId: string; slot: DuelEquipmentSlot },
        this.world,
      );
    this.handlers["onDuel:toggle:equipment"] =
      this.handlers["duel:toggle:equipment"];

    this.handlers["duel:accept:rules"] = (socket, data) =>
      handleDuelAcceptRules(socket, data as { duelId: string }, this.world);
    this.handlers["onDuel:accept:rules"] = this.handlers["duel:accept:rules"];

    this.handlers["duel:cancel"] = (socket, data) =>
      handleDuelCancel(socket, data as { duelId: string }, this.world);
    this.handlers["onDuel:cancel"] = this.handlers["duel:cancel"];

    // Duel stakes handlers
    this.handlers["duel:add:stake"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for duel add stake",
        );
        return;
      }
      handleDuelAddStake(
        socket,
        data as { duelId: string; inventorySlot: number; quantity: number },
        this.world,
        db,
      );
    };
    this.handlers["onDuel:add:stake"] = this.handlers["duel:add:stake"];

    this.handlers["duel:remove:stake"] = (socket, data) => {
      const db = getDatabase(this.world);
      if (!db) {
        console.error(
          "[ServerNetwork] Database not available for duel remove stake",
        );
        return;
      }
      handleDuelRemoveStake(
        socket,
        data as { duelId: string; stakeIndex: number },
        this.world,
        db,
      );
    };
    this.handlers["onDuel:remove:stake"] = this.handlers["duel:remove:stake"];

    this.handlers["duel:accept:stakes"] = (socket, data) =>
      handleDuelAcceptStakes(socket, data as { duelId: string }, this.world);
    this.handlers["onDuel:accept:stakes"] = this.handlers["duel:accept:stakes"];

    this.handlers["duel:accept:final"] = (socket, data) =>
      handleDuelAcceptFinal(socket, data as { duelId: string }, this.world);
    this.handlers["onDuel:accept:final"] = this.handlers["duel:accept:final"];

    this.handlers["duel:forfeit"] = (socket, data) =>
      handleDuelForfeit(socket, data as { duelId: string }, this.world);
    this.handlers["onDuel:forfeit"] = this.handlers["duel:forfeit"];

    // Friend/Social handlers
    this.handlers["onFriendRequest"] = (socket, data) =>
      handleFriendRequest(socket, data as { targetName: string }, this.world);
    this.handlers["friendRequest"] = this.handlers["onFriendRequest"];

    this.handlers["onFriendAccept"] = (socket, data) =>
      handleFriendAccept(socket, data as { requestId: string }, this.world);
    this.handlers["friendAccept"] = this.handlers["onFriendAccept"];

    this.handlers["onFriendDecline"] = (socket, data) =>
      handleFriendDecline(socket, data as { requestId: string }, this.world);
    this.handlers["friendDecline"] = this.handlers["onFriendDecline"];

    this.handlers["onFriendRemove"] = (socket, data) =>
      handleFriendRemove(socket, data as { friendId: string }, this.world);
    this.handlers["friendRemove"] = this.handlers["onFriendRemove"];

    this.handlers["onIgnoreAdd"] = (socket, data) =>
      handleIgnoreAdd(socket, data as { targetName: string }, this.world);
    this.handlers["ignoreAdd"] = this.handlers["onIgnoreAdd"];

    this.handlers["onIgnoreRemove"] = (socket, data) =>
      handleIgnoreRemove(socket, data as { ignoredId: string }, this.world);
    this.handlers["ignoreRemove"] = this.handlers["onIgnoreRemove"];

    this.handlers["onPrivateMessage"] = (socket, data) =>
      handlePrivateMessage(
        socket,
        data as { targetName: string; content: string },
        this.world,
      );
    this.handlers["privateMessage"] = this.handlers["onPrivateMessage"];
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

    // Initialize home teleport manager with spawn point
    initHomeTeleportManager(
      this.world,
      this.spawn,
      this.broadcastManager.sendToAll.bind(this.broadcastManager),
    );

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
    // Destroy trading system first - cancels all active trades and clears cleanup interval
    if (this.tradingSystem) {
      this.tradingSystem.destroy();
    }

    // Destroy duel system - cancels all active duels and pending challenges
    if (this.duelSystem) {
      this.duelSystem.destroy();
    }

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

  /**
   * Get socket by player ID
   */
  getSocketByPlayerId(playerId: string): ServerSocket | undefined {
    // Try using BroadcastManager first
    if (this.broadcastManager?.getPlayerSocket) {
      return this.broadcastManager.getPlayerSocket(playerId);
    }

    // Fallback to searching sockets map
    for (const [, socket] of this.sockets) {
      if (socket.player?.id === playerId) {
        return socket;
      }
    }
    return undefined;
  }

  /**
   * Add staked items to a player's inventory (used for duel stake returns/awards)
   * Uses database directly to ensure items are properly persisted.
   */
  private async addStakedItemsToInventory(
    playerId: string,
    stakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>,
    reason: "return" | "award",
  ): Promise<void> {
    // Get database from world (same pattern as getDatabase helper)
    const serverWorld = this.world as {
      pgPool?: import("pg").Pool;
      drizzleDb?: import("drizzle-orm/node-postgres").NodePgDatabase<
        typeof import("../../database/schema")
      >;
    };

    if (!serverWorld.drizzleDb || !serverWorld.pgPool) {
      console.error("[Duel] Database not available for stake transfer");
      return;
    }

    const db = {
      drizzle: serverWorld.drizzleDb,
      pool: serverWorld.pgPool,
    };

    try {
      // Get inventory system for locking and reloading
      const inventorySystem = this.world.getSystem("inventory") as
        | {
            lockForTransaction: (id: string) => boolean;
            unlockTransaction: (id: string) => void;
            reloadFromDatabase: (id: string) => Promise<void>;
          }
        | undefined;

      // Lock inventory if system available
      const locked = inventorySystem?.lockForTransaction?.(playerId) ?? true;
      if (!locked) {
        console.warn(
          `[Duel] Could not lock inventory for ${playerId}, retrying...`,
        );
        // Retry after small delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      try {
        // Get current inventory to find free slots
        const inventoryRepo = new InventoryRepository(db.drizzle, db.pool);
        const currentInventory =
          await inventoryRepo.getPlayerInventoryAsync(playerId);
        const usedSlots = new Set(
          currentInventory.map((item) => item.slotIndex),
        );

        // Find free slots for new items
        const findFreeSlot = (): number => {
          for (let i = 0; i < 28; i++) {
            if (!usedSlots.has(i)) {
              usedSlots.add(i);
              return i;
            }
          }
          return -1; // No free slot
        };

        // Add each staked item to inventory
        for (const stake of stakes) {
          const freeSlot = findFreeSlot();
          if (freeSlot === -1) {
            console.warn(
              `[Duel] No free slot for stake item ${stake.itemId} x${stake.quantity} for ${playerId}`,
            );
            // TODO: Drop item on ground or send to bank
            continue;
          }

          // Check if item is stackable and already exists in inventory
          const existingItem = currentInventory.find(
            (item) => item.itemId === stake.itemId,
          );
          const itemData = getItem(stake.itemId);
          const isStackable = itemData?.stackable ?? false;

          if (isStackable && existingItem) {
            // Update existing stack
            await db.pool.query(
              `UPDATE inventory
               SET quantity = quantity + $1
               WHERE "playerId" = $2 AND "slotIndex" = $3`,
              [stake.quantity, playerId, existingItem.slotIndex],
            );
            console.log(
              `[Duel] Added ${stake.quantity} ${stake.itemId} to existing stack for ${playerId} (${reason})`,
            );
          } else {
            // Insert new item
            await db.pool.query(
              `INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
               VALUES ($1, $2, $3, $4, NULL)`,
              [playerId, stake.itemId, stake.quantity, freeSlot],
            );
            console.log(
              `[Duel] Added ${stake.itemId} x${stake.quantity} to slot ${freeSlot} for ${playerId} (${reason})`,
            );
          }
        }

        // Reload inventory from database (this triggers client sync)
        if (inventorySystem?.reloadFromDatabase) {
          await inventorySystem.reloadFromDatabase(playerId);
        }
      } finally {
        // Unlock inventory
        inventorySystem?.unlockTransaction?.(playerId);
      }
    } catch (error) {
      console.error(
        `[Duel] Error adding staked items to inventory for ${playerId}:`,
        error,
      );
    }
  }

  /**
   * Retry wrapper for executeDuelStakeTransfer.
   * Retries up to 3 times with exponential backoff [0, 1000, 3000]ms.
   * Ensures economic integrity even if the first attempt fails due to
   * transient errors (connection timeouts, lock contention).
   */
  private async executeDuelStakeTransferWithRetry(
    winnerId: string,
    loserId: string,
    stakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>,
  ): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [0, 1000, 3000];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(
            `[Duel] Settlement retry attempt ${attempt + 1}/${MAX_RETRIES} for ${winnerId} <- ${loserId}`,
          );
        }
        await this.executeDuelStakeTransfer(winnerId, loserId, stakes);
        return; // Success — exit retry loop
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES - 1;

        if (isLastAttempt) {
          console.error(
            `[Duel] CRITICAL: Settlement failed after ${MAX_RETRIES} attempts. ` +
              `Items remain with loser (crash-safe). winnerId=${winnerId}, loserId=${loserId}`,
            err,
          );
          // Notify players of permanent failure
          const winnerSocket = this.getSocketByPlayerId(winnerId);
          const loserSocket = this.getSocketByPlayerId(loserId);
          if (winnerSocket) {
            winnerSocket.send("chatAdded", {
              id: `duel-settle-fail-${Date.now()}`,
              from: "",
              body: "Duel stake transfer failed. Please contact support if items are missing.",
              createdAt: new Date().toISOString(),
              type: "system",
            });
          }
          if (loserSocket) {
            loserSocket.send("chatAdded", {
              id: `duel-settle-fail-${Date.now()}`,
              from: "",
              body: "Duel stake transfer failed. Your items were not taken.",
              createdAt: new Date().toISOString(),
              type: "system",
            });
          }
          throw err;
        }

        console.warn(
          `[Duel] Settlement attempt ${attempt + 1} failed, retrying in ${RETRY_DELAYS[attempt + 1]}ms:`,
          err instanceof Error ? err.message : err,
        );

        // Wait before retry
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS[attempt + 1]),
        );
      }
    }
  }

  /**
   * Execute atomic duel stake transfer from loser to winner.
   *
   * CRASH-SAFE: Items remain in loser's inventory until this atomic transaction.
   * If server crashes during duel, items are still in loser's inventory (no loss).
   *
   * Transaction:
   * 1. Validate items still exist in loser's inventory
   * 2. Remove items from loser's inventory
   * 3. Add items to winner's inventory
   * 4. Reload both inventories from DB
   */
  private async executeDuelStakeTransfer(
    winnerId: string,
    loserId: string,
    stakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>,
  ): Promise<void> {
    // Get database from world
    const serverWorld = this.world as {
      pgPool?: import("pg").Pool;
      drizzleDb?: import("drizzle-orm/node-postgres").NodePgDatabase<
        typeof import("../../database/schema")
      >;
    };

    if (!serverWorld.drizzleDb || !serverWorld.pgPool) {
      console.error("[Duel] Database not available for stake transfer");
      return;
    }

    const pool = serverWorld.pgPool;

    // Get inventory system for locking and reloading
    const inventorySystem = this.world.getSystem("inventory") as
      | {
          lockForTransaction: (id: string) => boolean;
          unlockTransaction: (id: string) => void;
          reloadFromDatabase: (id: string) => Promise<void>;
        }
      | undefined;

    // Lock both inventories
    const winnerLocked =
      inventorySystem?.lockForTransaction?.(winnerId) ?? true;
    const loserLocked = inventorySystem?.lockForTransaction?.(loserId) ?? true;

    if (!winnerLocked || !loserLocked) {
      console.warn(
        `[Duel] Could not lock inventories for transfer (winner: ${winnerLocked}, loser: ${loserLocked})`,
      );
      // Unlock any that were locked
      if (winnerLocked) inventorySystem?.unlockTransaction?.(winnerId);
      if (loserLocked) inventorySystem?.unlockTransaction?.(loserId);
      return;
    }

    try {
      // Deadlock retry: PostgreSQL 40P01 / serialization 40001
      const DEADLOCK_MAX_RETRIES = 3;
      const DEADLOCK_DELAYS = [50, 100, 200];

      for (
        let deadlockAttempt = 0;
        deadlockAttempt < DEADLOCK_MAX_RETRIES;
        deadlockAttempt++
      ) {
        try {
          // Execute atomic transfer in a single transaction
          await pool.query("BEGIN");

          // Get winner's current inventory to find free slots
          const winnerInvResult = await pool.query(
            `SELECT "slotIndex" FROM inventory WHERE "playerId" = $1`,
            [winnerId],
          );
          const usedSlots = new Set(
            winnerInvResult.rows.map((r: { slotIndex: number }) => r.slotIndex),
          );

          const findFreeSlot = (): number => {
            for (let i = 0; i < 28; i++) {
              if (!usedSlots.has(i)) {
                usedSlots.add(i);
                return i;
              }
            }
            return -1;
          };

          // Process each staked item
          for (const stake of stakes) {
            // 1. Validate item exists in loser's inventory at the exact slot
            const validateResult = await pool.query(
              `SELECT "itemId", quantity FROM inventory
             WHERE "playerId" = $1 AND "slotIndex" = $2
             FOR UPDATE`,
              [loserId, stake.inventorySlot],
            );

            if (validateResult.rows.length === 0) {
              console.error(
                `[Duel] SECURITY: Staked item not found in loser inventory! ` +
                  `loserId=${loserId}, slot=${stake.inventorySlot}, itemId=${stake.itemId}`,
              );
              // Item was removed/traded/dropped during duel - skip this item
              // This prevents dupe exploits
              continue;
            }

            const dbItem = validateResult.rows[0] as {
              itemId: string;
              quantity: number;
            };

            // Verify item ID matches
            if (dbItem.itemId !== stake.itemId) {
              console.error(
                `[Duel] SECURITY: Item ID mismatch! ` +
                  `Expected ${stake.itemId}, found ${dbItem.itemId} at slot ${stake.inventorySlot}`,
              );
              continue;
            }

            // SECURITY: Use actual DB quantity, not staked quantity.
            // If player consumed part of a stack during the duel (e.g. ate food),
            // we must only transfer what actually remains — not the originally staked amount.
            const transferQuantity = Math.min(stake.quantity, dbItem.quantity);
            if (transferQuantity <= 0) {
              console.warn(
                `[Duel] SECURITY: Staked item quantity is 0 — skipping. ` +
                  `loserId=${loserId}, slot=${stake.inventorySlot}, itemId=${stake.itemId}`,
              );
              continue;
            }

            // 2. Remove from loser's inventory
            if (dbItem.quantity <= transferQuantity) {
              // Remove entire item
              await pool.query(
                `DELETE FROM inventory WHERE "playerId" = $1 AND "slotIndex" = $2`,
                [loserId, stake.inventorySlot],
              );
            } else {
              // Reduce quantity
              await pool.query(
                `UPDATE inventory SET quantity = quantity - $1
               WHERE "playerId" = $2 AND "slotIndex" = $3`,
                [transferQuantity, loserId, stake.inventorySlot],
              );
            }

            // 3. Add to winner's inventory
            // Check if item is stackable and already exists
            const itemData = getItem(stake.itemId);
            const isStackable = itemData?.stackable ?? false;

            if (isStackable) {
              const existingResult = await pool.query(
                `SELECT "slotIndex" FROM inventory
               WHERE "playerId" = $1 AND "itemId" = $2
               FOR UPDATE`,
                [winnerId, stake.itemId],
              );

              if (existingResult.rows.length > 0) {
                // Add to existing stack — check for integer overflow first
                const existingSlot = (
                  existingResult.rows[0] as { slotIndex: number }
                ).slotIndex;
                const existingQty = (
                  existingResult.rows[0] as {
                    slotIndex: number;
                    quantity: number;
                  }
                ).quantity;
                if (existingQty > 2147483647 - transferQuantity) {
                  console.error(
                    `[Duel] SECURITY: Stack merge would overflow! ` +
                      `winnerId=${winnerId}, itemId=${stake.itemId}, ` +
                      `existing=${existingQty}, adding=${transferQuantity}`,
                  );
                  // Overflow: skip this item — it stays with the loser
                  continue;
                }
                await pool.query(
                  `UPDATE inventory SET quantity = quantity + $1
                 WHERE "playerId" = $2 AND "slotIndex" = $3`,
                  [transferQuantity, winnerId, existingSlot],
                );
                console.log(
                  `[Duel] Transferred ${transferQuantity} ${stake.itemId} from ${loserId} to ${winnerId} (stacked)`,
                );
                continue;
              }
            }

            // Find free slot and insert
            const freeSlot = findFreeSlot();
            if (freeSlot === -1) {
              // Inventory full - send to bank instead
              console.log(
                `[Duel] Winner inventory full, sending ${stake.itemId} x${transferQuantity} to bank`,
              );

              // Check if item already exists in bank (for stacking)
              const bankResult = await pool.query(
                `SELECT id, quantity FROM bank_storage
               WHERE "playerId" = $1 AND "itemId" = $2
               FOR UPDATE`,
                [winnerId, stake.itemId],
              );

              if (bankResult.rows.length > 0) {
                // Add to existing bank stack — check for integer overflow
                const bankRow = bankResult.rows[0] as {
                  id: string;
                  quantity: number;
                };
                if (bankRow.quantity > 2147483647 - transferQuantity) {
                  console.error(
                    `[Duel] SECURITY: Bank stack merge would overflow! ` +
                      `winnerId=${winnerId}, itemId=${stake.itemId}, ` +
                      `existing=${bankRow.quantity}, adding=${transferQuantity}`,
                  );
                  continue;
                }
                await pool.query(
                  `UPDATE bank_storage SET quantity = quantity + $1 WHERE id = $2`,
                  [transferQuantity, bankRow.id],
                );
              } else {
                // Find next available bank slot
                const maxSlotResult = await pool.query(
                  `SELECT COALESCE(MAX(slot), -1) + 1 as next_slot FROM bank_storage
                 WHERE "playerId" = $1 AND "tabIndex" = 0`,
                  [winnerId],
                );
                const nextSlot = (
                  maxSlotResult.rows[0] as { next_slot: number }
                ).next_slot;

                await pool.query(
                  `INSERT INTO bank_storage ("playerId", "itemId", quantity, slot, "tabIndex")
                 VALUES ($1, $2, $3, $4, 0)`,
                  [winnerId, stake.itemId, transferQuantity, nextSlot],
                );
              }
              console.log(
                `[Duel] Sent ${stake.itemId} x${transferQuantity} to ${winnerId}'s bank`,
              );
              continue;
            }

            await pool.query(
              `INSERT INTO inventory ("playerId", "itemId", quantity, "slotIndex", metadata)
             VALUES ($1, $2, $3, $4, NULL)`,
              [winnerId, stake.itemId, transferQuantity, freeSlot],
            );
            console.log(
              `[Duel] Transferred ${stake.itemId} x${transferQuantity} from ${loserId} to ${winnerId} slot ${freeSlot}`,
            );
          }

          // Commit the atomic transaction
          await pool.query("COMMIT");
          console.log(
            `[Duel] Stake transfer complete: ${stakes.length} items from ${loserId} to ${winnerId}`,
          );

          // Reload both inventories from database
          if (inventorySystem?.reloadFromDatabase) {
            await inventorySystem.reloadFromDatabase(winnerId);
            await inventorySystem.reloadFromDatabase(loserId);
          }

          // Notify both players of successful settlement
          const winnerSocket = this.getSocketByPlayerId(winnerId);
          const loserSocket = this.getSocketByPlayerId(loserId);
          if (winnerSocket) {
            winnerSocket.send("chatAdded", {
              id: `duel-win-${Date.now()}`,
              from: "",
              body: `You received your opponent's stakes (${stakes.length} item${stakes.length !== 1 ? "s" : ""}).`,
              createdAt: new Date().toISOString(),
              type: "system",
            });
          }
          if (loserSocket) {
            loserSocket.send("chatAdded", {
              id: `duel-loss-${Date.now()}`,
              from: "",
              body: "Your staked items have been transferred to the winner.",
              createdAt: new Date().toISOString(),
              type: "system",
            });
          }
          // Transaction succeeded — exit the deadlock retry loop
          return;
        } catch (error) {
          // Rollback on any error
          try {
            await pool.query("ROLLBACK");
          } catch (_rollbackErr) {
            // Rollback failed — connection may be broken
          }

          // Check for deadlock (40P01) or serialization failure (40001)
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const isDeadlock =
            errorMsg.includes("deadlock") ||
            errorMsg.includes("40P01") ||
            errorMsg.includes("could not serialize") ||
            errorMsg.includes("40001");

          if (isDeadlock && deadlockAttempt < DEADLOCK_MAX_RETRIES - 1) {
            const delay = DEADLOCK_DELAYS[deadlockAttempt];
            console.warn(
              `[Duel] Deadlock detected in stake transfer, retrying in ${delay}ms ` +
                `(attempt ${deadlockAttempt + 1}/${DEADLOCK_MAX_RETRIES})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue; // Retry the transaction
          }

          // Not a deadlock or last attempt — throw to outer handler
          throw error;
        }
      }
    } catch (error) {
      console.error("[Duel] Stake transfer transaction failed:", error);

      // Notify both players of transfer failure
      const winnerSocket = this.getSocketByPlayerId(winnerId);
      const loserSocket = this.getSocketByPlayerId(loserId);

      if (winnerSocket) {
        winnerSocket.send("chatAdded", {
          id: `duel-error-${Date.now()}`,
          from: "",
          body: "Failed to transfer duel stakes. Items remain with original owners.",
          createdAt: new Date().toISOString(),
          type: "system",
        });
      }
      if (loserSocket) {
        loserSocket.send("chatAdded", {
          id: `duel-error-${Date.now()}`,
          from: "",
          body: "Failed to transfer duel stakes. Your items were not taken.",
          createdAt: new Date().toISOString(),
          type: "system",
        });
      }
    } finally {
      // Always unlock both inventories
      inventorySystem?.unlockTransaction?.(winnerId);
      inventorySystem?.unlockTransaction?.(loserId);
    }
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

      // Debug: Log duel-related packets
      if (method.includes("duel") || method.includes("Duel")) {
        console.log(`[ServerNetwork] Received duel packet: ${method}`, data);
      }

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

  /**
   * Check if player has moderator permissions (mod or admin role)
   * Moderators can use advanced commands like /teleport
   */
  isMod(player: { data?: { roles?: string[] } }): boolean {
    return hasRole(player.data?.roles as string[] | undefined, "mod", "admin");
  }

  isBuilder(player: { data?: { roles?: string[] } }): boolean {
    return this.world.settings.public || this.isAdmin(player);
  }

  /**
   * Get player's attack range in tiles
   * Spell selection takes priority (magic range = 10)
   * Otherwise uses equipped weapon's attackRange from manifest
   * Returns 1 for unarmed (punching)
   */
  getPlayerWeaponRange(playerId: string): number {
    // Check if player has a spell selected - if so, use magic range regardless of weapon
    const playerEntity = this.world.getPlayer?.(playerId);
    const selectedSpell = (playerEntity?.data as { selectedSpell?: string })
      ?.selectedSpell;

    if (selectedSpell) {
      return 10; // Standard magic attack range
    }

    const equipmentSystem = this.world.getSystem("equipment") as
      | {
          getPlayerEquipment?: (id: string) => {
            weapon?: {
              item?: {
                attackRange?: number;
                attackType?: string;
                id?: string;
              };
            };
          } | null;
        }
      | undefined;

    if (equipmentSystem?.getPlayerEquipment) {
      const equipment = equipmentSystem.getPlayerEquipment(playerId);

      if (equipment?.weapon?.item) {
        const weaponItem = equipment.weapon.item;

        // OSRS-accurate: Magic weapons (staffs/wands) without autocast
        // default to melee range (1 tile bonk). The selectedSpell check above
        // already returns 10 for magic range when a spell is selected.
        const isMagicWeapon =
          String(weaponItem.attackType || "").toLowerCase() === "magic" ||
          (weaponItem.id &&
            String(getItem(weaponItem.id)?.attackType || "").toLowerCase() ===
              "magic");

        if (!isMagicWeapon) {
          // Non-magic weapons use their attackRange (e.g., bows)
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
        // Magic weapons without autocast fall through to melee range (1)
      }
    }

    // Default to 1 tile (unarmed/punching, or magic weapon without autocast)
    return 1;
  }

  /**
   * Get the attack type from the player's equipped weapon or selected spell
   * Returns AttackType.MELEE if no weapon or melee weapon equipped and no spell selected
   *
   * OSRS-accurate: You can cast spells without a staff - the staff just provides
   * magic attack bonus and elemental staves give infinite runes
   */
  getPlayerAttackType(playerId: string): AttackType {
    // Check if player has a spell selected - if so, use magic regardless of weapon
    const playerEntity = this.world.getPlayer?.(playerId);
    const selectedSpell = (playerEntity?.data as { selectedSpell?: string })
      ?.selectedSpell;

    if (selectedSpell) {
      return AttackType.MAGIC;
    }

    const equipmentSystem = this.world.getSystem("equipment") as
      | {
          getPlayerEquipment?: (id: string) => {
            weapon?: {
              item?: {
                attackType?: AttackType;
                weaponType?: WeaponType;
              };
            };
          } | null;
        }
      | undefined;

    if (equipmentSystem?.getPlayerEquipment) {
      const equipment = equipmentSystem.getPlayerEquipment(playerId);

      if (equipment?.weapon?.item) {
        const weaponItem = equipment.weapon.item;

        // Check explicit attackType first
        if (weaponItem.attackType) {
          // OSRS-accurate: Magic weapons (staffs/wands) without autocast use
          // melee crush attack (bonk). The selectedSpell check above already
          // returns MAGIC when a spell is selected.
          const isMagicAttackType =
            String(weaponItem.attackType).toLowerCase() === "magic";
          if (!isMagicAttackType) {
            return weaponItem.attackType as AttackType;
          }
          // Magic attack type without autocast → melee bonk
          return AttackType.MELEE;
        }

        // Fall back to weaponType for legacy compatibility
        if (weaponItem.weaponType === WeaponType.BOW) {
          return AttackType.RANGED;
        }
        // OSRS-accurate: Staffs/wands without autocast use melee (crush bonk)
        // The selectedSpell check above already handles the autocast case
        if (
          weaponItem.weaponType === WeaponType.STAFF ||
          weaponItem.weaponType === WeaponType.WAND
        ) {
          return AttackType.MELEE;
        }
      }
    }

    return AttackType.MELEE;
  }

  /**
   * Check if player is within attack range based on attack type
   * Melee uses cardinal-only for range 1, ranged/magic uses Chebyshev distance
   */
  isInAttackRange(
    attackerTile: { x: number; z: number },
    targetTile: { x: number; z: number },
    attackType: AttackType,
    range: number,
  ): boolean {
    if (attackType === AttackType.MELEE) {
      return tilesWithinMeleeRange(attackerTile, targetTile, range);
    }

    // Ranged/Magic use Chebyshev distance (8-directional)
    const distance = tileChebyshevDistance(attackerTile, targetTile);
    return distance <= range && distance > 0;
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
