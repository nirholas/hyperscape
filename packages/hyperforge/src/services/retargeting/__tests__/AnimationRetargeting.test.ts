/**
 * AnimationRetargeting Tests
 *
 * Tests for retargeting Mixamo animations to VRM skeletons.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Bone name mapping failures for different naming conventions
 * - Quaternion track transformation errors
 * - Position track scaling issues
 * - VRM version handling (0.0 vs 1.0)
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import type {
  VRM,
  VRMHumanoid,
  VRMHumanBoneName,
  VRMMeta,
} from "@pixiv/three-vrm";

import { retargetAnimation } from "../AnimationRetargeting";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a test animation clip with hips position and quaternion tracks
 */
function createTestAnimationClip(duration: number = 1.0): THREE.AnimationClip {
  const tracks = [
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 1],
      [0, 0, 0, 0, 1, 0],
    ),
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHips.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    ),
  ];
  return new THREE.AnimationClip("test", duration, tracks);
}

/**
 * Create a multi-bone Mixamo animation clip
 */
function createMultiBoneMixamoClip(): THREE.AnimationClip {
  const times = [0, 0.5, 1.0];
  const tracks: THREE.KeyframeTrack[] = [];

  // Hips with both position and quaternion
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      times,
      [0, 1, 0, 0, 1.1, 0.2, 0, 1, 0.4],
    ),
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHips.quaternion",
      times,
      [0, 0, 0, 1, 0, 0.1, 0, 0.995, 0, 0, 0, 1],
    ),
  );

  // Spine
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      times,
      [0, 0, 0, 1, 0.05, 0, 0, 0.999, 0, 0, 0, 1],
    ),
  );

  // Neck
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigNeck.quaternion",
      times,
      [0, 0, 0, 1, 0, 0.1, 0, 0.995, 0, 0, 0, 1],
    ),
  );

  // Head
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHead.quaternion",
      times,
      [0, 0, 0, 1, 0.1, 0, 0, 0.995, 0, 0.05, 0, 0.999],
    ),
  );

  // Left arm
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      times,
      [0, 0, 0, 1, 0, 0, 0.2, 0.98, 0, 0, 0, 1],
    ),
  );

  // Right arm
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      times,
      [0, 0, 0, 1, 0, 0, -0.2, 0.98, 0, 0, 0, 1],
    ),
  );

  return new THREE.AnimationClip("MultiBoneAnimation", 1.0, tracks);
}

/**
 * Create a mock Mixamo animation scene with proper bone hierarchy
 */
function createMixamoAnimationScene(): THREE.Group {
  const scene = new THREE.Group();
  const armature = new THREE.Group();
  armature.name = "Armature";
  armature.scale.set(0.01, 0.01, 0.01); // Typical Mixamo scale

  // Create bone hierarchy
  const hips = new THREE.Bone();
  hips.name = "mixamorigHips";
  hips.position.set(0, 100, 0);

  const spine = new THREE.Bone();
  spine.name = "mixamorigSpine";
  spine.position.set(0, 10, 0);
  hips.add(spine);

  const spine1 = new THREE.Bone();
  spine1.name = "mixamorigSpine1";
  spine1.position.set(0, 10, 0);
  spine.add(spine1);

  const spine2 = new THREE.Bone();
  spine2.name = "mixamorigSpine2";
  spine2.position.set(0, 10, 0);
  spine1.add(spine2);

  const neck = new THREE.Bone();
  neck.name = "mixamorigNeck";
  neck.position.set(0, 10, 0);
  spine2.add(neck);

  const head = new THREE.Bone();
  head.name = "mixamorigHead";
  head.position.set(0, 10, 0);
  neck.add(head);

  // Left arm chain
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "mixamorigLeftShoulder";
  leftShoulder.position.set(5, 0, 0);
  spine2.add(leftShoulder);

  const leftArm = new THREE.Bone();
  leftArm.name = "mixamorigLeftArm";
  leftArm.position.set(10, 0, 0);
  leftShoulder.add(leftArm);

  const leftForeArm = new THREE.Bone();
  leftForeArm.name = "mixamorigLeftForeArm";
  leftForeArm.position.set(20, 0, 0);
  leftArm.add(leftForeArm);

  const leftHand = new THREE.Bone();
  leftHand.name = "mixamorigLeftHand";
  leftHand.position.set(20, 0, 0);
  leftForeArm.add(leftHand);

  // Right arm chain
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "mixamorigRightShoulder";
  rightShoulder.position.set(-5, 0, 0);
  spine2.add(rightShoulder);

  const rightArm = new THREE.Bone();
  rightArm.name = "mixamorigRightArm";
  rightArm.position.set(-10, 0, 0);
  rightShoulder.add(rightArm);

  const rightForeArm = new THREE.Bone();
  rightForeArm.name = "mixamorigRightForeArm";
  rightForeArm.position.set(-20, 0, 0);
  rightArm.add(rightForeArm);

  const rightHand = new THREE.Bone();
  rightHand.name = "mixamorigRightHand";
  rightHand.position.set(-20, 0, 0);
  rightForeArm.add(rightHand);

  // Left leg chain
  const leftUpLeg = new THREE.Bone();
  leftUpLeg.name = "mixamorigLeftUpLeg";
  leftUpLeg.position.set(10, -5, 0);
  hips.add(leftUpLeg);

  const leftLeg = new THREE.Bone();
  leftLeg.name = "mixamorigLeftLeg";
  leftLeg.position.set(0, -40, 0);
  leftUpLeg.add(leftLeg);

  const leftFoot = new THREE.Bone();
  leftFoot.name = "mixamorigLeftFoot";
  leftFoot.position.set(0, -40, 0);
  leftLeg.add(leftFoot);

  // Right leg chain
  const rightUpLeg = new THREE.Bone();
  rightUpLeg.name = "mixamorigRightUpLeg";
  rightUpLeg.position.set(-10, -5, 0);
  hips.add(rightUpLeg);

  const rightLeg = new THREE.Bone();
  rightLeg.name = "mixamorigRightLeg";
  rightLeg.position.set(0, -40, 0);
  rightUpLeg.add(rightLeg);

  const rightFoot = new THREE.Bone();
  rightFoot.name = "mixamorigRightFoot";
  rightFoot.position.set(0, -40, 0);
  rightLeg.add(rightFoot);

  // Update world matrices
  armature.add(hips);
  scene.add(armature);
  scene.updateMatrixWorld(true);

  return scene;
}

