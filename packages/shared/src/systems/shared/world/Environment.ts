import THREE, { CSMShadowNode } from "../../../extras/three/three";

import { Node as NodeClass } from "../../../nodes/Node";
import { System } from "..";

import { SkySystem } from "..";
import type {
  BaseEnvironment,
  EnvironmentModel,
  LoadedModel,
  LoaderResult,
  SkyHandle,
  SkyInfo,
  SkyNode,
  World,
  WorldOptions,
} from "../../../types/index";

const _sunDirection = new THREE.Vector3(0, -1, 0);

// Strong type casting helpers - assume types are correct
function asString(value: unknown): string {
  return value as string;
}

// CSM Shadow configuration per quality level
//
// RESOLUTION MATH:
// Each cascade covers (maxFar / cascades) meters with shadowMapSize pixels
// Example: maxFar=100, cascades=2, size=2048 → first cascade covers ~30m with 2048px = ~15px/meter
// A 0.5m character needs ~7-8 pixels to cast a visible shadow
//
// SHADOW STABILITY NOTES:
// - lightMargin: Padding around frustum (50-100 is usually enough)
// - shadowBias: Small positive value prevents self-shadowing (0.0001-0.001)
// - shadowNormalBias: Offsets along normal for curved surfaces (0.005-0.02)
// - More cascades = better near/far resolution but more draw calls
//
// IMPORTANT: Vegetation fade distances should be <= maxFar so trees don't appear unshadowed
export const csmLevels = {
  none: {
    enabled: false,
    shadowMapSize: 0,
    cascades: 1,
    maxFar: 50,
    shadowBias: 0.0003,
    shadowNormalBias: 0.01,
    lightMargin: 50,
  },
  low: {
    enabled: true,
    shadowMapSize: 2048,
    cascades: 2, // 2 cascades: near (~25m high-res) + far (~75m)
    maxFar: 200, // Reduced from 150 for better resolution
    shadowBias: 0.0002, // Lower bias so small object shadows appear
    shadowNormalBias: 0.01,
    lightMargin: 50,
  },
  med: {
    enabled: true,
    shadowMapSize: 2048,
    cascades: 3, // 3 cascades for better distribution
    maxFar: 350, // Reasonable distance
    shadowBias: 0.00015,
    shadowNormalBias: 0.008,
    lightMargin: 60,
  },
  high: {
    enabled: true,
    shadowMapSize: 2048, // Higher resolution for sharp shadows
    cascades: 4, // 4 cascades for excellent near/far balance
    maxFar: 1000, // Don't need shadows beyond 200m
    shadowBias: 0.0001,
    shadowNormalBias: 0.005,
    lightMargin: 80,
  },
};

/**
 * Environment System
 *
 * Handles environment setup for all runtime contexts with conditional branching
 * based on runtime capabilities. Works in both browser and server contexts.
 *
 * Runtime Modes:
 *
 * **Client (Browser)** - Full 3D Rendering
 * - Loads and renders 3D environment models (.glb)
 * - Manages sky sphere with equirectangular texture mapping
 * - Controls HDR environment lighting
 * - Handles directional sun/moon lighting with configurable shadow quality
 * - Manages dynamic fog (near/far distances, color)
 * - Responds to graphics settings changes (shadows, model swaps)
 * - Updates sky position to follow camera rig (infinite distance illusion)
 *
 * **Server** - Configuration Only
 * - Skips all 3D asset loading (no rendering needed)
 * - Tracks environment settings for client synchronization
 * - Minimal memory footprint (no textures, meshes, or lights)
 * - Listens to settings changes to propagate to clients
 *
 * **Node Client (Bots)** - Headless
 * - No rendering capabilities (headless automation)
 * - Compatible interface so World doesn't require environment checks
 * - Used by ServerBot instances for automated testing
 *
 * Implementation:
 * All methods check `this.isClientWithGraphics` (computed during init):
 * - `true`: Browser with `window` object → full rendering pipeline
 * - `false`: Server or Node → early return, skip 3D operations
 */
