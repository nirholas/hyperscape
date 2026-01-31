/**
 * ProcgenTreeCache - Cached Procedural Tree Variants with LOD Support
 *
 * Pre-generates and caches a limited number of tree mesh variants per preset.
 * This provides visual variety while maintaining performance through shared geometry.
 *
 * LOD Strategy:
 * - LOD0 (0-30m): Full detail tree with instanced leaf cards
 * - LOD1 (30-60m): Simplified tree - fewer branches, fewer leaves
 * - LOD2 (60-120m): Cross-billboard cards for foliage
 * - Impostor (120m+): Octahedral billboard from ImpostorManager
 *
 * Design:
 * - 3 variants per preset (good balance of variety vs memory)
 * - Variants are generated with different seeds for unique shapes
 * - LOD1/LOD2 meshes use progressively simpler geometry
 * - Clones are returned to callers (shared geometry, individual transforms)
 * - Additional variation via rotation/scale applied by ResourceEntity
 *
 * ============================================================================
 * AAA ENHANCEMENT TODOS
 * ============================================================================
 *
 * TODO(AAA-1): Cross-fade LOD transitions
 * - Implement dissolve shader that fades between LOD levels over ~0.3s
 * - Use noise-based alpha mask for organic-looking transitions
 * - Prevents hard "pop" when LOD changes
 * - Reference: packages/impostor DissolveConfig for existing dissolve system
 *
 * TODO(AAA-2): Wind animation at LOD1
 * - Add subtle vertex shader wind animation to LOD1 meshes
 * - Use world-space noise for coherent wind across trees
 * - Parameters: wind direction, speed, turbulence, leaf flutter
 * - Should be much cheaper than LOD0 wind (fewer vertices)
 *
 * TODO(AAA-3): Shadow LODs (separate shadow meshes)
 * - Create ultra-simplified meshes for shadow map rendering
 * - Shadow LOD0: ~500 tris (vs 5000 for visual LOD0)
 * - Shadow LOD1: ~50 tris (cylinder + cone)
 * - Shadow culling at closer distance than visual culling
 * - Reference: Three.js customDepthMaterial for shadow-specific geometry
 *
 * TODO(AAA-4): Texture atlasing for all tree types
 * - Combine all tree bark/leaf textures into single atlas
 * - Single material for ALL tree types = 1 draw call per LOD
 * - Would reduce draw calls from 32 to 4 (one per LOD level)
 * - Requires UV remapping in procgen or post-process
 *
 * TODO(AAA-5): GPU-driven culling (compute shader)
 * - Move frustum culling to GPU compute shader
 * - Add occlusion culling using hierarchical Z-buffer
 * - Output visible instance indices to indirect draw buffer
 * - Would eliminate CPU-side distance calculations entirely
 * - Requires WebGPU compute shader support
 *
 * TODO(AAA-6): Hierarchical LOD (HLOD) for distant clusters
 * - Merge groups of distant trees into single combined mesh
 * - At 300m+, replace 10 trees with 1 "tree cluster" impostor
 * - Further reduces draw calls for open world scenes
 * - Pre-bake cluster impostors during asset pipeline
 */

import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { ProcgenTreeInstancer } from "./ProcgenTreeInstancer";
import type { World } from "../../../core/World";

// TSL functions from three/webgpu
const {
  Fn,
  uv,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  add,
  sub,
  mul,
  div,
  abs,
  sin,
  cos,
  atan,
  pow,
  floor,
  fract,
  length,
  max,
  mix,
  smoothstep,
  dot,
  step,
} = THREE_WEBGPU.TSL;

/** Number of variants to cache per tree preset */
const VARIANTS_PER_PRESET = 3;

/**
 * Crown shape types for LOD2 procedural billboards.
 * Different tree types have different crown silhouettes.
 */
type CrownType = "rounded" | "conical" | "weeping" | "columnar" | "spreading";

/**
 * Map tree presets to their appropriate crown shapes.
 * This ensures LOD2 billboards match the tree's silhouette.
 */
const PRESET_CROWN_TYPES: Record<string, CrownType> = {
  // Deciduous - rounded crowns
  quakingAspen: "rounded",
  blackOak: "spreading",
  blackTupelo: "rounded",
  acer: "spreading", // Japanese maple has wide spread
  sassafras: "rounded",
  hillCherry: "rounded",

  // Conifers - conical crowns
  balsamFir: "conical",
  douglasFir: "conical",
  europeanLarch: "conical",
  smallPine: "conical",

  // Special shapes
  weepingWillow: "weeping",
  lombardyPoplar: "columnar",
  palm: "spreading", // Palm fronds spread out
  fanPalm: "spreading",
  bamboo: "columnar",

  // Default for any unknown preset
  default: "rounded",
};

/**
 * Get the crown type for a tree preset.
 */
function getCrownType(presetName: string): CrownType {
  return PRESET_CROWN_TYPES[presetName] ?? PRESET_CROWN_TYPES.default!;
}

/** World reference for instancer registration */
let worldRef: World | null = null;

/**
 * Set the world reference for instancer registration.
 * Call this during game initialization.
 */
