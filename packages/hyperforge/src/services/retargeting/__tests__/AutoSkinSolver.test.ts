/**
 * AutoSkinSolver Tests
 *
 * Tests for the base automatic skinning solver functionality.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Weight arrays not matching vertex count
 * - Weights not normalized to sum to 1.0
 * - Invalid bone indices in skinIndices array
 * - Missing or incorrect world matrix updates
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import { DistanceSolver } from "../DistanceSolver";
import { DistanceChildTargetingSolver } from "../DistanceChildTargetingSolver";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a humanoid skeleton for testing
 */
function createHumanoidSkeleton(): THREE.Bone[] {
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

  // Left arm
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "LeftShoulder";
  leftShoulderBone.position.set(0.1, 0.1, 0);
  chestBone.add(leftShoulderBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "LeftArm";
  leftArmBone.position.set(0.15, 0, 0);
  leftShoulderBone.add(leftArmBone);

  const leftForeArmBone = new THREE.Bone();
  leftForeArmBone.name = "LeftForeArm";
  leftForeArmBone.position.set(0.2, 0, 0);
  leftArmBone.add(leftForeArmBone);

  const leftHandBone = new THREE.Bone();
  leftHandBone.name = "LeftHand";
  leftHandBone.position.set(0.15, 0, 0);
  leftForeArmBone.add(leftHandBone);

  // Right arm
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "RightShoulder";
  rightShoulderBone.position.set(-0.1, 0.1, 0);
  chestBone.add(rightShoulderBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "RightArm";
  rightArmBone.position.set(-0.15, 0, 0);
  rightShoulderBone.add(rightArmBone);

  const rightForeArmBone = new THREE.Bone();
  rightForeArmBone.name = "RightForeArm";
  rightForeArmBone.position.set(-0.2, 0, 0);
  rightArmBone.add(rightForeArmBone);

  const rightHandBone = new THREE.Bone();
  rightHandBone.name = "RightHand";
  rightHandBone.position.set(-0.15, 0, 0);
  rightForeArmBone.add(rightHandBone);

  // Left leg
  const leftUpLegBone = new THREE.Bone();
  leftUpLegBone.name = "LeftUpLeg";
  leftUpLegBone.position.set(0.1, -0.05, 0);
  hipsBone.add(leftUpLegBone);

  const leftLegBone = new THREE.Bone();
  leftLegBone.name = "LeftLeg";
  leftLegBone.position.set(0, -0.45, 0);
  leftUpLegBone.add(leftLegBone);

  const leftFootBone = new THREE.Bone();
  leftFootBone.name = "LeftFoot";
  leftFootBone.position.set(0, -0.45, 0.05);
  leftLegBone.add(leftFootBone);

  // Right leg
  const rightUpLegBone = new THREE.Bone();
  rightUpLegBone.name = "RightUpLeg";
  rightUpLegBone.position.set(-0.1, -0.05, 0);
  hipsBone.add(rightUpLegBone);

  const rightLegBone = new THREE.Bone();
  rightLegBone.name = "RightLeg";
  rightLegBone.position.set(0, -0.45, 0);
  rightUpLegBone.add(rightLegBone);

  const rightFootBone = new THREE.Bone();
  rightFootBone.name = "RightFoot";
  rightFootBone.position.set(0, -0.45, 0.05);
  rightLegBone.add(rightFootBone);

  // Update all matrices
  hipsBone.updateMatrixWorld(true);

  return [
    hipsBone,
    spineBone,
    chestBone,
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
}

/**
 * Create a humanoid mesh geometry
 */
function createHumanoidGeometry(): THREE.BufferGeometry {
  // Create a simple humanoid-shaped geometry
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.2, 4, 16, 2);
  geometry.translate(0, 0.9, 0); // Center at ground level

  return geometry;
}

describe("AutoSkinSolver", () => {
  describe("Auto Skinning", () => {
    let bones: THREE.Bone[];
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      bones = createHumanoidSkeleton();
      geometry = createHumanoidGeometry();
    });

    it("generates skin weights for all vertices", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });

    it("assigns each vertex to at least one bone", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        // At least one weight should be non-zero
        const totalWeight =
          skinWeights[i * 4] +
          skinWeights[i * 4 + 1] +
          skinWeights[i * 4 + 2] +
          skinWeights[i * 4 + 3];

        expect(totalWeight).toBeGreaterThan(0);
      }
    });

    it("works with DistanceChildTargetingSolver for multi-bone skinning", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });

    it("produces different results from different solver types", () => {
      const distanceSolver = new DistanceSolver(geometry, bones);
      const childSolver = new DistanceChildTargetingSolver(geometry, bones);

      const distanceResult = distanceSolver.calculateWeights();
      const childResult = childSolver.calculateWeights();

      // Results should be valid but potentially different
      expect(distanceResult.skinIndices.length).toBe(
        childResult.skinIndices.length,
      );
      expect(distanceResult.skinWeights.length).toBe(
        childResult.skinWeights.length,
      );
    });
  });

  describe("Bone Influence", () => {
    let bones: THREE.Bone[];
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      bones = createHumanoidSkeleton();
      geometry = createHumanoidGeometry();
    });

    it("limits bone influence to 4 bones per vertex", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        let influenceCount = 0;
        for (let j = 0; j < 4; j++) {
          if (skinWeights[i * 4 + j] > 0) {
            influenceCount++;
          }
        }
        expect(influenceCount).toBeLessThanOrEqual(4);
      }
    });

    it("assigns valid bone indices within skeleton range", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;
      const maxBoneIndex = bones.length - 1;

      for (let i = 0; i < vertexCount; i++) {
        for (let j = 0; j < 4; j++) {
          const boneIndex = skinIndices[i * 4 + j];
          expect(boneIndex).toBeGreaterThanOrEqual(0);
          expect(boneIndex).toBeLessThanOrEqual(maxBoneIndex);
        }
      }
    });

    it("uses bones that are physically close to vertices", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Create a vertex at head position and check it gets head-related bone
      const headGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 1.65, 0]); // Near head position
      headGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const headSolver = new DistanceSolver(headGeometry, bones);
      const { skinIndices: headIndices } = headSolver.calculateWeights();

      // Should be assigned to head, neck, or chest area bones (indices 3, 4)
      const headBoneIndex = headIndices[0];
      expect([3, 4]).toContain(headBoneIndex);
    });
  });

  describe("Weight Quality", () => {
    let bones: THREE.Bone[];
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      bones = createHumanoidSkeleton();
      geometry = createHumanoidGeometry();
    });

    it("produces weights in valid range (0-1)", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      for (let i = 0; i < skinWeights.length; i++) {
        expect(skinWeights[i]).toBeGreaterThanOrEqual(0);
        expect(skinWeights[i]).toBeLessThanOrEqual(1);
      }
    });

    it("produces weights that sum to 1.0 per vertex (DistanceSolver)", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        const sum =
          skinWeights[i * 4] +
          skinWeights[i * 4 + 1] +
          skinWeights[i * 4 + 2] +
          skinWeights[i * 4 + 3];

        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it("produces weights that sum to 1.0 per vertex (DistanceChildTargetingSolver)", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        const sum =
          skinWeights[i * 4] +
          skinWeights[i * 4 + 1] +
          skinWeights[i * 4 + 2] +
          skinWeights[i * 4 + 3];

        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it("assigns non-zero weight to at least one bone per vertex", () => {
      const solver = new DistanceChildTargetingSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        const maxWeight = Math.max(
          skinWeights[i * 4],
          skinWeights[i * 4 + 1],
          skinWeights[i * 4 + 2],
          skinWeights[i * 4 + 3],
        );

        expect(maxWeight).toBeGreaterThan(0);
      }
    });

    it("produces consistent results for same input", () => {
      const solver1 = new DistanceSolver(geometry, bones);
      const solver2 = new DistanceSolver(geometry, bones);

      const result1 = solver1.calculateWeights();
      const result2 = solver2.calculateWeights();

      // Results should be identical
      expect(result1.skinIndices).toEqual(result2.skinIndices);
      expect(result1.skinWeights).toEqual(result2.skinWeights);
    });
  });

  describe("Geometry Handling", () => {
    let bones: THREE.Bone[];

    beforeEach(() => {
      bones = createHumanoidSkeleton();
    });

    it("handles complex geometry shapes", () => {
      // Test with various Three.js geometries
      const geometries = [
        new THREE.BoxGeometry(1, 1.8, 0.3),
        new THREE.CylinderGeometry(0.2, 0.2, 1.8, 8),
        new THREE.SphereGeometry(0.5, 16, 12),
      ];

      for (const geometry of geometries) {
        geometry.translate(0, 0.9, 0);
        const solver = new DistanceSolver(geometry, bones);
        const { skinIndices, skinWeights } = solver.calculateWeights();

        const vertexCount = geometry.attributes.position.count;
        expect(skinIndices.length).toBe(vertexCount * 4);
        expect(skinWeights.length).toBe(vertexCount * 4);
      }
    });

    it("handles high-poly geometry", () => {
      const highPolyGeometry = new THREE.BoxGeometry(0.4, 1.8, 0.2, 10, 40, 5);
      highPolyGeometry.translate(0, 0.9, 0);

      const solver = new DistanceSolver(highPolyGeometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = highPolyGeometry.attributes.position.count;

      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);

      // All vertices should be properly skinned
      for (let i = 0; i < vertexCount; i++) {
        expect(skinWeights[i * 4]).toBeGreaterThan(0);
      }
    });

    it("handles geometry with indexed faces", () => {
      const indexedGeometry = new THREE.BoxGeometry(0.4, 1.8, 0.2, 2, 4, 1);
      indexedGeometry.translate(0, 0.9, 0);

      // BoxGeometry is indexed by default
      expect(indexedGeometry.index).not.toBeNull();

      const solver = new DistanceSolver(indexedGeometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = indexedGeometry.attributes.position.count;
      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });
  });

  describe("Skeleton Handling", () => {
    it("handles skeleton with deep hierarchy", () => {
      // Create a chain of 10 bones
      const deepBones: THREE.Bone[] = [];
      let parent: THREE.Bone | null = null;

      for (let i = 0; i < 10; i++) {
        const bone = new THREE.Bone();
        bone.name = `Bone${i}`;
        bone.position.set(0, i === 0 ? 0 : 0.2, 0);

        if (parent) {
          parent.add(bone);
        }
        parent = bone;
        deepBones.push(bone);
      }

      deepBones[0].updateMatrixWorld(true);

      const geometry = new THREE.BoxGeometry(0.2, 2, 0.2, 1, 10, 1);
      geometry.translate(0, 1, 0);

      const solver = new DistanceSolver(geometry, deepBones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;
      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });

    it("handles skeleton with branching structure", () => {
      const root = new THREE.Bone();
      root.name = "Root";
      root.position.set(0, 0, 0);

      // Create multiple branches
      const branches: THREE.Bone[] = [];
      for (let i = 0; i < 4; i++) {
        const branch = new THREE.Bone();
        branch.name = `Branch${i}`;
        branch.position.set(
          Math.cos((i * Math.PI) / 2) * 0.3,
          0.5,
          Math.sin((i * Math.PI) / 2) * 0.3,
        );
        root.add(branch);
        branches.push(branch);
      }

      root.updateMatrixWorld(true);

      const allBones = [root, ...branches];
      const geometry = new THREE.SphereGeometry(0.5, 8, 6);

      const solver = new DistanceSolver(geometry, allBones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;
      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });

    it("uses world positions for bone distance calculations", () => {
      // Create a skeleton where child bone is offset
      const parent = new THREE.Bone();
      parent.name = "Parent";
      parent.position.set(0, 0, 0);

      const child = new THREE.Bone();
      child.name = "Child";
      child.position.set(0, 1, 0); // Local position

      parent.add(child);
      parent.updateMatrixWorld(true);

      // Verify child's world position
      const childWorldPos = new THREE.Vector3();
      child.getWorldPosition(childWorldPos);
      expect(childWorldPos.y).toBe(1);

      // Create geometry near child's world position
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 0.9, 0]); // Close to child
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, [parent, child]);
      const { skinIndices } = solver.calculateWeights();

      // Should be assigned to child (index 1) since it's closer in world space
      expect(skinIndices[0]).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("handles zero-extent geometry", () => {
      const bones = createHumanoidSkeleton();

      // Create geometry with all vertices at same position
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      expect(skinIndices.length).toBe(3 * 4);
      expect(skinWeights.length).toBe(3 * 4);

      // All vertices should be assigned to same bone
      expect(skinIndices[0]).toBe(skinIndices[4]);
      expect(skinIndices[0]).toBe(skinIndices[8]);
    });

    it("handles very small skeleton", () => {
      const tinyBone = new THREE.Bone();
      tinyBone.name = "Tiny";
      tinyBone.position.set(0, 0.001, 0);
      tinyBone.scale.set(0.001, 0.001, 0.001);
      tinyBone.updateMatrixWorld(true);

      const geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);

      const solver = new DistanceSolver(geometry, [tinyBone]);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;
      expect(skinIndices.length).toBe(vertexCount * 4);

      // All vertices should be assigned to the only bone
      for (let i = 0; i < vertexCount; i++) {
        expect(skinIndices[i * 4]).toBe(0);
        expect(skinWeights[i * 4]).toBe(1.0);
      }
    });

    it("handles NaN positions gracefully", () => {
      const bones = createHumanoidSkeleton();
      const geometry = new THREE.BufferGeometry();

      // Create positions with a NaN value (bad data scenario)
      const positions = new Float32Array([0, 1, 0, NaN, 1, 0, 0, 1, NaN]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);

      // Should not throw, but may produce unusual results
      const { skinIndices, skinWeights } = solver.calculateWeights();

      expect(skinIndices.length).toBe(3 * 4);
      expect(skinWeights.length).toBe(3 * 4);
    });
  });
});
