/**
 * Tree Mesh Generation
 *
 * Converts tree data into Three.js meshes with materials.
 * Supports both standard and instanced rendering for optimal performance.
 *
 * OPTIMIZED MODE:
 * - Single draw call for all leaves using InstancedMesh
 * - Packed position/orientation data in GPU buffers
 * - Minimal material count for better batching
 */

import * as THREE from "three";
import type { TreeData, GeometryOptions } from "../types.js";
import {
  generateBranchGeometry,
  generateBranchGeometryByDepth,
} from "../geometry/BranchGeometry.js";
import {
  generateLeafGeometry,
  generateSeparateLeafGeometry,
  generateInstancedLeaves,
  generateInstancedLeavesAndBlossoms,
} from "../geometry/LeafGeometry.js";

/**
 * Options for tree mesh generation.
 */
export type TreeMeshOptions = {
  /** Geometry generation options */
  geometry?: GeometryOptions;
  /** Use separate materials for different branch depths */
  separateBranchMaterials?: boolean;
  /** Branch material or materials (one per depth if separateBranchMaterials is true) */
  branchMaterial?: THREE.Material | THREE.Material[];
  /** Leaf material */
  leafMaterial?: THREE.Material;
  /** Blossom material */
  blossomMaterial?: THREE.Material;
  /** Cast shadows */
  castShadow?: boolean;
  /** Receive shadows */
  receiveShadow?: boolean;
  /** Use instanced rendering for leaves (RECOMMENDED - single draw call) */
  useInstancedLeaves?: boolean;
  /** Maximum leaf instances when using instanced rendering */
  maxLeafInstances?: number;
  /** Use TSL (WebGPU-compatible) materials instead of GLSL ShaderMaterial for instanced leaves */
  useTSL?: boolean;
};

/**
 * Result of tree mesh generation.
 */
export type TreeMeshResult = {
  /** Root group containing all meshes */
  group: THREE.Group;
  /** Branch meshes (one per depth if separated, otherwise single mesh) */
  branches: THREE.Mesh[];
  /** Leaf mesh (standard or instanced) */
  leaves: THREE.Mesh | THREE.InstancedMesh | null;
  /** Blossom mesh (if separate from leaves) */
  blossoms: THREE.Mesh | THREE.InstancedMesh | null;
  /** Total vertex count */
  vertexCount: number;
  /** Total triangle count */
  triangleCount: number;
  /** Number of draw calls this tree requires */
  drawCalls: number;
  /** Number of unique materials used */
  materialCount: number;
  /** Whether instanced rendering is used for leaves */
  instancedLeaves: boolean;
  /** Leaf instance count (if instanced) */
  leafInstanceCount: number;
};

/**
 * Generate Three.js meshes from tree data.
 *
 * @param data - Generated tree data
 * @param options - Mesh generation options
 * @returns Tree mesh result
 */