export class Environment extends System {
  base!: BaseEnvironment;
  model: EnvironmentModel | null = null;
  skys: SkyHandle[] = [];
  sky: THREE.Mesh | null = null;
  skyN: number = 0;
  bgUrl?: string;
  hdrUrl?: string;
  skyInfo!: SkyInfo;
  private skySystem?: SkySystem;

  // Main directional light (sun/moon) with CSM shadow support
  public sunLight: THREE.DirectionalLight | null = null;
  public lightDirection: THREE.Vector3 = new THREE.Vector3(0, -1, 0);

  // Shadow stabilization - prevents flickering/swimming
  private targetLightDirection: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
  private lastLightAnchor: THREE.Vector3 = new THREE.Vector3(); // Snapped position
  private shadowTexelSize: number = 0; // For texel snapping calculation
  private readonly LIGHT_DISTANCE = 400; // Distance from target to light

  // CSMShadowNode for WebGPU cascaded shadows
  private csmShadowNode: InstanceType<typeof CSMShadowNode> | null = null;

  // CSM frustum update optimization - only recalculate when needed
  // Set to true on: viewport resize, camera near/far change, CSM config change
  private needsFrustumUpdate: boolean = true;
  private csmNeedsAttach: boolean = false; // True until CSM shadowNode is attached to light

  // Ambient lighting for day/night cycle (non-shadow casting)
  private hemisphereLight: THREE.HemisphereLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  private isClientWithGraphics: boolean = false;

  constructor(world: World) {
    super(world);
  }

  override init(
    options: WorldOptions & { baseEnvironment?: BaseEnvironment },
  ): Promise<void> {
    this.base = options.baseEnvironment || {};

    // Determine if this is a client with graphics capabilities
    this.isClientWithGraphics =
      !!this.world.isClient && typeof window !== "undefined";

    return Promise.resolve();
  }

  override async start() {
    if (!this.isClientWithGraphics) {
      // Server or Node client - skip 3D rendering setup

      // Still watch for settings changes (for server to track what clients should use)
      this.world.settings?.on("change", this.onSettingsChange);
      return;
    }

    // Client with graphics - full environment setup
    // Create sun light immediately - stage should be ready by start()
    this.buildSunLight();

    // Create ambient lighting for day/night visibility
    this.createAmbientLighting();

    this.updateSky();

    // Load initial model (non-blocking - don't let model errors break sky)
    try {
      await this.updateModel();
    } catch (err) {
      console.warn(
        "[Environment] Failed to load model (continuing without):",
        err,
      );
    }

    // Enhanced dynamic sky (client-only) - must run even if model fails
    this.skySystem = new SkySystem(this.world);
    await this.skySystem.init({} as unknown as WorldOptions);
    this.skySystem.start();
    // Ensure legacy sky sphere never occludes dynamic sky
    if (this.sky) {
      const mat = this.sky.material as THREE.MeshBasicMaterial;
      mat.depthWrite = false;
      this.sky.visible = false;
    }
    // Re-evaluate sky state now that SkySystem exists
    await this.updateSky();

    // No environment map - using planar reflections for water, toon/rough style for everything else
    if (this.world.stage?.scene) {
      this.world.stage.scene.environment = null;
    }

    this.world.settings?.on("change", this.onSettingsChange);
    this.world.prefs?.on("change", this.onPrefsChange);

    if (this.world.graphics) {
      this.world.graphics.on("resize", this.onViewportResize);
    }
  }

