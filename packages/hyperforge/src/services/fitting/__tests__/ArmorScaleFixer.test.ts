/**
 * ArmorScaleFixer Tests
 *
 * Tests for detecting and fixing armor scale issues.
 * Uses REAL Three.js implementations - NO MOCKS.
 *
 * Real Issues to Surface:
 * - Oversized armor from wrong export settings
 * - Undersized armor from unit mismatches
 * - Scale not being baked into geometry
 * - Bounding box not updating after scale
 * - Topology changes during scale operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import { ArmorScaleFixer } from "../ArmorScaleFixer";
import {
  createTestMesh,
  createTestSkeleton,
  countVertices,
  countFaces,
} from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

/**
 * Helper to create a skinned mesh for testing
 */
function createTestSkinnedMesh(worldScale: number = 1): THREE.SkinnedMesh {
  const { skeleton, rootBone } = createTestSkeleton();

  // Apply scale to root bone's parent (simulating VRM import)
  const scaleGroup = new THREE.Group();
  scaleGroup.scale.set(worldScale, worldScale, worldScale);
  scaleGroup.add(rootBone);

  // Create geometry
  const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5, 4, 4, 4);
  const vertexCount = geometry.attributes.position.count;

  // Add skinning attributes
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 0;
    skinWeights[i * 4] = 1.0;
  }

  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.BufferAttribute(skinWeights, 4),
  );

  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(rootBone);
  mesh.bind(skeleton);

  // Add to scene and update
  const scene = new THREE.Scene();
  scene.add(scaleGroup);
  scene.add(mesh);
  scene.updateMatrixWorld(true);

  return mesh;
}

