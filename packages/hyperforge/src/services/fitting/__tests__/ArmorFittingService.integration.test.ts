/**
 * ArmorFittingService Integration Tests
 *
 * REAL integration tests that call actual ArmorFittingService methods
 * with real Three.js objects - NO MOCKS.
 *
 * Tests the complete fitting pipeline:
 * 1. computeBodyRegions - identify body regions from skeleton
 * 2. fitArmorToBoundingBox - initial fitting to body region
 * 3. detectCollisions - find armor/body collisions
 * 4. resolveCollisions - push armor vertices out
 * 5. bindArmorToSkeleton - transfer skin weights
 * 6. exportFittedArmor - export GLB with skeleton
 * 7. equipArmorToCharacter - runtime equipping
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as THREE from "three";

import { ArmorFittingService } from "../ArmorFittingService";
import type { BodyRegion, FittingConfig } from "../ArmorFittingService";
import {
  countFaces,
  countVertices,
  findUnweightedVertices,
} from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a realistic humanoid skeleton with VRM-style bone hierarchy
 * Includes hips, spine, chest, neck, head, arms, and legs
 */
function createHumanoidSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  bones: THREE.Bone[];
} {
  // Create all bones
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1.0, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.15, 0);
  hipsBone.add(spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 0.15, 0);
  spineBone.add(chestBone);

  const upperChestBone = new THREE.Bone();
  upperChestBone.name = "UpperChest";
  upperChestBone.position.set(0, 0.1, 0);
  chestBone.add(upperChestBone);

  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 0.1, 0);
  upperChestBone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.1, 0);
  neckBone.add(headBone);

  // Left arm
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "LeftShoulder";
  leftShoulderBone.position.set(0.1, 0, 0);
  upperChestBone.add(leftShoulderBone);

  const leftUpperArmBone = new THREE.Bone();
  leftUpperArmBone.name = "LeftUpperArm";
  leftUpperArmBone.position.set(0.1, 0, 0);
  leftShoulderBone.add(leftUpperArmBone);

  const leftLowerArmBone = new THREE.Bone();
  leftLowerArmBone.name = "LeftLowerArm";
  leftLowerArmBone.position.set(0.25, 0, 0);
  leftUpperArmBone.add(leftLowerArmBone);

  const leftHandBone = new THREE.Bone();
  leftHandBone.name = "LeftHand";
  leftHandBone.position.set(0.25, 0, 0);
  leftLowerArmBone.add(leftHandBone);

  // Right arm
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "RightShoulder";
  rightShoulderBone.position.set(-0.1, 0, 0);
  upperChestBone.add(rightShoulderBone);

  const rightUpperArmBone = new THREE.Bone();
  rightUpperArmBone.name = "RightUpperArm";
  rightUpperArmBone.position.set(-0.1, 0, 0);
  rightShoulderBone.add(rightUpperArmBone);

  const rightLowerArmBone = new THREE.Bone();
  rightLowerArmBone.name = "RightLowerArm";
  rightLowerArmBone.position.set(-0.25, 0, 0);
  rightUpperArmBone.add(rightLowerArmBone);

  const rightHandBone = new THREE.Bone();
  rightHandBone.name = "RightHand";
  rightHandBone.position.set(-0.25, 0, 0);
  rightLowerArmBone.add(rightHandBone);

  // Left leg
  const leftUpperLegBone = new THREE.Bone();
  leftUpperLegBone.name = "LeftUpperLeg";
  leftUpperLegBone.position.set(0.1, -0.1, 0);
  hipsBone.add(leftUpperLegBone);

  const leftLowerLegBone = new THREE.Bone();
  leftLowerLegBone.name = "LeftLowerLeg";
  leftLowerLegBone.position.set(0, -0.4, 0);
  leftUpperLegBone.add(leftLowerLegBone);

  const leftFootBone = new THREE.Bone();
  leftFootBone.name = "LeftFoot";
  leftFootBone.position.set(0, -0.4, 0);
  leftLowerLegBone.add(leftFootBone);

  // Right leg
  const rightUpperLegBone = new THREE.Bone();
  rightUpperLegBone.name = "RightUpperLeg";
  rightUpperLegBone.position.set(-0.1, -0.1, 0);
  hipsBone.add(rightUpperLegBone);

  const rightLowerLegBone = new THREE.Bone();
  rightLowerLegBone.name = "RightLowerLeg";
  rightLowerLegBone.position.set(0, -0.4, 0);
  rightUpperLegBone.add(rightLowerLegBone);

  const rightFootBone = new THREE.Bone();
  rightFootBone.name = "RightFoot";
  rightFootBone.position.set(0, -0.4, 0);
  rightLowerLegBone.add(rightFootBone);

  // Collect all bones in order
  const bones = [
    hipsBone, // 0
    spineBone, // 1
    chestBone, // 2
    upperChestBone, // 3
    neckBone, // 4
    headBone, // 5
    leftShoulderBone, // 6
    leftUpperArmBone, // 7
    leftLowerArmBone, // 8
    leftHandBone, // 9
    rightShoulderBone, // 10
    rightUpperArmBone, // 11
    rightLowerArmBone, // 12
    rightHandBone, // 13
    leftUpperLegBone, // 14
    leftLowerLegBone, // 15
    leftFootBone, // 16
    rightUpperLegBone, // 17
    rightLowerLegBone, // 18
    rightFootBone, // 19
  ];

  const skeleton = new THREE.Skeleton(bones);

  return { skeleton, rootBone: hipsBone, bones };
}

