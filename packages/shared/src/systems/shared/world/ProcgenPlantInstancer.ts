/**
 * ProcgenPlantInstancer - Instanced Rendering for Procedural Plants
 *
 * Handles LOD transitions and instanced rendering for procedurally generated plants.
 * Plants are smaller than trees/rocks, so they use closer LOD distances.
 *
 * LOD Levels:
 * - LOD0 (0-30m): Full detail plant
 * - LOD1 (30-60m): Simplified plant
 * - LOD2 (60-100m): Cross-billboard cards
 * - Impostor (100-150m): Octahedral billboard
 * - Culled (150m+): Not rendered
 *
 * Features:
 * - Cross-fade LOD transitions with screen-space dithering
 * - Per-preset instanced meshes
 * - Automatic impostor generation
 */

import THREE from "../../../extras/three/three";
import type { World } from "../../../core/World";
import { ImpostorManager, BakePriority } from "../rendering/ImpostorManager";
import {
  createTSLImpostorMaterial,
  type TSLImpostorMaterial,
} from "@hyperscape/impostor";
import {
  getPlantVariant,
  ensurePlantVariantsLoaded,
} from "./ProcgenPlantCache";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_INSTANCES_PER_PRESET = 300;
const LOD_FADE_MS = 200;
const LOD_UPDATE_MS = 100;
const LOD_UPDATES_PER_FRAME = 40;
const IMPOSTOR_SIZE = 256;
const HYSTERESIS_SQ = 9; // 3m buffer

const LOD_DIST = { lod1: 30, lod2: 60, impostor: 100, cull: 150 };
const LOD_DIST_SQ = {
  lod1: LOD_DIST.lod1 ** 2,
  lod2: LOD_DIST.lod2 ** 2,
  impostor: LOD_DIST.impostor ** 2,
  cull: LOD_DIST.cull ** 2,
};

// ============================================================================
// TYPES
// ============================================================================

interface PlantInstance {
  id: string;
  presetName: string;
  position: THREE.Vector3;
  rotation: number;
  scale: number;
  currentLOD: number;
  lodIndices: [number, number, number, number];
  transition: { from: number; to: number; start: number } | null;
  radius: number;
}

interface MeshData {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.InstancedMesh;
  fadeAttr: THREE.InstancedBufferAttribute;
  idxToId: Map<number, string>;
  freeIndices: number[]; // Recycled indices available for reuse
  nextIdx: number;
  count: number;
  dirty: boolean;
}

interface ImpostorMeshData {
  geometry: THREE.BufferGeometry;
  material: TSLImpostorMaterial;
  mesh: THREE.InstancedMesh;
  idxToId: Map<number, string>;
  freeIndices: number[]; // Recycled indices available for reuse
  nextIdx: number;
  count: number;
  dirty: boolean;
  width: number;
  height: number;
}

interface PresetMeshes {
  lod0: MeshData | null;
  lod1: MeshData | null;
  lod2: MeshData | null;
  impostor: ImpostorMeshData | null;
  dimensions: { width: number; height: number; depth: number };
  leafColor: THREE.Color;
}

type LODKey = "lod0" | "lod1" | "lod2";

/** LOD key lookup array to avoid repeated array allocations */
const LOD_KEYS: readonly LODKey[] = ["lod0", "lod1", "lod2"] as const;

// ============================================================================
// PLANT INSTANCER CLASS
// ============================================================================

export class ProcgenPlantInstancer {
  private static instance: ProcgenPlantInstancer | null = null;

  private world: World;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private impostorManager: ImpostorManager;

  private instances: Map<string, PlantInstance> = new Map();
  private presetMeshes: Map<string, PresetMeshes> = new Map();

  private lastUpdate = 0;
  private updateQueue: string[] = [];
  private updateIndex = 0;

  private tempMatrix = new THREE.Matrix4();
  private tempPosition = new THREE.Vector3();
  private tempQuat = new THREE.Quaternion();
  private tempScale = new THREE.Vector3();

  private constructor(world: World) {
    this.world = world;
    this.scene = world.stage?.scene as THREE.Scene;
    this.camera = world.camera;
    this.impostorManager = ImpostorManager.getInstance(world);
  }

  /**
   * Get or create the singleton instancer.
   */
  static getInstance(world: World | null): ProcgenPlantInstancer | null {
    if (!world) return ProcgenPlantInstancer.instance;
    if (!ProcgenPlantInstancer.instance) {
      ProcgenPlantInstancer.instance = new ProcgenPlantInstancer(world);
    }
    return ProcgenPlantInstancer.instance;
  }

