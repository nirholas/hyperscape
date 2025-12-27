/**
 * WebGPU Renderer Factory for Asset Forge
 *
 * Provides async WebGPU renderer creation for offline processing tools.
 * WebGPU requires async initialization via renderer.init().
 */

import * as THREE from "three/webgpu";

export interface WebGPURendererOptions {
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  preserveDrawingBuffer?: boolean;
}

export type AssetForgeRenderer = THREE.WebGPURenderer;

/**
 * Create and initialize a WebGPU renderer
 */
export async function createWebGPURenderer(
  options: WebGPURendererOptions = {},
): Promise<AssetForgeRenderer> {
  const renderer = new THREE.WebGPURenderer({
    canvas: options.canvas,
    antialias: options.antialias ?? true,
    alpha: options.alpha ?? true,
  });

  // WebGPU requires async initialization
  await renderer.init();

  return renderer;
}

/**
 * Check if WebGPU is available
 */
export function isWebGPUAvailable(): boolean {
  return "gpu" in navigator;
}

// Re-export THREE from webgpu for convenience
export { THREE };
