/**
 * ProcgenTreeInstancer - AAA Instanced Rendering for Procedural Trees
 *
 * Features:
 * - Cross-fade LOD transitions (AAA-1): Screen-space dithering dissolve
 * - Wind animation at LOD1 (AAA-2): TSL vertex shader displacement
 * - Shadow LODs (AAA-3): Simplified cone+cylinder shadow geometry
 * - Vertex color batching (AAA-4): Single material per LOD level
 * - GPU culling detection (AAA-5): WebGPU availability check
 *
 * LOD Levels: LOD0 (0-30m) → LOD1 (30-60m) → LOD2 (60-120m) → Impostor (120-200m) → Culled
 */

import THREE, {
  uniform,
  Fn,
  float,
  vec3,
  add,
  mul,
  sin,
  fract,
  floor,
  smoothstep,
  positionLocal,
  screenUV,
  viewportSize,
  attribute,
  MeshStandardNodeMaterial,
  Discard,
  If,
} from "../../../extras/three/three";
import type { World } from "../../../core/World";
import { ImpostorManager, BakePriority } from "../rendering/ImpostorManager";
import { createImpostorMaterial } from "@hyperscape/impostor";
import type { Wind } from "./Wind";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_INSTANCES = 2000;
const LOD_FADE_MS = 300;
const LOD_UPDATE_MS = 100;
const LOD_UPDATES_PER_FRAME = 50;
const IMPOSTOR_SIZE = 1024;
const HYSTERESIS_SQ = 25; // 5m buffer

const LOD_DIST = { lod1: 30, lod2: 60, impostor: 120, cull: 200 };
const LOD_DIST_SQ = {
  lod1: LOD_DIST.lod1 ** 2,
  lod2: LOD_DIST.lod2 ** 2,
  impostor: LOD_DIST.impostor ** 2,
  cull: LOD_DIST.cull ** 2,
};

const WIND = {
  speed: 0.8,
  maxBend: 0.25,
  heightThreshold: 0.3,
  spatialFreq: 0.08,
  gustSpeed: 0.4,
};

// ============================================================================
// TYPES
// ============================================================================

interface TreeInstance {
  id: string;
  position: THREE.Vector3;
  rotation: number;
  scale: number;
  currentLOD: number; // 0-4: lod0, lod1, lod2, impostor, culled
  lodIndices: [number, number, number, number]; // [lod0, lod1, lod2, impostor] mesh indices
  transition: { from: number; to: number; start: number } | null;
  radius: number;
}

interface MeshData {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.InstancedMesh;
  fadeAttr: THREE.InstancedBufferAttribute;
  idxToId: Map<number, string>;
  nextIdx: number;
  count: number;
  dirty: boolean;
  shadowMesh: THREE.InstancedMesh | null;
  shadowGeo: THREE.BufferGeometry | null;
}

interface ImpostorMeshData {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  mesh: THREE.InstancedMesh;
  idxToId: Map<number, string>;
  nextIdx: number;
  count: number;
  dirty: boolean;
  width: number;
  height: number;
}

interface TreeDims {
  width: number;
  height: number;
  canopyR: number;
  trunkH: number;
}

interface WindMat extends THREE.MeshStandardNodeMaterial {
  windUniforms: {
    time: { value: number };
    strength: { value: number };
    direction: { value: THREE.Vector3 };
  };
}

type LODKey = "lod0" | "lod1" | "lod2";

// ============================================================================
// MATERIAL HELPERS
// ============================================================================

/** Copy material properties from source to target */
function copyMaterialProps(
  target: THREE.MeshStandardNodeMaterial,
  source: THREE.Material,
): void {
  if (
    source instanceof THREE.MeshStandardMaterial ||
    source instanceof THREE.MeshLambertMaterial
  ) {
    target.color.copy(source.color);
    if ("roughness" in source) target.roughness = source.roughness;
    if ("metalness" in source) target.metalness = source.metalness;
    target.side = source.side;
  }
}

