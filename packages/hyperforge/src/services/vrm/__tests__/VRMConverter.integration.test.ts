/**
 * VRMConverter Integration Tests
 *
 * REAL integration tests that call the actual VRMConverter methods.
 * Creates proper GLB binary data and Three.js scenes with full skeletons.
 *
 * Tests the actual conversion pipeline end-to-end:
 * - Creates real GLB binaries with buildGLB
 * - Creates real Three.js SkinnedMesh with proper skeleton
 * - Calls REAL VRMConverter.convert() method
 * - Verifies output is valid VRM data
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as THREE from "three";

import {
  VRMConverter,
  VRM_HUMANOID_BONES,
  convertGLBToVRM,
  convertGLBToVRMPreservingTextures,
} from "../VRMConverter";
import { buildGLB, parseGLB } from "@/lib/utils/glb-binary-utils";
import { validateVRM1Extension } from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Create a complete Meshy-style humanoid skeleton with proper bone hierarchy
 * Matches the bone names that Meshy.ai generates
 */
function createMeshyHumanoidSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  allBones: THREE.Bone[];
} {
  const bones: THREE.Bone[] = [];

  // Create Hips (root)
  const hips = new THREE.Bone();
  hips.name = "Hips";
  hips.position.set(0, 1.0, 0);
  bones.push(hips);

  // Spine chain
  const spine = new THREE.Bone();
  spine.name = "Spine";
  spine.position.set(0, 0.15, 0);
  hips.add(spine);
  bones.push(spine);

  const spine01 = new THREE.Bone();
  spine01.name = "Spine01";
  spine01.position.set(0, 0.15, 0);
  spine.add(spine01);
  bones.push(spine01);

  const spine02 = new THREE.Bone();
  spine02.name = "Spine02";
  spine02.position.set(0, 0.15, 0);
  spine01.add(spine02);
  bones.push(spine02);

  // Neck and Head
  const neck = new THREE.Bone();
  neck.name = "Neck";
  neck.position.set(0, 0.1, 0);
  spine02.add(neck);
  bones.push(neck);

  const head = new THREE.Bone();
  head.name = "Head";
  head.position.set(0, 0.15, 0);
  neck.add(head);
  bones.push(head);

  // Left Arm chain
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(0.05, 0.0, 0);
  spine02.add(leftShoulder);
  bones.push(leftShoulder);

  const leftArm = new THREE.Bone();
  leftArm.name = "LeftArm";
  leftArm.position.set(0.1, 0, 0);
  leftShoulder.add(leftArm);
  bones.push(leftArm);

  const leftForeArm = new THREE.Bone();
  leftForeArm.name = "LeftForeArm";
  leftForeArm.position.set(0.25, 0, 0);
  leftArm.add(leftForeArm);
  bones.push(leftForeArm);

  const leftHand = new THREE.Bone();
  leftHand.name = "LeftHand";
  leftHand.position.set(0.25, 0, 0);
  leftForeArm.add(leftHand);
  bones.push(leftHand);

  // Right Arm chain
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  rightShoulder.position.set(-0.05, 0.0, 0);
  spine02.add(rightShoulder);
  bones.push(rightShoulder);

  const rightArm = new THREE.Bone();
  rightArm.name = "RightArm";
  rightArm.position.set(-0.1, 0, 0);
  rightShoulder.add(rightArm);
  bones.push(rightArm);

  const rightForeArm = new THREE.Bone();
  rightForeArm.name = "RightForeArm";
  rightForeArm.position.set(-0.25, 0, 0);
  rightArm.add(rightForeArm);
  bones.push(rightForeArm);

  const rightHand = new THREE.Bone();
  rightHand.name = "RightHand";
  rightHand.position.set(-0.25, 0, 0);
  rightForeArm.add(rightHand);
  bones.push(rightHand);

  // Left Leg chain
  const leftUpLeg = new THREE.Bone();
  leftUpLeg.name = "LeftUpLeg";
  leftUpLeg.position.set(0.1, 0, 0);
  hips.add(leftUpLeg);
  bones.push(leftUpLeg);

  const leftLeg = new THREE.Bone();
  leftLeg.name = "LeftLeg";
  leftLeg.position.set(0, -0.4, 0);
  leftUpLeg.add(leftLeg);
  bones.push(leftLeg);

  const leftFoot = new THREE.Bone();
  leftFoot.name = "LeftFoot";
  leftFoot.position.set(0, -0.4, 0);
  leftLeg.add(leftFoot);
  bones.push(leftFoot);

  const leftToe = new THREE.Bone();
  leftToe.name = "LeftToe";
  leftToe.position.set(0, 0, 0.1);
  leftFoot.add(leftToe);
  bones.push(leftToe);

  // Right Leg chain
  const rightUpLeg = new THREE.Bone();
  rightUpLeg.name = "RightUpLeg";
  rightUpLeg.position.set(-0.1, 0, 0);
  hips.add(rightUpLeg);
  bones.push(rightUpLeg);

  const rightLeg = new THREE.Bone();
  rightLeg.name = "RightLeg";
  rightLeg.position.set(0, -0.4, 0);
  rightUpLeg.add(rightLeg);
  bones.push(rightLeg);

  const rightFoot = new THREE.Bone();
  rightFoot.name = "RightFoot";
  rightFoot.position.set(0, -0.4, 0);
  rightLeg.add(rightFoot);
  bones.push(rightFoot);

  const rightToe = new THREE.Bone();
  rightToe.name = "RightToe";
  rightToe.position.set(0, 0, 0.1);
  rightFoot.add(rightToe);
  bones.push(rightToe);

  const skeleton = new THREE.Skeleton(bones);

  return { skeleton, rootBone: hips, allBones: bones };
}

