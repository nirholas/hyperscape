/**
 * CombatSystem - Handles all combat mechanics
 */

import { EventType } from "../../../types/events";
import type { World } from "../../../core/World";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import { AttackType, MobInstance } from "../../../types/core/core";
import { EntityID } from "../../../types/core/identifiers";
import { MobEntity } from "../../../entities/npc/MobEntity";
import { MobAIState } from "../../../types/entities";
import { Entity } from "../../../entities/Entity";
import { PlayerSystem } from "..";
import {
  calculateDamage,
  calculateDistance2D,
  calculateDistance3D,
  CombatStats,
  isAttackOnCooldown,
  isAttackOnCooldownTicks,
  calculateRetaliationDelay,
  attackSpeedSecondsToTicks,
  attackSpeedMsToTicks,
} from "../../../utils/game/CombatCalculations";
import { createEntityID } from "../../../utils/IdentifierUtils";
import { EntityManager } from "..";
import { MobNPCSystem } from "..";
import { SystemBase } from "..";
import { Emotes } from "../../../data/playerEmotes";
import { getItem } from "../../../data/items";
import { tilesWithinMeleeRange } from "../movement/TileSystem";
import { tilePool, PooledTile } from "../../../utils/pools/TilePool";
import { CombatAnimationManager } from "./CombatAnimationManager";
import { CombatRotationManager } from "./CombatRotationManager";
import { CombatStateService, CombatData } from "./CombatStateService";
import {
  CombatAntiCheat,
  CombatViolationType,
  CombatViolationSeverity,
} from "./CombatAntiCheat";
import { getEntityPosition } from "../../../utils/game/EntityPositionUtils";
import { quaternionPool } from "../../../utils/pools/QuaternionPool";
import { EntityIdValidator } from "./EntityIdValidator";
import { CombatRateLimiter } from "./CombatRateLimiter";
import {
  EventStore,
  GameEventType,
  type GameStateInfo,
  type EntitySnapshot,
  type CombatSnapshot,
} from "../EventStore";
import {
  getGameRngState,
  type SeededRandomState,
} from "../../../utils/SeededRandom";
import {
  DamageHandler,
  PlayerDamageHandler,
  MobDamageHandler,
} from "./handlers";
import { PidManager } from "./PidManager";
import { getGameRng } from "../../../utils/SeededRandom";
import {
  isEntityDead,
  getMobRetaliates,
  getPendingAttacker,
  clearPendingAttacker,
  isPlayerDamageHandler,
  isMobEntity,
} from "../../../utils/typeGuards";

// Re-export CombatData from CombatStateService for backwards compatibility
export type { CombatData } from "./CombatStateService";

/**
 * Interface for player entity properties accessed by CombatSystem
 * Uses abbreviated keys for network bandwidth efficiency:
 * - c = inCombat, ct = combatTarget, e = emote
 */
interface CombatPlayerEntity {
  id: string;
  combat?: {
    inCombat: boolean;
    combatTarget: string | null;
  };
  data?: {
    c?: boolean; // inCombat (abbreviated)
    ct?: string | null; // combatTarget (abbreviated)
    e?: string; // emote (abbreviated)
    isLoading?: boolean;
  };
  emote?: string;
  base?: {
    quaternion: { set(x: number, y: number, z: number, w: number): void };
  };
  node?: {
    quaternion: {
      set(x: number, y: number, z: number, w: number): void;
      copy(q: { x: number; y: number; z: number; w: number }): void;
    };
  };
  position?: { x: number; y: number; z: number };
  getPosition?: () => { x: number; y: number; z: number };
  markNetworkDirty?: () => void;
  health?: number;
  name?: string;
}

/**
 * Interface for mob entity with optional setServerEmote method
 * Used for type-safe emote setting in combat
 */
interface MobWithServerEmote {
  setServerEmote?: (emote: string) => void;
}

/**
 * Attack data structure for validation and execution
 */
interface MeleeAttackData {
  attackerId: string;
  targetId: string;
  attackerType: "player" | "mob";
  targetType: "player" | "mob";
}

/**
 * Result of attack validation
 * Contains validated entities if successful, or null if validation failed
 */
interface AttackValidationResult {
  valid: boolean;
  attacker: Entity | MobEntity | null;
  target: Entity | MobEntity | null;
  typedAttackerId: EntityID | null;
  typedTargetId: EntityID | null;
}

export class CombatSystem extends SystemBase {
  private nextAttackTicks = new Map<EntityID, number>(); // Tick when entity can next attack
  private mobSystem?: MobNPCSystem;
  private entityManager?: EntityManager;
  private playerSystem?: PlayerSystem; // Cached for auto-retaliate checks (hot path optimization)

  // Modular services (Phase 5 extraction)
  // Note: stateService is public for GameTickProcessor access (OSRS-accurate tick processing)
  public readonly stateService: CombatStateService;
  private animationManager: CombatAnimationManager;
  private rotationManager: CombatRotationManager;

  // Anti-cheat monitoring (Phase 6 - Game Studio Hardening)
  private antiCheat: CombatAntiCheat;

  // Input validation and rate limiting (Phase 6.5 - Security Hardening)
  private entityIdValidator: EntityIdValidator;
  private rateLimiter: CombatRateLimiter;

  // Combat event recording for replay/debugging (Phase 7 - EventStore Integration)
  private eventStore: EventStore;
  private eventRecordingEnabled: boolean = true;

  // Equipment stats cache per player for damage calculations
  private playerEquipmentStats = new Map<
    string,
    { attack: number; strength: number; defense: number; ranged: number }
  >();

  // Pre-allocated pooled tiles for hot path calculations (zero GC)
  private readonly _attackerTile: PooledTile = tilePool.acquire();
  private readonly _targetTile: PooledTile = tilePool.acquire();

  // AFK tracking for auto-retaliate disable (Phase 6.5.2)
  // OSRS: Auto-retaliate disabled after 20 minutes of no input
  private lastInputTick = new Map<string, number>();

  // Polymorphic damage handlers (Phase 8 - SOLID refactoring)
  // Eliminates player/mob conditionals in damage application
  private damageHandlers: Map<"player" | "mob", DamageHandler>;

  // PID Manager for OSRS-style combat priority (Phase 9 - PvP Fairness)
  // Lower PID = higher priority = hits first when attacks happen same tick
  // PIDs shuffle every 60-150 seconds for fairness
  // @see https://oldschool.runescape.wiki/w/PID
  public readonly pidManager: PidManager;

  constructor(world: World) {
    super(world, {
      name: "combat",
      dependencies: {
        required: ["entity-manager"], // Combat needs entity manager
        optional: ["mob-npc"], // Combat can work without mob NPCs but better with them
      },
      autoCleanup: true,
    });

    // Initialize modular services
    this.stateService = new CombatStateService(world);
    this.animationManager = new CombatAnimationManager(world);
    this.rotationManager = new CombatRotationManager(world);

    // Initialize anti-cheat monitoring (Phase 6 - Game Studio Hardening)
    this.antiCheat = new CombatAntiCheat();

    // Initialize input validation and rate limiting (Phase 6.5 - Security Hardening)
    this.entityIdValidator = new EntityIdValidator();
    this.rateLimiter = new CombatRateLimiter();

    // Initialize event store for combat replay/debugging (Phase 7)
    // Snapshots every 100 ticks (~60 seconds), keeps 100k events and 10 snapshots
    this.eventStore = new EventStore({
      snapshotInterval: 100,
      maxEvents: 100000,
      maxSnapshots: 10,
    });

    // Initialize polymorphic damage handlers (Phase 8 - SOLID refactoring)
    this.damageHandlers = new Map();
    this.damageHandlers.set("player", new PlayerDamageHandler(world));
    this.damageHandlers.set("mob", new MobDamageHandler(world));

    // Initialize PID manager for OSRS-style combat priority (Phase 9 - PvP Fairness)
    // Uses game RNG for deterministic shuffle timing
    this.pidManager = new PidManager(getGameRng());
  }

