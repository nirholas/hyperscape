/**
 * GrassShader - Breath of the Wild Style GPU Grass
 *
 * Uses MeshStandardNodeMaterial for unified lighting with terrain.
 * - Quad blade geometry (3 triangles for articulation)
 * - WORLD-ALIGNED grid (grass doesn't move with player)
 * - Wind animation on tips
 * - Same lighting as terrain (sun + ambient)
 */

import THREE, {
  MeshStandardNodeMaterial,
  uniform,
  texture,
  float,
  vec2,
  vec3,
  add,
  sub,
  mul,
  div,
  mod,
  mix,
  smoothstep,
  sin,
  max,
  min,
  length,
  floor,
  fract,
  positionLocal,
  cameraPosition,
  instanceIndex,
  attribute,
  Fn,
} from "../../../extras/three/three";

import { TERRAIN_CONSTANTS } from "./TerrainShader";

// ============================================================================
// GRASS CONFIGURATION
// ============================================================================

export const GRASS_CONFIG = {
  // Blade size
  BLADE_WIDTH: 0.15,
  BLADE_HEIGHT: 0.7,

  // Wind
  WIND_STRENGTH: 0.1,
  WIND_SPEED: 0.8,

  // Density
  GRID_SIZE: 300,
  BLADES_PER_CELL: 12,
  AREA_SIZE: 100.0,
  CELL_SIZE: 100.0 / 250,

  // Fade - MUCH more gradual (30m fade zone)
  FADE_START: 40.0,
  FADE_END: 95.0,

  // Terrain
  NOISE_SCALE: TERRAIN_CONSTANTS.NOISE_SCALE,
  GRASS_THRESHOLD: TERRAIN_CONSTANTS.DIRT_THRESHOLD + 0.085,
  WATER_LEVEL: 5.5,
};

// ============================================================================
// GRASS BLADE GEOMETRY - Quad for articulation
// ============================================================================

export function createGrassBladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  const hw = GRASS_CONFIG.BLADE_WIDTH / 2;
  const h = GRASS_CONFIG.BLADE_HEIGHT;
  const midH = h * 0.5;
  const midW = hw * 0.7;

  // 3 triangles for quad blade
  const positions = new Float32Array([
    -hw,
    0,
    0,
    hw,
    0,
    0,
    midW,
    midH,
    0,
    -hw,
    0,
    0,
    midW,
    midH,
    0,
    -midW,
    midH,
    0,
    -midW,
    midH,
    0,
    midW,
    midH,
    0,
    0,
    h,
    0,
  ]);

  const uvs = new Float32Array([
    0, 0, 1, 0, 0.85, 0.5, 0, 0, 0.85, 0.5, 0.15, 0.5, 0.15, 0.5, 0.85, 0.5,
    0.5, 1,
  ]);

  const vertexHeights = new Float32Array([0, 0, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 1]);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "vertexHeight",
    new THREE.BufferAttribute(vertexHeights, 1),
  );
  geometry.computeVertexNormals();

  return geometry;
}

// ============================================================================
// GPU HASH
// ============================================================================

const hash = Fn(([n]: [ReturnType<typeof float>]) => {
  return fract(mul(sin(n), float(43758.5453)));
});

// ============================================================================
// GRASS UNIFORMS
// ============================================================================

export type GrassUniforms = {
  time: { value: number };
  playerPosition: { value: THREE.Vector3 };
  sunDirection: { value: THREE.Vector3 };
  heightMapSize: { value: number };
  heightMapCenter: { value: THREE.Vector2 };
};

// ============================================================================
// GRASS MATERIAL - Unified lighting with terrain
// ============================================================================