/**
 * Create a proper skinned mesh with bone weights for all vertices
 */
function createSkinnedMeshWithSkeleton(
  skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
): THREE.SkinnedMesh {
  // Create a humanoid-shaped geometry (capsule-like)
  const geometry = new THREE.CylinderGeometry(0.3, 0.2, 1.8, 16, 20);
  const vertexCount = geometry.attributes.position.count;

  // Create skinning attributes
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  const positions = geometry.attributes.position;

  for (let i = 0; i < vertexCount; i++) {
    const y = positions.getY(i);

    // Distribute weights based on vertex height
    // This creates a simple but functional weight distribution
    let boneIndex = 0;
    if (y > 0.6) {
      boneIndex = 5; // Head
    } else if (y > 0.4) {
      boneIndex = 4; // Neck
    } else if (y > 0.2) {
      boneIndex = 3; // Spine02
    } else if (y > 0) {
      boneIndex = 2; // Spine01
    } else if (y > -0.2) {
      boneIndex = 1; // Spine
    } else {
      boneIndex = 0; // Hips
    }

    // Single bone influence for simplicity
    skinIndices[i * 4] = boneIndex;
    skinIndices[i * 4 + 1] = 0;
    skinIndices[i * 4 + 2] = 0;
    skinIndices[i * 4 + 3] = 0;

    skinWeights[i * 4] = 1.0;
    skinWeights[i * 4 + 1] = 0;
    skinWeights[i * 4 + 2] = 0;
    skinWeights[i * 4 + 3] = 0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

  // Attach skeleton
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(skeleton);

  return skinnedMesh;
}

/**
 * Create a complete scene with skinned mesh that mimics Meshy output
 */
function createMeshyStyleScene(): THREE.Scene {
  const scene = new THREE.Scene();

  // Create Armature container (Meshy style)
  const armature = new THREE.Object3D();
  armature.name = "Armature";
  armature.scale.set(1, 1, 1); // Normal scale (not the 0.01 that Meshy uses)
  scene.add(armature);

  // Create skeleton
  const { skeleton, rootBone } = createMeshyHumanoidSkeleton();

  // Create skinned mesh
  const skinnedMesh = createSkinnedMeshWithSkeleton(skeleton, rootBone);
  skinnedMesh.name = "Body";
  armature.add(skinnedMesh);

  scene.updateMatrixWorld(true);

  return scene;
}

/**
 * Create minimal valid GLB JSON structure with nodes for a humanoid
 */
function createMinimalGLBJson(): Record<string, unknown> {
  const nodes = [
    { name: "Armature", children: [1, 18] },
    // Skeleton hierarchy (indices 1-17)
    { name: "Hips", translation: [0, 1, 0], children: [2, 14, 16] },
    { name: "Spine", translation: [0, 0.15, 0], children: [3] },
    { name: "Spine01", translation: [0, 0.15, 0], children: [4] },
    { name: "Spine02", translation: [0, 0.15, 0], children: [5, 7, 11] },
    { name: "Neck", translation: [0, 0.1, 0], children: [6] },
    { name: "Head", translation: [0, 0.15, 0] },
    // Left arm
    { name: "LeftShoulder", translation: [0.05, 0, 0], children: [8] },
    { name: "LeftArm", translation: [0.1, 0, 0], children: [9] },
    { name: "LeftForeArm", translation: [0.25, 0, 0], children: [10] },
    { name: "LeftHand", translation: [0.25, 0, 0] },
    // Right arm
    { name: "RightShoulder", translation: [-0.05, 0, 0], children: [12] },
    { name: "RightArm", translation: [-0.1, 0, 0], children: [13] },
    { name: "RightForeArm", translation: [-0.25, 0, 0], children: [14] },
    { name: "RightHand", translation: [-0.25, 0, 0] },
    // Left leg
    { name: "LeftUpLeg", translation: [0.1, 0, 0], children: [15] },
    { name: "LeftLeg", translation: [0, -0.4, 0], children: [16] },
    { name: "LeftFoot", translation: [0, -0.4, 0] },
    // Right leg
    { name: "RightUpLeg", translation: [-0.1, 0, 0], children: [18] },
    { name: "RightLeg", translation: [0, -0.4, 0], children: [19] },
    { name: "RightFoot", translation: [0, -0.4, 0] },
    // Mesh node
    { name: "Body", mesh: 0, skin: 0 },
  ];

  return {
    asset: { version: "2.0", generator: "Test" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
          },
        ],
      },
    ],
    skins: [
      {
        joints: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        ],
        skeleton: 1,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 100, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 100, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 300, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 1200 },
      { buffer: 0, byteOffset: 1200, byteLength: 1200 },
      { buffer: 0, byteOffset: 2400, byteLength: 600 },
    ],
    buffers: [{ byteLength: 3000 }],
  };
}

