import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import Hls from "hls.js/dist/hls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createEmoteFactory } from "../../extras/three/createEmoteFactory";
import { createNode } from "../../extras/three/createNode";
import { createVRMFactory } from "../../extras/three/createVRMFactory";
import { glbToNodes } from "../../extras/three/glbToNodes";
import { patchTextureLoader } from "../../extras/three/textureLoaderPatch";
import THREE from "../../extras/three/three";
import { Node } from "../../nodes/Node";
import type {
  GLBData,
  HSNode as INode,
  LoadedAvatar,
  LoadedEmote,
  LoadedModel,
  LoaderResult,
  VideoFactory,
  World,
  WorldOptions,
} from "../../types";
import type { AvatarFactory } from "../../types/rendering/nodes";
import { EventType } from "../../types/events";
import { SystemBase } from "../shared/infrastructure/SystemBase";

// Enable three.js built-in cache for textures and files
// This prevents duplicate network requests for the same asset
THREE.Cache.enabled = true;

/**
 * Asset Caching Architecture:
 *
 * Level 1: Browser HTTP Cache (persistent across sessions)
 *   - Controlled by Cache-Control headers from CDN
 *   - max-age=31536000, immutable for assets
 *   - Automatically used by fetch() with cache: 'default'
 *
 * Level 2: THREE.Cache (in-memory, session only)
 *   - Caches ArrayBuffers for GLTFLoader, TextureLoader, etc.
 *   - Prevents duplicate network requests within session
 *
 * Level 3: ClientLoader.files Map (in-memory, session only)
 *   - Caches File objects created from fetched blobs
 *   - Deduplicates with filePromises for parallel requests
 *
 * Level 4: ModelCache (in-memory, session only)
 *   - Caches parsed THREE.Object3D scenes
 *   - Shares materials across clones
 *
 * Level 5: IndexedDB (persistent across sessions)
 *   - Stores File blobs for instant access on reload
 *   - Only used for large assets (>10KB)
 */

/** IndexedDB database name for asset cache */
const ASSET_DB_NAME = "hyperscape-assets";
const ASSET_STORE_NAME = "files";
const ASSET_DB_VERSION = 1;

/** Promise for IndexedDB initialization */
let dbPromise: Promise<globalThis.IDBDatabase | null> | null = null;

/**
 * Initialize IndexedDB for persistent asset caching
 */
function initAssetDB(): Promise<globalThis.IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    // IndexedDB not available in some environments
    if (typeof globalThis.indexedDB === "undefined") {
      resolve(null);
      return;
    }

    try {
      const request = globalThis.indexedDB.open(
        ASSET_DB_NAME,
        ASSET_DB_VERSION,
      );

      request.onerror = () => {
        console.warn(
          "[ClientLoader] IndexedDB not available, using memory cache only",
        );
        resolve(null);
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as globalThis.IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
          db.createObjectStore(ASSET_STORE_NAME);
        }
      };
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Get a cached file from IndexedDB
 */
