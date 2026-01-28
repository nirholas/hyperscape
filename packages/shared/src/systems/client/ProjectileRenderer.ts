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
  /** Main visual - sprite for spells, Group for arrows */
  sprite: THREE.Sprite | THREE.Group;
  /** Current position of projectile */
  currentPos: THREE.Vector3;
  /** Starting position (for arc calculation) */
  startPos: THREE.Vector3;
  /** Target position (updated each frame for tracking) */
  targetPos: THREE.Vector3;
  /** Total distance from start to original target (for arc calculation) */
  totalDistance: number;
  /** Distance traveled so far */
  distanceTraveled: number;
  /** Movement speed in units per second */
  speed: number;
  /** Max lifetime in ms (safety timeout) */
  maxLifetime: number;
  startTime: number;
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
}

/**
 * ProjectileRenderer - Client-side projectile visualization
 */
export class ProjectileRenderer extends System {
  name = "projectile-renderer";

  private activeProjectiles: ActiveProjectile[] = [];

  // Projectile movement constants
  private readonly PROJECTILE_SPEED = 12; // Units per second (tiles ~= 1 unit)
  private readonly ARROW_SPEED = 15; // Arrows are slightly faster
  private readonly HIT_THRESHOLD = 0.5; // Distance to consider projectile "hit"
  private readonly MAX_LIFETIME = 5000; // Safety timeout in ms
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
   * Draws a clear arrow shape: line shaft with triangular head
   */
  private createArrowTexture(id: string, config: ArrowVisualConfig): void {
    if (this.arrowTextures.has(id)) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use larger canvas for better detail
    const width = 128;
    const height = 32;
    canvas.width = width;
    canvas.height = height;

    const centerY = height / 2;

    // Convert colors to CSS
    const shaftColor = `#${config.shaftColor.toString(16).padStart(6, "0")}`;
    const headColor = `#${config.headColor.toString(16).padStart(6, "0")}`;
    const fletchColor = `#${config.fletchingColor.toString(16).padStart(6, "0")}`;

    // Clear with transparency
    ctx.clearRect(0, 0, width, height);

    // Draw fletching (feathers at back) - small diagonal lines
    ctx.strokeStyle = fletchColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, centerY - 8);
    ctx.lineTo(16, centerY);
    ctx.lineTo(8, centerY + 8);
    ctx.stroke();

    // Draw arrow shaft (thick line)
    ctx.strokeStyle = shaftColor;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(12, centerY);
    ctx.lineTo(95, centerY);
    ctx.stroke();

