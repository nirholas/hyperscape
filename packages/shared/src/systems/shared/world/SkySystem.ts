/**
 * SkySystem.ts - Advanced Dynamic Sky, Sun/Moon and Clouds
 *
 * Creates a dynamic skydome with day/night cycle, sun/moon visuals,
 * and layered billboard clouds using InstancedMesh.
 *
 * Fully WebGPU-compatible using TSL (Three Shading Language) Node Materials.
 * All materials use MeshBasicNodeMaterial with TSL color nodes.
 * No WebGL-specific extensions or shaders are used.
 */

import THREE, {
  MeshBasicNodeMaterial,
  texture,
  uv,
  positionLocal,
  uniform,
  float,
  vec3,
  vec4,
  pow,
  add,
  sub,
  mul,
  mix,
  clamp,
  smoothstep,
  dot,
  normalize,
  length,
  cos,
  abs,
  Fn,
  type ShaderNode,
} from "../../../extras/three/three";
import { System } from "..";
import type { World, WorldOptions } from "../../../types";

// -----------------------------
// Utility: Procedural noise textures (avoids external deps)
// -----------------------------
function createNoiseTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(Math.random() * 255);
    const o = i * 4;
    data[o] = v;
    data[o + 1] = Math.floor(Math.random() * 255);
    data[o + 2] = Math.floor(Math.random() * 255);
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// -----------------------------
// Cloud configuration with texture atlas sampling
// The cloud textures are 2x4 sprite sheets (8 clouds per texture)
// UV offset selects which cloud sprite to use
// -----------------------------
type CloudDef = {
  az: number; // azimuth in degrees
  el: number; // elevation in degrees
  tex: number; // which texture (1-4)
  sprite: number; // which sprite in atlas (0-7)
  scale: number; // size multiplier
};

const CLOUD_DEFS: CloudDef[] = [
  { az: 25, el: 22, tex: 1, sprite: 0, scale: 1.2 },
  { az: 85, el: 35, tex: 2, sprite: 2, scale: 1.0 },
  { az: 145, el: 18, tex: 1, sprite: 4, scale: 1.4 },
  { az: 205, el: 30, tex: 3, sprite: 1, scale: 1.1 },
  { az: 265, el: 42, tex: 2, sprite: 5, scale: 0.9 },
  { az: 325, el: 25, tex: 1, sprite: 3, scale: 1.3 },
];

// -----------------------------
// Sky System Uniforms Type
// -----------------------------
export type SkyUniforms = {
  time: { value: number };
  sunPosition: { value: THREE.Vector3 };
  dayCycleProgress: { value: number };
};

// TSL uniform reference type (for runtime updates)
type TSLUniformFloat = { value: number };
type TSLUniformVec3 = { value: THREE.Vector3 };

// Material uniform storage types
type SkyMaterialUniforms = {
  uTime: TSLUniformFloat;
  uSunPosition: TSLUniformVec3;
  uDayCycleProgress: TSLUniformFloat;
};

type CloudMaterialUniforms = {
  uTime: TSLUniformFloat;
  uSunPosition: TSLUniformVec3;
  uDayIntensity: TSLUniformFloat;
};

type SunMaterialUniforms = {
  uOpacity: TSLUniformFloat;
};

type MoonMaterialUniforms = {
  uOpacity: TSLUniformFloat;
};

// -----------------------------
// SkySystem
// -----------------------------
export class SkySystem extends System {
  private scene: THREE.Scene | null = null;
  private group: THREE.Group | null = null;
  private skyMesh: THREE.Mesh | null = null;
  private clouds: THREE.InstancedMesh | null = null;
  private moon: THREE.Mesh | null = null;
  private moonGlow: THREE.Mesh | null = null;
  private sun: THREE.Mesh | null = null;
  private sunGlow: THREE.Mesh | null = null;

  private galaxyTex: THREE.Texture | null = null;
  private cloud1: THREE.Texture | null = null;
  private cloud2: THREE.Texture | null = null;
  private cloud3: THREE.Texture | null = null;
  private cloud4: THREE.Texture | null = null;
  private moonTex: THREE.Texture | null = null;
  private starTex: THREE.Texture | null = null;
  private noiseA!: THREE.Texture;
  private noiseB!: THREE.Texture;

