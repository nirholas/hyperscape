// @ts-nocheck - TSL functions use dynamic array destructuring that TypeScript doesn't support
/**
 * ProceduralGrass.ts - GPU Grass System (Revo Realms Parity)
 *
 * EXACT port from Revo Realms GrassField.ts with heightmap integration.
 *
 * Key architecture (matching Revo Realms):
 * - SpriteNodeMaterial for billboard grass
 * - Two-buffer SSBO (vec4 + float) with bit-packed data
 * - Visibility NOT used for opacity/scale (only for offscreen culling)
 * - Wind stored as vec2 displacement
 *
 * Hyperscape additions:
 * - Heightmap Y offset (Revo uses flat Y=0 terrain)
 * - Integration with terrain system
 *
 * @module ProceduralGrass
 */

import THREE, {
  uniform,
  Fn,
  float,
  vec3,
  vec4,
  vec2,
  sin,
  mix,
  uv,
  floor,
  instanceIndex,
  hash,
  smoothstep,
  clamp,
  PI2,
  remap,
  instancedArray,
  texture,
  fract,
  time,
} from "../../../extras/three/three";
import { SpriteNodeMaterial } from "three/webgpu";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { tslUtils } from "../../../utils/TSLUtils";
import { windManager } from "./Wind";

// ============================================================================
// CONFIGURATION - Matches Revo Realms exactly
// ============================================================================

const getConfig = () => {
  const BLADE_WIDTH = 0.1;
  const BLADE_HEIGHT = 1.45;
  const TILE_SIZE = 50;
  const BLADES_PER_SIDE = 512;

  return {
    BLADE_WIDTH,
    BLADE_HEIGHT,
    BLADE_BOUNDING_SPHERE_RADIUS: BLADE_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    BLADES_PER_SIDE,
    COUNT: BLADES_PER_SIDE * BLADES_PER_SIDE, // 262,144
    SPACING: TILE_SIZE / BLADES_PER_SIDE,
    WORKGROUP_SIZE: 256,
    SEGMENTS: 5, // Geometry segments
  };
};

const config = getConfig();

// ============================================================================
// UNIFORMS - Matches Revo Realms exactly
// ============================================================================

const uniforms = {
  uPlayerPosition: uniform(new THREE.Vector3(0, 0, 0)),
  uCameraMatrix: uniform(new THREE.Matrix4()),
  uPlayerDeltaXZ: uniform(new THREE.Vector2(0, 0)),
  uCameraForward: uniform(new THREE.Vector3(0, 0, 0)),
  // Scale
  uBladeMinScale: uniform(0.75),
  uBladeMaxScale: uniform(1.5),
  // Trail
  uTrailGrowthRate: uniform(0.04),
  uTrailMinScale: uniform(0.5),
  uTrailRadius: uniform(1),
  uTrailRadiusSquared: uniform(1),
  uKDown: uniform(0.8),
  // Wind
  uWindStrength: uniform(1.25),
  uWindSpeed: uniform(0.25),
  uvWindScale: uniform(1.75),
  // Color
  uBaseColor: uniform(new THREE.Color().setRGB(0.07, 0.07, 0)),
  uTipColor: uniform(new THREE.Color().setRGB(0.23, 0.11, 0.05)),
  uAoScale: uniform(1.5),
  uAoRimSmoothness: uniform(5),
  uAoRadius: uniform(20),
  uAoRadiusSquared: uniform(20 * 20),
  uColorMixFactor: uniform(1),
  uColorVariationStrength: uniform(1.6),
  uWindColorStrength: uniform(0.6),
  uBaseWindShade: uniform(0.4),
  uBaseShadeHeight: uniform(1.25),
  // Stochastic keep
  uR0: uniform(45),
  uR1: uniform(75),
  uPMin: uniform(0.1),
  // Rotation
  uBaseBending: uniform(1.25),
};

// Noise texture for wind and position variation
let noiseAtlasTexture: THREE.Texture | null = null;

// Heightmap texture for terrain Y offset
let heightmapTexture: THREE.Texture | null = null;
let heightmapMax = 100;

