/**
 * WaterSystem - AAA Lake Water Shader (WebGPU TSL)
 *
 * Features: Gerstner waves, GGX specular, Beer-Lambert absorption,
 * subsurface scattering, foam, multi-layer detail normals, planar reflections.
 */

import THREE, {
  MeshStandardNodeMaterial,
  texture,
  positionWorld,
  positionLocal,
  cameraPosition,
  uniform,
  float,
  vec2,
  vec3,
  sin,
  cos,
  pow,
  add,
  sub,
  mul,
  div,
  mix,
  dot,
  normalize,
  max,
  smoothstep,
  clamp,
  Fn,
  attribute,
  exp,
  length,
  reflector,
  type ShaderNode,
  type ShaderNodeInput,
} from "../../../extras/three/three";
import type { World } from "../../../types";
import type { TerrainTile } from "../../../types/world/terrain";
import type { Wind } from "./Wind";

// ============================================================================
// CONFIGURATION
// ============================================================================

const GRAVITY = 9.81;
const PI = Math.PI;
const TWO_PI = PI * 2;
const WATER_F0 = 0.02;
const WATER_ROUGHNESS = 0.02;

const ABSORPTION = { r: 0.45, g: 0.09, b: 0.06 };

// LOD configuration for water mesh resolution
const WATER_LOD = {
  HIGH_RESOLUTION: 64, // Close tiles (< 100m)
  MEDIUM_RESOLUTION: 32, // Medium distance (100-200m)
  LOW_RESOLUTION: 16, // Far tiles (> 200m)
  HIGH_DISTANCE: 100, // Distance threshold for high->medium LOD
  MEDIUM_DISTANCE: 200, // Distance threshold for medium->low LOD
};

type WaveParams = {
  w: number;
  phi: number;
  QADx: number;
  QADz: number;
  wADx: number;
  wADz: number;
  Dx: number;
  Dz: number;
  A: number;
};

// 5 Gerstner waves for realistic water motion (performance optimized)
const WAVES: WaveParams[] = [
  { A: 0.07, wavelength: 20, Q: 0.3, Dx: 0.7, Dz: 0.71 },
  { A: 0.05, wavelength: 14, Q: 0.25, Dx: -0.5, Dz: 0.87 },
  { A: 0.035, wavelength: 8, Q: 0.22, Dx: 0.9, Dz: -0.44 },
  { A: 0.025, wavelength: 5, Q: 0.2, Dx: 0.26, Dz: 0.97 },
  { A: 0.015, wavelength: 2.5, Q: 0.15, Dx: -0.8, Dz: 0.6 },
].map(({ A, wavelength, Q, Dx, Dz }) => {
  const w = TWO_PI / wavelength;
  const phi = Math.sqrt(GRAVITY * w);
  return {
    w,
    phi,
    QADx: Q * A * Dx,
    QADz: Q * A * Dz,
    wADx: w * A * Dx,
    wADz: w * A * Dz,
    Dx,
    Dz,
    A,
  };
});

// Reduced from 4 to 2 layers for better performance (2 texture samples instead of 4)
const NORMAL_LAYERS: [number, number, number][] = [
  [0.015, 0.005, 0.003],
  [0.04, -0.008, 0.005],
];
const NORMAL_WEIGHTS = [0.6, 0.4];

// ============================================================================
// TYPES
// ============================================================================

type UniformFloat = { value: number };
type UniformVec3 = { value: THREE.Vector3 };

export type WaterUniforms = {
  time: UniformFloat;
  sunDirection: UniformVec3;
  windStrength: UniformFloat;
  reflectionIntensity: UniformFloat;
};

// Reflector node type from TSL
type ReflectorNode = ReturnType<typeof reflector> & {
  target: THREE.Object3D;
  uvNode: ReturnType<typeof vec2>;
};

/**
 * Water body type - determines shader and visual characteristics
 * - lake: Inland water bodies with planar reflections (when enabled)
 * - ocean: Large boundary water bodies without reflections, deeper colors
 */
export type WaterBodyType = "lake" | "ocean";

// ============================================================================
// WATER SYSTEM
// ============================================================================

export class WaterSystem {
  private world: World;
  private waterTime = 0;
  private lakeMaterial?: MeshStandardNodeMaterial; // Lake/pond water with reflections
  private oceanMaterial?: MeshStandardNodeMaterial; // Ocean water without reflections
  private uniforms: WaterUniforms | null = null;
  private oceanUniforms: WaterUniforms | null = null;
  private normalTex1?: THREE.Texture;
  private normalTex2?: THREE.Texture;
  private foamTex?: THREE.Texture;

  // Planar reflection using TSL reflector
  private reflection?: ReflectorNode;
  private waterLevel = 5;
  private waterMeshes: THREE.Mesh[] = [];

  // Frustum culling for reflection optimization
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private tempSphere = new THREE.Sphere();

  // Reflection state tracking for DevStats
  private reflectionActive = false;

  // User preference for reflections (can be toggled)
  private _reflectionsEnabled = true;

  // Wind system reference for coordinated wind effects
  private windSystem: Wind | null = null;

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Get whether realtime water reflections are enabled
   */
  get reflectionsEnabled(): boolean {
    return this._reflectionsEnabled;
  }

  /**
   * Enable or disable realtime water reflections for lake/pond water
   * Ocean water never has reflections regardless of this setting
   */
  setReflectionsEnabled(enabled: boolean): void {
    this._reflectionsEnabled = enabled;

    // Update reflection intensity uniform - this actually disables reflections in the shader
    if (this.uniforms) {
      this.uniforms.reflectionIntensity.value = enabled ? 0.4 : 0.0;
    }

    // Update reflector visibility based on setting
    if (this.reflection?.target) {
      // When disabled, hide the reflector to save GPU resources
      if (!enabled) {
        this.reflection.target.visible = false;
        this.reflectionActive = false;
      }
      // When enabled, visibility will be controlled by frustum culling in update()
    }

    console.log(
      `[WaterSystem] Realtime water reflections ${enabled ? "enabled" : "disabled"}`,
    );
  }

