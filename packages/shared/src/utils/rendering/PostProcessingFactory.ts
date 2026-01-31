/**
 * Post-Processing Factory - WebGPU TSL-based effects pipeline
 *
 * Effects: 3D LUT color grading, depth-based camera blur (DoF), tone mapping
 */

import THREE, {
  pass,
  uniform,
  renderOutput,
  texture3D,
  mix,
  smoothstep,
  max,
  sub,
  mul,
  step,
} from "../../extras/three/three";
import type { ShaderNode, ShaderNodeInput } from "../../extras/three/three";
import type { WebGPURenderer } from "./RendererFactory";

// Dynamic module types
type LUT3DFunction = (
  input: ShaderNodeInput,
  lutTexture: ShaderNodeInput,
  size: number,
  intensity: ShaderNodeInput,
) => ShaderNode;
type LUTLoaderResult = { texture3D: THREE.Data3DTexture };
type LUTLoader = { loadAsync: (url: string) => Promise<LUTLoaderResult> };
type HashBlurFunction = (
  input: ShaderNodeInput,
  blurAmount: ShaderNodeInput,
  options?: { repeats?: ShaderNodeInput; premultipliedAlpha?: boolean },
) => ShaderNode;

/** Default depth blur parameters (RuneScape-style DoF) */
export const DEPTH_BLUR_DEFAULTS = {
  /** Focus distance in world units - objects at this distance are sharpest */
  focusDistance: 100,
  /** Range over which blur transitions from 0 to max */
  blurRange: 100,
  /** Overall blur intensity 0-1 */
  intensity: 0.85,
  /** Hash blur amount - controls blur radius (0.01-0.1 typical) */
  blurAmount: 0.03,
  /** Hash blur iterations - higher = smoother but more expensive */
  blurRepeats: 30,
  /** Sky cutoff distance - objects beyond this are not blurred (preserves sky) */
  skyDistance: 500,
} as const;

/** LUT presets for color grading */
export const LUT_PRESETS = {
  none: { label: "None", file: null },
  cinematic: { label: "Cinematic", file: "Presetpro-Cinematic.3dl" },
  bourbon: { label: "Bourbon", file: "Bourbon 64.CUBE" },
  chemical: { label: "Chemical", file: "Chemical 168.CUBE" },
  clayton: { label: "Clayton", file: "Clayton 33.CUBE" },
  cubicle: { label: "Cubicle", file: "Cubicle 99.CUBE" },
  remy: { label: "Remy", file: "Remy 24.CUBE" },
  bw: { label: "B&W", file: "B&WLUT.png" },
  night: { label: "Night", file: "NightLUT.png" },
} as const;

export type LUTPresetName = keyof typeof LUT_PRESETS;

/** PostProcessing composer interface */
export type PostProcessingComposer = {
  render: () => void;
  renderAsync: () => Promise<void>;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
  // LUT
  setLUT: (lutName: LUTPresetName) => Promise<void>;
  setLUTIntensity: (intensity: number) => void;
  getCurrentLUT: () => LUTPresetName;
  isLUTEnabled: () => boolean;
  // Depth blur
  setDepthBlur: (enabled: boolean) => void;
  setDepthBlurIntensity: (intensity: number) => void;
  setDepthBlurFocusDistance: (distance: number) => void;
  setDepthBlurRange: (range: number) => void;
  isDepthBlurEnabled: () => boolean;
};

export interface PostProcessingOptions {
  colorGrading?: {
    enabled?: boolean;
    lut?: LUTPresetName;
    intensity?: number;
  };
  depthBlur?: {
    enabled?: boolean;
    focusDistance?: number;
    blurRange?: number;
    intensity?: number;
    /** Hash blur amount - controls blur radius (0.01-0.1 typical) */
    blurAmount?: number;
    /** Hash blur iterations - higher = smoother (30-100 typical) */
    blurRepeats?: number;
  };
}

// Cached dynamic modules
let lut3DModule: { lut3D: LUT3DFunction } | null = null;
let lutCubeLoaderModule: { LUTCubeLoader: new () => LUTLoader } | null = null;
let lut3dlLoaderModule: { LUT3dlLoader: new () => LUTLoader } | null = null;
let lutImageLoaderModule: { LUTImageLoader: new () => LUTLoader } | null = null;
let hashBlurModule: { hashBlur: HashBlurFunction } | null = null;

