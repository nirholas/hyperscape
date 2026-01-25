/**
 * Post-Processing Factory - WebGPU rendering
 *
 * Provides WebGPU-compatible post-processing effects including:
 * - 3D LUT color grading for cinematic looks
 * - Tone mapping control
 *
 * Uses Three.js TSL (Three Shading Language) for GPU-accelerated effects.
 */

import THREE, {
  pass,
  uniform,
  renderOutput,
  texture3D,
} from "../../extras/three/three";
import type { WebGPURenderer } from "./RendererFactory";

// Dynamic imports for LUT loaders to handle ESM/CJS module resolution
// These are loaded at runtime to avoid bundler issues
type LUT3DFunction = (
  input: unknown,
  lutTexture: unknown,
  size: unknown,
  intensity: unknown,
) => unknown;

type LUTLoaderResult = {
  texture3D: THREE.Data3DTexture;
};

type LUTLoader = {
  loadAsync: (url: string) => Promise<LUTLoaderResult>;
};

/**
 * Available LUT presets for color grading
 * Maps preset key to display name and file name
 */
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

/**
 * LUT data containing the 3D texture
 */
type LUTData = {
  texture3D: THREE.Data3DTexture;
};

/**
 * Loaded LUT cache
 */
const lutCache = new Map<string, LUTData>();

/**
 * PostProcessing composer type with LUT support
 */
export type PostProcessingComposer = {
  render: () => void;
  renderAsync: () => Promise<void>;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
  setLUT: (lutName: LUTPresetName) => void;
  setLUTIntensity: (intensity: number) => void;
  getCurrentLUT: () => LUTPresetName;
  isLUTEnabled: () => boolean;
};

export interface PostProcessingOptions {
  colorGrading?: {
    enabled?: boolean;
    lut?: LUTPresetName;
    intensity?: number;
  };
  bloom?: {
    enabled?: boolean;
    intensity?: number;
    threshold?: number;
    radius?: number;
  };
}

// Cached loader modules
let lut3DModule: { lut3D: LUT3DFunction } | null = null;
let lutCubeLoaderModule: { LUTCubeLoader: new () => LUTLoader } | null = null;
let lut3dlLoaderModule: { LUT3dlLoader: new () => LUTLoader } | null = null;
let lutImageLoaderModule: { LUTImageLoader: new () => LUTLoader } | null = null;

/**
 * Load required LUT modules dynamically
 */
async function loadLUTModules(): Promise<void> {
  if (!lut3DModule) {
    lut3DModule = (await import(
      "three/examples/jsm/tsl/display/Lut3DNode.js"
    )) as unknown as { lut3D: LUT3DFunction };
  }
  if (!lutCubeLoaderModule) {
    lutCubeLoaderModule = (await import(
      "three/examples/jsm/loaders/LUTCubeLoader.js"
    )) as { LUTCubeLoader: new () => LUTLoader };
  }
  if (!lut3dlLoaderModule) {
    lut3dlLoaderModule = (await import(
      "three/examples/jsm/loaders/LUT3dlLoader.js"
    )) as { LUT3dlLoader: new () => LUTLoader };
  }
  if (!lutImageLoaderModule) {
    lutImageLoaderModule = (await import(
      "three/examples/jsm/loaders/LUTImageLoader.js"
    )) as { LUTImageLoader: new () => LUTLoader };
  }
}

/**
 * Load a LUT from file
 */
async function loadLUT(lutName: LUTPresetName): Promise<LUTData | null> {
  if (lutName === "none") return null;

  const preset = LUT_PRESETS[lutName];
  if (!preset.file) return null;

  // Check cache first
  if (lutCache.has(lutName)) {
    return lutCache.get(lutName) || null;
  }

  // Ensure loaders are loaded
  await loadLUTModules();

  // LUTs are served from public/luts/ directly
  const fileName = preset.file;
  const lutPath = `/luts/${fileName}`;

  console.log(`[PostProcessing] Loading LUT file: ${lutPath}`);

  try {
    let lut: LUTLoaderResult;

    if (fileName.endsWith(".CUBE")) {
      const cubeLoader = new lutCubeLoaderModule!.LUTCubeLoader();
      lut = await cubeLoader.loadAsync(lutPath);
    } else if (fileName.endsWith(".3dl")) {
      const threeDlLoader = new lut3dlLoaderModule!.LUT3dlLoader();
      lut = await threeDlLoader.loadAsync(lutPath);
    } else if (fileName.endsWith(".png")) {
      const imageLoader = new lutImageLoaderModule!.LUTImageLoader();
      lut = await imageLoader.loadAsync(lutPath);
    } else {
      console.error(`[PostProcessing] Unknown LUT format: ${fileName}`);
      return null;
    }

    const lutData: LUTData = { texture3D: lut.texture3D };
    lutCache.set(lutName, lutData);
    console.log(
      `[PostProcessing] LUT loaded successfully: ${lutName} (${lut.texture3D.image.width}x${lut.texture3D.image.width})`,
    );
    return lutData;
  } catch (error) {
    console.error(`[PostProcessing] Failed to load LUT ${lutName}:`, error);
    return null;
  }
}

/**
 * Create post-processing pipeline with LUT color grading support
 */
