/**
 * VRMConverter - Convert Meshy GLB to VRM 1.0 Format
 *
 * Converts non-standard Meshy GLB exports to standardized VRM format for use with
 * Hyperfy/Hyperscape animation system.
 *
 * **What VRM Provides:**
 * - Standardized Y-up coordinate system
 * - HumanoidBone naming convention (hips, leftUpperArm, etc.)
 * - Defined T-pose rest pose
 * - Works with existing Hyperfy VRM animation pipeline
 *
 * **Conversion Process:**
 * 1. Load Meshy GLB file
 * 2. Analyze skeleton structure and detect coordinate system
 * 3. Map Meshy bones to VRM HumanoidBone standard
 * 4. Fix coordinate system to Y-up if needed
 * 5. Ensure T-pose rest pose
 * 6. Add VRM 1.0 extensions to glTF
 * 7. Export as VRM GLB file
 *
 * **VRM 1.0 Specification:**
 * - Extension: VRMC_vrm
 * - specVersion: "1.0"
 * - humanoid: Bone mappings to glTF nodes
 * - meta: Avatar metadata (name, version, authors, etc.)
 *
 * **Referenced by:** Asset Forge UI, character import pipeline
 */

// Server-side polyfills must come first
import "@/lib/server/three-polyfills";

import * as THREE from "three";
import { logger } from "@/lib/utils";

const log = logger.child("VRMConverter");
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { MESHY_VARIATIONS, findMeshyBoneName } from "./BoneMappings";
import { parseGLB, buildGLB } from "@/lib/utils/glb-binary-utils";
import type {
  GLTFNode,
  GLTFMesh,
  GLTFMaterial,
  GLTFTexture,
  GLTFImage,
  GLTFExtensionData,
} from "@/types/service-types";

/**
 * Type definitions for glTF JSON structure used in VRM conversion
 */
interface GLTFBuffer {
  byteLength: number;
  uri?: string;
}

interface GLTFJson {
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  materials?: GLTFMaterial[];
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  buffers?: GLTFBuffer[];
  extensionsUsed?: string[];
  extensions?: Record<string, GLTFExtensionData>;
}

/**
 * VRM HumanoidBone names (VRM 1.0 standard)
 * These are the standardized bone names used by VRM format
 */
export const VRM_HUMANOID_BONES = {
  // Torso
  hips: "hips",
  spine: "spine",
  chest: "chest",
  upperChest: "upperChest",
  neck: "neck",
  head: "head",
  // Left Arm
  leftShoulder: "leftShoulder",
  leftUpperArm: "leftUpperArm",
  leftLowerArm: "leftLowerArm",
  leftHand: "leftHand",
  // Right Arm
  rightShoulder: "rightShoulder",
  rightUpperArm: "rightUpperArm",
  rightLowerArm: "rightLowerArm",
  rightHand: "rightHand",
  // Left Leg
  leftUpperLeg: "leftUpperLeg",
  leftLowerLeg: "leftLowerLeg",
  leftFoot: "leftFoot",
  leftToes: "leftToes",
  // Right Leg
  rightUpperLeg: "rightUpperLeg",
  rightLowerLeg: "rightLowerLeg",
  rightFoot: "rightFoot",
  rightToes: "rightToes",
  // Fingers (optional)
  leftThumbProximal: "leftThumbProximal",
  leftThumbIntermediate: "leftThumbIntermediate",
  leftThumbDistal: "leftThumbDistal",
  leftIndexProximal: "leftIndexProximal",
  leftIndexIntermediate: "leftIndexIntermediate",
  leftIndexDistal: "leftIndexDistal",
  leftMiddleProximal: "leftMiddleProximal",
  leftMiddleIntermediate: "leftMiddleIntermediate",
  leftMiddleDistal: "leftMiddleDistal",
  leftRingProximal: "leftRingProximal",
  leftRingIntermediate: "leftRingIntermediate",
  leftRingDistal: "leftRingDistal",
  leftLittleProximal: "leftLittleProximal",
  leftLittleIntermediate: "leftLittleIntermediate",
  leftLittleDistal: "leftLittleDistal",
  rightThumbProximal: "rightThumbProximal",
  rightThumbIntermediate: "rightThumbIntermediate",
  rightThumbDistal: "rightThumbDistal",
  rightIndexProximal: "rightIndexProximal",
  rightIndexIntermediate: "rightIndexIntermediate",
  rightIndexDistal: "rightIndexDistal",
  rightMiddleProximal: "rightMiddleProximal",
  rightMiddleIntermediate: "rightMiddleIntermediate",
  rightMiddleDistal: "rightMiddleDistal",
  rightRingProximal: "rightRingProximal",
  rightRingIntermediate: "rightRingIntermediate",
  rightRingDistal: "rightRingDistal",
  rightLittleProximal: "rightLittleProximal",
  rightLittleIntermediate: "rightLittleIntermediate",
  rightLittleDistal: "rightLittleDistal",
} as const;

/**
 * Meshy bone name → VRM HumanoidBone mapping
 * Uses fuzzy matching to handle case variations
 */
const MESHY_TO_VRM_BONE_MAP: Record<string, keyof typeof VRM_HUMANOID_BONES> = {
  // Torso
  Hips: "hips",
  Spine: "spine",
  Spine01: "chest",
  Spine02: "upperChest",
  neck: "neck",
  Head: "head",
  // Left Arm
  LeftShoulder: "leftShoulder",
  LeftArm: "leftUpperArm",
  LeftForeArm: "leftLowerArm",
  LeftHand: "leftHand",
  // Right Arm
  RightShoulder: "rightShoulder",
  RightArm: "rightUpperArm",
  RightForeArm: "rightLowerArm",
  RightHand: "rightHand",
  // Left Leg
  LeftUpLeg: "leftUpperLeg",
  LeftLeg: "leftLowerLeg",
  LeftFoot: "leftFoot",
  LeftToe: "leftToes",
  // Right Leg
  RightUpLeg: "rightUpperLeg",
  RightLeg: "rightLowerLeg",
  RightFoot: "rightFoot",
  RightToe: "rightToes",
};

export interface VRMConversionOptions {
  avatarName?: string;
  author?: string;
  version?: string;
  licenseUrl?: string;
  commercialUsage?: "personalNonProfit" | "personalProfit" | "corporation";
}

