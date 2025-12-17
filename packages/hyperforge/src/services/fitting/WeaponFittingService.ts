/**
 * Weapon Fitting Service
 * Handles attachment of weapons to character hand bones
 *
 * Extracted from EquipmentViewer logic for weapon attachment
 */

import * as THREE from "three";
import type { Bone, Object3D } from "three";

import { logger } from "@/lib/utils";
import { validateVRMForFitting } from "@/lib/utils/vrm-detection";

const log = logger.child("WeaponFittingService");

export interface WeaponAttachmentOptions {
  equipmentSlot?: "Hand_R" | "Hand_L" | "RightHand" | "LeftHand";
  avatarHeight?: number;
  handOffsetDistance?: number;
  defaultOffsets?: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  };
}

export interface WeaponAttachmentResult {
  attachedWeapon: THREE.Group;
  targetBone: Bone | null;
  attachmentMetadata: {
    vrmBoneName: string;
    originalSlot: string;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  };
}

/**
 * Bone name mapping for finding hand bones
 */
const BONE_MAPPING: Record<string, string[]> = {
  Hand_R: [
    "Hand_R",
    "mixamorig:RightHand",
    "RightHand",
    "hand_r",
    "Bip01_R_Hand",
    "rightHand",
  ],
  Hand_L: [
    "Hand_L",
    "mixamorig:LeftHand",
    "LeftHand",
    "hand_l",
    "Bip01_L_Hand",
    "leftHand",
  ],
};

/**
 * Weapon Fitting Service
 */
export class WeaponFittingService {
  /**
   * Find bone by name with variations
   */
  private findBone(object: Object3D, boneNames: string[]): Bone | null {
    let found: Bone | null = null;

    object.traverse((child) => {
      if (child instanceof THREE.Bone || child.type === "Bone") {
        const childName = child.name.toLowerCase();
        for (const boneName of boneNames) {
          if (childName === boneName.toLowerCase()) {
            found = child as Bone;
            return;
          }
        }
      }
    });

    return found;
  }

  /**
   * Calculate avatar height from root object
   */
  private calculateAvatarHeight(avatar: Object3D): number {
    const box = new THREE.Box3().setFromObject(avatar);
    const size = box.getSize(new THREE.Vector3());
    return size.y;
  }

  /**
   * Attach weapon to character hand bone
   *
   * IMPORTANT: Character must be in VRM format for proper bone mapping
   *
   * @param weapon - The weapon model to attach
   * @param character - The character model (must be VRM format)
   * @param options - Attachment options
   * @param characterModelUrl - Optional URL to check if character is VRM format
   */
  attachWeaponToHand(
    weapon: Object3D,
    character: Object3D,
    options: WeaponAttachmentOptions = {},
    characterModelUrl?: string,
  ): WeaponAttachmentResult {
    // Validate character is VRM format
    const validation = validateVRMForFitting(character, characterModelUrl);

    if (!validation.isValid) {
      throw new Error(
        validation.error ||
          "Character model must be in VRM format for weapon fitting",
      );
    }

    const {
      equipmentSlot = "Hand_R",
      avatarHeight,
      handOffsetDistance,
      defaultOffsets,
    } = options;

    log.info(`Attaching weapon to ${equipmentSlot}`);

    // Find target bone
    const boneNames = BONE_MAPPING[equipmentSlot] || BONE_MAPPING["Hand_R"];
    const targetBone = this.findBone(character, boneNames);

    if (!targetBone) {
      log.warn(`Could not find target bone for slot: ${equipmentSlot}`);
      // Return weapon as-is with metadata
      return {
        attachedWeapon: weapon as THREE.Group,
        targetBone: null,
        attachmentMetadata: {
          vrmBoneName: equipmentSlot.includes("Right")
            ? "rightHand"
            : "leftHand",
          originalSlot: equipmentSlot,
          position: new THREE.Vector3(),
          rotation: new THREE.Euler(),
          scale: new THREE.Vector3(1, 1, 1),
        },
      };
    }

    // Calculate effective height
    const effectiveHeight =
      avatarHeight || this.calculateAvatarHeight(character);
    const offsetDistance = handOffsetDistance || effectiveHeight * 0.045;

    // Default offsets for hand attachment
    const offsets = defaultOffsets || {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    // Create wrapper group
    const wrapper = new THREE.Group();
    wrapper.name = "WeaponWrapper";

    // Update world matrices
    character.updateMatrixWorld(true);
    targetBone.updateMatrixWorld(true);

    // Determine if right or left hand
    const isRightHand =
      equipmentSlot.includes("_R") || equipmentSlot.includes("Right");

    // Set initial position and rotation
    wrapper.position.set(
      offsets.position.x,
      offsets.position.y + offsetDistance,
      offsets.position.z,
    );
    wrapper.rotation.set(
      offsets.rotation.x,
      offsets.rotation.y + (isRightHand ? 0 : Math.PI), // Flip for left hand
      offsets.rotation.z,
    );

    // Add weapon to wrapper
    wrapper.add(weapon);

    // Attach wrapper to bone
    targetBone.add(wrapper);

    // Update matrices
    wrapper.updateMatrixWorld(true);

    // Map to VRM bone name
    const vrmBoneName = isRightHand ? "rightHand" : "leftHand";

    log.info(`Weapon attached to ${vrmBoneName}`);

    return {
      attachedWeapon: wrapper,
      targetBone,
      attachmentMetadata: {
        vrmBoneName,
        originalSlot: equipmentSlot,
        position: wrapper.position.clone(),
        rotation: wrapper.rotation.clone(),
        scale: wrapper.scale.clone(),
      },
    };
  }

  /**
   * Export weapon with attachment metadata
   */
  exportWeaponWithMetadata(
    weaponWrapper: THREE.Group,
    metadata: WeaponAttachmentResult["attachmentMetadata"],
  ): Object3D {
    // Clone the wrapper to preserve hierarchy
    const exportRoot = weaponWrapper.clone(true);

    // Embed metadata in userData
    exportRoot.userData.hyperscape = {
      vrmBoneName: metadata.vrmBoneName,
      originalSlot: metadata.originalSlot,
      usage: `Attach to VRM bone '${metadata.vrmBoneName}' with identity transform. Position/rotation are pre-baked.`,
      weaponType: "weapon",
      exportedFrom: "hyperforge-weapon-fitting",
      exportedAt: new Date().toISOString(),
      note: `This weapon is pre-positioned. In Hyperscape: vrm.humanoid.getNormalizedBoneNode('${metadata.vrmBoneName}').add(weapon)`,
    };

    return exportRoot;
  }
}
