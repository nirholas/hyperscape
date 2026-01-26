/**
 * DuelSystem - Server-authoritative player-to-player dueling (OSRS-accurate)
 *
 * Manages duel sessions with rules negotiation, stakes, and combat enforcement.
 *
 * Duel Flow:
 * 1. Player A challenges Player B (in Duel Arena zone)
 * 2. Player B accepts/declines challenge
 * 3. Rules screen: Both players toggle rules and accept
 * 4. Stakes screen: Both players stake items/gold and accept
 * 5. Confirmation screen: Read-only review, both accept
 * 6. Teleport to arena with countdown
 * 7. Combat with rule enforcement
 * 8. Winner receives stakes, loser respawns at hospital
 *
 * Security:
 * - All operations are server-authoritative
 * - Stakes are locked during duel
 * - Rules are validated for invalid combinations
 * - Arena bounds enforced server-side
 *
 * @see packages/shared/src/types/game/duel-types.ts for type definitions
 */

import type { World } from "@hyperscape/shared";
import {
  EventType,
  type DuelRules,
  type DuelState,
  type StakedItem,
  DEFAULT_DUEL_RULES,
  validateRuleCombination,
  DuelErrorCode,
} from "@hyperscape/shared";
import { PendingDuelManager } from "./PendingDuelManager";
import { ArenaPoolManager } from "./ArenaPoolManager";

// ============================================================================
// Types
// ============================================================================

/**
 * Equipment restrictions for a duel (which slots are disabled)
 */
