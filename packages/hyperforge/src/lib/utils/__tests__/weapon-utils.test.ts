/**
 * Weapon Utils Tests
 *
 * Tests for weapon utility functions including bone mapping,
 * weapon offsets, scaling calculations, and THREE.js operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  BONE_MAPPING,
  WEAPON_OFFSETS,
  getWeaponOffset,
  calculateAvatarHeight,
  calculateWeaponScale,
  createNormalizedWeapon,
  findBone,
  getWorldScale,
  getAttachedBone,
} from "@/lib/utils/weapon-utils";

/**
 * Create a SkinnedMesh with skeleton for testing
 * Note: For calculateAvatarHeight testing, we use regular meshes
 * since SkinnedMesh requires complete skinning data.
 */
function createSkinnedMeshWithBones(
  boneNames: string[],
  meshHeight = 1.8,
): THREE.Object3D {
  const group = new THREE.Group();

  // Create bones
  const bones: THREE.Bone[] = boneNames.map((name, index) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(0, index * 0.2, 0);
    return bone;
  });

  // Create bone hierarchy
  for (let i = 1; i < bones.length; i++) {
    bones[i - 1].add(bones[i]);
  }

  // Create skeleton
  const skeleton = new THREE.Skeleton(bones);

  // Create geometry that spans the desired height
  const geometry = new THREE.BoxGeometry(0.5, meshHeight, 0.3);
  geometry.translate(0, meshHeight / 2, 0);

  // Add skinning attributes (required for SkinnedMesh bounding box computation)
  const vertexCount = geometry.attributes.position.count;
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    // All vertices bound to bone 0 with weight 1.0
    skinIndices[i * 4] = 0;
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
    new THREE.BufferAttribute(new Uint16Array(skinIndices), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.add(bones[0]);
  skinnedMesh.bind(skeleton);

  group.add(skinnedMesh);
  return group;
}

/**
 * Create a simple weapon mesh for testing
 */
function createWeaponMesh(
  length: number,
  width = 0.1,
  depth = 0.1,
): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(width, length, depth);
  geometry.translate(0, length / 2, 0);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "WeaponMesh";
  return mesh;
}