export function setProcgenTreeWorld(world: World): void {
  worldRef = world;
}

/** Base seeds for variant generation (spread apart for visual diversity) */
const VARIANT_SEEDS = [12345, 67890, 24680];

/**
 * ============================================================================
 * AAA TREE LOD CONFIGURATION
 * ============================================================================
 *
 * Performance budget per tree at each LOD:
 * - LOD0 (0-30m):    ~3000-5000 tris, full detail for close inspection
 * - LOD1 (30-60m):   ~200-500 tris, simplified silhouette
 * - LOD2 (60-120m):  ~20-40 tris, card billboards
 * - Impostor (120m+): 2 tris, octahedral billboard
 *
 * Total budget for 1000 trees at mixed distances:
 * - 50 trees at LOD0:  ~200K tris
 * - 200 trees at LOD1: ~60K tris
 * - 500 trees at LOD2: ~15K tris
 * - 250 impostors:     ~500 tris
 * - Total: ~275K tris (target: <500K for 60fps)
 */

/**
 * LOD0 geometry options - High-quality close-up detail
 * Target: ~15,000-25,000 triangles per tree (acceptable for close-up)
 *
 * LOD0 is only used for trees within ~30m of the player.
 * Typically only 5-15 trees at LOD0 at any time, so we can afford quality.
 * The LOD system handles the transition to lower detail at distance.
 *
 * Settings for nice-looking close-up trees:
 * - maxStems: 150 keeps full branch structure for visual appeal
 * - maxBranchDepth: 3 includes secondary branches for realism
 * - radialSegments: 6 (smooth cylindrical branches)
 * - maxLeaves: 2000 instanced cards for dense foliage
 * - segmentSamples: 3 for smooth curves
 *
 * Budget breakdown for a typical tree:
 * - 150 stems × ~12 ring samples × 6 radial × 2 tris = ~21,600 branch tris
 * - 2000 leaf cards × 2 tris = 4,000 leaf tris
 * - Total: ~25,600 tris (acceptable for LOD0)
 */
const LOD0_GEOMETRY_OPTIONS = {
  radialSegments: 6, // Hexagonal cross-section (smooth branches)
  maxLeaves: 2000, // Dense foliage for close-up viewing
  maxBranchDepth: 3, // Full branch structure
  maxStems: 150, // Enough for detailed tree structure
  segmentSamples: 3, // Smooth curves
};

/**
 * LOD1 geometry options - medium distance detail
 * Target: ~2,000-4,000 triangles per tree
 *
 * LOD1 is used for trees 30-60m away. Still visible but not inspected closely.
 * More trees at LOD1 than LOD0, but still reasonable to have decent detail.
 *
 * Budget breakdown:
 * - 50 stems × ~8 ring samples × 4 radial × 2 tris = ~3,200 branch tris
 * - 400 leaf cards × 2 tris = 800 leaf tris
 * - Total: ~4,000 tris (good for medium distance)
 */
const LOD1_GEOMETRY_OPTIONS = {
  radialSegments: 4, // Square cross-section (smoothed by normals)
  maxLeaves: 400, // Enough for crown shape
  maxBranchDepth: 2, // Trunk + main branches
  maxStems: 50, // Main branch structure visible
  segmentSamples: 2, // Fewer samples than LOD0
};

/**
 * LOD2 "Card Tree" - billboard cards for distant viewing
 * Target: ~20-40 triangles
 *
 * Uses camera-facing billboard cards arranged in a cross pattern
 * for good 360° coverage with minimal geometry
 */
const LOD2_CARD_OPTIONS = {
  trunkSegments: 3, // 3-sided trunk (triangle)
  crownType: "rounded" as CrownType, // Default crown shape
  trunkHeightRatio: 0.35, // Trunk is 35% of tree height
  numCrossCards: 2, // 2 perpendicular billboard cards (cross pattern)
  cardSize: 0.8, // Cards are 80% of crown width for coverage
};

/**
 * Cached tree variant data.
 */
interface TreeVariant {
  /** The generated tree mesh group (LOD0 - full detail) */
  group: THREE.Group;
  /** LOD1 simplified mesh group */
  lod1Group: THREE.Group | null;
  /** LOD2 "card tree" mesh group (trunk + billboard cards) */
  lod2Group: THREE.Group | null;
  /** Vertex count for LOD0 */
  vertexCount: number;
  /** Triangle count for LOD0 */
  triangleCount: number;
  /** Vertex count for LOD1 */
  lod1VertexCount: number;
  /** Triangle count for LOD1 */
  lod1TriangleCount: number;
  /** Vertex count for LOD2 */
  lod2VertexCount: number;
  /** Triangle count for LOD2 */
  lod2TriangleCount: number;
  /** Tree dimensions (for LOD2 card generation) */
  dimensions: { width: number; height: number; trunkHeight: number };
  /** Leaf color extracted from LOD0 */
  leafColor: THREE.Color;
  /** Bark color extracted from LOD0 */
  barkColor: THREE.Color;
}

/**
 * Cache entry for a preset's variants.
 */