  /**
   * Add a plant instance.
   */
  async addInstance(
    id: string,
    presetName: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
  ): Promise<void> {
    await this.ensurePresetLoaded(presetName);

    const presetData = this.presetMeshes.get(presetName);
    if (!presetData) {
      console.warn(`[ProcgenPlantInstancer] Preset ${presetName} not loaded`);
      return;
    }

    const radius =
      Math.max(presetData.dimensions.width, presetData.dimensions.depth) *
      scale *
      0.5;

    const instance: PlantInstance = {
      id,
      presetName,
      position: position.clone(),
      rotation,
      scale,
      currentLOD: 4,
      lodIndices: [-1, -1, -1, -1],
      transition: null,
      radius,
    };

    this.instances.set(id, instance);

    const distSq = this.camera.position.distanceToSquared(position);
    const targetLOD = this.getLODForDistance(distSq);

    await this.setInstanceLOD(instance, targetLOD, false);
    this.updateQueue.push(id);
  }

  /**
   * Remove a plant instance.
   * @returns true if instance was found and removed, false otherwise
   */
  removeInstance(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    this.removeFromLODMesh(instance, 0);
    this.removeFromLODMesh(instance, 1);
    this.removeFromLODMesh(instance, 2);
    this.removeFromImpostorMesh(instance);

    this.instances.delete(id);

    const queueIdx = this.updateQueue.indexOf(id);
    if (queueIdx !== -1) {
      this.updateQueue.splice(queueIdx, 1);
    }

    return true;
  }

  /**
   * Update LOD levels based on camera position.
   */
  update(_deltaTime: number): void {
    if (!this.camera) return;

    const now = performance.now();

    if (now - this.lastUpdate < LOD_UPDATE_MS) {
      this.updateTransitions(now);
      return;
    }
    this.lastUpdate = now;

    const batchSize = Math.min(LOD_UPDATES_PER_FRAME, this.updateQueue.length);
    if (batchSize === 0) return;

    for (let i = 0; i < batchSize; i++) {
      const idx = (this.updateIndex + i) % this.updateQueue.length;
      const id = this.updateQueue[idx];
      const instance = this.instances.get(id);

      if (instance) {
        const distSq = this.camera.position.distanceToSquared(
          instance.position,
        );
        const targetLOD = this.getLODForDistanceWithHysteresis(
          instance,
          distSq,
        );

        if (targetLOD !== instance.currentLOD && !instance.transition) {
          this.startLODTransition(instance, targetLOD, now);
        }
      }
    }

    this.updateIndex =
      (this.updateIndex + batchSize) % Math.max(1, this.updateQueue.length);
    this.updateTransitions(now);
    this.commitDirtyMeshes();
  }

  /**
   * Ensure a preset's meshes are loaded.
   */
  private async ensurePresetLoaded(presetName: string): Promise<void> {
    if (this.presetMeshes.has(presetName)) return;

    await ensurePlantVariantsLoaded(presetName);

    const variant = getPlantVariant(presetName, 0);
    if (!variant) {
      console.warn(
        `[ProcgenPlantInstancer] Failed to get variant for ${presetName}`,
      );
      return;
    }

    const presetData: PresetMeshes = {
      lod0: null,
      lod1: null,
      lod2: null,
      impostor: null,
      dimensions: variant.dimensions,
      leafColor: variant.leafColor,
    };

    // For plants, we need to merge the group into a single geometry for instancing
    // Find the first mesh in each LOD group

    // LOD0 - find primary mesh
    const lod0Mesh = this.findPrimaryMesh(variant.group);
    if (lod0Mesh) {
      presetData.lod0 = this.createLODMesh(
        lod0Mesh.geometry,
        lod0Mesh.material as THREE.Material,
        `Plant_${presetName}_LOD0`,
      );
    }

    // LOD1
    if (variant.lod1Group) {
      const lod1Mesh = this.findPrimaryMesh(variant.lod1Group);
      if (lod1Mesh) {
        presetData.lod1 = this.createLODMesh(
          lod1Mesh.geometry,
          lod1Mesh.material as THREE.Material,
          `Plant_${presetName}_LOD1`,
        );
      }
    }

    // LOD2 - card group
    if (variant.lod2Group) {
      const cardMesh = variant.lod2Group.children[0] as THREE.Mesh;
      if (cardMesh) {
        presetData.lod2 = this.createLODMesh(
          cardMesh.geometry,
          cardMesh.material as THREE.Material,
          `Plant_${presetName}_LOD2`,
        );
      }
    }

    // Bake impostor
    if (lod0Mesh) {
      await this.bakeImpostor(presetName, lod0Mesh, presetData);
    }

    this.presetMeshes.set(presetName, presetData);
  }