  get waterUniforms(): WaterUniforms | null {
    return this.uniforms;
  }

  /**
   * Get the material for a specific water body type
   */
  getMaterial(type: WaterBodyType): MeshStandardNodeMaterial | undefined {
    return type === "ocean" ? this.oceanMaterial : this.lakeMaterial;
  }

  /**
   * Returns true if the reflection camera is currently rendering
   * (i.e., at least one water mesh is visible in the frustum)
   */
  get isReflectionActive(): boolean {
    return this.reflectionActive;
  }

  /**
   * Returns the count of active reflection cameras (0 or 1)
   */
  get activeReflectionCameraCount(): number {
    return this.reflectionActive ? 1 : 0;
  }

  /**
   * Returns the total number of water meshes being tracked
   */
  get waterMeshCount(): number {
    return this.waterMeshes.length;
  }

  /**
   * Returns the number of currently visible water meshes
   */
  get visibleWaterMeshCount(): number {
    let count = 0;
    for (const mesh of this.waterMeshes) {
      if (mesh.parent && mesh.visible) {
        count++;
      }
    }
    return count;
  }

  async init(): Promise<void> {
    if (this.world.isServer) return;

    // Create procedural textures with yielding (prevents main thread blocking)
    // These are CPU-intensive nested loops that can block for 50-100ms without yielding
    this.normalTex1 = await this.createNormalMap(256, 1.0, 42);
    this.normalTex2 = await this.createNormalMap(128, 2.0, 137);
    this.foamTex = await this.createFoamTexture(128);

    // Create TSL reflector for planar reflections (lake water only)
    // This handles all the reflection camera, render target, and UV calculation automatically
    this.reflection = reflector({ resolutionScale: 0.45 }) as ReflectorNode;
    // Rotate to face upward (water is horizontal plane)
    this.reflection.target.rotateX(-Math.PI / 2);
    this.reflection.target.name = "WaterReflector";

    // Create lake material with reflections AFTER reflector is set up
    this.lakeMaterial = this.createLakeMaterial();

    // Create ocean material without reflections (different visual style)
    this.oceanMaterial = this.createOceanMaterial();

    console.log(
      "[WaterSystem] Initialized with lake (reflective) and ocean (non-reflective) shaders",
    );
  }

  /**
   * Add reflector target to scene - must be called after init
   */
  addToScene(scene: THREE.Scene): void {
    if (this.reflection?.target) {
      scene.add(this.reflection.target);
      console.log(
        "[WaterSystem] Added reflector target to scene at y=",
        this.reflection.target.position.y,
      );
    }
  }

  // ==========================================================================
  // PROCEDURAL TEXTURES (Async with yielding to prevent main thread blocking)
  // ==========================================================================

