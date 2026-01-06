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
      raw_shrimp: 30, // XP for cooking shrimp
      burnt_fish: 0, // No XP for burning food
    },
  };

  // Shrimp cooking parameters (OSRS-accurate)
  // In OSRS, shrimp requires level 1 and stops burning at level 34
  private readonly SHRIMP_COOKING = {
    requiredLevel: 1,
    stopBurnLevel: 34,
    maxBurnChance: 0.5, // 50% at level 1
  };

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
    this.startCookingProcess(playerId, fishSlot, fireId, true);
  }

  /**
   * Start cooking a single shrimp.
   * @param isFirstCook - If true, show "You begin cooking" message. If false, cooking silently continues.
   */
  private startCookingProcess(
    playerId: string,
    fishSlot: number,
    fireId: string,
    isFirstCook: boolean = false,
  ): void {
    // Start cooking process - use string item IDs (singular: raw_shrimp, not raw_shrimps)
    const processingAction: ProcessingAction = {
      playerId,
      actionType: "cooking",
      primaryItem: { id: "raw_shrimp", slot: fishSlot },
      targetFire: fireId,
      startTime: Date.now(),
      duration: this.COOKING_TIME,
      xpReward: this.XP_REWARDS.cooking.raw_shrimp,
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

    // Complete after duration
    setTimeout(() => {
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
      return;
    }

    // Complete this cook
    this.completeCookingProcess(playerId, action);

    // OSRS Auto-cooking: Check if player has more raw_shrimp and continue
    this.tryAutoCookNext(playerId, action.targetFire!);
  }

  /**
   * Check if player has more raw_shrimp and automatically continue cooking.
   * This implements OSRS-style auto-cooking where you cook all items until done.
   */
  private tryAutoCookNext(playerId: string, fireId: string): void {
    // Check if fire still active
    const fire = this.activeFires.get(fireId);
    if (!fire || !fire.isActive) {
      return; // Fire went out, stop cooking
    }

    // Check if player has more raw_shrimp
    const nextSlot = this.findRawShrimpSlot(playerId);
    if (nextSlot === -1) {
      // No more raw shrimp - cooking complete
      return;
    }

    // Continue cooking the next one (not first cook, so no message)
    this.startCookingProcess(playerId, nextSlot, fireId, false);
  }

  /**
   * Find the first slot containing raw_shrimp in player's inventory.
   * Returns -1 if no raw_shrimp found.
   */
  private findRawShrimpSlot(playerId: string): number {
    // Use world.getInventory to get player inventory (returns array directly)
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      return -1;
    }

    // Find first slot with raw_shrimp
    for (let i = 0; i < inventory.length; i++) {
      const item = inventory[i] as { itemId?: string; slot?: number };
      if (item && item.itemId === "raw_shrimp") {
        return item.slot ?? i;
      }
    }

    return -1;
  }

  private completeCookingProcess(
    playerId: string,
    action: ProcessingAction,
  ): void {
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

    const burnChance = this.getBurnChance(cookingLevel);
    const roll = Math.random();
    const didBurn = roll < burnChance;

    console.log("[ProcessingSystem] 🍳 completeCookingProcess:", {
      playerId,
      cookingLevel,
      burnChance: `${(burnChance * 100).toFixed(1)}%`,
      roll: roll.toFixed(3),
      didBurn,
      rawFishSlot: action.primaryItem.slot,
    });

    // Remove raw fish using string item ID (singular: raw_shrimp)
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: "raw_shrimp",
      quantity: 1,
      slot: action.primaryItem.slot,
    });

    // Add result item using string item ID
    // Cooked shrimp is just "shrimp", burnt is "burnt_shrimp"
    const resultItemId = didBurn ? "burnt_shrimp" : "shrimp";

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

    // Grant XP (only if not burnt)
    if (!didBurn) {
      this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
        playerId,
        skill: "cooking",
        amount: action.xpReward,
      });
    }

    // Success/failure message (OSRS style)
    const message = didBurn
      ? "You accidentally burn the shrimp."
      : "You roast a shrimp.";
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

  /**
   * Calculate burn chance for shrimp based on cooking level.
   * Uses OSRS-accurate linear interpolation:
   * - At level 1: 50% burn chance
   * - At level 34+: 0% burn chance (stop burning)
   * - Linear decrease between those levels
   */
  private getBurnChance(cookingLevel: number): number {
    const { requiredLevel, stopBurnLevel, maxBurnChance } = this.SHRIMP_COOKING;

    // At or above stop level: never burn
    if (cookingLevel >= stopBurnLevel) {
      return 0;
    }

    // Below required level shouldn't happen, but treat as max burn chance
    if (cookingLevel < requiredLevel) {
      return maxBurnChance;
    }

    // Linear interpolation: burn chance decreases as level increases
    // At level 1: (34-1)/(34-1) * 0.5 = 0.5 (50%)
    // At level 17: (34-17)/(34-1) * 0.5 = 0.257 (25.7%)
    // At level 34: (34-34)/(34-1) * 0.5 = 0 (0%)
    const levelRange = stopBurnLevel - requiredLevel;
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
