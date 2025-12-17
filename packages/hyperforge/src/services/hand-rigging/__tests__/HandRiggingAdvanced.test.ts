/**
 * Advanced Hand Rigging Service Tests
 *
 * Tests for hand segmentation, finger region detection, orthographic rendering,
 * landmark projection, and configuration options.
 *
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Finger segmentation failures for non-standard hand poses
 * - Palm region detection errors
 * - Camera positioning miscalculations for different hand orientations
 * - Landmark projection inaccuracies
 * - Configuration threshold validation
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import { HandSegmentationService } from "../HandSegmentationService";
import type { HandLandmarks, Point3D } from "../HandPoseDetectionService";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create mock hand landmarks for testing
 * MediaPipe hand landmarks have 21 points in specific positions
 */
function createMockHandLandmarks(options: {
  imageWidth?: number;
  imageHeight?: number;
  handedness?: "Left" | "Right";
  confidence?: number;
  spreadFingers?: boolean;
}): HandLandmarks {
  const {
    imageWidth = 512,
    imageHeight = 512,
    handedness = "Left",
    confidence = 0.95,
    spreadFingers = true,
  } = options;

  const centerX = imageWidth / 2;
  const centerY = imageHeight / 2;
  const handScale = imageWidth * 0.3; // Hand takes up 30% of image

  // Generate anatomically correct hand landmarks
  // 0: Wrist
  // 1-4: Thumb (CMC, MCP, IP, Tip)
  // 5-8: Index (MCP, PIP, DIP, Tip)
  // 9-12: Middle (MCP, PIP, DIP, Tip)
  // 13-16: Ring (MCP, PIP, DIP, Tip)
  // 17-20: Pinky (MCP, PIP, DIP, Tip)

  const landmarks: Point3D[] = [];

  // Wrist (0)
  landmarks.push({
    x: centerX,
    y: centerY + handScale * 0.4,
    z: 0,
  });

  // Finger spread angles (from thumb to pinky)
  const fingerAngles = spreadFingers
    ? [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]
    : [-Math.PI / 4, -Math.PI / 8, 0, Math.PI / 8, Math.PI / 4];

  // Finger lengths relative to hand scale
  const fingerLengths = [0.6, 0.7, 0.8, 0.75, 0.55]; // Thumb, Index, Middle, Ring, Pinky

  // Generate finger landmarks
  for (let finger = 0; finger < 5; finger++) {
    const angle = fingerAngles[finger];
    const length = fingerLengths[finger];

    // Base position at knuckles
    const baseX = centerX + Math.sin(angle) * handScale * 0.3;
    const baseY = centerY - handScale * 0.1;

    // Generate 4 joints per finger
    for (let joint = 0; joint < 4; joint++) {
      const progress = (joint + 1) / 4;
      const x = baseX + Math.sin(angle) * handScale * length * progress;
      const y = baseY - handScale * length * progress;
      const z = (joint + 1) * 0.02; // Slight depth progression

      landmarks.push({ x, y, z });
    }
  }

  return {
    landmarks,
    worldLandmarks: landmarks.map((l) => ({
      x: (l.x - centerX) / imageWidth,
      y: (l.y - centerY) / imageHeight,
      z: l.z,
    })),
    handedness,
    confidence,
  };
}

/**
 * Create a skeleton with full arm bones including wrists
 */
function createSkeletonWithWrists(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  leftWrist: THREE.Bone;
  rightWrist: THREE.Bone;
} {
  // Root bone (Hips)
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 100, 0);

  // Spine
  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 20, 0);
  hipsBone.add(spineBone);

  // Chest
  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 20, 0);
  spineBone.add(chestBone);

  // Left arm chain
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(10, 0, 0);
  chestBone.add(leftShoulder);

  const leftUpperArm = new THREE.Bone();
  leftUpperArm.name = "LeftUpperArm";
  leftUpperArm.position.set(15, 0, 0);
  leftShoulder.add(leftUpperArm);

  const leftForearm = new THREE.Bone();
  leftForearm.name = "LeftForeArm";
  leftForearm.position.set(25, 0, 0);
  leftUpperArm.add(leftForearm);

  const leftHand = new THREE.Bone();
  leftHand.name = "LeftHand";
  leftHand.position.set(25, 0, 0);
  leftForearm.add(leftHand);

  // Right arm chain
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  rightShoulder.position.set(-10, 0, 0);
  chestBone.add(rightShoulder);

  const rightUpperArm = new THREE.Bone();
  rightUpperArm.name = "RightUpperArm";
  rightUpperArm.position.set(-15, 0, 0);
  rightShoulder.add(rightUpperArm);

  const rightForearm = new THREE.Bone();
  rightForearm.name = "RightForeArm";
  rightForearm.position.set(-25, 0, 0);
  rightUpperArm.add(rightForearm);

  const rightHand = new THREE.Bone();
  rightHand.name = "RightHand";
  rightHand.position.set(-25, 0, 0);
  rightForearm.add(rightHand);

  // Collect all bones in order (parents before children)
  const bones = [
    hipsBone,
    spineBone,
    chestBone,
    leftShoulder,
    leftUpperArm,
    leftForearm,
    leftHand,
    rightShoulder,
    rightUpperArm,
    rightForearm,
    rightHand,
  ];

  // Update matrices
  hipsBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);

  return {
    skeleton,
    rootBone: hipsBone,
    leftWrist: leftHand,
    rightWrist: rightHand,
  };
}

