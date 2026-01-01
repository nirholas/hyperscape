/**
 * KTX2 Texture Loader Utility
 *
 * Provides smart texture loading that:
 * 1. Tries to load KTX2 version first (GPU-compressed, smaller)
 * 2. Falls back to original format (PNG/JPG) if KTX2 not available
 *
 * KTX2 textures are GPU-compressed (ETC1S/UASTC via Basis Universal)
 * and typically 5-10x smaller than PNG while loading directly to GPU.
 */

import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import THREE from "./three";

// Singleton KTX2 loader with transcoder
let ktx2Loader: KTX2Loader | null = null;
let ktx2LoaderPromise: Promise<KTX2Loader> | null = null;

// Track which files we know don't have KTX2 versions (to avoid repeated 404s)
const noKtx2Cache = new Set<string>();

/**
 * Initialize the KTX2 loader with basis transcoder
 * Must be called once with a renderer before using loadTextureWithKTX2Fallback
 */
export function initKTX2Loader(
  renderer: THREE.WebGPURenderer,
): Promise<KTX2Loader> {
  if (ktx2Loader) {
    return Promise.resolve(ktx2Loader);
  }

  if (ktx2LoaderPromise) {
    return ktx2LoaderPromise;
  }

  ktx2LoaderPromise = new Promise((resolve) => {
    const loader = new KTX2Loader();

    // Set the path to the basis transcoder WASM files
    // These are hosted on CDN or can be bundled locally
    // Using the three.js examples path which is commonly available
    loader.setTranscoderPath(
      "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/basis/",
    );

    // Detect renderer and set up transcoder
    loader.detectSupport(renderer);

    ktx2Loader = loader;
    console.log("[KTX2Loader] Initialized with basis transcoder");
    resolve(loader);
  });

  return ktx2LoaderPromise;
}

/**
 * Get the initialized KTX2 loader
 * Returns null if not initialized
 */
export function getKTX2Loader(): KTX2Loader | null {
  return ktx2Loader;
}

/**
 * Convert a texture path to its KTX2 equivalent
 * e.g., "/textures/grass_d.png" -> "/textures/grass_d.ktx2"
 */
function toKTX2Path(path: string): string {
  return path.replace(/\.(png|jpg|jpeg|webp)$/i, ".ktx2");
}

/**
 * Check if a URL points to a KTX2 file
 */
function isKTX2Path(path: string): boolean {
  return path.toLowerCase().endsWith(".ktx2");
}

/**
 * Load a texture, trying KTX2 first then falling back to original format
 *
 * @param path - Path to the texture (can be .png, .jpg, etc.)
 * @param options - Loading options
 * @returns Promise<THREE.Texture>
 */
export async function loadTextureWithKTX2Fallback(
  path: string,
  options: {
    wrapS?: THREE.Wrapping;
    wrapT?: THREE.Wrapping;
    colorSpace?: THREE.ColorSpace;
    flipY?: boolean;
  } = {},
): Promise<THREE.Texture> {
  const {
    wrapS = THREE.RepeatWrapping,
    wrapT = THREE.RepeatWrapping,
    colorSpace = THREE.SRGBColorSpace,
    flipY = true,
  } = options;

  const ktx2Path = toKTX2Path(path);

  // If KTX2 loader is available and we haven't cached this as missing
  if (ktx2Loader && !noKtx2Cache.has(ktx2Path) && !isKTX2Path(path)) {
    try {
      // Try to load KTX2 version
      const texture = await ktx2Loader.loadAsync(ktx2Path);
      texture.wrapS = wrapS;
      texture.wrapT = wrapT;
      texture.colorSpace = colorSpace;
      texture.flipY = flipY;
      texture.needsUpdate = true;
      console.log(`[KTX2] Loaded: ${ktx2Path}`);
      return texture;
    } catch {
      // KTX2 not available, cache this and fall back
      noKtx2Cache.add(ktx2Path);
      console.log(`[KTX2] Not found, falling back: ${path}`);
    }
  }

  // Fall back to regular texture loader
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (texture) => {
        texture.wrapS = wrapS;
        texture.wrapT = wrapT;
        texture.colorSpace = colorSpace;
        texture.flipY = flipY;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      (error) => {
        reject(new Error(`Failed to load texture: ${path} - ${error}`));
      },
    );
  });
}

/**
 * Load a texture directly (either KTX2 or regular format based on extension)
 * Use this when you know the exact path and format
 */
export async function loadTexture(
  path: string,
  options: {
    wrapS?: THREE.Wrapping;
    wrapT?: THREE.Wrapping;
    colorSpace?: THREE.ColorSpace;
    flipY?: boolean;
  } = {},
): Promise<THREE.Texture> {
  const {
    wrapS = THREE.RepeatWrapping,
    wrapT = THREE.RepeatWrapping,
    colorSpace = THREE.SRGBColorSpace,
    flipY = true,
  } = options;

  // If it's a KTX2 file and we have the loader, use it
  if (isKTX2Path(path) && ktx2Loader) {
    const texture = await ktx2Loader.loadAsync(path);
    texture.wrapS = wrapS;
    texture.wrapT = wrapT;
    texture.colorSpace = colorSpace;
    texture.flipY = flipY;
    texture.needsUpdate = true;
    return texture;
  }

  // Otherwise use regular texture loader
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (texture) => {
        texture.wrapS = wrapS;
        texture.wrapT = wrapT;
        texture.colorSpace = colorSpace;
        texture.flipY = flipY;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      (error) => {
        reject(new Error(`Failed to load texture: ${path} - ${error}`));
      },
    );
  });
}

/**
 * Preload multiple textures with KTX2 fallback
 * Returns a map of path -> texture
 */
export async function loadTexturesWithKTX2Fallback(
  paths: string[],
  options: {
    wrapS?: THREE.Wrapping;
    wrapT?: THREE.Wrapping;
    colorSpace?: THREE.ColorSpace;
    flipY?: boolean;
  } = {},
): Promise<Map<string, THREE.Texture>> {
  const results = new Map<string, THREE.Texture>();

  const loadPromises = paths.map(async (path) => {
    const texture = await loadTextureWithKTX2Fallback(path, options);
    results.set(path, texture);
  });

  await Promise.all(loadPromises);
  return results;
}

/**
 * Clear the cache of known missing KTX2 files
 * Useful if files have been added/updated
 */
export function clearKTX2Cache(): void {
  noKtx2Cache.clear();
}

/**
 * Dispose of the KTX2 loader
 * Call this when shutting down
 */
export function disposeKTX2Loader(): void {
  if (ktx2Loader) {
    ktx2Loader.dispose();
    ktx2Loader = null;
    ktx2LoaderPromise = null;
  }
  noKtx2Cache.clear();
}