interface PresetCache {
  /** Array of generated variants */
  variants: TreeVariant[];
  /** Whether generation is in progress */
  loading: boolean;
  /** Promise for waiting on generation */
  loadPromise: Promise<void> | null;
}

/**
 * Global cache of tree variants per preset.
 */
const presetCache = new Map<string, PresetCache>();

/**
 * TreeGenerator import (lazy loaded to avoid circular deps).
 */
let TreeGenerator: typeof import("@hyperscape/procgen").TreeGenerator | null =
  null;
let procgenLoaded = false;
let procgenLoadPromise: Promise<void> | null = null;
let procgenLoadFailed = false;

/**
 * Lazy load the procgen module.
 * Only runs on client (browser) - returns immediately on server.
 */
async function loadProcgen(): Promise<boolean> {
  // Don't attempt to load on server (no logging - this is called frequently)
  if (typeof window === "undefined") {
    return false;
  }

  if (procgenLoaded) return true;
  if (procgenLoadFailed) return false;
  if (procgenLoadPromise) {
    await procgenLoadPromise;
    return procgenLoaded;
  }

  console.log("[ProcgenTreeCache] Loading @hyperscape/procgen...");

  procgenLoadPromise = (async () => {
    try {
      const procgen = await import("@hyperscape/procgen");
      TreeGenerator = procgen.TreeGenerator;
      procgenLoaded = true;
      console.log("[ProcgenTreeCache] Successfully loaded @hyperscape/procgen");
    } catch (error) {
      console.error(
        "[ProcgenTreeCache] Failed to load @hyperscape/procgen:",
        error,
      );
      procgenLoadFailed = true;
    }
  })();

  await procgenLoadPromise;
  return procgenLoaded;
}

/**
 * Generate LOD1 tree using procgen with reduced geometry settings.
 * This is much more efficient than decimating a high-poly mesh.
 */
async function generateLOD1Tree(
  presetName: string,
  seed: number,
): Promise<{
  group: THREE.Group;
  vertexCount: number;
  triangleCount: number;
} | null> {
  if (!TreeGenerator) {
    return null;
  }

  try {
    // Create generator with LOD1 geometry settings
    const generator = new TreeGenerator(presetName, {
      geometry: LOD1_GEOMETRY_OPTIONS,
    });

    const result = generator.generate(seed);

    // Count vertices and triangles
    let vertexCount = 0;
    let triangleCount = 0;

    result.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const geo = child.geometry;
        if (geo.attributes.position) {
          vertexCount += geo.attributes.position.count;
        }
        if (geo.index) {
          triangleCount += geo.index.count / 3;
        } else if (geo.attributes.position) {
          triangleCount += geo.attributes.position.count / 3;
        }
      }
    });

    return {
      group: result.group,
      vertexCount,
      triangleCount,
    };
  } catch (error) {
    console.warn(
      `[ProcgenTreeCache] LOD1 generation failed for ${presetName}:`,
      error,
    );
    return null;
  }
}

/**
 * Generate tree variants for a preset.
 * Generates both LOD0 (full detail) and LOD1 (simplified) for each variant.
 */
/**
 * Extract colors and dimensions from a generated tree.
 * Handles both standard materials and shader materials (instanced leaves).
 */
function extractTreeMetadata(group: THREE.Group): {
  leafColor: THREE.Color;
  barkColor: THREE.Color;
  dimensions: { width: number; height: number; trunkHeight: number };
} {
  let leafColor = new THREE.Color(0x3d7a3d); // Default green
  let barkColor = new THREE.Color(0x5c4033); // Default brown

  // Extract colors from materials
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      const mat = child.material;

      // Check for instanced leaves (ShaderMaterial with uColor uniform)
      if (
        (child.name === "InstancedLeaves" ||
          child.name === "Leaves" ||
          child.name.toLowerCase().includes("leaf")) &&
        mat instanceof THREE.ShaderMaterial &&
        mat.uniforms?.uColor
      ) {
        const uColor = mat.uniforms.uColor.value;
        if (uColor instanceof THREE.Color) {
          leafColor = uColor.clone();
        }
      }
      // Check for standard/node material leaves (supports both MeshStandardMaterial and MeshStandardNodeMaterial)
      else if (
        (child.name === "Leaves" ||
          child.name.toLowerCase().includes("leaf")) &&
        "color" in mat &&
        mat.color instanceof THREE.Color
      ) {
        leafColor = mat.color.clone();
      }
      // Check for trunk/branches (supports both MeshStandardMaterial and MeshStandardNodeMaterial)
      else if (
        (child.name === "Trunk" ||
          child.name === "Branches" ||
          child.name.toLowerCase().includes("branch")) &&
        "color" in mat &&
        mat.color instanceof THREE.Color
      ) {
        barkColor = mat.color.clone();
      }
    }
  });

  // Calculate dimensions from bounding box
  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  return {
    leafColor,
    barkColor,
    dimensions: {
      width: Math.max(size.x, size.z),
      height: size.y,
      trunkHeight: size.y * LOD2_CARD_OPTIONS.trunkHeightRatio,
    },
  };
}

/**
 * TSL Crown material type with uniforms
 */
type TSLCrownMaterial = MeshBasicNodeMaterial & {
  crownUniforms: {
    color: { value: THREE.Color };
    seed: { value: number };
  };
};

