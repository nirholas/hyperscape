/**
 * Entity HLOD (Hierarchical Level of Detail) Tests
 *
 * These tests verify the HLOD algorithms and logic used by the Entity system.
 *
 * IMPORTANT: Entity class requires a full World context to instantiate, making
 * pure unit tests impractical. These tests verify:
 *
 * 1. **Algorithm correctness tests** - Verify the mathematical logic used for
 *    height offset calculation, LOD determination, etc. These test the SAME
 *    algorithms used in Entity.ts to catch logic errors during development.
 *
 * 2. **THREE.js integration tests** - Verify bounding box/sphere calculations
 *    work correctly with real THREE.js objects.
 *
 * For end-to-end HLOD testing with actual Entity instances, see the Playwright
 * integration tests that run a full game world.
 */

import * as THREE from "three";
import { describe, it, expect } from "vitest";

// Import the actual LODLevel enum from the codebase
import { LODLevel } from "../../systems/shared/rendering/ImpostorManager";

// ============================================================================
// HEIGHT OFFSET ALGORITHM TESTS
// ============================================================================
// These tests verify the height offset calculation algorithm that Entity.ts uses.
// The algorithm is duplicated here for verification - if Entity.ts changes,
// these tests should also be updated to match.

describe("Height Offset Algorithm", () => {
  /**
   * Calculate height offset - MUST MATCH Entity.createHLODImpostorMesh logic.
   * If this test fails after Entity.ts changes, update this function to match.
   *
   * Source: Entity.ts lines 1763-1799
   */
  function calculateHeightOffset(
    boundingBox: THREE.Box3 | null,
    boundingSphere: THREE.Sphere | null,
    height: number,
  ): number {
    let heightOffset = 0;

    if (boundingBox) {
      const boxSize = new THREE.Vector3();
      boundingBox.getSize(boxSize);
      const boxMin = boundingBox.min.y;
      heightOffset = boxMin + boxSize.y / 2;

      if (Math.abs(boxMin) > boxSize.y) {
        heightOffset = boxSize.y / 2;
      }
    } else if (boundingSphere) {
      const sphereCenterY = boundingSphere.center.y;
      heightOffset =
        Math.abs(sphereCenterY) > boundingSphere.radius * 2
          ? boundingSphere.radius
          : sphereCenterY;
    } else {
      heightOffset = height / 2;
    }

    return heightOffset;
  }

  it("character at ground level (feet at y=0) -> center at height/2", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 2, 0.5),
    );
    expect(calculateHeightOffset(bbox, null, 2)).toBeCloseTo(1, 1);
  });

  it("cube centered at origin -> center at y=0", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1),
    );
    expect(calculateHeightOffset(bbox, null, 2)).toBeCloseTo(0, 1);
  });

  it("tall tree (0 to 10m) -> center at y=5", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-3, 0, -3),
      new THREE.Vector3(3, 10, 3),
    );
    expect(calculateHeightOffset(bbox, null, 10)).toBeCloseTo(5, 1);
  });

  it("mesh far from origin (world pos bug case) -> uses size-based offset", () => {
    // This tests the fix for the world-space bounding box bug
    const bbox = new THREE.Box3(
      new THREE.Vector3(99, 49, 29),
      new THREE.Vector3(101, 51, 31),
    );
    // boxMin.y (49) > boxSize.y (2), so use boxSize.y/2 = 1
    expect(calculateHeightOffset(bbox, null, 2)).toBeCloseTo(1, 1);
  });

  it("bounding sphere near origin -> uses sphere center Y", () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 1.5);
    expect(calculateHeightOffset(null, sphere, 3)).toBeCloseTo(1.5, 1);
  });

  it("bounding sphere far from origin -> uses sphere radius", () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 100, 0), 2);
    // centerY (100) > radius*2 (4), so use radius = 2
    expect(calculateHeightOffset(null, sphere, 4)).toBeCloseTo(2, 1);
  });

  it("no bounds -> uses height/2 fallback", () => {
    expect(calculateHeightOffset(null, null, 4)).toBeCloseTo(2, 1);
  });
});

// ============================================================================
// LOD LEVEL DETERMINATION ALGORITHM TESTS
// ============================================================================

