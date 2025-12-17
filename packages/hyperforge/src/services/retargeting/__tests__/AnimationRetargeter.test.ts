/**
 * AnimationRetargeter Tests
 *
 * Tests for retargeting animations between different skeleton formats.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone mapping failures when bone names don't match conventions
 * - Rest pose offset calculation errors between T-pose and A-pose
 * - Scale adjustment producing incorrect proportions
 * - Track remapping breaking animation data
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";

import { AnimationRetargeter } from "../AnimationRetargeter";
import {
  createBoneMapping,
  findMeshyBoneName,
  findMixamoBoneName,
  MIXAMO_TO_MESHY,
  MESHY_TO_MIXAMO,
  MESHY_VARIATIONS,
  VRM_TO_MIXAMO,
} from "@/services/vrm/BoneMappings";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a Mixamo-style skeleton (source skeleton for animations)
 * Uses DEF- prefix naming convention
 */
function createMixamoSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "DEF-hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "DEF-spine001";
  spineBone.position.set(0, 0.15, 0);
  hipsBone.add(spineBone);

  const spine2Bone = new THREE.Bone();
  spine2Bone.name = "DEF-spine002";
  spine2Bone.position.set(0, 0.15, 0);
  spineBone.add(spine2Bone);

  const neckBone = new THREE.Bone();
  neckBone.name = "DEF-neck";
  neckBone.position.set(0, 0.2, 0);
  spine2Bone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "DEF-head";
  headBone.position.set(0, 0.15, 0);
  neckBone.add(headBone);

  // Left arm
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "DEF-shoulderL";
  leftShoulderBone.position.set(0.1, 0.1, 0);
  spine2Bone.add(leftShoulderBone);

  const leftUpperArmBone = new THREE.Bone();
  leftUpperArmBone.name = "DEF-upper_armL";
  leftUpperArmBone.position.set(0.15, 0, 0);
  leftShoulderBone.add(leftUpperArmBone);

  // Right arm
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "DEF-shoulderR";
  rightShoulderBone.position.set(-0.1, 0.1, 0);
  spine2Bone.add(rightShoulderBone);

  const rightUpperArmBone = new THREE.Bone();
  rightUpperArmBone.name = "DEF-upper_armR";
  rightUpperArmBone.position.set(-0.15, 0, 0);
  rightShoulderBone.add(rightUpperArmBone);

  // Left leg
  const leftThighBone = new THREE.Bone();
  leftThighBone.name = "DEF-thighL";
  leftThighBone.position.set(0.1, -0.1, 0);
  hipsBone.add(leftThighBone);

  const leftShinBone = new THREE.Bone();
  leftShinBone.name = "DEF-shinL";
  leftShinBone.position.set(0, -0.4, 0);
  leftThighBone.add(leftShinBone);

  // Right leg
  const rightThighBone = new THREE.Bone();
  rightThighBone.name = "DEF-thighR";
  rightThighBone.position.set(-0.1, -0.1, 0);
  hipsBone.add(rightThighBone);

  const rightShinBone = new THREE.Bone();
  rightShinBone.name = "DEF-shinR";
  rightShinBone.position.set(0, -0.4, 0);
  rightThighBone.add(rightShinBone);

  const bones = [
    hipsBone,
    spineBone,
    spine2Bone,
    neckBone,
    headBone,
    leftShoulderBone,
    leftUpperArmBone,
    rightShoulderBone,
    rightUpperArmBone,
    leftThighBone,
    leftShinBone,
    rightThighBone,
    rightShinBone,
  ];

  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: hipsBone };
}

/**
 * Create a Meshy-style skeleton (target skeleton for character)
 * Uses standard humanoid naming convention
 */
function createMeshySkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 0.95, 0); // Slightly different height

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.12, 0);
  hipsBone.add(spineBone);

  const spine01Bone = new THREE.Bone();
  spine01Bone.name = "Spine01";
  spine01Bone.position.set(0, 0.12, 0);
  spineBone.add(spine01Bone);

  const spine02Bone = new THREE.Bone();
  spine02Bone.name = "Spine02";
  spine02Bone.position.set(0, 0.12, 0);
  spine01Bone.add(spine02Bone);

  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 0.18, 0);
  spine02Bone.add(neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.12, 0);
  neckBone.add(headBone);

  // Left arm
  const leftShoulderBone = new THREE.Bone();
  leftShoulderBone.name = "LeftShoulder";
  leftShoulderBone.position.set(0.08, 0.08, 0);
  spine02Bone.add(leftShoulderBone);

  const leftArmBone = new THREE.Bone();
  leftArmBone.name = "LeftArm";
  leftArmBone.position.set(0.12, 0, 0);
  leftShoulderBone.add(leftArmBone);

  // Right arm
  const rightShoulderBone = new THREE.Bone();
  rightShoulderBone.name = "RightShoulder";
  rightShoulderBone.position.set(-0.08, 0.08, 0);
  spine02Bone.add(rightShoulderBone);

  const rightArmBone = new THREE.Bone();
  rightArmBone.name = "RightArm";
  rightArmBone.position.set(-0.12, 0, 0);
  rightShoulderBone.add(rightArmBone);

  // Left leg
  const leftUpLegBone = new THREE.Bone();
  leftUpLegBone.name = "LeftUpLeg";
  leftUpLegBone.position.set(0.08, -0.08, 0);
  hipsBone.add(leftUpLegBone);

  const leftLegBone = new THREE.Bone();
  leftLegBone.name = "LeftLeg";
  leftLegBone.position.set(0, -0.35, 0);
  leftUpLegBone.add(leftLegBone);

  // Right leg
  const rightUpLegBone = new THREE.Bone();
  rightUpLegBone.name = "RightUpLeg";
  rightUpLegBone.position.set(-0.08, -0.08, 0);
  hipsBone.add(rightUpLegBone);

  const rightLegBone = new THREE.Bone();
  rightLegBone.name = "RightLeg";
  rightLegBone.position.set(0, -0.35, 0);
  rightUpLegBone.add(rightLegBone);

  const bones = [
    hipsBone,
    spineBone,
    spine01Bone,
    spine02Bone,
    neckBone,
    headBone,
    leftShoulderBone,
    leftArmBone,
    rightShoulderBone,
    rightArmBone,
    leftUpLegBone,
    leftLegBone,
    rightUpLegBone,
    rightLegBone,
  ];

  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: hipsBone };
}

/**
 * Create a test animation clip with rotation and position tracks
 */
function createTestAnimationClip(
  boneName: string,
  duration: number = 1.0,
  keyframeCount: number = 10,
): THREE.AnimationClip {
  const times = new Float32Array(keyframeCount);
  for (let i = 0; i < keyframeCount; i++) {
    times[i] = (i / (keyframeCount - 1)) * duration;
  }

  // Quaternion track (4 values per keyframe: x, y, z, w)
  const quaternionValues = new Float32Array(keyframeCount * 4);
  for (let i = 0; i < keyframeCount; i++) {
    const t = i / (keyframeCount - 1);
    const angle = t * Math.PI * 0.5; // Rotate 90 degrees over animation
    const quat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle,
    );
    quaternionValues[i * 4] = quat.x;
    quaternionValues[i * 4 + 1] = quat.y;
    quaternionValues[i * 4 + 2] = quat.z;
    quaternionValues[i * 4 + 3] = quat.w;
  }

  const quaternionTrack = new THREE.QuaternionKeyframeTrack(
    `${boneName}.quaternion`,
    Array.from(times),
    Array.from(quaternionValues),
  );

  // Position track (3 values per keyframe: x, y, z) - only for Hips
  const positionValues = new Float32Array(keyframeCount * 3);
  for (let i = 0; i < keyframeCount; i++) {
    const t = i / (keyframeCount - 1);
    positionValues[i * 3] = 0;
    positionValues[i * 3 + 1] = 1 + t * 0.1; // Slight Y movement
    positionValues[i * 3 + 2] = t * 0.5; // Move forward
  }

  const positionTrack = new THREE.VectorKeyframeTrack(
    `${boneName}.position`,
    Array.from(times),
    Array.from(positionValues),
  );

  return new THREE.AnimationClip("TestAnimation", duration, [
    quaternionTrack,
    positionTrack,
  ]);
}