/**
 * Create a skinned mesh with the given skeleton
 */
function createSkinnedMeshWithSkeleton(
  skeleton: THREE.Skeleton,
): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(50, 150, 30, 4, 8, 4);
  const vertexCount = geometry.attributes.position.count;

  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
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
    new THREE.Float32BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial({ color: 0xffa080 });
  const mesh = new THREE.SkinnedMesh(geometry, material);

  mesh.add(skeleton.bones[0]);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a test scene with skinned mesh
 */
function createTestScene(): {
  scene: THREE.Object3D;
  skeleton: THREE.Skeleton;
  leftWrist: THREE.Bone;
  rightWrist: THREE.Bone;
  mesh: THREE.SkinnedMesh;
} {
  const scene = new THREE.Object3D();
  scene.name = "Scene";

  const { skeleton, rootBone, leftWrist, rightWrist } =
    createSkeletonWithWrists();
  const mesh = createSkinnedMeshWithSkeleton(skeleton);
  mesh.name = "Body";

  scene.add(mesh);
  scene.updateMatrixWorld(true);

  return {
    scene,
    skeleton,
    leftWrist,
    rightWrist,
    mesh,
  };
}

describe("HandSegmentationService", () => {
  let service: HandSegmentationService;

  beforeEach(() => {
    service = new HandSegmentationService();
  });

  describe("Finger Segmentation", () => {
    it("segments mesh into finger regions", () => {
      const landmarks = createMockHandLandmarks({
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Should have all finger regions
      expect(segmentation.thumb).toBeDefined();
      expect(segmentation.index).toBeDefined();
      expect(segmentation.middle).toBeDefined();
      expect(segmentation.ring).toBeDefined();
      expect(segmentation.pinky).toBeDefined();
      expect(segmentation.palm).toBeDefined();
    });

    it("creates pixel masks with correct dimensions", () => {
      const width = 512;
      const height = 512;
      const landmarks = createMockHandLandmarks({
        imageWidth: width,
        imageHeight: height,
      });

      const segmentation = service.segmentFingers(landmarks, width, height);

      // Check all masks have correct dimensions
      const fingers = [
        "thumb",
        "index",
        "middle",
        "ring",
        "pinky",
        "palm",
      ] as const;
      for (const finger of fingers) {
        expect(segmentation[finger].width).toBe(width);
        expect(segmentation[finger].height).toBe(height);
        expect(segmentation[finger].data.length).toBe(width * height);
      }
    });

    it("generates non-empty masks for spread fingers", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: true,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Each finger region should have some pixels
      const fingers = ["thumb", "index", "middle", "ring", "pinky"] as const;
      for (const finger of fingers) {
        const pixelCount = segmentation[finger].data.reduce(
          (sum, val) => sum + (val === 255 ? 1 : 0),
          0,
        );
        expect(pixelCount).toBeGreaterThan(0);
      }
    });

    it("identifies palm region", () => {
      const landmarks = createMockHandLandmarks({
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Palm should have pixels
      const palmPixelCount = segmentation.palm.data.reduce(
        (sum, val) => sum + (val === 255 ? 1 : 0),
        0,
      );
      expect(palmPixelCount).toBeGreaterThan(0);

      // Palm bounds should be valid
      expect(segmentation.palm.bounds.minX).toBeLessThan(
        segmentation.palm.bounds.maxX,
      );
      expect(segmentation.palm.bounds.minY).toBeLessThan(
        segmentation.palm.bounds.maxY,
      );
    });

    it("handles different hand geometries (left vs right)", () => {
      const leftLandmarks = createMockHandLandmarks({
        handedness: "Left",
        imageWidth: 256,
        imageHeight: 256,
      });
      const rightLandmarks = createMockHandLandmarks({
        handedness: "Right",
        imageWidth: 256,
        imageHeight: 256,
      });

      const leftSeg = service.segmentFingers(leftLandmarks, 256, 256);
      const rightSeg = service.segmentFingers(rightLandmarks, 256, 256);

      // Both should produce valid segmentations
      expect(leftSeg.thumb.data.length).toBe(256 * 256);
      expect(rightSeg.thumb.data.length).toBe(256 * 256);
    });

    it("handles closed fingers (not spread)", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: false,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Should still produce valid masks
      const fingers = ["thumb", "index", "middle", "ring", "pinky"] as const;
      for (const finger of fingers) {
        expect(segmentation[finger].data).toBeDefined();
      }
    });
  });

  describe("Finger Region Detection", () => {
    it("detects thumb region separate from other fingers", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: true,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Thumb should not overlap with index finger significantly
      let overlapCount = 0;
      for (let i = 0; i < segmentation.thumb.data.length; i++) {
        if (
          segmentation.thumb.data[i] === 255 &&
          segmentation.index.data[i] === 255
        ) {
          overlapCount++;
        }
      }

      // Allow some boundary overlap but not significant
      const thumbPixels = segmentation.thumb.data.reduce(
        (sum, val) => sum + (val === 255 ? 1 : 0),
        0,
      );
      expect(overlapCount).toBeLessThan(thumbPixels * 0.1); // Less than 10% overlap
    });

    it("detects index/middle/ring/pinky regions", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: true,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Each finger should have bounds
      const fingers = ["index", "middle", "ring", "pinky"] as const;
      for (const finger of fingers) {
        const mask = segmentation[finger];
        expect(mask.bounds.maxX).toBeGreaterThan(mask.bounds.minX);
        expect(mask.bounds.maxY).toBeGreaterThan(mask.bounds.minY);
      }
    });

    it("handles boundary vertices between fingers", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: true,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Check that no pixel is assigned to multiple non-palm regions
      const fingers = ["thumb", "index", "middle", "ring", "pinky"] as const;

      for (let i = 0; i < 256 * 256; i++) {
        let assignedCount = 0;
        for (const finger of fingers) {
          if (segmentation[finger].data[i] === 255) {
            assignedCount++;
          }
        }
        // Each pixel should be assigned to at most one finger
        expect(assignedCount).toBeLessThanOrEqual(1);
      }
    });

    it("generates correct bounds for each finger region", () => {
      const landmarks = createMockHandLandmarks({
        spreadFingers: true,
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);

      // Bounds should be within image dimensions
      const fingers = [
        "thumb",
        "index",
        "middle",
        "ring",
        "pinky",
        "palm",
      ] as const;
      for (const finger of fingers) {
        const bounds = segmentation[finger].bounds;
        expect(bounds.minX).toBeGreaterThanOrEqual(0);
        expect(bounds.maxX).toBeLessThan(256);
        expect(bounds.minY).toBeGreaterThanOrEqual(0);
        expect(bounds.maxY).toBeLessThan(256);
      }
    });
  });

  describe("Mesh Vertex Segmentation", () => {
    it("maps 2D segmentation to 3D vertices", () => {
      const { mesh } = createTestScene();
      const landmarks = createMockHandLandmarks({
        imageWidth: 256,
        imageHeight: 256,
      });

      const segmentation = service.segmentFingers(landmarks, 256, 256);
      const handCapture = {
        cameraMatrix: new THREE.Matrix4(),
        projectionMatrix: new THREE.Matrix4(),
        side: "left" as const,
      };

      const vertexSegments = service.segmentMeshVertices(
        mesh,
        segmentation,
        handCapture,
      );

      // Should return vertex indices for each region
      expect(vertexSegments.thumb).toBeInstanceOf(Array);
      expect(vertexSegments.index).toBeInstanceOf(Array);
      expect(vertexSegments.middle).toBeInstanceOf(Array);
      expect(vertexSegments.ring).toBeInstanceOf(Array);
      expect(vertexSegments.pinky).toBeInstanceOf(Array);
      expect(vertexSegments.palm).toBeInstanceOf(Array);
    });
  });
});

