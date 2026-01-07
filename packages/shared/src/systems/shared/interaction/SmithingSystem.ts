/**
 * SmithingSystem - Handles Smithing at Anvils
 *
 * OSRS-accurate smithing implementation:
 * - Use bars on anvil to smith items
 * - Requires hammer in inventory (not consumed)
 * - Consumes bars based on recipe
 * - Always succeeds (no failure rate)
 * - Grants smithing XP per item made
 * - Auto-smithing continues until out of bars
 *
 * @see https://oldschool.runescape.wiki/w/Smithing
 * @see ProcessingDataProvider for smithing recipes from manifest
 */

import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import { EventType } from "../../../types/events";
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types/index";

/** Active smithing session for a player */
interface SmithingSession {
  playerId: string;
  recipeId: string; // Output item ID (e.g., "bronze_sword")
  anvilId: string;
  startTime: number;
  quantity: number;
  smithed: number;
}

/** Smithing timing constants (in milliseconds) */
const SMITHING_TIME = 2400; // ~4 game ticks per item

/** Hammer item ID required for smithing */
const HAMMER_ITEM_ID = "hammer";

export class SmithingSystem extends SystemBase {
  private activeSessions = new Map<string, SmithingSession>();
  private playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  constructor(world: World) {
    super(world, {
      name: "smithing",
      dependencies: {
        required: [],
        optional: ["inventory", "skills"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    // Listen for smithing interaction (player clicked anvil)
    this.subscribe(
      EventType.SMITHING_INTERACT,
      (data: { playerId: string; anvilId: string }) => {
        this.handleAnvilInteract(data);
      },
    );

    // Listen for smithing request (player selected item to smith)
    this.subscribe(
      EventType.PROCESSING_SMITHING_REQUEST,
      (data: {
        playerId: string;
        recipeId: string;
        anvilId: string;
        quantity: number;
      }) => {
        this.startSmithing(data);
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
        this.cancelSmithing(data.playerId);
      },
    );
  }

  /**
   * Handle anvil interaction - show available items to smith
   */
  private handleAnvilInteract(data: {
    playerId: string;
    anvilId: string;
  }): void {
    const { playerId, anvilId } = data;

    // Check if already smithing
    if (this.activeSessions.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already smithing.",
        type: "error",
      });
      return;
    }

    // Check for hammer
    if (!this.hasHammer(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You need a hammer to work the metal on this anvil.",
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

    // Get available recipes based on inventory
    const availableRecipes =
      processingDataProvider.getSmithableItemsFromInventory(
        inventory.map((item: { itemId: string; quantity?: number }) => ({
          itemId: item.itemId,
          quantity: item.quantity || 1,
        })),
        smithingLevel,
      );

    if (availableRecipes.length === 0) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You don't have the bars to smith anything.",
        type: "error",
      });
      return;
    }

    // Emit event with available recipes for UI to display
    this.emitTypedEvent(EventType.SMITHING_INTERACT, {
      playerId,
      anvilId,
      availableRecipes: availableRecipes.map((recipe) => ({
        itemId: recipe.itemId,
        name: recipe.name,
        barType: recipe.barType,
        barsRequired: recipe.barsRequired,
        levelRequired: recipe.levelRequired,
        xp: recipe.xp,
        category: recipe.category,
      })),
    });
  }

  /**
   * Start smithing a specific item
   */
  private startSmithing(data: {
    playerId: string;
    recipeId: string;
    anvilId: string;
    quantity: number;
  }): void {
    const { playerId, recipeId, anvilId, quantity } = data;

    // Check if already smithing
    if (this.activeSessions.has(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You are already smithing.",
        type: "error",
      });
      return;
    }

    // Check for hammer
    if (!this.hasHammer(playerId)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You need a hammer to work the metal on this anvil.",
        type: "error",
      });
      return;
    }

    // Validate recipe exists
    const recipe = processingDataProvider.getSmithingRecipe(recipeId);
    if (!recipe) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "Invalid smithing recipe.",
        type: "error",
      });
      return;
    }

    // Check level requirement
    const smithingLevel = this.getSmithingLevel(playerId);
    if (smithingLevel < recipe.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${recipe.levelRequired} Smithing to make that.`,
        type: "error",
      });
      return;
    }

    // Create session
    const session: SmithingSession = {
      playerId,
      recipeId,
      anvilId,
      startTime: Date.now(),
      quantity: Math.max(1, quantity),
      smithed: 0,
    };

    this.activeSessions.set(playerId, session);

    // Show start message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: `You begin smithing ${recipe.name}s.`,
      type: "info",
    });

    // Emit start event
    this.emitTypedEvent(EventType.SMITHING_START, {
      playerId,
      recipeId,
      anvilId,
    });

    // Start first smith
    this.processNextSmith(playerId);
  }

  /**
   * Process the next smith in the session
   */
  private processNextSmith(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    // Check if we've reached the target quantity
    if (session.smithed >= session.quantity) {
      this.completeSmithing(playerId);
      return;
    }

    const recipe = processingDataProvider.getSmithingRecipe(session.recipeId);
    if (!recipe) {
      this.completeSmithing(playerId);
      return;
    }

    // Check materials (bars)
    if (!this.hasRequiredBars(playerId, recipe.barType, recipe.barsRequired)) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You have run out of bars.",
        type: "info",
      });
      this.completeSmithing(playerId);
      return;
    }

    // Schedule smith completion
    setTimeout(() => {
      this.completeSmith(playerId);
    }, SMITHING_TIME);
  }

  /**
   * Complete a single smith action
   */
  private completeSmith(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    const recipe = processingDataProvider.getSmithingRecipe(session.recipeId);
    if (!recipe) {
      this.completeSmithing(playerId);
      return;
    }

    // Consume bars
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: recipe.barType,
      quantity: recipe.barsRequired,
    });

    // Add smithed item to inventory
    this.emitTypedEvent(EventType.INVENTORY_ITEM_ADDED, {
      playerId,
      item: {
        id: `inv_${playerId}_${Date.now()}`,
        itemId: recipe.itemId,
        quantity: 1,
        slot: -1,
        metadata: null,
      },
    });

    // Grant XP
    this.emitTypedEvent(EventType.SKILLS_XP_GAINED, {
      playerId,
      skill: "smithing",
      amount: recipe.xp,
    });

    session.smithed++;

    // Success message (OSRS style - shows item name)
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId,
      message: `You hammer the ${recipe.barType.replace("_bar", "")} and make a ${recipe.name}.`,
      type: "success",
    });

    // Continue to next smith
    this.processNextSmith(playerId);
  }

  /**
   * Complete the smithing session
   */
  private completeSmithing(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (!session) return;

    this.activeSessions.delete(playerId);

    const recipe = processingDataProvider.getSmithingRecipe(session.recipeId);

    // Emit completion event
    this.emitTypedEvent(EventType.SMITHING_COMPLETE, {
      playerId,
      recipeId: session.recipeId,
      totalSmithed: session.smithed,
      totalXp: session.smithed * (recipe?.xp || 0),
    });
  }

  /**
   * Cancel smithing for a player
   */
  private cancelSmithing(playerId: string): void {
    const session = this.activeSessions.get(playerId);
    if (session) {
      this.completeSmithing(playerId);
    }
  }

  /**
   * Check if player has a hammer in inventory
   */
  private hasHammer(playerId: string): boolean {
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) return false;

    return inventory.some(
      (item: { itemId: string }) => item.itemId === HAMMER_ITEM_ID,
    );
  }

  /**
   * Check if player has required bars
   */
  private hasRequiredBars(
    playerId: string,
    barType: string,
    barsRequired: number,
  ): boolean {
    const inventory = this.world.getInventory?.(playerId);
    if (!inventory || !Array.isArray(inventory)) return false;

    let totalBars = 0;
    for (const item of inventory) {
      if ((item as { itemId: string }).itemId === barType) {
        totalBars += (item as { quantity?: number }).quantity || 1;
      }
    }

    return totalBars >= barsRequired;
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
   * Check if player is currently smithing
   */
  isPlayerSmithing(playerId: string): boolean {
    return this.activeSessions.has(playerId);
  }

  update(_dt: number): void {
    // Session timeouts handled via setTimeout
  }

  destroy(): void {
    // Complete all active sessions
    for (const playerId of this.activeSessions.keys()) {
      this.completeSmithing(playerId);
    }
    this.activeSessions.clear();
  }
}