export function generateTreeMesh(
  data: TreeData,
  options: TreeMeshOptions = {},
): TreeMeshResult {
  const group = new THREE.Group();
  group.name = "Tree";

  const branches: THREE.Mesh[] = [];
  let leaves: THREE.Mesh | THREE.InstancedMesh | null = null;
  let blossoms: THREE.Mesh | THREE.InstancedMesh | null = null;
  let vertexCount = 0;
  let triangleCount = 0;
  let drawCalls = 0;
  let materialCount = 0;
  const materialSet = new Set<THREE.Material>();
  let instancedLeaves = false;
  let leafInstanceCount = 0;

  // Default to instanced rendering for optimal performance
  const useInstanced = options.useInstancedLeaves ?? true;

  // Generate branch geometry
  if (options.separateBranchMaterials) {
    const geometryByDepth = generateBranchGeometryByDepth(
      data.stems,
      data.params,
      options.geometry,
    );

    const materials = Array.isArray(options.branchMaterial)
      ? options.branchMaterial
      : [options.branchMaterial ?? createDefaultBranchMaterial()];

    for (const [depth, geometry] of geometryByDepth) {
      const material = materials[Math.min(depth, materials.length - 1)]!;
      materialSet.add(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Branches_${depth}`;
      mesh.castShadow = options.castShadow ?? true;
      mesh.receiveShadow = options.receiveShadow ?? true;
      group.add(mesh);
      branches.push(mesh);
      drawCalls++;

      const posAttr = geometry.getAttribute("position");
      const indexAttr = geometry.getIndex();
      if (posAttr) vertexCount += posAttr.count;
      if (indexAttr) triangleCount += indexAttr.count / 3;
    }
  } else {
    const geometry = generateBranchGeometry(
      data.stems,
      data.params,
      options.geometry,
    );

    const material = Array.isArray(options.branchMaterial)
      ? options.branchMaterial[0]!
      : (options.branchMaterial ?? createDefaultBranchMaterial());
    materialSet.add(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "Branches";
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    group.add(mesh);
    branches.push(mesh);
    drawCalls++;

    const posAttr = geometry.getAttribute("position");
    const indexAttr = geometry.getIndex();
    if (posAttr) vertexCount += posAttr.count;
    if (indexAttr) triangleCount += indexAttr.count / 3;
  }

  // Generate leaf geometry
  if (data.leaves.length > 0) {
    const hasBlossoms = data.leaves.some((l) => l.isBlossom);
    const maxLeaves =
      options.geometry?.maxLeaves ?? options.maxLeafInstances ?? 50000;

    // Extract leaf sampling options from geometry config
    const leafSamplingMode = options.geometry?.leafSamplingMode ?? "spatial";
    const leafSamplingSeed =
      options.geometry?.leafSamplingSeed ?? data.seed ?? 0;

    if (useInstanced) {
      // OPTIMIZED: Use instanced rendering for leaves
      instancedLeaves = true;

      if (hasBlossoms && options.blossomMaterial) {
        // Separate instanced leaves and blossoms
        const result = generateInstancedLeavesAndBlossoms(
          data.leaves,
          data.params,
          data.treeScale,
          {
            maxInstances: maxLeaves,
            material: options.leafMaterial,
            leafSamplingMode,
            leafSamplingSeed,
            useTSL: options.useTSL,
          },
        );

        if (result.leaves) {
          result.leaves.mesh.castShadow = options.castShadow ?? true;
          result.leaves.mesh.receiveShadow = options.receiveShadow ?? true;
          group.add(result.leaves.mesh);
          leaves = result.leaves.mesh;
          materialSet.add(result.leaves.material);
          drawCalls++; // One draw call for all leaf instances
          leafInstanceCount += result.leaves.instanceCount;
          // For instanced: 4 verts per card, 2 tris per card
          vertexCount += 4;
          triangleCount += 2 * result.leaves.instanceCount;
        }

        if (result.blossoms) {
          result.blossoms.mesh.castShadow = options.castShadow ?? true;
          result.blossoms.mesh.receiveShadow = options.receiveShadow ?? true;
          group.add(result.blossoms.mesh);
          blossoms = result.blossoms.mesh;
          materialSet.add(result.blossoms.material);
          drawCalls++;
          vertexCount += 4;
          triangleCount += 2 * result.blossoms.instanceCount;
        }
      } else {
        // Combined instanced leaves
        const result = generateInstancedLeaves(
          data.leaves,
          data.params,
          data.treeScale,
          {
            maxInstances: maxLeaves,
            material: options.leafMaterial,
            leafSamplingMode,
            leafSamplingSeed,
            useTSL: options.useTSL,
          },
        );

        result.mesh.castShadow = options.castShadow ?? true;
        result.mesh.receiveShadow = options.receiveShadow ?? true;
        group.add(result.mesh);
        leaves = result.mesh;
        materialSet.add(result.material);
        drawCalls++; // One draw call for all instances!
        leafInstanceCount = result.instanceCount;
        vertexCount += 4; // Single card geometry
        triangleCount += 2 * result.instanceCount;
      }
    } else {
      // Legacy: Non-instanced rendering (more draw calls, more memory)
      if (hasBlossoms && options.blossomMaterial) {
        const { leaves: leafGeometry, blossoms: blossomGeometry } =
          generateSeparateLeafGeometry(
            data.leaves,
            data.params,
            data.treeScale,
            maxLeaves,
          );

        const leafMaterial =
          options.leafMaterial ?? createDefaultLeafMaterial();
        materialSet.add(leafMaterial);
        const leafMesh = new THREE.Mesh(leafGeometry, leafMaterial);
        leafMesh.name = "Leaves";
        leafMesh.castShadow = options.castShadow ?? true;
        leafMesh.receiveShadow = options.receiveShadow ?? true;
        group.add(leafMesh);
        leaves = leafMesh;
        drawCalls++;

        const leafPosAttr = leafGeometry.getAttribute("position");
        const leafIndexAttr = leafGeometry.getIndex();
        if (leafPosAttr) vertexCount += leafPosAttr.count;
        if (leafIndexAttr) triangleCount += leafIndexAttr.count / 3;

        materialSet.add(options.blossomMaterial);
        const blossomMesh = new THREE.Mesh(
          blossomGeometry,
          options.blossomMaterial,
        );
        blossomMesh.name = "Blossoms";
        blossomMesh.castShadow = options.castShadow ?? true;
        blossomMesh.receiveShadow = options.receiveShadow ?? true;
        group.add(blossomMesh);
        blossoms = blossomMesh;
        drawCalls++;

        const blossomPosAttr = blossomGeometry.getAttribute("position");
        const blossomIndexAttr = blossomGeometry.getIndex();
        if (blossomPosAttr) vertexCount += blossomPosAttr.count;
        if (blossomIndexAttr) triangleCount += blossomIndexAttr.count / 3;
      } else {
        const geometry = generateLeafGeometry(
          data.leaves,
          data.params,
          data.treeScale,
          maxLeaves,
        );

        const material = options.leafMaterial ?? createDefaultLeafMaterial();
        materialSet.add(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Leaves";
        mesh.castShadow = options.castShadow ?? true;
        mesh.receiveShadow = options.receiveShadow ?? true;
        group.add(mesh);
        leaves = mesh;
        drawCalls++;

        const posAttr = geometry.getAttribute("position");
        const indexAttr = geometry.getIndex();
        if (posAttr) vertexCount += posAttr.count;
        if (indexAttr) triangleCount += indexAttr.count / 3;
      }
    }
  }

  materialCount = materialSet.size;

  return {
    group,
    branches,
    leaves,
    blossoms,
    vertexCount,
    triangleCount,
    drawCalls,
    materialCount,
    instancedLeaves,
    leafInstanceCount,
  };
}

/**
 * Create a default branch material.
 */
export function createDefaultBranchMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x4a3728,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Create a default leaf material.
 */
export function createDefaultLeafMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x3d7a3d,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Create a default blossom material.
 */
export function createDefaultBlossomMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffc0cb,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/**
 * Dispose of all geometries and materials in a tree mesh result.
 *
 * @param result - Tree mesh result to dispose
 */
export function disposeTreeMesh(result: TreeMeshResult): void {
  for (const mesh of result.branches) {
    mesh.geometry.dispose();
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose();
    } else if (Array.isArray(mesh.material)) {
      for (const mat of mesh.material) {
        mat.dispose();
      }
    }
  }

  if (result.leaves) {
    result.leaves.geometry.dispose();
    if (result.leaves.material instanceof THREE.Material) {
      result.leaves.material.dispose();
    }
    // Dispose instanced mesh resources
    if (result.leaves instanceof THREE.InstancedMesh) {
      result.leaves.dispose();
    }
  }

  if (result.blossoms) {
    result.blossoms.geometry.dispose();
    if (result.blossoms.material instanceof THREE.Material) {
      result.blossoms.material.dispose();
    }
    if (result.blossoms instanceof THREE.InstancedMesh) {
      result.blossoms.dispose();
    }
  }

  result.group.clear();
}

// Re-export instanced leaf utilities
export { createInstancedLeafMaterial } from "../geometry/LeafGeometry.js";
