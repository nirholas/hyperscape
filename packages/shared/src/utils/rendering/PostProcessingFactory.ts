/**
 * Post-Processing Factory - WebGPU rendering
 *
 * Simple pass-through rendering for WebGPU.
 * Bloom and other effects removed due to WebGPU compatibility issues.
 */

import THREE from "../../extras/three/three";
import type { WebGPURenderer } from "./RendererFactory";

export type PostProcessingComposer = {
  render: () => void;
  renderAsync: () => Promise<void>;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
};

export interface PostProcessingOptions {
  // Reserved for future WebGPU-compatible effects
}

export async function createPostProcessing(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  _options: PostProcessingOptions = {},
): Promise<PostProcessingComposer> {
  const composer: PostProcessingComposer = {
    render: () => renderer.render(scene, camera),
    renderAsync: () => renderer.renderAsync(scene, camera),
    setSize: () => {},
    dispose: () => {},
  };

  return composer;
}
