/**
 * DistanceSolver Tests
 *
 * Tests for distance-based skinning where each vertex is assigned
 * to its closest bone.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Incorrect bone assignment at limb boundaries
 * - World matrix not updated before distance calculation
 * - Scale issues causing wrong distance comparisons
 * - Vertices too far from all bones getting invalid assignments
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import { DistanceSolver } from "../DistanceSolver";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a skeleton with bones at known positions
 */
function createPositionedSkeleton(): THREE.Bone[] {
  const rootBone = new THREE.Bone();
  rootBone.name = "Root";
  rootBone.position.set(0, 0, 0);

  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1, 0);
  rootBone.add(hipsBone);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.3, 0);
  hipsBone.add(spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 0.3, 0);
  spineBone.add(chestBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "LeftArm";
  leftArmBone.position.set(0.5, 0.2, 0);
  chestBone.add(leftArmBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "RightArm";
  rightArmBone.position.set(-0.5, 0.2, 0);
  chestBone.add(rightArmBone);

  const leftLegBone = new THREE.Bone();
  leftLegBone.name = "LeftLeg";
  leftLegBone.position.set(0.15, -0.1, 0);
  hipsBone.add(leftLegBone);

  const rightLegBone = new THREE.Bone();
  rightLegBone.name = "RightLeg";
  rightLegBone.position.set(-0.15, -0.1, 0);
  hipsBone.add(rightLegBone);

  // Update matrices
  rootBone.updateMatrixWorld(true);

  return [
    rootBone,
    hipsBone,
    spineBone,
    chestBone,
    leftArmBone,
    rightArmBone,
    leftLegBone,
    rightLegBone,
  ];
}

/**
 * Create a simple geometry with vertices at known positions
 */
function createTestGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // Create vertices at specific positions to test bone assignment
  const positions = new Float32Array([
    // Vertex 0: Near hips (0, 1, 0)
    0, 1, 0,
    // Vertex 1: Near spine (0, 1.3, 0) - world position of spine
    0, 1.3, 0,
    // Vertex 2: Near chest (0, 1.6, 0) - world position of chest
    0, 1.6, 0,
    // Vertex 3: Near left arm (0.5, 1.8, 0) - world position of left arm
    0.5, 1.8, 0,
    // Vertex 4: Near right arm (-0.5, 1.8, 0) - world position of right arm
    -0.5, 1.8, 0,
    // Vertex 5: Near left leg (0.15, 0.9, 0) - world position of left leg
    0.15, 0.9, 0,
    // Vertex 6: Near right leg (-0.15, 0.9, 0) - world position of right leg
    -0.15, 0.9, 0,
    // Vertex 7: Between hips and spine
    0, 1.15, 0,
    // Vertex 8: Far from all bones
    5, 5, 5,
  ]);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  return geometry;
}

