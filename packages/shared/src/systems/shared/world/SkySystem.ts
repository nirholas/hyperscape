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
  positionWorld,
  uniform,
  float,
  vec3,
  vec4,
  sin,
  abs,
  pow,
  add,
  sub,
  mul,
  div,
  mix,
  clamp,
  smoothstep,
  dot,
  normalize,
  distance,
  length,
  min,
  max,
  step,
  Fn,
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
// Cloud data (subset from reference; enough for layered sky feel)
// -----------------------------
type CloudItem = {
  textureNumber: number;
  cloudNumber: number;
  positionIndex: number;
  posY: number;
  width: number;
  height: number;
  distortionSpeed: number;
  distortionRange: number;
};

const cloudData: CloudItem[] = [
  {
    textureNumber: 2,
    cloudNumber: 0,
    positionIndex: 4,
    posY: 350,
    width: 300,
    height: 200,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 6,
    positionIndex: 0,
    posY: 350,
    width: 300,
    height: 200,
    distortionSpeed: 0.11,
    distortionRange: 0.05,
  },
  {
    textureNumber: 2,
    cloudNumber: 1,
    positionIndex: 14,
    posY: 350,
    width: 300,
    height: 180,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 6,
    positionIndex: 8,
    posY: 350,
    width: 300,
    height: 180,
    distortionSpeed: 0.1,
    distortionRange: 0.0,
  },
  {
    textureNumber: 2,
    cloudNumber: 2,
    positionIndex: 28,
    posY: 350,
    width: 400,
    height: 200,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 6,
    positionIndex: 30,
    posY: 350,
    width: 400,
    height: 200,
    distortionSpeed: 0.12,
    distortionRange: 0.05,
  },
  {
    textureNumber: 2,
    cloudNumber: 3,
    positionIndex: 45,
    posY: 350,
    width: 400,
    height: 200,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 7,
    positionIndex: 50,
    posY: 350,
    width: 400,
    height: 200,
    distortionSpeed: 0.1,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 4,
    positionIndex: 69,
    posY: 350,
    width: 350,
    height: 175,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 6,
    positionIndex: 75,
    posY: 350,
    width: 350,
    height: 175,
    distortionSpeed: 0.12,
    distortionRange: 0.0,
  },
  {
    textureNumber: 2,
    cloudNumber: 5,
    positionIndex: 80,
    posY: 350,
    width: 350,
    height: 175,
    distortionSpeed: 0.12,
    distortionRange: 0.1,
  },
  {
    textureNumber: 2,
    cloudNumber: 7,
    positionIndex: 85,
    posY: 350,
    width: 500,
    height: 200,
    distortionSpeed: 0.1,
    distortionRange: 0.05,
  },
  {
    textureNumber: 0,
    cloudNumber: 0,
    positionIndex: 0,
    posY: 450,
    width: 230,
    height: 115,
    distortionSpeed: 0.1,
    distortionRange: 0.5,
  },
  {
    textureNumber: 0,
    cloudNumber: 1,
    positionIndex: 15,
    posY: 550,
    width: 180,
    height: 90,
    distortionSpeed: 0.12,
    distortionRange: 0.4,
  },
  {
    textureNumber: 0,
    cloudNumber: 2,
    positionIndex: 23,
    posY: 650,
    width: 210,
    height: 105,
    distortionSpeed: 0.13,
    distortionRange: 0.35,
  },
  {
    textureNumber: 0,
    cloudNumber: 3,
    positionIndex: 34,
    posY: 400,
    width: 250,
    height: 125,
    distortionSpeed: 0.15,
    distortionRange: 0.4,
  },
  {
    textureNumber: 0,
    cloudNumber: 4,
    positionIndex: 46,
    posY: 450,
    width: 230,
    height: 115,
    distortionSpeed: 0.16,
    distortionRange: 0.35,
  },
  {
    textureNumber: 0,
    cloudNumber: 5,
    positionIndex: 58,
    posY: 550,
    width: 290,
    height: 145,
    distortionSpeed: 0.12,
    distortionRange: 0.4,
  },
  {
    textureNumber: 0,
    cloudNumber: 6,
    positionIndex: 75,
    posY: 475,
    width: 150,
    height: 75,
    distortionSpeed: 0.2,
    distortionRange: 0.45,
  },
  {
    textureNumber: 0,
    cloudNumber: 7,
    positionIndex: 90,
    posY: 450,
    width: 240,
    height: 120,
    distortionSpeed: 0.17,
    distortionRange: 0.5,
  },
  {
    textureNumber: 3,
    cloudNumber: 7,
    positionIndex: 60,
    posY: 375,
    width: 300,
    height: 150,
    distortionSpeed: 0.1,
    distortionRange: 0.5,
  },
  {
    textureNumber: 3,
    cloudNumber: 6,
    positionIndex: 20,
    posY: 375,
    width: 200,
    height: 100,
    distortionSpeed: 0.12,
    distortionRange: 0.4,
  },
  {
    textureNumber: 3,
    cloudNumber: 5,
    positionIndex: 36,
    posY: 550,
    width: 250,
    height: 120,
    distortionSpeed: 0.13,
    distortionRange: 0.35,
  },
  {
    textureNumber: 3,
    cloudNumber: 4,
    positionIndex: 50,
    posY: 625,
    width: 280,
    height: 170,
    distortionSpeed: 0.15,
    distortionRange: 0.4,
  },
  {
    textureNumber: 3,
    cloudNumber: 3,
    positionIndex: 69,
    posY: 550,
    width: 350,
    height: 200,
    distortionSpeed: 0.16,
    distortionRange: 0.35,
  },
  {
    textureNumber: 3,
    cloudNumber: 2,
    positionIndex: 79,
    posY: 700,
    width: 390,
    height: 200,
    distortionSpeed: 0.12,
    distortionRange: 0.4,
  },
  {
    textureNumber: 3,
    cloudNumber: 1,
    positionIndex: 85,
    posY: 525,
    width: 380,
    height: 190,
    distortionSpeed: 0.2,
    distortionRange: 0.45,
  },
  {
    textureNumber: 3,
    cloudNumber: 0,
    positionIndex: 95,
    posY: 675,
    width: 150,
    height: 100,
    distortionSpeed: 0.17,
    distortionRange: 0.5,
  },
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

  // TSL uniforms
  private skyUniforms: SkyUniforms;

  // TSL material uniforms for runtime updates
  private sunMaterialUniforms: SunMaterialUniforms | null = null;
  private moonMaterialUniforms: MoonMaterialUniforms | null = null;

  private elapsed = 0;
  private dayDurationSec = 240; // full day cycle in seconds
  // Pre-allocated vector for sun direction to avoid per-frame allocation
  private _sunDir = new THREE.Vector3();

  constructor(world: World) {
    super(world);
    this.skyUniforms = {
      time: { value: 0 },
      sunPosition: { value: new THREE.Vector3(0, 1, 0) },
      dayCycleProgress: { value: 0 },
    };
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

    // Store uniform for runtime updates
    this.sunMaterialUniforms = { uOpacity };

    this.sun = new THREE.Mesh(sunGeom, sunMat);
    this.sun.name = "SkySun";
    this.sun.renderOrder = 2;
    this.group.add(this.sun);

    // Sun glow effect (larger, softer circle behind sun) - replaces Lensflare
    const glowGeom = new THREE.CircleGeometry(450, 32);

    // TSL glow color with radial falloff
    const glowColorNode = Fn(() => {
      const uvCoord = uv();
      // Distance from center (0.5, 0.5)
      const center = vec3(0.5, 0.5, 0.0);
      const uvPos = vec3(uvCoord.x, uvCoord.y, float(0.0));
      const dist = length(sub(uvPos, center));
      // Smooth falloff from center
      const falloff = smoothstep(float(0.5), float(0.0), dist);
      const glowStrength = pow(falloff, float(1.5));
      // Warm glow color
      const glowColor = vec3(1.0, 0.9, 0.7);
      return vec4(
        mul(glowColor, glowStrength),
        mul(glowStrength, mul(uOpacity, float(0.4))),
      );
    })();

    const glowMat = new MeshBasicNodeMaterial();
    glowMat.colorNode = glowColorNode;
    glowMat.blending = THREE.AdditiveBlending;
    glowMat.depthWrite = false;
    glowMat.transparent = true;
    glowMat.side = THREE.DoubleSide;

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

    // Store uniform for runtime updates
    this.moonMaterialUniforms = { uOpacity };

    this.moon = new THREE.Mesh(moonGeom, moonMat);
    this.moon.name = "SkyMoon";
    this.moon.renderOrder = 2;
    this.group.add(this.moon);
  }

  /**
   * Create sky dome with TSL Node Material
   */
  private createSkyDome(): void {
    if (!this.group) return;

    const skyGeom = new THREE.SphereGeometry(8000, 32, 32);

    // Create TSL uniforms
    const uTime = uniform(float(0));
    const uSunPosition = uniform(vec3(0, 1, 0));
    const uDayCycleProgress = uniform(float(0));

    // Sky colors
    const colorDayCycleHigh = vec3(0.55, 0.78, 1.0); // #8cc8ff
    const colorDayCycleLow = vec3(0.88, 0.95, 1.0); // #e0f2ff
    const colorNightHigh = vec3(0.04, 0.05, 0.1); // #0a0d1a
    const colorNightLow = vec3(0.1, 0.125, 0.2); // #1a2033
    const colorDawn = vec3(1.0, 0.48, 0.23); // #ff7a3a
    const colorSun = vec3(1.0, 1.0, 0.93); // #ffffee

    // Atmosphere parameters
    const atmosphereElevation = float(0.4);
    const atmospherePower = float(2.5);
    const dawnAngleAmplitude = float(0.35);
    const dawnElevationAmplitude = float(0.25);
    const sunAmplitude = float(0.05);
    const sunMultiplier = float(0.8);

    // Create the sky color node
    const skyColorNode = Fn(() => {
      const uvCoord = uv();
      const localPos = normalize(positionLocal);

      // Sky gradient based on elevation
      const horizonIntensity = div(
        sub(uvCoord.y, float(0.5)),
        atmosphereElevation,
      );
      const horizonFactor = pow(
        sub(float(1.0), horizonIntensity),
        atmospherePower,
      );

      // Day cycle colors
      const colorDayCycle = mix(
        colorDayCycleHigh,
        colorDayCycleLow,
        horizonFactor,
      );
      const colorNight = mix(colorNightHigh, colorNightLow, horizonFactor);

      // Day intensity based on cycle progress
      const dayIntensityCalc = Fn(() => {
        const progress = uDayCycleProgress;
        const isFirstHalf = step(progress, float(0.5));
        const firstHalfIntensity = mul(
          sub(float(0.25), abs(sub(progress, float(0.25)))),
          float(4.0),
        );
        return mul(firstHalfIntensity, isFirstHalf);
      })();

      let skyColor = mix(colorNight, colorDayCycle, dayIntensityCalc);

      // Dawn color contribution
      const dawnAngleIntensity = dot(normalize(uSunPosition), localPos);
      const dawnAngleFactor = smoothstep(
        float(0.0),
        float(1.0),
        div(
          sub(dawnAngleIntensity, sub(float(1.0), dawnAngleAmplitude)),
          dawnAngleAmplitude,
        ),
      );
      const dawnElevationFactor = sub(
        float(1.0),
        min(
          float(1.0),
          div(sub(uvCoord.y, float(0.5)), dawnElevationAmplitude),
        ),
      );

      const dawnDayCycleIntensity = Fn(() => {
        const progress = uDayCycleProgress;
        const isFirstHalf = step(progress, float(0.5));
        const intensity = mul(abs(sub(progress, float(0.25))), float(4.0));
        return mul(
          mul(add(mul(intensity, float(4.0)), float(3.14159)), float(0.5)),
          isFirstHalf,
        );
      })();

      const dawnIntensity = clamp(
        mul(mul(dawnAngleFactor, dawnElevationFactor), dawnDayCycleIntensity),
        float(0.0),
        float(1.0),
      );

      // Add dawn color
      skyColor = add(skyColor, mul(colorDawn, dawnIntensity));

      // Sun glow
      const distanceToSun = distance(localPos, uSunPosition);
      const sunIntensity = mul(
        smoothstep(
          float(0.0),
          float(1.0),
          clamp(
            sub(float(1.0), div(distanceToSun, sunAmplitude)),
            float(0.0),
            float(1.0),
          ),
        ),
        sunMultiplier,
      );
      skyColor = add(skyColor, mul(colorSun, sunIntensity));

      // Sun glow halo
      const sunGlowStrength = pow(
        max(float(0.0), sub(float(1.05), mul(distanceToSun, float(2.5)))),
        float(2.0),
      );
      skyColor = add(skyColor, mul(colorSun, sunGlowStrength));

      // Stars (simplified - just add some brightness at night)
      const starFactor = mul(
        sub(float(1.0), dayIntensityCalc),
        mul(sin(mul(localPos.x, float(100.0))), float(0.1)),
      );
      skyColor = add(skyColor, vec3(starFactor, starFactor, starFactor));

      // Moon glow
      const moonPosition = mul(uSunPosition, float(-1.0));
      const moonDist = distance(localPos, moonPosition);
      const moonArea = sub(float(1.0), div(moonDist, float(1.0)));
      const moonFactor = smoothstep(float(0.1), float(2.0), moonArea);
      const moonColor = vec3(0.1, 0.7, 0.9);
      const nightFactor = sub(float(1.0), dayIntensityCalc);
      skyColor = add(
        skyColor,
        mul(mul(moonColor, moonFactor), mul(nightFactor, float(0.4))),
      );

      return vec4(skyColor, float(1.0));
    })();

    // Create the Node Material
    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = skyColorNode;
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.transparent = false;
    skyMat.toneMapped = true;

    // Store uniforms for updates
    (
      skyMat as THREE.Material & {
        skyUniforms?: {
          uTime: typeof uTime;
          uSunPosition: typeof uSunPosition;
          uDayCycleProgress: typeof uDayCycleProgress;
        };
      }
    ).skyUniforms = {
      uTime,
      uSunPosition,
      uDayCycleProgress,
    };

    this.skyMesh = new THREE.Mesh(skyGeom, skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.name = "AdvancedSkydome";
    this.group.add(this.skyMesh);
  }

  /**
   * Create instanced cloud billboards with TSL Node Material
   */
  private createClouds(): void {
    if (!this.group) return;
    const count = cloudData.length;
    const base = new THREE.PlaneGeometry(1, 1);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", base.attributes.position);
    geom.setAttribute("normal", base.attributes.normal);
    geom.setAttribute("uv", base.attributes.uv);
    geom.setIndex(base.index!);

    const positions = new Float32Array(count * 3);
    const textureNumber = new Float32Array(count);
    const distortionSpeed = new Float32Array(count);
    const distortionRange = new Float32Array(count);
    const scales = new Float32Array(count * 2);
    const offsets = new Float32Array(count * 2);
    const rotationY = new Float32Array(count);

    const CLOUD_RADIUS = 600;

    for (let i = 0; i < count; i++) {
      const c = cloudData[i];
      const theta = 2 * Math.PI * (c.positionIndex / 100);
      const x = Math.sin(theta) * CLOUD_RADIUS;
      const z = Math.cos(theta) * CLOUD_RADIUS;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = c.posY;
      positions[i * 3 + 2] = z;
      textureNumber[i] = c.textureNumber;
      distortionSpeed[i] = c.distortionSpeed;
      distortionRange[i] = (1 - c.distortionRange) * 2;
      scales[i * 2 + 0] = c.width;
      scales[i * 2 + 1] = c.height;
      rotationY[i] =
        -Math.sin(theta) * (Math.PI * 0.5) * (Math.cos(theta) > 0 ? 1 : -1);
      const cloudNum = c.cloudNumber;
      offsets[i * 2 + 0] = (cloudNum % 2) * 0.5;
      offsets[i * 2 + 1] = 0.75 - Math.floor(cloudNum / 2) * 0.25;
    }

    geom.setAttribute(
      "positions",
      new THREE.InstancedBufferAttribute(positions, 3),
    );
    geom.setAttribute(
      "textureNumber",
      new THREE.InstancedBufferAttribute(textureNumber, 1),
    );
    geom.setAttribute(
      "distortionSpeed",
      new THREE.InstancedBufferAttribute(distortionSpeed, 1),
    );
    geom.setAttribute(
      "distortionRange",
      new THREE.InstancedBufferAttribute(distortionRange, 1),
    );
    geom.setAttribute("scales", new THREE.InstancedBufferAttribute(scales, 2));
    geom.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 2));
    geom.setAttribute(
      "rotationY",
      new THREE.InstancedBufferAttribute(rotationY, 1),
    );

    // Create cloud TSL Node Material
    const uTime = uniform(float(0));
    const uSunPosition = uniform(vec3(0, 1, 0));
    const cloudRadius = float(850);

    // Use first cloud texture if available, otherwise create basic color
    const cloudMat = new MeshBasicNodeMaterial();

    const cloudColorNode = Fn(() => {
      const uvCoord = uv();
      const worldPos = positionWorld;

      // Sample cloud texture if available
      const cloudTexColor = this.cloud1
        ? texture(this.cloud1, uvCoord)
        : vec4(1.0, 1.0, 1.0, 0.5);

      // Sun/night color transition
      const sunNightStep = smoothstep(
        float(-0.3),
        float(0.25),
        div(uSunPosition.y, cloudRadius),
      );
      const cloudBrightColor = mix(
        vec3(0.141, 0.607, 0.94),
        vec3(1.0, 1.0, 1.0),
        sunNightStep,
      );
      const cloudDarkColor = mix(
        vec3(0.024, 0.32, 0.59),
        vec3(0.141, 0.807, 0.94),
        sunNightStep,
      );

      // Distance to sun for brightness
      const brightLerpSize = mul(cloudRadius, float(1.0));
      const sunDist = distance(worldPos, uSunPosition);
      const brightLerp = smoothstep(float(0.0), brightLerpSize, sunDist);
      const bright = mix(float(2.0), float(1.0), brightLerp);

      // Mix cloud colors based on texture
      const cloudColorLerp = cloudTexColor.r;
      let cloudColor = mul(
        mix(cloudDarkColor, cloudBrightColor, cloudColorLerp),
        bright,
      );
      cloudColor = add(
        cloudColor,
        mul(
          vec3(cloudTexColor.g, cloudTexColor.g, cloudTexColor.g),
          sub(float(1.0), brightLerp),
        ),
      );

      // Alpha from texture
      const cloudAlpha = cloudTexColor.a;

      return vec4(cloudColor, cloudAlpha);
    })();

    cloudMat.colorNode = cloudColorNode;
    cloudMat.side = THREE.DoubleSide;
    cloudMat.transparent = true;
    cloudMat.depthWrite = true;
    cloudMat.toneMapped = false;

    // Store uniforms for updates
    (
      cloudMat as THREE.Material & {
        cloudUniforms?: {
          uTime: typeof uTime;
          uSunPosition: typeof uSunPosition;
        };
      }
    ).cloudUniforms = {
      uTime,
      uSunPosition,
    };

    this.clouds = new THREE.InstancedMesh(geom, cloudMat, cloudData.length);
    this.clouds.count = cloudData.length;
    this.clouds.frustumCulled = false;
    this.clouds.name = "SkyClouds";

    // Set instance matrices using pre-allocated vectors to avoid loop allocations
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const c = cloudData[i];
      const theta = 2 * Math.PI * (c.positionIndex / 100);
      const x = Math.sin(theta) * CLOUD_RADIUS;
      const z = Math.cos(theta) * CLOUD_RADIUS;

      matrix.identity();
      matrix.makeRotationY(rotationY[i]);
      scaleVec.set(c.width, c.height, 1);
      matrix.scale(scaleVec);
      matrix.setPosition(x, c.posY, z);
      this.clouds.setMatrixAt(i, matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    this.group.add(this.clouds);
  }

  override update(delta: number): void {
    if (!this.group || !this.skyMesh) return;
    this.elapsed += delta;

    // Time-of-day (0..1)
    const worldTime = this.world.getTime();
    const dayPhase = (worldTime % this.dayDurationSec) / this.dayDurationSec;
    const isDay = dayPhase < 0.5;

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

    // Update sky material uniforms
    const skyMat = this.skyMesh.material as THREE.Material & {
      skyUniforms?: SkyMaterialUniforms;
    };
    if (skyMat.skyUniforms) {
      skyMat.skyUniforms.uTime.value = this.elapsed;
      skyMat.skyUniforms.uSunPosition.value.copy(this._sunDir);
      skyMat.skyUniforms.uDayCycleProgress.value = dayPhase;
    }

    // Update cloud material uniforms
    if (this.clouds) {
      const cloudMat = this.clouds.material as THREE.Material & {
        cloudUniforms?: CloudMaterialUniforms;
      };
      if (cloudMat.cloudUniforms) {
        cloudMat.cloudUniforms.uTime.value = this.elapsed;
        cloudMat.cloudUniforms.uSunPosition.value.set(
          this._sunDir.x * 850 + this.world.rig.position.x,
          this._sunDir.y * 850,
          this._sunDir.z * 850 + this.world.rig.position.z,
        );
      }

      if (this.sun) this.sun.renderOrder = 2;
      if (this.moon) this.moon.renderOrder = 2;
    }
  }

  override lateUpdate(_delta: number): void {
    if (!this.group) return;
    // Keep sky centered on rig for infinite effect
    this.group.position.x = this.world.rig.position.x;
    this.group.position.z = this.world.rig.position.z;
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
    this.sunMaterialUniforms = null;
    this.moonMaterialUniforms = null;
    this.group = null;
  }
}

export default SkySystem;