export interface VRMConversionResult {
  vrmData: ArrayBuffer;
  boneMappings: Map<string, string>;
  warnings: string[];
  coordinateSystemFixed: boolean;
}

/**
 * VRM Converter Service
 *
 * Converts Meshy GLB files to VRM 1.0 format
 */
export class VRMConverter {
  private scene!: THREE.Scene;
  private bones: THREE.Bone[] = [];
  private skinnedMesh!: THREE.SkinnedMesh;
  private boneMappings = new Map<string, string>();
  private warnings: string[] = [];
  private coordinateSystemFixed = false;

  /**
   * Convert Meshy GLB to VRM format
   *
   * @param glbData - Loaded GLB data from Meshy
   * @param options - VRM metadata options
   * @returns VRM file as ArrayBuffer with conversion info
   */
  async convert(
    glbData: THREE.Group | THREE.Scene,
    options: VRMConversionOptions = {},
  ): Promise<VRMConversionResult> {
    log.info("🎭 Starting VRM conversion...");

    // Reset state
    this.boneMappings.clear();
    this.warnings = [];
    this.coordinateSystemFixed = false;

    // Extract scene and skeleton
    this.scene = glbData instanceof THREE.Scene ? glbData : new THREE.Scene();
    if (glbData instanceof THREE.Group) {
      this.scene.add(glbData);
    }

    // Find skinned mesh and bones
    this.extractSkeleton();

    // Normalize scale to standard VRM size
    this.normalizeScale();

    // Map bones to VRM HumanoidBone standard
    this.mapBonesToVRM();

    // Export as VRM GLB (this will create VRM extensions internally with correct node indices)
    const vrmData = await this.exportVRM(options);

    log.info("✅ VRM conversion complete!");
    log.info(`   Bones mapped: ${this.boneMappings.size}`);
    log.info(`   Warnings: ${this.warnings.length}`);
    log.info(
      `   VRM file size: ${(vrmData.byteLength / 1024 / 1024).toFixed(2)} MB`,
    );

    // Debug: Log bone mappings
    log.info("   Bone mappings:");
    for (const [meshyBone, vrmBone] of this.boneMappings.entries()) {
      log.info(`     ${meshyBone} → ${vrmBone}`);
    }

    return {
      vrmData,
      boneMappings: this.boneMappings,
      warnings: this.warnings,
      coordinateSystemFixed: this.coordinateSystemFixed,
    };
  }

