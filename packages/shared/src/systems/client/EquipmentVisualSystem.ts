/**
 * Equipment Visual System (Client-Only)
 *
 * Handles visual rendering of equipped items on player avatars using VRM bones.
 * Works with weapons exported from Asset Forge with pre-baked attachment data.
 *
 * **How It Works:**
 * 1. Listens for PLAYER_EQUIPMENT_CHANGED events
 * 2. Loads weapon GLB from Asset Forge (with userData.hyperscape metadata)
 * 3. Attaches weapon to VRM bone specified in metadata
 * 4. Transforms are pre-baked - just attach directly!
 *
 * **Asset Forge Integration:**
 * - Weapons fitted in Asset Forge Equipment Page
 * - Exported with VRM bone attachment data
 * - Position/rotation already baked into GLB hierarchy
 * - See: /packages/asset-forge/WEAPON_FITTING_GUIDE.md
 */

import { GLTFLoader } from "../../libs/gltfloader/GLTFLoader";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { EventType } from "../../types/events";
import { SystemBase } from "../shared/infrastructure/SystemBase";
import type { World } from "../../types";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { getItem } from "../../data/items";
import type { Entity } from "../../entities/Entity";

interface PlayerWithAvatar extends Entity {
  _avatar?: {
    instance?: {
      raw?: {
        userData?: {
          vrm?: VRM;
        };
        scene?: THREE.Object3D;
      };
    };
  };
}

interface EquipmentAttachmentData {
  vrmBoneName: string; // VRM bone to attach to (e.g., "rightHand")
  originalSlot?: string; // Original Asset Forge slot
  weaponType?: string; // Weapon type for debugging
  usage?: string; // Usage instructions
  note?: string; // Developer notes
  // V2 format fields
  version?: number; // Format version (2 = relative matrix approach)
  relativeMatrix?: number[]; // 16-element matrix array (for v2)
  avatarId?: string; // Avatar used for fitting (for v2)
  avatarHeight?: number; // Avatar height used for fitting
}

interface PlayerEquipmentVisuals {
  weapon?: THREE.Object3D;
  shield?: THREE.Object3D;
  helmet?: THREE.Object3D;
  // Temporary gathering tool (e.g., fishing rod during fishing animation)
  // Note: lowercase to match slot.toLowerCase() in equip/unequip methods
  gatheringtool?: THREE.Object3D;
  // Add more slots as needed
}

export class EquipmentVisualSystem extends SystemBase {
  private loader: GLTFLoader;
  private playerEquipment = new Map<string, PlayerEquipmentVisuals>();

  // Cache loaded weapon models to avoid reloading
  private weaponCache = new Map<string, GLTF>();

  // Queue equipment changes that are waiting for VRM to load
  private pendingEquipment = new Map<
    string,
    { slot: string; itemId: string }[]
  >();

  // Track players whose weapon is temporarily hidden during gathering
  // (e.g., fishing - weapon hidden while fishing rod is shown)
  private hiddenWeapons = new Set<string>();

