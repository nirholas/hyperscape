/**
 * Octahedral Impostor Library - Octahedron Geometry Generation
 *
 * Core geometry generation for octahedral mapping.
 * Attribution: Original code by SketchpunkLabs (VoR)
 * https://codesandbox.io/p/sandbox/prototypes-pygsc7
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type {
  OctahedronTypeValue,
  OctahedronMeshData,
  GeometryBufferProps,
} from "./types";
import { OctahedronType } from "./types";

/**
 * Create a buffer geometry from the given properties
 */
function createGeometryBuffer(
  props: GeometryBufferProps,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(
      props.vertices instanceof Float32Array
        ? props.vertices
        : new Float32Array(props.vertices),
      3,
    ),
  );

  if (props.indices) {
    geo.setIndex(
      new THREE.BufferAttribute(
        props.indices instanceof Uint16Array
          ? props.indices
          : new Uint16Array(props.indices),
        1,
      ),
    );
  }

  if (props.normals) {
    geo.setAttribute(
      "normal",
      new THREE.BufferAttribute(
        props.normals instanceof Float32Array
          ? props.normals
          : new Float32Array(props.normals),
        3,
      ),
    );
  }

  if (props.texcoord) {
    geo.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        props.texcoord instanceof Float32Array
          ? props.texcoord
          : new Float32Array(props.texcoord),
        2,
      ),
    );
  }

  if (props.joints && props.weights) {
    const skinSize = props.skinSize ?? 4;
    geo.setAttribute(
      "skinWeight",
      new THREE.BufferAttribute(
        props.weights instanceof Float32Array
          ? props.weights
          : new Float32Array(props.weights),
        skinSize,
      ),
    );
    geo.setAttribute(
      "skinIndex",
      new THREE.BufferAttribute(
        props.joints instanceof Float32Array
          ? props.joints
          : new Float32Array(props.joints),
        skinSize,
      ),
    );
  }

  return geo;
}

/**
 * Create grid points in a unit square.
 *
 * When useCellCenters is true, points land at cell centers:
 * - u = (xi + 0.5) / pointCountX
 * - v = (yi + 0.5) / pointCountY
 * This aligns view directions with atlas cell centers.
 */
function createGridPoints(
  pointCountX: number,
  pointCountY: number,
  width = 1,
  height = 1,
  useCenter = true,
  useCellCenters = false,
): number[] {
  const ox = useCenter ? -width * 0.5 : 0;
  const oz = useCenter ? -height * 0.5 : 0;

  const xStep = useCellCenters
    ? width / pointCountX
    : width / (pointCountX - 1);
  const yStep = useCellCenters
    ? height / pointCountY
    : height / (pointCountY - 1);
  const xStart = useCellCenters ? xStep * 0.5 : 0;
  const yStart = useCellCenters ? yStep * 0.5 : 0;

  const out: number[] = [];
  for (let yi = 0; yi < pointCountY; yi++) {
    const z = yStart + yi * yStep + oz;
    for (let xi = 0; xi < pointCountX; xi++) {
      const x = xStart + xi * xStep + ox;
      out.push(x, 0, z);
    }
  }

  return out;
}

/**
 * Convert points to sphere normals
 */
function toSphereNormals(points: number[]): number[] {
  const result = new Array<number>(points.length);

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    const magnitude = Math.sqrt(x ** 2 + y ** 2 + z ** 2);

    result[i] = x / magnitude;
    result[i + 1] = y / magnitude;
    result[i + 2] = z / magnitude;
  }

  return result;
}

/**
 * Generate indices for the octahedron plane mesh
 */
function createOctPlaneIndices(
  isFull: number,
  xCells: number,
  yCells: number,
): number[] {
  const out: number[] = [];
  const xLen = xCells + 1;
  const xHalf = Math.floor(xCells * 0.5);
  const yHalf = Math.floor(yCells * 0.5);

  for (let y = 0; y < yCells; y++) {
    const r0 = xLen * y;
    const r1 = xLen * (y + 1);

    for (let x = 0; x < xCells; x++) {
      const a = r0 + x;
      const b = r1 + x;
      const c = r1 + x + 1;
      const d = r0 + x + 1;
      const alt = (Math.floor(x / xHalf) + Math.floor(y / yHalf)) % 2;

      if (alt === isFull) {
        out.push(a, b, c, c, d, a); // backward slash
      } else {
        out.push(d, a, b, b, c, d); // forward slash
      }
    }
  }

  return out;
}

/**
 * Map points to hemisphere octahedron
 * Reference: Godot Octahedral Impostors
 */
function mapToHemisphere(points: number[]): void {
  const radius = 0.5;

  for (let i = 0; i < points.length; i += 3) {
    // Convert to UV space (0 to 1)
    const u = points[i] + 0.5;
    const v = points[i + 2] + 0.5;

    // UV to hemisphere direction
    const x = u - v;
    const z = -1 + u + v;
    const y = 1 - Math.abs(x) - Math.abs(z);

    // Normalize and apply radius
    const magnitude = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    points[i] = (x / magnitude) * radius;
    points[i + 1] = (y / magnitude) * radius;
    points[i + 2] = (z / magnitude) * radius;
  }
}