  /**
   * Extract skeleton from scene
   */
  private extractSkeleton(): void {
    log.info("🦴 Extracting skeleton...");

    // Find first SkinnedMesh
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh && !this.skinnedMesh) {
        this.skinnedMesh = obj;
        if (obj.skeleton) {
          this.bones = obj.skeleton.bones;
          log.info(`   Found skeleton with ${this.bones.length} bones`);
        }
      }
    });

    if (!this.skinnedMesh) {
      throw new Error("No SkinnedMesh found in GLB file");
    }

    if (this.bones.length === 0) {
      throw new Error("No bones found in skeleton");
    }

    // DEBUG: Log initial bone transforms (BEFORE any modifications)
    log.info("🔍 [DEBUG] Initial bone transforms after extraction:");
    this.logBoneTransforms("AFTER_EXTRACTION");

    // DEBUG: Log scene hierarchy
    log.info("🔍 [DEBUG] Scene hierarchy:");
    this.logSceneHierarchy(this.scene, 0);
  }

  /**
   * Normalize scale to standard VRM size
   * VRM avatars should be around 1.6-1.8 units tall (meters)
   *
   * CRITICAL: We bake the scale into geometry vertices and bone positions,
   * NOT into scene.scale, to avoid bone rotation issues during glTF export
   */
  private normalizeScale(): void {
    log.info("📏 Normalizing scale...");

    // Find hips and head bones to measure height
    const hipsBone = this.findBoneByName("Hips");
    const headBone = this.findBoneByName("Head");

    if (!hipsBone || !headBone) {
      log.info("   ⚠️  Could not find hips/head bones for scale normalization");
      this.warnings.push("Could not normalize scale - bones not found");
      return;
    }

    // CRITICAL FIX: Find and bake out the Armature parent scale FIRST
    // Meshy models have an Armature with scale 0.01 that needs to be baked
    let armature: THREE.Object3D | null = null;
    this.scene.traverse((obj) => {
      if (obj.name === "Armature" && obj !== this.skinnedMesh) {
        armature = obj;
      }
    });

    if (armature && (armature as THREE.Object3D).parent) {
      const armatureObj = armature as THREE.Object3D;
      const armatureScale = armatureObj.scale.x; // Assume uniform scale
      log.info(`   Found Armature with scale: ${armatureScale.toFixed(3)}`);

      if (Math.abs(armatureScale - 1.0) > 0.001) {
        // Calculate compensation factor: if armature is 0.01, we need to scale up by 100
        const compensationScale = 1.0 / armatureScale;
        log.info(
          `   Baking Armature scale ${armatureScale} → compensating by ${compensationScale.toFixed(1)}x...`,
        );

        // CRITICAL: Scale ALL skinned mesh geometries to compensate for removing parent scale
        // Without this, meshes will appear 100x smaller than the skeleton
        let meshCount = 0;
        this.scene.traverse((obj) => {
          if (obj instanceof THREE.SkinnedMesh && obj.geometry) {
            obj.geometry.scale(
              compensationScale,
              compensationScale,
              compensationScale,
            );
            meshCount++;
          }
        });
        log.info(
          `   ✅ Scaled ${meshCount} mesh geometries by ${compensationScale.toFixed(1)}x`,
        );

        // Scale bone local positions to keep world positions the same after parent scale removal
        this.bones.forEach((bone) => {
          bone.position.multiplyScalar(compensationScale);
        });
        log.info(
          `   ✅ Scaled ${this.bones.length} bone positions by ${compensationScale.toFixed(1)}x`,
        );

        // Set Armature scale to 1.0 (removing the parent scale)
        armatureObj.scale.set(1, 1, 1);

        // Update world matrices
        this.scene.updateMatrixWorld(true);

        // Recalculate skeleton inverse bind matrices for ALL skinned meshes
        this.scene.traverse((obj) => {
          if (obj instanceof THREE.SkinnedMesh && obj.skeleton) {
            obj.skeleton.calculateInverses();
          }
        });
        log.info("   ✅ Recalculated skeleton inverse bind matrices");

        log.info(`   ✅ Armature scale baked into geometry and skeleton`);
      }
    }

    // Update world matrices after armature baking
    this.scene.updateMatrixWorld(true);

    // Get world positions AFTER baking Armature scale
    const hipsPos = new THREE.Vector3();
    const headPos = new THREE.Vector3();
    hipsBone.getWorldPosition(hipsPos);
    headBone.getWorldPosition(headPos);

    // Calculate current height
    const currentHeight = hipsPos.distanceTo(headPos);
    log.info(
      `   Current height (hips to head): ${currentHeight.toFixed(3)} units`,
    );

    // Target height for VRM (1.6 meters is typical)
    const targetHeight = 1.6;
    const scaleFactor = targetHeight / currentHeight;

    // Only scale if significantly off (more than 10% difference)
    if (Math.abs(scaleFactor - 1.0) > 0.1) {
      log.info(
        `   Applying height normalization scale: ${scaleFactor.toFixed(3)}`,
      );

      // Scale ALL skinned mesh geometries
      let meshCount = 0;
      this.scene.traverse((obj) => {
        if (obj instanceof THREE.SkinnedMesh && obj.geometry) {
          obj.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
          meshCount++;
        }
      });
      log.info(
        `   ✅ Scaled ${meshCount} mesh geometries by ${scaleFactor.toFixed(3)}`,
      );

      // Scale bone local positions (all bones get scaled)
      this.bones.forEach((bone) => {
        bone.position.multiplyScalar(scaleFactor);
      });
      log.info(
        `   ✅ Scaled ${this.bones.length} bone positions by ${scaleFactor.toFixed(3)}`,
      );

      // Update world matrices
      this.scene.updateMatrixWorld(true);

      // Recalculate inverse bind matrices for ALL skinned meshes
      this.scene.traverse((obj) => {
        if (obj instanceof THREE.SkinnedMesh && obj.skeleton) {
          obj.skeleton.calculateInverses();
        }
      });
      log.info("   ✅ Recalculated inverse bind matrices after height scaling");

      // DEBUG: Log bone transforms after scaling
      log.info("🔍 [DEBUG] Bone transforms after scaling:");
      this.logBoneTransforms("AFTER_SCALING");

      // Verify mesh and skeleton alignment
      this.verifyMeshSkeletonAlignment();
    } else {
      log.info("   ✅ Scale is already appropriate");
    }

    // VALIDATION: Verify final height is 1.6m
    this.scene.updateMatrixWorld(true);
    const finalHipsPos = new THREE.Vector3();
    const finalHeadPos = new THREE.Vector3();
    if (hipsBone) hipsBone.getWorldPosition(finalHipsPos);
    if (headBone) headBone.getWorldPosition(finalHeadPos);
    const finalHeight = finalHipsPos.distanceTo(finalHeadPos);

    log.info("📏 [VALIDATION] Final avatar height verification:");
    log.info(`   Hips to Head distance: ${finalHeight.toFixed(3)}m`);
    log.info(`   Target height: 1.600m`);
    log.info(`   Difference: ${Math.abs(finalHeight - 1.6).toFixed(3)}m`);

    if (Math.abs(finalHeight - 1.6) > 0.05) {
      log.warn(
        `   ⚠️  WARNING: Final height ${finalHeight.toFixed(3)}m deviates from target 1.6m!`,
      );
      this.warnings.push(
        `Final height ${finalHeight.toFixed(3)}m deviates from target 1.6m`,
      );
    } else {
      log.info("   ✅ Height normalization successful");
    }
  }

  /**
   * Verify that mesh and skeleton are properly aligned
   * by checking the bounding boxes match
   */
  private verifyMeshSkeletonAlignment(): void {
    log.info("🔍 Verifying mesh-skeleton alignment...");

    if (!this.skinnedMesh || !this.skinnedMesh.geometry) {
      log.warn("   ⚠️  Cannot verify - no skinned mesh");
      return;
    }

    // Get mesh bounding box
    this.skinnedMesh.geometry.computeBoundingBox();
    const meshBBox = this.skinnedMesh.geometry.boundingBox;
    if (!meshBBox) {
      log.warn("   ⚠️  Cannot compute mesh bounding box");
      return;
    }

    // Get skeleton bounding box (from bone world positions)
    const skeletonMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const skeletonMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    this.bones.forEach((bone) => {
      const worldPos = new THREE.Vector3();
      bone.getWorldPosition(worldPos);
      skeletonMin.min(worldPos);
      skeletonMax.max(worldPos);
    });

    const meshSize = meshBBox.max.clone().sub(meshBBox.min);
    const skeletonSize = skeletonMax.clone().sub(skeletonMin);

    log.info("   Mesh bounding box:");
    log.info(
      `     Min: [${meshBBox.min.x.toFixed(3)}, ${meshBBox.min.y.toFixed(3)}, ${meshBBox.min.z.toFixed(3)}]`,
    );
    log.info(
      `     Max: [${meshBBox.max.x.toFixed(3)}, ${meshBBox.max.y.toFixed(3)}, ${meshBBox.max.z.toFixed(3)}]`,
    );
    log.info(
      `     Size: [${meshSize.x.toFixed(3)}, ${meshSize.y.toFixed(3)}, ${meshSize.z.toFixed(3)}]`,
    );

    log.info("   Skeleton bounding box:");
    log.info(
      `     Min: [${skeletonMin.x.toFixed(3)}, ${skeletonMin.y.toFixed(3)}, ${skeletonMin.z.toFixed(3)}]`,
    );
    log.info(
      `     Max: [${skeletonMax.x.toFixed(3)}, ${skeletonMax.y.toFixed(3)}, ${skeletonMax.z.toFixed(3)}]`,
    );
    log.info(
      `     Size: [${skeletonSize.x.toFixed(3)}, ${skeletonSize.y.toFixed(3)}, ${skeletonSize.z.toFixed(3)}]`,
    );

    // Check if sizes are roughly similar (within 50% difference)
    const heightRatio = meshSize.y / skeletonSize.y;
    if (heightRatio < 0.5 || heightRatio > 2.0) {
      const warning = `Mesh-skeleton height mismatch! Mesh height: ${meshSize.y.toFixed(3)}, Skeleton height: ${skeletonSize.y.toFixed(3)}, Ratio: ${heightRatio.toFixed(2)}x`;
      log.warn(`   ⚠️  ${warning}`);
      this.warnings.push(warning);
    } else {
      log.info(
        `   ✅ Mesh and skeleton alignment OK (height ratio: ${heightRatio.toFixed(2)}x)`,
      );
    }
  }

  /**
   * Map Meshy bones to VRM HumanoidBone names
   */
  private mapBonesToVRM(): void {
    log.info("🗺️  Mapping bones to VRM HumanoidBone standard...");

    let mappedCount = 0;

    for (const bone of this.bones) {
      const boneName = bone.name;

      // Try exact match first
      let vrmBoneName = MESHY_TO_VRM_BONE_MAP[boneName];

      // Try case-insensitive match
      if (!vrmBoneName) {
        const variations = MESHY_VARIATIONS[boneName] || [];
        for (const variation of variations) {
          if (MESHY_TO_VRM_BONE_MAP[variation]) {
            vrmBoneName = MESHY_TO_VRM_BONE_MAP[variation];
            break;
          }
        }
      }

      if (vrmBoneName) {
        this.boneMappings.set(boneName, vrmBoneName);
        mappedCount++;
      }
    }

    log.info(`   Mapped ${mappedCount}/${this.bones.length} bones`);

    // Verify required bones
    const requiredBones = [
      "hips",
      "spine",
      "head",
      "leftUpperArm",
      "rightUpperArm",
      "leftUpperLeg",
      "rightUpperLeg",
    ];
    const missingRequired: string[] = [];

    for (const requiredBone of requiredBones) {
      const found = Array.from(this.boneMappings.values()).includes(
        requiredBone,
      );
      if (!found) {
        missingRequired.push(requiredBone);
      }
    }

    if (missingRequired.length > 0) {
      this.warnings.push(
        `Missing required bones: ${missingRequired.join(", ")}`,
      );
    }

    // SKIP T-pose normalization - preserve original bind pose like online VRM viewers do
    // Our AnimationRetargeting.ts already handles bind pose compensation (lines 85-120)
    log.info(
      "🤸 Preserving original bind pose (matches online VRM viewers)...",
    );

    // CRITICAL FIX: Ensure Hips bone has local translation
    // Hyperscape needs Hips.translation to be set for animation scaling
    this.ensureHipsTranslation();
  }

  /**
   * Normalize bind pose to T-pose
   *
   * This fixes non-T-pose VRMs (like A-pose from Meshy) by:
   * 1. Setting Hips to identity (straight up)
   * 2. Setting arm bones to T-pose (straight out to sides)
   * 3. Compensating all children to preserve world poses
   * 4. Recalculating inverse bind matrices to preserve skin weights
   */
  private normalizeBindPoseToTPose(): void {
    log.info("🔧 Normalizing bind pose from A-pose to T-pose...");

    const hipsBone = this.findBoneByName("Hips");
    if (!hipsBone) {
      log.error("   ❌ Cannot normalize - Hips bone not found");
      return;
    }

    // Store the original Hips rotation (to compensate children)
    const hipsOriginalRot = hipsBone.quaternion.clone();
    log.info(
      `   Hips original rotation: [${hipsOriginalRot.x.toFixed(3)}, ${hipsOriginalRot.y.toFixed(3)}, ${hipsOriginalRot.z.toFixed(3)}, ${hipsOriginalRot.w.toFixed(3)}]`,
    );

    // Recursively compensate all descendants when a bone's rotation changes
    const compensateDescendants = (
      bone: THREE.Bone,
      parentDeltaRot: THREE.Quaternion,
    ) => {
      bone.children.forEach((child) => {
        if (child instanceof THREE.Bone) {
          // Store original local rotation
          const childOriginalLocal = child.quaternion.clone();

          // New local rotation = parentDelta * child's original local rotation
          // This preserves the child's world rotation when parent changes
          child.quaternion.copy(parentDeltaRot).multiply(childOriginalLocal);

          log.info(
            `      Compensated ${child.name}: [${childOriginalLocal.x.toFixed(3)}, ${childOriginalLocal.y.toFixed(3)}, ${childOriginalLocal.z.toFixed(3)}, ${childOriginalLocal.w.toFixed(3)}] -> [${child.quaternion.x.toFixed(3)}, ${child.quaternion.y.toFixed(3)}, ${child.quaternion.z.toFixed(3)}, ${child.quaternion.w.toFixed(3)}]`,
          );

          // Recursively compensate all descendants (with identity since this child's world rotation is preserved)
          compensateDescendants(child, new THREE.Quaternion(0, 0, 0, 1));
        }
      });
    };

    // 1. Fix Hips to T-pose (identity rotation)
    compensateDescendants(hipsBone, hipsOriginalRot);
    hipsBone.quaternion.set(0, 0, 0, 1);
    log.info("   ✅ Set Hips to identity and compensated all descendants");

    // Update world matrices after Hips change
    this.scene.updateMatrixWorld(true);

    // 2. Fix shoulder and arm bones to T-pose (straight out to sides)
    // In A-pose, both shoulders AND arms are rotated. We need to fix both.
    const leftShoulderBone = this.findBoneByName("LeftShoulder");
    const leftArmBone =
      this.findBoneByName("LeftArm") || this.findBoneByName("LeftUpperArm");
    const rightShoulderBone = this.findBoneByName("RightShoulder");
    const rightArmBone =
      this.findBoneByName("RightArm") || this.findBoneByName("RightUpperArm");

    // Fix left shoulder first, then arm
    if (leftShoulderBone) {
      const leftShoulderOriginalRot = leftShoulderBone.quaternion.clone();
      log.info(
        `   LeftShoulder original rotation: [${leftShoulderOriginalRot.x.toFixed(3)}, ${leftShoulderOriginalRot.y.toFixed(3)}, ${leftShoulderOriginalRot.z.toFixed(3)}, ${leftShoulderOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing shoulder rotation
      compensateDescendants(leftShoulderBone, leftShoulderOriginalRot);

      // Set shoulder to T-pose (identity)
      leftShoulderBone.quaternion.set(0, 0, 0, 1);
      log.info("   ✅ Set LeftShoulder to T-pose and compensated descendants");
    }

    if (leftArmBone) {
      const leftArmOriginalRot = leftArmBone.quaternion.clone();
      log.info(
        `   LeftArm original rotation: [${leftArmOriginalRot.x.toFixed(3)}, ${leftArmOriginalRot.y.toFixed(3)}, ${leftArmOriginalRot.z.toFixed(3)}, ${leftArmOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing arm rotation
      compensateDescendants(leftArmBone, leftArmOriginalRot);

      // Set arm to T-pose (identity - straight out)
      leftArmBone.quaternion.set(0, 0, 0, 1);
      log.info("   ✅ Set LeftArm to T-pose and compensated descendants");
    } else {
      log.warn("   ⚠️  LeftArm bone not found - skipping arm normalization");
    }

    // Fix right shoulder first, then arm
    if (rightShoulderBone) {
      const rightShoulderOriginalRot = rightShoulderBone.quaternion.clone();
      log.info(
        `   RightShoulder original rotation: [${rightShoulderOriginalRot.x.toFixed(3)}, ${rightShoulderOriginalRot.y.toFixed(3)}, ${rightShoulderOriginalRot.z.toFixed(3)}, ${rightShoulderOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing shoulder rotation
      compensateDescendants(rightShoulderBone, rightShoulderOriginalRot);

      // Set shoulder to T-pose (identity)
      rightShoulderBone.quaternion.set(0, 0, 0, 1);
      log.info("   ✅ Set RightShoulder to T-pose and compensated descendants");
    }

    if (rightArmBone) {
      const rightArmOriginalRot = rightArmBone.quaternion.clone();
      log.info(
        `   RightArm original rotation: [${rightArmOriginalRot.x.toFixed(3)}, ${rightArmOriginalRot.y.toFixed(3)}, ${rightArmOriginalRot.z.toFixed(3)}, ${rightArmOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing arm rotation
      compensateDescendants(rightArmBone, rightArmOriginalRot);

      // Set arm to T-pose (identity - straight out)
      rightArmBone.quaternion.set(0, 0, 0, 1);
      log.info("   ✅ Set RightArm to T-pose and compensated descendants");
    } else {
      log.warn("   ⚠️  RightArm bone not found - skipping arm normalization");
    }

    // Update world matrices after all bone changes
    this.scene.updateMatrixWorld(true);

    // CRITICAL: Recalculate inverse bind matrices for the new T-pose bind pose
    // We changed the skeleton's bind pose from A-pose to T-pose, so we MUST recalculate
    log.info(
      "   🔧 Recalculating inverse bind matrices for new T-pose bind pose...",
    );
    if (this.skinnedMesh && this.skinnedMesh.skeleton) {
      this.skinnedMesh.skeleton.calculateInverses();
      log.info("   ✅ Inverse bind matrices recalculated");
    }

    // Verify T-pose
    const newHipsRot = hipsBone.quaternion;
    const newRotationMagnitude = Math.sqrt(
      newHipsRot.x * newHipsRot.x +
        newHipsRot.y * newHipsRot.y +
        newHipsRot.z * newHipsRot.z,
    );
    log.info(
      `   Final Hips rotation: [${newHipsRot.x.toFixed(3)}, ${newHipsRot.y.toFixed(3)}, ${newHipsRot.z.toFixed(3)}, ${newHipsRot.w.toFixed(3)}]`,
    );
    log.info(`   Final rotation magnitude: ${newRotationMagnitude.toFixed(3)}`);

    if (newRotationMagnitude < 0.001) {
      log.info("   ✅ Successfully normalized to T-pose");
    } else {
      log.warn("   ⚠️  T-pose normalization may be incomplete");
    }

    // Update world matrices one more time
    this.scene.updateMatrixWorld(true);

    // Debug: Log bone transforms after T-pose normalization
    log.info("🔍 [DEBUG] Bone transforms after T-pose normalization:");
    this.logBoneTransforms("AFTER_TPOSE_NORMALIZATION");
  }

  /**
   * Ensure Hips bone has local translation set
   *
   * Many GLB exporters put the skeleton height on the Armature parent,
   * leaving Hips with zero local position. For VRM/Hyperscape compatibility,
   * we need Hips to have its world Y position as local translation.
   */
  private ensureHipsTranslation(): void {
    log.info("📏 Ensuring Hips bone has local translation...");

    const hipsBone = this.findBoneByName("Hips");
    if (!hipsBone) {
      log.warn("   ⚠️  Cannot ensure Hips translation - Hips bone not found");
      return;
    }

    // Get current world and local positions
    const worldPos = new THREE.Vector3();
    hipsBone.getWorldPosition(worldPos);
    const localPos = hipsBone.position;

    log.info(
      `   Current Hips local position: [${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)}]`,
    );
    log.info(
      `   Current Hips world position: [${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)}]`,
    );

    // Check if parent is Armature or similar container (not a Bone)
    const parent = hipsBone.parent;
    if (parent && parent.type !== "Bone") {
      log.info(
        `   Parent is ${parent.type} (${parent.name}) - need to bake transform`,
      );

      // ALWAYS bake world position into Hips local position when parent is not a bone
      // This ensures Hips.translation is set in the exported glTF
      log.info("   🔧 Baking Hips world position into local position...");

      // Set Hips local position to its current world position
      hipsBone.position.copy(worldPos);

      // Zero out parent's transform to make it transparent
      parent.position.set(0, 0, 0);
      parent.rotation.set(0, 0, 0);
      parent.scale.set(1, 1, 1);
      parent.updateMatrix();
      parent.updateMatrixWorld(true);

      log.info(
        `   ✅ Baked world position into Hips local: [${hipsBone.position.x.toFixed(3)}, ${hipsBone.position.y.toFixed(3)}, ${hipsBone.position.z.toFixed(3)}]`,
      );

      // Update world matrices
      this.scene.updateMatrixWorld(true);

      // Recalculate inverse bind matrices since we changed bone positions
      if (this.skinnedMesh.skeleton) {
        this.skinnedMesh.skeleton.calculateInverses();
        log.info("   ✅ Recalculated inverse bind matrices");
      }
    } else {
      log.info("   ✅ Hips parent is a Bone - local position already correct");
    }
  }

  /**
   * Export scene as VRM GLB
   *
   * CRITICAL: We export as binary GLB first, then parse and modify the JSON
   * chunk to add VRM extensions. This ensures the BIN chunk data matches
   * the accessor/bufferView references in the JSON.
   */
  private async exportVRM(options: VRMConversionOptions): Promise<ArrayBuffer> {
    log.info("💾 Exporting VRM GLB...");

    // DEBUG: Log bone transforms BEFORE export
    log.info("🔍 [DEBUG] Bone transforms BEFORE export:");
    this.logBoneTransforms("BEFORE_EXPORT");

    // CRITICAL FIX: Ensure GLTFExporter uses TRS instead of matrix
    // The exporter will use TRS if matrixAutoUpdate is true and we don't touch the matrix
    log.info("🔧 Preparing bones for TRS export (not matrix)...");
    this.bones.forEach((bone) => {
      // Enable matrixAutoUpdate so GLTFExporter knows to use TRS
      bone.matrixAutoUpdate = true;
    });

    log.info(
      "   ✅ All bones configured for TRS export (matrixAutoUpdate enabled)",
    );

    const exporter = new GLTFExporter();

    // Export as binary GLB FIRST - this gives us consistent JSON + BIN chunks
    log.info("📦 Exporting as binary GLB...");
    const glbBinary: ArrayBuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        this.scene,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
          } else {
            reject(
              new Error(
                "Binary export failed - got JSON instead of ArrayBuffer",
              ),
            );
          }
        },
        (error) => {
          reject(error);
        },
        {
          binary: true,
          includeCustomExtensions: true,
        },
      );
    });

    log.info(
      `   Original GLB size: ${(glbBinary.byteLength / 1024).toFixed(2)} KB`,
    );

    // Parse the binary GLB to extract JSON and BIN chunks
    const { json, bin: binChunkData } = parseGLB(glbBinary);
    const gltfJson = json as GLTFJson;

    log.info("📝 Parsed glTF JSON from GLB");
    log.info(
      `   Nodes: ${gltfJson.nodes?.length || 0}, Meshes: ${gltfJson.meshes?.length || 0}`,
    );
    if (binChunkData) {
      log.info(
        `   BIN chunk size: ${(binChunkData.length / 1024).toFixed(2)} KB`,
      );
    }

    // Convert matrix to TRS in nodes (GLTFExporter sometimes uses matrix for skinned nodes)
    log.info("🔧 Post-processing: converting matrix to TRS...");
    let matrixCount = 0;
    let convertedCount = 0;

    if (gltfJson.nodes) {
      gltfJson.nodes.forEach((node) => {
        if (node.matrix) {
          matrixCount++;

          // Decompose 4x4 matrix into TRS
          const mat = new THREE.Matrix4();
          mat.fromArray(node.matrix);

          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          mat.decompose(position, quaternion, scale);

          // Set TRS properties
          node.translation = [position.x, position.y, position.z];
          node.rotation = [
            quaternion.x,
            quaternion.y,
            quaternion.z,
            quaternion.w,
          ];
          node.scale = [scale.x, scale.y, scale.z];

          // Remove matrix property
          delete node.matrix;
          convertedCount++;
        }
      });
    }

    log.info(
      `   Converted ${convertedCount}/${matrixCount} nodes from matrix to TRS`,
    );

    // Build node name to index map
    const nodeNameToIndex = new Map<string, number>();
    if (gltfJson.nodes) {
      gltfJson.nodes.forEach((node, index) => {
        if (node.name) {
          nodeNameToIndex.set(node.name, index);
        }
      });
    }

    log.info(`   Found ${nodeNameToIndex.size} named nodes`);

    // Build humanoid bone mappings using node indices from THIS export
    const humanBones: Record<string, { node: number }> = {};

    for (const [meshyBoneName, vrmBoneName] of this.boneMappings.entries()) {
      const nodeIndex = nodeNameToIndex.get(meshyBoneName);
      if (nodeIndex !== undefined) {
        humanBones[vrmBoneName] = { node: nodeIndex };
        log.info(
          `   Mapped ${vrmBoneName} → node ${nodeIndex} (${meshyBoneName})`,
        );
      } else {
        log.warn(`   ⚠️  Could not find node index for bone: ${meshyBoneName}`);
      }
    }

    // Create VRM 1.0 extension
    const vrmExtension = {
      specVersion: "1.0",
      humanoid: {
        humanBones,
      },
      meta: {
        name: options.avatarName || "Converted Avatar",
        version: options.version || "1.0",
        authors: [options.author || "Hyperscape"],
        copyrightInformation: "Converted from Meshy GLB",
        licenseUrl: options.licenseUrl || "https://vrm.dev/licenses/1.0/",
        avatarPermission: options.commercialUsage || "personalNonProfit",
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: options.commercialUsage || "personalNonProfit",
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: "required",
        allowRedistribution: false,
        modification: "prohibited",
      },
    };

    // Add VRM extensions to the glTF JSON
    gltfJson.extensionsUsed = gltfJson.extensionsUsed || [];
    if (!gltfJson.extensionsUsed.includes("VRMC_vrm")) {
      gltfJson.extensionsUsed.push("VRMC_vrm");
    }

    gltfJson.extensions = gltfJson.extensions || {};
    gltfJson.extensions.VRMC_vrm = vrmExtension;

    log.info(
      `   Added VRMC_vrm extension with ${Object.keys(humanBones).length} humanoid bones`,
    );

    // Log materials and textures for debugging
    const materialCount = gltfJson.materials?.length || 0;
    const textureCount = gltfJson.textures?.length || 0;
    const imageCount = gltfJson.images?.length || 0;
    log.info(
      `   Materials: ${materialCount}, Textures: ${textureCount}, Images: ${imageCount}`,
    );

    // Validate buffer reference matches BIN chunk
    if (gltfJson.buffers && gltfJson.buffers.length > 0 && binChunkData) {
      const declaredBufferLength = gltfJson.buffers[0].byteLength;
      const actualBinLength = binChunkData.length;
      log.info(
        `   Buffer validation: declared=${declaredBufferLength}, actual=${actualBinLength}`,
      );
      if (declaredBufferLength !== actualBinLength) {
        log.warn(
          `   ⚠️  Buffer length mismatch! Updating JSON to match BIN chunk.`,
        );
        gltfJson.buffers[0].byteLength = actualBinLength;
      }
    }

    // Rebuild GLB with modified JSON and SAME BIN chunk
    const glb = buildGLB(
      gltfJson as unknown as Record<string, unknown>,
      binChunkData,
    );

    log.info(`✅ VRM GLB created: ${(glb.byteLength / 1024).toFixed(2)} KB`);

    return glb;
  }

  /**
   * DEBUG: Log bone transforms for debugging
   */
  private logBoneTransforms(stage: string): void {
    // Update world matrices to ensure accurate readings
    this.scene.updateMatrixWorld(true);

    // Log key bones only (Hips, Spine, arms)
    const keyBones = [
      "Hips",
      "Spine",
      "LeftArm",
      "RightArm",
      "LeftUpLeg",
      "RightUpLeg",
    ];

    for (const boneName of keyBones) {
      const bone = this.findBoneByName(boneName);
      if (bone) {
        // Get local transforms
        const localPos = bone.position;
        const localRot = bone.quaternion;
        const localScale = bone.scale;

        // Get world transforms
        const worldPos = new THREE.Vector3();
        const worldRot = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        bone.getWorldPosition(worldPos);
        bone.getWorldQuaternion(worldRot);
        bone.getWorldScale(worldScale);

        log.info(`   ${boneName} [${stage}]:`);
        log.info(
          `     Local Position: [${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)}]`,
        );
        log.info(
          `     Local Rotation: [${localRot.x.toFixed(3)}, ${localRot.y.toFixed(3)}, ${localRot.z.toFixed(3)}, ${localRot.w.toFixed(3)}]`,
        );
        log.info(
          `     Local Scale: [${localScale.x.toFixed(3)}, ${localScale.y.toFixed(3)}, ${localScale.z.toFixed(3)}]`,
        );
        log.info(
          `     World Position: [${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)}]`,
        );
        log.info(
          `     World Rotation: [${worldRot.x.toFixed(3)}, ${worldRot.y.toFixed(3)}, ${worldRot.z.toFixed(3)}, ${worldRot.w.toFixed(3)}]`,
        );

        // Check parent transform
        if (bone.parent) {
          const parentWorldRot = new THREE.Quaternion();
          bone.parent.getWorldQuaternion(parentWorldRot);
          log.info(
            `     Parent World Rotation: [${parentWorldRot.x.toFixed(3)}, ${parentWorldRot.y.toFixed(3)}, ${parentWorldRot.z.toFixed(3)}, ${parentWorldRot.w.toFixed(3)}]`,
          );
        }
      }
    }

    // Calculate and log height metrics
    const hipsBone = this.findBoneByName("Hips");
    const headBone = this.findBoneByName("Head");
    if (hipsBone && headBone) {
      const hipsPos = new THREE.Vector3();
      const headPos = new THREE.Vector3();
      hipsBone.getWorldPosition(hipsPos);
      headBone.getWorldPosition(headPos);

      const height = hipsPos.distanceTo(headPos);
      const rootToHips = hipsPos.y;

      log.info(`   Height Metrics [${stage}]:`);
      log.info(`     Hips world Y: ${hipsPos.y.toFixed(3)}`);
      log.info(`     Head world Y: ${headPos.y.toFixed(3)}`);
      log.info(`     Height (hips to head): ${height.toFixed(3)}`);
      log.info(`     rootToHips: ${rootToHips.toFixed(3)}`);
    }
  }

  /**
   * DEBUG: Log scene hierarchy to understand parent transforms
   */
  private logSceneHierarchy(obj: THREE.Object3D, depth: number = 0): void {
    const indent = "  ".repeat(depth);
    const pos = obj.position;
    const rot = obj.quaternion;
    const scale = obj.scale;

    log.info(`${indent}${obj.type} "${obj.name}"`);
    if (
      pos.length() > 0.001 ||
      rot.x !== 0 ||
      rot.y !== 0 ||
      rot.z !== 0 ||
      rot.w !== 1 ||
      scale.x !== 1 ||
      scale.y !== 1 ||
      scale.z !== 1
    ) {
      log.info(
        `${indent}  pos: [${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}]`,
      );
      log.info(
        `${indent}  rot: [${rot.x.toFixed(3)}, ${rot.y.toFixed(3)}, ${rot.z.toFixed(3)}, ${rot.w.toFixed(3)}]`,
      );
      log.info(
        `${indent}  scale: [${scale.x.toFixed(3)}, ${scale.y.toFixed(3)}, ${scale.z.toFixed(3)}]`,
      );
    }

    // Only traverse first level to avoid too much output
    if (depth < 3) {
      obj.children.forEach((child) => this.logSceneHierarchy(child, depth + 1));
    }
  }

  /**
   * Find bone by name (case-insensitive with variations)
   */
  private findBoneByName(name: string): THREE.Bone | undefined {
    // Try exact match
    let bone = this.bones.find((b) => b.name === name);
    if (bone) return bone;

    // Try case-insensitive
    bone = this.bones.find((b) => b.name.toLowerCase() === name.toLowerCase());
    if (bone) return bone;

    // Try variations
    const variations = MESHY_VARIATIONS[name] || [];
    for (const variation of variations) {
      bone = this.bones.find((b) => b.name === variation);
      if (bone) return bone;
    }

    return undefined;
  }
}

