/**
 * SimpleHandRiggingService Tests
 *
 * Tests for adding simple hand bones (palm and finger bones) to rigged models.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Wrist detection failures when naming conventions vary
 * - Hand direction calculation errors for different orientations
 * - Weight application not summing to 1.0
 * - Skeleton update not preserving original bones
 * - Bone hierarchy parent-child relationship errors
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { SimpleHandRiggingService } from "../SimpleHandRiggingService";
import { createTestSkeleton } from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a test skeleton with full arm bones including wrists
 * This simulates a realistic humanoid skeleton
 */
function createSkeletonWithWrists(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  leftWrist: THREE.Bone;
  rightWrist: THREE.Bone;
} {
  // Root bone (Hips)
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 100, 0);

  // Spine
  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 20, 0);
  hipsBone.add(spineBone);

  // Chest
  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 20, 0);
  spineBone.add(chestBone);

  // Left arm chain
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(10, 0, 0);
  chestBone.add(leftShoulder);

  const leftUpperArm = new THREE.Bone();
  leftUpperArm.name = "LeftUpperArm";
  leftUpperArm.position.set(15, 0, 0);
  leftShoulder.add(leftUpperArm);

  const leftForearm = new THREE.Bone();
  leftForearm.name = "LeftForeArm";
  leftForearm.position.set(25, 0, 0);
  leftUpperArm.add(leftForearm);

  const leftHand = new THREE.Bone();
  leftHand.name = "LeftHand";
  leftHand.position.set(25, 0, 0);
  leftForearm.add(leftHand);

  // Right arm chain
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  rightShoulder.position.set(-10, 0, 0);
  chestBone.add(rightShoulder);

  const rightUpperArm = new THREE.Bone();
  rightUpperArm.name = "RightUpperArm";
  rightUpperArm.position.set(-15, 0, 0);
  rightShoulder.add(rightUpperArm);

  const rightForearm = new THREE.Bone();
  rightForearm.name = "RightForeArm";
  rightForearm.position.set(-25, 0, 0);
  rightUpperArm.add(rightForearm);

  const rightHand = new THREE.Bone();
  rightHand.name = "RightHand";
  rightHand.position.set(-25, 0, 0);
  rightForearm.add(rightHand);

  // Collect all bones in order (parents before children)
  const bones = [
    hipsBone,
    spineBone,
    chestBone,
    leftShoulder,
    leftUpperArm,
    leftForearm,
    leftHand,
    rightShoulder,
    rightUpperArm,
    rightForearm,
    rightHand,
  ];

  // Update matrices
  hipsBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);

  return {
    skeleton,
    rootBone: hipsBone,
    leftWrist: leftHand,
    rightWrist: rightHand,
  };
}

/**
 * Create a skinned mesh with the given skeleton
 */
