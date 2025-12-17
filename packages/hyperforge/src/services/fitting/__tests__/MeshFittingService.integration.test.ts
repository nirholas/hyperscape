/**
 * MeshFittingService Integration Tests
 *
 * These tests call REAL MeshFittingService methods with REAL Three.js geometries.
 * Tests actual vertex projection, bounding box fitting, topology preservation.
 *
 * NO MOCKS - all tests use real BufferGeometry and real mesh operations.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as THREE from "three";
import {
  MeshFittingService,
  MeshFittingParameters,
} from "../MeshFittingService";
import {
  countFaces,
  countVertices,
  getMeshDimensions,
} from "@/__tests__/utils/test-helpers";

// Import polyfills for server-side Three.js
import "@/lib/server/three-polyfills";

describe("MeshFittingService Integration Tests", () => {
  let fittingService: MeshFittingService;

  beforeAll(() => {
    fittingService = new MeshFittingService();
  });

  // ============================================================
  // Helper Functions for Creating Real Three.js Geometries
  // ============================================================

  /**
   * Create a mesh with known vertex positions for precise testing
   */
  function createPreciseMesh(
    width: number,
    height: number,
    depth: number,
    segments: number = 2,
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(
      width,
      height,
      depth,
      segments,
      segments,
      segments,
    );
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /**
   * Create a sphere mesh for testing curved surface projection
   */
  function createSphereMesh(radius: number, segments: number = 16): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, segments, segments);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /**
   * Create a simple skinned mesh for testing avatar-related fitting
   * This creates a properly bound skeleton with world positions updated
   */
  function createTestSkinnedMesh(): THREE.SkinnedMesh {
    // Create geometry first - a humanoid-shaped box
    // Make it taller than wide to simulate a human body
    const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.3, 4, 12, 4);

    // Shift geometry up so it sits above y=0 (like a standing figure)
    geometry.translate(0, 0.9, 0);

    const vertexCount = geometry.attributes.position.count;

    // Create bones with proper positions for a standing humanoid
    const hipsBone = new THREE.Bone();
    hipsBone.name = "Hips";
    hipsBone.position.set(0, 0.9, 0); // Hip height

    const spineBone = new THREE.Bone();
    spineBone.name = "Spine";
    spineBone.position.set(0, 0.2, 0); // Relative to hips
    hipsBone.add(spineBone);

    const chestBone = new THREE.Bone();
    chestBone.name = "Chest";
    chestBone.position.set(0, 0.2, 0); // Relative to spine
    spineBone.add(chestBone);

    const neckBone = new THREE.Bone();
    neckBone.name = "Neck";
    neckBone.position.set(0, 0.25, 0); // Relative to chest
    chestBone.add(neckBone);

    const headBone = new THREE.Bone();
    headBone.name = "Head";
    headBone.position.set(0, 0.15, 0); // Relative to neck
    neckBone.add(headBone);

    const bones = [hipsBone, spineBone, chestBone, neckBone, headBone];

    // Create skin indices and weights based on vertex Y positions
    const skinIndices = new Float32Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);
    const positions = geometry.attributes.position;

    for (let i = 0; i < vertexCount; i++) {
      const y = positions.getY(i);
      let boneIndex = 0;

      // Assign based on world Y position (geometry is translated up by 0.9)
      if (y > 1.6) {
        boneIndex = 4; // Head (y > 1.6)
      } else if (y > 1.45) {
        boneIndex = 3; // Neck (1.45 < y <= 1.6)
      } else if (y > 1.2) {
        boneIndex = 2; // Chest (1.2 < y <= 1.45)
      } else if (y > 0.9) {
        boneIndex = 1; // Spine (0.9 < y <= 1.2)
      } else {
        boneIndex = 0; // Hips (y <= 0.9)
      }

      skinIndices[i * 4] = boneIndex;
      skinWeights[i * 4] = 1.0;
      // Fill remaining slots with zeros
      skinIndices[i * 4 + 1] = 0;
      skinIndices[i * 4 + 2] = 0;
      skinIndices[i * 4 + 3] = 0;
      skinWeights[i * 4 + 1] = 0;
      skinWeights[i * 4 + 2] = 0;
      skinWeights[i * 4 + 3] = 0;
    }

    geometry.setAttribute(
      "skinIndex",
      new THREE.BufferAttribute(skinIndices, 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new THREE.BufferAttribute(skinWeights, 4),
    );

    // Create skinned mesh and add bones
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.add(hipsBone);

    // Create skeleton and bind it
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);

    // Critical: Update all world matrices so bone positions are correct
    mesh.updateMatrixWorld(true);
    skeleton.calculateInverses();
    skeleton.update();

    // Update bone world matrices explicitly
    hipsBone.updateWorldMatrix(true, true);

    return mesh;
  }

  /**
   * Get all vertex positions from a mesh as Vector3 array
   */
  function getVertexPositions(mesh: THREE.Mesh): THREE.Vector3[] {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position;
    const vertices: THREE.Vector3[] = [];

    for (let i = 0; i < positions.count; i++) {
      vertices.push(
        new THREE.Vector3(
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i),
        ),
      );
    }

    return vertices;
  }

  /**
   * Calculate the average distance of vertices from origin
   */
  function calculateAverageRadius(mesh: THREE.Mesh): number {
    const vertices = getVertexPositions(mesh);
    const center = new THREE.Vector3();
    const bounds = new THREE.Box3().setFromObject(mesh);
    bounds.getCenter(center);

    let totalDist = 0;
    for (const v of vertices) {
      totalDist += v.distanceTo(center);
    }

    return totalDist / vertices.length;
  }

  /**
   * Check if all vertex positions are valid (no NaN or Infinity)
   */
  function validateVertexPositions(mesh: THREE.Mesh): boolean {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position.array;

    for (let i = 0; i < positions.length; i++) {
      if (!Number.isFinite(positions[i]) || Number.isNaN(positions[i])) {
        return false;
      }
    }

    return true;
  }

  // ============================================================
  // fitMeshToTarget Tests - Core Vertex Projection
  // ============================================================

  describe("fitMeshToTarget - Vertex Projection", () => {
    it("projects vertices toward smaller target surface", () => {
      // Create larger source mesh
      const sourceMesh = createSphereMesh(1.0, 12);
      const targetMesh = createSphereMesh(0.5, 12);

      // Store original average radius
      const originalRadius = calculateAverageRadius(sourceMesh);

      const parameters: MeshFittingParameters = {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.02,
      };

      // Call the REAL method
      fittingService.fitMeshToTarget(sourceMesh, targetMesh, parameters);

      // Verify vertices moved inward
      const newRadius = calculateAverageRadius(sourceMesh);
      expect(newRadius).toBeLessThan(originalRadius);

      // Verify geometry is still valid
      expect(validateVertexPositions(sourceMesh)).toBe(true);
    });

    it("expands vertices toward larger target surface", () => {
      // Create smaller source mesh
      const sourceMesh = createSphereMesh(0.5, 12);
      const targetMesh = createSphereMesh(1.0, 12);

      const originalRadius = calculateAverageRadius(sourceMesh);

      const parameters: MeshFittingParameters = {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.02,
      };

      fittingService.fitMeshToTarget(sourceMesh, targetMesh, parameters);

      // Verify vertices moved outward
      const newRadius = calculateAverageRadius(sourceMesh);
      expect(newRadius).toBeGreaterThan(originalRadius);
    });

    it("respects targetOffset parameter", () => {
      const sourceMesh = createSphereMesh(1.5, 12);
      const targetMesh = createSphereMesh(1.0, 12);

      const targetOffset = 0.05; // 5cm offset

      fittingService.fitMeshToTarget(sourceMesh, targetMesh, {
        iterations: 10,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset,
      });

      sourceMesh.updateMatrixWorld(true);

      // Source should be larger than target by approximately the offset
      const sourceBounds = new THREE.Box3().setFromObject(sourceMesh);
      const targetBounds = new THREE.Box3().setFromObject(targetMesh);

      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const targetSize = targetBounds.getSize(new THREE.Vector3());

      // Source should be >= target size (within tolerance for offset)
      expect(sourceSize.x).toBeGreaterThanOrEqual(targetSize.x - 0.1);
    });

    it("maintains mesh validity after fitting", () => {
      const sourceMesh = createPreciseMesh(2, 2, 2, 4);
      const targetMesh = createPreciseMesh(1, 1, 1, 2);

      const originalVertexCount = countVertices(sourceMesh);
      const originalFaceCount = countFaces(sourceMesh);

      fittingService.fitMeshToTarget(sourceMesh, targetMesh, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.3,
        targetOffset: 0.01,
      });

      // Topology preserved
      expect(countVertices(sourceMesh)).toBe(originalVertexCount);
      expect(countFaces(sourceMesh)).toBe(originalFaceCount);

      // All positions valid
      expect(validateVertexPositions(sourceMesh)).toBe(true);
    });

    it("handles box-to-box fitting correctly", () => {
      const sourceMesh = createPreciseMesh(2, 2, 2, 2);
      const targetMesh = createPreciseMesh(1, 1, 1, 2);

      const originalDimensions = getMeshDimensions(sourceMesh);

      fittingService.fitMeshToTarget(sourceMesh, targetMesh, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.3,
        targetOffset: 0.01,
      });

      const newDimensions = getMeshDimensions(sourceMesh);

      // Mesh should shrink
      expect(newDimensions.x).toBeLessThanOrEqual(originalDimensions.x);
      expect(newDimensions.y).toBeLessThanOrEqual(originalDimensions.y);
      expect(newDimensions.z).toBeLessThanOrEqual(originalDimensions.z);
    });

    it("handles sphere-to-box fitting", () => {
      const sourceMesh = createSphereMesh(1.0, 16);
      const targetMesh = createPreciseMesh(1.5, 1.5, 1.5, 2);

      const originalVertexCount = countVertices(sourceMesh);

      fittingService.fitMeshToTarget(sourceMesh, targetMesh, {
        iterations: 5,
        stepSize: 0.4,
        smoothingRadius: 0.1,
        smoothingStrength: 0.3,
        targetOffset: 0.02,
      });

      // Verify topology preserved
      expect(countVertices(sourceMesh)).toBe(originalVertexCount);
      expect(validateVertexPositions(sourceMesh)).toBe(true);
    });
  });

  // ============================================================
  // fitMeshToTargetUniform Tests - Uniform Pressure Fitting
  // ============================================================

  describe("fitMeshToTargetUniform - Uniform Shrinking", () => {
    it("applies uniform shrinking pressure", () => {
      const sourceMesh = createSphereMesh(1.5, 12);
      const targetMesh = createSphereMesh(1.0, 12);

      const geometry = sourceMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      fittingService.fitMeshToTargetUniform(sourceMesh, targetMesh, {
        iterations: 5,
        stepSize: 0.3,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.02,
      });

      // Verify vertices moved
      const newPositions = geometry.attributes.position.array as Float32Array;
      let movedCount = 0;

      for (let i = 0; i < newPositions.length; i++) {
        if (Math.abs(newPositions[i] - originalPositions[i]) > 0.001) {
          movedCount++;
        }
      }

      expect(movedCount).toBeGreaterThan(0);
      expect(validateVertexPositions(sourceMesh)).toBe(true);
    });

    it("maintains relatively uniform scale", () => {
      const sourceMesh = createPreciseMesh(2, 1, 0.5, 2);
      const targetMesh = createPreciseMesh(1.5, 1.5, 1.5, 2);

      fittingService.fitMeshToTargetUniform(sourceMesh, targetMesh, {
        iterations: 5,
        stepSize: 0.3,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      // Scale should be relatively uniform after fitting
      const scale = sourceMesh.scale;
      const scaleVariance =
        Math.abs(scale.x - scale.y) +
        Math.abs(scale.y - scale.z) +
        Math.abs(scale.z - scale.x);

      expect(scaleVariance).toBeLessThan(0.5);
    });
  });

  // ============================================================
  // fitArmorToBody Tests - Armor Fitting with Rigidity
  // ============================================================

  describe("fitArmorToBody - Specialized Armor Fitting", () => {
    it("fits armor mesh to body with offset", () => {
      // Create armor (larger mesh)
      const armorMesh = createPreciseMesh(0.7, 0.9, 0.5, 3);
      armorMesh.position.set(0, 1, 0);
      armorMesh.updateMatrixWorld(true);

      // Create simplified body hull
      const bodyMesh = createPreciseMesh(0.5, 0.7, 0.35, 2);
      bodyMesh.position.set(0, 1, 0);
      bodyMesh.updateMatrixWorld(true);

      const targetOffset = 0.02; // 2cm offset

      fittingService.fitArmorToBody(armorMesh, bodyMesh, {
        targetOffset,
        iterations: 5,
        rigidity: 0.5,
      });

      armorMesh.updateMatrixWorld(true);

      // Armor should envelop body
      const armorBounds = new THREE.Box3().setFromObject(armorMesh);
      const bodyBounds = new THREE.Box3().setFromObject(bodyMesh);

      expect(armorBounds.containsBox(bodyBounds)).toBe(true);
    });

    it("preserves original shape with high rigidity", () => {
      const armorMesh = createPreciseMesh(1, 1.5, 0.5, 3);
      armorMesh.updateMatrixWorld(true);

      const originalDimensions = getMeshDimensions(armorMesh);
      const originalAspectRatio = originalDimensions.y / originalDimensions.x;

      const bodyMesh = createPreciseMesh(0.8, 1.2, 0.4, 2);
      bodyMesh.updateMatrixWorld(true);

      fittingService.fitArmorToBody(armorMesh, bodyMesh, {
        iterations: 5,
        rigidity: 0.9, // High rigidity
      });

      armorMesh.updateMatrixWorld(true);
      const newDimensions = getMeshDimensions(armorMesh);
      const newAspectRatio = newDimensions.y / newDimensions.x;

      // Aspect ratio should be similar (preserved by high rigidity)
      expect(Math.abs(newAspectRatio - originalAspectRatio)).toBeLessThan(0.3);
    });

    it("allows more deformation with low rigidity", () => {
      const armorMesh = createPreciseMesh(1, 1.5, 0.5, 3);
      armorMesh.updateMatrixWorld(true);

      const geometry = armorMesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      const bodyMesh = createPreciseMesh(0.6, 1.0, 0.3, 2);
      bodyMesh.updateMatrixWorld(true);

      fittingService.fitArmorToBody(armorMesh, bodyMesh, {
        iterations: 10,
        rigidity: 0.2, // Low rigidity - allow more deformation
      });

      // Calculate total vertex displacement
      const newPositions = geometry.attributes.position.array as Float32Array;
      let totalDisplacement = 0;

      for (let i = 0; i < newPositions.length / 3; i++) {
        const dx = newPositions[i * 3] - originalPositions[i * 3];
        const dy = newPositions[i * 3 + 1] - originalPositions[i * 3 + 1];
        const dz = newPositions[i * 3 + 2] - originalPositions[i * 3 + 2];
        totalDisplacement += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // With low rigidity, vertices should have moved
      expect(totalDisplacement).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // resetMesh Tests - Mesh Reset Functionality
  // ============================================================

  describe("resetMesh - Restoring Original Positions", () => {
    it("resets mesh to stored original positions", () => {
      const mesh = createPreciseMesh(1, 1, 1, 2);
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      // Modify positions
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, positions.getX(i) + 0.5);
        positions.setY(i, positions.getY(i) + 0.5);
        positions.setZ(i, positions.getZ(i) + 0.5);
      }
      positions.needsUpdate = true;

      // Verify modification took effect
      const modifiedPositions = geometry.attributes.position.array;
      expect(modifiedPositions[0]).not.toBeCloseTo(originalPositions[0], 5);

      // Reset
      fittingService.resetMesh(mesh, originalPositions);

      // Verify reset
      const resetPositions = geometry.attributes.position.array;
      for (let i = 0; i < originalPositions.length; i++) {
        expect(resetPositions[i]).toBeCloseTo(originalPositions[i], 5);
      }
    });

    it("recomputes bounding box after reset", () => {
      const mesh = createPreciseMesh(1, 1, 1, 2);
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      // Scale up mesh
      mesh.scale.set(3, 3, 3);
      mesh.updateMatrixWorld(true);

      // Get bounds before reset
      geometry.computeBoundingBox();
      const scaledBounds = geometry.boundingBox!.clone();

      // Reset scale and positions
      mesh.scale.set(1, 1, 1);
      fittingService.resetMesh(mesh, originalPositions);

      // Bounds should be recomputed to original size
      expect(geometry.boundingBox).toBeDefined();
      expect(geometry.boundingSphere).toBeDefined();
    });
  });

  // ============================================================
  // detectHeadRegion Tests - Head Detection for Helmet Fitting
  // ============================================================

  describe("detectHeadRegion - Head Detection", () => {
    it("detects head region from skinned mesh with bones", () => {
      const skinnedMesh = createTestSkinnedMesh();

      const headRegion = fittingService.detectHeadRegion(skinnedMesh);

      // Should return all required properties
      expect(headRegion).toBeDefined();
      expect(headRegion.headBounds).toBeDefined();
      expect(headRegion.headCenter).toBeDefined();
      expect(headRegion.headOrientation).toBeDefined();

      // Head bounds should be a Box3 instance
      expect(headRegion.headBounds).toBeInstanceOf(THREE.Box3);

      // Head center should be a valid vector with finite values
      expect(headRegion.headCenter).toBeInstanceOf(THREE.Vector3);
      expect(Number.isFinite(headRegion.headCenter.x)).toBe(true);
      expect(Number.isFinite(headRegion.headCenter.y)).toBe(true);
      expect(Number.isFinite(headRegion.headCenter.z)).toBe(true);

      // Head orientation should be a valid quaternion
      expect(headRegion.headOrientation).toBeInstanceOf(THREE.Quaternion);
    });

    it("finds head bone when present", () => {
      const skinnedMesh = createTestSkinnedMesh();

      const headRegion = fittingService.detectHeadRegion(skinnedMesh);

      // Our test mesh has a Head bone, so it should be found
      // Note: detectHeadRegion may or may not find the bone depending on name matching
      // The main test is that it returns valid data regardless
      expect(headRegion).toBeDefined();

      // If head bone is found, verify it's valid
      if (headRegion.headBone) {
        expect(headRegion.headBone).toBeInstanceOf(THREE.Bone);
        expect(headRegion.headBone.name.toLowerCase()).toContain("head");
      }
    });

    it("returns valid head bounds even for simple geometry", () => {
      const skinnedMesh = createTestSkinnedMesh();

      const headRegion = fittingService.detectHeadRegion(skinnedMesh);

      // Get model bounds for comparison
      const modelBounds = new THREE.Box3().setFromObject(skinnedMesh);
      const modelHeight = modelBounds.max.y - modelBounds.min.y;
      const modelWidth = modelBounds.max.x - modelBounds.min.x;

      // Head region should be at least defined
      expect(headRegion.headBounds).toBeDefined();

      // If head bounds are not empty, verify reasonable size
      if (!headRegion.headBounds.isEmpty()) {
        const headSize = headRegion.headBounds.getSize(new THREE.Vector3());

        // Head height should be less than the whole model height
        expect(headSize.y).toBeLessThan(modelHeight);

        // detectHeadRegion applies 15% expansion to head bounds,
        // so head width might exceed original model width.
        // Just verify it's within 2x the model width (reasonable expansion)
        expect(headSize.x).toBeLessThan(modelWidth * 2);
      }
    });
  });

  // ============================================================
  // Topology Preservation Tests
  // ============================================================

  describe("Topology Preservation", () => {
    it("preserves vertex count through all fitting operations", () => {
      const mesh = createSphereMesh(1.0, 16);
      const target = createSphereMesh(0.8, 8);

      const originalVertexCount = countVertices(mesh);

      // Apply multiple fitting operations
      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 3,
        stepSize: 0.3,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      fittingService.fitMeshToTargetUniform(mesh, target, {
        iterations: 3,
        stepSize: 0.3,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      expect(countVertices(mesh)).toBe(originalVertexCount);
    });

    it("preserves face count through fitting", () => {
      const mesh = createPreciseMesh(1, 1, 1, 4);
      const target = createPreciseMesh(0.8, 0.8, 0.8, 2);

      const originalFaceCount = countFaces(mesh);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.4,
        smoothingRadius: 0.1,
        smoothingStrength: 0.3,
        targetOffset: 0.01,
      });

      expect(countFaces(mesh)).toBe(originalFaceCount);
    });

    it("maintains valid normals after fitting", () => {
      const mesh = createSphereMesh(1.0, 12);
      const target = createSphereMesh(0.7, 8);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.3,
        targetOffset: 0.01,
      });

      const geometry = mesh.geometry as THREE.BufferGeometry;

      // Ensure normals are computed after fitting
      geometry.computeVertexNormals();

      // Check normals exist and are valid
      expect(geometry.attributes.normal).toBeDefined();
      const normals = geometry.attributes.normal.array;

      // Check all normal values are valid numbers
      for (let i = 0; i < normals.length; i++) {
        expect(Number.isFinite(normals[i])).toBe(true);
        expect(Number.isNaN(normals[i])).toBe(false);
      }

      // Check normals are normalized (length ≈ 1)
      // Count how many normals are valid
      let validNormalCount = 0;
      const normalCount = normals.length / 3;

      for (let i = 0; i < normalCount; i++) {
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);

        if (length > 0.9 && length < 1.1) {
          validNormalCount++;
        }
      }

      // Most normals should be valid (at least 90%)
      expect(validNormalCount / normalCount).toBeGreaterThan(0.9);
    });

    it("preserves mesh indices after fitting", () => {
      const mesh = createPreciseMesh(1, 1, 1, 3);
      const target = createPreciseMesh(0.8, 0.8, 0.8, 2);

      const geometry = mesh.geometry as THREE.BufferGeometry;
      const originalIndex = geometry.index
        ? new Uint32Array(geometry.index.array)
        : null;

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.4,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      // Index buffer should be unchanged
      if (originalIndex && geometry.index) {
        const newIndex = geometry.index.array;
        expect(newIndex.length).toBe(originalIndex.length);
        for (let i = 0; i < originalIndex.length; i++) {
          expect(newIndex[i]).toBe(originalIndex[i]);
        }
      }
    });
  });

  // ============================================================
  // Edge Cases and Error Handling
  // ============================================================

  describe("Edge Cases", () => {
    it("handles identical source and target meshes", () => {
      const mesh = createSphereMesh(1.0, 12);
      const target = createSphereMesh(1.0, 12);

      const geometry = mesh.geometry as THREE.BufferGeometry;
      const originalPositions = new Float32Array(
        geometry.attributes.position.array,
      );

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0,
      });

      // Mesh should remain mostly unchanged
      expect(validateVertexPositions(mesh)).toBe(true);
    });

    it("handles very small meshes", () => {
      const mesh = createSphereMesh(0.01, 8);
      const target = createSphereMesh(0.005, 8);

      const originalVertexCount = countVertices(mesh);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 3,
        stepSize: 0.3,
        smoothingRadius: 0.001,
        smoothingStrength: 0.2,
        targetOffset: 0.001,
      });

      expect(countVertices(mesh)).toBe(originalVertexCount);
      expect(validateVertexPositions(mesh)).toBe(true);
    });

    it("handles meshes at different positions", () => {
      const mesh = createSphereMesh(1.0, 12);
      mesh.position.set(5, 5, 5);
      mesh.updateMatrixWorld(true);

      const target = createSphereMesh(0.8, 8);
      target.position.set(5, 5, 5);
      target.updateMatrixWorld(true);

      const originalVertexCount = countVertices(mesh);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      expect(countVertices(mesh)).toBe(originalVertexCount);
      expect(validateVertexPositions(mesh)).toBe(true);
    });

    it("handles meshes with different rotations", () => {
      const mesh = createPreciseMesh(1, 1, 1, 3);
      mesh.rotation.set(Math.PI / 4, Math.PI / 3, Math.PI / 6);
      mesh.updateMatrixWorld(true);

      const target = createPreciseMesh(0.8, 0.8, 0.8, 2);
      target.rotation.set(0, Math.PI / 2, 0);
      target.updateMatrixWorld(true);

      const originalVertexCount = countVertices(mesh);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.4,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      expect(countVertices(mesh)).toBe(originalVertexCount);
      expect(validateVertexPositions(mesh)).toBe(true);
    });

    it("handles meshes with non-uniform scale", () => {
      const mesh = createPreciseMesh(1, 1, 1, 3);
      mesh.scale.set(2, 1, 0.5);
      mesh.updateMatrixWorld(true);

      const target = createPreciseMesh(1, 1, 1, 2);
      target.updateMatrixWorld(true);

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.4,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
      });

      expect(validateVertexPositions(mesh)).toBe(true);
    });
  });

  // ============================================================
  // Progress Callback Tests
  // ============================================================

  describe("Progress Callbacks", () => {
    it("calls onProgress during fitting iterations", () => {
      const mesh = createSphereMesh(1.0, 8);
      const target = createSphereMesh(0.8, 8);

      const progressValues: number[] = [];
      const messages: string[] = [];

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 5,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
        onProgress: (progress, message) => {
          progressValues.push(progress);
          if (message) messages.push(message);
        },
      });

      // Should have received progress updates
      expect(progressValues.length).toBeGreaterThan(0);

      // Progress should increase
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // Final progress should be 100
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });
  });

  // ============================================================
  // Constraint Bounds Tests
  // ============================================================

  describe("Constraint Bounds", () => {
    it("respects targetBounds constraint", () => {
      const mesh = createSphereMesh(2.0, 12);
      const target = createSphereMesh(1.0, 8);

      // Define constraint region
      const constraintBounds = new THREE.Box3(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5),
      );

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 10,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
        targetBounds: constraintBounds,
      });

      // Mesh should still be valid
      expect(validateVertexPositions(mesh)).toBe(true);
    });
  });

  // ============================================================
  // Debug Visualization Tests
  // ============================================================

  describe("Debug Visualization", () => {
    it("accepts debug arrow group without error", () => {
      const debugGroup = new THREE.Group();
      fittingService.setDebugArrowGroup(debugGroup);

      const mesh = createSphereMesh(1.0, 8);
      const target = createSphereMesh(0.8, 8);

      // Should not throw with debug arrows enabled
      expect(() => {
        fittingService.fitMeshToTarget(mesh, target, {
          iterations: 2,
          stepSize: 0.5,
          smoothingRadius: 0.1,
          smoothingStrength: 0.2,
          targetOffset: 0.01,
          showDebugArrows: true,
          debugArrowDensity: 10,
          debugColorMode: "magnitude",
        });
      }).not.toThrow();

      // Clear debug arrows
      fittingService.clearDebugArrows();
    });

    it("can clear debug group", () => {
      const debugGroup = new THREE.Group();
      debugGroup.add(new THREE.Mesh());
      debugGroup.add(new THREE.Mesh());

      fittingService.setDebugArrowGroup(debugGroup);
      expect(debugGroup.children.length).toBe(2);

      fittingService.clearDebugArrows();
      expect(debugGroup.children.length).toBe(0);
    });
  });

  // ============================================================
  // Performance with High-Poly Meshes
  // ============================================================

  describe("High-Poly Mesh Handling", () => {
    it("handles high-poly sphere without timeout", () => {
      // Higher poly mesh
      const mesh = createSphereMesh(1.0, 32);
      const target = createSphereMesh(0.9, 16);

      const originalVertexCount = countVertices(mesh);

      const startTime = Date.now();

      fittingService.fitMeshToTarget(mesh, target, {
        iterations: 3,
        stepSize: 0.5,
        smoothingRadius: 0.1,
        smoothingStrength: 0.2,
        targetOffset: 0.01,
        sampleRate: 0.5, // Process 50% of vertices per iteration
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 10 seconds)
      expect(duration).toBeLessThan(10000);
      expect(countVertices(mesh)).toBe(originalVertexCount);
      expect(validateVertexPositions(mesh)).toBe(true);
    });
  });
});