/**
 * Convenience function to convert GLB to VRM
 */
export async function convertGLBToVRM(
  glbScene: THREE.Group | THREE.Scene,
  options: VRMConversionOptions = {},
): Promise<VRMConversionResult> {
  const converter = new VRMConverter();
  return converter.convert(glbScene, options);
}

/**
 * Convert GLB binary to VRM directly WITHOUT re-exporting through Three.js
 * This preserves textures by keeping the original BIN chunk intact
 *
 * IMPORTANT: This doesn't do scale normalization or T-pose fixing,
 * but it PRESERVES TEXTURES which are lost in the Three.js pipeline.
 */
export async function convertGLBToVRMPreservingTextures(
  glbData: ArrayBuffer,
  options: VRMConversionOptions = {},
): Promise<VRMConversionResult> {
  log.info("🎭 Starting texture-preserving VRM conversion...");

  const warnings: string[] = [];
  const boneMappings = new Map<string, string>();

  // Parse the GLB binary
  const { json, bin: binChunkData } = parseGLB(glbData);
  const gltfJson = json as GLTFJson;

  log.info(`   GLB size: ${(glbData.byteLength / 1024).toFixed(2)} KB`);
  log.info(`   Nodes: ${gltfJson.nodes?.length || 0}`);
  log.info(`   Materials: ${gltfJson.materials?.length || 0}`);
  log.info(`   Textures: ${gltfJson.textures?.length || 0}`);
  log.info(`   Images: ${gltfJson.images?.length || 0}`);
  if (binChunkData) {
    log.info(
      `   BIN chunk size: ${(binChunkData.length / 1024).toFixed(2)} KB`,
    );
  }

  // Build node name to index map for bone mapping
  const nodeNameToIndex = new Map<string, number>();
  if (gltfJson.nodes) {
    gltfJson.nodes.forEach((node, index) => {
      if (node.name) {
        nodeNameToIndex.set(node.name, index);
      }
    });
  }

  // Map Meshy bones to VRM humanoid bones
  const humanBones: Record<string, { node: number }> = {};

  // VRM bone name → canonical Meshy bone name mapping
  // We'll look up each VRM bone by trying all Meshy variations
  const vrmToMeshyCanonical: Record<string, string> = {
    hips: "Hips",
    spine: "Spine",
    chest: "Spine01",
    upperChest: "Spine02",
    neck: "Neck",
    head: "Head",
    leftShoulder: "LeftShoulder",
    leftUpperArm: "LeftArm",
    leftLowerArm: "LeftForeArm",
    leftHand: "LeftHand",
    rightShoulder: "RightShoulder",
    rightUpperArm: "RightArm",
    rightLowerArm: "RightForeArm",
    rightHand: "RightHand",
    leftUpperLeg: "LeftUpLeg",
    leftLowerLeg: "LeftLeg",
    leftFoot: "LeftFoot",
    leftToes: "LeftToeBase",
    rightUpperLeg: "RightUpLeg",
    rightLowerLeg: "RightLeg",
    rightFoot: "RightFoot",
    rightToes: "RightToeBase",
  };

  // Helper to find node index by trying all variations of a canonical Meshy bone name
  const findNodeByMeshyBone = (
    canonicalName: string,
  ): { nodeIndex: number; actualName: string } | null => {
    // Get all variations for this canonical name
    const variations = MESHY_VARIATIONS[canonicalName] || [canonicalName];

    for (const variation of variations) {
      const nodeIndex = nodeNameToIndex.get(variation);
      if (nodeIndex !== undefined) {
        return { nodeIndex, actualName: variation };
      }
    }

    // Also try mixamorig prefix variations
    const mixamoPrefixes = ["mixamorig:", "mixamorig"];
    for (const prefix of mixamoPrefixes) {
      for (const variation of variations) {
        const prefixedName = prefix + variation;
        const nodeIndex = nodeNameToIndex.get(prefixedName);
        if (nodeIndex !== undefined) {
          return { nodeIndex, actualName: prefixedName };
        }
      }
    }

    return null;
  };

  // Also try reverse lookup: iterate all nodes and see if any match known bone patterns
  const nodeNames = Array.from(nodeNameToIndex.keys());
  log.info(`   Checking ${nodeNames.length} nodes for bone matches...`);

  for (const [vrmBone, meshyCanonical] of Object.entries(vrmToMeshyCanonical)) {
    // Skip if already mapped
    if (humanBones[vrmBone]) continue;

    const result = findNodeByMeshyBone(meshyCanonical);
    if (result) {
      humanBones[vrmBone] = { node: result.nodeIndex };
      boneMappings.set(result.actualName, vrmBone);
      log.info(
        `   Mapped ${vrmBone} → node ${result.nodeIndex} (${result.actualName})`,
      );
    } else {
      // Try to find by checking if any node matches the canonical name via findMeshyBoneName
      for (const nodeName of nodeNames) {
        const canonical = findMeshyBoneName(nodeName);
        if (canonical === meshyCanonical) {
          const nodeIndex = nodeNameToIndex.get(nodeName)!;
          humanBones[vrmBone] = { node: nodeIndex };
          boneMappings.set(nodeName, vrmBone);
          log.info(
            `   Mapped ${vrmBone} → node ${nodeIndex} (${nodeName} via findMeshyBoneName)`,
          );
          break;
        }
      }
    }
  }

  log.info(`   Total bones mapped: ${Object.keys(humanBones).length}`);

  // Check for required bones
  const requiredBones = ["hips", "spine", "head"];
  for (const required of requiredBones) {
    if (!humanBones[required]) {
      warnings.push(`Missing required bone: ${required}`);
    }
  }

  // Add VRM 1.0 extension to JSON
  const vrmExtension = {
    specVersion: "1.0",
    humanoid: {
      humanBones,
    },
    meta: {
      name: options.avatarName || "Converted Avatar",
      version: options.version || "1.0",
      authors: [options.author || "HyperForge"],
      copyrightInformation: "Converted from GLB - textures preserved",
      licenseUrl: options.licenseUrl || "https://vrm.dev/licenses/1.0/",
      avatarPermission: "onlyAuthor",
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      commercialUsage: options.commercialUsage || "personalNonProfit",
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      creditNotation: "required",
      allowRedistribution: false,
      modification: "prohibited",
    },
  };

  // Add extension to glTF
  gltfJson.extensionsUsed = gltfJson.extensionsUsed || [];
  if (!gltfJson.extensionsUsed.includes("VRMC_vrm")) {
    gltfJson.extensionsUsed.push("VRMC_vrm");
  }
  gltfJson.extensions = gltfJson.extensions || {};
  gltfJson.extensions.VRMC_vrm = vrmExtension;

  // Rebuild GLB with modified JSON and ORIGINAL BIN chunk (preserves textures!)
  const vrmGlb = buildGLB(
    gltfJson as unknown as Record<string, unknown>,
    binChunkData,
  );

  log.info(
    `✅ VRM GLB created: ${(vrmGlb.byteLength / 1024).toFixed(2)} KB (textures preserved!)`,
  );

  return {
    vrmData: vrmGlb,
    boneMappings,
    warnings,
    coordinateSystemFixed: false, // We don't modify transforms in this path
  };
}
