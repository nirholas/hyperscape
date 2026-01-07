/**
 * FurnaceEntity - Permanent smelting station
 *
 * Represents a furnace that players can use to smelt ores into bars.
 * Unlike fires (temporary), furnaces are permanent fixtures in the world.
 *
 * **Extends**: InteractableEntity (players can interact to smelt)
 *
 * **Interaction**:
 * - Left-click: Opens smelting interface (if player has ores)
 * - Right-click: Context menu with "Smelt" and "Examine" options
 *
 * **Visual Representation**:
 * - Stone/brick furnace with glowing opening
 *
 * **Runs on**: Server (authoritative), Client (visual)
 *
 * @see SmeltingSystem for smelting logic
 * @see ProcessingDataProvider for smelting recipes
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

/** Default interaction range for furnaces (in tiles) */
const FURNACE_INTERACTION_RANGE = 2;

/**
 * Configuration for creating a FurnaceEntity.
 */
export interface FurnaceEntityConfig {
  id: string;
  name?: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
}

export class FurnaceEntity extends InteractableEntity {
  public readonly entityType = "furnace";
  public readonly isInteractable = true;
  public readonly isPermanent = true;

  /** Display name */
  public displayName: string;

  constructor(world: World, config: FurnaceEntityConfig) {
    // Convert to InteractableConfig format
    const interactableConfig: InteractableConfig = {
      id: config.id,
      name: config.name || "Furnace",
      type: EntityType.FURNACE,
      position: config.position,
      rotation: config.rotation
        ? { ...config.rotation, w: 1 }
        : { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.SMELTING,
      interactionDistance: FURNACE_INTERACTION_RANGE,
      description: "A furnace for smelting ores into bars.",
      model: null,
      interaction: {
        prompt: "Smelt",
        description: "Smelt ores into bars",
        range: FURNACE_INTERACTION_RANGE,
        cooldown: 0,
        usesRemaining: -1,
        maxUses: -1,
        effect: "smelting",
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

    this.displayName = config.name || "Furnace";
  }

  protected async createMesh(): Promise<void> {
    // Don't create mesh on server
    if (this.world.isServer) {
      return;
    }

    // Create furnace visual (stone/brick furnace with glow)
    const group = new THREE.Group();
    group.name = `Furnace_${this.id}`;

    // Main body (stone/brick)
    const bodyGeometry = new THREE.BoxGeometry(1.2, 1.4, 1.2);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c5c5c, // Gray stone
      roughness: 0.9,
      metalness: 0.1,
    });
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.name = "FurnaceBody";
    bodyMesh.position.y = 0.7;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Opening (dark cavity)
    const openingGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.3);
    const openingMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, // Dark opening
      roughness: 1.0,
      metalness: 0.0,
    });
    const openingMesh = new THREE.Mesh(openingGeometry, openingMaterial);
    openingMesh.name = "FurnaceOpening";
    openingMesh.position.set(0, 0.5, 0.5);
    group.add(openingMesh);

    // Fire glow inside opening
    const glowGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.1);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.6,
    });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.name = "FurnaceGlow";
    glowMesh.position.set(0, 0.5, 0.45);
    group.add(glowMesh);

    // Chimney
    const chimneyGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.4);
    const chimneyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a, // Darker stone
      roughness: 0.9,
      metalness: 0.1,
    });
    const chimneyMesh = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
    chimneyMesh.name = "FurnaceChimney";
    chimneyMesh.position.set(0, 1.65, 0);
    chimneyMesh.castShadow = true;
    group.add(chimneyMesh);

    // Store mesh
    this.mesh = group;

    // Set up userData for interaction detection
    group.userData = {
      type: "furnace",
      entityId: this.id,
      name: this.displayName,
      interactable: true,
    };

    // Also set on child meshes for raycast detection
    bodyMesh.userData = { ...group.userData };
    openingMesh.userData = { ...group.userData };
    chimneyMesh.userData = { ...group.userData };

    // Add to node
    if (this.node) {
      this.node.add(group);
      this.node.userData.type = "furnace";
      this.node.userData.entityId = this.id;
      this.node.userData.interactable = true;
    }
  }

  /**
   * Handle furnace interaction - opens smelting interface.
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    // Emit event to start smelting interaction
    this.world.emit(EventType.SMELTING_INTERACT, {
      playerId: data.playerId,
      furnaceId: this.id,
      position: this.position,
    });
  }

  /**
   * Get context menu actions for this furnace.
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

    // Add "Smelt" action
    actions.push({
      id: "smelt",
      label: "Smelt",
      priority: 1,
      handler: () => {
        this.world.emit(EventType.SMELTING_INTERACT, {
          playerId,
          furnaceId: this.id,
          position: this.position,
        });
      },
    });

    // Add "Examine" action
    actions.push({
      id: "examine",
      label: "Examine",
      priority: 100,
      handler: () => {
        this.world.emit(EventType.UI_MESSAGE, {
          playerId,
          message: "A furnace for smelting ores into metal bars.",
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
      isPermanent: this.isPermanent,
    };
  }

  /**
   * Client update - furnaces are static but could have fire animations.
   */
  protected clientUpdate(_deltaTime: number): void {
    // Furnace is static, could add flickering glow animation later
  }
}