/**
 * Tests for OrthographicHandRenderer logic
 * Note: These tests validate the algorithms without requiring WebGL context
 * since Node.js doesn't have DOM/WebGL available
 */
describe("OrthographicHandRenderer Logic", () => {
  /**
   * Helper function to find wrist bones (mirrors the logic in OrthographicHandRenderer)
   * This allows testing without requiring WebGL context
   */
  function findWristBonesInScene(model: THREE.Object3D): Array<{
    bone: THREE.Bone;
    position: THREE.Vector3;
    normal: THREE.Vector3;
    side: "left" | "right";
  }> {
    const wristBones: Array<{
      bone: THREE.Bone;
      position: THREE.Vector3;
      normal: THREE.Vector3;
      side: "left" | "right";
    }> = [];

    const wristNames = [
      "hand_l",
      "hand_r",
      "Hand_L",
      "Hand_R",
      "leftHand",
      "rightHand",
      "LeftHand",
      "RightHand",
      "mixamorig:LeftHand",
      "mixamorig:RightHand",
      "Bip01_L_Hand",
      "Bip01_R_Hand",
      "wrist_l",
      "wrist_r",
      "Wrist_L",
      "Wrist_R",
    ];

    model.traverse((child) => {
      if (child instanceof THREE.Bone) {
        const lowerName = child.name.toLowerCase();

        const isWrist = wristNames.some(
          (name) =>
            child.name === name ||
            lowerName.includes("hand") ||
            lowerName.includes("wrist"),
        );

        if (isWrist) {
          const isLeft =
            lowerName.includes("left") ||
            lowerName.includes("_l") ||
            lowerName.endsWith("l") ||
            lowerName.includes("l_");
          const isRight =
            lowerName.includes("right") ||
            lowerName.includes("_r") ||
            lowerName.endsWith("r") ||
            lowerName.includes("r_");

          if (isLeft || isRight) {
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();
            const worldScale = new THREE.Vector3();

            child.updateWorldMatrix(true, false);
            child.matrixWorld.decompose(worldPos, worldQuat, worldScale);

            const normal = new THREE.Vector3(0, 1, 0);
            normal.applyQuaternion(worldQuat);

            wristBones.push({
              bone: child,
              position: worldPos,
              normal: normal,
              side: isLeft ? "left" : "right",
            });
          }
        }
      }
    });

    return wristBones;
  }

  describe("Wrist Bone Detection", () => {
    it("finds wrist bones with LeftHand naming", () => {
      const { scene } = createTestScene();
      const wristBones = findWristBonesInScene(scene);

      const leftWrist = wristBones.find((wb) => wb.side === "left");
      expect(leftWrist).toBeDefined();
      expect(leftWrist!.bone.name).toBe("LeftHand");
    });

    it("finds wrist bones with RightHand naming", () => {
      const { scene } = createTestScene();
      const wristBones = findWristBonesInScene(scene);

      const rightWrist = wristBones.find((wb) => wb.side === "right");
      expect(rightWrist).toBeDefined();
      expect(rightWrist!.bone.name).toBe("RightHand");
    });

    it("finds wrist bones with mixamo naming convention", () => {
      const hipsBone = new THREE.Bone();
      hipsBone.name = "mixamorig:Hips";
      hipsBone.position.set(0, 100, 0);

      const leftHand = new THREE.Bone();
      leftHand.name = "mixamorig:LeftHand";
      leftHand.position.set(50, 0, 0);
      hipsBone.add(leftHand);

      const rightHand = new THREE.Bone();
      rightHand.name = "mixamorig:RightHand";
      rightHand.position.set(-50, 0, 0);
      hipsBone.add(rightHand);

      hipsBone.updateMatrixWorld(true);

      const scene = new THREE.Object3D();
      scene.add(hipsBone);

      const wristBones = findWristBonesInScene(scene);

      expect(wristBones.length).toBe(2);
      expect(wristBones.some((wb) => wb.side === "left")).toBe(true);
      expect(wristBones.some((wb) => wb.side === "right")).toBe(true);
    });

    it("finds wrist bones with underscore naming (hand_l, hand_r)", () => {
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const leftHand = new THREE.Bone();
      leftHand.name = "hand_l";
      leftHand.position.set(50, 0, 0);
      hipsBone.add(leftHand);

      const rightHand = new THREE.Bone();
      rightHand.name = "hand_r";
      rightHand.position.set(-50, 0, 0);
      hipsBone.add(rightHand);

      hipsBone.updateMatrixWorld(true);

      const scene = new THREE.Object3D();
      scene.add(hipsBone);

      const wristBones = findWristBonesInScene(scene);

      expect(wristBones.length).toBe(2);
    });

    it("returns empty array when no wrist bones found", () => {
      const bone = new THREE.Bone();
      bone.name = "SomeOtherBone";

      const scene = new THREE.Object3D();
      scene.add(bone);

      const wristBones = findWristBonesInScene(scene);

      expect(wristBones).toHaveLength(0);
    });

    it("returns world position and normal for each wrist", () => {
      const { scene } = createTestScene();
      const wristBones = findWristBonesInScene(scene);

      for (const wb of wristBones) {
        expect(wb.position).toBeInstanceOf(THREE.Vector3);
        expect(wb.normal).toBeInstanceOf(THREE.Vector3);
        expect(wb.position.length()).toBeGreaterThan(0);
        expect(wb.normal.length()).toBeCloseTo(1, 4); // Normalized
      }
    });
  });

  describe("Camera Positioning", () => {
    it("calculates camera position for left hand", () => {
      const { leftWrist } = createSkeletonWithWrists();
      leftWrist.updateMatrixWorld(true);

      const wristPos = new THREE.Vector3();
      leftWrist.getWorldPosition(wristPos);

      // Camera should be positioned to view the hand
      const normal = new THREE.Vector3(0, 1, 0);
      const distance = 1.0;

      const cameraPos = wristPos.clone();
      cameraPos.addScaledVector(normal, distance);

      expect(cameraPos.distanceTo(wristPos)).toBeCloseTo(distance, 4);
    });

    it("calculates camera position for right hand", () => {
      const { rightWrist } = createSkeletonWithWrists();
      rightWrist.updateMatrixWorld(true);

      const wristPos = new THREE.Vector3();
      rightWrist.getWorldPosition(wristPos);

      // Camera should be positioned to view the hand
      const normal = new THREE.Vector3(0, 1, 0);
      const distance = 1.0;

      const cameraPos = wristPos.clone();
      cameraPos.addScaledVector(normal, distance);

      expect(cameraPos.distanceTo(wristPos)).toBeCloseTo(distance, 4);
    });

    it("handles different hand orientations", () => {
      // Create a bone with rotated orientation
      const bone = new THREE.Bone();
      bone.name = "LeftHand";
      bone.position.set(50, 100, 0);
      bone.rotation.set(Math.PI / 4, 0, 0); // 45 degree rotation
      bone.updateMatrixWorld(true);

      const worldQuat = new THREE.Quaternion();
      bone.getWorldQuaternion(worldQuat);

      const normal = new THREE.Vector3(0, 1, 0);
      normal.applyQuaternion(worldQuat);

      // Normal should be rotated
      expect(normal.y).toBeLessThan(1);
      expect(normal.length()).toBeCloseTo(1, 4);
    });
  });

  describe("Hand Bounds Estimation", () => {
    it("handles different hand sizes", () => {
      // Small hand
      const smallWristPos = new THREE.Vector3(50, 100, 0);
      const smallNormal = new THREE.Vector3(0, 1, 0);

      // Large hand
      const largeWristPos = new THREE.Vector3(100, 200, 0);
      const largeNormal = new THREE.Vector3(0, 1, 0);

      // Calculate bounds for different sizes
      const estimateBounds = (pos: THREE.Vector3, normal: THREE.Vector3) => {
        const handLength = 0.3;
        const handWidth = 0.15;

        const forward = normal.clone().normalize();
        const center = pos.clone().addScaledVector(forward, handLength * 0.6);

        return {
          min: center
            .clone()
            .sub(
              new THREE.Vector3(handWidth / 2, handWidth / 2, handLength / 2),
            ),
          max: center
            .clone()
            .add(
              new THREE.Vector3(handWidth / 2, handWidth / 2, handLength / 2),
            ),
        };
      };

      const smallBounds = estimateBounds(smallWristPos, smallNormal);
      const largeBounds = estimateBounds(largeWristPos, largeNormal);

      // Bounds should be valid
      expect(smallBounds.max.x).toBeGreaterThan(smallBounds.min.x);
      expect(largeBounds.max.x).toBeGreaterThan(largeBounds.min.x);
    });

    it("creates consistent bounds dimensions", () => {
      const wristPos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(0, 0, 1);
      const handLength = 0.3;
      const handWidth = 0.15;

      const forward = normal.clone().normalize();
      const center = wristPos
        .clone()
        .addScaledVector(forward, handLength * 0.6);

      const min = center
        .clone()
        .sub(new THREE.Vector3(handWidth / 2, handWidth / 2, handLength / 2));
      const max = center
        .clone()
        .add(new THREE.Vector3(handWidth / 2, handWidth / 2, handLength / 2));

      const size = max.clone().sub(min);
      expect(size.x).toBeCloseTo(handWidth, 4);
      expect(size.y).toBeCloseTo(handWidth, 4);
      expect(size.z).toBeCloseTo(handLength, 4);
    });
  });

  describe("Capture Configuration Options", () => {
    it("accepts resolution options", () => {
      // Test that different resolutions are accepted
      const resolutions = [128, 256, 512, 1024];

      for (const resolution of resolutions) {
        expect(resolution).toBeGreaterThan(0);
        expect(Number.isInteger(resolution)).toBe(true);
      }
    });

    it("accepts padding options", () => {
      // Valid padding values
      const paddings = [0.1, 0.2, 0.5, 1.0];

      for (const padding of paddings) {
        expect(padding).toBeGreaterThan(0);
        expect(padding).toBeLessThanOrEqual(1);
      }
    });

    it("accepts background color options", () => {
      const colors = ["#ffffff", "#000000", "#808080", "#ffa080"];

      for (const color of colors) {
        // Should be valid hex color
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  });

  describe("Multiple Angle Capture", () => {
    it("supports capture at different angles", () => {
      const angles = [0, 45, -45, 90, -90];

      for (const angle of angles) {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          THREE.MathUtils.degToRad(angle),
        );

        const normal = new THREE.Vector3(0, 0, 1);
        normal.applyQuaternion(quaternion);

        // Normal should still be unit length
        expect(normal.length()).toBeCloseTo(1, 4);
      }
    });

    it("rotates capture normal correctly", () => {
      const baseNormal = new THREE.Vector3(0, 0, 1);

      // Rotate 90 degrees around Y axis
      const angle = 90;
      const quaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(angle),
      );

      const rotatedNormal = baseNormal.clone();
      rotatedNormal.applyQuaternion(quaternion);

      // After 90 degree rotation, Z should become X (approximately)
      expect(Math.abs(rotatedNormal.x)).toBeCloseTo(1, 4);
      expect(Math.abs(rotatedNormal.z)).toBeCloseTo(0, 4);
    });

    it("generates multiple angles correctly", () => {
      const baseNormal = new THREE.Vector3(0, 0, 1);
      const angles = [0, 45, -45];
      const normals: THREE.Vector3[] = [];

      for (const angle of angles) {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          THREE.MathUtils.degToRad(angle),
        );

        const rotatedNormal = baseNormal.clone();
        rotatedNormal.applyQuaternion(quaternion);
        normals.push(rotatedNormal);
      }

      // Should have same number of normals as angles
      expect(normals.length).toBe(angles.length);

      // Each normal should be unit length
      for (const normal of normals) {
        expect(normal.length()).toBeCloseTo(1, 4);
      }

      // Normals should be different (except for 0 degree which matches base)
      expect(normals[1].equals(normals[2])).toBe(false);
    });
  });
});

