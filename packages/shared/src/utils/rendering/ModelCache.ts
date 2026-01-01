/**
 * Model Cache System
 *
 * Loads 3D models once and caches them for reuse across multiple entity instances.
 * This prevents loading the same GLB file hundreds of times for items/mobs.
 *
 * IMPORTANT: Materials are set up for WebGPU/CSM compatibility automatically.
 */

import THREE from "../../extras/three/three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { World } from "../../core/World";

interface CachedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  loadedAt: number;
  cloneCount: number;
  /** Shared materials for this model type (one material per mesh index) */
  sharedMaterials: Map<number, THREE.Material | THREE.Material[]>;
}

export class ModelCache {
  private static instance: ModelCache;
  private cache = new Map<string, CachedModel>();
  private loading = new Map<string, Promise<CachedModel>>();
  private gltfLoader: GLTFLoader;
  /**
   * Track all materials managed by the cache to prevent premature disposal.
   * When entities are destroyed, they should NOT dispose materials in this set.
   */
  private managedMaterials = new WeakSet<THREE.Material>();

  private constructor() {
    // Use our own GLTFLoader to ensure we get pure THREE.Object3D (not Hyperscape Nodes)
    this.gltfLoader = new GLTFLoader();
    // Enable meshopt decoder for compressed GLB files (EXT_meshopt_compression)
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  static getInstance(): ModelCache {
    if (!ModelCache.instance) {
      ModelCache.instance = new ModelCache();
    }
    return ModelCache.instance;
  }

  /**
   * Check if a material is managed by the cache.
   * Managed materials should NOT be disposed when entities are destroyed,
   * as they are shared across all instances of a model type.
   */
  isManagedMaterial(material: THREE.Material): boolean {
    return this.managedMaterials.has(material);
  }

  /**
   * Convert a material to MeshStandardMaterial for proper PBR lighting
   * This ensures models respond correctly to sun, moon, and environment maps
   */
  private convertToStandardMaterial(
    mat: THREE.Material,
    hasVertexColors = false,
  ): THREE.MeshStandardMaterial {
    // Extract textures and colors from original material
    const originalMat = mat as THREE.Material & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      emissiveMap?: THREE.Texture | null;
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      opacity?: number;
      transparent?: boolean;
      alphaTest?: number;
      side?: THREE.Side;
      vertexColors?: boolean;
    };

    const newMat = new THREE.MeshStandardMaterial({
      map: originalMat.map || null,
      normalMap: originalMat.normalMap || null,
      emissiveMap: originalMat.emissiveMap || null,
      color: originalMat.color?.clone() || new THREE.Color(0xffffff),
      emissive: originalMat.emissive?.clone() || new THREE.Color(0x000000),
      emissiveIntensity: originalMat.emissiveIntensity ?? 0,
      opacity: originalMat.opacity ?? 1,
      transparent: originalMat.transparent ?? false,
      alphaTest: originalMat.alphaTest ?? 0,
      side: originalMat.side ?? THREE.FrontSide,
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: 1.0, // Respond to environment map
      // Enable vertex colors if the geometry has them
      vertexColors: hasVertexColors || originalMat.vertexColors || false,
    });

    // Copy name for debugging
    newMat.name = originalMat.name || "GLB_Standard";

    // Dispose old material
    originalMat.dispose();

    return newMat;
  }