  // Legacy uniforms (for compatibility)
  private skyUniforms: SkyUniforms;

  // TSL material uniforms for runtime updates - stored at class level like WaterSystem
  private sunMaterialUniforms: SunMaterialUniforms | null = null;
  private moonMaterialUniforms: MoonMaterialUniforms | null = null;
  private skyTSLUniforms: SkyMaterialUniforms | null = null;

  private elapsed = 0;
  private dayDurationSec = 240; // full day cycle in seconds
  // Pre-allocated vector for sun direction to avoid per-frame allocation
  private _sunDir = new THREE.Vector3();
  private _dayPhase = 0;
  private _dayIntensity = 1;

  constructor(world: World) {
    super(world);
    this.skyUniforms = {
      time: { value: 0 },
      sunPosition: { value: new THREE.Vector3(0, 1, 0) },
      dayCycleProgress: { value: 0 },
    };
  }

  // =====================
  // Public getters for lighting synchronization
  // =====================

  /** Current sun direction vector (normalized) */
  get sunDirection(): THREE.Vector3 {
    return this._sunDir;
  }

  /** Day phase 0-1 (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset) */
  get dayPhase(): number {
    return this._dayPhase;
  }

  /** Day intensity 0-1 (0 = full night, 1 = full day) - smooth cosine curve */
  get dayIntensity(): number {
    return this._dayIntensity;
  }

  /** Whether it's currently daytime (sun above horizon) */
  get isDay(): boolean {
    return this._dayPhase < 0.5;
  }

  /** Moon direction vector (opposite of sun) */
  get moonDirection(): THREE.Vector3 {
    return this._sunDir.clone().negate();
  }

  override getDependencies() {
    return { required: ["stage"] };
  }

