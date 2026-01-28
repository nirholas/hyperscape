/**
 * DuelSessionManager - Session CRUD Operations
 *
 * Single Responsibility: Managing duel session lifecycle
 * - Session creation and deletion
 * - Player-to-session mapping
 * - Session queries
 *
 * Does NOT handle:
 * - State transitions (DuelSystem)
 * - Combat resolution (DuelCombatResolver)
 * - Arena management (ArenaPoolManager)
 */

import type { World } from "@hyperscape/shared";
import type { DuelRules, StakedItem, DuelState } from "@hyperscape/shared";
import { DEFAULT_DUEL_RULES } from "@hyperscape/shared";
import { DEFAULT_EQUIPMENT_RESTRICTIONS, type EquipmentSlot } from "./config";

// ============================================================================
// Types
// ============================================================================

/**
 * Equipment restrictions for a duel (which slots are disabled)
 */
export interface EquipmentRestrictions {
  head: boolean;
  cape: boolean;
  amulet: boolean;
  weapon: boolean;
  body: boolean;
  shield: boolean;
  legs: boolean;
  gloves: boolean;
  boots: boolean;
  ring: boolean;
  ammo: boolean;
}

/**
 * Server-side duel session structure.
 * Uses a flattened format for efficiency.
 */
export interface DuelSession {
  duelId: string;
  state: DuelState;

  // Participants
  challengerId: string;
  challengerName: string;
  targetId: string;
  targetName: string;

  // Rules & Restrictions
  rules: DuelRules;
  equipmentRestrictions: EquipmentRestrictions;

  // Stakes
  challengerStakes: StakedItem[];
  targetStakes: StakedItem[];

  // Acceptance state (per screen)
  challengerAccepted: boolean;
  targetAccepted: boolean;

  // Arena
  arenaId: number | null;

  // Timestamps
  createdAt: number;
  countdownStartedAt?: number;
  fightStartedAt?: number;
  finishedAt?: number;

  // Countdown tracking (internal)
  lastCountdownTick?: number;

  // Result
  winnerId?: string;
  forfeitedBy?: string;
}

// ============================================================================
// DuelSessionManager Class
// ============================================================================

export class DuelSessionManager {
  /** All active duel sessions by ID */
  private duelSessions: Map<string, DuelSession> = new Map();

  /** Player ID to their active duel session ID */
  private playerDuels: Map<string, string> = new Map();

  constructor(private world: World) {}

  // ==========================================================================
  // Session CRUD
  // ==========================================================================

  /**
   * Create a new duel session
   * @returns The newly created session's duelId
   */
  createSession(
    challengerId: string,
    challengerName: string,
    targetId: string,
    targetName: string,
  ): string {
    const duelId = this.generateDuelId();

    const session: DuelSession = {
      duelId,
      state: "RULES",
      challengerId,
      challengerName,
      targetId,
      targetName,
      rules: { ...DEFAULT_DUEL_RULES },
      equipmentRestrictions: { ...DEFAULT_EQUIPMENT_RESTRICTIONS },
      challengerStakes: [],
      targetStakes: [],
      challengerAccepted: false,
      targetAccepted: false,
      arenaId: null,
      createdAt: Date.now(),
    };

    this.duelSessions.set(duelId, session);
    this.playerDuels.set(challengerId, duelId);
    this.playerDuels.set(targetId, duelId);

    // Emit session created event
    this.world.emit("duel:session:created", {
      duelId,
      challengerId,
      challengerName,
      targetId,
      targetName,
    });

    return duelId;
  }

  /**
   * Get a duel session by ID
   */
  getSession(duelId: string): DuelSession | undefined {
    return this.duelSessions.get(duelId);
  }

  /**
   * Get the duel session for a player
   */
  getPlayerSession(playerId: string): DuelSession | undefined {
    const duelId = this.playerDuels.get(playerId);
    return duelId ? this.duelSessions.get(duelId) : undefined;
  }

  /**
   * Get the duel ID for a player
   */
  getPlayerDuelId(playerId: string): string | undefined {
    return this.playerDuels.get(playerId);
  }

  /**
   * Check if a player is in any duel
   */
  isPlayerInDuel(playerId: string): boolean {
    return this.playerDuels.has(playerId);
  }

  /**
   * Delete a duel session and clean up player mappings
   * @returns The deleted session, or undefined if not found
   */
  deleteSession(duelId: string): DuelSession | undefined {
    const session = this.duelSessions.get(duelId);
    if (session) {
      this.duelSessions.delete(duelId);
      this.playerDuels.delete(session.challengerId);
      this.playerDuels.delete(session.targetId);
    }
    return session;
  }

  /**
   * Get all active sessions as an iterator
   */
  getAllSessions(): IterableIterator<[string, DuelSession]> {
    return this.duelSessions.entries();
  }

  /**
   * Get the number of active sessions
   */
  get sessionCount(): number {
    return this.duelSessions.size;
  }

  /**
   * Clear all sessions (used during shutdown)
   */
  clearAllSessions(): void {
    this.duelSessions.clear();
    this.playerDuels.clear();
  }

  // ==========================================================================
  // Session State Helpers
  // ==========================================================================

  /**
   * Check if a player is the challenger in their session
   */
  isChallenger(playerId: string): boolean {
    const session = this.getPlayerSession(playerId);
    return session?.challengerId === playerId;
  }

  /**
   * Check if a player is the target in their session
   */
  isTarget(playerId: string): boolean {
    const session = this.getPlayerSession(playerId);
    return session?.targetId === playerId;
  }

  /**
   * Get the opponent's player ID for a given player
   */
  getOpponentId(playerId: string): string | undefined {
    const session = this.getPlayerSession(playerId);
    if (!session) return undefined;
    return playerId === session.challengerId
      ? session.targetId
      : session.challengerId;
  }

  /**
   * Get the stakes array for a specific player
   */
  getPlayerStakes(
    session: DuelSession,
    playerId: string,
  ): StakedItem[] | undefined {
    if (playerId === session.challengerId) {
      return session.challengerStakes;
    }
    if (playerId === session.targetId) {
      return session.targetStakes;
    }
    return undefined;
  }

  /**
   * Reset acceptance state for both players (called when rules/stakes change)
   */
  resetAcceptance(session: DuelSession): void {
    session.challengerAccepted = false;
    session.targetAccepted = false;
  }

  /**
   * Set acceptance state for a player
   * @returns true if both players have accepted
   */
  setPlayerAcceptance(
    session: DuelSession,
    playerId: string,
    accepted: boolean,
  ): boolean {
    if (playerId === session.challengerId) {
      session.challengerAccepted = accepted;
    } else if (playerId === session.targetId) {
      session.targetAccepted = accepted;
    }
    return session.challengerAccepted && session.targetAccepted;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Generate a unique duel ID
   */
  private generateDuelId(): string {
    return `duel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