    // Add darker outline to shaft for visibility
    ctx.strokeStyle = this.darkenColor(shaftColor);
    ctx.lineWidth = 6;
    ctx.globalCompositeOperation = "destination-over";
    ctx.beginPath();
    ctx.moveTo(12, centerY);
    ctx.lineTo(95, centerY);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Draw arrowhead (filled triangle pointing right)
    ctx.fillStyle = headColor;
    ctx.strokeStyle = this.darkenColor(headColor);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, centerY - 10);
    ctx.lineTo(120, centerY);
    ctx.lineTo(90, centerY + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    this.arrowTextures.set(id, texture);
  }

  /**
   * Create a 3D arrow mesh (shaft + head) that can be oriented with lookAt()
   * The arrow points along +Z axis by default
   */
  private create3DArrow(config: ArrowVisualConfig): THREE.Group {
    const group = new THREE.Group();

    const shaftLength = config.length * 0.7;
    const headLength = config.length * 0.3;
    const shaftRadius = config.width * 0.15;
    const headRadius = config.width * 0.4;

    // Convert colors
    const shaftColor = config.shaftColor;
    const headColor = config.headColor;

    // Shaft (cylinder along Z axis)
    const shaftGeometry = new THREE.CylinderGeometry(
      shaftRadius,
      shaftRadius,
      shaftLength,
      8,
    );
    // Rotate to point along Z and offset so end is at origin
    shaftGeometry.rotateX(Math.PI / 2);
    shaftGeometry.translate(0, 0, -shaftLength / 2 - headLength / 2);

    const shaftMaterial = new THREE.MeshBasicMaterial({ color: shaftColor });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    group.add(shaft);

    // Arrowhead (cone pointing along +Z)
    const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);
    // Rotate so cone points along +Z
    headGeometry.rotateX(Math.PI / 2);

    const headMaterial = new THREE.MeshBasicMaterial({ color: headColor });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    group.add(head);

    return group;
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
   * Type guard for projectile launch event payload
   */
  private isValidLaunchPayload(data: unknown): data is {
    attackerId: string;
    targetId: string;
    projectileType: string;
    sourcePosition: { x: number; y: number; z: number };
    targetPosition: { x: number; y: number; z: number };
    spellId?: string;
    arrowId?: string;
    delayMs?: number;
  } {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;

    // Required string fields
    if (typeof d.attackerId !== "string" || d.attackerId.length === 0)
      return false;
    if (typeof d.targetId !== "string" || d.targetId.length === 0) return false;
    if (typeof d.projectileType !== "string") return false;

    // Required position objects
    if (!this.isValidPosition(d.sourcePosition)) return false;
    if (!this.isValidPosition(d.targetPosition)) return false;

    // Optional fields - validate if present
    if (d.spellId !== undefined && typeof d.spellId !== "string") return false;
    if (d.arrowId !== undefined && typeof d.arrowId !== "string") return false;
    if (d.delayMs !== undefined && typeof d.delayMs !== "number") return false;

    return true;
  }

  /**
   * Type guard for position object
   */
  private isValidPosition(
    pos: unknown,
  ): pos is { x: number; y: number; z: number } {
    if (typeof pos !== "object" || pos === null) return false;
    const p = pos as Record<string, unknown>;
    return (
      typeof p.x === "number" &&
      typeof p.y === "number" &&
      typeof p.z === "number"
    );
  }

  /**
   * Type guard for projectile hit event payload
   */
  private isValidHitPayload(
    data: unknown,
  ): data is { attackerId: string; targetId: string } {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.attackerId === "string" &&
      d.attackerId.length > 0 &&
      typeof d.targetId === "string" &&
      d.targetId.length > 0
    );
  }

  /**
   * Handle projectile launch event
   */
  private onProjectileLaunched = (data: unknown): void => {
    // Validate payload structure before use
    if (!this.isValidLaunchPayload(data)) {
      return;
    }

    const {
      attackerId,
      targetId,
      projectileType,
      sourcePosition,
      targetPosition,
      spellId,
      arrowId,
      delayMs,
    } = data;

    // Determine if this is an arrow or spell
    const isSpell = projectileType !== "arrow" && spellId;
    const type = isSpell ? "spell" : "arrow";

    // If there's a delay (e.g., for magic cast animation), wait before spawning
    if (delayMs && delayMs > 0) {
      setTimeout(() => {
        this.createProjectile(
          attackerId,
          targetId,
          type,
          sourcePosition,
          targetPosition,
          spellId,
          arrowId,
        );
      }, delayMs);
    } else {
      this.createProjectile(
        attackerId,
        targetId,
        type,
        sourcePosition,
        targetPosition,
        spellId,
        arrowId,
      );
    }
  };

  /**
   * Handle projectile hit event - remove projectile early if still in flight
   */
  private onProjectileHit = (data: unknown): void => {
    // Validate payload structure before use
    if (!this.isValidHitPayload(data)) {
      return;
    }

    // Find and mark for removal any projectile matching this attacker/target
    for (let i = 0; i < this.activeProjectiles.length; i++) {
      const proj = this.activeProjectiles[i];
      if (
        proj.attackerId === data.attackerId &&
        proj.targetId === data.targetId
      ) {
        // Set maxLifetime to 0 to remove on next update
        proj.maxLifetime = 0;
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

    // Set initial position (slightly above ground)
    const startY = sourcePos.y + 1.2;
    const endY = targetPos.y + 1.0;

    // Calculate initial distance for arc calculation
    const dx = targetPos.x - sourcePos.x;
    const dz = targetPos.z - sourcePos.z;
    const totalDistance = Math.sqrt(dx * dx + dz * dz);

    // Get visual config
    let visualConfig: SpellVisualConfig | ArrowVisualConfig;
    let projectileObject: THREE.Sprite | THREE.Group;

    if (type === "arrow") {
      // Create 3D arrow mesh that naturally points toward target
      const arrowKey = arrowId ?? "default";
      visualConfig = getArrowVisual(arrowKey);
      const arrowConfig = visualConfig as ArrowVisualConfig;

      projectileObject = this.create3DArrow(arrowConfig);
      projectileObject.position.set(sourcePos.x, startY, sourcePos.z);

      // Point arrow toward target using lookAt
      const targetPoint = new THREE.Vector3(targetPos.x, endY, targetPos.z);
      projectileObject.lookAt(targetPoint);
    } else {
      // Create spell sprite
      visualConfig = getSpellVisual(spellId ?? "");
      const spellConfig = visualConfig as SpellVisualConfig;

      // Create texture if not cached
      if (spellId && !this.spellTextures.has(spellId)) {
        this.createSpellTexture(spellId, spellConfig);
      }
      const texture = spellId
        ? (this.spellTextures.get(spellId) ?? null)
        : null;

      if (!texture) {
        return;
      }

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(spellConfig.size, spellConfig.size, 1);
      sprite.position.set(sourcePos.x, startY, sourcePos.z);
      projectileObject = sprite;
    }

    // Add to scene
    this.world.stage.scene.add(projectileObject);

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
        const trailSize = spellConfig.size * (0.3 + (i / trailLength) * 0.4);
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

    // Track projectile with speed-based movement
    const speed = type === "arrow" ? this.ARROW_SPEED : this.PROJECTILE_SPEED;

    this.activeProjectiles.push({
      sprite: projectileObject,
      currentPos: new THREE.Vector3(sourcePos.x, startY, sourcePos.z),
      startPos: new THREE.Vector3(sourcePos.x, startY, sourcePos.z),
      targetPos: new THREE.Vector3(targetPos.x, endY, targetPos.z),
      totalDistance,
      distanceTraveled: 0,
      speed,
      maxLifetime: this.MAX_LIFETIME,
      startTime: performance.now(),
      type,
      spellId,
      arrowId,
      attackerId,
      targetId,
      visualConfig,
      trailSprites,
      trailPositions,
      trailIndex: 0,
    });
  }

  /**
   * Get current position of a target entity (mob or player)
   * Uses same pattern as DamageSplatSystem for reliable entity lookup
   */
  private getTargetPosition(targetId: string, outVec: THREE.Vector3): boolean {
    // Use world.entities.get() - works for both mobs and players on client
    const target = this.world.entities?.get(targetId) as {
      position?: { x: number; y: number; z: number };
    } | null;

    if (target?.position) {
      outVec.set(target.position.x, target.position.y + 1.0, target.position.z);
      return true;
    }

    return false;
  }

  /**
   * Update projectile positions each frame using speed-based homing
   */
  update(dt: number): void {
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

      // Safety timeout
      if (elapsed > proj.maxLifetime) {
        this.removeProjectile(proj);
        this._toRemove.push(i);
        continue;
      }

      // Track moving target - update targetPos with current target position
      this.getTargetPosition(proj.targetId, proj.targetPos);

      // Calculate direction to target
      this._tempVec3.copy(proj.targetPos).sub(proj.currentPos);
      const distanceToTarget = this._tempVec3.length();

      // Check if we've hit the target
      if (distanceToTarget < this.HIT_THRESHOLD) {
        this.removeProjectile(proj);
        this._toRemove.push(i);
        continue;
      }

      // Normalize direction and move at constant speed
      this._tempVec3.normalize();
      const moveDistance = proj.speed * dt;
      proj.distanceTraveled += moveDistance;

      // Move toward target
      proj.currentPos.addScaledVector(this._tempVec3, moveDistance);

      // For arrows, add arc based on progress through total flight
      if (proj.type === "arrow" && proj.totalDistance > 0) {
        const arrowConfig = proj.visualConfig as ArrowVisualConfig;
        const arcHeight = arrowConfig.arcHeight ?? 1.5;

        // Progress based on distance traveled vs total distance
        const progress = Math.min(
          proj.distanceTraveled / proj.totalDistance,
          1,
        );

        // Parabolic arc: height = 4 * h * t * (1 - t)
        const arcOffset = 4 * arcHeight * progress * (1 - progress);

        // Set position with arc
        proj.sprite.position.set(
          proj.currentPos.x,
          proj.currentPos.y + arcOffset,
          proj.currentPos.z,
        );

        // Point arrow toward target
        if (proj.sprite instanceof THREE.Group) {
          proj.sprite.lookAt(proj.targetPos);
        }
      } else {
        // Spell - direct movement, no arc
        proj.sprite.position.copy(proj.currentPos);

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

      // Update trail for spells
      if (
        proj.type === "spell" &&
        proj.trailSprites.length > 0 &&
        shouldUpdateTrail
      ) {
        // Progress approximation for trail opacity
        const progress =
          proj.totalDistance > 0
            ? Math.min(proj.distanceTraveled / proj.totalDistance, 1)
            : 0.5;
        this.updateTrail(proj, progress);
      }

      // Fade out when very close to target
      if (distanceToTarget < this.HIT_THRESHOLD * 3) {
        const fadeProgress = 1 - distanceToTarget / (this.HIT_THRESHOLD * 3);

        if (proj.sprite instanceof THREE.Sprite) {
          if (proj.sprite.material instanceof THREE.SpriteMaterial) {
            proj.sprite.material.opacity = 1 - fadeProgress;
          }

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
        } else if (proj.sprite instanceof THREE.Group) {
          proj.sprite.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
              const mat = child.material as THREE.MeshBasicMaterial;
              mat.transparent = true;
              mat.opacity = 1 - fadeProgress;
            }
          });
        }
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