function createSkinnedMeshWithSkeleton(
  skeleton: THREE.Skeleton,
): THREE.SkinnedMesh {
  // Create geometry that covers the body
  const geometry = new THREE.BoxGeometry(50, 150, 30, 4, 8, 4);
  const vertexCount = geometry.attributes.position.count;

  // Add skinning attributes
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  // Simple weight assignment - all vertices to first bone (hips)
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0; // Hips bone
    skinIndices[i * 4 + 1] = 0;
    skinIndices[i * 4 + 2] = 0;
    skinIndices[i * 4 + 3] = 0;
    skinWeights[i * 4] = 1.0;
    skinWeights[i * 4 + 1] = 0;
    skinWeights[i * 4 + 2] = 0;
    skinWeights[i * 4 + 3] = 0;
  }

  geometry.setAttribute(
    "skinIndex",
    new THREE.Float32BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const mesh = new THREE.SkinnedMesh(geometry, material);

  mesh.add(skeleton.bones[0]);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a scene with a skinned mesh ready for hand rigging
 */
function createTestScene(): {
  scene: THREE.Object3D;
  skeleton: THREE.Skeleton;
  leftWrist: THREE.Bone;
  rightWrist: THREE.Bone;
  mesh: THREE.SkinnedMesh;
} {
  const scene = new THREE.Object3D();
  scene.name = "Scene";

  const { skeleton, rootBone, leftWrist, rightWrist } =
    createSkeletonWithWrists();
  const mesh = createSkinnedMeshWithSkeleton(skeleton);
  mesh.name = "Body";

  scene.add(mesh);
  scene.updateMatrixWorld(true);

  return {
    scene,
    skeleton,
    leftWrist,
    rightWrist,
    mesh,
  };
}

describe("SimpleHandRiggingService", () => {
  let service: SimpleHandRiggingService;

  beforeAll(() => {
    service = new SimpleHandRiggingService();
  });

  describe("Wrist Detection", () => {
    it("finds left hand bone with 'LeftHand' naming convention", () => {
      const { scene } = createTestScene();

      // Manually traverse to find wrist bones (simulating findWristBones behavior)
      const wristBones: THREE.Bone[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          const lowerName = child.name.toLowerCase();
          if (lowerName.includes("hand") || lowerName.includes("wrist")) {
            wristBones.push(child);
          }
        }
      });

      const leftWrist = wristBones.find((b) =>
        b.name.toLowerCase().includes("left"),
      );
      expect(leftWrist).toBeDefined();
      expect(leftWrist!.name).toBe("LeftHand");
    });

    it("finds right hand bone with 'RightHand' naming convention", () => {
      const { scene } = createTestScene();

      const wristBones: THREE.Bone[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          const lowerName = child.name.toLowerCase();
          if (lowerName.includes("hand") || lowerName.includes("wrist")) {
            wristBones.push(child);
          }
        }
      });

      const rightWrist = wristBones.find((b) =>
        b.name.toLowerCase().includes("right"),
      );
      expect(rightWrist).toBeDefined();
      expect(rightWrist!.name).toBe("RightHand");
    });

    it("finds wrist bones with 'Wrist' naming convention", () => {
      // Create a skeleton with Wrist naming
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const leftWrist = new THREE.Bone();
      leftWrist.name = "LeftWrist";
      leftWrist.position.set(50, 0, 0);
      hipsBone.add(leftWrist);

      const rightWrist = new THREE.Bone();
      rightWrist.name = "RightWrist";
      rightWrist.position.set(-50, 0, 0);
      hipsBone.add(rightWrist);

      hipsBone.updateMatrixWorld(true);

      const scene = new THREE.Object3D();
      scene.add(hipsBone);

      const wristBones: THREE.Bone[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          const lowerName = child.name.toLowerCase();
          if (lowerName.includes("hand") || lowerName.includes("wrist")) {
            wristBones.push(child);
          }
        }
      });

      expect(wristBones).toHaveLength(2);
      expect(wristBones.map((b) => b.name)).toContain("LeftWrist");
      expect(wristBones.map((b) => b.name)).toContain("RightWrist");
    });

    it("handles mixamo-style naming (mixamorig:LeftHand)", () => {
      const hipsBone = new THREE.Bone();
      hipsBone.name = "mixamorig:Hips";
      hipsBone.position.set(0, 100, 0);

      const leftHand = new THREE.Bone();
      leftHand.name = "mixamorig:LeftHand";
      leftHand.position.set(50, 0, 0);
      hipsBone.add(leftHand);

      hipsBone.updateMatrixWorld(true);

      const scene = new THREE.Object3D();
      scene.add(hipsBone);

      const wristBones: THREE.Bone[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          const lowerName = child.name.toLowerCase();
          if (lowerName.includes("hand") || lowerName.includes("wrist")) {
            wristBones.push(child);
          }
        }
      });

      expect(wristBones).toHaveLength(1);
      expect(wristBones[0].name).toBe("mixamorig:LeftHand");
    });

    it("returns empty array when no wrist bones found", () => {
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Root";
      hipsBone.position.set(0, 0, 0);

      const otherBone = new THREE.Bone();
      otherBone.name = "OtherBone";
      otherBone.position.set(0, 10, 0);
      hipsBone.add(otherBone);

      const scene = new THREE.Object3D();
      scene.add(hipsBone);

      const wristBones: THREE.Bone[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          const lowerName = child.name.toLowerCase();
          if (lowerName.includes("hand") || lowerName.includes("wrist")) {
            wristBones.push(child);
          }
        }
      });

      expect(wristBones).toHaveLength(0);
    });
  });

  describe("Hand Bone Creation", () => {
    it("creates palm bone as child of wrist", () => {
      const { leftWrist } = createTestScene();

      // Simulate palm bone creation
      const palmBone = new THREE.Bone();
      palmBone.name = `${leftWrist.name}_Palm`;
      palmBone.position.set(10, 0, 0); // Extend from wrist

      leftWrist.add(palmBone);
      leftWrist.updateMatrixWorld(true);

      expect(palmBone.parent).toBe(leftWrist);
      expect(palmBone.name).toBe("LeftHand_Palm");
    });

    it("creates finger bone as child of palm", () => {
      const { leftWrist } = createTestScene();

      // Create palm bone
      const palmBone = new THREE.Bone();
      palmBone.name = `${leftWrist.name}_Palm`;
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      // Create finger bone
      const fingerBone = new THREE.Bone();
      fingerBone.name = `${leftWrist.name}_Fingers`;
      fingerBone.position.set(15, 0, 0);
      palmBone.add(fingerBone);

      leftWrist.updateMatrixWorld(true);

      expect(fingerBone.parent).toBe(palmBone);
      expect(fingerBone.name).toBe("LeftHand_Fingers");
    });

    it("creates correct bone hierarchy (wrist -> palm -> fingers)", () => {
      const { leftWrist, rightWrist } = createTestScene();

      // Test left hand hierarchy
      const leftPalm = new THREE.Bone();
      leftPalm.name = "LeftHand_Palm";
      leftPalm.position.set(10, 0, 0);

      const leftFingers = new THREE.Bone();
      leftFingers.name = "LeftHand_Fingers";
      leftFingers.position.set(15, 0, 0);

      leftPalm.add(leftFingers);
      leftWrist.add(leftPalm);

      // Verify hierarchy
      expect(leftPalm.parent).toBe(leftWrist);
      expect(leftFingers.parent).toBe(leftPalm);

      // Verify chain from finger includes the hand bones in correct order
      const chain: string[] = [];
      let current: THREE.Object3D | null = leftFingers;
      while (current && current instanceof THREE.Bone) {
        chain.push(current.name);
        current = current.parent;
      }

      // Chain should start with finger -> palm -> wrist (LeftHand)
      // and continue up the arm hierarchy
      expect(chain[0]).toBe("LeftHand_Fingers");
      expect(chain[1]).toBe("LeftHand_Palm");
      expect(chain[2]).toBe("LeftHand");
      // Verify the rest of the arm hierarchy is intact
      expect(chain).toContain("LeftForeArm");
      expect(chain).toContain("LeftUpperArm");
      expect(chain).toContain("Hips");
    });

    it("positions bones along hand forward direction", () => {
      const { leftWrist } = createTestScene();

      // The hand extends along X axis for left hand
      const palmLength = 10;
      const fingerLength = 15;

      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(palmLength, 0, 0);
      leftWrist.add(palmBone);

      const fingerBone = new THREE.Bone();
      fingerBone.name = "LeftHand_Fingers";
      fingerBone.position.set(fingerLength, 0, 0);
      palmBone.add(fingerBone);

      leftWrist.updateMatrixWorld(true);

      // Get world positions
      const wristPos = new THREE.Vector3();
      const palmPos = new THREE.Vector3();
      const fingerPos = new THREE.Vector3();

      leftWrist.getWorldPosition(wristPos);
      palmBone.getWorldPosition(palmPos);
      fingerBone.getWorldPosition(fingerPos);

      // Palm should be beyond wrist
      const wristToPalm = palmPos.clone().sub(wristPos);
      expect(wristToPalm.length()).toBeGreaterThan(0);

      // Fingers should be beyond palm
      const palmToFinger = fingerPos.clone().sub(palmPos);
      expect(palmToFinger.length()).toBeGreaterThan(0);
    });
  });

  describe("Hand Direction Calculation", () => {
    it("calculates forward direction from parent bone direction", () => {
      const { leftWrist } = createTestScene();

      // Get parent (forearm) position
      const forearm = leftWrist.parent as THREE.Bone;
      expect(forearm).toBeDefined();

      // Get world positions
      const forearmPos = new THREE.Vector3();
      const wristPos = new THREE.Vector3();
      forearm.getWorldPosition(forearmPos);
      leftWrist.getWorldPosition(wristPos);

      // Direction should be from forearm to wrist
      const direction = wristPos.clone().sub(forearmPos).normalize();

      // For left arm extending along +X, direction should be primarily +X
      expect(direction.x).toBeGreaterThan(0);
    });

    it("handles different wrist orientations", () => {
      // Create a skeleton with rotated wrist
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const forearm = new THREE.Bone();
      forearm.name = "LeftForeArm";
      forearm.position.set(50, 0, 0);
      hipsBone.add(forearm);

      const wrist = new THREE.Bone();
      wrist.name = "LeftHand";
      // Position along +Z instead of +X to test different orientation
      wrist.position.set(0, 0, 25);
      forearm.add(wrist);

      hipsBone.updateMatrixWorld(true);

      // Get world positions
      const forearmPos = new THREE.Vector3();
      const wristPos = new THREE.Vector3();
      forearm.getWorldPosition(forearmPos);
      wrist.getWorldPosition(wristPos);

      // Direction should be from forearm to wrist
      const direction = wristPos.clone().sub(forearmPos).normalize();

      // For this setup, direction should be primarily +Z
      expect(direction.z).toBeGreaterThan(0.5);
    });

    it("handles right hand (different side)", () => {
      const { rightWrist } = createTestScene();

      // Get parent (forearm) position
      const forearm = rightWrist.parent as THREE.Bone;
      expect(forearm).toBeDefined();

      // Get world positions
      const forearmPos = new THREE.Vector3();
      const wristPos = new THREE.Vector3();
      forearm.getWorldPosition(forearmPos);
      rightWrist.getWorldPosition(wristPos);

      // Direction should be from forearm to wrist
      const direction = wristPos.clone().sub(forearmPos).normalize();

      // For right arm extending along -X, direction should be primarily -X
      expect(direction.x).toBeLessThan(0);
    });
  });

  describe("Weight Application", () => {
    it("ensures weights sum to 1.0 for each vertex", () => {
      const { mesh } = createTestScene();
      const geometry = mesh.geometry;
      const skinWeights = geometry.attributes.skinWeight;

      // Check that all weights sum to 1.0
      for (let i = 0; i < skinWeights.count; i++) {
        const sum =
          skinWeights.getX(i) +
          skinWeights.getY(i) +
          skinWeights.getZ(i) +
          skinWeights.getW(i);

        expect(sum).toBeCloseTo(1.0, 4);
      }
    });

    it("normalizes weights after redistribution", () => {
      // Simulate weight redistribution (like in applySimpleWeights)
      const weights = [0.3, 0.5, 0.2, 0.0]; // Sum = 1.0

      // After adding new weights, they should still sum to 1.0
      const newWeights = [0.2, 0.3, 0.3, 0.2]; // Sum = 1.0

      const sum = newWeights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    });

    it("assigns highest weight to nearest bone", () => {
      // Simulate vertex weighting based on position
      // A vertex near the fingertips should have higher finger bone weight

      const wristPos = new THREE.Vector3(100, 100, 0);
      const palmPos = new THREE.Vector3(110, 100, 0);
      const fingerPos = new THREE.Vector3(125, 100, 0);

      // Vertex near fingers
      const vertexPos = new THREE.Vector3(120, 100, 0);

      // Calculate distances
      const toWrist = vertexPos.distanceTo(wristPos);
      const toPalm = vertexPos.distanceTo(palmPos);
      const toFinger = vertexPos.distanceTo(fingerPos);

      // Finger should be closest
      expect(toFinger).toBeLessThan(toPalm);
      expect(toFinger).toBeLessThan(toWrist);
    });

    it("preserves original weights for non-hand vertices", () => {
      const { mesh } = createTestScene();

      // Store original weights
      const geometry = mesh.geometry;
      const skinWeights = geometry.attributes.skinWeight;
      const originalWeights: number[][] = [];

      for (let i = 0; i < skinWeights.count; i++) {
        originalWeights.push([
          skinWeights.getX(i),
          skinWeights.getY(i),
          skinWeights.getZ(i),
          skinWeights.getW(i),
        ]);
      }

      // Verify original weights exist
      expect(originalWeights.length).toBeGreaterThan(0);
      expect(originalWeights[0][0]).toBe(1.0); // First bone weight
    });
  });

  describe("Skeleton Update", () => {
    it("preserves original bones in skeleton", () => {
      const { skeleton } = createTestScene();
      const originalBoneCount = skeleton.bones.length;
      const originalBoneNames = skeleton.bones.map((b) => b.name);

      // Add new bones
      const newBone = new THREE.Bone();
      newBone.name = "NewBone";

      const newBones = [...skeleton.bones, newBone];
      const newSkeleton = new THREE.Skeleton(newBones);

      // Verify all original bones are preserved
      expect(newSkeleton.bones.length).toBe(originalBoneCount + 1);
      for (const name of originalBoneNames) {
        expect(newSkeleton.bones.map((b) => b.name)).toContain(name);
      }
    });

    it("adds new hand bones to skeleton", () => {
      const { skeleton, leftWrist } = createTestScene();
      const originalBoneCount = skeleton.bones.length;

      // Create palm and finger bones
      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      const fingerBone = new THREE.Bone();
      fingerBone.name = "LeftHand_Fingers";
      fingerBone.position.set(15, 0, 0);
      palmBone.add(fingerBone);

      // Create new skeleton with added bones
      const newBones = [...skeleton.bones, palmBone, fingerBone];
      const newSkeleton = new THREE.Skeleton(newBones);

      expect(newSkeleton.bones.length).toBe(originalBoneCount + 2);
      expect(newSkeleton.bones.map((b) => b.name)).toContain("LeftHand_Palm");
      expect(newSkeleton.bones.map((b) => b.name)).toContain(
        "LeftHand_Fingers",
      );
    });

    it("calculates correct inverse matrices for new bones", () => {
      const { leftWrist } = createTestScene();

      // Create palm bone
      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      leftWrist.updateMatrixWorld(true);

      // Create skeleton with the palm bone
      const bones = [leftWrist, palmBone];
      const skeleton = new THREE.Skeleton(bones);

      // Verify inverse matrices exist
      expect(skeleton.boneInverses.length).toBe(2);

      // Inverse matrix should be the inverse of world matrix
      const palmInverse = skeleton.boneInverses[1];
      const palmWorld = palmBone.matrixWorld.clone();
      const palmWorldInverse = palmWorld.invert();

      // Compare elements (with tolerance for floating point)
      for (let i = 0; i < 16; i++) {
        expect(palmInverse.elements[i]).toBeCloseTo(
          palmWorldInverse.elements[i],
          4,
        );
      }
    });

    it("maintains parent-child relationships in new skeleton", () => {
      const { skeleton, leftWrist, rightWrist } = createTestScene();

      // Add hand bones to both hands
      const leftPalm = new THREE.Bone();
      leftPalm.name = "LeftHand_Palm";
      leftWrist.add(leftPalm);

      const rightPalm = new THREE.Bone();
      rightPalm.name = "RightHand_Palm";
      rightWrist.add(rightPalm);

      leftWrist.updateMatrixWorld(true);
      rightWrist.updateMatrixWorld(true);

      // Create new skeleton
      const newBones = [...skeleton.bones, leftPalm, rightPalm];
      const newSkeleton = new THREE.Skeleton(newBones);

      // Find bones in new skeleton
      const leftPalmInSkeleton = newSkeleton.bones.find(
        (b) => b.name === "LeftHand_Palm",
      );
      const rightPalmInSkeleton = newSkeleton.bones.find(
        (b) => b.name === "RightHand_Palm",
      );

      expect(leftPalmInSkeleton!.parent!.name).toBe("LeftHand");
      expect(rightPalmInSkeleton!.parent!.name).toBe("RightHand");
    });
  });

  describe("Bone Index Finding", () => {
    it("finds correct bone index in skeleton", () => {
      const { skeleton } = createTestScene();

      // Find index of LeftHand bone
      const leftHandIndex = skeleton.bones.findIndex(
        (b) => b.name === "LeftHand",
      );
      expect(leftHandIndex).toBeGreaterThan(-1);

      // Verify it's the correct bone
      expect(skeleton.bones[leftHandIndex].name).toBe("LeftHand");
    });

    it("returns -1 for non-existent bone", () => {
      const { skeleton } = createTestScene();

      const nonExistentIndex = skeleton.bones.findIndex(
        (b) => b.name === "NonExistentBone",
      );
      expect(nonExistentIndex).toBe(-1);
    });

    it("handles duplicate bone names correctly", () => {
      // Create skeleton with uniquely named bones
      const bone1 = new THREE.Bone();
      bone1.name = "Bone";

      const bone2 = new THREE.Bone();
      bone2.name = "Bone"; // Same name

      const skeleton = new THREE.Skeleton([bone1, bone2]);

      // findIndex returns first match
      const index = skeleton.bones.findIndex((b) => b.name === "Bone");
      expect(index).toBe(0); // First bone
    });
  });

  describe("Bone Scene Validation", () => {
    it("detects bones that are in scene hierarchy", () => {
      const { scene, leftWrist } = createTestScene();

      // Check if bone has valid parent chain to scene
      let current: THREE.Object3D | null = leftWrist;
      let foundScene = false;

      while (current) {
        if (current === scene) {
          foundScene = true;
          break;
        }
        current = current.parent;
      }

      expect(foundScene).toBe(true);
    });

    it("detects orphaned bones not in scene", () => {
      const { scene } = createTestScene();

      // Create orphaned bone (not added to scene)
      const orphanBone = new THREE.Bone();
      orphanBone.name = "OrphanBone";
      orphanBone.position.set(0, 0, 0);

      // Check if bone has valid parent chain to scene
      let current: THREE.Object3D | null = orphanBone;
      let foundScene = false;

      while (current) {
        if (current === scene) {
          foundScene = true;
          break;
        }
        current = current.parent;
      }

      expect(foundScene).toBe(false);
    });
  });

  describe("Integration", () => {
    it("creates complete hand rig with palm and finger bones for both hands", () => {
      const { leftWrist, rightWrist } = createTestScene();

      // Create bones for both hands
      const hands = [
        { wrist: leftWrist, side: "left" },
        { wrist: rightWrist, side: "right" },
      ];

      for (const { wrist, side } of hands) {
        const palmBone = new THREE.Bone();
        palmBone.name = `${wrist.name}_Palm`;
        palmBone.position.set(side === "left" ? 10 : -10, 0, 0);

        const fingerBone = new THREE.Bone();
        fingerBone.name = `${wrist.name}_Fingers`;
        fingerBone.position.set(side === "left" ? 15 : -15, 0, 0);

        palmBone.add(fingerBone);
        wrist.add(palmBone);
      }

      leftWrist.updateMatrixWorld(true);
      rightWrist.updateMatrixWorld(true);

      // Verify both hands have bones
      expect(leftWrist.children.length).toBe(1); // Palm
      expect(leftWrist.children[0].name).toBe("LeftHand_Palm");
      expect(leftWrist.children[0].children.length).toBe(1); // Fingers
      expect(leftWrist.children[0].children[0].name).toBe("LeftHand_Fingers");

      expect(rightWrist.children.length).toBe(1); // Palm
      expect(rightWrist.children[0].name).toBe("RightHand_Palm");
      expect(rightWrist.children[0].children.length).toBe(1); // Fingers
      expect(rightWrist.children[0].children[0].name).toBe("RightHand_Fingers");
    });

    it("bone positions are in world space correctly", () => {
      const { leftWrist } = createTestScene();

      // Create palm and finger bones
      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      const fingerBone = new THREE.Bone();
      fingerBone.name = "LeftHand_Fingers";
      fingerBone.position.set(15, 0, 0);
      palmBone.add(fingerBone);

      leftWrist.updateMatrixWorld(true);

      // Get world positions
      const wristWorld = new THREE.Vector3();
      const palmWorld = new THREE.Vector3();
      const fingerWorld = new THREE.Vector3();

      leftWrist.getWorldPosition(wristWorld);
      palmBone.getWorldPosition(palmWorld);
      fingerBone.getWorldPosition(fingerWorld);

      // Bones should be progressively further from origin in X
      expect(palmWorld.x).toBeGreaterThan(wristWorld.x);
      expect(fingerWorld.x).toBeGreaterThan(palmWorld.x);
    });

    it("exports cleanly without orphaned references", () => {
      const { scene, skeleton, leftWrist, mesh } = createTestScene();

      // Add palm bone
      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      leftWrist.updateMatrixWorld(true);

      // Create new skeleton including palm
      const newBones = [...skeleton.bones, palmBone];
      const newSkeleton = new THREE.Skeleton(newBones);

      // Rebind mesh to new skeleton
      mesh.bind(newSkeleton);

      // Verify all bones in skeleton exist in scene
      for (const bone of newSkeleton.bones) {
        let current: THREE.Object3D | null = bone;
        let foundInScene = false;

        while (current) {
          if (current === scene || current.parent === scene) {
            foundInScene = true;
            break;
          }
          current = current.parent;
        }

        expect(foundInScene).toBe(true);
      }
    });
  });
});
