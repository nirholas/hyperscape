/**
 * DuelCombatResolver - Combat Resolution & Stake Transfers
 *
 * Single Responsibility: Resolving duel outcomes
 * - Death handling
 * - Forfeit processing
 * - Stake transfer to winner
 * - Health restoration
 * - Post-duel teleportation
 *
 * Does NOT handle:
 * - Session management (DuelSessionManager)
 * - State transitions (DuelSystem)
 * - Arena management (ArenaPoolManager)
 */

import type { World, StakedItem } from "@hyperscape/shared";
import { EventType, PlayerEntity } from "@hyperscape/shared";
import type { DuelSession } from "./DuelSessionManager";
import { AuditLogger, Logger } from "../ServerNetwork/services";
import {
  LOBBY_SPAWN_WINNER,
  LOBBY_SPAWN_LOSER,
  LOBBY_SPAWN_CENTER,
} from "./config";

// ============================================================================
// Types
// ============================================================================

/**
 * Reason for duel resolution
 */
export type DuelResolutionReason = "death" | "forfeit";

/**
 * Result of duel resolution
 */
export interface DuelResolutionResult {
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  reason: DuelResolutionReason;
  winnerReceives: StakedItem[];
  winnerReceivesValue: number;
}

// ============================================================================
// DuelCombatResolver Class
// ============================================================================

export class DuelCombatResolver {
  constructor(private world: World) {}

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Resolve a duel with a determined winner and loser
   *
   * This method:
   * 1. Sets the session to FINISHED state
   * 2. Transfers stakes to winner
   * 3. Restores both players' health
   * 4. Teleports both players to lobby
   * 5. Emits completion event
   * 6. Logs to audit trail
   *
   * @returns Resolution result for cleanup
   */
  resolveDuel(
    session: DuelSession,
    winnerId: string,
    loserId: string,
    reason: DuelResolutionReason,
  ): DuelResolutionResult {
    // Mark session as finished
    session.state = "FINISHED";
    session.winnerId = winnerId;
    session.finishedAt = Date.now();

    // Determine names and stakes
    const winnerIsChallenger = winnerId === session.challengerId;
    const winnerName = winnerIsChallenger
      ? session.challengerName
      : session.targetName;
    const loserName = winnerIsChallenger
      ? session.targetName
      : session.challengerName;

    const winnerStakes = winnerIsChallenger
      ? session.challengerStakes
      : session.targetStakes;
    const loserStakes = winnerIsChallenger
      ? session.targetStakes
      : session.challengerStakes;

    // Calculate winnings
    const winnerReceivesValue = loserStakes.reduce(
      (sum, s) => sum + s.value,
      0,
    );

    // Transfer stakes to winner
    this.transferStakes(session, winnerId, loserId, winnerStakes, loserStakes);

    // Restore both players to full health
    this.restorePlayerHealth(winnerId);
    this.restorePlayerHealth(loserId);

    // Teleport both players to duel arena lobby
    this.teleportToLobby(winnerId, true);
    this.teleportToLobby(loserId, false);

    // Emit duel completed event
    this.world.emit("duel:completed", {
      duelId: session.duelId,
      winnerId,
      winnerName,
      loserId,
      loserName,
      reason,
      forfeit: reason === "forfeit",
      winnerReceives: loserStakes,
      winnerReceivesValue,
      challengerStakes: session.challengerStakes,
      targetStakes: session.targetStakes,
    });

    // Audit log for economic tracking
    AuditLogger.getInstance().logDuelComplete(
      session.duelId,
      winnerId,
      loserId,
      loserStakes,
      winnerStakes,
      winnerReceivesValue,
      reason,
    );

    return {
      winnerId,
      winnerName,
      loserId,
      loserName,
      reason,
      winnerReceives: loserStakes,
      winnerReceivesValue,
    };
  }

  /**
   * Return staked items to both players (on cancel/disconnect)
   */
  returnStakedItems(session: DuelSession): void {
    // Return challenger's stakes
    if (session.challengerStakes.length > 0) {
      this.world.emit("duel:stakes:return", {
        playerId: session.challengerId,
        stakes: session.challengerStakes,
        reason: "duel_cancelled",
      });
    }

    // Return target's stakes
    if (session.targetStakes.length > 0) {
      this.world.emit("duel:stakes:return", {
        playerId: session.targetId,
        stakes: session.targetStakes,
        reason: "duel_cancelled",
      });
    }
  }

  // ==========================================================================
  // Private Methods - Stake Transfer
  // ==========================================================================

  /**
   * Transfer stakes to the winner
   */
  private transferStakes(
    session: DuelSession,
    winnerId: string,
    loserId: string,
    winnerStakes: StakedItem[],
    loserStakes: StakedItem[],
  ): void {
    Logger.debug("DuelCombatResolver", "Transferring stakes", {
      winnerId,
      loserId,
      winnerStakesCount: winnerStakes.length,
      loserStakesCount: loserStakes.length,
    });

    // Calculate total values
    const winnerOwnValue = winnerStakes.reduce((sum, s) => sum + s.value, 0);
    const winnerReceivesValue = loserStakes.reduce(
      (sum, s) => sum + s.value,
      0,
    );

    // Emit stake transfer event
    this.world.emit("duel:stakes:transfer", {
      winnerId,
      loserId,
      duelId: session.duelId,
      winnerReceives: loserStakes,
      winnerKeeps: winnerStakes,
      loserLoses: loserStakes,
      totalWinnings: winnerReceivesValue,
      winnerOwnStakeValue: winnerOwnValue,
    });

    // Combine winner's own stakes AND loser's stakes into a single operation
    // This prevents race conditions where both try to insert into slot 0
    const allWinnerItems = [...winnerStakes, ...loserStakes];

    if (allWinnerItems.length > 0) {
      Logger.debug("DuelCombatResolver", "Settling stakes", {
        winnerId,
        ownStakesCount: winnerStakes.length,
        wonStakesCount: loserStakes.length,
      });
      this.world.emit("duel:stakes:settle", {
        playerId: winnerId,
        ownStakes: winnerStakes,
        wonStakes: loserStakes,
        fromPlayerId: loserId,
        reason: "duel_won",
      });
    }
  }

  // ==========================================================================
  // Private Methods - Player State
  // ==========================================================================

  /**
   * Restore player to full health after duel (OSRS-accurate: no death in duels)
   */
  private restorePlayerHealth(playerId: string): void {
    // Clear death state using PlayerEntity helper method (Law of Demeter)
    const playerEntity = this.world.entities?.get?.(playerId);
    if (playerEntity instanceof PlayerEntity) {
      playerEntity.resetDeathState();
    }

    // Emit PLAYER_RESPAWNED to trigger health restoration in PlayerSystem
    this.world.emit(EventType.PLAYER_RESPAWNED, {
      playerId,
      spawnPosition: LOBBY_SPAWN_CENTER,
      townName: "Duel Arena",
    });

    // Also emit PLAYER_SET_DEAD to ensure death state is cleared on client
    this.world.emit(EventType.PLAYER_SET_DEAD, {
      playerId,
      isDead: false,
    });
  }

  /**
   * Teleport player to duel arena lobby
   * Uses different spawn positions so winner and loser don't overlap
   */
  private teleportToLobby(playerId: string, isWinner: boolean): void {
    const lobbySpawn = isWinner ? LOBBY_SPAWN_WINNER : LOBBY_SPAWN_LOSER;

    this.world.emit("player:teleport", {
      playerId,
      position: lobbySpawn,
      rotation: 0,
    });
  }
}
