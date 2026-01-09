/**
 * FiremakingSystem - Handles Firemaking Skill
 *
 * OSRS-accurate firemaking implementation:
 * - Use tinderbox on logs in inventory
 * - Creates fire object in world at player position
 * - Grants firemaking XP based on log type (from manifest)
 * - Moves player to adjacent tile after lighting (W→E→S→N priority)
 * - Player squats during lighting animation
 *
 * @see https://oldschool.runescape.wiki/w/Firemaking
 * @see Phase 4.1 of COOKING_FIREMAKING_HARDENING_PLAN.md
 */

import { ITEM_IDS } from "../../../constants/GameConstants";
import { processingDataProvider } from "../../../data/ProcessingDataProvider";
import { EventType } from "../../../types/events";
import {
  worldToTile,
  tileToWorld,
  type TileCoord,
} from "../../shared/movement/TileSystem";
import { ProcessingSystemBase } from "./ProcessingSystemBase";
import type { World } from "../../../types/index";
import type { ProcessingAction } from "../../../types/core/core";

export class FiremakingSystem extends ProcessingSystemBase {
  // Firemaking-specific constants
  private readonly FIREMAKING_TIME = 3000; // 3 seconds to light fire

  // OSRS firemaking movement priority: West → East → South → North
  private readonly FIREMAKING_MOVE_PRIORITY = [
    { dx: -1, dz: 0 }, // West (-X)
    { dx: 1, dz: 0 }, // East (+X)
    { dx: 0, dz: 1 }, // South (+Z in Three.js)
    { dx: 0, dz: -1 }, // North (-Z in Three.js)
  ];

  constructor(world: World) {
    super(world, { name: "firemaking" });
  }

  async init(): Promise<void> {
    await this.initBase();

    // Listen for firemaking requests
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

    // Handle legacy item-on-item events
    this.subscribe(EventType.ITEM_USE_ON_ITEM, (_data) => {
      // Handled by targeting system now
      return;
    });
  }

  // =========================================================================
  // FIREMAKING FLOW
  // =========================================================================

  private startFiremaking(data: {
    playerId: string;
    logsId: string;
    logsSlot: number;
    tinderboxSlot: number;
  }): void {
    const { playerId, logsId, logsSlot, tinderboxSlot } = data;

    console.log("[FiremakingSystem] 🔥 startFiremaking called:", {
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

    this.startFiremakingProcess(playerId, logsId, logsSlot, tinderboxSlot);
  }

  private startFiremakingProcess(
    playerId: string,
    logsId: string,
    logsSlot: number,
    tinderboxSlot: number,
  ): void {
    // Check fire limit
    if (this.countPlayerFires(playerId) >= this.MAX_FIRES_PER_PLAYER) {
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

    // Check level requirement
    const firemakingLevel = this.getFiremakingLevel(playerId);
    if (firemakingLevel < firemakingData.levelRequired) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: `You need level ${firemakingData.levelRequired} Firemaking to light those logs.`,
        type: "error",
      });
      return;
    }

    // Create processing action from pool
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

    // OSRS: Player squats while lighting fire
    this.setProcessingEmote(playerId);

    // Complete after duration
    setTimeout(() => {
      // Re-fetch player at callback time - they may have disconnected
      const currentPlayer = this.world.getPlayer(playerId);
      if (!currentPlayer?.node?.position) {
        console.log(
          `[FiremakingSystem] Player ${playerId} disconnected during firemaking - cancelling`,
        );
        const action = this.activeProcessing.get(playerId);
        this.activeProcessing.delete(playerId);
        if (action) this.releaseAction(action);
        return;
      }

      // Verify player is still in activeProcessing (wasn't cancelled)
      if (!this.activeProcessing.has(playerId)) {
        console.log(
          `[FiremakingSystem] Firemaking was cancelled for ${playerId}`,
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

    // Complete the process
    this.completeFiremakingProcess(playerId, action, position);

    // Release action back to pool
    this.releaseAction(action);
  }

  private completeFiremakingProcess(
    playerId: string,
    action: ProcessingAction,
    position: { x: number; y: number; z: number },
  ): void {
    if (!action.targetItem) {
      console.error(
        `[FiremakingSystem] Firemaking action missing targetItem for ${playerId}`,
      );
      return;
    }

    const logsId = action.targetItem.id;

    console.log(
      "[FiremakingSystem] 🔥 completeFiremakingProcess - removing logs:",
      { playerId, logsId, slot: action.targetItem.slot },
    );

    // Remove logs from inventory
    this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
      playerId,
      itemId: logsId,
      quantity: 1,
      slot: action.targetItem.slot,
    });

    // Create fire using base class method
    const fire = this.createFire(playerId, position);

    // Create visual
    this.createFireVisual(fire);

    // Reset emote when fire is lit (before moving)
    this.resetPlayerEmote(playerId);

    // OSRS: Move player to adjacent tile after lighting fire
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

  // =========================================================================
  // OSRS-ACCURATE MOVEMENT
  // =========================================================================

  /**
   * Find the tile to move to after lighting a fire (OSRS-accurate)
   * Priority: West → East → South → North
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
    return true;
  }

  /**
   * Move player to target tile after lighting fire
   */
  private movePlayerAfterFiremaking(
    playerId: string,
    target: { x: number; y: number; z: number },
  ): void {
    console.log(
      `[FiremakingSystem] 🔥 Moving player ${playerId} after firemaking to (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`,
    );

    // Emit event for ServerNetwork to handle
    this.emitTypedEvent(EventType.FIREMAKING_MOVE_REQUEST, {
      playerId,
      position: { x: target.x, y: target.y, z: target.z },
    });
  }

  // =========================================================================
  // SKILL LEVEL ACCESS
  // =========================================================================

  /**
   * Get player's firemaking level from cached skills or player entity
   */
  private getFiremakingLevel(playerId: string): number {
    // Check cached skills first (from SKILLS_UPDATED events)
    const cachedSkills = this.playerSkills.get(playerId);
    if (cachedSkills?.firemaking?.level) {
      return cachedSkills.firemaking.level;
    }

    // Fall back to player entity
    const player = this.world.getPlayer(playerId);
    const playerSkills = (
      player as { skills?: Record<string, { level: number }> }
    )?.skills;
    if (playerSkills?.firemaking?.level) {
      return playerSkills.firemaking.level;
    }

    // Default to level 1
    return 1;
  }

  // =========================================================================
  // LEGACY SUPPORT
  // =========================================================================

  /**
   * Handle legacy numeric item IDs (for backwards compatibility)
   */
  handleLegacyItemOnItem(data: {
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
      this.startFiremaking({
        playerId,
        logsId: "logs",
        logsSlot: primarySlot,
        tinderboxSlot: targetSlot,
      });
    }
  }
}