  async init(): Promise<void> {
    // Get entity manager - required dependency
    this.entityManager = this.world.getSystem<EntityManager>("entity-manager");
    if (!this.entityManager) {
      throw new Error(
        "[CombatSystem] EntityManager not found - required dependency",
      );
    }

    // Get mob NPC system - optional but recommended
    this.mobSystem = this.world.getSystem<MobNPCSystem>("mob-npc");

    // Cache PlayerSystem for auto-retaliate checks (hot path optimization)
    // Optional dependency - combat still works without it (defaults to retaliate)
    this.playerSystem = this.world.getSystem<PlayerSystem>("player");

    // Cache PlayerSystem into PlayerDamageHandler for damage application
    const playerHandler = this.damageHandlers.get("player");
    if (isPlayerDamageHandler(playerHandler)) {
      playerHandler.cachePlayerSystem(this.playerSystem ?? null);
    }

    // Listen for auto-retaliate toggle to start combat if toggled ON while being attacked
    this.subscribe(
      EventType.UI_AUTO_RETALIATE_CHANGED,
      (data: { playerId: string; enabled: boolean }) => {
        if (data.enabled) {
          this.handleAutoRetaliateEnabled(data.playerId);
        }
      },
    );

    // OSRS-accurate: Player clicked to move = cancel their attacking combat
    // In OSRS, clicking anywhere else cancels your current action including combat
    this.subscribe(
      EventType.COMBAT_PLAYER_DISENGAGE,
      (data: { playerId: string }) => {
        this.handlePlayerDisengage(data.playerId);
      },
    );

    // Set up event listeners - required for combat to function
    this.subscribe(
      EventType.COMBAT_ATTACK_REQUEST,
      (data: {
        playerId: string;
        targetId: string;
        attackType?: AttackType;
      }) => {
        this.handleAttack({
          attackerId: data.playerId,
          targetId: data.targetId,
          attackerType: "player",
          targetType: "mob",
          attackType: data.attackType || AttackType.MELEE,
        });
      },
    );
    this.subscribe<{
      attackerId: string;
      targetId: string;
      attackerType: "player" | "mob";
      targetType: "player" | "mob";
    }>(EventType.COMBAT_MELEE_ATTACK, (data) => {
      this.handleMeleeAttack(data);
    });
    // MVP: Ranged combat subscription removed - melee only
    this.subscribe(
      EventType.COMBAT_MOB_NPC_ATTACK,
      (data: { mobId: string; targetId: string }) => {
        this.handleMobAttack(data);
      },
    );

    // Listen for death events to end combat
    this.subscribe(EventType.NPC_DIED, (data: { mobId: string }) => {
      this.handleEntityDied(data.mobId, "mob");
    });
    this.subscribe(EventType.PLAYER_DIED, (data: { playerId: string }) => {
      this.handleEntityDied(data.playerId, "player");
    });
    // Also listen for ENTITY_DEATH to catch all entity destructions
    this.subscribe(
      EventType.ENTITY_DEATH,
      (data: { entityId: string; entityType: string }) => {
        this.handleEntityDied(data.entityId, data.entityType);
      },
    );

    // PID Assignment: Assign PID when player joins (Phase 9 - PvP Fairness)
    // PIDs determine combat priority - lower PID hits first on same tick
    this.subscribe(EventType.PLAYER_JOINED, (data: { playerId: string }) => {
      const tickNumber = this.world.currentTick ?? 0;
      this.pidManager.assignPid(data.playerId as EntityID, tickNumber);
    });

    // Listen for player disconnect to clean up combat state and remove PID
    // This prevents orphaned combat states when players disconnect mid-combat
    this.subscribe(EventType.PLAYER_LEFT, (data: { playerId: string }) => {
      this.cleanupPlayerDisconnect(data.playerId);
      // Remove PID when player leaves (Phase 9 - PvP Fairness)
      this.pidManager.removePid(data.playerId as EntityID);
    });

    // Listen for explicit combat stop requests (e.g., player clicking new target)
    this.subscribe(
      EventType.COMBAT_STOP_ATTACK,
      (data: { attackerId: string }) => {
        if (this.stateService.isInCombat(data.attackerId)) {
          this.logger.info("Stopping combat for target switch", {
            attackerId: data.attackerId,
          });
          this.forceEndCombat(data.attackerId);
        }
      },
    );

    // Issue #342: Listen for combat follow events to initiate player movement toward target
    this.subscribe(
      EventType.COMBAT_FOLLOW_TARGET,
      (data: {
        playerId: string;
        targetId: string;
        targetPosition: { x: number; y: number; z: number };
      }) => {
        this.handleCombatFollow(data);
      },
    );

    // Listen for equipment stats updates to use bonuses in damage calculation
    this.subscribe(
      EventType.PLAYER_STATS_EQUIPMENT_UPDATED,
      (data: {
        playerId: string;
        equipmentStats: {
          attack: number;
          strength: number;
          defense: number;
          ranged: number;
        };
      }) => {
        this.playerEquipmentStats.set(data.playerId, data.equipmentStats);
      },
    );
  }

  private handleAttack(data: {
    attackerId: string;
    targetId: string;
    attackerType: "player" | "mob";
    targetType: "player" | "mob";
    attackType?: AttackType;
  }): void {
    // MVP: All attacks are melee
    this.handleMeleeAttack(data);
  }

  /**
   * Main melee attack handler - orchestrates validation and execution
   * Refactored for clarity: validation logic extracted to validateMeleeAttack(),
   * execution logic extracted to executeMeleeAttack()
   */
  private handleMeleeAttack(data: MeleeAttackData): void {
    const { attackerId, targetId, attackerType } = data;
    const currentTick = this.world.currentTick;

    // Phase 6.5: Input validation - reject malformed entity IDs
    if (!this.entityIdValidator.isValid(attackerId)) {
      const sanitized = this.entityIdValidator.sanitizeForLogging(attackerId);
      this.logger.warn("Invalid attacker ID rejected", {
        attackerId: sanitized,
        reason: "invalid_format",
      });
      this.antiCheat.recordInvalidEntityId(
        String(attackerId).slice(0, 64),
        String(attackerId),
      );
      return;
    }

    if (!this.entityIdValidator.isValid(targetId)) {
      const sanitized = this.entityIdValidator.sanitizeForLogging(targetId);
      this.logger.warn("Invalid target ID rejected", {
        attackerId,
        targetId: sanitized,
        reason: "invalid_format",
      });
      this.antiCheat.recordInvalidEntityId(attackerId, String(targetId));
      return;
    }

    // Phase 6.5: Rate limiting - prevent request flooding
    if (attackerType === "player") {
      const rateResult = this.rateLimiter.checkLimit(attackerId, currentTick);
      if (!rateResult.allowed) {
        this.logger.warn("Attack rate limited", {
          attackerId,
          reason: rateResult.reason,
          cooldownUntil: rateResult.cooldownUntil,
        });
        return;
      }
    }

    // Anti-cheat: Track attack rate for players (Phase 6)
    if (attackerType === "player") {
      this.antiCheat.trackAttack(attackerId, currentTick);
    }

    // Validate the attack (entities exist, alive, in range, etc.)
    const validation = this.validateMeleeAttack(data, currentTick);
    if (!validation.valid) {
      return;
    }

    // Check cooldown before executing
    if (!this.checkAttackCooldown(validation.typedAttackerId!, currentTick)) {
      return;
    }

    // Execute the attack
    this.executeMeleeAttack(data, validation, currentTick);
  }

  /**
   * Validate all preconditions for a melee attack
   * Returns validation result with entities if valid
   */
  private validateMeleeAttack(
    data: MeleeAttackData,
    currentTick: number,
  ): AttackValidationResult {
    const { attackerId, targetId, attackerType, targetType } = data;
    const invalidResult: AttackValidationResult = {
      valid: false,
      attacker: null,
      target: null,
      typedAttackerId: null,
      typedTargetId: null,
    };

    // Convert IDs to typed IDs
    const typedAttackerId = createEntityID(attackerId);
    const typedTargetId = createEntityID(targetId);

    // Get attacker and target entities
    const attacker = this.getEntity(attackerId, attackerType);
    const target = this.getEntity(targetId, targetType);

    // Check entities exist
    if (!attacker || !target) {
      if (attackerType === "player" && !target) {
        this.antiCheat.recordNonexistentTargetAttack(
          attackerId,
          targetId,
          currentTick,
        );
      }
      return invalidResult;
    }

    // Check attacker is alive
    if (!this.isEntityAlive(attacker, attackerType)) {
      return invalidResult;
    }

    // Check target is alive (Issue #265)
    if (!this.isEntityAlive(target, targetType)) {
      if (attackerType === "player") {
        this.antiCheat.recordDeadTargetAttack(
          attackerId,
          targetId,
          currentTick,
        );
      }
      return invalidResult;
    }

    // Check target not in loading protection (Issue #356)
    if (targetType === "player" && target.data?.isLoading) {
      if (attackerType === "player") {
        this.antiCheat.recordViolation(
          attackerId,
          CombatViolationType.ATTACK_DURING_PROTECTION,
          CombatViolationSeverity.MODERATE,
          `Attacked player ${targetId} during loading protection`,
          targetId,
          currentTick,
        );
      }
      return invalidResult;
    }

    // Check target is attackable (for mobs)
    if (targetType === "mob") {
      const mobEntity = target as MobEntity;
      if (mobEntity.isAttackable && !mobEntity.isAttackable()) {
        this.emitTypedEvent(EventType.COMBAT_ATTACK_FAILED, {
          attackerId,
          targetId,
          reason: "target_not_attackable",
        });
        return invalidResult;
      }
    }

    // Check not self-attack
    if (attackerId === targetId) {
      if (attackerType === "player") {
        this.antiCheat.recordSelfAttack(attackerId, currentTick);
      }
      return invalidResult;
    }

    // Check range
    if (
      !this.isWithinCombatRange(
        attacker,
        target,
        attackerType,
        data,
        currentTick,
      )
    ) {
      return invalidResult;
    }

    return {
      valid: true,
      attacker,
      target,
      typedAttackerId,
      typedTargetId,
    };
  }

  /**
   * Check if attacker is within combat range of target
   *
   * OSRS melee rules (from wiki):
   * - Range 1 (standard melee): Cardinal only (N/S/E/W) - NO diagonal attacks
   * - Range 2+ (halberd): Allows diagonal attacks
   *
   * @see https://oldschool.runescape.wiki/w/Attack_range
   */
  private isWithinCombatRange(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    attackerType: "player" | "mob",
    data: MeleeAttackData,
    currentTick: number,
  ): boolean {
    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return false;

    // Use pre-allocated pooled tiles (zero GC)
    tilePool.setFromPosition(this._attackerTile, attackerPos);
    tilePool.setFromPosition(this._targetTile, targetPos);
    const combatRangeTiles = this.getEntityCombatRange(attacker, attackerType);

    // OSRS-accurate melee range check:
    // - Range 1: Cardinal only (N/S/E/W)
    // - Range 2+: Allows diagonal (Chebyshev distance)
    if (
      !tilesWithinMeleeRange(
        this._attackerTile,
        this._targetTile,
        combatRangeTiles,
      )
    ) {
      if (attackerType === "player") {
        const dx = Math.abs(this._attackerTile.x - this._targetTile.x);
        const dz = Math.abs(this._attackerTile.z - this._targetTile.z);
        const actualDistance = Math.max(dx, dz);
        this.antiCheat.recordOutOfRangeAttack(
          data.attackerId,
          data.targetId,
          actualDistance,
          combatRangeTiles,
          currentTick,
        );
      }
      this.emitTypedEvent(EventType.COMBAT_ATTACK_FAILED, {
        attackerId: data.attackerId,
        targetId: data.targetId,
        reason: "out_of_range",
      });
      return false;
    }
    return true;
  }

  /**
   * Check if attack is on cooldown
   */
  private checkAttackCooldown(
    typedAttackerId: EntityID,
    currentTick: number,
  ): boolean {
    const nextAllowedTick = this.nextAttackTicks.get(typedAttackerId) ?? 0;
    return !isAttackOnCooldownTicks(currentTick, nextAllowedTick);
  }

