/**
 * Test Helper Utilities
 *
 * Utilities for loading test assets, analyzing meshes, and verifying 3D content.
 * These use REAL implementations - NO MOCKS per workspace rules.
 */

import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import fs from "fs/promises";
import path from "path";

// Import Three.js polyfills for server-side loading
import "@/lib/server/three-polyfills";

/**
 * Path to test assets directory
 */
export const TEST_ASSETS_DIR = path.resolve(process.cwd(), "test-assets");

/**
 * Load a GLB file from test assets
 */
export async function loadTestGLB(filename: string): Promise<GLTF> {
  const filePath = path.join(TEST_ASSETS_DIR, filename);

  // Read file as ArrayBuffer
  const buffer = await fs.readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );

  // Load with GLTFLoader
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => resolve(gltf),
      (error) => reject(error),
    );
  });
}

/**
 * Load a test mesh from a GLB file
 */
export async function loadTestMesh(filename: string): Promise<THREE.Mesh> {
  const gltf = await loadTestGLB(filename);
  let mesh: THREE.Mesh | null = null;

  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh && !mesh) {
      mesh = child;
    }
  });

  if (!mesh) {
    throw new Error(`No mesh found in ${filename}`);
  }

  return mesh;
}

/**
 * Load a test skinned mesh from a GLB file
 */
export async function loadTestSkinnedMesh(
  filename: string,
): Promise<THREE.SkinnedMesh> {
  const gltf = await loadTestGLB(filename);
  let mesh: THREE.SkinnedMesh | null = null;

  gltf.scene.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && !mesh) {
      mesh = child;
    }
  });

  if (!mesh) {
    throw new Error(`No skinned mesh found in ${filename}`);
  }

  return mesh;
}

/**
 * Count faces (triangles) in a mesh
 */
export function countFaces(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry as THREE.BufferGeometry;

  if (geometry.index) {
    return geometry.index.count / 3;
  }

  const position = geometry.attributes.position;
  return position.count / 3;
}

/**
 * Count vertices in a mesh
 */
export function countVertices(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  return geometry.attributes.position.count;
}

/**
 * Calculate bounding box dimensions of a mesh
 */
export function getMeshDimensions(
  mesh: THREE.Mesh | THREE.Object3D,
): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(mesh);
  return box.getSize(new THREE.Vector3());
}

/**
 * Calculate model height from hips to head bones
 */
export function calculateModelHeight(scene: THREE.Object3D): number {
  let hipsBone: THREE.Bone | null = null;
  let headBone: THREE.Bone | null = null;

  scene.traverse((child) => {
    if (child instanceof THREE.Bone) {
      const name = child.name.toLowerCase();
      if (name.includes("hip") && !hipsBone) {
        hipsBone = child;
      }
      if (name.includes("head") && !headBone) {
        headBone = child;
      }
    }
  });

  if (!hipsBone || !headBone) {
    // Fallback to bounding box height
    const dimensions = getMeshDimensions(scene);
    return dimensions.y;
  }

  const hipsPos = new THREE.Vector3();
  const headPos = new THREE.Vector3();

  hipsBone.getWorldPosition(hipsPos);
  headBone.getWorldPosition(headPos);

  return hipsPos.distanceTo(headPos);
}

/**
 * Find vertices with no bone weights (unweighted vertices)
 */
export function findUnweightedVertices(mesh: THREE.SkinnedMesh): number[] {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const skinWeight = geometry.attributes.skinWeight;

  if (!skinWeight) {
    return [];
  }

  const unweighted: number[] = [];

  for (let i = 0; i < skinWeight.count; i++) {
    const totalWeight =
      skinWeight.getX(i) +
      skinWeight.getY(i) +
      skinWeight.getZ(i) +
      skinWeight.getW(i);

    if (totalWeight < 0.001) {
      unweighted.push(i);
    }
  }

  return unweighted;
}

/**
 * Detect mesh collisions using raycasting
 * Returns points where meshes intersect
 */
