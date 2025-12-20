/**
 * CombatAnimationSync - Animation-Damage Synchronization (Phase 4)
 *
 * Coordinates combat animations with damage application and hitsplat display.
 * Ensures damage appears at the visual "hit" moment of attack animations.
 *
 * OSRS Animation Synchronization:
 * @see https://oldschool.runescape.wiki/w/Hitsplat
 *
 * Attack animation keyframes:
 * - Frame 0: Wind-up starts (weapon raises)
 * - Frame 0.5: Weapon connects (DAMAGE APPLIES HERE)
 * - Frame 1.0: Follow-through completes
 *
 * The damage frame is calculated as:
 *   damageFrame = ceil(attackSpeedTicks * HIT_FRAME_RATIO)
 *
 * For a 4-tick attack (2.4s):
 *   damageFrame = ceil(4 * 0.5) = 2 ticks after animation starts
 *
 * This ensures:
 * 1. Animation starts immediately when attack is queued
 * 2. Damage applies at the visual "hit" moment
 * 3. Hitsplat displays synchronized with damage
 */

import type { World } from "../../../core/World";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import type { CombatAnimationManager } from "./CombatAnimationManager";
import type { HitDelayAttackType } from "../../../utils/game/HitDelayCalculator";
import type { EntityID } from "../../../types/core/identifiers";

/**
 * Scheduled attack data for tracking coordinated animations
 */
export interface ScheduledAttack {
  /** Unique ID for this attack instance */
  id: string;
  /** Attacker entity ID */
  attackerId: string;
  /** Target entity ID */
  targetId: string;
  /** Entity type of attacker */
  attackerType: "player" | "mob";
  /** Entity type of target */
  targetType: "player" | "mob";
  /** Attack type (melee, ranged, magic) */
  attackType: HitDelayAttackType;
  /** Tick when animation started */
  animationStartTick: number;
  /** Tick when damage should apply */
  damageApplyTick: number;
  /** Tick when hitsplat should display */
  hitsplatDisplayTick: number;
  /** Tick when hitsplat should hide */
  hitsplatHideTick: number;
  /** Pre-calculated damage amount */
  damage: number;
  /** Distance to target (for ranged/magic projectiles) */
  distance: number;
  /** Attack speed in ticks */
  attackSpeedTicks: number;
  /** Whether damage has been applied */
  damageApplied: boolean;
  /** Whether hitsplat has been triggered */
  hitsplatTriggered: boolean;
}

/**
 * Hitsplat data for display scheduling
 */
export interface ScheduledHitsplat {
  /** Target entity ID */
  targetId: string;
  /** Damage amount to display */
  damage: number;
  /** Tick when hitsplat should appear */
  displayTick: number;
  /** Tick when hitsplat should hide */
  hideTick: number;
  /** Whether this is a miss (0 damage) */
  isMiss: boolean;
  /** Whether hitsplat has been displayed */
  displayed: boolean;
}

/**
 * Damage queue callback type
 * Called when damage should be applied to the game state
 */
export type DamageQueueCallback = (
  attackerId: string,
  targetId: string,
  damage: number,
  attackerType: "player" | "mob",
  targetType: "player" | "mob",
  attackType: HitDelayAttackType,
  distance: number,
  currentTick: number,
) => void;

/**
 * Hitsplat display callback type
 * Called when hitsplat should be shown on client
 */
export type HitsplatDisplayCallback = (
  targetId: string,
  damage: number,
  isMiss: boolean,
  displayTick: number,
  hideTick: number,
) => void;

/**
 * CombatAnimationSync - Coordinates animation, damage, and hitsplat timing
 */
export class CombatAnimationSync {
  private world: World;
  private animationManager: CombatAnimationManager;

  // Scheduled attacks awaiting processing
  private scheduledAttacks: Map<string, ScheduledAttack> = new Map();

  // Scheduled hitsplats awaiting display
  private scheduledHitsplats: ScheduledHitsplat[] = [];

