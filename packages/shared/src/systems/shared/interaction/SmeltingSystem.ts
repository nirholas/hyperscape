/**
 * SmeltingSystem - Handles Smelting at Furnaces
 *
 * OSRS-accurate smelting implementation:
 * - Use ores on furnace to smelt bars
 * - Consumes primary ore, secondary ore (bronze), and coal
 * - Iron ore has 50% success rate (others always succeed)
 * - Grants smithing XP on successful smelt
 * - Auto-smelting continues until out of materials
 *
 * @see https://oldschool.runescape.wiki/w/Smithing#Smelting
 * @see ProcessingDataProvider for smelting recipes from manifest
 */

import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import { EventType } from "../../../types/events";
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types/index";

/** Active smelting session for a player */
interface SmeltingSession {
  playerId: string;
  barItemId: string;
  furnaceId: string;
  startTime: number;
  quantity: number;
  smelted: number;
  failed: number;
}

/** Smelting timing constants (in milliseconds) */
const SMELTING_TIME = 2400; // ~4 game ticks per bar

export class SmeltingSystem extends SystemBase {
  private activeSessions = new Map<string, SmeltingSession>();
  private playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  constructor(world: World) {
    super(world, {
      name: "smelting",
      dependencies: {
        required: [],
        optional: ["inventory", "skills"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Listen for smelting interaction (player clicked furnace)
    this.subscribe(
      EventType.SMELTING_INTERACT,
      (data: { playerId: string; furnaceId: string }) => {
        this.handleFurnaceInteract(data);
      },
    );

    // Listen for smelting request (player selected bar to smelt)
    this.subscribe(
      EventType.PROCESSING_SMELTING_REQUEST,
      (data: {
        playerId: string;
        barItemId: string;
        furnaceId: string;
        quantity: number;
      }) => {
        this.startSmelting(data);
      },
    );

    // Listen for skills updates
    this.subscribe(
      EventType.SKILLS_UPDATED,
      (data: {
        playerId: string;
        skills: Record<string, { level: number; xp: number }>;
      }) => {
        this.playerSkills.set(data.playerId, data.skills);
      },
    );

    // Clean up on player disconnect
    this.subscribe(
      EventType.PLAYER_UNREGISTERED,
      (data: { playerId: string }) => {
        this.cancelSmelting(data.playerId);
      },
    );
  }

  /**
   * Handle furnace interaction - show available bars to smelt
   */
  private handleFurnaceInteract(data: {
    playerId: string;
    furnaceId: string;
  }): void {
    const { playerId, furnaceId } = data;

    // Check if already smelting
    if (this.activeSessions.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already smelting.",
        type: "error",
      });
      return;
    }

    // Get player inventory
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You have no items.",
        type: "error",
      });
      return;
    }

    // Get player smithing level
    const smithingLevel = this.getSmithingLevel(playerId);

    // Get available bars to smelt
    const availableBars = processingDataProvider.getSmeltableBarsFromInventory(
      inventory.map((item: { itemId: string; quantity?: number }) => ({
        itemId: item.itemId,
        quantity: item.quantity || 1,
      })),
      smithingLevel,
    );