/**
 * Create a procedural crown material for LOD2 billboard cards using TSL (WebGPU).
 * Generates a crown silhouette with leaf-like edges and color variation.
 * Supports different crown shapes: rounded, conical, weeping, columnar, spreading.
 */
function createProceduralCrownMaterialTSL(
  leafColor: THREE.Color,
  crownType: CrownType = "rounded",
  seed: number = 0,
): TSLCrownMaterial {
  const material = new MeshBasicNodeMaterial();

  // Uniforms
  const uColor = uniform(leafColor);
  const uSeed = uniform(seed);

  // ========== TSL HELPER FUNCTIONS ==========

  // Hash function for noise
  const hashFn = Fn(([p]: [ReturnType<typeof vec2>]) => {
    return fract(mul(sin(dot(p, vec2(127.1, 311.7))), float(43758.5453123)));
  });

  // 2D noise function
  const noiseFn = Fn(([p]: [ReturnType<typeof vec2>]) => {
    const i = floor(p);
    const f = fract(p);
    const smoothF = mul(mul(f, f), sub(vec2(3.0, 3.0), mul(f, float(2.0))));

    const a = hashFn(i);
    const b = hashFn(add(i, vec2(1.0, 0.0)));
    const c = hashFn(add(i, vec2(0.0, 1.0)));
    const d = hashFn(add(i, vec2(1.0, 1.0)));

    return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
  });

  // 4-octave FBM (unrolled loop)
  const fbmFn = Fn(([p]: [ReturnType<typeof vec2>]) => {
    const n1 = mul(noiseFn(p), float(0.5));
    const n2 = mul(noiseFn(mul(p, float(2.0))), float(0.25));
    const n3 = mul(noiseFn(mul(p, float(4.0))), float(0.125));
    const n4 = mul(noiseFn(mul(p, float(8.0))), float(0.0625));
    return add(add(add(n1, n2), n3), n4);
  });

  // Crown shape functions based on type (compile-time selection)
  const getCrownRadiusFn = Fn(
    ([p, edgeNoise]: [ReturnType<typeof vec2>, ReturnType<typeof float>]) => {
      if (crownType === "conical") {
        // Conical/pyramidal shape for conifers
        const baseRadius = add(
          float(0.15),
          mul(sub(float(0.5), p.y), float(0.6)),
        );
        const clampedRadius = max(baseRadius, float(0.05));
        return add(clampedRadius, mul(edgeNoise, float(0.5)));
      } else if (crownType === "weeping") {
        // Weeping shape - wider at top, droops down
        const baseRadius = float(0.35);
        const verticalShape = add(float(1.0), mul(p.y, float(0.4)));
        // Add droop effect at the bottom using smoothstep
        const droopAmount = mul(
          smoothstep(float(-0.1), float(-0.4), p.y),
          mul(abs(add(p.y, float(0.1))), float(0.5)),
        );
        return add(mul(baseRadius, add(verticalShape, droopAmount)), edgeNoise);
      } else if (crownType === "columnar") {
        // Narrow columnar shape (like Lombardy poplar)
        const baseRadius = float(0.15);
        const verticalShape = sub(float(1.0), mul(abs(p.y), float(0.2)));
        return add(mul(baseRadius, verticalShape), mul(edgeNoise, float(0.3)));
      } else if (crownType === "spreading") {
        // Wide spreading shape (like oak or maple)
        const baseRadius = float(0.45);
        const verticalShape = sub(
          float(1.0),
          mul(pow(abs(p.y), float(1.5)), float(0.4)),
        );
        return add(mul(baseRadius, verticalShape), edgeNoise);
      } else {
        // Default: rounded deciduous tree shape
        const baseRadius = float(0.4);
        const verticalShape = sub(float(1.0), mul(abs(p.y), float(0.3)));
        return add(mul(baseRadius, verticalShape), edgeNoise);
      }
    },
  );

  // ========== COLOR NODE ==========
  material.colorNode = Fn(() => {
    const uvCoord = uv();

    // Center UV around (0.5, 0.5)
    const p = sub(uvCoord, vec2(0.5, 0.5));

    // Angle and distance from center
    const angle = atan(p.y, p.x);
    const r = length(p);

    // Add noise-based variation to the edge (like leaf clusters)
    const edgeNoise = mul(
      fbmFn(vec2(add(mul(angle, float(3.0)), uSeed), uSeed)),
      float(0.12),
    );

    // Get crown radius based on shape type
    const crownRadius = getCrownRadiusFn(p, edgeNoise);

    // Alpha based on distance from center vs crown radius
    const alpha = sub(
      float(1.0),
      smoothstep(mul(crownRadius, float(0.85)), crownRadius, r),
    );

    // Add internal leaf cluster variation (darker/lighter spots)
    const internalNoise = fbmFn(add(mul(uvCoord, float(8.0)), uSeed));
    const clusterDark = smoothstep(float(0.3), float(0.7), internalNoise);

    // Color variation - simulate light/shadow on leaf clusters
    const darkColor = mul(uColor, float(0.6));
    const lightColor = mul(uColor, float(1.2));
    const baseColor = mix(darkColor, lightColor, clusterDark);

    // Add slight ambient occlusion at edges
    const ao = smoothstep(crownRadius, mul(crownRadius, float(0.5)), r);
    const finalColor = mul(baseColor, add(float(0.8), mul(ao, float(0.2))));

    return vec4(finalColor, alpha);
  })();

  // ========== OPACITY NODE ==========
  material.opacityNode = Fn(() => {
    const uvCoord = uv();
    const p = sub(uvCoord, vec2(0.5, 0.5));
    const angle = atan(p.y, p.x);
    const r = length(p);
    const edgeNoise = mul(
      fbmFn(vec2(add(mul(angle, float(3.0)), uSeed), uSeed)),
      float(0.12),
    );
    const crownRadius = getCrownRadiusFn(p, edgeNoise);
    return sub(
      float(1.0),
      smoothstep(mul(crownRadius, float(0.85)), crownRadius, r),
    );
  })();

  // Material settings
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.depthWrite = true;
  material.alphaTest = 0.1;

  // Store uniforms for runtime updates
  const tslMaterial = material as TSLCrownMaterial;
  tslMaterial.crownUniforms = {
    color: uColor,
    seed: uSeed,
  };

  return tslMaterial;
}

