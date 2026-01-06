/**
 * RangeEntity - Permanent cooking station
 *
 * Represents a cooking range (oven/stove) that players can cook on.
 * Ranges provide lower burn rates than fires for most foods.
 * Unlike fires, ranges are permanent fixtures in the world.
 *
 * **Extends**: InteractableEntity (players can interact to cook)
 *
 * **Interaction**:
 * - Left-click: Opens cook interface (if player has raw food)
 * - Right-click: Context menu with "Cook [item]" options and "Examine"
 *
 * **Visual Representation**:
 * - Gray/brown stove-like box
 *
 * **Special Ranges**:
 * - Lumbridge Castle Range: Standard
 * - Hosidius Kitchen Range: 5% burn reduction (requires favor)
 *
 * **Runs on**: Server (authoritative), Client (visual)
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import { EntityType, InteractionType } from "../../types/entities";
import type { EntityInteractionData } from "../../types/entities";
import {
  InteractableEntity,
  type InteractableConfig,
} from "../InteractableEntity";
import { EventType } from "../../types/events";
import { PROCESSING_CONSTANTS } from "../../constants/ProcessingConstants";

/**
 * Configuration for creating a RangeEntity.
 */
export interface RangeEntityConfig {
  id: string;
  name?: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  /** Burn rate reduction (0 = standard, 0.05 = Hosidius) */
  burnReduction?: number;
}

export class RangeEntity extends InteractableEntity {
  public readonly entityType = "range";
  public readonly isInteractable = true;
  public readonly isPermanent = true;

  /** Burn rate reduction (0-1, where 0.05 = 5% reduction) */
  public burnReduction: number;

  /** Display name */
  public displayName: string;

  constructor(world: World, config: RangeEntityConfig) {
    // Convert to InteractableConfig format
    const interactableConfig: InteractableConfig = {
      id: config.id,
      name: config.name || "Range",
      type: EntityType.RANGE,
      position: config.position,
      rotation: config.rotation
        ? { ...config.rotation, w: 1 }
        : { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.COOKING,
      interactionDistance: PROCESSING_CONSTANTS.FIRE.interactionRange,
      description: "A range for cooking food.",
      model: null,
      interaction: {
        prompt: "Cook",
        description: "Cook food on this range",
        range: PROCESSING_CONSTANTS.FIRE.interactionRange,
        cooldown: 0,
        usesRemaining: -1,
        maxUses: -1,
        effect: "cooking",
      },
      properties: {
        movementComponent: null,
        combatComponent: null,
        healthComponent: null,
        visualComponent: null,
        health: { current: 1, max: 1 },
        level: 1,
      },
    };

    super(world, interactableConfig);

    this.displayName = config.name || "Range";
    this.burnReduction = config.burnReduction || 0;
  }

  protected async createMesh(): Promise<void> {
    // Don't create mesh on server
    if (this.world.isServer) {
      return;
    }

    // Create range visual (brown/gray stove-like box)
    const group = new THREE.Group();
    group.name = `Range_${this.id}`;

    // Main body
    const bodyGeometry = new THREE.BoxGeometry(0.9, 0.8, 0.9);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3728, // Dark brown
      roughness: 0.8,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.name = "RangeBody";
    bodyMesh.position.y = 0.4;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Top surface (darker, like cast iron)
    const topGeometry = new THREE.BoxGeometry(0.95, 0.05, 0.95);
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222, // Dark gray
      roughness: 0.5,
      metalness: 0.6,
    });
    const topMesh = new THREE.Mesh(topGeometry, topMaterial);
    topMesh.name = "RangeTop";
    topMesh.position.y = 0.825;
    topMesh.castShadow = true;
    group.add(topMesh);

    // Add a subtle glow to indicate it's usable
    const glowGeometry = new THREE.BoxGeometry(0.3, 0.02, 0.3);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.3,
    });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.name = "RangeGlow";
    glowMesh.position.y = 0.86;
    group.add(glowMesh);

    // Store mesh
    this.mesh = group;

    // Set up userData for interaction detection
    group.userData = {
      type: "range",
      entityId: this.id,
      name: this.displayName,
      interactable: true,
      burnReduction: this.burnReduction,
    };

    // Also set on child meshes for raycast detection
    bodyMesh.userData = { ...group.userData };
    topMesh.userData = { ...group.userData };

    // Add to node
    if (this.node) {
      this.node.add(group);
      this.node.userData.type = "range";
      this.node.userData.entityId = this.id;
      this.node.userData.interactable = true;
    }
  }

  /**
   * Handle range interaction - opens cooking interface.
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    // Emit event to start cooking interaction
    this.world.emit(EventType.COOKING_INTERACT, {
      playerId: data.playerId,
      rangeId: this.id,
      sourceType: "range" as const,
      position: this.position,
      burnReduction: this.burnReduction,
    });
  }

  /**
   * Get context menu actions for this range.
   */
  public getContextMenuActions(playerId: string): Array<{
    id: string;
    label: string;
    priority: number;
    handler: () => void;
  }> {
    const actions: Array<{
      id: string;
      label: string;
      priority: number;
      handler: () => void;
    }> = [];

    // Add "Cook" action
    actions.push({
      id: "cook",
      label: "Cook",
      priority: 1,
      handler: () => {
        this.world.emit(EventType.COOKING_INTERACT, {
          playerId,
          rangeId: this.id,
          sourceType: "range" as const,
          position: this.position,
          burnReduction: this.burnReduction,
        });
      },
    });

    // Add "Examine" action
    actions.push({
      id: "examine",
      label: "Examine",
      priority: 100,
      handler: () => {
        const examineText =
          this.burnReduction > 0
            ? `A well-maintained range. Cooking here reduces burn chance by ${(this.burnReduction * 100).toFixed(0)}%.`
            : "A range for cooking food.";
        this.world.emit(EventType.UI_MESSAGE, {
          playerId,
          message: examineText,
        });
      },
    });

    return actions;
  }

  /**
   * Network data for syncing to clients.
   */
  getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();
    return {
      ...baseData,
      displayName: this.displayName,
      burnReduction: this.burnReduction,
      isPermanent: this.isPermanent,
    };
  }

  /**
   * Client update - ranges are static but could have animations.
   */
  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);
    // Range is static, no animation needed
  }
}