  /**
   * Create a procedural normal map texture.
   * Processes rows in batches, yielding between batches to prevent main thread blocking.
   */
  private async createNormalMap(
    size: number,
    freq: number,
    seed: number,
  ): Promise<THREE.Texture> {
    const data = new Uint8Array(size * size * 4);
    const TAU = Math.PI * 2;
    const ROW_BATCH_SIZE = 32; // Process 32 rows per batch

    for (let yBatch = 0; yBatch < size; yBatch += ROW_BATCH_SIZE) {
      const yEnd = Math.min(yBatch + ROW_BATCH_SIZE, size);

      for (let y = yBatch; y < yEnd; y++) {
        for (let x = 0; x < size; x++) {
          const nx = x / size,
            ny = y / size;
          const cx = Math.cos(nx * TAU),
            sx = Math.sin(nx * TAU);
          const cy = Math.cos(ny * TAU),
            sy = Math.sin(ny * TAU);

          let dx = 0,
            dy = 0;
          for (let oct = 0; oct < 4; oct++) {
            const f = freq * (1 << oct);
            const amp = 0.4 / (1 << oct);
            const s = seed + oct * 100;
            const x4 = cx * f,
              y4 = sx * f,
              z4 = cy * f * 0.618,
              w4 = sy * f * 0.618;
            dx +=
              (Math.sin(x4 + s + Math.cos(z4 * 0.7 + s * 0.3)) * 0.3 +
                Math.cos(y4 + s * 0.5 + Math.sin(w4 * 1.3 + s * 0.7)) * 0.3 +
                Math.sin(z4 * 1.1 + x4 * 0.8 + s * 0.2) * 0.2 +
                Math.cos(w4 * 0.9 + y4 * 0.6 + s * 0.9) * 0.2) *
              amp;
            dy +=
              (Math.sin(x4 + s + 50 + Math.cos(z4 * 0.7 + s * 0.3 + 50)) * 0.3 +
                Math.cos(
                  y4 + s * 0.5 + 50 + Math.sin(w4 * 1.3 + s * 0.7 + 50),
                ) *
                  0.3 +
                Math.sin(z4 * 1.1 + x4 * 0.8 + s * 0.2 + 50) * 0.2 +
                Math.cos(w4 * 0.9 + y4 * 0.6 + s * 0.9 + 50) * 0.2) *
              amp;
          }

          const idx = (y * size + x) * 4;
          data[idx] = Math.floor(Math.max(0, Math.min(255, 128 + dx * 80)));
          data[idx + 1] = Math.floor(Math.max(0, Math.min(255, 128 + dy * 80)));
          data[idx + 2] = 220;
          data[idx + 3] = 255;
        }
      }

      // Yield to main thread between batches
      if (yEnd < size) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Create a procedural foam texture.
   * Processes rows in batches, yielding between batches to prevent main thread blocking.
   */
  private async createFoamTexture(size: number): Promise<THREE.Texture> {
    const data = new Uint8Array(size * size * 4);
    const ROW_BATCH_SIZE = 16; // Process 16 rows per batch (foam has more computation per pixel)

    // Pre-generate cells (small operation, no yield needed)
    const cells: { x: number; y: number }[] = [];
    let s = 12345;
    for (let i = 0; i < 32; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const cx = (s % 1000) / 1000;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      cells.push({ x: cx, y: (s % 1000) / 1000 });
    }

    for (let yBatch = 0; yBatch < size; yBatch += ROW_BATCH_SIZE) {
      const yEnd = Math.min(yBatch + ROW_BATCH_SIZE, size);

      for (let y = yBatch; y < yEnd; y++) {
        for (let x = 0; x < size; x++) {
          const px = x / size,
            py = y / size;
          let d1 = 999,
            d2 = 999;

          for (const c of cells) {
            let dx = Math.abs(px - c.x),
              dy = Math.abs(py - c.y);
            if (dx > 0.5) dx = 1 - dx;
            if (dy > 0.5) dy = 1 - dy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) d2 = d;
          }

          const edge = d2 - d1;
          const foam = Math.pow(Math.max(0, 1 - edge * 8), 2);
          const noise =
            0.7 +
            (Math.sin(px * 47 + py * 31) * 0.5 +
              Math.sin(px * 97 + py * 67) * 0.25 +
              Math.sin(px * 157 + py * 113) * 0.25) *
              0.3;
          const v = Math.floor(Math.max(0, Math.min(255, foam * noise * 255)));

          const idx = (y * size + x) * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = v;
        }
      }

      // Yield to main thread between batches
      if (yEnd < size) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  // ==========================================================================
  // SHADER MATERIALS
  // ==========================================================================

  /**
   * Create lake/pond water material with planar reflections
   */
  private createLakeMaterial(): MeshStandardNodeMaterial {
    const uTime = uniform(float(0));
    const uSunDir = uniform(vec3(0.4, 0.8, 0.4));
    const uWind = uniform(float(1.0));
    // Reflection intensity uniform - allows disabling reflections via settings
    // Default 0.4 matches the hardcoded value we had before
    const uReflectionIntensity = uniform(
      float(this._reflectionsEnabled ? 0.4 : 0.0),
    );

    this.uniforms = {
      time: uTime,
      sunDirection: uSunDir as unknown as UniformVec3,
      windStrength: uWind,
      reflectionIntensity: uReflectionIntensity,
    };

    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.roughness = WATER_ROUGHNESS;
    material.metalness = 0.0;
    material.fog = false; // Water should not be affected by scene fog
    // Disable environment map completely - use planar reflection only
    // NOTE: Don't set envMap = null - it causes WebGPU texture cache corruption
    // Setting envMapIntensity to 0 is sufficient to disable the environment map effect
    material.envMapIntensity = 0;

    const normalTex1 = this.normalTex1!;
    const normalTex2 = this.normalTex2!;
    const foamTex = this.foamTex!;

    // Get the TSL reflector - use directly like in the example
    const reflectionNode = this.reflection!;

    // Add normal-based UV distortion to reflection for ripple effect
    // Like in the example: reflection.uvNode = reflection.uvNode.add( floorNormalOffset );
    const worldUV = vec2(positionWorld.x, positionWorld.z);
    const normalOffset = texture(normalTex1, mul(worldUV, float(0.02))).xy;
    const normalDistortion = sub(mul(normalOffset, float(2)), float(1));
    (reflectionNode as { uvNode: ShaderNode }).uvNode = add(
      reflectionNode.uvNode,
      mul(normalDistortion, float(0.015)),
    );

    const wavePhase = (
      wp: ShaderNodeInput,
      t: ShaderNodeInput,
      w: ShaderNodeInput,
      wave: WaveParams,
    ) => {
      // Cast to ShaderNode for swizzle access
      const wpNode = wp as ShaderNode;
      const dotDP = add(
        mul(wpNode.x, float(wave.Dx)),
        mul(wpNode.z, float(wave.Dz)),
      );
      return add(mul(float(wave.w), dotDP), mul(mul(float(wave.phi), t), w));
    };

    // ========================================================================
    // VERTEX: Gerstner Displacement
    // ========================================================================
    material.positionNode = Fn(() => {
      const pos = positionLocal.xyz;
      const wp = positionWorld;
      const shoreMask = smoothstep(
        float(0),
        float(6),
        attribute("shoreDistance", "float"),
      );

      let dx: ShaderNode = float(0),
        dy: ShaderNode = float(0),
        dz: ShaderNode = float(0);
      for (const wave of WAVES) {
        const phase = wavePhase(wp, uTime, uWind, wave);
        const c = cos(phase),
          s = sin(phase);
        dx = add(dx, mul(float(wave.QADx), c));
        dy = add(dy, mul(float(wave.A), s));
        dz = add(dz, mul(float(wave.QADz), c));
      }

      return vec3(
        add(pos.x, mul(dx, shoreMask)),
        add(pos.y, mul(dy, shoreMask)),
        add(pos.z, mul(dz, shoreMask)),
      );
    })();

    // ========================================================================
    // FRAGMENT: Use reflection in emissiveNode like the example
    // ========================================================================

    // Base water color node
    const waterColorNode = Fn(() => {
      const wp = positionWorld;
      const shoreDist = attribute("shoreDistance", "float");
      const shoreMask = smoothstep(float(0), float(6), shoreDist);
      const wUV = vec2(wp.x, wp.z);

      // Wave normals for specular
      let nx: ShaderNode = float(0),
        nz: ShaderNode = float(0);
      for (const wave of WAVES) {
        const c = cos(wavePhase(wp, uTime, uWind, wave));
        nx = add(nx, mul(float(wave.wADx), c));
        nz = add(nz, mul(float(wave.wADz), c));
      }
      nx = mul(nx, shoreMask);
      nz = mul(nz, shoreMask);

      // Detail normals (2 layers for performance)
      let detailX: ShaderNode = float(0),
        detailZ: ShaderNode = float(0);
      const textures = [normalTex1, normalTex2];
      for (let i = 0; i < NORMAL_LAYERS.length; i++) {
        const [scale, sx, sy] = NORMAL_LAYERS[i];
        const uv = mul(
          vec2(
            add(wUV.x, mul(uTime, float(sx))),
            add(wUV.y, mul(uTime, float(sy))),
          ),
          float(scale),
        );
        const n = sub(mul(texture(textures[i], uv).rgb, float(2)), float(1));
        detailX = add(detailX, mul(n.x, float(NORMAL_WEIGHTS[i])));
        detailZ = add(detailZ, mul(n.z, float(NORMAL_WEIGHTS[i])));
      }

      const N = normalize(
        vec3(
          mul(add(nx, mul(detailX, float(0.5))), float(-1)),
          float(1),
          mul(add(nz, mul(detailZ, float(0.5))), float(-1)),
        ),
      );

      // View vectors
      const V = normalize(sub(cameraPosition, wp));
      const L = normalize(uSunDir);
      const H = normalize(add(V, L));
      const NdotV = max(dot(N, V), float(0.001));
      const NdotL = max(dot(N, L), float(0));
      const NdotH = max(dot(N, H), float(0));
      const VdotH = max(dot(V, H), float(0));

      // Beer-Lambert absorption for water depth color
      const depth = clamp(shoreDist, float(0), float(30));
      const shallowColor = vec3(0.15, 0.42, 0.48);
      const deepColor = vec3(0.02, 0.08, 0.12);
      const waterColor = vec3(
        mix(deepColor.x, shallowColor.x, exp(mul(float(-ABSORPTION.r), depth))),
        mix(deepColor.y, shallowColor.y, exp(mul(float(-ABSORPTION.g), depth))),
        mix(deepColor.z, shallowColor.z, exp(mul(float(-ABSORPTION.b), depth))),
      );

      // Subsurface scattering approximation
      const sssView = pow(
        clamp(dot(V, mul(L, float(-1))), float(0), float(1)),
        float(3),
      );
      const sssIntensity = mul(
        mul(sssView, smoothstep(float(8), float(0.5), shoreDist)),
        float(0.35),
      );

      // GGX specular
      const alpha = WATER_ROUGHNESS * WATER_ROUGHNESS;
      const alpha2 = alpha * alpha;
      const NdotH2 = mul(NdotH, NdotH);
      const denom = add(mul(NdotH2, float(alpha2 - 1)), float(1));
      const D_GGX = div(float(alpha2), mul(float(PI), mul(denom, denom)));
      const k = (WATER_ROUGHNESS + 1) / 8;
      const G1_V = div(NdotV, add(mul(NdotV, float(1 - k)), float(k)));
      const G1_L = div(NdotL, add(mul(NdotL, float(1 - k)), float(k)));
      const F_spec = add(
        float(WATER_F0),
        mul(float(1 - WATER_F0), pow(sub(float(1), VdotH), float(5))),
      );
      const specular = div(
        mul(mul(D_GGX, mul(G1_V, G1_L)), F_spec),
        max(mul(mul(float(4), NdotV), NdotL), float(0.001)),
      );

      const sunColor = vec3(1.0, 0.98, 0.92);
      const sunSpec = mul(sunColor, mul(mul(specular, float(2.5)), NdotL));

      // Foam (simplified - single texture sample for performance)
      const shoreFoam = smoothstep(float(2.5), float(0), shoreDist);
      const crestFoam = smoothstep(
        float(0.15),
        float(0.4),
        mul(length(vec2(nx, nz)), shoreMask),
      );
      const foamUV = mul(
        vec2(
          add(wUV.x, mul(uTime, float(0.02))),
          add(wUV.y, mul(uTime, float(0.015))),
        ),
        float(0.1),
      );
      const foamPattern = texture(foamTex, foamUV).r;
      const foamIntensity = mul(
        max(shoreFoam, mul(crestFoam, float(0.6))),
        foamPattern,
      );

      // Composite base color (without reflection - that goes to emissive)
      let color: ShaderNode = waterColor;
      color = add(color, sunSpec);
      color = add(color, mul(vec3(0.1, 0.35, 0.3), sssIntensity));
      color = mix(
        color,
        vec3(0.92, 0.94, 0.96),
        clamp(foamIntensity, float(0), float(0.85)),
      );

      return color;
    })();

    material.colorNode = waterColorNode;

    // Use reflection in emissiveNode like the Three.js example
    // The reflection is added as emissive contribution, weighted by fresnel
    // Reduced intensity to allow seeing through the water
    const fresnelNode = Fn(() => {
      const V = normalize(sub(cameraPosition, positionWorld));
      const NdotV = max(dot(vec3(0, 1, 0), V), float(0.001));
      return add(
        float(WATER_F0),
        mul(float(1 - WATER_F0), pow(sub(float(1), NdotV), float(5))),
      );
    })();

    // Reflection goes to emissive, scaled by fresnel and reflection intensity uniform
    // When reflectionIntensity is 0, no reflections are rendered (saves GPU)
    material.emissiveNode = mul(
      reflectionNode,
      mul(fresnelNode, uReflectionIntensity),
    );

    // ========================================================================
    // OPACITY
    // ========================================================================
    material.opacityNode = Fn(() => {
      const shoreDist = attribute("shoreDistance", "float");
      const V = normalize(sub(cameraPosition, positionWorld));

      // Edge fade for shoreline transparency
      const edgeFade = smoothstep(float(0), float(0.4), shoreDist);
      // Depth fade - more transparent overall to see bottom
      const depthFade = smoothstep(float(0.4), float(6.0), shoreDist);
      const depthOpacity = mix(float(0.2), float(0.7), depthFade); // Reduced max from 0.9 to 0.7
      // Fresnel - more opaque at glancing angles
      const NdotV = max(dot(vec3(0, 1, 0), V), float(0));
      const fresnelOpacity = mix(
        float(0.85),
        float(1.0),
        pow(sub(float(1), NdotV), float(3)),
      );

      return mul(mul(edgeFade, depthOpacity), fresnelOpacity);
    })();

    // ========================================================================
    // NORMAL MAP
    // ========================================================================
    material.normalNode = Fn(() => {
      const wp = positionWorld;
      const wUV = vec2(wp.x, wp.z);
      const uv1 = mul(
        vec2(
          add(wUV.x, mul(uTime, float(0.005))),
          add(wUV.y, mul(uTime, float(0.003))),
        ),
        float(0.02),
      );
      const uv2 = mul(
        vec2(
          sub(wUV.x, mul(uTime, float(0.004))),
          add(wUV.y, mul(uTime, float(0.006))),
        ),
        float(0.035),
      );
      const n1 = sub(mul(texture(normalTex1, uv1).rgb, float(2)), float(1));
      const n2 = sub(mul(texture(normalTex2, uv2).rgb, float(2)), float(1));
      const blended = normalize(add(n1, n2));
      return normalize(
        vec3(mul(blended.x, float(0.4)), float(1), mul(blended.z, float(0.4))),
      );
    })();

    return material;
  }

  /**
   * Create ocean water material - no reflections, deeper colors, larger waves
   * Ocean water is meant for world boundary/edge areas
   */
  private createOceanMaterial(): MeshStandardNodeMaterial {
    const uTime = uniform(float(0));
    const uSunDir = uniform(vec3(0.4, 0.8, 0.4));
    const uWind = uniform(float(1.2)); // Slightly windier for ocean
    // Ocean never has reflections, but we include the uniform for type consistency
    const uReflectionIntensity = uniform(float(0));

    this.oceanUniforms = {
      time: uTime,
      sunDirection: uSunDir as unknown as UniformVec3,
      windStrength: uWind,
      reflectionIntensity: uReflectionIntensity, // Always 0 for ocean
    };

    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.roughness = WATER_ROUGHNESS;
    material.metalness = 0.0;
    material.fog = false;
    material.envMapIntensity = 0;

    const normalTex1 = this.normalTex1!;
    const normalTex2 = this.normalTex2!;
    const foamTex = this.foamTex!;

    const wavePhase = (
      wp: ShaderNodeInput,
      t: ShaderNodeInput,
      w: ShaderNodeInput,
      wave: WaveParams,
    ) => {
      const wpNode = wp as ShaderNode;
      const dotDP = add(
        mul(wpNode.x, float(wave.Dx)),
        mul(wpNode.z, float(wave.Dz)),
      );
      return add(mul(float(wave.w), dotDP), mul(mul(float(wave.phi), t), w));
    };

    // ========================================================================
    // VERTEX: Gerstner Displacement (larger waves for ocean)
    // ========================================================================
    material.positionNode = Fn(() => {
      const pos = positionLocal.xyz;
      const wp = positionWorld;
      const shoreMask = smoothstep(
        float(0),
        float(6),
        attribute("shoreDistance", "float"),
      );

      let dx: ShaderNode = float(0),
        dy: ShaderNode = float(0),
        dz: ShaderNode = float(0);
      for (const wave of WAVES) {
        const phase = wavePhase(wp, uTime, uWind, wave);
        const c = cos(phase),
          s = sin(phase);
        // Larger wave amplitude for ocean (1.3x)
        dx = add(dx, mul(float(wave.QADx * 1.3), c));
        dy = add(dy, mul(float(wave.A * 1.3), s));
        dz = add(dz, mul(float(wave.QADz * 1.3), c));
      }

      return vec3(
        add(pos.x, mul(dx, shoreMask)),
        add(pos.y, mul(dy, shoreMask)),
        add(pos.z, mul(dz, shoreMask)),
      );
    })();

    // ========================================================================
    // FRAGMENT: Ocean color (deeper, bluer, no reflection)
    // ========================================================================
    const oceanColorNode = Fn(() => {
      const wp = positionWorld;
      const shoreDist = attribute("shoreDistance", "float");
      const shoreMask = smoothstep(float(0), float(6), shoreDist);
      const wUV = vec2(wp.x, wp.z);

      // Wave normals for specular
      let nx: ShaderNode = float(0),
        nz: ShaderNode = float(0);
      for (const wave of WAVES) {
        const c = cos(wavePhase(wp, uTime, uWind, wave));
        nx = add(nx, mul(float(wave.wADx), c));
        nz = add(nz, mul(float(wave.wADz), c));
      }
      nx = mul(nx, shoreMask);
      nz = mul(nz, shoreMask);

      // Detail normals
      let detailX: ShaderNode = float(0),
        detailZ: ShaderNode = float(0);
      const textures = [normalTex1, normalTex2];
      for (let i = 0; i < NORMAL_LAYERS.length; i++) {
        const [scale, sx, sy] = NORMAL_LAYERS[i];
        const uv = mul(
          vec2(
            add(wUV.x, mul(uTime, float(sx))),
            add(wUV.y, mul(uTime, float(sy))),
          ),
          float(scale),
        );
        const n = sub(mul(texture(textures[i], uv).rgb, float(2)), float(1));
        detailX = add(detailX, mul(n.x, float(NORMAL_WEIGHTS[i])));
        detailZ = add(detailZ, mul(n.z, float(NORMAL_WEIGHTS[i])));
      }

      const N = normalize(
        vec3(
          mul(add(nx, mul(detailX, float(0.5))), float(-1)),
          float(1),
          mul(add(nz, mul(detailZ, float(0.5))), float(-1)),
        ),
      );

      // View vectors
      const V = normalize(sub(cameraPosition, wp));
      const L = normalize(uSunDir);
      const H = normalize(add(V, L));
      const NdotV = max(dot(N, V), float(0.001));
      const NdotL = max(dot(N, L), float(0));
      const NdotH = max(dot(N, H), float(0));
      const VdotH = max(dot(V, H), float(0));

      // Ocean colors - deeper and bluer than lake water
      const depth = clamp(shoreDist, float(0), float(50)); // Extended depth for ocean
      const shallowColor = vec3(0.08, 0.32, 0.45); // More blue-green
      const deepColor = vec3(0.01, 0.04, 0.08); // Very deep blue
      const oceanColor = vec3(
        mix(
          deepColor.x,
          shallowColor.x,
          exp(mul(float(-ABSORPTION.r * 0.7), depth)),
        ),
        mix(
          deepColor.y,
          shallowColor.y,
          exp(mul(float(-ABSORPTION.g * 0.7), depth)),
        ),
        mix(
          deepColor.z,
          shallowColor.z,
          exp(mul(float(-ABSORPTION.b * 0.7), depth)),
        ),
      );

      // Subsurface scattering
      const sssView = pow(
        clamp(dot(V, mul(L, float(-1))), float(0), float(1)),
        float(3),
      );
      const sssIntensity = mul(
        mul(sssView, smoothstep(float(8), float(0.5), shoreDist)),
        float(0.25), // Less SSS for ocean
      );

      // GGX specular
      const alpha = WATER_ROUGHNESS * WATER_ROUGHNESS;
      const alpha2 = alpha * alpha;
      const NdotH2 = mul(NdotH, NdotH);
      const denom = add(mul(NdotH2, float(alpha2 - 1)), float(1));
      const D_GGX = div(float(alpha2), mul(float(PI), mul(denom, denom)));
      const k = (WATER_ROUGHNESS + 1) / 8;
      const G1_V = div(NdotV, add(mul(NdotV, float(1 - k)), float(k)));
      const G1_L = div(NdotL, add(mul(NdotL, float(1 - k)), float(k)));
      const F_spec = add(
        float(WATER_F0),
        mul(float(1 - WATER_F0), pow(sub(float(1), VdotH), float(5))),
      );
      const specular = div(
        mul(mul(D_GGX, mul(G1_V, G1_L)), F_spec),
        max(mul(mul(float(4), NdotV), NdotL), float(0.001)),
      );

      const sunColor = vec3(1.0, 0.98, 0.92);
      const sunSpec = mul(sunColor, mul(mul(specular, float(2.0)), NdotL));

      // Ocean foam (more whitecaps)
      const crestFoam = smoothstep(
        float(0.12),
        float(0.35),
        mul(length(vec2(nx, nz)), shoreMask),
      );
      const foamUV = mul(
        vec2(
          add(wUV.x, mul(uTime, float(0.025))),
          add(wUV.y, mul(uTime, float(0.02))),
        ),
        float(0.08),
      );
      const foamPattern = texture(foamTex, foamUV).r;
      const foamIntensity = mul(crestFoam, foamPattern);

      // Composite color - no reflection for ocean
      let color: ShaderNode = oceanColor;
      color = add(color, sunSpec);
      color = add(color, mul(vec3(0.05, 0.25, 0.3), sssIntensity));
      color = mix(
        color,
        vec3(0.9, 0.92, 0.95),
        clamp(foamIntensity, float(0), float(0.75)),
      );

      // Add sky reflection approximation (simple fresnel-based)
      const skyColor = vec3(0.5, 0.6, 0.75);
      const fresnelSky = pow(sub(float(1), NdotV), float(4));
      color = add(color, mul(skyColor, mul(fresnelSky, float(0.15))));

      return color;
    })();

    material.colorNode = oceanColorNode;

    // No emissive reflection for ocean - just use the base color

    // ========================================================================
    // OPACITY
    // ========================================================================
    material.opacityNode = Fn(() => {
      const shoreDist = attribute("shoreDistance", "float");
      const V = normalize(sub(cameraPosition, positionWorld));

      const edgeFade = smoothstep(float(0), float(0.4), shoreDist);
      const depthFade = smoothstep(float(0.4), float(8.0), shoreDist); // Deeper fade for ocean
      const depthOpacity = mix(float(0.3), float(0.85), depthFade); // More opaque overall
      const NdotV = max(dot(vec3(0, 1, 0), V), float(0));
      const fresnelOpacity = mix(
        float(0.9),
        float(1.0),
        pow(sub(float(1), NdotV), float(3)),
      );

      return mul(mul(edgeFade, depthOpacity), fresnelOpacity);
    })();

    // ========================================================================
    // NORMAL MAP
    // ========================================================================
    material.normalNode = Fn(() => {
      const wp = positionWorld;
      const wUV = vec2(wp.x, wp.z);
      const uv1 = mul(
        vec2(
          add(wUV.x, mul(uTime, float(0.006))),
          add(wUV.y, mul(uTime, float(0.004))),
        ),
        float(0.018),
      );
      const uv2 = mul(
        vec2(
          sub(wUV.x, mul(uTime, float(0.005))),
          add(wUV.y, mul(uTime, float(0.007))),
        ),
        float(0.03),
      );
      const n1 = sub(mul(texture(normalTex1, uv1).rgb, float(2)), float(1));
      const n2 = sub(mul(texture(normalTex2, uv2).rgb, float(2)), float(1));
      const blended = normalize(add(n1, n2));
      return normalize(
        vec3(
          mul(blended.x, float(0.35)),
          float(1),
          mul(blended.z, float(0.35)),
        ),
      );
    })();

    return material;
  }

  // ==========================================================================
  // MESH GENERATION
  // ==========================================================================

  /**
   * Generate a water mesh for a terrain tile
   * @param tile The terrain tile
   * @param waterThreshold Water level threshold
   * @param tileSize Size of the tile
   * @param getHeightAt Optional height function for accurate shoreline detection
   * @param waterType Type of water body - "lake" for reflective water, "ocean" for non-reflective
   */
  generateWaterMesh(
    tile: TerrainTile,
    waterThreshold: number,
    tileSize: number,
    getHeightAt?: (worldX: number, worldZ: number) => number,
    waterType: WaterBodyType = "lake",
  ): THREE.Mesh | null {
    this.waterLevel = waterThreshold;

    // Position the reflector at water level (only needed for lake water)
    if (waterType === "lake" && this.reflection?.target) {
      this.reflection.target.position.y = waterThreshold;
    }

    if (!getHeightAt) {
      const mesh = this.createFallbackMesh(
        tile,
        waterThreshold,
        tileSize,
        waterType,
      );
      this.waterMeshes.push(mesh);
      return mesh;
    }

    // Calculate LOD based on tile distance from camera
    const originX = tile.x * tileSize;
    const originZ = tile.z * tileSize;
    const tileCenterX = originX;
    const tileCenterZ = originZ;

    // Get camera position for LOD calculation
    let resolution = WATER_LOD.HIGH_RESOLUTION;
    const camera = this.world.camera;
    if (camera) {
      const cameraPos = camera.position;
      const dx = tileCenterX - cameraPos.x;
      const dz = tileCenterZ - cameraPos.z;
      const distToCamera = Math.sqrt(dx * dx + dz * dz);

      if (distToCamera > WATER_LOD.MEDIUM_DISTANCE) {
        resolution = WATER_LOD.LOW_RESOLUTION;
      } else if (distToCamera > WATER_LOD.HIGH_DISTANCE) {
        resolution = WATER_LOD.MEDIUM_RESOLUTION;
      }
    }

    const heights: number[][] = [];
    const underwater: boolean[][] = [];
    for (let i = 0; i <= resolution; i++) {
      heights[i] = [];
      underwater[i] = [];
      for (let j = 0; j <= resolution; j++) {
        const wx = originX + (i / resolution - 0.5) * tileSize;
        const wz = originZ + (j / resolution - 0.5) * tileSize;
        heights[i][j] = getHeightAt(wx, wz);
        underwater[i][j] = heights[i][j] < waterThreshold;
      }
    }

    // Shore distance calculation (OPTIMIZED: reduced iterations, early termination)
    // Original: ~2M iterations for high-res tiles
    // Optimized: ~200K iterations (4 directions, larger step, fewer refinements)
    const shoreDist: number[][] = [];
    const searchRadius = 30;
    const numDirs = 4; // Reduced from 8 to 4 (cardinal directions only)
    const initialStep = 2.0; // Larger initial step (was 0.5)
    const binarySearchIters = 3; // Reduced from 6

    // Pre-compute direction vectors
    const dirVecs: Array<{ dx: number; dz: number }> = [
      { dx: 1, dz: 0 }, // East
      { dx: 0, dz: 1 }, // South
      { dx: -1, dz: 0 }, // West
      { dx: 0, dz: -1 }, // North
    ];

    for (let i = 0; i <= resolution; i++) {
      shoreDist[i] = [];
      for (let j = 0; j <= resolution; j++) {
        if (!underwater[i][j]) {
          shoreDist[i][j] = 0;
          continue;
        }

        const wx = originX + (i / resolution - 0.5) * tileSize;
        const wz = originZ + (j / resolution - 0.5) * tileSize;
        let minDist = searchRadius;

        for (let d = 0; d < numDirs; d++) {
          const { dx, dz } = dirVecs[d];
          let lo = 0;
          let hi = searchRadius;
          let found = false;

          // Coarse search with larger steps
          for (
            let dist = initialStep;
            dist <= searchRadius;
            dist += initialStep
          ) {
            if (getHeightAt(wx + dx * dist, wz + dz * dist) >= waterThreshold) {
              hi = dist;
              lo = dist - initialStep;
              found = true;
              break;
            }
          }

          if (found) {
            // Reduced binary search refinement
            for (let iter = 0; iter < binarySearchIters; iter++) {
              const mid = (lo + hi) / 2;
              if (getHeightAt(wx + dx * mid, wz + dz * mid) >= waterThreshold) {
                hi = mid;
              } else {
                lo = mid;
              }
            }
            minDist = Math.min(minDist, hi);
            // Early termination: if we found shore very close, stop searching
            if (minDist < 2) break;
          }
        }
        shoreDist[i][j] = minDist;
      }
    }

    const verts: number[] = [];
    const uvs: number[] = [];
    const shores: number[] = [];
    const indices: number[] = [];
    const vertMap = new Map<string, number>();
    let idx = 0;

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const h = [
          heights[i][j],
          heights[i + 1][j],
          heights[i][j + 1],
          heights[i + 1][j + 1],
        ];
        if (!h.some((v) => v < waterThreshold)) continue;

        const corners = [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ];
        const quad: number[] = [];

        for (const [ci, cj] of corners) {
          const key = `${ci},${cj}`;
          if (!vertMap.has(key)) {
            verts.push(
              (ci / resolution - 0.5) * tileSize,
              0,
              (cj / resolution - 0.5) * tileSize,
            );
            uvs.push(ci / resolution, cj / resolution);
            shores.push(shoreDist[ci][cj]);
            vertMap.set(key, idx++);
          }
          quad.push(vertMap.get(key)!);
        }
        indices.push(quad[0], quad[2], quad[1], quad[1], quad[2], quad[3]);
      }
    }

    if (verts.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute(
      "shoreDistance",
      new THREE.Float32BufferAttribute(shores, 1),
    );
    geom.setIndex(indices);

    const normals = new Float32Array(verts.length);
    for (let i = 0; i < normals.length; i += 3) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));

    const mesh = this.createMesh(geom, tile, waterThreshold, waterType);
    this.waterMeshes.push(mesh);
    return mesh;
  }

