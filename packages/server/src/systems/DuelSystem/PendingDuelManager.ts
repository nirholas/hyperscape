/**
 * PendingDuelManager
 *
 * Server-authoritative system for tracking duel challenge requests.
 * When Player A challenges Player B, the challenge is stored here until:
 * 1. Player B accepts/declines
 * 2. Challenge times out (30 seconds)
 * 3. Either player disconnects
 * 4. Either player moves too far away
 *
 * Similar pattern to trade request management.
 */

import type { World } from "@hyperscape/shared";
import type { PendingDuelChallenge } from "@hyperscape/shared";
import {
  CHALLENGE_TIMEOUT_TICKS,
  CHALLENGE_CLEANUP_INTERVAL_TICKS,
  CHALLENGE_DISTANCE_TILES,
  ticksToMs,
} from "./config";

export class PendingDuelManager {
  /** Map of challengeId -> pending challenge data */
  private pendingChallenges = new Map<string, PendingDuelChallenge>();

  /** Map of playerId -> challengeId for quick lookup */
  private playerToChallengeAsChallenger = new Map<string, string>();
  private playerToChallengeAsTarget = new Map<string, string>();

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private world: World) {}

  /**
   * Initialize the manager and start cleanup timer
   */
  init(): void {
    // Run cleanup every few ticks
    this.cleanupInterval = setInterval(
      () => this.cleanupExpired(),
      ticksToMs(CHALLENGE_CLEANUP_INTERVAL_TICKS),
    );
  }

  /**
   * Create a new duel challenge
   *
   * @returns The challenge ID if successful, null if player already has a pending challenge
   */
  createChallenge(
    challengerId: string,
    challengerName: string,
    targetId: string,
    targetName: string,
  ):
    | { success: true; challengeId: string }
    | { success: false; error: string } {
    // Check if challenger already has an outgoing challenge
    if (this.playerToChallengeAsChallenger.has(challengerId)) {
      return { success: false, error: "You already have a pending challenge." };
    }

    // Check if challenger is already being challenged
    if (this.playerToChallengeAsTarget.has(challengerId)) {
      return {
        success: false,
        error: "You have a pending challenge to respond to.",
      };
    }

    // Check if target already has an outgoing challenge
    if (this.playerToChallengeAsChallenger.has(targetId)) {
      return {
        success: false,
        error: "That player already has a pending challenge.",
      };
    }

    // Check if target is already being challenged
    if (this.playerToChallengeAsTarget.has(targetId)) {
      return {
        success: false,
        error: "That player is already being challenged.",
      };
    }

    // Generate unique challenge ID
    const challengeId = `duel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const challenge: PendingDuelChallenge = {
      challengeId,
      challengerId,
      challengerName,
      targetId,
      targetName,
      createdAt: Date.now(),
      expiresAt: Date.now() + ticksToMs(CHALLENGE_TIMEOUT_TICKS),
    };

    this.pendingChallenges.set(challengeId, challenge);
    this.playerToChallengeAsChallenger.set(challengerId, challengeId);
    this.playerToChallengeAsTarget.set(targetId, challengeId);

    return { success: true, challengeId };
  }

  /**
   * Get a pending challenge by ID
   */
  getChallenge(challengeId: string): PendingDuelChallenge | undefined {
    return this.pendingChallenges.get(challengeId);
  }

  /**
   * Get challenge where player is the challenger
   */
  getChallengeAsChallenger(playerId: string): PendingDuelChallenge | undefined {
    const challengeId = this.playerToChallengeAsChallenger.get(playerId);
    return challengeId ? this.pendingChallenges.get(challengeId) : undefined;
  }

  /**
   * Get challenge where player is the target
   */
  getChallengeAsTarget(playerId: string): PendingDuelChallenge | undefined {
    const challengeId = this.playerToChallengeAsTarget.get(playerId);
    return challengeId ? this.pendingChallenges.get(challengeId) : undefined;
  }

  /**
   * Check if player has any pending challenge (as challenger or target)
   */
  hasAnyChallenge(playerId: string): boolean {
    return (
      this.playerToChallengeAsChallenger.has(playerId) ||
      this.playerToChallengeAsTarget.has(playerId)
    );
  }

  /**
   * Cancel a challenge by ID
   *
   * @returns The cancelled challenge, or undefined if not found
   */
  cancelChallenge(challengeId: string): PendingDuelChallenge | undefined {
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) return undefined;

    this.pendingChallenges.delete(challengeId);
    this.playerToChallengeAsChallenger.delete(challenge.challengerId);
    this.playerToChallengeAsTarget.delete(challenge.targetId);

    return challenge;
  }

  /**
   * Cancel all challenges involving a player (disconnect cleanup)
   *
   * @returns Array of cancelled challenges
   */
  cancelPlayerChallenges(playerId: string): PendingDuelChallenge[] {
    const cancelled: PendingDuelChallenge[] = [];

    // Cancel as challenger
    const asChallenger = this.getChallengeAsChallenger(playerId);
    if (asChallenger) {
      this.cancelChallenge(asChallenger.challengeId);
      cancelled.push(asChallenger);
    }

    // Cancel as target
    const asTarget = this.getChallengeAsTarget(playerId);
    if (asTarget) {
      this.cancelChallenge(asTarget.challengeId);
      cancelled.push(asTarget);
    }

    return cancelled;
  }

  /**
   * Accept a challenge and remove it from pending
   *
   * @returns The challenge if found and valid, undefined otherwise
   */
  acceptChallenge(
    challengeId: string,
    acceptingPlayerId: string,
  ): PendingDuelChallenge | undefined {
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) return undefined;

    // Only the target can accept
    if (challenge.targetId !== acceptingPlayerId) return undefined;

    // Check if expired
    if (Date.now() > challenge.expiresAt) {
      this.cancelChallenge(challengeId);
      return undefined;
    }

    // Remove from pending (it's now an active duel session)
    this.cancelChallenge(challengeId);
    return challenge;
  }

  /**
   * Decline a challenge
   */
  declineChallenge(
    challengeId: string,
    decliningPlayerId: string,
  ): PendingDuelChallenge | undefined {
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) return undefined;

    // Only the target can decline
    if (challenge.targetId !== decliningPlayerId) return undefined;

    return this.cancelChallenge(challengeId);
  }

  /**
   * Clean up expired challenges
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [challengeId, challenge] of this.pendingChallenges) {
      if (now > challenge.expiresAt) {
        expired.push(challengeId);
      }
    }

    for (const challengeId of expired) {
      const challenge = this.cancelChallenge(challengeId);
      if (challenge) {
        // Emit event for handlers to notify players
        this.world.emit("duel:challenge:expired", {
          challengeId,
          challengerId: challenge.challengerId,
          targetId: challenge.targetId,
        });
      }
    }
  }

  /**
   * Process tick - check distance between players
   * Called by DuelSystem every tick
   */
  processTick(): void {
    for (const [challengeId, challenge] of this.pendingChallenges) {
      const challenger = this.world.entities.players?.get(
        challenge.challengerId,
      );
      const target = this.world.entities.players?.get(challenge.targetId);

      // Cancel if either player disconnected
      if (!challenger || !target) {
        this.cancelChallenge(challengeId);
        this.world.emit("duel:challenge:cancelled", {
          challengeId,
          reason: "player_disconnected",
        });
        continue;
      }

      // Check distance
      const challengerPos = challenger.position;
      const targetPos = target.position;

      if (challengerPos && targetPos) {
        const dx = Math.abs(challengerPos.x - targetPos.x);
        const dz = Math.abs(challengerPos.z - targetPos.z);
        const distanceTiles = Math.max(dx, dz); // Chebyshev distance

        if (distanceTiles > CHALLENGE_DISTANCE_TILES) {
          this.cancelChallenge(challengeId);
          this.world.emit("duel:challenge:cancelled", {
            challengeId,
            challengerId: challenge.challengerId,
            targetId: challenge.targetId,
            reason: "too_far",
          });
        }
      }
    }
  }

  /**
   * Get count of pending challenges (for debugging)
   */
  get size(): number {
    return this.pendingChallenges.size;
  }

  /**
   * Clean up on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pendingChallenges.clear();
    this.playerToChallengeAsChallenger.clear();
    this.playerToChallengeAsTarget.clear();
  }
}