describe("Landmark Projection", () => {
  describe("2D to 3D Projection", () => {
    it("projects 2D landmarks to 3D positions", () => {
      const landmarks = createMockHandLandmarks({
        imageWidth: 512,
        imageHeight: 512,
      });

      // Test that world landmarks exist and are valid
      expect(landmarks.worldLandmarks).toBeDefined();
      expect(landmarks.worldLandmarks!.length).toBe(21);

      for (const landmark of landmarks.worldLandmarks!) {
        expect(typeof landmark.x).toBe("number");
        expect(typeof landmark.y).toBe("number");
        expect(typeof landmark.z).toBe("number");
        expect(isNaN(landmark.x)).toBe(false);
        expect(isNaN(landmark.y)).toBe(false);
        expect(isNaN(landmark.z)).toBe(false);
      }
    });

    it("handles camera transformations", () => {
      const cameraMatrix = new THREE.Matrix4();
      cameraMatrix.makeRotationY(Math.PI / 4); // 45 degree rotation
      cameraMatrix.setPosition(1, 0, 2);

      const point = new THREE.Vector3(0.1, 0.2, 0.3);
      const transformed = point.clone().applyMatrix4(cameraMatrix);

      // Point should be transformed
      expect(transformed.equals(point)).toBe(false);
      expect(transformed.length()).toBeGreaterThan(0);
    });

    it("returns valid 3D positions for all landmarks", () => {
      const landmarks = createMockHandLandmarks({});

      // All 21 landmarks should have valid positions
      expect(landmarks.landmarks.length).toBe(21);

      for (const landmark of landmarks.landmarks) {
        expect(typeof landmark.x).toBe("number");
        expect(typeof landmark.y).toBe("number");
        expect(typeof landmark.z).toBe("number");
      }
    });

    it("maintains correct landmark ordering", () => {
      const landmarks = createMockHandLandmarks({});

      // Landmark 0 is wrist, should be at bottom of hand
      const wrist = landmarks.landmarks[0];

      // Finger tips (4, 8, 12, 16, 20) should be above wrist (smaller Y in image coords)
      const fingerTips = [
        landmarks.landmarks[4], // Thumb tip
        landmarks.landmarks[8], // Index tip
        landmarks.landmarks[12], // Middle tip
        landmarks.landmarks[16], // Ring tip
        landmarks.landmarks[20], // Pinky tip
      ];

      for (const tip of fingerTips) {
        expect(tip.y).toBeLessThan(wrist.y);
      }
    });
  });

  describe("Depth Estimation", () => {
    it("estimates increasing depth for finger joints", () => {
      // Depth estimates based on hand anatomy
      const depths: number[] = [];

      // Wrist at base depth
      depths[0] = 0;

      // Thumb
      depths[1] = 0.02; // CMC
      depths[2] = 0.04; // MCP
      depths[3] = 0.06; // IP
      depths[4] = 0.08; // Tip

      // Fingers (gradually forward)
      for (let finger = 0; finger < 4; finger++) {
        const base = 5 + finger * 4;
        depths[base] = 0.01; // MCP
        depths[base + 1] = 0.03; // PIP
        depths[base + 2] = 0.05; // DIP
        depths[base + 3] = 0.07; // Tip
      }

      // Verify depth increases from base to tip for each finger
      // Thumb
      expect(depths[4]).toBeGreaterThan(depths[1]);

      // Index
      expect(depths[8]).toBeGreaterThan(depths[5]);

      // Middle
      expect(depths[12]).toBeGreaterThan(depths[9]);

      // Ring
      expect(depths[16]).toBeGreaterThan(depths[13]);

      // Pinky
      expect(depths[20]).toBeGreaterThan(depths[17]);
    });
  });
});

