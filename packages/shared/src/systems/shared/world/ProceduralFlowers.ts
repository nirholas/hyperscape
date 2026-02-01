/**
 * ProceduralFlowers.ts - GPU Flower System (Revo Realms Parity)
 *
 * Complete port from Revo Realms Flowers implementation.
 *
 * Architecture:
 * - SpriteNodeMaterial for billboard flowers
 * - SSBO with bit-packed position, height, and visibility data
 * - Shared VegetationSsboUtils for visibility, alpha, and Y offset
 * - WindManager integration for sway animation
 * - 16x update throttle (flowers are less dynamic than grass)
 *
 * @module ProceduralFlowers
 */

import THREE, {
  uniform,
  Fn,
  If,
  float,
  vec3,
  vec4,
  vec2,
  sin,
  cos,
  uv,
  floor,
  instanceIndex,
  hash,
  step,
  texture,
  instancedArray,
  mix,
  INFINITY,
  time,
} from "../../../extras/three/three";
import { SpriteNodeMaterial } from "three/webgpu";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { tslUtils } from "../../../utils/TSLUtils";
import { VegetationSsboUtils, getHeightmapMax } from "./VegetationSsboUtils";
import { windManager } from "./Wind";

// TSL types - use any for dynamic TSL function signatures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLFn = (...args: any[]) => any;

// ============================================================================
// CONFIGURATION - Matches Revo Realms
// ============================================================================

const getConfig = () => {
  const FLOWER_WIDTH = 0.5;
  const FLOWER_HEIGHT = 1;
  const TILE_SIZE = 150;
  const FLOWERS_PER_SIDE = 64;
  const MIN_SCALE = 0.125;
  const MAX_SCALE = 0.2;
  return {
    MIN_SCALE,
    MAX_SCALE,
    FLOWER_WIDTH,
    FLOWER_HEIGHT,
    FLOWER_BOUNDING_SPHERE_RADIUS: FLOWER_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    FLOWERS_PER_SIDE,
    COUNT: FLOWERS_PER_SIDE * FLOWERS_PER_SIDE,
    SPACING: TILE_SIZE / FLOWERS_PER_SIDE,
    WORKGROUP_SIZE: 64,
  };
};

const config = getConfig();

// ============================================================================
// UNIFORMS
// ============================================================================

const uniforms = {
  uPlayerDeltaXZ: uniform(new THREE.Vector2(0, 0)),
  uPlayerPosition: uniform(new THREE.Vector3(0, 0, 0)),
  uCameraForward: uniform(new THREE.Vector3(0, 0, 0)),
  // Culling
  uCameraMatrix: uniform(new THREE.Matrix4()),
  uFx: uniform(1.0),
  uFy: uniform(1.0),
  uCullPadNDCX: uniform(0.075),
  uCullPadNDCYNear: uniform(0.75),
  uCullPadNDCYFar: uniform(0.2),
  // Tint colors
  uColor1: uniform(new THREE.Color().setRGB(0.02, 0.14, 0.33)),
  uColor2: uniform(new THREE.Color().setRGB(0.99, 0.64, 0.0)),
  uColorStrength: uniform(0.275),
};

// Noise texture
let flowerNoiseTexture: THREE.Texture | null = null;
// Flower atlas texture (optional - uses procedural if not available)
let flowerAtlasTexture: THREE.Texture | null = null;

// ============================================================================
// FLOWER SSBO - Bit-packed data structure
// ============================================================================
// x -> offsetX
// y -> offsetZ
// z -> 0/12 offsetY - 12/1 visibility (11 unused)
// w -> noise packed (0/6 r, 6/6 g, 12/6 b, 18/6 a)

type InstancedArrayBuffer = ReturnType<typeof instancedArray>;

class FlowerSsbo {
  private buffer: InstancedArrayBuffer;

  constructor() {
    this.buffer = instancedArray(config.COUNT, "vec4");
    this.computeUpdate.onInit(({ renderer }) => {
      renderer.computeAsync(this.computeInit);
    });
  }

  get computeBuffer(): InstancedArrayBuffer {
    return this.buffer;
  }