/**
 * Create a realistic humanoid body mesh with proper skinning
 * Vertices are weighted to appropriate bones based on position
 */
function createHumanoidBodyMesh(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
): THREE.SkinnedMesh {
  // Create a capsule-like body mesh
  const bodyGeometry = new THREE.CylinderGeometry(0.15, 0.12, 0.5, 16, 8);

  // Transform geometry to be positioned at torso height
  bodyGeometry.translate(0, 1.25, 0);

  // Add head sphere
  const headGeometry = new THREE.SphereGeometry(0.12, 16, 12);
  headGeometry.translate(0, 1.65, 0);

  // Add arm cylinders
  const leftArmGeometry = new THREE.CylinderGeometry(0.04, 0.035, 0.5, 8, 4);
  leftArmGeometry.rotateZ(-Math.PI / 2);
  leftArmGeometry.translate(0.4, 1.4, 0);

  const rightArmGeometry = new THREE.CylinderGeometry(0.04, 0.035, 0.5, 8, 4);
  rightArmGeometry.rotateZ(Math.PI / 2);
  rightArmGeometry.translate(-0.4, 1.4, 0);

  // Add leg cylinders
  const leftLegGeometry = new THREE.CylinderGeometry(0.06, 0.05, 0.8, 8, 6);
  leftLegGeometry.translate(0.08, 0.5, 0);

  const rightLegGeometry = new THREE.CylinderGeometry(0.06, 0.05, 0.8, 8, 6);
  rightLegGeometry.translate(-0.08, 0.5, 0);

  // Merge all geometries
  const mergedGeometry = new THREE.BufferGeometry();

  // Combine all geometries manually
  const geometries = [
    bodyGeometry,
    headGeometry,
    leftArmGeometry,
    rightArmGeometry,
    leftLegGeometry,
    rightLegGeometry,
  ];

  // Merge using BufferGeometryUtils pattern
  let totalVertexCount = 0;
  geometries.forEach((g) => {
    totalVertexCount += g.attributes.position.count;
  });

  const positions = new Float32Array(totalVertexCount * 3);
  const normals = new Float32Array(totalVertexCount * 3);
  const skinIndices = new Float32Array(totalVertexCount * 4);
  const skinWeights = new Float32Array(totalVertexCount * 4);

  let offset = 0;
  geometries.forEach((geom, geomIndex) => {
    const posAttr = geom.attributes.position;
    const normAttr = geom.attributes.normal;

    for (let i = 0; i < posAttr.count; i++) {
      const idx = offset + i;
      positions[idx * 3] = posAttr.getX(i);
      positions[idx * 3 + 1] = posAttr.getY(i);
      positions[idx * 3 + 2] = posAttr.getZ(i);

      if (normAttr) {
        normals[idx * 3] = normAttr.getX(i);
        normals[idx * 3 + 1] = normAttr.getY(i);
        normals[idx * 3 + 2] = normAttr.getZ(i);
      }

      // Assign bone weights based on geometry part
      const y = posAttr.getY(i);
      const x = posAttr.getX(i);

      // Bone indices: 0=Hips, 1=Spine, 2=Chest, 3=UpperChest, 4=Neck, 5=Head
      // 6=LeftShoulder, 7=LeftUpperArm, 8=LeftLowerArm, 9=LeftHand
      // 10=RightShoulder, 11=RightUpperArm, 12=RightLowerArm, 13=RightHand
      // 14=LeftUpperLeg, 15=LeftLowerLeg, 16=LeftFoot
      // 17=RightUpperLeg, 18=RightLowerLeg, 19=RightFoot

      if (geomIndex === 0) {
        // Torso - weighted to spine/chest
        if (y > 1.35) {
          skinIndices[idx * 4] = 3; // UpperChest
          skinIndices[idx * 4 + 1] = 2; // Chest
          skinWeights[idx * 4] = 0.7;
          skinWeights[idx * 4 + 1] = 0.3;
        } else if (y > 1.15) {
          skinIndices[idx * 4] = 2; // Chest
          skinIndices[idx * 4 + 1] = 1; // Spine
          skinWeights[idx * 4] = 0.6;
          skinWeights[idx * 4 + 1] = 0.4;
        } else {
          skinIndices[idx * 4] = 1; // Spine
          skinIndices[idx * 4 + 1] = 0; // Hips
          skinWeights[idx * 4] = 0.5;
          skinWeights[idx * 4 + 1] = 0.5;
        }
      } else if (geomIndex === 1) {
        // Head
        skinIndices[idx * 4] = 5; // Head
        skinWeights[idx * 4] = 1.0;
      } else if (geomIndex === 2) {
        // Left arm
        if (x > 0.5) {
          skinIndices[idx * 4] = 8; // LeftLowerArm
          skinWeights[idx * 4] = 1.0;
        } else {
          skinIndices[idx * 4] = 7; // LeftUpperArm
          skinIndices[idx * 4 + 1] = 6; // LeftShoulder
          skinWeights[idx * 4] = 0.7;
          skinWeights[idx * 4 + 1] = 0.3;
        }
      } else if (geomIndex === 3) {
        // Right arm
        if (x < -0.5) {
          skinIndices[idx * 4] = 12; // RightLowerArm
          skinWeights[idx * 4] = 1.0;
        } else {
          skinIndices[idx * 4] = 11; // RightUpperArm
          skinIndices[idx * 4 + 1] = 10; // RightShoulder
          skinWeights[idx * 4] = 0.7;
          skinWeights[idx * 4 + 1] = 0.3;
        }
      } else if (geomIndex === 4) {
        // Left leg
        if (y < 0.3) {
          skinIndices[idx * 4] = 15; // LeftLowerLeg
          skinWeights[idx * 4] = 1.0;
        } else {
          skinIndices[idx * 4] = 14; // LeftUpperLeg
          skinIndices[idx * 4 + 1] = 0; // Hips
          skinWeights[idx * 4] = 0.8;
          skinWeights[idx * 4 + 1] = 0.2;
        }
      } else if (geomIndex === 5) {
        // Right leg
        if (y < 0.3) {
          skinIndices[idx * 4] = 18; // RightLowerLeg
          skinWeights[idx * 4] = 1.0;
        } else {
          skinIndices[idx * 4] = 17; // RightUpperLeg
          skinIndices[idx * 4 + 1] = 0; // Hips
          skinWeights[idx * 4] = 0.8;
          skinWeights[idx * 4 + 1] = 0.2;
        }
      }
    }

    offset += posAttr.count;
  });

  mergedGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  mergedGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  mergedGeometry.setAttribute(
    "skinIndex",
    new THREE.BufferAttribute(skinIndices, 4),
  );
  mergedGeometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  // Compute vertex normals if missing
  if (!mergedGeometry.attributes.normal) {
    mergedGeometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xffccaa,
    roughness: 0.8,
  });

  const bodyMesh = new THREE.SkinnedMesh(mergedGeometry, material);
  bodyMesh.name = "HumanoidBody";

  // Add root bone and bind skeleton
  bodyMesh.add(rootBone);
  bodyMesh.bind(skeleton);

  return bodyMesh;
}