describe("LOD Level Determination Algorithm", () => {
  /**
   * Determine LOD level - MUST MATCH Entity.updateHLOD logic.
   * Source: Entity.ts updateHLOD method
   */
  function determineLODLevel(
    distance: number,
    config: {
      lod1Distance: number;
      impostorDistance: number;
      fadeDistance: number;
    },
  ): LODLevel {
    if (distance >= config.fadeDistance) {
      return LODLevel.CULLED;
    } else if (distance >= config.impostorDistance) {
      return LODLevel.IMPOSTOR;
    } else if (distance >= config.lod1Distance) {
      return LODLevel.LOD1;
    } else {
      return LODLevel.LOD0;
    }
  }

  const config = {
    lod1Distance: 20,
    impostorDistance: 60,
    fadeDistance: 100,
  };

  it("close distance -> LOD0", () => {
    expect(determineLODLevel(5, config)).toBe(LODLevel.LOD0);
    expect(determineLODLevel(19, config)).toBe(LODLevel.LOD0);
  });

  it("medium distance -> LOD1", () => {
    expect(determineLODLevel(20, config)).toBe(LODLevel.LOD1);
    expect(determineLODLevel(59, config)).toBe(LODLevel.LOD1);
  });

  it("far distance -> IMPOSTOR", () => {
    expect(determineLODLevel(60, config)).toBe(LODLevel.IMPOSTOR);
    expect(determineLODLevel(99, config)).toBe(LODLevel.IMPOSTOR);
  });

  it("very far distance -> CULLED", () => {
    expect(determineLODLevel(100, config)).toBe(LODLevel.CULLED);
    expect(determineLODLevel(500, config)).toBe(LODLevel.CULLED);
  });
});

// ============================================================================
// IMPOSTOR SIZE CALCULATION TESTS
// ============================================================================

describe("Impostor Size Calculation", () => {
  /**
   * Calculate impostor billboard size from bounding box.
   * Source: Entity.ts createHLODImpostorMesh lines 1666-1675
   */
  function calculateImpostorSize(
    boundingBox: THREE.Box3 | null,
    boundingSphere: THREE.Sphere | null,
  ): { width: number; height: number } {
    if (boundingBox) {
      const size = new THREE.Vector3();
      boundingBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      return { width: maxDim, height: maxDim };
    } else if (boundingSphere) {
      const diameter = boundingSphere.radius * 2;
      return { width: diameter, height: diameter };
    }
    return { width: 1, height: 1 };
  }

  it("tall humanoid (1.8m) -> 1.8x1.8 square", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-0.25, 0, -0.15),
      new THREE.Vector3(0.25, 1.8, 0.15),
    );
    const size = calculateImpostorSize(bbox, null);
    expect(size.width).toBeCloseTo(1.8, 1);
    expect(size.height).toBeCloseTo(1.8, 1);
  });

  it("wide building (10m wide, 5m tall) -> 10x10 square", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-5, 0, -5),
      new THREE.Vector3(5, 5, 5),
    );
    const size = calculateImpostorSize(bbox, null);
    expect(size.width).toBeCloseTo(10, 1);
    expect(size.height).toBeCloseTo(10, 1);
  });

  it("bounding sphere radius 2 -> 4x4 diameter square", () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);
    const size = calculateImpostorSize(null, sphere);
    expect(size.width).toBeCloseTo(4, 1);
    expect(size.height).toBeCloseTo(4, 1);
  });
});

// ============================================================================
// LOD TRANSITION VISIBILITY LOGIC TESTS
// ============================================================================

describe("LOD Transition Visibility Logic", () => {
  /**
   * Determine which meshes are visible after LOD transition.
   * Source: Entity.ts transitionHLOD method
   */
  function getVisibility(
    toLOD: LODLevel,
    hasLod1Mesh: boolean,
    hasImpostorMesh: boolean,
  ): { lod0: boolean; lod1: boolean; impostor: boolean } {
    switch (toLOD) {
      case LODLevel.LOD0:
        return { lod0: true, lod1: false, impostor: false };
      case LODLevel.LOD1:
        if (hasLod1Mesh) {
          return { lod0: false, lod1: true, impostor: false };
        }
        // Fallback: show LOD0 with frozen animation
        return { lod0: true, lod1: false, impostor: false };
      case LODLevel.IMPOSTOR:
        if (hasImpostorMesh) {
          return { lod0: false, lod1: false, impostor: true };
        }
        // Defensive fallback: keep showing 3D mesh
        if (hasLod1Mesh) {
          return { lod0: false, lod1: true, impostor: false };
        }
        return { lod0: true, lod1: false, impostor: false };
      case LODLevel.CULLED:
        return { lod0: false, lod1: false, impostor: false };
      default:
        return { lod0: true, lod1: false, impostor: false };
    }
  }

  it("LOD0 shows only lod0 mesh", () => {
    const vis = getVisibility(LODLevel.LOD0, true, true);
    expect(vis.lod0).toBe(true);
    expect(vis.lod1).toBe(false);
    expect(vis.impostor).toBe(false);
  });

  it("LOD1 with lod1Mesh shows only lod1", () => {
    const vis = getVisibility(LODLevel.LOD1, true, true);
    expect(vis.lod1).toBe(true);
    expect(vis.lod0).toBe(false);
  });

  it("LOD1 without lod1Mesh falls back to lod0", () => {
    const vis = getVisibility(LODLevel.LOD1, false, true);
    expect(vis.lod0).toBe(true);
    expect(vis.lod1).toBe(false);
  });

  it("IMPOSTOR with impostorMesh shows only impostor", () => {
    const vis = getVisibility(LODLevel.IMPOSTOR, true, true);
    expect(vis.impostor).toBe(true);
    expect(vis.lod0).toBe(false);
  });

  it("IMPOSTOR without impostorMesh keeps 3D mesh visible (defensive)", () => {
    const vis = getVisibility(LODLevel.IMPOSTOR, false, false);
    // Should NOT be invisible - defensive fallback
    expect(vis.lod0).toBe(true);
    expect(vis.impostor).toBe(false);
  });

  it("CULLED hides everything", () => {
    const vis = getVisibility(LODLevel.CULLED, true, true);
    expect(vis.lod0).toBe(false);
    expect(vis.lod1).toBe(false);
    expect(vis.impostor).toBe(false);
  });
});