// LUT texture cache
const lutCache = new Map<string, { texture3D: THREE.Data3DTexture }>();

/** Load all required dynamic modules */
async function loadModules(): Promise<void> {
  const imports = await Promise.all([
    lut3DModule ? null : import("three/examples/jsm/tsl/display/Lut3DNode.js"),
    lutCubeLoaderModule
      ? null
      : import("three/examples/jsm/loaders/LUTCubeLoader.js"),
    lut3dlLoaderModule
      ? null
      : import("three/examples/jsm/loaders/LUT3dlLoader.js"),
    lutImageLoaderModule
      ? null
      : import("three/examples/jsm/loaders/LUTImageLoader.js"),
    hashBlurModule ? null : import("three/addons/tsl/display/hashBlur.js"),
  ]);

  if (imports[0]) lut3DModule = imports[0] as { lut3D: LUT3DFunction };
  if (imports[1])
    lutCubeLoaderModule = imports[1] as { LUTCubeLoader: new () => LUTLoader };
  if (imports[2])
    lut3dlLoaderModule = imports[2] as { LUT3dlLoader: new () => LUTLoader };
  if (imports[3])
    lutImageLoaderModule = imports[3] as {
      LUTImageLoader: new () => LUTLoader;
    };
  if (imports[4]) hashBlurModule = imports[4] as { hashBlur: HashBlurFunction };
}

/** Load a LUT texture by preset name */
async function loadLUT(
  lutName: LUTPresetName,
): Promise<THREE.Data3DTexture | null> {
  if (lutName === "none") return null;

  const preset = LUT_PRESETS[lutName];
  if (!preset.file) return null;

  // Return cached texture
  const cached = lutCache.get(lutName);
  if (cached) return cached.texture3D;

  const fileName = preset.file;
  const lutPath = `/luts/${fileName}`;

  let loader: LUTLoader;
  if (fileName.endsWith(".CUBE")) {
    loader = new lutCubeLoaderModule!.LUTCubeLoader();
  } else if (fileName.endsWith(".3dl")) {
    loader = new lut3dlLoaderModule!.LUT3dlLoader();
  } else if (fileName.endsWith(".png")) {
    loader = new lutImageLoaderModule!.LUTImageLoader();
  } else {
    console.error(`[PostProcessing] Unknown LUT format: ${fileName}`);
    return null;
  }

  const result = await loader.loadAsync(lutPath);
  lutCache.set(lutName, { texture3D: result.texture3D });
  return result.texture3D;
}