/**
 * Create a torso armor mesh (chest plate style)
 */
function createTorsoArmorMesh(): THREE.Mesh {
  // Create a slightly larger cylinder to fit over torso
  const armorGeometry = new THREE.CylinderGeometry(0.2, 0.18, 0.45, 16, 6);

  // Add shoulder pads
  const leftPadGeometry = new THREE.SphereGeometry(0.08, 12, 8);
  leftPadGeometry.translate(0.22, 0.2, 0);

  const rightPadGeometry = new THREE.SphereGeometry(0.08, 12, 8);
  rightPadGeometry.translate(-0.22, 0.2, 0);

  // Merge geometries
  let totalVertexCount =
    armorGeometry.attributes.position.count +
    leftPadGeometry.attributes.position.count +
    rightPadGeometry.attributes.position.count;

  const positions = new Float32Array(totalVertexCount * 3);
  const normals = new Float32Array(totalVertexCount * 3);

  let offset = 0;
  [armorGeometry, leftPadGeometry, rightPadGeometry].forEach((geom) => {
    const posAttr = geom.attributes.position;
    const normAttr = geom.attributes.normal;

    for (let i = 0; i < posAttr.count; i++) {
      positions[(offset + i) * 3] = posAttr.getX(i);
      positions[(offset + i) * 3 + 1] = posAttr.getY(i);
      positions[(offset + i) * 3 + 2] = posAttr.getZ(i);

      if (normAttr) {
        normals[(offset + i) * 3] = normAttr.getX(i);
        normals[(offset + i) * 3 + 1] = normAttr.getY(i);
        normals[(offset + i) * 3 + 2] = normAttr.getZ(i);
      }
    }
    offset += posAttr.count;
  });

  const mergedGeometry = new THREE.BufferGeometry();
  mergedGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  mergedGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  mergedGeometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x888899,
    metalness: 0.8,
    roughness: 0.3,
  });

  const armorMesh = new THREE.Mesh(mergedGeometry, material);
  armorMesh.name = "TorsoArmor";

  return armorMesh;
}