  private createFallbackMesh(
    tile: TerrainTile,
    waterThreshold: number,
    tileSize: number,
    waterType: WaterBodyType = "lake",
  ): THREE.Mesh {
    // Calculate LOD resolution based on tile distance from camera
    let resolution = 32;
    const camera = this.world.camera;
    if (camera) {
      const tileCenterX = tile.x * tileSize;
      const tileCenterZ = tile.z * tileSize;
      const dx = tileCenterX - camera.position.x;
      const dz = tileCenterZ - camera.position.z;
      const distToCamera = Math.sqrt(dx * dx + dz * dz);

      if (distToCamera > WATER_LOD.MEDIUM_DISTANCE) {
        resolution = 8; // Very low poly at distance
      } else if (distToCamera > WATER_LOD.HIGH_DISTANCE) {
        resolution = 16;
      }
    }

    const geom = new THREE.PlaneGeometry(
      tileSize,
      tileSize,
      resolution,
      resolution,
    );
    geom.rotateX(-Math.PI / 2);

    const count = geom.attributes.position.count;
    const shores = new Float32Array(count).fill(50);
    geom.setAttribute("shoreDistance", new THREE.BufferAttribute(shores, 1));

    const normals = new Float32Array(count * 3);
    for (let i = 0; i < normals.length; i += 3) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
    geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    return this.createMesh(geom, tile, waterThreshold, waterType);
  }