interface EquipmentRestrictions {
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
 * Uses a flattened format for efficiency (vs shared type's DuelParticipant pattern).
 */
interface DuelSession {
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

/**
 * Active duel lookup - maps playerId to their current duel session ID
 */
type PlayerDuelMap = Map<string, string>;

/**
 * All active duel sessions
 */
type DuelSessionMap = Map<string, DuelSession>;

/**
 * Result of a duel operation
 */
export type DuelOperationResult = {
  success: boolean;
  error?: string;
  errorCode?: DuelErrorCode;
};

// ============================================================================
// DuelSystem Class
// ============================================================================

export class DuelSystem {
  private readonly world: World;

  /** Manager for pending duel challenges */
  public readonly pendingDuels: PendingDuelManager;

  /** Manager for arena pool */
  public readonly arenaPool: ArenaPoolManager;

  /** All active duel sessions by ID */
  private duelSessions: DuelSessionMap = new Map();

  /** Player ID to their active duel session ID */
  private playerDuels: PlayerDuelMap = new Map();

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Disconnected players during combat - maps playerId to timeout handle */
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  /** Duration before auto-forfeit on disconnect during combat (ms) */
  private static readonly DISCONNECT_TIMEOUT_MS = 30_000;

  constructor(world: World) {
    this.world = world;
    this.pendingDuels = new PendingDuelManager(world);
    this.arenaPool = new ArenaPoolManager();
  }

  /**
   * Initialize the duel system
   */
  init(): void {
    // Initialize pending duel manager
    this.pendingDuels.init();

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 10_000);

    // Subscribe to player disconnect events
    this.world.on(EventType.PLAYER_LEFT, (payload: unknown) => {
      const data = payload as { playerId: string };
      this.onPlayerDisconnect(data.playerId);
    });

    this.world.on(EventType.PLAYER_LOGOUT, (payload: unknown) => {
      const data = payload as { playerId: string };
      this.onPlayerDisconnect(data.playerId);
    });

    // Subscribe to player death to end duel
    this.world.on(EventType.PLAYER_DIED, (payload: unknown) => {
      const data = payload as { playerId: string };
      this.handlePlayerDeath(data.playerId);
    });

    console.log("[DuelSystem] Initialized");
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all disconnect timers
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();

    // Cancel all active duels
    for (const [duelId] of this.duelSessions) {
      this.cancelDuel(duelId, "server_shutdown");
    }

    this.duelSessions.clear();
    this.playerDuels.clear();
    this.pendingDuels.destroy();

    console.log("[DuelSystem] Destroyed");
  }

  /**
   * Process tick - called every server tick
   */
  processTick(): void {
    // Process pending challenges (distance checks, timeouts)
    this.pendingDuels.processTick();

    // Process active duels
    for (const [_duelId, session] of this.duelSessions) {
      if (session.state === "COUNTDOWN") {
        this.processCountdown(session);
      } else if (session.state === "FIGHTING") {
        this.processActiveDuel(session);
      }
    }
  }

  // ============================================================================
  // Public API - Challenge Flow
  // ============================================================================

  /**
   * Create a duel challenge from challenger to target
   */
  createChallenge(
    challengerId: string,
    challengerName: string,
    targetId: string,
    targetName: string,
  ): DuelOperationResult & { challengeId?: string } {
    // Check for self-challenge
    if (challengerId === targetId) {
      return {
        success: false,
        error: "You can't challenge yourself to a duel.",
        errorCode: DuelErrorCode.INVALID_TARGET,
      };
    }

    // Check if either player is already in a duel
    if (this.isPlayerInDuel(challengerId)) {
      return {
        success: false,
        error: "You're already in a duel.",
        errorCode: DuelErrorCode.ALREADY_IN_DUEL,
      };
    }

    if (this.isPlayerInDuel(targetId)) {
      return {
        success: false,
        error: "That player is already in a duel.",
        errorCode: DuelErrorCode.TARGET_BUSY,
      };
    }

    // Create pending challenge
    const result = this.pendingDuels.createChallenge(
      challengerId,
      challengerName,
      targetId,
      targetName,
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        errorCode: DuelErrorCode.CHALLENGE_PENDING,
      };
    }

    return {
      success: true,
      challengeId: result.challengeId,
    };
  }

  /**
   * Respond to a duel challenge (accept or decline)
   */
  respondToChallenge(
    challengeId: string,
    responderId: string,
    accept: boolean,
  ): DuelOperationResult & { duelId?: string } {
    if (accept) {
      const challenge = this.pendingDuels.acceptChallenge(
        challengeId,
        responderId,
      );
      if (!challenge) {
        return {
          success: false,
          error: "Challenge not found or expired.",
          errorCode: DuelErrorCode.CHALLENGE_NOT_FOUND,
        };
      }

      // Create duel session
      const duelId = this.createDuelSession(
        challenge.challengerId,
        challenge.challengerName,
        challenge.targetId,
        challenge.targetName,
      );

      return { success: true, duelId };
    } else {
      const challenge = this.pendingDuels.declineChallenge(
        challengeId,
        responderId,
      );
      if (!challenge) {
        return {
          success: false,
          error: "Challenge not found.",
          errorCode: DuelErrorCode.CHALLENGE_NOT_FOUND,
        };
      }

      // Emit decline event for notification
      this.world.emit("duel:challenge:declined", {
        challengeId,
        challengerId: challenge.challengerId,
        targetId: challenge.targetId,
      });

      return { success: true };
    }
  }

  // ============================================================================
  // Public API - Duel Session Management
  // ============================================================================

  /**
   * Get a duel session by ID
   */
  getDuelSession(duelId: string): DuelSession | undefined {
    return this.duelSessions.get(duelId);
  }

  /**
   * Get the duel session a player is currently in
   */
  getPlayerDuel(playerId: string): DuelSession | undefined {
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
   * Check if a player is in an active duel
   */
  isPlayerInDuel(playerId: string): boolean {
    return this.playerDuels.has(playerId);
  }

  /**
   * Cancel a duel session
   */
  cancelDuel(
    duelId: string,
    reason: string,
    cancelledBy?: string,
  ): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    // Return staked items to both players
    this.returnStakedItems(session);

    // Release arena if one was reserved
    if (session.arenaId !== null) {
      this.releaseArena(session.arenaId);
    }

    // Clean up session
    this.duelSessions.delete(duelId);
    this.playerDuels.delete(session.challengerId);
    this.playerDuels.delete(session.targetId);

    // Emit cancel event
    this.world.emit("duel:cancelled", {
      duelId,
      challengerId: session.challengerId,
      targetId: session.targetId,
      reason,
      cancelledBy,
    });

    return { success: true };
  }

  // ============================================================================
  // Public API - Rules
  // ============================================================================

  /**
   * Toggle a duel rule
   */
  toggleRule(
    duelId: string,
    playerId: string,
    rule: keyof DuelRules,
  ): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    // Must be in RULES state
    if (session.state !== "RULES") {
      return {
        success: false,
        error: "Cannot modify rules at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Must be a participant
    if (playerId !== session.challengerId && playerId !== session.targetId) {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Toggle the rule
    const newValue = !session.rules[rule];

    // Validate rule combination
    const tempRules = { ...session.rules, [rule]: newValue };
    const validationError = validateRuleCombination(tempRules);
    if (validationError !== null) {
      return {
        success: false,
        error: validationError,
        errorCode: DuelErrorCode.INVALID_RULE_COMBINATION,
      };
    }

    // Apply the change
    session.rules[rule] = newValue;

    // Reset both players' acceptance when rules change
    session.challengerAccepted = false;
    session.targetAccepted = false;

    // Emit update
    this.world.emit("duel:rules:updated", {
      duelId,
      rules: session.rules,
      modifiedBy: playerId,
    });

    return { success: true };
  }

  /**
   * Toggle equipment slot restriction
   */
  toggleEquipmentRestriction(
    duelId: string,
    playerId: string,
    slot: keyof DuelSession["equipmentRestrictions"],
  ): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    // Must be in RULES state
    if (session.state !== "RULES") {
      return {
        success: false,
        error: "Cannot modify equipment restrictions at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Must be a participant
    if (playerId !== session.challengerId && playerId !== session.targetId) {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Toggle the restriction
    session.equipmentRestrictions[slot] = !session.equipmentRestrictions[slot];

    // Reset both players' acceptance when equipment changes
    session.challengerAccepted = false;
    session.targetAccepted = false;

    // Emit update
    this.world.emit("duel:equipment:updated", {
      duelId,
      equipmentRestrictions: session.equipmentRestrictions,
      modifiedBy: playerId,
    });

    return { success: true };
  }

  /**
   * Accept current rules
   */
  acceptRules(duelId: string, playerId: string): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    if (session.state !== "RULES") {
      return {
        success: false,
        error: "Cannot accept rules at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Set acceptance
    if (playerId === session.challengerId) {
      session.challengerAccepted = true;
    } else if (playerId === session.targetId) {
      session.targetAccepted = true;
    } else {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Check if both accepted
    if (session.challengerAccepted && session.targetAccepted) {
      // Move to stakes screen
      session.state = "STAKES";
      session.challengerAccepted = false;
      session.targetAccepted = false;

      this.world.emit("duel:state:changed", {
        duelId,
        state: session.state,
      });
    } else {
      this.world.emit("duel:acceptance:updated", {
        duelId,
        challengerAccepted: session.challengerAccepted,
        targetAccepted: session.targetAccepted,
      });
    }

    return { success: true };
  }

  // ============================================================================
  // Public API - Stakes
  // ============================================================================

  /**
   * Add an item to player's stakes
   */
  addStake(
    duelId: string,
    playerId: string,
    inventorySlot: number,
    itemId: string,
    quantity: number,
    value: number,
  ): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    // Must be in STAKES state
    if (session.state !== "STAKES") {
      return {
        success: false,
        error: "Cannot modify stakes at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Must be a participant
    const isChallenger = playerId === session.challengerId;
    const isTarget = playerId === session.targetId;
    if (!isChallenger && !isTarget) {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Get the appropriate stakes array
    const stakes = isChallenger
      ? session.challengerStakes
      : session.targetStakes;

    // Check if this inventory slot is already staked
    const existingIndex = stakes.findIndex(
      (s) => s.inventorySlot === inventorySlot,
    );
    if (existingIndex >= 0) {
      // Update existing stake quantity
      stakes[existingIndex].quantity += quantity;
      stakes[existingIndex].value += value;
    } else {
      // Add new stake
      stakes.push({
        inventorySlot,
        itemId,
        quantity,
        value,
      });
    }

    // Reset both players' acceptance when stakes change
    session.challengerAccepted = false;
    session.targetAccepted = false;

    // Emit update
    this.world.emit("duel:stakes:updated", {
      duelId,
      challengerStakes: session.challengerStakes,
      targetStakes: session.targetStakes,
      modifiedBy: playerId,
    });

    return { success: true };
  }

  /**
   * Remove an item from player's stakes
   */
  removeStake(
    duelId: string,
    playerId: string,
    stakeIndex: number,
  ): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    // Must be in STAKES state
    if (session.state !== "STAKES") {
      return {
        success: false,
        error: "Cannot modify stakes at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Must be a participant
    const isChallenger = playerId === session.challengerId;
    const isTarget = playerId === session.targetId;
    if (!isChallenger && !isTarget) {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Get the appropriate stakes array
    const stakes = isChallenger
      ? session.challengerStakes
      : session.targetStakes;

    // Validate index
    if (stakeIndex < 0 || stakeIndex >= stakes.length) {
      return {
        success: false,
        error: "Invalid stake index.",
        errorCode: DuelErrorCode.STAKE_NOT_FOUND,
      };
    }

    // Remove the stake
    stakes.splice(stakeIndex, 1);

    // Reset both players' acceptance when stakes change
    session.challengerAccepted = false;
    session.targetAccepted = false;

    // Emit update
    this.world.emit("duel:stakes:updated", {
      duelId,
      challengerStakes: session.challengerStakes,
      targetStakes: session.targetStakes,
      modifiedBy: playerId,
    });

    return { success: true };
  }

  /**
   * Accept current stakes
   */
  acceptStakes(duelId: string, playerId: string): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    if (session.state !== "STAKES") {
      return {
        success: false,
        error: "Cannot accept stakes at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Set acceptance
    if (playerId === session.challengerId) {
      session.challengerAccepted = true;
    } else if (playerId === session.targetId) {
      session.targetAccepted = true;
    } else {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Check if both accepted
    if (session.challengerAccepted && session.targetAccepted) {
      // Move to confirmation screen
      session.state = "CONFIRMING";
      session.challengerAccepted = false;
      session.targetAccepted = false;

      this.world.emit("duel:state:changed", {
        duelId,
        state: session.state,
      });
    } else {
      this.world.emit("duel:acceptance:updated", {
        duelId,
        challengerAccepted: session.challengerAccepted,
        targetAccepted: session.targetAccepted,
      });
    }

    return { success: true };
  }

  // ============================================================================
  // Public API - Confirmation
  // ============================================================================

  /**
   * Accept final confirmation to start the duel
   */
  acceptFinal(
    duelId: string,
    playerId: string,
  ): DuelOperationResult & { arenaId?: number } {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    if (session.state !== "CONFIRMING") {
      return {
        success: false,
        error: "Cannot confirm at this stage.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Set acceptance
    if (playerId === session.challengerId) {
      session.challengerAccepted = true;
    } else if (playerId === session.targetId) {
      session.targetAccepted = true;
    } else {
      return {
        success: false,
        error: "You're not in this duel.",
        errorCode: DuelErrorCode.NOT_PARTICIPANT,
      };
    }

    // Check if both accepted
    if (session.challengerAccepted && session.targetAccepted) {
      // Try to reserve an arena
      const arenaId = this.reserveArena(duelId);
      if (arenaId === null) {
        // Reset acceptance - no arena available
        session.challengerAccepted = false;
        session.targetAccepted = false;

        return {
          success: false,
          error: "No arena available. Please try again.",
          errorCode: DuelErrorCode.NO_ARENA_AVAILABLE,
        };
      }

      // Arena reserved - start countdown
      session.arenaId = arenaId;
      session.state = "COUNTDOWN";
      session.countdownStartedAt = Date.now();
      session.lastCountdownTick = 3;

      // Teleport players to arena and apply equipment restrictions
      this.teleportPlayersToArena(session);
      this.applyEquipmentRestrictions(session);

      this.world.emit("duel:countdown:start", {
        duelId,
        arenaId,
        challengerId: session.challengerId,
        targetId: session.targetId,
      });

      return { success: true, arenaId };
    } else {
      this.world.emit("duel:acceptance:updated", {
        duelId,
        challengerAccepted: session.challengerAccepted,
        targetAccepted: session.targetAccepted,
      });
    }

    return { success: true };
  }

  // ============================================================================
  // Public API - Arena Management
  // ============================================================================

  /**
   * Reserve an available arena for a duel
   * Returns arena ID or null if none available
   */
  reserveArena(duelId: string): number | null {
    return this.arenaPool.reserveArena(duelId);
  }

  /**
   * Release an arena back to the pool
   */
  releaseArena(arenaId: number): void {
    this.arenaPool.releaseArena(arenaId);
    this.world.emit("duel:arena:released", { arenaId });
  }

  /**
   * Get spawn points for an arena
   */
  getArenaSpawnPoints(
    arenaId: number,
  ):
    | [{ x: number; y: number; z: number }, { x: number; y: number; z: number }]
    | undefined {
    return this.arenaPool.getSpawnPoints(arenaId);
  }

  /**
   * Get arena bounds for movement validation
   */
  getArenaBounds(arenaId: number) {
    return this.arenaPool.getArenaBounds(arenaId);
  }

  // ============================================================================
  // Public API - Rule Enforcement
  // ============================================================================

  /**
   * Check if a player is in an active duel (FIGHTING state)
   */
  isPlayerInActiveDuel(playerId: string): boolean {
    const session = this.getPlayerDuel(playerId);
    return session?.state === "FIGHTING";
  }

  /**
   * Get active duel rules for a player (null if not in active duel)
   */
  getPlayerDuelRules(playerId: string): DuelRules | null {
    const session = this.getPlayerDuel(playerId);
    if (!session || session.state !== "FIGHTING") return null;
    return session.rules;
  }

  /**
   * Check if a specific rule is active for a player's duel
   */
  isDuelRuleActive(playerId: string, rule: keyof DuelRules): boolean {
    const rules = this.getPlayerDuelRules(playerId);
    return rules ? rules[rule] : false;
  }

  /**
   * Check if player can use ranged attacks (returns false if noRanged rule active)
   */
  canUseRanged(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noRanged");
  }

  /**
   * Check if player can use melee attacks (returns false if noMelee rule active)
   */
  canUseMelee(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noMelee");
  }

  /**
   * Check if player can use magic attacks (returns false if noMagic rule active)
   */
  canUseMagic(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noMagic");
  }

  /**
   * Check if player can use special attacks (returns false if noSpecialAttack rule active)
   */
  canUseSpecialAttack(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noSpecialAttack");
  }

  /**
   * Check if player can use prayer (returns false if noPrayer rule active)
   */
  canUsePrayer(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noPrayer");
  }

  /**
   * Check if player can use potions (returns false if noPotions rule active)
   */
  canUsePotions(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noPotions");
  }

  /**
   * Check if player can eat food (returns false if noFood rule active)
   */
  canEatFood(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noFood");
  }

  /**
   * Check if player can move (returns false if noMovement rule active)
   */
  canMove(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noMovement");
  }

  /**
   * Check if player can forfeit (returns false if noForfeit rule active)
   */
  canForfeit(playerId: string): boolean {
    return !this.isDuelRuleActive(playerId, "noForfeit");
  }

  /**
   * Get the opponent ID for a player in a duel
   */
  getDuelOpponentId(playerId: string): string | null {
    const session = this.getPlayerDuel(playerId);
    if (!session) return null;
    return playerId === session.challengerId
      ? session.targetId
      : session.challengerId;
  }

  // ============================================================================
  // Public API - Forfeit
  // ============================================================================

  /**
   * Handle a player forfeiting the duel
   */
  forfeitDuel(playerId: string): DuelOperationResult {
    const session = this.getPlayerDuel(playerId);
    if (!session) {
      return {
        success: false,
        error: "You're not in a duel.",
        errorCode: DuelErrorCode.NOT_IN_DUEL,
      };
    }

    // Must be in FIGHTING state
    if (session.state !== "FIGHTING") {
      return {
        success: false,
        error: "The duel has not started yet.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Check if noForfeit rule is active
    if (session.rules.noForfeit) {
      return {
        success: false,
        error: "You cannot forfeit - this duel is to the death!",
        errorCode: DuelErrorCode.CANNOT_FORFEIT,
      };
    }

    // Determine winner and loser
    const winnerId =
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const loserId = playerId;

    // Mark as forfeited
    session.forfeitedBy = playerId;

    // Resolve the duel
    this.resolveDuel(session, winnerId, loserId, "forfeit");

    return { success: true };
  }

  // ============================================================================
  // Public API - Duel Start
  // ============================================================================

  /**
   * Start the duel countdown after both players confirm.
   * This teleports players to the arena and begins the 3-2-1 countdown.
   */
  startDuelCountdown(duelId: string): DuelOperationResult {
    const session = this.duelSessions.get(duelId);
    if (!session) {
      return {
        success: false,
        error: "Duel not found.",
        errorCode: DuelErrorCode.DUEL_NOT_FOUND,
      };
    }

    if (session.state !== "COUNTDOWN" || session.arenaId === null) {
      return {
        success: false,
        error: "Duel is not in countdown state.",
        errorCode: DuelErrorCode.INVALID_STATE,
      };
    }

    // Teleport players to arena
    this.teleportPlayersToArena(session);

    // Apply equipment restrictions
    this.applyEquipmentRestrictions(session);

    // Mark countdown start time (if not already set)
    if (!session.countdownStartedAt) {
      session.countdownStartedAt = Date.now();
    }

    // Initial countdown value will be processed in processTick
    session.lastCountdownTick = 3;

    return { success: true };
  }

  // ============================================================================
  // Private Methods - Countdown
  // ============================================================================

  /**
   * Process countdown state for a duel session
   */
  private processCountdown(session: DuelSession): void {
    if (!session.countdownStartedAt || session.arenaId === null) return;

    const elapsed = Date.now() - session.countdownStartedAt;
    const countdownSeconds = Math.floor(elapsed / 1000);

    // Determine current countdown value (3, 2, 1, 0)
    // 0-1000ms = 3, 1000-2000ms = 2, 2000-3000ms = 1, 3000+ = 0 (FIGHT!)
    let currentCount = 3 - countdownSeconds;
    if (currentCount < 0) currentCount = 0;

    // Check if we need to send a countdown tick
    if (
      session.lastCountdownTick === undefined ||
      currentCount < session.lastCountdownTick
    ) {
      session.lastCountdownTick = currentCount;

      // Emit countdown tick to both players
      this.world.emit("duel:countdown:tick", {
        duelId: session.duelId,
        count: currentCount,
        challengerId: session.challengerId,
        targetId: session.targetId,
      });

      // If countdown reached 0, start the fight!
      if (currentCount === 0) {
        this.startFight(session);
      }
    }
  }

  /**
   * Start the actual fight after countdown completes
   */
  private startFight(session: DuelSession): void {
    session.state = "FIGHTING";
    session.fightStartedAt = Date.now();

    // Emit fight start event
    this.world.emit("duel:fight:start", {
      duelId: session.duelId,
      challengerId: session.challengerId,
      targetId: session.targetId,
      arenaId: session.arenaId,
    });
  }

  /**
   * Teleport both players to their arena spawn points
   */
  private teleportPlayersToArena(session: DuelSession): void {
    if (session.arenaId === null) return;

    const spawnPoints = this.arenaPool.getSpawnPoints(session.arenaId);
    if (!spawnPoints) return;

    const [spawn1, spawn2] = spawnPoints;

    // Teleport challenger to spawn 1 (north)
    this.teleportPlayer(session.challengerId, spawn1, spawn2);

    // Teleport target to spawn 2 (south)
    this.teleportPlayer(session.targetId, spawn2, spawn1);
  }

  /**
   * Teleport a player to a position, facing toward a target position
   */
  private teleportPlayer(
    playerId: string,
    position: { x: number; y: number; z: number },
    faceToward: { x: number; y: number; z: number },
  ): void {
    const player = this.world.entities.players?.get(playerId);
    if (!player) return;

    // Calculate rotation to face the opponent
    const dx = faceToward.x - position.x;
    const dz = faceToward.z - position.z;
    const angle = Math.atan2(dx, dz);

    // Emit teleport event for the network system to handle
    this.world.emit("player:teleport", {
      playerId,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: angle,
    });
  }

  /**
   * Apply equipment restrictions - unequip items in disabled slots
   */
  private applyEquipmentRestrictions(session: DuelSession): void {
    const restrictions = session.equipmentRestrictions;
    const disabledSlots = (
      Object.keys(restrictions) as Array<keyof typeof restrictions>
    ).filter((slot) => restrictions[slot]);

    if (disabledSlots.length === 0) return;

    // Emit equipment restriction event for both players
    this.world.emit("duel:equipment:restrict", {
      duelId: session.duelId,
      challengerId: session.challengerId,
      targetId: session.targetId,
      disabledSlots,
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create a new duel session
   */
  private createDuelSession(
    challengerId: string,
    challengerName: string,
    targetId: string,
    targetName: string,
  ): string {
    const duelId = `duel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const session: DuelSession = {
      duelId,
      state: "RULES",
      challengerId,
      challengerName,
      targetId,
      targetName,
      rules: { ...DEFAULT_DUEL_RULES },
      equipmentRestrictions: {
        head: false,
        cape: false,
        amulet: false,
        weapon: false,
        body: false,
        shield: false,
        legs: false,
        gloves: false,
        boots: false,
        ring: false,
        ammo: false,
      },
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
   * Handle player disconnect during duel (public API for ServerNetwork)
   */
  onPlayerDisconnect(playerId: string): void {
    // Cancel any pending challenges
    this.pendingDuels.cancelPlayerChallenges(playerId);

    // Check if player is in an active duel
    const duelId = this.playerDuels.get(playerId);
    if (!duelId) return;

    const session = this.duelSessions.get(duelId);
    if (!session) return;

    // If in FIGHTING state, start disconnect timer instead of immediate cancel
    if (session.state === "FIGHTING") {
      this.startDisconnectTimer(playerId, session);
      return;
    }

    // For setup states (RULES, STAKES, CONFIRMING, COUNTDOWN), cancel immediately
    this.cancelDuel(duelId, "player_disconnected", playerId);
  }

  /**
   * Handle player reconnect during duel
   */
  onPlayerReconnect(playerId: string): void {
    // Clear any pending disconnect timer
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);

      // Notify both players that the disconnected player returned
      const duelId = this.playerDuels.get(playerId);
      if (duelId) {
        const session = this.duelSessions.get(duelId);
        if (session) {
          this.world.emit("duel:player:reconnected", {
            duelId,
            playerId,
            challengerId: session.challengerId,
            targetId: session.targetId,
          });
        }
      }
    }
  }

  /**
   * Start disconnect timer for player in active combat
   */
  private startDisconnectTimer(playerId: string, session: DuelSession): void {
    // Don't start another timer if one already exists
    if (this.disconnectTimers.has(playerId)) return;

    // Notify opponent that player disconnected
    this.world.emit("duel:player:disconnected", {
      duelId: session.duelId,
      playerId,
      challengerId: session.challengerId,
      targetId: session.targetId,
      timeoutMs: DuelSystem.DISCONNECT_TIMEOUT_MS,
    });

    // If noForfeit rule is active, instant loss (can't forfeit, so disconnect = loss)
    if (session.rules.noForfeit) {
      const winnerId =
        playerId === session.challengerId
          ? session.targetId
          : session.challengerId;
      this.resolveDuel(session, winnerId, playerId, "forfeit");
      return;
    }

    // Start 30-second timer for reconnection
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);

      // Check if duel still exists and player is still disconnected
      const duelId = this.playerDuels.get(playerId);
      if (!duelId) return;

      const currentSession = this.duelSessions.get(duelId);
      if (!currentSession || currentSession.state !== "FIGHTING") return;

      // Auto-forfeit: disconnected player loses
      const winnerId =
        playerId === currentSession.challengerId
          ? currentSession.targetId
          : currentSession.challengerId;

      this.resolveDuel(currentSession, winnerId, playerId, "forfeit");
    }, DuelSystem.DISCONNECT_TIMEOUT_MS);

    this.disconnectTimers.set(playerId, timer);
  }

  /**
   * Handle player death during duel
   */
  private handlePlayerDeath(playerId: string): void {
    const duelId = this.playerDuels.get(playerId);
    if (!duelId) return;

    const session = this.duelSessions.get(duelId);
    if (!session) return;

    // Only process deaths during active combat
    if (session.state !== "FIGHTING") {
      this.cancelDuel(duelId, "player_died_before_fight");
      return;
    }

    // Determine winner
    const winnerId =
      playerId === session.challengerId
        ? session.targetId
        : session.challengerId;
    const loserId = playerId;

    this.resolveDuel(session, winnerId, loserId, "death");
  }

  /**
   * Resolve a duel with a winner
   */
  private resolveDuel(
    session: DuelSession,
    winnerId: string,
    loserId: string,
    reason: "death" | "forfeit",
  ): void {
    session.state = "FINISHED";
    session.winnerId = winnerId;
    session.finishedAt = Date.now();

    // Calculate what each player staked
    const winnerIsChallenger = winnerId === session.challengerId;
    const winnerStakes = winnerIsChallenger
      ? session.challengerStakes
      : session.targetStakes;
    const loserStakes = winnerIsChallenger
      ? session.targetStakes
      : session.challengerStakes;

    const winnerName = winnerIsChallenger
      ? session.challengerName
      : session.targetName;
    const loserName = winnerIsChallenger
      ? session.targetName
      : session.challengerName;

    // Calculate total values
    const winnerReceivesValue = loserStakes.reduce(
      (sum, s) => sum + s.value,
      0,
    );

    // Transfer stakes to winner
    this.transferStakes(session, winnerId);

    // Teleport loser to hospital
    this.teleportToHospital(loserId);

    // Teleport winner to lobby
    this.teleportToLobby(winnerId);

    // Emit duel completed event with full details
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

    // Release arena
    if (session.arenaId !== null) {
      this.releaseArena(session.arenaId);
    }

    // Clean up
    this.duelSessions.delete(session.duelId);
    this.playerDuels.delete(session.challengerId);
    this.playerDuels.delete(session.targetId);
  }

  /**
   * Process active duel (bounds checking, rule enforcement)
   */
  private processActiveDuel(session: DuelSession): void {
    if (session.arenaId === null) return;

    const bounds = this.arenaPool.getArenaBounds(session.arenaId);
    if (!bounds) return;

    const spawnPoints = this.arenaPool.getSpawnPoints(session.arenaId);
    if (!spawnPoints) return;

    // Check both players for arena bounds violations
    // Teleport back to spawn point if they leave bounds
    this.enforceArenaBounds(
      session.challengerId,
      bounds,
      spawnPoints[0],
      spawnPoints[1],
    );
    this.enforceArenaBounds(
      session.targetId,
      bounds,
      spawnPoints[1],
      spawnPoints[0],
    );

    // If noMovement rule is active, freeze players at spawn points
    if (session.rules.noMovement) {
      this.enforceNoMovement(session.challengerId, spawnPoints[0]);
      this.enforceNoMovement(session.targetId, spawnPoints[1]);
    }
  }

  /**
   * Enforce arena bounds - teleport player back to spawn if they leave
   */
  private enforceArenaBounds(
    playerId: string,
    bounds: { min: { x: number; z: number }; max: { x: number; z: number } },
    spawnPoint: { x: number; y: number; z: number },
    opponentSpawn: { x: number; y: number; z: number },
  ): void {
    const player = this.world.entities.players?.get(playerId);
    if (!player?.position) return;

    const { x, z } = player.position;

    // Check if player is outside bounds
    const isOutOfBounds =
      x < bounds.min.x ||
      x > bounds.max.x ||
      z < bounds.min.z ||
      z > bounds.max.z;

    if (isOutOfBounds) {
      // Calculate rotation to face opponent
      const dx = opponentSpawn.x - spawnPoint.x;
      const dz = opponentSpawn.z - spawnPoint.z;
      const rotation = Math.atan2(dx, dz);

      // Teleport back to spawn point facing opponent
      this.world.emit("player:teleport", {
        playerId,
        position: { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
        rotation,
      });

      // Clear movement state to prevent them from immediately walking out again
      this.world.emit("player:movement:cancel", { playerId });
    }
  }

  /**
   * Enforce no movement rule - keep player at spawn point
   */
  private enforceNoMovement(
    playerId: string,
    spawnPoint: { x: number; y: number; z: number },
  ): void {
    const player = this.world.entities.players?.get(playerId);
    if (!player?.position) return;

    const { x, z } = player.position;
    const tolerance = 0.5;

    const dx = Math.abs(x - spawnPoint.x);
    const dz = Math.abs(z - spawnPoint.z);

    if (dx > tolerance || dz > tolerance) {
      this.world.emit("player:teleport", {
        playerId,
        position: { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
        rotation: 0,
      });
    }
  }

  /**
   * Return staked items to both players (on cancel/disconnect)
   */
  private returnStakedItems(session: DuelSession): void {
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

  /**
   * Transfer all stakes to the winner
   */
  private transferStakes(session: DuelSession, winnerId: string): void {
    const loserId =
      winnerId === session.challengerId
        ? session.targetId
        : session.challengerId;

    // Get winner's stakes (they keep their own)
    const winnerStakes =
      winnerId === session.challengerId
        ? session.challengerStakes
        : session.targetStakes;

    // Get loser's stakes (transferred to winner)
    const loserStakes =
      winnerId === session.challengerId
        ? session.targetStakes
        : session.challengerStakes;

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

    // Return winner's own stakes to their inventory
    if (winnerStakes.length > 0) {
      this.world.emit("duel:stakes:return", {
        playerId: winnerId,
        stakes: winnerStakes,
        reason: "duel_won",
      });
    }

    // Give loser's stakes to winner
    if (loserStakes.length > 0) {
      this.world.emit("duel:stakes:award", {
        playerId: winnerId,
        stakes: loserStakes,
        reason: "duel_won",
        fromPlayerId: loserId,
      });
    }
  }

  /**
   * Teleport player to hospital spawn point (loser)
   */
  private teleportToHospital(playerId: string): void {
    // Hospital spawn point - can be configured from world data
    const hospitalSpawn = { x: 60, y: 0, z: 60 };

    this.world.emit("player:teleport", {
      playerId,
      position: hospitalSpawn,
      rotation: 0,
    });
  }

  /**
   * Teleport player to duel arena lobby (winner)
   */
  private teleportToLobby(playerId: string): void {
    // Lobby spawn point - center of duel arena lobby area
    const lobbySpawn = { x: 105, y: 0, z: 60 };

    this.world.emit("player:teleport", {
      playerId,
      position: lobbySpawn,
      rotation: 0,
    });
  }

  /**
   * Clean up expired or stale sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const maxSessionAge = 30 * 60 * 1000; // 30 minutes max

    for (const [duelId, session] of this.duelSessions) {
      // Cancel sessions stuck in non-fighting states for too long
      if (
        session.state !== "FIGHTING" &&
        now - session.createdAt > maxSessionAge
      ) {
        this.cancelDuel(duelId, "session_timeout");
      }
    }
  }
}