  // Callbacks for damage and hitsplat systems
  private damageQueueCallback: DamageQueueCallback | null = null;
  private hitsplatDisplayCallback: HitsplatDisplayCallback | null = null;

  // Counter for unique attack IDs
  private attackCounter = 0;

  // Pre-allocated array for hot-path optimization (avoids GC pressure)
  private completedHitsplatIndices: number[] = [];

  constructor(world: World, animationManager: CombatAnimationManager) {
    this.world = world;
    this.animationManager = animationManager;
  }

  /**
   * Set the callback for queueing damage
   * This is typically GameTickProcessor.queueDamageWithDelay()
   */
  setDamageQueueCallback(callback: DamageQueueCallback): void {
    this.damageQueueCallback = callback;
  }

  /**
   * Set the callback for displaying hitsplats
   * This broadcasts hitsplat events to clients
   */
  setHitsplatDisplayCallback(callback: HitsplatDisplayCallback): void {
    this.hitsplatDisplayCallback = callback;
  }

  /**
   * Schedule a synchronized attack
   *
   * This is the main entry point for combat systems. It coordinates:
   * 1. Starting the attack animation immediately
   * 2. Calculating the damage frame based on attack speed
   * 3. Scheduling damage application at the damage frame
   * 4. Scheduling hitsplat display at the same tick
   *
   * @param attackerId - Entity performing the attack (accepts both EntityID and string)
   * @param targetId - Entity receiving the attack (accepts both EntityID and string)
   * @param attackerType - "player" or "mob"
   * @param targetType - "player" or "mob"
   * @param attackType - "melee", "ranged", or "magic"
   * @param damage - Pre-calculated damage amount
   * @param distance - Distance to target in tiles
   * @param currentTick - Current game tick
   * @param attackSpeedTicks - Attack speed in ticks (default 4)
   * @returns The scheduled attack ID
   */
  scheduleAttack(
    attackerId: EntityID | string,
    targetId: EntityID | string,
    attackerType: "player" | "mob",
    targetType: "player" | "mob",
    attackType: HitDelayAttackType,
    damage: number,
    distance: number,
    currentTick: number,
    attackSpeedTicks: number = COMBAT_CONSTANTS.DEFAULT_ATTACK_SPEED_TICKS,
  ): string {
    const attackerIdStr = String(attackerId);
    const targetIdStr = String(targetId);
    const { ANIMATION, HIT_DELAY } = COMBAT_CONSTANTS;

    // 1. Start animation IMMEDIATELY
    this.animationManager.setCombatEmote(
      attackerIdStr,
      attackerType,
      currentTick,
      attackSpeedTicks,
    );

    // 2. Calculate damage frame (animation midpoint)
    // Use ceil to ensure damage never applies before animation visually "hits"
    const animationHitFrame = Math.ceil(
      attackSpeedTicks * ANIMATION.HIT_FRAME_RATIO,
    );

    // 3. Calculate hit delay based on attack type (Phase 3)
    let hitDelayTicks = 0;
    switch (attackType) {
      case "melee":
        hitDelayTicks = HIT_DELAY.MELEE_BASE;
        break;
      case "ranged":
        hitDelayTicks =
          HIT_DELAY.RANGED_BASE +
          Math.floor(
            (HIT_DELAY.RANGED_DISTANCE_OFFSET + distance) /
              HIT_DELAY.RANGED_DISTANCE_DIVISOR,
          );
        break;
      case "magic":
        hitDelayTicks =
          HIT_DELAY.MAGIC_BASE +
          Math.floor(
            (HIT_DELAY.MAGIC_DISTANCE_OFFSET + distance) /
              HIT_DELAY.MAGIC_DISTANCE_DIVISOR,
          );
        break;
    }
    hitDelayTicks = Math.min(hitDelayTicks, HIT_DELAY.MAX_HIT_DELAY);

    // 4. Damage applies at the later of animation hit frame or projectile arrival
    // For melee: damage at animation midpoint
    // For ranged/magic: damage when projectile arrives (may be after animation)
    const damageApplyTick =
      currentTick + Math.max(animationHitFrame, hitDelayTicks);

    // 5. Hitsplat displays same tick as damage
    const hitsplatDisplayTick =
      damageApplyTick + ANIMATION.HITSPLAT_DELAY_TICKS;
    const hitsplatHideTick =
      hitsplatDisplayTick + ANIMATION.HITSPLAT_DURATION_TICKS;

    // 6. Create scheduled attack record
    const attackId = `${attackerIdStr}-${targetIdStr}-${currentTick}-${this.attackCounter++}`;
    const scheduledAttack: ScheduledAttack = {
      id: attackId,
      attackerId: attackerIdStr,
      targetId: targetIdStr,
      attackerType,
      targetType,
      attackType,
      animationStartTick: currentTick,
      damageApplyTick,
      hitsplatDisplayTick,
      hitsplatHideTick,
      damage,
      distance,
      attackSpeedTicks,
      damageApplied: false,
      hitsplatTriggered: false,
    };

    this.scheduledAttacks.set(attackId, scheduledAttack);

    // 7. Immediately queue damage via callback (if set)
    // The damage will apply at the calculated tick
    if (this.damageQueueCallback) {
      this.damageQueueCallback(
        attackerIdStr,
        targetIdStr,
        damage,
        attackerType,
        targetType,
        attackType,
        distance,
        currentTick,
      );
    }

    // 8. Schedule hitsplat for synchronized display
    this.scheduleHitsplat(
      targetIdStr,
      damage,
      hitsplatDisplayTick,
      hitsplatHideTick,
    );

    return attackId;
  }