/** Create screen-space dithering opacity node */
function createDitherOpacity() {
  const fade = attribute("instanceFade", "float");
  return Fn(() => {
    const screen = screenUV.mul(viewportSize);
    const px = floor(screen.x).mod(float(4));
    const py = floor(screen.y).mod(float(4));
    const threshold = fract(mul(add(mul(py, float(4)), px), float(0.0625)));
    If(fade.greaterThan(threshold).not(), () => Discard());
    return float(1);
  })();
}

/** Create wind-animated material for LOD1 */
function createWindMaterial(base: THREE.Material, dims: TreeDims): WindMat {
  const mat = new MeshStandardNodeMaterial();
  copyMaterialProps(mat, base);

  const uTime = uniform(0);
  const uStrength = uniform(1);
  const uDir = uniform(new THREE.Vector3(1, 0, 0));
  const h = float(dims.height);

  mat.positionNode = Fn(() => {
    const pos = positionLocal;
    const normH = pos.y.div(h);
    const influence = smoothstep(float(WIND.heightThreshold), float(1), normH);
    const topInf = mul(influence, influence);

    const phase = add(
      mul(pos.x, float(WIND.spatialFreq)),
      mul(pos.z, float(WIND.spatialFreq * 1.3)),
    );
    const wave1 = sin(add(mul(uTime, float(WIND.speed)), phase));
    const wave2 = sin(
      add(mul(uTime, float(WIND.gustSpeed)), mul(phase, float(0.7))),
    );
    const combined = add(mul(wave1, float(0.7)), mul(wave2, float(0.3)));
    const bend = mul(
      mul(combined, topInf),
      mul(uStrength, float(WIND.maxBend)),
    );

    const bendX = mul(mul(bend, uDir.x), pos.y);
    const bendZ = mul(mul(bend, uDir.z), pos.y);
    return vec3(add(pos.x, bendX), pos.y, add(pos.z, bendZ));
  })();

  mat.opacityNode = createDitherOpacity();
  mat.side = THREE.DoubleSide;
  mat.shadowSide = THREE.FrontSide;
  mat.transparent = false;

  const windMat = mat as WindMat;
  windMat.windUniforms = { time: uTime, strength: uStrength, direction: uDir };
  return windMat;
}

/** Create dissolve material for LOD0/LOD2 */
function createDissolveMaterial(
  base: THREE.Material,
): THREE.MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  copyMaterialProps(mat, base);
  mat.opacityNode = createDitherOpacity();
  mat.side = THREE.DoubleSide;
  mat.transparent = false;
  mat.alphaTest = 0;
  return mat;
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

/** Merge buffer geometries into one */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0];

  let totalVerts = 0,
    totalIdx = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    if (p) totalVerts += p.count;
    totalIdx += g.index?.count ?? p?.count ?? 0;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);

  let vOff = 0,
    iOff = 0,
    vBase = 0;
  for (const g of geos) {
    const pos = g.attributes.position;
    if (!pos) continue;

    positions.set(pos.array as Float32Array, vOff * 3);
    if (g.attributes.normal)
      normals.set(g.attributes.normal.array as Float32Array, vOff * 3);

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + vBase;
      iOff += idx.length;
    } else {
      for (let i = 0; i < pos.count; i++) indices[iOff + i] = i + vBase;
      iOff += pos.count;
    }
    vBase += pos.count;
    vOff += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  if (normals.every((n) => n === 0)) merged.computeVertexNormals();
  return merged;
}

