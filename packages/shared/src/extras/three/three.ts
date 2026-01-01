/**
 * three.ts - Three.js WebGPU Extensions
 *
 * Enhanced Three.js import with WebGPU renderer and BVH raycasting.
 * Exports WebGPU build of Three.js with TSL (Three Shading Language) functions.
 *
 * TSL API Notes (three.js 0.180.0):
 * - TSL functions are in THREE_NAMESPACE.TSL, not direct exports from three/webgpu
 * - Node materials (MeshStandardNodeMaterial, etc.) ARE direct exports
 * - Bloom effect is in three/examples/jsm/tsl/display/BloomNode.js
 * - TSL requires WebGPU context - cannot run in Node.js or WebGL fallback
 *
 * Browser Requirements:
 * - Chrome 113+, Edge 113+, Safari 17+ for WebGPU support
 * - See RendererFactory.isWebGPUAvailable() for detection
 */

import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";

// Import WebGPU build of Three.js
import * as THREE_NAMESPACE from "three/webgpu";

// TSL functions are exported under the TSL namespace in three/webgpu
// Re-export them at top level for convenience
export const {
  // Node building functions
  Fn,
  If,
  // Shader nodes - inputs
  uv,
  positionLocal,
  positionWorld,
  positionView,
  normalLocal,
  normalWorld,
  normalView,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraNear,
  cameraFar,
  modelViewMatrix,
  modelWorldMatrix,
  modelNormalMatrix,
  instanceIndex,
  // Uniform and attribute
  uniform,
  attribute,
  instancedBufferAttribute,
  vertexColor,
  // Math nodes
  float,
  int,
  uint,
  vec2,
  vec3,
  vec4,
  mat2,
  mat3,
  mat4,
  // Operators
  add,
  sub,
  mul,
  div,
  mod,
  // Math functions
  abs,
  acos,
  asin,
  atan,
  ceil,
  clamp,
  cos,
  cross,
  degrees,
  distance,
  dot,
  exp,
  exp2,
  floor,
  fract,
  inversesqrt,
  length,
  log,
  log2,
  max,
  min,
  mix,
  normalize,
  pow,
  radians,
  reflect,
  refract,
  round,
  saturate,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  tan,
  // Texture
  texture,
  texture3D,
  // Discard
  Discard: discard,
  // Display
  output,
  renderOutput,
  // Post-processing
  pass,
  mrt,
  // Reflection
  reflector,
} = THREE_NAMESPACE.TSL;

// Re-export Node Materials (these ARE directly on three/webgpu)
export {
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  SpriteNodeMaterial,
  LineBasicNodeMaterial,
} from "three/webgpu";

// Export the THREE namespace object as the default export
export default THREE_NAMESPACE;

// Re-export the full three.js surface so `import THREE from '../extras/three'` works
export * from "three/webgpu";

/**
 * Type for TSL shader node accumulators.
 * Use this when a variable will be reassigned with results from add(), mul(), etc.
 * These operations return different node types that aren't directly assignable to each other.
 *
 * ShaderNodeObject<Node> provides swizzle properties (.x, .y, .z, .w, .xy, .rgb, etc.)
 * and is the return type of all TSL operations. All TSL functions accept ShaderNodeObject
 * as parameters.
 *
 * For function parameters that accept any shader node, use ShaderNodeInput instead.
 */
import type { Node } from "three/webgpu";
import type { ShaderNodeObject } from "three/tsl";
export type ShaderNode = ShaderNodeObject<Node>;

/**
 * Type for TSL function parameters that accept any shader node.
 * This is more permissive than ShaderNode and allows uniforms, attributes, etc.
 */
export type ShaderNodeInput = Node;

// Pre-allocated temp objects for utility functions to avoid per-call allocations
const _safeDecomposePos = new THREE_NAMESPACE.Vector3();
const _safeDecomposeQuat = new THREE_NAMESPACE.Quaternion();
const _safeDecomposeScale = new THREE_NAMESPACE.Vector3();
const _safeComposePos = new THREE_NAMESPACE.Vector3();
const _safeComposeQuat = new THREE_NAMESPACE.Quaternion();
const _safeComposeScale = new THREE_NAMESPACE.Vector3();

// Vector3 compatibility utilities
export function toTHREEVector3(
  v: THREE_NAMESPACE.Vector3 | { x: number; y: number; z: number },
  target?: THREE_NAMESPACE.Vector3,
): THREE_NAMESPACE.Vector3 {
  if (target) {
    return target.set(v.x, v.y, v.z);
  }
  return new THREE_NAMESPACE.Vector3(v.x, v.y, v.z);
}

// Utility to ensure Matrix decompose operations work correctly
export function safeMatrixDecompose(
  matrix: THREE_NAMESPACE.Matrix4,
  position: THREE_NAMESPACE.Vector3,
  quaternion: THREE_NAMESPACE.Quaternion,
  scale: THREE_NAMESPACE.Vector3,
): void {
  matrix.decompose(_safeDecomposePos, _safeDecomposeQuat, _safeDecomposeScale);
  position.copy(_safeDecomposePos);
  quaternion.copy(_safeDecomposeQuat);
  scale.copy(_safeDecomposeScale);
}

// Utility for Matrix compose operations
export function safeMatrixCompose(
  matrix: THREE_NAMESPACE.Matrix4,
  position: THREE_NAMESPACE.Vector3 | { x: number; y: number; z: number },
  quaternion:
    | THREE_NAMESPACE.Quaternion
    | { x: number; y: number; z: number; w: number },
  scale: THREE_NAMESPACE.Vector3 | { x: number; y: number; z: number },
): void {
  _safeComposePos.set(position.x, position.y, position.z);
  _safeComposeQuat.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  _safeComposeScale.set(scale.x, scale.y, scale.z);
  matrix.compose(_safeComposePos, _safeComposeQuat, _safeComposeScale);
}

// Install three-mesh-bvh for accelerated raycasting
THREE_NAMESPACE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE_NAMESPACE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE_NAMESPACE.Mesh.prototype.raycast = acceleratedRaycast;

// Interface for InstancedMesh with resize method
interface InstancedMeshWithResize extends THREE_NAMESPACE.InstancedMesh {
  resize?: (size: number) => void;
  instanceMatrix: THREE_NAMESPACE.InstancedBufferAttribute;
}

// Utility to resize instanced mesh buffers
(THREE_NAMESPACE.InstancedMesh.prototype as InstancedMeshWithResize).resize =
  function (this: InstancedMeshWithResize, size: number) {
    const prevSize = (this.instanceMatrix.array as Float32Array).length / 16;
    if (size <= prevSize) return;
    const array = new Float32Array(size * 16);
    array.set(this.instanceMatrix.array as Float32Array);
    const attrib = new THREE_NAMESPACE.InstancedBufferAttribute(array, 16);
    this.instanceMatrix = attrib;
    this.instanceMatrix.needsUpdate = true;
  };