  /**
   * Schedule a hitsplat for display at a specific tick
   */
  private scheduleHitsplat(
    targetId: string,
    damage: number,
    displayTick: number,
    hideTick: number,
  ): void {
    this.scheduledHitsplats.push({
      targetId,
      damage,
      displayTick,
      hideTick,
      isMiss: damage === 0,
      displayed: false,
    });
  }

  /**
   * Process scheduled attacks and hitsplats for this tick
   *
   * Called by GameTickProcessor during tick processing.
   * Handles:
   * - Marking attacks as damage-applied
   * - Triggering hitsplat displays
   * - Cleaning up completed attacks
   */
  processTick(currentTick: number): void {
    // Process scheduled attacks
    for (const [attackId, attack] of this.scheduledAttacks.entries()) {
      // Mark damage as applied when tick is reached
      if (!attack.damageApplied && currentTick >= attack.damageApplyTick) {
        attack.damageApplied = true;
      }

      // Trigger hitsplat display
      if (
        !attack.hitsplatTriggered &&
        currentTick >= attack.hitsplatDisplayTick
      ) {
        attack.hitsplatTriggered = true;
      }

      // Clean up completed attacks (after hitsplat hides)
      if (currentTick >= attack.hitsplatHideTick) {
        this.scheduledAttacks.delete(attackId);
      }
    }

    // Process scheduled hitsplats (reuse pre-allocated array to avoid GC)
    this.completedHitsplatIndices.length = 0;
    for (let i = 0; i < this.scheduledHitsplats.length; i++) {
      const hitsplat = this.scheduledHitsplats[i];

      // Display hitsplat when tick is reached
      if (!hitsplat.displayed && currentTick >= hitsplat.displayTick) {
        hitsplat.displayed = true;

        // Trigger callback if set
        if (this.hitsplatDisplayCallback) {
          this.hitsplatDisplayCallback(
            hitsplat.targetId,
            hitsplat.damage,
            hitsplat.isMiss,
            hitsplat.displayTick,
            hitsplat.hideTick,
          );
        }
      }

      // Mark for cleanup after hide tick
      if (currentTick >= hitsplat.hideTick) {
        this.completedHitsplatIndices.push(i);
      }
    }

    // Remove completed hitsplats (reverse order to preserve indices)
    for (let i = this.completedHitsplatIndices.length - 1; i >= 0; i--) {
      this.scheduledHitsplats.splice(this.completedHitsplatIndices[i], 1);
    }
  }