  // ============================================================================
  // UNPACKING FUNCTIONS
  // ============================================================================

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  getYOffset: TSLFn = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnits(data.z, 0, 12, 0, Math.ceil(getHeightmapMax()));
  });

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  getVisibility: TSLFn = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackFlag(data.z, 12);
  });

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  getNoise: TSLFn = Fn(([data = vec4(0)]) => {
    const x = tslUtils.unpackUnit(data.w, 0, 6);
    const y = tslUtils.unpackUnit(data.w, 6, 6);
    const z = tslUtils.unpackUnit(data.w, 12, 6);
    const w = tslUtils.unpackUnit(data.w, 18, 6);
    return vec4(x, y, z, w);
  });

  // ============================================================================
  // PACKING FUNCTIONS
  // ============================================================================

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  private setYOffset: TSLFn = Fn(([data = vec4(0), value = float(0)]) => {
    data.z = tslUtils.packUnits(
      data.z,
      0,
      12,
      value,
      0,
      Math.ceil(getHeightmapMax()),
    );
    return data;
  });

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  private setVisibility: TSLFn = Fn(([data = vec4(0), value = float(0)]) => {
    data.z = tslUtils.packFlag(data.z, 12, value);
    return data;
  });

  // @ts-expect-error TSL Fn with array destructuring params - dynamic typing
  private setNoise: TSLFn = Fn(([data = vec4(0), value = vec4(0)]) => {
    data.w = tslUtils.packUnit(data.w, 0, 6, value.x);
    data.w = tslUtils.packUnit(data.w, 6, 6, value.y);
    data.w = tslUtils.packUnit(data.w, 12, 6, value.z);
    data.w = tslUtils.packUnit(data.w, 18, 6, value.a);
    return data;
  });

  // ============================================================================
  // COMPUTE INIT
  // ============================================================================

  computeInit = Fn(() => {
    const data = this.buffer.element(instanceIndex);

    // Position XZ in grid
    const row = floor(float(instanceIndex).div(config.FLOWERS_PER_SIDE));
    const col = float(instanceIndex).mod(config.FLOWERS_PER_SIDE);

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

    // UV for noise sampling
    const _uv = vec3(offsetX, 0, offsetZ)
      .xz.add(config.TILE_HALF_SIZE)
      .div(config.TILE_SIZE)
      .abs();

    // Sample noise for position variation
    // Use hash as fallback since it's always available
    const noiseR = flowerNoiseTexture
      ? texture(flowerNoiseTexture, _uv).r
      : hash(instanceIndex.mul(0.73));
    const noiseG = flowerNoiseTexture
      ? texture(flowerNoiseTexture, _uv).g
      : hash(instanceIndex.mul(1.27));
    const noiseB = flowerNoiseTexture
      ? texture(flowerNoiseTexture, _uv).b
      : hash(instanceIndex.mul(0.91));
    const noiseA = flowerNoiseTexture
      ? texture(flowerNoiseTexture, _uv).a
      : hash(instanceIndex.mul(1.53));

    const noiseVec = vec4(noiseR, noiseG, noiseB, noiseA);
    data.assign(this.setNoise(data, noiseVec));
    const wrapNoise = noiseR;

    const noiseX = wrapNoise.mul(99.37);
    const noiseZ = wrapNoise.mul(49.71);

    data.x = offsetX.add(noiseX);
    data.y = offsetZ.add(noiseZ);
  })().compute(config.COUNT, [config.WORKGROUP_SIZE]);

  // ============================================================================
  // COMPUTE UPDATE
  // ============================================================================

  computeUpdate = Fn(() => {
    const data = this.buffer.element(instanceIndex);

    // Position wrapping using shared utility
    const pos = VegetationSsboUtils.wrapPosition(
      vec2(data.x, data.y),
      uniforms.uPlayerDeltaXZ,
      config.TILE_SIZE,
    );

    data.x = pos.x;
    data.y = pos.z;

    const worldPos = pos.add(uniforms.uPlayerPosition);

    // Visibility check using shared utility
    const isVisible = VegetationSsboUtils.computeVisibility(
      worldPos,
      uniforms.uCameraMatrix,
      uniforms.uFx,
      uniforms.uFy,
      config.FLOWER_BOUNDING_SPHERE_RADIUS,
      uniforms.uCullPadNDCX,
      uniforms.uCullPadNDCYNear,
      uniforms.uCullPadNDCYFar,
    );

    data.assign(this.setVisibility(data, isVisible));

    If(isVisible, () => {
      // Y offset from heightmap using shared utility
      const yOffset = VegetationSsboUtils.computeYOffset(worldPos);
      data.assign(this.setYOffset(data, yOffset));

      // Alpha from grass map using shared utility
      const alphaVisibility = VegetationSsboUtils.computeAlpha(worldPos);
      data.assign(this.setVisibility(data, alphaVisibility));
    });
  })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
}

