/**
 * NPCEntity - Non-Player Character Entity
 *
 * Represents friendly NPCs like shopkeepers, bankers, trainers, and quest givers.
 * NPCs provide services to players through dialogue and interaction menus.
 *
 * **Extends**: Entity (not combatant - NPCs cannot be attacked)
 *
 * **Key Features**:
 *
 * **NPC Types**:
 * - **Store**: Sells and buys items (shopkeepers)
 * - **Bank**: Provides item storage (bankers)
 * - **Trainer**: Teaches skills or abilities
 * - **Quest**: Gives quests and rewards
 * - **Dialogue**: General conversation
 *
 * **Interaction System**:
 * - Player clicks NPC to interact
 * - Opens appropriate UI based on NPC type
 * - Dialogue trees (simple or complex)
 * - Service menus (shop, bank, training)
 *
 * **Dialogue**:
 * - Multiple dialogue lines
 * - Context-aware responses
 * - Service advertisements
 * - Quest information
 *
 * **Shop System** (if npcType === 'store'):
 * - Inventory of items to sell
 * - Buy/sell prices
 * - Stock quantities
 * - Purchase restrictions
 *
 * **Banking** (if npcType === 'bank'):
 * - Opens player's bank storage
 * - Deposit/withdraw items
 * - Currency storage
 * - Shared across all bank NPCs
 *
 * **Visual Representation**:
 * - 3D model or humanoid mesh
 * - Name shown in right-click menu (OSRS pattern)
 * - NO health bar (cannot be damaged)
 * - Idle animations
 * - Interaction highlight when in range
 *
 * **Persistence**:
 * - NPCs are defined in world configuration
 * - Position and properties persist
 * - Inventory/stock may regenerate
 *
 * **Runs on**: Server (authoritative), Client (visual + UI)
 * **Referenced by**: NPCSystem, StoreSystem, BankingSystem, InteractionSystem
 *
 * @public
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import { Entity } from "../Entity";
import type {
  EntityInteractionData,
  NPCEntityConfig,
} from "../../types/entities";
import type {
  EntityData,
  VRMAvatarInstance,
  LoadedAvatar,
} from "../../types/index";
import { modelCache } from "../../utils/rendering/ModelCache";
import { EventType } from "../../types/events";
import { Emotes } from "../../data/playerEmotes";
import {
  AnimationLOD,
  ANIMATION_LOD_PRESETS,
  getCameraPosition,
} from "../../utils/rendering/AnimationLOD";
import {
  DistanceFadeController,
  ENTITY_FADE_CONFIGS,
  FadeState,
} from "../../utils/rendering/DistanceFade";
import { RAYCAST_PROXY } from "../../systems/client/interaction/constants";

// Re-export types for external use
export type { NPCEntityConfig } from "../../types/entities";

export class NPCEntity extends Entity {
  public config: NPCEntityConfig;

  // VRM avatar instance (for VRM models with emote support)
  private _avatarInstance: VRMAvatarInstance | null = null;
  private _currentEmote: string | null = null;

  // PERFORMANCE: Raycast proxy mesh for fast entity detection
  // VRM SkinnedMesh raycast is extremely slow (~700-1800ms) because THREE.js
  // must transform every vertex by bone weights. This simple capsule is instant.
  private _raycastProxy: THREE.Mesh | null = null;

  /** Animation LOD controller - throttles animation updates for distant NPCs */
  private readonly _animationLOD = new AnimationLOD(ANIMATION_LOD_PRESETS.NPC);
  /** Track if idle pose has been applied at least once - prevents T-pose at frozen distances */
  private _hasAppliedIdlePose = false;

  /** Distance fade controller - dissolve effect for entities near render distance */
  private _distanceFade: DistanceFadeController | null = null;

  async init(): Promise<void> {
    await super.init();

    // CRITICAL: Register for update loop (client only - NPCs don't need server updates)
    if (this.world.isClient) {
      this.world.setHot(this, true);
    }
  }

  constructor(world: World, config: NPCEntityConfig) {
    super(world, config);
    this.config = {
      ...config,
      dialogueLines: config.dialogueLines || ["Hello there!"],
      services: config.services || [],
    };

    // NPCs don't have health bars - they're not combatants
    // Set health to 0 to prevent health bar creation
    this.health = 0;
    this.maxHealth = 0;
  }

  protected async onInteract(data: EntityInteractionData): Promise<void> {
    const { playerId, interactionType } = data;

    switch (interactionType) {
      case "talk":
        this.handleTalk(playerId);
        break;
      case "trade":
        this.handleTrade(playerId);
        break;
      case "bank":
        this.handleBank(playerId);
        break;
      case "train":
        this.handleTrain(playerId);
        break;
      case "quest":
        this.handleQuest(playerId);
        break;
      default:
        this.handleTalk(playerId);
        break;
    }
  }

  private handleTalk(playerId: string): void {
    // Emit NPC_INTERACTION so DialogueSystem can look up dialogue tree from npcs.json
    this.world.emit(EventType.NPC_INTERACTION, {
      playerId,
      npcId: this.id,
      npc: {
        id: this.config.npcId,
        name: this.config.name,
        type: this.config.npcType,
      },
    });
  }

  private handleTrade(playerId: string): void {
    if (this.config.npcType !== "store") {
      return;
    }

    // Send store interface request
    this.world.emit(EventType.STORE_OPEN_REQUEST, {
      playerId,
      npcId: this.config.npcId,
      inventory: this.config.inventory || [],
    });
  }

  private handleBank(playerId: string): void {
    if (this.config.npcType !== "bank") {
      return;
    }

    // Send bank interface request
    this.world.emit(EventType.BANK_OPEN_REQUEST, {
      playerId,
      npcId: this.config.npcId,
    });
  }

  private handleTrain(playerId: string): void {
    if (this.config.npcType !== "trainer") {
      return;
    }

    // Send training interface request
    this.world.emit(EventType.NPC_TRAINER_OPEN, {
      playerId,
      npcId: this.config.npcId,
      skillsOffered: this.config.skillsOffered || [],
    });
  }

  private handleQuest(playerId: string): void {
    if (this.config.npcType !== "quest_giver") {
      return;
    }

    // Send quest interface request
    this.world.emit(EventType.NPC_QUEST_OPEN, {
      playerId,
      npcId: this.config.npcId,
      questsAvailable: this.config.questsAvailable || [],
    });
  }

  /**
   * Setup idle animation for NPCs (usually a subtle idle loop)
   * Uses embedded animations if available, otherwise loads from model's animation directory
   */
  private setupIdleAnimation(animations: THREE.AnimationClip[]): void {
    if (!this.mesh) return;

    // Find the SkinnedMesh to apply animation to
    let skinnedMesh: THREE.SkinnedMesh | null = null;
    this.mesh.traverse((child) => {
      if (!skinnedMesh && (child as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMesh = child as THREE.SkinnedMesh;
      }
    });

    if (!skinnedMesh) {
      // No SkinnedMesh = static model, no animations needed
      return;
    }

    // Create AnimationMixer
    const mixer = new THREE.AnimationMixer(skinnedMesh);

    // Find idle animation (prioritize "idle" or "standing")
    const idleClip = animations.find(
      (clip) =>
        clip.name.toLowerCase().includes("idle") ||
        clip.name.toLowerCase().includes("standing"),
    );

    if (idleClip) {
      // Use embedded idle animation
      const action = mixer.clipAction(idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();

      // CRITICAL: Apply first frame IMMEDIATELY to prevent T-pose flash
      // Without this, the skeleton stays in bind pose until the next clientUpdate()
      mixer.update(0);

      // Force skeleton bone matrices to update after animation is applied
      const mesh = skinnedMesh as THREE.SkinnedMesh;
      if (mesh.skeleton) {
        mesh.skeleton.bones.forEach((bone) => bone.updateMatrixWorld(true));
      }

      // Store mixer on entity for update in clientUpdate
      (this as { mixer?: THREE.AnimationMixer }).mixer = mixer;
    } else {
      // No idle animation found in embedded clips
      // Try to load from model's animation directory (same skeleton = compatible)
      (this as { mixer?: THREE.AnimationMixer }).mixer = mixer;
      this.loadModelIdleAnimation(mixer);
    }
  }

  /**
   * Load idle animation from the model's own animation directory
   * This ensures bone name compatibility (same skeleton)
   * Service NPCs (bank, store) should stand still, not walk
   *
   * Note: If no idle animation exists, the NPC stays in bind pose (standing)
   * which is appropriate for service NPCs. This is not an error condition.
   */
  private async loadModelIdleAnimation(
    _mixer: THREE.AnimationMixer,
  ): Promise<void> {
    // Service NPCs (banker, shopkeeper, trainer) should stand still
    // The bind pose of human_rigged.glb is a standing pose which is appropriate
    // We intentionally don't load walk/run animations for service NPCs
    // If an idle animation is needed later, add idle.glb to the model's animations folder
  }

  /**
   * Load VRM model and create avatar instance with emote support
   * This uses the same avatar system as player avatars, enabling proper emote playback
   */
  private async loadVRMModel(): Promise<void> {
    if (!this.world.loader) {
      console.warn(
        `[NPCEntity] ${this.id}: No world.loader available for VRM loading`,
      );
      return;
    }
    if (!this.config.model) {
      console.warn(`[NPCEntity] ${this.id}: No model path configured`);
      return;
    }
    if (!this.world.stage?.scene) {
      console.warn(`[NPCEntity] ${this.id}: No world.stage.scene available`);
      return;
    }

    // Create VRM hooks with scene reference (CRITICAL for visibility!)
    const vrmHooks = {
      scene: this.world.stage.scene,
      octree: this.world.stage?.octree,
      camera: this.world.camera,
      loader: this.world.loader,
    };

    // Load the VRM avatar using the same loader as players
    const src = (await this.world.loader.load(
      "avatar",
      this.config.model,
    )) as LoadedAvatar;

    // Convert to nodes
    const nodeMap = src.toNodes(vrmHooks);
    const avatarNode = nodeMap.get("avatar") || nodeMap.get("root");

    if (!avatarNode) {
      console.warn(
        `[NPCEntity] ${this.id}: No avatar/root node found in VRM for ${this.config.model}`,
      );
      return;
    }

    // Get the factory from the avatar node
    const avatarNodeWithFactory = avatarNode as {
      factory?: {
        create: (matrix: THREE.Matrix4, hooks?: unknown) => VRMAvatarInstance;
      };
    };

    if (!avatarNodeWithFactory?.factory) {
      console.warn(
        `[NPCEntity] ${this.id}: No VRM factory found on avatar node for ${this.config.model}`,
      );
      return;
    }

    // Update our node's transform
    this.node.updateMatrix();
    this.node.updateMatrixWorld(true);

    // Create the VRM instance using the factory
    this._avatarInstance = avatarNodeWithFactory.factory.create(
      this.node.matrixWorld,
      vrmHooks,
    );

    // Set up userData for interaction detection on the avatar
    // Get the VRM scene from the instance
    const instanceWithRaw = this._avatarInstance as {
      raw?: { scene?: THREE.Object3D };
    };
    if (instanceWithRaw?.raw?.scene) {
      // Set mesh reference for HLOD system
      this.mesh = instanceWithRaw.raw.scene;

      // CRITICAL: Hide VRM mesh immediately to prevent T-pose flash
      // The mesh will be shown only after idle animation is loaded and applied
      this.mesh.visible = false;

      const userData = {
        type: "npc",
        entityId: this.id,
        npcId: this.config.npcId,
        name: this.config.name,
        interactable: true,
        npcType: this.config.npcType,
        services: this.config.services,
      };
      instanceWithRaw.raw.scene.userData = userData;

      // PERFORMANCE: Set VRM mesh to layer 1 (main camera only, not minimap)
      // Minimap only renders terrain and uses 2D dots for entities
      instanceWithRaw.raw.scene.layers.set(1);
      instanceWithRaw.raw.scene.traverse((child) => {
        child.userData = { ...userData };
        child.layers.set(1);
        // PERFORMANCE: Disable raycasting on VRM meshes - use _raycastProxy instead
        // SkinnedMesh raycast is extremely slow (~700-1800ms) because THREE.js
        // must transform every vertex by bone weights. The capsule proxy is instant.
        child.raycast = () => {};
      });

      // CRITICAL: Load and apply idle emote BEFORE making VRM visible
      // This prevents T-pose flash on spawn - NPCs should NEVER appear in T-pose
      const avatarWithEmote = this._avatarInstance as {
        setEmote?: (emote: string) => void;
        setEmoteAndWait?: (emote: string, timeoutMs?: number) => Promise<void>;
        update: (delta: number) => void;
      };

      // Set initial emote to idle and WAIT for it to load (service NPCs should stand still)
      this._currentEmote = Emotes.IDLE;
      if (avatarWithEmote.setEmoteAndWait) {
        try {
          await avatarWithEmote.setEmoteAndWait(Emotes.IDLE, 3000);
        } catch {
          // Timeout is okay - the rest pose fallback will handle it
          avatarWithEmote.setEmote?.(Emotes.IDLE);
        }
      } else if (avatarWithEmote.setEmote) {
        avatarWithEmote.setEmote(Emotes.IDLE);
      }

      // Apply first frame of animation to skeleton before showing
      this._avatarInstance.update(0);
      this.mesh.updateMatrixWorld(true);

      // NOW make VRM visible - idle animation is guaranteed to be playing (or rest pose fallback)
      this.mesh.visible = true;

      // Initialize HLOD impostor support for VRM NPCs
      // VRM models use a different rendering path (avatarInstance.move()) but we can still use impostors.
      // The key is that this.node.position is kept in sync with the VRM's world position,
      // so the impostor (parented to this.node) will be at the correct position.
      await this.initHLOD(
        `vrm_npc_${this.config.npcType}_${this.config.model}`,
        {
          category: "npc",
          atlasSize: 512, // Smaller for NPCs
          hemisphere: true,
          freezeAnimationAtLOD1: true, // AAA LOD: Freeze animation at medium distance
          prepareForBake: async () => {
            // AAA LOD: Prepare VRM mesh for impostor baking at local origin
            if (this.mesh && this._avatarInstance) {
              const savedPosition = this.mesh.position.clone();
              const savedQuaternion = this.mesh.quaternion.clone();

              // Move mesh to local origin for baking
              this.mesh.position.set(0, 0, 0);
              this.mesh.quaternion.identity();

              // Update the animation to ensure idle pose at frame 0
              this._avatarInstance.update(0);
              this.mesh.updateMatrixWorld(true);

              // Restore position after baking (microtask)
              Promise.resolve().then(() => {
                if (this.mesh) {
                  this.mesh.position.copy(savedPosition);
                  this.mesh.quaternion.copy(savedQuaternion);
                  this.mesh.updateMatrixWorld(true);
                }
              });
            }
          },
        },
      );
    }
  }

  /**
   * Update animation mixer each frame (legacy - use updateAnimationsWithDelta for LOD)
   */
  private updateAnimations(deltaTime: number): void {
    this.updateAnimationsWithDelta(deltaTime);
  }

  /**
   * Create invisible raycast proxy for fast click detection
   *
   * PERFORMANCE: VRM SkinnedMesh raycast is extremely slow (~700-1800ms) because
   * THREE.js must transform every vertex by bone weights. This simple capsule
   * mesh is added directly to THREE.Scene and provides instant raycast response.
   */
  private createRaycastProxy(): void {
    if (this._raycastProxy) return; // Already created

    const scene = this.world.stage?.scene;
    if (!scene) return;

    // Create capsule geometry sized for humanoid NPC
    const geometry = new THREE.CapsuleGeometry(
      RAYCAST_PROXY.BASE_RADIUS,
      RAYCAST_PROXY.BASE_HEIGHT,
      RAYCAST_PROXY.CAP_SEGMENTS,
      RAYCAST_PROXY.HEIGHT_SEGMENTS,
    );
    const material = new THREE.MeshBasicMaterial({
      visible: false, // Invisible but raycastable
    });

    this._raycastProxy = new THREE.Mesh(geometry, material);
    this._raycastProxy.name = `NPC_RaycastProxy_${this.config.npcType}_${this.id}`;

    // CRITICAL: Set userData for click detection (matches VRM/GLB userData)
    this._raycastProxy.userData = {
      type: "npc",
      entityId: this.id,
      npcId: this.config.npcId,
      name: this.config.name,
      interactable: true,
      npcType: this.config.npcType,
      services: this.config.services,
    };

    // Set to layer 1 (main camera only, not minimap)
    this._raycastProxy.layers.set(1);

    // Add directly to THREE.Scene (bypasses Node system for performance)
    scene.add(this._raycastProxy);

    // Sync initial position
    this._raycastProxy.position.copy(this.node.position);
    this._raycastProxy.position.y += RAYCAST_PROXY.Y_OFFSET;
  }

  protected async createMesh(): Promise<void> {
    if (this.world.isServer) {
      return;
    }

    // PERFORMANCE: Create invisible raycast proxy FIRST for instant click detection
    // This bypasses expensive VRM SkinnedMesh raycast (~700-1800ms per click)
    this.createRaycastProxy();

    // Try to load 3D model if available
    if (this.config.model && this.world.loader) {
      try {
        // Check if this is a VRM file (uses Avatar system with emote support)
        if (this.config.model.endsWith(".vrm")) {
          // Load VRM via avatar system - this handles emote retargeting
          await this.loadVRMModel();
          return;
        }

        // GLB model - load directly
        const { scene, animations } = await modelCache.loadModel(
          this.config.model,
          this.world,
        );

        this.mesh = scene;
        this.mesh.name = `NPC_${this.config.npcType}_${this.id}`;

        // CRITICAL: Scale the root mesh transform, then bind skeleton
        const modelScale = 100; // cm to meters
        this.mesh.scale.set(modelScale, modelScale, modelScale);
        this.mesh.updateMatrix();
        this.mesh.updateMatrixWorld(true);

        // NOW bind the skeleton at the scaled size and set layer for minimap exclusion
        this.mesh.layers.set(1); // Main camera only, not minimap
        this.mesh.traverse((child) => {
          // PERFORMANCE: Set all children to layer 1 (minimap only sees layer 0)
          child.layers.set(1);

          if (child instanceof THREE.SkinnedMesh && child.skeleton) {
            // Ensure mesh matrix is updated
            child.updateMatrix();
            child.updateMatrixWorld(true);

            // Bind skeleton with DetachedBindMode (like VRM)
            child.bindMode = THREE.DetachedBindMode;
            child.bindMatrix.copy(child.matrixWorld);
            child.bindMatrixInverse.copy(child.bindMatrix).invert();
          }
        });

        // Set up userData for interaction detection (raycasting)
        // CRITICAL: Set on root AND all children so raycast hits work
        // npcId is the manifest ID (e.g., "bank_clerk"), entityId is the instance ID
        const userData = {
          type: "npc",
          entityId: this.id,
          npcId: this.config.npcId, // Manifest ID for dialogue lookup
          name: this.config.name,
          interactable: true,
          npcType: this.config.npcType,
          services: this.config.services,
        };
        this.mesh.userData = userData;
        this.mesh.traverse((child) => {
          child.userData = { ...userData };
          // PERFORMANCE: Disable raycasting on GLB meshes - use _raycastProxy instead
          child.raycast = () => {};
        });

        // Add as child of node (standard approach with correct scale)
        // Position is relative to node, so keep it at origin
        this.mesh.position.set(0, 0, 0);
        this.mesh.quaternion.identity();
        this.node.add(this.mesh);

        // Setup animations if available (NPCs usually have idle animations)
        if (animations.length > 0) {
          this.setupIdleAnimation(animations);
        }

        // Initialize HLOD impostor support for NPCs
        // AAA LOD: Bake in idle pose (not T-pose), freeze animations at LOD1
        await this.initHLOD(`npc_${this.config.npcType}_${this.config.model}`, {
          category: "npc",
          atlasSize: 512,
          hemisphere: true,
          freezeAnimationAtLOD1: true, // AAA LOD: Freeze animation at medium distance
          prepareForBake: async () => {
            // AAA LOD: Ensure GLB mesh is in idle pose before baking impostor
            // This captures the idle animation frame 0, not T-pose
            const mixer = (this as { mixer?: THREE.AnimationMixer }).mixer;
            if (mixer && this.mesh) {
              // Reset current action to frame 0 to ensure consistent idle pose
              // NPCs don't store currentAction, but we can get it from mixer
              const root = mixer.getRoot();
              const animations =
                root && "animations" in root
                  ? (root as THREE.Object3D).animations
                  : undefined;
              if (animations && animations.length > 0) {
                const action = mixer.clipAction(animations[0]);
                if (action) {
                  action.time = 0;
                }
              }

              // Apply frame 0 to skeleton (delta=0 applies current time position)
              mixer.update(0);

              // Force complete skeleton matrix update
              this.mesh.traverse((child) => {
                if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
                  const skinnedMesh = child as THREE.SkinnedMesh;
                  if (skinnedMesh.skeleton) {
                    // Update each bone's world matrix
                    skinnedMesh.skeleton.bones.forEach((bone) =>
                      bone.updateMatrixWorld(true),
                    );
                    // Recompute skeleton's bone matrices
                    skinnedMesh.skeleton.update();
                  }
                }
              });

              // Update entire mesh hierarchy
              this.mesh.updateMatrixWorld(true);
            }
          },
        });

        return;
      } catch (error) {
        console.warn(
          `[NPCEntity] Failed to load model for ${this.config.npcType}, using placeholder:`,
          error,
        );
        // Fall through to placeholder
      }
    }

    const geometry = new THREE.CapsuleGeometry(0.35, 1.4, 4, 8);
    // Use MeshStandardMaterial for proper lighting (responds to sun, moon, and environment maps)
    const material = new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.8,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = `NPC_${this.config.npcType}_${this.id}`;

    // PERFORMANCE: Set placeholder to layer 1 (main camera only, not minimap)
    this.mesh.layers.set(1);

    // CRITICAL: Set userData for interaction detection (raycasting)
    // npcId is the manifest ID (e.g., "bank_clerk"), entityId is the instance ID
    this.mesh.userData = {
      type: "npc",
      entityId: this.id,
      npcId: this.config.npcId, // Manifest ID for dialogue lookup
      name: this.config.name,
      interactable: true,
      npcType: this.config.npcType,
      services: this.config.services,
    };

    this.mesh.scale.set(1, 2, 1);

    if (this.mesh instanceof THREE.Mesh && this.mesh.material) {
      if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
        const meshMaterial = this.mesh.material;
        switch (this.config.npcType) {
          case "bank":
            meshMaterial.color.setHex(0x00ff00);
            break;
          case "store":
            meshMaterial.color.setHex(0x0000ff);
            break;
          case "quest_giver":
            meshMaterial.color.setHex(0xffff00);
            break;
          case "trainer":
            meshMaterial.color.setHex(0xff00ff);
            break;
          default:
            meshMaterial.color.setHex(0xffffff);
            break;
        }
      }
    }

    if (this.mesh) {
      this.node.add(this.mesh);
    }
  }

  /**
   * Update animations on client side
   */
  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);

    // PERFORMANCE: Sync raycast proxy position with NPC
    if (this._raycastProxy) {
      this._raycastProxy.position.copy(this.node.position);
      this._raycastProxy.position.y += RAYCAST_PROXY.Y_OFFSET;
    }

    // DISTANCE FADE: Apply dissolve effect and cull distant NPCs
    const cameraPos = getCameraPosition(this.world);
    if (cameraPos) {
      // Initialize DistanceFadeController once we have a node
      if (!this._distanceFade && this.node) {
        this._distanceFade = new DistanceFadeController(
          this.node,
          ENTITY_FADE_CONFIGS.NPC,
          true, // Enable shader-based dissolve
        );
      }

      // Update fade and check if culled
      if (this._distanceFade) {
        const fadeResult = this._distanceFade.update(
          cameraPos.x,
          cameraPos.z,
          this.node.position.x,
          this.node.position.z,
        );

        // If culled, skip all further updates (animation, etc.)
        if (fadeResult.state === FadeState.CULLED) {
          return;
        }
      }
    }

    // ANIMATION LOD: Calculate distance to camera once and throttle animation updates
    // This reduces CPU/GPU load for distant NPCs significantly
    const animLODResult = cameraPos
      ? this._animationLOD.updateFromPosition(
          this.node.position.x,
          this.node.position.z,
          cameraPos.x,
          cameraPos.z,
          deltaTime,
        )
      : {
          shouldUpdate: true,
          effectiveDelta: deltaTime,
          lodLevel: 0,
          distanceSq: 0,
          shouldApplyRestPose: false,
        };

    // T-POSE FIX: When entering frozen state (or never applied idle), apply idle pose once
    // This ensures NPCs at frozen/culled distances show idle pose instead of T-pose
    // The shouldApplyRestPose flag is true when transitioning INTO frozen state
    const needsIdlePoseApplication =
      animLODResult.shouldApplyRestPose || !this._hasAppliedIdlePose;

    if (needsIdlePoseApplication) {
      // VRM path: Apply idle pose
      if (this._avatarInstance) {
        const avatarWithEmote = this._avatarInstance as {
          setEmote?: (emote: string) => void;
        };
        // Ensure idle emote is set
        if (avatarWithEmote.setEmote && this._currentEmote !== Emotes.IDLE) {
          this._currentEmote = Emotes.IDLE;
          avatarWithEmote.setEmote(Emotes.IDLE);
        }
        // Apply frame 0 to bake idle pose into skeleton
        this._avatarInstance.update(0);
        this._hasAppliedIdlePose = true;
      }
      // GLB path: Apply idle pose via mixer
      else {
        const mixer = (this as { mixer?: THREE.AnimationMixer }).mixer;
        if (mixer) {
          mixer.update(0);
          // Force skeleton update
          if (this.mesh) {
            this.mesh.traverse((child) => {
              if (child instanceof THREE.SkinnedMesh && child.skeleton) {
                child.skeleton.bones.forEach((bone) =>
                  bone.updateMatrixWorld(),
                );
              }
            });
          }
          this._hasAppliedIdlePose = true;
        }
      }
    }

    // VRM avatar path: Update avatar instance
    if (this._avatarInstance) {
      // Update avatar position to follow node (always, for proper positioning)
      this._avatarInstance.move(this.node.matrixWorld);

      // AAA LOD + ANIMATION LOD: Only update VRM animation when both allow
      // - animLODResult.shouldUpdate: Throttles based on distance (frame skipping)
      // - shouldUpdateAnimationsForLOD(): Freezes completely at LOD1+ (HLOD system)
      // At medium distance (LOD1), NPC shows frozen in idle pose (no animation CPU cost)
      if (animLODResult.shouldUpdate && this.shouldUpdateAnimationsForLOD()) {
        this._avatarInstance.update(animLODResult.effectiveDelta);
      }
      return;
    }

    // GLB mesh path: Update animation mixer (only when both LOD systems allow)
    // AAA LOD + ANIMATION LOD: Freeze at medium distance, throttle at far distance
    if (animLODResult.shouldUpdate && this.shouldUpdateAnimationsForLOD()) {
      this.updateAnimationsWithDelta(animLODResult.effectiveDelta);
    }
  }

  /**
   * Update animations with specified delta time (for LOD-throttled updates)
   */
  private updateAnimationsWithDelta(deltaTime: number): void {
    const mixer = (this as { mixer?: THREE.AnimationMixer }).mixer;
    if (mixer) {
      mixer.update(deltaTime);

      // CRITICAL: Update skeleton (exactly like VRM does!)
      if (this.mesh) {
        this.mesh.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && child.skeleton) {
            child.skeleton.bones.forEach((bone) => bone.updateMatrixWorld());
          }
        });
      }
    }
  }

  public getNetworkData(): Record<string, unknown> {
    return {
      ...super.getNetworkData(),
      model: this.config.model,
      npcType: this.config.npcType,
      npcId: this.config.npcId,
      services: this.config.services,
    };
  }

  // Override serialize to include NPC-specific fields for network transmission
  public override serialize(): EntityData {
    const base = super.serialize();
    return {
      ...base,
      model: this.config.model,
      npcType: this.config.npcType,
      npcId: this.config.npcId,
      services: this.config.services,
    };
  }

  public addService(service: string): void {
    if (!this.world.isServer) return;

    if (!this.config.services.includes(service)) {
      this.config.services.push(service);
      this.markNetworkDirty();
    }
  }

  public removeService(service: string): void {
    if (!this.world.isServer) return;

    const index = this.config.services.indexOf(service);
    if (index > -1) {
      this.config.services.splice(index, 1);
      this.markNetworkDirty();
    }
  }

  public updateInventory(inventory: NPCEntityConfig["inventory"]): void {
    if (!this.world.isServer) return;

    this.config.inventory = inventory;
    this.markNetworkDirty();
  }

  /**
   * Override destroy to clean up animations, avatar, and raycast proxy
   */
  override destroy(): void {
    // Clean up raycast proxy (added directly to scene)
    if (this._raycastProxy) {
      const scene = this.world.stage?.scene;
      if (scene) {
        scene.remove(this._raycastProxy);
      }
      this._raycastProxy.geometry.dispose();
      (this._raycastProxy.material as THREE.Material).dispose();
      this._raycastProxy = null;
    }

    // Clean up distance fade controller
    if (this._distanceFade) {
      this._distanceFade.dispose();
      this._distanceFade = null;
    }

    // Clean up VRM avatar instance
    if (this._avatarInstance) {
      this._avatarInstance.destroy();
      this._avatarInstance = null;
    }

    // Clean up animation mixer (for GLB models)
    const mixer = (this as { mixer?: THREE.AnimationMixer }).mixer;
    if (mixer) {
      mixer.stopAllAction();
      (this as { mixer?: THREE.AnimationMixer }).mixer = undefined;
    }

    // Parent will handle mesh removal (mesh is child of node)
    super.destroy();
  }
}