  /**
   * Cancel a scheduled attack (e.g., target died, attacker interrupted)
   */
  cancelAttack(attackId: string): boolean {
    return this.scheduledAttacks.delete(attackId);
  }

  /**
   * Cancel all scheduled attacks for an entity
   * Used when entity dies or disconnects
   * @param entityId - Entity ID (accepts both EntityID and string)
   */
  cancelAttacksForEntity(entityId: EntityID | string): number {
    const entityIdStr = String(entityId);
    let cancelled = 0;
    for (const [attackId, attack] of this.scheduledAttacks.entries()) {
      if (
        attack.attackerId === entityIdStr ||
        attack.targetId === entityIdStr
      ) {
        this.scheduledAttacks.delete(attackId);
        cancelled++;
      }
    }

    // Also cancel pending hitsplats
    this.scheduledHitsplats = this.scheduledHitsplats.filter(
      (h) => h.targetId !== entityIdStr,
    );

    return cancelled;
  }

  /**
   * Get pending attack count (for debugging/metrics)
   */
  getPendingAttackCount(): number {
    return this.scheduledAttacks.size;
  }

  /**
   * Get pending hitsplat count (for debugging/metrics)
   */
  getPendingHitsplatCount(): number {
    return this.scheduledHitsplats.length;
  }

  /**
   * Get scheduled attack by ID (for testing)
   */
  getScheduledAttack(attackId: string): ScheduledAttack | undefined {
    return this.scheduledAttacks.get(attackId);
  }

  /**
   * Calculate the damage frame tick for a given attack
   *
   * Utility method for external systems that need to know
   * when damage will visually appear.
   *
   * @param currentTick - Current game tick
   * @param attackType - Type of attack
   * @param distance - Distance to target
   * @param attackSpeedTicks - Attack speed in ticks
   * @returns Tick when damage will appear
   */
  calculateDamageFrame(
    currentTick: number,
    attackType: HitDelayAttackType,
    distance: number,
    attackSpeedTicks: number = COMBAT_CONSTANTS.DEFAULT_ATTACK_SPEED_TICKS,
  ): number {
    const { ANIMATION, HIT_DELAY } = COMBAT_CONSTANTS;

    // Animation hit frame
    const animationHitFrame = Math.ceil(
      attackSpeedTicks * ANIMATION.HIT_FRAME_RATIO,
    );

    // Hit delay based on attack type
    let hitDelayTicks = 0;
    switch (attackType) {
      case "melee":
        hitDelayTicks = HIT_DELAY.MELEE_BASE;
        break;
      case "ranged":
        hitDelayTicks =
          HIT_DELAY.RANGED_BASE +
          Math.floor(
            (HIT_DELAY.RANGED_DISTANCE_OFFSET + distance) /
              HIT_DELAY.RANGED_DISTANCE_DIVISOR,
          );
        break;
      case "magic":
        hitDelayTicks =
          HIT_DELAY.MAGIC_BASE +
          Math.floor(
            (HIT_DELAY.MAGIC_DISTANCE_OFFSET + distance) /
              HIT_DELAY.MAGIC_DISTANCE_DIVISOR,
          );
        break;
    }
    hitDelayTicks = Math.min(hitDelayTicks, HIT_DELAY.MAX_HIT_DELAY);

    return currentTick + Math.max(animationHitFrame, hitDelayTicks);
  }

  /**
   * Clear all scheduled attacks and hitsplats
   */
  destroy(): void {
    this.scheduledAttacks.clear();
    this.scheduledHitsplats = [];
    this.damageQueueCallback = null;
    this.hitsplatDisplayCallback = null;
  }
}
