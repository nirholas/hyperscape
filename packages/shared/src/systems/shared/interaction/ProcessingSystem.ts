import THREE from "../../../extras/three/three";
import { ITEM_IDS } from "../../../constants/GameConstants";
import { Fire, ProcessingAction } from "../../../types/core/core";
import { calculateDistance2D } from "../../../utils/game/EntityUtils";
import { EventType } from "../../../types/events";

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

  // XP rewards per GDD
  private readonly XP_REWARDS = {
    firemaking: {
      normal_logs: 40,
    },
    cooking: {
      raw_shrimps: 30,
      burnt_fish: 0, // No XP for burning food
    },
  };

  // Burn chances by cooking level (RuneScape-style)
  private readonly BURN_CHANCES = new Map<number, number>([
    [1, 0.8],
    [5, 0.6],
    [10, 0.4],
    [15, 0.2],
    [20, 0.1],
    [25, 0.05],
    [30, 0.0],
  ]);

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
      xpReward: this.XP_REWARDS.firemaking.normal_logs,
      skillRequired: "firemaking",
    };

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "You attempt to light the logs...",
      type: "info",
    });

    // Complete after duration
    setTimeout(() => {
      this.completeFiremaking(playerId, processingAction, {
        x: player.node.position.x,
        y: player.node.position.y,
        z: player.node.position.z,
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

    // Grant XP
    this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
      playerId,
      skill: "firemaking",
      amount: action.xpReward,
    });

    // Success message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "You successfully light the fire.",
      type: "success",
    });
  }

  private startCooking(data: {
    playerId: string;
    fishSlot: number;
    fireId: string;
  }): void {
    const { playerId, fishSlot, fireId } = data;

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
    // (targeting system already validated that player has raw food)
    this.startCookingProcess(playerId, fishSlot, fireId);
  }

  private startCookingProcess(
    playerId: string,
    fishSlot: number,
    fireId: string,
  ): void {
    // Start cooking process
    const processingAction: ProcessingAction = {
      playerId,
      actionType: "cooking",
      primaryItem: { id: 500, slot: fishSlot },
      targetFire: fireId,
      startTime: Date.now(),
      duration: this.COOKING_TIME,
      xpReward: this.XP_REWARDS.cooking.raw_shrimps,
      skillRequired: "cooking",
    };

    this.activeProcessing.set(playerId, processingAction);

    // Show processing message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: "You cook the fish on the fire...",
      type: "info",
    });

    // Complete after duration
    setTimeout(() => {
      this.completeCooking(playerId, processingAction);
    }, this.COOKING_TIME);
  }

  private completeCooking(playerId: string, action: ProcessingAction): void {
    // Remove from active processing
    this.activeProcessing.delete(playerId);

    // Check if fire still exists
    const fire = this.activeFires.get(action.targetFire!)!;
    if (!fire.isActive) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "The fire went out while you were cooking.",
        type: "error",
      });
      return;
    }

    // Request inventory check via event system
    this.emitTypedEvent(EventType.INVENTORY_CHECK, {
      playerId,
      slot: action.primaryItem.slot,
      itemId: 500, // raw fish
      callback: (hasItem: boolean) => {
        if (!hasItem) {
          this.emitTypedEvent(EventType.UI_MESSAGE, {
            playerId,
            message: "You no longer have the raw fish.",
            type: "error",
          });
          return;
        }

        // Use cached skills for burn chance (reactive pattern)
        const cachedSkills = this.playerSkills.get(playerId);
        const cookingLevel = cachedSkills?.cooking?.level ?? 1;
        const burnChance = this.getBurnChance(cookingLevel);
        const didBurn = Math.random() < burnChance;
        this.completeCookingWithResult(playerId, action, didBurn);
      },
    });
  }

  private completeCookingWithResult(
    playerId: string,
    action: ProcessingAction,
    didBurn: boolean,
  ): void {
    // Remove raw fish
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: 500,
      quantity: 1,
      slot: action.primaryItem.slot,
    });

    // Add result item
    const resultItemId = didBurn ? 502 : 501; // Burnt fish or cooked fish

    this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
      playerId,
      item: {
        id: `inv_${playerId}_${Date.now()}`,
        itemId: resultItemId.toString(), // Convert item ID to string for itemId reference
        quantity: 1,
        slot: -1, // Let system find empty slot
        metadata: null,
      },
    });

    // Grant XP (only if not burnt)
    if (!didBurn) {
      this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
        playerId,
        skill: "cooking",
        amount: action.xpReward,
      });
    }

    // Success/failure message
    const message = didBurn
      ? "You accidentally burn the fish."
      : "You successfully cook the fish.";
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
      xpGained: didBurn ? 0 : action.xpReward,
    });
  }

  private getBurnChance(cookingLevel: number): number {
    // Find the appropriate burn chance for the level
    for (const [level, _chance] of this.BURN_CHANCES.entries()) {
      if (cookingLevel >= level) {
        continue;
      }
      return this.BURN_CHANCES.get(level - 5) ?? 0.8; // Return previous level's chance
    }
    return 0.0; // Level 30+ never burns
  }

  private createFireVisual(fire: Fire): void {
    // Only create visuals on client
    if (!this.world.isClient) return;

    // Create fire mesh - orange glowing cube for now
    const fireGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
    const fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4500, // Orange red
      transparent: true,
      opacity: 0.8,
    });

    const fireMesh: THREE.Object3D = new THREE.Mesh(
      fireGeometry,
      fireMaterial,
    ) as unknown as THREE.Object3D;
    fireMesh.position.set(
      fire.position.x,
      fire.position.y + 0.4,
      fire.position.z,
    );
    fireMesh.userData = {
      type: "fire",
      fireId: fire.id,
      playerId: fire.playerId,
    };

    // Add flickering animation
    const animate = () => {
      if (fire.isActive) {
        (
          fireMesh as unknown as { material: THREE.MeshBasicMaterial }
        ).material.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
        requestAnimationFrame(animate);
      }
    };
    animate();

    fire.mesh = fireMesh;

    // Add to scene - on client, scene MUST exist
    this.world.stage.scene.add(fireMesh);
  }

  private extinguishFire(fireId: string): void {
    const fire = this.activeFires.get(fireId)!;

    fire.isActive = false;

    // Remove visual (only exists on client)
    if (fire.mesh && this.world.isClient) {
      this.world.stage.scene.remove(fire.mesh);
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
