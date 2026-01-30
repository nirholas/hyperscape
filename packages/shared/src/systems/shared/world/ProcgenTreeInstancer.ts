/**
 * ProcgenTreeInstancer - AAA Instanced Rendering for Procedural Trees
 *
 * Architecture:
 * - TRUNK INSTANCING: Each tree's trunk/branches are instanced per-tree
 * - GLOBAL LEAF INSTANCING: All leaves across all trees share ONE InstancedMesh
 *   - Single leaf card geometry (2 triangles)
 *   - Per-leaf attributes: world transform, color, fade
 *   - ONE draw call for ALL leaves = massive performance win
 *
 * Features:
 * - Cross-fade LOD transitions (AAA-1): Screen-space dithering dissolve
 * - Wind animation (AAA-2): TSL vertex shader displacement on leaves
 * - Shadow LODs (AAA-3): Simplified cone+cylinder shadow geometry
 * - Vertex color batching (AAA-4): Single material per LOD level
 * - GPU-instanced leaves (AAA-5): Single draw call for all foliage
 *
 * LOD Levels: LOD0 (0-30m) → LOD1 (30-60m) → LOD2 (60-120m) → Impostor (120-200m) → Culled
 */

import THREE, {
  uniform,
  Fn,
  float,
  vec3,
  vec4,
  add,
  sub,
  mul,
  div,
  sin,
  abs,
  fract,
  floor,
  smoothstep,
  mix,
  dot,
  normalize,
  positionLocal,
  normalLocal,
  screenUV,
  viewportSize,
  uv,
  attribute,
  MeshStandardNodeMaterial,
  Discard,
  If,
} from "../../../extras/three/three";
import type { World } from "../../../core/World";
import { ImpostorManager, BakePriority } from "../rendering/ImpostorManager";
import {
  createTSLImpostorMaterial,
  type TSLImpostorMaterial,
} from "@hyperscape/impostor";
import type { Wind } from "./Wind";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_INSTANCES = 2000;
const LOD_FADE_MS = 300;
const LOD_UPDATE_MS = 100;
const LOD_UPDATES_PER_FRAME = 50;
const IMPOSTOR_SIZE = 1024;
const HYSTERESIS_SQ = 25; // 5m buffer

const LOD_DIST = { lod1: 30, lod2: 60, impostor: 120, cull: 200 };
const LOD_DIST_SQ = {
  lod1: LOD_DIST.lod1 ** 2,
  lod2: LOD_DIST.lod2 ** 2,
  impostor: LOD_DIST.impostor ** 2,
  cull: LOD_DIST.cull ** 2,
};

const WIND = {
  speed: 0.8,
  maxBend: 0.25,
  heightThreshold: 0.3,
  spatialFreq: 0.08,
  gustSpeed: 0.4,
};

// ============================================================================
// TYPES
// ============================================================================

interface TreeInstance {
  id: string;
  position: THREE.Vector3;
  rotation: number;
  scale: number;
  currentLOD: number; // 0-4: lod0, lod1, lod2, impostor, culled
  lodIndices: [number, number, number, number]; // [lod0, lod1, lod2, impostor] mesh indices
  transition: { from: number; to: number; start: number } | null;
  radius: number;
  hasGlobalLeaves: boolean; // Whether leaves are added to global buffer
}

interface MeshData {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.InstancedMesh;
  fadeAttr: THREE.InstancedBufferAttribute;
  idxToId: Map<number, string>;
  nextIdx: number;
  count: number;
  dirty: boolean;
  shadowMesh: THREE.InstancedMesh | null;
  shadowGeo: THREE.BufferGeometry | null;
}

interface ImpostorMeshData {
  geometry: THREE.BufferGeometry;
  material: TSLImpostorMaterial;
  mesh: THREE.InstancedMesh;
  idxToId: Map<number, string>;
  nextIdx: number;
  count: number;
  dirty: boolean;
  width: number;
  height: number;
}

interface TreeDims {
  width: number;
  height: number;
  canopyR: number;
  trunkH: number;
}

interface WindMat extends THREE.MeshStandardNodeMaterial {
  windUniforms: {
    time: { value: number };
    strength: { value: number };
    direction: { value: THREE.Vector3 };
  };
}

type LODKey = "lod0" | "lod1" | "lod2";

interface LeafNodeMaterial extends THREE.MeshStandardNodeMaterial {
  leafUniforms: {
    time: ReturnType<typeof uniform<number>>;
    windStrength: ReturnType<typeof uniform<number>>;
    windDirection: ReturnType<typeof uniform<THREE.Vector3>>;
    baseColor: ReturnType<typeof uniform<THREE.Color>>;
  };
}

// ============================================================================
// GLOBAL LEAF INSTANCER
// ============================================================================

const MAX_GLOBAL_LEAVES = 100000; // 100K leaves total capacity
const LEAF_CARD_SIZE = 0.15; // Base leaf card size in meters

/**
 * Global leaf instance manager - renders ALL leaves with ONE draw call.
 *
 * Instead of merging leaf geometry into each tree, we maintain a global
 * buffer of leaf transforms. When a tree is shown/hidden/LOD-changed,
 * we update its leaves' visibility in the global buffer.
 *
 * IMPLEMENTATION NOTES:
 * - Uses TSL positionNode for vertex shader wind animation (verified pattern from GrassSystem.ts)
 * - mesh.layers.set(1) must match camera layer configuration for visibility
 * - Wind uniforms are updated via leafUniforms.xxx.value property (TSL uniform pattern)
 * - Pre-allocates MAX_GLOBAL_LEAVES matrices (~6.4MB) - adjust for mobile if needed
 */
class GlobalLeafInstancer {
  private geometry: THREE.BufferGeometry;
  private material: LeafNodeMaterial;
  private mesh: THREE.InstancedMesh;

  // Instance attributes
  private matrices: THREE.Matrix4[];
  private colors: Float32Array;
  private fades: Float32Array;
  private matrixAttr: THREE.InstancedBufferAttribute;
  private colorAttr: THREE.InstancedBufferAttribute;
  private fadeAttr: THREE.InstancedBufferAttribute;