  /**
   * Execute a validated melee attack
   * Handles rotation, animation, damage, and combat state
   */
  private executeMeleeAttack(
    data: MeleeAttackData,
    validation: AttackValidationResult,
    currentTick: number,
  ): void {
    const { attackerId, targetId, attackerType, targetType } = data;
    const { attacker, target, typedAttackerId, typedTargetId } = validation;

    if (!attacker || !target || !typedAttackerId || !typedTargetId) return;

    // Get attack speed
    const entityType = attacker.type === "mob" ? "mob" : "player";
    const attackSpeedTicks = this.getAttackSpeedTicks(
      typedAttackerId,
      entityType,
    );

    // Face target
    this.rotationManager.rotateTowardsTarget(
      attackerId,
      targetId,
      attackerType,
      targetType,
    );

    // Play attack animation (Issue #340: pass attack speed for proper animation duration)
    this.animationManager.setCombatEmote(
      attackerId,
      attackerType,
      currentTick,
      attackSpeedTicks,
    );

    // Calculate and apply damage
    const rawDamage = this.calculateMeleeDamage(attacker, target);
    const currentHealth = this.getEntityHealth(target);
    const damage = Math.min(rawDamage, currentHealth);

    this.applyDamage(targetId, targetType, damage, attackerId);

    // Emit damage event
    const targetPosition = getEntityPosition(target);
    this.emitTypedEvent(EventType.COMBAT_DAMAGE_DEALT, {
      attackerId,
      targetId,
      damage,
      targetType,
      position: targetPosition,
    });

    // Check if target died - skip remaining logic if so (Issue #265)
    if (!this.isEntityAlive(target, targetType)) {
      return;
    }

    // Set cooldown and enter combat state
    this.nextAttackTicks.set(typedAttackerId, currentTick + attackSpeedTicks);
    this.enterCombat(typedAttackerId, typedTargetId, attackSpeedTicks);
  }

  // MVP: handleRangedAttack removed - melee only

  private handleMobAttack(data: { mobId: string; targetId: string }): void {
    // Handle mob attacking player
    this.handleMeleeAttack({
      attackerId: data.mobId,
      targetId: data.targetId,
      attackerType: "mob",
      targetType: "player",
    });
  }