  async init(_options?: WorldOptions): Promise<void> {
    // Client-only texture loading
    if (!this.world.isClient || typeof window === "undefined") {
      return;
    }

    this.noiseA = createNoiseTexture(128);
    this.noiseB = createNoiseTexture(128);

    const loadTex = (url: string): Promise<THREE.Texture> => {
      return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
          url,
          (t) => {
            const shouldRepeat = /noise|star|galaxy/.test(url);
            t.wrapS = shouldRepeat
              ? THREE.RepeatWrapping
              : THREE.ClampToEdgeWrapping;
            t.wrapT = shouldRepeat
              ? THREE.RepeatWrapping
              : THREE.ClampToEdgeWrapping;
            t.colorSpace = THREE.SRGBColorSpace;
            resolve(t);
          },
          undefined,
          (e) => reject(e),
        );
      });
    };

    const results = await Promise.allSettled([
      loadTex("/textures/cloud1.png"),
      loadTex("/textures/cloud2.png"),
      loadTex("/textures/cloud3.png"),
      loadTex("/textures/cloud4.png"),
      loadTex("/textures/galaxy.png"),
      loadTex("/textures/moon2.png"),
      loadTex("/textures/star3.png"),
      loadTex("/textures/noise.png"),
      loadTex("/textures/noise2.png"),
    ]);

    // Extract successful loads
    const getResult = (index: number): THREE.Texture | null => {
      const result = results[index];
      return result.status === "fulfilled" ? result.value : null;
    };

    this.cloud1 = getResult(0);
    this.cloud2 = getResult(1);
    this.cloud3 = getResult(2);
    this.cloud4 = getResult(3);
    this.galaxyTex = getResult(4);
    this.moonTex = getResult(5);
    this.starTex = getResult(6);
    const n1 = getResult(7);
    const n2 = getResult(8);
    if (n1) this.noiseA = n1;
    if (n2) this.noiseB = n2;
  }

  start(): void {
    if (!this.world.isClient || typeof window === "undefined") return;
    if (!this.world.stage?.scene) return;
    this.scene = this.world.stage.scene as THREE.Scene;

    // Root group
    this.group = new THREE.Group();
    this.group.name = "SkySystemGroup";
    this.scene.add(this.group);

    // Create sky dome with TSL Node Material
    this.createSkyDome();

    // Create sun with TSL Node Material
    this.createSun();

    // Create moon with TSL Node Material
    this.createMoon();

    // Clouds (instanced billboards)
    this.createClouds();
  }

  /**
   * Create sun mesh with TSL Node Material (WebGPU-compatible)
   */
  private createSun(): void {
    if (!this.group) return;

    // Sun disc geometry
    const sunGeom = new THREE.CircleGeometry(150, 32);

    // TSL uniform for opacity control
    const uOpacity = uniform(float(0.9));

    // TSL sun color node - warm sun color with opacity
    const sunColorNode = Fn(() => {
      const sunColor = vec3(0.95, 0.78, 0.54); // Warm sun color
      return vec4(sunColor, uOpacity);
    })();

    // Create Node Material for sun
    const sunMat = new MeshBasicNodeMaterial();
    sunMat.colorNode = sunColorNode;
    sunMat.blending = THREE.AdditiveBlending;
    sunMat.depthWrite = false;
    sunMat.transparent = true;
    sunMat.fog = false;

    // Store uniform for runtime updates
    this.sunMaterialUniforms = { uOpacity };

    this.sun = new THREE.Mesh(sunGeom, sunMat);
    this.sun.name = "SkySun";
    this.sun.renderOrder = 2;
    this.group.add(this.sun);

    // Sun glow effect (larger, softer circle behind sun) - replaces Lensflare
    // Size 800 creates a prominent halo visible at distance 4000
    const glowGeom = new THREE.CircleGeometry(800, 32);

    // TSL glow color with gradual radial falloff - large soft halo around sun
    const glowColorNode = Fn(() => {
      const uvCoord = uv();
      // Distance from center (0.5, 0.5)
      const center = vec3(0.5, 0.5, 0.0);
      const uvPos = vec3(uvCoord.x, uvCoord.y, float(0.0));
      const dist = length(sub(uvPos, center));
      // Gradual falloff - inverse square for natural light falloff
      const normalizedDist = mul(dist, float(2.0)); // 0 at center, 1 at edge
      const falloff = clamp(
        sub(float(1.0), normalizedDist),
        float(0.0),
        float(1.0),
      );
      // Lower power = softer, wider falloff for visible halo
      const glowStrength = pow(falloff, float(1.5));
      // Warm glow color
      const glowColor = vec3(1.0, 0.85, 0.6);
      return vec4(
        mul(glowColor, glowStrength),
        mul(glowStrength, uOpacity), // Full opacity, no 0.3 damping
      );
    })();

    const glowMat = new MeshBasicNodeMaterial();
    glowMat.colorNode = glowColorNode;
    glowMat.blending = THREE.AdditiveBlending;
    glowMat.depthWrite = false;
    glowMat.transparent = true;
    glowMat.side = THREE.DoubleSide;
    glowMat.fog = false;

    this.sunGlow = new THREE.Mesh(glowGeom, glowMat);
    this.sunGlow.name = "SkySunGlow";
    this.sunGlow.renderOrder = 1;
    this.group.add(this.sunGlow);
  }

  /**
   * Create moon mesh with TSL Node Material (WebGPU-compatible)
   */
  private createMoon(): void {
    if (!this.group) return;

    const moonGeom = new THREE.PlaneGeometry(420, 420);

    // TSL uniform for opacity control
    const uOpacity = uniform(float(1.0));

    // TSL moon color node
    const moonColorNode = Fn(() => {
      const uvCoord = uv();
      // Sample moon texture if available
      const texColor = this.moonTex
        ? texture(this.moonTex, uvCoord)
        : vec4(0.9, 0.9, 0.95, 1.0);
      return vec4(texColor.rgb, mul(texColor.a, uOpacity));
    })();

    const moonMat = new MeshBasicNodeMaterial();
    moonMat.colorNode = moonColorNode;
    moonMat.blending = THREE.AdditiveBlending;
    moonMat.depthWrite = false;
    moonMat.transparent = true;
    moonMat.side = THREE.DoubleSide;
    moonMat.fog = false;

    // Store uniform for runtime updates
    this.moonMaterialUniforms = { uOpacity };

    this.moon = new THREE.Mesh(moonGeom, moonMat);
    this.moon.name = "SkyMoon";
    this.moon.renderOrder = 2;
    this.group.add(this.moon);

    // Moon glow effect - soft halo around moon
    const moonGlowGeom = new THREE.CircleGeometry(600, 32);

    const moonGlowColorNode = Fn(() => {
      const uvCoord = uv();
      const center = vec3(0.5, 0.5, 0.0);
      const uvPos = vec3(uvCoord.x, uvCoord.y, float(0.0));
      const dist = length(sub(uvPos, center));
      const normalizedDist = mul(dist, float(2.0));
      const falloff = clamp(
        sub(float(1.0), normalizedDist),
        float(0.0),
        float(1.0),
      );
      // Soft glow falloff
      const glowStrength = pow(falloff, float(1.5));
      // Cool blue-white glow for moon
      const glowColor = vec3(0.7, 0.8, 1.0);
      return vec4(mul(glowColor, glowStrength), mul(glowStrength, uOpacity));
    })();

    const moonGlowMat = new MeshBasicNodeMaterial();
    moonGlowMat.colorNode = moonGlowColorNode;
    moonGlowMat.blending = THREE.AdditiveBlending;
    moonGlowMat.depthWrite = false;
    moonGlowMat.transparent = true;
    moonGlowMat.side = THREE.DoubleSide;
    moonGlowMat.fog = false;

    this.moonGlow = new THREE.Mesh(moonGlowGeom, moonGlowMat);
    this.moonGlow.name = "SkyMoonGlow";
    this.moonGlow.renderOrder = 1;
    this.group.add(this.moonGlow);
  }

  /**
   * Create sky dome with TSL Node Material
   * Production-grade day/night cycle with smooth transitions, stars, and proper atmosphere
   */
  private createSkyDome(): void {
    if (!this.group) return;

    // Use high segment count to prevent color banding
    const skyGeom = new THREE.SphereGeometry(8000, 128, 64);

    // Create TSL uniforms
    const uTime = uniform(float(0));
    const uSunPosition = uniform(vec3(0, 1, 0));
    const uDayCycleProgress = uniform(float(0));

    // Reference to galaxy texture for star rendering
    const galaxyTexRef = this.galaxyTex;

    // Create the sky color node - comprehensive day/night with stars
    const skyColorNode = Fn(() => {
      const localPos = normalize(positionLocal);

      // Elevation: 0 at horizon, 1 at zenith
      // Use abs() to make sky symmetric - lower hemisphere mirrors upper
      // This is essential for correct planar water reflections
      const elevation = abs(localPos.y);

      // =====================
      // DAY/NIGHT CYCLE
      // =====================
      // Progress: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1.0 = midnight
      // Use cosine for smooth day intensity: peaks at 0.5 (noon), lowest at 0/1 (midnight)
      const dayAngle = mul(uDayCycleProgress, float(6.2832)); // 2*PI
      // Shift so noon (0.5) = peak: cos(2π * 0.5 - π) = cos(0) = 1
      const dayIntensity = clamp(
        mul(add(cos(sub(dayAngle, float(3.14159))), float(1.0)), float(0.5)),
        float(0.0),
        float(1.0),
      );

      // Night intensity is inverse of day
      const nightIntensity = sub(float(1.0), dayIntensity);

      // =====================
      // SKY COLORS
      // =====================
      // Day sky gradient: deep blue at zenith, lighter at horizon
      const dayZenith = vec3(0.25, 0.55, 0.95); // Rich blue
      const dayHorizon = vec3(0.7, 0.85, 1.0); // Light blue/white
      const dayGradient = pow(sub(float(1.0), elevation), float(1.5));
      const daySkyColor = mix(dayZenith, dayHorizon, dayGradient);

      // Night sky gradient: deep dark blue at zenith, slightly lighter at horizon
      const nightZenith = vec3(0.02, 0.03, 0.08); // Very dark blue
      const nightHorizon = vec3(0.08, 0.1, 0.18); // Dark blue-gray
      const nightGradient = pow(sub(float(1.0), elevation), float(2.0));
      const nightSkyColor = mix(nightZenith, nightHorizon, nightGradient);

      // Blend day/night sky
      let skyColor: ShaderNode = mix(nightSkyColor, daySkyColor, dayIntensity);

      // =====================
      // SUNRISE/SUNSET GLOW
      // =====================
      // Detect when sun is near horizon (sunrise/sunset)
      const sunY = uSunPosition.y;
      // Dawn/dusk factor: peaks when sun is at horizon (-0.1 to 0.3)
      const dawnDuskFactor = smoothstep(float(-0.2), float(0.0), sunY);
      const dawnDuskFade = smoothstep(float(0.4), float(0.15), sunY);
      const sunriseSunsetIntensity = mul(dawnDuskFactor, dawnDuskFade);

      // Direction to sun for glow positioning
      const sunDir = normalize(uSunPosition);
      const angleToSun = dot(localPos, sunDir);

      // Sunrise/sunset colors near sun
      const sunriseColor = vec3(1.0, 0.5, 0.2); // Orange
      const sunsetPinkColor = vec3(1.0, 0.4, 0.5); // Pink/red

      // Glow strongest near sun, with gradual falloff across radius
      // Use power function for smooth natural falloff instead of smoothstep
      const sunGlowRaw = clamp(angleToSun, float(0.0), float(1.0));
      const sunGlowAngle = pow(sunGlowRaw, float(4.0)); // Higher power = tighter, more gradual falloff
      // Also affect horizon area more
      const horizonGlow = pow(
        clamp(
          sub(float(1.0), mul(elevation, float(2.0))),
          float(0.0),
          float(1.0),
        ),
        float(2.0),
      );

      const glowIntensity = mul(
        mul(sunGlowAngle, horizonGlow),
        mul(sunriseSunsetIntensity, float(0.6)),
      );

      // Blend sunrise color with slight pink variation based on time
      const dawnOrDusk = smoothstep(float(0.2), float(0.3), uDayCycleProgress);
      const glowColor = mix(sunriseColor, sunsetPinkColor, dawnOrDusk);
      skyColor = add(skyColor, mul(glowColor, glowIntensity));

      // =====================
      // STARS (Night only) - Simple equirectangular mapping
      // =====================
      // Stars visible at night, above horizon
      const starVisibility = mul(
        nightIntensity,
        smoothstep(float(0.1), float(0.4), elevation),
      );

      // Simple equirectangular UV from sphere position
      // U = atan2(x, z) / 2π + 0.5, V = y * 0.5 + 0.5
      // Simplified approximation that avoids atan2
      const starU = mul(
        add(localPos.x, mul(localPos.z, float(0.7))),
        float(0.3),
      );
      const starV = mul(add(localPos.y, float(1.0)), float(0.5));

      // Sample galaxy texture for stars (has nice star distribution)
      const starSample = galaxyTexRef
        ? texture(galaxyTexRef, vec3(starU, starV, float(0.0)).xy)
        : vec4(0.0, 0.0, 0.0, 0.0);

      // Use texture brightness as star intensity
      const starIntensity = mul(starSample.r, float(0.3));
      const finalStarColor = mul(
        vec3(0.9, 0.92, 1.0), // Slight blue-white tint
        mul(starIntensity, starVisibility),
      );
      skyColor = add(skyColor, finalStarColor);

      // =====================
      // MOON GLOW (Night atmospheric glow)
      // =====================
      const moonPos = mul(sunDir, float(-1.0));
      const angleToMoon = dot(localPos, moonPos);
      // Use power function for gradual falloff instead of smoothstep
      const moonGlowRaw = clamp(angleToMoon, float(0.0), float(1.0));
      const moonGlowAngle = pow(moonGlowRaw, float(8.0)); // Higher power = tighter, more gradual
      const moonGlowColor = vec3(0.4, 0.5, 0.7); // Cool blue glow
      const moonGlowIntensity = mul(
        mul(moonGlowAngle, nightIntensity),
        float(0.25),
      );
      skyColor = add(skyColor, mul(moonGlowColor, moonGlowIntensity));

      // =====================
      // HORIZON HAZE (subtle atmosphere)
      // =====================
      const hazeColor = vec3(0.83, 0.78, 0.72); // Warm beige
      // Haze strongest near horizon (low elevation), fades as you go higher
      // Use elevation (which is now abs(localPos.y)) for symmetric reflections
      const hazeStrength = smoothstep(float(0.15), float(0.0), elevation);
      // Haze stronger during day, subtle at night
      const hazeAmount = mul(
        hazeStrength,
        mul(float(0.4), add(float(0.3), mul(dayIntensity, float(0.7)))),
      );
      skyColor = mix(skyColor, hazeColor, hazeAmount);

      return vec4(skyColor, float(1.0));
    })();

    // Create the Node Material
    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = skyColorNode;
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.transparent = false;
    skyMat.toneMapped = true;
    skyMat.fog = false; // Sky should never be affected by scene fog

    // Store TSL uniforms at class level for reliable updates (like WaterSystem)
    // Store directly without casting - the uniform() function returns objects with .value
    this.skyTSLUniforms = {
      uTime: uTime,
      uSunPosition: uSunPosition as unknown as TSLUniformVec3,
      uDayCycleProgress: uDayCycleProgress,
    } as SkyMaterialUniforms;

    this.skyMesh = new THREE.Mesh(skyGeom, skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.name = "AdvancedSkydome";
    this.group.add(this.skyMesh);
  }

  // Store cloud group for rotation animation
  private cloudGroup: THREE.Group | null = null;

  /**
   * Create cloud billboards using cloud textures
   * Each cloud samples from a sprite atlas (2 columns x 4 rows = 8 sprites per texture)
   */
  private createClouds(): void {
    if (!this.group) return;

    const SKY_RADIUS = 5500;
    const BASE_SIZE = 1800;

    // Create a group to hold all cloud meshes (for rotation)
    this.cloudGroup = new THREE.Group();
    this.cloudGroup.name = "CloudGroup";

    // Get textures array for easy lookup
    const textures = [this.cloud1, this.cloud2, this.cloud3, this.cloud4];

    // Shared uniforms for all clouds
    const uTime = uniform(float(0));
    const uSunDir = uniform(vec3(0, 1, 0));
    const uDayIntensity = uniform(float(1.0)); // For darkening clouds at night

    for (let i = 0; i < CLOUD_DEFS.length; i++) {
      const def = CLOUD_DEFS[i];
      const tex = textures[def.tex - 1]; // tex is 1-indexed

      if (!tex) continue;

      // Calculate UV offset for sprite in atlas (2 cols x 4 rows)
      const col = def.sprite % 2;
      const row = Math.floor(def.sprite / 2);
      const uOffset = col * 0.5;
      const vOffset = 0.75 - row * 0.25; // rows go from top

      // Create geometry with adjusted UVs for this sprite
      const geom = new THREE.PlaneGeometry(1, 1);
      const uvAttr = geom.attributes.uv;
      for (let j = 0; j < uvAttr.count; j++) {
        const u = uvAttr.getX(j) * 0.5 + uOffset;
        const v = uvAttr.getY(j) * 0.25 + vOffset;
        uvAttr.setXY(j, u, v);
      }
      uvAttr.needsUpdate = true;

      // Create material with this cloud's texture - simple soft clouds
      const cloudColorNode = Fn(() => {
        const uvCoord = uv();
        const cloudTex = texture(tex, uvCoord);

        // Day/night color - clouds darken significantly at night
        // uDayIntensity: 1 = full day, 0 = full night
        const dayColor = vec3(1.0, 1.0, 1.0); // day: pure white
        const nightColor = vec3(0.15, 0.18, 0.25); // night: dark blue-gray
        const cloudColor = mix(nightColor, dayColor, uDayIntensity);

        // Alpha also fades at night (clouds less visible)
        const nightAlpha = add(float(0.3), mul(uDayIntensity, float(0.7))); // 30%-100%
        const finalAlpha = mul(cloudTex.a, nightAlpha);

        return vec4(cloudColor, finalAlpha);
      })();

      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = cloudColorNode;
      mat.side = THREE.DoubleSide;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.toneMapped = false;
      mat.fog = false; // Don't let scene fog affect clouds

      // Store uniform reference on first material (for updates)
      if (i === 0) {
        (
          mat as THREE.Material & { cloudUniforms?: CloudMaterialUniforms }
        ).cloudUniforms = {
          uTime,
          uSunPosition: uSunDir,
          uDayIntensity,
        } as CloudMaterialUniforms;
      }

      // Create mesh
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;

      // Position on sky dome
      const azRad = (def.az * Math.PI) / 180;
      const elRad = (def.el * Math.PI) / 180;

      const x = SKY_RADIUS * Math.cos(elRad) * Math.sin(azRad);
      const y = SKY_RADIUS * Math.sin(elRad);
      const z = SKY_RADIUS * Math.cos(elRad) * Math.cos(azRad);

      mesh.position.set(x, y, z);

      // Rotate to face center (billboard)
      mesh.rotation.y = azRad + Math.PI;

      // Scale
      const w = BASE_SIZE * def.scale * 1.5;
      const h = BASE_SIZE * def.scale * 0.7;
      mesh.scale.set(w, h, 1);

      // Store base scale for animation
      mesh.userData.baseScale = new THREE.Vector3(w, h, 1);

      this.cloudGroup.add(mesh);
    }

    // Store reference (use first mesh for uniform updates)
    this.clouds = this.cloudGroup.children[0] as THREE.InstancedMesh;
    this.group.add(this.cloudGroup);
  }

  override update(delta: number): void {
    if (!this.group || !this.skyMesh) return;
    this.elapsed += delta;

    // Time-of-day (0..1)
    const worldTime = this.world.getTime();
    const dayPhase = (worldTime % this.dayDurationSec) / this.dayDurationSec;
    const isDay = dayPhase < 0.5;

    // Store for public getters
    this._dayPhase = dayPhase;
    // Calculate smooth day intensity using cosine (peaks at noon, lowest at midnight)
    // dayPhase 0.5 = noon = max intensity, dayPhase 0/1 = midnight = min intensity
    this._dayIntensity = Math.max(
      0,
      Math.cos((dayPhase - 0.5) * Math.PI * 2) * 0.5 + 0.5,
    );

    // Sun direction on unit circle around scene using pre-allocated vector
    const inc = 0.01;
    const theta = Math.PI * (inc - 0.5);
    const phi = 2 * Math.PI * (dayPhase - 0.5);
    this._sunDir.set(
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
      Math.sin(phi) * Math.cos(theta),
    );

    // Update uniforms
    this.skyUniforms.time.value = this.elapsed;
    this.skyUniforms.sunPosition.value.copy(this._sunDir);
    this.skyUniforms.dayCycleProgress.value = dayPhase;

    // Position sun/moon
    const radius = 4000;
    if (this.sun) {
      this.sun.position.set(
        this._sunDir.x * radius,
        this._sunDir.y * radius,
        this._sunDir.z * radius,
      );
      this.sun.visible = isDay;
      this.sun.quaternion.copy(this.world.camera.quaternion);

      // Update sun opacity via TSL uniform
      if (this.sunMaterialUniforms) {
        this.sunMaterialUniforms.uOpacity.value = isDay ? 0.9 : 0.0;
      }
    }

    // Position sun glow (WebGPU-compatible lensflare replacement)
    if (this.sunGlow) {
      this.sunGlow.position.set(
        this._sunDir.x * radius,
        this._sunDir.y * radius,
        this._sunDir.z * radius,
      );
      this.sunGlow.visible = isDay;
      this.sunGlow.quaternion.copy(this.world.camera.quaternion);
    }

    if (this.moon) {
      this.moon.position.set(
        -this._sunDir.x * radius,
        -this._sunDir.y * radius,
        -this._sunDir.z * radius,
      );
      this.moon.quaternion.copy(this.world.camera.quaternion);
      this.moon.visible = true;

      // Update moon opacity via TSL uniform
      if (this.moonMaterialUniforms) {
        this.moonMaterialUniforms.uOpacity.value = isDay ? 0.0 : 1.0;
      }
    }

    // Position moon glow (halo behind moon)
    if (this.moonGlow) {
      this.moonGlow.position.set(
        -this._sunDir.x * radius,
        -this._sunDir.y * radius,
        -this._sunDir.z * radius,
      );
      this.moonGlow.visible = !isDay;
      this.moonGlow.quaternion.copy(this.world.camera.quaternion);
    }

    // Update sky TSL uniforms (stored at class level for reliable updates)
    if (this.skyTSLUniforms) {
      this.skyTSLUniforms.uTime.value = this.elapsed;
      this.skyTSLUniforms.uSunPosition.value.copy(this._sunDir);
      this.skyTSLUniforms.uDayCycleProgress.value = dayPhase;
    }

    // Update cloud material uniforms
    if (this.clouds) {
      const cloudMat = this.clouds.material as THREE.Material & {
        cloudUniforms?: CloudMaterialUniforms;
      };
      if (cloudMat.cloudUniforms) {
        cloudMat.cloudUniforms.uTime.value = this.elapsed;
        cloudMat.cloudUniforms.uSunPosition.value.copy(this._sunDir);
        cloudMat.cloudUniforms.uDayIntensity.value = this._dayIntensity;
      }

      if (this.sun) this.sun.renderOrder = 2;
      if (this.moon) this.moon.renderOrder = 2;
    }

    // Very slowly rotate cloud cover and animate scale
    if (this.cloudGroup) {
      // ~1 full rotation per 40 minutes (0.0025 radians/sec)
      this.cloudGroup.rotation.y += delta * 0.0025;

      // Animate each cloud's scale for gentle breathing effect
      this.cloudGroup.children.forEach((mesh, i) => {
        if (mesh instanceof THREE.Mesh) {
          const baseScale = mesh.userData.baseScale as
            | THREE.Vector3
            | undefined;
          if (baseScale) {
            // Each cloud has different phase
            const phase = this.elapsed * 0.3 + i * 1.5;
            // Scale oscillates between 95% and 105%
            const scaleMod = 1.0 + Math.sin(phase) * 0.05;
            mesh.scale.set(
              baseScale.x * scaleMod,
              baseScale.y * scaleMod,
              baseScale.z,
            );
          }
        }
      });
    }
  }

  override lateUpdate(_delta: number): void {
    if (!this.group) return;
    // Keep sky centered on camera for infinite effect - follow all 3 axes
    // This ensures you can never "hit the edge" of the sky regardless of direction
    this.group.position.copy(this.world.rig.position);
  }

  override destroy(): void {
    if (this.group && this.group.parent) {
      this.group.parent.remove(this.group);
    }
    if (this.skyMesh) {
      this.skyMesh.geometry.dispose();
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh = null;
    }
    if (this.clouds) {
      this.clouds.geometry.dispose();
      (this.clouds.material as THREE.Material).dispose();
      this.clouds = null;
    }
    if (this.sun) {
      this.sun.geometry.dispose();
      (this.sun.material as THREE.Material).dispose();
      this.sun = null;
    }
    if (this.sunGlow) {
      this.sunGlow.geometry.dispose();
      (this.sunGlow.material as THREE.Material).dispose();
      this.sunGlow = null;
    }
    if (this.moon) {
      this.moon.geometry.dispose();
      (this.moon.material as THREE.Material).dispose();
      this.moon = null;
    }
    if (this.moonGlow) {
      this.moonGlow.geometry.dispose();
      (this.moonGlow.material as THREE.Material).dispose();
      this.moonGlow = null;
    }
    this.sunMaterialUniforms = null;
    this.moonMaterialUniforms = null;
    this.group = null;
  }
}

export default SkySystem;
