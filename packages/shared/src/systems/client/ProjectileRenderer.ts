/**
 * ProjectileRenderer - Renders combat projectiles (arrows and spells)
 *
 * Creates visual projectiles that fly from attacker to target for ranged/magic attacks.
 * Uses THREE.Sprite for efficient rendering with proper arc trajectory for arrows
 * and straight-line path for spells.
 *
 * Features:
 * - Arrow projectiles with arc trajectory and rotation
 * - Spell projectiles with element-based coloring
 * - Smooth interpolation from source to target
 * - Auto-cleanup after reaching target or timeout
 *
 * Architecture:
 * - Listens to COMBAT_PROJECTILE_LAUNCHED events
 * - Creates THREE.Sprite for each projectile
 * - Animates with lerp interpolation
 * - Auto-removes after hit or timeout
 *
 * @see DamageSplatSystem for similar sprite-based rendering pattern
 */

import THREE from "../../extras/three/three";
import { System } from "../shared/infrastructure/System";
import { EventType } from "../../types/events";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types/index";

/**
 * Active projectile being rendered
 */
interface ActiveProjectile {
  sprite: THREE.Sprite;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTime: number;
  duration: number;
  type: "arrow" | "spell";
  element?: string;
  attackerId: string;
  targetId: string;
}

/**
 * Element colors for spell projectiles
 */
const SPELL_COLORS: Record<string, number> = {
  air: 0xcccccc, // Light gray/white
  water: 0x3399ff, // Blue
  earth: 0x8b4513, // Brown
  fire: 0xff4500, // Orange-red
  default: 0x9966ff, // Purple fallback
};

/**
 * ProjectileRenderer - Client-side projectile visualization
 */
export class ProjectileRenderer extends System {
  name = "projectile-renderer";

  private activeProjectiles: ActiveProjectile[] = [];

  // Projectile timing constants
  private readonly BASE_DURATION = 600; // Base flight time in ms
  private readonly DISTANCE_FACTOR = 100; // Additional ms per tile
  private readonly MAX_DURATION = 2000; // Max flight time
  private readonly ARROW_SIZE = 0.3;
  private readonly SPELL_SIZE = 0.4;
  private readonly ARC_HEIGHT = 1.5; // Maximum arc height for arrows

  // Pre-allocated for performance
  private readonly _toRemove: number[] = [];
  private readonly _tempVec3 = new THREE.Vector3();

  // Bound handlers for cleanup
  private boundLaunchHandler: ((data: unknown) => void) | null = null;
  private boundHitHandler: ((data: unknown) => void) | null = null;

  // Cached textures to avoid per-projectile allocation
  private arrowTexture: THREE.Texture | null = null;
  private spellTextures: Map<string, THREE.Texture> = new Map();

  constructor(world: World) {
    super(world);
  }

  async init(options?: WorldOptions): Promise<void> {
    await super.init(options as WorldOptions);

    // Only run on client
    if (!this.world.isClient) {
      return;
    }

    // Prevent duplicate subscriptions
    if (this.boundLaunchHandler) {
      return;
    }

    // Create bound handlers
    this.boundLaunchHandler = this.onProjectileLaunched.bind(this);
    this.boundHitHandler = this.onProjectileHit.bind(this);

    // Listen for projectile events
    this.world.on(
      EventType.COMBAT_PROJECTILE_LAUNCHED,
      this.boundLaunchHandler,
      this,
    );
    this.world.on(EventType.COMBAT_PROJECTILE_HIT, this.boundHitHandler, this);

    // Pre-create textures
    this.createArrowTexture();
    this.createSpellTextures();
  }

