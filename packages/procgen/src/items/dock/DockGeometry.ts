/**
 * Dock Geometry Utilities - Functions for generating dock geometry components
 */

import * as THREE from "three";
import type { PlankData, PostData, RailingData, MooringData } from "./types";

// Constants
const RAIL_THICKNESS = 0.06;
const RAILING_POST_RADIUS = 0.04;
const MOORING_CAP_HEIGHT = 0.08;
const CYLINDER_SEGMENTS = 8;

/** Create a single plank geometry with vertex colors and UVs */
export function createPlankGeometry(plank: PlankData): THREE.BufferGeometry {
  // Create box geometry for the plank
  const geometry = new THREE.BoxGeometry(
    plank.length,
    plank.thickness,
    plank.width,
  );

  // Apply position and rotation
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(
    plank.position.x,
    plank.position.y,
    plank.position.z,
  );
  const rotation = new THREE.Euler(0, plank.rotation, 0);
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);

  matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  geometry.applyMatrix4(matrix);

  // Add vertex colors for wood grain variation
  applyPlankVertexColors(geometry, plank.weathering);

  // Add UVs for texture sampling
  applyWorldSpaceUVs(geometry);

  return geometry;
}

/** Create all plank geometries for a dock section */
export function createPlankGeometries(
  planks: PlankData[],
): THREE.BufferGeometry[] {
  return planks.map(createPlankGeometry);
}

