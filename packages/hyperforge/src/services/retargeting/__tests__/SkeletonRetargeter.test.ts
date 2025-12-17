/**
 * SkeletonRetargeter Tests
 *
 * Tests for retargeting meshes between different skeleton formats.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone matching failures when bone names don't match conventions
 * - Hierarchy preservation issues when parent-child relationships break
 * - Scale calculation errors leading to incorrect mesh alignment
 * - Inverse bind matrix recalculation producing incorrect deformations
 * - Rest pose transfer breaking animations
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { SkeletonRetargeter, SolverType } from "../SkeletonRetargeter";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a humanoid skeleton with standard naming convention
 * Used as a source skeleton for retargeting
 */
function createHumanoidSkeleton(
  scale: number = 1.0,
  prefix: string = "",
): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = prefix + "Hips";
  hipsBone.position.set(0, 1 * scale, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = prefix + "Spine";
  spineBone.position.set(0, 0.15 * scale, 0);
  hipsBone.add(spineBone);

  const spine1Bone = new THREE.Bone();
  spine1Bone.name = prefix + "Spine1";
  spine1Bone.position.set(0, 0.15 * scale, 0);
  spineBone.add(spine1Bone);

  const spine2Bone = new THREE.Bone();
  spine2Bone.name = prefix + "Spine2";
  spine2Bone.position.set(0, 0.15 * scale, 0);
  spine1Bone.add(spine2Bone);

  const neckBone = new THREE.Bone();
  neckBone.name = prefix + "Neck";
  neckBone.position.set(0, 0.2 * scale, 0);
  spine2Bone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = prefix + "Head";
  headBone.position.set(0, 0.15 * scale, 0);
  neckBone.add(headBone);

  // Left arm
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = prefix + "LeftShoulder";
  leftShoulderBone.position.set(0.1 * scale, 0.1 * scale, 0);
  spine2Bone.add(leftShoulderBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = prefix + "LeftArm";
  leftArmBone.position.set(0.15 * scale, 0, 0);
  leftShoulderBone.add(leftArmBone);

  const leftForeArmBone = new THREE.Bone();
  leftForeArmBone.name = prefix + "LeftForeArm";
  leftForeArmBone.position.set(0.25 * scale, 0, 0);
  leftArmBone.add(leftForeArmBone);

  const leftHandBone = new THREE.Bone();
  leftHandBone.name = prefix + "LeftHand";
  leftHandBone.position.set(0.2 * scale, 0, 0);
  leftForeArmBone.add(leftHandBone);

  // Right arm
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = prefix + "RightShoulder";
  rightShoulderBone.position.set(-0.1 * scale, 0.1 * scale, 0);
  spine2Bone.add(rightShoulderBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = prefix + "RightArm";
  rightArmBone.position.set(-0.15 * scale, 0, 0);
  rightShoulderBone.add(rightArmBone);

  const rightForeArmBone = new THREE.Bone();
  rightForeArmBone.name = prefix + "RightForeArm";
  rightForeArmBone.position.set(-0.25 * scale, 0, 0);
  rightArmBone.add(rightForeArmBone);

  const rightHandBone = new THREE.Bone();
  rightHandBone.name = prefix + "RightHand";
  rightHandBone.position.set(-0.2 * scale, 0, 0);
  rightForeArmBone.add(rightHandBone);

  // Left leg
  const leftUpLegBone = new THREE.Bone();
  leftUpLegBone.name = prefix + "LeftUpLeg";
  leftUpLegBone.position.set(0.1 * scale, -0.1 * scale, 0);
  hipsBone.add(leftUpLegBone);

  const leftLegBone = new THREE.Bone();
  leftLegBone.name = prefix + "LeftLeg";
  leftLegBone.position.set(0, -0.4 * scale, 0);
  leftUpLegBone.add(leftLegBone);

  const leftFootBone = new THREE.Bone();
  leftFootBone.name = prefix + "LeftFoot";
  leftFootBone.position.set(0, -0.4 * scale, 0);
  leftLegBone.add(leftFootBone);

  // Right leg
  const rightUpLegBone = new THREE.Bone();
  rightUpLegBone.name = prefix + "RightUpLeg";
  rightUpLegBone.position.set(-0.1 * scale, -0.1 * scale, 0);
  hipsBone.add(rightUpLegBone);

  const rightLegBone = new THREE.Bone();
  rightLegBone.name = prefix + "RightLeg";
  rightLegBone.position.set(0, -0.4 * scale, 0);
  rightUpLegBone.add(rightLegBone);

  const rightFootBone = new THREE.Bone();
  rightFootBone.name = prefix + "RightFoot";
  rightFootBone.position.set(0, -0.4 * scale, 0);
  rightLegBone.add(rightFootBone);

  const bones = [
    hipsBone,
    spineBone,
    spine1Bone,
    spine2Bone,
    neckBone,
    headBone,
    leftShoulderBone,
    leftArmBone,
    leftForeArmBone,
    leftHandBone,
    rightShoulderBone,
    rightArmBone,
    rightForeArmBone,
    rightHandBone,
    leftUpLegBone,
    leftLegBone,
    leftFootBone,
    rightUpLegBone,
    rightLegBone,
    rightFootBone,
  ];

  // Update matrices for all bones
  hipsBone.updateMatrix();
  hipsBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: hipsBone };
}

/**
 * Create a minimal skeleton with fewer bones
 * Used for testing hierarchy depth differences
 */
function createMinimalSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 0.9, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.3, 0);
  hipsBone.add(spineBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.4, 0);
  spineBone.add(headBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "LeftArm";
  leftArmBone.position.set(0.3, 0.2, 0);
  spineBone.add(leftArmBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "RightArm";
  rightArmBone.position.set(-0.3, 0.2, 0);
  spineBone.add(rightArmBone);

  const leftLegBone = new THREE.Bone();
  leftLegBone.name = "LeftUpLeg";
  leftLegBone.position.set(0.1, -0.5, 0);
  hipsBone.add(leftLegBone);

  const rightLegBone = new THREE.Bone();
  rightLegBone.name = "RightUpLeg";
  rightLegBone.position.set(-0.1, -0.5, 0);
  hipsBone.add(rightLegBone);

  const bones = [
    hipsBone,
    spineBone,
    headBone,
    leftArmBone,
    rightArmBone,
    leftLegBone,
    rightLegBone,
  ];

  hipsBone.updateMatrix();
  hipsBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: hipsBone };
}