/**
 * Generate LOD2 "card tree" using cross-billboard technique.
 *
 * Cross-billboard: Two perpendicular planes intersecting at center.
 * This is the industry-standard technique for distant vegetation:
 * - Looks good from any viewing angle
 * - Only 4 triangles for the foliage
 * - Procedural crown shader for organic silhouette
 * - Crown shape matches tree type (rounded, conical, weeping, etc.)
 *
 * Total: ~12 triangles per tree
 */
function generateLOD2CardTree(
  dimensions: { width: number; height: number; trunkHeight: number },
  leafColor: THREE.Color,
  barkColor: THREE.Color,
  presetName: string,
  seed: number = 0,
): { group: THREE.Group; vertexCount: number; triangleCount: number } {
  const crownType = getCrownType(presetName);
  const group = new THREE.Group();
  group.name = "LOD2_CardTree";

  const { width, height, trunkHeight } = dimensions;
  const crownHeight = height - trunkHeight;
  const trunkRadius = width * 0.06; // Thin trunk for LOD2

  // Create simple trunk (3-sided for minimum tris)
  const trunkGeometry = new THREE.CylinderGeometry(
    trunkRadius * 0.6, // Top radius (tapers significantly)
    trunkRadius, // Bottom radius
    trunkHeight,
    LOD2_CARD_OPTIONS.trunkSegments,
    1,
    false, // No caps needed at this distance
  );
  // Use MeshBasicNodeMaterial for WebGPU compatibility
  const trunkMaterial = new MeshBasicNodeMaterial();
  trunkMaterial.color = new THREE.Color(barkColor);
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = trunkHeight / 2;
  trunk.name = "LOD2_Trunk";
  group.add(trunk);

  // Create cross-billboard for foliage
  // Two perpendicular planes give good 360° coverage
  const cardWidth = width * LOD2_CARD_OPTIONS.cardSize;
  const cardHeight = crownHeight * 1.1; // Slightly taller to cover crown
  const cardGeometry = new THREE.PlaneGeometry(cardWidth, cardHeight);

  // Procedural crown material with organic leaf-cluster silhouette (TSL for WebGPU)
  const cardMaterial = createProceduralCrownMaterialTSL(
    leafColor,
    crownType,
    seed,
  );

  const crownCenter = trunkHeight + crownHeight * 0.45;

  // Card 1: Facing X axis
  const card1 = new THREE.Mesh(cardGeometry, cardMaterial);
  card1.position.set(0, crownCenter, 0);
  card1.rotation.y = 0; // Face along X
  card1.name = "LOD2_CrossCard_X";
  group.add(card1);

  // Card 2: Facing Z axis (perpendicular to Card 1)
  // Use different seed for visual variation between cards
  const card2Material = createProceduralCrownMaterialTSL(
    leafColor,
    crownType,
    seed + 12345,
  );
  const card2 = new THREE.Mesh(cardGeometry, card2Material);
  card2.position.set(0, crownCenter, 0);
  card2.rotation.y = Math.PI / 2; // Face along Z
  card2.name = "LOD2_CrossCard_Z";
  group.add(card2);

  // Calculate stats
  // Trunk: 3 segments, no caps = 6 verts, 6 tris
  // Cross cards: 2 cards × 4 verts = 8 verts, 2 cards × 2 tris = 4 tris
  const trunkVerts = (LOD2_CARD_OPTIONS.trunkSegments + 1) * 2;
  const trunkTris = LOD2_CARD_OPTIONS.trunkSegments * 2;
  const cardVerts = 4 * LOD2_CARD_OPTIONS.numCrossCards;
  const cardTris = 2 * LOD2_CARD_OPTIONS.numCrossCards;

  return {
    group,
    vertexCount: trunkVerts + cardVerts,
    triangleCount: trunkTris + cardTris,
  };
}

