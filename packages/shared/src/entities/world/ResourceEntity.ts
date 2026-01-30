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
import {
  createDissolveMaterial,
  isDissolveMaterial,
  getLODDistances,
  GPU_VEG_CONFIG,
  type DissolveMaterial,
} from "../../systems/shared/world/GPUVegetation";
import { getCameraPosition } from "../../utils/rendering/AnimationLOD";
import {
  getTreeMeshClone,
  getTreeLOD1Clone,
  getVariantIndex,
  addTreeInstance,
  removeTreeInstance,
  setProcgenTreeWorld,
} from "../../systems/shared/world/ProcgenTreeCache";

/**
 * NOTE: LOD1 models are PRE-BAKED offline using scripts/bake-lod.sh (Blender).
 * Runtime LOD generation has been removed for performance.
 *
 * LOD1 files follow the naming convention: model_lod1.glb
 * Example: models/tree/tree.glb -> models/tree/tree_lod1.glb
 *
 * Resource types that skip LOD1 (too small, go straight to imposter):
 * - herb
 * - fishing_spot
 */

/**
 * Infer LOD1 model path from LOD0 path.
 */
function inferLOD1Path(lod0Path: string): string {
  return lod0Path.replace(/\.glb$/i, "_lod1.glb");
}

/**
 * Cached LOD1 data per model path.
 * Contains shared geometry and shared dissolve material for batching.
 */
interface LOD1CacheEntry {
  /** Shared geometry (read-only, do not modify) */
  geometry: THREE.BufferGeometry;
  /** Original material from model (for reference) */
  originalMaterial: THREE.Material;
  /** Shared dissolve material - all entities use this same instance */
  dissolveMaterial: DissolveMaterial;
  /** Reference count for cleanup */
  refCount: number;
}

/**
 * Cache for loaded LOD1 meshes by model path.
 * Stores shared geometry and SHARED dissolve material for batching.
 * All entities using the same LOD1 model share one material = 1 draw call.
 */
const lod1MeshCache = new Map<string, LOD1CacheEntry | null>();

/**
 * Set of all active shared LOD1 dissolve materials.
 * Updated globally once per frame for efficient uniform updates.
 */
const activeLOD1Materials = new Set<DissolveMaterial>();

/**
 * Last camera position used for LOD1 material updates.
 * Used to skip updates if camera hasn't moved significantly.
 */
const lastLOD1CameraPos = new THREE.Vector3(Infinity, 0, Infinity);

/**
 * Last player position used for occlusion dissolve updates.
 */
const lastLOD1PlayerPos = new THREE.Vector3(Infinity, 0, Infinity);

/**
 * Pending LOD1 load promises to prevent duplicate loads.
 */
const pendingLOD1Loads = new Map<string, Promise<void>>();

/**
 * Resource types that skip LOD1 (go directly to imposter).
 */
const SKIP_LOD1_TYPES = new Set(["herb", "fishing_spot"]);

/**
 * Update all shared LOD1 materials with current camera and player positions.
 * Skips update if positions haven't moved more than 1 unit (reduces uniform uploads).
 *
 * This batch-updates ALL shared LOD1 materials once, instead of each entity
 * updating its own cloned material. Result: O(types) instead of O(entities).
 *
 * For occlusion dissolve:
 * - cameraPos = camera position (for distance fade AND occlusion ray origin)
 * - playerPos = player position (for occlusion target - what we want to keep visible)
 */
function updateSharedLOD1Materials(
  cameraPos: { x: number; y?: number; z: number },
  playerPos: { x: number; y?: number; z: number },
): void {
  // Skip if camera and player haven't moved significantly
  const cdx = cameraPos.x - lastLOD1CameraPos.x;
  const cdz = cameraPos.z - lastLOD1CameraPos.z;
  const pdx = playerPos.x - lastLOD1PlayerPos.x;
  const pdz = playerPos.z - lastLOD1PlayerPos.z;
  if (cdx * cdx + cdz * cdz < 1 && pdx * pdx + pdz * pdz < 1) return;

  const camY = cameraPos.y ?? 0;
  const plrY = playerPos.y ?? 0;
  lastLOD1CameraPos.set(cameraPos.x, camY, cameraPos.z);
  lastLOD1PlayerPos.set(playerPos.x, plrY, playerPos.z);

  // Update all shared LOD1 materials (one per model type)
  for (const mat of activeLOD1Materials) {
    // playerPos = actual player (occlusion target)
    mat.dissolveUniforms.playerPos.value.set(playerPos.x, plrY, playerPos.z);
    // cameraPos = camera (occlusion ray origin)
    mat.dissolveUniforms.cameraPos.value.set(cameraPos.x, camY, cameraPos.z);
  }
}

