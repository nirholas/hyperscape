/**
 * Renderer Factory
 *
 * Creates WebGPU renderers for Hyperscape.
 * WebGPU-only implementation - no WebGL fallback.
 */

import THREE from "../../extras/three/three";
import { Logger } from "../Logger";

/**
 * WebGPU Renderer type definition
 * Provides the interface for the WebGPU renderer from three/webgpu
 */
export type WebGPURenderer = {
  init: () => Promise<void>;
  setSize: (w: number, h: number, updateStyle?: boolean) => void;
  setPixelRatio: (r: number) => void;
  render: (scene: THREE.Scene, camera: THREE.Camera) => void;
  renderAsync: (scene: THREE.Scene, camera: THREE.Camera) => Promise<void>;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: THREE.ColorSpace;
  domElement: HTMLCanvasElement;
  setAnimationLoop: (cb: ((time: number) => void) | null) => void;
  dispose: () => void;
  info: {
    render: { triangles: number; calls: number };
    memory: { geometries: number; textures: number };
  };
  shadowMap: {
    enabled: boolean;
    type: THREE.ShadowMapType;
  };
  capabilities: {
    maxAnisotropy: number;
  };
  backend: {
    device?: { features: Set<string> };
  };
  outputNode: unknown;
};

export type UniversalRenderer = WebGPURenderer;

export interface RendererOptions {
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: "high-performance" | "low-power" | "default";
  preserveDrawingBuffer?: boolean;
  canvas?: HTMLCanvasElement;
}

export interface RendererCapabilities {
  supportsWebGPU: boolean;
  maxAnisotropy: number;
  backend: "webgpu";
}

/**
 * Check if WebGPU is available in the current browser
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;

  // Access gpu property safely
  const gpuApi = (
    navigator as { gpu?: { requestAdapter: () => Promise<unknown | null> } }
  ).gpu;
  if (!gpuApi) return false;

  const adapter = await gpuApi.requestAdapter();
  return adapter !== null;
}

/**
 * Detect rendering capabilities
 */
export async function detectRenderingCapabilities(): Promise<RendererCapabilities> {
  const supportsWebGPU = await isWebGPUAvailable();

  if (!supportsWebGPU) {
    throw new Error(
      "WebGPU is not supported in this browser. " +
        "Please use Chrome 113+, Edge 113+, or Safari 17+.",
    );
  }

  return {
    supportsWebGPU: true,
    maxAnisotropy: 16, // WebGPU default
    backend: "webgpu",
  };
}

/**
 * Create a WebGPU renderer
 */
export async function createRenderer(
  options: RendererOptions = {},
): Promise<WebGPURenderer> {
  const { antialias = true, canvas } = options;

  // Verify WebGPU support
  await detectRenderingCapabilities();

  // Create WebGPU renderer using Three.js WebGPU build
  // The THREE namespace from three/webgpu includes WebGPURenderer
  const WebGPURendererClass = (
    THREE as unknown as {
      WebGPURenderer: new (params: {
        canvas?: HTMLCanvasElement;
        antialias?: boolean;
      }) => WebGPURenderer;
    }
  ).WebGPURenderer;

  const renderer = new WebGPURendererClass({
    canvas,
    antialias,
  });

  // Initialize WebGPU backend
  await renderer.init();

  return renderer;
}

/**
 * Check if renderer is WebGPU (always true in this implementation)
 */
export function isWebGPURenderer(
  renderer: UniversalRenderer,
): renderer is WebGPURenderer {
  return typeof renderer.init === "function";
}

/**
 * Get renderer backend type (always webgpu)
 */
export function getRendererBackend(_renderer: UniversalRenderer): "webgpu" {
  return "webgpu";
}

/**
 * Configure renderer with common settings
 */
export function configureRenderer(
  renderer: UniversalRenderer,
  options: {
    clearColor?: number;
    clearAlpha?: number;
    pixelRatio?: number;
    width?: number;
    height?: number;
    toneMapping?: THREE.ToneMapping;
    toneMappingExposure?: number;
    outputColorSpace?: THREE.ColorSpace;
  },
): void {
  const {
    pixelRatio = 1,
    width,
    height,
    toneMapping = THREE.ACESFilmicToneMapping,
    toneMappingExposure = 1,
    outputColorSpace = THREE.SRGBColorSpace,
  } = options;

  // Pixel ratio
  renderer.setPixelRatio(pixelRatio);

  // Size
  if (width && height) {
    renderer.setSize(width, height);
  }

  // Tone mapping
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = toneMappingExposure;

  // Output color space
  renderer.outputColorSpace = outputColorSpace;
}

/**
 * Configure shadow maps
 */
export function configureShadowMaps(
  renderer: UniversalRenderer,
  options: {
    enabled?: boolean;
    type?: THREE.ShadowMapType;
  } = {},
): void {
  const { enabled = true, type = THREE.PCFSoftShadowMap } = options;

  renderer.shadowMap.enabled = enabled;
  renderer.shadowMap.type = type;
}

/**
 * Get max anisotropy
 */
export function getMaxAnisotropy(renderer: UniversalRenderer): number {
  return renderer.capabilities?.maxAnisotropy ?? 16;
}

/**
 * Get WebGPU capabilities for logging and debugging
 */
export function getWebGPUCapabilities(renderer: UniversalRenderer): {
  backend: string;
  features: string[];
} {
  const device = renderer.backend?.device;
  const features: string[] = [];

  if (device?.features) {
    device.features.forEach((feature: string) => features.push(feature));
  }

  return {
    backend: "webgpu",
    features,
  };
}

/**
 * Log WebGPU info for debugging
 */
export function logWebGPUInfo(renderer: UniversalRenderer): void {
  const caps = getWebGPUCapabilities(renderer);
  Logger.info("[RendererFactory] WebGPU initialized", {
    features: caps.features.length,
  });
}

/**
 * Optimize materials for WebGPU rendering
 */
export function optimizeMaterialForWebGPU(material: THREE.Material): void {
  if (!material) return;

  type MaterialWithTextureProps = THREE.Material &
    Partial<
      Record<
        "map" | "normalMap" | "roughnessMap" | "metalnessMap" | "emissiveMap",
        THREE.Texture | undefined
      >
    >;

  // Enable anisotropic filtering on textures
  const textureProps: Array<keyof MaterialWithTextureProps> = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "emissiveMap",
  ];
  for (const prop of textureProps) {
    const tex = (material as MaterialWithTextureProps)[prop];
    if (tex instanceof THREE.Texture) {
      tex.anisotropy = 16;
    }
  }
}

/**
 * Create optimized instanced mesh
 */
export function createOptimizedInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = true;
  return mesh;
}
