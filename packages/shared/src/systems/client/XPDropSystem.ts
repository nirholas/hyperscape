/**
 * XPDropSystem - RuneScape 3-style XP Drops
 *
 * Creates visual XP numbers that float up from the player when experience is gained.
 * Mimics RuneScape 3's iconic XP drop feedback system.
 *
 * Features:
 * - Gold/yellow XP text with skill icon
 * - Floating animation (rises up and fades out)
 * - Positioned above the player entity
 * - Shows format: "🪓 +35" (icon + amount)
 *
 * Architecture:
 * - Listens to XP_DROP_RECEIVED events from ClientNetwork
 * - Creates THREE.Sprite for each XP drop
 * - Animates with cubic ease-out and fadeout
 * - Auto-removes after animation completes
 */

import THREE from "../../extras/three/three";
import { System } from "../shared/infrastructure/System";
import { EventType } from "../../types/events";
import { SKILL_ICONS } from "../../data/skill-icons";
import type { World } from "../../core/World";

interface XPDrop {
  sprite: THREE.Sprite;
  startTime: number;
  duration: number;
  startY: number;
  riseDistance: number;
}

export class XPDropSystem extends System {
  name = "xp-drop";

  private activeDrops: XPDrop[] = [];
  private readonly DROP_DURATION = 2000; // 2 seconds
  private readonly RISE_DISTANCE = 2.5; // Units to float upward
  private readonly DROP_SIZE = 0.5; // Size of the XP drop sprite

  constructor(world: World) {
    super(world);
  }

  async init(): Promise<void> {
    // Only run on client
    if (!this.world.isClient) {
      return;
    }

    // Listen for XP drop events
    this.world.on(EventType.XP_DROP_RECEIVED, this.onXPDrop.bind(this), this);
  }

  private onXPDrop = (data: unknown): void => {
    const payload = data as {
      skill: string;
      xpGained: number;
      newXp: number;
      newLevel: number;
      position: { x: number; y: number; z: number };
    };

    this.createXPDrop(payload.skill, payload.xpGained, payload.position);
  };

  private createXPDrop(
    skill: string,
    xpGained: number,
    position: { x: number; y: number; z: number },
  ): void {
    // Check if scene is available
    if (!this.world.stage?.scene) {
      return;
    }

    // Create canvas for the XP number
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const size = 256;
    canvas.width = size;
    canvas.height = size;

    // RS3-style gold/yellow theme
    const bgColor = "rgba(0, 0, 0, 0.6)";
    const textColor = "#FFD700"; // Gold
    const borderColor = "#FFA500"; // Orange border

    // Draw rounded rectangle background
    context.fillStyle = bgColor;
    this.roundRect(context, 10, 80, 236, 96, 12);
    context.fill();

    // Add gold border
    context.strokeStyle = borderColor;
    context.lineWidth = 3;
    this.roundRect(context, 10, 80, 236, 96, 12);
    context.stroke();

    // Get skill icon
    const icon = SKILL_ICONS[skill.toLowerCase()] || "⭐";

    // Draw XP text with icon
    context.fillStyle = textColor;
    context.font = "bold 48px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Format: "🪓 +35"
    const xpText = `${icon} +${xpGained}`;
    context.fillText(xpText, size / 2, size / 2);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always render on top
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(this.DROP_SIZE, this.DROP_SIZE, 1);

    // Position above the player (add small random offset to prevent overlap)
    const offsetX = (Math.random() - 0.5) * 0.2;
    sprite.position.set(
      position.x + offsetX,
      position.y + 2.0, // Higher start than damage splats
      position.z,
    );

    // Add to scene
    this.world.stage.scene.add(sprite);

    // Track drop for animation
    this.activeDrops.push({
      sprite,
      startTime: performance.now(),
      duration: this.DROP_DURATION,
      startY: sprite.position.y,
      riseDistance: this.RISE_DISTANCE,
    });
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  update(_dt: number): void {
    if (!this.world.isClient) return;

    const now = performance.now();
    const toRemove: number[] = [];

    // Animate all active drops
    for (let i = 0; i < this.activeDrops.length; i++) {
      const drop = this.activeDrops[i];
      const elapsed = now - drop.startTime;
      const progress = Math.min(elapsed / drop.duration, 1);

      // Float upward with cubic ease-out
      const easeOut = 1 - Math.pow(1 - progress, 3);
      drop.sprite.position.y = drop.startY + easeOut * drop.riseDistance;

      // Fade out in last 30% of animation
      if (drop.sprite.material instanceof THREE.SpriteMaterial) {
        if (progress > 0.7) {
          const fadeProgress = (progress - 0.7) / 0.3;
          drop.sprite.material.opacity = 1 - fadeProgress;
        }
      }

      // Mark for removal when done
      if (progress >= 1) {
        this.world.stage.scene.remove(drop.sprite);
        drop.sprite.material.dispose();
        if (drop.sprite.material.map) {
          drop.sprite.material.map.dispose();
        }
        toRemove.push(i);
      }
    }

    // Remove completed drops (reverse order to maintain indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.activeDrops.splice(toRemove[i], 1);
    }
  }

  destroy(): void {
    // Clean up all active drops
    for (const drop of this.activeDrops) {
      this.world.stage.scene.remove(drop.sprite);
      drop.sprite.material.dispose();
      if (drop.sprite.material.map) {
        drop.sprite.material.map.dispose();
      }
    }
    this.activeDrops = [];
  }
}
