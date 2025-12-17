/**
 * WeaponFittingService Tests
 *
 * Tests for attaching weapons to character hand bones.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone finding failures with different naming conventions
 * - Incorrect weapon positioning on hand attachment
 * - Scale distortion during attachment
 * - Missing bone handling
 * - Export metadata corruption
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { WeaponFittingService } from "../WeaponFittingService";
import type { WeaponAttachmentOptions } from "../WeaponFittingService";
import { createTestMesh } from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a test skeleton with hand bones for weapon attachment testing
 */
function createCharacterSkeletonWithHands(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  scene: THREE.Scene;
  skinnedMesh: THREE.SkinnedMesh;
} {
  const scene = new THREE.Scene();

  // Create bone hierarchy
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.2, 0);
  hipsBone.add(spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 0.2, 0);
  spineBone.add(chestBone);

  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 0.15, 0);
  chestBone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.1, 0);
  neckBone.add(headBone);

  // Right arm chain
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "RightShoulder";
  rightShoulderBone.position.set(0.1, 0, 0);
  chestBone.add(rightShoulderBone);

  const rightUpperArmBone = new THREE.Bone();
  rightUpperArmBone.name = "RightUpperArm";
  rightUpperArmBone.position.set(0.15, 0, 0);
  rightShoulderBone.add(rightUpperArmBone);

  const rightLowerArmBone = new THREE.Bone();
  rightLowerArmBone.name = "RightLowerArm";
  rightLowerArmBone.position.set(0.25, 0, 0);
  rightUpperArmBone.add(rightLowerArmBone);

  const rightHandBone = new THREE.Bone();
  rightHandBone.name = "RightHand";
  rightHandBone.position.set(0.2, 0, 0);
  rightLowerArmBone.add(rightHandBone);

  // Left arm chain
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "LeftShoulder";
  leftShoulderBone.position.set(-0.1, 0, 0);
  chestBone.add(leftShoulderBone);

  const leftUpperArmBone = new THREE.Bone();
  leftUpperArmBone.name = "LeftUpperArm";
  leftUpperArmBone.position.set(-0.15, 0, 0);
  leftShoulderBone.add(leftUpperArmBone);

  const leftLowerArmBone = new THREE.Bone();
  leftLowerArmBone.name = "LeftLowerArm";
  leftLowerArmBone.position.set(-0.25, 0, 0);
  leftUpperArmBone.add(leftLowerArmBone);

  const leftHandBone = new THREE.Bone();
  leftHandBone.name = "LeftHand";
  leftHandBone.position.set(-0.2, 0, 0);
  leftLowerArmBone.add(leftHandBone);

  const bones = [
    hipsBone,
    spineBone,
    chestBone,
    neckBone,
    headBone,
    rightShoulderBone,
    rightUpperArmBone,
    rightLowerArmBone,
    rightHandBone,
    leftShoulderBone,
    leftUpperArmBone,
    leftLowerArmBone,
    leftHandBone,
  ];

  const skeleton = new THREE.Skeleton(bones);

  // Create skinned mesh to hold the skeleton
  const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3, 4, 8, 4);
  const vertexCount = geometry.attributes.position.count;

  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0;
    skinWeights[i * 4] = 1.0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = "CharacterBody";

  skinnedMesh.add(hipsBone);
  skinnedMesh.bind(skeleton);

  scene.add(skinnedMesh);
  scene.updateMatrixWorld(true);

  return { skeleton, rootBone: hipsBone, scene, skinnedMesh };
}

/**
 * Create a character skeleton with Mixamo-style naming
 */
function createMixamoSkeleton(): {
  skeleton: THREE.Skeleton;
  scene: THREE.Scene;
  skinnedMesh: THREE.SkinnedMesh;
} {
  const scene = new THREE.Scene();

  const hipsBone = new THREE.Bone();
  hipsBone.name = "mixamorig:Hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "mixamorig:Spine";
  spineBone.position.set(0, 0.4, 0);
  hipsBone.add(spineBone);

  const rightHandBone = new THREE.Bone();
  rightHandBone.name = "mixamorig:RightHand";
  rightHandBone.position.set(0.6, 0, 0);
  spineBone.add(rightHandBone);

  const leftHandBone = new THREE.Bone();
  leftHandBone.name = "mixamorig:LeftHand";
  leftHandBone.position.set(-0.6, 0, 0);
  spineBone.add(leftHandBone);

  const bones = [hipsBone, spineBone, rightHandBone, leftHandBone];
  const skeleton = new THREE.Skeleton(bones);

  const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3);
  const vertexCount = geometry.attributes.position.count;

  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0;
    skinWeights[i * 4] = 1.0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

  skinnedMesh.add(hipsBone);
  skinnedMesh.bind(skeleton);

  scene.add(skinnedMesh);
  scene.updateMatrixWorld(true);

  return { skeleton, scene, skinnedMesh };
}