  // Bookkeeping
  private leafMap: Map<string, number[]> = new Map(); // treeId -> leaf indices
  private freeIndices: number[] = [];
  private nextIndex = 0;
  private count = 0;
  private dirty = false;

  // Wind uniforms
  private windTime = 0;
  private windStrength = 1;
  private windDir = new THREE.Vector3(1, 0, 0);

  constructor(scene: THREE.Scene) {
    // Create single leaf card geometry (2 triangles)
    this.geometry = this.createLeafCardGeometry();

    // Create instanced leaf material with wind animation
    this.material = this.createLeafMaterial();

    // Create instanced mesh
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      MAX_GLOBAL_LEAVES,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "GlobalLeaves";
    this.mesh.layers.set(1); // Match other tree meshes for camera layer filtering
    scene.add(this.mesh);

    // Initialize instance arrays
    this.matrices = new Array(MAX_GLOBAL_LEAVES)
      .fill(null)
      .map(() => new THREE.Matrix4());
    this.colors = new Float32Array(MAX_GLOBAL_LEAVES * 3);
    this.fades = new Float32Array(MAX_GLOBAL_LEAVES).fill(1);

    // Create custom attributes for color and fade
    this.colorAttr = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceColor", this.colorAttr);

    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fades, 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceFade", this.fadeAttr);

    // Matrix attribute is built into InstancedMesh
    this.matrixAttr = this.mesh
      .instanceMatrix as THREE.InstancedBufferAttribute;
  }

  private createLeafCardGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const s = LEAF_CARD_SIZE;

    // Simple quad centered at origin
    const positions = new Float32Array([
      -s,
      0,
      0, // bottom-left
      s,
      0,
      0, // bottom-right
      s,
      s * 1.5,
      0, // top-right
      -s,
      s * 1.5,
      0, // top-left
    ]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    return geo;
  }

  private createLeafMaterial(): LeafNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Create uniforms for wind animation
    const uTime = uniform(0);
    const uWindStrength = uniform(1);
    const uWindDirection = uniform(new THREE.Vector3(1, 0, 0));
    const uBaseColor = uniform(new THREE.Color(0x3d7a3d));

    // Get per-instance attributes
    const instanceColor = attribute("instanceColor", "vec3");
    const instanceFade = attribute("instanceFade", "float");

    // Wind animation constants
    const WIND_SPEED = 2.0;
    const WIND_AMPLITUDE = 0.08;
    const GUST_SPEED = 0.7;
    const GUST_AMPLITUDE = 0.03;

    // Position node with ACTUAL wind animation
    // This displaces leaf vertices based on wind uniforms
    const positionNode = Fn(() => {
      const pos = positionLocal;

      // Use world position (approximated from local) for spatial variation
      // Leaves higher in local space sway more
      const heightFactor = smoothstep(
        0.0,
        0.3,
        pos.y.div(LEAF_CARD_SIZE * 1.5),
      );

      // Main wind wave using time and position for spatial coherence
      const phase = add(mul(pos.x, 0.5), mul(pos.z, 0.7));
      const mainWave = sin(add(mul(uTime, WIND_SPEED), phase));

      // Secondary gust wave at different frequency
      const gustPhase = mul(phase, 1.3);
      const gustWave = sin(add(mul(uTime, GUST_SPEED), gustPhase));

      // Combine waves with wind strength
      const waveSum = add(
        mul(mainWave, WIND_AMPLITUDE),
        mul(gustWave, GUST_AMPLITUDE),
      );
      const displacement = mul(mul(waveSum, heightFactor), uWindStrength);

      // Apply displacement along wind direction
      const offsetX = mul(displacement, uWindDirection.x);
      const offsetZ = mul(displacement, uWindDirection.z);

      return vec3(add(pos.x, offsetX), pos.y, add(pos.z, offsetZ));
    })();

    material.positionNode = positionNode;

    // Color node: provides diffuse color for PBR lighting (returns vec3)
    material.colorNode = Fn(() => {
      // Base color: use instance color if set (r > 0.01), otherwise uniform base color
      // mix() needs float for third param, so convert boolean comparison to float
      const hasColorFloat = smoothstep(0.0, 0.02, instanceColor.x);
      const baseColor = mix(uBaseColor, instanceColor, hasColorFloat);

      // Add subtle variation based on UV for more natural look
      const uvCoord = uv();
      const variation = mul(sub(uvCoord.y, 0.5), 0.1); // Slightly darker at bottom
      const variedColor = add(baseColor, vec3(variation, variation, variation));

      return variedColor; // vec3 for colorNode
    })();

    // Opacity node: handles leaf shape cutout and LOD fade (via alpha test)
    material.opacityNode = Fn(() => {
      // Get UV coordinates for leaf shape
      const uvCoord = uv();

      // Leaf shape: ellipse cutout
      const px = sub(uvCoord.x, 0.5);
      const py = sub(uvCoord.y, 0.4);
      const a = float(0.35);
      const b = float(0.5);
      const d = add(div(mul(px, px), mul(a, a)), div(mul(py, py), mul(b, b)));
      const shapeAlpha = sub(1.0, smoothstep(0.85, 1.0, d));

      // Dither-based fade for LOD transitions
      const screenCoord = mul(screenUV, viewportSize);
      const ditherS = add(
        mul(screenCoord.x, 12.9898),
        mul(screenCoord.y, 78.233),
      );
      const ditherVal = fract(mul(sin(ditherS), 43758.5453));

      // Fade out when instanceFade < ditherVal (gives dithered dissolve effect)
      const fadeAlpha = smoothstep(0.0, 0.1, sub(instanceFade, ditherVal));

      // Combine shape and fade
      return mul(shapeAlpha, fadeAlpha);
    })();

