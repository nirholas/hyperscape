/**
 * Entity.ts - Base Entity Class
 *
 * The base class for all game objects in the world. Provides fundamental functionality
 * for 3D objects with networking, physics, components, and lifecycle management.
 *
 * Key Features:
 * - **3D Representation**: Three.js Object3D with mesh, position, rotation, scale
 * - **Component System**: Modular components for combat, stats, interaction, etc.
 * - **Physics**: Optional PhysX rigid body integration
 * - **Networking**: State synchronization across clients
 * - **Lifecycle**: spawn(), update(), fixedUpdate(), destroy()
 * - **Events**: Local and world event system for inter-entity communication
 * - **Serialization**: Network serialization for state sync
 *
 * Component Architecture:
 * Entities use a component-based design for modular functionality:
 * - CombatComponent: Health, attack, defense
 * - StatsComponent: Skills, levels, XP
 * - InteractionComponent: Player interaction handlers
 * - DataComponent: Custom data storage
 * - UsageComponent: Item usage logic
 * - VisualComponent: 3D model, materials, animations
 *
 * Inheritance Hierarchy:
 * ```
 * Entity (base class)
 * ├── InteractableEntity (can be interacted with)
 * │   ├── ResourceEntity (trees, rocks, fishing spots)
 * │   ├── ItemEntity (ground items)
 * │   └── NPCEntity (dialogue, shops)
 * ├── CombatantEntity (can fight)
 * │   ├── PlayerEntity (base player)
 * │   │   ├── PlayerLocal (client-side local player)
 * │   │   └── PlayerRemote (client-side remote players)
 * │   └── MobEntity (enemies)
 * └── HeadstoneEntity (player death markers)
 * ```
 *
 * Lifecycle:
 * 1. Constructor: Creates entity with initial data/config
 * 2. spawn(): Called when entity is added to world (override in subclasses)
 * 3. update(delta): Called every frame for visual updates
 * 4. fixedUpdate(delta): Called at fixed timestep (30 FPS) for physics
 * 5. destroy(): Cleanup when entity is removed
 *
 * Network Synchronization:
 * - Server creates entities and broadcasts to clients via entityAdded packet
 * - State changes trigger entityModified packet
 * - networkDirty flag indicates entity needs sync
 * - serialize() creates network-safe data representation
 *
 * Physics Integration:
 * - Optional PhysX rigid body for collision and forces
 * - Automatic sync between Three.js node and physics body
 * - Collision layers for selective interaction
 *
 * Usage:
 * ```typescript
 * // Create a generic entity
 * const entity = new Entity(world, {
 *   id: 'tree1',
 *   type: 'entity',
 *   name: 'Oak Tree',
 *   position: { x: 10, y: 0, z: 5 }
 * });
 * await entity.spawn();
 *
 * // Add component
 * entity.addComponent('data', { customValue: 42 });
 *
 * // Get component
 * const data = entity.getComponent('data');
 * ```
 *
 * Runs on: Both client and server
 * Used by: Entities system, all entity subclasses
 * References: Entities.ts, Component system, Physics system
 */

import type { Entity as IEntity, Quaternion, Vector3 } from "../types";
import type { EntityData } from "../types/index";
import { Component, createComponent } from "../components";
import THREE from "../extras/three/three";
import { getPhysX } from "../physics/PhysXManager";
// NOTE: Import directly to avoid circular dependency through barrel file
// The barrel imports combat which imports MobEntity which extends Entity
import { type PhysXRigidDynamic } from "../systems/shared/interaction/Physics";
import { getWorldNetwork } from "../utils/SystemUtils";
import type { World } from "../core/World";
import { EventType } from "../types/events";
import { GAME_CONSTANTS } from "../constants/GameConstants";
import { ticksToMs } from "../utils/game/CombatCalculations";
import type { MeshUserData } from "../types/core/core";
import type { Position3D } from "../types/index";
import type { EntityInteractionData, EntityConfig } from "../types/entities";
import { EntityType } from "../types/entities";
import { toPosition3D } from "../types/core/utilities";
import { UIRenderer } from "../utils/rendering/UIRenderer";
import { modelCache } from "../utils/rendering/ModelCache";
import type {
  HealthBars as HealthBarsSystem,
  HealthBarHandle,
} from "../systems/client/HealthBars";
// HLOD Impostor support
import {
  ImpostorManager,
  BakePriority,
  type ImpostorOptions,
  LODLevel,
  type ImpostorInitOptions,
} from "../systems/shared/rendering";
import {
  createTSLImpostorMaterial,
  createImpostorMaterial,
  updateImpostorMaterial,
  type TSLImpostorMaterial,
  type ImpostorBakeResult,
  type DissolveConfig,
  type ImpostorViewData,
} from "@hyperscape/impostor";
import {
  getLODDistances,
  getLODConfig,
  type LODDistancesWithSq,
} from "../systems/shared/world/GPUVegetation";
// Re-export types for external use
export type { EntityConfig };

// Type alias for event callbacks (exported for API extractor)
export type EventCallback = (data: unknown) => void;

/**
 * Entity - Base class for all game objects in the 3D world.
 *
 * Provides core functionality for 3D representation, networking, physics,
 * and component-based architecture. All game objects inherit from Entity.
 */
export class Entity implements IEntity {
  /** Enable verbose HLOD debug logging (set in browser console: Entity.HLOD_DEBUG = true) */
  static HLOD_DEBUG = false;

  world: World;
  data: EntityData;
  id: string;
  name: string;
  type: string;
  node: THREE.Object3D<THREE.Object3DEventMap>;
  components: Map<string, Component>;
  velocity: Vector3;
  isPlayer: boolean;
  active: boolean = true;

  // Plugin-specific extensions
  base?:
    | {
        position: Vector3;
        visible?: boolean;
        children?: unknown[];
        parent?: unknown | null;
        quaternion?: Quaternion;
      }
    | THREE.Object3D;
  destroyed: boolean = false;

  // Physics body reference
  private rigidBody?: PhysXRigidDynamic;

  // Additional properties for plugin compatibility
  metadata?: Record<string, unknown>;

  protected config: EntityConfig;
  public mesh: THREE.Mesh | THREE.Group | THREE.Object3D | null = null;
  public nodes: Map<string, THREE.Object3D> = new Map(); // Child nodes by ID
  public worldNodes: Set<THREE.Object3D> = new Set(); // Nodes added to world
  public listeners: Record<string, Set<EventCallback>> = {}; // Event listeners
  public worldListeners: Map<(data: unknown) => void, string> = new Map(); // World event listeners

  // ============================================================================
  // HLOD IMPOSTOR SYSTEM
  // ============================================================================
  /** HLOD state - null if impostor not initialized */
  protected hlodState: {
    /** Model identifier for caching */
    modelId: string;
    /** Category for LOD distances */
    category: string;
    /** LOD distances with squared values */
    lodConfig: LODDistancesWithSq;
    /** Current LOD level */
    currentLOD: LODLevel;
    /** LOD0 mesh reference (full detail) */
    lod0Mesh: THREE.Object3D | null;
    /** LOD1 mesh reference (low-poly) - optional */
    lod1Mesh: THREE.Object3D | null;
    /** Impostor mesh (billboard) */
    impostorMesh: THREE.Mesh | null;
    /** Impostor material (TSL for WebGPU, ShaderMaterial for WebGL) */
    impostorMaterial: TSLImpostorMaterial | THREE.ShaderMaterial | null;
    /** Whether using WebGPU (TSL) or WebGL (GLSL) material */
    usesTSL: boolean;
    /** Bake result */
    bakeResult: ImpostorBakeResult | null;
    /** Whether impostor is ready */
    impostorReady: boolean;
    /** Whether impostor is being created */
    impostorPending: boolean;
    /** Dissolve config */
    dissolveConfig: DissolveConfig | null;
    /** Raycast mesh for view lookup */
    raycastMesh: THREE.Mesh | null;
    /** AAA LOD: Whether animations should freeze at LOD1 distance */
    freezeAnimationAtLOD1: boolean;
  } | null = null;

  // Temp objects for HLOD update loop (avoid allocations)
  private _hlodViewDir = new THREE.Vector3();
  private _hlodRayOrigin = new THREE.Vector3();
  private _hlodRayDirection = new THREE.Vector3();
  private _hlodRaycaster = new THREE.Raycaster();
  protected lastUpdate = 0;

  protected health: number = 0;
  protected maxHealth: number = 100;
  protected level: number = 1;

  // UI elements - Atlas-based (HealthBars system uses instanced mesh)
  // Names shown in right-click context menu only (OSRS pattern)
  private _entityHealthBarHandle: HealthBarHandle | null = null;

  // Pre-allocated matrix for health bar position updates
  private readonly _uiPositionMatrix = new THREE.Matrix4();

  // Legacy sprite properties (kept for backwards compatibility with subclasses)
  protected nameSprite: THREE.Sprite | null = null;
  protected healthSprite: THREE.Sprite | null = null;

  // Network state
  public networkDirty = false; // Needs network sync
  public networkVersion = 0; // Version for conflict resolution

