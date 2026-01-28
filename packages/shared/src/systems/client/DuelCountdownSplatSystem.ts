/**
 * DuelCountdownSplatSystem - Countdown Numbers Over Player Heads
 *
 * Displays the duel countdown (3, 2, 1, FIGHT!) as floating text
 * above both duelists' heads during the countdown phase.
 *
 * Features:
 * - Large, color-coded numbers (red 3, orange 2, yellow 1, green FIGHT!)
 * - Displays over BOTH players' heads simultaneously
 * - Animated pulse effect on each countdown tick
 * - Auto-removes after animation completes
 *
 * Architecture:
 * - Listens to DUEL_COUNTDOWN_TICK events from ClientNetwork
 * - Creates THREE.Sprite for each countdown number over each player
 * - Animates with scale punch and fade effects
 */

import THREE from "../../extras/three/three";
import { System } from "../shared/infrastructure/System";
import { EventType } from "../../types/events";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types/index";

interface CountdownSplat {
  sprite: THREE.Sprite;
  entityId: string;
  startTime: number;
  duration: number;
  baseScale: number;
}

// Color coding for countdown numbers (OSRS-style)
const COUNT_COLORS: Record<number, string> = {
  3: "#ff4444", // Red
  2: "#ff8800", // Orange
  1: "#ffcc00", // Yellow
  0: "#44ff44", // Green (FIGHT!)
};

export class DuelCountdownSplatSystem extends System {
  name = "duel-countdown-splat";

  private activeSplats: CountdownSplat[] = [];
  private readonly SPLAT_DURATION = 900; // Slightly less than 1 second to clear before next tick
  private readonly SPLAT_SIZE = 1.2; // Larger than damage splats for visibility
  private readonly HEIGHT_OFFSET = 2.5; // Height above player

  // Pre-allocated array for removal indices
  private readonly _toRemove: number[] = [];

  // Bound handler reference for cleanup
  private boundCountdownHandler: ((data: unknown) => void) | null = null;

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
    if (this.boundCountdownHandler) {
      return;
    }

    this.boundCountdownHandler = this.onCountdownTick.bind(this);
    this.world.on(
      EventType.DUEL_COUNTDOWN_TICK,
      this.boundCountdownHandler,
      this,
    );
  }

  private onCountdownTick = (data: unknown): void => {
    const payload = data as {
      duelId: string;
      count: number;
      challengerId: string;
      targetId: string;
    };

    const { count, challengerId, targetId } = payload;

    // Clear any existing splats from previous ticks
    this.clearAllSplats();

    // Create countdown splat over both players
    this.createCountdownSplat(challengerId, count);
    this.createCountdownSplat(targetId, count);
  };

  private createCountdownSplat(entityId: string, count: number): void {
    if (!this.world.stage?.scene) {
      return;
    }

    // Get entity for position
    const entity =
      this.world.entities.get(entityId) ||
      this.world.entities.players?.get(entityId);
    if (!entity?.position) {
      return;
    }

    // Create canvas for the countdown text
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const size = 512;
    canvas.width = size;
    canvas.height = size;

    // Determine display text and color
    const displayText = count === 0 ? "FIGHT!" : count.toString();
    const color = COUNT_COLORS[count] || "#ffffff";

    // Draw text with glow effect
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Outer glow
    context.shadowColor = color;
    context.shadowBlur = 30;
    context.fillStyle = color;
    context.font = count === 0 ? "bold 100px Arial" : "bold 180px Arial";
    context.fillText(displayText, size / 2, size / 2);

    // Inner glow layer
    context.shadowBlur = 15;
    context.fillText(displayText, size / 2, size / 2);

    // Solid text on top
    context.shadowBlur = 0;
    context.strokeStyle = "#000000";
    context.lineWidth = 8;
    context.strokeText(displayText, size / 2, size / 2);
    context.fillText(displayText, size / 2, size / 2);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always render on top
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(this.SPLAT_SIZE, this.SPLAT_SIZE, 1);

    // Position above the entity's head
    sprite.position.set(
      entity.position.x,
      entity.position.y + this.HEIGHT_OFFSET,
      entity.position.z,
    );

    // Add to scene
    this.world.stage.scene.add(sprite);

    // Track splat for animation
    this.activeSplats.push({
      sprite,
      entityId,
      startTime: performance.now(),
      duration: this.SPLAT_DURATION,
      baseScale: this.SPLAT_SIZE,
    });
  }

  private clearAllSplats(): void {
    for (const splat of this.activeSplats) {
      if (this.world.stage?.scene) {
        this.world.stage.scene.remove(splat.sprite);
      }
    }
    this.activeSplats = [];
  }

  update(_dt: number): void {
    if (!this.world.isClient) return;

    const now = performance.now();
    this._toRemove.length = 0;

    for (let i = 0; i < this.activeSplats.length; i++) {
      const splat = this.activeSplats[i];
      const elapsed = now - splat.startTime;
      const progress = Math.min(elapsed / splat.duration, 1);

      // Get entity for position tracking (follow the player)
      const entity =
        this.world.entities.get(splat.entityId) ||
        this.world.entities.players?.get(splat.entityId);
      if (entity?.position) {
        splat.sprite.position.x = entity.position.x;
        splat.sprite.position.y = entity.position.y + this.HEIGHT_OFFSET;
        splat.sprite.position.z = entity.position.z;
      }

      // Punch animation: scale up quickly, then settle
      let scale: number;
      if (progress < 0.15) {
        // Punch up (0 -> 0.15)
        const punchProgress = progress / 0.15;
        scale = splat.baseScale * (1 + 0.4 * punchProgress);
      } else if (progress < 0.3) {
        // Settle back (0.15 -> 0.3)
        const settleProgress = (progress - 0.15) / 0.15;
        scale = splat.baseScale * (1.4 - 0.4 * settleProgress);
      } else {
        // Hold steady, then fade
        scale = splat.baseScale;
      }
      splat.sprite.scale.set(scale, scale, 1);

      // Fade out in the last 30% of duration
      if (progress > 0.7) {
        const fadeProgress = (progress - 0.7) / 0.3;
        if (splat.sprite.material instanceof THREE.SpriteMaterial) {
          splat.sprite.material.opacity = 1 - fadeProgress;
        }
      }

      // Mark for removal when done
      if (progress >= 1) {
        if (this.world.stage?.scene) {
          this.world.stage.scene.remove(splat.sprite);
        }
        this._toRemove.push(i);
      }
    }

    // Remove completed splats (reverse order to maintain indices)
    for (let i = this._toRemove.length - 1; i >= 0; i--) {
      this.activeSplats.splice(this._toRemove[i], 1);
    }
  }

  destroy(): void {
    if (this.boundCountdownHandler) {
      this.world.off(EventType.DUEL_COUNTDOWN_TICK, this.boundCountdownHandler);
      this.boundCountdownHandler = null;
    }

    this.clearAllSplats();
    super.destroy();
  }
}