    material.side = THREE.DoubleSide;
    material.transparent = true; // Required for opacity node
    material.alphaTest = 0.5; // Cutout threshold
    material.depthWrite = true;
    material.roughness = 0.8;
    material.metalness = 0.0;

    // Store uniforms for updates - these ARE used by positionNode
    (material as LeafNodeMaterial).leafUniforms = {
      time: uTime,
      windStrength: uWindStrength,
      windDirection: uWindDirection,
      baseColor: uBaseColor,
    };

    return material as LeafNodeMaterial;
  }

  /**
   * Add leaves for a tree.
   * @param treeId Unique tree identifier
   * @param leafTransforms Array of world-space transforms for each leaf
   * @param color Leaf color for this tree
   * @returns Array of indices allocated for these leaves
   */
  addTreeLeaves(
    treeId: string,
    leafTransforms: THREE.Matrix4[],
    color: THREE.Color = new THREE.Color(0x3d7a3d),
  ): number[] {
    // Remove existing leaves for this tree if any
    this.removeTreeLeaves(treeId);

    const indices: number[] = [];
    const r = color.r,
      g = color.g,
      b = color.b;

    for (const transform of leafTransforms) {
      // Get next available index
      const idx = this.freeIndices.pop() ?? this.nextIndex++;
      if (idx >= MAX_GLOBAL_LEAVES) continue;

      indices.push(idx);

      // Set transform
      this.matrices[idx].copy(transform);
      this.mesh.setMatrixAt(idx, this.matrices[idx]);

      // Set color
      this.colors[idx * 3] = r;
      this.colors[idx * 3 + 1] = g;
      this.colors[idx * 3 + 2] = b;

      // Set fade to visible
      this.fades[idx] = 1;

      this.count = Math.max(this.count, idx + 1);
    }

    this.leafMap.set(treeId, indices);
    this.dirty = true;

    return indices;
  }

  /**
   * Remove all leaves for a tree.
   */
  removeTreeLeaves(treeId: string): void {
    const indices = this.leafMap.get(treeId);
    if (!indices) return;

    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    for (const idx of indices) {
      // Hide by setting scale to 0
      this.mesh.setMatrixAt(idx, zeroMatrix);
      this.freeIndices.push(idx);
    }

    this.leafMap.delete(treeId);
    this.dirty = true;
  }

  /**
   * Set fade level for a tree's leaves (for LOD transitions).
   */
  setTreeFade(treeId: string, fade: number): void {
    const indices = this.leafMap.get(treeId);
    if (!indices) return;

    for (const idx of indices) {
      this.fades[idx] = fade;
    }
    this.fadeAttr.needsUpdate = true;
  }

  /**
   * Update wind and flush dirty state.
   */
  update(dt: number, windStrength: number, windDir: THREE.Vector3): void {
    this.windTime += dt;
    this.windStrength = windStrength;
    this.windDir.copy(windDir);

    // Update TSL uniforms
    this.material.leafUniforms.time.value = this.windTime;
    this.material.leafUniforms.windStrength.value = windStrength;
    this.material.leafUniforms.windDirection.value.copy(windDir);

    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.fadeAttr.needsUpdate = true;
      this.mesh.count = this.count;
      this.dirty = false;
    }
  }

  getStats(): { count: number; capacity: number; drawCalls: number } {
    return {
      count: this.leafMap.size,
      capacity: MAX_GLOBAL_LEAVES,
      drawCalls: 1, // Always 1!
    };
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ============================================================================
// MATERIAL HELPERS
// ============================================================================

/** Copy material properties from source to target including textures */
function copyMaterialProps(
  target: THREE.MeshStandardNodeMaterial,
  source: THREE.Material,
): void {
  if (source instanceof THREE.MeshStandardMaterial) {
    // Color and basic properties
    target.color.copy(source.color);
    target.roughness = source.roughness;
    target.metalness = source.metalness;
    target.side = source.side;
    target.opacity = source.opacity;
    target.alphaTest = source.alphaTest;
    target.flatShading = source.flatShading;

    // Textures - critical for proper rendering
    if (source.map) {
      target.map = source.map;
      target.map.needsUpdate = true;
    }
    if (source.normalMap) {
      target.normalMap = source.normalMap;
      target.normalScale.copy(source.normalScale);
    }
    if (source.roughnessMap) target.roughnessMap = source.roughnessMap;
    if (source.metalnessMap) target.metalnessMap = source.metalnessMap;
    if (source.aoMap) {
      target.aoMap = source.aoMap;
      target.aoMapIntensity = source.aoMapIntensity;
    }
    if (source.emissiveMap) {
      target.emissiveMap = source.emissiveMap;
      target.emissive.copy(source.emissive);
      target.emissiveIntensity = source.emissiveIntensity;
    }
    if (source.envMap) {
      target.envMap = source.envMap;
      target.envMapIntensity = source.envMapIntensity;
    }

    // Copy vertex colors flag
    target.vertexColors = source.vertexColors;
  } else if (source instanceof THREE.MeshLambertMaterial) {
    target.color.copy(source.color);
    target.side = source.side;
    target.opacity = source.opacity;
    target.alphaTest = source.alphaTest;
    target.flatShading = source.flatShading;
    target.vertexColors = source.vertexColors;
    if (source.map) {
      target.map = source.map;
      target.map.needsUpdate = true;
    }
    if (source.aoMap) {
      target.aoMap = source.aoMap;
      target.aoMapIntensity = source.aoMapIntensity;
    }
    if (source.emissiveMap) {
      target.emissiveMap = source.emissiveMap;
      target.emissive.copy(source.emissive);
      target.emissiveIntensity = source.emissiveIntensity;
    }
  } else if (source instanceof THREE.MeshBasicMaterial) {
    target.color.copy(source.color);
    target.side = source.side;
    target.opacity = source.opacity;
    target.alphaTest = source.alphaTest;
    target.vertexColors = source.vertexColors;
    if (source.map) {
      target.map = source.map;
      target.map.needsUpdate = true;
    }
    if (source.aoMap) {
      target.aoMap = source.aoMap;
      target.aoMapIntensity = source.aoMapIntensity;
    }
    if (source.envMap) {
      target.envMap = source.envMap;
    }
  }

  // Mark material for recompilation
  target.needsUpdate = true;
}

/** Create screen-space dithering opacity node */
function createDitherOpacity() {
  const fade = attribute("instanceFade", "float");
  return Fn(() => {
    const screen = screenUV.mul(viewportSize);
    const px = floor(screen.x).mod(float(4));
    const py = floor(screen.y).mod(float(4));
    const threshold = fract(mul(add(mul(py, float(4)), px), float(0.0625)));
    If(fade.greaterThan(threshold).not(), () => Discard());
    return float(1);
  })();
}

/** Create wind-animated material for LOD1 */
function createWindMaterial(base: THREE.Material, dims: TreeDims): WindMat {
  const mat = new MeshStandardNodeMaterial();
  copyMaterialProps(mat, base);

  const uTime = uniform(0);
  const uStrength = uniform(1);
  const uDir = uniform(new THREE.Vector3(1, 0, 0));
  const h = float(dims.height);

  mat.positionNode = Fn(() => {
    const pos = positionLocal;
    const normH = pos.y.div(h);
    const influence = smoothstep(float(WIND.heightThreshold), float(1), normH);
    const topInf = mul(influence, influence);

    const phase = add(
      mul(pos.x, float(WIND.spatialFreq)),
      mul(pos.z, float(WIND.spatialFreq * 1.3)),
    );
    const wave1 = sin(add(mul(uTime, float(WIND.speed)), phase));
    const wave2 = sin(
      add(mul(uTime, float(WIND.gustSpeed)), mul(phase, float(0.7))),
    );
    const combined = add(mul(wave1, float(0.7)), mul(wave2, float(0.3)));
    const bend = mul(
      mul(combined, topInf),
      mul(uStrength, float(WIND.maxBend)),
    );

    const bendX = mul(mul(bend, uDir.x), pos.y);
    const bendZ = mul(mul(bend, uDir.z), pos.y);
    return vec3(add(pos.x, bendX), pos.y, add(pos.z, bendZ));
  })();

  mat.opacityNode = createDitherOpacity();
  mat.side = THREE.DoubleSide;
  mat.shadowSide = THREE.FrontSide;
  mat.transparent = false;

  const windMat = mat as WindMat;
  windMat.windUniforms = { time: uTime, strength: uStrength, direction: uDir };
  return windMat;
}

/** Create dissolve material for LOD0/LOD2 */
function createDissolveMaterial(
  base: THREE.Material,
): THREE.MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  copyMaterialProps(mat, base);
  mat.opacityNode = createDitherOpacity();
  mat.side = THREE.DoubleSide;
  mat.transparent = false;
  mat.alphaTest = 0;
  return mat;
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

/** Merge buffer geometries into one */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0];

  let totalVerts = 0,
    totalIdx = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    if (p) totalVerts += p.count;
    totalIdx += g.index?.count ?? p?.count ?? 0;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);

  let vOff = 0,
    iOff = 0,
    vBase = 0;
  for (const g of geos) {
    const pos = g.attributes.position;
    if (!pos) continue;

    positions.set(pos.array as Float32Array, vOff * 3);
    if (g.attributes.normal)
      normals.set(g.attributes.normal.array as Float32Array, vOff * 3);

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + vBase;
      iOff += idx.length;
    } else {
      for (let i = 0; i < pos.count; i++) indices[iOff + i] = i + vBase;
      iOff += pos.count;
    }
    vBase += pos.count;
    vOff += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  if (normals.every((n) => n === 0)) merged.computeVertexNormals();
  return merged;
}