async function generateVariants(presetName: string): Promise<TreeVariant[]> {
  const loaded = await loadProcgen();

  if (!loaded || !TreeGenerator) {
    return []; // Return empty - caller will fall back to GLB
  }

  const variants: TreeVariant[] = [];
  let totalVerts = 0;
  let totalTris = 0;
  let totalLod1Verts = 0;
  let totalLod1Tris = 0;
  let totalLod2Verts = 0;
  let totalLod2Tris = 0;

  for (let i = 0; i < VARIANTS_PER_PRESET; i++) {
    const seed = VARIANT_SEEDS[i];

    // Yield between variants to prevent blocking main thread during pre-warm
    // This spreads CPU-intensive tree generation across multiple frames
    if (i > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    try {
      // Generate LOD0 (full detail) with controlled geometry settings
      const generator = new TreeGenerator(presetName, {
        geometry: LOD0_GEOMETRY_OPTIONS,
      });
      const result = generator.generate(seed);

      // Count vertices and triangles for LOD0
      let vertexCount = 0;
      let triangleCount = 0;

      result.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const geo = child.geometry;
          if (geo.attributes.position) {
            vertexCount += geo.attributes.position.count;
          }
          if (geo.index) {
            triangleCount += geo.index.count / 3;
          } else if (geo.attributes.position) {
            triangleCount += geo.attributes.position.count / 3;
          }
        }
      });

      // Extract metadata from LOD0 for LOD2 generation
      const { leafColor, barkColor, dimensions } = extractTreeMetadata(
        result.group,
      );

      // Generate LOD1 using procgen with reduced settings (same seed for visual consistency)
      const lod1Result = await generateLOD1Tree(presetName, seed);

      // Generate LOD2 "card tree" - ultra-simplified with procedural crown
      // Crown shape is determined by the tree preset (conical for conifers, rounded for deciduous, etc.)
      const lod2Result = generateLOD2CardTree(
        dimensions,
        leafColor,
        barkColor,
        presetName,
        seed,
      );

      // Store the variant
      variants.push({
        group: result.group,
        lod1Group: lod1Result?.group ?? null,
        lod2Group: lod2Result.group,
        vertexCount,
        triangleCount,
        lod1VertexCount: lod1Result?.vertexCount ?? 0,
        lod1TriangleCount: lod1Result?.triangleCount ?? 0,
        lod2VertexCount: lod2Result.vertexCount,
        lod2TriangleCount: lod2Result.triangleCount,
        dimensions,
        leafColor,
        barkColor,
      });

      totalVerts += vertexCount;
      totalTris += triangleCount;
      totalLod1Verts += lod1Result?.vertexCount ?? 0;
      totalLod1Tris += lod1Result?.triangleCount ?? 0;
      totalLod2Verts += lod2Result.vertexCount;
      totalLod2Tris += lod2Result.triangleCount;
    } catch (error) {
      console.error(
        `[ProcgenTreeCache] Failed to generate ${presetName} variant ${i}:`,
        error,
      );
      // Continue with other variants
    }
  }

  // Single log per preset
  if (variants.length > 0) {
    const lod1Reduction =
      totalVerts > 0 ? Math.round((1 - totalLod1Verts / totalVerts) * 100) : 0;
    const lod2Reduction =
      totalVerts > 0 ? Math.round((1 - totalLod2Verts / totalVerts) * 100) : 0;
    console.log(
      `[ProcgenTreeCache] Generated ${variants.length} ${presetName} variants: ` +
        `LOD0=${totalVerts} verts/${Math.round(totalTris)} tris, ` +
        `LOD1=${totalLod1Verts} verts/${Math.round(totalLod1Tris)} tris (${lod1Reduction}% reduction), ` +
        `LOD2=${totalLod2Verts} verts/${Math.round(totalLod2Tris)} tris (${lod2Reduction}% reduction)`,
    );

    // Register first variant with instancer for batched rendering
    // All instances will share this geometry via instancing
    if (worldRef && variants.length > 0) {
      try {
        const instancer = ProcgenTreeInstancer.getInstance(worldRef);
        instancer.registerPreset(
          presetName,
          variants[0].group,
          variants[0].lod1Group,
          variants[0].lod2Group,
        );
      } catch (error) {
        console.warn(
          `[ProcgenTreeCache] Failed to register with instancer:`,
          error,
        );
      }
    }
  }

  return variants;
}

/**
 * Get or create the cache entry for a preset.
 */
function getOrCreateCacheEntry(presetName: string): PresetCache {
  let cache = presetCache.get(presetName);
  if (!cache) {
    cache = {
      variants: [],
      loading: false,
      loadPromise: null,
    };
    presetCache.set(presetName, cache);
  }
  return cache;
}

/**
 * Ensure variants are loaded for a preset.
 */
async function ensureVariantsLoaded(presetName: string): Promise<PresetCache> {
  const cache = getOrCreateCacheEntry(presetName);

  if (cache.variants.length > 0) {
    return cache;
  }

  if (cache.loading && cache.loadPromise) {
    await cache.loadPromise;
    return cache;
  }

  cache.loading = true;
  cache.loadPromise = (async () => {
    try {
      cache.variants = await generateVariants(presetName);
    } finally {
      cache.loading = false;
    }
  })();

  await cache.loadPromise;
  return cache;
}