  // Interpolation state
  protected networkPos?: Position3D;
  protected networkQuat?: THREE.Quaternion;
  protected networkSca?: Position3D;

  constructor(
    world: World,
    dataOrConfig: EntityData | EntityConfig,
    _local?: boolean,
  ) {
    this.world = world;

    // Handle both EntityData and EntityConfig formats
    let entityData: EntityData;
    let config: EntityConfig | undefined;

    // Strong type assumption - check array to distinguish EntityData from EntityConfig
    if (Array.isArray((dataOrConfig as EntityData).position)) {
      // It's EntityData format
      entityData = dataOrConfig as EntityData;
    } else {
      // It's EntityConfig format
      config = dataOrConfig as EntityConfig;

      // Strong type assumption - EntityConfig.position always has valid x, y, z coordinates
      // If NaN values appear, that's a bug in the calling code that should be fixed at the source
      const validX = config.position.x || 0;
      const validY = config.position.y || 0;
      const validZ = config.position.z || 0;

      // Convert EntityConfig to EntityData format
      entityData = {
        id: config.id,
        name: config.name,
        type: config.type,
        position: [validX, validY, validZ],
        quaternion: config.rotation
          ? [
              config.rotation.x,
              config.rotation.y,
              config.rotation.z,
              config.rotation.w,
            ]
          : undefined,
        scale: config.scale
          ? [config.scale.x, config.scale.y, config.scale.z]
          : undefined,
      };
    }

    this.data = entityData;
    this.id = entityData.id;
    this.name = entityData.name || "entity";
    this.type = entityData.type || "generic";
    this.isPlayer = entityData.type === "player";

    // Initialize config
    if (config) {
      this.config = { ...config };
    } else {
      // Create default config from EntityData
      this.config = {
        id: entityData.id,
        name: entityData.name || "entity",
        type: this.mapStringToEntityType(entityData.type),
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        interactable: false,
        interactionType: null,
        interactionDistance: 5,
        description: "",
        model: null,
        properties: {
          movementComponent: null,
          combatComponent: null,
          healthComponent: null,
          visualComponent: null,
          health: { current: this.health, max: this.maxHealth },
          level: 1,
        },
      };
    }

    // Initialize components map
    this.components = new Map();

    // Create Three.js node
    this.node = new THREE.Object3D() as THREE.Object3D<THREE.Object3DEventMap>;
    this.node.name = this.name;
    this.node.userData.entity = this;

    // Set up userData with proper typing
    const userData: MeshUserData = {
      type: this.mapEntityTypeToString(this.config.type),
      entityId: this.id,
      name: this.config.name,
      interactable: this.config.interactable,
      mobData: null, // Most entities are not mobs, override in MobEntity
      ...this.node.userData, // Preserve any existing userData
    };
    this.node.userData = userData;

    // Set default transform values and apply initial transform from EntityData when present
    this.node.position.set(0, 0, 0);
    this.node.quaternion.set(0, 0, 0, 1);
    this.node.scale.set(1, 1, 1); // Always assume scale of 1,1,1
    if (
      Array.isArray(entityData.position) &&
      entityData.position.length === 3
    ) {
      const [px, py, pz] = entityData.position as [number, number, number];

      // Player position logging removed to prevent memory leak

      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        this.node.position.set(px, py, pz);

        // Don't throw on low Y values - the server sends the correct position but terrain might not be ready yet
        // The position will be corrected by server updates
        if (entityData.type === "player" && Math.abs(py) < 0.5) {
          console.warn(
            `[Entity] Player ${entityData.id} spawning at low Y=${py}. Will be corrected by server.`,
          );
        }
      } else {
        if (entityData.type === "player") {
          throw new Error(
            `[Entity] Player ${entityData.id} has invalid position values: [${px}, ${py}, ${pz}]`,
          );
        }
      }
    } else if (entityData.type === "player") {
      console.error("[Entity] Player entityData:", entityData);
      throw new Error(
        `[Entity] Player ${entityData.id} has no valid position in entityData`,
      );
    }
    if (
      Array.isArray(entityData.quaternion) &&
      entityData.quaternion.length === 4
    ) {
      const [qx, qy, qz, qw] = entityData.quaternion as [
        number,
        number,
        number,
        number,
      ];
      if (
        Number.isFinite(qx) &&
        Number.isFinite(qy) &&
        Number.isFinite(qz) &&
        Number.isFinite(qw)
      ) {
        this.node.quaternion.set(qx, qy, qz, qw);
      }
    }

    this.velocity = new THREE.Vector3(0, 0, 0);

    // Check health from multiple sources (in priority order):
    // 1. config.properties.health (if EntityConfig was passed)
    // 2. entityData.health and entityData.maxHealth (if EntityData was passed)
    // 3. Default to 100/100
    const healthData = config?.properties?.health as
      | { current: number; max: number }
      | undefined;
    if (healthData) {
      this.health = healthData.current;
      this.maxHealth = healthData.max;
    } else {
      // Check if EntityData has health property (e.g., from server spawn)
      const entityDataWithHealth = entityData as unknown as {
        health?: number;
        maxHealth?: number;
      };
      if (entityDataWithHealth.health !== undefined) {
        const entityHealth = entityDataWithHealth.health;
        const entityMaxHealth = entityDataWithHealth.maxHealth;
        this.health =
          Number.isFinite(entityHealth) && entityHealth > 0
            ? entityHealth
            : GAME_CONSTANTS.PLAYER.DEFAULT_HEALTH;
        this.maxHealth =
          Number.isFinite(entityMaxHealth) &&
          entityMaxHealth !== undefined &&
          entityMaxHealth > 0
            ? entityMaxHealth
            : this.health;
      } else {
        this.health = GAME_CONSTANTS.PLAYER.DEFAULT_HEALTH;
        this.maxHealth = GAME_CONSTANTS.PLAYER.DEFAULT_MAX_HEALTH;
      }
    }
    this.level = (config?.properties?.level as number) || 1;

    // Initialize health in entity data for network sync
    this.data.health = this.health;
    (this.data as { maxHealth?: number }).maxHealth = this.maxHealth;

    // Add to world scene
    if (this.world.stage.scene) {
      this.world.stage.scene.add(this.node);
    }

    // Automatically add transform component for ECS architecture
    this.addComponent("transform", {
      position: this.position,
      rotation: this.rotation,
      scale: this.scale,
    });

    // Initialize common components
    this.initializeRPGComponents();