  constructor(world: World) {
    super(world, {
      name: "equipment-visual",
      dependencies: {
        required: [],
        optional: ["player", "equipment"],
      },
      autoCleanup: true,
    });
    // Initialize loader with meshopt decoder for compressed GLB files
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async init(): Promise<void> {
    // Only run on client
    if (this.world.isServer) {
      return;
    }

    // Subscribe to equipment changes
    this.subscribe(
      EventType.PLAYER_EQUIPMENT_CHANGED,
      (data: { playerId: string; slot: string; itemId: string | null }) => {
        this.handleEquipmentChange(data);
      },
    );

    // Clean up when player leaves
    this.subscribe(EventType.PLAYER_CLEANUP, (data: { playerId: string }) => {
      this.cleanupPlayerEquipment(data.playerId);
    });

    // OSRS-STYLE: Show gathering tool during gathering (e.g., fishing rod during fishing)
    this.subscribe(
      EventType.GATHERING_TOOL_SHOW,
      (data: { playerId: string; itemId: string; slot: string }) => {
        this.handleGatheringToolShow(data);
      },
    );

    // Hide gathering tool when gathering stops
    this.subscribe(
      EventType.GATHERING_TOOL_HIDE,
      (data: { playerId: string; slot: string }) => {
        this.handleGatheringToolHide(data);
      },
    );
  }

  private async handleEquipmentChange(data: {
    playerId: string;
    slot: string;
    itemId: string | null;
  }): Promise<void> {
    const { playerId, slot, itemId } = data;

    // Skip invalid itemIds (only "0" is invalid, null means unequip)
    if (itemId === "0") {
      return;
    }

    // Get player entity to access VRM
    const player = this.world.entities.get(playerId);
    if (!player) {
      return;
    }

    // CRITICAL: instance.raw is GLTF, VRM is in userData.vrm!
    const playerWithAvatar = player as PlayerWithAvatar;
    const avatarInstance = playerWithAvatar._avatar?.instance;
    const vrm = avatarInstance?.raw?.userData?.vrm;

    if (!avatarInstance || !vrm) {
      // Queue this equipment change to retry when VRM is ready
      if (!this.pendingEquipment.has(playerId)) {
        this.pendingEquipment.set(playerId, []);
      }

      // Only queue if itemId is valid (not null or "0")
      if (itemId && itemId !== "0") {
        const queue = this.pendingEquipment.get(playerId)!;
        // Remove any existing entry for this slot
        const filtered = queue.filter((e) => e.slot !== slot);
        filtered.push({ slot, itemId });
        this.pendingEquipment.set(playerId, filtered);
      }

      return;
    }

    // Get or create equipment visuals for this player
    if (!this.playerEquipment.has(playerId)) {
      this.playerEquipment.set(playerId, {});
    }
    const equipment = this.playerEquipment.get(playerId)!;

    // Handle unequip (itemId is null)
    if (!itemId) {
      this.unequipVisual(playerId, slot, equipment, vrm);
      return;
    }

    // Handle equip - load and attach weapon
    await this.equipVisual(playerId, slot, itemId, equipment, vrm);
  }

  private unequipVisual(
    playerId: string,
    slot: string,
    equipment: PlayerEquipmentVisuals,
    _vrm: VRM,
  ): void {
    // Remove existing visual for this slot
    const slotKey = slot.toLowerCase() as keyof PlayerEquipmentVisuals;
    const existingVisual = equipment[slotKey];

    if (existingVisual && existingVisual.parent) {
      existingVisual.parent.remove(existingVisual);
    }

    equipment[slotKey] = undefined;
  }

  private async equipVisual(
    playerId: string,
    slot: string,
    itemId: string,
    equipment: PlayerEquipmentVisuals,
    vrm: VRM,
  ): Promise<void> {
    try {
      const assetsUrl = this.world.assetsUrl?.replace(/\/$/, "") || "";

      // Look up item data from manifest for equippedModelPath
      const itemData = getItem(itemId);
      let weaponUrl: string;
      let fallbackUrl: string | null = null;

      if (itemData?.equippedModelPath) {
        // Use explicit equippedModelPath from items.json
        // Convert "asset://models/..." to full CDN URL
        weaponUrl = itemData.equippedModelPath.replace(
          "asset://",
          `${assetsUrl}/`,
        );
      } else {
        // Fallback to convention-based derivation
        // itemId format: "{material}_{item}" e.g., "steel_sword"
        // asset format: "{item}-{material}" e.g., "sword-steel"
        let assetId = itemId.replace(/_/g, "-");

        // Check if we need to reverse the order (material_item -> item-material)
        const parts = itemId.split("_");
        if (parts.length === 2) {
          const [material, item] = parts;
          // Known materials to detect
          const materials = [
            "bronze",
            "steel",
            "mithril",
            "iron",
            "rune",
            "dragon",
            "wood",
            "oak",
            "willow",
            "yew",
          ];
          if (materials.includes(material)) {
            assetId = `${item}-${material}`;
          }
        }

        // Try fitted version first, fallback to base
        weaponUrl = `${assetsUrl}/models/${assetId}/${assetId}-aligned.glb`;
        fallbackUrl = `${assetsUrl}/models/${assetId}/${assetId}.glb`;
      }

      // Check cache first
      let gltf = this.weaponCache.get(itemId);

      if (!gltf) {
        try {
          gltf = await this.loader.loadAsync(weaponUrl);
        } catch (error) {
          // Fallback to base model if fitted version not found (only for convention-based)
          if (fallbackUrl) {
            gltf = await this.loader.loadAsync(fallbackUrl);
          } else {
            throw error;
          }
        }
        this.weaponCache.set(itemId, gltf);
      }

      const weaponMesh: THREE.Object3D = gltf.scene.clone(true); // Clone to allow multiple instances

      // Read attachment metadata from Asset Forge export
      // Try root first, then first child (EquipmentWrapper)
      let attachmentData = weaponMesh.userData.hyperscape as
        | EquipmentAttachmentData
        | undefined;

      // If not on root, check first child (the EquipmentWrapper)
      if (!attachmentData && weaponMesh.children[0]?.userData?.hyperscape) {
        attachmentData = weaponMesh.children[0].userData
          .hyperscape as EquipmentAttachmentData;
      }

      const boneName = attachmentData?.vrmBoneName || "rightHand";

      // Get VRM bone (cast to VRMHumanBoneName for type safety)
      if (!vrm.humanoid) {
        console.error(
          `[EquipmentVisual] ❌ VRM has no humanoid property for ${itemId}`,
        );
        return;
      }

      const bone = vrm.humanoid.getNormalizedBoneNode(
        boneName as VRMHumanBoneName,
      );
      if (!bone) {
        console.error(`[EquipmentVisual] ❌ VRM bone not found: ${boneName}`);
        return;
      }

      // Remove existing visual for this slot first
      this.unequipVisual(playerId, slot, equipment, vrm);

      // Get player entity for bone attachment
      const player = this.world.entities.get(playerId);
      if (!player) {
        console.error(
          `[EquipmentVisual] ❌ Player entity not found for ID: ${playerId}`,
        );
        return;
      }

      // Find the target bone in the player's live hierarchy
      const prefabBone = vrm.humanoid.getRawBoneNode(
        boneName as VRMHumanBoneName,
      );
      if (!prefabBone) {
        console.error(
          `[EquipmentVisual] ❌ VRM bone not found in prefab: ${boneName}`,
        );
        return;
      }

      const targetBoneName = prefabBone.name;
      let targetBone: THREE.Object3D | undefined = undefined;

      // Traverse the avatar's visual root (instance.raw) to find the bone
      const playerWithAvatar = player as PlayerWithAvatar;
      const rawInstance = playerWithAvatar._avatar?.instance?.raw;
      const avatarRoot = (rawInstance?.scene || rawInstance) as
        | THREE.Object3D
        | undefined;

      if (avatarRoot && avatarRoot.traverse) {
        avatarRoot.traverse((child) => {
          if (child.name === targetBoneName) {
            targetBone = child;
          }
        });
      } else {
        if (player.node) {
          player.node.traverse((child) => {
            if (child.name === targetBoneName) {
              targetBone = child;
            }
          });
        }
      }

      if (!targetBone) {
        console.error(
          `[EquipmentVisual] ❌ Could not find bone '${targetBoneName}' in avatar hierarchy`,
        );
        return;
      }

      // Store in component for tracking
      const slotKey = slot.toLowerCase() as keyof PlayerEquipmentVisuals;

      // === V2 FORMAT: Use relative matrix directly ===
      // Validate relativeMatrix is a proper 16-element array of numbers
      const hasValidMatrix =
        attachmentData?.version === 2 &&
        Array.isArray(attachmentData.relativeMatrix) &&
        attachmentData.relativeMatrix.length === 16 &&
        attachmentData.relativeMatrix.every(
          (n) => typeof n === "number" && !isNaN(n),
        );

      if (hasValidMatrix) {
        // Find the EquipmentWrapper which has the pre-baked transforms
        const equipmentWrapper = weaponMesh.children.find(
          (child) => child.name === "EquipmentWrapper",
        );

        if (equipmentWrapper) {
          // V2: The wrapper already has the correct relative transform baked in
          // Just attach it directly - no scale hacks needed!
          equipment[slotKey] = weaponMesh;
          (targetBone as THREE.Object3D).add(weaponMesh);
        } else {
          // Fallback: Apply relativeMatrix manually if no wrapper found
          const relativeMatrix = new THREE.Matrix4();
          relativeMatrix.fromArray(attachmentData.relativeMatrix);

          // Create a wrapper group with the relative transform
          const wrapperGroup = new THREE.Group();
          wrapperGroup.name = "EquipmentWrapper";

          // Decompose and apply the matrix
          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          relativeMatrix.decompose(position, quaternion, scale);

          wrapperGroup.position.copy(position);
          wrapperGroup.quaternion.copy(quaternion);
          wrapperGroup.scale.copy(scale);

          // Add weapon as child
          wrapperGroup.add(weaponMesh);

          equipment[slotKey] = wrapperGroup;
          (targetBone as THREE.Object3D).add(wrapperGroup);
        }
        return;
      }

      // === LEGACY FORMAT (V1): Use old logic with scale hack ===

      // Find the EquipmentWrapper child which has the fitting position
      const equipmentWrapper = weaponMesh.children.find(
        (child) => child.name === "EquipmentWrapper",
      );

      if (equipmentWrapper) {
        // LEGACY: Apply scale multiplier hack for V1 exports
        const WEAPON_SCALE_MULTIPLIER = 1.75;
        weaponMesh.scale.multiplyScalar(WEAPON_SCALE_MULTIPLIER);
      } else if (!attachmentData) {
        console.warn(
          `[EquipmentVisual] ⚠️ No EquipmentWrapper or metadata - applying default transform`,
        );
        // Fallback: Scale down to reasonable size
        weaponMesh.scale.set(0.01, 0.01, 0.01);
      }

      equipment[slotKey] = weaponMesh;

      // Add to the LIVE bone
      (targetBone as THREE.Object3D).add(weaponMesh);
    } catch (error) {
      console.error(`[EquipmentVisual] ❌ Error equipping ${itemId}:`, error);
    }
  }

  private cleanupPlayerEquipment(playerId: string): void {
    const equipment = this.playerEquipment.get(playerId);
    if (!equipment) return;

    // Remove all visuals
    for (const [_slot, visual] of Object.entries(equipment)) {
      if (visual && visual.parent) {
        visual.parent.remove(visual);
      }
    }

    this.playerEquipment.delete(playerId);
    this.pendingEquipment.delete(playerId); // Clear pending equipment too
    this.hiddenWeapons.delete(playerId); // Clear hidden weapon tracking
  }

  /**
   * OSRS-STYLE: Show gathering tool in hand during gathering animation
   * (e.g., fishing rod appears in hand even though it's in inventory, not equipped)
   *
   * This temporarily hides any equipped weapon and shows the gathering tool instead.
   */
  private async handleGatheringToolShow(data: {
    playerId: string;
    itemId: string;
    slot: string;
  }): Promise<void> {
    const { playerId, itemId } = data;

    // Get player entity to access VRM
    const player = this.world.entities.get(playerId);
    if (!player) {
      return;
    }

    const playerWithAvatar = player as PlayerWithAvatar;
    const avatarInstance = playerWithAvatar._avatar?.instance;
    const vrm = avatarInstance?.raw?.userData?.vrm;

    if (!avatarInstance || !vrm) {
      // VRM not ready - queue this for retry
      if (!this.pendingEquipment.has(playerId)) {
        this.pendingEquipment.set(playerId, []);
      }
      const queue = this.pendingEquipment.get(playerId)!;
      // Use special slot name to identify gathering tools
      queue.push({ slot: "gatheringTool", itemId });
      this.pendingEquipment.set(playerId, queue);
      return;
    }

    // Get or create equipment visuals for this player
    if (!this.playerEquipment.has(playerId)) {
      this.playerEquipment.set(playerId, {});
    }
    const equipment = this.playerEquipment.get(playerId)!;

    // OSRS-STYLE: Temporarily hide the equipped weapon while showing gathering tool
    // Check hiddenWeapons to prevent hiding multiple times on rapid calls
    if (
      equipment.weapon &&
      equipment.weapon.visible &&
      !this.hiddenWeapons.has(playerId)
    ) {
      equipment.weapon.visible = false;
      this.hiddenWeapons.add(playerId);
    }

    // Use "gatheringTool" slot to avoid conflicting with actual equipped weapon
    await this.equipVisual(playerId, "gatheringTool", itemId, equipment, vrm);
  }

  /**
   * Hide the temporary gathering tool when gathering stops
   *
   * This removes the gathering tool and restores any previously hidden weapon.
   */
  private handleGatheringToolHide(data: {
    playerId: string;
    slot: string;
  }): void {
    const { playerId } = data;

    // Get player entity to access VRM
    const player = this.world.entities.get(playerId);
    if (!player) {
      return;
    }

    const playerWithAvatar = player as PlayerWithAvatar;
    const vrm = playerWithAvatar._avatar?.instance?.raw?.userData?.vrm;

    if (!vrm) {
      return;
    }

    const equipment = this.playerEquipment.get(playerId);
    if (!equipment) {
      return;
    }

    // Remove the gathering tool visual
    this.unequipVisual(playerId, "gatheringTool", equipment, vrm);

    // OSRS-STYLE: Restore the equipped weapon that was hidden
    // Verify weapon exists and is currently hidden before restoring
    if (
      this.hiddenWeapons.has(playerId) &&
      equipment.weapon &&
      !equipment.weapon.visible
    ) {
      equipment.weapon.visible = true;
      this.hiddenWeapons.delete(playerId);
    }
  }

  update(_dt: number): void {
    // Process pending equipment for players whose VRM has now loaded
    for (const [playerId, pendingItems] of this.pendingEquipment.entries()) {
      if (pendingItems.length === 0) continue;

      const player = this.world.entities.get(playerId);
      if (!player) {
        // Player is gone, clear queue
        this.pendingEquipment.delete(playerId);
        continue;
      }

      const playerWithAvatar = player as PlayerWithAvatar;
      const avatar = playerWithAvatar._avatar;
      const avatarInstance = avatar?.instance;

      // CRITICAL: instance.raw is GLTF, VRM is in userData.vrm!
      const vrm = avatarInstance?.raw?.userData?.vrm as VRM | undefined;

      if (avatarInstance && vrm) {
        // VRM is now ready! Process all pending equipment

        // Get or create equipment visuals for this player
        if (!this.playerEquipment.has(playerId)) {
          this.playerEquipment.set(playerId, {});
        }
        const equipment = this.playerEquipment.get(playerId)!;

        // Process each pending item
        for (const { slot, itemId } of pendingItems) {
          this.equipVisual(playerId, slot, itemId, equipment, vrm);
        }

        // Clear the queue
        this.pendingEquipment.delete(playerId);
      }
    }
  }

  destroy(): void {
    // Clean up all equipment
    for (const playerId of this.playerEquipment.keys()) {
      this.cleanupPlayerEquipment(playerId);
    }

    // Clear cache and pending equipment
    this.weaponCache.clear();
    this.pendingEquipment.clear();

    super.destroy();
  }
}
