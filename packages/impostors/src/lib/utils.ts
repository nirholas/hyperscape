/**
 * Octahedral Impostor Library - Utility Functions
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";

/**
 * Create a colored cube with different colors on each face (useful for debugging)
 */
export function createColoredCube(size: number = 1): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, size, size);

  const colors = [
    0xff0000, // Red - +X
    0x00ff00, // Green - -X
    0x0000ff, // Blue - +Y
    0xffff00, // Yellow - -Y
    0xff00ff, // Magenta - +Z
    0x00ffff, // Cyan - -Z
  ];

  const materials = colors.map((color) => {
    const mat = new MeshBasicNodeMaterial();
    mat.color = new THREE.Color(color);
    return mat;
  });

  return new THREE.Mesh(geometry, materials);
}

/**
 * Generate an array of colors forming a linear gradient in HSL space
 *
 * @param count - Number of colors to generate
 * @returns Array of THREE.Color objects
 */
export function generateHSLGradientColors(count: number): THREE.Color[] {
  const colors: THREE.Color[] = [];

  for (let i = 0; i < count; i++) {
    const hue = i / count;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.5);
    colors.push(color);
  }

  return colors;
}

/**
 * Center a mesh's geometry to its bounding sphere center
 *
 * @param mesh - The mesh to center
 */
export function centerGeometryToBoundingSphere(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry;
  geometry.computeBoundingSphere();

  if (geometry.boundingSphere) {
    const center = geometry.boundingSphere.center.clone();
    geometry.translate(-center.x, -center.y, -center.z);
    mesh.position.add(center);
  }
}

/**
 * Compute the combined bounding sphere for an object and all its children
 *
 * @param object - The root object
 * @returns The combined bounding sphere
 */
export function computeCombinedBoundingSphere(
  object: THREE.Object3D,
): THREE.Sphere {
  const boundingSphere = new THREE.Sphere();
  const tempSphere = new THREE.Sphere();
  let first = true;

  object.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      node.geometry.computeBoundingSphere();
      if (node.geometry.boundingSphere) {
        // Transform bounding sphere to world space
        tempSphere.copy(node.geometry.boundingSphere);
        tempSphere.applyMatrix4(node.matrixWorld);

        if (first) {
          boundingSphere.copy(tempSphere);
          first = false;
        } else {
          boundingSphere.union(tempSphere);
        }
      }
    }
  });

  return boundingSphere;
}

/**
 * Create a simple torus knot for testing
 */
export function createTestTorusKnot(): THREE.Mesh {
  const geometry = new THREE.TorusKnotGeometry(0.5, 0.15, 100, 16);
  const material = new MeshStandardNodeMaterial();
  material.color = new THREE.Color(0xff69b4);
  return new THREE.Mesh(geometry, material);
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map a value from one range to another
 */
export function mapLinear(
  x: number,
  a1: number,
  a2: number,
  b1: number,
  b2: number,
): number {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}