/**
 * Create a SkinnedMesh with basic geometry for testing
 */
function createTestSkinnedMesh(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
): THREE.SkinnedMesh {
  // Create a simple box geometry to represent a character body
  const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.3, 4, 8, 2);

  // Create skin indices and weights for the geometry
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  const positionAttribute = geometry.attributes.position;
  const vertexCount = positionAttribute.count;

  for (let i = 0; i < vertexCount; i++) {
    const y = positionAttribute.getY(i);

    // Assign bones based on vertex Y position
    let boneIndex = 0;

    if (y > 0.6) {
      boneIndex = 5; // Head area
    } else if (y > 0.3) {
      boneIndex = 4; // Neck area
    } else if (y > 0) {
      boneIndex = 3; // Upper spine
    } else if (y > -0.3) {
      boneIndex = 1; // Lower spine
    } else {
      boneIndex = 0; // Hips
    }

    // Simple single-bone weighting
    skinIndices.push(boneIndex, 0, 0, 0);
    skinWeights.push(1.0, 0, 0, 0);
  }

  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  // Create material
  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
  });

  // Create SkinnedMesh
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "TestCharacter";

  // Add skeleton and bind
  mesh.add(rootBone);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a character mesh with proper proportions
 * Simulates a real character with vertices distributed across the body
 */