// Re-export types for external use
export type { ResourceEntityConfig } from "../../types/entities";

// LOD configuration constants
// Default distances from unified LOD system - can be overridden per-entity via config.lodConfig
const DEFAULT_RESOURCE_LOD = getLODDistances("resource");

// Temp vectors for LOD calculations (shared across instances)
const _tempPos = new THREE.Vector3();

// PERFORMANCE: Shared placeholder materials (avoid creating new material per entity)
// These are reused across all ResourceEntity instances
const _sharedPlaceholderMaterials = new Map<
  string,
  THREE.MeshStandardMaterial
>();

function getSharedPlaceholderMaterial(
  resourceType: string,
): THREE.MeshStandardMaterial {
  if (!_sharedPlaceholderMaterials.has(resourceType)) {
    const color = resourceType === "tree" ? 0x8b4513 : 0x808080;
    const material = new THREE.MeshStandardMaterial({ color });
    _sharedPlaceholderMaterials.set(resourceType, material);
  }
  return _sharedPlaceholderMaterials.get(resourceType)!;
}

// PERFORMANCE: Shared placeholder geometries (avoid creating new geometry per entity)
const _sharedPlaceholderGeometries = new Map<string, THREE.BufferGeometry>();

function getSharedPlaceholderGeometry(
  resourceType: string,
): THREE.BufferGeometry {
  if (!_sharedPlaceholderGeometries.has(resourceType)) {
    const geometry =
      resourceType === "tree"
        ? new THREE.CylinderGeometry(0.3, 0.5, 3, 8)
        : new THREE.BoxGeometry(1, 1, 1);
    _sharedPlaceholderGeometries.set(resourceType, geometry);
  }
  return _sharedPlaceholderGeometries.get(resourceType)!;
}

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
  /** Dissolve materials for distance-based fade (client-only) */
  private dissolveMaterials: DissolveMaterial[] = [];
  /** Last camera position for dissolve update throttling */
  private lastCameraPos = new THREE.Vector3();
  /** Whether dissolve has been initialized on this resource */
  private dissolveInitialized = false;

  // LOD (Level of Detail) system
  /** LOD1 mesh (low-poly) for medium distance rendering (client-only) */
  private lod1Mesh?: THREE.Object3D;
  /** Current LOD level: 0 = full detail, 1 = low poly (impostors handled by Entity.hlodState) */
  private currentLOD: 0 | 1 = 0;
  // NOTE: LOD1 materials are now SHARED across all entities via activeLOD1Materials
  // They're updated globally in updateSharedLOD1Materials() for efficiency
  // NOTE: Impostor billboard is handled by Entity's HLOD system (initHLOD/updateHLOD)

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
      procgenPreset: this.config.procgenPreset,
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
      procgenPreset: this.config.procgenPreset,
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

    // For trees with procgenPreset, use procedural generation
    if (this.config.resourceType === "tree" && this.config.procgenPreset) {
      const procgenSuccess = await this.createProcgenTreeMesh();
      if (procgenSuccess) {
        return; // Successfully created procgen tree
      }
      // If no model fallback, warn and use placeholder
      if (!this.config.model) {
        console.warn(
          `[ResourceEntity] Procgen failed for ${this.config.procgenPreset}, no GLB fallback - using placeholder`,
        );
        // Fall through to placeholder
      }
      // Otherwise fall through to GLB model loading
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

        // Apply dissolve shader for distance-based fade (matching vegetation)
        this.applyDissolveMaterials();

        // Initialize HLOD impostor support for resources
        // Uses the Entity base class HLOD system with OctahedralImpostor for quality multi-view rendering
        const modelId = `resource_${this.config.resourceType}_${this.config.model || "default"}`;
        await this.initHLOD(modelId, {
          category: "resource",
          atlasSize: 512, // Medium size for resources
          hemisphere: true, // Most resources are viewed from above
        });

        // Load LOD1 (low-poly) model if specified
        await this.loadLOD1Model(modelScale);

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

    // PERFORMANCE: Use shared placeholder geometry and material
    // Avoids creating new geometry/material per entity (significant memory savings)
    const geometry = getSharedPlaceholderGeometry(this.config.resourceType);
    const material = getSharedPlaceholderMaterial(this.config.resourceType);

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

    // Apply dissolve shader for distance-based fade (matching vegetation)
    this.applyDissolveMaterials();
  }

  /**
   * Create a procedurally generated tree mesh using @hyperscape/procgen.
   *
   * Uses cached variants (3 per preset) with additional rotation/scale variation
   * for visual diversity without excessive memory usage.
   *
   * @returns true if successfully created, false to fall back to GLB model
   */
  /** Flag to track if using instanced rendering */
  private _useInstancedTree = false;
  /** Current instanced LOD level */
  private _instancedLOD = 0;

  /**
   * Create a procedurally generated tree using INSTANCED RENDERING.
   * All trees of the same preset batch into a SINGLE draw call.
   */
  private async createProcgenTreeMesh(): Promise<boolean> {
    const presetName = this.config.procgenPreset;
    if (!presetName) {
      return false;
    }

    try {
      // Set up the world reference for instancing
      setProcgenTreeWorld(this.world);

      // Calculate transform
      const baseScale = this.config.modelScale ?? 1.0;
      const scaleHash = this.hashString(this.id + "_scale");
      const scaleVariation = 0.85 + (scaleHash % 300) / 1000;
      const finalScale = baseScale * scaleVariation;

      const rotHash = this.hashString(
        `${this.id}_${this.position.x.toFixed(1)}_${this.position.z.toFixed(1)}`,
      );
      const rotation = ((rotHash % 1000) / 1000) * Math.PI * 2;

      // World position from node
      const worldPos = new THREE.Vector3();
      this.node.getWorldPosition(worldPos);

      // Add as instanced tree (LOD0 initially)
      const success = await addTreeInstance(
        presetName,
        this.id,
        worldPos,
        rotation,
        finalScale,
        0, // Start at LOD0
      );

      if (success) {
        this._useInstancedTree = true;
        this._instancedLOD = 0;

        // Create invisible collision proxy for interactions
        this.createTreeCollisionProxy(finalScale);
        return true;
      }

      // Fallback to individual mesh if instancing failed
      return this.createProcgenTreeMeshFallback();
    } catch (error) {
      console.error(
        `[ResourceEntity] Error creating instanced tree for ${presetName}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Create invisible collision proxy for instanced trees.
   * Allows raycasting/interaction even though visual is rendered by instancer.
   */
  private createTreeCollisionProxy(scale: number): void {
    const height = 8 * scale;
    const radius = 1 * scale;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 6);
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.Mesh(geometry, material);
    proxy.position.y = height / 2;
    proxy.name = `TreeProxy_${this.id}`;
    proxy.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      procgenPreset: this.config.procgenPreset,
    };
    proxy.layers.set(1);
    this.node.add(proxy);
    this.mesh = proxy;
  }

  /**
   * Fallback: Create individual mesh if instancing fails.
   */
  private async createProcgenTreeMeshFallback(): Promise<boolean> {
    const presetName = this.config.procgenPreset;
    if (!presetName) return false;

    const treeGroup = await getTreeMeshClone(presetName, this.id);
    if (!treeGroup) return false;

    this.mesh = treeGroup;
    this.mesh.name = `Resource_tree_procgen_${presetName}`;
    this.mesh.visible = !this.config.depleted;

    const baseScale = this.config.modelScale ?? 1.0;
    const scaleHash = this.hashString(this.id + "_scale");
    const finalScale = baseScale * (0.85 + (scaleHash % 300) / 1000);
    this.mesh.scale.setScalar(finalScale);

    const rotHash = this.hashString(
      `${this.id}_${this.position.x.toFixed(1)}_${this.position.z.toFixed(1)}`,
    );
    this.mesh.rotation.y = ((rotHash % 1000) / 1000) * Math.PI * 2;

    this.mesh.layers.set(1);
    this.mesh.traverse((child) => {
      child.layers.set(1);
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.mesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
      procgenPreset: presetName,
    };

    const bbox = new THREE.Box3().setFromObject(this.mesh);
    this.mesh.position.set(0, -bbox.min.y, 0);
    this.node.add(this.mesh);

    return true;
  }

  /**
   * Simple string hash for deterministic randomization.
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /**
   * Get LOD1 mesh for procgen trees.
   *
   * First tries to get the cached decimated LOD1 mesh (30% of original vertices).
   * Falls back to a simple cone + cylinder shape if decimation is unavailable.
   *
   * LOD1 is used at medium distance (40-120m) before impostor kicks in.
   */
  private async getProcgenLOD1(
    presetName: string,
    fullMesh: THREE.Group,
  ): Promise<THREE.Group | null> {
    // Try to get the cached decimated LOD1 mesh first
    const cachedLOD1 = await getTreeLOD1Clone(presetName, this.id);

    if (cachedLOD1) {
      // Apply same transform as full mesh
      cachedLOD1.position.copy(fullMesh.position);
      cachedLOD1.rotation.copy(fullMesh.rotation);
      cachedLOD1.scale.copy(fullMesh.scale);

      // Set layers to match full mesh
      cachedLOD1.layers.set(1);
      cachedLOD1.traverse((child) => {
        child.layers.set(1);
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          // Setup materials with world
          if (this.world.setupMaterial) {
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const mat of materials) {
              this.world.setupMaterial(mat);
            }
          }
        }
      });

      return cachedLOD1;
    }

    // Fallback: Create simple cone + cylinder shape
    return this.createSimpleLOD1(fullMesh);
  }

  /**
   * Create a simple LOD1 mesh as fallback (cone + cylinder).
   *
   * Used when decimation is unavailable. Creates a basic tree silhouette
   * with ~14 triangles instead of thousands.
   */
  private createSimpleLOD1(fullMesh: THREE.Group): THREE.Group {
    const lod1 = new THREE.Group();
    lod1.name = "LOD1_Tree_Simple";

    // Calculate bounds of original mesh
    const bbox = new THREE.Box3().setFromObject(fullMesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const height = size.y;
    const width = Math.max(size.x, size.z);

    // Create trunk (cylinder)
    const trunkHeight = height * 0.3;
    const trunkRadius = width * 0.05;
    const trunkGeometry = new THREE.CylinderGeometry(
      trunkRadius * 0.7, // top radius
      trunkRadius, // bottom radius
      trunkHeight,
      6, // radial segments (low poly)
      1, // height segments
    );
    const trunkMaterial = new THREE.MeshLambertMaterial({
      color: 0x4a3728, // Brown bark color
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    lod1.add(trunk);

    // Create canopy (cone)
    const canopyHeight = height * 0.75;
    const canopyRadius = width * 0.45;
    const canopyGeometry = new THREE.ConeGeometry(
      canopyRadius,
      canopyHeight,
      8, // radial segments (low poly)
      1, // height segments
    );
    const canopyMaterial = new THREE.MeshLambertMaterial({
      color: 0x2d5a27, // Green foliage color
    });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.y = trunkHeight + canopyHeight / 2;
    canopy.castShadow = true;
    lod1.add(canopy);

    // Copy transform from full mesh
    lod1.position.copy(fullMesh.position);
    lod1.rotation.copy(fullMesh.rotation);
    lod1.scale.copy(fullMesh.scale);

    // Set layers to match full mesh
    lod1.layers.set(1);
    trunk.layers.set(1);
    canopy.layers.set(1);

    // Setup materials with world
    if (this.world.setupMaterial) {
      this.world.setupMaterial(trunkMaterial);
      this.world.setupMaterial(canopyMaterial);
    }

    return lod1;
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

  /**
   * Apply dissolve materials to the mesh for distance-based fade.
   * This gives resources the same smooth dissolve effect as vegetation.
   * Called after mesh is loaded/created.
   */
  private applyDissolveMaterials(): void {
    if (!this.mesh || this.world.isServer || this.dissolveInitialized) return;

    this.dissolveInitialized = true;
    this.dissolveMaterials = [];

    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.material) return;

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      const newMaterials: THREE.Material[] = [];

      for (const mat of materials) {
        // Skip materials that already have dissolve or are not standard materials
        if (isDissolveMaterial(mat)) {
          newMaterials.push(mat);
          continue;
        }

        // Create dissolve version of the material
        // Match building shader: only near-camera fade, no player occlusion
        const dissolveMat = createDissolveMaterial(mat, {
          fadeStart: GPU_VEG_CONFIG.FADE_START,
          fadeEnd: GPU_VEG_CONFIG.FADE_END,
          enableNearFade: false, // Use camera-based near fade, not player-based
          enableWaterCulling: false, // Resources aren't affected by water culling
          enableOcclusionDissolve: false, // Disable occlusion (matches buildings)
        });

        // Set up the material with world
        this.world.setupMaterial(dissolveMat);

        this.dissolveMaterials.push(dissolveMat);
        newMaterials.push(dissolveMat);
      }

      // Apply the new materials
      child.material =
        newMaterials.length === 1 ? newMaterials[0] : newMaterials;
    });
  }

  // NOTE: Impostor rendering is handled by Entity's HLOD system (initHLOD/updateHLOD)
  // which uses OctahedralImpostor for quality multi-view rendering with view-dependent blending.
  // See Entity.ts for the full HLOD implementation.

  /**
   * Load pre-baked LOD1 (low-poly) model for medium-distance rendering.
   * LOD1 files are created by scripts/bake-lod.sh and follow naming: model_lod1.glb
   *
   * Uses a shared cache to avoid loading the same LOD1 file multiple times.
   */
  private async loadLOD1Model(lod0Scale: number): Promise<void> {
    if (this.world.isServer) return;

    const modelPath = this.config.model;
    if (!modelPath) return;

    // Skip LOD1 for small resource types (they go directly to imposter)
    if (SKIP_LOD1_TYPES.has(this.config.resourceType)) {
      return;
    }

    // Check if LOD1 is already cached
    if (lod1MeshCache.has(modelPath)) {
      const cached = lod1MeshCache.get(modelPath);
      if (cached) {
        this.createLOD1MeshFromCache(cached, lod0Scale);
      }
      // If cached as null, LOD1 load was attempted but file doesn't exist
      return;
    }

    // Check if load is already in progress
    const pending = pendingLOD1Loads.get(modelPath);
    if (pending) {
      await pending;
      const cached = lod1MeshCache.get(modelPath);
      if (cached) {
        this.createLOD1MeshFromCache(cached, lod0Scale);
      }
      return;
    }

    // Start LOD1 load with a promise to prevent duplicate loads
    const loadPromise = this.loadAndCacheLOD1(modelPath, lod0Scale);
    pendingLOD1Loads.set(modelPath, loadPromise);

    try {
      await loadPromise;
    } finally {
      pendingLOD1Loads.delete(modelPath);
    }
  }

  /**
   * Load pre-baked LOD1 file and cache it for reuse.
   */
  private async loadAndCacheLOD1(
    modelPath: string,
    lod0Scale: number,
  ): Promise<void> {
    // Determine LOD1 path: use config value or infer from model path
    const lod1ModelPath = this.config.lod1Model || inferLOD1Path(modelPath);

    try {
      const { scene: lod1Scene } = await modelCache.loadModel(
        lod1ModelPath,
        this.world,
      );

      // Extract geometry and material from loaded scene
      let foundGeometry: THREE.BufferGeometry | null = null;
      let foundMaterial: THREE.Material | null = null;
      lod1Scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry && !foundGeometry) {
          foundGeometry = child.geometry;
          foundMaterial = Array.isArray(child.material)
            ? child.material[0]
            : child.material;
        }
      });

      // Type assertions needed because TypeScript can't track traverse callback mutations
      const geometry = foundGeometry as THREE.BufferGeometry | null;
      const material = foundMaterial as THREE.Material | null;

      if (geometry && material) {
        // Create SHARED dissolve material for all entities using this LOD1 model
        // Match building shader: only near-camera fade, no player occlusion
        const dissolveMaterial = createDissolveMaterial(material, {
          fadeStart: GPU_VEG_CONFIG.FADE_START,
          fadeEnd: GPU_VEG_CONFIG.FADE_END,
          enableNearFade: false, // Use camera-based near fade, not player-based
          enableWaterCulling: false,
          enableOcclusionDissolve: false, // Disable occlusion (matches buildings)
        });

        // Setup for CSM shadows
        this.world.setupMaterial(dissolveMaterial);

        // Register in the global active materials set for batch updates
        activeLOD1Materials.add(dissolveMaterial);

        const cacheEntry: LOD1CacheEntry = {
          geometry,
          originalMaterial: material,
          dissolveMaterial,
          refCount: 0,
        };
        lod1MeshCache.set(modelPath, cacheEntry);
        this.createLOD1MeshFromCache(cacheEntry, lod0Scale);
        console.log(
          `[ResourceEntity] ✅ LOD1 for ${this.config.resourceType}: ${geometry.attributes.position?.count ?? 0} verts (pre-baked, SHARED material)`,
        );
        return;
      }
    } catch {
      // LOD1 file not found - this is normal if it hasn't been baked yet
      // Resource will use LOD0 -> Imposter transition instead
    }

    // Cache null to indicate LOD1 is not available for this model
    lod1MeshCache.set(modelPath, null);
  }

  /**
   * Create LOD1 mesh from cached shared geometry and material.
   * Uses the SHARED dissolve material - no cloning needed.
   */
  private createLOD1MeshFromCache(
    cached: LOD1CacheEntry,
    lod0Scale: number,
  ): void {
    // Create mesh using SHARED geometry and SHARED dissolve material
    // NO CLONING - all entities share the same material for batching
    this.lod1Mesh = new THREE.Mesh(cached.geometry, cached.dissolveMaterial);
    this.lod1Mesh.name = `ResourceLOD1_${this.config.resourceType}`;

    // Increment reference count
    cached.refCount++;

    // Use LOD1 scale or fall back to LOD0 scale
    const lod1Scale = this.config.lod1ModelScale ?? lod0Scale;
    this.lod1Mesh.scale.set(lod1Scale, lod1Scale, lod1Scale);

    // Set layer for minimap exclusion and enable shadows
    this.lod1Mesh.layers.set(1);
    this.lod1Mesh.castShadow = true;
    this.lod1Mesh.receiveShadow = true;

    // Set up userData (same as LOD0)
    this.lod1Mesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
    };

    // Position same as LOD0 mesh
    const bbox = new THREE.Box3().setFromObject(this.lod1Mesh);
    const minY = bbox.min.y;
    this.lod1Mesh.position.set(0, -minY, 0);

    // Start hidden - LOD0 is shown first
    this.lod1Mesh.visible = false;

    this.node.add(this.lod1Mesh);

    // LOD1 dissolve uniforms are updated globally via updateSharedLOD1Materials()
    // No per-entity tracking needed
  }

  /**
   * Client-side update for dissolve shader uniforms and LOD0/LOD1 transitions.
   * Handles 2-tier LOD system: LOD0 (full) -> LOD1 (low poly).
   * NOTE: Impostor (billboard) rendering is handled by Entity's HLOD system (initHLOD/updateHLOD).
   */
  public clientUpdate(_delta: number): void {
    if (this.world.isServer) return;

    // Get camera position (getCameraPosition returns only x,z for horizontal distance)
    const cameraPosXZ = getCameraPosition(this.world);
    if (!cameraPosXZ) return;

    // Get full camera position including Y for occlusion dissolve
    const cameraY = this.world.camera?.position?.y ?? 0;
    const cameraPos = { x: cameraPosXZ.x, y: cameraY, z: cameraPosXZ.z };

    // Get player position for occlusion dissolve target
    const players = this.world.getPlayers();
    const localPlayer = players && players.length > 0 ? players[0] : null;
    const playerNodePos = localPlayer?.node?.position;
    const playerPos = playerNodePos
      ? { x: playerNodePos.x, y: playerNodePos.y, z: playerNodePos.z }
      : cameraPos;

    // Calculate SQUARED distance to camera (avoids Math.sqrt in hot path)
    const worldPos = this.node.position;
    const dx = cameraPos.x - worldPos.x;
    const dz = cameraPos.z - worldPos.z;
    const distSq = dx * dx + dz * dz;

    // Get LOD distances from config or use unified defaults from GPUVegetation.ts
    // Pre-compute squared distances for performance
    const lodConfig = this.config.lodConfig || {};
    const lod1Distance =
      lodConfig.lod1Distance ?? DEFAULT_RESOURCE_LOD.lod1Distance;
    const lod1DistanceSq = lod1Distance * lod1Distance;
    const hysteresisSq = 0.81; // 0.9^2 - 10% hysteresis squared

    // Determine target LOD based on distance (LOD0/LOD1 only - HLOD handles impostor)
    const hasLOD1 = !!this.lod1Mesh;
    let targetLOD: 0 | 1;

    if (distSq < lod1DistanceSq * hysteresisSq) {
      // Very close - use LOD0 (full detail)
      targetLOD = 0;
    } else if (distSq < lod1DistanceSq) {
      // In LOD0/LOD1 transition zone - use hysteresis
      targetLOD = this.currentLOD === 0 ? 0 : hasLOD1 ? 1 : 0;
    } else {
      // Medium/far distance - use LOD1 if available, otherwise LOD0
      // Note: At far distance, Entity's HLOD system will show impostor instead
      targetLOD = hasLOD1 ? 1 : 0;
    }

    // Apply LOD transition if needed (only for LOD0/LOD1 - HLOD handles impostor visibility)
    if (targetLOD !== this.currentLOD && this.mesh) {
      // Update visibility based on target LOD
      if (targetLOD === 0) {
        // LOD0 (full detail)
        this.mesh.visible = true;
        if (this.lod1Mesh) this.lod1Mesh.visible = false;
      } else {
        // LOD1 (low poly)
        this.mesh.visible = false;
        if (this.lod1Mesh) this.lod1Mesh.visible = true;
      }
      this.currentLOD = targetLOD;
    }

    // Update shared LOD1 materials (batch update, once per type not once per entity)
    // This is much more efficient than per-entity updates
    // Pass both camera and player positions for occlusion dissolve
    updateSharedLOD1Materials(cameraPos, playerPos);

    // Throttle per-entity dissolve updates: only update if camera moved significantly (> 1m)
    // NOTE: LOD1 materials are now shared and updated globally above
    const hasPerEntityDissolve = this.dissolveMaterials.length > 0;
    if (!hasPerEntityDissolve) return;

    const ddx = cameraPos.x - this.lastCameraPos.x;
    const ddz = cameraPos.z - this.lastCameraPos.z;
    if (ddx * ddx + ddz * ddz < 1) return;

    this.lastCameraPos.set(cameraPos.x, 0, cameraPos.z);

    // Update LOD0 dissolve material uniforms (per-entity, as each LOD0 has unique material)
    // playerPos = actual player (occlusion target)
    // cameraPos = camera (occlusion ray origin)
    for (const mat of this.dissolveMaterials) {
      mat.dissolveUniforms.playerPos.value.set(
        playerPos.x,
        playerPos.y,
        playerPos.z,
      );
      mat.dissolveUniforms.cameraPos.value.set(
        cameraPos.x,
        cameraPos.y,
        cameraPos.z,
      );
    }
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

    // Clean up LOD0 dissolve materials (disposed with mesh materials)
    this.dissolveMaterials = [];
    this.dissolveInitialized = false;

    // Clean up LOD1 mesh
    // NOTE: LOD1 uses SHARED geometry and SHARED material, so we:
    // - DO remove the mesh from the scene
    // - DO NOT dispose geometry (shared)
    // - DO NOT dispose material (shared)
    // - DO decrement refCount
    if (this.lod1Mesh) {
      // Decrement reference count for shared LOD1 cache
      const modelPath = this.config.model;
      if (modelPath) {
        const cached = lod1MeshCache.get(modelPath);
        if (cached) {
          cached.refCount--;
          // If refCount reaches 0, we could clean up, but for now keep cached
          // for potential future entities (memory vs. load time tradeoff)
        }
      }
      this.node.remove(this.lod1Mesh);
      this.lod1Mesh = undefined;
    }

    // NOTE: Impostor cleanup is handled by Entity's disposeHLOD() method
    // which is called by super.destroy() below

    // Clean up instanced tree if using instancing
    if (this._useInstancedTree && this.config.procgenPreset) {
      removeTreeInstance(
        this.config.procgenPreset,
        this.id,
        this._instancedLOD,
      );
      this._useInstancedTree = false;
    }

    // Call parent destroy
    super.destroy(local);
  }
}