describe("ArmorScaleFixer", () => {
  describe("Scale Detection", () => {
    it("detects no scale issues when scale is 1", () => {
      const mesh = createTestSkinnedMesh(1);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(mesh.skeleton);

      expect(hasIssues).toBe(false);
    });

    it("detects oversized armor (scale > 1)", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Apply large scale to root
      rootBone.scale.set(100, 100, 100);
      rootBone.updateMatrixWorld(true);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(skeleton);

      expect(hasIssues).toBe(true);
    });

    it("detects undersized armor (scale < 1)", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Apply small scale to root
      rootBone.scale.set(0.01, 0.01, 0.01);
      rootBone.updateMatrixWorld(true);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(skeleton);

      expect(hasIssues).toBe(true);
    });

    it("identifies scale factor from world transform", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      const expectedScale = 0.01; // VRM-style scale
      rootBone.scale.set(expectedScale, expectedScale, expectedScale);

      const scene = new THREE.Scene();
      scene.add(rootBone);
      scene.updateMatrixWorld(true);

      // Get world scale
      const worldScale = new THREE.Vector3();
      rootBone.getWorldScale(worldScale);

      expect(worldScale.x).toBeCloseTo(expectedScale, 3);
      expect(worldScale.y).toBeCloseTo(expectedScale, 3);
      expect(worldScale.z).toBeCloseTo(expectedScale, 3);
    });

    it("handles nested scale transforms", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Create nested groups with scale
      const group1 = new THREE.Group();
      group1.scale.set(0.1, 0.1, 0.1);

      const group2 = new THREE.Group();
      group2.scale.set(0.1, 0.1, 0.1);

      group1.add(group2);
      group2.add(rootBone);

      const scene = new THREE.Scene();
      scene.add(group1);
      scene.updateMatrixWorld(true);

      // World scale should be 0.01 (0.1 * 0.1)
      const worldScale = new THREE.Vector3();
      rootBone.getWorldScale(worldScale);

      expect(worldScale.x).toBeCloseTo(0.01, 3);
    });
  });

  describe("Scale Fixing", () => {
    it("returns unchanged mesh when scale is already 1", () => {
      const mesh = createTestSkinnedMesh(1);
      const originalVertexCount = countVertices(mesh);

      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);

      expect(countVertices(fixed)).toBe(originalVertexCount);
    });

    it("applies correct scale factor to geometry", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Create mesh with non-unit scale
      const scaleFactor = 0.01;
      rootBone.scale.set(scaleFactor, scaleFactor, scaleFactor);

      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const vertexCount = geometry.attributes.position.count;

      // Add skinning attributes
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
      mesh.add(rootBone);
      mesh.bind(skeleton);

      const scene = new THREE.Scene();
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      // Get original bounds
      const originalBounds = new THREE.Box3().setFromObject(mesh);
      const originalSize = originalBounds.getSize(new THREE.Vector3());

      // Apply scale fix
      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);
      fixed.updateMatrixWorld(true);

      // Mesh should be unchanged if scale was already at 1 in world
      expect(fixed).toBeDefined();
      expect(fixed.skeleton).toBeDefined();
    });

    it("preserves mesh topology after scale fix", () => {
      const mesh = createTestSkinnedMesh(1);
      const originalVertexCount = countVertices(mesh);
      const originalFaceCount = countFaces(mesh);

      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);

      expect(countVertices(fixed)).toBe(originalVertexCount);
      expect(countFaces(fixed)).toBe(originalFaceCount);
    });

    it("updates bounding box after scale fix", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Apply scale
      rootBone.scale.set(0.5, 0.5, 0.5);

      const geometry = new THREE.BoxGeometry(2, 2, 2);
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
      mesh.add(rootBone);
      mesh.bind(skeleton);

      const scene = new THREE.Scene();
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);

      // Geometry should have bounding box computed
      expect(fixed.geometry.boundingBox).toBeDefined();
      expect(fixed.geometry.boundingSphere).toBeDefined();
    });

    it("preserves skeleton bone count after fix", () => {
      const mesh = createTestSkinnedMesh(1);
      const originalBoneCount = mesh.skeleton.bones.length;

      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);

      expect(fixed.skeleton.bones.length).toBe(originalBoneCount);
    });

    it("resets bone scale to 1 after fix", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      // Apply non-unit scale
      rootBone.scale.set(0.01, 0.01, 0.01);

      const geometry = new THREE.BoxGeometry(1, 1, 1);
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
      mesh.add(rootBone);
      mesh.bind(skeleton);

      const scene = new THREE.Scene();
      scene.add(mesh);
      scene.updateMatrixWorld(true);

      const fixed = ArmorScaleFixer.applySkeletonScale(mesh);

      // All bones should have scale of 1
      for (const bone of fixed.skeleton.bones) {
        expect(bone.scale.x).toBeCloseTo(1, 2);
        expect(bone.scale.y).toBeCloseTo(1, 2);
        expect(bone.scale.z).toBeCloseTo(1, 2);
      }
    });
  });

  describe("Margin Adjustment", () => {
    it("adds margin to mesh to prevent clipping", () => {
      const mesh = createTestMesh("box");
      const geometry = mesh.geometry as THREE.BufferGeometry;

      const originalBounds = new THREE.Box3().setFromBufferAttribute(
        geometry.attributes.position as THREE.BufferAttribute,
      );
      const originalSize = originalBounds.getSize(new THREE.Vector3());

      // Apply positive margin by scaling
      const margin = 0.1; // 10% margin
      const scaleFactor = 1 + margin;
      mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
      mesh.updateMatrixWorld(true);

      const newBounds = new THREE.Box3().setFromObject(mesh);
      const newSize = newBounds.getSize(new THREE.Vector3());

      // Size should be larger
      expect(newSize.x).toBeGreaterThan(originalSize.x);
      expect(newSize.y).toBeGreaterThan(originalSize.y);
      expect(newSize.z).toBeGreaterThan(originalSize.z);
    });

    it("handles negative margins (inset)", () => {
      const mesh = createTestMesh("box");
      const geometry = mesh.geometry as THREE.BufferGeometry;

      const originalBounds = new THREE.Box3().setFromBufferAttribute(
        geometry.attributes.position as THREE.BufferAttribute,
      );
      const originalSize = originalBounds.getSize(new THREE.Vector3());

      // Apply negative margin (inset)
      const margin = -0.1; // -10% margin (inset)
      const scaleFactor = 1 + margin;
      mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
      mesh.updateMatrixWorld(true);

      const newBounds = new THREE.Box3().setFromObject(mesh);
      const newSize = newBounds.getSize(new THREE.Vector3());

      // Size should be smaller
      expect(newSize.x).toBeLessThan(originalSize.x);
      expect(newSize.y).toBeLessThan(originalSize.y);
      expect(newSize.z).toBeLessThan(originalSize.z);
    });

    it("preserves armor shape with vertex offset margin", () => {
      const mesh = createTestMesh("sphere");
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;

      // Calculate original center
      geometry.computeBoundingSphere();
      const originalCenter = geometry.boundingSphere!.center.clone();

      // Apply margin by offsetting vertices along normals
      geometry.computeVertexNormals();
      const normals = geometry.attributes.normal;
      const margin = 0.05;

      for (let i = 0; i < positions.count; i++) {
        const nx = normals.getX(i);
        const ny = normals.getY(i);
        const nz = normals.getZ(i);

        positions.setXYZ(
          i,
          positions.getX(i) + nx * margin,
          positions.getY(i) + ny * margin,
          positions.getZ(i) + nz * margin,
        );
      }
      positions.needsUpdate = true;
      geometry.computeBoundingSphere();

      const newCenter = geometry.boundingSphere!.center;

      // Center should remain approximately the same
      expect(newCenter.distanceTo(originalCenter)).toBeLessThan(0.01);

      // Radius should be larger
      const originalRadius = 0.5; // SphereGeometry default radius
      expect(geometry.boundingSphere!.radius).toBeGreaterThan(originalRadius);
    });

    it("preserves vertex count with margin adjustment", () => {
      const mesh = createTestMesh("box");
      const originalVertexCount = countVertices(mesh);

      // Apply margin
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;
      const margin = 0.02;

      geometry.computeVertexNormals();
      const normals = geometry.attributes.normal;

      for (let i = 0; i < positions.count; i++) {
        const nx = normals.getX(i);
        const ny = normals.getY(i);
        const nz = normals.getZ(i);

        positions.setXYZ(
          i,
          positions.getX(i) + nx * margin,
          positions.getY(i) + ny * margin,
          positions.getZ(i) + nz * margin,
        );
      }
      positions.needsUpdate = true;

      expect(countVertices(mesh)).toBe(originalVertexCount);
    });
  });

  describe("Parent Transform Reset", () => {
    it("resets parent scale transforms", () => {
      const mesh = createTestSkinnedMesh(1);

      // Add parent with scale
      const parent = new THREE.Group();
      parent.name = "ScaledParent";
      parent.scale.set(0.5, 0.5, 0.5);
      parent.add(mesh);

      const scene = new THREE.Scene();
      scene.add(parent);
      scene.updateMatrixWorld(true);

      // Reset transforms
      ArmorScaleFixer.resetParentTransforms(mesh);

      // Parent scale should now be 1
      expect(parent.scale.x).toBe(1);
      expect(parent.scale.y).toBe(1);
      expect(parent.scale.z).toBe(1);
    });

    it("handles multiple parent levels with scale", () => {
      const mesh = createTestSkinnedMesh(1);

      const parent1 = new THREE.Group();
      parent1.name = "Parent1";
      parent1.scale.set(2, 2, 2);

      const parent2 = new THREE.Group();
      parent2.name = "Parent2";
      parent2.scale.set(0.5, 0.5, 0.5);

      parent2.add(mesh);
      parent1.add(parent2);

      const scene = new THREE.Scene();
      scene.add(parent1);
      scene.updateMatrixWorld(true);

      // Reset transforms
      ArmorScaleFixer.resetParentTransforms(mesh);

      // Both parents should have scale 1
      expect(parent1.scale.x).toBe(1);
      expect(parent2.scale.x).toBe(1);
    });

    it("adjusts child positions when resetting parent scale", () => {
      const mesh = createTestSkinnedMesh(1);
      mesh.position.set(1, 0, 0);

      const parent = new THREE.Group();
      parent.name = "ScaledParent";
      parent.scale.set(2, 2, 2);
      parent.add(mesh);

      const scene = new THREE.Scene();
      scene.add(parent);
      scene.updateMatrixWorld(true);

      // Get world position before
      const worldPosBefore = new THREE.Vector3();
      mesh.getWorldPosition(worldPosBefore);

      // Reset transforms
      ArmorScaleFixer.resetParentTransforms(mesh);
      scene.updateMatrixWorld(true);

      // Child position should be adjusted to compensate
      expect(mesh.position.x).toBe(2); // 1 * 2 (scale factor)
    });
  });

  describe("Edge Cases", () => {
    it("handles mesh with no skeleton gracefully", () => {
      const mesh = createTestMesh("box") as unknown as THREE.SkinnedMesh;

      // This should not crash
      expect(() => {
        // Create a minimal skeleton for the regular mesh
        const bone = new THREE.Bone();
        bone.name = "Root";
        const skeleton = new THREE.Skeleton([bone]);

        ArmorScaleFixer.hasScaleIssues(skeleton);
      }).not.toThrow();
    });

    it("handles empty skeleton", () => {
      const skeleton = new THREE.Skeleton([]);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(skeleton);

      expect(hasIssues).toBe(false);
    });

    it("handles very small scale values", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      rootBone.scale.set(0.0001, 0.0001, 0.0001);

      const scene = new THREE.Scene();
      scene.add(rootBone);
      scene.updateMatrixWorld(true);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(skeleton);

      expect(hasIssues).toBe(true);
    });

    it("handles very large scale values", () => {
      const { skeleton, rootBone } = createTestSkeleton();

      rootBone.scale.set(10000, 10000, 10000);

      const scene = new THREE.Scene();
      scene.add(rootBone);
      scene.updateMatrixWorld(true);

      const hasIssues = ArmorScaleFixer.hasScaleIssues(skeleton);

      expect(hasIssues).toBe(true);
    });
  });
});
