/**
 * Nametags System
 *
 * Renders player/entity names using a single atlas and instanced mesh for optimal performance.
 * Now using TSL Node Materials for WebGPU compatibility.
 *
 * IMPORTANT: This system ONLY handles names. Health bars are handled separately by the HealthBars system.
 * This separation ensures clean responsibility:
 * - Nametags: names only
 * - HealthBars: health bars only
 *
 * @see HealthBars for the health bar rendering system
 */

import THREE, {
  MeshBasicNodeMaterial,
  texture,
  uv,
  positionLocal,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  add,
  sub,
  mul,
  div,
  cross,
  instancedBufferAttribute,
  Fn,
} from "../../extras/three/three";
import { toTHREEVector3 } from "../../extras/three/three";
import { SystemBase } from "../shared/infrastructure/SystemBase";
import type { World } from "../../types";

const _v3_1 = new THREE.Vector3();

const RES = 2;
const NAMETAG_WIDTH = 160 * RES;
const NAMETAG_HEIGHT = 20 * RES;
const NAME_FONT_SIZE = 14 * RES;
const NAME_OUTLINE_SIZE = 3 * RES;

const PER_ROW = 8;
const PER_COLUMN = 32;
const MAX_INSTANCES = PER_ROW * PER_COLUMN;

const defaultQuaternion = new THREE.Quaternion(0, 0, 0, 1);
const defaultScale = toTHREEVector3(new THREE.Vector3(1, 1, 1));

/**
 * Nametag entry for tracking
 */
interface NametagEntry {
  idx: number;
  name: string;
  matrix: THREE.Matrix4;
}

/**
 * Handle returned to entities for manipulating their nametag
 */
export interface NametagHandle {
  idx: number;
  name: string;
  matrix: THREE.Matrix4;
  /** Update position in world space */
  move: (newMatrix: THREE.Matrix4) => void;
  /** Update name text */
  setName: (name: string) => void;
  /** Remove nametag from system */
  destroy: () => void;
}

export class Nametags extends SystemBase {
  nametags: NametagEntry[];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.Material;
  geometry: THREE.PlaneGeometry;
  mesh: THREE.InstancedMesh;
  coordsAttribute: THREE.InstancedBufferAttribute;
  private uOrientation: { value: THREE.Quaternion };

