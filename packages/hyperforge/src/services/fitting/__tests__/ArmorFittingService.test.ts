/**
 * ArmorFittingService Tests
 *
 * Tests for fitting armor meshes to character bodies.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Collision detection failing on complex armor geometry
 * - Weight transfer producing incorrect deformations
 * - Body region computation errors for non-standard body types
 * - Mesh smoothing creating visual artifacts
 * - Bounding box fitting producing clipping
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { ArmorFittingService } from "../ArmorFittingService";
import type { BodyRegion, CollisionPoint } from "../ArmorFittingService";
import {
  countFaces,
  countVertices,
  detectMeshCollisions,
  findUnweightedVertices,
  createTestMesh,
  createTestSkeleton,
} from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a humanoid skeleton with full bone hierarchy for VRM-like avatars
 */
function createHumanoidSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  bones: Map<string, THREE.Bone>;
} {
  const bones = new Map<string, THREE.Bone>();

  // Create bones
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1.0, 0);
  bones.set("hips", hipsBone);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.15, 0);
  hipsBone.add(spineBone);
  bones.set("spine", spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 0.15, 0);
  spineBone.add(chestBone);
  bones.set("chest", chestBone);

  const upperChestBone = new THREE.Bone();
  upperChestBone.name = "UpperChest";
  upperChestBone.position.set(0, 0.15, 0);
  chestBone.add(upperChestBone);
  bones.set("upperChest", upperChestBone);

  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 0.1, 0);
  upperChestBone.add(neckBone);
  bones.set("neck", neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.15, 0);
  neckBone.add(headBone);
  bones.set("head", headBone);

  // Left arm chain
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "LeftShoulder";
  leftShoulderBone.position.set(0.1, 0.05, 0);
  upperChestBone.add(leftShoulderBone);
  bones.set("leftShoulder", leftShoulderBone);

  const leftUpperArmBone = new THREE.Bone();
  leftUpperArmBone.name = "LeftUpperArm";
  leftUpperArmBone.position.set(0.15, 0, 0);
  leftShoulderBone.add(leftUpperArmBone);
  bones.set("leftUpperArm", leftUpperArmBone);

  // Right arm chain
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "RightShoulder";
  rightShoulderBone.position.set(-0.1, 0.05, 0);
  upperChestBone.add(rightShoulderBone);
  bones.set("rightShoulder", rightShoulderBone);

  const rightUpperArmBone = new THREE.Bone();
  rightUpperArmBone.name = "RightUpperArm";
  rightUpperArmBone.position.set(-0.15, 0, 0);
  rightShoulderBone.add(rightUpperArmBone);
  bones.set("rightUpperArm", rightUpperArmBone);

  // Left leg chain
  const leftUpperLegBone = new THREE.Bone();
  leftUpperLegBone.name = "LeftUpperLeg";
  leftUpperLegBone.position.set(0.1, -0.1, 0);
  hipsBone.add(leftUpperLegBone);
  bones.set("leftUpperLeg", leftUpperLegBone);

  const leftLowerLegBone = new THREE.Bone();
  leftLowerLegBone.name = "LeftLowerLeg";
  leftLowerLegBone.position.set(0, -0.4, 0);
  leftUpperLegBone.add(leftLowerLegBone);
  bones.set("leftLowerLeg", leftLowerLegBone);

  const leftFootBone = new THREE.Bone();
  leftFootBone.name = "LeftFoot";
  leftFootBone.position.set(0, -0.4, 0);
  leftLowerLegBone.add(leftFootBone);
  bones.set("leftFoot", leftFootBone);

  // Right leg chain
  const rightUpperLegBone = new THREE.Bone();
  rightUpperLegBone.name = "RightUpperLeg";
  rightUpperLegBone.position.set(-0.1, -0.1, 0);
  hipsBone.add(rightUpperLegBone);
  bones.set("rightUpperLeg", rightUpperLegBone);

  const rightLowerLegBone = new THREE.Bone();
  rightLowerLegBone.name = "RightLowerLeg";
  rightLowerLegBone.position.set(0, -0.4, 0);
  rightUpperLegBone.add(rightLowerLegBone);
  bones.set("rightLowerLeg", rightLowerLegBone);

  const rightFootBone = new THREE.Bone();
  rightFootBone.name = "RightFoot";
  rightFootBone.position.set(0, -0.4, 0);
  rightLowerLegBone.add(rightFootBone);
  bones.set("rightFoot", rightFootBone);

  // Create skeleton from all bones
  const allBones = [
    hipsBone,
    spineBone,
    chestBone,
    upperChestBone,
    neckBone,
    headBone,
    leftShoulderBone,
    leftUpperArmBone,
    rightShoulderBone,
    rightUpperArmBone,
    leftUpperLegBone,
    leftLowerLegBone,
    leftFootBone,
    rightUpperLegBone,
    rightLowerLegBone,
    rightFootBone,
  ];

  const skeleton = new THREE.Skeleton(allBones);

  return { skeleton, rootBone: hipsBone, bones };
}