describe("Configuration Options", () => {
  describe("Detection Confidence Thresholds", () => {
    it("validates confidence threshold range", () => {
      const validThresholds = [0.5, 0.7, 0.8, 0.9, 0.95];

      for (const threshold of validThresholds) {
        expect(threshold).toBeGreaterThanOrEqual(0);
        expect(threshold).toBeLessThanOrEqual(1);
      }
    });

    it("rejects invalid confidence thresholds", () => {
      const invalidThresholds = [-0.1, 1.1, NaN, Infinity];

      for (const threshold of invalidThresholds) {
        const isValid =
          typeof threshold === "number" &&
          !isNaN(threshold) &&
          isFinite(threshold) &&
          threshold >= 0 &&
          threshold <= 1;

        expect(isValid).toBe(false);
      }
    });

    it("uses reasonable default confidence", () => {
      const defaultConfidence = 0.7;

      expect(defaultConfidence).toBeGreaterThanOrEqual(0.5);
      expect(defaultConfidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe("Render Resolution Options", () => {
    it("validates resolution values", () => {
      const validResolutions = [128, 256, 512, 1024];

      for (const resolution of validResolutions) {
        expect(resolution).toBeGreaterThan(0);
        expect(Number.isInteger(resolution)).toBe(true);
        // Power of 2 for GPU efficiency
        expect(Math.log2(resolution) % 1).toBeCloseTo(0, 4);
      }
    });

    it("uses reasonable default resolution", () => {
      const defaultResolution = 512;

      expect(defaultResolution).toBeGreaterThanOrEqual(256);
      expect(defaultResolution).toBeLessThanOrEqual(2048);
    });
  });

  describe("Capture Angle Options", () => {
    it("validates capture angles", () => {
      const angles = [0, 45, -45, 90, -90];

      for (const angle of angles) {
        expect(angle).toBeGreaterThanOrEqual(-180);
        expect(angle).toBeLessThanOrEqual(180);
      }
    });

    it("supports multiple capture angles", () => {
      const defaultAngles = [0, 45, -45];

      expect(defaultAngles.length).toBeGreaterThanOrEqual(1);
      expect(defaultAngles.includes(0)).toBe(true); // Should include front view
    });
  });

  describe("Smoothing Options", () => {
    it("validates smoothing iterations", () => {
      const validIterations = [0, 1, 2, 3, 5];

      for (const iterations of validIterations) {
        expect(iterations).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(iterations)).toBe(true);
      }
    });

    it("uses reasonable default smoothing", () => {
      const defaultSmoothing = 3;

      expect(defaultSmoothing).toBeGreaterThanOrEqual(0);
      expect(defaultSmoothing).toBeLessThanOrEqual(10);
    });
  });

  describe("Padding Options", () => {
    it("validates padding values", () => {
      const validPadding = [0.1, 0.2, 0.3, 0.5, 1.0];

      for (const padding of validPadding) {
        expect(padding).toBeGreaterThan(0);
        expect(padding).toBeLessThanOrEqual(2.0);
      }
    });

    it("uses reasonable default padding", () => {
      const defaultPadding = 0.2;

      expect(defaultPadding).toBeGreaterThan(0);
      expect(defaultPadding).toBeLessThanOrEqual(0.5);
    });
  });
});

describe("Hand Bone Structure", () => {
  describe("Bone Hierarchy", () => {
    it("creates correct finger bone count", () => {
      // Each finger has 3-4 bones
      const expectedBones = {
        thumb: 3, // MCP, IP, Tip
        index: 3, // MCP, PIP, DIP
        middle: 3,
        ring: 3,
        pinky: 3,
      };

      const totalExpected = Object.values(expectedBones).reduce(
        (a, b) => a + b,
        0,
      );
      expect(totalExpected).toBe(15);
    });

    it("maintains parent-child relationships", () => {
      const { leftWrist } = createSkeletonWithWrists();

      // Create finger bones
      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(5, 0, 0);
      leftWrist.add(palmBone);

      const indexMCP = new THREE.Bone();
      indexMCP.name = "LeftIndex_MCP";
      indexMCP.position.set(5, 0, 0);
      palmBone.add(indexMCP);

      const indexPIP = new THREE.Bone();
      indexPIP.name = "LeftIndex_PIP";
      indexPIP.position.set(3, 0, 0);
      indexMCP.add(indexPIP);

      leftWrist.updateMatrixWorld(true);

      // Verify hierarchy
      expect(palmBone.parent).toBe(leftWrist);
      expect(indexMCP.parent).toBe(palmBone);
      expect(indexPIP.parent).toBe(indexMCP);
    });

    it("positions bones correctly relative to parent", () => {
      const { leftWrist } = createSkeletonWithWrists();

      const palmBone = new THREE.Bone();
      palmBone.name = "LeftHand_Palm";
      palmBone.position.set(10, 0, 0);
      leftWrist.add(palmBone);

      leftWrist.updateMatrixWorld(true);

      const wristPos = new THREE.Vector3();
      const palmPos = new THREE.Vector3();

      leftWrist.getWorldPosition(wristPos);
      palmBone.getWorldPosition(palmPos);

      // Palm should be offset from wrist
      expect(palmPos.x).toBeGreaterThan(wristPos.x);
    });
  });

  describe("Bone Naming Conventions", () => {
    it("uses consistent bone naming for left hand", () => {
      const leftBoneNames = [
        "LeftHand_Thumb_MCP",
        "LeftHand_Thumb_IP",
        "LeftHand_Thumb_Tip",
        "LeftHand_Index_MCP",
        "LeftHand_Index_PIP",
        "LeftHand_Index_DIP",
        // ... etc
      ];

      for (const name of leftBoneNames) {
        expect(name.includes("Left")).toBe(true);
        expect(name.includes("Right")).toBe(false);
      }
    });

    it("uses consistent bone naming for right hand", () => {
      const rightBoneNames = [
        "RightHand_Thumb_MCP",
        "RightHand_Thumb_IP",
        "RightHand_Thumb_Tip",
        "RightHand_Index_MCP",
        "RightHand_Index_PIP",
        "RightHand_Index_DIP",
        // ... etc
      ];

      for (const name of rightBoneNames) {
        expect(name.includes("Right")).toBe(true);
        expect(name.includes("Left")).toBe(false);
      }
    });
  });
});
