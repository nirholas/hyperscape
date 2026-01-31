/**
 * Model Cache System
 *
 * Loads 3D models once and caches them for reuse across multiple entity instances.
 * This prevents loading the same GLB file hundreds of times for items/mobs.
 *
 * IMPORTANT: Materials are set up for WebGPU/CSM compatibility automatically.
 *
 * LOD Integration:
 * - Automatically generates LOD levels (LOD1, LOD2) via mesh decimation
 * - Automatically bakes octahedral impostors for distant rendering
 * - LODs are cached in IndexedDB for persistence across sessions
 * - Enable via options.generateLODs when loading
 */

import THREE, { MeshStandardNodeMaterial } from "../../extras/three/three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { World } from "../../core/World";
import {
  lodManager,
  type LODBundle,
  type LODCategory,
  type LODGenerationOptions,
} from "./LODManager";

/**
 * Collision data embedded in GLB extras by inject-model-collision.ts
 * This is the AAA approach - collision travels with the asset.
 */
export interface ModelCollisionData {
  /** Footprint in tiles at scale 1.0 */
  footprint: { width: number; depth: number };
  /** Bounding box in model space */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /** Model dimensions (max - min) */
  dimensions: { x: number; y: number; z: number };
}

interface CachedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  loadedAt: number;
  cloneCount: number;
  /** Shared materials for this model type (one material per mesh index) */
  sharedMaterials: Map<number, THREE.Material | THREE.Material[]>;
  /** Collision data from GLB extras (if present) */
  collision?: ModelCollisionData;
  /** LOD bundle with decimated meshes and impostor (if generated) */
  lodBundle?: LODBundle;
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
   * Convert a material to MeshStandardNodeMaterial for proper PBR lighting with WebGPU/TSL support.
   * This ensures models respond correctly to sun, moon, and environment maps,
   * and enables WebGPU-native TSL dissolve effects (DistanceFade).
   */
  private convertToStandardMaterial(
    mat: THREE.Material,
    hasVertexColors = false,
  ): MeshStandardNodeMaterial {
    // Extract textures and colors from original material (handles MeshStandardMaterial, MeshPhysicalMaterial, etc.)
    const originalMat = mat as THREE.Material & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      normalScale?: THREE.Vector2;
      emissiveMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      aoMapIntensity?: number;
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
      envMapIntensity?: number;
      opacity?: number;
      transparent?: boolean;
      alphaTest?: number;
      side?: THREE.Side;
      vertexColors?: boolean;
      flatShading?: boolean;
      fog?: boolean;
    };

    // Create WebGPU-compatible MeshStandardNodeMaterial
    const newMat = new MeshStandardNodeMaterial();

    // Copy color properties
    newMat.color = originalMat.color?.clone() || new THREE.Color(0xffffff);
    newMat.emissive =
      originalMat.emissive?.clone() || new THREE.Color(0x000000);
    newMat.emissiveIntensity = originalMat.emissiveIntensity ?? 0;

    // Copy PBR properties (preserve original values from MeshStandardMaterial)
    newMat.roughness = originalMat.roughness ?? 0.7;
    newMat.metalness = originalMat.metalness ?? 0.0;
    newMat.envMapIntensity = originalMat.envMapIntensity ?? 1.0;

    // Copy transparency/alpha properties
    newMat.opacity = originalMat.opacity ?? 1;
    newMat.transparent = originalMat.transparent ?? false;
    newMat.alphaTest = originalMat.alphaTest ?? 0;
    newMat.side = originalMat.side ?? THREE.FrontSide;

    // Copy other rendering properties
    newMat.flatShading = originalMat.flatShading ?? false;
    newMat.fog = originalMat.fog ?? true;

    // Enable vertex colors if the geometry has them
    newMat.vertexColors = hasVertexColors || originalMat.vertexColors || false;

    // Copy texture maps (only if they have actual values)
    if (originalMat.map) newMat.map = originalMat.map;
    if (originalMat.normalMap) {
      newMat.normalMap = originalMat.normalMap;
      if (originalMat.normalScale)
        newMat.normalScale.copy(originalMat.normalScale);
    }
    if (originalMat.emissiveMap) newMat.emissiveMap = originalMat.emissiveMap;
    if (originalMat.roughnessMap)
      newMat.roughnessMap = originalMat.roughnessMap;
    if (originalMat.metalnessMap)
      newMat.metalnessMap = originalMat.metalnessMap;
    if (originalMat.aoMap) {
      newMat.aoMap = originalMat.aoMap;
      newMat.aoMapIntensity = originalMat.aoMapIntensity ?? 1.0;
    }

    // Copy name for debugging
    newMat.name = originalMat.name || "GLB_NodeMaterial";

    // Dispose old material
    originalMat.dispose();

    return newMat;
  }

  /**
   * Bake all transforms into geometry.
   *
   * Uses the same approach as AssetNormalizationService in asset-forge.
   * This applies world transforms to geometry using Three.js's built-in
   * applyMatrix4 method, then resets all node transforms to identity.
   *
   * This handles all GLTF export variations:
   * - Transforms in position/rotation/scale
   * - Transforms baked into matrix
   * - Non-decomposable transforms (shear)
   *
   * Called ONCE when a model is first loaded, before caching.
   */
  private bakeTransformsToGeometry(scene: THREE.Object3D): void {
    // Ensure all matrices are up to date
    scene.updateMatrixWorld(true);

    // Apply transforms to each mesh's geometry
    scene.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !(child instanceof THREE.SkinnedMesh) &&
        child.geometry
      ) {
        // Clone geometry to avoid modifying shared geometry
        child.geometry = child.geometry.clone();

        // Apply world matrix to geometry (Three.js built-in method)
        // This handles positions, normals, and other attributes correctly
        child.geometry.applyMatrix4(child.matrixWorld);

        // Reset transform to identity
        child.position.set(0, 0, 0);
        child.rotation.set(0, 0, 0);
        child.scale.set(1, 1, 1);
        child.updateMatrix();
      }
    });

    // CRITICAL: Reset ALL node transforms to identity, not just meshes and root.
    // Intermediate Group/Object3D nodes can have transforms that would be
    // applied during rendering, causing double-transform issues (squishing).
    scene.traverse((child) => {
      if (child !== scene) {
        // Skip meshes - already handled above
        if (!(child instanceof THREE.Mesh)) {
          child.position.set(0, 0, 0);
          child.rotation.set(0, 0, 0);
          child.scale.set(1, 1, 1);
          child.updateMatrix();
        }
      }
    });

    // Reset root transform
    scene.position.set(0, 0, 0);
    scene.rotation.set(0, 0, 0);
    scene.scale.set(1, 1, 1);
    scene.updateMatrixWorld(true);
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

        // Convert ALL materials to MeshStandardNodeMaterial for WebGPU-native TSL dissolve support
        // This is required for DistanceFade dissolve effects to work on loaded models
        const convertMaterial = (mat: THREE.Material): THREE.Material => {
          // If already a MeshStandardNodeMaterial, just set it up
          if (mat instanceof MeshStandardNodeMaterial) {
            if (hasVertexColors && !mat.vertexColors) {
              mat.vertexColors = true;
              mat.needsUpdate = true;
            }
            this.setupSingleMaterial(mat, world);
            return mat;
          }
          // Convert ALL other materials (including MeshStandardMaterial) to MeshStandardNodeMaterial
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
   * @param options.generateLODs - If true, generates LOD1/LOD2 meshes and impostor atlas
   * @param options.lodCategory - Category for LOD presets (tree, bush, rock, etc.)
   * @param options.priority - Loading priority (uses LoadPriority enum from types)
   * @param options.position - World position for distance-based priority calculation
   * @param options.tile - Tile coordinates for tile-based priority calculation
   */
  async loadModel(
    path: string,
    world?: World,
    options?: {
      shareMaterials?: boolean;
      generateLODs?: boolean;
      lodCategory?: LODCategory;
      lodOptions?: Omit<LODGenerationOptions, "category">;
      /** Loading priority (0=CRITICAL, 1=HIGH, 2=NORMAL, 3=LOW, 4=PREFETCH) */
      priority?: number;
      /** World position for distance-based priority calculation */
      position?: THREE.Vector3;
      /** Tile coordinates for tile-based priority calculation */
      tile?: { x: number; z: number };
    },
  ): Promise<{
    scene: THREE.Object3D;
    animations: THREE.AnimationClip[];
    fromCache: boolean;
    /** Collision data from GLB extras (if present) */
    collision?: ModelCollisionData;
    /** LOD bundle with decimated meshes and impostor (if generateLODs was true) */
    lodBundle?: LODBundle;
  }> {
    const shareMaterials = options?.shareMaterials ?? true; // Default to sharing
    const generateLODs = options?.generateLODs ?? false;
    // Resolve asset:// URLs to actual URLs
    // NOTE: World.resolveURL already adds cache-busting for localhost URLs
    let resolvedPath = world ? world.resolveURL(path) : path;

    // CRITICAL: If resolveURL failed (returned asset:// unchanged), manually resolve
    if (resolvedPath.startsWith("asset://")) {
      // Fallback: Use CDN URL from window or assetsUrl
      const cdnUrl =
        (typeof window !== "undefined" &&
          (window as Window & { __CDN_URL?: string }).__CDN_URL) ||
        world?.assetsUrl?.replace(/\/$/, "");

      if (!cdnUrl) {
        console.error(
          `[ModelCache] CRITICAL: Cannot resolve asset:// URL - no CDN configured. ` +
            `Set window.__CDN_URL or world.assetsUrl. Path: ${path}`,
        );
        throw new Error(
          `Cannot resolve asset:// URL: no CDN configured for ${path}`,
        );
      }
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

      // Check if cached scene was mutated and needs reload
      let cachedHasMutation = false;
      cached.scene.traverse((child) => {
        const s = child.scale;
        if (s.x !== 1 || s.y !== 1 || s.z !== 1) {
          cachedHasMutation = true;
        }
      });
      if (cachedHasMutation) {
        this.cache.delete(resolvedPath);
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

      // Generate LODs if requested and not already cached
      let lodBundle = cached.lodBundle;
      if (generateLODs && !lodBundle && world) {
        lodBundle = await this.generateLODsForModel(
          resolvedPath,
          cached.scene,
          world,
          options?.lodCategory,
          options?.lodOptions,
        );
        cached.lodBundle = lodBundle;
      }

      return {
        scene: clonedScene,
        animations: cached.animations,
        fromCache: true,
        collision: cached.collision,
        lodBundle,
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

      // Generate LODs if requested and not already cached
      let lodBundle = result.lodBundle;
      if (generateLODs && !lodBundle && world) {
        lodBundle = await this.generateLODsForModel(
          resolvedPath,
          result.scene,
          world,
          options?.lodCategory,
          options?.lodOptions,
        );
        result.lodBundle = lodBundle;
      }

      return {
        scene: clonedScene,
        animations: result.animations,
        fromCache: true,
        collision: result.collision,
        lodBundle,
      };
    }

    // Load for the first time
    // Use ClientLoader for file fetching to benefit from IndexedDB caching and priority loading
    const promise = (async () => {
      let gltf: Awaited<ReturnType<typeof this.gltfLoader.parseAsync>>;

      // Try to use ClientLoader for caching benefits (IndexedDB, deduplication)
      if (world?.loader) {
        const loader = world.loader as {
          loadFile: (url: string) => Promise<File | undefined>;
          loadFileWithPriority?: (
            url: string,
            priority: number,
            opts?: {
              position?: THREE.Vector3;
              tile?: { x: number; z: number };
            },
          ) => Promise<File | undefined>;
        };

        let file: File | undefined;

        // Use priority-based loading if priority is specified and loader supports it
        if (options?.priority !== undefined && loader.loadFileWithPriority) {
          file = await loader.loadFileWithPriority(
            resolvedPath,
            options.priority,
            {
              position: options.position,
              tile: options.tile,
            },
          );
        } else {
          // Standard loading (immediate, high priority)
          file = await loader.loadFile(resolvedPath);
        }

        if (file) {
          const buffer = await file.arrayBuffer();
          // Pass resolvedPath as base URL for resolving relative/data URIs in GLTF
          // Empty string "" causes issues with embedded base64 data URIs
          gltf = await this.gltfLoader.parseAsync(buffer, resolvedPath);
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

        // CRITICAL: Bake all transforms into geometry BEFORE caching.
        // GLTF files can have transforms stored in matrices (not just scale property),
        // especially when exported without "Apply Transforms" in Blender.
        // This bakes ALL transforms into vertex positions, guaranteeing correct rendering.
        this.bakeTransformsToGeometry(gltf.scene);

        // Validate skeletons - filter out undefined bones (can happen with WebGPU)
        // Must happen before any cloning or animation setup
        gltf.scene.traverse((child) => {
          if (
            (child as THREE.SkinnedMesh).isSkinnedMesh &&
            (child as THREE.SkinnedMesh).skeleton
          ) {
            const skeleton = (child as THREE.SkinnedMesh).skeleton;
            const validBones = skeleton.bones.filter(
              (bone): bone is THREE.Bone => bone !== undefined && bone !== null,
            );
            if (validBones.length !== skeleton.bones.length) {
              console.warn(
                `[ModelCache] Cleaned ${skeleton.bones.length - validBones.length} undefined bones from ${resolvedPath}`,
              );
              skeleton.bones = validBones;
            }
          }
        });

        // CRITICAL: Setup materials on the original scene for WebGPU/CSM
        // This ensures all clones will have properly configured materials
        this.setupMaterials(gltf.scene, world);

        // Extract materials for sharing across clones
        const sharedMaterials = this.extractSharedMaterials(gltf.scene);

        // Extract collision data from GLB extras (AAA approach - collision travels with asset)
        let collision: ModelCollisionData | undefined;
        try {
          const extras = (
            gltf.parser?.json as {
              extras?: { hyperscape?: { collision?: ModelCollisionData } };
            }
          )?.extras;
          if (extras?.hyperscape?.collision) {
            collision = extras.hyperscape.collision;
          }
        } catch {
          // No collision data in this model - that's fine
        }

        const cachedModel: CachedModel = {
          scene: gltf.scene,
          animations: gltf.animations,
          loadedAt: Date.now(),
          cloneCount: 0,
          sharedMaterials,
          collision,
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

    // Generate LODs if requested
    let lodBundle: LODBundle | undefined;
    if (generateLODs && world) {
      lodBundle = await this.generateLODsForModel(
        resolvedPath,
        result.scene,
        world,
        options?.lodCategory,
        options?.lodOptions,
      );
      result.lodBundle = lodBundle;
    }

    return {
      scene: clonedScene,
      animations: result.animations,
      fromCache: false,
      collision: result.collision,
      lodBundle,
    };
  }

  /**
   * Generate LOD bundle for a model using worker-based decimation and GPU impostor baking.
   * Results are cached in IndexedDB for persistence across sessions.
   */
  private async generateLODsForModel(
    modelPath: string,
    scene: THREE.Object3D,
    world: World,
    category?: LODCategory,
    lodOptions?: Omit<LODGenerationOptions, "category">,
  ): Promise<LODBundle | undefined> {
    // Initialize LODManager if not already done
    lodManager.initialize(world);

    // Generate a stable ID from the model path
    const lodId = `model_${modelPath.replace(/[^a-zA-Z0-9]/g, "_")}`;

    // Determine category from path if not provided
    const effectiveCategory = category ?? this.inferCategoryFromPath(modelPath);

    const bundle = await lodManager.generateLODBundle(lodId, scene, {
      category: effectiveCategory,
      generateLOD1: true,
      generateLOD2: true,
      generateImpostor: true,
      useWorkers: true,
      ...lodOptions,
    });

    return bundle;
  }

  /**
   * Infer LOD category from model path based on common naming conventions.
   */
  private inferCategoryFromPath(path: string): LODCategory {
    const lowerPath = path.toLowerCase();
    if (lowerPath.includes("tree")) return "tree";
    if (lowerPath.includes("bush") || lowerPath.includes("shrub"))
      return "bush";
    if (
      lowerPath.includes("rock") ||
      lowerPath.includes("stone") ||
      lowerPath.includes("boulder")
    )
      return "rock";
    if (
      lowerPath.includes("plant") ||
      lowerPath.includes("flower") ||
      lowerPath.includes("grass")
    )
      return "plant";
    if (
      lowerPath.includes("building") ||
      lowerPath.includes("house") ||
      lowerPath.includes("structure")
    )
      return "building";
    if (
      lowerPath.includes("character") ||
      lowerPath.includes("npc") ||
      lowerPath.includes("mob")
    )
      return "character";
    if (
      lowerPath.includes("item") ||
      lowerPath.includes("weapon") ||
      lowerPath.includes("armor")
    )
      return "item";
    return "default";
  }

  /**
   * Check if a model is cached
   */
  has(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Preload multiple models in parallel
   *
   * Efficiently loads many models at once by:
   * - Deduplicating requests (same path only loads once)
   * - Running loads in parallel (no unnecessary serialization)
   * - Caching results for instant subsequent access
   *
   * @param paths - Array of model paths to preload
   * @param world - World instance for URL resolution
   * @param options - Loading options
   * @returns Promise that resolves when all models are loaded (with success/failure info)
   */
  async preloadModels(
    paths: string[],
    world?: World,
    options?: {
      shareMaterials?: boolean;
      /** Callback for progress updates */
      onProgress?: (loaded: number, total: number, path: string) => void;
    },
  ): Promise<{
    loaded: number;
    failed: number;
    errors: Array<{ path: string; error: string }>;
  }> {
    // Deduplicate paths
    const uniquePaths = [...new Set(paths)];
    const total = uniquePaths.length;
    let loaded = 0;
    const errors: Array<{ path: string; error: string }> = [];

    // Load all models in parallel
    const results = await Promise.allSettled(
      uniquePaths.map(async (path) => {
        try {
          await this.loadModel(path, world, {
            shareMaterials: options?.shareMaterials,
          });
          loaded++;
          options?.onProgress?.(loaded, total, path);
          return { path, success: true };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push({ path, error: errorMsg });
          loaded++;
          options?.onProgress?.(loaded, total, path);
          throw error;
        }
      }),
    );

    const failed = results.filter((r) => r.status === "rejected").length;

    return {
      loaded: total - failed,
      failed,
      errors,
    };
  }

  /**
   * Warm up the cache by preloading models that are likely to be used soon
   *
   * This is useful for vegetation systems, entity pools, etc. where we know
   * which models will be needed but don't need them immediately.
   *
   * @param pathsWithPriority - Array of { path, priority } where higher priority loads first
   * @param world - World instance
   */
  async warmupCache(
    pathsWithPriority: Array<{ path: string; priority: number }>,
    world?: World,
  ): Promise<void> {
    // Sort by priority (highest first)
    const sorted = [...pathsWithPriority].sort(
      (a, b) => b.priority - a.priority,
    );

    // Group by priority for wave-based loading
    const priorityGroups = new Map<number, string[]>();
    for (const item of sorted) {
      const paths = priorityGroups.get(item.priority) || [];
      paths.push(item.path);
      priorityGroups.set(item.priority, paths);
    }

    // Load each priority group in parallel, groups sequentially
    const priorities = [...priorityGroups.keys()].sort((a, b) => b - a);
    for (const priority of priorities) {
      const paths = priorityGroups.get(priority)!;
      await this.preloadModels(paths, world);
    }
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