describe("Weapon Utils", () => {
  describe("Bone Mapping", () => {
    it("maps Hand_R to multiple naming conventions", () => {
      const handRMappings = BONE_MAPPING.Hand_R;

      expect(handRMappings).toContain("Hand_R");
      expect(handRMappings).toContain("mixamorig:RightHand");
      expect(handRMappings).toContain("RightHand");
      expect(handRMappings).toContain("hand_r");
      expect(handRMappings).toContain("Bip01_R_Hand");
      expect(handRMappings).toContain("rightHand");
    });

    it("maps Hand_L to multiple naming conventions", () => {
      const handLMappings = BONE_MAPPING.Hand_L;

      expect(handLMappings).toContain("Hand_L");
      expect(handLMappings).toContain("mixamorig:LeftHand");
      expect(handLMappings).toContain("LeftHand");
      expect(handLMappings).toContain("hand_l");
      expect(handLMappings).toContain("Bip01_L_Hand");
      expect(handLMappings).toContain("leftHand");
    });

    it("maps Head bone correctly", () => {
      const headMappings = BONE_MAPPING.Head;

      expect(headMappings).toContain("Head");
      expect(headMappings).toContain("mixamorig:Head");
      expect(headMappings).toContain("head");
      expect(headMappings).toContain("Bip01_Head");
    });

    it("maps Spine2 and chest correctly", () => {
      const spineMappings = BONE_MAPPING.Spine2;

      expect(spineMappings).toContain("Spine2");
      expect(spineMappings).toContain("Spine02");
      expect(spineMappings).toContain("mixamorig:Spine2");
      expect(spineMappings).toContain("Chest");
      expect(spineMappings).toContain("chest");
    });

    it("maps Hips correctly", () => {
      const hipsMappings = BONE_MAPPING.Hips;

      expect(hipsMappings).toContain("Hips");
      expect(hipsMappings).toContain("mixamorig:Hips");
      expect(hipsMappings).toContain("hips");
      expect(hipsMappings).toContain("Bip01_Pelvis");
    });
  });

  describe("Weapon Offsets", () => {
    it("has sword offset with position and rotation", () => {
      const sword = WEAPON_OFFSETS.sword;

      expect(sword.position).toBeDefined();
      expect(sword.position.x).toBe(0.076);
      expect(sword.position.y).toBe(0.077);
      expect(sword.position.z).toBe(0.028);

      expect(sword.rotation).toBeDefined();
      expect(sword.rotation.x).toBe(92);
      expect(sword.rotation.y).toBe(0);
      expect(sword.rotation.z).toBe(0);
    });

    it("has 2h-sword offset matching sword", () => {
      const twoHandSword = WEAPON_OFFSETS["2h-sword"];

      expect(twoHandSword.position.x).toBe(0.076);
      expect(twoHandSword.rotation.x).toBe(92);
    });

    it("has bow offset with different rotation", () => {
      const bow = WEAPON_OFFSETS.bow;

      expect(bow.position.x).toBe(0.05);
      expect(bow.position.y).toBe(0.1);
      expect(bow.position.z).toBe(0);

      expect(bow.rotation.x).toBe(0);
      expect(bow.rotation.y).toBe(90);
      expect(bow.rotation.z).toBe(0);
    });

    it("has shield offset", () => {
      const shield = WEAPON_OFFSETS.shield;

      expect(shield.position.x).toBe(0.05);
      expect(shield.position.y).toBe(0.05);
      expect(shield.position.z).toBe(0);
    });

    it("has default offset for unknown weapons", () => {
      const defaultOffset = WEAPON_OFFSETS.default;

      expect(defaultOffset.position).toBeDefined();
      expect(defaultOffset.rotation).toBeDefined();
      expect(defaultOffset.position.x).toBe(0.045);
    });

    it("has crossbow offset", () => {
      const crossbow = WEAPON_OFFSETS.crossbow;

      expect(crossbow.position.x).toBe(0.076);
      expect(crossbow.rotation.x).toBe(0);
      expect(crossbow.rotation.y).toBe(0);
    });

    it("has mace offset matching sword", () => {
      const mace = WEAPON_OFFSETS.mace;

      expect(mace.position.x).toBe(0.076);
      expect(mace.rotation.x).toBe(92);
    });
  });

  describe("getWeaponOffset", () => {
    it("returns sword offset for sword type", () => {
      const offset = getWeaponOffset("sword");

      expect(offset.position.x).toBe(0.076);
      expect(offset.rotation.x).toBe(92);
    });

    it("returns bow offset for bow type", () => {
      const offset = getWeaponOffset("bow");

      expect(offset.position.x).toBe(0.05);
      expect(offset.rotation.y).toBe(90);
    });

    it("returns default offset for unknown weapon type", () => {
      const offset = getWeaponOffset("laser-cannon");

      expect(offset.position.x).toBe(0.045);
      expect(offset.rotation.x).toBe(0);
    });

    it("returns default offset for empty string", () => {
      const offset = getWeaponOffset("");

      expect(offset).toEqual(WEAPON_OFFSETS.default);
    });

    it("returns shield offset for shield type", () => {
      const offset = getWeaponOffset("shield");

      expect(offset.position.x).toBe(0.05);
      expect(offset.position.y).toBe(0.05);
    });

    it("returns 2h-sword offset for two-handed sword", () => {
      const offset = getWeaponOffset("2h-sword");

      expect(offset.position.x).toBe(0.076);
      expect(offset.rotation.x).toBe(92);
    });

    // Test all weapon types comprehensively
    it.each([
      ["sword", 0.076, 0.077, 0.028, 92, 0, 0],
      ["mace", 0.076, 0.077, 0.028, 92, 0, 0],
      ["bow", 0.05, 0.1, 0, 0, 90, 0],
      ["crossbow", 0.076, 0.05, 0.05, 0, 0, 0],
      ["shield", 0.05, 0.05, 0, 0, 0, 0],
    ] as const)(
      "returns correct offset for %s",
      (type, px, py, pz, rx, ry, rz) => {
        const offset = getWeaponOffset(type);
        expect(offset.position.x).toBeCloseTo(px);
        expect(offset.position.y).toBeCloseTo(py);
        expect(offset.position.z).toBeCloseTo(pz);
        expect(offset.rotation.x).toBe(rx);
        expect(offset.rotation.y).toBe(ry);
        expect(offset.rotation.z).toBe(rz);
      },
    );

    // Test default fallback for various weapon types
    it.each(["dagger", "hammer", "spear", "axe", "staff", "wand", "club"])(
      "returns default offset for %s (not in WEAPON_OFFSETS)",
      (type) => {
        const offset = getWeaponOffset(type);
        expect(offset).toEqual(WEAPON_OFFSETS.default);
      },
    );
  });

  describe("calculateAvatarHeight", () => {
    it("calculates height from skinned mesh", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"], 1.8);
      const height = calculateAvatarHeight(avatar);

      // Should be approximately 1.8m
      expect(height).toBeGreaterThan(1.5);
      expect(height).toBeLessThan(2.1);
    });

    it("calculates height for small avatar", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"], 1.0);
      const height = calculateAvatarHeight(avatar);

      expect(height).toBeGreaterThan(0.8);
      expect(height).toBeLessThan(1.3);
    });

    it("calculates height for tall avatar", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"], 2.5);
      const height = calculateAvatarHeight(avatar);

      expect(height).toBeGreaterThan(2.2);
      expect(height).toBeLessThan(2.8);
    });

    it("returns default height for empty object", () => {
      const emptyGroup = new THREE.Group();
      const height = calculateAvatarHeight(emptyGroup);

      // Should return default 1.8 for objects with invalid dimensions
      expect(height).toBe(1.8);
    });

    it("handles object without skinned mesh", () => {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.6, 0.3),
        new THREE.MeshBasicMaterial(),
      );
      box.geometry.translate(0, 0.8, 0);
      const group = new THREE.Group();
      group.add(box);

      const height = calculateAvatarHeight(group);

      // Should calculate from overall bounding box
      expect(height).toBeGreaterThan(1.4);
      expect(height).toBeLessThan(1.8);
    });
  });

  describe("calculateWeaponScale", () => {
    let avatar: THREE.Object3D;

    beforeEach(() => {
      avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"], 1.8);
    });

    it("calculates scale for sword (standard height avatar)", () => {
      const weapon = createWeaponMesh(1.0); // 1m sword
      const scale = calculateWeaponScale(weapon, avatar, "sword", 1.8);

      // Sword should be ~65% of character height = 1.17m
      // Scale factor = 1.17 / 1.0 = 1.17
      expect(scale).toBeGreaterThan(1.0);
      expect(scale).toBeLessThan(1.5);
    });

    it("calculates scale for dagger (small weapon)", () => {
      const weapon = createWeaponMesh(0.5); // 0.5m dagger
      const scale = calculateWeaponScale(weapon, avatar, "dagger", 1.8);

      // Dagger should be ~25% of character height = 0.45m
      // Scale factor = 0.45 / 0.5 = 0.9
      expect(scale).toBeGreaterThan(0.7);
      expect(scale).toBeLessThan(1.1);
    });

    it("calculates scale for staff (tall weapon)", () => {
      const weapon = createWeaponMesh(1.5); // 1.5m staff
      const scale = calculateWeaponScale(weapon, avatar, "staff", 1.8);

      // Staff should be ~110% of character height = 1.98m
      // Scale factor = 1.98 / 1.5 = 1.32
      expect(scale).toBeGreaterThan(1.1);
      expect(scale).toBeLessThan(1.6);
    });

    it("calculates scale for spear", () => {
      const weapon = createWeaponMesh(2.0); // 2m spear
      const scale = calculateWeaponScale(weapon, avatar, "spear", 1.8);

      // Spear should be ~110% of character height = 1.98m
      // Scale factor = 1.98 / 2.0 = 0.99
      expect(scale).toBeGreaterThan(0.8);
      expect(scale).toBeLessThan(1.2);
    });

    it("calculates scale for bow", () => {
      const weapon = createWeaponMesh(1.2); // 1.2m bow
      const scale = calculateWeaponScale(weapon, avatar, "bow", 1.8);

      // Bow should be ~80% of character height = 1.44m
      // Scale factor = 1.44 / 1.2 = 1.2
      expect(scale).toBeGreaterThan(1.0);
      expect(scale).toBeLessThan(1.5);
    });

    it("returns 1.0 for armor (no scaling)", () => {
      const armor = createWeaponMesh(0.8);
      const scale = calculateWeaponScale(armor, avatar, "armor", 1.8);

      expect(scale).toBe(1.0);
    });

    it("scales up weapons for small avatars", () => {
      const smallAvatar = createSkinnedMeshWithBones(
        ["Hips", "Spine", "Head"],
        1.0,
      );
      const weapon = createWeaponMesh(1.0);
      const scale = calculateWeaponScale(weapon, smallAvatar, "sword", 1.0);

      // Smaller creatures use proportionally larger weapons (72%)
      // Target = 1.0 * 0.72 = 0.72m
      expect(scale).toBeGreaterThan(0.6);
      expect(scale).toBeLessThan(0.9);
    });

    it("scales down weapons for large avatars", () => {
      const largeAvatar = createSkinnedMeshWithBones(
        ["Hips", "Spine", "Head"],
        3.0,
      );
      const weapon = createWeaponMesh(1.0);
      const scale = calculateWeaponScale(weapon, largeAvatar, "sword", 3.0);

      // Larger creatures use proportionally smaller weapons (55%)
      // Target = 3.0 * 0.55 = 1.65m
      expect(scale).toBeGreaterThan(1.4);
      expect(scale).toBeLessThan(2.0);
    });

    // Test all weapon types
    it.each([
      ["sword", 1.0, 1.8, 0.8, 1.5],
      ["axe", 1.0, 1.8, 0.8, 1.5],
      ["dagger", 0.5, 1.8, 0.6, 1.2],
      ["knife", 0.3, 1.8, 1.0, 2.0],
      ["staff", 1.5, 1.8, 1.0, 1.6],
      ["spear", 2.0, 1.8, 0.8, 1.2],
      ["bow", 1.2, 1.8, 0.9, 1.4],
      ["hammer", 0.8, 1.8, 1.0, 1.8], // Uses default proportion
      ["mace", 0.7, 1.8, 1.2, 2.0], // Uses default proportion
      ["crossbow", 0.6, 1.8, 1.4, 2.2], // Uses default proportion
      ["shield", 0.5, 1.8, 1.8, 2.6], // Uses default proportion
    ] as const)(
      "calculates appropriate scale for %s (length: %s, height: %s)",
      (type, weaponLength, avatarHeight, minScale, maxScale) => {
        const weapon = createWeaponMesh(weaponLength);
        const scale = calculateWeaponScale(weapon, avatar, type, avatarHeight);

        expect(scale).toBeGreaterThan(minScale);
        expect(scale).toBeLessThan(maxScale);
      },
    );
  });

  describe("createNormalizedWeapon", () => {
    it("creates weapon with grip at origin", () => {
      const weapon = createWeaponMesh(1.0);
      const gripPoint = new THREE.Vector3(0, 0.1, 0);

      const normalized = createNormalizedWeapon(weapon, gripPoint);

      expect(normalized.name).toBe("NormalizedWeapon");
      expect(normalized.userData.isNormalized).toBe(true);
    });

    it("clones original weapon without modifying it", () => {
      const weapon = createWeaponMesh(1.0);
      const originalPosition = weapon.position.clone();
      const gripPoint = new THREE.Vector3(0, 0.2, 0);

      createNormalizedWeapon(weapon, gripPoint);

      // Original should be unchanged
      expect(weapon.position.equals(originalPosition)).toBe(true);
    });

    it("offsets weapon position by grip point", () => {
      const weapon = createWeaponMesh(1.0);
      const gripPoint = new THREE.Vector3(0.1, 0.2, 0.05);

      const normalized = createNormalizedWeapon(weapon, gripPoint);

      // The child weapon should be offset by negative grip point
      expect(normalized.children.length).toBe(1);
      const child = normalized.children[0];
      expect(child.position.x).toBeCloseTo(-0.1);
      expect(child.position.y).toBeCloseTo(-0.2);
      expect(child.position.z).toBeCloseTo(-0.05);
    });

    it("handles weapon with z-axis as longest dimension", () => {
      // Create a weapon that was rotated during detection
      const geometry = new THREE.BoxGeometry(0.1, 0.1, 1.0);
      geometry.translate(0, 0, 0.5);
      const material = new THREE.MeshBasicMaterial();
      const weapon = new THREE.Mesh(geometry, material);

      const gripPoint = new THREE.Vector3(0, 0.1, 0.05);
      const normalized = createNormalizedWeapon(weapon, gripPoint);

      expect(normalized.userData.isNormalized).toBe(true);
      expect(normalized.children.length).toBe(1);
    });

    it("handles various grip positions for different weapons", () => {
      const testCases = [
        { name: "sword", gripY: 0.1, length: 1.0 },
        { name: "axe", gripY: 0.15, length: 0.8 },
        { name: "mace", gripY: 0.12, length: 0.6 },
        { name: "staff", gripY: 0.5, length: 1.8 },
        { name: "bow", gripY: 0.5, length: 1.2 },
        { name: "dagger", gripY: 0.05, length: 0.3 },
        { name: "hammer", gripY: 0.1, length: 0.7 },
        { name: "spear", gripY: 0.3, length: 2.0 },
      ];

      for (const { name, gripY, length } of testCases) {
        const weapon = createWeaponMesh(length);
        weapon.name = name;
        const gripPoint = new THREE.Vector3(0, gripY, 0);

        const normalized = createNormalizedWeapon(weapon, gripPoint);

        expect(normalized.userData.isNormalized).toBe(true);
        expect(normalized.children[0].position.y).toBeCloseTo(-gripY);
      }
    });
  });

  describe("findBone", () => {
    it("finds bone by exact VRM name", () => {
      const avatar = createSkinnedMeshWithBones([
        "Hips",
        "Spine",
        "Head",
        "Hand_R",
        "Hand_L",
      ]);

      const bone = findBone(avatar, "Hand_R");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("Hand_R");
    });

    it("finds bone by Mixamo naming convention", () => {
      const avatar = createSkinnedMeshWithBones([
        "mixamorig:Hips",
        "mixamorig:Spine",
        "mixamorig:RightHand",
      ]);

      const bone = findBone(avatar, "Hand_R");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("mixamorig:RightHand");
    });

    it("finds bone by lowercase naming convention", () => {
      const avatar = createSkinnedMeshWithBones([
        "hips",
        "spine",
        "head",
        "hand_r",
      ]);

      const bone = findBone(avatar, "Hand_R");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("hand_r");
    });

    it("finds bone by Bip01 naming convention", () => {
      const avatar = createSkinnedMeshWithBones([
        "Bip01_Pelvis",
        "Bip01_Spine",
        "Bip01_R_Hand",
      ]);

      const bone = findBone(avatar, "Hand_R");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("Bip01_R_Hand");
    });

    it("finds left hand bone", () => {
      const avatar = createSkinnedMeshWithBones([
        "Hips",
        "Spine",
        "LeftHand",
        "RightHand",
      ]);

      const bone = findBone(avatar, "Hand_L");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("LeftHand");
    });

    it("finds Head bone", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"]);

      const bone = findBone(avatar, "Head");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("Head");
    });

    it("finds Spine2/Chest bone", () => {
      const avatar = createSkinnedMeshWithBones([
        "Hips",
        "Spine",
        "Chest",
        "Head",
      ]);

      const bone = findBone(avatar, "Spine2");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("Chest");
    });

    it("finds Hips bone", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"]);

      const bone = findBone(avatar, "Hips");

      expect(bone).not.toBeNull();
      expect(bone?.name).toBe("Hips");
    });

    it("returns null for non-existent bone", () => {
      const avatar = createSkinnedMeshWithBones(["Hips", "Spine", "Head"]);

      const bone = findBone(avatar, "NonExistentBone");

      expect(bone).toBeNull();
    });

    it("returns null for object without skeleton", () => {
      const emptyGroup = new THREE.Group();

      const bone = findBone(emptyGroup, "Hand_R");

      expect(bone).toBeNull();
    });

    it("finds bone with partial name match", () => {
      const avatar = createSkinnedMeshWithBones([
        "Character_Hips",
        "Character_Spine",
        "Character_RightHand",
      ]);

      const bone = findBone(avatar, "Hand_R");

      expect(bone).not.toBeNull();
      // Partial match should work
      expect(bone?.name).toContain("Right");
    });
  });

  describe("getWorldScale", () => {
    it("returns world scale for unscaled object", () => {
      const obj = new THREE.Object3D();
      const scale = getWorldScale(obj);

      expect(scale.x).toBe(1);
      expect(scale.y).toBe(1);
      expect(scale.z).toBe(1);
    });

    it("returns world scale for scaled object", () => {
      const obj = new THREE.Object3D();
      obj.scale.set(2, 3, 4);
      obj.updateMatrixWorld(true);

      const scale = getWorldScale(obj);

      expect(scale.x).toBeCloseTo(2);
      expect(scale.y).toBeCloseTo(3);
      expect(scale.z).toBeCloseTo(4);
    });

    it("returns accumulated world scale for nested objects", () => {
      const parent = new THREE.Object3D();
      parent.scale.set(2, 2, 2);

      const child = new THREE.Object3D();
      child.scale.set(0.5, 0.5, 0.5);

      parent.add(child);
      parent.updateMatrixWorld(true);

      const scale = getWorldScale(child);

      // 2 * 0.5 = 1
      expect(scale.x).toBeCloseTo(1);
      expect(scale.y).toBeCloseTo(1);
      expect(scale.z).toBeCloseTo(1);
    });

    it("handles deeply nested scale chains", () => {
      const root = new THREE.Object3D();
      root.scale.set(2, 2, 2);

      const level1 = new THREE.Object3D();
      level1.scale.set(3, 3, 3);
      root.add(level1);

      const level2 = new THREE.Object3D();
      level2.scale.set(0.5, 0.5, 0.5);
      level1.add(level2);

      root.updateMatrixWorld(true);

      const scale = getWorldScale(level2);

      // 2 * 3 * 0.5 = 3
      expect(scale.x).toBeCloseTo(3);
      expect(scale.y).toBeCloseTo(3);
      expect(scale.z).toBeCloseTo(3);
    });

    it("returns correct scale for weapon meshes", () => {
      const weapon = createWeaponMesh(1.0);
      weapon.scale.set(1.5, 1.5, 1.5);
      weapon.updateMatrixWorld(true);

      const scale = getWorldScale(weapon);

      expect(scale.x).toBeCloseTo(1.5);
      expect(scale.y).toBeCloseTo(1.5);
      expect(scale.z).toBeCloseTo(1.5);
    });
  });

  describe("getAttachedBone", () => {
    it("returns bone when equipment is direct child", () => {
      const bone = new THREE.Bone();
      bone.name = "Hand_R";

      const equipment = new THREE.Mesh();
      bone.add(equipment);

      const result = getAttachedBone(equipment);

      expect(result).toBe(bone);
      expect(result?.name).toBe("Hand_R");
    });

    it("returns bone through wrapper group", () => {
      const bone = new THREE.Bone();
      bone.name = "Hand_L";

      const wrapper = new THREE.Group();
      bone.add(wrapper);

      const equipment = new THREE.Mesh();
      wrapper.add(equipment);

      const result = getAttachedBone(equipment);

      expect(result).toBe(bone);
    });

    it("returns bone through multiple wrapper levels", () => {
      const bone = new THREE.Bone();
      bone.name = "Spine2";

      const wrapper1 = new THREE.Group();
      bone.add(wrapper1);

      const wrapper2 = new THREE.Group();
      wrapper1.add(wrapper2);

      const equipment = new THREE.Mesh();
      wrapper2.add(equipment);

      const result = getAttachedBone(equipment);

      expect(result).toBe(bone);
    });

    it("returns null when no bone in ancestry", () => {
      const parent = new THREE.Group();
      const equipment = new THREE.Mesh();
      parent.add(equipment);

      const result = getAttachedBone(equipment);

      expect(result).toBeNull();
    });

    it("returns null for orphaned equipment", () => {
      const equipment = new THREE.Mesh();

      const result = getAttachedBone(equipment);

      expect(result).toBeNull();
    });

    it("returns closest bone in hierarchy", () => {
      const rootBone = new THREE.Bone();
      rootBone.name = "Hips";

      const childBone = new THREE.Bone();
      childBone.name = "Hand_R";
      rootBone.add(childBone);

      const equipment = new THREE.Mesh();
      childBone.add(equipment);

      const result = getAttachedBone(equipment);

      // Should return Hand_R (immediate parent), not Hips
      expect(result?.name).toBe("Hand_R");
    });
  });

  describe("Integration: Full Weapon Attachment Flow", () => {
    it("completes full attachment flow for sword", () => {
      // Create avatar with skeleton
      const avatar = createSkinnedMeshWithBones(
        ["Hips", "Spine", "Head", "Hand_R", "Hand_L"],
        1.8,
      );
      const avatarHeight = calculateAvatarHeight(avatar);

      // Create weapon
      const weapon = createWeaponMesh(1.0);

      // Calculate scale
      const scale = calculateWeaponScale(weapon, avatar, "sword", avatarHeight);

      // Get offset
      const offset = getWeaponOffset("sword");

      // Find attachment bone
      const bone = findBone(avatar, "Hand_R");

      // Normalize weapon
      const gripPoint = new THREE.Vector3(0, 0.1, 0);
      const normalized = createNormalizedWeapon(weapon, gripPoint);

      // Verify all steps worked
      expect(avatarHeight).toBeGreaterThan(1.5);
      expect(scale).toBeGreaterThan(0.5);
      expect(offset.rotation.x).toBe(92);
      expect(bone).not.toBeNull();
      expect(normalized.userData.isNormalized).toBe(true);
    });

    it("completes full attachment flow for all weapon types", () => {
      const avatar = createSkinnedMeshWithBones(
        ["Hips", "Spine", "Head", "Hand_R", "Hand_L"],
        1.8,
      );
      const avatarHeight = calculateAvatarHeight(avatar);

      const weaponConfigs = [
        { type: "sword", length: 1.0, gripY: 0.1 },
        { type: "axe", length: 0.8, gripY: 0.12 },
        { type: "mace", length: 0.6, gripY: 0.1 },
        { type: "staff", length: 1.8, gripY: 0.5 },
        { type: "bow", length: 1.2, gripY: 0.6 },
        { type: "shield", length: 0.5, gripY: 0.25 },
        { type: "dagger", length: 0.3, gripY: 0.05 },
        { type: "hammer", length: 0.7, gripY: 0.1 },
        { type: "spear", length: 2.0, gripY: 0.3 },
        { type: "crossbow", length: 0.6, gripY: 0.15 },
      ];

      for (const config of weaponConfigs) {
        const weapon = createWeaponMesh(config.length);
        weapon.name = config.type;

        const scale = calculateWeaponScale(
          weapon,
          avatar,
          config.type,
          avatarHeight,
        );
        const offset = getWeaponOffset(config.type);
        const bone = findBone(
          avatar,
          config.type === "shield" ? "Hand_L" : "Hand_R",
        );
        const normalized = createNormalizedWeapon(
          weapon,
          new THREE.Vector3(0, config.gripY, 0),
        );

        // All operations should complete without error
        expect(scale).toBeGreaterThan(0);
        expect(offset).toBeDefined();
        expect(offset.position).toBeDefined();
        expect(offset.rotation).toBeDefined();
        expect(bone).not.toBeNull();
        expect(normalized.userData.isNormalized).toBe(true);
      }
    });
  });
});