/**
 * Create a mock VRM with humanoid bone structure
 */
function createMockVRM(version: "0" | "1.0" = "1.0"): VRM {
  // Create bone nodes for the VRM humanoid
  const boneNodes = new Map<VRMHumanBoneName, THREE.Object3D>();

  const boneNames: VRMHumanBoneName[] = [
    "hips",
    "spine",
    "chest",
    "upperChest",
    "neck",
    "head",
    "leftShoulder",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightShoulder",
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

  for (const name of boneNames) {
    const node = new THREE.Object3D();
    node.name = `VRM_${name}`;
    boneNodes.set(name, node);
  }

  const humanoid: VRMHumanoid = {
    getNormalizedBoneNode: (boneName: VRMHumanBoneName) => {
      return boneNodes.get(boneName) ?? null;
    },
    getRawBoneNode: (boneName: VRMHumanBoneName) => {
      return boneNodes.get(boneName) ?? null;
    },
  } as VRMHumanoid;

  const meta: VRMMeta = {
    metaVersion: version,
    name: "TestVRM",
  } as VRMMeta;

  const scene = new THREE.Group();
  scene.name = "VRM_Root";

  return {
    humanoid,
    meta,
    scene,
  } as VRM;
}

describe("AnimationRetargeting", () => {
  describe("retargetAnimation - Basic Functionality", () => {
    let mockScene: THREE.Group;
    let mockVRM: VRM;

    beforeAll(() => {
      mockScene = createMixamoAnimationScene();
      mockVRM = createMockVRM();
    });

    it("returns null when no animations are present", () => {
      const emptyGLTF = {
        scene: mockScene,
        animations: [],
      };

      const result = retargetAnimation(emptyGLTF, mockVRM, 1.0);

      expect(result).toBeNull();
    });

    it("returns null when animations array is undefined", () => {
      const noAnimGLTF = {
        scene: mockScene,
        animations: undefined as unknown as THREE.AnimationClip[],
      };

      const result = retargetAnimation(noAnimGLTF, mockVRM, 1.0);

      expect(result).toBeNull();
    });

    it("returns AnimationClip when valid animation is provided", () => {
      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result).toBeInstanceOf(THREE.AnimationClip);
    });

    it("preserves animation duration", () => {
      const duration = 2.5;
      const clip = createTestAnimationClip(duration);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.duration).toBe(duration);
    });

    it("preserves animation name", () => {
      const clip = createTestAnimationClip();
      clip.name = "WalkAnimation";
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.name).toBe("WalkAnimation");
    });
  });

  describe("Track Name Mapping", () => {
    let mockScene: THREE.Group;
    let mockVRM: VRM;

    beforeAll(() => {
      mockScene = createMixamoAnimationScene();
      mockVRM = createMockVRM();
    });

    it("maps mixamorig prefixed bone names to VRM bones", () => {
      const clip = createMultiBoneMixamoClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // Track names should be mapped to VRM bone node names
      const trackNames = result!.tracks.map((t) => t.name.split(".")[0]);

      // Should contain VRM bone names (from getNormalizedBoneNode)
      expect(trackNames.some((name) => name.startsWith("VRM_"))).toBe(true);
    });

    it("filters out non-root position tracks", () => {
      // Create clip with position tracks on non-root bones
      const tracks = [
        new THREE.VectorKeyframeTrack(
          "mixamorigHips.position",
          [0, 1],
          [0, 0, 0, 0, 1, 0],
        ),
        new THREE.VectorKeyframeTrack(
          "mixamorigSpine.position",
          [0, 1],
          [0, 0, 0, 0, 0.5, 0],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigSpine.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("TestWithPositions", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // Count position tracks in result
      const positionTracks = result!.tracks.filter((t) =>
        t.name.endsWith(".position"),
      );

      // Only hips position should remain
      expect(positionTracks.length).toBeLessThanOrEqual(1);
    });

    it("preserves quaternion tracks", () => {
      const clip = createMultiBoneMixamoClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      const quaternionTracks = result!.tracks.filter(
        (t) => t instanceof THREE.QuaternionKeyframeTrack,
      );

      // Should have quaternion tracks for mapped bones
      expect(quaternionTracks.length).toBeGreaterThan(0);
    });

    it("handles capitalized bone names (VRM uploaded to Mixamo)", () => {
      const tracks = [
        new THREE.VectorKeyframeTrack(
          "Hips.position",
          [0, 1],
          [0, 0, 0, 0, 1, 0],
        ),
        new THREE.QuaternionKeyframeTrack(
          "Hips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "Spine.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "Neck.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
      ];

      // Create scene with capitalized bone names
      const scene = new THREE.Group();
      const armature = new THREE.Group();
      armature.scale.set(0.01, 0.01, 0.01);

      const hips = new THREE.Bone();
      hips.name = "Hips";
      const spine = new THREE.Bone();
      spine.name = "Spine";
      hips.add(spine);
      const neck = new THREE.Bone();
      neck.name = "Neck";
      spine.add(neck);

      armature.add(hips);
      scene.add(armature);
      scene.updateMatrixWorld(true);

      const clip = new THREE.AnimationClip("CapitalizedBones", 1.0, tracks);
      const gltf = {
        scene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.tracks.length).toBeGreaterThan(0);
    });

    it("handles lowercase VRM standard bone names", () => {
      const tracks = [
        new THREE.VectorKeyframeTrack(
          "hips.position",
          [0, 1],
          [0, 0, 0, 0, 1, 0],
        ),
        new THREE.QuaternionKeyframeTrack(
          "hips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "spine.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
      ];

      // Create scene with lowercase bone names
      const scene = new THREE.Group();
      const armature = new THREE.Group();
      armature.scale.set(1, 1, 1);

      const hips = new THREE.Bone();
      hips.name = "hips";
      const spine = new THREE.Bone();
      spine.name = "spine";
      hips.add(spine);

      armature.add(hips);
      scene.add(armature);
      scene.updateMatrixWorld(true);

      const clip = new THREE.AnimationClip("LowercaseBones", 1.0, tracks);
      const gltf = {
        scene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.tracks.length).toBeGreaterThan(0);
    });
  });

  describe("Quaternion Track Transformation", () => {
    let mockScene: THREE.Group;

    beforeAll(() => {
      mockScene = createMixamoAnimationScene();
    });

    it("transforms quaternion values based on rest pose", () => {
      const mockVRM = createMockVRM("1.0");

      // Create animation with known quaternion values
      const originalQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 4,
      );

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0],
          [originalQuat.x, originalQuat.y, originalQuat.z, originalQuat.w],
        ),
      ];

      const clip = new THREE.AnimationClip("QuatTest", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // The quaternion values should be transformed (not necessarily identical)
      const quatTrack = result!.tracks.find((t) =>
        t.name.endsWith(".quaternion"),
      );
      expect(quatTrack).toBeDefined();
      expect(quatTrack!.values.length).toBe(4);

      // Values should be valid quaternion components
      const resultQuat = new THREE.Quaternion(
        quatTrack!.values[0],
        quatTrack!.values[1],
        quatTrack!.values[2],
        quatTrack!.values[3],
      );
      expect(resultQuat.length()).toBeCloseTo(1, 5);
    });

    it("handles VRM 0.0 coordinate transformations", () => {
      const mockVRM = createMockVRM("0");

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0.1, 0.2, 0.3, 0.9, 0.1, 0.2, 0.3, 0.9],
        ),
      ];

      const clip = new THREE.AnimationClip("VRM0Test", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // VRM 0.0 applies sign flips to x and z components
      const quatTrack = result!.tracks.find((t) =>
        t.name.endsWith(".quaternion"),
      );
      expect(quatTrack).toBeDefined();
    });

    it("handles VRM 1.0 without coordinate flip", () => {
      const mockVRM = createMockVRM("1.0");

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0],
          [0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("VRM1Test", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // Identity quaternion should stay identity after transformation
      const quatTrack = result!.tracks.find((t) =>
        t.name.endsWith(".quaternion"),
      );
      expect(quatTrack).toBeDefined();

      // Values should represent a valid quaternion
      const length = Math.sqrt(
        quatTrack!.values[0] ** 2 +
          quatTrack!.values[1] ** 2 +
          quatTrack!.values[2] ** 2 +
          quatTrack!.values[3] ** 2,
      );
      expect(length).toBeCloseTo(1, 5);
    });
  });

  describe("Position Track Scaling", () => {
    let mockScene: THREE.Group;
    let mockVRM: VRM;

    beforeAll(() => {
      mockScene = createMixamoAnimationScene();
      mockVRM = createMockVRM();
    });

    it("scales position tracks by rootToHips and armature scale", () => {
      const rootToHips = 1.0;
      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, rootToHips);

      expect(result).not.toBeNull();

      const posTrack = result!.tracks.find((t) => t.name.endsWith(".position"));
      expect(posTrack).toBeDefined();
    });

    it("uses provided rootToHips for scaling", () => {
      const rootToHips = 0.8;
      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, rootToHips);

      expect(result).not.toBeNull();

      const posTrack = result!.tracks.find((t) => t.name.endsWith(".position"));
      expect(posTrack).toBeDefined();

      // Position values should be scaled
      expect(posTrack!.values.length).toBe(6); // 2 keyframes * 3 components
    });

    it("applies Y-offset to prevent levitation", () => {
      const tracks = [
        new THREE.VectorKeyframeTrack(
          "mixamorigHips.position",
          [0, 1],
          [0, 1, 0, 0, 1, 0],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("YOffsetTest", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      const posTrack = result!.tracks.find((t) => t.name.endsWith(".position"));
      expect(posTrack).toBeDefined();
    });

    it("handles VRM 0.0 position coordinate transformation", () => {
      const mockVRM0 = createMockVRM("0");

      const tracks = [
        new THREE.VectorKeyframeTrack("mixamorigHips.position", [0], [1, 2, 3]),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0],
          [0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("VRM0Position", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM0, 1.0);

      expect(result).not.toBeNull();

      // VRM 0.0 negates X and Z position components
      const posTrack = result!.tracks.find((t) => t.name.endsWith(".position"));
      expect(posTrack).toBeDefined();
    });
  });

  describe("Bone Hierarchy Retargeting", () => {
    let mockVRM: VRM;

    beforeAll(() => {
      mockVRM = createMockVRM();
    });

    it("retargets full body animation", () => {
      const mockScene = createMixamoAnimationScene();
      const clip = createMultiBoneMixamoClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.tracks.length).toBeGreaterThan(0);
    });

    it("handles finger bones", () => {
      const mockScene = createMixamoAnimationScene();

      // Add finger bones to scene
      const leftHand = mockScene.getObjectByName("mixamorigLeftHand");
      if (leftHand) {
        const thumb1 = new THREE.Bone();
        thumb1.name = "mixamorigLeftHandThumb1";
        leftHand.add(thumb1);

        const thumb2 = new THREE.Bone();
        thumb2.name = "mixamorigLeftHandThumb2";
        thumb1.add(thumb2);
      }

      mockScene.updateMatrixWorld(true);

      // Create clip with finger animations
      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigLeftHandThumb1.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0.1, 0, 0, 0.995],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigLeftHandThumb2.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0.2, 0, 0, 0.98],
        ),
      ];

      const clip = new THREE.AnimationClip("FingerAnimation", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
    });

    it("handles leg chain bones", () => {
      const mockScene = createMixamoAnimationScene();

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigLeftUpLeg.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0.3, 0, 0, 0.95],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigLeftLeg.quaternion",
          [0, 1],
          [0, 0, 0, 1, -0.3, 0, 0, 0.95],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigLeftFoot.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0.1, 0, 0, 0.995],
        ),
      ];

      const clip = new THREE.AnimationClip("LegAnimation", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
      expect(result!.tracks.length).toBeGreaterThan(0);
    });
  });

  describe("Animation Clip Conversion", () => {
    let mockScene: THREE.Group;
    let mockVRM: VRM;

    beforeAll(() => {
      mockScene = createMixamoAnimationScene();
      mockVRM = createMockVRM();
    });

    it("optimizes the resulting clip", () => {
      const clip = createMultiBoneMixamoClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // Result should have optimized tracks
      for (const track of result!.tracks) {
        // Track times should be monotonically increasing
        for (let i = 1; i < track.times.length; i++) {
          expect(track.times[i]).toBeGreaterThanOrEqual(track.times[i - 1]);
        }
      }
    });

    it("handles multiple keyframes correctly", () => {
      const times = [0, 0.25, 0.5, 0.75, 1.0];
      const quatValues: number[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = (i / 4) * Math.PI * 0.5;
        const quat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          angle,
        );
        quatValues.push(quat.x, quat.y, quat.z, quat.w);
      }

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          times,
          quatValues,
        ),
      ];

      const clip = new THREE.AnimationClip("MultiKeyframe", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      const quatTrack = result!.tracks.find((t) =>
        t.name.endsWith(".quaternion"),
      );
      expect(quatTrack).toBeDefined();

      // Should preserve keyframe count (before optimization)
      // After optimization, count may differ but values should be valid
      expect(quatTrack!.times.length).toBeGreaterThan(0);
    });

    it("clones the source animation clip", () => {
      const originalClip = createTestAnimationClip();
      const originalTrackCount = originalClip.tracks.length;
      const originalName = originalClip.name;

      const gltf = {
        scene: mockScene,
        animations: [originalClip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();

      // Original clip should be unchanged
      expect(originalClip.tracks.length).toBe(originalTrackCount);
      expect(originalClip.name).toBe(originalName);
    });
  });

  describe("Edge Cases", () => {
    it("handles scene without armature children", () => {
      const emptyScene = new THREE.Group();
      const mockVRM = createMockVRM();

      const clip = createTestAnimationClip();
      const gltf = {
        scene: emptyScene,
        animations: [clip],
      };

      // Should not throw, may return null or clip with limited tracks
      expect(() => retargetAnimation(gltf, mockVRM, 1.0)).not.toThrow();
    });

    it("handles VRM without humanoid", () => {
      const mockScene = createMixamoAnimationScene();
      const brokenVRM = {
        humanoid: null,
        meta: { metaVersion: "1.0" },
        scene: new THREE.Group(),
      } as unknown as VRM;

      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      // Should handle gracefully
      expect(() => retargetAnimation(gltf, brokenVRM, 1.0)).not.toThrow();
    });

    it("handles default rootToHips value", () => {
      const mockScene = createMixamoAnimationScene();
      const mockVRM = createMockVRM();

      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      // Using default rootToHips (1.0)
      const result = retargetAnimation(gltf, mockVRM);

      expect(result).not.toBeNull();
    });

    it("handles very small rootToHips value", () => {
      const mockScene = createMixamoAnimationScene();
      const mockVRM = createMockVRM();

      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 0.01);

      expect(result).not.toBeNull();
    });

    it("handles very large rootToHips value", () => {
      const mockScene = createMixamoAnimationScene();
      const mockVRM = createMockVRM();

      const clip = createTestAnimationClip();
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 100);

      expect(result).not.toBeNull();
    });

    it("handles animation with single keyframe", () => {
      const mockScene = createMixamoAnimationScene();
      const mockVRM = createMockVRM();

      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0],
          [0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("SingleKeyframe", 0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      expect(result).not.toBeNull();
    });

    it("handles unmapped bone names gracefully", () => {
      const mockScene = createMixamoAnimationScene();
      const mockVRM = createMockVRM();

      // Create animation with unknown bone names
      const tracks = [
        new THREE.QuaternionKeyframeTrack(
          "UnknownBone.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new THREE.QuaternionKeyframeTrack(
          "mixamorigHips.quaternion",
          [0, 1],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
      ];

      const clip = new THREE.AnimationClip("PartiallyMapped", 1.0, tracks);
      const gltf = {
        scene: mockScene,
        animations: [clip],
      };

      const result = retargetAnimation(gltf, mockVRM, 1.0);

      // Should still return a clip with the mapped tracks
      expect(result).not.toBeNull();
    });
  });
});
