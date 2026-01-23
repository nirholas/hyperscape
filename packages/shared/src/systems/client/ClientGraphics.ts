/**
 * ClientGraphics.ts - 3D Graphics Rendering System
 *
 * Manages WebGPU rendering for the 3D game world.
 * Handles viewport, shadows, post-processing, and frame rendering.
 *
 * Key Features:
 * - **WebGPU Rendering**: Native WebGPU with TSL post-processing
 * - **Shadow Mapping**: Cascaded shadow maps (CSM) for dynamic shadows
 * - **Post-Processing**: TSL-based bloom, tone mapping, and effects
 * - **Adaptive Quality**: Auto-adjusts shadow quality based on performance
 * - **Anisotropic Filtering**: Texture filtering for better quality
 * - **HDR Rendering**: High dynamic range for realistic lighting
 *
 * Rendering Pipeline:
 * 1. Pre-render: Update matrices, frustum culling
 * 2. Shadow Pass: Render shadow maps for each light
 * 3. Main Pass: Render scene to screen
 * 4. Post-Processing: Apply bloom, tone mapping, etc.
 * 5. UI Overlay: Render 2D UI on top
 *
 * Shadow Configuration:
 * - Cascaded Shadow Maps (CSM) for large view distances
 * - 3 cascades: near (high res), medium, far (low res)
 * - PCF soft shadows for smooth edges
 * - Shadow bias to prevent acne artifacts
 *
 * Post-Processing Effects:
 * - **Bloom**: Glowing bright areas for magical effects (TSL-based)
 * - **Tone Mapping**: HDR to LDR conversion
 * - **Color Grading**: Adjust colors for atmosphere
 *
 * Performance Optimization:
 * - Frustum culling: Don't render off-screen objects
 * - LOD system: Lower detail for distant objects
 * - Instanced rendering: Batch identical objects
 * - Occlusion culling: Skip objects behind walls
 * - Adaptive shadow quality: Reduce resolution under load
 *
 * Usage:
 * ```typescript
 * // Graphics system auto-initializes
 * const graphics = world.getSystem('graphics');
 *
 * // Toggle post-processing
 * graphics.setPostProcessing(true);
 *
 * // Adjust shadow quality
 * graphics.setShadowQuality('high');
 *
 * // Get current FPS
 * const fps = graphics.getFPS();
 * ```
 *
 * Related Systems:
 * - ClientCameraSystem: Provides camera for rendering
 * - Environment: Lighting and skybox
 * - LODs: Level-of-detail mesh swapping
 * - Stage: three.js scene graph
 *
 * Dependencies:
 * - three.js WebGPU: 3D rendering library
 * - TSL: Three Shading Language for post-processing
 * - Stage system: Scene graph
 * - Camera system: View/projection matrices
 *
 * @see RendererFactory.ts for WebGPU creation
 * @see PostProcessingFactory.ts for TSL-based effects setup
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";
import { EventType } from "../../types/events";
import { System } from "../shared/infrastructure/System";
import {
  createRenderer,
  configureRenderer,
  configureShadowMaps,
  getMaxAnisotropy,
  isWebGPURenderer,
  type UniversalRenderer,
  logWebGPUInfo,
  getWebGPUCapabilities,
} from "../../utils/rendering/RendererFactory";
import {
  createPostProcessing,
  type PostProcessingComposer,
} from "../../utils/rendering/PostProcessingFactory";

let renderer: UniversalRenderer | undefined;

async function getRenderer(): Promise<UniversalRenderer> {
  if (!renderer) {
    renderer = await createRenderer({
      powerPreference: "high-performance",
      antialias: true,
    });
  }
  return renderer;
}

/**
 * Get the shared WebGPU renderer instance
 * @returns The renderer or undefined if not initialized
 */
export function getSharedRenderer(): UniversalRenderer | undefined {
  return renderer;
}

/**
 * Client Graphics System
 *
 * Manages 3D rendering for the game world using WebGPU.
 * Runs only on client (browser).
 */