/** Create identity LUT (passthrough) */
function createIdentityLUT(): THREE.Data3DTexture {
  const size = 2;
  const data = new Uint8Array(size * size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (z * size * size + y * size + x) * 4;
        data[i] = Math.round((x / (size - 1)) * 255);
        data[i + 1] = Math.round((y / (size - 1)) * 255);
        data[i + 2] = Math.round((z / (size - 1)) * 255);
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Create post-processing pipeline */
export async function createPostProcessing(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PostProcessingOptions = {},
): Promise<PostProcessingComposer> {
  await loadModules();

  // State
  let currentLUT: LUTPresetName = options.colorGrading?.lut ?? "none";
  let lutEnabled = false;
  let depthBlurActive = options.depthBlur?.enabled ?? false;
  // Track user's preferred intensity (mutable - updated when user changes slider)
  let userDepthBlurIntensity =
    options.depthBlur?.intensity ?? DEPTH_BLUR_DEFAULTS.intensity;

  // Uniforms
  const lutIntensityUniform = uniform(options.colorGrading?.intensity ?? 1.0);
  const depthBlurFocusUniform = uniform(
    options.depthBlur?.focusDistance ?? DEPTH_BLUR_DEFAULTS.focusDistance,
  );
  const depthBlurRangeUniform = uniform(
    options.depthBlur?.blurRange ?? DEPTH_BLUR_DEFAULTS.blurRange,
  );
  const depthBlurIntensityUniform = uniform(
    depthBlurActive ? userDepthBlurIntensity : 0,
  );
  const depthBlurAmountUniform = uniform(
    options.depthBlur?.blurAmount ?? DEPTH_BLUR_DEFAULTS.blurAmount,
  );
  const depthBlurRepeatsUniform = uniform(
    options.depthBlur?.blurRepeats ?? DEPTH_BLUR_DEFAULTS.blurRepeats,
  );

  // PostProcessing instance
  type PostProcessingType = {
    outputColorTransform: boolean;
    outputNode: ShaderNode;
    render: () => void;
    renderAsync: () => Promise<void>;
    dispose: () => void;
  };

  const PostProcessingClass = (
    THREE as unknown as {
      PostProcessing: new (renderer: WebGPURenderer) => PostProcessingType;
    }
  ).PostProcessing;

  if (!PostProcessingClass) {
    throw new Error("PostProcessing class not available in THREE namespace");
  }

  const postProcessing = new PostProcessingClass(renderer);
  postProcessing.outputColorTransform = false;

  // Build TSL pipeline: scene -> depth blur -> tone map -> LUT
  const scenePass = pass(scene, camera);
  type ScenePassWithNodes = typeof scenePass & {
    getTextureNode: () => ShaderNode;
    getViewZNode: () => ShaderNode;
  };
  const sceneColor = (scenePass as ScenePassWithNodes).getTextureNode();
  const sceneViewZ = (scenePass as ScenePassWithNodes).getViewZNode();

  // Depth blur: only blur objects BEYOND the focus distance (far blur only)
  // hashBlur uses randomized sampling for smooth, organic blur (no grid artifacts)
  const blurredColor = hashBlurModule!.hashBlur(
    sceneColor as ShaderNodeInput,
    depthBlurAmountUniform as ShaderNodeInput,
    { repeats: depthBlurRepeatsUniform as ShaderNodeInput },
  );

  // viewZ is negative in view space, so we negate it to get positive depth
  const depth = mul(sceneViewZ as ShaderNodeInput, -1);
  // Only blur objects further than focus distance (max clamps negative to 0 = no blur for near)
  const depthBeyondFocus = max(
    sub(depth, depthBlurFocusUniform as ShaderNodeInput),
    uniform(0),
  );
  const blurFactor = smoothstep(
    uniform(0),
    depthBlurRangeUniform as ShaderNodeInput,
    depthBeyondFocus,
  );
  // Exclude sky from blur: step returns 1 when depth >= skyDistance, we subtract to get 0
  const skyMask = sub(
    uniform(1),
    step(uniform(DEPTH_BLUR_DEFAULTS.skyDistance), depth),
  );
  const finalBlurFactor = mul(
    mul(blurFactor, depthBlurIntensityUniform as ShaderNodeInput),
    skyMask,
  );
  const depthBlurOutput = mix(
    sceneColor as ShaderNodeInput,
    blurredColor,
    finalBlurFactor,
  );

  // Tone mapping
  const toneMapped = renderOutput(depthBlurOutput);

  // LUT color grading
  const identityLUT = createIdentityLUT();
  const lutTextureNode = texture3D(identityLUT);
  const lutSize = identityLUT.image.width;
  const lutOutput = lut3DModule!.lut3D(
    toneMapped,
    lutTextureNode,
    lutSize,
    lutIntensityUniform,
  );

  postProcessing.outputNode = lutOutput;

  // Load initial LUT if specified
  // Note: LUT size is fixed at creation time. Loaded LUTs should match the identity LUT size.
  if (options.colorGrading?.enabled !== false && currentLUT !== "none") {
    try {
      const tex = await loadLUT(currentLUT);
      if (tex) {
        lutTextureNode.value = tex;
        lutEnabled = true;
      }
    } catch (err) {
      console.error(
        `[PostProcessing] Failed to load initial LUT "${currentLUT}":`,
        err,
      );
      // Continue with identity LUT (no color grading)
      currentLUT = "none";
    }
  }

  const isAnyEffectActive = () => lutEnabled || depthBlurActive;

  // Detect incompatible GLSL ShaderMaterials during rendering
  // All materials should now use TSL (NodeMaterial). If we see this warning,
  // it means there's a GLSL ShaderMaterial that wasn't converted - treat as error.
  const originalWarn = console.warn;
  const incompatibleMaterialPattern =
    /NodeMaterial: Material .* is not compatible/;

  const wrapWithMaterialCheck = <T>(fn: () => T): T => {
    console.warn = (...args: Parameters<typeof console.warn>) => {
      const message = args[0];
      if (
        typeof message === "string" &&
        incompatibleMaterialPattern.test(message)
      ) {
        // Log as error - this should not happen with proper TSL materials
        console.error(
          "[PostProcessing] GLSL ShaderMaterial detected! All materials must use TSL for WebGPU:",
          message,
        );
      }
      originalWarn.apply(console, args);
    };
    try {
      return fn();
    } finally {
      console.warn = originalWarn;
    }
  };

  const wrapWithMaterialCheckAsync = async <T>(
    fn: () => Promise<T>,
  ): Promise<T> => {
    console.warn = (...args: Parameters<typeof console.warn>) => {
      const message = args[0];
      if (
        typeof message === "string" &&
        incompatibleMaterialPattern.test(message)
      ) {
        // Log as error - this should not happen with proper TSL materials
        console.error(
          "[PostProcessing] GLSL ShaderMaterial detected! All materials must use TSL for WebGPU:",
          message,
        );
      }
      originalWarn.apply(console, args);
    };
    try {
      return await fn();
    } finally {
      console.warn = originalWarn;
    }
  };

  return {
    render: () => {
      // Check for incompatible materials during render
      wrapWithMaterialCheck(() => {
        if (isAnyEffectActive()) {
          postProcessing.render();
        } else {
          renderer.render(scene, camera);
        }
      });
    },

    renderAsync: async () => {
      // Check for incompatible materials during render
      await wrapWithMaterialCheckAsync(async () => {
        if (isAnyEffectActive()) {
          await postProcessing.renderAsync();
        } else {
          await renderer.renderAsync(scene, camera);
        }
      });
    },

    setSize: (_width: number, _height: number) => {
      // WebGPU PostProcessing reads renderer size each frame - no manual resize needed
      // This method exists for API compatibility with other composer patterns
    },

    dispose: () => {
      postProcessing.dispose();
      identityLUT.dispose();
      lutCache.forEach((lut) => lut.texture3D.dispose());
      lutCache.clear();
    },

    // LUT methods
    setLUT: async (lutName: LUTPresetName) => {
      if (lutName === currentLUT) return;

      if (lutName === "none") {
        currentLUT = lutName;
        lutEnabled = false;
        lutIntensityUniform.value = 0;
        return;
      }

      // Load new LUT before updating state - if load fails, keep current LUT
      let tex: THREE.Data3DTexture | null = null;
      try {
        tex = await loadLUT(lutName);
      } catch (err) {
        console.error(`[PostProcessing] Failed to load LUT "${lutName}":`, err);
        return; // Keep current LUT on failure
      }

      if (tex) {
        currentLUT = lutName;
        lutTextureNode.value = tex;
        lutIntensityUniform.value = options.colorGrading?.intensity ?? 1.0;
        lutEnabled = true;
      }
    },

    setLUTIntensity: (intensity: number) => {
      lutIntensityUniform.value = Math.max(0, Math.min(1, intensity));
    },

    getCurrentLUT: () => currentLUT,
    isLUTEnabled: () => lutEnabled,

    // Depth blur methods
    setDepthBlur: (enabled: boolean) => {
      depthBlurActive = enabled;
      depthBlurIntensityUniform.value = enabled ? userDepthBlurIntensity : 0;
    },

    setDepthBlurIntensity: (intensity: number) => {
      const clamped = Math.max(0, Math.min(1, intensity));
      // Store user's preferred intensity so toggle off/on restores it
      userDepthBlurIntensity = clamped;
      depthBlurIntensityUniform.value = clamped;
      depthBlurActive = clamped > 0;
    },

    setDepthBlurFocusDistance: (distance: number) => {
      depthBlurFocusUniform.value = Math.max(0, distance);
    },

    setDepthBlurRange: (range: number) => {
      depthBlurRangeUniform.value = Math.max(0.1, range);
    },

    isDepthBlurEnabled: () => depthBlurActive,
  };
}