// ============================================================================
// FLOWER MATERIAL
// ============================================================================

class FlowerMaterial extends SpriteNodeMaterial {
  private ssbo: FlowerSsbo;

  constructor(ssbo: FlowerSsbo) {
    super();
    this.ssbo = ssbo;
    this.createFlowerMaterial();
  }

  private createFlowerMaterial(): void {
    this.precision = "lowp";
    this.stencilWrite = false;
    this.forceSinglePass = true;
    this.transparent = false;

    const data = this.ssbo.computeBuffer.element(instanceIndex);
    const isVisible = this.ssbo.getVisibility(data);
    const x = data.x;
    const y = this.ssbo.getYOffset(data);
    const z = data.y;

    const rand1 = hash(instanceIndex.add(9234));
    const rand2 = hash(instanceIndex.add(33.87));

    // Position with wind sway (use TSL time for proper animation)
    const windIntensity = windManager.uIntensity;
    const windDirection = windManager.uDirection;
    const timer = time.add(float(2).add(windIntensity.mul(0.25)));
    const swayX = sin(timer.add(rand1.mul(100))).mul(0.25);
    const swayY = rand2.mul(0.5);
    const swayZ = cos(timer.mul(2).add(rand2.mul(33.76))).mul(0.15);
    const swayOffset = vec3(swayX, swayY, swayZ);

    // INFINITY offset for invisible flowers
    const offscreenOffset = uniforms.uCameraForward
      .mul(INFINITY)
      .mul(float(1).sub(isVisible));

    const offsetX = x.add(windDirection.x.mul(windIntensity).mul(0.5));
    const baseHeight = rand1.add(rand2).add(0.25).clamp();
    const offsetY = y.add(baseHeight);
    const offsetZ = z.add(windDirection.y.mul(windIntensity).mul(0.5));
    const basePosition = vec3(offsetX, offsetY, offsetZ);
    this.positionNode = basePosition.add(swayOffset).add(offscreenOffset);

    // Size
    this.scaleNode = vec3(
      rand1.remap(0, 1, config.MIN_SCALE, config.MAX_SCALE),
    );

    // Diffuse color
    if (flowerAtlasTexture) {
      // Use flower atlas texture if available
      const flower = texture(flowerAtlasTexture, uv());
      const tint = mix(uniforms.uColor1, uniforms.uColor2, rand2);
      const sign = step(rand2, rand1).mul(2).sub(1);
      const color = mix(tint, flower.xyz, rand1.add(rand2.mul(sign)));
      this.colorNode = color.mul(uniforms.uColorStrength);
      this.opacityNode = isVisible.mul(flower.w);
      this.alphaTest = 0.15;
    } else {
      // Procedural flower colors
      const pink = vec3(1.0, 0.3, 0.5);
      const yellow = vec3(1.0, 0.8, 0.2);
      const purple = vec3(0.6, 0.3, 0.8);
      const orange = vec3(1.0, 0.5, 0.2);

      const colorIndex = floor(rand2.mul(4));
      const color1 = mix(pink, yellow, step(1, colorIndex));
      const color2 = mix(color1, purple, step(2, colorIndex));
      const finalColor = mix(color2, orange, step(3, colorIndex));

      // Petal pattern (circle)
      const uvCoord = uv();
      const distFromCenter = uvCoord.sub(0.5).length();
      const petalPattern = step(distFromCenter, 0.4);

      this.colorNode = finalColor
        .mul(petalPattern)
        .mul(uniforms.uColorStrength);
      this.opacityNode = isVisible.mul(petalPattern);
      this.alphaTest = 0.15;
    }
  }
}

// ============================================================================
// MAIN FLOWER SYSTEM
// ============================================================================

export class ProceduralFlowerSystem extends System {
  private mesh: THREE.InstancedMesh | null = null;
  private ssbo: FlowerSsbo | null = null;
  private material: FlowerMaterial | null = null;
  private renderer: THREE.WebGPURenderer | null = null;
  private flowersInitialized = false;
  private frameCount = 0;