/**
 * Map points to full sphere octahedron
 * Reference: Godot Octahedral Impostors
 */
function mapToFullSphere(points: number[]): void {
  const radius = 0.5;

  for (let i = 0; i < points.length; i += 3) {
    // Convert to -1 to 1 range
    const u = points[i] * 2.0;
    const v = points[i + 2] * 2.0;

    // North hemisphere
    let x = u;
    let z = v;
    let y = 1 - Math.abs(x) - Math.abs(z);

    // Fix XZ for south hemisphere
    if (y < 0) {
      const ox = x;
      const oz = z;
      x = Math.sign(ox) * (1.0 - Math.abs(oz));
      z = Math.sign(oz) * (1.0 - Math.abs(ox));
    }

    // Normalize and apply radius
    const magnitude = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    points[i] = (x / magnitude) * radius;
    points[i + 1] = (y / magnitude) * radius;
    points[i + 2] = (z / magnitude) * radius;
  }
}

/**
 * Create the debug visualization material
 * Uses MeshNormalMaterial which is WebGPU/TSL compatible
 */
function createDebugMaterial(): THREE.MeshNormalMaterial {
  return new THREE.MeshNormalMaterial({
    depthTest: true,
    transparent: true,
    opacity: 0.75,
    side: THREE.FrontSide,
  });
}

/**
 * Build an octahedron mesh with the specified configuration
 *
 * @param octType - The octahedron mapping type (HEMI or FULL)
 * @param gridSizeX - Number of points/cells horizontally (columns)
 * @param gridSizeY - Number of points/cells vertically (rows) - defaults to gridSizeX for square grid
 * @param position - Optional position offset [x, y, z]
 * @returns The octahedron mesh data
 */
export function buildOctahedronMesh(
  octType: OctahedronTypeValue,
  gridSizeX: number,
  gridSizeY: number = gridSizeX,
  position: number[] = [0, 0, 0],
  useCellCenters = true,
): OctahedronMeshData {
  // gridSizeX/Y = number of points/cells per axis
  const planePoints = createGridPoints(
    gridSizeX,
    gridSizeY,
    1,
    1,
    true,
    useCellCenters,
  );
  const indices = createOctPlaneIndices(octType, gridSizeX - 1, gridSizeY - 1);

  // Create octahedron-mapped points
  const octPoints = planePoints.slice();
  if (octType === OctahedronType.HEMI) {
    mapToHemisphere(octPoints);
  } else {
    mapToFullSphere(octPoints);
  }

  const normals = toSphereNormals(octPoints);

  // Create geometry
  const geometry = createGeometryBuffer({
    vertices: planePoints,
    indices,
    normals,
  });

  // Create meshes
  const wireframeMat = new MeshBasicNodeMaterial();
  wireframeMat.color = new THREE.Color(0xffffff);
  wireframeMat.wireframe = true;
  const wireframeMesh = new THREE.Mesh(geometry, wireframeMat);
  const filledMesh = new THREE.Mesh(geometry, createDebugMaterial());

  // Apply position
  wireframeMesh.position.fromArray(position);
  wireframeMesh.position.y += 0.001;
  filledMesh.position.fromArray(position);
  filledMesh.scale.setScalar(0.999);

  return {
    wireframeMesh,
    filledMesh,
    planePoints,
    octPoints,
  };
}

/**
 * Interpolate geometry between flat plane and octahedron shape
 *
 * @param meshData - The octahedron mesh data
 * @param t - Interpolation factor (0 = flat, 1 = octahedron)
 */
export function lerpOctahedronGeometry(
  meshData: OctahedronMeshData,
  t: number,
): void {
  const geometry = meshData.wireframeMesh.geometry;
  const positionAttr = geometry.attributes.position;
  const positions = positionAttr.array as Float32Array;
  const ti = 1 - t;

  for (let i = 0; i < meshData.planePoints.length; i++) {
    positions[i] = meshData.planePoints[i] * ti + meshData.octPoints[i] * t;
  }

  positionAttr.needsUpdate = true;
}

/**
 * Get the view direction for a given UV coordinate in the octahedron mapping
 *
 * @param u - U coordinate (0-1)
 * @param v - V coordinate (0-1)
 * @param octType - The octahedron mapping type
 * @returns The view direction as a normalized Vector3
 */
export function getViewDirection(
  u: number,
  v: number,
  octType: OctahedronTypeValue,
): THREE.Vector3 {
  const direction = new THREE.Vector3();

  if (octType === OctahedronType.HEMI) {
    const x = u - v;
    const z = -1 + u + v;
    const y = 1 - Math.abs(x) - Math.abs(z);
    direction.set(x, y, z).normalize();
  } else {
    // Full sphere mapping
    const mappedU = (u - 0.5) * 2;
    const mappedV = (v - 0.5) * 2;

    let x = mappedU;
    let z = mappedV;
    let y = 1 - Math.abs(x) - Math.abs(z);

    if (y < 0) {
      const ox = x;
      const oz = z;
      x = Math.sign(ox) * (1.0 - Math.abs(oz));
      z = Math.sign(oz) * (1.0 - Math.abs(ox));
    }

    direction.set(x, y, z).normalize();
  }

  return direction;
}
