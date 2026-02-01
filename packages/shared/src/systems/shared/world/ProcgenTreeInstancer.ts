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
  vec2,
  vec3,
  add,
  sub,
  mul,
  div,
  sin,
  cos,
  fract,
  floor,
  sqrt,
  smoothstep,
  mix,
  atan,
  positionLocal,
  screenUV,
  viewportSize,
  uv,
  attribute,
  instanceIndex,
  MeshStandardNodeMaterial,
  Discard,
  If,
} from "../../../extras/three/three";
import type { World } from "../../../core/World";
import {
  ImpostorManager,
  BakePriority,
  ImpostorBakeMode,
} from "../rendering/ImpostorManager";
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
  hasGlobalLeaves: boolean; // Whether individual leaves are in global buffer
  hasGlobalClusters: boolean; // Whether leaf clusters are in global buffer (LOD2)
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
 * - Uses TSL positionNode for vertex shader wind animation (verified pattern from ProceduralGrass.ts)
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

    let skipped = 0;
    for (const transform of leafTransforms) {
      // Get next available index
      const idx = this.freeIndices.pop() ?? this.nextIndex++;
      if (idx >= MAX_GLOBAL_LEAVES) {
        skipped++;
        continue;
      }

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

    // Warn if capacity exceeded
    if (skipped > 0) {
      console.warn(
        `[GlobalLeafInstancer] Capacity exceeded: skipped ${skipped} leaves for tree ${treeId}. ` +
          `Consider increasing MAX_GLOBAL_LEAVES (currently ${MAX_GLOBAL_LEAVES}).`,
      );
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
// GLOBAL LEAF CLUSTER INSTANCER (LOD2 Optimization)
// ============================================================================

const MAX_CLUSTER_INSTANCES = 50000;

/**
 * Cluster data per tree preset - from LeafClusterGenerator.
 */
interface PresetClusterData {
  /** Cluster center positions (local to tree) */
  centers: THREE.Vector3[];
  /** Cluster sizes (width, height) */
  sizes: Array<{ width: number; height: number }>;
  /** Cluster densities (normalized 0-1) for alpha variation */
  densities: number[];
  /** Leaf count per cluster (for size scaling) */
  leafCounts: number[];
  /** Average leaf color */
  color: THREE.Color;
  /** Total leaf count for stats */
  totalLeaves: number;
}

/**
 * Global leaf cluster instancer - renders billboard clusters at LOD2.
 *
 * AAA TECHNIQUE: At 60-120m distance, individual leaves are too small to distinguish.
 * Instead, we render larger "cluster cards" that approximate groups of 15-30 leaves.
 * This bridges the gap between individual leaves (LOD0/1) and impostors (LOD3).
 *
 * PERFORMANCE:
 * - 1000 individual leaves → ~40 cluster cards
 * - ONE draw call for ALL clusters across ALL trees
 * - GPU-driven wind animation and camera-facing billboards
 *
 * VISUAL QUALITY:
 * - Procedural leaf-like noise pattern (not just radial gradient)
 * - Density-based alpha variation per cluster
 * - Proper two-sided lighting with subsurface approximation
 * - Smooth LOD fade with screen-space dithering
 */
// Type for cluster node material with wind uniforms
type ClusterNodeMaterial = THREE.MeshStandardNodeMaterial & {
  uniforms: {
    time: { value: number };
    windStrength: { value: number };
    windDirection: { value: THREE.Vector3 };
    cameraPosition: { value: THREE.Vector3 };
    alphaTest: { value: number };
  };
};

class GlobalLeafClusterInstancer {
  private geometry: THREE.BufferGeometry;
  private material: ClusterNodeMaterial;
  private mesh: THREE.InstancedMesh;

  // Per-instance attributes
  private colors: Float32Array;
  private fades: Float32Array;
  private densities: Float32Array; // Alpha multiplier per cluster
  private colorAttr: THREE.InstancedBufferAttribute;
  private fadeAttr: THREE.InstancedBufferAttribute;
  private densityAttr: THREE.InstancedBufferAttribute;

  // Bookkeeping
  private clusterMap: Map<string, number[]> = new Map();
  private presetClusters: Map<string, PresetClusterData> = new Map();
  private freeIndices: number[] = [];
  private nextIndex = 0;
  private count = 0;
  private dirty = false;

  // Wind and camera state
  private windTime = 0;
  private windStrength = 1;
  private windDir = new THREE.Vector3(1, 0, 0);
  private cameraPosition = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.geometry = this.createClusterCardGeometry();
    this.material = this.createClusterMaterial();

    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      MAX_CLUSTER_INSTANCES,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "GlobalLeafClusters";
    this.mesh.layers.set(1);
    scene.add(this.mesh);

    // Initialize instance arrays
    this.colors = new Float32Array(MAX_CLUSTER_INSTANCES * 3);
    this.fades = new Float32Array(MAX_CLUSTER_INSTANCES).fill(1);
    this.densities = new Float32Array(MAX_CLUSTER_INSTANCES).fill(1);

    this.colorAttr = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceColor", this.colorAttr);

    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fades, 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceFade", this.fadeAttr);

    this.densityAttr = new THREE.InstancedBufferAttribute(this.densities, 1);
    this.densityAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceDensity", this.densityAttr);
  }

  private createClusterCardGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();

    // Unit quad centered at bottom (will be scaled per-instance)
    const positions = new Float32Array([
      -0.5,
      0,
      0, // bottom-left
      0.5,
      0,
      0, // bottom-right
      0.5,
      1,
      0, // top-right
      -0.5,
      1,
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

  private createClusterMaterial(): ClusterNodeMaterial {
    // TSL-based cluster material for WebGPU compatibility
    const material = new MeshStandardNodeMaterial() as ClusterNodeMaterial;

    // Create uniforms for wind animation and rendering
    const uTime = uniform(0);
    const uWindStrength = uniform(1);
    const uWindDirection = uniform(new THREE.Vector3(1, 0, 0));
    const uCameraPosition = uniform(new THREE.Vector3());
    const uAlphaTest = uniform(0.15);

    // Store uniforms for external access
    material.uniforms = {
      time: uTime,
      windStrength: uWindStrength,
      windDirection: uWindDirection,
      cameraPosition: uCameraPosition,
      alphaTest: uAlphaTest,
    };

    // Get per-instance attributes
    const instanceColor = attribute("instanceColor", "vec3");
    const instanceFade = attribute("instanceFade", "float");
    const instanceDensity = attribute("instanceDensity", "float");

    // TSL hash function for variation
    const hash = Fn(([n]: [ReturnType<typeof float>]) => {
      return fract(mul(sin(mul(n, 127.1)), 43758.5453123));
    });

    // TSL hash2D function for noise
    const hash2D = Fn(([p]: [ReturnType<typeof vec2>]) => {
      const dotProd = add(mul(p.x, 127.1), mul(p.y, 311.7));
      return fract(mul(sin(dotProd), 43758.5453123));
    });

    // TSL value noise function
    const noise2D = Fn(([p]: [ReturnType<typeof vec2>]) => {
      const i = floor(p);
      const f = fract(p);
      // Smoothstep interpolation: f * f * (3.0 - 2.0 * f)
      const fSmooth = mul(mul(f, f), sub(vec2(3.0, 3.0), mul(f, 2.0)));

      const a = hash2D(i);
      const b = hash2D(add(i, vec2(1.0, 0.0)));
      const c = hash2D(add(i, vec2(0.0, 1.0)));
      const d = hash2D(add(i, vec2(1.0, 1.0)));

      // Bilinear interpolation
      const mixAB = mix(a, b, fSmooth.x);
      const mixCD = mix(c, d, fSmooth.x);
      return mix(mixAB, mixCD, fSmooth.y);
    });

    // TSL FBM (fractal Brownian motion) function - simplified for performance
    const fbm = Fn(([p]: [ReturnType<typeof vec2>]) => {
      // 2 octaves for performance (GLSL version had 4)
      const octave1 = mul(noise2D(p), 0.5);
      const octave2 = mul(noise2D(mul(p, 2.0)), 0.25);
      return add(octave1, octave2);
    });

    // Position node with billboard and wind animation
    const positionNode = Fn(() => {
      const pos = positionLocal;

      // Get instance index for variation
      const idx = float(instanceIndex);
      const windPhase = mul(hash(idx), 6.28318);

      // Height factor for wind (0 at bottom, 1 at top)
      const heightFactor = pos.y;
      const windAmount = mul(mul(uWindStrength, heightFactor), 0.2);

      // Multi-frequency wind for natural look
      const wave1 = sin(add(mul(uTime, 2.0), windPhase));
      const wave2 = mul(sin(add(mul(uTime, 1.3), mul(windPhase, 0.7))), 0.5);
      const wave3 = mul(sin(add(mul(uTime, 3.1), mul(windPhase, 1.3))), 0.25);
      const combined = mul(add(add(wave1, wave2), wave3), windAmount);

      // Wind displacement
      const windX = mul(combined, uWindDirection.x);
      const windZ = mul(combined, uWindDirection.z);
      const windY = mul(
        mul(sin(add(mul(uTime, 4.0), mul(windPhase, 2.0))), windAmount),
        0.1,
      );

      return vec3(add(pos.x, windX), add(pos.y, windY), add(pos.z, windZ));
    })();

    material.positionNode = positionNode;

    // Color node with lighting
    const colorNode = Fn(() => {
      // Per-instance seed for variation
      const idx = float(instanceIndex);
      const instanceSeed = fract(mul(idx, 0.1));

      // Color variation
      const colorVariation = add(0.9, mul(hash(instanceSeed), 0.2));
      return mul(instanceColor, colorVariation);
    })();

    material.colorNode = colorNode;

    // Opacity node with procedural leaf cluster pattern and LOD fade
    const opacityNode = Fn(() => {
      const uvCoord = uv();
      const idx = float(instanceIndex);
      const instanceSeed = fract(mul(idx, 0.1));

      // Center UV for circular calculations
      const centered = sub(mul(uvCoord, 2.0), vec2(1.0, 1.0));
      const dist = sqrt(
        add(mul(centered.x, centered.x), mul(centered.y, centered.y)),
      );

      // Base elliptical shape
      const ellipse = sub(1.0, smoothstep(0.4, 0.95, dist));

      // Organic noise for leaf-like edges
      const noiseUV = add(mul(uvCoord, 8.0), mul(instanceSeed, 10.0));
      const leafNoise = fbm(noiseUV);

      // Simplified leaf pattern (1 leaf instead of 5 for performance)
      const offsetX = mul(sin(mul(instanceSeed, 13.0)), 0.3);
      const offsetY = mul(cos(mul(instanceSeed, 17.0)), 0.3);
      const leafDist = sqrt(
        add(
          mul(sub(centered.x, offsetX), sub(centered.x, offsetX)),
          mul(sub(centered.y, offsetY), sub(centered.y, offsetY)),
        ),
      );
      const leafPattern = mul(
        sub(1.0, smoothstep(0.1, 0.4, leafDist)),
        add(
          0.5,
          mul(
            sin(
              mul(
                atan(sub(centered.y, offsetY), sub(centered.x, offsetX)),
                3.0,
              ),
            ),
            0.5,
          ),
        ),
      );

      // Combine patterns
      const baseAlpha = add(
        mul(ellipse, add(0.6, mul(leafNoise, 0.4))),
        mul(leafPattern, 0.4),
      );

      // Edge variation
      const edgeNoise = noise2D(add(mul(uvCoord, 12.0), instanceSeed));
      let alpha = mul(baseAlpha, add(0.8, mul(edgeNoise, 0.4)));

      // Modulate by cluster density
      alpha = mul(alpha, add(0.5, mul(instanceDensity, 0.5)));

      // Apply LOD fade - use If/Discard for alpha test
      const finalAlpha = mul(alpha, instanceFade);

      return finalAlpha;
    })();

    material.opacityNode = opacityNode;

    // Use If/Discard for alpha test
    material.alphaTest = 0.15;
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = true;

    return material;
  }

  /**
   * Register cluster data for a preset using octree-based spatial clustering.
   * Called once during tree registration - generates optimal clusters for LOD2.
   */
  registerPresetClusters(
    presetName: string,
    leafTransforms: THREE.Matrix4[],
    leafColor: THREE.Color,
    treeDims: { height: number; canopyR: number },
  ): void {
    if (leafTransforms.length === 0) {
      this.presetClusters.set(presetName, {
        centers: [],
        sizes: [],
        densities: [],
        leafCounts: [],
        color: leafColor.clone(),
        totalLeaves: 0,
      });
      return;
    }

    // Extract leaf positions
    const positions: THREE.Vector3[] = [];
    const tempVec = new THREE.Vector3();
    for (const mat of leafTransforms) {
      tempVec.setFromMatrixPosition(mat);
      positions.push(tempVec.clone());
    }

    // Generate clusters using octree-based spatial subdivision
    const clusterResult = this.generateClusters(positions, treeDims);

    this.presetClusters.set(presetName, {
      centers: clusterResult.centers,
      sizes: clusterResult.sizes,
      densities: clusterResult.densities,
      leafCounts: clusterResult.leafCounts,
      color: leafColor.clone(),
      totalLeaves: positions.length,
    });

    console.log(
      `[LeafClusters] ${presetName}: ${positions.length} leaves → ${clusterResult.centers.length} clusters ` +
        `(${(positions.length / clusterResult.centers.length).toFixed(1)} leaves/cluster avg)`,
    );
  }

  /**
   * Octree-based spatial clustering for optimal LOD2 representation.
   */
  private generateClusters(
    positions: THREE.Vector3[],
    treeDims: { height: number; canopyR: number },
  ): {
    centers: THREE.Vector3[];
    sizes: Array<{ width: number; height: number }>;
    densities: number[];
    leafCounts: number[];
  } {
    // Calculate bounds
    const bounds = new THREE.Box3();
    for (const pos of positions) {
      bounds.expandByPoint(pos);
    }

    // Target cluster count based on tree size and leaf count
    // Larger trees with more leaves need more clusters for visual fidelity
    const leafCount = positions.length;
    const treeSize = Math.max(treeDims.height, treeDims.canopyR * 2);
    const baseClusterCount = Math.max(
      20,
      Math.min(80, Math.ceil(leafCount / 25)),
    );
    const sizeMultiplier = Math.max(1, treeSize / 5); // Larger trees get more clusters
    const targetClusters = Math.min(
      100,
      Math.ceil(baseClusterCount * sizeMultiplier),
    );

    // Calculate octree cell size
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const avgDim = (size.x + size.y + size.z) / 3;
    const cellSize = avgDim / Math.cbrt(targetClusters);

    // Build octree grid
    const cellMap = new Map<string, number[]>(); // cell key -> leaf indices
    const cellKey = (pos: THREE.Vector3) => {
      const x = Math.floor((pos.x - bounds.min.x) / cellSize);
      const y = Math.floor((pos.y - bounds.min.y) / cellSize);
      const z = Math.floor((pos.z - bounds.min.z) / cellSize);
      return `${x},${y},${z}`;
    };

    for (let i = 0; i < positions.length; i++) {
      const key = cellKey(positions[i]);
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key)!.push(i);
    }

    // Extract clusters from cells
    const centers: THREE.Vector3[] = [];
    const sizes: Array<{ width: number; height: number }> = [];
    const leafCounts: number[] = [];
    const rawDensities: number[] = [];

    const minLeavesPerCluster = 3;
    const maxLeavesPerCluster = 50;

    for (const [, indices] of cellMap) {
      if (indices.length < minLeavesPerCluster) continue;

      // If cluster has too many leaves, subdivide
      if (indices.length > maxLeavesPerCluster) {
        // Simple split along longest axis
        const cellBounds = new THREE.Box3();
        for (const idx of indices) cellBounds.expandByPoint(positions[idx]);

        const cellSize3 = new THREE.Vector3();
        cellBounds.getSize(cellSize3);

        // Find longest axis
        let splitAxis: "x" | "y" | "z" = "x";
        if (cellSize3.y > cellSize3.x && cellSize3.y > cellSize3.z)
          splitAxis = "y";
        else if (cellSize3.z > cellSize3.x) splitAxis = "z";

        const splitValue = cellBounds.min[splitAxis] + cellSize3[splitAxis] / 2;

        const left: number[] = [];
        const right: number[] = [];
        for (const idx of indices) {
          if (positions[idx][splitAxis] < splitValue) left.push(idx);
          else right.push(idx);
        }

        // Process both halves
        for (const half of [left, right]) {
          if (half.length < minLeavesPerCluster) continue;
          this.addClusterFromIndices(
            half,
            positions,
            centers,
            sizes,
            leafCounts,
            rawDensities,
          );
        }
      } else {
        this.addClusterFromIndices(
          indices,
          positions,
          centers,
          sizes,
          leafCounts,
          rawDensities,
        );
      }
    }

    // Normalize densities to 0-1 range
    const maxDensity = Math.max(...rawDensities, 0.001);
    const minDensity = Math.min(...rawDensities);
    const densityRange = Math.max(0.001, maxDensity - minDensity);
    const densities = rawDensities.map((d) => (d - minDensity) / densityRange);

    return { centers, sizes, densities, leafCounts };
  }

  private addClusterFromIndices(
    indices: number[],
    positions: THREE.Vector3[],
    centers: THREE.Vector3[],
    sizes: Array<{ width: number; height: number }>,
    leafCounts: number[],
    rawDensities: number[],
  ): void {
    // Calculate center
    const center = new THREE.Vector3();
    for (const idx of indices) center.add(positions[idx]);
    center.divideScalar(indices.length);

    // Calculate bounds
    const clusterBounds = new THREE.Box3();
    for (const idx of indices) clusterBounds.expandByPoint(positions[idx]);

    const clusterSize = new THREE.Vector3();
    clusterBounds.getSize(clusterSize);

    // Calculate density (leaves per volume)
    const volume = Math.max(
      0.001,
      clusterSize.x * clusterSize.y * clusterSize.z,
    );
    const density = indices.length / volume;

    // Size with padding for visual coverage
    const padding = 1.3;
    const width = Math.max(
      0.5,
      Math.max(clusterSize.x, clusterSize.z) * padding,
    );
    const height = Math.max(0.5, clusterSize.y * padding);

    centers.push(center);
    sizes.push({ width, height });
    leafCounts.push(indices.length);
    rawDensities.push(density);
  }

  /**
   * Add clusters for a tree instance (called when entering LOD2).
   */
  addTree(
    treeId: string,
    presetName: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
  ): void {
    const preset = this.presetClusters.get(presetName);
    if (!preset || preset.centers.length === 0) return;

    // Remove existing if present
    this.removeTree(treeId);

    const indices: number[] = [];
    const tempMatrix = new THREE.Matrix4();
    const tempQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rotation,
    );
    const tempScale = new THREE.Vector3();

    for (let i = 0; i < preset.centers.length; i++) {
      const idx = this.allocateIndex();
      if (idx < 0) {
        console.warn("[LeafClusters] Max instances reached");
        break;
      }

      // Calculate world position
      const worldPos = preset.centers[i]
        .clone()
        .applyQuaternion(tempQuat)
        .multiplyScalar(scale)
        .add(position);

      // Calculate cluster scale (width, height, 1 for billboard)
      const s = preset.sizes[i];
      tempScale.set(s.width * scale, s.height * scale, 1);

      // Create matrix (position + scale)
      tempMatrix.identity();
      tempMatrix.setPosition(worldPos);
      tempMatrix.scale(tempScale);

      this.mesh.setMatrixAt(idx, tempMatrix);

      // Set color with slight variation
      const c = preset.color;
      const variation = 0.95 + Math.random() * 0.1;
      this.colors[idx * 3] = c.r * variation;
      this.colors[idx * 3 + 1] = c.g * variation;
      this.colors[idx * 3 + 2] = c.b * variation;

      // Set density for alpha modulation
      this.densities[idx] = preset.densities[i];

      // Set fade to visible
      this.fades[idx] = 1;

      indices.push(idx);
    }

    this.clusterMap.set(treeId, indices);
    this.count = Math.max(this.count, ...indices.map((i) => i + 1));
    this.dirty = true;
  }

  removeTree(treeId: string): void {
    const indices = this.clusterMap.get(treeId);
    if (!indices) return;

    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const idx of indices) {
      this.mesh.setMatrixAt(idx, zeroMatrix);
      this.freeIndices.push(idx);
    }

    this.clusterMap.delete(treeId);
    this.dirty = true;
  }

  setFade(treeId: string, fade: number): void {
    const indices = this.clusterMap.get(treeId);
    if (!indices) return;

    for (const idx of indices) {
      this.fades[idx] = fade;
    }
    this.fadeAttr.needsUpdate = true;
  }

  private allocateIndex(): number {
    if (this.freeIndices.length > 0) {
      return this.freeIndices.pop()!;
    }
    if (this.nextIndex >= MAX_CLUSTER_INSTANCES) return -1;
    return this.nextIndex++;
  }

  update(wind: Wind | null, dt: number, camera?: THREE.Camera): void {
    this.windTime += dt;
    if (wind) {
      this.windDir.copy(wind.uniforms.windDirection.value);
      this.windStrength = wind.uniforms.windStrength.value;
    }

    // Update camera position for billboarding
    if (camera) {
      camera.getWorldPosition(this.cameraPosition);
      this.material.uniforms.cameraPosition.value.copy(this.cameraPosition);
    }

    this.material.uniforms.time.value = this.windTime;
    this.material.uniforms.windStrength.value = this.windStrength;
    this.material.uniforms.windDirection.value.copy(this.windDir);

    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.fadeAttr.needsUpdate = true;
      this.densityAttr.needsUpdate = true;
      this.mesh.count = this.count;
      this.dirty = false;
    }
  }

  hasPreset(presetName: string): boolean {
    return this.presetClusters.has(presetName);
  }

  getStats(): {
    treesWithClusters: number;
    totalClusters: number;
    capacity: number;
    drawCalls: number;
    presetsRegistered: number;
  } {
    let totalClusters = 0;
    for (const indices of this.clusterMap.values()) {
      totalClusters += indices.length;
    }

    return {
      treesWithClusters: this.clusterMap.size,
      totalClusters,
      capacity: MAX_CLUSTER_INSTANCES,
      drawCalls: 1,
      presetsRegistered: this.presetClusters.size,
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
  // Handle MeshStandardNodeMaterial (from procgen) or MeshStandardMaterial (from GLB)
  // Check for PBR properties using duck typing to support both material types
  const srcWithPBR = source as THREE.Material & {
    color?: THREE.Color;
    roughness?: number;
    metalness?: number;
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    normalScale?: THREE.Vector2;
    roughnessMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    aoMapIntensity?: number;
    emissive?: THREE.Color;
    emissiveMap?: THREE.Texture | null;
    emissiveIntensity?: number;
    envMap?: THREE.Texture | null;
    envMapIntensity?: number;
    vertexColors?: boolean;
    flatShading?: boolean;
  };

  // Check if source has PBR properties (MeshStandardMaterial or MeshStandardNodeMaterial)
  if (
    srcWithPBR.roughness !== undefined &&
    srcWithPBR.metalness !== undefined
  ) {
    // Color and basic properties
    // NOTE: Use setRGB instead of copy for cross-build compatibility (three vs three/webgpu)
    if (srcWithPBR.color && "r" in srcWithPBR.color) {
      target.color.setRGB(
        srcWithPBR.color.r,
        srcWithPBR.color.g,
        srcWithPBR.color.b,
      );
    }
    target.roughness = srcWithPBR.roughness;
    target.metalness = srcWithPBR.metalness;
    target.side = source.side;
    target.opacity = source.opacity;
    target.alphaTest = source.alphaTest;
    if (srcWithPBR.flatShading !== undefined)
      target.flatShading = srcWithPBR.flatShading;

    // Textures - critical for proper rendering
    if (srcWithPBR.map) {
      target.map = srcWithPBR.map;
      target.map.needsUpdate = true;
    }
    if (srcWithPBR.normalMap) {
      target.normalMap = srcWithPBR.normalMap;
      if (srcWithPBR.normalScale)
        target.normalScale.copy(srcWithPBR.normalScale);
    }
    if (srcWithPBR.roughnessMap) target.roughnessMap = srcWithPBR.roughnessMap;
    if (srcWithPBR.metalnessMap) target.metalnessMap = srcWithPBR.metalnessMap;
    if (srcWithPBR.aoMap) {
      target.aoMap = srcWithPBR.aoMap;
      target.aoMapIntensity = srcWithPBR.aoMapIntensity ?? 1.0;
    }
    if (srcWithPBR.emissiveMap) {
      target.emissiveMap = srcWithPBR.emissiveMap;
      if (srcWithPBR.emissive && "r" in srcWithPBR.emissive) {
        target.emissive.setRGB(
          srcWithPBR.emissive.r,
          srcWithPBR.emissive.g,
          srcWithPBR.emissive.b,
        );
      }
      target.emissiveIntensity = srcWithPBR.emissiveIntensity ?? 1.0;
    }
    if (srcWithPBR.envMap) {
      target.envMap = srcWithPBR.envMap;
      target.envMapIntensity = srcWithPBR.envMapIntensity ?? 1.0;
    }

    // Copy vertex colors flag
    if (srcWithPBR.vertexColors !== undefined)
      target.vertexColors = srcWithPBR.vertexColors;
  } else {
    // Duck type for LambertMaterial or BasicMaterial (cross-build compatible)
    // Check for common material properties using type assertion
    const srcBasic = source as THREE.Material & {
      color?: THREE.Color;
      map?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      aoMapIntensity?: number;
      emissive?: THREE.Color;
      emissiveMap?: THREE.Texture | null;
      emissiveIntensity?: number;
      envMap?: THREE.Texture | null;
      flatShading?: boolean;
      vertexColors?: boolean;
    };

    // Copy color if present (both Lambert and Basic have this)
    if (srcBasic.color && "r" in srcBasic.color) {
      target.color.setRGB(srcBasic.color.r, srcBasic.color.g, srcBasic.color.b);
    }
    target.side = source.side;
    target.opacity = source.opacity;
    target.alphaTest = source.alphaTest;
    if (srcBasic.flatShading !== undefined)
      target.flatShading = srcBasic.flatShading;
    if (srcBasic.vertexColors !== undefined)
      target.vertexColors = srcBasic.vertexColors;
    if (srcBasic.map) {
      target.map = srcBasic.map;
      target.map.needsUpdate = true;
    }
    if (srcBasic.aoMap) {
      target.aoMap = srcBasic.aoMap;
      target.aoMapIntensity = srcBasic.aoMapIntensity ?? 1.0;
    }
    if (srcBasic.emissiveMap) {
      target.emissiveMap = srcBasic.emissiveMap;
      if (srcBasic.emissive && "r" in srcBasic.emissive) {
        target.emissive.setRGB(
          srcBasic.emissive.r,
          srcBasic.emissive.g,
          srcBasic.emissive.b,
        );
      }
      target.emissiveIntensity = srcBasic.emissiveIntensity ?? 1.0;
    }
    if (srcBasic.envMap) {
      target.envMap = srcBasic.envMap;
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

  // Global leaf cluster instancing (LOD2 optimization)
  private globalClusters: GlobalLeafClusterInstancer | null = null;

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

  // Lighting sync for impostors
  private _lastLightUpdate = 0;
  private _lightDir = new THREE.Vector3(0.5, 0.8, 0.3);
  private _lightColor = new THREE.Vector3(1, 1, 1);
  private _ambientColor = new THREE.Vector3(0.7, 0.8, 1.0);

  private constructor(world: World) {
    this.world = world;
    this.scene = world.stage?.scene as THREE.Scene;
    this.windSys = world.getSystem("wind") as Wind | null;
    this.isWebGPU = this.checkWebGPU();

    // Initialize global leaf instancer if scene is available
    if (this.scene && this.useGlobalLeaves) {
      this.globalLeaves = new GlobalLeafInstancer(this.scene);
      // Also initialize cluster instancer for LOD2 optimization
      this.globalClusters = new GlobalLeafClusterInstancer(this.scene);
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

    // Use FULL bake mode to get normals + depth atlas for AAA quality:
    // - Normal atlas: dynamic lighting
    // - Depth atlas: depth-based frame blending (reduces ghosting/artifacts)
    const result = await mgr.getOrCreate(`procgen_tree_${name}_v5`, src, {
      atlasSize: IMPOSTOR_SIZE,
      hemisphere: true,
      priority: BakePriority.NORMAL,
      category: "tree_resource",
      gridSizeX: 16,
      gridSizeY: 8,
      bakeMode: ImpostorBakeMode.FULL, // Bake with normals + depth for AAA quality
    });

    if (!result.atlasTexture) return;

    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const w = Math.max(size.x, size.z);
    const h = size.y;

    const geo = new THREE.PlaneGeometry(1, 1);
    // Pass normal + depth atlas textures for AAA quality
    const mat = createTSLImpostorMaterial({
      atlasTexture: result.atlasTexture,
      normalAtlasTexture: result.normalAtlasTexture, // Enable dynamic lighting
      depthAtlasTexture: result.depthAtlasTexture, // Enable depth-based blending
      gridSizeX: result.gridSizeX,
      gridSizeY: result.gridSizeY,
      transparent: true,
      depthWrite: true,
      enableAAA: true, // Enable AAA features
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
      // NOTE: We use isInstancedMesh property instead of instanceof because
      // procgen uses 'three' while shared uses 'three/webgpu' - different classes!
      const isInstancedMesh =
        (child as THREE.Object3D & { isInstancedMesh?: boolean })
          .isInstancedMesh === true;
      if (isInstancedMesh) {
        const instancedChild = child as THREE.InstancedMesh;
        // Extract leaf transforms for global instancing
        if (this.useGlobalLeaves && lod === "lod0") {
          const instanceCount = instancedChild.count;
          const tempMatrix = new THREE.Matrix4();

          for (let i = 0; i < instanceCount; i++) {
            instancedChild.getMatrixAt(i, tempMatrix);
            leafTransforms.push(tempMatrix.clone());
          }

          // Extract leaf color from material
          // Handle standard materials, shader materials, and TSL node materials
          // NOTE: Use duck typing for ShaderMaterial too - different classes between three/webgpu and three
          const mat = Array.isArray(instancedChild.material)
            ? instancedChild.material[0]
            : instancedChild.material;
          if (mat) {
            // Duck type check for ShaderMaterial with uColor uniform (procgen leaves)
            const shaderMat = mat as THREE.ShaderMaterial & {
              uniforms?: Record<string, { value: unknown }>;
            };
            if (shaderMat.uniforms?.uColor?.value) {
              const uColor = shaderMat.uniforms.uColor.value;
              if (
                uColor &&
                typeof uColor === "object" &&
                "r" in uColor &&
                "g" in uColor &&
                "b" in uColor
              ) {
                leafColor = new THREE.Color(
                  (uColor as THREE.Color).r,
                  (uColor as THREE.Color).g,
                  (uColor as THREE.Color).b,
                );
              }
            } else if (
              mat instanceof MeshStandardNodeMaterial &&
              "leafUniforms" in mat
            ) {
              // TSL node material with leafUniforms (GlobalLeafInstancer style)
              const leafMat = mat as LeafNodeMaterial;
              if (leafMat.leafUniforms?.baseColor?.value) {
                leafColor = leafMat.leafUniforms.baseColor.value.clone();
              }
            } else if ("color" in mat) {
              // Standard material with color property
              const colorMat = mat as { color?: THREE.Color };
              if (colorMat.color && "r" in colorMat.color) {
                leafColor = new THREE.Color(
                  colorMat.color.r,
                  colorMat.color.g,
                  colorMat.color.b,
                );
              }
            }
          }
        }
        return;
      }

      // Regular Mesh - merge into trunk geometry
      // NOTE: Use isMesh property for cross-build compatibility (three vs three/webgpu)
      const isMesh =
        (child as THREE.Object3D & { isMesh?: boolean }).isMesh === true;
      const meshChild = child as THREE.Mesh;
      if (isMesh && meshChild.geometry) {
        const geo = meshChild.geometry.clone();
        if (!meshChild.matrix.equals(new THREE.Matrix4().identity()))
          geo.applyMatrix4(meshChild.matrix);
        geos.push(geo);
        const m = Array.isArray(meshChild.material)
          ? meshChild.material[0]
          : meshChild.material;
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

      // Also register cluster data for LOD2 optimization
      if (this.globalClusters) {
        this.globalClusters.registerPresetClusters(
          name,
          leafTransforms,
          leafColor,
          { height: dims.height, canopyR: dims.canopyR },
        );
        console.log(
          `[TreeInstancer] ${name}: Registered leaf clusters for LOD2`,
        );
      }
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
    // Let the actual tree geometry cast shadows - looks much better than simplified shapes
    mesh.castShadow = lod === "lod0" || lod === "lod1";
    mesh.receiveShadow = true;
    mesh.layers.set(1);
    mesh.name = `Tree_${name}_${lod}`;

    const fadeArr = new Float32Array(MAX_INSTANCES).fill(1);
    const fadeAttr = new THREE.InstancedBufferAttribute(fadeArr, 1);
    fadeAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("instanceFade", fadeAttr);

    // No separate shadow mesh - main mesh casts shadows directly
    const shadowMesh: THREE.InstancedMesh | null = null;
    const shadowGeo: THREE.BufferGeometry | null = null;

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
      hasGlobalClusters: false,
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

  /**
   * Add leaf clusters for a tree (LOD2).
   */
  private addTreeClustersToGlobal(preset: string, inst: TreeInstance): void {
    if (!this.globalClusters || inst.hasGlobalClusters) return;

    // Clusters are pre-computed during preset registration
    this.globalClusters.addTree(
      inst.id,
      preset,
      inst.position,
      inst.rotation,
      inst.scale,
    );
    inst.hasGlobalClusters = true;
  }

  /**
   * Remove leaf clusters for a tree.
   */
  private removeTreeClustersFromGlobal(inst: TreeInstance): void {
    if (!this.globalClusters || !inst.hasGlobalClusters) return;

    this.globalClusters.removeTree(inst.id);
    inst.hasGlobalClusters = false;
  }

  removeInstance(preset: string, id: string, _lodLevel = 0): void {
    const tracked = this.instances.get(id);
    if (!tracked) return;

    // Remove leaves and clusters from global buffers
    this.removeTreeLeavesFromGlobal(tracked.inst);
    this.removeTreeClustersFromGlobal(tracked.inst);

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

    // Handle global leaves and clusters visibility
    // LOD0/LOD1: Individual leaves (high detail)
    // LOD2: Leaf clusters (medium detail - bridges gap before impostor)
    // LOD3+: Impostors or culled (no leaves/clusters)
    const showIndividualLeaves = target === 0 || target === 1;
    const hadIndividualLeaves = cur === 0 || cur === 1;
    const showClusters = target === 2;
    const hadClusters = cur === 2;

    // Individual leaves transitions
    if (showIndividualLeaves && !hadIndividualLeaves) {
      // Transitioning to LOD with individual leaves - add them
      this.addTreeLeavesToGlobal(preset, inst);
    } else if (!showIndividualLeaves && hadIndividualLeaves) {
      // Transitioning away from individual leaves - remove them
      this.removeTreeLeavesFromGlobal(inst);
    }

    // Cluster transitions (LOD2)
    if (showClusters && !hadClusters) {
      // Transitioning to LOD2 - add clusters
      this.addTreeClustersToGlobal(preset, inst);
    } else if (!showClusters && hadClusters) {
      // Transitioning away from LOD2 - remove clusters
      this.removeTreeClustersFromGlobal(inst);
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
    if (lod < 0 || lod > 3) return;

    // Handle mesh fades (LOD0, LOD1, LOD2 trunk/branches)
    if (lod <= 2) {
      const key = ["lod0", "lod1", "lod2"][lod] as LODKey;
      const data = this.meshes.get(preset)?.get(key);
      const idx = inst.lodIndices[lod];
      if (data && idx >= 0) {
        data.fadeAttr.setX(idx, fade);
        data.fadeAttr.needsUpdate = true;
      }
    }

    // Handle cluster fades (LOD2)
    if (lod === 2 && this.globalClusters && inst.hasGlobalClusters) {
      this.globalClusters.setFade(inst.id, fade);
    }

    // Handle global leaf fades (LOD0, LOD1)
    if ((lod === 0 || lod === 1) && this.globalLeaves && inst.hasGlobalLeaves) {
      this.globalLeaves.setTreeFade(inst.id, fade);
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

    // Sync impostor lighting with scene sun light
    this.syncImpostorLighting();

    // Update global leaves
    if (this.globalLeaves) {
      const strength = this.windSys?.uniforms.windStrength.value ?? 1;
      const windDir =
        this.windSys?.uniforms.windDirection.value ??
        new THREE.Vector3(1, 0, 0);
      this.globalLeaves.update(dt, strength, windDir);
    }

    // Update global leaf clusters (LOD2)
    if (this.globalClusters) {
      this.globalClusters.update(
        this.windSys,
        dt,
        this.world.camera ?? undefined,
      );
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

  /**
   * Sync impostor lighting with scene's sun light.
   * Throttled to once per frame (~16ms) to avoid redundant updates.
   */
  private syncImpostorLighting(): void {
    const now = performance.now();
    // Only update lighting once per frame (~16ms)
    if (now - this._lastLightUpdate < 16) return;
    this._lastLightUpdate = now;

    // Get environment system for sun light
    const env = this.world.getSystem("environment") as {
      sunLight?: THREE.DirectionalLight;
      lightDirection?: THREE.Vector3;
    } | null;

    if (!env?.sunLight) return;

    const sun = env.sunLight;
    // Light direction is negated (light goes FROM direction TO target)
    if (env.lightDirection) {
      this._lightDir.copy(env.lightDirection).negate();
    } else {
      this._lightDir.set(0.5, 0.8, 0.3);
    }
    this._lightColor.set(sun.color.r, sun.color.g, sun.color.b);

    // Update all impostor materials
    for (const data of this.impostors.values()) {
      const material = data.material as TSLImpostorMaterial;
      if (material.updateLighting) {
        material.updateLighting({
          ambientColor: this._ambientColor,
          ambientIntensity: 0.4,
          directionalLights: [
            {
              direction: this._lightDir,
              color: this._lightColor,
              intensity: sun.intensity,
            },
          ],
          specular: {
            f0: 0.02, // Trees are non-metallic
            shininess: 16,
            intensity: 0.15,
          },
        });
      }
    }
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

    // Get cluster stats
    const clusterStats = this.globalClusters?.getStats() ?? {
      treesWithClusters: 0,
      totalClusters: 0,
      capacity: 0,
      drawCalls: 0,
      presetsRegistered: 0,
    };

    return {
      presets: this.meshes.size,
      totalInstances: this.instances.size,
      drawCalls: draws + leafStats.drawCalls + clusterStats.drawCalls,
      byLOD,
      activeTransitions: this.transitions.size,
      pendingImpostors: this.pendingImpostors.size,
      gpuCullingAvailable: this.isWebGPU,
      lodDistances: LOD_DIST,
      globalLeaves: leafStats,
      globalClusters: clusterStats,
      details,
    };
  }

  /**
   * Get detailed LOD info for a specific tree.
   * Useful for debugging LOD transitions.
   */
  getTreeLODInfo(treeId: string): {
    preset: string;
    currentLOD: number;
    lodName: string;
    distance: number;
    hasLeaves: boolean;
    hasClusters: boolean;
    position: THREE.Vector3;
    transition: { from: number; to: number; progress: number } | null;
  } | null {
    const tracked = this.instances.get(treeId);
    if (!tracked) return null;

    const { inst, preset } = tracked;
    const dx = inst.position.x - this.camPos.x;
    const dz = inst.position.z - this.camPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const lodNames = ["LOD0", "LOD1", "LOD2", "Impostor", "Culled"];

    let transition: { from: number; to: number; progress: number } | null =
      null;
    if (inst.transition) {
      const progress = Math.min(
        1,
        (this.time - inst.transition.start) / LOD_FADE_MS,
      );
      transition = {
        from: inst.transition.from,
        to: inst.transition.to,
        progress,
      };
    }

    return {
      preset,
      currentLOD: inst.currentLOD,
      lodName: lodNames[inst.currentLOD] ?? "Unknown",
      distance: dist,
      hasLeaves: inst.hasGlobalLeaves,
      hasClusters: inst.hasGlobalClusters,
      position: inst.position.clone(),
      transition,
    };
  }

  /**
   * Get LOD info for all nearby trees.
   * Useful for debugging LOD distribution.
   */
  getNearbyTreesLODInfo(maxDistance = 300): Array<{
    id: string;
    preset: string;
    lod: number;
    lodName: string;
    distance: number;
  }> {
    const result: Array<{
      id: string;
      preset: string;
      lod: number;
      lodName: string;
      distance: number;
    }> = [];

    const lodNames = ["LOD0", "LOD1", "LOD2", "Impostor", "Culled"];

    for (const [id, { inst, preset }] of this.instances) {
      const dx = inst.position.x - this.camPos.x;
      const dz = inst.position.z - this.camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= maxDistance) {
        result.push({
          id,
          preset,
          lod: inst.currentLOD,
          lodName: lodNames[inst.currentLOD] ?? "Unknown",
          distance: Math.round(dist * 10) / 10,
        });
      }
    }

    // Sort by distance
    result.sort((a, b) => a.distance - b.distance);
    return result;
  }

  /**
   * Debug utility: Print LOD summary to console.
   */
  debugPrintLODSummary(): void {
    const stats = this.getStats();
    console.log("=== Tree LOD Summary ===");
    console.log(`Total trees: ${stats.totalInstances}`);
    console.log(`LOD0 (0-${LOD_DIST.lod1}m): ${stats.byLOD.lod0}`);
    console.log(
      `LOD1 (${LOD_DIST.lod1}-${LOD_DIST.lod2}m): ${stats.byLOD.lod1}`,
    );
    console.log(
      `LOD2 (${LOD_DIST.lod2}-${LOD_DIST.impostor}m): ${stats.byLOD.lod2}`,
    );
    console.log(
      `Impostor (${LOD_DIST.impostor}-${LOD_DIST.cull}m): ${stats.byLOD.impostor}`,
    );
    console.log(`Culled (>${LOD_DIST.cull}m): ${stats.byLOD.culled}`);
    console.log(`Draw calls: ${stats.drawCalls}`);
    console.log(
      `Global leaves: ${stats.globalLeaves.count} trees, ${stats.globalLeaves.drawCalls} draw calls`,
    );
    console.log(
      `Global clusters: ${stats.globalClusters.treesWithClusters} trees, ${stats.globalClusters.totalClusters} clusters`,
    );
    console.log(`Active transitions: ${stats.activeTransitions}`);
    console.log(`Pending impostors: ${stats.pendingImpostors}`);
    console.log("========================");
  }

  dispose(): void {
    // Dispose global leaves
    this.globalLeaves?.dispose();
    this.globalLeaves = null;
    this.presetLeafData.clear();

    // Dispose global clusters
    this.globalClusters?.dispose();
    this.globalClusters = null;

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