  // Textures
  private noiseTexture: THREE.Texture | null = null;
  private atlasTexture: THREE.Texture | null = null;

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
      setTimeout(() => this.initializeFlowers(), 100);
      return;
    }

    await this.initializeFlowers();
  }

  private async loadTextures(): Promise<void> {
    const loader = new THREE.TextureLoader();

    // Load noise texture
    const noisePromise = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        "/textures/noise.png",
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          resolve(tex);
        },
        undefined,
        () => reject(new Error("Failed to load noise texture")),
      );
    }).catch(() => null);

    const noise = await noisePromise;
    if (noise) {
      this.noiseTexture = noise;
      flowerNoiseTexture = noise;
      console.log("[ProceduralFlowers] Loaded noise texture");
    }

    // Try to load flower atlas (optional)
    const atlasPromise = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        "/textures/edelweiss.png",
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          resolve(tex);
        },
        undefined,
        () => reject(new Error("Failed to load flower atlas")),
      );
    }).catch(() => null);

    const atlas = await atlasPromise;
    if (atlas) {
      this.atlasTexture = atlas;
      flowerAtlasTexture = atlas;
      console.log("[ProceduralFlowers] Loaded flower atlas texture");
    } else {
      console.log("[ProceduralFlowers] Using procedural flower colors");
    }
  }

  private async initializeFlowers(): Promise<void> {
    if (this.flowersInitialized) return;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeFlowers(), 100);
      return;
    }

    this.renderer ??=
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    if (!this.renderer) {
      console.warn("[ProceduralFlowers] No WebGPU renderer available");
      return;
    }

    // Load textures first
    await this.loadTextures();

    // Create SSBO
    this.ssbo = new FlowerSsbo();

    // Create material
    this.material = new FlowerMaterial(this.ssbo);

    // Create geometry (simple plane)
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Create instanced mesh
    this.mesh = new THREE.InstancedMesh(geometry, this.material, config.COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.name = "ProceduralFlowers_GPU";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    stage.scene.add(this.mesh);
    this.flowersInitialized = true;

    console.log(
      `[ProceduralFlowers] Initialized with ${config.COUNT.toLocaleString()} flowers`,
    );
  }

  update(_deltaTime: number): void {
    if (!this.flowersInitialized || !this.mesh || !this.ssbo || !this.renderer)
      return;

    // 16x throttle like Revo Realms (flowers are less dynamic)
    this.frameCount++;
    if (this.frameCount % 16 !== 0) return;

    const camera = this.world.camera;
    if (!camera) return;

    const playerPos = camera.position;

    // Calculate delta
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    uniforms.uPlayerDeltaXZ.value.set(dx, dz);
    uniforms.uPlayerPosition.value.copy(playerPos);

    // Camera frustum data
    const proj = camera.projectionMatrix;
    uniforms.uFx.value = proj.elements[0];
    uniforms.uFy.value = proj.elements[5];
    uniforms.uCameraMatrix.value.copy(proj).multiply(camera.matrixWorldInverse);
    camera.getWorldDirection(uniforms.uCameraForward.value);

    // Move mesh to follow player
    this.mesh.position.copy(playerPos).setY(0);

    // Run compute shader
    this.renderer.computeAsync(this.ssbo.computeUpdate);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }

  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.visible = visible;
    }
  }

  isVisible(): boolean {
    return this.mesh?.visible ?? false;
  }

  getActiveInstanceCount(): number {
    return config.COUNT;
  }

  static getConfig(): typeof config {
    return config;
  }

  // Color controls
  setColor1(color: THREE.Color): void {
    uniforms.uColor1.value.copy(color);
  }

  getColor1(): THREE.Color {
    return uniforms.uColor1.value.clone();
  }

  setColor2(color: THREE.Color): void {
    uniforms.uColor2.value.copy(color);
  }

  getColor2(): THREE.Color {
    return uniforms.uColor2.value.clone();
  }

  setColorStrength(value: number): void {
    uniforms.uColorStrength.value = value;
  }

  getColorStrength(): number {
    return uniforms.uColorStrength.value;
  }

  stop(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.ssbo = null;
    this.material = null;
    this.flowersInitialized = false;

    this.noiseTexture?.dispose();
    this.atlasTexture?.dispose();
    this.noiseTexture = null;
    this.atlasTexture = null;

    flowerNoiseTexture = null;
    flowerAtlasTexture = null;
  }
}