    // Removed duplicate entityAdded broadcast
    // EntityManager.spawnEntity() is the single source of truth for entity broadcasts
    // This prevents duplicate packets when entities are spawned via EntityManager
  }

  // Transform getters - return THREE.Vector3 instances
  get position(): Vector3 {
    return this.node.position;
  }

  set position(value: Vector3) {
    this.node.position.set(value.x, value.y, value.z);
    this.syncPhysicsTransform();
  }

  get rotation(): Quaternion {
    // Return reference instead of cloning - callers should clone if needed
    return this.node.quaternion;
  }

  set rotation(value: Quaternion) {
    this.node.quaternion.set(value.x, value.y, value.z, value.w);
    this.syncPhysicsTransform();
  }

  get scale(): Vector3 {
    // Strong type assumption - node.scale is always Vector3
    return this.node.scale;
  }

  set scale(value: Vector3) {
    this.node.scale.set(value.x, value.y, value.z);
  }

  // Component management
  addComponent<T extends Component = Component>(
    type: string,
    data?: Record<string, unknown>,
  ): T {
    // Check if component already exists
    if (this.components.has(type)) {
      console.warn(`Entity ${this.id} already has component ${type}`);
      // Strong type assumption - component is guaranteed to exist and be of correct type
      return this.components.get(type)! as T;
    }

    // Create component using the registry
    const component = createComponent(type, this, data);
    if (!component) {
      // Unknown component type - skip gracefully for headless clients
      return null as unknown as T;
    }

    // Store component
    this.components.set(type, component);

    // Initialize component if it has an init method
    if (component.init) {
      component.init();
    }

    // Handle special component types (legacy compatibility)
    this.handleSpecialComponent(type, component);

    // Emit event
    this.world.emit(EventType.ENTITY_COMPONENT_ADDED, {
      entityId: this.id,
      componentType: type,
      component,
    });

    // Strong type assumption - component creation succeeded
    return component as T;
  }

  removeComponent(type: string): void {
    const component = this.components.get(type);
    if (!component) return;

    // Destroy component if it has destroy method
    if (component.destroy) {
      component.destroy();
    }

    // Handle special component cleanup
    this.handleSpecialComponentRemoval(type, component);

    // Remove from map
    this.components.delete(type);

    // Emit event
    this.world.emit(EventType.ENTITY_COMPONENT_REMOVED, {
      entityId: this.id,
      componentType: type,
    });
  }

  getComponent<T extends Component = Component>(type: string): T | null {
    const component = this.components.get(type);
    return component ? (component as T) : null;
  }

  hasComponent(type: string): boolean {
    return this.components.has(type);
  }

  removeAllComponents(): void {
    // Remove all components
    for (const type of Array.from(this.components.keys())) {
      this.removeComponent(type);
    }
  }

  // Physics methods
  applyForce(force: Vector3): void {
    if (!this.rigidBody) return;
    const PhysX = getPhysX();
    const physicsForce = new PhysX!.PxVec3(force.x, force.y, force.z);
    this.rigidBody.addForce(physicsForce);
  }

  applyImpulse(impulse: Vector3): void {
    if (!this.rigidBody) return;

    const PhysX = getPhysX();

    // Assume rigidBody has getMass, getLinearVelocity, and setLinearVelocity methods
    const mass = this.rigidBody.getMass();
    const currentVel = this.rigidBody.getLinearVelocity();
    const deltaV = new PhysX!.PxVec3(
      impulse.x / mass,
      impulse.y / mass,
      impulse.z / mass,
    );
    // Add deltaV to currentVel
    const newVel = new PhysX!.PxVec3(
      currentVel.x + deltaV.x,
      currentVel.y + deltaV.y,
      currentVel.z + deltaV.z,
    );
    this.rigidBody.setLinearVelocity(newVel, true);
  }

  // Set velocity updates the THREE.Vector3 instance and syncs with physics if enabled
  setVelocity(vel: Vector3): void {
    this.velocity.copy(vel);

    // Apply to physics body if available
    if (this.rigidBody) {
      this.world.physics.setLinearVelocity(this.rigidBody, this.velocity);
    }
  }

  // Get velocity returns the THREE.Vector3 instance
  getVelocity(): Vector3 {
    return this.velocity;
  }

  // Late update methods - for components
  lateUpdate(delta: number): void {
    // Update components with lateUpdate
    for (const component of this.components.values()) {
      if (component.lateUpdate) {
        component.lateUpdate(delta);
      }
    }
  }

  postLateUpdate(delta: number): void {
    // Update components with postLateUpdate
    for (const component of this.components.values()) {
      if (component.postLateUpdate) {
        component.postLateUpdate(delta);
      }
    }
  }

  // Serialization
  serialize(): EntityData {
    const serialized: EntityData = {
      id: this.id,
      name: this.name,
      type: this.type,
      // CRITICAL: Use current position from node, not stale data
      position: [
        this.node.position.x,
        this.node.position.y,
        this.node.position.z,
      ],
      quaternion: [
        this.node.quaternion.x,
        this.node.quaternion.y,
        this.node.quaternion.z,
        this.node.quaternion.w,
      ],
      // Add data properties dynamically
    };

    // Copy data properties - assume all enumerable properties should be serialized
    for (const key in this.data) {
      // Skip position and quaternion as we've already set them from node
      if (key === "position" || key === "quaternion") continue;

      // Strong assumption - if key exists in data, it should be serialized
      const value = this.data[key as keyof EntityData];
      if (value !== undefined) {
        Object.defineProperty(serialized, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    return serialized;
  }

  // Modification from network/data
  modify(data: Partial<EntityData>): void {
    // Update data - transform properties no longer part of EntityData
    Object.assign(this.data, data);

    // Transform is now handled directly by Entity, not through data
    // Use setPosition(), setRotation() methods instead for transform updates
  }

  // Network event handling
  onEvent(
    version: number,
    name: string,
    data: unknown,
    networkId: string,
  ): void {
    // Handle entity-specific network events
    this.world.emit(`entity:${this.id}:network:${name}`, {
      version,
      data,
      networkId,
    });
  }

  // Helper methods
  syncPhysicsTransform(): void {
    if (!this.rigidBody || !this.world.physics?.world) return;

    // Sync Three.js transform to physics body
    const pos = this.position;
    const rot = this.rotation;

    const PhysX = getPhysX();
    if (!PhysX) return;

    const transform = new PhysX.PxTransform(
      new PhysX.PxVec3(pos.x, pos.y, pos.z),
      new PhysX.PxQuat(rot.x, rot.y, rot.z, rot.w),
    );

    this.rigidBody.setGlobalPose(transform);

    // PhysX manages object lifecycle - no manual deletion needed
  }

  handleSpecialComponent(type: string, component: Component): void {
    switch (type) {
      case "rigidbody":
        this.createPhysicsBody(component);
        break;
      case "collider":
        this.updateCollider(component);
        break;
      case "mesh":
        this.updateMesh(component);
        break;
    }
  }

  private handleSpecialComponentRemoval(
    type: string,
    component: Component,
  ): void {
    switch (type) {
      case "rigidbody":
        this.removePhysicsBody();
        break;
      case "mesh":
        this.removeMesh(component);
        break;
    }
  }

  private createPhysicsBody(_component: Component): void {
    // Create physics rigid body based on component data
    // Implementation depends on physics engine integration
  }

  private removePhysicsBody(): void {
    if (this.rigidBody) {
      // Remove from physics world
      this.rigidBody = undefined;
    }
  }

  private updateCollider(_component: Component): void {
    // Update physics collider shape
    // Implementation depends on physics engine
  }

  private updateMesh(component: Component): void {
    // Add/update Three.js mesh from component data
    const meshData = component.data;
    if (meshData.geometry && meshData.material) {
      // Create or update mesh
    }
  }

  private removeMesh(_component: Component): void {
    // Remove mesh from node
    // Implementation depends on mesh management
  }

  private isDefaultRotation(): boolean {
    return (
      this.rotation.x === 0 &&
      this.rotation.y === 0 &&
      this.rotation.z === 0 &&
      this.rotation.w === 1
    );
  }

  private isDefaultScale(): boolean {
    return this.scale.x === 1 && this.scale.y === 1 && this.scale.z === 1;
  }

  /**
   * Convert EntityType enum to string for MeshUserData
   */
  private mapEntityTypeToString(
    type: EntityType,
  ): "player" | "mob" | "item" | "npc" | "resource" | "static" {
    switch (type) {
      case EntityType.PLAYER:
        return "player";
      case EntityType.MOB:
        return "mob";
      case EntityType.ITEM:
        return "item";
      case EntityType.NPC:
        return "npc";
      case EntityType.RESOURCE:
        return "resource";
      case EntityType.STATIC:
      default:
        return "static";
    }
  }

  private mapStringToEntityType(type?: string): EntityType {
    if (!type) return EntityType.STATIC;

    switch (type.toLowerCase()) {
      case "player":
        return EntityType.PLAYER;
      case "mob":
        return EntityType.MOB;
      case "item":
        return EntityType.ITEM;
      case "npc":
        return EntityType.NPC;
      case "resource":
        return EntityType.RESOURCE;
      case "static":
      default:
        return EntityType.STATIC;
    }
  }
  /**
   * Initialize common components - merged from BaseEntity
   */
  protected initializeRPGComponents(): void {
    this.addHealthComponent();
    this.addCombatComponent();
    this.addVisualComponent();
  }

  /**
   * Add health component with standard properties
   */
  protected addHealthComponent(): void {
    this.addComponent("health", {
      current: this.health,
      max: this.maxHealth,
      regenerationRate: GAME_CONSTANTS.PLAYER.HEALTH_REGEN_RATE,
      isDead: false,
    });
  }

  /**
   * Add combat component with standard properties
   */
  protected addCombatComponent(): void {
    this.addComponent("combat", {
      isInCombat: false,
      target: null,
      lastAttackTime: 0,
      attackCooldown: ticksToMs(
        GAME_CONSTANTS.COMBAT.DEFAULT_ATTACK_SPEED_TICKS,
      ),
      damage: GAME_CONSTANTS.COMBAT.MIN_DAMAGE,
      range: GAME_CONSTANTS.COMBAT.MELEE_RANGE,
    });
  }

  /**
   * Add visual component with mesh and UI sprites
   */
  protected addVisualComponent(): void {
    this.addComponent("visual", {
      mesh: null,
      nameSprite: null,
      healthSprite: null,
      isVisible: true,
    });
  }

  /**
   * Initialize visual elements (mesh, health bar) - from BaseEntity
   * Names shown in right-click context menu only (OSRS pattern)
   */
  protected initializeVisuals(): void {
    // Create main mesh - implemented by subclasses
    // Note: createMesh is async in Entity, so this will be called from init()

    // Only create health bars for combat entities (players and mobs)
    // Items, NPCs, and other entities should not have health bars
    const isCombatEntity = this.type === "player" || this.type === "mob";
    if (this.maxHealth > 0 && isCombatEntity) {
      this.createHealthBar();
    }

    // Update visual component
    const visualComponent = this.getComponent("visual");
    if (visualComponent && visualComponent.data) {
      visualComponent.data.mesh = this.mesh;
      visualComponent.data.nameSprite = this.nameSprite;
      visualComponent.data.healthSprite = this.healthSprite;
    }
  }

  /**
   * Create health bar using atlas-based HealthBars system (instanced mesh)
   * PERFORMANCE: Uses texture atlas + instanced mesh for O(1) draw calls
   * Falls back to legacy sprite creation if HealthBars system unavailable
   */
  protected createHealthBar(): void {
    // Try to use atlas-based HealthBars system (much more efficient)
    const healthbars = this.world.getSystem?.("healthbars") as
      | HealthBarsSystem
      | undefined;

    if (healthbars) {
      // Atlas-based: Register with HealthBars system
      this._entityHealthBarHandle = healthbars.add(
        this.id,
        this.health,
        this.maxHealth,
      );
      // Health bar starts hidden (RuneScape pattern: show during combat)
      // Position update happens in clientUpdate() via handle.move()
      return;
    }

    // Fallback: Legacy sprite creation (less efficient but works without system)
    const healthCanvas = UIRenderer.createHealthBar(
      this.health,
      this.maxHealth,
      {
        width: GAME_CONSTANTS.UI.HEALTH_BAR_WIDTH,
        height: GAME_CONSTANTS.UI.HEALTH_BAR_HEIGHT,
        borderWidth: GAME_CONSTANTS.UI.HEALTH_BAR_BORDER,
      },
    );

    this.healthSprite = UIRenderer.createSpriteFromCanvas(
      healthCanvas,
      GAME_CONSTANTS.UI.HEALTH_SPRITE_SCALE,
    );
    if (this.healthSprite) {
      this.healthSprite.position.set(0, 2.0, 0);
      if (this.node) {
        this.node.add(this.healthSprite);
      }
    }
  }

  /**
   * Update health bar - supports both atlas and legacy sprite systems
   */
  protected updateHealthBar(): void {
    // Atlas-based system (preferred)
    if (this._entityHealthBarHandle) {
      this._entityHealthBarHandle.setHealth(this.health, this.maxHealth);
      return;
    }

    // Legacy sprite system (fallback)
    if (!this.healthSprite) {
      return;
    }

    const healthCanvas = UIRenderer.createHealthBar(
      this.health,
      this.maxHealth,
      {
        width: GAME_CONSTANTS.UI.HEALTH_BAR_WIDTH,
        height: GAME_CONSTANTS.UI.HEALTH_BAR_HEIGHT,
        borderWidth: GAME_CONSTANTS.UI.HEALTH_BAR_BORDER,
      },
    );

    UIRenderer.updateSpriteTexture(this.healthSprite, healthCanvas);
  }

  /**
   * Update health and refresh health bar - from BaseEntity
   */
  public setHealth(newHealth: number): void {
    this.health = Math.max(0, Math.min(this.maxHealth, newHealth));

    // Update health in entity data for network sync
    this.data.health = this.health;
    (this.data as { maxHealth?: number }).maxHealth = this.maxHealth;

    // Update health component
    const healthComponent = this.getComponent("health");
    if (healthComponent && healthComponent.data) {
      healthComponent.data.current = this.health;
      healthComponent.data.isDead = this.health <= 0;
    }

    // Update health bar visual
    this.updateHealthBar();

    // Mark entity as dirty for network sync
    this.markNetworkDirty();

    // Emit health change event
    this.world.emit(EventType.ENTITY_HEALTH_CHANGED, {
      entityId: this.id,
      health: this.health,
      maxHealth: this.maxHealth,
      isDead: this.health <= 0,
    });
  }

  /**
   * Damage this entity - from BaseEntity
   */
  public damage(amount: number, source?: string): boolean {
    if (this.health <= 0) return false;

    const newHealth = this.health - amount;
    this.setHealth(newHealth);

    // Emit damage event
    this.world.emit(EventType.ENTITY_DAMAGED, {
      entityId: this.id,
      damage: amount,
      sourceId: source,
      remainingHealth: this.health,
      isDead: this.health <= 0,
    });

    return true;
  }

  /**
   * Heal this entity - from BaseEntity
   */
  public heal(amount: number): boolean {
    if (this.health >= this.maxHealth) return false;

    const newHealth = this.health + amount;
    this.setHealth(newHealth);

    // Emit heal event
    this.world.emit(EventType.ENTITY_HEALED, {
      entityId: this.id,
      healAmount: amount,
      newHealth: this.health,
    });

    return true;
  }

  /**
   * Check if entity is alive - from BaseEntity
   */
  public isAlive(): boolean {
    return this.health > 0;
  }

  /**
   * Check if entity is dead - from BaseEntity
   */
  public isDead(): boolean {
    return this.health <= 0;
  }

  /**
   * Get entity's current health - from BaseEntity
   */
  public getHealth(): number {
    return this.health;
  }

  /**
   * Get entity's maximum health - from BaseEntity
   */
  public getMaxHealth(): number {
    return this.maxHealth;
  }

  /**
   * Get entity's level - from BaseEntity
   */
  public getLevel(): number {
    return this.level;
  }

  /**
   * Set entity level - from BaseEntity
   */
  public setLevel(newLevel: number): void {
    this.level = Math.max(1, newLevel);

    // Emit level change event
    this.world.emit(EventType.ENTITY_LEVEL_CHANGED, {
      entityId: this.id,
      newLevel: this.level,
    });
  }

  // Position getter/setter compatibility methods for Position3D
  public getPosition(): Position3D {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
    };
  }

  public setPosition(
    posOrX: Position3D | number,
    y?: number,
    z?: number,
  ): void {
    // Strong type assumption - if y and z are provided, posOrX is a number
    if (y !== undefined && z !== undefined) {
      const x = posOrX as number;
      this.position.set(x, y, z);
      this.config.position = { x, y, z };
    } else {
      // Strong type assumption - posOrX is Position3D
      const pos = posOrX as Position3D;
      this.position.set(pos.x, pos.y, pos.z);
      this.config.position = { x: pos.x, y: pos.y, z: pos.z };
    }
    // Position is already set via this.position, no sync needed
    this.markNetworkDirty();
  }

  getDistanceTo(point: Position3D): number {
    const pos = this.getPosition();
    const dx = pos.x - point.x;
    const dy = pos.y - point.y;
    const dz = pos.z - point.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  isPlayerInRange(playerPosition: Position3D): boolean {
    const distance = this.getDistanceTo(playerPosition);
    return distance <= (this.config.interactionDistance || 5);
  }

  /**
   * Check if we're running in a client environment with full browser APIs
   * This is more robust than just checking world.isClient as it verifies actual Canvas API availability
   */
  protected isClientEnvironment(): boolean {
    // First check the world and network flags - if explicitly server, return false
    if (this.world.network && this.world.network.isServer === true) {
      return false;
    }

    // Check if explicitly client
    if (
      this.world.isClient === true ||
      (this.world.network && this.world.network.isClient === true)
    ) {
      return true;
    }

    // Strong type assumption - if we reach here and have document, we're in a browser
    // The presence of document is determined at compile/bundle time
    return false;
  }

  async init(): Promise<void> {
    // Create the visual representation (mesh)
    // Note: createMesh() in subclasses may call loadModel() internally
    await this.createMesh();

    // Initialize UI elements (name tag, health bar) - only on client
    // Check if we're in a real browser environment with full Canvas API support
    const isClientEnvironment = this.isClientEnvironment();

    if (isClientEnvironment) {
      this.initializeVisuals();
    }

    // Set up interaction system
    this.setupInteraction();

    // Call custom initialization
    await this.onInit();

    // FINAL VALIDATION (only on client where we have meshes)
    if (!this.world.isServer) {
      this.validateEntityState();
    }
  }

  /**
   * Validate entity is in valid state
   */
  private validateEntityState(): void {
    // Check node is in scene
    if (!this.node.parent) {
      console.error(
        `[Entity] ⚠️  WARNING: Entity ${this.name} node has no parent (not in scene)`,
      );
      // Don't throw - might be intentional
    }

    const shouldHaveMesh = this.type === "player" || this.type === "mob";
    if (!this.mesh && shouldHaveMesh) {
      console.warn(
        `[Entity] ⚠️  Entity ${this.name} (${this.type}) has no mesh - may be server-side`,
      );
    }

    // Check mesh is added to node (skip for VRM entities which manage their own positioning)
    const isVRM = this.config?.model?.endsWith(".vrm");
    if (this.mesh && !this.node.children.includes(this.mesh) && !isVRM) {
      console.error(
        `[Entity] ⚠️  WARNING: Entity ${this.name} mesh is not a child of node`,
      );
    }

    // Check position is reasonable
    const pos = this.node.position;
    if (
      !Number.isFinite(pos.x) ||
      !Number.isFinite(pos.y) ||
      !Number.isFinite(pos.z)
    ) {
      console.error(
        `[Entity] ❌ CRITICAL: Entity ${this.name} has invalid position: ${pos.toArray()}`,
      );
      throw new Error(`Entity ${this.name} has NaN/Infinity position`);
    }

    if (pos.y < -200) {
      console.error(
        `[Entity] ❌ CRITICAL: Entity ${this.name} is below the world: Y=${pos.y.toFixed(2)}`,
      );
      throw new Error(
        `Entity ${this.name} spawned below world (Y=${pos.y.toFixed(2)})`,
      );
    }

    if (pos.y > 2000) {
      console.error(
        `[Entity] ❌ CRITICAL: Entity ${this.name} is way above the world: Y=${pos.y.toFixed(2)}`,
      );
      throw new Error(
        `Entity ${this.name} spawned way above world (Y=${pos.y.toFixed(2)})`,
      );
    }
  }

  protected async loadModel(): Promise<void> {
    if (!this.config.model) {
      return;
    }

    // Skip model loading on server side - models are only needed for client rendering
    if (this.world.isServer) {
      return;
    }

    // Use ModelCache to load with caching
    // ModelCache uses its own GLTFLoader to ensure pure THREE.Object3D (not Hyperscape Nodes)
    const { scene } = await modelCache.loadModel(this.config.model, this.world);

    // Clear existing mesh first
    if (this.mesh) {
      this.node.remove(this.mesh);
    }

    // Use the cloned scene
    this.mesh = scene;
    this.mesh.name = `${this.name}_Model`;

    // Set up userData
    const userData: MeshUserData = {
      type: this.mapEntityTypeToString(this.config.type),
      entityId: this.id,
      name: this.config.name,
      interactable: this.config.interactable,
      mobData: null,
    };
    this.mesh.userData = userData;

    // PERFORMANCE: Set entity mesh to layer 1 (main camera only, not minimap)
    // Minimap only renders terrain (layer 0) and uses 2D dots for entities
    this.mesh.layers.set(1);
    this.mesh.traverse((child) => {
      child.layers.set(1);
    });

    // Collect all child nodes
    this.collectNodes(this.mesh);

    // Add to node (which is already in the scene)
    this.node.add(this.mesh);

    // VALIDATE: Ensure mesh was actually added
    if (this.node.children.length === 0) {
      throw new Error(
        `Mesh was not added to node! Node has ${this.node.children.length} children`,
      );
    }

    // VALIDATE: Check position is reasonable
    const pos = this.node.position;
    if (pos.y < -100 || pos.y > 1000) {
      console.warn(
        `[Entity] Entity ${this.name} has extreme Y position: ${pos.y.toFixed(2)}`,
      );
    }

    // Check if entity is in the scene
    let inScene = false;
    let currentParent = this.node.parent;
    let depth = 0;
    while (currentParent && depth < 10) {
      if (currentParent === this.world.stage.scene) {
        inScene = true;
        break;
      }
      currentParent = currentParent.parent;
      depth++;
    }

    if (!inScene) {
      throw new Error(
        `Entity node is not in scene graph! Parent chain depth: ${depth}`,
      );
    }

    // Calculate bounding box to verify model size
    const bbox = new THREE.Box3().setFromObject(this.mesh);
    const size = bbox.getSize(new THREE.Vector3());

    // CRITICAL: Throw error if model is invisible
    if (!this.mesh.visible) {
      throw new Error(`Loaded model is not visible! Mesh.visible = false`);
    }

    // CRITICAL: Throw error if model is tiny
    if (size.x < 0.01 && size.y < 0.01 && size.z < 0.01) {
      throw new Error(
        `Loaded model is too small to see! Size: ${size.x}x${size.y}x${size.z}m`,
      );
    }
  }

  /**
   * Validate that a scene has actual geometry (not just empty groups)
   */
  private validateSceneHasGeometry(scene: THREE.Object3D): boolean {
    let hasMesh = false;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        hasMesh = true;
      }
    });
    return hasMesh;
  }

  protected collectNodes(node: THREE.Object3D): void {
    if (node.name) {
      this.nodes.set(node.name, node);
    }

    node.children.forEach((child) => {
      this.collectNodes(child as THREE.Object3D);
    });
  }

  // Default mesh creation - override in subclasses
  protected async createMesh(): Promise<void> {
    // DISABLED: Default cube mesh causes visual clutter
    // Subclasses (MobEntity, PlayerEntity, etc.) should override this with proper meshes
    // If they don't, the entity will simply have no visible mesh (which is fine for server-side entities)
    // DO NOT CREATE DEFAULT CUBE MESH
    // this.mesh remains null, which is valid for:
    // - Server-side entities
    // - Entities waiting for proper models to load
    // - Abstract entities that don't need visuals
    // Subclasses like MobEntity, PlayerEntity, ItemEntity override this method
    // and create appropriate meshes (capsules, models, etc.)
  }

  // Default interaction handler - override in subclasses
  protected async onInteract(data: EntityInteractionData): Promise<void> {
    // Default implementation logs interaction

    // Emit interaction event
    this.world.emit(EventType.ENTITY_INTERACTED, {
      entityId: this.id,
      playerId: data.playerId,
      position: data.playerPosition,
    });
  }

  // Custom initialization hook
  protected async onInit(): Promise<void> {
    // Override in subclasses if needed
  }

  private setupInteraction(): void {
    // Set up interaction target with proper typing
    const target = this.mesh || this.node;
    const userData: MeshUserData = {
      type: this.mapEntityTypeToString(this.config.type),
      entityId: this.id,
      name: this.config.name,
      interactable: this.config.interactable,
      mobData: null,
      interactionDistance: this.config.interactionDistance,
      interactionType: this.config.interactionType || undefined,
    };
    target.userData = userData;

    // Listen for interaction events and track handler for cleanup
    const onInteractHandler = async (data: unknown) => {
      const typed = data as EntityInteractionData;
      if (typed && typed.entityId === this.id) {
        await this.onInteract(typed);
      }
    };
    this.world.on(EventType.ENTITY_INTERACT, onInteractHandler);
    // Track listener with exact function reference and event name
    this.worldListeners.set(onInteractHandler, EventType.ENTITY_INTERACT);
  }

  update(delta: number): void {
    // Update components
    for (const component of this.components.values()) {
      if (component.update) {
        component.update(delta);
      }
    }

    const now = this.world.getTime();
    if (now - this.lastUpdate < 0.016) return; // Limit to ~60fps (16ms in seconds)
    this.lastUpdate = now;

    // Update based on client/server
    if (this.world.isServer) {
      this.serverUpdate(delta);
    } else {
      this.clientUpdate(delta);
    }
  }

  // Server-side update logic
  protected serverUpdate(_deltaTime: number): void {
    // Override in subclasses for server-specific logic
  }

  // Client-side update logic
  protected clientUpdate(_deltaTime: number): void {
    // Update atlas-based UI element positions (health bar)
    // These use instanced mesh, so we just need to update the position matrix
    if (this._entityHealthBarHandle) {
      // Health bar at Y=2.0
      this._uiPositionMatrix.elements[13] =
        this.node.matrixWorld.elements[13] + 2.0;
      this._entityHealthBarHandle.move(this._uiPositionMatrix);
    }

    // Update HLOD impostor if initialized
    if (this.hlodState && this.world.camera) {
      this.updateHLOD(this.world.camera.position);
    }

    // Subclasses can override for additional client-specific logic
  }

  // ============================================================================
  // HLOD IMPOSTOR METHODS
  // ============================================================================

  /**
   * Initialize HLOD (Hierarchical Level of Detail) impostor support for this entity.
   * Call this after the entity's mesh is loaded to enable billboard rendering at distance.
   *
   * AAA LOD System:
   * - **LOD0 (close)**: Full detail mesh with animations playing
   * - **LOD1 (medium)**: 3D mesh frozen in idle pose (no animation updates)
   * - **IMPOSTOR (far)**: Billboard baked in idle pose
   * - **CULLED (very far)**: Not rendered
   *
   * @param modelId - Unique identifier for caching (e.g., "bank_booth", "tree_oak")
   * @param options - HLOD configuration options including prepareForBake and freezeAnimationAtLOD1
   */
  protected async initHLOD(
    modelId: string,
    options: ImpostorInitOptions = {},
  ): Promise<void> {
    // Skip on server
    if (this.world.isServer || !this.mesh) return;

    const category = options.category ?? "resource";

    // Use size-based LOD scaling: larger objects visible from farther away
    // Compute bounding size from mesh if not explicitly provided
    const lodConfig = getLODConfig(category, options.boundingSize ?? this.mesh);

    // Detect if we're using WebGPU (TSL) or WebGL (GLSL)
    // WebGPU backend has isWebGPUBackend = true on renderer.backend
    const renderer = this.world.graphics?.renderer;
    const backend = renderer?.backend as
      | { isWebGPUBackend?: boolean }
      | undefined;
    const isWebGPU = !!backend?.isWebGPUBackend;

    // Diagnostic logging for renderer detection
    console.log(`[Entity HLOD] Renderer detection for ${this.name}:`, {
      hasGraphics: !!this.world.graphics,
      hasRenderer: !!renderer,
      hasBackend: !!backend,
      isWebGPUBackend: backend?.isWebGPUBackend,
      usesTSL: isWebGPU,
      rendererType: renderer?.constructor?.name ?? "unknown",
    });

    // Initialize HLOD state
    this.hlodState = {
      modelId,
      category,
      lodConfig,
      currentLOD: LODLevel.LOD0,
      lod0Mesh: this.mesh,
      lod1Mesh: options.lod1Mesh ?? null,
      impostorMesh: null,
      impostorMaterial: null,
      bakeResult: null,
      impostorReady: false,
      impostorPending: false,
      dissolveConfig:
        options.dissolve ??
        (options.enableDissolve !== false
          ? {
              enabled: true,
              fadeStart: lodConfig.imposterDistance + 20,
              fadeEnd: lodConfig.fadeDistance,
            }
          : null),
      raycastMesh: null,
      freezeAnimationAtLOD1: options.freezeAnimationAtLOD1 ?? false,
      usesTSL: isWebGPU,
    };

    // Request impostor generation (non-blocking)
    // prepareForBake is passed through and called by ImpostorManager RIGHT BEFORE baking
    this.requestHLODImpostor(this.mesh, options);
  }

  /**
   * AAA LOD: Check if animations should update based on current HLOD level.
   *
   * Returns true only at LOD0 (close range) when freezeAnimationAtLOD1 is enabled.
   * At LOD1 (medium distance), animations freeze to save CPU - entity shows static idle pose.
   * At IMPOSTOR/CULLED distances, entity uses billboard or is hidden entirely.
   *
   * Use this in clientUpdate() to determine if animation mixer should run:
   * ```typescript
   * if (this.shouldUpdateAnimationsForLOD()) {
   *   this.mixer.update(deltaTime);
   * }
   * ```
   *
   * @returns true if animations should update, false if frozen
   */
  protected shouldUpdateAnimationsForLOD(): boolean {
    if (!this.hlodState) return true; // No HLOD = always animate
    if (!this.hlodState.freezeAnimationAtLOD1) return true; // Not configured to freeze = always animate

    // Only animate at LOD0 (close range)
    // At LOD1+, show frozen idle pose to save CPU
    return this.hlodState.currentLOD === LODLevel.LOD0;
  }

  /**
   * Request impostor generation from ImpostorManager
   */
  private async requestHLODImpostor(
    source: THREE.Object3D,
    options: ImpostorInitOptions,
  ): Promise<void> {
    if (!this.hlodState || this.hlodState.impostorPending) return;

    const manager = ImpostorManager.getInstance(this.world);

    // Initialize baker if needed
    if (!manager.initBaker()) {
      console.warn(
        `[Entity] Cannot init HLOD for ${this.name}: baker not ready`,
      );
      return;
    }

    this.hlodState.impostorPending = true;

    const impostorOptions: ImpostorOptions = {
      atlasSize: options.atlasSize ?? 1024,
      hemisphere: options.hemisphere ?? true,
      priority: options.priority ?? BakePriority.NORMAL,
      category: this.hlodState.category,
      // AAA LOD: Pass prepareForBake to ImpostorManager - it calls it RIGHT BEFORE baking
      prepareForBake: options.prepareForBake,
    };

    try {
      const bakeResult = await manager.getOrCreate(
        this.hlodState.modelId,
        source,
        impostorOptions,
      );

      const meshCreated = this.createHLODImpostorMesh(bakeResult);
      this.hlodState.bakeResult = bakeResult;
      // Only mark as ready if mesh was actually created
      if (meshCreated) {
        this.hlodState.impostorReady = true;
        console.log(`[Entity HLOD] ✅ Impostor ready for ${this.name}`);
      } else {
        console.warn(
          `[Entity HLOD] ⚠️ Bake succeeded but mesh creation failed for ${this.name}`,
        );
      }
      this.hlodState.impostorPending = false;
    } catch (err) {
      console.warn(
        `[Entity] Failed to create HLOD impostor for ${this.name}:`,
        err,
      );
      this.hlodState.impostorPending = false;
    }
  }

  /**
   * Create the impostor mesh from bake result
   * @returns true if mesh was created successfully, false otherwise
   */
  private createHLODImpostorMesh(bakeResult: ImpostorBakeResult): boolean {
    if (!this.hlodState || !this.node) {
      console.warn(
        `[Entity HLOD] Cannot create impostor mesh for ${this.name}: no hlodState or node`,
      );
      return false;
    }

    const { gridSizeX, gridSizeY, atlasTexture, boundingSphere, boundingBox } =
      bakeResult;

    // Calculate mesh size from bounding sphere/box
    let width: number;
    let height: number;

    if (boundingBox) {
      const size = new THREE.Vector3();
      boundingBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      width = maxDim;
      height = maxDim;
    } else {
      width = boundingSphere.radius * 2;
      height = boundingSphere.radius * 2;
    }

    // Debug: Log bake result info
    console.log(`[Entity HLOD] Creating impostor mesh for ${this.name}:`, {
      gridSizeX,
      gridSizeY,
      atlasSize: atlasTexture?.image?.width ?? "no image",
      boundingSphereRadius: boundingSphere?.radius,
      dissolveEnabled: !!this.hlodState.dissolveConfig,
      fadeStart: this.hlodState.dissolveConfig?.fadeStart,
      fadeEnd: this.hlodState.dissolveConfig?.fadeEnd,
      usesTSL: this.hlodState.usesTSL,
    });

    // Create material based on renderer type (WebGPU uses TSL, WebGL uses GLSL)
    console.log(`[Entity HLOD] Creating material for ${this.name}:`, {
      usesTSL: this.hlodState.usesTSL,
      atlasTextureValid: !!atlasTexture,
      atlasHasImage: !!atlasTexture?.image,
      atlasImageWidth: atlasTexture?.image?.width ?? "none",
      atlasImageHeight: atlasTexture?.image?.height ?? "none",
      atlasColorSpace: atlasTexture?.colorSpace ?? "none",
      gridSizeX,
      gridSizeY,
      dissolveEnabled: !!this.hlodState.dissolveConfig,
    });

    let material: TSLImpostorMaterial | THREE.ShaderMaterial;

    if (this.hlodState.usesTSL) {
      console.log(`[Entity HLOD] Creating TSL material for ${this.name}`);
      // Use debugMode 4 (solid red) temporarily to verify shader runs
      // Change to 0 for normal rendering once verified
      const TSL_DEBUG_MODE = 0 as 0 | 1 | 2 | 3 | 4;
      material = createTSLImpostorMaterial({
        atlasTexture,
        gridSizeX,
        gridSizeY,
        transparent: true,
        depthWrite: true,
        dissolve: this.hlodState.dissolveConfig ?? undefined,
        debugMode: TSL_DEBUG_MODE,
      });
      console.log(`[Entity HLOD] TSL material created:`, {
        materialType: material.constructor.name,
        hasColorNode: !!(material as TSLImpostorMaterial).colorNode,
        hasImpostorUniforms: !!(material as TSLImpostorMaterial)
          .impostorUniforms,
        debugMode: TSL_DEBUG_MODE,
      });
    } else {
      console.log(`[Entity HLOD] Creating GLSL material for ${this.name}`);
      material = createImpostorMaterial({
        atlasTexture,
        gridSizeX,
        gridSizeY,
        transparent: true,
        depthWrite: true,
        dissolve: this.hlodState.dissolveConfig ?? undefined,
      });
    }

    // Create billboard mesh
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `HLOD_${this.name}`;
    mesh.visible = false; // Hidden initially (LOD0 active)
    mesh.layers.set(1); // Main camera only

    // Add to entity's node
    this.node.add(mesh);

    this.hlodState.impostorMesh = mesh;
    this.hlodState.impostorMaterial = material;

    // Create raycast mesh for view direction lookup
    if (bakeResult.octMeshData?.filledMesh) {
      const raycastGeometry = bakeResult.octMeshData.filledMesh.geometry;
      const raycastMesh = new THREE.Mesh(
        raycastGeometry,
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
      );
      raycastMesh.position.set(0, 0, 0);
      raycastMesh.updateMatrixWorld(true);
      this.hlodState.raycastMesh = raycastMesh;
    }

    return true;
  }

  /**
   * Update HLOD level based on camera distance
   *
   * AAA LOD System:
   * - LOD0: Full animations (close range)
   * - LOD1: Frozen animations (medium distance) - uses lod1Mesh if available, else lod0Mesh
   * - IMPOSTOR: Billboard (far distance)
   * - CULLED: Not rendered (very far)
   */
  protected updateHLOD(cameraPosition: THREE.Vector3): void {
    if (!this.hlodState) return;

    const {
      lodConfig,
      currentLOD,
      lod1Mesh,
      impostorMesh,
      impostorReady,
      freezeAnimationAtLOD1,
    } = this.hlodState;

    // Calculate squared distance to camera (horizontal only)
    const dx = this.node.position.x - cameraPosition.x;
    const dz = this.node.position.z - cameraPosition.z;
    const distSq = dx * dx + dz * dz;

    // Hysteresis factor to prevent flickering at LOD boundaries
    // Use 10% hysteresis: when moving closer, switch LOD at 90% of the threshold
    const hysteresis = 0.9;
    const hysteresisSq = hysteresis * hysteresis; // 0.81

    // Determine target LOD with hysteresis to prevent jitter
    // When moving AWAY (to higher LOD), use normal thresholds
    // When moving CLOSER (to lower LOD), require crossing 90% of threshold
    let targetLOD: LODLevel;

    const canUseLOD1 = lod1Mesh || freezeAnimationAtLOD1;

    // Check from farthest to closest
    if (distSq >= lodConfig.fadeDistanceSq) {
      // Far enough to cull
      targetLOD = LODLevel.CULLED;
    } else if (
      currentLOD === LODLevel.CULLED &&
      distSq >= lodConfig.fadeDistanceSq * hysteresisSq
    ) {
      // Hysteresis: stay culled until significantly closer
      targetLOD = LODLevel.CULLED;
    } else if (distSq >= lodConfig.imposterDistanceSq && impostorReady) {
      // Far enough for impostor
      targetLOD = LODLevel.IMPOSTOR;
    } else if (
      currentLOD === LODLevel.IMPOSTOR &&
      distSq >= lodConfig.imposterDistanceSq * hysteresisSq &&
      impostorReady
    ) {
      // Hysteresis: stay at impostor until significantly closer
      targetLOD = LODLevel.IMPOSTOR;
    } else if (distSq >= lodConfig.lod1DistanceSq && canUseLOD1) {
      // Medium distance - LOD1 (frozen animation)
      targetLOD = LODLevel.LOD1;
    } else if (
      currentLOD === LODLevel.LOD1 &&
      distSq >= lodConfig.lod1DistanceSq * hysteresisSq &&
      canUseLOD1
    ) {
      // Hysteresis: stay at LOD1 until significantly closer
      targetLOD = LODLevel.LOD1;
    } else {
      // Close range - full detail
      targetLOD = LODLevel.LOD0;
    }

    // Transition LOD if changed
    if (targetLOD !== currentLOD) {
      this.transitionHLOD(currentLOD, targetLOD);
    }

    // Update impostor view direction if active
    if (this.hlodState.currentLOD === LODLevel.IMPOSTOR && impostorMesh) {
      this.updateHLODImpostorView(cameraPosition);

      // Update dissolve player position uniform based on material type
      const mat = this.hlodState.impostorMaterial;
      if (mat) {
        if (this.hlodState.usesTSL) {
          // TSL material
          const tslMat = mat as TSLImpostorMaterial;
          if (tslMat.impostorUniforms?.playerPos) {
            tslMat.impostorUniforms.playerPos.value.copy(cameraPosition);
          }
        } else {
          // GLSL material
          const glslMat = mat as THREE.ShaderMaterial & {
            dissolveUniforms?: { playerPos: { value: THREE.Vector3 } };
          };
          if (glslMat.dissolveUniforms?.playerPos) {
            glslMat.dissolveUniforms.playerPos.value.copy(cameraPosition);
          }
        }
      }
    }
  }

  /**
   * Transition between LOD levels
   *
   * AAA LOD: When transitioning to LOD1 without a lod1Mesh, we keep lod0Mesh visible
   * but animations will be frozen (checked via shouldUpdateAnimationsForLOD).
   */
  private transitionHLOD(from: LODLevel, to: LODLevel): void {
    if (!this.hlodState) return;

    const { lod0Mesh, lod1Mesh, impostorMesh } = this.hlodState;

    // Debug logging for LOD transitions
    if (Entity.HLOD_DEBUG) {
      const lodNames = ["LOD0", "LOD1", "IMPOSTOR", "CULLED"];
      console.log(
        `[Entity HLOD] ${this.name}: ${lodNames[from]} → ${lodNames[to]} | impostor=${!!impostorMesh}, lod1=${!!lod1Mesh}, lod0=${!!lod0Mesh}`,
      );
    }

    // Hide previous LOD
    switch (from) {
      case LODLevel.LOD0:
        // Only hide lod0Mesh if we're transitioning to a level that has its own mesh
        // (either lod1Mesh exists, or we're going to IMPOSTOR/CULLED)
        if (lod0Mesh && (to !== LODLevel.LOD1 || lod1Mesh)) {
          lod0Mesh.visible = false;
        }
        break;
      case LODLevel.LOD1:
        // If we have a lod1Mesh, hide it; otherwise lod0Mesh was being shown
        if (lod1Mesh) {
          lod1Mesh.visible = false;
        } else if (lod0Mesh) {
          lod0Mesh.visible = false;
        }
        break;
      case LODLevel.IMPOSTOR:
        if (impostorMesh) impostorMesh.visible = false;
        break;
    }

    // Show new LOD
    switch (to) {
      case LODLevel.LOD0:
        if (lod0Mesh) lod0Mesh.visible = true;
        break;
      case LODLevel.LOD1:
        // AAA LOD: Use lod1Mesh if available, otherwise keep lod0Mesh visible (frozen)
        if (lod1Mesh) {
          lod1Mesh.visible = true;
        } else if (lod0Mesh) {
          lod0Mesh.visible = true;
        }
        break;
      case LODLevel.IMPOSTOR:
        if (impostorMesh) {
          impostorMesh.visible = true;
        } else {
          // Fallback: no impostor mesh available, keep best available 3D mesh visible
          // This prevents entities from disappearing while impostor is pending/failed
          console.warn(
            `[Entity HLOD] No impostor mesh for ${this.name}, falling back to 3D mesh`,
          );
          if (lod1Mesh) {
            lod1Mesh.visible = true;
          } else if (lod0Mesh) {
            lod0Mesh.visible = true;
          }
        }
        break;
      case LODLevel.CULLED:
        // Everything hidden - make sure both meshes are hidden
        if (lod0Mesh) lod0Mesh.visible = false;
        if (lod1Mesh) lod1Mesh.visible = false;
        break;
    }

    this.hlodState.currentLOD = to;
  }

  /**
   * Update impostor view-dependent blending
   */
  private updateHLODImpostorView(cameraPosition: THREE.Vector3): void {
    if (!this.hlodState?.impostorMesh || !this.hlodState.impostorMaterial)
      return;

    const mesh = this.hlodState.impostorMesh;

    // Billboard towards camera
    mesh.lookAt(cameraPosition);

    // Compute view direction for octahedral sampling
    if (this.hlodState.raycastMesh) {
      this._hlodViewDir
        .subVectors(cameraPosition, this.node.position)
        .normalize();

      // Raycast against octahedron to find view cells
      this._hlodRayOrigin.copy(this._hlodViewDir).multiplyScalar(2);
      this._hlodRayDirection.copy(this._hlodViewDir).negate();

      this._hlodRaycaster.ray.origin.copy(this._hlodRayOrigin);
      this._hlodRaycaster.ray.direction.copy(this._hlodRayDirection);

      const intersects = this._hlodRaycaster.intersectObject(
        this.hlodState.raycastMesh,
        false,
      );
      if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.face && hit.barycoord) {
          const faceIndices = new THREE.Vector3(
            hit.face.a,
            hit.face.b,
            hit.face.c,
          );
          const faceWeights = hit.barycoord.clone();

          // Update material based on type (TSL or GLSL)
          if (this.hlodState.usesTSL) {
            // TSL material has updateView method
            (this.hlodState.impostorMaterial as TSLImpostorMaterial).updateView(
              faceIndices,
              faceWeights,
            );
          } else {
            // GLSL material uses updateImpostorMaterial
            const viewData: ImpostorViewData = { faceIndices, faceWeights };
            updateImpostorMaterial(
              this.hlodState.impostorMaterial as THREE.ShaderMaterial,
              viewData,
            );
          }
        }
      }
    }
  }

  /**
   * Get current HLOD level
   */
  getHLODLevel(): LODLevel {
    return this.hlodState?.currentLOD ?? LODLevel.LOD0;
  }

  /**
   * Check if HLOD impostor is ready
   */
  isHLODReady(): boolean {
    return this.hlodState?.impostorReady ?? false;
  }

  /**
   * Get comprehensive HLOD diagnostic information for debugging.
   * Use this to verify LOD/impostor system is working correctly.
   */
  getHLODDiagnostics(): {
    initialized: boolean;
    modelId: string | null;
    category: string | null;
    currentLOD: LODLevel;
    currentLODName: string;
    impostorReady: boolean;
    impostorPending: boolean;
    hasImpostorMesh: boolean;
    hasLod0Mesh: boolean;
    hasLod1Mesh: boolean;
    lodDistances: {
      lod1: number;
      lod2: number;
      impostor: number;
      fade: number;
    } | null;
    freezeAnimationAtLOD1: boolean;
    usesTSL: boolean;
  } {
    const lodLevelNames = ["LOD0", "LOD1", "IMPOSTOR", "CULLED"];

    if (!this.hlodState) {
      return {
        initialized: false,
        modelId: null,
        category: null,
        currentLOD: LODLevel.LOD0,
        currentLODName: "LOD0 (no HLOD)",
        impostorReady: false,
        impostorPending: false,
        hasImpostorMesh: false,
        hasLod0Mesh: !!this.mesh,
        hasLod1Mesh: false,
        lodDistances: null,
        freezeAnimationAtLOD1: false,
        usesTSL: false,
      };
    }

    return {
      initialized: true,
      modelId: this.hlodState.modelId,
      category: this.hlodState.category,
      currentLOD: this.hlodState.currentLOD,
      currentLODName: lodLevelNames[this.hlodState.currentLOD] ?? "UNKNOWN",
      impostorReady: this.hlodState.impostorReady,
      impostorPending: this.hlodState.impostorPending,
      hasImpostorMesh: !!this.hlodState.impostorMesh,
      hasLod0Mesh: !!this.hlodState.lod0Mesh,
      hasLod1Mesh: !!this.hlodState.lod1Mesh,
      lodDistances: this.hlodState.lodConfig
        ? {
            lod1: this.hlodState.lodConfig.lod1Distance,
            lod2: this.hlodState.lodConfig.lod2Distance,
            impostor: this.hlodState.lodConfig.imposterDistance,
            fade: this.hlodState.lodConfig.fadeDistance,
          }
        : null,
      freezeAnimationAtLOD1: this.hlodState.freezeAnimationAtLOD1 ?? false,
      usesTSL: this.hlodState.usesTSL,
    };
  }

  /**
   * Dispose of HLOD resources
   */
  protected disposeHLOD(): void {
    if (!this.hlodState) return;

    const { impostorMesh, impostorMaterial, raycastMesh } = this.hlodState;

    if (impostorMesh) {
      impostorMesh.geometry.dispose();
      if (impostorMesh.parent) {
        impostorMesh.parent.remove(impostorMesh);
      }
    }

    if (impostorMaterial) {
      impostorMaterial.dispose();
    }

    if (raycastMesh) {
      raycastMesh.geometry.dispose();
      (raycastMesh.material as THREE.Material).dispose();
    }

    this.hlodState = null;
  }

  // Fixed timestep update (for physics, etc.)
  fixedUpdate(delta: number): void {
    // Update components with fixedUpdate
    for (const component of this.components.values()) {
      if (component.fixedUpdate) {
        component.fixedUpdate(delta);
      }
    }

    if (this.world.isServer) {
      this.serverFixedUpdate(delta);
    }
  }

  // Server fixed update
  protected serverFixedUpdate(_deltaTime: number): void {
    // Override in subclasses
  }

  // Mark this entity as needing network sync
  markNetworkDirty(): void {
    this.networkDirty = true;
    this.networkVersion++;

    // CRITICAL: Directly add to EntityManager's dirty set
    // Players are managed by PlayerSystem, not EntityManager's update loop
    // So we must explicitly notify EntityManager when players are dirty
    if (this.world.isServer) {
      const entityManager = this.world.getSystem(
        "entity-manager",
      ) as unknown as { networkDirtyEntities?: Set<string> };
      if (entityManager?.networkDirtyEntities) {
        entityManager.networkDirtyEntities.add(this.id);
        // Disabled - too spammy
        // console.log(`[Entity.markNetworkDirty] Added ${this.type} ${this.id} to dirty set`);
      }
    }
  }

  // Get data for network synchronization
  getNetworkData(): Record<string, unknown> {
    const position = toPosition3D(this.node.position);
    const rotation = this.node.quaternion;
    const scale = {
      x: this.node.scale.x,
      y: this.node.scale.y,
      z: this.node.scale.z,
    };

    // Include all data fields (e.g., emote 'e') for network sync
    // Filter out position/quaternion/scale since EntityManager handles those separately as p/q
    const dataFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.data)) {
      // Skip position/quaternion/scale arrays - EntityManager sends them as p/q
      if (
        key !== "position" &&
        key !== "quaternion" &&
        key !== "scale" &&
        key !== "id" &&
        key !== "type" &&
        key !== "name"
      ) {
        dataFields[key] = value;
      }
    }

    return {
      id: this.id,
      type: this.type,
      name: this.name,
      position,
      rotation,
      scale,
      visible: this.node.visible,
      networkVersion: this.networkVersion,
      properties: this.config.properties || {},
      ...dataFields, // Include emote ('e'), inCombat, combatTarget, health, and other data fields
    };
  }

  // Apply network data (client-side)
  applyNetworkData(data: Record<string, unknown>): void {
    this.networkVersion = data.networkVersion as number;
    this.node.visible = data.visible as boolean;
    this.config.properties = {
      ...this.config.properties,
      ...(data.properties as Record<string, unknown>),
    };
  }

  // Handle interaction request
  async handleInteraction(data: EntityInteractionData): Promise<void> {
    // Call the interaction handler directly - assume data is valid
    await this.onInteract(data);
  }

  // Property management
  getProperty<T>(key: string, defaultValue?: T): T {
    return (this.config.properties?.[key] ?? defaultValue) as T;
  }

  setProperty(key: string, value: unknown): void {
    this.config.properties[key] = value;
    this.markNetworkDirty();
  }

  // Event system with typed versions
  on<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(callback as EventCallback);
  }

  off<T = unknown>(event: string, callback: (data: T) => void): void {
    this.listeners[event].delete(callback as EventCallback);
  }

  emit<T = unknown>(event: string, data?: T): void {
    // Call local listeners first
    this.listeners[event]?.forEach((callback) => callback(data));

    // Also emit to world events
    this.world.emit(`entity:${this.id}:${event}`, data);
  }

  // Visibility
  setVisible(visible: boolean): void {
    this.node.visible = visible;
    this.config.visible = visible;
    this.markNetworkDirty();
  }

  // Cleanup
  destroy(local?: boolean): void {
    // Re-entrancy guard: prevent recursive destroy calls
    if (this.destroyed) return;
    this.destroyed = true;

    // IMMEDIATELY hide mesh to prevent raycast hits during async cleanup
    // This fixes the dead mob / item drop overlap issue where the mesh
    // is still raycastable while the entity is being destroyed
    if (this.node) {
      this.node.visible = false;
    }

    // Clean up atlas-based UI elements (HealthBars system)
    if (this._entityHealthBarHandle) {
      this._entityHealthBarHandle.destroy();
      this._entityHealthBarHandle = null;
    }

    // Clean up legacy sprite UI elements (fallback when atlas systems unavailable)
    if (this.nameSprite) {
      // Remove from node (not scene since we added it to node)
      if (this.node) {
        this.node.remove(this.nameSprite);
      }
      // NOTE: Don't dispose sprite material or texture - they will be GC'd
      // when the sprite is no longer referenced. Disposing synchronously
      // causes WebGPU texture cache corruption with dual-renderer setup
      // (main renderer + minimap renderer share the same scene).
      this.nameSprite = null;
    }

    if (this.healthSprite) {
      // Remove from node (not scene since we added it to node)
      if (this.node) {
        this.node.remove(this.healthSprite);
      }
      // NOTE: Don't dispose - same reason as nameSprite above
      this.healthSprite = null;
    }

    // Destroy all components
    for (const type of Array.from(this.components.keys())) {
      this.removeComponent(type);
    }

    // Remove from scene
    if (this.node.parent) {
      (this.node.parent as THREE.Object3D).remove(this.node);
    }

    // Clean up physics
    if (this.rigidBody && this.world.physics?.world) {
      // Remove rigid body from physics world
      // Implementation depends on physics engine
    }

    // Network sync
    const network = getWorldNetwork(this.world);
    if (local && network) {
      network.send("entityRemoved", this.id);
    }

    // Note: Do not emit ENTITY_DEATH here to avoid recursive destruction loops.
    // Destruction is requested via the EventBus and coordinated by EntityManager.

    // Clear event listeners
    this.clearEventListeners();

    // Remove from world
    this.worldNodes.forEach((node) => {
      if (node.parent) {
        (node.parent as THREE.Object3D).remove(node);
      }
    });
    this.worldNodes.clear();

    // Dispose of HLOD impostor resources
    this.disposeHLOD();

    // Dispose of THREE.js resources
    if (this.mesh) {
      this.disposeMesh(this.mesh);
    }

    // Clear references
    this.nodes.clear();
    this.mesh = null;
  }

  private clearEventListeners(): void {
    // Clear local event listeners
    Object.keys(this.listeners).forEach((event) => {
      this.listeners[event].clear();
    });

    // Clear world event listeners
    this.worldListeners.forEach((eventName, callback) => {
      this.world.off(eventName, callback);
    });
    this.worldListeners.clear();
  }

  private disposeMesh(object: THREE.Mesh | THREE.Group | THREE.Object3D): void {
    object.traverse((child) => {
      // Strong type assumption - mesh children have geometry and material
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        // Geometry is cloned per entity, safe to dispose
        mesh.geometry.dispose();
      }
      // NOTE: Materials are NOT disposed here because they are shared across
      // instances via ModelCache (for GLB) and VRM factories (for VRM avatars).
      // Material lifecycle is managed by the caching systems, not individual entities.
      // Disposing materials here would corrupt WebGPU's texture cache when
      // other entities are still using the same shared materials.
    });
  }

  // Debug information
  getInfo(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      position: this.getPosition(),
      visible: this.node.visible,
      isInitialized: true, // Entity is always initialized after constructor
      isDestroyed: this.destroyed,
      networkDirty: this.networkDirty,
      networkVersion: this.networkVersion,
      nodeCount: this.nodes.size,
      properties: this.config.properties,
    };
  }
}