async function getFromIndexedDB(url: string): Promise<File | null> {
  const db = await initAssetDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
      const store = transaction.objectStore(ASSET_STORE_NAME);
      const request = store.get(url);

      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const result = request.result as
          | { blob: Blob; name: string; type: string }
          | undefined;
        if (result) {
          resolve(new File([result.blob], result.name, { type: result.type }));
        } else {
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Save a file to IndexedDB for persistent caching
 */
async function saveToIndexedDB(url: string, file: File): Promise<void> {
  // Only cache files > 10KB (skip tiny files)
  if (file.size < 10 * 1024) return;

  const db = await initAssetDB();
  if (!db) return;

  try {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    store.put({ blob: file, name: file.name, type: file.type }, url);
  } catch {
    // Ignore IndexedDB errors - not critical
  }
}

function nodeToINode(node: Node): INode {
  // Ensure transforms are current, then return the actual Node instance
  node.updateTransform();
  return node as INode;
}

/**
 * Client Asset Loader
 *
 * Browser-based asset loading using Web APIs. Handles all client-side asset types
 * including models, avatars, textures, video, and audio.
 *
 * Platform-specific APIs used:
 * - fetch() for network requests
 * - Blob/File APIs for binary data
 * - URL.createObjectURL() for temporary blob URLs
 * - HTMLVideoElement + MediaSource for HLS streaming
 * - Three.js loaders (GLTF, HDR, Texture) with browser context
 *
 * Why browser-specific:
 * This loader uses browser-only APIs that don't exist in Node.js:
 * - `window`, `document`, `Image`, `HTMLVideoElement`
 * - Blob URLs and createObjectURL/revokeObjectURL
 * - Canvas for texture processing
 * - MediaSource API for video streaming
 * - Web Audio API for audio decoding
 *
 * For server-side asset loading, see ServerLoader which uses filesystem operations.
 *
 * Supported Formats:
 * - **Models**: .glb (GLTF binary with embedded textures)
 * - **Avatars**: .vrm (VRM humanoid avatars with VRMLoaderPlugin)
 * - **Emotes**: .glb animations (retargetable to VRM skeletons)
 * - **Textures**: .jpg, .png, .webp (via TextureLoader)
 * - **HDR**: .hdr (RGBE environment maps via HDRLoader)
 * - **Images**: Raw image elements
 * - **Video**: .mp4, .webm, .m3u8 (HLS with hls.js polyfill)
 * - **Audio**: .mp3, .ogg, .wav (decoded via Web Audio API)
 */
/** Loading statistics for performance monitoring */
export interface LoadingStats {
  /** Number of files downloaded from network */
  filesLoaded: number;
  /** Number of duplicate requests avoided via deduplication */
  requestsDeduped: number;
  /** Number of in-memory cache hits */
  cacheHits: number;
  /** Number of IndexedDB persistent cache hits */
  indexedDBHits: number;
  /** Total network requests made */
  networkRequests: number;
  /** Time spent loading (ms) */
  totalLoadTime: number;
}

export class ClientLoader extends SystemBase {
  files: Map<string, File>;
  /** In-flight file fetch promises - prevents duplicate network requests */
  filePromises: Map<string, Promise<File | undefined>>;
  promises: Map<string, Promise<LoaderResult>>;
  results: Map<string, LoaderResult>;
  hdrLoader: HDRLoader;
  texLoader: THREE.TextureLoader;
  gltfLoader: GLTFLoader;
  preloadItems: Array<{ type: string; url: string }> = [];
  vrmHooks?: {
    camera: THREE.Camera;
    scene: THREE.Scene;
    octree: unknown;
    setupMaterial: (material: THREE.Material) => void;
    loader?: ClientLoader;
  };
  preloader?: Promise<void> | null;

  /** Performance statistics for debugging */
  private stats: LoadingStats = {
    filesLoaded: 0,
    requestsDeduped: 0,
    cacheHits: 0,
    indexedDBHits: 0,
    networkRequests: 0,
    totalLoadTime: 0,
  };
  private loadStartTime = 0;

  /**
   * Concurrent fetch semaphore to prevent network saturation.
   * Browsers limit to ~6 connections per domain; too many parallel fetches
   * cause HTTP/2 head-of-line blocking and slow overall throughput.
   */
  private readonly maxConcurrentFetches = 8;
  private activeFetches = 0;
  private fetchQueue: Array<() => void> = [];
  constructor(world: World) {
    super(world, {
      name: "client-loader",
      dependencies: { required: [], optional: [] },
      autoCleanup: true,
    });
    this.files = new Map();
    this.filePromises = new Map();
    this.promises = new Map();
    this.results = new Map();
    this.hdrLoader = new HDRLoader();
    this.texLoader = new THREE.TextureLoader();
    this.gltfLoader = new GLTFLoader();
    // Register VRM loader plugin with proper parser typing
    this.gltfLoader.register(
      (parser: GLTFParser) => new VRMLoaderPlugin(parser),
    );
    // Enable meshopt decoder for compressed GLB files (EXT_meshopt_compression)
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    // Apply texture loader patch to handle blob URL errors
    patchTextureLoader();
  }

  async init(options: WorldOptions): Promise<void> {
    await super.init(options);
  }

  start() {
    this.vrmHooks = {
      camera: this.world.camera,
      scene: this.world.stage.scene,
      octree: this.world.stage.octree,
      setupMaterial: this.world.setupMaterial,
      loader: this.world.loader,
    };
  }

  has(type, url) {
    const key = `${type}/${url}`;
    return this.promises.has(key);
  }

  get(type, url) {
    const key = `${type}/${url}`;
    return this.results.get(key);
  }

  preload(type, url) {
    this.preloadItems.push({ type, url });
  }

  execPreload() {
    if (this.preloadItems.length === 0) {
      this.emitTypedEvent(EventType.ASSETS_LOADING_PROGRESS, {
        progress: 100,
        total: 0,
      });
      return;
    }

    // Track preload timing
    this.loadStartTime = performance.now();

    let loadedItems = 0;
    const totalItems = this.preloadItems.length;
    let progress = 0;

    // Log what we're preloading
    this.logger.info(
      `[ClientLoader] Starting preload of ${totalItems} assets (parallel loading enabled)`,
    );

    // All items are loaded in parallel via Promise.allSettled
    const promises = this.preloadItems.map((item) => {
      return this.load(item.type, item.url)
        .then(() => {
          loadedItems++;
          progress = (loadedItems / totalItems) * 100;
          this.emitTypedEvent(EventType.ASSETS_LOADING_PROGRESS, {
            progress,
            total: totalItems,
          });
        })
        .catch((error) => {
          this.logger.error(
            `Failed to load ${item.type}: ${item.url}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Count failed items toward overall progress so UI can reach 100%
          loadedItems++;
          progress = (loadedItems / totalItems) * 100;
          this.emitTypedEvent(EventType.ASSETS_LOADING_PROGRESS, {
            progress,
            total: totalItems,
          });
          // Re-throw so allSettled can record the failure (for logging/metrics)
          throw error;
        });
    });

    this.preloader = Promise.allSettled(promises).then((results) => {
      const loadDuration = performance.now() - this.loadStartTime;
      const failed = results.filter((r) => r.status === "rejected");

      if (failed.length > 0) {
        this.logger.error(`Some assets failed to load: ${failed.length}`);
      }

      // Log performance summary
      this.logger.info(
        `[ClientLoader] Preload complete in ${loadDuration.toFixed(0)}ms`,
      );
      this.logStats();

      this.preloader = null;
      // Ensure a final 100% progress event is emitted (defensive in case of rounding)
      this.emitTypedEvent(EventType.ASSETS_LOADING_PROGRESS, {
        progress: 100,
        total: totalItems,
      });
      this.world.emit(EventType.READY);

      // Notify server that client is ready - player can now be targeted
      // This completes the client-ready handshake for spawn protection
      const network = this.world.network as
        | { send?: (name: string, data: unknown) => void }
        | undefined;
      if (network?.send) {
        console.log(
          `[PlayerLoading] Assets loaded, sending clientReady to server`,
        );
        console.log(`[PlayerLoading] Total assets loaded: ${totalItems}`);
        network.send("clientReady", {});
      }
    });
  }

  setFile(url, file) {
    this.files.set(url, file);
  }

  getFile(url: string, name?: string): File | undefined {
    url = this.world.resolveURL(url);
    if (name) {
      const file = this.files.get(url);
      if (!file) return undefined;
      return new File([file], name, {
        type: file.type, // Preserve the MIME type
        lastModified: file.lastModified, // Preserve the last modified timestamp
      });
    }
    return this.files.get(url);
  }

  loadFile = async (url: string): Promise<File | undefined> => {
    url = this.world.resolveURL(url);

    // Level 3: Check in-memory cache first (fastest)
    if (this.files.has(url)) {
      this.stats.cacheHits++;
      return this.files.get(url);
    }

    // Check if already loading (deduplication for parallel requests)
    // This prevents multiple fetches for the same URL when called concurrently
    const existingPromise = this.filePromises.get(url);
    if (existingPromise) {
      this.stats.requestsDeduped++;
      return existingPromise;
    }

    // Create and track the fetch promise
    const fetchPromise = (async (): Promise<File | undefined> => {
      try {
        // Level 5: Check IndexedDB persistent cache (survives page reloads)
        const cachedFile = await getFromIndexedDB(url);
        if (cachedFile) {
          this.files.set(url, cachedFile);
          this.stats.indexedDBHits++;
          return cachedFile;
        }

        // Level 1: Fetch from network (with concurrency limiting)
        // Wait for a slot in the semaphore to prevent network saturation
        await this.acquireFetchSlot();

        try {
          this.stats.networkRequests++;
          const fetchStart = performance.now();

          // Use 'default' cache mode to leverage browser HTTP cache
          // This will use cached response if available and not stale
          const resp = await fetch(url, {
            cache: "default",
            mode: "cors",
          });

          if (!resp.ok) {
            throw new Error(`HTTP error! status: ${resp.status}`);
          }

          const blob = await resp.blob();
          const file = new File([blob], url.split("/").pop() as string, {
            type: blob.type,
          });

          // Store in memory cache
          this.files.set(url, file);
          this.stats.filesLoaded++;

          // Save to IndexedDB for persistence (async, non-blocking)
          saveToIndexedDB(url, file);

          // Track load time
          const loadTime = performance.now() - fetchStart;
          this.stats.totalLoadTime += loadTime;

          return file;
        } finally {
          this.releaseFetchSlot();
        }
      } finally {
        // Clean up the in-flight tracker after completion
        this.filePromises.delete(url);
      }
    })();

    this.filePromises.set(url, fetchPromise);
    return fetchPromise;
  };

  /**
   * Get loading statistics for performance monitoring
   */
  getStats(): LoadingStats & {
    modelCacheStats: ReturnType<
      typeof import("../../utils/rendering/ModelCache").modelCache.getStats
    >;
  } {
    // Import dynamically to avoid circular dependency
    // eslint-disable-next-line no-undef
    const { modelCache } = require("../../utils/rendering/ModelCache") as {
      modelCache: {
        getStats: () => {
          total: number;
          paths: string[];
          totalClones: number;
          materialsSaved: number;
        };
      };
    };
    return {
      ...this.stats,
      modelCacheStats: modelCache.getStats(),
    };
  }

  /**
   * Log loading statistics to console
   */
  logStats(): void {
    const stats = this.getStats();
    console.log("[ClientLoader] Loading Statistics:");
    console.log(`  Network downloads: ${stats.filesLoaded}`);
    console.log(`  Memory cache hits: ${stats.cacheHits}`);
    console.log(`  IndexedDB cache hits: ${stats.indexedDBHits}`);
    console.log(`  Requests deduped: ${stats.requestsDeduped}`);
    console.log(`  Total load time: ${stats.totalLoadTime.toFixed(0)}ms`);
    console.log(
      `  Model cache: ${stats.modelCacheStats.total} models, ${stats.modelCacheStats.totalClones} clones`,
    );
    console.log(
      `  Materials saved by sharing: ${stats.modelCacheStats.materialsSaved}`,
    );
  }

  /**
   * Acquire a slot in the fetch semaphore.
   * Limits concurrent network requests to prevent saturation.
   */
  private acquireFetchSlot(): Promise<void> {
    if (this.activeFetches < this.maxConcurrentFetches) {
      this.activeFetches++;
      return Promise.resolve();
    }

    // Queue the request and wait for a slot
    return new Promise<void>((resolve) => {
      this.fetchQueue.push(resolve);
    });
  }

  /**
   * Release a slot in the fetch semaphore.
   * Allows queued requests to proceed.
   */
  private releaseFetchSlot(): void {
    if (this.fetchQueue.length > 0) {
      // Give the slot to the next queued request
      const next = this.fetchQueue.shift()!;
      next();
    } else {
      this.activeFetches--;
    }
  }

  async load(type: string, url: string): Promise<LoaderResult> {
    // NOTE: Removed blocking `await this.preloader` that used to wait for ALL preloads
    // to complete before any new load could start. This was a significant bottleneck.
    // Individual load calls now proceed independently, relying on promise deduplication.

    const key = `${type}/${url}`;
    if (this.promises.has(key)) {
      return this.promises.get(key)!;
    }
    if (type === "video") {
      const promise = new Promise<VideoFactory>((resolve) => {
        url = this.world.resolveURL(url);
        const factory = createVideoFactory(this.world, url);
        resolve(factory);
      });
      this.promises.set(key, promise);
      return promise;
    }
    const promise: Promise<LoaderResult> = this.loadFile(url).then(
      async (file: File | undefined): Promise<LoaderResult> => {
        if (!file) throw new Error(`Failed to load file: ${url}`);
        if (type === "hdr") {
          const buffer = await file.arrayBuffer();
          const result = this.hdrLoader.parse(buffer as ArrayBuffer);
          // we just mimicing what hdrLoader.load() does behind the scenes
          const texture = new THREE.DataTexture(
            result.data,
            result.width,
            result.height,
          );
          texture.colorSpace = THREE.LinearSRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          texture.flipY = true;
          texture.type = result.type;
          texture.needsUpdate = true;
          this.results.set(key, texture);
          return texture;
        }
        if (type === "image") {
          return new Promise<LoaderResult>((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.results.set(key, img);
              resolve(img);
              // URL.revokeObjectURL(img.src)
            };
            img.src = URL.createObjectURL(file);
          });
        }
        if (type === "texture") {
          return new Promise<LoaderResult>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const texture = this.texLoader.load(img.src);
              this.results.set(key, texture);
              resolve(texture);
              URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(file);
          });
        }
        if (type === "model") {
          const buffer = await file.arrayBuffer();
          const gltf = await this.gltfLoader.parseAsync(buffer, "");
          // Convert GLTF to GLBData format
          const glb = {
            scene: gltf.scene,
            animations: gltf.animations || [],
          };
          const node = glbToNodes(glb, this.world);
          const model: LoadedModel = {
            toNodes() {
              const clonedNode = node.clone(true);
              const nodeMap = new Map<string, INode>();
              nodeMap.set("root", nodeToINode(clonedNode));
              return nodeMap;
            },
            getStats() {
              const stats = node.getStats(true);
              // append file size
              stats.fileBytes = file.size;
              return stats;
            },
          };
          this.results.set(key, model);
          return model;
        }
        if (type === "emote") {
          const buffer = await file.arrayBuffer();
          const glb = await this.gltfLoader.parseAsync(buffer, "");
          const factory = createEmoteFactory(
            { ...glb, animations: glb.animations || [] } as GLBData,
            url,
          );
          const emote: LoadedEmote = {
            toNodes() {
              return new Map<string, INode>(); // Emotes don't have nodes
            },
            getStats() {
              return { triangles: 0, texBytes: 0, nodes: 0 }; // Emotes don't have stats
            },
            toClip(options?: {
              rootToHips?: number;
              version?: string;
              getBoneName?: (name: string) => string;
            }) {
              return factory.toClip(options || {}) ?? null;
            },
          };
          this.results.set(key, emote);
          return emote;
        }
        if (type === "avatar") {
          const buffer = await file.arrayBuffer();
          const glb = await this.gltfLoader.parseAsync(buffer, "");
          // Suppress VRM duplicate expression warnings by overriding console.warn temporarily
          const originalWarn = console.warn;
          try {
            console.warn = function () {
              /* suppressed VRM duplicate expression warn */
            } as unknown as typeof console.warn;
            // Intentionally no-op; warnings during factory creation will be silenced
          } finally {
            console.warn = originalWarn;
          }
          const factoryBase = createVRMFactory(
            glb as GLBData,
            this.world.setupMaterial,
          );
          const factory = {
            ...factoryBase,
            uid: file.name || `avatar_${Date.now()}`,
          } as unknown as AvatarFactory;
          const hooks = this.vrmHooks;
          const node = createNode("group", { id: "$root" });
          const node2 = createNode("avatar", { id: "avatar", factory, hooks });
          node.add(node2);
          const avatar: LoadedAvatar = {
            uid: file.name || `avatar_${Date.now()}`,
            factory: factory,
            toNodes(customHooks) {
              const nodeMap = new Map<string, INode>();
              const clone = node.clone(true);
              // Apply custom hooks if provided to the cloned avatar node
              if (customHooks) {
                const clonedAvatar = clone.get("avatar");
                if (clonedAvatar) {
                  Object.assign(clonedAvatar, { hooks: customHooks });
                }
              }
              // Always expose a stable map interface
              nodeMap.set("root", nodeToINode(clone));
              const clonedAvatarForMap = clone.get("avatar");
              if (clonedAvatarForMap) {
                nodeMap.set("avatar", nodeToINode(clonedAvatarForMap));
              }
              return nodeMap;
            },
            getStats() {
              const stats = node.getStats(true);
              // append file size
              stats.fileBytes = file.size;
              return stats;
            },
          };
          this.results.set(key, avatar);
          return avatar;
        }
        if (type === "script") {
          // DISABLED: Script loading from external files
          this.logger.warn(
            "⚠️ Script loading disabled - Attempted to load from file",
          );
          this.logger.warn(
            "Scripts must now be implemented as TypeScript classes",
          );
          throw new Error(
            "Script loading is disabled. Use TypeScript classes instead.",
          );
        }
        if (type === "audio") {
          const buffer = await file.arrayBuffer();
          const audioBuffer =
            await this.world.audio!.ctx.decodeAudioData(buffer);
          this.results.set(key, audioBuffer);
          return audioBuffer;
        }

        // Unknown type - throw error
        throw new Error(`Unsupported loader type: ${type}`);
      },
    );
    this.promises.set(key, promise);
    return promise;
  }

  insert(type, url, file) {
    const key = `${type}/${url}`;
    const localUrl = URL.createObjectURL(file);
    let promise;
    if (type === "hdr") {
      promise = this.hdrLoader
        .loadAsync(localUrl)
        .then((texture) => {
          this.results.set(key, texture);
          return texture;
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
        });
    }
    if (type === "image") {
      promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.results.set(key, img);
          resolve(img);
          URL.revokeObjectURL(localUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(localUrl);
        };
        img.src = localUrl;
      });
    }
    if (type === "video") {
      promise = new Promise((resolve) => {
        const factory = createVideoFactory(this.world, localUrl);
        resolve(factory);
      });
    }
    if (type === "texture") {
      promise = this.texLoader
        .loadAsync(localUrl)
        .then((texture) => {
          this.results.set(key, texture);
          return texture;
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
        });
    }
    if (type === "model") {
      promise = this.gltfLoader
        .loadAsync(localUrl)
        .then((gltf) => {
          // Convert GLTF to GLBData format
          const glb = {
            scene: gltf.scene,
            animations: gltf.animations || [],
          };
          const node = glbToNodes(glb, this.world);
          const model: LoadedModel = {
            toNodes() {
              const clonedNode = node.clone(true);
              const nodeMap = new Map<string, INode>();
              nodeMap.set("root", nodeToINode(clonedNode));
              return nodeMap;
            },
            getStats() {
              const stats = node.getStats(true);
              // append file size
              stats.fileBytes = file.size;
              return stats;
            },
          };
          this.results.set(key, model);
          return model;
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
        });
    }
    if (type === "emote") {
      promise = this.gltfLoader
        .loadAsync(localUrl)
        .then((glb) => {
          const factory = createEmoteFactory(glb as GLBData, url);
          const emote: LoadedEmote = {
            toNodes() {
              return new Map<string, INode>(); // Emotes don't have nodes
            },
            getStats() {
              return { triangles: 0, texBytes: 0, nodes: 0 }; // Emotes don't have stats
            },
            toClip(_options?: {
              rootToHips?: number;
              version?: string;
              getBoneName?: (name: string) => string;
            }) {
              return factory.toClip({}) ?? null;
            },
          };
          this.results.set(key, emote);
          return emote;
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
        });
    }
    if (type === "avatar") {
      this.logger.info(`Loading avatar from: ${localUrl}`);
      console.log("[ClientLoader] Loading VRM from:", localUrl);
      promise = this.gltfLoader
        .loadAsync(localUrl)
        .then((glb) => {
          this.logger.info("Avatar GLB loaded");
          console.log("[ClientLoader] VRM GLB loaded, checking userData...", {
            hasVRM: !!glb.userData?.vrm,
          });
          const factoryBase = createVRMFactory(
            glb as GLBData,
            this.world.setupMaterial,
          );
          console.log("[ClientLoader] VRM factory created");
          const factory = {
            ...factoryBase,
            uid: file.name || `avatar_${Date.now()}`,
          } as unknown as AvatarFactory;
          const hooks = this.vrmHooks;
          const node = createNode("group", { id: "$root" });
          const node2 = createNode("avatar", { id: "avatar", factory, hooks });
          this.logger.info(`Created avatar node2: id=${node2.id}`);

          // Add avatar to root
          node.add(node2);

          this.logger.info(`After add: rootChildren=${node.children.length}`);

          // Verify the structure is correct
          const verifyGet = node.get("avatar");
          this.logger.info(
            `Verify node.get("avatar"): ${verifyGet ? "FOUND" : "NOT FOUND"}`,
          );

          const logger = this.logger;
          const avatar: LoadedAvatar = {
            uid: file.name || `avatar_${Date.now()}`,
            factory: factory,
            toNodes(customHooks) {
              logger.info("toNodes called");

              // Test get() on original node
              const originalAvatar = node.get("avatar");
              logger.info(
                `Original node.get("avatar"): ${originalAvatar ? "FOUND" : "NOT FOUND"}`,
              );

              // Clone the node tree
              const clone = node.clone(true);
              logger.info(
                `After clone: cloneChildren=${clone.children.length}`,
              );

              // Test get() on cloned node
              const clonedAvatar = clone.get("avatar");
              logger.info(
                `Clone.get("avatar"): ${clonedAvatar ? "FOUND" : "NOT FOUND"}`,
              );

              // Apply custom hooks if provided
              if (customHooks && clonedAvatar) {
                Object.assign(clonedAvatar, { hooks: customHooks });
              }

              // Create the map with both root and avatar nodes
              const nodeMap = new Map<string, INode>();
              nodeMap.set("root", nodeToINode(clone));

              let avatarForMap = clonedAvatar;
              if (!avatarForMap && clone.children.length > 0) {
                logger.warn("Using first child");
                avatarForMap = clone.children[0];
              }

              if (avatarForMap) {
                nodeMap.set("avatar", nodeToINode(avatarForMap));
                logger.info("Added avatar to map");
              } else {
                logger.error("NO AVATAR FOUND TO ADD TO MAP!");
              }

              logger.info(
                `Final nodeMap keys: ${Array.from(nodeMap.keys()).join(",")}`,
              );
              return nodeMap;
            },
            getStats() {
              const stats = node.getStats(true);
              // append file size
              stats.fileBytes = file.size;
              return stats;
            },
          };
          this.results.set(key, avatar);
          return avatar;
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
        });
    }
    if (type === "script") {
      // DISABLED: Script loading from external files
      console.warn(
        `[ClientLoader] ⚠️ Script loading disabled - Attempted to load: ${url}`,
      );
      console.warn(
        `[ClientLoader] Scripts must now be implemented as TypeScript classes`,
      );
      promise = Promise.reject(
        new Error(
          "Script loading is disabled. Use TypeScript classes instead.",
        ),
      );
    }
    if (type === "audio") {
      promise = (async () => {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer =
          await this.world.audio!.ctx.decodeAudioData(arrayBuffer);
        this.results.set(key, audioBuffer);
        return audioBuffer;
      })();
    }
    this.promises.set(key, promise);
  }

  destroy() {
    this.files.clear();
    this.filePromises.clear();
    this.promises.clear();
    this.results.clear();
    this.preloadItems = [];
    // Reset fetch semaphore
    this.activeFetches = 0;
    this.fetchQueue = [];
    // Reset stats
    this.stats = {
      filesLoaded: 0,
      requestsDeduped: 0,
      cacheHits: 0,
      indexedDBHits: 0,
      networkRequests: 0,
      totalLoadTime: 0,
    };
  }

  /**
   * Clear all caches including IndexedDB persistent cache
   * Useful for forcing fresh downloads
   */
  async clearAllCaches(): Promise<void> {
    // Clear in-memory caches
    this.files.clear();
    this.filePromises.clear();
    this.promises.clear();
    this.results.clear();

    // Clear IndexedDB cache
    const db = await initAssetDB();
    if (db) {
      try {
        const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
        const store = transaction.objectStore(ASSET_STORE_NAME);
        store.clear();
        console.log("[ClientLoader] IndexedDB cache cleared");
      } catch {
        // Ignore errors
      }
    }

    // Clear THREE.Cache
    THREE.Cache.clear();

    console.log("[ClientLoader] All caches cleared");
  }
}

function createVideoFactory(world, url) {
  const isHLS = url?.endsWith(".m3u8");
  const sources = {};
  let width;
  let height;
  let duration;
  let ready = false;
  let prepare;
  function createSource(key) {
    const elem = document.createElement("video");
    elem.crossOrigin = "anonymous";
    elem.playsInline = true;
    elem.loop = false;
    elem.muted = true;
    elem.style.width = "1px";
    elem.style.height = "1px";
    elem.style.position = "absolute";
    elem.style.opacity = "0";
    elem.style.zIndex = "-1000";
    elem.style.pointerEvents = "none";
    elem.style.overflow = "hidden";
    const needsPolyfill =
      isHLS &&
      !elem.canPlayType("application/vnd.apple.mpegurl") &&
      Hls.isSupported();
    if (needsPolyfill) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(elem);
    } else {
      elem.src = url;
    }
    const audio = world.audio.ctx.createMediaElementSource(elem);
    let n = 0;
    let dead;
    world.audio.ready(() => {
      if (dead) return;
      elem.muted = false;
    });
    // set linked=false to have a separate source (and texture)
    const texture = new THREE.VideoTexture(elem);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = world.graphics.maxAnisotropy;
    if (!prepare) {
      prepare = (function () {
        /**
         *
         * A regular video will load data automatically BUT a stream
         * needs to hit play() before it gets that data.
         *
         * The following code handles this for us, and when streaming
         * will hit play just until we get the data needed, then pause.
         */
        return new Promise<void>((resolve) => {
          let playing = false;
          let data = false;
          elem.addEventListener(
            "loadeddata",
            () => {
              // if we needed to hit play to fetch data then revert back to paused
              if (playing) elem.pause();
              data = true;
              // await new Promise(resolve => setTimeout(resolve, 2000))
              width = elem.videoWidth;
              height = elem.videoHeight;
              duration = elem.duration;
              ready = true;
              resolve();
            },
            { once: true },
          );
          elem.addEventListener(
            "loadedmetadata",
            () => {
              // we need a gesture before we can potentially hit play
              // await this.engine.driver.gesture
              // if we already have data do nothing, we're done!
              if (data) return;
              // otherwise hit play to force data loading for streams
              elem.play();
              playing = true;
            },
            { once: true },
          );
        });
      })();
    }
    function isPlaying() {
      return (
        elem.currentTime > 0 &&
        !elem.paused &&
        !elem.ended &&
        elem.readyState > 2
      );
    }
    function play(restartIfPlaying = false) {
      if (restartIfPlaying) elem.currentTime = 0;
      elem.play();
    }
    function pause() {
      elem.pause();
    }
    function stop() {
      elem.currentTime = 0;
      elem.pause();
    }
    function release() {
      n--;
      if (n === 0) {
        stop();
        audio.disconnect();
        texture.dispose();
        document.body.removeChild(elem);
        delete sources[key];
        // help to prevent chrome memory leaks
        // see: https://github.com/facebook/react/issues/15583#issuecomment-490912533
        elem.src = "";
        elem.load();
      }
    }
    const handle = {
      elem,
      audio,
      texture,
      prepare,
      get ready() {
        return ready;
      },
      get width() {
        return width;
      },
      get height() {
        return height;
      },
      get duration() {
        return duration;
      },
      get loop() {
        return elem.loop;
      },
      set loop(value) {
        elem.loop = value;
      },
      get isPlaying() {
        return isPlaying();
      },
      get currentTime() {
        return elem.currentTime;
      },
      set currentTime(value) {
        elem.currentTime = value;
      },
      play,
      pause,
      stop,
      release,
    };
    return {
      createHandle() {
        n++;
        if (n === 1) {
          document.body.appendChild(elem);
        }
        return handle;
      },
    };
  }
  return {
    get(key) {
      let source = sources[key];
      if (!source) {
        source = createSource(key);
        sources[key] = source;
      }
      return source.createHandle();
    },
  };
}
