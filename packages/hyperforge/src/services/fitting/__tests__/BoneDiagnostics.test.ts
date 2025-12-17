/**
 * BoneDiagnostics Tests
 *
 * Tests for bone hierarchy analysis and skeleton diagnostics.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Missing required bones in skeleton
 * - Orphaned bones without proper hierarchy
 * - Invalid transforms (NaN, Infinity)
 * - Non-normalized quaternions
 * - Skeleton compatibility issues
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { BoneDiagnostics } from "../BoneDiagnostics";
import { createTestSkeleton } from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

describe("BoneDiagnostics", () => {
  describe("Bone Hierarchy Analysis", () => {
    it("identifies root bones correctly", () => {
      const { skeleton } = createTestSkeleton();

      // Root bones should not have Bone parents
      const rootBones = skeleton.bones.filter(
        (b) => !b.parent || !(b.parent instanceof THREE.Bone),
      );

      expect(rootBones.length).toBe(1);
      expect(rootBones[0].name).toBe("Hips");
    });

    it("detects missing required bones in humanoid skeleton", () => {
      // Create skeleton missing some required bones
      const root = new THREE.Bone();
      root.name = "Hips";

      const spine = new THREE.Bone();
      spine.name = "Spine";
      root.add(spine);

      // Missing: Chest, Neck, Head, Arms, Legs

      const bones = [root, spine];
      const skeleton = new THREE.Skeleton(bones);

      const requiredBones = [
        "Hips",
        "Spine",
        "Chest",
        "Neck",
        "Head",
        "LeftUpperArm",
        "RightUpperArm",
        "LeftUpperLeg",
        "RightUpperLeg",
      ];

      const foundBones = skeleton.bones.map((b) => b.name);
      const missingBones = requiredBones.filter(
        (required) =>
          !foundBones.some(
            (found) => found.toLowerCase() === required.toLowerCase(),
          ),
      );

      expect(missingBones.length).toBeGreaterThan(0);
      expect(missingBones).toContain("Chest");
      expect(missingBones).toContain("Head");
    });

    it("detects orphaned bones without parent", () => {
      // Create bones without proper hierarchy
      const boneA = new THREE.Bone();
      boneA.name = "OrphanBoneA";

      const boneB = new THREE.Bone();
      boneB.name = "OrphanBoneB";

      const bones = [boneA, boneB];
      const skeleton = new THREE.Skeleton(bones);

      // Check for orphaned bones (bones that aren't root but have no Bone parent)
      const rootBones = skeleton.bones.filter(
        (b) => !b.parent || !(b.parent instanceof THREE.Bone),
      );

      // Both should be roots since neither has a parent
      expect(rootBones.length).toBe(2);
    });

    it("validates bone naming conventions", () => {
      const { skeleton } = createTestSkeleton();

      // Check all bones have valid names
      for (const bone of skeleton.bones) {
        // Name should not be empty
        expect(bone.name).toBeTruthy();
        expect(bone.name.length).toBeGreaterThan(0);

        // Name should not contain special characters (common in bad exports)
        expect(bone.name).not.toMatch(/[<>:"/\\|?*]/);
      }
    });

    it("detects duplicate bone names", () => {
      const bone1 = new THREE.Bone();
      bone1.name = "Spine";

      const bone2 = new THREE.Bone();
      bone2.name = "Spine"; // Duplicate!
      bone1.add(bone2);

      const bones = [bone1, bone2];
      const skeleton = new THREE.Skeleton(bones);

      const names = skeleton.bones.map((b) => b.name);
      const uniqueNames = new Set(names);

      // Should detect duplicate
      expect(names.length).not.toBe(uniqueNames.size);
    });
  });

  describe("Bone Transform Validation", () => {
    it("detects invalid NaN values in bone positions", () => {
      const bone = new THREE.Bone();
      bone.name = "TestBone";
      bone.position.set(NaN, 0, 0);

      const skeleton = new THREE.Skeleton([bone]);

      // Check for NaN values
      const hasNaN = skeleton.bones.some((b) => {
        return (
          isNaN(b.position.x) ||
          isNaN(b.position.y) ||
          isNaN(b.position.z) ||
          isNaN(b.rotation.x) ||
          isNaN(b.rotation.y) ||
          isNaN(b.rotation.z) ||
          isNaN(b.scale.x) ||
          isNaN(b.scale.y) ||
          isNaN(b.scale.z)
        );
      });

      expect(hasNaN).toBe(true);
    });

    it("detects Infinity values in bone transforms", () => {
      const bone = new THREE.Bone();
      bone.name = "TestBone";
      bone.position.set(0, Infinity, 0);

      const skeleton = new THREE.Skeleton([bone]);

      // Check for Infinity values
      const hasInfinity = skeleton.bones.some((b) => {
        return (
          !isFinite(b.position.x) ||
          !isFinite(b.position.y) ||
          !isFinite(b.position.z) ||
          !isFinite(b.scale.x) ||
          !isFinite(b.scale.y) ||
          !isFinite(b.scale.z)
        );
      });

      expect(hasInfinity).toBe(true);
    });

    it("validates scale values are positive", () => {
      const { skeleton } = createTestSkeleton();

      // All bones should have positive scale
      for (const bone of skeleton.bones) {
        expect(bone.scale.x).toBeGreaterThan(0);
        expect(bone.scale.y).toBeGreaterThan(0);
        expect(bone.scale.z).toBeGreaterThan(0);
      }
    });

    it("detects non-uniform bone scale", () => {
      const bone = new THREE.Bone();
      bone.name = "NonUniformBone";
      bone.scale.set(1.5, 1.0, 0.8); // Non-uniform

      const skeleton = new THREE.Skeleton([bone]);

      const hasNonUniformScale = skeleton.bones.some((b) => {
        const s = b.scale;
        return (
          Math.abs(s.x - s.y) > 0.001 ||
          Math.abs(s.y - s.z) > 0.001 ||
          Math.abs(s.x - s.z) > 0.001
        );
      });

      expect(hasNonUniformScale).toBe(true);
    });

    it("validates rotation quaternions are normalized", () => {
      const bone = new THREE.Bone();
      bone.name = "TestBone";
      // Set a non-normalized quaternion
      bone.quaternion.set(0.5, 0.5, 0.5, 0.5);
      // This happens to be normalized, so let's create a non-normalized one
      bone.quaternion.set(1, 1, 1, 1); // Length = 2, not 1

      const skeleton = new THREE.Skeleton([bone]);

      // Check quaternion normalization
      const hasNonNormalizedQuaternion = skeleton.bones.some((b) => {
        const length = b.quaternion.length();
        return Math.abs(length - 1) > 0.001;
      });

      expect(hasNonNormalizedQuaternion).toBe(true);
    });

    it("detects zero scale (invalid)", () => {
      const bone = new THREE.Bone();
      bone.name = "ZeroScaleBone";
      bone.scale.set(0, 1, 1);

      const skeleton = new THREE.Skeleton([bone]);

      const hasZeroScale = skeleton.bones.some((b) => {
        return b.scale.x === 0 || b.scale.y === 0 || b.scale.z === 0;
      });

      expect(hasZeroScale).toBe(true);
    });
  });

  describe("Skeleton Comparison", () => {
    it("compares source and target skeletons by bone count", () => {
      // Source: 3 bones
      const { skeleton: sourceSkeleton } = createTestSkeleton();

      // Target: 5 bones
      const targetRoot = new THREE.Bone();
      targetRoot.name = "Hips";

      const targetSpine = new THREE.Bone();
      targetSpine.name = "Spine";
      targetRoot.add(targetSpine);

      const targetChest = new THREE.Bone();
      targetChest.name = "Chest";
      targetSpine.add(targetChest);

      const targetNeck = new THREE.Bone();
      targetNeck.name = "Neck";
      targetChest.add(targetNeck);

      const targetHead = new THREE.Bone();
      targetHead.name = "Head";
      targetNeck.add(targetHead);

      const targetSkeleton = new THREE.Skeleton([
        targetRoot,
        targetSpine,
        targetChest,
        targetNeck,
        targetHead,
      ]);

      const boneCountDiff =
        targetSkeleton.bones.length - sourceSkeleton.bones.length;

      expect(boneCountDiff).toBe(2);
      expect(sourceSkeleton.bones.length).toBe(3);
      expect(targetSkeleton.bones.length).toBe(5);
    });

    it("reports naming differences between skeletons", () => {
      // Source with standard names
      const sourceRoot = new THREE.Bone();
      sourceRoot.name = "Hips";
      const sourceSpine = new THREE.Bone();
      sourceSpine.name = "Spine";
      sourceRoot.add(sourceSpine);

      const sourceSkeleton = new THREE.Skeleton([sourceRoot, sourceSpine]);

      // Target with different naming convention
      const targetRoot = new THREE.Bone();
      targetRoot.name = "pelvis"; // Different naming
      const targetSpine = new THREE.Bone();
      targetSpine.name = "spine_01"; // Different naming
      targetRoot.add(targetSpine);

      const targetSkeleton = new THREE.Skeleton([targetRoot, targetSpine]);

      // Find matching bones by comparing normalized names
      const normalizeNames = (name: string) =>
        name.toLowerCase().replace(/[_\d]/g, "");

      const sourceNames = sourceSkeleton.bones.map((b) =>
        normalizeNames(b.name),
      );
      const targetNames = targetSkeleton.bones.map((b) =>
        normalizeNames(b.name),
      );

      const matchingCount = sourceNames.filter((s) =>
        targetNames.some((t) => t.includes(s) || s.includes(t)),
      ).length;

      // Should find some matches after normalization
      expect(matchingCount).toBeGreaterThan(0);
    });

    it("compares average bone distances between skeletons", () => {
      // Create skeleton in meters
      const meterSkeleton = BoneDiagnostics.createTestSkeleton("meters");

      // Create skeleton in centimeters
      const cmSkeleton = BoneDiagnostics.createTestSkeleton("centimeters");

      // Calculate average bone distances
      const getAvgDistance = (skeleton: THREE.Skeleton): number => {
        const distances: number[] = [];
        skeleton.bones.forEach((bone) => {
          bone.children.forEach((child) => {
            if (child instanceof THREE.Bone) {
              distances.push(bone.position.distanceTo(child.position));
            }
          });
        });
        return distances.length > 0
          ? distances.reduce((a, b) => a + b, 0) / distances.length
          : 0;
      };

      const meterAvg = getAvgDistance(meterSkeleton);
      const cmAvg = getAvgDistance(cmSkeleton);

      // CM skeleton should be ~100x larger
      const ratio = cmAvg / meterAvg;
      expect(ratio).toBeCloseTo(100, 0);
    });

    it("detects scale factor between skeletons", () => {
      const { skeleton: skeleton1 } = createTestSkeleton();

      // Create a scaled version
      const scaledRoot = new THREE.Bone();
      scaledRoot.name = "Hips";
      scaledRoot.position.set(0, 100, 0); // 100x scale

      const scaledSpine = new THREE.Bone();
      scaledSpine.name = "Spine";
      scaledSpine.position.set(0, 20, 0); // 100x scale
      scaledRoot.add(scaledSpine);

      const scaledHead = new THREE.Bone();
      scaledHead.name = "Head";
      scaledHead.position.set(0, 60, 0); // 100x scale
      scaledSpine.add(scaledHead);

      const skeleton2 = new THREE.Skeleton([
        scaledRoot,
        scaledSpine,
        scaledHead,
      ]);

      // Calculate heights
      const getSkeletonHeight = (skeleton: THREE.Skeleton): number => {
        let minY = Infinity;
        let maxY = -Infinity;

        skeleton.bones.forEach((bone) => {
          const worldPos = new THREE.Vector3();
          bone.updateWorldMatrix(true, false);
          bone.getWorldPosition(worldPos);
          minY = Math.min(minY, worldPos.y);
          maxY = Math.max(maxY, worldPos.y);
        });

        return maxY - minY;
      };

      const height1 = getSkeletonHeight(skeleton1);
      const height2 = getSkeletonHeight(skeleton2);

      const scaleFactor = height2 / height1;
      expect(scaleFactor).toBeCloseTo(100, 0);
    });

    it("identifies matching bones by name patterns", () => {
      // VRM-style naming
      const vrmRoot = new THREE.Bone();
      vrmRoot.name = "J_Bip_C_Hips";

      const vrmSpine = new THREE.Bone();
      vrmSpine.name = "J_Bip_C_Spine";
      vrmRoot.add(vrmSpine);

      const vrmSkeleton = new THREE.Skeleton([vrmRoot, vrmSpine]);

      // Mixamo-style naming
      const mixamoRoot = new THREE.Bone();
      mixamoRoot.name = "mixamorig:Hips";

      const mixamoSpine = new THREE.Bone();
      mixamoSpine.name = "mixamorig:Spine";
      mixamoRoot.add(mixamoSpine);

      const mixamoSkeleton = new THREE.Skeleton([mixamoRoot, mixamoSpine]);

      // Extract core bone names
      const extractCoreName = (name: string): string => {
        return name.replace(/^(J_Bip_[CLR]_|mixamorig:)/, "").toLowerCase();
      };

      const vrmCoreNames = vrmSkeleton.bones.map((b) =>
        extractCoreName(b.name),
      );
      const mixamoCoreNames = mixamoSkeleton.bones.map((b) =>
        extractCoreName(b.name),
      );

      // Should match after normalization
      expect(vrmCoreNames).toContain("hips");
      expect(mixamoCoreNames).toContain("hips");
      expect(vrmCoreNames).toEqual(mixamoCoreNames);
    });
  });

  describe("Test Skeleton Creation", () => {
    it("creates test skeleton in meters", () => {
      const skeleton = BoneDiagnostics.createTestSkeleton("meters");

      expect(skeleton.bones.length).toBe(3);
      expect(skeleton.bones[0].name).toBe("TestRoot");
      expect(skeleton.bones[1].name).toBe("TestMiddle");
      expect(skeleton.bones[2].name).toBe("TestEnd");

      // Check distances are in meter range
      const middleBone = skeleton.bones[1];
      expect(middleBone.position.y).toBeCloseTo(0.5, 2); // 0.5m
    });

    it("creates test skeleton in centimeters", () => {
      const skeleton = BoneDiagnostics.createTestSkeleton("centimeters");

      expect(skeleton.bones.length).toBe(3);

      // Check distances are in centimeter range
      const middleBone = skeleton.bones[1];
      expect(middleBone.position.y).toBeCloseTo(50, 2); // 50cm
    });
  });

  describe("Skeleton Analysis", () => {
    it("analyzes skeleton without throwing", () => {
      const { skeleton } = createTestSkeleton();

      // Should not throw
      expect(() => {
        BoneDiagnostics.analyzeSkeletonForExport(skeleton, "TestAnalysis");
      }).not.toThrow();
    });

    it("detects bones with non-unit scale", () => {
      const root = new THREE.Bone();
      root.name = "Root";
      root.scale.set(0.01, 0.01, 0.01); // Scaled down

      const child = new THREE.Bone();
      child.name = "Child";
      child.position.set(0, 50, 0);
      root.add(child);

      const skeleton = new THREE.Skeleton([root, child]);

      // Check for non-uniform scale
      const hasNonUniformScale = skeleton.bones.some((bone) => {
        const s = bone.scale;
        return (
          Math.abs(s.x - 1) > 0.001 ||
          Math.abs(s.y - 1) > 0.001 ||
          Math.abs(s.z - 1) > 0.001
        );
      });

      expect(hasNonUniformScale).toBe(true);
    });
  });
});