  /**
   * Find the primary mesh in a plant group (usually the trunk or largest leaf mesh).
   */
  private findPrimaryMesh(group: THREE.Group): THREE.Mesh | null {
    let primaryMesh: THREE.Mesh | null = null;
    let maxVertices = 0;

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const verts = child.geometry.attributes.position?.count ?? 0;
        if (verts > maxVertices) {
          maxVertices = verts;
          primaryMesh = child;
        }
      }
    });

    return primaryMesh;
  }

  /**
   * Create an instanced mesh for a LOD level.
   */
  private createLODMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ): MeshData {
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      MAX_INSTANCES_PER_PRESET,
    );
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const fades = new Float32Array(MAX_INSTANCES_PER_PRESET).fill(1);
    const fadeAttr = new THREE.InstancedBufferAttribute(fades, 1);
    fadeAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("instanceFade", fadeAttr);

    this.scene.add(mesh);

    return {
      geometry,
      material,
      mesh,
      fadeAttr,
      idxToId: new Map(),
      freeIndices: [],
      nextIdx: 0,
      count: 0,
      dirty: false,
    };
  }

  /**
   * Bake an impostor for a preset.
   */
  private async bakeImpostor(
    presetName: string,
    mesh: THREE.Mesh,
    presetData: PresetMeshes,
  ): Promise<void> {
    const impostorKey = `plant_${presetName}`;

    const result = await this.impostorManager.getOrCreate(impostorKey, mesh, {
      atlasSize: IMPOSTOR_SIZE,
      gridSizeX: 8,
      gridSizeY: 8,
      hemisphere: true,
      category: "plant",
      priority: BakePriority.LOW,
    });

    if (!result || !result.atlasTexture) {
      console.warn(
        `[ProcgenPlantInstancer] Failed to bake impostor for ${presetName}`,
      );
      return;
    }

    const material = createTSLImpostorMaterial({
      atlasTexture: result.atlasTexture,
      gridSizeX: result.gridSizeX,
      gridSizeY: result.gridSizeY,
      transparent: true,
      depthWrite: true,
    });

    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const impostorWidth = Math.max(size.x, size.z);
    const impostorHeight = size.y;

    const geo = new THREE.PlaneGeometry(impostorWidth, impostorHeight);
    geo.translate(0, impostorHeight / 2, 0);

    const impostorMesh = new THREE.InstancedMesh(
      geo,
      material,
      MAX_INSTANCES_PER_PRESET,
    );
    impostorMesh.name = `Plant_${presetName}_Impostor`;
    impostorMesh.count = 0;
    impostorMesh.frustumCulled = false;
    impostorMesh.castShadow = false;
    impostorMesh.receiveShadow = false;
    impostorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.scene.add(impostorMesh);

    presetData.impostor = {
      geometry: geo,
      material,
      mesh: impostorMesh,
      idxToId: new Map(),
      freeIndices: [],
      nextIdx: 0,
      count: 0,
      dirty: false,
      width: impostorWidth,
      height: impostorHeight,
    };
  }

  /**
   * Get target LOD for distance squared.
   */
  private getLODForDistance(distSq: number): number {
    if (distSq >= LOD_DIST_SQ.cull) return 4;
    if (distSq >= LOD_DIST_SQ.impostor) return 3;
    if (distSq >= LOD_DIST_SQ.lod2) return 2;
    if (distSq >= LOD_DIST_SQ.lod1) return 1;
    return 0;
  }

  /**
   * Get target LOD with hysteresis.
   */
  private getLODForDistanceWithHysteresis(
    instance: PlantInstance,
    distSq: number,
  ): number {
    const targetLOD = this.getLODForDistance(distSq);
    const currentLOD = instance.currentLOD;

    if (targetLOD < currentLOD) return targetLOD;

    if (targetLOD > currentLOD) {
      const thresholds = [
        0,
        LOD_DIST_SQ.lod1,
        LOD_DIST_SQ.lod2,
        LOD_DIST_SQ.impostor,
        LOD_DIST_SQ.cull,
      ];
      const threshold = thresholds[currentLOD + 1] ?? LOD_DIST_SQ.cull;
      if (distSq > threshold + HYSTERESIS_SQ) {
        return targetLOD;
      }
    }

    return currentLOD;
  }

  /**
   * Start a LOD transition.
   * Note: setInstanceLOD is synchronous in practice since preset is already loaded.
   */
  private startLODTransition(
    instance: PlantInstance,
    targetLOD: number,
    now: number,
  ): void {
    instance.transition = {
      from: instance.currentLOD,
      to: targetLOD,
      start: now,
    };

    // Safe to not await: preset is already loaded during addInstance
    void this.setInstanceLOD(instance, targetLOD, true);
  }

  /**
   * Update all active transitions.
   */
  private updateTransitions(now: number): void {
    for (const instance of this.instances.values()) {
      if (!instance.transition) continue;

      const elapsed = now - instance.transition.start;
      const progress = Math.min(1, elapsed / LOD_FADE_MS);

      if (progress >= 1) {
        this.removeFromLODMesh(instance, instance.transition.from);
        this.setInstanceFade(instance, instance.currentLOD, 1);
        instance.transition = null;
      } else {
        this.setInstanceFade(instance, instance.transition.from, 1 - progress);
        this.setInstanceFade(instance, instance.transition.to, progress);
      }
    }
  }

  /**
   * Set instance to a specific LOD level.
   */
  private async setInstanceLOD(
    instance: PlantInstance,
    lod: number,
    fadeIn: boolean,
  ): Promise<void> {
    const presetData = this.presetMeshes.get(instance.presetName);
    if (!presetData) return;

    instance.currentLOD = lod;

    if (lod === 4) {
      return;
    }

    const meshKey = lod < 3 ? LOD_KEYS[lod] : null;

    if (lod < 3 && meshKey) {
      const meshData = presetData[meshKey];
      if (meshData) {
        const idx = this.addToMesh(meshData, instance.id);
        instance.lodIndices[lod] = idx;

        this.tempPosition.copy(instance.position);
        this.tempQuat.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          instance.rotation,
        );
        this.tempScale.set(instance.scale, instance.scale, instance.scale);
        this.tempMatrix.compose(
          this.tempPosition,
          this.tempQuat,
          this.tempScale,
        );

        meshData.mesh.setMatrixAt(idx, this.tempMatrix);
        meshData.fadeAttr.setX(idx, fadeIn ? 0 : 1);
        meshData.fadeAttr.needsUpdate = true;
        meshData.mesh.instanceMatrix.needsUpdate = true;
        meshData.dirty = true;
      }
    } else if (lod === 3 && presetData.impostor) {
      const idx = this.addToImpostorMesh(presetData.impostor, instance.id);
      instance.lodIndices[3] = idx;

      this.tempPosition.copy(instance.position);
      this.tempQuat.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        instance.rotation,
      );
      this.tempScale.set(instance.scale, instance.scale, instance.scale);
      this.tempMatrix.compose(this.tempPosition, this.tempQuat, this.tempScale);

      presetData.impostor.mesh.setMatrixAt(idx, this.tempMatrix);
      presetData.impostor.mesh.instanceMatrix.needsUpdate = true;
      presetData.impostor.dirty = true;
    }
  }

  /**
   * Set fade value for an instance at a specific LOD.
   */
  private setInstanceFade(
    instance: PlantInstance,
    lod: number,
    fade: number,
  ): void {
    const presetData = this.presetMeshes.get(instance.presetName);
    if (!presetData) return;

    const idx = instance.lodIndices[lod];
    if (idx < 0) return;

    if (lod < 3) {
      const meshData = presetData[LOD_KEYS[lod]];
      if (meshData && idx < meshData.fadeAttr.count) {
        meshData.fadeAttr.setX(idx, fade);
        meshData.fadeAttr.needsUpdate = true;
        meshData.dirty = true;
      }
    }
  }

  /**
   * Add instance to a mesh's buffer, reusing freed indices when available.
   */
  private addToMesh(meshData: MeshData, id: string): number {
    const idx =
      meshData.freeIndices.length > 0
        ? meshData.freeIndices.pop()!
        : meshData.nextIdx++;

    meshData.idxToId.set(idx, id);
    meshData.count = Math.max(meshData.count, idx + 1);
    meshData.mesh.count = meshData.count;
    return idx;
  }

  /**
   * Add instance to impostor mesh, reusing freed indices when available.
   */
  private addToImpostorMesh(meshData: ImpostorMeshData, id: string): number {
    const idx =
      meshData.freeIndices.length > 0
        ? meshData.freeIndices.pop()!
        : meshData.nextIdx++;

    meshData.idxToId.set(idx, id);
    meshData.count = Math.max(meshData.count, idx + 1);
    meshData.mesh.count = meshData.count;
    return idx;
  }

  /**
   * Remove instance from a LOD mesh, recycling its index.
   */
  private removeFromLODMesh(instance: PlantInstance, lod: number): void {
    const idx = instance.lodIndices[lod];
    if (idx < 0) return;

    const presetData = this.presetMeshes.get(instance.presetName);
    if (!presetData) return;

    if (lod < 3) {
      const meshData = presetData[LOD_KEYS[lod]];
      if (meshData) {
        this.tempMatrix.makeScale(0, 0, 0);
        meshData.mesh.setMatrixAt(idx, this.tempMatrix);
        meshData.mesh.instanceMatrix.needsUpdate = true;
        meshData.idxToId.delete(idx);
        meshData.freeIndices.push(idx); // Recycle the index
        meshData.dirty = true;
      }
    }

    instance.lodIndices[lod] = -1;
  }

  /**
   * Remove instance from impostor mesh, recycling its index.
   */
  private removeFromImpostorMesh(instance: PlantInstance): void {
    const idx = instance.lodIndices[3];
    if (idx < 0) return;

    const presetData = this.presetMeshes.get(instance.presetName);
    if (!presetData?.impostor) return;

    this.tempMatrix.makeScale(0, 0, 0);
    presetData.impostor.mesh.setMatrixAt(idx, this.tempMatrix);
    presetData.impostor.mesh.instanceMatrix.needsUpdate = true;
    presetData.impostor.idxToId.delete(idx);
    presetData.impostor.freeIndices.push(idx); // Recycle the index
    presetData.impostor.dirty = true;

    instance.lodIndices[3] = -1;
  }

  /**
   * Commit changes to dirty meshes.
   */
  private commitDirtyMeshes(): void {
    for (const presetData of this.presetMeshes.values()) {
      if (presetData.lod0?.dirty) {
        presetData.lod0.mesh.instanceMatrix.needsUpdate = true;
        presetData.lod0.dirty = false;
      }
      if (presetData.lod1?.dirty) {
        presetData.lod1.mesh.instanceMatrix.needsUpdate = true;
        presetData.lod1.dirty = false;
      }
      if (presetData.lod2?.dirty) {
        presetData.lod2.mesh.instanceMatrix.needsUpdate = true;
        presetData.lod2.dirty = false;
      }
      if (presetData.impostor?.dirty) {
        presetData.impostor.mesh.instanceMatrix.needsUpdate = true;
        presetData.impostor.dirty = false;
      }
    }
  }

  /**
   * Get instance count.
   */
  getInstanceCount(): number {
    return this.instances.size;
  }

  /**
   * Pre-warm the impostor cache from IndexedDB for known presets.
   * Call this on startup to avoid rebaking cached impostors.
   */
  async preWarmImpostorCache(presets: string[]): Promise<number> {
    let loadedCount = 0;
    const startTime = performance.now();

    console.log(
      `[ProcgenPlantInstancer] Pre-warming impostor cache for ${presets.length} presets...`,
    );

    for (const presetName of presets) {
      const impostorKey = `plant_${presetName}`;
      const cached = await this.impostorManager.preload(impostorKey, {
        atlasSize: IMPOSTOR_SIZE,
        gridSizeX: 8,
        gridSizeY: 8,
        hemisphere: true,
      });

      if (cached) {
        loadedCount++;
        console.log(
          `[ProcgenPlantInstancer] ✅ Loaded cached impostor: ${presetName}`,
        );
      }
    }

    const elapsed = Math.round(performance.now() - startTime);
    console.log(
      `[ProcgenPlantInstancer] Pre-warm complete: ${loadedCount}/${presets.length} impostors loaded from cache in ${elapsed}ms`,
    );

    return loadedCount;
  }

  /**
   * Get stats for debugging.
   */
  getStats(): {
    totalInstances: number;
    lodCounts: [number, number, number, number, number];
    presetCount: number;
  } {
    const lodCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];

    for (const instance of this.instances.values()) {
      lodCounts[instance.currentLOD]++;
    }

    return {
      totalInstances: this.instances.size,
      lodCounts,
      presetCount: this.presetMeshes.size,
    };
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    for (const presetData of this.presetMeshes.values()) {
      if (presetData.lod0) {
        this.scene.remove(presetData.lod0.mesh);
        presetData.lod0.mesh.dispose();
      }
      if (presetData.lod1) {
        this.scene.remove(presetData.lod1.mesh);
        presetData.lod1.mesh.dispose();
      }
      if (presetData.lod2) {
        this.scene.remove(presetData.lod2.mesh);
        presetData.lod2.mesh.dispose();
      }
      if (presetData.impostor) {
        this.scene.remove(presetData.impostor.mesh);
        presetData.impostor.mesh.dispose();
        presetData.impostor.geometry.dispose();
        presetData.impostor.material.dispose();
      }
    }

    this.presetMeshes.clear();
    this.instances.clear();
    this.updateQueue = [];

    ProcgenPlantInstancer.instance = null;
  }
}