/**
 * Get a deterministic variant index from an entity ID or seed.
 *
 * @param entityIdOrSeed - Entity ID string or numeric seed
 * @returns Variant index (0 to VARIANTS_PER_PRESET-1)
 */
export function getVariantIndex(entityIdOrSeed: string | number): number {
  let hash: number;

  if (typeof entityIdOrSeed === "number") {
    hash = entityIdOrSeed;
  } else {
    // Simple string hash
    hash = 0;
    for (let i = 0; i < entityIdOrSeed.length; i++) {
      hash = (hash * 31 + entityIdOrSeed.charCodeAt(i)) | 0;
    }
  }

  return Math.abs(hash) % VARIANTS_PER_PRESET;
}

/**
 * Get a tree mesh clone for a given preset and entity.
 *
 * Returns a clone of a pre-generated variant. The clone shares geometry
 * but has its own transform, allowing efficient instancing-like behavior.
 *
 * @param presetName - Procgen preset name (e.g., "blackOak", "weepingWillow")
 * @param entityIdOrSeed - Entity ID or seed for deterministic variant selection
 * @returns Promise resolving to cloned tree group, or null if unavailable
 */
export async function getTreeMeshClone(
  presetName: string,
  entityIdOrSeed: string | number,
): Promise<THREE.Group | null> {
  // Early exit on server
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cache = await ensureVariantsLoaded(presetName);

    if (cache.variants.length === 0) {
      // Don't warn - this is expected if procgen failed to load
      return null;
    }

    const variantIndex = getVariantIndex(entityIdOrSeed);
    const variant = cache.variants[variantIndex % cache.variants.length];

    // Clone the group (shares geometry, creates new Object3D hierarchy)
    const clone = variant.group.clone(true);

    return clone;
  } catch (error) {
    console.error(
      `[ProcgenTreeCache] Error getting tree mesh for ${presetName}:`,
      error,
    );
    return null;
  }
}

/**
 * Get a LOD1 (decimated) tree mesh clone for a given preset and entity.
 *
 * Returns a clone of the pre-generated LOD1 variant with reduced polygon count.
 * Used for medium-distance rendering before impostor kicks in.
 *
 * @param presetName - Procgen preset name (e.g., "blackOak", "weepingWillow")
 * @param entityIdOrSeed - Entity ID or seed for deterministic variant selection
 * @returns Promise resolving to cloned LOD1 group, or null if unavailable
 */
export async function getTreeLOD1Clone(
  presetName: string,
  entityIdOrSeed: string | number,
): Promise<THREE.Group | null> {
  // Early exit on server
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cache = await ensureVariantsLoaded(presetName);

    if (cache.variants.length === 0) {
      return null;
    }

    const variantIndex = getVariantIndex(entityIdOrSeed);
    const variant = cache.variants[variantIndex % cache.variants.length];

    // Return null if LOD1 wasn't generated
    if (!variant.lod1Group) {
      return null;
    }

    // Clone the LOD1 group
    const clone = variant.lod1Group.clone(true);

    return clone;
  } catch (error) {
    console.error(
      `[ProcgenTreeCache] Error getting LOD1 mesh for ${presetName}:`,
      error,
    );
    return null;
  }
}

/**
 * Pre-warm the cache for common presets.
 * Call this during game initialization to avoid hitches during gameplay.
 * Does nothing on server.
 *
 * @param presetNames - Array of preset names to pre-load
 */
export async function prewarmCache(presetNames: string[]): Promise<void> {
  // Skip on server
  if (typeof window === "undefined") {
    return;
  }

  // Try to load procgen first
  const loaded = await loadProcgen();
  if (!loaded) {
    console.warn("[ProcgenTreeCache] Procgen not available, skipping pre-warm");
    return;
  }

  console.log(
    `[ProcgenTreeCache] Pre-warming cache for ${presetNames.length} presets...`,
  );

  const startTime = Date.now();

  // Load all presets in parallel
  await Promise.all(presetNames.map((name) => ensureVariantsLoaded(name)));

  const elapsed = Date.now() - startTime;
  const stats = getCacheStats();
  console.log(
    `[ProcgenTreeCache] Pre-warm complete in ${elapsed}ms (${stats.totalVariants} variants, ${stats.totalVertices} verts)`,
  );
}

/**
 * Get cache statistics for debugging.
 */
export function getCacheStats(): {
  presetCount: number;
  totalVariants: number;
  totalVertices: number;
  totalTriangles: number;
  lod1Vertices: number;
  lod1Triangles: number;
} {
  let totalVariants = 0;
  let totalVertices = 0;
  let totalTriangles = 0;
  let lod1Vertices = 0;
  let lod1Triangles = 0;

  for (const cache of presetCache.values()) {
    totalVariants += cache.variants.length;
    for (const variant of cache.variants) {
      totalVertices += variant.vertexCount;
      totalTriangles += variant.triangleCount;
      lod1Vertices += variant.lod1VertexCount;
      lod1Triangles += variant.lod1TriangleCount;
    }
  }

  return {
    presetCount: presetCache.size,
    totalVariants,
    totalVertices,
    totalTriangles: Math.round(totalTriangles),
    lod1Vertices,
    lod1Triangles: Math.round(lod1Triangles),
  };
}

