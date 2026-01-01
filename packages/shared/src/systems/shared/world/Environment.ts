import THREE from "../../../extras/three/three";

import { Node as NodeClass } from "../../../nodes/Node";
import { System } from "..";

import { CSM } from "../../../libs/csm/CSM";
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

// Shadow settings - optimized for WebGPU
// maxFar should match fog distance (~150m) to avoid wasted shadow passes
const csmLevels = {
  none: {
    cascades: 1,
    shadowMapSize: 512,
    castShadow: false,
    lightIntensity: 3,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
    maxFar: 50,
  },
  low: {
    cascades: 1,
    shadowMapSize: 1024,
    castShadow: true,
    lightIntensity: 3,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
    maxFar: 80,
  },
  med: {
    cascades: 2,
    shadowMapSize: 1024,
    castShadow: true,
    lightIntensity: 1,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
    maxFar: 100,
  },
  high: {
    cascades: 3,
    shadowMapSize: 2048,
    castShadow: true,
    lightIntensity: 1,
    shadowBias: -0.0003,
    shadowNormalBias: 0.01,
    maxFar: 150,
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
 * - Handles Cascaded Shadow Maps (CSM) with configurable quality levels
 * - Manages dynamic fog (near/far distances, color)
 * - Responds to graphics settings changes (shadows, model swaps)
 * - Updates sky position to follow camera rig (infinite distance illusion)
 *
 * **Server** - Configuration Only
 * - Skips all 3D asset loading (no rendering needed)
 * - Tracks environment settings for client synchronization
 * - Minimal memory footprint (no textures, meshes, or CSM)
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
  csm!: CSM;
  skyInfo!: SkyInfo;
  private skySystem?: SkySystem;

  // Ambient lighting for day/night cycle
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
    // Build CSM immediately - stage should be ready by start()
    this.buildCSM();

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
    const fogNear = node?._fogNear ?? base.fogNear ?? 500;
    const fogFar = node?._fogFar ?? base.fogFar ?? 2000;
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

    if (this.csm) {
      this.csm.lightDirection = sunDirection || _sunDirection;

      if (this.csm.lights) {
        for (const light of this.csm.lights) {
          light.intensity = sunIntensity || 1;
          light.color.set(sunColor || "#ffffff");
        }
      }
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

    if (this.csm) {
      interface CSMWithDispose {
        dispose(): void;
      }
      (this.csm as unknown as CSMWithDispose).dispose();
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

      // Sync CSM directional light with sun position
      if (this.csm) {
        // Light direction is opposite of sun direction (light comes FROM the sun)
        this.csm.lightDirection.copy(this.skySystem.sunDirection).negate();

        // Adjust directional light intensity based on day/night
        const dayIntensity = this.skySystem.dayIntensity;
        if (this.csm.lights) {
          for (const light of this.csm.lights) {
            // Sun light fades to 0 at night, max 1.2 at noon
            light.intensity = dayIntensity * 1.2;
            // Warm color at sunrise/sunset, white at noon
            const sunsetFactor =
              Math.abs(this.skySystem.dayPhase - 0.25) < 0.1 ||
              Math.abs(this.skySystem.dayPhase - 0.75) < 0.1
                ? 0.5
                : 0;
            light.color.setRGB(
              1.0,
              1.0 - sunsetFactor * 0.2,
              1.0 - sunsetFactor * 0.4,
            );
          }
        }
      }

      // Update ambient lighting based on day/night
      this.updateAmbientLighting(this.skySystem.dayIntensity);
    }

    if (this.csm) {
      this.csm.update();
    }

    // Ensure sky sphere never writes depth (prevents cutting moon)
    if (this.sky) {
      const m = this.sky.material as THREE.MeshBasicMaterial;
      if (m.depthWrite !== false) m.depthWrite = false;
    }
  }

  /**
   * Update ambient lighting based on day/night cycle
   * @param dayIntensity 0-1 (0 = night, 1 = day)
   */
  private updateAmbientLighting(dayIntensity: number): void {
    const nightIntensity = 1 - dayIntensity;

    if (this.hemisphereLight) {
      // Hemisphere light: brighter during day, dimmer at night
      // Higher base intensity since we removed environment map
      this.hemisphereLight.intensity = 0.5 + dayIntensity * 0.5;

      // Shift sky color from blue (day) to dark blue (night)
      this.hemisphereLight.color.setRGB(
        0.53 * dayIntensity + 0.15 * nightIntensity, // R
        0.81 * dayIntensity + 0.2 * nightIntensity, // G
        0.92 * dayIntensity + 0.35 * nightIntensity, // B
      );

      // Ground color stays brownish but darker at night
      this.hemisphereLight.groundColor.setRGB(
        0.36 * dayIntensity + 0.12 * nightIntensity,
        0.27 * dayIntensity + 0.1 * nightIntensity,
        0.18 * dayIntensity + 0.12 * nightIntensity,
      );
    }

    if (this.ambientLight) {
      // Ambient fill: higher base since we removed env map
      // Night needs more ambient to see without harsh directional light
      this.ambientLight.intensity = 0.4 + nightIntensity * 0.3;

      // Warmer neutral during day, cool blue tint at night
      this.ambientLight.color.setRGB(
        0.5 + dayIntensity * 0.5,
        0.5 + dayIntensity * 0.45,
        0.55 + dayIntensity * 0.4,
      );
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
      0.8, // Higher intensity for better ambient
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

  buildCSM() {
    if (!this.isClientWithGraphics) return;

    const shadowsLevel = this.world.prefs?.shadows || "med";
    const options =
      csmLevels[shadowsLevel as keyof typeof csmLevels] || csmLevels.med;

    if (this.csm) {
      this.csm.updateCascades(options.cascades);
      this.csm.updateShadowMapSize(options.shadowMapSize);
      if (this.skyInfo) {
        this.csm.lightDirection = this.skyInfo.sunDirection;
        if (this.csm.lights) {
          for (const light of this.csm.lights) {
            light.intensity = this.skyInfo.sunIntensity;
            light.color.set(this.skyInfo.sunColor);
            light.castShadow = options.castShadow;
          }
        }
      }
    } else {
      if (!this.world.stage) {
        console.warn(
          "[Environment] Stage system not available yet, deferring CSM creation",
        );
        return;
      }

      const scene = this.world.stage.scene;
      const camera = this.world.camera;

      if (!scene) {
        console.error("[Environment] Scene is not a valid THREE.Scene:", scene);
        return;
      }

      console.log(`[Environment] Creating CSM with options:`, options);

      this.csm = new CSM({
        mode: "practical",
        maxCascades: options.cascades,
        maxFar: options.maxFar || 100,
        lightDirection: _sunDirection.normalize(),
        fade: true,
        parent: scene,
        camera: camera,
        castShadow: options.castShadow ?? true,
        shadowMapSize: options.shadowMapSize,
        shadowBias: options.shadowBias,
        shadowNormalBias: options.shadowNormalBias,
        lightIntensity: options.lightIntensity,
      });

      console.log(
        `[Environment] CSM created with ${this.csm.lights.length} lights`,
      );
      for (let i = 0; i < this.csm.lights.length; i++) {
        const light = this.csm.lights[i];
        console.log(
          `[Environment] Light ${i}: castShadow=${light.castShadow}, intensity=${light.intensity}, shadow bias=${light.shadow.bias}`,
        );
      }

      if (!options.castShadow) {
        for (const light of this.csm.lights) {
          light.castShadow = false;
        }
      }
    }
  }

  onSettingsChange = (changes: { model?: string | { url?: string } }) => {
    if (changes.model) {
      this.updateModel();
    }
  };

  onPrefsChange = (changes: { shadows?: string }) => {
    if (changes.shadows) {
      this.buildCSM();
      this.updateSky();
    }
  };

  onViewportResize = () => {
    if (this.csm) {
      this.csm.updateFrustums();
    }
  };
}