/** Generate shadow geometry (cone + cylinder) */
function createShadowGeo(
  dims: TreeDims,
  simple: boolean,
): THREE.BufferGeometry {
  const { height, canopyR, trunkH } = dims;
  if (simple) {
    const geo = new THREE.CylinderGeometry(
      canopyR * 0.6,
      canopyR * 0.3,
      height,
      4,
      1,
    );
    geo.translate(0, height / 2, 0);
    return geo;
  }

  const trunkR = canopyR * 0.15;
  const trunk = new THREE.CylinderGeometry(trunkR, trunkR * 1.2, trunkH, 6, 1);
  trunk.translate(0, trunkH / 2, 0);

  const canopyH = height - trunkH;
  const cone = new THREE.ConeGeometry(canopyR, canopyH, 8, 1);
  cone.translate(0, trunkH + canopyH / 2, 0);

  const merged = mergeGeometries([trunk, cone]);
  trunk.dispose();
  cone.dispose();
  return merged;
}

// ============================================================================
// MAIN CLASS
// ============================================================================

export class ProcgenTreeInstancer {
  private static inst: ProcgenTreeInstancer | null = null;

  private world: World;
  private scene: THREE.Scene;
  private meshes = new Map<string, Map<LODKey, MeshData>>();
  private impostors = new Map<string, ImpostorMeshData>();
  private instances = new Map<string, { preset: string; inst: TreeInstance }>();
  private dims = new Map<string, TreeDims>();
  private windSys: Wind | null;
  private windMats: WindMat[] = [];
  private isWebGPU: boolean;

  // Global leaf instancing
  private globalLeaves: GlobalLeafInstancer | null = null;
  private presetLeafData = new Map<
    string,
    { transforms: THREE.Matrix4[]; color: THREE.Color }
  >();
  private useGlobalLeaves = true; // Enable by default for optimal performance

  // Track pending impostor bakes - trees will use LOD2/LOD1 fallback until ready
  private pendingImpostors = new Set<string>();

  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private camPos = new THREE.Vector3();
  private tempWindDir = new THREE.Vector3();

  private lodEnabled = true;
  private lastLodUpdate = 0;
  private lodIdx = 0;
  private instArray: Array<{ preset: string; inst: TreeInstance }> = [];
  private time = 0;
  private transitions = new Set<string>();