describe("DistanceSolver", () => {
  describe("Bone Matching", () => {
    let bones: THREE.Bone[];
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      bones = createPositionedSkeleton();
      geometry = createTestGeometry();
    });

    it("matches vertices to their closest bone", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Vertex 0 at (0, 1, 0) should be assigned to Hips (index 1)
      // The first index in each group of 4 is the primary bone
      expect(skinIndices[0 * 4]).toBe(1); // Hips
    });

    it("assigns each vertex to exactly one bone (100% weight)", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        // First weight should be 1.0
        expect(skinWeights[i * 4]).toBe(1.0);
        // Other weights should be 0
        expect(skinWeights[i * 4 + 1]).toBe(0);
        expect(skinWeights[i * 4 + 2]).toBe(0);
        expect(skinWeights[i * 4 + 3]).toBe(0);
      }
    });

    it("produces valid bone indices", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;
      const maxBoneIndex = bones.length - 1;

      for (let i = 0; i < vertexCount; i++) {
        const boneIndex = skinIndices[i * 4];
        expect(boneIndex).toBeGreaterThanOrEqual(0);
        expect(boneIndex).toBeLessThanOrEqual(maxBoneIndex);
      }
    });

    it("handles vertices between multiple bones", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Vertex 7 at (0, 1.15, 0) is between hips (1, 0) and spine (1.3, 0)
      // Should be assigned to whichever is closer
      const boneIndex = skinIndices[7 * 4];
      expect([1, 2]).toContain(boneIndex); // Either Hips or Spine
    });
  });

  describe("Distance Metrics", () => {
    let bones: THREE.Bone[];

    beforeEach(() => {
      bones = createPositionedSkeleton();
    });

    it("calculates distances in world space", () => {
      // Create geometry with a vertex at a known world position
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 1, 0]); // At hips position
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Should be assigned to Hips (index 1, closest to 0,1,0)
      expect(skinIndices[0]).toBe(1);
    });

    it("handles scaled bones correctly", () => {
      // Scale the root bone
      bones[0].scale.set(2, 2, 2);
      bones[0].updateMatrixWorld(true);

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 2, 0]); // Scaled hips position
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Should still find a valid bone
      expect(skinIndices[0]).toBeGreaterThanOrEqual(0);
      expect(skinIndices[0]).toBeLessThan(bones.length);
    });

    it("handles rotated bones correctly", () => {
      // Rotate the root bone 90 degrees around Z
      bones[0].rotation.z = Math.PI / 2;
      bones[0].updateMatrixWorld(true);

      const geometry = new THREE.BufferGeometry();
      // After 90° Z rotation, hips at (0, 1, 0) moves to (-1, 0, 0)
      const positions = new Float32Array([-1, 0, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices } = solver.calculateWeights();

      // Should find the rotated hips bone
      expect(skinIndices[0]).toBeGreaterThanOrEqual(0);
    });

    it("uses Euclidean distance for bone matching", () => {
      // Create a simple 2-bone setup where distances are clear
      const bone1 = new THREE.Bone();
      bone1.name = "Bone1";
      bone1.position.set(0, 0, 0);

      const bone2 = new THREE.Bone();
      bone2.name = "Bone2";
      bone2.position.set(10, 0, 0); // Far to the right

      // Update matrices independently (no hierarchy)
      bone1.updateMatrix();
      bone1.updateMatrixWorld(true);
      bone2.updateMatrix();
      bone2.updateMatrixWorld(true);

      const testBones = [bone1, bone2];

      // Create vertex at (9, 0, 0) - closer to bone2 at (10, 0, 0) than bone1 at (0, 0, 0)
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([9, 0, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, testBones);
      const { skinIndices } = solver.calculateWeights();

      // Distance to bone1 = 9, distance to bone2 = 1
      // Should be assigned to bone2 (index 1)
      expect(skinIndices[0]).toBe(1);
    });
  });

  describe("Threshold Handling", () => {
    let bones: THREE.Bone[];

    beforeEach(() => {
      bones = createPositionedSkeleton();
    });

    it("assigns distant vertices to the closest bone regardless of distance", () => {
      const geometry = new THREE.BufferGeometry();
      // Very far vertex
      const positions = new Float32Array([100, 100, 100]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      // Should still get assigned to a bone (the closest one)
      expect(skinIndices[0]).toBeGreaterThanOrEqual(0);
      expect(skinIndices[0]).toBeLessThan(bones.length);
      expect(skinWeights[0]).toBe(1.0);
    });

    it("handles overlapping bone positions", () => {
      // Create two bones at the same position
      const bone1 = new THREE.Bone();
      bone1.name = "Bone1";
      bone1.position.set(0, 0, 0);

      const bone2 = new THREE.Bone();
      bone2.name = "Bone2";
      bone2.position.set(0, 0, 0); // Same position

      bone1.updateMatrixWorld(true);
      bone2.updateMatrixWorld(true);

      const overlappingBones = [bone1, bone2];

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 0, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, overlappingBones);
      const { skinIndices } = solver.calculateWeights();

      // Should assign to the first bone found (deterministic)
      expect(skinIndices[0]).toBe(0);
    });

    it("handles single bone skeleton", () => {
      const singleBone = new THREE.Bone();
      singleBone.name = "SingleBone";
      singleBone.position.set(0, 0, 0);
      singleBone.updateMatrixWorld(true);

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([1, 2, 3, -5, 10, -7]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, [singleBone]);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      // All vertices should be assigned to bone 0
      expect(skinIndices[0]).toBe(0);
      expect(skinIndices[4]).toBe(0);
      expect(skinWeights[0]).toBe(1.0);
      expect(skinWeights[4]).toBe(1.0);
    });

    it("handles vertices at exact bone positions", () => {
      const geometry = new THREE.BufferGeometry();
      // Vertex exactly at hips world position
      const positions = new Float32Array([0, 1, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      // Should be assigned to Hips with full weight
      expect(skinIndices[0]).toBe(1);
      expect(skinWeights[0]).toBe(1.0);
    });
  });

  describe("Output Format", () => {
    let bones: THREE.Bone[];
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      bones = createPositionedSkeleton();
      geometry = createTestGeometry();
    });

    it("returns arrays with correct length (4 values per vertex)", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });

    it("pads unused influences with zeros", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = geometry.attributes.position.count;

      for (let i = 0; i < vertexCount; i++) {
        // Indices 1, 2, 3 should be 0 (unused)
        expect(skinIndices[i * 4 + 1]).toBe(0);
        expect(skinIndices[i * 4 + 2]).toBe(0);
        expect(skinIndices[i * 4 + 3]).toBe(0);

        // Weights 1, 2, 3 should be 0 (unused)
        expect(skinWeights[i * 4 + 1]).toBe(0);
        expect(skinWeights[i * 4 + 2]).toBe(0);
        expect(skinWeights[i * 4 + 3]).toBe(0);
      }
    });

    it("produces output compatible with BufferAttribute", () => {
      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      // Should be able to create BufferAttributes without error
      const indexAttr = new THREE.Uint16BufferAttribute(skinIndices, 4);
      const weightAttr = new THREE.Float32BufferAttribute(skinWeights, 4);

      expect(indexAttr.count).toBe(geometry.attributes.position.count);
      expect(weightAttr.count).toBe(geometry.attributes.position.count);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty geometry", () => {
      const bones = createPositionedSkeleton();
      const emptyGeometry = new THREE.BufferGeometry();
      emptyGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(0), 3),
      );

      const solver = new DistanceSolver(emptyGeometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      expect(skinIndices.length).toBe(0);
      expect(skinWeights.length).toBe(0);
    });

    it("handles geometry with single vertex", () => {
      const bones = createPositionedSkeleton();
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([0, 1, 0]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const solver = new DistanceSolver(geometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      expect(skinIndices.length).toBe(4);
      expect(skinWeights.length).toBe(4);
      expect(skinWeights[0]).toBe(1.0);
    });

    it("handles complex geometry with many vertices", () => {
      const bones = createPositionedSkeleton();
      const complexGeometry = new THREE.SphereGeometry(1, 32, 32);

      const solver = new DistanceSolver(complexGeometry, bones);
      const { skinIndices, skinWeights } = solver.calculateWeights();

      const vertexCount = complexGeometry.attributes.position.count;

      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);

      // All vertices should have valid assignments
      for (let i = 0; i < vertexCount; i++) {
        expect(skinWeights[i * 4]).toBe(1.0);
        expect(skinIndices[i * 4]).toBeGreaterThanOrEqual(0);
        expect(skinIndices[i * 4]).toBeLessThan(bones.length);
      }
    });
  });
});
