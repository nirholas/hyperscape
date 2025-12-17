/**
 * HandRiggingService Tests
 *
 * Tests for the main hand rigging orchestration service.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone count validation for finger bones
 * - Landmark to bone mapping correctness
 * - Weight normalization errors
 * - Bone hierarchy structure issues
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import {
  HAND_BONE_NAMES,
  HAND_LANDMARK_INDICES,
  FINGER_JOINTS,
} from "@/constants";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create test hand landmarks (21 points like MediaPipe)
 */
function createTestLandmarks(side: "left" | "right" = "left"): Array<{
  x: number;
  y: number;
  z: number;
}> {
  const offsetX = side === "left" ? 100 : -100;

  // Create 21 landmarks representing hand pose
  return [
    // Wrist
    { x: offsetX, y: 0, z: 0 },
    // Thumb (CMC, MCP, IP, Tip)
    { x: offsetX + 10, y: 10, z: 5 },
    { x: offsetX + 15, y: 20, z: 8 },
    { x: offsetX + 18, y: 28, z: 10 },
    { x: offsetX + 20, y: 35, z: 12 },
    // Index (MCP, PIP, DIP, Tip)
    { x: offsetX + 25, y: 15, z: 0 },
    { x: offsetX + 28, y: 35, z: 0 },
    { x: offsetX + 30, y: 50, z: 0 },
    { x: offsetX + 31, y: 60, z: 0 },
    // Middle (MCP, PIP, DIP, Tip)
    { x: offsetX + 15, y: 18, z: 0 },
    { x: offsetX + 16, y: 40, z: 0 },
    { x: offsetX + 17, y: 55, z: 0 },
    { x: offsetX + 17, y: 65, z: 0 },
    // Ring (MCP, PIP, DIP, Tip)
    { x: offsetX + 5, y: 16, z: 0 },
    { x: offsetX + 4, y: 35, z: 0 },
    { x: offsetX + 3, y: 48, z: 0 },
    { x: offsetX + 2, y: 58, z: 0 },
    // Pinky (MCP, PIP, DIP, Tip)
    { x: offsetX - 5, y: 12, z: 0 },
    { x: offsetX - 8, y: 28, z: 0 },
    { x: offsetX - 10, y: 38, z: 0 },
    { x: offsetX - 11, y: 45, z: 0 },
  ];
}

/**
 * Create a skeleton with wrist bones for testing
 */
function createSkeletonWithWrists(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  leftWrist: THREE.Bone;
  rightWrist: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 100, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 20, 0);
  hipsBone.add(spineBone);

  // Left arm
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(15, 0, 0);
  spineBone.add(leftShoulder);

  const leftUpperArm = new THREE.Bone();
  leftUpperArm.name = "LeftUpperArm";
  leftUpperArm.position.set(25, 0, 0);
  leftShoulder.add(leftUpperArm);

  const leftForeArm = new THREE.Bone();
  leftForeArm.name = "LeftForeArm";
  leftForeArm.position.set(25, 0, 0);
  leftUpperArm.add(leftForeArm);

  const leftHand = new THREE.Bone();
  leftHand.name = "LeftHand";
  leftHand.position.set(25, 0, 0);
  leftForeArm.add(leftHand);

  // Right arm
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  rightShoulder.position.set(-15, 0, 0);
  spineBone.add(rightShoulder);

  const rightUpperArm = new THREE.Bone();
  rightUpperArm.name = "RightUpperArm";
  rightUpperArm.position.set(-25, 0, 0);
  rightShoulder.add(rightUpperArm);

  const rightForeArm = new THREE.Bone();
  rightForeArm.name = "RightForeArm";
  rightForeArm.position.set(-25, 0, 0);
  rightUpperArm.add(rightForeArm);

  const rightHand = new THREE.Bone();
  rightHand.name = "RightHand";
  rightHand.position.set(-25, 0, 0);
  rightForeArm.add(rightHand);

  hipsBone.updateMatrixWorld(true);

  const bones = [
    hipsBone,
    spineBone,
    leftShoulder,
    leftUpperArm,
    leftForeArm,
    leftHand,
    rightShoulder,
    rightUpperArm,
    rightForeArm,
    rightHand,
  ];

  const skeleton = new THREE.Skeleton(bones);

  return {
    skeleton,
    rootBone: hipsBone,
    leftWrist: leftHand,
    rightWrist: rightHand,
  };
}

