/**
 * MaterialPool - Shared material caching to reduce GPU memory and shader duplication
 */

import THREE from "../../extras/three/three";

interface MaterialProperties {
  type: string;
  color?: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  alphaTest?: number;
  depthWrite?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
  wireframe?: boolean;
}

interface CachedMaterial {
  material: THREE.Material;
  hash: string;
  refCount: number;
}

export interface MaterialPoolStats {
  cachedMaterials: number;
  totalRefCount: number;
  memorySavedEstimate: number;
}

export class MaterialPool {
  private static instance: MaterialPool;
  private cache = new Map<string, CachedMaterial>();
  private uuidToHash = new Map<string, string>();
  private duplicatesSaved = 0;

  private constructor() {}

  static getInstance(): MaterialPool {
    if (!MaterialPool.instance) {
      MaterialPool.instance = new MaterialPool();
    }
    return MaterialPool.instance;
  }

  private hashMaterial(material: THREE.Material): string {
    const props: MaterialProperties = {
      type: material.type,
      opacity: material.opacity,
      transparent: material.transparent,
      side: material.side,
      alphaTest: material.alphaTest,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      blending: material.blending,
    };

    if (material instanceof THREE.MeshStandardMaterial) {
      props.color = material.color.getHex();
      props.metalness = Math.round(material.metalness * 100) / 100;
      props.roughness = Math.round(material.roughness * 100) / 100;
    } else if (material instanceof THREE.MeshBasicMaterial) {
      props.color = material.color.getHex();
      props.wireframe = material.wireframe;
    } else if (material instanceof THREE.MeshPhongMaterial) {
      props.color = material.color.getHex();
    }

    const textureHashes: string[] = [];
    const m = material as THREE.Material & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      emissiveMap?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      bumpMap?: THREE.Texture | null;
      envMap?: THREE.Texture | null;
    };

    if (m.map) textureHashes.push(`map:${m.map.uuid}`);
    if (m.normalMap) textureHashes.push(`normal:${m.normalMap.uuid}`);
    if (m.roughnessMap) textureHashes.push(`rough:${m.roughnessMap.uuid}`);
    if (m.metalnessMap) textureHashes.push(`metal:${m.metalnessMap.uuid}`);
    if (m.emissiveMap) textureHashes.push(`emissive:${m.emissiveMap.uuid}`);
    if (m.aoMap) textureHashes.push(`ao:${m.aoMap.uuid}`);
    if (m.bumpMap) textureHashes.push(`bump:${m.bumpMap.uuid}`);
    if (m.envMap) textureHashes.push(`env:${m.envMap.uuid}`);

    return JSON.stringify(props) + "|" + textureHashes.sort().join(",");
  }

  getSharedMaterial<T extends THREE.Material>(material: T): T {
    const existingHash = this.uuidToHash.get(material.uuid);
    if (existingHash) {
      const cached = this.cache.get(existingHash);
      if (cached) {
        cached.refCount++;
        return cached.material as T;
      }
    }

    const hash = this.hashMaterial(material);
    const existing = this.cache.get(hash);
    if (existing) {
      existing.refCount++;
      this.uuidToHash.set(material.uuid, hash);
      this.duplicatesSaved++;
      return existing.material as T;
    }

    this.cache.set(hash, { material, hash, refCount: 1 });
    this.uuidToHash.set(material.uuid, hash);
    return material;
  }

  processScene(scene: THREE.Object3D): void {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
        if (Array.isArray(object.material)) {
          object.material = object.material.map((mat) => this.getSharedMaterial(mat));
        } else {
          object.material = this.getSharedMaterial(object.material);
        }
      }
    });
  }

  getStats(): MaterialPoolStats {
    let totalRefCount = 0;
    for (const entry of this.cache.values()) {
      totalRefCount += entry.refCount;
    }
    return {
      cachedMaterials: this.cache.size,
      totalRefCount,
      memorySavedEstimate: this.duplicatesSaved * 2048,
    };
  }

  cleanup(): number {
    let removed = 0;
    const toRemove: string[] = [];

    for (const [hash, entry] of this.cache.entries()) {
      if (entry.refCount <= 0) {
        toRemove.push(hash);
      }
    }

    for (const hash of toRemove) {
      const entry = this.cache.get(hash);
      if (entry) {
        const uuidsToDelete: string[] = [];
        for (const [uuid, h] of this.uuidToHash.entries()) {
          if (h === hash) uuidsToDelete.push(uuid);
        }
        for (const uuid of uuidsToDelete) {
          this.uuidToHash.delete(uuid);
        }
        entry.material.dispose();
        this.cache.delete(hash);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.material.dispose();
    }
    this.cache.clear();
    this.uuidToHash.clear();
    this.duplicatesSaved = 0;
  }
}

export const materialPool = MaterialPool.getInstance();