/** Apply vertex colors to plank geometry with weathering variation */
function applyPlankVertexColors(
  geometry: THREE.BufferGeometry,
  weathering: number,
): void {
  const positionAttr = geometry.getAttribute("position");
  const vertexCount = positionAttr.count;
  const colors = new Float32Array(vertexCount * 3);

  // Base wood color - varies based on weathering
  // Fresh wood: warm tan (0.6, 0.5, 0.35)
  // Weathered: gray-brown (0.45, 0.4, 0.35)
  const baseR = 0.6 - weathering * 0.15;
  const baseG = 0.5 - weathering * 0.1;
  const baseB = 0.35;

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const z = positionAttr.getZ(i);

    // Add noise-based variation for wood grain effect
    const noise = simpleNoise3D(x * 2.5, y * 10, z * 2.5);
    const variation = 0.1 + noise * 0.15;

    // Darker at edges (simulate wear)
    const edgeDarkening = Math.min(Math.abs(x) * 0.1, Math.abs(z) * 0.1);

    const shade = Math.max(0.5, 1.0 - edgeDarkening);
    const r = Math.min(1, (baseR + variation * 0.1) * shade);
    const g = Math.min(1, (baseG + variation * 0.08) * shade);
    const b = Math.min(1, (baseB + variation * 0.05) * shade);

    const idx = i * 3;
    colors[idx] = r;
    colors[idx + 1] = g;
    colors[idx + 2] = b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Create a support post geometry */
export function createPostGeometry(post: PostData): THREE.BufferGeometry {
  // Create cylinder geometry for the post
  const geometry = new THREE.CylinderGeometry(
    post.radius,
    post.radius * 1.05, // Slightly wider at base
    post.height,
    CYLINDER_SEGMENTS,
  );

  // Position the post (cylinder is centered, we need bottom at water floor)
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(
    post.position.x,
    post.position.y + post.height / 2,
    post.position.z,
  );
  matrix.setPosition(position);
  geometry.applyMatrix4(matrix);

  // Add vertex colors - darker where submerged
  applyPostVertexColors(geometry, post);

  // Add UVs
  applyCylinderUVs(geometry);

  return geometry;
}

/** Create all support post geometries */
export function createPostGeometries(
  posts: PostData[],
): THREE.BufferGeometry[] {
  return posts.map(createPostGeometry);
}

/** Apply vertex colors to post geometry with water line darkening */
function applyPostVertexColors(
  geometry: THREE.BufferGeometry,
  post: PostData,
): void {
  const positionAttr = geometry.getAttribute("position");
  const vertexCount = positionAttr.count;
  const colors = new Float32Array(vertexCount * 3);

  // Base wood color for posts (darker than planks)
  const baseR = 0.45;
  const baseG = 0.38;
  const baseB = 0.3;

  // Water line Y position (where submerged portion ends)
  const waterLineY = post.position.y + post.submergedHeight;

  for (let i = 0; i < vertexCount; i++) {
    const y = positionAttr.getY(i);

    // Calculate water darkening factor
    let waterFactor = 0;
    if (y < waterLineY) {
      // Below water line - darker and greenish
      const depth = (waterLineY - y) / post.submergedHeight;
      waterFactor = Math.min(1, depth * 0.6);
    }

    // Apply darkening for submerged portion
    const r = baseR * (1 - waterFactor * 0.4);
    const g = baseG * (1 - waterFactor * 0.2); // Less reduction = greenish
    const b = baseB * (1 - waterFactor * 0.3);

    const idx = i * 3;
    colors[idx] = r;
    colors[idx + 1] = g;
    colors[idx + 2] = b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Create railing post geometry */
function createRailingPostGeometry(
  position: { x: number; y: number; z: number },
  height: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    RAILING_POST_RADIUS,
    RAILING_POST_RADIUS,
    height,
    CYLINDER_SEGMENTS,
  );

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3(
    position.x,
    position.y + height / 2,
    position.z,
  );
  matrix.setPosition(pos);
  geometry.applyMatrix4(matrix);

  // Add uniform wood color
  applyUniformWoodColor(geometry, 0.5, 0.42, 0.32);
  applyCylinderUVs(geometry);

  return geometry;
}

/** Create railing rail geometry (horizontal bar) */
function createRailingRailGeometry(
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
): THREE.BufferGeometry {
  // Calculate rail length and direction
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Create box geometry for the rail
  const geometry = new THREE.BoxGeometry(
    length,
    RAIL_THICKNESS,
    RAIL_THICKNESS,
  );

  // Calculate center position
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const centerZ = (start.z + end.z) / 2;

  // Calculate rotation to align with direction
  const direction = new THREE.Vector3(dx, dy, dz).normalize();
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(centerX, centerY, centerZ);
  matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  geometry.applyMatrix4(matrix);

  applyUniformWoodColor(geometry, 0.52, 0.44, 0.34);
  applyWorldSpaceUVs(geometry);

  return geometry;
}

/** Create all railing geometries for a railing section */
export function createRailingGeometries(railing: RailingData): {
  posts: THREE.BufferGeometry[];
  rails: THREE.BufferGeometry[];
} {
  const posts: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];

  // Create posts
  for (const postPos of railing.posts) {
    posts.push(createRailingPostGeometry(postPos, railing.height));
  }

  // Create top rail
  const topRailStart = {
    x: railing.start.x,
    y: railing.start.y + railing.height,
    z: railing.start.z,
  };
  const topRailEnd = {
    x: railing.end.x,
    y: railing.end.y + railing.height,
    z: railing.end.z,
  };
  rails.push(createRailingRailGeometry(topRailStart, topRailEnd));

  // Create mid rail (at half height)
  const midRailStart = {
    x: railing.start.x,
    y: railing.start.y + railing.height * 0.5,
    z: railing.start.z,
  };
  const midRailEnd = {
    x: railing.end.x,
    y: railing.end.y + railing.height * 0.5,
    z: railing.end.z,
  };
  rails.push(createRailingRailGeometry(midRailStart, midRailEnd));

  return { posts, rails };
}

/** Create a mooring post geometry */
export function createMooringGeometry(
  mooring: MooringData,
): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Main post cylinder
  const postGeom = new THREE.CylinderGeometry(
    mooring.radius,
    mooring.radius * 1.1,
    mooring.height,
    CYLINDER_SEGMENTS,
  );
  const postMatrix = new THREE.Matrix4();
  postMatrix.setPosition(
    mooring.position.x,
    mooring.position.y + mooring.height / 2,
    mooring.position.z,
  );
  postGeom.applyMatrix4(postMatrix);

  // Cap on top (wider, for rope)
  const capGeom = new THREE.CylinderGeometry(
    mooring.radius * 1.4,
    mooring.radius * 1.2,
    MOORING_CAP_HEIGHT,
    CYLINDER_SEGMENTS,
  );
  const capMatrix = new THREE.Matrix4();
  capMatrix.setPosition(
    mooring.position.x,
    mooring.position.y + mooring.height + MOORING_CAP_HEIGHT / 2,
    mooring.position.z,
  );
  capGeom.applyMatrix4(capMatrix);

  // Merge geometries
  geometries.push(postGeom, capGeom);

  const merged = mergeBufferGeometries(geometries);

  // Add wood color
  applyUniformWoodColor(merged, 0.4, 0.35, 0.28);
  applyCylinderUVs(merged);

  // Clean up
  geometries.forEach((g) => g.dispose());

  return merged;
}

