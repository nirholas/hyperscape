/**
 * ResourceEntity - Harvestable Resource Entity
 *
 * Represents gatherable resources in the world like trees, rocks, and fishing spots.
 * Players can interact with these to gather materials and gain experience.
 *
 * **Extends**: InteractableEntity (players can harvest resources)
 *
 * **Key Features**:
 *
 * **Resource Types**:
 * - **Trees**: Woodcutting skill (logs, wood)
 * - **Rocks**: Mining skill (ores, gems)
 * - **Fish**: Fishing skill (fish, treasure)
 * - **Herbs**: Herbalism skill (herbs, flowers)
 *
 * **Harvesting System**:
 * - Skill level requirements (can't harvest high-level resources without skill)
 * - Harvest time based on resource and skill level
 * - Resource depletion after harvesting
 * - Respawn timer after depletion
 * - XP rewards based on resource level
 *
 * **Resource State**:
 * - Available: Can be harvested
 * - Depleted: Recently harvested, waiting to respawn
 * - Respawning: Timer counting down to availability
 *
 * **Yield System**:
 * - Item drops on successful harvest
 * - Quantity randomization
 * - Quality based on skill level
 * - Rare resource chances
 *
 * **Visual Feedback**:
 * - Different appearance when depleted
 * - Particle effects on harvest
 * - Interaction prompt shows requirements
 * - Harvest progress bar
 *
 * **Network Sync**:
 * - Resource state broadcasted to all clients
 * - Depletion events trigger visual changes
 * - Respawn events restore resource
 *
 * **Runs on**: Server (authoritative), Client (visual + interaction)
 * **Referenced by**: ResourceSystem, InteractionSystem, SkillsSystem
 *
 * @public
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import type { EntityData } from "../../types";
import {
  InteractableEntity,
  type InteractableConfig,
} from "../InteractableEntity";
import type {
  EntityInteractionData,
  ResourceEntityConfig,
} from "../../types/entities";
import { modelCache } from "../../utils/rendering/ModelCache";
import { EventType } from "../../types/events";
import { CollisionFlag } from "../../systems/shared/movement/CollisionFlags";
import {
  worldToTile,
  type TileCoord,
} from "../../systems/shared/movement/TileSystem";
import { FOOTPRINT_SIZES } from "../../types/game/resource-processing-types";

// Re-export types for external use
export type { ResourceEntityConfig } from "../../types/entities";

export class ResourceEntity extends InteractableEntity {
  public config: ResourceEntityConfig;
  private respawnTimer?: NodeJS.Timeout;
  /** Glow indicator mesh for fishing spot visibility from distance (client-only) */
  private glowMesh?: THREE.Mesh;
  /** Ripple rings for animated fishing spot effect (client-only) */
  private rippleRings?: THREE.Mesh[];
  /** Animation frame ID for cleanup */
  private animationFrameId?: number;
  /** Tiles this resource occupies for collision (cached for cleanup) */
  private collisionTiles: TileCoord[] = [];

  constructor(world: World, config: ResourceEntityConfig) {
    // Convert ResourceEntityConfig to InteractableConfig format
    const interactableConfig: InteractableConfig = {
      ...config,
      interaction: {
        prompt: `${config.harvestSkill} ${config.resourceType}`,
        description: `${config.resourceType} - Level ${config.requiredLevel} ${config.harvestSkill} required`,
        range: 2.0,
        cooldown: config.harvestTime || 3000,
        usesRemaining: config.depleted ? 0 : -1, // -1 = unlimited uses until depleted
        maxUses: -1,
        effect: "harvest",
      },
    };

    super(world, interactableConfig);
    this.config = {
      ...config,
      depleted: config.depleted !== undefined ? config.depleted : false,
      lastHarvestTime:
        config.lastHarvestTime !== undefined ? config.lastHarvestTime : 0,
    };

    // Resources don't have health bars - they're not combatants
    this.health = 0;
    this.maxHealth = 0;

    // Register collision for this resource (server-side only)
    // Fishing spots don't block movement - they're in water
    if (this.world.isServer && config.resourceType !== "fishing_spot") {
      this.registerCollision();
    }
  }

  /**
   * Register this resource's tiles in the collision matrix.
   * Called on construction, tiles remain blocked even when depleted (OSRS-accurate).
   * Uses center-based registration (footprint centered on entity position) for
   * consistency with station entities and tilesWithinRangeOfFootprint() checks.
   */
  private registerCollision(): void {
    // Get center tile from world position
    const centerTile = worldToTile(this.position.x, this.position.z);

    // Get footprint size (defaults to standard 1x1)
    const footprint = this.config.footprint || "standard";
    const size = FOOTPRINT_SIZES[footprint];

    // Calculate offset to center the footprint on the entity
    const offsetX = Math.floor(size.x / 2);
    const offsetZ = Math.floor(size.z / 2);

    // Calculate all tiles this resource occupies (centered on position)
    this.collisionTiles = [];
    for (let dx = 0; dx < size.x; dx++) {
      for (let dz = 0; dz < size.z; dz++) {
        this.collisionTiles.push({
          x: centerTile.x + dx - offsetX,
          z: centerTile.z + dz - offsetZ,
        });
      }
    }

    // Store in config for potential serialization
    this.config.anchorTile = centerTile;
    this.config.occupiedTiles = this.collisionTiles;

    // Add BLOCKED flag to all tiles
    for (const tile of this.collisionTiles) {
      this.world.collision.addFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
    }
  }

  /**
   * Unregister this resource's tiles from the collision matrix.
   * Called on destroy.
   */
  private unregisterCollision(): void {
    for (const tile of this.collisionTiles) {
      this.world.collision.removeFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
    }
    this.collisionTiles = [];
  }

  /**
   * Handle resource interaction - implements InteractableEntity.handleInteraction
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    // Default to harvest interaction if not specified
    if (data.interactionType && data.interactionType !== "harvest") return;

    // Check if resource is depleted
    if (this.config.depleted) {
      return;
    }

    // Send harvest request to resource system
    this.world.emit(EventType.RESOURCE_HARVEST_REQUEST, {
      playerId: data.playerId,
      entityId: this.id,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
    });
  }

  public deplete(): void {
    if (!this.world.isServer) return;

    this.config.depleted = true;
    this.config.lastHarvestTime = Date.now();
    this.markNetworkDirty();

    // Update interaction component to show as depleted
    const interactionComponent = this.getComponent("interaction");
    if (interactionComponent) {
      interactionComponent.data.interactable = false;
      interactionComponent.data.description = `${this.config.resourceType} - Depleted`;
    }

    // Clear any existing timer
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
    }

    // Schedule respawn with tracked timer to prevent memory leaks
    this.respawnTimer = setTimeout(() => {
      this.respawn();
      this.respawnTimer = undefined;
    }, this.config.respawnTime);
  }

  public respawn(): void {
    if (!this.world.isServer) return;

    this.config.depleted = false;
    this.markNetworkDirty();

    // Update interaction component to show as available again
    const interactionComponent = this.getComponent("interaction");
    if (interactionComponent) {
      interactionComponent.data.interactable = true;
      interactionComponent.data.description = `${this.config.resourceType} - Level ${this.config.requiredLevel} ${this.config.harvestSkill} required`;
    }
  }

  private async swapToStump(): Promise<void> {
    if (this.world.isServer || !this.node) return;

    // Check if this resource has a depleted model configured
    // Trees have stumps, rocks have depleted rock models, etc.
    const depletedModelPath = this.config.depletedModelPath;

    // If no depleted model path, just hide the current mesh
    if (!depletedModelPath) {
      if (this.mesh) {
        this.mesh.visible = false;
      }
      return;
    }

    // Remove current mesh
    if (this.mesh) {
      this.node.remove(this.mesh);
      this.mesh = null;
    }
    try {
      const { scene } = await modelCache.loadModel(
        depletedModelPath,
        this.world,
      );

      this.mesh = scene;
      this.mesh.name = `ResourceDepleted_${this.config.resourceType}`;

      // Use scale from config (set by manifest) or fallback to default
      // Apply uniform scale directly (simplified approach matching FurnaceEntity)
      const modelScale = this.config.depletedModelScale ?? 0.3;
      this.mesh.scale.set(modelScale, modelScale, modelScale);

      // Set layers and enable shadows (simple traverse, no scale manipulation)
      this.mesh.layers.set(1);
      this.mesh.traverse((child) => {
        child.layers.set(1);
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Set up userData
      this.mesh.userData = {
        type: "resource",
        entityId: this.id,
        name: `${this.config.name} (Depleted)`,
        interactable: false,
        resourceType: this.config.resourceType,
        depleted: true,
      };

      // Align depleted model to ground (same as createMesh)
      const bbox = new THREE.Box3().setFromObject(this.mesh);
      const minY = bbox.min.y;
      this.mesh.position.set(0, -minY, 0);

      this.node.add(this.mesh);
    } catch (_error) {
      // Fallback: just hide the original mesh
      if (this.mesh) {
        this.mesh.visible = false;
      }
    }
  }

  private async swapToFullModel(): Promise<void> {
    if (this.world.isServer || !this.node) return;

    // Remove current depleted mesh
    if (this.mesh) {
      this.node.remove(this.mesh);
      this.mesh = null;
    }

    // Reload the original model
    await this.createMesh();
  }

  // Override serialize() to include all config data for network sync
  serialize(): EntityData {
    const baseData = super.serialize();
    return {
      ...baseData,
      model: this.config.model,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      depleted: this.config.depleted,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
      respawnTime: this.config.respawnTime,
      interactionDistance: this.config.interactionDistance || 3,
      description: this.config.description,
      modelScale: this.config.modelScale,
      depletedModelScale: this.config.depletedModelScale,
      depletedModelPath: this.config.depletedModelPath,
    } as EntityData;
  }

  public getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();
    return {
      ...baseData,
      model: this.config.model,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      depleted: this.config.depleted,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
      respawnTime: this.config.respawnTime,
      modelScale: this.config.modelScale,
      depletedModelScale: this.config.depletedModelScale,
      depletedModelPath: this.config.depletedModelPath,
    };
  }

  public updateFromNetwork(data: Record<string, unknown>): void {
    if (data.depleted !== undefined) {
      const wasDepleted = this.config.depleted;
      this.config.depleted = Boolean(data.depleted);

      // Update visual state based on depletion - swap to depleted model
      if (this.config.depleted && !wasDepleted) {
        // Just became depleted - swap to depleted model
        this.swapToStump();
      } else if (!this.config.depleted && wasDepleted) {
        // Just respawned - swap back to full model
        this.swapToFullModel();
      }
    }
  }

  protected async createMesh(): Promise<void> {
    if (this.world.isServer) {
      return;
    }

    // Try to load 3D model if available
    if (this.config.model && this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(
          this.config.model,
          this.world,
        );

        this.mesh = scene;
        this.mesh.name = `Resource_${this.config.resourceType}`;

        // Use scale from manifest config, with fallback defaults per resource type
        let modelScale = this.config.modelScale ?? 1.0;

        // Fallback defaults if manifest doesn't specify scale
        if (this.config.modelScale === undefined) {
          if (this.config.resourceType === "tree") {
            modelScale = 3.0;
          }
        }

        // Apply uniform scale directly to mesh (same as FurnaceEntity)
        // Do NOT manipulate internal node scales - this causes issues
        this.mesh.scale.set(modelScale, modelScale, modelScale);

        // Set layer for minimap exclusion and enable shadows
        // (Same simple traverse as FurnaceEntity - only for layers/shadows, no scale manipulation)
        this.mesh.layers.set(1);
        this.mesh.traverse((child) => {
          child.layers.set(1);
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Set up userData for interaction detection
        this.mesh.userData = {
          type: "resource",
          entityId: this.id,
          name: this.config.name,
          interactable: true,
          resourceType: this.config.resourceType,
          depleted: this.config.depleted,
        };

        // Calculate bounding box to position mesh correctly on ground
        // The model's pivot might be at center, so we need to offset it
        const bbox = new THREE.Box3().setFromObject(this.mesh);
        const minY = bbox.min.y;

        // Offset mesh so the bottom (minY) is at Y=0 (ground level)
        // Node position is already at terrain height, so mesh Y is relative to that
        this.mesh.position.set(0, -minY, 0);

        this.node.add(this.mesh);
        return;
      } catch (error) {
        // Log failure and fall through to placeholder
        console.warn(
          `Failed to load model for ${this.config.resourceType}:`,
          error,
        );
      }
    }

    // For fishing spots, create particle-based visual instead of placeholder
    if (this.config.resourceType === "fishing_spot") {
      this.createFishingSpotVisual();
      return;
    }

    // Create visible placeholder based on resource type
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;

    if (this.config.resourceType === "tree") {
      geometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
      material = new THREE.MeshStandardMaterial({ color: 0x8b4513 }); // Brown for tree
    } else {
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshStandardMaterial({ color: 0x808080 }); // Gray default
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `Resource_${this.config.resourceType}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = !this.config.depleted;

    // PERFORMANCE: Set placeholder to layer 1 (main camera only, not minimap)
    this.mesh.layers.set(1);

    // Set up userData for interaction detection (placeholder)
    this.mesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
    };

    // Scale for tree - use UNIFORM scale to prevent squishing
    if (this.config.resourceType === "tree") {
      this.mesh.scale.set(3, 3, 3);
    }

    this.node.add(this.mesh);
  }

  /**
   * Create animated visual for fishing spots.
   * Uses expanding ripple rings and a glowing indicator.
   * Different fishing methods have distinct visual variations.
   */
  private createFishingSpotVisual(): void {
    // Get variant-specific settings based on fishing type
    const variant = this.getFishingSpotVariant();

    // Create the glow indicator (main visual)
    this.createGlowIndicator();

    // Create animated ripple rings
    this.createRippleRings(variant);

    // Start animation loop
    this.startRippleAnimation(variant);
  }

  /**
   * Get visual variant settings based on fishing spot type.
   * Net = calm/gentle, Bait = medium, Fly = more active.
   */
  private getFishingSpotVariant(): {
    color: number;
    rippleSpeed: number;
    rippleCount: number;
  } {
    const resourceId = this.config.resourceId || "";

    if (resourceId.includes("net")) {
      // Calm, gentle ripples (shallow water fishing)
      return { color: 0x88ccff, rippleSpeed: 0.8, rippleCount: 2 };
    } else if (resourceId.includes("fly")) {
      // More active (river/moving water)
      return { color: 0xaaddff, rippleSpeed: 1.5, rippleCount: 4 };
    }
    // Default: bait (medium activity)
    return { color: 0x66bbff, rippleSpeed: 1.0, rippleCount: 3 };
  }

  /**
   * Create expanding ripple ring meshes for water effect.
   */
  private createRippleRings(variant: {
    color: number;
    rippleCount: number;
  }): void {
    this.rippleRings = [];

    for (let i = 0; i < variant.rippleCount; i++) {
      const geometry = new THREE.RingGeometry(0.3, 0.4, 32);
      const material = new THREE.MeshBasicMaterial({
        color: variant.color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });

      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2; // Horizontal
      ring.position.y = 0.1; // Just above water surface
      ring.name = `FishingSpotRipple_${i}`;

      this.node.add(ring);
      this.rippleRings.push(ring);
    }
  }

  /**
   * Animate ripple rings expanding outward.
   */
  private startRippleAnimation(variant: {
    rippleSpeed: number;
    rippleCount: number;
  }): void {
    // Skip animation in headless environments (Node.js)
    if (typeof requestAnimationFrame === "undefined") return;

    const startTime = Date.now();
    const cycleDuration = 2000 / variant.rippleSpeed; // ms per cycle

    const animate = () => {
      if (!this.rippleRings || this.rippleRings.length === 0) return;

      const elapsed = Date.now() - startTime;

      for (let i = 0; i < this.rippleRings.length; i++) {
        const ring = this.rippleRings[i];
        if (!ring) continue;

        // Stagger each ring's phase
        const phase = (elapsed / cycleDuration + i / variant.rippleCount) % 1;

        // Scale from 0.5 to 2.0 over the cycle
        const scale = 0.5 + phase * 1.5;
        ring.scale.set(scale, scale, 1);

        // Fade in then out (peak at 0.3, fade out by 1.0)
        let opacity: number;
        if (phase < 0.3) {
          opacity = (phase / 0.3) * 0.6; // Fade in to 0.6
        } else {
          opacity = 0.6 * (1 - (phase - 0.3) / 0.7); // Fade out
        }
        (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    animate();
  }

  /**
   * Create subtle glow indicator visible from distance when particles aren't.
   */
  private createGlowIndicator(): void {
    const geometry = new THREE.CircleGeometry(0.6, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    this.glowMesh = new THREE.Mesh(geometry, material);
    this.glowMesh.rotation.x = -Math.PI / 2; // Horizontal
    this.glowMesh.position.y = 0.05; // Just above water
    this.glowMesh.name = "FishingSpotGlow";

    // Set up userData for interaction detection
    this.glowMesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
    };

    this.node.add(this.glowMesh);
  }

  destroy(local?: boolean): void {
    // Unregister collision tiles (server-side only)
    if (this.world.isServer && this.collisionTiles.length > 0) {
      this.unregisterCollision();
    }

    // Clear respawn timer to prevent memory leaks
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = undefined;
    }

    // Stop ripple animation
    if (this.animationFrameId !== undefined) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    // Clean up ripple rings (fishing spots)
    if (this.rippleRings) {
      for (const ring of this.rippleRings) {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.node.remove(ring);
      }
      this.rippleRings = undefined;
    }

    // Clean up glow mesh (fishing spots)
    if (this.glowMesh) {
      this.glowMesh.geometry.dispose();
      (this.glowMesh.material as THREE.Material).dispose();
      this.node.remove(this.glowMesh);
      this.glowMesh = undefined;
    }

    // Call parent destroy
    super.destroy(local);
  }
}