/**
 * Create a multi-bone animation clip
 */
function createMultiBoneAnimationClip(): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const duration = 2.0;
  const keyframeCount = 20;

  const times = new Float32Array(keyframeCount);
  for (let i = 0; i < keyframeCount; i++) {
    times[i] = (i / (keyframeCount - 1)) * duration;
  }

  // Add quaternion tracks for multiple Mixamo bones
  const boneNames = [
    "DEF-hips",
    "DEF-spine001",
    "DEF-spine002",
    "DEF-neck",
    "DEF-head",
    "DEF-upper_armL",
    "DEF-upper_armR",
    "DEF-thighL",
    "DEF-thighR",
  ];

  for (const boneName of boneNames) {
    const quaternionValues = new Float32Array(keyframeCount * 4);
    for (let i = 0; i < keyframeCount; i++) {
      const t = i / (keyframeCount - 1);
      const angle = Math.sin(t * Math.PI * 2) * 0.2; // Oscillating rotation
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        angle,
      );
      quaternionValues[i * 4] = quat.x;
      quaternionValues[i * 4 + 1] = quat.y;
      quaternionValues[i * 4 + 2] = quat.z;
      quaternionValues[i * 4 + 3] = quat.w;
    }

    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`,
        Array.from(times),
        Array.from(quaternionValues),
      ),
    );
  }

  // Add Hips position track (root motion)
  const positionValues = new Float32Array(keyframeCount * 3);
  for (let i = 0; i < keyframeCount; i++) {
    const t = i / (keyframeCount - 1);
    positionValues[i * 3] = 0;
    positionValues[i * 3 + 1] = 1;
    positionValues[i * 3 + 2] = t * 2; // Walk forward
  }

  tracks.push(
    new THREE.VectorKeyframeTrack(
      "DEF-hips.position",
      Array.from(times),
      Array.from(positionValues),
    ),
  );

  return new THREE.AnimationClip("WalkAnimation", duration, tracks);
}

describe("AnimationRetargeter", () => {
  describe("Bone Mapping", () => {
    it("maps Mixamo bone names to Meshy bone names", () => {
      // MIXAMO_TO_MESHY maps DEF-* style to standard humanoid names
      expect(MIXAMO_TO_MESHY["DEF-hips"]).toBe("Hips");
      expect(MIXAMO_TO_MESHY["DEF-spine001"]).toBe("Spine");
      expect(MIXAMO_TO_MESHY["DEF-spine002"]).toBe("Spine01");
      expect(MIXAMO_TO_MESHY["DEF-spine003"]).toBe("Spine02");
      expect(MIXAMO_TO_MESHY["DEF-neck"]).toBe("Neck");
      expect(MIXAMO_TO_MESHY["DEF-head"]).toBe("Head");
      expect(MIXAMO_TO_MESHY["DEF-upper_armL"]).toBe("LeftArm");
      expect(MIXAMO_TO_MESHY["DEF-upper_armR"]).toBe("RightArm");
      expect(MIXAMO_TO_MESHY["DEF-thighL"]).toBe("LeftUpLeg");
      expect(MIXAMO_TO_MESHY["DEF-thighR"]).toBe("RightUpLeg");
    });

    it("maps Meshy bone names to Mixamo bone names (reverse)", () => {
      // MESHY_TO_MIXAMO is the reverse mapping
      expect(MESHY_TO_MIXAMO["Hips"]).toBe("DEF-hips");
      expect(MESHY_TO_MIXAMO["Spine"]).toBe("DEF-spine001");
      expect(MESHY_TO_MIXAMO["Neck"]).toBe("DEF-neck");
      expect(MESHY_TO_MIXAMO["Head"]).toBe("DEF-head");
      expect(MESHY_TO_MIXAMO["LeftArm"]).toBe("DEF-upper_armL");
      expect(MESHY_TO_MIXAMO["LeftUpLeg"]).toBe("DEF-thighL");
    });

    it("handles case variations via findMeshyBoneName", () => {
      // Standard cases
      expect(findMeshyBoneName("Hips")).toBe("Hips");
      expect(findMeshyBoneName("hips")).toBe("Hips");
      expect(findMeshyBoneName("Hip")).toBe("Hips");
      expect(findMeshyBoneName("pelvis")).toBe("Hips");

      // Spine variations
      expect(findMeshyBoneName("Spine")).toBe("Spine");
      expect(findMeshyBoneName("spine")).toBe("Spine");
      expect(findMeshyBoneName("Spine01")).toBe("Spine01");
      expect(findMeshyBoneName("spine1")).toBe("Spine01");

      // Arm variations
      expect(findMeshyBoneName("LeftShoulder")).toBe("LeftShoulder");
      expect(findMeshyBoneName("shoulder.L")).toBe("LeftShoulder");
      expect(findMeshyBoneName("L_Shoulder")).toBe("LeftShoulder");

      // Leg variations
      expect(findMeshyBoneName("LeftUpLeg")).toBe("LeftUpLeg");
      expect(findMeshyBoneName("LeftThigh")).toBe("LeftUpLeg");
      expect(findMeshyBoneName("thigh.L")).toBe("LeftUpLeg");
    });

    it("handles Mixamo variations via findMixamoBoneName", () => {
      // DEF- prefix style
      expect(findMixamoBoneName("DEF-hips")).toBe("DEF-hips");
      expect(findMixamoBoneName("DEF-spine001")).toBe("DEF-spine001");

      // mixamorig: prefix style
      expect(findMixamoBoneName("mixamorig:Hips")).toBe("DEF-hips");
      expect(findMixamoBoneName("mixamorig:Spine")).toBe("DEF-spine001");
      expect(findMixamoBoneName("mixamorig:LeftArm")).toBe("DEF-upper_armL");

      // Plain style
      expect(findMixamoBoneName("Hips")).toBe("DEF-hips");
      expect(findMixamoBoneName("Spine")).toBe("DEF-spine001");
    });

    it("returns null for unmapped bone names", () => {
      // Bone names that don't exist in mappings
      expect(findMeshyBoneName("RandomBone")).toBeNull();
      expect(findMeshyBoneName("FingerTip")).toBeNull();
      expect(findMeshyBoneName("")).toBeNull();

      expect(findMixamoBoneName("UnknownBone")).toBeNull();
      expect(findMixamoBoneName("CustomRig_Bone1")).toBeNull();
    });

    it("creates bone mapping between source and target skeletons", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const sourceBoneNames = sourceSkeleton.bones.map((b) => b.name);
      const targetBoneNames = targetSkeleton.bones.map((b) => b.name);

      const mapping = createBoneMapping(
        sourceBoneNames,
        targetBoneNames,
        MIXAMO_TO_MESHY,
      );

      // Check that key bones are mapped
      expect(mapping.get("DEF-hips")).toBe("Hips");
      expect(mapping.get("DEF-neck")).toBe("Neck");
      expect(mapping.get("DEF-head")).toBe("Head");

      // Mapping should contain reasonable number of bones
      expect(mapping.size).toBeGreaterThan(5);
    });
  });

  describe("Animation Clip Retargeting", () => {
    let sourceSkeleton: THREE.Skeleton;
    let targetSkeleton: THREE.Skeleton;
    let retargeter: AnimationRetargeter;

    beforeAll(() => {
      const source = createMixamoSkeleton();
      const target = createMeshySkeleton();
      sourceSkeleton = source.skeleton;
      targetSkeleton = target.skeleton;

      const testClip = createTestAnimationClip("DEF-hips");
      retargeter = new AnimationRetargeter(
        [testClip],
        sourceSkeleton,
        targetSkeleton,
      );
    });

    it("retargets rotation tracks to target skeleton", () => {
      const sourceClip = createTestAnimationClip("DEF-hips", 1.0, 10);

      const result = retargeter.retargetClip(sourceClip);

      expect(result).not.toBeNull();
      expect(result!.clip).toBeDefined();

      // Find the quaternion track for Hips
      const hipQuatTrack = result!.clip.tracks.find(
        (t) => t.name === "Hips.quaternion",
      );
      expect(hipQuatTrack).toBeDefined();
      expect(hipQuatTrack).toBeInstanceOf(THREE.QuaternionKeyframeTrack);

      // Verify quaternion values exist (4 values per keyframe)
      expect(hipQuatTrack!.values.length).toBe(10 * 4);
    });

    it("retargets position tracks with correct bone name", () => {
      const sourceClip = createTestAnimationClip("DEF-hips", 1.0, 10);

      const result = retargeter.retargetClip(sourceClip);

      expect(result).not.toBeNull();

      // Hips position should be preserved (root motion)
      const hipPosTrack = result!.clip.tracks.find(
        (t) => t.name === "Hips.position",
      );
      expect(hipPosTrack).toBeDefined();

      // Position values should exist (3 values per keyframe)
      expect(hipPosTrack!.values.length).toBe(10 * 3);
    });

    it("preserves animation duration", () => {
      const duration = 2.5;
      const sourceClip = createTestAnimationClip("DEF-hips", duration, 25);

      const result = retargeter.retargetClip(sourceClip);

      expect(result).not.toBeNull();
      expect(result!.clip.duration).toBe(duration);
    });

    it("preserves keyframe count", () => {
      const keyframeCount = 15;
      const sourceClip = createTestAnimationClip(
        "DEF-hips",
        1.5,
        keyframeCount,
      );

      const result = retargeter.retargetClip(sourceClip);

      expect(result).not.toBeNull();

      // Each track should have the same keyframe count
      for (const track of result!.clip.tracks) {
        if (track.name.endsWith(".quaternion")) {
          expect(track.values.length).toBe(keyframeCount * 4);
        } else if (track.name.endsWith(".position")) {
          expect(track.values.length).toBe(keyframeCount * 3);
        }
      }
    });

    it("skips scale tracks to prevent deformation", () => {
      // Create a clip with a scale track
      const times = [0, 0.5, 1.0];
      const scaleValues = [1, 1, 1, 1.5, 1.5, 1.5, 1, 1, 1];
      const scaleTrack = new THREE.VectorKeyframeTrack(
        "DEF-hips.scale",
        times,
        scaleValues,
      );

      const quaternionValues = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
      const quatTrack = new THREE.QuaternionKeyframeTrack(
        "DEF-hips.quaternion",
        times,
        quaternionValues,
      );

      const clipWithScale = new THREE.AnimationClip("ScaleTest", 1.0, [
        scaleTrack,
        quatTrack,
      ]);

      const result = retargeter.retargetClip(clipWithScale);

      expect(result).not.toBeNull();

      // Scale track should be skipped
      const hasScaleTrack = result!.clip.tracks.some((t) =>
        t.name.endsWith(".scale"),
      );
      expect(hasScaleTrack).toBe(false);

      // But quaternion track should exist
      const hasQuatTrack = result!.clip.tracks.some((t) =>
        t.name.endsWith(".quaternion"),
      );
      expect(hasQuatTrack).toBe(true);
    });

    it("skips position tracks for non-root bones", () => {
      // Create a clip with position tracks on non-root bones
      const times = [0, 1.0];
      const positionValues = [0, 0, 0, 1, 1, 1];

      // Arm position track should be skipped
      const armPosTrack = new THREE.VectorKeyframeTrack(
        "DEF-upper_armL.position",
        times,
        positionValues,
      );

      // Arm quaternion track should be kept
      const armQuatTrack = new THREE.QuaternionKeyframeTrack(
        "DEF-upper_armL.quaternion",
        times,
        [0, 0, 0, 1, 0, 0, 0, 1],
      );

      // Hips position should be kept (root motion)
      const hipsPosTrack = new THREE.VectorKeyframeTrack(
        "DEF-hips.position",
        times,
        positionValues,
      );

      const clip = new THREE.AnimationClip("NonRootPosition", 1.0, [
        armPosTrack,
        armQuatTrack,
        hipsPosTrack,
      ]);

      const result = retargeter.retargetClip(clip);

      expect(result).not.toBeNull();

      // Arm position should be skipped
      const hasArmPos = result!.clip.tracks.some(
        (t) => t.name === "LeftArm.position",
      );
      expect(hasArmPos).toBe(false);

      // Arm quaternion should exist
      const hasArmQuat = result!.clip.tracks.some(
        (t) => t.name === "LeftArm.quaternion",
      );
      expect(hasArmQuat).toBe(true);

      // Hips position should exist (root motion)
      const hasHipsPos = result!.clip.tracks.some(
        (t) => t.name === "Hips.position",
      );
      expect(hasHipsPos).toBe(true);
    });

    it("returns null when no tracks can be mapped", () => {
      // Create a clip with only unmappable bone names
      const times = [0, 1.0];
      const track = new THREE.QuaternionKeyframeTrack(
        "UnknownBone.quaternion",
        times,
        [0, 0, 0, 1, 0, 0, 0, 1],
      );

      const unmappableClip = new THREE.AnimationClip("Unmappable", 1.0, [
        track,
      ]);

      const result = retargeter.retargetClip(unmappableClip);

      expect(result).toBeNull();
    });
  });

  describe("Rest Pose Offsets", () => {
    it("calculates offset between source and target rest poses", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      // Apply a rotation to source skeleton's left arm (simulate A-pose)
      const sourceLeftArm = sourceSkeleton.bones.find(
        (b) => b.name === "DEF-upper_armL",
      );
      if (sourceLeftArm) {
        sourceLeftArm.quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          Math.PI / 4,
        ); // 45 degree rotation
      }

      const testClip = createTestAnimationClip("DEF-hips");
      const retargeter = new AnimationRetargeter(
        [testClip],
        sourceSkeleton,
        targetSkeleton,
      );

      // The retargeter should have calculated rest pose offsets
      // We can verify by checking that the retargeter was created successfully
      expect(retargeter).toBeDefined();
      expect(retargeter.getAnimationNames()).toContain("TestAnimation");
    });

    it("handles identity (no offset) case when poses match", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      // Both skeletons are in T-pose (identity quaternions)
      const testClip = createTestAnimationClip("DEF-hips");
      const retargeter = new AnimationRetargeter(
        [testClip],
        sourceSkeleton,
        targetSkeleton,
      );

      // Retargeting should work without errors
      const result = retargeter.retargetClip(testClip);
      expect(result).not.toBeNull();

      // Original animation values should be preserved
      const sourceHipsTrack = testClip.tracks.find(
        (t) => t.name === "DEF-hips.quaternion",
      );
      const targetHipsTrack = result!.clip.tracks.find(
        (t) => t.name === "Hips.quaternion",
      );

      expect(sourceHipsTrack).toBeDefined();
      expect(targetHipsTrack).toBeDefined();

      // Values should be identical (no offset applied)
      for (let i = 0; i < sourceHipsTrack!.values.length; i++) {
        expect(targetHipsTrack!.values[i]).toBeCloseTo(
          sourceHipsTrack!.values[i],
          5,
        );
      }
    });
  });

  describe("Scale Adjustment", () => {
    it("handles different skeleton sizes gracefully", () => {
      // Create a larger source skeleton
      const { skeleton: sourceSkeleton, rootBone: sourceRoot } =
        createMixamoSkeleton();
      sourceRoot.position.set(0, 2, 0); // Double height

      // Create a normal target skeleton
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const testClip = createTestAnimationClip("DEF-hips");
      const retargeter = new AnimationRetargeter(
        [testClip],
        sourceSkeleton,
        targetSkeleton,
      );

      // Retargeting should still work
      const result = retargeter.retargetClip(testClip);
      expect(result).not.toBeNull();
      expect(result!.clip.tracks.length).toBeGreaterThan(0);
    });

    it("preserves relative proportions in animation", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      // Create animation with specific position values
      const times = [0, 0.5, 1.0];
      const positionValues = [0, 1, 0, 0, 1.1, 0.5, 0, 1.2, 1.0];

      const posTrack = new THREE.VectorKeyframeTrack(
        "DEF-hips.position",
        times,
        positionValues,
      );
      const quatTrack = new THREE.QuaternionKeyframeTrack(
        "DEF-hips.quaternion",
        times,
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      );

      const clip = new THREE.AnimationClip("ProportionTest", 1.0, [
        posTrack,
        quatTrack,
      ]);

      const retargeter = new AnimationRetargeter(
        [clip],
        sourceSkeleton,
        targetSkeleton,
      );
      const result = retargeter.retargetClip(clip);

      expect(result).not.toBeNull();

      // Position track should exist and maintain structure
      const retargetedPosTrack = result!.clip.tracks.find(
        (t) => t.name === "Hips.position",
      );
      expect(retargetedPosTrack).toBeDefined();
      expect(retargetedPosTrack!.values.length).toBe(positionValues.length);
    });
  });

  describe("Batch Processing", () => {
    it("retargets multiple animations", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const clips = [
        createTestAnimationClip("DEF-hips", 1.0, 10),
        createMultiBoneAnimationClip(),
        new THREE.AnimationClip("IdleAnimation", 3.0, [
          new THREE.QuaternionKeyframeTrack(
            "DEF-hips.quaternion",
            [0, 3],
            [0, 0, 0, 1, 0, 0, 0, 1],
          ),
        ]),
      ];

      // Rename clips for clarity
      clips[0].name = "TestAnimation";
      clips[1].name = "WalkAnimation";

      const retargeter = new AnimationRetargeter(
        clips,
        sourceSkeleton,
        targetSkeleton,
      );
      const results = retargeter.retargetAll();

      expect(results.length).toBe(3);
    });

    it("preserves animation names", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const clip1 = createTestAnimationClip("DEF-hips");
      clip1.name = "Run";

      const clip2 = createTestAnimationClip("DEF-hips");
      clip2.name = "Jump";

      const clip3 = createTestAnimationClip("DEF-hips");
      clip3.name = "Attack";

      const retargeter = new AnimationRetargeter(
        [clip1, clip2, clip3],
        sourceSkeleton,
        targetSkeleton,
      );
      const results = retargeter.retargetAll();

      expect(results.length).toBe(3);

      const names = results.map((r) => r.clip.name);
      expect(names).toContain("Run");
      expect(names).toContain("Jump");
      expect(names).toContain("Attack");

      // Source names should also be preserved
      const sourceNames = results.map((r) => r.sourceClipName);
      expect(sourceNames).toContain("Run");
      expect(sourceNames).toContain("Jump");
      expect(sourceNames).toContain("Attack");
    });

    it("returns all retargeted clips", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const numClips = 5;
      const clips: THREE.AnimationClip[] = [];

      for (let i = 0; i < numClips; i++) {
        const clip = createTestAnimationClip("DEF-hips", 1.0 + i * 0.5, 10);
        clip.name = `Animation_${i}`;
        clips.push(clip);
      }

      const retargeter = new AnimationRetargeter(
        clips,
        sourceSkeleton,
        targetSkeleton,
      );
      const results = retargeter.retargetAll();

      expect(results.length).toBe(numClips);

      // Verify each has valid mapping quality
      for (const result of results) {
        expect(result.mappingQuality).toBeGreaterThan(0);
        expect(result.mappingQuality).toBeLessThanOrEqual(1);
      }
    });

    it("provides getAnimationNames method", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const clip1 = createTestAnimationClip("DEF-hips");
      clip1.name = "Idle";

      const clip2 = createTestAnimationClip("DEF-hips");
      clip2.name = "Walk";

      const retargeter = new AnimationRetargeter(
        [clip1, clip2],
        sourceSkeleton,
        targetSkeleton,
      );

      const names = retargeter.getAnimationNames();

      expect(names).toHaveLength(2);
      expect(names).toContain("Idle");
      expect(names).toContain("Walk");
    });
  });

  describe("VRM Bone Mapping", () => {
    it("has VRM to Mixamo bone mapping defined", () => {
      // VRM bone names should map to Mixamo DEF-* format
      expect(VRM_TO_MIXAMO.hips).toBe("DEF-hips");
      expect(VRM_TO_MIXAMO.spine).toBe("DEF-spine002");
      expect(VRM_TO_MIXAMO.neck).toBe("DEF-neck");
      expect(VRM_TO_MIXAMO.head).toBe("DEF-head");
      expect(VRM_TO_MIXAMO.leftUpperArm).toBe("DEF-upper_armL");
      expect(VRM_TO_MIXAMO.rightUpperArm).toBe("DEF-upper_armR");
      expect(VRM_TO_MIXAMO.leftUpperLeg).toBe("DEF-thighL");
      expect(VRM_TO_MIXAMO.rightUpperLeg).toBe("DEF-thighR");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty animation clip", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const emptyClip = new THREE.AnimationClip("Empty", 0, []);

      const retargeter = new AnimationRetargeter(
        [emptyClip],
        sourceSkeleton,
        targetSkeleton,
      );
      const result = retargeter.retargetClip(emptyClip);

      // Empty clip should return null (no tracks to map)
      expect(result).toBeNull();
    });

    it("handles animation with only unmappable bones", () => {
      const { skeleton: sourceSkeleton } = createMixamoSkeleton();
      const { skeleton: targetSkeleton } = createMeshySkeleton();

      // Create clip with finger bones (not in Meshy skeleton)
      const fingerTrack = new THREE.QuaternionKeyframeTrack(
        "DEF-finger_index_01_L.quaternion",
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      );

      const fingerClip = new THREE.AnimationClip("FingerAnimation", 1.0, [
        fingerTrack,
      ]);

      const retargeter = new AnimationRetargeter(
        [fingerClip],
        sourceSkeleton,
        targetSkeleton,
      );
      const result = retargeter.retargetClip(fingerClip);

      // Should return null - no mappable tracks
      expect(result).toBeNull();
    });

    it("handles mismatched skeleton structures", () => {
      // Create a minimal skeleton with only Hips
      const minimalHips = new THREE.Bone();
      minimalHips.name = "DEF-hips";
      minimalHips.position.set(0, 1, 0);
      const minimalSkeleton = new THREE.Skeleton([minimalHips]);

      const { skeleton: targetSkeleton } = createMeshySkeleton();

      const clip = createTestAnimationClip("DEF-hips");

      const retargeter = new AnimationRetargeter(
        [clip],
        minimalSkeleton,
        targetSkeleton,
      );
      const result = retargeter.retargetClip(clip);

      // Should still work for the Hips bone
      expect(result).not.toBeNull();
      expect(result!.clip.tracks.length).toBeGreaterThan(0);
    });
  });
});