// ============================================================================
// THREE.JS BOUNDING BOX CALCULATION TESTS
// ============================================================================
// These test real THREE.js behavior to ensure our assumptions about
// bounding box computation are correct.

describe("THREE.js Bounding Box Integration", () => {
  it("Box3.setFromObject includes child transforms", () => {
    const group = new THREE.Group();
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    child.position.set(0, 5, 0); // Child at y=5
    group.add(child);
    group.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(group);

    // Box should span y=4.5 to y=5.5 (child center + half geometry)
    expect(bbox.min.y).toBeCloseTo(4.5, 1);
    expect(bbox.max.y).toBeCloseTo(5.5, 1);

    child.geometry.dispose();
    (child.material as THREE.Material).dispose();
  });

  it("getBoundingSphere correctly encompasses bounding box", () => {
    const bbox = new THREE.Box3(
      new THREE.Vector3(-2, 0, -1),
      new THREE.Vector3(2, 3, 1),
    );
    const sphere = new THREE.Sphere();
    bbox.getBoundingSphere(sphere);

    // Sphere center should be at box center
    expect(sphere.center.x).toBeCloseTo(0, 1);
    expect(sphere.center.y).toBeCloseTo(1.5, 1);
    expect(sphere.center.z).toBeCloseTo(0, 1);

    // Sphere should encompass all corners
    expect(sphere.radius).toBeGreaterThan(2);
  });

  it("mesh at world position has world-space bounding box", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.set(100, 50, -30);
    mesh.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(mesh);

    // Bounding box should be at world position
    expect(bbox.min.x).toBeCloseTo(99.5, 1);
    expect(bbox.min.y).toBeCloseTo(49.5, 1);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});

// ============================================================================
// VRM MESH PREPARATION TESTS
// ============================================================================

describe("VRM Mesh Preparation for Baking", () => {
  it("saving and restoring mesh position works correctly", () => {
    const mesh = new THREE.Group();
    mesh.position.set(100, 0, 50);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));

    // Save original state
    const savedPosition = mesh.position.clone();
    const savedQuaternion = mesh.quaternion.clone();

    // Move to origin for baking
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();

    expect(mesh.position.x).toBe(0);
    expect(mesh.position.y).toBe(0);
    expect(mesh.position.z).toBe(0);

    // Restore
    mesh.position.copy(savedPosition);
    mesh.quaternion.copy(savedQuaternion);

    expect(mesh.position.x).toBe(100);
    expect(mesh.position.z).toBe(50);
    expect(mesh.quaternion.y).toBeCloseTo(savedQuaternion.y, 5);
  });

  it("bounding box size is independent of world position", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 1),
      new THREE.MeshBasicMaterial(),
    );

    // At origin
    mesh.position.set(0, 0, 0);
    mesh.updateMatrixWorld(true);
    const bbox1 = new THREE.Box3().setFromObject(mesh);
    const size1 = new THREE.Vector3();
    bbox1.getSize(size1);

    // At world position
    mesh.position.set(100, 50, -30);
    mesh.updateMatrixWorld(true);
    const bbox2 = new THREE.Box3().setFromObject(mesh);
    const size2 = new THREE.Vector3();
    bbox2.getSize(size2);

    // Size should be the same regardless of position
    expect(size1.x).toBeCloseTo(size2.x, 5);
    expect(size1.y).toBeCloseTo(size2.y, 5);
    expect(size1.z).toBeCloseTo(size2.z, 5);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