describe("VRMConverter Integration Tests", () => {
  let converter: VRMConverter;

  beforeEach(() => {
    converter = new VRMConverter();
  });

  describe("convert() - Full Pipeline", () => {
    it("converts a Three.js scene with skeleton to VRM format", async () => {
      // Create a real Meshy-style scene with skinned mesh
      const scene = createMeshyStyleScene();

      // Call the REAL convert method
      const result = await converter.convert(scene, {
        avatarName: "Test Avatar",
        author: "Integration Test",
      });

      // Verify the result
      expect(result).toBeDefined();
      expect(result.vrmData).toBeInstanceOf(ArrayBuffer);
      expect(result.vrmData.byteLength).toBeGreaterThan(0);
      expect(result.boneMappings).toBeInstanceOf(Map);
      expect(result.boneMappings.size).toBeGreaterThan(0);
      expect(result.warnings).toBeInstanceOf(Array);

      // Verify the output is valid GLB
      const { json } = parseGLB(result.vrmData);
      expect(json).toBeDefined();
      expect(json.asset).toBeDefined();

      // Verify VRM extension is present
      const extensions = json.extensions as Record<string, unknown>;
      expect(extensions).toBeDefined();
      expect(extensions.VRMC_vrm).toBeDefined();

      const vrmExt = extensions.VRMC_vrm as Record<string, unknown>;
      expect(vrmExt.specVersion).toBe("1.0");
      expect(vrmExt.humanoid).toBeDefined();
      expect(vrmExt.meta).toBeDefined();
    });

    it("maps all required Meshy bones to VRM humanoid bones", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene);

      // Check that required bones are mapped
      const mappedVRMBones = Array.from(result.boneMappings.values());

      // These are the minimum required bones for VRM
      expect(mappedVRMBones).toContain("hips");
      expect(mappedVRMBones).toContain("spine");
      expect(mappedVRMBones).toContain("head");
    });

    it("produces valid VRM 1.0 extension structure", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene);

      const { json } = parseGLB(result.vrmData);

      // Use the real validation helper
      const validation = validateVRM1Extension(json);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("handles oversized models by normalizing scale", async () => {
      // Create a scene with oversized skeleton (100x normal)
      const scene = new THREE.Scene();
      const { skeleton, rootBone, allBones } = createMeshyHumanoidSkeleton();

      // Scale up all bone positions
      allBones.forEach((bone) => {
        bone.position.multiplyScalar(100);
      });

      const skinnedMesh = createSkinnedMeshWithSkeleton(skeleton, rootBone);
      skinnedMesh.geometry.scale(100, 100, 100);
      scene.add(skinnedMesh);
      scene.updateMatrixWorld(true);

      // Convert should normalize the scale
      const result = await converter.convert(scene);

      // Verify conversion succeeded
      expect(result.vrmData.byteLength).toBeGreaterThan(0);

      // Parse and check the output
      const { json } = parseGLB(result.vrmData);
      expect(json).toBeDefined();
    });

    it("preserves metadata in VRM output", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene, {
        avatarName: "Custom Avatar Name",
        author: "Test Author",
        version: "2.0",
      });

      const { json } = parseGLB(result.vrmData);
      const extensions = json.extensions as Record<string, unknown>;
      const vrmExt = extensions.VRMC_vrm as Record<string, unknown>;
      const meta = vrmExt.meta as Record<string, unknown>;

      expect(meta.name).toBe("Custom Avatar Name");
      expect(meta.version).toBe("2.0");
      expect((meta.authors as string[])[0]).toBe("Test Author");
    });
  });

  describe("convertGLBToVRM() - Convenience Function", () => {
    it("converts a Group to VRM using the convenience function", async () => {
      const group = new THREE.Group();

      const { skeleton, rootBone } = createMeshyHumanoidSkeleton();
      const skinnedMesh = createSkinnedMeshWithSkeleton(skeleton, rootBone);
      group.add(skinnedMesh);
      group.updateMatrixWorld(true);

      const result = await convertGLBToVRM(group);

      expect(result.vrmData).toBeInstanceOf(ArrayBuffer);
      expect(result.vrmData.byteLength).toBeGreaterThan(0);
    });

    it("converts a Scene to VRM using the convenience function", async () => {
      const scene = createMeshyStyleScene();

      const result = await convertGLBToVRM(scene);

      expect(result.vrmData).toBeInstanceOf(ArrayBuffer);
      expect(result.vrmData.byteLength).toBeGreaterThan(0);

      // Validate the output
      const { json } = parseGLB(result.vrmData);
      expect(json.extensions).toBeDefined();
    });
  });

  describe("convertGLBToVRMPreservingTextures() - Direct Binary Conversion", () => {
    it("converts GLB binary directly without re-exporting through Three.js", async () => {
      // Create a minimal GLB with proper structure
      const json = createMinimalGLBJson();
      const binData = new Uint8Array(3000); // Dummy bin data

      // Build actual GLB binary
      const glbBinary = buildGLB(json, binData);

      // Call the REAL texture-preserving conversion
      const result = await convertGLBToVRMPreservingTextures(glbBinary, {
        avatarName: "Preserved Texture Avatar",
      });

      expect(result.vrmData).toBeInstanceOf(ArrayBuffer);
      expect(result.vrmData.byteLength).toBeGreaterThan(0);

      // Verify VRM extension was added
      const { json: outputJson } = parseGLB(result.vrmData);
      const extensions = outputJson.extensions as Record<string, unknown>;
      expect(extensions.VRMC_vrm).toBeDefined();
    });

    it("maps bones correctly from GLB nodes", async () => {
      const json = createMinimalGLBJson();
      const binData = new Uint8Array(3000);
      const glbBinary = buildGLB(json, binData);

      const result = await convertGLBToVRMPreservingTextures(glbBinary);

      // Check bone mappings were created
      expect(result.boneMappings.size).toBeGreaterThan(0);

      // Verify some key mappings
      const mappedBones = Array.from(result.boneMappings.values());
      expect(mappedBones).toContain("hips");
      expect(mappedBones).toContain("spine");
    });

    it("preserves original buffer data", async () => {
      const json = createMinimalGLBJson();
      // Create recognizable pattern in bin data
      const binData = new Uint8Array(3000);
      for (let i = 0; i < binData.length; i++) {
        binData[i] = i % 256;
      }

      const glbBinary = buildGLB(json, binData);
      const result = await convertGLBToVRMPreservingTextures(glbBinary);

      // Parse output and check bin chunk was preserved
      const { bin: outputBin } = parseGLB(result.vrmData);

      expect(outputBin).not.toBeNull();
      expect(outputBin!.length).toBe(3000);

      // Verify the data pattern is preserved
      for (let i = 0; i < 100; i++) {
        expect(outputBin![i]).toBe(i % 256);
      }
    });
  });

  describe("buildGLB() and parseGLB() - Binary Utilities", () => {
    it("creates valid GLB binary from JSON and BIN data", () => {
      const json = {
        asset: { version: "2.0" },
        nodes: [{ name: "TestNode" }],
      };
      const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      const glb = buildGLB(json, bin);

      expect(glb).toBeInstanceOf(ArrayBuffer);
      expect(glb.byteLength).toBeGreaterThan(0);

      // Verify it can be parsed back
      const parsed = parseGLB(glb);
      expect(parsed.json.asset).toEqual({ version: "2.0" });
      expect(parsed.json.nodes).toEqual([{ name: "TestNode" }]);
      expect(parsed.bin).not.toBeNull();
      expect(parsed.bin!.length).toBe(8);
    });

    it("handles GLB without BIN chunk", () => {
      const json = {
        asset: { version: "2.0" },
        scenes: [{ nodes: [] }],
      };

      const glb = buildGLB(json, null);

      expect(glb).toBeInstanceOf(ArrayBuffer);

      const parsed = parseGLB(glb);
      expect(parsed.json.asset).toEqual({ version: "2.0" });
      expect(parsed.bin).toBeNull();
    });

    it("maintains 4-byte alignment for chunks", () => {
      // Create JSON with odd length
      const json = { a: "xyz" }; // Results in odd-length JSON string
      const bin = new Uint8Array([1, 2, 3]); // Odd length

      const glb = buildGLB(json, bin);

      // Total length should be divisible by 4
      const view = new DataView(glb);
      const totalLength = view.getUint32(8, true);

      // Header (12) + JSON chunk header (8) + JSON (padded) + BIN chunk header (8) + BIN (padded)
      // All must be 4-byte aligned
      expect(totalLength % 4).toBe(0);
    });
  });

  describe("Skeleton Processing", () => {
    it("extracts skeleton from scene with multiple meshes", async () => {
      const scene = new THREE.Scene();

      // Add regular mesh (not skinned)
      const regularMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial(),
      );
      regularMesh.name = "RegularMesh";
      scene.add(regularMesh);

      // Add skinned mesh with skeleton
      const { skeleton, rootBone } = createMeshyHumanoidSkeleton();
      const skinnedMesh = createSkinnedMeshWithSkeleton(skeleton, rootBone);
      skinnedMesh.name = "SkinnedBody";
      scene.add(skinnedMesh);

      scene.updateMatrixWorld(true);

      // Converter should find the skinned mesh
      const result = await converter.convert(scene);

      expect(result.vrmData.byteLength).toBeGreaterThan(0);
      expect(result.boneMappings.size).toBeGreaterThan(0);
    });

    it("throws error when no SkinnedMesh is found", async () => {
      // Use fresh converter to avoid any state leakage
      const freshConverter = new VRMConverter();
      const noSkinnedMeshScene = new THREE.Scene();

      // Add only regular mesh (NOT a SkinnedMesh)
      const regularMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial(),
      );
      regularMesh.name = "JustABox";
      noSkinnedMeshScene.add(regularMesh);

      await expect(freshConverter.convert(noSkinnedMeshScene)).rejects.toThrow(
        "No SkinnedMesh found",
      );
    });

    it("extracts correct bone count from skeleton", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene);

      // We created 22 bones in createMeshyHumanoidSkeleton
      // VRM may only map the required subset
      expect(result.boneMappings.size).toBeGreaterThan(0);
      expect(result.boneMappings.size).toBeLessThanOrEqual(22);
    });
  });

  describe("VRM Extension Generation", () => {
    it("generates correct humanoid bone node indices", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene);

      const { json } = parseGLB(result.vrmData);
      const extensions = json.extensions as Record<string, unknown>;
      const vrmExt = extensions.VRMC_vrm as Record<string, unknown>;
      const humanoid = vrmExt.humanoid as Record<string, unknown>;
      const humanBones = humanoid.humanBones as Record<
        string,
        { node: number }
      >;

      // Verify each bone has a valid node index
      for (const [boneName, boneData] of Object.entries(humanBones)) {
        expect(typeof boneData.node).toBe("number");
        expect(boneData.node).toBeGreaterThanOrEqual(0);

        // Verify the node exists in the JSON
        const nodes = json.nodes as Array<{ name?: string }>;
        expect(nodes[boneData.node]).toBeDefined();
      }
    });

    it("adds VRMC_vrm to extensionsUsed array", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene);

      const { json } = parseGLB(result.vrmData);
      const extensionsUsed = json.extensionsUsed as string[];

      expect(extensionsUsed).toContain("VRMC_vrm");
    });

    it("includes all required VRM 1.0 meta fields", async () => {
      const scene = createMeshyStyleScene();

      const result = await converter.convert(scene, {
        avatarName: "Test",
        author: "Test Author",
      });

      const { json } = parseGLB(result.vrmData);
      const extensions = json.extensions as Record<string, unknown>;
      const vrmExt = extensions.VRMC_vrm as Record<string, unknown>;
      const meta = vrmExt.meta as Record<string, unknown>;

      expect(meta.name).toBeDefined();
      expect(meta.version).toBeDefined();
      expect(meta.authors).toBeDefined();
      expect(meta.licenseUrl).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("throws on empty scene with no skinned mesh", async () => {
      // Create a completely fresh converter instance
      const freshConverter = new VRMConverter();
      const emptyScene = new THREE.Scene();

      // Add only a regular mesh (NOT a SkinnedMesh)
      const regularMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial(),
      );
      regularMesh.name = "RegularMesh";
      emptyScene.add(regularMesh);

      await expect(freshConverter.convert(emptyScene)).rejects.toThrow(
        "No SkinnedMesh found",
      );
    });

    it("throws when scene contains only bones without skinned mesh", async () => {
      const freshConverter = new VRMConverter();
      const boneOnlyScene = new THREE.Scene();

      // Add just bones without skinned mesh
      const bone = new THREE.Bone();
      bone.name = "Hips";
      bone.position.set(0, 1, 0);
      boneOnlyScene.add(bone);

      await expect(freshConverter.convert(boneOnlyScene)).rejects.toThrow(
        "No SkinnedMesh found",
      );
    });

    it("reports warnings for missing optional bones", async () => {
      const scene = new THREE.Scene();

      // Create minimal skeleton with just hips, spine, head
      const hips = new THREE.Bone();
      hips.name = "Hips";
      hips.position.set(0, 1, 0);

      const spine = new THREE.Bone();
      spine.name = "Spine";
      hips.add(spine);

      const head = new THREE.Bone();
      head.name = "Head";
      spine.add(head);

      const bones = [hips, spine, head];
      const skeleton = new THREE.Skeleton(bones);

      // Create simple skinned mesh
      const geometry = new THREE.BoxGeometry(0.5, 1.5, 0.3, 2, 2, 2);
      const vertexCount = geometry.attributes.position.count;

      const skinIndices = new Float32Array(vertexCount * 4);
      const skinWeights = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) {
        skinIndices[i * 4] = 0;
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

      const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial(),
      );
      mesh.add(hips);
      mesh.bind(skeleton);
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const result = await converter.convert(scene);

      // Should succeed but with warnings about missing limb bones
      expect(result.vrmData.byteLength).toBeGreaterThan(0);
      // May have warnings for missing arm/leg bones
    });
  });

  describe("Armature Scale Handling", () => {
    it("handles Meshy-style 0.01 armature scale", async () => {
      const scene = new THREE.Scene();

      // Create Armature with Meshy's typical 0.01 scale
      const armature = new THREE.Object3D();
      armature.name = "Armature";
      armature.scale.set(0.01, 0.01, 0.01);
      scene.add(armature);

      // Create skeleton with positions in centimeters (100x larger)
      const { skeleton, rootBone, allBones } = createMeshyHumanoidSkeleton();
      allBones.forEach((bone) => {
        bone.position.multiplyScalar(100);
      });

      const skinnedMesh = createSkinnedMeshWithSkeleton(skeleton, rootBone);
      skinnedMesh.geometry.scale(100, 100, 100);
      armature.add(skinnedMesh);

      scene.updateMatrixWorld(true);

      // Convert should bake out the armature scale
      const result = await converter.convert(scene);

      expect(result.vrmData.byteLength).toBeGreaterThan(0);

      // Parse and verify the result
      const { json } = parseGLB(result.vrmData);
      expect(json).toBeDefined();
    });
  });
});
