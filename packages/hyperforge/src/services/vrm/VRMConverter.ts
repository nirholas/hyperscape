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
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { MESHY_VARIATIONS } from "./BoneMappings";

/**
 * VRM HumanoidBone names (VRM 1.0 standard)
 * These are the standardized bone names used by VRM format
 */
const VRM_HUMANOID_BONES = {
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
    console.log("🎭 Starting VRM conversion...");

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

    console.log("✅ VRM conversion complete!");
    console.log(`   Bones mapped: ${this.boneMappings.size}`);
    console.log(`   Warnings: ${this.warnings.length}`);
    console.log(
      `   VRM file size: ${(vrmData.byteLength / 1024 / 1024).toFixed(2)} MB`,
    );

    // Debug: Log bone mappings
    console.log("   Bone mappings:");
    for (const [meshyBone, vrmBone] of this.boneMappings.entries()) {
      console.log(`     ${meshyBone} → ${vrmBone}`);
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
    console.log("🦴 Extracting skeleton...");

    // Find first SkinnedMesh
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh && !this.skinnedMesh) {
        this.skinnedMesh = obj;
        if (obj.skeleton) {
          this.bones = obj.skeleton.bones;
          console.log(`   Found skeleton with ${this.bones.length} bones`);
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
    console.log("🔍 [DEBUG] Initial bone transforms after extraction:");
    this.logBoneTransforms("AFTER_EXTRACTION");

    // DEBUG: Log scene hierarchy
    console.log("🔍 [DEBUG] Scene hierarchy:");
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
    console.log("📏 Normalizing scale...");

    // Find hips and head bones to measure height
    const hipsBone = this.findBoneByName("Hips");
    const headBone = this.findBoneByName("Head");

    if (!hipsBone || !headBone) {
      console.log(
        "   ⚠️  Could not find hips/head bones for scale normalization",
      );
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

    if (armature && armature.parent) {
      const armatureScale = armature.scale.x; // Assume uniform scale
      console.log(`   Found Armature with scale: ${armatureScale.toFixed(3)}`);

      if (Math.abs(armatureScale - 1.0) > 0.001) {
        // Calculate compensation factor: if armature is 0.01, we need to scale up by 100
        const compensationScale = 1.0 / armatureScale;
        console.log(
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
        console.log(
          `   ✅ Scaled ${meshCount} mesh geometries by ${compensationScale.toFixed(1)}x`,
        );

        // Scale bone local positions to keep world positions the same after parent scale removal
        this.bones.forEach((bone) => {
          bone.position.multiplyScalar(compensationScale);
        });
        console.log(
          `   ✅ Scaled ${this.bones.length} bone positions by ${compensationScale.toFixed(1)}x`,
        );

        // Set Armature scale to 1.0 (removing the parent scale)
        armature.scale.set(1, 1, 1);

        // Update world matrices
        this.scene.updateMatrixWorld(true);

        // Recalculate skeleton inverse bind matrices for ALL skinned meshes
        this.scene.traverse((obj) => {
          if (obj instanceof THREE.SkinnedMesh && obj.skeleton) {
            obj.skeleton.calculateInverses();
          }
        });
        console.log("   ✅ Recalculated skeleton inverse bind matrices");

        console.log(`   ✅ Armature scale baked into geometry and skeleton`);
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
    console.log(
      `   Current height (hips to head): ${currentHeight.toFixed(3)} units`,
    );

    // Target height for VRM (1.6 meters is typical)
    const targetHeight = 1.6;
    const scaleFactor = targetHeight / currentHeight;

    // Only scale if significantly off (more than 10% difference)
    if (Math.abs(scaleFactor - 1.0) > 0.1) {
      console.log(
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
      console.log(
        `   ✅ Scaled ${meshCount} mesh geometries by ${scaleFactor.toFixed(3)}`,
      );

      // Scale bone local positions (all bones get scaled)
      this.bones.forEach((bone) => {
        bone.position.multiplyScalar(scaleFactor);
      });
      console.log(
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
      console.log(
        "   ✅ Recalculated inverse bind matrices after height scaling",
      );

      // DEBUG: Log bone transforms after scaling
      console.log("🔍 [DEBUG] Bone transforms after scaling:");
      this.logBoneTransforms("AFTER_SCALING");

      // Verify mesh and skeleton alignment
      this.verifyMeshSkeletonAlignment();
    } else {
      console.log("   ✅ Scale is already appropriate");
    }

    // VALIDATION: Verify final height is 1.6m
    this.scene.updateMatrixWorld(true);
    const finalHipsPos = new THREE.Vector3();
    const finalHeadPos = new THREE.Vector3();
    if (hipsBone) hipsBone.getWorldPosition(finalHipsPos);
    if (headBone) headBone.getWorldPosition(finalHeadPos);
    const finalHeight = finalHipsPos.distanceTo(finalHeadPos);

    console.log("📏 [VALIDATION] Final avatar height verification:");
    console.log(`   Hips to Head distance: ${finalHeight.toFixed(3)}m`);
    console.log(`   Target height: 1.600m`);
    console.log(`   Difference: ${Math.abs(finalHeight - 1.6).toFixed(3)}m`);

    if (Math.abs(finalHeight - 1.6) > 0.05) {
      console.warn(
        `   ⚠️  WARNING: Final height ${finalHeight.toFixed(3)}m deviates from target 1.6m!`,
      );
      this.warnings.push(
        `Final height ${finalHeight.toFixed(3)}m deviates from target 1.6m`,
      );
    } else {
      console.log("   ✅ Height normalization successful");
    }
  }

  /**
   * Verify that mesh and skeleton are properly aligned
   * by checking the bounding boxes match
   */
  private verifyMeshSkeletonAlignment(): void {
    console.log("🔍 Verifying mesh-skeleton alignment...");

    if (!this.skinnedMesh || !this.skinnedMesh.geometry) {
      console.warn("   ⚠️  Cannot verify - no skinned mesh");
      return;
    }

    // Get mesh bounding box
    this.skinnedMesh.geometry.computeBoundingBox();
    const meshBBox = this.skinnedMesh.geometry.boundingBox;
    if (!meshBBox) {
      console.warn("   ⚠️  Cannot compute mesh bounding box");
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

    console.log("   Mesh bounding box:");
    console.log(
      `     Min: [${meshBBox.min.x.toFixed(3)}, ${meshBBox.min.y.toFixed(3)}, ${meshBBox.min.z.toFixed(3)}]`,
    );
    console.log(
      `     Max: [${meshBBox.max.x.toFixed(3)}, ${meshBBox.max.y.toFixed(3)}, ${meshBBox.max.z.toFixed(3)}]`,
    );
    console.log(
      `     Size: [${meshSize.x.toFixed(3)}, ${meshSize.y.toFixed(3)}, ${meshSize.z.toFixed(3)}]`,
    );

    console.log("   Skeleton bounding box:");
    console.log(
      `     Min: [${skeletonMin.x.toFixed(3)}, ${skeletonMin.y.toFixed(3)}, ${skeletonMin.z.toFixed(3)}]`,
    );
    console.log(
      `     Max: [${skeletonMax.x.toFixed(3)}, ${skeletonMax.y.toFixed(3)}, ${skeletonMax.z.toFixed(3)}]`,
    );
    console.log(
      `     Size: [${skeletonSize.x.toFixed(3)}, ${skeletonSize.y.toFixed(3)}, ${skeletonSize.z.toFixed(3)}]`,
    );

    // Check if sizes are roughly similar (within 50% difference)
    const heightRatio = meshSize.y / skeletonSize.y;
    if (heightRatio < 0.5 || heightRatio > 2.0) {
      const warning = `Mesh-skeleton height mismatch! Mesh height: ${meshSize.y.toFixed(3)}, Skeleton height: ${skeletonSize.y.toFixed(3)}, Ratio: ${heightRatio.toFixed(2)}x`;
      console.warn(`   ⚠️  ${warning}`);
      this.warnings.push(warning);
    } else {
      console.log(
        `   ✅ Mesh and skeleton alignment OK (height ratio: ${heightRatio.toFixed(2)}x)`,
      );
    }
  }

  /**
   * Map Meshy bones to VRM HumanoidBone names
   */
  private mapBonesToVRM(): void {
    console.log("🗺️  Mapping bones to VRM HumanoidBone standard...");

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

    console.log(`   Mapped ${mappedCount}/${this.bones.length} bones`);

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
    console.log(
      "🤸 Preserving original bind pose (matches online VRM viewers)...",
    );

    // CRITICAL FIX: Ensure Hips bone has local translation
    // Hyperscape needs Hips.translation to be set for animation scaling
    this.ensureHipsTranslation();
  }

  /**
   * Validate T-pose and normalize if needed
   *
   * NOTE: We MUST normalize to T-pose because:
   * 1. Hyperscape's animation system requires T-pose bind pose
   * 2. The matrix vs TRS conflict causes issues if not T-pose
   * 3. This ensures compatibility with both Hyperscape AND online VRM viewers
   */
  private validateTPose(): void {
    console.log("🤸 Validating T-pose...");

    const hipsBone = this.findBoneByName("Hips");
    if (!hipsBone) {
      console.warn("   ⚠️  Cannot validate T-pose - Hips bone not found");
      return;
    }

    // Check if Hips has significant rotation (should be near identity for T-pose)
    const hipsRot = hipsBone.quaternion;
    const rotationMagnitude = Math.sqrt(
      hipsRot.x * hipsRot.x + hipsRot.y * hipsRot.y + hipsRot.z * hipsRot.z,
    );

    console.log(
      `   Hips rotation: [${hipsRot.x.toFixed(3)}, ${hipsRot.y.toFixed(3)}, ${hipsRot.z.toFixed(3)}, ${hipsRot.w.toFixed(3)}]`,
    );
    console.log(`   Rotation magnitude: ${rotationMagnitude.toFixed(3)}`);

    if (rotationMagnitude > 0.1) {
      console.log(`   ⚠️  Model not in T-pose - normalizing...`);
      this.normalizeBindPoseToTPose();
    } else {
      console.log("   ✅ Model appears to be in T-pose");
    }
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
    console.log("🔧 Normalizing bind pose from A-pose to T-pose...");

    const hipsBone = this.findBoneByName("Hips");
    if (!hipsBone) {
      console.error("   ❌ Cannot normalize - Hips bone not found");
      return;
    }

    // Store the original Hips rotation (to compensate children)
    const hipsOriginalRot = hipsBone.quaternion.clone();
    console.log(
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

          console.log(
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
    console.log("   ✅ Set Hips to identity and compensated all descendants");

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
      console.log(
        `   LeftShoulder original rotation: [${leftShoulderOriginalRot.x.toFixed(3)}, ${leftShoulderOriginalRot.y.toFixed(3)}, ${leftShoulderOriginalRot.z.toFixed(3)}, ${leftShoulderOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing shoulder rotation
      compensateDescendants(leftShoulderBone, leftShoulderOriginalRot);

      // Set shoulder to T-pose (identity)
      leftShoulderBone.quaternion.set(0, 0, 0, 1);
      console.log(
        "   ✅ Set LeftShoulder to T-pose and compensated descendants",
      );
    }

    if (leftArmBone) {
      const leftArmOriginalRot = leftArmBone.quaternion.clone();
      console.log(
        `   LeftArm original rotation: [${leftArmOriginalRot.x.toFixed(3)}, ${leftArmOriginalRot.y.toFixed(3)}, ${leftArmOriginalRot.z.toFixed(3)}, ${leftArmOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing arm rotation
      compensateDescendants(leftArmBone, leftArmOriginalRot);

      // Set arm to T-pose (identity - straight out)
      leftArmBone.quaternion.set(0, 0, 0, 1);
      console.log("   ✅ Set LeftArm to T-pose and compensated descendants");
    } else {
      console.warn(
        "   ⚠️  LeftArm bone not found - skipping arm normalization",
      );
    }

    // Fix right shoulder first, then arm
    if (rightShoulderBone) {
      const rightShoulderOriginalRot = rightShoulderBone.quaternion.clone();
      console.log(
        `   RightShoulder original rotation: [${rightShoulderOriginalRot.x.toFixed(3)}, ${rightShoulderOriginalRot.y.toFixed(3)}, ${rightShoulderOriginalRot.z.toFixed(3)}, ${rightShoulderOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing shoulder rotation
      compensateDescendants(rightShoulderBone, rightShoulderOriginalRot);

      // Set shoulder to T-pose (identity)
      rightShoulderBone.quaternion.set(0, 0, 0, 1);
      console.log(
        "   ✅ Set RightShoulder to T-pose and compensated descendants",
      );
    }

    if (rightArmBone) {
      const rightArmOriginalRot = rightArmBone.quaternion.clone();
      console.log(
        `   RightArm original rotation: [${rightArmOriginalRot.x.toFixed(3)}, ${rightArmOriginalRot.y.toFixed(3)}, ${rightArmOriginalRot.z.toFixed(3)}, ${rightArmOriginalRot.w.toFixed(3)}]`,
      );

      // Compensate children before changing arm rotation
      compensateDescendants(rightArmBone, rightArmOriginalRot);

      // Set arm to T-pose (identity - straight out)
      rightArmBone.quaternion.set(0, 0, 0, 1);
      console.log("   ✅ Set RightArm to T-pose and compensated descendants");
    } else {
      console.warn(
        "   ⚠️  RightArm bone not found - skipping arm normalization",
      );
    }

    // Update world matrices after all bone changes
    this.scene.updateMatrixWorld(true);

    // CRITICAL: Recalculate inverse bind matrices for the new T-pose bind pose
    // We changed the skeleton's bind pose from A-pose to T-pose, so we MUST recalculate
    console.log(
      "   🔧 Recalculating inverse bind matrices for new T-pose bind pose...",
    );
    if (this.skinnedMesh && this.skinnedMesh.skeleton) {
      this.skinnedMesh.skeleton.calculateInverses();
      console.log("   ✅ Inverse bind matrices recalculated");
    }

    // Verify T-pose
    const newHipsRot = hipsBone.quaternion;
    const newRotationMagnitude = Math.sqrt(
      newHipsRot.x * newHipsRot.x +
        newHipsRot.y * newHipsRot.y +
        newHipsRot.z * newHipsRot.z,
    );
    console.log(
      `   Final Hips rotation: [${newHipsRot.x.toFixed(3)}, ${newHipsRot.y.toFixed(3)}, ${newHipsRot.z.toFixed(3)}, ${newHipsRot.w.toFixed(3)}]`,
    );
    console.log(
      `   Final rotation magnitude: ${newRotationMagnitude.toFixed(3)}`,
    );

    if (newRotationMagnitude < 0.001) {
      console.log("   ✅ Successfully normalized to T-pose");
    } else {
      console.warn("   ⚠️  T-pose normalization may be incomplete");
    }

    // Update world matrices one more time
    this.scene.updateMatrixWorld(true);

    // Debug: Log bone transforms after T-pose normalization
    console.log("🔍 [DEBUG] Bone transforms after T-pose normalization:");
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
    console.log("📏 Ensuring Hips bone has local translation...");

    const hipsBone = this.findBoneByName("Hips");
    if (!hipsBone) {
      console.warn(
        "   ⚠️  Cannot ensure Hips translation - Hips bone not found",
      );
      return;
    }

    // Get current world and local positions
    const worldPos = new THREE.Vector3();
    hipsBone.getWorldPosition(worldPos);
    const localPos = hipsBone.position;

    console.log(
      `   Current Hips local position: [${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)}]`,
    );
    console.log(
      `   Current Hips world position: [${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)}]`,
    );

    // Check if parent is Armature or similar container (not a Bone)
    const parent = hipsBone.parent;
    if (parent && parent.type !== "Bone") {
      console.log(
        `   Parent is ${parent.type} (${parent.name}) - need to bake transform`,
      );

      // ALWAYS bake world position into Hips local position when parent is not a bone
      // This ensures Hips.translation is set in the exported glTF
      console.log("   🔧 Baking Hips world position into local position...");

      // Set Hips local position to its current world position
      hipsBone.position.copy(worldPos);

      // Zero out parent's transform to make it transparent
      parent.position.set(0, 0, 0);
      parent.rotation.set(0, 0, 0);
      parent.scale.set(1, 1, 1);
      parent.updateMatrix();
      parent.updateMatrixWorld(true);

      console.log(
        `   ✅ Baked world position into Hips local: [${hipsBone.position.x.toFixed(3)}, ${hipsBone.position.y.toFixed(3)}, ${hipsBone.position.z.toFixed(3)}]`,
      );

      // Update world matrices
      this.scene.updateMatrixWorld(true);

      // Recalculate inverse bind matrices since we changed bone positions
      if (this.skinnedMesh.skeleton) {
        this.skinnedMesh.skeleton.calculateInverses();
        console.log("   ✅ Recalculated inverse bind matrices");
      }
    } else {
      console.log(
        "   ✅ Hips parent is a Bone - local position already correct",
      );
    }
  }

  /**
   * REMOVED: We don't normalize to T-pose anymore
   * Meshy models come in a good rest pose already
   * Manipulating bone rotations causes deformation issues
   */
  private normalizeToPose_DISABLED(): void {
    console.log("🤸 Skipping T-pose normalization (using Meshy rest pose)...");

    // We don't modify bone rotations anymore
    // The Meshy models should work fine with their default pose

    // Find arm bones just for logging
    const leftUpperArm = this.findBoneByName("LeftArm");
    const rightUpperArm = this.findBoneByName("RightArm");

    if (leftUpperArm && rightUpperArm) {
      console.log("   ✅ Using original Meshy rest pose");
    }
  }

  /**
   * LEGACY: Old T-pose normalization that caused deformation
   */
  private normalizeToPose_OLD_BROKEN(): void {
    console.log("🤸 Normalizing to T-pose...");

    // Find arm bones
    const leftUpperArm = this.findBoneByName("LeftArm");
    const rightUpperArm = this.findBoneByName("RightArm");

    if (leftUpperArm) {
      // Rotate left arm down to T-pose (75° around Z axis)
      leftUpperArm.rotation.z = (75 * Math.PI) / 180;
      console.log("   Adjusted left arm to T-pose");
    }

    if (rightUpperArm) {
      // Rotate right arm down to T-pose (-75° around Z axis)
      rightUpperArm.rotation.z = (-75 * Math.PI) / 180;
      console.log("   Adjusted right arm to T-pose");
    }

    // Update skeleton
    if (this.skinnedMesh.skeleton) {
      this.skinnedMesh.skeleton.update();
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
    console.log("💾 Exporting VRM GLB...");

    // DEBUG: Log bone transforms BEFORE export
    console.log("🔍 [DEBUG] Bone transforms BEFORE export:");
    this.logBoneTransforms("BEFORE_EXPORT");

    // CRITICAL FIX: Ensure GLTFExporter uses TRS instead of matrix
    // The exporter will use TRS if matrixAutoUpdate is true and we don't touch the matrix
    console.log("🔧 Preparing bones for TRS export (not matrix)...");
    this.bones.forEach((bone) => {
      // Enable matrixAutoUpdate so GLTFExporter knows to use TRS
      bone.matrixAutoUpdate = true;
    });

    console.log(
      "   ✅ All bones configured for TRS export (matrixAutoUpdate enabled)",
    );

    const exporter = new GLTFExporter();

    // Export as binary GLB FIRST - this gives us consistent JSON + BIN chunks
    console.log("📦 Exporting as binary GLB...");
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

    console.log(
      `   Original GLB size: ${(glbBinary.byteLength / 1024).toFixed(2)} KB`,
    );

    // Parse the binary GLB to extract JSON and BIN chunks
    const glbView = new DataView(glbBinary);

    // Validate GLB header
    const magic = glbView.getUint32(0, true);
    if (magic !== 0x46546c67) {
      throw new Error("Invalid GLB: wrong magic number");
    }

    const version = glbView.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`Invalid GLB: unsupported version ${version}`);
    }

    // Parse JSON chunk
    const jsonChunkLength = glbView.getUint32(12, true);
    const jsonChunkType = glbView.getUint32(16, true);
    if (jsonChunkType !== 0x4e4f534a) {
      // "JSON"
      throw new Error("Invalid GLB: first chunk is not JSON");
    }

    // CRITICAL: Copy the JSON bytes, don't just create a view
    const jsonBytesView = new Uint8Array(glbBinary, 20, jsonChunkLength);
    const jsonBytes = new Uint8Array(jsonChunkLength);
    jsonBytes.set(jsonBytesView);

    const jsonString = new TextDecoder().decode(jsonBytes);
    const gltfJson = JSON.parse(jsonString);

    console.log("📝 Parsed glTF JSON from GLB");
    console.log(
      `   Nodes: ${gltfJson.nodes?.length || 0}, Meshes: ${gltfJson.meshes?.length || 0}`,
    );

    // Extract BIN chunk if present - COPY the data, don't just create a view
    const binChunkOffset = 12 + 8 + jsonChunkLength;
    let binChunkData: Uint8Array | null = null;

    if (binChunkOffset < glbBinary.byteLength) {
      const binChunkLength = glbView.getUint32(binChunkOffset, true);
      const binChunkType = glbView.getUint32(binChunkOffset + 4, true);

      if (binChunkType === 0x004e4942) {
        // "BIN\0"
        // CRITICAL: Copy the data, don't just create a view
        // A view would become invalid after async operations
        const binView = new Uint8Array(
          glbBinary,
          binChunkOffset + 8,
          binChunkLength,
        );
        binChunkData = new Uint8Array(binChunkLength);
        binChunkData.set(binView);
        console.log(
          `   BIN chunk size: ${(binChunkLength / 1024).toFixed(2)} KB`,
        );
      }
    }

    // Convert matrix to TRS in nodes (GLTFExporter sometimes uses matrix for skinned nodes)
    console.log("🔧 Post-processing: converting matrix to TRS...");
    let matrixCount = 0;
    let convertedCount = 0;

    if (gltfJson.nodes) {
      gltfJson.nodes.forEach(
        (node: {
          name?: string;
          matrix?: number[];
          translation?: number[];
          rotation?: number[];
          scale?: number[];
        }) => {
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
        },
      );
    }

    console.log(
      `   Converted ${convertedCount}/${matrixCount} nodes from matrix to TRS`,
    );

    // Build node name to index map
    const nodeNameToIndex = new Map<string, number>();
    if (gltfJson.nodes) {
      gltfJson.nodes.forEach((node: { name?: string }, index: number) => {
        if (node.name) {
          nodeNameToIndex.set(node.name, index);
        }
      });
    }

    console.log(`   Found ${nodeNameToIndex.size} named nodes`);

    // Build humanoid bone mappings using node indices from THIS export
    const humanBones: Record<string, { node: number }> = {};

    for (const [meshyBoneName, vrmBoneName] of this.boneMappings.entries()) {
      const nodeIndex = nodeNameToIndex.get(meshyBoneName);
      if (nodeIndex !== undefined) {
        humanBones[vrmBoneName] = { node: nodeIndex };
        console.log(
          `   Mapped ${vrmBoneName} → node ${nodeIndex} (${meshyBoneName})`,
        );
      } else {
        console.warn(
          `   ⚠️  Could not find node index for bone: ${meshyBoneName}`,
        );
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

    console.log(
      `   Added VRMC_vrm extension with ${Object.keys(humanBones).length} humanoid bones`,
    );

    // Log materials and textures for debugging
    const materialCount = gltfJson.materials?.length || 0;
    const textureCount = gltfJson.textures?.length || 0;
    const imageCount = gltfJson.images?.length || 0;
    console.log(
      `   Materials: ${materialCount}, Textures: ${textureCount}, Images: ${imageCount}`,
    );

    // Validate buffer reference matches BIN chunk
    if (gltfJson.buffers && gltfJson.buffers.length > 0 && binChunkData) {
      const declaredBufferLength = gltfJson.buffers[0].byteLength;
      const actualBinLength = binChunkData.length;
      console.log(
        `   Buffer validation: declared=${declaredBufferLength}, actual=${actualBinLength}`,
      );
      if (declaredBufferLength !== actualBinLength) {
        console.warn(
          `   ⚠️  Buffer length mismatch! Updating JSON to match BIN chunk.`,
        );
        gltfJson.buffers[0].byteLength = actualBinLength;
      }
    }

    // Rebuild GLB with modified JSON and SAME BIN chunk
    const newJsonString = JSON.stringify(gltfJson);
    const newJsonBuffer = new TextEncoder().encode(newJsonString);
    const newJsonChunkLength = Math.ceil(newJsonBuffer.length / 4) * 4; // 4-byte aligned
    const jsonPadding = newJsonChunkLength - newJsonBuffer.length;

    const binChunkLength = binChunkData
      ? Math.ceil(binChunkData.length / 4) * 4
      : 0;
    const binPadding = binChunkData ? binChunkLength - binChunkData.length : 0;
    const totalLength =
      12 + 8 + newJsonChunkLength + (binChunkData ? 8 + binChunkLength : 0);

    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);

    // GLB Header
    view.setUint32(0, 0x46546c67, true); // magic: "glTF"
    view.setUint32(4, 2, true); // version: 2
    view.setUint32(8, totalLength, true); // length

    // JSON chunk header
    view.setUint32(12, newJsonChunkLength, true); // chunkLength
    view.setUint32(16, 0x4e4f534a, true); // chunkType: "JSON"

    // JSON chunk data
    const jsonChunkDataOut = new Uint8Array(glb, 20, newJsonChunkLength);
    jsonChunkDataOut.set(newJsonBuffer);
    for (let i = 0; i < jsonPadding; i++) {
      jsonChunkDataOut[newJsonBuffer.length + i] = 0x20; // Pad with spaces
    }

    // BIN chunk (if exists)
    if (binChunkData) {
      const binChunkHeaderOffset = 20 + newJsonChunkLength;
      view.setUint32(binChunkHeaderOffset, binChunkLength, true); // chunkLength
      view.setUint32(binChunkHeaderOffset + 4, 0x004e4942, true); // chunkType: "BIN\0"

      const binChunkDataOut = new Uint8Array(
        glb,
        binChunkHeaderOffset + 8,
        binChunkLength,
      );
      binChunkDataOut.set(binChunkData);
      for (let i = 0; i < binPadding; i++) {
        binChunkDataOut[binChunkData.length + i] = 0x00; // Pad with zeros
      }
    }

    console.log(`✅ VRM GLB created: ${(totalLength / 1024).toFixed(2)} KB`);

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

        console.log(`   ${boneName} [${stage}]:`);
        console.log(
          `     Local Position: [${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)}]`,
        );
        console.log(
          `     Local Rotation: [${localRot.x.toFixed(3)}, ${localRot.y.toFixed(3)}, ${localRot.z.toFixed(3)}, ${localRot.w.toFixed(3)}]`,
        );
        console.log(
          `     Local Scale: [${localScale.x.toFixed(3)}, ${localScale.y.toFixed(3)}, ${localScale.z.toFixed(3)}]`,
        );
        console.log(
          `     World Position: [${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)}]`,
        );
        console.log(
          `     World Rotation: [${worldRot.x.toFixed(3)}, ${worldRot.y.toFixed(3)}, ${worldRot.z.toFixed(3)}, ${worldRot.w.toFixed(3)}]`,
        );

        // Check parent transform
        if (bone.parent) {
          const parentWorldRot = new THREE.Quaternion();
          bone.parent.getWorldQuaternion(parentWorldRot);
          console.log(
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

      console.log(`   Height Metrics [${stage}]:`);
      console.log(`     Hips world Y: ${hipsPos.y.toFixed(3)}`);
      console.log(`     Head world Y: ${headPos.y.toFixed(3)}`);
      console.log(`     Height (hips to head): ${height.toFixed(3)}`);
      console.log(`     rootToHips: ${rootToHips.toFixed(3)}`);
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

    console.log(`${indent}${obj.type} "${obj.name}"`);
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
      console.log(
        `${indent}  pos: [${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}]`,
      );
      console.log(
        `${indent}  rot: [${rot.x.toFixed(3)}, ${rot.y.toFixed(3)}, ${rot.z.toFixed(3)}, ${rot.w.toFixed(3)}]`,
      );
      console.log(
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
  console.log("🎭 Starting texture-preserving VRM conversion...");

  const warnings: string[] = [];
  const boneMappings = new Map<string, string>();

  // Parse the GLB binary
  const glbView = new DataView(glbData);

  // Validate GLB header
  const magic = glbView.getUint32(0, true);
  if (magic !== 0x46546c67) {
    throw new Error("Invalid GLB: wrong magic number");
  }

  const version = glbView.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Invalid GLB: unsupported version ${version}`);
  }

  const totalLength = glbView.getUint32(8, true);
  console.log(`   GLB size: ${(totalLength / 1024).toFixed(2)} KB`);

  // Parse JSON chunk
  const jsonChunkLength = glbView.getUint32(12, true);
  const jsonChunkType = glbView.getUint32(16, true);
  if (jsonChunkType !== 0x4e4f534a) {
    throw new Error("Invalid GLB: first chunk is not JSON");
  }

  const jsonBytes = new Uint8Array(glbData, 20, jsonChunkLength);
  const jsonString = new TextDecoder().decode(jsonBytes);
  const gltfJson = JSON.parse(jsonString);

  console.log(`   Nodes: ${gltfJson.nodes?.length || 0}`);
  console.log(`   Materials: ${gltfJson.materials?.length || 0}`);
  console.log(`   Textures: ${gltfJson.textures?.length || 0}`);
  console.log(`   Images: ${gltfJson.images?.length || 0}`);

  // Extract BIN chunk
  const binChunkOffset = 12 + 8 + jsonChunkLength;
  let binChunkData: Uint8Array | null = null;

  if (binChunkOffset < glbData.byteLength) {
    const binChunkLength = glbView.getUint32(binChunkOffset, true);
    const binChunkType = glbView.getUint32(binChunkOffset + 4, true);

    if (binChunkType === 0x004e4942) {
      // "BIN\0"
      binChunkData = new Uint8Array(
        glbData,
        binChunkOffset + 8,
        binChunkLength,
      );
      console.log(
        `   BIN chunk size: ${(binChunkLength / 1024).toFixed(2)} KB`,
      );
    }
  }

  // Build node name to index map for bone mapping
  const nodeNameToIndex = new Map<string, number>();
  if (gltfJson.nodes) {
    gltfJson.nodes.forEach((node: { name?: string }, index: number) => {
      if (node.name) {
        nodeNameToIndex.set(node.name, index);
      }
    });
  }

  // Map Meshy bones to VRM humanoid bones
  const humanBones: Record<string, { node: number }> = {};

  // Meshy bone names → VRM bone names
  const meshyToVrmMap: Record<string, string> = {
    Hips: "hips",
    Spine: "spine",
    Spine01: "chest",
    Spine02: "upperChest",
    neck: "neck",
    Neck: "neck",
    Head: "head",
    LeftShoulder: "leftShoulder",
    LeftArm: "leftUpperArm",
    LeftForeArm: "leftLowerArm",
    LeftHand: "leftHand",
    RightShoulder: "rightShoulder",
    RightArm: "rightUpperArm",
    RightForeArm: "rightLowerArm",
    RightHand: "rightHand",
    LeftUpLeg: "leftUpperLeg",
    LeftLeg: "leftLowerLeg",
    LeftFoot: "leftFoot",
    LeftToe: "leftToes",
    RightUpLeg: "rightUpperLeg",
    RightLeg: "rightLowerLeg",
    RightFoot: "rightFoot",
    RightToe: "rightToes",
  };

  for (const [meshyBone, vrmBone] of Object.entries(meshyToVrmMap)) {
    const nodeIndex = nodeNameToIndex.get(meshyBone);
    if (nodeIndex !== undefined) {
      humanBones[vrmBone] = { node: nodeIndex };
      boneMappings.set(meshyBone, vrmBone);
      console.log(`   Mapped ${vrmBone} → node ${nodeIndex} (${meshyBone})`);
    }
  }

  console.log(`   Total bones mapped: ${Object.keys(humanBones).length}`);

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
  const newJsonString = JSON.stringify(gltfJson);
  const newJsonBuffer = new TextEncoder().encode(newJsonString);
  const newJsonChunkLength = Math.ceil(newJsonBuffer.length / 4) * 4;
  const jsonPadding = newJsonChunkLength - newJsonBuffer.length;

  const binChunkLength = binChunkData
    ? Math.ceil(binChunkData.length / 4) * 4
    : 0;
  const binPadding = binChunkData ? binChunkLength - binChunkData.length : 0;
  const newTotalLength =
    12 + 8 + newJsonChunkLength + (binChunkData ? 8 + binChunkLength : 0);

  const vrmGlb = new ArrayBuffer(newTotalLength);
  const vrmView = new DataView(vrmGlb);

  // GLB Header
  vrmView.setUint32(0, 0x46546c67, true); // magic: "glTF"
  vrmView.setUint32(4, 2, true); // version: 2
  vrmView.setUint32(8, newTotalLength, true);

  // JSON chunk header
  vrmView.setUint32(12, newJsonChunkLength, true);
  vrmView.setUint32(16, 0x4e4f534a, true); // "JSON"

  // JSON chunk data
  const jsonChunkOut = new Uint8Array(vrmGlb, 20, newJsonChunkLength);
  jsonChunkOut.set(newJsonBuffer);
  for (let i = 0; i < jsonPadding; i++) {
    jsonChunkOut[newJsonBuffer.length + i] = 0x20; // Pad with spaces
  }

  // BIN chunk (copied from original - preserves textures!)
  if (binChunkData) {
    const binChunkHeaderOffset = 20 + newJsonChunkLength;
    vrmView.setUint32(binChunkHeaderOffset, binChunkLength, true);
    vrmView.setUint32(binChunkHeaderOffset + 4, 0x004e4942, true); // "BIN\0"

    const binChunkOut = new Uint8Array(
      vrmGlb,
      binChunkHeaderOffset + 8,
      binChunkLength,
    );
    binChunkOut.set(binChunkData);
    for (let i = 0; i < binPadding; i++) {
      binChunkOut[binChunkData.length + i] = 0x00;
    }
  }

  console.log(
    `✅ VRM GLB created: ${(newTotalLength / 1024).toFixed(2)} KB (textures preserved!)`,
  );

  return {
    vrmData: vrmGlb,
    boneMappings,
    warnings,
    coordinateSystemFixed: false, // We don't modify transforms in this path
  };
}