  constructor(world: World) {
    super(world, {
      name: "nametags",
      dependencies: { required: ["stage"], optional: [] },
      autoCleanup: true,
    });
    this.nametags = [];
    this.canvas = document.createElement("canvas");
    this.canvas.width = NAMETAG_WIDTH * PER_ROW;
    this.canvas.height = NAMETAG_HEIGHT * PER_COLUMN;

    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;

    // Create uniforms
    this.uOrientation = { value: this.world.camera.quaternion };

    // Create coords attribute for atlas UV lookup
    this.coordsAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_INSTANCES * 2),
      2,
    );

    // Create TSL Node Material
    this.material = this.createNametagMaterial();

    this.geometry = new THREE.PlaneGeometry(1, NAMETAG_HEIGHT / NAMETAG_WIDTH);
    this.geometry.setAttribute("coords", this.coordsAttribute);

    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      MAX_INSTANCES,
    );
    this.mesh.renderOrder = 9999;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /**
   * Create TSL Node Material for billboard nametags
   */
  private createNametagMaterial(): THREE.Material {
    const uOrientationUniform = uniform(vec4(0, 0, 0, 1));
    const atlasTexture = this.texture;

    // Helper function to apply quaternion to position
    const applyQuaternion = Fn(
      ([pos, quat]: [ReturnType<typeof vec3>, ReturnType<typeof vec4>]) => {
        const qv = vec3(quat.x, quat.y, quat.z);
        const t = mul(cross(qv, pos), float(2.0));
        return add(add(pos, mul(t, quat.w)), cross(qv, t));
      },
    );

    // Position node with billboard orientation
    const positionNode = Fn(() => {
      const localPos = positionLocal;

      // Apply camera orientation for billboard effect
      const newPosition = applyQuaternion(localPos, uOrientationUniform);

      return newPosition;
    })();

    // Color node with atlas UV lookup
    const colorNode = Fn(() => {
      // Get coords from attribute (set per-instance)
      const coordsAttr = instancedBufferAttribute(this.coordsAttribute);

      // Calculate atlas UV
      const baseUv = uv();
      const atlasUv = vec2(
        add(div(baseUv.x, float(PER_ROW)), coordsAttr.x),
        add(div(sub(float(1.0), baseUv.y), float(PER_COLUMN)), coordsAttr.y),
      );

      // Sample atlas texture
      const texColor = texture(atlasTexture, atlasUv);

      return texColor;
    })();

    // Create material
    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;

    // Store uniforms for external updates
    (
      material as THREE.Material & {
        nametagUniforms?: { uOrientation: typeof uOrientationUniform };
      }
    ).nametagUniforms = {
      uOrientation: uOrientationUniform,
    };

    return material;
  }

  start() {
    this.world.stage.scene.add(this.mesh);
  }

  /**
   * Update orientation uniform each frame
   */
  update() {
    // Update orientation uniform from camera
    const mat = this.material as THREE.Material & {
      nametagUniforms?: {
        uOrientation: { value: THREE.Quaternion };
      };
    };
    if (mat.nametagUniforms) {
      mat.nametagUniforms.uOrientation.value.copy(this.world.camera.quaternion);
    }
  }

  /**
   * Add a nametag for an entity
   * @param name - The name to display
   */
  add({ name }: { name: string }): NametagHandle | null {
    const idx = this.nametags.length;
    if (idx >= MAX_INSTANCES) {
      console.error("nametags: reached max");
      return null;
    }

    this.mesh.count++;
    this.mesh.instanceMatrix.needsUpdate = true;

    const row = Math.floor(idx / PER_ROW);
    const col = idx % PER_ROW;
    this.coordsAttribute.setXY(idx, col / PER_ROW, row / PER_COLUMN);
    this.coordsAttribute.needsUpdate = true;

    const matrix = new THREE.Matrix4();
    const position = _v3_1.set(0, 0, 0);
    matrix.compose(position, defaultQuaternion, defaultScale);

    const entry: NametagEntry = {
      idx,
      name,
      matrix,
    };
    this.nametags[idx] = entry;

    // Create handle
    const handle: NametagHandle = {
      idx,
      name,
      matrix,
      move: (newMatrix: THREE.Matrix4) => {
        matrix.elements[12] = newMatrix.elements[12];
        matrix.elements[13] = newMatrix.elements[13];
        matrix.elements[14] = newMatrix.elements[14];
        this.mesh.setMatrixAt(entry.idx, matrix);
        this.mesh.instanceMatrix.needsUpdate = true;
      },
      setName: (newName: string) => {
        if (entry.name === newName) return;
        entry.name = newName;
        handle.name = newName;
        this.draw(entry);
      },
      destroy: () => {
        this.remove(entry);
      },
    };

    this.draw(entry);
    return handle;
  }

  private remove(entry: NametagEntry) {
    if (!this.nametags.includes(entry)) {
      return console.warn("nametags: attempted to remove non-existent nametag");
    }
    const last = this.nametags[this.nametags.length - 1];
    const isLast = entry === last;
    if (isLast) {
      this.nametags.pop();
      this.undraw(entry);
    } else {
      this.undraw(last);
      last.idx = entry.idx;
      this.draw(last);
      const row = Math.floor(entry.idx / PER_ROW);
      const col = entry.idx % PER_ROW;
      this.coordsAttribute.setXY(entry.idx, col / PER_ROW, row / PER_COLUMN);
      this.coordsAttribute.needsUpdate = true;
      this.mesh.setMatrixAt(last.idx, last.matrix);
      this.nametags[last.idx] = last;
      this.nametags.pop();
    }
    this.mesh.count--;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private fitText(text: string, maxWidth: number): string {
    const metrics = this.ctx.measureText(text);
    if (metrics.width <= maxWidth) {
      return text;
    }

    let truncated = text;
    while (truncated.length > 0) {
      truncated = truncated.slice(0, -1);
      const testText = truncated + "...";
      const testMetrics = this.ctx.measureText(testText);
      if (testMetrics.width <= maxWidth) {
        return testText;
      }
    }
    return "...";
  }

  private draw(entry: NametagEntry) {
    const idx = entry.idx;
    const row = Math.floor(idx / PER_ROW);
    const col = idx % PER_ROW;
    const x = col * NAMETAG_WIDTH;
    const y = row * NAMETAG_HEIGHT;

    this.ctx.clearRect(x, y, NAMETAG_WIDTH, NAMETAG_HEIGHT);

    // Draw name only (no health bar - that's handled by HealthBars system)
    this.ctx.font = `800 ${NAME_FONT_SIZE}px Rubik`;
    this.ctx.fillStyle = "white";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.lineWidth = NAME_OUTLINE_SIZE;
    this.ctx.strokeStyle = "rgba(0,0,0,0.5)";
    const text = this.fitText(entry.name, NAMETAG_WIDTH);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "xor";
    this.ctx.globalAlpha = 1;
    this.ctx.strokeText(text, x + NAMETAG_WIDTH / 2, y + NAMETAG_HEIGHT / 2);
    this.ctx.restore();
    this.ctx.fillText(text, x + NAMETAG_WIDTH / 2, y + NAMETAG_HEIGHT / 2);

    this.texture.needsUpdate = true;
  }

  private undraw(entry: NametagEntry) {
    const idx = entry.idx;
    const row = Math.floor(idx / PER_ROW);
    const col = idx % PER_ROW;
    const x = col * NAMETAG_WIDTH;
    const y = row * NAMETAG_HEIGHT;
    this.ctx.clearRect(x, y, NAMETAG_WIDTH, NAMETAG_HEIGHT);
    this.texture.needsUpdate = true;
  }
}
