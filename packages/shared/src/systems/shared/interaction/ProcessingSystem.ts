import THREE from "../../../extras/three/three";
import { ITEM_IDS } from "../../../constants/GameConstants";
import { Fire, ProcessingAction } from "../../../types/core/core";
import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import { calculateDistance2D } from "../../../utils/game/EntityUtils";
import { EventType } from "../../../types/events";
import {
  worldToTile,
  tileToWorld,
  type TileCoord,
} from "../../shared/movement/TileSystem";

/**
 * Processing System
 * Implements firemaking and cooking per GDD specifications:
 *
 * FIREMAKING:
 * - Use tinderbox on logs in inventory
 * - Creates fire object in world at player position
 * - Grants firemaking XP
 * - Fire lasts for limited time
 *
 * COOKING:
 * - Use raw fish on fire object
 * - Converts raw fish to cooked fish
 * - Grants cooking XP
 * - Can burn food at low levels
 */
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types/index";
import { getTargetValidator } from "./TargetValidator";
import { modelCache } from "../../../utils/rendering/ModelCache";
import type { GroundItemSystem } from "../economy/GroundItemSystem";

/**
 * Debug logging flag for processing system.
 * Set to true during development/testing for verbose output.
 * Should be false in production for performance.
 */
const DEBUG_PROCESSING = false;

export class ProcessingSystem extends SystemBase {
  // Fire visual constants
  private static readonly FIRE_MODEL_SCALE = 0.35;

  private static readonly FIRE_PARTICLE_SPAWN_Y = 0.1;
  private static readonly FIRE_PLACEHOLDER_Y_OFFSET = 0.4;

  // Shared fire particle resources (static, lazily initialized on client only)
  private static fireParticleGeometry: THREE.CircleGeometry | null = null;
  private static fireGlowTextures: Map<number, THREE.DataTexture> | null = null;

  private static getFireParticleGeometry(): THREE.CircleGeometry {
    if (!ProcessingSystem.fireParticleGeometry) {
      ProcessingSystem.fireParticleGeometry = new THREE.CircleGeometry(0.7, 12);
    }
    return ProcessingSystem.fireParticleGeometry;
  }

