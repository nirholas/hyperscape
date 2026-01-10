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
import { modelCache } from "../../utils/rendering/ModelCache";
import { stationDataProvider } from "../../data/StationDataProvider";

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

    // Get station data from manifest
    const stationData = stationDataProvider.getStationData("furnace");
    const modelPath = stationData?.model ?? null;
    const modelScale = stationData?.modelScale ?? 0.5;
    const modelYOffset = stationData?.modelYOffset ?? 0.7;

    // Try to load 3D model first
    if (modelPath && this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(modelPath, this.world);

        this.mesh = scene;
        this.mesh.name = `Furnace_${this.id}`;

        // Scale the model from manifest
        this.mesh.scale.set(modelScale, modelScale, modelScale);

        // Offset Y position so model base sits on ground
        this.mesh.position.y = modelYOffset;

        // Enable shadows and set layer for raycasting
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
          type: "furnace",
          entityId: this.id,
          name: this.displayName,
          interactable: true,
        };

        // Add to node
        if (this.node) {
          this.node.add(this.mesh);
          this.node.userData.type = "furnace";
          this.node.userData.entityId = this.id;
          this.node.userData.interactable = true;
        }

        return;
      } catch (error) {
        console.warn(
          `[FurnaceEntity] Failed to load furnace model, using placeholder:`,
          error,
        );
      }
    }

    // FALLBACK: Create furnace visual (blue box proxy)
    const geometry = new THREE.BoxGeometry(1.2, 1.4, 1.2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0066ff, // Blue for furnace
      roughness: 0.5,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Furnace_${this.id}`;
    mesh.position.y = 0.7; // Raise so bottom is at ground level
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Set up userData for interaction detection
    mesh.userData = {
      type: "furnace",
      entityId: this.id,
      name: this.displayName,
      interactable: true,
    };

    // Store mesh
    this.mesh = mesh;

    // Add to node
    if (this.node) {
      this.node.add(mesh);
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