/**
 * Clear the cache (for testing or memory management).
 */
export function clearCache(): void {
  for (const cache of presetCache.values()) {
    for (const variant of cache.variants) {
      // Dispose geometries and materials
      variant.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const mat of materials) {
              mat.dispose();
            }
          }
        }
      });
    }
  }

  presetCache.clear();
  console.log("[ProcgenTreeCache] Cache cleared");
}

/**
 * Check if procgen module is available.
 * Returns false on server or if procgen failed to load.
 */
export function isProcgenAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return procgenLoaded && !procgenLoadFailed;
}

/**
 * Get the number of variants per preset.
 */
export function getVariantsPerPreset(): number {
  return VARIANTS_PER_PRESET;
}

/**
 * All procgen tree presets used in the game.
 * Use with prewarmCache() to load all variants at startup.
 */
export const TREE_PRESETS = [
  "quakingAspen", // tree_normal
  "blackOak", // tree_oak
  "weepingWillow", // tree_willow
  "blackTupelo", // tree_teak
  "acer", // tree_maple
  "sassafras", // tree_mahogany
  "europeanLarch", // tree_yew
  "hillCherry", // tree_magic
] as const;

export type TreePreset = (typeof TREE_PRESETS)[number];

/**
 * Add a tree instance using instanced rendering.
 * This is the preferred method for rendering procgen trees - uses batched draw calls.
 *
 * @param presetName - Tree preset name
 * @param entityId - Unique entity ID
 * @param position - World position
 * @param rotation - Y-axis rotation in radians
 * @param scale - Uniform scale
 * @param lodLevel - LOD level (0 or 1)
 * @returns True if instance was added
 */
export async function addTreeInstance(
  presetName: string,
  entityId: string,
  position: THREE.Vector3,
  rotation: number,
  scale: number,
  lodLevel: number = 0,
): Promise<boolean> {
  // Ensure variants are loaded first
  await ensureVariantsLoaded(presetName);

  if (!worldRef) {
    console.warn("[ProcgenTreeCache] World not set - cannot add instance");
    return false;
  }

  try {
    const instancer = ProcgenTreeInstancer.getInstance(worldRef);
    return instancer.addInstance(
      presetName,
      entityId,
      position,
      rotation,
      scale,
      lodLevel,
    );
  } catch (error) {
    console.warn("[ProcgenTreeCache] Failed to add instance:", error);
    return false;
  }
}

/**
 * Remove a tree instance.
 */
export function removeTreeInstance(
  presetName: string,
  entityId: string,
  lodLevel: number = 0,
): void {
  if (!worldRef) return;

  try {
    const instancer = ProcgenTreeInstancer.getInstance(worldRef);
    instancer.removeInstance(presetName, entityId, lodLevel);
  } catch (error) {
    console.warn(
      `[ProcgenTreeCache] Failed to remove instance ${entityId} from ${presetName}:`,
      error,
    );
  }
}

/**
 * Update instanced tree matrices, LOD transitions, and wind animation.
 * Call once per frame from the game loop.
 *
 * @param cameraPosition - Optional camera position for LOD calculations
 * @param deltaTime - Time since last frame in seconds (for wind animation)
 */
export function updateTreeInstances(
  cameraPosition?: THREE.Vector3,
  deltaTime: number = 0.016,
): void {
  if (!worldRef) return;

  const instancer = ProcgenTreeInstancer.getInstance(worldRef);
  instancer.update(cameraPosition, deltaTime);
}

/**
 * Get instancing statistics.
 */
export function getTreeInstanceStats(): {
  presets: number;
  totalInstances: number;
  drawCalls: number;
  byLOD: {
    lod0: number;
    lod1: number;
    lod2: number;
    impostor: number;
    culled: number;
  };
  details: Record<
    string,
    { lod0: number; lod1: number; lod2: number; impostor: number }
  >;
} | null {
  if (!worldRef) return null;

  try {
    const instancer = ProcgenTreeInstancer.getInstance(worldRef);
    return instancer.getStats();
  } catch (error) {
    console.warn("[ProcgenTreeCache] Failed to get instancer stats:", error);
    return null;
  }
}

/**
 * Get instancing statistics (alias for getTreeInstanceStats with globalLeaves).
 * Used by DevStats for displaying tree instancing information.
 */
export function getInstancingStats(): {
  presets: number;
  totalInstances: number;
  drawCalls: number;
  byLOD: {
    lod0: number;
    lod1: number;
    lod2: number;
    impostor: number;
    culled: number;
  };
  details: Record<
    string,
    { lod0: number; lod1: number; lod2: number; impostor: number }
  >;
  globalLeaves: { count: number } | null;
} | null {
  const stats = getTreeInstanceStats();
  if (!stats) return null;

  // Add globalLeaves for backwards compatibility with DevStats
  return {
    ...stats,
    globalLeaves: null, // No leaf data currently tracked
  };
}