export function detectMeshCollisions(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  sampleRate: number = 100,
): THREE.Vector3[] {
  const collisions: THREE.Vector3[] = [];
  const geometryA = meshA.geometry as THREE.BufferGeometry;
  const positionA = geometryA.attributes.position;

  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = 0.1; // 10cm range

  // Sample vertices from meshA
  const step = Math.max(1, Math.floor(positionA.count / sampleRate));

  for (let i = 0; i < positionA.count; i += step) {
    const vertex = new THREE.Vector3();
    vertex.fromBufferAttribute(positionA, i);
    vertex.applyMatrix4(meshA.matrixWorld);

    // Cast ray inward
    const normal = vertex.clone().normalize().negate();
    raycaster.set(vertex, normal);

    const intersects = raycaster.intersectObject(meshB, false);

    if (intersects.length > 0) {
      collisions.push(vertex.clone());
    }
  }

  return collisions;
}

/**
 * Check if a bone hierarchy contains required VRM bones
 */
export function checkVRMBoneHierarchy(scene: THREE.Object3D): {
  valid: boolean;
  missing: string[];
  found: string[];
} {
  const requiredBones = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
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

  const foundBones: string[] = [];

  scene.traverse((child) => {
    if (child instanceof THREE.Bone) {
      const name = child.name.toLowerCase();
      for (const required of requiredBones) {
        if (
          name.includes(required.toLowerCase()) &&
          !foundBones.includes(required)
        ) {
          foundBones.push(required);
        }
      }
    }
  });

  const missing = requiredBones.filter((b) => !foundBones.includes(b));

  return {
    valid: missing.length === 0,
    missing,
    found: foundBones,
  };
}

/**
 * Validate VRM 1.0 extension structure
 */
export function validateVRM1Extension(gltfJson: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const extensions = gltfJson.extensions as Record<string, unknown> | undefined;
  if (!extensions) {
    errors.push("No extensions found");
    return { valid: false, errors };
  }

  const vrmExt = extensions.VRMC_vrm as Record<string, unknown> | undefined;
  if (!vrmExt) {
    errors.push("VRMC_vrm extension not found");
    return { valid: false, errors };
  }

  if (vrmExt.specVersion !== "1.0") {
    errors.push(`Invalid specVersion: ${vrmExt.specVersion}`);
  }

  const humanoid = vrmExt.humanoid as Record<string, unknown> | undefined;
  if (!humanoid) {
    errors.push("humanoid section missing");
  } else {
    const humanBones = humanoid.humanBones as
      | Record<string, unknown>
      | undefined;
    if (!humanBones) {
      errors.push("humanoid.humanBones missing");
    } else {
      // Check required bones
      const requiredBones = ["hips", "spine", "head"];
      for (const bone of requiredBones) {
        if (!(bone in humanBones)) {
          errors.push(`Required bone missing: ${bone}`);
        }
      }
    }
  }

  const meta = vrmExt.meta as Record<string, unknown> | undefined;
  if (!meta) {
    errors.push("meta section missing");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Create a simple test mesh for testing
 */
export function createTestMesh(type: "box" | "sphere" = "box"): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  if (type === "box") {
    geometry = new THREE.BoxGeometry(1, 1, 1);
  } else {
    geometry = new THREE.SphereGeometry(0.5, 32, 32);
  }

  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  return new THREE.Mesh(geometry, material);
}

/**
 * Create a simple test skeleton
 */
export function createTestSkeleton(): {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
} {
  const hipsBone = new THREE.Bone();
  hipsBone.name = "Hips";
  hipsBone.position.set(0, 1, 0);

  const spineBone = new THREE.Bone();
  spineBone.name = "Spine";
  spineBone.position.set(0, 0.2, 0);
  hipsBone.add(spineBone);

  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 0.6, 0);
  spineBone.add(headBone);

  const bones = [hipsBone, spineBone, headBone];
  const skeleton = new THREE.Skeleton(bones);

  return { skeleton, rootBone: hipsBone };
}