/** Create all mooring post geometries */
export function createMooringGeometries(
  moorings: MooringData[],
): THREE.BufferGeometry[] {
  return moorings.map(createMooringGeometry);
}

// Utility functions

/** Simple 3D noise for vertex color variation */
function simpleNoise3D(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/** Apply uniform wood color with subtle noise variation */
function applyUniformWoodColor(
  geometry: THREE.BufferGeometry,
  r: number,
  g: number,
  b: number,
): void {
  const positionAttr = geometry.getAttribute("position");
  const vertexCount = positionAttr.count;
  const colors = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const z = positionAttr.getZ(i);

    // Add subtle variation
    const noise = simpleNoise3D(x * 3, y * 3, z * 3) * 0.1;

    const idx = i * 3;
    colors[idx] = Math.min(1, r + noise);
    colors[idx + 1] = Math.min(1, g + noise * 0.8);
    colors[idx + 2] = Math.min(1, b + noise * 0.6);
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Apply cylindrical UVs */
function applyCylinderUVs(geometry: THREE.BufferGeometry): void {
  const positionAttr = geometry.getAttribute("position");
  const vertexCount = positionAttr.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const z = positionAttr.getZ(i);
    const angle = Math.atan2(z, x);
    uvs[i * 2] = angle / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = y;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/** Apply world-space UVs based on face normal direction */
function applyWorldSpaceUVs(geometry: THREE.BufferGeometry): void {
  const positionAttr = geometry.getAttribute("position");
  const normalAttr = geometry.getAttribute("normal");
  const vertexCount = positionAttr.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const z = positionAttr.getZ(i);
    const absNx = Math.abs(normalAttr.getX(i));
    const absNy = Math.abs(normalAttr.getY(i));
    const absNz = Math.abs(normalAttr.getZ(i));

    // Project UVs based on dominant normal direction
    if (absNy > absNx && absNy > absNz) {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = z;
    } else if (absNx > absNz) {
      uvs[i * 2] = z;
      uvs[i * 2 + 1] = y;
    } else {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = y;
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/** Merge multiple buffer geometries into one */
function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  // Calculate total vertex count
  let totalVertices = 0;
  for (const geom of geometries) {
    totalVertices += geom.getAttribute("position").count;
  }

  // Create merged arrays
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);

  let offset = 0;
  for (const geom of geometries) {
    const posAttr = geom.getAttribute("position");
    const normAttr = geom.getAttribute("normal");
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      const idx = (offset + i) * 3;
      positions[idx] = posAttr.getX(i);
      positions[idx + 1] = posAttr.getY(i);
      positions[idx + 2] = posAttr.getZ(i);
      normals[idx] = normAttr.getX(i);
      normals[idx + 1] = normAttr.getY(i);
      normals[idx + 2] = normAttr.getZ(i);
    }
    offset += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  return merged;
}

/** Compute flat normals for a geometry */
export function computeFlatNormals(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const positionAttr = geometry.getAttribute("position");
  const vertexCount = positionAttr.count;

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    return geometry;
  }

  const normals = new Float32Array(vertexCount * 3);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  const triangleCount = vertexCount / 3;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = t * 3;
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;

    p0.set(positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0));
    p1.set(positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1));
    p2.set(positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2));

    edge1.subVectors(p1, p0);
    edge2.subVectors(p2, p0);
    faceNormal.crossVectors(edge1, edge2);

    const lengthSq = faceNormal.lengthSq();
    if (lengthSq > 1e-12) {
      faceNormal.normalize();
    } else {
      faceNormal.set(0, 1, 0);
    }

    for (let vi = 0; vi < 3; vi++) {
      const idx = (t * 3 + vi) * 3;
      normals[idx] = faceNormal.x;
      normals[idx + 1] = faceNormal.y;
      normals[idx + 2] = faceNormal.z;
    }
  }

  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}