  /**
   * Create reusable arrow texture
   */
  private createArrowTexture(): void {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 64;
    canvas.width = size;
    canvas.height = size;

    // Draw simple arrow shape
    ctx.fillStyle = "#8B4513"; // Brown wood color
    ctx.strokeStyle = "#4a3728";
    ctx.lineWidth = 2;

    // Arrow body (shaft)
    ctx.beginPath();
    ctx.moveTo(10, size / 2 - 2);
    ctx.lineTo(50, size / 2 - 2);
    ctx.lineTo(50, size / 2 + 2);
    ctx.lineTo(10, size / 2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Arrow head (metal)
    ctx.fillStyle = "#A0A0A0";
    ctx.beginPath();
    ctx.moveTo(50, size / 2 - 6);
    ctx.lineTo(60, size / 2);
    ctx.lineTo(50, size / 2 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fletching (feathers)
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(10, size / 2 - 2);
    ctx.lineTo(4, size / 2 - 8);
    ctx.lineTo(16, size / 2 - 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(10, size / 2 + 2);
    ctx.lineTo(4, size / 2 + 8);
    ctx.lineTo(16, size / 2 + 2);
    ctx.closePath();
    ctx.fill();

    this.arrowTexture = new THREE.CanvasTexture(canvas);
    this.arrowTexture.needsUpdate = true;
  }

  /**
   * Create reusable spell textures for each element
   */
  private createSpellTextures(): void {
    for (const [element, color] of Object.entries(SPELL_COLORS)) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const size = 64;
      canvas.width = size;
      canvas.height = size;

      // Draw glowing orb
      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );

      // Convert hex color to RGB for gradient
      const r = (color >> 16) & 255;
      const g = (color >> 8) & 255;
      const b = color & 255;

      gradient.addColorStop(0, `rgba(255, 255, 255, 1)`);
      gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.9)`);
      gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.5)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      this.spellTextures.set(element, texture);
    }
  }

  /**
   * Handle projectile launch event
   */
  private onProjectileLaunched = (data: unknown): void => {
    const payload = data as {
      attackerId: string;
      targetId: string;
      projectileType: string;
      sourcePosition: { x: number; y: number; z: number };
      targetPosition: { x: number; y: number; z: number };
      spellId?: string;
    };

    const {
      attackerId,
      targetId,
      projectileType,
      sourcePosition,
      targetPosition,
      spellId,
    } = payload;

    // Determine if this is an arrow or spell
    const isSpell = projectileType !== "arrow" && spellId;
    const type = isSpell ? "spell" : "arrow";

    // Get element from spell ID or projectile type
    let element = "default";
    if (isSpell && spellId) {
      if (spellId.includes("wind") || spellId.includes("air")) element = "air";
      else if (spellId.includes("water")) element = "water";
      else if (spellId.includes("earth")) element = "earth";
      else if (spellId.includes("fire")) element = "fire";
    } else if (projectileType && projectileType !== "arrow") {
      element = projectileType;
    }

    this.createProjectile(
      attackerId,
      targetId,
      type,
      sourcePosition,
      targetPosition,
      element,
    );
  };

  /**
   * Handle projectile hit event - remove projectile early if still in flight
   */
  private onProjectileHit = (data: unknown): void => {
    const payload = data as {
      attackerId: string;
      targetId: string;
    };

    // Find and mark for removal any projectile matching this attacker/target
    for (let i = 0; i < this.activeProjectiles.length; i++) {
      const proj = this.activeProjectiles[i];
      if (
        proj.attackerId === payload.attackerId &&
        proj.targetId === payload.targetId
      ) {
        // Set duration to 0 to remove on next update
        proj.duration = 0;
      }
    }
  };

  /**
   * Create a new projectile sprite
   */
  private createProjectile(
    attackerId: string,
    targetId: string,
    type: "arrow" | "spell",
    sourcePos: { x: number; y: number; z: number },
    targetPos: { x: number; y: number; z: number },
    element: string,
  ): void {
    if (!this.world.stage?.scene) {
      return;
    }

    // Get texture
    let texture: THREE.Texture | null = null;
    if (type === "arrow") {
      texture = this.arrowTexture;
    } else {
      texture =
        this.spellTextures.get(element) ??
        this.spellTextures.get("default") ??
        null;
    }

    if (!texture) {
      return;
    }

    // Create sprite
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      blending:
        type === "spell" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const sprite = new THREE.Sprite(material);
    const size = type === "arrow" ? this.ARROW_SIZE : this.SPELL_SIZE;
    sprite.scale.set(size, size * 0.5, 1);

    // Calculate duration based on distance
    const dx = targetPos.x - sourcePos.x;
    const dz = targetPos.z - sourcePos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const duration = Math.min(
      this.BASE_DURATION + distance * this.DISTANCE_FACTOR,
      this.MAX_DURATION,
    );

    // Set initial position (slightly above ground)
    const startY = sourcePos.y + 1.2;
    const endY = targetPos.y + 1.0;

    sprite.position.set(sourcePos.x, startY, sourcePos.z);

    // Rotate arrow to face target
    if (type === "arrow") {
      const angle = Math.atan2(dz, dx);
      sprite.material.rotation = -angle;
    }

    // Add to scene
    this.world.stage.scene.add(sprite);

    // Track projectile
    this.activeProjectiles.push({
      sprite,
      startPos: new THREE.Vector3(sourcePos.x, startY, sourcePos.z),
      endPos: new THREE.Vector3(targetPos.x, endY, targetPos.z),
      startTime: performance.now(),
      duration,
      type,
      element,
      attackerId,
      targetId,
    });
  }

  /**
   * Update projectile positions each frame
   */
  update(_dt: number): void {
    if (!this.world.isClient) return;

    const now = performance.now();
    this._toRemove.length = 0;

    for (let i = 0; i < this.activeProjectiles.length; i++) {
      const proj = this.activeProjectiles[i];
      const elapsed = now - proj.startTime;
      const progress = Math.min(elapsed / proj.duration, 1);

      // Interpolate position
      this._tempVec3.lerpVectors(proj.startPos, proj.endPos, progress);

      // Add arc for arrows (parabolic trajectory)
      if (proj.type === "arrow") {
        // Parabola: height = 4 * h * t * (1 - t) where h is max height
        const arcProgress = 4 * this.ARC_HEIGHT * progress * (1 - progress);
        this._tempVec3.y += arcProgress;

        // Rotate arrow to follow arc
        if (
          progress < 1 &&
          proj.sprite.material instanceof THREE.SpriteMaterial
        ) {
          const prevY = proj.sprite.position.y;
          const dy = this._tempVec3.y - prevY;
          const dx =
            (proj.endPos.x - proj.startPos.x) * (elapsed / proj.duration);
          const pitchAngle = Math.atan2(dy, Math.abs(dx) + 0.1);
          // Arrow rotation is already set for horizontal direction
          // Add slight pitch based on arc
          proj.sprite.material.rotation += pitchAngle * 0.1;
        }
      }

      proj.sprite.position.copy(this._tempVec3);

      // Fade out near end
      if (
        progress > 0.8 &&
        proj.sprite.material instanceof THREE.SpriteMaterial
      ) {
        proj.sprite.material.opacity = 1 - (progress - 0.8) / 0.2;
      }

      // Mark for removal when done
      if (progress >= 1) {
        this.world.stage.scene.remove(proj.sprite);
        this._toRemove.push(i);
      }
    }

    // Remove completed projectiles (reverse order)
    for (let i = this._toRemove.length - 1; i >= 0; i--) {
      this.activeProjectiles.splice(this._toRemove[i], 1);
    }
  }

  destroy(): void {
    // Remove event listeners
    if (this.boundLaunchHandler) {
      this.world.off(
        EventType.COMBAT_PROJECTILE_LAUNCHED,
        this.boundLaunchHandler,
      );
      this.boundLaunchHandler = null;
    }
    if (this.boundHitHandler) {
      this.world.off(EventType.COMBAT_PROJECTILE_HIT, this.boundHitHandler);
      this.boundHitHandler = null;
    }

    // Clean up active projectiles
    for (const proj of this.activeProjectiles) {
      this.world.stage.scene.remove(proj.sprite);
    }
    this.activeProjectiles = [];

    // Clear texture caches (let GC handle actual disposal)
    this.arrowTexture = null;
    this.spellTextures.clear();

    super.destroy();
  }
}
