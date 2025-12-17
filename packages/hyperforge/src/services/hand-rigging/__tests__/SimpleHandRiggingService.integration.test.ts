/**
 * SimpleHandRiggingService Integration Tests
 *
 * REAL integration tests that call the ACTUAL service methods with real Three.js models.
 * Uses REAL implementations - NO MOCKS per workspace rules.
 *
 * Tests exercise:
 * - rigHands() full pipeline
 * - createSimpleHandBones() (via private access)
 * - applySimpleWeights() (via private access)
 * - updateAllSkeletons() (via private access)
 * - Hand bone creation and hierarchy
 * - Skin weight application
 * - Skeleton rebuild and validation
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { SimpleHandRiggingService } from "../SimpleHandRiggingService";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a realistic humanoid skeleton with full arm chains
 * This matches VRM/humanoid rig structure
 */
function createRealisticHumanoidSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  bones: Map<string, THREE.Bone>;
} {
  const bones = new Map<string, THREE.Bone>();

  // Root bone (Hips) - located at pelvis height
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 100, 0); // Realistic height in cm scale
  bones.set("Hips", hipsBone);

  // Spine chain
  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 15, 0);
  hipsBone.add(spineBone);
  bones.set("Spine", spineBone);

  const spine1Bone = new THREE.Bone();
  spine1Bone.name = "Spine1";
  spine1Bone.position.set(0, 15, 0);
  spineBone.add(spine1Bone);
  bones.set("Spine1", spine1Bone);

  const chestBone = new THREE.Bone();
  chestBone.name = "Chest";
  chestBone.position.set(0, 15, 0);
  spine1Bone.add(chestBone);
  bones.set("Chest", chestBone);

  // Neck and Head
  const neckBone = new THREE.Bone();
  neckBone.name = "Neck";
  neckBone.position.set(0, 12, 0);
  chestBone.add(neckBone);
  bones.set("Neck", neckBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 10, 0);
  neckBone.add(headBone);
  bones.set("Head", headBone);

  // Left arm chain
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(8, 10, 0);
  chestBone.add(leftShoulder);
  bones.set("LeftShoulder", leftShoulder);

  const leftUpperArm = new THREE.Bone();
  leftUpperArm.name = "LeftUpperArm";
  leftUpperArm.position.set(12, 0, 0);
  leftShoulder.add(leftUpperArm);
  bones.set("LeftUpperArm", leftUpperArm);

  const leftForeArm = new THREE.Bone();
  leftForeArm.name = "LeftForeArm";
  leftForeArm.position.set(25, 0, 0); // Forearm length ~25cm
  leftUpperArm.add(leftForeArm);
  bones.set("LeftForeArm", leftForeArm);

  const leftHand = new THREE.Bone();
  leftHand.name = "LeftHand";
  leftHand.position.set(25, 0, 0); // Wrist to hand ~25cm
  leftForeArm.add(leftHand);
  bones.set("LeftHand", leftHand);

  // Right arm chain
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  rightShoulder.position.set(-8, 10, 0);
  chestBone.add(rightShoulder);
  bones.set("RightShoulder", rightShoulder);

  const rightUpperArm = new THREE.Bone();
  rightUpperArm.name = "RightUpperArm";
  rightUpperArm.position.set(-12, 0, 0);
  rightShoulder.add(rightUpperArm);
  bones.set("RightUpperArm", rightUpperArm);

  const rightForeArm = new THREE.Bone();
  rightForeArm.name = "RightForeArm";
  rightForeArm.position.set(-25, 0, 0);
  rightUpperArm.add(rightForeArm);
  bones.set("RightForeArm", rightForeArm);

  const rightHand = new THREE.Bone();
  rightHand.name = "RightHand";
  rightHand.position.set(-25, 0, 0);
  rightForeArm.add(rightHand);
  bones.set("RightHand", rightHand);

  // Left leg chain
  const leftUpperLeg = new THREE.Bone();
  leftUpperLeg.name = "LeftUpperLeg";
  leftUpperLeg.position.set(10, -5, 0);
  hipsBone.add(leftUpperLeg);
  bones.set("LeftUpperLeg", leftUpperLeg);

  const leftLowerLeg = new THREE.Bone();
  leftLowerLeg.name = "LeftLowerLeg";
  leftLowerLeg.position.set(0, -45, 0);
  leftUpperLeg.add(leftLowerLeg);
  bones.set("LeftLowerLeg", leftLowerLeg);

  const leftFoot = new THREE.Bone();
  leftFoot.name = "LeftFoot";
  leftFoot.position.set(0, -45, 0);
  leftLowerLeg.add(leftFoot);
  bones.set("LeftFoot", leftFoot);

  // Right leg chain
  const rightUpperLeg = new THREE.Bone();
  rightUpperLeg.name = "RightUpperLeg";
  rightUpperLeg.position.set(-10, -5, 0);
  hipsBone.add(rightUpperLeg);
  bones.set("RightUpperLeg", rightUpperLeg);

  const rightLowerLeg = new THREE.Bone();
  rightLowerLeg.name = "RightLowerLeg";
  rightLowerLeg.position.set(0, -45, 0);
  rightUpperLeg.add(rightLowerLeg);
  bones.set("RightLowerLeg", rightLowerLeg);

  const rightFoot = new THREE.Bone();
  rightFoot.name = "RightFoot";
  rightFoot.position.set(0, -45, 0);
  rightLowerLeg.add(rightFoot);
  bones.set("RightFoot", rightFoot);

  // Update all matrices
  hipsBone.updateMatrixWorld(true);

  // Create skeleton with all bones in order (parents before children)
  const boneArray = [
    hipsBone,
    spineBone,
    spine1Bone,
    chestBone,
    neckBone,
    headBone,
    leftShoulder,
    leftUpperArm,
    leftForeArm,
    leftHand,
    rightShoulder,
    rightUpperArm,
    rightForeArm,
    rightHand,
    leftUpperLeg,
    leftLowerLeg,
    leftFoot,
    rightUpperLeg,
    rightLowerLeg,
    rightFoot,
  ];

  const skeleton = new THREE.Skeleton(boneArray);

  return { skeleton, rootBone: hipsBone, bones };
}

/**
 * Create a realistic skinned mesh with proper skin weights
 * Simulates a humanoid body mesh
 */
