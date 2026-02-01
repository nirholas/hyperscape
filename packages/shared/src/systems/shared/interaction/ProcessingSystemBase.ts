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
 */

import THREE from "../../../extras/three/three";
import { Fire, ProcessingAction } from "../../../types/core/core";
import { EventType } from "../../../types/events";
import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../types/index";
import type { Position3D } from "../../../types/core/base-types";
import { getTargetValidator, type FireRegistry } from "./TargetValidator";
import { worldToTile } from "../../shared/movement/TileSystem";
import { modelCache } from "../../../utils/rendering/ModelCache";

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
  // Fire visual constants
  private static readonly FIRE_MODEL_SCALE = 0.35;
  private static readonly FIRE_MODEL_Y_OFFSET = 0.063;
  private static readonly FIRE_PARTICLE_SPAWN_Y = 0.1;
  private static readonly FIRE_PLACEHOLDER_Y_OFFSET = 0.4;

  // Shared fire particle resources (static, lazily initialized on client only)
  private static fireParticleGeometry: THREE.CircleGeometry | null = null;
  private static fireGlowTextures: Map<number, THREE.DataTexture> | null = null;

  private static getFireParticleGeometry(): THREE.CircleGeometry {
    if (!ProcessingSystemBase.fireParticleGeometry) {
      ProcessingSystemBase.fireParticleGeometry = new THREE.CircleGeometry(
        0.7,
        12,
      );
    }
    return ProcessingSystemBase.fireParticleGeometry;
  }

  private static getOrCreateGlowTexture(colorHex: number): THREE.DataTexture {
    if (!ProcessingSystemBase.fireGlowTextures) {
      ProcessingSystemBase.fireGlowTextures = new Map();
    }
    const cached = ProcessingSystemBase.fireGlowTextures.get(colorHex);
    if (cached) return cached;

    const size = 64;
    const sharpness = 2.0;
    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist);
        const strength = Math.pow(falloff, sharpness);
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * strength);
        data[idx + 1] = Math.round(g * strength);
        data[idx + 2] = Math.round(b * strength);
        data[idx + 3] = Math.round(255 * strength);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    ProcessingSystemBase.fireGlowTextures.set(colorHex, tex);
    return tex;
  }

  // Shared state
  protected activeFires = new Map<string, Fire>();
  protected activeProcessing = new Map<string, ProcessingAction>();
  protected fireCleanupTimers = new Map<string, NodeJS.Timeout>();
  protected pendingFireModels = new Map<string, THREE.Object3D>();
  protected playerSkills = new Map<
    string,
    Record<string, { level: number; xp: number }>
  >();

  // Processing constants per GDD
  protected readonly FIRE_DURATION = 120000; // 2 minutes
  protected readonly MAX_FIRES_PER_PLAYER = 3;

  // Object pool for ProcessingAction
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
  // OBJECT POOLING
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
  // EMOTE HELPERS
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

    // Cancel placeholder animation before removing mesh
    const fireWithAnimation = fire as { cancelAnimation?: () => void };
    fireWithAnimation.cancelAnimation?.();

    // Destroy fire particle meshes
    const fireWithParticles = fire as { cancelFireParticles?: () => void };
    if (fireWithParticles.cancelFireParticles) {
      fireWithParticles.cancelFireParticles();
      fireWithParticles.cancelFireParticles = undefined;
    }

    // Remove visual and dispose THREE.js resources (only exists on client)
    if (fire.mesh && this.world.isClient) {
      this.world.stage.scene.remove(fire.mesh);

      // Traverse and dispose all geometries and materials (GLB models have multiple children)
      fire.mesh.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            for (const mat of materials) {
              // Only dispose non-cached materials (ModelCache manages shared materials)
              if (!modelCache.isManagedMaterial(mat as THREE.Material)) {
                (mat as THREE.Material).dispose();
              }
            }
          }
        }
      });

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
   * Create fire visual (client-only).
   * Loads GLB fire model and spawns particle fire effect.
   */
  protected async createFireVisual(fire: Fire): Promise<void> {
    // Only create visuals on client
    if (!this.world.isClient) return;

    let model: THREE.Object3D | null = null;

    // Check if we already loaded the model during the lighting phase
    const pending = this.pendingFireModels.get(fire.playerId);
    if (pending) {
      model = pending;
      this.pendingFireModels.delete(fire.playerId);
    } else {
      // Load model fresh (late join / missed lighting event)
      try {
        const result = await modelCache.loadModel(
          "asset://models/firemaking-fire/firemaking-fire.glb",
          this.world,
        );
        model = result.scene;
        const s = ProcessingSystemBase.FIRE_MODEL_SCALE;
        model.scale.set(s, s, s);
        model.position.set(
          fire.position.x,
          fire.position.y + ProcessingSystemBase.FIRE_MODEL_Y_OFFSET,
          fire.position.z,
        );
        this.world.stage.scene.add(model);
      } catch (err) {
        console.warn(
          "[ProcessingSystemBase] Failed to load fire model, using placeholder:",
          err,
        );
        this.createPlaceholderFireMesh(fire);
        return;
      }
    }

    // Guard: fire may have been extinguished during async model load
    if (!fire.isActive) {
      this.world.stage.scene.remove(model);
      return;
    }

    model.name = `Fire_${fire.id}`;
    model.userData = {
      type: "fire",
      entityId: fire.id,
      fireId: fire.id,
      playerId: fire.playerId,
      name: "Fire",
    };
    model.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        child.layers.set(1);
      }
    });

    fire.mesh = model;

    // Spawn particle fire effect rising from center of model
    this.createFireParticles(fire);
  }

  /**
   * Load fire GLB model during the 3s lighting animation (client-only).
   * Model is stored in pendingFireModels and transferred on FIRE_CREATED.
   */
  private async loadFireModelForLighting(
    playerId: string,
    position: { x: number; y: number; z: number },
  ): Promise<void> {
    try {
      const result = await modelCache.loadModel(
        "asset://models/firemaking-fire/firemaking-fire.glb",
        this.world,
      );

      const model = result.scene;
      model.name = `FireLighting_${playerId}`;
      const s = ProcessingSystemBase.FIRE_MODEL_SCALE;
      model.scale.set(s, s, s);
      model.position.set(
        position.x,
        position.y + ProcessingSystemBase.FIRE_MODEL_Y_OFFSET,
        position.z,
      );
      model.userData = { type: "fireLighting", playerId };
      model.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          child.layers.set(1);
        }
      });

      this.world.stage.scene.add(model);
      this.pendingFireModels.set(playerId, model);
    } catch (err) {
      console.warn(
        "[ProcessingSystemBase] Failed to load fire model for lighting:",
        err,
      );
    }
  }

  /**
   * Create billboard fire particle effect (client-only).
   * Uses manual billboard meshes with baked glow textures (same pattern as RunecraftingAltarEntity).
   */
  private createFireParticles(fire: Fire): void {
    if (!this.world.isClient) return;

    const PARTICLE_COUNT = 18;
    const meshes: THREE.Mesh[] = [];
    const geom = ProcessingSystemBase.getFireParticleGeometry();
    const colors = [0xff4400, 0xff6600, 0xff8800, 0xffaa00, 0xffcc00];

    // Per-particle state
    const ages = new Float32Array(PARTICLE_COUNT);
    const lifetimes = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const offsetsX = new Float32Array(PARTICLE_COUNT);
    const offsetsZ = new Float32Array(PARTICLE_COUNT);
    const baseScales = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      lifetimes[i] = 0.5 + Math.random() * 0.7;
      ages[i] = Math.random() * lifetimes[i]; // stagger
      speeds[i] = 0.6 + Math.random() * 0.8;
      offsetsX[i] = (Math.random() - 0.5) * 0.25;
      offsetsZ[i] = (Math.random() - 0.5) * 0.25;
      baseScales[i] = 0.18 + Math.random() * 0.22;

      const colorIdx = Math.floor(Math.random() * colors.length);
      const mat = new THREE.MeshBasicMaterial({
        map: ProcessingSystemBase.getOrCreateGlowTexture(colors[colorIdx]),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
      });

      const particle = new THREE.Mesh(geom, mat);
      particle.renderOrder = 999;
      particle.frustumCulled = false;
      particle.layers.set(1);
      this.world.stage.scene.add(particle);
      meshes.push(particle);
    }

    // Animation loop
    let lastTime = Date.now();
    let animFrameId: number | null = null;
    const camera = (this.world as { camera?: THREE.Camera }).camera;

    const animate = () => {
      if (!fire.isActive) {
        animFrameId = null;
        return;
      }

      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        ages[i] += dt;
        if (ages[i] >= lifetimes[i]) {
          ages[i] = 0;
          offsetsX[i] = (Math.random() - 0.5) * 0.25;
          offsetsZ[i] = (Math.random() - 0.5) * 0.25;
        }

        const t = ages[i] / lifetimes[i]; // 0..1
        const rise = t * speeds[i] * 0.7;

        meshes[i].position.set(
          fire.position.x + offsetsX[i] * (1 + t * 0.5),
          fire.position.y + ProcessingSystemBase.FIRE_PARTICLE_SPAWN_Y + rise,
          fire.position.z + offsetsZ[i] * (1 + t * 0.5),
        );

        // Fade in fast, fade out near end
        const fadeIn = Math.min(t * 6, 1);
        const fadeOut = Math.pow(1 - t, 1.5);
        (meshes[i].material as THREE.MeshBasicMaterial).opacity =
          0.75 * fadeIn * fadeOut;

        // Shrink as particle rises
        const scale = baseScales[i] * (1 - t * 0.4);
        meshes[i].scale.set(scale, scale * 1.3, scale);

        // Billboard: face camera
        if (camera) {
          meshes[i].quaternion.copy(camera.quaternion);
        }
      }

      animFrameId = requestAnimationFrame(animate);
    };

    if (typeof requestAnimationFrame !== "undefined") {
      animate();
    }

    // Store cleanup function and mesh references on fire object
    const fireExt = fire as {
      fireParticleMeshes?: THREE.Mesh[];
      cancelFireParticles?: () => void;
    };
    fireExt.fireParticleMeshes = meshes;
    fireExt.cancelFireParticles = () => {
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      for (const mesh of meshes) {
        this.world.stage.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
    };
  }

  /**
   * Fallback placeholder fire mesh (orange box) when GLB model fails to load.
   */
  private createPlaceholderFireMesh(fire: Fire): void {
    const fireGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
    const fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4500,
      transparent: true,
      opacity: 0.8,
    });

    const fireMesh = new THREE.Mesh(fireGeometry, fireMaterial);
    fireMesh.name = `Fire_${fire.id}`;
    fireMesh.position.set(
      fire.position.x,
      fire.position.y + ProcessingSystemBase.FIRE_PLACEHOLDER_Y_OFFSET,
      fire.position.z,
    );
    fireMesh.userData = {
      type: "fire",
      entityId: fire.id,
      fireId: fire.id,
      playerId: fire.playerId,
      name: "Fire",
    };
    fireMesh.layers.set(1);

    // Add flickering animation with proper cleanup
    let animationFrameId: number | null = null;
    if (typeof requestAnimationFrame !== "undefined") {
      const animate = () => {
        if (fire.isActive && fire.mesh) {
          fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
          animationFrameId = requestAnimationFrame(animate);
        } else {
          animationFrameId = null;
        }
      };
      animate();
    }

    (fire as { cancelAnimation?: () => void }).cancelAnimation = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
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

    // Remove pending fire model (cancelled during lighting)
    const pendingModel = this.pendingFireModels.get(playerId);
    if (pendingModel && this.world.isClient) {
      this.world.stage.scene.remove(pendingModel);
      this.pendingFireModels.delete(playerId);
    }

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

    // Cancel processing on movement (OSRS: any click cancels skilling)
    this.subscribe<{
      playerId: string;
      targetPosition: { x: number; y: number; z: number };
    }>(EventType.MOVEMENT_CLICK_TO_MOVE, (data) => {
      if (this.activeProcessing.has(data.playerId)) {
        this.cleanupPlayer({ id: data.playerId });
      }
    });

    // Cancel processing on combat start
    this.subscribe(
      EventType.COMBAT_STARTED,
      (data: { attackerId: string; targetId: string }) => {
        if (this.activeProcessing.has(data.attackerId)) {
          this.cleanupPlayer({ id: data.attackerId });
        }
        if (this.activeProcessing.has(data.targetId)) {
          this.cleanupPlayer({ id: data.targetId });
        }
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
          this.extinguishFire(data.fireId);
        },
      );

      // Load fire model when lighting starts (before fire is officially created)
      this.subscribe(
        EventType.FIRE_LIGHTING_STARTED,
        (data: {
          playerId: string;
          position: { x: number; y: number; z: number };
        }) => {
          this.loadFireModelForLighting(data.playerId, data.position);
        },
      );
    }
  }

  destroy(): void {
    // Clean up all fires
    for (const fireId of this.activeFires.keys()) {
      this.extinguishFire(fireId);
    }

    // Clean up pending fire models
    if (this.world.isClient) {
      for (const model of this.pendingFireModels.values()) {
        this.world.stage.scene.remove(model);
      }
    }
    this.pendingFireModels.clear();

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