/** Generate shadow geometry (cone + cylinder) */
function createShadowGeo(
  dims: TreeDims,
  simple: boolean,
): THREE.BufferGeometry {
  const { height, canopyR, trunkH } = dims;
  if (simple) {
    const geo = new THREE.CylinderGeometry(
      canopyR * 0.6,
      canopyR * 0.3,
      height,
      4,
      1,
    );
    geo.translate(0, height / 2, 0);
    return geo;
  }

  const trunkR = canopyR * 0.15;
  const trunk = new THREE.CylinderGeometry(trunkR, trunkR * 1.2, trunkH, 6, 1);
  trunk.translate(0, trunkH / 2, 0);

  const canopyH = height - trunkH;
  const cone = new THREE.ConeGeometry(canopyR, canopyH, 8, 1);
  cone.translate(0, trunkH + canopyH / 2, 0);

  const merged = mergeGeometries([trunk, cone]);
  trunk.dispose();
  cone.dispose();
  return merged;
}

// ============================================================================
// MAIN CLASS
// ============================================================================

export class ProcgenTreeInstancer {
  private static inst: ProcgenTreeInstancer | null = null;

  private world: World;
  private scene: THREE.Scene;
  private meshes = new Map<string, Map<LODKey, MeshData>>();
  private impostors = new Map<string, ImpostorMeshData>();
  private instances = new Map<string, { preset: string; inst: TreeInstance }>();
  private dims = new Map<string, TreeDims>();
  private windSys: Wind | null;
  private windMats: WindMat[] = [];
  private isWebGPU: boolean;

  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private camPos = new THREE.Vector3();
  private tempWindDir = new THREE.Vector3();

  private lodEnabled = true;
  private lastLodUpdate = 0;
  private lodIdx = 0;
  private instArray: Array<{ preset: string; inst: TreeInstance }> = [];
  private time = 0;
  private transitions = new Set<string>();

  private constructor(world: World) {
    this.world = world;
    this.scene = world.stage?.scene as THREE.Scene;
    this.windSys = world.getSystem("wind") as Wind | null;
    this.isWebGPU = this.checkWebGPU();
  }

  static getInstance(world: World): ProcgenTreeInstancer {
    if (!ProcgenTreeInstancer.inst) {
      ProcgenTreeInstancer.inst = new ProcgenTreeInstancer(world);
    }
    return ProcgenTreeInstancer.inst;
  }

  private checkWebGPU(): boolean {
    const stage = this.world.stage as
      | { renderer?: { isWebGPURenderer?: boolean } }
      | undefined;
    return stage?.renderer?.isWebGPURenderer === true;
  }

  // ---------------------------------------------------------------------------
  // REGISTRATION
  // ---------------------------------------------------------------------------

  registerPreset(
    name: string,
    lod0: THREE.Group,
    lod1?: THREE.Group | null,
    lod2?: THREE.Group | null,
  ): void {
    if (this.meshes.has(name)) return;

    const d = this.calcDims(lod0);
    this.dims.set(name, d);

    const data = new Map<LODKey, MeshData>();
    const m0 = this.createMeshData(lod0, name, "lod0", d);
    if (m0) data.set("lod0", m0);
    if (lod1) {
      const m1 = this.createMeshData(lod1, name, "lod1", d);
      if (m1) data.set("lod1", m1);
    }
    if (lod2) {
      const m2 = this.createMeshData(lod2, name, "lod2", d);
      if (m2) data.set("lod2", m2);
    }

    this.meshes.set(name, data);
    this.bakeImpostor(name, lod0);

    console.log(
      `[TreeInstancer] ${name}: LOD0=${data.has("lod0")} LOD1=${data.has("lod1")} LOD2=${data.has("lod2")} h=${d.height.toFixed(1)}m`,
    );
  }

  private calcDims(group: THREE.Group): TreeDims {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    return {
      width: Math.max(size.x, size.z),
      height: size.y,
      canopyR: Math.max(size.x, size.z) * 0.5,
      trunkH: size.y * 0.35,
    };
  }

