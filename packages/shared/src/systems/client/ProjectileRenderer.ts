/**
 * ProjectileRenderer - Renders combat projectiles (arrows and spells)
 *
 * Creates visual projectiles that fly from attacker to target for ranged/magic attacks.
 * Uses THREE.Sprite for efficient rendering with proper arc trajectory for arrows
 * and straight-line path for spells.
 *
 * Features:
 * - Arrow projectiles with arc trajectory and rotation
 * - Spell projectiles with element-based coloring and trails
 * - Configurable visual properties via spell-visuals.ts
 * - Pulsing effects for stronger spells
 * - Smooth interpolation from source to target
 * - Auto-cleanup after reaching target or timeout
 *
 * Architecture:
 * - Listens to COMBAT_PROJECTILE_LAUNCHED events
 * - Creates THREE.Sprite for main projectile and trail sprites
 * - Animates with lerp interpolation
 * - Auto-removes after hit or timeout
 *
 * @see DamageSplatSystem for similar sprite-based rendering pattern
 * @see spell-visuals.ts for visual configuration
 */

import THREE from "../../extras/three/three";
import { System } from "../shared/infrastructure/System";
import { EventType } from "../../types/events";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types/index";
import {
  getSpellVisual,
  getArrowVisual,
  type SpellVisualConfig,
  type ArrowVisualConfig,
} from "../../data/spell-visuals";

/**
 * Trail sprite for spell effects
 */