export function createGrassMaterial(
  heightMap: THREE.DataTexture,
  noiseTexture: THREE.DataTexture,
): THREE.Material & { grassUniforms: GrassUniforms } {
  const uTime = uniform(float(0));
  const uPlayerPos = uniform(vec3(0, 0, 0));
  const uSunDir = uniform(vec3(0.5, 0.8, 0.3));
  const uHeightMapSize = uniform(float(GRASS_CONFIG.AREA_SIZE));
  const uHeightMapCenter = uniform(vec2(0, 0));

  const heightTex = texture(heightMap);
  const noiseTex = texture(noiseTexture);

  // Use MeshStandardNodeMaterial for unified lighting!
  const material = new MeshStandardNodeMaterial();

  const vHeight = attribute("vertexHeight");
  const localPos = positionLocal;

  // ===== WORLD-ALIGNED GRID =====
  const gridSize = float(GRASS_CONFIG.GRID_SIZE);
  const bladesPerCell = float(GRASS_CONFIG.BLADES_PER_CELL);
  const cellSize = float(GRASS_CONFIG.CELL_SIZE);
  const halfGrid = mul(gridSize, float(0.5));

  const cellIdx = floor(div(float(instanceIndex), bladesPerCell));
  const bladeIdx = mod(float(instanceIndex), bladesPerCell);

  const localCellX = mod(cellIdx, gridSize);
  const localCellZ = floor(div(cellIdx, gridSize));

  const playerGridX = floor(div(uPlayerPos.x, cellSize));
  const playerGridZ = floor(div(uPlayerPos.z, cellSize));

  const worldCellX = add(playerGridX, sub(localCellX, halfGrid));
  const worldCellZ = add(playerGridZ, sub(localCellZ, halfGrid));

  // World-stable random seeds - completely independent per blade
  // Use large prime multipliers to avoid patterns
  const cellSeed = add(
    mul(worldCellX, float(127.1)),
    mul(worldCellZ, float(311.7)),
  );
  const bladeSeed = add(cellSeed, mul(bladeIdx, float(43758.5453)));

  // Generate 6 independent random values per blade
  const rand1 = hash(bladeSeed);
  const rand2 = hash(mul(bladeSeed, float(1.1)));
  const rand3 = hash(mul(bladeSeed, float(1.2)));
  const rand4 = hash(mul(bladeSeed, float(1.3)));
  const rand5 = hash(mul(bladeSeed, float(1.4)));
  const _rand6 = hash(mul(bladeSeed, float(1.5)));

  // Position: completely random within a 2x2 cell area (allows overlap between cells)
  // This breaks the grid by letting blades spread beyond their "home" cell
  const spreadFactor = float(2.0); // Blades can be anywhere in 2x2 cells
  const cellCornerX = mul(worldCellX, cellSize);
  const cellCornerZ = mul(worldCellZ, cellSize);

  // Random offset from cell corner (can go negative or exceed cell size)
  const offsetX = mul(sub(rand1, float(0.25)), mul(cellSize, spreadFactor));
  const offsetZ = mul(sub(rand2, float(0.25)), mul(cellSize, spreadFactor));

  // Add a second layer of randomization using different randoms
  const jitterX = mul(sub(rand3, float(0.5)), cellSize);
  const jitterZ = mul(sub(rand4, float(0.5)), cellSize);

  const worldX = add(cellCornerX, add(offsetX, jitterX));
  const worldZ = add(cellCornerZ, add(offsetZ, jitterZ));

  // Use remaining randoms for scale
  const randScale = rand5;

  // ===== TERRAIN NOISE =====
  const noiseUV = mul(vec2(worldX, worldZ), float(GRASS_CONFIG.NOISE_SCALE));
  const noiseValue = noiseTex.sample(noiseUV).r;

  // onGrass: 1.0 = full grass, 0.0 = dirt
  const onGrass = sub(
    float(1.0),
    smoothstep(
      float(GRASS_CONFIG.GRASS_THRESHOLD - 0.12), // Wider fade zone
      float(GRASS_CONFIG.GRASS_THRESHOLD),
      noiseValue,
    ),
  );

  // ===== TERRAIN HEIGHT =====
  const relX = div(sub(worldX, uHeightMapCenter.x), uHeightMapSize);
  const relZ = div(sub(worldZ, uHeightMapCenter.y), uHeightMapSize);
  const heightUV = vec2(add(relX, float(0.5)), add(relZ, float(0.5)));

  const clampedU = max(float(0.0), min(float(1.0), heightUV.x));
  const clampedV = max(float(0.0), min(float(1.0), heightUV.y));
  const terrainHeight = heightTex.sample(vec2(clampedU, clampedV)).r;

  // ===== WATER MASKING =====
  const aboveWater = smoothstep(
    float(GRASS_CONFIG.WATER_LEVEL),
    float(GRASS_CONFIG.WATER_LEVEL + 0.5),
    terrainHeight,
  );

  // ===== DISTANCE FADE - Very gradual 55m fade zone =====
  const distXZ = length(
    vec2(sub(worldX, uPlayerPos.x), sub(worldZ, uPlayerPos.z)),
  );
  const distNorm = div(
    sub(distXZ, float(GRASS_CONFIG.FADE_START)),
    float(GRASS_CONFIG.FADE_END - GRASS_CONFIG.FADE_START),
  );
  const distClamped = max(float(0.0), min(float(1.0), distNorm));
  // Cubic ease-out for even smoother fade
  const oneMinusDist = sub(float(1.0), distClamped);
  const distFade = mul(mul(oneMinusDist, oneMinusDist), oneMinusDist);

  const visibility = mul(mul(onGrass, aboveWater), distFade);

  // ===== SCALE - Taper into dirt edges =====
  const scale = add(float(0.7), mul(randScale, float(0.6)));
  const bladeW = mul(float(GRASS_CONFIG.BLADE_WIDTH), scale);
  const bladeH = mul(float(GRASS_CONFIG.BLADE_HEIGHT), scale);

  // ===== BILLBOARD =====
  const toCamX = sub(cameraPosition.x, worldX);
  const toCamZ = sub(cameraPosition.z, worldZ);
  const camDist = max(length(vec2(toCamX, toCamZ)), float(0.001));
  const rightX = div(toCamZ, camDist);
  const rightZ = div(mul(toCamX, float(-1.0)), camDist);

  // ===== WIND =====
  const windTime = mul(uTime, float(GRASS_CONFIG.WIND_SPEED));
  const mainWind = sin(
    add(windTime, add(mul(worldX, float(0.1)), mul(worldZ, float(0.08)))),
  );
  const gust = mul(
    sin(add(mul(windTime, float(1.5)), mul(worldX, float(0.3)))),
    float(0.3),
  );
  const tipFlex = mul(vHeight, vHeight);
  const windOffset = mul(
    mul(add(mainWind, gust), float(GRASS_CONFIG.WIND_STRENGTH)),
    tipFlex,
  );

  // ===== FINAL POSITION =====
  const billboardX = mul(mul(localPos.x, rightX), bladeW);
  const billboardZ = mul(mul(localPos.x, rightZ), bladeW);
  const height = mul(localPos.y, bladeH);

  const finalX = add(worldX, add(billboardX, windOffset));
  const finalY = add(terrainHeight, height);
  const finalZ = add(worldZ, add(billboardZ, mul(windOffset, float(0.3))));

  const visScale = max(visibility, float(0.001));
  material.positionNode = vec3(
    mul(finalX, visScale),
    mul(finalY, visScale),
    mul(finalZ, visScale),
  );

  // ===== COLOR - Match terrain grass texture brightness =====
  // These values are tuned to match stylized_grass_d.png after MeshStandardMaterial lighting
  const baseColor = vec3(0.12, 0.25, 0.06); // Dark green base
  const tipColor = vec3(0.22, 0.42, 0.12); // Brighter tip
  const grassColor = mix(baseColor, tipColor, vHeight);

  // Subtle variation
  const colorVar = mul(sub(randScale, float(0.5)), float(0.04));
  const variedColor = add(
    grassColor,
    vec3(colorVar, mul(colorVar, float(1.2)), mul(colorVar, float(0.5))),
  );

  material.colorNode = variedColor;
  material.opacityNode = visibility;

  // Material properties for unified lighting
  material.roughness = 0.9; // Mostly rough like terrain
  material.metalness = 0.0;
  material.transparent = true;
  material.alphaTest = 0.01;
  material.side = THREE.DoubleSide;
  material.depthWrite = true;

  const grassUniforms: GrassUniforms = {
    time: uTime,
    playerPosition: uPlayerPos,
    sunDirection: uSunDir,
    heightMapSize: uHeightMapSize,
    heightMapCenter: uHeightMapCenter,
  };

  const result = material as unknown as THREE.Material & {
    grassUniforms: GrassUniforms;
  };
  result.grassUniforms = grassUniforms;

  return result;
}