/**
 * Create a skeleton without hand bones
 */
function createSkeletonWithoutHands(): {
  skeleton: THREE.Skeleton;
  scene: THREE.Scene;
  skinnedMesh: THREE.SkinnedMesh;
} {
  const scene = new THREE.Scene();

  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.4, 0);
  hipsBone.add(spineBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.5, 0);
  spineBone.add(headBone);

  // Only torso bones - no arms/hands
  const bones = [hipsBone, spineBone, headBone];
  const skeleton = new THREE.Skeleton(bones);

  const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3);
  const vertexCount = geometry.attributes.position.count;

  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0;
    skinWeights[i * 4] = 1.0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

  skinnedMesh.add(hipsBone);
  skinnedMesh.bind(skeleton);

  scene.add(skinnedMesh);
  scene.updateMatrixWorld(true);

  return { skeleton, scene, skinnedMesh };
}

/**
 * Create a simple weapon mesh (sword-like shape)
 */
function createWeaponMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "TestWeapon";

  // Blade
  const bladeGeometry = new THREE.BoxGeometry(0.05, 0.8, 0.01);
  const bladeMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
  const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
  blade.name = "Blade";
  blade.position.set(0, 0.4, 0);

  // Handle
  const handleGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.15);
  const handleMaterial = new THREE.MeshBasicMaterial({ color: 0x8b4513 });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.name = "Handle";
  handle.position.set(0, -0.05, 0);

  group.add(blade);
  group.add(handle);

  return group;
}

