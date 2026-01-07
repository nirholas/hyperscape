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

export class ProcessingSystem extends SystemBase {
  private activeFires = new Map<string, Fire>();
  private activeProcessing = new Map<string, ProcessingAction>();
  private fireCleanupTimers = new Map<string, NodeJS.Timeout>();
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
      (data: { playerId: string; fishSlot: number; fireId: string }) => {
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
          console.log(
            "[ProcessingSystem] 🔥 FIRE_CREATED received on client:",
            data,
          );
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
          console.log(
            "[ProcessingSystem] 💨 FIRE_EXTINGUISHED received on client:",
            data,
          );
          const fire = this.activeFires.get(data.fireId);
          if (fire) {
            fire.isActive = false;
            if (fire.mesh) {
              this.world.stage.scene.remove(fire.mesh);
            }
            this.activeFires.delete(data.fireId);
          }
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

    console.log("[ProcessingSystem] 🔥 startFiremaking called:", {
      playerId,
      logsId,
      logsSlot,
      tinderboxSlot,
    });

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
    // Check fire limit
    const playerFires = Array.from(this.activeFires.values()).filter(
      (fire) => fire.playerId === playerId && fire.isActive,
    );
    if (playerFires.length >= this.MAX_FIRES_PER_PLAYER) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You can only have ${this.MAX_FIRES_PER_PLAYER} fires lit at once.`,
        type: "error",
      });
      return;
    }

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

    // Get player position
    const player = this.world.getPlayer(playerId)!;

    // Start firemaking process - store string item IDs
    const processingAction: ProcessingAction = {
      playerId,
      actionType: "firemaking",
      primaryItem: { id: "tinderbox", slot: tinderboxSlot },
      targetItem: { id: logsId, slot: logsSlot },
      startTime: Date.now(),
      duration: this.FIREMAKING_TIME,
      xpReward: firemakingData.xp,
      skillRequired: "firemaking",
    };

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "You attempt to light the logs...",
      type: "info",
    });

    // OSRS: Player squats/crouches while lighting fire
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "squat",
    });

    // Complete after duration
    setTimeout(() => {
      // Re-fetch player at callback time - they may have disconnected
      const currentPlayer = this.world.getPlayer(playerId);
      if (!currentPlayer?.node?.position) {
        console.log(
          `[ProcessingSystem] Player ${playerId} disconnected during firemaking - cancelling`,
        );
        this.activeProcessing.delete(playerId);
        return;
      }

      // Verify player is still in activeProcessing (wasn't cancelled)
      if (!this.activeProcessing.has(playerId)) {
        console.log(
          `[ProcessingSystem] Firemaking was cancelled for ${playerId}`,
        );
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

    // Get the logs ID from the action (string item ID like "logs", "oak_logs", etc.)
    const logsId = action.targetItem!.id;
    const logsSlot = action.targetItem!.slot;

    console.log(
      "[ProcessingSystem] 🔥 completeFiremaking - checking inventory:",
      {
        playerId,
        logsId,
        logsSlot,
      },
    );

    // Directly complete the process - targeting system already validated items
    // Skip the broken callback pattern and just proceed
    this.completeFiremakingProcess(playerId, action, position);
  }

  private completeFiremakingProcess(
    playerId: string,
    action: ProcessingAction,
    position: { x: number; y: number; z: number },
  ): void {
    // Get string item ID from action
    const logsId = action.targetItem!.id;

    console.log(
      "[ProcessingSystem] 🔥 completeFiremakingProcess - removing logs:",
      {
        playerId,
        logsId,
        slot: action.targetItem!.slot,
      },
    );

    // Remove logs from inventory using string item ID
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: logsId,
      quantity: 1,
      slot: action.targetItem!.slot,
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
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "idle",
    });

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
    fireId: string;
  }): void {
    let { playerId, fishSlot, fireId } = data;

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

    console.log("[ProcessingSystem] 🍳 startCooking called:", {
      playerId,
      fishSlot,
      fireId,
    });

    // Check if player is already processing
    if (this.activeProcessing.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already doing something.",
        type: "error",
      });
      return;
    }

    // Check if fire exists and is active
    const fire = this.activeFires.get(fireId);
    if (!fire || !fire.isActive) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "That fire is no longer lit.",
        type: "error",
      });
      return;
    }

    // Start the cooking process directly
    this.startCookingProcess(playerId, fishSlot, fireId, true);
  }

  /**
   * Start cooking a single item.
   * @param isFirstCook - If true, show "You begin cooking" message. If false, cooking silently continues.
   */
  private startCookingProcess(
    playerId: string,
    fishSlot: number,
    fireId: string,
    isFirstCook: boolean = false,
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

    // Start cooking process - use actual item ID from inventory
    const processingAction: ProcessingAction = {
      playerId,
      actionType: "cooking",
      primaryItem: { id: rawItemId, slot: fishSlot },
      targetFire: fireId,
      startTime: Date.now(),
      duration: this.COOKING_TIME,
      xpReward: cookingData.xp,
      skillRequired: "cooking",
    };

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
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "squat",
    });

    // Complete after duration
    setTimeout(() => {
      // Verify player is still in activeProcessing (wasn't cancelled/disconnected)
      if (!this.activeProcessing.has(playerId)) {
        console.log(`[ProcessingSystem] Cooking was cancelled for ${playerId}`);
        return;
      }

      this.completeCooking(playerId, processingAction);
    }, this.COOKING_TIME);
  }

  private completeCooking(playerId: string, action: ProcessingAction): void {
    // Remove from active processing
    this.activeProcessing.delete(playerId);

    // Check if fire still exists
    const fire = this.activeFires.get(action.targetFire!);
    if (!fire || !fire.isActive) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "The fire goes out.",
        type: "error",
      });
      // Reset emote when fire goes out
      this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
        playerId,
        emote: "idle",
      });
      return;
    }

    // Complete this cook
    this.completeCookingProcess(playerId, action);

    // OSRS Auto-cooking: Check if player has more cookable items and continue
    this.tryAutoCookNext(playerId, action.targetFire!);
  }

  /**
   * Check if player has more cookable items and automatically continue cooking.
   * This implements OSRS-style auto-cooking where you cook all items until done.
   */
  private tryAutoCookNext(playerId: string, fireId: string): void {
    // Check if fire still active
    const fire = this.activeFires.get(fireId);
    if (!fire || !fire.isActive) {
      // Reset emote when fire goes out
      this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
        playerId,
        emote: "idle",
      });
      return; // Fire went out, stop cooking
    }

    // Check if player has more cookable items
    const nextSlot = this.findCookableSlot(playerId);
    if (nextSlot === -1) {
      // No more cookable items - cooking complete, reset emote
      this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
        playerId,
        emote: "idle",
      });
      return;
    }

    // Continue cooking the next one (not first cook, so no message)
    this.startCookingProcess(playerId, nextSlot, fireId, false);
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

    console.log("[ProcessingSystem] 🍳 completeCookingProcess:", {
      playerId,
      rawItemId,
      cookingLevel,
      burnChance: `${(burnChance * 100).toFixed(1)}%`,
      roll: roll.toFixed(3),
      didBurn,
      rawFishSlot: action.primaryItem.slot,
    });

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

    // Emit cooking completion event for test system observability
    this.emitTypedEvent(EventType.COOKING_COMPLETED, {
      playerId: playerId,
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

  private createFireVisual(fire: Fire): void {
    // Only create visuals on client
    if (!this.world.isClient) return;

    console.log("[ProcessingSystem] 🔥 createFireVisual called for:", fire.id);
    console.log(
      "[ProcessingSystem] 🔥 Scene available:",
      !!this.world.stage?.scene,
    );

    // Create fire mesh - orange glowing cube for now
    const fireGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
    const fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4500, // Orange red
      transparent: true,
      opacity: 0.8,
    });

    const fireMesh = new THREE.Mesh(fireGeometry, fireMaterial);
    fireMesh.name = `Fire_${fire.id}`;
    fireMesh.position.set(
      fire.position.x,
      fire.position.y + 0.4,
      fire.position.z,
    );
    fireMesh.userData = {
      type: "fire",
      entityId: fire.id, // RaycastService looks for entityId
      fireId: fire.id, // Keep for backwards compatibility
      playerId: fire.playerId,
      name: "Fire",
    };
    // Set layer 1 for raycasting (entities are on layer 1, matching other entities)
    fireMesh.layers.set(1);

    // Add flickering animation
    const animate = () => {
      if (fire.isActive) {
        fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
        requestAnimationFrame(animate);
      }
    };
    animate();

    fire.mesh = fireMesh as THREE.Object3D;

    // Add to scene - on client, scene MUST exist
    this.world.stage.scene.add(fireMesh);

    console.log("[ProcessingSystem] 🔥 Fire mesh added to scene:", {
      fireId: fire.id,
      position: fireMesh.position.toArray(),
      layers: fireMesh.layers.mask,
      userData: fireMesh.userData,
      inScene: this.world.stage.scene.children.includes(fireMesh),
    });
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

    // Remove visual and dispose THREE.js resources (only exists on client)
    if (fire.mesh && this.world.isClient) {
      this.world.stage.scene.remove(fire.mesh);

      // Dispose THREE.js resources to prevent GPU memory leak
      const mesh = fire.mesh as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          (mesh.material as THREE.Material).dispose();
        }
      }

      // Clear reference for GC
      fire.mesh = undefined;
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

    // Remove active processing
    this.activeProcessing.delete(playerId);

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
    console.log(
      `[ProcessingSystem] 🔥 Moving player ${playerId} after firemaking to (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`,
    );

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
        // 1 second grace period
        this.activeProcessing.delete(playerId);
      }
    }
  }

  // Empty lifecycle methods removed for cleaner code
}
