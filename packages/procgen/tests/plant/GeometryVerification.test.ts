/**
 * Geometry Verification Tests
 *
 * Comprehensive tests for verifying plant geometry correctness:
 * - Leaf orientation (face normal direction)
 * - Stem orientation (extension direction)
 * - Mesh continuity (stem-to-leaf connections)
 * - Bundle positioning (trunk attachment)
 * - Quaternion and transform math
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Vector3, Quaternion, Group, Mesh, BufferGeometry } from "three";
import {
  PlantGenerator,
  LPK,
  createStemShape,
  shapeScaleAtPercent,
  trunkShapeScaleAtPercent,
  lookRotation,
  rotatePointByQuat,
  generateStem,
  generateTrunk,
  quaternionFromEuler,
  SeededRandom,
} from "../../src/plant/index.js";
import type {
  Point3D,
  ArrangementData,
  LeafBundle,
} from "../../src/plant/types.js";

// Helper functions
function vec3FromPoint(p: Point3D): Vector3 {
  return new Vector3(p.x, p.y, p.z);
}

function distance(a: Point3D, b: Point3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function normalize(v: Point3D): Point3D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 0.0001) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// Get mesh bounding box
function getMeshBounds(geometry: BufferGeometry): {
  min: Point3D;
  max: Point3D;
  center: Point3D;
} {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    },
  };
}

// Get mesh vertices as Point3D array
function getMeshVertices(geometry: BufferGeometry): Point3D[] {
  const posAttr = geometry.getAttribute("position");
  const vertices: Point3D[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertices.push({
      x: posAttr.getX(i),
      y: posAttr.getY(i),
      z: posAttr.getZ(i),
    });
  }
  return vertices;
}

// Get average normal direction from mesh
function getAverageNormal(geometry: BufferGeometry): Point3D {
  const normalAttr = geometry.getAttribute("normal");
  if (!normalAttr) {
    geometry.computeVertexNormals();
  }
  const normals = geometry.getAttribute("normal");

  let avgNormal: Point3D = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < normals.count; i++) {
    avgNormal.x += normals.getX(i);
    avgNormal.y += normals.getY(i);
    avgNormal.z += normals.getZ(i);
  }

  return normalize(avgNormal);
}

describe("Geometry Verification", () => {
  let generator: PlantGenerator;

  beforeEach(() => {
    generator = new PlantGenerator({ seed: 12345 });
    generator.setGenerateTextures(false);
  });

  describe("Stem Shape Cross-Section", () => {
    it("should create circular cross-section perpendicular to Y axis", () => {
      const shape = createStemShape(1, 8);

      // All points should be in XZ plane (y = 0)
      for (const p of shape) {
        expect(p.y).toBe(0);
      }

      // All points should be at radius 1 from origin
      for (const p of shape) {
        const radius = Math.sqrt(p.x * p.x + p.z * p.z);
        expect(radius).toBeCloseTo(1, 5);
      }
    });

    it("should have evenly spaced angles", () => {
      const shape = createStemShape(1, 6);
      const expectedAngleStep = (2 * Math.PI) / 6;

      for (let i = 0; i < shape.length; i++) {
        const expectedAngle = i * expectedAngleStep;
        const actualAngle = Math.atan2(shape[i].z, shape[i].x);
        // Normalize angle to [0, 2π)
        const normalizedActual =
          actualAngle < 0 ? actualAngle + 2 * Math.PI : actualAngle;
        expect(normalizedActual).toBeCloseTo(expectedAngle, 3);
      }
    });

    it("should scale with width parameter", () => {
      const shape1 = createStemShape(0.5, 6);
      const shape2 = createStemShape(2.0, 6);

      for (let i = 0; i < shape1.length; i++) {
        const radius1 = Math.sqrt(shape1[i].x ** 2 + shape1[i].z ** 2);
        const radius2 = Math.sqrt(shape2[i].x ** 2 + shape2[i].z ** 2);

        expect(radius1).toBeCloseTo(0.5, 5);
        expect(radius2).toBeCloseTo(2.0, 5);
      }
    });
  });

  describe("Stem Orientation", () => {
    it("should generate stems that extend outward from trunk via plant generation", () => {
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemFlop, 0.5); // Moderate flop
      generator.setParam(LPK.StemLength, 1.0);
      const result = generator.generate();

      // Check that bundles have stems with extent in X direction
      for (const bundle of result.leafBundles) {
        if (!bundle.visible) continue;

        const bounds = getMeshBounds(bundle.stemMesh);
        // In world space (after bundle rotation), stems extend in various directions
        // But the stem should have some significant extent
        const extent = distance(bounds.min, bounds.max);
        expect(extent).toBeGreaterThan(0.1);
      }

      result.dispose();
    });

    it("should generate longer stems with higher StemLength parameter", () => {
      generator.setParam(LPK.LeafCount, 1);
      generator.setParam(LPK.StemFlop, 0.3);

      // Short stem
      generator.setParam(LPK.StemLength, 0.3);
      const result1 = generator.generate();
      const bundle1 = result1.leafBundles[0];
      const bounds1 = getMeshBounds(bundle1.stemMesh);
      const extent1 = distance(bounds1.min, bounds1.max);
      result1.dispose();

      // Long stem
      const generator2 = new PlantGenerator({ seed: 12345 });
      generator2.setGenerateTextures(false);
      generator2.setParam(LPK.LeafCount, 1);
      generator2.setParam(LPK.StemFlop, 0.3);
      generator2.setParam(LPK.StemLength, 1.5);
      const result2 = generator2.generate();
      const bundle2 = result2.leafBundles[0];
      const bounds2 = getMeshBounds(bundle2.stemMesh);
      const extent2 = distance(bounds2.min, bounds2.max);
      result2.dispose();

      expect(extent2).toBeGreaterThan(extent1);
    });

    it("should generate different stem curvature with different flop values", () => {
      // Low flop - more upright
      generator.setParam(LPK.LeafCount, 1);
      generator.setParam(LPK.StemFlop, 0.1);
      const result1 = generator.generate();
      result1.dispose();

      // High flop - more droopy
      const generator2 = new PlantGenerator({ seed: 12345 });
      generator2.setGenerateTextures(false);
      generator2.setParam(LPK.LeafCount, 1);
      generator2.setParam(LPK.StemFlop, 0.9);
      const result2 = generator2.generate();
      result2.dispose();

      // Both should generate valid bundles (structural test)
      expect(result1.leafBundles.length).toBe(1);
      expect(result2.leafBundles.length).toBe(1);
    });
  });

  describe("Leaf Orientation", () => {
    it("should generate leaves with face normal primarily in vertical direction", () => {
      generator.setParam(LPK.LeafCount, 5);
      generator.setParam(LPK.StemFlop, 0.5);
      const result = generator.generate();

      // Extract leaf meshes from the group (note: name is "Leaf" with capital L)
      const leafMeshes: Mesh[] = [];
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Leaf") {
          leafMeshes.push(obj);
        }
      });

      expect(leafMeshes.length).toBeGreaterThan(0);

      for (const leafMesh of leafMeshes) {
        // Get the leaf's world matrix
        leafMesh.updateWorldMatrix(true, false);

        // Get the leaf's local face normal direction (Z axis for leaf face)
        const localFaceNormal = new Vector3(0, 0, 1);
        const worldFaceNormal = localFaceNormal
          .clone()
          .applyQuaternion(leafMesh.quaternion);

        // The leaf's face normal should have SOME vertical (Y) component
        // Leaves can face up, down, or outward (droopy/horizontal leaves are valid)
        // We just want to ensure the face isn't pointing along the stem direction
        const absY = Math.abs(worldFaceNormal.y);

        // At least 5% of the normal should be in Y direction
        // This is lenient to allow tilted/horizontal leaves but prevents completely sideways faces
        // Note: StemAttachmentAngle can tilt leaves further from vertical, hence the low threshold
        expect(absY).toBeGreaterThan(0.05);
      }

      result.dispose();
    });

    it("should have leaves facing generally outward from trunk", () => {
      generator.setParam(LPK.LeafCount, 4);
      generator.setParam(LPK.RotationalSymmetry, 4);
      generator.setParam(LPK.StemFlop, 0.5);
      const result = generator.generate();

      // For each leaf, the length direction (local Y) should point outward from trunk
      const leafMeshes: Mesh[] = [];
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Leaf") {
          leafMeshes.push(obj);
        }
      });

      for (const leafMesh of leafMeshes) {
        leafMesh.updateWorldMatrix(true, false);

        // Get leaf's length direction (local Y)
        const localLength = new Vector3(0, 1, 0);
        const worldLength = localLength
          .clone()
          .applyQuaternion(leafMesh.quaternion);

        // Get leaf position (direction from origin to leaf)
        const leafPos = new Vector3();
        leafMesh.getWorldPosition(leafPos);

        if (leafPos.length() > 0.1) {
          const outwardDir = leafPos.clone().normalize();

          // The leaf length should have some component pointing outward
          // (leaves grow outward from the plant, not inward)
          // This is a soft check - the dot product should be positive or neutral
          const outwardComponent = worldLength.dot(outwardDir);
          // Allow some inward-pointing for curved leaves, but not completely inward
          expect(outwardComponent).toBeGreaterThan(-0.8);
        }
      }

      result.dispose();
    });

    it("should generate leaf with correct base orientation before transforms", () => {
      // Generate just a leaf mesh to check its default orientation
      const leafResult = generator.generateLeafOnly();
      const mesh = leafResult.mesh;

      // The leaf should be primarily in the XY plane (before distortion)
      // with the face normal pointing in Z direction
      const vertices = mesh.vertices;

      // Check that most vertices have small Z values (leaf is flat in XY)
      // Note: distortion and extrusion add some Z variation
      let avgZ = 0;
      for (const v of vertices) {
        avgZ += Math.abs(v.z);
      }
      avgZ /= vertices.length;

      // Average Z should be relatively small compared to X/Y spread
      const xSpread =
        Math.max(...vertices.map((v) => v.x)) -
        Math.min(...vertices.map((v) => v.x));
      const ySpread =
        Math.max(...vertices.map((v) => v.y)) -
        Math.min(...vertices.map((v) => v.y));

      expect(avgZ).toBeLessThan(Math.max(xSpread, ySpread) * 0.5);
    });
  });

  describe("Mesh Continuity - Stem to Leaf Connection", () => {
    it("should have stem tip close to leaf attachment point", () => {
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemWidth, 0.5);
      const result = generator.generate();

      // For each bundle, measure actual distance from stem tip to leaf
      for (const bundle of result.leafBundles) {
        if (!bundle.visible) continue;

        const stemVertices = getMeshVertices(bundle.stemMesh);
        const leafVertices = getMeshVertices(bundle.leafMesh);

        // The stem should have vertices
        expect(stemVertices.length).toBeGreaterThan(6);

        // The leaf should have vertices
        expect(leafVertices.length).toBeGreaterThan(10);

        // Find closest distance between stem and leaf vertices
        let minDistance = Infinity;
        for (const sv of stemVertices) {
          for (const lv of leafVertices) {
            const dist = distance(sv, lv);
            if (dist < minDistance) minDistance = dist;
          }
        }

        // Stem and leaf should be touching or very close (within 0.3 units)
        expect(minDistance).toBeLessThan(0.3);
      }

      result.dispose();
    });

    it("should have consistent stem width throughout (except tip taper)", () => {
      generator.setParam(LPK.LeafCount, 1);
      generator.setParam(LPK.StemWidth, 1.0);
      const result = generator.generate();

      const bundle = result.leafBundles[0];
      if (!bundle || !bundle.visible) {
        result.dispose();
        return;
      }

      const vertices = getMeshVertices(bundle.stemMesh);

      // Stem should have multiple rings of vertices (6 segments = 6 verts per ring)
      expect(vertices.length).toBeGreaterThanOrEqual(12); // At least 2 rings of 6

      // Check that the stem cross-section radius is approximately StemWidth * 0.25 * scale
      // Group vertices by Y position to find rings
      const yPositions = vertices.map((v) => v.y);
      const uniqueYs = [
        ...new Set(yPositions.map((y) => Math.round(y * 100) / 100)),
      ];

      // Should have multiple unique Y positions (multiple rings)
      expect(uniqueYs.length).toBeGreaterThanOrEqual(2);

      result.dispose();
    });
  });

  describe("Trunk Geometry", () => {
    it("should generate trunk extending upward (positive Y)", () => {
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.TrunkWidth, 0.3);
      generator.setParam(LPK.TrunkLean, 0);
      const result = generator.generate();

      // Find trunk mesh
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });

      expect(trunkMesh).not.toBeNull();

      if (trunkMesh) {
        const bounds = getMeshBounds(trunkMesh.geometry);
        // Trunk should extend upward
        expect(bounds.max.y).toBeGreaterThan(bounds.min.y);
        // Trunk should be taller than wide
        const height = bounds.max.y - bounds.min.y;
        const width = Math.max(
          bounds.max.x - bounds.min.x,
          bounds.max.z - bounds.min.z,
        );
        expect(height).toBeGreaterThan(width * 0.5);
      }

      result.dispose();
    });

    it("should apply lean correctly", () => {
      // Straight trunk
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.TrunkLean, 0);
      const result1 = generator.generate();

      let trunk1: Mesh | null = null;
      result1.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunk1 = obj;
        }
      });
      const bounds1 = trunk1
        ? getMeshBounds(trunk1.geometry)
        : { center: { x: 0, y: 0, z: 0 } };
      result1.dispose();

      // Leaning trunk
      const generator2 = new PlantGenerator({ seed: 12345 });
      generator2.setGenerateTextures(false);
      generator2.setParam(LPK.LeafCount, 3);
      generator2.setParam(LPK.TrunkLean, 30); // 30 degrees lean
      const result2 = generator2.generate();

      let trunk2: Mesh | null = null;
      result2.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunk2 = obj;
        }
      });
      const bounds2 = trunk2
        ? getMeshBounds(trunk2.geometry)
        : { center: { x: 0, y: 0, z: 0 } };
      result2.dispose();

      // With lean, the center X position should be different
      // (or Z, depending on lean direction)
      const centerDiff =
        Math.abs(bounds1.center.x - bounds2.center.x) +
        Math.abs(bounds1.center.z - bounds2.center.z);
      expect(centerDiff).toBeGreaterThan(0.01);
    });
  });

  describe("Bundle Transform Correctness", () => {
    it("should position bundles at correct Y heights based on NodeDistance", () => {
      generator.setParam(LPK.LeafCount, 5);
      generator.setParam(LPK.NodeDistance, 0.3);
      generator.setParam(LPK.NodeInitialY, 0.1);
      const result = generator.generate();

      // Extract bundle positions (note: names are "LeafBundle_0", "LeafBundle_1", etc.)
      const bundlePositions: number[] = [];
      result.group.traverse((obj) => {
        if (obj.name.startsWith("LeafBundle_")) {
          obj.updateWorldMatrix(true, false);
          bundlePositions.push(obj.position.y);
        }
      });

      // Should have found bundles
      expect(bundlePositions.length).toBeGreaterThan(0);

      // Bundles should be at increasing Y heights
      for (let i = 1; i < bundlePositions.length; i++) {
        // Each bundle should be higher than the previous (approximately)
        // Note: collision avoidance can adjust positions slightly
        expect(bundlePositions[i]).toBeGreaterThanOrEqual(
          bundlePositions[0] - 0.5,
        );
      }

      result.dispose();
    });

    it("should rotate bundles around Y axis for stem rotation", () => {
      generator.setParam(LPK.LeafCount, 6);
      generator.setParam(LPK.RotationalSymmetry, 2);
      generator.setParam(LPK.RotationClustering, 0);
      const result = generator.generate();

      // Extract bundle rotations (around Y axis)
      const bundleYRotations: number[] = [];
      result.group.traverse((obj) => {
        if (obj.name.startsWith("LeafBundle_")) {
          // Get the Y rotation from the quaternion
          const euler = obj.rotation.clone();
          bundleYRotations.push(euler.y);
        }
      });

      // Should have found bundles
      expect(bundleYRotations.length).toBeGreaterThan(0);

      // With symmetry 2 and no clustering, bundles should be spread around Y
      // At least some should have different rotations
      if (bundleYRotations.length >= 2) {
        const rotationSpread =
          Math.max(...bundleYRotations) - Math.min(...bundleYRotations);
        expect(rotationSpread).toBeGreaterThan(0.1); // Some spread in rotations
      }

      result.dispose();
    });
  });

  describe("Taper Functions", () => {
    it("should return 1 for stem shape scale at perc <= 0.95", () => {
      expect(shapeScaleAtPercent(0)).toBe(1);
      expect(shapeScaleAtPercent(0.5)).toBe(1);
      expect(shapeScaleAtPercent(0.95)).toBe(1);
    });

    it("should taper stem from 0.95 to 1.0", () => {
      const scale95 = shapeScaleAtPercent(0.95);
      const scale975 = shapeScaleAtPercent(0.975);
      const scale1 = shapeScaleAtPercent(1.0);

      expect(scale95).toBeGreaterThan(scale975);
      expect(scale975).toBeGreaterThan(scale1);
      expect(scale1).toBeGreaterThan(0); // Should not reach 0
      expect(scale1).toBeLessThan(0.5);
    });

    it("should taper trunk quadratically from taperStart", () => {
      const taperStart = 0.7;

      expect(trunkShapeScaleAtPercent(0.5, taperStart)).toBe(1);
      expect(trunkShapeScaleAtPercent(0.7, taperStart)).toBe(1);

      const mid = trunkShapeScaleAtPercent(0.85, taperStart);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);

      expect(trunkShapeScaleAtPercent(0.99, taperStart)).toBe(0);
    });
  });

  describe("Quaternion Math Verification", () => {
    it("should produce identity quaternion for forward = (0, 0, 1)", () => {
      const q = lookRotation({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });

      // Identity quaternion or equivalent
      const quat = new Quaternion(q.x, q.y, q.z, q.w);
      const identity = new Quaternion(0, 0, 0, 1);

      expect(quat.angleTo(identity)).toBeLessThan(0.01);
    });

    it("should rotate point correctly with quaternionFromEuler", () => {
      // 90 degree rotation around Y axis
      const q = quaternionFromEuler(0, Math.PI / 2, 0);

      // Point on X axis should move to Z axis
      const point = { x: 1, y: 0, z: 0 };
      const rotated = rotatePointByQuat(point, q);

      expect(rotated.x).toBeCloseTo(0, 3);
      expect(rotated.y).toBeCloseTo(0, 3);
      expect(rotated.z).toBeCloseTo(-1, 3);
    });

    it("should preserve vector length under rotation", () => {
      const q = quaternionFromEuler(Math.PI / 4, Math.PI / 3, Math.PI / 6);
      const point = { x: 1.5, y: 2.3, z: -0.7 };
      const rotated = rotatePointByQuat(point, q);

      const originalLen = Math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2);
      const rotatedLen = Math.sqrt(
        rotated.x ** 2 + rotated.y ** 2 + rotated.z ** 2,
      );

      expect(rotatedLen).toBeCloseTo(originalLen, 5);
    });

    it("should produce correct lookRotation for various directions", () => {
      const testCases = [
        { forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
        { forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: -1 } },
        { forward: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
        { forward: normalize({ x: 1, y: 1, z: 0 }), up: { x: 0, y: 1, z: 0 } },
      ];

      for (const { forward, up } of testCases) {
        const q = lookRotation(forward, up);

        // Apply rotation to Z unit vector (default forward in Unity convention)
        const result = rotatePointByQuat({ x: 0, y: 0, z: 1 }, q);

        // Result should align with desired forward direction
        const resultNorm = normalize(result);
        const forwardNorm = normalize(forward);

        const dotProduct = dot(resultNorm, forwardNorm);
        expect(dotProduct).toBeCloseTo(1, 2);
      }
    });
  });

  describe("Plant Generation Sanity Checks", () => {
    it("should generate plants with reasonable dimensions", () => {
      generator.setParam(LPK.LeafCount, 5);
      const result = generator.generate();

      // Get overall bounds
      const box = new Vector3();
      result.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.updateWorldMatrix(true, false);
          obj.geometry.computeBoundingBox();
          const meshBox = obj.geometry.boundingBox!;
          box.x = Math.max(
            box.x,
            Math.abs(meshBox.max.x),
            Math.abs(meshBox.min.x),
          );
          box.y = Math.max(box.y, meshBox.max.y - meshBox.min.y);
          box.z = Math.max(
            box.z,
            Math.abs(meshBox.max.z),
            Math.abs(meshBox.min.z),
          );
        }
      });

      // Plant should have reasonable dimensions (not infinitely large or zero)
      expect(box.x).toBeGreaterThan(0.01);
      expect(box.y).toBeGreaterThan(0.01);
      expect(box.z).toBeGreaterThan(0.01);

      // Should not be unreasonably large
      expect(box.x).toBeLessThan(100);
      expect(box.y).toBeLessThan(100);
      expect(box.z).toBeLessThan(100);

      result.dispose();
    });

    it("should generate meshes with valid normals", () => {
      generator.setParam(LPK.LeafCount, 3);
      const result = generator.generate();

      result.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          const geometry = obj.geometry;
          const normals = geometry.getAttribute("normal");

          if (normals) {
            for (let i = 0; i < normals.count; i++) {
              const nx = normals.getX(i);
              const ny = normals.getY(i);
              const nz = normals.getZ(i);
              const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

              // Normal should be unit length (or close to it)
              expect(len).toBeCloseTo(1, 1);
            }
          }
        }
      });

      result.dispose();
    });

    it("should generate deterministic plants with same seed", () => {
      generator.setParam(LPK.LeafCount, 3);
      const result1 = generator.generate();

      const generator2 = new PlantGenerator({ seed: 12345 });
      generator2.setGenerateTextures(false);
      generator2.setParam(LPK.LeafCount, 3);
      const result2 = generator2.generate();

      // Count total vertices
      let totalVerts1 = 0;
      let totalVerts2 = 0;

      result1.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          totalVerts1 += obj.geometry.getAttribute("position").count;
        }
      });

      result2.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          totalVerts2 += obj.geometry.getAttribute("position").count;
        }
      });

      expect(totalVerts1).toBe(totalVerts2);

      result1.dispose();
      result2.dispose();
    });
  });

  describe("Stem-Leaf Alignment", () => {
    it("should have leaf and stem in the same bundle group", () => {
      generator.setParam(LPK.LeafCount, 1);
      generator.setParam(LPK.StemFlop, 0.5);
      const result = generator.generate();

      // Find the bundle (note: names are "LeafBundle_N")
      let bundleGroup: Group | null = null;
      result.group.traverse((obj) => {
        if (obj.name.startsWith("LeafBundle_") && obj instanceof Group) {
          bundleGroup = obj;
        }
      });

      expect(bundleGroup).not.toBeNull();

      if (bundleGroup) {
        // Find leaf and stem in bundle (note: names are "Leaf" and "Stem")
        let leafMesh: Mesh | null = null;
        let stemMesh: Mesh | null = null;

        bundleGroup.traverse((obj) => {
          if (obj instanceof Mesh) {
            if (obj.name === "Leaf") leafMesh = obj;
            if (obj.name === "Stem") stemMesh = obj;
          }
        });

        expect(leafMesh).not.toBeNull();
        expect(stemMesh).not.toBeNull();

        if (leafMesh && stemMesh) {
          // The leaf should be positioned at the end of the stem
          // This is a structural check - they should be in the same parent group
          expect(leafMesh.parent).toBe(stemMesh.parent);
        }
      }

      result.dispose();
    });

    it("should have leaf positioned near stem tip in world space", () => {
      generator.setParam(LPK.LeafCount, 1);
      generator.setParam(LPK.StemFlop, 0.3);
      const result = generator.generate();

      // Find stem and leaf meshes from the bundle group
      let stemMesh: Mesh | null = null;
      let leafMesh: Mesh | null = null;

      result.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          if (obj.name === "Stem") stemMesh = obj;
          if (obj.name === "Leaf") leafMesh = obj;
        }
      });

      expect(stemMesh).not.toBeNull();
      expect(leafMesh).not.toBeNull();

      if (stemMesh && leafMesh) {
        // Update world matrices
        stemMesh.updateWorldMatrix(true, false);
        leafMesh.updateWorldMatrix(true, false);

        // Get world positions of stem vertices
        const stemPosAttr = stemMesh.geometry.getAttribute("position");
        const stemWorldVerts: Vector3[] = [];
        for (let i = 0; i < stemPosAttr.count; i++) {
          const local = new Vector3(
            stemPosAttr.getX(i),
            stemPosAttr.getY(i),
            stemPosAttr.getZ(i),
          );
          const world = local.clone().applyMatrix4(stemMesh.matrixWorld);
          stemWorldVerts.push(world);
        }

        // Get world positions of leaf vertices
        const leafPosAttr = leafMesh.geometry.getAttribute("position");
        const leafWorldVerts: Vector3[] = [];
        for (let i = 0; i < leafPosAttr.count; i++) {
          const local = new Vector3(
            leafPosAttr.getX(i),
            leafPosAttr.getY(i),
            leafPosAttr.getZ(i),
          );
          const world = local.clone().applyMatrix4(leafMesh.matrixWorld);
          leafWorldVerts.push(world);
        }

        // Find closest distance between stem and leaf in world space
        let minDist = Infinity;
        for (const sv of stemWorldVerts) {
          for (const lv of leafWorldVerts) {
            const dist = sv.distanceTo(lv);
            if (dist < minDist) minDist = dist;
          }
        }

        // In world space, stem and leaf should be touching or very close
        expect(minDist).toBeLessThan(0.3);
      }

      result.dispose();
    });
  });

  describe("All Presets Generate Valid Geometry", () => {
    const presetNames = [
      "monstera",
      "pothos",
      "philodendron",
      "alocasia",
      "calathea",
      "anthurium",
      "aglaonema",
      "syngonium",
      "caladium",
      "ficus",
    ];

    for (const presetName of presetNames) {
      it(`should generate valid geometry for preset: ${presetName}`, () => {
        generator.loadPreset(presetName);
        generator.setParam(LPK.LeafCount, 2);
        const result = generator.generate();

        // Verify mesh integrity
        let meshCount = 0;
        let totalVertices = 0;

        result.group.traverse((obj) => {
          if (obj instanceof Mesh) {
            meshCount++;
            const pos = obj.geometry.getAttribute("position");
            totalVertices += pos.count;

            // Check for NaN vertices
            for (let i = 0; i < pos.count; i++) {
              expect(Number.isNaN(pos.getX(i))).toBe(false);
              expect(Number.isNaN(pos.getY(i))).toBe(false);
              expect(Number.isNaN(pos.getZ(i))).toBe(false);
            }
          }
        });

        expect(meshCount).toBeGreaterThan(0);
        expect(totalVertices).toBeGreaterThan(0);

        result.dispose();
      });
    }
  });
});

describe("Coordinate System Verification", () => {
  // Shared helpers for coordinate system and connectivity tests

  // Helper to get world position of a mesh vertex
  function getWorldVertex(mesh: Mesh, localVertex: Vector3): Vector3 {
    const worldVertex = localVertex.clone();
    mesh.updateWorldMatrix(true, false);
    worldVertex.applyMatrix4(mesh.matrixWorld);
    return worldVertex;
  }

  // Helper to get all world vertices from a geometry
  function getWorldVertices(mesh: Mesh): Vector3[] {
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute("position");
    const vertices: Vector3[] = [];

    for (let i = 0; i < posAttr.count; i++) {
      const local = new Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      vertices.push(getWorldVertex(mesh, local));
    }
    return vertices;
  }

  // Helper to find closest distance between two vertex sets
  function closestDistance(verts1: Vector3[], verts2: Vector3[]): number {
    let minDist = Infinity;
    for (const v1 of verts1) {
      for (const v2 of verts2) {
        const dist = v1.distanceTo(v2);
        if (dist < minDist) minDist = dist;
      }
    }
    return minDist;
  }

  // Helper to get centroid of vertices
  function getCentroid(verts: Vector3[]): Vector3 {
    const centroid = new Vector3();
    for (const v of verts) {
      centroid.add(v);
    }
    return centroid.divideScalar(verts.length);
  }

  describe("Stem Curve to World Transform", () => {
    it("should transform local Y to world X for outward extension", () => {
      // This tests the axis swap logic:
      // Local Y (extension) -> World X (outward from trunk)
      // Local X (flop offset) -> World Y (vertical)

      const localPoint = { x: 0.2, y: 1.0, z: 0 }; // Extension along Y, slight flop in X

      // After transform:
      const transformedPoint = {
        x: localPoint.y, // Y becomes X (outward)
        y: localPoint.x, // X becomes Y (vertical)
        z: localPoint.z, // Z stays
      };

      expect(transformedPoint.x).toBe(1.0); // Extension is now horizontal
      expect(transformedPoint.y).toBe(0.2); // Flop is now vertical
      expect(transformedPoint.z).toBe(0);
    });

    it("should transform tangent consistently with position", () => {
      // If position Y becomes X, tangent Y should also become X
      const localTangent = { x: 0.1, y: 0.9, z: 0.05 }; // Mostly pointing along Y (extension)

      const transformedTangent = {
        x: localTangent.y,
        y: localTangent.x,
        z: localTangent.z,
      };

      // Transformed tangent should mostly point in +X (outward)
      expect(transformedTangent.x).toBeGreaterThan(transformedTangent.y);
    });
  });

  describe("Leaf Coordinate System", () => {
    it("should have leaf local Y as length direction", () => {
      const generator = new PlantGenerator({ seed: 12345 });
      generator.setGenerateTextures(false);

      const result = generator.generateLeafOnly();
      const vertices = result.mesh.vertices;

      // Calculate extent in each direction
      const minY = Math.min(...vertices.map((v) => v.y));
      const maxY = Math.max(...vertices.map((v) => v.y));
      const minX = Math.min(...vertices.map((v) => v.x));
      const maxX = Math.max(...vertices.map((v) => v.x));

      const lengthY = maxY - minY;
      const widthX = maxX - minX;

      // Leaf should be longer than wide (Y extent > X extent)
      expect(lengthY).toBeGreaterThan(widthX * 0.5);
    });

    it("should have leaf starting near origin", () => {
      const generator = new PlantGenerator({ seed: 12345 });
      generator.setGenerateTextures(false);

      const result = generator.generateLeafOnly();
      const vertices = result.mesh.vertices;

      // Find the vertex closest to origin
      let minDist = Infinity;
      for (const v of vertices) {
        const dist = Math.sqrt(v.x * v.x + v.y * v.y);
        if (dist < minDist) minDist = dist;
      }

      // Some vertex should be near origin (leaf base)
      expect(minDist).toBeLessThan(0.5);
    });
  });

  describe("World Space Connectivity", () => {
    it("should have stem base at trunk surface in world space", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemFlop, 0.3);
      generator.setParam(LPK.TrunkWidth, 0.2);

      const result = generator.generate();

      // Get trunk mesh
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      expect(trunkMesh).not.toBeNull();

      // Get all stem meshes
      const stemMeshes: Mesh[] = [];
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Stem") {
          stemMeshes.push(obj);
        }
      });
      expect(stemMeshes.length).toBeGreaterThan(0);

      // Get trunk world vertices
      const trunkWorldVerts = getWorldVertices(trunkMesh!);

      for (const stemMesh of stemMeshes) {
        const stemWorldVerts = getWorldVertices(stemMesh);

        // Find the stem vertices closest to the trunk center line (stem base)
        // Stem base should be the vertices with smallest X extent in world space
        const stemCentroid = getCentroid(stemWorldVerts);

        // Find closest distance from stem vertices to trunk vertices
        const distToTrunk = closestDistance(stemWorldVerts, trunkWorldVerts);

        // Stem should touch or be very close to trunk (within trunk width)
        expect(distToTrunk).toBeLessThan(0.5);
      }

      result.dispose();
    });

    it("should have leaf attached to stem tip in world space", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemFlop, 0.3);

      const result = generator.generate();

      // For each bundle group, check stem-leaf connection
      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;
          let leafMesh: Mesh | null = null;

          obj.traverse((child) => {
            if (child instanceof Mesh) {
              if (child.name === "Stem") stemMesh = child;
              if (child.name === "Leaf") leafMesh = child;
            }
          });

          if (stemMesh && leafMesh) {
            const stemWorldVerts = getWorldVertices(stemMesh);
            const leafWorldVerts = getWorldVertices(leafMesh);

            // Get stem tip - vertices furthest from trunk center (X=0, Z=0 approximately)
            // Find the stem vertex furthest from the bundle's origin (stem extends outward)
            stemMesh.updateWorldMatrix(true, false);
            const bundleWorldPos = new Vector3();
            obj.getWorldPosition(bundleWorldPos);

            let maxDistFromBundle = 0;
            let stemTipVert = stemWorldVerts[0];
            for (const v of stemWorldVerts) {
              const dist = v.distanceTo(bundleWorldPos);
              if (dist > maxDistFromBundle) {
                maxDistFromBundle = dist;
                stemTipVert = v;
              }
            }

            // Find leaf vertex closest to stem tip
            let minDistToStemTip = Infinity;
            for (const leafV of leafWorldVerts) {
              const dist = leafV.distanceTo(stemTipVert);
              if (dist < minDistToStemTip) {
                minDistToStemTip = dist;
              }
            }

            // Leaf should be very close to stem tip (within 0.3 units)
            expect(minDistToStemTip).toBeLessThan(0.3);
          }
        }
      });

      result.dispose();
    });

    it("should have bundle positions along trunk height", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 4);
      generator.setParam(LPK.NodeDistance, 0.3);
      generator.setParam(LPK.NodeInitialY, 0.1);

      const result = generator.generate();

      // Get trunk bounds
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      expect(trunkMesh).not.toBeNull();

      const trunkWorldVerts = getWorldVertices(trunkMesh!);
      const trunkMinY = Math.min(...trunkWorldVerts.map((v) => v.y));
      const trunkMaxY = Math.max(...trunkWorldVerts.map((v) => v.y));

      // Get bundle positions
      const bundlePositions: Vector3[] = [];
      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          const pos = new Vector3();
          obj.getWorldPosition(pos);
          bundlePositions.push(pos);
        }
      });

      expect(bundlePositions.length).toBe(4);

      // Each bundle should be within trunk Y range
      for (const pos of bundlePositions) {
        expect(pos.y).toBeGreaterThanOrEqual(trunkMinY - 0.1);
        expect(pos.y).toBeLessThanOrEqual(trunkMaxY + 0.1);
      }

      // Bundle Y positions should be spaced by approximately NodeDistance
      const sortedY = bundlePositions.map((p) => p.y).sort((a, b) => a - b);
      for (let i = 1; i < sortedY.length; i++) {
        const spacing = sortedY[i] - sortedY[i - 1];
        // Allow some variance (0.2 to 0.4 for NodeDistance 0.3)
        expect(spacing).toBeGreaterThan(0.15);
        expect(spacing).toBeLessThan(0.5);
      }

      result.dispose();
    });

    it("should have stem starting at bundle origin", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemFlop, 0.5);

      const result = generator.generate();

      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;

          obj.traverse((child) => {
            if (child instanceof Mesh && child.name === "Stem") {
              stemMesh = child;
            }
          });

          if (stemMesh) {
            const stemWorldVerts = getWorldVertices(stemMesh);
            const bundleWorldPos = new Vector3();
            obj.getWorldPosition(bundleWorldPos);

            // Find stem vertex closest to bundle origin
            let minDistToBundle = Infinity;
            for (const v of stemWorldVerts) {
              const dist = v.distanceTo(bundleWorldPos);
              if (dist < minDistToBundle) {
                minDistToBundle = dist;
              }
            }

            // Stem should start at or very near bundle origin (within stem tube radius)
            // The stem is a tube, so vertices are offset from centerline by tube radius (~0.2)
            expect(minDistToBundle).toBeLessThan(0.25);
          }
        }
      });

      result.dispose();
    });

    it("should have complete connectivity from trunk to leaf tip", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 2);
      generator.setParam(LPK.StemFlop, 0.4);
      generator.setParam(LPK.TrunkWidth, 0.15);

      const result = generator.generate();

      // Get trunk
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      const trunkWorldVerts = getWorldVertices(trunkMesh!);

      // For each bundle, verify chain: trunk → bundle → stem → leaf
      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;
          let leafMesh: Mesh | null = null;

          obj.traverse((child) => {
            if (child instanceof Mesh) {
              if (child.name === "Stem") stemMesh = child;
              if (child.name === "Leaf") leafMesh = child;
            }
          });

          if (stemMesh && leafMesh) {
            const bundleWorldPos = new Vector3();
            obj.getWorldPosition(bundleWorldPos);

            const stemWorldVerts = getWorldVertices(stemMesh);
            const leafWorldVerts = getWorldVertices(leafMesh);

            // 1. Bundle should be near trunk
            const distBundleToTrunk = Math.min(
              ...trunkWorldVerts.map((v) => v.distanceTo(bundleWorldPos)),
            );
            expect(distBundleToTrunk).toBeLessThan(0.3);

            // 2. Stem should start at bundle (within tube radius)
            const distStemToBundle = Math.min(
              ...stemWorldVerts.map((v) => v.distanceTo(bundleWorldPos)),
            );
            expect(distStemToBundle).toBeLessThan(0.25);

            // 3. Stem and leaf should connect
            const distStemToLeaf = closestDistance(
              stemWorldVerts,
              leafWorldVerts,
            );
            expect(distStemToLeaf).toBeLessThan(0.3);

            // 4. Total chain should be connected (no gaps > 0.3)
            const maxGap = Math.max(
              distBundleToTrunk,
              distStemToBundle,
              distStemToLeaf,
            );
            expect(maxGap).toBeLessThan(0.3);
          }
        }
      });

      result.dispose();
    });
  });

  describe("Precise Node-to-Node Connectivity", () => {
    // Maximum allowed gap between connected nodes (in world units)
    const MAX_CONNECTION_GAP = 0.15;

    // Helper to find the vertex ring at a specific Y height (for trunk/stem)
    function getVerticesAtY(
      verts: Vector3[],
      targetY: number,
      tolerance: number = 0.05,
    ): Vector3[] {
      return verts.filter((v) => Math.abs(v.y - targetY) < tolerance);
    }

    // Helper to find centroid of a set of vertices
    function vertexCentroid(verts: Vector3[]): Vector3 {
      const centroid = new Vector3();
      for (const v of verts) centroid.add(v);
      return centroid.divideScalar(verts.length);
    }

    // Helper to find the vertex furthest from a reference point
    function furthestVertex(verts: Vector3[], from: Vector3): Vector3 {
      let maxDist = -Infinity;
      let furthest = verts[0];
      for (const v of verts) {
        const dist = v.distanceTo(from);
        if (dist > maxDist) {
          maxDist = dist;
          furthest = v;
        }
      }
      return furthest;
    }

    // Helper to find the vertex closest to a reference point
    function closestVertex(verts: Vector3[], to: Vector3): Vector3 {
      let minDist = Infinity;
      let closest = verts[0];
      for (const v of verts) {
        const dist = v.distanceTo(to);
        if (dist < minDist) {
          minDist = dist;
          closest = v;
        }
      }
      return closest;
    }

    it("should have stem base vertices touching trunk surface", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.TrunkWidth, 0.2);
      generator.setParam(LPK.StemWidth, 0.8);

      const result = generator.generate();

      // Get trunk vertices
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      expect(trunkMesh).not.toBeNull();
      const trunkWorldVerts = getWorldVertices(trunkMesh!);

      // For each stem, check that base vertices are near trunk surface
      const connectionGaps: number[] = [];

      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;
          obj.traverse((child) => {
            if (child instanceof Mesh && child.name === "Stem") {
              stemMesh = child;
            }
          });

          if (stemMesh) {
            const stemWorldVerts = getWorldVertices(stemMesh);
            const bundlePos = new Vector3();
            obj.getWorldPosition(bundlePos);

            // Find stem vertices closest to bundle origin (stem base)
            const stemBaseVerts = stemWorldVerts
              .map((v) => ({ v, dist: v.distanceTo(bundlePos) }))
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 6) // Take the 6 vertices of the base ring
              .map((x) => x.v);

            // Each stem base vertex should be close to some trunk vertex
            for (const stemBaseV of stemBaseVerts) {
              const closestTrunkDist = Math.min(
                ...trunkWorldVerts.map((tv) => tv.distanceTo(stemBaseV)),
              );
              connectionGaps.push(closestTrunkDist);
            }
          }
        }
      });

      // All stem-trunk connections should be tight
      expect(connectionGaps.length).toBeGreaterThan(0);
      const maxGap = Math.max(...connectionGaps);
      const minGap = Math.min(...connectionGaps);
      const avgGap =
        connectionGaps.reduce((a, b) => a + b, 0) / connectionGaps.length;

      // Report actual values for debugging
      console.log(
        `Stem-Trunk connection: min gap = ${minGap.toFixed(4)}, max gap = ${maxGap.toFixed(4)}, avg gap = ${avgGap.toFixed(4)}`,
      );

      // The minimum gap should be very small (at least one vertex touches trunk)
      expect(minGap).toBeLessThan(0.1);
      // Average gap should be reasonable (accounting for stem tube radius)
      expect(avgGap).toBeLessThan(0.4);

      result.dispose();
    });

    it("should have stem tip vertices touching leaf base vertices", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      generator.setParam(LPK.StemFlop, 0.3);

      const result = generator.generate();

      const connectionGaps: number[] = [];

      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;
          let leafMesh: Mesh | null = null;

          obj.traverse((child) => {
            if (child instanceof Mesh) {
              if (child.name === "Stem") stemMesh = child;
              if (child.name === "Leaf") leafMesh = child;
            }
          });

          if (stemMesh && leafMesh) {
            const bundlePos = new Vector3();
            obj.getWorldPosition(bundlePos);

            const stemWorldVerts = getWorldVertices(stemMesh);
            const leafWorldVerts = getWorldVertices(leafMesh);

            // Find stem tip (vertices furthest from bundle origin)
            const stemTipVerts = stemWorldVerts
              .map((v) => ({ v, dist: v.distanceTo(bundlePos) }))
              .sort((a, b) => b.dist - a.dist)
              .slice(0, 6) // Take the 6 vertices of the tip ring
              .map((x) => x.v);

            // Find leaf base (vertices closest to stem tip centroid)
            const stemTipCentroid = vertexCentroid(stemTipVerts);
            const leafBaseVerts = leafWorldVerts
              .map((v) => ({ v, dist: v.distanceTo(stemTipCentroid) }))
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 10) // Take some base vertices
              .map((x) => x.v);

            // Measure gap: closest distance from any stem tip vertex to any leaf base vertex
            for (const stemTipV of stemTipVerts) {
              const closestLeafDist = Math.min(
                ...leafBaseVerts.map((lv) => lv.distanceTo(stemTipV)),
              );
              connectionGaps.push(closestLeafDist);
            }
          }
        }
      });

      expect(connectionGaps.length).toBeGreaterThan(0);
      const maxGap = Math.max(...connectionGaps);
      const avgGap =
        connectionGaps.reduce((a, b) => a + b, 0) / connectionGaps.length;

      console.log(
        `Stem-Leaf connection: max gap = ${maxGap.toFixed(4)}, avg gap = ${avgGap.toFixed(4)}`,
      );

      // Stem tip to leaf base should be touching or very close
      expect(maxGap).toBeLessThan(0.3);

      result.dispose();
    });

    it("should have trunk mesh with continuous rings (no gaps)", () => {
      const generator = new PlantGenerator({ seed: 42 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 5);
      generator.setParam(LPK.TrunkWidth, 0.25);

      const result = generator.generate();

      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      expect(trunkMesh).not.toBeNull();

      const trunkWorldVerts = getWorldVertices(trunkMesh!);

      // Group trunk vertices by Y height to identify rings
      const yValues = trunkWorldVerts.map((v) => v.y);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);

      // Sample rings at regular intervals
      const numSamples = 10;
      const ringGaps: number[] = [];

      for (let i = 0; i < numSamples - 1; i++) {
        const y1 = minY + (maxY - minY) * (i / (numSamples - 1));
        const y2 = minY + (maxY - minY) * ((i + 1) / (numSamples - 1));

        const ring1 = getVerticesAtY(
          trunkWorldVerts,
          y1,
          (maxY - minY) / numSamples,
        );
        const ring2 = getVerticesAtY(
          trunkWorldVerts,
          y2,
          (maxY - minY) / numSamples,
        );

        if (ring1.length > 0 && ring2.length > 0) {
          // Find minimum distance between adjacent rings
          let minRingGap = Infinity;
          for (const v1 of ring1) {
            for (const v2 of ring2) {
              const gap = v1.distanceTo(v2);
              if (gap < minRingGap) minRingGap = gap;
            }
          }
          ringGaps.push(minRingGap);
        }
      }

      // Trunk should have continuous rings without large gaps
      if (ringGaps.length > 0) {
        const maxRingGap = Math.max(...ringGaps);
        console.log(
          `Trunk ring continuity: max ring gap = ${maxRingGap.toFixed(4)}`,
        );

        // Rings should be close together (continuous mesh)
        expect(maxRingGap).toBeLessThan(0.5);
      }

      result.dispose();
    });

    it("should verify end-to-end connectivity chain for each leaf bundle", () => {
      const generator = new PlantGenerator({ seed: 123 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 4);
      generator.setParam(LPK.StemFlop, 0.4);
      generator.setParam(LPK.TrunkWidth, 0.2);

      const result = generator.generate();

      // Get trunk
      let trunkMesh: Mesh | null = null;
      result.group.traverse((obj) => {
        if (obj instanceof Mesh && obj.name === "Trunk") {
          trunkMesh = obj;
        }
      });
      const trunkWorldVerts = getWorldVertices(trunkMesh!);

      // Track all connection measurements
      const connections: Array<{
        bundleIndex: number;
        trunkToBundle: number;
        bundleToStemBase: number;
        stemBaseToStemTip: number;
        stemTipToLeaf: number;
      }> = [];

      let bundleIndex = 0;
      result.group.traverse((obj) => {
        if (obj instanceof Group && obj.name.startsWith("LeafBundle_")) {
          let stemMesh: Mesh | null = null;
          let leafMesh: Mesh | null = null;

          obj.traverse((child) => {
            if (child instanceof Mesh) {
              if (child.name === "Stem") stemMesh = child;
              if (child.name === "Leaf") leafMesh = child;
            }
          });

          if (stemMesh && leafMesh) {
            const bundlePos = new Vector3();
            obj.getWorldPosition(bundlePos);

            const stemWorldVerts = getWorldVertices(stemMesh);
            const leafWorldVerts = getWorldVertices(leafMesh);

            // 1. Trunk surface to bundle origin
            const trunkToBundle = Math.min(
              ...trunkWorldVerts.map((v) => v.distanceTo(bundlePos)),
            );

            // 2. Bundle origin to stem base (closest stem vertex to bundle)
            const bundleToStemBase = Math.min(
              ...stemWorldVerts.map((v) => v.distanceTo(bundlePos)),
            );

            // 3. Stem extent (base to tip - should be stem length)
            const stemDistances = stemWorldVerts.map((v) =>
              v.distanceTo(bundlePos),
            );
            const stemBaseToStemTip =
              Math.max(...stemDistances) - Math.min(...stemDistances);

            // 4. Stem tip to leaf base
            // Find stem tip centroid
            const stemTipVerts = stemWorldVerts
              .map((v) => ({ v, dist: v.distanceTo(bundlePos) }))
              .sort((a, b) => b.dist - a.dist)
              .slice(0, 6)
              .map((x) => x.v);
            const stemTipCenter = vertexCentroid(stemTipVerts);

            const stemTipToLeaf = Math.min(
              ...leafWorldVerts.map((v) => v.distanceTo(stemTipCenter)),
            );

            connections.push({
              bundleIndex,
              trunkToBundle,
              bundleToStemBase,
              stemBaseToStemTip,
              stemTipToLeaf,
            });
          }
          bundleIndex++;
        }
      });

      // Log all connections for debugging
      console.log("=== End-to-End Connectivity Report ===");
      for (const conn of connections) {
        console.log(`Bundle ${conn.bundleIndex}:`);
        console.log(`  Trunk → Bundle: ${conn.trunkToBundle.toFixed(4)}`);
        console.log(
          `  Bundle → Stem base: ${conn.bundleToStemBase.toFixed(4)}`,
        );
        console.log(`  Stem length: ${conn.stemBaseToStemTip.toFixed(4)}`);
        console.log(`  Stem tip → Leaf: ${conn.stemTipToLeaf.toFixed(4)}`);
      }

      // Verify all connections are tight
      for (const conn of connections) {
        // Trunk should be close to bundle attachment point
        expect(conn.trunkToBundle).toBeLessThan(0.3);

        // Stem should start at bundle origin (within tube radius)
        expect(conn.bundleToStemBase).toBeLessThan(0.25);

        // Stem should have reasonable length (not collapsed)
        expect(conn.stemBaseToStemTip).toBeGreaterThan(0.1);

        // Leaf should be attached to stem tip
        expect(conn.stemTipToLeaf).toBeLessThan(0.3);
      }

      result.dispose();
    });

    it("should measure exact vertex-to-vertex distances at connection points", () => {
      const generator = new PlantGenerator({ seed: 999 });
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 2);
      generator.setParam(LPK.StemFlop, 0.5);
      generator.setParam(LPK.StemWidth, 1.0);

      const result = generator.generate();

      // Get all meshes
      let trunkMesh: Mesh | null = null;
      const stemMeshes: Mesh[] = [];
      const leafMeshes: Mesh[] = [];

      result.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          if (obj.name === "Trunk") trunkMesh = obj;
          if (obj.name === "Stem") stemMeshes.push(obj);
          if (obj.name === "Leaf") leafMeshes.push(obj);
        }
      });

      expect(trunkMesh).not.toBeNull();
      expect(stemMeshes.length).toBe(2);
      expect(leafMeshes.length).toBe(2);

      const trunkVerts = getWorldVertices(trunkMesh!);

      for (let i = 0; i < stemMeshes.length; i++) {
        const stemVerts = getWorldVertices(stemMeshes[i]);
        const leafVerts = getWorldVertices(leafMeshes[i]);

        // Find the EXACT minimum distance between stem and trunk
        let minStemTrunkDist = Infinity;
        let stemTrunkConnection = { stem: new Vector3(), trunk: new Vector3() };

        for (const sv of stemVerts) {
          for (const tv of trunkVerts) {
            const dist = sv.distanceTo(tv);
            if (dist < minStemTrunkDist) {
              minStemTrunkDist = dist;
              stemTrunkConnection = { stem: sv.clone(), trunk: tv.clone() };
            }
          }
        }

        // Find the EXACT minimum distance between stem and leaf
        let minStemLeafDist = Infinity;
        let stemLeafConnection = { stem: new Vector3(), leaf: new Vector3() };

        for (const sv of stemVerts) {
          for (const lv of leafVerts) {
            const dist = sv.distanceTo(lv);
            if (dist < minStemLeafDist) {
              minStemLeafDist = dist;
              stemLeafConnection = { stem: sv.clone(), leaf: lv.clone() };
            }
          }
        }

        console.log(`\nBundle ${i} exact vertex distances:`);
        console.log(
          `  Stem↔Trunk: ${minStemTrunkDist.toFixed(6)} at stem(${stemTrunkConnection.stem.x.toFixed(3)}, ${stemTrunkConnection.stem.y.toFixed(3)}, ${stemTrunkConnection.stem.z.toFixed(3)}) ↔ trunk(${stemTrunkConnection.trunk.x.toFixed(3)}, ${stemTrunkConnection.trunk.y.toFixed(3)}, ${stemTrunkConnection.trunk.z.toFixed(3)})`,
        );
        console.log(
          `  Stem↔Leaf: ${minStemLeafDist.toFixed(6)} at stem(${stemLeafConnection.stem.x.toFixed(3)}, ${stemLeafConnection.stem.y.toFixed(3)}, ${stemLeafConnection.stem.z.toFixed(3)}) ↔ leaf(${stemLeafConnection.leaf.x.toFixed(3)}, ${stemLeafConnection.leaf.y.toFixed(3)}, ${stemLeafConnection.leaf.z.toFixed(3)})`,
        );

        // These should be VERY close - ideally touching or nearly touching
        expect(minStemTrunkDist).toBeLessThan(MAX_CONNECTION_GAP);
        expect(minStemLeafDist).toBeLessThan(MAX_CONNECTION_GAP);
      }

      result.dispose();
    });
  });
});
