/**
 * ProcessingSystemBase - Shared Base Class for Processing Systems
 *
 * Provides shared functionality for firemaking and cooking:
 * - Fire management (create, extinguish, cleanup)
 * - Active processing tracking
 * - Object pooling for ProcessingAction
 * - Player emote helpers
 *
 * Subclasses: FiremakingSystem, CookingSystem
 *
 * @see Phase 4.1 of COOKING_FIREMAKING_HARDENING_PLAN.md
 */

import THREE from "../../../extras/three/three";
import { Fire, ProcessingAction } from "../../../types/core/core";
import { EventType } from "../../../types/events";
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types/index";
import type { Position3D } from "../../../types/core/base-types";
import { getTargetValidator, type FireRegistry } from "./TargetValidator";
import { worldToTile } from "../../shared/movement/TileSystem";

/**
 * Extended fire registry interface - includes additional methods for cooking system.
 * Extends the base FireRegistry from TargetValidator.
 */
export interface FullFireRegistry extends FireRegistry {
  getActiveFires(): Map<string, Fire>;
  hasFireAtTile(tile: { x: number; z: number }): boolean;
}

/**
 * Abstract base class for processing systems (firemaking, cooking)
 */
export abstract class ProcessingSystemBase
  extends SystemBase
  implements FullFireRegistry
{
  // Shared state
  protected activeFires = new Map<string, Fire>();
  protected activeProcessing = new Map<string, ProcessingAction>();
  protected fireCleanupTimers = new Map<string, NodeJS.Timeout>();
  protected playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  // Processing constants per GDD
  protected readonly FIRE_DURATION = 120000; // 2 minutes
  protected readonly MAX_FIRES_PER_PLAYER = 3;

  // Object pool for ProcessingAction (Phase 2 optimization)
  protected readonly actionPool: ProcessingAction[] = [];
  protected readonly MAX_POOL_SIZE = 100;

  constructor(world: World, config: { name: string }) {
    super(world, {
      name: config.name,
      dependencies: {
        required: [],
        optional: ["inventory", "skills", "ui"],
      },
      autoCleanup: true,
    });
  }

  // =========================================================================
  // OBJECT POOLING (Phase 2)
  // =========================================================================

  /**
   * Count active fires for a player without allocating arrays.
   */
  protected countPlayerFires(playerId: string): number {
    let count = 0;
    for (const fire of this.activeFires.values()) {
      if (fire.playerId === playerId && fire.isActive) {
        count++;
      }
    }
    return count;
  }

  /**
   * Acquire a ProcessingAction from the pool (or create new).
   */
  protected acquireAction(): ProcessingAction {
    if (this.actionPool.length > 0) {
      return this.actionPool.pop()!;
    }
    return {
      playerId: "",
      actionType: "firemaking",
      primaryItem: { id: "", slot: 0 },
      startTime: 0,
      duration: 0,
      xpReward: 0,
      skillRequired: "",
    };
  }

  /**
   * Release a ProcessingAction back to the pool for reuse.
   */
  protected releaseAction(action: ProcessingAction): void {
    if (this.actionPool.length < this.MAX_POOL_SIZE) {
      action.playerId = "";
      action.targetItem = undefined;
      action.targetFire = undefined;
      this.actionPool.push(action);
    }
  }

  // =========================================================================
  // EMOTE HELPERS (Phase 3 DRY)
  // =========================================================================

  /**
   * Set player emote during processing (squat for cooking/firemaking)
   */
  protected setProcessingEmote(playerId: string): void {
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "squat",
    });
  }

  /**
   * Reset player emote to idle (after processing completes or cancels)
   */
  protected resetPlayerEmote(playerId: string): void {
    this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
      playerId,
      emote: "idle",
    });
  }

  // =========================================================================
  // FIRE MANAGEMENT
  // =========================================================================

  /**
   * Create a fire at the given position.
   * Returns the fire ID.
   */
  protected createFire(playerId: string, position: Position3D): Fire {
    const fireId = `fire_${playerId}_${Date.now()}`;
    const fire: Fire = {
      id: fireId,
      position,
      playerId,
      createdAt: Date.now(),
      duration: this.FIRE_DURATION,
      isActive: true,
    };

    this.activeFires.set(fireId, fire);

    // Set fire cleanup timer
    const cleanupTimer = setTimeout(() => {
      this.extinguishFire(fireId);
    }, this.FIRE_DURATION);

    this.fireCleanupTimers.set(fireId, cleanupTimer);

    // Emit event for observability
    this.emitTypedEvent(EventType.FIRE_CREATED, {
      fireId: fire.id,
      playerId: fire.playerId,
      position: fire.position,
    });

    return fire;
  }

  /**
   * Extinguish a fire by ID.
   */
  protected extinguishFire(fireId: string): void {
    const fire = this.activeFires.get(fireId);

    // Guard: Fire may not exist (already extinguished or never created)
    if (!fire) {
      console.warn(
        `[ProcessingSystemBase] Attempted to extinguish non-existent fire: ${fireId}`,
      );
      return;
    }

    // Guard: Prevent double cleanup
    if (!fire.isActive) {
      return;
    }

    fire.isActive = false;

    // Cancel animation before removing mesh (Phase 2: prevent RAF leak)
    const fireWithAnimation = fire as { cancelAnimation?: () => void };
    fireWithAnimation.cancelAnimation?.();

    // Remove visual and dispose THREE.js resources (only exists on client)
    if (fire.mesh && this.world.isClient) {
      this.world.stage.scene.remove(fire.mesh);

      // Dispose THREE.js resources to prevent GPU memory leak
      const mesh = fire.mesh as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          (mesh.material as THREE.Material).dispose();
        }
      }

      // Clear reference for GC
      fire.mesh = undefined;
    }

    this.activeFires.delete(fireId);

    // cleanup timer
    clearTimeout(this.fireCleanupTimers.get(fireId));
    this.fireCleanupTimers.delete(fireId);

    // Emit event for observability
    this.emitTypedEvent(EventType.FIRE_EXTINGUISHED, {
      fireId: fireId,
    });
  }

  /**
   * Create fire visual mesh (client-only).
   * Can be overridden by FireVisualManager if needed.
   */
  protected createFireVisual(fire: Fire): void {
    // Only create visuals on client
    if (!this.world.isClient) return;

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
      entityId: fire.id,
      fireId: fire.id,
      playerId: fire.playerId,
      name: "Fire",
    };
    // Set layer 1 for raycasting
    fireMesh.layers.set(1);

    // Add flickering animation with proper cleanup
    let animationFrameId: number | null = null;

    const animate = () => {
      if (fire.isActive && fire.mesh) {
        fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
        animationFrameId = requestAnimationFrame(animate);
      } else {
        animationFrameId = null;
      }
    };
    animate();

    // Store cancel function on fire object for cleanup
    (fire as { cancelAnimation?: () => void }).cancelAnimation = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    fire.mesh = fireMesh as THREE.Object3D;
    this.world.stage.scene.add(fireMesh);
  }

  /**
   * Cleanup player's processing state and fires.
   */
  protected cleanupPlayer(data: { id: string }): void {
    const playerId = data.id;

    // Remove active processing and release action to pool
    const action = this.activeProcessing.get(playerId);
    this.activeProcessing.delete(playerId);
    if (action) this.releaseAction(action);

    // Extinguish player's fires
    for (const [fireId, fire] of this.activeFires.entries()) {
      if (fire.playerId === playerId) {
        this.extinguishFire(fireId);
      }
    }
  }

  // =========================================================================
  // FIRE REGISTRY INTERFACE (for dependency injection)
  // =========================================================================

  /**
   * Get IDs of all active fires.
   * Note: Allocates a new array. For hot paths, use forEachActiveFire() instead.
   */
  getActiveFireIds(): string[] {
    const ids: string[] = [];
    for (const [id, fire] of this.activeFires) {
      if (fire.isActive) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Iterate over active fires without allocation (for hot paths).
   * @param callback - Called for each active fire
   */
  forEachActiveFire(callback: (fire: Fire, id: string) => void): void {
    for (const [id, fire] of this.activeFires) {
      if (fire.isActive) {
        callback(fire, id);
      }
    }
  }

  /**
   * Get all active fires.
   * Note: Returns a copy to prevent external mutation.
   */
  getActiveFires(): Map<string, Fire> {
    return new Map(this.activeFires);
  }

  /**
   * Get fires as array.
   * Note: Allocates a new array. For hot paths, use forEachActiveFire() instead.
   */
  getFires(): Fire[] {
    return Array.from(this.activeFires.values());
  }

  /**
   * Get fires for a specific player.
   * Note: Allocates a new array.
   */
  getPlayerFires(playerId: string): Fire[] {
    const fires: Fire[] = [];
    for (const fire of this.activeFires.values()) {
      if (fire.playerId === playerId && fire.isActive) {
        fires.push(fire);
      }
    }
    return fires;
  }

  /**
   * Count fires for a specific player without allocation.
   */
  countPlayerFiresPublic(playerId: string): number {
    return this.countPlayerFires(playerId);
  }

  /**
   * Check if player is currently processing
   */
  isPlayerProcessing(playerId: string): boolean {
    return this.activeProcessing.has(playerId);
  }

  /**
   * Check if there's an active fire at a given tile position
   */
  hasFireAtTile(tile: { x: number; z: number }): boolean {
    for (const [, fire] of this.activeFires) {
      if (!fire.isActive) continue;
      const fireTile = worldToTile(fire.position.x, fire.position.z);
      if (fireTile.x === tile.x && fireTile.z === tile.z) {
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  protected async initBase(): Promise<void> {
    // Listen to skills updates for reactive patterns
    this.subscribe(
      EventType.SKILLS_UPDATED,
      (data: {
        playerId: string;
        skills: Record<string, { level: number; xp: number }>;
      }) => {
        this.playerSkills.set(data.playerId, data.skills);
      },
    );

    // Listen for player cleanup
    this.subscribe(
      EventType.PLAYER_UNREGISTERED,
      (data: { playerId: string }) => this.cleanupPlayer({ id: data.playerId }),
    );

    // Listen for test event to extinguish fires early
    this.subscribe(
      EventType.TEST_FIRE_EXTINGUISH,
      (data: { fireId: string }) => {
        this.extinguishFire(data.fireId);
      },
    );

    // Register as FireRegistry so TargetValidator knows about active fires
    const validator = getTargetValidator();
    validator.setFireRegistry({
      getActiveFireIds: () => this.getActiveFireIds(),
    });

    // CLIENT ONLY: Listen for fire events from server
    if (this.world.isClient) {
      this.subscribe(
        EventType.FIRE_CREATED,
        (data: {
          fireId: string;
          playerId: string;
          position: { x: number; y: number; z: number };
        }) => {
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

  update(_dt: number): void {
    // Check for expired processing actions
    const now = Date.now();
    for (const [playerId, action] of this.activeProcessing.entries()) {
      if (now - action.startTime > action.duration + 1000) {
        // 1 second grace period
        this.activeProcessing.delete(playerId);
        this.releaseAction(action);
      }
    }
  }
}