  private constructor(world: World) {
    this.world = world;
    this.scene = world.stage?.scene as THREE.Scene;
    this.windSys = world.getSystem("wind") as Wind | null;
    this.isWebGPU = this.checkWebGPU();

    // Initialize global leaf instancer if scene is available
    if (this.scene && this.useGlobalLeaves) {
      this.globalLeaves = new GlobalLeafInstancer(this.scene);
    }
  }

  static getInstance(world: World): ProcgenTreeInstancer {
    if (!ProcgenTreeInstancer.inst) {
      ProcgenTreeInstancer.inst = new ProcgenTreeInstancer(world);
    }
    return ProcgenTreeInstancer.inst;
  }

  private checkWebGPU(): boolean {
    const stage = this.world.stage as
      | { renderer?: { isWebGPURenderer?: boolean } }
      | undefined;
    return stage?.renderer?.isWebGPURenderer === true;
  }

  // ---------------------------------------------------------------------------
  // REGISTRATION
  // ---------------------------------------------------------------------------

  registerPreset(
    name: string,
    lod0: THREE.Group,
    lod1?: THREE.Group | null,
    lod2?: THREE.Group | null,
  ): void {
    if (this.meshes.has(name)) return;

    const d = this.calcDims(lod0);
    this.dims.set(name, d);

    const data = new Map<LODKey, MeshData>();
    const m0 = this.createMeshData(lod0, name, "lod0", d);
    if (m0) data.set("lod0", m0);
    if (lod1) {
      const m1 = this.createMeshData(lod1, name, "lod1", d);
      if (m1) data.set("lod1", m1);
    }
    if (lod2) {
      const m2 = this.createMeshData(lod2, name, "lod2", d);
      if (m2) data.set("lod2", m2);
    }

    this.meshes.set(name, data);

    // Start impostor bake in background - trees will use LOD fallback until ready
    this.pendingImpostors.add(name);
    this.bakeImpostor(name, lod0).finally(() => {
      this.pendingImpostors.delete(name);
    });

    console.log(
      `[TreeInstancer] ${name}: LOD0=${data.has("lod0")} LOD1=${data.has("lod1")} LOD2=${data.has("lod2")} h=${d.height.toFixed(1)}m`,
    );
  }

  private calcDims(group: THREE.Group): TreeDims {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    return {
      width: Math.max(size.x, size.z),
      height: size.y,
      canopyR: Math.max(size.x, size.z) * 0.5,
      trunkH: size.y * 0.35,
    };
  }

  private async bakeImpostor(name: string, src: THREE.Group): Promise<void> {
    const mgr = ImpostorManager.getInstance(this.world);
    if (!mgr.initBaker()) return;

    const result = await mgr.getOrCreate(`procgen_tree_${name}_v3`, src, {
      atlasSize: IMPOSTOR_SIZE,
      hemisphere: true,
      priority: BakePriority.NORMAL,
      category: "tree_resource",
      gridSizeX: 16,
      gridSizeY: 8,
    });

    if (!result.atlasTexture) return;

    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const w = Math.max(size.x, size.z);
    const h = size.y;

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = createTSLImpostorMaterial({
      atlasTexture: result.atlasTexture,
      gridSizeX: result.gridSizeX,
      gridSizeY: result.gridSizeY,
      transparent: true,
      depthWrite: true,
    });
    this.world.setupMaterial?.(mat);

    const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    mesh.name = `Tree_${name}_impostor`;
    this.scene?.add(mesh);

    this.impostors.set(name, {
      geometry: geo,
      material: mat,
      mesh,
      idxToId: new Map(),
      nextIdx: 0,
      count: 0,
      dirty: false,
      width: w,
      height: h,
    });
  }

