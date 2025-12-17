/**
 * Model Cache - loads GLB models once and caches for reuse
 */

import THREE from "../../extras/three/three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { World } from "../../core/World";
import { MaterialPool } from "./MaterialPool";

interface CachedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  loadedAt: number;
  cloneCount: number;
}

export class ModelCache {
  private static instance: ModelCache;
  private cache = new Map<string, CachedModel>();
  private loading = new Map<string, Promise<CachedModel>>();
  private gltfLoader = new GLTFLoader();

  private constructor() {}

  static getInstance(): ModelCache {
    if (!ModelCache.instance) {
      ModelCache.instance = new ModelCache();
    }
    return ModelCache.instance;
  }

  private setupMaterials(scene: THREE.Object3D, world?: World): void {
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        if (Array.isArray(node.material)) {
          node.material.forEach((mat) => this.setupSingleMaterial(mat, world));
        } else {
          this.setupSingleMaterial(node.material, world);
        }
        node.castShadow = true;
        node.receiveShadow = true;
        if (node instanceof THREE.SkinnedMesh) {
          node.frustumCulled = false;
        }
      }
    });
  }

  private setupSingleMaterial(material: THREE.Material, world?: World): void {
    if (world?.setupMaterial) {
      world.setupMaterial(material);
    }

    (material as THREE.Material & { shadowSide?: THREE.Side }).shadowSide = THREE.BackSide;
    (material as THREE.Material & { fog?: boolean }).fog = true;

    const m = material as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null };

    if (
      material instanceof THREE.MeshStandardMaterial ||
      material instanceof THREE.MeshPhysicalMaterial ||
      material instanceof THREE.MeshBasicMaterial ||
      material instanceof THREE.MeshPhongMaterial
    ) {
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    }

    material.needsUpdate = true;
  }

  private poolMaterials(scene: THREE.Object3D): void {
    const pool = MaterialPool.getInstance();
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map((mat) => pool.getSharedMaterial(mat));
        } else {
          node.material = pool.getSharedMaterial(node.material);
        }
      }
    });
  }

  private prepareClonedScene(scene: THREE.Object3D, world?: World): void {
    this.setupMaterials(scene, world);
    this.poolMaterials(scene);
  }

  async loadModel(
    path: string,
    world?: World,
  ): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[]; fromCache: boolean }> {
    let resolvedPath = world ? world.resolveURL(path) : path;
    if (resolvedPath.startsWith("asset://")) {
      const cdnUrl =
        (typeof window !== "undefined" && (window as Window & { __CDN_URL?: string }).__CDN_URL) ||
        world?.assetsUrl?.replace(/\/$/, "") ||
        "http://localhost:5555/assets";
      resolvedPath = resolvedPath.replace("asset://", `${cdnUrl}/`);
    }

    const cached = this.cache.get(resolvedPath);
    if (cached) {
      if ("ctx" in cached.scene || "isDirty" in cached.scene) {
        this.cache.delete(resolvedPath);
        return this.loadModel(path, world);
      }
      cached.cloneCount++;
      const clonedScene = cached.scene.clone(true);
      this.prepareClonedScene(clonedScene, world);
      return { scene: clonedScene, animations: cached.animations, fromCache: true };
    }

    const loadingPromise = this.loading.get(resolvedPath);
    if (loadingPromise) {
      const result = await loadingPromise;
      result.cloneCount++;
      const clonedScene = result.scene.clone(true);
      this.prepareClonedScene(clonedScene, world);
      return { scene: clonedScene, animations: result.animations, fromCache: true };
    }

    const promise = this.gltfLoader
      .loadAsync(resolvedPath)
      .then((gltf) => {
        if ("ctx" in gltf.scene || "isDirty" in gltf.scene) {
          throw new Error(`ModelCache received Hyperscape Node - loader conflict`);
        }
        this.setupMaterials(gltf.scene as unknown as THREE.Object3D, world);
        const cachedModel: CachedModel = {
          scene: gltf.scene as unknown as THREE.Object3D,
          animations: gltf.animations,
          loadedAt: Date.now(),
          cloneCount: 0,
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
    if ("ctx" in clonedScene || "isDirty" in clonedScene) {
      throw new Error(`ModelCache clone produced Hyperscape Node`);
    }
    this.prepareClonedScene(clonedScene, world);
    return { scene: clonedScene, animations: result.animations, fromCache: false };
  }

  has(path: string): boolean {
    return this.cache.has(path);
  }

  getStats(): { total: number; paths: string[]; totalClones: number } {
    const paths: string[] = [];
    let totalClones = 0;
    for (const [path, model] of this.cache.entries()) {
      paths.push(path);
      totalClones += model.cloneCount;
    }
    return { total: this.cache.size, paths, totalClones };
  }

  clear(): void {
    this.cache.clear();
    this.loading.clear();
  }

  remove(path: string): boolean {
    return this.cache.delete(path);
  }
}

export const modelCache = ModelCache.getInstance();