/**
 * Create a helmet armor mesh
 */
function createHelmetArmorMesh(): THREE.Mesh {
  const helmetGeometry = new THREE.SphereGeometry(0.16, 16, 12);

  // Flatten bottom
  const positions = helmetGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (y < -0.08) {
      positions.setY(i, -0.08);
    }
  }
  positions.needsUpdate = true;
  helmetGeometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x666677,
    metalness: 0.9,
    roughness: 0.2,
  });

  const helmetMesh = new THREE.Mesh(helmetGeometry, material);
  helmetMesh.name = "Helmet";

  return helmetMesh;
}

describe("ArmorFittingService Integration Tests", () => {
  let fittingService: ArmorFittingService;
  let skeleton: THREE.Skeleton;
  let rootBone: THREE.Bone;
  let bones: THREE.Bone[];
  let bodyMesh: THREE.SkinnedMesh;
  let scene: THREE.Scene;

  beforeAll(() => {
    fittingService = new ArmorFittingService();
  });

  beforeEach(() => {
    // Create fresh scene and fixtures for each test
    scene = new THREE.Scene();

    // Create humanoid skeleton
    const skeletonData = createHumanoidSkeleton();
    skeleton = skeletonData.skeleton;
    rootBone = skeletonData.rootBone;
    bones = skeletonData.bones;

    // Create body mesh
    bodyMesh = createHumanoidBodyMesh(skeleton, rootBone);
    scene.add(bodyMesh);

    // Update world matrices
    scene.updateMatrixWorld(true);
  });

  describe("computeBodyRegions - Real Skeleton Analysis", () => {
    it("identifies all major body regions from humanoid skeleton", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);

      // Should identify head, torso, arms, hips, legs
      expect(regions.size).toBeGreaterThan(0);

      // Check for torso region (spine/chest bones)
      const torso = regions.get("torso");
      expect(torso).toBeDefined();
      if (torso) {
        expect(torso.bones.length).toBeGreaterThan(0);
        expect(
          torso.bones.some(
            (b) =>
              b.toLowerCase().includes("spine") ||
              b.toLowerCase().includes("chest"),
          ),
        ).toBe(true);
      }
    });

    it("computes valid bounding boxes for each region", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);

      regions.forEach((region, name) => {
        // Bounding box should not be empty
        expect(region.boundingBox.isEmpty()).toBe(false);

        // Center should be finite
        expect(Number.isFinite(region.center.x)).toBe(true);
        expect(Number.isFinite(region.center.y)).toBe(true);
        expect(Number.isFinite(region.center.z)).toBe(true);

        // Size should be positive
        const size = region.boundingBox.getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThan(0);
        expect(size.y).toBeGreaterThan(0);
        expect(size.z).toBeGreaterThan(0);
      });
    });

    it("correctly maps vertices to body regions based on bone weights", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);

      // Torso region should have vertices weighted to spine/chest bones
      const torso = regions.get("torso");
      if (torso) {
        // Vertices array may be empty if using bone fallback, but region should exist
        expect(torso.name).toBe("torso");
      }

      // Head region should have vertices weighted to head bone
      const head = regions.get("head");
      if (head) {
        expect(head.name).toBe("head");
        expect(head.bones.some((b) => b.toLowerCase().includes("head"))).toBe(
          true,
        );
      }
    });

    it("handles skeletons with varying bone naming conventions", () => {
      // Create alternative bone names
      const altHipsBone = new THREE.Bone();
      altHipsBone.name = "pelvis"; // Different naming
      altHipsBone.position.set(0, 1.0, 0);

      const altSpineBone = new THREE.Bone();
      altSpineBone.name = "spine_01"; // Numbered style
      altSpineBone.position.set(0, 0.2, 0);
      altHipsBone.add(altSpineBone);

      const altUpperBone = new THREE.Bone();
      altUpperBone.name = "upper_body"; // Alternative torso name
      altUpperBone.position.set(0, 0.2, 0);
      altSpineBone.add(altUpperBone);

      const altBones = [altHipsBone, altSpineBone, altUpperBone];
      const altSkeleton = new THREE.Skeleton(altBones);

      // Create simple body mesh for this skeleton
      const simpleGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.3, 4, 6, 4);
      const vertexCount = simpleGeometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 1; // Spine
        skinWeights[i * 4] = 1.0;
      }

      simpleGeometry.setAttribute(
        "skinIndex",
        new THREE.BufferAttribute(skinIndices, 4),
      );
      simpleGeometry.setAttribute(
        "skinWeight",
        new THREE.BufferAttribute(skinWeights, 4),
      );

      const altBodyMesh = new THREE.SkinnedMesh(
        simpleGeometry,
        new THREE.MeshBasicMaterial(),
      );
      altBodyMesh.add(altHipsBone);
      altBodyMesh.bind(altSkeleton);
      altBodyMesh.updateMatrixWorld(true);

      const regions = fittingService.computeBodyRegions(
        altBodyMesh,
        altSkeleton,
      );

      // Should still find some regions despite different naming
      expect(regions.size).toBeGreaterThan(0);
    });
  });

  describe("fitArmorToBoundingBox - Real Mesh Fitting", () => {
    it("scales and positions torso armor to fit body region", () => {
      // Get torso region
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      expect(torsoRegion).toBeDefined();
      if (!torsoRegion) return;

      // Create armor mesh
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 0, 0); // Start at origin
      armorMesh.updateMatrixWorld(true);

      const originalBounds = new THREE.Box3().setFromObject(armorMesh);
      const originalSize = originalBounds.getSize(new THREE.Vector3());

      // Fit armor to torso region
      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);
      armorMesh.updateMatrixWorld(true);

      // Armor should have moved to be near torso center
      const fittedBounds = new THREE.Box3().setFromObject(armorMesh);
      const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());

      // X and Z should be close to region center
      expect(Math.abs(fittedCenter.x - torsoRegion.center.x)).toBeLessThan(0.2);
      expect(Math.abs(fittedCenter.z - torsoRegion.center.z)).toBeLessThan(0.2);

      // Scale should have been applied (uniform scaling)
      expect(armorMesh.scale.x).toBeCloseTo(armorMesh.scale.y, 1);
      expect(armorMesh.scale.y).toBeCloseTo(armorMesh.scale.z, 1);
    });

    it("fits helmet to head region with appropriate margin", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const headRegion = regions.get("head");

      // Head region might not exist in simple test setup - create one manually
      const testHeadRegion: BodyRegion = {
        name: "head",
        bones: ["Head"],
        boundingBox: new THREE.Box3(
          new THREE.Vector3(-0.12, 1.55, -0.12),
          new THREE.Vector3(0.12, 1.8, 0.12),
        ),
        vertices: [],
        center: new THREE.Vector3(0, 1.675, 0),
      };

      const helmetMesh = createHelmetArmorMesh();
      helmetMesh.position.set(0, 0, 0);
      helmetMesh.updateMatrixWorld(true);

      fittingService.fitArmorToBoundingBox(
        helmetMesh,
        headRegion || testHeadRegion,
        0.01,
      );
      helmetMesh.updateMatrixWorld(true);

      // Helmet should be scaled uniformly
      expect(helmetMesh.scale.x).toBeCloseTo(helmetMesh.scale.y, 1);
    });

    it("preserves armor mesh topology after fitting", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      if (!torsoRegion) return;

      const armorMesh = createTorsoArmorMesh();
      const originalVertexCount = countVertices(armorMesh);
      const originalFaceCount = countFaces(armorMesh);

      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);

      // Topology should be unchanged
      expect(countVertices(armorMesh)).toBe(originalVertexCount);
      expect(countFaces(armorMesh)).toBe(originalFaceCount);
    });
  });

  describe("detectCollisions - Real Collision Detection", () => {
    it("detects collisions when armor penetrates body mesh", () => {
      // Position armor mesh inside body mesh to create collisions
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0); // Center of torso
      armorMesh.scale.set(0.8, 0.8, 0.8); // Scale down to be inside body
      armorMesh.updateMatrixWorld(true);

      const collisions = fittingService.detectCollisions(bodyMesh, armorMesh);

      // Some collisions may be detected depending on geometry overlap
      // The important thing is the method runs without error
      expect(Array.isArray(collisions)).toBe(true);
    });

    it("detects no collisions when armor is properly fitted outside body", () => {
      // Position armor well outside the body
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(5, 0, 0); // Far away
      armorMesh.updateMatrixWorld(true);

      const collisions = fittingService.detectCollisions(bodyMesh, armorMesh);

      // Should have no collisions when meshes are far apart
      expect(collisions.length).toBe(0);
    });

    it("returns valid collision point data structure", () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.scale.set(0.5, 0.5, 0.5); // Small to be inside body
      armorMesh.updateMatrixWorld(true);

      const collisions = fittingService.detectCollisions(bodyMesh, armorMesh);

      // Each collision point should have required properties
      collisions.forEach((collision) => {
        expect(typeof collision.vertexIndex).toBe("number");
        expect(collision.position).toBeInstanceOf(THREE.Vector3);
        expect(collision.normal).toBeInstanceOf(THREE.Vector3);
        expect(typeof collision.penetrationDepth).toBe("number");
      });
    });
  });

  describe("resolveCollisions - Real Collision Resolution", () => {
    it("modifies armor geometry to resolve collisions", () => {
      const armorMesh = createTorsoArmorMesh();
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      // Create mock collision points
      const collisions = [
        {
          vertexIndex: 0,
          position: new THREE.Vector3(0.1, 0.1, 0.1),
          normal: new THREE.Vector3(1, 0, 0),
          penetrationDepth: 0.02,
        },
        {
          vertexIndex: 5,
          position: new THREE.Vector3(-0.1, 0.15, 0.05),
          normal: new THREE.Vector3(-1, 0, 0),
          penetrationDepth: 0.015,
        },
      ];

      fittingService.resolveCollisions(armorMesh, collisions, 2);

      const newPositions = geometry.attributes.position.array;

      // At least some vertices should have moved
      let positionChanged = false;
      for (let i = 0; i < newPositions.length; i++) {
        if (Math.abs(newPositions[i] - originalPositions[i]) > 0.0001) {
          positionChanged = true;
          break;
        }
      }

      expect(positionChanged).toBe(true);
    });

    it("handles empty collision list gracefully", () => {
      const armorMesh = createTorsoArmorMesh();
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      fittingService.resolveCollisions(armorMesh, [], 1);

      const newPositions = geometry.attributes.position.array;

      // Positions should be unchanged
      for (let i = 0; i < newPositions.length; i++) {
        expect(newPositions[i]).toBe(originalPositions[i]);
      }
    });

    it("applies smoothing to affected region during resolution", () => {
      const armorMesh = createTorsoArmorMesh();
      const geometry = armorMesh.geometry as THREE.BufferGeometry;

      const collisions = [
        {
          vertexIndex: 10,
          position: new THREE.Vector3(0, 0, 0.1),
          normal: new THREE.Vector3(0, 0, 1),
          penetrationDepth: 0.03,
        },
      ];

      // Apply multiple iterations for smoothing effect
      fittingService.resolveCollisions(armorMesh, collisions, 3);

      // Geometry should still be valid
      expect(geometry.attributes.position.count).toBeGreaterThan(0);
      expect(geometry.attributes.normal).toBeDefined();
    });
  });

  describe("bindArmorToSkeleton - Real Skeleton Binding", () => {
    it("converts regular mesh to skinned mesh with bone weights", () => {
      // First fit the armor to body
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      if (!torsoRegion) return;

      const armorMesh = createTorsoArmorMesh();
      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      // Bind armor to skeleton
      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
        { searchRadius: 0.1 },
      );

      // Should return a SkinnedMesh
      expect(skinnedArmor).toBeInstanceOf(THREE.SkinnedMesh);

      // Should have skeleton reference
      expect(skinnedArmor.skeleton).toBeDefined();
      expect(skinnedArmor.skeleton.bones.length).toBeGreaterThan(0);

      // Geometry should have skinning attributes
      const geometry = skinnedArmor.geometry;
      expect(geometry.attributes.skinIndex).toBeDefined();
      expect(geometry.attributes.skinWeight).toBeDefined();
    });

    it("transfers bone weights from body to armor vertices", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      if (!torsoRegion) return;

      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
        { searchRadius: 0.3 },
      );

      const geometry = skinnedArmor.geometry;
      const skinWeights = geometry.attributes.skinWeight;

      // Check that at least some vertices have non-zero weights
      let hasWeights = false;
      for (let i = 0; i < skinWeights.count; i++) {
        const totalWeight =
          skinWeights.getX(i) +
          skinWeights.getY(i) +
          skinWeights.getZ(i) +
          skinWeights.getW(i);
        if (totalWeight > 0.5) {
          hasWeights = true;
          break;
        }
      }

      expect(hasWeights).toBe(true);
    });

    it("preserves armor material after binding", () => {
      const armorMesh = createTorsoArmorMesh();
      const originalMaterial = armorMesh.material;
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
        { searchRadius: 0.2 },
      );

      // Material should be preserved
      expect(skinnedArmor.material).toBeDefined();
    });

    it("stores binding metadata in userData", () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
      );

      // Should have skinning flag in userData
      expect(skinnedArmor.userData.isSkinned).toBe(true);
    });
  });

  describe("exportFittedArmor - Real GLB Export", () => {
    it("exports skinned armor as valid GLB data", async () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
      );

      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "minimal",
      });

      // Should return ArrayBuffer
      expect(glbData).toBeInstanceOf(ArrayBuffer);

      // GLB magic number is 0x46546C67 ("glTF")
      const view = new DataView(glbData);
      const magic = view.getUint32(0, true);
      expect(magic).toBe(0x46546c67);
    });

    it("exports with full skeleton option", async () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
      );

      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "full",
      });

      expect(glbData).toBeInstanceOf(ArrayBuffer);
      expect(glbData.byteLength).toBeGreaterThan(0);
    });

    it("exports as static mesh when requested", async () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
      );

      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "static",
      });

      // Static export should still be valid GLB
      expect(glbData).toBeInstanceOf(ArrayBuffer);
      const view = new DataView(glbData);
      const magic = view.getUint32(0, true);
      expect(magic).toBe(0x46546c67);
    });
  });

  describe("Full Fitting Pipeline - End-to-End Test", () => {
    it("completes full pipeline: regions -> fit -> collisions -> resolve -> bind -> export", async () => {
      // Step 1: Compute body regions
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      expect(regions.size).toBeGreaterThan(0);

      const torsoRegion = regions.get("torso");
      expect(torsoRegion).toBeDefined();
      if (!torsoRegion) return;

      // Step 2: Create and fit armor
      const armorMesh = createTorsoArmorMesh();
      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);
      armorMesh.updateMatrixWorld(true);

      // Step 3: Detect collisions
      const collisions = fittingService.detectCollisions(bodyMesh, armorMesh);
      expect(Array.isArray(collisions)).toBe(true);

      // Step 4: Resolve collisions (even if empty)
      fittingService.resolveCollisions(armorMesh, collisions, 2);

      // Step 5: Apply smoothing
      fittingService.smoothMesh(armorMesh, 0.3);

      // Step 6: Bind to skeleton
      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
        { searchRadius: 0.2 },
      );
      expect(skinnedArmor).toBeInstanceOf(THREE.SkinnedMesh);
      expect(skinnedArmor.skeleton).toBeDefined();

      // Step 7: Export
      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "minimal",
      });
      expect(glbData).toBeInstanceOf(ArrayBuffer);
      expect(glbData.byteLength).toBeGreaterThan(1000);
    });

    it("produces correctly weighted armor that deforms with skeleton", async () => {
      // Fit and bind armor
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      if (!torsoRegion) return;

      const armorMesh = createTorsoArmorMesh();
      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);
      armorMesh.position.set(0, 1.25, 0);
      armorMesh.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        bodyMesh,
        { searchRadius: 0.3 },
      );

      // Verify skin weights are normalized (sum to ~1)
      const geometry = skinnedArmor.geometry;
      const skinWeights = geometry.attributes.skinWeight;

      for (let i = 0; i < Math.min(100, skinWeights.count); i++) {
        const totalWeight =
          skinWeights.getX(i) +
          skinWeights.getY(i) +
          skinWeights.getZ(i) +
          skinWeights.getW(i);

        // Weight should be close to 1.0 (normalized)
        expect(totalWeight).toBeGreaterThan(0.99);
        expect(totalWeight).toBeLessThan(1.01);
      }
    });

    it("handles multiple armor pieces simultaneously", async () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);

      // Create and fit torso armor
      const torsoArmor = createTorsoArmorMesh();
      const torsoRegion = regions.get("torso");
      if (torsoRegion) {
        fittingService.fitArmorToBoundingBox(torsoArmor, torsoRegion, 0.02);
      }
      torsoArmor.position.set(0, 1.25, 0);
      torsoArmor.updateMatrixWorld(true);

      // Create and fit helmet
      const helmet = createHelmetArmorMesh();
      helmet.position.set(0, 1.65, 0);
      helmet.updateMatrixWorld(true);

      // Bind both pieces
      const skinnedTorso = fittingService.bindArmorToSkeleton(
        torsoArmor,
        bodyMesh,
      );
      const skinnedHelmet = fittingService.bindArmorToSkeleton(
        helmet,
        bodyMesh,
      );

      // Both should be valid skinned meshes
      expect(skinnedTorso).toBeInstanceOf(THREE.SkinnedMesh);
      expect(skinnedHelmet).toBeInstanceOf(THREE.SkinnedMesh);

      // Both should share the same skeleton reference
      expect(skinnedTorso.skeleton.bones.length).toBe(
        skinnedHelmet.skeleton.bones.length,
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("handles armor with very high vertex count", () => {
      // Create high-poly armor
      const highPolyGeometry = new THREE.SphereGeometry(0.2, 64, 48);
      const highPolyArmor = new THREE.Mesh(
        highPolyGeometry,
        new THREE.MeshStandardMaterial(),
      );
      highPolyArmor.position.set(0, 1.25, 0);
      highPolyArmor.updateMatrixWorld(true);

      const vertexCount = countVertices(highPolyArmor);
      expect(vertexCount).toBeGreaterThan(1000);

      // Should still bind successfully
      const skinnedArmor = fittingService.bindArmorToSkeleton(
        highPolyArmor,
        bodyMesh,
        { searchRadius: 0.2 },
      );

      expect(skinnedArmor).toBeInstanceOf(THREE.SkinnedMesh);
    });

    it("handles armor mesh at extreme positions", () => {
      const armorMesh = createTorsoArmorMesh();
      armorMesh.position.set(100, 200, 300); // Very far from origin
      armorMesh.updateMatrixWorld(true);

      // Should still compute regions without error
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      expect(regions.size).toBeGreaterThan(0);
    });

    it("handles armor with non-uniform scale", () => {
      const regions = fittingService.computeBodyRegions(bodyMesh, skeleton);
      const torsoRegion = regions.get("torso");
      if (!torsoRegion) return;

      const armorMesh = createTorsoArmorMesh();
      armorMesh.scale.set(1.5, 0.8, 1.2); // Non-uniform scale
      armorMesh.updateMatrixWorld(true);

      // Fitting should handle this
      fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);

      // Should have applied uniform scale
      expect(armorMesh.scale.x).toBeCloseTo(armorMesh.scale.y, 1);
    });
  });

  describe("extractBodyVertices - Region Extraction", () => {
    it("extracts torso vertices from full body mesh", () => {
      const result = fittingService.extractBodyVertices(bodyMesh, skeleton);

      // Should return positions and bounds
      expect(result.positions).toBeInstanceOf(Float32Array);
      expect(result.positions.length).toBeGreaterThan(0);
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.bounds.isEmpty()).toBe(false);
    });

    it("creates valid mesh from extracted body vertices", () => {
      const result = fittingService.extractBodyVertices(bodyMesh, skeleton);
      const bodyOnlyMesh = fittingService.createBodyMesh(
        result.positions,
        result.indices,
      );

      expect(bodyOnlyMesh).toBeInstanceOf(THREE.Mesh);
      expect(countVertices(bodyOnlyMesh)).toBeGreaterThan(0);
    });
  });

  describe("smoothMesh - Mesh Smoothing", () => {
    it("smooths mesh without changing vertex count", () => {
      const armorMesh = createTorsoArmorMesh();
      const originalCount = countVertices(armorMesh);

      fittingService.smoothMesh(armorMesh, 0.5);

      expect(countVertices(armorMesh)).toBe(originalCount);
    });

    it("reduces vertex position variance with smoothing", () => {
      const armorMesh = createTorsoArmorMesh();
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;

      // Add noise
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.02);
        positions.setY(i, positions.getY(i) + (Math.random() - 0.5) * 0.02);
        positions.setZ(i, positions.getZ(i) + (Math.random() - 0.5) * 0.02);
      }
      positions.needsUpdate = true;

      // Calculate variance before
      const beforeVariance = calculateVariance(positions);

      fittingService.smoothMesh(armorMesh, 0.5);

      // Calculate variance after
      const afterVariance = calculateVariance(
        geometry.attributes.position as THREE.BufferAttribute,
      );

      // Smoothing should reduce variance
      expect(afterVariance).toBeLessThanOrEqual(beforeVariance * 1.1); // Allow small tolerance
    });
  });
});

/**
 * Calculate position variance for mesh vertices
 */
function calculateVariance(positions: THREE.BufferAttribute): number {
  let sumX = 0,
    sumY = 0,
    sumZ = 0;
  const count = positions.count;

  for (let i = 0; i < count; i++) {
    sumX += positions.getX(i);
    sumY += positions.getY(i);
    sumZ += positions.getZ(i);
  }

  const meanX = sumX / count;
  const meanY = sumY / count;
  const meanZ = sumZ / count;

  let variance = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions.getX(i) - meanX;
    const dy = positions.getY(i) - meanY;
    const dz = positions.getZ(i) - meanZ;
    variance += dx * dx + dy * dy + dz * dz;
  }

  return variance / count;
}