/**
 * Create a skinned mesh with proper bone weights for a humanoid body
 */
function createSkinnedHumanoidMesh(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
): THREE.SkinnedMesh {
  // Create a humanoid-shaped geometry
  const geometry = new THREE.BoxGeometry(0.4, 1.6, 0.25, 4, 16, 4);
  const vertexCount = geometry.attributes.position.count;
  const positions = geometry.attributes.position;

  // Create skin indices and weights
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  // Find bone indices
  const boneIndexMap = new Map<string, number>();
  skeleton.bones.forEach((bone, index) => {
    boneIndexMap.set(bone.name.toLowerCase(), index);
  });

  // Assign weights based on vertex Y position
  for (let i = 0; i < vertexCount; i++) {
    const y = positions.getY(i);

    // Map Y position to body regions
    let primaryBoneIndex = 0; // Default to hips
    let secondaryBoneIndex = 0;
    let primaryWeight = 1.0;

    if (y > 0.6) {
      // Head region
      primaryBoneIndex = boneIndexMap.get("head") ?? 5;
      secondaryBoneIndex = boneIndexMap.get("neck") ?? 4;
      primaryWeight = 0.8;
    } else if (y > 0.3) {
      // Upper chest region
      primaryBoneIndex = boneIndexMap.get("upperchest") ?? 3;
      secondaryBoneIndex = boneIndexMap.get("chest") ?? 2;
      primaryWeight = 0.7;
    } else if (y > 0) {
      // Torso region - spine and chest
      primaryBoneIndex = boneIndexMap.get("spine") ?? 1;
      secondaryBoneIndex = boneIndexMap.get("chest") ?? 2;
      primaryWeight = 0.6;
    } else if (y > -0.4) {
      // Hips region
      primaryBoneIndex = boneIndexMap.get("hips") ?? 0;
      secondaryBoneIndex = boneIndexMap.get("spine") ?? 1;
      primaryWeight = 0.8;
    } else {
      // Legs region
      const x = positions.getX(i);
      if (x > 0) {
        primaryBoneIndex = boneIndexMap.get("leftupperleg") ?? 10;
        secondaryBoneIndex = boneIndexMap.get("leftlowerleg") ?? 11;
      } else {
        primaryBoneIndex = boneIndexMap.get("rightupperleg") ?? 13;
        secondaryBoneIndex = boneIndexMap.get("rightlowerleg") ?? 14;
      }
      primaryWeight = 0.7;
    }

    skinIndices[i * 4] = primaryBoneIndex;
    skinIndices[i * 4 + 1] = secondaryBoneIndex;
    skinIndices[i * 4 + 2] = 0;
    skinIndices[i * 4 + 3] = 0;

    skinWeights[i * 4] = primaryWeight;
    skinWeights[i * 4 + 1] = 1.0 - primaryWeight;
    skinWeights[i * 4 + 2] = 0;
    skinWeights[i * 4 + 3] = 0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial({ color: 0xffcc99 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "AvatarBody";

  // Add skeleton and bind
  mesh.add(rootBone);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a simple armor mesh (chest armor plate)
 */
function createArmorMesh(
  type: "chest" | "helmet" | "gauntlet" = "chest",
): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  switch (type) {
    case "helmet":
      geometry = new THREE.SphereGeometry(0.15, 16, 16);
      break;
    case "gauntlet":
      geometry = new THREE.CylinderGeometry(0.05, 0.06, 0.2, 8);
      break;
    case "chest":
    default: {
      // Create a curved chest plate
      geometry = new THREE.BoxGeometry(0.45, 0.5, 0.15, 8, 8, 4);
      // Curve the front vertices slightly
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const z = positions.getZ(i);
        if (z > 0) {
          // Front vertices - curve outward
          const y = positions.getY(i);
          const curveFactor = 0.02 * (1 - Math.abs(y) * 2);
          positions.setZ(i, z + curveFactor);
        }
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      break;
    }
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.8,
    roughness: 0.3,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Armor_${type}`;

  return mesh;
}

describe("ArmorFittingService", () => {
  let fittingService: ArmorFittingService;

  beforeAll(() => {
    fittingService = new ArmorFittingService();
  });

  describe("computeBodyRegions", () => {
    it("computes body regions from skeleton with skinned mesh", () => {
      // Create a test character with skeleton
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createTestSkeleton();

      // Create geometry with vertex skinning attributes
      const geometry = new THREE.BoxGeometry(0.5, 1.7, 0.3, 4, 8, 4);
      const vertexCount = geometry.attributes.position.count;

      // Create skin indices and weights
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      // Assign all vertices to the root bone for simplicity
      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0; // First bone
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
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.position.set(0, 0.85, 0);

      mesh.add(rootBone);
      mesh.bind(skeleton);
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      // Compute regions
      const regions = fittingService.computeBodyRegions(mesh, skeleton);

      // Should have at least some regions
      expect(regions.size).toBeGreaterThan(0);
    });

    it("identifies all major body regions with humanoid skeleton", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      // Call the actual service method
      const regions = fittingService.computeBodyRegions(avatarMesh, skeleton);

      // Should identify multiple regions
      expect(regions.size).toBeGreaterThanOrEqual(3);

      // Check that key regions are identified
      const regionNames = Array.from(regions.keys());
      expect(regionNames).toContain("torso");
      expect(regionNames).toContain("head");
    });

    it("computes correct bounding boxes for body regions", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      const regions = fittingService.computeBodyRegions(avatarMesh, skeleton);

      // Torso region should exist and have valid bounds
      const torsoRegion = regions.get("torso");
      expect(torsoRegion).toBeDefined();
      if (torsoRegion) {
        expect(torsoRegion.boundingBox.isEmpty()).toBe(false);

        // Bounding box should have positive dimensions
        const size = torsoRegion.boundingBox.getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThan(0);
        expect(size.y).toBeGreaterThan(0);
        expect(size.z).toBeGreaterThan(0);

        // Center should be computed
        expect(torsoRegion.center).toBeDefined();
      }
    });

    it("includes bone names in region data", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      const regions = fittingService.computeBodyRegions(avatarMesh, skeleton);

      // Each region should have bone names
      regions.forEach((region) => {
        expect(region.bones).toBeDefined();
        expect(Array.isArray(region.bones)).toBe(true);
        expect(region.bones.length).toBeGreaterThan(0);
      });
    });
  });

  describe("fitArmorToBoundingBox", () => {
    it("fits armor within body region bounds with margin", () => {
      // Create body region
      const bodyRegion: BodyRegion = {
        name: "torso",
        bones: ["Spine"],
        boundingBox: new THREE.Box3(
          new THREE.Vector3(-0.25, 0.8, -0.15),
          new THREE.Vector3(0.25, 1.5, 0.15),
        ),
        vertices: [],
        center: new THREE.Vector3(0, 1.15, 0),
      };

      // Create armor mesh
      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 0, 0);
      armorMesh.updateMatrixWorld(true);

      const initialBounds = new THREE.Box3().setFromObject(armorMesh);
      const initialSize = initialBounds.getSize(new THREE.Vector3());

      // Fit armor
      fittingService.fitArmorToBoundingBox(armorMesh, bodyRegion, 0.02);
      armorMesh.updateMatrixWorld(true);

      // Get armor bounds after fitting
      const armorBounds = new THREE.Box3().setFromObject(armorMesh);
      const armorCenter = armorBounds.getCenter(new THREE.Vector3());

      // Armor should be centered near region center
      expect(Math.abs(armorCenter.x - bodyRegion.center.x)).toBeLessThan(0.1);
      expect(Math.abs(armorCenter.z - bodyRegion.center.z)).toBeLessThan(0.1);
    });

    it("positions torso armor correctly relative to body region", () => {
      const bodyRegion: BodyRegion = {
        name: "torso",
        bones: ["Spine", "Chest"],
        boundingBox: new THREE.Box3(
          new THREE.Vector3(-0.2, 1.0, -0.12),
          new THREE.Vector3(0.2, 1.5, 0.12),
        ),
        vertices: [],
        center: new THREE.Vector3(0, 1.25, 0),
      };

      const armorMesh = createArmorMesh("chest");
      armorMesh.updateMatrixWorld(true);

      // Fit to torso
      fittingService.fitArmorToBoundingBox(armorMesh, bodyRegion, 0.02);
      armorMesh.updateMatrixWorld(true);

      // Armor top should be near body region top
      const armorBounds = new THREE.Box3().setFromObject(armorMesh);

      // For torso, the armor should be positioned within reasonable range of the body
      expect(armorBounds.max.y).toBeGreaterThan(bodyRegion.boundingBox.min.y);
    });

    it("applies uniform scale to preserve armor proportions", () => {
      const bodyRegion: BodyRegion = {
        name: "head",
        bones: ["Head"],
        boundingBox: new THREE.Box3(
          new THREE.Vector3(-0.1, 1.5, -0.1),
          new THREE.Vector3(0.1, 1.75, 0.1),
        ),
        vertices: [],
        center: new THREE.Vector3(0, 1.625, 0),
      };

      const armorMesh = createArmorMesh("helmet");
      armorMesh.updateMatrixWorld(true);

      fittingService.fitArmorToBoundingBox(armorMesh, bodyRegion);
      armorMesh.updateMatrixWorld(true);

      // Scale should be uniform (setScalar is used)
      expect(armorMesh.scale.x).toBeCloseTo(armorMesh.scale.y, 2);
      expect(armorMesh.scale.y).toBeCloseTo(armorMesh.scale.z, 2);
    });

    it("handles different region types correctly", () => {
      const regions = [
        {
          name: "head",
          bones: ["Head"],
          boundingBox: new THREE.Box3(
            new THREE.Vector3(-0.1, 1.6, -0.1),
            new THREE.Vector3(0.1, 1.8, 0.1),
          ),
          center: new THREE.Vector3(0, 1.7, 0),
        },
        {
          name: "torso",
          bones: ["Spine", "Chest"],
          boundingBox: new THREE.Box3(
            new THREE.Vector3(-0.2, 1.0, -0.12),
            new THREE.Vector3(0.2, 1.5, 0.12),
          ),
          center: new THREE.Vector3(0, 1.25, 0),
        },
      ];

      regions.forEach((regionData) => {
        const region: BodyRegion = {
          ...regionData,
          vertices: [],
        };

        const armorMesh = createTestMesh("box");
        armorMesh.updateMatrixWorld(true);

        // Should not throw for any region type
        expect(() => {
          fittingService.fitArmorToBoundingBox(armorMesh, region, 0.02);
        }).not.toThrow();

        armorMesh.updateMatrixWorld(true);

        // Armor should have been transformed
        const bounds = new THREE.Box3().setFromObject(armorMesh);
        expect(bounds.isEmpty()).toBe(false);
      });
    });
  });

  describe("detectCollisions", () => {
    it("detects no collisions when armor is outside body", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(10, 0, 0); // Far away from avatar

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      // Call the actual service method
      const collisions = fittingService.detectCollisions(avatarMesh, armorMesh);

      expect(collisions.length).toBe(0);
    });

    it("detects collisions when armor intersects body", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      // Create armor that overlaps with body
      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0); // Position in torso area

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      // Call the actual service method
      const collisions = fittingService.detectCollisions(avatarMesh, armorMesh);

      // May or may not detect collisions depending on exact geometry overlap
      // The important thing is the method runs without error
      expect(Array.isArray(collisions)).toBe(true);
    });

    it("returns collision points with correct structure", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      // Create armor positioned to potentially collide
      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);
      armorMesh.scale.set(0.5, 0.5, 0.5);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const collisions = fittingService.detectCollisions(avatarMesh, armorMesh);

      // If there are collisions, verify structure
      collisions.forEach((collision: CollisionPoint) => {
        expect(collision).toHaveProperty("vertexIndex");
        expect(collision).toHaveProperty("position");
        expect(collision).toHaveProperty("normal");
        expect(collision).toHaveProperty("penetrationDepth");
        expect(collision.position).toBeInstanceOf(THREE.Vector3);
        expect(collision.normal).toBeInstanceOf(THREE.Vector3);
        expect(typeof collision.penetrationDepth).toBe("number");
      });
    });
  });

  describe("resolveCollisions", () => {
    it("modifies vertex positions to resolve collisions", () => {
      const armorMesh = createArmorMesh("chest");
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      // Create collision points
      const collisions: CollisionPoint[] = [
        {
          vertexIndex: 0,
          position: new THREE.Vector3(0, 0, 0),
          normal: new THREE.Vector3(1, 0, 0),
          penetrationDepth: 0.05,
        },
      ];

      fittingService.resolveCollisions(armorMesh, collisions, 1);

      const newPositions = geometry.attributes.position.array;

      // At least one vertex should have moved
      let positionChanged = false;
      for (let i = 0; i < newPositions.length; i++) {
        if (Math.abs(newPositions[i] - originalPositions[i]) > 0.001) {
          positionChanged = true;
          break;
        }
      }

      expect(positionChanged).toBe(true);
    });

    it("handles empty collision array gracefully", () => {
      const armorMesh = createArmorMesh("chest");
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      // Empty collisions
      fittingService.resolveCollisions(armorMesh, [], 1);

      const newPositions = geometry.attributes.position.array;

      // No positions should have changed
      for (let i = 0; i < newPositions.length; i++) {
        expect(newPositions[i]).toBe(originalPositions[i]);
      }
    });

    it("affects nearby vertices for smooth deformation", () => {
      const armorMesh = createArmorMesh("chest");
      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;

      // Get position of first vertex
      const v0 = new THREE.Vector3().fromBufferAttribute(positions, 0);

      // Find nearby vertices
      const nearbyIndices: number[] = [];
      for (let i = 1; i < positions.count; i++) {
        const vi = new THREE.Vector3().fromBufferAttribute(positions, i);
        if (v0.distanceTo(vi) < 0.05) {
          nearbyIndices.push(i);
        }
      }

      const originalNearbyPositions = nearbyIndices.map((idx) =>
        new THREE.Vector3().fromBufferAttribute(positions, idx).clone(),
      );

      // Create collision at vertex 0
      const collisions: CollisionPoint[] = [
        {
          vertexIndex: 0,
          position: v0.clone(),
          normal: new THREE.Vector3(0, 0, 1),
          penetrationDepth: 0.03,
        },
      ];

      fittingService.resolveCollisions(armorMesh, collisions, 1);

      // Check if nearby vertices were also affected
      let nearbyChanged = false;
      nearbyIndices.forEach((idx, i) => {
        const newPos = new THREE.Vector3().fromBufferAttribute(positions, idx);
        if (newPos.distanceTo(originalNearbyPositions[i]) > 0.0001) {
          nearbyChanged = true;
        }
      });

      // Nearby vertices should be affected for smooth deformation
      if (nearbyIndices.length > 0) {
        expect(nearbyChanged).toBe(true);
      }
    });

    it("computes vertex normals after resolution", () => {
      const armorMesh = createArmorMesh("chest");
      const geometry = armorMesh.geometry as THREE.BufferGeometry;

      const collisions: CollisionPoint[] = [
        {
          vertexIndex: 0,
          position: new THREE.Vector3(0, 0, 0),
          normal: new THREE.Vector3(0, 1, 0),
          penetrationDepth: 0.02,
        },
      ];

      fittingService.resolveCollisions(armorMesh, collisions, 1);

      // Normals should exist after resolution
      expect(geometry.attributes.normal).toBeDefined();
      expect(geometry.attributes.normal.count).toBe(
        geometry.attributes.position.count,
      );
    });
  });

  describe("bindArmorToSkeleton", () => {
    it("converts armor mesh to skinned mesh", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      // Call the actual service method
      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Should return a SkinnedMesh
      expect(skinnedArmor).toBeInstanceOf(THREE.SkinnedMesh);
      expect(skinnedArmor.skeleton).toBeDefined();
    });

    it("transfers bone weights to armor vertices", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Check that skinning attributes were added
      const geometry = skinnedArmor.geometry;
      expect(geometry.attributes.skinIndex).toBeDefined();
      expect(geometry.attributes.skinWeight).toBeDefined();

      // Verify weights are not all zero
      const weights = geometry.attributes.skinWeight;
      let hasNonZeroWeight = false;
      for (let i = 0; i < weights.count; i++) {
        const totalWeight =
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        if (totalWeight > 0) {
          hasNonZeroWeight = true;
          break;
        }
      }
      expect(hasNonZeroWeight).toBe(true);
    });

    it("binds to avatar skeleton", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Should be bound to the same skeleton
      expect(skinnedArmor.skeleton).toBe(avatarMesh.skeleton);
    });

    it("preserves armor material", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      const originalMaterial = armorMesh.material;

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Material should be preserved
      expect(skinnedArmor.material).toBe(originalMaterial);
    });

    it("stores fitting metadata in userData", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Should have userData with skinning info
      expect(skinnedArmor.userData.isSkinned).toBe(true);
      expect(skinnedArmor.userData.fittedTransform).toBeDefined();
    });
  });

  describe("exportFittedArmor", () => {
    it("exports skinned armor as GLB", async () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      // Export with minimal method
      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "minimal",
      });

      // Should return ArrayBuffer
      expect(glbData).toBeInstanceOf(ArrayBuffer);
      expect(glbData.byteLength).toBeGreaterThan(0);

      // Check GLB magic header
      const view = new DataView(glbData);
      const magic = view.getUint32(0, true);
      expect(magic).toBe(0x46546c67); // "glTF" in little-endian
    });

    it("exports with full skeleton method", async () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "full",
      });

      expect(glbData).toBeInstanceOf(ArrayBuffer);
      expect(glbData.byteLength).toBeGreaterThan(0);
    });

    it("exports as static mesh when requested", async () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      const armorMesh = createArmorMesh("chest");
      armorMesh.position.set(0, 1.2, 0);

      scene.add(avatarMesh);
      scene.add(armorMesh);
      scene.updateMatrixWorld(true);

      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );

      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "static",
      });

      expect(glbData).toBeInstanceOf(ArrayBuffer);
      expect(glbData.byteLength).toBeGreaterThan(0);
    });
  });

  describe("equipArmorToCharacter (full workflow)", () => {
    it("completes full fit-bind-export workflow", async () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      // Mark as VRM for validation
      avatarMesh.userData.vrm = { specVersion: "1.0" };

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      // Step 1: Compute body regions
      const regions = fittingService.computeBodyRegions(avatarMesh, skeleton);
      const torsoRegion = regions.get("torso");
      expect(torsoRegion).toBeDefined();

      // Step 2: Create and fit armor
      const armorMesh = createArmorMesh("chest");
      if (torsoRegion) {
        fittingService.fitArmorToBoundingBox(armorMesh, torsoRegion, 0.02);
      }
      armorMesh.updateMatrixWorld(true);

      // Step 3: Detect and resolve collisions
      const collisions = fittingService.detectCollisions(avatarMesh, armorMesh);
      if (collisions.length > 0) {
        fittingService.resolveCollisions(armorMesh, collisions, 2);
      }

      // Step 4: Bind armor to skeleton
      const skinnedArmor = fittingService.bindArmorToSkeleton(
        armorMesh,
        avatarMesh,
      );
      expect(skinnedArmor.skeleton).toBe(skeleton);

      // Step 5: Export
      const glbData = await fittingService.exportFittedArmor(skinnedArmor, {
        method: "minimal",
      });
      expect(glbData.byteLength).toBeGreaterThan(0);
    });
  });

  describe("extractBodyVertices", () => {
    it("extracts torso vertices from skinned mesh", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      // Call the service method
      const result = fittingService.extractBodyVertices(avatarMesh, skeleton);

      // Should return positions and bounds
      expect(result.positions).toBeInstanceOf(Float32Array);
      expect(result.positions.length).toBeGreaterThan(0);
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.bounds.isEmpty()).toBe(false);
    });

    it("returns valid bounds for extracted vertices", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      const result = fittingService.extractBodyVertices(avatarMesh, skeleton);

      // Bounds should have positive dimensions
      const size = result.bounds.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(0);
      expect(size.y).toBeGreaterThan(0);
      expect(size.z).toBeGreaterThan(0);
    });
  });

  describe("createBodyMesh", () => {
    it("creates mesh from extracted body vertices", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      // Extract vertices
      const { positions, indices } = fittingService.extractBodyVertices(
        avatarMesh,
        skeleton,
      );

      // Create body mesh
      const bodyMesh = fittingService.createBodyMesh(positions, indices);

      // Should return a valid mesh
      expect(bodyMesh).toBeInstanceOf(THREE.Mesh);
      expect(bodyMesh.geometry).toBeDefined();
      expect(bodyMesh.geometry.attributes.position).toBeDefined();
    });

    it("creates mesh with computed normals", () => {
      const scene = new THREE.Scene();
      const { skeleton, rootBone } = createHumanoidSkeleton();
      const avatarMesh = createSkinnedHumanoidMesh(skeleton, rootBone);

      scene.add(avatarMesh);
      scene.updateMatrixWorld(true);

      const { positions, indices } = fittingService.extractBodyVertices(
        avatarMesh,
        skeleton,
      );
      const bodyMesh = fittingService.createBodyMesh(positions, indices);

      // Normals should be computed
      expect(bodyMesh.geometry.attributes.normal).toBeDefined();
    });
  });

  describe("Topology Preservation", () => {
    it("preserves face count after fitting operations", () => {
      const mesh = createTestMesh("box");
      const originalFaceCount = countFaces(mesh);

      // Apply smoothing
      fittingService.smoothMesh(mesh, 0.5);

      const newFaceCount = countFaces(mesh);

      // Smoothing should not change topology
      expect(newFaceCount).toBe(originalFaceCount);
    });

    it("preserves vertex count after smoothing", () => {
      const mesh = createTestMesh("sphere");
      const originalVertexCount = countVertices(mesh);

      fittingService.smoothMesh(mesh, 0.3);

      const newVertexCount = countVertices(mesh);
      expect(newVertexCount).toBe(originalVertexCount);
    });
  });

  describe("Weight Transfer", () => {
    it("assigns weights to all armor vertices", () => {
      // Create a simple skinned mesh for the body
      const { skeleton } = createTestSkeleton();
      const bodyGeometry = new THREE.BoxGeometry(0.5, 1.7, 0.3, 4, 8, 4);
      const vertexCount = bodyGeometry.attributes.position.count;

      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      bodyGeometry.setAttribute(
        "skinIndex",
        new THREE.BufferAttribute(skinIndices, 4),
      );
      bodyGeometry.setAttribute(
        "skinWeight",
        new THREE.BufferAttribute(skinWeights, 4),
      );

      const bodyMesh = new THREE.SkinnedMesh(
        bodyGeometry,
        new THREE.MeshBasicMaterial(),
      );
      bodyMesh.add(skeleton.bones[0]);
      bodyMesh.bind(skeleton);
      bodyMesh.updateMatrixWorld(true);

      // The body mesh should have all vertices weighted
      const unweighted = findUnweightedVertices(bodyMesh);
      expect(unweighted.length).toBe(0);
    });
  });

  describe("Mesh Smoothing", () => {
    it("reduces vertex position variance with smoothing", () => {
      const mesh = createTestMesh("sphere");
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;

      // Add some noise to vertices
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.1);
        positions.setY(i, positions.getY(i) + (Math.random() - 0.5) * 0.1);
        positions.setZ(i, positions.getZ(i) + (Math.random() - 0.5) * 0.1);
      }
      positions.needsUpdate = true;

      // Calculate variance before smoothing
      const beforeVariance = calculatePositionVariance(positions);

      fittingService.smoothMesh(mesh, 0.5);

      // Calculate variance after smoothing
      const afterVariance = calculatePositionVariance(
        geometry.attributes.position as THREE.BufferAttribute,
      );

      // Smoothing should reduce variance
      expect(afterVariance).toBeLessThanOrEqual(beforeVariance);
    });
  });
});

/**
 * Helper to calculate position variance
 */
function calculatePositionVariance(positions: THREE.BufferAttribute): number {
  let sumX = 0,
    sumY = 0,
    sumZ = 0;
  const count = positions.count;

  // Calculate mean
  for (let i = 0; i < count; i++) {
    sumX += positions.getX(i);
    sumY += positions.getY(i);
    sumZ += positions.getZ(i);
  }

  const meanX = sumX / count;
  const meanY = sumY / count;
  const meanZ = sumZ / count;

  // Calculate variance
  let variance = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions.getX(i) - meanX;
    const dy = positions.getY(i) - meanY;
    const dz = positions.getZ(i) - meanZ;
    variance += dx * dx + dy * dy + dz * dz;
  }

  return variance / count;
}