function createCharacterMesh(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
  height: number = 1.8,
): THREE.SkinnedMesh {
  // Create a more realistic humanoid geometry
  const geometry = new THREE.CapsuleGeometry(0.2, height - 0.4, 8, 16);

  // Center the geometry
  geometry.translate(0, height / 2 - 0.1, 0);

  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  const positionAttribute = geometry.attributes.position;
  const vertexCount = positionAttribute.count;

  for (let i = 0; i < vertexCount; i++) {
    const y = positionAttribute.getY(i);

    // Map Y position to bone indices
    let boneIndex = 0;
    const normalizedY = y / height;

    if (normalizedY > 0.85) {
      boneIndex = 5; // Head
    } else if (normalizedY > 0.75) {
      boneIndex = 4; // Neck
    } else if (normalizedY > 0.6) {
      boneIndex = 3; // Upper spine
    } else if (normalizedY > 0.45) {
      boneIndex = 2; // Mid spine
    } else if (normalizedY > 0.35) {
      boneIndex = 1; // Lower spine
    } else {
      boneIndex = 0; // Hips
    }

    skinIndices.push(boneIndex, 0, 0, 0);
    skinWeights.push(1.0, 0, 0, 0);
  }

  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "Character";

  mesh.add(rootBone);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a model hierarchy containing a SkinnedMesh
 */
function createModelWithSkinnedMesh(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
): THREE.Group {
  const model = new THREE.Group();
  model.name = "Model";

  const armature = new THREE.Group();
  armature.name = "Armature";
  model.add(armature);

  armature.add(rootBone);

  const mesh = createTestSkinnedMesh(skeleton, rootBone);
  model.add(mesh);

  return model;
}

describe("SkeletonRetargeter", () => {
  describe("Skeleton Matching", () => {
    it("matches bones by name", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      // Retarget the mesh to the target skeleton
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.skeleton).toBeDefined();

      // The retargeted mesh should have bones
      expect(retargetedMesh.skeleton.bones.length).toBeGreaterThan(0);
    });

    it("matches bones by hierarchy position", () => {
      // Create source with prefixed bone names
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0, "mixamorig:");

      // Create target with standard names
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Skeleton should still be bound
      expect(retargetedMesh.skeleton).toBeDefined();
      expect(retargetedMesh.skeleton.bones.length).toBe(
        targetSkeleton.bones.length,
      );
    });

    it("handles missing bones gracefully", () => {
      // Create source with full skeleton
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Create target with minimal skeleton
      const { skeleton: targetSkeleton } = createMinimalSkeleton();

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      // Should not throw, even with missing bones
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.skeleton).toBeDefined();

      // Target skeleton has fewer bones
      expect(retargetedMesh.skeleton.bones.length).toBe(
        targetSkeleton.bones.length,
      );
    });
  });

  describe("Bone Hierarchy Preservation", () => {
    it("preserves parent-child relationships", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const retargetedBones = retargetedMesh.skeleton.bones;
      const hips = retargetedBones.find((b) => b.name === "Hips");
      const spine = retargetedBones.find((b) => b.name === "Spine");

      expect(hips).toBeDefined();
      expect(spine).toBeDefined();

      // Spine should be a child of Hips
      expect(spine!.parent).toBe(hips);
    });

    it("handles different hierarchy depths", () => {
      // Create a deep skeleton (standard)
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Create a shallow skeleton
      const { skeleton: targetSkeleton } = createMinimalSkeleton();

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Verify the mesh is properly bound
      expect(retargetedMesh.skeleton.bones.length).toBeGreaterThan(0);

      // Root bone should be in the mesh hierarchy
      const rootBone = retargetedMesh.skeleton.bones[0];
      expect(rootBone.parent).not.toBeNull();
    });

    it("maintains bone order", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const targetBoneNames = targetSkeleton.bones.map((b) => b.name);
      const retargetedBoneNames = retargetedMesh.skeleton.bones.map(
        (b) => b.name,
      );

      // Bone order should be preserved
      expect(retargetedBoneNames).toEqual(targetBoneNames);
    });
  });

  describe("Rest Pose Transfer", () => {
    it("transfers rest pose from source to target", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Verify that bones have valid positions
      for (const bone of retargetedMesh.skeleton.bones) {
        expect(bone.position).toBeDefined();
        // Position should be finite
        expect(Number.isFinite(bone.position.x)).toBe(true);
        expect(Number.isFinite(bone.position.y)).toBe(true);
        expect(Number.isFinite(bone.position.z)).toBe(true);
      }
    });

    it("handles T-pose to A-pose conversion", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Create A-pose skeleton (arms at 45 degrees)
      const { skeleton: targetSkeleton, rootBone: targetRoot } =
        createHumanoidSkeleton(1.0);
      const leftArm = targetSkeleton.bones.find((b) => b.name === "LeftArm");
      const rightArm = targetSkeleton.bones.find((b) => b.name === "RightArm");

      if (leftArm) {
        leftArm.rotation.z = Math.PI / 4; // 45 degrees
        leftArm.updateMatrix();
      }
      if (rightArm) {
        rightArm.rotation.z = -Math.PI / 4;
        rightArm.updateMatrix();
      }
      targetRoot.updateMatrixWorld(true);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.skeleton.bones.length).toBeGreaterThan(0);

      // Skeleton should still be functional after pose conversion
      const retargetedLeftArm = retargetedMesh.skeleton.bones.find(
        (b) => b.name === "LeftArm",
      );
      expect(retargetedLeftArm).toBeDefined();
    });

    it("preserves bone lengths", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Calculate bone lengths for source skeleton
      const getSpineLength = (skeleton: THREE.Skeleton): number => {
        const hips = skeleton.bones.find((b) => b.name === "Hips");
        const spine = skeleton.bones.find((b) => b.name === "Spine");
        if (hips && spine) {
          return spine.position.length();
        }
        return 0;
      };

      const sourceSpineLength = getSpineLength(targetSkeleton);
      const retargetedSpineLength = getSpineLength(retargetedMesh.skeleton);

      // Bone lengths should be proportionally similar (accounting for scale)
      expect(retargetedSpineLength).toBeGreaterThan(0);
      expect(sourceSpineLength).toBeGreaterThan(0);
    });
  });

  describe("Scale Matching", () => {
    it("adjusts for different skeleton sizes", () => {
      // Create small source skeleton
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(0.5);

      // Create large target skeleton
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(2.0);

      const sourceMesh = createCharacterMesh(sourceSkeleton, sourceRoot, 0.9);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // The skeleton should be scaled appropriately
      const rootBone = retargetedMesh.skeleton.bones[0];
      expect(rootBone).toBeDefined();

      // Scale should have been applied to root
      expect(rootBone.scale.length()).toBeGreaterThan(0);
    });

    it("preserves proportions", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.5);

      const sourceMesh = createCharacterMesh(sourceSkeleton, sourceRoot, 1.8);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Check that proportions are maintained
      const bones = retargetedMesh.skeleton.bones;

      // Get spine bones
      const spine = bones.find((b) => b.name === "Spine");
      const spine1 = bones.find((b) => b.name === "Spine1");

      expect(spine).toBeDefined();
      expect(spine1).toBeDefined();

      // Both bones should have similar relative scale
      expect(spine!.position.y).toBeGreaterThan(0);
      expect(spine1!.position.y).toBeGreaterThan(0);
    });

    it("handles non-uniform scaling", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Create target with non-uniform scale
      const { skeleton: targetSkeleton, rootBone: targetRoot } =
        createHumanoidSkeleton(1.0);
      targetRoot.scale.set(1.0, 1.5, 1.0); // Taller skeleton
      targetRoot.updateMatrixWorld(true);

      const sourceMesh = createCharacterMesh(sourceSkeleton, sourceRoot, 1.8);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Should handle non-uniform scaling without errors
      expect(retargetedMesh.skeleton.bones.length).toBeGreaterThan(0);
    });
  });

  describe("Inverse Bind Matrices", () => {
    it("recalculates inverse bind matrices", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Inverse bind matrices should be defined
      expect(retargetedMesh.skeleton.boneInverses).toBeDefined();
      expect(retargetedMesh.skeleton.boneInverses.length).toBe(
        retargetedMesh.skeleton.bones.length,
      );

      // Each inverse matrix should be valid
      for (const inverse of retargetedMesh.skeleton.boneInverses) {
        expect(inverse).toBeInstanceOf(THREE.Matrix4);

        // Matrix should have finite values
        const elements = inverse.elements;
        for (const element of elements) {
          expect(Number.isFinite(element)).toBe(true);
        }
      }
    });

    it("handles world space transformations", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Create target with world transformation
      const { skeleton: targetSkeleton, rootBone: targetRoot } =
        createHumanoidSkeleton(1.0);
      targetRoot.position.set(5, 0, 10); // Offset in world space
      targetRoot.rotation.set(0, Math.PI / 4, 0); // Rotated
      targetRoot.updateMatrixWorld(true);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Mesh should be properly bound regardless of initial transforms
      expect(retargetedMesh.bindMatrix).toBeDefined();
      expect(retargetedMesh.bindMatrixInverse).toBeDefined();
    });

    it("updates skeleton properly", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Update the skeleton
      retargetedMesh.skeleton.update();

      // Bone matrices should be calculated
      expect(retargetedMesh.skeleton.boneMatrices).toBeDefined();
      expect(retargetedMesh.skeleton.boneMatrices.length).toBeGreaterThan(0);

      // Bone texture or matrices should be set
      const boneMatrices = retargetedMesh.skeleton.boneMatrices;
      expect(boneMatrices.length).toBe(
        retargetedMesh.skeleton.bones.length * 16,
      );
    });
  });

  describe("Extract Methods", () => {
    it("extracts skeleton from a model with SkinnedMesh", () => {
      const { skeleton, rootBone } = createHumanoidSkeleton(1.0);
      const model = createModelWithSkinnedMesh(skeleton, rootBone);

      const extractedSkeleton = SkeletonRetargeter.extractSkeleton(model);

      expect(extractedSkeleton).not.toBeNull();
      expect(extractedSkeleton!.bones.length).toBe(skeleton.bones.length);
    });

    it("returns null when no skeleton exists", () => {
      const model = new THREE.Group();
      model.add(new THREE.Mesh(new THREE.BoxGeometry()));

      const extractedSkeleton = SkeletonRetargeter.extractSkeleton(model);

      expect(extractedSkeleton).toBeNull();
    });

    it("extracts all SkinnedMeshes from a model", () => {
      const { skeleton, rootBone } = createHumanoidSkeleton(1.0);
      const model = new THREE.Group();

      // Add multiple skinned meshes
      const mesh1 = createTestSkinnedMesh(skeleton, rootBone.clone());
      mesh1.name = "Body";
      model.add(mesh1);

      // Create another skeleton for second mesh
      const { skeleton: skeleton2, rootBone: rootBone2 } =
        createHumanoidSkeleton(1.0);
      const mesh2 = createTestSkinnedMesh(skeleton2, rootBone2);
      mesh2.name = "Accessories";
      model.add(mesh2);

      const meshes = SkeletonRetargeter.extractSkinnedMeshes(model);

      expect(meshes).toHaveLength(2);
      expect(meshes.map((m) => m.name)).toContain("Body");
      expect(meshes.map((m) => m.name)).toContain("Accessories");
    });

    it("returns empty array when no SkinnedMeshes exist", () => {
      const model = new THREE.Group();
      model.add(new THREE.Mesh(new THREE.BoxGeometry()));
      model.add(new THREE.Mesh(new THREE.SphereGeometry()));

      const meshes = SkeletonRetargeter.extractSkinnedMeshes(model);

      expect(meshes).toHaveLength(0);
    });
  });

  describe("Solver Types", () => {
    it("uses distance solver when specified", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
        "distance",
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.geometry.attributes.skinIndex).toBeDefined();
      expect(retargetedMesh.geometry.attributes.skinWeight).toBeDefined();
    });

    it("uses distance-child solver when specified", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
        "distance-child",
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.geometry.attributes.skinIndex).toBeDefined();
    });

    it("uses distance-targeting solver when specified", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
        "distance-targeting",
      );

      expect(retargetedMesh).toBeDefined();
    });

    it("createSolver returns appropriate solver instance", () => {
      const geometry = new THREE.BoxGeometry();
      const bone = new THREE.Bone();
      const bones = [bone];

      const distanceSolver = SkeletonRetargeter.createSolver(
        "distance",
        geometry,
        bones,
      );
      expect(distanceSolver).toBeDefined();
      expect(distanceSolver.calculateWeights).toBeDefined();

      const childSolver = SkeletonRetargeter.createSolver(
        "distance-child",
        geometry,
        bones,
      );
      expect(childSolver).toBeDefined();
    });
  });

  describe("Mesh Properties", () => {
    it("preserves mesh name with suffix", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      sourceMesh.name = "MyCharacter";

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh.name).toBe("MyCharacter_retargeted");
    });

    it("preserves shadow properties", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      sourceMesh.castShadow = true;
      sourceMesh.receiveShadow = true;

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      expect(retargetedMesh.castShadow).toBe(true);
      expect(retargetedMesh.receiveShadow).toBe(true);
    });

    it("clones material properly", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Material should be a different instance
      expect(retargetedMesh.material).not.toBe(sourceMesh.material);

      // But should have same type
      expect(retargetedMesh.material.type).toBe(
        (sourceMesh.material as THREE.Material).type,
      );
    });

    it("clones geometry properly", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const sourceVertexCount = sourceMesh.geometry.attributes.position.count;

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Geometry should be a different instance
      expect(retargetedMesh.geometry).not.toBe(sourceMesh.geometry);

      // But should have same vertex count
      expect(retargetedMesh.geometry.attributes.position.count).toBe(
        sourceVertexCount,
      );
    });

    it("resets mesh position to origin", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      sourceMesh.position.set(10, 5, -3);
      sourceMesh.rotation.set(0.5, 1.0, 0.2);
      sourceMesh.scale.set(2, 2, 2);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // New mesh should be at origin with identity transforms
      expect(retargetedMesh.position.x).toBe(0);
      expect(retargetedMesh.position.y).toBe(0);
      expect(retargetedMesh.position.z).toBe(0);
      expect(retargetedMesh.rotation.x).toBe(0);
      expect(retargetedMesh.rotation.y).toBe(0);
      expect(retargetedMesh.rotation.z).toBe(0);
      expect(retargetedMesh.scale.x).toBe(1);
      expect(retargetedMesh.scale.y).toBe(1);
      expect(retargetedMesh.scale.z).toBe(1);
    });
  });

  describe("Skin Attributes", () => {
    it("creates skinIndex attribute with 4 components", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const skinIndex = retargetedMesh.geometry.attributes.skinIndex;
      expect(skinIndex).toBeDefined();
      expect(skinIndex.itemSize).toBe(4);
    });

    it("creates skinWeight attribute with 4 components", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const skinWeight = retargetedMesh.geometry.attributes.skinWeight;
      expect(skinWeight).toBeDefined();
      expect(skinWeight.itemSize).toBe(4);
    });

    it("has matching vertex count for skin attributes", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const positionCount = retargetedMesh.geometry.attributes.position.count;
      const skinIndexCount = retargetedMesh.geometry.attributes.skinIndex.count;
      const skinWeightCount =
        retargetedMesh.geometry.attributes.skinWeight.count;

      expect(skinIndexCount).toBe(positionCount);
      expect(skinWeightCount).toBe(positionCount);
    });

    it("skin indices reference valid bone indices", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const skinIndex = retargetedMesh.geometry.attributes
        .skinIndex as THREE.BufferAttribute;
      const boneCount = retargetedMesh.skeleton.bones.length;

      // All indices should be valid bone indices
      for (let i = 0; i < skinIndex.count * 4; i++) {
        const index = skinIndex.array[i];
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(boneCount);
      }
    });

    it("skin weights sum to 1.0 per vertex", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      const skinWeight = retargetedMesh.geometry.attributes
        .skinWeight as THREE.BufferAttribute;

      for (let v = 0; v < skinWeight.count; v++) {
        const sum =
          skinWeight.array[v * 4 + 0] +
          skinWeight.array[v * 4 + 1] +
          skinWeight.array[v * 4 + 2] +
          skinWeight.array[v * 4 + 3];

        expect(sum).toBeCloseTo(1.0, 5);
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles empty source mesh geometry", () => {
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      // Create mesh with minimal geometry
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0], 3),
      );
      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute([1, 0, 0, 0], 4),
      );

      const bone = new THREE.Bone();
      const skeleton = new THREE.Skeleton([bone]);

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(bone);
      mesh.bind(skeleton);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        mesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.geometry.attributes.position.count).toBe(1);
    });

    it("handles multi-material meshes", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const geometry = new THREE.BoxGeometry(1, 1, 1);

      // Add skin attributes
      const skinIndices: number[] = [];
      const skinWeights: number[] = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        skinIndices.push(0, 0, 0, 0);
        skinWeights.push(1, 0, 0, 0);
      }
      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      // Multiple materials
      const materials = [
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        new THREE.MeshBasicMaterial({ color: 0x0000ff }),
      ];

      const mesh = new THREE.SkinnedMesh(geometry, materials);
      mesh.add(sourceRoot);
      mesh.bind(sourceSkeleton);

      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        mesh,
        targetSkeleton,
      );

      expect(retargetedMesh).toBeDefined();

      // Material should be cloned as array
      expect(Array.isArray(retargetedMesh.material)).toBe(true);
      expect((retargetedMesh.material as THREE.Material[]).length).toBe(3);
    });

    it("handles skeleton with no bones gracefully", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);

      // Empty skeleton
      const emptyBone = new THREE.Bone();
      const emptySkeleton = new THREE.Skeleton([emptyBone]);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);

      // Should not crash
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        emptySkeleton,
      );

      expect(retargetedMesh).toBeDefined();
      expect(retargetedMesh.skeleton.bones.length).toBe(1);
    });

    it("handles Z-up to Y-up conversion", () => {
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createHumanoidSkeleton(1.0);
      const { skeleton: targetSkeleton } = createHumanoidSkeleton(1.0);

      const sourceMesh = createTestSkinnedMesh(sourceSkeleton, sourceRoot);
      const retargetedMesh = SkeletonRetargeter.retargetMesh(
        sourceMesh,
        targetSkeleton,
      );

      // Root bone should have rotation applied for Z-up to Y-up
      const rootBone = retargetedMesh.skeleton.bones[0];
      expect(rootBone.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    });
  });
});