  /**
   * Handle auto-retaliate being toggled ON while being attacked
   * OSRS behavior: Player should start fighting back immediately
   *
   * Supports both PvE (mob attacker) and PvP (player attacker) scenarios.
   */
  private handleAutoRetaliateEnabled(playerId: string): void {
    const playerEntity = this.world.getPlayer?.(playerId);
    if (!playerEntity) return;

    // Use type guard to get pending attacker ID
    const pendingAttacker = getPendingAttacker(playerEntity);
    if (!pendingAttacker) return;

    // Detect attacker type dynamically - supports both PvP and PvE
    // This fixes the bug where PvP retaliation failed because we assumed "mob"
    const attackerType = this.getEntityType(pendingAttacker);
    const attackerEntity = this.getEntity(pendingAttacker, attackerType);

    if (!attackerEntity || !this.isEntityAlive(attackerEntity, attackerType)) {
      // Attacker gone - clear pending attacker state using type guard
      clearPendingAttacker(playerEntity);
      return;
    }

    // Start combat! Player now retaliates against the attacker
    const attackSpeedTicks = this.getAttackSpeedTicks(
      createEntityID(playerId),
      "player",
    );

    // enterCombat() detects entity types internally
    this.enterCombat(
      createEntityID(playerId),
      createEntityID(pendingAttacker),
      attackSpeedTicks,
    );

    // Clear pending attacker since we're now actively fighting
    clearPendingAttacker(playerEntity);

    // Clear server face target since player now has a combat target
    this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
      playerId: playerId,
    });

    // Face the target and start combat animation
    this.rotationManager.rotateTowardsTarget(
      playerId,
      pendingAttacker,
      "player",
      attackerType, // Was hardcoded "mob" - now supports PvP
    );
  }

  /**
   * OSRS-accurate: Handle player clicking to move (disengage from combat)
   * In OSRS, clicking anywhere else cancels your current action including combat.
   * This allows players to walk away from fights regardless of auto-retaliate setting.
   */
  private handlePlayerDisengage(playerId: string): void {
    // Check if player is currently attacking something
    const combatState = this.stateService.getCombatData(playerId);
    if (!combatState || combatState.attackerType !== "player") {
      return; // Not in combat as an attacker, nothing to cancel
    }

    const targetId = String(combatState.targetId);

    // End the player's attacking combat state
    this.forceEndCombat(playerId);

    // Mark player as "in combat without target" - the mob is still attacking them
    // This keeps the combat timer active but player won't auto-attack
    // If auto-retaliate is ON and mob catches up and hits, player will start fighting again
    this.stateService.markInCombatWithoutTarget(playerId, targetId);

    // OSRS-ACCURATE: Do NOT face the mob when walking away
    // Player should face their walking direction (handled by tile movement)
    // Only face mob when auto-retaliate triggers (handled by enterCombat)
  }

  /**
   * Issue #342: Handle combat follow - move player toward target when out of melee range
   * This allows combat to continue when the target moves instead of timing out
   *
   * NOTE: Actual movement is handled by ServerNetwork listening for COMBAT_FOLLOW_TARGET event.
   * This handler validates that combat is still active before the server initiates movement.
   */
  private handleCombatFollow(data: {
    playerId: string;
    targetId: string;
    targetPosition: { x: number; y: number; z: number };
  }): void {
    // Verify player is still in combat with this target
    const combatState = this.stateService
      .getCombatStatesMap()
      .get(data.playerId as EntityID);
    if (!combatState || combatState.targetId !== data.targetId) {
      return; // Combat ended or target changed, don't follow
    }
    // Movement is handled by ServerNetwork's COMBAT_FOLLOW_TARGET listener
    // which calls TileMovementManager.movePlayerToward()
  }

  private calculateMeleeDamage(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
  ): number {
    // Extract required properties for damage calculation
    let attackerData: {
      stats?: CombatStats;
      config?: { attackPower?: number };
    } = {};
    let targetData: { stats?: CombatStats; config?: { defense?: number } } = {};

    // Use type guard to check if attacker is a MobEntity
    const attackerIsMob = isMobEntity(attacker);
    if (attackerIsMob) {
      const mobData = attacker.getMobData();
      attackerData = {
        stats: { attack: mobData.attack }, // Pass attack stat for accuracy calculation
        config: { attackPower: mobData.attackPower },
      };
    } else {
      // Handle player or other Entity - get stats from components
      const statsComponent = attacker.getComponent("stats");
      if (statsComponent?.data) {
        // Extract .level from SkillData objects for combat calculations
        const stats = statsComponent.data as {
          attack?: { level: number } | number;
          strength?: { level: number } | number;
          defense?: { level: number } | number;
          ranged?: { level: number } | number;
        };
        attackerData = {
          stats: {
            attack:
              typeof stats.attack === "object"
                ? stats.attack.level
                : (stats.attack ?? 1),
            strength:
              typeof stats.strength === "object"
                ? stats.strength.level
                : (stats.strength ?? 1),
            defense:
              typeof stats.defense === "object"
                ? stats.defense.level
                : (stats.defense ?? 1),
            ranged:
              typeof stats.ranged === "object"
                ? stats.ranged.level
                : (stats.ranged ?? 1),
          },
        };
      }
    }

    // Use type guard to check if target is a MobEntity
    if (isMobEntity(target)) {
      const mobData = target.getMobData();
      targetData = {
        stats: { defense: mobData.defense }, // Pass defense stat for accuracy calculation
        config: { defense: mobData.defense },
      };
    } else {
      // Handle player or other Entity
      const statsComponent = target.getComponent("stats");
      if (statsComponent?.data) {
        // Extract .level from SkillData objects for combat calculations
        const stats = statsComponent.data as {
          attack?: { level: number } | number;
          strength?: { level: number } | number;
          defense?: { level: number } | number;
          ranged?: { level: number } | number;
        };
        targetData = {
          stats: {
            attack:
              typeof stats.attack === "object"
                ? stats.attack.level
                : (stats.attack ?? 1),
            strength:
              typeof stats.strength === "object"
                ? stats.strength.level
                : (stats.strength ?? 1),
            defense:
              typeof stats.defense === "object"
                ? stats.defense.level
                : (stats.defense ?? 1),
            ranged:
              typeof stats.ranged === "object"
                ? stats.ranged.level
                : (stats.ranged ?? 1),
          },
        };
      }
    }

    // Get equipment stats for player attacker
    let equipmentStats:
      | { attack: number; strength: number; defense: number; ranged: number }
      | undefined = undefined;
    if (!attackerIsMob) {
      // Attacker is a player - get equipment stats
      equipmentStats = this.playerEquipmentStats.get(attacker.id);
    }

    const result = calculateDamage(
      attackerData,
      targetData,
      AttackType.MELEE,
      equipmentStats,
    );

    return result.damage;
  }

  // MVP: calculateRangedDamage removed - melee only

  private applyDamage(
    targetId: string,
    targetType: string,
    damage: number,
    attackerId: string,
  ): void {
    // Validate target type
    if (targetType !== "player" && targetType !== "mob") {
      return;
    }

    // Get the appropriate handler for the target type
    const handler = this.damageHandlers.get(targetType);
    if (!handler) {
      this.logger.error("No damage handler for target type", undefined, {
        targetType,
      });
      return;
    }

    // Create typed EntityID for handler
    const typedTargetId = createEntityID(targetId);
    const typedAttackerId = createEntityID(attackerId);

    // Determine attacker type for handler
    const attackerType = this.getEntityType(attackerId);

    // Apply damage through polymorphic handler
    const result = handler.applyDamage(
      typedTargetId,
      damage,
      typedAttackerId,
      attackerType,
    );

    // Handle failed damage application
    if (!result.success) {
      if (result.targetDied) {
        // Target was already dead - end ALL combat with this entity
        this.handleEntityDied(targetId, targetType);
      } else {
        this.logger.error("Failed to apply damage", undefined, {
          targetId,
          targetType,
        });
      }
      return;
    }

    // CRITICAL: Check if target died from THIS attack
    // This prevents additional auto-attacks from ANY entity in the same frame
    if (result.targetDied) {
      this.handleEntityDied(targetId, targetType);
      return;
    }

    // Emit UI message based on target type
    if (targetType === "player") {
      // Get attacker name for message
      const attackerHandler = this.damageHandlers.get(attackerType);
      const attackerName = attackerHandler
        ? attackerHandler.getDisplayName(typedAttackerId)
        : "enemy";

      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: targetId,
        message: `The ${attackerName} hits you for ${damage} damage!`,
        type: "damage",
      });
    }
    // Note: Mob death messages are emitted by MobEntity.die() to avoid duplication

    // Note: Damage splatter events are now emitted at the call sites
    // (handleMeleeAttack, processAutoAttack) to ensure they're emitted even for 0 damage hits
  }

  // Note: syncCombatStateToEntity, clearCombatStateFromEntity moved to CombatStateService
  // Note: setCombatEmote, resetEmote moved to CombatAnimationManager
  // Note: rotateTowardsTarget moved to CombatRotationManager

  private enterCombat(
    attackerId: EntityID,
    targetId: EntityID,
    attackerSpeedTicks?: number,
  ): void {
    const currentTick = this.world.currentTick;

    // Detect entity types (don't assume attacker is always player!)
    const attackerEntity = this.world.entities.get(String(attackerId));
    const targetEntity = this.world.entities.get(String(targetId));

    // Don't enter combat if target is dead (using type guard)
    if (isEntityDead(targetEntity)) {
      return;
    }

    // Also check if target is a player marked as dead
    const playerSystem = this.world.getSystem<PlayerSystem>("player");
    if (playerSystem?.getPlayer) {
      const targetPlayer = playerSystem.getPlayer(String(targetId));
      if (targetPlayer && !targetPlayer.alive) {
        return;
      }
    }

    const attackerType =
      attackerEntity?.type === "mob" ? ("mob" as const) : ("player" as const);
    const targetType =
      targetEntity?.type === "mob" ? ("mob" as const) : ("player" as const);

    // Get attack speeds in ticks (use provided or calculate)
    const attackerAttackSpeedTicks =
      attackerSpeedTicks ?? this.getAttackSpeedTicks(attackerId, attackerType);
    const targetAttackSpeedTicks = this.getAttackSpeedTicks(
      targetId,
      targetType,
    );

    // Set combat state for attacker (just attacked, so next attack is after cooldown)
    this.stateService.createAttackerState(
      attackerId,
      targetId,
      attackerType,
      targetType,
      currentTick,
      attackerAttackSpeedTicks,
    );

    // OSRS Retaliation: Target retaliates after ceil(speed/2) + 1 ticks
    // @see https://oldschool.runescape.wiki/w/Auto_Retaliate
    // Check if target can retaliate (mobs have retaliates flag, players check auto-retaliate setting)
    let canRetaliate = true;
    if (targetType === "mob" && targetEntity) {
      // Check mob's retaliates config using type guard - if false, mob won't fight back
      canRetaliate = getMobRetaliates(targetEntity);
    } else if (targetType === "player") {
      // Check player's auto-retaliate setting
      // Uses cached reference (no getSystem() call in hot path)
      // Defaults to true if PlayerSystem unavailable (fail-safe, OSRS default)
      if (this.playerSystem) {
        canRetaliate = this.playerSystem.getPlayerAutoRetaliate(
          String(targetId),
        );
      }
      // Note: If playerSystem is null, canRetaliate stays true (default OSRS behavior)

      // Phase 6.5.2: OSRS-accurate AFK auto-retaliate disable
      // After 20 minutes of no input, auto-retaliate is disabled
      if (canRetaliate && this.isAFKTooLong(String(targetId), currentTick)) {
        canRetaliate = false;
      }
    }

    // Attacker always faces target
    this.rotationManager.rotateTowardsTarget(
      String(attackerId),
      String(targetId),
      attackerType,
      targetType,
    );

    // OSRS-ACCURATE: Check if target already has a valid combat target BEFORE any state modifications
    // @see https://oldschool.runescape.wiki/w/Auto_Retaliate
    // @see AUTO_RETALIATE_FIX_PLAN.md - Private server pattern: if (playerIndex <= 0 && npcIndex <= 0)
    //
    // When player is attacking Goblin 1 and Goblin 2 attacks the player:
    // - INCORRECT: Player switches to Goblin 2 (old behavior)
    // - CORRECT: Player continues attacking Goblin 1 (OSRS behavior)
    //
    // Auto-retaliate only triggers when player has NO current target
    // We calculate this ONCE before any state modifications, then reuse for both decisions
    let targetHasValidTarget = false;
    if (canRetaliate) {
      const targetCombatState = this.stateService.getCombatData(targetId);
      targetHasValidTarget = !!(
        targetCombatState &&
        targetCombatState.inCombat &&
        this.isEntityAlive(
          this.getEntity(
            String(targetCombatState.targetId),
            targetCombatState.targetType,
          ),
          targetCombatState.targetType,
        )
      );

      if (!targetHasValidTarget) {
        // Target has no valid target - schedule retaliation (normal OSRS auto-retaliate)
        const retaliationDelay = calculateRetaliationDelay(
          targetAttackSpeedTicks,
        );

        this.stateService.createRetaliatorState(
          targetId,
          attackerId,
          targetType,
          attackerType,
          currentTick,
          retaliationDelay,
          targetAttackSpeedTicks,
        );

        // OSRS-ACCURATE: Auto-retaliate ALWAYS redirects player toward attacker
        // When hit with auto-retaliate ON, player stops any current movement and turns to fight
        // The COMBAT_FOLLOW_TARGET event replaces any existing movement destination
        // Wiki: "the player's character walks/runs towards the monster attacking and fights back"

        // NOTE: We do NOT call rotateTowardsTarget() here because:
        // 1. COMBAT_FOLLOW_TARGET triggers movePlayerToward() which handles rotation
        // 2. Having two rotation updates causes visual jank (quick turn-around-then-back)
        // 3. Client's TileInterpolator will slerp smoothly to the new path direction

        // Always emit follow event - this REPLACES any existing movement
        // Player was walking to tile A, now walks to attacker instead
        if (targetType === "player" && attackerEntity) {
          const attackerPos = getEntityPosition(attackerEntity);
          if (attackerPos) {
            this.emitTypedEvent(EventType.COMBAT_FOLLOW_TARGET, {
              playerId: String(targetId),
              targetId: String(attackerId),
              targetPosition: {
                x: attackerPos.x,
                y: attackerPos.y,
                z: attackerPos.z,
              },
            });
          }
        }
      } else {
        // Target already has valid target - just extend their combat timer
        // They stay locked on their current target (OSRS-accurate)
        this.stateService.extendCombatTimer(targetId, currentTick);
      }
    }

    // Sync combat state to player entities for client-side combat awareness
    // Attacker always gets combat state with target
    this.stateService.syncCombatStateToEntity(
      String(attackerId),
      String(targetId),
      attackerType,
    );

    // Target only gets NEW combat target if:
    // 1. They will retaliate (auto-retaliate ON), AND
    // 2. They don't already have a valid target (OSRS-accurate)
    //
    // If target already has a valid target, we don't overwrite their target state.
    // They stay locked on their current enemy.
    // NOTE: We use the same targetHasValidTarget value calculated BEFORE state modifications
    if (canRetaliate && !targetHasValidTarget) {
      // Target has no valid target - sync them to attack this attacker
      this.stateService.syncCombatStateToEntity(
        String(targetId),
        String(attackerId),
        targetType,
      );
    } else if (!canRetaliate && targetType === "player") {
      // Mark player as in combat (for logout timer) but without a target
      // Store attackerId so combat can start if auto-retaliate is toggled ON
      this.stateService.markInCombatWithoutTarget(
        String(targetId),
        String(attackerId),
      );

      // Phase 5: Server-controlled face target (client is display-only)
      // Even with auto-retaliate OFF, player should visually face the attacker
      // Client no longer searches for attackers - server tells them who to face
      this.emitTypedEvent(EventType.COMBAT_FACE_TARGET, {
        playerId: String(targetId),
        targetId: String(attackerId),
      });
    }

    // DON'T set combat emotes here - we set them when attacks happen instead
    // This prevents the animation from looping continuously

    // Emit combat started event
    this.emitTypedEvent(EventType.COMBAT_STARTED, {
      attackerId: String(attackerId),
      targetId: String(targetId),
    });

    // Record combat start event for replay/debugging (Phase 7)
    this.recordCombatEvent(GameEventType.COMBAT_START, String(attackerId), {
      targetId: String(targetId),
      attackerType,
      targetType,
      attackerAttackSpeedTicks,
      targetAttackSpeedTicks,
    });

    // Show combat UI indicator for the local player (whoever that is)
    const localPlayer = this.world.getPlayer();
    if (
      localPlayer &&
      (String(attackerId) === localPlayer.id ||
        String(targetId) === localPlayer.id)
    ) {
      const opponent =
        String(attackerId) === localPlayer.id ? targetEntity : attackerEntity;
      const opponentName = opponent!.name;

      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: localPlayer.id,
        message: `⚔️ Combat started with ${opponentName}!`,
        type: "combat",
        duration: 3000,
      });
    }
  }

  private endCombat(data: {
    entityId: string;
    skipAttackerEmoteReset?: boolean;
    skipTargetEmoteReset?: boolean;
  }): void {
    // Validate entity ID before processing
    if (!data.entityId) {
      return;
    }

    const typedEntityId = createEntityID(data.entityId);
    const combatState = this.stateService.getCombatData(data.entityId);
    if (!combatState) return;

    // Reset emotes for both entities via AnimationManager
    // Skip attacker emote reset if requested (e.g., when target died during attack animation)
    if (!data.skipAttackerEmoteReset) {
      this.animationManager.resetEmote(data.entityId, combatState.attackerType);
    }
    // Skip target emote reset if requested (e.g., when dead entity ends combat, don't reset their attacker)
    if (!data.skipTargetEmoteReset) {
      this.animationManager.resetEmote(
        String(combatState.targetId),
        combatState.targetType,
      );
    }

    // Clear combat state from player entities via StateService
    this.stateService.clearCombatStateFromEntity(
      data.entityId,
      combatState.attackerType,
    );
    this.stateService.clearCombatStateFromEntity(
      String(combatState.targetId),
      combatState.targetType,
    );

    // Remove combat states via StateService
    this.stateService.removeCombatState(typedEntityId);
    this.stateService.removeCombatState(combatState.targetId);

    // Emit combat ended event
    this.emitTypedEvent(EventType.COMBAT_ENDED, {
      attackerId: data.entityId,
      targetId: String(combatState.targetId),
    });

    // Record combat end event for replay/debugging (Phase 7)
    this.recordCombatEvent(GameEventType.COMBAT_END, data.entityId, {
      targetId: String(combatState.targetId),
      attackerType: combatState.attackerType,
      targetType: combatState.targetType,
      reason: "timeout_or_manual",
    });

    // Phase 5: Clear face target for players when combat ends (client is display-only)
    // This tells client to stop facing the target since combat is over
    if (combatState.attackerType === "player") {
      this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
        playerId: data.entityId,
      });
    }
    if (combatState.targetType === "player") {
      this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
        playerId: String(combatState.targetId),
      });
    }

    // Show combat end message for player
    if (combatState.attackerType === "player") {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.entityId,
        message: `Combat ended.`,
        type: "info",
      });
    }
  }

  /**
   * Handle entity death - mark dead entity as non-targetable, let combat timeout naturally
   * CRITICAL FIX FOR ISSUE #269: RuneScape-style combat timer
   * In OSRS, combat lasts for 8 ticks (4.8 seconds) after the LAST hit
   * Don't end combat immediately - let the timer expire naturally so health bars stay visible
   */
  private handleEntityDied(entityId: string, entityType: string): void {
    const typedEntityId = createEntityID(entityId);

    // Record death event for replay/debugging (Phase 7)
    const deathEventType =
      entityType === "player"
        ? GameEventType.DEATH_PLAYER
        : GameEventType.DEATH_MOB;
    const combatState = this.stateService.getCombatData(entityId);
    this.recordCombatEvent(deathEventType, entityId, {
      entityType,
      killedBy: combatState ? String(combatState.targetId) : "unknown",
    });

    // Simply remove the dead entity's combat state - they're no longer in combat
    // But DON'T call endCombat() for attackers - let their combat timer expire naturally
    this.stateService.removeCombatState(typedEntityId);

    // Also clear the dead entity's attack cooldown so they can attack immediately after respawn
    this.nextAttackTicks.delete(typedEntityId);

    // Clear any scheduled emote resets for the dead entity
    this.animationManager.cancelEmoteReset(entityId);

    // Find all attackers targeting this dead entity
    // Their combat will naturally timeout after 4.8 seconds (8 ticks) since they got the last hit
    // This matches RuneScape behavior where health bars stay visible briefly after combat ends
    const combatStatesMap = this.stateService.getCombatStatesMap();
    for (const [attackerId, state] of combatStatesMap) {
      if (String(state.targetId) === entityId) {
        // CRITICAL: Clear the attacker's attack cooldown so they can attack new targets immediately
        // Without this, mobs would be stuck waiting for cooldown after their target dies and respawns
        this.nextAttackTicks.delete(attackerId);

        // CRITICAL: If the attacker is a mob, reset its internal CombatStateManager
        // This clears the mob's own nextAttackTick so it can attack immediately when target respawns
        if (state.attackerType === "mob") {
          const mobEntity = this.world.entities.get(
            String(attackerId),
          ) as MobEntity;
          if (mobEntity && typeof mobEntity.onTargetDied === "function") {
            mobEntity.onTargetDied(entityId);
          }
        }
      }
    }

    // Phase 5: Clear face target for any players who had this entity as their pending attacker
    // When an attacker dies, players with auto-retaliate OFF should stop facing them
    if (entityType === "mob") {
      // Check all players to see if they had this mob as their pending attacker
      for (const player of this.world.entities.players.values()) {
        // Use type guards for safe property access
        const pendingAttacker = getPendingAttacker(player);
        if (pendingAttacker === entityId) {
          // Clear the pending attacker state using type guard helper
          clearPendingAttacker(player);
          // Tell client to stop facing this entity
          this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
            playerId: player.id,
          });
        }
      }
    }

    // Reset dead entity's emote if they were mid-animation
    this.animationManager.resetEmote(entityId, entityType as "player" | "mob");
  }

  // Public API methods
  public startCombat(
    attackerId: string,
    targetId: string,
    options?: {
      attackerType?: "player" | "mob";
      targetType?: "player" | "mob";
      weaponType?: AttackType;
    },
  ): boolean {
    const opts = {
      attackerType: "player",
      targetType: "mob",
      weaponType: AttackType.MELEE,
      ...options,
    };

    // Check if entities exist
    const attacker = this.getEntity(attackerId, opts.attackerType);
    const target = this.getEntity(targetId, opts.targetType);

    if (!attacker || !target) {
      return false;
    }

    // CRITICAL: Cannot start combat with dead entities (RuneScape-style validation)
    // This prevents mobs from starting combat with dead players (Issue #265)
    const attackerAlive = this.isEntityAlive(attacker, opts.attackerType);
    const targetAlive = this.isEntityAlive(target, opts.targetType);

    if (!attackerAlive) {
      return false;
    }
    if (!targetAlive) {
      return false;
    }

    // MVP: Melee-only range check (tile-based)
    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return false; // Missing position

    // Use pre-allocated pooled tiles (zero GC)
    tilePool.setFromPosition(this._attackerTile, attackerPos);
    tilePool.setFromPosition(this._targetTile, targetPos);
    const combatRangeTiles = this.getEntityCombatRange(
      attacker,
      opts.attackerType,
    );
    // OSRS-accurate melee range check (cardinal-only for range 1)
    if (
      !tilesWithinMeleeRange(
        this._attackerTile,
        this._targetTile,
        combatRangeTiles,
      )
    ) {
      return false;
    }

    // Start combat
    this.enterCombat(createEntityID(attackerId), createEntityID(targetId));
    return true;
  }

  public isInCombat(entityId: string): boolean {
    return this.stateService.isInCombat(entityId);
  }

  public getCombatData(entityId: string): CombatData | null {
    return this.stateService.getCombatData(entityId);
  }

  public forceEndCombat(
    entityId: string,
    options?: {
      skipAttackerEmoteReset?: boolean;
      skipTargetEmoteReset?: boolean;
    },
  ): void {
    this.endCombat({
      entityId,
      skipAttackerEmoteReset: options?.skipAttackerEmoteReset,
      skipTargetEmoteReset: options?.skipTargetEmoteReset,
    });
  }

  /**
   * Check if a player can logout based on combat state
   * OSRS-accurate: Cannot logout while actively in combat
   * Uses the combat timeout window to determine if player is in active combat
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   * @returns Object with allowed boolean and optional reason string
   */
  public canLogout(
    playerId: string,
    currentTick: number,
  ): { allowed: boolean; reason?: string } {
    const combatData = this.stateService.getCombatData(playerId);

    // Player is in active combat if:
    // 1. They have combat data with inCombat flag
    // 2. Current tick is before their combat end tick
    if (combatData?.inCombat && currentTick < combatData.combatEndTick) {
      return {
        allowed: false,
        reason: "Cannot logout during combat",
      };
    }

    return { allowed: true };
  }

  /**
   * Update the last input tick for a player
   * Called by PlayerSystem when player performs any action
   * OSRS: Auto-retaliate disabled after 20 minutes of no input
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   */
  public updatePlayerInput(playerId: string, currentTick: number): void {
    this.lastInputTick.set(playerId, currentTick);
  }

  /**
   * Check if a player has been AFK too long (20 minutes)
   * OSRS-accurate: Auto-retaliate disabled after 2000 ticks of no input
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   * @returns true if player has been AFK too long
   */
  public isAFKTooLong(playerId: string, currentTick: number): boolean {
    const lastInput = this.lastInputTick.get(playerId) ?? currentTick;
    return (
      currentTick - lastInput >= COMBAT_CONSTANTS.AFK_DISABLE_RETALIATE_TICKS
    );
  }

  /**
   * Clean up all combat state for a disconnecting player
   * Called when a player disconnects to prevent orphaned combat states
   * and allow mobs to immediately retarget other players
   */
  public cleanupPlayerDisconnect(playerId: string): void {
    const typedPlayerId = createEntityID(playerId);

    // Remove player's own combat state
    this.stateService.removeCombatState(typedPlayerId);

    // Clear player's attack cooldowns
    this.nextAttackTicks.delete(typedPlayerId);

    // Clear any scheduled emote resets
    this.animationManager.cancelEmoteReset(playerId);

    // Clear player's equipment stats cache
    this.playerEquipmentStats.delete(playerId);

    // Clean up anti-cheat tracking for disconnected player (Phase 6)
    this.antiCheat.cleanup(playerId);

    // Clean up rate limiter state (Phase 6.5)
    this.rateLimiter.cleanup(playerId);

    // Clean up AFK tracking (Phase 6.5.2)
    this.lastInputTick.delete(playerId);

    // Find all entities that were targeting this disconnected player
    const combatStatesMap = this.stateService.getCombatStatesMap();
    for (const [attackerId, state] of combatStatesMap) {
      if (String(state.targetId) === playerId) {
        // Clear the attacker's cooldown so they can immediately retarget
        this.nextAttackTicks.delete(attackerId);

        // If attacker is a mob, reset its internal combat state
        if (state.attackerType === "mob") {
          const mobEntity = this.world.entities.get(
            String(attackerId),
          ) as MobEntity;
          if (mobEntity && typeof mobEntity.onTargetDied === "function") {
            // Reuse the same method - disconnect is similar to death
            mobEntity.onTargetDied(playerId);
          }
        }

        // Remove the attacker's combat state (don't let them keep attacking empty air)
        this.stateService.removeCombatState(attackerId);

        // Clear combat state from entity if it's a player
        if (state.attackerType === "player") {
          this.stateService.clearCombatStateFromEntity(
            String(attackerId),
            "player",
          );
        }
      }
    }
  }

  private getEntity(
    entityId: string,
    entityType: string,
  ): Entity | MobEntity | null {
    if (entityType === "mob") {
      const entity = this.world.entities.get(entityId);
      if (!entity) {
        // Don't spam logs for entities that are being destroyed
        // Only log if this is a new entity that should exist
        return null;
      }
      return entity as MobEntity;
    }

    if (entityType === "player") {
      // Look up players from world.entities.players (includes fake test players)
      const player = this.world.entities.players.get(entityId);
      if (!player) {
        // Debug level - player disconnects are common and expected
        this.logger.debug("Player entity not found (probably disconnected)", {
          entityId,
        });
        return null;
      }
      return player;
    }

    if (!this.entityManager) {
      this.logger.warn("Entity manager not available");
      return null;
    }
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      this.logger.debug("Entity not found", { entityId });
      return null;
    }
    return entity;
  }

  /**
   * Determine entity type from entity ID
   * Returns "player" or "mob" based on entity lookup
   */
  private getEntityType(entityId: string): "player" | "mob" {
    // Check if it's a player first (more common case)
    if (this.world.entities.players.has(entityId)) {
      return "player";
    }

    // Check if it's a mob in the entities map
    const entity = this.world.entities.get(entityId);
    if (entity instanceof MobEntity) {
      return "mob";
    }

    // Default to mob for unknown entities (could be a mob that was just destroyed)
    return "mob";
  }

  // Combat update loop - DEPRECATED: Combat logic now handled by processCombatTick() via TickSystem
  // This method is kept for compatibility but does nothing - all combat runs through tick system
  update(_dt: number): void {
    // Combat logic moved to processCombatTick() for OSRS-accurate tick-based timing
    // This is called by TickSystem at TickPriority.COMBAT
  }

  /**
   * Process combat on each server tick (OSRS-accurate)
   * Called by TickSystem at COMBAT priority (after movement, before AI)
   */
  public processCombatTick(tickNumber: number): void {
    // Update PID manager - handles periodic shuffles for PvP fairness (Phase 9)
    // OSRS shuffles every 60-150 seconds to prevent permanent priority advantage
    this.pidManager.update(tickNumber);

    // Process scheduled emote resets (tick-aligned animation timing)
    // Delegated to AnimationManager for better separation of concerns
    this.animationManager.processEmoteResets(tickNumber);

    // Get all combat states via StateService (returns reusable buffer to avoid allocations)
    const combatStates = this.stateService.getAllCombatStates();
    const combatStatesMap = this.stateService.getCombatStatesMap();

    // Sort by PID for fair combat priority (Phase 9 - PvP Fairness)
    // Lower PID = higher priority = attacks first when multiple entities attack on same tick
    // OSRS-ACCURATE: This determines who wins when both players would kill each other
    // @see https://oldschool.runescape.wiki/w/PID
    combatStates.sort((a, b) => this.pidManager.comparePriority(a[0], b[0]));

    // Process all active combat sessions in PID order
    for (const [entityId, combatState] of combatStates) {
      // CRITICAL: Re-check if this combat state still exists
      if (!combatStatesMap.has(entityId)) {
        continue;
      }

      // Check for combat timeout (8 ticks after last hit)
      if (combatState.inCombat && tickNumber >= combatState.combatEndTick) {
        const entityIdStr = String(entityId);
        this.endCombat({ entityId: entityIdStr });
        continue;
      }

      // Skip if not in combat or doesn't have valid target
      if (!combatState.inCombat || !combatState.targetId) continue;

      // OSRS-style: Check range EVERY tick and follow if needed (not just on attack ticks)
      // In OSRS, you continuously pursue your target while in combat
      if (combatState.attackerType === "player") {
        this.checkRangeAndFollow(combatState, tickNumber);
      }

      // Check if this entity can attack on this tick
      if (tickNumber >= combatState.nextAttackTick) {
        this.processAutoAttackOnTick(combatState, tickNumber);
      }
    }
  }

  /**
   * Process combat for a specific NPC on this tick
   *
   * OSRS-ACCURATE: Called by GameTickProcessor during NPC phase
   * NPCs process BEFORE players, creating the damage asymmetry:
   * - NPC → Player damage: Applied same tick
   * - Player → NPC damage: Applied next tick
   *
   * @param mobId - The NPC entity ID to process
   * @param tickNumber - Current tick number
   */
  public processNPCCombatTick(mobId: string, tickNumber: number): void {
    const combatState = this.stateService.getCombatData(mobId);

    if (!combatState) return;

    // Check for combat timeout (8 ticks after last hit)
    if (combatState.inCombat && tickNumber >= combatState.combatEndTick) {
      this.endCombat({ entityId: mobId });
      return;
    }

    // Skip if not in combat or doesn't have valid target
    if (!combatState.inCombat || !combatState.targetId) return;

    // Only process mob attackers (not mobs being attacked)
    if (combatState.attackerType !== "mob") return;

    // Process emote resets for this mob
    this.animationManager.processEntityEmoteReset(mobId, tickNumber);

    // Check if this mob can attack on this tick
    if (tickNumber >= combatState.nextAttackTick) {
      this.processAutoAttackOnTick(combatState, tickNumber);
    }
  }

  /**
   * Process combat for a specific player on this tick
   *
   * OSRS-ACCURATE: Called by GameTickProcessor during Player phase
   * Players process AFTER NPCs, creating the damage asymmetry:
   * - Player → NPC damage: Applied next tick (queued by GameTickProcessor)
   * - NPC → Player damage: Applied same tick
   *
   * @param playerId - The player entity ID to process
   * @param tickNumber - Current tick number
   */
  public processPlayerCombatTick(playerId: string, tickNumber: number): void {
    const combatState = this.stateService.getCombatData(playerId);

    if (!combatState) return;

    // Check for combat timeout (8 ticks after last hit)
    if (combatState.inCombat && tickNumber >= combatState.combatEndTick) {
      this.endCombat({ entityId: playerId });
      return;
    }

    // Skip if not in combat or doesn't have valid target
    if (!combatState.inCombat || !combatState.targetId) return;

    // Only process player attackers (not players being attacked)
    if (combatState.attackerType !== "player") return;

    // OSRS-ACCURATE: No movement suppression needed
    // If player has combat state, they're either:
    // 1. Standing still fighting
    // 2. Combat following (chasing their target)
    // In both cases, attacks should happen when in range and cooldown ready
    // Wiki: "follow and attack while chasing it"
    // The disengage event handles the "escape" case by clearing combat state

    // Process emote resets for this player
    this.animationManager.processEntityEmoteReset(playerId, tickNumber);

    // OSRS-style: Check range EVERY tick and follow if needed
    this.checkRangeAndFollow(combatState, tickNumber);

    // Check if this player can attack on this tick
    if (tickNumber >= combatState.nextAttackTick) {
      this.processAutoAttackOnTick(combatState, tickNumber);
    }
  }

  /**
   * OSRS-style: Check if player is in range of target, emit follow event if not
   * Called EVERY tick to ensure continuous pursuit of moving targets
   */
  private checkRangeAndFollow(
    combatState: CombatData,
    tickNumber: number,
  ): void {
    const attackerId = String(combatState.attackerId);
    const targetId = String(combatState.targetId);

    // OSRS-ACCURATE: No movement suppression for following
    // If player has combat state, they should continuously pursue their target
    // Wiki: "follow and attack while chasing it"
    // Movement during combat follow is normal - player is chasing their target

    const attacker = this.getEntity(attackerId, combatState.attackerType);
    const target = this.getEntity(targetId, combatState.targetType);

    if (!attacker || !target) return;

    // Don't follow dead targets - let combat timeout naturally
    // This prevents player getting stuck after killing a mob
    if (!this.isEntityAlive(target, combatState.targetType)) {
      return;
    }

    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return;

    // Use pre-allocated pooled tiles (zero GC)
    tilePool.setFromPosition(this._attackerTile, attackerPos);
    tilePool.setFromPosition(this._targetTile, targetPos);
    const combatRangeTiles = this.getEntityCombatRange(
      attacker,
      combatState.attackerType,
    );

    // OSRS-accurate melee range check (cardinal-only for range 1)
    if (
      !tilesWithinMeleeRange(
        this._attackerTile,
        this._targetTile,
        combatRangeTiles,
      )
    ) {
      // Out of range - follow the target
      // Note: If player clicked away, their combat would already be ended by
      // COMBAT_PLAYER_DISENGAGE event (OSRS-accurate: clicking cancels action)
      // So if we reach here, combat is still active and player should follow
      // Extend combat timeout while pursuing
      combatState.combatEndTick =
        tickNumber + COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS;

      this.emitTypedEvent(EventType.COMBAT_FOLLOW_TARGET, {
        playerId: attackerId,
        targetId: targetId,
        targetPosition: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
        meleeRange: combatRangeTiles, // Pass range for OSRS-accurate pathfinding
      });
    }
  }

  // =========================================================================
  // AUTO-ATTACK HELPER METHODS (Phase 6.1 - Decomposition)
  // =========================================================================

  /**
   * Validate combat actors exist and are alive
   * @returns Validated entities or null if validation fails
   */
  private validateCombatActors(
    combatState: CombatData,
  ): { attacker: Entity | MobEntity; target: Entity | MobEntity } | null {
    const attackerId = String(combatState.attackerId);
    const targetId = String(combatState.targetId);

    const attacker = this.getEntity(attackerId, combatState.attackerType);
    const target = this.getEntity(targetId, combatState.targetType);

    // CRITICAL FIX FOR ISSUE #269: RuneScape-style combat timer
    // If entity not found (dead mob, disconnected player, etc.), DON'T end combat immediately
    // Let the 8-tick timeout expire naturally to keep health bars visible
    if (!attacker || !target) {
      return null;
    }

    // Check if attacker is still alive (prevent dead attackers from auto-attacking)
    if (!this.isEntityAlive(attacker, combatState.attackerType)) {
      return null;
    }

    // Check if target is still alive
    if (!this.isEntityAlive(target, combatState.targetType)) {
      return null;
    }

    return { attacker, target };
  }

  /**
   * Validate attacker is within melee range of target
   * Uses pooled tiles for zero GC overhead
   * @returns true if within range, false otherwise
   */
  private validateAttackRange(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    attackerType: "player" | "mob",
  ): boolean {
    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return false;

    // MELEE: Must be within attacker's combat range (configurable per mob, minimum 1 tile)
    // OSRS-style: range 1 = cardinal only (N/S/E/W), range 2+ = diagonal allowed
    // Use pre-allocated pooled tiles (zero GC)
    tilePool.setFromPosition(this._attackerTile, attackerPos);
    tilePool.setFromPosition(this._targetTile, targetPos);
    const combatRangeTiles = this.getEntityCombatRange(attacker, attackerType);

    // OSRS-accurate melee range check (cardinal-only for range 1)
    return tilesWithinMeleeRange(
      this._attackerTile,
      this._targetTile,
      combatRangeTiles,
    );
  }

  /**
   * Execute the attack: rotation, animation, damage calculation, and application
   * @returns The damage dealt (capped at target's current health)
   */
  private executeAttackDamage(
    attackerId: string,
    targetId: string,
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    combatState: CombatData,
    tickNumber: number,
  ): number {
    // OSRS-STYLE: Update entity facing to face target
    this.rotationManager.rotateTowardsTarget(
      attackerId,
      targetId,
      combatState.attackerType,
      combatState.targetType,
    );

    // Play attack animation (Issue #340: pass attack speed for proper animation duration)
    this.animationManager.setCombatEmote(
      attackerId,
      combatState.attackerType,
      tickNumber,
      combatState.attackSpeedTicks,
    );

    // MVP: Melee-only damage calculation
    const rawDamage = this.calculateMeleeDamage(attacker, target);

    // OSRS-STYLE: Cap damage at target's current health (no overkill)
    const currentHealth = this.getEntityHealth(target);
    const damage = Math.min(rawDamage, currentHealth);

    // Apply capped damage
    this.applyDamage(targetId, combatState.targetType, damage, attackerId);

    // Emit damage splatter event
    const targetPosition = getEntityPosition(target);
    this.emitTypedEvent(EventType.COMBAT_DAMAGE_DEALT, {
      attackerId,
      targetId,
      damage,
      targetType: combatState.targetType,
      position: targetPosition,
    });

    // Record attack and damage events for replay/debugging (Phase 7)
    this.recordCombatEvent(GameEventType.COMBAT_ATTACK, attackerId, {
      targetId,
      attackerType: combatState.attackerType,
      targetType: combatState.targetType,
      attackSpeedTicks: combatState.attackSpeedTicks,
    });

    if (damage > 0) {
      this.recordCombatEvent(GameEventType.COMBAT_DAMAGE, attackerId, {
        targetId,
        damage,
        rawDamage,
        targetHealth: currentHealth,
        targetPosition: targetPosition
          ? { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z }
          : undefined,
      });
    } else {
      this.recordCombatEvent(GameEventType.COMBAT_MISS, attackerId, {
        targetId,
        rawDamage,
      });
    }

    return damage;
  }

  /**
   * Update combat state tick tracking after a successful attack
   */
  private updateCombatTickState(
    combatState: CombatData,
    typedAttackerId: EntityID,
    tickNumber: number,
  ): void {
    combatState.lastAttackTick = tickNumber;
    combatState.nextAttackTick = tickNumber + combatState.attackSpeedTicks;
    combatState.combatEndTick =
      tickNumber + COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS;
    this.nextAttackTicks.set(typedAttackerId, combatState.nextAttackTick);
  }

  /**
   * Handle player auto-retaliation when attacked
   * Creates retaliation state if player needs to fight back
   */
  private handlePlayerRetaliation(
    targetId: string,
    attackerId: string,
    typedAttackerId: EntityID,
    attackerType: "player" | "mob",
    tickNumber: number,
  ): void {
    const targetPlayerState = this.stateService.getCombatData(targetId);
    let shouldRetaliate =
      this.playerSystem?.getPlayerAutoRetaliate(targetId) ?? true;

    // Phase 6.5.2: OSRS-accurate AFK auto-retaliate disable
    // After 20 minutes of no input, auto-retaliate is disabled
    if (shouldRetaliate && this.isAFKTooLong(targetId, tickNumber)) {
      shouldRetaliate = false;
    }

    // Player needs a new retaliation state if:
    // 1. They have auto-retaliate ON, AND
    // 2. They have no combat state, OR their current target is dead/invalid
    if (!shouldRetaliate) return;

    const needsNewTarget =
      !targetPlayerState ||
      !targetPlayerState.inCombat ||
      !this.isEntityAlive(
        this.getEntity(
          String(targetPlayerState.targetId),
          targetPlayerState.targetType,
        ),
        targetPlayerState.targetType,
      );

    if (!needsNewTarget) return;

    // Create retaliation state for player targeting this attacker
    const playerAttackSpeed = this.getAttackSpeedTicks(
      createEntityID(targetId),
      "player",
    );
    const retaliationDelay = calculateRetaliationDelay(playerAttackSpeed);

    this.stateService.createRetaliatorState(
      createEntityID(targetId),
      typedAttackerId,
      "player",
      attackerType,
      tickNumber,
      retaliationDelay,
      playerAttackSpeed,
    );

    // Sync combat state to player entity
    this.stateService.syncCombatStateToEntity(targetId, attackerId, "player");

    // Face the attacker
    this.rotationManager.rotateTowardsTarget(
      targetId,
      attackerId,
      "player",
      attackerType,
    );

    // Clear any server face target since player now has combat target
    this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
      playerId: targetId,
    });
  }

  /**
   * Emit combat events for visual feedback and UI
   */
  private emitCombatEvents(
    attackerId: string,
    targetId: string,
    target: Entity | MobEntity,
    damage: number,
    combatState: CombatData,
  ): void {
    // MVP: Emit melee attack event for visual feedback
    this.emitTypedEvent(EventType.COMBAT_MELEE_ATTACK, {
      attackerId,
      targetId,
      attackerType: combatState.attackerType,
      targetType: combatState.targetType,
    });

    // Emit UI message for player attacks
    if (combatState.attackerType === "player") {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: attackerId,
        message: `You hit the ${this.getTargetName(target)} for ${damage} damage!`,
        type: "combat",
      });
    }
  }

  // =========================================================================
  // MAIN AUTO-ATTACK METHOD (Refactored - Phase 6.1)
  // =========================================================================

  /**
   * Process auto-attack for a combatant on a specific tick (OSRS-accurate)
   * This creates the continuous attack loop that makes combat feel like RuneScape
   *
   * Decomposed into focused helper methods for maintainability:
   * - validateCombatActors: Entity resolution and alive checks
   * - validateAttackRange: Melee range validation
   * - executeAttackDamage: Damage calculation and application
   * - updateCombatTickState: Tick tracking updates
   * - handlePlayerRetaliation: Auto-retaliate handling
   * - emitCombatEvents: Event emission
   */
  private processAutoAttackOnTick(
    combatState: CombatData,
    tickNumber: number,
  ): void {
    const attackerId = String(combatState.attackerId);
    const targetId = String(combatState.targetId);
    const typedAttackerId = combatState.attackerId;

    // Step 1: Validate combat actors exist and are alive
    const actors = this.validateCombatActors(combatState);
    if (!actors) return;
    const { attacker, target } = actors;

    // Step 2: Validate attack range
    if (!this.validateAttackRange(attacker, target, combatState.attackerType)) {
      return;
    }

    // Step 3: Execute attack (rotation, animation, damage)
    const damage = this.executeAttackDamage(
      attackerId,
      targetId,
      attacker,
      target,
      combatState,
      tickNumber,
    );

    // Step 4: Check if combat state still exists (target may have died)
    if (!this.stateService.getCombatStatesMap().has(typedAttackerId)) {
      return;
    }

    // Step 5: Update combat tick state
    this.updateCombatTickState(combatState, typedAttackerId, tickNumber);

    // Step 6: Handle player retaliation if target is a player
    if (combatState.targetType === "player") {
      this.handlePlayerRetaliation(
        targetId,
        attackerId,
        typedAttackerId,
        combatState.attackerType,
        tickNumber,
      );
    }

    // Step 7: Emit combat events
    this.emitCombatEvents(attackerId, targetId, target, damage, combatState);
  }

  /**
   * Get display name for a target entity
   */
  private getTargetName(entity: Entity | MobEntity | null): string {
    if (!entity) return "Unknown";
    const mobEntity = entity as MobEntity;
    if (mobEntity.getMobData) {
      return mobEntity.getMobData().name;
    }
    return entity.name || "Enemy";
  }

  /**
   * Get current health of an entity
   * Returns the current HP value to prevent damage overkill display
   */
  private getEntityHealth(entity: Entity | MobEntity | null): number {
    if (!entity) {
      return 0;
    }

    // All entities inherit getHealth() from Entity base class
    try {
      const health = entity.getHealth();
      return Math.max(0, health);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Get attack speed in TICKS for an entity (OSRS-accurate)
   * @returns Attack speed in game ticks (default: 4 ticks = 2.4 seconds)
   */
  private getAttackSpeedTicks(entityId: EntityID, entityType: string): number {
    // For players, get equipment via EquipmentSystem
    if (entityType === "player") {
      const equipmentSystem = this.world.getSystem?.("equipment") as
        | {
            getPlayerEquipment?: (id: string) => {
              weapon?: { item?: { attackSpeed?: number; id?: string } };
            } | null;
          }
        | undefined;

      if (equipmentSystem?.getPlayerEquipment) {
        const equipment = equipmentSystem.getPlayerEquipment(String(entityId));

        if (equipment?.weapon?.item) {
          const weaponItem = equipment.weapon.item;

          // First check if Item has attackSpeed directly
          if (weaponItem.attackSpeed) {
            return weaponItem.attackSpeed;
          }

          // Fallback: look up from ITEMS map
          if (weaponItem.id) {
            const itemData = getItem(weaponItem.id);
            if (itemData?.attackSpeed) {
              return itemData.attackSpeed;
            }
          }
        }
      }

      // Player with no weapon - use default
      return COMBAT_CONSTANTS.DEFAULT_ATTACK_SPEED_TICKS;
    }

    // For mobs, check mob attack speed (stored in ticks in npcs.json)
    const entity = this.getEntity(String(entityId), entityType);
    if (entity) {
      const mobEntity = entity as MobEntity;
      if (mobEntity.getMobData) {
        const mobData = mobEntity.getMobData();
        const mobAttackSpeedTicks = (mobData as { attackSpeedTicks?: number })
          .attackSpeedTicks;
        if (mobAttackSpeedTicks) {
          return mobAttackSpeedTicks;
        }
      }
    }

    // Default attack speed (4 ticks = 2.4 seconds)
    return COMBAT_CONSTANTS.DEFAULT_ATTACK_SPEED_TICKS;
  }

  /**
   * Get combat range for an entity in tiles
   * Mobs use combatRange from manifest, players use equipped weapon's attackRange
   */
  private getEntityCombatRange(
    entity: Entity | MobEntity,
    entityType: string,
  ): number {
    if (entityType === "mob") {
      const mobEntity = entity as MobEntity;
      if (typeof mobEntity.getCombatRange === "function") {
        return mobEntity.getCombatRange();
      }
    }

    // Players: get weapon attackRange from equipped weapon via EquipmentSystem
    if (entityType === "player") {
      const equipmentSystem = this.world.getSystem?.("equipment") as
        | {
            getPlayerEquipment?: (id: string) => {
              weapon?: { item?: { attackRange?: number; id?: string } };
            } | null;
          }
        | undefined;

      if (equipmentSystem?.getPlayerEquipment) {
        const equipment = equipmentSystem.getPlayerEquipment(entity.id);

        if (equipment?.weapon?.item) {
          const weaponItem = equipment.weapon.item;

          // First check if Item has attackRange directly
          if (weaponItem.attackRange) {
            return weaponItem.attackRange;
          }

          // Fallback: look up from ITEMS map
          if (weaponItem.id) {
            const itemData = getItem(weaponItem.id);
            if (itemData?.attackRange) {
              return itemData.attackRange;
            }
          }
        }
      }
    }

    // Default to 1 tile (punching/unarmed)
    return 1;
  }

  /**
   * Check if entity is alive
   */
  private isEntityAlive(
    entity: Entity | MobEntity | null,
    entityType: string,
  ): boolean {
    if (!entity) return false;
    if (entityType === "player") {
      // Check player health
      const player = entity as Entity;
      const healthComponent = player.getComponent("health");
      if (healthComponent?.data) {
        const health = healthComponent.data as {
          current: number;
          isDead?: boolean;
        };
        return health.current > 0 && !health.isDead;
      }
      const playerHealth = player.getHealth();
      return playerHealth > 0;
    }

    if (entityType === "mob") {
      // Check mob health
      const mob = entity as MobEntity;

      // Check if mob is marked as dead
      if (mob.isDead()) {
        return false;
      }

      // Check mob data if available
      if (mob.getMobData) {
        const mobData = mob.getMobData();
        return mobData.health > 0;
      }

      // Fallback to health check
      const mobHealth = mob.getHealth();
      return mobHealth > 0;
    }

    return false;
  }

  // =========================================================================
  // EVENT STORE METHODS (Phase 7 - Combat Replay/Debugging)
  // =========================================================================

  /**
   * Build GameStateInfo for event recording
   * Used for checksum calculation to detect desync
   */
  private buildGameStateInfo(): GameStateInfo {
    const combatStatesMap = this.stateService.getCombatStatesMap();
    return {
      currentTick: this.world.currentTick,
      playerCount: this.world.entities.players.size,
      activeCombats: combatStatesMap.size,
    };
  }

  /**
   * Build a full snapshot of combat state for replay
   * Called periodically (every 100 ticks) for efficient replay start points
   */
  private buildCombatSnapshot(): {
    entities: Map<string, EntitySnapshot>;
    combatStates: Map<string, CombatSnapshot>;
    rngState: SeededRandomState;
  } {
    const entities = new Map<string, EntitySnapshot>();
    const combatStates = new Map<string, CombatSnapshot>();

    // Snapshot all active combat participants
    for (const [entityId, state] of this.stateService.getCombatStatesMap()) {
      const attackerEntity = this.getEntity(
        String(entityId),
        state.attackerType,
      );
      const targetEntity = this.getEntity(
        String(state.targetId),
        state.targetType,
      );

      // Snapshot attacker
      if (attackerEntity) {
        const pos = getEntityPosition(attackerEntity);
        entities.set(String(entityId), {
          id: String(entityId),
          type: state.attackerType,
          position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined,
          health: this.getEntityHealth(attackerEntity),
          maxHealth: attackerEntity.getMaxHealth?.() ?? 100,
        });
      }

      // Snapshot target
      if (targetEntity) {
        const pos = getEntityPosition(targetEntity);
        entities.set(String(state.targetId), {
          id: String(state.targetId),
          type: state.targetType,
          position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined,
          health: this.getEntityHealth(targetEntity),
          maxHealth: targetEntity.getMaxHealth?.() ?? 100,
        });
      }

      // Snapshot combat state
      combatStates.set(String(entityId), {
        attackerId: String(entityId),
        targetId: String(state.targetId),
        startTick: state.lastAttackTick, // Use lastAttackTick as approximate start
        lastAttackTick: state.lastAttackTick,
      });
    }

    // Get RNG state for deterministic replay
    const rngState = getGameRngState() ?? { state0: "0", state1: "0" };

    return { entities, combatStates, rngState };
  }

  /**
   * Record a combat event to the EventStore
   * Includes RNG state for deterministic replay
   */
  private recordCombatEvent(
    type: GameEventType,
    entityId: string,
    payload: unknown,
  ): void {
    if (!this.eventRecordingEnabled) return;

    const tick = this.world.currentTick;
    const stateInfo = this.buildGameStateInfo();

    // Include snapshot data periodically (every 100 ticks)
    const snapshot = tick % 100 === 0 ? this.buildCombatSnapshot() : undefined;

    this.eventStore.record(
      {
        tick,
        type,
        entityId,
        payload: {
          ...((payload as object) ?? {}),
          rngState: getGameRngState(), // Include RNG state for replay
        },
      },
      stateInfo,
      snapshot,
    );
  }

  /**
   * Enable or disable combat event recording
   * Useful for performance testing or when replay isn't needed
   */
  public setEventRecordingEnabled(enabled: boolean): void {
    this.eventRecordingEnabled = enabled;
  }

  /**
   * Get combat events for a specific entity (for debugging/investigation)
   * @param entityId - The entity to get events for
   * @param startTick - Optional start tick
   * @param endTick - Optional end tick
   */
  public getCombatEventHistory(
    entityId: string,
    startTick?: number,
    endTick?: number,
  ): Array<{
    tick: number;
    type: string;
    entityId: string;
    payload: unknown;
  }> {
    return this.eventStore.getEntityEvents(entityId, startTick, endTick);
  }

  /**
   * Get all combat events in a tick range (for replay/investigation)
   */
  public getCombatEventsInRange(
    startTick: number,
    endTick: number,
  ): Array<{
    tick: number;
    type: string;
    entityId: string;
    payload: unknown;
  }> {
    return this.eventStore.getCombatEvents(startTick, endTick);
  }

  /**
   * Verify checksum at a specific tick (desync detection)
   * @returns true if checksum matches, false if desync detected
   */
  public verifyEventChecksum(tick: number, expectedChecksum: number): boolean {
    return this.eventStore.verifyChecksum(tick, expectedChecksum);
  }

  /**
   * Get nearest snapshot before a tick for efficient replay
   */
  public getNearestSnapshot(tick: number):
    | {
        tick: number;
        entities: Map<string, EntitySnapshot>;
        combatStates: Map<string, CombatSnapshot>;
        rngState: SeededRandomState;
      }
    | undefined {
    return this.eventStore.getNearestSnapshot(tick);
  }

  /**
   * Get event store statistics for monitoring
   */
  public getEventStoreStats(): {
    eventCount: number;
    snapshotCount: number;
    oldestTick: number | undefined;
    newestTick: number | undefined;
  } {
    return {
      eventCount: this.eventStore.getEventCount(),
      snapshotCount: this.eventStore.getSnapshotCount(),
      oldestTick: this.eventStore.getOldestEventTick(),
      newestTick: this.eventStore.getNewestEventTick(),
    };
  }

  /**
   * Clear all recorded events (for testing or memory management)
   */
  public clearEventStore(): void {
    this.eventStore.clear();
  }

  destroy(): void {
    // Clean up modular services
    this.stateService.destroy();
    this.animationManager.destroy();

    // Clean up anti-cheat monitoring (Phase 6)
    this.antiCheat.destroy();

    // Clean up rate limiter (Phase 6.5)
    this.rateLimiter.destroy();

    // Release pooled tiles back to pool
    tilePool.release(this._attackerTile);
    tilePool.release(this._targetTile);

    // Clear all attack cooldowns (tick-based)
    this.nextAttackTicks.clear();

    // Call parent cleanup (handles autoCleanup)
    super.destroy();
  }

  /**
   * Get anti-cheat stats for monitoring dashboard (Phase 6)
   */
  public getAntiCheatStats(): {
    trackedPlayers: number;
    playersAboveWarning: number;
    playersAboveAlert: number;
    totalViolationsLast5Min: number;
  } {
    return this.antiCheat.getStats();
  }

  /**
   * Get anti-cheat report for a specific player (Phase 6)
   */
  public getAntiCheatPlayerReport(playerId: string): {
    score: number;
    recentViolations: Array<{
      playerId: string;
      type: string;
      severity: number;
      details: string;
      timestamp: number;
    }>;
    attacksThisTick: number;
  } {
    return this.antiCheat.getPlayerReport(playerId);
  }

  /**
   * Get players requiring admin attention (Phase 6)
   */
  public getPlayersRequiringReview(): string[] {
    return this.antiCheat.getPlayersRequiringReview();
  }

  /**
   * Decay anti-cheat scores and clean stale XP history
   * Call periodically (e.g., every minute) to prevent memory leaks
   */
  public decayAntiCheatScores(): void {
    this.antiCheat.decayScores();
    // Also clean stale XP history to prevent memory leaks from disconnected players
    const currentTick = this.world.currentTick ?? 0;
    this.antiCheat.cleanupStaleXPHistory(currentTick);
  }

  /**
   * Get pool statistics for monitoring dashboard
   * Useful for detecting memory leaks or pool exhaustion
   *
   * @see COMBAT_SYSTEM_IMPROVEMENTS.md Section 3.2
   */
  public getPoolStats(): {
    quaternions: { total: number; available: number; inUse: number };
  } {
    return {
      quaternions: quaternionPool.getStats(),
    };
  }

  /**
   * Get anti-cheat configuration (for admin tools)
   */
  public getAntiCheatConfig(): {
    warningThreshold: number;
    alertThreshold: number;
    scoreDecayPerMinute: number;
    maxAttacksPerTick: number;
    maxViolationsPerPlayer: number;
    warningCooldownMs: number;
  } {
    return this.antiCheat.getConfig();
  }
}