    if (availableBars.length === 0) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You don't have the ores to smelt anything.",
        type: "error",
      });
      return;
    }

    // Emit event with available bars for UI to display
    this.emitTypedEvent(EventType.SMELTING_INTERACT, {
      playerId,
      furnaceId,
      availableBars: availableBars.map((bar) => ({
        barItemId: bar.barItemId,
        levelRequired: bar.levelRequired,
        primaryOre: bar.primaryOre,
        secondaryOre: bar.secondaryOre,
        coalRequired: bar.coalRequired,
      })),
    });
  }

  /**
   * Start smelting a specific bar type
   */
  private startSmelting(data: {
    playerId: string;
    barItemId: string;
    furnaceId: string;
    quantity: number;
  }): void {
    const { playerId, barItemId, furnaceId, quantity } = data;

    // Check if already smelting
    if (this.activeSessions.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already smelting.",
        type: "error",
      });
      return;
    }

    // Validate smelting data exists
    const smeltingData = processingDataProvider.getSmeltingData(barItemId);
    if (!smeltingData) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "Invalid bar type.",
        type: "error",
      });
      return;
    }

    // Check level requirement
    const smithingLevel = this.getSmithingLevel(playerId);
    if (smithingLevel < smeltingData.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${smeltingData.levelRequired} Smithing to smelt that.`,
        type: "error",
      });
      return;
    }

    // Create session
    const session: SmeltingSession = {
      playerId,
      barItemId,
      furnaceId,
      startTime: Date.now(),
      quantity: Math.max(1, quantity),
      smelted: 0,
      failed: 0,
    };

    this.activeSessions.set(playerId, session);

    // Show start message
    const barName = barItemId.replace("_bar", " bar");
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: `You begin smelting ${barName}s.`,
      type: "info",
    });

    // Emit start event
    this.emitTypedEvent(EventType.SMELTING_START, {
      playerId,
      barItemId,
      furnaceId,
    });

    // Start first smelt
    this.processNextSmelt(playerId);
  }

  /**
   * Process the next smelt in the session
   */
  private processNextSmelt(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    // Check if we've reached the target quantity
    if (session.smelted + session.failed >= session.quantity) {
      this.completeSmelting(playerId);
      return;
    }

    // Check materials
    if (!this.hasRequiredMaterials(playerId, session.barItemId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You have run out of materials.",
        type: "info",
      });
      this.completeSmelting(playerId);
      return;
    }

    // Schedule smelt completion
    setTimeout(() => {
      this.completeSmelt(playerId);
    }, SMELTING_TIME);
  }

  /**
   * Complete a single smelt action
   */
  private completeSmelt(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    const smeltingData = processingDataProvider.getSmeltingData(
      session.barItemId,
    );
    if (!smeltingData) {
      this.completeSmelting(playerId);
      return;
    }

    // Consume materials first
    this.consumeMaterials(playerId, smeltingData);

    // Check success (iron has 50% failure)
    const success = Math.random() < smeltingData.successRate;

    if (success) {
      // Add bar to inventory
      this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
        playerId,
        item: {
          id: `inv_${playerId}_${Date.now()}`,
          itemId: session.barItemId,
          quantity: 1,
          slot: -1,
          metadata: null,
        },
      });

      // Grant XP
      this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
        playerId,
        skill: "smithing",
        amount: smeltingData.xp,
      });

      session.smelted++;

      // Success message
      const barName = session.barItemId.replace("_bar", " bar");
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You smelt a ${barName}.`,
        type: "success",
      });

      // Emit success event
      this.emitTypedEvent(EventType.SMELTING_SUCCESS, {
        playerId,
        barItemId: session.barItemId,
        xpGained: smeltingData.xp,
      });
    } else {
      session.failed++;

      // Failure message (iron ore specific)
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "The ore is too impure andite cannotite into a bar.",
        type: "warning",
      });

      // Emit failure event
      this.emitTypedEvent(EventType.SMELTING_FAILURE, {
        playerId,
        barItemId: session.barItemId,
      });
    }

    // Continue to next smelt
    this.processNextSmelt(playerId);
  }

  /**
   * Complete the smelting session
   */
  private completeSmelting(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    this.activeSessions.delete(playerId);

    // Emit completion event
    this.emitTypedEvent(EventType.SMELTING_COMPLETE, {
      playerId,
      barItemId: session.barItemId,
      totalSmelted: session.smelted,
      totalFailed: session.failed,
      totalXp:
        session.smelted *
        (processingDataProvider.getSmeltingXP(session.barItemId) || 0),
    });
  }

  /**
   * Cancel smelting for a player
   */
  private cancelSmelting(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (session) {
      this.completeSmelting(playerId);
    }
  }

  /**
   * Check if player has required materials for smelting
   */
  private hasRequiredMaterials(playerId: string, barItemId: string): boolean {
    const smeltingData = processingDataProvider.getSmeltingData(barItemId);
    if (!smeltingData) return false;

    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) return false;

    // Build item counts
    const itemCounts = new Map<string, number>();
    for (const item of inventory) {
      const itemId = (item as { itemId: string }).itemId;
      const qty = (item as { quantity?: number }).quantity || 1;
      itemCounts.set(itemId, (itemCounts.get(itemId) || 0) + qty);
    }

    // Check primary ore
    if ((itemCounts.get(smeltingData.primaryOre) || 0) < 1) {
      return false;
    }

    // Check secondary ore (bronze)
    if (smeltingData.secondaryOre) {
      if ((itemCounts.get(smeltingData.secondaryOre) || 0) < 1) {
        return false;
      }
    }

    // Check coal
    if (smeltingData.coalRequired > 0) {
      if ((itemCounts.get("coal") || 0) < smeltingData.coalRequired) {
        return false;
      }
    }

    return true;
  }

  /**
   * Consume materials for smelting
   */
  private consumeMaterials(
    playerId: string,
    smeltingData: {
      primaryOre: string;
      secondaryOre: string | null;
      coalRequired: number;
    },
  ): void {
    // Remove primary ore
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: smeltingData.primaryOre,
      quantity: 1,
    });

    // Remove secondary ore (bronze)
    if (smeltingData.secondaryOre) {
      this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
        playerId,
        itemId: smeltingData.secondaryOre,
        quantity: 1,
      });
    }

    // Remove coal
    if (smeltingData.coalRequired > 0) {
      this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
        playerId,
        itemId: "coal",
        quantity: smeltingData.coalRequired,
      });
    }
  }

  /**
   * Get player's smithing level
   */
  private getSmithingLevel(playerId: string): number {
    // Check cached skills first
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.smithing?.level) {
      return cachedSkills.smithing.level;
    }

    // Fall back to player entity
    const player = this.world.getPlayer(playerId);
    const playerSkills = (
      player as { skills?: Record<string, { level: number }> }
    )?.skills;
    return playerSkills?.smithing?.level || 1;
  }

  /**
   * Check if player is currently smelting
   */
  isPlayerSmelting(playerId: string): boolean {
    return this.activeSessions.has(playerId);
  }

  update(_dt: number): void {
    // Session timeouts handled via setTimeout
  }

  destroy(): void {
    // Complete all active sessions
    for (const playerId of this.activeSessions.keys()) {
      this.completeSmelting(playerId);
    }
    this.activeSessions.clear();
  }
}