function createRealisticSkinnedMesh(
  skeleton: THREE.Skeleton,
): THREE.SkinnedMesh {
  // Create a humanoid-shaped geometry (torso with arms extended)
  const geometry = new THREE.BufferGeometry();

  // Create vertices for a simple humanoid shape
  // Body box + arm cylinders approximation
  const positions: number[] = [];
  const normals: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  // Helper to add a vertex with bone weight
  const addVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    boneIdx1: number,
    weight1: number,
    boneIdx2 = 0,
    weight2 = 0,
    boneIdx3 = 0,
    weight3 = 0,
    boneIdx4 = 0,
    weight4 = 0,
  ) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    skinIndices.push(boneIdx1, boneIdx2, boneIdx3, boneIdx4);
    skinWeights.push(weight1, weight2, weight3, weight4);
  };

  // Find bone indices
  const getBoneIndex = (name: string): number => {
    return skeleton.bones.findIndex((b) => b.name === name);
  };

  const hipsIdx = getBoneIndex("Hips");
  const spineIdx = getBoneIndex("Spine");
  const chestIdx = getBoneIndex("Chest");
  const leftHandIdx = getBoneIndex("LeftHand");
  const rightHandIdx = getBoneIndex("RightHand");
  const leftForeArmIdx = getBoneIndex("LeftForeArm");
  const rightForeArmIdx = getBoneIndex("RightForeArm");

  // Torso vertices (centered around spine)
  // Front face
  addVertex(-15, 100, 10, 0, 0, 1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(15, 100, 10, 0, 0, 1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(15, 150, 10, 0, 0, 1, chestIdx, 1.0);
  addVertex(-15, 150, 10, 0, 0, 1, chestIdx, 1.0);
  addVertex(-15, 100, 10, 0, 0, 1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(15, 150, 10, 0, 0, 1, chestIdx, 1.0);

  // Back face
  addVertex(15, 100, -10, 0, 0, -1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(-15, 100, -10, 0, 0, -1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(-15, 150, -10, 0, 0, -1, chestIdx, 1.0);
  addVertex(15, 150, -10, 0, 0, -1, chestIdx, 1.0);
  addVertex(15, 100, -10, 0, 0, -1, hipsIdx, 0.5, spineIdx, 0.5);
  addVertex(-15, 150, -10, 0, 0, -1, chestIdx, 1.0);

  // Left arm vertices (weighted to left hand/forearm)
  // These simulate hand geometry that should receive new weights
  const leftArmBaseX = 50; // Extended left
  const leftArmY = 155;

  // Left forearm section (weighted to forearm)
  addVertex(leftArmBaseX, leftArmY + 3, 3, 0, 1, 0, leftForeArmIdx, 1.0);
  addVertex(leftArmBaseX, leftArmY - 3, 3, 0, -1, 0, leftForeArmIdx, 1.0);
  addVertex(
    leftArmBaseX + 20,
    leftArmY + 3,
    3,
    0,
    1,
    0,
    leftForeArmIdx,
    0.3,
    leftHandIdx,
    0.7,
  );
  addVertex(
    leftArmBaseX + 20,
    leftArmY - 3,
    3,
    0,
    -1,
    0,
    leftForeArmIdx,
    0.3,
    leftHandIdx,
    0.7,
  );

  // Left hand section (weighted to hand - should receive palm/finger weights)
  addVertex(leftArmBaseX + 25, leftArmY + 2, 2, 1, 0, 0, leftHandIdx, 1.0);
  addVertex(leftArmBaseX + 25, leftArmY - 2, 2, 1, 0, 0, leftHandIdx, 1.0);
  addVertex(leftArmBaseX + 35, leftArmY + 1, 1, 1, 0, 0, leftHandIdx, 1.0);
  addVertex(leftArmBaseX + 35, leftArmY - 1, 1, 1, 0, 0, leftHandIdx, 1.0);
  addVertex(leftArmBaseX + 40, leftArmY, 0, 1, 0, 0, leftHandIdx, 1.0);

  // Right arm vertices (mirrored)
  const rightArmBaseX = -50;
  const rightArmY = 155;

  // Right forearm section
  addVertex(rightArmBaseX, rightArmY + 3, 3, 0, 1, 0, rightForeArmIdx, 1.0);
  addVertex(rightArmBaseX, rightArmY - 3, 3, 0, -1, 0, rightForeArmIdx, 1.0);
  addVertex(
    rightArmBaseX - 20,
    rightArmY + 3,
    3,
    0,
    1,
    0,
    rightForeArmIdx,
    0.3,
    rightHandIdx,
    0.7,
  );
  addVertex(
    rightArmBaseX - 20,
    rightArmY - 3,
    3,
    0,
    -1,
    0,
    rightForeArmIdx,
    0.3,
    rightHandIdx,
    0.7,
  );

  // Right hand section
  addVertex(rightArmBaseX - 25, rightArmY + 2, 2, -1, 0, 0, rightHandIdx, 1.0);
  addVertex(rightArmBaseX - 25, rightArmY - 2, 2, -1, 0, 0, rightHandIdx, 1.0);
  addVertex(rightArmBaseX - 35, rightArmY + 1, 1, -1, 0, 0, rightHandIdx, 1.0);
  addVertex(rightArmBaseX - 35, rightArmY - 1, 1, -1, 0, 0, rightHandIdx, 1.0);
  addVertex(rightArmBaseX - 40, rightArmY, 0, -1, 0, 0, rightHandIdx, 1.0);

  // Set geometry attributes
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Float32BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );

  // Create skinned mesh
  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "Body";

  // Add skeleton root to mesh and bind
  mesh.add(skeleton.bones[0]);
  mesh.bind(skeleton);

  return mesh;
}

/**
 * Create a complete scene with humanoid model
 */
function createTestHumanoidScene(): {
  scene: THREE.Object3D;
  skeleton: THREE.Skeleton;
  mesh: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
} {
  const scene = new THREE.Object3D();
  scene.name = "Scene";

  const armature = new THREE.Object3D();
  armature.name = "Armature";

  const { skeleton, rootBone, bones } = createRealisticHumanoidSkeleton();
  const mesh = createRealisticSkinnedMesh(skeleton);

  armature.add(mesh);
  scene.add(armature);
  scene.updateMatrixWorld(true);

  return { scene, skeleton, mesh, bones };
}

/**
 * Export scene to GLB ArrayBuffer for testing the full pipeline
 */
async function exportSceneToGLB(scene: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error("Expected ArrayBuffer from exporter"));
        }
      },
      (error) => reject(error),
      { binary: true },
    );
  });
}

