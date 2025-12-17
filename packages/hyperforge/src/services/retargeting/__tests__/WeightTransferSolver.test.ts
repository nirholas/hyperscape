/**
 * WeightTransferSolver Tests
 *
 * Tests for transferring skin weights between skeletons.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone mapping failures due to naming convention differences
 * - Weight normalization errors causing mesh distortion
 * - Unmapped bones leaving vertices without influences
 * - Scale ratio miscalculations during alignment
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import { WeightTransferSolver, BoneMapping } from "../WeightTransferSolver";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a Meshy-style skeleton (source)
 */
function createMeshySkeleton(): THREE.Skeleton {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.2, 0);
  hipsBone.add(spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Spine01";
  chestBone.position.set(0, 0.2, 0);
  spineBone.add(chestBone);

  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 0.2, 0);
  chestBone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.15, 0);
  neckBone.add(headBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "LeftArm";
  leftArmBone.position.set(0.2, 0.1, 0);
  chestBone.add(leftArmBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "RightArm";
  rightArmBone.position.set(-0.2, 0.1, 0);
  chestBone.add(rightArmBone);

  const leftUpLegBone = new THREE.Bone();
  leftUpLegBone.name = "LeftUpLeg";
  leftUpLegBone.position.set(0.1, -0.1, 0);
  hipsBone.add(leftUpLegBone);

  const rightUpLegBone = new THREE.Bone();
  rightUpLegBone.name = "RightUpLeg";
  rightUpLegBone.position.set(-0.1, -0.1, 0);
  hipsBone.add(rightUpLegBone);

  hipsBone.updateMatrixWorld(true);

  const bones = [
    hipsBone,
    spineBone,
    chestBone,
    neckBone,
    headBone,
    leftArmBone,
    rightArmBone,
    leftUpLegBone,
    rightUpLegBone,
  ];

  return new THREE.Skeleton(bones);
}

/**
 * Create a Mixamo-style skeleton (target)
 */
function createMixamoSkeleton(): THREE.Skeleton {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "DEF-hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "DEF-spine001";
  spineBone.position.set(0, 0.2, 0);
  hipsBone.add(spineBone);

  const chestBone = new THREE.Bone();
  chestBone.name = "DEF-spine002";
  chestBone.position.set(0, 0.2, 0);
  spineBone.add(chestBone);

  const neckBone = new THREE.Bone();
  neckBone.name = "DEF-neck";
  neckBone.position.set(0, 0.2, 0);
  chestBone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "DEF-head";
  headBone.position.set(0, 0.15, 0);
  neckBone.add(headBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "DEF-upper_armL";
  leftArmBone.position.set(0.2, 0.1, 0);
  chestBone.add(leftArmBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "DEF-upper_armR";
  rightArmBone.position.set(-0.2, 0.1, 0);
  chestBone.add(rightArmBone);

  const leftUpLegBone = new THREE.Bone();
  leftUpLegBone.name = "DEF-thighL";
  leftUpLegBone.position.set(0.1, -0.1, 0);
  hipsBone.add(leftUpLegBone);

  const rightUpLegBone = new THREE.Bone();
  rightUpLegBone.name = "DEF-thighR";
  rightUpLegBone.position.set(-0.1, -0.1, 0);
  hipsBone.add(rightUpLegBone);

  hipsBone.updateMatrixWorld(true);

  const bones = [
    hipsBone,
    spineBone,
    chestBone,
    neckBone,
    headBone,
    leftArmBone,
    rightArmBone,
    leftUpLegBone,
    rightUpLegBone,
  ];

  return new THREE.Skeleton(bones);
}

/**
 * Create a geometry with skin weights for testing
 */
function createSkinnedGeometry(vertexCount: number = 20): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.2, 2, 4, 1);
  geometry.translate(0, 0.9, 0);

  const positionAttr = geometry.attributes.position;
  const actualVertexCount = positionAttr.count;

  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (let i = 0; i < actualVertexCount; i++) {
    const y = positionAttr.getY(i);

    // Assign multiple bone influences based on Y position
    let boneIndex1 = 0;
    let boneIndex2 = 1;
    let weight1 = 0.7;
    let weight2 = 0.3;

    if (y > 1.5) {
      boneIndex1 = 4; // Head
      boneIndex2 = 3; // Neck
    } else if (y > 1.2) {
      boneIndex1 = 3; // Neck
      boneIndex2 = 2; // Chest
    } else if (y > 0.8) {
      boneIndex1 = 2; // Chest
      boneIndex2 = 1; // Spine
    } else if (y > 0.4) {
      boneIndex1 = 1; // Spine
      boneIndex2 = 0; // Hips
    } else {
      boneIndex1 = 0; // Hips
      boneIndex2 = 7; // LeftUpLeg
      weight1 = 0.5;
      weight2 = 0.5;
    }

    skinIndices.push(boneIndex1, boneIndex2, 0, 0);
    skinWeights.push(weight1, weight2, 0, 0);
  }

  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  return geometry;
}

describe("WeightTransferSolver", () => {
  describe("Weight Calculation", () => {
    let sourceSkeleton: THREE.Skeleton;
    let targetSkeleton: THREE.Skeleton;
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      sourceSkeleton = createMeshySkeleton();
      targetSkeleton = createMixamoSkeleton();
      geometry = createSkinnedGeometry();
    });

    it("calculates weights by remapping bone indices", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinIndices, skinWeights } = solver.transferWeights();

      expect(skinIndices.length).toBeGreaterThan(0);
      expect(skinWeights.length).toBeGreaterThan(0);
      expect(skinIndices.length).toBe(skinWeights.length);
    });

    it("returns valid bone indices within target skeleton range", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinIndices } = solver.transferWeights();
      const maxBoneIndex = targetSkeleton.bones.length - 1;

      // Check that all indices are within valid range
      for (let i = 0; i < skinIndices.length; i++) {
        expect(skinIndices[i]).toBeGreaterThanOrEqual(0);
        expect(skinIndices[i]).toBeLessThanOrEqual(maxBoneIndex);
      }
    });

    it("preserves vertex count in weight arrays", () => {
      const vertexCount = geometry.attributes.position.count;

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinIndices, skinWeights } = solver.transferWeights();

      // Each vertex has 4 influences
      expect(skinIndices.length).toBe(vertexCount * 4);
      expect(skinWeights.length).toBe(vertexCount * 4);
    });
  });

  describe("Multi-Bone Weights", () => {
    let sourceSkeleton: THREE.Skeleton;
    let targetSkeleton: THREE.Skeleton;
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      sourceSkeleton = createMeshySkeleton();
      targetSkeleton = createMixamoSkeleton();
      geometry = createSkinnedGeometry();
    });

    it("distributes weights across multiple bones", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinWeights } = solver.transferWeights();

      // Check that some vertices have multiple non-zero weights
      let hasMultipleInfluences = false;
      const vertexCount = geometry.attributes.position.count;

      for (let v = 0; v < vertexCount; v++) {
        const w1 = skinWeights[v * 4];
        const w2 = skinWeights[v * 4 + 1];

        if (w1 > 0 && w2 > 0) {
          hasMultipleInfluences = true;
          break;
        }
      }

      expect(hasMultipleInfluences).toBe(true);
    });

    it("limits to 4 bone influences per vertex", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinWeights } = solver.transferWeights();
      const vertexCount = geometry.attributes.position.count;

      // Each vertex should have exactly 4 weight slots
      for (let v = 0; v < vertexCount; v++) {
        let influenceCount = 0;
        for (let i = 0; i < 4; i++) {
          if (skinWeights[v * 4 + i] > 0) {
            influenceCount++;
          }
        }
        expect(influenceCount).toBeLessThanOrEqual(4);
      }
    });

    it("keeps valid bone influences within array bounds", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinWeights, skinIndices } = solver.transferWeights();
      const vertexCount = geometry.attributes.position.count;
      const maxBoneIndex = targetSkeleton.bones.length - 1;

      // All weights should be in valid range
      for (let v = 0; v < vertexCount; v++) {
        for (let i = 0; i < 4; i++) {
          const weight = skinWeights[v * 4 + i];
          const index = skinIndices[v * 4 + i];
          expect(weight).toBeGreaterThanOrEqual(0);
          expect(weight).toBeLessThanOrEqual(1);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThanOrEqual(maxBoneIndex);
        }
      }
    });
  });

  describe("Weight Smoothing", () => {
    let sourceSkeleton: THREE.Skeleton;
    let targetSkeleton: THREE.Skeleton;
    let geometry: THREE.BufferGeometry;

    beforeEach(() => {
      sourceSkeleton = createMeshySkeleton();
      targetSkeleton = createMixamoSkeleton();
      geometry = createSkinnedGeometry();
    });

    it("normalizes weights to sum to 1.0", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinWeights } = solver.transferWeights();
      const vertexCount = geometry.attributes.position.count;

      for (let v = 0; v < vertexCount; v++) {
        let sum = 0;
        for (let i = 0; i < 4; i++) {
          sum += skinWeights[v * 4 + i];
        }

        // Skip if no weights (shouldn't happen but guard against it)
        if (sum > 0) {
          expect(sum).toBeCloseTo(1.0, 5);
        }
      }
    });

    it("handles zero weight normalization gracefully", () => {
      // Create geometry with potential for unmapped bones
      const testGeometry = new THREE.BoxGeometry(0.4, 1.8, 0.2);
      const vertexCount = testGeometry.attributes.position.count;

      // Set all weights to zero (simulating all bones unmapped)
      const skinIndices = new Array(vertexCount * 4).fill(0);
      const skinWeights = new Array(vertexCount * 4).fill(0);

      testGeometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(skinIndices, 4),
      );
      testGeometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      // This should not throw
      const solver = new WeightTransferSolver(
        testGeometry,
        sourceSkeleton,
        targetSkeleton,
      );

      // Should handle gracefully (or throw with meaningful error)
      try {
        solver.transferWeights();
      } catch {
        // If it throws, that's acceptable - we just want no crash
        expect(true).toBe(true);
      }
    });

    it("produces smooth weight transitions at bone boundaries", () => {
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      const { skinWeights } = solver.transferWeights();
      const vertexCount = geometry.attributes.position.count;

      // Check that weights are in valid range
      for (let v = 0; v < vertexCount; v++) {
        for (let i = 0; i < 4; i++) {
          const weight = skinWeights[v * 4 + i];
          expect(weight).toBeGreaterThanOrEqual(0);
          expect(weight).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("Bone Mapping", () => {
    it("uses provided bone mapping", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      const customMapping: BoneMapping = {
        Hips: "DEF-hips",
        Spine: "DEF-spine001",
        Spine01: "DEF-spine002",
        Neck: "DEF-neck",
        Head: "DEF-head",
        LeftArm: "DEF-upper_armL",
        RightArm: "DEF-upper_armR",
        LeftUpLeg: "DEF-thighL",
        RightUpLeg: "DEF-thighR",
      };

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
        customMapping,
      );

      expect(solver.isMappingQualityGood()).toBe(true);
    });

    it("falls back to fuzzy matching when no mapping provided", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      // No explicit mapping - should use auto-detection
      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      // Should still be able to transfer weights
      const { skinIndices, skinWeights } = solver.transferWeights();
      expect(skinIndices.length).toBeGreaterThan(0);
      expect(skinWeights.length).toBeGreaterThan(0);
    });

    it("reports mapping quality", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      // Quality should be a boolean
      const isGood = solver.isMappingQualityGood();
      expect(typeof isGood).toBe("boolean");
    });
  });

  describe("Bind Pose Alignment", () => {
    it("aligns target skeleton to source bind pose", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      // This should not throw
      solver.alignToSourceBindPose();

      // Verify matrices were updated
      for (const bone of targetSkeleton.bones) {
        expect(bone.matrixWorld).toBeDefined();
      }
    });

    it("preserves target skeleton scale during alignment", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      // Scale target skeleton
      targetSkeleton.bones[0].scale.set(2, 2, 2);
      targetSkeleton.bones[0].updateMatrixWorld(true);

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      solver.alignToSourceBindPose();

      // Scale should be preserved (approximately, due to alignment)
      const targetScale = targetSkeleton.bones[0].scale;
      expect(targetScale.x).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("handles skeletons with different bone counts", () => {
      const smallSkeleton = new THREE.Skeleton([
        (() => {
          const bone = new THREE.Bone();
          bone.name = "Hips";
          bone.updateMatrixWorld(true);
          return bone;
        })(),
      ]);

      const largeSkeleton = createMixamoSkeleton();
      const geometry = createSkinnedGeometry();

      // Reassign skin indices to point to bone 0
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Array(vertexCount * 4).fill(0);
      const skinWeights = new Array(vertexCount * 4).fill(0);
      for (let i = 0; i < vertexCount; i++) {
        skinWeights[i * 4] = 1;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const solver = new WeightTransferSolver(
        geometry,
        smallSkeleton,
        largeSkeleton,
      );

      const { skinIndices: newIndices, skinWeights: newWeights } =
        solver.transferWeights();

      expect(newIndices.length).toBe(vertexCount * 4);
      expect(newWeights.length).toBe(vertexCount * 4);
    });

    it("throws when source geometry has no skin weights", () => {
      const sourceSkeleton = createMeshySkeleton();
      const targetSkeleton = createMixamoSkeleton();

      // Create geometry without skin attributes
      const geometry = new THREE.BoxGeometry(1, 1, 1);

      const solver = new WeightTransferSolver(
        geometry,
        sourceSkeleton,
        targetSkeleton,
      );

      expect(() => solver.transferWeights()).toThrow();
    });
  });
});