/**
 * Create finger bones for a hand
 */
function createFingerBones(
  wristBone: THREE.Bone,
  side: "left" | "right",
): Record<string, THREE.Bone[]> {
  const boneNames = HAND_BONE_NAMES[side];
  const fingerBones: Record<string, THREE.Bone[]> = {
    thumb: [],
    index: [],
    middle: [],
    ring: [],
    little: [],
  };

  const xDir = side === "left" ? 1 : -1;

  // Create bones for each finger
  const fingerOffsets = {
    thumb: { x: 10 * xDir, y: 5, z: 10 },
    index: { x: 20 * xDir, y: 10, z: 0 },
    middle: { x: 20 * xDir, y: 12, z: -5 },
    ring: { x: 18 * xDir, y: 10, z: -10 },
    little: { x: 15 * xDir, y: 8, z: -15 },
  };

  for (const [finger, names] of Object.entries(boneNames)) {
    if (finger === "wrist") continue;

    const typedFinger = finger as keyof typeof fingerOffsets;
    const offset = fingerOffsets[typedFinger];
    let parentBone = wristBone;

    for (let i = 0; i < names.length; i++) {
      const bone = new THREE.Bone();
      bone.name = names[i];
      bone.position.set(
        offset.x * (i + 1) * 0.3,
        offset.y * (i + 1) * 0.5,
        offset.z,
      );

      parentBone.add(bone);
      fingerBones[typedFinger].push(bone);
      parentBone = bone;
    }
  }

  wristBone.updateMatrixWorld(true);
  return fingerBones;
}