  /**
   * Setup materials for WebGPU/CSM compatibility
   * This ensures proper shadows and rendering
   * Also converts non-PBR materials to MeshStandardMaterial for proper lighting
   */
  private setupMaterials(scene: THREE.Object3D, world?: World): void {
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        const mesh = node;

        // Check if geometry has vertex colors
        const hasVertexColors = mesh.geometry?.attributes?.color !== undefined;

        // Convert materials to MeshStandardMaterial for proper sun/moon/environment lighting
        const convertMaterial = (mat: THREE.Material): THREE.Material => {
          // If already a PBR material, just set it up (and enable vertex colors if needed)
          if (
            mat instanceof THREE.MeshStandardMaterial ||
            mat instanceof THREE.MeshPhysicalMaterial
          ) {
            // Enable vertex colors if geometry has them
            if (hasVertexColors && !mat.vertexColors) {
              mat.vertexColors = true;
              mat.needsUpdate = true;
            }
            this.setupSingleMaterial(mat, world);
            return mat;
          }
          // Convert non-PBR materials (MeshBasicMaterial, MeshPhongMaterial, etc.)
          const newMat = this.convertToStandardMaterial(mat, hasVertexColors);
          this.setupSingleMaterial(newMat, world);
          return newMat;
        };

        // Handle material arrays
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => convertMaterial(mat));
        } else {
          mesh.material = convertMaterial(mesh.material);
        }

        // Enable shadows
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // For skinned meshes, disable frustum culling
        if (mesh instanceof THREE.SkinnedMesh) {
          mesh.frustumCulled = false; // Prevent culling issues with animated meshes
          // NOTE: Do NOT bind skeleton here - entities will handle it after scaling
        }
      }
    });
  }

  /**
   * Extract and store materials from a scene for sharing across clones.
   * Called once when a model is first loaded.
   * Also registers materials in managedMaterials WeakSet to prevent premature disposal.
   */
  private extractSharedMaterials(
    scene: THREE.Object3D,
  ): Map<number, THREE.Material | THREE.Material[]> {
    const sharedMaterials = new Map<
      number,
      THREE.Material | THREE.Material[]
    >();
    let meshIndex = 0;

    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        // Store the material(s) for this mesh index
        if (Array.isArray(node.material)) {
          sharedMaterials.set(meshIndex, [...node.material]);
          // Track each material in the managed set
          node.material.forEach((mat) => this.managedMaterials.add(mat));
        } else {
          sharedMaterials.set(meshIndex, node.material);
          // Track the material in the managed set
          this.managedMaterials.add(node.material);
        }
        meshIndex++;
      }
    });

    return sharedMaterials;
  }

  /**
   * Apply shared materials to a cloned scene.
   * This reuses materials instead of cloning them, reducing draw call overhead.
   */
  private applySharedMaterials(
    scene: THREE.Object3D,
    sharedMaterials: Map<number, THREE.Material | THREE.Material[]>,
  ): void {
    let meshIndex = 0;

    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        const shared = sharedMaterials.get(meshIndex);
        if (shared) {
          node.material = shared;
        }
        meshIndex++;
      }
    });
  }

  /**
   * Setup a single material for WebGPU/CSM
   */
  private setupSingleMaterial(material: THREE.Material, world?: World): void {
    // Call world's setupMaterial for CSM integration
    if (world && world.setupMaterial) {
      world.setupMaterial(material);
    }

    // Ensure shadowSide is set (prevents shadow acne)
    (material as THREE.Material & { shadowSide?: THREE.Side }).shadowSide =
      THREE.BackSide;

    // Ensure material can receive fog
    (material as THREE.Material & { fog?: boolean }).fog = true;

    // For WebGPU compatibility, ensure color space is correct
    // Strong type assumption - these material types have map and emissiveMap
    const materialWithMaps = material as THREE.Material & {
      map?: THREE.Texture | null;
      emissiveMap?: THREE.Texture | null;
    };

    if (
      material instanceof THREE.MeshStandardMaterial ||
      material instanceof THREE.MeshPhysicalMaterial
    ) {
      // Set up texture color spaces
      if (materialWithMaps.map) {
        materialWithMaps.map.colorSpace = THREE.SRGBColorSpace;
      }
      if (materialWithMaps.emissiveMap) {
        materialWithMaps.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      }
      // Ensure environment map intensity is set for proper IBL lighting
      material.envMapIntensity = material.envMapIntensity ?? 1.0;
    } else if (
      material instanceof THREE.MeshBasicMaterial ||
      material instanceof THREE.MeshPhongMaterial
    ) {
      // Set up texture color spaces for non-PBR materials
      if (materialWithMaps.map) {
        materialWithMaps.map.colorSpace = THREE.SRGBColorSpace;
      }
      if (materialWithMaps.emissiveMap) {
        materialWithMaps.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      }
    }

    // Mark material for update
    material.needsUpdate = true;
  }

  /**
   * Load a model (with caching)
   * Returns a cloned scene ready to use with materials properly set up
   *
   * NOTE: This returns pure THREE.Object3D, NOT Hyperscape Nodes!
   * Use world.loader.load('model', url) if you need Hyperscape Nodes.
   *
   * @param path - Model path (can be asset:// URL or absolute URL)
   * @param world - World instance for URL resolution and material setup
   * @param options.shareMaterials - If true, all instances share the same material (reduces draw calls)
   */
  async loadModel(
    path: string,
    world?: World,
    options?: { shareMaterials?: boolean },
  ): Promise<{
    scene: THREE.Object3D;
    animations: THREE.AnimationClip[];
    fromCache: boolean;
  }> {
    const shareMaterials = options?.shareMaterials ?? true; // Default to sharing
    // Resolve asset:// URLs to actual URLs
    // NOTE: World.resolveURL already adds cache-busting for localhost URLs
    let resolvedPath = world ? world.resolveURL(path) : path;

    // CRITICAL: If resolveURL failed (returned asset:// unchanged), manually resolve
    if (resolvedPath.startsWith("asset://")) {
      // Fallback: Use CDN URL from window or default to localhost
      const cdnUrl =
        (typeof window !== "undefined" &&
          (window as Window & { __CDN_URL?: string }).__CDN_URL) ||
        world?.assetsUrl?.replace(/\/$/, "") ||
        "http://localhost:8080";
      resolvedPath = resolvedPath.replace("asset://", `${cdnUrl}/`);
    }

    // Check cache first (use resolved path as key)
    const cached = this.cache.get(resolvedPath);
    if (cached) {
      // CRITICAL: Verify cached scene is pure THREE.Object3D
      if ("ctx" in cached.scene || "isDirty" in cached.scene) {
        console.error(
          "[ModelCache] Cached model is a Hyperscape Node, not THREE.Object3D! Clearing cache...",
        );
        this.cache.delete(resolvedPath);
        // Retry load with fresh GLTFLoader
        return this.loadModel(path, world);
      }

      cached.cloneCount++;

      // Clone the scene for this instance
      const clonedScene = cached.scene.clone(true);

      if (shareMaterials && cached.sharedMaterials.size > 0) {
        // Reuse shared materials (reduces draw calls)
        this.applySharedMaterials(clonedScene, cached.sharedMaterials);
      } else {
        // Create new materials for this clone (allows custom tinting)
        this.setupMaterials(clonedScene, world);
      }

      return {
        scene: clonedScene,
        animations: cached.animations,
        fromCache: true,
      };
    }

    // Check if already loading (use resolved path as key)
    const loadingPromise = this.loading.get(resolvedPath);
    if (loadingPromise) {
      const result = await loadingPromise;
      result.cloneCount++;
      const clonedScene = result.scene.clone(true);

      if (shareMaterials && result.sharedMaterials.size > 0) {
        // Reuse shared materials (reduces draw calls)
        this.applySharedMaterials(clonedScene, result.sharedMaterials);
      } else {
        // Create new materials for this clone
        this.setupMaterials(clonedScene, world);
      }

      return {
        scene: clonedScene,
        animations: result.animations,
        fromCache: true,
      };
    }

    // Load for the first time
    // Use ClientLoader for file fetching to benefit from IndexedDB caching
    const promise = (async () => {
      let gltf: Awaited<ReturnType<typeof this.gltfLoader.parseAsync>>;

      // Try to use ClientLoader for caching benefits (IndexedDB, deduplication)
      if (world?.loader?.loadFile) {
        const file = await world.loader.loadFile(resolvedPath);
        if (file) {
          const buffer = await file.arrayBuffer();
          gltf = await this.gltfLoader.parseAsync(buffer, "");
        } else {
          // Fallback to direct load if file fetch failed
          gltf = await this.gltfLoader.loadAsync(resolvedPath);
        }
      } else {
        // No ClientLoader available, use direct load
        gltf = await this.gltfLoader.loadAsync(resolvedPath);
      }

      return gltf;
    })()
      .then((gltf) => {
        // CRITICAL: Verify we got a pure THREE.Object3D, not a Hyperscape Node
        if ("ctx" in gltf.scene || "isDirty" in gltf.scene) {
          console.error(
            "[ModelCache] ERROR: GLTFLoader returned Hyperscape Node instead of THREE.Object3D!",
          );
          console.error(
            "[ModelCache] Scene type:",
            gltf.scene.constructor.name,
          );
          throw new Error(
            "ModelCache received Hyperscape Node - this indicates a loader system conflict",
          );
        }

        // CRITICAL: Setup materials on the original scene for WebGPU/CSM
        // This ensures all clones will have properly configured materials
        this.setupMaterials(gltf.scene, world);

        // Extract materials for sharing across clones
        const sharedMaterials = this.extractSharedMaterials(gltf.scene);

        const cachedModel: CachedModel = {
          scene: gltf.scene,
          animations: gltf.animations,
          loadedAt: Date.now(),
          cloneCount: 0,
          sharedMaterials,
        };

        this.cache.set(resolvedPath, cachedModel);
        this.loading.delete(resolvedPath);

        return cachedModel;
      })
      .catch((error) => {
        this.loading.delete(resolvedPath);
        throw error;
      });

    this.loading.set(resolvedPath, promise);
    const result = await promise;
    result.cloneCount++;

    const clonedScene = result.scene.clone(true);

    // FINAL VALIDATION: Ensure we're returning pure THREE.Object3D
    if ("ctx" in clonedScene || "isDirty" in clonedScene) {
      console.error(
        "[ModelCache] CRITICAL: Cloned scene is a Hyperscape Node!",
      );
      console.error(
        "[ModelCache] This should never happen. Scene type:",
        clonedScene.constructor.name,
      );
      throw new Error(
        "ModelCache clone produced Hyperscape Node instead of THREE.Object3D",
      );
    }

    if (shareMaterials && result.sharedMaterials.size > 0) {
      // Reuse shared materials (reduces draw calls)
      this.applySharedMaterials(clonedScene, result.sharedMaterials);
    } else {
      // Create new materials for this clone
      this.setupMaterials(clonedScene, world);
    }

    return {
      scene: clonedScene,
      animations: result.animations,
      fromCache: false,
    };
  }

  /**
   * Check if a model is cached
   */
  has(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    total: number;
    paths: string[];
    totalClones: number;
    materialsSaved: number;
  } {
    const paths: string[] = [];
    let totalClones = 0;
    let materialsSaved = 0;

    for (const [path, model] of this.cache.entries()) {
      paths.push(path);
      totalClones += model.cloneCount;
      // Each clone after the first shares materials instead of creating new ones
      if (model.cloneCount > 1) {
        materialsSaved += (model.cloneCount - 1) * model.sharedMaterials.size;
      }
    }

    return {
      total: this.cache.size,
      paths,
      totalClones,
      materialsSaved, // Number of materials NOT created due to sharing
    };
  }

  /**
   * Clear the cache (useful for hot reload)
   * Should be called when code is rebuilt to prevent stale Hyperscape Nodes
   */
  clear(): void {
    this.cache.clear();
    this.loading.clear();
  }

  /**
   * Clear cache and verify all entries are pure THREE.Object3D
   * Call this on world initialization to ensure clean state
   */
  resetAndVerify(): void {
    this.clear();
  }

  /**
   * Remove a specific model from cache
   */
  remove(path: string): boolean {
    return this.cache.delete(path);
  }

  /**
   * Count meshes in a scene
   */
  private countMeshes(scene: THREE.Object3D): number {
    let count = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        count++;
      }
    });
    return count;
  }

  /**
   * Count skinned meshes in a scene
   */
  private countSkinnedMeshes(scene: THREE.Object3D): number {
    let count = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        count++;
      }
    });
    return count;
  }
}

// Export singleton instance
export const modelCache = ModelCache.getInstance();