  private static getOrCreateGlowTexture(colorHex: number): THREE.DataTexture {
    if (!ProcessingSystem.fireGlowTextures) {
      ProcessingSystem.fireGlowTextures = new Map();
    }
    const cached = ProcessingSystem.fireGlowTextures.get(colorHex);
    if (cached) return cached;

    const size = 64;
    const sharpness = 2.0;
    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist);
        const strength = Math.pow(falloff, sharpness);
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * strength);
        data[idx + 1] = Math.round(g * strength);
        data[idx + 2] = Math.round(b * strength);
        data[idx + 3] = Math.round(255 * strength);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    ProcessingSystem.fireGlowTextures.set(colorHex, tex);
    return tex;
  }

  private activeFires = new Map<string, Fire>();
  private activeProcessing = new Map<string, ProcessingAction>();
  private fireCleanupTimers = new Map<string, NodeJS.Timeout>();
  private pendingFireModels = new Map<string, THREE.Object3D>();
  private playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  // Processing constants per GDD
  private readonly FIRE_DURATION = 120000; // 2 minutes
  private readonly FIREMAKING_TIME = 3000; // 3 seconds to light fire
  private readonly COOKING_TIME = 2000; // 2 seconds to cook fish
  private readonly MAX_FIRES_PER_PLAYER = 3;

  // NOTE: XP values and cooking parameters are now in the item manifest (items.json)
  // and accessed via ProcessingDataProvider at runtime.

  // OSRS firemaking movement priority: West → East → South → North
  // After lighting a fire, player moves to an adjacent tile in this priority order
  // @see https://oldschool.runescape.wiki/w/Firemaking
  private readonly FIREMAKING_MOVE_PRIORITY = [
    { dx: -1, dz: 0 }, // West (-X)
    { dx: 1, dz: 0 }, // East (+X)
    { dx: 0, dz: 1 }, // South (+Z in Three.js)
    { dx: 0, dz: -1 }, // North (-Z in Three.js)
  ];

  // ProcessingAction object pool (avoids allocation per action)
  private readonly actionPool: ProcessingAction[] = [];
  private readonly MAX_POOL_SIZE = 100;

  constructor(world: World) {
    super(world, {
      name: "processing",
      dependencies: {
        required: [],
        optional: ["inventory", "skills", "ui"],
      },
      autoCleanup: true,
    });
  }

  /**
   * Count active fires for a player without allocating arrays.
   * Replaces Array.from().filter() in hot path.
   */
  private countPlayerFires(playerId: string): number {
    let count = 0;
    for (const fire of this.activeFires.values()) {
      if (fire.playerId === playerId && fire.isActive) {
        count++;
      }
    }
    return count;
  }

  /**
   * Acquire a ProcessingAction from the pool (or create new).
   */
  private acquireAction(): ProcessingAction {
    if (this.actionPool.length > 0) {
      return this.actionPool.pop()!;
    }
    return {
      playerId: "",
      actionType: "firemaking",
      primaryItem: { id: "", slot: 0 },
      startTime: 0,
      duration: 0,
      xpReward: 0,
      skillRequired: "",
    };
  }

  /**
   * Release a ProcessingAction back to the pool for reuse.
   */
  private releaseAction(action: ProcessingAction): void {
    if (this.actionPool.length < this.MAX_POOL_SIZE) {
      // Reset to defaults
      action.playerId = "";
      action.targetItem = undefined;
      action.targetFire = undefined;
      this.actionPool.push(action);
    }
  }

  /**
   * Set player emote during processing (squat for cooking/firemaking)
   */
  private setProcessingEmote(playerId: string): void {
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "squat",
    });
  }

  /**
   * Reset player emote to idle (after processing completes or cancels)
   */
  private resetPlayerEmote(playerId: string): void {
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "idle",
    });
  }

  async init(): Promise<void> {
    // Listen for processing events via event bus
    this.subscribe(
      EventType.PROCESSING_FIREMAKING_REQUEST,
      (data: {
        playerId: string;
        logsId: string;
        logsSlot: number;
        tinderboxSlot: number;
      }) => {
        this.startFiremaking(data);
      },
    );
    this.subscribe(
      EventType.PROCESSING_COOKING_REQUEST,
      (data: {
        playerId: string;
        fishSlot: number;
        fireId?: string;
        rangeId?: string;
        sourceType?: "fire" | "range";
      }) => {
        this.startCooking(data);
      },
    );
    this.subscribe(EventType.ITEM_USE_ON_ITEM, (_data) => {
      // Item-on-item handling deferred to specific processing methods
      return;
    });
    this.subscribe(EventType.ITEM_USE_ON_FIRE, (_data) => {
      // Item-on-fire handled elsewhere in UI tests; skip to avoid type mismatch
      return;
    });
    this.subscribe(
      EventType.PLAYER_UNREGISTERED,
      (data: { playerId: string }) => this.cleanupPlayer({ id: data.playerId }),
    );
    // Listen for test event to extinguish fires early for testing
    this.subscribe(
      EventType.TEST_FIRE_EXTINGUISH,
      (data: { fireId: string }) => {
        this.extinguishFire(data.fireId);
      },
    );

    // Listen to skills updates for reactive patterns
    this.subscribe(
      EventType.SKILLS_UPDATED,
      (data: {
        playerId: string;
        skills: Record<
          | "attack"
          | "strength"
          | "defense"
          | "ranged"
          | "woodcutting"
          | "fishing"
          | "firemaking"
          | "cooking",
          { level: number; xp: number }
        >;
      }) => {
        this.playerSkills.set(data.playerId, data.skills);
      },
    );

    // Register as FireRegistry so TargetValidator knows about active fires
    const validator = getTargetValidator();
    validator.setFireRegistry({
      getActiveFireIds: () => this.getActiveFireIds(),
    });

    // CLIENT ONLY: Listen for fire created events from server to create visuals
    if (this.world.isClient) {
      this.subscribe(
        EventType.FIRE_CREATED,
        (data: {
          fireId: string;
          playerId: string;
          position: { x: number; y: number; z: number };
        }) => {
          if (DEBUG_PROCESSING) {
            console.log(
              "[ProcessingSystem] 🔥 FIRE_CREATED received on client:",
              data,
            );
          }
          // Create the fire data structure and visual
          const fire: Fire = {
            id: data.fireId,
            position: data.position,
            playerId: data.playerId,
            createdAt: Date.now(),
            duration: this.FIRE_DURATION,
            isActive: true,
          };
          this.activeFires.set(data.fireId, fire);
          this.createFireVisual(fire);
        },
      );

      this.subscribe(
        EventType.FIRE_EXTINGUISHED,
        (data: { fireId: string }) => {
          if (DEBUG_PROCESSING) {
            console.log(
              "[ProcessingSystem] 💨 FIRE_EXTINGUISHED received on client:",
              data,
            );
          }
          this.extinguishFire(data.fireId);
        },
      );

      // Load fire model when lighting starts (before fire is officially created)
      this.subscribe(
        EventType.FIRE_LIGHTING_STARTED,
        (data: {
          playerId: string;
          position: { x: number; y: number; z: number };
        }) => {
          this.loadFireModelForLighting(data.playerId, data.position);
        },
      );
    }
  }

  // Handle item-on-item interactions (tinderbox on logs)
  // Legacy method - kept for backwards compatibility with numeric item IDs
  private handleItemOnItem(data: {
    playerId: string;
    primaryItemId: number;
    primarySlot: number;
    targetItemId: number;
    targetSlot: number;
  }): void {
    const { playerId, primaryItemId, primarySlot, targetItemId, targetSlot } =
      data;

    // Check for tinderbox on logs
    if (
      primaryItemId === ITEM_IDS.TINDERBOX &&
      targetItemId === ITEM_IDS.LOGS
    ) {
      // Tinderbox on logs - use "logs" as default logsId for legacy path
      this.startFiremaking({
        playerId,
        logsId: "logs",
        logsSlot: targetSlot,
        tinderboxSlot: primarySlot,
      });
    }
    // Check for logs on tinderbox (reverse order)
    else if (
      primaryItemId === ITEM_IDS.LOGS &&
      targetItemId === ITEM_IDS.TINDERBOX
    ) {
      // Logs on tinderbox - use "logs" as default logsId for legacy path
      this.startFiremaking({
        playerId,
        logsId: "logs",
        logsSlot: primarySlot,
        tinderboxSlot: targetSlot,
      });
    }
  }

  // Handle item-on-fire interactions (raw fish on fire)
  private handleItemOnFire(data: {
    playerId: string;
    itemId: number;
    itemSlot: number;
    fireId: string;
  }): void {
    const { playerId, itemId, itemSlot, fireId } = data;

    // Check for raw fish on fire
    if (itemId === ITEM_IDS.RAW_FISH) {
      // Raw fish
      this.startCooking({
        playerId,
        fishSlot: itemSlot,
        fireId,
      });
    }
  }

  private startFiremaking(data: {
    playerId: string;
    logsId: string;
    logsSlot: number;
    tinderboxSlot: number;
  }): void {
    const { playerId, logsId, logsSlot, tinderboxSlot } = data;

    if (DEBUG_PROCESSING) {
      console.log("[ProcessingSystem] 🔥 startFiremaking called:", {
        playerId,
        logsId,
        logsSlot,
        tinderboxSlot,
      });
    }

    // Check if player is already processing
    if (this.activeProcessing.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already doing something.",
        type: "error",
      });
      return;
    }

    // Start the firemaking process directly
    // (targeting system already validated that player has logs and tinderbox)
    this.startFiremakingProcess(playerId, logsId, logsSlot, tinderboxSlot);
  }

  private startFiremakingProcess(
    playerId: string,
    logsId: string,
    logsSlot: number,
    tinderboxSlot: number,
  ): void {
    // Get firemaking data from manifest
    const firemakingData = processingDataProvider.getFiremakingData(logsId);
    if (!firemakingData) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You can't light that.",
        type: "error",
      });
      return;
    }

    // Check level requirement
    let firemakingLevel = 1;
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.firemaking?.level) {
      firemakingLevel = cachedSkills.firemaking.level;
    } else {
      const player = this.world.getPlayer(playerId);
      const playerSkills = (
        player as { skills?: Record<string, { level: number }> }
      )?.skills;
      if (playerSkills?.firemaking?.level) {
        firemakingLevel = playerSkills.firemaking.level;
      }
    }

    if (firemakingLevel < firemakingData.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${firemakingData.levelRequired} Firemaking to light those logs.`,
        type: "error",
      });
      return;
    }

    // Get player position (validated above)

    // Start firemaking process using pooled action object to reduce GC pressure
    const processingAction = this.acquireAction();
    processingAction.playerId = playerId;
    processingAction.actionType = "firemaking";
    processingAction.primaryItem = { id: "tinderbox", slot: tinderboxSlot };
    processingAction.targetItem = { id: logsId, slot: logsSlot };
    processingAction.startTime = Date.now();
    processingAction.duration = this.FIREMAKING_TIME;
    processingAction.xpReward = firemakingData.xp;
    processingAction.skillRequired = "firemaking";

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "You attempt to light the logs...",
      type: "info",
    });

    // OSRS: Player squats/crouches while lighting fire
    this.setProcessingEmote(playerId);

    // Notify clients to show fire model during lighting animation
    const player = this.world.getPlayer(playerId);
    if (player?.node?.position) {
      this.emitTypedEvent(EventType.FIRE_LIGHTING_STARTED, {
        playerId,
        position: {
          x: player.node.position.x,
          y: player.node.position.y,
          z: player.node.position.z,
        },
      });
    }

    // Complete after duration
    setTimeout(() => {
      // Re-fetch player at callback time - they may have disconnected
      const currentPlayer = this.world.getPlayer(playerId);
      if (!currentPlayer?.node?.position) {
        if (DEBUG_PROCESSING) {
          console.log(
            `[ProcessingSystem] Player ${playerId} disconnected during firemaking - cancelling`,
          );
        }
        const action = this.activeProcessing.get(playerId);
        this.activeProcessing.delete(playerId);
        if (action) this.releaseAction(action);
        return;
      }

      // Verify player is still in activeProcessing (wasn't cancelled)
      if (!this.activeProcessing.has(playerId)) {
        if (DEBUG_PROCESSING) {
          console.log(
            `[ProcessingSystem] Firemaking was cancelled for ${playerId}`,
          );
        }
        return;
      }

      this.completeFiremaking(playerId, processingAction, {
        x: currentPlayer.node.position.x,
        y: currentPlayer.node.position.y,
        z: currentPlayer.node.position.z,
      });
    }, this.FIREMAKING_TIME);
  }

  private completeFiremaking(
    playerId: string,
    action: ProcessingAction,
    position: { x: number; y: number; z: number },
  ): void {
    // Remove from active processing
    this.activeProcessing.delete(playerId);

    // Explicit null check instead of non-null assertion
    if (!action.targetItem) {
      console.error(
        `[ProcessingSystem] Firemaking action missing targetItem for ${playerId}`,
      );
      this.releaseAction(action);
      return;
    }

    // Get the logs ID from the action (string item ID like "logs", "oak_logs", etc.)
    const logsId = action.targetItem.id;
    const logsSlot = action.targetItem.slot;

    if (DEBUG_PROCESSING) {
      console.log(
        "[ProcessingSystem] 🔥 completeFiremaking - checking inventory:",
        {
          playerId,
          logsId,
          logsSlot,
        },
      );
    }

    // Directly complete the process - targeting system already validated items
    // Skip the broken callback pattern and just proceed
    this.completeFiremakingProcess(playerId, action, position);

    // Release action back to pool
    this.releaseAction(action);
  }

  private completeFiremakingProcess(
    playerId: string,
    action: ProcessingAction,
    position: { x: number; y: number; z: number },
  ): void {
    // Explicit null check instead of non-null assertion
    if (!action.targetItem) {
      console.error(
        `[ProcessingSystem] completeFiremakingProcess missing targetItem for ${playerId}`,
      );
      return;
    }

    // Get string item ID from action
    const logsId = action.targetItem.id;
    const logsSlot = action.targetItem.slot;

    if (DEBUG_PROCESSING) {
      console.log(
        "[ProcessingSystem] 🔥 completeFiremakingProcess - removing logs:",
        {
          playerId,
          logsId,
          slot: logsSlot,
        },
      );
    }

    // Remove logs from inventory using string item ID
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: logsId,
      quantity: 1,
      slot: logsSlot,
    });

    // Create fire
    const fireId = `fire_${playerId}_${Date.now()}`;
    const fire: Fire = {
      id: fireId,
      position,
      playerId,
      createdAt: Date.now(),
      duration: this.FIRE_DURATION,
      isActive: true,
    };

    // Create visual fire mesh
    this.createFireVisual(fire);

    this.activeFires.set(fireId, fire);

    // Add these events to make the system testable
    this.emitTypedEvent(EventType.FIRE_CREATED, {
      fireId: fire.id,
      playerId: fire.playerId,
      position: fire.position,
    });

    // Set fire cleanup timer
    const cleanupTimer = setTimeout(() => {
      this.extinguishFire(fireId);
    }, this.FIRE_DURATION);

    this.fireCleanupTimers.set(fireId, cleanupTimer);

    // OSRS: Reset emote when fire is lit (before moving)
    this.resetPlayerEmote(playerId);

    // OSRS: Move player to adjacent tile after lighting fire
    // Priority: West → East → South → North
    const moveTarget = this.findFiremakingMoveTarget(position);
    if (moveTarget) {
      this.movePlayerAfterFiremaking(playerId, moveTarget);
    }

    // Grant XP
    this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
      playerId,
      skill: "firemaking",
      amount: action.xpReward,
    });

    // Success message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "The fire catches and the logs begin to burn.",
      type: "success",
    });
  }

  private startCooking(data: {
    playerId: string;
    fishSlot: number;
    fireId?: string;
    rangeId?: string;
    sourceType?: "fire" | "range";
  }): void {
    const { playerId, fireId, rangeId, sourceType } = data;
    let { fishSlot } = data;

    // Determine cooking source ID
    const cookingSourceId = rangeId || fireId;
    const isRange = sourceType === "range" || !!rangeId;

    if (!cookingSourceId) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "No cooking source specified.",
        type: "error",
      });
      return;
    }

    // Handle fishSlot=-1: find first cookable item slot automatically
    if (fishSlot === -1) {
      fishSlot = this.findCookableSlot(playerId);
      if (fishSlot === -1) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "You have nothing to cook.",
          type: "error",
        });
        return;
      }
    }

    if (DEBUG_PROCESSING) {
      console.log("[ProcessingSystem] 🍳 startCooking called:", {
        playerId,
        fishSlot,
        sourceId: cookingSourceId,
        isRange,
      });
    }

    // Check if player is already processing
    if (this.activeProcessing.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already doing something.",
        type: "error",
      });
      return;
    }

    // For ranges, they're permanent and always active
    // For fires, check if fire exists and is active
    if (!isRange) {
      const fire = this.activeFires.get(cookingSourceId);
      if (!fire || !fire.isActive) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "That fire is no longer lit.",
          type: "error",
        });
        return;
      }
    }

    // Start the cooking process directly
    this.startCookingProcess(
      playerId,
      fishSlot,
      cookingSourceId,
      true,
      isRange,
    );
  }

  /**
   * Start cooking a single item.
   * @param isFirstCook - If true, show "You begin cooking" message. If false, cooking silently continues.
   * @param isRange - If true, cooking on a permanent range (always active).
   */
  private startCookingProcess(
    playerId: string,
    fishSlot: number,
    sourceId: string,
    isFirstCook: boolean = false,
    isRange: boolean = false,
  ): void {
    // Get the actual item ID from inventory
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      return;
    }

    const slotItem = inventory.find(
      (item: { slot?: number; itemId?: string }) => item?.slot === fishSlot,
    );

    if (!slotItem?.itemId) {
      return;
    }

    const rawItemId = String(slotItem.itemId);
    const cookingData = processingDataProvider.getCookingData(rawItemId);

    if (!cookingData) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You can't cook that.",
        type: "error",
      });
      return;
    }

    // Check level requirement
    let cookingLevel = 1;
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.cooking?.level) {
      cookingLevel = cachedSkills.cooking.level;
    } else {
      const player = this.world.getPlayer(playerId);
      const playerSkills = (
        player as { skills?: Record<string, { level: number }> }
      )?.skills;
      if (playerSkills?.cooking?.level) {
        cookingLevel = playerSkills.cooking.level;
      }
    }

    if (cookingLevel < cookingData.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${cookingData.levelRequired} Cooking to cook that.`,
        type: "error",
      });
      return;
    }

    // Start cooking process using pooled action object to reduce GC pressure
    const processingAction = this.acquireAction();
    processingAction.playerId = playerId;
    processingAction.actionType = "cooking";
    processingAction.primaryItem = { id: rawItemId, slot: fishSlot };
    processingAction.targetFire = sourceId;
    processingAction.startTime = Date.now();
    processingAction.duration = this.COOKING_TIME;
    processingAction.xpReward = cookingData.xp;
    processingAction.skillRequired = "cooking";
    // Store whether this is a range (always active) vs fire (can go out)
    (processingAction as ProcessingAction & { isRange?: boolean }).isRange =
      isRange;

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message only on first cook (OSRS style)
    if (isFirstCook) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You begin cooking...",
        type: "info",
      });
    }

    // OSRS: Player squats/crouches for each cook attempt
    this.setProcessingEmote(playerId);

    // Complete after duration
    setTimeout(() => {
      // Verify player is still in activeProcessing (wasn't cancelled/disconnected)
      if (!this.activeProcessing.has(playerId)) {
        if (DEBUG_PROCESSING) {
          console.log(
            `[ProcessingSystem] Cooking was cancelled for ${playerId}`,
          );
        }
        return;
      }

      this.completeCooking(playerId, processingAction);
    }, this.COOKING_TIME);
  }

  private completeCooking(playerId: string, action: ProcessingAction): void {
    // Remove from active processing
    this.activeProcessing.delete(playerId);

    // Explicit null check instead of non-null assertion
    if (!action.targetFire) {
      console.error(
        `[ProcessingSystem] Cooking action missing targetFire for ${playerId}`,
      );
      this.releaseAction(action);
      return;
    }

    // Store sourceId and isRange before any early returns (needed for auto-cook)
    const sourceId = action.targetFire;
    const isRange =
      (action as ProcessingAction & { isRange?: boolean }).isRange ?? false;

    // Check if cooking source still exists
    // Ranges are always active, fires can go out
    if (!isRange) {
      const fire = this.activeFires.get(sourceId);
      if (!fire || !fire.isActive) {
        this.emitTypedEvent(EventType.UI_MESSAGE, {
          playerId,
          message: "The fire goes out.",
          type: "error",
        });
        // Reset emote when fire goes out
        this.resetPlayerEmote(playerId);
        // Release action back to pool
        this.releaseAction(action);
        return;
      }
    }

    // Complete this cook
    this.completeCookingProcess(playerId, action);

    // Release action back to pool
    this.releaseAction(action);

    // OSRS Auto-cooking: Check if player has more cookable items and continue
    this.tryAutoCookNext(playerId, sourceId, isRange);
  }

  /**
   * Check if player has more cookable items and automatically continue cooking.
   * This implements OSRS-style auto-cooking where you cook all items until done.
   * @param isRange - If true, cooking on a permanent range (always active).
   */
  private tryAutoCookNext(
    playerId: string,
    sourceId: string,
    isRange: boolean = false,
  ): void {
    // Check if cooking source still active
    // Ranges are always active, fires can go out
    if (!isRange) {
      const fire = this.activeFires.get(sourceId);
      if (!fire || !fire.isActive) {
        // Reset emote when fire goes out
        this.resetPlayerEmote(playerId);
        return; // Fire went out, stop cooking
      }
    }

    // Check if player has more cookable items
    const nextSlot = this.findCookableSlot(playerId);
    if (nextSlot === -1) {
      // No more cookable items - cooking complete, reset emote
      this.resetPlayerEmote(playerId);
      return;
    }

    // Continue cooking the next one (not first cook, so no message)
    this.startCookingProcess(playerId, nextSlot, sourceId, false, isRange);
  }

  /**
   * Find the first slot containing any cookable item in player's inventory.
   * Uses ProcessingDataProvider (derived from items.json manifest) as source of truth.
   * Returns -1 if no cookable item found.
   */
  private findCookableSlot(playerId: string): number {
    // Use world.getInventory to get player inventory (returns array directly)
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      return -1;
    }

    // Find first slot with any cookable item (using manifest source of truth)
    for (let i = 0; i < inventory.length; i++) {
      const item = inventory[i] as { itemId?: string; slot?: number };
      if (
        item &&
        item.itemId &&
        processingDataProvider.isCookable(item.itemId)
      ) {
        return item.slot ?? i;
      }
    }

    return -1;
  }

  private completeCookingProcess(
    playerId: string,
    action: ProcessingAction,
  ): void {
    // Get the raw item ID from the action (ensure string)
    const rawItemId = String(action.primaryItem.id);
    const cookingData = processingDataProvider.getCookingData(rawItemId);

    if (!cookingData) {
      console.error(
        `[ProcessingSystem] No cooking data found for ${rawItemId}`,
      );
      return;
    }

    // Get cooking level - try cache first, then fall back to player entity
    let cookingLevel = 1;
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.cooking?.level) {
      cookingLevel = cachedSkills.cooking.level;
    } else {
      // Fallback: try to get from player entity directly
      const player = this.world.getPlayer(playerId);
      const playerSkills = (
        player as { skills?: Record<string, { level: number }> }
      )?.skills;
      if (playerSkills?.cooking?.level) {
        cookingLevel = playerSkills.cooking.level;
      }
    }

    // Calculate burn chance using manifest data
    const burnChance = this.getBurnChance(
      cookingLevel,
      cookingData.levelRequired,
      cookingData.stopBurnLevel.fire,
    );
    const roll = Math.random();
    const didBurn = roll < burnChance;

    if (DEBUG_PROCESSING) {
      console.log("[ProcessingSystem] 🍳 completeCookingProcess:", {
        playerId,
        rawItemId,
        cookingLevel,
        burnChance: `${(burnChance * 100).toFixed(1)}%`,
        roll: roll.toFixed(3),
        didBurn,
        rawFishSlot: action.primaryItem.slot,
      });
    }

    // Remove raw item using actual item ID from action
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: rawItemId,
      quantity: 1,
      slot: action.primaryItem.slot,
    });

    // Add result item using manifest data
    const resultItemId = didBurn
      ? cookingData.burntItemId
      : cookingData.cookedItemId;

    this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
      playerId,
      item: {
        id: `inv_${playerId}_${Date.now()}`,
        itemId: resultItemId,
        quantity: 1,
        slot: -1, // Let system find empty slot
        metadata: null,
      },
    });

    // Grant XP (only if not burnt) - use manifest XP value
    if (!didBurn) {
      this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
        playerId,
        skill: "cooking",
        amount: cookingData.xp,
      });
    }

    // Success/failure message (OSRS style) - use generic food name
    const foodName = rawItemId.replace("raw_", "");
    const message = didBurn
      ? `You accidentally burn the ${foodName}.`
      : `You roast a ${foodName}.`;
    const messageType = didBurn ? "warning" : "success";

    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: message,
      type: messageType,
    });

    // Emit cooking completion event for quest tracking and observability
    this.emitTypedEvent(EventType.COOKING_COMPLETED, {
      playerId: playerId,
      resultItemId: resultItemId,
      wasBurnt: didBurn,
      // Legacy fields for backwards compatibility
      result: didBurn ? "burnt" : "cooked",
      itemCreated: resultItemId,
      xpGained: didBurn ? 0 : cookingData.xp,
    });
  }

  /**
   * Calculate burn chance based on cooking level and food-specific parameters.
   * Uses OSRS-accurate linear interpolation.
   *
   * @param cookingLevel - Player's cooking level
   * @param requiredLevel - Level required to cook this food
   * @param stopBurnLevel - Level at which burning stops for this food
   * @param maxBurnChance - Maximum burn chance at minimum level (default 0.5 = 50%)
   */
  private getBurnChance(
    cookingLevel: number,
    requiredLevel: number,
    stopBurnLevel: number,
    maxBurnChance: number = 0.5,
  ): number {
    // At or above stop level: never burn
    if (cookingLevel >= stopBurnLevel) {
      return 0;
    }

    // Below required level shouldn't happen, but treat as max burn chance
    if (cookingLevel < requiredLevel) {
      return maxBurnChance;
    }

    // Linear interpolation: burn chance decreases as level increases
    const levelRange = stopBurnLevel - requiredLevel;
    if (levelRange <= 0) {
      return 0; // Edge case: stop burn level <= required level
    }

    const levelsUntilStopBurn = stopBurnLevel - cookingLevel;
    const burnChance = (levelsUntilStopBurn / levelRange) * maxBurnChance;

    return Math.max(0, Math.min(maxBurnChance, burnChance));
  }

  private async createFireVisual(fire: Fire): Promise<void> {
    // Only create visuals on client
    if (!this.world.isClient) return;

    if (DEBUG_PROCESSING) {
      console.log("[ProcessingSystem] createFireVisual called for:", fire.id);
    }

    let model: THREE.Object3D | null = null;

    // Check if we already loaded the model during the lighting phase
    const pending = this.pendingFireModels.get(fire.playerId);
    if (pending) {
      model = pending;
      this.pendingFireModels.delete(fire.playerId);
    } else {
      // Load model fresh (late join / missed lighting event)
      try {
        const result = await modelCache.loadModel(
          "asset://models/firemaking-fire/firemaking-fire.glb",
          this.world,
        );
        model = result.scene;
        const s = ProcessingSystem.FIRE_MODEL_SCALE;
        model.scale.set(s, s, s);
        // Bbox-snap: place model bottom on terrain
        const bbox = new THREE.Box3().setFromObject(model);
        model.position.set(
          fire.position.x,
          fire.position.y - bbox.min.y,
          fire.position.z,
        );
        this.world.stage.scene.add(model);
      } catch (err) {
        console.warn(
          "[ProcessingSystem] Failed to load fire model, using placeholder:",
          err,
        );
        this.createPlaceholderFireMesh(fire);
        return;
      }
    }

    // Guard: fire may have been extinguished during async model load
    if (!fire.isActive) {
      this.world.stage.scene.remove(model);
      return;
    }

    model.name = `Fire_${fire.id}`;
    model.userData = {
      type: "fire",
      entityId: fire.id,
      fireId: fire.id,
      playerId: fire.playerId,
      name: "Fire",
    };
    model.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        child.layers.set(1);
      }
    });

    fire.mesh = model;

    // Spawn particle fire effect rising from center of model
    this.createFireParticles(fire);
  }

  /**
   * Load fire GLB model during the 3s lighting animation (client-only).
   */
  private async loadFireModelForLighting(
    playerId: string,
    position: { x: number; y: number; z: number },
  ): Promise<void> {
    try {
      const result = await modelCache.loadModel(
        "asset://models/firemaking-fire/firemaking-fire.glb",
        this.world,
      );

      const model = result.scene;
      model.name = `FireLighting_${playerId}`;
      const s = ProcessingSystem.FIRE_MODEL_SCALE;
      model.scale.set(s, s, s);
      // Bbox-snap: place model bottom on terrain
      const bbox = new THREE.Box3().setFromObject(model);
      model.position.set(position.x, position.y - bbox.min.y, position.z);
      model.userData = { type: "fireLighting", playerId };
      model.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          child.layers.set(1);
        }
      });

      this.world.stage.scene.add(model);
      this.pendingFireModels.set(playerId, model);
    } catch (err) {
      console.warn(
        "[ProcessingSystem] Failed to load fire model for lighting:",
        err,
      );
    }
  }

  /**
   * Create billboard fire particle effect (client-only).
   * Uses manual billboard meshes with baked glow textures (same pattern as RunecraftingAltarEntity).
   */
  private createFireParticles(fire: Fire): void {
    if (!this.world.isClient) return;

    const PARTICLE_COUNT = 18;
    const meshes: THREE.Mesh[] = [];
    const geom = ProcessingSystem.getFireParticleGeometry();
    const colors = [0xff4400, 0xff6600, 0xff8800, 0xffaa00, 0xffcc00];

    // Per-particle state
    const ages = new Float32Array(PARTICLE_COUNT);
    const lifetimes = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const offsetsX = new Float32Array(PARTICLE_COUNT);
    const offsetsZ = new Float32Array(PARTICLE_COUNT);
    const baseScales = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      lifetimes[i] = 0.5 + Math.random() * 0.7;
      ages[i] = Math.random() * lifetimes[i]; // stagger
      speeds[i] = 0.6 + Math.random() * 0.8;
      offsetsX[i] = (Math.random() - 0.5) * 0.25;
      offsetsZ[i] = (Math.random() - 0.5) * 0.25;
      baseScales[i] = 0.18 + Math.random() * 0.22;

      const colorIdx = Math.floor(Math.random() * colors.length);
      const mat = new THREE.MeshBasicMaterial({
        map: ProcessingSystem.getOrCreateGlowTexture(colors[colorIdx]),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
      });

      const particle = new THREE.Mesh(geom, mat);
      particle.renderOrder = 999;
      particle.frustumCulled = false;
      particle.layers.set(1);
      this.world.stage.scene.add(particle);
      meshes.push(particle);
    }

    // Animation loop
    let lastTime = Date.now();
    let animFrameId: number | null = null;
    const camera = (this.world as { camera?: THREE.Camera }).camera;

    const animate = () => {
      if (!fire.isActive) {
        animFrameId = null;
        return;
      }

      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        ages[i] += dt;
        if (ages[i] >= lifetimes[i]) {
          ages[i] = 0;
          offsetsX[i] = (Math.random() - 0.5) * 0.25;
          offsetsZ[i] = (Math.random() - 0.5) * 0.25;
        }

        const t = ages[i] / lifetimes[i]; // 0..1
        const rise = t * speeds[i] * 0.7;

        meshes[i].position.set(
          fire.position.x + offsetsX[i] * (1 + t * 0.5),
          fire.position.y + ProcessingSystem.FIRE_PARTICLE_SPAWN_Y + rise,
          fire.position.z + offsetsZ[i] * (1 + t * 0.5),
        );

        // Fade in fast, fade out near end
        const fadeIn = Math.min(t * 6, 1);
        const fadeOut = Math.pow(1 - t, 1.5);
        (meshes[i].material as THREE.MeshBasicMaterial).opacity =
          0.75 * fadeIn * fadeOut;

        // Shrink as particle rises
        const scale = baseScales[i] * (1 - t * 0.4);
        meshes[i].scale.set(scale, scale * 1.3, scale);

        // Billboard: face camera
        if (camera) {
          meshes[i].quaternion.copy(camera.quaternion);
        }
      }

      animFrameId = requestAnimationFrame(animate);
    };

    if (typeof requestAnimationFrame !== "undefined") {
      animate();
    }

    // Store cleanup function and mesh references on fire object
    const fireExt = fire as {
      fireParticleMeshes?: THREE.Mesh[];
      cancelFireParticles?: () => void;
    };
    fireExt.fireParticleMeshes = meshes;
    fireExt.cancelFireParticles = () => {
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      for (const mesh of meshes) {
        this.world.stage.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
    };
  }

  /**
   * Fallback placeholder fire mesh (orange box) when GLB model fails to load.
   */
  private createPlaceholderFireMesh(fire: Fire): void {
    const fireGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
    const fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4500,
      transparent: true,
      opacity: 0.8,
    });

    const fireMesh = new THREE.Mesh(fireGeometry, fireMaterial);
    fireMesh.name = `Fire_${fire.id}`;
    fireMesh.position.set(
      fire.position.x,
      fire.position.y + ProcessingSystem.FIRE_PLACEHOLDER_Y_OFFSET,
      fire.position.z,
    );
    fireMesh.userData = {
      type: "fire",
      entityId: fire.id,
      fireId: fire.id,
      playerId: fire.playerId,
      name: "Fire",
    };
    fireMesh.layers.set(1);

    let animationFrameId: number | null = null;
    if (typeof requestAnimationFrame !== "undefined") {
      const animate = () => {
        if (fire.isActive && fire.mesh) {
          fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
          animationFrameId = requestAnimationFrame(animate);
        } else {
          animationFrameId = null;
        }
      };
      animate();
    }

    (fire as { cancelAnimation?: () => void }).cancelAnimation = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    fire.mesh = fireMesh as THREE.Object3D;
    this.world.stage.scene.add(fireMesh);
  }

  private extinguishFire(fireId: string): void {
    const fire = this.activeFires.get(fireId);

    // Guard: Fire may not exist (already extinguished or never created)
    if (!fire) {
      console.warn(
        `[ProcessingSystem] Attempted to extinguish non-existent fire: ${fireId}`,
      );
      return;
    }

    // Guard: Prevent double cleanup
    if (!fire.isActive) {
      return;
    }

    fire.isActive = false;

    // Cancel animation before removing mesh to prevent requestAnimationFrame leak
    const fireWithAnimation = fire as { cancelAnimation?: () => void };
    fireWithAnimation.cancelAnimation?.();

    // Destroy fire particle meshes
    const fireWithParticles = fire as { cancelFireParticles?: () => void };
    if (fireWithParticles.cancelFireParticles) {
      fireWithParticles.cancelFireParticles();
      fireWithParticles.cancelFireParticles = undefined;
    }

    // Remove visual and dispose THREE.js resources (only exists on client)
    if (fire.mesh && this.world.isClient) {
      this.world.stage.scene.remove(fire.mesh);

      // Traverse and dispose all geometries and materials (GLB models have multiple children)
      fire.mesh.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            for (const mat of materials) {
              if (!modelCache.isManagedMaterial(mat as THREE.Material)) {
                (mat as THREE.Material).dispose();
              }
            }
          }
        }
      });

      // Clear reference for GC
      fire.mesh = undefined;
    }

    // Spawn ashes at fire position (server-only, OSRS: fires leave ashes when they burn out)
    if (this.world.isServer) {
      const groundItems =
        this.world.getSystem<GroundItemSystem>("ground-items");
      if (groundItems) {
        groundItems.spawnGroundItem("ashes", 1, fire.position, {
          despawnTime: 120000, // 2 minutes
        });
      }
    }

    this.activeFires.delete(fireId);

    // cleanup timer
    clearTimeout(this.fireCleanupTimers.get(fireId));
    this.fireCleanupTimers.delete(fireId);

    // Emit event for test system observability
    this.emitTypedEvent(EventType.FIRE_EXTINGUISHED, {
      fireId: fireId,
    });
  }

  private cleanupPlayer(data: { id: string }): void {
    const playerId = data.id;

    // Remove active processing and release action to pool
    const action = this.activeProcessing.get(playerId);
    this.activeProcessing.delete(playerId);
    if (action) this.releaseAction(action);

    // Remove pending fire model (cancelled during lighting)
    const pendingModel = this.pendingFireModels.get(playerId);
    if (pendingModel && this.world.isClient) {
      this.world.stage.scene.remove(pendingModel);
      this.pendingFireModels.delete(playerId);
    }

    // Extinguish player's fires
    for (const [fireId, fire] of this.activeFires.entries()) {
      if (fire.playerId === playerId) {
        this.extinguishFire(fireId);
      }
    }
  }

  // Public API

  /**
   * Get IDs of all active fires (for TargetValidator FireRegistry)
   */
  getActiveFireIds(): string[] {
    return Array.from(this.activeFires.entries())
      .filter(([_, fire]) => fire.isActive)
      .map(([id]) => id);
  }

  getActiveFires(): Map<string, Fire> {
    return new Map(this.activeFires);
  }

  getFires(): Fire[] {
    return Array.from(this.activeFires.values());
  }

  getPlayerFires(playerId: string): Fire[] {
    return Array.from(this.activeFires.values()).filter(
      (fire) => fire.playerId === playerId && fire.isActive,
    );
  }

  isPlayerProcessing(playerId: string): boolean {
    return this.activeProcessing.has(playerId);
  }

  getFiresInRange(
    position: { x: number; y: number; z: number },
    range: number,
  ): Fire[] {
    return Array.from(this.activeFires.values()).filter((fire) => {
      if (!fire.isActive) return false;
      const distance = calculateDistance2D(fire.position, position);
      return distance <= range;
    });
  }

  /**
   * Check if there's an active fire at a given tile position
   */
  hasFireAtTile(tile: TileCoord): boolean {
    for (const [, fire] of this.activeFires) {
      if (!fire.isActive) continue;
      const fireTile = worldToTile(fire.position.x, fire.position.z);
      if (fireTile.x === tile.x && fireTile.z === tile.z) {
        return true;
      }
    }
    return false;
  }

  // === FIREMAKING MOVEMENT (OSRS-accurate) ===

  /**
   * Find the tile to move to after lighting a fire (OSRS-accurate)
   * Priority: West → East → South → North
   *
   * @see https://oldschool.runescape.wiki/w/Firemaking
   */
  private findFiremakingMoveTarget(firePosition: {
    x: number;
    y: number;
    z: number;
  }): { x: number; y: number; z: number } | null {
    const fireTile = worldToTile(firePosition.x, firePosition.z);

    for (const offset of this.FIREMAKING_MOVE_PRIORITY) {
      const targetTile: TileCoord = {
        x: fireTile.x + offset.dx,
        z: fireTile.z + offset.dz,
      };

      // Check if tile is walkable (no fires, no terrain blockers)
      if (this.isTileWalkableForFiremaking(targetTile)) {
        const worldPos = tileToWorld(targetTile);
        return { x: worldPos.x, y: firePosition.y, z: worldPos.z };
      }
    }

    // All 4 directions blocked - stay in place
    return null;
  }

  /**
   * Check if a tile is walkable for firemaking movement
   */
  private isTileWalkableForFiremaking(tile: TileCoord): boolean {
    // Check for existing fires at this tile
    if (this.hasFireAtTile(tile)) {
      return false;
    }

    // TODO: Check terrain walkability via TerrainSystem if available
    // const terrain = this.world.getSystem('terrain');
    // if (terrain && !terrain.isWalkable(tile.x, tile.z)) return false;

    return true;
  }

  /**
   * Move player to target tile after lighting fire
   * Emits FIREMAKING_MOVE_REQUEST event for ServerNetwork to handle via playerTeleport packet
   */
  private movePlayerAfterFiremaking(
    playerId: string,
    target: { x: number; y: number; z: number },
  ): void {
    if (DEBUG_PROCESSING) {
      console.log(
        `[ProcessingSystem] 🔥 Moving player ${playerId} after firemaking to (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`,
      );
    }

    // Emit event for ServerNetwork to handle - it will send playerTeleport packet
    // which properly syncs position to client and resets tile movement state
    this.emitTypedEvent(EventType.FIREMAKING_MOVE_REQUEST, {
      playerId,
      position: { x: target.x, y: target.y, z: target.z },
    });
  }

  destroy(): void {
    // Clean up all fires
    for (const fireId of this.activeFires.keys()) {
      this.extinguishFire(fireId);
    }

    // Clean up pending fire models
    if (this.world.isClient) {
      for (const model of this.pendingFireModels.values()) {
        this.world.stage.scene.remove(model);
      }
    }
    this.pendingFireModels.clear();

    // Clear timers
    this.fireCleanupTimers.forEach((timer) => clearTimeout(timer));

    this.activeProcessing.clear();
    this.fireCleanupTimers.clear();
  }

  // Required System lifecycle methods
  update(_dt: number): void {
    // Check for expired processing actions
    const now = Date.now();
    for (const [playerId, action] of this.activeProcessing.entries()) {
      if (now - action.startTime > action.duration + 1000) {
        // 1 second grace period - release action back to pool
        this.activeProcessing.delete(playerId);
        this.releaseAction(action);
      }
    }
  }

  // Empty lifecycle methods removed for cleaner code
}