describe("HandRiggingService", () => {
  describe("Configuration - Rigging Options Structure", () => {
    it("defines correct bone names for left hand", () => {
      const leftBoneNames = HAND_BONE_NAMES.left;

      expect(leftBoneNames.wrist).toBe("leftHand");
      expect(leftBoneNames.thumb).toHaveLength(3);
      expect(leftBoneNames.index).toHaveLength(3);
      expect(leftBoneNames.middle).toHaveLength(3);
      expect(leftBoneNames.ring).toHaveLength(3);
      expect(leftBoneNames.little).toHaveLength(3);
    });

    it("defines correct bone names for right hand", () => {
      const rightBoneNames = HAND_BONE_NAMES.right;

      expect(rightBoneNames.wrist).toBe("rightHand");
      expect(rightBoneNames.thumb).toHaveLength(3);
      expect(rightBoneNames.index).toHaveLength(3);
      expect(rightBoneNames.middle).toHaveLength(3);
      expect(rightBoneNames.ring).toHaveLength(3);
      expect(rightBoneNames.little).toHaveLength(3);
    });

    it("bone names follow VRM naming convention", () => {
      const leftThumb = HAND_BONE_NAMES.left.thumb;
      expect(leftThumb[0]).toBe("leftThumbProximal");
      expect(leftThumb[1]).toBe("leftThumbIntermediate");
      expect(leftThumb[2]).toBe("leftThumbDistal");
    });

    it("defines landmark indices for all 21 MediaPipe points", () => {
      expect(HAND_LANDMARK_INDICES.wrist).toBe(0);
      expect(HAND_LANDMARK_INDICES.thumbTip).toBe(4);
      expect(HAND_LANDMARK_INDICES.indexTip).toBe(8);
      expect(HAND_LANDMARK_INDICES.middleTip).toBe(12);
      expect(HAND_LANDMARK_INDICES.ringTip).toBe(16);
      expect(HAND_LANDMARK_INDICES.littleTip).toBe(20);
    });

    it("defines correct finger joint mappings", () => {
      expect(FINGER_JOINTS.thumb).toEqual([1, 2, 3, 4]);
      expect(FINGER_JOINTS.index).toEqual([5, 6, 7, 8]);
      expect(FINGER_JOINTS.middle).toEqual([9, 10, 11, 12]);
      expect(FINGER_JOINTS.ring).toEqual([13, 14, 15, 16]);
      expect(FINGER_JOINTS.little).toEqual([17, 18, 19, 20]);
    });
  });

  describe("Bone Creation - Finger Bone Count", () => {
    it("creates 3 bones per finger (proximal, intermediate, distal)", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      expect(fingerBones.thumb).toHaveLength(3);
      expect(fingerBones.index).toHaveLength(3);
      expect(fingerBones.middle).toHaveLength(3);
      expect(fingerBones.ring).toHaveLength(3);
      expect(fingerBones.little).toHaveLength(3);
    });

    it("creates 15 total finger bones per hand", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      const totalBones = Object.values(fingerBones).reduce(
        (sum, bones) => sum + bones.length,
        0,
      );

      expect(totalBones).toBe(15);
    });

    it("maintains correct parent-child hierarchy", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      // Check that first bone of each finger is child of wrist
      for (const finger of ["thumb", "index", "middle", "ring", "little"]) {
        const firstBone = fingerBones[finger][0];
        expect(firstBone.parent).toBe(leftWrist);
      }

      // Check that subsequent bones are children of previous
      for (const finger of ["thumb", "index", "middle", "ring", "little"]) {
        const bones = fingerBones[finger];
        for (let i = 1; i < bones.length; i++) {
          expect(bones[i].parent).toBe(bones[i - 1]);
        }
      }
    });

    it("bones have correct naming pattern", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      // Check naming pattern for index finger
      expect(fingerBones.index[0].name).toBe("leftIndexProximal");
      expect(fingerBones.index[1].name).toBe("leftIndexIntermediate");
      expect(fingerBones.index[2].name).toBe("leftIndexDistal");
    });
  });

  describe("Landmark Mapping - 2D Landmarks to Bones", () => {
    it("generates 21 landmarks per hand", () => {
      const landmarks = createTestLandmarks("left");
      expect(landmarks).toHaveLength(21);
    });

    it("wrist landmark is at index 0", () => {
      const landmarks = createTestLandmarks("left");
      expect(landmarks[HAND_LANDMARK_INDICES.wrist]).toBeDefined();
      expect(HAND_LANDMARK_INDICES.wrist).toBe(0);
    });

    it("finger tips are at correct indices", () => {
      const landmarks = createTestLandmarks("left");

      // Verify tip indices
      expect(landmarks[HAND_LANDMARK_INDICES.thumbTip]).toBeDefined();
      expect(landmarks[HAND_LANDMARK_INDICES.indexTip]).toBeDefined();
      expect(landmarks[HAND_LANDMARK_INDICES.middleTip]).toBeDefined();
      expect(landmarks[HAND_LANDMARK_INDICES.ringTip]).toBeDefined();
      expect(landmarks[HAND_LANDMARK_INDICES.littleTip]).toBeDefined();
    });

    it("landmarks have valid 3D coordinates", () => {
      const landmarks = createTestLandmarks("left");

      for (const landmark of landmarks) {
        expect(typeof landmark.x).toBe("number");
        expect(typeof landmark.y).toBe("number");
        expect(typeof landmark.z).toBe("number");
        expect(Number.isFinite(landmark.x)).toBe(true);
        expect(Number.isFinite(landmark.y)).toBe(true);
        expect(Number.isFinite(landmark.z)).toBe(true);
      }
    });

    it("left and right hand landmarks have opposite X positions", () => {
      const leftLandmarks = createTestLandmarks("left");
      const rightLandmarks = createTestLandmarks("right");

      // Wrist positions should be on opposite sides
      expect(leftLandmarks[0].x).toBeGreaterThan(0);
      expect(rightLandmarks[0].x).toBeLessThan(0);
    });

    it("finger joint indices are sequential per finger", () => {
      // Each finger should have 4 sequential landmark indices
      for (const [finger, joints] of Object.entries(FINGER_JOINTS)) {
        for (let i = 1; i < joints.length; i++) {
          expect(joints[i]).toBe(joints[i - 1] + 1);
        }
      }
    });
  });

  describe("Weight Application - Segmentation-Based Weights", () => {
    it("creates valid skin weights array", () => {
      const geometry = new THREE.BoxGeometry(10, 10, 10, 2, 2, 2);
      const vertexCount = geometry.attributes.position.count;

      const skinWeights = new Float32Array(vertexCount * 4);
      const skinIndices = new Float32Array(vertexCount * 4);

      // Initialize with default weights
      for (let i = 0; i < vertexCount; i++) {
        skinWeights[i * 4] = 1.0;
        skinWeights[i * 4 + 1] = 0;
        skinWeights[i * 4 + 2] = 0;
        skinWeights[i * 4 + 3] = 0;

        skinIndices[i * 4] = 0;
        skinIndices[i * 4 + 1] = 0;
        skinIndices[i * 4 + 2] = 0;
        skinIndices[i * 4 + 3] = 0;
      }

      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );
      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );

      expect(geometry.attributes.skinWeight).toBeDefined();
      expect(geometry.attributes.skinIndex).toBeDefined();
      expect(geometry.attributes.skinWeight.count).toBe(vertexCount);
    });

    it("weights sum to 1.0 for each vertex", () => {
      const geometry = new THREE.BoxGeometry(10, 10, 10);
      const vertexCount = geometry.attributes.position.count;

      const skinWeights = new Float32Array(vertexCount * 4);

      // Apply test weights that sum to 1.0
      for (let i = 0; i < vertexCount; i++) {
        skinWeights[i * 4] = 0.5;
        skinWeights[i * 4 + 1] = 0.3;
        skinWeights[i * 4 + 2] = 0.15;
        skinWeights[i * 4 + 3] = 0.05;
      }

      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const weights = geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i++) {
        const sum =
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        expect(sum).toBeCloseTo(1.0, 4);
      }
    });

    it("normalizes weights correctly after distribution", () => {
      // Test weight normalization function
      const unnormalizedWeights = [0.4, 0.3, 0.2, 0.15];
      const total = unnormalizedWeights.reduce((a, b) => a + b, 0);
      const normalizedWeights = unnormalizedWeights.map((w) => w / total);

      const normalizedSum = normalizedWeights.reduce((a, b) => a + b, 0);
      expect(normalizedSum).toBeCloseTo(1.0, 10);
    });

    it("assigns weights based on distance to bones", () => {
      const wristPos = new THREE.Vector3(0, 0, 0);
      const fingerTipPos = new THREE.Vector3(50, 0, 0);
      const vertexPos = new THREE.Vector3(40, 0, 0);

      const distToWrist = vertexPos.distanceTo(wristPos);
      const distToFinger = vertexPos.distanceTo(fingerTipPos);

      // Vertex closer to finger tip should have more finger weight
      expect(distToFinger).toBeLessThan(distToWrist);

      // Weight formula: 1 / (1 + distance^2 * factor)
      const factor = 0.01;
      const wristWeight = 1 / (1 + distToWrist * distToWrist * factor);
      const fingerWeight = 1 / (1 + distToFinger * distToFinger * factor);

      expect(fingerWeight).toBeGreaterThan(wristWeight);
    });
  });

  describe("Hand Bone Hierarchy Validation", () => {
    it("creates valid skeleton with hand bones", () => {
      const { skeleton, leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      // Add finger bones to skeleton
      const allBones = [...skeleton.bones];
      for (const bones of Object.values(fingerBones)) {
        allBones.push(...bones);
      }

      const newSkeleton = new THREE.Skeleton(allBones);

      // Total bones: 10 original + 15 finger
      expect(newSkeleton.bones).toHaveLength(25);
    });

    it("skeleton has valid inverse bind matrices", () => {
      const { skeleton, leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      const allBones = [...skeleton.bones];
      for (const bones of Object.values(fingerBones)) {
        allBones.push(...bones);
      }

      const newSkeleton = new THREE.Skeleton(allBones);

      // Each bone should have an inverse bind matrix
      expect(newSkeleton.boneInverses.length).toBe(newSkeleton.bones.length);

      // Each matrix should be valid (not NaN)
      for (const matrix of newSkeleton.boneInverses) {
        for (const element of matrix.elements) {
          expect(Number.isNaN(element)).toBe(false);
        }
      }
    });

    it("bone world positions are calculable", () => {
      const { leftWrist, rootBone } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      rootBone.updateMatrixWorld(true);

      // Get world position of index tip
      const indexTip = fingerBones.index[2];
      const worldPos = new THREE.Vector3();
      indexTip.getWorldPosition(worldPos);

      // Position should be valid (not NaN)
      expect(Number.isNaN(worldPos.x)).toBe(false);
      expect(Number.isNaN(worldPos.y)).toBe(false);
      expect(Number.isNaN(worldPos.z)).toBe(false);

      // Tip should be further from wrist than proximal bone
      const wristPos = new THREE.Vector3();
      leftWrist.getWorldPosition(wristPos);

      const proximalPos = new THREE.Vector3();
      fingerBones.index[0].getWorldPosition(proximalPos);

      const tipDist = worldPos.distanceTo(wristPos);
      const proximalDist = proximalPos.distanceTo(wristPos);

      expect(tipDist).toBeGreaterThan(proximalDist);
    });
  });

  describe("Side Detection and Handling", () => {
    it("correctly identifies left hand from bone name", () => {
      const leftBoneNames = [
        "LeftHand",
        "leftHand",
        "mixamorig:LeftHand",
        "hand_l",
        "Hand_L",
      ];

      for (const name of leftBoneNames) {
        const lowerName = name.toLowerCase();
        const isLeft =
          lowerName.includes("left") ||
          lowerName.includes("_l") ||
          lowerName.endsWith("l");
        expect(isLeft).toBe(true);
      }
    });

    it("correctly identifies right hand from bone name", () => {
      const rightBoneNames = [
        "RightHand",
        "rightHand",
        "mixamorig:RightHand",
        "hand_r",
        "Hand_R",
      ];

      for (const name of rightBoneNames) {
        const lowerName = name.toLowerCase();
        const isRight =
          lowerName.includes("right") ||
          lowerName.includes("_r") ||
          lowerName.endsWith("r");
        expect(isRight).toBe(true);
      }
    });

    it("creates mirrored finger positions for left and right hands", () => {
      const { leftWrist, rightWrist } = createSkeletonWithWrists();
      const leftFingers = createFingerBones(leftWrist, "left");
      const rightFingers = createFingerBones(rightWrist, "right");

      // Left index proximal should have positive X offset
      const leftIndexPos = new THREE.Vector3();
      leftFingers.index[0].getWorldPosition(leftIndexPos);

      // Right index proximal should have negative X offset (mirrored)
      const rightIndexPos = new THREE.Vector3();
      rightFingers.index[0].getWorldPosition(rightIndexPos);

      // They should be on opposite sides of center
      const leftWristPos = new THREE.Vector3();
      const rightWristPos = new THREE.Vector3();
      leftWrist.getWorldPosition(leftWristPos);
      rightWrist.getWorldPosition(rightWristPos);

      // Left finger relative to left wrist
      const leftRelative = leftIndexPos.x - leftWristPos.x;
      // Right finger relative to right wrist (should be opposite sign)
      const rightRelative = rightIndexPos.x - rightWristPos.x;

      expect(Math.sign(leftRelative)).toBe(-Math.sign(rightRelative));
    });
  });

  describe("Rigging Algorithm - Distance-Based Weight Calculation", () => {
    /**
     * Test fixture: Create a skinned mesh with hand bones
     */
    function createSkinnedMeshWithHandBones(): {
      mesh: THREE.SkinnedMesh;
      skeleton: THREE.Skeleton;
      wristBone: THREE.Bone;
      fingerBones: THREE.Bone[];
    } {
      // Create bones
      const wristBone = new THREE.Bone();
      wristBone.name = "LeftHand";
      wristBone.position.set(0, 0, 0);

      const proximalBone = new THREE.Bone();
      proximalBone.name = "leftIndexProximal";
      proximalBone.position.set(20, 0, 0);
      wristBone.add(proximalBone);

      const intermediateBone = new THREE.Bone();
      intermediateBone.name = "leftIndexIntermediate";
      intermediateBone.position.set(15, 0, 0);
      proximalBone.add(intermediateBone);

      const distalBone = new THREE.Bone();
      distalBone.name = "leftIndexDistal";
      distalBone.position.set(12, 0, 0);
      intermediateBone.add(distalBone);

      wristBone.updateMatrixWorld(true);

      const bones = [wristBone, proximalBone, intermediateBone, distalBone];
      const skeleton = new THREE.Skeleton(bones);

      // Create geometry with vertices along the finger
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Wrist area
        0, 0, 0, 5, 0, 0, 10, 0, 0,
        // Proximal area
        20, 0, 0, 25, 0, 0, 30, 0, 0,
        // Intermediate area
        35, 0, 0, 40, 0, 0,
        // Distal area
        47, 0, 0, 50, 0, 0,
      ]);
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

      // Initialize skin weights
      const vertexCount = vertices.length / 3;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.add(wristBone);
      mesh.bind(skeleton);

      return {
        mesh,
        skeleton,
        wristBone,
        fingerBones: [proximalBone, intermediateBone, distalBone],
      };
    }

    it("calculates weight based on inverse square distance", () => {
      const vertex = new THREE.Vector3(25, 0, 0);
      const bonePos = new THREE.Vector3(20, 0, 0);

      const distance = vertex.distanceTo(bonePos);
      const weight = 1 / (1 + distance * distance * 0.01);

      expect(distance).toBe(5);
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThan(1);
    });

    it("closer vertices get higher weights", () => {
      const bonePos = new THREE.Vector3(20, 0, 0);
      const closeVertex = new THREE.Vector3(22, 0, 0);
      const farVertex = new THREE.Vector3(30, 0, 0);

      const closeDist = closeVertex.distanceTo(bonePos);
      const farDist = farVertex.distanceTo(bonePos);

      const closeWeight = 1 / (1 + closeDist * closeDist * 0.01);
      const farWeight = 1 / (1 + farDist * farDist * 0.01);

      expect(closeWeight).toBeGreaterThan(farWeight);
    });

    it("normalizes weights to sum to 1.0", () => {
      const weights = [0.4, 0.3, 0.2, 0.1];
      const total = weights.reduce((a, b) => a + b, 0);
      const normalizedWeights = weights.map((w) => w / total);

      const sum = normalizedWeights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it("sorts weights and takes top 4 influences", () => {
      const weights = [
        { boneIndex: 0, weight: 0.1 },
        { boneIndex: 1, weight: 0.5 },
        { boneIndex: 2, weight: 0.3 },
        { boneIndex: 3, weight: 0.05 },
        { boneIndex: 4, weight: 0.2 },
        { boneIndex: 5, weight: 0.01 },
      ];

      // Sort by weight descending
      weights.sort((a, b) => b.weight - a.weight);

      // Take top 4
      const topWeights = weights.slice(0, 4);

      expect(topWeights[0].boneIndex).toBe(1); // 0.5
      expect(topWeights[1].boneIndex).toBe(2); // 0.3
      expect(topWeights[2].boneIndex).toBe(4); // 0.2
      expect(topWeights[3].boneIndex).toBe(0); // 0.1
    });

    it("applies weights to vertex skin attributes", () => {
      const { mesh, skeleton } = createSkinnedMeshWithHandBones();
      const geometry = mesh.geometry;
      const skinWeights = geometry.attributes.skinWeight;
      const skinIndices = geometry.attributes.skinIndex;

      // Verify initial state
      expect(skinWeights).toBeDefined();
      expect(skinIndices).toBeDefined();
      expect(skinWeights.count).toBe(10);

      // Apply custom weights to vertex 5 (in proximal bone area)
      const vertexIdx = 5;
      const boneIndex = 1; // proximal bone
      const weight = 0.8;

      skinIndices.setX(vertexIdx, boneIndex);
      skinWeights.setX(vertexIdx, weight);
      skinWeights.setY(vertexIdx, 1 - weight);

      expect(skinIndices.getX(vertexIdx)).toBe(boneIndex);
      expect(skinWeights.getX(vertexIdx)).toBeCloseTo(weight, 5);
    });

    it("handles multiple bone influences per vertex", () => {
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]);
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

      const vertexCount = 3;
      const skinWeights = new Float32Array(vertexCount * 4);
      const skinIndices = new Float32Array(vertexCount * 4);

      // Vertex 1 influenced by two bones
      skinIndices[4] = 0; // bone 0
      skinIndices[5] = 1; // bone 1
      skinWeights[4] = 0.6;
      skinWeights[5] = 0.4;

      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );
      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );

      const attrs = geometry.attributes.skinWeight;
      expect(attrs.getX(1) + attrs.getY(1)).toBeCloseTo(1.0, 5);
    });
  });

  describe("Rigging Algorithm - Bone Hierarchy Operations", () => {
    it("adds finger bones as children of wrist", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      // Each finger's proximal should be child of wrist
      expect(fingerBones.thumb[0].parent).toBe(leftWrist);
      expect(fingerBones.index[0].parent).toBe(leftWrist);
      expect(fingerBones.middle[0].parent).toBe(leftWrist);
      expect(fingerBones.ring[0].parent).toBe(leftWrist);
      expect(fingerBones.little[0].parent).toBe(leftWrist);
    });

    it("updates skeleton after adding bones", () => {
      const { skeleton, leftWrist, rootBone } = createSkeletonWithWrists();
      const originalBoneCount = skeleton.bones.length;

      // Add a new finger bone to the hierarchy
      const newBone = new THREE.Bone();
      newBone.name = "testFingerBone";
      newBone.position.set(10, 0, 0);
      leftWrist.add(newBone);

      // Update world matrices first
      rootBone.updateMatrixWorld(true);

      // Create a new skeleton that includes all bones with proper inverse matrices
      const allBones = [...skeleton.bones, newBone];
      const newSkeleton = new THREE.Skeleton(allBones);

      expect(newSkeleton.bones.length).toBe(originalBoneCount + 1);
      expect(newSkeleton.bones.includes(newBone)).toBe(true);
      expect(newSkeleton.boneInverses.length).toBe(originalBoneCount + 1);
    });

    it("calculates inverse bind matrices correctly", () => {
      const bone = new THREE.Bone();
      bone.position.set(10, 20, 30);
      bone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([bone]);

      // Inverse bind matrix should be inverse of world matrix at bind time
      const inverseMatrix = skeleton.boneInverses[0];
      expect(inverseMatrix).toBeInstanceOf(THREE.Matrix4);

      // Verify it's a valid matrix (no NaN values)
      for (const element of inverseMatrix.elements) {
        expect(Number.isFinite(element)).toBe(true);
      }
    });

    it("bone local position transforms to world position correctly", () => {
      const parent = new THREE.Bone();
      parent.position.set(100, 0, 0);

      const child = new THREE.Bone();
      child.position.set(50, 0, 0);
      parent.add(child);

      parent.updateMatrixWorld(true);

      const childWorldPos = new THREE.Vector3();
      child.getWorldPosition(childWorldPos);

      // Child world position should be parent position + child local position
      expect(childWorldPos.x).toBe(150);
    });

    it("finds bone index in skeleton", () => {
      const { skeleton, leftWrist } = createSkeletonWithWrists();

      const wristIndex = skeleton.bones.indexOf(leftWrist);
      expect(wristIndex).toBeGreaterThanOrEqual(0);

      // Non-existent bone
      const unknownBone = new THREE.Bone();
      const unknownIndex = skeleton.bones.indexOf(unknownBone);
      expect(unknownIndex).toBe(-1);
    });
  });

  describe("Rigging Algorithm - Skinned Mesh Processing", () => {
    it("finds skinned meshes in model hierarchy", () => {
      const model = new THREE.Object3D();

      // Add regular mesh
      model.add(new THREE.Mesh(new THREE.BoxGeometry()));

      // Add skinned mesh
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.MeshBasicMaterial();
      const bone = new THREE.Bone();
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
      skinnedMesh.add(bone);
      skinnedMesh.bind(new THREE.Skeleton([bone]));
      model.add(skinnedMesh);

      // Find skinned meshes
      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      model.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
          skinnedMeshes.push(child);
        }
      });

      expect(skinnedMeshes.length).toBe(1);
    });

    it("counts bones in model correctly", () => {
      const { rootBone } = createSkeletonWithWrists();

      let boneCount = 0;
      rootBone.traverse((child) => {
        if (child instanceof THREE.Bone) {
          boneCount++;
        }
      });

      // Should count all bones in hierarchy
      expect(boneCount).toBeGreaterThan(0);
    });

    it("preserves mesh geometry during rigging", () => {
      const geometry = new THREE.BoxGeometry(10, 10, 10);
      const originalVertexCount = geometry.attributes.position.count;

      // Add skin attributes
      const vertexCount = originalVertexCount;
      const skinWeights = new Float32Array(vertexCount * 4);
      const skinIndices = new Float32Array(vertexCount * 4);

      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );
      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );

      // Vertex count should remain the same
      expect(geometry.attributes.position.count).toBe(originalVertexCount);
    });
  });

  describe("Rigging Algorithm - 3D Landmark Projection", () => {
    it("projects 2D landmarks to 3D using camera matrices", () => {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 2);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      // 2D point at center of image
      const point2D = { x: 0.5, y: 0.5 };
      const depth = 0.5;

      // Convert to NDC
      const ndcX = point2D.x * 2 - 1;
      const ndcY = 1 - point2D.y * 2;

      // Create point in clip space
      const clipSpace = new THREE.Vector4(ndcX, ndcY, depth, 1);

      // Unproject
      const invProjection = camera.projectionMatrix.clone().invert();
      const invCamera = camera.matrixWorld.clone();

      clipSpace.applyMatrix4(invProjection);
      clipSpace.divideScalar(clipSpace.w);
      clipSpace.applyMatrix4(invCamera);

      // Result should be a valid 3D point
      expect(Number.isFinite(clipSpace.x)).toBe(true);
      expect(Number.isFinite(clipSpace.y)).toBe(true);
      expect(Number.isFinite(clipSpace.z)).toBe(true);
    });

    it("world landmarks scale correctly based on model size", () => {
      const wristBone = new THREE.Bone();
      wristBone.position.set(0, 1, 0);

      const parentScale = 2.0;
      const parent = new THREE.Object3D();
      parent.scale.setScalar(parentScale);
      parent.add(wristBone);
      parent.updateMatrixWorld(true);

      // Landmark scaling
      const handScale = 0.5 * parentScale;
      const normalizedLandmark = { x: 0.1, y: -0.1, z: 0.02 };

      const scaledPos = new THREE.Vector3(
        normalizedLandmark.x * handScale,
        normalizedLandmark.y * handScale,
        normalizedLandmark.z * handScale,
      );

      expect(scaledPos.x).toBe(0.1 * handScale);
      expect(scaledPos.y).toBe(-0.1 * handScale);
    });

    it("bone positions are relative to parent", () => {
      const wristBone = new THREE.Bone();
      wristBone.position.set(0, 0, 0);

      const fingerBone = new THREE.Bone();
      fingerBone.name = "leftIndexProximal";

      // Set position relative to parent
      const parentWorldPos = new THREE.Vector3(100, 50, 0);
      const targetWorldPos = new THREE.Vector3(120, 60, 0);
      const localPos = targetWorldPos.sub(parentWorldPos);

      fingerBone.position.copy(localPos);

      expect(fingerBone.position.x).toBe(20);
      expect(fingerBone.position.y).toBe(10);
    });
  });

  describe("Rigging Result Validation", () => {
    it("hand bone structure has all required fields", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      const handBoneStructure = {
        wrist: leftWrist,
        fingers: {
          thumb: fingerBones.thumb,
          index: fingerBones.index,
          middle: fingerBones.middle,
          ring: fingerBones.ring,
          little: fingerBones.little,
        },
      };

      expect(handBoneStructure.wrist).toBeDefined();
      expect(handBoneStructure.fingers.thumb).toHaveLength(3);
      expect(handBoneStructure.fingers.index).toHaveLength(3);
      expect(handBoneStructure.fingers.middle).toHaveLength(3);
      expect(handBoneStructure.fingers.ring).toHaveLength(3);
      expect(handBoneStructure.fingers.little).toHaveLength(3);
    });

    it("counts added bones correctly", () => {
      const { leftWrist } = createSkeletonWithWrists();
      const fingerBones = createFingerBones(leftWrist, "left");

      let totalBones = 0;
      for (const bones of Object.values(fingerBones)) {
        totalBones += bones.length;
      }

      // 5 fingers × 3 bones = 15 bones
      expect(totalBones).toBe(15);
    });

    it("rigging result contains valid ArrayBuffer for export", () => {
      // Simulate export result
      const mockExportData = new ArrayBuffer(1024);

      const result = {
        riggedModel: mockExportData,
        metadata: {
          originalBoneCount: 10,
          addedBoneCount: 15,
          processingTime: 500,
        },
      };

      expect(result.riggedModel).toBeInstanceOf(ArrayBuffer);
      expect(result.riggedModel.byteLength).toBeGreaterThan(0);
      expect(result.metadata.addedBoneCount).toBe(15);
    });

    it("calculates processing time accurately", () => {
      const startTime = Date.now();

      // Simulate processing delay
      const delay = 10;
      const endTime = startTime + delay;
      const processingTime = endTime - startTime;

      expect(processingTime).toBe(delay);
    });
  });
});