  private createMeshData(
    group: THREE.Group,
    name: string,
    lod: LODKey,
    dims: TreeDims,
  ): MeshData | null {
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const leafTransforms: THREE.Matrix4[] = [];
    let leafColor = new THREE.Color(0x3d7a3d);

    group.traverse((child) => {
      // Skip InstancedMesh (leaves) - we handle them separately
      if (child instanceof THREE.InstancedMesh) {
        // Extract leaf transforms for global instancing
        if (this.useGlobalLeaves && lod === "lod0") {
          const instanceCount = child.count;
          const tempMatrix = new THREE.Matrix4();

          for (let i = 0; i < instanceCount; i++) {
            child.getMatrixAt(i, tempMatrix);
            leafTransforms.push(tempMatrix.clone());
          }

          // Extract leaf color from material
          const mat = Array.isArray(child.material)
            ? child.material[0]
            : child.material;
          if (mat && "color" in mat) {
            leafColor = (mat as THREE.MeshStandardMaterial).color.clone();
          }
        }
        return;
      }

      // Regular Mesh - merge into trunk geometry
      if (child instanceof THREE.Mesh && child.geometry) {
        const geo = child.geometry.clone();
        if (!child.matrix.equals(new THREE.Matrix4().identity()))
          geo.applyMatrix4(child.matrix);
        geos.push(geo);
        const m = Array.isArray(child.material)
          ? child.material[0]
          : child.material;
        if (m && !mats.includes(m)) mats.push(m);
      }
    });

    // Store leaf data for this preset
    if (leafTransforms.length > 0 && lod === "lod0") {
      this.presetLeafData.set(name, {
        transforms: leafTransforms,
        color: leafColor,
      });
      console.log(
        `[TreeInstancer] ${name}: Extracted ${leafTransforms.length} leaf transforms for global instancing`,
      );
    }

    if (geos.length === 0) return null;

    const merged = mergeGeometries(geos);
    const baseMat =
      mats[0] ?? new THREE.MeshLambertMaterial({ color: 0x228b22 });

    const material =
      lod === "lod1"
        ? createWindMaterial(baseMat, dims)
        : createDissolveMaterial(baseMat);

    if (lod === "lod1") this.windMats.push(material as WindMat);
    this.world.setupMaterial?.(material);

    const mesh = new THREE.InstancedMesh(merged, material, MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.layers.set(1);
    mesh.name = `Tree_${name}_${lod}`;

    const fadeArr = new Float32Array(MAX_INSTANCES).fill(1);
    const fadeAttr = new THREE.InstancedBufferAttribute(fadeArr, 1);
    fadeAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("instanceFade", fadeAttr);

    let shadowMesh: THREE.InstancedMesh | null = null;
    let shadowGeo: THREE.BufferGeometry | null = null;

    if (lod === "lod0" || lod === "lod1") {
      shadowGeo = createShadowGeo(dims, lod === "lod1");
      const shadowMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
      });

      shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_INSTANCES);
      shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      shadowMesh.count = 0;
      shadowMesh.frustumCulled = false;
      shadowMesh.castShadow = true;
      shadowMesh.receiveShadow = false;
      shadowMesh.layers.set(1);
      shadowMesh.name = `Tree_${name}_${lod}_shadow`;
      this.scene?.add(shadowMesh);
    }

    this.scene?.add(mesh);

    return {
      geometry: merged,
      material,
      mesh,
      fadeAttr,
      idxToId: new Map(),
      nextIdx: 0,
      count: 0,
      dirty: false,
      shadowMesh,
      shadowGeo,
    };
  }

  // ---------------------------------------------------------------------------
  // INSTANCE MANAGEMENT
  // ---------------------------------------------------------------------------

  addInstance(
    preset: string,
    id: string,
    pos: THREE.Vector3,
    rot: number,
    scale: number,
    _lodLevel = 0,
  ): boolean {
    if (!this.meshes.has(preset) || this.instances.has(id))
      return this.instances.has(id);

    const d = this.dims.get(preset);
    const inst: TreeInstance = {
      id,
      position: pos.clone(),
      rotation: rot,
      scale,
      currentLOD: -1,
      lodIndices: [-1, -1, -1, -1],
      transition: null,
      radius: d ? Math.max(d.width, d.height) * scale * 0.5 : 5,
      hasGlobalLeaves: false,
    };

    this.instances.set(id, { preset, inst });
    this.updateLOD(preset, inst);
    return true;
  }

  /**
   * Add leaves for a tree to the global buffer.
   * Transforms leaf positions to world space based on tree transform.
   */
  private addTreeLeavesToGlobal(preset: string, inst: TreeInstance): void {
    if (!this.globalLeaves || inst.hasGlobalLeaves) return;

    const leafData = this.presetLeafData.get(preset);
    if (!leafData || leafData.transforms.length === 0) return;

    // Build tree transform using compose for correct matrix construction
    const treeMatrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      inst.rotation,
    );
    const scaleVec = new THREE.Vector3(inst.scale, inst.scale, inst.scale);
    treeMatrix.compose(inst.position, quat, scaleVec);

    // Transform each leaf to world space
    const worldTransforms: THREE.Matrix4[] = [];
    for (const localTransform of leafData.transforms) {
      const worldTransform = new THREE.Matrix4()
        .copy(localTransform)
        .premultiply(treeMatrix);
      worldTransforms.push(worldTransform);
    }

    // Add to global buffer
    this.globalLeaves.addTreeLeaves(inst.id, worldTransforms, leafData.color);
    inst.hasGlobalLeaves = true;
  }

  /**
   * Remove leaves for a tree from the global buffer.
   */
  private removeTreeLeavesFromGlobal(inst: TreeInstance): void {
    if (!this.globalLeaves || !inst.hasGlobalLeaves) return;

    this.globalLeaves.removeTreeLeaves(inst.id);
    inst.hasGlobalLeaves = false;
  }

  removeInstance(preset: string, id: string, _lodLevel = 0): void {
    const tracked = this.instances.get(id);
    if (!tracked) return;

    // Remove leaves from global buffer
    this.removeTreeLeavesFromGlobal(tracked.inst);

    this.transitions.delete(id);
    for (let lod = 0; lod < 4; lod++)
      this.removeFromLOD(preset, tracked.inst, lod);
    this.instances.delete(id);
  }

  setPresetVisible(preset: string, visible: boolean): void {
    const data = this.meshes.get(preset);
    if (data) {
      for (const d of data.values()) {
        d.mesh.visible = visible;
        if (d.shadowMesh) d.shadowMesh.visible = visible;
      }
    }
    const imp = this.impostors.get(preset);
    if (imp) imp.mesh.visible = visible;
  }

  // ---------------------------------------------------------------------------
  // LOD MANAGEMENT
  // ---------------------------------------------------------------------------

  private updateLOD(preset: string, inst: TreeInstance): void {
    const dx = inst.position.x - this.camPos.x;
    const dz = inst.position.z - this.camPos.z;
    const distSq = dx * dx + dz * dz;
    const cur = inst.currentLOD;
    const meshMap = this.meshes.get(preset);
    const hasImpostor = this.impostors.has(preset);

    // Check what LODs are available for this preset
    const hasLOD0 = meshMap?.has("lod0") ?? false;
    const hasLOD1 = meshMap?.has("lod1") ?? false;
    const hasLOD2 = meshMap?.has("lod2") ?? false;

    // Determine target LOD with hysteresis, considering availability
    let target: number;
    if (distSq >= LOD_DIST_SQ.cull) {
      target = 4; // Culled
    } else if (
      distSq >=
      LOD_DIST_SQ.impostor - (cur === 3 ? HYSTERESIS_SQ : 0)
    ) {
      // Impostor distance: use impostor if available, else fallback
      target = hasImpostor ? 3 : hasLOD2 ? 2 : hasLOD1 ? 1 : 0;
    } else if (distSq >= LOD_DIST_SQ.lod2 - (cur === 2 ? HYSTERESIS_SQ : 0)) {
      // LOD2 distance: use LOD2 if available, else fallback to LOD1 or LOD0
      target = hasLOD2 ? 2 : hasLOD1 ? 1 : 0;
    } else if (distSq >= LOD_DIST_SQ.lod1 - (cur === 1 ? HYSTERESIS_SQ : 0)) {
      // LOD1 distance: use LOD1 if available, else LOD0
      target = hasLOD1 ? 1 : 0;
    } else {
      target = 0; // LOD0 always available
    }

    if (target === cur) return;

    // Handle global leaves visibility
    // Show leaves at LOD0/LOD1, hide at LOD2+ (where cards/impostors are used)
    const showLeaves = target === 0 || target === 1;
    const hadLeaves = cur === 0 || cur === 1;

    if (showLeaves && !hadLeaves) {
      // Transitioning to LOD with leaves - add them
      this.addTreeLeavesToGlobal(preset, inst);
    } else if (!showLeaves && hadLeaves) {
      // Transitioning away from LOD with leaves - remove them
      this.removeTreeLeavesFromGlobal(inst);
    }

    // Cross-fade only for LOD0 <-> LOD1 (both must be available)
    const crossFade =
      cur >= 0 &&
      hasLOD0 &&
      hasLOD1 &&
      ((cur === 0 && target === 1) || (cur === 1 && target === 0));

    if (crossFade) {
      inst.transition = { from: cur, to: target, start: this.time };
      this.transitions.add(inst.id);
      this.addToLOD(preset, inst, target);
      this.setFade(preset, inst, target, 0);
      this.setFade(preset, inst, cur, 1);
    } else {
      this.removeFromLOD(preset, inst, cur);
      this.addToLOD(preset, inst, target);
    }
    inst.currentLOD = target;
  }

  private setFade(
    preset: string,
    inst: TreeInstance,
    lod: number,
    fade: number,
  ): void {
    if (lod < 0 || lod > 2) return;
    const key = ["lod0", "lod1", "lod2"][lod] as LODKey;
    const data = this.meshes.get(preset)?.get(key);
    const idx = inst.lodIndices[lod];
    if (data && idx >= 0) {
      data.fadeAttr.setX(idx, fade);
      data.fadeAttr.needsUpdate = true;
    }
  }

  private addToLOD(preset: string, inst: TreeInstance, lod: number): void {
    const meshMap = this.meshes.get(preset);

    // LOD availability is already checked in updateLOD, so we can use direct access
    if (lod === 0) {
      const d = meshMap?.get("lod0");
      if (d) inst.lodIndices[0] = this.showInMesh(d, inst);
    } else if (lod === 1) {
      const d = meshMap?.get("lod1");
      if (d) inst.lodIndices[1] = this.showInMesh(d, inst);
    } else if (lod === 2) {
      const d = meshMap?.get("lod2");
      if (d) inst.lodIndices[2] = this.showInMesh(d, inst);
    } else if (lod === 3) {
      const d = this.impostors.get(preset);
      if (d) inst.lodIndices[3] = this.showImpostor(d, inst);
    }
    // LOD 4 = culled, nothing to add
  }

  private removeFromLOD(preset: string, inst: TreeInstance, lod: number): void {
    const idx = inst.lodIndices[lod];
    if (idx < 0) return;

    if (lod < 3) {
      const key = ["lod0", "lod1", "lod2"][lod] as LODKey;
      const data = this.meshes.get(preset)?.get(key);
      if (data) {
        data.mesh.setMatrixAt(idx, this.zeroMatrix);
        data.shadowMesh?.setMatrixAt(idx, this.zeroMatrix);
        data.shadowMesh && (data.shadowMesh.instanceMatrix.needsUpdate = true);
        data.idxToId.delete(idx);
        data.dirty = true;
      }
    } else {
      const imp = this.impostors.get(preset);
      if (imp) {
        imp.mesh.setMatrixAt(idx, this.zeroMatrix);
        imp.idxToId.delete(idx);
        imp.dirty = true;
      }
    }
    inst.lodIndices[lod] = -1;
  }

  private showInMesh(data: MeshData, inst: TreeInstance): number {
    const idx = data.nextIdx++;
    if (data.nextIdx >= MAX_INSTANCES) data.nextIdx = 0;

    this.dummy.position.copy(inst.position);
    this.dummy.rotation.set(0, inst.rotation, 0);
    this.dummy.scale.setScalar(inst.scale);
    this.dummy.updateMatrix();

    data.mesh.setMatrixAt(idx, this.dummy.matrix);
    if (data.shadowMesh) {
      data.shadowMesh.setMatrixAt(idx, this.dummy.matrix);
      data.shadowMesh.count = Math.max(data.shadowMesh.count, idx + 1);
      data.shadowMesh.instanceMatrix.needsUpdate = true;
    }

    data.fadeAttr.setX(idx, 1);
    data.fadeAttr.needsUpdate = true;
    data.idxToId.set(idx, inst.id);
    data.count = Math.max(data.count, idx + 1);
    data.mesh.count = data.count;
    data.dirty = true;
    return idx;
  }

  private showImpostor(data: ImpostorMeshData, inst: TreeInstance): number {
    const idx = data.nextIdx++;
    if (data.nextIdx >= MAX_INSTANCES) data.nextIdx = 0;

    this.dummy.position.copy(inst.position);
    this.dummy.position.y += data.height * inst.scale * 0.5;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(data.width * inst.scale, data.height * inst.scale, 1);
    this.dummy.updateMatrix();

    data.mesh.setMatrixAt(idx, this.dummy.matrix);
    data.idxToId.set(idx, inst.id);
    data.count = Math.max(data.count, idx + 1);
    data.mesh.count = data.count;
    data.dirty = true;
    return idx;
  }

  // ---------------------------------------------------------------------------
  // UPDATE LOOP
  // ---------------------------------------------------------------------------

  update(camPos?: THREE.Vector3, dt = 0.016): void {
    this.time = performance.now();
    if (camPos) this.camPos.copy(camPos);
    else this.world.camera?.getWorldPosition(this.camPos);

    this.updateWind(dt);
    this.updateTransitions();

    if (this.lodEnabled && this.time - this.lastLodUpdate >= LOD_UPDATE_MS) {
      this.lastLodUpdate = this.time;

      if (this.instArray.length !== this.instances.size) {
        this.instArray = Array.from(this.instances.values());
      }

      const count = this.instArray.length;
      if (count > 0) {
        const n = Math.min(LOD_UPDATES_PER_FRAME, count);
        for (let i = 0; i < n; i++) {
          const t = this.instArray[(this.lodIdx + i) % count];
          if (t) this.updateLOD(t.preset, t.inst);
        }
        this.lodIdx = (this.lodIdx + n) % count;
      }
    }

    // Upload dirty matrices
    for (const data of this.meshes.values()) {
      for (const d of data.values()) {
        if (d.dirty) {
          d.mesh.instanceMatrix.needsUpdate = true;
          d.dirty = false;
        }
      }
    }
    for (const d of this.impostors.values()) {
      if (d.dirty) {
        d.mesh.instanceMatrix.needsUpdate = true;
        d.dirty = false;
      }
    }

    // Update global leaves
    if (this.globalLeaves) {
      const strength = this.windSys?.uniforms.windStrength.value ?? 1;
      const windDir =
        this.windSys?.uniforms.windDirection.value ??
        new THREE.Vector3(1, 0, 0);
      this.globalLeaves.update(dt, strength, windDir);
    }
  }

  private updateWind(dt: number): void {
    const strength = this.windSys?.uniforms.windStrength.value ?? 1;
    this.tempWindDir.copy(
      this.windSys?.uniforms.windDirection.value ?? new THREE.Vector3(1, 0, 0),
    );

    for (const mat of this.windMats) {
      mat.windUniforms.time.value += dt;
      mat.windUniforms.strength.value = strength;
      mat.windUniforms.direction.value.copy(this.tempWindDir);
    }
  }

  private updateTransitions(): void {
    const toRemove: string[] = [];

    for (const id of this.transitions) {
      const tracked = this.instances.get(id);
      if (!tracked) {
        toRemove.push(id);
        continue;
      }

      const { inst, preset } = tracked;
      const tr = inst.transition;
      if (!tr) {
        toRemove.push(id);
        continue;
      }

      const progress = Math.min(1, (this.time - tr.start) / LOD_FADE_MS);
      this.setFade(preset, inst, tr.to, progress);
      this.setFade(preset, inst, tr.from, 1 - progress);

      if (progress >= 1) {
        this.removeFromLOD(preset, inst, tr.from);
        inst.transition = null;
        toRemove.push(id);
      }
    }

    for (const id of toRemove) this.transitions.delete(id);
  }

  setLODUpdatesEnabled(enabled: boolean): void {
    this.lodEnabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // STATS & CLEANUP
  // ---------------------------------------------------------------------------

  getStats() {
    let draws = 0;
    const byLOD = { lod0: 0, lod1: 0, lod2: 0, impostor: 0, culled: 0 };
    const details: Record<
      string,
      {
        lod0: number;
        lod1: number;
        lod2: number;
        impostor: number;
        hasLOD0: boolean;
        hasLOD1: boolean;
        hasLOD2: boolean;
        hasImpostor: boolean;
      }
    > = {};

    for (const [p, data] of this.meshes) {
      const l0 = data.get("lod0"),
        l1 = data.get("lod1"),
        l2 = data.get("lod2");
      const imp = this.impostors.get(p);

      const c0 = l0?.count ?? 0,
        c1 = l1?.count ?? 0,
        c2 = l2?.count ?? 0,
        ci = imp?.count ?? 0;
      if (l0 && c0 > 0) draws++;
      if (l1 && c1 > 0) draws++;
      if (l2 && c2 > 0) draws++;
      if (imp && ci > 0) draws++;
      if (l0?.shadowMesh && l0.shadowMesh.count > 0) draws++;
      if (l1?.shadowMesh && l1.shadowMesh.count > 0) draws++;

      details[p] = {
        lod0: c0,
        lod1: c1,
        lod2: c2,
        impostor: ci,
        hasLOD0: !!l0,
        hasLOD1: !!l1,
        hasLOD2: !!l2,
        hasImpostor: !!imp,
      };
    }

    for (const { inst } of this.instances.values()) {
      const l = inst.currentLOD;
      if (l === 0) byLOD.lod0++;
      else if (l === 1) byLOD.lod1++;
      else if (l === 2) byLOD.lod2++;
      else if (l === 3) byLOD.impostor++;
      else byLOD.culled++;
    }

    // Get global leaf stats
    const leafStats = this.globalLeaves?.getStats() ?? {
      count: 0,
      capacity: 0,
      drawCalls: 0,
    };

    return {
      presets: this.meshes.size,
      totalInstances: this.instances.size,
      drawCalls: draws + leafStats.drawCalls,
      byLOD,
      activeTransitions: this.transitions.size,
      pendingImpostors: this.pendingImpostors.size,
      gpuCullingAvailable: this.isWebGPU,
      lodDistances: LOD_DIST,
      globalLeaves: leafStats,
      details,
    };
  }

  dispose(): void {
    // Dispose global leaves
    this.globalLeaves?.dispose();
    this.globalLeaves = null;
    this.presetLeafData.clear();

    for (const data of this.meshes.values()) {
      for (const d of data.values()) {
        d.mesh.parent?.remove(d.mesh);
        d.geometry.dispose();
        d.material.dispose();
        d.mesh.dispose();
        d.shadowMesh?.parent?.remove(d.shadowMesh);
        d.shadowMesh?.dispose();
        d.shadowGeo?.dispose();
      }
    }
    this.meshes.clear();

    for (const d of this.impostors.values()) {
      d.mesh.parent?.remove(d.mesh);
      d.geometry.dispose();
      d.material.dispose();
      d.mesh.dispose();
    }
    this.impostors.clear();

    this.instances.clear();
    this.transitions.clear();
    this.windMats = [];
    ProcgenTreeInstancer.inst = null;
  }
}

export default ProcgenTreeInstancer;