  async updateModel() {
    if (!this.isClientWithGraphics) {
      // Server/Node - skip model loading (no rendering)
      return;
    }

    const modelSetting = this.world.settings?.model;
    const url =
      asString(modelSetting) ||
      (modelSetting as { url?: string })?.url ||
      this.base.model;
    if (!url) return;

    let glb = this.world.loader?.get("model", url);
    if (!glb)
      glb = (await this.world.loader?.load("model", url)) as
        | LoaderResult
        | undefined;
    if (!glb) return;

    if (this.model) this.model.deactivate();

    if (glb && "toNodes" in glb) {
      const nodesResult = (glb as LoadedModel).toNodes();
      const nodes = nodesResult as Map<string, NodeClass> | EnvironmentModel;
      const environmentModel = nodes as EnvironmentModel;

      if (
        nodes &&
        "activate" in environmentModel &&
        "deactivate" in environmentModel
      ) {
        this.model = environmentModel;
        this.model.activate({ world: this.world, label: "base" });
      } else if (nodes && nodes instanceof Map) {
        const nodeMap = nodes as Map<string, NodeClass>;
        this.model = {
          deactivate: () => {
            for (const node of nodeMap.values()) {
              if (node && node.deactivate) {
                node.deactivate();
              }
            }
          },
          activate: (options: { world: World; label: string }) => {
            for (const node of nodeMap.values()) {
              if (node && node.activate) {
                node.activate(options.world);
              } else if (node && options.world.stage) {
                options.world.stage.add(node);
              }
            }
          },
        };
        this.model.activate({ world: this.world, label: "base" });
      } else {
        this.model = null;
      }
    } else {
      this.model = null;
    }
  }

  addSky(node: SkyNode) {
    if (!this.isClientWithGraphics) return { destroy: () => {} };

    const handle: SkyHandle = {
      node,
      destroy: () => {
        const idx = this.skys.indexOf(handle);
        if (idx === -1) return;
        this.skys.splice(idx, 1);
        this.updateSky();
      },
    };
    this.skys.push(handle);
    this.updateSky();
    return handle;
  }

  getSky() {}

  async updateSky() {
    if (!this.isClientWithGraphics) return;

    // Check if stage is available
    if (!this.world.stage || !this.world.stage.scene) {
      console.warn(
        "[Environment] Stage not available for updateSky, deferring...",
      );
      setTimeout(() => this.updateSky(), 100);
      return;
    }

    if (!this.sky) {
      const geometry = new THREE.SphereGeometry(1000, 60, 40);
      const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
      this.sky = new THREE.Mesh(geometry, material);
      this.sky.geometry.computeBoundsTree();
      const skyMaterial = this.sky.material as THREE.MeshBasicMaterial;
      skyMaterial.fog = false;
      skyMaterial.toneMapped = false;
      skyMaterial.needsUpdate = true;
      this.sky.matrixAutoUpdate = false;
      this.sky.matrixWorldAutoUpdate = false;
      this.sky.visible = false;
      // PERFORMANCE: Set legacy sky to layer 1 (main camera only, not minimap)
      this.sky.layers.set(1);
      this.world.stage.scene.add(this.sky);
    }

    const base = this.base;
    const node = this.skys[this.skys.length - 1]?.node;
    const bgUrl = node?._bg || base.bg;
    const hdrUrl = node?._hdr || base.hdr;
    const sunDirection = node?._sunDirection || base.sunDirection;

    const sunIntensity = node?._sunIntensity ?? base.sunIntensity;
    const sunColor = node?._sunColor ?? base.sunColor;
    // Default fog for atmosphere - warm fog affecting terrain and models
    // Closer fog distances create more atmospheric depth and hide distant terrain pop-in
    const fogNear = node?._fogNear ?? base.fogNear ?? 350;
    const fogFar = node?._fogFar ?? base.fogFar ?? 600;
    const fogColor = node?._fogColor ?? base.fogColor ?? "#d4c8b8";

    const n = ++this.skyN;
    // Load textures (kept for potential future use, currently SkySystem is active)
    let _bgTexture;
    if (bgUrl) _bgTexture = await this.world.loader?.load("texture", bgUrl);
    let _hdrTexture;
    if (hdrUrl) _hdrTexture = await this.world.loader?.load("hdr", hdrUrl);
    if (n !== this.skyN) return;

    // When using SkySystem, completely remove the legacy sky sphere from scene
    // Just hiding it isn't enough - it can still interfere with planar reflections
    this.sky.visible = false;
    if (this.sky.parent) {
      this.sky.parent.remove(this.sky);
    }
    // Completely remove environment map when using SkySystem
    // This ensures planar reflections don't pick up the HDR
    this.world.stage.scene.environment = null;
    this.world.stage.scene.background = null;

    // Set initial light direction and apply to sun light
    this.lightDirection.copy(sunDirection || _sunDirection);
    if (this.sunLight) {
      this.sunLight.intensity = sunIntensity || 1;
      this.sunLight.color.set(sunColor || "#ffffff");
    }

    // Always apply fog with defaults
    const color = new THREE.Color(fogColor);
    this.world.stage.scene.fog = new THREE.Fog(
      color,
      fogNear as number,
      fogFar as number,
    );
    console.log(
      `[Environment] Fog applied: near=${fogNear}, far=${fogFar}, color=${fogColor}`,
    );

    this.skyInfo = {
      bgUrl,
      hdrUrl,
      sunDirection: sunDirection || _sunDirection,
      sunIntensity: sunIntensity || 1,
      sunColor: sunColor || "#ffffff",
      fogNear,
      fogFar,
      fogColor,
    };
  }