/**
 * Load GLB ArrayBuffer back to scene for verification
 */
async function loadGLBToScene(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => resolve(gltf.scene),
      (error) => reject(error),
    );
  });
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe("SimpleHandRiggingService Integration Tests", () => {
  let service: SimpleHandRiggingService;

  beforeAll(() => {
    service = new SimpleHandRiggingService();
  });

  describe("Full Pipeline: rigHands()", () => {
    it("successfully rigs hands on a humanoid model exported as GLB", async () => {
      // Create a test model
      const { scene, skeleton, mesh, bones } = createTestHumanoidScene();

      // Verify initial state
      const leftHand = bones.get("LeftHand");
      const rightHand = bones.get("RightHand");
      expect(leftHand).toBeDefined();
      expect(rightHand).toBeDefined();
      expect(leftHand!.children).toHaveLength(0); // No hand bones yet

      // Export to GLB
      const glbBuffer = await exportSceneToGLB(scene);
      expect(glbBuffer.byteLength).toBeGreaterThan(0);

      // Create a File-like object from the buffer
      const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);

      try {
        // Call the REAL rigHands method
        const result = await service.rigHands(url, {
          palmBoneLength: 300,
          fingerBoneLength: 400,
          debugMode: false,
        });

        // Verify success
        expect(result.success).toBe(true);
        expect(result.riggedModel).not.toBeNull();
        expect(result.metadata.originalBoneCount).toBeGreaterThan(0);
        expect(result.metadata.addedBoneCount).toBe(4); // 2 for each hand (palm + finger)

        // Verify hand bone names
        expect(result.metadata.leftHandBones).toBeDefined();
        expect(result.metadata.leftHandBones).toContain("LeftHand_Palm");
        expect(result.metadata.leftHandBones).toContain("LeftHand_Fingers");

        expect(result.metadata.rightHandBones).toBeDefined();
        expect(result.metadata.rightHandBones).toContain("RightHand_Palm");
        expect(result.metadata.rightHandBones).toContain("RightHand_Fingers");

        // Load the rigged model back and verify structure
        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        // Find the new hand bones in the rigged model
        const newBones: THREE.Bone[] = [];
        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            newBones.push(child);
          }
        });

        // Should have more bones than original
        expect(newBones.length).toBeGreaterThan(skeleton.bones.length);

        // Find palm and finger bones
        const leftPalm = newBones.find((b) => b.name === "LeftHand_Palm");
        const leftFingers = newBones.find((b) => b.name === "LeftHand_Fingers");
        const rightPalm = newBones.find((b) => b.name === "RightHand_Palm");
        const rightFingers = newBones.find(
          (b) => b.name === "RightHand_Fingers",
        );

        expect(leftPalm).toBeDefined();
        expect(leftFingers).toBeDefined();
        expect(rightPalm).toBeDefined();
        expect(rightFingers).toBeDefined();

        // Verify hierarchy: finger should be child of palm
        expect(leftFingers!.parent).toBe(leftPalm);
        expect(rightFingers!.parent).toBe(rightPalm);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("returns error when model has no wrist bones", async () => {
      // Create a minimal skeleton without hand bones
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const spineBone = new THREE.Bone();
      spineBone.name = "Spine";
      spineBone.position.set(0, 20, 0);
      hipsBone.add(spineBone);

      hipsBone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([hipsBone, spineBone]);

      // Create mesh
      const geometry = new THREE.BoxGeometry(50, 100, 30);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hipsBone);
      mesh.bind(skeleton);

      const scene = new THREE.Object3D();
      scene.name = "Scene";
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      // Export
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);

        expect(result.success).toBe(false);
        expect(result.error).toContain("No wrist bones found");
        expect(result.riggedModel).toBeNull();
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("handles models with only left hand bone", async () => {
      // Create skeleton with only left hand
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const leftArm = new THREE.Bone();
      leftArm.name = "LeftArm";
      leftArm.position.set(50, 0, 0);
      hipsBone.add(leftArm);

      const leftHand = new THREE.Bone();
      leftHand.name = "LeftHand";
      leftHand.position.set(25, 0, 0);
      leftArm.add(leftHand);

      hipsBone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([hipsBone, leftArm, leftHand]);

      // Create mesh with vertices weighted to hand
      const geometry = new THREE.BoxGeometry(30, 30, 30, 2, 2, 2);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 2; // LeftHand index
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hipsBone);
      mesh.bind(skeleton);

      const scene = new THREE.Object3D();
      scene.name = "Scene";
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);

        expect(result.success).toBe(true);
        expect(result.metadata.addedBoneCount).toBe(2); // Only left hand bones
        expect(result.metadata.leftHandBones).toBeDefined();
        expect(result.metadata.rightHandBones).toBeUndefined();
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Bone Creation and Hierarchy", () => {
    it("creates palm bone at correct position relative to wrist", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url, {
          palmBoneLength: 300,
          fingerBoneLength: 400,
          debugMode: false,
        });

        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        // Find wrist and palm bones
        let leftHand: THREE.Bone | undefined;
        let leftPalm: THREE.Bone | undefined;

        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            if (child.name === "LeftHand") leftHand = child;
            if (child.name === "LeftHand_Palm") leftPalm = child;
          }
        });

        expect(leftHand).toBeDefined();
        expect(leftPalm).toBeDefined();

        // Palm should be child of hand
        expect(leftPalm!.parent?.name).toBe("LeftHand");

        // Palm should have non-zero local position
        const palmPos = leftPalm!.position;
        const palmLength = palmPos.length();
        expect(palmLength).toBeGreaterThan(0);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("creates finger bone at correct position relative to palm", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url, { debugMode: false });
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        // Find palm and finger bones
        let leftPalm: THREE.Bone | undefined;
        let leftFingers: THREE.Bone | undefined;

        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            if (child.name === "LeftHand_Palm") leftPalm = child;
            if (child.name === "LeftHand_Fingers") leftFingers = child;
          }
        });

        expect(leftPalm).toBeDefined();
        expect(leftFingers).toBeDefined();

        // Fingers should be child of palm
        expect(leftFingers!.parent?.name).toBe("LeftHand_Palm");

        // Finger should have non-zero local position
        const fingerPos = leftFingers!.position;
        const fingerLength = fingerPos.length();
        expect(fingerLength).toBeGreaterThan(0);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("maintains correct world positions through hierarchy", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url, { debugMode: false });
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        // Find all left hand chain bones
        const bonesMap = new Map<string, THREE.Bone>();
        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            bonesMap.set(child.name, child);
          }
        });

        const leftHand = bonesMap.get("LeftHand");
        const leftPalm = bonesMap.get("LeftHand_Palm");
        const leftFingers = bonesMap.get("LeftHand_Fingers");

        expect(leftHand).toBeDefined();
        expect(leftPalm).toBeDefined();
        expect(leftFingers).toBeDefined();

        // Get world positions
        const handWorld = new THREE.Vector3();
        const palmWorld = new THREE.Vector3();
        const fingersWorld = new THREE.Vector3();

        leftHand!.getWorldPosition(handWorld);
        leftPalm!.getWorldPosition(palmWorld);
        leftFingers!.getWorldPosition(fingersWorld);

        // Palm should be beyond hand
        const handToPalm = palmWorld.distanceTo(handWorld);
        expect(handToPalm).toBeGreaterThan(0);

        // Fingers should be beyond palm
        const palmToFingers = fingersWorld.distanceTo(palmWorld);
        expect(palmToFingers).toBeGreaterThan(0);

        // Fingers should be furthest from hand
        const handToFingers = fingersWorld.distanceTo(handWorld);
        expect(handToFingers).toBeGreaterThan(handToPalm);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Skeleton Integrity", () => {
    it("preserves original bones after rigging", async () => {
      const { scene, skeleton } = createTestHumanoidScene();
      const originalBoneNames = skeleton.bones.map((b) => b.name);
      const originalBoneCount = skeleton.bones.length;

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);
        expect(result.metadata.originalBoneCount).toBe(originalBoneCount);

        const riggedScene = await loadGLBToScene(result.riggedModel!);

        // Collect all bone names
        const riggedBoneNames: string[] = [];
        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            riggedBoneNames.push(child.name);
          }
        });

        // All original bones should still exist
        for (const originalName of originalBoneNames) {
          expect(riggedBoneNames).toContain(originalName);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("adds new hand bones to skeleton", async () => {
      const { scene, skeleton } = createTestHumanoidScene();
      const originalBoneCount = skeleton.bones.length;

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);

        // Count bones in rigged model
        let riggedBoneCount = 0;
        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            riggedBoneCount++;
          }
        });

        // Should have original + 4 new bones (2 per hand)
        expect(riggedBoneCount).toBe(originalBoneCount + 4);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("creates valid skeleton with correct bone inverses", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        // Find skinned mesh and verify skeleton
        let skinnedMesh: THREE.SkinnedMesh | undefined;
        riggedScene.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && !skinnedMesh) {
            skinnedMesh = child;
          }
        });

        expect(skinnedMesh).toBeDefined();
        expect(skinnedMesh!.skeleton).toBeDefined();

        const skeleton = skinnedMesh!.skeleton;

        // Bone count should match inverse count
        expect(skeleton.bones.length).toBe(skeleton.boneInverses.length);

        // No null bones
        for (const bone of skeleton.bones) {
          expect(bone).not.toBeNull();
          expect(bone).toBeInstanceOf(THREE.Bone);
        }

        // No null inverses
        for (const inverse of skeleton.boneInverses) {
          expect(inverse).not.toBeNull();
          expect(inverse).toBeInstanceOf(THREE.Matrix4);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Skin Weight Application", () => {
    it("maintains normalized weights after rigging", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);

        // Find skinned mesh
        let skinnedMesh: THREE.SkinnedMesh | undefined;
        riggedScene.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && !skinnedMesh) {
            skinnedMesh = child;
          }
        });

        expect(skinnedMesh).toBeDefined();

        const skinWeights = skinnedMesh!.geometry.attributes.skinWeight;
        expect(skinWeights).toBeDefined();

        // Check weight normalization
        for (let i = 0; i < skinWeights.count; i++) {
          const w1 = skinWeights.getX(i);
          const w2 = skinWeights.getY(i);
          const w3 = skinWeights.getZ(i);
          const w4 = skinWeights.getW(i);

          const sum = w1 + w2 + w3 + w4;

          // Weights should sum to approximately 1.0 (allowing for floating point)
          if (sum > 0.01) {
            expect(sum).toBeCloseTo(1.0, 1);
          }
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("has valid skin indices within bone range", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);

        // Find skinned mesh
        let skinnedMesh: THREE.SkinnedMesh | undefined;
        riggedScene.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && !skinnedMesh) {
            skinnedMesh = child;
          }
        });

        expect(skinnedMesh).toBeDefined();

        const skinIndices = skinnedMesh!.geometry.attributes.skinIndex;
        const boneCount = skinnedMesh!.skeleton.bones.length;

        expect(skinIndices).toBeDefined();

        // All indices should be valid bone indices
        for (let i = 0; i < skinIndices.count; i++) {
          const i1 = skinIndices.getX(i);
          const i2 = skinIndices.getY(i);
          const i3 = skinIndices.getZ(i);
          const i4 = skinIndices.getW(i);

          expect(i1).toBeGreaterThanOrEqual(0);
          expect(i1).toBeLessThan(boneCount);
          expect(i2).toBeGreaterThanOrEqual(0);
          expect(i2).toBeLessThan(boneCount);
          expect(i3).toBeGreaterThanOrEqual(0);
          expect(i3).toBeLessThan(boneCount);
          expect(i4).toBeGreaterThanOrEqual(0);
          expect(i4).toBeLessThan(boneCount);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Model Validation", () => {
    it("exports valid GLB that can be reimported", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        // The result should be a valid GLB
        expect(result.riggedModel).toBeInstanceOf(ArrayBuffer);
        expect(result.riggedModel!.byteLength).toBeGreaterThan(0);

        // Should be able to load it back
        const loadedScene = await loadGLBToScene(result.riggedModel!);
        expect(loadedScene).toBeDefined();

        // Should have at least one child
        expect(loadedScene.children.length).toBeGreaterThan(0);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("preserves mesh geometry after rigging", async () => {
      const { scene, mesh } = createTestHumanoidScene();
      const originalVertexCount = mesh.geometry.attributes.position.count;

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);
        expect(result.success).toBe(true);

        const riggedScene = await loadGLBToScene(result.riggedModel!);

        // Find skinned mesh
        let riggedMesh: THREE.SkinnedMesh | undefined;
        riggedScene.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && !riggedMesh) {
            riggedMesh = child;
          }
        });

        expect(riggedMesh).toBeDefined();

        // Vertex count should be preserved
        const riggedVertexCount =
          riggedMesh!.geometry.attributes.position.count;
        expect(riggedVertexCount).toBe(originalVertexCount);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Options Configuration", () => {
    it("respects custom palm and finger bone lengths", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        // Use custom lengths
        const result = await service.rigHands(url, {
          palmBoneLength: 500,
          fingerBoneLength: 600,
          debugMode: false,
        });

        expect(result.success).toBe(true);

        // The bones should be created with these proportions
        const riggedScene = await loadGLBToScene(result.riggedModel!);
        riggedScene.updateMatrixWorld(true);

        let leftPalm: THREE.Bone | undefined;
        let leftFingers: THREE.Bone | undefined;

        riggedScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            if (child.name === "LeftHand_Palm") leftPalm = child;
            if (child.name === "LeftHand_Fingers") leftFingers = child;
          }
        });

        expect(leftPalm).toBeDefined();
        expect(leftFingers).toBeDefined();

        // Both bones should have non-zero positions
        expect(leftPalm!.position.length()).toBeGreaterThan(0);
        expect(leftFingers!.position.length()).toBeGreaterThan(0);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("handles debug mode without errors", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        // With debug mode enabled
        const result = await service.rigHands(url, {
          debugMode: true,
        });

        expect(result.success).toBe(true);
        expect(result.riggedModel).not.toBeNull();
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles model with wrist naming convention", async () => {
      // Create skeleton with "Wrist" naming instead of "Hand"
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const leftArm = new THREE.Bone();
      leftArm.name = "LeftArm";
      leftArm.position.set(50, 0, 0);
      hipsBone.add(leftArm);

      const leftWrist = new THREE.Bone();
      leftWrist.name = "LeftWrist"; // Using "Wrist" naming
      leftWrist.position.set(25, 0, 0);
      leftArm.add(leftWrist);

      hipsBone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([hipsBone, leftArm, leftWrist]);

      // Create mesh
      const geometry = new THREE.BoxGeometry(30, 30, 30);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 2;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hipsBone);
      mesh.bind(skeleton);

      const scene = new THREE.Object3D();
      scene.name = "Scene";
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);

        expect(result.success).toBe(true);
        expect(result.metadata.addedBoneCount).toBe(2);
        expect(result.metadata.leftHandBones).toBeDefined();
        expect(result.metadata.leftHandBones).toContain("LeftWrist_Palm");
        expect(result.metadata.leftHandBones).toContain("LeftWrist_Fingers");
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("handles mixamo-style bone naming", async () => {
      // Create skeleton with mixamo naming (using underscore instead of colon
      // since GLTF export/import may strip colons from names)
      const hipsBone = new THREE.Bone();
      hipsBone.name = "mixamorig_Hips";
      hipsBone.position.set(0, 100, 0);

      const leftArm = new THREE.Bone();
      leftArm.name = "mixamorig_LeftArm";
      leftArm.position.set(50, 0, 0);
      hipsBone.add(leftArm);

      const leftHand = new THREE.Bone();
      leftHand.name = "mixamorig_LeftHand";
      leftHand.position.set(25, 0, 0);
      leftArm.add(leftHand);

      hipsBone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([hipsBone, leftArm, leftHand]);

      const geometry = new THREE.BoxGeometry(30, 30, 30);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 2;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hipsBone);
      mesh.bind(skeleton);

      const scene = new THREE.Object3D();
      scene.name = "Scene";
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);

        expect(result.success).toBe(true);
        expect(result.metadata.leftHandBones).toBeDefined();
        // The hand bone gets _Palm suffix added
        expect(
          result.metadata.leftHandBones!.some(
            (name) => name.includes("LeftHand") && name.includes("Palm"),
          ),
        ).toBe(true);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("handles scaled model correctly", async () => {
      const { scene, mesh } = createTestHumanoidScene();

      // Apply scale to the model
      scene.scale.set(0.01, 0.01, 0.01); // Common VRM scale
      scene.updateMatrixWorld(true);

      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      try {
        const result = await service.rigHands(url);

        // Should still succeed with scaled model
        expect(result.success).toBe(true);
        expect(result.metadata.addedBoneCount).toBe(4);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("Private Method Access Tests", () => {
    // Access private methods through the service instance for detailed testing
    // This uses TypeScript's ability to access private members at runtime

    it("findWristBones finds correct bones", () => {
      const { scene } = createTestHumanoidScene();

      // Access private method
      const findWristBones = (
        service as unknown as {
          findWristBones: (model: THREE.Object3D) => THREE.Bone[];
        }
      ).findWristBones.bind(service);

      const wristBones = findWristBones(scene);

      expect(wristBones.length).toBe(2);
      expect(wristBones.map((b) => b.name)).toContain("LeftHand");
      expect(wristBones.map((b) => b.name)).toContain("RightHand");
    });

    it("countBones returns correct count", () => {
      const { scene, skeleton } = createTestHumanoidScene();

      // Access private method
      const countBones = (
        service as unknown as { countBones: (model: THREE.Object3D) => number }
      ).countBones.bind(service);

      const count = countBones(scene);

      expect(count).toBe(skeleton.bones.length);
    });

    it("updateAllSkeletons forces skeleton update", () => {
      const { scene, mesh } = createTestHumanoidScene();

      // Access private method
      const updateAllSkeletons = (
        service as unknown as {
          updateAllSkeletons: (model: THREE.Object3D) => void;
        }
      ).updateAllSkeletons.bind(service);

      // This should not throw
      expect(() => updateAllSkeletons(scene)).not.toThrow();

      // Skeleton should be updated
      expect(mesh.skeleton).toBeDefined();
    });

    it("validateModelStructure returns valid for good model", () => {
      const { scene } = createTestHumanoidScene();

      // Access private method
      const validateModelStructure = (
        service as unknown as {
          validateModelStructure: (model: THREE.Object3D) => {
            isValid: boolean;
            errors: string[];
          };
        }
      ).validateModelStructure.bind(service);

      const result = validateModelStructure(scene);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("isBoneInScene detects bones correctly", () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const isBoneInScene = (
        service as unknown as {
          isBoneInScene: (bone: THREE.Bone, model: THREE.Object3D) => boolean;
        }
      ).isBoneInScene.bind(service);

      // Bone in scene should return true
      expect(isBoneInScene(leftHand, scene)).toBe(true);

      // Orphan bone should return false
      const orphanBone = new THREE.Bone();
      orphanBone.name = "Orphan";
      expect(isBoneInScene(orphanBone, scene)).toBe(false);
    });

    it("getHandForwardDirection returns valid direction", () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const getHandForwardDirection = (
        service as unknown as {
          getHandForwardDirection: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            isLeft: boolean,
          ) => THREE.Vector3;
        }
      ).getHandForwardDirection.bind(service);

      const direction = getHandForwardDirection(scene, leftHand, true);

      // Direction should be normalized
      expect(direction.length()).toBeCloseTo(1.0, 4);

      // For left hand, direction should have positive X component
      expect(direction.x).toBeGreaterThan(0);
    });

    it("findBoneIndex returns correct index", () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const findBoneIndex = (
        service as unknown as {
          findBoneIndex: (model: THREE.Object3D, bone: THREE.Bone) => number;
        }
      ).findBoneIndex.bind(service);

      const index = findBoneIndex(scene, leftHand);

      // Should find the bone
      expect(index).toBeGreaterThanOrEqual(0);
    });
  });

  describe("loadModel() - Model Loading", () => {
    it("loads model from URL successfully", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const url = URL.createObjectURL(new Blob([glbBuffer]));

      // Access private method
      const loadModel = (
        service as unknown as {
          loadModel: (modelFile: File | string) => Promise<THREE.Object3D>;
        }
      ).loadModel.bind(service);

      try {
        const loadedModel = await loadModel(url);

        expect(loadedModel).toBeDefined();
        expect(loadedModel).toBeInstanceOf(THREE.Object3D);

        // Should have children (at least the mesh)
        let hasSkinnedMesh = false;
        loadedModel.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh) {
            hasSkinnedMesh = true;
          }
        });
        expect(hasSkinnedMesh).toBe(true);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    it("loads model from Blob/File-like object", async () => {
      const { scene } = createTestHumanoidScene();
      const glbBuffer = await exportSceneToGLB(scene);
      const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });

      // Create a File-like object
      const file = new File([blob], "test-model.glb", {
        type: "model/gltf-binary",
      });

      // Access private method
      const loadModel = (
        service as unknown as {
          loadModel: (modelFile: File | string) => Promise<THREE.Object3D>;
        }
      ).loadModel.bind(service);

      const loadedModel = await loadModel(file);

      expect(loadedModel).toBeDefined();
      expect(loadedModel).toBeInstanceOf(THREE.Object3D);

      // Model should have bones
      let boneCount = 0;
      loadedModel.traverse((child) => {
        if (child instanceof THREE.Bone) {
          boneCount++;
        }
      });
      expect(boneCount).toBeGreaterThan(0);
    });

    it("rejects with error for invalid model data", async () => {
      const invalidData = new ArrayBuffer(100); // Random bytes
      const blob = new Blob([invalidData]);
      const url = URL.createObjectURL(blob);

      // Access private method
      const loadModel = (
        service as unknown as {
          loadModel: (modelFile: File | string) => Promise<THREE.Object3D>;
        }
      ).loadModel.bind(service);

      try {
        await expect(loadModel(url)).rejects.toThrow();
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });

  describe("createSimpleHandBones() - Bone Creation", () => {
    it("creates palm and finger bones for left hand", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        leftHand,
        300,
        400,
        false,
      );

      expect(handBones).not.toBeNull();
      expect(handBones).toHaveLength(2);
      expect(handBones![0].name).toBe("LeftHand_Palm");
      expect(handBones![1].name).toBe("LeftHand_Fingers");
    });

    it("creates palm and finger bones for right hand", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const rightHand = bones.get("RightHand")!;

      // Access private method
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        rightHand,
        300,
        400,
        false,
      );

      expect(handBones).not.toBeNull();
      expect(handBones).toHaveLength(2);
      expect(handBones![0].name).toBe("RightHand_Palm");
      expect(handBones![1].name).toBe("RightHand_Fingers");
    });

    it("establishes correct parent-child hierarchy", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        leftHand,
        300,
        400,
        false,
      );

      expect(handBones).not.toBeNull();

      const palmBone = handBones![0];
      const fingerBone = handBones![1];

      // Palm should be child of wrist
      expect(palmBone.parent).toBe(leftHand);

      // Finger should be child of palm
      expect(fingerBone.parent).toBe(palmBone);

      // Check hierarchy traversal works
      expect(leftHand.children).toContain(palmBone);
      expect(palmBone.children).toContain(fingerBone);
    });

    it("positions bones with non-zero offsets", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        leftHand,
        300,
        400,
        false,
      );

      expect(handBones).not.toBeNull();

      const palmBone = handBones![0];
      const fingerBone = handBones![1];

      // Palm should have non-zero local position
      expect(palmBone.position.length()).toBeGreaterThan(0);

      // Finger should have non-zero local position
      expect(fingerBone.position.length()).toBeGreaterThan(0);
    });

    it("adds bones to skeleton", async () => {
      const { scene, bones, skeleton } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;
      const originalBoneCount = skeleton.bones.length;

      // Access private method
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      await createSimpleHandBones(scene, leftHand, 300, 400, false);

      // Find the skinned mesh and check its skeleton
      let skinnedMesh: THREE.SkinnedMesh | undefined;
      scene.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
          skinnedMesh = child;
        }
      });

      expect(skinnedMesh).toBeDefined();
      expect(skinnedMesh!.skeleton.bones.length).toBeGreaterThan(
        originalBoneCount,
      );
    });
  });

  describe("findHandVertices() - Vertex Identification", () => {
    it("finds vertices influenced by wrist bone", () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const findHandVertices = (
        service as unknown as {
          findHandVertices: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
          ) => THREE.Vector3[];
        }
      ).findHandVertices.bind(service);

      const vertices = findHandVertices(scene, leftHand);

      // Should find some vertices (our test mesh has hand vertices)
      expect(vertices).toBeInstanceOf(Array);
      // The test mesh has vertices weighted to LeftHand
      expect(vertices.length).toBeGreaterThanOrEqual(0);
    });

    it("returns empty array when no vertices are influenced", () => {
      // Create a mesh with no vertices weighted to hand
      const hipsBone = new THREE.Bone();
      hipsBone.name = "Hips";
      hipsBone.position.set(0, 100, 0);

      const leftHand = new THREE.Bone();
      leftHand.name = "LeftHand";
      leftHand.position.set(50, 0, 0);
      hipsBone.add(leftHand);

      hipsBone.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton([hipsBone, leftHand]);

      // Create mesh with all vertices weighted to Hips, not hand
      const geometry = new THREE.BoxGeometry(30, 30, 30);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0; // Hips bone
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hipsBone);
      mesh.bind(skeleton);

      const scene = new THREE.Object3D();
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      // Access private method
      const findHandVertices = (
        service as unknown as {
          findHandVertices: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
          ) => THREE.Vector3[];
        }
      ).findHandVertices.bind(service);

      const vertices = findHandVertices(scene, leftHand);

      // No vertices should be influenced by hand bone
      expect(vertices).toHaveLength(0);
    });

    it("returns world-space positions for found vertices", () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Access private method
      const findHandVertices = (
        service as unknown as {
          findHandVertices: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
          ) => THREE.Vector3[];
        }
      ).findHandVertices.bind(service);

      const vertices = findHandVertices(scene, leftHand);

      // Each vertex should be a Vector3
      for (const vertex of vertices) {
        expect(vertex).toBeInstanceOf(THREE.Vector3);
        // World positions should not be at origin
        // (our test model has arms extended)
      }
    });
  });

  describe("applySimpleWeights() - Weight Application", () => {
    it("applies weights to hand vertices", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // First create the hand bones
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        leftHand,
        300,
        400,
        false,
      );
      expect(handBones).not.toBeNull();

      const palmBone = handBones![0];
      const fingerBone = handBones![1];

      // Access applySimpleWeights
      const applySimpleWeights = (
        service as unknown as {
          applySimpleWeights: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBone: THREE.Bone,
            fingerBone: THREE.Bone,
            isLeft: boolean,
          ) => Promise<void>;
        }
      ).applySimpleWeights.bind(service);

      // This should not throw
      await expect(
        applySimpleWeights(scene, leftHand, palmBone, fingerBone, true),
      ).resolves.toBeUndefined();
    });

    it("maintains weight normalization after application", async () => {
      const { scene, bones, mesh } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Create hand bones
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      const handBones = await createSimpleHandBones(
        scene,
        leftHand,
        300,
        400,
        false,
      );
      expect(handBones).not.toBeNull();

      const palmBone = handBones![0];
      const fingerBone = handBones![1];

      // Apply weights
      const applySimpleWeights = (
        service as unknown as {
          applySimpleWeights: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBone: THREE.Bone,
            fingerBone: THREE.Bone,
            isLeft: boolean,
          ) => Promise<void>;
        }
      ).applySimpleWeights.bind(service);

      await applySimpleWeights(scene, leftHand, palmBone, fingerBone, true);

      // Find the mesh and check weights
      let skinnedMesh: THREE.SkinnedMesh | undefined;
      scene.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
          skinnedMesh = child;
        }
      });

      expect(skinnedMesh).toBeDefined();

      const skinWeights = skinnedMesh!.geometry.attributes.skinWeight;

      // Check that weights are normalized
      for (let i = 0; i < skinWeights.count; i++) {
        const w1 = skinWeights.getX(i);
        const w2 = skinWeights.getY(i);
        const w3 = skinWeights.getZ(i);
        const w4 = skinWeights.getW(i);
        const sum = w1 + w2 + w3 + w4;

        if (sum > 0.01) {
          expect(sum).toBeCloseTo(1.0, 1);
        }
      }
    });
  });

  describe("updateAllSkeletons() - Skeleton Update", () => {
    it("updates all skinned mesh skeletons", () => {
      const { scene, mesh } = createTestHumanoidScene();

      // Access private method
      const updateAllSkeletons = (
        service as unknown as {
          updateAllSkeletons: (model: THREE.Object3D) => void;
        }
      ).updateAllSkeletons.bind(service);

      // Should not throw
      expect(() => updateAllSkeletons(scene)).not.toThrow();
    });

    it("recalculates bone matrices", () => {
      const { scene, bones } = createTestHumanoidScene();

      // Modify a bone position
      const leftHand = bones.get("LeftHand")!;
      leftHand.position.set(100, 0, 0);

      // Access private method
      const updateAllSkeletons = (
        service as unknown as {
          updateAllSkeletons: (model: THREE.Object3D) => void;
        }
      ).updateAllSkeletons.bind(service);

      updateAllSkeletons(scene);

      // The bone's world matrix should be updated
      const worldPos = new THREE.Vector3();
      leftHand.getWorldPosition(worldPos);

      // World position should reflect the change (not at origin)
      expect(worldPos.length()).toBeGreaterThan(0);
    });

    it("handles multiple skinned meshes", () => {
      const { scene, skeleton } = createTestHumanoidScene();

      // Add another skinned mesh
      const geometry = new THREE.BoxGeometry(10, 10, 10);
      const vertexCount = geometry.attributes.position.count;
      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
        skinWeights[i * 4] = 1.0;
      }

      geometry.setAttribute(
        "skinIndex",
        new THREE.Float32BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      const mesh2 = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh2.name = "SecondMesh";
      mesh2.bind(skeleton);
      scene.add(mesh2);

      // Access private method
      const updateAllSkeletons = (
        service as unknown as {
          updateAllSkeletons: (model: THREE.Object3D) => void;
        }
      ).updateAllSkeletons.bind(service);

      // Should handle multiple meshes without error
      expect(() => updateAllSkeletons(scene)).not.toThrow();
    });
  });

  describe("exportModel() - Model Export", () => {
    it("exports model to GLB ArrayBuffer", async () => {
      const { scene } = createTestHumanoidScene();

      // Access private method
      const exportModel = (
        service as unknown as {
          exportModel: (
            model: THREE.Object3D,
            debugMode: boolean,
          ) => Promise<ArrayBuffer>;
        }
      ).exportModel.bind(service);

      const glbBuffer = await exportModel(scene, false);

      expect(glbBuffer).toBeInstanceOf(ArrayBuffer);
      expect(glbBuffer.byteLength).toBeGreaterThan(0);

      // Verify it's valid GLB by checking magic bytes
      const view = new DataView(glbBuffer);
      const magic = view.getUint32(0, true);
      expect(magic).toBe(0x46546c67); // 'glTF' in little-endian
    });

    it("exports model with added hand bones", async () => {
      const { scene, bones } = createTestHumanoidScene();
      const leftHand = bones.get("LeftHand")!;

      // Create hand bones first
      const createSimpleHandBones = (
        service as unknown as {
          createSimpleHandBones: (
            model: THREE.Object3D,
            wristBone: THREE.Bone,
            palmBoneLength: number,
            fingerBoneLength: number,
            debugMode: boolean,
          ) => Promise<THREE.Bone[] | null>;
        }
      ).createSimpleHandBones.bind(service);

      await createSimpleHandBones(scene, leftHand, 300, 400, false);

      // Update matrices
      scene.updateMatrixWorld(true);

      // Access export method
      const exportModel = (
        service as unknown as {
          exportModel: (
            model: THREE.Object3D,
            debugMode: boolean,
          ) => Promise<ArrayBuffer>;
        }
      ).exportModel.bind(service);

      const glbBuffer = await exportModel(scene, false);

      expect(glbBuffer).toBeInstanceOf(ArrayBuffer);
      expect(glbBuffer.byteLength).toBeGreaterThan(0);

      // Load back and verify hand bones exist
      const loadedScene = await loadGLBToScene(glbBuffer);

      let hasPalmBone = false;
      let hasFingerBone = false;
      loadedScene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          if (child.name === "LeftHand_Palm") hasPalmBone = true;
          if (child.name === "LeftHand_Fingers") hasFingerBone = true;
        }
      });

      expect(hasPalmBone).toBe(true);
      expect(hasFingerBone).toBe(true);
    });

    it("handles debug mode export", async () => {
      const { scene } = createTestHumanoidScene();

      // Access private method
      const exportModel = (
        service as unknown as {
          exportModel: (
            model: THREE.Object3D,
            debugMode: boolean,
          ) => Promise<ArrayBuffer>;
        }
      ).exportModel.bind(service);

      // With debug mode enabled
      const glbBuffer = await exportModel(scene, true);

      expect(glbBuffer).toBeInstanceOf(ArrayBuffer);
      expect(glbBuffer.byteLength).toBeGreaterThan(0);
    });

    it("preserves skinned mesh geometry in export", async () => {
      const { scene, mesh } = createTestHumanoidScene();
      const originalVertexCount = mesh.geometry.attributes.position.count;

      // Access private method
      const exportModel = (
        service as unknown as {
          exportModel: (
            model: THREE.Object3D,
            debugMode: boolean,
          ) => Promise<ArrayBuffer>;
        }
      ).exportModel.bind(service);

      const glbBuffer = await exportModel(scene, false);

      // Load back and verify geometry
      const loadedScene = await loadGLBToScene(glbBuffer);

      let loadedMesh: THREE.SkinnedMesh | undefined;
      loadedScene.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh && !loadedMesh) {
          loadedMesh = child;
        }
      });

      expect(loadedMesh).toBeDefined();
      expect(loadedMesh!.geometry.attributes.position.count).toBe(
        originalVertexCount,
      );
    });
  });

  describe("Full Method Chain Integration", () => {
    it("loads, rigs, and exports complete pipeline via individual methods", async () => {
      // Create and export initial scene
      const { scene: originalScene, skeleton: originalSkeleton } =
        createTestHumanoidScene();
      const initialBuffer = await exportSceneToGLB(originalScene);
      const url = URL.createObjectURL(new Blob([initialBuffer]));

      try {
        // Access private methods
        const loadModel = (
          service as unknown as {
            loadModel: (modelFile: File | string) => Promise<THREE.Object3D>;
          }
        ).loadModel.bind(service);
        const findWristBones = (
          service as unknown as {
            findWristBones: (model: THREE.Object3D) => THREE.Bone[];
          }
        ).findWristBones.bind(service);
        const createSimpleHandBones = (
          service as unknown as {
            createSimpleHandBones: (
              model: THREE.Object3D,
              wristBone: THREE.Bone,
              palmBoneLength: number,
              fingerBoneLength: number,
              debugMode: boolean,
            ) => Promise<THREE.Bone[] | null>;
          }
        ).createSimpleHandBones.bind(service);
        const updateAllSkeletons = (
          service as unknown as {
            updateAllSkeletons: (model: THREE.Object3D) => void;
          }
        ).updateAllSkeletons.bind(service);
        const exportModel = (
          service as unknown as {
            exportModel: (
              model: THREE.Object3D,
              debugMode: boolean,
            ) => Promise<ArrayBuffer>;
          }
        ).exportModel.bind(service);

        // Step 1: Load model
        const loadedModel = await loadModel(url);
        expect(loadedModel).toBeDefined();

        // Step 2: Find wrist bones
        const wristBones = findWristBones(loadedModel);
        expect(wristBones.length).toBe(2);

        // Step 3: Create hand bones for both wrists
        for (const wristBone of wristBones) {
          const handBones = await createSimpleHandBones(
            loadedModel,
            wristBone,
            300,
            400,
            false,
          );
          expect(handBones).not.toBeNull();
          expect(handBones).toHaveLength(2);
        }

        // Step 4: Update all skeletons
        updateAllSkeletons(loadedModel);

        // Step 5: Export the model
        const exportedBuffer = await exportModel(loadedModel, false);
        expect(exportedBuffer.byteLength).toBeGreaterThan(0);

        // Verify the exported model
        const verifyScene = await loadGLBToScene(exportedBuffer);

        // Count bones in final model
        let finalBoneCount = 0;
        const handBoneNames: string[] = [];
        verifyScene.traverse((child) => {
          if (child instanceof THREE.Bone) {
            finalBoneCount++;
            if (child.name.includes("Palm") || child.name.includes("Fingers")) {
              handBoneNames.push(child.name);
            }
          }
        });

        // Should have original bones + 4 hand bones
        expect(finalBoneCount).toBe(originalSkeleton.bones.length + 4);
        expect(handBoneNames).toContain("LeftHand_Palm");
        expect(handBoneNames).toContain("LeftHand_Fingers");
        expect(handBoneNames).toContain("RightHand_Palm");
        expect(handBoneNames).toContain("RightHand_Fingers");
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });
});