interface TrailSprite {
  sprite: THREE.Sprite;
  /** Position in trail (0 = oldest, length-1 = newest) */
  index: number;
}

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
  spellId?: string;
  arrowId?: string;
  attackerId: string;
  targetId: string;
  /** Visual config for this projectile */
  visualConfig: SpellVisualConfig | ArrowVisualConfig;
  /** Trail sprites for spell effects */
  trailSprites: TrailSprite[];
  /** Previous positions for trail (circular buffer) */
  trailPositions: THREE.Vector3[];
  /** Current trail position index */
  trailIndex: number;
  /** Base rotation for arrows */
  baseRotation: number;
}

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
  private readonly TRAIL_UPDATE_INTERVAL = 16; // ~60fps trail updates

  // Pre-allocated for performance
  private readonly _toRemove: number[] = [];
  private readonly _tempVec3 = new THREE.Vector3();
  private readonly _tempVec3b = new THREE.Vector3();

  // Bound handlers for cleanup
  private boundLaunchHandler: ((data: unknown) => void) | null = null;
  private boundHitHandler: ((data: unknown) => void) | null = null;

  // Cached textures to avoid per-projectile allocation
  private arrowTextures: Map<string, THREE.Texture> = new Map();
  private spellTextures: Map<string, THREE.Texture> = new Map();
  private trailTexture: THREE.Texture | null = null;

  // Last trail update time
  private lastTrailUpdate = 0;

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
    this.createArrowTexture("default", getArrowVisual("default"));
    this.createTrailTexture();
  }

  /**
   * Create arrow texture with specific visual config
   */
  private createArrowTexture(id: string, config: ArrowVisualConfig): void {
    if (this.arrowTextures.has(id)) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 64;
    canvas.width = size;
    canvas.height = size;

    // Convert colors to CSS
    const shaftColor = `#${config.shaftColor.toString(16).padStart(6, "0")}`;
    const headColor = `#${config.headColor.toString(16).padStart(6, "0")}`;
    const fletchColor = `#${config.fletchingColor.toString(16).padStart(6, "0")}`;

    // Draw arrow shaft
    ctx.fillStyle = shaftColor;
    ctx.strokeStyle = this.darkenColor(shaftColor);
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(10, size / 2 - 2);
    ctx.lineTo(50, size / 2 - 2);
    ctx.lineTo(50, size / 2 + 2);
    ctx.lineTo(10, size / 2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Arrow head
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.moveTo(50, size / 2 - 6);
    ctx.lineTo(60, size / 2);
    ctx.lineTo(50, size / 2 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fletching
    ctx.fillStyle = fletchColor;
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

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    this.arrowTextures.set(id, texture);
  }

  /**
   * Darken a CSS color for outline
   */
  private darkenColor(color: string): string {
    const hex = color.replace("#", "");
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - 40);
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - 40);
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - 40);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  /**
   * Create spell texture with glow effect
   */
  private createSpellTexture(spellId: string, config: SpellVisualConfig): void {
    if (this.spellTextures.has(spellId)) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 64;
    canvas.width = size;
    canvas.height = size;

    // Create radial gradient for glowing orb
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );

    // Core color (bright center)
    const coreColor = config.coreColor ?? 0xffffff;
    const coreR = (coreColor >> 16) & 255;
    const coreG = (coreColor >> 8) & 255;
    const coreB = coreColor & 255;

    // Main color
    const r = (config.color >> 16) & 255;
    const g = (config.color >> 8) & 255;
    const b = config.color & 255;

    // Glow intensity affects gradient stops
    const glowIntensity = config.glowIntensity;

    gradient.addColorStop(0, `rgba(${coreR}, ${coreG}, ${coreB}, 1)`);
    gradient.addColorStop(
      0.2,
      `rgba(${r}, ${g}, ${b}, ${0.9 * glowIntensity + 0.5})`,
    );
    gradient.addColorStop(
      0.5,
      `rgba(${r}, ${g}, ${b}, ${0.6 * glowIntensity + 0.2})`,
    );
    gradient.addColorStop(
      0.8,
      `rgba(${r}, ${g}, ${b}, ${0.3 * glowIntensity})`,
    );
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    this.spellTextures.set(spellId, texture);
  }

  /**
   * Create generic trail texture (soft glow)
   */
  private createTrailTexture(): void {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 32;
    canvas.width = size;
    canvas.height = size;

    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );

    gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.4)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    this.trailTexture = new THREE.CanvasTexture(canvas);
    this.trailTexture.needsUpdate = true;
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
      arrowId?: string;
    };

    const {
      attackerId,
      targetId,
      projectileType,
      sourcePosition,
      targetPosition,
      spellId,
      arrowId,
    } = payload;

    // Determine if this is an arrow or spell
    const isSpell = projectileType !== "arrow" && spellId;
    const type = isSpell ? "spell" : "arrow";

    this.createProjectile(
      attackerId,
      targetId,
      type,
      sourcePosition,
      targetPosition,
      spellId,
      arrowId,
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
   * Create a new projectile sprite with optional trail
   */
  private createProjectile(
    attackerId: string,
    targetId: string,
    type: "arrow" | "spell",
    sourcePos: { x: number; y: number; z: number },
    targetPos: { x: number; y: number; z: number },
    spellId?: string,
    arrowId?: string,
  ): void {
    if (!this.world.stage?.scene) {
      return;
    }

    // Get visual config
    let visualConfig: SpellVisualConfig | ArrowVisualConfig;
    let texture: THREE.Texture | null = null;

    if (type === "spell" && spellId) {
      visualConfig = getSpellVisual(spellId);
      // Create texture if not cached
      if (!this.spellTextures.has(spellId)) {
        this.createSpellTexture(spellId, visualConfig as SpellVisualConfig);
      }
      texture = this.spellTextures.get(spellId) ?? null;
    } else {
      const arrowKey = arrowId ?? "default";
      visualConfig = getArrowVisual(arrowKey);
      // Create texture if not cached
      if (!this.arrowTextures.has(arrowKey)) {
        this.createArrowTexture(arrowKey, visualConfig as ArrowVisualConfig);
      }
      texture =
        this.arrowTextures.get(arrowKey) ??
        this.arrowTextures.get("default") ??
        null;
    }

    if (!texture) {
      return;
    }

    // Create main sprite
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      blending:
        type === "spell" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const sprite = new THREE.Sprite(material);
    const size = "size" in visualConfig ? visualConfig.size : 0.4;
    sprite.scale.set(size, type === "arrow" ? size * 0.25 : size, 1);

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

    // Calculate base rotation for arrows
    let baseRotation = 0;
    if (type === "arrow") {
      baseRotation = -Math.atan2(dz, dx);
      sprite.material.rotation = baseRotation;
    }

    // Add to scene
    this.world.stage.scene.add(sprite);

    // Create trail sprites for spells
    const trailSprites: TrailSprite[] = [];
    const trailPositions: THREE.Vector3[] = [];
    const spellConfig = visualConfig as SpellVisualConfig;

    if (
      type === "spell" &&
      spellConfig.trailLength &&
      spellConfig.trailLength > 0 &&
      this.trailTexture
    ) {
      const trailLength = spellConfig.trailLength;

      for (let i = 0; i < trailLength; i++) {
        const trailMaterial = new THREE.SpriteMaterial({
          map: this.trailTexture,
          transparent: true,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          color: new THREE.Color(spellConfig.color),
          opacity: 0,
        });

        const trailSprite = new THREE.Sprite(trailMaterial);
        const trailSize = size * (0.3 + (i / trailLength) * 0.4);
        trailSprite.scale.set(trailSize, trailSize, 1);
        trailSprite.position.set(sourcePos.x, startY, sourcePos.z);
        trailSprite.visible = false;

        this.world.stage.scene.add(trailSprite);
        trailSprites.push({ sprite: trailSprite, index: i });
        trailPositions.push(
          new THREE.Vector3(sourcePos.x, startY, sourcePos.z),
        );
      }
    }

    // Track projectile
    this.activeProjectiles.push({
      sprite,
      startPos: new THREE.Vector3(sourcePos.x, startY, sourcePos.z),
      endPos: new THREE.Vector3(targetPos.x, endY, targetPos.z),
      startTime: performance.now(),
      duration,
      type,
      spellId,
      arrowId,
      attackerId,
      targetId,
      visualConfig,
      trailSprites,
      trailPositions,
      trailIndex: 0,
      baseRotation,
    });
  }

  /**
   * Update projectile positions each frame
   */
  update(_dt: number): void {
    if (!this.world.isClient) return;

    const now = performance.now();
    const shouldUpdateTrail =
      now - this.lastTrailUpdate >= this.TRAIL_UPDATE_INTERVAL;
    if (shouldUpdateTrail) {
      this.lastTrailUpdate = now;
    }

    this._toRemove.length = 0;

    for (let i = 0; i < this.activeProjectiles.length; i++) {
      const proj = this.activeProjectiles[i];
      const elapsed = now - proj.startTime;
      const progress = Math.min(elapsed / proj.duration, 1);

      // Interpolate position
      this._tempVec3.lerpVectors(proj.startPos, proj.endPos, progress);

      // Add arc for arrows (parabolic trajectory)
      if (proj.type === "arrow") {
        const arrowConfig = proj.visualConfig as ArrowVisualConfig;
        const arcHeight = arrowConfig.arcHeight ?? 1.5;

        // Parabola: height = 4 * h * t * (1 - t) where h is max height
        const arcProgress = 4 * arcHeight * progress * (1 - progress);
        this._tempVec3.y += arcProgress;

        // Rotate arrow to follow arc
        if (
          progress < 1 &&
          proj.sprite.material instanceof THREE.SpriteMaterial
        ) {
          const prevY = proj.sprite.position.y;
          const dy = this._tempVec3.y - prevY;
          const horizontalDist = proj.endPos.clone().sub(proj.startPos);
          horizontalDist.y = 0;
          const horizontalSpeed = horizontalDist.length() / proj.duration;
          const pitchAngle = Math.atan2(dy, horizontalSpeed * 16 + 0.1);
          proj.sprite.material.rotation = proj.baseRotation - pitchAngle * 0.5;
        }
      } else {
        // Spell effects: pulsing
        const spellConfig = proj.visualConfig as SpellVisualConfig;
        if (spellConfig.pulseSpeed && spellConfig.pulseAmount) {
          const pulse =
            1 +
            Math.sin(elapsed * spellConfig.pulseSpeed * 0.001) *
              spellConfig.pulseAmount;
          const baseSize = spellConfig.size;
          proj.sprite.scale.set(baseSize * pulse, baseSize * pulse, 1);
        }
      }

      proj.sprite.position.copy(this._tempVec3);

      // Update trail for spells
      if (
        proj.type === "spell" &&
        proj.trailSprites.length > 0 &&
        shouldUpdateTrail
      ) {
        this.updateTrail(proj, progress);
      }

      // Fade out near end
      if (
        progress > 0.8 &&
        proj.sprite.material instanceof THREE.SpriteMaterial
      ) {
        const fadeProgress = (progress - 0.8) / 0.2;
        proj.sprite.material.opacity = 1 - fadeProgress;

        // Fade trail too
        for (const trail of proj.trailSprites) {
          if (trail.sprite.material instanceof THREE.SpriteMaterial) {
            const baseOpacity = this.getTrailOpacity(
              trail.index,
              proj.trailSprites.length,
              proj.visualConfig as SpellVisualConfig,
            );
            trail.sprite.material.opacity = baseOpacity * (1 - fadeProgress);
          }
        }
      }

      // Mark for removal when done
      if (progress >= 1) {
        this.removeProjectile(proj);
        this._toRemove.push(i);
      }
    }

    // Remove completed projectiles (reverse order)
    for (let i = this._toRemove.length - 1; i >= 0; i--) {
      this.activeProjectiles.splice(this._toRemove[i], 1);
    }
  }

  /**
   * Update trail positions for a spell projectile
   */
  private updateTrail(proj: ActiveProjectile, progress: number): void {
    const spellConfig = proj.visualConfig as SpellVisualConfig;
    const trailFade = spellConfig.trailFade ?? 0.35;

    // Store current position in trail history
    proj.trailPositions[proj.trailIndex].copy(proj.sprite.position);
    proj.trailIndex = (proj.trailIndex + 1) % proj.trailPositions.length;

    // Update trail sprites
    for (let t = 0; t < proj.trailSprites.length; t++) {
      const trail = proj.trailSprites[t];
      // Get position from history (older positions = lower index in trail)
      const historyIndex =
        (proj.trailIndex - t - 1 + proj.trailPositions.length) %
        proj.trailPositions.length;
      const trailPos = proj.trailPositions[historyIndex];

      trail.sprite.position.copy(trailPos);

      // Only show trail after we have enough history and projectile is moving
      if (progress > 0.05) {
        trail.sprite.visible = true;
        if (trail.sprite.material instanceof THREE.SpriteMaterial) {
          trail.sprite.material.opacity = this.getTrailOpacity(
            t,
            proj.trailSprites.length,
            spellConfig,
          );
        }
      }
    }
  }

  /**
   * Calculate trail sprite opacity based on position
   */
  private getTrailOpacity(
    index: number,
    total: number,
    config: SpellVisualConfig,
  ): number {
    const trailFade = config.trailFade ?? 0.35;
    // Older trail sprites (higher index) are more faded
    const position = index / total;
    return Math.max(0, (1 - position) * trailFade * config.glowIntensity);
  }

  /**
   * Remove a projectile and its trail from the scene
   */
  private removeProjectile(proj: ActiveProjectile): void {
    this.world.stage.scene.remove(proj.sprite);
    for (const trail of proj.trailSprites) {
      this.world.stage.scene.remove(trail.sprite);
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
      this.removeProjectile(proj);
    }
    this.activeProjectiles = [];

    // Clear texture caches (let GC handle actual disposal)
    this.arrowTextures.clear();
    this.spellTextures.clear();
    this.trailTexture = null;

    super.destroy();
  }
}