// ============================================================================
// GRASS SSBO - Two-buffer bit-packed data structure (Revo Realms exact)
// ============================================================================
// Buffer1 (vec4):
//   x -> offsetX
//   y -> offsetZ
//   z -> 0/12 windX - 12/12 windZ
//   w -> 0/8 current scale - 8/8 original scale - 16/1 shadow - 17/1 visibility - 18/6 wind noise factor
//
// Buffer2 (float):
//   0/4 position based noise

type InstancedArrayBuffer = ReturnType<typeof instancedArray>;

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
// @ts-nocheck - TSL functions use dynamic typing that TypeScript can't understand
class GrassSsbo {
  private buffer1: InstancedArrayBuffer;
  private buffer2: InstancedArrayBuffer;

  constructor() {
    this.buffer1 = instancedArray(config.COUNT, "vec4");
    this.buffer2 = instancedArray(config.COUNT, "float");
    this.computeUpdate.onInit(({ renderer }) => {
      renderer.computeAsync(this.computeInit);
    });
  }

  get computeBuffer1(): InstancedArrayBuffer {
    return this.buffer1;
  }

  get computeBuffer2(): InstancedArrayBuffer {
    return this.buffer2;
  }

  // Unpacking functions (Revo Realms exact)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWind: any = Fn(
    // @ts-expect-error TSL array destructuring
    ([data = vec4(0)]) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const x = tslUtils.unpackUnits(data.z, 0, 12, -2, 2);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const z = tslUtils.unpackUnits(data.z, 12, 12, -2, 2);
      return vec2(x, z);
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getScale: any = Fn(([data = vec4(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.unpackUnits(
      data.w,
      0,
      8,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOriginalScale: any = Fn(([data = vec4(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.unpackUnits(
      data.w,
      8,
      8,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVisibility: any = Fn(([data = vec4(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.unpackFlag(data.w, 17);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWindNoise: any = Fn(([data = vec4(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.unpackUnit(data.w, 18, 6);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPositionNoise: any = Fn(([data = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.unpackUnit(data, 0, 4);
  });

  // Packing functions (Revo Realms exact)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setWind: any = Fn(([data = vec4(0), value = vec2(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.z = tslUtils.packUnits(data.z, 0, 12, value.x, -2, 2);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.z = tslUtils.packUnits(data.z, 12, 12, value.y, -2, 2);
    return data;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setScale: any = Fn(([data = vec4(0), value = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.w = tslUtils.packUnits(
      data.w,
      0,
      8,
      value,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setOriginalScale: any = Fn(([data = vec4(0), value = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.w = tslUtils.packUnits(
      data.w,
      8,
      8,
      value,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setVisibility: any = Fn(([data = vec4(0), value = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.w = tslUtils.packFlag(data.w, 17, value);
    return data;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setWindNoise: any = Fn(([data = vec4(0), value = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    data.w = tslUtils.packUnit(data.w, 18, 6, value);
    return data;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setPositionNoise: any = Fn(([data = float(0), value = float(0)]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return tslUtils.packUnit(data, 0, 4, value);
  });

  // Compute Init - Revo Realms exact
  computeInit = Fn(() => {
    const data1 = this.buffer1.element(instanceIndex);
    const data2 = this.buffer2.element(instanceIndex);

    // Position XZ in grid
    const row = floor(float(instanceIndex).div(config.BLADES_PER_SIDE));
    const col = float(instanceIndex).mod(config.BLADES_PER_SIDE);
    const randX = hash(instanceIndex.add(4321));
    const randZ = hash(instanceIndex.add(1234));
    const offsetX = col
      .mul(config.SPACING)
      .sub(config.TILE_HALF_SIZE)
      .add(randX.mul(config.SPACING * 0.5));
    const offsetZ = row
      .mul(config.SPACING)
      .sub(config.TILE_HALF_SIZE)
      .add(randZ.mul(config.SPACING * 0.5));

    // UV for noise texture sampling
    const _uv = vec3(offsetX, 0, offsetZ)
      .xz.add(config.TILE_HALF_SIZE)
      .div(config.TILE_SIZE)
      .abs()
      .fract();

    // Sample noise texture for position jitter (or use hash fallback)
    let noiseR: ReturnType<typeof float>;
    let noiseB: ReturnType<typeof float>;

    if (noiseAtlasTexture) {
      const noise = texture(noiseAtlasTexture, _uv);
      noiseR = noise.r;
      noiseB = noise.b;
    } else {
      noiseR = hash(instanceIndex.mul(0.73));
      noiseB = hash(instanceIndex.mul(0.91));
    }

    const noiseX = noiseR.sub(0.5).mul(17).fract();
    const noiseZ = noiseB.sub(0.5).mul(13).fract();
    data1.x = offsetX.add(noiseX);
    data1.y = offsetZ.add(noiseZ);

    data2.assign(this.setPositionNoise(data2, noiseR));

    // Scale - random within range (shaped distribution)
    const n = noiseB;
    const shaped = n.mul(n);
    const randomScale = remap(
      shaped,
      0,
      1,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
    data1.assign(this.setScale(data1, randomScale));
    data1.assign(this.setOriginalScale(data1, randomScale));

    // Set visibility to 1 initially (visible)
    data1.assign(this.setVisibility(data1, float(1)));
  })().compute(config.COUNT, [config.WORKGROUP_SIZE]);

  // Compute Wind - Revo Realms exact
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private computeWind: any = Fn(
    ([prevWindXZ = vec2(0), worldPos = vec3(0), positionNoise = float(0)]) => {
      const intensity = smoothstep(0.2, 0.5, windManager.uIntensity);
      const dir = windManager.uDirection.negate();
      const strength = uniforms.uWindStrength.add(intensity);

      // Gentle per-instance speed jitter (±10%)
      const speed = uniforms.uWindSpeed.mul(
        positionNoise.remap(0, 1, 0.95, 2.05),
      );

      // Base UV + scroll
      const uvBase = worldPos.xz.mul(0.01).mul(uniforms.uvWindScale);
      const scroll = dir.mul(speed).mul(time);

      // Sample noise textures for wind
      const uvA = uvBase.add(scroll);
      const uvB = uvBase.mul(1.37).add(scroll.mul(1.11));

      // Use texture if available, otherwise hash fallback
      const sampleNoise = (uvCoord: ReturnType<typeof vec2>) => {
        if (noiseAtlasTexture) {
          return texture(noiseAtlasTexture, uvCoord).mul(2.0).sub(1.0);
        }
        return vec3(hash(uvCoord.x.add(uvCoord.y.mul(100))))
          .mul(2.0)
          .sub(1.0);
      };

      const nA = sampleNoise(uvA);
      const nB = sampleNoise(uvB);

      // Mix noises
      const mixRand = fract(sin(positionNoise.mul(12.9898)).mul(78.233));
      const mixTime = sin(time.mul(0.4).add(positionNoise.mul(0.1))).mul(0.25);
      const w = clamp(mixRand.add(mixTime), 0.2, 0.8);
      const n = mix(nA, nB, w);

      const baseMag = n.x.mul(strength);
      const gustMag = n.y.mul(strength).mul(0.35);
      const windFactor = baseMag.add(gustMag);

      const target = dir.mul(windFactor);
      const k = mix(0.08, 0.25, n.z.abs());
      const newWind = prevWindXZ.add(target.sub(prevWindXZ).mul(k));

      return vec3(newWind, windFactor);
    },
  );

  // Compute Trail Scale - Revo Realms exact
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private computeTrailScale: any = Fn(
    ([
      originalScale = float(0),
      currentScale = float(0),
      isStepped = float(0),
    ]) => {
      const up = currentScale.add(
        originalScale.sub(currentScale).mul(uniforms.uTrailGrowthRate),
      );
      const down = currentScale.add(
        uniforms.uTrailMinScale.sub(currentScale).mul(uniforms.uKDown),
      );
      const blended = mix(up, down, isStepped);
      return clamp(blended, uniforms.uTrailMinScale, originalScale);
    },
  );

  // Compute Update - Revo Realms exact (no visibility computation)
  computeUpdate = Fn(() => {
    const data1 = this.buffer1.element(instanceIndex);

    // Position
    const pos = vec3(data1.x, 0, data1.y);
    const worldPos = pos.add(uniforms.uPlayerPosition);

    const data2 = this.buffer2.element(instanceIndex);

    // Compute distance to player
    const diff = worldPos.xz.sub(uniforms.uPlayerPosition.xz);
    const distSq = diff.dot(diff);

    // Check if player is on ground
    const isPlayerGrounded = clamp(
      float(1).sub(uniforms.uPlayerPosition.y.sub(worldPos.y).abs().div(2)),
      0,
      1,
    );

    const inner = uniforms.uTrailRadiusSquared.mul(0.35);
    const outer = uniforms.uTrailRadiusSquared;
    const contact = float(1.0)
      .sub(smoothstep(inner, outer, distSq))
      .mul(isPlayerGrounded);

    // Trail scale
    const currentScale = this.getScale(data1);
    const originalScale = this.getOriginalScale(data1);
    const newScale = this.computeTrailScale(
      originalScale,
      currentScale,
      contact,
    );
    data1.assign(this.setScale(data1, newScale));

    // Wind
    const positionNoise = this.getPositionNoise(data2);
    const prevWind = this.getWind(data1);
    const newWind = this.computeWind(prevWind, worldPos, positionNoise);
    data1.assign(this.setWind(data1, newWind.xy));
    data1.assign(this.setWindNoise(data1, newWind.z));
  })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
}

// ============================================================================
// GRASS MATERIAL - SpriteNodeMaterial (Revo Realms exact + heightmap)
// ============================================================================

class GrassMaterial extends SpriteNodeMaterial {
  private ssbo: GrassSsbo;

  constructor(ssbo: GrassSsbo) {
    super();
    this.ssbo = ssbo;
    this.createGrassMaterial();
  }

  private createGrassMaterial(): void {
    // Revo Realms exact settings
    this.precision = "lowp";
    this.transparent = false;
    this.alphaTest = 0.9;

    // Get data from SSBO
    const data1 = this.ssbo.computeBuffer1.element(instanceIndex);
    const data2 = this.ssbo.computeBuffer2.element(instanceIndex);
    const offsetX = data1.x;
    const offsetZ = data1.y;
    const windXZ = this.ssbo.getWind(data1);
    const scaleY = this.ssbo.getScale(data1);
    const isVisible = this.ssbo.getVisibility(data1);
    const windNoiseFactor = this.ssbo.getWindNoise(data1);
    const positionNoise = this.ssbo.getPositionNoise(data2);

    // OPACITY - NOT SET (Revo Realms has this commented out)
    // this.opacityNode = isVisible;

    // SCALE - NO visibility multiplication (Revo Realms exact)
    const scaleX = positionNoise.add(0.25);
    const bladeScale = vec3(scaleX, scaleY, 1);
    this.scaleNode = bladeScale;

    // ROTATION - Revo Realms exact
    const h = uv().y;
    const bendProfile = h.mul(h).mul(uniforms.uBaseBending);
    const instanceNoise = hash(instanceIndex.add(196.4356)).sub(0.5).mul(0.25);
    const baseBending = positionNoise
      .sub(0.5)
      .mul(0.25)
      .add(instanceNoise)
      .mul(bendProfile);
    this.rotationNode = vec3(baseBending, 0, 0);

    // POSITION
    // Offscreen culling using 1e6 (Revo Realms exact)
    const offscreenOffset = uniforms.uCameraForward
      .mul(1e6)
      .mul(float(1).sub(isVisible));

    // Get Y offset from heightmap (HYPERSCAPE ADDITION)
    let offsetY: ReturnType<typeof float>;
    if (heightmapTexture) {
      // Sample heightmap at world position
      const worldX = offsetX.add(uniforms.uPlayerPosition.x);
      const worldZ = offsetZ.add(uniforms.uPlayerPosition.z);
      const hmapUv = tslUtils.computeMapUvByPosition(vec2(worldX, worldZ));
      const fixedUv = vec2(hmapUv.x, float(1).sub(hmapUv.y));
      offsetY = texture(heightmapTexture, fixedUv).r.mul(heightmapMax);
    } else {
      // No heightmap - use player Y as base
      offsetY = uniforms.uPlayerPosition.y;
    }

    // Base offset with heightmap Y
    const bladePosition = vec3(
      offsetX,
      offsetY.sub(uniforms.uPlayerPosition.y),
      offsetZ,
    );

    // Sway effect - Revo Realms exact (uses time instead of gameTime)
    const randomPhase = positionNoise.mul(PI2);
    const swayAmount = sin(time.mul(5).add(randomPhase)).mul(0.15);
    const swayFactor = uv().y.mul(windNoiseFactor);
    const swayOffset = swayAmount.mul(swayFactor);

    // Flutter offset - Revo Realms exact
    const dirXZ = windManager.uDirection;
    const perp = vec2(dirXZ.y.negate(), dirXZ.x);
    const phase = hash(instanceIndex).mul(PI2);
    const flutter = sin(
      time.mul(uniforms.uWindSpeed.mul(1.7)).add(phase.mul(1.3)),
    )
      .mul(0.06)
      .mul(bendProfile);
    const flutterOffset = vec3(perp.x, 0.0, perp.y).mul(flutter);

    // Wind offset - Revo Realms exact
    const windOffset = vec3(windXZ.x, 0.0, windXZ.y).mul(bendProfile);

    const pos = bladePosition
      .add(offscreenOffset)
      .add(swayOffset)
      .add(flutterOffset)
      .add(windOffset);
    this.positionNode = pos;

    // COLOR + AO - Revo Realms exact
    const r2 = offsetX.mul(offsetX).add(offsetZ.mul(offsetZ));
    const near = float(1).sub(smoothstep(0, uniforms.uAoRadiusSquared, r2));
    const x = uv().x;
    const edge = x.mul(2.0).sub(1.0).abs();
    const rim = smoothstep(
      uniforms.uAoRimSmoothness.negate(),
      uniforms.uAoRimSmoothness,
      edge,
    );
    const hWeight = float(1).sub(smoothstep(0.1, 0.85, h));
    const aoStrength = uniforms.uAoScale.mul(0.25);
    const ao = float(1).sub(aoStrength.mul(near.mul(rim).mul(hWeight)));

    // Diffuse color - Revo Realms exact
    const colorProfile = h.mul(uniforms.uColorMixFactor).clamp();
    const jitter = positionNoise.mul(uniforms.uColorVariationStrength);
    const baseColorJittered = uniforms.uBaseColor.mul(jitter);
    const baseToTip = mix(baseColorJittered, uniforms.uTipColor, colorProfile);
    const baseMask = float(1).sub(
      smoothstep(0.0, uniforms.uBaseShadeHeight, h),
    );
    const windAo = mix(
      1.0,
      float(1).sub(uniforms.uBaseWindShade),
      baseMask.mul(smoothstep(0.0, 1.0, swayFactor)),
    );
    this.colorNode = baseToTip.mul(windAo).mul(ao);
  }
}

// ============================================================================
// MAIN GRASS SYSTEM
// ============================================================================

export class ProceduralGrassSystem extends System {
  private mesh: THREE.InstancedMesh | null = null;
  private ssbo: GrassSsbo | null = null;
  private renderer: THREE.WebGPURenderer | null = null;
  private grassInitialized = false;
  private noiseTexture: THREE.Texture | null = null;

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: [], optional: ["graphics", "terrain"] };
  }

  async start(): Promise<void> {
    if (!this.world.isClient || typeof window === "undefined") return;

    this.renderer =
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    await this.initializeGrass();
  }

  private async loadTextures(): Promise<void> {
    // Try to get terrain textures
    const terrainSystem = this.world.getSystem("terrain") as {
      heightmapTexture?: THREE.Texture;
      heightmapMax?: number;
    } | null;

    if (terrainSystem?.heightmapTexture) {
      heightmapTexture = terrainSystem.heightmapTexture;
      heightmapMax = terrainSystem.heightmapMax ?? 100;
      console.log(
        "[ProceduralGrass] Using terrain heightmap, max:",
        heightmapMax,
      );
    } else {
      console.log(
        "[ProceduralGrass] No heightmap - grass will be at player Y level",
      );
    }

    // Load noise texture (optional)
    const loader = new THREE.TextureLoader();
    try {
      const noise = await new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          "/textures/noise.png",
          (tex) => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            resolve(tex);
          },
          undefined,
          reject,
        );
      });
      this.noiseTexture = noise;
      noiseAtlasTexture = noise;
      console.log("[ProceduralGrass] Loaded noise texture");
    } catch {
      console.log("[ProceduralGrass] Using hash fallback for noise");
    }
  }

  private async initializeGrass(): Promise<void> {
    if (this.grassInitialized) return;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    this.renderer ??=
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    if (!this.renderer) {
      console.warn("[ProceduralGrass] No WebGPU renderer available");
      return;
    }

    try {
      await this.loadTextures();

      // Create SSBO
      this.ssbo = new GrassSsbo();

      // Create geometry (Revo Realms exact)
      const geometry = this.createGeometry(config.SEGMENTS);

      // Create material (Revo Realms exact + heightmap)
      const material = new GrassMaterial(this.ssbo);

      // Create instanced mesh
      this.mesh = new THREE.InstancedMesh(geometry, material, config.COUNT);
      this.mesh.frustumCulled = false;
      this.mesh.name = "ProceduralGrass_GPU";

      stage.scene.add(this.mesh);
      this.grassInitialized = true;

      console.log(
        `[ProceduralGrass] Initialized with ${config.COUNT.toLocaleString()} blades`,
      );
    } catch (error) {
      console.error("[ProceduralGrass] ERROR:", error);
    }
  }

  private createGeometry(nSegments: number): THREE.BufferGeometry {
    // Revo Realms exact geometry
    const segments = Math.max(1, Math.floor(nSegments));
    const height = config.BLADE_HEIGHT;
    const halfWidthBase = config.BLADE_WIDTH * 0.5;

    const rowCount = segments;
    const vertexCount = rowCount * 2 + 1;
    const quadCount = Math.max(0, rowCount - 1);
    const indexCount = quadCount * 6 + 3;

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint8Array(indexCount);

    const taper = (t: number) => halfWidthBase * (1.0 - 0.7 * t);

    let idx = 0;
    for (let row = 0; row < rowCount; row++) {
      const v = row / segments;
      const y = v * height;
      const halfWidth = taper(v);

      const left = row * 2;
      const right = left + 1;

      positions[3 * left + 0] = -halfWidth;
      positions[3 * left + 1] = y;
      positions[3 * left + 2] = 0;

      positions[3 * right + 0] = halfWidth;
      positions[3 * right + 1] = y;
      positions[3 * right + 2] = 0;

      uvs[2 * left + 0] = 0.0;
      uvs[2 * left + 1] = v;
      uvs[2 * right + 0] = 1.0;
      uvs[2 * right + 1] = v;

      if (row > 0) {
        const prevLeft = (row - 1) * 2;
        const prevRight = prevLeft + 1;

        indices[idx++] = prevLeft;
        indices[idx++] = prevRight;
        indices[idx++] = right;

        indices[idx++] = prevLeft;
        indices[idx++] = right;
        indices[idx++] = left;
      }
    }

    const tip = rowCount * 2;
    positions[3 * tip + 0] = 0;
    positions[3 * tip + 1] = height;
    positions[3 * tip + 2] = 0;
    uvs[2 * tip + 0] = 0.5;
    uvs[2 * tip + 1] = 1.0;

    const lastLeft = (rowCount - 1) * 2;
    const lastRight = lastLeft + 1;
    indices[idx++] = lastLeft;
    indices[idx++] = lastRight;
    indices[idx++] = tip;

    const geom = new THREE.BufferGeometry();

    const posAttribute = new THREE.BufferAttribute(positions, 3);
    posAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("position", posAttribute);

    const uvAttribute = new THREE.BufferAttribute(uvs, 2);
    uvAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("uv", uvAttribute);

    const indexAttribute = new THREE.BufferAttribute(indices, 1);
    indexAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setIndex(indexAttribute);

    return geom;
  }

  update(_deltaTime: number): void {
    if (!this.grassInitialized || !this.mesh || !this.ssbo || !this.renderer)
      return;

    const camera = this.world.camera;
    if (!camera) return;

    const playerPos = camera.position;

    // Update uniforms
    uniforms.uPlayerPosition.value.copy(playerPos);

    // Camera frustum data
    const proj = camera.projectionMatrix;
    uniforms.uCameraMatrix.value.copy(proj).multiply(camera.matrixWorldInverse);
    camera.getWorldDirection(uniforms.uCameraForward.value);

    // Move grass mesh to follow player (XZ only, Y at 0 since heightmap handles Y)
    this.mesh.position.set(playerPos.x, 0, playerPos.z);

    // Run compute shader
    this.renderer.computeAsync(this.ssbo.computeUpdate);
  }

  // Public API
  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.mesh?.visible ?? false;
  }

  static getConfig(): typeof config {
    return config;
  }

  stop(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh = null;
    this.ssbo = null;
    this.grassInitialized = false;
    this.noiseTexture?.dispose();
    noiseAtlasTexture = null;
    heightmapTexture = null;
  }
}