  private createMesh(
    geom: THREE.BufferGeometry,
    tile: TerrainTile,
    waterThreshold: number,
    waterType: WaterBodyType = "lake",
  ): THREE.Mesh {
    // Select material based on water type
    const material =
      waterType === "ocean" ? this.oceanMaterial : this.lakeMaterial;
    if (!material) {
      throw new Error(
        `[WaterSystem] createMesh called before init() completed (${waterType} material missing)`,
      );
    }

    const mesh = new THREE.Mesh(geom, material);
    mesh.position.y = waterThreshold;
    mesh.name = `Water_${waterType}_${tile.key}`;
    mesh.renderOrder = 100;
    mesh.userData = {
      type: "water",
      waterType: waterType,
      walkable: false,
      clickable: false,
    };

    // PERFORMANCE: Put water on layer 1 (main camera only, not minimap)
    // This prevents expensive water shader from rendering in minimap
    mesh.layers.set(1);

    return mesh;
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  update(deltaTime: number): void {
    const dt =
      typeof deltaTime === "number" && isFinite(deltaTime) ? deltaTime : 1 / 60;
    this.waterTime += dt;

    // Get wind system reference lazily (it's registered before water)
    if (!this.windSystem) {
      this.windSystem =
        (this.world.getSystem("wind") as Wind | undefined) ?? null;
    }

    const sunAngle = this.waterTime * 0.005;
    const sunX = Math.cos(sunAngle) * 0.4;
    const sunY = 0.75 + Math.sin(sunAngle * 0.3) * 0.1;
    const sunZ = Math.sin(sunAngle) * 0.4;

    // Use wind system strength with subtle wave oscillation overlay
    const baseWindStrength =
      this.windSystem?.uniforms.windStrength.value ?? 1.0;
    const waveOscillation = Math.sin(this.waterTime * 0.1) * 0.1;
    const windStrength = baseWindStrength * (0.9 + waveOscillation);

    // Update lake water uniforms
    if (this.uniforms) {
      this.uniforms.time.value = this.waterTime;
      this.uniforms.sunDirection.value.set(sunX, sunY, sunZ).normalize();
      this.uniforms.windStrength.value = windStrength;
    }

    // Update ocean water uniforms
    if (this.oceanUniforms) {
      this.oceanUniforms.time.value = this.waterTime;
      this.oceanUniforms.sunDirection.value.set(sunX, sunY, sunZ).normalize();
      this.oceanUniforms.windStrength.value = windStrength * 1.2; // Ocean is windier
    }

    // Frustum culling: disable reflection camera when no lake water is visible
    // (or when reflections are disabled)
    this.updateReflectionVisibility();
  }

  /**
   * Check if any lake water meshes are in the camera frustum and enable/disable
   * the reflection render pass accordingly. This saves a full scene render
   * when no lake water is visible. Ocean water never uses reflections.
   */
  private updateReflectionVisibility(): void {
    if (!this.reflection?.target) {
      this.reflectionActive = false;
      return;
    }

    // If reflections are disabled by user preference, hide the reflector
    if (!this._reflectionsEnabled) {
      this.reflection.target.visible = false;
      this.reflectionActive = false;
      return;
    }

    const camera = this.world.camera;
    if (!camera) {
      // No camera, assume water might be visible
      this.reflection.target.visible = true;
      this.reflectionActive = true;
      return;
    }

    // If no water meshes exist, disable reflection
    if (this.waterMeshes.length === 0) {
      this.reflection.target.visible = false;
      this.reflectionActive = false;
      return;
    }

    // Build frustum from camera
    // IMPORTANT: updateMatrixWorld() updates matrixWorld but NOT matrixWorldInverse
    // We must explicitly compute matrixWorldInverse from matrixWorld
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    // Check if any LAKE water mesh is visible and in the frustum
    // Ocean water never uses reflections
    // OPTIMIZATION: Cap meshes checked per frame to prevent frame drops with many tiles
    const MAX_MESH_CHECKS = 20;
    let anyLakeWaterVisible = false;
    let checked = 0;

    for (const mesh of this.waterMeshes) {
      if (checked >= MAX_MESH_CHECKS) {
        // Over budget - assume visible to be safe (avoids reflection popping)
        anyLakeWaterVisible = this.reflectionActive; // Maintain last state
        break;
      }

      // Skip meshes that have been removed from scene or are hidden
      if (!mesh.parent || !mesh.visible) continue;

      // Skip ocean water - it doesn't use reflections
      if (mesh.userData.waterType === "ocean") continue;

      checked++;

      // Ensure bounding sphere exists (computeBoundingSphere can be expensive)
      if (!mesh.geometry.boundingSphere) {
        mesh.geometry.computeBoundingSphere();
      }

      const boundingSphere = mesh.geometry.boundingSphere;
      if (!boundingSphere) continue;

      // Transform bounding sphere to world space
      this.tempSphere.copy(boundingSphere);
      this.tempSphere.applyMatrix4(mesh.matrixWorld);

      if (this.frustum.intersectsSphere(this.tempSphere)) {
        anyLakeWaterVisible = true;
        break;
      }
    }

    // Enable/disable reflector based on lake water visibility
    this.reflection.target.visible = anyLakeWaterVisible;
    this.reflectionActive = anyLakeWaterVisible;
  }

  destroy(): void {
    this.waterMeshes = [];
  }
}