  override destroy(): void {
    if (this.skySystem) {
      this.skySystem.destroy();
      this.skySystem = undefined;
    }
    this.world.settings?.off("change", this.onSettingsChange);
    this.world.prefs?.off("change", this.onPrefsChange);

    if (!this.isClientWithGraphics) return;

    if (this.world.graphics) {
      this.world.graphics.off("resize", this.onViewportResize);
    }

    // Dispose sky mesh and textures
    if (this.sky) {
      const material = this.sky.material as THREE.Material & {
        map?: THREE.Texture | null;
      };
      if (material && "map" in material && material.map) {
        material.map.dispose();
        // NOTE: Don't set material.map = null - let Three.js/GC handle it
        // Setting it to null causes WebGPU texture cache corruption
        // with dual-renderer setup (main + minimap share scene)
      }
      if (Array.isArray(this.sky.material)) {
        this.sky.material.forEach((m) => m.dispose());
      } else {
        (this.sky.material as THREE.Material).dispose();
      }
      this.sky.geometry.dispose();
      if (this.sky.parent) this.sky.parent.remove(this.sky);
      this.sky = null;
    }

    if (
      this.world.stage?.scene?.environment &&
      this.world.stage.scene.environment instanceof THREE.Texture
    ) {
      this.world.stage.scene.environment.dispose();
      this.world.stage.scene.environment = null;
    }

    // Dispose sun light and CSM
    if (this.csmShadowNode) {
      this.csmShadowNode.dispose();
      this.csmShadowNode = null;
    }
    if (this.sunLight) {
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
      }
      if (this.sunLight.parent) {
        this.sunLight.parent.remove(this.sunLight.target);
        this.sunLight.parent.remove(this.sunLight);
      }
      this.sunLight.dispose();
      this.sunLight = null;
    }

    // Dispose ambient lights
    if (this.hemisphereLight) {
      if (this.hemisphereLight.parent) {
        this.hemisphereLight.parent.remove(this.hemisphereLight);
      }
      this.hemisphereLight.dispose();
      this.hemisphereLight = null;
    }

    if (this.ambientLight) {
      if (this.ambientLight.parent) {
        this.ambientLight.parent.remove(this.ambientLight);
      }
      this.ambientLight.dispose();
      this.ambientLight = null;
    }

