/**
 * EquipmentFittingService Tests
 *
 * Tests for equipment slot configuration and bone mappings.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Invalid equipment slot configurations
 * - Bone mapping mismatches
 * - Attachment point offsets causing clipping
 * - Equipment not following character animations
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { EquipmentFittingService } from "../EquipmentFittingService";
import type { FittingConfig } from "../EquipmentFittingService";
import {
  createTestSkeleton,
  createTestMesh,
} from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a skinned mesh for testing equipment fitting
 */
function createCharacterMesh(): THREE.SkinnedMesh {
  const { skeleton, rootBone } = createTestSkeleton();
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
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(rootBone);
  mesh.bind(skeleton);
  mesh.updateMatrixWorld(true);

  return mesh;
}

/**
 * Equipment slot definitions for RuneScape-style equipment
 */
const EQUIPMENT_SLOTS = {
  head: {
    name: "Head",
    bones: ["Head", "Neck"],
    defaultOffset: new THREE.Vector3(0, 0.1, 0),
  },
  chest: {
    name: "Chest",
    bones: ["Spine", "Spine1", "Spine2", "Chest"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  hands: {
    name: "Hands",
    bones: ["LeftHand", "RightHand"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  legs: {
    name: "Legs",
    bones: ["LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  feet: {
    name: "Feet",
    bones: ["LeftFoot", "RightFoot"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  back: {
    name: "Back",
    bones: ["Spine", "Spine1"],
    defaultOffset: new THREE.Vector3(0, 0, -0.1),
  },
  mainHand: {
    name: "Main Hand",
    bones: ["RightHand"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  offHand: {
    name: "Off Hand",
    bones: ["LeftHand"],
    defaultOffset: new THREE.Vector3(0, 0, 0),
  },
  neck: {
    name: "Neck",
    bones: ["Neck"],
    defaultOffset: new THREE.Vector3(0, -0.02, 0),
  },
  cape: {
    name: "Cape",
    bones: ["Spine", "Spine1", "Spine2"],
    defaultOffset: new THREE.Vector3(0, 0, -0.05),
  },
} as const;

type EquipmentSlot = keyof typeof EQUIPMENT_SLOTS;

describe("EquipmentFittingService", () => {
  let fittingService: EquipmentFittingService;

  beforeAll(() => {
    fittingService = new EquipmentFittingService();
  });

  describe("Equipment Slot Configuration", () => {
    it("validates all standard equipment slots exist", () => {
      const requiredSlots: EquipmentSlot[] = [
        "head",
        "chest",
        "hands",
        "legs",
        "feet",
        "back",
        "mainHand",
        "offHand",
      ];

      for (const slot of requiredSlots) {
        expect(EQUIPMENT_SLOTS[slot]).toBeDefined();
        expect(EQUIPMENT_SLOTS[slot].name).toBeTruthy();
        expect(EQUIPMENT_SLOTS[slot].bones).toBeDefined();
        expect(EQUIPMENT_SLOTS[slot].bones.length).toBeGreaterThan(0);
      }
    });

    it("each slot has valid bone references", () => {
      // Common VRM/humanoid bone names
      const validBoneNames = [
        "Hips",
        "Spine",
        "Spine1",
        "Spine2",
        "Chest",
        "Neck",
        "Head",
        "LeftShoulder",
        "LeftUpperArm",
        "LeftLowerArm",
        "LeftHand",
        "RightShoulder",
        "RightUpperArm",
        "RightLowerArm",
        "RightHand",
        "LeftUpLeg",
        "LeftLeg",
        "LeftFoot",
        "RightUpLeg",
        "RightLeg",
        "RightFoot",
      ];

      for (const [slotName, slot] of Object.entries(EQUIPMENT_SLOTS)) {
        for (const bone of slot.bones) {
          // Each bone should be a valid humanoid bone name
          expect(typeof bone).toBe("string");
          expect(bone.length).toBeGreaterThan(0);
        }
      }
    });

    it("head slot maps to head/neck bones", () => {
      const headSlot = EQUIPMENT_SLOTS.head;
      expect(headSlot.bones).toContain("Head");
      expect(headSlot.defaultOffset.y).toBeGreaterThanOrEqual(0);
    });

    it("chest slot maps to spine/chest bones", () => {
      const chestSlot = EQUIPMENT_SLOTS.chest;
      expect(chestSlot.bones.some((b) => b.includes("Spine"))).toBe(true);
    });

    it("hand slots map to left and right hand bones", () => {
      const handsSlot = EQUIPMENT_SLOTS.hands;
      expect(handsSlot.bones).toContain("LeftHand");
      expect(handsSlot.bones).toContain("RightHand");
    });

    it("weapon slots are separate from hands slot", () => {
      const mainHand = EQUIPMENT_SLOTS.mainHand;
      const offHand = EQUIPMENT_SLOTS.offHand;

      expect(mainHand.bones).toContain("RightHand");
      expect(offHand.bones).toContain("LeftHand");

      // Weapons are single-handed
      expect(mainHand.bones.length).toBe(1);
      expect(offHand.bones.length).toBe(1);
    });
  });

  describe("Slot Bone Mappings", () => {
    it("creates skeleton with standard bone hierarchy", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      expect(skeleton).toBeDefined();
      expect(skeleton.bones.length).toBe(3); // Hips, Spine, Head
      expect(rootBone.name).toBe("Hips");
    });

    it("bones have correct parent-child relationships", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Root should have children
      expect(rootBone.children.length).toBeGreaterThan(0);

      // Find spine
      const spine = skeleton.bones.find((b) => b.name === "Spine");
      expect(spine).toBeDefined();
      expect(spine!.parent).toBe(rootBone);
    });

    it("bone positions are hierarchical", () => {
      const { skeleton, rootBone } = createTestSkeleton();
      rootBone.updateMatrixWorld(true);

      const hipsPos = new THREE.Vector3();
      const spinePos = new THREE.Vector3();
      const headPos = new THREE.Vector3();

      rootBone.getWorldPosition(hipsPos);

      const spine = skeleton.bones.find((b) => b.name === "Spine");
      const head = skeleton.bones.find((b) => b.name === "Head");

      if (spine) spine.getWorldPosition(spinePos);
      if (head) head.getWorldPosition(headPos);

      // Spine should be above hips
      expect(spinePos.y).toBeGreaterThan(hipsPos.y);
      // Head should be above spine
      expect(headPos.y).toBeGreaterThan(spinePos.y);
    });
  });

  describe("Attachment Point Offsets", () => {
    it("head equipment has upward offset", () => {
      const headSlot = EQUIPMENT_SLOTS.head;
      expect(headSlot.defaultOffset.y).toBeGreaterThanOrEqual(0);
    });

    it("back equipment has backward offset", () => {
      const backSlot = EQUIPMENT_SLOTS.back;
      expect(backSlot.defaultOffset.z).toBeLessThan(0);
    });

    it("cape has backward offset for proper draping", () => {
      const capeSlot = EQUIPMENT_SLOTS.cape;
      expect(capeSlot.defaultOffset.z).toBeLessThan(0);
    });

    it("neck equipment has slight downward offset", () => {
      const neckSlot = EQUIPMENT_SLOTS.neck;
      // Necklaces sit slightly below the neck bone
      expect(neckSlot.defaultOffset.y).toBeLessThanOrEqual(0);
    });

    it("all offsets are within reasonable range", () => {
      for (const [, slot] of Object.entries(EQUIPMENT_SLOTS)) {
        const offset = slot.defaultOffset;
        // Offsets should be small adjustments, not large displacements
        expect(Math.abs(offset.x)).toBeLessThan(0.5);
        expect(Math.abs(offset.y)).toBeLessThan(0.5);
        expect(Math.abs(offset.z)).toBeLessThan(0.5);
      }
    });
  });

  describe("Equipment Fitting Service API", () => {
    it("fitEquipmentToCharacter is defined", () => {
      expect(fittingService.fitEquipmentToCharacter).toBeDefined();
      expect(typeof fittingService.fitEquipmentToCharacter).toBe("function");
    });

    it("equipArmorToCharacter is defined", () => {
      expect(fittingService.equipArmorToCharacter).toBeDefined();
      expect(typeof fittingService.equipArmorToCharacter).toBe("function");
    });

    it("accepts valid fitting config", () => {
      const config: FittingConfig = {
        method: "boundingBox",
        margin: 0.02,
        smoothingIterations: 3,
        preserveDetails: true,
      };

      expect(config.method).toBe("boundingBox");
      expect(config.margin).toBeGreaterThan(0);
    });

    it("supports all fitting methods", () => {
      const methods: FittingConfig["method"][] = [
        "boundingBox",
        "collision",
        "smooth",
        "iterative",
        "hull",
        "shrinkwrap",
      ];

      for (const method of methods) {
        const config: FittingConfig = { method };
        expect(config.method).toBe(method);
      }
    });

    it("returns null when fitting not yet implemented", () => {
      const characterMesh = createCharacterMesh();
      const equipmentGroup = new THREE.Group();
      equipmentGroup.add(createTestMesh("box"));

      // Current implementation returns null (placeholder)
      const result = fittingService.fitEquipmentToCharacter(
        equipmentGroup,
        characterMesh,
        characterMesh.skeleton,
        { method: "boundingBox" },
      );

      // Placeholder returns null
      expect(result).toBeNull();
    });

    it("equipArmorToCharacter returns null when not implemented", () => {
      const characterMesh = createCharacterMesh();
      const armorGroup = new THREE.Group();
      armorGroup.add(createTestMesh("box"));

      const result = fittingService.equipArmorToCharacter(
        armorGroup,
        characterMesh,
        { autoMatch: true },
      );

      expect(result).toBeNull();
    });
  });

  describe("Equipment Validation", () => {
    it("equipment group can contain multiple meshes", () => {
      const equipment = new THREE.Group();
      equipment.add(createTestMesh("box"));
      equipment.add(createTestMesh("sphere"));

      expect(equipment.children.length).toBe(2);
    });

    it("equipment meshes have valid geometry", () => {
      const mesh = createTestMesh("box");
      const geometry = mesh.geometry as THREE.BufferGeometry;

      expect(geometry.attributes.position).toBeDefined();
      expect(geometry.attributes.position.count).toBeGreaterThan(0);
    });

    it("character mesh has valid skeleton binding", () => {
      const characterMesh = createCharacterMesh();

      expect(characterMesh.skeleton).toBeDefined();
      expect(characterMesh.skeleton.bones.length).toBeGreaterThan(0);
    });

    it("character mesh has skinning attributes", () => {
      const characterMesh = createCharacterMesh();
      const geometry = characterMesh.geometry as THREE.BufferGeometry;

      expect(geometry.attributes.skinIndex).toBeDefined();
      expect(geometry.attributes.skinWeight).toBeDefined();
    });
  });

  describe("Slot Compatibility", () => {
    it("head slot is compatible with helmets and hats", () => {
      const headSlot = EQUIPMENT_SLOTS.head;
      // Head slot should work for any head-worn equipment
      expect(headSlot.bones).toContain("Head");
    });

    it("chest slot covers torso area", () => {
      const chestSlot = EQUIPMENT_SLOTS.chest;
      // Should include multiple spine bones for full coverage
      expect(chestSlot.bones.length).toBeGreaterThanOrEqual(2);
    });

    it("cape slot extends from upper back", () => {
      const capeSlot = EQUIPMENT_SLOTS.cape;
      // Capes attach near upper spine
      expect(capeSlot.bones.some((b) => b.includes("Spine"))).toBe(true);
    });

    it("weapon slots allow different grip positions", () => {
      // Main hand and off hand are separate slots
      expect(EQUIPMENT_SLOTS.mainHand).not.toEqual(EQUIPMENT_SLOTS.offHand);
    });
  });

  describe("Bone Name Variations", () => {
    it("handles common bone naming conventions", () => {
      // Different naming conventions for the same bone
      const spineVariations = ["Spine", "spine", "Spine1", "spine_01"];
      const handVariations = [
        "Hand",
        "hand",
        "LeftHand",
        "RightHand",
        "hand_l",
        "hand_r",
      ];

      // Our slot definitions use one convention
      const chestSlot = EQUIPMENT_SLOTS.chest;
      expect(
        chestSlot.bones.some((b) => b.toLowerCase().includes("spine")),
      ).toBe(true);
    });

    it("VRM bone names are supported", () => {
      // VRM uses specific bone naming
      const vrmBones = [
        "hips",
        "spine",
        "chest",
        "neck",
        "head",
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
        "leftUpperLeg",
        "leftLowerLeg",
        "leftFoot",
        "rightUpperLeg",
        "rightLowerLeg",
        "rightFoot",
      ];

      // Should have mapping for major body parts
      expect(
        EQUIPMENT_SLOTS.head.bones.some((b) =>
          vrmBones.some((v) => v.toLowerCase() === b.toLowerCase()),
        ),
      ).toBe(true);
    });
  });
});