export class ClientGraphics extends System {
  // Properties
  renderer!: UniversalRenderer;
  viewport!: HTMLElement;
  maxAnisotropy!: number;
  usePostprocessing!: boolean;
  composer!: PostProcessingComposer | null;
  resizer!: ResizeObserver;
  width: number = 0;
  height: number = 0;
  aspect: number = 0;
  worldToScreenFactor: number = 0;
  isWebGPU: boolean = true;

  constructor(world: World) {
    super(world);
  }

  override async init(
    options: WorldOptions & { viewport?: HTMLElement },
  ): Promise<void> {
    if (!options.viewport) {
      throw new Error("ClientGraphics requires viewport in options");
    }
    const { viewport } = options;
    this.viewport = viewport;
    this.width = this.viewport.offsetWidth;
    this.height = this.viewport.offsetHeight;
    this.aspect = this.width / this.height;

    // Update camera aspect ratio immediately to match viewport
    // THREE.PerspectiveCamera has aspect and updateProjectionMatrix properties
    this.world.camera.aspect = this.aspect;
    this.world.camera.updateProjectionMatrix();

    // Create renderer (WebGPU preferred, WebGL fallback)
    this.renderer = await getRenderer();
    this.isWebGPU = isWebGPURenderer(this.renderer);

    // Log backend capabilities
    if (isWebGPURenderer(this.renderer)) {
      logWebGPUInfo(this.renderer);
      const caps = getWebGPUCapabilities(this.renderer);
      console.log("[ClientGraphics] WebGPU features:", caps.features.length);
    } else {
      console.warn(
        "[ClientGraphics] WebGPU unavailable (falling back to WebGL renderer)",
      );
    }

    // Configure renderer
    configureRenderer(this.renderer, {
      clearColor: 0x000000, // Black - sky mesh should cover everything
      clearAlpha: 1,
      pixelRatio: this.world.prefs?.dpr || 1,
      width: this.width,
      height: this.height,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 0.85,
      outputColorSpace: THREE.SRGBColorSpace,
    });

    // Configure shadows
    configureShadowMaps(this.renderer, {
      enabled: true,
      type: THREE.PCFSoftShadowMap,
    });

    // Get max anisotropy
    this.maxAnisotropy = getMaxAnisotropy(this.renderer);
    THREE.Texture.DEFAULT_ANISOTROPY = this.maxAnisotropy;

    // Setup post-processing with TSL
    this.usePostprocessing =
      (this.world.prefs?.postprocessing ?? true) && this.isWebGPU;

    if (this.usePostprocessing && isWebGPURenderer(this.renderer)) {
      // Get color grading settings from preferences
      const colorGradingLut = this.world.prefs?.colorGrading ?? "none";
      const colorGradingIntensity =
        this.world.prefs?.colorGradingIntensity ?? 1.0;

      this.composer = await createPostProcessing(
        this.renderer,
        this.world.stage.scene,
        this.world.camera,
        {
          bloom: {
            enabled: this.world.prefs?.bloom ?? true,
            intensity: 0.3,
            threshold: 1.0,
            radius: 0.5,
          },
          colorGrading: {
            enabled: true,
            lut: colorGradingLut as
              | "none"
              | "cinematic"
              | "bourbon"
              | "chemical"
              | "clayton"
              | "cubicle"
              | "remy"
              | "bw"
              | "night",
            intensity: colorGradingIntensity,
          },
        },
      );
    } else {
      this.composer = null;
    }

    this.world.prefs?.on("change", this.onPrefsChange);

    // Debounced resize with strict size change detection
    let resizePending = false;
    this.resizer = new ResizeObserver((entries) => {
      if (resizePending) return;

      const entry = entries[0];
      if (!entry) return;

      const newWidth = Math.floor(entry.contentRect.width);
      const newHeight = Math.floor(entry.contentRect.height);

      // Only resize if dimensions actually changed by at least 1 pixel
      if (newWidth !== this.width || newHeight !== this.height) {
        resizePending = true;
        requestAnimationFrame(() => {
          resizePending = false;
          this.resize(newWidth, newHeight);
        });
      }
    });

    // Set ID for Cypress tests
    this.renderer.domElement.id = "hyperscape-world-canvas";

    // Style canvas to fill container and scale properly
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";

    // Avoid appending twice
    if (this.renderer.domElement.parentElement !== this.viewport) {
      // Detach from any previous parent to avoid duplicate canvases
      if (this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(
          this.renderer.domElement,
        );
      }
      this.viewport.appendChild(this.renderer.domElement);
    }
  }