export async function createPostProcessing(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PostProcessingOptions = {},
): Promise<PostProcessingComposer> {
  console.log("[PostProcessing] Creating post-processing pipeline...");

  // Load LUT modules at creation time
  await loadLUTModules();
  console.log("[PostProcessing] LUT modules loaded");

  const colorGradingEnabled = options.colorGrading?.enabled ?? true;
  let currentLUT: LUTPresetName = options.colorGrading?.lut ?? "none";
  const intensityUniform = uniform(options.colorGrading?.intensity ?? 1.0);

  console.log(
    `[PostProcessing] Color grading enabled: ${colorGradingEnabled}, LUT: ${currentLUT}, intensity: ${intensityUniform.value}`,
  );

  // Get the lut3D function from dynamically loaded module
  const lut3DFn = lut3DModule!.lut3D;

  // Type for PostProcessing from three/webgpu
  type PostProcessingType = {
    outputColorTransform: boolean;
    outputNode: ReturnType<typeof pass>;
    render: () => void;
    renderAsync: () => Promise<void>;
    dispose: () => void;
  };

  // Type for texture3D node (unused but kept for future use)
  // type Texture3DNode = ReturnType<typeof uniform>;

  // Create PostProcessing instance from three/webgpu
  const PostProcessingClass = (
    THREE as unknown as {
      PostProcessing: new (renderer: WebGPURenderer) => PostProcessingType;
    }
  ).PostProcessing;

  if (!PostProcessingClass) {
    console.error(
      "[PostProcessing] PostProcessing class not found in THREE namespace",
    );
    throw new Error("PostProcessing class not available");
  }

  console.log("[PostProcessing] Creating PostProcessing instance...");
  const postProcessing = new PostProcessingClass(renderer);
  console.log("[PostProcessing] PostProcessing instance created");

  // We'll control tone mapping and color space manually
  postProcessing.outputColorTransform = false;

  // Create scene pass
  const scenePass = pass(scene, camera);

  // Create renderOutput node for proper tone mapping
  const outputPass = renderOutput(scenePass);

  // Create a placeholder LUT texture for initialization
  // This will be replaced when a real LUT is loaded
  function createPlaceholderLUT(): THREE.Data3DTexture {
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

  // Create a Texture3D node we can update at runtime
  const placeholderLUT = createPlaceholderLUT();
  const lutTextureNode = texture3D(placeholderLUT);
  const lutSizeUniform = uniform(placeholderLUT.image.width);

  // Create the LUT pass node once - we'll update its uniforms
  // Cast is needed because lut3D accepts uniform nodes but types are stricter
  const lutPassNode = lut3DFn(
    outputPass,
    lutTextureNode,
    lutSizeUniform,
    intensityUniform,
  );

  // Use the LUT pass as output
  postProcessing.outputNode = lutPassNode as unknown as ReturnType<typeof pass>;

  // Track if LUT is currently enabled (for performance bypass)
  let lutEnabled = false;

  // Load initial LUT if color grading is enabled
  let currentLUTData: LUTData | null = null;

  if (colorGradingEnabled && currentLUT !== "none") {
    console.log(`[PostProcessing] Loading initial LUT: ${currentLUT}`);
    currentLUTData = await loadLUT(currentLUT);
    if (currentLUTData) {
      console.log(
        `[PostProcessing] LUT loaded, texture size: ${currentLUTData.texture3D.image.width}`,
      );
      // Update the LUT texture and size uniforms
      lutTextureNode.value = currentLUTData.texture3D;
      lutSizeUniform.value = currentLUTData.texture3D.image.width;
      intensityUniform.value = options.colorGrading?.intensity ?? 1.0;
      lutEnabled = true;
      console.log("[PostProcessing] LUT color grading applied");
    } else {
      // Failed to load LUT
      lutEnabled = false;
      console.log("[PostProcessing] Failed to load LUT, using direct render");
    }
  } else {
    console.log("[PostProcessing] Color grading disabled or LUT is none");
    lutEnabled = false;
  }

  const composer: PostProcessingComposer = {
    render: () => {
      if (lutEnabled) {
        // Use post-processing with LUT
        postProcessing.render();
      } else {
        // Bypass post-processing entirely for better performance
        renderer.render(scene, camera);
      }
    },
    renderAsync: async () => {
      if (lutEnabled) {
        await postProcessing.renderAsync();
      } else {
        await renderer.renderAsync(scene, camera);
      }
    },
    setSize: () => {
      // PostProcessing handles resize automatically
    },
    dispose: () => {
      postProcessing.dispose();
      placeholderLUT.dispose();
      // Clean up LUT textures
      lutCache.forEach((lut) => {
        lut.texture3D.dispose();
      });
      lutCache.clear();
    },
    setLUT: async (lutName: LUTPresetName) => {
      console.log(`[PostProcessing] Switching LUT to: ${lutName}`);

      if (lutName === currentLUT) return;
      currentLUT = lutName;

      if (lutName === "none") {
        // Disable LUT - bypass post-processing entirely
        lutEnabled = false;
        console.log(
          "[PostProcessing] LUT disabled (bypassing post-processing for performance)",
        );
        return;
      }

      const lutData = await loadLUT(lutName);
      if (lutData) {
        currentLUTData = lutData;
        // Update the LUT texture and size uniforms
        lutTextureNode.value = lutData.texture3D;
        lutSizeUniform.value = lutData.texture3D.image.width;
        // Restore full intensity
        intensityUniform.value = options.colorGrading?.intensity ?? 1.0;
        // Enable LUT
        lutEnabled = true;
        console.log(
          `[PostProcessing] LUT switched to ${lutName} (size: ${lutData.texture3D.image.width})`,
        );
      }
    },
    setLUTIntensity: (intensity: number) => {
      intensityUniform.value = Math.max(0, Math.min(1, intensity));
    },
    getCurrentLUT: () => currentLUT,
    isLUTEnabled: () => lutEnabled,
  };

  return composer;
}