describe("WeaponFittingService", () => {
  let fittingService: WeaponFittingService;

  beforeAll(() => {
    fittingService = new WeaponFittingService();
  });

  describe("Bone Finding", () => {
    it("finds hand bone with standard VRM naming (rightHand, leftHand)", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      // The service should find the RightHand bone
      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm", // Pass VRM URL to validate
      );

      expect(result.targetBone).not.toBeNull();
      expect(result.targetBone!.name).toBe("RightHand");
    });

    it("finds hand bone with alternative naming conventions (Hand_R, Hand_L)", () => {
      const scene = new THREE.Scene();

      // Create skeleton with alternative naming
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 1, 0);

      const spineBone = new THREE.Bone();
      spineBone.name = "Spine";
      spineBone.position.set(0, 0.4, 0);
      hipsBone.add(spineBone);

      const handRBone = new THREE.Bone();
      handRBone.name = "Hand_R";
      handRBone.position.set(0.5, 0, 0);
      spineBone.add(handRBone);

      const handLBone = new THREE.Bone();
      handLBone.name = "Hand_L";
      handLBone.position.set(-0.5, 0, 0);
      spineBone.add(handLBone);

      const bones = [hipsBone, spineBone, handRBone, handLBone];
      const skeleton = new THREE.Skeleton(bones);

      const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3);
      const vertexCount = geometry.attributes.position.count;

      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.BufferAttribute(skinWeights, 4),
      );

      const material = new THREE.MeshBasicMaterial();
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

      skinnedMesh.add(hipsBone);
      skinnedMesh.bind(skeleton);
      scene.add(skinnedMesh);
      scene.updateMatrixWorld(true);

      const weapon = createWeaponMesh();
      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "Hand_R" },
        "character.vrm",
      );

      expect(result.targetBone).not.toBeNull();
      expect(result.targetBone!.name).toBe("Hand_R");
    });

    it("finds hand bone with Mixamo naming conventions", () => {
      const { skinnedMesh } = createMixamoSkeleton();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "Hand_R" },
        "character.vrm",
      );

      expect(result.targetBone).not.toBeNull();
      expect(result.targetBone!.name).toBe("mixamorig:RightHand");
    });

    it("returns null targetBone for missing bones", () => {
      const { skinnedMesh } = createSkeletonWithoutHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "Hand_R" },
        "character.vrm",
      );

      expect(result.targetBone).toBeNull();
      expect(result.attachedWeapon).toBeDefined();
    });

    it("performs case-insensitive bone search", () => {
      const scene = new THREE.Scene();

      // Create skeleton with mixed case naming
      const hipsBone = new THREE.Bone();
      hipsBone.name = "HIPS";
      hipsBone.position.set(0, 1, 0);

      const spineBone = new THREE.Bone();
      spineBone.name = "spine";
      spineBone.position.set(0, 0.4, 0);
      hipsBone.add(spineBone);

      const rightHandBone = new THREE.Bone();
      rightHandBone.name = "RIGHTHAND"; // All caps
      rightHandBone.position.set(0.5, 0, 0);
      spineBone.add(rightHandBone);

      const bones = [hipsBone, spineBone, rightHandBone];
      const skeleton = new THREE.Skeleton(bones);

      const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3);
      const vertexCount = geometry.attributes.position.count;

      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.BufferAttribute(skinWeights, 4),
      );

      const material = new THREE.MeshBasicMaterial();
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

      skinnedMesh.add(hipsBone);
      skinnedMesh.bind(skeleton);
      scene.add(skinnedMesh);
      scene.updateMatrixWorld(true);

      const weapon = createWeaponMesh();
      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      expect(result.targetBone).not.toBeNull();
      expect(result.targetBone!.name).toBe("RIGHTHAND");
    });
  });

  describe("Weapon Attachment", () => {
    it("parents weapon to hand bone", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      expect(result.targetBone).not.toBeNull();

      // The weapon wrapper should be a child of the hand bone
      const handBone = result.targetBone!;
      const weaponWrapper = result.attachedWeapon;

      expect(handBone.children).toContain(weaponWrapper);
    });

    it("positions weapon correctly relative to hand", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const weaponWrapper = result.attachedWeapon;

      // Weapon position should be set (not all zeros after offset application)
      expect(result.attachmentMetadata.position).toBeInstanceOf(THREE.Vector3);

      // The Y position should include offset from avatar height calculation
      expect(weaponWrapper.position.y).toBeGreaterThan(0);
    });

    it("applies correct orientation for grip", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Rotation metadata should be captured
      expect(result.attachmentMetadata.rotation).toBeInstanceOf(THREE.Euler);
    });

    it("flips orientation for left hand attachment", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();

      const weaponRight = createWeaponMesh();
      const resultRight = fittingService.attachWeaponToHand(
        weaponRight,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const weaponLeft = createWeaponMesh();
      const resultLeft = fittingService.attachWeaponToHand(
        weaponLeft,
        skinnedMesh,
        { equipmentSlot: "LeftHand" },
        "character.vrm",
      );

      // Left hand should have PI rotation added on Y axis
      const rightRotY = resultRight.attachedWeapon.rotation.y;
      const leftRotY = resultLeft.attachedWeapon.rotation.y;

      expect(Math.abs(leftRotY - rightRotY - Math.PI)).toBeLessThan(0.01);
    });

    it("preserves scale during attachment", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      // Set a specific scale on the weapon
      weapon.scale.set(1.5, 1.5, 1.5);

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // The weapon inside the wrapper should preserve its scale
      const attachedWeapon = result.attachedWeapon.children[0];
      expect(attachedWeapon.scale.x).toBeCloseTo(1.5, 2);
      expect(attachedWeapon.scale.y).toBeCloseTo(1.5, 2);
      expect(attachedWeapon.scale.z).toBeCloseTo(1.5, 2);
    });

    it("applies custom offsets when provided", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const options: WeaponAttachmentOptions = {
        equipmentSlot: "RightHand",
        defaultOffsets: {
          position: { x: 0.1, y: 0.2, z: 0.3 },
          rotation: { x: 0.5, y: 0.6, z: 0.7 },
        },
      };

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        options,
        "character.vrm",
      );

      // Check that custom offsets are applied
      expect(result.attachedWeapon.position.x).toBeCloseTo(0.1, 2);
      expect(result.attachedWeapon.rotation.x).toBeCloseTo(0.5, 2);
      expect(result.attachedWeapon.position.z).toBeCloseTo(0.3, 2);
    });
  });

  describe("Avatar Height Calculation", () => {
    it("calculates correct height from bounding box", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      // The character geometry is 1.7 units tall
      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // The offset distance should be based on avatar height (4.5% of height)
      // Height is ~1.7, so offset should be ~0.0765
      expect(result.attachedWeapon.position.y).toBeGreaterThan(0.05);
      expect(result.attachedWeapon.position.y).toBeLessThan(0.15);
    });

    it("handles different avatar scales", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();

      // Scale the character
      skinnedMesh.scale.set(2, 2, 2);
      skinnedMesh.updateMatrixWorld(true);

      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Larger avatar = larger offset
      // Scaled height is ~3.4, so offset should be ~0.153
      expect(result.attachedWeapon.position.y).toBeGreaterThan(0.1);
    });

    it("uses provided avatarHeight when specified", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        {
          equipmentSlot: "RightHand",
          avatarHeight: 2.0,
        },
        "character.vrm",
      );

      // Offset based on 2.0 height = 0.09
      expect(result.attachedWeapon.position.y).toBeCloseTo(0.09, 1);
    });

    it("returns reasonable values for normalized models", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();

      // Normalize to unit scale
      const box = new THREE.Box3().setFromObject(skinnedMesh);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      skinnedMesh.scale.multiplyScalar(1 / maxDim);
      skinnedMesh.updateMatrixWorld(true);

      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Even for normalized models, offset should be positive
      expect(result.attachedWeapon.position.y).toBeGreaterThan(0);
      expect(result.attachedWeapon.position.y).toBeLessThan(1);
    });
  });

  describe("Weapon Export", () => {
    it("exports with correct metadata structure", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const attachResult = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const exported = fittingService.exportWeaponWithMetadata(
        attachResult.attachedWeapon,
        attachResult.attachmentMetadata,
      );

      // Check userData structure
      expect(exported.userData).toBeDefined();
      expect(exported.userData.hyperscape).toBeDefined();
      expect(exported.userData.hyperscape.vrmBoneName).toBe("rightHand");
      expect(exported.userData.hyperscape.weaponType).toBe("weapon");
      expect(exported.userData.hyperscape.exportedFrom).toBe(
        "hyperforge-weapon-fitting",
      );
    });

    it("preserves attachment point information", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const attachResult = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "LeftHand" },
        "character.vrm",
      );

      const exported = fittingService.exportWeaponWithMetadata(
        attachResult.attachedWeapon,
        attachResult.attachmentMetadata,
      );

      // Should contain attachment slot info
      expect(exported.userData.hyperscape.originalSlot).toBe("LeftHand");
      expect(exported.userData.hyperscape.vrmBoneName).toBe("leftHand");
    });

    it("includes hand bone reference in usage note", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const attachResult = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const exported = fittingService.exportWeaponWithMetadata(
        attachResult.attachedWeapon,
        attachResult.attachmentMetadata,
      );

      // Usage note should reference the VRM bone
      expect(exported.userData.hyperscape.usage).toContain("rightHand");
      expect(exported.userData.hyperscape.note).toContain("rightHand");
    });

    it("includes export timestamp", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const beforeExport = new Date().toISOString();

      const attachResult = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const exported = fittingService.exportWeaponWithMetadata(
        attachResult.attachedWeapon,
        attachResult.attachmentMetadata,
      );

      const afterExport = new Date().toISOString();

      // Timestamp should be in valid ISO format between before and after
      expect(exported.userData.hyperscape.exportedAt).toBeDefined();
      expect(exported.userData.hyperscape.exportedAt >= beforeExport).toBe(
        true,
      );
      expect(exported.userData.hyperscape.exportedAt <= afterExport).toBe(true);
    });

    it("clones weapon to preserve original hierarchy", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const attachResult = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      const exported = fittingService.exportWeaponWithMetadata(
        attachResult.attachedWeapon,
        attachResult.attachmentMetadata,
      );

      // Exported should be a different object (cloned)
      expect(exported).not.toBe(attachResult.attachedWeapon);

      // But should have same structure
      expect(exported.name).toBe("WeaponWrapper");
    });
  });

  describe("Error Handling", () => {
    it("handles missing hand bones gracefully", () => {
      const { skinnedMesh } = createSkeletonWithoutHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Should return result with null targetBone, not throw
      expect(result).toBeDefined();
      expect(result.targetBone).toBeNull();
      expect(result.attachedWeapon).toBeDefined();

      // Metadata should still be populated with defaults
      expect(result.attachmentMetadata.vrmBoneName).toBe("rightHand");
      expect(result.attachmentMetadata.position).toBeInstanceOf(THREE.Vector3);
    });

    it("handles invalid weapon models gracefully", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();

      // Empty group as weapon
      const emptyWeapon = new THREE.Group();

      const result = fittingService.attachWeaponToHand(
        emptyWeapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Should handle empty weapon without crashing
      expect(result).toBeDefined();
      expect(result.attachedWeapon).toBeDefined();
    });

    it("handles empty scenes", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();

      // Create a scene wrapper with the weapon
      const weaponScene = new THREE.Scene();
      weaponScene.name = "WeaponScene";

      const result = fittingService.attachWeaponToHand(
        weaponScene,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Should handle scene object without crashing
      expect(result).toBeDefined();
      expect(result.attachedWeapon).toBeDefined();
    });

    it("throws error for non-VRM character models", () => {
      // Create a non-VRM character (no VRM bones or extension)
      const scene = new THREE.Scene();

      const hipsBone = new THREE.Bone();
      hipsBone.name = "RandomBone1";
      hipsBone.position.set(0, 1, 0);

      const otherBone = new THREE.Bone();
      otherBone.name = "RandomBone2";
      otherBone.position.set(0, 0.4, 0);
      hipsBone.add(otherBone);

      const bones = [hipsBone, otherBone];
      const skeleton = new THREE.Skeleton(bones);

      const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3);
      const vertexCount = geometry.attributes.position.count;

      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.BufferAttribute(skinWeights, 4),
      );

      const material = new THREE.MeshBasicMaterial();
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

      skinnedMesh.add(hipsBone);
      skinnedMesh.bind(skeleton);
      scene.add(skinnedMesh);
      scene.updateMatrixWorld(true);

      const weapon = createWeaponMesh();

      // Should throw because character is not VRM format
      expect(() => {
        fittingService.attachWeaponToHand(weapon, skinnedMesh, {
          equipmentSlot: "RightHand",
        });
      }).toThrow("VRM format");
    });

    it("handles left hand slot variations", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      // Test Hand_L slot
      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "Hand_L" },
        "character.vrm",
      );

      expect(result.targetBone).not.toBeNull();
      expect(result.attachmentMetadata.vrmBoneName).toBe("leftHand");
    });
  });

  describe("World Matrix Updates", () => {
    it("updates world matrices after attachment", () => {
      const { skinnedMesh } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // The attached weapon's world matrix should be valid
      const worldPosition = new THREE.Vector3();
      result.attachedWeapon.getWorldPosition(worldPosition);

      // Should have a valid world position (not NaN)
      expect(isNaN(worldPosition.x)).toBe(false);
      expect(isNaN(worldPosition.y)).toBe(false);
      expect(isNaN(worldPosition.z)).toBe(false);
    });

    it("weapon follows hand bone transforms", () => {
      const { skinnedMesh, skeleton } = createCharacterSkeletonWithHands();
      const weapon = createWeaponMesh();

      const result = fittingService.attachWeaponToHand(
        weapon,
        skinnedMesh,
        { equipmentSlot: "RightHand" },
        "character.vrm",
      );

      // Get initial weapon world position
      const initialPosition = new THREE.Vector3();
      result.attachedWeapon.getWorldPosition(initialPosition);

      // Rotate the hand bone
      const handBone = result.targetBone!;
      handBone.rotation.x = Math.PI / 4;
      skinnedMesh.updateMatrixWorld(true);

      // Get updated weapon world position
      const updatedPosition = new THREE.Vector3();
      result.attachedWeapon.getWorldPosition(updatedPosition);

      // Position should have changed due to bone rotation
      expect(initialPosition.distanceTo(updatedPosition)).toBeGreaterThan(
        0.001,
      );
    });
  });
});