  resize(width: number, height: number) {
    // Guard: ensure graphics system is fully initialized
    if (!this.renderer) {
      return;
    }

    // Ensure valid dimensions
    if (width <= 0 || height <= 0) {
      console.warn(
        `[ClientGraphics] Invalid resize dimensions: ${width}x${height}`,
      );
      return;
    }

    // Prevent unnecessary resize operations
    if (width === this.width && height === this.height) {
      return;
    }

    this.width = width;
    this.height = height;
    this.aspect = this.width / this.height;

    // Update camera aspect ratio
    // THREE.PerspectiveCamera has aspect and updateProjectionMatrix properties
    this.world.camera.aspect = this.aspect;
    this.world.camera.updateProjectionMatrix();

    // Update renderer size with current pixel ratio
    const dpr = this.world.prefs?.dpr || 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);

    // Update post-processing composer
    if (this.composer) {
      this.composer.setSize(this.width, this.height);
    }

    this.emit(EventType.GRAPHICS_RESIZE, {
      width: this.width,
      height: this.height,
      aspect: this.aspect,
    });
    this.render();
  }

  render() {
    if (!this.usePostprocessing || !this.composer) {
      // Direct rendering without post-processing
      this.renderer.render(this.world.stage.scene, this.world.camera);
    } else {
      // Render with post-processing (bloom via TSL)
      this.composer.render();
    }
  }

  override commit() {
    this.render();
  }

  override preTick() {
    const fov = this.world.camera.fov;
    const fovRadians = THREE.MathUtils.degToRad(fov);
    this.worldToScreenFactor = (Math.tan(fovRadians / 2) * 2) / this.height;
  }

  onPrefsChange = (changes: {
    dpr?: { value: number };
    postprocessing?: { value: boolean };
    bloom?: { value: boolean };
    colorGrading?: { value: string };
    colorGradingIntensity?: { value: number };
  }) => {
    // dpr
    if (changes.dpr) {
      this.renderer.setPixelRatio(changes.dpr.value);
      this.resize(this.width, this.height);
    }
    // postprocessing
    if (changes.postprocessing) {
      // WebGL fallback currently runs without TSL post-processing.
      this.usePostprocessing = changes.postprocessing.value && this.isWebGPU;
    }
    // color grading LUT
    if (changes.colorGrading && this.composer) {
      this.composer.setLUT(
        changes.colorGrading.value as
          | "none"
          | "cinematic"
          | "bourbon"
          | "chemical"
          | "clayton"
          | "cubicle"
          | "remy"
          | "bw"
          | "night",
      );
    }
    // color grading intensity
    if (changes.colorGradingIntensity && this.composer) {
      this.composer.setLUTIntensity(changes.colorGradingIntensity.value);
    }
  };

  override destroy() {
    // Guard against destruction before initialization
    if (this.resizer) {
      this.resizer.disconnect();
    }
    // Unsubscribe from prefs changes
    this.world.prefs?.off("change", this.onPrefsChange);
    // Ensure animation loop is stopped
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    // Remove renderer from DOM if it was added
    if (this.renderer?.domElement && this.viewport) {
      const parent = this.renderer.domElement.parentElement;
      if (parent === this.viewport) {
        this.viewport.removeChild(this.renderer.domElement);
      }
    }
  }
}