  private async bakeImpostor(name: string, src: THREE.Group): Promise<void> {
    const mgr = ImpostorManager.getInstance(this.world);
    if (!mgr.initBaker()) return;

    const result = await mgr.getOrCreate(`procgen_tree_${name}_v3`, src, {
      atlasSize: IMPOSTOR_SIZE,
      hemisphere: true,
      priority: BakePriority.NORMAL,
      category: "tree_resource",
      gridSizeX: 16,
      gridSizeY: 8,
    });

    if (!result.atlasTexture) return;

    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const w = Math.max(size.x, size.z);
    const h = size.y;

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = createImpostorMaterial({
      atlasTexture: result.atlasTexture,
      gridSizeX: result.gridSizeX,
      gridSizeY: result.gridSizeY,
      transparent: true,
      depthWrite: true,
    });
    this.world.setupMaterial?.(mat);

    const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    mesh.name = `Tree_${name}_impostor`;
    this.scene?.add(mesh);

    this.impostors.set(name, {
      geometry: geo,
      material: mat,
      mesh,
      idxToId: new Map(),
      nextIdx: 0,
      count: 0,
      dirty: false,
      width: w,
      height: h,
    });
  }

  private createMeshData(
    group: THREE.Group,
    name: string,
    lod: LODKey,
    dims: TreeDims,
  ): MeshData | null {
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const geo = child.geometry.clone();
        if (!child.matrix.equals(new THREE.Matrix4().identity()))
          geo.applyMatrix4(child.matrix);
        geos.push(geo);
        const m = Array.isArray(child.material)
          ? child.material[0]
          : child.material;
        if (m && !mats.includes(m)) mats.push(m);
      }
    });

    if (geos.length === 0) return null;

    const merged = mergeGeometries(geos);
    const baseMat =
      mats[0] ?? new THREE.MeshLambertMaterial({ color: 0x228b22 });

    const material =
      lod === "lod1"
        ? createWindMaterial(baseMat, dims)
        : createDissolveMaterial(baseMat);

    if (lod === "lod1") this.windMats.push(material as WindMat);
    this.world.setupMaterial?.(material);

    const mesh = new THREE.InstancedMesh(merged, material, MAX_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.layers.set(1);
    mesh.name = `Tree_${name}_${lod}`;

    const fadeArr = new Float32Array(MAX_INSTANCES).fill(1);
    const fadeAttr = new THREE.InstancedBufferAttribute(fadeArr, 1);
    fadeAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("instanceFade", fadeAttr);

    let shadowMesh: THREE.InstancedMesh | null = null;
    let shadowGeo: THREE.BufferGeometry | null = null;

    if (lod === "lod0" || lod === "lod1") {
      shadowGeo = createShadowGeo(dims, lod === "lod1");
      const shadowMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
      });

      shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_INSTANCES);
      shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      shadowMesh.count = 0;
      shadowMesh.frustumCulled = false;
      shadowMesh.castShadow = true;
      shadowMesh.receiveShadow = false;
      shadowMesh.layers.set(1);
      shadowMesh.name = `Tree_${name}_${lod}_shadow`;
      this.scene?.add(shadowMesh);
    }

    this.scene?.add(mesh);

    return {
      geometry: merged,
      material,
      mesh,
      fadeAttr,
      idxToId: new Map(),
      nextIdx: 0,
      count: 0,
      dirty: false,
      shadowMesh,
      shadowGeo,
    };
  }

  // ---------------------------------------------------------------------------
  // INSTANCE MANAGEMENT
  // ---------------------------------------------------------------------------

  addInstance(
    preset: string,
    id: string,
    pos: THREE.Vector3,
    rot: number,
    scale: number,
    _lodLevel = 0,
  ): boolean {
    if (!this.meshes.has(preset) || this.instances.has(id))
      return this.instances.has(id);

    const d = this.dims.get(preset);
    const inst: TreeInstance = {
      id,
      position: pos.clone(),
      rotation: rot,
      scale,
      currentLOD: -1,
      lodIndices: [-1, -1, -1, -1],
      transition: null,
      radius: d ? Math.max(d.width, d.height) * scale * 0.5 : 5,
    };

    this.instances.set(id, { preset, inst });
    this.updateLOD(preset, inst);
    return true;
  }

  removeInstance(preset: string, id: string, _lodLevel = 0): void {
    const tracked = this.instances.get(id);
    if (!tracked) return;

    this.transitions.delete(id);
    for (let lod = 0; lod < 4; lod++)
      this.removeFromLOD(preset, tracked.inst, lod);
    this.instances.delete(id);
  }

  setPresetVisible(preset: string, visible: boolean): void {
    const data = this.meshes.get(preset);
    if (data) {
      for (const d of data.values()) {
        d.mesh.visible = visible;
        if (d.shadowMesh) d.shadowMesh.visible = visible;
      }
    }
    const imp = this.impostors.get(preset);
    if (imp) imp.mesh.visible = visible;
  }

  // ---------------------------------------------------------------------------
  // LOD MANAGEMENT
  // ---------------------------------------------------------------------------

  private updateLOD(preset: string, inst: TreeInstance): void {
    const dx = inst.position.x - this.camPos.x;
    const dz = inst.position.z - this.camPos.z;
    const distSq = dx * dx + dz * dz;
    const cur = inst.currentLOD;

    // Determine target LOD with hysteresis
    let target: number;
    if (distSq >= LOD_DIST_SQ.cull) target = 4;
    else if (distSq >= LOD_DIST_SQ.impostor - (cur === 3 ? HYSTERESIS_SQ : 0))
      target = 3;
    else if (distSq >= LOD_DIST_SQ.lod2 - (cur === 2 ? HYSTERESIS_SQ : 0))
      target = 2;
    else if (distSq >= LOD_DIST_SQ.lod1 - (cur === 1 ? HYSTERESIS_SQ : 0))
      target = 1;
    else target = 0;

    if (target === cur) return;

    // Cross-fade only for LOD0 <-> LOD1
    const crossFade =
      cur >= 0 && ((cur === 0 && target === 1) || (cur === 1 && target === 0));

    if (crossFade) {
      inst.transition = { from: cur, to: target, start: this.time };
      this.transitions.add(inst.id);
      this.addToLOD(preset, inst, target);
      this.setFade(preset, inst, target, 0);
      this.setFade(preset, inst, cur, 1);
    } else {
      this.removeFromLOD(preset, inst, cur);
      this.addToLOD(preset, inst, target);
    }
    inst.currentLOD = target;
  }

  private setFade(
    preset: string,
    inst: TreeInstance,
    lod: number,
    fade: number,
  ): void {
    if (lod < 0 || lod > 2) return;
    const key = ["lod0", "lod1", "lod2"][lod] as LODKey;
    const data = this.meshes.get(preset)?.get(key);
    const idx = inst.lodIndices[lod];
    if (data && idx >= 0) {
      data.fadeAttr.setX(idx, fade);
      data.fadeAttr.needsUpdate = true;
    }
  }

  private addToLOD(preset: string, inst: TreeInstance, lod: number): void {
    const meshMap = this.meshes.get(preset);
    if (lod === 0) {
      const d = meshMap?.get("lod0");
      if (d) inst.lodIndices[0] = this.showInMesh(d, inst);
    } else if (lod === 1) {
      const d = meshMap?.get("lod1") ?? meshMap?.get("lod0");
      if (d)
        inst.lodIndices[d === meshMap?.get("lod1") ? 1 : 0] = this.showInMesh(
          d,
          inst,
        );
    } else if (lod === 2) {
      const d = meshMap?.get("lod2") ?? meshMap?.get("lod1");
      if (d)
        inst.lodIndices[d === meshMap?.get("lod2") ? 2 : 1] = this.showInMesh(
          d,
          inst,
        );
    } else if (lod === 3) {
      const d = this.impostors.get(preset);
      if (d) inst.lodIndices[3] = this.showImpostor(d, inst);
      else {
        const fallback = meshMap?.get("lod2");
        if (fallback) inst.lodIndices[2] = this.showInMesh(fallback, inst);
      }
    }
  }

  private removeFromLOD(preset: string, inst: TreeInstance, lod: number): void {
    const idx = inst.lodIndices[lod];
    if (idx < 0) return;

    if (lod < 3) {
      const key = ["lod0", "lod1", "lod2"][lod] as LODKey;
      const data = this.meshes.get(preset)?.get(key);
      if (data) {
        data.mesh.setMatrixAt(idx, this.zeroMatrix);
        data.shadowMesh?.setMatrixAt(idx, this.zeroMatrix);
        data.shadowMesh && (data.shadowMesh.instanceMatrix.needsUpdate = true);
        data.idxToId.delete(idx);
        data.dirty = true;
      }
    } else {
      const imp = this.impostors.get(preset);
      if (imp) {
        imp.mesh.setMatrixAt(idx, this.zeroMatrix);
        imp.idxToId.delete(idx);
        imp.dirty = true;
      }
    }
    inst.lodIndices[lod] = -1;
  }

  private showInMesh(data: MeshData, inst: TreeInstance): number {
    const idx = data.nextIdx++;
    if (data.nextIdx >= MAX_INSTANCES) data.nextIdx = 0;

    this.dummy.position.copy(inst.position);
    this.dummy.rotation.set(0, inst.rotation, 0);
    this.dummy.scale.setScalar(inst.scale);
    this.dummy.updateMatrix();

    data.mesh.setMatrixAt(idx, this.dummy.matrix);
    if (data.shadowMesh) {
      data.shadowMesh.setMatrixAt(idx, this.dummy.matrix);
      data.shadowMesh.count = Math.max(data.shadowMesh.count, idx + 1);
      data.shadowMesh.instanceMatrix.needsUpdate = true;
    }

    data.fadeAttr.setX(idx, 1);
    data.fadeAttr.needsUpdate = true;
    data.idxToId.set(idx, inst.id);
    data.count = Math.max(data.count, idx + 1);
    data.mesh.count = data.count;
    data.dirty = true;
    return idx;
  }

  private showImpostor(data: ImpostorMeshData, inst: TreeInstance): number {
    const idx = data.nextIdx++;
    if (data.nextIdx >= MAX_INSTANCES) data.nextIdx = 0;

    this.dummy.position.copy(inst.position);
    this.dummy.position.y += data.height * inst.scale * 0.5;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(data.width * inst.scale, data.height * inst.scale, 1);
    this.dummy.updateMatrix();

    data.mesh.setMatrixAt(idx, this.dummy.matrix);
    data.idxToId.set(idx, inst.id);
    data.count = Math.max(data.count, idx + 1);
    data.mesh.count = data.count;
    data.dirty = true;
    return idx;
  }

  // ---------------------------------------------------------------------------
  // UPDATE LOOP
  // ---------------------------------------------------------------------------

  update(camPos?: THREE.Vector3, dt = 0.016): void {
    this.time = performance.now();
    if (camPos) this.camPos.copy(camPos);
    else this.world.camera?.getWorldPosition(this.camPos);

    this.updateWind(dt);
    this.updateTransitions();

    if (this.lodEnabled && this.time - this.lastLodUpdate >= LOD_UPDATE_MS) {
      this.lastLodUpdate = this.time;

      if (this.instArray.length !== this.instances.size) {
        this.instArray = Array.from(this.instances.values());
      }

      const count = this.instArray.length;
      if (count > 0) {
        const n = Math.min(LOD_UPDATES_PER_FRAME, count);
        for (let i = 0; i < n; i++) {
          const t = this.instArray[(this.lodIdx + i) % count];
          if (t) this.updateLOD(t.preset, t.inst);
        }
        this.lodIdx = (this.lodIdx + n) % count;
      }
    }

    // Upload dirty matrices
    for (const data of this.meshes.values()) {
      for (const d of data.values()) {
        if (d.dirty) {
          d.mesh.instanceMatrix.needsUpdate = true;
          d.dirty = false;
        }
      }
    }
    for (const d of this.impostors.values()) {
      if (d.dirty) {
        d.mesh.instanceMatrix.needsUpdate = true;
        d.dirty = false;
      }
    }
  }

  private updateWind(dt: number): void {
    const strength = this.windSys?.uniforms.windStrength.value ?? 1;
    this.tempWindDir.copy(
      this.windSys?.uniforms.windDirection.value ?? new THREE.Vector3(1, 0, 0),
    );

    for (const mat of this.windMats) {
      mat.windUniforms.time.value += dt;
      mat.windUniforms.strength.value = strength;
      mat.windUniforms.direction.value.copy(this.tempWindDir);
    }
  }

  private updateTransitions(): void {
    const toRemove: string[] = [];

    for (const id of this.transitions) {
      const tracked = this.instances.get(id);
      if (!tracked) {
        toRemove.push(id);
        continue;
      }

      const { inst, preset } = tracked;
      const tr = inst.transition;
      if (!tr) {
        toRemove.push(id);
        continue;
      }

      const progress = Math.min(1, (this.time - tr.start) / LOD_FADE_MS);
      this.setFade(preset, inst, tr.to, progress);
      this.setFade(preset, inst, tr.from, 1 - progress);

      if (progress >= 1) {
        this.removeFromLOD(preset, inst, tr.from);
        inst.transition = null;
        toRemove.push(id);
      }
    }

    for (const id of toRemove) this.transitions.delete(id);
  }

  setLODUpdatesEnabled(enabled: boolean): void {
    this.lodEnabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // STATS & CLEANUP
  // ---------------------------------------------------------------------------

  getStats() {
    let draws = 0;
    const byLOD = { lod0: 0, lod1: 0, lod2: 0, impostor: 0, culled: 0 };
    const details: Record<
      string,
      { lod0: number; lod1: number; lod2: number; impostor: number }
    > = {};

    for (const [p, data] of this.meshes) {
      const l0 = data.get("lod0"),
        l1 = data.get("lod1"),
        l2 = data.get("lod2");
      const imp = this.impostors.get(p);

      const c0 = l0?.count ?? 0,
        c1 = l1?.count ?? 0,
        c2 = l2?.count ?? 0,
        ci = imp?.count ?? 0;
      if (l0 && c0 > 0) draws++;
      if (l1 && c1 > 0) draws++;
      if (l2 && c2 > 0) draws++;
      if (imp && ci > 0) draws++;
      if (l0?.shadowMesh && l0.shadowMesh.count > 0) draws++;
      if (l1?.shadowMesh && l1.shadowMesh.count > 0) draws++;

      details[p] = { lod0: c0, lod1: c1, lod2: c2, impostor: ci };
    }

    for (const { inst } of this.instances.values()) {
      const l = inst.currentLOD;
      if (l === 0) byLOD.lod0++;
      else if (l === 1) byLOD.lod1++;
      else if (l === 2) byLOD.lod2++;
      else if (l === 3) byLOD.impostor++;
      else byLOD.culled++;
    }

    return {
      presets: this.meshes.size,
      totalInstances: this.instances.size,
      drawCalls: draws,
      byLOD,
      activeTransitions: this.transitions.size,
      gpuCullingAvailable: this.isWebGPU,
      details,
    };
  }

  dispose(): void {
    for (const data of this.meshes.values()) {
      for (const d of data.values()) {
        d.mesh.parent?.remove(d.mesh);
        d.geometry.dispose();
        d.material.dispose();
        d.mesh.dispose();
        d.shadowMesh?.parent?.remove(d.shadowMesh);
        d.shadowMesh?.dispose();
        d.shadowGeo?.dispose();
      }
    }
    this.meshes.clear();

    for (const d of this.impostors.values()) {
      d.mesh.parent?.remove(d.mesh);
      d.geometry.dispose();
      d.material.dispose();
      d.mesh.dispose();
    }
    this.impostors.clear();

    this.instances.clear();
    this.transitions.clear();
    this.windMats = [];
    ProcgenTreeInstancer.inst = null;
  }
}

export default ProcgenTreeInstancer;
