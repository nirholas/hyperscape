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

    // Only trees have stumps
    if (this.config.resourceType !== "tree") {
      // For other resources, just hide the mesh
      if (this.mesh) {
        this.mesh.visible = false;
      }
      return;
    }

    console.log("[ResourceEntity] 🪵 Swapping to stump model");

    // Remove current tree mesh
    if (this.mesh) {
      this.node.remove(this.mesh);
      this.mesh = null;
    }

    // Load depleted model from config (set by manifest) or fallback to hardcoded
    const depletedModelPath =
      this.config.depletedModelPath ||
      "asset://models/basic-reg-tree-stump/basic-tree-stump.glb";
    try {
      const { scene } = await modelCache.loadModel(
        depletedModelPath,
        this.world,
      );

      this.mesh = scene;
      this.mesh.name = `ResourceDepleted_${this.config.resourceType}`;

      // Use scale from config (set by manifest) or fallback to default
      const modelScale = this.config.depletedModelScale ?? 0.3;
      this.mesh.scale.set(modelScale, modelScale, modelScale);
      this.mesh.updateMatrix();
      this.mesh.updateMatrixWorld(true);

      // Enable shadows
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Set up userData
      this.mesh.userData = {
        type: "resource",
        entityId: this.id,
        name: "Tree Stump",
        interactable: false,
        resourceType: this.config.resourceType,
        depleted: true,
      };

      this.node.add(this.mesh);
      console.log("[ResourceEntity] ✅ Stump model loaded");
    } catch (error) {
      console.error("[ResourceEntity] Failed to load stump model:", error);
      // Fallback: just hide the original mesh
      if (this.mesh) {
        this.mesh.visible = false;
      }
    }
  }

  private async swapToFullModel(): Promise<void> {
    if (this.world.isServer || !this.node) return;

    console.log("[ResourceEntity] 🌳 Swapping to full tree model");

    // Remove current stump mesh
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

      // Update visual state based on depletion - swap to stump for trees
      if (this.config.depleted && !wasDepleted) {
        // Just became depleted - swap to stump
        this.swapToStump();
      } else if (!this.config.depleted && wasDepleted) {
        // Just respawned - swap back to full tree
        this.swapToFullModel();
      }
    }

    // CRITICAL: Enforce uniform node scale to prevent stretching
    // Some network updates might try to apply non-uniform scale
    if (
      this.node &&
      (this.node.scale.x !== 1 ||
        this.node.scale.y !== 1 ||
        this.node.scale.z !== 1)
    ) {
      this.node.scale.set(1, 1, 1);
    }
  }

  protected async createMesh(): Promise<void> {
    if (this.world.isServer) {
      return;
    }

    // Try to load 3D model if available (same approach as MobEntity for Meshy models)
    if (this.config.model && this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(
          this.config.model,
          this.world,
        );

        this.mesh = scene;
        this.mesh.name = `Resource_${this.config.resourceType}`;

        // CRITICAL: Force node scale to be uniform (prevent stretching)
        // Some systems might try to apply non-uniform scale - prevent this
        this.node.scale.set(1, 1, 1);

        // Use scale from manifest config, with fallback defaults per resource type
        // ALWAYS use uniform scaling to preserve model proportions
        let modelScale = this.config.modelScale ?? 1.0;

        // Fallback defaults if manifest doesn't specify scale
        if (this.config.modelScale === undefined) {
          if (this.config.resourceType === "tree") {
            modelScale = 3.0;
          }
        }

        // Apply UNIFORM scale only (x=y=z to prevent stretching)
        this.mesh.scale.set(modelScale, modelScale, modelScale);

        this.mesh.updateMatrix();
        this.mesh.updateMatrixWorld(true);

        // Handle skeletal meshes and set layer for minimap exclusion
        this.mesh.layers.set(1); // Main camera only, not minimap
        this.mesh.traverse((child) => {
          // PERFORMANCE: Set all children to layer 1 (minimap only sees layer 0)
          child.layers.set(1);

          if (child instanceof THREE.SkinnedMesh && child.skeleton) {
            child.updateMatrix();
            child.updateMatrixWorld(true);
            child.bindMode = THREE.DetachedBindMode;
            child.bindMatrix.copy(child.matrixWorld);
            child.bindMatrixInverse.copy(child.bindMatrix).invert();
          }

          // Enable shadows on all meshes
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
        // Note: Don't reset quaternion if we applied base rotation above

        this.node.add(this.mesh);
        return;
      } catch (error) {
        console.warn(
          `[ResourceEntity] Failed to load model for ${this.config.resourceType}, using placeholder:`,
          error,
        );
        // Fall through to placeholder
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

    // Scale for tree
    if (this.config.resourceType === "tree") {
      this.mesh.scale.set(2, 3, 2);
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
    // Clear respawn timer to prevent memory leaks
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = undefined;
    }

    // Stop ripple animation
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
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