    this.skys = [];
    this.model = null;
  }

  override update(_delta: number) {
    if (!this.isClientWithGraphics) return;

    // Update sky system first to get current sun position
    if (this.skySystem) {
      this.skySystem.update(_delta);

      // Sync directional light (sun/moon) with sky position
      if (this.sunLight) {
        const dayIntensity = this.skySystem.dayIntensity;
        const isDay = this.skySystem.isDay;
        const dayPhase = this.skySystem.dayPhase;

        // ===================
        // TRANSITION FADE - fade light out during sun/moon swap
        // ===================
        const DAWN_START = 0.22;
        const DAWN_MID = 0.25;
        const DAWN_END = 0.28;
        const DUSK_START = 0.72;
        const DUSK_MID = 0.75;
        const DUSK_END = 0.78;

        let transitionFade = 1.0;
        if (dayPhase >= DAWN_START && dayPhase < DAWN_MID) {
          transitionFade =
            1.0 - (dayPhase - DAWN_START) / (DAWN_MID - DAWN_START);
        } else if (dayPhase >= DAWN_MID && dayPhase < DAWN_END) {
          transitionFade = (dayPhase - DAWN_MID) / (DAWN_END - DAWN_MID);
        } else if (dayPhase >= DUSK_START && dayPhase < DUSK_MID) {
          transitionFade =
            1.0 - (dayPhase - DUSK_START) / (DUSK_MID - DUSK_START);
        } else if (dayPhase >= DUSK_MID && dayPhase < DUSK_END) {
          transitionFade = (dayPhase - DUSK_MID) / (DUSK_END - DUSK_MID);
        }
        transitionFade =
          transitionFade * transitionFade * (3 - 2 * transitionFade); // smoothstep

        // ===================
        // LIGHT DIRECTION - Track sun during day, moon during night
        // Use target direction + interpolation to prevent sudden jumps
        // ===================
        if (isDay) {
          // Daytime: light comes FROM the sun (negate sunDirection which points TO sun)
          this.targetLightDirection.copy(this.skySystem.sunDirection).negate();
        } else {
          // Nighttime: light comes FROM the moon (at -sunDirection position)
          this.targetLightDirection.copy(this.skySystem.sunDirection);
        }

        // Smooth interpolation to prevent sudden direction changes causing flicker
        // Lerp factor of 0.02 = ~50 frames to reach target (smooth over ~1 second at 60fps)
        this.lightDirection.lerp(this.targetLightDirection, 0.02);

        // ===================
        // LIGHT INTENSITY & COLOR - Single light, simple and correct
        // ===================
        if (isDay) {
          // Sunlight - warm golden light
          const sunIntensity = dayIntensity * 1.8 * transitionFade;
          this.sunLight.intensity = sunIntensity;

          // Golden hour coloring near horizon
          const nearHorizon =
            (dayPhase >= 0.22 && dayPhase < 0.32) ||
            (dayPhase >= 0.68 && dayPhase < 0.78);
          if (nearHorizon) {
            this.sunLight.color.setRGB(1.0, 0.85, 0.6);
          } else {
            this.sunLight.color.setRGB(1.0, 0.98, 0.92);
          }
        } else {
          // Moonlight - cool blue light
          const nightIntensity = 1 - dayIntensity;
          const moonIntensity = nightIntensity * 0.4 * transitionFade;
          this.sunLight.intensity = moonIntensity;
          this.sunLight.color.setRGB(0.6, 0.7, 0.9);
        }

        // ===================
        // UPDATE LIGHT POSITION - Follow camera for consistent shadows
        // ===================
        this.updateSunLightPosition();
      }

      // Update ambient lighting based on day/night
      this.updateAmbientLighting(this.skySystem.dayIntensity);

      // Update fog color based on day/night cycle
      this.updateFogColor(this.skySystem.dayIntensity);
    }

    // Ensure sky sphere never writes depth (prevents cutting moon)
    if (this.sky) {
      const m = this.sky.material as THREE.MeshBasicMaterial;
      if (m.depthWrite !== false) m.depthWrite = false;
    }
  }

  /**
   * Update sun light position to follow camera for consistent shadow coverage.
   *
   * SHADOW STABILIZATION:
   * Shadow flickering/swimming is caused by the shadow map being rendered from
   * slightly different positions each frame. To fix this:
   *
   * 1. TEXEL SNAPPING: Snap light position to shadow map texel boundaries
   *    This ensures the shadow map samples the same world positions each frame
   *
   * 2. SMOOTH DIRECTION: Light direction is interpolated (in update()), not instant
   */
  private updateSunLightPosition(): void {
    if (!this.sunLight) return;

    // Get camera position (where shadows should be centered)
    const cameraPos = this.world.camera.position;

    // Calculate shadow texel size for snapping (based on shadow map coverage / resolution)
    // This needs to match the shadow camera frustum size
    const shadowMapSize = this.sunLight.shadow.mapSize.x || 2048;
    const shadowCam = this.sunLight.shadow.camera;
    const frustumWidth = shadowCam.right - shadowCam.left;
    this.shadowTexelSize = frustumWidth / shadowMapSize;

    // TEXEL SNAPPING: Round to shadow texel grid to prevent sub-texel swimming
    // This ensures shadows sample the same world positions regardless of tiny camera movements
    const texelSize = Math.max(this.shadowTexelSize, 0.1);
    this.lastLightAnchor.x = Math.round(cameraPos.x / texelSize) * texelSize;
    this.lastLightAnchor.y = cameraPos.y;
    this.lastLightAnchor.z = Math.round(cameraPos.z / texelSize) * texelSize;

    // Position light using stabilized anchor, not raw camera position
    // Light is positioned OPPOSITE to light direction (light comes FROM this position)
    this.sunLight.position.set(
      this.lastLightAnchor.x - this.lightDirection.x * this.LIGHT_DISTANCE,
      this.lastLightAnchor.y -
        this.lightDirection.y * this.LIGHT_DISTANCE +
        100,
      this.lastLightAnchor.z - this.lightDirection.z * this.LIGHT_DISTANCE,
    );

    // Target is the stabilized anchor point
    this.sunLight.target.position.copy(this.lastLightAnchor);
    this.sunLight.target.updateMatrixWorld();

    // Update CSM frustums only when needed (expensive operation)
    // Frustum recalculation is needed on: viewport resize, camera near/far change
    // Light position updates do NOT require frustum recalculation
    if (
      this.csmShadowNode &&
      this.needsFrustumUpdate &&
      this.csmShadowNode.camera
    ) {
      // Ensure camera projection is up to date before frustum calculation
      this.world.camera.updateProjectionMatrix();
      try {
        this.csmShadowNode.updateFrustums();
        this.needsFrustumUpdate = false;

        // After successful frustum init, attach shadowNode to light
        // We defer this because CSM shader will crash if frustums aren't initialized
        if (this.csmNeedsAttach && this.sunLight) {
          (
            this.sunLight.shadow as THREE.DirectionalLightShadow & {
              shadowNode?: InstanceType<typeof CSMShadowNode>;
            }
          ).shadowNode = this.csmShadowNode;
          this.csmNeedsAttach = false;
          console.log("[Environment] CSM shadowNode attached to light");
        }
      } catch (err) {
        // CSMShadowNode.updateFrustums() can fail if camera projection isn't ready yet
        // Will retry on next update() - this is expected during startup
        console.debug(
          "[Environment] CSM frustum update deferred - camera not ready",
        );
      }
    }
  }

  /**
   * Update ambient lighting based on day/night cycle
   * @param dayIntensity 0-1 (0 = night, 1 = day)
   */
  private updateAmbientLighting(dayIntensity: number): void {
    const nightIntensity = 1 - dayIntensity;

    if (this.hemisphereLight) {
      // Hemisphere light: brighter during day, dim but visible at night
      // Day: 0.9, Night: 0.25 (enough to see terrain/objects clearly)
      this.hemisphereLight.intensity = 0.25 + dayIntensity * 0.65;

      // Shift sky color from bright blue (day) to dark blue (night)
      this.hemisphereLight.color.setRGB(
        0.53 * dayIntensity + 0.1 * nightIntensity, // R: slight visibility at night
        0.81 * dayIntensity + 0.15 * nightIntensity, // G: slight visibility at night
        0.92 * dayIntensity + 0.25 * nightIntensity, // B: blue tint at night
      );

      // Ground color: warm brown during day, dark blue-brown at night
      this.hemisphereLight.groundColor.setRGB(
        0.36 * dayIntensity + 0.06 * nightIntensity,
        0.27 * dayIntensity + 0.05 * nightIntensity,
        0.18 * dayIntensity + 0.08 * nightIntensity,
      );
    }

    if (this.ambientLight) {
      // Ambient fill: provides base visibility
      // Day: 0.4, Night: 0.18 (can see things clearly in moonlight)
      this.ambientLight.intensity = 0.18 + dayIntensity * 0.22;

      // Day: warm neutral white, Night: cool blue moonlight tint
      this.ambientLight.color.setRGB(
        0.35 + dayIntensity * 0.65, // R: 0.35 at night, 1.0 at day
        0.4 + dayIntensity * 0.55, // G: 0.4 at night, 0.95 at day
        0.55 + dayIntensity * 0.4, // B: 0.55 at night, 0.95 at day (bluer at night)
      );
    }
  }

  // Day fog color: warm beige
  private readonly dayFogColor = new THREE.Color(0xd4c8b8);
  // Night fog color: dark blue to blend with night sky (slightly lighter for visibility)
  private readonly nightFogColor = new THREE.Color(0x2b3445);
  // Blended fog color (updated each frame)
  private readonly blendedFogColor = new THREE.Color();

  /**
   * Update fog color based on day/night cycle
   * Day: warm beige fog
   * Night: dark blue fog that blends with the night sky/horizon
   * @param dayIntensity 0-1 (0 = night, 1 = day)
   */
  private updateFogColor(dayIntensity: number): void {
    if (!this.world.stage?.scene) return;

    // Lerp between night fog (dark blue) and day fog (warm beige)
    this.blendedFogColor.lerpColors(
      this.nightFogColor,
      this.dayFogColor,
      dayIntensity,
    );

    // Update scene fog color
    const sceneFog = this.world.stage.scene.fog as THREE.Fog | null;
    if (sceneFog) {
      sceneFog.color.copy(this.blendedFogColor);
    }

    // Update skyInfo so terrain shader can sync the fog color
    if (this.skyInfo) {
      this.skyInfo.fogColor = `#${this.blendedFogColor.getHexString()}`;
    }
  }

  override lateUpdate(_delta: number) {
    if (!this.isClientWithGraphics) return;
    if (this.skySystem) {
      this.skySystem.lateUpdate(_delta);
    }
    if (!this.sky) return;

    this.sky.position.x = this.world.rig.position.x;
    this.sky.position.z = this.world.rig.position.z;
    this.sky.matrixWorld.setPosition(this.sky.position);
  }

  /**
   * Create ambient lighting for proper day/night visibility
   * - HemisphereLight: Sky/ground ambient (always on, provides base visibility)
   * - AmbientLight: Flat ambient fill (stronger at night)
   */
  private createAmbientLighting(): void {
    if (!this.isClientWithGraphics || !this.world.stage?.scene) return;

    const scene = this.world.stage.scene;

    // Hemisphere light - sky color from above, ground color from below
    // Provides natural ambient lighting that varies with direction
    this.hemisphereLight = new THREE.HemisphereLight(
      0x87ceeb, // Sky color (light blue)
      0x5d4837, // Ground color (warm brown)
      0.5, // Higher intensity for better ambient
    );
    this.hemisphereLight.name = "EnvironmentHemisphereLight";
    scene.add(this.hemisphereLight);

    // Ambient light - flat fill light for base visibility
    // Ensures objects are never completely black (especially important without env map)
    this.ambientLight = new THREE.AmbientLight(
      0x606070, // Neutral with slight cool tint
      0.5, // Higher intensity since we removed env map
    );
    this.ambientLight.name = "EnvironmentAmbientLight";
    scene.add(this.ambientLight);
  }

  /**
   * Build directional light (sun/moon) with CSMShadowNode for WebGPU cascaded shadows
   * CSMShadowNode handles cascade splitting internally - we just configure it
   */
  buildSunLight(): void {
    if (!this.isClientWithGraphics) return;

    const shadowsLevel = this.world.prefs?.shadows || "med";
    const csmConfig =
      csmLevels[shadowsLevel as keyof typeof csmLevels] || csmLevels.med;

    if (!this.world.stage?.scene) {
      console.warn(
        "[Environment] Stage not available yet, deferring sun light creation",
      );
      return;
    }

    const scene = this.world.stage.scene;

    // Dispose existing light and CSM
    if (this.csmShadowNode) {
      this.csmShadowNode.dispose();
      this.csmShadowNode = null;
    }
    if (this.sunLight) {
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
      }
      if (this.sunLight.parent) {
        this.sunLight.parent.remove(this.sunLight.target);
        this.sunLight.parent.remove(this.sunLight);
      }
      this.sunLight.dispose();
      this.sunLight = null;
    }

    if (!csmConfig.enabled) {
      console.log("[Environment] Shadows disabled for level:", shadowsLevel);
      return;
    }

    // Create directional light for CSM
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sunLight.name = "SunLight_CSM";
    this.sunLight.castShadow = true;

    // Shadow map settings (CSMShadowNode will use this as base resolution per cascade)
    this.sunLight.shadow.mapSize.width = csmConfig.shadowMapSize;
    this.sunLight.shadow.mapSize.height = csmConfig.shadowMapSize;
    this.sunLight.shadow.bias = csmConfig.shadowBias;
    this.sunLight.shadow.normalBias = csmConfig.shadowNormalBias;

    // Shadow camera settings
    // CSMShadowNode overrides these per-cascade, but we set reasonable defaults
    // The frustum size here is for a single cascade - CSM will adjust for each cascade
    const shadowCam = this.sunLight.shadow.camera;
    shadowCam.near = 0.5;
    shadowCam.far = this.LIGHT_DISTANCE + 200; // Light distance + scene depth
    // Base frustum - CSMShadowNode will manage actual cascade frustums
    // Keep this reasonable so non-CSM fallback works
    const baseFrustumSize = 100;
    shadowCam.left = -baseFrustumSize;
    shadowCam.right = baseFrustumSize;
    shadowCam.top = baseFrustumSize;
    shadowCam.bottom = -baseFrustumSize;
    shadowCam.updateProjectionMatrix();

    // Initial position
    this.sunLight.position.set(100, 200, 100);
    this.sunLight.target.position.set(0, 0, 0);

    // Create CSMShadowNode for WebGPU cascaded shadows
    // Light direction is derived from sunLight.position and sunLight.target.position
    this.csmShadowNode = new CSMShadowNode(this.sunLight, {
      cascades: csmConfig.cascades,
      maxFar: csmConfig.maxFar,
      mode: "practical", // Practical split gives good near/far balance
      lightMargin: csmConfig.lightMargin, // Prevents shadow "swimming" artifacts
    });

    // CRITICAL: Assign camera for frustum calculations
    // Without this, CSM cannot properly calculate cascade splits
    this.csmShadowNode.camera = this.world.camera;

    // Enable smooth cascade transitions (prevents hard seams between cascades)
    this.csmShadowNode.fade = true;

    // Defer frustum initialization AND shadowNode assignment to first update() call
    // CSMShadowNode.updateFrustums() requires the camera's projection matrix to be valid,
    // but at start() time the camera may not be fully configured yet.
    // We MUST NOT assign shadowNode until frustums are initialized, otherwise the
    // renderer will try to use an uninitialized CSM and crash.
    this.needsFrustumUpdate = true;
    this.csmNeedsAttach = true;

    // Add light to scene (but without shadowNode - will be attached after frustum init)
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    console.log(
      `[Environment] CSM created: ${csmConfig.cascades} cascades, maxFar=${csmConfig.maxFar}, mapSize=${csmConfig.shadowMapSize} (pending frustum init)`,
    );
  }

  onSettingsChange = (changes: { model?: string | { url?: string } }) => {
    if (changes.model) {
      this.updateModel();
    }
  };

  onPrefsChange = (changes: { shadows?: string }) => {
    if (changes.shadows) {
      this.buildSunLight();
      this.updateSky();
    }
  };

  onViewportResize = () => {
    // CSM frustums need recalculation when viewport/camera changes
    this.needsFrustumUpdate = true;
  };
}
